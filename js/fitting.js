// ── Module 1: Fitting Log — the frame's journey branch → fitter → branch ──
import {
  FIT_FLOW, FIT_STATUS, FITTERS, BRANCHES, FULFILMENT, LENSREQ_STATUS,
  locName, fitStep, fitActor, isSelfFit, onShortRoad, canAdvanceOrder, needsAction, fmtPwr, seesAll, readOnly, canSendLenses, isBack, outsideInTransit, handlerStage, onMyStock, onMyOutside, isLensOwner, twoRoads, frameStep, lensStep, canArriveOutside,
  fulfilmentSwitch,
  isOutside, OUTSIDE_DEFAULT, outsideHandler, OUTSIDE_STATUS, OUTSIDE_FULFILMENT,
  outsideLensState, canSendOutside, canReceiveOutside, outsideBlocked, outsideCanChange, canCutOwnLenses, awaitingOutside,
  isBenchClosed, isLabOff, labMode, LAB_MODES, benchNote,
  canEditOrder, canEditOutsideRx, canDeleteOrder, canUndoOrder, undoTarget,
  collectOf, frameLoc, canChangeCollect, LOCATIONS, LENS_HOLDERS, FIRST_SHELF,
  can,
  isViaHub, atHubCutter, outsideCutHub,
} from './data.js';
import { store } from './store.js';
import { openShelfBrowser } from './lens.js';
import { phoneFieldHTML, wirePhoneFields, phoneValue, splitPhone } from './phone.js';
import { isPractice } from './auth.js';
import { isTablet } from './tablet.js';
import { BILL_ON, billFieldHTML, wireBillFields, billProblem, parseBill, planOrderBill, takePair, fixPairs } from './bill.js';
import { esc, relTime, fmtDT, icons, pill, stepPill, locChip, openLayer, closeLayer, toast, chipCount, olderHTML } from './ui.js';

// How far back to look (user, 2026-10-13): by the day an order was logged —
// on Completed, by the day it was completed. 0 = any time.
const DAY_FILTERS = [0, 1, 3, 7, 14, 30];

// The tabs are named for what is done next — the action — not for the
// order's tag: an order whose tag reads "Lenses Delivered" sits under "Send to
// Fitter". Where nothing is pressed, the tab says where the frame is
// (user, 2026-10-15). A chip's key is its status.
const CHIP_LABELS = {
  pending: 'Waiting for Lenses', lenses_in: 'Send to Fitting', to_fitter: 'In Transit to Fitting',
  at_fitter: 'In Fitting', ready: 'Ready', returning: 'In Transit to Branch', delivered: 'Ready for Collection',
};
// Outside cutting through the hub (schema-62) — tried in the Admin Demo first.
// Still the Admin Demo only (user 2026-10-22: not live yet).
const OUT_HUB_ON = isPractice;
const CHIP_DEFS = [{ key: 'active', label: 'All active' }];
for (const s of FIT_FLOW.filter(s => s !== 'collected')) CHIP_DEFS.push({ key: s, label: CHIP_LABELS[s], statuses: [s] });
// A frame at an outside cutter has its own tab, not "In Transit to Fitting".
CHIP_DEFS.find(d => d.key === 'to_fitter').test = o => o.status === 'to_fitter' && !isOutside(o);
CHIP_DEFS.push({ key: 'outside', label: 'Outside Cutter', statuses: ['to_fitter', 'at_fitter'], test: o => (o.status === 'to_fitter' && isOutside(o)) || atHubCutter(o) });
// …and so is one the hub sent out (schema-62), not "In Fitting".
CHIP_DEFS.find(d => d.key === 'at_fitter').test = o => o.status === 'at_fitter' && !atHubCutter(o);
// Every order that uses this branch's stock lenses — only a branch holding
// lens stock has this tab (user, 2026-10-15). Matched in the view (chipHas).
CHIP_DEFS.push({ key: 'stock', label: 'Stock Lens', statuses: [], holders: true, test: () => false });
// Every other branch's order with outside lenses — only the branch that orders
// them (Avenues) has this tab (user, 2026-10-16). Matched in the view.
CHIP_DEFS.push({ key: 'olorders', label: 'Outside Lens Orders', statuses: [], handler: true, test: () => false });
CHIP_DEFS.push({ key: 'collected', label: 'Completed', statuses: ['collected'] });
const onChip = (d, o) => (d.test ? d.test(o) : d.statuses.includes(o.status));

// Orders a lens request opened wear this under their journey, and in the list
// subtitle when the journey column is hidden on a narrow screen. Under the
// journey it hangs below the middle pin rather than taking room, so the
// journey stays centred in the row like every other.
const stockTag = (cls = '') => `<span class="stock-tag ${cls}">Stock Lens</span>`;
// The same marker for an order whose lenses come from an outside supplier.
const outsideLensTag = (cls = '') => `<span class="stock-tag outside-tag ${cls}">Outside Lens</span>`;


const READY_IDX = FIT_FLOW.indexOf('ready');

export function fittingView(me) {
  const ui = {
    chip: 'active', q: '', days: 0,
    branch: 'all',                          // a branch: the branch it shares orders with
    origin: 'all', fitter: 'all',           // admin-only filters
    selected: new Set(),
    step: null,                             // the lens step open inside Stock Lens / Outside Lens Orders
    seen: new Set(store.state.orders.map(o => o.id)),
    prevStatus: new Map(store.state.orders.map(o => [o.id, o.status])),
  };
  let root, drawer = null, drawerId = null;
  let shelfView = null; // the Lens stock window, while open
  // The office and the schedule editor see every frame; only the office acts.
  const isAdmin = seesAll(me);
  const viewOnly = readOnly(me);

  // ── data ──
  // Everything the toolbar narrows by — the chips' counts follow it too.
  function filtered() {
    let list = store.ordersFor(me.code);
    if (ui.days) {
      const from = Date.now() - ui.days * 864e5;
      list = list.filter(o => (o.status === 'collected' ? o.updatedAt : o.createdAt) >= from);
    }
    if (!isAdmin && ui.branch !== 'all') list = list.filter(o => o.origin === ui.branch || o.fitter === ui.branch);
    if (isAdmin && ui.origin !== 'all') list = list.filter(o => o.origin === ui.origin);
    if (isAdmin && ui.fitter === 'OUT') list = list.filter(isOutside);
    else if (isAdmin && ui.fitter !== 'all') list = list.filter(o => o.fitter === ui.fitter);
    if (ui.q) {
      const q = ui.q.toLowerCase();
      list = list.filter(o => [o.ref, o.customer, o.origin, o.fitter, o.outside ?? '', locName(o.origin), o.fitter ? locName(o.fitter) : '']
        .some(v => String(v).toLowerCase().includes(q)));
    }
    return list;
  }
  // For the handler, another branch's outside order sits under the lens's
  // step (Waiting for Lenses / Lenses Delivered / In transit), not the frame's.
  // Orders this location only supplies lenses for — the frame is not its:
  // they live under Stock Lens / Outside Lens Orders for the whole job (and
  // Completed, once collected), not in the frame tabs.
  const lensOnly = o => (onMyStock(o, me.code) || onMyOutside(o, me.code)) && o.fitter !== me.code && collectOf(o) !== me.code;
  // A lens still to order, for the handler (Avenues) — its own orders too.
  const toOrder = o => !!o.outsideLens && me.code === outsideHandler() && o.outsideLens.status !== 'ordered' && !isBack(o);
  // The two lens tabs hold every job of theirs, start to finish (user,
  // 2026-10-18): Stock Lens — another branch's job on this branch's shelf;
  // Outside Lens Orders — another branch's outside lenses (and Avenues' own
  // still to order). Those jobs leave the frame tabs; inside, smaller tabs
  // follow the lens's road, next to Select all.
  const inStockTab = o => onMyStock(o, me.code);
  const inOutsideTab = o => onMyOutside(o, me.code) || (toOrder(o) && o.origin === me.code);
  const fitHere = o => o.fitter === me.code;
  // Shown in this order (user, 2026-10-18): All | the frame's steps | the
  // lenses' steps | Done — `bar` starts a new group. `rank` is the order the
  // tests are tried in: an order sits in the first step that fits it.
  const STOCK_STEPS = [
    { key: 'all',     label: 'All' },
    { key: 'coming',  label: 'Frame Coming',   bar: true, rank: 2, test: o => fitHere(o) && ['pending', 'lenses_in', 'to_fitter'].includes(o.status) },
    { key: 'fitting', label: 'In Fitting',     rank: 3, test: o => fitHere(o) && o.status === 'at_fitter' },
    { key: 'ready',   label: 'Ready',          rank: 4, test: o => o.status === 'ready' && frameLoc(o) === me.code },
    { key: 'send',    label: 'Send Lenses',    bar: true, rank: 1, test: o => o.lensRequest?.status === 'requested' },
    { key: 'sent',    label: 'Lenses Sent',    rank: 5, test: o => o.lensRequest?.status === 'sent' && o.status === 'pending' },
    { key: 'done',    label: 'Done',           bar: true, rank: 9, test: () => true },
  ];
  const OUTSIDE_STEPS = [
    { key: 'all',      label: 'All' },
    { key: 'order',    label: 'Order Lens',            bar: true, rank: 1, test: o => toOrder(o) },
    { key: 'supplier', label: 'Waiting from Supplier', rank: 2, test: o => o.outsideLens?.status === 'ordered' && !o.outsideLens.arrivedAt && !isBack(o) },
    { key: 'send',     label: 'Send Lenses',           rank: 3, test: o => !!o.outsideLens?.arrivedAt && !o.outsideLens.sentAt && !isBack(o) },
    { key: 'way',      label: 'On the Way',            rank: 4, test: o => outsideInTransit(o, me.code) },
    { key: 'done',     label: 'Done',                  bar: true, rank: 9, test: () => true },
  ];
  const stepsOf = key => (key === 'stock' ? STOCK_STEPS : key === 'olorders' ? OUTSIDE_STEPS : null);
  const stepOf = (steps, o) => steps.filter(s => s.test).sort((a, b) => a.rank - b.rank).find(s => s.test(o))?.key;
  const chipHas = (d, o) => {
    if (d.key === 'stock') return inStockTab(o);
    if (d.key === 'olorders') return inOutsideTab(o);
    if (inStockTab(o) || (inOutsideTab(o) && o.origin !== me.code)) return false;
    return onChip(d, o);
  };
  function visible() {
    let list = filtered();
    if (ui.chip === 'active') list = list.filter(o => o.status !== 'collected');
    else {
      const chip = CHIP_DEFS.find(d => d.key === ui.chip);
      list = list.filter(o => chip && chipHas(chip, o));
      const steps = stepsOf(ui.chip);
      if (steps && ui.step && ui.step !== 'all') list = list.filter(o => stepOf(steps, o) === ui.step);
    }
    return list.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  // The lens's own step for this location, ahead of any frame step.
  const lensAct = o => (viewOnly ? null
    : canSendLenses(o, me.code) ? 'Send Lenses'
    : toOrder(o) ? 'Confirm Order'
    : canArriveOutside(o, me.code) ? 'Lens Received'
    : canSendOutside(o, me.code) ? `Send Lenses to ${o.outsideLens.dest}` : null);
  // Opening a lens tab starts on All.
  function pickStep() { ui.step = stepsOf(ui.chip) ? 'all' : null; }
  function stepsHTML() {
    const steps = stepsOf(ui.chip);
    if (!steps) return '';
    const chip = CHIP_DEFS.find(d => d.key === ui.chip);
    const list = filtered().filter(o => chipHas(chip, o));
    return `<div class="chips step-chips" role="tablist" aria-label="${esc(chip.label)} steps">${steps.map(s => {
      const inIt = s.key === 'all' ? list.filter(o => o.status !== 'collected') : list.filter(o => stepOf(steps, o) === s.key);
      const act = s.key === 'done' ? 0 : inIt.filter(o => actionOf(o)).length;
      return `${s.bar ? '<span class="chip-sep"></span>' : ''}<button class="chip ${ui.step === s.key ? 'on' : ''}" data-step="${s.key}" role="tab">${esc(s.label)}${chipCount(inIt.length, act)}</button>`;
    }).join('')}</div>`;
  }
  // The other branches this one shares orders with, for its branch filter.
  const partnerBranches = () => [...new Set(store.ordersFor(me.code)
    .flatMap(o => [o.origin, o.fitter]).filter(c => c && c !== me.code))]
    .sort((a, b) => locName(a).localeCompare(locName(b)));
  const counts = () => {
    const all = filtered();
    const c = { active: all.filter(o => o.status !== 'collected').length };
    for (const d of CHIP_DEFS.slice(1)) c[d.key] = all.filter(o => chipHas(d, o)).length;
    return c;
  };

  // ── where the customer collects (schema-36) ──
  // Branches only — the office, Ghiath, Wijdan and Sarah are people, not places.
  const collectBranches = () => BRANCHES;
  const collectOptions = pick => collectBranches().map(l => `<option value="${l.code}" ${l.code === pick ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
  function collectModal(id) {
    const o = store.order(id);
    if (!o) return;
    const C = collectOf(o);
    const where = o.status === 'returning' ? `It is on its way to ${locName(o.toCode ?? C)} — it gets there first, then that branch transfers it.`
      : o.status === 'delivered' || (o.status === 'ready' && frameLoc(o) !== o.fitter) ? `It is at ${locName(o.status === 'delivered' ? (o.frameAt ?? C) : frameLoc(o))} — that branch will transfer it.`
      : 'The frame goes there after fitting.';
    const layer = openLayer('modal', () => `
      <div class="dw-head">
        <div><div class="dw-kicker">${esc(o.ref)} · ${esc(o.customer || '')}</div><h2>Where does the customer collect?</h2></div>
        <button class="icon-btn" data-close>${icons.x}</button>
      </div>
      <form class="form" id="co">
        <label>Collect at <select name="collect">${collectOptions(C)}</select></label>
        <p class="muted sm">${esc(where)}</p>
        <div class="form-foot">
          <button type="button" class="btn btn-ghost" data-close>Cancel</button>
          <button type="submit" class="btn btn-primary">${icons.check} Save</button>
        </div>
      </form>`);
    layer.el.addEventListener('click', e => { if (e.target.closest('[data-close]')) layer.close(); });
    layer.el.querySelector('#co').addEventListener('submit', async e => {
      e.preventDefault();
      const to = new FormData(e.target).get('collect');
      if (to === C) return layer.close();
      if (await store.setCollect(id, to, me.code)) layer.close();
    });
  }

  // ── WhatsApp the customer (user 2026-10-18; tried in the practice copy, then live) ──
  // When the frame is ready at the branch the customer collects from, one
  // click opens WhatsApp on this computer with the customer's number and the
  // message typed; staff press Send. WhatsApp lets no website send by itself.
  const waOn = o => !viewOnly && o.status === 'delivered' && collectOf(o) === me.code;
  // 8 digits is an Omani number: 968 goes in front. "+", "00", spaces go.
  const waNumber = s => {
    let d = String(s ?? '').replace(/\D/g, '').replace(/^00/, '');
    if (d.length === 8) d = `968${d}`;
    return d.length >= 9 ? d : null;
  };
  // The message: English, then Arabic (user, 2026-10-18), with the branch's
  // opening hours as the schedule has them this week — they change with the
  // season — days with the same hours run together ("Sat – Wed").
  const WEEK = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const DAY_AR = { Sat: 'السبت', Sun: 'الأحد', Mon: 'الإثنين', Tue: 'الثلاثاء', Wed: 'الأربعاء', Thu: 'الخميس', Fri: 'الجمعة' };
  const clock = (h, ar) => {
    const n = Number(h) || 0, mins = Math.round((n % 1) * 60), hr = Math.floor(n) % 24;
    const mm = mins ? `:${String(mins).padStart(2, '0')}` : '';
    if (hr === 0 && !mins) return ar ? '12 منتصف الليل' : '12 midnight';
    if (hr === 12 && !mins) return ar ? '12 ظهراً' : '12 noon';
    const h12 = hr % 12 || 12;
    return ar ? `${h12}${mm} ${hr < 12 ? 'صباحاً' : 'مساءً'}` : `${h12}${mm} ${hr < 12 ? 'AM' : 'PM'}`;
  };
  function hoursLines(days, ar) {
    if (!days) return [];
    const runs = [];
    for (const d of WEEK) {
      const x = days[d];
      if (!x) continue;
      const key = x.closed ? 'closed' : `${x.open}-${x.close}`;
      const last = runs.at(-1);
      if (last && last.key === key && WEEK.indexOf(last.to) === WEEK.indexOf(d) - 1) last.to = d;
      else runs.push({ key, from: d, to: d, x });
    }
    const name = d => (ar ? DAY_AR[d] : d);
    return runs.map(r => `${name(r.from)}${r.to !== r.from ? ` – ${name(r.to)}` : ''}: ${r.x.closed ? (ar ? 'مغلق' : 'Closed') : `${clock(r.x.open, ar)} – ${clock(r.x.close, ar)}`}`);
  }
  const waText = (o, days) => {
    const name = o.customer || '';
    const branch = locName(collectOf(o));
    // The Arabic half names the branch in Arabic (Settings → Accounts).
    const branchAr = LOCATIONS.find(l => l.code === collectOf(o))?.nameAr || branch;
    const en = [
      `Hello${name ? ` *${name}*` : ''},`,
      'Your glasses are ready for collection at:',
      `*Finland Optical Center – ${branch}*`,
      ...(days ? ['', '*Opening hours*', ...hoursLines(days, false)] : []),
      '',
      'We look forward to seeing you!',
    ];
    const ar = [
      `مرحباً${name ? ` *${name}*` : ''}،`,
      'نظارتك جاهزة للاستلام من:',
      `*المركز الفنلندي للبصريات – ${branchAr}*`,
      ...(days ? ['', '*أوقات العمل*', ...hoursLines(days, true)] : []),
      '',
      'بانتظار زيارتك!',
    ];
    return [...en, '', '—', '', ...ar].join('\n');
  };
  const waBtn = (o, big = false) => (waOn(o)
    ? `<button class="btn btn-ghost ${big ? '' : 'btn-sm'} wa-btn" data-wa="${o.id}" title="Message the customer on WhatsApp — it opens with the message ready; press Send there" aria-label="Message the customer on WhatsApp">${icons.whatsapp}</button>` : '');
  async function messageCustomer(id) {
    const o = store.order(id);
    if (!o) return;
    let num = waNumber(o.phone);
    if (!num) {
      num = await askPhone(o);
      if (!num) return;
      await store.setOrderPhone(id, num, me.code);
    }
    const days = await store.branchHours(collectOf(o));
    location.href = `whatsapp://send?phone=${num}&text=${encodeURIComponent(waText(store.order(id) ?? o, days))}`;
  }

  // The customer's number, when the order has none: country (Oman unless
  // changed) and number, then WhatsApp opens.
  function askPhone(o) {
    return new Promise(done => {
      let answered = false;
      const finish = v => { if (!answered) { answered = true; done(v); } };
      const layer = openLayer('modal', () => `
        <div class="dw-head">
          <div><div class="dw-kicker">${esc(o.ref)} · ${esc(o.customer || '')}</div><h2>Customer's WhatsApp number</h2></div>
          <button class="icon-btn" data-close>${icons.x}</button>
        </div>
        <form class="form" id="ph-ask" autocomplete="off">
          <div class="ph-label"><span>Phone</span>${phoneFieldHTML()}</div>
          <div class="form-foot">
            <button type="button" class="btn btn-ghost" data-close>Cancel</button>
            <button type="submit" class="btn btn-primary wa-go">${icons.whatsapp} Save and open WhatsApp</button>
          </div>
        </form>`, { onClose: () => finish(null) });
      wirePhoneFields(layer.el);
      layer.el.querySelector('input[inputmode=tel]')?.focus();
      layer.el.addEventListener('click', e => { if (e.target.closest('[data-close]')) layer.close(); });
      layer.el.addEventListener('submit', e => {
        e.preventDefault();
        const v = phoneValue(layer.el.querySelector('[data-ph]'));
        if (!v) { toast({ title: 'That number does not look right', sub: 'Type the number — the country is picked on its left.', tone: 'stock' }); return; }
        finish(v);
        layer.close();
      });
    });
  }

  // ── fixing mistakes: edit, undo the last step, delete (schema-34) ──
  function toolsHTML(o) {
    const edit = canEditOrder(o, me.code), undo = canUndoOrder(o, me.code), del = canDeleteOrder(o, me.code);
    if (!edit && !undo && !del) return '';
    return `<div class="dw-tools">
      ${edit ? `<button class="btn btn-ghost btn-sm" data-edit-order="${o.id}">${icons.wrench} Edit</button>` : ''}
      ${undo ? `<button class="btn btn-ghost btn-sm" data-undo-order="${o.id}">${icons.history} Undo last step</button>` : ''}
      ${del ? `<button class="btn btn-ghost btn-sm btn-danger-text" data-delete-order="${o.id}">${icons.trash} Delete</button>` : ''}
    </div>`;
  }
  const stepName = (o, s) => fitStep({ ...o, status: s, outsideLens: null, lensRequest: null }, { long: true }).label;
  function undoStep(id) {
    const o = store.order(id);
    const to = o && undoTarget(o);
    if (!to) return;
    if (confirm(`Undo the last step on ${o.ref}?\n\nIt goes back to “${stepName(o, to)}”.`)) store.undoOrderStep(id, me.code);
  }
  function deleteOrder(id) {
    const o = store.order(id);
    if (!o) return;
    const extra = o.lensRequest && ['reserved', 'requested'].includes(o.lensRequest.status) ? '\nThe stock lenses it reserved go back on the shelf.'
      : o.outsideLens ? '\nIts outside lens order is removed too.' : '';
    if (!confirm(`Delete ${o.ref}${o.customer ? ` (${o.customer})` : ''}?\n\nThis can’t be undone.${extra}`)) return;
    drawer?.close();
    store.deleteOrder(id, me.code);
  }
  function editModal(id) {
    const o = store.order(id);
    if (!o) return;
    const ol = o.outsideLens, rxOk = canEditOutsideRx(o, me.code);
    const v = (eye, k) => esc(ol?.rx?.[eye]?.[k] ?? '');
    const { iso, local } = splitPhone(o.phone);
    const saved = { iso, value: local };
    const layer = openLayer('modal', () => `
      <div class="dw-head">
        <div><div class="dw-kicker">Edit fitting order</div><h2>${esc(o.ref)}</h2></div>
        <button class="icon-btn" data-close>${icons.x}</button>
      </div>
      <form class="form" id="eo">
        <div class="grid2">
          ${BILL_ON && (parseBill(o.ref) || !o.ref) ? billFieldHTML({ code: o.origin, value: o.ref, hidden: { name: 'ref' } }) : `<label>Bill number <input name="ref" required value="${esc(o.ref)}"></label>`}
          <label>Customer name <input name="customer" required value="${esc(o.customer ?? '')}"></label>
        </div>
        <div class="ph-label"><span>Customer phone <span class="opt">for the WhatsApp message</span></span>${phoneFieldHTML(saved)}</div>
        ${ol ? (rxOk ? `
        <div class="fieldset ol-fields">
          <div class="fs-head"><span>Prescription</span></div>
          <table class="ol-rx-in">
            <thead><tr><th></th><th>SPH</th><th>CYL</th><th>AXIS</th><th>ADD</th></tr></thead>
            <tbody>${['r', 'l'].map(eye => `<tr><th>${eye.toUpperCase()}</th>${['sph', 'cyl', 'axis', 'add'].map(k =>
              `<td><input name="${eye}_${k}" inputmode="decimal" autocomplete="off" value="${v(eye, k)}" placeholder="${k === 'axis' ? '0–180' : '0.00'}"></td>`).join('')}</tr>`).join('')}</tbody>
          </table>
          <label>Lens type <input name="lensType" value="${esc(ol.lensType ?? '')}" autocomplete="off"></label>
        </div>` : `<p class="muted sm">The outside lenses were confirmed with the supplier — their prescription can no longer be changed here.</p>`) : ''}
        <div class="form-foot">
          <button type="button" class="btn btn-ghost" data-close>Cancel</button>
          <button type="submit" class="btn btn-primary">${icons.check} Save changes</button>
        </div>
      </form>`);
    layer.el.addEventListener('click', e => { if (e.target.closest('[data-close]')) layer.close(); });
    wirePhoneFields(layer.el);
    wireBillFields(layer.el);
    layer.el.querySelector('#eo').addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      const val = k => String(f.get(k) ?? '').trim();
      const ref = val('ref'), customer = val('customer');
      e.target.elements.ref.value = ref; e.target.elements.customer.value = customer;
      if (!e.target.reportValidity()) return;
      let rx = null, lensType = null;
      if (ol && rxOk) {
        rx = Object.fromEntries(['r', 'l'].map(eye => [eye, Object.fromEntries(['sph', 'cyl', 'axis', 'add'].map(k => [k, val(`${eye}_${k}`)]))]));
        lensType = val('lensType');
        if (!rx.r.sph && !rx.l.sph) return toast({ title: 'Enter the prescription', sub: 'At least the SPH for one eye.', tone: 'stock' });
        if (!lensType) return toast({ title: 'Type the lens type', tone: 'stock' });
      }
      // The phone: emptied takes it off; anything typed has to be a number.
      const field = e.target.querySelector('[data-ph]');
      const typed = field.querySelector('input[inputmode=tel]').value.trim();
      const phone = typed ? phoneValue(field) : null;
      if (typed && !phone) return toast({ title: 'That phone number does not look right', sub: 'Type the number — the country is picked on its left.', tone: 'stock' });
      if (BILL_ON && ref !== o.ref && parseBill(ref)) {
        const why = await billProblem('order', ref, o.ref);
        if (why) return toast({ title: 'That bill number is taken', sub: why, tone: 'stock' });
      }
      const go = e.target.querySelector('[type=submit]');
      go.disabled = true;
      let ok = true;
      if (ref !== o.ref || customer !== (o.customer ?? '')) ok = !!(await store.editOrder(id, { ref, customer }, me.code));
      if (ok && (phone ?? '') !== String(o.phone ?? '').replace(/\D/g, '')) ok = !!(await store.setOrderPhone(id, phone, me.code));
      const rxChanged = rx && (lensType !== ol.lensType || JSON.stringify(rx) !== JSON.stringify(Object.fromEntries(['r', 'l'].map(eye => [eye, Object.fromEntries(['sph', 'cyl', 'axis', 'add'].map(k => [k, String(ol.rx?.[eye]?.[k] ?? '')]))]))));
      if (ok && rxChanged) ok = !!(await store.editOutsideLens(ol.id, { rx, lensType }, me.code));
      if (ok) layer.close(); else go.disabled = false;
    });
  }

  // ── status tags ──
  // One tag; or, for outside lenses on their own road, two — the frame's and
  // the lenses' — each beside its line of the journey.
  function tagsHTML(o, changed = false, long = false) {
    const f = frameStep(o, { viewer: me.code, long }), l = lensStep(o, { viewer: me.code, long });
    const fl = frameStep(o, { viewer: me.code, long: true }).label, ll = lensStep(o, { viewer: me.code, long: true }).label;
    return `<div class="tag-stack">${stepPill(f, { flash: changed, title: `Frame: ${fl}` })}${stepPill(l, { title: `Lenses: ${ll}` })}</div>`;
  }
  function statusHTML(o, st, changed) {
    if (twoRoads(o)) return tagsHTML(o, changed);
    return stepPill(st, { flash: changed, title: fitStep(o, { long: true, viewer: me.code }).label });
  }

  // ── journey mini-diagram ──
  // An outside-lens job the handler sends lenses for shows two lines, each
  // named: the frame's journey, and under it the lenses' road from the
  // handler to where they are going, drawn the full width. The lens line
  // stays once they arrive — its end pin simply turns navy (user, 2026-10-13).
  function journey(o, big = false, tail = '') {
    const ol = o.outsideLens, H = outsideHandler();
    if (!ol || ol.branch === H) return frameJourney(o, big, tail);
    const dest = ol.dest ?? o.origin;
    const seg = ol.receivedAt ? 'done' : ol.sentAt ? 'moving' : '';
    const pin = (code, cls) => `<div class="j-node ${cls}"><span class="j-pin">${esc(code)}</span>${big ? `<span class="j-lbl">${esc(locName(code))}</span>` : ''}</div>`;
    const name = t => `<span class="j-line-lbl">${t}</span>`;
    return `
      <div class="journey-2 ${big ? 'journey-2-big' : ''}">
        <div class="j-line">${name('Frame')}${frameJourney(o, big, '')}</div>
        <div class="j-line">${name('Lens')}
          <div class="journey ${big ? 'journey-big' : ''}" title="Outside lenses: ${esc(locName(H))} → ${esc(locName(dest))} · ${esc(outsideLensState(ol))}">
            ${pin(H, ol.status === 'ordered' ? 'done' : '')}
            <i class="j-seg ${seg}"></i>
            ${pin(dest, `${ol.receivedAt ? 'done' : ''} j-mid`)}
          </div>
        </div>
      </div>`;
  }

  function frameJourney(o, big = false, tail = '') {
    // By name, not position: waiting for the lenses and having them in both
    // sit at the branch, so the drawing is the same for the two.
    const stage = FIT_FLOW.indexOf(o.status);
    const at = s => FIT_FLOW.indexOf(s);
    const out = isOutside(o);
    const seg1 = stage >= at('at_fitter') || (out && stage >= at('to_fitter')) ? 'done' : stage === at('to_fitter') ? 'moving' : '';
    const seg2 = stage >= at('delivered') ? 'done' : stage === at('returning') ? 'moving' : '';
    // Fitter node: brand navy from the moment it's in play, green once ready.
    const fitterCls = stage >= READY_IDX ? 'ready' : stage >= at('to_fitter') ? 'done' : '';
    // `tail` hangs off the middle node — the fitter, or the only node of an
    // in-house job — so a note under it centres on that pin.
    const node = (code, cls, lbl, extra = '') => `
      <div class="j-node ${cls}">
        <span class="j-pin">${esc(code)}</span>
        ${big ? `<span class="j-lbl">${esc(lbl)}</span>` : ''}${extra}
      </div>`;
    const fitterCode = out ? 'OUT' : o.fitter ?? '?';
    const fitterName = out ? `${o.outside} (outside)` : o.fitter ? locName(o.fitter) : 'Unassigned';
    // The branch sending lenses (MGM for outside lenses, a stock holder for
    // stock ones) sees the lenses' own road while they are on their way:
    // from it to the branch that is receiving them.
    const leg = lensLeg(o);
    if (leg) return `
      <div class="journey journey-lens ${big ? 'journey-big' : ''}" title="Lenses: ${esc(locName(leg.from))} → ${esc(locName(leg.to))}">
        ${node(leg.from, 'done j-mid', locName(leg.from), tail)}
        <i class="j-seg ${leg.moving ? 'moving' : ''}"></i>
        ${node(leg.to, '', locName(leg.to))}
      </div>`;
    // Nothing travelled, so there is no road to draw — one node, and a word
    // about why the rest of the diagram is missing.
    if (onShortRoad(o) && collectOf(o) === o.origin) return `
      <div class="journey journey-self ${big ? 'journey-big' : ''}" title="${esc(fitterName)} — sold and fitted here, no transit">
        ${node(o.fitter, `${isBack(o) ? 'ready' : 'done'} j-mid`, fitterName, tail)}
        <span class="j-inhouse">${isBack(o) ? 'Fitted in-house' : 'In-house — no transit'}</span>
      </div>`;
    const C = collectOf(o);
    // Outside cutting through the hub (schema-62): four stops — where it was
    // sold, the hub, the outside cutter, where the customer collects.
    if (isViaHub(o)) {
      const sent = !!o.outsideOutAt, back = !!o.outsideBackAt;
      const segA = stage >= at('at_fitter') ? 'done' : stage === at('to_fitter') ? 'moving' : '';
      const segB = sent ? 'done' : '';
      const segC = stage >= at('delivered') ? 'done' : back ? 'moving' : '';
      return `
      <div class="journey journey-4 ${big ? 'journey-big' : ''}" title="${esc(locName(o.origin))} → ${esc(locName(o.fitter))} → ${esc(o.outside || 'outside cutter')} → ${esc(locName(C))}">
        ${node(o.origin, 'done', locName(o.origin))}
        <i class="j-seg ${segA}"></i>
        ${node(o.fitter, `${stage >= at('to_fitter') ? 'done' : ''}`, locName(o.fitter))}
        <i class="j-seg ${segB}"></i>
        ${node('OUT', `${back ? 'ready' : sent ? 'done' : ''} j-mid`, o.outside ? `${o.outside} (outside)` : 'Outside cutter', tail)}
        <i class="j-seg ${segC}"></i>
        ${node(C, stage >= at('delivered') ? 'done' : '', C === o.origin ? 'Back at branch' : `Collect at ${locName(C)}`)}
      </div>`;
    }
    // A plain round trip draws as it always has.
    if (C === o.origin && !(o.stops ?? []).length && !isSelfFit(o)) return `
      <div class="journey ${big ? 'journey-big' : ''}" title="${esc(locName(o.origin))} → ${esc(fitterName)} → back">
        ${node(o.origin, 'done', locName(o.origin))}
        <i class="j-seg ${seg1}"></i>
        ${node(fitterCode, `${fitterCls} j-mid`, fitterName, tail)}
        <i class="j-seg ${seg2}"></i>
        ${node(o.origin, stage >= at('delivered') ? 'done' : '', 'Back at branch')}
      </div>`;
    return routeJourney(o, big, tail, { node, fitterCode, fitterName, fitterCls });
  }

  // Collected somewhere else (schema-36): sold → fitter → every branch it
  // stopped at → where the customer collects. Collected at the fitter, the
  // road ends there.
  function routeJourney(o, big, tail, { node, fitterCode, fitterName, fitterCls }) {
    const C = collectOf(o), out = isOutside(o), self = isSelfFit(o);
    const stops = o.stops ?? [];
    const path = [{ code: o.origin, lbl: self ? `${locName(o.origin)} (in-house)` : locName(o.origin) }];
    if (!self) path.push({ code: fitterCode, lbl: fitterName, fitter: true });
    if (out) path.push({ code: o.origin, lbl: 'Back at branch' });
    for (const s of stops) path.push({ code: s, lbl: locName(s) });
    const to = o.status === 'returning' ? (o.toCode ?? C) : null;
    if (to && to !== C && path[path.length - 1].code !== to) path.push({ code: to, lbl: locName(to) });
    const here = !self && !out && C === o.fitter && !stops.length;    // collected at the fitter
    if (!here && path[path.length - 1].code !== C) path.push({ code: C, lbl: `${locName(C)} · collect` });
    // Where the frame is now, by place on the road.
    const lastAt = code => path.map(p => p.code).lastIndexOf(code);
    const s = o.status;
    const cur = ['pending', 'lenses_in'].includes(s) ? 0
      : s === 'to_fitter' ? (out ? 1 : 0)
      : s === 'at_fitter' ? (self ? 0 : 1)
      : s === 'ready' || s === 'returning' ? Math.max(0, lastAt(frameLoc(o)))
      : path.length - 1;
    const moving = (s === 'to_fitter' && !out) || s === 'returning';
    const nodes = path.map((p, i) => {
      const cls = p.fitter ? fitterCls : i <= cur ? 'done' : '';
      const mid = (self ? i === 0 : p.fitter) ? ' j-mid' : '';
      return node(p.code, cls + mid, p.lbl, mid ? tail : '');
    });
    const segs = path.slice(1).map((_, i) => `<i class="j-seg ${i + 1 <= cur ? 'done' : i === cur && moving ? 'moving' : ''}"></i>`);
    return `
      <div class="journey journey-route ${big ? 'journey-big' : ''}" title="${esc(path.map(p => locName(p.code) || p.code).join(' → '))}">
        ${nodes.map((n, i) => (i ? segs[i - 1] : '') + n).join('')}
        ${here ? '<span class="j-collect">Collect here</span>' : ''}
      </div>`;
  }

  function lensLeg(o) {
    if (o.status !== 'pending') return null;
    const lr = o.lensRequest;
    if (lr && lr.fulfilment === 'receive_lens' && me.code === lr.holder && o.origin !== me.code)
      return { from: me.code, to: o.origin, moving: ['sent', 'confirmed'].includes(lr.status) };
    return null;
  }

  // (The three summary tiles — active / need your action / completed — were
  // taken off the Fitting Log, user 2026-10-18: the tabs carry the counts.)

  // ── list ──
  // The next step for an order, as buttons (or who it waits on) — the list's
  // rows and Tablet Mode's cards share it.
  function nextActionHTML(o, st, can, needsFitter) {
    // Primary action: pick a fitter, advance, or show who we're waiting on.
    let action;
    // The handler's first job on any outside order: order the lens — the button opens the list.
    if (o.outsideLens && o.outsideLens.status !== 'ordered' && me.code === outsideHandler() && !isBack(o) && !viewOnly)
      action = `<a class="btn btn-primary btn-sm" href="#/outside">Order Lens ${icons.arrowRight}</a>`;
    else if (canSendLenses(o, me.code) && !viewOnly) action = `<button class="btn btn-primary btn-sm" data-send-lenses="${o.lensRequest.id}">${icons.send} Send Lenses</button>`;
    else if (canArriveOutside(o, me.code) && !viewOnly) action = `<button class="btn btn-primary btn-sm" data-arrive-outside="${o.outsideLens.id}">Lens Received ${icons.arrowRight}</button>`;
    else if (canSendOutside(o, me.code) && !viewOnly) action = `<button class="btn btn-primary btn-sm" data-send-outside="${o.outsideLens.id}">${icons.send} Send Lenses to ${esc(o.outsideLens.dest)}</button>`;
    else if (outsideBlocked(o) && fitActor(o) === me.code && !canReceiveOutside(o, me.code)) action = `<span class="row-actor">waiting for the lenses</span>`;
    else if (o.status === 'lenses_in' && o.fitter && o.fitter !== o.origin && isBenchClosed(o.fitter)) action = `<span class="row-actor" title="${esc(benchNote(o.fitter))}">${esc(o.fitter)} not taking frames</span>`;
    else if (needsFitter && can) action = `<button class="btn btn-primary btn-sm" data-send-fitter="${o.id}">${icons.send} Send to Fitting</button>`;
    else if (st.hubOut && can && !viewOnly) action = `<button class="btn btn-primary btn-sm" data-hub-out="${o.id}">${icons.send} Send to Outside Cutter</button>`;
    else if (can && st.action) action = `<button class="btn btn-primary btn-sm" data-advance="${o.id}">${esc(st.action)} ${icons.arrowRight}</button>`;
    else if (outsideInTransit(o, me.code)) action = `<span class="row-actor">waiting on ${esc(o.outsideLens.dest)}</span>`;
    else action = `<span class="row-actor">${o.status === 'collected' ? icons.check : `waiting on ${esc(fitActor(o) ?? '')}`}</span>`;
    // The fitter marks the outside lenses received — alongside the frame's own step.
    if (canReceiveOutside(o, me.code) && !viewOnly) {
      const lens = `<button class="btn btn-primary btn-sm" data-recv-outside="${o.outsideLens.id}">Lens Received ${icons.arrowRight}</button>`;
      action = action.startsWith('<span') ? lens : `${lens}${action}`;
    }
    if (waOn(o)) action = `${waBtn(o)}${action}`;
    return action;
  }

  // ── Tablet Mode (tablet.js): each order a card with everything on it ──
  // Bill and customer big, the whole route with its stops named, the status,
  // and the next step as one big button. Tap the card for the details.
  function cardHTML(o) {
    const can = canAdvanceOrder(o, me.code);
    const st = fitStep(o, { viewer: me.code });
    const needsFitter = o.status === 'lenses_in' && !o.fitter && !isOutside(o);
    const action = nextActionHTML(o, st, can, needsFitter);
    const fromStock = !!store.lensRequestForOrder(o.id);
    const selected = ui.selected.has(o.id);
    const isNew = !ui.seen.has(o.id);
    return `
      <article class="t-card ${o.urgent ? 't-urgent' : ''} ${selected ? 'row-selected' : ''} ${isNew ? 'row-enter' : ''}" data-card="${o.id}">
        <header class="t-head">
          <label class="cbx t-cbx" data-stop><input type="checkbox" data-sel="${o.id}" ${selected ? 'checked' : ''} ${!canSelect(o) || viewOnly ? 'disabled' : ''}><i></i></label>
          <div class="t-id"><b class="t-ref">${esc(o.ref)}</b><span class="t-cust">${esc(o.customer || 'No customer name')}</span></div>
          <div class="t-age" title="Logged ${fmtDT(o.createdAt)}">${relTime(o.createdAt)}${o.urgent ? '<span class="t-flag">Urgent</span>' : ''}</div>
        </header>
        <div class="t-route">${journey(o, true, '')}</div>
        <div class="t-status">${statusHTML(o, st, false)}${fromStock ? stockTag() : o.outsideLens ? outsideLensTag() : ''}</div>
        <div class="t-do" data-stop>${action}</div>
      </article>`;
  }

  function rowsHTML() {
    const list = visible();
    if (!list.length) return `<div class="empty">${icons.glasses}<p>No orders match this view.</p></div>`;
    if (isTablet()) return list.map(cardHTML).join('');
    return list.map(o => {
      const isNew = !ui.seen.has(o.id);
      const changed = ui.prevStatus.get(o.id) !== o.status;
      const can = canAdvanceOrder(o, me.code);
      const st = fitStep(o, { viewer: me.code });
      const selected = ui.selected.has(o.id);
      const needsFitter = o.status === 'lenses_in' && !o.fitter && !isOutside(o);
      const action = nextActionHTML(o, st, can, needsFitter);
      const title = o.customer || 'No customer name';
      const fromStock = !!store.lensRequestForOrder(o.id);
      return `
      <div class="row ${isNew ? 'row-enter' : ''} ${selected ? 'row-selected' : ''}" data-select="${o.id}">
        <label class="cbx" data-stop><input type="checkbox" data-sel="${o.id}" ${selected ? 'checked' : ''} ${!canSelect(o) || viewOnly ? 'disabled' : ''}><i></i></label>
        <div class="row-main">
          <div class="row-title">
            <b>${esc(o.ref)}</b>
            <span class="row-cust">${esc(title)}</span>
          </div>
          <div class="row-sub"><span class="row-when" title="Logged ${fmtDT(o.createdAt)}">${relTime(o.createdAt)}</span>${fromStock ? stockTag('stock-tag-sub') : o.outsideLens ? outsideLensTag('stock-tag-sub') : ''}</div>
        </div>
        <div class="row-journey">${journey(o, false, fromStock ? stockTag() : o.outsideLens ? outsideLensTag() : '')}</div>
        <div class="row-status">${statusHTML(o, st, changed)}</div>
        <div class="row-act" data-stop>
          ${action}
          <button class="icon-btn open-arrow" data-open="${o.id}" title="Open order">${icons.chevronRight}</button>
        </div>
      </div>`;
    }).join('');
  }

  // An order as its Fitting Log row, to look at only — no tick box, no buttons
  // (the "another pair?" question shows the orders already on the bill).
  function previewRowHTML(o) {
    const fromStock = !!store.lensRequestForOrder(o.id);
    return `
      <div class="row pq-preview">
        <div class="row-main">
          <div class="row-title"><b>${esc(o.ref)}</b><span class="row-cust">${esc(o.customer || 'No customer name')}</span></div>
          <div class="row-sub"><span class="row-when" title="Logged ${fmtDT(o.createdAt)}">${relTime(o.createdAt)}</span></div>
        </div>
        <div class="row-journey">${journey(o, false, fromStock ? stockTag() : o.outsideLens ? outsideLensTag() : '')}</div>
        <div class="row-status">${statusHTML(o, fitStep(o, { viewer: me.code }), false)}</div>
      </div>`;
  }

  // The one next action shared by every selected order — or null if they
  // need different actions (mixed stages / waiting on someone else).
  // The button an order would get in a bulk move, or null when this location
  // has nothing to press on it (yet) — e.g. waiting for another branch.
  const bulkLabel = o => (!canAdvanceOrder(o, me.code) ? null
    : (o.status === 'lenses_in' && !o.fitter) ? 'Send to Fitting'
    : fitStep(o).action) || null;
  // The step, without where to: "Send to AV" and "Send to MOUJ" are both
  // "Send to Branch". Mixed steps still go — each order does its own.
  const stepWord = a => String(a ?? '')
    .replace(/^Send Lenses to .+/, 'Send Lenses').replace(/^Send Frame to .+/, 'Send Frame')
    .replace(/^Transfer to .+/, 'Transfer').replace(/^Send to (?!Fitting$).+/, 'Send to Branch');
  function bulkAction() {
    const sel = [...ui.selected].map(id => store.order(id)).filter(Boolean);
    const words = [...new Set(sel.map(o => stepWord(actionOf(o))))];
    const ok = sel.length > 0 && sel.every(o => actionOf(o));
    return { count: sel.length, action: words.length === 1 ? words[0] : 'Next Step', ok };
  }

  function bulkHTML() {
    if (!ui.selected.size) return '';
    const { count, action, ok } = bulkAction();
    return `
      <div class="bulkbar">
        <span><b>${count}</b> selected</span>
        <button class="btn btn-primary btn-sm" data-bulk-act ${ok ? '' : 'disabled'}>
          ${icons.checks} ${esc(action ?? 'Advance')}${count > 1 ? ` · ${count} orders` : ''}
        </button>
        ${!ok ? `<span class="bulk-hint">some selected orders have no step for you</span>` : action === 'Next Step' ? `<span class="bulk-hint">each order does its own next step</span>` : ''}
        <button class="btn btn-ghost btn-sm" data-bulk-clear>Clear</button>
      </div>`;
  }

  function chipsHTML() {
    const c = counts();
    // How many in each chip are waiting on this location.
    const mine = viewOnly ? [] : store.ordersFor(me.code).filter(o => o.status !== 'collected' && (needsAction(o, me.code) || toOrder(o)));
    const act = d => (d.key === 'active' ? mine.length : mine.filter(o => chipHas(d, o)).length);
    return CHIP_DEFS.filter(d => (!d.holders || isLensOwner(me.code)) && (!d.handler || me.code === outsideHandler())).map(d => `${d.key === 'collected' ? '<span class="chip-sep"></span>' : ''}
      <button class="chip ${ui.chip === d.key ? 'on' : ''}" data-chip="${d.key}">
        ${esc(d.label)}${chipCount(c[d.key] ?? 0, act(d))}
      </button>`).join('');
  }

  // ── drawer (order detail) ──
  function drawerHTML() {
    const o = store.order(drawerId);
    if (!o) return `<div class="pad">Order no longer exists.</div>`;
    const can = canAdvanceOrder(o, me.code);
    const st = fitStep(o, { long: true, viewer: me.code });
    const needsFitter = o.status === 'lenses_in' && !o.fitter && !isOutside(o);
    return `
      <div class="dw-head">
        <div>
          <div class="dw-kicker">Fitting order</div>
          <h2>${esc(o.ref)}</h2>
          <div class="dw-sub">${esc(o.customer || 'No customer name')}${o.phone ? ` · ${esc(o.phone)}` : ''}</div>
        </div>
        <button class="icon-btn" data-close>${icons.x}</button>
      </div>
      <div class="dw-body">
        ${viewOnly ? '' : toolsHTML(o)}
        <div class="dw-status-row">${twoRoads(o) ? `${tagsHTML(o, false, true)}` : stepPill(st)}<span class="dw-when">updated ${relTime(o.updatedAt)}</span></div>
        ${journey(o, true)}
        <div class="kv">
          <div><span>Origin</span><b>${locChip(o.origin)} ${esc(locName(o.origin))}</b></div>
          <div><span>Fitting centre</span><b>${isViaHub(o) ? `${locChip(o.fitter)} ${esc(locName(o.fitter))} <span class="muted">→ ${o.outside ? `${esc(o.outside)} (outside)` : 'an outside cutter, to choose'}</span>`
            : isOutside(o) ? `<span class="loc-chip">OUT</span> ${esc(o.outside)} <span class="muted">· outside, 3rd party</span>`
            : o.fitter ? `${locChip(o.fitter)} ${esc(locName(o.fitter))}${isSelfFit(o) ? ' <span class="muted">· in-house</span>' : ''}` : '<span class="muted">Not assigned yet</span>'}</b></div>
          <div class="kv-wide"><span>Collect at</span><b>${locChip(collectOf(o))} ${esc(locName(collectOf(o)))}${collectOf(o) === o.origin ? ' <span class="muted">· where it was sold</span>' : ''}
            ${canChangeCollect(o, me.code) && !viewOnly ? `<button class="btn btn-ghost btn-sm kv-btn" data-collect="${o.id}">${icons.history} Change</button>` : ''}</b></div>
          ${o.note ? `<div class="kv-wide"><span>Note</span><b>${esc(o.note)}</b></div>` : ''}
        </div>
        ${stockLensHTML(store.lensRequestForOrder(o.id))}
        ${outsideLensHTML(o)}
        <div class="dw-actions">
          ${canReceiveOutside(o, me.code) && !viewOnly ? `<button class="btn btn-primary" data-recv-outside="${o.outsideLens.id}">Lens Received ${icons.arrowRight}</button>` : ''}
          ${canSendLenses(o, me.code) && !viewOnly ? `<button class="btn btn-primary" data-send-lenses="${o.lensRequest.id}">${icons.send} Send Lenses to ${esc(locName(o.origin))}</button>` :
            canArriveOutside(o, me.code) && !viewOnly ? `<button class="btn btn-primary" data-arrive-outside="${o.outsideLens.id}">Lens Received ${icons.arrowRight}</button>` :
            canSendOutside(o, me.code) && !viewOnly ? `<button class="btn btn-primary" data-send-outside="${o.outsideLens.id}">${icons.send} Send Lenses to ${esc(locName(o.outsideLens.dest))}</button>` :
            needsFitter && can ? `<button class="btn btn-primary" data-send-fitter="${o.id}">${icons.send} Send to Fitting</button>` :
            st.hubOut && can && !viewOnly ? `<button class="btn btn-primary" data-hub-out="${o.id}">${icons.send} Send to Outside Cutter</button>` :
            can && st.action ? `<button class="btn btn-primary" data-advance="${o.id}">${esc(st.action)} ${icons.arrowRight}</button>` : ''}
          ${waBtn(o, true)}
        </div>
        <h3 class="tl-h">${icons.history} Timeline</h3>
        <div class="timeline">
          ${[...o.timeline].reverse().map((t, i) => `
            <div class="tl-item ${i === 0 ? 'tl-now' : ''}">
              <i class="tl-dot"></i>
              <div class="tl-txt">${esc(t.text)}</div>
              <div class="tl-meta">${locChip(t.by)} ${esc(locName(t.by))} · <span title="${fmtDT(t.at)}">${fmtDT(t.at)}</span></div>
            </div>`).join('')}
        </div>
      </div>`;
  }

  // Outside lenses: the prescription and lens type MGM orders from the supplier.
  function outsideLensHTML(o) {
    const x = o.outsideLens;
    if (!x) return '';
    const eye = e => ['sph', 'cyl', 'axis', 'add'].map(k => `<td class="pwr">${esc(String(e?.[k] ?? '').trim() || '—')}</td>`).join('');
    const canChange = !viewOnly && outsideCanChange(o, me.code);
    return `
      <h3 class="tl-h">${icons.truck} Outside lenses</h3>
      <div class="dw-status-row">
        <span class="ol-tag ol-${x.receivedAt ? 'sent' : x.status === 'ordered' ? 'ordered' : 'to-order'}">${esc(outsideLensState(x))}</span>
        <span class="fulfil-chip ${x.fulfilment}">${esc(x.branch === outsideHandler() ? 'Arrive here' : `Lenses go to ${x.dest}`)}</span>
        ${canChange ? `<button class="btn btn-ghost btn-sm dw-switch" data-ol-change="${o.id}">${icons.history} Change</button>` : ''}
      </div>
      <div class="kv"><div class="kv-wide"><span>Lens type</span><b>${esc(x.lensType)}</b></div></div>
      <table class="lines">
        <thead><tr><th></th><th>SPH</th><th>CYL</th><th>AXIS</th><th>ADD</th></tr></thead>
        <tbody><tr><th>R</th>${eye(x.rx?.r)}</tr><tr><th>L</th>${eye(x.rx?.l)}</tr></tbody>
      </table>`;
  }

  // The lenses a lens request took off the shelf for this job — what the bench
  // will be cutting, so the fitter never has to go and look it up.
  function stockLensHTML(r) {
    if (!r) return '';
    const viewOnlySwitch = viewOnly;
    return `
      <h3 class="tl-h">${icons.lens} Stock lens</h3>
      <div class="dw-status-row">
        ${pill(LENSREQ_STATUS, r.status)}
        <span class="fulfil-chip ${r.fulfilment}">${esc(FULFILMENT[r.fulfilment]?.chip ?? '')}</span>
        <span class="dw-when">${esc(r.ref)}</span>
        ${(() => { const to = fulfilmentSwitch(r, store.order(r.orderId), me.code); return to && !viewOnlySwitch ? `<button class="btn btn-ghost btn-sm dw-switch" data-switch="${r.id}" data-to="${to}">${icons.history} ${to === 'send_frames' ? 'Change: send the frame instead' : 'Change: receive the lenses instead'}</button>` : ''; })()}
      </div>
      <table class="lines">
        <thead><tr><th>Lens</th><th>SPH</th><th>CYL</th><th class="num">Qty</th></tr></thead>
        <tbody>
          ${r.lines.map(l => `
            <tr>
              <td><b>${esc(l.type)} ${esc(l.index)}</b>${l.coating && l.coating !== 'None' ? `<div class="line-note">${esc(l.coating)}</div>` : ''}</td>
              <td class="pwr">${fmtPwr(l.sph)}</td>
              <td class="pwr">${fmtPwr(l.cyl)}</td>
              <td class="num"><b>${l.qty}</b> <span class="muted">pcs</span></td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  function openDrawer(id) {
    drawerId = id;
    drawer = openLayer('drawer', drawerHTML, { onClose: () => { drawer = null; drawerId = null; } });
    drawer.el.addEventListener('click', e => {
      if (e.target.closest('[data-close]')) return drawer.close();
      const sl = e.target.closest('[data-send-lenses]');
      if (sl) return store.sendLenses(sl.dataset.sendLenses, me.code);
      const so = e.target.closest('[data-send-outside]');
      if (so) return store.sendOutsideLenses(so.dataset.sendOutside, me.code);
      const oc = e.target.closest('[data-ol-change]');
      if (oc) return changeOutsideModal(oc.dataset.olChange);
      const ro = e.target.closest('[data-recv-outside]');
      if (ro) return store.receiveOutsideLenses(ro.dataset.recvOutside, me.code);
      const ao = e.target.closest('[data-arrive-outside]');
      if (ao) return store.arriveOutsideLenses(ao.dataset.arriveOutside, me.code);
      const sw = e.target.closest('[data-switch]');
      if (sw) return switchFulfilment(sw.dataset.switch, sw.dataset.to);
      const ho = e.target.closest('[data-hub-out]');
      if (ho) return hubOutPicker(ho.dataset.hubOut);
      const sf = e.target.closest('[data-send-fitter]');
      if (sf) return fitterPicker(sf.dataset.sendFitter);
      const adv = e.target.closest('[data-advance]');
      if (adv) return store.advanceOrders([adv.dataset.advance], me.code);
      const wa = e.target.closest('[data-wa]');
      if (wa) return messageCustomer(wa.dataset.wa);
      const co = e.target.closest('[data-collect]');
      if (co) return collectModal(co.dataset.collect);
      const ed = e.target.closest('[data-edit-order]');
      if (ed) return editModal(ed.dataset.editOrder);
      const un = e.target.closest('[data-undo-order]');
      if (un) return undoStep(un.dataset.undoOrder);
      const dl = e.target.closest('[data-delete-order]');
      if (dl) return deleteOrder(dl.dataset.deleteOrder);

    });
  }

  // The order went in the wrong way round: switch it while nothing has moved.
  function switchFulfilment(id, to) {
    const r = store.lensRequest(id);
    if (!r) return;
    const ask = to === 'send_frames'
      ? `Change ${r.ref} to “Send the frame”?\n\nThe lenses stay set aside at ${locName(r.holder)} and the frame goes there to be cut.`
      : `Change ${r.ref} to “Receive the lenses”?\n\n${locName(r.holder)} will send the lenses to ${locName(r.branch)}.`;
    if (confirm(ask)) store.changeFulfilment(id, to, me.code);
  }

  // The way an outside order goes — the same two choices as when ordering.
  function outsideWayHTML(pickHow, pickDest) {
    const H = outsideHandler(), hName = locName(H);
    const open = FITTERS.filter(f => f.code !== me.code && !isBenchClosed(f.code));
    const dest = open.some(f => f.code === pickDest) ? pickDest : (open.find(f => f.code === 'MGM') ?? open[0])?.code;
    const how = open.length ? pickHow : 'receive_lens';
    return `<div class="fulfil">
      <label class="fulfil-opt ${how === 'send_frames' ? 'on' : ''} ${open.length ? '' : 'is-off'}">
        <input type="radio" name="olHow" value="send_frames" ${how === 'send_frames' ? 'checked' : ''} ${open.length ? '' : 'disabled'}>
        <b>${esc(OUTSIDE_FULFILMENT.send_frames.label)}</b>
        <span>${open.length ? `Your frame and ${esc(hName)}'s lenses both go there to be cut.` : 'No fitter is open right now.'}</span>
        ${open.length ? `<select name="olDest" class="ol-dest" aria-label="Fitter">${open.map(f => `<option value="${f.code}" ${f.code === dest ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select>` : ''}
      </label>
      <label class="fulfil-opt ${how === 'receive_lens' ? 'on' : ''}">
        <input type="radio" name="olHow" value="receive_lens" ${how === 'receive_lens' ? 'checked' : ''}>
        <b>${esc(OUTSIDE_FULFILMENT.receive_lens.label)}</b>
        <span>${esc(`${hName} sends the lenses here; then ${canCutOwnLenses(me.role) ? 'cut here or send to a fitter' : 'send frame and lenses to a fitter'}.`)}</span>
      </label>
    </div>`;
  }
  const wireWay = el => el.addEventListener('change', e => {
    if (e.target.name === 'olHow') el.querySelectorAll('.fulfil-opt').forEach(l => l.classList.toggle('on', l.contains(e.target)));
    if (e.target.name === 'olDest') { const r = el.querySelector('[name="olHow"][value="send_frames"]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
  });

  function changeOutsideModal(orderId) {
    const o = store.order(orderId), x = o?.outsideLens;
    if (!x) return;
    const layer = openLayer('modal', () => `
      <div class="dw-head">
        <div><div class="dw-kicker">Outside lenses · ${esc(o.ref)}</div><h2>Where do the frame and lenses go?</h2></div>
        <button class="icon-btn" data-close>${icons.x}</button>
      </div>
      <form class="form" id="ol-change">
        ${outsideWayHTML(x.fulfilment, x.dest)}
        <div class="form-foot">
          <button type="button" class="btn btn-ghost" data-close>Cancel</button>
          <button type="submit" class="btn btn-primary">${icons.check} Save</button>
        </div>
      </form>`);
    wireWay(layer.el);
    layer.el.addEventListener('click', e => { if (e.target.closest('[data-close]')) layer.close(); });
    layer.el.querySelector('#ol-change').addEventListener('submit', async e => {
      e.preventDefault();
      const d = new FormData(e.target);
      const how = String(d.get('olHow') || 'receive_lens');
      if (await store.changeOutsideFulfilment(x.id, how, how === 'send_frames' ? String(d.get('olDest') || '') : null, me.code)) layer.close();
    });
  }

  // ── fitter picker (assign + send, one order or a bulk selection) ──
  function fitterPicker(ids) {
    ids = Array.isArray(ids) ? ids : [ids];
    const orders = ids.map(id => store.order(id)).filter(o => o && o.status === 'lenses_in' && !o.fitter && !isOutside(o));
    if (!orders.length) return;
    const what = orders.length === 1 ? orders[0].ref : `${orders.length} orders`;
    // If every frame here was sold by a fitting centre, that centre can simply
    // keep them — so it leads the list and says so, rather than hiding among
    // the places a van would have to drive to.
    const from = orders[0].origin;
    const home = orders.every(o => o.origin === from) && FITTERS.find(f => f.code === from);
    const order = home ? [home, ...FITTERS.filter(f => f.code !== home.code)] : FITTERS;
    const listed = store.settings.outsideCutters ?? [];
    const cutters = listed.length ? listed : [OUTSIDE_DEFAULT];
    const layer = openLayer('modal', () => `
      <div class="dw-head">
        <div><div class="dw-kicker">Send to Fitting</div><h2>Choose a fitting centre for ${esc(what)}</h2></div>
        <button class="icon-btn" data-close>${icons.x}</button>
      </div>
      <div class="form">
        <div class="picker-grid">
          ${order.map(f => { const shut = home && f.code === home.code ? isLabOff(f.code) : isBenchClosed(f.code); return `
            <button class="picker-card ${home && f.code === home.code ? 'picker-home' : ''} ${shut ? 'is-closed' : ''}" data-fitter="${f.code}" ${shut ? 'disabled' : ''}>
              <span class="loc-chip">${f.code}</span>
              <b>${esc(f.name)}</b>
              ${shut ? `<span class="picker-note">${esc(benchNote(f.code))}</span>`
                : home && f.code === home.code ? '<span class="picker-note">Keep here — no transit</span>' : ''}
              ${shut ? '' : icons.arrowRight}
            </button>`; }).join('')}
        </div>
        <h3 class="picker-h">Outside — 3rd-party cutters</h3>
        <div class="picker-grid">
          ${OUT_HUB_ON ? `
            <button class="picker-card picker-out" data-outside-hub>
              <span class="loc-chip">OUT</span>
              <b>Outside cutter <span class="muted">· through ${esc(locName(outsideCutHub()))}</span></b>
              <span class="picker-note">${esc(outsideCutHub())} picks the cutter and sends it out</span>
              ${icons.arrowRight}
            </button>` : cutters.map(n => `
            <button class="picker-card picker-out" data-outside="${esc(n)}">
              <span class="loc-chip">OUT</span>
              <b>${esc(n)}</b>
              ${icons.arrowRight}
            </button>`).join('')}
        </div>
      </div>`);
    layer.el.addEventListener('click', e => {
      if (e.target.closest('[data-close]')) return layer.close();
      const f = e.target.closest('[data-fitter]');
      if (f) {
        ui.selected.clear(); // clear first — the store commit below triggers the re-render
        store.sendOrdersToFitter(orders.map(o => o.id), f.dataset.fitter, me.code);
        layer.close();
      }
      if (e.target.closest('[data-outside-hub]')) {
        ui.selected.clear();
        store.sendOrdersViaHub(orders.map(o => o.id), me.code);
        return layer.close();
      }
      const out = e.target.closest('[data-outside]');
      if (out) {
        ui.selected.clear();
        store.sendOrdersOutside(orders.map(o => o.id), out.dataset.outside, me.code);
        layer.close();
      }
    });
  }

  // ── The hub sends a frame out (schema-62): it picks the cutter ──
  function hubOutPicker(id) {
    const o = store.order(id);
    if (!o) return;
    const listed = store.settings.outsideCutters ?? [];
    const cutters = listed.length ? listed : [OUTSIDE_DEFAULT];
    const layer = openLayer('modal', () => `
      <div class="dw-head">
        <div><div class="dw-kicker">${esc(o.ref)} · ${esc(o.customer || '')}</div><h2>Send to an outside cutter</h2></div>
        <button class="icon-btn" data-close>${icons.x}</button>
      </div>
      <div class="form">
        <div class="picker-grid">${cutters.map(n => `
          <button class="picker-card picker-out" data-hub-cutter="${esc(n)}"><span class="loc-chip">OUT</span><b>${esc(n)}</b>${icons.arrowRight}</button>`).join('')}
        </div>
      </div>`);
    layer.el.addEventListener('click', async e => {
      if (e.target.closest('[data-close]')) return layer.close();
      const c = e.target.closest('[data-hub-cutter]');
      if (!c) return;
      layer.close();
      await store.sendHubOut(id, c.dataset.hubCutter, me.code);
    });
  }

  // ── outside cutters (the office) — the 3rd parties Send to Fitting offers ──
  function cuttersModal() {
    const layer = openLayer('modal', () => {
      const list = store.settings.outsideCutters ?? [];
      return `
      <div class="dw-head">
        <div><div class="dw-kicker">Fitting Log</div><h2>Outside cutters</h2></div>
        <button class="icon-btn" data-close>${icons.x}</button>
      </div>
      <div class="form">
        ${OUT_HUB_ON ? `<label class="set-ctl">Outside cutting goes through
          <select id="cut-hub">${FITTERS.map(f => `<option value="${f.code}" ${f.code === outsideCutHub() ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label>` : ''}
        ${list.length ? `<div class="set-brands">${list.map(n => `
          <span class="set-brand set-plain">${esc(n)}<button class="brand-x" data-del-cutter="${esc(n)}" title="Remove">${icons.x}</button></span>`).join('')}</div>`
          : `<div class="empty">${icons.glasses}<p>No outside cutters named yet — add the first below.</p></div>`}
        <form class="set-add" id="add-cutter" autocomplete="off">
          <input name="name" placeholder="New outside cutter — e.g. the lab's name" required>
          <button class="btn btn-primary btn-sm" type="submit">${icons.plus} Add cutter</button>
        </form>
      </div>`;
    });
    layer.el.addEventListener('change', e => {
      if (e.target.id !== 'cut-hub') return;
      if (!confirm(`Outside cutting goes through ${locName(e.target.value)} from now on?`)) { e.target.value = outsideCutHub(); return; }
      store.setOutsideCutHub(e.target.value);
    });
    layer.el.addEventListener('submit', async e => {
      e.preventDefault();
      const input = e.target.querySelector('input[name="name"]');
      if (!input?.value.trim()) return;
      await store.addCutter(input.value);
      layer.update();
      layer.el.querySelector('#add-cutter input')?.focus();
    });
    layer.el.addEventListener('click', async e => {
      if (e.target.closest('[data-close]')) return layer.close();
      const del = e.target.closest('[data-del-cutter]');
      if (!del) return;
      if (!confirm(`Take ${del.dataset.delCutter} off the outside cutters?`)) return;
      await store.removeCutter(del.dataset.delCutter);
      layer.update();
    });
  }

  // ── new order modal — bill number only ──
  function newOrderModal() {
    // Lens stock (user, 2026-10-17): order the lenses from a shelf right here —
    // the same request the Lens Stock page makes. Not from your own shelf.
    // Your own shelf first (a holder uses its own stock — schema-42), then the
    // others with Muscat Grand Mall first, as on Lens Stock.
    const shelves = LENS_HOLDERS.filter(h => h.active !== false)
      .sort((a, b) => (b.code === me.code) - (a.code === me.code) || (b.code === FIRST_SHELF) - (a.code === FIRST_SHELF));
    const shelfName = h => (h.code === me.code ? `Your shelf — ${h.name}` : h.name);
    const own = () => ls.holder === me.code;
    const ls = { holder: shelves[0]?.code ?? null, lines: [{ itemId: '', qty: 1 }] };
    const lensLabel = i => `${i.type} ${i.index}${i.coating && i.coating !== 'None' ? ` ${i.coating}` : ''} · SPH ${fmtPwr(i.sph)}${i.cyl ? ` CYL ${fmtPwr(i.cyl)}` : ''}`;
    const shelfItems = () => store.state.lensStock.filter(i => i.holder === ls.holder && i.qty > 0)
      .sort((a, b) => lensLabel(a).localeCompare(lensLabel(b), undefined, { numeric: true }));
    // Each lens line: type to search ("1.60", "blue", "-2") or open the list.
    const findItem = text => shelfItems().find(i => lensLabel(i).toLowerCase() === String(text).trim().toLowerCase());
    const lsLinesHTML = () => {
      const items = shelfItems();
      if (!items.length) return `<p class="muted sm">Nothing on ${esc(own() ? 'your' : `${locName(ls.holder)}'s`)} shelf right now.</p>`;
      return ls.lines.map((l, n) => {
        const pick = store.lensItem(l.itemId);
        return `
        <div class="ls-row">
          <div class="ls-pick">
            <input data-ls-item="${n}" value="${esc(pick ? lensLabel(pick) : (l.text ?? ''))}" placeholder="Type or pick a lens — e.g. 1.60 blue -2.00" autocomplete="off" aria-label="Lens" role="combobox" aria-expanded="false">
            ${icons.chevronRight}
          </div>
          <div class="ls-menu" data-ls-menu="${n}" role="listbox" hidden></div>
          <input type="number" min="1" max="${pick?.qty ?? 99}" value="${esc(l.qty)}" data-ls-qty="${n}" aria-label="Quantity">
          <button type="button" class="icon-btn" data-ls-del="${n}" ${ls.lines.length === 1 ? 'disabled' : ''} title="Remove">${icons.x}</button>
          ${pick ? `<span class="ls-have">${pick.qty} in stock</span>` : ''}
        </div>`;
      }).join('');
    };
    const lsWayHTML = () => {
      // Your own shelf: the lenses are already here — nothing to send.
      if (own()) return `<p class="muted sm ls-own">The lenses come off your shelf now — the order starts at “Send to Fitting”, where you keep it here or send it.</p>`;
      const shut = isBenchClosed(ls.holder);
      const how = shut ? 'receive_lens' : (layer?.el.querySelector('[name=lsHow]:checked')?.value ?? 'send_frames');
      return Object.entries(FULFILMENT).map(([k, f]) => `
        <label class="fulfil-opt ${how === k ? 'on' : ''} ${k === 'send_frames' && shut ? 'is-off' : ''}">
          <input type="radio" name="lsHow" value="${k}" ${how === k ? 'checked' : ''} ${k === 'send_frames' && shut ? 'disabled' : ''}>
          <b>${esc(f.label)}</b>
          <span>${esc(k === 'send_frames' && shut ? benchNote(ls.holder) : !canCutOwnLenses(me.role) && f.subShop ? f.subShop : f.sub)}</span>
        </label>`).join('');
    };
    let layer = null;
    layer = openLayer('modal', () => `
      <div class="dw-head">
        <div><div class="dw-kicker">New fitting order</div><h2>Log a frame for lens fitting</h2></div>
        <button class="icon-btn" data-close>${icons.x}</button>
      </div>
      <form class="form" id="nf">
        <div class="grid2">
          ${BILL_ON ? billFieldHTML({ code: me.code, hidden: { name: 'ref' } }) : '<label>Bill number <input name="ref" required placeholder="e.g. B-58214" autofocus></label>'}
          <label>Customer name <input name="customer" required placeholder="e.g. Ahmed Al Balushi"></label>
        </div>
        <div class="ph-label"><span>Customer phone <span class="opt">for the WhatsApp message when it is ready</span></span>${phoneFieldHTML()}</div>
        <label>Customer collects at <select name="collect">${collectOptions(me.code)}</select></label>
        <div class="lens-src" role="radiogroup" aria-label="Lenses">
          <span class="lens-src-l">Lenses</span>
          <div class="chips status-chips">
            <label class="chip on"><input type="radio" name="lenses" value="none" checked>Regular</label>
            ${shelves.length ? '<label class="chip"><input type="radio" name="lenses" value="stock">Lens stock</label>' : ''}
            <label class="chip"><input type="radio" name="lenses" value="outside">Outside lenses</label>
          </div>
        </div>
        ${shelves.length ? `
        <div class="fieldset ls-fields" id="nf-ls" hidden>
          <div class="fs-head"><span>Lens stock</span>${shelves.length === 1 ? `<span class="muted sm">from ${esc(shelfName(shelves[0]))}</span>` : ''}</div>
          ${shelves.length > 1 ? `<label>Shelf <select name="lsHolder">${shelves.map(h => `<option value="${h.code}">${esc(shelfName(h))}</option>`).join('')}</select></label>` : ''}
          <div class="ls-lines" id="nf-ls-lines">${lsLinesHTML()}</div>
          <button type="button" class="btn btn-ghost btn-sm dm-add" data-ls-add>${icons.plus} Add lens</button>
          <div class="fulfil" id="nf-ls-way">${lsWayHTML()}</div>
        </div>` : ''}
        <div class="fieldset ol-fields" id="nf-ol" hidden>
          <div class="fs-head"><span>Prescription</span></div>
          <table class="ol-rx-in">
            <thead><tr><th></th><th>SPH</th><th>CYL</th><th>AXIS</th><th>ADD</th></tr></thead>
            <tbody>${['r', 'l'].map(eye => `<tr><th>${eye.toUpperCase()}</th>${['sph', 'cyl', 'axis', 'add'].map(k =>
              `<td><input name="${eye}_${k}" inputmode="decimal" autocomplete="off" placeholder="${k === 'axis' ? '0–180' : '0.00'}"></td>`).join('')}</tr>`).join('')}</tbody>
          </table>
          <label>Lens type <input name="lensType" placeholder="e.g. 1.5 progressive blue UV" autocomplete="off"></label>
          ${me.code === outsideHandler() ? '' :
            // A branch with an open bench of its own receives by default; the rest send the frame to a fitter.
            outsideWayHTML(canCutOwnLenses(me.role) && !isLabOff(me.code) ? 'receive_lens' : 'send_frames', 'MGM')}
        </div>
        <div class="form-foot">
          <button type="button" class="btn btn-ghost" data-close>Cancel</button>
          <button type="submit" class="btn btn-primary">${icons.send} Log order</button>
        </div>
      </form>
    `);
    layer.el.addEventListener('click', e => { if (e.target.closest('[data-close]')) layer.close(); });
    // Regular / Lens stock / Outside lenses: each opens its own fields.
    const lsBox = () => layer.el.querySelector('#nf-ls-lines');
    // The lens list: the portal's own dropdown, the full width of the row,
    // so long names wrap instead of being cut (user, 2026-10-17). Every word
    // typed must appear: "1.67 photo -3" finds the photochromic -3.00.
    const lsMatches = text => {
      const words = String(text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      return shelfItems().filter(i => words.every(w => lensLabel(i).toLowerCase().includes(w)));
    };
    // Each lens in columns (user, 2026-10-17): type - index, then the powers
    // in one box and the coating in another, lined up row under row.
    const lensCols = i => `
      <span class="ls-o-name">${esc(i.type)} - ${esc(i.index)}</span>
      <span class="ls-o-rx">SPH <b>${fmtPwr(i.sph)}</b><i></i>CYL <b>${fmtPwr(i.cyl)}</b></span>
      <span class="ls-o-coat">${i.coating && i.coating !== 'None' ? esc(i.coating) : '<i>No coating</i>'}</span>`;
    const lsMenu = n =>layer.el.querySelector(`[data-ls-menu="${n}"]`);
    const openMenu = (n, text) => {
      const m = lsMenu(n); if (!m) return;
      const list = lsMatches(text);
      m.innerHTML = list.length ? list.map((i, k) => `
        <button type="button" class="ls-opt ${k === 0 ? 'on' : ''}" data-ls-opt="${n}" data-id="${i.id}" role="option">
          ${lensCols(i)}<em>${i.qty} in stock</em>
        </button>`).join('') : '<p class="ls-none">No lens on this shelf matches that.</p>';
      m.hidden = false;
      layer.el.querySelector(`[data-ls-item="${n}"]`)?.setAttribute('aria-expanded', 'true');
    };
    const closeMenu = n => { const m = lsMenu(n); if (m) m.hidden = true; layer.el.querySelector(`[data-ls-item="${n}"]`)?.setAttribute('aria-expanded', 'false'); };
    const pickLens = (n, id) => {
      const l = ls.lines[n], hit = store.lensItem(id);
      if (!l || !hit) return;
      l.itemId = hit.id; l.text = lensLabel(hit); l.qty = Math.min(Math.max(1, +l.qty || 1), hit.qty);
      lsBox().innerHTML = lsLinesHTML();
      layer.el.querySelector(`[data-ls-qty="${n}"]`)?.focus();
    };
    // Opening the box shows every lens; once one is chosen, it shows them all
    // again rather than just the one already in the box.
    layer.el.addEventListener('focusin', e => {
      const it = e.target.closest('[data-ls-item]');
      if (!it) return;
      const chosen = store.lensItem(ls.lines[+it.dataset.lsItem]?.itemId);
      openMenu(+it.dataset.lsItem, chosen && it.value === lensLabel(chosen) ? '' : it.value);
    });
    layer.el.addEventListener('focusout', e => { const it = e.target.closest('[data-ls-item]'); if (it) setTimeout(() => closeMenu(+it.dataset.lsItem), 150); });
    layer.el.addEventListener('mousedown', e => { if (e.target.closest('[data-ls-opt]')) e.preventDefault(); });
    layer.el.addEventListener('keydown', e => {
      const it = e.target.closest('[data-ls-item]');
      if (!it) return;
      const n = +it.dataset.lsItem;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (lsMenu(n)?.hidden) openMenu(n, it.value);
        const all = [...lsMenu(n).querySelectorAll('.ls-opt')];
        if (!all.length) return;
        const at = all.findIndex(o => o.classList.contains('on'));
        const next = (at + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length;
        all.forEach((o, k) => o.classList.toggle('on', k === next));
        all[next].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        const on = lsMenu(n)?.hidden ? null : lsMenu(n)?.querySelector('.ls-opt.on');
        if (on) { e.preventDefault(); pickLens(n, on.dataset.id); }
      } else if (e.key === 'Escape') { closeMenu(n); }
    });
    layer.el.addEventListener('change', e => {
      const src = e.target.closest('[name=lenses]');
      if (src) {
        layer.el.querySelectorAll('.lens-src .chip').forEach(c => c.classList.toggle('on', c.contains(src)));
        layer.el.querySelector('#nf-ol').hidden = src.value !== 'outside';
        const lsf = layer.el.querySelector('#nf-ls');
        if (lsf) lsf.hidden = src.value !== 'stock';
        return;
      }
      if (e.target.name === 'lsHolder') {
        ls.holder = e.target.value; ls.lines = [{ itemId: '', qty: 1 }];
        lsBox().innerHTML = lsLinesHTML();
        layer.el.querySelector('#nf-ls-way').innerHTML = lsWayHTML();
        return;
      }
      if (e.target.name === 'lsHow') {
        layer.el.querySelectorAll('#nf-ls-way .fulfil-opt').forEach(o => o.classList.toggle('on', o.contains(e.target)));
        return;
      }
      const it = e.target.closest('[data-ls-item]');
      if (it) {
        // Leaving the box: keep what was typed; show the stock if it is a lens.
        const l = ls.lines[+it.dataset.lsItem];
        const hit = findItem(it.value);
        l.itemId = hit?.id ?? ''; l.text = it.value;
        if (hit) l.qty = Math.min(Math.max(1, +l.qty || 1), hit.qty);
        lsBox().innerHTML = lsLinesHTML();
      }
    });
    layer.el.addEventListener('input', e => {
      const q = e.target.closest('[data-ls-qty]');
      if (q) ls.lines[+q.dataset.lsQty].qty = q.value;
      // Picking from the list fills the box in one go: take it at once.
      const it = e.target.closest('[data-ls-item]');
      if (it) {
        // Typing narrows the list; the line holds a lens only once one is picked.
        const l = ls.lines[+it.dataset.lsItem];
        l.text = it.value;
        l.itemId = findItem(it.value)?.id ?? '';
        openMenu(+it.dataset.lsItem, it.value);
      }
    });
    layer.el.addEventListener('click', e => {
      const opt = e.target.closest('[data-ls-opt]');
      if (opt) return pickLens(+opt.dataset.lsOpt, opt.dataset.id);
      if (e.target.closest('.ls-pick svg')) { e.target.closest('.ls-pick').querySelector('input').focus(); return; }
      if (e.target.closest('[data-ls-add]')) { ls.lines.push({ itemId: '', qty: 1 }); lsBox().innerHTML = lsLinesHTML(); return; }
      const d = e.target.closest('[data-ls-del]');
      if (d) { ls.lines.splice(+d.dataset.lsDel, 1); lsBox().innerHTML = lsLinesHTML(); }
    });
    wireWay(layer.el);
    wirePhoneFields(layer.el);
    wireBillFields(layer.el);
    layer.el.querySelector('#nf').addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      let ref = f.get('ref').trim();
      const customer = f.get('customer').trim();
      const collect = String(f.get('collect') || me.code);
      const phone = phoneValue(e.target.querySelector('[data-ph]'));
      // A name of only spaces passes the browser's own required check, so put
      // the trimmed values back and let it re-check — that way an empty field
      // gets the usual prompt instead of a button that quietly does nothing.
      e.target.elements.ref.value = ref;
      e.target.elements.customer.value = customer;
      if (!e.target.reportValidity()) return;
      // The bill: there already? Asked whether this is another pair (bill.js);
      // the ones there are renumbered only when this one is saved.
      let plan = null;
      if (BILL_ON) {
        plan = await planOrderBill(ref, { customer, preview: id => { const x = store.order(id); return x ? previewRowHTML(x) : ''; } });
        if (!plan) return;
      }
      const finalRef = async () => {
        if (!plan?.pair) return ref;
        try { ref = await takePair(plan.base); return ref; } catch (err) { toast({ title: 'Could not add the pair', sub: err.message, tone: 'stock' }); return null; }
      };
      // The order is written to the database, which can refuse it (a bill
      // number already used here), so the form stays open until it lands.
      const go = e.target.querySelector('[type=submit]');
      go.disabled = true;
      const was = go.innerHTML;
      go.textContent = 'Saving…';
      let o;
      const src = String(f.get('lenses') || 'none');
      if (src === 'stock') {
        // One line per lens, the same lens twice adds up; never more than the shelf holds.
        const byItem = new Map();
        for (const l of ls.lines) {
          const i = store.lensItem(l.itemId);
          if (i) byItem.set(i.id, Math.min(i.qty, (byItem.get(i.id) ?? 0) + Math.max(1, parseInt(l.qty, 10) || 1)));
        }
        const lines = [...byItem].map(([id, qty]) => { const i = store.lensItem(id); return { itemId: i.id, type: i.type, index: i.index, coating: i.coating, sph: i.sph, cyl: i.cyl, qty }; });
        if (!lines.length) { toast({ title: 'Choose the lenses', sub: `Pick at least one lens from ${locName(ls.holder)}'s shelf.`, tone: 'stock' }); go.disabled = false; go.innerHTML = was; return; }
        if (ls.lines.some(l => (l.text ?? '').trim() && !l.itemId)) { toast({ title: 'Pick a lens from the list', sub: 'A line has text that is not a lens on the shelf.', tone: 'stock' }); go.disabled = false; go.innerHTML = was; return; }
        const how = String(f.get('lsHow') || (isBenchClosed(ls.holder) ? 'receive_lens' : 'send_frames'));
        const useRef = await finalRef();
        if (!useRef) { go.disabled = false; go.innerHTML = was; return; }
        const r = own()
          ? await store.useOwnStock({ lines, billNo: useRef, customer }, me.code)
          : await store.createLensRequest({ lines, billNo: useRef, customer, fulfilment: how, holder: ls.holder }, me.code);
        o = r?.orderId ? store.order(r.orderId) : null;
        if (o && collect !== me.code) await store.setCollect(o.id, collect, me.code);
        if (r && !o) { layer.close(); return; }
      } else if (src === 'outside') {
        const val = k => String(f.get(k) ?? '').trim();
        const rx = Object.fromEntries(['r', 'l'].map(eye => [eye, Object.fromEntries(['sph', 'cyl', 'axis', 'add'].map(k => [k, val(`${eye}_${k}`)]))]));
        const lensType = val('lensType');
        if (!rx.r.sph && !rx.l.sph) { toast({ title: 'Enter the prescription', sub: 'At least the SPH for one eye.', tone: 'stock' }); go.disabled = false; go.innerHTML = was; return; }
        if (!lensType) { toast({ title: 'Type the lens type', sub: 'e.g. 1.5 progressive blue UV', tone: 'stock' }); go.disabled = false; go.innerHTML = was; return; }
        const how = val('olHow') || 'receive_lens';
        const useRef = await finalRef();
        if (!useRef) { go.disabled = false; go.innerHTML = was; return; }
        o = await store.createOutsideOrder({ ref: useRef, customer, rx, lensType, fulfilment: how, dest: how === 'send_frames' ? val('olDest') : null }, me.code);
        if (o && collect !== me.code) await store.setCollect(o.id, collect, me.code);
      } else {
        const useRef = await finalRef();
        if (!useRef) { go.disabled = false; go.innerHTML = was; return; }
        o = await store.createOrder({ ref: useRef, origin: me.code, customer, collect }, me.code);
      }
      if (!o) {
        if (plan?.pair) await fixPairs(plan.base);     // not saved: number the others back
        go.disabled = false; go.innerHTML = was; return;
      }
      if (phone) await store.setOrderPhone(o.id, phone, me.code);
      layer.close();
      toast({
        title: `${o.ref} logged`,
        sub: src === 'stock' ? (own() ? 'Lenses taken off your shelf — use “Send to Fitting” to keep it here or send it' : `Lenses requested from ${locName(ls.holder)}`)
          : me.role === 'fitting'
            ? 'Use “Send to Fitting” when the lenses arrive'
            : 'Use “Send to Fitting” when it leaves your branch',
        tone: 'info',
      });
    });
  }

  // ── render ──
  function render() {
    root.innerHTML = `
      <header class="mod-head">
        <div>
          <h1>Fitting Log</h1>
          <p class="mod-sub">${isAdmin ? 'Every frame travelling across the network' : 'Frames travelling between your branch and the fitting centres'}</p>
        </div>
        <div class="mod-head-acts">
        <span id="f-bench">${benchBtnHTML()}</span>
        ${!isAdmin && LENS_HOLDERS.length ? `<button class="btn btn-ghost" data-shelves>${icons.lens} Lens stock</button>` : ''}
        ${!isAdmin ? `<button class="btn btn-primary" data-new>${icons.plus} New fitting order</button>`
          : can(me, 'lists') ? `<button class="btn btn-ghost" data-cutters>${icons.settings} Outside cutters</button>` : ''}
        </div>
      </header>
      <section class="toolbar">
        <div class="searchbox">${icons.search}<input id="f-q" placeholder="Search ref, customer, frame, location…" value="${esc(ui.q)}"></div>
        ${!isAdmin ? `<select class="sel" id="f-branch" aria-label="Branch"><option value="all">All branches</option>${branchOptions()}</select>` : ''}
        ${isAdmin ? `
          <select class="sel" id="f-origin" aria-label="Branch it was sold at"><option value="all">All branches</option>${BRANCHES.map(b => `<option value="${b.code}" ${ui.origin === b.code ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>
          <select class="sel" id="f-fitter"><option value="all">All fitters</option>${FITTERS.map(b => `<option value="${b.code}" ${ui.fitter === b.code ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}<option value="OUT" ${ui.fitter === 'OUT' ? 'selected' : ''}>Outside cutters</option></select>` : ''}
        <div class="chips status-chips day-chips" id="f-days" role="group" aria-label="How far back">${daysHTML()}</div>
      </section>
      <section class="chips status-chips" id="f-chips">${chipsHTML()}</section>
      <div id="f-bulk">${bulkHTML()}</div>
      <div id="f-selall">${selectAllHTML()}</div>
      <section class="list ${isTablet() ? 't-list' : ''}" id="f-list">${rowsHTML()}</section>
      <div id="f-older">${ui.chip === 'collected' ? olderHTML(store.historyDays, store.olderLoaded('orders')) : ''}</div>`;
    wire();
    markSeen();
  }

  function refreshLists() {
    root.querySelector('#f-chips').innerHTML = chipsHTML();
    root.querySelector('#f-days').innerHTML = daysHTML();
    root.querySelector('#f-bulk').innerHTML = bulkHTML();
    root.querySelector('#f-selall').innerHTML = selectAllHTML();
    const fo = root.querySelector('#f-older');
    if (fo) fo.innerHTML = ui.chip === 'collected' ? olderHTML(store.historyDays, store.olderLoaded('orders')) : '';
    const fbn = root.querySelector('#f-bench');
    if (fbn) fbn.innerHTML = benchBtnHTML();
    root.querySelector('#f-list').innerHTML = rowsHTML();
    const fb = root.querySelector('#f-branch');
    if (fb && document.activeElement !== fb) fb.innerHTML = `<option value="all">All branches</option>${branchOptions()}`;
    markSeen();
    drawer?.update();
  }

  // A fitting centre sets its own Lab, one click, no questions: On; In-house
  // only — it cuts its own jobs but other branches can't send it any; Off —
  // the fitter is on leave (user, 2026-10-13/14).
  const LAB_TIPS = {
    on: 'Taking frames from every branch',
    inhouse: 'Cutting your own jobs only — other branches can’t send frames or lenses here',
    off: 'Fitter on leave — nothing can be sent or cut here',
  };
  function benchBtnHTML() {
    if (me.role !== 'fitting' || viewOnly) return '';
    const mode = labMode(me.code);
    return `
      <div class="lab-seg is-${mode}" role="group" aria-label="Lab">
        <span class="lab-seg-l">Lab</span>
        ${LAB_MODES.map(([k, label]) => `<button type="button" class="${mode === k ? 'on' : ''}" data-lab="${k}" aria-pressed="${mode === k}" title="${esc(LAB_TIPS[k])}">${label}</button>`).join('')}
      </div>`;
  }

  function branchOptions() {
    return partnerBranches().map(c => `<option value="${c}" ${ui.branch === c ? 'selected' : ''}>${esc(locName(c))}</option>`).join('');
  }

  function daysHTML() {
    return DAY_FILTERS.map(d => `<button class="chip ${ui.days === d ? 'on' : ''}" data-days="${d}">${d ? `${d} day${d === 1 ? '' : 's'}` : 'Any time'}</button>`).join('');
  }

  // Select every order on the open chip — not on "All active", where they need
  // different things done. Completed orders cannot be selected.
  // Only orders with a step for this location to press can be selected; Select
  // all takes the ones sharing the most common step (user, 2026-10-15), so the
  // bulk button always works.
  const actionOf = o => lensAct(o) ?? (lensOnly(o) || handlerStage(o, me.code) ? null : bulkLabel(o));
  const canSelect = o => o.status !== 'collected' && !!actionOf(o);
  const selectable = () => visible().filter(canSelect);
  // Select all (user, 2026-10-18): always shown — greyed when nothing here
  // has a step to press — and it takes every order that has one, whatever
  // the step; the bulk button then does each order's own step.
  function selectAllHTML() {
    const steps = stepsHTML();
    if (viewOnly) return steps ? `<div class="sel-row">${steps}</div>` : '';
    const list = selectable();
    const all = list.length > 0 && list.every(o => ui.selected.has(o.id));
    return `<div class="sel-row">
      <label class="sel-all ${list.length ? '' : 'is-off'}" ${list.length ? '' : 'title="Nothing here has a step for you to press"'}>
        <span class="cbx"><input type="checkbox" data-sel-all ${all ? 'checked' : ''} ${list.length ? '' : 'disabled'}><i></i></span>
        <span>Select all${list.length ? ` <span class="muted">· ${list.length}</span>` : ''}</span>
      </label>${steps}</div>`;
  }

  function markSeen() {
    for (const o of store.state.orders) { ui.seen.add(o.id); ui.prevStatus.set(o.id, o.status); }
  }

  function toggleSelect(id) {
    const o = store.order(id);
    if (!o || !canSelect(o) || viewOnly) return;
    if (ui.selected.has(id)) ui.selected.delete(id); else ui.selected.add(id);
    refreshLists();
  }

  function wire() {
    root.querySelector('#f-q').addEventListener('input', e => { ui.q = e.target.value; refreshLists(); });
    root.querySelector('#f-branch')?.addEventListener('change', e => { ui.branch = e.target.value; ui.selected.clear(); refreshLists(); });
    root.querySelector('[data-new]')?.addEventListener('click', newOrderModal);
    root.querySelector('[data-shelves]')?.addEventListener('click', () => { shelfView = openShelfBrowser(me, { onNew: newOrderModal }); });
    root.querySelector('[data-cutters]')?.addEventListener('click', cuttersModal);
    root.querySelector('#f-bench')?.addEventListener('click', e => { const b = e.target.closest('[data-lab]'); if (b && b.dataset.lab !== labMode(me.code)) store.setLab(me.code, b.dataset.lab); });
    root.querySelector('#f-origin')?.addEventListener('change', e => { ui.origin = e.target.value; refreshLists(); });
    root.querySelector('#f-fitter')?.addEventListener('change', e => { ui.fitter = e.target.value; refreshLists(); });

    root.addEventListener('click', e => {
      const chip = e.target.closest('[data-chip]');
      if (chip) { ui.chip = chip.dataset.chip; ui.selected.clear(); pickStep(); refreshLists(); return; }
      const stp = e.target.closest('[data-step]');
      if (stp) { ui.step = stp.dataset.step; ui.selected.clear(); refreshLists(); return; }
      if (e.target.closest('[data-older]')) { e.target.closest('[data-older]').disabled = true; store.loadOlder('orders'); return; }
      const dd = e.target.closest('[data-days]');
      if (dd) { ui.days = +dd.dataset.days; ui.selected.clear(); refreshLists(); return; }
      const sa = e.target.closest('[data-sel-all]');
      if (sa) {
        const list = selectable();
        if (sa.checked) { ui.selected.clear(); list.forEach(o => ui.selected.add(o.id)); } else ui.selected.clear();
        refreshLists(); return;
      }
      if (e.target.closest('[data-bulk-clear]')) { ui.selected.clear(); refreshLists(); return; }
      if (e.target.closest('[data-bulk-act]')) {
        const { action, ok } = bulkAction();
        if (!ok) return;
        const ids = [...ui.selected];
        // A lens step: each order's own lens action, one after another.
        const lensOrders = ids.map(id => store.order(id)).filter(o => o && lensAct(o));
        if (lensOrders.length) {
          (async () => {
            const confirmIds = lensOrders.filter(toOrder).map(o => o.outsideLens.id);
            if (confirmIds.length) await store.setOutsideStatus(confirmIds, 'ordered', me.code);
            for (const o of lensOrders) {
              if (canSendLenses(o, me.code)) await store.sendLenses(o.lensRequest.id, me.code);
              else if (canArriveOutside(o, me.code)) await store.arriveOutsideLenses(o.outsideLens.id, me.code);
              else if (canSendOutside(o, me.code)) await store.sendOutsideLenses(o.outsideLens.id, me.code);
            }
          })();
          ids.splice(0, ids.length, ...ids.filter(id => !lensOrders.some(o => o.id === id)));
          if (!ids.length) { ui.selected.clear(); refreshLists(); return; }
        }
        // Frames with no fitter yet are sent through the picker; frames a lens
        // request already gave one simply go.
        const unassigned = ids.filter(id => !store.order(id)?.fitter);
        if (unassigned.some(id => actionOf(store.order(id)) === 'Send to Fitting')) {
          const assigned = ids.filter(id => !unassigned.includes(id));
          if (assigned.length) store.advanceOrders(assigned, me.code);
          fitterPicker(unassigned); return; // picker clears selection on send
        }
        ui.selected.clear();
        store.advanceOrders(ids, me.code); // store change triggers refresh
        return;
      }
      // Open the detail drawer via the arrow button.
      const openBtn = e.target.closest('[data-open]');
      if (openBtn) { e.stopPropagation(); openDrawer(openBtn.dataset.open); return; }
      const sl = e.target.closest('[data-send-lenses]');
      if (sl) { e.stopPropagation(); store.sendLenses(sl.dataset.sendLenses, me.code); return; }
      const so = e.target.closest('[data-send-outside]');
      if (so) { e.stopPropagation(); store.sendOutsideLenses(so.dataset.sendOutside, me.code); return; }
      const ro = e.target.closest('[data-recv-outside]');
      if (ro) { e.stopPropagation(); store.receiveOutsideLenses(ro.dataset.recvOutside, me.code); return; }
      const ao = e.target.closest('[data-arrive-outside]');
      if (ao) { e.stopPropagation(); store.arriveOutsideLenses(ao.dataset.arriveOutside, me.code); return; }
      const ho = e.target.closest('[data-hub-out]');
      if (ho) return hubOutPicker(ho.dataset.hubOut);
      const sf = e.target.closest('[data-send-fitter]');
      if (sf) { e.stopPropagation(); fitterPicker(sf.dataset.sendFitter); return; }
      const adv = e.target.closest('[data-advance]');
      if (adv) {
        e.stopPropagation();
        const id = adv.dataset.advance;
        store.advanceOrders([id], me.code).then(done => {
          const o = done?.[0];
          if (o && isTablet()) toast({ title: `${o.ref} — ${fitStep(o, { viewer: me.code }).label}`, sub: o.customer || '', ms: 7000,
            action: canUndoOrder(o, me.code) ? { label: 'Undo', run: () => store.undoOrderStep(o.id, me.code) } : null });
        });
        return;
      }
      const wa = e.target.closest('[data-wa]');
      if (wa) { e.stopPropagation(); messageCustomer(wa.dataset.wa); return; }
      const sel = e.target.closest('[data-sel]');
      if (sel) { toggleSelect(sel.dataset.sel); return; }
      if (e.target.closest('[data-stop]')) return;
      const card = e.target.closest('[data-card]');
      if (card) { openDrawer(card.dataset.card); return; }
      // Clicking the row selects it.
      const row = e.target.closest('[data-select]');
      if (row) toggleSelect(row.dataset.select);
    });
  }

  return {
    mount(container) { root = container; render(); },
    onChange() { refreshLists(); shelfView?.refresh(); },
    unmount() { closeLayer(); },
  };
}
