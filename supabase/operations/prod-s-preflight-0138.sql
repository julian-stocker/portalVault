-- ===========================================================================
-- PRODUCTION — DER ZUSTAND VOR 0138, REIN LESEND
--
-- ###########################################################################
-- ##  DIES IST EINE PRODUCTION-DATEI. Projekt zmiwxswrpkmizvqsgype.        ##
-- ##  Sie bricht auf Staging ab, und zwar bevor sie etwas liest.           ##
-- ###########################################################################
--
-- DIESE DATEI LAEUFT VOR `prod-0138.sql` — und sie ist nicht optional.
--
-- `0138` ist die erste Migration dieses Releases, die ZEILEN ANLEGT: 21
-- Katalogzeilen und bis zu sechs Kategorien. Die Zusicherung „nichts anderes
-- hat sich bewegt" ist deshalb ein VERGLEICH, und ein Vergleich braucht ein
-- Vorher. Die Abdruckzeilen 401-409, 501-503 nehmen es; die gleichnamigen
-- Zeilen des Postflights stellen es daneben.
--
-- Die Migration nimmt dieselben Abdruecke zusaetzlich in ihrer EIGENEN
-- Transaktion und bricht bei jeder Abweichung ab. Diese Datei ersetzt das
-- nicht — sie macht es SICHTBAR, denn der Supabase-SQL-Editor zeigt
-- `NOTICE`-Meldungen nicht an.
--
-- RUECKGAENGIG MACHT SIE NICHTS, WEIL SIE NICHTS TUT: ein `do`-Block, der nur
-- zaehlt, ein `set_config`, ein SELECT — in `begin … rollback`.
--
-- WAS SIE PRUEFT — die Vorbedingungen von 0138
--
--   101-104  die Grundlagen: `0001`, `0135`, `0033`, `0004`
--   201-205  der Vorgaenger `0137`, an seiner WIRKUNG gemessen und nicht an
--            einer Nummer: nennt die Kategorieliste `Portale`, leitet sie auf
--            `portal` ab, prueft `is_shop_eligible` den Artikeltyp, steht die
--            Anlegefunktion?
--   301      ist der ZB-Bereich SKY-0615..SKY-0642 frei?   (muss `true`)
--   302      traegt heute eine Kategorie `Portale` eine Zeile?  (muss 0)
--   304      stehen die sechs Serien SA, G, SF, T, SC, I?   (muss `true`)
--
-- ERWARTET AUF PRODUCTION, am 2026-10-21 lesend vorhergesagt:
--
--   401  Katalogzeilen            570 PLUS die redaktionell ausgeblendeten
--   402  shopfaehige Zeilen       531
--   403  oeffentliche Angebote    287
--   404  md5 der Angebotsliste    9b8341058bbfa0f7809eddc300ab0e9e
--   405  sammelbare Zeilen        531
--   406  sammelbar je Serie       G=81,I=77,SA=74,SC=69,SF=89,T=141
--   407  Artikeltypverteilung     figure=531,game=39 PLUS die ausgeblendeten
--
-- Der Blick von aussen sieht weniger als dieses SELECT: die Richtlinie auf
-- `skylanders` gibt `anon` nur Zeilen mit `is_active AND catalog_visible`.
-- 401 und 407 zaehlen die TABELLE und liegen deshalb hoeher; 402, 405 und 406
-- fragen Sichtbarkeit selbst ab und muessen exakt stimmen.
--
-- ERGEBNIS LESEN: Zeile `9999` muss `0` zeigen. Zeilen mit `ok = NULL` sind
-- Messungen ohne Sollwert — die Abdruecke und die Z0-Zeilen.
--
-- EINGEBETTET: `supabase/checks/0138_preflight.sql`, Zeichen fuer Zeichen —
-- geprueft von `src/lib/catalog/staging-oneshot.test.ts`.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- A  BIN ICH WIRKLICH AUF PRODUCTION?
--
-- Dieselben drei Pruefungen wie in den sieben schreibenden Dateien. Ein
-- lesender Lauf in der falschen Datenbank richtet keinen Schaden an, aber er
-- liefert einen FALSCHEN BEFUND — die Panne vom 2026-10-20.
--
-- A1 verlangt das VOLLSTAENDIGE Staging-Markerpaar: Production traegt
-- `SKY-0821` rechtmaessig, erst `SKY-0821` UND `SKY-0822` bedeuten Staging.
-- ---------------------------------------------------------------------------
do $lauf_a$
begin
  if (select count(*) from public.skylanders
       where sky_id in ('SKY-0821', 'SKY-0822')) = 2 then
    raise exception 'ABBRUCH A1: das vollstaendige STAGING-Markerpaar ist da '
      '(SKY-0821 UND SKY-0822). Diese Datei ist fuer Production '
      '(zmiwxswrpkmizvqsgype) — auf Staging gehoert '
      'supabase/checks/0138_preflight.sql mit dem Modus staging.';
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

-- Der Z0-Modus: `keine` ist der ausdrueckliche Verzicht auf die fuenf
-- Staging-Bezugszahlen. Er gilt transaktionslokal und ist mit dem `rollback`
-- unten fort.
select set_config('skyisles.z0', 'keine', true);

-- >>> EINGEBETTET: supabase/checks/0138_preflight.sql
-- ===========================================================================
-- Zustand VOR 0138 — rein lesend
--
-- WAS DIESE DATEI BEANTWORTET
--
--   1. Steht `0137`? Gefragt wird nach seiner WIRKUNG, nicht nach einer
--      Nummer: nennt `non_collectible_categories()` die Kategorie `Portale`,
--      und leitet `catalog_item_type_for_category('Portale')` auf `portal`
--      ab. Fehlt eines davon, waeren die 21 Zeilen sammelbare, shopfaehige
--      Figuren — und zwar in dem Augenblick, in dem sie entstehen.
--   2. Ist der ZB-Bereich frei? `SKY-0615`-`SKY-0642` gehoert der
--      Arbeitsmappe. Steht dort irgendeine Zeile, ist `0138` der falsche
--      Schritt — eine SKY-ID wird nie neu vergeben (CLAUDE.md Regel 2).
--   3. Die Abdruecke, gegen die der Postflight Zeichen fuer Zeichen
--      vergleicht: Angebote, Nenner, Nenner je Serie, Zeilenzahl, Sequenz.
--   4. Der Z0-Vertrag — unveraendert dieselben fuenf Werte wie in `0135`
--      und `0137`. `0138` darf KEINEN davon bewegen.
--
-- NICHT IN `staging-suite.json`, aus demselben Grund wie `0137_preflight`:
-- die Datei RUFT `catalog_item_type_for_category()` auf, und `0135` hat
-- `execute` darauf jeder API-Rolle entzogen. Sie gehoert zum manuellen Lauf
-- im SQL-Editor und wird von `npm run verify:check-sql` trotzdem gegen
-- echtes PostgreSQL geplant.
--
-- NUR LESEN. Ein einziges SELECT, keine Schreiboperation, kein `set` ausser
-- dem transaktionslokalen Vertragsschalter. Zeile 9999 muss 0 zeigen.
--
--   begin;
--   select set_config('skyisles.z0', 'staging', true);   -- oder 'keine'
--   \i supabase/checks/0138_preflight.sql
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
 * DER Z0-VERTRAG — wortgleich mit `0135_postflight` und `0137_preflight`.
 * Dieselben Zahlen, dieselbe Begruendung, einschliesslich der Korrektur vom
 * 2026-10-19 („overrides ist 53, erwartet 39" — Z0 zaehlte INNERHALB der
 * Kategorie `Spiele`).
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
  (101, 'Grundlage', 'skylanders, categories und series sind da (0001)',
      (to_regclass('public.skylanders') is not null
       and to_regclass('public.categories') is not null
       and to_regclass('public.series') is not null)::text, 'true'),
  (102, 'Grundlage', 'Spalte item_type steht (0135)',
      (select (count(*) = 1)::text from information_schema.columns
        where table_schema = 'public' and table_name = 'skylanders'
          and column_name = 'item_type' and is_nullable = 'NO'), 'true'),
  (103, 'Grundlage', 'next_figure_slug und slugify sind da (0033)',
      (to_regprocedure('public.next_figure_slug(text, text, text)') is not null
       and to_regprocedure('public.slugify(text)') is not null)::text, 'true'),
  (104, 'Grundlage', 'catalog_admin_changes ist da, und kennt den Feldwert created (0004/0033)',
      (select (to_regclass('public.catalog_admin_changes') is not null
               and exists (select 1 from pg_constraint
                            where conname = 'catalog_admin_changes_field_known'
                              and position('created' in pg_get_constraintdef(oid)) > 0))::text),
      'true'),

  -- ------------------------------------------ 0137 nach seiner Wirkung
  (201, 'Vorgaenger', '0137: non_collectible_categories() nennt Portale',
      ('Portale' = any (public.non_collectible_categories()))::text, 'true'),
  (202, 'Vorgaenger', '0137: die ganze Kategorieliste, zeichengenau',
      array_to_string(public.non_collectible_categories(), ','),
      'Spiele,Portale,Bundles,Taschen,Zubehör'),
  (203, 'Vorgaenger', '0137: Kategorie Portale leitet auf portal ab',
      public.catalog_item_type_for_category('Portale'), 'portal'),
  (204, 'Vorgaenger', '0135: is_shop_eligible prueft item_type = figure',
      (select (position('s.item_type = ''figure''' in p.prosrc) > 0)::text from pg_proc p
        where p.oid = to_regprocedure('public.is_shop_eligible(text)')), 'true'),
  (205, 'Vorgaenger', '0137: seller_create_catalog_item ist da',
      (to_regprocedure('public.seller_create_catalog_item(text, text, text)')
         is not null)::text, 'true'),

  -- ------------------------------------------------- Der freie Bereich
  (301, 'Bereich', 'der ZB-Bereich SKY-0615..SKY-0642 ist frei',
      (select count(*)::text from public.skylanders
        where sky_id between 'SKY-0615' and 'SKY-0642'), '0'),
  (302, 'Bereich', 'keine Kategorie "Portale" traegt heute eine Zeile',
      (select count(*)::text from public.skylanders s
         join public.categories c on c.id = s.category_id
        where c.name = 'Portale'), '0'),
  (303, 'Bereich', 'Info: vorhandene Kategorien namens "Portale"',
      (select count(*)::text from public.categories where name = 'Portale'), null),
  (304, 'Bereich', 'die sechs Serien der Portale sind da',
      (select count(*)::text from public.series
        where code in ('SA', 'G', 'SF', 'T', 'SC', 'I')), '6'),
  (305, 'Bereich', 'Info: hoechste SKY-ID unter SKY-9000',
      coalesce((select max(sky_id) from public.skylanders
                 where sky_id < 'SKY-9000'), '(keine)'), null),

  -- ---------------------------------------- Abdruecke fuer den Vergleich
  (401, 'Abdruck', 'Katalogzeilen (nachher: + 21)',
      (select count(*)::text from public.skylanders), null),
  (402, 'Abdruck', 'shopfaehige Zeilen (muss nachher gleich sein)',
      (select count(*)::text from public.skylanders s
        where public.is_shop_eligible(s.sky_id)), null),
  (403, 'Abdruck', 'oeffentliche Angebote (muss nachher gleich sein)',
      (select count(*)::text from public.shop_offers()), null),
  (404, 'Abdruck', 'md5 der Angebotsliste (muss nachher gleich sein)',
      (select md5(coalesce(string_agg(o.sky_id || '|' || o.condition || '|'
                                      || coalesce(o.price::text, ''),
                                      ';' order by o.sky_id, o.condition), ''))
         from public.shop_offers() o), null),
  (405, 'Abdruck', 'sammelbare Zeilen (muss nachher gleich sein)',
      (select count(*)::text from sammelbar), null),
  (406, 'Abdruck', 'sammelbar je Serie (muss nachher gleich sein)',
      (select coalesce(string_agg(x.series_code || '=' || x.n::text, ',' order by x.series_code), '')
         from (select series_code, count(*) as n from sammelbar group by series_code) x), null),
  (407, 'Abdruck', 'Artikeltypverteilung (nachher: portal + 21)',
      (select coalesce(string_agg(x.item_type || '=' || x.n::text, ',' order by x.item_type), '')
         from (select s.item_type, count(*) as n
                 from public.skylanders s group by s.item_type) x), null),
  (408, 'Abdruck', 'md5 der display_name_override (muss nachher gleich sein)',
      (select md5(coalesce(string_agg(s.sky_id || '|' || s.display_name_override,
                                      ';' order by s.sky_id), ''))
         from public.skylanders s where s.display_name_override is not null), null),
  (409, 'Abdruck', 'Stand von sky_id_seq (muss nachher gleich sein — 0138 zieht keine ID)',
      coalesce((select q.last_value::text from pg_sequences q
                 where q.schemaname = 'public' and q.sequencename = 'sky_id_seq'),
               '(unbekannt)'), null),

  -- ------------------------------------------------- Was unberuehrt bleibt
  (501, 'Unberuehrt', 'Einkaufspositionen ohne sky_id (bleibt gleich)',
      (select count(*)::text from public.purchase_items where sky_id is null), null),
  (502, 'Unberuehrt', 'Einkaufspositionen auf Spiele (bleibt gleich)',
      (select count(*)::text from public.purchase_items i
         join public.skylanders s on s.sky_id = i.sky_id
        where s.item_type = 'game'), null),
  (503, 'Unberuehrt', 'Lagerzeilen insgesamt (bleibt gleich)',
      (select count(*)::text from public.shop_inventory), null),

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
  (914, 'Z0-Vertrag', 'sammelbare Artikel = Z0 (534)',
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
-- <<< ENDE: supabase/checks/0138_preflight.sql

rollback;
