-- ===========================================================================
-- CAT-09 ANALYSE: was eine Katalogzeile festhält — und was eine Löschung
-- blockieren MUSS.
--
-- DIE FRAGE. Der Betreiber will eine versehentlich doppelte, nirgends
-- benutzte Katalogzeile löschen können. Dafür muss „nirgends benutzt"
-- beweisbar sein — und zwar vollständig, auch dort, wo kein Fremdschlüssel
-- steht.
--
--   101-106  DIE FREMDSCHLÜSSEL auf `skylanders.sky_id`, vollständig aus
--            `pg_constraint`. Das ist die Liste, die `admin_merge_references`
--            (0154/0159) schon zählt.
--   201-206  DIE STILLEN VERWEISE: Spalten, die eine SKY-ID als TEXT führen,
--            ohne Fremdschlüssel. Jede davon ist eine Abhängigkeit, die ein
--            `delete` nicht bemerkt.
--   301-306  DAS AUDITJOURNAL. Es muss die Löschung ÜBERLEBEN, also darf es
--            keinen Fremdschlüssel auf die gelöschte Zeile haben.
--   401-406  DIE SKY-ID-VERGABE: wird eine gelöschte Nummer wieder
--            ausgegeben?
--   501-506  DIE BILDER: teilen mehrere Zeilen eine Bilddatei?
--
-- SIE SCHREIBT NICHTS.
-- ===========================================================================

with fk as (
  select c.conrelid::regclass::text as tabelle,
         c.conname::text            as name,
         pg_get_constraintdef(c.oid) as def,
         c.confdeltype              as beim_loeschen
    from pg_constraint c
   where c.confrelid = to_regclass('public.skylanders')
     and c.contype = 'f'
),
/* Jede TEXT-Spalte, die wie eine SKY-ID heisst, ohne Fremdschlüssel. */
still as (
  select (a.attrelid::regclass)::text as tabelle, a.attname::text as spalte
    from pg_attribute a
    join pg_class k on k.oid = a.attrelid
    join pg_namespace n on n.oid = k.relnamespace
   where n.nspname = 'public' and k.relkind = 'r' and a.attnum > 0
     and not a.attisdropped
     and (a.attname like '%sky_id%' or a.attname = 'sky_id')
     and a.attrelid <> to_regclass('public.skylanders')
     and not exists (
       select 1 from pg_constraint c
        where c.conrelid = a.attrelid and c.contype = 'f'
          and c.confrelid = to_regclass('public.skylanders')
          and a.attnum = any (c.conkey))
),
pruef (nr, bereich, pruefung, befund) as (values
  (101, 'Fremdschluessel', 'wie viele auf skylanders zeigen',
      (select count(*)::text from fk)),
  (102, 'Fremdschluessel', 'alle, mit Tabelle und ON DELETE',
      (select coalesce(string_agg(f.tabelle || '.' || f.name || ' ['
                                  || case f.beim_loeschen when 'a' then 'NO ACTION'
                                       when 'r' then 'RESTRICT' when 'c' then 'CASCADE'
                                       when 'n' then 'SET NULL' when 'd' then 'SET DEFAULT'
                                       else f.beim_loeschen::text end || ']',
                                  ' | ' order by f.tabelle, f.name), '(keine)')
         from fk f)),
  (103, 'Fremdschluessel', 'davon mit CASCADE — die loeschen mit (muss bekannt sein)',
      (select coalesce(string_agg(f.tabelle || '.' || f.name, ' | '
                                  order by f.tabelle), '(keine)')
         from fk f where f.beim_loeschen = 'c')),
  (104, 'Fremdschluessel', 'davon mit SET NULL',
      (select coalesce(string_agg(f.tabelle || '.' || f.name, ' | '
                                  order by f.tabelle), '(keine)')
         from fk f where f.beim_loeschen = 'n')),
  (105, 'Fremdschluessel', 'und die zaehlbaren Tabellen (ohne catalog_editorial)',
      (select coalesce(string_agg(distinct f.tabelle, ', ' order by f.tabelle), '(keine)')
         from fk f where f.tabelle <> 'catalog_editorial')),

  (201, 'Stille Verweise', 'Spalten mit sky_id im Namen OHNE Fremdschluessel',
      (select count(*)::text from still)),
  (202, 'Stille Verweise', 'alle, namentlich',
      (select coalesce(string_agg(s.tabelle || '.' || s.spalte, ' | '
                                  order by s.tabelle, s.spalte), '(keine)')
         from still s)),

  (301, 'Journal', 'hat catalog_admin_changes einen Fremdschluessel auf skylanders?',
      (select case when count(*) = 0 then 'nein — die Loeschung ueberlebt im Journal'
                   else 'JA: ' || string_agg(c.conname, ', ') end
         from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.contype = 'f' and c.confrelid = to_regclass('public.skylanders'))),
  (302, 'Journal', 'die erlaubten field-Werte',
      (select coalesce(max(pg_get_constraintdef(c.oid)), '(fehlt)')
         from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known')),
  (303, 'Journal', 'kennt es market_price schon?',
      (select coalesce(max((pg_get_constraintdef(c.oid) like '%market_price%')::text),
                       '(fehlt)')
         from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known')),

  (401, 'SKY-ID', 'wie die naechste Nummer entsteht',
      (select coalesce(string_agg(c.relname, ', '), '(keine Sequenz)')
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'S' and c.relname like '%sky%')),
  /* Rechtegefiltert (ADR-0139/0141): der lesende Pruefzugang hat auf die
     Sequenz kein `select`, und ein direkter Zugriff braeche die ganze
     Datei statt diese Zeile offenzulassen. */
  (402, 'SKY-ID', 'Stand der Sequenz',
      case when has_sequence_privilege('public.sky_id_seq', 'select')
             then coalesce((xpath('/row/c/text()', query_to_xml(
                 'select last_value::text as c from public.sky_id_seq',
                 false, true, '')))[1]::text, '?')
           else 'KEIN-RECHT' end),
  (403, 'SKY-ID', 'hoechste SKY-ID im Katalog',
      (select coalesce(max(sky_id), '(leer)') from public.skylanders)),
  (404, 'SKY-ID', 'Luecken im Nummernband (geloeschte oder nie vergebene)',
      (select count(*)::text from generate_series(1, 930) g
        where not exists (select 1 from public.skylanders s
                           where s.sky_id = 'SKY-' || lpad(g::text, 4, '0')))),

  (501, 'Bilder', 'Zeilen mit image_file',
      (select count(*)::text from public.skylanders where image_file is not null)),
  (502, 'Bilder', 'verschiedene Dateinamen darunter',
      (select count(distinct image_file)::text from public.skylanders
        where image_file is not null)),
  (503, 'Bilder', 'GETEILTE Bilddateien (mehrere Zeilen, eine Datei)',
      (select count(*)::text from (select image_file from public.skylanders
         where image_file is not null group by image_file having count(*) > 1) x)),
  (504, 'Bilder', 'wie viele Zeilen davon betroffen sind',
      (select coalesce(sum(n)::text, '0') from (select count(*) as n
         from public.skylanders where image_file is not null
         group by image_file having count(*) > 1) x)),
  (505, 'Bilder', 'Zeilen mit image_override_path',
      (select count(*)::text from public.skylanders
        where image_override_path is not null)),
  (506, 'Bilder', 'geteilte Override-Pfade',
      (select count(*)::text from (select image_override_path from public.skylanders
         where image_override_path is not null
         group by image_override_path having count(*) > 1) x))
)
select nr, bereich, pruefung, befund, null::text as erwartet, null::boolean as ok
  from pruef
 order by nr;
