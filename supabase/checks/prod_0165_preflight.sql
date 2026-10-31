-- ===========================================================================
-- PRODUCTION — PREFLIGHT ZU 0165, REIN LESEND
--
-- EINE ANWEISUNG, kein `begin`, kein `do`, kein `set_config`. Im SQL-Editor
-- des Projekts zmiwxswrpkmizvqsgype als `postgres`.
-- **Erwartet: Zeile 9999 = `0`.** Zeile 900 ist die Baseline fuer die
-- Nachkontrolle — vollstaendig kopieren.
--
-- *** WAS SIE PRUEFT ***
--
--   101-106  DIE UMGEBUNG, POSITIV UND AM SCHEMA. Nicht „kein Staging",
--            sondern „0133 liegt, mit beiden Objekten" und „die Sequenz
--            traegt nicht das Staging-Band". Ein Katalogabgleich schreibt
--            Zeilen; eine Triggerfunktion und eine Sequenzgrenze kann er
--            nicht herstellen.
--   111-118  DER FUNKTIONSZUSTAND: 0165 liegt NICHT, und alles, was sie
--            braucht, liegt — neun Spalten, die Journal-Constraint mit dem
--            Feldwert `created`, die Rolle `service_role`.
--   121-124  DIE RECHTE, die die Migration setzen wird — heute noch keine.
--   131-133  DIE SEQUENZ und die beiden Baender.
--   141-146  NUTZERDATEN: Sammlungen, Favoriten, Warenkoerbe, Bestellungen,
--            Lager. 0165 fasst nichts davon an; die Zahlen gehen in die
--            Baseline, damit die Nachkontrolle es beweisen kann.
--   151-153  WAS DER ABGLEICH SPAETER BRAUCHT — heute nur gemessen, nicht
--            verlangt: `system_set_image_override` und der Importbereich.
-- ===========================================================================

with
sp as (
  select a.attname::text as name from pg_attribute a
   where a.attrelid = to_regclass('public.skylanders') and not a.attisdropped and a.attnum > 0
),
fn as (
  select p.proname::text as name, p.oid from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
),
seq as (
  select min_value, max_value, cycle from pg_sequences
   where schemaname = 'public' and sequencename = 'sky_id_seq'
),
mess as (
  select
    (select count(*)::text from public.skylanders)                 as katalogzeilen,
    (select count(*)::text from public.catalog_admin_changes)      as journalzeilen,
    (select count(*)::text from public.shop_inventory)             as lagerzeilen,
    (select count(*)::text from public.collection_items)           as sammlungszeilen,
    (select count(*)::text from public.favorites)                  as favoriten,
    (select count(*)::text from public.cart_items)                 as warenkoerbe,
    (select count(*)::text from public.order_lines)                as bestellpositionen,
    (select coalesce(md5(string_agg(s.sky_id || '|' || s.name || '|' || s.slug,
                                    chr(10) order by s.sky_id collate "C")), '(leer)')
       from public.skylanders s)                                   as katalogabdruck
),
feld as (
  select katalogzeilen || '|' || journalzeilen || '|' || lagerzeilen || '|'
      || sammlungszeilen || '|' || favoriten || '|' || warenkoerbe || '|'
      || bestellpositionen || '|' || katalogabdruck as kern, m.* from mess m
),
baseline as (
  select 'skyisles-p0165-1|' || kern || '|' || left(md5(kern), 12) as zeile, f.*
    from feld f
),
pruef (nr, bereich, pruefung, befund, erwartet) as (values
  -- ------------------------------------- Die Umgebung, positiv und am Schema
  (101, 'Umgebung', 'purchases_paid_total_is_final() liegt — 0133, und 0133 liegt '
                    'NUR auf Production',
      (select (to_regprocedure('public.purchases_paid_total_is_final()') is not null)::text),
      'true'),
  (102, 'Umgebung', 'und ihr Trigger purchases_paid_total_immutable_trg auch — '
                    'zwei Objekte, damit ein halber Stand auffaellt',
      (select (count(*) > 0)::text from pg_trigger t
        where t.tgrelid = to_regclass('public.purchases')
          and t.tgname = 'purchases_paid_total_immutable_trg' and not t.tgisinternal),
      'true'),
  (103, 'Umgebung', 'sky_id_seq traegt NICHT das Staging-Band 928..4999',
      (select (count(*) = 0)::text from seq where min_value = 928 and max_value = 4999),
      'true'),
  (104, 'Umgebung', 'sondern den unbegrenzten Stand ODER das Production-Band 5001..8999',
      (select (count(*) = 1)::text from seq
        where (min_value = 1 and max_value = 9223372036854775807)
           or (min_value = 5001 and max_value = 8999)),
      'true'),
  (105, 'Umgebung', 'der Katalog traegt Zeilen (mindestens 100)',
      (select (count(*) >= 100)::text from public.skylanders), 'true'),
  (106, 'Umgebung', 'Zugabe: das VOLLSTAENDIGE Staging-Markerpaar fehlt. Seit der '
                    'Umnummerierung ist das kein Nachweis mehr, nur noch ein Hinweis',
      (select count(*)::text from public.skylanders
        where sky_id in ('SKY-0821','SKY-0822')), null),

  -- ------------------------------------------------------- Der Funktionszustand
  (111, 'Funktion', '0165 liegt NICHT — in keiner Fassung',
      (select count(*)::text from fn where name = 'system_sync_create_figure'), '0'),
  (112, 'Funktion', 'auch nicht mit der erwarteten Signatur',
      (select (to_regprocedure('public.system_sync_create_figure(text,text,text,text,'
               'bigint,text,text,text,text,text,smallint)') is null)::text), 'true'),
  (113, 'Vorbedingung', 'die neun Spalten, in die 0165 schreibt',
      (select count(*)::text from sp where name in ('sky_id','name','slug','series_code',
        'category_id','card_type','item_type','catalog_status','source')), '9'),
  (114, 'Vorbedingung', 'und die zwei optionalen',
      (select count(*)::text from sp where name in ('image_file','usk_rating')), '2'),
  (115, 'Vorbedingung', 'catalog_admin_changes steht',
      (select (to_regclass('public.catalog_admin_changes') is not null)::text), 'true'),
  /*
   * DER FELDWERT, AN DEM DIE JOURNALZEILE HAENGT. `0165` schreibt
   * `field = 'created'`. Laesst die CHECK das nicht zu, scheitert die
   * Funktion erst beim AUFRUF — und dann mitten im Abgleich.
   */
  (116, 'Vorbedingung', 'die Journal-Constraint laesst den Feldwert created zu',
      (select (coalesce(pg_get_constraintdef(c.oid), '') like '%''created''%')::text
         from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'),
      'true'),
  (117, 'Vorbedingung', 'Info: die Journal-Constraint im Volltext',
      (select coalesce(pg_get_constraintdef(c.oid), '(fehlt)') from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'), null),
  /*
   * DIE ROLLE IST DIE AUTORISIERUNG. `0165` erteilt ihr das EXECUTE-Recht,
   * und dieses Recht IST die Berechtigungsgrenze — wie bei
   * `system_record_inventory_movement` (0003).
   */
  (118, 'Vorbedingung', 'die Rolle service_role gibt es',
      (select (count(*) = 1)::text from pg_roles where rolname = 'service_role'), 'true'),

  -- -------------------------------------------------------------- Die Rechte
  (121, 'Rechte', 'heute hat niemand EXECUTE auf 0165 — sie liegt ja nicht',
      (select coalesce(string_agg(g.grantee, ',' order by g.grantee collate "C"), '(keiner)')
         from (select (aclexplode(p.proacl)).grantee::regrole::text as grantee
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'system_sync_create_figure') g),
      '(keiner)'),
  /*
   * `string_agg(distinct x, ',' order by x collate "C")` weist PostgreSQL ab
   * (`42P10`): in einem Aggregat mit DISTINCT muss der ORDER-BY-Ausdruck im
   * Argument stehen. Das `distinct` gehoert deshalb in die Unterabfrage —
   * dieselbe Stelle hat mich schon im Fingerprint erwischt.
   */
  (122, 'Rechte', 'Vergleichsfall: wer darf system_record_inventory_movement (0003)',
      (select coalesce(string_agg(g.grantee, ',' order by g.grantee collate "C"), '(keiner)')
         from (select distinct (aclexplode(p.proacl)).grantee::regrole::text as grantee
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public'
                  and p.proname = 'system_record_inventory_movement') g), null),

  -- ------------------------------------------------------------- Die Sequenz
  (131, 'Sequenz', 'Grenzen und Umlauf',
      (select min_value::text || '..' || max_value::text || '|' || cycle::text from seq), null),
  (132, 'Sequenz', 'Stand',
      (select case when has_sequence_privilege('public.sky_id_seq', 'SELECT')
                   then (xpath('/row/c/text()', query_to_xml(
                          'select last_value::text || ''|'' || is_called::text as c '
                          'from public.sky_id_seq', false, true, '')))[1]::text
                   else 'KEIN-RECHT' end), null),
  /*
   * DER WICHTIGSTE HINWEIS DIESER DATEI, UND ER IST KEINE FORDERUNG.
   *
   * Steht die Sequenz auf 821 mit `is_called`, ist der NAECHSTE Zug
   * `SKY-0822` — die erste der 33 Nummern, die der Abgleich hier anlegen
   * will. `0165` beruehrt die Sequenz nicht, dieser Preflight verlangt also
   * nichts; aber wer die 33 Figuren anlegt, BEVOR das Production-Band liegt,
   * riskiert, dass eine gewoehnliche Figurenanlage dieselbe Nummer zieht.
   */
  (133, 'Sequenz', 'Hinweis: der naechste Zug, und ob er in den Importbereich '
                   'SKY-0822..SKY-0928 fiele',
      (select case when has_sequence_privilege('public.sky_id_seq', 'SELECT')
                   then (xpath('/row/c/text()', query_to_xml(
                          'select case when is_called then last_value + 1 else last_value end::text '
                          '|| case when (case when is_called then last_value + 1 else last_value end) '
                          'between 822 and 928 then '' — IM IMPORTBEREICH'' else '' — ausserhalb'' end as c '
                          'from public.sky_id_seq', false, true, '')))[1]::text
                   else 'KEIN-RECHT' end), null),

  -- ----------------------------------------------------------- Nutzerdaten
  /*
   * `0165` legt eine Funktion an und fasst keine Tabelle an. Diese Zahlen
   * sind deshalb keine Pruefung, sondern der Vertrag: die Nachkontrolle
   * haelt sie unveraendert dagegen.
   */
  (141, 'Nutzerdaten', 'Sammlungszeilen',   (select sammlungszeilen from mess),  null),
  (142, 'Nutzerdaten', 'Favoriten',         (select favoriten from mess),        null),
  (143, 'Nutzerdaten', 'Warenkoerbe',       (select warenkoerbe from mess),      null),
  (144, 'Nutzerdaten', 'Bestellpositionen', (select bestellpositionen from mess), null),
  (145, 'Bestand',     'Lagerzeilen',       (select lagerzeilen from mess),      null),
  (146, 'Bestand',     'Katalog / Journal', (select katalogzeilen || ' / ' || journalzeilen
                                               from mess),                      null),

  -- -------------------------------- Was der Abgleich danach braucht (gemessen)
  (151, 'Abgleich', 'system_set_image_override (0035) — die sieben Bildschritte '
                    'haengen daran. GEMESSEN, nicht verlangt',
      (select count(*)::text from fn where name = 'system_set_image_override'), null),
  (152, 'Abgleich', 'der Importbereich SKY-0822..SKY-0928 ist frei, in Tabelle '
                    'UND Journal',
      ((select count(*) from public.skylanders
         where sky_id between 'SKY-0822' and 'SKY-0928')
       + (select count(*) from public.catalog_admin_changes
           where entity = 'skylander' and entity_id between 'SKY-0822' and 'SKY-0928'))::text,
      '0'),
  (153, 'Abgleich', 'die vier Klasse-B-RPCs liegen (0158, 0159, 0163)',
      (select count(*)::text from fn where name in ('admin_set_figure_types',
        'admin_set_visible_type','admin_set_variant_base','admin_set_character')), '4'),

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
