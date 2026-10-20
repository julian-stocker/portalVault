-- ===========================================================================
-- WELCHE FREITEXTPOSITIONEN SIND JETZT KATALOGARTIKEL — rein lesend
--
-- ANLASS. `accessory_audit_readonly.sql` hat am 2026-10-18 eine Frage offen
-- gelassen: die 206 Einkaufspositionen ohne `sky_id` waren nicht erwartet,
-- und es war nicht entschieden, ob es wirklich so viele Nicht-Katalogartikel
-- gibt oder ob die Zahl etwas anderes enthaelt. Seit `0138` gibt es die 21
-- Portale als Katalogartikel, und damit laesst sich die Frage beantworten.
--
-- WAS DIESE DATEI TUT. Sie vergleicht den ROHNAMEN jeder Freitextposition
-- mit `skylanders.name` — auf EXAKTE Gleichheit, Zeichen fuer Zeichen.
--
-- WARUM EXAKTE GLEICHHEIT UND NICHTS ANDERES. Beide Seiten stammen aus
-- Spalte B derselben Arbeitsmappe: die Freitextposition aus dem
-- Einkaufsimport, der Katalogartikel aus `0138`. Wo beide Zeichen fuer
-- Zeichen uebereinstimmen, ist das keine Vermutung, sondern dieselbe
-- Quellzeile. Ein `ilike`, ein `trim` oder eine Normalisierung wuerde aus
-- einer Tatsache eine Heuristik machen — und `ADR-0128` Punkt 10 verlangt
-- ausdruecklich eine namensweise Entscheidung des Betreibers, nie eine
-- Heuristik. Diese Datei ENTSCHEIDET deshalb nichts; sie legt vor.
--
-- WAS SIE AUSDRUECKLICH NICHT TUT. Sie haengt keine Position um, legt keine
-- Lagerzeile an, bucht nichts ein und veraendert keine Zeile. Ein einziges
-- SELECT.
--
-- Zuordnen wuerde man mit `seller_set_purchase_item_sky(item_id, sky_id)`
-- aus `0054` — einer Position je Aufruf, ueber den Figurenwechsel im
-- Einkaufsdialog. Die Funktion fasst `raw_name`, `source_row`, die
-- Legacy-Flaggen, den Zustand und die Lage nicht an, bewegt keinen Bestand
-- und weist jede Position ab, die schon eine Lagerbewegung besitzt.
-- Vorschlag und Reihenfolge: `supabase/checks/accessory_assignment_proposal.md`.
-- ===========================================================================

with frei as (
  select pi.id, pi.purchase_id, pi.raw_name, pi.state, pi.condition,
         pi.movement_id, pi.source_row
    from public.purchase_items pi
   where pi.sky_id is null
),
/*
 * Der Katalog, auf dem Rohnamen aufgeschluesselt. `count(*)` je Name deckt
 * den Fall ab, dass zwei Artikel denselben Rohnamen tragen — dann ist die
 * Zuordnung MEHRDEUTIG und darf nicht vorgeschlagen werden.
 */
nach_name as (
  select s.name,
         count(*)                                    as treffer,
         min(s.sky_id)                               as sky_id,
         min(s.item_type)                            as item_type,
         min(s.series_code)                          as series_code
    from public.skylanders s
   group by s.name
),
zuordenbar as (
  select f.*, n.sky_id, n.item_type, n.series_code
    from frei f
    join nach_name n on n.name = f.raw_name and n.treffer = 1
),

befund (nr, bereich, gegenstand, wert) as (values

  -- -------------------------------------------------------- Die Mengen
  (101, 'Menge', 'Einkaufspositionen insgesamt',
      (select count(*)::text from public.purchase_items)),
  (102, 'Menge', 'davon ohne sky_id (Freitext)',
      (select count(*)::text from frei)),
  (103, 'Menge', 'davon mit EXAKTEM Katalogtreffer',
      (select count(*)::text from zuordenbar)),
  (104, 'Menge', 'davon mehrdeutig (gleicher Rohname, mehrere Artikel)',
      (select count(*)::text from frei f
         join nach_name n on n.name = f.raw_name and n.treffer > 1)),
  (105, 'Menge', 'bleiben Freitext (kein Treffer)',
      (select (count(*) - (select count(*) from zuordenbar)
                        - (select count(*) from frei f2
                             join nach_name n2 on n2.name = f2.raw_name and n2.treffer > 1))::text
         from frei)),

  -- ------------------------------------------- Je Artikel, mit Zustand
  (201, 'Treffer', 'je Artikel: SKY-ID, Art, Positionen, Einkaeufe',
      coalesce((select string_agg(x.zeile, '  |  ' order by x.sky_id)
                  from (select z.sky_id,
                               z.sky_id || ' ' || z.item_type || ' ' ||
                               count(*)::text || ' Pos. in ' ||
                               count(distinct z.purchase_id)::text || ' Eink. "' ||
                               min(z.raw_name) || '"' as zeile
                          from zuordenbar z group by z.sky_id, z.item_type) x), '(keine)')),
  (202, 'Treffer', 'Zustaende der zuordenbaren Positionen',
      coalesce((select string_agg(x.state || '=' || x.n::text, ', ' order by x.state)
                  from (select z.state, count(*) as n from zuordenbar z group by z.state) x),
               '(keine)')),

  /*
   * DIE ENTSCHEIDENDE ZEILE. `seller_set_purchase_item_sky` weist jede
   * Position ab, die schon eine Lagerbewegung besitzt — sonst beschrieben
   * Bewegung und Position verschiedene Dinge. Steht hier 0, ist jede
   * vorgeschlagene Zuordnung technisch moeglich.
   */
  (203, 'Treffer', 'davon MIT Lagerbewegung (waeren nicht zuordenbar)',
      (select count(*)::text from zuordenbar where movement_id is not null)),
  (204, 'Treffer', 'davon aus einer Arbeitsmappenzeile (source_row gesetzt)',
      (select count(*)::text from zuordenbar where source_row is not null)),

  -- ---------------------------------------- Was Freitext bleiben wuerde
  (301, 'Rest', 'die haeufigsten Rohnamen ohne Treffer',
      coalesce((select string_agg(x.zeile, '  |  ' order by x.n desc, x.raw_name)
                  from (select f.raw_name, count(*) as n,
                               count(*)::text || 'x ' || coalesce(f.raw_name, '(leer)') as zeile
                          from frei f
                         where not exists (select 1 from nach_name n
                                            where n.name = f.raw_name and n.treffer = 1)
                         group by f.raw_name
                         order by count(*) desc, f.raw_name
                         limit 12) x), '(keine)')),

  -- ------------------------------------- Was heute schon zugeordnet ist
  (401, 'Bereits', 'Einkaufspositionen auf Spielen',
      (select count(*)::text from public.purchase_items pi
         join public.skylanders s on s.sky_id = pi.sky_id
        where s.item_type = 'game')),
  (402, 'Bereits', 'Einkaufspositionen auf Portalen',
      (select count(*)::text from public.purchase_items pi
         join public.skylanders s on s.sky_id = pi.sky_id
        where s.item_type = 'portal')),
  (403, 'Bereits', 'Lagerzeilen je Art',
      coalesce((select string_agg(x.art || '=' || x.n::text, ', ' order by x.art)
                  from (select coalesce(s.item_type, '(ohne Katalogzeile)') as art,
                               count(*) as n
                          from public.shop_inventory i
                          left join public.skylanders s on s.sky_id = i.sky_id
                         group by coalesce(s.item_type, '(ohne Katalogzeile)')) x), '(keine)')),
  (404, 'Bereits', 'Verkaufspositionen auf Zubehoer',
      (select count(*)::text from public.sale_items si
         join public.skylanders s on s.sky_id = si.sky_id
        where s.item_type <> 'figure')),

  -- -------------------------------------------- Und die Sammlung bleibt
  (501, 'Sammlung', 'Sammlungseintraege insgesamt',
      (select count(*)::text from public.collection_items)),
  (502, 'Sammlung', 'davon auf Zubehoer (muss 0 sein)',
      (select count(*)::text from public.collection_items ci
         join public.skylanders s on s.sky_id = ci.sky_id
        where s.item_type <> 'figure')),
  (503, 'Sammlung', 'sammelbare Katalogzeilen (der Nenner des Fortschritts)',
      (select count(*)::text from public.skylanders s
         join public.categories c on c.id = s.category_id
        where s.is_active and s.catalog_visible
          and not (c.name = any (public.non_collectible_categories())))),

  -- ------------------------------------ Und die Sichtbarkeit je Art
  (601, 'Sichtbar', 'je Art: aktiv und catalog_visible',
      coalesce((select string_agg(x.art || '=' || x.n::text, ', ' order by x.art)
                  from (select s.item_type as art, count(*) as n
                          from public.skylanders s
                         where s.is_active and s.catalog_visible
                         group by s.item_type) x), '(keine)')),
  (602, 'Sichtbar', 'je Art: aktiv, aber ausgeblendet',
      coalesce((select string_agg(x.art || '=' || x.n::text, ', ' order by x.art)
                  from (select s.item_type as art, count(*) as n
                          from public.skylanders s
                         where s.is_active and not s.catalog_visible
                         group by s.item_type) x), '(keine)'))
)
select nr, bereich, gegenstand, wert from befund order by nr;
