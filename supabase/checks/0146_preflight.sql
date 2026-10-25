-- ===========================================================================
-- 0146 PREFLIGHT — der Zustand VOR der Migration, rein lesend
--
-- `0146` legt `public.offer_state`, die Sicht `public.offer_state_live` und
-- die Funktionen `refresh_offer_state()` und `offer_state_window()` an.
-- Rein additiv: keine bestehende Tabelle, Spalte, Richtlinie, Funktion oder
-- Berechtigung wird angefasst, und **kein Trigger** entsteht.
--
-- DIE ENTSCHEIDENDEN ZEILEN SIND 101 UND 110. Der Spiegel liest
-- `shop_offers()`, und zwar die Fassung aus `0139` — zu erkennen an der
-- fuenften Spalte `delivery_scope` und am Aufruf von
-- `is_position_sellable()`. Laeuft hier eine aeltere Fassung, rechnet `0146`
-- mit einer anderen Projektion als der, die der Shop zeigt, und dann nicht
-- fahren, sondern melden.
--
-- ZWEI VERTRAEGE GEHEN WEITER, ZEILE 900 UND ZEILE 901.
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
-- Beide unveraendert aus `0142` bis `0145`; die Messbloecke unten sind
-- zeichengleich dieselben, damit eine Baseline aus einem dieser Laeufe hier
-- lesbar ist und umgekehrt.
--
-- NUR LESEN. Ein einziges SELECT. Zeile 9999 muss 0 zeigen.
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
    (select count(*)::text from public.shop_offers())                      as angebote,
    (select md5(coalesce(string_agg(o.sky_id || '|' || o.condition || '|'
                                    || coalesce(o.price::text, ''),
                                    ';' order by o.sky_id, o.condition), ''))
       from public.shop_offers() o)                                        as angebote_md5,
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

  -- ---------------------------------------------------- Was 0146 voraussetzt
  (101, 'Grundlage', 'shop_offers() steht, genau einmal',
      (select count(*)::text from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'shop_offers'), '1'),
  (102, 'Grundlage', 'und es ist die Fassung aus 0139 — fuenf Spalten, mit delivery_scope',
      (select string_agg(a.attname, ',' order by a.ord)::text
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         cross join lateral unnest(p.proargnames) with ordinality as a(attname, ord)
        where n.nspname = 'public' and p.proname = 'shop_offers'),
      'sky_id,condition,price,available,delivery_scope'),
  (103, 'Grundlage', 'sie filtert is_position_sellable() (0139), nicht is_shop_eligible()',
      (select (p.prosrc like '%is_position_sellable(i.id)%')::text from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'shop_offers'), 'true'),
  (104, 'Grundlage', 'und den V1-Zustand ueber v1_sale_condition()',
      (select (p.prosrc like '%v1_sale_condition()%')::text from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'shop_offers'), 'true'),
  (105, 'Grundlage', 'v1_sale_condition() steht (0028)',
      (to_regprocedure('public.v1_sale_condition()') is not null)::text, 'true'),
  (106, 'Grundlage', 'shop_price() steht (0007) — die eine Preisregel',
      (to_regprocedure('public.shop_price(numeric, numeric, numeric)') is not null)::text,
      'true'),
  (107, 'Grundlage', 'reservation_ttl() steht (0010) — daraus leitet S2 die Karenzzeit ab',
      (to_regprocedure('public.reservation_ttl()') is not null)::text, 'true'),
  (108, 'Grundlage', 'Info: und sie ist',
      case when has_function_privilege('public.reservation_ttl()', 'execute')
           then (xpath('/row/c/text()', query_to_xml(
                  'select public.reservation_ttl()::text as c',
                  false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (109, 'Grundlage', 'available_quantity ist weiterhin eine GENERIERTE Spalte',
      (select is_generated from information_schema.columns
        where table_schema = 'public' and table_name = 'shop_inventory'
          and column_name = 'available_quantity'), 'ALWAYS'),

  -- --------------------------------------- Und 0146 ist noch nicht da
  (110, 'Neu', 'offer_state steht NOCH NICHT',
      (to_regclass('public.offer_state') is null)::text, 'true'),
  (111, 'Neu', 'offer_state_live steht NOCH NICHT',
      (to_regclass('public.offer_state_live') is null)::text, 'true'),
  (112, 'Neu', 'refresh_offer_state() steht NOCH NICHT',
      (to_regprocedure('public.refresh_offer_state()') is null)::text, 'true'),
  (113, 'Neu', 'offer_state_window() steht NOCH NICHT',
      (to_regprocedure('public.offer_state_window()') is null)::text, 'true'),

  -- ------------------- Kein Trigger an den drei Preis- und Bestandsquellen
  /*
   * DIE ZENTRALE ZUSAGE VON 0146, schon vorher gemessen. Steht hier etwas,
   * stammt es NICHT von dieser Migration — und dann gehoert die Frage vor
   * den Lauf, nicht in ihn.
   */
  /*
   * ALS AUSKUNFT, NICHT ALS ZAHL. Hier standen drei feste Trigger-Anzahlen —
   * und das ist genau der Fehler, den `0142` am 2026-10-25 schon einmal
   * hatte: eine Konstante, die ein voellig berechtigter fremder Lauf bricht.
   * Legt irgendeine kuenftige Migration einen Trigger an, soll dieses Blatt
   * ihn NENNEN und nicht das Release anhalten.
   *
   * Blockierend ist allein Zeile 124 — und die fragt nach `0146`, nicht nach
   * der Welt.
   */
  (121, 'Kein Trigger', 'Info: eigene Trigger auf shop_inventory',
      coalesce((select string_agg(tgname, ', ' order by tgname) from pg_trigger
                 where tgrelid = 'public.shop_inventory'::regclass
                   and not tgisinternal), '(keine)'), null),
  (122, 'Kein Trigger', 'Info: eigene Trigger auf skylanders',
      coalesce((select string_agg(tgname, ', ' order by tgname) from pg_trigger
                 where tgrelid = 'public.skylanders'::regclass
                   and not tgisinternal), '(keine)'), null),
  (123, 'Kein Trigger', 'Info: eigene Trigger auf shop_settings',
      coalesce((select string_agg(tgname, ', ' order by tgname) from pg_trigger
                 where tgrelid = 'public.shop_settings'::regclass
                   and not tgisinternal), '(keine)'), null),
  (124, 'Kein Trigger', 'und keiner davon traegt offer_state im Namen',
      (select count(*)::text from pg_trigger
        where tgrelid in ('public.shop_inventory'::regclass,
                          'public.skylanders'::regclass,
                          'public.shop_settings'::regclass)
          and not tgisinternal and tgname like '%offer_state%'), '0'),

  -- ----------------------- Was der Spiegel beim ersten Lauf sehen wird
  /*
   * REIN INFORMATIV, aber der nuetzlichste Wert dieses Blattes: so viele
   * Zeilen bekommt `offer_state` beim ersten `refresh_offer_state()`, und
   * alle werden BEREITS GEMELDET angelegt. Weicht die Zahl in der
   * Nachkontrolle davon ab, hat sich der Shop zwischen den Blaettern bewegt.
   */
  (131, 'Spiegel', 'Info: Figuren mit mindestens einem kaufbaren Angebot',
      case when has_function_privilege('public.v1_sale_condition()', 'execute')
           then (xpath('/row/c/text()', query_to_xml(
                  'select count(distinct o.sky_id) as c from public.shop_offers() o '
                  'where o.available and o.condition = public.v1_sale_condition()',
                  false, true, '')))[1]::text
           else 'KEIN-RECHT' end, null),
  (132, 'Spiegel', 'Info: Zeilen in shop_offers() insgesamt',
      (select count(*)::text from public.shop_offers()), null),
  (133, 'Spiegel', 'Info: davon ausverkauft (available = false)',
      (select count(*)::text from public.shop_offers() o where not o.available), null),
  /*
   * `coalesce` BLEIBT AUSSEN. Mit `nulls = false` laesst `query_to_xml` eine
   * NULL-Spalte weg, `xpath` liefert dann ein leeres Array und `[1]` ist
   * NULL — also genau der Fall „kein kaufbares Angebot", und er heisst
   * weiterhin `(keiner)` und nicht `KEIN-RECHT`. Zwei verschiedene Dinge
   * duerfen nicht denselben Namen bekommen.
   */
  (134, 'Spiegel', 'Info: guenstigster kaufbarer Preis in Cent, ueber alle Figuren',
      case when has_function_privilege('public.v1_sale_condition()', 'execute')
           then coalesce((xpath('/row/c/text()', query_to_xml(
                  'select min(round(o.price * 100)) as c from public.shop_offers() o '
                  'where o.available and o.condition = public.v1_sale_condition()',
                  false, true, '')))[1]::text, '(keiner)')
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

  -- ------------------------- Die Zahlen der Sammlung (Sammlungs-Vertrag)
  (321, 'Sammlung', 'Sammlungszeilen',
      (select zeilen from coll_mess), null),
  (322, 'Sammlung', 'Konten mit Sammlung',
      (select konten from coll_mess), null),
  (323, 'Sammlung', 'Sammlungs-Abdruck',
      (select sammlung_md5 from coll_mess), null),

  -- ------------------------------- Nichts ist freigegeben, und bleibt es
  (311, 'Nichts offen', 'freigegebene Lagerpositionen (0146 ruehrt das nicht an)',
      (select count(*)::text from public.shop_inventory i where i.sale_released), '0'),
  (312, 'Nichts offen', 'Zubehoerzeilen im oeffentlichen Angebot',
      (select count(*)::text from public.shop_offers() o
         join public.skylanders s on s.sky_id = o.sky_id
        where s.item_type <> 'figure'), '0'),

  -- -------------------------------------------------------- Die Belegsperre
  (401, 'Belege', 'keine Grants auf die Belegtabellen fuer anon/authenticated',
      (select count(*)::text from information_schema.role_table_grants g
        where g.table_schema = 'public'
          and g.table_name in ('platform_receipts', 'platform_receipt_sequence')
          and g.grantee in ('anon', 'authenticated')), '0'),
  (402, 'Belege', 'keine API-Rolle darf ausstellen oder korrigieren',
      (select count(*)::text from pg_proc p, aclexplode(p.proacl) a
        where p.oid in (to_regprocedure('public.issue_platform_receipt(bigint)'),
                        to_regprocedure('public.correct_platform_receipt(bigint, text)'))
          and a.privilege_type = 'EXECUTE'
          and (a.grantee = 0
               or a.grantee::regrole::text in ('anon', 'authenticated', 'service_role'))),
      '0'),

  -- ===================== Die beiden Zeilen, die weitergehen
  /*
   * BEIDE vollstaendig kopieren und in der Nachkontrolle oben einsetzen:
   *
   *   select set_config('skyisles.base', '<Zeile 900>', true);
   *   select set_config('skyisles.coll', '<Zeile 901>', true);
   *
   * Die Nachkontrolle vergleicht dann BLOCKIEREND gegen genau diesen Stand.
   * `0146` fasst weder Shop noch Sammlung an, also darf sich dort nichts
   * bewegen.
   */
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
