// ── Presenter mode: what a recorded tutorial needs, and nothing else ──
//
// Loaded only when the address carries ?present (see app.js), and off again
// with ?present=0. It adds no capability to the portal: every effect is drawn
// over the page, every click is the same click a person would make, and
// changing branch goes through the same sign-in the form uses.
//
//   present.point(t)          glide the cursor onto something
//   present.tap(t)            point at it, ripple, and click it
//   present.type(t, text)     type into a field at reading pace
//   present.choose(t, opt)    pick an option in a <select>
//   present.focus(t, opts)    spotlight it and zoom towards it  { zoom, pad }
//   present.reset()           zoom back out and drop the spotlight
//   present.caption(a, b)     lower-third caption; no argument clears it
//   present.card(a, b, k)     full-screen chapter card; no argument hides it
//   present.pins({ SCC: … })  hand over sign-in codes — memory only, never shown
//   present.as(code, card)    switch branch behind a chapter card
//   present.wait(ms)
//   present.run(steps)        play a list of the calls above as one take
//   present.play(chapter)     play a chapter of the built-in tour (tour.js)
//   present.playAll(from)     play every chapter from there to the end
//   present.resume()          carry on from the step that failed
//   present.status()          how far a running take has got
//
// Alt+P opens a small control panel with the same buttons, for whoever is
// recording without a console. It is off-screen in the video unless open.
//
// A target is a CSS selector, or text that is visible on screen. "A >> B"
// means B inside whatever holds A: "DEMO-1231 >> Send to fitter".
import { TOUR, CHAPTERS } from './tour.js';

const CTX_KEY = 'focp.present.ctx';
const pins = {};                       // sign-in codes: held in memory, nowhere else
let switchBranch = null;
let host, cursor, cap, card, spot;
let view = { s: 1, tx: 0, ty: 0 };    // the page's current zoom
let at = { x: innerWidth / 2, y: innerHeight / 2 };
let job = { running: false, chapter: null, step: 0, total: 0, error: null, done: false };
let ctx = loadCtx();

const wait = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

export function start(hooks) {
  switchBranch = hooks.switchBranch;
  document.documentElement.classList.add('presenting');
  injectStyle();
  buildLayers();
  // Clicks the recording agent makes itself still need to read on video.
  addEventListener('pointerdown', e => {
    if (!e.isTrusted || e.target.closest?.('.pz-panel')) return;
    moveCursor(e.clientX, e.clientY, true);
    ripple(e.clientX, e.clientY);
  }, true);
  addEventListener('pointermove', e => { if (e.isTrusted) moveCursor(e.clientX, e.clientY, true); }, true);
  addEventListener('keydown', e => {
    if (e.altKey && e.code === 'KeyP') { e.preventDefault(); togglePanel(); }
  }, true);
  window.present = api;
  console.info('[present] ready — chapters:', CHAPTERS.join(', '));
}

// ── finding things ──────────────────────────────────────────────────────────

// What a person would think of as "the button", when the text they can read
// sits in a span or a <b> inside it.
const PRESSABLE = 'button, a[href], label, [role="button"], select, input, textarea, '
  + '.loc-card, .picker-card, .chip, .nav-item, .fulfil-opt, .row, .lens-card, .set-brand';

function visible(el) {
  if (el.closest('[hidden], .layer-overlay:not(.open), #pz-host, #toasts')) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
}

function byText(text, scope) {
  const needle = norm(text);
  if (!needle) return null;
  let best = null, bestScore = Infinity;
  for (const el of scope.querySelectorAll('*')) {
    if (/^(SCRIPT|STYLE|TEMPLATE|OPTION)$/.test(el.tagName)) continue;
    const t = norm(el.textContent);
    if (!t.includes(needle) || !visible(el)) continue;
    const r = el.getBoundingClientRect();
    const score = r.width * r.height * (t === needle ? 0.5 : 1);
    if (score < bestScore) { best = el; bestScore = score; }
  }
  if (!best) return null;
  for (let up = best, i = 0; up && i < 4; up = up.parentElement, i++) {
    if (up.matches(PRESSABLE)) return up;
  }
  return best;
}

function one(q, scope, inclusive = false) {
  if (q.startsWith('text=')) return byText(q.slice(5), scope);
  try {
    if (inclusive && scope.matches?.(q) && visible(scope)) return scope;
    const hit = [...scope.querySelectorAll(q)].find(visible);
    if (hit) return hit;
  } catch { /* not a selector at all — "Review & request" — so it is text */ }
  // "Settings" is a valid selector that matches nothing, so a miss falls
  // through to text either way.
  return byText(q, scope);
}

function find(spec) {
  const parts = String(spec).split('>>').map(s => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  // With a modal or drawer open, that is where the eye is: look there first.
  const layers = [...document.querySelectorAll('.layer-overlay.open')];
  const scopes = layers.length ? [layers[layers.length - 1], document] : [document];
  for (const scope of scopes) {
    let el = one(parts[0], scope);
    for (const p of parts.slice(1)) {
      if (!el) break;
      let hit = null;
      for (let anc = el; anc && anc !== document.documentElement && !hit; anc = anc.parentElement) {
        hit = one(p, anc, true);
      }
      el = hit;
    }
    if (el) return el;
  }
  return null;
}

async function resolve(t, timeout = 6000) {
  if (t == null || t === '') throw new Error('no target given');
  const until = Date.now() + timeout;
  for (;;) {
    const el = find(t);
    if (el) return el;
    if (Date.now() > until) throw new Error(`nothing on screen matches "${t}"`);
    await wait(120);
  }
}

// ── drawing ─────────────────────────────────────────────────────────────────

function moveCursor(x, y, instant = false) {
  at = { x, y };
  cursor.style.transition = instant ? 'none' : '';
  cursor.style.transform = `translate(${x}px, ${y}px)`;
}

function ripple(x, y) {
  const r = document.createElement('i');
  r.className = 'pz-ripple';
  r.style.left = `${x}px`;
  r.style.top = `${y}px`;
  host.appendChild(r);
  setTimeout(() => r.remove(), 800);
  cursor.classList.add('press');
  setTimeout(() => cursor.classList.remove('press'), 180);
}

function centreOf(el) {
  const v = el.getBoundingClientRect();
  return { x: v.left + v.width / 2, y: v.top + v.height / 2 };
}

// The page's own coordinates for an element, undoing the current zoom, so the
// spotlight (which lives inside the zoomed page) lands on it.
function pageRect(el, pad) {
  const v = el.getBoundingClientRect();
  return {
    x: (v.left - view.tx) / view.s - pad, y: (v.top - view.ty) / view.s - pad,
    w: v.width / view.s + pad * 2, h: v.height / view.s + pad * 2,
  };
}

function setView(s, tx, ty) {
  view = { s, tx, ty };
  document.body.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
}

// ── the calls ───────────────────────────────────────────────────────────────

async function point(t) {
  const el = await resolve(t);
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  await wait(120);
  const c = centreOf(el);
  moveCursor(c.x, c.y);
  await wait(720);
  return el;
}

async function tap(t) {
  const el = await point(t);
  const c = centreOf(el);
  ripple(c.x, c.y);
  await wait(140);
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) el.focus();
  el.click();
  await wait(480);
  return true;
}

function setValue(el, v) {
  el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function type(t, text, { cps = 15 } = {}) {
  const el = await point(t);
  const c = centreOf(el);
  ripple(c.x, c.y);
  el.focus();
  setValue(el, '');
  text = String(text ?? '');
  // A number or date field rejects half-typed values like "-", so those are
  // filled in one go after a beat rather than letter by letter.
  if (/^(number|date)$/.test(el.type)) {
    await wait(380);
    setValue(el, text);
  } else {
    for (const ch of text) {
      setValue(el, el.value + ch);
      await wait(1000 / cps * (0.7 + Math.random() * 0.6));
    }
  }
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(260);
  return true;
}

async function choose(t, option) {
  const el = await point(t);
  const c = centreOf(el);
  ripple(c.x, c.y);
  const want = norm(option);
  const opt = [...el.options].find(o => norm(o.textContent) === want || norm(o.value) === want)
    ?? [...el.options].find(o => norm(o.textContent).includes(want));
  if (!opt) throw new Error(`"${t}" has no option "${option}"`);
  await wait(250);
  el.value = opt.value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(420);
  return true;
}

async function focus(t, { zoom, pad = 8 } = {}) {
  const el = await resolve(t);
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  await wait(160);
  const r = pageRect(el, pad);
  spot.style.left = `${r.x}px`;
  spot.style.top = `${r.y}px`;
  spot.style.width = `${r.w}px`;
  spot.style.height = `${r.h}px`;
  spot.classList.add('on');
  const W = innerWidth, H = innerHeight;
  const s = zoom ?? clamp(Math.min(0.62 * W / r.w, 0.62 * H / r.h), 1, 2.2);
  // Bring the element towards the middle, but never so far that the edge of
  // the page — and the blank beyond it — slides into view.
  const ex = r.x + r.w / 2, ey = r.y + r.h / 2;
  setView(s,
    clamp(W / 2 - s * ex, W - s * W, 0),
    clamp(H / 2 - s * ey, H - s * H, 0));
  await wait(820);
  return true;
}

async function reset() {
  spot.classList.remove('on');
  if (view.s !== 1 || view.tx || view.ty) {
    setView(1, 0, 0);
    await wait(760);
  }
  return true;
}

async function caption(title, sub) {
  if (!title) { cap.classList.remove('on'); await wait(200); return true; }
  const show = () => {
    cap.innerHTML = '';
    const b = document.createElement('b');
    b.textContent = title;
    cap.appendChild(b);
    if (sub) {
      const s = document.createElement('small');
      s.textContent = sub;
      cap.appendChild(s);
    }
    cap.classList.add('on');
  };
  if (cap.classList.contains('on')) {
    cap.classList.remove('on');
    await wait(220);
  }
  show();
  await wait(260);
  return true;
}

async function showCard(title, sub, kicker) {
  if (!title) { card.classList.remove('on'); await wait(560); return true; }
  card.querySelector('.pz-kicker').textContent = kicker ?? '';
  card.querySelector('h1').textContent = title;
  card.querySelector('p').textContent = sub ?? '';
  card.classList.add('on');
  await wait(600);
  return true;
}

function setPins(map = {}) {
  for (const [k, v] of Object.entries(map)) pins[String(k).toUpperCase()] = String(v);
  return Object.keys(pins);        // which codes are held — never the codes
}

async function typePin(code) {
  const pin = pins[String(code).toUpperCase()];
  if (!pin) throw new Error(`no code held for ${code} — call present.pins() first`);
  return type('#pin-input', pin, { cps: 7 });
}

// Change branch between chapters. The card covers the screen for the whole
// switch, so neither a sign-in form nor a code ever reaches the recording.
async function as(code, { title, sub, kicker, hold = 1700 } = {}) {
  code = String(code).toUpperCase();
  const pin = pins[code];
  if (!pin) throw new Error(`no code held for ${code} — call present.pins() first`);
  await caption();
  await showCard(title ?? code, sub, kicker);
  await reset();
  await switchBranch(code, pin);
  await wait(hold);
  await showCard();
  return true;
}

// Bill numbers are minted fresh for every take, so a second recording never
// trips over the first one's — they are unique per branch.
function newTake() {
  const n = String(100 + Math.floor(Math.random() * 900));
  ctx = {
    seebOrder: `DEMO-${n}1`, seebLens: `DEMO-${n}2`, seebClaim: `DEMO-${n}3`,
    moujLens: `DEMO-${n}4`, mgmOrder: `DEMO-${n}5`,
  };
  try { sessionStorage.setItem(CTX_KEY, JSON.stringify(ctx)); } catch { /* fine */ }
  return ctx;
}

function loadCtx() {
  try { return JSON.parse(sessionStorage.getItem(CTX_KEY)) ?? {}; } catch { return {}; }
}

const fill = v => (typeof v === 'string'
  ? v.replace(/\{(\w+)\}/g, (m, k) => ctx[k] ?? m)
  : v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)]))
    : v);

async function run(steps, { from = 0, chapter = null } = {}) {
  if (job.running) throw new Error('a take is already running — see present.status()');
  job = { running: true, chapter, step: from, total: steps.length, error: null, done: false };
  try {
    for (let i = from; i < steps.length; i++) {
      job.step = i;
      const [name, ...args] = steps[i];
      const fn = STEPS[name];
      if (!fn) throw new Error(`unknown step "${name}"`);
      await fn(...args.map(fill));
    }
    job.done = true;
  } catch (e) {
    job.error = `step ${job.step} ${JSON.stringify(steps[job.step])}: ${e.message}`;
    console.error('[present]', job.error);
  } finally {
    job.running = false;
  }
  return status();
}

function play(chapter, { from = 0 } = {}) {
  const steps = TOUR[chapter];
  if (!steps) throw new Error(`no chapter "${chapter}" — chapters are ${CHAPTERS.join(', ')}`);
  return run(steps, { from, chapter });
}

// The whole video in one go. Chapters hand over to each other with no one in
// between, so there is no pause to cut out.
let playingAll = false;
let lastWasAll = false;     // so resume knows whether to carry on past the chapter
async function playAll(from = CHAPTERS[0], { step = 0 } = {}) {
  const first = CHAPTERS.indexOf(from);
  if (first < 0) throw new Error(`no chapter "${from}" — chapters are ${CHAPTERS.join(', ')}`);
  playingAll = true;
  lastWasAll = true;
  try {
    for (let i = first; i < CHAPTERS.length; i++) {
      const s = await play(CHAPTERS[i], { from: i === first ? step : 0 });
      if (s.error) return s;
    }
  } finally {
    playingAll = false;
  }
  return status();
}

// Pick up at the step that failed — or the one after, if that step had in
// fact happened before something later in it gave up.
function resume({ skip = false } = {}) {
  if (job.running) throw new Error('still running');
  if (!job.error || !job.chapter) throw new Error('nothing to resume — no step has failed');
  const step = job.step + (skip ? 1 : 0);
  return lastWasAll
    ? playAll(job.chapter, { step })
    : play(job.chapter, { from: step });
}

function status() {
  return { ...job, playingAll, ctx: { ...ctx }, pinsHeld: Object.keys(pins) };
}

// What a step in a take may call. run and play are left out on purpose.
const STEPS = {
  point, tap, type, choose, focus, reset, caption, card: showCard, as, wait,
  typePin, newTake, waitFor: t => resolve(t, 20000),
};

const api = {
  ...STEPS, pins: setPins, run, status, playAll, resume,
  play: (chapter, opts) => { lastWasAll = false; return play(chapter, opts); },
  chapters: () => [...CHAPTERS],
  find: t => find(fill(t)),
};

// ── the control panel (Alt+P) ───────────────────────────────────────────────
// The same buttons as the console calls, for recording without one. The code
// fields are password fields and feed present.pins(); nothing is saved.

let panel = null, panelTimer = null;

function togglePanel(open = !panel?.classList.contains('on')) {
  if (!panel) buildPanel();
  panel.classList.toggle('on', open);
  clearInterval(panelTimer);
  if (open) { paintPanel(); panelTimer = setInterval(paintPanel, 500); }
}

function paintPanel() {
  const s = status();
  panel.querySelector('.pz-stat').textContent = s.running
    ? `Playing ${s.chapter} — step ${s.step + 1} of ${s.total}`
    : s.error ? `Stopped: ${s.error}`
    : s.done ? `Finished ${s.chapter}.` : 'Idle.';
  panel.querySelector('[data-pz="resume"]').disabled = s.running || !s.error;
  for (const b of panel.querySelectorAll('[data-pz="all"], [data-pz-ch]')) b.disabled = s.running;
}

function buildPanel() {
  panel = document.createElement('div');
  panel.className = 'pz-panel';
  panel.innerHTML = `
    <div class="pz-head"><b>Presenter</b><span>Alt+P hides this</span></div>
    <div class="pz-codes">${['SCC', 'MOUJ', 'MGM', 'WH'].map(c => `
      <label>${c}<input type="password" inputmode="numeric" maxlength="6" autocomplete="off" data-pin="${c}"></label>`).join('')}
    </div>
    <div class="pz-row">
      <button data-pz="all">▶ Play all</button>
      <button data-pz="resume">Resume</button>
    </div>
    <div class="pz-row pz-chaps">${CHAPTERS.map(c => `<button data-pz-ch="${c}">${c}</button>`).join('')}</div>
    <div class="pz-stat"></div>`;
  host.appendChild(panel);
  panel.addEventListener('input', e => {
    const c = e.target.dataset.pin;
    if (c) pins[c] = e.target.value.trim();
  });
  panel.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    // Out of the way before the first frame of the take.
    const go = fn => { togglePanel(false); setTimeout(fn, 400); };
    if (b.dataset.pz === 'all') go(() => playAll());
    else if (b.dataset.pz === 'resume') go(() => resume());
    else if (b.dataset.pzCh) go(() => api.play(b.dataset.pzCh));
  });
}

// ── the overlay ─────────────────────────────────────────────────────────────

function buildLayers() {
  host = document.createElement('div');
  host.id = 'pz-host';
  host.innerHTML = `
    <div class="pz-card">
      <img src="img/foc-portal-white.png" alt="">
      <span class="pz-kicker"></span><h1></h1><p></p>
    </div>
    <div class="pz-cap"></div>
    <div class="pz-cursor"><svg viewBox="0 0 24 24" width="28" height="28">
      <path d="M4 2.5 19.5 13l-7 1.4L9 21.2z" fill="#fff" stroke="#0f2a4d" stroke-width="1.6" stroke-linejoin="round"/>
    </svg></div>`;
  document.documentElement.appendChild(host);
  card = host.querySelector('.pz-card');
  cap = host.querySelector('.pz-cap');
  cursor = host.querySelector('.pz-cursor');
  spot = document.createElement('div');
  spot.className = 'pz-spot';
  document.body.appendChild(spot);
  moveCursor(at.x, at.y, true);
}

function injectStyle() {
  const s = document.createElement('style');
  s.textContent = `
html.presenting, html.presenting * { cursor: none !important; }
html.presenting { background: #f4f6fa; }
html.presenting body {
  transform-origin: 0 0; min-height: 100vh;
  transition: transform .78s cubic-bezier(.22,.8,.24,1);
}
/* the code is typed on camera; the digits are not */
html.presenting #pin-input, html.presenting .ba-set input { -webkit-text-security: disc; }
#pz-host { position: fixed; inset: 0; pointer-events: none; z-index: 2147483000;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.pz-cursor { position: absolute; left: -3px; top: -2px;
  transition: transform .68s cubic-bezier(.3,.75,.25,1); will-change: transform;
  filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); }
.pz-cursor svg { display: block; transition: transform .16s; transform-origin: 4px 3px; }
.pz-cursor.press svg { transform: scale(.8); }
.pz-ripple { position: absolute; width: 20px; height: 20px; margin: -10px 0 0 -10px;
  border-radius: 50%; border: 3px solid #e2434e; animation: pzRipple .75s ease-out forwards; }
@keyframes pzRipple { from { transform: scale(.35); opacity: 1; } to { transform: scale(3.2); opacity: 0; } }
.pz-cap { position: absolute; left: 50%; bottom: 36px; max-width: min(900px, 86vw);
  transform: translate(-50%, 18px); opacity: 0; transition: opacity .3s, transform .3s;
  background: rgba(13,31,58,.95); color: #fff; padding: 13px 24px; border-radius: 14px;
  text-align: center; box-shadow: 0 12px 34px rgba(0,0,0,.28); }
.pz-cap.on { opacity: 1; transform: translate(-50%, 0); }
.pz-cap b { display: block; font-size: 18px; font-weight: 650; line-height: 1.35; }
.pz-cap small { display: block; margin-top: 3px; font-size: 14.5px; opacity: .78; line-height: 1.4; }
.pz-card { position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 12px; padding: 40px; text-align: center;
  color: #fff; background: linear-gradient(160deg, #0d2442, #133056 55%, #1d4677);
  opacity: 0; transition: opacity .55s; }
.pz-card.on { opacity: 1; pointer-events: auto; }
.pz-card img { height: 58px; margin-bottom: 22px; }
.pz-kicker { font-size: 13px; letter-spacing: .18em; text-transform: uppercase; opacity: .6; }
.pz-card h1 { margin: 0; font-size: 44px; letter-spacing: -.02em; font-weight: 700; }
.pz-card p { margin: 0; max-width: 760px; font-size: 20px; opacity: .82; line-height: 1.45; }
.pz-spot { position: absolute; z-index: 2147482000; pointer-events: none; border-radius: 12px;
  box-shadow: 0 0 0 3px rgba(226,67,78,.95), 0 0 0 200vmax rgba(9,20,38,.4);
  opacity: 0; transition: opacity .35s, left .5s, top .5s, width .5s, height .5s; }
.pz-spot.on { opacity: 1; }
.pz-panel { position: absolute; top: 16px; right: 16px; width: 340px; display: none;
  pointer-events: auto; background: #fff; color: #0f2a4d; border-radius: 14px; padding: 14px;
  box-shadow: 0 18px 50px rgba(0,0,0,.3); font-size: 13px; }
.pz-panel, .pz-panel * { cursor: default !important; }
.pz-panel.on { display: block; }
.pz-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; }
.pz-head span { font-size: 11px; color: #6b7a90; }
.pz-codes { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 10px; }
.pz-codes label { display: flex; flex-direction: column; gap: 3px; font-size: 11px; font-weight: 700; }
.pz-codes input { width: 100%; padding: 6px; border: 1px solid #c9d2df; border-radius: 7px; font-size: 13px; }
.pz-row { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.pz-panel button { border: 1px solid #c9d2df; background: #f4f6fa; border-radius: 8px;
  padding: 6px 10px; font: inherit; font-weight: 600; color: inherit; }
.pz-panel button[data-pz="all"] { background: #133056; color: #fff; border-color: #133056; }
.pz-panel button:disabled { opacity: .45; }
.pz-chaps button { font-size: 11.5px; padding: 4px 8px; }
.pz-stat { font-size: 12px; color: #4a5a72; line-height: 1.4; word-break: break-word; }`;
  document.head.appendChild(s);
}
