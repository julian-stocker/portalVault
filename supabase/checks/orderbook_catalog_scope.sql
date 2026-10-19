-- ===========================================================================
-- WAS DIE ARTIKELSUCHE DES ORDERBUCHS UEBERHAUPT ANBIETEN KANN — rein lesend
--
-- ANLASS. Beim H1-Lauf fand die Suche nach „portal" nichts. Zwei Ursachen sind
-- moeglich und muessen auseinandergehalten werden:
--
--   A  die Suche schraenkt ein (Figuren, Kategorien, Serien) — ein Suchfehler
--   B  es gibt die Artikel nicht — Sortimentsdifferenz, kein Fehler
--
-- Aus dem Code steht A bereits fest: KEINE Schicht filtert auf Figuren.
-- `seller_import_catalog()` liefert jede Katalogzeile, `fetchOrderbookCatalog`
-- filtert allein `is_active` und `catalog_visible`, und `rankFigure` vergleicht
-- Name, SKY-ID und Rohname. Was die Suche NICHT kennt, ist die KATEGORIE und
-- die Serie — beides liefert die RPC bereits mit, die Anwendung verwirft es.
--
-- Diese Datei misst B und beziffert die Luecke: wie viele Zeilen je Kategorie
-- es gibt, wie viele davon der Picker heute anbietet, und bei wie vielen das
-- Kategoriewort im NAMEN steht — nur die findet man heute ueber die Kategorie.
--
-- REIN LESEND. Ein einziges SELECT. Kein DDL, keine Datenanweisung, kein
-- Katalogeintrag wird angelegt oder geaendert.
-- ===========================================================================

with waehlbar as (
  -- Genau die Zeilen, die `fetchOrderbookCatalog` an die Suche gibt.
  select s.sky_id, s.name, coalesce(s.display_name_override, s.name) as anzeige,
         s.series_code, c.name as kategorie
    from public.skylanders s
    left join public.categories c on c.id = s.category_id
   where s.is_active and s.catalog_visible
),
je_kategorie as (
  select coalesce(c.name, '(ohne Kategorie)') as kategorie,
         count(*)                                                    as zeilen,
         count(*) filter (where s.is_active and s.catalog_visible)    as waehlbar,
         count(*) filter (where s.is_active and s.catalog_visible
                            and position(lower(split_part(coalesce(c.name, ''), ' ', 1))
                                in lower(coalesce(s.display_name_override, s.name))) > 0)
                                                                      as kategoriewort_im_namen
    from public.skylanders s
    left join public.categories c on c.id = s.category_id
   group by coalesce(c.name, '(ohne Kategorie)')
),
pruef (nr, bereich, gegenstand, befund, erwartet) as (values

  (1, 'Umgebung', 'Info: vorhandene Testfiguren (SKY-9000 und hoeher)',
      coalesce((select string_agg(s.sky_id, ', ' order by s.sky_id)
                  from public.skylanders s where s.sky_id >= 'SKY-9000'), '(keine)'), null),

  -- -------------------------------------------- Was der Picker heute anbietet
  (101, 'Katalog', 'Katalogzeilen insgesamt / aktiv / sichtbar / BEIDES (= waehlbar)',
      (select count(*)::text from public.skylanders) || ' / ' ||
      (select count(*)::text from public.skylanders where is_active) || ' / ' ||
      (select count(*)::text from public.skylanders where catalog_visible) || ' / ' ||
      (select count(*)::text from waehlbar), null),
  (102, 'Katalog', 'Serien / Kategorien',
      (select count(*)::text from public.series) || ' / ' ||
      (select count(*)::text from public.categories), null),
  (103, 'Katalog', 'je Kategorie: Zeilen (waehlbar, davon Kategoriewort im Namen)',
      coalesce((select string_agg(k.kategorie || ' ' || k.zeilen::text
                 || ' (' || k.waehlbar::text || ', ' || k.kategoriewort_im_namen::text || ')',
                 '  |  ' order by k.zeilen desc, k.kategorie)
                  from je_kategorie k), '(keine)'), null),

  -- ------------------------------------------------- Portale und Zubehoer
  (201, 'Portale', 'Katalogzeilen, deren Name auf ein Portal deutet',
      (select count(*)::text from public.skylanders s
        where s.name ilike '%portal%'
           or coalesce(s.display_name_override, '') ilike '%portal%'), '0'),
  (202, 'Portale', 'Kategorien, deren Name auf Portal, Zubehoer oder Sonstiges deutet',
      coalesce((select string_agg(c.name, ', ' order by c.name) from public.categories c
                 where c.name ilike '%portal%' or c.name ilike '%zubeh%'
                    or c.name ilike '%sonstig%' or c.name ilike '%accessor%'), '(keine)'),
      '(keine)'),
  (203, 'Portale', 'Serien, deren Code auf Zubehoer deutet (ZB im Legacy-Blatt)',
      coalesce((select string_agg(se.code || '=' || se.label, ', ' order by se.code)
                  from public.series se
                 where se.code in ('ZB', 'DI', 'DIA') or se.label ilike '%zubeh%'),
               '(keine)'), '(keine)'),

  -- ------------------------------- Die Luecke, die die Kategorie schliessen wuerde
  (301, 'Luecke', 'Spiele: waehlbar / Name enthaelt "spiel" / Name enthaelt "game"',
      (select count(*)::text from waehlbar where kategorie = 'Spiele') || ' / ' ||
      (select count(*)::text from waehlbar
        where kategorie = 'Spiele' and lower(anzeige) like '%spiel%') || ' / ' ||
      (select count(*)::text from waehlbar
        where kategorie = 'Spiele' and lower(anzeige) like '%game%'), null),
  (302, 'Luecke', 'Fallen: Traps / Trap Items / Trap Masters (waehlbar)',
      (select count(*)::text from waehlbar where kategorie = 'Traps') || ' / ' ||
      (select count(*)::text from waehlbar where kategorie = 'Trap Items') || ' / ' ||
      (select count(*)::text from waehlbar where kategorie = 'Trap Masters'), null),
  (303, 'Luecke', 'davon mit "trap" im Namen / mit "falle" im Namen',
      (select count(*)::text from waehlbar
        where kategorie in ('Traps', 'Trap Items', 'Trap Masters')
          and lower(anzeige) like '%trap%') || ' / ' ||
      (select count(*)::text from waehlbar
        where kategorie in ('Traps', 'Trap Items', 'Trap Masters')
          and lower(anzeige) like '%falle%'), null),
  (304, 'Luecke', 'Fahrzeuge / Senseis / Kreationskristalle / Magic Items (waehlbar)',
      (select count(*)::text from waehlbar where kategorie = 'Fahrzeuge') || ' / ' ||
      (select count(*)::text from waehlbar where kategorie = 'Senseis') || ' / ' ||
      (select count(*)::text from waehlbar where kategorie = 'Kreationskristalle') || ' / ' ||
      (select count(*)::text from waehlbar where kategorie = 'Magic Items'), null),
  (305, 'Luecke', 'waehlbare Zeilen, deren Kategoriewort NICHT im Namen steht',
      (select coalesce(sum(k.waehlbar - k.kategoriewort_im_namen), 0)::text
         from je_kategorie k), null),

  -- --------------------------------- Was ohne Katalogbezug gekauft wurde
  (401, 'ohne sky_id', 'Einkaufspositionen ohne Katalogbezug / verschiedene Rohnamen',
      (select count(*)::text from public.purchase_items where sky_id is null) || ' / ' ||
      (select count(distinct coalesce(raw_name, '(ohne Namen)'))::text
         from public.purchase_items where sky_id is null), null),
  (402, 'ohne sky_id', 'davon mit "portal" im Rohnamen',
      (select count(*)::text from public.purchase_items
        where sky_id is null and raw_name ilike '%portal%'), null),

  -- ------------------------------------------------------- Unberuehrt
  (501, 'Unberuehrt', 'Lagerzeilen / Einheiten / Bewegungen',
      (select count(*)::text from public.shop_inventory) || ' / ' ||
      (select coalesce(sum(quantity), 0)::text from public.shop_inventory) || ' / ' ||
      (select count(*)::text from public.inventory_movements), null),
  (502, 'Unberuehrt', 'Spiele im oeffentlichen Angebot (muss 0 sein — Software)',
      (select count(*)::text from public.shop_offers() ofr
        where ofr.sky_id in (select w.sky_id from waehlbar w where w.kategorie = 'Spiele')),
      '0')
),
ergebnis as (
  select nr, bereich, gegenstand, befund, erwartet,
         case when erwartet is null then null
              else befund is not distinct from erwartet end as ok
    from pruef
)
select nr, bereich, gegenstand, befund, erwartet, ok from ergebnis
union all
select 9999, 'GESAMT', 'blockierende Abweichungen (muss 0 sein)',
       (select count(*) from ergebnis where ok is false)::text, '0',
       (select count(*) from ergebnis where ok is false) = 0
 order by nr;
