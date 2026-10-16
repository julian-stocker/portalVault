-- Sequenzstaende. Ohne sie vergibt die erste Neuanlage nach einem Restore
-- eine schon belegte Nummer.
select s.schemaname as schema, s.sequencename as sequenz, s.last_value
  from pg_sequences s
 where s.schemaname in ('public', 'auth', 'storage')
 order by 1, 2;
