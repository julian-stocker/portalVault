-- ===========================================================================
-- Zustand NACH 0138 — rein lesend
--
-- WAS DIESE DATEI BEWEISEN MUSS
--
--   1. Die 21 Portale stehen im Katalog — mit genau den SKY-IDs der
--      Arbeitsmappe, mit dem Rohnamen aus Spalte B, als `portal`, unsichtbar,
--      preislos, ohne Override, `source = admin`.
--   2. Und sie sind WEDER sammelbar NOCH shopfaehig, und zwar aus zwei
--      unabhaengigen Gruenden: die Kategorie steht in
--      `non_collectible_categories()`, und der Artikeltyp ist nicht `figure`.
--      Beide werden getrennt gefragt — ein Riegel, der nur haelt, weil der
--      andere haelt, ist kein Riegel.
--   3. Die Zahlen, die Nutzer kennen, haben sich NICHT bewegt: Angebote,
--      Abdruck der Angebotsliste, shopfaehige Zeilen, Nenner des
--      Fortschritts insgesamt und je Serie, die Overrides.
--   4. `sky_id_seq` steht, wo sie stand. 21 uebernommene Nummern brauchen
--      keine Ausgabe.
--
-- DIE SOLLWERTE DES Z0-VERTRAGS SIND DIESELBEN WIE IM PREFLIGHT. Das ist die
-- Aussage: diese Migration bewegt keinen davon. Eine Zahl, die sich zwischen
-- den beiden Fluegen aendert, ist ein Befund.
--
-- NUR LESEN. Ein einziges SELECT. Zeile 9999 muss 0 zeigen.
--
--   begin;
--   select set_config('skyisles.z0', 'staging', true);   -- oder 'keine'
--   \i supabase/checks/0138_postflight.sql
--   rollback;
-- ===========================================================================

with erwartet (sky_id, name, serie) as (values
  -- Die Liste aus der Migration, noch einmal und unabhaengig davon. Steht sie
  -- nur an einer Stelle, prueft der Postflight die Migration gegen sich
  -- selbst — und das ist keine Pruefung.
  ('SKY-0615', '84157790 (SA)',           'SA'),
  ('SKY-0616', '83973080 (SA)',           'SA'),
  ('SKY-0617', '83973080A Wireless (SA)', 'SA'),
  ('SKY-0618', '0000502 (G)',             'G'),
  ('SKY-0619', '0000547 (SF)',            'SF'),
  ('SKY-0620', '0000586 (T)',             'T'),
  ('SKY-0621', '0000655 (SC)',            'SC'),
  ('SKY-0622', '0000726 (I)',             'I'),
  ('SKY-0624', '84151790 (SA)',           'SA'),
  ('SKY-0625', '84392790 (G)',            'G'),
  ('SKY-0626', '84392080 (G)',            'G'),
  ('SKY-0627', '84704790 (SF)',           'SF'),
  ('SKY-0628', '87031790 (T)',            'T'),
  ('SKY-0629', '87504790 (SC)',           'SC'),
  ('SKY-0630', '84704791 (I)',            'I'),
  ('SKY-0632', '84709790 (SF)',           'SF'),
  ('SKY-0633', '87036790 (T)',            'T'),
  ('SKY-0634', '87506790 (SC)',           'SC'),
  ('SKY-0635', '84154080 (SA)',           'SA'),
  ('SKY-0636', '84394790 (G)',            'G'),
  ('SKY-0637', '84721790 (SF, T, SC)',    'SF')
),
sammelbar as (
  select s.sky_id, s.series_code
    from public.skylanders s
    join public.categories c on c.id = s.category_id
   where s.is_active and s.catalog_visible
     and not (c.name = any (public.non_collectible_categories()))
),
vertrag as (
  select nullif(btrim(coalesce(current_setting('skyisles.z0', true), '')), '') as modus
),
z0 (schluessel, wert) as (values
  ('shopfaehig',   '534'),
  ('angebote',     '256'),
  ('angebote_md5', '4d1d6c30fe0ae886ca2689bcb1fe9634'),
  ('sammelbar',    '534'),
  ('spiele_overrides', '39')
),
soll as (
  select z.schluessel,
         case when (select v.modus from vertrag v) = 'staging' then z.wert end as wert
    from z0 z
),

pruef (nr, bereich, pruefung, befund, erwartet) as (values

  -- -------------------------------------------- Die 21 Zeilen sind da
  (101, 'Portale', 'alle 21 erwarteten SKY-IDs stehen im Katalog',
      (select count(*)::text from erwartet e
         join public.skylanders s on s.sky_id = e.sky_id), '21'),
  (102, 'Portale', 'und im ZB-Bereich steht genau diese 21 und nichts sonst',
      (select count(*)::text from public.skylanders
        where sky_id between 'SKY-0615' and 'SKY-0642'), '21'),
  (103, 'Portale', 'die beiden Disney-Infinity-Nummern sind NICHT angelegt',
      (select count(*)::text from public.skylanders
        where sky_id in ('SKY-0623', 'SKY-0631')), '0'),
  (104, 'Portale', 'die Beleg-URL und die vier Bundles/Taschen sind NICHT angelegt',
      (select count(*)::text from public.skylanders
        where sky_id in ('SKY-0638', 'SKY-0639', 'SKY-0640',
                         'SKY-0641', 'SKY-0642')), '0'),
  (105, 'Portale', 'der Rohname ist zeichengleich zur Arbeitsmappe',
      (select count(*)::text from erwartet e
         join public.skylanders s on s.sky_id = e.sky_id
        where s.name <> e.name), '0'),
  (106, 'Portale', 'die Serie ist die der Liste (SKY-0637 traegt SF)',
      (select count(*)::text from erwartet e
         join public.skylanders s on s.sky_id = e.sky_id
        where s.series_code <> e.serie), '0'),
  (107, 'Portale', 'SKY-0637 heisst weiter nach allen drei Serien',
      (select s.name from public.skylanders s where s.sky_id = 'SKY-0637'),
      '84721790 (SF, T, SC)'),
  (108, 'Portale', 'alle 21 tragen item_type = portal',
      (select count(*)::text from erwartet e
         join public.skylanders s on s.sky_id = e.sky_id
        where s.item_type <> 'portal'), '0'),
  (109, 'Portale', 'keines ist im oeffentlichen Katalog sichtbar',
      (select count(*)::text from erwartet e
         join public.skylanders s on s.sky_id = e.sky_id
        where s.catalog_visible), '0'),
  (110, 'Portale', 'alle 21 sind aktiv — sonst waeren sie im Einkauf nicht waehlbar',
      (select count(*)::text from erwartet e
         join public.skylanders s on s.sky_id = e.sky_id
        where s.is_active), '21'),
  (111, 'Portale', 'kein Preis, kein Override, kein Bild, kein Charakter',
      (select count(*)::text from erwartet e
         join public.skylanders s on s.sky_id = e.sky_id
        where s.market_price is not null or s.display_name_override is not null
           or s.image_file is not null or s.character_id is not null), '0'),
  (112, 'Portale', 'source = admin — der Katalogimport meldet sie nicht als verschwunden',
      (select count(*)::text from erwartet e
         join public.skylanders s on s.sky_id = e.sky_id
        where s.source <> 'admin'), '0'),
  (113, 'Portale', '21 verschiedene Slugs, keiner doppelt',
      (select count(distinct s.slug)::text from erwartet e
         join public.skylanders s on s.sky_id = e.sky_id), '21'),
  (114, 'Portale', 'card_type ist standard — der Figurenvariantentyp wird nicht zweckentfremdet',
      (select count(*)::text from erwartet e
         join public.skylanders s on s.sky_id = e.sky_id
        where s.card_type <> 'standard'), '0'),

  -- ------------------------------------------------ Die Kategorie je Serie
  (201, 'Kategorie', 'eine Kategorie "Portale" je Serie mit Portalen (6)',
      (select count(*)::text from public.categories where name = 'Portale'), '6'),
  (202, 'Kategorie', 'jedes Portal steht in einer Kategorie "Portale"',
      (select count(*)::text from erwartet e
         join public.skylanders s on s.sky_id = e.sky_id
         join public.categories c on c.id = s.category_id
        where c.name <> 'Portale'), '0'),
  (203, 'Kategorie', 'und in der Kategorie SEINER Serie (zusammengesetzter Fremdschluessel)',
      (select count(*)::text from erwartet e
         join public.skylanders s on s.sky_id = e.sky_id
         join public.categories c on c.id = s.category_id
        where c.series_code <> s.series_code), '0'),
  (204, 'Kategorie', 'catalog_group bleibt NULL, wie bei den Spiele-Kategorien',
      (select count(*)::text from public.categories
        where name = 'Portale' and catalog_group is not null), '0'),
  (205, 'Kategorie', 'Ableitung und gespeicherter Artikeltyp stimmen ueberein',
      (select count(*)::text from erwartet e
         join public.skylanders s on s.sky_id = e.sky_id
         join public.categories c on c.id = s.category_id
        where public.catalog_item_type_for_category(c.name) <> s.item_type), '0'),

  -- ---------------------------------- Kein Portal ist sammelbar oder Ware
  (301, 'Riegel 1', 'kein Portal steht in einer sammelbaren Kategorie',
      (select count(*)::text from erwartet e
         join public.skylanders s on s.sky_id = e.sky_id
         join public.categories c on c.id = s.category_id
        where not (c.name = any (public.non_collectible_categories()))), '0'),
  (302, 'Riegel 2', 'kein Portal ist shopfaehig (is_shop_eligible am Artikeltyp)',
      (select count(*)::text from erwartet e
        where public.is_shop_eligible(e.sky_id)), '0'),
  (303, 'Riegel 2', 'und keines steht im oeffentlichen Angebot',
      (select count(*)::text from public.shop_offers() o
         join erwartet e on e.sky_id = o.sky_id), '0'),
  (304, 'Riegel', 'kein Portal zaehlt in den Fortschrittsnenner',
      (select count(*)::text from sammelbar b join erwartet e on e.sky_id = b.sky_id), '0'),

  -- -------------------------------------------------- Das Entstehungsjournal
  (401, 'Journal', '21 Eintraege created, einer je Zeile',
      (select count(*)::text from public.catalog_admin_changes j
         join erwartet e on e.sky_id = j.entity_id
        where j.entity = 'skylander' and j.field = 'created'), '21'),
  (402, 'Journal', 'changed_by ist NULL — die Zeilen kamen ueber ein Skript',
      (select count(*)::text from public.catalog_admin_changes j
         join erwartet e on e.sky_id = j.entity_id
        where j.entity = 'skylander' and j.field = 'created'
          and j.changed_by is not null), '0'),

  -- ------------------------------------ Und nichts anderes hat sich bewegt
  (501, 'Unveraendert', 'Katalogzeilen (Preflight 401 + 21)',
      (select count(*)::text from public.skylanders), null),
  (502, 'Unveraendert', 'shopfaehige Zeilen (= Preflight 402)',
      (select count(*)::text from public.skylanders s
        where public.is_shop_eligible(s.sky_id)), null),
  (503, 'Unveraendert', 'oeffentliche Angebote (= Preflight 403)',
      (select count(*)::text from public.shop_offers()), null),
  (504, 'Unveraendert', 'md5 der Angebotsliste (= Preflight 404)',
      (select md5(coalesce(string_agg(o.sky_id || '|' || o.condition || '|'
                                      || coalesce(o.price::text, ''),
                                      ';' order by o.sky_id, o.condition), ''))
         from public.shop_offers() o), null),
  (505, 'Unveraendert', 'sammelbare Zeilen (= Preflight 405)',
      (select count(*)::text from sammelbar), null),
  (506, 'Unveraendert', 'sammelbar je Serie (= Preflight 406)',
      (select coalesce(string_agg(x.series_code || '=' || x.n::text, ',' order by x.series_code), '')
         from (select series_code, count(*) as n from sammelbar group by series_code) x), null),
  (507, 'Unveraendert', 'Artikeltypverteilung (Preflight 407, portal + 21)',
      (select coalesce(string_agg(x.item_type || '=' || x.n::text, ',' order by x.item_type), '')
         from (select s.item_type, count(*) as n
                 from public.skylanders s group by s.item_type) x), null),
  (508, 'Unveraendert', 'md5 der display_name_override (= Preflight 408)',
      (select md5(coalesce(string_agg(s.sky_id || '|' || s.display_name_override,
                                      ';' order by s.sky_id), ''))
         from public.skylanders s where s.display_name_override is not null), null),
  (509, 'Unveraendert', 'Stand von sky_id_seq (= Preflight 409)',
      coalesce((select q.last_value::text from pg_sequences q
                 where q.schemaname = 'public' and q.sequencename = 'sky_id_seq'),
               '(unbekannt)'), null),
  (510, 'Unveraendert', 'Einkaufspositionen ohne sky_id (= Preflight 501)',
      (select count(*)::text from public.purchase_items where sky_id is null), null),
  (511, 'Unveraendert', 'Lagerzeilen insgesamt (= Preflight 503)',
      (select count(*)::text from public.shop_inventory), null),
  /* Eine Bewegung haengt an der Lagerzeile und nicht an der SKY-ID; der Weg
     dorthin geht ueber `inventory_id`. */
  (512, 'Unveraendert', 'kein Portal hat einen Bestand oder eine Bewegung',
      (select ((select count(*) from public.shop_inventory i
                 join erwartet e on e.sky_id = i.sky_id)
             + (select count(*) from public.inventory_movements m
                 join public.shop_inventory i on i.id = m.inventory_id
                 join erwartet e on e.sky_id = i.sky_id))::text), '0'),

  -- ------------------------------------------------------ Der Z0-Vertrag
  (901, 'Z0-Vertrag', 'gewaehlter Modus (Messung ohne Sollwert)',
      (select coalesce(v.modus, 'FEHLT') from vertrag v), null),
  (902, 'Z0-Vertrag', 'der Modus ist gewaehlt — staging oder ausdruecklich keine',
      (select case when v.modus in ('staging', 'keine') then 'ja'
                   else 'nein: set_config(''skyisles.z0'', ''staging'', true) fehlt'
              end from vertrag v), 'ja'),
  (911, 'Z0-Vertrag', 'shopfaehige Zeilen = Z0 (534)',
      (select count(*)::text from public.skylanders s
        where public.is_shop_eligible(s.sky_id)),
      (select wert from soll where schluessel = 'shopfaehig')),
  (912, 'Z0-Vertrag', 'oeffentliche Angebote = Z0 (256)',
      (select count(*)::text from public.shop_offers()),
      (select wert from soll where schluessel = 'angebote')),
  (913, 'Z0-Vertrag', 'Abdruck der Angebotsliste = Z0 (4d1d6c30...9634)',
      (select md5(coalesce(string_agg(o.sky_id || '|' || o.condition || '|'
                                      || coalesce(o.price::text, ''),
                                      ';' order by o.sky_id, o.condition), ''))
         from public.shop_offers() o),
      (select wert from soll where schluessel = 'angebote_md5')),
  (914, 'Z0-Vertrag', 'sammelbare Artikel = Z0 (534) — 21 Portale aendern daran NICHTS',
      (select count(*)::text from sammelbar),
      (select wert from soll where schluessel = 'sammelbar')),
  (915, 'Z0-Vertrag', 'Spiele-Zeilen mit display_name_override = Z0 (39)',
      (select count(*)::text from public.skylanders s
         join public.categories c on c.id = s.category_id
        where c.name = 'Spiele' and s.display_name_override is not null),
      (select wert from soll where schluessel = 'spiele_overrides'))
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
