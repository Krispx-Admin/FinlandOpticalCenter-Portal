// ── Practice copy: the portal with its database inside this browser ──
// A link like foc-portal.org/?practice=SCC opens the portal as Seeb City
// Centre on a database of its own: Postgres itself (PGlite), running in the
// page and saved in this browser only (user, 2026-10-17: a link per branch to
// try things out — "even if it was all stored to the browser with no
// database"). Nothing reaches the live database: auth.js never creates the
// live connection in practice mode.
//
// It is the real database, not an imitation: demo/schema.sql is generated
// from the live catalog — the same tables, functions, triggers and row rules
// — so every step behaves exactly as it does for real. This file only speaks
// the small part of the supabase-js API the portal uses (from / rpc / auth),
// and runs each call under the signed-in location's token, as Supabase does.
import { PGlite } from 'https://cdn.jsdelivr.net/npm/@electric-sql/pglite@0.5.8/dist/index.js';
import { pgcrypto } from 'https://cdn.jsdelivr.net/npm/@electric-sql/pglite@0.5.8/dist/contrib/pgcrypto.js';

// Bump when demo/*.sql is regenerated: every practice copy then starts over
// on the new layout (an old one could not run the new screens).
const VERSION = 20;
const DB_NAME = `foc-practice-v${VERSION}`;
const SESSION_KEY = 'focp.practice.as';

let db = null;
let meta = null;   // foreign keys, primary keys and functions, read from the catalog
let as = null;     // the location signed in

const store = {
  get() { try { return localStorage.getItem(SESSION_KEY); } catch { return null; } },
  set(v) { try { v ? localStorage.setItem(SESSION_KEY, v) : localStorage.removeItem(SESSION_KEY); } catch { /* this visit only */ } },
};

function splash(text) {
  const el = document.getElementById('app');
  if (el) el.innerHTML = `<div class="login"><main class="login-panel"><div class="lp-inner lp-center">
    <div class="boot"><span class="boot-spin"></span>${text}</div></div></main></div>`;
}

// ── start ──
export async function practiceClient() {
  splash('Preparing the Admin Demo…');
  db = await PGlite.create(`idb://${DB_NAME}`, { extensions: { pgcrypto } });
  const ready = (await db.query(`select to_regclass('public.orders') is not null as ok`)).rows[0].ok;
  if (!ready) {
    splash('Setting up the Admin Demo — the first time takes a few seconds…');
    const files = await Promise.all(['prelude', 'schema', 'seed'].map(f =>
      fetch(`demo/${f}.sql`, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(`demo/${f}.sql: ${r.status}`); return r.text(); })));
    await db.transaction(async tx => { for (const sql of files) await tx.exec(sql); });
  }
  meta = (await db.query(META_SQL)).rows[0].m;
  as = store.get();
  return client;
}

// The database itself, for looking into a practice copy from the console.
export const practiceDb = () => db;

// Starts this browser's practice copy over: everything entered is gone.
export async function resetPractice() {
  store.set(null);
  try { await db?.close(); } catch { /* closing anyway */ }
  await new Promise(done => {
    const r = indexedDB.deleteDatabase(`/pglite/${DB_NAME}`);
    r.onsuccess = r.onerror = r.onblocked = () => done();
  });
}

const META_SQL = `select json_build_object(
  'fks', (select coalesce(json_agg(json_build_object('child', c.relname, 'col', a.attname, 'parent', p.relname, 'pcol', pa.attname)), '[]')
            from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_class p on p.oid = k.confrelid
            join pg_namespace n on n.oid = c.relnamespace
            join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
            join pg_attribute pa on pa.attrelid = k.confrelid and pa.attnum = k.confkey[1]
           where k.contype = 'f' and n.nspname = 'public'),
  'pks', (select json_object_agg(c.relname, (select json_agg(a.attname) from pg_attribute a where a.attrelid = c.oid and a.attnum = any(k.conkey)))
            from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
           where k.contype = 'p' and n.nspname = 'public'),
  'fns', (select json_object_agg(p.proname, json_build_object(
            'args', (select coalesce(json_agg(json_build_object('n', p.proargnames[i + 1], 't', format_type(p.proargtypes[i], null)) order by i), '[]')
                       from generate_series(0, p.pronargs - 1) i),
            'set', p.proretset, 'void', p.prorettype = 'void'::regtype))
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public')
) m`;

// ── running a call as the signed-in location ──
// Supabase runs every request under the caller's role with its token readable
// to the row rules; the same here, so each location sees exactly its rows.
async function asCaller(work) {
  return db.transaction(async tx => {
    const claims = as ? { role: 'authenticated', app_metadata: { branch_code: as } } : { role: 'anon' };
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    await tx.exec(`set local role ${as ? 'authenticated' : 'anon'}`);
    return work(tx);
  });
}
const failed = e => ({ data: null, error: { message: e?.message ?? String(e) } });

const NAME = /^[a-z_][a-z0-9_]*$/;
const id = s => {
  if (!NAME.test(s)) throw new Error(`bad name: ${s}`);
  return `"${s}"`;
};
// Splits "a, b(c, d), e" at the top-level commas.
function splitTop(s) {
  const out = []; let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// ── from(table) ──
class Query {
  constructor(table) {
    Object.assign(this, { table, op: 'select', cols: '*', ret: null, where: [], orders: [], lim: null, mode: null });
  }
  select(cols = '*') { if (this.op === 'select') this.cols = cols; else this.ret = cols; return this; }
  insert(rows) { this.op = 'insert'; this.rows = [].concat(rows); return this; }
  upsert(rows, opts = {}) { this.op = 'upsert'; this.rows = [].concat(rows); this.onConflict = opts.onConflict; return this; }
  update(vals) { this.op = 'update'; this.vals = vals; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(c, v) { this.where.push({ c, op: 'eq', v }); return this; }
  neq(c, v) { this.where.push({ c, op: 'neq', v }); return this; }
  gt(c, v) { this.where.push({ c, op: 'gt', v }); return this; }
  gte(c, v) { this.where.push({ c, op: 'gte', v }); return this; }
  lt(c, v) { this.where.push({ c, op: 'lt', v }); return this; }
  lte(c, v) { this.where.push({ c, op: 'lte', v }); return this; }
  is(c, v) { this.where.push({ c, op: 'is', v }); return this; }
  in(c, v) { this.where.push({ c, op: 'in', v }); return this; }
  not(c, op, v) { this.where.push({ c, op, v: op === 'in' ? listOf(v) : v, not: true }); return this; }
  // PostgREST's "a.eq.1,b.in.(x,y)": column, operator, then the value (which
  // may itself hold dots — a timestamp).
  or(s) {
    this.where.push({ any: splitTop(s).map(part => {
      const [c, op, ...rest] = part.split('.');
      const v = rest.join('.');
      return { c, op, v: op === 'in' ? listOf(v) : v };
    }) });
    return this;
  }
  order(c, { ascending = true } = {}) { this.orders.push([c, ascending]); return this; }
  limit(n) { this.lim = n; return this; }
  single() { this.mode = 'single'; return this; }
  maybeSingle() { this.mode = 'maybe'; return this; }
  then(ok, bad) { return this.run().then(ok, bad); }

  async run() {
    try {
      const params = [];
      const p = v => { params.push(v); return `$${params.length}`; };
      const cond = w => {
        const col = `t.${id(w.c)}`;
        const sql = w.op === 'is' ? `${col} is ${w.v === null || w.v === 'null' ? 'null' : w.v === true || w.v === 'true' ? 'true' : 'false'}`
          : w.op === 'in' ? `${col}::text in (select jsonb_array_elements_text(${p(JSON.stringify([].concat(w.v)))}::jsonb))`
          : `${col} ${{ eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }[w.op] ?? '='} ${p(w.v)}`;
        return w.not ? `not (${sql})` : sql;
      };
      const whereSQL = () => {
        const parts = this.where.map(w => (w.any ? `(${w.any.map(cond).join(' or ')})` : cond(w)));
        return parts.length ? ` where ${parts.join(' and ')}` : '';
      };
      const T = `public.${id(this.table)}`;
      let sql;
      if (this.op === 'select') {
        const order = this.orders.length ? ` order by ${this.orders.map(([c, a]) => `t.${id(c)} ${a ? 'asc' : 'desc'}`).join(', ')}` : '';
        sql = `select coalesce(json_agg(r), '[]'::json) as data from (select ${this.selectList(this.cols)} from ${T} t${whereSQL()}${order}${this.lim ? ` limit ${+this.lim}` : ''}) r`;
      } else {
        let body;
        if (this.op === 'insert' || this.op === 'upsert') {
          const cols = [...new Set(this.rows.flatMap(r => Object.keys(r)))].map(id);
          body = `insert into ${T} as t (${cols.join(', ')}) select ${cols.join(', ')} from json_populate_recordset(null::${T}, ${p(JSON.stringify(this.rows))}::json)`;
          if (this.op === 'upsert') {
            const key = (this.onConflict ? this.onConflict.split(',').map(s => s.trim()) : meta.pks[this.table]).map(id);
            const set = cols.filter(c => !key.includes(c)).map(c => `${c} = excluded.${c}`);
            body += ` on conflict (${key.join(', ')}) do ${set.length ? `update set ${set.join(', ')}` : 'nothing'}`;
          }
        } else if (this.op === 'update') {
          const vals = p(JSON.stringify(this.vals));
          const set = Object.keys(this.vals).map(c => `${id(c)} = (select ${id(c)} from json_populate_record(null::${T}, ${vals}::json))`);
          body = `update ${T} as t set ${set.join(', ')}${whereSQL()}`;
        } else {
          body = `delete from ${T} as t${whereSQL()}`;
        }
        sql = `with w as (${body} returning t.*) select ${this.ret === null ? 'null::json' : `coalesce((select json_agg(r) from (select ${this.selectList(this.ret)} from w t) r), '[]'::json)`} as data`;
      }
      let data = (await asCaller(tx => tx.query(sql, params))).rows[0]?.data ?? null;
      if (this.mode === 'single') {
        if (!Array.isArray(data) || data.length !== 1) return failed('JSON object requested, multiple (or no) rows returned');
        data = data[0];
      } else if (this.mode === 'maybe') data = Array.isArray(data) ? data[0] ?? null : data;
      return { data, error: null };
    } catch (e) {
      return failed(e);
    }
  }

  // "*, order_events(*)": the row, with its child rows alongside — found by
  // the foreign key between the two, as PostgREST does.
  selectList(cols) {
    return splitTop(cols || '*').map(part => {
      if (part === '*') return 't.*';
      const m = part.match(/^([a-z_][a-z0-9_]*)\((.*)\)$/);
      if (!m) return `t.${id(part)}`;
      const [, child, inner] = m;
      const fk = meta.fks.find(f => f.child === child && f.parent === this.table);
      if (!fk) throw new Error(`no link from ${this.table} to ${child}`);
      const innerCols = splitTop(inner || '*').map(c => (c === '*' ? 'c.*' : `c.${id(c)}`)).join(', ');
      return `coalesce((select json_agg(x) from (select ${innerCols} from public.${id(child)} c where c.${id(fk.col)} = t.${id(fk.pcol)}) x), '[]'::json) as ${id(child)}`;
    }).join(', ');
  }
}
const listOf = v => (Array.isArray(v) ? v : String(v).replace(/^\(|\)$/g, '').split(',').map(s => s.trim()).filter(Boolean));

// ── rpc(name, args) ──
async function rpc(name, args = {}) {
  try {
    const fn = meta.fns[name];
    if (!fn) return failed(`function ${name} does not exist`);
    const given = fn.args.filter(a => a.n && args && Object.prototype.hasOwnProperty.call(args, a.n));
    const call = `public.${id(name)}(${given.map(a => {
      const v = `($1::jsonb -> ${quote(a.n)})`;
      const val = a.t.endsWith('[]') ? `array(select jsonb_array_elements_text(${v}))::${a.t}`
        : /^jsonb?$/.test(a.t) ? `${v}::${a.t}`
        : `($1::jsonb ->> ${quote(a.n)})::${a.t}`;
      return `${id(a.n)} => ${val}`;
    }).join(', ')})`;
    const sql = fn.void ? `select ${call}, null::json as data`
      : fn.set ? `select coalesce(json_agg(x), '[]'::json) as data from ${call} x`
      : `select to_json(${call}) as data`;
    const res = await asCaller(tx => tx.query(sql, given.length ? [JSON.stringify(args ?? {})] : []));
    return { data: res.rows[0]?.data ?? null, error: null };
  } catch (e) {
    return failed(e);
  }
}
const quote = s => `'${String(s).replace(/'/g, "''")}'`;

// ── sign-in: picking a location is enough here ──
const listeners = new Set();
const session = () => (as ? {
  access_token: 'practice',
  user: { id: '00000000-0000-0000-0000-000000000000', app_metadata: { branch_code: as } },
} : null);
const emit = event => listeners.forEach(fn => { try { fn(event, session()); } catch (e) { console.error(e); } });

const client = {
  from: table => new Query(table),
  rpc,
  auth: {
    async getSession() { return { data: { session: session() }, error: null }; },
    async signInWithPassword({ email }) {
      const local = String(email ?? '').split('@')[0];
      // Branches only: the people (Omar, Ghiath, Wijdan, Sarah) are not in
      // the practice copy (user, 2026-10-17).
      const row = (await db.query(`select code from public.branches where lower(code) = lower($1)
        and role in ('retail', 'fitting', 'clinic')`, [local])).rows[0];
      if (!row) return { data: {}, error: { message: 'Invalid login credentials' } };
      as = row.code; store.set(as);
      emit('SIGNED_IN');
      return { data: { user: session().user, session: session() }, error: null };
    },
    async signOut() { as = null; store.set(null); emit('SIGNED_OUT'); return { error: null }; },
    onAuthStateChange(fn) {
      listeners.add(fn);
      return { data: { subscription: { unsubscribe: () => listeners.delete(fn) } } };
    },
  },
  // Only this browser writes here, and the portal reloads what it changed
  // after every action, so there is nothing to listen for.
  channel() { const ch = { on: () => ch, subscribe: () => ch }; return ch; },
  removeChannel() {},
  realtime: { setAuth() {} },
};
