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

// A fitting centre's Lab (schema-28, -33): On; In-house only — it cuts its
// own jobs but takes nothing from other branches; or Off — the fitter is on
// leave, nothing at all (until it is turned on, or after a date, if one was set).
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const isLabOff = code => {
  const l = LOCATIONS.find(x => x.code === code);
  return !!l?.benchClosed && (!l.benchUntil || l.benchUntil >= todayISO());
};
export const labMode = code => (isLabOff(code) ? 'off' : LOCATIONS.find(x => x.code === code)?.benchOwnOnly ? 'inhouse' : 'on');
// Takes no work from other branches (Off or In-house only) — what every
// "send it there" check asks.
export const isBenchClosed = code => labMode(code) !== 'on';
export const LAB_MODES = [['on', 'On'], ['inhouse', 'In-house only'], ['off', 'Off']];
export const benchNote = code => {
  if (labMode(code) === 'inhouse') return 'Lab in-house only';
  const until = LOCATIONS.find(x => x.code === code)?.benchUntil;
  return `Lab off${until ? ` until ${new Date(until + 'T00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}` : ''}`;
};

// Replace the lists in place: every module imported these arrays, so they keep
// their identity, and an existing location object is updated rather than
// swapped — the signed-in session is one of them and sees its own changes.
export function setLocations(rows) {
  if (!rows?.length) return;
  const next = rows.map(r => Object.assign(LOCATIONS.find(l => l.code === r.code) ?? {}, {
    code: r.code, name: r.name, role: r.role, active: r.active !== false, holdsLens: !!r.holds_lens_stock,
    benchClosed: !!r.bench_closed, benchUntil: r.bench_closed_until ?? null, benchOwnOnly: !!r.bench_own_only,
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
// …and when it is back, the customer collects it (user, 2026-10-13).
export const FIT_FLOW = ['pending', 'lenses_in', 'to_fitter', 'at_fitter', 'ready', 'returning', 'delivered', 'collected'];
// Back at the branch (or past it): nothing travels any more.
export const isBack = o => o.status === 'delivered' || o.status === 'collected';

// The short road. A fitting centre that sells a frame it will glaze itself has
// nothing to put in a van: the frame never leaves the building and the customer
// collects from the same counter. So both road legs drop out, and with them the
// hand-over at each end — there is no arrival to confirm and no delivery back.
// The lenses still have to arrive, so that step stays.
export const SELF_FLOW = ['pending', 'lenses_in', 'at_fitter', 'delivered', 'collected'];
export const isSelfFit = o => !!o.fitter && o.fitter === o.origin;

// An order already on the road finishes the way it started, even if its fitter
// is its origin — orders logged before the short road existed sit at stages
// SELF_FLOW has no answer for, and the alternative is a button offering to
// send a frame backwards.
export const onShortRoad = o => isSelfFit(o) && SELF_FLOW.includes(o.status);

// The outside road. A frame sent to a 3rd-party cutter goes to someone with no
// account here, so the branch that sent it does every step: it goes, and it
// comes back. The cutter's name is on the order (outside); fitter stays empty.
export const OUT_FLOW = ['pending', 'lenses_in', 'to_fitter', 'delivered', 'collected'];
export const isOutside = o => !!o.outside;
export const OUTSIDE_DEFAULT = 'Outside cutter';
const OUT_STATUS = {
  to_fitter: { label: 'At outside cutter', color: 'purple', action: 'Frame received', actor: 'origin', done: 'Received back from the outside cutter' },
  delivered: { label: 'Ready for collection', color: 'green', action: 'Handed to customer', actor: 'origin', done: 'Handed to the customer — collected' },
  collected: { label: 'Collected',         color: 'done',   action: null,            actor: null,     done: null },
};

export const flowFor = o => (isOutside(o) ? OUT_FLOW : onShortRoad(o) ? SELF_FLOW : FIT_FLOW);

// These labels are the generic ones, for the filter chips, where no single
// order is in view. An order's own words come from fitStep.
//
// The labels say what the job is waiting for: the lenses, then the driver,
// then the road, then the bench. On the road the order names the centre it is heading for (see
// fitStep); the chip keeps the generic word.
export const FIT_STATUS = {
  pending:   { label: 'Waiting for Lenses',   color: 'slate',  action: 'Lens received', actor: 'origin', done: 'Lenses delivered at the branch' },
  lenses_in: { label: 'Lenses Delivered',     color: 'cyan',   action: 'Send to fitter',  actor: 'origin', done: 'Handed to driver — in transit to fitter' },
  to_fitter: { label: 'In transit',           color: 'blue',   action: 'Frame received', actor: 'fitter', done: 'Frame received at fitting centre' },
  at_fitter: { label: 'Waiting to be Fitted', color: 'purple', action: 'Mark ready',      actor: 'fitter', done: 'Lenses fitted — job ready' },
  ready:     { label: 'Ready',                color: 'green',  action: 'Send to branch',  actor: 'fitter', done: 'Handed to driver — returning to branch' },
  returning: { label: 'Returning',            color: 'teal',   action: 'Frame received',  actor: 'origin', done: 'Delivered back at origin branch' },
  delivered: { label: 'Ready for collection', color: 'green',  action: 'Handed to customer', actor: 'origin', done: 'Handed to the customer — collected' },
  collected: { label: 'Collected',            color: 'done',   action: null,              actor: null,     done: null },
};

// A self-fit order's own vocabulary: nothing is "at the fitter" when the fitter
// is you, and nothing is "delivered" when the customer has yet to walk in.
const SELF_STATUS = {
  // Pending with the fitter already set is a job the lens request opened: the
  // bench is waiting on the lenses, not on anyone choosing where to send it.
  pending:   { label: 'Waiting for Lenses', color: 'slate',  action: 'Lens received', actor: 'fitter', done: 'Lenses delivered at the branch' },
  lenses_in: { label: 'Lenses Delivered',   color: 'cyan',   action: 'Start fitting', actor: 'fitter', done: 'Lenses in — fitting started' },
  at_fitter: { label: 'In fitting',         color: 'purple', action: 'Mark as done',  actor: 'fitter', done: 'Fitting finished — waiting for the customer' },
  delivered: { label: 'Ready for collection', color: 'green', action: 'Handed to customer', actor: 'fitter', done: 'Handed to the customer — collected' },
  collected: { label: 'Collected',          color: 'done',   action: null,            actor: null,     done: null },
};

// ── Outside lens orders (TRIAL; schema-24 … 30) ──
// Lenses from outside brands, ordered through WhatsApp by the handler —
// Avenues Mall (app_settings.outside_lens_handler; the store keeps this in
// step). The branch either SENDS ITS FRAME to a fitter it picks — and the
// handler sends the lenses to that same fitter (two legs, one place) — or
// RECEIVES THE LENSES itself. The copy text is the user's WhatsApp format.
export const OUTSIDE = { handler: 'AV' };
export const outsideHandler = () => OUTSIDE.handler;
export const OUTSIDE_STATUS = {
  to_order: { label: 'Lenses to order', color: 'amber' },
  ordered:  { label: 'Lenses ordered',  color: 'green' },
};
export const OUTSIDE_FULFILMENT = {
  send_frames:  { label: 'Send the frame to a fitter', chip: 'Frame and lenses go to a fitter' },
  receive_lens: { label: 'Receive the lenses here', chip: 'Lenses come to the branch' },
};
// Where the outside lenses stand, in words.
export function outsideLensState(ol) {
  if (!ol) return '';
  const H = outsideHandler();
  if (ol.status !== 'ordered') return 'Lenses being ordered';
  if (ol.branch === H) return `Lenses ordered at ${H}`;
  if (!ol.sentAt) return ol.arrivedAt ? `Lenses at ${H}` : `Lenses ordered at ${H}`;
  if (!ol.receivedAt) return `Lenses on the way to ${ol.dest}`;
  return `Lenses at ${ol.dest}`;
}
// Receiving: not yet sent (at the handler itself: not yet ordered).
export const awaitingOutside = o => !!o.outsideLens && o.status === 'pending' && o.outsideLens.fulfilment === 'receive_lens'
  && !o.outsideLens.sentAt && !(o.outsideLens.branch === outsideHandler() && o.outsideLens.status === 'ordered');
// The fitter has the frame but not yet the lenses: it cannot finish the cut.
export const outsideBlocked = o => !!o.outsideLens && o.outsideLens.fulfilment === 'send_frames'
  && !o.outsideLens.receivedAt && o.status === 'at_fitter';
export const canSendOutside = (o, code) => {
  const ol = o.outsideLens, H = outsideHandler();
  return !!ol && ol.status === 'ordered' && !!ol.arrivedAt && !ol.sentAt && ol.branch !== H && !isBack(o)
    && (code === H || loc(code)?.role === 'admin');
};
// The handler marks the lenses in when they reach it from the supplier.
export const canArriveOutside = (o, code) => {
  const ol = o.outsideLens, H = outsideHandler();
  return !!ol && ol.status === 'ordered' && !ol.arrivedAt && ol.branch !== H && !isBack(o)
    && (code === H || loc(code)?.role === 'admin');
};
export const canReceiveOutside = (o, code) => {
  const ol = o.outsideLens;
  return !!ol && ol.fulfilment === 'send_frames' && !!ol.sentAt && !ol.receivedAt
    && (code === ol.dest || loc(code)?.role === 'admin');
};
// The way, or the fitter, can change while nothing has moved.
export function outsideCanChange(o, code) {
  const ol = o?.outsideLens;
  if (!ol || ol.branch === outsideHandler() || ol.sentAt) return false;
  if (!(ol.branch === code || loc(code)?.role === 'admin')) return false;
  return (ol.fulfilment === 'receive_lens' && o.status === 'pending')
    || (ol.fulfilment === 'send_frames' && o.status === 'lenses_in' && o.fitter === ol.dest);
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
// "Lens received". The long form (drawer, hover) says which of the two.
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
    // The holder, once it has sent them, reads where they went.
    if (ans === 'sent' && viewer && viewer === from && o.origin !== from) return { ...base, label: `Lenses sent to ${where(o.origin)}`, color: 'blue', action: null };
    if (ans === 'sent' && long && from) return { ...base, label: `Waiting for Lenses — sent by ${locName(from)}` };
    if (ans === 'declined') return { ...base, label: 'Lens Declined', color: 'red' };
  }
  // Outside lenses (schema-30): each viewer reads its own next step.
  const ol = o.outsideLens;
  if (ol && !isBack(o)) {
    const H = outsideHandler();
    const ordered = ol.status === 'ordered';
    // The handler (Avenues): order the lens, then send it on.
    if (viewer === H && o.origin !== H && !ol.sentAt) return !ordered
      ? { ...base, label: 'Order lens', color: 'amber', action: null, actor: 'outside' }
      : !ol.arrivedAt
        ? { ...base, label: 'Lenses ordered', color: 'green', action: 'Lens received', actor: 'outside' }
        : { ...base, label: 'Lenses Delivered', color: 'cyan', action: `Send lenses to ${ol.dest}`, actor: 'outside' };
    // …and, once sent, watches them on the road until they arrive.
    if (viewer && outsideInTransit(o, viewer))
      return { ...base, label: long ? `Lenses in transit to ${locName(ol.dest)}` : `In transit to ${ol.dest}`, color: 'blue', action: null, actor: null };
    // The fitter has the frame; the lenses are still coming.
    if (ol.fulfilment === 'send_frames' && o.status === 'at_fitter' && !ol.receivedAt)
      return { ...base, label: ol.sentAt ? `Lenses on the way from ${H}` : `Waiting for lenses from ${H}`, color: 'amber', action: null };
    // Receiving at the branch.
    if (ol.fulfilment === 'receive_lens' && o.status === 'pending') {
      if (ol.branch === H) return ordered ? { ...base, label: 'Lenses ordered', color: 'green' } : { ...base, label: 'Order lens', color: 'amber' };
      if (!ol.sentAt) return { ...base, label: long ? `Waiting for Lenses — ${locName(H)} to ${ordered ? 'send' : 'order'} them` : 'Waiting for Lenses',
        color: 'slate', action: null, actor: 'outside' };
      if (long) return { ...base, label: `Waiting for Lenses — sent by ${locName(H)}` };
    }
    // Sending the frame, before it leaves.
    if (ol.fulfilment === 'send_frames' && o.status === 'lenses_in') {
      if (viewer && viewer === o.fitter) return { ...base, label: `Waiting for frame from ${where(o.origin)}` };
      return { ...base, label: outsideLensState(ol), color: ordered ? 'green' : 'amber', action: `Send frame to ${o.fitter}` };
    }
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

// Fixing mistakes (schema-34, user 2026-10-15). The branch that logged an
// order, or the office, edits it — the bill and the name at any stage, the
// outside-lens prescription until the handler confirms it — and deletes it
// while nothing has moved. Undo puts it back one step; the fitting centre on
// the order may undo too. The database checks all of it again.
const isAdminLoc = code => loc(code)?.role === 'admin';
export const canEditOrder = (o, code) => o.origin === code || isAdminLoc(code);
export const canEditOutsideRx = (o, code) => canEditOrder(o, code) && o.outsideLens?.status === 'to_order';
export function canDeleteOrder(o, code) {
  if (!canEditOrder(o, code) || !['pending', 'lenses_in'].includes(o.status)) return false;
  if (o.outsideLens && o.outsideLens.status !== 'to_order') return false;
  return !(o.lensRequest && ['sent', 'confirmed'].includes(o.lensRequest.status));
}
// The step an undo goes back to, or null when there is none.
export function undoTarget(o) {
  const f = flowFor(o), i = f.indexOf(o.status);
  if (i < 1) return null;
  const prev = f[i - 1], lr = o.lensRequest, ol = o.outsideLens;
  if (prev === 'pending') {
    if (lr?.fulfilment === 'send_frames' || ol?.fulfilment === 'send_frames') return null;   // it started with the frame going
    if ((lr && ['sent', 'confirmed'].includes(lr.status)) || (ol && ol.branch !== outsideHandler())) return null;   // lenses came in
  }
  return prev;
}
export const canUndoOrder = (o, code) => !!undoTarget(o) && (o.origin === code || o.fitter === code || isAdminLoc(code));

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
    : a === 'outside' ? outsideHandler() : null;
}

// Whether an order is this location's to move now. A self-fit job still
// waiting on its lenses can be started, but it is not asking for anything yet.
// Nor is a frame at an outside cutter: it is waiting on the cutter.
// Sending lenses a branch is waiting for is the holder's to do.
export const needsAction = (o, code) =>
  (canAdvanceOrder(o, code) && !(o.status === 'pending' && isSelfFit(o))
   && !(o.status === 'to_fitter' && isOutside(o)))
  || canSendLenses(o, code) || canSendOutside(o, code) || canArriveOutside(o, code) || canReceiveOutside(o, code);

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
    sub: 'The lenses are sent here; then cut here or send to a fitter.',
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
// A product is a frame or lenses, with a quantity; the price is per piece
// (schema-35), so a line is price × qty.
export const ITEM_KINDS = { frame: { label: 'Frame', ar: 'إطار', hint: 'e.g. Ray-Ban RB5154' }, lens: { label: 'Lenses', ar: 'عدسات', hint: 'e.g. Essilor 1.6 blue-cut' } };
export const itemQty = i => Math.max(1, parseInt(i.qty, 10) || 1);
export const itemAmount = i => (Number(i.price) || 0) * itemQty(i);
export const claimTotal = c => (c.items ?? []).reduce((t, i) => t + itemAmount(i), 0);
// "2 frames · 2 lenses" — how many of each the invoice covers.
export function itemCounts(items) {
  const n = k => (items ?? []).filter(i => i.kind === k).reduce((t, i) => t + itemQty(i), 0);
  const f = n('frame'), l = n('lens');
  return [f ? `${f} frame${f === 1 ? '' : 's'}` : '', l ? `${l} lens${l === 1 ? '' : 'es'}` : ''].filter(Boolean).join(' · ');
}

// ── Permissions ──
// The holder whose stock lenses a job is waiting for sees it until it has
// sent them — after that, where the job goes is not its concern (user,
// 2026-10-13); the request stays in its Lens Stock tab.
export function canSeeOrder(o, code) {
  return seesAll(loc(code)?.role) || o.origin === code || o.fitter === code
    || o.lensRequest?.holder === code   // the stock holder, for the whole job (user, 2026-10-15)
    || (!!o.outsideLens && code === outsideHandler() && !o.outsideLens.receivedAt);   // the handler, until the lenses arrive
}
// The handler has sent the outside lenses and they have not arrived yet: the
// order sits under its "In transit" chip (user, 2026-10-14).
// For the handler, an outside order from another branch follows the lens,
// not the frame (user, 2026-10-14): Waiting for Lenses until it marks them in,
// Lenses Delivered until it sends them, In transit until they arrive.
// Returns the Fitting Log chip key, or null when the frame's own steps apply.
export function handlerStage(o, code) {
  const ol = o.outsideLens;
  if (!ol || code !== outsideHandler() || o.origin === code || ol.dest === code || ol.receivedAt || isBack(o)) return null;
  return ol.sentAt ? 'to_fitter' : ol.arrivedAt ? 'lenses_in' : 'pending';
}
export const outsideInTransit = (o, code) => handlerStage(o, code) === 'to_fitter';
// Another branch's order that uses this branch's stock lenses.
export const onMyStock = (o, code) => o.lensRequest?.holder === code && o.origin !== code;

// An outside order whose lenses travel from the handler has two roads, and a
// tag for each (user, 2026-10-14): where the frame is, and where the lenses are.
export const twoRoads = o => !!o.outsideLens && o.outsideLens.branch !== outsideHandler();
export function frameStep(o, { long = false, viewer = null } = {}) {
  const s = fitStep({ ...o, outsideLens: null, lensRequest: null }, { long, viewer });
  const where = code => (long ? locName(code) : code);
  if (o.status === 'pending' || o.status === 'lenses_in') {
    if (viewer && o.fitter && viewer === o.fitter && o.fitter !== o.origin) return { ...s, label: `Waiting for frame from ${where(o.origin)}`, color: 'slate' };
    return { ...s, label: `Frame at ${where(o.origin)}`, color: 'slate' };
  }
  return s;
}
export function lensStep(o, { long = false, viewer = null } = {}) {
  const ol = o.outsideLens, H = outsideHandler();
  const where = code => (long ? locName(code) : code);
  if (ol.status !== 'ordered') return { label: viewer === H ? 'Order lens' : 'Lenses being ordered', color: 'amber' };
  if (!ol.arrivedAt) return { label: long ? `Lenses ordered by ${locName(H)}` : 'Lenses ordered', color: 'green' };
  if (!ol.sentAt) return { label: viewer === H ? 'Lenses Delivered' : `Lenses at ${where(H)}`, color: 'cyan' };
  if (!ol.receivedAt) return { label: `In transit to ${where(ol.dest)}`, color: 'blue' };
  return { label: `Lenses at ${where(ol.dest)}`, color: 'green' };
}
export function canAdvanceOrder(o, code) {
  if (o.status === 'collected' || awaitingLens(o) || awaitingOutside(o) || outsideBlocked(o)) return false;
  // A frame cannot be sent to a closed bench.
  if (o.status === 'lenses_in' && o.fitter && o.fitter !== o.origin && isBenchClosed(o.fitter)) return false;
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

