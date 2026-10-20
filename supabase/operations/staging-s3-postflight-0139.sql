-- ===========================================================================
-- STAGING — S3: der Zustand nach 0139, rein lesend
--
-- RUECKFRAGENFREI AUSFUEHRBAR. Vollstaendig markieren, in den SQL-Editor des
-- Staging-Projekts qqxcpesbwfxzgytkdsac einfuegen, ausfuehren. Die Klammer,
-- der Z0-Vertrag und das `rollback` stehen schon darin — es ist nichts
-- zusammenzusetzen.
--
-- RUECKGAENGIG MACHT SIE NICHTS, WEIL SIE NICHTS TUT. Ein einziges SELECT,
-- geklammert in `begin … rollback`. Kein `insert`, kein `update`, kein DDL,
-- keine Rechteaenderung. Die Rolle des SQL-Editors darf schreiben; diese
-- Datei nutzt das nicht.
--
-- WAS SIE BEANTWORTET
--
--   * Stehen die drei Spalten und die vier Funktionen, die `0139` anlegt?
--   * IST NICHTS KAUFBAR GEWORDEN? 0 freigegebene Positionen, 0 USK-Angaben,
--     0 Lieferumfaenge, 0 Zubehoerangebote.
--   * Antwortet jede Lagerposition am NEUEN Tor genau wie am alten?
--   * Sind Angebote, Abdruck, Sammlung, Lager und Katalog unveraendert?
--   * Haelt die Belegsperre?
--
-- ERGEBNIS LESEN: die Tabelle hat eine Zeile `9999`. Steht dort `0`, ist
-- alles wie erwartet. Steht dort etwas anderes, zeigen die Zeilen mit
-- `ok = false`, welche Erwartung nicht stimmt.
--
-- EINGEBETTET: `supabase/checks/0139_postflight.sql`, Zeichen fuer Zeichen.
-- ===========================================================================

begin;

-- Der Z0-Vertrag. OHNE IHN sind die Bezugszahlen nur Messungen, und Zeile
-- 902 meldet das als Abweichung — genau das ist am 2026-10-20 passiert.
-- Er gilt transaktionslokal (`true`) und ist mit dem `rollback` unten fort.
select set_config('skyisles.z0', 'staging', true);

-- >>> EINGEBETTET: supabase/checks/0139_postflight.sql
-- ===========================================================================
-- 0139 POSTFLIGHT — der Zustand danach, rein lesend
--
-- Nach `0139_accessory_sale_release.sql` im SQL-Editor fahren. Zeile 9999
-- muss 0 zeigen.
--
-- DIE EINE AUSSAGE, DIE ZAEHLT: es ist nichts kaufbar geworden. Die Migration
-- baut ein Tor, sie oeffnet es nicht. Alles andere hier stuetzt diese Aussage.
--
--   begin;
--   select set_config('skyisles.z0', 'staging', true);   -- oder 'keine'
--   \i supabase/checks/0139_postflight.sql
--   rollback;
--
-- NUR LESEN. NICHT in `staging-suite.json` — manueller Lauf.
-- ===========================================================================

with vertrag as (
  select nullif(btrim(coalesce(current_setting('skyisles.z0', true), '')), '') as modus
),
z0 (schluessel, wert) as (values
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

  -- -------------------------------------------- 1. Die neuen Bauteile stehen
  (101, 'Neu', 'shop_inventory.sale_released steht, not null, Vorgabe false',
      (select (count(*) = 1)::text from information_schema.columns
        where table_schema = 'public' and table_name = 'shop_inventory'
          and column_name = 'sale_released' and is_nullable = 'NO'
          and column_default like '%false%'), 'true'),
  (102, 'Neu', 'skylanders.usk_rating steht und ist nullable',
      (select (count(*) = 1)::text from information_schema.columns
        where table_schema = 'public' and table_name = 'skylanders'
          and column_name = 'usk_rating' and is_nullable = 'YES'), 'true'),
  (103, 'Neu', 'der CHECK auf usk_rating steht',
      (select (count(*) = 1)::text from pg_constraint
        where conname = 'skylanders_usk_rating_known'), 'true'),
  (104, 'Neu', 'is_position_sellable(bigint) steht',
      (to_regprocedure('public.is_position_sellable(bigint)') is not null)::text, 'true'),
  (105, 'Neu', 'seller_set_sale_release(text,text,boolean) steht',
      (to_regprocedure('public.seller_set_sale_release(text, text, boolean)')
         is not null)::text, 'true'),
  (106, 'Neu', 'admin_set_usk_rating(text,smallint) steht',
      (to_regprocedure('public.admin_set_usk_rating(text, smallint)') is not null)::text,
      'true'),

  -- ------------------------------- 2. ES IST NICHTS KAUFBAR GEWORDEN
  (201, 'Nichts offen', 'freigegebene Lagerpositionen',
      (select count(*)::text from public.shop_inventory where sale_released), '0'),
  (202, 'Nichts offen', 'Zeilen mit erfasster USK-Kennzeichnung',
      (select count(*)::text from public.skylanders where usk_rating is not null), '0'),
  (203, 'Nichts offen', 'Zubehoerzeilen im oeffentlichen Angebot',
      (select count(*)::text from public.shop_offers() o
         join public.skylanders s on s.sky_id = o.sky_id
        where s.item_type <> 'figure'), '0'),
  (204, 'Nichts offen', 'Zubehoerpositionen, die das neue Tor durchliesse',
      (select count(*)::text from zubehoer z
        where public.is_position_sellable(z.id)), '0'),
  (205, 'Nichts offen', 'die Altlast ist unveraendert gelistet (und unverkaeuflich)',
      (select count(*)::text from zubehoer where is_listed), null),

  -- ------------------------------ 3. Fuer Figuren hat sich nichts geaendert
  (301, 'Figuren', 'oeffentliche Angebote',
      (select count(*)::text from public.shop_offers()),
      (select wert from soll where schluessel = 'angebote')),
  /* Die Z0-Formel aus `0135_preflight.sql`, Zeile 913: drei Felder, Trenner
     `;`, OHNE `available`. Ein Abdruck, der die Verfuegbarkeit mitnaehme,
     aenderte sich bei jedem Verkauf. */
  (302, 'Figuren', 'Abdruck ueber die Angebotsliste — Zeichen fuer Zeichen',
      (select md5(coalesce(string_agg(o.sky_id || '|' || o.condition || '|'
                                      || coalesce(o.price::text, ''),
                                      ';' order by o.sky_id, o.condition), ''))
         from public.shop_offers() o),
      (select wert from soll where schluessel = 'angebote_md5')),
  (303, 'Figuren', 'shopfaehige Katalogzeilen — is_shop_eligible ist unberuehrt',
      (select count(*)::text from public.skylanders s
        where public.is_shop_eligible(s.sky_id)),
      (select wert from soll where schluessel = 'shopfaehig')),
  (304, 'Figuren', 'Positionen, die am NEUEN Tor anders antworten als am alten',
      (select count(*)::text from public.shop_inventory i
        where public.is_position_sellable(i.id)
              is distinct from public.is_shop_eligible(i.sky_id)), '0'),

  -- ---------------------- 4. Die vier Tueren fragen das neue Tor, und nur es
  (401, 'Tueren', 'Tueren, die is_position_sellable fragen (muss 4 sein)',
      (select count(*)::text from pg_proc p
        where p.oid in (to_regprocedure('public.shop_offers()'),
                        to_regprocedure('public.shop_quantity_available(text, text, integer)'),
                        to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text)'),
                        to_regprocedure('public.reserve_for_order(bigint)'))
          and position('is_position_sellable' in p.prosrc) > 0), '4'),
  (402, 'Tueren', 'Tueren, die is_shop_eligible noch direkt fragen (muss 0 sein)',
      (select count(*)::text from pg_proc p
        where p.oid in (to_regprocedure('public.shop_offers()'),
                        to_regprocedure('public.shop_quantity_available(text, text, integer)'),
                        to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text)'),
                        to_regprocedure('public.reserve_for_order(bigint)'))
          and position('is_shop_eligible' in p.prosrc) > 0), '0'),
  (403, 'Tueren', 'die Betriebsdiagnose kennt den Grund "not released for sale"',
      (select (position('not released for sale' in p.prosrc) > 0)::text from pg_proc p
        where p.oid = to_regprocedure('public.admin_shop_listing_audit()')), 'true'),
  (404, 'Tueren', 'und den Grund "usk rating missing"',
      (select (position('usk rating missing' in p.prosrc) > 0)::text from pg_proc p
        where p.oid = to_regprocedure('public.admin_shop_listing_audit()')), 'true'),

  -- --------------------------- 5. Sammlung, Katalog und Lager unberuehrt
  (501, 'Unberuehrt', 'sammelbare Katalogzeilen',
      (select count(*)::text from public.skylanders s
         join public.categories c on c.id = s.category_id
        where s.is_active and not (c.name = any (public.non_collectible_categories()))),
      (select wert from soll where schluessel = 'sammelbar')),
  (502, 'Unberuehrt', 'Lagerzeilen',
      (select count(*)::text from public.shop_inventory),
      (select wert from soll where schluessel = 'lagerzeilen')),
  (503, 'Unberuehrt', 'Katalogzeilen',
      (select count(*)::text from public.skylanders),
      (select wert from soll where schluessel = 'katalogzeilen')),
  (504, 'Unberuehrt', 'Abdruck ueber Listung und Preis jeder Lagerzeile',
      (select coalesce(md5(string_agg(i.id::text || '|' || i.is_listed::text || '|'
                                      || coalesce(i.sale_price::text, '-'),
                                      E'\n' order by i.id)), '(leer)')
         from public.shop_inventory i), null),
  (505, 'Unberuehrt', 'Sammlungseintraege auf Zubehoer',
      (select count(*)::text from public.collection_items ci
         join public.skylanders s on s.sky_id = ci.sky_id
        where s.item_type <> 'figure'), '0'),

  -- -------------------------------------------- 6. Rechte und Belegsperre
  (601, 'Rechte', 'is_position_sellable ist fuer anon und authenticated ausfuehrbar',
      (select count(*)::text from information_schema.role_routine_grants g
        where g.routine_schema = 'public' and g.routine_name = 'is_position_sellable'
          and g.grantee in ('anon', 'authenticated')), '2'),
  (602, 'Rechte', 'seller_set_sale_release ist fuer anon NICHT ausfuehrbar',
      (select count(*)::text from information_schema.role_routine_grants g
        where g.routine_schema = 'public' and g.routine_name = 'seller_set_sale_release'
          and g.grantee = 'anon'), '0'),
  (603, 'Rechte', 'admin_set_usk_rating ist fuer anon NICHT ausfuehrbar',
      (select count(*)::text from information_schema.role_routine_grants g
        where g.routine_schema = 'public' and g.routine_name = 'admin_set_usk_rating'
          and g.grantee = 'anon'), '0'),
  (604, 'Belege', 'die Belegsperre haelt unveraendert',
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
-- <<< ENDE: supabase/checks/0139_postflight.sql

rollback;
