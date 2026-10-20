// ── Data (user 2026-10-20) ──
// For the office and its people (and any branch the office ticks it for): one
// page per tab of "just straight data to be able to see what's been
// happening". Each page: the numbers on top, a chart of each day (or week, or
// month), the breakdowns — by branch, status and what each tab is about — and
// every record underneath in one table that searches and sorts. One period and
// one branch for the whole page. Read-only: it is what the account may read
// already (the row rules), laid out.
// Journey (user 2026-10-20): the average, median and slowest time from start
// to end and in each step — clock time; a fitting order's ends at "Ready for
// collection" (the customer's pick-up is not ours). Steps come from the step
// log (schema-56), kept from 2026-10-20; outside lenses from their own times.
// Compare: up to three groups of branches (and fitting centres) side by side.
import {
  locName, money, CURRENCY, claimTotal, itemAmount, PAYMENT_TYPES, FIT_STATUS, REQ_STATUS, LENSREQ_STATUS,
  BRANCHES, FITTERS, outsideHandler, fitStep, outsideLensState, lensLabel, fmtPwr,
} from './data.js';
import { store } from './store.js';
import { isPractice } from './auth.js';
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
// The step log began here (schema-56): earlier steps are not timed. The
// Admin Demo's database has always had it.
const STEP_FROM = isPractice ? 0 : Date.parse('2026-10-20T16:44:00Z');
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const p90 = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * 0.9))]; };
// The journeys: their steps in order, where each record's steps come from, when it ends.
const JOURNEYS = {
  fitting: {
    title: 'Logged → ready for collection', log: 'order', unit: 'orders',
    steps: ['pending', 'lenses_in', 'to_fitter', 'at_fitter', 'ready', 'returning'].map(k => [k, FIT_STATUS[k].label]),
    ends: ['delivered', 'collected'],
  },
  stock: { title: 'Placed → completed', log: 'request', unit: 'requests', steps: [['placed', 'Waiting for the office']], ends: ['completed'] },
  lens: {
    title: 'Requested → confirmed', log: 'lens', unit: 'requests',
    steps: [['reserved', 'Set aside'], ['requested', 'Lenses to send'], ['sent', 'On the way']], ends: ['confirmed', 'declined'],
  },
  outside: {
    title: 'Logged → lenses delivered', unit: 'orders',
    steps: [['to_order', 'To order'], ['ordered', 'Ordered from the supplier'], ['arrived', 'At the handler'], ['sent', 'On the way']],
  },
};

export function insightsView(me) {
  const ui = { sec: 'fitting', period: '30', from: iso(new Date(Date.now() - 29 * DAY)), to: iso(new Date()), branch: 'all', q: '', sort: null, desc: true, all: false,
    compare: false, groups: [{ name: 'Group A', from: new Set(), fit: new Set() }, { name: 'Group B', from: new Set(), fit: new Set() }] };
  let root;
  // The step log for the period, read when the page opens and every 20 s at most.
  const log = { since: null, at: 0, rows: new Map(), busy: false };
  async function loadLog(force = false) {
    const since = Math.max(range()[0], STEP_FROM);
    if (log.busy || (!force && log.since != null && log.since <= since && Date.now() - log.at < 20e3)) return;
    log.busy = true;
    try {
      const rows = await store.stepLog(new Date(since).toISOString());
      const m = new Map();
      for (const x of rows) { const a = m.get(x.row_id) ?? []; a.push({ s: x.status, at: Date.parse(x.at) }); m.set(x.row_id, a); }
      Object.assign(log, { since, at: Date.now(), rows: m });
    } catch { /* the page still shows everything else */ } finally { log.busy = false; }
    refresh();
  }
  // A record's steps: [{ s, from, to }] — from the log, or (outside lenses) its own times.
  function segsOf(sec, r) {
    if (sec === 'outside') {
      const pts = [['to_order', r.createdAt], ['ordered', r.orderedAt], ['arrived', r.arrivedAt], ['sent', r.sentAt], ['done', r.receivedAt]];
      const out = [];
      for (let i = 0; i < pts.length - 1; i++) if (pts[i][1]) out.push({ s: pts[i][0], from: pts[i][1], to: pts[i + 1][1] ?? null });
      return out;
    }
    const rows = log.rows.get(r.id) ?? [];
    return rows.map((x, i) => ({ s: x.s, from: x.at, to: rows[i + 1]?.at ?? null }));
  }
  // When the journey ended (null: not yet), and whether all of it was timed.
  function endOf(sec, r, segs) {
    if (sec === 'outside') {
      if (r.fulfilment === 'send_frames') return r.receivedAt ?? null;
      // The handler's own: done when the lenses arrive there; else when sent on.
      return r.branch === outsideHandler() ? (r.arrivedAt ?? null) : (r.sentAt ?? null);
    }
    const J = JOURNEYS[sec];
    return segs.find(x => J.ends.includes(x.s))?.from ?? null;
  }
  const wholeOf = (sec, r, segs) => sec === 'outside' || (segs[0] && segs[0].from >= STEP_FROM && Math.abs(segs[0].from - r.createdAt) < 5 * 6e4);
  // Over a list: each finished journey's time, each step's times, who is in which step now.
  function journeyOf(sec, list) {
    const J = JOURNEYS[sec];
    if (!J) return null;
    const per = new Map(J.steps.map(([k]) => [k, []]));
    const done = [];
    for (const r of list) {
      const segs = segsOf(sec, r), end = endOf(sec, r, segs), acc = new Map();
      for (const x of segs) {
        if (!per.has(x.s) || x.to == null || x.from < STEP_FROM || (end != null && x.from >= end)) continue;
        acc.set(x.s, (acc.get(x.s) ?? 0) + (x.to - x.from));
      }
      for (const [k, v] of acc) per.get(k).push(v);
      if (end != null && wholeOf(sec, r, segs)) done.push({ r, t: end - r.createdAt, acc });
    }
    const totals = done.map(x => x.t);
    const nowIn = k => (sec === 'outside'
      ? list.filter(r => { const s = segsOf(sec, r); const last = s.at(-1); return last && last.to == null && last.s === k && endOf(sec, r, s) == null; }).length
      : list.filter(r => r.status === k).length);
    return {
      J, done, totals, avg: avg(totals), median: median(totals), p90: p90(totals),
      steps: J.steps.map(([k, label]) => ({ k, label, n: per.get(k).length, avg: avg(per.get(k)), median: median(per.get(k)), p90: p90(per.get(k)), now: nowIn(k) })),
    };
  }
  // The group a record belongs to: its branch, and (orders) where it is fitted.
  const fitKey = o => o.fitter ?? (o.outside ? 'OUTSIDE' : null);
  const groupPick = g => ({
    from: code => !g.from.size || g.from.has(code),
    fit: o => !g.fit.size || g.fit.has(fitKey(o)),
  });
  const here = () => ({ from: code => ui.branch === 'all' || code === ui.branch, fit: () => true });

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

  // ── each section: its records, numbers, breakdowns and table ──
  const S = {
    fitting: (g = here()) => {
      const list = store.state.orders.filter(o => inRange(o.createdAt) && g.from(o.origin) && g.fit(o));
      const done = list.filter(o => o.status === 'collected');
      const source = o => (o.lensRequest ? 'Lens stock' : o.outsideLens ? 'Outside lenses' : 'Own / other');
      return {
        list, when: o => o.createdAt, unit: 'orders',
        kpis: [
          [n0(list.length), 'Orders logged'],
          [n0(done.length), 'Collected'],
          [n0(list.length - done.length), 'Still open'],
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
    stock: (g = here()) => {
      const list = store.state.requests.filter(r => inRange(r.createdAt) && g.from(r.branch));
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
    lens: (g = here()) => {
      const list = store.state.lensRequests.filter(r => inRange(r.createdAt) && g.from(r.branch));
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
    outside: (g = here()) => {
      const list = (store.state.outsideOrders ?? []).filter(x => inRange(x.createdAt) && g.from(x.branch));
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
    direct: (g = here()) => claimsSection('direct', g),
    claims: (g = here()) => claimsSection('claim', g),
    damaged: (g = here()) => {
      const list = (store.state.damaged ?? []).filter(r => inRange(r.createdAt) && g.from(r.branch));
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

  function claimsSection(kind, g) {
    const direct = kind === 'direct';
    const all = (store.state.claims ?? []).filter(c => (c.kind || 'claim') === kind && inRange(fromISO(c.date)) && g.from(c.branch));
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

  // The journey card: the numbers, a bar split into steps (each as wide as
  // its average), and the steps in a table.
  const SHADES = ['#c9d6e8', '#9fb6d6', '#7598c4', '#4e79ad', '#2f5a8f', '#1c4373', '#133056'];
  function journeyBar(jr) {
    const st = jr.steps.filter(s => s.avg);
    const sum = st.reduce((s, x) => s + x.avg, 0);
    if (!sum) return '<p class="muted in-none">No step has finished yet in this period.</p>';
    return `<div class="jr-bar">${st.map((s, i) => {
      const w = s.avg / sum * 100, c = SHADES[Math.round(i * (SHADES.length - 1) / Math.max(1, st.length - 1))];
      return `<span class="jr-seg" style="flex:${w.toFixed(3)} 1 0;background:${c};color:${i >= st.length / 2 ? '#fff' : '#133056'}" title="${esc(s.label)}: average ${dur(s.avg)} (${s.n})">${w > 9 ? `<b>${esc(s.label)}</b><span>${dur(s.avg)}</span>` : ''}</span>`;
    }).join('')}</div>`;
  }
  function journeyHTML(sec, d) {
    const jr = journeyOf(sec, d.list);
    if (!jr) return '';
    const from = JOURNEYS[sec].log && STEP_FROM ? `<span class="jr-from">Steps timed from ${fmtDay(STEP_FROM)}</span>` : '';
    return `
      <div class="in-card jr-card">
        <div class="in-card-h"><b>Journey · ${esc(jr.J.title)}</b>${from}</div>
        <div class="jr-stats">
          <div><b>${dur(jr.avg)}</b><span>Average</span></div>
          <div><b>${dur(jr.median)}</b><span>Median — half are quicker</span></div>
          <div><b>${dur(jr.p90)}</b><span>Slowest 10% take over</span></div>
          <div><b>${n0(jr.done.length)}</b><span>Finished and fully timed</span></div>
        </div>
        ${journeyBar(jr)}
        <div class="in-scroll jr-steps"><table class="in-table">
          <thead><tr><th>Step</th><th class="r">Went through</th><th class="r">Average</th><th class="r">Median</th><th class="r">Slowest 10%</th><th class="r">In it now</th></tr></thead>
          <tbody>${jr.steps.map(s => `<tr><td>${esc(s.label)}</td><td class="r">${n0(s.n)}</td><td class="r">${dur(s.avg)}</td><td class="r">${dur(s.median)}</td><td class="r">${dur(s.p90)}</td><td class="r">${n0(s.now)}</td></tr>`).join('')}</tbody>
        </table></div>
      </div>
      ${sec === 'fitting' ? fittingTimesHTML(jr) : ''}`;
  }
  // Fitting orders: whose are quicker, and the slowest ones with where they waited.
  function fittingTimesHTML(jr) {
    const src = o => (o.lensRequest ? 'Lens stock' : o.outsideLens ? 'Outside lenses' : 'Own / other');
    const timeBars = (title, key) => {
      const m = new Map();
      for (const x of jr.done) { const k = key(x.r); const a = m.get(k) ?? []; a.push(x.t); m.set(k, a); }
      const rows = [...m].map(([k, a]) => [k, avg(a), a.length]).sort((a, b) => a[1] - b[1]);
      const top = Math.max(...rows.map(r => r[1]), 1);
      return `<div class="in-card"><div class="in-card-h"><b>${esc(title)}</b><span>average time</span></div>
        ${rows.length ? `<div class="in-bars">${rows.map(([k, v, n]) => `
          <div class="in-bar" title="${esc(k)}: ${dur(v)} on average over ${n} order${n === 1 ? '' : 's'}">
            <span class="in-bar-k">${esc(k)}</span><span class="in-bar-t"><i style="width:${(v / top * 100).toFixed(1)}%"></i></span>
            <span class="in-bar-v">${dur(v)}</span><span class="in-bar-p">${n}</span></div>`).join('')}</div>` : '<p class="muted in-none">No finished orders yet.</p>'}</div>`;
    };
    const slow = [...jr.done].sort((a, b) => b.t - a.t).slice(0, 8);
    const longest = x => { let best = null; for (const [k, v] of x.acc) if (!best || v > best[1]) best = [k, v]; return best ? `${FIT_STATUS[best[0]]?.label ?? best[0]} (${dur(best[1])})` : '—'; };
    return `
      <div class="in-grid">
        ${timeBars('Time by branch', o => locName(o.origin))}
        ${timeBars('Time by fitting centre', o => (o.fitter ? locName(o.fitter) : o.outside ? 'Outside cutter' : '—'))}
        ${timeBars('Time by where the lenses came from', src)}
      </div>
      ${slow.length ? `<div class="in-card"><div class="in-card-h"><b>Slowest orders</b><span>and where they waited longest</span></div>
        <div class="in-scroll"><table class="in-table"><thead><tr><th>Bill</th><th>Branch</th><th>Fitted at</th><th>Customer</th><th class="r">Took</th><th>Longest step</th></tr></thead>
        <tbody>${slow.map(x => `<tr><td>${esc(x.r.ref)}</td><td>${esc(locName(x.r.origin))}</td><td>${esc(x.r.fitter ? locName(x.r.fitter) : x.r.outside || '—')}</td><td>${esc(x.r.customer)}</td><td class="r">${dur(x.t)}</td><td>${esc(longest(x))}</td></tr>`).join('')}</tbody></table></div></div>` : ''}`;
  }

  // ── Compare: the groups, then the same numbers side by side ──
  function groupLabel(g) {
    const f = g.from.size ? [...g.from].map(c => c).join(', ') : 'All branches';
    const t = ui.sec === 'fitting' && g.fit.size ? ` · fitted at ${[...g.fit].map(c => (c === 'OUTSIDE' ? 'outside cutter' : c)).join(', ')}` : '';
    return f + t;
  }
  function compareHTML() {
    const sec = ui.sec;
    const builder = ui.groups.map((g, gi) => `
      <div class="cg-card">
        <div class="cg-head"><span class="cg-dot" style="background:${['#1c4373', '#b45309', '#2e7d6b'][gi]}"></span>
          <input class="cg-name" data-cg-name="${gi}" value="${esc(g.name)}" aria-label="Group name">
          ${ui.groups.length > 1 ? `<button class="icon-btn" data-cg-del="${gi}" title="Remove this group">${icons.x}</button>` : ''}</div>
        <div class="cg-label">Branches <span>${g.from.size ? '' : '— none ticked = all'}</span></div>
        <div class="cg-chips">${BRANCHES.map(b => `<button type="button" class="cg-chip ${g.from.has(b.code) ? 'on' : ''}" data-cg="${gi}" data-cg-from="${b.code}" title="${esc(b.name)}">${esc(b.code)}</button>`).join('')}</div>
        ${sec === 'fitting' ? `<div class="cg-label">Fitted at <span>${g.fit.size ? '' : '— none ticked = anywhere'}</span></div>
        <div class="cg-chips">${[...FITTERS.map(f => [f.code, f.name]), ['OUTSIDE', 'Outside cutter']].map(([c, n]) => `<button type="button" class="cg-chip ${g.fit.has(c) ? 'on' : ''}" data-cg="${gi}" data-cg-fit="${c}" title="${esc(n)}">${esc(c === 'OUTSIDE' ? 'Outside' : c)}</button>`).join('')}</div>` : ''}
      </div>`).join('');
    const ds = ui.groups.map(g => S[sec](groupPick(g)));
    const jrs = ds.map(d => journeyOf(sec, d.list));
    const head = `<tr><th></th>${ui.groups.map((g, gi) => `<th class="r"><span class="cg-dot" style="background:${['#1c4373', '#b45309', '#2e7d6b'][gi]}"></span> ${esc(g.name)}</th>`).join('')}</tr>`;
    const strip = v => String(v).replace(/<[^>]+>/g, '');
    const kpiRows = ds[0].kpis.map(([, label], i) => `<tr><td>${esc(label)}</td>${ds.map(d => `<td class="r">${esc(strip(d.kpis[i]?.[0] ?? '—'))}</td>`).join('')}</tr>`).join('');
    const jRows = jrs[0] ? `
      <tr class="cg-sep"><td colspan="${ui.groups.length + 1}">Journey · ${esc(jrs[0].J.title)}</td></tr>
      <tr><td>Average</td>${jrs.map(j => `<td class="r"><b>${dur(j.avg)}</b></td>`).join('')}</tr>
      <tr><td>Median</td>${jrs.map(j => `<td class="r">${dur(j.median)}</td>`).join('')}</tr>
      <tr><td>Slowest 10%</td>${jrs.map(j => `<td class="r">${dur(j.p90)}</td>`).join('')}</tr>
      <tr><td>Finished and timed</td>${jrs.map(j => `<td class="r">${n0(j.done.length)}</td>`).join('')}</tr>
      ${jrs[0].steps.map((s, i) => `<tr><td>${esc(s.label)} <span class="muted">average</span></td>${jrs.map(j => `<td class="r">${dur(j.steps[i].avg)}</td>`).join('')}</tr>`).join('')}` : '';
    return `
      <div class="cg-builder">${builder}
        ${ui.groups.length < 3 ? `<button type="button" class="cg-add" data-cg-add>${icons.plus} Add a group</button>` : ''}</div>
      <div class="in-card">
        <div class="in-card-h"><b>Side by side</b><span>${esc(SECTIONS.find(s => s.key === sec).label)} · ${esc(fmtDay(range()[0]))} – ${esc(fmtDay(range()[1]))}</span></div>
        <div class="in-scroll"><table class="in-table cg-table">
          <thead>${head}</thead>
          <tbody>
            <tr><td class="muted">Who</td>${ui.groups.map(g => `<td class="r muted">${esc(groupLabel(g))}</td>`).join('')}</tr>
            ${kpiRows}${jRows}
          </tbody></table></div>
      </div>
      ${jrs[0] ? `<div class="in-card"><div class="in-card-h"><b>Journeys</b><span>each step as wide as its average</span></div>
        ${jrs.map((j, gi) => `<div class="cg-jr"><span><span class="cg-dot" style="background:${['#1c4373', '#b45309', '#2e7d6b'][gi]}"></span>${esc(ui.groups[gi].name)} · ${dur(j.avg)}</span>${journeyBar(j)}</div>`).join('')}</div>` : ''}`;
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
    if (ui.compare) return compareHTML();
    const d = S[ui.sec]();
    return `
      <section class="stats in-kpis">${d.kpis.map(([v, l]) => `<div class="stat"><div class="stat-n">${v}</div><div class="stat-l">${esc(l)}</div></div>`).join('')}</section>
      ${journeyHTML(ui.sec, d)}
      ${chartHTML(d)}
      <div class="in-grid">${d.breakdowns.map(b => breakdownHTML(d, b)).join('')}</div>
      ${tableHTML(d)}`;
  }

  function render() {
    ensureOlder();
    loadLog();
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
        ${ui.compare ? '' : `<select class="sel" id="in-branch" aria-label="Branch"><option value="all">All branches</option>${BRANCHES.map(b => `<option value="${b.code}" ${ui.branch === b.code ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>`}
        <button type="button" class="btn ${ui.compare ? 'btn-primary' : 'btn-ghost'} btn-sm" data-compare>${icons.chart} ${ui.compare ? 'Comparing groups' : 'Compare groups'}</button>
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
      if (e.target.closest('[data-compare]')) { ui.compare = !ui.compare; return render(); }
      const cf = e.target.closest('[data-cg-from], [data-cg-fit]');
      if (cf) {
        const g = ui.groups[+cf.dataset.cg], set = cf.dataset.cgFrom ? g.from : g.fit, k = cf.dataset.cgFrom ?? cf.dataset.cgFit;
        if (set.has(k)) set.delete(k); else set.add(k);
        return refresh();
      }
      if (e.target.closest('[data-cg-add]')) { ui.groups.push({ name: `Group ${'ABC'[ui.groups.length]}`, from: new Set(), fit: new Set() }); return refresh(); }
      const cd = e.target.closest('[data-cg-del]');
      if (cd) { ui.groups.splice(+cd.dataset.cgDel, 1); return refresh(); }
    });
    root.addEventListener('change', e => {
      if (e.target.id === 'in-branch') { ui.branch = e.target.value; return refresh(); }
      if (e.target.dataset.cgName != null) { ui.groups[+e.target.dataset.cgName].name = e.target.value.trim() || ui.groups[+e.target.dataset.cgName].name; return refresh(); }
      if (e.target.id === 'in-from' && e.target.value) { ui.from = e.target.value; return render(); }
      if (e.target.id === 'in-to' && e.target.value) { ui.to = e.target.value; return render(); }
    });
    root.addEventListener('input', e => { if (e.target.id === 'in-q') { ui.q = e.target.value; refresh(); } });
  }

  return {
    mount(el) { root = el; render(); wire(); },
    onChange() { refresh(); loadLog(); },
    unmount() {},
  };
}
