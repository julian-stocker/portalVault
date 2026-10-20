-- ===========================================================================
-- WAS DIE LAGERUEBERSICHT KUENFTIG ZEIGT — rein lesend
--
-- ANLASS. Das Lager fuehrt seit dem ersten Tag Zeilen auf Spiele. Die
-- Uebersicht hat sie nicht gezeigt: `fetchInventory()` sortierte jede nicht
-- sammelbare Zeile in einen `outsideScope`-Topf, und an die Oberflaeche ging
-- davon nur die ANZAHL. Bestand, Bewegungen und Historie waren da und
-- richtig, nur unsichtbar.
--
-- WAS DIESE DATEI BEANTWORTET
--
--   1. WIE VIELE Lagerzeilen haengen an Spielen, Portalen und sonstigem
--      Zubehoer — und wie viele Stueck.
--   2. WERDEN SIE ALLE BENANNT? Die Anwendung holt die Namen mit
--      `fetchAccessoryCatalog()`, und dessen Regel ist genau zwei
--      Bedingungen: `is_active` und `sky_id < 'SKY-9000'`. Diese Datei faehrt
--      dieselbe Regel in SQL nach und zaehlt, was durchfaellt — eine Zeile,
--      die durchfaellt, bleibt in „ausserhalb des Sortiments".
--   3. BLEIBT DIE TRENNUNG? Keine Zubehoerzeile darf shopfaehig sein, in
--      `shop_offers()` stehen oder in den Figurenkennzahlen auftauchen.
--   4. Die Prueffigur `SKY-9998` bleibt, wo sie ist.
--
-- DER Z0-VERTRAG, wie in den anderen Fluegen: im Modus `staging` sind die
-- Bezugszahlen BLOCKIEREND (13 Lagerzeilen auf Spiele, Stand Z0 vom
-- 2026-10-19), sonst nur Messung. Weicht die Zahl ab, hat sich das Regal
-- seit Z0 bewegt — ein Verkauf, ein Einkauf —, und dann ist die Abweichung
-- ein Befund und keine Panne.
--
--   begin;
--   select set_config('skyisles.z0', 'staging', true);   -- oder 'keine'
--   \i supabase/checks/inventory_accessories_readonly.sql
--   rollback;
--
-- NUR LESEN. Ein einziges SELECT, keine Schreiboperation. Zeile 9999 muss 0
-- zeigen. NICHT in `staging-suite.json`: die Datei ruft `is_shop_eligible()`,
-- und sie gehoert zum manuellen Lauf im SQL-Editor.
-- ===========================================================================

with vertrag as (
  select nullif(btrim(coalesce(current_setting('skyisles.z0', true), '')), '') as modus
),
z0 (schluessel, wert) as (values
  -- Stand Z0, 2026-10-19 (`docs/SKYLANDERS_DATA.md`, Abschnitt 11k).
  ('spiel_lagerzeilen', '13')
),
soll as (
  select z.schluessel,
         case when (select v.modus from vertrag v) = 'staging' then z.wert end as wert
    from z0 z
),
/*
 * JEDE LAGERZEILE MIT DER ART IHRES ARTIKELS.
 *
 * `left join`, weil eine Lagerzeile auf einer SKY-ID stehen kann, die es im
 * Katalog nicht gibt — historische Auditdaten. `coalesce(..., 'figure')` ist
 * dieselbe Regel, die `inventoryKind()` in der Anwendung anwendet: ohne
 * Auskunft gilt der Normalfall, und der Normalfall ist die Figur.
 */
zeile as (
  select i.id,
         i.sky_id,
         i.condition,
         i.quantity,
         i.is_listed,
         s.sky_id is not null                      as im_katalog,
         coalesce(s.item_type, 'figure')           as art,
         coalesce(s.is_active, false)              as aktiv,
         i.sky_id < 'SKY-9000'                     as produktiver_bereich,
         c.name                                    as kategorie
    from public.shop_inventory i
    left join public.skylanders s on s.sky_id = i.sky_id
    left join public.categories c on c.id = s.category_id
),
zubehoer as (select * from zeile where art <> 'figure'),
/*
 * Die Regel von `fetchAccessoryCatalog()`, in SQL: aktiv UND unter
 * `SKY-9000`. Genau diese Zeilen bekommen kuenftig einen Namen in der
 * Uebersicht; die uebrigen bleiben in „ausserhalb des Sortiments".
 */
benannt as (select * from zubehoer where aktiv and produktiver_bereich),

pruef (nr, bereich, pruefung, befund, erwartet) as (values

  -- ----------------------------------------------------- Vorbedingungen
  (101, 'Grundlage', 'Spalte item_type steht (0135)',
      (select (count(*) = 1)::text from information_schema.columns
        where table_schema = 'public' and table_name = 'skylanders'
          and column_name = 'item_type'), 'true'),
  (102, 'Grundlage', 'is_shop_eligible prueft item_type = figure (0135)',
      (select (position('s.item_type = ''figure''' in p.prosrc) > 0)::text from pg_proc p
        where p.oid = to_regprocedure('public.is_shop_eligible(text)')), 'true'),

  -- ------------------------------------------ Was im Lager wirklich liegt
  (201, 'Bestand', 'Lagerzeilen insgesamt',
      (select count(*)::text from zeile), null),
  (202, 'Bestand', 'davon auf Zubehoer (Artikeltyp <> figure)',
      (select count(*)::text from zubehoer), null),
  (203, 'Bestand', 'je Art: Zeilen (Stueck)',
      coalesce((select string_agg(x.art || ' ' || x.n::text || ' (' || x.stueck::text || ')',
                                  '  |  ' order by x.art)
                  from (select art, count(*) as n, sum(quantity) as stueck
                          from zeile group by art) x), '(keine)'), null),
  (204, 'Bestand', 'Stueck auf Zubehoer',
      (select coalesce(sum(quantity), 0)::text from zubehoer), null),

  -- ---------------------------- Die 13 Spiele-Lagerzeilen, ausdruecklich
  (301, 'Spiele', 'Lagerzeilen auf Spielen',
      (select count(*)::text from zeile where art = 'game'),
      (select wert from soll where schluessel = 'spiel_lagerzeilen')),
  (302, 'Spiele', 'davon aktiv und im produktiven Bereich — werden BENANNT',
      (select count(*)::text from benannt where art = 'game'),
      (select wert from soll where schluessel = 'spiel_lagerzeilen')),
  (303, 'Spiele', 'Stueck auf Spielen',
      (select coalesce(sum(quantity), 0)::text from zeile where art = 'game'), null),
  (304, 'Spiele', 'die SKY-IDs, zum Nachsehen in der Oberflaeche',
      coalesce((select string_agg(sky_id, ', ' order by sky_id)
                  from zeile where art = 'game'), '(keine)'), null),
  (305, 'Spiele', 'alle stehen in einer Kategorie "Spiele"',
      (select count(*)::text from zeile
        where art = 'game' and coalesce(kategorie, '') <> 'Spiele'), '0'),

  -- --------------------- Faellt eine Zubehoerzeile durch die Namensregel?
  (401, 'Benennung', 'Zubehoerzeilen OHNE Katalogzeile (bleiben ausserhalb)',
      (select count(*)::text from zubehoer where not im_katalog), '0'),
  (402, 'Benennung', 'Zubehoerzeilen auf INAKTIVEN Artikeln (bleiben ausserhalb)',
      (select count(*)::text from zubehoer where im_katalog and not aktiv), null),
  (403, 'Benennung', 'Zubehoerzeilen im reservierten Bereich SKY-9000+ (bleiben ausserhalb)',
      (select count(*)::text from zubehoer where not produktiver_bereich), null),
  (404, 'Benennung', 'Zubehoerzeilen, die kuenftig BENANNT werden',
      (select count(*)::text from benannt), null),
  (405, 'Benennung', 'und die Summe stimmt: benannt + ausserhalb = alle',
      (select ((select count(*) from benannt)
             + (select count(*) from zubehoer where not (aktiv and produktiver_bereich)))::text),
      (select count(*)::text from zubehoer)),

  -- ------------------------------------------- Die Trennung bleibt stehen
  (501, 'Trennung', 'keine Zubehoerzeile ist shopfaehig',
      (select count(*)::text from zubehoer z
        where public.is_shop_eligible(z.sky_id)), '0'),
  (502, 'Trennung', 'keine Zubehoerzeile steht im oeffentlichen Angebot',
      (select count(*)::text from public.shop_offers() o
         join zubehoer z on z.sky_id = o.sky_id), '0'),
  (503, 'Trennung', 'keine Zubehoerkategorie ist sammelbar',
      (select count(*)::text from zubehoer z
        where z.kategorie is not null
          and not (z.kategorie = any (public.non_collectible_categories()))), '0'),
  (504, 'Trennung', 'Info: Zubehoerzeilen mit is_listed = true (Altlast, kein Angebot)',
      (select count(*)::text from zubehoer where is_listed), null),

  -- ------------------------------------------------------ Die Prueffigur
  (601, 'Fixture', 'SKY-9998 ist inaktiv und bleibt ausserhalb',
      coalesce((select (not s.is_active)::text from public.skylanders s
                 where s.sky_id = 'SKY-9998'), '(nicht vorhanden)'), null),
  (602, 'Fixture', 'Lagerzeilen im reservierten Bereich SKY-9000+',
      (select count(*)::text from zeile where not produktiver_bereich), null),

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
