// ── Outside Lens Orders (TRIAL) — Mohammed Ashraf at MGM orders them by WhatsApp ──
// A branch logs a fitting order with "Outside lenses" on: the prescription and
// the lens type, typed out. Here MGM copies them as WhatsApp text — one, a
// selection, or everything shown (e.g. one branch's day) — sends them to the
// supplier, and marks them Ordered so they move out of the way. The frame's
// own journey stays in the Fitting Log.
import { OUTSIDE_LENS_HANDLER, OUTSIDE_FULFILMENT, outsideCopyText, outsideRxLine, locName, readOnly } from './data.js';
import { store } from './store.js';
import { esc, relTime, fmtDT, icons, locChip, toast, chipCount } from './ui.js';

const TABS = [
  { key: 'to_order', label: 'To order' },
  { key: 'ordered', label: 'Ordered' },
];

export function outsideView(me) {
  // MGM marks them ordered; the office can too. Ghiath only looks.
  const canMark = me.code === OUTSIDE_LENS_HANDLER || me.role === 'admin';
  const viewOnly = readOnly(me.role);
  const ui = { tab: 'to_order', q: '', branch: 'all', selected: new Set() };
  let root;

  const all = () => store.state.outsideOrders ?? [];
  const orderOf = x => store.order(x.orderId);
  function visible() {
    let list = all().filter(x => x.status === ui.tab);
    if (ui.branch !== 'all') list = list.filter(x => x.branch === ui.branch);
    if (ui.q) {
      const q = ui.q.toLowerCase();
      list = list.filter(x => [orderOf(x)?.ref, orderOf(x)?.customer, x.branch, locName(x.branch), x.lensType]
        .some(v => String(v ?? '').toLowerCase().includes(q)));
    }
    // Oldest first: the order they came in is the order to place them.
    return list.sort((a, b) => (ui.tab === 'ordered' ? b.orderedAt - a.orderedAt : a.createdAt - b.createdAt));
  }

  // ── copy ──
  async function copy(list) {
    const text = list.map(x => outsideCopyText(x, orderOf(x))).join('\n\n');
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `Copied ${list.length} order${list.length === 1 ? '' : 's'}`, sub: 'Paste it into WhatsApp for the supplier.', tone: 'info' });
    } catch {
      // No clipboard (an old browser, or the page not allowed): show the text to copy by hand.
      window.prompt('Copy this text:', text);
    }
  }

  function mark(list, status) {
    const ids = list.map(x => x.id);
    if (!ids.length) return;
    ui.selected.clear();
    store.setOutsideStatus(ids, status, me.code);
  }

  // ── pieces ──
  function statsHTML() {
    const t = (n, lbl, cls = '') => `<div class="stat ${cls}"><div class="stat-n">${n}</div><div class="stat-l">${lbl}</div></div>`;
    const toOrder = all().filter(x => x.status === 'to_order');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const toSend = all().filter(x => x.status === 'ordered' && x.fulfilment === 'receive_lens' && !x.sentAt);
    return t(toOrder.length, 'To order', toOrder.length ? 'stat-amber' : '')
      + t(toSend.length, 'Lenses to send', toSend.length ? 'stat-amber' : '')
      + t(new Set(toOrder.map(x => x.branch)).size, 'Branches waiting')
      + t(all().filter(x => x.status === 'ordered' && x.orderedAt >= today.getTime()).length, 'Ordered today', 'stat-brand');
  }

  function chipsHTML() {
    const n = k => all().filter(x => x.status === k && (ui.branch === 'all' || x.branch === ui.branch)).length;
    // Orange: to order, and — on Ordered — lenses still to send.
    const toSend = all().filter(x => x.status === 'ordered' && x.fulfilment === 'receive_lens' && !x.sentAt
      && (ui.branch === 'all' || x.branch === ui.branch)).length;
    const act = k => (!canMark || viewOnly ? 0 : k === 'to_order' ? n(k) : toSend);
    return TABS.map(d => `<button class="chip ${ui.tab === d.key ? 'on' : ''}" data-tab="${d.key}">${esc(d.label)}${
      chipCount(n(d.key), act(d.key))}</button>`).join('');
  }

  function rowsHTML() {
    const list = visible();
    if (!list.length) return `<div class="empty">${icons.truck}<p>${ui.tab === 'to_order' ? 'Nothing to order.' : 'Nothing ordered yet.'}</p></div>`;
    return list.map(x => {
      const o = orderOf(x);
      const sel = ui.selected.has(x.id);
      return `
      <div class="row ol-row ${sel ? 'row-selected' : ''}" data-select="${x.id}">
        <label class="cbx" data-stop><input type="checkbox" data-sel="${x.id}" ${sel ? 'checked' : ''} ${viewOnly ? 'disabled' : ''}><i></i></label>
        <div class="row-main">
          <div class="row-title"><b>${esc(o?.ref ?? '—')}</b><span class="row-cust">${esc(o?.customer ?? '')}</span></div>
          <div class="row-sub">${locChip(x.branch)} <span>${esc(locName(x.branch))}</span>
            <span class="row-when" title="${fmtDT(x.createdAt)}">· ${relTime(x.createdAt)}</span></div>
        </div>
        <div class="ol-rx">
          <span>${esc(outsideRxLine('R', x.rx?.r))}</span>
          <span>${esc(outsideRxLine('L', x.rx?.l))}</span>
        </div>
        <div class="ol-type"><b>${esc(x.lensType)}</b>
          <span class="fulfil-chip ${x.fulfilment}">${esc(x.fulfilment === 'receive_lens' ? `Lenses go to ${x.branch}` : OUTSIDE_FULFILMENT.send_frames.chip)}</span>
          ${x.status === 'ordered' ? `<span class="muted sm">ordered ${relTime(x.orderedAt)}${x.sentAt ? ` · sent ${relTime(x.sentAt)}` : ''}</span>` : ''}</div>
        <div class="row-act" data-stop>
          <button class="icon-btn" data-copy="${x.id}" title="Copy for WhatsApp">${icons.copy}</button>
          ${!canMark || viewOnly ? '' : x.status === 'to_order'
            ? `<button class="btn btn-primary btn-sm" data-mark="${x.id}" data-to="ordered">${icons.check} Ordered</button>`
            : x.fulfilment === 'receive_lens' && !x.sentAt
              ? `<button class="btn btn-ghost btn-sm" data-mark="${x.id}" data-to="to_order" title="Put it back to To order">Undo</button>
                 <button class="btn btn-primary btn-sm" data-send="${x.id}">${icons.send} Send lenses</button>`
              : x.sentAt ? '<span class="row-actor">sent</span>'
              : `<button class="btn btn-ghost btn-sm" data-mark="${x.id}" data-to="to_order" title="Put it back to To order">Undo</button>`}
        </div>
      </div>`;
    }).join('');
  }

  function bulkHTML() {
    const shown = visible();
    const picked = shown.filter(x => ui.selected.has(x.id));
    const set = picked.length ? picked : shown;
    if (!set.length) return '';
    const what = picked.length ? `${picked.length} selected` : `All ${shown.length} shown${ui.branch !== 'all' ? ` from ${esc(locName(ui.branch))}` : ''}`;
    return `
      <div class="bulkbar ol-bulk">
        <span><b>${what}</b></span>
        <button class="btn btn-primary btn-sm" data-copy-set>${icons.copy} Copy for WhatsApp</button>
        ${canMark && !viewOnly ? (ui.tab === 'to_order'
          ? `<button class="btn btn-ghost btn-sm" data-mark-set="ordered">${icons.check} Mark ordered</button>`
          : `<button class="btn btn-ghost btn-sm" data-mark-set="to_order">Put back to To order</button>`) : ''}
        ${picked.length ? '<button class="btn btn-ghost btn-sm" data-clear>Clear selection</button>' : ''}
      </div>`;
  }

  const setOf = () => { const shown = visible(); const picked = shown.filter(x => ui.selected.has(x.id)); return picked.length ? picked : shown; };

  function branchOptions() {
    const codes = [...new Set(all().map(x => x.branch))];
    return codes.map(c => `<option value="${c}" ${ui.branch === c ? 'selected' : ''}>${esc(locName(c))}</option>`).join('');
  }

  function render() {
    root.innerHTML = `
      <header class="mod-head">
        <div>
          <h1>Outside Lens Orders</h1>
          <p class="mod-sub">Lenses from outside brands the branches need — copy them for the supplier, then mark them ordered</p>
        </div>
      </header>
      <section class="stats" id="ol-stats">${statsHTML()}</section>
      <section class="toolbar">
        <div class="searchbox">${icons.search}<input id="ol-q" placeholder="Search order, customer, branch, lens…" value="${esc(ui.q)}"></div>
        <select class="sel" id="ol-branch" aria-label="Branch"><option value="all">All branches</option>${branchOptions()}</select>
      </section>
      <section class="chips status-chips" id="ol-chips">${chipsHTML()}</section>
      <div id="ol-bulk">${bulkHTML()}</div>
      <section class="list" id="ol-list">${rowsHTML()}</section>`;
    root.querySelector('#ol-q').addEventListener('input', e => { ui.q = e.target.value; refresh(); });
    root.querySelector('#ol-branch').addEventListener('change', e => { ui.branch = e.target.value; ui.selected.clear(); refresh(); });
  }

  function refresh() {
    const s = root.querySelector('#ol-stats');
    if (!s) return;
    s.innerHTML = statsHTML();
    root.querySelector('#ol-chips').innerHTML = chipsHTML();
    root.querySelector('#ol-bulk').innerHTML = bulkHTML();
    root.querySelector('#ol-list').innerHTML = rowsHTML();
    const b = root.querySelector('#ol-branch');
    if (b && document.activeElement !== b) b.innerHTML = `<option value="all">All branches</option>${branchOptions()}`;
  }

  function wire() {
    root.addEventListener('click', e => {
      const tab = e.target.closest('[data-tab]');
      if (tab) { ui.tab = tab.dataset.tab; ui.selected.clear(); return refresh(); }
      const c = e.target.closest('[data-copy]');
      if (c) { const x = all().find(y => y.id === c.dataset.copy); return x && copy([x]); }
      if (e.target.closest('[data-copy-set]')) return copy(setOf());
      const sd = e.target.closest('[data-send]');
      if (sd) return store.sendOutsideLenses(sd.dataset.send, me.code);
      const m = e.target.closest('[data-mark]');
      if (m) { const x = all().find(y => y.id === m.dataset.mark); return x && mark([x], m.dataset.to); }
      const ms = e.target.closest('[data-mark-set]');
      if (ms) {
        const set = setOf();
        if (ms.dataset.markSet === 'ordered' && set.length > 1 && !confirm(`Mark ${set.length} orders as ordered?`)) return;
        return mark(set, ms.dataset.markSet);
      }
      if (e.target.closest('[data-clear]')) { ui.selected.clear(); return refresh(); }
      const sel = e.target.closest('[data-sel]');
      if (sel) { toggle(sel.dataset.sel); return; }
      if (e.target.closest('[data-stop]')) return;
      const row = e.target.closest('[data-select]');
      if (row && !viewOnly) toggle(row.dataset.select);
    });
  }
  function toggle(id) {
    if (ui.selected.has(id)) ui.selected.delete(id); else ui.selected.add(id);
    refresh();
  }

  return {
    mount(el) { root = el; render(); wire(); },
    onChange() { refresh(); },
    unmount() {},
  };
}

