// ── Module 6: Schedule — the weekly staff scheduler, kept exactly as built ──
//
// The scheduler is its own app (scheduler.html), with its own look and its own
// rules, and it runs here unchanged inside a frame. What it no longer does is
// keep its data in one browser: it asks this page for its data and hands its
// changes back, and this page keeps them in Postgres.
//
//   window.focSched.load()           the saved roster, branches, leave, presets
//   window.focSched.save(state)      the same, after every change
//   window.focSched.loadWeek(iso)    the schedule saved for a week, or null
//   window.focSched.saveWeek(r,e,b)  a week's schedule, with the people and
//                                    branches it was made from
//   window.focSched.viewer           true for a read-only look at one week
//
// Ghiath and the office edit. Everyone else — every branch, and the public
// "View schedule" page — sees the week that is running, through a database
// function that hands out that week and nothing older.
import { supabase } from './auth.js';
import { canEditSchedule } from './data.js';
import { esc, icons, toast } from './ui.js';

const FRAME = 'scheduler.html';

// The scheduler's own document keys, and the columns they are kept in.
const toRow = s => ({
  branches: s.branches ?? [], employees: s.employees ?? [],
  vacations: s.vacations ?? {}, overrides: s.overrides ?? [],
  pt_days: s.ptDays ?? {}, pins: s.pins ?? {}, presets: s.presets ?? [],
  week_start: s.weekStart || null,
});
const fromRow = r => ({
  branches: r.branches, employees: r.employees, vacations: r.vacations,
  overrides: r.overrides, ptDays: r.pt_days, pins: r.pins, presets: r.presets,
  ...(r.week_start ? { weekStart: r.week_start } : {}),
});

// What reading a week needs to know about a person: the name on the chip, the
// optometrist mark, and their home branch for the "from MGM" tag. Leave,
// employee type and the rest of their priorities stay out of the published week.
const peopleFor = es => (es ?? []).map(e => ({
  id: e.id, name: e.name, optom: !!e.optom, priority: (e.priority ?? []).slice(0, 1),
}));

const day = iso => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
const plusDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
export const weekLabel = iso => `${day(iso)} – ${day(plusDays(iso, 6))}`;

// ── the editor's bridge ─────────────────────────────────────────────────────
// Nothing is written until the saved state has been read. If that read fails,
// the scheduler would start from its built-in roster — and writing that back
// would wipe the real one — so a failed read leaves this bridge read-only.
function editorBridge() {
  let canWrite = false;
  let last = null;                 // what the database holds, to skip echoes
  const lastWeek = new Map();
  let timer = null;
  const weekTimers = new Map();
  let warned = false;
  const problem = (title, sub) => {
    if (warned) return;
    warned = true;
    toast({ title, sub, tone: 'stock', ms: 9000 });
    setTimeout(() => { warned = false; }, 9000);
  };

  return {
    viewer: false,

    async load() {
      const { data, error } = await supabase.from('schedule_state').select('*').eq('id', 1).maybeSingle();
      if (error) {
        problem('Could not load the saved schedule', `${error.message} — nothing will be saved until you reload.`);
        return null;
      }
      canWrite = true;
      // An empty row is a first run: the scheduler starts from its own roster
      // and the save that follows puts that roster in the database.
      if (!data || !(data.employees ?? []).length) return null;
      const s = fromRow(data);
      last = JSON.stringify(toRow(s));
      return s;
    },

    save(state) {
      if (!canWrite) return;
      const row = toRow(state);
      const json = JSON.stringify(row);
      if (json === last) return;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const { error } = await supabase.from('schedule_state').upsert({ id: 1, ...row });
        if (error) problem('The schedule did not save', error.message);
        else last = json;
      }, 600);
    },

    async loadWeek(iso) {
      if (!iso) return null;
      const { data, error } = await supabase.from('schedule_weeks')
        .select('result').eq('week_start', iso).maybeSingle();
      if (error) { problem('Could not load that week', error.message); return null; }
      if (data) lastWeek.set(iso, JSON.stringify(data.result));
      return data?.result ?? null;
    },

    saveWeek(result, employees, branches) {
      const iso = result?.weekStartISO;
      if (!canWrite || !iso) return;
      const json = JSON.stringify(result);
      if (lastWeek.get(iso) === json) return;
      clearTimeout(weekTimers.get(iso));
      weekTimers.set(iso, setTimeout(async () => {
        const { error } = await supabase.from('schedule_weeks').upsert({
          week_start: iso, result, employees: peopleFor(employees), branches: branches ?? [],
        });
        if (error) problem('The week did not save', error.message);
        else lastWeek.set(iso, json);
      }, 600));
    },
  };
}

// ── the viewer's bridge ─────────────────────────────────────────────────────
// One week, already fetched, and nowhere to write it. The scheduler hides its
// controls when it sees `viewer`; the database would refuse a write anyway.
function viewerBridge(week) {
  return {
    viewer: true,
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

// The running week, read-only. Used by the Schedule section for the branches
// and by the public page, which has no sign-in at all.
export async function mountScheduleViewer(stage, subEl) {
  stage.innerHTML = `<div class="boot sched-boot"><span class="boot-spin"></span>Loading this week’s schedule…</div>`;
  const { data, error } = await supabase.rpc('schedule_view');
  if (error || !data) {
    if (subEl) subEl.textContent = 'This week';
    stage.innerHTML = `
      <div class="empty">${icons.calendar}
        <p>${error ? 'The schedule could not be loaded.' : 'This week’s schedule has not been made yet.'}</p>
        ${error ? `<p class="muted">${esc(error.message)}</p>` : ''}
      </div>`;
    return;
  }
  if (subEl) subEl.textContent = `This week · ${weekLabel(data.week_start)}`;
  window.focSched = viewerBridge(data);
  stage.innerHTML = frameHTML();
}

export function scheduleView(me) {
  const editor = canEditSchedule(me.role);
  let root;

  function render() {
    root.innerHTML = `
      <header class="mod-head">
        <div>
          <h1>Schedule</h1>
          <p class="mod-sub" id="sc-sub">${editor
            ? 'Every week you make is saved — pick its Saturday to go back to it. The branches see the week that is running.'
            : 'This week'}</p>
        </div>
      </header>
      <div class="sched-stage" id="sc-stage"></div>`;
    const stage = root.querySelector('#sc-stage');
    if (editor) {
      window.focSched = editorBridge();
      stage.innerHTML = frameHTML();
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
