-- ===========================================================================
-- STAGING/PRODUCTION — DER ZUSTAND VOR 0150, REIN LESEND
--
-- VOR `0150_availability_alerts.sql` fahren. **Erwartet: Zeile
-- 9999 = `0`.**
--
--   101-106  WAS `0150` WIRKLICH VORAUSSETZT, und nicht mehr. Die Sicht
--            `offer_state_live` (`0146`) — die SICHT, nicht die Tabelle —,
--            `is_collector_account()` (`0042`), `shop_offers()`,
--            `v1_sale_condition()` (`0028`), `auth.users` und
--            `skylanders`. **`favorites`, `offer_state` und
--            `availability_notifications` stehen hier ausdruecklich NICHT:**
--            `0150` liest keine davon, und eine Vorbedingung, die sie
--            verlangt, waere eine Umgebungsannahme als Zusage verkleidet —
--            auf Production liegt keine der drei.
--   111-116  `0150` ist NOCH NICHT da. Ein zweiter Lauf soll an seiner
--            eigenen Vorbedingung abprallen; gemessen wird das hier VORHER,
--            damit ein Abbruch nicht erst in der Migration auffaellt.
--   121-124  der Stand, auf den `0150` trifft: wie viele Figuren jetzt
--            kaufbar sind, und was die alte Bauform fuehrt. Die drei Zahlen
--            zur alten Bauform sind **Auskunft ohne Erwartung** — sie
--            duerfen fehlen, und sie duerfen sich nicht bewegen.
--
-- RECHTEGESCHUETZTE ZEILEN. Der lesende Pruefzugang darf `offer_state_live`,
-- `favorites`, `offer_state` und `availability_notifications` nicht lesen.
-- Diese Zeilen melden ihm `KEIN-RECHT`, zaehlen in Zeile 9998 und sind
-- OFFEN — die Abnahme braucht den Lauf als `postgres` (ADR-0139, ADR-0141).
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

  -- ------------------------------- Was 0150 voraussetzt, und nur das
  (101, 'Grundlage', 'die SICHT offer_state_live steht (0151; auf Staging '
        'historisch aus 0146)',
      (to_regclass('public.offer_state_live') is not null)::text, 'true'),
  (102, 'Grundlage', 'is_collector_account() steht (0042)',
      (to_regprocedure('public.is_collector_account()') is not null)::text, 'true'),
  (103, 'Grundlage', 'shop_offers() steht — die Sicht liest sie',
      (to_regprocedure('public.shop_offers()') is not null)::text, 'true'),
  (104, 'Grundlage', 'v1_sale_condition() steht (0028) — die Sicht fragt sie',
      (to_regprocedure('public.v1_sale_condition()') is not null)::text, 'true'),
  /*
   * AUS `pg_catalog`, NICHT MIT `to_regclass` — und das war ein Befund.
   *
   * `to_regclass('auth.users')` braucht `USAGE` auf dem Schema `auth`, und
   * der lesende Pruefzugang hat es nicht: die Zeile warf
   * `permission denied for schema auth` und nahm damit die GANZE Einreichung
   * mit, statt KEIN-RECHT zu melden. Gefunden hat es Probelauf **P54**, der
   * jede Runner-Pruefdatei unter dem Pruefzugang fahrt.
   *
   * Dieselbe Klasse Fehler wie `information_schema` in ADR-0141 und wie die
   * fuenf Zeilen in `offer_state_freshness.sql`, die das Recht auf
   * `shop_offers()` prueften und die Sicht lasen (`df7337c`): ein Waechter,
   * der die falsche Frage stellt. `pg_class` und `pg_namespace` sind nicht
   * rechtegefiltert und beantworten dieselbe Frage.
   */
  (105, 'Grundlage', 'auth.users steht',
      (exists (select 1 from pg_class c
                 join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'auth' and c.relname = 'users'
                  and c.relkind = 'r'))::text, 'true'),
  (106, 'Grundlage', 'skylanders steht (0001)',
      (to_regclass('public.skylanders') is not null)::text, 'true'),

  -- --------------------------------------------- 0150 ist noch nicht da
  (111, 'Neu', 'availability_alerts steht NOCH NICHT',
      (to_regclass('public.availability_alerts') is not null)::text, 'false'),
  (112, 'Neu', 'watch_availability(text) steht NOCH NICHT',
      (to_regprocedure('public.watch_availability(text)') is not null)::text, 'false'),
  (113, 'Neu', 'unwatch_availability(text) steht NOCH NICHT',
      (to_regprocedure('public.unwatch_availability(text)') is not null)::text, 'false'),
  (114, 'Neu', 'fire_availability_alerts() steht NOCH NICHT',
      (to_regprocedure('public.fire_availability_alerts()') is not null)::text, 'false'),
  (115, 'Neu', 'acknowledge_availability_alerts(bigint[]) steht NOCH NICHT',
      (to_regprocedure('public.acknowledge_availability_alerts(bigint[])')
        is not null)::text, 'false'),
  (116, 'Neu', 'keiner der drei Indexnamen ist belegt',
      (select count(*)::text from pg_class c
        where c.relname in ('availability_alerts_open_uniq',
                            'availability_alerts_unread_idx',
                            'availability_alerts_pending_idx')), '0'),

  -- ------------------------------------------ Der Stand, auf den 0150 trifft
  (121, 'Stand', 'Info: Figuren, die JETZT kaufbar sind (offer_state_live)',
      case when to_regclass('public.offer_state_live') is null
             then '(keine Sicht)'
           when has_table_privilege('public.offer_state_live', 'select')
             then (xpath('/row/c/text()', query_to_xml(
                 'select count(*) as c from public.offer_state_live',
                 false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  /*
   * DREI AUSKUENFTE OHNE ERWARTUNG, und das ist Absicht: die alte Bauform
   * darf hier FEHLEN (Production) und darf sich nicht bewegen (Staging).
   * Eine Erwartung daran waere beides zugleich falsch.
   */
  (122, 'Stand', 'Info: Favoriten insgesamt (0150 liest sie nicht)',
      case when to_regclass('public.favorites') is null then '(keine Tabelle)'
           when has_table_privilege('public.favorites', 'select')
             then (xpath('/row/c/text()', query_to_xml(
                 'select count(*) as c from public.favorites',
                 false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (123, 'Stand', 'Info: Meldungen der alten Bauform (0150 ruehrt sie nicht an)',
      case when to_regclass('public.availability_notifications') is null
             then '(keine Tabelle)'
           when has_table_privilege('public.availability_notifications', 'select')
             then (xpath('/row/c/text()', query_to_xml(
                 'select count(*) as c from public.availability_notifications',
                 false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (124, 'Stand', 'Info: Spiegelzeilen mit gemeldetem Stand (announced_at)',
      case when to_regclass('public.offer_state') is null then '(keine Tabelle)'
           when has_table_privilege('public.offer_state', 'select')
             then (xpath('/row/c/text()', query_to_xml(
                 'select count(*) as c from public.offer_state '
                 'where announced_at is not null', false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),

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
  (311, 'Nichts offen', 'freigegebene Lagerpositionen (0150 ruehrt das nicht an)',
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
