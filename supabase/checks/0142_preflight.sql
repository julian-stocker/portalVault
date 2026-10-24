-- ===========================================================================
-- 0142 PREFLIGHT — der Zustand VOR der Migration, rein lesend
--
-- `0142` legt EINE neue Tabelle an: `purchase_calculations`, mit RLS, vier
-- Richtlinien, zwei Indizes und dem `updated_at`-Trigger aus `0001`. Rein
-- additiv — keine bestehende Tabelle, keine bestehende Spalte, kein
-- bestehender Funktionsrumpf, kein bestehendes Recht.
--
-- Diese Datei haelt vier Dinge fest: dass die Voraussetzungen stehen, dass
-- die Tabelle NOCH NICHT da ist, dass unter ihrem Namen auch kein Rest
-- herumliegt, und mit welchen Zahlen der Betrieb in den Lauf geht.
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
   * ZWEI UMGEBUNGEN, ZWEI SPALTEN — dieselbe Form wie in den Pruefdateien zu
   * `0139`-`0141`.
   *
   * Die STAGING-Spalte ist durchgehend `null`, und das ist eine Aussage und
   * kein Versehen: `0142` liegt auf Staging seit dem 2026-10-22, ein
   * Preflight dort kaeme zu spaet, und die Zahlen sind fuer diese Datei nie
   * erhoben worden. `null` heisst „fuer diese Umgebung nicht festgehalten" —
   * die Zeile wird dann gemessen und nicht bewertet. Eine erfundene Zahl
   * waere schlimmer als keine.
   *
   * Die PRODUCTION-Spalte ist der Stand nach `0141`, gemessen am 2026-10-21
   * und vom Betreiber im Postflight zu `0141` bestaetigt. Seit diesem Tag
   * ist auf Production keine Migration gelaufen; weicht hier etwas ab, hat
   * sich der BETRIEB bewegt (ein Preis, eine Listung, ein Verkauf) und nicht
   * das Schema. Dann gilt: neuen Wert notieren, Preflight gegen Postflight
   * vergleichen statt gegen diese Konstante.
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

  -- ---------------------------------------------------- Was 0142 voraussetzt
  (101, 'Grundlage', 'auth.users steht (Supabase Auth)',
      (to_regclass('auth.users') is not null)::text, 'true'),
  (102, 'Grundlage', 'public.purchases steht (0053) — der Fremdschluessel braucht sie',
      (to_regclass('public.purchases') is not null)::text, 'true'),
  (103, 'Grundlage', 'set_updated_at() steht (0001) — der Trigger haengt daran',
      (to_regprocedure('public.set_updated_at()') is not null)::text, 'true'),
  (104, 'Grundlage', 'gen_random_uuid() steht — die Vorgabe des Schluessels',
      (to_regprocedure('pg_catalog.gen_random_uuid()') is not null
       or to_regprocedure('public.gen_random_uuid()') is not null)::text, 'true'),
  (105, 'Grundlage', 'non_collectible_categories() steht (0135/0137) — fuer Zeile 304',
      (to_regprocedure('public.non_collectible_categories()') is not null)::text, 'true'),

  -- ------------------------------------------- Und 0142 ist noch nicht da
  (110, 'Neu', 'purchase_calculations fehlt NOCH — sonst bricht 0142 ab',
      (to_regclass('public.purchase_calculations') is null)::text, 'true'),
  /*
   * KEIN REST UNTER DIESEM NAMEN.
   *
   * `0142` legt Index, Trigger und Richtlinien unter festen Namen an. Lag
   * dort noch ein Rest aus einem abgebrochenen Versuch, scheiterte die
   * Migration mitten im Lauf — sie laeuft in EINER Transaktion, also bleibt
   * nichts zurueck, aber der Lauf waere umsonst. Billiger, vorher zu fragen.
   */
  (111, 'Neu', 'kein Index dieses Namens liegt herum',
      (select count(*)::text from pg_indexes
        where schemaname = 'public'
          and indexname in ('purchase_calculations_user_updated_idx',
                            'purchase_calculations_purchase_uniq')), '0'),
  (112, 'Neu', 'und keine Richtlinie dieses Namens',
      (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'purchase_calculations'), '0'),

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
  (311, 'Nichts offen', 'freigegebene Lagerpositionen (0142 ruehrt das nicht an)',
      (select count(*)::text from public.shop_inventory i where i.sale_released), '0'),
  (312, 'Nichts offen', 'Zubehoerzeilen im oeffentlichen Angebot',
      (select count(*)::text from public.shop_offers() o
         join public.skylanders s on s.sky_id = o.sky_id
        where s.item_type <> 'figure'), '0'),

  -- -------------------- Die Nachbartabelle, die der Postflight mitzaehlt
  /*
   * WARUM `collection_items` HIER STEHT. Der Postflight zu `0142` fragt in
   * Zeile 502, ob die VIER eigenen Richtlinien dieser Tabelle noch stehen —
   * die Probe darauf, dass eine neue Tabelle mit demselben Muster der alten
   * nichts weggenommen hat. Damit „noch" eine Bedeutung hat, muss das
   * Vorher dastehen.
   */
  (321, 'Nachbar', 'die vier eigenen Richtlinien von collection_items stehen, '
        'fuer authenticated',
      (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'collection_items'
          and policyname in ('collection_items_select_own', 'collection_items_insert_own',
                             'collection_items_update_own', 'collection_items_delete_own')
          and 'authenticated' = any (roles)), '4'),
  (322, 'Nachbar', 'Info: alle Richtlinien von collection_items, mit Befehl und Rollen',
      coalesce((select string_agg(policyname || ' (' || cmd || ', '
                                  || array_to_string(roles, '+') || ')', '; '
                                  order by policyname)
                  from pg_policies
                 where schemaname = 'public' and tablename = 'collection_items'),
               '(keine)'), null),
  (323, 'Nachbar', 'Info: Einkaeufe (0142 legt keinen an)',
      (select count(*)::text from public.purchases), null),

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
