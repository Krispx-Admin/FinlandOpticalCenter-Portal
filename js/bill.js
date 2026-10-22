// ── Bill numbers (user 2026-10-22; in the Admin Demo first) ──
// The branch's letters go in front by themselves (SEEB, MGM, MOUJ, SAL…) and
// the box takes digits only — a bill typed without its letters was the
// trouble. A bill is used once in the Fitting Log, once in Direct Insurance,
// once in Reimbursement Invoice; several pairs of glasses on one bill are
// "(1/3)", "(2/3)", "(3/3)" (the order form asks how many and which).
// The field keeps a hidden input with the whole bill ("SEEB 10020 (1/3)") under
// the form's own name/id, so the forms read it as they always did.
import { LOCATIONS } from './data.js';
import { isPractice, supabase } from './auth.js';
import { esc } from './ui.js';

export const BILL_ON = isPractice;
export const billPrefix = code => {
  const l = LOCATIONS.find(x => x.code === code);
  return (l?.billPrefix || code || '').toUpperCase();
};
const BILL_RE = /^([A-Z]{1,8}) (\d+)(?: \((\d)\/(\d)\))?$/;
// "SEEB 10020 (1/3)" → its parts; null for a bill from before (free text).
export function parseBill(ref) {
  const m = BILL_RE.exec(String(ref ?? '').trim());
  return m ? { prefix: m[1], digits: m[2], pair: m[3] ? +m[3] : 1, pairs: m[4] ? +m[4] : 1 } : null;
}
const compose = (prefix, digits, pair, pairs) => (digits ? `${prefix} ${digits}${pairs > 1 ? ` (${pair}/${pairs})` : ''}` : '');

// The box. `hidden` names the hidden input the form reads: { name } or { id }.
export function billFieldHTML({ code, value = '', hidden, pairs = false, label = 'Bill number' }) {
  const p = parseBill(value);
  const prefix = billPrefix(code);
  const digits = p?.digits ?? '';
  const n = p?.pairs ?? 1, k = p?.pair ?? 1;
  const attr = hidden.id ? `id="${esc(hidden.id)}"` : `name="${esc(hidden.name)}"`;
  return `
    <div class="bill-field" data-bill data-pairs="${pairs ? 1 : 0}">
      <span class="bill-l">${esc(label)}</span>
      <div class="bill-row">
        <div class="bill-box"><span class="bill-pre" data-bill-pre>${esc(prefix)}</span><input class="bill-num" inputmode="numeric" autocomplete="off" required placeholder="Numbers only — e.g. 10020" value="${esc(digits)}" aria-label="${esc(label)}, numbers only"></div>
        ${pairs ? `<label class="bill-pairs" title="More than one pair of glasses on this bill">Pairs
          <select data-bill-n>${[1, 2, 3].map(x => `<option value="${x}" ${x === n ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
          <label class="bill-pairs" data-bill-k-wrap ${n > 1 ? '' : 'hidden'}>This is
          <select data-bill-k>${[1, 2, 3].map(x => `<option value="${x}" ${x === k ? 'selected' : ''} ${x > n ? 'hidden' : ''}>${x} of ${n}</option>`).join('')}</select></label>` : ''}
      </div>
      <input type="hidden" ${attr} value="${esc(compose(prefix, digits, k, n))}">
      <span class="bill-show" data-bill-show>${digits ? esc(compose(prefix, digits, k, n)) : ''}</span>
    </div>`;
}

function sync(field) {
  const num = field.querySelector('.bill-num');
  const clean = num.value.replace(/\D/g, '');
  if (clean !== num.value) num.value = clean;          // letters never stay in the box
  const n = +(field.querySelector('[data-bill-n]')?.value ?? 1);
  const kSel = field.querySelector('[data-bill-k]');
  if (kSel) {
    [...kSel.options].forEach(o => { o.hidden = +o.value > n; o.textContent = `${o.value} of ${n}`; });
    if (+kSel.value > n) kSel.value = '1';
    field.querySelector('[data-bill-k-wrap]').hidden = n < 2;
  }
  const k = +(kSel?.value ?? 1);
  const v = compose(field.querySelector('[data-bill-pre]').textContent, clean, k, n);
  field.querySelector('input[type=hidden]').value = v;
  field.querySelector('[data-bill-show]').textContent = v;
}
// Once per container: keep every bill box in it whole.
export function wireBillFields(root) {
  root.addEventListener('input', e => { const f = e.target.closest('[data-bill]'); if (f) sync(f); });
  root.addEventListener('change', e => { const f = e.target.closest('[data-bill]'); if (f) sync(f); });
}
// Another branch picked (the office raising an invoice for one): its letters.
export function setBillBranch(root, code) {
  const f = root.querySelector('[data-bill]');
  if (!f) return;
  f.querySelector('[data-bill-pre]').textContent = billPrefix(code);
  sync(f);
}
export const billOf = root => root.querySelector('[data-bill] input[type=hidden]')?.value ?? '';

// Is the bill free? null when it is; else what to say. `kind`: 'order' | 'direct' | 'claim'.
// `keep`: the bill this record has now (editing it is not a clash with itself).
export async function billProblem(kind, ref, keep = null) {
  const p = parseBill(ref);
  if (!p) return 'Type the bill number — numbers only.';
  const base = `${p.prefix} ${p.digits}`;
  const { data, error } = await supabase.rpc('bills_used', { p_kind: kind, p_base: base });
  if (error) return null;                             // the database still has the last word
  const used = (data ?? []).map(x => (typeof x === 'string' ? x : Object.values(x)[0])).filter(x => x && x !== keep);
  if (!used.length) return null;
  const where = kind === 'order' ? 'the Fitting Log' : kind === 'direct' ? 'Direct Insurance' : 'Reimbursement Invoice';
  if (kind !== 'order') return `${base} is already in ${where}.`;
  // Pairs: each "k of n" once, all with the same n; a bill on its own is one pair.
  const others = used.map(parseBill).filter(Boolean);
  if (others.some(o => o.pairs === 1)) return `${base} is already in ${where}. A second pair on this bill? First edit that order to “1 of 2”, then add this one as “2 of 2”.`;
  if (p.pairs === 1) return `${base} is already in ${where} as ${used.join(', ')} — choose the same number of pairs and the one not used yet.`;
  if (others.some(o => o.pairs !== p.pairs)) return `${base} is already in ${where} as ${used.join(', ')} — use the same number of pairs.`;
  if (others.some(o => o.pair === p.pair)) return `${ref} is already in ${where}.`;
  return null;
}
