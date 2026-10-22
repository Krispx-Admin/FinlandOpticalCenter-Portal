// ── Bill numbers (user 2026-10-22; in the Admin Demo first) ──
// The branch's letters go in front by themselves (SEEB, MGM, MOUJ, SAL…) and
// the box takes digits only — a bill typed without its letters was the
// trouble. A bill is used once in Direct Insurance and once in Reimbursement
// Invoice. In the Fitting Log, typing a bill that is there already asks "is
// this another pair?", shows the orders on it and where each is, and on
// Confirm the ones there become "(1/2)" and the new one "(2/2)" — (1/3) (2/3)
// (3/3) for a third, and so on (schema-61 renumbers them when it is saved).
// The field keeps a hidden input with the whole bill ("SEEB 10020") under the
// form's own name/id, so the forms read it as they always did.
import { LOCATIONS, FIT_STATUS, locName } from './data.js';
import { isPractice, supabase } from './auth.js';
import { store } from './store.js';
import { esc, icons } from './ui.js';

export const BILL_ON = isPractice;
export const billPrefix = code => {
  const l = LOCATIONS.find(x => x.code === code);
  return (l?.billPrefix || code || '').toUpperCase();
};
const BILL_RE = /^([A-Z]{1,8}) (\d+)(?: \((\d+)\/(\d+)\))?$/;
// "SEEB 10020 (1/3)" → its parts; null for a bill from before (free text).
export function parseBill(ref) {
  const m = BILL_RE.exec(String(ref ?? '').trim());
  return m ? { prefix: m[1], digits: m[2], base: `${m[1]} ${m[2]}`, pair: m[3] ? +m[3] : 1, pairs: m[4] ? +m[4] : 1 } : null;
}

// The box. `hidden` names the hidden input the form reads: { name } or { id }.
// Editing an order that is one of several pairs keeps its "(k/n)".
export function billFieldHTML({ code, value = '', hidden, label = 'Bill number' }) {
  const p = parseBill(value);
  const prefix = billPrefix(code);
  const digits = p?.digits ?? '';
  const tail = p && p.pairs > 1 ? ` (${p.pair}/${p.pairs})` : '';
  const attr = hidden.id ? `id="${esc(hidden.id)}"` : `name="${esc(hidden.name)}"`;
  return `
    <div class="bill-field" data-bill data-tail="${esc(tail)}">
      <span class="bill-l">${esc(label)}</span>
      <div class="bill-row">
        <div class="bill-box"><span class="bill-pre" data-bill-pre>${esc(prefix)}</span><input class="bill-num" inputmode="numeric" autocomplete="off" required placeholder="Numbers only — e.g. 10020" value="${esc(digits)}" aria-label="${esc(label)}, numbers only"></div>
      </div>
      <input type="hidden" ${attr} value="${esc(digits ? `${prefix} ${digits}${tail}` : '')}">
    </div>`;
}

function sync(field) {
  const num = field.querySelector('.bill-num');
  const clean = num.value.replace(/\D/g, '');
  if (clean !== num.value) num.value = clean;          // letters never stay in the box
  field.querySelector('input[type=hidden]').value = clean ? `${field.querySelector('[data-bill-pre]').textContent} ${clean}${field.dataset.tail || ''}` : '';
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

const usedBills = async (kind, base) => {
  const { data, error } = await supabase.rpc('bills_used', { p_kind: kind, p_base: base });
  if (error) return null;
  return (data ?? []).map(x => (typeof x === 'string' ? x : Object.values(x)[0])).filter(Boolean);
};

// Invoices, and editing an order: is the bill free? null when it is; else what to say.
// `keep`: the bill this record has now (it is no clash with itself).
export async function billProblem(kind, ref, keep = null) {
  const p = parseBill(ref);
  if (!p) return 'Type the bill number — numbers only.';
  const used = (await usedBills(kind, p.base))?.filter(x => x !== keep && parseBill(x)?.base === p.base) ?? [];
  if (!used.length) return null;
  const where = kind === 'order' ? 'the Fitting Log' : kind === 'direct' ? 'Direct Insurance' : 'Reimbursement Invoice';
  return `${p.base} is already in ${where}${kind === 'order' ? ` (${used.join(', ')})` : ''}.`;
}

// ── A new fitting order on a bill that is there already ──
// Resolves { base, pair: false } — the bill is free; { base, pair: true } —
// Confirmed as another pair; null — they stopped. Nothing changes until the
// order is saved: then takePair() renumbers and gives the new one's bill.
export async function planOrderBill(ref, { preview = null } = {}) {
  const p = parseBill(ref);
  if (!p) return { base: ref, pair: false };
  const used = await usedBills('order', p.base);
  if (!used?.length) return { base: p.base, pair: false };
  const { data } = await supabase.rpc('bill_orders', { p_base: p.base });
  const rows = data ?? [];
  if (!rows.length) {
    // There, but not this branch's to see — it cannot be added to.
    return dialog(`
      <h3>${esc(p.base)} is taken</h3>
      <p>That bill is already in the Fitting Log and is not yours to add a pair to. Check the number.</p>
      <div class="pq-foot"><button type="button" class="btn btn-primary" data-pq="no">OK</button></div>`).then(() => null);
  }
  const n = rows.length;
  // The orders already on it, as the Fitting Log shows them (no buttons).
  const shown = preview ? rows.map(o => preview(o.id)).join('') : '';
  const yes = await dialog(`
    <h3>This bill has already been entered</h3>
    <p><b>${esc(p.base)}</b> is in the Fitting Log${n > 1 ? ` ${n} times` : ''}. Is this ${n === 1 ? 'a second' : n === 2 ? 'a third' : 'another'} pair of glasses on the same bill?</p>
    ${shown ? `<div class="pq-rows">${shown}</div>` : ''}
    <div class="pq-foot">
      <button type="button" class="btn btn-ghost" data-pq="no">No — change the number</button>
      <button type="button" class="btn btn-primary" data-pq="yes">Yes, another pair</button>
    </div>`);
  if (!yes) return null;
  const route = o => {
    const to = o.fitter_code ? locName(o.fitter_code) : o.outside_cutter ? `${o.outside_cutter} (outside cutter)` : 'not sent to fitting yet';
    return `${esc(locName(o.origin_code))} → ${esc(to)}`;
  };
  const ok = await dialog(`
    <h3>Add a pair to ${esc(p.base)}</h3>
    <p>Already on this bill — they will be renumbered:</p>
    <div class="pq-list">${rows.map((o, i) => `
      <div class="pq-row">
        <div class="pq-ref"><b>${esc(o.ref)}</b> ${icons.arrowRight} <b>${esc(`${p.base} (${i + 1}/${n + 1})`)}</b></div>
        <div class="pq-sub">${esc(o.customer || 'No name')} · ${route(o)} · <span class="pq-st">${esc(FIT_STATUS[o.status]?.label ?? o.status)}</span> · logged ${esc(new Date(o.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))}</div>
      </div>`).join('')}
      <div class="pq-row pq-new"><div class="pq-ref">This new order ${icons.arrowRight} <b>${esc(`${p.base} (${n + 1}/${n + 1})`)}</b></div></div>
    </div>
    <div class="pq-foot">
      <button type="button" class="btn btn-ghost" data-pq="no">Back</button>
      <button type="button" class="btn btn-primary" data-pq="yes">${icons.check} Confirm</button>
    </div>`);
  return ok ? { base: p.base, pair: true } : null;
}
// When the order is being saved: the ones there renumbered, the new one's bill
// back (the store reloads the orders, so the new names show at once).
export async function takePair(base) {
  const ref = await store.pairRef(base);
  if (!ref) throw new Error('The other pairs could not be renumbered');
  return ref;
}
// The new pair could not be saved: number the ones there again.
export const fixPairs = base => store.pairFix(base);

// A small question over the form, without closing it. Resolves true / false.
function dialog(html) {
  return new Promise(done => {
    const back = document.createElement('div');
    back.className = 'pq-back';
    back.innerHTML = `<div class="pq" role="dialog" aria-modal="true">${html}</div>`;
    document.body.append(back);
    requestAnimationFrame(() => back.classList.add('open'));
    const finish = v => { back.remove(); document.removeEventListener('keydown', key, true); done(v); };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); finish(false); } };
    document.addEventListener('keydown', key, true);
    back.addEventListener('click', e => {
      const b = e.target.closest('[data-pq]');
      if (b) finish(b.dataset.pq === 'yes');
      else if (e.target === back) finish(false);
    });
    back.querySelector('[data-pq="yes"]')?.focus();
  });
}
