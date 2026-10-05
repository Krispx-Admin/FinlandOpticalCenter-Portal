// ── App shell: login, sidebar navigation, routing, live toasts ──
import { LOCATIONS, ROLES, loc, canSeeOrder, canSeeRequest, canSeeLensRequest, canAdvanceOrder, isLensOwner } from './data.js';
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
  const groups = [
    ['Retail branches', 'retail'],
    ['Fitting centres', 'fitting'],
    ['Clinics', 'clinic'],
    ['Warehouse', 'admin'],
  ];
  app.innerHTML = `
  <div class="login">
    <aside class="login-brand">
      <div class="lb-inner">
        <div class="logo">${icons.glasses}<span>FOC<b>Portal</b></span></div>
        <h1>One live board for the whole network.</h1>
        <p>Fitting hand-offs and warehouse stock — every branch, fitting centre
           and the warehouse looking at the same records, in real time.</p>
        <div class="lb-live"><i></i> Live · shared across all locations</div>
      </div>
    </aside>
    <main class="login-panel">
      <div class="lp-inner">
        <h2>Sign in as your location</h2>
        <p class="lp-sub">Pick your location, then enter its 6-digit code.</p>
        ${groups.map(([title, role]) => `
          <div class="lp-group">
            <h3>${title}</h3>
            <div class="lp-grid">
              ${LOCATIONS.filter(l => l.role === role).map(l => `
                <button class="loc-card role-${l.role} ${preselect === l.code ? 'sel' : ''}" data-loc="${l.code}">
                  <span class="loc-code">${l.code}</span>
                  <span class="loc-name">${esc(l.name)}</span>
                </button>`).join('')}
            </div>
          </div>`).join('')}
        <div class="pin-area ${preselect ? 'open' : ''}" id="pin-area">
          ${preselect ? pinHTML(preselect) : ''}
        </div>
      </div>
    </main>
  </div>`;

  // Turnstile only loads when a site key is configured.
  if (auth.captchaEnabled() && !document.getElementById('cf-turnstile-js')) {
    const sc = document.createElement('script');
    sc.id = 'cf-turnstile-js';
    sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    sc.async = true;
    document.head.appendChild(sc);
  }

  app.querySelectorAll('[data-loc]').forEach(btn => btn.addEventListener('click', () => {
    app.querySelectorAll('.loc-card').forEach(b => b.classList.toggle('sel', b === btn));
    const area = app.querySelector('#pin-area');
    area.classList.add('open');
    area.innerHTML = pinHTML(btn.dataset.loc);
    wirePin(btn.dataset.loc);
  }));
  if (preselect) wirePin(preselect);
}

function pinHTML(code) {
  const l = loc(code);
  return `
    <div class="pin-card">
      <div class="pin-who"><span class="loc-chip">${code}</span> ${esc(l.name)} <em>· ${ROLES[l.role].label}</em></div>
      <form id="pin-form" autocomplete="off">
        <input id="pin-input" inputmode="numeric" autocomplete="one-time-code"
               maxlength="6" pattern="\\d{6}" placeholder="••••••" aria-label="Six digit code" autofocus>
        <button class="btn btn-primary" type="submit" id="pin-go">Sign in ${icons.arrowRight}</button>
      </form>
      ${auth.captchaEnabled() ? `<div class="cf-turnstile" data-sitekey="${auth.captchaSiteKey()}" data-callback="focCaptcha"></div>` : ''}
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

    const { branch, error } = await auth.signIn(code, entered, window.__focCaptchaToken);

    if (branch) {
      store.session = branch;
      location.hash = '#/fitting';
      renderShell();
      return;
    }
    btn.disabled = false;
    input.disabled = false;
    btn.innerHTML = was;
    err.textContent = error;
    form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake');
    input.select();
    window.__focCaptchaToken = undefined;
    window.turnstile?.reset?.();
  });
}

// Turnstile hands its token back through a global callback.
window.focCaptcha = token => { window.__focCaptchaToken = token; };

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
  const fitting = s.orders.filter(o => o.status !== 'delivered' && canSeeOrder(o, me.code) && canAdvanceOrder(o, me.code) && !(o.status === 'pending' && o.fitter)).length;
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
        <div class="logo side-logo">${icons.glasses}<span>FOC<b>Portal</b></span></div>
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
    auth.signOut(); store.session = null; closeLayer(); renderLogin();
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

// ── boot ──
// Restoring a session asks Supabase, so this is asynchronous now.
(async () => {
  store.session = await auth.currentBranch();
  if (store.session) renderShell(); else renderLogin();

  // Follow the user out if they sign out in another tab, or their session expires.
  auth.onAuthChange((branch, event) => {
    if (event === 'SIGNED_OUT' || (!branch && store.session)) {
      store.session = null;
      teardownShell();
      closeLayer();
      renderLogin();
    }
  });
})();
