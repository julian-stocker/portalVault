-- ===========================================================================
-- 0139 PREFLIGHT — der Eingangszustand, rein lesend
--
-- Vor `0139_accessory_sale_release.sql` im SQL-Editor fahren. Zeile 9999 muss
-- 0 zeigen, sonst wird die Migration nicht gestartet.
--
-- WAS DIESE DATEI FESTHAELT
--
--   1. die sechs vorausgesetzten Funktionen und `item_type` stehen;
--   2. die zwei neuen Spalten stehen NOCH NICHT;
--   3. die Altlast, ausdruecklich gezaehlt: wie viele Zubehoerpositionen
--      heute `is_listed = true` tragen und bepreist sind. Das ist die Menge,
--      die bei einer unvorsichtigen Lockerung sofort im Schaufenster
--      staende — hier wird sie benannt, bevor etwas passiert;
--   4. die Abdruecke, gegen die der Postflight prueft.
--
--   begin;
--   select set_config('skyisles.z0', 'staging', true);   -- oder 'keine'
--   \i supabase/checks/0139_preflight.sql
--   rollback;
--
-- NUR LESEN. Ein einziges SELECT.
-- NICHT in `staging-suite.json`: die Datei ruft `is_shop_eligible()` und
-- `shop_offers()` und gehoert in den manuellen Lauf.
-- ===========================================================================

with vertrag as (
  select nullif(btrim(coalesce(current_setting('skyisles.z0', true), '')), '') as modus
),
z0 (schluessel, wert) as (values
  -- Z0-Vertrag, Stand 2026-10-20.
  ('angebote',      '256'),
  ('angebote_md5',  '4d1d6c30fe0ae886ca2689bcb1fe9634'),
  ('shopfaehig',    '534'),
  ('sammelbar',     '534'),
  ('lagerzeilen',   '285'),
  ('katalogzeilen', '626')
),
soll as (
  select z.schluessel,
         case when (select v.modus from vertrag v) = 'staging' then z.wert end as wert
    from z0 z
),
zubehoer as (
  select i.*, s.item_type, s.usk_rating
    from public.shop_inventory i
    join public.skylanders s on s.sky_id = i.sky_id
   where s.item_type <> 'figure'
),

pruef (nr, bereich, pruefung, befund, erwartet) as (values

  -- ------------------------------------------------ 1. Die Voraussetzungen
  (101, 'Grundlage', 'skylanders.item_type steht (0135)',
      (select (count(*) = 1)::text from information_schema.columns
        where table_schema = 'public' and table_name = 'skylanders'
          and column_name = 'item_type'), 'true'),
  (102, 'Grundlage', 'is_shop_eligible(text) steht',
      (to_regprocedure('public.is_shop_eligible(text)') is not null)::text, 'true'),
  (103, 'Grundlage', 'shop_offers() steht',
      (to_regprocedure('public.shop_offers()') is not null)::text, 'true'),
  (104, 'Grundlage', 'shop_quantity_available(text,text,integer) steht',
      (to_regprocedure('public.shop_quantity_available(text, text, integer)')
         is not null)::text, 'true'),
  (105, 'Grundlage', 'create_order mit SECHS Parametern steht (0040)',
      (to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text)')
         is not null)::text, 'true'),
  (106, 'Grundlage', 'reserve_for_order(bigint) steht (0010)',
      (to_regprocedure('public.reserve_for_order(bigint)') is not null)::text, 'true'),
  (107, 'Grundlage', 'admin_shop_listing_audit() steht (0041)',
      (to_regprocedure('public.admin_shop_listing_audit()') is not null)::text, 'true'),
  (108, 'Grundlage', 'can_operate_active_seller() steht',
      (to_regprocedure('public.can_operate_active_seller()') is not null)::text, 'true'),
  (109, 'Grundlage', 'is_platform_admin() steht',
      (to_regprocedure('public.is_platform_admin()') is not null)::text, 'true'),
  (110, 'Grundlage', 'is_shop_eligible verlangt noch item_type = figure (0135)',
      (select (position('s.item_type = ''figure''' in p.prosrc) > 0)::text from pg_proc p
        where p.oid = to_regprocedure('public.is_shop_eligible(text)')), 'true'),

  -- --------------------------------------- 2. Die neuen Spalten fehlen noch
  (201, 'Neu', 'shop_inventory.sale_released fehlt noch',
      (select (count(*) = 0)::text from information_schema.columns
        where table_schema = 'public' and table_name = 'shop_inventory'
          and column_name = 'sale_released'), 'true'),
  (202, 'Neu', 'skylanders.usk_rating fehlt noch',
      (select (count(*) = 0)::text from information_schema.columns
        where table_schema = 'public' and table_name = 'skylanders'
          and column_name = 'usk_rating'), 'true'),
  (203, 'Neu', 'is_position_sellable fehlt noch',
      (to_regprocedure('public.is_position_sellable(bigint)') is null)::text, 'true'),

  -- --------------------------------------------------- 3. DIE ALTLAST
  (301, 'Altlast', 'Zubehoer-Lagerpositionen insgesamt',
      (select count(*)::text from zubehoer), null),
  (302, 'Altlast', 'davon is_listed = true — DIE MENGE, UM DIE ES GEHT',
      (select count(*)::text from zubehoer where is_listed), null),
  (303, 'Altlast', 'davon mit eigenem Verkaufspreis (der CHECK aus 0003 erzwingt ihn)',
      (select count(*)::text from zubehoer where is_listed and sale_price is not null), null),
  (304, 'Altlast', 'die betroffenen SKY-IDs',
      coalesce((select string_agg(sky_id || ' (' || item_type || ', ' || sale_price::text || ')',
                                  '  |  ' order by sky_id)
                  from zubehoer where is_listed), '(keine)'), null),
  (305, 'Altlast', 'Zubehoerzeilen im oeffentlichen Angebot — HEUTE',
      (select count(*)::text from public.shop_offers() o
         join public.skylanders s on s.sky_id = o.sky_id
        where s.item_type <> 'figure'), '0'),
  (306, 'Altlast', 'Spiele mit erfasster USK-Kennzeichnung (die Spalte gibt es noch nicht)',
      '0 (Spalte fehlt)', null),

  -- ---------------------------------------------------- 4. Die Abdruecke
  (401, 'Abdruck', 'oeffentliche Angebote',
      (select count(*)::text from public.shop_offers()),
      (select wert from soll where schluessel = 'angebote')),
  (402, 'Abdruck', 'Abdruck ueber die Angebotsliste',
      (select coalesce(md5(string_agg(o.sky_id || '|' || o.condition || '|' ||
                                      o.price::text || '|' || o.available::text,
                                      E'\n' order by o.sky_id, o.condition)), '(leer)')
         from public.shop_offers() o),
      (select wert from soll where schluessel = 'angebote_md5')),
  (403, 'Abdruck', 'shopfaehige Katalogzeilen',
      (select count(*)::text from public.skylanders s
        where public.is_shop_eligible(s.sky_id)),
      (select wert from soll where schluessel = 'shopfaehig')),
  (404, 'Abdruck', 'verkaufbare Lagerpositionen (am alten Tor gemessen)',
      (select count(*)::text from public.shop_inventory i
        where public.is_shop_eligible(i.sky_id)), null),
  (405, 'Abdruck', 'sammelbare Katalogzeilen',
      (select count(*)::text from public.skylanders s
         join public.categories c on c.id = s.category_id
        where s.is_active and not (c.name = any (public.non_collectible_categories()))),
      (select wert from soll where schluessel = 'sammelbar')),
  (406, 'Abdruck', 'Lagerzeilen',
      (select count(*)::text from public.shop_inventory),
      (select wert from soll where schluessel = 'lagerzeilen')),
  (407, 'Abdruck', 'Katalogzeilen',
      (select count(*)::text from public.skylanders),
      (select wert from soll where schluessel = 'katalogzeilen')),
  (408, 'Abdruck', 'Abdruck ueber Listung und Preis jeder Lagerzeile',
      (select coalesce(md5(string_agg(i.id::text || '|' || i.is_listed::text || '|'
                                      || coalesce(i.sale_price::text, '-'),
                                      E'\n' order by i.id)), '(leer)')
         from public.shop_inventory i), null),

  -- -------------------------------------------------- 5. Die Belegsperre
  (501, 'Belege', 'die Belegsperre haelt fuer anon und authenticated',
      (select count(*)::text from information_schema.role_table_grants g
        where g.table_schema = 'public'
          and g.table_name in ('platform_receipts', 'platform_receipt_sequence')
          and g.grantee in ('anon', 'authenticated')), '0'),

  -- ------------------------------------------------------ Der Z0-Vertrag
  (901, 'Z0-Vertrag', 'gewaehlter Modus (Messung ohne Sollwert)',
      (select coalesce(v.modus, 'FEHLT') from vertrag v), null),
  (902, 'Z0-Vertrag', 'der Modus ist gewaehlt — staging oder ausdruecklich keine',
      (select case when v.modus in ('staging', 'keine') then 'ja'
                   else 'nein: set_config(''skyisles.z0'', ''staging'', true) fehlt'
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
