// ── Authentication: real sign-in against Supabase ──
// The branch code lives in the token's app_metadata, which is set server-side
// and cannot be rewritten by the browser — so a branch cannot promote itself.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, emailFor } from './supabase-config.js';
import { loc } from './data.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
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

export async function signIn(branchCode, code) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: emailFor(branchCode),
    password: code,
  });

  if (error) {
    // Deliberately vague: saying "no such branch" would confirm which
    // branches exist to someone probing the sign-in form.
    const msg = /invalid login/i.test(error.message)
      ? 'That code is not right for this branch.'
      : /rate|too many/i.test(error.message)
        ? 'Too many attempts. Wait a minute and try again.'
        : error.message;
    return { error: msg };
  }

  const branch = branchOf(data.user);
  if (!branch) {
    await supabase.auth.signOut();
    return { error: 'This account is not linked to a branch. Contact the warehouse.' };
  }
  return { branch };
}

export async function signOut() {
  await supabase.auth.signOut();
}

// Fires when a session is restored, refreshed or lost (including in another
// tab), so the shell can follow the user out if they sign out elsewhere.
export function onAuthChange(fn) {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    fn(branchOf(session?.user), event);
  });
  return () => data?.subscription?.unsubscribe();
}

// ── Warehouse-only: set a branch's code ──
// Enforced in the database, not here — this call simply fails for anyone else.
export async function setBranchCode(branchCode, newCode) {
  const { error } = await supabase.rpc('set_branch_code', { p_branch: branchCode, p_code: newCode });
  return error ? { error: error.message.replace(/^.*?:\s*/, '') } : {};
}

export async function branchAccess() {
  const { data, error } = await supabase.rpc('branch_access');
  return error ? { error: error.message } : { rows: data ?? [] };
}
