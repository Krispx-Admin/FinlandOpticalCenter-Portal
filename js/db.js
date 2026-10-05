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
  origin: r.origin_code, fitter: r.fitter_code ?? null,
  customer: r.customer ?? '', phone: r.phone ?? '',
  brand: r.brand ?? '', model: r.model ?? '', lens: r.lens ?? '',
  urgent: !!r.urgent, note: r.note ?? '', status: r.status,
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
    })),
  createdAt: ts(r.created_at), updatedAt: ts(r.updated_at),
  timeline: timeline(r.stock_request_events),
});

const toLensItem = r => ({
  id: r.id, type: r.lens_type, index: r.lens_index, coating: r.coating,
  sph: num(r.sph), cyl: num(r.cyl), qty: r.qty, updatedAt: ts(r.updated_at),
});

const toLensRequest = r => ({
  id: r.id, ref: r.ref, branch: r.branch_code, status: r.status,
  // The form calls this "Bill Number"; the column is the generic `note`.
  billNo: r.note ?? '', reason: r.reason ?? '',
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
    row.ipd = p.ipd ?? '';
  }
  rx.add = { od: r.add_od ?? '', os: r.add_os ?? '' };
  rx.sh = { od: r.sh_od ?? '', os: r.sh_os ?? '' };
  return {
    id: r.id, ref: r.ref, date: r.claim_date, branch: r.branch_code,
    billNo: r.bill_no ?? '', customer: r.customer ?? '',
    items: (r.claim_items ?? []).slice().sort((a, b) => a.position - b.position)
      .map(i => ({ id: i.id, name: i.name, price: num(i.price) })),
    rx: normaliseRx(rx), payment: r.payment,
    createdAt: ts(r.created_at), updatedAt: ts(r.updated_at), by: r.created_by,
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
  return { brandGroups: groups, categories: cats };
}

// ── App → row ───────────────────────────────────────────────────────────────

export const orderRow = (f, by) => ({
  ref: f.ref, origin_code: f.origin ?? by, fitter_code: f.fitter ?? null,
  customer: f.customer ?? '', phone: f.phone ?? '',
  brand: f.brand ?? '', model: f.model ?? '', lens: f.lens ?? '',
  urgent: !!f.urgent, note: f.note ?? '', status: 'pending',
});

export const stockLineRows = (requestId, lines) => lines.map((l, i) => ({
  request_id: requestId, position: i,
  category: l.category, brand: l.brand ?? null, audience: l.audience ?? null,
  qty: l.qty ?? null, unit: l.unit ?? null, note: l.note ?? '',
}));

export const lensLineRows = (requestId, lines) => lines.map(l => ({
  request_id: requestId, stock_id: l.itemId ?? null,
  lens_type: l.type, lens_index: l.index, coating: l.coating,
  sph: l.sph, cyl: l.cyl, qty: l.qty,
}));

export const claimRow = (f, by) => ({
  claim_date: f.date, branch_code: f.branch, bill_no: f.billNo ?? '',
  customer: f.customer ?? '', payment: f.payment === 'card' ? 'card' : 'cash',
  add_od: f.rx?.add?.od ?? '', add_os: f.rx?.add?.os ?? '',
  sh_od: f.rx?.sh?.od ?? '', sh_os: f.rx?.sh?.os ?? '',
  ...(by ? { created_by: by } : {}),
});

export const claimItemRows = (claimId, items) => items.map((it, i) => ({
  claim_id: claimId, position: i, name: it.name, price: num(it.price),
}));

export const claimRxRows = (claimId, rx) => ['d', 'n'].map(line => {
  const row = { claim_id: claimId, line, ipd: rx?.[line]?.ipd ?? '' };
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
};

export const COLLECTIONS = Object.keys(SELECTS);

async function fetchCollection(key) {
  const [table, select, order, map] = SELECTS[key];
  const { data, error } = await supabase.from(table).select(select)
    .order(order.column, { ascending: order.asc });
  if (error) throw new Error(`${table}: ${error.message}`);
  return data.map(map);
}

async function fetchSettings() {
  const { data, error } = await supabase.from('app_settings')
    .select('brand_groups, categories').eq('id', 1).maybeSingle();
  if (error) throw new Error(`settings: ${error.message}`);
  return toSettings(data);
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
  const [settings, ...cols] = await Promise.all([
    fetchSettings(), ...COLLECTIONS.map(fetchCollection),
  ]);
  const out = { settings };
  COLLECTIONS.forEach((k, i) => { out[k] = cols[i]; });
  return out;
}

// Reload named collections only — a write touches one or two, not all six.
export async function reload(keys) {
  const list = [...new Set(keys)].filter(k => k === 'settings' || SELECTS[k]);
  const vals = await Promise.all(list.map(k => (k === 'settings' ? fetchSettings() : fetchCollection(k))));
  return Object.fromEntries(list.map((k, i) => [k, vals[i]]));
}

export async function saveSettings(settings) {
  const { error } = await supabase.from('app_settings').update({
    brand_groups: settings.brandGroups, categories: settings.categories,
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
  app_settings: 'settings',
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

// Collapses the burst of rows a single action produces (parent + lines +
// event) into one reload, and skips work while the tab is in the background.
export function watch(onChange) {
  // Realtime applies the same row level security as a query, which means it
  // needs this branch's token. supabase-js normally hands it over on its own;
  // doing it explicitly removes the ordering question entirely.
  supabase.auth.getSession().then(({ data }) => {
    const token = data?.session?.access_token;
    if (token) supabase.realtime.setAuth(token);
  });

  let pending = new Set();
  let notices = [];
  let timer = null;

  const flush = () => {
    timer = null;
    const keys = [...pending];
    const news = notices;
    pending = new Set();
    notices = [];
    if (keys.length) onChange(keys, news);
  };

  const channel = supabase.channel('focp-live');
  for (const table of Object.keys(TABLE_COLLECTION)) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, payload => {
      pending.add(TABLE_COLLECTION[table]);
      // Lens confirmation deducts stock in the same transaction as the event.
      if (table === 'lens_request_events') pending.add('lensStock');

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

  return () => { clearTimeout(timer); supabase.removeChannel(channel); };
}
