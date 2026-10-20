// ── Notification bells (user 2026-10-20) ──
// Every work tab has a bell beside its title: All notifications, My Action, or
// Off — chosen per tab, per account, on this computer.
//   My Action — a clear single ding when something new needs you: the same
//               rule as the tab's orange count in the sidebar.
//   All       — that, and a softer, lower tone for anything new another
//               branch does in the tab.
// Only what happens after the page opened, never your own doing, each thing
// once; several at once make one sound (a ding wins over the soft tone).
import { can, canSeeOrder, canSeeRequest, canSeeLensRequest, needsAction, isLensOwner, readOnly, outsideHandler } from './data.js';
import { store } from './store.js';
import { chime } from './sound.js';
import { esc, icons } from './ui.js';

// The tabs with a bell; `action`: there is something to do there (an orange count).
export const BELL_TABS = {
  fitting: { action: true }, stock: { action: true }, lens: { action: true }, outside: { action: true },
  claims: { action: false }, direct: { action: false }, damaged: { action: false },
};
const MODES = {
  all: { label: 'All notifications', icon: 'bellRing' },
  action: { label: 'My Action', icon: 'bell' },
  off: { label: 'Off', icon: 'bellOff' },
};

// ── what this account has to do, per tab (the sidebar's orange counts) ──
export function actionIds(me) {
  if (!me || readOnly(me)) return { fitting: [], stock: [], lens: [], outside: [] };
  const s = store.state;
  const ids = list => list.map(x => x.id);
  return {
    fitting: ids(s.orders.filter(o => canSeeOrder(o, me.code) && needsAction(o, me.code))),
    stock: ids(can(me, 'office_queue')
      ? s.requests.filter(r => r.status === 'placed')
      : s.requests.filter(r => canSeeRequest(r, me.code) && r.status === 'placed')),
    // Only the branch holding the lenses has something to act on here.
    lens: ids(isLensOwner(me.code) ? s.lensRequests.filter(r => r.holder === me.code && r.status === 'requested') : []),
    // Outside lenses to order, and to send on, are the handler's to do.
    outside: ids(me.code === outsideHandler() ? (s.outsideOrders ?? []).filter(x =>
      x.status === 'to_order' || (!x.sentAt && x.branch !== me.code)) : []),
  };
}

// A narrated change from another account that this account may see.
export function relevantNotice(event, me) {
  const s = store.state, refs = event?.refs ?? [];
  if (event.module === 'fitting') return refs.some(id => { const o = s.orders.find(x => x.id === id); return o && canSeeOrder(o, me.code); });
  if (event.module === 'stock') return refs.some(id => { const r = s.requests.find(x => x.id === id); return r && canSeeRequest(r, me.code); });
  if (event.module === 'lens') return refs.some(id => { const r = s.lensRequests.find(x => x.id === id); return r && canSeeLensRequest(r, me.code); });
  return false;
}

// ── the choice, per account, on this computer ──
const keyOf = code => `focp.notify.${code}`;
function loadModes(code) {
  try { return JSON.parse(localStorage.getItem(keyOf(code)) || '{}') || {}; } catch { return {}; }
}
function saveModes(code, modes) {
  try { localStorage.setItem(keyOf(code), JSON.stringify(modes)); } catch { /* this computer will not remember */ }
}
// Not chosen yet: My Action where there is something to do, Off elsewhere.
const modeOf = (modes, tab) => modes[tab] ?? (BELL_TABS[tab]?.action ? 'action' : 'off');

// ── the watcher: one per signed-in shell ──
export function notifier(me) {
  let modes = loadModes(me.code);
  const since = Date.now() - 60e3;
  const records = () => ({
    fitting: store.state.orders, stock: store.state.requests, lens: store.state.lensRequests,
    outside: store.state.outsideOrders ?? [], claims: store.state.claims ?? [], damaged: store.state.damaged ?? [],
  });
  const seen = {};
  for (const [k, list] of Object.entries(records())) seen[k] = new Set(list.map(x => x.id));
  let acting = Object.fromEntries(Object.entries(actionIds(me)).map(([k, v]) => [k, new Set(v)]));
  const mine = new Map();            // ids this account just touched → until when
  let pending = null, timer = null;

  // One sound for a burst: the ding beats the soft tone.
  function queue(kind) {
    if (pending !== 'action') pending = kind;
    clearTimeout(timer);
    timer = setTimeout(() => { chime(pending); pending = null; }, 150);
  }

  function onEvent(event) {
    const who = store.session ?? me;          // as it is now: its ticks can change while signed in
    const now = Date.now();
    if (event && event.remote === false) for (const id of event.refs ?? []) mine.set(id, now + 15e3);
    for (const [id, until] of mine) if (until < now) mine.delete(id);

    const recs = records();
    const added = {};                          // tab → records not here before
    const fresh = {};                          // tab → of those, new ones by someone else
    for (const [k, list] of Object.entries(recs)) {
      const a = list.filter(x => !seen[k].has(x.id));
      a.forEach(x => seen[k].add(x.id));
      added[k] = new Set(a.map(x => x.id));
      fresh[k] = a.filter(x => x.createdAt >= since && (x.by ?? x.branch) !== who.code && !mine.has(x.id));
    }
    const hits = new Set();                    // tabs: something new needs me
    const news = new Set();                    // tabs: something new happened
    const nowActing = actionIds(who);
    for (const [k, ids] of Object.entries(nowActing)) {
      const byId = new Map(recs[k].map(x => [x.id, x]));
      for (const id of ids) {
        if (acting[k]?.has(id) || mine.has(id)) continue;
        const r = byId.get(id);
        if (r && added[k].has(id) && r.createdAt < since) continue;           // an old one loaded later
        if (r && added[k].has(id) && (r.by ?? r.branch) === who.code) continue; // one I made myself
        hits.add(k);
      }
    }
    acting = Object.fromEntries(Object.entries(nowActing).map(([k, v]) => [k, new Set(v)]));

    if (event?.remote && event.title && relevantNotice(event, who) && !(event.refs ?? []).every(id => mine.has(id))) news.add(event.module);
    if (fresh.outside.length) news.add('outside');
    for (const c of fresh.claims) news.add(c.kind === 'direct' ? 'direct' : 'claims');
    if (fresh.damaged.length) news.add('damaged');

    let sound = null;
    for (const tab of Object.keys(BELL_TABS)) {
      const m = modeOf(modes, tab);
      if (m === 'off') continue;
      if (hits.has(tab)) { sound = 'action'; break; }
      if (m === 'all' && news.has(tab)) sound = 'all';
    }
    if (sound) queue(sound);
  }

  // ── the bell beside a tab's title ──
  let pop = null;
  const closePop = () => { pop?.remove(); pop = null; document.removeEventListener('pointerdown', outside, true); };
  const outside = e => { if (pop && !pop.contains(e.target) && !e.target.closest('[data-nb]')) closePop(); };

  function bellHTML(tab) {
    const m = modeOf(modes, tab);
    return `<button type="button" class="nb-bell nb-${m}" data-nb="${tab}" title="Notifications for this tab: ${MODES[m].label}" aria-label="Notifications: ${MODES[m].label}">${icons[MODES[m].icon]}</button>`;
  }
  // Put the bell beside the title (the views redraw their headers; call again).
  function ensureBell(root, tab) {
    if (!BELL_TABS[tab] || !root) return;
    const h1 = root.querySelector('.mod-head h1');
    if (!h1 || h1.querySelector('[data-nb]')) return;
    h1.insertAdjacentHTML('beforeend', bellHTML(tab));
  }
  function openPop(btn) {
    const tab = btn.dataset.nb;
    if (pop) { const same = pop.dataset.tab === tab; closePop(); if (same) return; }
    const m = modeOf(modes, tab), act = BELL_TABS[tab].action;
    const opt = (k, desc) => `
      <button type="button" class="nb-opt ${m === k ? 'on' : ''}" data-nb-mode="${k}">
        <span class="nb-ic">${icons[MODES[k].icon]}</span>
        <span class="nb-txt"><b>${MODES[k].label}</b><span>${desc}</span></span>
        <span class="nb-tick">${m === k ? icons.check : ''}</span>
      </button>`;
    pop = document.createElement('div');
    pop.className = 'nb-pop';
    pop.dataset.tab = tab;
    pop.innerHTML = `<div class="nb-h">Notifications · ${esc(btn.closest('h1')?.firstChild?.textContent?.trim() || '')}</div>
      ${opt('all', act ? 'A soft tone for anything new here — a clear ding when it needs you' : 'A soft tone for anything new here')}
      ${act ? opt('action', 'A clear ding only when something needs you') : ''}
      ${opt('off', 'No sound for this tab')}
      <div class="nb-foot">On this computer, for ${esc(me.name ?? me.code)}</div>`;
    document.body.append(pop);
    const r = btn.getBoundingClientRect();
    pop.style.top = `${r.bottom + window.scrollY + 6}px`;
    pop.style.left = `${Math.max(8, Math.min(r.left + window.scrollX - 12, window.innerWidth - pop.offsetWidth - 8))}px`;
    pop.addEventListener('click', e => {
      const o = e.target.closest('[data-nb-mode]');
      if (!o) return;
      modes = { ...modes, [tab]: o.dataset.nbMode };
      saveModes(me.code, modes);
      // Hear what it will sound like.
      if (o.dataset.nbMode !== 'off') chime(o.dataset.nbMode === 'action' ? 'action' : 'all');
      document.querySelectorAll(`[data-nb="${tab}"]`).forEach(b => { b.outerHTML = bellHTML(tab); });
      closePop();
    });
    setTimeout(() => document.addEventListener('pointerdown', outside, true));
  }
  const onClick = e => { const b = e.target.closest('[data-nb]'); if (b) { e.preventDefault(); e.stopPropagation(); openPop(b); } };
  document.addEventListener('click', onClick, true);

  return {
    onEvent, ensureBell,
    stop() { closePop(); clearTimeout(timer); document.removeEventListener('click', onClick, true); },
  };
}
