-- Katalog-Inventar: wie viele Objekte welcher Art in welchem Schema stehen.
-- Rein lesend. Dieselbe Abfrage laeuft auf der Quelle VOR dem Dump und auf
-- dem Ziel NACH dem Restore; verglichen wird Zeile fuer Zeile.
select c.relnamespace::regnamespace::text as schema,
       case c.relkind when 'r' then 'Tabelle' when 'v' then 'View'
                      when 'm' then 'MatView' when 'S' then 'Sequenz'
                      when 'p' then 'Partitioniert' else c.relkind::text end as art,
       count(*) as anzahl
  from pg_class c
 where c.relnamespace::regnamespace::text in ('public', 'auth', 'storage', 'cron')
   and c.relkind in ('r', 'v', 'm', 'S', 'p')
 group by 1, 2
union all
select n.nspname, 'Funktion', count(*)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public', 'auth', 'storage') group by 1
union all
select n.nspname, 'Trigger', count(*)
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
 where not t.tgisinternal and n.nspname in ('public', 'auth', 'storage') group by 1
union all
select n.nspname, 'Policy', count(*)
  from pg_policy pol join pg_class c on c.oid = pol.polrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname in ('public', 'auth', 'storage') group by 1
union all
select n.nspname, 'Index', count(*)
  from pg_index i join pg_class c on c.oid = i.indrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname in ('public', 'auth', 'storage') group by 1
union all
select n.nspname, 'Constraint', count(*)
  from pg_constraint k join pg_namespace n on n.oid = k.connamespace
 where n.nspname in ('public', 'auth', 'storage') group by 1
union all
select 'public', 'RLS eingeschaltet', count(*)
  from pg_class c
 where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relrowsecurity
union all
select 'global', 'Extension', count(*) from pg_extension
order by 1, 2;
