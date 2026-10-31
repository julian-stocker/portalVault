-- ===========================================================================
-- PRODUCTION — NACHKONTROLLE ZUR SKY-ID-BEREICHSSPERRE, REIN LESEND
--
-- EINE ANWEISUNG. Im SQL-Editor des Projekts zmiwxswrpkmizvqsgype als
-- `postgres`. **Erwartet: Zeile 9999 = `0`.**
--
-- *** DIE BASELINE GEHOERT IN DIESE DATEI ***
--
-- Vor dem Lauf die Zeile 900 des Preflights hier unten eintragen, dort wo
-- `BASELINE-PLATZHALTER` steht. KEIN `set_config` davor: das ist
-- transaktionslokal, und im SQL-Editor ist jede Ausfuehrung eine eigene
-- Transaktion — ein Wert aus dem Preflight kann einen spaeteren Lauf gar
-- nicht erreichen. Zweimal hat mich das eine fehlgeschlagene Nachkontrolle
-- gekostet (SKY-0821: 19 Abweichungen, 0165: zwei). Die Regel steht seither
-- fest: eine Baseline, die eine spaetere Ausfuehrung braucht, ist ein
-- LITERAL in der Pruefdatei.
--
-- Zeile 301 schlaegt an, solange der Platzhalter noch drinsteht. Das ist
-- gewollt — eine Nachkontrolle ohne Vergleichsgrundlage darf „unveraendert"
-- nicht behaupten, und schweigen darf sie auch nicht.
--
-- *** SIE ZIEHT KEINE NUMMER ***
--
-- Kein `nextval`, kein `setval`. Eine Nachkontrolle, die eine SKY-ID
-- verbraucht, um zu pruefen, ob man eine ziehen kann, hat die Pruefung zur
-- Handlung gemacht. Zeile 206 beweist stattdessen am Zustand, dass noch
-- nichts gezogen wurde: `is_called = false`.
--
--   101-104  DIE UMGEBUNG, positiv wie im Preflight
--   201-208  DAS BAND STEHT: 5001..8999, NO CYCLE, Startwert 5001,
--            Zaehlstand 5001 mit `is_called = false` — der naechste Zug ist
--            SKY-5001 SELBST
--   211-213  DIE SPERRE GREIFT an der SEQUENZ und nicht am Aufrufer
--   221-222  FREMDE IDs BLEIBEN SPEICHERBAR: keine CHECK ist dazugekommen
--   231-233  DER IMPORTBEREICH ist unberuehrt und bleibt speicherbar
--   301-310  BESTAND UND NUTZERDATEN unveraendert, gegen die Baseline
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
vertrag as (
  /*
   * ============ HIER DIE ZEILE 900 DES PREFLIGHTS EINTRAGEN ============
   * Sie sieht so aus:  skyisles-pband-1|624|217|340|622|95|0|2|<md5>|<probe>
   * `current_setting` hat Vorrang, falls jemand eine andere Grundlage
   * pruefen will — es ist aber nicht der Traeger.
   */
  select coalesce(
    nullif(btrim(coalesce(current_setting('skyisles.pband', true), '')), ''),
    'BASELINE-PLATZHALTER'
  ) as roh,
  (nullif(btrim(coalesce(current_setting('skyisles.pband', true), '')), '') is not null)
    as vorgegeben
),
soll as (
  select roh, t[1] = 'skyisles-pband-1' as marke,
         t[2] as katalogzeilen, t[3] as journalzeilen, t[4] as lagerzeilen,
         t[5] as sammlungszeilen, t[6] as favoriten, t[7] as warenkoerbe,
         t[8] as bestellpositionen, t[9] as katalogabdruck, t[10] as selbstprobe
    from (select roh, string_to_array(roh, '|') as t from vertrag) q
),
pruef (nr, bereich, pruefung, befund, erwartet) as (values
  -- ---------------------------------------------------------- Die Umgebung
  (101, 'Umgebung', '0133: die Triggerfunktion liegt weiter',
      (select (to_regprocedure('public.purchases_paid_total_is_final()') is not null)::text),
      'true'),
  (102, 'Umgebung', '0133: und ihr Trigger auch',
      (select (count(*) > 0)::text from pg_trigger t
        where t.tgrelid = to_regclass('public.purchases')
          and t.tgname = 'purchases_paid_total_immutable_trg' and not t.tgisinternal),
      'true'),
  (103, 'Umgebung', 'und es ist NICHT das Staging-Band',
      (select (count(*) = 0)::text from seq where min_value = 928 and max_value = 4999),
      'true'),
  (104, 'Umgebung', 'Auskunft: SKY-0821 und SKY-0822 (der alte, nicht mehr '
                    'benutzte Stempel — nach dem Import steht hier 1|1)',
      (select (select count(*) from public.skylanders where sky_id = 'SKY-0821')::text
         || '|' || (select count(*) from public.skylanders where sky_id = 'SKY-0822')::text),
      null),

  -- ------------------------------------------------------------ Das Band steht
  (201, 'Band', 'die Untergrenze ist 5001',
      (select min_value::text from seq), '5001'),
  (202, 'Band', 'die Obergrenze ist 8999',
      (select max_value::text from seq), '8999'),
  (203, 'Band', 'NO CYCLE — eine umlaufende Sequenz vergaebe eine SKY-ID zweimal',
      (select cycle::text from seq), 'false'),
  (204, 'Band', 'der Startwert ist 5001',
      (select start_value::text from seq), '5001'),
  /*
   * DIE ENTSCHEIDENDE ZEILE. `restart with 5001` laesst `is_called` auf
   * `false`; der naechste Zug ist deshalb 5001 SELBST und nicht 5002. Eine
   * aeltere Fassung von s5/s6 hat hier einmal eine Nummer zu hoch gemeldet.
   */
  (205, 'Band', 'Zaehlstand 5001|false — der naechste Zug ist SKY-5001 SELBST',
      (select wert from stand), '5001|false'),
  /*
   * UND ES IST NOCH NICHTS GEZOGEN WORDEN. `is_called = false` ist der
   * Beweis, dass weder der Lauf noch diese Pruefung `nextval` aufgerufen hat.
   */
  (206, 'Band', 'kein nextval seit der Umstellung — is_called ist false',
      (select case when has_sequence_privilege('public.sky_id_seq', 'SELECT')
                   then (xpath('/row/c/text()', query_to_xml(
                          'select (not is_called)::text as c from public.sky_id_seq',
                          false, true, '')))[1]::text
                   else 'KEIN-RECHT' end), 'true'),
  (207, 'Band', 'die hoechste vergebene SKY-ID liegt weiter UNTER dem Band — '
                'die Umstellung hat keine Nummer verbraucht',
      (select (coalesce(max(sky_id), 'SKY-0000') < 'SKY-5001')::text
         from public.skylanders where sky_id ~ '^SKY-[0-8][0-9]{3}$'), 'true'),
  (208, 'Band', 'im Band 5001..8999 steht weiterhin nichts (Tabelle + Journal)',
      ((select count(*) from public.skylanders
         where sky_id between 'SKY-5001' and 'SKY-8999')
       + (select count(*) from public.catalog_admin_changes
           where entity = 'skylander' and entity_id between 'SKY-5001' and 'SKY-8999'))::text,
      '0'),

  -- ------------------------------------------------------- Die Sperre greift
  (211, 'Sperre', 'die Grenzen stehen an der SEQUENZ — darum halten sie auch '
                  'gegen setval und gegen SECURITY DEFINER',
      (select (min_value = 5001 and max_value = 8999 and not cycle)::text from seq), 'true'),
  (212, 'Sperre', 'der reservierte Bereich ab SKY-9000 (ADR-0070) ist damit '
                  'unerreichbar',
      (select (max_value < 9000)::text from seq), 'true'),
  (213, 'Sperre', 'und die Vergabe kann nicht mehr unter 5001 fallen',
      (select (min_value > 928)::text from seq), 'true'),

  -- ------------------------------------------- Fremde IDs bleiben speicherbar
  /*
   * DAS BAND REGELT DIE VERGABE, NICHT DIE SPEICHERUNG. Waere hier eine
   * CHECK-Constraint auf `sky_id` dazugekommen, blockierte sie genau den
   * Abgleich, fuer den die Baender gebaut werden — die 33 Figuren tragen
   * Nummern UNTER dem Band.
   */
  (221, 'Fremde IDs', 'die Formatconstraint ist unveraendert',
      (select coalesce(pg_get_constraintdef(c.oid), '(fehlt)') from pg_constraint c
        where c.conrelid = to_regclass('public.skylanders')
          and c.conname = 'skylanders_sky_id_format'),
      'CHECK ((sky_id ~ ''^SKY-[0-9]{4}$''::text))'),
  (222, 'Fremde IDs', 'und es ist KEINE CHECK-Constraint auf sky_id dazugekommen',
      (select coalesce(string_agg(c.conname, ',' order by c.conname collate "C"), '(keine)')
         from pg_constraint c
        where c.conrelid = to_regclass('public.skylanders') and c.contype = 'c'
          and pg_get_constraintdef(c.oid) like '%sky_id%'),
      'skylanders_base_not_self,skylanders_sky_id_format'),

  -- ------------------------------------------------------- Der Importbereich
  (231, 'Importbereich', 'SKY-0822..SKY-0928 ist unveraendert frei',
      ((select count(*) from public.skylanders
         where sky_id between 'SKY-0822' and 'SKY-0928')
       + (select count(*) from public.catalog_admin_changes
           where entity = 'skylander' and entity_id between 'SKY-0822' and 'SKY-0928'))::text,
      '0'),
  (232, 'Importbereich', 'er liegt UNTER dem Band — und bleibt trotzdem '
                         'speicherbar, weil kein CHECK ihn verbietet',
      (select (5001 > 928)::text), 'true'),
  (233, 'Importbereich', 'system_sync_create_figure liegt weiter und zieht die '
                         'Sequenz nicht',
      (select ((to_regprocedure('public.system_sync_create_figure(text,text,text,text,'
                'bigint,text,text,text,text,text,smallint)') is not null)
           and (select position('sky_id_seq' in coalesce(p.prosrc, 'sky_id_seq')) = 0
                  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'system_sync_create_figure'))::text),
      'true'),

  -- ----------------------------------------- Bestand und Nutzerdaten
  /*
   * JEDE ERWARTUNG IST MIT `coalesce` GEGEN NULL GESICHERT. Fehlte die
   * Baseline, waeren sie NULL — und die Zeilen gaeben GAR KEIN Urteil ab
   * statt anzuschlagen. Genau das hat beim 0165-Postflight ein `9999 = 3`
   * gemeldet, obwohl sieben Vergleiche nie stattgefunden hatten.
   */
  (301, 'Baseline', 'eine Baseline ist eingetragen (nicht der Platzhalter)',
      (select (roh <> 'BASELINE-PLATZHALTER')::text from vertrag), 'true'),
  (302, 'Baseline', 'sie traegt die Marke skyisles-pband-1',
      (select coalesce(marke::text, 'false') from soll), 'true'),
  (303, 'Baseline', 'ihre Selbstprobe stimmt — nichts beim Kopieren verloren',
      (select coalesce(left(md5(katalogzeilen || '|' || journalzeilen || '|' || lagerzeilen
                       || '|' || sammlungszeilen || '|' || favoriten || '|' || warenkoerbe
                       || '|' || bestellpositionen || '|' || katalogabdruck), 12),
                       '(BASELINE FEHLT)') from soll),
      (select coalesce(selbstprobe, '(BASELINE FEHLT)') from soll)),
  (304, 'Unveraendert', 'Katalogzeilen',
      (select katalogzeilen from mess),
      (select coalesce(katalogzeilen, '(BASELINE FEHLT)') from soll)),
  (305, 'Unveraendert', 'Journalzeilen — die Umstellung schreibt keine',
      (select journalzeilen from mess),
      (select coalesce(journalzeilen, '(BASELINE FEHLT)') from soll)),
  (306, 'Unveraendert', 'Lagerzeilen',
      (select lagerzeilen from mess),
      (select coalesce(lagerzeilen, '(BASELINE FEHLT)') from soll)),
  (307, 'Nutzerdaten', 'Sammlungen und Favoriten',
      (select sammlungszeilen || '|' || favoriten from mess),
      (select coalesce(sammlungszeilen || '|' || favoriten, '(BASELINE FEHLT)') from soll)),
  (308, 'Nutzerdaten', 'Warenkoerbe und Bestellpositionen',
      (select warenkoerbe || '|' || bestellpositionen from mess),
      (select coalesce(warenkoerbe || '|' || bestellpositionen, '(BASELINE FEHLT)') from soll)),
  (309, 'Unveraendert', 'der Katalogabdruck — die Umstellung fasst keine Zeile an',
      (select katalogabdruck from mess),
      (select coalesce(katalogabdruck, '(BASELINE FEHLT)') from soll)),
  (310, 'Baseline', 'Info: Herkunft der Grundlage',
      (select case when vorgegeben then 'uebergeben' else 'aus der Datei' end
         from vertrag), null)
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
