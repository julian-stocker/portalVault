-- ===========================================================================
-- PRODUCTION — EIN LAUF FUER 0137
--              (Zubehoer wird ein Katalogartikel)
--
-- ###########################################################################
-- ##  DIES IST EINE PRODUCTION-DATEI. Projekt zmiwxswrpkmizvqsgype.        ##
-- ##  Sie bricht auf Staging ab, und zwar bevor sie etwas anfasst.         ##
-- ###########################################################################
--
-- EINE DATEI, EINE TRANSAKTION, EIN EINFUEGEN. Vollstaendig markieren, in den
-- SQL-Editor des PRODUCTION-Projekts einfuegen, ausfuehren. Nichts in Teilen:
-- jede Zeile gehoert zur selben Klammer, und ein Fehler irgendwo rollt ALLES
-- zurueck.
--
-- WARUM ES DIESE DATEI UEBERHAUPT GIBT, statt die Staging-Fassung zu nehmen
--
-- Die Staging-Dateien tragen einen Staging-Stempel und wuerden hier mit
-- `ABBRUCH A1` abbrechen — richtig, aber unbenutzbar. Ihnen den Riegel
-- WEGZUNEHMEN waere der falsche Weg: dann liefe eine Datei ohne jede
-- Umgebungspruefung, und genau das ist diesem Projekt am 2026-10-18 schon
-- einmal passiert — `0132` und `0133` landeten unbeabsichtigt auf
-- Production (`docs/history/2026-10-18-production-0132-0133.md`). Diese
-- Datei traegt deshalb den UMGEKEHRTEN Stempel, nicht keinen.
--
-- WAS DIE DATEI ENTHAELT
--
--   A   Umgebungsstempel: bin ich wirklich auf Production?
--   B   Migration 0137, ZEICHEN FUER ZEICHEN aus
--       `supabase/migrations/0137_catalog_accessories.sql`.
--       `src/lib/catalog/staging-oneshot.test.ts` vergleicht beides bei jedem
--       Testlauf; eine Abweichung faellt auf, bevor jemand sie ausfuehrt.
--
-- Die Vor- und Nachbedingungen stehen in der Migration selbst und werden
-- hier NICHT wiederholt. Diese Datei fuegt genau eine Pruefung hinzu — die
-- nach dem Projekt —, weil die Migration sie nicht kennen kann.
--
-- WAS SIE NICHT TUT
--
--   * Sie legt KEINEN Artikel an — kein Portal, kein Spiel, keine SKY-ID.
--     Das ist `0138`.
--   * Sie aendert KEIN bestehendes Angebot: die Abdruecke muessen gleich
--     bleiben, und die Migration prueft es.
--   * Keine Lagerzeile, keine Bewegung, kein Einkauf.
--
-- SIE SETZT `0135` VORAUS (und `0052`/`0117` fuer die Artikelsuche).
--
-- ERWARTETES ERGEBNIS: die `NOTICE`-Zeilen der Migration, und `commit`.
-- Jede Abweichung bricht ab und rollt alles zurueck.
--
-- RUECKNAHME: `supabase/rollback/R0137_back_to_0135.sql`.
-- REIHENFOLGE UND STOPP-KRITERIEN: `supabase/checks/production_release_0135_0141.md`.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- A. Bin ich wirklich auf Production?
--
-- ZWEI BEDINGUNGEN, UND BEIDE MUESSEN GELTEN. Eine negative allein waere
-- schwach: „kein Staging" stimmt auch fuer eine leere Datenbank.
--
--   A1  Der STAGING-Stempel fehlt. `SKY-0821` und `SKY-0822` gibt es auf
--       Staging und auf Production bewusst NICHT
--       (`supabase/checks/staging_pending_migrations.sql`, Zeile 101).
--   A2  `0133` ist angewendet. Sie liegt seit dem 2026-10-18 auf Production
--       und fehlt auf Staging — dieselbe Akte, dieselbe Zeile 211. Das ist
--       der POSITIVE Teil: er unterscheidet Production von einer beliebigen
--       anderen Datenbank, die nur den Staging-Stempel nicht hat.
--   A3  Und es ist kein leeres Projekt: der Katalog traegt Zeilen.
-- ---------------------------------------------------------------------------
do $lauf_a$
begin
  if (select count(*) from public.skylanders
       where sky_id in ('SKY-0821', 'SKY-0822')) <> 0 then
    raise exception 'ABBRUCH A1: der STAGING-Stempel ist da. Diese Datei ist fuer '
      'Production (zmiwxswrpkmizvqsgype) — auf Staging gehoert die Datei '
      'supabase/operations/staging-0137.sql.';
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
-- B. Die Migration, unveraendert
-- ---------------------------------------------------------------------------
-- >>> EINGEBETTET: supabase/migrations/0137_catalog_accessories.sql
-- ===========================================================================
-- 0137 — ZUBEHOER WIRD EIN KATALOGARTIKEL (ADR-0128, Schritt Z2)
--
-- WAS SIE TUT, IN VIER SAETZEN
--
--   1. `catalog_item_type_for_category()` lernt die uebrigen vier
--      Zubehoerkategorien: Portale -> portal, Bundles -> bundle,
--      Taschen -> other, Zubehoer -> other. Die Liste bleibt eine
--      POSITIVLISTE: ein unbekannter Kategoriename ist weiter eine Figur.
--   2. `non_collectible_categories()` nennt dieselben vier Namen zusaetzlich
--      zu `Spiele`. Damit ist ein Portal weder sammelbar noch shopfaehig,
--      und zwar BEVOR das erste Portal existiert.
--   3. Neu: `seller_create_catalog_item(name, serie, typ)` — der Betrieb darf
--      einen ZUBEHOERARTIKEL anlegen, niemals eine Figur.
--   4. `seller_import_catalog()` liefert `item_type` mit, damit die
--      Artikelsuche im Einkaufsbuch Spiele und Portale als solche zeigen und
--      finden kann.
--
-- WARUM DIE REIHENFOLGE SO IST UND NICHT ANDERS
--
-- Punkt 2 steht VOR Punkt 3. Legte man erst den Artikel an und erweiterte
-- danach die Kategorieregel, waere das erste Portal fuer die Dauer einer
-- Migration eine sammelbare, shopfaehige Figur — in der Sammlungsstatistik,
-- in `shop_offers()`, im oeffentlichen Katalog. Hier kann das nicht passieren:
-- beides liegt in derselben Transaktion, und die Regel ist zuerst da.
--
-- DIE ERGEBNISMENGE AENDERT SICH NICHT, UND DAS BEWEIST DIE DATEI SELBST.
-- Abschnitt 1 nimmt sieben Abdruecke — shopfaehige Zeilen, Angebote, ein
-- `md5` ueber die vollstaendige Angebotsliste, sammelbare Zeilen, sammelbare
-- je Serie, die Artikeltypverteilung und die Zeilenzahl —, Abschnitt 5
-- vergleicht sie. Das darf gelingen, WEIL es die vier neuen Kategorienamen
-- heute nicht gibt: Abschnitt 1 bricht ab, wenn doch eine Zeile darin steht.
-- Weicht ein Abdruck ab, rollt die Transaktion alles zurueck.
--
-- WAS SIE NICHT TUT
--
--   * Sie legt KEINEN Artikel an. Kein Portal, keine Kategorie, keine
--     SKY-ID — sie legt nur den WEG dafuer. Die 21 Arbeitsmappen-Portale
--     (`SKY-0615`-`0637`, docs/SKYLANDERS_DATA.md 11k) bleiben Z3 mit eigener
--     Freigabe: ihre SKY-IDs sind vom Betreiber vergeben und werden
--     uebernommen, nicht neu erzeugt.
--   * Sie haengt KEINE historische Einkaufsposition um. Die 206 Positionen
--     ohne `sky_id` bleiben, was sie sind; zugeordnet wird einzeln und von
--     Hand ueber den bestehenden Figurenwechsel (`0054`/`0127`), der
--     `raw_name` als Herkunftsnachweis stehen laesst.
--   * Sie aendert `is_shop_eligible()` NICHT. `0135` hat die Eignung an den
--     Artikeltyp gehaengt; mehr braucht es nicht.
--   * Sie aendert KEINE bestehende Rolle und KEIN bestehendes Recht. Der
--     einzige neue Grant ist `execute` auf die neue Funktion fuer
--     `authenticated` — dasselbe Muster, das jede `seller_*`-Funktion seit
--     `0053` traegt, und das Tor ist dasselbe `can_operate_active_seller()`.
--   * Keine Lagerzeile, keine Bewegung, kein Beleg, kein Einkauf, kein
--     Belegzaehler. Die Belegsperre wird nicht beruehrt.
--
-- WARUM DER BETRIEB ZUBEHOER ANLEGEN DARF UND FIGUREN NICHT
--
-- Eine Figur ist kuratierte Katalogidentitaet: SKY-ID aus der Arbeitsmappe,
-- Charakterzuordnung, Bild, Marktpreis (ADR-0034, CLAUDE.md Regel 2). Sie
-- entsteht im Adminbereich, `admin_create_figure` verlangt `is_shop_admin()`,
-- und das bleibt so.
--
-- Ein Portal dagegen entsteht beim EINKAUF: es liegt im Karton, es kostet
-- Geld, es muss in die Position. Dafuer zweimal das Konto zu wechseln ist der
-- Grund, warum es heute als Freitext ohne Bestand und ohne Historie landet.
-- `seller_create_catalog_item` nimmt deshalb genau vier Typen an —
-- game, portal, bundle, other — und lehnt 'figure' AUSDRUECKLICH ab. Sie
-- schreibt immer `catalog_visible = false`: ein so entstandener Artikel ist
-- im oeffentlichen Katalog unsichtbar, bis ein Administrator entscheidet.
--
-- REIHENFOLGE UND ABHAENGIGKEITEN
--
-- Haengt an `0001` (skylanders, categories, series), `0006`
-- (`non_collectible_categories`), `0033`/`0034`/`0041` (`next_figure_slug`,
-- `sky_id_seq`, `catalog_admin_changes`), `0052`/`0117`
-- (`seller_import_catalog`) und `0135` (`item_type`,
-- `catalog_item_type_for_category`). An `0133` und `0134` haengt sie NICHT:
-- `0133` beruehrt `purchases`, `0134` die Funktion `seller_purchase(bigint)`,
-- die ihre Spalten einzeln nennt. Kein gemeinsames Objekt in beide
-- Richtungen.
--
-- EINE TRANSAKTION, UND SIE PRUEFT SICH SELBST
--
-- Abschnitt 1 legt eine temporaere Tabelle mit `on commit drop` an und bricht
-- ab, wenn sie unmittelbar danach schon wieder fort ist — genau das passiert,
-- wenn die Datei ohne Klammer laeuft. Es gibt deshalb keinen Weg, diese
-- Migration halb anzuwenden.
--
-- AUSFUEHRUNG: im SQL-Editor, vollstaendig in `begin` / `commit` geklammert —
-- oder als ein Stueck ueber `supabase/operations/staging-0137.sql`, das
-- Vorpruefung, Migration und Nachpruefung in EINER Transaktion fuehrt.
-- Ruecknahme: `supabase/rollback/R0137_back_to_0135.sql`.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen und die Abdruecke, gegen die am Ende geprueft wird
-- ---------------------------------------------------------------------------
create temporary table z2_abdruck (
  schluessel text primary key,
  wert       text not null
) on commit drop;

do $$
declare
  v_fremd integer;
  v_name  text;
begin
  /*
   * DER KLAMMERGRIFF — wie in `0135`. Laeuft die Datei nicht in einer
   * Transaktion, ist die Tabelle oben schon wieder fort, und dieser Block
   * bricht ab, BEVOR irgendetwas geaendert wird.
   */
  if to_regclass('pg_temp.z2_abdruck') is null then
    raise exception '0137 Abbruch: die Datei laeuft nicht in einer Transaktion — '
      'in begin / commit klammern und vollstaendig ausfuehren';
  end if;

  /*
   * EIN ZEITLIMIT AUF DIE SPERRE, transaktionslokal. Diese Migration nimmt
   * keine ACCESS EXCLUSIVE auf `skylanders` — sie legt keine Spalte an —,
   * aber `create or replace function` auf `non_collectible_categories()`
   * braucht eine Sperre auf den Funktionseintrag, und `is_shop_eligible()`
   * ruft sie aus jeder laufenden Shopabfrage heraus auf.
   */
  perform set_config('lock_timeout', '5s', true);

  -- ---- Was da sein muss -------------------------------------------------
  if to_regclass('public.skylanders') is null then
    raise exception '0137 setzt 0001 voraus: skylanders fehlt';
  end if;
  if to_regclass('public.categories') is null then
    raise exception '0137 setzt 0001 voraus: categories fehlt';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'skylanders'
                    and column_name = 'item_type') then
    raise exception '0137 setzt 0135 voraus: skylanders.item_type fehlt';
  end if;
  if to_regprocedure('public.catalog_item_type_for_category(text)') is null then
    raise exception '0137 setzt 0135 voraus: catalog_item_type_for_category fehlt';
  end if;
  if not exists (select 1 from pg_trigger
                  where tgname = 'skylanders_item_type_from_category'
                    and tgrelid = 'public.skylanders'::regclass) then
    raise exception '0137 setzt 0135 voraus: der Trigger skylanders_item_type_from_category fehlt';
  end if;
  if to_regprocedure('public.non_collectible_categories()') is null then
    raise exception '0137 setzt 0006 voraus: non_collectible_categories fehlt';
  end if;
  if to_regprocedure('public.seller_import_catalog()') is null then
    raise exception '0137 setzt 0052/0117 voraus: seller_import_catalog fehlt';
  end if;
  if to_regprocedure('public.next_figure_slug(text, text, text)') is null then
    raise exception '0137 setzt 0033 voraus: next_figure_slug fehlt';
  end if;
  if to_regclass('public.sky_id_seq') is null then
    raise exception '0137 setzt 0033 voraus: sky_id_seq fehlt';
  end if;
  if to_regclass('public.catalog_admin_changes') is null then
    raise exception '0137 setzt 0004 voraus: catalog_admin_changes fehlt';
  end if;
  if to_regprocedure('public.can_operate_active_seller()') is null then
    raise exception '0137 setzt 0042 voraus: can_operate_active_seller fehlt';
  end if;

  -- ---- Der Zustand, der den Beweis in Abschnitt 5 moeglich macht --------
  /*
   * DIE VIER NEUEN KATEGORIENAMEN DUERFEN HEUTE KEINE ZEILE TRAGEN.
   *
   * `non_collectible_categories()` zu erweitern aendert die Ergebnismenge
   * genau dann nicht, wenn in den neuen Namen nichts steht. Steht doch etwas
   * darin, waere diese Migration eine stillschweigende Entfernung aus
   * Sammlung und Shop — und dann ist sie der falsche Schritt und bricht ab.
   */
  select count(*) into v_fremd
    from public.skylanders s
    join public.categories c on c.id = s.category_id
   where c.name in ('Portale', 'Bundles', 'Taschen', 'Zubehör');
  if v_fremd > 0 then
    raise exception '0137 Abbruch: % Katalogzeile(n) stehen schon in einer der vier neuen '
      'Zubehoerkategorien — diese Migration wuerde sie aus Sammlung und Shop nehmen', v_fremd;
  end if;

  /* Die heutige Fassung der Kategorieliste, zeichengenau. Eine abweichende
     Fassung heisst: jemand hat sie zwischenzeitlich geaendert, und der
     Austausch unten wuerde diese Aenderung verwerfen. */
  select array_to_string(public.non_collectible_categories(), ',') into v_name;
  if v_name <> 'Spiele' then
    raise exception '0137 Abbruch: non_collectible_categories() ist "%", erwartet "Spiele"', v_name;
  end if;

  if to_regprocedure('public.seller_create_catalog_item(text, text, text)') is not null then
    raise exception '0137 Abbruch: seller_create_catalog_item steht schon';
  end if;

  insert into z2_abdruck (schluessel, wert) values
    ('shopfaehig', (select count(*)::text from public.skylanders s
                     where public.is_shop_eligible(s.sky_id))),
    ('angebote',   (select count(*)::text from public.shop_offers())),
    ('angebote_md5',
       (select md5(coalesce(string_agg(o.sky_id || '|' || o.condition || '|'
                                       || coalesce(o.price::text, ''),
                                       ';' order by o.sky_id, o.condition), ''))
          from public.shop_offers() o)),
    ('sammelbar',  (select count(*)::text from public.skylanders s
                      join public.categories c on c.id = s.category_id
                     where s.is_active and s.catalog_visible
                       and not (c.name = any (public.non_collectible_categories())))),
    ('sammelbar_je_serie',
       (select coalesce(string_agg(x.series_code || '=' || x.n::text, ',' order by x.series_code), '')
          from (select s.series_code, count(*) as n
                  from public.skylanders s
                  join public.categories c on c.id = s.category_id
                 where s.is_active and s.catalog_visible
                   and not (c.name = any (public.non_collectible_categories()))
                 group by s.series_code) x)),
    ('typen',
       (select coalesce(string_agg(x.item_type || '=' || x.n::text, ',' order by x.item_type), '')
          from (select s.item_type, count(*) as n
                  from public.skylanders s group by s.item_type) x)),
    ('zeilen',     (select count(*)::text from public.skylanders));

  raise notice '0137 Abdruck: % shopfaehig, % Angebote, md5 %, % sammelbar, Typen %',
    (select wert from z2_abdruck where schluessel = 'shopfaehig'),
    (select wert from z2_abdruck where schluessel = 'angebote'),
    (select wert from z2_abdruck where schluessel = 'angebote_md5'),
    (select wert from z2_abdruck where schluessel = 'sammelbar'),
    (select wert from z2_abdruck where schluessel = 'typen');
end $$;


-- ---------------------------------------------------------------------------
-- 2. Die Ableitung lernt die uebrigen Zubehoerkategorien
--
-- Der Rumpf ist der aus `0135`, erweitert um vier `when`-Zweige. KEIN
-- `else 'game'`, nirgends: ein unbekannter Kategoriename bleibt eine Figur.
-- Genau das ist der Grund, warum hier eine Funktion steht und keine
-- Namensheuristik — `Portal of Power`, `Starter Pack` und `Tasche` kommen in
-- Figurennamen vor, und ein Muster darauf waere irgendwann falsch.
--
-- WARUM VIER UND NICHT NUR `Portale`. Die Arbeitsmappe fuehrt neben den 21
-- Portalen zwei Starter Packs und zwei Taschen (docs/SKYLANDERS_DATA.md 11k),
-- und der CHECK aus `0135` kennt `bundle` und `other` bereits. Die Zweige
-- jetzt zu setzen kostet nichts; sie spaeter nachzuziehen hiesse, eine zweite
-- Migration gegen dieselbe Funktion zu schreiben.
--
-- `Zubehör` ist der Sammelname fuer `other` — die Kategorie, in die
-- `seller_create_catalog_item` einen Artikel ohne eigene Gruppe stellt.
-- ---------------------------------------------------------------------------
create or replace function public.catalog_item_type_for_category(p_category_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  -- Positivliste. Ein Name, der hier nicht steht, ist eine Figur.
  select case p_category_name
           when 'Spiele'   then 'game'
           when 'Portale'  then 'portal'
           when 'Bundles'  then 'bundle'
           when 'Taschen'  then 'other'
           when 'Zubehör'  then 'other'
           else 'figure'
         end;
$$;

comment on function public.catalog_item_type_for_category(text) is
  'The one place a category name maps to an item type (0135, widened in 0137): Spiele -> game, Portale -> portal, Bundles -> bundle, Taschen and Zubehoer -> other, everything else -> figure. A POSITIVE list: an unknown category is a figure, never an accessory. Pure, immutable, reads nothing.';

revoke all on function public.catalog_item_type_for_category(text) from public, anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 3. Dieselben Namen sind nicht sammelbar
--
-- Der Rumpf ist der aus `0006`, erweitert um vier Namen. Die Liste bleibt die
-- EINE Stelle, an der eine Kategorie die Sammelbarkeit verliert; die
-- Anwendungsseite spiegelt sie in `src/lib/catalog/collectible.ts`, und
-- `npm run verify:shop` vergleicht beide Fassungen.
--
-- ZWEI RIEGEL, ABSICHTLICH. `is_shop_eligible()` verlangt seit `0135`
-- zusaetzlich `item_type = 'figure'`. Ein Zubehoerartikel scheitert damit an
-- zwei unabhaengigen Bedingungen — am Artikeltyp und am Kategorienamen —, und
-- keine davon haengt daran, dass die andere gesetzt wurde.
-- ---------------------------------------------------------------------------
create or replace function public.non_collectible_categories()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['Spiele', 'Portale', 'Bundles', 'Taschen', 'Zubehör']::text[];
$$;

comment on function public.non_collectible_categories() is
  'Category names whose rows are not collectible (0006, widened in 0137): Spiele, Portale, Bundles, Taschen, Zubehoer. Mirrored in src/lib/catalog/collectible.ts, and npm run verify:shop compares the two. Nothing collectible has ever stood in any of them - 0137 refuses to run otherwise.';


-- ---------------------------------------------------------------------------
-- 4. Der Betrieb darf einen Zubehoerartikel anlegen
--
-- WAS SIE ANNIMMT: einen Namen, eine Serie, einen der vier Zubehoertypen.
-- WAS SIE ABLEHNT: 'figure' — ausdruecklich und mit eigener Meldung.
--
-- WAS SIE NICHT ENTSCHEIDET. Keinen Preis (`market_price` bleibt NULL, und
-- NULL heisst „unbekannt", nie 0 — ADR-0010), kein Bild, keine
-- Charakterzuordnung, keinen `display_name_override`, keine redaktionelle
-- Sichtbarkeit. Das alles gehoert dem Adminbereich, und ein Artikel, der hier
-- entsteht, wartet dort auf seine Entscheidung.
--
-- DIE KATEGORIE FOLGT AUS DEM TYP, nicht umgekehrt — genau einmal, in
-- `v_kategorie_name` unten. Fehlt die Kategorie in der Serie, entsteht sie
-- am Ende der Reihenfolge; `catalog_group` bleibt dabei NULL, wie bei den
-- sechs `Spiele`-Kategorien (docs/SKYLANDERS_DATA.md, Abschnitt 5).
--
-- DIE SKY-ID KOMMT AUS DER SEQUENZ, wie bei `admin_create_figure`: der
-- produktive Bereich endet bei `SKY-8999`, `SKY-9000`-`9999` ist fuer
-- Fixtures reserviert (ADR-0070). Sie wird NICHT aus einem Namen, einer
-- Zeilennummer oder der hoechsten vorhandenen ID abgeleitet (CLAUDE.md
-- Regel 2) — und sie faellt NICHT in die Luecke `SKY-0615`-`0642`, die die
-- Arbeitsmappe fuer die 21 Portale belegt. Wer diese 21 will, nimmt Z3; wer
-- hier anlegt, bekommt eine neue Identitaet.
--
-- `source = 'admin'`: dieselben zwei Werte, die der CHECK aus `0033` kennt
-- ('import', 'admin'). Das ist nicht geraten — es ist die Bedingung dafuer,
-- dass `tools/import-catalog.mts` die Zeile nicht als „im Export
-- verschwunden" meldet (ADR-0070). `source` entscheidet sonst nirgends etwas.
-- ---------------------------------------------------------------------------
create or replace function public.seller_create_catalog_item(
  p_name        text,
  p_series_code text,
  p_item_type   text
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  /* Roh, nur aussen beschnitten (CLAUDE.md Regel 4): kein `strip()` im
     Inneren, keine Normalisierung, keine Uebersetzung. Der Betreiber tippt
     den Produktnamen, und der steht so im Katalog. */
  v_name            text := btrim(coalesce(p_name, ''));
  v_typ             text := btrim(lower(coalesce(p_item_type, '')));
  v_serie           text := btrim(coalesce(p_series_code, ''));
  v_kategorie_name  text;
  v_kategorie_id    bigint;
  v_position        smallint;
  v_next            bigint;
  v_sky_id          text;
  v_slug            text;
begin
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required' using errcode = 'insufficient_privilege';
  end if;

  if v_name = '' then
    raise exception 'an article needs a name' using errcode = 'check_violation';
  end if;

  /*
   * FIGUREN BLEIBEN BEIM ADMINISTRATOR, und das ist eine eigene Meldung und
   * kein Zweig der Typpruefung: „nicht erlaubt" und „kenne ich nicht" sind
   * verschiedene Auskuenfte, und die erste muss sagen, wohin man stattdessen
   * geht.
   */
  if v_typ = 'figure' then
    raise exception 'a figure is created in the catalog administration, not here (ADR-0034)'
      using errcode = 'insufficient_privilege';
  end if;

  v_kategorie_name := case v_typ
                        when 'game'   then 'Spiele'
                        when 'portal' then 'Portale'
                        when 'bundle' then 'Bundles'
                        when 'other'  then 'Zubehör'
                      end;
  if v_kategorie_name is null then
    raise exception 'unknown item type %: expected game, portal, bundle or other', v_typ
      using errcode = 'check_violation';
  end if;

  /*
   * DIE SERIE MUSS ES GEBEN, und sie wird hier gefragt und nicht dem
   * Fremdschluessel ueberlassen: ein Tippfehler soll „diese Serie gibt es
   * nicht" heissen und nicht „violates foreign key constraint".
   */
  if not exists (select 1 from public.series x where x.code = v_serie) then
    raise exception 'unknown series %', v_serie using errcode = 'check_violation';
  end if;

  -- ---- Die Kategorie: gefunden oder angelegt ---------------------------
  select c.id into v_kategorie_id
    from public.categories c
   where c.series_code = v_serie and c.name = v_kategorie_name;

  if v_kategorie_id is null then
    /*
     * `(series_code, position)` ist eindeutig, also ans Ende. `max + 1` ist
     * hier erlaubt, anders als bei einer SKY-ID: eine Position ist
     * Darstellungsreihenfolge und keine Identitaet.
     */
    select coalesce(max(c.position), -1) + 1 into v_position
      from public.categories c where c.series_code = v_serie;

    insert into public.categories (series_code, position, name)
    values (v_serie, v_position, v_kategorie_name)
    returning id into v_kategorie_id;
  end if;

  -- ---- Die Identitaet, bevor irgendetwas geschrieben wird --------------
  v_next := nextval('public.sky_id_seq');
  if v_next > 8999 then
    raise exception
      'SKY-ID allocation range exhausted: % is beyond SKY-8999, and SKY-9000-9999 is the reserved system/test range (ADR-0070)',
      v_next
      using errcode = 'check_violation';
  end if;

  v_sky_id := 'SKY-' || lpad(v_next::text, 4, '0');
  v_slug   := public.next_figure_slug(v_name, v_serie, v_sky_id);

  /*
   * `item_type` STEHT AUSDRUECKLICH IN DER ZEILE.
   *
   * Der Trigger aus `0135` leitet nur ab, wenn dort der Vorgabewert 'figure'
   * steht. Hier steht der gewaehlte Typ, also laesst er ihn stehen — und die
   * Ableitung aus der Kategorie wuerde ohnehin dasselbe ergeben. Zwei Wege,
   * ein Ergebnis; Abschnitt 5 prueft das.
   *
   * `catalog_visible = false`: unsichtbar im oeffentlichen Katalog, bis ein
   * Administrator entscheidet (ADR-0039). Die Artikelsuche im Einkaufsbuch
   * zeigt ihn trotzdem — sie fragt `seller_import_catalog()`, und die
   * liefert auch ausgeblendete Zeilen.
   */
  insert into public.skylanders
    (sky_id, name, slug, series_code, category_id,
     item_type, card_type, catalog_visible, source, is_active)
  values
    (v_sky_id, v_name, v_slug, v_serie, v_kategorie_id,
     v_typ, 'standard', false, 'admin', true);

  /*
   * EIN EINTRAG FUER DIE ENTSTEHUNG — dieselbe Zeile, die
   * `admin_create_figure` schreibt, damit der Katalogjournal beide Wege
   * gleich fuehrt. `changed_by` ist das Betriebskonto; der Journal sagt
   * damit auch, DASS die Zeile nicht aus dem Adminbereich kam.
   */
  insert into public.catalog_admin_changes
    (entity, entity_id, field, old_value, new_value, changed_by)
  values ('skylander', v_sky_id, 'created', null, v_name, (select auth.uid()));

  return v_sky_id;
end;
$$;

comment on function public.seller_create_catalog_item(text, text, text) is
  'Creates ONE accessory article from the Einkaufsbuch (0137): game, portal, bundle or other. Refuses item_type figure - a figure is curated catalog identity and is created in the catalog administration (ADR-0034). Always catalog_visible = false, source = admin, no price, no image, no override. The category follows from the type and is created at the end of its series if missing; the SKY-ID comes from sky_id_seq and is never derived from a name (CLAUDE.md rule 2). Returns the new SKY-ID so the caller can select it without searching again.';

revoke all on function public.seller_create_catalog_item(text, text, text) from public, anon;
grant execute on function public.seller_create_catalog_item(text, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. Die Artikelauswahl erfaehrt den Artikeltyp
--
-- WARUM DROP UND NEU: der Rueckgabetyp waechst um eine Spalte, und
-- `create or replace function` kann einen Rueckgabetyp nicht aendern. Die
-- Funktion hat keine Argumente, der Drop ist also eindeutig.
--
-- ANGEHAENGT, NICHT EINGESCHOBEN — dieselbe Regel wie in `0117`: die sieben
-- Spalten von dort behalten ihre Ordnungszahlen, `item_type` wird die achte.
--
-- WAS SIE WEITER NICHT TUT: filtern. Sie liefert alle Zeilen, denn derselbe
-- Aufruf bedient den Arbeitsmappen-Import. Gefiltert wird dort, wo die
-- Auswahlliste entsteht.
-- ---------------------------------------------------------------------------
drop function if exists public.seller_import_catalog();

create or replace function public.seller_import_catalog()
returns table (
  sky_id          text,
  name            text,
  series_code     text,
  category        text,
  display_name    text,
  catalog_visible boolean,
  is_active       boolean,
  /*
   * DIE ACHTE SPALTE (0137).
   *
   * Die Kategorie steht schon auf Position 4 — der Artikeltyp ist trotzdem
   * nicht dasselbe: er ist die fachliche Eigenschaft der ZEILE, die
   * Kategorie ist Darstellungsstruktur, und `0135` haelt beides absichtlich
   * getrennt. Die Suche im Einkaufsbuch zeigt und findet darueber „Spiel"
   * und „Portal", ohne einen Kategorienamen zu interpretieren.
   */
  item_type       text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- Dasselbe Tor, das jede andere `seller_*`-Funktion fragt, und dasselbe,
  -- das die /business-Route vor dem Rendern fragt. Ein Plattformadministrator
  -- ist bewusst NICHT zugelassen (0042).
  if not public.can_operate_active_seller() then
    raise exception 'seller operator role required'
      using errcode = 'insufficient_privilege';
  end if;

  /*
   * `name` IST UND BLEIBT DER ROHNAME — `classifyRow()` matcht darauf, und
   * die Arbeitsmappe enthaelt Rohnamen. `display_name` steht DANEBEN.
   * Unveraendert aus `0117`; die einzige Aenderung ist `s.item_type` am Ende.
   */
  return query
    select s.sky_id,
           s.name,
           s.series_code,
           coalesce(c.name, ''),
           coalesce(s.display_name_override, s.name),
           s.catalog_visible,
           s.is_active,
           s.item_type
      from public.skylanders s
      left join public.categories c on c.id = s.category_id;
end;
$$;

comment on function public.seller_import_catalog() is
  'The catalog as the Einkaufsbuch needs it (0052, widened in 0117 and 0137). `name` is the RAW name and stays that way - the workbook importer matches on it, and a workbook does not know today''s editorial decisions. `display_name` is what a person should read. `catalog_visible` and `is_active` ride along so the picker can offer precisely what the catalog offers, while the importer ignores both. `item_type` (0137) tells games and portals apart from figures without interpreting a category name. No price, no image, no slug, no editorial note.';

revoke all on function public.seller_import_catalog() from public, anon;
grant execute on function public.seller_import_catalog() to authenticated;


-- ---------------------------------------------------------------------------
-- 6. Nachbedingungen
--
-- Hier wird NICHT gelesen, was jetzt da ist, sondern gegen die Abdruecke aus
-- Abschnitt 1 verglichen. Jede Abweichung bricht die Transaktion ab.
-- ---------------------------------------------------------------------------
do $$
declare
  v_ist   text;
  v_soll  text;
  v_n     integer;
  v_args  text;
begin
  if to_regclass('pg_temp.z2_abdruck') is null then
    raise exception '0137 Abbruch: der Abdruck aus Abschnitt 1 ist fort — '
      'die Datei lief nicht als eine Transaktion';
  end if;

  -- ---- Die Ableitung: Positivliste, und nichts darueber hinaus ---------
  for v_soll, v_ist in
    select * from (values
      ('game',   'Spiele'),
      ('portal', 'Portale'),
      ('bundle', 'Bundles'),
      ('other',  'Taschen'),
      ('other',  'Zubehör')
    ) as t(erwartet, kategorie)
  loop
    if public.catalog_item_type_for_category(v_ist) <> v_soll then
      raise exception '0137 Befund: Kategorie "%" leitet nicht auf % ab, sondern auf %',
        v_ist, v_soll, public.catalog_item_type_for_category(v_ist);
    end if;
  end loop;

  /*
   * UND ALLES ANDERE BLEIBT FIGUR. Das ist die eigentliche Zusicherung:
   * „Bitte keine pauschale Klassifizierung unbekannter Artikel." NULL
   * eingeschlossen — `case null when 'Spiele'` trifft keinen Zweig und
   * landet im `else`.
   */
  foreach v_ist in array array['Figuren', 'Senseis', 'Traps', 'Magic Items',
                               'Portal', 'Portale ', 'portale', 'Bundle',
                               'Starter Pack', 'Zubehoer', '', 'Unbekannt']
  loop
    if public.catalog_item_type_for_category(v_ist) <> 'figure' then
      raise exception '0137 Befund: Kategorie "%" leitet auf % ab, erwartet figure',
        v_ist, public.catalog_item_type_for_category(v_ist);
    end if;
  end loop;
  if public.catalog_item_type_for_category(null) <> 'figure' then
    raise exception '0137 Befund: eine Zeile ohne Kategorie leitet nicht auf figure ab';
  end if;

  -- ---- Die Kategorieliste ----------------------------------------------
  select array_to_string(public.non_collectible_categories(), ',') into v_ist;
  if v_ist <> 'Spiele,Portale,Bundles,Taschen,Zubehör' then
    raise exception '0137 Befund: non_collectible_categories() ist "%"', v_ist;
  end if;

  -- ---- Die neue Funktion: Form und Rechte ------------------------------
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'seller_create_catalog_item';
  if v_n <> 1 then
    raise exception '0137 Befund: seller_create_catalog_item hat % Overload(s), erwartet 1', v_n;
  end if;

  select pg_get_function_arguments(p.oid) into v_args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'seller_create_catalog_item';
  if v_args <> 'p_name text, p_series_code text, p_item_type text' then
    raise exception '0137 Befund: seller_create_catalog_item nimmt (%)', v_args;
  end if;

  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'seller_create_catalog_item'
                    and p.prosecdef) then
    raise exception '0137 Befund: seller_create_catalog_item ist nicht security definer';
  end if;

  if has_function_privilege('anon', 'public.seller_create_catalog_item(text, text, text)', 'EXECUTE') then
    raise exception '0137 Befund: anon darf seller_create_catalog_item ausfuehren';
  end if;
  if not has_function_privilege('authenticated',
        'public.seller_create_catalog_item(text, text, text)', 'EXECUTE') then
    raise exception '0137 Befund: authenticated darf seller_create_catalog_item NICHT ausfuehren';
  end if;
  /* PUBLIC wird ueber `aclexplode` gelesen: `has_function_privilege('public', ...)`
     kennt keine Rolle dieses Namens und wuerde werfen. Grantee 0 ist PUBLIC;
     ein NULL `proacl` hiesse „EXECUTE fuer PUBLIC". */
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'seller_create_catalog_item'
       and (p.proacl is null
            or exists (select 1 from aclexplode(p.proacl) a
                        where a.grantee = 0 and a.privilege_type = 'EXECUTE'))) then
    raise exception '0137 Befund: PUBLIC darf seller_create_catalog_item ausfuehren';
  end if;

  -- ---- Die Auswahlfunktion: acht Spalten, in dieser Reihenfolge --------
  select string_agg(a.name, ',' order by a.ord) into v_ist
    from (select unnest(p.proargnames) as name,
                 generate_subscripts(p.proargnames, 1) as ord
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'seller_import_catalog') a;
  if v_ist <> 'sky_id,name,series_code,category,display_name,catalog_visible,is_active,item_type' then
    raise exception '0137 Befund: seller_import_catalog liefert "%"', v_ist;
  end if;
  if has_function_privilege('anon', 'public.seller_import_catalog()', 'EXECUTE') then
    raise exception '0137 Befund: anon darf seller_import_catalog ausfuehren';
  end if;
  if not has_function_privilege('authenticated', 'public.seller_import_catalog()', 'EXECUTE') then
    raise exception '0137 Befund: authenticated darf seller_import_catalog NICHT ausfuehren';
  end if;

  -- ---- Und nichts hat sich geaendert -----------------------------------
  v_soll := (select wert from z2_abdruck where schluessel = 'zeilen');
  v_ist  := (select count(*)::text from public.skylanders);
  if v_ist <> v_soll then
    raise exception '0137 Befund: % Katalogzeilen, vorher %', v_ist, v_soll;
  end if;

  v_soll := (select wert from z2_abdruck where schluessel = 'typen');
  v_ist  := (select coalesce(string_agg(x.item_type || '=' || x.n::text, ',' order by x.item_type), '')
               from (select s.item_type, count(*) as n
                       from public.skylanders s group by s.item_type) x);
  if v_ist <> v_soll then
    raise exception '0137 Befund: Artikeltypverteilung ist "%", vorher "%"', v_ist, v_soll;
  end if;

  v_soll := (select wert from z2_abdruck where schluessel = 'angebote_md5');
  v_ist  := (select md5(coalesce(string_agg(o.sky_id || '|' || o.condition || '|'
                                            || coalesce(o.price::text, ''),
                                            ';' order by o.sky_id, o.condition), ''))
               from public.shop_offers() o);
  if v_ist <> v_soll then
    raise exception '0137 Befund: die Angebotsliste hat sich geaendert (md5 % statt %)',
      v_ist, v_soll;
  end if;

  v_soll := (select wert from z2_abdruck where schluessel = 'angebote');
  v_ist  := (select count(*)::text from public.shop_offers());
  if v_ist <> v_soll then
    raise exception '0137 Befund: % Angebote, vorher %', v_ist, v_soll;
  end if;

  v_soll := (select wert from z2_abdruck where schluessel = 'shopfaehig');
  v_ist  := (select count(*)::text from public.skylanders s
              where public.is_shop_eligible(s.sky_id));
  if v_ist <> v_soll then
    raise exception '0137 Befund: % shopfaehige Zeilen, vorher %', v_ist, v_soll;
  end if;

  v_soll := (select wert from z2_abdruck where schluessel = 'sammelbar');
  v_ist  := (select count(*)::text from public.skylanders s
               join public.categories c on c.id = s.category_id
              where s.is_active and s.catalog_visible
                and not (c.name = any (public.non_collectible_categories())));
  if v_ist <> v_soll then
    raise exception '0137 Befund: % sammelbare Zeilen, vorher %', v_ist, v_soll;
  end if;

  v_soll := (select wert from z2_abdruck where schluessel = 'sammelbar_je_serie');
  v_ist  := (select coalesce(string_agg(x.series_code || '=' || x.n::text, ',' order by x.series_code), '')
               from (select s.series_code, count(*) as n
                       from public.skylanders s
                       join public.categories c on c.id = s.category_id
                      where s.is_active and s.catalog_visible
                        and not (c.name = any (public.non_collectible_categories()))
                      group by s.series_code) x);
  if v_ist <> v_soll then
    raise exception '0137 Befund: sammelbar je Serie ist "%", vorher "%"', v_ist, v_soll;
  end if;

  -- ---- Und keine Zeile steht in einer der neuen Kategorien -------------
  select count(*) into v_n
    from public.skylanders s
    join public.categories c on c.id = s.category_id
   where c.name in ('Portale', 'Bundles', 'Taschen', 'Zubehör');
  if v_n > 0 then
    raise exception '0137 Befund: % Zeile(n) stehen in einer Zubehoerkategorie — '
      'diese Migration legt keinen Artikel an', v_n;
  end if;

  raise notice '0137 fertig: Ableitung und Kategorieliste erweitert, '
    'seller_create_catalog_item angelegt, seller_import_catalog liefert item_type. '
    'Unveraendert: % Angebote (md5 %), % sammelbar, % Katalogzeilen',
    (select wert from z2_abdruck where schluessel = 'angebote'),
    (select wert from z2_abdruck where schluessel = 'angebote_md5'),
    (select wert from z2_abdruck where schluessel = 'sammelbar'),
    (select wert from z2_abdruck where schluessel = 'zeilen');
end $$;

/*
 * Kein `drop table z2_abdruck;` am Ende. `on commit drop` raeumt sie auf —
 * bei `commit` wie bei `rollback` —, und ein ausdrueckliches Drop wuerde nur
 * den Fall verdecken, in dem die Datei ohne Transaktionsklammer laeuft.
 */
-- <<< ENDE: supabase/migrations/0137_catalog_accessories.sql

commit;
