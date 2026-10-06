// ── Static domain data: locations, catalogues, status machines, seed state ──
// Locations carry no credentials: sign-in is handled by Supabase Auth.

export const LOCATIONS = [
  // Retail branches
  { code: 'SCC',  name: 'Seeb City Centre',   role: 'retail' },
  { code: 'AV',   name: 'Avenues Mall',       role: 'retail' },
  { code: 'QCC',  name: 'Qurum City Centre',  role: 'retail' },
  { code: 'SAL',  name: 'Salalah Shop',       role: 'retail' },
  { code: 'SUR',  name: 'Sur',                role: 'retail' },
  // Fitting centres (sell + fit lenses)
  { code: 'MOUJ', name: 'Al Mouj',            role: 'fitting' },
  { code: 'MOO',  name: 'Mall of Oman',       role: 'fitting' },
  { code: 'MGM',  name: 'Muscat Grand Mall',  role: 'fitting' },
  // Clinics (FOC Eye Clinics)
  { code: 'QURFEC', name: 'Qurum FEC',        role: 'clinic' },
  { code: 'SALFEC', name: 'Salalah FEC',      role: 'clinic' },
  { code: 'SOHFEC', name: 'Sohar FEC',        role: 'clinic' },
  { code: 'NIZFEC', name: 'Nizwa FEC',        role: 'clinic' },
  // Warehouse / admin
  { code: 'WH',   name: 'Warehouse (admin)',  role: 'admin' },
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
// The long road: a branch sells the frame, it travels to a fitting centre for
// its lenses, and it travels back to be collected where it was bought.
export const FIT_FLOW = ['pending', 'to_fitter', 'at_fitter', 'ready', 'returning', 'delivered'];

// The short road. A fitting centre that sells a frame it will glaze itself has
// nothing to put in a van: the frame never leaves the building and the customer
// collects from the same counter. So both road legs drop out, and with them the
// hand-over at each end — there is no arrival to confirm and no delivery back.
export const SELF_FLOW = ['pending', 'at_fitter', 'delivered'];
export const isSelfFit = o => !!o.fitter && o.fitter === o.origin;
export const flowFor = o => (isSelfFit(o) ? SELF_FLOW : FIT_FLOW);

// These labels are the generic ones, for the filter chips, where no single
// order is in view. An order's own words come from fitStep.
export const FIT_STATUS = {
  pending:   { label: 'Pending',    color: 'slate',  action: 'Send to fitter',  actor: 'origin', done: 'Handed to driver — in transit to fitter' },
  to_fitter: { label: 'In transit', color: 'blue',   action: 'Confirm arrival', actor: 'fitter', done: 'Frame received at fitting centre' },
  at_fitter: { label: 'At fitter',  color: 'purple', action: 'Mark ready',      actor: 'fitter', done: 'Lenses fitted — job ready' },
  ready:     { label: 'Ready',      color: 'green',  action: 'Send to branch',  actor: 'fitter', done: 'Handed to driver — returning to branch' },
  returning: { label: 'Returning',  color: 'teal',   action: 'Confirm delivery',actor: 'origin', done: 'Delivered back at origin branch' },
  delivered: { label: 'Delivered',  color: 'done',   action: null,              actor: null,     done: null },
};

// A self-fit order's own vocabulary: nothing is "at the fitter" when the fitter
// is you, and nothing is "delivered" when the customer has yet to walk in.
const SELF_STATUS = {
  at_fitter: { label: 'In fitting', color: 'purple', action: 'Mark as done', actor: 'fitter', done: 'Fitting finished — waiting for the customer' },
  delivered: { label: 'Done',       color: 'done',   action: null,           actor: null,     done: null },
};

// What one order's pill and button say. A frame on the road names the place it
// is heading for rather than the role, so a branch reads where its own frame
// is. `long` spells the place out; the compact form uses the code, which is
// what the journey chips next to it already show.
export function fitStep(o, { long = false } = {}) {
  const base = (isSelfFit(o) && SELF_STATUS[o.status]) || FIT_STATUS[o.status];
  const where = code => (long ? locName(code) : code);
  if (o.status === 'to_fitter' && o.fitter) return { ...base, label: `In transit to ${where(o.fitter)}` };
  if (o.status === 'returning') return { ...base, label: `Returning to ${where(o.origin)}` };
  return base;
}

export const nextFitStatus = o => {
  const f = flowFor(o);
  return f[f.indexOf(o.status) + 1] ?? null;
};

// Which location acts on an order in its current status.
export function fitActor(order) {
  const a = fitStep(order).actor;
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

