-- ===========================================================================
-- WAS PASSIERTE, WENN ZUBEHOER SHOPFAEHIG WUERDE — rein lesend
--
-- ANLASS. Der Zubehoerkatalog zeigt 60 Artikel, und jede Kachel sagt
-- „Aktuell kein Angebot". Die Frage des Betreibers ist, ob Spiele und
-- Portale kuenftig wie Figuren angeboten werden koennen. Bevor darueber
-- entschieden wird, muss MESSBAR sein, was eine Lockerung von
-- `is_shop_eligible()` im selben Augenblick veroeffentlichen WUERDE.
--
-- DIE EINE FRAGE, DIE DIESE DATEI BEANTWORTET
--
--   Wenn `is_shop_eligible()` morgen `item_type in ('figure','game','portal')`
--   erlaubte und sonst NICHTS geaendert wuerde — wie viele oeffentliche
--   Angebote entstuenden dadurch auf der Stelle, mit welchem Preis?
--
-- Die Datei rechnet das nach, indem sie die vier Bedingungen von
-- `shop_offers()` (0029) fuer Zubehoerzeilen von Hand nachbildet:
-- `is_listed`, `condition = v1_sale_condition()`, Katalogeignung,
-- `shop_price(...) is not null`. Sie ruft `is_shop_eligible()` dabei
-- unveraendert auf — nichts an der Funktion wird angefasst.
--
-- WAS SIE NICHT TUT. Sie aendert nichts, sie schlaegt nichts vor und sie
-- veroeffentlicht nichts. Ein einziges SELECT.
--
--   begin;
--   select set_config('skyisles.z0', 'staging', true);   -- oder 'keine'
--   \i supabase/checks/accessory_offer_readonly.sql
--   rollback;
--
-- Zeile 9999 muss 0 zeigen. Die blockierenden Erwartungen sind die des
-- HEUTIGEN Zustands: kein Zubehoerangebot, 256 Angebote, Abdruck unveraendert.
-- Ein Befund hier heisst, dass sich die Lage seit Z0 bewegt hat.
--
-- NICHT in `staging-suite.json` — aus demselben Grund wie
-- `inventory_accessories_readonly.sql`: die Datei ruft `is_shop_eligible()`
-- und `shop_offers()`, und die Suite ist zugleich die Quelle der Rechteliste
-- des Pruefkontos (`tools/lib/grant-plan.py`). Sie gehoert in den manuellen
-- Lauf im SQL-Editor.
-- ===========================================================================

with vertrag as (
  select nullif(btrim(coalesce(current_setting('skyisles.z0', true), '')), '') as modus
),
z0 (schluessel, wert) as (values
  -- Z0-Vertrag, Stand 2026-10-19/20 (`supabase/checks/0135_preflight.sql`).
  ('angebote',      '256'),
  ('angebote_md5',  '4d1d6c30fe0ae886ca2689bcb1fe9634'),
  ('shopfaehig',    '534'),
  ('portale_sichtbar', '21')
),
soll as (
  select z.schluessel,
         case when (select v.modus from vertrag v) = 'staging' then z.wert end as wert
    from z0 z
),
/* Jede Lagerzeile mit der Art ihres Artikels und allem, was ueber den Preis
   entscheidet. `coalesce(..., 'figure')` ist die Regel der Anwendung: ohne
   Auskunft gilt der Normalfall. */
zeile as (
  select i.id, i.sky_id, i.condition, i.quantity, i.available_quantity,
         i.is_listed, i.sale_price,
         s.market_price,
         coalesce(s.item_type, 'figure') as art,
         coalesce(s.is_active, false)    as aktiv,
         coalesce(s.catalog_visible, false) as sichtbar,
         public.shop_price(i.sale_price, s.market_price,
                           (select st.price_percentage from public.shop_settings st))
           as preis
    from public.shop_inventory i
    left join public.skylanders s on s.sky_id = i.sky_id
),
zubehoer as (select * from zeile where art <> 'figure'),
/*
 * DIE PROBE. Dieselben vier Bedingungen wie `shop_offers()` (0029) — nur
 * die Katalogeignung ist durch die HYPOTHETISCHE Regel ersetzt: aktiv,
 * sichtbar, Artikeltyp in (figure, game, portal). Was hier steht, stuende
 * am Tag einer Lockerung im Schaufenster.
 */
haette_angebot as (
  select * from zubehoer z
   where z.is_listed
     and z.condition = public.v1_sale_condition()
     and z.aktiv and z.sichtbar
     and z.art in ('figure', 'game', 'portal')
     and z.preis is not null
),

pruef (nr, bereich, pruefung, befund, erwartet) as (values

  -- ----------------------------------------------------- Vorbedingungen
  (101, 'Grundlage', 'is_shop_eligible verlangt item_type = figure (0135)',
      (select (position('s.item_type = ''figure''' in p.prosrc) > 0)::text from pg_proc p
        where p.oid = to_regprocedure('public.is_shop_eligible(text)')), 'true'),
  (102, 'Grundlage', 'shop_offers ruft is_shop_eligible (0029)',
      (select (position('is_shop_eligible' in p.prosrc) > 0)::text from pg_proc p
        where p.oid = to_regprocedure('public.shop_offers()')), 'true'),
  (103, 'Grundlage', 'die eine verkaufte Beschaffenheit',
      public.v1_sale_condition(), 'loose'),
  (104, 'Grundlage', 'Preisprozentsatz der Plattform',
      (select price_percentage::text from public.shop_settings), null),

  -- ----------------------------------------------- Der heutige Zustand
  (201, 'Heute', 'oeffentliche Angebote insgesamt',
      (select count(*)::text from public.shop_offers()),
      (select wert from soll where schluessel = 'angebote')),
  /* Die Z0-Formel aus `0135_preflight.sql`, Zeile 913 — nicht eine eigene. */
  (202, 'Heute', 'Abdruck ueber die Angebotsliste (sky_id|condition|price)',
      (select md5(coalesce(string_agg(o.sky_id || '|' || o.condition || '|'
                                      || coalesce(o.price::text, ''),
                                      ';' order by o.sky_id, o.condition), ''))
         from public.shop_offers() o),
      (select wert from soll where schluessel = 'angebote_md5')),
  (203, 'Heute', 'shopfaehige Katalogzeilen',
      (select count(*)::text from public.skylanders s
        where public.is_shop_eligible(s.sky_id)),
      (select wert from soll where schluessel = 'shopfaehig')),
  (204, 'Heute', 'davon Zubehoer',
      (select count(*)::text from public.skylanders s
        where s.item_type <> 'figure' and public.is_shop_eligible(s.sky_id)), '0'),
  (205, 'Heute', 'Zubehoerzeilen im oeffentlichen Angebot',
      (select count(*)::text from public.shop_offers() o
         join zubehoer z on z.sky_id = o.sky_id), '0'),

  -- ------------------------------- Was eine Lockerung SOFORT freigaebe
  (301, 'Probe', 'Zubehoer-Lagerzeilen insgesamt',
      (select count(*)::text from zubehoer), null),
  (302, 'Probe', 'davon is_listed = true',
      (select count(*)::text from zubehoer where is_listed), null),
  (303, 'Probe', 'davon in der verkauften Beschaffenheit',
      (select count(*)::text from zubehoer
        where is_listed and condition = public.v1_sale_condition()), null),
  (304, 'Probe', 'davon auf aktivem und sichtbarem Artikel',
      (select count(*)::text from zubehoer
        where is_listed and condition = public.v1_sale_condition()
          and aktiv and sichtbar), null),
  (305, 'Probe', 'WUERDEN SOFORT ANGEBOT — mit Preis, ohne jeden weiteren Schritt',
      (select count(*)::text from haette_angebot), null),
  (306, 'Probe', 'und zwar diese SKY-IDs',
      coalesce((select string_agg(sky_id || ' (' || art || ', ' || preis::text || ')',
                                  '  |  ' order by sky_id) from haette_angebot),
               '(keine)'), null),
  (307, 'Probe', 'je Art: wuerden Angebot',
      coalesce((select string_agg(x.art || ' ' || x.n::text, '  |  ' order by x.art)
                  from (select art, count(*) as n from haette_angebot group by art) x),
               '(keine)'), null),

  -- ----------------------------- Woher der Preis kaeme, wenn er kaeme
  (401, 'Preis', 'Zubehoerzeilen mit eigenem Verkaufspreis (sale_price)',
      (select count(*)::text from zubehoer where sale_price is not null), null),
  (402, 'Preis', 'Zubehoerartikel mit Marktpreis (ergaebe Preis ueber den Prozentsatz)',
      (select count(*)::text from public.skylanders s
        where s.item_type <> 'figure' and s.market_price is not null), null),
  (403, 'Preis', 'Zubehoerzeilen ganz ohne Preisquelle (blieben preislos)',
      (select count(*)::text from zubehoer where preis is null), null),

  -- --------------------------------- Die Portale, ausdruecklich getrennt
  (501, 'Portale', 'Portal-Katalogzeilen',
      (select count(*)::text from public.skylanders where item_type = 'portal'), '21'),
  /* Z0-gebunden: dass alle 21 sichtbar sind, ist eine Tatsache ueber
     STAGING seit der Freigabe vom 2026-10-20 — keine Struktureigenschaft.
     Ohne Z0-Vertrag bleibt die Zeile eine Messung. */
  (502, 'Portale', 'davon oeffentlich sichtbar (seit der Freigabe)',
      (select count(*)::text from public.skylanders
        where item_type = 'portal' and catalog_visible and is_active),
      (select wert from soll where schluessel = 'portale_sichtbar')),
  (503, 'Portale', 'Lagerzeilen auf Portalen — ohne Bestand kein Angebot',
      (select count(*)::text from zubehoer where art = 'portal'), '0'),

  -- ---------------- Was schon heute AUSSERHALB des Shops verkauft wurde
  (601, 'Historie', 'Verkaufspositionen auf Zubehoer (Orderbuch, nicht Shop)',
      (select count(*)::text from public.sale_items si
         join public.skylanders s on s.sky_id = si.sky_id
        where s.item_type <> 'figure'), null),
  (602, 'Historie', 'Einkaufspositionen auf Zubehoer',
      (select count(*)::text from public.purchase_items pi
         join public.skylanders s on s.sky_id = pi.sky_id
        where s.item_type <> 'figure'), null),

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
