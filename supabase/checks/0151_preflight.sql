-- ===========================================================================
-- STAGING/PRODUCTION — DER ZUSTAND VOR 0151, REIN LESEND
--
-- VOR `0151_offer_state_live.sql` fahren. **Erwartet: Zeile 9999 = `0`.**
--
-- *** DIESER PREFLIGHT HAT ZWEI GUELTIGE AUSGANGSLAGEN ***
--
-- Anders als jeder andere in dieser Reihe: `0151` darf eine Sicht vorfinden
-- (Staging) oder keine (Production), und BEIDES ist richtig. Zeile 111 ist
-- deshalb **Auskunft ohne Erwartung** und nicht eine Pruefung — eine
-- Erwartung daran waere fuer genau eine der zwei Umgebungen falsch.
--
--   101-102  WAS DIE SICHT WIRKLICH LIEST: `shop_offers()` (0029/0139) und
--            `v1_sale_condition()` (0028). Mehr braucht `0151` nicht, und
--            `offer_state`, `favorites` sowie `availability_notifications`
--            stehen hier ausdruecklich NICHT — auf Production liegt keine
--            der drei, und genau dort soll diese Migration laufen.
--   111-112  WELCHE AUSGANGSLAGE hier vorliegt, als Auskunft. Steht die
--            Sicht, nennt 112 ihre Spalten; dann wird `0151` sie pruefen und
--            NICHT anfassen.
--   113      DER EINE ABBRUCHGRUND, der vorher auffallen soll: der Name ist
--            frei ODER bezeichnet eine Sicht. Etwas anderes unter diesem
--            Namen kann eine Migration nicht klaeren.
--   121-124  der Stand, auf den `0151` trifft, und was die alte Bauform
--            fuehrt — alles Auskunft ohne Erwartung.
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

  -- ------------------------------- Was die Sicht liest, und nur das
  (101, 'Grundlage', 'shop_offers() steht (0029/0139)',
      (to_regprocedure('public.shop_offers()') is not null)::text, 'true'),
  (102, 'Grundlage', 'v1_sale_condition() steht (0028)',
      (to_regprocedure('public.v1_sale_condition()') is not null)::text, 'true'),

  -- ------------------------- Welche der zwei Ausgangslagen liegt vor?
  /*
   * AUSKUNFT OHNE ERWARTUNG, und das ist die Besonderheit dieser Datei.
   * `true` heisst Staging (die Sicht wird geprueft und bleibt), `false`
   * heisst Production (sie wird angelegt). Beides ist richtig.
   */
  (111, 'Ausgangslage', 'Info: steht public.offer_state_live schon?',
      (to_regclass('public.offer_state_live') is not null)::text, null),
  (112, 'Ausgangslage', 'Info: und mit welchen Spalten (leer, wenn sie fehlt)',
      coalesce((select string_agg(a.attname::text || ' '
                                  || format_type(a.atttypid, a.atttypmod),
                                  ', ' order by a.attnum)
                 from pg_attribute a
                where a.attrelid = to_regclass('public.offer_state_live')
                  and a.attnum > 0 and not a.attisdropped),
               '(keine Sicht)'), null),
  (113, 'Ausgangslage', 'der Name ist frei ODER bezeichnet eine Sicht — etwas '
        'anderes kann eine Migration nicht klaeren',
      (not exists (select 1 from pg_class c
                     join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'public'
                      and c.relname = 'offer_state_live'
                      and c.relkind <> 'v'))::text, 'true'),

  -- ------------------------------------------ Der Stand, auf den 0151 trifft
  (121, 'Stand', 'Info: Figuren, die JETZT kaufbar sind (laut der Sicht)',
      case when to_regclass('public.offer_state_live') is null
             then '(keine Sicht)'
           when has_table_privilege('public.offer_state_live', 'select')
             then (xpath('/row/c/text()', query_to_xml(
                 'select count(*) as c from public.offer_state_live',
                 false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (122, 'Stand', 'Info: steht die alte Bauform? '
        'offer_state/favorites/availability_notifications',
      (to_regclass('public.offer_state') is not null)::text || '/'
      || (to_regclass('public.favorites') is not null)::text || '/'
      || (to_regclass('public.availability_notifications') is not null)::text,
      null),
  (123, 'Stand', 'Info: steht 0150 schon? (0151 gehoert DAVOR, ist aber '
        'auch danach folgenlos wiederholbar)',
      (to_regclass('public.availability_alerts') is not null)::text, null),
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
  (311, 'Nichts offen', 'freigegebene Lagerpositionen (0151 ruehrt das nicht an)',
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
