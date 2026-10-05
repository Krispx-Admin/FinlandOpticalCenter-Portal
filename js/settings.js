// ── Module 3: Settings (admin) — request categories & brand groups ──
import { UNITS } from './data.js';
import { store } from './store.js';
import { branchAccess, setBranchCode } from './auth.js';
import { esc, icons, relTime } from './ui.js';

export function settingsView(me) {
  let root;

  const groups = () => store.settings.brandGroups;
  const usedBy = name => store.settings.categories.filter(c => c.brandGroup === name).length;

  // Shows "— none —" when a category points at a group that no longer exists,
  // so a dangling pointer is visible rather than silently showing group one.
  function groupOptionsHTML(selected) {
    const gs = groups();
    const known = gs.some(g => g.name === selected);
    return (known ? '' : `<option value="" selected>— none —</option>`)
      + gs.map(g => `<option value="${esc(g.name)}" ${g.name === selected ? 'selected' : ''}>${esc(g.name)}</option>`).join('');
  }

  const unitOptionsHTML = selected =>
    UNITS.map(u => `<option value="${u.value}" ${(selected === 'box' ? 'box' : 'pcs') === u.value ? 'selected' : ''}>${esc(u.label)}</option>`).join('');

  function categoriesHTML() {
    const cats = store.settings.categories;
    if (!cats.length) return `<div class="empty">${icons.tag}<p>No categories yet — add one below.</p></div>`;
    return cats.map((c, i) => `
      <div class="set-cat" draggable="true" data-idx="${i}">
        <span class="drag-grip" title="Drag to reorder">${icons.grip}</span>
        <div class="set-cat-body">
          <div class="set-cat-name">${icons.tag}<b>${esc(c.name)}</b></div>
          <div class="set-cat-flags">
            <label class="check sm"><input type="checkbox" data-flag="needsBrand" data-cat="${esc(c.name)}" ${c.needsBrand ? 'checked' : ''}><i></i>Brand</label>
            <label class="check sm"><input type="checkbox" data-flag="needsAudience" data-cat="${esc(c.name)}" ${c.needsAudience ? 'checked' : ''}><i></i>Audience</label>
            <label class="check sm"><input type="checkbox" data-flag="needsQty" data-cat="${esc(c.name)}" ${c.needsQty !== false ? 'checked' : ''}><i></i>Quantity</label>
          </div>
          <div class="set-cat-ctl">
            <label class="set-ctl"><span>Counted</span>
              <select data-cat-unit="${esc(c.name)}">${unitOptionsHTML(c.unit)}</select>
            </label>
            <label class="set-ctl"><span>Brands from</span>
              <select data-cat-group="${esc(c.name)}" ${c.needsBrand ? '' : 'disabled'}
                title="${c.needsBrand ? 'Which brand group this category offers' : 'This category does not ask for a brand'}">
                ${groupOptionsHTML(c.brandGroup)}
              </select>
            </label>
          </div>
        </div>
        <button class="icon-btn" data-del-cat="${esc(c.name)}" title="Remove category">${icons.trash}</button>
      </div>`).join('');
  }

  function groupsHTML() {
    const gs = groups();
    if (!gs.length) return `<div class="empty">${icons.box}<p>No brand groups yet — add one below.</p></div>`;
    return gs.map((g, gi) => {
      const n = usedBy(g.name);
      return `
      <div class="set-bg" data-gidx="${gi}" data-group="${esc(g.name)}">
        <div class="set-bg-head">
          <span class="drag-grip" draggable="true" title="Drag to reorder groups">${icons.grip}</span>
          <input class="set-bg-name" value="${esc(g.name)}" data-group-name="${esc(g.name)}" aria-label="Group name">
          <span class="set-bg-n">${g.brands.length} brand${g.brands.length === 1 ? '' : 's'} · used by ${n} categor${n === 1 ? 'y' : 'ies'}</span>
          <button class="icon-btn" data-del-group="${esc(g.name)}" title="Remove group">${icons.trash}</button>
        </div>
        <div class="set-brands" data-drop-group="${esc(g.name)}">
          ${g.brands.map((b, bi) => `
            <span class="set-brand" draggable="true" data-idx="${bi}" data-group="${esc(g.name)}" title="Drag to reorder, or onto another group to move">
              ${esc(b)}<button class="brand-x" data-del-brand="${esc(b)}" data-group="${esc(g.name)}" title="Remove">${icons.x}</button>
            </span>`).join('')}
          ${g.brands.length ? '' : `<span class="set-bg-empty">Empty — drag brands here.</span>`}
        </div>
        <form class="set-add sm" data-add-brand="${esc(g.name)}">
          <input name="name" placeholder="Add a brand to ${esc(g.name)}…" required>
          <button class="btn btn-ghost btn-sm" type="submit">${icons.plus} Add</button>
        </form>
      </div>`;
    }).join('');
  }

  // Reads through a database function that checks the caller is the warehouse,
  // so a branch calling it directly gets nothing back.
  async function loadAccess() {
    const host = root.querySelector('#set-access');
    if (!host) return;
    const { rows, error } = await branchAccess();
    if (error) { host.innerHTML = `<p class="muted sm">Could not load branch access — ${esc(error)}</p>`; return; }
    host.innerHTML = rows.map(r => `
      <div class="ba-row" data-branch="${esc(r.code)}">
        <div class="ba-who">
          <span class="loc-chip">${esc(r.code)}</span>
          <b>${esc(r.name)}</b>
          <span class="muted sm">${esc(r.role)}</span>
        </div>
        <div class="ba-seen muted sm">${r.has_account
          ? (r.last_sign_in ? 'last signed in ' + relTime(Date.parse(r.last_sign_in)) : 'never signed in')
          : 'no account'}</div>
        <form class="ba-set" data-set="${esc(r.code)}">
          <input name="code" inputmode="numeric" maxlength="6" pattern="\\d{6}"
                 placeholder="new 6-digit code" ${r.has_account ? '' : 'disabled'} autocomplete="off">
          <button class="btn btn-ghost btn-sm" type="submit" ${r.has_account ? '' : 'disabled'}>Set</button>
        </form>
        <div class="ba-msg"></div>
      </div>`).join('');
  }

  async function applyCode(form) {
    const branch = form.dataset.set;
    const row = form.closest('.ba-row');
    const msg = row.querySelector('.ba-msg');
    const input = form.querySelector('input');
    const value = input.value.trim();
    msg.className = 'ba-msg';
    if (!/^\d{6}$/.test(value)) { msg.classList.add('bad'); msg.textContent = 'Six digits.'; return; }
    msg.textContent = 'Saving…';
    const { error } = await setBranchCode(branch, value);
    if (error) { msg.classList.add('bad'); msg.textContent = error; return; }
    msg.classList.add('good');
    msg.textContent = 'Code updated';
    input.value = '';
    setTimeout(() => { msg.textContent = ''; msg.className = 'ba-msg'; }, 4000);
  }

  function render() {
    root.innerHTML = `
      <header class="mod-head">
        <div>
          <h1>Settings</h1>
          <p class="mod-sub">Control what branches can request — categories, how they're counted, and which brands each one offers</p>
        </div>
      </header>

      <section class="set-card">
        <div class="set-card-head">
          <h2>${icons.tag} Categories</h2>
          <p class="muted">Choose which fields each category needs, whether it's counted in pieces or boxes, and which brand group it draws from.</p>
        </div>
        <div id="set-cats">${categoriesHTML()}</div>
        <form class="set-add" id="add-cat">
          <input name="name" placeholder="New category — e.g. Cleaning Spray" required>
          <label class="check sm"><input type="checkbox" name="needsBrand" checked><i></i>Brand</label>
          <label class="check sm"><input type="checkbox" name="needsAudience" checked><i></i>Audience</label>
          <label class="check sm"><input type="checkbox" name="needsQty" checked><i></i>Quantity</label>
          <select name="unit" aria-label="Counted">${unitOptionsHTML('pcs')}</select>
          <select name="brandGroup" aria-label="Brand group">${groupOptionsHTML(groups()[0]?.name)}</select>
          <button class="btn btn-primary btn-sm" type="submit">${icons.plus} Add category</button>
        </form>
      </section>

      <section class="set-card">
        <div class="set-card-head">
          <h2>${icons.box} Brand groups</h2>
          <p class="muted">Each category offers the brands in one group. Drag a brand onto another group to move it — the same brand may sit in several groups.</p>
        </div>
        <div id="set-groups">${groupsHTML()}</div>
        <form class="set-add" id="add-group">
          <input name="name" placeholder="New brand group — e.g. Solution brands" required>
          <button class="btn btn-primary btn-sm" type="submit">${icons.plus} Add group</button>
        </form>
      </section>

      <section class="set-card">
        <div class="set-card-head">
          <h2>${icons.logout} Branch access</h2>
          <p class="muted">Set the 6-digit code each branch signs in with. Codes are stored
             hashed on the server — nobody, including you, can read an existing one, so
             setting a new code is the way to recover a forgotten one.</p>
        </div>
        <div id="set-access"><p class="muted sm">Loading…</p></div>
      </section>`;
    wire();
    loadAccess();
  }

  // Re-rendering destroys the text box you may be typing in — the per-group
  // "add brand" forms and the rename inputs live inside the markup we replace.
  // These two let us put the caret back exactly where it was.
  function focusKey(el) {
    if (!el) return null;
    if (el.dataset.groupName != null) return ['name', el.dataset.groupName];
    const f = el.closest('form[data-add-brand]');
    if (f && el.name === 'name') return ['add', f.dataset.addBrand];
    return null;
  }
  function findByKey([kind, group]) {
    const g = CSS.escape(group);
    return kind === 'name'
      ? root.querySelector(`.set-bg-name[data-group-name="${g}"]`)
      : root.querySelector(`form[data-add-brand="${g}"] input[name="name"]`);
  }

  function refresh() {
    const a = document.activeElement;
    const key = a && root.contains(a) ? focusKey(a) : null;
    const held = key ? { value: a.value, start: a.selectionStart, end: a.selectionEnd } : null;

    const c = root.querySelector('#set-cats');
    const g = root.querySelector('#set-groups');
    if (c) c.innerHTML = categoriesHTML();
    if (g) g.innerHTML = groupsHTML();
    // The add-category form sits outside both mount points, so its group list
    // would otherwise go stale after a group is added, renamed or removed.
    const sel = root.querySelector('#add-cat select[name="brandGroup"]');
    if (sel) sel.innerHTML = groupOptionsHTML(sel.value);

    if (held) {
      const el = findByKey(key);
      if (el) {
        el.value = held.value;
        el.focus();
        try { el.setSelectionRange(held.start, held.end); } catch { /* not a text input */ }
      }
    }
  }

  function wire() {
    // Delegated: the per-group "add brand" forms live inside #set-groups, which
    // refresh() replaces wholesale — directly bound listeners would not survive.
    root.addEventListener('submit', e => {
      e.preventDefault();
      const f = e.target;
      const d = new FormData(f);
      const val = n => String(d.get(n) ?? '').trim();
      if (f.id === 'add-cat') {
        store.addCategory({
          name: val('name'),
          needsBrand: !!d.get('needsBrand'),
          needsAudience: !!d.get('needsAudience'),
          needsQty: !!d.get('needsQty'),
          unit: val('unit'),
          brandGroup: val('brandGroup'),
        });
      } else if (f.id === 'add-group') {
        store.addBrandGroup(val('name'));
      } else if (f.dataset.addBrand) {
        store.addBrand(f.dataset.addBrand, val('name'));
      } else if (f.dataset.set) {
        applyCode(f);
        return;                       // keeps the typed code until it succeeds
      } else return;
      f.reset();
    });

    root.addEventListener('change', e => {
      const d = e.target.dataset;
      if (d.flag) return store.updateCategory(d.cat, { [d.flag]: e.target.checked });
      if (d.catUnit) return store.updateCategory(d.catUnit, { unit: e.target.value });
      if (d.catGroup) return store.updateCategory(d.catGroup, { brandGroup: e.target.value });
      if (d.groupName) return store.renameBrandGroup(d.groupName, e.target.value);
    });

    root.addEventListener('click', e => {
      const dc = e.target.closest('[data-del-cat]');
      if (dc) return store.removeCategory(dc.dataset.delCat);
      const dg = e.target.closest('[data-del-group]');
      if (dg) return store.removeBrandGroup(dg.dataset.delGroup);
      const db = e.target.closest('[data-del-brand]');
      if (db) return store.removeBrand(db.dataset.group, db.dataset.delBrand);
    });

    // ── drag & drop ──
    // Three kinds of drag, each with its own coordinate space:
    //   cat   → index into settings.categories
    //   group → index into settings.brandGroups
    //   brand → index into that group's own brands array (hence data-group)
    let drag = null;

    const clearMarks = () => root.querySelectorAll('.drag-over, .drag-into')
      .forEach(el => el.classList.remove('drag-over', 'drag-into'));

    // Where a dragged brand would land: on a specific pill, or on the group as a
    // whole (append). The container target is what makes an empty group droppable.
    function brandTarget(e) {
      const pill = e.target.closest('.set-brand');
      if (pill) return { group: pill.dataset.group, to: +pill.dataset.idx, el: pill };
      const box = e.target.closest('[data-drop-group]');
      if (box) return { group: box.dataset.dropGroup, to: -1, el: box };
      return null;
    }

    root.addEventListener('dragstart', e => {
      const brand = e.target.closest('.set-brand');
      const grip = e.target.closest('.set-bg-head .drag-grip');
      const cat = e.target.closest('.set-cat');
      if (brand) { drag = { type: 'brand', from: +brand.dataset.idx, group: brand.dataset.group }; brand.classList.add('dragging'); }
      else if (grip) { const g = grip.closest('.set-bg'); drag = { type: 'group', from: +g.dataset.gidx }; g.classList.add('dragging'); }
      else if (cat) { drag = { type: 'cat', from: +cat.dataset.idx }; cat.classList.add('dragging'); }
      if (drag) e.dataTransfer.effectAllowed = 'move';
    });

    root.addEventListener('dragover', e => {
      if (!drag) return;
      clearMarks();
      if (drag.type === 'brand') {
        const t = brandTarget(e);
        if (!t) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (t.group === drag.group && t.to === drag.from) return;
        // Highlight the whole destination group so a cross-group move reads clearly.
        t.el.closest('.set-bg')?.classList.add('drag-into');
        if (t.to >= 0) t.el.classList.add('drag-over');
        return;
      }
      const t = e.target.closest(drag.type === 'cat' ? '.set-cat' : '.set-bg');
      if (!t) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const idx = drag.type === 'cat' ? +t.dataset.idx : +t.dataset.gidx;
      if (idx !== drag.from) t.classList.add('drag-over');
    });

    root.addEventListener('drop', e => {
      if (!drag) return;
      e.preventDefault();
      if (drag.type === 'brand') {
        const t = brandTarget(e);
        if (t) store.moveBrand(drag.group, drag.from, t.group, t.to);
      } else {
        const t = e.target.closest(drag.type === 'cat' ? '.set-cat' : '.set-bg');
        const to = t && (drag.type === 'cat' ? +t.dataset.idx : +t.dataset.gidx);
        if (t && to !== drag.from) {
          if (drag.type === 'cat') store.reorderCategories(drag.from, to);
          else store.reorderBrandGroups(drag.from, to);
        }
      }
      drag = null;
      clearMarks();
    });

    root.addEventListener('dragend', () => {
      drag = null;
      root.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
      clearMarks();
    });
  }

  return {
    mount(container) { root = container; render(); },
    // Only settings changes affect this screen. Redrawing for every fitting
    // order or stock request the network produces would throw away whatever
    // the admin is part-way through typing, for nothing.
    onChange(event) { if (event?.module === 'settings') refresh(); },
    unmount() {},
  };
}
