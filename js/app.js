// ── App shell: login, sidebar navigation, routing, live toasts ──
import { LOCATIONS, ROLES, BRANCH_KINDS, loc, canSeeOrder, canSeeRequest, canSeeLensRequest, needsAction, isLensOwner, readOnly, tabOff, setLocations, seesAll, outsideHandler } from './data.js';
import { captchaOn, mountCaptcha } from './captcha.js';
import { damagedView } from './damaged.js';
import { outsideView } from './outside.js';
import { fetchBranches, fetchDisabledTabs } from './db.js';
import { store } from './store.js';
import * as auth from './auth.js';
import { esc, icons, toast, closeLayer } from './ui.js';
import { fittingView } from './fitting.js';
import { stockView } from './stock.js';
import { lensView } from './lens.js';
import { claimsView } from './claims.js';
import { settingsView } from './settings.js';
import { scheduleView, mountScheduleViewer } from './schedule.js';

const app = document.getElementById('app');
let view = null;          // active module view
let unsub = null;
let clockTimer = null;


// ─────────────────────────── LOGIN ───────────────────────────
// Before signing in, the only setting the page needs: which tabs are off.
let publicOff = [];
const scheduleOff = () => publicOff.includes('schedule');
const viewScheduleHTML = () => auth.isPractice ? '' : scheduleOff()
  ? `<span class="btn btn-ghost lp-view is-off" aria-disabled="true" title="The schedule is under maintenance">${icons.calendar} View schedule <i>— under maintenance</i></span>`
  : `<a class="btn btn-ghost lp-view" href="#/view-schedule">${icons.calendar} View schedule</a>`;
// Refresh the list, and redraw the button if it changed while the page was open.
function refreshPublicOff() {
  fetchDisabledTabs().then(list => {
    const was = scheduleOff();
    publicOff = list;
    if (was !== scheduleOff()) app.querySelector('.lp-view')?.replaceWith(
      Object.assign(document.createElement('div'), { innerHTML: viewScheduleHTML() }).firstElementChild);
  }).catch(() => { /* keep what we had */ });
}

function renderLogin(preselect = null) {
  teardownShell();
  refreshPublicOff();
  // The office and Ghiath sit on their own panel above the rest; the other
  // three run side by side so every location is on screen at once.
  const columns = [
    { wide: true, groups: [['Retail branches', 'retail']] },
    { groups: [['Fitting centres', 'fitting']] },
    { groups: [['Clinics', 'clinic']] },
  ];
  const groupHTML = ([title, roles], extra = '') => `
    <div class="lp-group ${extra}">
      <h3>${title}</h3>
      <div class="lp-grid">
        ${LOCATIONS.filter(l => l.active !== false && [].concat(roles).includes(l.role)).map(l => `
          <button class="loc-card role-${l.role}" data-loc="${l.code}">
            <span class="loc-code">${l.code}</span>
            <span class="loc-name">${esc(l.name)}</span>
          </button>`).join('')}
      </div>
    </div>`;
  app.innerHTML = `
  <div class="login">
    <div class="login-mark"><img src="img/foc-logomark.png" alt=""></div>
    <img class="lp-logo" src="img/foc-logo-horizontal.png" alt="Finland Optical Center">
    ${viewScheduleHTML()}
    <main class="login-panel">
      <div class="lp-inner">
        <section class="lp-step" id="step-pick">
          <header class="lp-head">
            <h2>Sign in</h2>
            <p class="lp-sub">${auth.isPractice ? 'Admin Demo — pick a branch, no code needed.' : 'Choose your location.'}</p>
          </header>
          ${auth.isPractice ? '' : groupHTML(['Office', ['admin', 'scheduler', 'manager']], 'lp-wh')}
          <div class="lp-cols">
            ${columns.map(c => `
              <div class="lp-col${c.wide ? ' wide' : ''}">${c.groups.map(g => groupHTML(g)).join('')}</div>`).join('')}
          </div>
        </section>

        <section class="lp-step" id="step-code" hidden></section>
      </div>
    </main>
  </div>`;

  // Picking a location swaps the grid for the code box, so the field is always
  // in view — it used to sit below a long list and need scrolling to reach.
  app.querySelectorAll('[data-loc]').forEach(btn => btn.addEventListener('click', () => {
    if (auth.isPractice) return practiceSignIn(btn.dataset.loc);
    showCodeStep(btn.dataset.loc);
  }));
  if (preselect) showCodeStep(preselect);
}

// ── Admin Demo, the practice copy (?AdminDemo=SCC, js/demo.js) ──
// No codes: the database is this browser's own. Picking a location opens it,
// so one person can play every side of a job — send from Seeb, receive at MGM.
async function practiceSignIn(code) {
  const { branch, error } = await auth.signIn(code, 'practice');
  if (!branch) { toast({ title: 'Could not open that location', sub: error ?? '', tone: 'stock' }); return; }
  store.session = branch;
  location.hash = homeOf(branch);
  await enterShell();
}
function practiceBar() {
  if (!auth.isPractice || document.querySelector('.practice-bar')) return;
  const bar = document.createElement('div');
  bar.className = 'practice-bar';
  bar.innerHTML = `<b>Admin Demo</b><span>Saved in this browser only — nothing here is real</span>
    <button type="button" data-practice-reset>Start over</button>`;
  bar.querySelector('[data-practice-reset]').addEventListener('click', async () => {
    if (!confirm('Start over?\n\nEverything entered in this Admin Demo is deleted.')) return;
    store.stop();
    await (await import('./demo.js')).resetPractice();
    location.reload();
  });
  document.body.append(bar);
}

function showCodeStep(code) {
  const pick = app.querySelector('#step-pick');
  const step = app.querySelector('#step-code');
  pick.hidden = true;
  step.hidden = false;
  step.innerHTML = pinHTML(code);
  step.querySelector('[data-back]')?.addEventListener('click', () => {
    step.hidden = true;
    pick.hidden = false;
  });
  wirePin(code);
}

function pinHTML(code) {
  const l = loc(code);
  return `
    <button class="lp-back" data-back>${icons.chevronRight}Change location</button>
    <div class="pin-card">
      <div class="pin-who"><span class="loc-chip">${code}</span> ${esc(l.name)} <em>· ${ROLES[l.role].label}</em></div>
      <form id="pin-form" autocomplete="off">
        <input id="pin-input" inputmode="numeric" autocomplete="one-time-code"
               maxlength="6" pattern="\\d{6}" placeholder="••••••" aria-label="Six digit code" autofocus>
        <button class="btn btn-primary" type="submit" id="pin-go">Sign in ${icons.arrowRight}</button>
      </form>
      <div class="pin-captcha" id="pin-captcha"></div>
      <div class="pin-err" id="pin-err"></div>
    </div>`;
}


function wirePin(code) {
  const form = app.querySelector('#pin-form');
  const input = app.querySelector('#pin-input');
  const btn = app.querySelector('#pin-go');
  const err = app.querySelector('#pin-err');
  input?.focus();
  // The bot check, when it is switched on (js/captcha.js).
  let cap = null;
  mountCaptcha(app.querySelector('#pin-captcha')).then(c => { cap = c; }).catch(e => { err.textContent = e.message; });

  form?.addEventListener('submit', async e => {
    e.preventDefault();
    const entered = input.value.trim();
    err.textContent = '';
    if (!/^\d{6}$/.test(entered)) {
      err.textContent = 'The code is six digits.';
      return;
    }
    // The check happens on Supabase's servers, so the button has to wait.
    btn.disabled = true;
    input.disabled = true;
    const was = btn.innerHTML;
    btn.textContent = 'Checking…';

    let token = null;
    if (captchaOn()) {
      try { token = await (cap ?? await mountCaptcha(app.querySelector('#pin-captcha'))).token(); }
      catch (ex) { btn.disabled = false; input.disabled = false; btn.innerHTML = was; err.textContent = ex.message; return; }
    }
    const { branch, error } = await auth.signIn(code, entered, token);
    cap?.reset();   // a token is good for one attempt

    if (branch) {
      store.session = branch;
      location.hash = homeOf(branch);
      enterShell();
      return;
    }
    btn.disabled = false;
    input.disabled = false;
    btn.innerHTML = was;
    err.textContent = error;
    form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake');
    input.select();
  });
}

// ─────────────────────────── PUBLIC SCHEDULE ───────────────────────────
// This week's rota for anyone with the address, so staff can check their
// shifts without a code. It reads one database function that hands out the
// running week and nothing else.
const isPublicRoute = () => location.hash === '#/view-schedule';

function renderPublicSchedule() {
  teardownShell();
  app.innerHTML = `
  <div class="pub">
    <header class="pub-head">
      <img class="pub-logo" src="img/foc-logo-horizontal.png" alt="Finland Optical Center">
      <div class="pub-title">
        <h1>Staff schedule</h1>
        <p class="mod-sub" id="pub-sub">This week</p>
      </div>
      <a class="btn btn-ghost btn-sm" href="#/">Sign in ${icons.arrowRight}</a>
    </header>
    <main class="pub-body" id="pub-stage"></main>
  </div>`;
  // Switched off by the office: say so instead of showing the rota.
  if (scheduleOff()) {
    app.querySelector('#pub-sub').textContent = 'Under maintenance';
    app.querySelector('#pub-stage').innerHTML = `<div class="empty">${icons.calendar}<p>The schedule is under maintenance — please check back later.</p></div>`;
    return;
  }
  mountScheduleViewer(app.querySelector('#pub-stage'), app.querySelector('#pub-sub'));
}

// ─────────────────────────── LOADING ───────────────────────────
// Records live in Postgres now, so there is a moment between proving who you
// are and having anything to show. Say so rather than flashing an empty grid.
function renderLoading(msg = 'Loading your branch…') {
  app.innerHTML = `
  <div class="login">
    <div class="login-mark"><img src="img/foc-logomark.png" alt=""></div>
    <img class="lp-logo" src="img/foc-logo-horizontal.png" alt="Finland Optical Center">
    <main class="login-panel">
      <div class="lp-inner lp-center">
        <div class="boot"><span class="boot-spin"></span>${esc(msg)}</div>
      </div>
    </main>
  </div>`;
}

function renderLoadError(detail, retry) {
  app.innerHTML = `
  <div class="login">
    <div class="login-mark"><img src="img/foc-logomark.png" alt=""></div>
    <img class="lp-logo" src="img/foc-logo-horizontal.png" alt="Finland Optical Center">
    <main class="login-panel">
      <div class="lp-inner lp-center">
        <div class="pin-card boot-err">
          <h2>Can't reach the server</h2>
          <p class="muted">${esc(detail)}</p>
          <div class="form-foot">
            <button class="btn btn-ghost" id="boot-out">Sign out</button>
            <button class="btn btn-primary" id="boot-retry">Try again</button>
          </div>
        </div>
      </div>
    </main>
  </div>`;
  app.querySelector('#boot-retry').addEventListener('click', retry);
  app.querySelector('#boot-out').addEventListener('click', async () => {
    await auth.signOut(); store.session = null; renderLogin();
  });
}

// Pull everything this branch may see, then show the app. Called after a fresh
// sign-in and after restoring a session.
async function enterShell() {
  teardownShell();   // in case a shell was already up: its subscription must go
  renderLoading();
  try {
    await store.load();
  } catch (e) {
    renderLoadError(String(e?.message ?? e), enterShell);
    return;
  }
  renderShell();
}

// ─────────────────────────── SHELL ───────────────────────────
const MODULES = {
  fitting:  { label: 'Fitting Log', icon: 'glasses', make: fittingView },
  stock:    { label: 'Stock Requests', icon: 'box', make: stockView, adminLabel: 'Office Queue', adminIcon: 'warehouse' },
  // Branches order shelf lenses inside a new fitting order now, so the tab is
  // for the branches that hold lenses, and the admins who look across
  // everything (user, 2026-10-17).
  lens:     { label: 'Lens Stock', icon: 'lens', make: lensView, only: me => isLensOwner(me?.code) || seesAll(me?.role) },
  outside:  { label: 'Outside Lens Orders', icon: 'truck', make: outsideView, only: me => me?.code === outsideHandler() || seesAll(me?.role) },
  claims:   { label: 'Reimbursement Invoice', icon: 'receipt', make: me => claimsView(me, 'claim') },
  direct:   { label: 'Direct Insurance', icon: 'shield', make: me => claimsView(me, 'direct') },
  damaged:  { label: 'Damaged Stock', icon: 'damage', make: damagedView },
  schedule: { label: 'Schedule', icon: 'calendar', make: scheduleView },
  settings: { label: 'Settings', icon: 'settings', make: settingsView, adminOnly: true },
};

// Where a location lands after signing in: Ghiath's work is the schedule.
const homeOf = me => (me?.role === 'scheduler' ? '#/schedule' : '#/fitting');

function moduleAllowed(key, me) {
  const m = MODULES[key];
  return m && (!m.adminOnly || me?.role === 'admin') && (!m.only || m.only(me)) && !(auth.isPractice && key === 'schedule');
}

// A tab the office switched off in Settings is closed to everyone else; the
// office can still open it, to see to whatever needed the maintenance.
const isOff = key => tabOff(store.state.settings, key);
const moduleOpen = (key, me) => moduleAllowed(key, me) && (me?.role === 'admin' || !isOff(key));

// When every tab this location may use is switched off, it lands here.
const OFF_KEY = 'maintenance';
const offView = () => ({
  mount(el) {
    el.innerHTML = `
      <header class="mod-head"><div><h1>Under maintenance</h1>
        <p class="mod-sub">The office is working on the portal — your tabs will be back shortly.</p></div></header>
      <div class="empty">${icons.settings}<p>Nothing is open right now. This page updates by itself when a tab is switched back on.</p></div>`;
  },
  onChange() {}, unmount() {},
});

function currentModule() {
  const me = store.session;
  const key = (location.hash.match(/#\/(\w+)/) ?? [])[1];
  if (moduleOpen(key, me)) return key;
  const home = homeOf(me).slice(2);
  if (moduleOpen(home, me)) return home;
  return Object.keys(MODULES).find(k => moduleOpen(k, me)) ?? OFF_KEY;
}

function badgeCounts(me) {
  // The schedule editor reads everything and is asked to do none of it.
  if (readOnly(me.role)) return {};
  const s = store.state;
  const fitting = s.orders.filter(o => canSeeOrder(o, me.code) && needsAction(o, me.code)).length;
  const stock = me.role === 'admin'
    ? s.requests.filter(r => r.status === 'placed').length
    : s.requests.filter(r => canSeeRequest(r, me.code) && r.status === 'placed').length;
  // Only the branch holding the lenses has something to act on here.
  const lens = isLensOwner(me.code)
    ? s.lensRequests.filter(r => r.holder === me.code && r.status === 'requested').length
    : 0;
  // Outside lenses waiting to be ordered are MGM's to do.
  // Outside lenses to order, and to send on, are the handler's to do.
  const outside = me.code === outsideHandler() ? (s.outsideOrders ?? []).filter(x =>
    x.status === 'to_order' || (!x.sentAt && x.branch !== me.code)).length : 0;
  return { fitting, stock, lens, outside };
}

// The sidebar folds to its icon rail and back. Remembered per browser — a
// convenience, so a blocked or empty storage just means it starts open.
const SIDE_KEY = 'focp.side.collapsed';
const sideCollapsed = () => { try { return localStorage.getItem(SIDE_KEY) === '1'; } catch { return false; } };
const rememberSide = on => { try { localStorage.setItem(SIDE_KEY, on ? '1' : '0'); } catch { /* fine */ } };

function renderShell() {
  teardownShell();
  const me = store.session;
  const mod = currentModule();
  app.innerHTML = `
    <div class="shell ${sideCollapsed() ? 'collapsed' : ''}">
      <nav class="side">
        <div class="side-logo">
          <button class="side-toggle" id="side-toggle" title="Fold the menu" aria-label="Fold the menu">${icons.menu}</button>
          <img class="side-wordmark" src="img/foc-portal-white-v2.png" alt="FOC Portal">
          <img class="side-mark" src="img/foc-portal-mark-white.png" alt="FOC Portal">
        </div>
        <div class="side-nav" id="nav"></div>
        <div class="side-foot">
          <div class="live-ind${auth.isPractice ? ' is-practice' : ''}"><i></i>${auth.isPractice ? 'Admin Demo' : 'Live · synced'}</div>
          <div class="me-card">
            <span class="me-code role-${me.role}">${me.code}</span>
            <div class="me-meta">
              <b>${esc(me.name)}</b>
              <span>${ROLES[me.role].label}</span>
            </div>
          </div>
          <div class="side-actions">
            <button class="side-link" id="signout">${icons.logout}<span>Sign out</span></button>
          </div>
        </div>
      </nav>
      <main class="content" id="content"></main>
    </div>`;

  renderNav(me, mod);
  app.querySelector('#side-toggle').addEventListener('click', () => {
    const shell = app.querySelector('.shell');
    const on = !shell.classList.contains('collapsed');
    shell.classList.toggle('collapsed', on);
    rememberSide(on);
  });
  app.querySelector('#signout').addEventListener('click', () => {
    auth.signOut(); store.stop(); store.session = null; closeLayer(); renderLogin();
  });
  mountModule(mod);

  const shellRole = me.role;
  unsub = store.subscribe(event => {
    // The office closed this branch, or changed what it is: sign out, or
    // rebuild the portal for its new kind.
    const now = store.session;
    if (now && now.active === false) {
      auth.signOut(); store.stop(); store.session = null; closeLayer(); renderLogin();
      toast({ title: 'This branch has been closed', sub: 'Ask the office if that is a mistake.', tone: 'stock' });
      return;
    }
    if (now && now.role !== shellRole) { renderShell(); return; }
    // A tab switched off while someone is on it moves them to one still open.
    const next = currentModule();
    if (next !== mountedKey) mountModule(next);
    else { renderNav(store.session, next); view?.onChange(event); }
    if (event?.remote && event.title && event.module !== 'system') {
      const relevant =
        (event.module === 'fitting' && event.refs?.some(id => { const o = store.state.orders.find(x => x.id === id); return o && canSeeOrder(o, me.code); })) ||
        (event.module === 'stock' && event.refs?.some(id => { const r = store.state.requests.find(x => x.id === id); return r && canSeeRequest(r, me.code); })) ||
        (event.module === 'lens' && event.refs?.some(id => { const r = store.state.lensRequests.find(x => x.id === id); return r && canSeeLensRequest(r, me.code); }));
      const tone = event.module === 'fitting' ? 'info' : event.module === 'lens' ? 'lens' : 'stock';
      if (relevant) toast({ title: event.title, sub: event.sub ?? '', tone });
    }
  });
  clockTimer = setInterval(() => view?.onChange(), 45e3); // keep relative times fresh
}

function renderNav(me, active) {
  const nav = app.querySelector('#nav');
  if (!nav) return;
  const b = badgeCounts(me);
  nav.innerHTML = Object.entries(MODULES).filter(([key]) => moduleAllowed(key, me)).map(([key, m]) => {
    const label = (me.role === 'admin' || readOnly(me.role)) && m.adminLabel ? m.adminLabel : m.label;
    const icon = icons[me.role === 'admin' && m.adminIcon ? m.adminIcon : m.icon];
    // Switched off: greyed, and said so. Only the office can still go in.
    if (isOff(key)) {
      const inner = `${icon}<span>${label} <i class="nav-off-note">— under maintenance</i></span>`;
      const title = `${esc(label)} — under maintenance`;
      return me.role === 'admin'
        ? `<a class="nav-item nav-off ${active === key ? 'on' : ''}" href="#/${key}" title="${title}">${inner}</a>`
        : `<span class="nav-item nav-off" aria-disabled="true" title="${title}">${inner}</span>`;
    }
    return `
      <a class="nav-item ${active === key ? 'on' : ''}" href="#/${key}" title="${esc(label)}">
        ${icon}<span>${label}</span>
        ${b[key] ? `<em class="nav-badge">${b[key]}</em>` : ''}
      </a>`;
  }).join('');
}

let mountedKey = null;

function mountModule(key) {
  view?.unmount();
  closeLayer();
  const me = store.session;
  view = key === OFF_KEY ? offView() : MODULES[key].make(me);
  // Swap in a fresh content node so listeners from the previous view die with it.
  const old = app.querySelector('#content');
  const content = old.cloneNode(false);
  old.replaceWith(content);
  content.classList.remove('mod-in'); void content.offsetWidth; content.classList.add('mod-in');
  view.mount(content);
  mountedKey = key;
  // Sent elsewhere (a closed tab, say): the address says where they really are.
  if (key !== OFF_KEY && location.hash !== `#/${key}`) history.replaceState(null, '', `#/${key}`);
  renderNav(me, key);
}

function teardownShell() {
  unsub?.(); unsub = null;
  clearInterval(clockTimer); clockTimer = null;
  view?.unmount(); view = null;
}

// Re-route inside the shell on hash change without a full shell rebuild.
window.addEventListener('hashchange', () => {
  if (!store.session) {
    if (isPublicRoute()) renderPublicSchedule();
    else if (app.querySelector('.pub')) renderLogin();
    return;
  }
  // Signed in already: the schedule is in the portal itself.
  if (isPublicRoute()) { location.hash = '#/schedule'; return; }
  if (app.querySelector('.shell') && currentModule() !== mountedKey) mountModule(currentModule());
});

// ── presenter mode ──
// For recording tutorials: ?present switches it on for the tab, ?present=0
// off. Everyone else never downloads it.
function presenterWanted() {
  const q = new URLSearchParams(location.search).get('present');
  try {
    if (q === '0') sessionStorage.removeItem('focp.present');
    else if (q !== null) sessionStorage.setItem('focp.present', '1');
    return sessionStorage.getItem('focp.present') === '1';
  } catch {
    return q !== null && q !== '0';
  }
}

// How presenter mode changes branch between chapters. It is the sign-in form
// without the form — the same auth.signIn, so it opens no door the form does
// not. Signing in replaces the session; if the code is refused, the branch
// that was signed in stays signed in and its screen comes back.
async function switchBranch(code, pin) {
  store.stop();
  teardownShell();
  closeLayer();
  const { branch, error } = await auth.signIn(code, pin);
  if (!branch) {
    if (store.session) await enterShell();
    throw new Error(error || 'sign-in refused');
  }
  store.session = branch;
  location.hash = homeOf(branch);
  await enterShell();
  return branch;
}

// ── boot ──
// Restoring a session asks Supabase and loading the data asks Postgres, so
// this is asynchronous now.
(async () => {
  if (presenterWanted()) {
    import('./present.js')
      .then(m => m.start({ switchBranch }))
      .catch(e => console.error('presenter mode failed to load', e));
  }
  renderLoading('Checking your session…');
  // The locations come from the database; if it cannot be reached, the
  // built-in list stands in until it can.
  try { setLocations(await fetchBranches()); } catch { /* fallback list */ }
  try { publicOff = await fetchDisabledTabs(); } catch { /* assume all on */ }
  store.session = await auth.currentBranch();
  practiceBar();
  // Practice copy: branches only — a person's session left from before is closed.
  if (auth.isPractice && store.session && !BRANCH_KINDS.includes(store.session.role)) { await auth.signOut(); store.session = null; }
  if (!store.session && auth.isPractice && BRANCH_KINDS.includes(loc(String(auth.PRACTICE).toUpperCase())?.role)) {
    await practiceSignIn(String(auth.PRACTICE).toUpperCase());
  } else if (store.session) {
    if (isPublicRoute()) location.hash = '#/schedule';
    await enterShell();
  } else if (isPublicRoute()) renderPublicSchedule();
  else renderLogin();

  // Follow the user out if they sign out in another tab, or their session expires.
  auth.onAuthChange((branch, event) => {
    if (event === 'SIGNED_OUT' || (!branch && store.session)) {
      store.stop();
      store.session = null;
      teardownShell();
      closeLayer();
      renderLogin();
    }
  });
})();
