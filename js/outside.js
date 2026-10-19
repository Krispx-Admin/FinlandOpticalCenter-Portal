// ── Outside Lens Orders (TRIAL) — Mohammed Ashraf at MGM orders them by WhatsApp ──
// A branch logs a fitting order with "Outside lenses" on: the prescription and
// the lens type, typed out. Here MGM copies them as WhatsApp text — one, a
// selection, or everything shown (e.g. one branch's day) — sends them to the
// supplier, and confirms them ordered so they move out of the way. The frame's
// own journey stays in the Fitting Log. With the supplier's number saved here
// (schema-51), the WhatsApp button opens the supplier's chat with the picked
// orders typed — no copy and paste; Copy for WhatsApp stays beside it.
import { outsideHandler, outsideCopyText, outsideRxLine, locName, readOnly, BRANCHES, can } from './data.js';
import { store } from './store.js';
import { phoneFieldHTML, wirePhoneFields, phoneValue, splitPhone } from './phone.js';
import { esc, relTime, fmtDT, icons, locChip, toast, chipCount, openLayer } from './ui.js';

const TABS = [
  { key: 'to_order', label: 'To order' },
  { key: 'ordered', label: 'Ordered' },
];

export function outsideView(me) {
  // MGM marks them ordered; the office can too. Ghiath only looks.
  const canMark = me.code === outsideHandler() || can(me, 'act_all');
  const viewOnly = readOnly(me);
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

  // ── WhatsApp the supplier (user 2026-10-19) ──
  const supplier = () => ({ name: store.settings.supplierName ?? '', phone: store.settings.supplierPhone ?? '' });
  const canSetSupplier = canMark && !viewOnly;
  async function sendToSupplier(list) {
    const text = list.map(x => outsideCopyText(x, orderOf(x))).join('\n\n');
    if (!text) return;
    if (!supplier().phone) {
      if (!canSetSupplier) return toast({ title: 'No supplier number yet', sub: `${outsideHandler()} or the office adds it on this page.`, tone: 'stock' });
      if (!(await supplierModal())) return;
    }
    location.href = `whatsapp://send?phone=${supplier().phone}&text=${encodeURIComponent(text)}`;
  }
  // The supplier's name and number; resolves true once saved.
  function supplierModal() {
    const s = supplier();
    const { iso, local } = splitPhone(s.phone);
    return new Promise(done => {
      let answered = false;
      const finish = v => { if (!answered) { answered = true; done(v); } };
      const layer = openLayer('modal', () => `
        <div class="dw-head">
          <div><div class="dw-kicker">Outside Lens Orders</div><h2>Supplier's WhatsApp</h2></div>
          <button class="icon-btn" data-close>${icons.x}</button>
        </div>
        <form class="form" id="sup-form" autocomplete="off">
          <p class="muted sm">The WhatsApp button opens this number's chat with the orders typed — press Send there.</p>
          <label>Name <span class="opt">optional</span><input name="name" value="${esc(s.name)}" placeholder="e.g. the lab or the person"></label>
          <div class="ph-label"><span>WhatsApp number</span>${phoneFieldHTML({ iso, value: local })}</div>
          <div class="form-foot">
            ${s.phone ? '<button type="button" class="btn btn-ghost" data-sup-clear>Remove</button>' : ''}
            <button type="button" class="btn btn-ghost" data-close>Cancel</button>
            <button type="submit" class="btn btn-primary">${icons.check} Save</button>
          </div>
        </form>`, { onClose: () => finish(false) });
      wirePhoneFields(layer.el);
      layer.el.querySelector('input[inputmode=tel]')?.focus();
      layer.el.addEventListener('click', async e => {
        if (e.target.closest('[data-close]')) return layer.close();
        if (e.target.closest('[data-sup-clear]') && confirm('Remove the supplier\'s number?')) {
          if (await store.setOutsideSupplier('', null, me.code)) layer.close();
        }
      });
      layer.el.addEventListener('submit', async e => {
        e.preventDefault();
        const phone = phoneValue(layer.el.querySelector('[data-ph]'));
        if (!phone) return toast({ title: 'That number does not look right', sub: 'Type the number — the country is picked on its left.', tone: 'stock' });
        const name = new FormData(e.target).get('name')?.toString().trim() ?? '';
        if (await store.setOutsideSupplier(name, phone, me.code)) { finish(true); layer.close(); }
      });
    });
  }
  function supplierHTML() {
    const s = supplier();
    if (!s.phone && !canSetSupplier) return '';
    const label = s.phone ? `${s.name ? `${esc(s.name)} · ` : ''}+${esc(s.phone)}` : 'Add the supplier’s WhatsApp';
    return canSetSupplier
      ? `<button class="btn btn-ghost btn-sm ol-sup" data-sup title="The supplier's WhatsApp — change it">${icons.whatsapp}<span>Supplier</span><b>${label}</b></button>`
      : `<span class="ol-sup ol-sup-ro">${icons.whatsapp}<span>Supplier</span><b>${label}</b></span>`;
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
    const toSend = all().filter(x => x.status === 'ordered' && !x.sentAt && x.branch !== outsideHandler());
    return t(toOrder.length, 'To order', toOrder.length ? 'stat-amber' : '')
      + t(toSend.length, 'Lenses to send', toSend.length ? 'stat-amber' : '')
      + t(new Set(toOrder.map(x => x.branch)).size, 'Branches waiting')
      + t(all().filter(x => x.status === 'ordered' && x.orderedAt >= today.getTime()).length, 'Ordered today', 'stat-brand');
  }

  function chipsHTML() {
    const n = k => all().filter(x => x.status === k && (ui.branch === 'all' || x.branch === ui.branch)).length;
    // Orange: to order, and — on Ordered — lenses still to send.
    const toSend = all().filter(x => x.status === 'ordered' && !x.sentAt && x.branch !== outsideHandler()
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
          <span class="fulfil-chip ${x.fulfilment}">${esc(x.branch === outsideHandler() ? 'Stays here' : `Lenses go to ${x.dest ?? x.branch}`)}</span>
          ${x.status === 'ordered' ? `<span class="muted sm">ordered ${relTime(x.orderedAt)}${x.arrivedAt && !x.sentAt ? ' · received here' : ''}${x.sentAt ? ` · sent ${relTime(x.sentAt)}` : ''}${x.receivedAt ? ` · received` : ''}</span>` : ''}</div>
        <div class="row-act" data-stop>
          <button class="icon-btn" data-copy="${x.id}" title="Copy for WhatsApp">${icons.copy}</button>
          <button class="icon-btn ol-wa" data-wa="${x.id}" title="Send to the supplier on WhatsApp">${icons.whatsapp}</button>
          ${!canMark || viewOnly ? '' : x.status === 'to_order'
            ? `<button class="btn btn-primary btn-sm" data-mark="${x.id}" data-to="ordered">${icons.check} Confirm Order</button>`
            : !x.sentAt && x.branch !== outsideHandler()
              ? (x.arrivedAt
                ? `<button class="btn btn-primary btn-sm" data-send="${x.id}">${icons.send} Send Lenses to ${esc(x.dest ?? x.branch)}</button>`
                : `<button class="btn btn-ghost btn-sm" data-mark="${x.id}" data-to="to_order" title="Put it back to To order">Undo</button>
                   <button class="btn btn-primary btn-sm" data-arrive="${x.id}">Lens Received ${icons.arrowRight}</button>`)
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
        <button class="btn btn-ghost btn-sm" data-copy-set>${icons.copy} Copy for WhatsApp</button>
        <button class="btn btn-ghost btn-sm ol-wa-set" data-wa-set title="Opens the supplier's WhatsApp with these orders typed — press Send there">${icons.whatsapp} WhatsApp ${esc(supplier().name || 'supplier')}</button>
        ${canMark && !viewOnly ? (ui.tab === 'to_order'
          ? `<button class="btn btn-primary btn-sm" data-mark-set="ordered">${icons.check} Confirm ${set.length > 1 ? `${set.length} orders` : 'order'}</button>`
          : `<button class="btn btn-ghost btn-sm" data-mark-set="to_order">Put back to To order</button>`) : ''}
        ${picked.length ? '<button class="btn btn-ghost btn-sm" data-clear>Clear selection</button>' : ''}
      </div>`;
  }

  // Select every order shown — copy them, then confirm them, still selected.
  function selectAllHTML() {
    if (viewOnly) return '';
    const list = visible();
    if (!list.length) return '';
    const every = list.every(x => ui.selected.has(x.id));
    return `
      <label class="sel-all">
        <span class="cbx"><input type="checkbox" data-sel-all ${every ? 'checked' : ''}><i></i></span>
        <span>${every ? 'Clear selection' : `Select all ${list.length}`}</span>
      </label>`;
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
          <p class="mod-sub">Lenses from outside brands the branches need — copy them for the supplier, then confirm the order</p>
        </div>
        <div class="ol-head-r">
        <span id="ol-sup">${supplierHTML()}</span>
        ${can(me, 'lists') ? `<label class="set-ctl ol-handler"><span>Ordered by</span>
          <select id="ol-handler">${BRANCHES.map(b => `<option value="${b.code}" ${b.code === outsideHandler() ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>` : ''}
        </div>
      </header>
      <section class="stats" id="ol-stats">${statsHTML()}</section>
      <section class="toolbar">
        <div class="searchbox">${icons.search}<input id="ol-q" placeholder="Search order, customer, branch, lens…" value="${esc(ui.q)}"></div>
        <select class="sel" id="ol-branch" aria-label="Branch"><option value="all">All branches</option>${branchOptions()}</select>
      </section>
      <section class="chips status-chips" id="ol-chips">${chipsHTML()}</section>
      <div id="ol-bulk">${bulkHTML()}</div>
      <div id="ol-selall">${selectAllHTML()}</div>
      <section class="list" id="ol-list">${rowsHTML()}</section>`;
    root.querySelector('#ol-q').addEventListener('input', e => { ui.q = e.target.value; refresh(); });
    root.querySelector('#ol-branch').addEventListener('change', e => { ui.branch = e.target.value; ui.selected.clear(); refresh(); });
    root.querySelector('#ol-handler')?.addEventListener('change', e => {
      const b = BRANCHES.find(x => x.code === e.target.value);
      if (!confirm(`${b?.name ?? e.target.value} orders the outside lenses from now on?`)) { e.target.value = outsideHandler(); return; }
      store.setOutsideHandler(e.target.value);
    });
  }

  function refresh() {
    const s = root.querySelector('#ol-stats');
    if (!s) return;
    s.innerHTML = statsHTML();
    root.querySelector('#ol-sup').innerHTML = supplierHTML();
    root.querySelector('#ol-chips').innerHTML = chipsHTML();
    root.querySelector('#ol-bulk').innerHTML = bulkHTML();
    root.querySelector('#ol-selall').innerHTML = selectAllHTML();
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
      const w = e.target.closest('[data-wa]');
      if (w) { const x = all().find(y => y.id === w.dataset.wa); return x && sendToSupplier([x]); }
      if (e.target.closest('[data-wa-set]')) return sendToSupplier(setOf());
      if (e.target.closest('[data-sup]')) return supplierModal();
      const ar = e.target.closest('[data-arrive]');
      if (ar) return store.arriveOutsideLenses(ar.dataset.arrive, me.code);
      const sd = e.target.closest('[data-send]');
      if (sd) return store.sendOutsideLenses(sd.dataset.send, me.code);
      const m = e.target.closest('[data-mark]');
      if (m) { const x = all().find(y => y.id === m.dataset.mark); return x && mark([x], m.dataset.to); }
      const ms = e.target.closest('[data-mark-set]');
      if (ms) return mark(setOf(), ms.dataset.markSet);
      const sa = e.target.closest('[data-sel-all]');
      if (sa) {
        for (const x of visible()) { if (sa.checked) ui.selected.add(x.id); else ui.selected.delete(x.id); }
        return refresh();
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

