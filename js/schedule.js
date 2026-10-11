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
// Ghiath and the office edit, and a week stays theirs until one of them
// presses Publish: that copies the week as it stands into what everyone else
// sees. Every branch, and the public "View schedule" page, sees the published
// weeks that have not finished yet — this week and any ahead — and none older.
import { supabase } from './auth.js';
import { canEditSchedule } from './data.js';
import { esc, icons, toast, fmtDT } from './ui.js';

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

// Dates are counted in local time: in Oman, UTC midnight is still yesterday.
const isoOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const plusDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return isoOf(d);
};
const day = iso => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
export const weekLabel = iso => `${day(iso)} – ${day(plusDays(iso, 6))}`;

// ── the editor's bridge ─────────────────────────────────────────────────────
// Nothing is written until the saved state has been read. If that read fails,
// the scheduler would start from its built-in roster — and writing that back
// would wipe the real one — so a failed read leaves this bridge read-only.
//
// It also follows which week is open and whether that week is published, so
// the Publish bar above the frame can say so.
function editorBridge(onWeek) {
  let canWrite = false;
  let last = null;                 // the roster as the database holds it
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
      open = iso;
      tell();
      // `published` arrives with schema-11; before it, ask for the week alone.
      let res = await supabase.from('schedule_weeks')
        .select('result, published, published_at').eq('week_start', iso).maybeSingle();
      if (res.error && /published/.test(res.error.message)) {
        res = await supabase.from('schedule_weeks').select('result').eq('week_start', iso).maybeSingle();
      }
      const { data, error } = res;
      if (error) { problem('Could not load that week', error.message); return null; }
      if (data) {
        const json = JSON.stringify(data.result);
        saved.set(iso, json);
        current.set(iso, json);
        if (data.published) published.set(iso, { json: JSON.stringify(data.published.result), at: data.published_at });
      } else {
        current.delete(iso);
      }
      if (open === iso) tell();
      return data?.result ?? null;
    },

    saveWeek(result, employees, branches) {
      const iso = result?.weekStartISO;
      if (!canWrite || !iso) return;
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
      const { data, error } = await supabase.rpc('publish_schedule_week', { p_week: iso });
      if (error) {
        toast({ title: 'The week was not published', sub: error.message.replace(/^.*?:\s*/, ''), tone: 'stock' });
        return false;
      }
      published.set(iso, { json: current.get(iso), at: data ?? new Date().toISOString() });
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

// The published weeks that have not finished, read-only. Used by the Schedule
// section for the branches and by the public page, which has no sign-in.
export async function mountScheduleViewer(stage, subEl) {
  stage.innerHTML = `<div class="boot sched-boot"><span class="boot-spin"></span>Loading the schedule…</div>`;
  const { data, error } = await supabase.rpc('schedule_view');
  // Before schema-11 the function returned one week, not a list.
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

  const show = () => {
    if (subEl) subEl.textContent = `${weekName(pick.week_start)} · ${weekLabel(pick.week_start)}`;
    window.focSched = viewerBridge(pick);
    stage.innerHTML = `
      ${weeks.length > 1 ? `<section class="chips sched-weeks">${weeks.map(w => `
        <button class="chip ${w === pick ? 'on' : ''}" data-week="${esc(w.week_start)}">
          ${esc(weekName(w.week_start))}<span class="chip-n">${esc(weekLabel(w.week_start))}</span>
        </button>`).join('')}</section>` : ''}
      ${frameHTML()}`;
  };
  stage.onclick = e => {
    const b = e.target.closest('[data-week]');
    if (!b) return;
    pick = weeks.find(w => w.week_start === b.dataset.week) ?? pick;
    show();
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
      bridge = editorBridge(paintBar);
      window.focSched = bridge;
      stage.innerHTML = frameHTML();
      root.querySelector('#sc-bar').addEventListener('click', async e => {
        if (!e.target.closest('[data-publish]') || busy) return;
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
