// ── Damaged Stock — a branch lists its damaged pieces; the admins print it ──
// The branch walks the shop, collects every damaged frame and sends one
// report: the name of the glasses, the barcode, how many — as many lines as it
// needs. Omar (Office), Wijdan and Sarah print the paper and send it on;
// Ghiath can look. No statuses: a report is a piece of paper (user, 2026-10-15).
import { BRANCHES, locName, seesAll, can } from './data.js';
import { store } from './store.js';
import { esc, relTime, fmtDT, icons, locChip, openLayer, closeLayer } from './ui.js';

const pcsOf = r => r.lines.reduce((s, l) => s + (l.qty || 0), 0);

export function damagedView(me) {
  const overseer = seesAll(me);          // Omar, Wijdan, Sarah, Ghiath
  const canSend = !overseer;                  // the branches
  const ui = { q: '', branch: 'all' };
  let root, drawer = null, drawerId = null;

  const all = () => store.damagedFor(me.code);
  const report = id => all().find(r => r.id === id);
  function visible() {
    let list = all();
    if (overseer && ui.branch !== 'all') list = list.filter(r => r.branch === ui.branch);
    if (ui.q) {
      const q = ui.q.toLowerCase();
      list = list.filter(r => [r.ref, r.branch, locName(r.branch), r.note, ...r.lines.flatMap(l => [l.name, l.barcode])]
        .some(v => String(v ?? '').toLowerCase().includes(q)));
    }
    return list.sort((a, b) => b.createdAt - a.createdAt);
  }
  const canDelete = r => r.branch === me.code || can(me, 'act_all');

  function statsHTML() {
    const list = all();
    const t = (n, lbl, cls = '') => `<div class="stat ${cls}"><div class="stat-n">${n}</div><div class="stat-l">${lbl}</div></div>`;
    const week = list.filter(r => Date.now() - r.createdAt < 7 * 864e5);
    return t(list.length, 'Reports')
      + t(week.length, 'Sent · 7d', 'stat-brand')
      + t(week.reduce((s, r) => s + pcsOf(r), 0), 'Pieces · 7d')
      + (overseer ? t(new Set(week.map(r => r.branch)).size, 'Branches · 7d') : '');
  }

  function rowsHTML() {
    const list = visible();
    if (!list.length) return `<div class="empty">${icons.box}<p>${canSend ? 'No damaged stock reported yet.' : 'No reports match this view.'}</p></div>`;
    return list.map(r => {
      const first = r.lines.slice(0, 2).map(l => l.name);
      const more = r.lines.length - first.length;
      return `
      <div class="row" data-open="${r.id}">
        <div class="row-main">
          <div class="row-title"><b>${esc(r.ref)}</b>${overseer ? `<span class="row-cust">${locChip(r.branch)} ${esc(locName(r.branch))}</span>` : ''}</div>
          <div class="row-sub"><span class="row-sub-txt">${esc(first.join(', '))}${more > 0 ? ` +${more} more` : ''}</span></div>
        </div>
        <div class="row-units"><b>${r.lines.length}</b> line${r.lines.length === 1 ? '' : 's'} · ${pcsOf(r)} pcs</div>
        <div class="row-time" title="${fmtDT(r.createdAt)}">${relTime(r.createdAt)}</div>
        <div class="row-act" data-stop>
          <button class="btn btn-ghost btn-sm" data-print="${r.id}">${icons.printer} Print</button>
        </div>
      </div>`;
    }).join('');
  }

  function linesTable(r) {
    return `
      <table class="lines">
        <thead><tr><th>Name of glasses</th><th>Barcode</th><th class="num">Qty</th></tr></thead>
        <tbody>${r.lines.map(l => `<tr><td><b>${esc(l.name)}</b></td><td class="mono">${esc(l.barcode || '—')}</td><td class="num">${l.qty}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="2">Total</td><td class="num">${pcsOf(r)} pcs</td></tr></tfoot>
      </table>`;
  }

  function drawerHTML() {
    const r = report(drawerId);
    if (!r) return `<div class="pad">This report no longer exists.</div>`;
    return `
      <div class="dw-head">
        <div>
          <div class="dw-kicker">Damaged stock</div>
          <h2>${esc(r.ref)}</h2>
          <div class="dw-sub">${locChip(r.branch)} ${esc(locName(r.branch))} · ${esc(fmtDT(r.createdAt))}</div>
        </div>
        <button class="icon-btn" data-close>${icons.x}</button>
      </div>
      <div class="dw-body">
        ${r.note ? `<p class="muted">“${esc(r.note)}”</p>` : ''}
        ${linesTable(r)}
        <div class="dw-actions">
          <button class="btn btn-primary" data-print="${r.id}">${icons.printer} Print</button>
          ${canDelete(r) ? `<button class="btn btn-ghost btn-danger-text" data-delete="${r.id}">${icons.trash} Delete</button>` : ''}
        </div>
      </div>`;
  }

  function openDrawer(id) {
    drawerId = id;
    drawer = openLayer('drawer', drawerHTML, { onClose: () => { drawer = null; drawerId = null; } });
    drawer.el.addEventListener('click', async e => {
      if (e.target.closest('[data-close]')) return drawer.close();
      const pr = e.target.closest('[data-print]');
      if (pr) return printReport(report(pr.dataset.print));
      const dl = e.target.closest('[data-delete]');
      if (dl) {
        const r = report(dl.dataset.delete);
        if (!r || !confirm(`Delete ${r.ref}? This can’t be undone.`)) return;
        if (await store.deleteDamaged(r.id, me.code)) drawer?.close();
      }
    });
  }

  // ── the paper ──
  function printReport(r) {
    if (!r) return;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(r.ref)} — Damaged Stock</title>
      <style>
        body{font:13px system-ui,Segoe UI,Roboto,sans-serif;color:#17202b;padding:32px;}
        h1{font-size:22px;margin:0 0 2px;}
        .meta{color:#4c5a6b;margin-bottom:18px;}
        .meta b{color:#17202b;}
        table{width:100%;border-collapse:collapse;margin-top:10px;}
        th,td{text-align:left;padding:9px 10px;border-bottom:1px solid #e3e8f0;vertical-align:top;}
        th{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#8593a5;}
        .num{text-align:right;}
        .mono{font-family:Consolas,ui-monospace,monospace;}
        tfoot td{font-weight:700;border-top:2px solid #17202b;border-bottom:none;}
        .note{margin:-8px 0 14px;color:#4c5a6b;}
        .sign{display:grid;grid-template-columns:1fr 1fr;gap:60px;margin-top:70px;}
        .sign div{border-top:1px solid #17202b;padding-top:6px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#4c5a6b;}
        .foot{margin-top:26px;color:#8593a5;font-size:11px;border-top:1px solid #e3e8f0;padding-top:10px;}
        @media print{body{padding:0;}}
      </style></head><body>
      <h1>Damaged Stock — ${esc(r.ref)}</h1>
      <div class="meta"><b>${esc(locName(r.branch))}</b> (${esc(r.branch)}) · Sent ${esc(fmtDT(r.createdAt))}</div>
      ${r.note ? `<div class="note">Note: ${esc(r.note)}</div>` : ''}
      <table>
        <thead><tr><th>#</th><th>Name of glasses</th><th>Barcode</th><th class="num">Qty</th></tr></thead>
        <tbody>${r.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.name)}</td><td class="mono">${esc(l.barcode || '—')}</td><td class="num">${l.qty}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="3">Total</td><td class="num">${pcsOf(r)} pcs</td></tr></tfoot>
      </table>
      <div class="sign"><div>Branch — name &amp; signature</div><div>Received by — name &amp; signature</div></div>
      <div class="foot">${r.lines.length} line${r.lines.length === 1 ? '' : 's'} · ${pcsOf(r)} pcs · Printed ${esc(fmtDT(Date.now()))}</div>
      </body></html>`;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  }

  // ── a new report: as many lines as the branch found ──
  function composerModal() {
    const blank = () => ({ name: '', barcode: '', qty: 1 });
    const lines = [blank()];
    const lineRow = (l, i) => `
      <div class="dm-row">
        <input placeholder="e.g. Ray-Ban RB5154 black" value="${esc(l.name)}" data-f="name" data-i="${i}">
        <input placeholder="Barcode" value="${esc(l.barcode)}" data-f="barcode" data-i="${i}" class="mono" inputmode="numeric">
        <input type="number" min="1" max="999" value="${esc(l.qty)}" data-f="qty" data-i="${i}" aria-label="Quantity">
        <button class="icon-btn" data-del="${i}" ${lines.length === 1 ? 'disabled' : ''} title="Remove">${icons.x}</button>
      </div>`;
    const layer = openLayer('modal', () => `
      <div class="dw-head">
        <div><div class="dw-kicker">New damaged stock report</div><h2>What is damaged in the shop?</h2></div>
        <button class="icon-btn" data-close>${icons.x}</button>
      </div>
      <div class="form">
        <div class="dm-lines">
          <div class="dm-head"><span>Name of glasses</span><span>Barcode</span><span>Qty</span><span></span></div>
          <div id="dm-list">${lines.map(lineRow).join('')}</div>
        </div>
        <button class="btn btn-ghost btn-sm dm-add" data-add>${icons.plus} Add line</button>
        <label>Note <span class="opt">optional</span><input id="dm-note" placeholder="e.g. found in the window display"></label>
        <div class="form-foot">
          <span class="muted" id="dm-total"></span>
          <button class="btn btn-ghost" data-close>Cancel</button>
          <button class="btn btn-primary" data-send>${icons.send} Send report</button>
        </div>
      </div>`);
    const el = layer.el;
    const totals = () => {
      const pcs = lines.reduce((s, l) => s + (parseInt(l.qty, 10) || 0), 0);
      el.querySelector('#dm-total').textContent = `${lines.length} line${lines.length === 1 ? '' : 's'} · ${pcs} pcs`;
    };
    const redraw = focusLast => {
      el.querySelector('#dm-list').innerHTML = lines.map(lineRow).join('');
      totals();
      if (focusLast) el.querySelector(`[data-f="name"][data-i="${lines.length - 1}"]`)?.focus();
    };
    totals();
    el.querySelector('[data-f="name"]')?.focus();
    el.addEventListener('input', e => {
      const f = e.target.dataset.f;
      if (!f) return;
      lines[+e.target.dataset.i][f] = e.target.value;
      if (f === 'qty') totals();
    });
    // Enter on a barcode (a scanner ends with Enter) starts the next line.
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.dataset.f === 'barcode') { e.preventDefault(); lines.push(blank()); redraw(true); }
    });
    el.addEventListener('click', async e => {
      if (e.target.closest('[data-close]')) return layer.close();
      if (e.target.closest('[data-add]')) { lines.push(blank()); redraw(true); return; }
      const del = e.target.closest('[data-del]');
      if (del) { lines.splice(+del.dataset.del, 1); redraw(); return; }
      const send = e.target.closest('[data-send]');
      if (send) {
        const clean = lines.map(l => ({ name: l.name.trim(), barcode: l.barcode.trim(), qty: parseInt(l.qty, 10) || 0 }))
          .filter(l => l.name || l.barcode);
        if (!clean.length) return;
        send.disabled = true;
        const r = await store.createDamaged({ lines: clean, note: el.querySelector('#dm-note').value.trim() }, me.code);
        if (!r) { send.disabled = false; return; }
        layer.close();
        openDrawer(r.id);
      }
    });
  }

  function render() {
    root.innerHTML = `
      <header class="mod-head">
        <div>
          <h1>Damaged Stock</h1>
          <p class="mod-sub">${overseer ? 'Damaged stock the branches reported — print each one and send the paper' : 'List the damaged pieces in the shop and send them to the office'}</p>
        </div>
        ${canSend ? `<button class="btn btn-primary" data-new>${icons.plus} New damaged stock</button>` : ''}
      </header>
      <section class="stats" id="d-stats">${statsHTML()}</section>
      <section class="toolbar">
        <div class="searchbox">${icons.search}<input id="d-q" placeholder="Search report, branch, glasses, barcode…" value="${esc(ui.q)}"></div>
        ${overseer ? `<select class="sel" id="d-branch"><option value="all">All branches</option>${BRANCHES.map(b => `<option value="${b.code}" ${ui.branch === b.code ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>` : ''}
      </section>
      <section class="list" id="d-list">${rowsHTML()}</section>`;
    root.querySelector('#d-q').addEventListener('input', e => { ui.q = e.target.value; refresh(); });
    root.querySelector('#d-branch')?.addEventListener('change', e => { ui.branch = e.target.value; refresh(); });
    root.querySelector('[data-new]')?.addEventListener('click', composerModal);
    root.addEventListener('click', e => {
      const pr = e.target.closest('[data-print]');
      if (pr) { e.stopPropagation(); return printReport(report(pr.dataset.print)); }
      if (e.target.closest('[data-stop]')) return;
      const row = e.target.closest('[data-open]');
      if (row) openDrawer(row.dataset.open);
    });
  }

  function refresh() {
    const s = root.querySelector('#d-stats');
    if (!s) return;
    s.innerHTML = statsHTML();
    root.querySelector('#d-list').innerHTML = rowsHTML();
    drawer?.update();
  }

  return {
    mount(el) { root = el; render(); },
    onChange() { refresh(); },
    unmount() { closeLayer(); },
  };
}
