// ── Module 4: Lens Stock — holders keep shelves, every branch shops from them ──
import {
  LENS_HOLDERS, FIRST_SHELF, BARE_COATING, LOW_LENS_STOCK, FULFILMENT, canCutOwnLenses,
  LENSREQ_STATUS, BRANCHES, locName, isLensOwner, fmtPwr, lensLabel, lensFull, seesAll, readOnly, fulfilmentSwitch,
  isBenchClosed, benchNote,
} from './data.js';
import { store } from './store.js';
import { esc, relTime, fmtDT, icons, pill, locChip, openLayer, closeLayer, chipCount, olderHTML } from './ui.js';

const REQ_CHIPS = [
  { key: 'requested', label: 'Lenses to send' },
  { key: 'sent', label: 'Sent' },
  { key: 'reserved', label: 'Set aside for a frame' },
  { key: 'declined', label: 'Declined' },
  { key: 'all', label: 'All' },
];

const pcsOf = r => r.lines.reduce((s, l) => s + (l.qty || 0), 0);
const isLow = i => i.qty > 0 && i.qty <= LOW_LENS_STOCK;

// The handy default, unless whoever keeps the shelf has removed it.
const pick = (list, preferred) => (list.includes(preferred) ? preferred : list[0]);

// The three lists, as the editor presents them.
const LENS_LISTS = [
  ['types',    'Lens types', 'e.g. Office'],
  ['indices',  'Indices',    'e.g. 1.80'],
  ['coatings', 'Coatings',   'e.g. Anti-fog'],
];

export function lensView(me) {
  const isOwner = isLensOwner(me.code);
  // The office and the schedule editor look on; neither shops the shelf.
  const isAdmin = seesAll(me.role);
  // The branch that keeps the lenses decides what may go on the shelf. The
  // office can too — it is the same pair the database lets write.
  const canEditLists = isOwner || me.role === 'admin';

  // One tab per shelf, Muscat Grand Mall always first (user, 2026-10-12), then
  // the others in branch order — a shelf added later simply joins the row.
  const shelves = () => [...LENS_HOLDERS].sort((a, b) => (b.code === FIRST_SHELF) - (a.code === FIRST_SHELF));
  const otherShelves = () => shelves().filter(h => h.code !== me.code);
  const canShop = !isAdmin && otherShelves().length > 0;
  // The request lists sit at the end of the same row.
  const reqTabs = () => isAdmin ? [['queue', 'All requests']]
    : [...(isOwner ? [['queue', 'Incoming requests']] : []), ...(canShop || !isOwner ? [['mine', 'My requests']] : [])];

  const toSend = () => store.lensRequestsFor(me.code).filter(r => r.holder === me.code && r.status === 'requested').length;
  const firstShelf = () => (isOwner && !isAdmin ? me.code : shelves()[0]?.code) ?? null;
  const ui = {
    // A holder with lenses to send starts on them; everyone else on the first shelf.
    tab: isOwner && !isAdmin && toSend() ? 'queue' : firstShelf() ? 'shelf' : (isAdmin || isOwner ? 'queue' : 'mine'),
    holder: firstShelf(),
    filters: false,
    chip: isOwner ? 'requested' : 'all',
    q: '', type: 'all', index: 'all', coating: 'all', inStock: true,
    branch: 'all',
    seen: new Set(store.state.lensRequests.map(r => r.id)),
    prevStatus: new Map(store.state.lensRequests.map(r => [r.id, r.status])),
  };
  // One basket per shelf, for the visit only — switching tabs keeps each one,
  // and nothing is shared until a request is placed.
  const carts = new Map(); // holder → (itemId → qty)
  const basket = (code = ui.holder) => carts.get(code) ?? carts.set(code, new Map()).get(code);
  let root, drawer = null, drawerId = null, declining = false;

  // The shelf on screen, and whether it is this branch's own (edited here) or
  // one it can order from.
  const shelf = () => store.lensStock.filter(i => i.holder === ui.holder);
  const ownShelf = () => isOwner && ui.holder === me.code;
  const shopHere = () => !isAdmin && ui.holder && ui.holder !== me.code;
  // Which requests a request tab is about.
  const scope = () => {
    const all = store.lensRequestsFor(me.code);
    if (ui.tab === 'mine') return all.filter(r => r.branch === me.code);
    if (isOwner && !isAdmin) return all.filter(r => r.holder === me.code);
    return all;
  };

  // ── catalogue ──
  function catalogue() {
    let list = shelf();
    if (ui.type !== 'all') list = list.filter(i => i.type === ui.type);
    if (ui.index !== 'all') list = list.filter(i => i.index === ui.index);
    if (ui.coating !== 'all') list = list.filter(i => i.coating === ui.coating);
    if (ui.inStock) list = list.filter(i => i.qty > 0);
    if (ui.q) {
      const q = ui.q.toLowerCase();
      list = list.filter(i => lensFull(i).toLowerCase().includes(q));
    }
    return list.sort((a, b) =>
      store.lensTypes.indexOf(a.type) - store.lensTypes.indexOf(b.type) ||
      a.index.localeCompare(b.index) || a.sph - b.sph || a.cyl - b.cyl);
  }

  function visibleRequests() {
    let list = scope();
    if (ui.chip !== 'all') list = list.filter(r => r.status === ui.chip);
    if (ui.tab !== 'mine' && ui.branch !== 'all') list = list.filter(r => r.branch === ui.branch);
    if (ui.q && ui.tab !== 'shelf') {
      const q = ui.q.toLowerCase();
      list = list.filter(r => [r.ref, r.billNo, r.branch, locName(r.branch), ...r.lines.map(lensFull)]
        .some(v => String(v).toLowerCase().includes(q)));
    }
    const rank = { requested: 0, reserved: 1, sent: 2, confirmed: 3, declined: 4 };
    return list.sort((a, b) => (rank[a.status] - rank[b.status]) || (b.updatedAt - a.updatedAt));
  }

  const reqCounts = () => {
    const all = scope();
    const c = { requested: 0, reserved: 0, sent: 0, confirmed: 0, declined: 0, all: all.length };
    for (const r of all) c[r.status]++;
    return c;
  };

  // ── stats ──
  // About the shelf and the requests on screen: a holder at its own shelf or
  // its incoming requests sees its shelf; anyone ordering sees the shelf
  // picked and its own requests; the office sees them all.
  function statsHTML() {
    const t = (n, lbl, cls = '') => `<div class="stat ${cls}"><div class="stat-n">${n}</div><div class="stat-l">${lbl}</div></div>`;
    const all = store.lensRequestsFor(me.code);
    if (isAdmin) {
      const stock = store.lensStock;
      return t(all.filter(r => r.status === 'requested').length, 'Lenses to send', 'stat-amber')
           + t(stock.reduce((s, i) => s + i.qty, 0), 'Lenses on all shelves', 'stat-brand')
           + t(LENS_HOLDERS.length, LENS_HOLDERS.length === 1 ? 'Shelf' : 'Shelves') + t(all.length, 'All requests');
    }
    if (isOwner && (ui.tab === 'queue' || ownShelf())) {
      const stock = store.lensStock.filter(i => i.holder === me.code);
      const low = stock.filter(isLow).length;
      const out = stock.filter(i => i.qty === 0).length;
      return t(toSend(), 'Lenses to send', 'stat-amber') + t(stock.reduce((s, i) => s + i.qty, 0), 'Lenses on your shelf', 'stat-brand')
           + t(low, 'Running low', low ? 'stat-amber' : '') + t(out, 'Out of stock', out ? 'stat-red' : '');
    }
    const mine = all.filter(r => r.branch === me.code);
    const avail = ui.tab === 'shelf' ? shelf().filter(i => i.qty > 0).length : null;
    return (avail == null ? t(mine.filter(r => r.status === 'reserved').length, 'Set aside for a frame', 'stat-brand')
                          : t(avail, `Lens types at ${esc(ui.holder)}`, 'stat-brand'))
         + t(mine.filter(r => r.status === 'requested').length, 'Waiting to be sent', 'stat-amber')
         + t(mine.filter(r => ['sent', 'confirmed'].includes(r.status)).length, 'Sent to you')
         + t(mine.length, 'My requests');
  }

  // ── shop: catalogue grid ──
  const cartCount = (code = ui.holder) => [...basket(code).values()].reduce((s, n) => s + n, 0);

  function cardHTML(i) {
    const inCart = basket().get(i.id) ?? 0;
    const out = i.qty === 0;
    const maxed = inCart >= i.qty;
    const stockTag = out
      ? `<span class="lens-qty out">Out of stock</span>`
      : `<span class="lens-qty ${isLow(i) ? 'low' : ''}"><b>${i.qty}</b> in stock</span>`;
    const control = !shopHere() ? ''
      : out ? `<button class="btn btn-ghost btn-sm" disabled>Unavailable</button>`
      : inCart ? `
        <div class="stepper" data-stop>
          <button class="step-btn" data-minus="${i.id}">${icons.minus}</button>
          <b>${inCart}</b>
          <button class="step-btn" data-plus="${i.id}" ${maxed ? 'disabled' : ''}>${icons.plus}</button>
        </div>`
      : `<button class="btn btn-primary btn-sm" data-add="${i.id}">${icons.plus} Add</button>`;
    return `
      <div class="lens-card ${out ? 'is-out' : ''} ${inCart ? 'in-cart' : ''}">
        <div class="lens-card-top">
          <b class="lens-name">${esc(i.type)} ${esc(i.index)}</b>
          ${i.coating && i.coating !== 'None' ? `<span class="lens-coat">${esc(i.coating)}</span>` : ''}
        </div>
        <div class="lens-rx">
          <span>SPH <b>${fmtPwr(i.sph)}</b></span>
          <span>CYL <b>${fmtPwr(i.cyl)}</b></span>
        </div>
        <div class="lens-card-foot">${stockTag}${control}</div>
      </div>`;
  }

  // The filters hide behind one button; it shows how many are in use.
  function filterCount() {
    return ['type', 'index', 'coating'].filter(k => ui[k] !== 'all').length + (ui.inStock ? 0 : 1);
  }
  function shelfToolbarHTML() {
    const own = ownShelf();
    const sel = (id, label, opts, val) => `
      <select class="sel" id="${id}" aria-label="${label}">
        <option value="all">${esc(label)}</option>
        ${opts.map(o => `<option value="${esc(o)}" ${val === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}
      </select>`;
    const n = filterCount();
    return `
      <section class="toolbar shelf-toolbar">
        <div class="searchbox">${icons.search}<input id="l-q" placeholder="Search type, index, power…" value="${esc(ui.q)}"></div>
        <button class="filter-btn ${ui.filters ? 'on' : ''}" data-filters title="Filters" aria-expanded="${ui.filters}">
          ${icons.filter}<span>Filters</span>${n ? `<em>${n}</em>` : ''}
        </button>
        ${own ? `<span class="toolbar-gap"></span>
          ${canEditLists ? `<button class="icon-btn" id="l-cog" title="Edit lens types, indices and coatings">${icons.settings}</button>` : ''}
          <button class="btn btn-primary btn-sm" data-new>${icons.plus} Add lens stock</button>` : ''}
      </section>
      ${ui.filters ? `
      <section class="filter-row">
        ${sel('l-type', 'All types', store.lensTypes, ui.type)}
        ${sel('l-index', 'All indices', store.lensIndices, ui.index)}
        ${sel('l-coating', 'All coatings', store.lensCoatings, ui.coating)}
        <label class="check sm"><input type="checkbox" id="l-instock" ${ui.inStock ? 'checked' : ''}><i></i>${own ? 'Hide empty' : 'In stock only'}</label>
        ${n ? `<button class="btn btn-ghost btn-sm" data-clear-filters>Clear filters</button>` : ''}
      </section>` : ''}`;
  }

  function shopHTML() {
    const list = catalogue();
    return `
      ${shelfToolbarHTML()}
      ${list.length
        ? `<section class="lens-grid">${list.map(cardHTML).join('')}</section>`
        : `<div class="empty">${icons.lens}<p>${shelf().length ? 'No lenses match these filters.' : `Nothing on ${esc(locName(ui.holder))}’s shelf yet.`}</p></div>`}`;
  }

  function cartBarHTML() {
    const n = cartCount();
    if (ui.tab !== 'shelf' || !shopHere() || !n) return '';
    const b = basket();
    return `
      <div class="cart-bar">
        <div class="cart-sum">${icons.lens}<span>From ${esc(locName(ui.holder))}:</span> <b>${b.size}</b> lens type${b.size === 1 ? '' : 's'} · <b>${n}</b> pcs</div>
        <button class="btn btn-ghost btn-sm" data-clear>Clear</button>
        <button class="btn btn-primary" data-review>${icons.send} Review &amp; request</button>
      </div>`;
  }

  // ── request rows ──
  function reqRowsHTML() {
    const list = visibleRequests();
    if (!list.length) return `<div class="empty">${icons.inbox}<p>No lens requests in this view.</p></div>`;
    return list.map(r => {
      const isNew = !ui.seen.has(r.id);
      const changed = ui.prevStatus.get(r.id) !== r.status;
      const quick = r.holder === me.code && r.status === 'requested'
        ? `<button class="btn btn-ghost btn-sm" data-decline="${r.id}">Decline</button>
           <button class="btn btn-primary btn-sm" data-send-lenses="${r.id}">${icons.send} Send lenses</button>` : '';
      const first = r.lines.slice(0, 2).map(lensLabel);
      const more = r.lines.length - first.length;
      return `
        <div class="row ${isNew ? 'row-enter' : ''}" data-open="${r.id}">
          <div class="row-main">
            <div class="row-title"><b>${esc(r.ref)}</b>
              ${ui.tab !== 'mine' ? `<span class="row-cust">${locChip(r.branch)} ${esc(locName(r.branch))}</span>` : ''}
              ${(ui.tab === 'mine' || isAdmin) && LENS_HOLDERS.length > 1 ? `<span class="row-cust muted">→ ${esc(r.holder ?? '')}</span>` : ''}
            </div>
            <div class="row-sub"><span class="row-sub-txt">${esc(first.join(', '))}${more > 0 ? ` +${more} more` : ''}</span></div>
          </div>
          <div class="row-units"><b>${r.lines.length}</b> type${r.lines.length === 1 ? '' : 's'} · ${pcsOf(r)} pcs</div>
          <div class="row-status">${pill(LENSREQ_STATUS, r.status, { flash: changed })}</div>
          <div class="row-time" title="${fmtDT(r.updatedAt)}">${relTime(r.updatedAt)}</div>
          <div class="row-act" data-stop>${quick}</div>
        </div>`;
    }).join('');
  }

  function queueHTML() {
    const c = reqCounts();
    return `
      <section class="toolbar">
        <div class="searchbox">${icons.search}<input id="l-q" placeholder="Search ref, bill, branch, lens…" value="${esc(ui.q)}"></div>
        ${ui.tab !== 'mine' ? `<select class="sel" id="l-branch"><option value="all">All branches</option>${
          BRANCHES.filter(b => b.code !== me.code).map(b => `<option value="${b.code}" ${ui.branch === b.code ? 'selected' : ''}>${esc(b.name)}</option>`).join('')
        }</select>` : ''}
      </section>
      <section class="chips status-chips">${REQ_CHIPS.map(d => {
        // Lenses to send are the holder's to do.
        const act = ui.tab === 'queue' && isOwner && !isAdmin && (d.key === 'requested' || d.key === 'all') ? c.requested : 0;
        return `${d.key === 'all' ? '<span class="chip-sep"></span>' : ''}<button class="chip ${ui.chip === d.key ? 'on' : ''}" data-chip="${d.key}">${esc(d.label)}${chipCount(c[d.key], act)}</button>`;
      }).join('')}</section>
      <section class="list" id="l-list">${reqRowsHTML()}</section>
      ${['sent', 'declined', 'all'].includes(ui.chip) ? olderHTML(store.historyDays, store.olderLoaded('lensRequests')) : ''}`;
  }

  // ── owner: shelf editor ──
  function stockHTML() {
    const list = catalogue();
    const mine = ownShelf();
    return `
      ${shelfToolbarHTML()}
      ${list.length ? `
        <table class="lines stock-table">
          <thead><tr>
            <th>Lens</th><th>SPH</th><th>CYL</th><th class="num">On hand</th>${mine ? '<th></th>' : ''}
          </tr></thead>
          <tbody>
            ${list.map(i => `
              <tr class="${i.qty === 0 ? 'is-out' : ''}">
                <td><b>${esc(i.type)} ${esc(i.index)}</b>${i.coating && i.coating !== 'None' ? `<div class="line-note">${esc(i.coating)}</div>` : ''}</td>
                <td class="pwr">${fmtPwr(i.sph)}</td>
                <td class="pwr">${fmtPwr(i.cyl)}</td>
                <td class="num">
                  ${mine
                    ? `<input class="qty-in ${isLow(i) ? 'low' : ''}" type="number" min="0" max="999" value="${i.qty}" data-qty="${i.id}">`
                    : `<b class="${isLow(i) ? 'low-txt' : ''}">${i.qty}</b> <span class="muted">pcs</span>`}
                </td>
                ${mine ? `<td class="num"><button class="icon-btn" data-del="${i.id}" title="Remove from shelf">${icons.trash}</button></td>` : ''}
              </tr>`).join('')}
          </tbody>
        </table>` : `<div class="empty">${icons.lens}<p>No lenses match these filters.</p></div>`}`;
  }

  // ── drawer: request detail ──
  function drawerHTML() {
    const viewOnlySwitch = readOnly(me.role);
    const r = store.lensRequest(drawerId);
    if (!r) return `<div class="pad">Request no longer exists.</div>`;
    const canAct = r.holder === me.code && r.status === 'requested';
    const actions = !canAct ? '' : declining
      ? `<div class="reject-box">
           <input id="decline-why" placeholder="Why? e.g. only 1 left on the shelf" autofocus>
           <button class="btn btn-ghost" data-cancel-decline>Cancel</button>
           <button class="btn btn-danger" data-do-decline="${r.id}">Decline request</button>
         </div>`
      : `<button class="btn btn-ghost btn-danger-text" data-decline="${r.id}">Decline</button>
         <button class="btn btn-primary" data-send-lenses="${r.id}">${icons.send} Send lenses to ${esc(locName(r.branch))}</button>`;
    return `
      <div class="dw-head">
        <div>
          <div class="dw-kicker">Lens request</div>
          <h2>${esc(r.ref)}</h2>
          <div class="dw-sub">${locChip(r.branch)} ${esc(locName(r.branch))} → ${esc(locName(r.holder))}${r.billNo ? ` · Bill ${esc(r.billNo)}` : ''}</div>
          ${r.customer ? `<div class="dw-sub">${esc(r.customer)}</div>` : ''}
        </div>
        <button class="icon-btn" data-close>${icons.x}</button>
      </div>
      <div class="dw-body">
        <div class="dw-status-row">
          ${pill(LENSREQ_STATUS, r.status)}
          <span class="fulfil-chip ${r.fulfilment}">${esc(FULFILMENT[r.fulfilment]?.chip ?? '')}</span>
          <span class="dw-when">updated ${relTime(r.updatedAt)}</span>
          ${(() => { const to = fulfilmentSwitch(r, store.order(r.orderId), me.code); return to && !viewOnlySwitch ? `<button class="btn btn-ghost btn-sm dw-switch" data-switch="${r.id}" data-to="${to}">${icons.history} ${to === 'send_frames' ? 'Change: send the frame instead' : 'Change: receive the lenses instead'}</button>` : ''; })()}
        </div>
        ${r.status === 'declined' && r.reason ? `<div class="review-hint decline-note">${icons.flag} ${esc(r.reason)}</div>` : ''}
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
        </table>
        <div class="dw-actions">${actions}</div>
        <h3 class="tl-h">${icons.history} Timeline</h3>
        <div class="timeline">
          ${[...r.timeline].reverse().map((t, i) => `
            <div class="tl-item ${i === 0 ? 'tl-now' : ''}">
              <i class="tl-dot"></i>
              <div class="tl-txt">${esc(t.text)}</div>
              <div class="tl-meta">${locChip(t.by)} ${esc(locName(t.by))} · <span>${fmtDT(t.at)}</span></div>
            </div>`).join('')}
        </div>
      </div>`;
  }

  function openDrawer(id) {
    drawerId = id;
    declining = false;
    drawer = openLayer('drawer', drawerHTML, { onClose: () => { drawer = null; drawerId = null; declining = false; } });
    drawer.el.addEventListener('click', e => {
      if (e.target.closest('[data-close]')) return drawer.close();
      const sl = e.target.closest('[data-send-lenses]');
      if (sl) return store.sendLenses(sl.dataset.sendLenses, me.code);
      const sw = e.target.closest('[data-switch]');
      if (sw) return switchFulfilment(sw.dataset.switch, sw.dataset.to);
      if (e.target.closest('[data-decline]')) { declining = true; return drawer.update(); }
      if (e.target.closest('[data-cancel-decline]')) { declining = false; return drawer.update(); }
      const dd = e.target.closest('[data-do-decline]');
      if (dd) {
        const why = drawer.el.querySelector('#decline-why')?.value ?? '';
        declining = false;
        return store.declineLensRequest(dd.dataset.doDecline, why, me.code);
      }
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

  // ── cart → request composer ──
  function cartModal() {
    // Every branch chooses; sending the frame is the default. What happens to
    // received lenses depends on whether this branch has a bench.
    const canCut = canCutOwnLenses(me.role);
    const holder = ui.holder;
    const cart = basket(holder);
    // A holder whose bench is closed cannot take the frame: lenses only.
    const holderShut = isBenchClosed(holder);
    const draft = { customer: '', billNo: '', fulfilment: holderShut ? 'receive_lens' : 'send_frames' };
    const layer = openLayer('modal', () => {
      const rows = [...cart.entries()].map(([id, qty]) => {
        const i = store.lensItem(id);
        if (!i) return '';
        return `
          <tr>
            <td><b>${esc(i.type)} ${esc(i.index)}</b>${i.coating && i.coating !== 'None' ? `<div class="line-note">${esc(i.coating)}</div>` : ''}</td>
            <td class="pwr">${fmtPwr(i.sph)}</td>
            <td class="pwr">${fmtPwr(i.cyl)}</td>
            <td class="num">
              <div class="stepper">
                <button class="step-btn" data-minus="${i.id}">${icons.minus}</button>
                <b>${qty}</b>
                <button class="step-btn" data-plus="${i.id}" ${qty >= i.qty ? 'disabled' : ''}>${icons.plus}</button>
              </div>
            </td>
            <td class="num muted">${i.qty} avail.</td>
            <td class="num"><button class="icon-btn" data-drop="${i.id}">${icons.x}</button></td>
          </tr>`;
      }).join('');
      return `
        <div class="dw-head">
          <div><div class="dw-kicker">New lens request</div><h2>Request lenses from ${esc(locName(holder))}</h2></div>
          <button class="icon-btn" data-close>${icons.x}</button>
        </div>
        <div class="form">
          <table class="lines">
            <thead><tr><th>Lens</th><th>SPH</th><th>CYL</th><th class="num">Qty</th><th class="num">Stock</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <div class="grid2">
            <label>Bill number<input id="lens-note" required value="${esc(draft.billNo)}" placeholder="e.g. B-58214"></label>
            <label>Customer name<input id="lens-cust" required value="${esc(draft.customer)}" placeholder="e.g. Ahmed Al Balushi"></label>
          </div>
          <div class="fulfil">
            ${Object.entries(FULFILMENT).map(([k, f]) => `
              <label class="fulfil-opt ${draft.fulfilment === k ? 'on' : ''} ${k === 'send_frames' && holderShut ? 'is-off' : ''}">
                <input type="radio" name="fulfil" value="${k}" ${draft.fulfilment === k ? 'checked' : ''} ${k === 'send_frames' && holderShut ? 'disabled' : ''}>
                <b>${esc(f.label)}</b>
                <span>${esc(k === 'send_frames' && holderShut ? benchNote(holder) : !canCut && f.subShop ? f.subShop : f.sub)}</span>
              </label>`).join('')}
          </div>
          <div class="form-foot">
            <span class="muted">${cart.size} type${cart.size === 1 ? '' : 's'} · ${cartCount(holder)} pcs</span>
            <button class="btn btn-ghost" data-close>Cancel</button>
            <button class="btn btn-primary" data-send>${icons.send} Send request</button>
          </div>
        </div>`;
    });

    // Changing the basket redraws the whole panel, so what has been typed has
    // to be read back out first or it is lost on every + and −.
    const sync = () => {
      const q = sel => layer.el.querySelector(sel);
      draft.customer = q('#lens-cust')?.value ?? draft.customer;
      draft.billNo = q('#lens-note')?.value ?? draft.billNo;
      draft.fulfilment = q('input[name=fulfil]:checked')?.value ?? draft.fulfilment;
    };

    layer.el.addEventListener('change', e => {
      if (e.target.name === 'fulfil') { sync(); layer.update(); }
    });

    layer.el.addEventListener('click', async e => {
      if (e.target.closest('[data-close]')) return layer.close();
      const plus = e.target.closest('[data-plus]');
      const minus = e.target.closest('[data-minus]');
      const drop = e.target.closest('[data-drop]');
      if (plus || minus || drop) {
        const el = plus ?? minus ?? drop;
        const id = el.dataset.plus ?? el.dataset.minus ?? el.dataset.drop;
        sync();
        if (drop) cart.delete(id);
        else bump(id, plus ? 1 : -1, holder);
        if (!cart.size) return layer.close();
        layer.update();
        refreshBody();
        return;
      }
      if (e.target.closest('[data-send]')) {
        const lines = [...cart.entries()].map(([id, qty]) => {
          const i = store.lensItem(id);
          return i && { itemId: i.id, type: i.type, index: i.index, coating: i.coating, sph: i.sph, cyl: i.cyl, qty };
        }).filter(Boolean);
        if (!lines.length) return;
        sync();
        // The bill number and the name open a fitting order, so neither can be
        // a blank or a run of spaces.
        const cust = layer.el.querySelector('#lens-cust');
        const bill = layer.el.querySelector('#lens-note');
        cust.value = draft.customer = draft.customer.trim();
        bill.value = draft.billNo = draft.billNo.trim();
        if (!cust.reportValidity() || !bill.reportValidity()) return;

        const send = e.target.closest('[data-send]');
        send.disabled = true;
        const was = send.innerHTML;
        send.textContent = 'Sending…';
        const r = await store.createLensRequest({
          lines, billNo: draft.billNo, customer: draft.customer, fulfilment: draft.fulfilment, holder,
        }, me.code);
        if (!r) { send.disabled = false; send.innerHTML = was; return; }
        cart.clear();
        layer.close();
        ui.tab = 'mine';
        refreshBody();
        openDrawer(r.id);
      }
    });
  }

  function bump(id, by, code = ui.holder) {
    const item = store.lensItem(id);
    if (!item) return;
    const cart = basket(code);
    const next = Math.min(item.qty, Math.max(0, (cart.get(id) ?? 0) + by));
    if (next === 0) cart.delete(id); else cart.set(id, next);
  }

  // ── render ──
  function bodyHTML() {
    if (ui.tab === 'shelf') return ui.holder ? (ownShelf() ? stockHTML() : shopHTML())
      : `<div class="empty">${icons.lens}<p>No branch holds lens stock yet.</p></div>`;
    return queueHTML();
  }

  // Folder tabs: the shelves first (Muscat Grand Mall leading), then the
  // request lists. The open tab stands taller and joins the panel below.
  function tabsHTML() {
    const shelfTab = h => {
      const on = ui.tab === 'shelf' && ui.holder === h.code;
      const inBasket = cartCount(h.code);
      const own = h.code === me.code;
      return `
        <button class="shelf-tab ${on ? 'on' : ''}" data-shelf="${h.code}" aria-pressed="${on}">
          <b>${esc(h.name)}</b>
          <span>${own ? 'Your shelf' : 'Stock lenses'}${inBasket ? ` · <i class="tab-basket">${inBasket} in basket</i>` : ''}</span>
        </button>`;
    };
    const reqTab = ([k, label]) => {
      const on = ui.tab === k;
      const n = k === 'queue' && !isAdmin ? toSend()
        : k === 'mine' ? store.lensRequestsFor(me.code).filter(r => r.branch === me.code && r.status === 'requested').length : 0;
      return `
        <button class="shelf-tab req-tab ${on ? 'on' : ''}" data-tab="${k}" aria-pressed="${on}">
          <b>${icons.inbox} ${esc(label)}${n ? `<em class="tab-n">${n}</em>` : ''}</b>
          <span>${k === 'queue' ? (isAdmin ? 'Every shelf' : 'Asked of your shelf') : 'What you ordered'}</span>
        </button>`;
    };
    return `<nav class="shelf-tabs" aria-label="Lens shelves">${shelves().map(shelfTab).join('')}<span class="tab-gap"></span>${reqTabs().map(reqTab).join('')}</nav>`;
  }

  // The panel's top corner squares off under an open tab that sits at its
  // edge — the first (left) or the last request tab (right) — so the tab and
  // the panel read as one piece.
  const panelClass = () => {
    const first = shelves()[0]?.code;
    const last = reqTabs().at(-1)?.[0];
    if ((ui.tab === 'shelf' && ui.holder === first) || (!first && ui.tab === reqTabs()[0]?.[0])) return 'first-on';
    return ui.tab !== 'shelf' && ui.tab === last ? 'last-on' : '';
  };

  function render() {
    const sub = isAdmin
      ? 'Every lens shelf, and every request made against them'
      : isOwner
        ? 'Keep your shelf up to date, send the lenses branches ask for, and order from the other shelves'
        : 'Pick a shelf, find the lenses you need and request them';
    root.innerHTML = `
      <header class="mod-head">
        <div>
          <h1>Lens Stock</h1>
          <p class="mod-sub">${esc(sub)}</p>
        </div>
      </header>
      <section class="stats" id="l-stats">${statsHTML()}</section>
      <div id="l-tabs">${tabsHTML()}</div>
      <section class="shelf-panel ${panelClass()}" id="l-panel">
        <div id="l-body">${bodyHTML()}</div>
      </section>
      <div id="l-cart">${cartBarHTML()}</div>`;
    wireBody();
    markSeen();
  }

  function refreshBody() {
    const b = root.querySelector('#l-body');
    const c = root.querySelector('#l-cart');
    const s = root.querySelector('#l-stats');
    if (!b) return;
    // Never yank the field the user is mid-way through typing in.
    const active = document.activeElement;
    const keepFocus = active?.id === 'l-q' ? { id: 'l-q', pos: active.selectionStart } : null;
    if (s) s.innerHTML = statsHTML();
    const tb = root.querySelector('#l-tabs');
    if (tb) tb.innerHTML = tabsHTML();
    root.querySelector('#l-panel')?.setAttribute('class', `shelf-panel ${panelClass()}`);
    b.innerHTML = bodyHTML();
    if (c) c.innerHTML = cartBarHTML();
    if (keepFocus) {
      const f = root.querySelector('#l-q');
      if (f) { f.focus(); f.setSelectionRange(keepFocus.pos, keepFocus.pos); }
    }
    wireBody();
    markSeen();
    if (!(drawer && active && drawer.el.contains(active) && active.matches('input,select,textarea'))) drawer?.update();
  }

  function markSeen() {
    for (const r of store.state.lensRequests) { ui.seen.add(r.id); ui.prevStatus.set(r.id, r.status); }
  }

  // ── what the shelf may hold (owner or office) ──
  function catalogueModal() {
    const layer = openLayer('modal', () => `
      <div class="dw-head">
        <div><div class="dw-kicker">Lens stock</div><h2>What the shelf can hold</h2></div>
        <button class="icon-btn" data-close>${icons.x}</button>
      </div>
      <div class="form">
        <div class="lens-lists">
          ${LENS_LISTS.map(([kind, title, hint]) => {
            const list = store.state.lensCatalogue[kind];
            return `
            <div class="lens-list">
              <h4>${title}<span>${list.length}</span></h4>
              <div class="set-brands">
                ${list.map(v => {
                  const used = store.lensOptionUse(kind, v);
                  const kept = (kind === 'coatings' && v === BARE_COATING) || list.length <= 1;
                  return `<span class="set-brand ${used ? 'in-use' : ''}" title="${kept ? 'Always available' : used ? `${used} on the shelf` : ''}">${esc(v)}${
                    kept ? '' : `<button class="brand-x" data-del="${esc(v)}" data-kind="${kind}" title="Remove">${icons.x}</button>`}</span>`;
                }).join('')}
              </div>
              <form class="set-add sm" data-add="${kind}">
                <input name="v" placeholder="${hint}" required autocomplete="off">
                <button class="btn btn-ghost btn-sm" type="submit">${icons.plus} Add</button>
              </form>
            </div>`;
          }).join('')}
        </div>
      </div>`);

    layer.el.addEventListener('submit', async e => {
      e.preventDefault();
      const form = e.target.closest('[data-add]');
      if (!form) return;
      const input = form.querySelector('input');
      const value = input.value.trim();
      input.value = value;
      if (!form.reportValidity()) return;
      await store.addLensOption(form.dataset.add, value);
      layer.update();
      layer.el.querySelector(`[data-add="${form.dataset.add}"] input`)?.focus();
    });
    layer.el.addEventListener('click', async e => {
      if (e.target.closest('[data-close]')) return layer.close();
      const x = e.target.closest('[data-del]');
      if (!x) return;
      await store.removeLensOption(x.dataset.kind, x.dataset.del);
      layer.update();
    });
  }

  // ── add-stock composer (owner only) ──
  function addStockModal() {
    const layer = openLayer('modal', () => `
      <div class="dw-head">
        <div><div class="dw-kicker">Lens stock</div><h2>Add lenses to the shelf</h2></div>
        <button class="icon-btn" data-close>${icons.x}</button>
      </div>
      <div class="form">
        <div class="grid2">
          <label>Lens type<select id="f-type">${store.lensTypes.map(t => `<option>${esc(t)}</option>`).join('')}</select></label>
          <label>Index<select id="f-index">${store.lensIndices.map(t => `<option ${t === pick(store.lensIndices, '1.60') ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
        </div>
        <div class="grid2">
          <label>Coating<select id="f-coating">${store.lensCoatings.map(t => `<option ${t === pick(store.lensCoatings, 'AR') ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
          <label>Quantity<input id="f-qty" type="number" min="1" max="999" value="10"></label>
        </div>
        <div class="grid2">
          <label>SPH <span class="opt">sphere</span><input id="f-sph" type="number" step="0.25" min="-20" max="20" value="-2.00"></label>
          <label>CYL <span class="opt">cylinder</span><input id="f-cyl" type="number" step="0.25" min="-10" max="10" value="0.00"></label>
        </div>
        <div class="form-foot">
          <span class="muted" id="f-preview"></span>
          <button class="btn btn-ghost" data-close>Cancel</button>
          <button class="btn btn-primary" data-save>${icons.plus} Add to shelf</button>
        </div>
      </div>`);

    const read = () => ({
      type: layer.el.querySelector('#f-type').value,
      index: layer.el.querySelector('#f-index').value,
      coating: layer.el.querySelector('#f-coating').value,
      sph: parseFloat(layer.el.querySelector('#f-sph').value) || 0,
      cyl: parseFloat(layer.el.querySelector('#f-cyl').value) || 0,
      qty: parseInt(layer.el.querySelector('#f-qty').value, 10) || 0,
    });
    const preview = () => {
      const f = read();
      const el = layer.el.querySelector('#f-preview');
      if (el) el.textContent = `${lensFull(f)} · ${f.qty} pcs`;
    };
    preview();
    layer.el.addEventListener('input', preview);
    layer.el.addEventListener('change', preview);
    layer.el.addEventListener('click', async e => {
      if (e.target.closest('[data-close]')) return layer.close();
      const save = e.target.closest('[data-save]');
      if (save) {
        const f = read();
        if (f.qty <= 0) return;
        save.disabled = true;
        const was = save.innerHTML;
        save.textContent = 'Saving…';
        if (!await store.addLensItem({ ...f, holder: me.code }, me.code)) {
          save.disabled = false; save.innerHTML = was; return;
        }
        layer.close();
      }
    });
  }

  // ── wiring ──
  function wireBody() {
    const q = root.querySelector('#l-q');
    if (q) q.addEventListener('input', e => { ui.q = e.target.value; refreshBody(); });
    root.querySelector('#l-type')?.addEventListener('change', e => { ui.type = e.target.value; refreshBody(); });
    root.querySelector('#l-index')?.addEventListener('change', e => { ui.index = e.target.value; refreshBody(); });
    root.querySelector('#l-coating')?.addEventListener('change', e => { ui.coating = e.target.value; refreshBody(); });
    root.querySelector('#l-instock')?.addEventListener('change', e => { ui.inStock = e.target.checked; refreshBody(); });
    root.querySelector('#l-cog')?.addEventListener('click', catalogueModal);
    root.querySelector('#l-branch')?.addEventListener('change', e => { ui.branch = e.target.value; refreshBody(); });

    root.querySelectorAll('[data-qty]').forEach(el => {
      el.addEventListener('change', ev => store.setLensQty(ev.target.dataset.qty, ev.target.value, me.code));
    });
  }

  // Delegated once at mount — render() replaces the markup underneath, so
  // binding here again per render would stack duplicate handlers.
  function wireRoot() {
    root.addEventListener('click', e => {
      if (e.target.closest('[data-new]')) return addStockModal();
      const sh = e.target.closest('[data-shelf]');
      if (sh) { ui.tab = 'shelf'; ui.holder = sh.dataset.shelf; ui.q = ''; refreshBody(); return; }
      const tab = e.target.closest('[data-tab]');
      if (tab) { ui.tab = tab.dataset.tab; ui.q = ''; ui.chip = ui.tab === 'queue' && isOwner && !isAdmin ? 'requested' : 'all'; refreshBody(); return; }
      if (e.target.closest('[data-filters]')) { ui.filters = !ui.filters; refreshBody(); return; }
      if (e.target.closest('[data-clear-filters]')) { ui.type = ui.index = ui.coating = 'all'; ui.inStock = true; refreshBody(); return; }
      const chip = e.target.closest('[data-chip]');
      if (chip) { ui.chip = chip.dataset.chip; refreshBody(); return; }
      if (e.target.closest('[data-older]')) { e.target.closest('[data-older]').disabled = true; store.loadOlder('lensRequests'); return; }

      const add = e.target.closest('[data-add]');
      if (add) { bump(add.dataset.add, 1); refreshBody(); return; }
      const plus = e.target.closest('[data-plus]');
      if (plus) { bump(plus.dataset.plus, 1); refreshBody(); return; }
      const minus = e.target.closest('[data-minus]');
      if (minus) { bump(minus.dataset.minus, -1); refreshBody(); return; }
      if (e.target.closest('[data-clear]')) { basket().clear(); refreshBody(); return; }
      if (e.target.closest('[data-review]')) return cartModal();

      const del = e.target.closest('[data-del]');
      if (del) { store.removeLensItem(del.dataset.del, me.code); return; }
      const sl = e.target.closest('[data-send-lenses]');
      if (sl) { e.stopPropagation(); store.sendLenses(sl.dataset.sendLenses, me.code); return; }
      const dc = e.target.closest('[data-decline]');
      if (dc) { e.stopPropagation(); openDrawer(dc.dataset.decline); declining = true; drawer?.update(); return; }

      if (e.target.closest('[data-stop]')) return;
      const row = e.target.closest('[data-open]');
      if (row) openDrawer(row.dataset.open);
    });
  }

  return {
    mount(container) { root = container; wireRoot(); render(); },
    onChange() { refreshBody(); },
    unmount() { closeLayer(); },
  };
}
