-- ===========================================================================
-- PRODUCTION — DER ZUSTAND VOR 0139, REIN LESEND
--
-- ###########################################################################
-- ##  DIES IST EINE PRODUCTION-DATEI. Projekt zmiwxswrpkmizvqsgype.        ##
-- ##  Sie bricht auf Staging ab, und zwar bevor sie etwas liest.           ##
-- ###########################################################################
--
-- DIESE DATEI LAEUFT VOR `prod-0139.sql`.
--
-- `0139` baut das Verkaufstor fuer Zubehoer. Sie oeffnet es NICHT — aber sie
-- beruehrt vier Tueren, durch die heute jedes Figurenangebot geht
-- (`shop_offers`, `shop_quantity_available`, `create_order`,
-- `reserve_for_order`). Die Zusicherung „kein Figurenangebot aendert sich"
-- ist deshalb ein Vergleich, und er braucht ein Vorher.
--
-- RUECKGAENGIG MACHT SIE NICHTS, WEIL SIE NICHTS TUT: ein `do`-Block, der nur
-- zaehlt, ein `set_config`, ein SELECT — in `begin … rollback`.
--
-- WAS SIE PRUEFT, UND WAS DAVON BLOCKIEREND IST
--
--   1        das Staging-Markerpaar FEHLT        (Modus production: `false`)
--   101-110  die Grundlagen: `item_type`, `is_shop_eligible` (prueft noch
--            `item_type = 'figure'`), die vier Tueren in ihren heutigen
--            Signaturen, `can_operate_active_seller`, `is_platform_admin`
--   201-203  `sale_released`, `usk_rating`, `is_position_sellable` fehlen
--            NOCH — ein zweiter Lauf von `0139` faellt hier auf
--   401      oeffentliche Angebote                      **287**
--   402      Abdruck der Angebotsliste    **9b8341058bbfa0f7809eddc300ab0e9e**
--   403      shopfaehige Katalogzeilen                   **531**
--   405      sammelbare Katalogzeilen (Fortschrittsnenner) **531**
--   406      Lagerzeilen                                 **306**
--   407      Katalogzeilen                               **624**
--   501      die Belegsperre haelt fuer anon und authenticated  **0 Grants**
--
-- DIE ALTLAST, UM DIE ES GEHT — ZEILEN 301 BIS 307
--
-- Production fuehrt heute Lagerpositionen auf Spiele, die `is_listed = true`
-- tragen. Sie sind HEUTE kein Angebot, weil `is_shop_eligible()` am
-- Artikeltyp scheitert (seit `0135`). `0139` darf daran nichts aendern: die
-- Positionen bleiben gelistet UND unverkaeuflich, bis jemand sie einzeln
-- freigibt. Zeile 302 nennt die Menge, 304 die Teilmenge mit wirksamem
-- Preis — also die, die bei einer Nachlaessigkeit sofort im Schaufenster
-- stuende. Die Nachkontrolle vergleicht beide.
--
-- Lesend von aussen gemessen (2026-10-21): **13** Zubehoerpositionen werden
-- vom oeffentlichen Angebot zurueckgehalten, weil ihr Artikel nicht
-- sammelbar ist. Zeile 302 wird diese Zahl bestaetigen oder berichtigen.
--
-- ERGEBNIS LESEN: Zeile `9999` muss `0` zeigen. **Das ganze Ergebnis
-- aufbewahren** — die Nachkontrolle vergleicht gegen 404 und 408.
--
-- EINGEBETTET: `supabase/checks/0139_preflight.sql`, Zeichen fuer Zeichen —
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
-- Zeile 1 der eingebetteten Pruefung sagt dasselbe noch einmal als
-- Messung — im Modus `production` erwartet sie `false`.
-- ---------------------------------------------------------------------------
do $lauf_a$
begin
  if (select count(*) from public.skylanders
       where sky_id in ('SKY-0821', 'SKY-0822')) = 2 then
    raise exception 'ABBRUCH A1: das vollstaendige STAGING-Markerpaar ist da '
      '(SKY-0821 UND SKY-0822). Diese Datei ist fuer Production '
      '(zmiwxswrpkmizvqsgype) — auf Staging gehoert '
      'supabase/operations/staging-s1-preflight-0139.sql mit dem Modus staging.';
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
-- DER Z0-MODUS: `production`, NICHT `keine`
--
-- Das ist der Unterschied zu den Nachkontrollen von 0136, 0137 und 0138.
-- Dort gab es keine Production-Bezugszahlen, und der Verzicht war
-- ausdruecklich. Hier GIBT es sie — gemessen, nicht geraten —, und damit
-- werden aus sechs Messungen sechs BLOCKIERENDE Erwartungen: Angebote,
-- Angebotsabdruck, shopfaehige Zeilen, sammelbare Zeilen, Lagerzeilen,
-- Katalogzeilen. Genau die Zahlen, die sich bei `0139` nicht bewegen duerfen.
--
-- Er gilt transaktionslokal und ist mit dem `rollback` unten fort.
-- ---------------------------------------------------------------------------
select set_config('skyisles.z0', 'production', true);

-- >>> EINGEBETTET: supabase/checks/0139_preflight.sql
-- ===========================================================================
-- 0139 PREFLIGHT — der Eingangszustand, rein lesend
--
-- Vor `0139_accessory_sale_release.sql` im SQL-Editor fahren. Zeile 9999 muss
-- 0 zeigen, sonst wird die Migration nicht gestartet.
--
-- WAS DIESE DATEI FESTHAELT
--
--   1. die sechs vorausgesetzten Funktionen und `item_type` stehen;
--   2. die zwei neuen Spalten stehen NOCH NICHT;
--   3. die Altlast, ausdruecklich gezaehlt: wie viele Zubehoerpositionen
--      heute `is_listed = true` tragen und bepreist sind. Das ist die Menge,
--      die bei einer unvorsichtigen Lockerung sofort im Schaufenster
--      staende — hier wird sie benannt, bevor etwas passiert;
--   4. die Abdruecke, gegen die der Postflight prueft.
--
--   begin;
--   select set_config('skyisles.z0', 'staging', true);   -- oder 'keine'
--   \i supabase/checks/0139_preflight.sql
--   rollback;
--
-- NUR LESEN. Ein einziges SELECT.
-- NICHT in `staging-suite.json`: die Datei ruft `is_shop_eligible()` und
-- `shop_offers()` und gehoert in den manuellen Lauf.
-- ===========================================================================

with vertrag as (
  select nullif(btrim(coalesce(current_setting('skyisles.z0', true), '')), '') as modus
),
z0 (schluessel, staging, production) as (values
  /*
   * ZWEI UMGEBUNGEN, ZWEI SPALTEN — UND KEINE DRITTE WAHRHEIT.
   *
   * Links der Z0-Vertrag von Staging (Stand 2026-10-20), rechts der
   * gemessene Production-Stand nach `0138` (2026-10-21):
   *
   *   angebote/md5   287 und `9b834105…` — vom Betreiber im Postflight zu
   *                  `0137` und `0138` bestaetigt, beide Male gleich
   *   shopfaehig     531 — lesend gemessen (`verify:shop:prod`)
   *   sammelbar      531 — der Fortschrittsnenner, vom Betreiber bestaetigt
   *   lagerzeilen    306 — lesend gemessen
   *   katalogzeilen  624 — vom Betreiber nach `0138` bestaetigt (603 + 21)
   *
   * WARUM DIE WERTE IM CODE STEHEN: ein Sollwert, den der Bediener bei jedem
   * Lauf mittippt, ist bei jedem Lauf eine neue Gelegenheit fuer einen
   * Tippfehler — und ein Tippfehler in der ERWARTUNG laesst die Pruefung
   * bestehen. Gewaehlt wird nur die Umgebung.
   *
   * WARUM SIE UMGEBUNGSWEISE GETRENNT SIND: eine umgebungsblinde Erwartung
   * war in diesem Projekt schon zweimal die Ursache eines falschen Befundes.
   * Im Modus `keine` gilt keine der beiden Spalten, und die Zeilen sind
   * Messungen ohne Bewertung — das ist der ausdrueckliche Verzicht.
   */
  ('angebote',      '256', '287'),
  ('angebote_md5',  '4d1d6c30fe0ae886ca2689bcb1fe9634',
                    '9b8341058bbfa0f7809eddc300ab0e9e'),
  ('shopfaehig',    '534', '531'),
  ('sammelbar',     '534', '531'),
  ('lagerzeilen',   '285', '306'),
  ('katalogzeilen', '626', '624')
),
soll as (
  select z.schluessel,
         case (select v.modus from vertrag v)
           when 'staging'    then z.staging
           when 'production' then z.production
         end as wert
    from z0 z
),
/*
 * KEINE SPALTE, DIE ES VOR `0139` NICHT GIBT.
 *
 * Diese Datei lief am 2026-10-20 auf Staging in einen Fehler:
 * `column s.usk_rating does not exist`. Sie stand hier in der Auswahl —
 * eine Spalte, die `0139` erst ANLEGT. Ein Preflight, der den Zustand NACH
 * der Migration voraussetzt, kann den Zustand davor nicht messen.
 *
 * Gelesen werden deshalb nur Spalten, die es seit `0003` beziehungsweise
 * `0135` gibt: `item_type` und der Marktpreis.
 */
zubehoer as (
  select i.*, s.item_type, s.market_price
    from public.shop_inventory i
    join public.skylanders s on s.sky_id = i.sky_id
   where s.item_type <> 'figure'
),

pruef (nr, bereich, pruefung, befund, erwartet) as (values

  -- ------------------------------------------------ 0. Bin ich auf Staging?
  --
  -- Derselbe Stempel, den `staging-0139.sql` vor dem Schreiben prueft:
  -- `SKY-0821` und `SKY-0822` gibt es auf Staging und auf Production
  -- bewusst NICHT. Hier steht er als MESSUNG, damit vor S2 sichtbar ist,
  -- dass der Riegel greifen wird — dort ist er dann blockierend.
  /*
   * BERICHTIGT AM 2026-10-21: DIESE ZEILE HATTE EINE STAGING-ERWARTUNG.
   *
   * Sie verlangte `true` — und auf Production ist das Markerpaar
   * rechtmaessig NICHT da (`SKY-0821` liegt dort als echter Artikel, `0822`
   * gar nicht). Dieselbe Datei auf Production hätte also eine rote Zeile
   * und `9999 = 1` gemeldet, ohne dass irgendetwas falsch waere — genau die
   * Art Fehlalarm, die einen echten Befund untergehen laesst.
   *
   * Jetzt ist die Erwartung die der gewaehlten Umgebung: auf Staging muss
   * das Paar DA sein, auf Production muss es FEHLEN. Beides ist damit
   * blockierend geprueft, statt nur eines.
   */
  (1, 'Umgebung', 'Staging-Markerpaar SKY-0821 UND SKY-0822 (Staging: da, Production: fort)',
      (select (count(*) = 2)::text from public.skylanders
        where sky_id in ('SKY-0821', 'SKY-0822')),
      (select case v.modus when 'staging' then 'true'
                           when 'production' then 'false' end from vertrag v)),
  (2, 'Umgebung', 'Info: Katalogzeilen',
      (select count(*)::text from public.skylanders), null),

  -- ------------------------------------------------ 1. Die Voraussetzungen
  (101, 'Grundlage', 'skylanders.item_type steht (0135)',
      (select (count(*) = 1)::text from information_schema.columns
        where table_schema = 'public' and table_name = 'skylanders'
          and column_name = 'item_type'), 'true'),
  (102, 'Grundlage', 'is_shop_eligible(text) steht',
      (to_regprocedure('public.is_shop_eligible(text)') is not null)::text, 'true'),
  (103, 'Grundlage', 'shop_offers() steht',
      (to_regprocedure('public.shop_offers()') is not null)::text, 'true'),
  (104, 'Grundlage', 'shop_quantity_available(text,text,integer) steht',
      (to_regprocedure('public.shop_quantity_available(text, text, integer)')
         is not null)::text, 'true'),
  (105, 'Grundlage', 'create_order mit SECHS Parametern steht (0040)',
      (to_regprocedure('public.create_order(text, text, jsonb, jsonb, text, text)')
         is not null)::text, 'true'),
  (106, 'Grundlage', 'reserve_for_order(bigint) steht (0010)',
      (to_regprocedure('public.reserve_for_order(bigint)') is not null)::text, 'true'),
  (107, 'Grundlage', 'admin_shop_listing_audit() steht (0041)',
      (to_regprocedure('public.admin_shop_listing_audit()') is not null)::text, 'true'),
  (108, 'Grundlage', 'can_operate_active_seller() steht',
      (to_regprocedure('public.can_operate_active_seller()') is not null)::text, 'true'),
  (109, 'Grundlage', 'is_platform_admin() steht',
      (to_regprocedure('public.is_platform_admin()') is not null)::text, 'true'),
  (110, 'Grundlage', 'is_shop_eligible verlangt noch item_type = figure (0135)',
      (select (position('s.item_type = ''figure''' in p.prosrc) > 0)::text from pg_proc p
        where p.oid = to_regprocedure('public.is_shop_eligible(text)')), 'true'),

  -- --------------------------------------- 2. Die neuen Spalten fehlen noch
  (201, 'Neu', 'shop_inventory.sale_released fehlt noch',
      (select (count(*) = 0)::text from information_schema.columns
        where table_schema = 'public' and table_name = 'shop_inventory'
          and column_name = 'sale_released'), 'true'),
  (202, 'Neu', 'skylanders.usk_rating fehlt noch',
      (select (count(*) = 0)::text from information_schema.columns
        where table_schema = 'public' and table_name = 'skylanders'
          and column_name = 'usk_rating'), 'true'),
  (203, 'Neu', 'is_position_sellable fehlt noch',
      (to_regprocedure('public.is_position_sellable(bigint)') is null)::text, 'true'),

  -- --------------------------------------------------- 3. DIE ALTLAST
  (301, 'Altlast', 'Zubehoer-Lagerpositionen insgesamt',
      (select count(*)::text from zubehoer), null),
  (302, 'Altlast', 'davon is_listed = true — DIE MENGE, UM DIE ES GEHT',
      (select count(*)::text from zubehoer where is_listed), null),
  /*
   * WOHER DER PREIS KAEME. Nicht aus einem gesetzten `sale_price` — `0007`
   * hat den CHECK `shop_inventory_listed_needs_price` ABGESCHAFFT, weil
   * eine gelistete Position seitdem auch ohne Uebersteuerung einen Preis
   * haben kann: Marktpreis mal Prozentsatz. Die Regel lebt seither in
   * `set_shop_listing()` und `shop_offers()`.
   *
   * Gemessen auf Staging am 2026-10-20: 13 gelistet, davon 0 mit eigenem
   * Preis, 11 mit einem Preis AUS DEM MARKTPREIS — und genau die 11 waeren
   * bei einer Lockerung ohne Freigabespalte sofort im Schaufenster.
   */
  (303, 'Altlast', 'davon mit eigenem Verkaufspreis (sale_price)',
      (select count(*)::text from zubehoer where is_listed and sale_price is not null), null),
  (304, 'Altlast', 'davon mit WIRKSAMEM Preis — die Menge, die sofort Angebot waere',
      (select count(*)::text from zubehoer z
        cross join public.shop_settings st
        where z.is_listed
          and public.shop_price(z.sale_price, z.market_price, st.price_percentage)
              is not null), null),
  (305, 'Altlast', 'die betroffenen SKY-IDs',
      coalesce((select string_agg(sky_id || ' (' || item_type || ')', '  |  ' order by sky_id)
                  from zubehoer where is_listed), '(keine)'), null),
  (306, 'Altlast', 'Zubehoerzeilen im oeffentlichen Angebot — HEUTE',
      (select count(*)::text from public.shop_offers() o
         join public.skylanders s on s.sky_id = o.sky_id
        where s.item_type <> 'figure'), '0'),
  (307, 'Altlast', 'Zubehoerartikel mit Marktpreis — die Quelle des Preises',
      (select count(*)::text from public.skylanders
        where item_type <> 'figure' and market_price is not null), null),

  -- ---------------------------------------------------- 4. Die Abdruecke
  (401, 'Abdruck', 'oeffentliche Angebote',
      (select count(*)::text from public.shop_offers()),
      (select wert from soll where schluessel = 'angebote')),
  /*
   * DIE Z0-FORMEL, ZEICHEN FUER ZEICHEN AUS `0135_preflight.sql` (Zeile 913).
   *
   * Eine frueher hier stehende, selbst erfundene Fassung nahm vier Felder
   * mit `E'\n'` als Trenner und lieferte auf Staging
   * `faabf8ef0d124c3dc75ed08b4eb4f398` — verglichen mit einer Konstante,
   * die aus einer ANDEREN Formel stammt. Das sah nach einer
   * Datenaenderung aus und war keine.
   *
   * Drei Felder, Trenner `;`, OHNE `available`: und das ist kein Zufall.
   * Ein Abdruck, der die Verfuegbarkeit mitnimmt, aendert sich bei jedem
   * Verkauf — ein Vertrag, der bei normalem Betrieb Alarm schlaegt, ist
   * kein Vertrag.
   */
  (402, 'Abdruck', 'Abdruck ueber die Angebotsliste (sky_id|condition|price)',
      (select md5(coalesce(string_agg(o.sky_id || '|' || o.condition || '|'
                                      || coalesce(o.price::text, ''),
                                      ';' order by o.sky_id, o.condition), ''))
         from public.shop_offers() o),
      (select wert from soll where schluessel = 'angebote_md5')),
  (403, 'Abdruck', 'shopfaehige Katalogzeilen',
      (select count(*)::text from public.skylanders s
        where public.is_shop_eligible(s.sky_id)),
      (select wert from soll where schluessel = 'shopfaehig')),
  (404, 'Abdruck', 'verkaufbare Lagerpositionen (am alten Tor gemessen)',
      (select count(*)::text from public.shop_inventory i
        where public.is_shop_eligible(i.sky_id)), null),
  /*
   * DIE Z0-DEFINITION, ZEICHEN FUER ZEICHEN AUS `0135_preflight.sql`
   * (Zeilen 16-21) — EINSCHLIESSLICH `s.catalog_visible`.
   *
   * Eine frueher hier stehende Fassung liess die Sichtbarkeit weg und zaehlte
   * damit die 30 redaktionell ausgeblendeten Figuren mit: 564 statt 534. Das
   * war der einzige Befund von S1 und S3 am 2026-10-20, und er lag an DIESER
   * Zeile, nicht an den Daten.
   *
   * Die Sichtbarkeit gehoert dazu, weil der Fortschritts-Nenner zaehlt, was
   * der oeffentliche Katalog HEUTE anbietet: `collectionStats()` zaehlt
   * `entry.figure.isActive && entry.figure.catalogVisible`, und die
   * Nennerabfrage in `fetchCatalog()` filtert auf beides. Eine ausgeblendete
   * Figur ist in keiner Haelfte — und genau das macht „besessen > gesamt"
   * unmoeglich (ADR-0040).
   */
  (405, 'Abdruck', 'sammelbare Katalogzeilen',
      (select count(*)::text from public.skylanders s
         join public.categories c on c.id = s.category_id
        where s.is_active and s.catalog_visible
          and not (c.name = any (public.non_collectible_categories()))),
      (select wert from soll where schluessel = 'sammelbar')),
  (406, 'Abdruck', 'Lagerzeilen',
      (select count(*)::text from public.shop_inventory),
      (select wert from soll where schluessel = 'lagerzeilen')),
  (407, 'Abdruck', 'Katalogzeilen',
      (select count(*)::text from public.skylanders),
      (select wert from soll where schluessel = 'katalogzeilen')),
  (408, 'Abdruck', 'Abdruck ueber Listung und Preis jeder Lagerzeile',
      (select coalesce(md5(string_agg(i.id::text || '|' || i.is_listed::text || '|'
                                      || coalesce(i.sale_price::text, '-'),
                                      E'\n' order by i.id)), '(leer)')
         from public.shop_inventory i), null),

  -- -------------------------------------------------- 5. Die Belegsperre
  (501, 'Belege', 'die Belegsperre haelt fuer anon und authenticated',
      (select count(*)::text from information_schema.role_table_grants g
        where g.table_schema = 'public'
          and g.table_name in ('platform_receipts', 'platform_receipt_sequence')
          and g.grantee in ('anon', 'authenticated')), '0'),

  -- ------------------------------------------------------ Der Z0-Vertrag
  (901, 'Z0-Vertrag', 'gewaehlter Modus (Messung ohne Sollwert)',
      (select coalesce(v.modus, 'FEHLT') from vertrag v), null),
  (902, 'Z0-Vertrag', 'der Modus ist gewaehlt — staging, production oder ausdruecklich keine',
      (select case when v.modus in ('staging', 'production', 'keine') then 'ja'
                   else 'nein: set_config(''skyisles.z0'', ''staging'', true) fehlt'
              end from vertrag v), 'ja')
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
-- <<< ENDE: supabase/checks/0139_preflight.sql

rollback;
