// ── Authentication: real sign-in against Supabase ──
// The branch code lives in the token's app_metadata, which is set server-side
// and cannot be rewritten by the browser — so a branch cannot promote itself.
// Pinned to one exact, settled release (security, 2026-10-17): a floating
// "@2" would run whatever the CDN serves next with every user's session.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, emailFor } from './supabase-config.js';
import { loc } from './data.js';

// Admin Demo (?AdminDemo, or ?AdminDemo=SCC to open a branch — js/demo.js; was
// ?practice until 2026-10-19): where the office tries features before they
// launch, unlisted anywhere. The portal on a database inside
// this browser. The live connection is never even created then, so nothing
// done in practice can reach the real data.
export const PRACTICE = new URLSearchParams(location.search).get('AdminDemo');
export const isPractice = PRACTICE !== null;
export const supabase = isPractice
  ? await (await import('./demo.js')).practiceClient()
  : createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });

// Turns a signed-in Supabase user into the location record the modules expect,
// so nothing downstream has to know authentication changed.
function branchOf(user) {
  const code = user?.app_metadata?.branch_code;
  return code ? loc(code) ?? null : null;
}

export async function currentBranch() {
  const { data } = await supabase.auth.getSession();
  return branchOf(data?.session?.user);
}

export async function signIn(branchCode, code, captchaToken = null) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: emailFor(branchCode),
    password: code,
    ...(captchaToken ? { options: { captchaToken } } : {}),
  });

  if (error) {
    // Deliberately vague: saying "no such branch" would confirm which
    // branches exist to someone probing the sign-in form.
    const msg = /invalid login/i.test(error.message)
      ? 'That code is not right for this branch.'
      : /rate|too many/i.test(error.message)
        ? 'Too many attempts. Wait a minute and try again.'
        : /captcha/i.test(error.message)
          ? 'The bot check failed — wait a moment and try again.'
        : error.message;
    return { error: msg };
  }

  const branch = branchOf(data.user);
  if (!branch) {
    await supabase.auth.signOut({ scope: 'local' });
    return { error: 'This account is not linked to a branch. Contact the office.' };
  }
  return { branch };
}

// Signs out THIS device only. Every device of a branch shares one account, and
// the library's default ('global') would sign the branch out on every device
// at once — a second till signing out used to log the first one out too.
export async function signOut() {
  try { sessionStorage.removeItem(BACK_KEY); } catch { /* fine */ }
  await supabase.auth.signOut({ scope: 'local' });
}

// Fires when a session is restored, refreshed or lost (including in another
// tab), so the shell can follow the user out if they sign out elsewhere.
export function onAuthChange(fn) {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    fn(branchOf(session?.user), event);
  });
  return () => data?.subscription?.unsubscribe();
}

// ── Open as another account (schema-58, supabase/functions/open-as) ──
// For an account with 'accounts' (the function checks). The session you came
// from is kept in this tab, so "Back to …" returns to it without a code.
const BACK_KEY = 'focp.openedFrom';
export const openedFrom = () => { try { return JSON.parse(sessionStorage.getItem(BACK_KEY) || 'null'); } catch { return null; } };
export async function openAs(code) {
  if (isPractice) {
    // The Admin Demo has no server: any of its accounts opens straight away.
    const back = openedFrom() ?? { code: (await currentBranch())?.code, practice: true };
    const r = await signIn(code, 'practice');
    if (r.branch) try { sessionStorage.setItem(BACK_KEY, JSON.stringify(back)); } catch { /* fine */ }
    return r;
  }
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { error: 'Sign in first' };
  let body;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/open-as`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ code }),
    });
    body = await res.json().catch(() => ({}));
    if (!res.ok) return { error: body.error || `Could not open ${code}` };
  } catch { return { error: 'Could not reach the server — check the connection.' }; }
  // Only the first switch is remembered: "Back" always returns to you.
  const back = openedFrom() ?? { code: branchOf(session.user)?.code, access_token: session.access_token, refresh_token: session.refresh_token };
  const { data, error } = await supabase.auth.setSession({ access_token: body.access_token, refresh_token: body.refresh_token });
  if (error || !branchOf(data?.user)) return { error: error?.message || `Could not open ${code}` };
  try { sessionStorage.setItem(BACK_KEY, JSON.stringify(back)); } catch { /* fine */ }
  return { branch: branchOf(data.user) };
}
export async function backFromOpened() {
  const back = openedFrom();
  if (!back) return { error: 'Nothing to go back to' };
  const r = back.practice
    ? await signIn(back.code, 'practice')
    : await supabase.auth.setSession({ access_token: back.access_token, refresh_token: back.refresh_token })
      .then(({ data, error }) => (error || !branchOf(data?.user) ? { error: 'Your own sign-in has ended — sign in again.' } : { branch: branchOf(data.user) }));
  try { sessionStorage.removeItem(BACK_KEY); } catch { /* fine */ }
  return r;
}

// ── Office-only: set a branch's code ──
// Enforced in the database, not here — this call simply fails for anyone else.
export async function setBranchCode(branchCode, newCode) {
  const { error } = await supabase.rpc('set_branch_code', { p_branch: branchCode, p_code: newCode });
  return error ? { error: error.message.replace(/^.*?:\s*/, '') } : {};
}

export async function branchAccess() {
  const { data, error } = await supabase.rpc('branch_access');
  return error ? { error: error.message } : { rows: data ?? [] };
}
