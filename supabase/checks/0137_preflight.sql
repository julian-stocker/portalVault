-- ===========================================================================
-- Zustand VOR 0137 — rein lesend
--
-- WAS DIESE DATEI BEANTWORTET
--
--   1. Steht alles, was `0137` voraussetzt? `0135` vollstaendig — Spalte,
--      Ableitungsfunktion, Trigger —, `0006`, `0117`, `0033`, `0042`.
--   2. Ist der Zustand so, dass der Beweis der Migration gelingen KANN? Die
--      vier neuen Zubehoerkategorien duerfen heute keine Zeile tragen; sonst
--      waere die Erweiterung von `non_collectible_categories()` eine
--      stillschweigende Entfernung aus Sammlung und Shop.
--   3. Die Abdruecke, gegen die der Postflight Zeichen fuer Zeichen
--      vergleicht: Angebote, Nenner, Artikeltypverteilung, Zeilenzahl.
--   4. Der Z0-Vertrag. `0137` darf KEINEN dieser fuenf Werte bewegen — vorher
--      wie nachher dieselbe Erwartung, in beiden Dateien.
--
-- NICHT IN `staging-suite.json`, UND ZWAR AUS EINEM GRUND
--
-- Diese Datei RUFT `catalog_item_type_for_category()` auf, statt ihren Rumpf
-- zu lesen — das ist die stärkere Prüfung, aber `0135` hat `execute` darauf
-- jeder API-Rolle entzogen (`revoke all ... from public, anon, authenticated,
-- service_role`). Die rein lesende Prüfrolle aus Phase A kann sie deshalb
-- nicht ausführen. Die Datei gehört zum manuellen Lauf im SQL-Editor, wie
-- `supabase/operations/staging-0137.sql`, und wird von
-- `npm run verify:check-sql` trotzdem gegen echtes PostgreSQL geplant.
--
-- NUR LESEN. Ein einziges SELECT, keine Schreiboperation, kein `set` ausser
-- dem transaktionslokalen Vertragsschalter. Zeile 9999 muss 0 zeigen.
--
-- DER VERTRAGSSCHALTER muss in DERSELBEN Klammer stehen wie diese Datei:
--
--   begin;
--   select set_config('skyisles.z0', 'staging', true);   -- oder 'keine'
--   \i supabase/checks/0137_preflight.sql
--   rollback;
-- ===========================================================================

with sammelbar as (
  select s.sky_id, s.series_code
    from public.skylanders s
    join public.categories c on c.id = s.category_id
   where s.is_active and s.catalog_visible
     and not (c.name = any (public.non_collectible_categories()))
),
/*
 * ---------------------------------------------------------------------------
 * DER Z0-VERTRAG — die Werte stehen hier, gewaehlt wird nur der Modus.
 * Wortgleich mit `0135_postflight.sql`; dieselbe Begruendung, dieselben
 * Zahlen, einschliesslich der Korrektur vom 2026-10-19 („overrides ist 53,
 * erwartet 39" — Z0 zaehlte INNERHALB der Kategorie `Spiele`).
 * ---------------------------------------------------------------------------
 */
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

  -- ----------------------------------------------------- Vorbedingungen
  (101, 'Grundlage', 'skylanders ist da (0001)',
      (to_regclass('public.skylanders') is not null)::text, 'true'),
  (102, 'Grundlage', 'categories und series sind da (0001)',
      (to_regclass('public.categories') is not null
       and to_regclass('public.series') is not null)::text, 'true'),
  (103, 'Grundlage', 'Spalte item_type steht (0135)',
      (select (count(*) = 1)::text from information_schema.columns
        where table_schema = 'public' and table_name = 'skylanders'
          and column_name = 'item_type' and is_nullable = 'NO'), 'true'),
  (104, 'Grundlage', 'catalog_item_type_for_category(text) ist da (0135)',
      (to_regprocedure('public.catalog_item_type_for_category(text)') is not null)::text, 'true'),
  (105, 'Grundlage', 'der Trigger skylanders_item_type_from_category steht (0135)',
      (select (count(*) = 1)::text from pg_trigger
        where tgname = 'skylanders_item_type_from_category'
          and tgrelid = 'public.skylanders'::regclass), 'true'),
  (106, 'Grundlage', 'is_shop_eligible prueft item_type = figure (0135)',
      (select (position('s.item_type = ''figure''' in p.prosrc) > 0)::text from pg_proc p
        where p.oid = to_regprocedure('public.is_shop_eligible(text)')), 'true'),
  (107, 'Grundlage', 'seller_import_catalog() ist da (0052/0117)',
      (to_regprocedure('public.seller_import_catalog()') is not null)::text, 'true'),
  (108, 'Grundlage', 'next_figure_slug und sky_id_seq sind da (0033)',
      (to_regprocedure('public.next_figure_slug(text, text, text)') is not null
       and to_regclass('public.sky_id_seq') is not null)::text, 'true'),
  (109, 'Grundlage', 'catalog_admin_changes ist da (0004)',
      (to_regclass('public.catalog_admin_changes') is not null)::text, 'true'),
  (110, 'Grundlage', 'can_operate_active_seller() ist da (0042)',
      (to_regprocedure('public.can_operate_active_seller()') is not null)::text, 'true'),

  -- --------------------------------------------------- Der Vorzustand
  (201, 'Vorzustand', 'non_collectible_categories() nennt NUR Spiele',
      (select array_to_string(public.non_collectible_categories(), ',')), 'Spiele'),
  (202, 'Vorzustand', 'Kategorie Portale leitet noch auf figure ab',
      public.catalog_item_type_for_category('Portale'), 'figure'),
  (203, 'Vorzustand', 'Kategorie Spiele leitet schon auf game ab',
      public.catalog_item_type_for_category('Spiele'), 'game'),
  (204, 'Vorzustand', 'seller_create_catalog_item FEHLT noch',
      (to_regprocedure('public.seller_create_catalog_item(text, text, text)') is null)::text, 'true'),
  (205, 'Vorzustand', 'seller_import_catalog liefert 7 Spalten, ohne item_type',
      (select coalesce(string_agg(a.name, ',' order by a.ord), '(keine)')
         from (select unnest(p.proargnames) as name,
                      generate_subscripts(p.proargnames, 1) as ord
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'seller_import_catalog') a),
      'sky_id,name,series_code,category,display_name,catalog_visible,is_active'),

  -- ------------------------------------- Was die Migration voraussetzt
  (301, 'Bedingung', 'KEINE Zeile in Portale/Bundles/Taschen/Zubehoer (muss 0 sein)',
      (select count(*)::text from public.skylanders s
         join public.categories c on c.id = s.category_id
        where c.name in ('Portale', 'Bundles', 'Taschen', 'Zubehör')), '0'),
  (302, 'Bedingung', 'Info: Kategorien mit einem dieser vier Namen',
      coalesce((select string_agg(c.series_code || '/' || c.name, ', '
                                  order by c.series_code, c.name)
                  from public.categories c
                 where c.name in ('Portale', 'Bundles', 'Taschen', 'Zubehör')), '(keine)'), null),
  (303, 'Bedingung', 'Info: Katalogzeilen, deren Name auf ein Portal hindeutet',
      (select count(*)::text from public.skylanders s
        where s.name ilike '%portal%'), null),
  /* KEIN Lesen von `sky_id_seq`: eine Sequenz braucht ein eigenes Recht, und
     diese Datei soll der rein lesenden Pruefrolle genuegen. Die hoechste
     vergebene ID im produktiven Bereich sagt dasselbe fuer das Protokoll. */
  (304, 'Bedingung', 'Info: hoechste SKY-ID unter SKY-9000',
      coalesce((select max(sky_id) from public.skylanders
                 where sky_id < 'SKY-9000'), '(keine)'), null),
  (305, 'Bedingung', 'die Luecke SKY-0615..0642 ist frei (Z3 gehoert sie)',
      (select count(*)::text from public.skylanders
        where sky_id between 'SKY-0615' and 'SKY-0642'), '0'),

  -- ---------------------------------------- Abdruecke fuer den Vergleich
  (601, 'Shop', 'ABDRUCK: shopfaehige Zeilen (muss nachher gleich sein)',
      (select count(*)::text from public.skylanders s
        where public.is_shop_eligible(s.sky_id)), null),
  (602, 'Shop', 'ABDRUCK: oeffentliche Angebote',
      (select count(*)::text from public.shop_offers()), null),
  (603, 'Shop', 'ABDRUCK: md5 der Angebotsliste (sky_id|condition|price)',
      (select md5(coalesce(string_agg(o.sky_id || '|' || o.condition || '|'
                                      || coalesce(o.price::text, ''),
                                      ';' order by o.sky_id, o.condition), ''))
         from public.shop_offers() o), null),
  (604, 'Shop', 'shopfaehige Zeilen, die keine Figur sind (muss 0 sein)',
      (select count(*)::text from public.skylanders s
         join public.categories c on c.id = s.category_id
        where public.is_shop_eligible(s.sky_id)
          and c.name = any (public.non_collectible_categories())), '0'),

  (701, 'Fortschritt', 'ABDRUCK: sammelbare Artikel (Nenner)',
      (select count(*)::text from sammelbar), null),
  (702, 'Fortschritt', 'ABDRUCK: Nenner je Serie',
      coalesce((select string_agg(x.series_code || '=' || x.n::text, ',' order by x.series_code)
                  from (select series_code, count(*) as n from sammelbar
                         group by series_code) x), ''), null),
  (703, 'Fortschritt', 'ABDRUCK: Artikeltypverteilung',
      coalesce((select string_agg(x.item_type || '=' || x.n::text, ',' order by x.item_type)
                  from (select s.item_type, count(*) as n from public.skylanders s
                         group by s.item_type) x), ''), null),
  (704, 'Fortschritt', 'ABDRUCK: Katalogzeilen insgesamt',
      (select count(*)::text from public.skylanders), null),

  -- ----------------------------------------------------- Unberuehrt
  (801, 'Unberuehrt', 'Lagerzeilen / Einheiten / Bewegungen',
      (select count(*)::text from public.shop_inventory) || ' / ' ||
      (select coalesce(sum(quantity), 0)::text from public.shop_inventory) || ' / ' ||
      (select count(*)::text from public.inventory_movements), null),
  (802, 'Unberuehrt', 'Eigenbelege / Einkaufspositionen ohne sky_id',
      (select count(*)::text from public.purchase_receipts) || ' / ' ||
      (select count(*)::text from public.purchase_items where sky_id is null), null),
  (803, 'Unberuehrt', 'Einkaufspositionen auf Spiele (bleibt gleich)',
      (select count(*)::text from public.purchase_items i
         join public.skylanders s on s.sky_id = i.sky_id
        where s.item_type = 'game'), null),

  -- ------------------------------------------------- Der Z0-Vertrag
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
  (914, 'Z0-Vertrag', 'sammelbare Artikel = Z0 (534)',
      (select count(*)::text from sammelbar),
      (select wert from soll where schluessel = 'sammelbar')),
  (915, 'Z0-Vertrag', 'Spiele-Zeilen mit display_name_override = Z0 (39)',
      (select count(*)::text from public.skylanders s
         join public.categories c on c.id = s.category_id
        where c.name = 'Spiele' and s.display_name_override is not null),
      (select wert from soll where schluessel = 'spiele_overrides')),
  (916, 'Z0-Vertrag', 'Info: Overrides KATALOGWEIT (kein Z0-Wert)',
      (select count(*)::text from public.skylanders
        where display_name_override is not null), null)
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
