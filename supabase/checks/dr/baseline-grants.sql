-- Rechte. Ein Restore, der die Grants verliert, faellt durch jeden Zaehler
-- hindurch: die Tabellen sind da, die Daten sind da, und `anon` darf
-- ploetzlich mehr oder weniger als vorher. `--no-acl` wird beim Dump
-- deshalb NICHT gesetzt; hier wird nachgesehen, ob es gereicht hat.
--
-- Rollennamen sind in jedem Supabase-Projekt dieselben (anon, authenticated,
-- service_role, postgres), der ACL-Text ist also vergleichbar.
select 'tabelle' as art,
       n.nspname || '.' || c.relname as objekt,
       coalesce(array_to_string(c.relacl, E'\n'), '(Standard)') as rechte
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'v', 'S')
union all
select 'funktion',
       n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
       coalesce(array_to_string(p.proacl, E'\n'), '(Standard)')
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
union all
select 'schema', n.nspname,
       coalesce(array_to_string(n.nspacl, E'\n'), '(Standard)')
  from pg_namespace n
 where n.nspname in ('public', 'auth', 'storage')
 order by 1, 2;
