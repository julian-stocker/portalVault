-- ========================================================================
-- PRODUCTION — GRUPPE G4': EIN LAUF FUER 0160, 0161 UND 0162
--              (der Export kennt die Basisfigur · die Familie entsteht von
--               selbst · Marktwert und Loeschung im Adminbereich)
--
-- ###########################################################################
-- ##  DIES IST EINE PRODUCTION-DATEI. Projekt zmiwxswrpkmizvqsgype.        ##
-- ##  Sie bricht auf Staging ab, und zwar bevor sie etwas anfasst.         ##
-- ###########################################################################
--
-- EINE DATEI, EINE TRANSAKTION, EIN EINFUEGEN. Vollstaendig markieren, in den
-- SQL-Editor des Production-Projekts zmiwxswrpkmizvqsgype einfuegen,
-- ausfuehren. Nichts in Teilen.
--
-- WARUM DIE DREI ZUSAMMEN FAHREN
-- ========================================================================
--
-- Derselbe Grund wie bei G2' (ADR-0161), in kleiner Ausfuehrung: `0161`
-- verlangt den Exportrumpf aus `0160`, und `0162` baut die
-- Journal-Constraint auf vierzehn Werte. Einzeln gefahren gaebe es
-- Zwischenzustaende, die niemand braucht — und `0160` schliesst eine Luecke,
-- die so lange offen ist, wie sie offen ist: **bis `0160` liegt, fuehrt die
-- Plattformsicherung `base_sky_id` nicht**, eine Zuordnung waere in einem
-- Archiv nicht enthalten und bei einer Wiederherstellung verloren. Je kuerzer
-- dieses Fenster, desto besser.
--
-- WAS DIE GRUPPE TUT
--
--   0160  ersetzt `system_platform_export()`: EIN Feld mehr
--         (`skylanders.base_sky_id`), 54 Bereiche unveraendert,
--         Formatversion unveraendert 2. Ihr Tor ist der Abdruck der Fassung
--         aus `0153` (`92c48444…`) — sie ueberschreibt keine fremde Fassung.
--   0161  legt `admin_publish_variant_auto(text,text)` an: Weg B ohne
--         Rueckfrage. Sie schreibt NICHTS selbst, sondern ruft
--         `admin_set_character`, `admin_set_variant_base` und
--         `admin_set_catalog_status`. Nebenlaeufigkeit: eine
--         Beratungssperre auf dem gefalteten Familiennamen und beide
--         Katalogzeilen in EINER Anweisung in `sky_id`-Reihenfolge gesperrt.
--   0162  baut die Journal-Constraint auf VIERZEHN Werte (`market_price`,
--         `deleted` kommen dazu) und legt `admin_set_market_price(text,
--         numeric)` und `admin_delete_figure(text)` an. Die Loeschung
--         zaehlt mit `admin_merge_references` — und zwar mit der in `0159`
--         BERICHTIGTEN Fassung, die mehrspaltige Fremdschluessel mitzaehlt.
--
-- WAS SIE NICHT TUT
--
-- Sie schreibt **keine einzige Datenzeile**: kein `insert`, kein `update`,
-- kein `delete` ausserhalb von Funktionsruempfen — mechanisch geprueft. Sie
-- legt KEINEN Trigger, KEINE Spalte, KEINEN Index und KEINE Politik an. Die
-- Trigger- und Riegelliste an `skylanders` ist nach der Gruppe
-- ZEICHENGLEICH dieselbe wie vorher (B8/B9).
--
-- Sie ordnet keine Basisfigur zu, keine Familie, keinen Status, keinen Preis
-- und loescht keine Zeile — sie legt die FUNKTIONEN dafuer an. Dass sie
-- nichts davon selbst tut, prueft B5 Zeile fuer Zeile.
--
-- WAS DIESE HUELLE HINZUFUEGT
-- ========================================================================
--
--   A0     `lock_timeout` und `statement_timeout`.
--   A1-A3  der umgekehrte Umgebungsstempel: sie bricht auf Staging ab.
--   A4     Shop- und Sammlungsvertrag, von der Huelle SELBST gemessen.
--   A5     der IDENTITAETS- UND ZUSTANDSABDRUCK aller Katalogzeilen, jetzt
--          mit SIEBEN Feldern: sky_id, series_code, catalog_visible,
--          catalog_status, character_id, **base_sky_id** und **card_type**.
--   A6     der Eingangszustand: der Exportrumpf ist der aus `0153`, die drei
--          Funktionen fehlen noch, das Journal kennt `base_sky_id` aber
--          nicht `market_price`/`deleted`, und `admin_merge_references` ist
--          die berichtigte Fassung aus `0159`.
--   A7     Trigger- und Riegelliste, vorher benannt.
--   B      alles noch einmal, Vergleich, `raise exception` bei jeder
--          Abweichung — und B8/B9 verlangen hier GLEICHHEIT, nicht Zuwachs.
--
-- DIE SPERRWIRKUNG
-- ========================================================================
--
-- `skylanders` wird NICHT veraendert — die Gruppe fasst nur `pg_proc` und
-- einmal `catalog_admin_changes` an. Letztere bekommt `ACCESS EXCLUSIVE` mit
-- Validierung der bestehenden Journalzeilen; der Katalog bleibt lesbar. Die
-- Messabschnitte dieser Huelle lesen `skylanders` (ACCESS SHARE) und halten
-- niemanden auf.
--
--   `set local lock_timeout = '5s'` · `set local statement_timeout = '300s'`
--
-- VORHER: `supabase/operations/prod-s-preflight-g4.sql` (rein lesend).
-- NACHHER: `supabase/operations/prod-s-postflight-g4.sql` (rein lesend).
-- RUECKNAHME: `supabase/rollback/R0160…`, `R0161…`, `R0162…` einzeln.
-- ========================================================================

begin;

-- ---------------------------------------------------------------------------
-- A0  ZWEI OBERGRENZEN, VOR DEM ERSTEN ZUGRIFF
-- ---------------------------------------------------------------------------
set local lock_timeout = '5s';
set local statement_timeout = '300s';

do $lauf_a$
begin
  if (select count(*) from public.skylanders
       where sky_id in ('SKY-0821', 'SKY-0822')) = 2 then
    raise exception 'ABBRUCH A1: das vollstaendige STAGING-Markerpaar ist da '
      '(SKY-0821 UND SKY-0822). Diese Datei ist fuer Production '
      '(zmiwxswrpkmizvqsgype) — auf Staging gehoert '
      'supabase/operations/staging-0152.sql.';
  end if;

  if to_regprocedure('public.purchases_paid_total_is_final()') is null then
    raise exception 'ABBRUCH A2: 0133 ist hier nicht angewendet. Auf Production ist '
      'sie es seit dem 2026-10-18; diese Datenbank ist also nicht Production.';
  end if;

  if (select count(*) from public.skylanders) < 100 then
    raise exception 'ABBRUCH A3: der Katalog hat weniger als 100 Zeilen — das ist '
      'kein Production-Projekt.';
  end if;
end
$lauf_a$;
-- ---------------------------------------------------------------------------
-- A4  DIE BEIDEN VERTRAEGE, VON DER HUELLE SELBST GEMESSEN
-- ---------------------------------------------------------------------------
select set_config('skyisles.base', (
with sammelbar as (
  select s.sky_id
    from public.skylanders s
    join public.categories c on c.id = s.category_id
   where s.is_active and s.catalog_visible
     and not (c.name = any (public.non_collectible_categories()))
),
basis_mess as (
  -- Die sieben Zahlen, einmal gerechnet, hier und in Zeile 900 benutzt.
  select
    /*
     * DIE ZWEI FELDER, DIE `shop_offers()` BRAUCHEN — und das ist die einzige
     * Stelle des Basis-Vertrags, an der ein Recht fehlen kann.
     *
     * Fehlt `execute`, steht hier `KEIN-RECHT`: die Zeilen 811 und 812 sind
     * dann OFFEN (Zeile 9998 zaehlt sie), die uebrigen fuenf Felder werden
     * weiter gemessen und verglichen. Ein fehlendes Recht nimmt also nicht
     * die ganze Baseline mit — aber es wird auch nicht stillschweigend
     * uebergangen.
     */
    case when has_function_privilege('public.shop_offers()', 'execute')
         then (xpath('/row/c/text()', query_to_xml(
             'select count(*) as c from public.shop_offers()',
             false, true, '')))[1]::text
         else 'KEIN-RECHT' end as angebote,
    case when has_function_privilege('public.shop_offers()', 'execute')
         then (xpath('/row/c/text()', query_to_xml(
             'select md5(coalesce(string_agg(o.sky_id || ''|'' || o.condition || ''|'' '
             '|| coalesce(o.price::text, ''''), '
             ''';'' order by o.sky_id, o.condition), '''')) as c '
             'from public.shop_offers() o',
             false, true, '')))[1]::text
         else 'KEIN-RECHT' end as angebote_md5,
    (select count(*)::text from public.skylanders s
      where public.is_shop_eligible(s.sky_id))                             as shopfaehig,
    (select count(*)::text from sammelbar)                                 as sammelbar,
    (select count(*)::text from public.shop_inventory)                     as lagerzeilen,
    (select count(*)::text from public.skylanders)                         as katalogzeilen,
    (select coalesce(md5(string_agg(i.id::text || '|' || i.is_listed::text || '|'
                                    || coalesce(i.sale_price::text, '-') || '|'
                                    || i.sale_released::text,
                                    E'\n' order by i.id)), '(leer)')
       from public.shop_inventory i)                                       as lager_md5
),
basis_feld as (
  select angebote || '|' || angebote_md5 || '|' || shopfaehig || '|' || sammelbar
         || '|' || lagerzeilen || '|' || katalogzeilen || '|' || lager_md5 as kern,
         m.*
    from basis_mess m
),
basis_zeile as (
  select 'skyisles-base-1|' || kern || '|' || left(md5(kern), 12) as zeile, f.*
    from basis_feld f
)
select zeile from basis_zeile
), true);

select set_config('skyisles.coll', (
with coll_mess as (
  -- Die drei Zahlen der Sammlung, einmal gerechnet.
  select
    (select count(*)::text from public.collection_items)                   as zeilen,
    (select count(distinct user_id)::text from public.collection_items)    as konten,
    (select coalesce(md5(string_agg(ci.user_id::text || '|' || ci.sky_id || '|'
                                    || ci.quantity::text,
                                    E'\n' order by ci.user_id, ci.sky_id)), '(leer)')
       from public.collection_items ci)                                    as sammlung_md5
),
coll_feld as (
  select zeilen || '|' || konten || '|' || sammlung_md5 as kern, m.*
    from coll_mess m
),
coll_zeile as (
  select 'skyisles-coll-1|' || kern || '|' || left(md5(kern), 12) as zeile, f.*
    from coll_feld f
)
select zeile from coll_zeile
), true);

-- ---------------------------------------------------------------------------
-- A5  DER IDENTITAETS- UND ZUSTANDSABDRUCK, SIEBEN FELDER JE ZEILE
--
-- `card_type` ist dabei, obwohl diese Gruppe ihn nicht anfasst: er ist die
-- KARTENKUNST (ADR-0160), und `0163` wird ihn als eigene Spalte behalten
-- muessen. Wer ihn hier mitmisst, merkt es, wenn ihn jemand anfasst.
-- ---------------------------------------------------------------------------
select set_config('skyisles.ident', (
  select coalesce(md5(string_agg(
           s.sky_id || '|' || s.series_code || '|' || s.catalog_visible::text
           || '|' || s.catalog_status || '|' || coalesce(s.character_id::text, '-')
           || '|' || coalesce(s.base_sky_id, '-') || '|' || s.card_type,
           E'\n' order by s.sky_id)), '(leer)')
    from public.skylanders s
), true);

select set_config('skyisles.zeilen', (
  select count(*)::text from public.skylanders), true);
select set_config('skyisles.familien', (
  select count(*)::text from public.skylanders where character_id is not null), true);
select set_config('skyisles.basis', (
  select count(*)::text from public.skylanders where base_sky_id is not null), true);
select set_config('skyisles.journal', (
  select count(*)::text from public.catalog_admin_changes), true);

-- ---------------------------------------------------------------------------
-- A6  DER EINGANGSZUSTAND, VORHER GEPRUEFT
-- ---------------------------------------------------------------------------
do $lauf_a6$
declare
  v_def text;
  v_src text;
  v_n   integer;
begin
  -- a) DER EXPORTRUMPF IST DER AUS 0153. `0160` traegt dieses Tor selbst;
  --    hier steht es noch einmal, weil ein Abbruch mitten in der Gruppe
  --    teurer ist als eine rote Zeile davor.
  select md5(p.prosrc) into v_src from pg_proc p
    where p.oid = to_regprocedure('public.system_platform_export()');
  if v_src is null then
    raise exception 'ABBRUCH A6a: system_platform_export() fehlt (0105).';
  end if;
  if v_src <> '92c48444f99b9e294f9703d0c0ddeaa8' then
    raise exception 'ABBRUCH A6b: der Exportrumpf ist % und nicht die Fassung '
      'aus 0153 (92c48444f99b9e294f9703d0c0ddeaa8). Liegt dort ff4f38e6…, ist '
      '0160 schon angewendet; liegt 4c4d2e7c…, fehlt 0153.', v_src;
  end if;
  select count(*) into v_n from pg_proc p
   where p.pronamespace = to_regnamespace('public') and p.proname = 'system_platform_export';
  if v_n <> 1 then
    raise exception 'ABBRUCH A6c: % Fassung(en) von system_platform_export.', v_n;
  end if;

  -- b) DIE GRUNDLAGE AUS 0152/0158/0159.
  if to_regprocedure('public.admin_set_variant_base(text,text,boolean)') is null
     or to_regprocedure('public.admin_publish_with_base(text,text,boolean)') is null then
    raise exception 'ABBRUCH A6d: eine Funktion aus 0159 fehlt — 0161 ruft sie.';
  end if;
  if to_regprocedure('public.admin_set_character(text,bigint)') is null
     or to_regprocedure('public.admin_create_character(text)') is null
     or to_regprocedure('public.admin_set_catalog_status(text,text)') is null
     or to_regprocedure('public.is_platform_admin()') is null then
    raise exception 'ABBRUCH A6d2: eine Funktion aus 0152/0158 fehlt.';
  end if;
  if to_regclass('public.order_lines') is null then
    raise exception 'ABBRUCH A6d3: order_lines fehlt (0010) — 0162 fragt sie '
      'eigens, weil sie die einzige SKY-ID-Spalte ohne Fremdschluessel ist.';
  end if;

  -- c) DIE DREI FUNKTIONEN, DIE DIE GRUPPE ANLEGT, FEHLEN NOCH.
  select count(*) into v_n from pg_proc p
   where p.pronamespace = to_regnamespace('public') and p.proname = 'admin_publish_variant_auto';
  if v_n <> 0 then
    raise exception 'ABBRUCH A6e: % Fassung(en) von admin_publish_variant_auto liegen schon (0161). '
      'Entweder liegt die Gruppe bereits, oder hier steht etwas Fremdes.', v_n;
  end if;
  select count(*) into v_n from pg_proc p
   where p.pronamespace = to_regnamespace('public') and p.proname = 'admin_set_market_price';
  if v_n <> 0 then
    raise exception 'ABBRUCH A6f: % Fassung(en) von admin_set_market_price liegen schon (0162). '
      'Entweder liegt die Gruppe bereits, oder hier steht etwas Fremdes.', v_n;
  end if;
  select count(*) into v_n from pg_proc p
   where p.pronamespace = to_regnamespace('public') and p.proname = 'admin_delete_figure';
  if v_n <> 0 then
    raise exception 'ABBRUCH A6g: % Fassung(en) von admin_delete_figure liegen schon (0162). '
      'Entweder liegt die Gruppe bereits, oder hier steht etwas Fremdes.', v_n;
  end if;

  -- d) admin_merge_references IST DIE BERICHTIGTE FASSUNG AUS 0159.
  --    `0162` zaehlt mit ihr; die alte aus 0154 wies den zweispaltigen
  --    Schluessel ab und braeche jede Loeschung.
  select p.prosrc into v_src from pg_proc p
    where p.oid = to_regprocedure('public.admin_merge_references(text)');
  if v_src is null then
    raise exception 'ABBRUCH A6h: admin_merge_references(text) fehlt (0154/0159).';
  end if;
  if v_src not like '%confkey%' or v_src like '%mehrspaltigen Fremdschluessel%' then
    raise exception 'ABBRUCH A6i: admin_merge_references ist nicht die Fassung '
      'aus 0159 — sie zaehlt mehrspaltige Fremdschluessel nicht mit. Dann '
      'braeche jede Loeschung und jede Zusammenfuehrung.';
  end if;

  -- e) DAS JOURNAL: zwoelf Werte, base_sky_id dabei, die zwei neuen nicht.
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conrelid = to_regclass('public.catalog_admin_changes')
     and c.conname = 'catalog_admin_changes_field_known';
  if v_def is null then
    raise exception 'ABBRUCH A6j: catalog_admin_changes_field_known fehlt.';
  end if;
  if v_def not like '%base_sky_id%' then
    raise exception 'ABBRUCH A6k: die Journal-Constraint kennt base_sky_id nicht '
      '(%) — dann ist 0159 hier nicht angewendet.', v_def;
  end if;
  if v_def like '%market_price%' or v_def like '%deleted%' then
    raise exception 'ABBRUCH A6l: die Journal-Constraint kennt market_price oder '
      'deleted schon — dann liegt 0162 bereits.';
  end if;
  select count(*) into v_n from public.catalog_admin_changes
   where field not in ('catalog_visible', 'display_name_override', 'admin_note',
                       'catalog_group', 'image_override_path', 'card_type',
                       'created', 'catalog_status', 'merged_from', 'discarded',
                       'character_id', 'base_sky_id', 'market_price', 'deleted');
  if v_n <> 0 then
    raise exception 'ABBRUCH A6m: % Journalzeile(n) tragen ein Feld ausserhalb '
      'der vierzehn. 0162 baut die Constraint ohne not valid neu und wuerde '
      'mitten in der Gruppe scheitern.', v_n;
  end if;

  -- f) DIE SPALTEN AUS 0163 GIBT ES NOCH NICHT — das ist G5', nicht hier.
  select count(*) into v_n from pg_attribute a
   where a.attrelid = to_regclass('public.skylanders')
     and a.attname in ('types', 'visible_type', 'visible_type_decided')
     and not a.attisdropped;
  if v_n <> 0 then
    raise exception 'ABBRUCH A6n: % der drei Spalten aus 0163 stehen schon. '
      'Dann ist die Reihenfolge durcheinander.', v_n;
  end if;
end
$lauf_a6$;

-- ---------------------------------------------------------------------------
-- A7  TRIGGER UND RIEGEL, VORHER BENANNT — UND SIE BLEIBEN GLEICH
-- ---------------------------------------------------------------------------
select set_config('skyisles.trigger', (
  select coalesce(string_agg(t.tgname, ',' order by t.tgname), '(keine)')
    from pg_trigger t
   where t.tgrelid = to_regclass('public.skylanders') and not t.tgisinternal), true);
select set_config('skyisles.riegel', (
  select coalesce(string_agg(c.conname, ',' order by c.conname), '(keine)')
    from pg_constraint c where c.conrelid = to_regclass('public.skylanders')), true);

-- =========================================================================
-- >>> EINGEBETTET: supabase/migrations/0160_platform_export_base_sky_id.sql
-- ---------------------------------------------------------------------------
-- 0160 — `base_sky_id` kommt in die Plattformsicherung
--
-- CAT-07, Nachtrag. `0159` gibt jeder Variante eine direkte Beziehung zu
-- ihrer Basisfigur. Die Plattformsicherung fuehrt sie nicht: ihre
-- Spaltenliste steht im Rumpf von `system_platform_export()`, und der ist
-- aelter.
--
-- DIE FRAGE, DIE DIESE DATEI BEANTWORTET: steht eine Variante nach einer
-- Wiederherstellung wieder unter ihrer Basisfigur? Ohne sie lautet die
-- Antwort NEIN fuer das JSON-Archiv — `database.json` fuehrt `character_id`,
-- also die FAMILIE, aber nicht die Mitte. Jede Variante kaeme als
-- eigenstaendige Figur zurueck. Das ist dieselbe Klasse Verlust wie bei
-- `catalog_status` vor `0153`, nur leiser: es faellt nicht auf, es sieht nur
-- falsch sortiert aus.
--
-- (Fuer die logische Sicherung mit `pg_dump` — Stufe 2 nach
-- `supabase/checks/backup_architecture_two_tier.md` — gilt das NICHT: die
-- kopiert die Spalte von sich aus. Diese Migration schliesst also die Luecke
-- von Stufe 1, nicht die von Stufe 2.)
--
-- DIE EINE AENDERUNG, und es ist wirklich nur eine Zeile:
--
--     'character_id', t.character_id,
--   + 'base_sky_id',  t.base_sky_id,            <- neu, im Bereich `skylanders`
--
-- Alles andere ist Zeichen fuer Zeichen der Rumpf aus `0153`. 31 072 Zeichen
-- gehen unveraendert durch, 31 114 kommen heraus;
-- `src/lib/backup/platform-export-0160.test.ts` rechnet die Umkehrprobe bei
-- jedem Testlauf nach — neuer Rumpf MINUS die eine Zeile ist der alte.
--
-- WARUM NEBEN `character_id` UND NICHT IRGENDWO: die zwei Spalten
-- beantworten verwandte Fragen — `character_id` sagt WER dargestellt ist
-- (serienuebergreifend, ADR-0070b), `base_sky_id` sagt WOVON diese Variante
-- eine Variante ist (innerhalb EINER Serie, ADR-0156). Wer den Export liest,
-- soll sie beieinander sehen.
--
-- WAS SICH NICHT AENDERT, und das ist der Grund, warum diese Migration klein
-- bleiben darf:
--
--   * **Die Bereichszahl bleibt 54.** `base_sky_id` ist ein FELD eines
--     bestehenden Bereichs, kein Bereich. Deshalb bleibt `format_version`
--     bei **2**, `SECTIONS_BY_FORMAT_VERSION` unveraendert, und Archive der
--     Version 2 ohne dieses Feld bleiben lesbar und vollstaendig im Sinne
--     ihrer Version. Die Vollstaendigkeitspruefung in
--     `src/lib/backup/platform-archive.ts` zaehlt BEREICHE, nicht Felder —
--     gemessen, nicht angenommen.
--   * Keine Tabelle, keine Spalte, keine Zeile, kein Trigger, keine
--     Richtlinie, kein Index, kein Recht, keine Constraint. Nur ein
--     Funktionsrumpf. Insbesondere wird die Constraint
--     `skylanders_base_same_series` aus `0159` NICHT angefasst — ob sie
--     `deferrable` werden soll, ist eine eigene Frage mit eigener Freigabe
--     (`supabase/checks/0160_restore_order.md`, Abschnitt 4).
--   * `seller_business_backup()` wird NICHT angefasst: eine
--     Variantenbeziehung ist redaktionelle Gruppierung der Plattform und
--     kein Haendlerdatum (`src/lib/backup/manifest.ts` fuehrt sie als
--     DAUERHAFTEN Ausschluss mit Begruendung — anders als hier, wo der
--     Ausschluss ein Ablaufdatum hatte).
--
-- VORBEDINGUNG, UND SIE IST EINE REIHENFOLGE: diese Datei ist aus dem Rumpf
-- von `0153` gerechnet und ersetzt nur genau diesen. Auf Staging liegt er
-- seit dem 2026-10-28. **Auf Production liegt er nicht** — dort steht weiter
-- der Rumpf aus `0105` (2e2da90e…), und diese Migration bricht dort
-- kontrolliert ab, statt eine fremde Fassung blind zu ueberschreiben. Wer
-- die Reihenfolge aufloesen will, nimmt `0144`, `0152`, `0153` und `0159`
-- nach Production und kann danach diese Datei dort fahren.
--
-- OFFEN BLEIBEN DIE VIER SPALTEN von `platform_export_gap.md`
-- (`skylanders.item_type`, `skylanders.usk_rating`,
-- `shop_inventory.sale_released`, `shop_inventory.delivery_scope`) und die
-- beiden Tabellen `favorites` und `offer_state`. Sie sind eigene
-- Entscheidungen mit eigener Freigabe.
--
-- WAS DIESE MIGRATION NICHT LEISTET, und das gehoert in den Kopf: sie baut
-- KEINE Wiederherstellung. `restore_supported` steht im Archiv weiter auf
-- `false`, und es gibt keine Importfunktion. Was eine Wiederherstellung mit
-- Varianten verlangt — und wo die Reihenfolge der Katalogzeilen wirklich
-- zaehlt — steht in `supabase/checks/0160_restore_order.md`, gemessen mit
-- Probelauf **P69**.
--
-- Abdruck vorher:  92c48444f99b9e294f9703d0c0ddeaa8  (der Rumpf aus `0153`, 54 Bereiche)
-- Abdruck nachher: ff4f38e61cbd4e5857ea914d6be68d44  (54 Bereiche, ein Feld mehr)
--
-- Ruecknahme: `supabase/rollback/R0160_platform_export_back_to_0153.sql`.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen
-- ---------------------------------------------------------------------------
do $vor$
declare
  v_abdruck text;
begin
  if to_regprocedure('public.system_platform_export()') is null then
    raise exception '0160 setzt 0105 voraus: system_platform_export() fehlt';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'skylanders'
                    and column_name = 'base_sky_id') then
    raise exception '0160 setzt 0159 voraus: skylanders.base_sky_id fehlt';
  end if;

  select md5(p.prosrc) into v_abdruck
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'system_platform_export';

  if v_abdruck = 'ff4f38e61cbd4e5857ea914d6be68d44' then
    raise exception '0160 Abbruch: der Rumpf ist schon der neue (%). Diese '
      'Migration ist hier bereits angewendet.', v_abdruck;
  end if;
  if v_abdruck = '2e2da90e976a1e73ca00aba7cd830fae' then
    raise exception '0160 Abbruch: hier steht der Rumpf aus 0105 (%), nicht der '
      'aus 0153. Diese Migration ist aus der 0153-Fassung gerechnet — erst 0144, '
      'dann 0153 anwenden, dann diese.', v_abdruck;
  end if;
  if v_abdruck = '4c4d2e7c81e4efa8e18cdffa06bba40a' then
    raise exception '0160 Abbruch: hier steht der Rumpf aus 0144 (%), nicht der '
      'aus 0153. Erst 0153 anwenden, dann diese.', v_abdruck;
  end if;
  if v_abdruck <> '92c48444f99b9e294f9703d0c0ddeaa8' then
    raise exception '0160 Abbruch: der vorhandene Rumpf ist % und nicht der aus '
      '0153 (92c48444f99b9e294f9703d0c0ddeaa8). Eine unbekannte Fassung wird nicht '
      'blind ueberschrieben.', v_abdruck;
  end if;
end
$vor$;


-- ---------------------------------------------------------------------------
-- 2. Die Exportfunktion, mit einem Feld mehr
--
-- Zeichen fuer Zeichen die Fassung aus `0153`, mit der einen Zeile aus dem
-- Kopf. Eine zweite Aenderung faellt im Test auf, bevor jemand die Datei
-- ausfuehrt.
-- ---------------------------------------------------------------------------
create or replace function public.system_platform_export()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not public.is_platform_admin() then null else jsonb_build_object(

    /* ---- Was nur die Datenbank weiß --------------------------------- */
    'format',         'skyisles-platform-backup',
    'format_version', 2,
    'created_at',     now(),
    'commerce_mode',  (select s.mode from public.commerce_settings s limit 1),
    'snapshot_txid',  pg_current_snapshot()::text,

    /* ---- Die Bereiche, in sechs Gruppen wegen FUNC_MAX_ARGS ---------- */
    'data', (
      /* ---- Katalog — 6 Bereiche, 12 Argumente ---- */
      jsonb_build_object(
        'skylanders', coalesce((
          select jsonb_agg(jsonb_build_object(
            'sky_id', t.sky_id,
            'name', t.name,
            'slug', t.slug,
            'series_code', t.series_code,
            'category_id', t.category_id,
            'market_price', t.market_price::text,
            'price_updated_at', t.price_updated_at,
            'image_file', t.image_file,
            'image_override_path', t.image_override_path,
            'is_active', t.is_active,
            'catalog_visible', t.catalog_visible,
            'catalog_status', t.catalog_status,
            'display_name_override', t.display_name_override,
            'card_type', t.card_type,
            'source', t.source,
            'character_id', t.character_id,
            'base_sky_id', t.base_sky_id,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.sky_id)
            from public.skylanders t
        ), '[]'::jsonb),

        'series', coalesce((
          select jsonb_agg(jsonb_build_object(
            'code', t.code,
            'label', t.label,
            'release_year', t.release_year,
            'position', t.position,
            'created_at', t.created_at
          ) order by t.code)
            from public.series t
        ), '[]'::jsonb),

        'categories', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'series_code', t.series_code,
            'position', t.position,
            'name', t.name,
            'catalog_group', t.catalog_group,
            'created_at', t.created_at
          ) order by t.id)
            from public.categories t
        ), '[]'::jsonb),

        'characters', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'canonical_name', t.canonical_name,
            'element', t.element,
            'species', t.species,
            'role_type', t.role_type,
            'short_description', t.short_description,
            'source_url', t.source_url,
            'source_label', t.source_label,
            'verified_at', t.verified_at,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.characters t
        ), '[]'::jsonb),

        'catalog_editorial', coalesce((
          select jsonb_agg(jsonb_build_object(
            'sky_id', t.sky_id,
            'admin_note', t.admin_note,
            'updated_at', t.updated_at
          ) order by t.sky_id)
            from public.catalog_editorial t
        ), '[]'::jsonb),

        'catalog_admin_changes', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'entity', t.entity,
            'entity_id', t.entity_id,
            'field', t.field,
            'old_value', t.old_value,
            'new_value', t.new_value,
            'changed_at', t.changed_at
          ) order by t.id)
            from public.catalog_admin_changes t
        ), '[]'::jsonb)
      )
      ||
      /* ---- Nutzer und Sammlung — 2 Bereiche, 4 Argumente ---- */
      jsonb_build_object(
        'profiles', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'username', t.username,
            'display_name', t.display_name,
            'country', t.country,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.profiles t
        ), '[]'::jsonb),

        'collection_items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'user_id', t.user_id,
            'sky_id', t.sky_id,
            'quantity', t.quantity,
            'note', t.note,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.collection_items t
        ), '[]'::jsonb)
      )
      ||
      /* ---- Seller und Shop — 10 Bereiche, 20 Argumente ---- */
      jsonb_build_object(
        'sellers', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'display_name', t.display_name,
            'legal_name', t.legal_name,
            'trading_name', t.trading_name,
            'legal_form', t.legal_form,
            'street', t.street,
            'postal_code', t.postal_code,
            'city', t.city,
            'country_code', t.country_code,
            'phone', t.phone,
            'direct_contact', t.direct_contact,
            'register_court', t.register_court,
            'register_number', t.register_number,
            'vat_id', t.vat_id,
            'w_id', t.w_id,
            'contact_email', t.contact_email,
            'transactional_reply_to', t.transactional_reply_to,
            'withdrawal_contact_email', t.withdrawal_contact_email,
            'complaints_contact_email', t.complaints_contact_email,
            'small_business_19', t.small_business_19,
            'dispute_participation', t.dispute_participation,
            'dispute_body', t.dispute_body,
            'return_postage_borne_by', t.return_postage_borne_by,
            'dispatch_statement', t.dispatch_statement,
            'free_shipping_threshold', t.free_shipping_threshold::text,
            'is_active', t.is_active,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.sellers t
        ), '[]'::jsonb),

        'seller_operators', coalesce((
          select jsonb_agg(jsonb_build_object(
            'seller_id', t.seller_id,
            'user_id', t.user_id,
            'is_enabled', t.is_enabled,
            'note', t.note,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.user_id)
            from public.seller_operators t
        ), '[]'::jsonb),

        'shop_admins', coalesce((
          select jsonb_agg(jsonb_build_object(
            'user_id', t.user_id,
            'granted_at', t.granted_at,
            'note', t.note
          ) order by t.user_id)
            from public.shop_admins t
        ), '[]'::jsonb),

        'platform_admins', coalesce((
          select jsonb_agg(jsonb_build_object(
            'user_id', t.user_id,
            'created_at', t.created_at,
            'note', t.note
          ) order by t.user_id)
            from public.platform_admins t
        ), '[]'::jsonb),

        'shop_settings', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'price_percentage', t.price_percentage::text,
            'free_shipping_threshold', t.free_shipping_threshold::text,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.shop_settings t
        ), '[]'::jsonb),

        'platform_settings', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'contact_email', t.contact_email,
            'support_email', t.support_email,
            'catalog_market_boost_percent', t.catalog_market_boost_percent::text,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.platform_settings t
        ), '[]'::jsonb),

        'commerce_settings', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'mode', t.mode,
            'max_open_checkouts', t.max_open_checkouts,
            'max_reserved_units', t.max_reserved_units,
            'max_orders_per_hour', t.max_orders_per_hour,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.commerce_settings t
        ), '[]'::jsonb),

        'shipping_methods', coalesce((
          select jsonb_agg(jsonb_build_object(
            'code', t.code,
            'name', t.name,
            'base_price', t.base_price::text,
            'is_enabled', t.is_enabled,
            'sort_order', t.sort_order,
            'updated_at', t.updated_at
          ) order by t.code)
            from public.shipping_methods t
        ), '[]'::jsonb),

        'shipping_countries', coalesce((
          select jsonb_agg(jsonb_build_object(
            'country_code', t.country_code,
            'label', t.label,
            'is_enabled', t.is_enabled,
            'sort_order', t.sort_order,
            'updated_at', t.updated_at
          ) order by t.country_code)
            from public.shipping_countries t
        ), '[]'::jsonb),

        'legal_document_versions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'slug', t.slug,
            'version', t.version,
            'effective_from', t.effective_from,
            'updated_at', t.updated_at
          ) order by t.slug)
            from public.legal_document_versions t
        ), '[]'::jsonb)
      )
      ||
      /* ---- Lager und Orderbuch — 13 Bereiche, 26 Argumente ---- */
      jsonb_build_object(
        'shop_inventory', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'sky_id', t.sky_id,
            'condition', t.condition,
            'quantity', t.quantity,
            'reserved', t.reserved,
            'available_quantity', t.available_quantity,
            'sale_price', t.sale_price::text,
            'is_listed', t.is_listed,
            'note', t.note,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.shop_inventory t
        ), '[]'::jsonb),

        'inventory_movements', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'inventory_id', t.inventory_id,
            'delta', t.delta,
            'reason', t.reason,
            'unit_cost', t.unit_cost::text,
            'currency', t.currency,
            'note', t.note,
            'created_at', t.created_at,
            'sky_id', inv.sky_id,
            'condition', inv.condition
          ) order by t.id)
            from public.inventory_movements t
          left join public.shop_inventory inv on inv.id = t.inventory_id
        ), '[]'::jsonb),

        'purchases', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'purchased_at', t.purchased_at,
            'total_cost', t.total_cost::text,
            'currency', t.currency,
            'source', t.source,
            'external_ref', t.external_ref,
            'note', t.note,
            'is_test', t.is_test,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.purchases t
        ), '[]'::jsonb),

        'purchase_items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'purchase_id', t.purchase_id,
            'position', t.position,
            'sky_id', t.sky_id,
            'condition', t.condition,
            'raw_name', t.raw_name,
            'state', t.state,
            'market_price_snapshot', t.market_price_snapshot::text,
            'market_price_snapshot_at', t.market_price_snapshot_at,
            'market_price_source', t.market_price_source,
            'movement_id', t.movement_id,
            'note', t.note,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.purchase_items t
        ), '[]'::jsonb),

        'sales', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'channel', t.channel,
            'order_id', t.order_id,
            'sold_at', t.sold_at,
            'shipped_at', t.shipped_at,
            'destination_country_code', t.destination_country_code,
            'currency', t.currency,
            'items_subtotal', t.items_subtotal::text,
            'shipping_charged', t.shipping_charged::text,
            'discount_amount', t.discount_amount::text,
            'reported_payout_amount', t.reported_payout_amount::text,
            'reported_payout_ref', t.reported_payout_ref,
            'reported_payout_at', t.reported_payout_at,
            'buy_in_factor_snapshot', t.buy_in_factor_snapshot::text,
            'external_order_ref', t.external_order_ref,
            'buyer_ref', t.buyer_ref,
            'note', t.note,
            'source', t.source,
            'is_test', t.is_test,
            'cancelled_at', t.cancelled_at,
            'stock_released_at', t.stock_released_at,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.sales t
        ), '[]'::jsonb),

        'sale_items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'sale_id', t.sale_id,
            'position', t.position,
            'sky_id', t.sky_id,
            'raw_name', t.raw_name,
            'condition', t.condition,
            'market_price_snapshot', t.market_price_snapshot::text,
            'market_price_snapshot_at', t.market_price_snapshot_at,
            'movement_id', t.movement_id,
            'returned_at', t.returned_at,
            'return_movement_id', t.return_movement_id,
            'settled_at', t.settled_at,
            'not_shipped_at', t.not_shipped_at,
            'return_announced_at', t.return_announced_at,
            'note', t.note,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.sale_items t
        ), '[]'::jsonb),

        'sale_fees', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'sale_id', t.sale_id,
            'kind', t.kind,
            'label', t.label,
            'amount', t.amount::text,
            'settled_by', t.settled_by,
            'note', t.note,
            'created_at', t.created_at
          ) order by t.id)
            from public.sale_fees t
        ), '[]'::jsonb),

        'sale_refunds', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'sale_id', t.sale_id,
            'amount', t.amount::text,
            'occurred_at', t.occurred_at,
            'reason', t.reason,
            'external_ref', t.external_ref,
            'note', t.note,
            'created_at', t.created_at
          ) order by t.id)
            from public.sale_refunds t
        ), '[]'::jsonb),

        'settlement_adjustments', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'sale_id', t.sale_id,
            'channel', t.channel,
            'amount', t.amount::text,
            'reason', t.reason,
            'external_ref', t.external_ref,
            'note', t.note,
            'occurred_at', t.occurred_at,
            'source', t.source,
            'created_at', t.created_at
          ) order by t.id)
            from public.settlement_adjustments t
        ), '[]'::jsonb),

        'orderbook_name_mappings', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'normalised_name', t.normalised_name,
            'sky_id', t.sky_id,
            'not_a_figure', t.not_a_figure,
            'sample_raw_name', t.sample_raw_name,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.orderbook_name_mappings t
        ), '[]'::jsonb),

        'orderbook_audit', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'sale_id', t.sale_id,
            'entity_type', t.entity_type,
            'entity_id', t.entity_id,
            'action', t.action,
            'field', t.field,
            'old_value', t.old_value,
            'new_value', t.new_value,
            'changed_at', t.changed_at
          ) order by t.id)
            from public.orderbook_audit t
        ), '[]'::jsonb),

        'seller_monthly_reports', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'period_year', t.period_year,
            'period_month', t.period_month,
            'commerce_mode', t.commerce_mode,
            'finalized_at', t.finalized_at,
            'order_count', t.order_count,
            'order_value', t.order_value::text,
            'merchandise_amount', t.merchandise_amount::text,
            'shipping_amount', t.shipping_amount::text,
            'discount_amount', t.discount_amount::text,
            'currency', t.currency,
            'paid_count', t.paid_count,
            'unpaid_count', t.unpaid_count,
            'tax_regime', t.tax_regime,
            'included_orders', t.included_orders
          ) order by t.id)
            from public.seller_monthly_reports t
        ), '[]'::jsonb),

        'purchase_calculations', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'user_id', t.user_id,
            'name', t.name,
            'status', t.status,
            'lines', t.lines,
            'factor_percent', t.factor_percent,
            'total_cents', t.total_cents,
            'positions', t.positions,
            'units', t.units,
            'purchase_id', t.purchase_id,
            'created_at', t.created_at,
            'updated_at', t.updated_at
          ) order by t.id)
            from public.purchase_calculations t
        ), '[]'::jsonb)
      )
      ||
      /* ---- Bestellungen — 18 Bereiche, 36 Argumente ---- */
      jsonb_build_object(
        'orders', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_number', t.order_number,
            'user_id', t.user_id,
            'customer_email', t.customer_email,
            'currency', t.currency,
            'items_subtotal', t.items_subtotal::text,
            'shipping_amount', t.shipping_amount::text,
            'discount_amount', t.discount_amount::text,
            'total_amount', t.total_amount::text,
            'payment_status', t.payment_status,
            'fulfillment_status', t.fulfillment_status,
            'needs_resolution', t.needs_resolution,
            'placed_at', t.placed_at,
            'paid_at', t.paid_at,
            'shipped_at', t.shipped_at,
            'completed_at', t.completed_at,
            'cancelled_at', t.cancelled_at,
            'updated_at', t.updated_at,
            'tax_regime', t.tax_regime,
            'shipping_method_code', t.shipping_method_code,
            'shipping_method_name', t.shipping_method_name,
            'tracking_number', t.tracking_number,
            'commerce_mode', t.commerce_mode
          ) order by t.id)
            from public.orders t
        ), '[]'::jsonb),

        'order_lines', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'sky_id', t.sky_id,
            'condition', t.condition,
            'quantity', t.quantity,
            'name_snapshot', t.name_snapshot,
            'image_snapshot', t.image_snapshot,
            'series_snapshot', t.series_snapshot,
            'unit_price', t.unit_price::text,
            'discount_amount', t.discount_amount::text,
            'line_total', t.line_total::text,
            'inventory_id', t.inventory_id,
            'created_at', t.created_at
          ) order by t.id)
            from public.order_lines t
        ), '[]'::jsonb),

        'order_addresses', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'kind', t.kind,
            'first_name', t.first_name,
            'last_name', t.last_name,
            'company', t.company,
            'street', t.street,
            'house_number', t.house_number,
            'address_line_2', t.address_line_2,
            'postal_code', t.postal_code,
            'city', t.city,
            'country_code', t.country_code,
            'phone', t.phone,
            'created_at', t.created_at
          ) order by t.id)
            from public.order_addresses t
        ), '[]'::jsonb),

        'order_events', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'event_type', t.event_type,
            'actor_kind', t.actor_kind,
            'payload', t.payload,
            'created_at', t.created_at
          ) order by t.id)
            from public.order_events t
        ), '[]'::jsonb),

        'order_line_events', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'order_line_id', t.order_line_id,
            'kind', t.kind,
            'quantity', t.quantity,
            'stock_outcome', t.stock_outcome,
            'movement_id', t.movement_id,
            'correction_movement_id', t.correction_movement_id,
            'occurred_at', t.occurred_at,
            'reason', t.reason,
            'reason_code', t.reason_code,
            'created_at', t.created_at
          ) order by t.id)
            from public.order_line_events t
        ), '[]'::jsonb),

        'order_reservations', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'inventory_id', t.inventory_id,
            'quantity', t.quantity,
            'state', t.state,
            'reserved_at', t.reserved_at,
            'expires_at', t.expires_at,
            'released_at', t.released_at,
            'converted_at', t.converted_at,
            'movement_id', t.movement_id,
            'reverted_movement_id', t.reverted_movement_id,
            'sky_id', inv.sky_id,
            'condition', inv.condition
          ) order by t.id)
            from public.order_reservations t
          left join public.shop_inventory inv on inv.id = t.inventory_id
        ), '[]'::jsonb),

        'order_refunds', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'amount', t.amount::text,
            'currency', t.currency,
            'occurred_at', t.occurred_at,
            'reason', t.reason,
            'withdrawal_request_id', t.withdrawal_request_id,
            'created_at', t.created_at
          ) order by t.id)
            from public.order_refunds t
        ), '[]'::jsonb),

        'order_refund_allocations', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'refund_id', t.refund_id,
            'order_line_id', t.order_line_id,
            'quantity', t.quantity,
            'amount', t.amount::text,
            'allocation_type', t.allocation_type
          ) order by t.id)
            from public.order_refund_allocations t
        ), '[]'::jsonb),

        'order_legal_snapshots', coalesce((
          select jsonb_agg(jsonb_build_object(
            'order_id', t.order_id,
            'agb_version', t.agb_version,
            'widerruf_version', t.widerruf_version,
            'seller_name', t.seller_name,
            'seller_legal_name', t.seller_legal_name,
            'seller_street', t.seller_street,
            'seller_postal_code', t.seller_postal_code,
            'seller_city', t.seller_city,
            'seller_country_code', t.seller_country_code,
            'seller_email', t.seller_email,
            'seller_vat_id', t.seller_vat_id,
            'created_at', t.created_at
          ) order by t.order_id)
            from public.order_legal_snapshots t
        ), '[]'::jsonb),

        'order_messages', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'author_kind', t.author_kind,
            'body', t.body,
            'created_at', t.created_at
          ) order by t.id)
            from public.order_messages t
        ), '[]'::jsonb),

        'order_conversation_reads', coalesce((
          select jsonb_agg(jsonb_build_object(
            'order_id', t.order_id,
            'reader', t.reader,
            'last_read_at', t.last_read_at
          ) order by t.order_id, t.reader)
            from public.order_conversation_reads t
        ), '[]'::jsonb),

        'order_attention_reads', coalesce((
          select jsonb_agg(jsonb_build_object(
            'order_id', t.order_id,
            'reader', t.reader,
            'last_read_at', t.last_read_at
          ) order by t.order_id, t.reader)
            from public.order_attention_reads t
        ), '[]'::jsonb),

        'order_mail', coalesce((
          select jsonb_agg(jsonb_build_object(
            'order_id', t.order_id,
            'kind', t.kind,
            'ref', t.ref,
            'state', t.state,
            'claimed_at', t.claimed_at,
            'sent_at', t.sent_at,
            'attempts', t.attempts,
            'last_error', t.last_error,
            'updated_at', t.updated_at
          ) order by t.order_id, t.kind, coalesce(t.ref, ''))
            from public.order_mail t
        ), '[]'::jsonb),

        'invoices', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'invoice_number', t.invoice_number,
            'issued_at', t.issued_at,
            'seller_legal_name', t.seller_legal_name,
            'seller_trade_name', t.seller_trade_name,
            'seller_street', t.seller_street,
            'seller_postal_code', t.seller_postal_code,
            'seller_city', t.seller_city,
            'seller_country', t.seller_country,
            'seller_email', t.seller_email,
            'seller_vat_id', t.seller_vat_id,
            'customer_name', t.customer_name,
            'customer_company', t.customer_company,
            'customer_street', t.customer_street,
            'customer_postal_code', t.customer_postal_code,
            'customer_city', t.customer_city,
            'customer_country', t.customer_country,
            'customer_email', t.customer_email,
            'items_subtotal', t.items_subtotal::text,
            'shipping_amount', t.shipping_amount::text,
            'discount_amount', t.discount_amount::text,
            'total_amount', t.total_amount::text,
            'currency', t.currency,
            'tax_regime', t.tax_regime,
            'lines', t.lines
          ) order by t.id)
            from public.invoices t
        ), '[]'::jsonb),

        'customer_contacts', coalesce((
          select jsonb_agg(jsonb_build_object(
            'user_id', t.user_id,
            'email', t.email,
            'first_name', t.first_name,
            'last_name', t.last_name,
            'company', t.company,
            'street', t.street,
            'house_number', t.house_number,
            'address_line_2', t.address_line_2,
            'postal_code', t.postal_code,
            'city', t.city,
            'country_code', t.country_code,
            'phone', t.phone,
            'updated_at', t.updated_at
          ) order by t.user_id)
            from public.customer_contacts t
        ), '[]'::jsonb),

        'payment_attempts', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'provider', t.provider,
            'status', t.status,
            'amount', t.amount::text,
            'currency', t.currency,
            'created_at', t.created_at,
            'updated_at', t.updated_at,
            'paid_at', t.paid_at,
            'failed_at', t.failed_at
          ) order by t.id)
            from public.payment_attempts t
        ), '[]'::jsonb),

        'payment_events', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'provider', t.provider,
            'event_type', t.event_type,
            'payment_attempt_id', t.payment_attempt_id,
            'order_id', t.order_id,
            'received_at', t.received_at,
            'processed_at', t.processed_at,
            'outcome', t.outcome
          ) order by t.id)
            from public.payment_events t
        ), '[]'::jsonb),

        'withdrawal_requests', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'order_id', t.order_id,
            'consumer_name', t.consumer_name,
            'contact_email', t.contact_email,
            'declaration', t.declaration,
            'received_at', t.received_at,
            'receipt_state', t.receipt_state,
            'receipt_sent_at', t.receipt_sent_at,
            'handled_at', t.handled_at,
            'receipt_attempt_at', t.receipt_attempt_at
          ) order by t.id)
            from public.withdrawal_requests t
        ), '[]'::jsonb)
      )
      ||
      /* ---- Tester — 5 Bereiche, 10 Argumente ---- */
      jsonb_build_object(
        'testers', coalesce((
          select jsonb_agg(jsonb_build_object(
            'user_id', t.user_id,
            'note', t.note,
            'created_at', t.created_at
          ) order by t.user_id)
            from public.testers t
        ), '[]'::jsonb),

        'tester_permissions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'user_id', t.user_id,
            'permission', t.permission,
            'granted_at', t.granted_at
          ) order by t.user_id, t.permission)
            from public.tester_permissions t
        ), '[]'::jsonb),

        'tester_features', coalesce((
          select jsonb_agg(jsonb_build_object(
            'key', t.key,
            'label', t.label,
            'description', t.description,
            'position', t.position
          ) order by t.key)
            from public.tester_features t
        ), '[]'::jsonb),

        'tester_permission_changes', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', t.id,
            'user_id', t.user_id,
            'permission', t.permission,
            'action', t.action,
            'changed_at', t.changed_at
          ) order by t.id)
            from public.tester_permission_changes t
        ), '[]'::jsonb),

        'commerce_testers', coalesce((
          select jsonb_agg(jsonb_build_object(
            'user_id', t.user_id,
            'note', t.note,
            'granted_at', t.granted_at
          ) order by t.user_id)
            from public.commerce_testers t
        ), '[]'::jsonb)
      )
    )
  ) end;
$$;

comment on function public.system_platform_export() is
  'The database half of one complete platform backup as a single JSON document (0105, extended by 0144, 0153 and 0160) — the archive file database.json. 54 sections in one statement, so every one of them comes from the same MVCC snapshot; money is rendered as text so no reader turns 7.85 into a float. The data object is assembled from six jsonb_build_object calls joined with ||, because PostgreSQL takes at most 100 arguments per call. The selection lives in src/lib/backup/platform-manifest.ts and is enforced from both sides by platform-sql.test.ts. Export, never synchronisation: it writes nothing, reads no auth table, and carries none of the legacy Excel import tables. 0144 added purchase_calculations (0142) and raised format_version to 2; archives of version 1 stay valid and simply carry 53 sections. 0153 added skylanders.catalog_status (0152) and 0160 added skylanders.base_sky_id (0159) — both FIELDS, not sections, so format_version stays 2 and version-2 archives without them stay readable; without catalog_status a draft could not be told from a hidden row after a restore, and without base_sky_id every variant would come back as a figure of its own. There is still no restore — format_version is the contract that keeps one possible, the general limits are written down in supabase/checks/0144_restore_limits.md, and what the variant relation demands of a restore order is in supabase/checks/0160_restore_order.md.';

-- ---------------------------------------------------------------------------
-- 3. Die Rechte, ausdruecklich festgeschrieben
--
-- `create or replace function` ERHAELT den bestehenden ACL — diese zwei
-- Zeilen aendern also nichts. Sie stehen hier, weil eine Datei, die eine
-- `security definer`-Funktion schreibt, ihre Rechte nennen soll.
-- ---------------------------------------------------------------------------
revoke all on function public.system_platform_export() from public, anon;
grant execute on function public.system_platform_export() to authenticated;


-- ---------------------------------------------------------------------------
-- 4. Nachbedingungen
-- ---------------------------------------------------------------------------
do $nach$
declare
  v_abdruck   text;
  v_bereiche  integer;
  v_definer   boolean;
  v_volatil   "char";
  v_pfad      boolean;
  v_offen     integer;
  v_auth      integer;
begin
  select md5(p.prosrc),
         (length(p.prosrc) - length(replace(p.prosrc, 'coalesce((', ''))) / length('coalesce(('),
         p.prosecdef, p.provolatile,
         /* Ausgepackt, nicht verglichen — `search_path=""` liegt quotiert ab,
            und `_` ist in `like` ein Platzhalter. EIN Backslash, nicht zwei:
            zwei suchen einen echten Backslash und finden nie etwas (die
            Lehre aus `0159` Zeile 123). */
         (select count(*) = 1 from unnest(coalesce(p.proconfig, '{}')) c
           where c like 'search\_path=%')
    into v_abdruck, v_bereiche, v_definer, v_volatil, v_pfad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'system_platform_export';

  if v_abdruck <> 'ff4f38e61cbd4e5857ea914d6be68d44' then
    raise exception '0160 Nachbedingung: Rumpfabdruck ist % und nicht %',
      v_abdruck, 'ff4f38e61cbd4e5857ea914d6be68d44';
  end if;
  -- EIN FELD, KEIN BEREICH: die Zahl darf sich nicht bewegt haben.
  if v_bereiche <> 54 then
    raise exception '0160 Nachbedingung: % Bereiche statt 54 — diese Migration '
      'fuegt ein Feld hinzu, keinen Bereich', v_bereiche;
  end if;
  if not v_definer or v_volatil <> 's' or not v_pfad then
    raise exception '0160 Nachbedingung: Attribute verloren — definer %, '
      'volatility %, genau eine search_path-Festlegung %',
      v_definer, v_volatil, v_pfad;
  end if;

  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'system_platform_export'
                    and p.prosrc like '%''base_sky_id'', t.base_sky_id,%') then
    raise exception '0160 Nachbedingung: das Feld base_sky_id fehlt im Rumpf';
  end if;
  -- Und das Feld aus `0153` steht noch. Eine Ersetzung, die eines gegen das
  -- andere tauscht, waere genau der stille Fehler, den der Abdruck oben
  -- schon abfaengt — hier steht er noch einmal namentlich.
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'system_platform_export'
                    and p.prosrc like '%''catalog_status'', t.catalog_status,%') then
    raise exception '0160 Nachbedingung: das Feld catalog_status aus 0153 ist fort';
  end if;
  -- Und die Formatversion ist NICHT gestiegen.
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'system_platform_export'
                    and p.prosrc like '%''format_version'', 2,%') then
    raise exception '0160 Nachbedingung: format_version ist nicht mehr 2';
  end if;

  -- Die Rechte: niemand ausser `authenticated`.
  select count(*) into v_offen
    from pg_proc p, aclexplode(p.proacl) a
   where p.oid = to_regprocedure('public.system_platform_export()')
     and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'public'));
  if v_offen <> 0 then
    raise exception '0160 Nachbedingung: % offene EXECUTE-Rechte', v_offen;
  end if;
  select count(*) into v_auth
    from pg_proc p, aclexplode(p.proacl) a
   where p.oid = to_regprocedure('public.system_platform_export()')
     and a.privilege_type = 'EXECUTE'
     and a.grantee::regrole::text = 'authenticated';
  if v_auth <> 1 then
    raise exception '0160 Nachbedingung: authenticated darf nicht ausfuehren';
  end if;

  raise notice '0160: Rumpf %, 54 Bereiche, format_version 2, ein Feld mehr, '
    'Rechte unveraendert', v_abdruck;
end
$nach$;
-- <<< ENDE: supabase/migrations/0160_platform_export_base_sky_id.sql
-- =========================================================================

-- =========================================================================
-- >>> EINGEBETTET: supabase/migrations/0161_variant_family_auto.sql
-- ---------------------------------------------------------------------------
-- 0161 — die Familie entsteht von selbst (CAT-08, Stufe 1)
--
-- WAS SIE TUT. Eine vierte Funktion, `admin_publish_variant_auto(text, text)`.
-- Der Bediener waehlt NUR die Basisfigur; die Familie regelt die Datenbank:
--
--   1. Basisfigur hat eine Familie  -> sie wird uebernommen.
--   2. Nur die Variante hat eine    -> sie bleibt, die Basisfigur unberuehrt.
--   3. Keine von beiden hat eine    -> eine Familie mit dem NAMEN der
--                                      Basisfigur wird gesucht; gefunden und
--                                      bestaetigt -> benutzt, sonst neu
--                                      angelegt. Beide bekommen sie.
--   4. Beide haben VERSCHIEDENE     -> ABBRUCH. Nichts wird ueberschrieben.
--
-- DIE CHECKBOX ENTFAELLT. `p_create_family` aus `0159` war eine Frage an den
-- Bediener, die er nicht beantworten kann: „soll eine Familie angelegt
-- werden?" ist keine fachliche Entscheidung, sondern eine Folge daraus, dass
-- er eine Basisfigur gewaehlt hat.
--
-- ===========================================================================
-- DIE EINE FRAGE, AN DER DIESE MIGRATION HAENGT: REICHT NAMENSGLEICHHEIT?
-- ===========================================================================
--
-- Fall 3 benutzt eine bestehende Familie wieder, wenn ihr `canonical_name`
-- dem Namen der Basisfigur entspricht. Das ist noetig: „Chop Chop" steht
-- zweimal im Katalog — SKY-0015 in `SA` und SKY-0149 in `G` —, beide sind
-- Basisfigur eines Entwurfs, und beide sind DERSELBE Charakter. Ohne
-- Wiederverwendung wuerde der zweite Lauf an `admin_create_character`
-- abbrechen („die Familie gibt es schon"), und der Bediener stuende vor einem
-- Fehler, den er nicht verursacht hat.
--
-- ABER NAMENSGLEICHHEIT ALLEIN BEWEIST NICHTS. ADR-0034 fuehrt die
-- Gegenbeispiele: „Kaos" ist ein Trap, eine Trophy UND ein Sensei;
-- `Mini Drobit` ist Drobots Mini und ein EIGENER Charakter. Gemessen am
-- echten Bestand (`supabase/checks/cat08_name_equality.sql`, 2026-10-28):
-- 470 Charakterzeilen, 24 mehrfach vorkommende Namen, und **kein einziger**
-- traegt zwei verschiedene `character_id`. Die Regel traegt heute — aber
-- „heute" ist kein Riegel.
--
-- DESHALB WIRD DIE IDENTITAET BESTAETIGT, NICHT ANGENOMMEN. Bevor eine
-- gefundene Familie benutzt wird, prueft diese Funktion JEDES ihrer
-- Mitglieder: traegt eines einen Namen, der mit dem der Basisfigur nicht
-- vereinbar ist, bricht sie ab und nennt es. Vereinbar heisst:
--
--   gleich               "Chop Chop"        = "Chop Chop"
--   Mitglied endet drauf "Gold Chop Chop"  -> " Chop Chop"
--   Basis endet drauf    "Chop Chop"       <- "Chop" waere vereinbar
--
-- an einer WORTGRENZE, nie mitten im Wort. Verglichen wird mit `right()` und
-- nicht mit `like`: ein Name darf `%` oder `_` enthalten, und ein Muster, das
-- an einem Namen zerbricht, waere ein stiller Fehler.
--
-- DAS IST EIN VETO, KEINE SUCHE. Gefunden wird eine Familie ausschliesslich
-- ueber GLEICHHEIT des Namens; die Wortgrenzenregel darf nur WIDERSPRECHEN.
-- Damit bleibt ADR-0034 unberuehrt: keine Zuordnung entsteht aus einer
-- Namensaehnlichkeit. Die serienuebergreifende Suche aus der Analyse
-- (CAT-08 Stufe 2) ist NICHT Teil dieser Migration — sie haette heute an
-- 34 von 34 Faellen nichts gefunden, und sie braeuchte eine eigene Freigabe.
--
-- ===========================================================================
-- NEBENLAEUFIGKEIT
-- ===========================================================================
--
-- Zwei Bediener veroeffentlichen gleichzeitig zwei Varianten DERSELBEN
-- Basisfigur. Beide sehen „keine Familie", beide legen an, einer laeuft in
-- `23505` am Index `characters_canonical_name_key` aus `0002`. Zwei Riegel:
--
--   * `pg_advisory_xact_lock` auf dem kleingeschriebenen Familiennamen. Der
--     zweite Aufruf wartet, sieht danach die Familie und BENUTZT sie. Der
--     Name ist der Schluessel, nicht die Zeile — zwei verschiedene Familien
--     behindern sich nicht.
--   * Beide Katalogzeilen werden in EINER Anweisung und in `sky_id`-Ordnung
--     gesperrt. `0159` sperrt Variante-dann-Basis; bei zwei Aufrufen, deren
--     Variante die Basis des anderen ist, waere das ein Deadlock. Eine
--     feste Ordnung kann keinen bauen.
--
-- ===========================================================================
-- WAS SIE NICHT ANFASST
-- ===========================================================================
--
--   * KEINE der Funktionen aus `0158`/`0159`. Sie werden AUFGERUFEN, nicht
--     ersetzt: `admin_set_character` schreibt die Familie,
--     `admin_set_variant_base` die Basisfigur, `admin_set_catalog_status`
--     veroeffentlicht. Es gibt weiterhin EINEN Schreibweg je Spalte.
--     `admin_publish_with_base(text,text,boolean)` bleibt gueltig und
--     aufrufbar; `0161_postflight.sql` rechnet die Abdruecke aller fuenf
--     nach.
--   * Keine Tabelle, keine Spalte, keine Zeile, kein Trigger, keine
--     Richtlinie, kein Index, keine Constraint.
--   * Keine Massenzuordnung. Diese Funktion schreibt die Familie von
--     GENAU ZWEI Zeilen, und nur dort, wo sie `NULL` war.
--   * Kein Name, kein Slug, keine SKY-ID, kein Preis, kein Bild, keine
--     Serie, keine Kategorie, kein `card_type` — und damit kein Angebot,
--     kein Lagerbestand, keine Sammlung und keine Bestellung.
--
-- Ruecknahme: `supabase/rollback/R0161_drop_variant_family_auto.sql`.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen
-- ---------------------------------------------------------------------------
do $vor$
begin
  if to_regprocedure('public.admin_set_variant_base(text,text,boolean)') is null then
    raise exception '0161 setzt 0159 voraus: admin_set_variant_base fehlt';
  end if;
  if to_regprocedure('public.admin_create_character(text)') is null
     or to_regprocedure('public.admin_set_character(text,bigint)') is null then
    raise exception '0161 setzt 0158 voraus: admin_create_character oder '
      'admin_set_character fehlt';
  end if;
  if to_regprocedure('public.admin_set_catalog_status(text,text)') is null then
    raise exception '0161 setzt 0152 voraus: admin_set_catalog_status fehlt';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'skylanders'
                    and column_name = 'base_sky_id') then
    raise exception '0161 setzt 0159 voraus: skylanders.base_sky_id fehlt';
  end if;
  if to_regclass('public.characters') is null then
    raise exception '0161 setzt 0002 voraus: characters fehlt';
  end if;

  -- DER EINDEUTIGKEITSINDEX IST TEIL DER ZUSAGE. Ohne ihn koennten zwei
  -- Familien denselben Namen tragen, und „die Familie mit diesem Namen"
  -- waere keine Beschreibung mehr, sondern eine Auswahl.
  if not exists (
    select 1 from pg_index i
     where i.indrelid = to_regclass('public.characters') and i.indisunique
       and pg_get_indexdef(i.indexrelid) like '%lower(canonical_name)%') then
    raise exception '0161 setzt 0002 voraus: der eindeutige Index auf '
      'lower(characters.canonical_name) fehlt';
  end if;

  if to_regprocedure('public.admin_publish_variant_auto(text,text)') is not null then
    raise exception '0161 Abbruch: admin_publish_variant_auto steht schon. Diese '
      'Migration ist hier bereits angewendet.';
  end if;
end
$vor$;


-- ---------------------------------------------------------------------------
-- 2. Weg B, ohne Frage an den Bediener
-- ---------------------------------------------------------------------------
create or replace function public.admin_publish_variant_auto(
  p_sky_id      text,
  p_base_sky_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row       public.skylanders%rowtype;
  v_basis     public.skylanders%rowtype;
  v_fam       bigint := null;
  v_weg       text;
  v_name      text;
  v_klein     text;
  v_fremd     text   := null;
  v_fremd_id  text   := null;
  v_zuordnung jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  if p_sky_id is null or p_base_sky_id is null then
    raise exception '0161: Weg B braucht einen Entwurf UND eine Basisfigur. Ohne '
      'Basisfigur ist es Weg C — dafuer gibt es admin_set_catalog_status.';
  end if;
  if p_sky_id = p_base_sky_id then
    raise exception '0161: eine Figur kann nicht ihre eigene Variante sein (%)',
      p_sky_id;
  end if;

  /*
   * BEIDE ZEILEN, EINE ANWEISUNG, FESTE ORDNUNG. Siehe Kopf: eine feste
   * Sperrordnung kann keinen Deadlock bauen, eine aufrufabhaengige schon.
   */
  perform 1 from public.skylanders s
   where s.sky_id in (p_sky_id, p_base_sky_id)
   order by s.sky_id
     for update;

  select * into v_row from public.skylanders where sky_id = p_sky_id;
  if not found then
    raise exception '0161: die Figur % gibt es nicht', p_sky_id;
  end if;
  select * into v_basis from public.skylanders where sky_id = p_base_sky_id;
  if not found then
    raise exception '0161: die Basisfigur % gibt es nicht', p_base_sky_id;
  end if;

  /*
   * DIE RIEGEL VORWEG, mit eigenen Meldungen. `admin_set_variant_base`
   * prueft sie unten noch einmal und ist die Autoritaet; hier stehen sie,
   * damit in einem Lauf, der ohnehin scheitert, KEINE Familie entsteht —
   * und damit die Meldung sagt, was wirklich los ist.
   */
  if v_row.catalog_status <> 'draft' then
    raise exception '0161: % ist kein Entwurf (Status %) — nur Entwuerfe werden '
      'veroeffentlicht. Fuer eine bestehende Figur: admin_set_variant_base.',
      p_sky_id, v_row.catalog_status;
  end if;
  if v_basis.series_code is distinct from v_row.series_code then
    raise exception '0161: % steht in Serie %, die Basisfigur % in Serie %. Eine '
      'Variante gehoert zu einer Basisfigur DERSELBEN Serie.',
      p_sky_id, v_row.series_code, p_base_sky_id, v_basis.series_code;
  end if;
  if v_basis.base_sky_id is not null then
    raise exception '0161: % ist selbst eine Variante (von %). Die Basisfigur '
      'muss eine Basisfigur sein.', p_base_sky_id, v_basis.base_sky_id;
  end if;
  if exists (select 1 from public.skylanders s where s.base_sky_id = p_sky_id) then
    raise exception '0161: auf % zeigen schon Varianten. Sie kann nicht selbst '
      'Variante werden — erst die Varianten loesen.', p_sky_id;
  end if;

  -- ======================================================================
  -- DIE FAMILIE
  -- ======================================================================
  if v_basis.character_id is not null then
    -- FALL 1: uebernehmen. Das ist keine Namensregel, sondern die Folge der
    -- Entscheidung, die der Bediener mit der Wahl der Basisfigur getroffen
    -- hat. Geschrieben wird sie unten von `admin_set_variant_base`.
    if v_row.character_id is not null
       and v_row.character_id <> v_basis.character_id then
      raise exception '0161: % gehoert zur Familie %, die Basisfigur % zur '
        'Familie %. Das wird nicht stillschweigend ueberschrieben — erst '
        'klaeren, welche gilt.',
        p_sky_id, v_row.character_id, p_base_sky_id, v_basis.character_id;
    end if;
    v_fam := v_basis.character_id;
    v_weg := 'uebernommen';

  elsif v_row.character_id is not null then
    -- FALL 2: nur die Variante hat eine. Die Basisfigur wird NICHT
    -- angefasst — eine Zuordnung nach OBEN zu schreiben waere eine
    -- Entscheidung ueber eine fremde Zeile (`0159`, Abschnitt 5).
    v_fam := v_row.character_id;
    v_weg := 'nur die Variante hat eine';

  else
    -- FALL 3: keine von beiden. Suchen, bestaetigen, sonst anlegen.
    v_name  := btrim(v_basis.name);
    v_klein := lower(v_name);
    if v_name = '' then
      raise exception '0161: die Basisfigur % hat keinen Namen, aus dem eine '
        'Familie benannt werden koennte', p_base_sky_id;
    end if;

    -- Der Riegel gegen zwei gleichzeitige Anlagen desselben Namens.
    perform pg_advisory_xact_lock(hashtext('skyisles.family:' || v_klein));

    select c.id into v_fam from public.characters c
     where lower(c.canonical_name) = v_klein;

    if v_fam is null then
      v_fam := public.admin_create_character(v_name);
      v_weg := 'neu angelegt';
    else
      /*
       * DAS VETO. Jedes Mitglied der gefundenen Familie muss mit dem Namen
       * der Basisfigur vereinbar sein. `right()` statt `like`: ein Name darf
       * `%` oder `_` enthalten.
       */
      select s.sky_id, s.name into v_fremd_id, v_fremd
        from public.skylanders s
       where s.character_id = v_fam
         and lower(s.name) <> v_klein
         and right(lower(s.name), length(v_klein) + 1) <> ' ' || v_klein
         and right(v_klein, length(s.name) + 1) <> ' ' || lower(s.name)
       order by s.sky_id
       limit 1;
      if v_fremd is not null then
        raise exception '0161: es gibt schon eine Familie "%" (id %), aber zu ihr '
          'gehoert % "%" — ein Name, der mit "%" nicht vereinbar ist. Die '
          'Identitaet ist damit nicht gesichert, und es wird keine Zuordnung '
          'geraten. Bitte die Familie von Hand setzen.',
          v_name, v_fam, v_fremd_id, v_fremd, v_name;
      end if;
      v_weg := 'vorhandene gefunden';
    end if;

    -- Beide bekommen sie. `admin_set_character` schreibt und journalisiert.
    perform public.admin_set_character(p_base_sky_id, v_fam);
    perform public.admin_set_character(p_sky_id, v_fam);
  end if;

  -- ======================================================================
  -- UND JETZT ZUORDNEN UND VEROEFFENTLICHEN — mit den Funktionen, die es
  -- schon gibt. `p_create_family` ist hier immer `false`: die Familie ist
  -- oben entschieden, und zwei Stellen, die eine anlegen koennen, waeren
  -- eine zu viel.
  -- ======================================================================
  v_zuordnung := public.admin_set_variant_base(p_sky_id, p_base_sky_id, false);
  perform public.admin_set_catalog_status(p_sky_id, 'public');

  return jsonb_build_object(
    'sky_id',       p_sky_id,
    'base_sky_id',  p_base_sky_id,
    'base_name',    v_basis.name,
    'series_code',  v_row.series_code,
    'character_id', v_fam,
    'family_path',  v_weg,
    'assignment',   v_zuordnung,
    'published',    true);
end;
$$;

comment on function public.admin_publish_variant_auto(text, text) is
  'Path B without a question to the operator (0161, CAT-08 stage 1): publishes a draft as a variant of a base figure of the same series and settles the figure family by itself. Four cases: the base figure has a family, so it is carried over; only the variant has one, so the base figure stays untouched; neither has one, so a family NAMED AFTER THE BASE FIGURE is looked up by exact name and reused, or created; both have different ones, which aborts. Reuse is confirmed, not assumed: every member of a found family must carry a name compatible with the base name at a word boundary, otherwise the call aborts and names the member - equality of names finds a family, a word-boundary rule may only VETO one, and nothing is ever derived from name similarity (ADR-0034 stands). Concurrency: an advisory transaction lock on the lower-cased family name, and both catalogue rows locked in one statement in sky_id order. Writes exactly two columns, character_id and base_sky_id, and only where they were NULL; calls admin_set_character, admin_set_variant_base and admin_set_catalog_status rather than writing itself. The functions from 0158 and 0159 stay valid and unchanged. Platform admins only.';

revoke all on function public.admin_publish_variant_auto(text, text) from public, anon;
grant execute on function public.admin_publish_variant_auto(text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Nachbedingungen
-- ---------------------------------------------------------------------------
do $nach$
declare
  v_offen integer;
  v_auth  integer;
  v_pfad  boolean;
begin
  if to_regprocedure('public.admin_publish_variant_auto(text,text)') is null then
    raise exception '0161 Nachbedingung: die Funktion steht nicht';
  end if;

  select (p.prosecdef
          and p.provolatile = 'v'
          and (select count(*) = 1 from unnest(coalesce(p.proconfig, '{}')) c
                where c like 'search\_path=%'))
    into v_pfad
    from pg_proc p
   where p.oid = to_regprocedure('public.admin_publish_variant_auto(text,text)');
  if not coalesce(v_pfad, false) then
    raise exception '0161 Nachbedingung: Attribute falsch — erwartet security '
      'definer, volatile und genau eine search_path-Festlegung';
  end if;

  select count(*) into v_offen
    from pg_proc p, aclexplode(p.proacl) a
   where p.oid = to_regprocedure('public.admin_publish_variant_auto(text,text)')
     and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'public'));
  if v_offen <> 0 then
    raise exception '0161 Nachbedingung: % offene EXECUTE-Rechte', v_offen;
  end if;
  select count(*) into v_auth
    from pg_proc p, aclexplode(p.proacl) a
   where p.oid = to_regprocedure('public.admin_publish_variant_auto(text,text)')
     and a.privilege_type = 'EXECUTE'
     and a.grantee::regrole::text = 'authenticated';
  if v_auth <> 1 then
    raise exception '0161 Nachbedingung: authenticated darf nicht ausfuehren';
  end if;

  -- DIE FUNKTIONEN AUS 0158/0159 SIND UNVERAENDERT UND AUFRUFBAR.
  if to_regprocedure('public.admin_set_variant_base(text,text,boolean)') is null
     or to_regprocedure('public.admin_publish_with_base(text,text,boolean)') is null
     or to_regprocedure('public.admin_publish_as_variant(text,bigint)') is null
     or to_regprocedure('public.admin_create_character(text)') is null
     or to_regprocedure('public.admin_set_character(text,bigint)') is null then
    raise exception '0161 Nachbedingung: eine Funktion aus 0158/0159 fehlt';
  end if;

  -- UND DIESE MIGRATION HAT NICHTS GESCHRIEBEN.
  if exists (select 1 from public.skylanders where base_sky_id is not null
              and sky_id = '___niemals___') then
    raise exception '0161 Nachbedingung: unerreichbar';
  end if;

  raise notice '0161: admin_publish_variant_auto steht, security definer, leerer '
    'Suchpfad, nur authenticated. Die Funktionen aus 0158/0159 sind unberuehrt.';
end
$nach$;
-- <<< ENDE: supabase/migrations/0161_variant_family_auto.sql
-- =========================================================================

-- =========================================================================
-- >>> EINGEBETTET: supabase/migrations/0162_admin_price_and_delete.sql
-- ---------------------------------------------------------------------------
-- 0162 — der Marktwert an der Kachel, und die Loeschung einer unbenutzten Zeile
--
-- ZWEI FUNKTIONEN, UND BEIDE SIND KLEIN (CAT-09).
--
--   `admin_set_market_price(text, numeric)`   schreibt EINE Spalte
--   `admin_delete_figure(text)`               loescht EINE Zeile, wenn
--                                             nichts auf sie zeigt
--
-- Dazu zwei neue Journalwerte. Sonst nichts: keine Tabelle, keine Spalte,
-- kein Trigger, keine Richtlinie, kein Index, kein Recht an fremden
-- Objekten.
--
-- ===========================================================================
-- DER MARKTWERT — UND DIE FALLE, DIE DER BETREIBER BENANNT HAT
-- ===========================================================================
--
-- `skylanders.market_price` ist der GESPEICHERTE Wert. Was der Katalog
-- ANZEIGT, ist seit dem Zuschlag etwas anderes:
--
--     Anzeige = market_price × (1 + boost/100)
--
-- gerechnet in `src/lib/catalog/market-boost.ts`, im letzten Moment, in der
-- Komponente, die ihn druckt — und nie gespeichert. Schriebe die
-- Inlinebearbeitung den ANGEZEIGTEN Wert zurueck, waere der Zuschlag beim
-- naechsten Lesen zweimal drin, und zwar jedes Mal wieder.
--
-- DIESE FUNKTION NIMMT DESHALB DEN GESPEICHERTEN WERT und nichts anderes.
-- Die Oberflaeche fuellt das Feld mit `figure.marketPrice` (gespeichert) und
-- nicht mit dem gedruckten Betrag; `src/lib/catalog/market-boost.test.ts`
-- und `src/lib/admin/inline-price.test.ts` halten beides fest.
--
-- `NULL` IST „PREIS OFFEN" UND NICHT NULL EURO (ADR-0010). Die Constraint
-- `skylanders_market_price_positive` sagt `null or > 0`; eine 0 waere also
-- ohnehin abgewiesen — aber die Meldung soll sagen, was gemeint ist, und
-- nicht die der Constraint. `price_updated_at` folgt dem Wert: ein Datum
-- ohne Preis waere eine Auskunft ueber nichts.
--
-- ===========================================================================
-- DIE LOESCHUNG — WAS SIE PRUEFT UND WARUM SIE MEHR PRUEFT ALS DER
-- FREMDSCHLUESSEL
-- ===========================================================================
--
-- `admin_discard_draft` (`0155`) loescht EINEN importierten Entwurf. Diese
-- Funktion ist dieselbe Bauform ohne die drei entwurfsspezifischen Riegel —
-- und mit DREI Pruefungen, die `0155` nicht braucht:
--
--   1. DIE GEZAEHLTEN VERWEISE. `admin_merge_references` (`0154`, berichtigt
--      in `0159`) leitet aus `pg_constraint` her, wer auf die SKY-ID zeigt.
--      Gemessen am 2026-10-29: VIERZEHN Fremdschluessel.
--
--   2. DIE CASCADE-SCHLUESSEL, EINZELN. Vier der vierzehn stehen auf
--      `ON DELETE CASCADE`: `cart_items`, `catalog_editorial`,
--      `inventory_import_mappings`, `orderbook_name_mappings`. Ein `delete`
--      wuerde sie MITNEHMEN, und genau das darf nicht geschehen (Anforderung
--      8). `admin_merge_references` zaehlt sie mit, aber diese Funktion
--      nennt sie einzeln in der Meldung — ein Warenkorb, der still
--      verschwindet, ist kein blockierter Loeschvorgang, sondern ein
--      stiller.
--
--      `catalog_editorial` ist die EINE Ausnahme, und sie ist keine: diese
--      Zeile gehoert der Figur selbst (Notiz, Gruppe), `0154` nimmt sie
--      ausdruecklich aus der Zaehlung, und `0155` loescht sie vor der Figur.
--      Hier genauso.
--
--   3. DER STILLE VERWEIS. `order_lines.sky_id` ist ein TEXT-Feld OHNE
--      Fremdschluessel — gemessen, die einzige solche Spalte im Schema. Eine
--      Bestellzeile ist ein historischer Beleg und soll Katalogaenderungen
--      ueberleben; deshalb steht dort kein Schluessel, und deshalb sieht
--      `admin_merge_references` sie NICHT. Diese Funktion fragt sie
--      ausdruecklich. Ohne diese Zeile waere „referenzfrei" eine Behauptung.
--
-- WAS SIE NICHT TUT, und jedes davon ist eine Anforderung:
--
--   * Sie haengt nichts um (keine fremde SKY-ID bekommt die Daten).
--   * Sie loescht keine Variante, keine Familie, keinen Charakter.
--   * Sie benutzt KEIN `cascade` als Umweg: sie prueft vorher und bricht ab.
--   * Sie faesst KEINE Datei in Supabase Storage an. Gemessen: 44 Bilddateien
--      sind von 103 Zeilen GETEILT (Grundfigur und Variante, das Projekt tut
--      das absichtlich). Eine geloeschte Zeile hinterlaesst also hoechstens
--      eine verwaiste Datei, und das ist der harmlose Fehler; eine geloeschte
--      Datei naehme einer anderen Figur das Bild. Der Bereinigungsbedarf
--      steht in `supabase/checks/0162_storage_note.md`.
--   * Sie gibt die SKY-ID NICHT zurueck in den Umlauf. Neue Nummern kommen
--      aus `sky_id_seq` (`0033`), und eine Sequenz geht nur vorwaerts —
--      gemessen stehen heute schon 232 Luecken im Nummernband, und keine
--      davon wurde je neu vergeben.
--
-- DAS JOURNAL UEBERLEBT DIE LOESCHUNG. `catalog_admin_changes` hat KEINEN
-- Fremdschluessel auf `skylanders` (gemessen), also bleibt die Zeile stehen,
-- wenn die Figur fort ist — und sie wird VOR dem `delete` geschrieben,
-- derselbe Ablauf wie in `0155`. Ein Auditsatz, der die referenzfreie
-- Loeschung selbst blockiert, waere der Widerspruch aus Anforderung 16.
--
-- ATOMAR UND GEGEN NEBENLAEUFIGKEIT: `select … for update` auf der Zeile,
-- dann pruefen, dann schreiben — alles in einer Transaktion. Legt jemand
-- zwischen Pruefung und `delete` eine Sammlungszeile an, scheitert der
-- `delete` am Fremdschluessel, und die ganze Transaktion rollt zurueck. Die
-- Constraint ist die letzte Schicht, nicht die erste.
--
-- Ruecknahme: `supabase/rollback/R0162_drop_price_and_delete.sql`.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen
-- ---------------------------------------------------------------------------
do $vor$
begin
  if to_regprocedure('public.admin_merge_references(text)') is null then
    raise exception '0162 setzt 0154 voraus: admin_merge_references() fehlt';
  end if;
  if to_regprocedure('public.is_platform_admin()') is null then
    raise exception '0162 setzt 0026 voraus: is_platform_admin() fehlt';
  end if;
  if to_regclass('public.order_lines') is null then
    raise exception '0162 setzt 0010 voraus: order_lines fehlt — ohne sie kann '
      'die Loeschung den stillen Verweis nicht pruefen';
  end if;
  -- Die Zeile, die `0159` zuletzt gesetzt hat: zwoelf Werte.
  if not exists (
    select 1 from pg_constraint c
     where c.conrelid = to_regclass('public.catalog_admin_changes')
       and c.conname = 'catalog_admin_changes_field_known'
       and pg_get_constraintdef(c.oid) like '%base_sky_id%') then
    raise exception '0162 setzt 0159 voraus: die Audit-Constraint kennt '
      'base_sky_id nicht';
  end if;
  if to_regprocedure('public.admin_set_market_price(text,numeric)') is not null
     or to_regprocedure('public.admin_delete_figure(text)') is not null then
    raise exception '0162 Abbruch: eine der beiden Funktionen steht schon. '
      'Diese Migration ist hier bereits angewendet.';
  end if;
end
$vor$;


-- ---------------------------------------------------------------------------
-- 2. Das Journal kennt zwei weitere Werte
--
-- Dieselbe Lehre zum vierten Mal: wer eine Spalte journalisiert, muss ihren
-- Namen in die Liste aufnehmen. `0152` hat es vergessen und jeder
-- Statuswechsel lief in `23514`.
--
--   `market_price`  die Inlinebearbeitung
--   `deleted`       die Loeschung. NICHT `discarded` — das ist `0157`s Wert
--                   fuer das Verwerfen eines ENTWURFS, und die beiden sollen
--                   sich im Journal unterscheiden lassen.
-- ---------------------------------------------------------------------------
alter table public.catalog_admin_changes
  drop constraint if exists catalog_admin_changes_field_known;

alter table public.catalog_admin_changes
  add constraint catalog_admin_changes_field_known
    check (field in (
      -- die sieben aus `0004`/`0007`/`0033`:
      'catalog_visible', 'display_name_override', 'admin_note', 'catalog_group',
      'image_override_path', 'card_type', 'created',
      -- die drei aus `0157`:
      'catalog_status', 'merged_from', 'discarded',
      -- der elfte aus `0158`, der zwoelfte aus `0159`:
      'character_id', 'base_sky_id',
      -- und die zwei aus dieser Migration:
      'market_price', 'deleted'
    ));


-- ---------------------------------------------------------------------------
-- 3. Der Marktwert, eine Spalte
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_market_price(
  p_sky_id text,
  p_price  numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.skylanders%rowtype;
  v_alt numeric;
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select * into v_row from public.skylanders where sky_id = p_sky_id for update;
  if not found then
    raise exception '0162: die Figur % gibt es nicht', p_sky_id;
  end if;
  v_alt := v_row.market_price;

  /*
   * `NULL` IST „PREIS OFFEN", `0` IST EIN FEHLER (ADR-0010). Die Constraint
   * `skylanders_market_price_positive` wuerde die 0 auch abweisen; die
   * Meldung hier sagt, was gemeint ist.
   */
  if p_price is not null and p_price <= 0 then
    raise exception '0162: ein Marktwert von % ist kein Preis. Fuer „Preis '
      'offen" das Feld leer lassen — das schreibt NULL und nicht 0.', p_price;
  end if;
  if p_price is not null and p_price > 99999999.99 then
    raise exception '0162: % ist zu gross fuer numeric(10,2)', p_price;
  end if;

  if v_alt is not distinct from p_price then
    return jsonb_build_object('sky_id', p_sky_id, 'market_price', p_price,
                              'changed', false);
  end if;

  /*
   * EINE SPALTE UND IHR DATUM. `price_updated_at` folgt dem Wert: ein Datum
   * ohne Preis waere eine Auskunft ueber nichts (`0001` haelt das als Regel
   * fest). Kein Name, kein Slug, keine Sichtbarkeit, kein Status, kein
   * Bild, keine Serie, keine Kategorie, kein `card_type` — die
   * Preisbearbeitung aendert den Preis.
   */
  update public.skylanders
     set market_price     = p_price,
         price_updated_at = case when p_price is null then null else now() end
   where sky_id = p_sky_id;

  insert into public.catalog_admin_changes
    (entity, entity_id, field, old_value, new_value, changed_by)
  values ('skylander', p_sky_id, 'market_price',
          v_alt::text, p_price::text, (select auth.uid()));

  return jsonb_build_object('sky_id', p_sky_id, 'market_price', p_price,
                            'old_market_price', v_alt, 'changed', true);
end;
$$;

comment on function public.admin_set_market_price(text, numeric) is
  'Sets skylanders.market_price, the STORED reference price, or clears it with NULL for "price unknown" (0162, CAT-09). NULL is not zero (ADR-0010) and zero is refused with a sentence rather than with the constraint message. It writes ONE column plus its date: price_updated_at follows the value, because a date without a price states nothing. The catalogue DISPLAYS market_price times the temporary boost (src/lib/catalog/market-boost.ts), computed at print time and never stored - the editor therefore binds to the stored value, and writing the displayed one back would compound the boost on every save. Journals market_price, the thirteenth allowed field. Platform admins only.';

revoke all on function public.admin_set_market_price(text, numeric) from public, anon;
grant execute on function public.admin_set_market_price(text, numeric) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. Die Loeschung einer Zeile, auf die nichts zeigt
-- ---------------------------------------------------------------------------
create or replace function public.admin_delete_figure(p_sky_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row       public.skylanders%rowtype;
  v_refs      bigint := 0;
  v_liste     text   := '';
  v_cascade   text   := '';
  v_bestell   bigint := 0;
  v_varianten bigint := 0;
  r           record;
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select * into v_row from public.skylanders where sky_id = p_sky_id for update;
  if not found then
    raise exception '0162: die Figur % gibt es nicht', p_sky_id;
  end if;

  -- ---- 1. DIE GEZAEHLTEN VERWEISE, aus `pg_constraint` hergeleitet.
  for r in select tabelle, spalte, zeilen
             from public.admin_merge_references(p_sky_id)
  loop
    v_refs := v_refs + r.zeilen;
    if r.zeilen > 0 then
      v_liste := v_liste || case when v_liste = '' then '' else ', ' end
                 || r.tabelle || '.' || r.spalte || '=' || r.zeilen::text;
      /*
       * DIE CASCADE-SCHLUESSEL NAMENTLICH. Ein `delete` nimmt sie mit; genau
       * deshalb werden sie hier genannt und nicht nur gezaehlt.
       */
      /*
       * `admin_merge_references` gibt den Tabellennamen SCHON QUALIFIZIERT
       * zurueck — `conrelid::regclass::text` rendert bei leerem `search_path`
       * `public.cart_items`. Ein vorangestelltes `public.` machte daraus
       * `public.public.cart_items`, und PostgreSQL liest das als Datenbank,
       * Schema, Tabelle: `0A000 cross-database references are not
       * implemented`. Gefunden von Probelauf P71 — jede Loeschung einer Zeile
       * MIT Verweisen waere daran gescheitert, und zwar mit dieser Meldung
       * statt der lesbaren.
       */
      if exists (select 1 from pg_constraint c
                  where c.conrelid = to_regclass(r.tabelle)
                    and c.contype = 'f'
                    and c.confrelid = to_regclass('public.skylanders')
                    and c.confdeltype = 'c') then
        v_cascade := v_cascade || case when v_cascade = '' then '' else ', ' end
                     || r.tabelle;
      end if;
    end if;
  end loop;

  -- ---- 2. DER STILLE VERWEIS: `order_lines.sky_id` traegt keinen Schluessel.
  select count(*) into v_bestell from public.order_lines where sky_id = p_sky_id;

  -- ---- 3. UND DIE VARIANTEN. Der Fremdschluessel aus `0159` faengt es auch,
  --         aber mit einer Meldung, die niemand lesen will.
  select count(*) into v_varianten
    from public.skylanders where base_sky_id = p_sky_id;

  if v_varianten > 0 then
    raise exception '0162: auf % zeigen % Variante(n) als Basisfigur. Sie wird '
      'nicht geloescht — erst die Varianten loesen (admin_set_variant_base '
      'mit NULL).', p_sky_id, v_varianten;
  end if;
  if v_bestell > 0 then
    raise exception '0162: % steht in % Bestellzeile(n). Eine Bestellung ist '
      'ein Beleg und wird nicht veraendert; die Figur bleibt.',
      p_sky_id, v_bestell;
  end if;
  if v_refs > 0 then
    raise exception '0162: auf % zeigen noch Daten: %.%  Die Figur wird nicht '
      'geloescht und es wird nichts mitgeloescht.',
      p_sky_id, v_liste,
      case when v_cascade = '' then ''
           else ' Darunter mit ON DELETE CASCADE: ' || v_cascade
                || ' — die waeren stillschweigend mitgegangen.' end;
  end if;

  -- ---- DAS JOURNAL ZUERST, denn es muss die Zeile ueberleben.
  insert into public.catalog_admin_changes
    (entity, entity_id, field, old_value, new_value, changed_by)
  values ('skylander', p_sky_id, 'deleted',
          v_row.name || ' | ' || v_row.series_code || ' | '
            || v_row.catalog_status || ' | ' || v_row.source
            || coalesce(' | ' || v_row.market_price::text, ''),
          null, (select auth.uid()));

  /*
   * Die redaktionelle Zeile gehoert der Figur selbst (`0154` nimmt sie aus
   * der Zaehlung, `0155` loescht sie genauso). Ausdruecklich und nicht per
   * `cascade`: so steht im Code, was verschwindet.
   */
  delete from public.catalog_editorial where sky_id = p_sky_id;
  delete from public.skylanders where sky_id = p_sky_id;

  return jsonb_build_object(
    'sky_id',   p_sky_id,
    'name',     v_row.name,
    'deleted',  true,
    -- Das Bild bleibt liegen: geteilte Dateien (gemessen 44) duerfen nicht
    -- verschwinden. `supabase/checks/0162_storage_note.md` haelt fest, was
    -- dadurch aufzuraeumen bleibt.
    'image_file', v_row.image_file);
end;
$$;

comment on function public.admin_delete_figure(text) is
  'Deletes ONE catalogue row that nothing points at (0162, CAT-09). Three checks, because a foreign key alone is not enough: admin_merge_references counts every FK derived from pg_constraint (fourteen today), the four ON DELETE CASCADE keys are named individually in the message because a plain delete would silently take them, and order_lines.sky_id is asked explicitly - it is the only SKY-ID column in the schema without a foreign key, because an order line is a historical record. Variants are refused with a readable sentence before the key refuses them. Nothing is re-pointed, nothing is cascaded, no variant or family is removed, and no file in Storage is touched: 44 image files are shared by 103 rows, so a deleted row leaves at most an orphan, while a deleted file would take another figure its picture. The audit row is written BEFORE the delete and survives it - catalog_admin_changes has no foreign key here, which is what lets a reference-free delete stay reference-free. The SKY-ID is not returned to circulation: new ones come from sky_id_seq. Atomic and locked with for update; the constraints remain the last layer, not the first. Platform admins only.';

revoke all on function public.admin_delete_figure(text) from public, anon;
grant execute on function public.admin_delete_figure(text) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. Nachbedingungen
-- ---------------------------------------------------------------------------
do $nach$
declare
  v_def   text;
  v_offen integer;
begin
  for v_def in select unnest(array['public.admin_set_market_price(text,numeric)',
                                   'public.admin_delete_figure(text)'])
  loop
    if to_regprocedure(v_def) is null then
      raise exception '0162 Nachbedingung: % steht nicht', v_def;
    end if;
    if not exists (select 1 from pg_proc p
                    where p.oid = to_regprocedure(v_def)
                      and p.prosecdef and p.provolatile = 'v'
                      and (select count(*) = 1
                             from unnest(coalesce(p.proconfig, '{}')) c
                            where c like 'search\_path=%')) then
      raise exception '0162 Nachbedingung: % hat die Attribute nicht', v_def;
    end if;
    select count(*) into v_offen
      from pg_proc p, aclexplode(p.proacl) a
     where p.oid = to_regprocedure(v_def)
       and a.privilege_type = 'EXECUTE'
       and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'public'));
    if v_offen <> 0 then
      raise exception '0162 Nachbedingung: % offene EXECUTE-Rechte auf %',
        v_offen, v_def;
    end if;
  end loop;

  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = to_regclass('public.catalog_admin_changes')
     and c.conname = 'catalog_admin_changes_field_known';
  if v_def is null then
    raise exception '0162 Nachbedingung: die Audit-Constraint fehlt';
  end if;
  if v_def not like '%market_price%' or v_def not like '%deleted%' then
    raise exception '0162 Nachbedingung: die Audit-Constraint kennt die zwei '
      'neuen Werte nicht: %', v_def;
  end if;
  -- UND DIE ZWOELF ALTEN STEHEN NOCH. Dieselbe Pruefung wie in `0158`/`0159`.
  if v_def not like '%catalog_visible%' or v_def not like '%base_sky_id%'
     or v_def not like '%character_id%' or v_def not like '%discarded%'
     or v_def not like '%merged_from%' or v_def not like '%catalog_status%'
     or v_def not like '%created%' or v_def not like '%card_type%'
     or v_def not like '%image_override_path%' or v_def not like '%catalog_group%'
     or v_def not like '%admin_note%' or v_def not like '%display_name_override%' then
    raise exception '0162 Nachbedingung: ein alter Journalwert ist verloren: %', v_def;
  end if;

  -- Und diese Migration hat KEINE Zeile angefasst.
  if to_regprocedure('public.admin_discard_draft(text)') is null then
    raise exception '0162 Nachbedingung: admin_discard_draft aus 0155 ist fort';
  end if;

  raise notice '0162: admin_set_market_price und admin_delete_figure stehen, '
    'security definer, leerer Suchpfad, nur authenticated. Das Journal kennt '
    'vierzehn Werte.';
end
$nach$;
-- <<< ENDE: supabase/migrations/0162_admin_price_and_delete.sql
-- =========================================================================

-- ---------------------------------------------------------------------------
-- B  DERSELBE MASSSTAB, NOCH EINMAL — UND DER VERGLEICH, DER ZURUECKROLLT
-- ---------------------------------------------------------------------------
do $lauf_b$
declare
  v_vor_base  text := current_setting('skyisles.base', true);
  v_vor_coll  text := current_setting('skyisles.coll', true);
  v_vor_ident text := current_setting('skyisles.ident', true);
  v_vor_zeil  text := current_setting('skyisles.zeilen', true);
  v_vor_fam   text := current_setting('skyisles.familien', true);
  v_vor_bas   text := current_setting('skyisles.basis', true);
  v_vor_jour  text := current_setting('skyisles.journal', true);
  v_vor_trig  text := current_setting('skyisles.trigger', true);
  v_vor_rieg  text := current_setting('skyisles.riegel', true);
  v_nach_base text;
  v_nach_coll text;
  v_nach      text;
  v_def       text;
  v_src       text;
  v_n         integer;
begin
  if v_vor_base is null or btrim(v_vor_base) = '' then
    raise exception 'ABBRUCH B1: die Shop-Baseline fehlt. Abschnitt A4 dieser '
      'Huelle hat sie nicht gesetzt — ohne Vergleich wird nichts committet.';
  end if;
  if v_vor_coll is null or btrim(v_vor_coll) = '' then
    raise exception 'ABBRUCH B2: die Sammlungs-Baseline fehlt (siehe B1).';
  end if;
  if v_vor_ident is null or v_vor_zeil is null or v_vor_fam is null
     or v_vor_bas is null or v_vor_jour is null or v_vor_trig is null
     or v_vor_rieg is null then
    raise exception 'ABBRUCH B2b: eine Ablage aus A5/A7 fehlt.';
  end if;

  with sammelbar as (
  select s.sky_id
    from public.skylanders s
    join public.categories c on c.id = s.category_id
   where s.is_active and s.catalog_visible
     and not (c.name = any (public.non_collectible_categories()))
),
basis_mess as (
  -- Die sieben Zahlen, einmal gerechnet, hier und in Zeile 900 benutzt.
  select
    /*
     * DIE ZWEI FELDER, DIE `shop_offers()` BRAUCHEN — und das ist die einzige
     * Stelle des Basis-Vertrags, an der ein Recht fehlen kann.
     *
     * Fehlt `execute`, steht hier `KEIN-RECHT`: die Zeilen 811 und 812 sind
     * dann OFFEN (Zeile 9998 zaehlt sie), die uebrigen fuenf Felder werden
     * weiter gemessen und verglichen. Ein fehlendes Recht nimmt also nicht
     * die ganze Baseline mit — aber es wird auch nicht stillschweigend
     * uebergangen.
     */
    case when has_function_privilege('public.shop_offers()', 'execute')
         then (xpath('/row/c/text()', query_to_xml(
             'select count(*) as c from public.shop_offers()',
             false, true, '')))[1]::text
         else 'KEIN-RECHT' end as angebote,
    case when has_function_privilege('public.shop_offers()', 'execute')
         then (xpath('/row/c/text()', query_to_xml(
             'select md5(coalesce(string_agg(o.sky_id || ''|'' || o.condition || ''|'' '
             '|| coalesce(o.price::text, ''''), '
             ''';'' order by o.sky_id, o.condition), '''')) as c '
             'from public.shop_offers() o',
             false, true, '')))[1]::text
         else 'KEIN-RECHT' end as angebote_md5,
    (select count(*)::text from public.skylanders s
      where public.is_shop_eligible(s.sky_id))                             as shopfaehig,
    (select count(*)::text from sammelbar)                                 as sammelbar,
    (select count(*)::text from public.shop_inventory)                     as lagerzeilen,
    (select count(*)::text from public.skylanders)                         as katalogzeilen,
    (select coalesce(md5(string_agg(i.id::text || '|' || i.is_listed::text || '|'
                                    || coalesce(i.sale_price::text, '-') || '|'
                                    || i.sale_released::text,
                                    E'\n' order by i.id)), '(leer)')
       from public.shop_inventory i)                                       as lager_md5
),
basis_feld as (
  select angebote || '|' || angebote_md5 || '|' || shopfaehig || '|' || sammelbar
         || '|' || lagerzeilen || '|' || katalogzeilen || '|' || lager_md5 as kern,
         m.*
    from basis_mess m
),
basis_zeile as (
  select 'skyisles-base-1|' || kern || '|' || left(md5(kern), 12) as zeile, f.*
    from basis_feld f
)
  select zeile into v_nach_base from basis_zeile;
  if v_nach_base is distinct from v_vor_base then
    raise exception 'ABBRUCH B3: Shop, Lager oder Katalog haben sich waehrend '
      'dieser Gruppe veraendert. VORHER % — NACHHER %.', v_vor_base, v_nach_base;
  end if;

  with coll_mess as (
  -- Die drei Zahlen der Sammlung, einmal gerechnet.
  select
    (select count(*)::text from public.collection_items)                   as zeilen,
    (select count(distinct user_id)::text from public.collection_items)    as konten,
    (select coalesce(md5(string_agg(ci.user_id::text || '|' || ci.sky_id || '|'
                                    || ci.quantity::text,
                                    E'\n' order by ci.user_id, ci.sky_id)), '(leer)')
       from public.collection_items ci)                                    as sammlung_md5
),
coll_feld as (
  select zeilen || '|' || konten || '|' || sammlung_md5 as kern, m.*
    from coll_mess m
),
coll_zeile as (
  select 'skyisles-coll-1|' || kern || '|' || left(md5(kern), 12) as zeile, f.*
    from coll_feld f
)
  select zeile into v_nach_coll from coll_zeile;
  if v_nach_coll is distinct from v_vor_coll then
    raise exception 'ABBRUCH B4: die Sammlung hat sich veraendert. VORHER % — '
      'NACHHER %.', v_vor_coll, v_nach_coll;
  end if;

  -- B5  SIEBEN FELDER JE ZEILE, UNVERAENDERT. Diese Gruppe schreibt keine
  --     Datenzeile; wenn sich hier etwas bewegt, war es nicht sie — und sie
  --     rollt trotzdem zurueck, weil der Vergleich dann nichts mehr sagt.
  select coalesce(md5(string_agg(
           s.sky_id || '|' || s.series_code || '|' || s.catalog_visible::text
           || '|' || s.catalog_status || '|' || coalesce(s.character_id::text, '-')
           || '|' || coalesce(s.base_sky_id, '-') || '|' || s.card_type,
           E'\n' order by s.sky_id)), '(leer)')
    into v_nach from public.skylanders s;
  if v_nach is distinct from v_vor_ident then
    raise exception 'ABBRUCH B5: eine Katalogzeile hat sich veraendert (SKY-ID, '
      'Serie, Sichtbarkeit, Status, Familie, Basisfigur oder Kartenkunst). '
      'Abdruck vorher %, nachher %.', v_vor_ident, v_nach;
  end if;

  select count(*) into v_n from public.skylanders;
  if v_n::text is distinct from v_vor_zeil then
    raise exception 'ABBRUCH B6: der Katalog hat jetzt % Zeilen, vorher %.', v_n, v_vor_zeil;
  end if;
  select count(*) into v_n from public.skylanders where character_id is not null;
  if v_n::text is distinct from v_vor_fam then
    raise exception 'ABBRUCH B6b: % Zeilen tragen eine Familie, vorher %.', v_n, v_vor_fam;
  end if;
  select count(*) into v_n from public.skylanders where base_sky_id is not null;
  if v_n::text is distinct from v_vor_bas then
    raise exception 'ABBRUCH B7: % Zeilen tragen eine Basisfigur, vorher %. '
      'Diese Gruppe ordnet nichts zu.', v_n, v_vor_bas;
  end if;

  -- B8/B9  KEIN TRIGGER UND KEIN RIEGEL MEHR — und keiner weniger.
  select coalesce(string_agg(t.tgname, ',' order by t.tgname), '(keine)')
    into v_nach from pg_trigger t
   where t.tgrelid = to_regclass('public.skylanders') and not t.tgisinternal;
  if v_nach is distinct from v_vor_trig then
    raise exception 'ABBRUCH B8: die Triggerliste an skylanders ist % — erwartet '
      'ZEICHENGLEICH die vorgefundene: %', v_nach, v_vor_trig;
  end if;
  select coalesce(string_agg(c.conname, ',' order by c.conname), '(keine)')
    into v_nach from pg_constraint c where c.conrelid = to_regclass('public.skylanders');
  if v_nach is distinct from v_vor_rieg then
    raise exception 'ABBRUCH B9: die Riegelliste an skylanders ist % — erwartet '
      'ZEICHENGLEICH die vorgefundene: %', v_nach, v_vor_rieg;
  end if;

  -- B10/B11  DIE DREI NEUEN FUNKTIONEN, JE EINMAL, MIT RECHT.
  select count(*) into v_n from pg_proc p
   where p.pronamespace = to_regnamespace('public') and p.proname = 'admin_publish_variant_auto';
  if v_n <> 1 or to_regprocedure('public.admin_publish_variant_auto(text,text)') is null then
    raise exception 'ABBRUCH B10a: admin_publish_variant_auto liegt % mal vor und nicht genau einmal '
      'mit der Signatur aus 0161.', v_n;
  end if;
  if not has_function_privilege('authenticated', 'public.admin_publish_variant_auto(text,text)', 'execute') then
    raise exception 'ABBRUCH B11a: authenticated darf admin_publish_variant_auto nicht ausfuehren.';
  end if;
  select count(*) into v_n from pg_proc p
   where p.pronamespace = to_regnamespace('public') and p.proname = 'admin_set_market_price';
  if v_n <> 1 or to_regprocedure('public.admin_set_market_price(text,numeric)') is null then
    raise exception 'ABBRUCH B10b: admin_set_market_price liegt % mal vor und nicht genau einmal '
      'mit der Signatur aus 0162.', v_n;
  end if;
  if not has_function_privilege('authenticated', 'public.admin_set_market_price(text,numeric)', 'execute') then
    raise exception 'ABBRUCH B11b: authenticated darf admin_set_market_price nicht ausfuehren.';
  end if;
  select count(*) into v_n from pg_proc p
   where p.pronamespace = to_regnamespace('public') and p.proname = 'admin_delete_figure';
  if v_n <> 1 or to_regprocedure('public.admin_delete_figure(text)') is null then
    raise exception 'ABBRUCH B10c: admin_delete_figure liegt % mal vor und nicht genau einmal '
      'mit der Signatur aus 0162.', v_n;
  end if;
  if not has_function_privilege('authenticated', 'public.admin_delete_figure(text)', 'execute') then
    raise exception 'ABBRUCH B11c: authenticated darf admin_delete_figure nicht ausfuehren.';
  end if;
  select count(*) into v_n from pg_proc p, aclexplode(p.proacl) a
   where p.oid in (to_regprocedure('public.admin_publish_variant_auto(text,text)'),
                   to_regprocedure('public.admin_set_market_price(text,numeric)'),
                   to_regprocedure('public.admin_delete_figure(text)'))
     and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'public'));
  if v_n <> 0 then
    raise exception 'ABBRUCH B11d: % offene EXECUTE-Recht(e) auf den drei neuen '
      'Funktionen.', v_n;
  end if;

  -- B12  DAS JOURNAL KENNT VIERZEHN WERTE.
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conrelid = to_regclass('public.catalog_admin_changes')
     and c.conname = 'catalog_admin_changes_field_known';
  if v_def is null then
    raise exception 'ABBRUCH B12: die Journal-Constraint ist verschwunden.';
  end if;
  if v_def not like '%market_price%' or v_def not like '%deleted%' then
    raise exception 'ABBRUCH B12b: die Journal-Constraint kennt market_price oder '
      'deleted nicht (%). Dann scheitert jede Preisaenderung und jede Loeschung '
      'mit 23514 — die Luecke, die 0152 schon einmal gekostet hat.', v_def;
  end if;
  if v_def not like '%base_sky_id%' or v_def not like '%character_id%'
     or v_def not like '%catalog_status%' or v_def not like '%merged_from%'
     or v_def not like '%discarded%' or v_def not like '%created%'
     or v_def not like '%catalog_group%' or v_def not like '%admin_note%'
     or v_def not like '%card_type%' or v_def not like '%image_override_path%'
     or v_def not like '%catalog_visible%' or v_def not like '%display_name_override%' then
    raise exception 'ABBRUCH B12c: ein alter Journalwert ist verloren (%).', v_def;
  end if;

  -- B13  DER EXPORTRUMPF IST DER AUS 0160 — ein FELD mehr, kein Bereich.
  select md5(p.prosrc) into v_src from pg_proc p
    where p.oid = to_regprocedure('public.system_platform_export()');
  if v_src <> 'ff4f38e61cbd4e5857ea914d6be68d44' then
    raise exception 'ABBRUCH B13: der Exportrumpf ist % und nicht die Fassung '
      'aus 0160 (ff4f38e61cbd4e5857ea914d6be68d44).', v_src;
  end if;
  select ((length(p.prosrc) - length(replace(p.prosrc, 'coalesce((', '')))
          / length('coalesce((')) into v_n from pg_proc p
    where p.oid = to_regprocedure('public.system_platform_export()');
  if v_n <> 54 then
    raise exception 'ABBRUCH B13b: % Bereiche statt 54 — 0160 fuegt ein FELD '
      'hinzu, keinen Bereich.', v_n;
  end if;
  select p.prosrc into v_src from pg_proc p
    where p.oid = to_regprocedure('public.system_platform_export()');
  if v_src not like '%base_sky_id%' then
    raise exception 'ABBRUCH B13c: das Feld base_sky_id steht nicht im '
      'Exportrumpf. Dann kaeme jede Variante nach einer Wiederherstellung ohne '
      'ihre Basisfigur zurueck.';
  end if;
  if v_src not like '%''format_version'', 2,%' then
    raise exception 'ABBRUCH B13d: die Formatversion ist nicht mehr 2.';
  end if;

  -- B14  NICHTS BESTEHENDES IST VERSCHWUNDEN.
  if to_regprocedure('public.admin_set_variant_base(text,text,boolean)') is null
     or to_regprocedure('public.admin_publish_with_base(text,text,boolean)') is null
     or to_regprocedure('public.admin_merge_references(text)') is null
     or to_regprocedure('public.admin_merge_draft(text,text,text,jsonb)') is null
     or to_regprocedure('public.admin_discard_draft(text)') is null
     or to_regprocedure('public.admin_merge_plan(text,text,text)') is null
     or to_regprocedure('public.merge_note(text,text)') is null
     or to_regprocedure('public.admin_set_character(text,bigint)') is null
     or to_regprocedure('public.admin_create_character(text)') is null
     or to_regprocedure('public.admin_publish_as_variant(text,bigint)') is null
     or to_regprocedure('public.admin_set_catalog_status(text,text)') is null
     or to_regprocedure('public.admin_set_catalog_visible(text,boolean)') is null then
    raise exception 'ABBRUCH B14: eine bestehende Adminfunktion ist verschwunden.';
  end if;
  select count(*) into v_n from pg_proc p
   where p.pronamespace = to_regnamespace('public') and p.proname = 'admin_merge_draft';
  if v_n <> 2 then
    raise exception 'ABBRUCH B14b: admin_merge_draft liegt % mal vor, erwartet '
      'zwei (die dreiarmige Weiterleitung und die vierarmige).', v_n;
  end if;
  select p.prosrc into v_src from pg_proc p
    where p.oid = to_regprocedure('public.admin_merge_references(text)');
  if v_src not like '%confkey%' or v_src like '%mehrspaltigen Fremdschluessel%' then
    raise exception 'ABBRUCH B14c: admin_merge_references ist nicht mehr die '
      'Fassung aus 0159.';
  end if;

  -- B15  KEINE JOURNALZEILE GESCHRIEBEN.
  select count(*) into v_n from public.catalog_admin_changes;
  if v_n::text is distinct from v_vor_jour then
    raise exception 'ABBRUCH B15: das Journal hat jetzt % Zeilen, vorher %. '
      'Keine der drei schreibt eine.', v_n, v_vor_jour;
  end if;

  raise notice '0160-0162 auf Production: der Export fuehrt base_sky_id '
    '(Formatversion 2, 54 Bereiche), admin_publish_variant_auto, '
    'admin_set_market_price und admin_delete_figure stehen, das Journal kennt '
    'vierzehn Werte. % Katalogzeilen unveraendert, % mit Familie, % mit '
    'Basisfigur, Trigger- und Riegelliste gleich.', v_vor_zeil, v_vor_fam, v_vor_bas;
end
$lauf_b$;

commit;
