-- ===========================================================================
-- 0141 POSTFLIGHT — der Zustand danach, rein lesend
--
-- `0141` legt `seller_sale_state()` an und sonst nichts. „Sonst nichts" ist
-- hier eine PRUEFUNG und keine Zusage: die Zeilen 113 bis 115 halten die
-- Abdruecke der drei Nachbarfunktionen gegen ihre Staende von vorher —
-- `admin_shop_inventory` (0041), `admin_shop_listing_audit` (0139) und die
-- Betriebssicherung (0140). Aendert sich einer, war die Migration nicht
-- additiv.
--
-- NUR LESEN. Ein einziges SELECT. Zeile 9999 muss 0 zeigen.
-- ===========================================================================

with fn as (
  select p.oid, p.prosrc, p.prosecdef, p.proconfig, p.pronargs, p.proacl,
         p.proargnames, p.proallargtypes
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'seller_sale_state'
),
rumpf (name, md5) as (
  select p.proname, md5(p.prosrc)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('seller_business_backup', 'admin_shop_inventory',
                       'admin_shop_listing_audit')
),
sammelbar as (
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
   * ZWEI UMGEBUNGEN, ZWEI SPALTEN — wie in den Pruefdateien zu `0139` und
   * `0140`. Rechts der gemessene Production-Stand nach `0140` (2026-10-21,
   * vom Betreiber im Postflight bestaetigt).
   *
   * `lager_md5` hat KEINEN Staging-Wert: dieser Abdruck (Listung, Preis und
   * Freigabe je Lagerzeile) ist erst mit den `0140`-Pruefdateien entstanden
   * und auf Staging nie erhoben worden. `null` heisst hier „fuer diese
   * Umgebung nicht festgehalten" — die Zeile wird dann gemessen und nicht
   * bewertet. Eine erfundene Zahl waere schlimmer als keine.
   */
  ('angebote',      '256', '287'),
  ('angebote_md5',  '4d1d6c30fe0ae886ca2689bcb1fe9634',
                    '9b8341058bbfa0f7809eddc300ab0e9e'),
  ('shopfaehig',    '534', '531'),
  ('sammelbar',     '534', '531'),
  ('lagerzeilen',   '285', '306'),
  ('katalogzeilen', '626', '624'),
  ('lager_md5',     null,  '01e50b9d727a0486ff1ea0eb6ba2dd56')
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
  (2, 'Umgebung', 'Info: Abdruecke der drei Nachbarfunktionen',
      coalesce((select string_agg(name || '=' || left(md5, 8), ', ' order by name)
                  from rumpf), '(keine)'), null),

  -- ------------------------------------------- Die Grundlage aus 0139-0140
  (101, 'Grundlage', 'shop_inventory.sale_released steht (0139)',
      (select (count(*) = 1)::text from information_schema.columns
        where table_schema = 'public' and table_name = 'shop_inventory'
          and column_name = 'sale_released'), 'true'),
  (102, 'Grundlage', 'shop_inventory.delivery_scope steht (0139)',
      (select (count(*) = 1)::text from information_schema.columns
        where table_schema = 'public' and table_name = 'shop_inventory'
          and column_name = 'delivery_scope'), 'true'),
  (103, 'Grundlage', 'skylanders.usk_rating steht (0139)',
      (select (count(*) = 1)::text from information_schema.columns
        where table_schema = 'public' and table_name = 'skylanders'
          and column_name = 'usk_rating'), 'true'),
  (104, 'Grundlage', 'is_position_sellable(bigint) steht (0139)',
      (to_regprocedure('public.is_position_sellable(bigint)') is not null)::text, 'true'),
  (105, 'Grundlage', 'admin_shop_listing_audit() steht (0008/0041/0139)',
      (to_regprocedure('public.admin_shop_listing_audit()') is not null)::text, 'true'),
  (106, 'Grundlage', 'can_operate_active_seller() steht (0041)',
      (to_regprocedure('public.can_operate_active_seller()') is not null)::text, 'true'),
  (107, 'Grundlage', 'die Betriebssicherung steht auf Stand 0140',
      coalesce((select md5 from rumpf where name = 'seller_business_backup'),
               '(keine Funktion)'), 'a32b148cebe00ee0d0d469f96fd2028e'),

  -- -------------------------------------------- Die neue Funktion, Stueck fuer Stueck
  (110, 'Neu', 'seller_sale_state() steht, genau einmal',
      (select count(*)::text from fn), '1'),
  (111, 'Neu', 'md5 des gespeicherten Rumpfs',
      coalesce((select md5(f.prosrc) from fn f), '(keine Funktion)'),
      '7befc95e690d91b239e4368b41644871'),
  (112, 'Neu', 'md5 des Funktionskommentars',
      coalesce((select md5(obj_description(f.oid, 'pg_proc')) from fn f),
               '(kein Kommentar)'), 'e979fee9e458bedc3b52609e936e7922'),
  (113, 'Neu', 'acht Ausgabespalten, in dieser Folge',
      coalesce((select array_to_string(f.proargnames, ',') from fn f), '(keine)'),
      'sky_id,condition,item_type,sale_released,delivery_scope,usk_rating,'
      'sellable,reason'),
  (114, 'Neu', 'und mit diesen Typen',
      coalesce((select array_to_string(array(
                 select t::regtype::text from unnest(f.proallargtypes) t), ',')
                 from fn f), '(keine)'),
      'text,text,text,boolean,text,smallint,boolean,text'),
  (115, 'Neu', 'keine Parameter',
      (select f.pronargs::text from fn f), '0'),
  (116, 'Neu', 'security definer',
      (select f.prosecdef::text from fn f), 'true'),
  (117, 'Neu', 'es gibt eine search_path-Festlegung, und sie ist leer',
      (select coalesce(
                (select nullif(btrim(substring(c from 'search_path=(.*)$'), '"'), '')
                   from unnest(coalesce(f.proconfig, '{}'::text[])) c
                  where c like 'search\_path=%'),
                '(leer)')::text from fn f), '(leer)'),
  (118, 'Neu', 'der Rumpf fragt die Betriebsrolle',
      (select (position('can_operate_active_seller' in f.prosrc) > 0)::text from fn f),
      'true'),
  (119, 'Neu', 'der Grund wird GEJOINT, nicht nachgerechnet',
      (select (position('admin_shop_listing_audit()' in f.prosrc) > 0)::text from fn f),
      'true'),
  (120, 'Neu', 'der Rumpf schreibt nichts',
      (select count(*)::text from fn f
        where f.prosrc ~* '\minsert\s+into\m' or f.prosrc ~* '\mupdate\s+public\.'
           or f.prosrc ~* '\mdelete\s+from\m' or f.prosrc ~* '\mtruncate\m'
           or f.prosrc ~* '\mnextval\m'), '0'),

  -- -------------------------------------------------------------- Die Rechte
  (121, 'Rechte', 'materialisierter ACL (NULL waere PUBLIC)',
      (select (f.proacl is not null)::text from fn f), 'true'),
  (122, 'Rechte', 'kein EXECUTE fuer PUBLIC oder anon',
      (select count(*)::text from fn f, aclexplode(f.proacl) a
        where a.privilege_type = 'EXECUTE'
          and (a.grantee = 0 or a.grantee::regrole::text = 'anon')), '0'),
  (123, 'Rechte', 'authenticated darf ausfuehren',
      has_function_privilege('authenticated', 'public.seller_sale_state()',
                             'execute')::text, 'true'),

  -- ------------------------------- Und die drei Nachbarn sind UNVERAENDERT
  (131, 'Additiv', 'admin_shop_inventory unveraendert (Stand 0041)',
      coalesce((select md5 from rumpf where name = 'admin_shop_inventory'),
               '(keine Funktion)'), '857b767d4ad5ea9bfc2e333fd6605b1f'),
  (132, 'Additiv', 'admin_shop_listing_audit unveraendert (Stand 0139)',
      coalesce((select md5 from rumpf where name = 'admin_shop_listing_audit'),
               '(keine Funktion)'), 'f36137c40155375b92bae76b5dd63740'),
  (133, 'Additiv', 'die Betriebssicherung unveraendert (Stand 0140)',
      coalesce((select md5 from rumpf where name = 'seller_business_backup'),
               '(keine Funktion)'), 'a32b148cebe00ee0d0d469f96fd2028e'),

  -- ------------------------------------ Nichts ist freigegeben (0139 gilt)
  (201, 'Nichts offen', 'freigegebene Lagerpositionen',
      (select count(*)::text from public.shop_inventory i where i.sale_released), '0'),
  (202, 'Nichts offen', 'Zeilen mit erfasster USK-Kennzeichnung',
      (select count(*)::text from public.skylanders s
        where s.usk_rating is not null), '0'),
  (203, 'Nichts offen', 'Positionen mit erfasstem Lieferumfang',
      (select count(*)::text from public.shop_inventory i
        where i.delivery_scope is not null), '0'),
  (204, 'Nichts offen', 'Zubehoerzeilen im oeffentlichen Angebot',
      (select count(*)::text from public.shop_offers() o
         join public.skylanders s on s.sky_id = o.sky_id
        where s.item_type <> 'figure'), '0'),
  (205, 'Nichts offen', 'Positionen, die das Tor durchliesse, obwohl der Artikel '
        'kein figure ist',
      (select count(*)::text from public.shop_inventory i
         join public.skylanders s on s.sky_id = i.sky_id
        where s.item_type <> 'figure' and public.is_position_sellable(i.id)), '0'),

  -- --------------------------- Und die Zahlen, die Nutzer kennen (Z0-Vertrag)
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
