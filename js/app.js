// ── App shell: login, sidebar navigation, routing, live toasts ──
import { LOCATIONS, ROLES, loc, canSeeOrder, canSeeRequest, canSeeLensRequest, needsAction, isLensOwner } from './data.js';
import { store } from './store.js';
import * as auth from './auth.js';
import { esc, icons, toast, closeLayer } from './ui.js';
import { fittingView } from './fitting.js';
import { stockView } from './stock.js';
import { lensView } from './lens.js';
import { claimsView } from './claims.js';
import { settingsView } from './settings.js';

const app = document.getElementById('app');
let view = null;          // active module view
let unsub = null;
let clockTimer = null;


// ─────────────────────────── LOGIN ───────────────────────────
function renderLogin(preselect = null) {
  teardownShell();
  // The warehouse sits on its own wide panel above the rest; the other three
  // run side by side so every location is on screen at once.
  const columns = [
    { wide: true, groups: [['Retail branches', 'retail']] },
    { groups: [['Fitting centres', 'fitting']] },
    { groups: [['Clinics', 'clinic']] },
  ];
  const groupHTML = ([title, role], extra = '') => `
    <div class="lp-group ${extra}">
      <h3>${title}</h3>
      <div class="lp-grid">
        ${LOCATIONS.filter(l => l.role === role).map(l => `
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
    <main class="login-panel">
      <div class="lp-inner">
        <section class="lp-step" id="step-pick">
          <header class="lp-head">
            <h2>Sign in</h2>
            <p class="lp-sub">Choose your location.</p>
          </header>
          ${groupHTML(['Warehouse', 'admin'], 'lp-wh')}
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
    showCodeStep(btn.dataset.loc);
  }));
  if (preselect) showCodeStep(preselect);
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
      <div class="pin-err" id="pin-err"></div>
    </div>`;
}

function wirePin(code) {
  const form = app.querySelector('#pin-form');
  const input = app.querySelector('#pin-input');
  const btn = app.querySelector('#pin-go');
  const err = app.querySelector('#pin-err');
  input?.focus();

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

    const { branch, error } = await auth.signIn(code, entered);

    if (branch) {
      store.session = branch;
      location.hash = '#/fitting';
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
  stock:    { label: 'Stock Requests', icon: 'box', make: stockView, adminLabel: 'Warehouse Queue', adminIcon: 'warehouse' },
  lens:     { label: 'Lens Stock', icon: 'lens', make: lensView },
  claims:   { label: 'Insurance Claims', icon: 'receipt', make: claimsView },
  settings: { label: 'Settings', icon: 'settings', make: settingsView, adminOnly: true },
};

function moduleAllowed(key, me) {
  const m = MODULES[key];
  return m && (!m.adminOnly || me?.role === 'admin');
}

function currentModule() {
  const key = (location.hash.match(/#\/(\w+)/) ?? [])[1];
  return moduleAllowed(key, store.session) ? key : 'fitting';
}

function badgeCounts(me) {
  const s = store.state;
  const fitting = s.orders.filter(o => canSeeOrder(o, me.code) && needsAction(o, me.code)).length;
  const stock = me.role === 'admin'
    ? s.requests.filter(r => r.status === 'placed').length
    : s.requests.filter(r => canSeeRequest(r, me.code) && r.status === 'placed').length;
  // Only the branch holding the lenses has something to act on here.
  const lens = isLensOwner(me.code)
    ? s.lensRequests.filter(r => r.status === 'requested').length
    : 0;
  return { fitting, stock, lens };
}

function renderShell() {
  teardownShell();
  const me = store.session;
  const mod = currentModule();
  app.innerHTML = `
    <div class="shell">
      <nav class="side">
        <div class="side-logo">
          <img class="side-wordmark" src="img/foc-portal-white.png" alt="FOC Portal">
          <img class="side-mark" src="img/foc-portal-mark-white.png" alt="FOC Portal">
        </div>
        <div class="side-nav" id="nav"></div>
        <div class="side-foot">
          <div class="live-ind"><i></i>Live · synced</div>
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
  app.querySelector('#signout').addEventListener('click', () => {
    auth.signOut(); store.stop(); store.session = null; closeLayer(); renderLogin();
  });
  mountModule(mod);

  unsub = store.subscribe(event => {
    renderNav(store.session, currentModule());
    view?.onChange(event);
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
    const label = me.role === 'admin' && m.adminLabel ? m.adminLabel : m.label;
    const icon = icons[me.role === 'admin' && m.adminIcon ? m.adminIcon : m.icon];
    return `
      <a class="nav-item ${active === key ? 'on' : ''}" href="#/${key}">
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
  view = MODULES[key].make(me);
  // Swap in a fresh content node so listeners from the previous view die with it.
  const old = app.querySelector('#content');
  const content = old.cloneNode(false);
  old.replaceWith(content);
  content.classList.remove('mod-in'); void content.offsetWidth; content.classList.add('mod-in');
  view.mount(content);
  mountedKey = key;
  renderNav(me, key);
}

function teardownShell() {
  unsub?.(); unsub = null;
  clearInterval(clockTimer); clockTimer = null;
  view?.unmount(); view = null;
}

// Re-route inside the shell on hash change without a full shell rebuild.
window.addEventListener('hashchange', () => {
  if (store.session && app.querySelector('.shell') && currentModule() !== mountedKey) mountModule(currentModule());
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
  location.hash = '#/fitting';
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
  store.session = await auth.currentBranch();
  if (store.session) await enterShell(); else renderLogin();

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
