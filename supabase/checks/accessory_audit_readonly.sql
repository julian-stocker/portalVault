-- ===========================================================================
-- ZUBEHOER — was ohne Katalogbezug gekauft wurde, und was an Spielen haengt
--
-- ANLASS. Der Zustandsaudit vom 2026-10-18 hat auf Production drei Zahlen
-- gezeigt, die die Zubehoerplanung tragen oder umwerfen:
--
--     206  Einkaufspositionen ohne `sky_id`
--      40  Katalogzeilen in der Kategorie `Spiele`, davon 39 aktiv+sichtbar
--      13  Lagerzeilen und 18 Verkaufspositionen mit Spiele-Bezug
--
-- Die 206 waren nicht erwartet: `0069` nennt in seinem Kopf „a trophy and two
-- portals". Zwei Lesarten sind moeglich — entweder gibt es weit mehr
-- Nicht-Katalogartikel als angenommen, oder die Zahl enthaelt etwas anderes
-- (etwa unzugeordnete Arbeitsmappenzeilen, die auf eine Figur ZEIGEN
-- SOLLTEN). Zwischen beidem entscheidet nur eine Aufstellung.
--
-- REIN LESEND. Ein einziges SELECT. Keine Sollwerte — das hier ist eine
-- Bestandsaufnahme fuer die Planung, keine Pruefung.
--
-- KEINE PERSONENBEZOGENEN DATEN. Gelesen werden Artikelnamen, Zustaende und
-- Mengen; kein Kaeufer, keine Adresse, kein Preis einer Bestellung.
-- ===========================================================================

with ohne_katalog as (
  select pi.id, pi.purchase_id, pi.state, pi.raw_name, pi.source_row,
         pi.condition, pi.movement_id, p.source
    from public.purchase_items pi
    join public.purchases p on p.id = pi.purchase_id
   where pi.sky_id is null
),
spiele as (
  select s.sky_id, s.name, s.is_active, s.catalog_visible, s.series_code,
         s.market_price
    from public.skylanders s
    join public.categories c on c.id = s.category_id
   where c.name = 'Spiele'
),
zeilen (nr, bereich, gegenstand, befund) as (

  -- ------------------------------------- A. Positionen ohne Katalogbezug
  select 101, 'A ohne sky_id', 'Einkaufspositionen ohne sky_id insgesamt',
         (select count(*)::text from ohne_katalog)
  union all
  select 102, 'A ohne sky_id', 'je Zustand',
         (select coalesce(string_agg(z.state || '=' || z.n::text, ', ' order by z.state), '(keine)')
            from (select state, count(*) as n from ohne_katalog group by state) z)
  union all
  select 103, 'A ohne sky_id', 'je Herkunft des Einkaufs',
         (select coalesce(string_agg(h.source || '=' || h.n::text, ', ' order by h.source), '(keine)')
            from (select source, count(*) as n from ohne_katalog group by source) h)
  union all
  select 104, 'A ohne sky_id', 'mit source_row (aus der Arbeitsmappe) / ohne',
         (select count(*)::text from ohne_katalog where source_row is not null)
         || ' / ' ||
         (select count(*)::text from ohne_katalog where source_row is null)
  union all
  select 105, 'A ohne sky_id', 'bereits eingebucht (movement_id gesetzt) — muesste 0 sein',
         (select count(*)::text from ohne_katalog where movement_id is not null)
  union all
  select 106, 'A ohne sky_id', 'mit Rohnamen / ohne Rohnamen',
         (select count(*)::text from ohne_katalog where raw_name is not null)
         || ' / ' ||
         (select count(*)::text from ohne_katalog where raw_name is null)
  union all
  -- Die 25 haeufigsten Rohnamen. Daran erkennt man, WAS diese Positionen
  -- sind: Portale, Spiele, Karten, Konvolute — oder Figuren, die nur keine
  -- Zuordnung bekommen haben.
  select 107, 'A ohne sky_id', 'haeufigste Rohnamen (bis 25)',
         (select coalesce(string_agg(x.raw_name || ' x' || x.n::text, ' | ' order by x.n desc, x.raw_name), '(keine)')
            from (select coalesce(raw_name, '(ohne Namen)') as raw_name, count(*) as n
                    from ohne_katalog group by 1 order by 2 desc, 1 limit 25) x)
  union all
  select 108, 'A ohne sky_id', 'verschiedene Rohnamen insgesamt',
         (select count(distinct coalesce(raw_name, '(ohne Namen)'))::text from ohne_katalog)
  union all
  select 109, 'A ohne sky_id', 'Einkaeufe, die solche Positionen enthalten',
         (select count(distinct purchase_id)::text from ohne_katalog)
  union all
  select 110, 'A ohne sky_id', 'je Zustandsklasse: abgeschlossen (settled) / offen / sonstiges',
         (select count(*)::text from ohne_katalog where state = 'settled') || ' / ' ||
         (select count(*)::text from ohne_katalog
           where state in ('ordered', 'arrived')) || ' / ' ||
         (select count(*)::text from ohne_katalog
           where state not in ('settled', 'ordered', 'arrived'))

  -- --------------------------------------------------- B. Spiele im Katalog
  union all
  select 201, 'B Spiele', 'Katalogzeilen in der Kategorie Spiele',
         (select count(*)::text from spiele)
  union all
  select 202, 'B Spiele', 'davon aktiv / sichtbar / beides',
         (select count(*)::text from spiele where is_active) || ' / ' ||
         (select count(*)::text from spiele where catalog_visible) || ' / ' ||
         (select count(*)::text from spiele where is_active and catalog_visible)
  union all
  select 203, 'B Spiele', 'die Zeilen, die NICHT aktiv+sichtbar sind',
         (select coalesce(string_agg(sp.sky_id || ' (' || sp.name || ')', ' | ' order by sp.sky_id),
                          '(keine)')
            from spiele sp where not (sp.is_active and sp.catalog_visible))
  union all
  select 204, 'B Spiele', 'je Serie',
         (select coalesce(string_agg(g.series_code || '=' || g.n::text, ', ' order by g.series_code),
                          '(keine)')
            from (select series_code, count(*) as n from spiele group by series_code) g)
  union all
  select 205, 'B Spiele', 'mit Marktpreis / ohne',
         (select count(*)::text from spiele where market_price is not null) || ' / ' ||
         (select count(*)::text from spiele where market_price is null)
  union all
  select 206, 'B Spiele', 'shopfaehig nach is_shop_eligible (erwartet 0 — Software)',
         (select count(*)::text from spiele sp where public.is_shop_eligible(sp.sky_id))
  union all
  select 207, 'B Spiele', 'im oeffentlichen Angebot shop_offers() (erwartet 0)',
         (select count(*)::text from public.shop_offers() ofr
           where ofr.sky_id in (select sp.sky_id from spiele sp))

  -- ------------------------------------- C. Spiele in Lager und Verkauf
  union all
  select 301, 'C Spiele operativ', 'Lagerzeilen auf Spiele-Zeilen / Summe quantity',
         (select count(*)::text from public.shop_inventory i
           where i.sky_id in (select sp.sky_id from spiele sp)) || ' / ' ||
         (select coalesce(sum(i.quantity), 0)::text from public.shop_inventory i
           where i.sky_id in (select sp.sky_id from spiele sp))
  union all
  select 302, 'C Spiele operativ', 'davon gelistet (erwartet 0, denn nicht shopfaehig)',
         (select count(*)::text from public.shop_inventory i
           where i.sky_id in (select sp.sky_id from spiele sp) and i.is_listed)
  union all
  select 303, 'C Spiele operativ', 'Lagerbewegungen auf Spiele-Zeilen je Grund',
         (select coalesce(string_agg(g.reason || '=' || g.n::text, ', ' order by g.reason), '(keine)')
            from (select m.reason, count(*) as n
                    from public.inventory_movements m
                    join public.shop_inventory i on i.id = m.inventory_id
                   where i.sky_id in (select sp.sky_id from spiele sp)
                   group by m.reason) g)
  union all
  select 304, 'C Spiele operativ', 'Verkaufspositionen auf Spiele-Zeilen',
         (select count(*)::text from public.sale_items si
           where si.sky_id in (select sp.sky_id from spiele sp))
  union all
  select 305, 'C Spiele operativ', 'Einkaufspositionen auf Spiele-Zeilen',
         (select count(*)::text from public.purchase_items pi
           where pi.sky_id in (select sp.sky_id from spiele sp))
  union all
  select 306, 'C Spiele operativ', 'Sammlungseintraege auf Spiele-Zeilen',
         (select count(*)::text from public.collection_items c
           where c.sky_id in (select sp.sky_id from spiele sp))

  -- ------------------------------------------------- D. Was es NICHT gibt
  union all
  select 401, 'D fehlt', 'Kategorien insgesamt / als nicht sammelbar gefuehrt',
         (select count(*)::text from public.categories) || ' / ' ||
         (select array_length(public.non_collectible_categories(), 1)::text)
  union all
  select 402, 'D fehlt', 'Serien insgesamt (sechs Generationen erwartet)',
         (select count(*)::text from public.series)
  union all
  select 403, 'D fehlt', 'Kategorienamen, die auf Zubehoer hindeuten',
         (select coalesce(string_agg(DISTINCT c.name, ', ' order by c.name), '(keine)')
            from public.categories c
           where c.name ilike '%portal%' or c.name ilike '%zubeh%'
              or c.name ilike '%spiel%' or c.name ilike '%sonstig%')
  union all
  select 404, 'D fehlt', 'Katalogzeilen, deren Name auf ein Portal hindeutet',
         (select count(*)::text from public.skylanders s
           where s.name ilike '%portal%')
)
select nr, bereich, gegenstand, befund from zeilen order by nr;
