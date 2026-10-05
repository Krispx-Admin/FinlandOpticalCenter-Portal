// ── Static domain data: locations, catalogues, status machines, seed state ──

export const LOCATIONS = [
  // Retail branches
  { code: 'MOUJ', name: 'Al Mouj',            role: 'retail',  pin: '1234' },
  { code: 'SCC',  name: 'Seeb City Centre',   role: 'retail',  pin: '1234' },
  { code: 'AV',   name: 'Avenues Mall',       role: 'retail',  pin: '1234' },
  { code: 'QCC',  name: 'Qurum City Centre',  role: 'retail',  pin: '1234' },
  { code: 'SLS',  name: 'Salalah Shop',       role: 'retail',  pin: '1234' },
  { code: 'SUR',  name: 'Sur',                role: 'retail',  pin: '1234' },
  // Fitting centres (sell + fit lenses)
  { code: 'MOO',  name: 'Mall of Oman',       role: 'fitting', pin: '1234' },
  { code: 'MGM',  name: 'Muscat Grand Mall',  role: 'fitting', pin: '1234' },
  // Clinics (FOC Eye Clinics)
  { code: 'QURFEC', name: 'Qurum FEC',        role: 'clinic',  pin: '1234' },
  { code: 'SALFEC', name: 'Salalah FEC',      role: 'clinic',  pin: '1234' },
  { code: 'SOHFEC', name: 'Sohar FEC',        role: 'clinic',  pin: '1234' },
  { code: 'NIZFEC', name: 'Nizwa FEC',        role: 'clinic',  pin: '1234' },
  // Warehouse / admin
  { code: 'WH',   name: 'Warehouse (admin)',  role: 'admin',   pin: '9999' },
];

export const ROLES = {
  retail:  { label: 'Retail branch',  hue: 'blue'  },
  fitting: { label: 'Fitting centre', hue: 'teal'  },
  clinic:  { label: 'Clinic',         hue: 'purple' },
  admin:   { label: 'Warehouse · Admin', hue: 'navy' },
};

export const loc = code => LOCATIONS.find(l => l.code === code);
export const locName = code => loc(code)?.name ?? code;
export const FITTERS = LOCATIONS.filter(l => l.role === 'fitting');
export const BRANCHES = LOCATIONS.filter(l => l.role !== 'admin');

// ── Catalogue ──
export const BRANDS = [
  'Ray-Ban', 'Oakley', 'Gucci', 'Prada', 'Tom Ford', 'Persol', 'Versace',
  'Emporio Armani', 'Carrera', 'Police', 'Vogue Eyewear', 'Silhouette',
  'Lindberg', 'Cazal', 'Bausch + Lomb', 'Acuvue', 'FOC House Brand',
];
// Brands live in named groups, and each category draws from one of them — so
// picking "Solutions & drops" never offers a sunglasses brand. Groups are
// independent lists: the same brand may sit in several of them.
export const DEFAULT_BRAND_GROUP = 'All brands';

// Categories carry per-category rules for the request composer: which fields it
// asks for, whether it is counted in pieces or boxes, and its brand group.
export const DEFAULT_CATEGORIES = [
  { name: 'Sunglasses',        needsBrand: true,  needsAudience: true,  needsQty: true, unit: 'pcs' },
  { name: 'Optical frames',    needsBrand: true,  needsAudience: true,  needsQty: true, unit: 'pcs' },
  { name: 'Contact lenses',    needsBrand: true,  needsAudience: false, needsQty: true, unit: 'box' },
  { name: 'Solutions & drops', needsBrand: true,  needsAudience: false, needsQty: true, unit: 'pcs' },
  { name: 'Cleaning kits',     needsBrand: false, needsAudience: false, needsQty: true, unit: 'box' },
  { name: 'Cases & bags',      needsBrand: false, needsAudience: false, needsQty: true, unit: 'pcs' },
  { name: 'Mesh Bags',         needsBrand: false, needsAudience: false, needsQty: true, unit: 'pcs' },
  { name: 'Accessories',       needsBrand: false, needsAudience: false, needsQty: true, unit: 'pcs' },
];
export const AUDIENCES = ['Men', 'Women', 'Unisex', 'Kids'];
export const UNITS = [
  { value: 'pcs', label: 'per piece' },
  { value: 'box', label: 'per box' },
];

// The brands a category may be requested in. Empty when its group was deleted
// or is still being filled — callers treat that as "no brand on this line".
export const brandsFor = (settings, cat) =>
  settings?.brandGroups?.find(g => g.name === cat?.brandGroup)?.brands ?? [];

// ── Fitting pipeline state machine ──
export const FIT_FLOW = ['pending', 'to_fitter', 'at_fitter', 'ready', 'returning', 'delivered'];
export const FIT_STATUS = {
  pending:   { label: 'Pending',                color: 'slate',  action: 'Send to fitter',  actor: 'origin', done: 'Handed to driver — in transit to fitter' },
  to_fitter: { label: 'In transit to fitter',   color: 'blue',   action: 'Confirm arrival', actor: 'fitter', done: 'Frame received at fitting centre' },
  at_fitter: { label: 'At fitter',              color: 'purple', action: 'Mark ready',      actor: 'fitter', done: 'Lenses fitted — job ready' },
  ready:     { label: 'Ready',                  color: 'green',  action: 'Send to branch',  actor: 'fitter', done: 'Handed to driver — returning to branch' },
  returning: { label: 'Returning to branch',    color: 'teal',   action: 'Confirm delivery',actor: 'origin', done: 'Delivered back at origin branch' },
  delivered: { label: 'Delivered',              color: 'done',   action: null,              actor: null,     done: null },
};
export const nextFitStatus = s => FIT_FLOW[FIT_FLOW.indexOf(s) + 1] ?? null;

// Which location acts on an order in its current status.
export function fitActor(order) {
  const a = FIT_STATUS[order.status].actor;
  return a === 'origin' ? order.origin : a === 'fitter' ? order.fitter : null;
}

// ── Stock request state machine ──
// Redesigned: a branch places a request, the warehouse fulfils it. No review.
export const REQ_FLOW = ['placed', 'completed'];
export const REQ_STATUS = {
  placed:    { label: 'Placed',    color: 'blue'  },
  completed: { label: 'Completed', color: 'green' },
};

// ── Lens stock ──────────────────────────────────────────────────────────────
// One fitting centre physically holds the loose-lens stock and owns the shelf
// count; every other location browses it and requests against it.
export const LENS_OWNER = 'MGM';
export const LENS_TYPES = ['Single vision', 'Bifocal', 'Progressive'];
export const LENS_INDICES = ['1.50', '1.56', '1.60', '1.67', '1.74'];
export const LENS_COATINGS = ['None', 'AR', 'Blue-cut', 'Photochromic'];
export const LOW_LENS_STOCK = 4; // at or below this, flag it as running low

// A branch asks, MGM answers. Confirming ships the lenses and draws down stock.
export const LENSREQ_STATUS = {
  requested: { label: 'Awaiting MGM', color: 'amber' },
  confirmed: { label: 'Confirmed',    color: 'green' },
  declined:  { label: 'Declined',     color: 'red'   },
};

// Optical notation: powers always carry an explicit sign, to two decimals.
export const fmtPwr = n => `${Number(n) > 0 ? '+' : ''}${Number(n).toFixed(2)}`;
export const lensLabel = i => `${i.type} ${i.index}${i.coating && i.coating !== 'None' ? ` · ${i.coating}` : ''}`;
export const lensRx = i => `SPH ${fmtPwr(i.sph)} · CYL ${fmtPwr(i.cyl)}`;
export const lensFull = i => `${lensLabel(i)} · ${lensRx(i)}`;

// ── Insurance claim receipts ────────────────────────────────────────────────
// Oman prices carry three decimals (1 rial = 1000 baisa).
export const CURRENCY = 'OMR';
export const money = n => (Number(n) || 0).toFixed(3);

export const PAYMENT_TYPES = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
];

// Prescription grid: Distance / Near rows, OD and OS each carrying
// SPH · CYL · AXIS · V.A., one shared IPD column between the two eyes, and
// Add / S.H. per eye along the bottom.
export const RX_ROWS = [
  { key: 'd', label: 'D', title: 'Distance' },
  { key: 'n', label: 'N', title: 'Near' },
];
export const RX_EYES = [
  { key: 'od', label: 'OD', title: 'Right eye' },
  { key: 'os', label: 'OS', title: 'Left eye' },
];
export const RX_COLS = [
  { key: 'sph', label: 'SPH' },
  { key: 'cyl', label: 'CYL' },
  { key: 'axis', label: 'AXIS' },
  { key: 'va', label: 'V.A.' },
];
const blankEye = () => Object.fromEntries(RX_COLS.map(c => [c.key, '']));
export const blankRx = () => ({
  d: { od: blankEye(), os: blankEye(), ipd: '' },
  n: { od: blankEye(), os: blankEye(), ipd: '' },
  add: { od: '', os: '' },
  sh: { od: '', os: '' },
});

// Claims written before the grid gained Distance/Near rows carry a flat
// { od, os } shape. Fold those into the Distance row instead of losing them.
export function normaliseRx(rx) {
  if (rx?.d && rx?.n && rx?.add && rx?.sh) return rx;
  const out = blankRx();
  if (!rx) return out;
  for (const e of ['od', 'os']) {
    const o = rx[e] ?? {};
    out.d[e].sph = o.sph ?? '';
    out.d[e].cyl = o.cyl ?? '';
    out.d[e].axis = o.axis ?? '';
    out.add[e] = o.add ?? '';
  }
  // The old field was a monocular PD per eye; IPD is the distance across both.
  const pds = ['od', 'os'].map(e => parseFloat(rx[e]?.pd)).filter(n => !Number.isNaN(n));
  out.d.ipd = pds.length === 2 ? String(pds[0] + pds[1]) : pds.length ? String(pds[0]) : '';
  return out;
}
export const claimTotal = c => (c.items ?? []).reduce((t, i) => t + (Number(i.price) || 0), 0);

// ── Permissions ──
export function canSeeOrder(o, code) {
  const me = loc(code);
  return me?.role === 'admin' || o.origin === code || o.fitter === code;
}
export function canAdvanceOrder(o, code) {
  if (o.status === 'delivered') return false;
  const me = loc(code);
  return me?.role === 'admin' || fitActor(o) === code;
}
export function canSeeRequest(r, code) {
  return loc(code)?.role === 'admin' || r.branch === code;
}
// A branch sees the claims it raised; the warehouse oversees all of them.
export function canSeeClaim(c, code) {
  return loc(code)?.role === 'admin' || c.branch === code;
}
// Only the holding branch edits the shelf count; the warehouse may look on.
export const isLensOwner = code => code === LENS_OWNER;
export function canSeeLensRequest(r, code) {
  return isLensOwner(code) || loc(code)?.role === 'admin' || r.branch === code;
}

// ── Seed data ────────────────────────────────────────────────────────────────
const H = 3600e3, M = 60e3;
let _id = 100;
const nid = () => 'r' + (_id++);

function mkOrder(now, { ref, origin, fitter, customer, phone, brand, model, lens, urgent = false, status, ageH, note }) {
  const created = now - ageH * H;
  const idx = FIT_FLOW.indexOf(status);
  const timeline = [{ at: created, by: origin, text: `Order logged at ${locName(origin)}${note ? ` — ${note}` : ''}` }];
  // Space the traversed steps between creation and now.
  const gap = (now - created) / (idx + 1.4);
  for (let i = 0; i < idx; i++) {
    const from = FIT_FLOW[i];
    const by = FIT_STATUS[from].actor === 'origin' ? origin : fitter;
    timeline.push({ at: created + gap * (i + 1), by, text: FIT_STATUS[from].done });
  }
  const last = timeline[timeline.length - 1];
  return { id: nid(), ref, origin, fitter: fitter ?? null, customer: customer ?? '', phone: phone ?? '', brand: brand ?? '', model: model ?? '', lens: lens ?? '', urgent, note: note ?? '',
           status, createdAt: created, updatedAt: last.at, timeline };
}

function mkReq(now, { ref, branch, status, ageH, note, lines }) {
  const created = now - ageH * H;
  const units = lines.reduce((s, l) => s + (l.qty || 0), 0);
  const full = lines.map(l => ({ id: nid(), ...l }));
  const timeline = [{ at: created, by: branch, text: `Request placed — ${lines.length} line${lines.length > 1 ? 's' : ''}${units ? `, ${units} units` : ''}${note ? ` — ${note}` : ''}` }];
  if (status === 'completed') timeline.push({ at: created + (now - created) * 0.6, by: 'WH', text: 'Fulfilled and completed at the warehouse' });
  const last = timeline[timeline.length - 1];
  return { id: nid(), ref, branch, status, note: note ?? '', lines: full,
           createdAt: created, updatedAt: last.at, timeline };
}

// MGM's physical shelf: [type, index, coating, sph, cyl, qty]
const LENS_SEED = [
  ['Single vision', '1.50', 'AR',           -1.00,  0.00, 24],
  ['Single vision', '1.50', 'AR',           -1.50, -0.50, 18],
  ['Single vision', '1.50', 'AR',           -2.00,  0.00, 20],
  ['Single vision', '1.50', 'None',          0.00,  0.00, 30],
  ['Single vision', '1.50', 'Blue-cut',     -1.25, -0.75, 12],
  ['Single vision', '1.56', 'Blue-cut',     -2.50, -0.75,  9],
  ['Single vision', '1.56', 'Blue-cut',      1.50,  0.00, 14],
  ['Single vision', '1.56', 'Photochromic', -3.00, -1.00,  6],
  ['Single vision', '1.60', 'AR',           -3.50,  0.00, 11],
  ['Single vision', '1.60', 'AR',           -4.00, -1.25,  7],
  ['Single vision', '1.60', 'Blue-cut',     -2.75, -0.50,  8],
  ['Single vision', '1.67', 'AR',           -5.50, -1.00,  4],
  ['Single vision', '1.74', 'AR',           -7.00, -1.50,  2],
  ['Bifocal',       '1.56', 'AR',            2.00, -0.50,  6],
  ['Bifocal',       '1.56', 'AR',           -1.75,  0.00,  5],
  ['Progressive',   '1.60', 'AR',           -1.50, -0.50,  8],
  ['Progressive',   '1.60', 'Blue-cut',      2.25,  0.00,  5],
  ['Progressive',   '1.67', 'Blue-cut',     -2.50, -0.75,  3],
  ['Progressive',   '1.67', 'AR',           -4.25, -1.00,  2],
  ['Progressive',   '1.74', 'AR',           -6.00, -1.25,  1],
];

function mkLensStock(now) {
  return LENS_SEED.map(([type, index, coating, sph, cyl, qty], i) => ({
    id: `ls${i}`, type, index, coating, sph, cyl, qty,
    updatedAt: now - (i + 2) * H,
  }));
}

// picks: [stockIndex, qty] against the seeded shelf above
function mkLensReq(now, stock, { ref, branch, status, ageH, note, picks, reason }) {
  const created = now - ageH * H;
  const lines = picks.map(([si, qty], i) => {
    const s = stock[si];
    return { id: `ll${ref}${i}`, itemId: s.id, type: s.type, index: s.index, coating: s.coating, sph: s.sph, cyl: s.cyl, qty };
  });
  const pcs = lines.reduce((s, l) => s + l.qty, 0);
  const timeline = [{ at: created, by: branch, text: `Requested ${lines.length} lens type${lines.length > 1 ? 's' : ''}, ${pcs} pcs from ${locName(LENS_OWNER)}${note ? ` — ${note}` : ''}` }];
  if (status === 'confirmed') timeline.push({ at: created + (now - created) * 0.55, by: LENS_OWNER, text: `Confirmed — ${pcs} pcs deducted from stock and sent to ${locName(branch)}` });
  if (status === 'declined')  timeline.push({ at: created + (now - created) * 0.55, by: LENS_OWNER, text: `Declined${reason ? ` — ${reason}` : ''}` });
  const last = timeline[timeline.length - 1];
  return { id: nid(), ref, branch, status, note: note ?? '', reason: reason ?? '', lines,
           createdAt: created, updatedAt: last.at, timeline };
}

const isoDay = (now, offsetDays) => new Date(now + offsetDays * 864e5).toISOString().slice(0, 10);

// Two worked examples so the receipt can be printed without typing anything.
function mkClaim(now, { ref, date, branch, billNo, customer, items, rx, payment, ageH, by }) {
  const at = now - ageH * H;
  return {
    id: nid(), ref, date, branch, billNo, customer,
    items: items.map((it, i) => ({ id: `ci${ref}${i}`, ...it })),
    rx, payment, createdAt: at, updatedAt: at, by: by ?? branch,
  };
}

export function seedState() {
  const now = Date.now();
  const lensStock = mkLensStock(now);
  return {
    v: 5,
    rev: 1,
    seq: { bill: 58241, req: 1027, lens: 2043, claim: 3042 },
    claims: [
      mkClaim(now, { ref: 'IC-3042', date: isoDay(now, 0), branch: 'MOUJ', billNo: 'B-58209', customer: 'Fatma Al Lawati', ageH: 3, payment: 'card',
        items: [
          { name: 'Tom Ford FT5401 optical frame', price: 145 },
          { name: 'Progressive 1.67 blue-cut lenses (pair)', price: 180 },
        ],
        rx: {
          d: { od: { sph: '-2.25', cyl: '-0.75', axis: '175', va: '6/6' },
               os: { sph: '-2.50', cyl: '-0.50', axis: '10',  va: '6/6' }, ipd: '64.5' },
          n: { od: { sph: '-0.25', cyl: '-0.75', axis: '175', va: 'N5' },
               os: { sph: '-0.50', cyl: '-0.50', axis: '10',  va: 'N5' }, ipd: '62.0' },
          add: { od: '+2.00', os: '+2.00' }, sh: { od: '18', os: '18' } } }),
      mkClaim(now, { ref: 'IC-3041', date: isoDay(now, -2), branch: 'QCC', billNo: 'B-58201', customer: 'Salim Al Harthy', ageH: 50, payment: 'cash',
        items: [
          { name: 'Persol PO3007V frame', price: 98.5 },
          { name: 'Single vision 1.50 photochromic (pair)', price: 65 },
          { name: 'Cleaning kit', price: 4.5 },
        ],
        rx: {
          d: { od: { sph: '-1.00', cyl: '',      axis: '',   va: '6/6' },
               os: { sph: '-1.25', cyl: '-0.25', axis: '90', va: '6/9' }, ipd: '63.0' },
          n: { od: { sph: '', cyl: '', axis: '', va: '' },
               os: { sph: '', cyl: '', axis: '', va: '' }, ipd: '' },
          add: { od: '', os: '' }, sh: { od: '', os: '' } } }),
    ],
    lensStock,
    lensRequests: [
      mkLensReq(now, lensStock, { ref: 'LR-2043', branch: 'SCC', status: 'requested', ageH: 1.5, note: 'Two jobs waiting on these',
        picks: [[8, 2], [15, 1]] }),
      mkLensReq(now, lensStock, { ref: 'LR-2042', branch: 'QCC', status: 'requested', ageH: 4,   note: '',
        picks: [[5, 3], [17, 1]] }),
      mkLensReq(now, lensStock, { ref: 'LR-2041', branch: 'QURFEC', status: 'requested', ageH: 0.4, note: 'Clinic re-cut',
        picks: [[0, 4]] }),
      mkLensReq(now, lensStock, { ref: 'LR-2038', branch: 'MOUJ', status: 'confirmed', ageH: 22,  note: '',
        picks: [[2, 2], [9, 1]] }),
      mkLensReq(now, lensStock, { ref: 'LR-2035', branch: 'AV',   status: 'declined',  ageH: 34,  note: 'Rush job',
        picks: [[19, 3]], reason: 'Only 1 left on the shelf — reorder placed with the lab' }),
    ],
    settings: {
      // Everything starts in one group; the admin splits it by dragging.
      brandGroups: [{ name: DEFAULT_BRAND_GROUP, brands: [...BRANDS] }],
      categories: DEFAULT_CATEGORIES.map(c => ({ ...c, brandGroup: DEFAULT_BRAND_GROUP })),
    },
    orders: [
      mkOrder(now, { ref: 'B-58214', origin: 'SCC',    fitter: null,  customer: 'Ahmed Al Balushi',  phone: '9123 4410', brand: 'Ray-Ban',        model: 'RB5154 Clubmaster', lens: 'Single vision 1.60 AR',        status: 'pending',   ageH: 1.2 }),
      mkOrder(now, { ref: 'B-58209', origin: 'MOUJ',   fitter: 'MGM', customer: 'Fatma Al Lawati',   phone: '9245 7781', brand: 'Tom Ford',        model: 'FT5401',            lens: 'Progressive 1.67 blue-cut',     status: 'to_fitter', ageH: 4,   urgent: true, note: 'Customer travelling Thursday' }),
      mkOrder(now, { ref: 'B-58201', origin: 'QCC',    fitter: 'MOO', customer: 'Salim Al Harthy',   phone: '9954 2210', brand: 'Persol',          model: 'PO3007V',           lens: 'Single vision 1.50 photochromic', status: 'at_fitter', ageH: 9 }),
      mkOrder(now, { ref: 'B-58197', origin: 'AV',     fitter: 'MOO', customer: 'Mariam Al Zadjali', phone: '9812 6604', brand: 'Gucci',           model: 'GG0396O',           lens: 'Progressive 1.60 AR',           status: 'at_fitter', ageH: 12,  urgent: true, note: 'Handle with care — rimless demo pair' }),
      mkOrder(now, { ref: 'B-58190', origin: 'SUR',    fitter: 'MOO', customer: 'Khalid Al Habsi',   phone: '9377 0912', brand: 'Oakley',          model: 'OX8046 Airdrop',    lens: 'Single vision 1.60 blue-cut',   status: 'ready',     ageH: 20 }),
      mkOrder(now, { ref: 'B-58186', origin: 'SCC',    fitter: 'MGM', customer: 'Noor Al Riyami',    phone: '9660 3348', brand: 'Vogue Eyewear',   model: 'VO5406',            lens: 'Single vision 1.50',            status: 'ready',     ageH: 26 }),
      mkOrder(now, { ref: 'B-58180', origin: 'NIZFEC', fitter: 'MGM', customer: 'Said Al Maskari',   phone: '9518 8873', brand: 'Carrera',         model: 'CA8866',            lens: 'Bifocal 1.56',                  status: 'returning', ageH: 30 }),
      mkOrder(now, { ref: 'B-58171', origin: 'SLS',    fitter: 'MOO', customer: 'Aisha Al Farsi',    phone: '9089 1265', brand: 'Prada',           model: 'PR 16MV',           lens: 'Progressive 1.74 AR',           status: 'returning', ageH: 42,  urgent: true }),
      mkOrder(now, { ref: 'B-58164', origin: 'SOHFEC', fitter: 'MOO', customer: 'Hamed Al Abri',     phone: '9430 5522', brand: 'Police',          model: 'VPL697',            lens: 'Single vision 1.60 AR',         status: 'delivered', ageH: 55 }),
      mkOrder(now, { ref: 'B-58158', origin: 'QCC',    fitter: 'MGM', customer: 'Laila Al Kindi',    phone: '9764 4190', brand: 'Silhouette',      model: 'TMA 5515 rimless',  lens: 'Progressive 1.67 AR',           status: 'delivered', ageH: 70 }),
      mkOrder(now, { ref: 'B-58223', origin: 'MGM',    fitter: 'MGM', customer: 'Yousef Al Raisi',   phone: '9201 7738', brand: 'Emporio Armani',  model: 'EA3143',            lens: 'Single vision 1.56 blue-cut',   status: 'at_fitter', ageH: 0.6, note: 'In-house job' }),
      mkOrder(now, { ref: 'B-58175', origin: 'SALFEC', fitter: 'MGM', customer: 'Zainab Al Hinai',   phone: '9633 0847', brand: 'Versace',         model: 'VE3297',            lens: 'Single vision 1.60 photochromic', status: 'to_fitter', ageH: 18 }),
      mkOrder(now, { ref: 'B-58152', origin: 'MOUJ',   fitter: 'MOO', customer: 'Nasser Al Amri',    phone: '9887 2201', brand: 'Lindberg',        model: 'Spirit Titanium',   lens: 'Progressive 1.74 AR',           status: 'delivered', ageH: 96 }),
    ],
    requests: [
      mkReq(now, { ref: 'SR-1018', branch: 'SCC', status: 'placed', ageH: 2, note: 'Summer footfall picking up',
        lines: [
          { brand: 'Ray-Ban', category: 'Sunglasses',     audience: 'Unisex', qty: 12, note: 'Aviator + Wayfarer mix' },
          { brand: 'Oakley',  category: 'Sunglasses',     audience: 'Men',    qty: 6,  note: '' },
          { category: 'Cleaning kits', qty: 5, unit: 'box', note: 'Counter stock' },
        ] }),
      mkReq(now, { ref: 'SR-1021', branch: 'QCC', status: 'placed', ageH: 5, note: '',
        lines: [
          { brand: 'Acuvue', category: 'Contact lenses', qty: 24, unit: 'box', note: 'Oasys 1-Day, mixed powers' },
          { brand: 'Bausch + Lomb', category: 'Solutions & drops', qty: 18, note: '' },
        ] }),
      mkReq(now, { ref: 'SR-1024', branch: 'MOUJ', status: 'placed', ageH: 1, note: 'Weekend promo prep',
        lines: [
          { brand: 'Gucci',  category: 'Sunglasses',     audience: 'Women', qty: 8, note: '' },
          { brand: 'Prada',  category: 'Optical frames', audience: 'Women', qty: 6, note: '' },
          { category: 'Mesh Bags', qty: 20, note: 'Gift packaging' },
        ] }),
      mkReq(now, { ref: 'SR-1026', branch: 'QURFEC', status: 'placed', ageH: 0.5, note: 'Clinic consumables',
        lines: [
          { category: 'Accessories', qty: 40, note: 'Nose pads + screws assortment' },
          { category: 'Cleaning kits', qty: 3, unit: 'box', note: '' },
        ] }),
      mkReq(now, { ref: 'SR-1014', branch: 'SUR', status: 'completed', ageH: 14, note: '',
        lines: [
          { brand: 'Police',  category: 'Sunglasses',     audience: 'Men', qty: 6 },
          { brand: 'Carrera', category: 'Optical frames', audience: 'Men', qty: 8 },
        ] }),
      mkReq(now, { ref: 'SR-1008', branch: 'SALFEC', status: 'completed', ageH: 30, note: 'Low on kids stock',
        lines: [
          { category: 'Cases & bags', qty: 25 },
          { brand: 'Ray-Ban', category: 'Sunglasses', audience: 'Kids', qty: 8 },
        ] }),
      mkReq(now, { ref: 'SR-1004', branch: 'AV', status: 'completed', ageH: 52, note: '',
        lines: [
          { brand: 'Tom Ford', category: 'Sunglasses',     audience: 'Men',   qty: 6 },
          { brand: 'Versace',  category: 'Sunglasses',     audience: 'Women', qty: 6 },
          { brand: 'Acuvue',   category: 'Contact lenses', qty: 12, unit: 'box' },
        ] }),
    ],
  };
}
