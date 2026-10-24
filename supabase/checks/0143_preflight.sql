-- ===========================================================================
-- 0143 PREFLIGHT — der Zustand VOR der Migration, rein lesend
--
-- `0143` legt EINE neue Funktion an:
-- `seller_create_purchase_from_calculation(uuid, …13)`. Sie legt den Einkauf
-- NICHT selbst an, sondern ruft `seller_create_purchase_with_items`
-- unveraendert auf und schreibt in derselben Transaktion `purchase_id` in
-- die Kalkulation. Rein additiv — keine Tabelle, keine Spalte, kein
-- bestehender Rumpf, kein bestehendes Recht.
--
-- Diese Datei haelt fest: `0142` steht und ist unveraendert, der EINE
-- bestehende Weg in einen Einkauf steht genau einmal, die Funktion ist noch
-- nicht da, und mit welchen Zahlen der Betrieb in den Lauf geht.
--
-- SIE SETZT 0142 VORAUS. Zeile 101 ist der Grund, warum die Reihenfolge
-- nicht beliebig ist.
--
-- DER MODUS WAEHLT DIE UMGEBUNG, nicht die Zahlen: `staging`, `production`
-- oder `keine`. Ohne Modus ist Zeile 902 blockierend.
--
--   select set_config('skyisles.z0', 'production', true);
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
vertrag as (
  select nullif(btrim(coalesce(current_setting('skyisles.z0', true), '')), '') as modus
),
z0 (schluessel, staging, production) as (values
  /*
   * Dieselbe Form und derselbe Grund wie in `0142_preflight.sql`: die
   * Staging-Spalte ist `null`, weil `0143` dort seit dem 2026-10-24 liegt
   * und ein Preflight zu spaet kaeme. Rechts der Production-Stand nach
   * `0141`, vom Betreiber bestaetigt.
   */
  ('angebote',      null, '287'),
  ('angebote_md5',  null, '9b8341058bbfa0f7809eddc300ab0e9e'),
  ('shopfaehig',    null, '531'),
  ('sammelbar',     null, '531'),
  ('lagerzeilen',   null, '306'),
  ('katalogzeilen', null, '624'),
  ('lager_md5',     null, '01e50b9d727a0486ff1ea0eb6ba2dd56')
),
soll as (
  select z.schluessel,
         case (select v.modus from vertrag v)
           when 'staging'    then z.staging
           when 'production' then z.production
         end as wert
    from z0 z
),

pruef (nr, bereich, pruefung, befund, erwartet) as (values

  (1, 'Umgebung', 'Info: Katalogzeilen',
      (select count(*)::text from public.skylanders), null),

  -- ------------------------------------------------- 0142 steht, vollstaendig
  (101, 'Grundlage', 'purchase_calculations steht (0142) — ohne sie laeuft 0143 nicht',
      (to_regclass('public.purchase_calculations') is not null)::text, 'true'),
  (102, 'Grundlage', 'Row Level Security ist dort eingeschaltet',
      coalesce((select relrowsecurity::text from pg_class
                 where oid = to_regclass('public.purchase_calculations')),
               '(keine Tabelle)'), 'true'),
  (103, 'Grundlage', 'und sie traegt ihre vier Richtlinien',
      (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'purchase_calculations'), '4'),
  (104, 'Grundlage', 'anon hat dort KEIN Tabellenrecht',
      (select count(*)::text from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'purchase_calculations'
          and grantee = 'anon'), '0'),
  (105, 'Grundlage', 'der PARTIELLE Unique-Index auf purchase_id steht — '
        'die zweite Haelfte der Doppelsperre',
      (select count(*)::text from pg_indexes
        where schemaname = 'public'
          and indexname = 'purchase_calculations_purchase_uniq'
          and indexdef like '%WHERE (purchase_id IS NOT NULL)%'), '1'),

  -- ------------------------------------ Der EINE bestehende Weg in einen Einkauf
  /*
   * ES GIBT GENAU EINEN, UND DAS IST DER PUNKT. `0143` ruft ihn auf, statt
   * ihn nachzubauen. Stuende hier eine zweite Signatur aus einer frueheren
   * Fassung, waere nicht mehr entscheidbar, welche die neue Funktion
   * erwischt — PostgreSQL wuerde nach Typen aufloesen, und zwei
   * Ueberladungen sind genau die Sorte Unterschied, die spaeter niemand
   * findet.
   */
  (111, 'Ein Weg', 'seller_create_purchase_with_items steht, genau einmal',
      (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'seller_create_purchase_with_items'), '1'),
  (112, 'Ein Weg', 'und zwar mit den dreizehn Parametern aus 0064/0115/0116/0120',
      (to_regprocedure('public.seller_create_purchase_with_items(date, numeric, text, '
                       'boolean, jsonb, text, text, numeric, numeric, numeric, text, '
                       'text, text)') is not null)::text, 'true'),
  (113, 'Ein Weg', 'seller_create_purchase steht, genau einmal',
      (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'seller_create_purchase'), '1'),
  (114, 'Ein Weg', 'can_operate_active_seller() steht (0041) — der erste Riegel',
      (to_regprocedure('public.can_operate_active_seller()') is not null)::text, 'true'),
  (115, 'Ein Weg', 'purchases.client_token steht (0120) — die Idempotenz',
      (select (count(*) = 1)::text from information_schema.columns
        where table_schema = 'public' and table_name = 'purchases'
          and column_name = 'client_token'), 'true'),

  -- ------------------------------------------- Und 0143 ist noch nicht da
  (120, 'Neu', 'seller_create_purchase_from_calculation fehlt NOCH — '
        'sonst bricht 0143 ab',
      (to_regprocedure('public.seller_create_purchase_from_calculation(uuid, date, '
                       'numeric, text, boolean, jsonb, text, text, numeric, numeric, '
                       'numeric, text, text, text)') is null)::text, 'true'),
  (121, 'Neu', 'und auch nicht unter einer anderen Signatur',
      (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'seller_create_purchase_from_calculation'), '0'),

  -- --------------------------- Die Zahlen, die Nutzer kennen (Z0-Vertrag)
  (301, 'Unberuehrt', 'oeffentliche Angebote',
      (select count(*)::text from public.shop_offers()),
      (select wert from soll where schluessel = 'angebote')),
  (302, 'Unberuehrt', 'Abdruck ueber die Angebotsliste (sky_id|condition|price)',
      (select md5(coalesce(string_agg(o.sky_id || '|' || o.condition || '|'
                                      || coalesce(o.price::text, ''),
                                      ';' order by o.sky_id, o.condition), ''))
         from public.shop_offers() o),
      (select wert from soll where schluessel = 'angebote_md5')),
  (303, 'Unberuehrt', 'shopfaehige Katalogzeilen',
      (select count(*)::text from public.skylanders s
        where public.is_shop_eligible(s.sky_id)),
      (select wert from soll where schluessel = 'shopfaehig')),
  (304, 'Unberuehrt', 'sammelbare Katalogzeilen (Fortschrittsnenner)',
      (select count(*)::text from sammelbar),
      (select wert from soll where schluessel = 'sammelbar')),
  (305, 'Unberuehrt', 'Lagerzeilen',
      (select count(*)::text from public.shop_inventory),
      (select wert from soll where schluessel = 'lagerzeilen')),
  (306, 'Unberuehrt', 'Katalogzeilen',
      (select count(*)::text from public.skylanders),
      (select wert from soll where schluessel = 'katalogzeilen')),
  (307, 'Unberuehrt', 'Abdruck ueber Listung, Preis und Freigabe jeder Lagerzeile',
      (select coalesce(md5(string_agg(i.id::text || '|' || i.is_listed::text || '|'
                                      || coalesce(i.sale_price::text, '-') || '|'
                                      || i.sale_released::text,
                                      E'\n' order by i.id)), '(leer)')
         from public.shop_inventory i),
      (select wert from soll where schluessel = 'lager_md5')),

  -- ------------------------------- Nichts ist freigegeben, und bleibt es
  (311, 'Nichts offen', 'freigegebene Lagerpositionen (0143 ruehrt das nicht an)',
      (select count(*)::text from public.shop_inventory i where i.sale_released), '0'),
  (312, 'Nichts offen', 'Zubehoerzeilen im oeffentlichen Angebot',
      (select count(*)::text from public.shop_offers() o
         join public.skylanders s on s.sky_id = o.sky_id
        where s.item_type <> 'figure'), '0'),

  -- ------------------------------- Was der Postflight hinterher vergleicht
  (321, 'Vorher', 'Info: Einkaeufe insgesamt (0143 legt keinen an)',
      (select count(*)::text from public.purchases), null),
  (322, 'Vorher', 'Info: Einkaufspositionen insgesamt',
      (select count(*)::text from public.purchase_items), null),
  (323, 'Vorher', 'Info: gespeicherte Kalkulationen, davon verknuepft',
      (select count(*)::text || ' / '
              || count(*) filter (where purchase_id is not null)::text
         from public.purchase_calculations), null),
  (324, 'Vorher', 'Info: Lagerbewegungen (eine Uebernahme bucht nichts ein)',
      (select count(*)::text from public.inventory_movements), null),

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

  -- ------------------------------------------------------- Der Z0-Vertrag
  (901, 'Z0-Vertrag', 'gewaehlter Modus (Messung ohne Sollwert)',
      (select coalesce(v.modus, 'FEHLT') from vertrag v), null),
  (902, 'Z0-Vertrag', 'der Modus ist gewaehlt — staging, production oder ausdruecklich keine',
      (select case when v.modus in ('staging', 'production', 'keine') then 'ja'
                   else 'nein: set_config(''skyisles.z0'', ''production'', true) fehlt'
              end from vertrag v), 'ja')
),
ergebnis as (
  select nr, bereich, pruefung, befund, erwartet,
         case when erwartet is null then null
              else befund is not distinct from erwartet end as ok
    from pruef
)
select nr, bereich, pruefung, befund, erwartet, ok from ergebnis
union all
select 9999, 'GESAMT', 'blockierende Abweichungen (muss 0 sein)',
       (select count(*) from ergebnis where ok is false)::text, '0',
       (select count(*) from ergebnis where ok is false) = 0
 order by nr;
