# ── Practice copy: rebuild demo/schema.sql + demo/seed.sql ──
# Reads the LIVE database's catalog (read-only queries through the Supabase
# Management API) and writes the exact tables, functions, triggers and row
# rules the portal runs on, plus the starting data (branches, settings, lens
# lists, the shelves full). Run it after every migration, then bump VERSION in
# js/demo.js so every practice copy starts over on the new layout.
#   python -I -X utf8 demo/build.py
# Needs the Management API token in ~/.foc-supabase-token (never printed).
import json, sys, pathlib, urllib.request

REPO = pathlib.Path(__file__).resolve().parent.parent
PROJECT = 'vwwiyqmhljzsnyziouqz'

def q(sql):
    tok = pathlib.Path.home().joinpath('.foc-supabase-token').read_text().strip()
    req = urllib.request.Request(f'https://api.supabase.com/v1/projects/{PROJECT}/database/query',
        data=json.dumps({'query': sql, 'read_only': True}).encode(),
        headers={'Authorization': f'Bearer {tok}', 'Content-Type': 'application/json', 'User-Agent': 'foc-portal-practice-build'})
    return json.load(urllib.request.urlopen(req))[0]['r']

PUB = "n.nspname = 'public'"
cols = q(f"""select json_agg(json_build_object('t', c.relname, 'c', a.attname, 'ty', format_type(a.atttypid, a.atttypmod),
  'nn', a.attnotnull, 'd', pg_get_expr(ad.adbin, ad.adrelid)) order by c.relname, a.attnum) r
  from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
  left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
  where {PUB} and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped;""")
cons = q(f"""select json_agg(json_build_object('t', c.relname, 'n', k.conname, 'ty', k.contype, 'd', pg_get_constraintdef(k.oid))
  order by c.relname, k.contype, k.conname) r
  from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace where {PUB};""")
idx = q(f"""select json_agg(pg_get_indexdef(i.indexrelid) order by ic.relname) r
  from pg_index i join pg_class ic on ic.oid = i.indexrelid join pg_class c on c.oid = i.indrelid join pg_namespace n on n.oid = c.relnamespace
  where {PUB} and not exists (select 1 from pg_constraint k where k.conindid = i.indexrelid);""")
funcs = q(f"""select json_agg(pg_get_functiondef(p.oid) order by p.proname) r
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where {PUB} and p.prokind = 'f' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');""")
trigs = q(f"""select json_agg(pg_get_triggerdef(t.oid) order by c.relname, t.tgname) r
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where {PUB} and not t.tgisinternal;""")
rls = q(f"""select json_agg(json_build_object('t', c.relname, 'on', c.relrowsecurity, 'force', c.relforcerowsecurity)) r
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where {PUB} and c.relkind = 'r';""")
pols = q("""select json_agg(json_build_object('t', tablename, 'n', policyname, 'perm', permissive, 'roles', roles, 'cmd', cmd,
  'qual', qual, 'chk', with_check) order by tablename, policyname) r from pg_policies where schemaname = 'public';""")
seqs = q("""select json_agg(json_build_object('n', sequencename, 'start', start_value)) r from pg_sequences where schemaname = 'public';""")

ident = lambda s: '"' + s.replace('"', '""') + '"'
out = ["""-- ── FOC Portal practice copy: the database layout ──
-- GENERATED from the live database's catalog by demo/build.py —
-- do not edit by hand; regenerate after a migration (HANDOFF: PRACTICE COPY).
-- Runs inside the browser (PGlite) after demo/prelude.sql.
set check_function_bodies = off;
"""]
for s in seqs:
    out.append(f"create sequence public.{ident(s['n'])} start {s['start']};")
tables = {}
for c in cols:
    tables.setdefault(c['t'], []).append(c)
for t, cs in tables.items():
    body = ',\n  '.join(f"{ident(c['c'])} {c['ty']}" + (f" default {c['d']}" if c['d'] else '') + (' not null' if c['nn'] else '') for c in cs)
    out.append(f"create table public.{ident(t)} (\n  {body}\n);")
# keys and checks first, then the links between tables
for k in sorted(cons, key=lambda k: k['ty'] == 'f'):
    out.append(f"alter table public.{ident(k['t'])} add constraint {ident(k['n'])} {k['d']};")
for i in idx or []:
    out.append(i + ';')
for f in funcs:
    out.append(f.rstrip() + ';')
for t in trigs or []:
    out.append(t + ';')
for r in rls:
    if r['on']:
        out.append(f"alter table public.{ident(r['t'])} enable row level security;")
    if r['force']:
        out.append(f"alter table public.{ident(r['t'])} force row level security;")
for p in pols:
    roles = ', '.join(p['roles']) if p['roles'] else 'public'
    roles = roles.replace('{', '').replace('}', '')
    s = f"create policy {ident(p['n'])} on public.{ident(p['t'])} as {p['perm'].lower()} for {p['cmd'].lower()} to {roles}"
    if p['qual']:
        s += f" using ({p['qual']})"
    if p['chk']:
        s += f" with check ({p['chk']})"
    out.append(s + ';')
out.append("""-- What the website's signed-in key may touch; the row rules above decide which rows.
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to authenticated;
grant all on all sequences in schema public to authenticated;
grant execute on all functions in schema public to anon, authenticated;
grant select on public.branches to anon;
reset check_function_bodies;""")
(REPO / 'demo').mkdir(exist_ok=True)
(REPO / 'demo' / 'schema.sql').write_bytes(('\n\n'.join(out) + '\n').encode('utf-8'))

# ── the starting data: the cleared portal, with the lens shelves filled ──
def rows_sql(table, where='true', order='1'):
    data = q(f"select coalesce(json_agg(t order by {order}), '[]'::json) r from (select * from public.{table} where {where}) t;")
    if not data:
        return ''
    return (f"insert into public.{table} select * from json_populate_recordset(null::public.{table}, "
            f"$json${json.dumps(data, ensure_ascii=False)}$json$);")
seed = ["-- ── FOC Portal practice copy: the starting data ──",
        "-- GENERATED from the live database (branches, settings, lens lists, the",
        "-- employee list and the lens shelves) — every order, request and invoice starts empty."]
for t in ['branches', 'app_settings', 'lens_catalogue', 'employees', 'schedule_branches']:
    s = rows_sql(t)
    if s:
        seed.append(s)
# The shelves as they stand, with any lenses set aside for live orders back on
# them — the practice copy has none of those orders.
shelf = q("""select coalesce(json_agg(t order by t.holder_code, t.lens_type, t.lens_index, t.sph), '[]'::json) r from (
  select s.id, s.holder_code, s.lens_type, s.lens_index, s.coating, s.sph, s.cyl,
         s.qty + coalesce((select sum(l.qty) from public.lens_request_lines l join public.lens_requests r on r.id = l.request_id
                            where l.stock_id = s.id and r.status in ('reserved', 'requested')), 0)::int as qty,
         s.updated_at
    from public.lens_stock s) t;""")
seed.append("insert into public.lens_stock (id, holder_code, lens_type, lens_index, coating, sph, cyl, qty, updated_at) "
            "select id, holder_code, lens_type, lens_index, coating, sph, cyl, qty, updated_at from json_populate_recordset(null::public.lens_stock, "
            f"$json${json.dumps(shelf, ensure_ascii=False)}$json$);")
(REPO / 'demo' / 'seed.sql').write_bytes(('\n\n'.join(seed) + '\n').encode('utf-8'))
print('tables', len(tables), 'constraints', len(cons), 'indexes', len(idx or []), 'functions', len(funcs),
      'triggers', len(trigs or []), 'policies', len(pols))
