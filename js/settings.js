// ── Module 3: Settings (admin) — request categories & brand groups ──
import { UNITS, TABS, tabOff, ROLES, BRANCHES, BRANCH_KINDS, LOCATIONS, labMode, LAB_MODES, PERMS, can, seesTab, tabByDefault } from './data.js';
import { store } from './store.js';
import { branchAccess, setBranchCode } from './auth.js';
import { BILL_ON } from './bill.js';
import { esc, icons, relTime, openLayer, toast } from './ui.js';

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
            <label class="check sm"><input type="checkbox" data-flag="needsBrand" data-cat="${esc(c.name)}" ${c.needsBrand ? 'checked' : ''}><i></i>Group</label>
            <label class="check sm"><input type="checkbox" data-flag="needsAudience" data-cat="${esc(c.name)}" ${c.needsAudience ? 'checked' : ''}><i></i>Audience</label>
            <label class="check sm"><input type="checkbox" data-flag="needsQty" data-cat="${esc(c.name)}" ${c.needsQty !== false ? 'checked' : ''}><i></i>Quantity</label>
          </div>
          <div class="set-cat-ctl">
            <label class="set-ctl"><span>Counted</span>
              <select data-cat-unit="${esc(c.name)}">${unitOptionsHTML(c.unit)}</select>
            </label>
            <label class="set-ctl"><span>Groups from</span>
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
  // Every account: a branch, or a person (schema-41).
  const PERSON_KINDS = ['person'];
  const accountOptions = sel => `<optgroup label="Branch">${kindOptions(sel)}</optgroup>
    <optgroup label="Person">${PERSON_KINDS.map(k => `<option value="${k}" ${sel === k ? 'selected' : ''}>${esc(ROLES[k].label)}</option>`).join('')}</optgroup>`;

  // ── Accounts (user 2026-10-20: "too messy… make it easier to navigate") ──
  // A plain list — one line per account, what matters at a glance — and a
  // panel per account, opened by clicking it, with everything in sections:
  // name, sign-in, what it can do and which tabs it sees, lens stock & lab,
  // open or closed. The list searches and filters; branches, then people.
  let accRows = [], accUi = { q: '', show: 'all' }, accDrawer = null;
  const isPersonRow = r => !BRANCH_KINDS.includes(r.role);
  // What it really sees (seesTab: by itself, hidden or given — schema-57).
  const tabsSummary = code => {
    const L = LOCATIONS.find(l => l.code === code);
    const n = TABS.filter(t => seesTab(t.key, L)).length;
    return n === TABS.length ? 'All tabs' : `${n} of ${TABS.length} tabs`;
  };
  const seenText = r => (!r.active ? 'Closed — cannot sign in' : r.has_account
    ? (r.last_sign_in ? `Signed in ${relTime(Date.parse(r.last_sign_in))}` : 'Never signed in')
    : 'No sign-in account');

  async function loadBranches() {
    const host = root.querySelector('#set-branches');
    if (!host) return;
    const { rows, error } = await branchAccess();
    if (!root.contains(host)) return;
    if (error) { host.innerHTML = `<p class="muted sm">Could not load the accounts — ${esc(error)}</p>`; return; }
    accRows = rows;
    drawAccounts();
    accDrawer?.update();
  }

  function drawAccounts() {
    const host = root.querySelector('#set-branches');
    if (!host) return;
    const q = accUi.q.trim().toLowerCase();
    const fits = r => (!q || [r.code, r.name, LOCATIONS.find(l => l.code === r.code)?.nameAr, ROLES[r.role]?.label].some(v => String(v ?? '').toLowerCase().includes(q)))
      && (accUi.show === 'all' || (accUi.show === 'branch' && !isPersonRow(r)) || (accUi.show === 'person' && isPersonRow(r)) || (accUi.show === 'closed' && !r.active));
    const n = k => accRows.filter(r => (k === 'branch' ? !isPersonRow(r) : k === 'person' ? isPersonRow(r) : k === 'closed' ? !r.active : true)).length;
    const group = (title, list) => (list.length ? `
      <div class="acc-group"><h3>${title} <span>${list.length}</span></h3>
        <div class="acc-list">${list.map(rowHTML).join('')}</div></div>` : '');
    const shown = accRows.filter(fits);
    host.innerHTML = `
      <div class="acc-tools">
        <div class="searchbox">${icons.search}<input id="acc-q" placeholder="Search name, code, kind…" value="${esc(accUi.q)}"></div>
        <div class="chips status-chips">${[['all', 'All'], ['branch', 'Branches'], ['person', 'People'], ['closed', 'Closed']].map(([k, l]) =>
          `<button type="button" class="chip ${accUi.show === k ? 'on' : ''}" data-acc-show="${k}">${l} <span class="chip-n">${n(k)}</span></button>`).join('')}</div>
      </div>
      ${group('Branches', shown.filter(r => !isPersonRow(r)))}
      ${group('People', shown.filter(isPersonRow))}
      ${shown.length ? '' : `<div class="empty">${icons.search}<p>No account matches.</p></div>`}`;
  }

  function rowHTML(r) {
    const L = LOCATIONS.find(l => l.code === r.code);
    const tags = [
      !r.active ? '<span class="acc-tag t-closed">Closed</span>' : '',
      r.holds_lens_stock ? `<span class="acc-tag t-lens">${icons.lens} Lens stock</span>` : '',
      r.role === 'fitting' && r.active && labMode(r.code) !== 'on' ? `<span class="acc-tag t-lab">Lab ${labMode(r.code) === 'off' ? 'off' : 'in-house only'}</span>` : '',
    ].join('');
    return `
      <button type="button" class="acc-row ${r.active ? '' : 'is-closed'}" data-acc="${esc(r.code)}">
        <span class="loc-chip">${esc(r.code)}</span>
        <span class="acc-name"><b>${esc(r.name)}</b>${L?.nameAr ? `<span dir="rtl" lang="ar">${esc(L.nameAr)}</span>` : ''}</span>
        <span class="acc-kind">${esc(ROLES[r.role]?.label ?? r.role)}</span>
        <span class="acc-tags">${tags}</span>
        <span class="acc-access"><span>${esc(permSummary(r.code))}</span><span>${esc(tabsSummary(r.code))}</span></span>
        <span class="acc-seen">${esc(seenText(r))}</span>
        ${icons.chevronRight}
      </button>`;
  }

  // One account, in sections. The controls carry the same data-* as before,
  // so the same handlers save them.
  function accountDrawer(code) {
    accDrawer = openLayer('drawer', () => accountHTML(code), { onClose: () => { accDrawer = null; } });
    const el = accDrawer.el;
    el.addEventListener('change', e => {
      const d = e.target.dataset;
      if (d.brName != null) {
        const v = e.target.value.trim();
        if (!v) { e.target.value = LOCATIONS.find(l => l.code === d.brName)?.name ?? ''; return; }
        return store.saveBranch(d.brName, { name: v });
      }
      if (d.brAr != null) return store.setBranchNameAr(d.brAr, e.target.value.trim());
      if (d.brRole) return saveRole(e.target);
      if (d.brOpen) return saveOpen(e.target);
      if (d.brLens) return saveLens(e.target);
      if (d.brLab) return store.setLab(d.brLab, e.target.value);
      if (d.brBillpx != null) {
        const v = e.target.value.trim().toUpperCase();
        if (v && !/^[A-Z]{1,8}$/.test(v)) { toast({ title: 'Letters only, A to Z', tone: 'stock' }); e.target.value = LOCATIONS.find(l => l.code === code)?.billPrefix || code; return; }
        return store.setBillPrefix(code, v === code ? '' : v);
      }
      if (d.accTab) {
        // Unticked: hidden. Ticked where it would not show by itself: given.
        const L = LOCATIONS.find(l => l.code === code);
        const boxes = [...el.querySelectorAll('[data-acc-tab]')];
        const hidden = boxes.filter(x => !x.checked).map(x => x.dataset.accTab);
        const shown = boxes.filter(x => x.checked && !tabByDefault(x.dataset.accTab, L)).map(x => x.dataset.accTab);
        return store.setTabs(code, hidden, shown);
      }
    });
    el.addEventListener('submit', e => {
      const f = e.target.closest('form[data-set]');
      if (f) { e.preventDefault(); applyCode(f); }
    });
    el.addEventListener('click', e => {
      if (e.target.closest('[data-close]')) return accDrawer?.close();
      const back = () => { if (root.isConnected && root.querySelector('#set-branches')) accountDrawer(code); };
      if (e.target.closest('[data-br-perms]')) return permissionsModal(code, back);
      if (e.target.closest('[data-br-del]')) return deleteBranchModal(code);
    });
  }

  function accountHTML(code) {
    const r = accRows.find(x => x.code === code);
    const L = LOCATIONS.find(l => l.code === code);
    if (!r || !L) return `<div class="dw-body"><p class="muted">This account is gone.</p></div>`;
    const person = isPersonRow(r), fitting = r.role === 'fitting' && r.active;
    const lensLocked = r.holds_lens_stock;
    const off = (on, why) => (on ? '' : `disabled title="${esc(why)}"`);
    const sec = (icon, title, body, sub = '') => `
      <section class="acc-sec"><h3>${icons[icon]} ${title}</h3>${sub ? `<p class="acc-sub">${sub}</p>` : ''}${body}</section>`;
    return `
      <div class="dw-head">
        <div>
          <div class="dw-kicker">${esc(code)} · ${esc(ROLES[r.role]?.label ?? r.role)}</div>
          <h2>${esc(r.name)} ${r.active ? '<span class="acc-tag t-open">Open</span>' : '<span class="acc-tag t-closed">Closed</span>'}</h2>
          <div class="dw-sub">${esc(seenText(r))}</div>
        </div>
        <button class="icon-btn" data-close>${icons.x}</button>
      </div>
      <div class="dw-body acc-body">
        ${sec('tag', 'Name and kind', `
          <div class="acc-grid">
            <label>Name<input data-br-name="${esc(code)}" value="${esc(r.name)}" required></label>
            ${person ? '' : `<label>Arabic name <span class="opt">for the WhatsApp message</span><input dir="rtl" lang="ar" data-br-ar="${esc(code)}" value="${esc(L.nameAr ?? '')}" placeholder="الاسم بالعربية"></label>`}
            <label>Kind<select data-br-role="${esc(code)}">${accountOptions(r.role)}</select></label>
            ${BILL_ON && !person ? `<label>Bill letters <span class="opt">in front of its bill numbers</span><input data-br-billpx="${esc(code)}" value="${esc(L.billPrefix || code)}" maxlength="8" style="text-transform:uppercase" placeholder="${esc(code)}"></label>` : ''}
          </div>`)}
        ${sec('lock', 'Sign-in code', `
          <form class="ba-set acc-code" data-set="${esc(code)}" autocomplete="off">
            <input name="code" inputmode="numeric" maxlength="6" pattern="\\d{6}" placeholder="New 6-digit code" ${r.has_account && r.active ? '' : 'disabled'}>
            <button class="btn btn-ghost btn-sm" type="submit" ${r.has_account && r.active ? '' : 'disabled'}>Set code</button>
          </form>
          <div class="ba-msg"></div>`, r.active ? 'The code it signs in with. Setting a new one does not sign it out.' : 'Closed — open it again to set a code.')}
        ${sec('shield', 'What it can do', `
          <button type="button" class="btn btn-ghost acc-perm" data-br-perms="${esc(code)}">${icons.shield} Access Permissions <em>${esc(permSummary(code))}</em> ${icons.chevronRight}</button>`)}
        ${sec('menu', 'Tabs it sees', `
          <div class="acc-tabs">${TABS.map(tb => {
            const given = !tabByDefault(tb.key, L) && seesTab(tb.key, L);
            return `
            <label class="acc-tab"><span class="cbx"><input type="checkbox" data-acc-tab="${tb.key}" ${seesTab(tb.key, L) ? 'checked' : ''}><i></i></span>${icons[tb.icon] ?? ''}<span>${esc(tb.label)}${given ? ' <em class="acc-given">given</em>' : ''}</span></label>`;
          }).join('')}</div>`,
          'Ticked = in its sidebar now. Lens Stock shows by itself to a lens-stock holder and Outside Lens Orders to the outside-lens handler (both to anyone who sees every branch); tick them to give them to anyone else.')}
        ${sec('lens', 'Lens stock and lab', `
          <label class="acc-switch ${r.active ? '' : 'is-off'}">
            <span class="sw"><input type="checkbox" data-br-lens="${esc(code)}" ${r.holds_lens_stock ? 'checked' : ''} ${off(r.active, 'Open the account first')}><i></i></span>
            <span><b>Holds lens stock</b><span>Its own shelf in Lens Stock that other branches can request from.${fitting ? '' : ' Not a fitting centre, so the lenses are sent to whoever asks.'}</span></span>
          </label>
          ${r.role === 'fitting' ? `<label class="acc-lab">Lab
            <select class="sel" data-br-lab="${esc(code)}" ${off(fitting, 'Open it first')}>${LAB_MODES.map(([k, l]) => `<option value="${k}" ${labMode(code) === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
            <span class="acc-sub">In-house only: it cuts its own jobs; other branches cannot send any. Off: nothing.</span></label>` : '<p class="acc-sub">Only a fitting centre has a lab.</p>'}`)}
        ${sec('power', 'Open or closed', `
          <label class="acc-switch ${lensLocked ? 'is-off' : ''}">
            <span class="sw"><input type="checkbox" data-br-open="${esc(code)}" ${r.active ? 'checked' : ''} ${off(!lensLocked, 'Holds lens stock, so it stays open')}><i></i></span>
            <span><b>${r.active ? 'Open' : 'Closed'}</b><span>Closed: off the sign-in screen and the lists; everything it recorded stays.</span></span>
          </label>
          <button type="button" class="btn btn-ghost btn-sm acc-del" data-br-del="${esc(code)}" ${lensLocked || code === me.code ? 'disabled' : ''}
            title="${lensLocked ? 'Holds lens stock — stop that first' : code === me.code ? 'You are signed in with it' : 'Only for an account added by mistake, with nothing recorded'}">${icons.trash} Delete account</button>`)}
      </div>`;
  }

  // ── Access permissions (schema-50): tick boxes per account ──
  const permsOf = code => LOCATIONS.find(l => l.code === code)?.perms ?? [];
  function permSummary(code) {
    const ps = permsOf(code), all = PERMS.filter(([k]) => k !== 'view_only').map(([k]) => k);
    const n = all.filter(k => ps.includes(k)).length;
    const view = ps.includes('view_only') ? ' · view only' : '';
    return n === all.length ? `Full access${view}` : n ? `${n} of ${all.length}${view}` : `Own branch only${view}`;
  }
  function permissionsModal(code, back = null) {
    const b = LOCATIONS.find(l => l.code === code);
    if (!b) return;
    const had = new Set(permsOf(code));
    let done = false;
    const layer = openLayer('modal', () => `
      <div class="dw-head">
        <div><div class="dw-kicker">${esc(code)} · ${esc(b.name)}</div><h2>Access Permissions</h2></div>
        <button class="icon-btn" data-close>${icons.x}</button>
      </div>
      <form class="form perm-form" id="perm-form">
        <p class="muted sm">${BRANCH_KINDS.includes(b.role) ? 'A branch always has its own work. Tick what it may do beyond that.' : 'Tick what this person may do in the portal.'}</p>
        <div class="perm-list">
          ${PERMS.filter(([k]) => k !== 'view_only').map(([k, label, help]) => `
          <label class="perm-row"><span class="cbx"><input type="checkbox" name="p" value="${k}" ${had.has(k) ? 'checked' : ''}><i></i></span>
            <span class="perm-txt"><b>${esc(label)}</b><span>${esc(help)}</span></span></label>`).join('')}
        </div>
        <label class="perm-row perm-view"><span class="cbx"><input type="checkbox" name="p" value="view_only" ${had.has('view_only') ? 'checked' : ''}><i></i></span>
          <span class="perm-txt"><b>View only</b><span>Sees what the ticks above allow, but changes nothing — not even with a tick that changes things.</span></span></label>
        <div class="form-foot">
          <button type="button" class="btn btn-ghost" data-close>Cancel</button>
          <button type="submit" class="btn btn-primary">${icons.check} Save</button>
        </div>
      </form>`, { onClose: () => { if (back) setTimeout(back, 300); } });
    layer.el.addEventListener('click', e => { if (e.target.closest('[data-close]')) layer.close(); });
    layer.el.addEventListener('submit', async e => {
      e.preventDefault();
      const perms = new FormData(e.target).getAll('p').map(String);
      if (code === me.code && had.has('accounts') && !perms.includes('accounts')
          && !confirm('Take "Settings: accounts & codes" off your own account?\n\nYou will no longer be able to manage accounts.')) return;
      if (await store.setPermissions(code, perms)) { layer.close(); loadBranches(); }
    });
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
    // A person starts able to look, not change (schema-50); a branch is what was chosen.
    const person = root.querySelector('#add-kind .chip.on')?.dataset.kind === 'person';
    const done = await store.addBranch({ code: d.get('code'), name: d.get('name'), role: person ? d.get('personRole') : d.get('role'), pin });
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
    const toPerson = !BRANCH_KINDS.includes(role), fromPerson = !BRANCH_KINDS.includes(b.role);
    if (toPerson !== fromPerson) {
      const ask = toPerson
        ? `Make ${b.name} a person (${ROLES[role].label})?\n\nIt stops being a branch: it leaves the branch lists and can no longer be sent frames or chosen for collection. Everything it recorded stays.`
        : `Make ${b.name} a branch (${ROLES[role].label})?\n\nIt becomes a place: it can log orders and appears in the branch lists.`;
      if (!confirm(ask)) { sel.value = b.role; return; }
      return store.saveBranch(code, { role });
    }
    const note = role === 'fitting'
      ? `${b.name} will be offered in “Send to Fitting” from now on.`
      : b.role === 'fitting'
        ? `${b.name} will no longer be offered in “Send to Fitting”.${away ? ` The ${away} frame${away === 1 ? '' : 's'} with it now will finish their journey as normal.` : ''}`
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

  // ── Employees: the staff by full name (schema-45) ──
  // Their own list — the Direct Insurance salesperson list reads it. The
  // schedule's roster (short names, branches, days off) is the Schedule tab's
  // own and is edited there (user, 2026-10-18).
  let staffCount = null, staffData = null;

  async function loadStaff() {
    const host = root.querySelector('#set-staff');
    if (!host) return;
    try { staffData = await store.loadEmployees(); }
    catch (err) { host.innerHTML = `<p class="muted sm">Could not load the employees — ${esc(err.message)}</p>`; return; }
    if (!root.contains(host)) return;
    staffCount = staffData.length;
    host.innerHTML = staffData.length ? `<div class="emp-list">${staffData.map(e => `
      <div class="emp-row">
        <b>${esc(e.name)}</b>
        <div class="row-act">
          <button class="icon-btn" data-emp-edit="${esc(e.id)}" title="Rename">${icons.wrench}</button>
          <button class="icon-btn" data-emp-del="${esc(e.id)}" title="Remove">${icons.trash}</button>
        </div>
      </div>`).join('')}</div>` : `<div class="empty">${icons.users}<p>No employees yet — add the first one.</p></div>`;
  }

  function employeeModal(id) {
    if (!staffData) return;
    const old = staffData.find(e => e.id === id);
    const layer = openLayer('modal', () => `
      <div class="dw-head">
        <div><div class="dw-kicker">${old ? 'Rename employee' : 'New employee'}</div><h2>${old ? esc(old.name) : 'Add an employee'}</h2></div>
        <button class="icon-btn" data-close>${icons.x}</button>
      </div>
      <form class="form" id="emp-form" autocomplete="off">
        <label>Full name<input name="name" required value="${esc(old?.name ?? '')}" placeholder="First and last name — e.g. Ahmad Al Khalili"></label>
        <div class="form-foot">
          <button type="button" class="btn btn-ghost" data-close>Cancel</button>
          <button type="submit" class="btn btn-primary">${icons.check} ${old ? 'Save' : 'Add employee'}</button>
        </div>
      </form>`);
    layer.el.querySelector('input[name=name]')?.focus();
    layer.el.addEventListener('click', e => { if (e.target.closest('[data-close]')) layer.close(); });
    layer.el.addEventListener('submit', async e => {
      e.preventDefault();
      const name = String(new FormData(e.target).get('name') ?? '').trim().replace(/\s+/g, ' ');
      if (!name) return;
      if (await store.saveEmployee({ id: old?.id, name }, !old)) layer.close();
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
    const row = form.closest('.br-row, .ba-row, .acc-body');
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

  // ── Data usage (schema-52; user 2026-10-20) ──
  // How much of the Pro plan's 8 GB the database uses, what takes it, and how
  // fast it grows — from one reading a day the database takes by itself.
  let usage = null, usageLoading = false;
  const bytes = n => {
    const v = Number(n) || 0;
    if (v < 1024 * 1024) return `${Math.max(1, Math.round(v / 1024))} KB`;
    if (v < 1024 ** 3) return `${(v / 1024 ** 2).toFixed(v < 10 * 1024 ** 2 ? 1 : 0)} MB`;
    return `${(v / 1024 ** 3).toFixed(2)} GB`;
  };
  // Each table, under the tab it belongs to.
  const AREAS = [
    ['Fitting Log', ['orders', 'order_events'], c => `${c.orders} order${c.orders === 1 ? '' : 's'}`],
    ['Reimbursement Invoice & Direct Insurance', ['claims', 'claim_items', 'claim_prescriptions'], c => `${c.claims} invoice${c.claims === 1 ? '' : 's'}`],
    ['Stock Requests', ['stock_requests', 'stock_request_lines', 'stock_request_events'], c => `${c.stock_requests} request${c.stock_requests === 1 ? '' : 's'}`],
    ['Lens Stock', ['lens_requests', 'lens_request_lines', 'lens_request_events', 'lens_stock', 'lens_catalogue'], c => `${c.lens_requests} lens request${c.lens_requests === 1 ? '' : 's'}`],
    ['Outside Lens Orders', ['outside_lens_orders'], c => `${c.outside} order${c.outside === 1 ? '' : 's'}`],
    ['Damaged Stock', ['damaged_reports', 'damaged_lines'], c => `${c.damaged} report${c.damaged === 1 ? '' : 's'}`],
    ['Schedule', t => t.startsWith('schedule_'), () => ''],
  ];
  async function loadUsage() {
    if (usageLoading) return;
    usageLoading = true;
    try { usage = await store.storageUsage(); }
    catch (err) {
      const host = root.querySelector('#set-usage');
      if (host) host.innerHTML = `<p class="muted sm">Could not read the data usage — ${esc(err.message)}</p>`;
      return;
    } finally { usageLoading = false; }
    const host = root.querySelector('#set-usage');
    if (host) host.innerHTML = usageHTML();
    const ix = root.querySelector('.set-index');
    if (ix) ix.outerHTML = listHTML();
  }
  function usageHTML() {
    const u = usage, limit = u.limit_bytes, db = u.db_bytes;
    const tables = u.tables ?? [];
    const data = tables.reduce((s, t) => s + t.bytes, 0);
    const pct = db / limit * 100;
    const taken = new Set();
    const areas = AREAS.map(([name, which, label]) => {
      const mine = tables.filter(t => (typeof which === 'function' ? which(t.t) : which.includes(t.t)));
      mine.forEach(t => taken.add(t.t));
      return { name, size: mine.reduce((s, t) => s + t.bytes, 0), label: label(u.counts ?? {}) };
    });
    areas.push({ name: 'Accounts, settings & the rest', size: tables.filter(t => !taken.has(t.t)).reduce((s, t) => s + t.bytes, 0), label: '' });
    areas.sort((a, b) => b.size - a.size);
    const top = Math.max(...areas.map(a => a.size), 1);

    // Growth: from the readings of the last 90 days.
    const hist = (u.history ?? []).slice(-90);
    let growth;
    if (hist.length >= 7) {
      const a = hist[0], b = hist[hist.length - 1];
      const days = Math.max(1, (new Date(b.day) - new Date(a.day)) / 864e5);
      const perDay = (b.data - a.data) / days;
      if (perDay <= 0) growth = `<p class="us-growth"><b>Not growing</b> over the last ${Math.round(days)} days.</p>`;
      else {
        const years = (limit - db) / (perDay * 365);
        growth = `<p class="us-growth">Growing about <b>${bytes(perDay * 30)} a month</b> — at this pace the 8 GB lasts <b>${years > 50 ? 'more than 50 years' : `about ${Math.round(years)} year${Math.round(years) === 1 ? '' : 's'}`}</b>.</p>`;
      }
    } else {
      growth = `<p class="us-growth muted">${hist.length} daily reading${hist.length === 1 ? '' : 's'} so far — the database takes one every night. How fast it grows shows after a week.</p>`;
    }
    const W = 600, H = 120, max = Math.max(...hist.map(h => h.data), 1);
    const bw = W / Math.max(hist.length, 1);
    const chart = hist.length ? `
      <div class="us-chart">
        <div class="us-chart-head"><span>Your records, one reading a day</span><span>${bytes(max)}</span></div>
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Your records over the last ${hist.length} days">
          ${hist.map((h, i) => {
            const bh = Math.max(2, h.data / max * (H - 4));
            return `<rect x="${(i * bw + 1).toFixed(1)}" y="${(H - bh).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${bh.toFixed(1)}" rx="${Math.min(4, bw / 3).toFixed(1)}"><title>${esc(h.day)} · ${bytes(h.data)} (whole database ${bytes(h.db)})</title></rect>`;
          }).join('')}
        </svg>
        <div class="us-chart-foot"><span>${esc(hist[0].day)}</span><span>${esc(hist[hist.length - 1].day)}</span></div>
      </div>` : '';

    return `
      <div class="us-top">
        <div class="us-big"><b>${bytes(db)}</b><span>of 8 GB used</span></div>
        <div class="us-pct">${pct < 0.1 ? '< 0.1' : pct.toFixed(pct < 10 ? 1 : 0)}%</div>
      </div>
      <div class="us-bar" title="${bytes(db)} of 8 GB"><i style="width:${Math.max(0.6, Math.min(100, pct)).toFixed(2)}%"></i></div>
      <p class="muted sm">Your records are <b>${bytes(data)}</b> of it — the part that grows. The rest is the database’s own fixed parts. (The disk also keeps about 330 MB of system files that do not grow; Supabase enlarges the disk by itself if it is ever needed.)</p>
      <h3 class="us-h">Growth</h3>
      ${growth}
      ${chart}
      <h3 class="us-h">What takes the space</h3>
      <div class="us-areas">${areas.map(a => `
        <div class="us-area">
          <span class="us-area-name"><b>${esc(a.name)}</b>${a.label ? `<span>${esc(a.label)}</span>` : ''}</span>
          <span class="us-area-bar"><i style="width:${Math.max(1, a.size / top * 100).toFixed(1)}%"></i></span>
          <span class="us-area-size">${bytes(a.size)}</span>
        </div>`).join('')}</div>`;
  }

  // Settings opens on a list; each entry opens its own page, with a way back.
  // Which one is open is only this screen's state — it starts on the list.
  let page = null;
  const count = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
  // Grouped: what applies to the whole portal, then one page per sidebar tab
  // that has something to set — named and drawn like the tab itself. A page
  // may hold several sections (Stock Requests: categories and brand groups).
  const PAGES = [
    { key: 'tabs',   group: 'General', icon: 'menu',   title: 'Tabs', sections: ['tabs'], need: 'lists',
      desc: 'Switch sidebar tabs off while they are being worked on',
      sum: () => { const n = (store.settings.disabledTabs ?? []).length; return n ? `${n} under maintenance` : 'All on'; } },
    { key: 'branches', group: 'General', icon: 'warehouse', title: 'Accounts', sections: ['branches', 'addBranch'], need: 'accounts',
      desc: 'Every sign-in — branches and people: name, sign-in code, what each can do and which tabs it sees, lens stock, open or closed',
      sum: () => { const shut = LOCATIONS.filter(l => l.active === false).length; return `${BRANCHES.length} open${shut ? ` · ${shut} closed` : ''}`; } },
    { key: 'usage', group: 'General', icon: 'database', title: 'Data usage', sections: ['usage'], need: 'accounts',
      desc: 'How much of the 8 GB the database uses, what takes the space, and how fast it grows',
      sum: () => (usage ? `${bytes(usage.db_bytes)} of 8 GB` : '') },
    { key: 'staff', group: 'General', icon: 'users', title: 'Employees', sections: ['staff'], need: 'accounts',
      desc: 'The staff by full name — the Direct Insurance salesperson list. The schedule keeps its own in the Schedule tab',
      sum: () => (staffCount == null ? '' : count(staffCount, 'employee')) },
    { key: 'stock',  group: 'By tab',  icon: 'box',    title: 'Stock Requests', sections: ['cats', 'groups'], need: 'lists',
      desc: 'Categories — the fields each needs, how it is counted — and the brand groups they offer',
      sum: () => `${count(store.settings.categories.length, 'category', 'categories')} · ${count(groups().length, 'brand group')}` },
    { key: 'direct', group: 'By tab',  icon: 'shield', title: 'Direct Insurance', sections: ['ins'], need: 'lists',
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
          <label class="check sm"><input type="checkbox" name="needsBrand" checked><i></i>Group</label>
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
          <h2>${icons.warehouse} Accounts</h2>
        </div>
        <div id="set-branches"><p class="muted sm">Loading…</p></div>
      </section>`,
    usage: () => `
      <section class="set-card">
        <div class="set-card-head">
          <h2>${icons.database} Data usage</h2>
        </div>
        <div id="set-usage">${usage ? usageHTML() : '<p class="muted sm">Reading…</p>'}</div>
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
          <select name="personRole" class="br-person-role" aria-label="What kind of person" hidden>${PERSON_KINDS.map(k => `<option value="${k}">${esc(ROLES[k].label)}</option>`).join('')}</select>
          <input name="pin" class="br-pin-in" inputmode="numeric" maxlength="6" placeholder="Sign-in code" required>
          <button class="btn btn-primary btn-sm" type="submit">${icons.plus} <span class="br-add-l">Add branch</span></button>
        </form>
        <div class="ba-msg" id="add-branch-msg"></div>
      </section>`,
  };

  // Each page shows to an account with its permission (schema-50).
  const myPages = () => PAGES.filter(pg => can(me, pg.need));
  function listHTML() {
    const heads = [...new Set(myPages().map(pg => pg.group))];
    return `<div class="set-index">${heads.map(h => `
      <h2 class="set-group">${esc(h)}</h2>
      ${myPages().filter(pg => pg.group === h).map(pg => `
      <button class="set-entry" data-page="${pg.key}">
        <span class="set-entry-ico">${icons[pg.icon]}</span>
        <span class="set-entry-txt"><b>${esc(pg.title)}</b><span>${esc(pg.desc)}</span></span>
        <span class="set-entry-sum">${esc(pg.sum())}</span>
        ${icons.chevronRight}
      </button>`).join('')}`).join('')}</div>`;
  }

  function render() {
    const pg = myPages().find(x => x.key === page);
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
    // Read fresh on opening the page; on the list, once, for its summary.
    if (pg?.sections.includes('usage') || (!pg && !usage && can(me, 'accounts'))) loadUsage();
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

    root.addEventListener('input', e => {
      if (e.target.id !== 'acc-q') return;
      accUi.q = e.target.value;
      const at = e.target.selectionStart;
      drawAccounts();
      const q = root.querySelector('#acc-q'); q.focus(); q.setSelectionRange(at, at);
    });
    root.addEventListener('click', e => {
      const acc = e.target.closest('[data-acc]');
      if (acc) return accountDrawer(acc.dataset.acc);
      const show = e.target.closest('[data-acc-show]');
      if (show) { accUi.show = show.dataset.accShow; return drawAccounts(); }
      const kind = e.target.closest('#add-kind [data-kind]');
      if (kind) return setAddKind(kind.dataset.kind);
      if (e.target.closest('[data-emp-new]')) return employeeModal(null);
      const ee = e.target.closest('[data-emp-edit]');
      if (ee) return employeeModal(ee.dataset.empEdit);
      const ed = e.target.closest('[data-emp-del]');
      if (ed) {
        const emp = staffData?.find(x => x.id === ed.dataset.empDel);
        if (emp && confirm(`Remove ${emp.name} from the employees?\n\nThey leave the salesperson list. Sales already recorded keep their name. The schedule is not changed.`)) store.deleteEmployee(emp.id, emp.name);
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
