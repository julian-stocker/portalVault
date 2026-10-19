-- ===========================================================================
-- Z0 — BESTANDSAUFNAHME VOR DER PORTAL- UND SPIELEINTEGRATION (rein lesend)
--
-- WOZU. Portale und Spiele sollen vollwertige Katalogartikel werden. Bevor
-- irgendeine Migration geschrieben wird, muessen sieben Dinge GEMESSEN sein —
-- nicht angenommen:
--
--   1  die Anzeigenamen, die `0117` fuer die 39 Spiele hinterlegt hat
--   2  dass SKY-0615 bis SKY-0642 hier frei sind
--   3  Serien und Kategorien, wie sie wirklich stehen
--   4  Slugs, die mit einem abgeleiteten Portal-/Spielnamen kollidieren koennten
--   5  der Fortschritts-Nenner von heute, als Bezugswert
--   6  die Shop-Eignung von heute, als Bezugswert — Zeile 601 ist der
--      Abdruck, gegen den spaeter bewiesen wird, dass sich KEIN Angebot
--      geaendert hat
--   7  dass es die Spalte `item_type` noch nicht gibt
--
-- REIN LESEND. Ein einziges SELECT. Kein DDL, keine Datenanweisung, keine
-- Transaktion. Es wird kein Katalogartikel angelegt, geaendert oder geloescht.
--
-- FUER STAGING (`qqxcpesbwfxzgytkdsac`). Auf Production hat die Datei denselben
-- Zweck und ist ebenso unschaedlich, aber der naechste Schritt ist Staging.
-- ===========================================================================

with
-- Die 39 Spiele: ueber die KATEGORIE, nicht ueber Namen.
spiel as (
  select s.sky_id, s.name, s.display_name_override, s.slug, s.series_code,
         s.is_active, s.catalog_visible, s.market_price, s.card_type
    from public.skylanders s
    join public.categories c on c.id = s.category_id
   where c.name = 'Spiele'
),
-- Der Bereich, in dem die Arbeitsmappe die Zubehoer-SKY-IDs vergeben hat.
zb_bereich as (
  select s.sky_id, s.name from public.skylanders s
   where s.sky_id between 'SKY-0615' and 'SKY-0642'
),
-- Was heute sammelbar ist: dieselbe Regel wie `is_shop_eligible` und
-- `collectibleOnly` — Kategorie nicht in `non_collectible_categories()`.
sammelbar as (
  select s.sky_id, s.series_code
    from public.skylanders s
    join public.categories c on c.id = s.category_id
   where s.is_active and s.catalog_visible
     and not (c.name = any (public.non_collectible_categories()))
),
pruef (nr, bereich, gegenstand, befund, erwartet) as (values

  -- -------------------------------------------------------------- Umgebung
  (1, 'Umgebung', 'Info: vorhandene Testfiguren (SKY-9000 und hoeher)',
      coalesce((select string_agg(s.sky_id, ', ' order by s.sky_id)
                  from public.skylanders s where s.sky_id >= 'SKY-9000'), '(keine)'), null),
  (2, 'Umgebung', 'Katalogzeilen insgesamt / hoechste SKY-ID',
      (select count(*)::text from public.skylanders) || ' / ' ||
      (select max(sky_id) from public.skylanders where sky_id < 'SKY-9000'), null),

  -- --------------------------------------- 1. Anzeigenamen der 39 Spiele
  (101, 'Spiele', 'Zeilen in der Kategorie Spiele (erwartet 39 echte)',
      (select count(*)::text from spiel), null),
  (102, 'Spiele', 'davon MIT display_name_override',
      (select count(*)::text from spiel where display_name_override is not null), null),
  (103, 'Spiele', 'die Overrides im Wortlaut — NICHT ueberschreiben',
      coalesce((select string_agg(sp.sky_id || ' = ' || sp.display_name_override,
                                  '  |  ' order by sp.sky_id)
                  from spiel sp where sp.display_name_override is not null), '(keine)'), null),
  (104, 'Spiele', 'Rohnamen je Serie (Abgleich gegen die Excel-Analyse)',
      coalesce((select string_agg(x.txt, '  |  ' order by x.series_code)
                  from (select sp.series_code,
                               sp.series_code || ': '
                               || string_agg(sp.sky_id || '=' || sp.name, ', ' order by sp.sky_id)
                                 as txt
                          from spiel sp group by sp.series_code) x), '(keine)'), null),
  (105, 'Spiele', 'aktiv und sichtbar / mit Marktpreis',
      (select count(*)::text from spiel where is_active and catalog_visible) || ' / ' ||
      (select count(*)::text from spiel where market_price is not null), null),
  (106, 'Spiele', 'card_type-Werte (erwartet nur standard)',
      coalesce((select string_agg(distinct sp.card_type, ', ' order by sp.card_type)
                  from spiel sp), '(keine)'), null),

  -- ------------------------------- 2. Ist SKY-0615..SKY-0642 frei?
  (201, 'ZB-Bereich', 'belegte SKY-IDs zwischen SKY-0615 und SKY-0642 (muss 0 sein)',
      (select count(*)::text from zb_bereich), '0'),
  (202, 'ZB-Bereich', 'falls belegt: welche',
      coalesce((select string_agg(z.sky_id || ' = ' || z.name, ', ' order by z.sky_id)
                  from zb_bereich z), '(keine)'), '(keine)'),

  -- ------------------------------------- 3. Serien und Kategorien
  (301, 'Struktur', 'Serien: Code = Label (Position)',
      coalesce((select string_agg(se.code || ' = ' || se.label || ' (' || se.position::text || ')',
                                  '  |  ' order by se.position)
                  from public.series se), '(keine)'), null),
  (302, 'Struktur', 'Kategorien je Serie',
      coalesce((select string_agg(x.txt, '  |  ' order by x.series_code)
                  from (select c.series_code,
                               c.series_code || ': '
                               || string_agg(c.name || '#' || c.position::text,
                                             ', ' order by c.position) as txt
                          from public.categories c group by c.series_code) x), '(keine)'), null),
  (303, 'Struktur', 'Kategorie "Portale" existiert schon? (muss 0 sein)',
      (select count(*)::text from public.categories where name ilike '%portal%'), '0'),
  (304, 'Struktur', 'hoechste Kategorieposition je Serie (fuer eine neue Kategorie)',
      coalesce((select string_agg(x.series_code || '=' || x.maxpos::text, ', ' order by x.series_code)
                  from (select series_code, max(position) as maxpos
                          from public.categories group by series_code) x), '(keine)'), null),
  (305, 'Struktur', 'nicht sammelbare Kategorien laut non_collectible_categories()',
      (select array_to_string(public.non_collectible_categories(), ', ')), null),

  -- --------------------------------------------- 4. Slug-Kollisionen
  (401, 'Slug', 'Slugs, die mit "portal" beginnen (muss 0 sein)',
      (select count(*)::text from public.skylanders where slug like 'portal%'), '0'),
  (402, 'Slug', 'Slugs, die mit "spiel" oder "game" beginnen',
      (select count(*)::text from public.skylanders
        where slug like 'spiel%' or slug like 'game%'), null),
  (403, 'Slug', 'falls vorhanden: welche',
      coalesce((select string_agg(s.sky_id || ' = ' || s.slug, ', ' order by s.slug)
                  from public.skylanders s
                 where s.slug like 'portal%' or s.slug like 'spiel%'
                    or s.slug like 'game%'), '(keine)'), null),
  (404, 'Slug', 'Slugs insgesamt / eindeutig (muessen gleich sein)',
      (select count(*)::text from public.skylanders) || ' / ' ||
      (select count(distinct slug)::text from public.skylanders), null),

  -- ------------------------------ 5. Fortschritt: der Bezugswert von heute
  (501, 'Fortschritt', 'Nenner heute: aktiv+sichtbar und sammelbar',
      (select count(*)::text from sammelbar), null),
  (502, 'Fortschritt', 'Nenner je Serie',
      coalesce((select string_agg(x.series_code || '=' || x.n::text, ', ' order by x.series_code)
                  from (select series_code, count(*) as n from sammelbar
                         group by series_code) x), '(keine)'), null),
  (503, 'Fortschritt', 'Sammlungszeilen insgesamt / verschiedene Konten',
      (select count(*)::text from public.collection_items) || ' / ' ||
      (select count(distinct user_id)::text from public.collection_items), null),
  (504, 'Fortschritt', 'Sammlungszeilen auf NICHT sammelbare Artikel (heute: Spiele)',
      (select count(*)::text from public.collection_items ci
        where not exists (select 1 from sammelbar sb where sb.sky_id = ci.sky_id)), null),

  -- --------------------- 6. Shop-Eignung: der Abdruck, der gleich bleiben muss
  (601, 'Shop', 'ABDRUCK: Zahl der shopfaehigen Zeilen (muss nach Z1 gleich sein)',
      (select count(*)::text from public.skylanders s
        where public.is_shop_eligible(s.sky_id)), null),
  (602, 'Shop', 'ABDRUCK: Zahl der oeffentlichen Angebote shop_offers()',
      (select count(*)::text from public.shop_offers()), null),
  (603, 'Shop', 'ABDRUCK: md5 ueber die Angebotsliste (sky_id|condition|price)',
      (select md5(coalesce(string_agg(o.sky_id || '|' || o.condition || '|'
                                      || coalesce(o.price::text, ''),
                                      ';' order by o.sky_id, o.condition), ''))
         from public.shop_offers() o), null),
  (604, 'Shop', 'shopfaehige Zeilen, die KEINE Figur sind (heute erwartet 0)',
      (select count(*)::text from public.skylanders s
         join public.categories c on c.id = s.category_id
        where public.is_shop_eligible(s.sky_id)
          and c.name = any (public.non_collectible_categories())), '0'),
  (605, 'Shop', 'gelistete Lagerzeilen insgesamt / davon auf Spiele',
      (select count(*)::text from public.shop_inventory where is_listed) || ' / ' ||
      (select count(*)::text from public.shop_inventory i
         join public.skylanders s on s.sky_id = i.sky_id
         join public.categories c on c.id = s.category_id
        where i.is_listed and c.name = 'Spiele'), null),

  -- ------------------------------------ 7. item_type darf es noch nicht geben
  (701, 'Vorbedingung', 'Spalte skylanders.item_type existiert NOCH NICHT',
      (select (count(*) = 0)::text from information_schema.columns
        where table_schema = 'public' and table_name = 'skylanders'
          and column_name = 'item_type'), 'true'),
  (702, 'Vorbedingung', 'weitere geplante Spalten noch nicht vorhanden',
      (select coalesce(string_agg(column_name, ', ' order by column_name), '(keine)')
         from information_schema.columns
        where table_schema = 'public' and table_name = 'skylanders'
          and column_name in ('platforms', 'series_scope', 'model_no', 'language')),
      '(keine)'),
  (703, 'Vorbedingung', 'Spalten von skylanders heute',
      (select string_agg(column_name, ', ' order by ordinal_position)
         from information_schema.columns
        where table_schema = 'public' and table_name = 'skylanders'), null),

  -- --------------------------------- Was ohne Katalogbezug gekauft wurde
  (801, 'ohne sky_id', 'Einkaufspositionen ohne Katalogbezug / verschiedene Rohnamen',
      (select count(*)::text from public.purchase_items where sky_id is null) || ' / ' ||
      (select count(distinct coalesce(raw_name, '(ohne Namen)'))::text
         from public.purchase_items where sky_id is null), null),
  (802, 'ohne sky_id', 'davon mit "portal" im Rohnamen (Kandidaten, NIE automatisch)',
      (select count(*)::text from public.purchase_items
        where sky_id is null and raw_name ilike '%portal%'), null)
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
