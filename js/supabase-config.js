// ── Supabase connection ──
// Both values are public by design: the anon key is meant to ship in the
// browser. Security comes from the sign-in and the database's row-level
// rules, never from hiding this file.
export const SUPABASE_URL = 'https://vwwiyqmhljzsnyziouqz.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ3d2l5cW1obGp6c255emlvdXF6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTExOTMyMDMsImV4cCI6MjEwNjc2OTIwM30.ih7QXPPFrFSN5-jgPdwhCMmupDEDT3sQtwj7nq6SC4w';

// Branch logins are internal identifiers staff never see or type — they pick
// their branch on screen and the app resolves the address for them.
export const emailFor = code => `${code.toLowerCase()}@finlandoptical.om`;

// Cloudflare Turnstile site key. Leave empty until one is configured; the
// sign-in form then runs without a challenge.
export const TURNSTILE_SITE_KEY = '';
