// ── Tablet Mode (user 2026-10-22) ──
// For the cutters' tablets beside their machines. Chosen per device (it is
// the tablet that changes, not the account), remembered in this browser.
// What it changes, and why (research: Apple HIG, Material large screens,
// NN/g touch targets, kitchen-display practice):
//  · Every control at least 48 px, the next step 56 px and full width — Apple
//    asks 44 pt, NN/g 1 cm; the step a cutter presses all day gets more.
//  · Nothing hidden by width: the desktop list drops the route and the tags
//    below 1180 px (an iPad's width), which is why the page had to be zoomed
//    out. The orders become cards that keep everything, one or two across.
//  · Text 16 px or more — read at arm's length, and Safari zooms into any box
//    under 16 px when it is tapped.
//  · The menu folds to a rail of icons, so the orders get the width.
//  · A step pressed by mistake is undone from the pop-up (Undo), instead of an
//    "are you sure?" before every step.
const KEY = 'focp.tablet';
// Only for an account the office allows (schema-64, the 'tablet' tick — MGM
// to start); the shell says which on signing in. Off before then.
let allowed = false;
export function allowTablet(on) { allowed = !!on; apply(); }
export const tabletAllowed = () => allowed;

export function isTablet() {
  if (!allowed) return false;
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}
export function setTablet(on) {
  try { if (on) localStorage.setItem(KEY, '1'); else localStorage.setItem(KEY, '0'); } catch { /* this visit only */ }
  apply();
}
// Asked about it once on a touch screen of tablet size; null = never chosen.
export function tabletChosen() {
  try { return localStorage.getItem(KEY) !== null; } catch { return true; }
}
export const looksLikeTablet = () => matchMedia('(pointer: coarse)').matches && Math.min(innerWidth, innerHeight) >= 600 && Math.max(innerWidth, innerHeight) <= 1400;

export function apply() {
  // ?tablet=1 / ?tablet=0 in the address turns it on or off on this device.
  const q = new URLSearchParams(location.search).get('tablet');
  if (q === '1' || q === '0') { try { localStorage.setItem(KEY, q); } catch { /* fine */ } }
  document.documentElement.classList.toggle('tablet', isTablet());
}
apply();
