// ── Module 2: Stock Requests — branch composer + warehouse fulfilment queue ──
import { REQ_STATUS, AUDIENCES, BRANCHES, locName } from './data.js';
import { store } from './store.js';
import { esc, relTime, fmtDT, icons, pill, locChip, openLayer, closeLayer, toast } from './ui.js';

const CHIPS = [
  { key: 'placed', label: 'To fulfil' },
  { key: 'completed', label: 'Completed' },
  { key: 'all', label: 'All' },
];

const units = r => r.lines.reduce((s, l) => s + (l.qty || 0), 0);
const unitLbl = l => l.unit === 'box' ? (l.qty === 1 ? 'box' : 'boxes') : 'pcs';
// e.g. "3 lines · 24 pcs · 5 boxes"
function unitsBreakdown(lines) {
  const pcs = lines.reduce((s, l) => s + (l.qty && l.unit !== 'box' ? l.qty : 0), 0);
  const box = lines.reduce((s, l) => s + (l.qty && l.unit === 'box' ? l.qty : 0), 0);
  return [pcs ? `${pcs} pcs` : '', box ? `${box} box${box === 1 ? '' : 'es'}` : ''].filter(Boolean).join(' · ');
}

export function stockView(me) {
  const isAdmin = me.role === 'admin';
  const ui = {
    chip: isAdmin ? 'placed' : 'all', q: '', branch: 'all',
    seen: new Set(store.state.requests.map(r => r.id)),
    prevStatus: new Map(store.state.requests.map(r => [r.id, r.status])),
  };
  let root, drawer = null, drawerId = null;

  function visible() {
    let list = store.requestsFor(me.code);
    if (ui.chip !== 'all') list = list.filter(r => r.status === ui.chip);
    if (isAdmin && ui.branch !== 'all') list = list.filter(r => r.branch === ui.branch);
    if (ui.q) {
      const q = ui.q.toLowerCase();
      list = list.filter(r => [r.ref, r.branch, locName(r.branch), ...r.lines.map(l => `${l.category} ${l.brand ?? ''}`)]
        .some(v => String(v).toLowerCase().includes(q)));
    }
    const rank = { placed: 0, completed: 1 };
    return list.sort((a, b) => (rank[a.status] - rank[b.status]) || (b.updatedAt - a.updatedAt));
  }

  const counts = () => {
    const all = store.requestsFor(me.code);
    const c = { placed: 0, completed: 0, all: all.length };
    for (const r of all) c[r.status]++;
    return c;
  };

  function statsHTML() {
    const all = store.requestsFor(me.code);
    const c = counts();
    const t = (n, lbl, cls = '') => `<div class="stat ${cls}"><div class="stat-n">${n}</div><div class="stat-l">${lbl}</div></div>`;
    if (isAdmin) {
      const week = all.filter(r => r.status === 'completed' && Date.now() - r.updatedAt < 7 * 864e5).length;
      const openUnits = all.filter(r => r.status === 'placed').reduce((s, r) => s + units(r), 0);
      return t(c.placed, 'To fulfil', 'stat-amber') + t(openUnits, 'Units to pick', 'stat-brand') + t(week, 'Completed · 7d') + t(c.all, 'All requests');
    }
    const mine = all.filter(r => r.status === 'placed');
    return t(c.placed, 'Awaiting warehouse', 'stat-amber') + t(mine.reduce((s, r) => s + units(r), 0), 'Units requested', 'stat-brand') + t(c.completed, 'Completed') + t(c.all, 'All requests');
  }

  function lineSummary(r) {
    const names = r.lines.slice(0, 2).map(l => l.brand ? `${l.category} · ${l.brand}` : l.category);
    const more = r.lines.length - names.length;
    return esc(names.join(', ')) + (more > 0 ? ` <span class="muted">+${more} more</span>` : '');
  }

  function rowsHTML() {
    const list = visible();
    if (!list.length) return `<div class="empty">${icons.box}<p>No requests match this view.</p></div>`;
    return list.map(r => {
      const isNew = !ui.seen.has(r.id);
      const changed = ui.prevStatus.get(r.id) !== r.status;
      const quick = isAdmin && r.status === 'placed'
        ? `<button class="btn btn-ghost btn-sm" data-print="${r.id}">${icons.printer} Print</button>
           <button class="btn btn-ghost btn-sm" data-complete="${r.id}">${icons.check} Complete</button>` : '';
      return `
      <div class="row ${isNew ? 'row-enter' : ''}" data-open="${r.id}">
        <div class="row-main">
          <div class="row-title"><b>${esc(r.ref)}</b>
            ${isAdmin ? `<span class="row-cust">${locChip(r.branch)} ${esc(locName(r.branch))}</span>` : ''}
          </div>
          <div class="row-sub">${lineSummary(r)}</div>
        </div>
        <div class="row-units"><b>${r.lines.length}</b> line${r.lines.length === 1 ? '' : 's'}${unitsBreakdown(r.lines) ? ` · ${unitsBreakdown(r.lines)}` : ''}</div>
        <div class="row-status">${pill(REQ_STATUS, r.status, { flash: changed })}</div>
        <div class="row-time" title="${fmtDT(r.updatedAt)}">${relTime(r.updatedAt)}</div>
        <div class="row-act" data-stop>${quick}</div>
      </div>`;
    }).join('');
  }

  const chipsHTML = () => {
    const c = counts();
    return CHIPS.map(d => `<button class="chip ${ui.chip === d.key ? 'on' : ''}" data-chip="${d.key}">${esc(d.label)}<span class="chip-n">${c[d.key]}</span></button>`).join('');
  };

  // ── drawer: request detail ──
  function linesTableHTML(r) {
    const anyBrand = r.lines.some(l => l.brand);
    const anyAud = r.lines.some(l => l.audience);
    const anyQty = r.lines.some(l => l.qty != null);
    return `
      <table class="lines">
        <thead><tr>
          <th>Category</th>
          ${anyBrand ? '<th>Brand</th>' : ''}
          ${anyAud ? '<th>Audience</th>' : ''}
          ${anyQty ? '<th class="num">Qty</th>' : ''}
        </tr></thead>
        <tbody>
          ${r.lines.map(l => `
            <tr>
              <td><b>${esc(l.category)}</b>${l.note ? `<div class="line-note">${esc(l.note)}</div>` : ''}</td>
              ${anyBrand ? `<td>${l.brand ? esc(l.brand) : '<span class="muted">—</span>'}</td>` : ''}
              ${anyAud ? `<td>${l.audience ? esc(l.audience) : '<span class="muted">—</span>'}</td>` : ''}
              ${anyQty ? `<td class="num">${l.qty != null ? `<b>${l.qty}</b> <span class="muted">${unitLbl(l)}</span>` : '<span class="muted">—</span>'}</td>` : ''}
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  function drawerHTML() {
    const r = store.request(drawerId);
    if (!r) return `<div class="pad">Request no longer exists.</div>`;
    const actions = isAdmin && r.status === 'placed'
      ? `<button class="btn btn-ghost" data-print="${r.id}">${icons.printer} Print PDF</button>
         <button class="btn btn-primary" data-complete="${r.id}">${icons.check} Mark completed</button>`
      : '';
    return `
      <div class="dw-head">
        <div>
          <div class="dw-kicker">Stock request</div>
          <h2>${esc(r.ref)}</h2>
          <div class="dw-sub">${locChip(r.branch)} ${esc(locName(r.branch))} → Warehouse${r.note ? ` · “${esc(r.note)}”` : ''}</div>
        </div>
        <button class="icon-btn" data-close>${icons.x}</button>
      </div>
      <div class="dw-body">
        <div class="dw-status-row">${pill(REQ_STATUS, r.status)}<span class="dw-when">updated ${relTime(r.updatedAt)}</span></div>
        ${isAdmin && r.status === 'placed' ? `<div class="review-hint">${icons.printer} Print the pick sheet, fulfil it physically, then mark it completed.</div>` : ''}
        ${linesTableHTML(r)}
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
    drawer = openLayer('drawer', drawerHTML, { onClose: () => { drawer = null; drawerId = null; } });
    drawer.el.addEventListener('click', e => {
      if (e.target.closest('[data-close]')) return drawer.close();
      const pr = e.target.closest('[data-print]');
      if (pr) return printRequest(store.request(pr.dataset.print));
      const cp = e.target.closest('[data-complete]');
      if (cp) return store.completeRequest(cp.dataset.complete, me.code);
    });
  }

  // ── print pick sheet (browser print → PDF) ──
  function printRequest(r) {
    if (!r) return;
    const rows = r.lines.map(l => `
      <tr>
        <td>${esc(l.category)}${l.note ? `<div class="n">${esc(l.note)}</div>` : ''}</td>
        <td>${esc(l.brand ?? '—')}</td>
        <td>${esc(l.audience ?? '—')}</td>
        <td class="num">${l.qty != null ? `${l.qty} ${unitLbl(l)}` : '—'}</td>
        <td class="pick"></td>
      </tr>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(r.ref)} — Pick Sheet</title>
      <style>
        body{font:13px system-ui,Segoe UI,Roboto,sans-serif;color:#17202b;padding:32px;}
        h1{font-size:22px;margin:0 0 2px;}
        .meta{color:#4c5a6b;margin-bottom:18px;}
        .meta b{color:#17202b;}
        table{width:100%;border-collapse:collapse;margin-top:10px;}
        th,td{text-align:left;padding:9px 10px;border-bottom:1px solid #e3e8f0;vertical-align:top;}
        th{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#8593a5;}
        .num{text-align:right;}
        .pick{width:80px;border:1px solid #cfd8e5;}
        .n{color:#8593a5;font-size:11px;margin-top:2px;}
        .foot{margin-top:26px;color:#8593a5;font-size:11px;border-top:1px solid #e3e8f0;padding-top:10px;}
        @media print{body{padding:0;}}
      </style></head><body>
      <h1>Stock Request — ${esc(r.ref)}</h1>
      <div class="meta"><b>${esc(locName(r.branch))}</b> (${esc(r.branch)}) → Warehouse · Placed ${esc(fmtDT(r.createdAt))}${r.note ? ` · Note: ${esc(r.note)}` : ''}</div>
      <table>
        <thead><tr><th>Category</th><th>Brand</th><th>Audience</th><th class="num">Qty</th><th>Picked</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="foot">${r.lines.length} line${r.lines.length === 1 ? '' : 's'}${unitsBreakdown(r.lines) ? ` · ${unitsBreakdown(r.lines)}` : ''} · Generated ${esc(fmtDT(Date.now()))}</div>
      </body></html>`;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  }

  // ── composer: new stock request ──
  function composerModal() {
    const cats = store.settings.categories;
    if (!cats.length) {
      return toast({ title: 'No request categories configured', sub: 'Ask the warehouse to add one in Settings.', tone: 'stock' });
    }
    const catByName = name => cats.find(c => c.name === name) ?? cats[0];
    // Resolved live rather than snapshotted, so a settings change in another tab
    // can't leave this modal offering brands the category no longer allows.
    const brandsOf = c => store.brandsFor(c);
    const unitOf = c => store.unitFor(c);
    function blankLine() {
      const c = cats[0];
      const bs = brandsOf(c);
      return { category: c.name, brand: c.needsBrand ? (bs[0] ?? '') : '', audience: c.needsAudience ? 'Unisex' : '', qty: c.needsQty !== false ? 6 : null, unit: unitOf(c), note: '' };
    }
    let lines = [blankLine()];

    const sel = (name, opts, val, i) => `
      <select data-f="${name}" data-i="${i}">${opts.map(o => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;

    const lineRow = (l, i) => {
      const c = catByName(l.category);
      const bs = brandsOf(c);
      return `
        <div class="cl-row">
          ${sel('category', cats.map(c => c.name), l.category, i)}
          ${c.needsBrand
            ? (bs.length ? sel('brand', bs, l.brand, i)
                         : '<span class="cl-na" title="This category’s brand group is empty — add brands in Settings.">no brands</span>')
            : '<span class="cl-na">—</span>'}
          ${c.needsAudience ? sel('audience', AUDIENCES, l.audience, i) : '<span class="cl-na">—</span>'}
          ${c.needsQty !== false ? `
            <span class="qty-unit">
              <input type="number" min="1" max="999" value="${l.qty ?? 1}" data-f="qty" data-i="${i}">
              <span class="qty-u">${unitOf(c) === 'box' ? 'boxes' : 'pcs'}</span>
            </span>` : '<span class="cl-na">—</span>'}
          <input placeholder="optional" value="${esc(l.note)}" data-f="note" data-i="${i}">
          <button class="icon-btn" data-del="${i}" ${lines.length === 1 ? 'disabled' : ''}>${icons.x}</button>
        </div>`;
    };

    const layer = openLayer('modal', () => `
      <div class="dw-head">
        <div><div class="dw-kicker">New stock request</div><h2>Request inventory from the warehouse</h2></div>
        <button class="icon-btn" data-close>${icons.x}</button>
      </div>
      <div class="form">
        <div class="composer-lines">
          <div class="cl-head"><span>Category</span><span>Brand</span><span>Audience</span><span>Qty</span><span>Note</span><span></span></div>
          ${lines.map((l, i) => lineRow(l, i)).join('')}
        </div>
        <button class="btn btn-ghost btn-sm" data-add>${icons.plus} Add line</button>
        <label>Request note <span class="opt">optional</span><input id="req-note" placeholder="e.g. Weekend promo prep"></label>
        <div class="form-foot">
          <span class="muted" id="comp-total"></span>
          <button class="btn btn-ghost" data-close>Cancel</button>
          <button class="btn btn-primary" data-send>${icons.send} Place request</button>
        </div>
      </div>`);

    const totals = () => {
      const bd = unitsBreakdown(lines);
      const t = layer.el.querySelector('#comp-total');
      if (t) t.textContent = `${lines.length} line${lines.length === 1 ? '' : 's'}${bd ? ` · ${bd}` : ''}`;
    };
    const preserveNote = () => layer.el.querySelector('#req-note')?.value ?? '';
    const restoreNote = v => { const n = layer.el.querySelector('#req-note'); if (n) n.value = v; };
    totals();

    layer.el.addEventListener('input', e => {
      const f = e.target.dataset.f;
      if (!f) return;
      const l = lines[Number(e.target.dataset.i)];
      l[f] = f === 'qty' ? Math.max(0, parseInt(e.target.value, 10) || 0) : e.target.value;
      totals();
    });
    layer.el.addEventListener('change', e => {
      const f = e.target.dataset.f;
      if (!(f && e.target.tagName === 'SELECT')) return;
      const i = Number(e.target.dataset.i);
      const l = lines[i];
      if (f === 'category') {
        // Switching category re-applies that category's field rules.
        const c = catByName(e.target.value);
        const bs = brandsOf(c);
        l.category = e.target.value;
        // Keep the brand only if the new category's group actually offers it —
        // otherwise the select would show its first option while the line still
        // held the old brand, and that stale value is what would be submitted.
        l.brand = c.needsBrand ? (bs.includes(l.brand) ? l.brand : (bs[0] ?? '')) : '';
        l.audience = c.needsAudience ? (l.audience || 'Unisex') : '';
        l.qty = c.needsQty !== false ? (l.qty || 6) : null;
        l.unit = unitOf(c);
        const note = preserveNote();
        layer.update(); restoreNote(note); totals();
      } else {
        l[f] = e.target.value;
      }
    });
    layer.el.addEventListener('click', async e => {
      if (e.target.closest('[data-close]')) return layer.close();
      if (e.target.closest('[data-add]')) {
        const note = preserveNote();
        lines.push(blankLine());
        layer.update(); restoreNote(note); totals();
        return;
      }
      const del = e.target.closest('[data-del]');
      if (del) {
        const note = preserveNote();
        lines.splice(Number(del.dataset.del), 1);
        layer.update(); restoreNote(note); totals();
        return;
      }
      if (e.target.closest('[data-send]')) {
        const clean = lines
          .filter(l => l.category && (catByName(l.category).needsQty === false || l.qty > 0))
          .map(l => {
            const c = catByName(l.category);
            const bs = brandsOf(c);
            const out = { category: l.category, note: (l.note || '').trim() };
            if (c.needsBrand) out.brand = (bs.includes(l.brand) ? l.brand : (bs[0] ?? '')).trim();
            if (c.needsAudience) out.audience = l.audience;
            // The unit comes from the category, so it can't drift from settings.
            if (c.needsQty !== false) { out.qty = l.qty; out.unit = unitOf(c); }
            return out;
          });
        if (!clean.length) return;
        const place = e.target.closest('[data-send]');
        place.disabled = true;
        const was = place.innerHTML;
        place.textContent = 'Placing…';
        const r = await store.createRequest({ lines: clean, note: preserveNote().trim() }, me.code);
        if (!r) { place.disabled = false; place.innerHTML = was; return; }
        layer.close();
        openDrawer(r.id);
      }
    });
  }

  // ── render ──
  function render() {
    root.innerHTML = `
      <header class="mod-head">
        <div>
          <h1>${isAdmin ? 'Warehouse — Request Queue' : 'Stock Requests'}</h1>
          <p class="mod-sub">${isAdmin ? 'Print each request, fulfil it, then mark it completed' : 'Request inventory from the central warehouse and track it here'}</p>
        </div>
        ${!isAdmin ? `<button class="btn btn-primary" data-new>${icons.plus} New stock request</button>` : ''}
      </header>
      <section class="stats" id="s-stats">${statsHTML()}</section>
      <section class="toolbar">
        <div class="searchbox">${icons.search}<input id="s-q" placeholder="Search ref, branch, category…" value="${esc(ui.q)}"></div>
        ${isAdmin ? `<select class="sel" id="s-branch"><option value="all">All branches</option>${BRANCHES.map(b => `<option value="${b.code}" ${ui.branch === b.code ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>` : ''}
      </section>
      <section class="chips" id="s-chips">${chipsHTML()}</section>
      <section class="list" id="s-list">${rowsHTML()}</section>`;
    wire();
    markSeen();
  }

  function refreshLists() {
    root.querySelector('#s-stats').innerHTML = statsHTML();
    root.querySelector('#s-chips').innerHTML = chipsHTML();
    root.querySelector('#s-list').innerHTML = rowsHTML();
    markSeen();
    const f = document.activeElement;
    if (!(drawer && f && drawer.el.contains(f) && f.matches('input,select,textarea'))) drawer?.update();
  }

  function markSeen() {
    for (const r of store.state.requests) { ui.seen.add(r.id); ui.prevStatus.set(r.id, r.status); }
  }

  function wire() {
    root.querySelector('#s-q').addEventListener('input', e => { ui.q = e.target.value; refreshLists(); });
    root.querySelector('[data-new]')?.addEventListener('click', composerModal);
    root.querySelector('#s-branch')?.addEventListener('change', e => { ui.branch = e.target.value; refreshLists(); });
    root.addEventListener('click', e => {
      const chip = e.target.closest('[data-chip]');
      if (chip) { ui.chip = chip.dataset.chip; refreshLists(); return; }
      const pr = e.target.closest('[data-print]');
      if (pr) { e.stopPropagation(); printRequest(store.request(pr.dataset.print)); return; }
      const cp = e.target.closest('[data-complete]');
      if (cp) { e.stopPropagation(); store.completeRequest(cp.dataset.complete, me.code); return; }
      if (e.target.closest('[data-stop]')) return;
      const row = e.target.closest('[data-open]');
      if (row) openDrawer(row.dataset.open);
    });
  }

  return {
    mount(container) { root = container; render(); },
    onChange() { refreshLists(); },
    unmount() { closeLayer(); },
  };
}
