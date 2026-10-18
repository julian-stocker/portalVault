-- ===========================================================================
-- DIE TESTFIGUR AUF PRODUCTION — Identitaet, Herkunft, Verknuepfungen
--
-- ANLASS. Der Zustandsaudit vom 2026-10-19 hat auf Production
-- (`zmiwxswrpkmizvqsgype`) EINE Figur aus dem Fixture-Bereich gefunden, wo die
-- Diagnose keine erwartete. Die Erwartung war falsch — `verify:rls` legt
-- `SKY-9998` ausdruecklich als DAUERHAFTE Shop-Fixture an, deren
-- Fremdschluessel ON DELETE RESTRICT tragen; der Teardown „has never been able
-- to remove them" (`tools/verify-rls.mts`). Was offen ist: WELCHE Figur es
-- ist, WAS an ihr haengt und ob sie nach aussen wirkt.
--
-- REIN LESEND. Ein einziges SELECT. Kein DDL, keine Datenanweisung, keine
-- Transaktion. Nichts wird entfernt — eine Fixture mit RESTRICT-Verweisen
-- loescht man nicht nebenbei, und ohne diese Aufstellung weiss niemand, was
-- daran haengt.
--
-- KEINE SOLLSPALTE ausser bei den drei Zeilen, die eine Aussenwirkung
-- messen (300er). Alles andere ist Bestandsaufnahme.
-- ===========================================================================

with fixture as (
  -- Der Fixture-Bereich. Der echte Katalog endet bei SKY-0820, und das
  -- Format `^SKY-[0-9]{4}$` ist feste Breite — der Textvergleich ordnet
  -- deshalb wie eine Zahl.
  select s.sky_id, s.name, s.slug, s.series_code, s.category_id,
         s.market_price, s.is_active, s.catalog_visible, s.created_at,
         s.display_name_override, s.image_file
    from public.skylanders s
   where s.sky_id >= 'SKY-9000'
),
zeilen (nr, bereich, gegenstand, befund, erwartet) as (values

  -- ------------------------------------------------------------- Identitaet
  (101, 'Identitaet', 'gefundene Fixture-Figuren',
        (select coalesce(string_agg(f.sky_id || ' = ' || f.name, ' | ' order by f.sky_id),
                         '(keine)') from fixture f), null),
  (102, 'Identitaet', 'Anzahl',
        (select count(*)::text from fixture), null),
  (103, 'Identitaet', 'Serie und Kategorie je Figur',
        (select coalesce(string_agg(f.sky_id || ': Serie ' || f.series_code
                   || ' / Kategorie ' || coalesce((select c.name from public.categories c
                                                    where c.id = f.category_id), '(keine)'),
                   ' | ' order by f.sky_id), '(keine)') from fixture f), null),
  (104, 'Identitaet', 'angelegt am (Datum, ohne Uhrzeit)',
        (select coalesce(string_agg(f.sky_id || ': ' || f.created_at::date::text,
                                    ' | ' order by f.sky_id), '(keine)') from fixture f), null),
  (105, 'Identitaet', 'Marktpreis gesetzt?',
        (select coalesce(string_agg(f.sky_id || ': '
                   || coalesce(f.market_price::text, '(kein Preis)'),
                   ' | ' order by f.sky_id), '(keine)') from fixture f), null),
  (106, 'Identitaet', 'Anzeigename-Override / Bild',
        (select coalesce(string_agg(f.sky_id || ': '
                   || coalesce(f.display_name_override, '(kein Override)') || ' / '
                   || coalesce(f.image_file, '(kein Bild)'),
                   ' | ' order by f.sky_id), '(keine)') from fixture f), null),

  -- ------------------------------------------------------- Welche Serie ist das
  --
  -- BERICHTIGT AM 2026-10-20. Hier stand: „echte Katalogzeilen in denselben
  -- Serien (muss 0 sein)", mit dem Sollwert 0 und der Annahme, eine Serie mit
  -- Fixtures duerfe keine echten Artikel enthalten. **Diese Annahme war
  -- falsch**, und der Lauf hat sie widerlegt: beide Fixtures stehen in `SA`,
  -- wo 108 echte Katalogzeilen stehen.
  --
  -- Und zwar ABSICHTLICH. `tools/verify-rls.mts` legt die Shop-Fixture nicht
  -- in einer erfundenen Serie an, sondern sucht sich eine VORHANDENE Kategorie
  -- als Wirt: erst die, in der die Figur schon steht, sonst
  -- `select id, series_code from categories limit 1`. Eine eigene Serie waere
  -- die zweite Fixture, die mit der ersten kollidiert — genau das Problem, das
  -- `verify-editorial.mts` in seinem Kommentar beschreibt.
  --
  -- Der Schutz haengt deshalb nicht an der Serie, sondern an drei Dingen, die
  -- unten stehen und blockierend sind: die Figur ist INAKTIV, sie ist nicht
  -- shopfaehig, und sie steht in keinem oeffentlichen Angebot. `PROJECT_STATUS`
  -- nennt genau diese Regel: ausgeschlossen „ueber die zentrale Regel, nicht
  -- ueber eine Sonderliste".
  (111, 'Serie', 'Info: Serie und Zahl der echten Katalogzeilen darin',
        (select coalesce(string_agg(x.code || ': ' || x.n::text || ' echte Zeilen',
                                    ' | ' order by x.code), '(keine)')
           from (select se.code,
                        (select count(*) from public.skylanders s2
                          where s2.series_code = se.code
                            and s2.sky_id < 'SKY-9000') as n
                   from public.series se
                  where exists (select 1 from fixture f where f.series_code = se.code)) x),
        null),
  (112, 'Schutz', 'jede Fixture-Figur ist INAKTIV (muss 0 aktive sein)',
        (select count(*)::text from fixture f where f.is_active), '0'),
  (113, 'Schutz', 'keine Fixture-Figur ist shopfaehig (muss 0 sein)',
        (select count(*)::text from fixture f
          where public.is_shop_eligible(f.sky_id)), '0'),

  -- ---------------------------------------------------------- Verknuepfungen
  (201, 'Verknuepfung', 'Lagerzeilen (shop_inventory)',
        (select coalesce(string_agg(i.sky_id || '/' || i.condition
                   || ': q=' || i.quantity::text || ' r=' || i.reserved::text
                   || ' ' || case when i.is_listed then 'GELISTET' else 'nicht gelistet' end
                   || ' p=' || coalesce(i.sale_price::text, 'auto'),
                   ' | ' order by i.id), '(keine)')
           from public.shop_inventory i
          where i.sky_id >= 'SKY-9000'), null),
  (202, 'Verknuepfung', 'Lagerbewegungen: Anzahl / Summe delta',
        (select count(*)::text || ' / ' || coalesce(sum(m.delta), 0)::text
           from public.inventory_movements m
           join public.shop_inventory i on i.id = m.inventory_id
          where i.sky_id >= 'SKY-9000'), null),
  (203, 'Verknuepfung', 'Bewegungen je Grund',
        (select coalesce(string_agg(g.reason || '=' || g.n::text, ', ' order by g.reason),
                         '(keine)')
           from (select m.reason, count(*) as n
                   from public.inventory_movements m
                   join public.shop_inventory i on i.id = m.inventory_id
                  where i.sky_id >= 'SKY-9000'
                  group by m.reason) g), null),
  (204, 'Verknuepfung', 'Bestellpositionen (order_lines)',
        (select count(*)::text from public.order_lines l where l.sky_id >= 'SKY-9000'), null),
  (205, 'Verknuepfung', 'Bestellungen, die eine solche Position enthalten',
        (select coalesce(string_agg(DISTINCT o.order_number, ', ' order by o.order_number),
                         '(keine)')
           from public.orders o
           join public.order_lines l on l.order_id = o.id
          where l.sky_id >= 'SKY-9000'), null),
  (206, 'Verknuepfung', 'Reservierungen (order_reservations)',
        (select count(*)::text from public.order_reservations r
           join public.shop_inventory i on i.id = r.inventory_id
          where i.sky_id >= 'SKY-9000'), null),
  (207, 'Verknuepfung', 'Warenkorbzeilen (cart_items)',
        (select count(*)::text from public.cart_items ci where ci.sky_id >= 'SKY-9000'), null),
  (208, 'Verknuepfung', 'Sammlungseintraege (collection_items)',
        (select count(*)::text from public.collection_items c
          where c.sky_id >= 'SKY-9000'), null),
  (209, 'Verknuepfung', 'Einkaufspositionen (purchase_items)',
        (select count(*)::text from public.purchase_items pi
          where pi.sky_id >= 'SKY-9000'), null),
  (210, 'Verknuepfung', 'Verkaufspositionen (sale_items)',
        (select count(*)::text from public.sale_items si
          where si.sky_id >= 'SKY-9000'), null),
  (211, 'Verknuepfung', 'redaktionelle Notizen (catalog_editorial)',
        (select count(*)::text from public.catalog_editorial ce
          where ce.sky_id >= 'SKY-9000'), null),
  (212, 'Verknuepfung', 'legacy_stock_events',
        (select count(*)::text from public.legacy_stock_events e
          where e.sky_id >= 'SKY-9000'), null),
  (213, 'Verknuepfung', 'Namenszuordnungen (orderbook_name_mappings)',
        (select count(*)::text from public.orderbook_name_mappings nm
          where nm.sky_id >= 'SKY-9000'), null),
  (214, 'Verknuepfung', 'Importzuordnungen und -zeilen',
        (select count(*)::text from public.inventory_import_mappings im
          where im.sky_id >= 'SKY-9000')
        || ' / ' ||
        (select count(*)::text from public.inventory_import_rows ir
          where ir.sky_id >= 'SKY-9000'), null),

  -- ------------------------------------------------------- Aussenwirkung
  (301, 'Aussenwirkung', 'im oeffentlichen Angebot shop_offers() (muss 0 sein)',
        (select count(*)::text from public.shop_offers() ofr
          where ofr.sky_id >= 'SKY-9000'), '0'),
  (302, 'Aussenwirkung', 'Info: je Figur aktiv / sichtbar / shopfaehig',
        (select coalesce(string_agg(f.sky_id || ': '
                   || case when f.is_active then 'aktiv' else 'inaktiv' end || '/'
                   || case when f.catalog_visible then 'sichtbar' else 'verborgen' end || '/'
                   || public.is_shop_eligible(f.sky_id)::text, ' | ' order by f.sky_id),
                 '(keine)') from fixture f), null),
  (303, 'Aussenwirkung', 'im oeffentlichen Katalog sichtbar UND aktiv (Befund)',
        (select count(*)::text from fixture f
          where f.is_active and f.catalog_visible), null),
  (304, 'Aussenwirkung', 'Aggregate, in die sie hineinzaehlt: Lagerzeilen / Einheiten',
        (select count(*)::text || ' / ' || coalesce(sum(i.quantity), 0)::text
           from public.shop_inventory i where i.sky_id >= 'SKY-9000'), null),
  (305, 'Aussenwirkung', 'zaehlt sie in die Verkaufsstatistik? (sale_items)',
        (select count(*)::text from public.sale_items si
          where si.sky_id >= 'SKY-9000'), '0')
),
ergebnis as (
  select nr, bereich, gegenstand, befund, erwartet,
         case when erwartet is null then null
              else befund is not distinct from erwartet end as ok
    from zeilen
)
select nr, bereich, gegenstand, befund, erwartet, ok from ergebnis
union all
select 9999, 'GESAMT', 'blockierende Abweichungen (muss 0 sein)',
       (select count(*) from ergebnis where ok is false)::text, '0',
       (select count(*) from ergebnis where ok is false) = 0
 order by nr;
