// ── State store: Postgres-backed, shared across branches ──
//
// Records live in Postgres, not in the browser. This keeps an in-memory cache
// of what the signed-in branch may see so the modules can carry on reading
// synchronously — `store.state.orders` still just returns an array — while
// writes go to the database and come back from it.
//
// The shape of that cache, and every read below it, is unchanged from the
// localStorage version on purpose: the modules did not need rewriting.
//
// Writes are asynchronous and return a promise. Most callers fire and forget:
// the write reloads the affected collection and notifies subscribers, which
// re-renders the screen from the authoritative rows rather than from a guess.
import { supabase } from './auth.js';
import * as db from './db.js';
import {
  locName, fitStep, nextFitStatus,
  canAdvanceOrder, canSeeOrder, canSeeRequest, canSeeLensRequest, canSeeClaim,
  LENS_OWNER, BARE_COATING, lensFull, brandsFor, DEFAULT_BRAND_GROUP,
} from './data.js';
import { toast } from './ui.js';

// Empty until load() finishes, so a module that renders early shows "nothing
// yet" rather than throwing.
let state = {
  settings: { brandGroups: [], categories: [] },
  lensCatalogue: { types: [], indices: [], coatings: [] },
  orders: [], requests: [], lensStock: [], lensRequests: [], claims: [],
};

const subs = new Set();
let unwatch = null;
let loaded = false;

function notify(event) { subs.forEach(fn => fn(event)); }

// A local write: the rows are already refreshed, so just tell the UI.
function commit(event) { notify(event ? { ...event, remote: false } : null); }

async function pull(keys) { Object.assign(state, await db.reload(keys)); }

// Postgres errors are precise but not written for shop staff. Translate the
// handful that are actually reachable and pass anything else through.
function explain(e) {
  const m = String(e?.message ?? e);
  if (/orders_ref_per_branch|duplicate key.*orders/i.test(m)) return 'That bill number is already logged at your branch.';
  if (/row-level security|violates row-level/i.test(m)) return 'Your branch is not allowed to do that.';
  if (/only the lens-holding branch/i.test(m)) return `Only ${locName(LENS_OWNER)} can change the lens shelf.`;
  if (/only the warehouse/i.test(m)) return 'Only the warehouse can do that.';
  if (/already (confirmed|declined|completed)/i.test(m)) return 'Someone already answered that one.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'No connection to the server. Check the internet and try again.';
  return m.replace(/^.*?:\s*/, '');
}

// Every mutation funnels through here: do the work, reload what it touched,
// then announce it. A failure is surfaced rather than silently dropped — the
// old version could not fail, so nothing downstream was looking for errors.
async function run(keys, work, describe) {
  try {
    const out = await work();
    if (out === SKIP) return null;
    await pull(keys);
    const event = typeof describe === 'function' ? describe(out) : describe;
    commit(event);
    return out;
  } catch (e) {
    toast({ title: 'That did not save', sub: explain(e), tone: 'stock' });
    notify({ failed: true });
    return null;
  }
}

// Returned by work() when there was nothing to do (an empty selection, a row
// someone else already moved) — not an error, just no announcement.
const SKIP = Symbol('skip');

// Which screen cares about each collection, for routing refreshes.
// What the three catalogue lists are called when a toast names one.
const LENS_OPTION_LABEL = { types: 'lens types', indices: 'indices', coatings: 'coatings' };

const MODULE_OF = {
  orders: 'fitting', requests: 'stock', lensStock: 'lens',
  lensRequests: 'lens', lensCatalogue: 'lens', claims: 'claims', settings: 'settings',
};

const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

export const store = {
  get state() { return state; },
  get settings() { return state.settings; },
  get ready() { return loaded; },
  subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },

  // ── Session ──
  // Set by the shell from the signed-in Supabase user. There is deliberately
  // no login() here: credentials are never checked in the browser.
  session: null,

  // ── Lifecycle ──
  // Called once after sign-in, before the shell renders, so the first paint
  // already has real data. Then realtime keeps it current.
  async load() {
    db.forgetLocalCopy();
    Object.assign(state, await db.loadAll());
    loaded = true;
    unwatch?.();
    unwatch = db.watch(async (keys, notices) => {
      try {
        await pull(keys);
      } catch { return; } // a dropped refresh is not worth a popup
      // Our own writes come back over realtime as well. The local commit has
      // already announced those, so narrate only what other branches did.
      const fresh = notices.filter(n => n.by !== this.session?.code);
      for (const n of fresh) notify({ ...n, remote: true });
      // Claims and Settings only redraw for their own module, and some
      // changes (a shelf count, a settings edit) carry no narrated event —
      // so every touched module is told, whether or not it got a notice.
      for (const m of new Set(keys.map(k => MODULE_OF[k]).filter(Boolean))) {
        if (!fresh.some(n => n.module === m)) notify({ module: m, remote: true });
      }
    });
  },

  stop() { unwatch?.(); unwatch = null; loaded = false; },

  // ── Queries (already permission-scoped) ──
  // RLS has filtered these server-side too; the predicates stay so the
  // database is not the only thing standing between branches.
  ordersFor(code) { return state.orders.filter(o => canSeeOrder(o, code)); },
  requestsFor(code) { return state.requests.filter(r => canSeeRequest(r, code)); },
  order(id) { return state.orders.find(o => o.id === id); },
  request(id) { return state.requests.find(r => r.id === id); },

  // Resolved through the store so the composer and the drawer can never
  // disagree about which brands a category offers or how it's counted.
  brandsFor(cat) {
    const c = typeof cat === 'string' ? state.settings.categories.find(x => x.name === cat) : cat;
    return brandsFor(state.settings, c);
  },
  unitFor(cat) {
    const c = typeof cat === 'string' ? state.settings.categories.find(x => x.name === cat) : cat;
    return c?.unit === 'box' ? 'box' : 'pcs';
  },
  brandGroup(name) { return state.settings.brandGroups.find(g => g.name === name); },

  claimsFor(code) { return state.claims.filter(c => canSeeClaim(c, code)); },
  claim(id) { return state.claims.find(c => c.id === id); },

  get lensStock() { return state.lensStock; },

  // What the shelf is allowed to hold. Every branch reads these to shop; the
  // lens-holding branch edits them from the shelf's cog.
  get lensTypes() { return state.lensCatalogue.types; },
  get lensIndices() { return state.lensCatalogue.indices; },
  get lensCoatings() { return state.lensCatalogue.coatings; },

  // How many rows on the shelf still name this value — removing one that is in
  // use would leave stock nothing in the list describes.
  lensOptionUse(kind, value) {
    const field = { types: 'type', indices: 'index', coatings: 'coating' }[kind];
    return field ? state.lensStock.filter(i => i[field] === value).length : 0;
  },
  lensItem(id) { return state.lensStock.find(i => i.id === id); },
  lensRequestsFor(code) { return state.lensRequests.filter(r => canSeeLensRequest(r, code)); },
  lensRequest(id) { return state.lensRequests.find(r => r.id === id); },

  // ── Fitting mutations ──
  createOrder(fields, by) {
    return run(['orders'], async () => {
      const row = ok(await supabase.from('orders').insert(db.orderRow(fields, by)).select('id, ref').single());
      ok(await supabase.from('order_events').insert({
        order_id: row.id, by_code: by,
        text: `Order logged at ${locName(by)}${fields.note ? ` — ${fields.note}` : ''}`,
      }));
      return row;
    }, row => ({
      by, module: 'fitting', title: `${by} logged fitting order ${row.ref}`,
      sub: 'Awaiting fitter assignment', refs: [row.id],
    })).then(row => (row ? this.order(row.id) : null));
  },

  // Assign a fitter to pending orders and set them going. An order whose own
  // branch is the fitter has no journey to make, so it lands on the bench
  // directly; the rest go on the road.
  //
  // The cache only decides which of the two an order is — origin never changes,
  // so it cannot get that wrong. Both updates still carry their guards, so an
  // order another branch already sent is skipped by the database rather than by
  // a stale read here.
  sendOrdersToFitter(ids, fitter, by) {
    const here = ids.filter(id => this.order(id)?.origin === fitter);
    const away = ids.filter(id => !here.includes(id));
    const legs = [
      { ids: away, status: 'to_fitter', text: `Sent to ${locName(fitter)} — in transit to fitter` },
      { ids: here, status: 'at_fitter', text: `Kept at ${locName(fitter)} for fitting — no transit` },
    ].filter(l => l.ids.length);

    return run(['orders'], async () => {
      const moved = (await Promise.all(legs.map(async leg => {
        const rows = ok(await supabase.from('orders')
          .update({ fitter_code: fitter, status: leg.status })
          .in('id', leg.ids).eq('status', 'pending').is('fitter_code', null)
          .select('id, ref'));
        if (!rows.length) return [];
        ok(await supabase.from('order_events').insert(rows.map(o => ({
          order_id: o.id, by_code: by, text: leg.text,
        }))));
        return rows;
      }))).flat();
      return moved.length ? moved : SKIP;
    }, moved => ({
      by, module: 'fitting',
      title: moved.length === 1
        ? `${by} · ${moved[0].ref} → ${fitStep(this.order(moved[0].id) ?? {}).label}`
        : `${by} sent ${moved.length} orders to ${locName(fitter)}`,
      sub: here.length && !away.length ? 'Fitted in-house — no transit' : `→ ${locName(fitter)}`,
      refs: moved.map(o => o.id),
    })).then(moved => (moved ?? []).map(o => this.order(o.id)).filter(Boolean));
  },

  async sendToFitter(id, fitter, by) { return (await this.sendOrdersToFitter([id], fitter, by))[0]; },

  // Each order's next status depends on where it is now, so these go one at a
  // time — in parallel, and each guarded on the status it was read at, so an
  // order someone else just moved is left alone instead of skipping a step.
  advanceOrders(ids, by) {
    return run(['orders'], async () => {
      const plan = ids.map(id => this.order(id))
        .filter(o => o && canAdvanceOrder(o, by) && !(o.status === 'pending' && !o.fitter))
        .map(o => ({ o, from: o.status, to: nextFitStatus(o) }))
        .filter(p => p.to);
      if (!plan.length) return SKIP;

      const done = (await Promise.all(plan.map(async p => {
        const rows = ok(await supabase.from('orders').update({ status: p.to })
          .eq('id', p.o.id).eq('status', p.from).select('id, ref, customer'));
        if (!rows.length) return null;
        ok(await supabase.from('order_events').insert({
          order_id: p.o.id, by_code: by, text: fitStep(p.o).done,
        }));
        return { ...rows[0], status: p.to };
      }))).filter(Boolean);

      return done.length ? done : SKIP;
    }, done => ({
      by, module: 'fitting',
      title: done.length === 1
        ? `${by} · ${done[0].ref} → ${fitStep(this.order(done[0].id) ?? done[0]).label}`
        : `${by} moved ${done.length} orders forward`,
      sub: done.length === 1 ? (done[0].customer || done[0].ref) : done.map(o => o.ref).join(', '),
      refs: done.map(o => o.id),
    })).then(done => (done ?? []).map(o => this.order(o.id)).filter(Boolean));
  },

  setUrgent(id, urgent, by) {
    const o = this.order(id);
    if (!o) return Promise.resolve(null);
    return run(['orders'], async () => {
      ok(await supabase.from('orders').update({ urgent }).eq('id', id));
      ok(await supabase.from('order_events').insert({
        order_id: id, by_code: by, text: urgent ? 'Flagged urgent' : 'Urgent flag removed',
      }));
      return o;
    }, {
      by, module: 'fitting',
      title: `${by} ${urgent ? 'flagged' : 'unflagged'} ${o.ref} ${urgent ? 'urgent' : ''}`.trim(),
      refs: [id],
    });
  },

  // ── Stock request mutations ──
  createRequest({ lines, note }, by) {
    return run(['requests'], async () => {
      const units = lines.reduce((s, l) => s + (l.qty || 0), 0);
      // ref comes from a database sequence, so two branches placing a request
      // at the same moment cannot be handed the same number.
      const row = ok(await supabase.from('stock_requests')
        .insert({ branch_code: by, status: 'placed', note: note ?? '' })
        .select('id, ref').single());
      ok(await supabase.from('stock_request_lines').insert(db.stockLineRows(row.id, lines)));
      ok(await supabase.from('stock_request_events').insert({
        request_id: row.id, by_code: by,
        text: `Request placed — ${lines.length} line${lines.length > 1 ? 's' : ''}${units ? `, ${units} units` : ''}${note ? ` — ${note}` : ''}`,
      }));
      return { ...row, lines, units };
    }, r => ({
      by, module: 'stock', title: `${by} placed stock request ${r.ref}`,
      sub: `${r.lines.length} lines${r.units ? ` · ${r.units} units` : ''}`, refs: [r.id],
    })).then(r => (r ? this.request(r.id) : null));
  },

  // The warehouse marks a placed request done after physically fulfilling it.
  // Done in the database so two warehouse staff cannot both complete it.
  completeRequest(id, by) {
    const r = this.request(id);
    if (!r || r.status !== 'placed') return Promise.resolve(null);
    return run(['requests'], async () => {
      ok(await supabase.rpc('complete_stock_request', { p_request: id }));
      return r;
    }, {
      by, module: 'stock', title: `${by} completed ${r.ref}`,
      sub: `→ ${locName(r.branch)}`, refs: [id],
    });
  },

  // ── Lens stock (owned by the holding fitting centre) ──
  // Same spec twice means more of the same lens on the shelf, not a second
  // row — and the add happens in one SQL statement so it cannot double-count.
  addLensItem(f, by) {
    const qty = Math.max(0, parseInt(f.qty, 10) || 0);
    return run(['lensStock'], async () => {
      const spec = db.lensStockRow(f);
      const row = ok(await supabase.rpc('add_lens_stock', {
        p_type: spec.lens_type, p_index: spec.lens_index, p_coating: spec.coating,
        p_sph: spec.sph, p_cyl: spec.cyl, p_qty: qty,
      }));
      return row;
    }, row => {
      const item = { type: row.lens_type, index: row.lens_index, coating: row.coating, sph: row.sph, cyl: row.cyl };
      // A topped-up row already held stock; a brand new one did not.
      const topUp = row.qty > qty;
      return {
        by, module: 'lens',
        title: topUp ? `${by} added ${qty} to existing stock` : `${by} added lens stock`,
        sub: topUp ? lensFull(item) : `${lensFull(item)} · ${qty} pcs`, refs: [row.id],
      };
    }).then(row => (row ? this.lensItem(row.id) : null));
  },

  setLensQty(id, qty, by) {
    const i = this.lensItem(id);
    if (!i) return Promise.resolve(null);
    const next = Math.max(0, parseInt(qty, 10) || 0);
    return run(['lensStock'], async () => {
      ok(await supabase.from('lens_stock').update({ qty: next, updated_at: new Date().toISOString() }).eq('id', id));
      return i;
    }, {
      by, module: 'lens', title: `${by} updated lens count`,
      sub: `${lensFull(i)} → ${next} pcs`, refs: [id],
    });
  },

  removeLensItem(id, by) {
    const i = this.lensItem(id);
    if (!i) return Promise.resolve(null);
    return run(['lensStock'], async () => {
      ok(await supabase.from('lens_stock').delete().eq('id', id));
      return i;
    }, { by, module: 'lens', title: `${by} removed lens stock`, sub: lensFull(i), refs: [id] });
  },

  // ── Lens catalogue ──
  // The lists the shelf is built from. Edited optimistically and pushed whole,
  // like settings: the database refuses anyone but the lens holder and the
  // warehouse, and a refusal rolls the screen back from the server.
  addLensOption(kind, value) {
    value = String(value).trim();
    const list = state.lensCatalogue[kind];
    if (!list || !value || list.some(v => v.toLowerCase() === value.toLowerCase())) return Promise.resolve(null);
    list.push(value);
    // Indices are numbers wearing text, so they belong in numeric order
    // wherever they were typed. Types and coatings keep the order given.
    if (kind === 'indices') list.sort((a, b) => parseFloat(a) - parseFloat(b));
    return saveLensCatalogue({ module: 'lens', title: `${value} added to ${LENS_OPTION_LABEL[kind]}` });
  },

  removeLensOption(kind, value) {
    const list = state.lensCatalogue[kind];
    if (!list || !list.includes(value)) return Promise.resolve(null);
    // Pulling a value out from under stock that uses it would leave rows the
    // filters cannot describe, so the shelf has to be clear of it first.
    const used = this.lensOptionUse(kind, value);
    if (used) {
      toast({
        title: `${value} is still on the shelf`,
        sub: `${used} lens ${used === 1 ? 'line uses' : 'lines use'} it. Clear ${used === 1 ? 'it' : 'them'} first.`,
        tone: 'lens',
      });
      return Promise.resolve(null);
    }
    if (list.length <= 1) return Promise.resolve(null);          // never empty the list
    if (kind === 'coatings' && value === BARE_COATING) return Promise.resolve(null);
    state.lensCatalogue[kind] = list.filter(v => v !== value);
    return saveLensCatalogue({ module: 'lens', title: `${value} removed from ${LENS_OPTION_LABEL[kind]}` });
  },

  // ── Lens requests (branch → holding centre) ──
  // The request, its lines and the fitting order it opens all happen inside one
  // database function. The bill number is unique per branch, so the order is
  // the part that can fail; doing this as three calls from here would leave a
  // lens request with no job behind it the first time someone retyped a bill
  // number. The function also decides the fitter, so a branch cannot name
  // itself one.
  createLensRequest({ lines, billNo, customer, fulfilment }, by) {
    return run(['lensRequests', 'orders'], async () => {
      const row = ok(await supabase.rpc('create_lens_request', {
        p_bill: billNo, p_customer: customer, p_fulfilment: fulfilment, p_lines: lines,
      }));
      const pcs = lines.reduce((s, l) => s + (l.qty || 0), 0);
      return { ...row, lines, pcs };
    }, r => ({
      by, module: 'lens', title: `${by} requested lenses ${r.ref}`,
      sub: r.fulfilment === 'receive_lens'
        ? `${r.pcs} pcs to ${locName(by)} · fitting here`
        : `${r.pcs} pcs · frame going to ${locName(LENS_OWNER)}`,
      refs: [r.id],
    })).then(r => (r ? this.lensRequest(r.id) : null));
  },

  // Confirming ships the lenses, so the shelf comes down with it. That happens
  // inside one database function: two branches confirming at the same instant
  // cannot both be given the last lens, which a browser could not guarantee.
  confirmLensRequest(id, by) {
    const r = this.lensRequest(id);
    if (!r || r.status !== 'requested') return Promise.resolve(null);
    return run(['lensRequests', 'lensStock'], async () => {
      ok(await supabase.rpc('confirm_lens_request', { p_request: id }));
      return r;
    }, {
      by, module: 'lens', title: `${by} confirmed ${r.ref}`,
      sub: `→ ${locName(r.branch)}`, refs: [id],
    });
  },

  declineLensRequest(id, reason, by) {
    const r = this.lensRequest(id);
    if (!r || r.status !== 'requested') return Promise.resolve(null);
    const why = (reason || '').trim();
    return run(['lensRequests'], async () => {
      const rows = ok(await supabase.from('lens_requests')
        .update({ status: 'declined', reason: why })
        .eq('id', id).eq('status', 'requested').select('id'));
      if (!rows.length) return SKIP;
      ok(await supabase.from('lens_request_events').insert({
        request_id: id, by_code: by, text: `Declined${why ? ` — ${why}` : ''}`,
      }));
      return r;
    }, {
      by, module: 'lens', title: `${by} declined ${r.ref}`,
      sub: `→ ${locName(r.branch)}`, refs: [id],
    });
  },

  // ── Insurance claim receipts ──
  createClaim(f, by) {
    return run(['claims'], async () => {
      const row = ok(await supabase.from('claims').insert(db.claimRow(f, by)).select('id, ref').single());
      ok(await supabase.from('claim_items').insert(db.claimItemRows(row.id, f.items)));
      ok(await supabase.from('claim_prescriptions').insert(db.claimRxRows(row.id, f.rx)));
      return { ...row, customer: f.customer };
    }, c => ({ by, module: 'claims', title: `${by} raised claim ${c.ref}`, sub: c.customer, refs: [c.id] }))
      .then(c => (c ? this.claim(c.id) : null));
  },

  updateClaim(id, f, by) {
    const prev = this.claim(id);
    if (!prev) return Promise.resolve(null);
    return run(['claims'], async () => {
      ok(await supabase.from('claims').update(db.claimRow(f)).eq('id', id));
      // Lines are replaced wholesale: the editor hands back the finished list,
      // and diffing it row by row would buy nothing on a receipt this size.
      ok(await supabase.from('claim_items').delete().eq('claim_id', id));
      ok(await supabase.from('claim_items').insert(db.claimItemRows(id, f.items)));
      ok(await supabase.from('claim_prescriptions').delete().eq('claim_id', id));
      ok(await supabase.from('claim_prescriptions').insert(db.claimRxRows(id, f.rx)));
      return prev;
    }, { by, module: 'claims', title: `${by} updated claim ${prev.ref}`, sub: f.customer, refs: [id] })
      .then(c => (c ? this.claim(id) : null));
  },

  removeClaim(id, by) {
    const c = this.claim(id);
    if (!c) return Promise.resolve(null);
    return run(['claims'], async () => {
      ok(await supabase.from('claims').delete().eq('id', id));
      return c;
    }, { by, module: 'claims', title: `${by} deleted claim ${c.ref}`, refs: [id] });
  },

  // ── Settings (admin) ──
  // These edit one shared JSON document, so the whole of it is written back
  // after each change and every branch picks the new version up over realtime.
  // The local edit happens first so the form stays responsive, and is rolled
  // back from the server if the write is refused.
  addBrandGroup(name) {
    name = String(name).trim();
    if (!name || this.brandGroup(name)) return Promise.resolve(null);
    state.settings.brandGroups.push({ name, brands: [] });
    return saveSettings({ module: 'settings', title: `Brand group “${name}” added` });
  },

  // Names are the key categories point at, so a rename carries those with it.
  renameBrandGroup(oldName, newName) {
    newName = String(newName).trim();
    const g = this.brandGroup(oldName);
    if (!g || !newName || newName === oldName || this.brandGroup(newName)) return Promise.resolve(null);
    g.name = newName;
    for (const c of state.settings.categories) if (c.brandGroup === oldName) c.brandGroup = newName;
    return saveSettings({ module: 'settings', title: `Renamed to “${newName}”` });
  },

  removeBrandGroup(name) {
    if (state.settings.brandGroups.length <= 1) return Promise.resolve(null);
    state.settings.brandGroups = state.settings.brandGroups.filter(g => g.name !== name);
    const fallback = state.settings.brandGroups[0].name;
    for (const c of state.settings.categories) if (c.brandGroup === name) c.brandGroup = fallback;
    return saveSettings({ module: 'settings', title: `Brand group “${name}” removed` });
  },

  reorderBrandGroups(from, to) {
    const gs = state.settings.brandGroups;
    if (from === to || from < 0 || from >= gs.length) return Promise.resolve(null);
    gs.splice(Math.max(0, Math.min(gs.length - 1, to)), 0, ...gs.splice(from, 1));
    return saveSettings({ module: 'settings', title: 'Brand groups reordered' });
  },

  addBrand(group, name) {
    name = String(name).trim();
    const g = this.brandGroup(group);
    if (!g || !name || g.brands.includes(name)) return Promise.resolve(null);
    g.brands.push(name);
    return saveSettings({ module: 'settings', title: `${name} added to ${group}` });
  },

  removeBrand(group, name) {
    const g = this.brandGroup(group);
    if (!g) return Promise.resolve(null);
    g.brands = g.brands.filter(b => b !== name);
    return saveSettings({ module: 'settings', title: `${name} removed from ${group}` });
  },

  moveBrand(fromGroup, fromIdx, toGroup, toIdx) {
    const a = this.brandGroup(fromGroup);
    const b = this.brandGroup(toGroup);
    if (!a || !b || fromIdx < 0 || fromIdx >= a.brands.length) return Promise.resolve(null);
    const [brand] = a.brands.splice(fromIdx, 1);
    if (b.brands.includes(brand)) {
      // Already there — put it back rather than losing it to a duplicate.
      if (a !== b) a.brands.splice(fromIdx, 0, brand);
      else b.brands.splice(Math.max(0, Math.min(b.brands.length, toIdx)), 0, brand);
    } else {
      b.brands.splice(Math.max(0, Math.min(b.brands.length, toIdx)), 0, brand);
    }
    return saveSettings({ module: 'settings', title: `${brand} → ${toGroup}` });
  },

  addCategory({ name, needsBrand = true, needsAudience = true, needsQty = true, unit = 'pcs', brandGroup }) {
    name = String(name).trim();
    if (!name || state.settings.categories.some(c => c.name === name)) return Promise.resolve(null);
    state.settings.categories.push({
      name, needsBrand, needsAudience, needsQty, unit,
      brandGroup: brandGroup ?? state.settings.brandGroups[0]?.name ?? DEFAULT_BRAND_GROUP,
    });
    return saveSettings({ module: 'settings', title: `Category “${name}” added` });
  },

  updateCategory(name, patch) {
    const c = state.settings.categories.find(x => x.name === name);
    if (!c) return Promise.resolve(null);
    Object.assign(c, patch);
    return saveSettings({ module: 'settings', title: `“${name}” updated` });
  },

  removeCategory(name) {
    state.settings.categories = state.settings.categories.filter(c => c.name !== name);
    return saveSettings({ module: 'settings', title: `Category “${name}” removed` });
  },

  reorderCategories(from, to) {
    const cs = state.settings.categories;
    if (from === to || from < 0 || from >= cs.length) return Promise.resolve(null);
    cs.splice(Math.max(0, Math.min(cs.length - 1, to)), 0, ...cs.splice(from, 1));
    return saveSettings({ module: 'settings', title: 'Categories reordered' });
  },
};

// Writes the whole catalogue back. Only the lens holder and the warehouse may;
// for anyone else the database refuses and the optimistic edit is undone.
async function saveLensCatalogue(event) {
  try {
    await db.saveLensCatalogue(state.lensCatalogue);
    commit(event);
    return true;
  } catch (e) {
    toast({ title: 'Lens list did not save', sub: explain(e), tone: 'lens' });
    Object.assign(state, await db.reload(['lensCatalogue']).catch(() => ({})));
    commit({ module: 'lens' });
    return false;
  }
}

// Writes the whole settings document back. Only the warehouse may; for anyone
// else the database refuses and the optimistic edit is undone.
async function saveSettings(event) {
  try {
    await db.saveSettings(state.settings);
    commit(event);
    return true;
  } catch (e) {
    toast({ title: 'Settings did not save', sub: explain(e), tone: 'stock' });
    Object.assign(state, await db.reload(['settings']).catch(() => ({})));
    notify({ failed: true });
    return false;
  }
}
