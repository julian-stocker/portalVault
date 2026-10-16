-- Strukturgleichheit, nicht nur Strukturanzahl.
--
-- Zaehler reichen nicht: 94 Indizes vorher und 94 Indizes nachher kann auch
-- heissen, dass einer fehlt und ein anderer doppelt da ist. Diese Abfrage
-- bildet je Objekt einen Abdruck der DEFINITION. Verglichen wird Zeile fuer
-- Zeile zwischen Quelle und Ziel.
select 'spalten' as art,
       c.table_name as objekt,
       md5(string_agg(c.column_name || ':' || c.data_type || ':'
                      || c.is_nullable || ':' || coalesce(c.column_default, '-'),
                      ',' order by c.ordinal_position)) as abdruck
  from information_schema.columns c
 where c.table_schema = 'public'
 group by 2
union all
select 'constraint', n.nspname || '.' || r.relname || '.' || k.conname,
       md5(pg_get_constraintdef(k.oid))
  from pg_constraint k
  join pg_class r on r.oid = k.conrelid
  join pg_namespace n on n.oid = r.relnamespace
 where n.nspname = 'public'
union all
select 'index', i.schemaname || '.' || i.tablename || '.' || i.indexname,
       md5(i.indexdef)
  from pg_indexes i
 where i.schemaname = 'public'
union all
select 'trigger', n.nspname || '.' || r.relname || '.' || t.tgname,
       md5(pg_get_triggerdef(t.oid))
  from pg_trigger t
  join pg_class r on r.oid = t.tgrelid
  join pg_namespace n on n.oid = r.relnamespace
 where n.nspname = 'public' and not t.tgisinternal
union all
select 'policy', p.schemaname || '.' || p.tablename || '.' || p.policyname,
       md5(p.cmd || '|' || coalesce(array_to_string(p.roles, ','), '-')
           || '|' || coalesce(p.qual, '-') || '|' || coalesce(p.with_check, '-')
           || '|' || p.permissive)
  from pg_policies p
 where p.schemaname = 'public'
union all
select 'funktion',
       n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
       md5(p.prosrc || '|' || p.provolatile::text || '|' || p.prosecdef::text
           || '|' || coalesce(array_to_string(p.proconfig, ','), '-')
           || '|' || p.prorettype::regtype::text)
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
union all
select 'rls', n.nspname || '.' || r.relname,
       r.relrowsecurity::text || '|' || r.relforcerowsecurity::text
  from pg_class r
  join pg_namespace n on n.oid = r.relnamespace
 where n.nspname = 'public' and r.relkind = 'r'
 order by 1, 2;
