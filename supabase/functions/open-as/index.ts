// ── open-as: sign this browser in as another account (user 2026-10-20) ──
// For an account signed in with the 'accounts' permission (not View only) —
// one that can already set any account's code, so it gains nothing new. It
// checks the caller's own session, mints a session for the account picked
// (a one-time sign-in link, used here and never sent anywhere) and records
// the switch in account_switches. No code is read, stored or changed.
// Deployed with schema-58; the browser calls it from "Open as…".
import { createClient } from 'jsr:@supabase/supabase-js@2';

const ALLOWED = ['https://foc-portal.org', 'https://www.foc-portal.org'];
const emailFor = (code: string) => `${code.toLowerCase()}@finlandoptical.om`;

Deno.serve(async req => {
  const origin = req.headers.get('Origin') ?? '';
  const cors = {
    'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : ALLOWED[0],
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Who is asking: their own session, checked by Supabase.
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return reply(401, { error: 'Sign in first' });
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: who, error: whoErr } = await admin.auth.getUser(jwt);
  const me = who?.user?.app_metadata?.branch_code;
  if (whoErr || !me) return reply(401, { error: 'Sign in first' });

  const { data: mine } = await admin.from('branches').select('code, perms, active').eq('code', me).maybeSingle();
  const perms: string[] = mine?.perms ?? [];
  if (!mine?.active || !perms.includes('accounts') || perms.includes('view_only')) {
    return reply(403, { error: 'Only an account allowed to manage accounts can open another' });
  }

  let target = '';
  try { target = String((await req.json())?.code ?? '').trim().toUpperCase(); } catch { /* below */ }
  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(target)) return reply(400, { error: 'Which account?' });
  if (target === me) return reply(400, { error: 'That is you already' });
  const { data: to } = await admin.from('branches').select('code, active').eq('code', target).maybeSingle();
  if (!to) return reply(404, { error: 'No such account' });
  if (!to.active) return reply(400, { error: 'That account is closed' });

  // A one-time link for it, used right here: the session comes back to the caller.
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email: emailFor(target) });
  const hash = link?.properties?.hashed_token;
  if (linkErr || !hash) return reply(500, { error: `Could not open ${target}: ${linkErr?.message ?? 'no link'}` });
  const pub = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  let { data: s, error: sErr } = await pub.auth.verifyOtp({ token_hash: hash, type: 'magiclink' });
  if (sErr || !s?.session) ({ data: s, error: sErr } = await pub.auth.verifyOtp({ token_hash: hash, type: 'email' }));
  if (sErr || !s?.session) return reply(500, { error: `Could not open ${target}: ${sErr?.message ?? 'no session'}` });

  await admin.from('account_switches').insert({ by_code: me, to_code: target });
  return reply(200, { access_token: s.session.access_token, refresh_token: s.session.refresh_token });
});
