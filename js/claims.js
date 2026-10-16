// ── Module 5: Reimbursement Invoice (was Insurance Claims) — compose, preview, print ──
import {
  BRANCHES, locName, CURRENCY, money, PAYMENT_TYPES,
  RX_ROWS, RX_COLS, blankRx, normaliseRx, claimTotal, seesAll, readOnly, ITEM_KINDS, itemQty, itemAmount, itemCounts, canExportInsurance,
} from './data.js';
import { store } from './store.js';
import { supabase } from './auth.js';
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

// ── The invoice sheet ──────────────────────────────────────────────────────
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
/* The company's registration and address: English on the left of the logo,
   Arabic on the right, each reading from its own edge of the page. */
.rc-head-row { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 5mm; }
.rc-head img { width: 56mm; height: auto; display: block; margin: 0 auto; }
.rc-co { font-size: 7.6pt; line-height: 1.5; color: var(--r-navy); font-weight: 600; }
.rc-co span { display: block; }
.rc-co-en { text-align: left; }
.rc-co-ar { text-align: right; direction: rtl; font-size: 8pt; }
.rc-title {
  margin-top: 2.5mm; font-size: 12.5pt; font-weight: 700; letter-spacing: .12em;
  text-transform: uppercase; color: var(--r-navy);
}
.rc-title span { display: block; font-size: 7pt; letter-spacing: .16em; color: var(--r-red); margin-top: .8mm; }

.rc-meta {
  display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 3.5mm; margin: 4.5mm 0 5mm;
}
.rc-meta > div { border-bottom: 1px solid var(--r-line); padding-bottom: 1.6mm; min-width: 0; }
.rc-meta dt { font-size: 6.8pt; letter-spacing: .09em; text-transform: uppercase; color: var(--r-muted); font-weight: 700; margin: 0;
  display: flex; justify-content: space-between; align-items: baseline; gap: 2mm; }
/* each label in English and, from the other edge, in Arabic */
.rc-ar { font-size: 8pt; letter-spacing: 0; text-transform: none; direction: rtl; font-weight: 600; }
.rc-meta dd { margin: 1mm 0 0; font-size: 9.5pt; font-weight: 600; overflow-wrap: anywhere; }
.rc-meta .rc-wide { grid-column: span 2; }

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

/* Fixed layout and a colgroup so the eight power columns are equal on paper
   too — a printed SPH that runs out of its box is worse than one on screen. */
.rc-rx { table-layout: fixed; }
.rc-rx th, .rc-rx td { text-align: center; padding: 1.3mm 1.2mm; }
.rc-rx tbody td { height: 6.4mm; font-family: Consolas, ui-monospace, monospace; font-size: 10pt; }
.rc-rx col.rx-lbl-col { width: 11mm; }
.rc-rx .rx-lbl { background: var(--r-soft); font-weight: 700; font-size: 9.5pt; color: var(--r-navy); }
.rc-rx .rx-sum td {
  background: #fff; font-family: Consolas, ui-monospace, monospace; font-size: 10pt;
}

.rc-foot { margin-top: auto; padding-top: 4mm; }
.rc-pay { display: flex; align-items: stretch; gap: 5mm; }
.rc-pay-total { justify-content: flex-end; }
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
  display: flex; justify-content: space-between; align-items: baseline; gap: 3mm;
}
.rc-sign .rc-ar { font-size: 9pt; }
.rc-sign span { white-space: nowrap; }
.rc-sign div > span:first-child { letter-spacing: .04em; }
.rc-items .rc-kind { width: 22mm; font-weight: 600; color: var(--r-navy); }
.rc-items .rc-qty { width: 14mm; text-align: center; }
.rc-items tfoot .rc-counts { font-size: 8pt; font-weight: 600; color: var(--r-muted); margin-left: 3mm; letter-spacing: 0; }
.rc-note {
  margin-top: 5mm; padding-top: 2.5mm; border-top: 1px solid var(--r-line);
  font-size: 7pt; color: var(--r-muted); display: flex; justify-content: space-between; gap: 6mm;
}

/* When a long product list does run past one page, break it sensibly:
   repeat the table header and never split a row or the footer block. */
table.rc-tbl thead { display: table-header-group; }
table.rc-tbl tr, .rc-rx, .rc-foot, .rc-pay, .rc-sign { break-inside: avoid; }
`;

// Distance / Near rows, OD and OS each with SPH · CYL · AXIS · V.A., and one
// Add per eye along the bottom. Nine even columns: the colgroup gives every
// power the same room, so SPH cannot be squeezed by a wordier neighbour.
function rxTableHTML(rx) {
  const cells = (row, side) => RX_COLS.map(col => `<td>${esc(rx[row][side][col.key] ?? '')}</td>`).join('');
  const heads = () => RX_COLS.map(c => `<th>${esc(c.label)}</th>`).join('');
  return `
    <table class="rc-tbl rc-rx">
      <colgroup><col class="rx-lbl-col"><col span="8"></colgroup>
      <thead>
        <tr>
          <th class="rx-lbl" rowspan="2"></th>
          <th colspan="4">OD</th>
          <th colspan="4">OS</th>
        </tr>
        <tr>${heads()}${heads()}</tr>
      </thead>
      <tbody>
        ${RX_ROWS.map(r => `
          <tr>
            <th class="rx-lbl" title="${esc(r.title)}">${esc(r.label)}</th>
            ${cells(r.key, 'od')}
            ${cells(r.key, 'os')}
          </tr>`).join('')}
        <tr class="rx-sum">
          <th class="rx-lbl">Add</th>
          <td colspan="4">${esc(rx.add.od)}</td>
          <td colspan="4">${esc(rx.add.os)}</td>
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
      <div class="rc-head-row">
        <div class="rc-co rc-co-en">
          <span>CR. 1032797</span>
          <span>P.O. Box: 3742</span>
          <span>Postal Code 112, Muscat</span>
          <span>Sultanate of Oman</span>
        </div>
        <img src="${LOGO_WIDE}" alt="Finland Optical Center">
        <div class="rc-co rc-co-ar" lang="ar">
          <span>س.ت: 1032797</span>
          <span>ص.ب: 3742</span>
          <span>الرمز البريدي: 112، مسقط</span>
          <span>سلطنة عُمان</span>
        </div>
      </div>
      <div class="rc-title">Invoice<span lang="ar">فاتورة</span></div>
    </header>

    <dl class="rc-meta">
      <div><dt>Date<span class="rc-ar" lang="ar">التاريخ</span></dt><dd>${esc(fmtDay(c.date))}</dd></div>
      <div><dt>Branch<span class="rc-ar" lang="ar">الفرع</span></dt><dd>${esc(locName(c.branch))}</dd></div>
      <div><dt>Bill Number<span class="rc-ar" lang="ar">رقم الإيصال</span></dt><dd>${esc(c.billNo || '—')}</dd></div>
      <div><dt>Invoice No.<span class="rc-ar" lang="ar">رقم الفاتورة</span></dt><dd>${esc(c.ref)}</dd></div>
      <div class="rc-wide"><dt>Customer Name<span class="rc-ar" lang="ar">اسم العميل</span></dt><dd>${esc(c.customer || '—')}</dd></div>
      <div class="rc-wide"><dt>Member ID<span class="rc-ar" lang="ar">رقم العضوية</span></dt><dd>${esc(c.memberId || '—')}</dd></div>
    </dl>

    <h3 class="rc-sec">Products</h3>
    <table class="rc-tbl rc-items">
      <thead><tr><th class="rc-kind">Item</th><th>Description</th><th class="rc-qty">Qty</th><th class="num" style="width:40mm">Amount (${CURRENCY})</th></tr></thead>
      <tbody>
        ${items.map(i => { const blank = !i.name && i.price == null; return `<tr><td class="rc-kind">${esc(ITEM_KINDS[i.kind]?.label ?? '')}</td><td>${esc(i.name || '')}</td>`
          + `<td class="rc-qty">${blank ? '' : itemQty(i)}</td><td class="num">${blank ? '' : money(itemAmount(i))}</td></tr>`; }).join('')}
      </tbody>
      <tfoot><tr><td colspan="3">Total${itemCounts(items) ? `<span class="rc-counts">${esc(itemCounts(items))}</span>` : ''}</td><td class="num">${money(total)}</td></tr></tfoot>
    </table>

    <h3 class="rc-sec">Prescription</h3>
    ${rxTableHTML(normaliseRx(c.rx))}

    <div class="rc-foot">
      <div class="rc-pay ${c.kind === 'direct' ? 'rc-pay-total' : ''}">
        ${c.kind === 'direct' ? '' : `<div class="rc-pay-box">
          <h3 class="rc-sec">Payment Method</h3>
          <div class="rc-ticks">
            ${PAYMENT_TYPES.map(p => `<span class="rc-tick ${c.payment === p.value ? 'on' : ''}"><i></i>${esc(p.label)}</span>`).join('')}
          </div>
        </div>`}
        <div class="rc-total"><span>Total Amount</span><b>${money(total)}<em>${CURRENCY}</em></b></div>
      </div>

      <div class="rc-sign">
        <div><span>Optician — Name &amp; Signature</span><span class="rc-ar" lang="ar">اسم وتوقيع أخصائي البصريات</span></div>
        <div><span>Customer Signature</span><span class="rc-ar" lang="ar">توقيع العميل</span></div>
      </div>

      <div class="rc-note">
        <span>Finland Optical Center · ${esc(locName(c.branch))}</span>
      </div>
    </div>
  </div>
</div>`;
}

function receiptDoc(c) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${esc(c.ref)} — Invoice</title>
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
// Two tabs share this one view. Insurance Claims (kind 'claim') raise an
// invoice. Direct Insurance (kind 'direct') is the same record for a customer
// whose insurer pays the branch directly, plus which insurer and which
// salesperson — and the office and Ghiath get a dashboard of what was paid.
const KINDS = {
  claim: {
    title: 'Reimbursement Invoice', sub: 'Raise a printable invoice with products, prescription and payment',
    add: 'New invoice', kicker: 'reimbursement invoice', heading: 'Reimbursement invoice',
    empty: 'No claims yet — create one to print its invoice.',
  },
  direct: {
    title: 'Direct Insurance', sub: 'Every insurance customer — the insurer, the salesperson, what was sold',
    add: 'New insurance customer', kicker: 'insurance customer', heading: 'Direct insurance',
    empty: 'No insurance customers yet — add the first one.',
  },
};

// The schedule's roster, as the salesperson list. The last copy shows at
// once; a fresh one is fetched every time the form opens, so an employee
// added in Settings appears without reloading the page.
let staffCache = null;
async function staffList() {
  const { data, error } = await supabase.rpc('staff_list');
  if (error) throw new Error(error.message);
  staffCache = data ?? [];
  return staffCache;
}

// Dates on a claim are local calendar days, so the periods are too.
const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const PERIODS = [
  { key: 'today', label: 'Today', days: 1 },
  { key: '7d', label: 'Last 7 days', days: 7 },
  { key: '30d', label: 'Last 30 days', days: 30 },
];
function periodRange(key) {
  const days = PERIODS.find(p => p.key === key)?.days ?? 30;
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (days - 1));
  return { from: isoDay(from), to: isoDay(to) };
}

export function claimsView(me, kind = 'claim') {
  // The office and the schedule editor see every branch's records; the
  // schedule editor may open and print them but not raise, edit or delete.
  const isAdmin = seesAll(me.role);
  const viewOnly = readOnly(me.role);
  const direct = kind === 'direct';
  const T = KINDS[kind];
  const ui = { q: '', branch: 'all', insurer: 'all', period: '30d' };
  let root, layer = null;

  const mine = () => store.claimsFor(me.code).filter(c => (c.kind || 'claim') === kind);

  function visible() {
    let list = mine();
    if (isAdmin && ui.branch !== 'all') list = list.filter(c => c.branch === ui.branch);
    if (direct && ui.insurer !== 'all') list = list.filter(c => c.insurer === ui.insurer);
    if (ui.q) {
      const q = ui.q.toLowerCase();
      list = list.filter(c => [c.ref, c.customer, c.billNo, c.memberId, c.insurer, c.employeeName, c.branch, locName(c.branch), ...(c.items ?? []).map(i => i.name)]
        .some(v => String(v ?? '').toLowerCase().includes(q)));
    }
    return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  // The insurers the office has set up, and any still on older records.
  function insurerChoices() {
    const set = new Set(store.settings.insurers ?? []);
    for (const c of mine()) if (c.insurer) set.add(c.insurer);
    return [...set];
  }

  // ── the dashboard: what the insurers paid (office and Ghiath) ──
  // One headline and three ranked lists — by insurer, branch and salesperson —
  // each a single-hue bar against a quiet track, its amount and count written
  // beside it, the detail on hover.
  function dashHTML() {
    const { from, to } = periodRange(ui.period);
    const list = mine().filter(c => c.date >= from && c.date <= to);
    const total = list.reduce((t, c) => t + claimTotal(c), 0);
    const group = (keyOf, nameOf, seed = []) => {
      const m = new Map(seed.map(k => [k, { name: nameOf(k), amount: 0, n: 0 }]));
      for (const c of list) {
        const k = keyOf(c) || '—';
        if (!m.has(k)) m.set(k, { name: nameOf(k), amount: 0, n: 0 });
        const g = m.get(k);
        g.amount += claimTotal(c);
        g.n += 1;
      }
      return [...m.values()].sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
    };
    const bars = (title, icon, rows) => {
      const max = Math.max(...rows.map(r => r.amount), 0);
      return `
        <div class="dash-card">
          <h3>${icon} ${esc(title)}</h3>
          ${rows.length ? rows.map(r => {
            const share = total ? Math.round((r.amount / total) * 100) : 0;
            return `
            <div class="bl-row" title="${esc(r.name)} — ${money(r.amount)} ${CURRENCY} · ${r.n} customer${r.n === 1 ? '' : 's'} · ${share}% of the total">
              <span class="bl-name">${esc(r.name)}</span>
              <span class="bl-track"><i style="width:${max ? Math.max((r.amount / max) * 100, r.amount ? 2 : 0) : 0}%"></i></span>
              <span class="bl-val">${money(r.amount)}</span>
              <span class="bl-n">${r.n}</span>
            </div>`;
          }).join('') : `<p class="muted sm">Nothing in this period.</p>`}
        </div>`;
    };
    const t = (n, lbl, cls = '') => `<div class="stat ${cls}"><div class="stat-n">${n}</div><div class="stat-l">${lbl}</div></div>`;
    return `
      <section class="chips status-chips dash-periods">${PERIODS.map(p =>
        `<button class="chip ${ui.period === p.key ? 'on' : ''}" data-period="${p.key}">${esc(p.label)}</button>`).join('')}</section>
      <section class="stats">
        ${t(`${money(total)} <small>${CURRENCY}</small>`, 'Paid by insurance', 'stat-brand')}
        ${t(list.length, list.length === 1 ? 'Insurance customer' : 'Insurance customers')}
        ${t(`${money(list.length ? total / list.length : 0)} <small>${CURRENCY}</small>`, 'Average per customer')}
      </section>
      <section class="dash-cards">
        ${bars('By insurer', icons.receipt, group(c => c.insurer, k => k, store.settings.insurers ?? []))}
        ${bars('By branch', icons.store, group(c => c.branch, k => (k === '—' ? '—' : `${k} · ${locName(k)}`)))}
        ${bars('By employee', icons.glasses, group(c => c.employeeName, k => k))}
      </section>`;
  }

  // Direct insurance reads as a table — number and date, customer, member ID,
  // insurer, bill, salesperson, amount — and each line opens its details on
  // the right, where printing lives.
  function directRowsHTML(list) {
    return `
      <div class="dl-head"><span>Number</span><span>Bill</span><span>Customer name</span><span>Member ID</span><span>Insurer</span><span>Salesperson</span><span class="num">Amount</span><span></span></div>
      ${list.map(c => `
      <div class="row dl-row" data-open="${c.id}">
        <div class="dl-ref"><b>${esc(c.ref)}</b><span>${esc(fmtDay(c.date))}${isAdmin ? ` · ${esc(c.branch)}` : ''}</span></div>
        <div class="dl-mono">${esc(c.billNo || '—')}</div>
        <div class="dl-strong">${esc(c.customer || '—')}</div>
        <div class="dl-mono">${esc(c.memberId || '—')}</div>
        <div>${c.insurer ? `<span class="ins-chip">${esc(c.insurer)}</span>` : '<span class="muted">—</span>'}</div>
        <div class="dl-txt">${esc(c.employeeName || '—')}</div>
        <div class="num"><b>${money(claimTotal(c))}</b> <span class="muted">${CURRENCY}</span></div>
        <div class="row-act" data-stop><button class="icon-btn open-arrow" data-detail="${c.id}" title="Open">${icons.chevronRight}</button></div>
      </div>`).join('')}`;
  }

  function rowsHTML() {
    const list = visible();
    if (!list.length) return `<div class="empty">${icons.receipt}<p>${T.empty}</p></div>`;
    if (direct) return directRowsHTML(list);
    return list.map(c => {
      const n = (c.items ?? []).length;
      return `
      <div class="row" data-open="${c.id}">
        <div class="row-main">
          <div class="row-title"><b>${esc(c.ref)}</b>
            <span class="row-cust">${esc(c.customer || '—')}</span>
            ${direct && c.insurer ? `<span class="ins-chip">${esc(c.insurer)}</span>` : ''}
            ${isAdmin ? locChip(c.branch) : ''}
          </div>
          <div class="row-sub"><span class="row-sub-txt">${esc(fmtDay(c.date))}${direct && c.employeeName ? ` · ${esc(c.employeeName)}` : ''} · Bill ${esc(c.billNo || '—')}${c.memberId ? ` · Member ${esc(c.memberId)}` : ''} · ${n} item${n === 1 ? '' : 's'}</span></div>
        </div>
        <div class="row-units"><b>${money(claimTotal(c))}</b> ${CURRENCY}</div>
        <div class="row-status">${direct ? '' : `<span class="pill ${c.payment === 'card' ? 's-blue' : 's-green'}"><i class="dot"></i>${esc(payLabel(c.payment))}</span>`}</div>
        <div class="row-time" title="${fmtDT(c.updatedAt)}">${relTime(c.updatedAt)}</div>
        <div class="row-act" data-stop>
          <button class="btn btn-ghost btn-sm" data-print="${c.id}">${icons.printer} Print</button>
        </div>
      </div>`;
    }).join('');
  }

  // ── the details drawer (Direct Insurance) ──
  let drawer = null;
  function detailHTML(id) {
    const c = store.claim(id);
    if (!c) return `<div class="pad">This record no longer exists.</div>`;
    const items = c.items ?? [];
    const rx = normaliseRx(c.rx);
    const cells = [...RX_ROWS.map(r => r.key)].flatMap(k => ['od', 'os'].flatMap(e => RX_COLS.map(col => rx[k][e][col.key])));
    const hasRx = cells.some(v => String(v ?? '').trim()) || rx.add.od || rx.add.os;
    const kv = (label, value, wide = false) => `<div${wide ? ' class="kv-wide"' : ''}><span>${label}</span><b>${value}</b></div>`;
    return `
      <div class="dw-head">
        <div>
          <div class="dw-kicker">Insurance customer</div>
          <h2>${esc(c.ref)}</h2>
          <div class="dw-sub">${esc(c.customer || '—')}</div>
        </div>
        <button class="icon-btn" data-close>${icons.x}</button>
      </div>
      <div class="dw-body">
        <div class="dw-status-row">${c.insurer ? `<span class="ins-chip">${esc(c.insurer)}</span>` : ''}<span class="dw-when">${esc(fmtDay(c.date))}</span></div>
        <div class="kv">
          ${kv('Bill number', esc(c.billNo || '—'))}
          ${kv('Member ID', esc(c.memberId || '—'))}
          ${kv('Customer name', esc(c.customer || '—'), true)}
          ${kv('Insurer', esc(c.insurer || '—'))}
          ${kv('Salesperson', esc(c.employeeName || '—'))}
          ${kv('Branch', `${locChip(c.branch)} ${esc(locName(c.branch))}`)}
          ${kv('Date', esc(fmtDay(c.date)))}
        </div>
        <h3 class="tl-h">${icons.receipt} Products</h3>
        <table class="lines">
          <thead><tr><th>Item</th><th>Description</th><th class="num">Qty</th><th class="num">Amount (${CURRENCY})</th></tr></thead>
          <tbody>${items.map(i => `<tr><td>${esc(ITEM_KINDS[i.kind]?.label ?? '—')}</td><td>${esc(i.name || '—')}</td><td class="num">${itemQty(i)}</td><td class="num">${money(itemAmount(i))}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td colspan="3">Total${itemCounts(items) ? ` <span class="muted">· ${esc(itemCounts(items))}</span>` : ''}</td><td class="num">${money(claimTotal(c))} ${CURRENCY}</td></tr></tfoot>
        </table>
        ${hasRx ? `
        <h3 class="tl-h">${icons.glasses} Prescription</h3>
        <div class="rx-wrap"><table class="lines rx-mini-tbl">
          <thead><tr><th></th>${['OD', 'OS'].map(e => RX_COLS.map(col => `<th>${e} ${esc(col.label)}</th>`).join('')).join('')}</tr></thead>
          <tbody>
            ${RX_ROWS.map(r => `<tr><th>${esc(r.label)}</th>${['od', 'os'].map(e => RX_COLS.map(col => `<td>${esc(rx[r.key][e][col.key] || '')}</td>`).join('')).join('')}</tr>`).join('')}
            <tr><th>Add</th><td colspan="4">${esc(rx.add.od || '')}</td><td colspan="4">${esc(rx.add.os || '')}</td></tr>
          </tbody>
        </table></div>` : ''}
        <div class="dw-actions">
          <button class="btn btn-primary" data-do-print>${icons.printer} Print invoice</button>
          <button class="btn btn-ghost" data-preview>See the invoice</button>
          ${viewOnly ? '' : `<button class="btn btn-ghost" data-edit>${icons.wrench} Edit</button>
          <button class="btn btn-ghost btn-danger-text" data-del>${icons.trash} Delete</button>`}
        </div>
      </div>`;
  }

  function openDetail(id) {
    drawer = openLayer('drawer', () => detailHTML(id), { onClose: () => { drawer = null; } });
    drawer.el.addEventListener('click', e => {
      if (e.target.closest('[data-close]')) return drawer.close();
      if (e.target.closest('[data-do-print]')) return printClaim(store.claim(id));
      if (e.target.closest('[data-preview]')) return openPreview(id);
      if (e.target.closest('[data-edit]')) { const c = store.claim(id); drawer.close(); return composer(c); }
      if (e.target.closest('[data-del]')) {
        const c = store.claim(id);
        if (!c || !confirm(`Delete ${c.ref}? This cannot be undone.`)) return;
        store.removeClaim(id, me.code);
        drawer.close();
      }
    });
  }

  // ── preview ──
  function openPreview(id) {
    const c = store.claim(id);
    if (!c) return;
    layer = openLayer('modal', () => {
      const cur = store.claim(id);
      if (!cur) return `<div class="pad">This claim no longer exists.</div>`;
      return `
      <div class="dw-head">
        <div><div class="dw-kicker">Invoice</div><h2>${esc(cur.ref)} · ${esc(cur.customer || '—')}</h2>
          ${direct ? `<div class="dw-sub"><span class="ins-chip">${esc(cur.insurer || '—')}</span> · Sold by ${esc(cur.employeeName || '—')} <span class="muted">· not printed</span></div>` : ''}</div>
        <button class="icon-btn" data-close>${icons.x}</button>
      </div>
      <div class="rc-stage"><div class="rc-scale">${receiptHTML(cur)}</div></div>
      <div class="modal-foot rc-actions">
        <button class="btn btn-primary" data-do-print>${icons.printer} Print invoice</button>
        ${viewOnly ? '' : `<button class="btn btn-ghost" data-edit>${icons.wrench} Edit</button>
        <button class="btn btn-ghost btn-danger-text" data-del>${icons.trash} Delete</button>`}
        <button class="btn btn-ghost" data-close>Close</button>
      </div>`;
    }, { onClose: () => { layer = null; window.removeEventListener('resize', refit); } });
    layer.el.classList.add('modal-sheet');
    const el = layer.el;
    const refit = () => fitSheet(el);
    window.addEventListener('resize', refit);
    fitSheet(layer.el);
    layer.el.querySelectorAll('.receipt img').forEach(img => {
      if (!img.complete) img.addEventListener('load', refit, { once: true });
    });
    layer.el.addEventListener('click', e => {
      if (e.target.closest('[data-close]')) return layer.close();
      if (e.target.closest('[data-do-print]')) return printClaim(store.claim(id));
      if (e.target.closest('[data-edit]')) { layer.close(); return composer(store.claim(id)); }
      if (e.target.closest('[data-del]')) {
        const cur = store.claim(id);
        if (!cur || !confirm(`Delete ${cur.ref}? This cannot be undone.`)) return;
        store.removeClaim(id, me.code);
        layer.close();
      }
    });
  }

  // The sheet is a fixed A4, so scale it down until the whole page fits the
  // room the modal has — width and height — and can be seen at a glance.
  function fitSheet(el) {
    const stage = el.querySelector('.rc-stage');
    const scale = el.querySelector('.rc-scale');
    const sheet = scale?.querySelector('.receipt');
    if (!stage || !sheet) return;
    const cs = getComputedStyle(stage);
    const w = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const h = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const s = Math.min(1, w / sheet.offsetWidth, h / sheet.offsetHeight);
    sheet.style.transform = `scale(${s})`;
    scale.style.width = `${sheet.offsetWidth * s}px`;
    scale.style.height = `${sheet.offsetHeight * s}px`;
  }

  // ── composer ──
  function composer(existing) {
    const draft = existing
      ? {
        date: existing.date, branch: existing.branch, billNo: existing.billNo,
        customer: existing.customer, memberId: existing.memberId ?? '',
        insurer: existing.insurer ?? '', employeeId: existing.employeeId ?? '', employeeName: existing.employeeName ?? '',
        payment: existing.payment,
        items: existing.items.map(i => ({ ...i })),
        rx: JSON.parse(JSON.stringify(normaliseRx(existing.rx))),
      }
      : {
        date: today(), branch: isAdmin ? BRANCHES[0].code : me.code, billNo: '', customer: '',
        memberId: '', insurer: '', employeeId: '', employeeName: '',
        payment: 'cash', items: [{ kind: 'frame', name: '', qty: 1, price: '' }, { kind: 'lens', name: '', qty: 1, price: '' }], rx: blankRx(),
      };

    const total = () => draft.items.reduce((t, i) => t + itemAmount(i), 0);

    // Direct insurance: the insurer, and the salesperson — typed and picked
    // from the schedule's roster, one list in alphabetical order, names only.
    const insurers = insurerChoices();
    let staff = staffCache;
    const staffOptions = () => (staff ?? []).map(s =>
      `<option value="${esc(s.name)}"></option>`).join('');
    const directHTML = () => !direct ? '' : `
        <div class="grid2">
          <label>Insurer
            <select id="f-ins">
              <option value="">Choose the insurer…</option>
              ${insurers.map(n => `<option ${draft.insurer === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}
            </select>
          </label>
          <label>Salesperson
            <input id="f-emp" list="f-emp-list" autocomplete="off" value="${esc(draft.employeeName)}"
                   placeholder="${staff ? 'Type a name…' : 'Loading the staff list…'}">
            <datalist id="f-emp-list">${staffOptions()}</datalist>
          </label>
        </div>`;

    // Each product is a frame or lenses (older ones may be neither), with a
    // quantity and a price per piece.
    const itemRow = (it, i) => `
      <div class="ci-row">
        <select data-it="kind" data-i="${i}" aria-label="Item">
          ${Object.entries(ITEM_KINDS).map(([k, d]) => `<option value="${k}" ${it.kind === k ? 'selected' : ''}>${d.label}</option>`).join('')}
          ${it.kind ? '' : '<option value="" selected>Other</option>'}
        </select>
        <input placeholder="${esc(ITEM_KINDS[it.kind]?.hint ?? 'Description')}" value="${esc(it.name)}" data-it="name" data-i="${i}">
        <input type="number" min="1" step="1" value="${esc(it.qty ?? 1)}" data-it="qty" data-i="${i}" aria-label="Quantity">
        <input type="number" min="0" step="0.001" placeholder="0.000" value="${esc(it.price ?? '')}" data-it="price" data-i="${i}" aria-label="Price each">
        <button class="icon-btn" data-rm="${i}" ${draft.items.length === 1 ? 'disabled' : ''} title="Remove">${icons.x}</button>
      </div>`;

    layer = openLayer('modal', () => `
      <div class="dw-head">
        <div><div class="dw-kicker">${existing ? `Edit ${T.kicker}` : `New ${T.kicker}`}</div><h2>${T.heading}</h2></div>
        <button class="icon-btn" data-close>${icons.x}</button>
      </div>
      <div class="form">
        <div class="grid2">
          <label>Date<input type="date" id="f-date" value="${esc(draft.date)}"></label>
          ${me.role === 'admin' ? `<label>Branch
            <select id="f-branch">
              ${BRANCHES.map(b => `<option value="${b.code}" ${draft.branch === b.code ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}
            </select>
          </label>` : `<label>Branch
            <span class="fixed-field">${locChip(draft.branch)} ${esc(locName(draft.branch))}</span>
          </label>`}
        </div>
        ${directHTML()}
        <div class="grid2">
          <label>Bill number<input id="f-bill" placeholder="e.g. B-58214" value="${esc(draft.billNo)}"></label>
          <label>Member ID<input id="f-member" placeholder="As on the insurance card" value="${esc(draft.memberId)}"></label>
        </div>
        <label>Full name<input id="f-cust" placeholder="Full name" value="${esc(draft.customer)}">
          <span class="field-note">Must be exactly the name on the insurance card.
            <span lang="ar" dir="rtl">يجب أن يكون الاسم مطابقاً تماماً للاسم المكتوب في بطاقة التأمين.</span></span>
        </label>

        <div class="fieldset">
          <div class="fs-head"><span>Products</span><span class="muted sm">Price each, in ${CURRENCY}</span></div>
          <div class="ci-head"><span>Item</span><span>Description</span><span>Qty</span><span>Price</span><span></span></div>
          <div id="ci-list">${draft.items.map(itemRow).join('')}</div>
          <div class="ci-add">
            <button class="btn btn-ghost btn-sm" data-add="frame">${icons.plus} Add frame</button>
            <button class="btn btn-ghost btn-sm" data-add="lens">${icons.plus} Add lenses</button>
          </div>
        </div>

        <div class="fieldset">
          <div class="fs-head"><span>Prescription</span></div>
          <div class="rx-wrap">
            <table class="rx-edit">
              <colgroup><col class="rx-lbl-col"><col span="8"></colgroup>
              <thead>
                <tr>
                  <th rowspan="2"></th>
                  <th colspan="4">OD</th>
                  <th colspan="4">OS</th>
                </tr>
                <tr>
                  ${RX_COLS.map(c => `<th>${esc(c.label)}</th>`).join('')}
                  ${RX_COLS.map(c => `<th>${esc(c.label)}</th>`).join('')}
                </tr>
              </thead>
              <tbody>
                ${RX_ROWS.map(r => `
                  <tr>
                    <th title="${esc(r.title)}">${esc(r.label)}</th>
                    ${RX_COLS.map(c => `<td><input value="${esc(draft.rx[r.key].od[c.key] ?? '')}" data-rx="${r.key}.od.${c.key}"></td>`).join('')}
                    ${RX_COLS.map(c => `<td><input value="${esc(draft.rx[r.key].os[c.key] ?? '')}" data-rx="${r.key}.os.${c.key}"></td>`).join('')}
                  </tr>`).join('')}
                <tr class="rx-sum">
                  <th class="rx-mini">Add</th>
                  <td colspan="4"><input value="${esc(draft.rx.add.od)}" data-rx="add.od"></td>
                  <td colspan="4"><input value="${esc(draft.rx.add.os)}" data-rx="add.os"></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="grid2">
          ${direct ? '<span></span>' : `<label>Payment type
            <select id="f-pay">
              ${PAYMENT_TYPES.map(p => `<option value="${p.value}" ${draft.payment === p.value ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}
            </select>
          </label>`}
          <div class="total-chip"><span>Total</span><b id="f-total">${money(total())} ${CURRENCY}</b></div>
        </div>

        <div class="form-foot">
          <button class="btn btn-ghost" data-close>Cancel</button>
          <button class="btn btn-primary" data-save>${icons.check} ${existing ? 'Save changes' : 'Create invoice'}</button>
        </div>
      </div>`, { onClose: () => { layer = null; } });

    const el = layer.el;
    const sync = () => {
      draft.date = el.querySelector('#f-date').value;
      draft.branch = el.querySelector('#f-branch')?.value ?? (existing?.branch ?? me.code);
      draft.billNo = el.querySelector('#f-bill').value;
      draft.customer = el.querySelector('#f-cust').value;
      draft.memberId = el.querySelector('#f-member').value;
      if (!direct) draft.payment = el.querySelector('#f-pay').value;
      if (direct) {
        draft.insurer = el.querySelector('#f-ins').value;
        // The name typed has to be one on the roster — or, editing an old
        // sale, the person it was already recorded against.
        const typed = el.querySelector('#f-emp').value.trim();
        const hit = staff?.find(s => s.name.toLowerCase() === typed.toLowerCase());
        if (hit) { draft.employeeId = hit.id; draft.employeeName = hit.name; }
        else if (existing && typed === existing.employeeName) { draft.employeeId = existing.employeeId; draft.employeeName = typed; }
        else { draft.employeeId = ''; draft.employeeName = typed; }
      }
    };
    if (direct) {
      staffList().then(list => {
        staff = list;
        const dl = el.querySelector('#f-emp-list');
        if (dl) dl.innerHTML = staffOptions();
        el.querySelector('#f-emp')?.setAttribute('placeholder', 'Type a name…');
      }).catch(err => toast({ title: 'Could not load the staff list', sub: err.message, tone: 'stock' }));
    }
    const showTotal = () => { el.querySelector('#f-total').textContent = `${money(total())} ${CURRENCY}`; };
    const redrawItems = () => {
      el.querySelector('#ci-list').innerHTML = draft.items.map(itemRow).join('');
      showTotal();
    };

    el.addEventListener('input', e => {
      const t = e.target;
      if (t.dataset.it) {
        draft.items[+t.dataset.i][t.dataset.it] = t.value;
        if (t.dataset.it === 'price' || t.dataset.it === 'qty') showTotal();
        if (t.dataset.it === 'kind') t.nextElementSibling.placeholder = ITEM_KINDS[t.value]?.hint ?? 'Description';
        return;
      }
      if (t.dataset.rx) { setPath(draft.rx, t.dataset.rx, t.value); return; }
      sync();
    });
    el.addEventListener('change', sync);
    el.addEventListener('click', async e => {
      if (e.target.closest('[data-close]')) return layer.close();
      const add = e.target.closest('[data-add]');
      if (add) { sync(); draft.items.push({ kind: add.dataset.add, name: '', qty: 1, price: '' }); redrawItems(); return; }
      const rm = e.target.closest('[data-rm]');
      if (rm) { sync(); draft.items.splice(+rm.dataset.rm, 1); redrawItems(); return; }
      if (e.target.closest('[data-save]')) {
        sync();
        const items = draft.items.filter(i => (i.name || '').trim() || Number(i.price));
        if (direct && !draft.insurer) return toast({ title: 'Choose the insurer', tone: 'stock' });
        if (direct && !draft.employeeId) return toast({ title: 'Choose the salesperson', sub: draft.employeeName ? `“${draft.employeeName}” is not on the staff list — pick a name from the list.` : 'Type a name and pick it from the list.', tone: 'stock' });
        if (!draft.memberId.trim()) return toast({ title: 'Member ID is required', sub: 'It is on the insurance card.', tone: 'stock' });
        if (!draft.customer.trim()) return toast({ title: 'Full name is required', sub: 'Exactly as on the insurance card.', tone: 'stock' });
        if (!items.length) return toast({ title: 'Add at least one product', tone: 'stock' });
        const fields = { ...draft, kind, customer: draft.customer.trim(), memberId: draft.memberId.trim(), items: items.map(i => ({ ...i, name: (i.name || '').trim() })) };
        const save = e.target.closest('[data-save]');
        save.disabled = true;
        const was = save.innerHTML;
        save.textContent = 'Saving…';
        const saved = existing
          ? await store.updateClaim(existing.id, fields, me.code)
          : await store.createClaim(fields, me.code);
        if (!saved) { save.disabled = false; save.innerHTML = was; return; }
        layer.close();
        openPreview(saved.id);
      }
    });
  }

  // ── render ──
  // ── Export to Excel: "Insurance Sales" (Sarah and the office; schema-37) ──
  // Every Direct Insurance entry for one branch or all, one insurer or all, over the last 1 / 7 /
  // 30 days or a range of dates — one row per invoice, and a second sheet with
  // every product line.
  function exportModal() {
    const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
    const st = { branch: 'all', insurer: 'all', period: 7, from: daysAgo(7), to: iso(new Date()) };
    const range = () => (st.period === 'range' ? [st.from, st.to] : [daysAgo(st.period - 1), iso(new Date())]);
    const picked = () => {
      const [from, to] = range();
      return store.state.claims.filter(c => c.kind === 'direct' && (st.branch === 'all' || c.branch === st.branch)
        && (st.insurer === 'all' || c.insurer === st.insurer) && c.date >= from && c.date <= to).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    };
    const layer = openLayer('modal', () => {
      const n = picked().length;
      return `
      <div class="dw-head">
        <div><div class="dw-kicker">Export to Excel</div><h2>Insurance Sales</h2></div>
        <button class="icon-btn" data-close>${icons.x}</button>
      </div>
      <div class="form">
        <div class="grid2">
          <label>Branch
            <select id="x-branch"><option value="all">All branches</option>${BRANCHES.map(b => `<option value="${b.code}" ${st.branch === b.code ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>
          </label>
          <label>Insurer
            <select id="x-ins"><option value="all">All insurers</option>${insurerChoices().map(n => `<option value="${esc(n)}" ${st.insurer === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
          </label>
        </div>
        <div class="fieldset">
          <div class="fs-head"><span>Period</span></div>
          <div class="chips status-chips" id="x-period">${[[1, 'Today'], [7, 'Last 7 days'], [30, 'Last 30 days'], ['range', 'Date range']].map(([k, l]) =>
            `<button class="chip ${st.period === k ? 'on' : ''}" data-period="${k}">${l}</button>`).join('')}</div>
          ${st.period === 'range' ? `<div class="grid2" style="margin-top:10px">
            <label>From <input type="date" id="x-from" value="${st.from}"></label>
            <label>To <input type="date" id="x-to" value="${st.to}"></label></div>` : ''}
        </div>
        <div class="form-foot">
          <span class="muted">${n} entr${n === 1 ? 'y' : 'ies'}</span>
          <button class="btn btn-ghost" data-close>Cancel</button>
          <button class="btn btn-primary" data-go ${n ? '' : 'disabled'}>${icons.download} Download Excel</button>
        </div>
      </div>`;
    });
    const el = layer.el;
    el.addEventListener('change', e => {
      if (e.target.id === 'x-branch') st.branch = e.target.value;
      if (e.target.id === 'x-ins') st.insurer = e.target.value;
      if (e.target.id === 'x-from') st.from = e.target.value;
      if (e.target.id === 'x-to') st.to = e.target.value;
      layer.update();
    });
    el.addEventListener('click', async e => {
      if (e.target.closest('[data-close]')) return layer.close();
      const p = e.target.closest('[data-period]');
      if (p) { st.period = p.dataset.period === 'range' ? 'range' : +p.dataset.period; return layer.update(); }
      const go = e.target.closest('[data-go]');
      if (!go) return;
      const list = picked();
      if (!list.length) return;
      go.disabled = true;
      try {
        const XLSX = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
        const rows = list.map(c => ({
          'Invoice No.': c.ref, Date: c.date, Branch: locName(c.branch), 'Bill Number': c.billNo,
          'Customer Name': c.customer, 'Member ID': c.memberId, Insurer: c.insurer, Salesperson: c.employeeName,
          Frames: (c.items ?? []).filter(i => i.kind === 'frame').reduce((s, i) => s + itemQty(i), 0),
          Lenses: (c.items ?? []).filter(i => i.kind === 'lens').reduce((s, i) => s + itemQty(i), 0),
          [`Total (${CURRENCY})`]: Number(claimTotal(c).toFixed(3)),
        }));
        const lines = list.flatMap(c => (c.items ?? []).map(i => ({
          'Invoice No.': c.ref, Date: c.date, Branch: locName(c.branch), 'Customer Name': c.customer,
          Item: ITEM_KINDS[i.kind]?.label ?? '', Description: i.name, Qty: itemQty(i),
          [`Price each (${CURRENCY})`]: Number(i.price) || 0, [`Amount (${CURRENCY})`]: Number(itemAmount(i).toFixed(3)),
        })));
        const wb = XLSX.utils.book_new();
        const s1 = XLSX.utils.json_to_sheet(rows);
        s1['!cols'] = Object.keys(rows[0]).map(k => ({ wch: Math.max(k.length, ...rows.map(r => String(r[k] ?? '').length)) + 2 }));
        XLSX.utils.book_append_sheet(wb, s1, 'Insurance Sales');
        if (lines.length) {
          const s2 = XLSX.utils.json_to_sheet(lines);
          s2['!cols'] = Object.keys(lines[0]).map(k => ({ wch: Math.max(k.length, ...lines.map(r => String(r[k] ?? '').length)) + 2 }));
          XLSX.utils.book_append_sheet(wb, s2, 'Products');
        }
        const [from, to] = range();
        const who = [st.branch === 'all' ? 'All branches' : st.branch, st.insurer === 'all' ? '' : st.insurer].filter(Boolean).join(' - ');
        XLSX.writeFile(wb, `Insurance Sales - ${who.replace(/[\/:*?"<>|]/g, '')} - ${from === to ? from : `${from} to ${to}`}.xlsx`);
        layer.close();
        toast({ title: `Exported ${list.length} entr${list.length === 1 ? 'y' : 'ies'}`, sub: 'The Excel file is in your downloads.', tone: 'info' });
      } catch (err) {
        go.disabled = false;
        toast({ title: 'Could not export', sub: err.message, tone: 'stock' });
      }
    });
  }

  function render() {
    root.innerHTML = `
      <style>${RECEIPT_CSS}</style>
      <header class="mod-head">
        <div>
          <h1>${T.title}</h1>
          <p class="mod-sub">${T.sub}</p>
        </div>
        <div class="mod-head-acts">
          ${direct && canExportInsurance(me.code) ? `<button class="btn btn-ghost" data-export>${icons.download} Export</button>` : ''}
          ${viewOnly ? '' : `<button class="btn btn-primary" data-new>${icons.plus} ${T.add}</button>`}
        </div>
      </header>
      ${direct && isAdmin ? `<div id="d-dash">${dashHTML()}</div><h2 class="dash-list-h">Every insurance customer</h2>` : ''}
      <section class="toolbar">
        <div class="searchbox">${icons.search}<input id="c-q" placeholder="Search invoice, customer, member ID, bill${direct ? ', insurer, salesperson' : ''}…" value="${esc(ui.q)}"></div>
        ${isAdmin ? `<select class="sel" id="c-branch"><option value="all">All branches</option>${
          BRANCHES.map(b => `<option value="${b.code}" ${ui.branch === b.code ? 'selected' : ''}>${esc(b.name)}</option>`).join('')
        }</select>` : ''}
        ${direct ? `<select class="sel" id="c-ins" aria-label="Insurer"><option value="all">All insurers</option>${
          insurerChoices().map(n => `<option value="${esc(n)}" ${ui.insurer === n ? 'selected' : ''}>${esc(n)}</option>`).join('')
        }</select>` : ''}
      </section>
      <section class="list ${direct ? 'dl-list' : ''}" id="c-list">${rowsHTML()}</section>`;
    wireBody();
  }

  function refresh() {
    const a = document.activeElement;
    const keep = a?.id === 'c-q' ? a.selectionStart : null;
    const l = root.querySelector('#c-list');
    if (l) l.innerHTML = rowsHTML();
    const d = root.querySelector('#d-dash');
    if (d) d.innerHTML = dashHTML();
    drawer?.update();
    if (keep != null) {
      const f = root.querySelector('#c-q');
      if (f) { f.focus(); f.setSelectionRange(keep, keep); }
    }
    // The toolbar is not re-rendered here, so its listeners still stand.
  }

  function wireBody() {
    root.querySelector('#c-q')?.addEventListener('input', e => { ui.q = e.target.value; refresh(); });
    root.querySelector('#c-branch')?.addEventListener('change', e => { ui.branch = e.target.value; refresh(); });
    root.querySelector('#c-ins')?.addEventListener('change', e => { ui.insurer = e.target.value; refresh(); });
  }

  // Delegated once at mount, so re-rendering the list never stacks handlers.
  function wireRoot() {
    root.addEventListener('click', e => {
      if (e.target.closest('[data-new]')) return composer(null);
      if (e.target.closest('[data-export]')) return exportModal();
      const det = e.target.closest('[data-detail]');
      if (det) { e.stopPropagation(); return openDetail(det.dataset.detail); }
      const per = e.target.closest('[data-period]');
      if (per) { ui.period = per.dataset.period; refresh(); return; }
      const pr = e.target.closest('[data-print]');
      if (pr) { e.stopPropagation(); return printClaim(store.claim(pr.dataset.print)); }
      if (e.target.closest('[data-stop]')) return;
      const row = e.target.closest('[data-open]');
      if (row) (direct ? openDetail : openPreview)(row.dataset.open);
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
