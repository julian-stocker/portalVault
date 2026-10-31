-- ===========================================================================
-- PRODUCTION — PREFLIGHT ZUR SKY-ID-BEREICHSSPERRE, REIN LESEND
--
-- EINE ANWEISUNG, kein `begin`, kein `do`, kein `set_config`. Im SQL-Editor
-- des Projekts zmiwxswrpkmizvqsgype als `postgres`.
-- **Erwartet: Zeile 9999 = `0`.** Zeile 900 ist die Baseline fuer die
-- Nachkontrolle — vollstaendig kopieren und in die Nachkontrolle eintragen.
--
-- WAS DANACH GILT, WENN DER LAUF DURCHGEHT
--
--   `sky_id_seq`: MINVALUE 5001, MAXVALUE 8999, NO CYCLE, naechster Zug 5001.
--
-- WAS SIE PRUEFT
--
--   101-105  DIE UMGEBUNG, POSITIV UND AM SCHEMA — `0133` mit beiden
--            Objekten, und die Sequenz traegt nicht das Staging-Band. Beides
--            bleibt gueltig, nachdem `SKY-0822` importiert ist; der alte
--            Zeilenstempel „SKY-0821 da, SKY-0822 nicht" haette sich durch
--            den eigenen Sync zerstoert.
--   111-116  DIE SEQUENZ ist noch unbegrenzt und steht UNTER dem neuen Band.
--   121-124  DAS ZIELBAND 5001..8999 IST LEER — in Tabelle UND Journal. Eine
--            Nummer, die einmal gezogen und verworfen wurde, steht nur noch
--            im Journal und ist trotzdem verbraucht (ADR-0001).
--   131-133  DER IMPORTBEREICH SKY-0822..SKY-0928 ist frei und bleibt es.
--   141-146  NUTZERDATEN und Bestand, fuer die Baseline.
-- ===========================================================================

with
seq as (
  select min_value, max_value, cycle, start_value from pg_sequences
   where schemaname = 'public' and sequencename = 'sky_id_seq'
),
stand as (
  select case when has_sequence_privilege('public.sky_id_seq', 'SELECT')
              then (xpath('/row/c/text()', query_to_xml(
                     'select last_value::text || ''|'' || is_called::text as c '
                     'from public.sky_id_seq', false, true, '')))[1]::text
              else 'KEIN-RECHT' end as wert
),
mess as (
  select
    (select count(*)::text from public.skylanders)              as katalogzeilen,
    (select count(*)::text from public.catalog_admin_changes)   as journalzeilen,
    (select count(*)::text from public.shop_inventory)          as lagerzeilen,
    (select count(*)::text from public.collection_items)        as sammlungszeilen,
    (select count(*)::text from public.favorites)               as favoriten,
    (select count(*)::text from public.cart_items)              as warenkoerbe,
    (select count(*)::text from public.order_lines)             as bestellpositionen,
    (select coalesce(md5(string_agg(s.sky_id || '|' || s.name || '|' || s.slug,
                                    chr(10) order by s.sky_id collate "C")), '(leer)')
       from public.skylanders s)                                as katalogabdruck
),
feld as (
  select katalogzeilen || '|' || journalzeilen || '|' || lagerzeilen || '|'
      || sammlungszeilen || '|' || favoriten || '|' || warenkoerbe || '|'
      || bestellpositionen || '|' || katalogabdruck as kern, m.* from mess m
),
baseline as (
  select 'skyisles-pband-1|' || kern || '|' || left(md5(kern), 12) as zeile, f.*
    from feld f
),
pruef (nr, bereich, pruefung, befund, erwartet) as (values
  -- ------------------------------------- Die Umgebung, positiv und am Schema
  (101, 'Umgebung', '0133: die Triggerfunktion liegt — 0133 liegt NUR auf Production',
      (select (to_regprocedure('public.purchases_paid_total_is_final()') is not null)::text),
      'true'),
  (102, 'Umgebung', '0133: und ihr Trigger auf purchases auch',
      (select (count(*) > 0)::text from pg_trigger t
        where t.tgrelid = to_regclass('public.purchases')
          and t.tgname = 'purchases_paid_total_immutable_trg' and not t.tgisinternal),
      'true'),
  (103, 'Umgebung', 'sky_id_seq traegt NICHT das Staging-Band 928..4999',
      (select (count(*) = 0)::text from seq where min_value = 928 and max_value = 4999),
      'true'),
  (104, 'Umgebung', 'der Katalog traegt Zeilen (mindestens 100)',
      (select (count(*) >= 100)::text from public.skylanders), 'true'),
  /*
   * DER ALTE STEMPEL, NUR NOCH ALS AUSKUNFT. Er lautete „SKY-0821 da,
   * SKY-0822 nicht" — und der Abgleich legt SKY-0822 hier demnaechst an.
   * Nach dem Import steht hier `1|1` statt `1|0`, und das ist richtig so.
   */
  (105, 'Umgebung', 'Auskunft: SKY-0821 und SKY-0822 in der Tabelle (der alte, '
                    'nicht mehr benutzte Stempel)',
      (select (select count(*) from public.skylanders where sky_id = 'SKY-0821')::text
         || '|' || (select count(*) from public.skylanders where sky_id = 'SKY-0822')::text),
      null),

  -- --------------------------------------------------------- Die Sequenz heute
  (111, 'Sequenz', 'sie traegt noch KEIN Band — diese Umstellung laeuft einmal',
      (select (min_value = 1 and max_value = 9223372036854775807)::text from seq), 'true'),
  (112, 'Sequenz', 'NO CYCLE ist schon jetzt gesetzt',
      (select (not cycle)::text from seq), 'true'),
  (113, 'Sequenz', 'Stand',
      (select wert from stand), null),
  /*
   * A4 DER HUELLE VERLANGT `last_value < 5001`. Steht die Sequenz schon im
   * Band, ist dort mehr gezogen worden als angenommen, und ein `restart`
   * vergaebe eine Nummer zweimal.
   */
  (114, 'Sequenz', 'der Zaehlstand liegt UNTER dem neuen Band',
      (select case when has_sequence_privilege('public.sky_id_seq', 'SELECT')
                   then (xpath('/row/c/text()', query_to_xml(
                          'select (last_value < 5001)::text as c from public.sky_id_seq',
                          false, true, '')))[1]::text
                   else 'KEIN-RECHT' end), 'true'),
  (115, 'Sequenz', 'der naechste Zug HEUTE — und ob er in den Importbereich fiele',
      (select case when has_sequence_privilege('public.sky_id_seq', 'SELECT')
                   then (xpath('/row/c/text()', query_to_xml(
                          'select (case when is_called then last_value + 1 else last_value end)::text '
                          '|| case when (case when is_called then last_value + 1 else last_value end) '
                          'between 822 and 928 then '' — IM IMPORTBEREICH, das Band schuetzt ihn'' '
                          'else '' — ausserhalb'' end as c from public.sky_id_seq',
                          false, true, '')))[1]::text
                   else 'KEIN-RECHT' end), null),
  (116, 'Sequenz', 'hoechste vergebene SKY-ID unter SKY-9000',
      (select coalesce(max(sky_id), '(leer)') from public.skylanders
        where sky_id ~ '^SKY-[0-8][0-9]{3}$'), null),

  -- --------------------------------------------------- Das Zielband ist leer
  (121, 'Zielband', 'keine Katalogzeile im Band SKY-5001..SKY-8999',
      (select count(*)::text from public.skylanders
        where sky_id between 'SKY-5001' and 'SKY-8999'), '0'),
  (122, 'Zielband', 'und keine Journalzeile — eine verworfene Nummer ist '
                    'trotzdem verbraucht (ADR-0001)',
      (select count(*)::text from public.catalog_admin_changes
        where entity = 'skylander' and entity_id between 'SKY-5001' and 'SKY-8999'), '0'),
  (123, 'Zielband', 'Summe beider — der Waechter A3 der Huelle rechnet genauso',
      ((select count(*) from public.skylanders
         where sky_id between 'SKY-5001' and 'SKY-8999')
       + (select count(*) from public.catalog_admin_changes
           where entity = 'skylander' and entity_id between 'SKY-5001' and 'SKY-8999'))::text,
      '0'),
  (124, 'Zielband', 'auch SKY-9000 und darueber bleibt unberuehrt — die Sperre '
                    'macht den reservierten Bereich (ADR-0070) unerreichbar, '
                    'sie loescht ihn nicht',
      (select count(*)::text from public.skylanders where sky_id >= 'SKY-9000'), null),

  -- ----------------------------------------------- Der Importbereich
  /*
   * DIE UMSTELLUNG FASST IHN NICHT AN. Sie aendert eine Sequenz, keine
   * Zeile. Die Zahl geht trotzdem in die Pruefung, damit die Nachkontrolle
   * es beweisen kann — und damit auffaellt, falls zwischen Preflight und
   * Lauf jemand dort etwas anlegt.
   */
  (131, 'Importbereich', 'SKY-0822..SKY-0928 ist frei, in Tabelle UND Journal',
      ((select count(*) from public.skylanders
         where sky_id between 'SKY-0822' and 'SKY-0928')
       + (select count(*) from public.catalog_admin_changes
           where entity = 'skylander' and entity_id between 'SKY-0822' and 'SKY-0928'))::text,
      '0'),
  (132, 'Importbereich', 'system_sync_create_figure liegt — sie legt die 33 '
                         'Figuren unter ihren Staging-Nummern an und zieht die '
                         'Sequenz NICHT',
      (select (to_regprocedure('public.system_sync_create_figure(text,text,text,text,'
               'bigint,text,text,text,text,text,smallint)') is not null)::text), 'true'),
  (133, 'Importbereich', 'und ihr Rumpf nennt sky_id_seq nicht',
      (select (position('sky_id_seq' in coalesce(p.prosrc, 'sky_id_seq')) = 0)::text
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'system_sync_create_figure'), 'true'),

  -- ----------------------------------------------------------- Nutzerdaten
  (141, 'Nutzerdaten', 'Sammlungszeilen',   (select sammlungszeilen from mess),  null),
  (142, 'Nutzerdaten', 'Favoriten',         (select favoriten from mess),        null),
  (143, 'Nutzerdaten', 'Warenkoerbe',       (select warenkoerbe from mess),      null),
  (144, 'Nutzerdaten', 'Bestellpositionen', (select bestellpositionen from mess), null),
  (145, 'Bestand',     'Lagerzeilen',       (select lagerzeilen from mess),      null),
  (146, 'Bestand',     'Katalog / Journal',
      (select katalogzeilen || ' / ' || journalzeilen from mess), null),

  (900, 'BASIS', 'Baseline fuer die Nachkontrolle — vollstaendig kopieren',
      (select zeile from baseline), null)
),
ergebnis as (
  select nr, bereich, pruefung, befund, erwartet,
         case when befund = 'KEIN-RECHT' then null
              when erwartet is null then null
              else befund is not distinct from erwartet end as ok
    from pruef
)
select nr, bereich, pruefung, befund, erwartet, ok from ergebnis
union all
select 9998, 'GESAMT', 'Zeilen, die diese Rolle nicht lesen durfte (0 = vollstaendig geprueft)',
       (select count(*) from ergebnis where befund = 'KEIN-RECHT')::text, null, null
union all
select 9999, 'GESAMT', 'blockierende Abweichungen (muss 0 sein)',
       (select count(*) from ergebnis where ok is false)::text, '0',
       (select count(*) from ergebnis where ok is false) = 0
 order by nr;
