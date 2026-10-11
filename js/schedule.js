// ── Module 6: Schedule — the weekly staff scheduler, kept exactly as built ──
//
// The scheduler is its own app (scheduler.html), with its own look and its own
// rules, and it runs here inside a frame. It keeps no data of its own — not
// even a starting roster: it asks this page, and this page keeps it all in
// Postgres.
//
//   window.focSched.defaults         what "Reset to defaults" restores
//   window.focSched.load()           roster, branches, leave, special dates, presets
//   window.focSched.save(state)      the same, after every change
//   window.focSched.loadWeek(iso)    the schedule saved for a week, or null
//   window.focSched.saveWeek(r,e,b)  a week's schedule, with the people and
//                                    branches it was made from
//   window.focSched.viewer           true for a read-only look at one week
//
// Where it lives:
//   schedule_employees   one row per person — name, type, off days, branches
//   schedule_branches    one row per branch — city, hours per day, flags
//   schedule_state       leave, special dates, part-timers' days, pins, presets
//   schedule_weeks       every week made, and the copy last published
//   schedule_defaults    the roster "Reset to defaults" brings back
//
// Ghiath and the office edit, and a week stays theirs until one of them
// presses Publish. Every branch, and the public "View schedule" page, sees the
// published weeks that have not finished — this week and any ahead — and can
// narrow them to one person or one branch.
import { supabase } from './auth.js';
import { canEditSchedule } from './data.js';
import { esc, icons, toast, fmtDT } from './ui.js';

const FRAME = 'scheduler.html';

// ── rows ↔ the scheduler's own objects ─────────────────────────────────────
const empFromRow = r => ({
  id: r.id, name: r.name, optom: !!r.optom, type: r.type,
  weekendDays: r.weekend_days ?? [], priority: r.priority ?? [],
});
const branchFromRow = r => ({
  code: r.code, name: r.name, city: r.city, needsOptom: !!r.needs_optom, keep: !!r.keep,
  ...(r.split == null ? {} : { split: r.split }), days: r.days ?? {},
});
// Everything but the roster, as schedule_state keeps it.
const restOf = s => ({
  vacations: s.vacations ?? {}, overrides: s.overrides ?? [],
  pt_days: s.ptDays ?? {}, pins: s.pins ?? {}, presets: s.presets ?? [],
  week_start: s.weekStart || null,
});
const rosterOf = s => ({ employees: s.employees ?? [], branches: s.branches ?? [] });

// What reading a week needs to know about a person: the name on the chip, the
// optometrist mark, and their home branch for the "from MGM" tag. Leave,
// employee type and the rest of their priorities stay out of the published week.
const peopleFor = es => (es ?? []).map(e => ({
  id: e.id, name: e.name, optom: !!e.optom, priority: (e.priority ?? []).slice(0, 1),
}));

// Dates are counted in local time: in Oman, UTC midnight is still yesterday.
const isoOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const plusDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return isoOf(d);
};
const day = iso => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
export const weekLabel = iso => `${day(iso)} – ${day(plusDays(iso, 6))}`;

// ── reading it all, before the scheduler starts ─────────────────────────────
// The scheduler takes its starting roster the moment it loads, so everything
// is fetched first and the frame is only created once it has arrived.
//
// The roster moved into tables in schema-12; until that has run it is still
// two JSON columns of schedule_state, and this reads whichever is there.
const tableMissing = err => /schedule_(employees|branches|defaults)|does not exist|schema cache/i.test(err?.message ?? '');

async function fetchEditorData() {
  const [st, emps, brs, defs] = await Promise.all([
    supabase.from('schedule_state').select('*').eq('id', 1).maybeSingle(),
    supabase.from('schedule_employees').select('*').order('position'),
    supabase.from('schedule_branches').select('*').order('position'),
    supabase.from('schedule_defaults').select('employees, branches').eq('id', 1).maybeSingle(),
  ]);
  if (st.error) throw new Error(st.error.message);
  const tables = !emps.error && !brs.error;
  if (!tables && !tableMissing(emps.error ?? brs.error)) throw new Error((emps.error ?? brs.error).message);

  const row = st.data ?? {};
  const roster = tables
    ? { employees: emps.data.map(empFromRow), branches: brs.data.map(branchFromRow) }
    : { employees: row.employees ?? [], branches: row.branches ?? [] };
  const defaults = defs.data?.employees?.length ? defs.data : roster;
  const state = {
    ...roster,
    vacations: row.vacations ?? {}, overrides: row.overrides ?? [], ptDays: row.pt_days ?? {},
    pins: row.pins ?? {}, presets: row.presets ?? [],
    ...(row.week_start ? { weekStart: row.week_start } : {}),
  };
  return { tables, state, defaults };
}

// ── the editor's bridge ─────────────────────────────────────────────────────
// It also follows which week is open and whether that week is published, so
// the Publish bar above the frame can say so.
function editorBridge(data, onWeek) {
  const { tables } = data;
  let lastRest = JSON.stringify(restOf(data.state));
  let lastRoster = JSON.stringify(rosterOf(data.state));
  let timer = null;
  const saved = new Map();         // iso → result JSON as the database holds it
  const current = new Map();       // iso → result JSON as the scheduler holds it
  const published = new Map();     // iso → { json, at }
  const pending = new Map();       // iso → { timer, write }
  let open = null;
  let warned = false;
  const problem = (title, sub) => {
    if (warned) return;
    warned = true;
    toast({ title, sub, tone: 'stock', ms: 9000 });
    setTimeout(() => { warned = false; }, 9000);
  };
  const tell = () => onWeek?.(bridge.week());

  const writeWeek = async (iso, result, employees, branches, json) => {
    pending.delete(iso);
    const { error } = await supabase.from('schedule_weeks').upsert({
      week_start: iso, result, employees: peopleFor(employees), branches: branches ?? [],
    });
    if (error) { problem('The week did not save', error.message); return false; }
    saved.set(iso, json);
    tell();
    return true;
  };

  const bridge = {
    viewer: false,
    defaults: data.defaults,

    async load() { return JSON.parse(JSON.stringify(data.state)); },

    save(state) {
      const rest = restOf(state);
      const roster = rosterOf(state);
      const restJson = JSON.stringify(rest);
      const rosterJson = JSON.stringify(roster);
      if (restJson === lastRest && rosterJson === lastRoster) return;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (rosterJson !== lastRoster) {
          // An empty roster is a load gone wrong, not a decision — never write it.
          if (!roster.employees.length || !roster.branches.length) {
            problem('The roster was not saved', 'It has no employees or no branches. Reload the page to get the saved roster back.');
          } else if (tables) {
            const { error } = await supabase.rpc('save_schedule_roster', {
              p_employees: roster.employees, p_branches: roster.branches,
            });
            if (error) problem('The roster did not save', error.message.replace(/^.*?:\s*/, ''));
            else lastRoster = rosterJson;
          } else {
            Object.assign(rest, roster);       // before schema-12: still in schedule_state
          }
        }
        if (restJson !== lastRest || (!tables && rosterJson !== lastRoster && roster.employees.length)) {
          const { error } = await supabase.from('schedule_state').upsert({ id: 1, ...rest });
          if (error) problem('The schedule did not save', error.message);
          else { lastRest = restJson; if (!tables) lastRoster = rosterJson; }
        }
      }, 600);
    },

    async loadWeek(iso) {
      if (!iso) return null;
      open = iso;
      tell();
      const { data: w, error } = await supabase.from('schedule_weeks')
        .select('result, published, published_at').eq('week_start', iso).maybeSingle();
      if (error) { problem('Could not load that week', error.message); return null; }
      if (w) {
        const json = JSON.stringify(w.result);
        saved.set(iso, json);
        current.set(iso, json);
        if (w.published) published.set(iso, { json: JSON.stringify(w.published.result), at: w.published_at });
      } else {
        current.delete(iso);
      }
      if (open === iso) tell();
      return w?.result ?? null;
    },

    saveWeek(result, employees, branches) {
      const iso = result?.weekStartISO;
      if (!iso) return;
      const json = JSON.stringify(result);
      current.set(iso, json);
      tell();
      if (saved.get(iso) === json) return;
      clearTimeout(pending.get(iso)?.timer);
      const write = () => writeWeek(iso, result, employees, branches, json);
      pending.set(iso, { timer: setTimeout(write, 600), write });
    },

    // Where the open week stands, for the Publish bar.
    week() {
      const iso = open;
      const has = !!(iso && current.has(iso));
      const pub = iso ? published.get(iso) : null;
      return { iso, has, publishedAt: pub?.at ?? null, changed: !!(pub && has && pub.json !== current.get(iso)) };
    },

    // Copy the open week, as it stands, into what everyone else sees. An edit
    // still waiting to be written is written first, so what is published is
    // exactly what is on screen.
    async publish() {
      const iso = open;
      if (!iso || !current.has(iso)) return false;
      const wait = pending.get(iso);
      if (wait) {
        clearTimeout(wait.timer);
        if (!await wait.write()) return false;
      }
      const { data: at, error } = await supabase.rpc('publish_schedule_week', { p_week: iso });
      if (error) {
        toast({ title: 'The week was not published', sub: error.message.replace(/^.*?:\s*/, ''), tone: 'stock' });
        return false;
      }
      published.set(iso, { json: current.get(iso), at: at ?? new Date().toISOString() });
      tell();
      return true;
    },
  };
  return bridge;
}

// ── the viewer's bridge ─────────────────────────────────────────────────────
// One published week, already fetched, and nowhere to write it. The scheduler
// hides its controls when it sees `viewer`; the database refuses writes anyway.
function viewerBridge(week) {
  return {
    viewer: true,
    defaults: { employees: [], branches: [] },
    async load() {
      return {
        branches: week.branches, employees: week.employees,
        vacations: {}, overrides: [], ptDays: {}, presets: [], pins: {},
        weekStart: week.week_start,
      };
    },
    save() {},
    saveWeek() {},
    async loadWeek(iso) { return iso === week.week_start ? week.result : null; },
  };
}

const frameHTML = () => `<iframe class="sched-frame" src="${FRAME}" title="Staff schedule"></iframe>`;

// What a week is to someone reading it today.
function weekName(iso) {
  const today = isoOf(new Date());
  if (iso <= today && today < plusDays(iso, 7)) return 'This week';
  if (iso > today && iso <= plusDays(today, 7)) return 'Next week';
  return `Week of ${day(iso)}`;
}

// ── narrowing the grid to one person or one branch ──────────────────────────
// The grid belongs to the scheduler, so nothing in it is rebuilt: rows and
// chips that do not match are marked and hidden by a rule put in its page. A
// person's filter keeps only the branches they work at that week, and drops
// the "short" warnings, which are about the whole branch, not about them.
function filterGrid(doc, f) {
  if (!doc?.body) return null;
  if (!doc.getElementById('foc-filter-css')) {
    const s = doc.createElement('style');
    s.id = 'foc-filter-css';
    s.textContent = '[data-foc-hide]{display:none!important}';
    doc.head.appendChild(s);
  }
  const hide = (el, on) => (on ? el.setAttribute('data-foc-hide', '') : el.removeAttribute('data-foc-hide'));
  let shown = 0;
  doc.querySelectorAll('table.sched tbody tr').forEach(row => {
    const code = row.querySelector('.bcode')?.textContent.trim();
    let mine = false;
    row.querySelectorAll('.chip').forEach(chip => {
      const name = chip.querySelector('.cn')?.firstChild?.textContent.trim();
      const hit = !f.person || name === f.person;
      hide(chip, !hit);
      if (hit) mine = true;
    });
    row.querySelectorAll('.undertag').forEach(u => hide(u, !!f.person));
    const show = (!f.branch || code === f.branch) && (!f.person || mine);
    hide(row, !show);
    if (show) shown++;
  });
  return shown;
}

// The published weeks that have not finished, read-only, with the person and
// branch filters. Used by the Schedule section for the branches and by the
// public page, which has no sign-in.
export async function mountScheduleViewer(stage, subEl) {
  stage.innerHTML = `<div class="boot sched-boot"><span class="boot-spin"></span>Loading the schedule…</div>`;
  const { data, error } = await supabase.rpc('schedule_view');
  const weeks = Array.isArray(data) ? data : data ? [data] : [];
  if (error || !weeks.length) {
    if (subEl) subEl.textContent = 'Published weeks';
    stage.innerHTML = `
      <div class="empty">${icons.calendar}
        <p>${error ? 'The schedule could not be loaded.' : 'No schedule has been published yet.'}</p>
        ${error ? `<p class="muted">${esc(error.message)}</p>` : ''}
      </div>`;
    return;
  }
  weeks.sort((a, b) => (a.week_start < b.week_start ? -1 : 1));
  const today = isoOf(new Date());
  let pick = weeks.find(w => w.week_start <= today && today < plusDays(w.week_start, 7)) ?? weeks[0];
  const filter = { person: '', branch: '' };
  let frame = null;

  const apply = () => {
    const shown = filterGrid(frame?.contentDocument, filter);
    const note = stage.querySelector('#sf-note');
    if (!note || shown == null) return;
    note.textContent = shown > 0 || (!filter.person && !filter.branch) ? ''
      : filter.person && filter.branch ? `${filter.person} is not at ${filter.branch} this week`
      : filter.person ? `${filter.person} is not on this week’s schedule` : '';
  };

  const show = () => {
    if (subEl) subEl.textContent = `${weekName(pick.week_start)} · ${weekLabel(pick.week_start)}`;
    window.focSched = viewerBridge(pick);
    const people = [...new Set((pick.employees ?? []).map(e => e.name).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const branches = pick.branches ?? [];
    if (filter.person && !people.includes(filter.person)) filter.person = '';
    if (filter.branch && !branches.some(b => b.code === filter.branch)) filter.branch = '';
    stage.innerHTML = `
      ${weeks.length > 1 ? `<section class="chips sched-weeks">${weeks.map(w => `
        <button class="chip ${w === pick ? 'on' : ''}" data-week="${esc(w.week_start)}">
          ${esc(weekName(w.week_start))}<span class="chip-n">${esc(weekLabel(w.week_start))}</span>
        </button>`).join('')}</section>` : ''}
      <section class="toolbar sched-filter">
        <select class="sel" id="sf-person" aria-label="Employee">
          <option value="">All employees</option>
          ${people.map(n => `<option value="${esc(n)}" ${filter.person === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}
        </select>
        <select class="sel" id="sf-branch" aria-label="Branch">
          <option value="">All branches</option>
          ${branches.map(b => `<option value="${esc(b.code)}" ${filter.branch === b.code ? 'selected' : ''}>${esc(b.code)} — ${esc(b.name)}</option>`).join('')}
        </select>
        <button class="btn btn-ghost btn-sm" id="sf-clear" ${filter.person || filter.branch ? '' : 'hidden'}>${icons.x} Clear</button>
        <span class="muted" id="sf-note"></span>
      </section>
      ${frameHTML()}`;
    frame = stage.querySelector('iframe');
    // The grid appears a moment after the page does, and is drawn again if
    // the scheduler re-renders — so the filter follows every change to it.
    frame.addEventListener('load', () => {
      const doc = frame.contentDocument;
      if (!doc?.body) return;
      let queued = false;
      new MutationObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => { queued = false; apply(); });
      }).observe(doc.body, { childList: true, subtree: true });
      apply();
    });
  };

  stage.onclick = e => {
    const b = e.target.closest('[data-week]');
    if (b) {
      pick = weeks.find(w => w.week_start === b.dataset.week) ?? pick;
      show();
      return;
    }
    if (e.target.closest('#sf-clear')) {
      filter.person = '';
      filter.branch = '';
      stage.querySelector('#sf-person').value = '';
      stage.querySelector('#sf-branch').value = '';
      stage.querySelector('#sf-clear').hidden = true;
      apply();
    }
  };
  stage.onchange = e => {
    if (e.target.id === 'sf-person') filter.person = e.target.value;
    else if (e.target.id === 'sf-branch') filter.branch = e.target.value;
    else return;
    stage.querySelector('#sf-clear').hidden = !(filter.person || filter.branch);
    apply();
  };
  show();
}

export function scheduleView(me) {
  const editor = canEditSchedule(me.role);
  let root, bridge = null, busy = false;

  // The Publish bar: which week is open, whether the branches can see it, and
  // the one button that lets them.
  function barHTML(w) {
    if (!w?.iso) return '';
    const label = `${weekName(w.iso)} · ${weekLabel(w.iso)}`;
    let state, button;
    if (!w.has) {
      state = `<span class="pub-state">${icons.clock} Not made yet — generate it first</span>`;
      button = `<button class="btn btn-primary" disabled>${icons.send} Publish</button>`;
    } else if (!w.publishedAt) {
      state = `<span class="pub-state warn">${icons.clock} Not published — the branches can’t see this week</span>`;
      button = `<button class="btn btn-primary" data-publish ${busy ? 'disabled' : ''}>${icons.send} ${busy ? 'Publishing…' : 'Publish'}</button>`;
    } else if (w.changed) {
      state = `<span class="pub-state warn">${icons.clock} Changed since it was published ${esc(fmtDT(Date.parse(w.publishedAt)))}</span>`;
      button = `<button class="btn btn-primary" data-publish ${busy ? 'disabled' : ''}>${icons.send} ${busy ? 'Publishing…' : 'Publish changes'}</button>`;
    } else {
      state = `<span class="pub-state ok">${icons.check} Published ${esc(fmtDT(Date.parse(w.publishedAt)))} — the branches see this week</span>`;
      button = '';
    }
    return `<div class="pub-bar"><b>${esc(label)}</b>${state}${button}</div>`;
  }

  function paintBar(w) {
    const host = root?.querySelector('#sc-bar');
    if (host) host.innerHTML = barHTML(w);
  }

  async function mountEditor(stage) {
    stage.innerHTML = `<div class="boot sched-boot"><span class="boot-spin"></span>Loading the schedule…</div>`;
    let data;
    try {
      data = await fetchEditorData();
    } catch (e) {
      // Without what is saved, the scheduler would start empty — and an empty
      // start must never get the chance to be saved over the real one.
      stage.innerHTML = `
        <div class="empty">${icons.calendar}
          <p>The schedule could not be loaded, so it is not opened.</p>
          <p class="muted">${esc(e.message)}</p>
        </div>`;
      return;
    }
    if (!root?.isConnected) return;
    bridge = editorBridge(data, paintBar);
    window.focSched = bridge;
    stage.innerHTML = frameHTML();
  }

  function render() {
    root.innerHTML = `
      <header class="mod-head">
        <div>
          <h1>Schedule</h1>
          <p class="mod-sub" id="sc-sub">${editor
            ? 'Make the week, then publish it — the branches see published weeks only, from this week on.'
            : 'Published weeks'}</p>
        </div>
        ${editor ? '<div id="sc-bar"></div>' : ''}
      </header>
      <div class="sched-stage" id="sc-stage"></div>`;
    const stage = root.querySelector('#sc-stage');
    if (editor) {
      mountEditor(stage);
      root.querySelector('#sc-bar').addEventListener('click', async e => {
        if (!e.target.closest('[data-publish]') || busy || !bridge) return;
        busy = true;
        paintBar(bridge.week());
        const ok = await bridge.publish();
        busy = false;
        paintBar(bridge.week());
        if (ok) toast({ title: 'Week published', sub: `${weekLabel(bridge.week().iso)} — every branch can see it now`, tone: 'info' });
      });
    } else {
      mountScheduleViewer(stage, root.querySelector('#sc-sub'));
    }
  }

  return {
    mount(container) { root = container; render(); },
    // The scheduler keeps its own state; the rest of the network's chatter
    // must never redraw it from under whoever is editing.
    onChange() {},
    unmount() {},
  };
}
