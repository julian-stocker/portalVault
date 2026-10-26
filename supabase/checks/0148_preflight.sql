-- ===========================================================================
-- STAGING/PRODUCTION — DER ZUSTAND VOR 0148, REIN LESEND
--
-- VOR `0148_availability_notifications.sql` fahren. **Erwartet: Zeile
-- 9999 = `0`.**
--
--   101-107  `0145`, `0146` und `0147` stehen VOLLSTAENDIG. `0148` setzt
--            alle drei voraus: die Favoriten, den Spiegel, die Phasengrenze
--            und die Erkennung.
--   111-114  `0148` ist NOCH NICHT da — ein zweiter Lauf soll an seiner
--            eigenen Vorbedingung abprallen.
--   121-124  der Stand, auf den die erste Verarbeitung trifft: wie viele
--            Ereignisse faellig sind und wie viele Favoriten betroffen
--            waeren. **Diese Zahlen sagen vorher, wie viele Meldungen beim
--            ersten Aufruf entstehen.**
--
-- RECHTEGESCHUETZTE ZEILEN. Der lesende Pruefzugang darf `offer_state`,
-- `favorites` und `availability_notifications` nicht lesen und
-- `offer_availability_due()` nicht aufrufen. Diese Zeilen melden ihm
-- `KEIN-RECHT`, zaehlen in Zeile 9998 und sind OFFEN — die Abnahme braucht
-- den Lauf als `postgres` (ADR-0139, ADR-0141).
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

  -- --------------------------------------- 0145, 0146 und 0147 stehen
  (101, 'Grundlage', 'favorites steht (0145)',
      (to_regclass('public.favorites') is not null)::text, 'true'),
  (102, 'Grundlage', 'offer_state steht mit neun Spalten (0146 + 0147)',
      coalesce((select string_agg(a.attname::text, ',' order by a.attnum)
                  from pg_attribute a
                 where a.attrelid = to_regclass('public.offer_state')
                   and a.attnum > 0 and not a.attisdropped),
               '(keine Tabelle)'),
      'sky_id,buyable,cheapest_cents,changed_at,checked_at,'
      || 'announced_buyable,announced_cents,announced_at,buyable_since'),
  (103, 'Grundlage', 'offer_availability_due() ist definer und STABLE',
      coalesce((select (prosecdef and provolatile = 's')::text from pg_proc
                 where oid = to_regprocedure('public.offer_availability_due()')),
               '(keine Funktion)'), 'true'),
  (104, 'Grundlage', 'offer_availability_grace() steht',
      (to_regprocedure('public.offer_availability_grace()') is not null)::text, 'true'),
  (105, 'Grundlage', 'is_collector_account() steht (0042)',
      (to_regprocedure('public.is_collector_account()') is not null)::text, 'true'),
  /*
   * HIER STAND `to_regclass('auth.users')`, UND DAS WAR EIN FEHLGRIFF.
   *
   * Die Namensauflösung braucht `usage` auf dem Schema `auth`, und das hat
   * der lesende Pruefzugang nicht — er bekommt `usage` nur auf `public`.
   * Die Zeile haette also die GANZE Einreichung mit
   * „permission denied for schema auth" abgebrochen, genau wie
   * `information_schema` es getan hat (ADR-0141).
   *
   * Sie war ausserdem redundant: `favorites` (Zeile 101) traegt denselben
   * Fremdschluessel auf `auth.users` seit `0145`. Steht die Tabelle, steht
   * auch das Ziel.
   */
  (106, 'Grundlage', 'favorites hat die drei Richtlinien aus 0145',
      (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'favorites'), '3'),

  -- ----------------------------------------- 0148 ist noch nicht da
  (111, 'Neu', 'availability_notifications steht NOCH NICHT',
      (to_regclass('public.availability_notifications') is null)::text, 'true'),
  (112, 'Neu', 'claim_availability_notifications() steht NOCH NICHT',
      (to_regprocedure('public.claim_availability_notifications()') is null)::text,
      'true'),
  (113, 'Neu', 'und kein Trigger auf favorites oder offer_state',
      (select count(*)::text from pg_trigger t
        where t.tgrelid in (to_regclass('public.favorites'),
                            to_regclass('public.offer_state'))
          and not t.tgisinternal), '0'),

  /*
   * ------------------------- Der Stand, auf den die erste Verarbeitung trifft
   *
   * DIE NUETZLICHSTEN ZAHLEN DIESES BLATTES. Zeile 122 sagt, wie viele
   * Ereignisse faellig sind, und Zeile 123, wie viele Favoriten davon
   * betroffen waeren — also wie viele Meldungen der erste Aufruf von
   * `claim_availability_notifications()` anlegt. Steht dort 0, ist das der
   * erwartete Normalfall: der Spiegel ist seit `0146` vollstaendig gemeldet.
   */
  (121, 'Stand', 'Info: Favoriten insgesamt',
      case when has_table_privilege('public.favorites', 'select')
           then (xpath('/row/c/text()', query_to_xml(
               'select count(*) as c from public.favorites',
               false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (122, 'Stand', 'Info: faellige Verfuegbarkeitsereignisse',
      case when has_function_privilege('public.offer_availability_due()', 'execute')
           then (xpath('/row/c/text()', query_to_xml(
               'select count(*) as c from public.offer_availability_due()',
               false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (123, 'Stand', 'Info: davon betroffene Favoriten (created_at < buyable_since) — '
        'so viele Meldungen entstehen beim ersten Aufruf',
      case when has_function_privilege('public.offer_availability_due()', 'execute')
            and has_table_privilege('public.favorites', 'select')
           then (xpath('/row/c/text()', query_to_xml(
               'select count(*) as c from public.offer_availability_due() d '
               'join public.favorites v on v.sky_id = d.sky_id '
               'where v.created_at < d.buyable_since',
               false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (124, 'Stand', 'Info: Zeilen im Spiegel',
      case when has_table_privilege('public.offer_state', 'select')
           then (xpath('/row/c/text()', query_to_xml(
               'select count(*) as c from public.offer_state',
               false, true, '')))[1]::text
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
  (311, 'Nichts offen', 'freigegebene Lagerpositionen (0148 ruehrt das nicht an)',
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
