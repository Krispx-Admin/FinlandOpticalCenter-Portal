// ── Postgres data layer ──
//
// The app used to keep everything in localStorage, which meant a request
// placed at Seeb lived in Seeb's browser and nowhere else. Every record now
// lives in Postgres, so the branches are looking at the same data.
//
// This module does three things and nothing else:
//   · translate between database rows and the shapes the modules already read
//   · load each collection
//   · subscribe to realtime so another branch's change arrives here
//
// Column names differ from the field names deliberately: SQL dislikes `type`
// and `index` as identifiers, and `origin`/`fitter` read better in the UI than
// `origin_code`. The mapping is confined to this file so no module has to care.
import { supabase } from './auth.js';
import {
  blankRx, normaliseRx, locName,
  BRANDS, DEFAULT_BRAND_GROUP, DEFAULT_CATEGORIES,
  DEFAULT_LENS_TYPES, DEFAULT_LENS_INDICES, DEFAULT_LENS_COATINGS,
  RX_EYES, RX_COLS,
} from './data.js';

const ts = v => (v ? new Date(v).getTime() : Date.now());
const num = v => Number(v) || 0;
const timeline = rows => (rows ?? [])
  .map(e => ({ at: ts(e.at), by: e.by_code, text: e.text }))
  .sort((a, b) => a.at - b.at);

// ── Row → app ───────────────────────────────────────────────────────────────

const toOrder = r => ({
  id: r.id, ref: r.ref,
  origin: r.origin_code, fitter: r.fitter_code ?? null, outside: r.outside_cutter ?? null,
  customer: r.customer ?? '', phone: r.phone ?? '',
  urgent: !!r.urgent, note: r.note ?? '', status: r.status,
  // Where the customer collects (null = where it was sold), and the frame's
  // road after the fitter (schema-36).
  collect: r.collect_code ?? null, frameAt: r.frame_at ?? null, toCode: r.to_code ?? null, stops: r.stops ?? [],
  createdAt: ts(r.created_at), updatedAt: ts(r.updated_at),
  timeline: timeline(r.order_events),
});

const toRequest = r => ({
  id: r.id, ref: r.ref, branch: r.branch_code, status: r.status, note: r.note ?? '',
  lines: (r.stock_request_lines ?? [])
    .slice().sort((a, b) => a.position - b.position)
    .map(l => ({
      id: l.id, category: l.category,
      ...(l.brand == null ? {} : { brand: l.brand }),
      ...(l.audience == null ? {} : { audience: l.audience }),
      ...(l.qty == null ? {} : { qty: l.qty, unit: l.unit ?? 'pcs' }),
      note: l.note ?? '',
      done: !!l.done_at,   // sent by the office (schema-38)
    })),
  createdAt: ts(r.created_at), updatedAt: ts(r.updated_at),
  timeline: timeline(r.stock_request_events),
});

const toLensItem = r => ({
  id: r.id, holder: r.holder_code ?? null, type: r.lens_type, index: r.lens_index, coating: r.coating,
  sph: num(r.sph), cyl: num(r.cyl), qty: r.qty, updatedAt: ts(r.updated_at),
});

const toLensRequest = r => ({
  id: r.id, ref: r.ref, branch: r.branch_code, holder: r.holder_code ?? null, status: r.status,
  // The form calls this "Bill Number"; the column is the generic `note`.
  billNo: r.note ?? '', reason: r.reason ?? '',
  customer: r.customer ?? '',
  // How the job gets done, and the fitting order opened alongside it.
  fulfilment: r.fulfilment ?? 'send_frames', orderId: r.order_id ?? null,
  lines: (r.lens_request_lines ?? []).map(l => ({
    id: l.id, itemId: l.stock_id, type: l.lens_type, index: l.lens_index,
    coating: l.coating, sph: num(l.sph), cyl: num(l.cyl), qty: l.qty,
  })),
  createdAt: ts(r.created_at), updatedAt: ts(r.updated_at),
  timeline: timeline(r.lens_request_events),
});

function toClaim(r) {
  const rx = blankRx();
  for (const p of r.claim_prescriptions ?? []) {
    const row = rx[p.line];
    if (!row) continue;
    for (const e of RX_EYES) for (const c of RX_COLS) row[e.key][c.key] = p[`${e.key}_${c.key}`] ?? '';
  }
  rx.add = { od: r.add_od ?? '', os: r.add_os ?? '' };
  // ipd, sh_od and sh_os are still columns on older claims. The grid dropped
  // them, so they are read past rather than carried into the app.
  return {
    id: r.id, ref: r.ref, date: r.claim_date, branch: r.branch_code,
    billNo: r.bill_no ?? '', customer: r.customer ?? '',
    memberId: r.member_id ?? '', kind: r.kind ?? 'claim',
    insurer: r.insurer ?? '', employeeId: r.employee_id ?? '', employeeName: r.employee_name ?? '',
    items: (r.claim_items ?? []).slice().sort((a, b) => a.position - b.position)
      .map(i => ({ id: i.id, kind: i.kind ?? '', name: i.name, qty: i.qty ?? 1, price: num(i.price) })),
    rx: normaliseRx(rx), payment: r.payment,
    createdAt: ts(r.created_at), updatedAt: ts(r.updated_at), by: r.created_by,
    // Direct Insurance is canceled, never deleted (schema-47).
    canceledAt: r.canceled_at ? ts(r.canceled_at) : null, canceledBy: r.canceled_by ?? null,
  };
}

// An empty settings row means a fresh project: fall back to the defaults in
// data.js rather than seeding them in SQL, so there is one definition of them.
function toSettings(r) {
  const groups = r?.brand_groups?.length
    ? r.brand_groups
    : [{ name: DEFAULT_BRAND_GROUP, brands: [...BRANDS] }];
  const cats = r?.categories?.length
    ? r.categories
    : DEFAULT_CATEGORIES.map(c => ({ ...c, brandGroup: DEFAULT_BRAND_GROUP }));
  // The insurers Direct Insurance offers (schema-13/-14). `hasInsurers` says
  // the column is there to write back to.
  // The tabs the office switched off (schema-17), likewise.
  return {
    brandGroups: groups, categories: cats, insurers: r?.insurers ?? [], hasInsurers: !!r && 'insurers' in r,
    disabledTabs: r?.disabled_tabs ?? [], hasDisabledTabs: !!r && 'disabled_tabs' in r,
    outsideCutters: r?.outside_cutters ?? [], hasOutsideCutters: !!r && 'outside_cutters' in r,
    outsideLensHandler: r?.outside_lens_handler || 'AV', hasOutsideHandler: !!r && 'outside_lens_handler' in r,
  };
}

// Same bargain as settings: an empty list means nobody has edited it yet, so
// hand back the starting one rather than an empty dropdown.
function toLensCatalogue(r) {
  return {
    types:    r?.types?.length    ? r.types    : [...DEFAULT_LENS_TYPES],
    indices:  r?.indices?.length  ? r.indices  : [...DEFAULT_LENS_INDICES],
    coatings: r?.coatings?.length ? r.coatings : [...DEFAULT_LENS_COATINGS],
  };
}

// Single-row documents, as opposed to the collections above: one row each,
// shared by the whole network, read whole and written whole.
const DOCS = {
  settings:      ['app_settings',   '*', toSettings],
  lensCatalogue: ['lens_catalogue', 'types, indices, coatings', toLensCatalogue],
};

// ── App → row ───────────────────────────────────────────────────────────────

export const orderRow = (f, by) => ({
  ref: f.ref, origin_code: f.origin ?? by, fitter_code: f.fitter ?? null,
  customer: f.customer ?? '', phone: f.phone ?? '',
  urgent: !!f.urgent, note: f.note ?? '', status: 'pending',
  collect_code: f.collect && f.collect !== (f.origin ?? by) ? f.collect : null,
});

export const stockLineRows = (requestId, lines) => lines.map((l, i) => ({
  request_id: requestId, position: i,
  category: l.category, brand: l.brand ?? null, audience: l.audience ?? null,
  qty: l.qty ?? null, unit: l.unit ?? null, note: l.note ?? '',
}));

// Lens request lines are written by create_lens_request, inside the same
// transaction as the request and the fitting order it opens, so there is no
// row-builder for them here.

export const claimRow = (f, by) => ({
  claim_date: f.date, branch_code: f.branch, bill_no: f.billNo ?? '',
  ...(f.memberId ? { member_id: f.memberId } : {}),
  // Direct insurance: the kind, the insurer and the salesperson.
  ...(f.kind === 'direct' ? {
    kind: 'direct', insurer: f.insurer || null,
    employee_id: f.employeeId || null, employee_name: f.employeeName || null,
  } : {}),
  customer: f.customer ?? '', payment: ['card', 'both'].includes(f.payment) ? f.payment : 'cash',
  add_od: f.rx?.add?.od ?? '', add_os: f.rx?.add?.os ?? '',
  ...(by ? { created_by: by } : {}),
});

export const claimItemRows = (claimId, items) => items.map((it, i) => ({
  claim_id: claimId, position: i, name: it.name, price: num(it.price),
  kind: it.kind || null, qty: Math.max(1, parseInt(it.qty, 10) || 1),
}));

export const claimRxRows = (claimId, rx) => ['d', 'n'].map(line => {
  const row = { claim_id: claimId, line };
  for (const e of RX_EYES) for (const c of RX_COLS) {
    row[`${e.key}_${c.key}`] = rx?.[line]?.[e.key]?.[c.key] ?? '';
  }
  return row;
});

export const lensStockRow = f => ({
  lens_type: f.type, lens_index: f.index, coating: f.coating,
  sph: Number(f.sph), cyl: Number(f.cyl),
});

// ── Loading ─────────────────────────────────────────────────────────────────
// Child rows come back embedded in one request per collection rather than as
// a second round trip, and RLS filters them to what this branch may see.

const SELECTS = {
  orders:       ['orders', '*, order_events(*)', { column: 'updated_at', asc: false }, toOrder],
  requests:     ['stock_requests', '*, stock_request_lines(*), stock_request_events(*)', { column: 'created_at', asc: false }, toRequest],
  lensStock:    ['lens_stock', '*', { column: 'updated_at', asc: false }, toLensItem],
  lensRequests: ['lens_requests', '*, lens_request_lines(*), lens_request_events(*)', { column: 'created_at', asc: false }, toLensRequest],
  claims:       ['claims', '*, claim_items(*), claim_prescriptions(*)', { column: 'created_at', asc: false }, toClaim],
  branches:     ['branches', 'code, name, role, active, position, holds_lens_stock, bench_closed, bench_closed_until, bench_own_only, can_export_insurance', { column: 'position', asc: true }, r => r],
  damaged: ['damaged_reports', '*, damaged_lines(*)', { column: 'created_at', asc: false }, r => ({
    id: r.id, ref: r.ref, branch: r.branch_code, note: r.note ?? '', createdAt: ts(r.created_at),
    lines: (r.damaged_lines ?? []).slice().sort((a, b) => a.position - b.position)
      .map(l => ({ name: l.name, barcode: l.barcode ?? '', qty: l.qty })),
  })],
  outsideOrders: ['outside_lens_orders', '*', { column: 'created_at', asc: false }, r => ({
    id: r.id, orderId: r.order_id, branch: r.branch_code, rx: r.rx ?? {}, lensType: r.lens_type ?? '',
    status: r.status, fulfilment: r.fulfilment ?? 'send_frames', sentAt: r.sent_at ? ts(r.sent_at) : null,
    dest: r.dest_code ?? null, arrivedAt: r.arrived_at ? ts(r.arrived_at) : null, receivedAt: r.received_at ? ts(r.received_at) : null, orderedAt: r.ordered_at ? ts(r.ordered_at) : null, orderedBy: r.ordered_by ?? null,
    createdAt: ts(r.created_at), updatedAt: ts(r.updated_at),
  })],
};

export const COLLECTIONS = Object.keys(SELECTS);

// ── Scale (user, 2026-10-16: smooth with 50 people at once) ──
// Finished work older than this stays in the database, not in every browser:
// a sign-in loads what is open plus the last HISTORY_DAYS of finished jobs,
// and "Load older" fetches the rest when someone needs it. Measured on a
// year of synthetic data: the office's load went from 25 MB to 3 MB.
export const HISTORY_DAYS = 45;
const since = () => new Date(Date.now() - HISTORY_DAYS * 864e5).toISOString();
const RECENT = {
  orders:       q => q.or(`status.neq.collected,updated_at.gte.${since()}`),
  requests:     q => q.or(`status.eq.placed,updated_at.gte.${since()}`),
  lensRequests: q => q.or(`status.in.(reserved,requested),updated_at.gte.${since()}`),
};
const OLDER = {
  orders:       q => q.eq('status', 'collected').lt('updated_at', since()),
  requests:     q => q.neq('status', 'placed').lt('updated_at', since()),
  lensRequests: q => q.not('status', 'in', '(reserved,requested)').lt('updated_at', since()),
};
export const hasOlder = key => !!OLDER[key];

async function fetchCollection(key, { older = false } = {}) {
  const [table, select, order, map] = SELECTS[key];
  let q = supabase.from(table).select(select);
  const limit = older ? OLDER[key] : RECENT[key];
  if (limit) q = limit(q);
  const { data, error } = await q.order(order.column, { ascending: order.asc });
  if (error) throw new Error(`${table}: ${error.message}`);
  return data.map(map);
}
// The finished work older than the window, on request.
export const fetchOlder = key => fetchCollection(key, { older: true });

// Just these rows (by id), for a change somebody else made — about 1 KB for
// an order, instead of every order every time. Missing ids are rows this
// location can no longer see, or that were deleted.
export async function fetchRows(key, ids) {
  const [table, select, , map] = SELECTS[key];
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase.from(table).select(select).in('id', ids.slice(i, i + 100));
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data.map(map));
  }
  return out;
}

// Before anyone signs in, for the sign-in screen (readable without a session).
export const fetchBranches = () => fetchCollection('branches');
// The tabs the office switched off — also readable before signing in, so the
// sign-in page can grey out "View schedule" (schema-23).
export async function fetchDisabledTabs() {
  const { data, error } = await supabase.rpc('disabled_tabs');
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

async function fetchDoc(key) {
  const [table, select, map] = DOCS[key];
  const { data, error } = await supabase.from(table).select(select).eq('id', 1).maybeSingle();
  if (error) throw new Error(`${key}: ${error.message}`);
  return map(data);
}

// The portal kept its records in localStorage until this rewrite. Those
// copies are now dead weight holding real customer data in a browser, so
// clear them out the first time a branch loads the new version.
export function forgetLocalCopy() {
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('focp.state')) localStorage.removeItem(k);
    }
  } catch { /* private window, blocked storage — nothing to clear anyway */ }
}

// Everything the signed-in branch can see, in parallel.
export async function loadAll() {
  const docs = Object.keys(DOCS);
  const all = await Promise.all([...docs.map(fetchDoc), ...COLLECTIONS.map(fetchCollection)]);
  const out = {};
  docs.forEach((k, i) => { out[k] = all[i]; });
  COLLECTIONS.forEach((k, i) => { out[k] = all[docs.length + i]; });
  return out;
}

// Reload named collections only — a write touches one or two, not all six.
export async function reload(keys) {
  const list = [...new Set(keys)].filter(k => DOCS[k] || SELECTS[k]);
  const vals = await Promise.all(list.map(k => (DOCS[k] ? fetchDoc(k) : fetchCollection(k))));
  return Object.fromEntries(list.map((k, i) => [k, vals[i]]));
}

export async function saveLensCatalogue(cat) {
  const { error } = await supabase.from('lens_catalogue').update({
    types: cat.types, indices: cat.indices, coatings: cat.coatings,
  }).eq('id', 1);
  if (error) throw new Error(error.message);
}

export async function saveSettings(settings) {
  const { error } = await supabase.from('app_settings').update({
    brand_groups: settings.brandGroups, categories: settings.categories,
    ...(settings.hasInsurers ? { insurers: settings.insurers } : {}),
    ...(settings.hasDisabledTabs ? { disabled_tabs: settings.disabledTabs } : {}),
    ...(settings.hasOutsideCutters ? { outside_cutters: settings.outsideCutters } : {}),
    ...(settings.hasOutsideHandler ? { outside_lens_handler: settings.outsideLensHandler } : {}),
  }).eq('id', 1);
  if (error) throw new Error(error.message);
}

// ── Realtime ────────────────────────────────────────────────────────────────
// Which collections a table feeds. A change anywhere in the group reloads the
// parent collection, because the UI reads parents with their children attached.

const TABLE_COLLECTION = {
  orders: 'orders', order_events: 'orders',
  stock_requests: 'requests', stock_request_lines: 'requests', stock_request_events: 'requests',
  lens_stock: 'lensStock',
  lens_requests: 'lensRequests', lens_request_lines: 'lensRequests', lens_request_events: 'lensRequests',
  // Confirming a request draws the shelf down, so the shelf has to come back too.
  claims: 'claims', claim_items: 'claims', claim_prescriptions: 'claims',
  app_settings: 'settings', lens_catalogue: 'lensCatalogue',
  branches: 'branches',
  outside_lens_orders: 'outsideOrders',
  damaged_reports: 'damaged', damaged_lines: 'damaged',
};

// The *_events tables already hold a human sentence written by whoever acted
// ("Sent to Al Mouj — in transit to fitter"), so a new row in one of them is
// exactly the notification to show. No second description to keep in step.
const EVENT_MODULE = {
  order_events: 'fitting',
  stock_request_events: 'stock',
  lens_request_events: 'lens',
};
const EVENT_PARENT = {
  order_events: 'order_id',
  stock_request_events: 'request_id',
  lens_request_events: 'request_id',
};

// For each table, the collection it belongs to and the column naming the
// row of that collection it changed. Anything not here reloads whole (small:
// settings, the lens lists, branches).
const TABLE_PARENT = {
  orders: ['orders', 'id'], order_events: ['orders', 'order_id'],
  stock_requests: ['requests', 'id'], stock_request_lines: ['requests', 'request_id'], stock_request_events: ['requests', 'request_id'],
  lens_stock: ['lensStock', 'id'],
  lens_requests: ['lensRequests', 'id'], lens_request_lines: ['lensRequests', 'request_id'], lens_request_events: ['lensRequests', 'request_id'],
  claims: ['claims', 'id'], claim_items: ['claims', 'claim_id'], claim_prescriptions: ['claims', 'claim_id'],
  outside_lens_orders: ['outsideOrders', 'id'],
  damaged_reports: ['damaged', 'id'], damaged_lines: ['damaged', 'report_id'],
};

// Collapses the burst of rows a single action produces (parent + lines +
// event) into one refresh of just the rows it touched, and waits while the
// tab is in the background — a screen nobody is looking at does no work.
export function watch(onChange) {
  // Realtime applies the same row level security as a query, which means it
  // needs this branch's token. supabase-js normally hands it over on its own;
  // doing it explicitly removes the ordering question entirely.
  supabase.auth.getSession().then(({ data }) => {
    const token = data?.session?.access_token;
    if (token) supabase.realtime.setAuth(token);
  });

  // full: collections to reload whole; ids: rows to refetch; gone: rows deleted.
  let change = { full: new Set(), ids: new Map(), gone: new Map() };
  let notices = [];
  let timer = null;
  const add = (map, key, id) => { if (!map.has(key)) map.set(key, new Set()); map.get(key).add(id); };

  const flush = () => {
    timer = null;
    if (document.hidden) return;              // picked up when the tab is shown again
    const c = change, news = notices;
    change = { full: new Set(), ids: new Map(), gone: new Map() };
    notices = [];
    // A long time in the background piles up: past a few hundred rows a
    // whole reload is the cheaper way back.
    for (const [k, s] of c.ids) if (s.size > 300) { c.full.add(k); c.ids.delete(k); }
    if (c.full.size || c.ids.size || c.gone.size) onChange(c, news);
  };
  const onVisible = () => { if (!document.hidden) flush(); };
  document.addEventListener('visibilitychange', onVisible);

  const channel = supabase.channel('focp-live');
  for (const table of Object.keys(TABLE_COLLECTION)) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, payload => {
      const parent = TABLE_PARENT[table];
      if (!parent) change.full.add(TABLE_COLLECTION[table]);
      else {
        const [key, col] = parent;
        const row = payload.eventType === 'DELETE' ? payload.old : payload.new;
        const id = row?.[col];
        if (payload.eventType === 'DELETE' && col === 'id' && id) add(change.gone, key, id);
        else if (id) add(change.ids, key, id);
        else change.full.add(key);            // a deleted line names only itself: reload that list
      }
      // Lens confirmation deducts stock in the same transaction as the event.
      if (table === 'lens_request_events') change.full.add('lensStock');

      const mod = EVENT_MODULE[table];
      if (mod && payload.eventType === 'INSERT') {
        const row = payload.new;
        notices.push({
          module: mod,
          by: row.by_code,
          title: `${row.by_code ? `${locName(row.by_code)} · ` : ''}${row.text}`,
          refs: [row[EVENT_PARENT[table]]],
        });
      }
      clearTimeout(timer);
      timer = setTimeout(flush, 220);
    });
  }
  channel.subscribe();

  return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); supabase.removeChannel(channel); };
}
