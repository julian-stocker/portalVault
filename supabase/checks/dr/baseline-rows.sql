-- Exakte Zeilenzahl je Tabelle, in EINER Anweisung und rein lesend.
-- `query_to_xml` fuehrt das count(*) je Tabelle aus, ohne dynamisches SQL
-- in einem DO-Block und ohne Schreibrechte.
select t.table_schema as schema, t.table_name as tabelle,
       (xpath('/row/c/text()',
              query_to_xml(format('select count(*) as c from %I.%I',
                                  t.table_schema, t.table_name),
                           false, true, '')))[1]::text::bigint as zeilen
  from information_schema.tables t
 where t.table_schema in ('public', 'auth', 'storage')
   and t.table_type = 'BASE TABLE'
 order by 1, 2;
