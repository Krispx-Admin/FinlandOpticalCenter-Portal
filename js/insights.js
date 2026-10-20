// ── Data (user 2026-10-20) ──
// For the office and its people (and any branch the office ticks it for): one
// page per tab of "just straight data to be able to see what's been
// happening". Each page: the numbers on top, a chart of each day (or week, or
// month), the breakdowns — by branch, status and what each tab is about — and
// every record underneath in one table that searches and sorts. One period and
// one branch for the whole page. Read-only: it is what the account may read
// already (the row rules), laid out.
import {
  locName, money, CURRENCY, claimTotal, itemAmount, PAYMENT_TYPES, FIT_STATUS, REQ_STATUS, LENSREQ_STATUS,
  BRANCHES, fitStep, outsideLensState, lensLabel, fmtPwr,
} from './data.js';
import { store } from './store.js';
import { esc, icons, fmtDT } from './ui.js';

const DAY = 864e5;
const SECTIONS = [
  { key: 'fitting', label: 'Fitting Log', icon: 'glasses' },
  { key: 'stock', label: 'Stock Requests', icon: 'box' },
  { key: 'lens', label: 'Lens Stock', icon: 'lens' },
  { key: 'outside', label: 'Outside Lenses', icon: 'truck' },
  { key: 'direct', label: 'Direct Insurance', icon: 'shield' },
  { key: 'claims', label: 'Reimbursement Invoice', icon: 'receipt' },
  { key: 'damaged', label: 'Damaged Stock', icon: 'damage' },
];
const PERIODS = [['1', 'Today'], ['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['365', '12 months'], ['range', 'Dates']];

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayStart = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const fromISO = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1).getTime(); };
const fmtDay = t => new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const short = t => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const n0 = v => Number(v || 0).toLocaleString('en');
const omr = v => `${Number(v || 0).toLocaleString('en', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`;
const plural = (n, one, many = `${one}s`) => `${n0(n)} ${n === 1 ? one : many}`;
const avg = arr => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null);
const dur = ms => {
  if (ms == null || !isFinite(ms)) return '—';
  const h = ms / 36e5;
  if (h < 1) return `${Math.max(1, Math.round(ms / 6e4))} min`;
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)} h`;
  return `${(h / 24).toFixed(1)} days`;
};
const lastAt = r => r.timeline?.at(-1)?.at ?? r.updatedAt;

export function insightsView(me) {
  const ui = { sec: 'fitting', period: '30', from: iso(new Date(Date.now() - 29 * DAY)), to: iso(new Date()), branch: 'all', q: '', sort: null, desc: true, all: false };
  let root;

  const range = () => {
    if (ui.period === 'range') return [fromISO(ui.from), fromISO(ui.to) + DAY - 1];
    const end = dayStart(Date.now()) + DAY - 1;
    return [end + 1 - Number(ui.period) * DAY, end];
  };
  // Finished work older than the window is fetched once, when a period reaches it.
  function ensureOlder() {
    const [from] = range();
    if (from >= Date.now() - store.historyDays * DAY) return;
    for (const k of ['orders', 'requests', 'lensRequests']) if (!store.olderLoaded(k)) store.loadOlder(k);
  }
  const inRange = t => { const [a, b] = range(); return t >= a && t <= b; };
  const branchOk = code => ui.branch === 'all' || code === ui.branch;

  // ── each section: its records, numbers, breakdowns and table ──
  const S = {
    fitting: () => {
      const list = store.state.orders.filter(o => inRange(o.createdAt) && branchOk(o.origin));
      const done = list.filter(o => o.status === 'collected');
      const source = o => (o.lensRequest ? 'Lens stock' : o.outsideLens ? 'Outside lenses' : 'Own / other');
      return {
        list, when: o => o.createdAt, unit: 'orders',
        kpis: [
          [n0(list.length), 'Orders logged'],
          [n0(done.length), 'Collected'],
          [n0(list.length - done.length), 'Still open'],
          [dur(avg(done.map(o => lastAt(o) - o.createdAt))), 'Average, logged → collected'],
          [n0(list.filter(o => o.urgent).length), 'Urgent'],
        ],
        breakdowns: [
          ['By branch', o => locName(o.origin)],
          ['Where it is now', o => FIT_STATUS[o.status]?.label ?? o.status],
          ['Fitted at', o => (o.fitter ? locName(o.fitter) : o.outside ? `${o.outside} (outside cutter)` : 'Not sent yet')],
          ['Lenses from', source],
        ],
        cols: [
          { h: 'Bill', v: o => o.ref }, { h: 'Logged', v: o => o.createdAt, t: 'date' },
          { h: 'Branch', v: o => locName(o.origin) }, { h: 'Customer', v: o => o.customer },
          { h: 'Fitted at', v: o => (o.fitter ? locName(o.fitter) : o.outside || '—') },
          { h: 'Lenses', v: source }, { h: 'Status', v: o => fitStep(o).label },
          { h: 'Days', v: o => ((o.status === 'collected' ? lastAt(o) : Date.now()) - o.createdAt) / DAY, t: 'days' },
          { h: 'Urgent', v: o => (o.urgent ? 'Urgent' : '') },
        ],
      };
    },
    stock: () => {
      const list = store.state.requests.filter(r => inRange(r.createdAt) && branchOk(r.branch));
      const units = r => r.lines.reduce((s, l) => s + (l.qty || 0), 0);
      const done = list.filter(r => r.status === 'completed');
      const lines = list.flatMap(r => r.lines);
      const byUnits = (name, key) => [name, null, { lines, key, weight: l => l.qty || 0, unit: 'pcs' }];
      return {
        list, when: r => r.createdAt, unit: 'requests',
        kpis: [
          [n0(list.length), 'Requests'], [n0(lines.length), 'Lines'], [n0(list.reduce((s, r) => s + units(r), 0)), 'Units asked for'],
          [n0(done.length), 'Completed'], [dur(avg(done.map(r => lastAt(r) - r.createdAt))), 'Average, placed → completed'],
        ],
        breakdowns: [
          ['By branch', r => locName(r.branch)],
          ['Status', r => REQ_STATUS[r.status]?.label ?? r.status],
          byUnits('Units by category', l => l.category || '—'),
          byUnits('Units by group', l => l.brand || '—'),
        ],
        cols: [
          { h: 'Request', v: r => r.ref }, { h: 'Placed', v: r => r.createdAt, t: 'date' }, { h: 'Branch', v: r => locName(r.branch) },
          { h: 'Lines', v: r => r.lines.length, t: 'num' }, { h: 'Units', v: units, t: 'num' },
          { h: 'What', v: r => r.lines.map(l => `${l.category}${l.brand ? ` · ${l.brand}` : ''}`).join(', ') },
          { h: 'Status', v: r => REQ_STATUS[r.status]?.label ?? r.status },
          { h: 'Took', v: r => (r.status === 'completed' ? (lastAt(r) - r.createdAt) / DAY : null), t: 'days' },
          { h: 'Note', v: r => r.note },
        ],
      };
    },
    lens: () => {
      const list = store.state.lensRequests.filter(r => inRange(r.createdAt) && branchOk(r.branch));
      const pcs = r => r.lines.reduce((s, l) => s + (l.qty || 0), 0);
      const lines = list.filter(r => r.status !== 'declined').flatMap(r => r.lines);
      return {
        list, when: r => r.createdAt, unit: 'requests',
        kpis: [
          [n0(list.length), 'Lens requests'], [n0(lines.reduce((s, l) => s + (l.qty || 0), 0)), 'Lenses taken'],
          [n0(list.filter(r => ['sent', 'confirmed'].includes(r.status)).length), 'Sent'],
          [n0(list.filter(r => r.status === 'requested').length), 'Waiting to be sent'],
          [n0(list.filter(r => r.status === 'declined').length), 'Declined'],
        ],
        breakdowns: [
          ['By branch', r => locName(r.branch)],
          ['From whose shelf', r => locName(r.holder)],
          ['Status', r => LENSREQ_STATUS[r.status]?.label ?? r.status],
          ['Lenses by type', null, { lines, key: l => lensLabel(l), weight: l => l.qty || 0, unit: 'pcs' }],
        ],
        cols: [
          { h: 'Request', v: r => r.ref }, { h: 'Date', v: r => r.createdAt, t: 'date' }, { h: 'Branch', v: r => locName(r.branch) },
          { h: 'Shelf', v: r => locName(r.holder) }, { h: 'Bill', v: r => r.billNo }, { h: 'Customer', v: r => r.customer },
          { h: 'Lenses', v: r => r.lines.map(l => `${l.qty}× ${lensLabel(l)} ${fmtPwr(l.sph)}/${fmtPwr(l.cyl)}`).join(', ') },
          { h: 'Pcs', v: pcs, t: 'num' }, { h: 'Status', v: r => LENSREQ_STATUS[r.status]?.label ?? r.status },
        ],
      };
    },
    outside: () => {
      const list = (store.state.outsideOrders ?? []).filter(x => inRange(x.createdAt) && branchOk(x.branch));
      const ordered = list.filter(x => x.orderedAt);
      const arrived = list.filter(x => x.orderedAt && x.arrivedAt);
      return {
        list, when: x => x.createdAt, unit: 'orders',
        kpis: [
          [n0(list.length), 'Outside orders'], [n0(list.filter(x => x.status === 'to_order').length), 'Still to order'],
          [dur(avg(ordered.map(x => x.orderedAt - x.createdAt))), 'Average, logged → ordered'],
          [dur(avg(arrived.map(x => x.arrivedAt - x.orderedAt))), 'Average, ordered → arrived'],
          [n0(list.filter(x => x.sentAt).length), 'Sent on'],
        ],
        breakdowns: [
          ['By branch', x => locName(x.branch)],
          ['Where they are', x => outsideLensState(x)],
          ['Lens', x => x.lensType || '—'],
          ['How', x => (x.fulfilment === 'send_frames' ? 'Frame to a fitter' : 'Lenses to the branch')],
        ],
        cols: [
          { h: 'Bill', v: x => store.order(x.orderId)?.ref ?? '—' }, { h: 'Logged', v: x => x.createdAt, t: 'date' },
          { h: 'Branch', v: x => locName(x.branch) }, { h: 'Customer', v: x => store.order(x.orderId)?.customer ?? '' },
          { h: 'Lens', v: x => x.lensType }, { h: 'Where', v: x => outsideLensState(x) },
          { h: 'Ordered', v: x => x.orderedAt, t: 'date' }, { h: 'Arrived', v: x => x.arrivedAt, t: 'date' },
          { h: 'Sent', v: x => x.sentAt, t: 'date' }, { h: 'Received', v: x => x.receivedAt, t: 'date' },
        ],
      };
    },
    direct: () => claimsSection('direct'),
    claims: () => claimsSection('claim'),
    damaged: () => {
      const list = (store.state.damaged ?? []).filter(r => inRange(r.createdAt) && branchOk(r.branch));
      const lines = list.flatMap(r => r.lines.map(l => ({ ...l, r })));
      const pcs = r => r.lines.reduce((s, l) => s + (l.qty || 0), 0);
      return {
        list, when: r => r.createdAt, unit: 'reports',
        kpis: [
          [n0(list.length), 'Reports'], [n0(lines.reduce((s, l) => s + (l.qty || 0), 0)), 'Pieces'],
          [n0(new Set(list.map(r => r.branch)).size), 'Branches reporting'],
        ],
        breakdowns: [
          ['Pieces by branch', null, { lines, key: l => locName(l.r.branch), weight: l => l.qty || 0, unit: 'pcs' }],
          ['Pieces by item', null, { lines, key: l => l.name || '—', weight: l => l.qty || 0, unit: 'pcs' }],
        ],
        cols: [
          { h: 'Report', v: r => r.ref }, { h: 'Date', v: r => r.createdAt, t: 'date' }, { h: 'Branch', v: r => locName(r.branch) },
          { h: 'Items', v: r => r.lines.map(l => `${l.qty}× ${l.name}${l.barcode ? ` (${l.barcode})` : ''}`).join(', ') },
          { h: 'Pieces', v: pcs, t: 'num' }, { h: 'Note', v: r => r.note },
        ],
      };
    },
  };

  function claimsSection(kind) {
    const direct = kind === 'direct';
    const all = (store.state.claims ?? []).filter(c => (c.kind || 'claim') === kind && inRange(fromISO(c.date)) && branchOk(c.branch));
    const live = all.filter(c => !c.canceledAt);
    const spent = (c, k) => (c.items ?? []).filter(i => i.kind === k).reduce((s, i) => s + itemAmount(i, c.kind), 0);
    const total = live.reduce((s, c) => s + claimTotal(c), 0);
    const pay = c => PAYMENT_TYPES.find(p => p.value === c.payment)?.label ?? '—';
    const sumBy = (name, key) => [name, null, { lines: live, key, weight: claimTotal, unit: CURRENCY, money: true }];
    return {
      list: all, when: c => fromISO(c.date), unit: direct ? 'customers' : 'invoices', money: c => (c.canceledAt ? 0 : claimTotal(c)),
      kpis: [
        [n0(live.length), direct ? 'Insurance customers' : 'Invoices'],
        [`${omr(total)} <small>${CURRENCY}</small>`, 'Total'],
        [`${omr(live.length ? total / live.length : 0)} <small>${CURRENCY}</small>`, 'Average each'],
        [`${omr(live.reduce((s, c) => s + spent(c, 'frame'), 0))} <small>${CURRENCY}</small>`, 'Frames'],
        [`${omr(live.reduce((s, c) => s + spent(c, 'lens'), 0))} <small>${CURRENCY}</small>`, 'Lenses'],
        ...(direct ? [[n0(all.length - live.length), 'Cancelled']] : []),
      ],
      breakdowns: [
        ...(direct ? [sumBy('By insurer', c => c.insurer || '—')] : []),
        sumBy('By branch', c => locName(c.branch)),
        ...(direct ? [sumBy('By salesperson', c => c.employeeName || '—')] : []),
        sumBy('By payment', pay),
      ],
      cols: [
        { h: 'Invoice', v: c => c.ref }, { h: 'Date', v: c => fromISO(c.date), t: 'day' }, { h: 'Branch', v: c => locName(c.branch) },
        { h: 'Bill', v: c => c.billNo }, { h: 'Customer', v: c => c.customer }, { h: 'Member ID', v: c => c.memberId },
        ...(direct ? [{ h: 'Insurer', v: c => c.insurer }, { h: 'Salesperson', v: c => c.employeeName }] : []),
        { h: 'Frame', v: c => spent(c, 'frame'), t: 'money' }, { h: 'Lenses', v: c => spent(c, 'lens'), t: 'money' },
        { h: 'Total', v: c => claimTotal(c), t: 'money' }, { h: 'Payment', v: pay },
        ...(direct ? [{ h: 'Status', v: c => (c.canceledAt ? 'Cancelled' : 'Completed') }] : []),
      ],
    };
  }

  // ── pieces ──
  function chartHTML(d) {
    const [a, b] = range();
    const days = Math.round((b - a) / DAY);
    const step = days <= 62 ? 'day' : days <= 400 ? 'week' : 'month';
    const keyOf = t => {
      const x = new Date(t); x.setHours(0, 0, 0, 0);
      if (step === 'week') x.setDate(x.getDate() - ((x.getDay() + 1) % 7));      // weeks from Saturday
      if (step === 'month') x.setDate(1);
      return x.getTime();
    };
    const buckets = new Map();
    for (let t = keyOf(a); t <= b; ) {
      buckets.set(t, 0);
      const x = new Date(t);
      if (step === 'day') x.setDate(x.getDate() + 1); else if (step === 'week') x.setDate(x.getDate() + 7); else x.setMonth(x.getMonth() + 1);
      t = x.getTime();
    }
    const val = d.money ?? (() => 1);
    for (const r of d.list) { const k = keyOf(d.when(r)); if (buckets.has(k)) buckets.set(k, buckets.get(k) + val(r)); }
    const bars = [...buckets];
    const max = Math.max(...bars.map(([, v]) => v), 0);
    const W = 1000, H = 160, bw = W / Math.max(bars.length, 1);
    const fmt = v => (d.money ? `${omr(v)} ${CURRENCY}` : plural(v, d.unit.replace(/s$/, ''), d.unit));
    const label = t => (step === 'month' ? new Date(t).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : step === 'week' ? `Week of ${short(t)}` : fmtDay(t));
    return `
      <div class="in-card in-chart">
        <div class="in-card-h"><b>${d.money ? 'Total' : d.unit.replace(/^./, s => s.toUpperCase())} per ${step}</b><span>highest ${fmt(max)}</span></div>
        ${max ? `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(d.unit)} per ${step}">
          ${bars.map(([t, v], i) => {
            const h = v ? Math.max(3, v / max * (H - 6)) : 0;
            return `<g><rect class="hit" x="${(i * bw).toFixed(1)}" y="0" width="${bw.toFixed(1)}" height="${H}"><title>${esc(label(t))}: ${esc(fmt(v))}</title></rect>
              ${h ? `<rect class="bar" x="${(i * bw + Math.min(2, bw * .15)).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${Math.max(1, bw - Math.min(4, bw * .3)).toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(4, bw / 4).toFixed(1)}"><title>${esc(label(t))}: ${esc(fmt(v))}</title></rect>` : ''}</g>`;
          }).join('')}
        </svg>
        <div class="in-axis"><span>${esc(label(bars[0]?.[0] ?? a))}</span><span>${esc(label(bars.at(-1)?.[0] ?? b))}</span></div>`
        : `<p class="muted in-none">Nothing in this period.</p>`}
      </div>`;
  }

  function breakdownHTML(d, [title, key, opt]) {
    const m = new Map();
    if (opt) for (const l of opt.lines) { const k = opt.key(l); m.set(k, (m.get(k) ?? 0) + opt.weight(l)); }
    else for (const r of d.list) { const k = key(r); m.set(k, (m.get(k) ?? 0) + 1); }
    let rows = [...m].sort((x, y) => y[1] - x[1]);
    const total = rows.reduce((s, [, v]) => s + v, 0);
    if (rows.length > 10) rows = [...rows.slice(0, 9), ['Other', rows.slice(9).reduce((s, [, v]) => s + v, 0)]];
    const top = Math.max(...rows.map(([, v]) => v), 1);
    const fmt = v => (opt?.money ? omr(v) : n0(v));
    return `
      <div class="in-card">
        <div class="in-card-h"><b>${esc(title)}</b><span>${opt ? (opt.money ? CURRENCY : opt.unit) : d.unit}</span></div>
        ${rows.length ? `<div class="in-bars">${rows.map(([k, v]) => `
          <div class="in-bar" title="${esc(k)}: ${fmt(v)}${total ? ` (${Math.round(v / total * 100)}%)` : ''}">
            <span class="in-bar-k">${esc(k)}</span>
            <span class="in-bar-t"><i style="width:${(v / top * 100).toFixed(1)}%"></i></span>
            <span class="in-bar-v">${fmt(v)}</span>
            <span class="in-bar-p">${total ? `${Math.round(v / total * 100)}%` : ''}</span>
          </div>`).join('')}</div>` : '<p class="muted in-none">Nothing in this period.</p>'}
      </div>`;
  }

  function cellText(c, r) {
    const v = c.v(r);
    if (c.t === 'date') return v ? fmtDT(v) : '';
    if (c.t === 'day') return v ? fmtDay(v) : '';
    if (c.t === 'money') return omr(v);
    if (c.t === 'days') return v == null ? '' : `${v.toFixed(v < 10 ? 1 : 0)} d`;
    if (c.t === 'num') return n0(v);
    return String(v ?? '');
  }
  function tableHTML(d) {
    const q = ui.q.trim().toLowerCase();
    let rows = d.list.map(r => ({ r, cells: d.cols.map(c => cellText(c, r)) }));
    if (q) rows = rows.filter(x => x.cells.some(s => s.toLowerCase().includes(q)));
    const si = ui.sort ?? 1;
    const col = d.cols[si];
    if (col) rows.sort((x, y) => {
      const a = col.v(x.r), b = col.v(y.r);
      const cmp = (typeof a === 'number' || typeof b === 'number') ? (a ?? -Infinity) - (b ?? -Infinity) : String(a ?? '').localeCompare(String(b ?? ''));
      return ui.desc ? -cmp : cmp;
    });
    const shown = ui.all ? rows : rows.slice(0, 200);
    return `
      <div class="in-card in-table-card">
        <div class="in-card-h in-table-h">
          <b>Every ${d.unit.replace(/s$/, '')} — ${n0(rows.length)}</b>
          <div class="searchbox">${icons.search}<input id="in-q" placeholder="Search the table…" value="${esc(ui.q)}"></div>
        </div>
        <div class="in-scroll"><table class="in-table">
          <thead><tr>${d.cols.map((c, i) => `<th class="${['num', 'money', 'days'].includes(c.t) ? 'r' : ''}" data-sort="${i}">${esc(c.h)}${i === si ? (ui.desc ? ' ▾' : ' ▴') : ''}</th>`).join('')}</tr></thead>
          <tbody>${shown.map(x => `<tr>${x.cells.map((s, i) => `<td class="${['num', 'money', 'days'].includes(d.cols[i].t) ? 'r' : ''}">${esc(s)}</td>`).join('')}</tr>`).join('')}</tbody>
        </table></div>
        ${rows.length > shown.length ? `<button class="btn btn-ghost btn-sm in-more" data-all>Show all ${n0(rows.length)}</button>` : ''}
        ${rows.length ? '' : '<p class="muted in-none">Nothing in this period.</p>'}
      </div>`;
  }

  function bodyHTML() {
    const d = S[ui.sec]();
    return `
      <section class="stats in-kpis">${d.kpis.map(([v, l]) => `<div class="stat"><div class="stat-n">${v}</div><div class="stat-l">${esc(l)}</div></div>`).join('')}</section>
      ${chartHTML(d)}
      <div class="in-grid">${d.breakdowns.map(b => breakdownHTML(d, b)).join('')}</div>
      ${tableHTML(d)}`;
  }

  function render() {
    ensureOlder();
    root.innerHTML = `
      <header class="mod-head">
        <div>
          <h1>Data</h1>
          <p class="mod-sub">What has been happening — the numbers, every day, and every record</p>
        </div>
      </header>
      <nav class="in-tabs" role="tablist">${SECTIONS.map(s => `
        <button class="in-tab ${ui.sec === s.key ? 'on' : ''}" data-sec="${s.key}" role="tab">${icons[s.icon] ?? ''}<span>${esc(s.label)}</span></button>`).join('')}</nav>
      <section class="toolbar in-toolbar">
        <div class="chips status-chips">${PERIODS.map(([k, l]) => `<button class="chip ${ui.period === k ? 'on' : ''}" data-period="${k}">${l}</button>`).join('')}</div>
        ${ui.period === 'range' ? `<label class="in-date">From <input type="date" id="in-from" value="${ui.from}"></label><label class="in-date">To <input type="date" id="in-to" value="${ui.to}"></label>` : ''}
        <select class="sel" id="in-branch" aria-label="Branch"><option value="all">All branches</option>${BRANCHES.map(b => `<option value="${b.code}" ${ui.branch === b.code ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>
        <span class="in-range muted">${esc(fmtDay(range()[0]))} – ${esc(fmtDay(range()[1]))}</span>
      </section>
      <div id="in-body">${bodyHTML()}</div>`;
  }
  function refresh() {
    const b = root.querySelector('#in-body');
    if (!b) return;
    const a = document.activeElement, keep = a?.id === 'in-q' ? a.selectionStart : null;
    b.innerHTML = bodyHTML();
    if (keep != null) { const f = root.querySelector('#in-q'); f.focus(); f.setSelectionRange(keep, keep); }
  }

  function wire() {
    root.addEventListener('click', e => {
      const s = e.target.closest('[data-sec]');
      if (s) { ui.sec = s.dataset.sec; ui.sort = null; ui.desc = true; ui.q = ''; ui.all = false; return render(); }
      const p = e.target.closest('[data-period]');
      if (p) { ui.period = p.dataset.period; ui.all = false; return render(); }
      const th = e.target.closest('[data-sort]');
      if (th) { const i = +th.dataset.sort; if ((ui.sort ?? 1) === i) ui.desc = !ui.desc; else { ui.sort = i; ui.desc = false; } return refresh(); }
      if (e.target.closest('[data-all]')) { ui.all = true; return refresh(); }
    });
    root.addEventListener('change', e => {
      if (e.target.id === 'in-branch') { ui.branch = e.target.value; return refresh(); }
      if (e.target.id === 'in-from' && e.target.value) { ui.from = e.target.value; return render(); }
      if (e.target.id === 'in-to' && e.target.value) { ui.to = e.target.value; return render(); }
    });
    root.addEventListener('input', e => { if (e.target.id === 'in-q') { ui.q = e.target.value; refresh(); } });
  }

  return {
    mount(el) { root = el; render(); wire(); },
    onChange() { refresh(); },
    unmount() {},
  };
}
