// ── Module 4: Lens Stock — MGM keeps the shelf, every branch shops from it ──
import {
  LENS_OWNER, BARE_COATING, LOW_LENS_STOCK, FULFILMENT, canCutOwnLenses,
  LENSREQ_STATUS, BRANCHES, locName, isLensOwner, fmtPwr, lensLabel, lensFull,
} from './data.js';
import { store } from './store.js';
import { esc, relTime, fmtDT, icons, pill, locChip, openLayer, closeLayer } from './ui.js';

const REQ_CHIPS = [
  { key: 'requested', label: 'Awaiting MGM' },
  { key: 'confirmed', label: 'Confirmed' },
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
  const isAdmin = me.role === 'admin';
  const canShop = !isOwner && !isAdmin;
  // The branch that keeps the lenses decides what may go on the shelf. The
  // warehouse can too — it is the same pair the database lets write.
  const canEditLists = isOwner || isAdmin;

  const ui = {
    tab: canShop ? 'shop' : 'queue',
    chip: isOwner ? 'requested' : 'all',
    q: '', type: 'all', index: 'all', coating: 'all', inStock: true,
    branch: 'all',
    seen: new Set(store.state.lensRequests.map(r => r.id)),
    prevStatus: new Map(store.state.lensRequests.map(r => [r.id, r.status])),
  };
  // Basket lives for the visit only — nothing is shared until a request is placed.
  const cart = new Map(); // itemId → qty
  let root, drawer = null, drawerId = null, declining = false;

  const tabs = canShop
    ? [['shop', 'Browse lenses'], ['mine', 'My requests']]
    : [['queue', isOwner ? 'Incoming requests' : 'All requests'], ['stock', isOwner ? 'My shelf' : 'Shelf at MGM']];

  // ── catalogue ──
  function catalogue() {
    let list = [...store.lensStock];
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
    let list = store.lensRequestsFor(me.code);
    if (ui.chip !== 'all') list = list.filter(r => r.status === ui.chip);
    if (!canShop && ui.branch !== 'all') list = list.filter(r => r.branch === ui.branch);
    if (ui.q && ui.tab !== 'shop') {
      const q = ui.q.toLowerCase();
      list = list.filter(r => [r.ref, r.billNo, r.branch, locName(r.branch), ...r.lines.map(lensFull)]
        .some(v => String(v).toLowerCase().includes(q)));
    }
    const rank = { requested: 0, confirmed: 1, declined: 2 };
    return list.sort((a, b) => (rank[a.status] - rank[b.status]) || (b.updatedAt - a.updatedAt));
  }

  const reqCounts = () => {
    const all = store.lensRequestsFor(me.code);
    const c = { requested: 0, confirmed: 0, declined: 0, all: all.length };
    for (const r of all) c[r.status]++;
    return c;
  };

  // ── stats ──
  function statsHTML() {
    const stock = store.lensStock;
    const c = reqCounts();
    const pcs = stock.reduce((s, i) => s + i.qty, 0);
    const t = (n, lbl, cls = '') => `<div class="stat ${cls}"><div class="stat-n">${n}</div><div class="stat-l">${lbl}</div></div>`;
    if (isOwner) {
      const low = stock.filter(isLow).length;
      const out = stock.filter(i => i.qty === 0).length;
      return t(c.requested, 'Awaiting your confirmation', 'stat-amber') + t(pcs, 'Lenses on the shelf', 'stat-brand')
           + t(low, 'Running low', low ? 'stat-amber' : '') + t(out, 'Out of stock', out ? 'stat-red' : '');
    }
    if (isAdmin) {
      return t(c.requested, 'Awaiting MGM', 'stat-amber') + t(pcs, 'Lenses at MGM', 'stat-brand')
           + t(stock.length, 'Lens types') + t(c.all, 'All requests');
    }
    const avail = stock.filter(i => i.qty > 0).length;
    return t(avail, 'Lens types available', 'stat-brand') + t(c.requested, 'Awaiting MGM', 'stat-amber')
         + t(c.confirmed, 'Confirmed') + t(c.all, 'My requests');
  }

  // ── shop: catalogue grid ──
  function cartCount() { return [...cart.values()].reduce((s, n) => s + n, 0); }

  function cardHTML(i) {
    const inCart = cart.get(i.id) ?? 0;
    const out = i.qty === 0;
    const maxed = inCart >= i.qty;
    const stockTag = out
      ? `<span class="lens-qty out">Out of stock</span>`
      : `<span class="lens-qty ${isLow(i) ? 'low' : ''}"><b>${i.qty}</b> in stock</span>`;
    const control = !canShop ? ''
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

  function shopHTML() {
    const list = catalogue();
    const sel = (id, label, opts, val) => `
      <select class="sel" id="${id}" aria-label="${label}">
        <option value="all">${esc(label)}</option>
        ${opts.map(o => `<option value="${esc(o)}" ${val === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}
      </select>`;
    return `
      <section class="toolbar">
        <div class="searchbox">${icons.search}<input id="l-q" placeholder="Search type, index, power…" value="${esc(ui.q)}"></div>
        ${sel('l-type', 'All types', store.lensTypes, ui.type)}
        ${sel('l-index', 'All indices', store.lensIndices, ui.index)}
        ${sel('l-coating', 'All coatings', store.lensCoatings, ui.coating)}
        <label class="check sm"><input type="checkbox" id="l-instock" ${ui.inStock ? 'checked' : ''}><i></i>In stock only</label>
      </section>
      ${list.length
        ? `<section class="lens-grid">${list.map(cardHTML).join('')}</section>`
        : `<div class="empty">${icons.lens}<p>No lenses match these filters.</p></div>`}`;
  }

  function cartBarHTML() {
    const n = cartCount();
    if (!canShop || !n) return '';
    return `
      <div class="cart-bar">
        <div class="cart-sum">${icons.lens}<b>${cart.size}</b> lens type${cart.size === 1 ? '' : 's'} · <b>${n}</b> pcs</div>
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
      const quick = isOwner && r.status === 'requested'
        ? `<button class="btn btn-ghost btn-sm" data-decline="${r.id}">Decline</button>
           <button class="btn btn-primary btn-sm" data-confirm="${r.id}">${icons.check} Confirm</button>` : '';
      const first = r.lines.slice(0, 2).map(lensLabel);
      const more = r.lines.length - first.length;
      return `
        <div class="row ${isNew ? 'row-enter' : ''}" data-open="${r.id}">
          <div class="row-main">
            <div class="row-title"><b>${esc(r.ref)}</b>
              ${!canShop ? `<span class="row-cust">${locChip(r.branch)} ${esc(locName(r.branch))}</span>` : ''}
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
        ${!canShop ? `<select class="sel" id="l-branch"><option value="all">All branches</option>${
          BRANCHES.filter(b => b.code !== LENS_OWNER).map(b => `<option value="${b.code}" ${ui.branch === b.code ? 'selected' : ''}>${esc(b.name)}</option>`).join('')
        }</select>` : ''}
      </section>
      <section class="chips">${REQ_CHIPS.map(d =>
        `<button class="chip ${ui.chip === d.key ? 'on' : ''}" data-chip="${d.key}">${esc(d.label)}<span class="chip-n">${c[d.key]}</span></button>`).join('')}</section>
      <section class="list" id="l-list">${reqRowsHTML()}</section>`;
  }

  // ── owner: shelf editor ──
  function stockHTML() {
    const list = catalogue();
    const sel = (id, label, opts, val) => `
      <select class="sel" id="${id}" aria-label="${label}">
        <option value="all">${esc(label)}</option>
        ${opts.map(o => `<option value="${esc(o)}" ${val === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}
      </select>`;
    return `
      <section class="toolbar">
        <div class="searchbox">${icons.search}<input id="l-q" placeholder="Search type, index, power…" value="${esc(ui.q)}"></div>
        ${sel('l-type', 'All types', store.lensTypes, ui.type)}
        ${sel('l-index', 'All indices', store.lensIndices, ui.index)}
        ${sel('l-coating', 'All coatings', store.lensCoatings, ui.coating)}
        <label class="check sm"><input type="checkbox" id="l-instock" ${ui.inStock ? 'checked' : ''}><i></i>Hide empty</label>
        ${canEditLists ? `<button class="icon-btn" id="l-cog" title="Edit lens types, indices and coatings">${icons.settings}</button>` : ''}
      </section>
      ${isOwner ? `<div class="review-hint">${icons.box} Keep these counts matching the drawer. Confirming a request deducts from them automatically.</div>` : ''}
      ${list.length ? `
        <table class="lines stock-table">
          <thead><tr>
            <th>Lens</th><th>SPH</th><th>CYL</th><th class="num">On hand</th>${isOwner ? '<th></th>' : ''}
          </tr></thead>
          <tbody>
            ${list.map(i => `
              <tr class="${i.qty === 0 ? 'is-out' : ''}">
                <td><b>${esc(i.type)} ${esc(i.index)}</b>${i.coating && i.coating !== 'None' ? `<div class="line-note">${esc(i.coating)}</div>` : ''}</td>
                <td class="pwr">${fmtPwr(i.sph)}</td>
                <td class="pwr">${fmtPwr(i.cyl)}</td>
                <td class="num">
                  ${isOwner
                    ? `<input class="qty-in ${isLow(i) ? 'low' : ''}" type="number" min="0" max="999" value="${i.qty}" data-qty="${i.id}">`
                    : `<b class="${isLow(i) ? 'low-txt' : ''}">${i.qty}</b> <span class="muted">pcs</span>`}
                </td>
                ${isOwner ? `<td class="num"><button class="icon-btn" data-del="${i.id}" title="Remove from shelf">${icons.trash}</button></td>` : ''}
              </tr>`).join('')}
          </tbody>
        </table>` : `<div class="empty">${icons.lens}<p>No lenses match these filters.</p></div>`}`;
  }

  // ── drawer: request detail ──
  function drawerHTML() {
    const r = store.lensRequest(drawerId);
    if (!r) return `<div class="pad">Request no longer exists.</div>`;
    const canAct = isOwner && r.status === 'requested';
    const actions = !canAct ? '' : declining
      ? `<div class="reject-box">
           <input id="decline-why" placeholder="Why? e.g. only 1 left on the shelf" autofocus>
           <button class="btn btn-ghost" data-cancel-decline>Cancel</button>
           <button class="btn btn-danger" data-do-decline="${r.id}">Decline request</button>
         </div>`
      // Confirming means two different physical acts, so it says which one.
      : `<button class="btn btn-ghost btn-danger-text" data-decline="${r.id}">Decline</button>
         <button class="btn btn-primary" data-confirm="${r.id}">${icons.check} ${
           r.fulfilment === 'receive_lens'
             ? `Send lenses to ${esc(locName(r.branch))}`
             : 'Confirm &amp; deduct stock'}</button>`;
    return `
      <div class="dw-head">
        <div>
          <div class="dw-kicker">Lens request</div>
          <h2>${esc(r.ref)}</h2>
          <div class="dw-sub">${locChip(r.branch)} ${esc(locName(r.branch))} → ${esc(locName(LENS_OWNER))}${r.billNo ? ` · Bill ${esc(r.billNo)}` : ''}</div>
          ${r.customer ? `<div class="dw-sub">${esc(r.customer)}</div>` : ''}
        </div>
        <button class="icon-btn" data-close>${icons.x}</button>
      </div>
      <div class="dw-body">
        <div class="dw-status-row">
          ${pill(LENSREQ_STATUS, r.status)}
          <span class="fulfil-chip ${r.fulfilment}">${esc(FULFILMENT[r.fulfilment]?.chip ?? '')}</span>
          <span class="dw-when">updated ${relTime(r.updatedAt)}</span>
        </div>
        ${r.status === 'declined' && r.reason ? `<div class="review-hint decline-note">${icons.flag} ${esc(r.reason)}</div>` : ''}
        <table class="lines">
          <thead><tr><th>Lens</th><th>SPH</th><th>CYL</th><th class="num">Qty</th>${canAct ? '<th class="num">On shelf</th>' : ''}</tr></thead>
          <tbody>
            ${r.lines.map(l => {
              const item = store.lensItem(l.itemId);
              const have = item?.qty ?? 0;
              return `
                <tr>
                  <td><b>${esc(l.type)} ${esc(l.index)}</b>${l.coating && l.coating !== 'None' ? `<div class="line-note">${esc(l.coating)}</div>` : ''}</td>
                  <td class="pwr">${fmtPwr(l.sph)}</td>
                  <td class="pwr">${fmtPwr(l.cyl)}</td>
                  <td class="num"><b>${l.qty}</b> <span class="muted">pcs</span></td>
                  ${canAct ? `<td class="num ${have < l.qty ? 'short' : ''}">${have}${have < l.qty ? ' ⚠' : ''}</td>` : ''}
                </tr>`;
            }).join('')}
          </tbody>
        </table>
        ${canAct && r.lines.some(l => (store.lensItem(l.itemId)?.qty ?? 0) < l.qty)
          ? `<div class="review-hint">${icons.flag} Some lines exceed what's on the shelf — confirming sends what you actually have.</div>` : ''}
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
      const cf = e.target.closest('[data-confirm]');
      if (cf) return store.confirmLensRequest(cf.dataset.confirm, me.code);
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

  // ── cart → request composer ──
  function cartModal() {
    // A branch with a bench can keep the job and have the lenses sent over;
    // anywhere else the frame has to travel, so there is nothing to choose.
    const canCut = canCutOwnLenses(me.role);
    const draft = {
      customer: '', billNo: '',
      fulfilment: canCut ? 'receive_lens' : 'send_frames',
    };
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
          <div><div class="dw-kicker">New lens request</div><h2>Request lenses from ${esc(locName(LENS_OWNER))}</h2></div>
          <button class="icon-btn" data-close>${icons.x}</button>
        </div>
        <div class="form">
          <table class="lines">
            <thead><tr><th>Lens</th><th>SPH</th><th>CYL</th><th class="num">Qty</th><th class="num">Stock</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <div class="grid2">
            <label>Customer name<input id="lens-cust" required value="${esc(draft.customer)}" placeholder="e.g. Ahmed Al Balushi"></label>
            <label>Bill number<input id="lens-note" required value="${esc(draft.billNo)}" placeholder="e.g. B-58214"></label>
          </div>
          ${canCut ? `
            <div class="fulfil">
              ${Object.entries(FULFILMENT).map(([k, f]) => `
                <label class="fulfil-opt ${draft.fulfilment === k ? 'on' : ''}">
                  <input type="radio" name="fulfil" value="${k}" ${draft.fulfilment === k ? 'checked' : ''}>
                  <b>${esc(f.label)}</b>
                  <span>${esc(f.sub)}</span>
                </label>`).join('')}
            </div>` : ''}
          <p class="muted">A fitting order opens for this bill either way. It waits for ${esc(locName(LENS_OWNER))} to confirm the lenses before it can move.</p>
          <div class="form-foot">
            <span class="muted">${cart.size} type${cart.size === 1 ? '' : 's'} · ${cartCount()} pcs</span>
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
        else bump(id, plus ? 1 : -1);
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
          lines, billNo: draft.billNo, customer: draft.customer, fulfilment: draft.fulfilment,
        }, me.code);
        if (!r) { send.disabled = false; send.innerHTML = was; return; }
        cart.clear();
        layer.close();
        ui.tab = 'mine';
        render();
        openDrawer(r.id);
      }
    });
  }

  function bump(id, by) {
    const item = store.lensItem(id);
    if (!item) return;
    const next = Math.min(item.qty, Math.max(0, (cart.get(id) ?? 0) + by));
    if (next === 0) cart.delete(id); else cart.set(id, next);
  }

  // ── render ──
  function bodyHTML() {
    if (ui.tab === 'shop') return shopHTML();
    if (ui.tab === 'mine' || ui.tab === 'queue') return queueHTML();
    return stockHTML();
  }

  function render() {
    const sub = isOwner
      ? 'Keep your lens shelf up to date and answer what the other branches ask for'
      : isAdmin
        ? `Loose-lens stock held at ${locName(LENS_OWNER)} and every request against it`
        : `Browse the lenses ${locName(LENS_OWNER)} has on hand and request what you need`;
    root.innerHTML = `
      <header class="mod-head">
        <div>
          <h1>Lens Stock</h1>
          <p class="mod-sub">${esc(sub)}</p>
        </div>
        ${isOwner ? `<button class="btn btn-primary" data-new>${icons.plus} Add lens stock</button>` : ''}
      </header>
      <section class="stats" id="l-stats">${statsHTML()}</section>
      <section class="chips tabs-row">${tabs.map(([k, label]) =>
        `<button class="chip ${ui.tab === k ? 'on' : ''}" data-tab="${k}">${esc(label)}</button>`).join('')}</section>
      <div id="l-body">${bodyHTML()}</div>
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

  // ── what the shelf may hold (owner or warehouse) ──
  function catalogueModal() {
    const layer = openLayer('modal', () => `
      <div class="dw-head">
        <div><div class="dw-kicker">Lens stock</div><h2>What the shelf can hold</h2></div>
        <button class="icon-btn" data-close>${icons.x}</button>
      </div>
      <div class="form">
        <p class="muted">These three lists fill the dropdowns here and on every branch's lens screen. A value still on the shelf cannot be removed — clear its stock first.</p>
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
        if (!await store.addLensItem(f, me.code)) {
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
      const tab = e.target.closest('[data-tab]');
      if (tab) { ui.tab = tab.dataset.tab; ui.q = ''; render(); return; }
      const chip = e.target.closest('[data-chip]');
      if (chip) { ui.chip = chip.dataset.chip; refreshBody(); return; }

      const add = e.target.closest('[data-add]');
      if (add) { bump(add.dataset.add, 1); refreshBody(); return; }
      const plus = e.target.closest('[data-plus]');
      if (plus) { bump(plus.dataset.plus, 1); refreshBody(); return; }
      const minus = e.target.closest('[data-minus]');
      if (minus) { bump(minus.dataset.minus, -1); refreshBody(); return; }
      if (e.target.closest('[data-clear]')) { cart.clear(); refreshBody(); return; }
      if (e.target.closest('[data-review]')) return cartModal();

      const del = e.target.closest('[data-del]');
      if (del) { store.removeLensItem(del.dataset.del, me.code); return; }
      const cf = e.target.closest('[data-confirm]');
      if (cf) { e.stopPropagation(); store.confirmLensRequest(cf.dataset.confirm, me.code); return; }
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
