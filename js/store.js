// ── State store: persistence, cross-tab realtime sync, mutations, simulator ──
import {
  seedState, loc, locName, BRANCHES, FITTERS, AUDIENCES,
  FIT_STATUS, nextFitStatus, fitActor,
  canAdvanceOrder, canSeeOrder, canSeeRequest, canSeeLensRequest, canSeeClaim,
  LENS_OWNER, lensFull, brandsFor, normaliseRx,
} from './data.js';

const STATE_VERSION = 5;
const STATE_KEY = 'focp.state.v5';
const SESSION_KEY = 'focp.session';
const LEADER_KEY = 'focp.leader';
const TAB = Math.random().toString(36).slice(2, 10);

let state = load();
const subs = new Set();

function load() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) { const s = JSON.parse(raw); if (s?.v === STATE_VERSION) return hydrate(s); }
  } catch { /* corrupted → reseed */ }
  const s = seedState();
  localStorage.setItem(STATE_KEY, JSON.stringify(s));
  return s;
}

// Fills in collections added after a blob was first written, so shipping a new
// module doesn't force everyone's saved records to be thrown away.
function hydrate(s) {
  s.claims ??= [];
  s.seq.claim ??= 3000;
  for (const c of s.claims) c.rx = normaliseRx(c.rx);
  return s;
}

function save() { localStorage.setItem(STATE_KEY, JSON.stringify(state)); }

// ── Realtime sync across tabs ──
const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('focp') : null;
if (bc) bc.onmessage = e => {
  const { tab, state: s, event } = e.data ?? {};
  if (tab === TAB || !s) return;
  state = s;
  notify(event ? { ...event, remote: true } : null);
};
window.addEventListener('storage', e => {
  if (e.key !== STATE_KEY || bc) return; // fallback path only
  try { state = JSON.parse(e.newValue); notify({ remote: true }); } catch { /* ignore */ }
});

function notify(event) { subs.forEach(fn => fn(event)); }

function commit(event) {
  state.rev++;
  save();
  bc?.postMessage({ tab: TAB, state, event });
  notify(event ? { ...event, remote: false } : null);
}

export const store = {
  get state() { return state; },
  get settings() { return state.settings; },
  subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },

  // ── Session ──
  session: null,
  restoreSession() {
    const code = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
    this.session = code ? loc(code) ?? null : null;
    return this.session;
  },
  login(code, pin) {
    const l = loc(code);
    if (!l || l.pin !== pin) return null;
    this.session = l;
    sessionStorage.setItem(SESSION_KEY, code);
    localStorage.setItem(SESSION_KEY, code);
    return l;
  },
  logout() {
    this.session = null;
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
  },

  // ── Queries (already permission-scoped) ──
  ordersFor(code) { return state.orders.filter(o => canSeeOrder(o, code)); },
  requestsFor(code) { return state.requests.filter(r => canSeeRequest(r, code)); },
  order(id) { return state.orders.find(o => o.id === id); },
  request(id) { return state.requests.find(r => r.id === id); },
  nextBillRef() { return `B-${state.seq.bill + 1}`; },

  // Resolved through the store so the composer and the simulator can never
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
  lensItem(id) { return state.lensStock.find(i => i.id === id); },
  lensRequestsFor(code) { return state.lensRequests.filter(r => canSeeLensRequest(r, code)); },
  lensRequest(id) { return state.lensRequests.find(r => r.id === id); },

  resetDemo() {
    state = seedState();
    commit({ by: this.session?.code, module: 'system', title: 'Demo data reset' });
  },

  // ── Fitting mutations ──
  createOrder(fields, by) {
    const now = Date.now();
    state.seq.bill = Math.max(state.seq.bill + 1, parseInt(String(fields.ref).replace(/\D/g, ''), 10) || 0);
    const o = {
      id: 'o' + now.toString(36) + Math.random().toString(36).slice(2, 6),
      ref: fields.ref, origin: fields.origin,
      fitter: fields.fitter ?? null,
      customer: fields.customer ?? '', phone: fields.phone ?? '',
      brand: fields.brand ?? '', model: fields.model ?? '', lens: fields.lens ?? '',
      urgent: !!fields.urgent, note: fields.note ?? '',
      status: 'pending', createdAt: now, updatedAt: now,
      timeline: [{ at: now, by, text: `Order logged at ${locName(by)}${fields.note ? ` — ${fields.note}` : ''}` }],
    };
    state.orders.unshift(o);
    commit({ by, module: 'fitting', title: `${by} logged fitting order ${o.ref}`, sub: 'Awaiting fitter assignment', refs: [o.id] });
    return o;
  },

  // Assign a fitter to pending orders and put them in transit (single commit).
  sendOrdersToFitter(ids, fitter, by) {
    const now = Date.now();
    const moved = [];
    for (const id of ids) {
      const o = this.order(id);
      if (!o || o.status !== 'pending' || o.fitter) continue;
      o.fitter = fitter;
      o.status = 'to_fitter';
      o.updatedAt = now;
      o.timeline.push({ at: now, by, text: `Sent to ${locName(fitter)} — in transit to fitter` });
      moved.push(o);
    }
    if (!moved.length) return [];
    const title = moved.length === 1
      ? `${by} · ${moved[0].ref} → ${FIT_STATUS.to_fitter.label}`
      : `${by} sent ${moved.length} orders to ${locName(fitter)}`;
    commit({ by, module: 'fitting', title, sub: `→ ${locName(fitter)}`, refs: moved.map(o => o.id) });
    return moved;
  },
  sendToFitter(id, fitter, by) { return this.sendOrdersToFitter([id], fitter, by)[0]; },

  advanceOrders(ids, by) {
    const now = Date.now();
    const moved = [];
    for (const id of ids) {
      const o = this.order(id);
      if (!o || !canAdvanceOrder(o, by)) continue;
      if (o.status === 'pending' && !o.fitter) continue; // must pick a fitter first
      const from = o.status;
      o.status = nextFitStatus(from);
      o.updatedAt = now;
      o.timeline.push({ at: now, by, text: FIT_STATUS[from].done });
      moved.push(o);
    }
    if (!moved.length) return [];
    const title = moved.length === 1
      ? `${by} · ${moved[0].ref} → ${FIT_STATUS[moved[0].status].label}`
      : `${by} moved ${moved.length} orders forward`;
    commit({ by, module: 'fitting', title, sub: moved.length === 1 ? (moved[0].customer || moved[0].ref) : moved.map(o => o.ref).join(', '), refs: moved.map(o => o.id) });
    return moved;
  },

  setUrgent(id, urgent, by) {
    const o = this.order(id);
    if (!o) return;
    o.urgent = urgent;
    o.updatedAt = Date.now();
    o.timeline.push({ at: o.updatedAt, by, text: urgent ? 'Flagged urgent' : 'Urgent flag removed' });
    commit({ by, module: 'fitting', title: `${by} ${urgent ? 'flagged' : 'unflagged'} ${o.ref} ${urgent ? 'urgent' : ''}`.trim(), refs: [o.id] });
  },

  // ── Stock request mutations ──
  createRequest({ lines, note }, by) {
    const now = Date.now();
    state.seq.req++;
    const units = lines.reduce((s, l) => s + (l.qty || 0), 0);
    const r = {
      id: 'q' + now.toString(36) + Math.random().toString(36).slice(2, 6),
      ref: `SR-${state.seq.req}`, branch: by, status: 'placed', note: note ?? '',
      lines: lines.map((l, i) => ({ id: `l${now.toString(36)}${i}`, ...l })),
      createdAt: now, updatedAt: now,
      timeline: [{ at: now, by, text: `Request placed — ${lines.length} line${lines.length > 1 ? 's' : ''}${units ? `, ${units} units` : ''}${note ? ` — ${note}` : ''}` }],
    };
    state.requests.unshift(r);
    commit({ by, module: 'stock', title: `${by} placed stock request ${r.ref}`, sub: `${lines.length} lines${units ? ` · ${units} units` : ''}`, refs: [r.id] });
    return r;
  },

  // Warehouse marks a placed request done after physically fulfilling it.
  completeRequest(id, by) {
    const r = this.request(id);
    if (!r || r.status !== 'placed') return;
    const now = Date.now();
    r.status = 'completed';
    r.updatedAt = now;
    r.timeline.push({ at: now, by, text: 'Fulfilled and completed at the warehouse' });
    commit({ by, module: 'stock', title: `${by} completed ${r.ref}`, sub: `→ ${locName(r.branch)}`, refs: [r.id] });
  },

  // ── Lens stock (owned by the holding fitting centre) ──
  // Same spec twice means more of the same lens on the shelf, not a second row.
  addLensItem(f, by) {
    const spec = { type: f.type, index: f.index, coating: f.coating, sph: +f.sph, cyl: +f.cyl };
    const qty = Math.max(0, parseInt(f.qty, 10) || 0);
    const now = Date.now();
    const dupe = state.lensStock.find(i =>
      i.type === spec.type && i.index === spec.index && i.coating === spec.coating &&
      i.sph === spec.sph && i.cyl === spec.cyl);
    if (dupe) {
      dupe.qty += qty;
      dupe.updatedAt = now;
      commit({ by, module: 'lens', title: `${by} added ${qty} to existing stock`, sub: lensFull(dupe), refs: [dupe.id] });
      return dupe;
    }
    const item = { id: 'ls' + now.toString(36) + Math.random().toString(36).slice(2, 6), ...spec, qty, updatedAt: now };
    state.lensStock.unshift(item);
    commit({ by, module: 'lens', title: `${by} added lens stock`, sub: `${lensFull(item)} · ${qty} pcs`, refs: [item.id] });
    return item;
  },
  setLensQty(id, qty, by) {
    const i = this.lensItem(id);
    if (!i) return;
    i.qty = Math.max(0, parseInt(qty, 10) || 0);
    i.updatedAt = Date.now();
    commit({ by, module: 'lens', title: `${by} updated lens count`, sub: `${lensFull(i)} → ${i.qty} pcs`, refs: [i.id] });
  },
  removeLensItem(id, by) {
    const i = this.lensItem(id);
    if (!i) return;
    state.lensStock = state.lensStock.filter(x => x.id !== id);
    commit({ by, module: 'lens', title: `${by} removed lens stock`, sub: lensFull(i), refs: [id] });
  },

  // ── Lens requests (branch → holding centre) ──
  createLensRequest({ lines, note }, by) {
    const now = Date.now();
    state.seq.lens++;
    const pcs = lines.reduce((s, l) => s + (l.qty || 0), 0);
    const r = {
      id: 'x' + now.toString(36) + Math.random().toString(36).slice(2, 6),
      ref: `LR-${state.seq.lens}`, branch: by, status: 'requested', note: note ?? '', reason: '',
      lines: lines.map((l, i) => ({ id: `ll${now.toString(36)}${i}`, ...l })),
      createdAt: now, updatedAt: now,
      timeline: [{ at: now, by, text: `Requested ${lines.length} lens type${lines.length > 1 ? 's' : ''}, ${pcs} pcs from ${locName(LENS_OWNER)}${note ? ` — ${note}` : ''}` }],
    };
    state.lensRequests.unshift(r);
    commit({ by, module: 'lens', title: `${by} requested lenses ${r.ref}`, sub: `${lines.length} type${lines.length === 1 ? '' : 's'} · ${pcs} pcs`, refs: [r.id] });
    return r;
  },

  // Confirming ships the lenses, so the shelf count comes down with it. If the
  // shelf moved since the request went in, we send what's actually there.
  confirmLensRequest(id, by) {
    const r = this.lensRequest(id);
    if (!r || r.status !== 'requested') return;
    const now = Date.now();
    const short = [];
    let sent = 0;
    for (const l of r.lines) {
      const item = this.lensItem(l.itemId);
      if (!item) { short.push(`${lensFull(l)} — no longer stocked`); continue; }
      const give = Math.min(item.qty, l.qty);
      if (give < l.qty) short.push(`${lensFull(l)} — ${give} of ${l.qty}`);
      item.qty -= give;
      item.updatedAt = now;
      sent += give;
    }
    r.status = 'confirmed';
    r.updatedAt = now;
    r.timeline.push({ at: now, by, text: `Confirmed — ${sent} pcs deducted from stock and sent to ${locName(r.branch)}` });
    if (short.length) r.timeline.push({ at: now, by, text: `Short on: ${short.join('; ')}` });
    commit({ by, module: 'lens', title: `${by} confirmed ${r.ref}`, sub: `→ ${locName(r.branch)} · ${sent} pcs`, refs: [r.id] });
  },

  declineLensRequest(id, reason, by) {
    const r = this.lensRequest(id);
    if (!r || r.status !== 'requested') return;
    const now = Date.now();
    r.status = 'declined';
    r.reason = (reason || '').trim();
    r.updatedAt = now;
    r.timeline.push({ at: now, by, text: `Declined${r.reason ? ` — ${r.reason}` : ''}` });
    commit({ by, module: 'lens', title: `${by} declined ${r.ref}`, sub: `→ ${locName(r.branch)}`, refs: [r.id] });
  },

  // ── Insurance claim receipts ──
  createClaim(f, by) {
    const now = Date.now();
    state.seq.claim++;
    const c = {
      id: 'c' + now.toString(36) + Math.random().toString(36).slice(2, 6),
      ref: `IC-${state.seq.claim}`,
      date: f.date, branch: f.branch, billNo: f.billNo ?? '', customer: f.customer ?? '',
      items: f.items.map((it, i) => ({ id: `ci${now.toString(36)}${i}`, name: it.name, price: Number(it.price) || 0 })),
      rx: f.rx, payment: f.payment === 'card' ? 'card' : 'cash',
      createdAt: now, updatedAt: now, by,
    };
    state.claims.unshift(c);
    commit({ by, module: 'claims', title: `${by} raised claim ${c.ref}`, sub: c.customer, refs: [c.id] });
    return c;
  },
  updateClaim(id, f, by) {
    const c = this.claim(id);
    if (!c) return;
    const now = Date.now();
    Object.assign(c, {
      date: f.date, branch: f.branch, billNo: f.billNo ?? '', customer: f.customer ?? '',
      items: f.items.map((it, i) => ({ id: it.id ?? `ci${now.toString(36)}${i}`, name: it.name, price: Number(it.price) || 0 })),
      rx: f.rx, payment: f.payment === 'card' ? 'card' : 'cash', updatedAt: now,
    });
    commit({ by, module: 'claims', title: `${by} updated claim ${c.ref}`, sub: c.customer, refs: [c.id] });
    return c;
  },
  removeClaim(id, by) {
    const c = this.claim(id);
    if (!c) return;
    state.claims = state.claims.filter(x => x.id !== id);
    commit({ by, module: 'claims', title: `${by} deleted claim ${c.ref}`, refs: [id] });
  },

  // ── Settings (admin) ──
  // Brand groups. Names are the key categories point at, so a rename has to
  // carry those pointers with it.
  addBrandGroup(name) {
    name = String(name).trim();
    if (!name || state.settings.brandGroups.some(g => g.name.toLowerCase() === name.toLowerCase())) return;
    state.settings.brandGroups.push({ name, brands: [] });
    commit({ module: 'settings', title: `Brand group added: ${name}` });
  },
  renameBrandGroup(oldName, newName) {
    newName = String(newName).trim();
    const g = this.brandGroup(oldName);
    if (!g || !newName || newName === oldName) return;
    if (state.settings.brandGroups.some(x => x !== g && x.name.toLowerCase() === newName.toLowerCase())) return;
    g.name = newName;
    for (const c of state.settings.categories) if (c.brandGroup === oldName) c.brandGroup = newName;
    commit({ module: 'settings', title: `Brand group renamed: ${oldName} → ${newName}` });
  },
  removeBrandGroup(name) {
    state.settings.brandGroups = state.settings.brandGroups.filter(g => g.name !== name);
    // Don't leave categories pointing at something that no longer exists.
    const fallback = state.settings.brandGroups[0]?.name ?? '';
    for (const c of state.settings.categories) if (c.brandGroup === name) c.brandGroup = fallback;
    commit({ module: 'settings', title: `Brand group removed: ${name}` });
  },
  reorderBrandGroups(from, to) {
    const a = state.settings.brandGroups;
    if (from === to || from < 0 || to < 0 || from >= a.length || to >= a.length) return;
    const [x] = a.splice(from, 1);
    a.splice(to, 0, x);
    commit({ module: 'settings', title: 'Brand groups reordered' });
  },

  // Brands, scoped to a group. The same brand may live in several groups, so
  // the duplicate check deliberately only looks inside the target group.
  addBrand(group, name) {
    const g = this.brandGroup(group);
    name = String(name).trim();
    if (!g || !name || g.brands.some(b => b.toLowerCase() === name.toLowerCase())) return;
    g.brands.push(name);
    commit({ module: 'settings', title: `Brand added: ${name}`, sub: group });
  },
  removeBrand(group, name) {
    const g = this.brandGroup(group);
    if (!g) return;
    g.brands = g.brands.filter(b => b !== name);
    commit({ module: 'settings', title: `Brand removed: ${name}`, sub: group });
  },
  // Covers both reordering inside a group and moving between groups. Dropping
  // a brand into a group that already has it just removes it from the source.
  moveBrand(fromGroup, fromIdx, toGroup, toIdx) {
    const src = this.brandGroup(fromGroup);
    const dst = this.brandGroup(toGroup);
    if (!src || !dst || fromIdx < 0 || fromIdx >= src.brands.length) return;
    if (src === dst && toIdx === fromIdx) return;
    const [brand] = src.brands.splice(fromIdx, 1);
    if (src !== dst && dst.brands.includes(brand)) {
      commit({ module: 'settings', title: `Brand removed: ${brand}`, sub: `already in ${toGroup}` });
      return;
    }
    const at = toIdx < 0 || toIdx > dst.brands.length ? dst.brands.length : toIdx;
    dst.brands.splice(at, 0, brand);
    commit({
      module: 'settings',
      title: src === dst ? 'Brands reordered' : `Brand moved: ${brand}`,
      sub: src === dst ? fromGroup : `${fromGroup} → ${toGroup}`,
    });
  },

  addCategory({ name, needsBrand = true, needsAudience = true, needsQty = true, unit = 'pcs', brandGroup }) {
    name = String(name).trim();
    if (!name || state.settings.categories.some(c => c.name.toLowerCase() === name.toLowerCase())) return;
    state.settings.categories.push({
      name, needsBrand, needsAudience, needsQty,
      unit: unit === 'box' ? 'box' : 'pcs',
      brandGroup: brandGroup ?? state.settings.brandGroups[0]?.name ?? '',
    });
    commit({ module: 'settings', title: `Category added: ${name}` });
  },
  updateCategory(name, patch) {
    const c = state.settings.categories.find(c => c.name === name);
    if (!c) return;
    if ('unit' in patch) patch = { ...patch, unit: patch.unit === 'box' ? 'box' : 'pcs' };
    Object.assign(c, patch);
    commit({ module: 'settings', title: `Category updated: ${c.name}` });
  },
  removeCategory(name) {
    state.settings.categories = state.settings.categories.filter(c => c.name !== name);
    commit({ module: 'settings', title: `Category removed: ${name}` });
  },
  reorderCategories(from, to) {
    const a = state.settings.categories;
    if (from === to || from < 0 || to < 0 || from >= a.length || to >= a.length) return;
    const [x] = a.splice(from, 1);
    a.splice(to, 0, x);
    commit({ module: 'settings', title: 'Categories reordered' });
  },
};

// ── Live-activity simulator: the rest of the network keeps working ──────────
// Exactly one tab (the elected leader) runs it; every tab sees the results
// through the sync channel above.
const SIM_NAMES = ['Ibrahim Al Wahaibi', 'Muna Al Saadi', 'Talal Al Busaidi', 'Rahma Al Ghafri', 'Adnan Al Shanfari', 'Shaikha Al Mamari', 'Faisal Al Hadhrami', 'Amal Al Rawahi'];
const SIM_FRAMES = [
  ['Ray-Ban', 'RB3025 Aviator', 'Single vision 1.60 AR'],
  ['Gucci', 'GG1104O', 'Progressive 1.67 blue-cut'],
  ['Persol', 'PO0714 folding', 'Single vision 1.50 tinted'],
  ['Carrera', 'CA273', 'Single vision 1.56 blue-cut'],
  ['Tom Ford', 'FT5634-B', 'Progressive 1.60 AR'],
  ['Silhouette', 'Purist 5561', 'Progressive 1.74 AR'],
];
const rnd = a => a[Math.floor(Math.random() * a.length)];

function isLeader() {
  const now = Date.now();
  let rec = null;
  try { rec = JSON.parse(localStorage.getItem(LEADER_KEY)); } catch { /* ignore */ }
  if (!rec || now - rec.ts > 11000 || rec.id === TAB) {
    localStorage.setItem(LEADER_KEY, JSON.stringify({ id: TAB, ts: now }));
    return true;
  }
  return false;
}

function simTick() {
  if (!isLeader() || Math.random() > 0.5) return;
  const me = store.session?.code;
  const now = Date.now();
  const ops = [];

  // Move fitting orders along — acting as whichever location is naturally
  // next, never as the signed-in location.
  for (const o of state.orders) {
    if (now - o.updatedAt < 100e3) continue;
    if (o.status === 'pending' && !o.fitter) {
      if (o.origin !== me) ops.push(() => store.sendToFitter(o.id, rnd(FITTERS).code, o.origin));
      continue;
    }
    const actor = fitActor(o);
    if (actor && actor !== me) {
      ops.push(() => store.advanceOrders([o.id], actor));
      if (o.urgent) ops.push(() => store.advanceOrders([o.id], actor)); // urgent moves faster
    }
  }
  // Warehouse works its queue (unless the user *is* the warehouse).
  if (me !== 'WH') {
    for (const r of state.requests) {
      if (r.status === 'placed' && now - r.updatedAt > 140e3) ops.push(() => store.completeRequest(r.id, 'WH'));
    }
  }
  // Occasionally, somewhere in the network, a new sale needs fitting.
  const active = state.orders.filter(o => o.status !== 'delivered').length;
  if (active < 18 && Math.random() < 0.35) {
    const origin = rnd(BRANCHES.filter(b => b.code !== me));
    const [brand, model, lens] = rnd(SIM_FRAMES);
    ops.push(() => store.createOrder({
      ref: store.nextBillRef(), origin: origin.code,
      customer: rnd(SIM_NAMES), brand, model, lens,
      urgent: Math.random() < 0.15,
    }, origin.code));
  }
  // The lens holder works its own queue (unless the user *is* the lens holder).
  if (me !== LENS_OWNER) {
    for (const r of state.lensRequests) {
      if (r.status === 'requested' && now - r.updatedAt > 150e3) ops.push(() => store.confirmLensRequest(r.id, LENS_OWNER));
    }
  }
  // …or a branch asks the lens holder for stock it can actually spare.
  const openLens = state.lensRequests.filter(r => r.status === 'requested').length;
  if (openLens < 6 && Math.random() < 0.16) {
    const b = rnd(BRANCHES.filter(x => x.code !== me && x.code !== LENS_OWNER));
    const avail = state.lensStock.filter(i => i.qty > 2);
    if (b && avail.length) {
      const it = rnd(avail);
      const { id, updatedAt, qty, ...spec } = it;
      ops.push(() => store.createLensRequest({
        lines: [{ itemId: it.id, ...spec, qty: 1 + Math.floor(Math.random() * 2) }], note: '',
      }, b.code));
    }
  }
  // …or a branch places a stock request.
  const open = state.requests.filter(r => r.status === 'placed').length;
  if (me !== 'WH' && open < 8 && Math.random() < 0.18) {
    const b = rnd(BRANCHES.filter(x => x.code !== me));
    const cat = rnd(state.settings.categories);
    if (cat) {
      const line = { category: cat.name };
      // An empty brand group just yields a brandless line rather than throwing.
      if (cat.needsBrand) { const brand = rnd(store.brandsFor(cat)); if (brand) line.brand = brand; }
      if (cat.needsAudience) line.audience = rnd(AUDIENCES);
      if (cat.needsQty !== false) {
        line.qty = 4 + Math.floor(Math.random() * 12);
        line.unit = store.unitFor(cat);
      }
      line.note = '';
      ops.push(() => store.createRequest({ lines: [line], note: '' }, b.code));
    }
  }

  if (ops.length) rnd(ops)();
}

let simTimer = null;
export function startSim() {
  if (simTimer) return;
  isLeader();
  simTimer = setInterval(simTick, 13000);
}
export function stopSim() { clearInterval(simTimer); simTimer = null; }
