// ── Bot check on sign-in (Cloudflare Turnstile) ──
// Sign-in codes are six digits, so scripted guessing is the threat; a bot
// check on every sign-in stops it at the source (user, 2026-10-17). Turnstile
// is free and usually invisible — it only shows a box when it has a doubt.
//
// Off until TURNSTILE_SITE_KEY (public, in supabase-config.js) is filled in.
// ORDER MATTERS: fill the key and publish FIRST, then switch CAPTCHA on in
// Supabase (Authentication → Bot and Abuse Protection, provider Turnstile,
// with the SECRET key). The other way round, every sign-in fails.
import { TURNSTILE_SITE_KEY } from './supabase-config.js';

export const captchaOn = () => !!TURNSTILE_SITE_KEY;

let loading = null;
function loadScript() {
  if (window.turnstile) return Promise.resolve();
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = resolve;
    s.onerror = () => { loading = null; reject(new Error('The bot check could not load — check the connection and try again.')); };
    document.head.append(s);
  });
  return loading;
}

// Puts the check into `el`. Returns { token(), reset() } — a token is good for
// one sign-in attempt, so reset() after a failed one — or null when it is off.
export async function mountCaptcha(el) {
  if (!captchaOn() || !el) return null;
  await loadScript();
  let current = null;
  let waiting = [];
  const id = window.turnstile.render(el, {
    sitekey: TURNSTILE_SITE_KEY,
    appearance: 'interaction-only',
    callback: t => { current = t; waiting.forEach(f => f(t)); waiting = []; },
    'expired-callback': () => { current = null; },
    'error-callback': () => { current = null; },
  });
  return {
    token(ms = 20000) {
      if (current) return Promise.resolve(current);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('The bot check did not finish — try again.')), ms);
        waiting.push(t => { clearTimeout(timer); resolve(t); });
      });
    },
    reset() { current = null; window.turnstile.reset(id); },
  };
}
