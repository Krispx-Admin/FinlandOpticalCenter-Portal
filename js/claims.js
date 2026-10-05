// ── Module 5: Insurance Claim Receipts — compose, preview, print ──
import {
  BRANCHES, locName, CURRENCY, money, PAYMENT_TYPES,
  RX_ROWS, RX_COLS, blankRx, normaliseRx, claimTotal,
} from './data.js';
import { store } from './store.js';
import { esc, relTime, fmtDT, icons, locChip, openLayer, closeLayer, toast } from './ui.js';

// Absolute, because the print window is an about:blank document with no base
// URL of its own to resolve a relative path against.
const asset = f => new URL(`img/${f}`, location.href).href;
const LOGO_WIDE = asset('foc-logo-horizontal.png');
const LOGO_MARK = asset('foc-logomark.png');

const fmtDay = d => {
  const t = Date.parse(`${d}T00:00:00`);
  return Number.isNaN(t) ? d : new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};
const today = () => new Date().toISOString().slice(0, 10);
// Writes a value at a dotted path, e.g. 'd.od.sph' or 'add.os'.
const setPath = (obj, path, val) => {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
  o[keys.at(-1)] = val;
};
const payLabel = p => PAYMENT_TYPES.find(x => x.value === p)?.label ?? 'Cash';

// ── The receipt sheet ──────────────────────────────────────────────────────
// One stylesheet and one markup builder serve both the on-screen preview and
// the printed page, so the preview cannot drift from what comes out.
export const RECEIPT_CSS = `
.receipt {
  --r-ink:#15213a; --r-navy:#2b3b6b; --r-red:#e4424f;
  --r-line:#d5dce7; --r-soft:#eef2f8; --r-muted:#6b7890;
  position: relative; box-sizing: border-box;
  width: 210mm; min-height: 297mm; padding: 12mm 14mm 13mm;
  background: #fff; color: var(--r-ink);
  font-family: "Segoe UI", system-ui, -apple-system, Roboto, sans-serif;
  font-size: 10pt; line-height: 1.35;
}
.receipt * { box-sizing: border-box; }

/* Faded logomark, tilted 30 degrees, sized to run off the page edges. */
.rc-mark {
  position: absolute; inset: 0; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  pointer-events: none; z-index: 0;
}
.rc-mark img { width: 190mm; height: auto; opacity: .055; transform: rotate(-30deg); }
.rc-body { position: relative; z-index: 1; display: flex; flex-direction: column; min-height: 272mm; }

.rc-head { text-align: center; padding-bottom: 3.5mm; border-bottom: 2px solid var(--r-navy); }
.rc-head img { width: 62mm; height: auto; display: block; margin: 0 auto; }
.rc-title {
  margin-top: 2.5mm; font-size: 12.5pt; font-weight: 700; letter-spacing: .12em;
  text-transform: uppercase; color: var(--r-navy);
}
.rc-title span { display: block; font-size: 7pt; letter-spacing: .16em; color: var(--r-red); margin-top: .8mm; }

.rc-meta {
  display: grid; grid-template-columns: .95fr 1.1fr .9fr .85fr 1.5fr;
  gap: 3.5mm; margin: 4.5mm 0 5mm;
}
.rc-meta > div { border-bottom: 1px solid var(--r-line); padding-bottom: 1.6mm; min-width: 0; }
.rc-meta dt { font-size: 6.8pt; letter-spacing: .09em; text-transform: uppercase; color: var(--r-muted); font-weight: 700; margin: 0; }
.rc-meta dd { margin: 1mm 0 0; font-size: 9.5pt; font-weight: 600; overflow-wrap: anywhere; }

.rc-sec {
  font-size: 7.5pt; font-weight: 700; letter-spacing: .14em; text-transform: uppercase;
  color: var(--r-navy); margin: 0 0 1.8mm; display: flex; align-items: center; gap: 3mm;
}
.rc-sec::after { content: ''; flex: 1; height: 1px; background: var(--r-line); }

table.rc-tbl { width: 100%; border-collapse: collapse; margin-bottom: 4.5mm; }
table.rc-tbl th, table.rc-tbl td { border: 1px solid var(--r-line); padding: 1.6mm 2.5mm; text-align: left; }
table.rc-tbl thead th {
  background: var(--r-soft); color: var(--r-navy); font-size: 7.5pt;
  letter-spacing: .08em; text-transform: uppercase; font-weight: 700;
}
table.rc-tbl td.num, table.rc-tbl th.num { text-align: right; white-space: nowrap; }
.rc-items tbody td { height: 6.4mm; }
.rc-items tfoot td {
  background: var(--r-soft); font-weight: 700; font-size: 10.5pt;
  color: var(--r-navy); border-top: 2px solid var(--r-navy);
}

.rc-rx th, .rc-rx td { text-align: center; padding: 1.3mm 1.2mm; }
.rc-rx tbody td { height: 6.4mm; font-family: Consolas, ui-monospace, monospace; font-size: 10pt; }
.rc-rx .rx-lbl { background: var(--r-soft); font-weight: 700; width: 10mm; font-size: 10pt; color: var(--r-navy); }
.rc-rx .rx-ipd { background: #f7f9fc; }
.rc-rx .rx-mini {
  background: var(--r-soft); font-size: 7.5pt; font-weight: 700; letter-spacing: .04em;
  color: var(--r-navy); text-transform: none;
}
.rc-rx .rx-sum td { background: #fff; }

.rc-foot { margin-top: auto; padding-top: 4mm; }
.rc-pay { display: flex; align-items: stretch; gap: 5mm; }
.rc-pay-box { flex: 1; border: 1px solid var(--r-line); border-radius: 2mm; padding: 2.8mm 3.5mm; }
.rc-ticks { display: flex; gap: 8mm; }
.rc-tick { display: flex; align-items: center; gap: 2.5mm; font-size: 10.5pt; font-weight: 600; }
.rc-tick i {
  width: 4.2mm; height: 4.2mm; border: 1.5px solid var(--r-navy); border-radius: .8mm;
  display: inline-block; position: relative; flex: none;
}
.rc-tick.on i { background: var(--r-navy); }
.rc-tick.on i::after {
  content: ''; position: absolute; left: 1.4mm; top: .5mm; width: 1.1mm; height: 2.3mm;
  border: solid #fff; border-width: 0 1.2px 1.2px 0; transform: rotate(45deg);
}
.rc-total {
  flex: 0 0 58mm; background: var(--r-navy); color: #fff; border-radius: 2mm;
  padding: 2.8mm 3.5mm; display: flex; flex-direction: column; justify-content: center;
}
.rc-total span { font-size: 8pt; letter-spacing: .14em; text-transform: uppercase; opacity: .78; }
.rc-total b { font-size: 15pt; margin-top: .6mm; }
.rc-total b em { font-style: normal; font-size: 10pt; opacity: .8; margin-left: 1.5mm; }

.rc-sign { display: grid; grid-template-columns: 1fr 1fr; gap: 16mm; margin-top: 9mm; }
.rc-sign div {
  border-top: 1px solid var(--r-ink); padding-top: 1.6mm; font-size: 8pt;
  letter-spacing: .08em; text-transform: uppercase; color: var(--r-muted); font-weight: 600;
}
.rc-note {
  margin-top: 5mm; padding-top: 2.5mm; border-top: 1px solid var(--r-line);
  font-size: 7pt; color: var(--r-muted); display: flex; justify-content: space-between; gap: 6mm;
}

/* When a long product list does run past one page, break it sensibly:
   repeat the table header and never split a row or the footer block. */
table.rc-tbl thead { display: table-header-group; }
table.rc-tbl tr, .rc-rx, .rc-foot, .rc-pay, .rc-sign { break-inside: avoid; }
`;

// Distance / Near rows, OD and OS on either side of a shared IPD column, with
// Add and S.H. labelled in-line along the bottom row.
function rxTableHTML(rx) {
  const cells = (row, side) => RX_COLS.map(col => `<td>${esc(rx[row][side][col.key] ?? '')}</td>`).join('');
  const heads = () => RX_COLS.map(c => `<th>${esc(c.label)}</th>`).join('');
  return `
    <table class="rc-tbl rc-rx">
      <thead>
        <tr>
          <th class="rx-lbl" rowspan="2"></th>
          <th colspan="4">OD</th>
          <th class="rx-ipd"></th>
          <th colspan="4">OS</th>
        </tr>
        <tr>${heads()}<th class="rx-ipd">IPD</th>${heads()}</tr>
      </thead>
      <tbody>
        ${RX_ROWS.map(r => `
          <tr>
            <th class="rx-lbl" title="${esc(r.title)}">${esc(r.label)}</th>
            ${cells(r.key, 'od')}
            <td class="rx-ipd">${esc(rx[r.key].ipd ?? '')}</td>
            ${cells(r.key, 'os')}
          </tr>`).join('')}
        <tr class="rx-sum">
          <th class="rx-lbl"></th>
          <th class="rx-mini">Add</th><td>${esc(rx.add.od)}</td>
          <th class="rx-mini">S.H.</th><td>${esc(rx.sh.od)}</td>
          <td class="rx-ipd"></td>
          <th class="rx-mini">Add</th><td>${esc(rx.add.os)}</td>
          <th class="rx-mini">S.H.</th><td>${esc(rx.sh.os)}</td>
        </tr>
      </tbody>
    </table>`;
}

export function receiptHTML(c) {
  const items = (c.items ?? []).length ? c.items : [{ name: '', price: null }];
  const total = claimTotal(c);
  return `
<div class="receipt">
  <div class="rc-mark"><img src="${LOGO_MARK}" alt=""></div>
  <div class="rc-body">
    <header class="rc-head">
      <img src="${LOGO_WIDE}" alt="Finland Optical Center">
      <div class="rc-title">Insurance Claim Receipt<span>&#1573;&#1610;&#1589;&#1575;&#1604; &#1605;&#1591;&#1575;&#1604;&#1576;&#1577; &#1578;&#1571;&#1605;&#1610;&#1606;</span></div>
    </header>

    <dl class="rc-meta">
      <div><dt>Date</dt><dd>${esc(fmtDay(c.date))}</dd></div>
      <div><dt>Branch</dt><dd>${esc(locName(c.branch))}</dd></div>
      <div><dt>Bill Number</dt><dd>${esc(c.billNo || '—')}</dd></div>
      <div><dt>Receipt No.</dt><dd>${esc(c.ref)}</dd></div>
      <div><dt>Customer Name</dt><dd>${esc(c.customer || '—')}</dd></div>
    </dl>

    <h3 class="rc-sec">Products</h3>
    <table class="rc-tbl rc-items">
      <thead><tr><th>Description</th><th class="num" style="width:40mm">Amount (${CURRENCY})</th></tr></thead>
      <tbody>
        ${items.map(i => `<tr><td>${esc(i.name || '')}</td><td class="num">${!i.name && i.price == null ? '' : money(i.price)}</td></tr>`).join('')}
      </tbody>
      <tfoot><tr><td>Total</td><td class="num">${money(total)}</td></tr></tfoot>
    </table>

    <h3 class="rc-sec">Prescription</h3>
    ${rxTableHTML(normaliseRx(c.rx))}

    <div class="rc-foot">
      <div class="rc-pay">
        <div class="rc-pay-box">
          <h3 class="rc-sec">Payment Method</h3>
          <div class="rc-ticks">
            ${PAYMENT_TYPES.map(p => `<span class="rc-tick ${c.payment === p.value ? 'on' : ''}"><i></i>${esc(p.label)}</span>`).join('')}
          </div>
        </div>
        <div class="rc-total"><span>Total Amount</span><b>${money(total)}<em>${CURRENCY}</em></b></div>
      </div>

      <div class="rc-sign">
        <div>Optician — Name &amp; Signature</div>
        <div>Customer Signature</div>
      </div>

      <div class="rc-note">
        <span>Finland Optical Center · ${esc(locName(c.branch))}</span>
        <span>Issued for insurance claim purposes.</span>
      </div>
    </div>
  </div>
</div>`;
}

function receiptDoc(c) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${esc(c.ref)} — Insurance Claim Receipt</title>
<style>
  html, body { margin: 0; padding: 0; background: #e9edf3; }
  .receipt { margin: 0 auto; box-shadow: 0 2px 18px rgba(0,0,0,.14); }
  ${RECEIPT_CSS}
  @page { size: A4; margin: 12mm 14mm 13mm; }
  @media print {
    html, body { background: #fff; }
    /* The page box owns the margins now, so page two gets them too. */
    .receipt { box-shadow: none; margin: 0; width: auto; min-height: 0; padding: 0; }
    .rc-body { min-height: 268mm; }
    .rc-mark { position: fixed; }
    /* Without this the faded mark and the filled bars are dropped by default. */
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  }
</style></head><body>${receiptHTML(c)}</body></html>`;
}

// Printing before the logos decode yields a sheet with a blank header, so wait
// for them — behind a timeout, so a missing file can never wedge the dialog.
function printWhenReady(w) {
  let fired = false;
  const go = () => {
    if (fired) return;
    fired = true;
    try { w.focus(); w.print(); } catch { /* window already closed */ }
  };
  const imgs = [...w.document.images];
  let pending = imgs.filter(i => !i.complete).length;
  if (!pending) return setTimeout(go, 80);
  const tick = () => { if (--pending <= 0) setTimeout(go, 80); };
  imgs.forEach(i => {
    if (i.complete) return;
    i.addEventListener('load', tick);
    i.addEventListener('error', tick);
  });
  setTimeout(go, 3000);
}

export function printClaim(c) {
  if (!c) return;
  const w = window.open('', '_blank');
  if (!w) return toast({ title: 'Pop-up blocked', sub: 'Allow pop-ups for this site to print.', tone: 'stock' });
  w.document.write(receiptDoc(c));
  w.document.close();
  printWhenReady(w);
}

// ── Module view ────────────────────────────────────────────────────────────
export function claimsView(me) {
  const isAdmin = me.role === 'admin';
  const ui = { q: '', branch: 'all' };
  let root, layer = null;

  function visible() {
    let list = store.claimsFor(me.code);
    if (isAdmin && ui.branch !== 'all') list = list.filter(c => c.branch === ui.branch);
    if (ui.q) {
      const q = ui.q.toLowerCase();
      list = list.filter(c => [c.ref, c.customer, c.billNo, c.branch, locName(c.branch), ...(c.items ?? []).map(i => i.name)]
        .some(v => String(v ?? '').toLowerCase().includes(q)));
    }
    return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function statsHTML() {
    const all = store.claimsFor(me.code);
    const month = all.filter(c => Date.now() - c.createdAt < 30 * 864e5);
    const sum = l => money(l.reduce((t, c) => t + claimTotal(c), 0));
    const t = (n, lbl, cls = '') => `<div class="stat ${cls}"><div class="stat-n">${n}</div><div class="stat-l">${lbl}</div></div>`;
    return t(all.length, 'Claim receipts')
      + t(month.length, 'Raised · 30d', 'stat-brand')
      + t(sum(month), `Claimed · 30d (${CURRENCY})`, 'stat-brand')
      + t(all.filter(c => c.payment === 'card').length, 'Paid by card');
  }

  function rowsHTML() {
    const list = visible();
    if (!list.length) return `<div class="empty">${icons.receipt}<p>No claim receipts yet — create one to print.</p></div>`;
    return list.map(c => {
      const n = (c.items ?? []).length;
      return `
      <div class="row" data-open="${c.id}">
        <div class="row-main">
          <div class="row-title"><b>${esc(c.ref)}</b>
            <span class="row-cust">${esc(c.customer || '—')}</span>
            ${isAdmin ? locChip(c.branch) : ''}
          </div>
          <div class="row-sub"><span class="row-sub-txt">${esc(fmtDay(c.date))} · Bill ${esc(c.billNo || '—')} · ${n} item${n === 1 ? '' : 's'}</span></div>
        </div>
        <div class="row-units"><b>${money(claimTotal(c))}</b> ${CURRENCY}</div>
        <div class="row-status"><span class="pill ${c.payment === 'card' ? 's-blue' : 's-green'}"><i class="dot"></i>${esc(payLabel(c.payment))}</span></div>
        <div class="row-time" title="${fmtDT(c.updatedAt)}">${relTime(c.updatedAt)}</div>
        <div class="row-act" data-stop>
          <button class="btn btn-ghost btn-sm" data-print="${c.id}">${icons.printer} Print</button>
        </div>
      </div>`;
    }).join('');
  }

  // ── preview ──
  function openPreview(id) {
    const c = store.claim(id);
    if (!c) return;
    layer = openLayer('modal', () => {
      const cur = store.claim(id);
      if (!cur) return `<div class="pad">This receipt no longer exists.</div>`;
      return `
      <div class="dw-head">
        <div><div class="dw-kicker">Claim receipt</div><h2>${esc(cur.ref)} · ${esc(cur.customer || '—')}</h2></div>
        <button class="icon-btn" data-close>${icons.x}</button>
      </div>
      <div class="rc-stage"><div class="rc-scale">${receiptHTML(cur)}</div></div>
      <div class="modal-foot rc-actions">
        <button class="btn btn-primary" data-do-print>${icons.printer} Print receipt</button>
        <button class="btn btn-ghost" data-edit>${icons.wrench} Edit</button>
        <button class="btn btn-ghost btn-danger-text" data-del>${icons.trash} Delete</button>
        <button class="btn btn-ghost" data-close>Close</button>
      </div>`;
    }, { onClose: () => { layer = null; } });
    layer.el.classList.add('modal-sheet');
    fitSheet(layer.el);
    layer.el.querySelectorAll('.receipt img').forEach(img => {
      if (!img.complete) img.addEventListener('load', () => fitSheet(layer.el), { once: true });
    });
    layer.el.addEventListener('click', e => {
      if (e.target.closest('[data-close]')) return layer.close();
      if (e.target.closest('[data-do-print]')) return printClaim(store.claim(id));
      if (e.target.closest('[data-edit]')) { layer.close(); return composer(store.claim(id)); }
      if (e.target.closest('[data-del]')) {
        const cur = store.claim(id);
        if (!cur || !confirm(`Delete claim receipt ${cur.ref}? This cannot be undone.`)) return;
        store.removeClaim(id, me.code);
        layer.close();
      }
    });
  }

  // The sheet is a fixed 210mm wide, so scale it down to whatever room the
  // modal actually has rather than letting it overflow.
  function fitSheet(el) {
    const stage = el.querySelector('.rc-stage');
    const scale = el.querySelector('.rc-scale');
    const sheet = scale?.querySelector('.receipt');
    if (!stage || !sheet) return;
    const s = Math.min(1, (stage.clientWidth - 2) / sheet.offsetWidth);
    scale.style.transform = `scale(${s})`;
    scale.style.height = `${sheet.offsetHeight * s}px`;
  }

  // ── composer ──
  function composer(existing) {
    const draft = existing
      ? {
        date: existing.date, branch: existing.branch, billNo: existing.billNo,
        customer: existing.customer, payment: existing.payment,
        items: existing.items.map(i => ({ ...i })),
        rx: JSON.parse(JSON.stringify(normaliseRx(existing.rx))),
      }
      : {
        date: today(), branch: isAdmin ? BRANCHES[0].code : me.code, billNo: '', customer: '',
        payment: 'cash', items: [{ name: '', price: '' }], rx: blankRx(),
      };

    const total = () => draft.items.reduce((t, i) => t + (Number(i.price) || 0), 0);

    const itemRow = (it, i) => `
      <div class="ci-row">
        <input placeholder="e.g. Ray-Ban RB5154 frame" value="${esc(it.name)}" data-it="name" data-i="${i}">
        <input type="number" min="0" step="0.001" placeholder="0.000" value="${esc(it.price ?? '')}" data-it="price" data-i="${i}">
        <button class="icon-btn" data-rm="${i}" ${draft.items.length === 1 ? 'disabled' : ''} title="Remove">${icons.x}</button>
      </div>`;

    layer = openLayer('modal', () => `
      <div class="dw-head">
        <div><div class="dw-kicker">${existing ? 'Edit claim' : 'New claim'}</div><h2>Insurance claim receipt</h2></div>
        <button class="icon-btn" data-close>${icons.x}</button>
      </div>
      <div class="form">
        <div class="grid2">
          <label>Date<input type="date" id="f-date" value="${esc(draft.date)}"></label>
          <label>Branch
            <select id="f-branch">
              ${BRANCHES.map(b => `<option value="${b.code}" ${draft.branch === b.code ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}
            </select>
          </label>
        </div>
        <div class="grid2">
          <label>Bill number<input id="f-bill" placeholder="e.g. B-58214" value="${esc(draft.billNo)}"></label>
          <label>Customer name<input id="f-cust" placeholder="Full name" value="${esc(draft.customer)}"></label>
        </div>

        <div class="fieldset">
          <div class="fs-head"><span>Products</span><span class="muted sm">Price in ${CURRENCY}</span></div>
          <div class="ci-head"><span>Description</span><span>Price</span><span></span></div>
          <div id="ci-list">${draft.items.map(itemRow).join('')}</div>
          <button class="btn btn-ghost btn-sm" data-add>${icons.plus} Add product</button>
        </div>

        <div class="fieldset">
          <div class="fs-head"><span>Prescription</span><span class="muted sm">Leave blank if not applicable</span></div>
          <div class="rx-wrap">
            <table class="rx-edit">
              <thead>
                <tr>
                  <th rowspan="2"></th>
                  <th colspan="4">OD</th>
                  <th class="rx-ipd"></th>
                  <th colspan="4">OS</th>
                </tr>
                <tr>
                  ${RX_COLS.map(c => `<th>${esc(c.label)}</th>`).join('')}
                  <th class="rx-ipd">IPD</th>
                  ${RX_COLS.map(c => `<th>${esc(c.label)}</th>`).join('')}
                </tr>
              </thead>
              <tbody>
                ${RX_ROWS.map(r => `
                  <tr>
                    <th title="${esc(r.title)}">${esc(r.label)}</th>
                    ${RX_COLS.map(c => `<td><input value="${esc(draft.rx[r.key].od[c.key] ?? '')}" data-rx="${r.key}.od.${c.key}"></td>`).join('')}
                    <td class="rx-ipd"><input value="${esc(draft.rx[r.key].ipd ?? '')}" data-rx="${r.key}.ipd"></td>
                    ${RX_COLS.map(c => `<td><input value="${esc(draft.rx[r.key].os[c.key] ?? '')}" data-rx="${r.key}.os.${c.key}"></td>`).join('')}
                  </tr>`).join('')}
                <tr class="rx-sum">
                  <th></th>
                  <th class="rx-mini">Add</th><td><input value="${esc(draft.rx.add.od)}" data-rx="add.od"></td>
                  <th class="rx-mini">S.H.</th><td><input value="${esc(draft.rx.sh.od)}" data-rx="sh.od"></td>
                  <td class="rx-ipd"></td>
                  <th class="rx-mini">Add</th><td><input value="${esc(draft.rx.add.os)}" data-rx="add.os"></td>
                  <th class="rx-mini">S.H.</th><td><input value="${esc(draft.rx.sh.os)}" data-rx="sh.os"></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="grid2">
          <label>Payment type
            <select id="f-pay">
              ${PAYMENT_TYPES.map(p => `<option value="${p.value}" ${draft.payment === p.value ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}
            </select>
          </label>
          <div class="total-chip"><span>Total</span><b id="f-total">${money(total())} ${CURRENCY}</b></div>
        </div>

        <div class="form-foot">
          <button class="btn btn-ghost" data-close>Cancel</button>
          <button class="btn btn-primary" data-save>${icons.check} ${existing ? 'Save changes' : 'Create receipt'}</button>
        </div>
      </div>`, { onClose: () => { layer = null; } });

    const el = layer.el;
    const sync = () => {
      draft.date = el.querySelector('#f-date').value;
      draft.branch = el.querySelector('#f-branch').value;
      draft.billNo = el.querySelector('#f-bill').value;
      draft.customer = el.querySelector('#f-cust').value;
      draft.payment = el.querySelector('#f-pay').value;
    };
    const showTotal = () => { el.querySelector('#f-total').textContent = `${money(total())} ${CURRENCY}`; };
    const redrawItems = () => {
      el.querySelector('#ci-list').innerHTML = draft.items.map(itemRow).join('');
      showTotal();
    };

    el.addEventListener('input', e => {
      const t = e.target;
      if (t.dataset.it) {
        draft.items[+t.dataset.i][t.dataset.it] = t.value;
        if (t.dataset.it === 'price') showTotal();
        return;
      }
      if (t.dataset.rx) { setPath(draft.rx, t.dataset.rx, t.value); return; }
      sync();
    });
    el.addEventListener('change', sync);
    el.addEventListener('click', e => {
      if (e.target.closest('[data-close]')) return layer.close();
      if (e.target.closest('[data-add]')) { sync(); draft.items.push({ name: '', price: '' }); redrawItems(); return; }
      const rm = e.target.closest('[data-rm]');
      if (rm) { sync(); draft.items.splice(+rm.dataset.rm, 1); redrawItems(); return; }
      if (e.target.closest('[data-save]')) {
        sync();
        const items = draft.items.filter(i => (i.name || '').trim() || Number(i.price));
        if (!draft.customer.trim()) return toast({ title: 'Customer name is required', tone: 'stock' });
        if (!items.length) return toast({ title: 'Add at least one product', tone: 'stock' });
        const fields = { ...draft, customer: draft.customer.trim(), items: items.map(i => ({ ...i, name: (i.name || '').trim() })) };
        const saved = existing ? store.updateClaim(existing.id, fields, me.code) : store.createClaim(fields, me.code);
        layer.close();
        if (saved) openPreview(saved.id);
      }
    });
  }

  // ── render ──
  function render() {
    root.innerHTML = `
      <style>${RECEIPT_CSS}</style>
      <header class="mod-head">
        <div>
          <h1>Insurance Claim Receipts</h1>
          <p class="mod-sub">Raise a printable claim receipt with products, prescription and payment</p>
        </div>
        <button class="btn btn-primary" data-new>${icons.plus} New claim receipt</button>
      </header>
      <section class="stats" id="c-stats">${statsHTML()}</section>
      <section class="toolbar">
        <div class="searchbox">${icons.search}<input id="c-q" placeholder="Search receipt, customer, bill…" value="${esc(ui.q)}"></div>
        ${isAdmin ? `<select class="sel" id="c-branch"><option value="all">All branches</option>${
          BRANCHES.map(b => `<option value="${b.code}" ${ui.branch === b.code ? 'selected' : ''}>${esc(b.name)}</option>`).join('')
        }</select>` : ''}
      </section>
      <section class="list" id="c-list">${rowsHTML()}</section>`;
    wireBody();
  }

  function refresh() {
    const a = document.activeElement;
    const keep = a?.id === 'c-q' ? a.selectionStart : null;
    const s = root.querySelector('#c-stats');
    const l = root.querySelector('#c-list');
    if (s) s.innerHTML = statsHTML();
    if (l) l.innerHTML = rowsHTML();
    if (keep != null) {
      const f = root.querySelector('#c-q');
      if (f) { f.focus(); f.setSelectionRange(keep, keep); }
    }
    // The toolbar is not re-rendered here, so its listeners still stand.
  }

  function wireBody() {
    root.querySelector('#c-q')?.addEventListener('input', e => { ui.q = e.target.value; refresh(); });
    root.querySelector('#c-branch')?.addEventListener('change', e => { ui.branch = e.target.value; refresh(); });
  }

  // Delegated once at mount, so re-rendering the list never stacks handlers.
  function wireRoot() {
    root.addEventListener('click', e => {
      if (e.target.closest('[data-new]')) return composer(null);
      const pr = e.target.closest('[data-print]');
      if (pr) { e.stopPropagation(); return printClaim(store.claim(pr.dataset.print)); }
      if (e.target.closest('[data-stop]')) return;
      const row = e.target.closest('[data-open]');
      if (row) openPreview(row.dataset.open);
    });
  }

  return {
    mount(container) { root = container; wireRoot(); render(); },
    // A claim only changes when someone edits one; ignore the network's chatter
    // so an open composer is never redrawn from under the user.
    onChange(event) { if (event?.module === 'claims' || event?.module === 'system') refresh(); },
    unmount() { closeLayer(); },
  };
}
