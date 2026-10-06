// ── Module 1: Fitting Log — the frame's journey branch → fitter → branch ──
import { FIT_FLOW, FIT_STATUS, FITTERS, BRANCHES, locName, fitActor, canAdvanceOrder } from './data.js';
import { store } from './store.js';
import { esc, relTime, fmtDT, icons, pill, urgentTag, locChip, openLayer, closeLayer, toast } from './ui.js';

const CHIP_DEFS = [
  { key: 'active', label: 'All active' },
  ...FIT_FLOW.filter(s => s !== 'delivered').map(s => ({ key: s, label: FIT_STATUS[s].label })),
  { key: 'delivered', label: 'Delivered' },
];

const READY_IDX = FIT_FLOW.indexOf('ready');

export function fittingView(me) {
  const ui = {
    chip: 'active', urgentOnly: false, q: '',
    origin: 'all', fitter: 'all',           // admin-only filters
    selected: new Set(),
    seen: new Set(store.state.orders.map(o => o.id)),
    prevStatus: new Map(store.state.orders.map(o => [o.id, o.status])),
  };
  let root, drawer = null, drawerId = null;
  const isAdmin = me.role === 'admin';

  // ── data ──
  function visible() {
    let list = store.ordersFor(me.code);
    if (ui.chip === 'active') list = list.filter(o => o.status !== 'delivered');
    else list = list.filter(o => o.status === ui.chip);
    if (ui.urgentOnly) list = list.filter(o => o.urgent);
    if (isAdmin && ui.origin !== 'all') list = list.filter(o => o.origin === ui.origin);
    if (isAdmin && ui.fitter !== 'all') list = list.filter(o => o.fitter === ui.fitter);
    if (ui.q) {
      const q = ui.q.toLowerCase();
      list = list.filter(o => [o.ref, o.customer, o.brand, o.model, o.origin, o.fitter, locName(o.origin), o.fitter ? locName(o.fitter) : '']
        .some(v => String(v).toLowerCase().includes(q)));
    }
    return list.sort((a, b) => (b.urgent - a.urgent) || (b.updatedAt - a.updatedAt));
  }
  const counts = () => {
    const all = store.ordersFor(me.code);
    const c = { active: 0, delivered: 0 };
    FIT_FLOW.forEach(s => { c[s] = 0; });
    for (const o of all) { c[o.status]++; if (o.status !== 'delivered') c.active++; }
    return c;
  };

  // ── journey mini-diagram ──
  function journey(o, big = false) {
    const stage = FIT_FLOW.indexOf(o.status); // 0..5
    const seg1 = stage >= 2 ? 'done' : stage === 1 ? 'moving' : '';
    const seg2 = stage >= 5 ? 'done' : stage === 4 ? 'moving' : '';
    // Fitter node: brand navy from the moment it's in play, green once ready.
    const fitterCls = stage >= READY_IDX ? 'ready' : stage >= 1 ? 'done' : '';
    const node = (code, cls, lbl) => `
      <div class="j-node ${cls}">
        <span class="j-pin">${esc(code)}</span>
        ${big ? `<span class="j-lbl">${esc(lbl)}</span>` : ''}
      </div>`;
    const fitterCode = o.fitter ?? '?';
    const fitterName = o.fitter ? locName(o.fitter) : 'Unassigned';
    return `
      <div class="journey ${big ? 'journey-big' : ''}" title="${esc(locName(o.origin))} → ${esc(fitterName)} → back">
        ${node(o.origin, 'done', locName(o.origin))}
        <i class="j-seg ${seg1}"></i>
        ${node(fitterCode, fitterCls, fitterName)}
        <i class="j-seg ${seg2}"></i>
        ${node(o.origin, stage >= 5 ? 'done' : '', 'Back at branch')}
      </div>`;
  }

  // ── stats tiles ──
  function statsHTML() {
    const all = store.ordersFor(me.code);
    const active = all.filter(o => o.status !== 'delivered');
    const mine = active.filter(o => canAdvanceOrder(o, me.code) && !(o.status === 'pending' && o.fitter));
    const week = all.filter(o => o.status === 'delivered' && Date.now() - o.updatedAt < 7 * 864e5);
    const t = (n, lbl, cls = '') => `
      <div class="stat ${cls}"><div class="stat-n">${n}</div><div class="stat-l">${lbl}</div></div>`;
    return t(active.length, 'Active orders')
      + t(active.filter(o => o.urgent).length, 'Urgent', 'stat-red')
      + t(mine.length, isAdmin ? 'Awaiting action' : 'Need your action', 'stat-brand')
      + t(week.length, 'Delivered · 7d');
  }

  // ── list ──
  function rowsHTML() {
    const list = visible();
    if (!list.length) return `<div class="empty">${icons.glasses}<p>No orders match this view.</p></div>`;
    return list.map(o => {
      const isNew = !ui.seen.has(o.id);
      const changed = ui.prevStatus.get(o.id) !== o.status;
      const can = canAdvanceOrder(o, me.code);
      const st = FIT_STATUS[o.status];
      const selected = ui.selected.has(o.id);
      const needsFitter = o.status === 'pending' && !o.fitter;
      // Primary action: pick a fitter, advance, or show who we're waiting on.
      let action;
      if (needsFitter && can) action = `<button class="btn btn-primary btn-sm" data-send-fitter="${o.id}">${icons.send} Send to fitter</button>`;
      else if (can && st.action) action = `<button class="btn btn-ghost btn-sm" data-advance="${o.id}">${esc(st.action)} ${icons.arrowRight}</button>`;
      else action = `<span class="row-actor">${o.status === 'delivered' ? icons.check : `waiting on ${esc(fitActor(o) ?? '')}`}</span>`;
      const title = o.customer || 'No customer name';
      const frame = [o.brand, o.model].filter(Boolean).join(' ') + (o.lens ? ` · ${o.lens}` : '');
      return `
      <div class="row ${isNew ? 'row-enter' : ''} ${o.urgent ? 'row-urgent' : ''} ${selected ? 'row-selected' : ''}" data-select="${o.id}">
        <label class="cbx" data-stop><input type="checkbox" data-sel="${o.id}" ${selected ? 'checked' : ''} ${o.status === 'delivered' ? 'disabled' : ''}><i></i></label>
        <div class="row-main">
          <div class="row-title">
            <b>${esc(o.ref)}</b>
            ${o.urgent ? urgentTag() : ''}
            <span class="row-cust">${esc(title)}</span>
          </div>
          <div class="row-sub">${frame ? `<span class="row-sub-txt">${esc(frame)}</span>` : ''}<span class="row-when" title="Logged ${fmtDT(o.createdAt)}">${frame ? '· ' : ''}${relTime(o.createdAt)}</span></div>
        </div>
        <div class="row-journey">${journey(o)}</div>
        <div class="row-status">${pill(FIT_STATUS, o.status, { flash: changed })}</div>
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
        : (o.status === 'pending' && !o.fitter) ? 'Send to fitter'
        : FIT_STATUS[o.status].action;
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
    return CHIP_DEFS.map(d => `
      <button class="chip ${ui.chip === d.key ? 'on' : ''}" data-chip="${d.key}">
        ${esc(d.label)}<span class="chip-n">${c[d.key] ?? 0}</span>
      </button>`).join('');
  }

  // ── drawer (order detail) ──
  function drawerHTML() {
    const o = store.order(drawerId);
    if (!o) return `<div class="pad">Order no longer exists.</div>`;
    const can = canAdvanceOrder(o, me.code);
    const st = FIT_STATUS[o.status];
    const needsFitter = o.status === 'pending' && !o.fitter;
    return `
      <div class="dw-head">
        <div>
          <div class="dw-kicker">Fitting order</div>
          <h2>${esc(o.ref)} ${o.urgent ? urgentTag() : ''}</h2>
          <div class="dw-sub">${esc(o.customer || 'No customer name')}${o.phone ? ` · ${esc(o.phone)}` : ''}</div>
        </div>
        <button class="icon-btn" data-close>${icons.x}</button>
      </div>
      <div class="dw-body">
        <div class="dw-status-row">${pill(FIT_STATUS, o.status)}<span class="dw-when">updated ${relTime(o.updatedAt)}</span></div>
        ${journey(o, true)}
        <div class="kv">
          <div><span>Origin</span><b>${locChip(o.origin)} ${esc(locName(o.origin))}</b></div>
          <div><span>Fitting centre</span><b>${o.fitter ? `${locChip(o.fitter)} ${esc(locName(o.fitter))}` : '<span class="muted">Not assigned yet</span>'}</b></div>
          ${o.note ? `<div class="kv-wide"><span>Note</span><b>${esc(o.note)}</b></div>` : ''}
        </div>
        <div class="dw-actions">
          ${needsFitter && can ? `<button class="btn btn-primary" data-send-fitter="${o.id}">${icons.send} Send to fitter</button>` :
            can && st.action ? `<button class="btn btn-primary" data-advance="${o.id}">${esc(st.action)} ${icons.arrowRight}</button>` : ''}
          ${o.status !== 'delivered' ? `<button class="btn btn-ghost" data-urgent="${o.id}">${icons.zap} ${o.urgent ? 'Remove urgent flag' : 'Flag urgent'}</button>` : ''}
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

  function openDrawer(id) {
    drawerId = id;
    drawer = openLayer('drawer', drawerHTML, { onClose: () => { drawer = null; drawerId = null; } });
    drawer.el.addEventListener('click', e => {
      if (e.target.closest('[data-close]')) return drawer.close();
      const sf = e.target.closest('[data-send-fitter]');
      if (sf) return fitterPicker(sf.dataset.sendFitter);
      const adv = e.target.closest('[data-advance]');
      if (adv) return store.advanceOrders([adv.dataset.advance], me.code);
      const urg = e.target.closest('[data-urgent]');
      if (urg) { const o = store.order(urg.dataset.urgent); store.setUrgent(o.id, !o.urgent, me.code); }
    });
  }

  // ── fitter picker (assign + send, one order or a bulk selection) ──
  function fitterPicker(ids) {
    ids = Array.isArray(ids) ? ids : [ids];
    const orders = ids.map(id => store.order(id)).filter(o => o && o.status === 'pending' && !o.fitter);
    if (!orders.length) return;
    const what = orders.length === 1 ? orders[0].ref : `${orders.length} orders`;
    const layer = openLayer('modal', () => `
      <div class="dw-head">
        <div><div class="dw-kicker">Send to fitter</div><h2>Choose a fitting centre for ${esc(what)}</h2></div>
        <button class="icon-btn" data-close>${icons.x}</button>
      </div>
      <div class="form">
        <p class="muted">Pick where ${orders.length === 1 ? 'this frame' : 'these frames'} should go for lens fitting.</p>
        <div class="picker-grid">
          ${FITTERS.map(f => `
            <button class="picker-card" data-fitter="${f.code}">
              <span class="loc-chip">${f.code}</span>
              <b>${esc(f.name)}</b>
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
        <p class="muted">You'll pick which fitting centre to send it to after it's logged.</p>
        <div class="form-foot">
          <button type="button" class="btn btn-ghost" data-close>Cancel</button>
          <button type="submit" class="btn btn-primary">${icons.send} Log order</button>
        </div>
      </form>
    `);
    layer.el.addEventListener('click', e => { if (e.target.closest('[data-close]')) layer.close(); });
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
      const o = await store.createOrder({ ref, origin: me.code, customer }, me.code);
      if (!o) { go.disabled = false; go.innerHTML = was; return; }
      layer.close();
      toast({ title: `${o.ref} logged`, sub: 'Use “Send to fitter” when it leaves your branch', tone: 'info' });
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
        ${me.role !== 'admin' ? `<button class="btn btn-primary" data-new>${icons.plus} New fitting order</button>` : ''}
      </header>
      <section class="stats" id="f-stats">${statsHTML()}</section>
      <section class="toolbar">
        <div class="searchbox">${icons.search}<input id="f-q" placeholder="Search ref, customer, frame, location…" value="${esc(ui.q)}"></div>
        ${isAdmin ? `
          <select class="sel" id="f-origin"><option value="all">All origins</option>${BRANCHES.map(b => `<option value="${b.code}" ${ui.origin === b.code ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>
          <select class="sel" id="f-fitter"><option value="all">All fitters</option>${FITTERS.map(b => `<option value="${b.code}" ${ui.fitter === b.code ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>` : ''}
        <button class="chip chip-urgent ${ui.urgentOnly ? 'on' : ''}" id="f-urgent">${icons.zap} Urgent only</button>
      </section>
      <section class="chips" id="f-chips">${chipsHTML()}</section>
      <div id="f-bulk">${bulkHTML()}</div>
      <section class="list" id="f-list">${rowsHTML()}</section>`;
    wire();
    markSeen();
  }

  function refreshLists() {
    root.querySelector('#f-stats').innerHTML = statsHTML();
    root.querySelector('#f-chips').innerHTML = chipsHTML();
    root.querySelector('#f-bulk').innerHTML = bulkHTML();
    root.querySelector('#f-list').innerHTML = rowsHTML();
    markSeen();
    drawer?.update();
  }

  function markSeen() {
    for (const o of store.state.orders) { ui.seen.add(o.id); ui.prevStatus.set(o.id, o.status); }
  }

  function toggleSelect(id) {
    const o = store.order(id);
    if (!o || o.status === 'delivered') return;
    if (ui.selected.has(id)) ui.selected.delete(id); else ui.selected.add(id);
    refreshLists();
  }

  function wire() {
    root.querySelector('#f-q').addEventListener('input', e => { ui.q = e.target.value; refreshLists(); });
    root.querySelector('#f-urgent').addEventListener('click', () => { ui.urgentOnly = !ui.urgentOnly; root.querySelector('#f-urgent').classList.toggle('on', ui.urgentOnly); refreshLists(); });
    root.querySelector('[data-new]')?.addEventListener('click', newOrderModal);
    root.querySelector('#f-origin')?.addEventListener('change', e => { ui.origin = e.target.value; refreshLists(); });
    root.querySelector('#f-fitter')?.addEventListener('change', e => { ui.fitter = e.target.value; refreshLists(); });

    root.addEventListener('click', e => {
      const chip = e.target.closest('[data-chip]');
      if (chip) { ui.chip = chip.dataset.chip; ui.selected.clear(); refreshLists(); return; }
      if (e.target.closest('[data-bulk-clear]')) { ui.selected.clear(); refreshLists(); return; }
      if (e.target.closest('[data-bulk-act]')) {
        const { action, ok } = bulkAction();
        if (!ok) return;
        const ids = [...ui.selected];
        if (action === 'Send to fitter') { fitterPicker(ids); return; } // picker clears selection on send
        ui.selected.clear();
        store.advanceOrders(ids, me.code); // store change triggers refresh
        return;
      }
      // Open the detail drawer via the arrow button.
      const openBtn = e.target.closest('[data-open]');
      if (openBtn) { e.stopPropagation(); openDrawer(openBtn.dataset.open); return; }
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
