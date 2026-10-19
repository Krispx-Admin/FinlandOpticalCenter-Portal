// ── A phone number with its country (user, 2026-10-19) ──
// Some customers are not Omani, so the number has a country code in front:
// Oman by default, any other one picked from a list that narrows as you type
// a country's name or its code ("uk", "india", "+44", "971"). The number is
// stored as WhatsApp wants it: digits only, country code first.
import { COUNTRIES, COMMON } from './countries.js';
import { esc } from './ui.js';

const DEFAULT = 'OM';
const byIso = new Map(COUNTRIES.map(([iso, name, cc, main]) => [iso, { iso, name, cc, main: !!main }]));
// The flag, from the two letters (regional indicator symbols).
const flag = iso => String.fromCodePoint(...[...iso.toUpperCase()].map(c => 0x1f1a5 + c.charCodeAt(0)));

export function phoneFieldHTML({ name = 'phone', iso = DEFAULT, value = '', placeholder = 'e.g. 9123 4567' } = {}) {
  const c = byIso.get(iso) ?? byIso.get(DEFAULT);
  return `
    <div class="ph-field" data-ph>
      <button type="button" class="ph-cc" data-ph-cc aria-haspopup="listbox" aria-expanded="false" title="${esc(c.name)}">
        <span class="ph-flag">${flag(c.iso)}</span><span class="ph-code">+${c.cc}</span><span class="ph-caret">▾</span>
      </button>
      <input type="hidden" name="${esc(name)}_iso" value="${c.iso}">
      <input name="${esc(name)}" inputmode="tel" autocomplete="off" value="${esc(value)}" placeholder="${esc(placeholder)}" aria-label="Phone number">
      <div class="ph-menu" hidden>
        <input class="ph-search" placeholder="Type a country or code — e.g. India, +44" autocomplete="off" aria-label="Find a country">
        <div class="ph-list" role="listbox"></div>
      </div>
    </div>`;
}

// What a search keeps: the country's name, letters or code.
function matches(q) {
  const s = q.trim().toLowerCase().replace(/^\+/, '');
  const all = [...byIso.values()];
  if (!s) {
    const common = COMMON.map(i => byIso.get(i)).filter(Boolean);
    return [...common, null, ...all.filter(c => !COMMON.includes(c.iso))];
  }
  const digits = /^\d+$/.test(s);
  // Best first: the exact name or code, then the code's main country ("+44"
  // is the United Kingdom before Jersey), then names that start that way.
  const rank = c => {
    const n = c.name.toLowerCase();
    if (digits) return (String(c.cc) === s ? 0 : 2) + (c.main ? 0 : 1);
    return n === s || c.iso.toLowerCase() === s ? 0 : n.startsWith(s) ? 1 : 2;
  };
  return all.filter(c => (digits ? String(c.cc).startsWith(s)
    : c.name.toLowerCase().split(/[\s(),.-]+/).some(w => w.startsWith(s)) || c.name.toLowerCase().startsWith(s) || c.iso.toLowerCase() === s))
    .sort((a, b) => rank(a) - rank(b) || String(a.cc).length - String(b.cc).length || a.name.localeCompare(b.name));
}

function drawList(field) {
  const list = field.querySelector('.ph-list');
  const cur = field.querySelector('input[type=hidden]').value;
  const found = matches(field.querySelector('.ph-search').value);
  list.innerHTML = found.length ? found.map(c => (c === null ? '<div class="ph-sep" role="separator"></div>' : `
    <button type="button" class="ph-opt ${c.iso === cur ? 'on' : ''}" data-ph-iso="${c.iso}" role="option">
      <span class="ph-flag">${flag(c.iso)}</span><span class="ph-name">${esc(c.name)}</span><span class="ph-dial">+${c.cc}</span>
    </button>`)).join('') : '<p class="ph-none">No country matches that.</p>';
}
function open(field) {
  const menu = field.querySelector('.ph-menu');
  menu.hidden = false;
  field.querySelector('[data-ph-cc]').setAttribute('aria-expanded', 'true');
  const s = field.querySelector('.ph-search');
  s.value = '';
  drawList(field);
  s.focus();
}
function close(field) {
  field.querySelector('.ph-menu').hidden = true;
  field.querySelector('[data-ph-cc]').setAttribute('aria-expanded', 'false');
}
function choose(field, iso) {
  const c = byIso.get(iso);
  if (!c) return;
  field.querySelector('input[type=hidden]').value = c.iso;
  const btn = field.querySelector('[data-ph-cc]');
  btn.title = c.name;
  btn.querySelector('.ph-flag').textContent = flag(c.iso);
  btn.querySelector('.ph-code').textContent = `+${c.cc}`;
  close(field);
  field.querySelector('input[inputmode=tel]').focus();
}

// Once per container: the picker's clicks and keys, for any phone field in it.
export function wirePhoneFields(root) {
  root.addEventListener('click', e => {
    const cc = e.target.closest('[data-ph-cc]');
    if (cc) { const f = cc.closest('[data-ph]'); return f.querySelector('.ph-menu').hidden ? open(f) : close(f); }
    const opt = e.target.closest('[data-ph-iso]');
    if (opt) return choose(opt.closest('[data-ph]'), opt.dataset.phIso);
    // a click anywhere else closes an open list
    root.querySelectorAll('[data-ph] .ph-menu:not([hidden])').forEach(m => { if (!m.contains(e.target)) close(m.closest('[data-ph]')); });
  });
  root.addEventListener('input', e => { if (e.target.matches('.ph-search')) drawList(e.target.closest('[data-ph]')); });
  root.addEventListener('keydown', e => {
    if (!e.target.matches('.ph-search')) return;
    const f = e.target.closest('[data-ph]');
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(f); f.querySelector('[data-ph-cc]').focus(); }
    if (e.key === 'Enter') { e.preventDefault(); const first = f.querySelector('[data-ph-iso]'); if (first) choose(f, first.dataset.phIso); }
  });
}

// A saved number back into its country and the rest, to edit it: the longest
// calling code it starts with (the code's main country where several share
// it — 44 is the United Kingdom); 8 digits alone are an Omani number.
export function splitPhone(saved) {
  const d = String(saved ?? '').replace(/\D/g, '');
  if (!d) return { iso: DEFAULT, local: '' };
  if (d.length === 8) return { iso: DEFAULT, local: d };
  const fits = [...byIso.values()].filter(c => d.startsWith(String(c.cc)) && d.length > String(c.cc).length)
    .sort((a, b) => String(b.cc).length - String(a.cc).length || (b.main ? 1 : 0) - (a.main ? 1 : 0));
  const c = fits[0];
  return c ? { iso: c.iso, local: d.slice(String(c.cc).length) } : { iso: DEFAULT, local: d };
}

// The number as WhatsApp wants it — country code, then the number without
// its leading 0 — or null when there is not enough of a number. A number
// typed with its own "+" or "00" keeps the code it was given.
export function phoneValue(field) {
  const typed = String(field.querySelector('input[inputmode=tel]').value ?? '').trim();
  if (!typed) return null;
  let d = typed.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else d = `${byIso.get(field.querySelector('input[type=hidden]').value)?.cc ?? 968}${d.replace(/\D/g, '').replace(/^0+/, '')}`;
  d = d.replace(/\D/g, '');
  return d.length >= 8 ? d : null;
}
