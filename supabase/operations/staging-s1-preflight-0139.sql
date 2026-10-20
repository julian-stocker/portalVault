-- ===========================================================================
-- STAGING — S1: der Eingangszustand vor 0139, rein lesend
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
--   * Bin ich auf Staging? (Zeile 1 — der Stempel `SKY-0821`/`SKY-0822`)
--   * Stehen die acht Funktionen und `item_type`, die `0139` voraussetzt?
--   * Fehlen die drei Spalten, die `0139` erst anlegt?
--   * DIE ALTLAST: wie viele Zubehoerpositionen sind gelistet, wie viele
--     haetten einen wirksamen Preis — und waeren damit bei einer Lockerung
--     ohne Freigabespalte sofort im Schaufenster?
--   * Die Z0-Abdruecke: 256 Angebote, Abdruck `4d1d6c30…`, 534 shopfaehig,
--     534 sammelbar, 285 Lagerzeilen, 626 Katalogzeilen.
--   * Haelt die Belegsperre?
--
-- ERGEBNIS LESEN: die Tabelle hat eine Zeile `9999`. Steht dort `0`, ist
-- alles wie erwartet. Steht dort etwas anderes, zeigen die Zeilen mit
-- `ok = false`, welche Erwartung nicht stimmt.
--
-- EINGEBETTET: `supabase/checks/0139_preflight.sql`, Zeichen fuer Zeichen.
-- ===========================================================================

begin;

-- Der Z0-Vertrag. OHNE IHN sind die Bezugszahlen nur Messungen, und Zeile
-- 902 meldet das als Abweichung — genau das ist am 2026-10-20 passiert.
-- Er gilt transaktionslokal (`true`) und ist mit dem `rollback` unten fort.
select set_config('skyisles.z0', 'staging', true);

-- >>> EINGEBETTET: supabase/checks/0139_preflight.sql
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
/*
 * KEINE SPALTE, DIE ES VOR `0139` NICHT GIBT.
 *
 * Diese Datei lief am 2026-10-20 auf Staging in einen Fehler:
 * `column s.usk_rating does not exist`. Sie stand hier in der Auswahl —
 * eine Spalte, die `0139` erst ANLEGT. Ein Preflight, der den Zustand NACH
 * der Migration voraussetzt, kann den Zustand davor nicht messen.
 *
 * Gelesen werden deshalb nur Spalten, die es seit `0003` beziehungsweise
 * `0135` gibt: `item_type` und der Marktpreis.
 */
zubehoer as (
  select i.*, s.item_type, s.market_price
    from public.shop_inventory i
    join public.skylanders s on s.sky_id = i.sky_id
   where s.item_type <> 'figure'
),

pruef (nr, bereich, pruefung, befund, erwartet) as (values

  -- ------------------------------------------------ 0. Bin ich auf Staging?
  --
  -- Derselbe Stempel, den `staging-0139.sql` vor dem Schreiben prueft:
  -- `SKY-0821` und `SKY-0822` gibt es auf Staging und auf Production
  -- bewusst NICHT. Hier steht er als MESSUNG, damit vor S2 sichtbar ist,
  -- dass der Riegel greifen wird — dort ist er dann blockierend.
  (1, 'Umgebung', 'Staging-Stempel: SKY-0821 UND SKY-0822 vorhanden',
      (select (count(*) = 2)::text from public.skylanders
        where sky_id in ('SKY-0821', 'SKY-0822')), 'true'),
  (2, 'Umgebung', 'Info: Katalogzeilen',
      (select count(*)::text from public.skylanders), null),

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
  /*
   * WOHER DER PREIS KAEME. Nicht aus einem gesetzten `sale_price` — `0007`
   * hat den CHECK `shop_inventory_listed_needs_price` ABGESCHAFFT, weil
   * eine gelistete Position seitdem auch ohne Uebersteuerung einen Preis
   * haben kann: Marktpreis mal Prozentsatz. Die Regel lebt seither in
   * `set_shop_listing()` und `shop_offers()`.
   *
   * Gemessen auf Staging am 2026-10-20: 13 gelistet, davon 0 mit eigenem
   * Preis, 11 mit einem Preis AUS DEM MARKTPREIS — und genau die 11 waeren
   * bei einer Lockerung ohne Freigabespalte sofort im Schaufenster.
   */
  (303, 'Altlast', 'davon mit eigenem Verkaufspreis (sale_price)',
      (select count(*)::text from zubehoer where is_listed and sale_price is not null), null),
  (304, 'Altlast', 'davon mit WIRKSAMEM Preis — die Menge, die sofort Angebot waere',
      (select count(*)::text from zubehoer z
        cross join public.shop_settings st
        where z.is_listed
          and public.shop_price(z.sale_price, z.market_price, st.price_percentage)
              is not null), null),
  (305, 'Altlast', 'die betroffenen SKY-IDs',
      coalesce((select string_agg(sky_id || ' (' || item_type || ')', '  |  ' order by sky_id)
                  from zubehoer where is_listed), '(keine)'), null),
  (306, 'Altlast', 'Zubehoerzeilen im oeffentlichen Angebot — HEUTE',
      (select count(*)::text from public.shop_offers() o
         join public.skylanders s on s.sky_id = o.sky_id
        where s.item_type <> 'figure'), '0'),
  (307, 'Altlast', 'Zubehoerartikel mit Marktpreis — die Quelle des Preises',
      (select count(*)::text from public.skylanders
        where item_type <> 'figure' and market_price is not null), null),

  -- ---------------------------------------------------- 4. Die Abdruecke
  (401, 'Abdruck', 'oeffentliche Angebote',
      (select count(*)::text from public.shop_offers()),
      (select wert from soll where schluessel = 'angebote')),
  /*
   * DIE Z0-FORMEL, ZEICHEN FUER ZEICHEN AUS `0135_preflight.sql` (Zeile 913).
   *
   * Eine frueher hier stehende, selbst erfundene Fassung nahm vier Felder
   * mit `E'\n'` als Trenner und lieferte auf Staging
   * `faabf8ef0d124c3dc75ed08b4eb4f398` — verglichen mit einer Konstante,
   * die aus einer ANDEREN Formel stammt. Das sah nach einer
   * Datenaenderung aus und war keine.
   *
   * Drei Felder, Trenner `;`, OHNE `available`: und das ist kein Zufall.
   * Ein Abdruck, der die Verfuegbarkeit mitnimmt, aendert sich bei jedem
   * Verkauf — ein Vertrag, der bei normalem Betrieb Alarm schlaegt, ist
   * kein Vertrag.
   */
  (402, 'Abdruck', 'Abdruck ueber die Angebotsliste (sky_id|condition|price)',
      (select md5(coalesce(string_agg(o.sky_id || '|' || o.condition || '|'
                                      || coalesce(o.price::text, ''),
                                      ';' order by o.sky_id, o.condition), ''))
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
-- <<< ENDE: supabase/checks/0139_preflight.sql

rollback;
