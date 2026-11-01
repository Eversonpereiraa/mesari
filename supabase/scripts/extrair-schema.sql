-- Extrai o schema "public" do banco como texto SQL.
-- SOMENTE LEITURA: não altera nada. Rode no SQL Editor do Supabase e
-- copie (ou baixe como CSV) a única linha/coluna "ddl" do resultado.
-- Útil quando não há Docker/pg_dump para usar `supabase db dump`.

with
tipos as (
  select 1 as ordem, format(
    'do $$ begin create type public.%I as enum (%s); exception when duplicate_object then null; end $$;',
    t.typname,
    (select string_agg(quote_literal(e.enumlabel), ', ' order by e.enumsortorder)
       from pg_enum e where e.enumtypid = t.oid)
  ) as ddl
  from pg_type t
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public' and t.typtype = 'e'
),
tabelas as (
  select 2 as ordem, format(
    E'create table if not exists public.%I (\n%s\n);',
    c.relname,
    (select string_agg(
        format('  %I %s%s%s',
          a.attname,
          format_type(a.atttypid, a.atttypmod),
          case when d.adbin is not null and a.attgenerated = ''
               then ' default ' || pg_get_expr(d.adbin, d.adrelid) else '' end
          || case when a.attgenerated = 's'
               then ' generated always as (' || pg_get_expr(d.adbin, d.adrelid) || ') stored' else '' end,
          case when a.attnotnull then ' not null' else '' end),
        E',\n' order by a.attnum)
       from pg_attribute a
       left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped)
  ) as ddl
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
),
restricoes as (
  -- PK/unique/check antes das FKs
  select case when con.contype = 'f' then 4 else 3 end as ordem, format(
    'alter table public.%I add constraint %I %s;',
    c.relname, con.conname, pg_get_constraintdef(con.oid)
  ) as ddl
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and con.contype in ('p', 'u', 'c', 'f', 'x')
),
indices as (
  select 5 as ordem, pg_get_indexdef(i.indexrelid) || ';' as ddl
  from pg_index i
  join pg_class c on c.oid = i.indrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and not exists (select 1 from pg_constraint con where con.conindid = i.indexrelid)
),
visoes as (
  select 6 as ordem, format('create or replace view public.%I as %s', c.relname, pg_get_viewdef(c.oid)) as ddl
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v'
),
funcoes as (
  select 7 as ordem, pg_get_functiondef(p.oid) || ';' as ddl
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind in ('f', 'p')
    and not exists (select 1 from pg_depend dep where dep.objid = p.oid and dep.deptype = 'e')
),
gatilhos as (
  select 8 as ordem, pg_get_triggerdef(t.oid) || ';' as ddl
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and not t.tgisinternal
),
gatilhos_auth as (
  -- gatilhos em auth.users que chamam funções do public (ex.: criar perfil)
  select 8 as ordem, pg_get_triggerdef(t.oid) || ';' as ddl
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_proc p on p.oid = t.tgfoid
  join pg_namespace pn on pn.oid = p.pronamespace
  where n.nspname = 'auth' and pn.nspname = 'public' and not t.tgisinternal
),
rls as (
  select 9 as ordem, format('alter table public.%I enable row level security;', c.relname) as ddl
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
),
politicas as (
  select 10 as ordem, format(
    'create policy %I on public.%I as %s for %s to %s%s%s;',
    pol.policyname, pol.tablename, pol.permissive, pol.cmd,
    array_to_string(pol.roles, ', '),
    case when pol.qual is not null then ' using (' || pol.qual || ')' else '' end,
    case when pol.with_check is not null then ' with check (' || pol.with_check || ')' else '' end
  ) as ddl
  from pg_policies pol
  where pol.schemaname = 'public'
),
grants_funcoes as (
  select 11 as ordem, format(
    'grant execute on function public.%I(%s) to %s;',
    p.proname, pg_get_function_identity_arguments(p.oid),
    case when acl.grantee = 0 then 'public' else quote_ident(r.rolname) end
  ) as ddl
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
  left join pg_roles r on r.oid = acl.grantee
  where n.nspname = 'public' and acl.privilege_type = 'EXECUTE'
    and coalesce(r.rolname, 'public') in ('public', 'anon', 'authenticated', 'service_role')
    and not exists (select 1 from pg_depend dep where dep.objid = p.oid and dep.deptype = 'e')
),
revokes_funcoes as (
  -- registra quando o EXECUTE de PUBLIC foi revogado
  select 11 as ordem, format(
    'revoke execute on function public.%I(%s) from public;',
    p.proname, pg_get_function_identity_arguments(p.oid)
  ) as ddl
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proacl is not null
    and not exists (select 1 from aclexplode(p.proacl) acl where acl.grantee = 0 and acl.privilege_type = 'EXECUTE')
    and not exists (select 1 from pg_depend dep where dep.objid = p.oid and dep.deptype = 'e')
),
grants_tabelas as (
  select 12 as ordem, format(
    'grant %s on public.%I to %I;',
    string_agg(acl.privilege_type, ', ' order by acl.privilege_type), c.relname, r.rolname
  ) as ddl
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(c.relacl) acl
  join pg_roles r on r.oid = acl.grantee
  where n.nspname = 'public' and c.relkind in ('r', 'v')
    and r.rolname in ('anon', 'authenticated', 'service_role')
  group by c.relname, r.rolname
),
realtime as (
  select 13 as ordem, format('alter publication %I add table public.%I;', pubname, tablename) as ddl
  from pg_publication_tables
  where schemaname = 'public'
)
select string_agg(ddl, E'\n\n' order by ordem, ddl) as ddl
from (
  select * from tipos union all select * from tabelas union all select * from restricoes
  union all select * from indices union all select * from visoes union all select * from funcoes
  union all select * from gatilhos union all select * from gatilhos_auth union all select * from rls
  union all select * from politicas union all select * from grants_funcoes union all select * from revokes_funcoes
  union all select * from grants_tabelas union all select * from realtime
) tudo;
