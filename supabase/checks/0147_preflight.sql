-- ===========================================================================
-- STAGING/PRODUCTION — DER ZUSTAND VOR 0147, REIN LESEND
--
-- VOR `0147_offer_availability.sql` fahren. Vollstaendig markieren, in den
-- SQL-Editor einfuegen, ausfuehren. `begin` und `rollback` stehen in der
-- Huelle; diese Datei schreibt nichts.
--
-- **Erwartet: Zeile 9999 = `0`.**
--
-- WAS SIE PRUEFT, in drei Gruppen:
--
--   101-108  `0146` steht VOLLSTAENDIG. `0147` aendert eine angewendete
--            Tabelle und ersetzt eine angewendete Funktion — steht dort
--            etwas anderes als gedacht, muss das hier auffallen und nicht
--            mitten in der Migration.
--   111-114  `0147` ist NOCH NICHT da. Ein zweiter Lauf soll an seiner
--            eigenen Vorbedingung abprallen, nicht die Spalte doppelt
--            anlegen.
--   121-126  der Stand des Spiegels, den die Nachfuellung antrifft. Diese
--            Zahlen sind die nuetzlichsten des Blattes: sie sagen vorher,
--            wie viele Zeilen `least(changed_at, announced_at)` schuetzen
--            wird und wie viele nach `0147` zu Recht faellig sind.
--
-- DAZU DIE ZWEI BASELINES (900, 901), unveraendert aus der Familie
-- `0142`-`0146`: `0147` fasst weder Shop noch Lager noch Sammlung an, und
-- die Nachkontrolle vergleicht blockierend gegen genau diesen Stand.
--
-- DIE FELDFOLGE BEIDER VERTRAEGE, AUSGESCHRIEBEN. Sie steht hier, weil ein
-- vertauschtes Feld eine stille Fehlinformation waere: die Nachkontrolle
-- vergleicht nach POSITION (`t[2]` … `t[8]`), nicht nach Namen.
--
-- DER BASIS-VERTRAG — sieben Geschaeftszahlen, eine Zeile, feste Reihenfolge
--
--   skyisles-base-1|angebote|angebote_md5|shopfaehig|sammelbar|lagerzeilen|
--   katalogzeilen|lager_md5|schutz
--
-- Neun Felder, getrennt durch `|`, in GENAU dieser Folge:
--
--   1  skyisles-base-1   die Marke. Eine fremde Zeile faellt daran auf
--   2  angebote          count(*) ueber shop_offers()
--   3  angebote_md5      md5 ueber sky_id|condition|price, sortiert
--   4  shopfaehig        count(*) mit is_shop_eligible()
--   5  sammelbar         der Fortschrittsnenner
--   6  lagerzeilen       count(*) ueber shop_inventory
--   7  katalogzeilen     count(*) ueber skylanders
--   8  lager_md5         md5 ueber id|is_listed|sale_price|sale_released
--   9  schutz            left(md5(Felder 2-8, mit | verbunden), 12)
--
-- DER SAMMLUNGS-VERTRAG — fuenf Felder
--
--   skyisles-coll-1|zeilen|konten|sammlung_md5|schutz
--
--   1  skyisles-coll-1   die Marke
--   2  zeilen            count(*) ueber collection_items
--   3  konten            count(distinct user_id)
--   4  sammlung_md5      md5 ueber user_id|sky_id|quantity, sortiert
--   5  schutz            left(md5(Felder 2-4, mit | verbunden), 12)
--
--
-- RECHTEGESCHUETZTE ZEILEN. Der lesende Pruefzugang hat auf `offer_state`
-- kein `select` und auf `reservation_ttl()` kein `execute` (ADR-0139,
-- ADR-0141). Die betroffenen Zeilen stehen deshalb hinter
-- `has_table_privilege` bzw. `has_function_privilege` und lesen ueber
-- `query_to_xml`: ohne Recht melden sie `KEIN-RECHT`, zaehlen in Zeile 9998
-- und sind damit OFFEN — nicht bestanden, nicht abgewichen, sondern nicht
-- durchgefuehrt. Im SQL-Editor als `postgres` ist 9998 = 0.
--
-- Strukturen und Rechte kommen aus `pg_catalog`, nie aus
-- `information_schema`: das ist rechtegefiltert und meldete dem Pruefzugang
-- sonst „kein Objekt" bzw. „keine Grants", ohne hingesehen zu haben
-- (ADR-0141).
-- ===========================================================================

with sammelbar as (
  select s.sky_id
    from public.skylanders s
    join public.categories c on c.id = s.category_id
   where s.is_active and s.catalog_visible
     and not (c.name = any (public.non_collectible_categories()))
),
basis_mess as (
  -- Die sieben Zahlen, einmal gerechnet, hier und in Zeile 900 benutzt.
  select
    /*
     * DIE ZWEI FELDER, DIE `shop_offers()` BRAUCHEN — und das ist die einzige
     * Stelle des Basis-Vertrags, an der ein Recht fehlen kann.
     *
     * Fehlt `execute`, steht hier `KEIN-RECHT`: die Zeilen 811 und 812 sind
     * dann OFFEN (Zeile 9998 zaehlt sie), die uebrigen fuenf Felder werden
     * weiter gemessen und verglichen. Ein fehlendes Recht nimmt also nicht
     * die ganze Baseline mit — aber es wird auch nicht stillschweigend
     * uebergangen.
     */
    case when has_function_privilege('public.shop_offers()', 'execute')
         then (xpath('/row/c/text()', query_to_xml(
             'select count(*) as c from public.shop_offers()',
             false, true, '')))[1]::text
         else 'KEIN-RECHT' end as angebote,
    case when has_function_privilege('public.shop_offers()', 'execute')
         then (xpath('/row/c/text()', query_to_xml(
             'select md5(coalesce(string_agg(o.sky_id || ''|'' || o.condition || ''|'' '
             '|| coalesce(o.price::text, ''''), '
             ''';'' order by o.sky_id, o.condition), '''')) as c '
             'from public.shop_offers() o',
             false, true, '')))[1]::text
         else 'KEIN-RECHT' end as angebote_md5,
    (select count(*)::text from public.skylanders s
      where public.is_shop_eligible(s.sky_id))                             as shopfaehig,
    (select count(*)::text from sammelbar)                                 as sammelbar,
    (select count(*)::text from public.shop_inventory)                     as lagerzeilen,
    (select count(*)::text from public.skylanders)                         as katalogzeilen,
    (select coalesce(md5(string_agg(i.id::text || '|' || i.is_listed::text || '|'
                                    || coalesce(i.sale_price::text, '-') || '|'
                                    || i.sale_released::text,
                                    E'\n' order by i.id)), '(leer)')
       from public.shop_inventory i)                                       as lager_md5
),
basis_feld as (
  select angebote || '|' || angebote_md5 || '|' || shopfaehig || '|' || sammelbar
         || '|' || lagerzeilen || '|' || katalogzeilen || '|' || lager_md5 as kern,
         m.*
    from basis_mess m
),
basis_zeile as (
  select 'skyisles-base-1|' || kern || '|' || left(md5(kern), 12) as zeile, f.*
    from basis_feld f
),
coll_mess as (
  -- Die drei Zahlen der Sammlung, einmal gerechnet.
  select
    (select count(*)::text from public.collection_items)                   as zeilen,
    (select count(distinct user_id)::text from public.collection_items)    as konten,
    (select coalesce(md5(string_agg(ci.user_id::text || '|' || ci.sky_id || '|'
                                    || ci.quantity::text,
                                    E'\n' order by ci.user_id, ci.sky_id)), '(leer)')
       from public.collection_items ci)                                    as sammlung_md5
),
coll_feld as (
  select zeilen || '|' || konten || '|' || sammlung_md5 as kern, m.*
    from coll_mess m
),
coll_zeile as (
  select 'skyisles-coll-1|' || kern || '|' || left(md5(kern), 12) as zeile, f.*
    from coll_feld f
),
pruef (nr, bereich, pruefung, befund, erwartet) as (values
  (1, 'Umgebung', 'Info: Katalogzeilen',
      (select count(*)::text from public.skylanders), null),

  -- ------------------------------------------- 0146 steht vollstaendig
  (101, 'Grundlage', 'offer_state steht (0146)',
      (to_regclass('public.offer_state') is not null)::text, 'true'),
  (102, 'Grundlage', 'mit genau den acht Spalten aus 0146',
      coalesce((select string_agg(a.attname::text, ',' order by a.attnum)
                  from pg_attribute a
                 where a.attrelid = to_regclass('public.offer_state')
                   and a.attnum > 0 and not a.attisdropped),
               '(keine Tabelle)'),
      'sky_id,buyable,cheapest_cents,changed_at,checked_at,'
      || 'announced_buyable,announced_cents,announced_at'),
  (103, 'Grundlage', 'und fuenf CHECKs',
      (select count(*)::text from pg_constraint
        where conrelid = to_regclass('public.offer_state') and contype = 'c'), '5'),
  (104, 'Grundlage', 'offer_state_live steht und liest shop_offers()',
      coalesce((select (definition like '%shop_offers()%')::text from pg_views
                 where schemaname = 'public' and viewname = 'offer_state_live'),
               '(keine Sicht)'), 'true'),
  (105, 'Grundlage', 'refresh_offer_state() steht, definer und volatile',
      coalesce((select (prosecdef and provolatile = 'v')::text from pg_proc
                 where oid = to_regprocedure('public.refresh_offer_state()')),
               '(keine Funktion)'), 'true'),
  (106, 'Grundlage', 'offer_state_window() steht',
      (to_regprocedure('public.offer_state_window()') is not null)::text, 'true'),
  (107, 'Grundlage', 'reservation_ttl() steht (0010) — die Karenzzeit rechnet hiergegen',
      (to_regprocedure('public.reservation_ttl()') is not null)::text, 'true'),
  (108, 'Grundlage', 'Info: und sie ist',
      case when has_function_privilege('public.reservation_ttl()', 'execute')
           then (xpath('/row/c/text()', query_to_xml(
               'select public.reservation_ttl()::text as c',
               false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),

  -- --------------------------------------------- 0147 ist noch nicht da
  (111, 'Neu', 'buyable_since steht NOCH NICHT',
      (select count(*)::text from pg_attribute a
        where a.attrelid = to_regclass('public.offer_state')
          and a.attname = 'buyable_since'
          and a.attnum > 0 and not a.attisdropped), '0'),
  (112, 'Neu', 'offer_availability_grace() steht NOCH NICHT',
      (to_regprocedure('public.offer_availability_grace()') is null)::text, 'true'),
  (113, 'Neu', 'offer_availability_due() steht NOCH NICHT',
      (to_regprocedure('public.offer_availability_due()') is null)::text, 'true'),
  (114, 'Neu', 'und refresh_offer_state() nennt buyable_since noch nicht',
      coalesce((select (prosrc not like '%buyable_since%')::text from pg_proc
                 where oid = to_regprocedure('public.refresh_offer_state()')),
               '(keine Funktion)'), 'true'),

  /*
   * ------------------------------- Der Stand, den die Nachfuellung antrifft
   *
   * DIE NUETZLICHSTEN ZAHLEN DIESES BLATTES. `0147` setzt
   * `buyable_since = least(changed_at, announced_at)` fuer gemeldete und
   * `= changed_at` fuer ungemeldete Zeilen. Zeile 124 sagt vorher, wie viele
   * das `least()` schuetzt (Figuren, bei denen sich nach der Erstbefuellung
   * ein PREIS geaendert hat), und Zeile 125, wie viele nach `0147` zu Recht
   * faellig sind — naemlich die, ueber die noch nie berichtet wurde.
   */
  (121, 'Spiegel', 'Info: Zeilen im Spiegel',
            case when has_table_privilege('public.offer_state', 'select')
           then (xpath('/row/c/text()', query_to_xml(
               'select count(*) as c from public.offer_state',
               false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (122, 'Spiegel', 'Info: davon kaufbar',
            case when has_table_privilege('public.offer_state', 'select')
           then (xpath('/row/c/text()', query_to_xml(
               'select count(*) as c from public.offer_state where buyable',
               false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (123, 'Spiegel', 'Info: davon mit gemeldetem Stand',
            case when has_table_privilege('public.offer_state', 'select')
           then (xpath('/row/c/text()', query_to_xml(
               'select count(*) as c from public.offer_state where announced_at is not null',
               false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (124, 'Spiegel', 'Info: gemeldete kaufbare Zeilen mit changed_at HINTER announced_at '
        '(die least()-Faelle: dort hat sich ein Preis geaendert)',
            case when has_table_privilege('public.offer_state', 'select')
           then (xpath('/row/c/text()', query_to_xml(
               'select count(*) as c from public.offer_state '
               'where buyable and announced_at is not null and changed_at > announced_at',
               false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (125, 'Spiegel', 'Info: kaufbare Zeilen OHNE gemeldeten Stand — die werden nach 0147 '
        'zu Recht faellig',
            case when has_table_privilege('public.offer_state', 'select')
           then (xpath('/row/c/text()', query_to_xml(
               'select count(*) as c from public.offer_state where buyable and announced_at is null',
               false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (126, 'Spiegel', 'Info: Figuren mit mindestens einem kaufbaren Angebot (die Gegenwart)',
            case when has_table_privilege('public.offer_state_live', 'select')
           then (xpath('/row/c/text()', query_to_xml(
               'select count(*) as c from public.offer_state_live',
               false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),

  -- --------------------------------------------- Kein Trigger, und bleibt so
  /*
   * TRIGGER: BENANNTE ERWARTUNG, KEINE ZAEHLUNG.
   *
   * Eine Zeile „`count(*) = 0` an den Quellen" hat den Staging-Lauf von
   * `0147` am 2026-10-26 abgebrochen — mit sechs voellig legitimen Triggern
   * als Grund. Die Quellen HABEN Trigger (Zeitstempel, Unveraenderlichkeit,
   * Redaktionsprotokoll, Artikeltyp), und sie sollen sie haben. Dieselbe
   * Sorte Fehler wie die Richtlinienzahl in `0142`.
   *
   * Jetzt drei Zeilen: am Spiegel KEINER, an den Quellen nur die sechs
   * bekannten (jeder beim Namen), und die sechs sind noch da. Die Liste ist
   * in Migration, Preflight und Nachkontrolle dieselbe —
   * `availability.test.ts` prueft, dass sie nicht auseinanderlaufen.
   */
  (131, 'Trigger', 'Info: Trigger an den Quellen und am Spiegel',
      (select coalesce(string_agg(c.relname::text || '.' || t.tgname::text, ', '
                                  order by c.relname, t.tgname), '(keine)')
         from pg_trigger t
         join pg_class c on c.oid = t.tgrelid
        where c.oid in (to_regclass('public.shop_inventory'),
                        to_regclass('public.skylanders'),
                        to_regclass('public.shop_settings'),
                        to_regclass('public.offer_state'))
          and not t.tgisinternal), null),
  (132, 'Trigger', 'KEIN Trigger am Spiegel',
      (select count(*)::text from pg_trigger t
        where t.tgrelid = to_regclass('public.offer_state')
          and not t.tgisinternal), '0'),
  (133, 'Trigger', 'und an den Quellen nur die sechs bekannten — ein siebter ist zu '
        'klaeren, bevor 0147 laeuft',
      (select coalesce(string_agg(c.relname::text || '.' || t.tgname::text, ', '
                                  order by c.relname, t.tgname), '(keine)')
         from pg_trigger t
         join pg_class c on c.oid = t.tgrelid
        where c.oid in (to_regclass('public.shop_inventory'),
                        to_regclass('public.skylanders'),
                        to_regclass('public.shop_settings'),
                        to_regclass('public.offer_state'))
          and not t.tgisinternal
          and (c.relname::text || '.' || t.tgname::text) <> all (array[
             'shop_inventory.shop_inventory_identity_immutable',
             'shop_inventory.shop_inventory_set_updated_at',
             'skylanders.skylanders_item_type_from_category',
             'skylanders.skylanders_log_editorial',
             'skylanders.skylanders_set_updated_at',
             'skylanders.skylanders_sky_id_immutable'])),
      '(keine)'),
  (134, 'Trigger', 'die sechs bestehenden sind da (0001, 0003, 0004, 0135)',
      (select count(*)::text
         from pg_trigger t
         join pg_class c on c.oid = t.tgrelid
        where not t.tgisinternal
          and (c.relname::text || '.' || t.tgname::text) = any (array[
             'shop_inventory.shop_inventory_identity_immutable',
             'shop_inventory.shop_inventory_set_updated_at',
             'skylanders.skylanders_item_type_from_category',
             'skylanders.skylanders_log_editorial',
             'skylanders.skylanders_set_updated_at',
             'skylanders.skylanders_sky_id_immutable'])), '6'),

  -- --------------------------- Die Zahlen des Betriebs (Basis-Vertrag)
  (301, 'Shop', 'oeffentliche Angebote',
      (select angebote from basis_mess), null),
  (302, 'Shop', 'Angebots-Abdruck',
      (select angebote_md5 from basis_mess), null),
  (303, 'Shop', 'shopfaehige Katalogzeilen',
      (select shopfaehig from basis_mess), null),
  (304, 'Shop', 'sammelbare Katalogzeilen',
      (select sammelbar from basis_mess), null),
  (305, 'Shop', 'Lagerzeilen',
      (select lagerzeilen from basis_mess), null),
  (306, 'Shop', 'Katalogzeilen',
      (select katalogzeilen from basis_mess), null),
  (307, 'Shop', 'Lager-Abdruck',
      (select lager_md5 from basis_mess), null),
  (311, 'Nichts offen', 'freigegebene Lagerpositionen (0147 ruehrt das nicht an)',
      (select count(*)::text from public.shop_inventory i where i.sale_released), '0'),

  -- -------------------------------------------------------- Die Belegsperre
  (401, 'Belege', 'keine Grants auf die Belegtabellen fuer anon/authenticated',
      (select count(*)::text from pg_class c, aclexplode(c.relacl) a
        where c.oid in (to_regclass('public.platform_receipts'),
                        to_regclass('public.platform_receipt_sequence'))
          and a.grantee::regrole::text in ('anon', 'authenticated')), '0'),

  (900, 'BASIS', 'Shop-Baseline fuer die Nachkontrolle — vollstaendig kopieren',
      (select zeile from basis_zeile), null),
  (901, 'BASIS', 'Sammlungs-Baseline fuer die Nachkontrolle — vollstaendig kopieren',
      (select zeile from coll_zeile), null)
),
ergebnis as (
  /*
   * DREI ZUSTAENDE, NICHT ZWEI (ADR-0139).
   *
   *   ok = true   die Pruefung stimmt
   *   ok = false  sie weicht ab           → zaehlt in 9999, blockiert
   *   ok = null   Auskunft ODER OFFEN     → zaehlt nicht in 9999
   *
   * `KEIN-RECHT` heisst: diese Zeile greift auf ein Objekt zu, auf das die
   * aufrufende Rolle kein Recht hat. Das ist KEINE Abweichung, sondern eine
   * nicht durchgefuehrte Pruefung — Zeile 9998 zaehlt sie.
   */
  select nr, bereich, pruefung, befund, erwartet,
         case when befund = 'KEIN-RECHT' then null
              when erwartet is null then null
              else befund is not distinct from erwartet end as ok
    from pruef
)
select nr, bereich, pruefung, befund, erwartet, ok from ergebnis
union all
select 9998, 'GESAMT', 'Zeilen, die diese Rolle nicht lesen durfte '
       '(0 = vollstaendig geprueft)',
       (select count(*) from ergebnis where befund = 'KEIN-RECHT')::text, null, null
union all
select 9999, 'GESAMT', 'blockierende Abweichungen (muss 0 sein)',
       (select count(*) from ergebnis where ok is false)::text, '0',
       (select count(*) from ergebnis where ok is false) = 0
 order by nr;
