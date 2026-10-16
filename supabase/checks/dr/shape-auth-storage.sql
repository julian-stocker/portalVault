-- Die SPALTENFORM der Supabase-eigenen Schemata, als Fingerabdruck je Tabelle.
-- Quelle und Ziel muessen hier uebereinstimmen, sonst passt der COPY-Befehl
-- des Dumps nicht auf die Zieltabelle und der Restore scheitert mitten im
-- Datenabschnitt. Vor dem Restore auf BEIDEN Seiten ausfuehren und diffen.
select c.table_schema as schema, c.table_name as tabelle,
       count(*) as spalten,
       md5(string_agg(c.column_name || ':' || c.data_type, ','
                      order by c.ordinal_position)) as form
  from information_schema.columns c
 where c.table_schema in ('auth', 'storage')
 group by 1, 2
 order by 1, 2;
