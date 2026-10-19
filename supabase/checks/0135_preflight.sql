-- ===========================================================================
-- Eingangszustand vor 0135 — rein lesend
--
-- `0135` fuehrt `skylanders.item_type` ein, markiert die Spiele und haengt die
-- Shop-Eignung an den Artikeltyp. Diese Datei prueft die Vorbedingungen und
-- nimmt die Bezugswerte, gegen die der Postflight vergleicht.
--
-- DIE DREI ZAHLEN, DIE ZAEHLEN: 601 (shopfaehig), 602 (Angebote) und 603
-- (`md5` der Angebotsliste). Sie muessen nach der Migration IDENTISCH sein.
-- Die Migration prueft das selbst innerhalb ihrer Transaktion; diese Datei
-- macht es ausserdem von aussen nachvollziehbar.
--
-- NUR LESEN. Ein einziges SELECT. Zeile 9999 muss 0 zeigen.
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
 * DER Z0-VERTRAG — DIE WERTE STEHEN HIER, GEWAEHLT WIRD NUR DER MODUS
 *
 * Z0 hat am 2026-10-19 auf Staging gemessen: 534 shopfaehige Zeilen, 256
 * oeffentliche Angebote, Abdruck `4d1d6c30fe0ae886ca2689bcb1fe9634`, 534
 * sammelbare Artikel, 39 `display_name_override`
 * (`supabase/checks/open_verifications.md`, Abschnitt 0f).
 *
 * WARUM DIE ZAHLEN IM CODE STEHEN UND NICHT EINGETIPPT WERDEN. Ein Sollwert,
 * den der Bediener bei jedem Lauf mitliefert, ist bei jedem Lauf eine neue
 * Gelegenheit fuer einen Tippfehler — und ein Tippfehler in der Erwartung
 * laesst die Pruefung bestehen. Die Werte sind versioniert, pruefsummiert und
 * nachlesbar; gewaehlt wird nur, OB sie gelten.
 *
 * WARUM SIE TROTZDEM NICHT BEDINGUNGSLOS GELTEN. Production fuehrt andere
 * Zahlen. Dieselbe Datei muss dort laufen koennen, ohne fuenf Fehlalarme zu
 * melden — eine umgebungsblinde Erwartung war in diesem Projekt schon zweimal
 * die Ursache eines falschen Befundes (`0132`-Readiness Zeile 602,
 * `0124`-Preflight Zeile 106).
 *
 * UND WARUM DAS VERGESSEN AUFFAELLT. Fehlt der Modus, ist Pruefung 902
 * blockierend. Es gibt damit keinen Lauf, der die fuenf Werte STILL
 * uebergeht: entweder sie werden geprueft, oder der Verzicht steht als
 * ausdrueckliche Wahl im Protokoll.
 *
 *   -- auf Staging, in DERSELBEN Klammer wie diese Datei:
 *   select set_config('skyisles.z0', 'staging', true);
 *
 *   -- anderswo, als ausdruecklicher Verzicht:
 *   select set_config('skyisles.z0', 'keine', true);
 *
 * `current_setting(..., true)` ist die nachsichtige Form: sie wirft nicht,
 * wenn der Parameter fehlt. `set_config(..., true)` gilt transaktionslokal —
 * die `set`-Zeile und diese Datei muessen deshalb GEMEINSAM in einer Klammer
 * laufen.
 *
 * NICHT IM VERTRAG, weil Z0 sie nicht als Zahl festgehalten hat: der Nenner
 * JE SERIE und der `md5` der Overrides. Beide vergleicht der Postflight gegen
 * das Preflight-Raster, und die Migration prueft beide in ihrer eigenen
 * Transaktion — das ist die strengere der zwei Pruefungen.
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
  /*
   * DIE OVERRIDES: DIE ZAHL IST SPIELE-BEZOGEN, NICHT KATALOGWEIT.
   *
   * Z0 zaehlte „39, alle mit display_name_override" INNERHALB der Kategorie
   * `Spiele`. Der erste Entwurf dieses Vertrags las das als katalogweite
   * Gesamtzahl — und das Staging-Skript brach am 2026-10-19 mit „overrides
   * ist 53, erwartet 39" ab. Katalogweit tragen auch Figuren einen
   * redaktionellen Anzeigenamen; eine katalogweite Zahl hat Z0 nie
   * festgehalten. Geprueft wird deshalb die belegte Aussage.
   *
   * Die katalogweite Zahl bleibt als MESSUNG (Zeile 203) und ihr `md5` als
   * Abdruck (204) — beides vergleicht der Postflight gegen das
   * Preflight-Raster, und die Migration prueft den Abdruck in ihrer eigenen
   * Transaktion. Dort ist er die strengere Pruefung.
   */
  ('spiele_overrides', '39')
),
soll as (
  -- Im Modus `staging` ist der Wert ein Sollwert, sonst NULL — und eine Zeile
  -- mit NULL-Erwartung ist in diesen Dateien eine Messung ohne Bewertung.
  select z.schluessel,
         case when (select v.modus from vertrag v) = 'staging' then z.wert end as wert
    from z0 z
),

pruef (nr, bereich, pruefung, befund, erwartet) as (values

  (1, 'Umgebung', 'Info: vorhandene Testfiguren (SKY-9000 und hoeher)',
      coalesce((select string_agg(s.sky_id, ', ' order by s.sky_id)
                  from public.skylanders s where s.sky_id >= 'SKY-9000'), '(keine)'), null),

  -- ----------------------------------------------------- Vorbedingungen
  (101, 'Grundlage', 'skylanders ist da',
      (to_regclass('public.skylanders') is not null)::text, 'true'),
  (102, 'Grundlage', 'is_shop_eligible(text) ist da (0008)',
      (to_regprocedure('public.is_shop_eligible(text)') is not null)::text, 'true'),
  (103, 'Grundlage', 'non_collectible_categories() ist da und nennt nur Spiele',
      (select array_to_string(public.non_collectible_categories(), ',')), 'Spiele'),
  (104, 'Grundlage', 'Spalte item_type fehlt noch',
      (select (count(*) = 0)::text from information_schema.columns
        where table_schema = 'public' and table_name = 'skylanders'
          and column_name = 'item_type'), 'true'),
  (105, 'Grundlage', 'CHECK skylanders_item_type_known fehlt noch',
      (select (count(*) = 0)::text from pg_constraint
        where conname = 'skylanders_item_type_known'), 'true'),
  (106, 'Grundlage', 'Kategorie "Spiele" existiert (Zahl je Serie)',
      (select count(*)::text from public.categories where name = 'Spiele'), null),
  (107, 'Grundlage', 'is_shop_eligible prueft item_type NOCH NICHT',
      (select (position('item_type' in p.prosrc) = 0)::text from pg_proc p
        where p.oid = to_regprocedure('public.is_shop_eligible(text)')), 'true'),

  (112, 'Grundlage', 'Info: Stand der Betriebssicherung (0131 oder 0136)',
      (select case md5(p.prosrc)
                when '24c3810288bb20929fe995554a267adf' then 'STAND_0131'
                when 'f6d08440707ba72a8040a8d1e666c092' then 'STAND_0136 (item_type im Export)'
                else 'UNBEKANNT: ' || md5(p.prosrc) end
         from pg_proc p where p.oid = to_regprocedure('public.seller_business_backup()')), null),

  -- ------------------------------------------------- Der Backfill-Umfang
  (201, 'Backfill', 'Zeilen der Kategorie Spiele — werden game',
      (select count(*)::text from public.skylanders s
         join public.categories c on c.id = s.category_id
        where c.name = 'Spiele'), null),
  (202, 'Backfill', 'Katalogzeilen insgesamt (muss gleich bleiben)',
      (select count(*)::text from public.skylanders), null),
  (203, 'Backfill', 'Zeilen mit display_name_override',
      (select count(*)::text from public.skylanders
        where display_name_override is not null), null),
  (204, 'Backfill', 'ABDRUCK: md5 ueber alle display_name_override',
      (select md5(coalesce(string_agg(s.sky_id || '=' || s.display_name_override,
                                      ';' order by s.sky_id), ''))
         from public.skylanders s where s.display_name_override is not null), null),

  -- -------------------------------------- SKY-ID-Bereiche (Importannahmen)
  -- Der ZB-Bereich ist ein LOCH im historischen Bereich, nicht ein Anhang
  -- hinter der hoechsten ID. Eine Vergabe nach „Maximum plus eins" waere
  -- deshalb falsch; Z3 setzt genau die 21 IDs der Arbeitsmappe.
  (301, 'SKY-Bereiche', 'historisch SKY-0001..SKY-0820 / produktiv SKY-0821..SKY-8999 / Fixtures ab SKY-9000',
      (select count(*)::text from public.skylanders where sky_id <= 'SKY-0820') || ' / ' ||
      (select count(*)::text from public.skylanders
        where sky_id between 'SKY-0821' and 'SKY-8999') || ' / ' ||
      (select count(*)::text from public.skylanders where sky_id >= 'SKY-9000'), null),
  (302, 'SKY-Bereiche', 'hoechste SKY-ID unter SKY-9000',
      (select max(sky_id) from public.skylanders where sky_id < 'SKY-9000'), null),
  (303, 'SKY-Bereiche', 'belegte IDs im ZB-Bereich SKY-0615..SKY-0642 (muss 0 sein)',
      (select count(*)::text from public.skylanders
        where sky_id between 'SKY-0615' and 'SKY-0642'), '0'),
  (304, 'SKY-Bereiche', 'IDs zwischen SKY-0643 und SKY-0820',
      (select count(*)::text from public.skylanders
        where sky_id between 'SKY-0643' and 'SKY-0820'), null),

  -- ------------------------------------------- Die Abdruecke des Shops
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
  (605, 'Shop', 'Spiele im oeffentlichen Angebot (muss 0 sein)',
      (select count(*)::text from public.shop_offers() ofr
        where ofr.sky_id in (select s.sky_id from public.skylanders s
                               join public.categories c on c.id = s.category_id
                              where c.name = 'Spiele')), '0'),

  -- ---------------------------------------- Der Fortschritt von heute
  (701, 'Fortschritt', 'ABDRUCK: sammelbare Artikel (Nenner)',
      (select count(*)::text from sammelbar), null),
  (702, 'Fortschritt', 'ABDRUCK: Nenner je Serie',
      coalesce((select string_agg(x.series_code || '=' || x.n::text, ',' order by x.series_code)
                  from (select series_code, count(*) as n from sammelbar
                         group by series_code) x), ''), null),
  (703, 'Fortschritt', 'Sammlungszeilen insgesamt',
      (select count(*)::text from public.collection_items), null),

  -- ----------------------------------------------------- Unberuehrt
  (801, 'Unberuehrt', 'Lagerzeilen / Einheiten / Bewegungen',
      (select count(*)::text from public.shop_inventory) || ' / ' ||
      (select coalesce(sum(quantity), 0)::text from public.shop_inventory) || ' / ' ||
      (select count(*)::text from public.inventory_movements), null),
  (802, 'Unberuehrt', 'Eigenbelege / Einkaufspositionen ohne sky_id',
      (select count(*)::text from public.purchase_receipts) || ' / ' ||
      (select count(*)::text from public.purchase_items where sky_id is null), null)

,

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
  (916, 'Z0-Vertrag', 'Info: Zeilen mit display_name_override KATALOGWEIT (kein Z0-Wert)',
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
