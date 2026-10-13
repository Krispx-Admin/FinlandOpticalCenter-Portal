// ── Static domain data: locations, catalogues, status machines, seed state ──
// Locations carry no credentials: sign-in is handled by Supabase Auth.

// The locations live in the database (public.branches) and are edited in
// Settings › Branches; setLocations() swaps them in at start-up and whenever
// they change. This built-in list is only the fallback for a first paint that
// cannot reach the server — it is not where branches are added.
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
  { code: 'MGM',  name: 'Muscat Grand Mall',  role: 'fitting', holdsLens: true },
  // Clinics (FOC Eye Clinics)
  { code: 'QURFEC', name: 'Qurum FEC',        role: 'clinic' },
  { code: 'SALFEC', name: 'Salalah FEC',      role: 'clinic' },
  { code: 'SOHFEC', name: 'Sohar FEC',        role: 'clinic' },
  { code: 'NIZFEC', name: 'Nizwa FEC',        role: 'clinic' },
  // The office runs the network; Ghiath reads all of it and writes the rota.
  { code: 'OFC',    name: 'Office',           role: 'admin' },
  { code: 'GHIATH', name: 'Ghiath',           role: 'scheduler' },
];

export const ROLES = {
  retail:  { label: 'Retail branch',  hue: 'blue'  },
  fitting: { label: 'Fitting centre', hue: 'teal'  },
  clinic:  { label: 'Clinic',         hue: 'purple' },
  admin:   { label: 'Office · Admin', hue: 'navy' },
  scheduler: { label: 'Schedule editor', hue: 'blue' },
};

export const loc = code => LOCATIONS.find(l => l.code === code);
export const locName = code => loc(code)?.name ?? code;
// The kinds of branch the office can choose between (the office and Ghiath
// are fixed). Closed branches stay in LOCATIONS, so old records keep their
// names, but drop out of FITTERS and BRANCHES — the lists people pick from.
export const BRANCH_KINDS = ['retail', 'fitting', 'clinic'];
const isOpen = l => l.active !== false;
export const FITTERS = LOCATIONS.filter(l => l.role === 'fitting');
export const BRANCHES = LOCATIONS.filter(l => BRANCH_KINDS.includes(l.role));
// The fitting centres that keep loose-lens stock (branches.holds_lens_stock).
export const LENS_HOLDERS = LOCATIONS.filter(l => l.holdsLens);
// Lens Stock always shows this shelf first (user, 2026-10-12); the rest follow
// in branch order. If it ever stops holding stock, the first in order leads.
export const FIRST_SHELF = 'MGM';

// Replace the lists in place: every module imported these arrays, so they keep
// their identity, and an existing location object is updated rather than
// swapped — the signed-in session is one of them and sees its own changes.
export function setLocations(rows) {
  if (!rows?.length) return;
  const next = rows.map(r => Object.assign(LOCATIONS.find(l => l.code === r.code) ?? {}, {
    code: r.code, name: r.name, role: r.role, active: r.active !== false, holdsLens: !!r.holds_lens_stock,
  }));
  LOCATIONS.splice(0, LOCATIONS.length, ...next);
  FITTERS.splice(0, FITTERS.length, ...next.filter(l => isOpen(l) && l.role === 'fitting'));
  BRANCHES.splice(0, BRANCHES.length, ...next.filter(l => isOpen(l) && BRANCH_KINDS.includes(l.role)));
  LENS_HOLDERS.splice(0, LENS_HOLDERS.length, ...next.filter(l => isOpen(l) && l.holdsLens));
}

// Who looks at the whole network. The office runs it; the schedule editor
// reads every module but changes nothing outside the schedule.
export const seesAll = role => role === 'admin' || role === 'scheduler';
export const readOnly = role => role === 'scheduler';
export const canEditSchedule = role => role === 'admin' || role === 'scheduler';

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
// The sidebar tabs the office may switch off for maintenance (Settings).
// Settings itself is never on the list — it is how they are switched back on.
export const TABS = [
  { key: 'fitting',  label: 'Fitting Log',      icon: 'glasses' },
  { key: 'stock',    label: 'Stock Requests',   icon: 'box', note: 'Office Queue for the office' },
  { key: 'lens',     label: 'Lens Stock',       icon: 'lens' },
  { key: 'outside',  label: 'Outside Lens Orders', icon: 'truck' },
  { key: 'claims',   label: 'Reimbursement Invoice', icon: 'receipt' },
  { key: 'direct',   label: 'Direct Insurance', icon: 'shield' },
  { key: 'schedule', label: 'Schedule',         icon: 'calendar' },
];
export const tabOff = (settings, key) => key !== 'settings' && (settings?.disabledTabs ?? []).includes(key);

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
// The lenses arrive at the branch first; the frame goes when the driver comes.
export const FIT_FLOW = ['pending', 'lenses_in', 'to_fitter', 'at_fitter', 'ready', 'returning', 'delivered'];

// The short road. A fitting centre that sells a frame it will glaze itself has
// nothing to put in a van: the frame never leaves the building and the customer
// collects from the same counter. So both road legs drop out, and with them the
// hand-over at each end — there is no arrival to confirm and no delivery back.
// The lenses still have to arrive, so that step stays.
export const SELF_FLOW = ['pending', 'lenses_in', 'at_fitter', 'delivered'];
export const isSelfFit = o => !!o.fitter && o.fitter === o.origin;

// An order already on the road finishes the way it started, even if its fitter
// is its origin — orders logged before the short road existed sit at stages
// SELF_FLOW has no answer for, and the alternative is a button offering to
// send a frame backwards.
export const onShortRoad = o => isSelfFit(o) && SELF_FLOW.includes(o.status);

// The outside road. A frame sent to a 3rd-party cutter goes to someone with no
// account here, so the branch that sent it does every step: it goes, and it
// comes back. The cutter's name is on the order (outside); fitter stays empty.
export const OUT_FLOW = ['pending', 'lenses_in', 'to_fitter', 'delivered'];
export const isOutside = o => !!o.outside;
export const OUTSIDE_DEFAULT = 'Outside cutter';
const OUT_STATUS = {
  to_fitter: { label: 'At outside cutter', color: 'purple', action: 'Received back', actor: 'origin', done: 'Received back from the outside cutter' },
  delivered: { label: 'Delivered',         color: 'done',   action: null,            actor: null,     done: null },
};

export const flowFor = o => (isOutside(o) ? OUT_FLOW : onShortRoad(o) ? SELF_FLOW : FIT_FLOW);

// These labels are the generic ones, for the filter chips, where no single
// order is in view. An order's own words come from fitStep.
//
// The labels say what the job is waiting for: the lenses, then the driver,
// then the road, then the bench. On the road the order names the centre it is heading for (see
// fitStep); the chip keeps the generic word.
export const FIT_STATUS = {
  pending:   { label: 'Waiting for Lenses',   color: 'slate',  action: 'Lenses delivered', actor: 'origin', done: 'Lenses delivered at the branch' },
  lenses_in: { label: 'Lenses Delivered',     color: 'cyan',   action: 'Send to fitter',  actor: 'origin', done: 'Handed to driver — in transit to fitter' },
  to_fitter: { label: 'In transit',           color: 'blue',   action: 'Confirm arrival', actor: 'fitter', done: 'Frame received at fitting centre' },
  at_fitter: { label: 'Waiting to be Fitted', color: 'purple', action: 'Mark ready',      actor: 'fitter', done: 'Lenses fitted — job ready' },
  ready:     { label: 'Ready',                color: 'green',  action: 'Send to branch',  actor: 'fitter', done: 'Handed to driver — returning to branch' },
  returning: { label: 'Returning',            color: 'teal',   action: 'Confirm delivery',actor: 'origin', done: 'Delivered back at origin branch' },
  delivered: { label: 'Delivered',            color: 'done',   action: null,              actor: null,     done: null },
};

// A self-fit order's own vocabulary: nothing is "at the fitter" when the fitter
// is you, and nothing is "delivered" when the customer has yet to walk in.
const SELF_STATUS = {
  // Pending with the fitter already set is a job the lens request opened: the
  // bench is waiting on the lenses, not on anyone choosing where to send it.
  pending:   { label: 'Waiting for Lenses', color: 'slate',  action: 'Lenses delivered', actor: 'fitter', done: 'Lenses delivered at the branch' },
  lenses_in: { label: 'Lenses Delivered',   color: 'cyan',   action: 'Start fitting', actor: 'fitter', done: 'Lenses in — fitting started' },
  at_fitter: { label: 'In fitting',         color: 'purple', action: 'Mark as done',  actor: 'fitter', done: 'Fitting finished — waiting for the customer' },
  delivered: { label: 'Done',               color: 'done',   action: null,            actor: null,     done: null },
};

// ── Outside lens orders (TRIAL, schema-24) ──
// Lenses from outside brands, ordered from the supplier by Mohammed Ashraf at
// MGM, who also cuts them. The order's prescription and lens type travel with
// it; the copy text is the WhatsApp message he sends, in the user's format.
export const OUTSIDE_LENS_HANDLER = 'MGM';
export const OUTSIDE_STATUS = {
  to_order: { label: 'Lenses to order', color: 'amber' },
  ordered:  { label: 'Lenses ordered',  color: 'green' },
};
export const OUTSIDE_FULFILMENT = {
  send_frames:  { label: 'Send the frame', chip: 'Frame goes to MGM' },
  receive_lens: { label: 'Receive the lenses', chip: 'Lenses come to the branch' },
};
// The small tag under the status: where the outside order stands.
export const outsideTag = ol => !ol ? null
  : ol.sentAt ? { text: 'Outside lenses · sent', tone: 'sent' }
  : ol.status === 'ordered' ? { text: 'Outside lenses · ordered', tone: 'ordered' }
  : { text: 'Outside lenses · to order', tone: 'to-order' };
// Lenses a branch is receiving, not yet sent: the job waits on MGM.
export const awaitingOutside = o =>
  !!o.outsideLens && o.status === 'pending' && o.outsideLens.fulfilment === 'receive_lens' && !o.outsideLens.sentAt;
// Finishing the cut waits until the lenses are ordered.
export const outsideBlocked = o => !!o.outsideLens && o.outsideLens.status !== 'ordered' && o.status === 'at_fitter';
export const canSendOutside = (o, code) => awaitingOutside(o) && o.outsideLens.status === 'ordered'
  && (code === OUTSIDE_LENS_HANDLER || loc(code)?.role === 'admin');
// Send the frame ⇄ receive the lenses, while nothing has moved.
export function outsideSwitch(o, code) {
  const ol = o?.outsideLens;
  if (!ol || ol.branch === OUTSIDE_LENS_HANDLER) return null;
  if (!(ol.branch === code || loc(code)?.role === 'admin')) return null;
  if (ol.fulfilment === 'receive_lens' && !ol.sentAt && o.status === 'pending') return 'send_frames';
  if (ol.fulfilment === 'send_frames' && o.status === 'lenses_in' && !o.fitter) return 'receive_lens';
  return null;
}
const rxNum = v => {
  const s = String(v ?? '').trim();
  const n = parseFloat(s);
  return s === '' ? '' : Number.isNaN(n) ? s : `${n > 0 ? '+' : ''}${n.toFixed(2)}`;
};
// "R/ -2.00(-0.75) x 180 | Add: +2.00"
export function outsideRxLine(eye, e = {}) {
  const sph = rxNum(e?.sph), cyl = rxNum(e?.cyl), axis = String(e?.axis ?? '').trim(), add = rxNum(e?.add);
  return `${eye}/ ${sph || '—'}${cyl ? `(${cyl})` : ''}${axis ? ` x ${axis}` : ''} | Add:${add ? ` ${add}` : ''}`;
}
export function outsideCopyText(x, order) {
  return [
    `*${locName(x.branch)}*`,
    `*${order?.ref ?? ''}*`,
    outsideRxLine('R', x.rx?.r),
    outsideRxLine('L', x.rx?.l),
    `*${x.lensType}*`,
  ].join('\n');
}

// Which way round a lens request goes can still be switched by the branch
// that ordered (or the office) until something has moved: to "send the
// frame" while the lenses are not yet marked delivered, to "receive the
// lenses" while the frame has not been sent (schema-22).
export function fulfilmentSwitch(r, o, code) {
  if (!r || !o || r.status === 'declined') return null;
  if (!(r.branch === code || loc(code)?.role === 'admin')) return null;
  if (r.fulfilment === 'receive_lens' && o.status === 'pending') return 'send_frames';
  if (r.fulfilment === 'send_frames' && o.status === 'lenses_in' && o.fitter === r.holder) return 'receive_lens';
  return null;
}

// A branch that asked to receive lenses reads "Waiting for Lenses" from the
// moment it orders (user, 2026-10-12). Until the holder sends them the job is
// the holder's: its Fitting Log shows "Send lenses" (canSendLenses) and the
// branch's row says who it is waiting on; once sent, the branch gets
// "Lenses delivered". The long form (drawer, hover) says which of the two.
const LENS_WAIT = { label: 'Waiting for Lenses', color: 'slate', action: 'Send lenses', actor: 'lens' };
export const awaitingLens = o => o.status === 'pending' && o.lensRequest?.status === 'requested';
export const canSendLenses = (o, code) =>
  awaitingLens(o) && (o.lensRequest.holder === code || loc(code)?.role === 'admin');

// What one order's pill and button say. A frame on the road names the place it
// is heading for rather than the role, so a branch reads where its own frame
// is. `long` spells the place out; the compact form uses the code, which is
// what the journey chips next to it already show.
// `viewer` is the location looking: the holder whose shelf the lenses wait on
// is waiting for the frame, not for lenses.
export function fitStep(o, { long = false, viewer = null } = {}) {
  const base = (isOutside(o) && OUT_STATUS[o.status]) || (onShortRoad(o) && SELF_STATUS[o.status]) || FIT_STATUS[o.status];
  const where = code => (long ? locName(code) : code);
  // An order a lens request opened: lenses to receive wait for the holder to
  // send them, then read plain "Waiting for Lenses" while they travel. Lenses
  // set aside for a frame that goes over wait at the holder for it.
  if (o.status === 'pending' && o.lensRequest) {
    const ans = o.lensRequest.status;
    const from = o.lensRequest.holder;
    if (ans === 'requested') return { ...base, ...LENS_WAIT, ...(long && from ? { label: `Waiting for Lenses — ${locName(from)} to send them` } : {}) };
    if (ans === 'sent' && long && from) return { ...base, label: `Waiting for Lenses — sent by ${locName(from)}` };
    if (ans === 'declined') return { ...base, label: 'Lens Declined', color: 'red' };
  }
  // Outside lenses (schema-25). The status reads "Waiting for Lenses"; how the
  // outside order stands is a separate tag (outsideTag). Receiving: MGM sends
  // them once ordered, then the branch marks them delivered. Sending the
  // frame: it may travel any time; MGM itself reads "Waiting for frame".
  const ol = o.outsideLens;
  if (ol && o.status === 'pending' && ol.fulfilment === 'receive_lens') {
    const h = locName(OUTSIDE_LENS_HANDLER);
    if (!ol.sentAt) return { ...base, label: long ? `Waiting for Lenses — ${h} to ${ol.status === 'ordered' ? 'send' : 'order'} them` : 'Waiting for Lenses',
      color: 'slate', action: ol.status === 'ordered' ? 'Send lenses' : null, actor: 'outside' };
    if (long) return { ...base, label: `Waiting for Lenses — sent by ${h}` };
  }
  // Send the frame (schema-27): "Waiting for Lenses", and Send to fitter lets
  // the branch choose the fitter whenever the frame is ready.
  if (ol && o.status === 'lenses_in' && ol.fulfilment === 'send_frames') {
    return { ...base, label: 'Waiting for Lenses', color: 'slate' };
  }
  if (o.status === 'lenses_in' && o.lensRequest?.fulfilment === 'send_frames' && o.lensRequest.status !== 'declined' && o.fitter) {
    const holder = o.lensRequest.holder ?? o.fitter;
    if (viewer && viewer === holder) return { ...base, label: `Waiting for frame from ${where(o.origin)}` };
    return { ...base, label: `Lenses at ${where(holder)}` };
  }
  if (o.status === 'to_fitter' && isOutside(o)) return { ...base, label: long ? `At ${o.outside} (outside)` : `At ${o.outside}` };
  if (o.status === 'to_fitter' && o.fitter) return { ...base, label: `In transit to ${where(o.fitter)}` };
  if (o.status === 'returning') return { ...base, label: `Returning to ${where(o.origin)}` };
  return base;
}

export const nextFitStatus = o => {
  const f = flowFor(o);
  const i = f.indexOf(o.status);
  return i < 0 ? null : f[i + 1] ?? null;
};

// Which location acts on an order in its current status.
export function fitActor(order) {
  const a = fitStep(order).actor;
  return a === 'origin' ? order.origin : a === 'fitter' ? order.fitter
    : a === 'lens' ? (order.lensRequest?.holder ?? LENS_HOLDERS[0]?.code ?? null)
    : a === 'outside' ? OUTSIDE_LENS_HANDLER : null;
}

// Whether an order is this location's to move now. A self-fit job still
// waiting on its lenses can be started, but it is not asking for anything yet.
// Nor is a frame at an outside cutter: it is waiting on the cutter.
// Sending lenses a branch is waiting for is the holder's to do.
export const needsAction = (o, code) =>
  (canAdvanceOrder(o, code) && !(o.status === 'pending' && isSelfFit(o))
   && !(o.status === 'to_fitter' && isOutside(o)))
  || canSendLenses(o, code) || canSendOutside(o, code);

// ── Stock request state machine ──
// Redesigned: a branch places a request, the office fulfils it. No review.
export const REQ_FLOW = ['placed', 'completed'];
export const REQ_STATUS = {
  placed:    { label: 'Placed',    color: 'blue'  },
  completed: { label: 'Completed', color: 'green' },
};

// ── Lens stock ──────────────────────────────────────────────────────────────
// Fitting centres the office marks as holders (LENS_HOLDERS, from the
// branches table) each keep a shelf of loose lenses and own its count; every
// other location browses a shelf and requests against it. Each shelf row and
// each request names its holder.
// What the shelf may hold. These are only the starting lists: the branch that
// holds the lenses edits them from the shelf's own cog, and they live in the
// database from the first edit on. Falling back to these when the row is empty
// keeps one definition of the defaults.
export const DEFAULT_LENS_TYPES = ['Single vision', 'Bifocal', 'Progressive'];
export const DEFAULT_LENS_INDICES = ['1.50', '1.56', '1.60', '1.67', '1.74'];
export const DEFAULT_LENS_COATINGS = ['None', 'AR', 'Blue-cut', 'Photochromic'];

// "No coating" is a real answer, not a list entry anyone should delete: it is
// what lens_stock.coating defaults to.
export const BARE_COATING = 'None';
export const LOW_LENS_STOCK = 4; // at or below this, flag it as running low

// Asking for lenses is asking for one of two things, and every branch
// chooses; sending the frame is the default. Receiving: a fitting centre cuts
// them itself; a shop or clinic sends the frame and lenses on to a fitter.
export const FULFILMENT = {
  send_frames: {
    label: 'Send the frame',
    sub: 'The lenses wait at their shelf; your frame goes there and is cut on their bench.',
    chip: 'Frame goes over',
  },
  receive_lens: {
    label: 'Receive the lenses',
    sub: 'The lenses are sent here and you cut them yourself — no frame in transit.',
    subShop: 'The lenses are sent here; then you send the frame and the lenses to a fitter.',
    chip: 'Lenses come here',
  },
};
export const canCutOwnLenses = role => role === 'fitting' || role === 'admin';

// The lenses come off the holder's shelf the moment they are asked for. A frame
// going over finds them set aside; lenses to receive wait to be sent.
export const LENSREQ_STATUS = {
  reserved:  { label: 'Set aside',      color: 'blue'  },
  requested: { label: 'Lenses to send', color: 'amber' },
  sent:      { label: 'Sent',           color: 'green' },
  confirmed: { label: 'Confirmed',      color: 'green' },
  declined:  { label: 'Declined',       color: 'red'   },
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
// SPH · CYL · AXIS · V.A., and one Add per eye along the bottom.
//
// IPD and segment height used to sit here too. They were a column and a pair of
// labels wedged between the eyes, and the room they took came out of SPH — the
// one figure nobody can afford to misread. They are not on an insurance claim
// anyway, so the grid is now nine even columns and every power fits.
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
  d: { od: blankEye(), os: blankEye() },
  n: { od: blankEye(), os: blankEye() },
  add: { od: '', os: '' },
});

// Claims written before the grid gained Distance/Near rows carry a flat
// { od, os } shape. Fold those into the Distance row instead of losing them.
export function normaliseRx(rx) {
  // An older claim may still carry ipd and sh alongside these. Nothing reads
  // them any more, and handing them back untouched beats dropping what someone
  // once typed in case the grid ever wants them again.
  if (rx?.d && rx?.n && rx?.add) return rx;
  const out = blankRx();
  if (!rx) return out;
  for (const e of ['od', 'os']) {
    const o = rx[e] ?? {};
    out.d[e].sph = o.sph ?? '';
    out.d[e].cyl = o.cyl ?? '';
    out.d[e].axis = o.axis ?? '';
    out.add[e] = o.add ?? '';
  }
  return out;
}
export const claimTotal = c => (c.items ?? []).reduce((t, i) => t + (Number(i.price) || 0), 0);

// ── Permissions ──
// The holder whose lenses a job is waiting for sees it too.
export function canSeeOrder(o, code) {
  return seesAll(loc(code)?.role) || o.origin === code || o.fitter === code || o.lensRequest?.holder === code
    || (!!o.outsideLens && code === OUTSIDE_LENS_HANDLER);
}
export function canAdvanceOrder(o, code) {
  if (o.status === 'delivered' || awaitingLens(o) || awaitingOutside(o) || outsideBlocked(o)) return false;
  const me = loc(code);
  return me?.role === 'admin' || fitActor(o) === code;
}
export function canSeeRequest(r, code) {
  return seesAll(loc(code)?.role) || r.branch === code;
}
// A branch sees the claims it raised; the office oversees all of them.
export function canSeeClaim(c, code) {
  return seesAll(loc(code)?.role) || c.branch === code;
}
// A holder edits its own shelf and answers the requests made to it; the
// office may look on at all of them.
export const isLensOwner = code => LENS_HOLDERS.some(l => l.code === code);
export function canSeeLensRequest(r, code) {
  return seesAll(loc(code)?.role) || r.branch === code || r.holder === code;
}

