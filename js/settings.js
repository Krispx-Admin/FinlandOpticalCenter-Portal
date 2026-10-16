// ── Module 3: Settings (admin) — request categories & brand groups ──
import { UNITS, TABS, tabOff, ROLES, BRANCHES, BRANCH_KINDS, LOCATIONS, labMode, LAB_MODES } from './data.js';
import { store } from './store.js';
import { branchAccess, setBranchCode } from './auth.js';
import { esc, icons, relTime, openLayer } from './ui.js';

export function settingsView(me) {
  let root;

  const groups = () => store.settings.brandGroups;
  const usedBy = name => store.settings.categories.filter(c => c.brandGroup === name).length;

  // "No brands" leads the list: picking it is the same as unticking Brand. It
  // also shows when a category points at a group that no longer exists, so a
  // dangling pointer is visible rather than silently showing group one.
  function groupOptionsHTML(selected, noBrands = false) {
    const gs = groups();
    const none = noBrands || !gs.some(g => g.name === selected);
    return `<option value="" ${none ? 'selected' : ''}>No brands</option>`
      + gs.map(g => `<option value="${esc(g.name)}" ${!none && g.name === selected ? 'selected' : ''}>${esc(g.name)}</option>`).join('');
  }

  const unitOptionsHTML = selected =>
    UNITS.map(u => `<option value="${u.value}" ${(selected === 'box' ? 'box' : 'pcs') === u.value ? 'selected' : ''}>${esc(u.label)}</option>`).join('');

  function categoriesHTML() {
    const cats = store.settings.categories;
    if (!cats.length) return `<div class="empty">${icons.tag}<p>No categories yet — add one below.</p></div>`;
    return cats.map((c, i) => `
      <div class="set-cat" data-idx="${i}">
        <span class="drag-grip" draggable="true" title="Drag to reorder">${icons.grip}</span>
        <div class="set-cat-body">
          <div class="set-cat-name">${icons.tag}<input class="set-bg-name set-cat-input" value="${esc(c.name)}" data-cat-name="${esc(c.name)}" aria-label="Category name" title="Click to rename"></div>
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
              <select data-cat-group="${esc(c.name)}"
                title="${c.needsBrand ? 'Which brand group this category offers' : 'This category does not ask for a brand'}">
                ${groupOptionsHTML(c.brandGroup, !c.needsBrand)}
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

  // One switch per sidebar tab. Off = greyed for the branches, "under maintenance".
  function tabsHTML() {
    const ready = store.settings.hasDisabledTabs !== false;
    return `<div class="tab-list">${TABS.map(t => {
      const off = tabOff(store.settings, t.key);
      return `
      <label class="tab-row ${off ? 'is-off' : ''}">
        <span class="tab-ico">${icons[t.icon]}</span>
        <span class="tab-name"><b>${esc(t.label)}</b>${t.note ? `<span class="muted"> · ${esc(t.note)}</span>` : ''}</span>
        <span class="tab-state">${off ? '<i>Under maintenance</i>' : 'On'}</span>
        <span class="sw"><input type="checkbox" data-tab="${t.key}" data-tab-label="${esc(t.label)}" ${off ? '' : 'checked'} ${ready ? '' : 'disabled'}><i></i></span>
      </label>`;
    }).join('')}</div>`;
  }

  function insurersHTML() {
    const list = store.settings.insurers ?? [];
    if (!list.length) return `<div class="empty">${icons.receipt}<p>No insurers yet — add the first below.</p></div>`;
    return `<div class="set-brands">${list.map(n => `
      <span class="set-brand set-plain">${esc(n)}<button class="brand-x" data-del-ins="${esc(n)}" title="Remove">${icons.x}</button></span>`).join('')}</div>`;
  }

  // Every location: rename it, set what it is, close or reopen it, and give it
  // a new sign-in code. Read through a database function that checks the
  // caller is the office, so a branch calling it directly gets nothing back.
  const kindOptions = sel => BRANCH_KINDS.map(k =>
    `<option value="${k}" ${sel === k ? 'selected' : ''}>${esc(ROLES[k].label)}</option>`).join('');

  async function loadBranches() {
    const host = root.querySelector('#set-branches');
    if (!host) return;
    const { rows, error } = await branchAccess();
    if (!root.contains(host)) return;
    if (error) { host.innerHTML = `<p class="muted sm">Could not load the branches — ${esc(error)}</p>`; return; }
    // Branches first, then the people — the office, Ghiath and the view-only
    // admins sign in too, but are never a place (user, 2026-10-17).
    const isPerson = r => !BRANCH_KINDS.includes(r.role);
    const ordered = [...rows.filter(r => !isPerson(r)), ...rows.filter(isPerson)];
    const firstPerson = ordered.find(isPerson)?.code;
    host.innerHTML = ordered.map(r => {
      const fixed = !BRANCH_KINDS.includes(r.role);
      // A view-only admin (Wijdan, Sarah) can be closed; the office and Ghiath cannot.
      const keep = (fixed && r.role !== 'manager') || r.holds_lens_stock;
      return `${r.code === firstPerson ? '<h3 class="br-sub">People</h3>' : ''}
      <div class="br-row ${r.active ? '' : 'is-closed'}" data-branch="${esc(r.code)}">
        <span class="loc-chip">${esc(r.code)}</span>
        <input class="br-name" data-br-name="${esc(r.code)}" value="${esc(r.name)}" aria-label="Name of ${esc(r.code)}" required>
        ${fixed ? `<span class="br-fixed">${esc(ROLES[r.role]?.label ?? r.role)}</span>`
          : `<select class="br-role" data-br-role="${esc(r.code)}" aria-label="What ${esc(r.code)} is"
               ${r.holds_lens_stock ? 'disabled title="Holds lens stock, so it stays a fitting centre"' : ''}>${kindOptions(r.role)}</select>`}
        <div class="ba-seen muted sm">${!r.active ? 'closed — cannot sign in' : r.has_account
          ? (r.last_sign_in ? 'last signed in ' + relTime(Date.parse(r.last_sign_in)) : 'never signed in')
          : 'no account'}</div>
        <form class="ba-set" data-set="${esc(r.code)}">
          <input name="code" inputmode="numeric" maxlength="6" pattern="\\d{6}"
                 placeholder="new code" ${r.has_account && r.active ? '' : 'disabled'} autocomplete="off">
          <button class="btn btn-ghost btn-sm" type="submit" ${r.has_account && r.active ? '' : 'disabled'}>Set</button>
        </form>
        ${keep ? `<span class="br-open muted sm" title="${fixed ? 'The office and the schedule editor are always open' : 'Holds lens stock'}">Always open</span>`
          : `<label class="br-open"><span class="sw"><input type="checkbox" data-br-open="${esc(r.code)}" ${r.active ? 'checked' : ''}><i></i></span><span>${r.active ? 'Open' : 'Closed'}</span></label>`}
        ${fixed ? '<span></span>' : `<button class="icon-btn br-del" data-br-del="${esc(r.code)}" title="${r.holds_lens_stock ? 'Holds lens stock — stop that first' : 'Delete this branch'}" ${r.holds_lens_stock ? 'disabled' : ''}>${icons.trash}</button>`}
        ${r.role === 'fitting' && r.active ? `
        <label class="br-lens br-bench" title="In-house only: it cuts its own jobs, other branches can't send any. Off: nothing.">
          <span>Lab</span>
          <select class="sel sel-sm" data-br-lab="${esc(r.code)}">${LAB_MODES.map(([k, l]) => `<option value="${k}" ${labMode(r.code) === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        </label>
        <label class="br-lens" title="Keeps loose-lens stock other branches can request from">
          <span class="sw"><input type="checkbox" data-br-lens="${esc(r.code)}" ${r.holds_lens_stock ? 'checked' : ''}><i></i></span>
          <span>${r.holds_lens_stock ? 'Holds lens stock' : 'No lens stock'}</span>
        </label>` : ''}
        ${r.role === 'manager' ? `
        <label class="br-lens" title="Shows the Export (Insurance Sales) button in Direct Insurance">
          <span class="sw"><input type="checkbox" data-br-export="${esc(r.code)}" ${LOCATIONS.find(l => l.code === r.code)?.canExport ? 'checked' : ''}><i></i></span>
          <span>Can export Insurance Sales</span>
        </label>` : ''}
        <div class="ba-msg"></div>
      </div>`;
    }).join('');
  }

  // Branch or Person: a person has no kind to choose — it is a view-only admin.
  function setAddKind(kind) {
    const person = kind === 'person';
    root.querySelectorAll('#add-kind .chip').forEach(c => c.classList.toggle('on', c.dataset.kind === kind));
    const f = root.querySelector('#add-branch');
    if (!f) return;
    f.elements.role.hidden = person;
    f.querySelector('.br-person-role').hidden = !person;
    f.elements.code.placeholder = person ? 'Code — e.g. WIJDAN' : 'Code — e.g. NGM';
    f.elements.name.placeholder = person ? 'Name — e.g. Wijdan' : 'Name — e.g. Nizwa Grand Mall';
    f.querySelector('.br-add-l').textContent = person ? 'Add person' : 'Add branch';
  }

  async function addBranch(form) {
    const d = new FormData(form);
    const msg = root.querySelector('#add-branch-msg');
    const pin = String(d.get('pin') ?? '').trim();
    msg.className = 'ba-msg';
    if (!/^\d{6}$/.test(pin)) { msg.classList.add('bad'); msg.textContent = 'The sign-in code is six digits.'; return; }
    msg.textContent = 'Adding…';
    // A person is a view-only admin (role 'manager'); a branch is what was chosen.
    const person = root.querySelector('#add-kind .chip.on')?.dataset.kind === 'person';
    const done = await store.addBranch({ code: d.get('code'), name: d.get('name'), role: person ? 'manager' : d.get('role'), pin });
    if (!done) { msg.textContent = ''; return; }
    form.reset();
    msg.classList.add('good');
    msg.textContent = 'Added — it is on the sign-in screen now.';
    setTimeout(() => { msg.textContent = ''; msg.className = 'ba-msg'; }, 6000);
  }

  // Changing what a branch is, or closing it, changes what other people see:
  // say what will happen first.
  function saveRole(sel) {
    const code = sel.dataset.brRole, b = LOCATIONS.find(l => l.code === code);
    const role = sel.value;
    if (!b || role === b.role) return;
    const away = store.state.orders.filter(o => o.fitter === code && !['delivered', 'collected'].includes(o.status)).length;
    const what = ROLES[role].label.toLowerCase();
    const note = role === 'fitting'
      ? `${b.name} will be offered in “Send to fitter” from now on.`
      : b.role === 'fitting'
        ? `${b.name} will no longer be offered in “Send to fitter”.${away ? ` The ${away} frame${away === 1 ? '' : 's'} with it now will finish their journey as normal.` : ''}`
        : '';
    if (!confirm(`Make ${b.name} a ${what}?\n\n${note}`.trim())) { sel.value = b.role; return; }
    store.saveBranch(code, { role });
  }

  function saveLens(box) {
    const code = box.dataset.brLens, b = LOCATIONS.find(l => l.code === code);
    if (!b) return;
    const on = box.checked;
    const ask = on
      ? `Make ${b.name} hold lens stock?\n\nIt gets its own shelf in Lens Stock, and every branch can request lenses from it.`
      : `Stop ${b.name} holding lens stock?\n\nIts shelf has to be empty and nothing may be waiting on it.`;
    if (!confirm(ask)) { box.checked = !on; return; }
    store.setLensHolder(code, on);
  }

  // Deleting is for a branch added by mistake: it must have nothing recorded,
  // and the code is typed back to be sure. Anything else is closed instead.
  function deleteBranchModal(code) {
    const b = LOCATIONS.find(l => l.code === code);
    if (!b) return;
    const layer = openLayer('modal', () => `
      <div class="dw-head">
        <div><div class="dw-kicker">Delete branch</div><h2>Delete ${esc(b.name)}?</h2></div>
        <button class="icon-btn" data-close>${icons.x}</button>
      </div>
      <div class="form">
        <p>This removes <b>${esc(b.code)} · ${esc(b.name)}</b> and its sign-in account for good. It cannot be undone.</p>
        <label>Type <b>${esc(b.code)}</b> to confirm
          <input id="del-code" autocomplete="off" placeholder="${esc(b.code)}">
        </label>
        <div class="form-foot">
          <button class="btn btn-ghost" data-close>Cancel</button>
          <button class="btn btn-danger" data-do-del disabled>${icons.trash} Delete branch</button>
        </div>
      </div>`);
    const input = layer.el.querySelector('#del-code');
    const go = layer.el.querySelector('[data-do-del]');
    input.focus();
    input.addEventListener('input', () => { go.disabled = input.value.trim().toUpperCase() !== b.code; });
    layer.el.addEventListener('click', async e => {
      if (e.target.closest('[data-close]')) return layer.close();
      if (e.target.closest('[data-do-del]') && !go.disabled) {
        go.disabled = true;
        const done = await store.deleteBranch(code);
        if (done) layer.close(); else go.disabled = false;
      }
    });
  }

  // ── Employees: the schedule's roster ──
  const STAFF_TYPES = ['Stable', 'High-Stable', 'High', 'Medium', 'Low', 'Non-Stable', 'Part-Time'];
  const WEEK = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  let staffCount = null, staffData = null;

  async function loadStaff() {
    const host = root.querySelector('#set-staff');
    if (!host) return;
    try { staffData = await store.loadEmployees(); }
    catch (err) { host.innerHTML = `<p class="muted sm">Could not load the employees — ${esc(err.message)}</p>`; return; }
    if (!root.contains(host)) return;
    staffCount = staffData.employees.length;
    const bname = c => staffData.branches.find(b => b.code === c)?.name ?? c;
    host.innerHTML = staffData.employees.length ? staffData.employees.map(e => `
      <div class="st-row">
        <div class="st-who"><b>${esc(e.name)}</b>${e.optom ? '<span class="st-tag">Optometrist</span>' : ''}</div>
        <div class="st-br">${(e.priority ?? []).map((c, i) => `<span class="loc-chip ${i ? 'st-alt' : ''}" title="${esc(bname(c))}${i ? '' : ' — home branch'}">${esc(c)}</span>`).join('') || '<span class="muted sm">No branch</span>'}</div>
        <div class="st-type muted sm">${esc(e.type)}</div>
        <div class="st-off muted sm">${(e.weekend_days ?? []).length ? `Off ${esc(e.weekend_days.join(', '))}` : 'No days off set'}</div>
        <div class="row-act">
          <button class="icon-btn" data-emp-edit="${esc(e.id)}" title="Edit">${icons.wrench}</button>
          <button class="icon-btn" data-emp-del="${esc(e.id)}" title="Remove">${icons.trash}</button>
        </div>
      </div>`).join('') : `<div class="empty">${icons.users}<p>No employees yet — add the first one.</p></div>`;
  }

  function employeeModal(id) {
    if (!staffData) return;
    const old = staffData.employees.find(e => e.id === id);
    const pri = old?.priority ?? [];
    const draft = {
      name: old?.name ?? '', optom: !!old?.optom, type: old?.type ?? 'Stable',
      home: pri[0] ?? staffData.branches[0]?.code ?? '', also: pri.slice(1), off: old?.weekend_days ?? [],
    };
    const layer = openLayer('modal', () => `
      <div class="dw-head">
        <div><div class="dw-kicker">${old ? 'Edit employee' : 'New employee'}</div><h2>${old ? esc(old.name) : 'Add an employee'}</h2></div>
        <button class="icon-btn" data-close>${icons.x}</button>
      </div>
      <form class="form" id="emp-form" autocomplete="off">
        <div class="grid2">
          <label>Name<input name="name" required value="${esc(draft.name)}" placeholder="e.g. Ahmed"></label>
          <label>Home branch<select name="home">${staffData.branches.map(b => `<option value="${esc(b.code)}" ${draft.home === b.code ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>
        </div>
        <div class="fieldset">
          <div class="fs-head"><span>Can also work at</span></div>
          <div class="emp-checks">${staffData.branches.map(b => `
            <label class="check sm"><input type="checkbox" name="also" value="${esc(b.code)}" ${draft.also.includes(b.code) ? 'checked' : ''}><i></i>${esc(b.code)}</label>`).join('')}</div>
        </div>
        <div class="grid2">
          <label>Type<select name="type">${STAFF_TYPES.map(s => `<option ${draft.type === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
          <label class="check emp-optom"><input type="checkbox" name="optom" ${draft.optom ? 'checked' : ''}><i></i>Optometrist</label>
        </div>
        <div class="fieldset">
          <div class="fs-head"><span>Days off</span></div>
          <div class="emp-checks">${WEEK.map(d => `
            <label class="check sm"><input type="checkbox" name="off" value="${d}" ${draft.off.includes(d) ? 'checked' : ''}><i></i>${d}</label>`).join('')}</div>
        </div>
        <p class="muted sm">If the Schedule tab is open somewhere, reload it before saving the schedule.</p>
        <div class="form-foot">
          <button type="button" class="btn btn-ghost" data-close>Cancel</button>
          <button type="submit" class="btn btn-primary">${icons.check} ${old ? 'Save changes' : 'Add employee'}</button>
        </div>
      </form>`);
    layer.el.addEventListener('click', e => { if (e.target.closest('[data-close]')) layer.close(); });
    layer.el.addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target;
      const d = new FormData(f);
      const name = String(d.get('name') ?? '').trim();
      if (!name) return;
      const home = String(d.get('home') ?? '');
      // The home branch leads; the rest follow in the schedule's own order.
      const also = d.getAll('also').map(String).filter(c => c !== home);
      const id = old?.id ?? `e${Date.now().toString(36)}`;
      const position = old?.position ?? (Math.max(-1, ...staffData.employees.map(x => x.position ?? 0)) + 1);
      const ok = await store.saveEmployee({
        id, name, optom: !!d.get('optom'), type: String(d.get('type')),
        weekendDays: WEEK.filter(w => d.getAll('off').includes(w)),
        priority: [home, ...also].filter(Boolean), position,
      }, !old);
      if (ok) layer.close();
    });
  }

  function saveOpen(box) {
    const code = box.dataset.brOpen, b = LOCATIONS.find(l => l.code === code);
    if (!b) return;
    const open = box.checked;
    const ask = open
      ? `Reopen ${b.name}? It comes back on the sign-in screen and can sign in again with its old code.`
      : `Close ${b.name}?\n\nIt leaves the sign-in screen and the lists, and can no longer sign in. Everything it recorded stays.`;
    if (!confirm(ask)) { box.checked = !open; return; }
    store.saveBranch(code, { active: open });
  }

  async function applyCode(form) {
    const branch = form.dataset.set;
    const row = form.closest('.br-row, .ba-row');
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

  // Settings opens on a list; each entry opens its own page, with a way back.
  // Which one is open is only this screen's state — it starts on the list.
  let page = null;
  const count = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
  // Grouped: what applies to the whole portal, then one page per sidebar tab
  // that has something to set — named and drawn like the tab itself. A page
  // may hold several sections (Stock Requests: categories and brand groups).
  const PAGES = [
    { key: 'tabs',   group: 'General', icon: 'menu',   title: 'Tabs', sections: ['tabs'],
      desc: 'Switch sidebar tabs off while they are being worked on',
      sum: () => { const n = (store.settings.disabledTabs ?? []).length; return n ? `${n} under maintenance` : 'All on'; } },
    { key: 'branches', group: 'General', icon: 'warehouse', title: 'Branches & people', sections: ['branches', 'addBranch'],
      desc: 'Add branches and people, rename them, set what each branch is, close one, and the code each signs in with',
      sum: () => { const shut = LOCATIONS.filter(l => l.active === false).length; return `${BRANCHES.length} open${shut ? ` · ${shut} closed` : ''}`; } },
    { key: 'staff', group: 'General', icon: 'users', title: 'Employees', sections: ['staff'],
      desc: 'Everyone on the staff schedule and the Direct Insurance salesperson list',
      sum: () => (staffCount == null ? '' : count(staffCount, 'employee')) },
    { key: 'stock',  group: 'By tab',  icon: 'box',    title: 'Stock Requests', sections: ['cats', 'groups'],
      desc: 'Categories — the fields each needs, how it is counted — and the brand groups they offer',
      sum: () => `${count(store.settings.categories.length, 'category', 'categories')} · ${count(groups().length, 'brand group')}` },
    { key: 'direct', group: 'By tab',  icon: 'shield', title: 'Direct Insurance', sections: ['ins'],
      desc: 'The insurers a branch picks from for an insurance customer',
      sum: () => count((store.settings.insurers ?? []).length, 'insurer') },
  ];

  const SECTIONS = {
    tabs: () => `
      <section class="set-card">
        <div class="set-card-head">
          <h2>${icons.menu} Tabs</h2>
        </div>
        <div id="set-tabs">${tabsHTML()}</div>
      </section>`,
    cats: () => `
      <section class="set-card">
        <div class="set-card-head">
          <h2>${icons.tag} Categories</h2>
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
      </section>`,
    groups: () => `
      <section class="set-card">
        <div class="set-card-head">
          <h2>${icons.box} Brand groups</h2>
        </div>
        <div id="set-groups">${groupsHTML()}</div>
        <form class="set-add" id="add-group">
          <input name="name" placeholder="New brand group — e.g. Solution brands" required>
          <button class="btn btn-primary btn-sm" type="submit">${icons.plus} Add group</button>
        </form>
      </section>`,
    ins: () => `
      <section class="set-card">
        <div class="set-card-head">
          <h2>${icons.shield} Insurers</h2>
        </div>
        <div id="set-ins">${insurersHTML()}</div>
        <form class="set-add" id="add-ins">
          <input name="name" placeholder="New insurer" required>
          <button class="btn btn-primary btn-sm" type="submit">${icons.plus} Add insurer</button>
        </form>
      </section>`,
    branches: () => `
      <section class="set-card">
        <div class="set-card-head">
          <h2>${icons.warehouse} Branches</h2>
        </div>
        <div id="set-branches"><p class="muted sm">Loading…</p></div>
      </section>`,
    staff: () => `
      <section class="set-card">
        <div class="set-card-head">
          <h2>${icons.users} Employees</h2>
        </div>
        <div id="set-staff"><p class="muted sm">Loading…</p></div>
        <div class="set-add"><button class="btn btn-primary btn-sm" data-emp-new>${icons.plus} Add employee</button></div>
      </section>`,
    addBranch: () => `
      <section class="set-card">
        <div class="set-card-head">
          <h2>${icons.plus} Add a branch or a person</h2>
        </div>
        <div class="chips status-chips br-kind" id="add-kind">
          <button type="button" class="chip on" data-kind="branch">Branch</button>
          <button type="button" class="chip" data-kind="person">Person</button>
        </div>
        <form class="set-add br-add" id="add-branch" autocomplete="off">
          <input name="code" class="br-code-in" placeholder="Code — e.g. NGM" maxlength="10" required>
          <input name="name" placeholder="Name — e.g. Nizwa Grand Mall" required>
          <select name="role" aria-label="What it is">${kindOptions('retail')}</select>
          <span class="br-fixed br-person-role" hidden>${esc(ROLES.manager.label)}</span>
          <input name="pin" class="br-pin-in" inputmode="numeric" maxlength="6" placeholder="Sign-in code" required>
          <button class="btn btn-primary btn-sm" type="submit">${icons.plus} <span class="br-add-l">Add branch</span></button>
        </form>
        <div class="ba-msg" id="add-branch-msg"></div>
      </section>`,
  };

  function listHTML() {
    const heads = [...new Set(PAGES.map(pg => pg.group))];
    return `<div class="set-index">${heads.map(h => `
      <h2 class="set-group">${esc(h)}</h2>
      ${PAGES.filter(pg => pg.group === h).map(pg => `
      <button class="set-entry" data-page="${pg.key}">
        <span class="set-entry-ico">${icons[pg.icon]}</span>
        <span class="set-entry-txt"><b>${esc(pg.title)}</b><span>${esc(pg.desc)}</span></span>
        <span class="set-entry-sum">${esc(pg.sum())}</span>
        ${icons.chevronRight}
      </button>`).join('')}`).join('')}</div>`;
  }

  function render() {
    const pg = PAGES.find(x => x.key === page);
    root.innerHTML = pg ? `
      <header class="mod-head set-page-head">
        <div>
          <button class="set-back" data-page="">${icons.chevronRight} All settings</button>
          <h1>${esc(pg.title)}</h1>
        </div>
      </header>
      <div class="${pg.sections.length === 1 ? 'set-single' : ''}">${pg.sections.map(s => SECTIONS[s]()).join('')}</div>` : `
      <header class="mod-head">
        <div>
          <h1>Settings</h1>
          <p class="mod-sub">Choose what to change</p>
        </div>
      </header>
      ${listHTML()}`;
    if (pg?.sections.includes('branches')) loadBranches();
    if (pg?.sections.includes('staff')) loadStaff();
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
    const ins = root.querySelector('#set-ins');
    if (ins) ins.innerHTML = insurersHTML();
    const tabs = root.querySelector('#set-tabs');
    if (tabs) tabs.innerHTML = tabsHTML();
    if (root.querySelector('#set-branches')) loadBranches();
    if (root.querySelector('#set-staff')) loadStaff();
    if (!page) { const ix = root.querySelector('.set-index'); if (ix) ix.outerHTML = listHTML(); }
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
          needsBrand: !!d.get('needsBrand') && val('brandGroup') !== '',
          needsAudience: !!d.get('needsAudience'),
          needsQty: !!d.get('needsQty'),
          unit: val('unit'),
          brandGroup: val('brandGroup') || undefined,
        });
      } else if (f.id === 'add-group') {
        store.addBrandGroup(val('name'));
      } else if (f.id === 'add-branch') {
        addBranch(f);
        return;
      } else if (f.id === 'add-ins') {
        store.addInsurer(val('name'));
      } else if (f.dataset.addBrand) {
        store.addBrand(f.dataset.addBrand, val('name'));
      } else if (f.dataset.set) {
        applyCode(f);
        return;                       // keeps the typed code until it succeeds
      } else return;
      f.reset();
    });

    root.addEventListener('change', e => {
      // The add-category row: the Brand tick and "Brands from" move together.
      const add = e.target.closest('#add-cat');
      if (add) {
        const tick = add.querySelector('[name="needsBrand"]');
        const sel = add.querySelector('[name="brandGroup"]');
        if (e.target === tick) sel.value = tick.checked ? (sel.value || groups()[0]?.name || '') : '';
        if (e.target === sel) tick.checked = sel.value !== '';
        return;
      }
      const d = e.target.dataset;
      if (d.tab) return store.setTabOff(d.tab, !e.target.checked, d.tabLabel);
      if (d.brName != null) {
        const v = e.target.value.trim();
        if (!v) { e.target.value = LOCATIONS.find(l => l.code === d.brName)?.name ?? ''; return; }
        return store.saveBranch(d.brName, { name: v });
      }
      if (d.brRole) return saveRole(e.target);
      if (d.brOpen) return saveOpen(e.target);
      if (d.brLens) return saveLens(e.target);
      if (d.brLab) return store.setLab(d.brLab, e.target.value);
      if (d.brExport) return store.setInsuranceExport(d.brExport, e.target.checked);
      if (d.flag) {
        // Ticking Brand on a category with no group gives it the first one.
        const cat = store.settings.categories.find(c => c.name === d.cat);
        const noGroup = !groups().some(g => g.name === cat?.brandGroup);
        return store.updateCategory(d.cat, d.flag === 'needsBrand' && e.target.checked && noGroup
          ? { needsBrand: true, brandGroup: groups()[0]?.name }
          : { [d.flag]: e.target.checked });
      }
      if (d.catUnit) return store.updateCategory(d.catUnit, { unit: e.target.value });
      if (d.catGroup) return store.updateCategory(d.catGroup, e.target.value
        ? { needsBrand: true, brandGroup: e.target.value }
        : { needsBrand: false });
      if (d.groupName) return store.renameBrandGroup(d.groupName, e.target.value);
      if (d.catName != null) {
        const v = e.target.value.trim();
        if (!v || v === d.catName) { e.target.value = d.catName; return; }
        if (store.settings.categories.some(c => c.name.toLowerCase() === v.toLowerCase() && c.name !== d.catName)) {
          e.target.value = d.catName;
          return alert(`There is already a category called “${v}”.`);
        }
        return store.renameCategory(d.catName, v);
      }
    });

    root.addEventListener('click', e => {
      const kind = e.target.closest('#add-kind [data-kind]');
      if (kind) return setAddKind(kind.dataset.kind);
      const bd = e.target.closest('[data-br-del]');
      if (bd) return deleteBranchModal(bd.dataset.brDel);
      if (e.target.closest('[data-emp-new]')) return employeeModal(null);
      const ee = e.target.closest('[data-emp-edit]');
      if (ee) return employeeModal(ee.dataset.empEdit);
      const ed = e.target.closest('[data-emp-del]');
      if (ed) {
        const emp = staffData?.employees.find(x => x.id === ed.dataset.empDel);
        if (emp && confirm(`Remove ${emp.name} from the employees?\n\nThey leave the staff schedule and the salesperson list. Sales already recorded keep their name.`)) store.deleteEmployee(emp.id, emp.name);
        return;
      }
      const go = e.target.closest('[data-page]');
      if (go) { page = go.dataset.page || null; render(); root.scrollIntoView?.({ block: 'start' }); return; }
      const di = e.target.closest('[data-del-ins]');
      if (di) return store.removeInsurer(di.dataset.delIns);
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
    mount(container) { root = container; render(); wire(); },
    // Only settings changes affect this screen. Redrawing for every fitting
    // order or stock request the network produces would throw away whatever
    // the admin is part-way through typing, for nothing.
    // A failed save redraws too, so a field puts back what is really stored.
    onChange(event) { if (event?.module === 'settings' || event?.failed) refresh(); },
    unmount() {},
  };
}
