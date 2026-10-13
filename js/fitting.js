// ── Module 1: Fitting Log — the frame's journey branch → fitter → branch ──
import {
  FIT_FLOW, FIT_STATUS, FITTERS, BRANCHES, FULFILMENT, LENSREQ_STATUS,
  locName, fitStep, fitActor, isSelfFit, onShortRoad, canAdvanceOrder, needsAction, fmtPwr, seesAll, readOnly, canSendLenses, isBack,
  fulfilmentSwitch,
  isOutside, OUTSIDE_DEFAULT, outsideHandler, OUTSIDE_STATUS, OUTSIDE_FULFILMENT,
  outsideLensState, canSendOutside, canReceiveOutside, outsideBlocked, outsideCanChange, canCutOwnLenses, awaitingOutside,
  isBenchClosed, benchNote,
} from './data.js';
import { store } from './store.js';
import { esc, relTime, fmtDT, icons, pill, stepPill, locChip, openLayer, closeLayer, toast, chipCount } from './ui.js';

// How far back to look (user, 2026-10-13): by the day an order was logged —
// on Completed, by the day it was completed. 0 = any time.
const DAY_FILTERS = [0, 1, 3, 7, 14, 30];

// One chip per distinct label, so two stages that read the same — on the way
// to the fitter and on the bench are both "Waiting to be Fitted" — share a chip
// rather than showing the same words twice. A chip's key is its first status.
const CHIP_DEFS = [{ key: 'active', label: 'All active' }];
for (const s of FIT_FLOW.filter(s => s !== 'collected')) {
  const same = CHIP_DEFS.find(d => d.label === FIT_STATUS[s].label);
  if (same) same.statuses.push(s);
  else CHIP_DEFS.push({ key: s, label: FIT_STATUS[s].label, statuses: [s] });
}
// Frames at an outside cutter have their own chip, not "In transit".
for (const d of CHIP_DEFS) if (d.statuses?.includes('to_fitter')) d.test = o => d.statuses.includes(o.status) && !(o.status === 'to_fitter' && isOutside(o));
CHIP_DEFS.push({ key: 'outside', label: 'Outside cutter', statuses: ['to_fitter'], test: o => o.status === 'to_fitter' && isOutside(o) });
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
    seen: new Set(store.state.orders.map(o => o.id)),
    prevStatus: new Map(store.state.orders.map(o => [o.id, o.status])),
  };
  let root, drawer = null, drawerId = null;
  // The office and the schedule editor see every frame; only the office acts.
  const isAdmin = seesAll(me.role);
  const viewOnly = readOnly(me.role);

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
  function visible() {
    let list = filtered();
    if (ui.chip === 'active') list = list.filter(o => o.status !== 'collected');
    else {
      const chip = CHIP_DEFS.find(d => d.key === ui.chip);
      list = list.filter(o => chip && onChip(chip, o));
    }
    return list.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  // The other branches this one shares orders with, for its branch filter.
  const partnerBranches = () => [...new Set(store.ordersFor(me.code)
    .flatMap(o => [o.origin, o.fitter]).filter(c => c && c !== me.code))]
    .sort((a, b) => locName(a).localeCompare(locName(b)));
  const counts = () => {
    const all = filtered();
    const c = { active: all.filter(o => o.status !== 'collected').length };
    for (const d of CHIP_DEFS.slice(1)) c[d.key] = all.filter(o => onChip(d, o)).length;
    return c;
  };

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
    if (onShortRoad(o)) return `
      <div class="journey journey-self ${big ? 'journey-big' : ''}" title="${esc(fitterName)} — sold and fitted here, no transit">
        ${node(o.fitter, `${isBack(o) ? 'ready' : 'done'} j-mid`, fitterName, tail)}
        <span class="j-inhouse">${isBack(o) ? 'Fitted in-house' : 'In-house — no transit'}</span>
      </div>`;
    return `
      <div class="journey ${big ? 'journey-big' : ''}" title="${esc(locName(o.origin))} → ${esc(fitterName)} → back">
        ${node(o.origin, 'done', locName(o.origin))}
        <i class="j-seg ${seg1}"></i>
        ${node(fitterCode, `${fitterCls} j-mid`, fitterName, tail)}
        <i class="j-seg ${seg2}"></i>
        ${node(o.origin, stage >= at('delivered') ? 'done' : '', 'Back at branch')}
      </div>`;
  }

  function lensLeg(o) {
    if (o.status !== 'pending') return null;
    const lr = o.lensRequest;
    if (lr && lr.fulfilment === 'receive_lens' && me.code === lr.holder && o.origin !== me.code)
      return { from: me.code, to: o.origin, moving: ['sent', 'confirmed'].includes(lr.status) };
    return null;
  }

  // ── stats tiles ──
  function statsHTML() {
    const all = store.ordersFor(me.code);
    const active = all.filter(o => o.status !== 'collected');
    const mine = active.filter(o => needsAction(o, me.code));
    const week = all.filter(o => o.status === 'collected' && Date.now() - o.updatedAt < 7 * 864e5);
    const t = (n, lbl, cls = '') => `
      <div class="stat ${cls}"><div class="stat-n">${n}</div><div class="stat-l">${lbl}</div></div>`;
    return t(active.length, 'Active orders')
      + t(mine.length, isAdmin ? 'Awaiting action' : 'Need your action', mine.length ? 'stat-amber' : 'stat-brand')
      + t(week.length, 'Completed · 7d');
  }

  // ── list ──
  function rowsHTML() {
    const list = visible();
    if (!list.length) return `<div class="empty">${icons.glasses}<p>No orders match this view.</p></div>`;
    return list.map(o => {
      const isNew = !ui.seen.has(o.id);
      const changed = ui.prevStatus.get(o.id) !== o.status;
      const can = canAdvanceOrder(o, me.code);
      const st = fitStep(o, { viewer: me.code });
      const selected = ui.selected.has(o.id);
      const needsFitter = o.status === 'lenses_in' && !o.fitter && !isOutside(o);
      // Primary action: pick a fitter, advance, or show who we're waiting on.
      let action;
      // The handler's first job on any outside order: order the lens — the button opens the list.
      if (o.outsideLens && o.outsideLens.status !== 'ordered' && me.code === outsideHandler() && !isBack(o) && !viewOnly)
        action = `<a class="btn btn-primary btn-sm" href="#/outside">Order lens ${icons.arrowRight}</a>`;
      else if (canSendLenses(o, me.code) && !viewOnly) action = `<button class="btn btn-primary btn-sm" data-send-lenses="${o.lensRequest.id}">${icons.send} Send lenses</button>`;
      else if (canSendOutside(o, me.code) && !viewOnly) action = `<button class="btn btn-primary btn-sm" data-send-outside="${o.outsideLens.id}">${icons.send} Send lenses to ${esc(o.outsideLens.dest)}</button>`;
      else if (outsideBlocked(o) && fitActor(o) === me.code && !canReceiveOutside(o, me.code)) action = `<span class="row-actor">waiting for the lenses</span>`;
      else if (o.status === 'lenses_in' && o.fitter && o.fitter !== o.origin && isBenchClosed(o.fitter)) action = `<span class="row-actor" title="${esc(benchNote(o.fitter))}">${esc(o.fitter)} lab off</span>`;
      else if (needsFitter && can) action = `<button class="btn btn-primary btn-sm" data-send-fitter="${o.id}">${icons.send} Send to fitter</button>`;
      else if (can && st.action) action = `<button class="btn btn-primary btn-sm" data-advance="${o.id}">${esc(st.action)} ${icons.arrowRight}</button>`;
      else action = `<span class="row-actor">${o.status === 'collected' ? icons.check : `waiting on ${esc(fitActor(o) ?? '')}`}</span>`;
      // The fitter marks the outside lenses received — alongside the frame's own step.
      if (canReceiveOutside(o, me.code) && !viewOnly) {
        const lens = `<button class="btn btn-primary btn-sm" data-recv-outside="${o.outsideLens.id}">Lens received ${icons.arrowRight}</button>`;
        action = action.startsWith('<span') ? lens : `${lens}${action}`;
      }
      const title = o.customer || 'No customer name';
      const fromStock = !!store.lensRequestForOrder(o.id);
      return `
      <div class="row ${isNew ? 'row-enter' : ''} ${selected ? 'row-selected' : ''}" data-select="${o.id}">
        <label class="cbx" data-stop><input type="checkbox" data-sel="${o.id}" ${selected ? 'checked' : ''} ${o.status === 'collected' || viewOnly ? 'disabled' : ''}><i></i></label>
        <div class="row-main">
          <div class="row-title">
            <b>${esc(o.ref)}</b>
            <span class="row-cust">${esc(title)}</span>
          </div>
          <div class="row-sub"><span class="row-when" title="Logged ${fmtDT(o.createdAt)}">${relTime(o.createdAt)}</span>${fromStock ? stockTag('stock-tag-sub') : o.outsideLens ? outsideLensTag('stock-tag-sub') : ''}</div>
        </div>
        <div class="row-journey">${journey(o, false, fromStock ? stockTag() : o.outsideLens ? outsideLensTag() : '')}</div>
        <div class="row-status">${stepPill(st, { flash: changed, title: fitStep(o, { long: true, viewer: me.code }).label })}</div>
        <div class="row-act" data-stop>
          ${action}
          <button class="icon-btn open-arrow" data-open="${o.id}" title="Open order">${icons.chevronRight}</button>
        </div>
      </div>`;
    }).join('');
  }

  // The one next action shared by every selected order — or null if they
  // need different actions (mixed stages / waiting on someone else).
  function bulkAction() {
    const sel = [...ui.selected].map(id => store.order(id)).filter(Boolean);
    let action = null, ok = sel.length > 0;
    for (const o of sel) {
      const label = !canAdvanceOrder(o, me.code) ? null
        : (o.status === 'lenses_in' && !o.fitter) ? 'Send to fitter'
        : fitStep(o).action;
      if (!label) { ok = false; continue; }
      if (action === null) action = label;
      else if (action !== label) ok = false;
    }
    return { count: sel.length, action, ok: ok && !!action };
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
        ${!ok ? `<span class="bulk-hint">selected orders need different actions</span>` : ''}
        <button class="btn btn-ghost btn-sm" data-bulk-clear>Clear</button>
      </div>`;
  }

  function chipsHTML() {
    const c = counts();
    // How many in each chip are waiting on this location.
    const mine = viewOnly ? [] : store.ordersFor(me.code).filter(o => o.status !== 'collected' && needsAction(o, me.code));
    const act = d => (d.key === 'active' ? mine.length : mine.filter(o => onChip(d, o)).length);
    return CHIP_DEFS.map(d => `${d.key === 'collected' ? '<span class="chip-sep"></span>' : ''}
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
        <div class="dw-status-row">${stepPill(st)}<span class="dw-when">updated ${relTime(o.updatedAt)}</span></div>
        ${journey(o, true)}
        <div class="kv">
          <div><span>Origin</span><b>${locChip(o.origin)} ${esc(locName(o.origin))}</b></div>
          <div><span>Fitting centre</span><b>${isOutside(o) ? `<span class="loc-chip">OUT</span> ${esc(o.outside)} <span class="muted">· outside, 3rd party</span>`
            : o.fitter ? `${locChip(o.fitter)} ${esc(locName(o.fitter))}${isSelfFit(o) ? ' <span class="muted">· in-house</span>' : ''}` : '<span class="muted">Not assigned yet</span>'}</b></div>
          ${o.note ? `<div class="kv-wide"><span>Note</span><b>${esc(o.note)}</b></div>` : ''}
        </div>
        ${stockLensHTML(store.lensRequestForOrder(o.id))}
        ${outsideLensHTML(o)}
        <div class="dw-actions">
          ${canReceiveOutside(o, me.code) && !viewOnly ? `<button class="btn btn-primary" data-recv-outside="${o.outsideLens.id}">Lens received ${icons.arrowRight}</button>` : ''}
          ${canSendLenses(o, me.code) && !viewOnly ? `<button class="btn btn-primary" data-send-lenses="${o.lensRequest.id}">${icons.send} Send lenses to ${esc(locName(o.origin))}</button>` :
            canSendOutside(o, me.code) && !viewOnly ? `<button class="btn btn-primary" data-send-outside="${o.outsideLens.id}">${icons.send} Send lenses to ${esc(locName(o.outsideLens.dest))}</button>` :
            needsFitter && can ? `<button class="btn btn-primary" data-send-fitter="${o.id}">${icons.send} Send to fitter</button>` :
            can && st.action ? `<button class="btn btn-primary" data-advance="${o.id}">${esc(st.action)} ${icons.arrowRight}</button>` : ''}
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
      const sw = e.target.closest('[data-switch]');
      if (sw) return switchFulfilment(sw.dataset.switch, sw.dataset.to);
      const sf = e.target.closest('[data-send-fitter]');
      if (sf) return fitterPicker(sf.dataset.sendFitter);
      const adv = e.target.closest('[data-advance]');
      if (adv) return store.advanceOrders([adv.dataset.advance], me.code);

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
        <span>${open.length ? `Your frame and ${hName}'s lenses both go there to be cut.` : 'No fitter is open right now.'}</span>
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
        <div><div class="dw-kicker">Send to fitter</div><h2>Choose a fitting centre for ${esc(what)}</h2></div>
        <button class="icon-btn" data-close>${icons.x}</button>
      </div>
      <div class="form">
        <div class="picker-grid">
          ${order.map(f => { const shut = isBenchClosed(f.code); return `
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
          ${cutters.map(n => `
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
      const out = e.target.closest('[data-outside]');
      if (out) {
        ui.selected.clear();
        store.sendOrdersOutside(orders.map(o => o.id), out.dataset.outside, me.code);
        layer.close();
      }
    });
  }

  // ── outside cutters (the office) — the 3rd parties Send to fitter offers ──
  function cuttersModal() {
    const layer = openLayer('modal', () => {
      const list = store.settings.outsideCutters ?? [];
      return `
      <div class="dw-head">
        <div><div class="dw-kicker">Fitting Log</div><h2>Outside cutters</h2></div>
        <button class="icon-btn" data-close>${icons.x}</button>
      </div>
      <div class="form">
        ${list.length ? `<div class="set-brands">${list.map(n => `
          <span class="set-brand set-plain">${esc(n)}<button class="brand-x" data-del-cutter="${esc(n)}" title="Remove">${icons.x}</button></span>`).join('')}</div>`
          : `<div class="empty">${icons.glasses}<p>No outside cutters named yet — add the first below.</p></div>`}
        <form class="set-add" id="add-cutter" autocomplete="off">
          <input name="name" placeholder="New outside cutter — e.g. the lab's name" required>
          <button class="btn btn-primary btn-sm" type="submit">${icons.plus} Add cutter</button>
        </form>
      </div>`;
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
    const layer = openLayer('modal', () => `
      <div class="dw-head">
        <div><div class="dw-kicker">New fitting order</div><h2>Log a frame for lens fitting</h2></div>
        <button class="icon-btn" data-close>${icons.x}</button>
      </div>
      <form class="form" id="nf">
        <div class="grid2">
          <label>Bill number <input name="ref" required placeholder="e.g. B-58214" autofocus></label>
          <label>Customer name <input name="customer" required placeholder="e.g. Ahmed Al Balushi"></label>
        </div>
        <label class="ol-switch">
          <span class="sw"><input type="checkbox" name="outside" id="nf-outside"><i></i></span>
          <span><b>Outside lenses</b> <span class="muted">· other brands</span></span>
        </label>
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
            outsideWayHTML(canCutOwnLenses(me.role) && !isBenchClosed(me.code) ? 'receive_lens' : 'send_frames', 'MGM')}
        </div>
        <div class="form-foot">
          <button type="button" class="btn btn-ghost" data-close>Cancel</button>
          <button type="submit" class="btn btn-primary">${icons.send} Log order</button>
        </div>
      </form>
    `);
    layer.el.addEventListener('click', e => { if (e.target.closest('[data-close]')) layer.close(); });
    // The outside-lens fields open under the switch.
    const outsideBox = layer.el.querySelector('#nf-outside');
    outsideBox.addEventListener('change', () => { layer.el.querySelector('#nf-ol').hidden = !outsideBox.checked; });
    wireWay(layer.el);
    layer.el.querySelector('#nf').addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      const ref = f.get('ref').trim();
      const customer = f.get('customer').trim();
      // A name of only spaces passes the browser's own required check, so put
      // the trimmed values back and let it re-check — that way an empty field
      // gets the usual prompt instead of a button that quietly does nothing.
      e.target.elements.ref.value = ref;
      e.target.elements.customer.value = customer;
      if (!e.target.reportValidity()) return;
      // The order is written to the database, which can refuse it (a bill
      // number already used here), so the form stays open until it lands.
      const go = e.target.querySelector('[type=submit]');
      go.disabled = true;
      const was = go.innerHTML;
      go.textContent = 'Saving…';
      let o;
      if (f.get('outside')) {
        const val = k => String(f.get(k) ?? '').trim();
        const rx = Object.fromEntries(['r', 'l'].map(eye => [eye, Object.fromEntries(['sph', 'cyl', 'axis', 'add'].map(k => [k, val(`${eye}_${k}`)]))]));
        const lensType = val('lensType');
        if (!rx.r.sph && !rx.l.sph) { toast({ title: 'Enter the prescription', sub: 'At least the SPH for one eye.', tone: 'stock' }); go.disabled = false; go.innerHTML = was; return; }
        if (!lensType) { toast({ title: 'Type the lens type', sub: 'e.g. 1.5 progressive blue UV', tone: 'stock' }); go.disabled = false; go.innerHTML = was; return; }
        const how = val('olHow') || 'receive_lens';
        o = await store.createOutsideOrder({ ref, customer, rx, lensType, fulfilment: how, dest: how === 'send_frames' ? val('olDest') : null }, me.code);
      } else {
        o = await store.createOrder({ ref, origin: me.code, customer }, me.code);
      }
      if (!o) { go.disabled = false; go.innerHTML = was; return; }
      layer.close();
      toast({
        title: `${o.ref} logged`,
        sub: me.role === 'fitting'
          ? 'Use “Send to fitter” when the lenses arrive'
          : 'Use “Send to fitter” when it leaves your branch',
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
        ${!isAdmin ? `<button class="btn btn-primary" data-new>${icons.plus} New fitting order</button>`
          : me.role === 'admin' ? `<button class="btn btn-ghost" data-cutters>${icons.settings} Outside cutters</button>` : ''}
        </div>
      </header>
      <section class="stats" id="f-stats">${statsHTML()}</section>
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
      <section class="list" id="f-list">${rowsHTML()}</section>`;
    wire();
    markSeen();
  }

  function refreshLists() {
    root.querySelector('#f-stats').innerHTML = statsHTML();
    root.querySelector('#f-chips').innerHTML = chipsHTML();
    root.querySelector('#f-days').innerHTML = daysHTML();
    root.querySelector('#f-bulk').innerHTML = bulkHTML();
    root.querySelector('#f-selall').innerHTML = selectAllHTML();
    const fbn = root.querySelector('#f-bench');
    if (fbn) fbn.innerHTML = benchBtnHTML();
    root.querySelector('#f-list').innerHTML = rowsHTML();
    const fb = root.querySelector('#f-branch');
    if (fb && document.activeElement !== fb) fb.innerHTML = `<option value="all">All branches</option>${branchOptions()}`;
    markSeen();
    drawer?.update();
  }

  // A fitting centre turns its own lab on or off (off: fitter on leave —
  // nothing can be sent there). One switch, no questions (user, 2026-10-13).
  function benchBtnHTML() {
    if (me.role !== 'fitting' || viewOnly) return '';
    const on = !isBenchClosed(me.code);
    return `
      <label class="lab-switch ${on ? '' : 'is-off'}" title="${on ? 'Turn off while the fitter is on leave — frames can’t be sent here' : esc(benchNote(me.code))}">
        <span>Lab</span>
        <span class="sw"><input type="checkbox" data-lab ${on ? 'checked' : ''}><i></i></span>
        <em>${on ? 'On' : 'Off'}</em>
      </label>`;
  }

  function branchOptions() {
    return partnerBranches().map(c => `<option value="${c}" ${ui.branch === c ? 'selected' : ''}>${esc(locName(c))}</option>`).join('');
  }

  function daysHTML() {
    return DAY_FILTERS.map(d => `<button class="chip ${ui.days === d ? 'on' : ''}" data-days="${d}">${d ? `${d} day${d === 1 ? '' : 's'}` : 'Any time'}</button>`).join('');
  }

  // Select every order on the open chip — not on "All active", where they need
  // different things done. Completed orders cannot be selected.
  const selectable = () => visible().filter(o => o.status !== 'collected');
  function selectAllHTML() {
    if (viewOnly || ui.chip === 'active') return '';
    const list = selectable();
    if (!list.length) return '';
    const all = list.every(o => ui.selected.has(o.id));
    return `
      <label class="sel-all">
        <span class="cbx"><input type="checkbox" data-sel-all ${all ? 'checked' : ''}><i></i></span>
        <span>${all ? 'Clear selection' : `Select all ${list.length}`}</span>
      </label>`;
  }

  function markSeen() {
    for (const o of store.state.orders) { ui.seen.add(o.id); ui.prevStatus.set(o.id, o.status); }
  }

  function toggleSelect(id) {
    const o = store.order(id);
    if (!o || o.status === 'collected' || viewOnly) return;
    if (ui.selected.has(id)) ui.selected.delete(id); else ui.selected.add(id);
    refreshLists();
  }

  function wire() {
    root.querySelector('#f-q').addEventListener('input', e => { ui.q = e.target.value; refreshLists(); });
    root.querySelector('#f-branch')?.addEventListener('change', e => { ui.branch = e.target.value; ui.selected.clear(); refreshLists(); });
    root.querySelector('[data-new]')?.addEventListener('click', newOrderModal);
    root.querySelector('[data-cutters]')?.addEventListener('click', cuttersModal);
    root.querySelector('#f-bench')?.addEventListener('change', e => { if (e.target.matches('[data-lab]')) store.setBench(me.code, !e.target.checked); });
    root.querySelector('#f-origin')?.addEventListener('change', e => { ui.origin = e.target.value; refreshLists(); });
    root.querySelector('#f-fitter')?.addEventListener('change', e => { ui.fitter = e.target.value; refreshLists(); });

    root.addEventListener('click', e => {
      const chip = e.target.closest('[data-chip]');
      if (chip) { ui.chip = chip.dataset.chip; ui.selected.clear(); refreshLists(); return; }
      const dd = e.target.closest('[data-days]');
      if (dd) { ui.days = +dd.dataset.days; ui.selected.clear(); refreshLists(); return; }
      const sa = e.target.closest('[data-sel-all]');
      if (sa) {
        const list = selectable();
        if (sa.checked) list.forEach(o => ui.selected.add(o.id)); else list.forEach(o => ui.selected.delete(o.id));
        refreshLists(); return;
      }
      if (e.target.closest('[data-bulk-clear]')) { ui.selected.clear(); refreshLists(); return; }
      if (e.target.closest('[data-bulk-act]')) {
        const { action, ok } = bulkAction();
        if (!ok) return;
        const ids = [...ui.selected];
        // Frames with no fitter yet are sent through the picker; frames a lens
        // request already gave one simply go.
        const unassigned = ids.filter(id => !store.order(id)?.fitter);
        if (action === 'Send to fitter' && unassigned.length) {
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
      const sf = e.target.closest('[data-send-fitter]');
      if (sf) { e.stopPropagation(); fitterPicker(sf.dataset.sendFitter); return; }
      const adv = e.target.closest('[data-advance]');
      if (adv) { e.stopPropagation(); store.advanceOrders([adv.dataset.advance], me.code); return; }
      const sel = e.target.closest('[data-sel]');
      if (sel) { toggleSelect(sel.dataset.sel); return; }
      if (e.target.closest('[data-stop]')) return;
      // Clicking the row selects it.
      const row = e.target.closest('[data-select]');
      if (row) toggleSelect(row.dataset.select);
    });
  }

  return {
    mount(container) { root = container; render(); },
    onChange() { refreshLists(); },
    unmount() { closeLayer(); },
  };
}
