-- ===========================================================================
-- PRODUCTION — EIN LAUF FUER 0138
--              (die 21 Portale der Arbeitsmappe entstehen)
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
--   B   Migration 0138, ZEICHEN FUER ZEICHEN aus
--       `supabase/migrations/0138_catalog_portals.sql`.
--       `src/lib/catalog/staging-oneshot.test.ts` vergleicht beides bei jedem
--       Testlauf; eine Abweichung faellt auf, bevor jemand sie ausfuehrt.
--
-- Die Vor- und Nachbedingungen stehen in der Migration selbst und werden
-- hier NICHT wiederholt. Diese Datei fuegt genau eine Pruefung hinzu — die
-- nach dem Projekt —, weil die Migration sie nicht kennen kann.
--
-- WAS SIE NICHT TUT
--
--   * Sie macht die 21 Portale NICHT oeffentlich sichtbar
--     (`catalog_visible = false`), NICHT sammelbar und NICHT verkaeuflich.
--   * Sie zieht KEINE SKY-ID: die 21 Nummern sind vorgegeben, und
--     `sky_id_seq` bleibt stehen.
--   * Keine Lagerzeile, kein Preis, kein Bild, keine Einkaufsposition.
--
-- SIE SETZT `0137` VORAUS — ohne die erweiterte Kategorieregel waere das
-- erste Portal im Augenblick seiner Entstehung eine sammelbare, shopfaehige
-- Figur.
--
-- ########################################################################
-- ##  REIHENFOLGE: DIESE DATEI ERST NACH DEM VERCEL-DEPLOYMENT.          ##
-- ##  Der bis zum 2026-10-21 deployte Code (81386e6) kannte nur          ##
-- ##  `Spiele` als nicht sammelbar und haette 21 Portale als Figuren in  ##
-- ##  Katalog und Fortschrittsnenner gezeigt.                            ##
-- ##                                                                     ##
-- ##  DIESE BEDINGUNG IST ERFUELLT: am 2026-10-21 ist `21353e4` deployt  ##
-- ##  und live geprueft (PROJECT_STATUS.md). Dessen                       ##
-- ##  NON_COLLECTIBLE_CATEGORIES nennt alle fuenf Kategorien, und         ##
-- ##  `verify:shop:prod` hat die Uebereinstimmung mit der Datenbank       ##
-- ##  gemessen. Die Sperre gegen diese Datei ist damit aufgehoben — eine  ##
-- ##  FREIGABE ist sie nicht.                                            ##
-- ########################################################################
--
-- ERWARTETES ERGEBNIS: die `NOTICE`-Zeilen der Migration, und `commit`.
-- Jede Abweichung bricht ab und rollt alles zurueck.
--
-- RUECKNAHME: `supabase/rollback/R0138_drop_portals.sql`.
-- REIHENFOLGE UND STOPP-KRITERIEN: `supabase/checks/production_release_0135_0141.md`.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- A. Bin ich wirklich auf Production?
--
-- DREI BEDINGUNGEN, UND ALLE DREI MUESSEN GELTEN. Eine negative allein waere
-- schwach: „kein Staging" stimmt auch fuer eine leere Datenbank.
--
--   A1  Das vollstaendige STAGING-MARKERPAAR fehlt. Der Marker ist das PAAR
--       `SKY-0821` UND `SKY-0822` — so ist er definiert
--       (`supabase/checks/staging_pending_migrations.sql`, Zeile 101:
--       „`SKY-0821` **und** `SKY-0822` vorhanden").
--   A2  `0133` ist angewendet. Sie liegt seit dem 2026-10-18 auf Production
--       und fehlt auf Staging — dieselbe Akte, Zeile 211. Das ist der
--       POSITIVE Teil: er unterscheidet Production von einer beliebigen
--       anderen Datenbank, die nur das Markerpaar nicht hat.
--   A3  Und es ist kein leeres Projekt: der Katalog traegt Zeilen.
--
-- WARUM DAS PAAR UND NICHT EINE EINZELNE ID
--
-- Eine frueher hier stehende Fassung brach bei IRGENDEINER der beiden ab.
-- Das war strenger als die Definition des Markers — und falsch: Production
-- traegt `SKY-0821` als ECHTEN Artikel. Gemessen am 2026-10-21:
--
--   SKY-0821  „Winterfest Lob-Star", slug `winterfest-lob-star-trap-team`,
--             `source = admin`, angelegt 2026-09-16, aktiv und redaktionell
--             ausgeblendet. SKY-0822 gibt es dort nicht.
--
-- Die ID liegt im produktiven Allokationsbereich `SKY-0821`-`SKY-8999`
-- (`docs/SKYLANDERS_DATA.md`) — sie GEHOERT dort hin. Auf Staging sind
-- beide IDs Charakterimport-Fixtures; dort liegen also beide.
--
-- DER SCHUTZ WIRD DADURCH NICHT SCHWAECHER. Staging faellt zweifach: an A1
-- (beide Marker da) UND an A2 (`0133` fehlt dort). Eine Datenbank, die nur
-- einen Marker traegt und `0133` nicht hat, faellt an A2. Probelauf P41
-- fuehrt alle vier Faelle vor.
-- ---------------------------------------------------------------------------
do $lauf_a$
begin
  if (select count(*) from public.skylanders
       where sky_id in ('SKY-0821', 'SKY-0822')) = 2 then
    raise exception 'ABBRUCH A1: das vollstaendige STAGING-Markerpaar ist da '
      '(SKY-0821 UND SKY-0822). Diese Datei ist fuer Production '
      '(zmiwxswrpkmizvqsgype) — auf Staging gehoert '
      'supabase/operations/staging-0138.sql.';
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
-- >>> EINGEBETTET: supabase/migrations/0138_catalog_portals.sql
-- ===========================================================================
-- 0138 — DIE 21 PORTALE DER ARBEITSMAPPE WERDEN KATALOGARTIKEL
--         (ADR-0128, Schritt Z3)
--
-- ###########################################################################
-- ##  NICHT ANGEWENDET — WEDER AUF STAGING NOCH AUF PRODUCTION.            ##
-- ##  Setzt `0137` voraus und braucht eine eigene Freigabe.                ##
-- ###########################################################################
--
-- WAS SIE TUT, UND NUR DAS
--
--   1. Die Kategorie `Portale` entsteht in jeder der sechs Serien, in der ein
--      Portal steht — am ENDE der Kategoriereihenfolge, `catalog_group` NULL,
--      wie bei den sechs `Spiele`-Kategorien.
--   2. 21 Katalogzeilen entstehen: `item_type = 'portal'`,
--      `catalog_visible = false`, kein Preis, kein Bild, keine
--      Charakterzuordnung, `source = 'admin'`.
--   3. Je Zeile ein Eintrag in `catalog_admin_changes` mit `field = 'created'`
--      — dieselbe Zeile, die `admin_create_figure` und
--      `seller_create_catalog_item` schreiben. `changed_by` ist NULL, und das
--      ist die dokumentierte Bedeutung von NULL dort: „kam ueber die
--      Service-Rolle, ein Import, ein Skript" (`0004`).
--
-- DIE SKY-IDs SIND VOM BETREIBER VERGEBEN UND WERDEN UEBERNOMMEN
--
-- `SKY-0615`-`0622`, `0624`-`0630`, `0632`-`0637` — 21 Nummern aus dem Blatt
-- `ZB` der Arbeitsmappe (docs/SKYLANDERS_DATA.md, Abschnitt 11k). Sie werden
-- NICHT erzeugt, nicht abgeleitet, nicht aus `sky_id_seq` gezogen und nicht
-- aus „Maximum plus eins" berechnet (CLAUDE.md Regel 2). Die beiden
-- Disney-Infinity-Portale `SKY-0623` und `SKY-0631` bleiben ausdruecklich
-- AUSSEN VOR, und genau deshalb hat die Folge zwei Luecken — sie sind kein
-- Versehen, sondern die Entscheidung aus ADR-0128, Punkt 9.
--
-- `sky_id_seq` WIRD NICHT ANGEFASST. Die 21 Nummern liegen UNTER dem
-- Sequenzstand (Z0: hoechste vergebene ID `SKY-0822`), es gibt also keine
-- Kollision mit einer kuenftigen Ausgabe — und `0138` ruft kein `nextval`.
-- Abschnitt 1 nimmt den Sequenzstand als Abdruck, Abschnitt 4 vergleicht ihn.
--
-- WAS DER NAME IST, UND WAS ER NICHT IST
--
-- `name` ist Spalte B der Arbeitsmappe, ZEICHENGLEICH: `84157790 (SA)`,
-- `83973080A Wireless (SA)`, `84721790 (SF, T, SC)`. Keine Korrektur, keine
-- Normalisierung, kein „Portal of Power" davor (CLAUDE.md Regel 4). Der
-- kurze Anzeigename `Portal – <Serie>` wird BERECHNET und nicht gespeichert
-- (ADR-0128, Punkt 1); `display_name_override` bleibt NULL, damit eine
-- spaetere redaktionelle Entscheidung nichts ueberschreiben muss.
--
-- `SKY-0637` TRAEGT DIE SERIE `SF`
--
-- Die Mappe nennt dort drei Serien (`SF, T, SC`). `skylanders.series_code`
-- ist einwertig und traegt einen zusammengesetzten Fremdschluessel — eine
-- n:m-Tabelle waere ADR-0128, Punkt 4, und die ist nicht gebaut. Entscheidung
-- des Betreibers vom 2026-10-20: die Einordnung ist `SF`, die erste und
-- aelteste der drei. Die vollstaendige dokumentierte Zuordnung bleibt im
-- ROHNAMEN lesbar — `84721790 (SF, T, SC)` —, also in den Quelldaten und
-- nicht in einer abgeleiteten Spalte. `series_scope` aus ADR-0128 wird damit
-- NICHT gebraucht und NICHT angelegt.
--
-- WAS SIE NICHT TUT
--
--   * Sie legt KEINE Spalte an. `platforms`, `series_scope`, `model_no` und
--     `language` aus ADR-0128 bleiben ungebaut: das Einkaufsbuch braucht sie
--     nicht, und eine Spalte ohne Leser ist eine Spalte, die veraltet.
--     Plattform und Modellnummer stehen in Spalte B und damit im Rohnamen.
--   * Sie legt KEIN Bundle und KEINE Tasche an (`SKY-0639`-`0642`), kein
--     Disney-Infinity-Portal (`SKY-0623`, `SKY-0631`) und nicht die Beleg-URL
--     `SKY-0638` — die ist gar kein Artikel.
--   * Sie haengt KEINE historische Einkaufsposition um. Die Positionen ohne
--     `sky_id` behalten ihren Rohnamen als Herkunftsnachweis; zugeordnet wird
--     einzeln und von Hand ueber den Figurenwechsel (ADR-0128, Punkt 10).
--   * Sie aendert KEINE Funktion, KEINEN Trigger, KEIN Recht und KEINE
--     Kategorieregel. `0137` hat den Weg gelegt; diese Datei geht ihn.
--   * Keine Lagerzeile, keine Bewegung, kein Beleg, kein Einkauf. Die
--     Belegsperre wird nicht beruehrt.
--
-- UND DIE ZAHLEN, DIE NUTZER KENNEN, AENDERN SICH NICHT
--
-- Das ist die eigentliche Zusicherung, und die Datei beweist sie selbst.
-- 21 neue Katalogzeilen in einer Kategorie, die `non_collectible_categories()`
-- seit `0137` nennt, und mit einem `item_type`, den `is_shop_eligible()` seit
-- `0135` ausschliesst:
--
--   * der Sammlungsfortschritt bekommt KEINEN groesseren Nenner — weder
--     insgesamt noch je Serie,
--   * `shop_offers()` liefert dieselbe Liste, Zeichen fuer Zeichen,
--   * die Zahl der shopfaehigen Zeilen bleibt gleich,
--   * kein `display_name_override` wird beruehrt.
--
-- Abschnitt 1 nimmt dafuer acht Abdruecke, Abschnitt 4 vergleicht sie, und
-- eine Abweichung rollt alles zurueck — die 21 Zeilen eingeschlossen.
--
-- ZWEI RIEGEL, UND BEIDE WERDEN GEPRUEFT. Ein Portal ist nicht sammelbar,
-- weil seine KATEGORIE in der Liste steht, UND weil sein ARTIKELTYP nicht
-- `figure` ist. Keiner der beiden haengt daran, dass der andere gesetzt
-- wurde; Abschnitt 4 fragt beide getrennt.
--
-- REIHENFOLGE UND ABHAENGIGKEITEN
--
-- Haengt an `0001` (skylanders, categories, series), `0004`
-- (catalog_admin_changes, Feldwert `created` seit `0033`), `0033`
-- (`next_figure_slug`, `slugify`), `0135` (`item_type`, der Trigger) und
-- zwingend an `0137`: ohne dessen `non_collectible_categories()` waere das
-- erste Portal eine sammelbare, shopfaehige Figur. Abschnitt 1 bricht
-- deshalb ab, wenn `0137` fehlt — gefragt wird nicht nach einer Nummer,
-- sondern nach der WIRKUNG: nennt die Kategorieliste `Portale`, und leitet
-- `catalog_item_type_for_category('Portale')` auf `portal` ab.
--
-- EINE TRANSAKTION, UND SIE PRUEFT SICH SELBST
--
-- Wie `0135` und `0137`: Abschnitt 1 legt eine temporaere Tabelle mit
-- `on commit drop` an und bricht ab, wenn sie unmittelbar danach schon
-- wieder fort ist. Es gibt keinen Weg, diese Migration halb anzuwenden.
--
-- AUSFUEHRUNG: im SQL-Editor, vollstaendig in `begin` / `commit` geklammert.
-- Vorher `0138_preflight.sql`, danach `0138_postflight.sql`, beide mit dem
-- Z0-Vertrag im Modus `staging`. Die genaue Klickfolge — und warum `0137`
-- dabei in derselben Sitzung davor steht — liegt in
-- `supabase/checks/0137_0138_staging_run.md`.
--
-- KEIN EINMAL-SKRIPT. `0135` und `0136` hatten eines, weil sie zusammen
-- laufen MUSSTEN: die Sicherungsfunktion aus `0136` liest die Spalte aus
-- `0135`, und ein halber Stand waere eine Datensicherung, die erst im
-- Ernstfall nicht mehr laeuft. `0137` und `0138` sind dagegen zwei
-- Transaktionen mit zwei Freigaben: nach `0137` ist der Weg da und niemand
-- muss ihn gehen, und nach `0138` stehen die Artikel. Beide Staende sind
-- fuer sich genommen in Ordnung.
--
-- Ruecknahme: `supabase/rollback/R0138_drop_portals.sql` — und zwar VOR
-- `R0137`, nicht danach: `R0137` bricht von sich aus ab, solange eine Zeile
-- in einer Zubehoerkategorie steht.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen, die Artikelliste und die Abdruecke
--
-- Beide Tabellen sind TEMPORAER: sie leben nur in dieser Sitzung und koennen
-- keine Geschaeftszeile beruehren.
-- ---------------------------------------------------------------------------
create temporary table z3_abdruck (
  schluessel text primary key,
  wert       text not null
) on commit drop;

/*
 * DIE 21 ZEILEN, ALS DATEN UND NICHT ALS 21 ANWEISUNGEN.
 *
 * Die Reihenfolge ist die der Arbeitsmappe (Spalte A aufsteigend), und die
 * Spalte `serie` ist die EINORDNUNG — bei `SKY-0637` also `SF`, waehrend der
 * Rohname weiter alle drei Serien nennt. Dass die Liste genau 21 Zeilen hat
 * und genau diese SKY-IDs traegt, prueft Abschnitt 1 unten; dass keine
 * Disney-Infinity-Zeile darin steht, auch.
 */
create temporary table z3_portal (
  sky_id text primary key,
  name   text not null,
  serie  text not null
) on commit drop;

insert into z3_portal (sky_id, name, serie) values
  ('SKY-0615', '84157790 (SA)',            'SA'),
  ('SKY-0616', '83973080 (SA)',            'SA'),
  ('SKY-0617', '83973080A Wireless (SA)',  'SA'),
  ('SKY-0618', '0000502 (G)',              'G'),
  ('SKY-0619', '0000547 (SF)',             'SF'),
  ('SKY-0620', '0000586 (T)',              'T'),
  ('SKY-0621', '0000655 (SC)',             'SC'),
  ('SKY-0622', '0000726 (I)',              'I'),
  -- SKY-0623 ist ein Disney-Infinity-Portal. Luecke mit Grund (ADR-0128, 9).
  ('SKY-0624', '84151790 (SA)',            'SA'),
  ('SKY-0625', '84392790 (G)',             'G'),
  ('SKY-0626', '84392080 (G)',             'G'),
  ('SKY-0627', '84704790 (SF)',            'SF'),
  ('SKY-0628', '87031790 (T)',             'T'),
  ('SKY-0629', '87504790 (SC)',            'SC'),
  ('SKY-0630', '84704791 (I)',             'I'),
  -- SKY-0631 ist das zweite Disney-Infinity-Portal. Zweite Luecke mit Grund.
  ('SKY-0632', '84709790 (SF)',            'SF'),
  ('SKY-0633', '87036790 (T)',             'T'),
  ('SKY-0634', '87506790 (SC)',            'SC'),
  ('SKY-0635', '84154080 (SA)',            'SA'),
  ('SKY-0636', '84394790 (G)',             'G'),
  -- Drei Serien in der Mappe, eine Einordnung in der Spalte: siehe Kopf.
  ('SKY-0637', '84721790 (SF, T, SC)',     'SF');

do $$
declare
  v_n     integer;
  v_text  text;
begin
  /*
   * DER KLAMMERGRIFF — wie in `0135` und `0137`. Laeuft die Datei nicht in
   * einer Transaktion, sind die beiden Tabellen oben schon wieder fort, und
   * dieser Block bricht ab, BEVOR eine Katalogzeile entsteht.
   */
  if to_regclass('pg_temp.z3_abdruck') is null
     or to_regclass('pg_temp.z3_portal') is null then
    raise exception '0138 Abbruch: die Datei laeuft nicht in einer Transaktion — '
      'in begin / commit klammern und vollstaendig ausfuehren';
  end if;

  /*
   * EIN ZEITLIMIT AUF DIE SPERRE, transaktionslokal. Diese Migration nimmt
   * keine ACCESS EXCLUSIVE auf `skylanders` — sie legt keine Spalte an —,
   * aber 21 INSERTs nehmen ROW EXCLUSIVE, und `categories` bekommt bis zu
   * sechs Zeilen. Fuenf Sekunden Grenze, dann bricht sie ab und laesst sich
   * wiederholen, statt den Katalog hinter sich aufzustauen.
   */
  perform set_config('lock_timeout', '5s', true);

  -- ---- Was da sein muss -------------------------------------------------
  if to_regclass('public.skylanders') is null then
    raise exception '0138 setzt 0001 voraus: skylanders fehlt';
  end if;
  if to_regclass('public.categories') is null then
    raise exception '0138 setzt 0001 voraus: categories fehlt';
  end if;
  if to_regclass('public.catalog_admin_changes') is null then
    raise exception '0138 setzt 0004 voraus: catalog_admin_changes fehlt';
  end if;
  if to_regprocedure('public.next_figure_slug(text, text, text)') is null then
    raise exception '0138 setzt 0033 voraus: next_figure_slug fehlt';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'skylanders'
                    and column_name = 'item_type') then
    raise exception '0138 setzt 0135 voraus: skylanders.item_type fehlt';
  end if;
  if to_regprocedure('public.catalog_item_type_for_category(text)') is null then
    raise exception '0138 setzt 0135 voraus: catalog_item_type_for_category fehlt';
  end if;
  if to_regprocedure('public.non_collectible_categories()') is null then
    raise exception '0138 setzt 0006 voraus: non_collectible_categories fehlt';
  end if;
  if to_regprocedure('public.is_shop_eligible(text)') is null then
    raise exception '0138 setzt 0008 voraus: is_shop_eligible fehlt';
  end if;

  /*
   * `0137` WIRD NACH SEINER WIRKUNG GEFRAGT, NICHT NACH SEINER NUMMER.
   *
   * Das Repository fuehrt keine Migrationstabelle, und eine Nummer in einem
   * Kommentar beweist nichts. Gefragt wird deshalb das, worauf diese Datei
   * sich wirklich stuetzt: dass `Portale` die Sammelbarkeit nimmt, und dass
   * die Ableitungsregel die Kategorie kennt. Fehlt eines davon, waeren die
   * 21 Zeilen sammelbare, shopfaehige Figuren — und zwar sofort.
   */
  if not ('Portale' = any (public.non_collectible_categories())) then
    raise exception '0138 setzt 0137 voraus: non_collectible_categories() nennt "Portale" nicht '
      '(ist: %)', array_to_string(public.non_collectible_categories(), ', ');
  end if;
  if public.catalog_item_type_for_category('Portale') <> 'portal' then
    raise exception '0138 setzt 0137 voraus: Kategorie "Portale" leitet auf % ab, erwartet portal',
      public.catalog_item_type_for_category('Portale');
  end if;

  -- ---- Die Artikelliste, gegen sich selbst geprueft ---------------------
  select count(*) into v_n from z3_portal;
  if v_n <> 21 then
    raise exception '0138 Abbruch: die Artikelliste hat % Zeilen, erwartet 21', v_n;
  end if;

  /* Genau diese 21 Nummern, in dieser Folge — mit den zwei Luecken, die den
     Disney-Infinity-Portalen gehoeren. Ein Tippfehler in der Liste oben
     faellt hier auf und nicht erst in der Datenbank. */
  select string_agg(p.sky_id, ',' order by p.sky_id) into v_text from z3_portal p;
  if v_text <> 'SKY-0615,SKY-0616,SKY-0617,SKY-0618,SKY-0619,SKY-0620,SKY-0621,'
             || 'SKY-0622,SKY-0624,SKY-0625,SKY-0626,SKY-0627,SKY-0628,SKY-0629,'
             || 'SKY-0630,SKY-0632,SKY-0633,SKY-0634,SKY-0635,SKY-0636,SKY-0637' then
    raise exception '0138 Abbruch: die SKY-IDs der Liste sind "%"', v_text;
  end if;

  if exists (select 1 from z3_portal p
              where p.sky_id in ('SKY-0623', 'SKY-0631', 'SKY-0638',
                                 'SKY-0639', 'SKY-0640', 'SKY-0641', 'SKY-0642')) then
    raise exception '0138 Abbruch: die Liste enthaelt eine Zeile, die nach ADR-0128 Punkt 9 '
      'nicht in den Skylanders-Katalog gehoert';
  end if;

  if exists (select 1 from z3_portal p where btrim(p.name) <> p.name or p.name = '') then
    raise exception '0138 Abbruch: ein Name in der Liste ist leer oder aussen nicht beschnitten';
  end if;

  -- ---- Die Serien muessen es geben --------------------------------------
  select string_agg(distinct p.serie, ', ' order by p.serie) into v_text
    from z3_portal p
   where not exists (select 1 from public.series s where s.code = p.serie);
  if v_text is not null then
    raise exception '0138 Abbruch: unbekannte Serie(n) %', v_text;
  end if;

  -- ---- Der Bereich muss frei sein ---------------------------------------
  /*
   * GEPRUEFT WIRD DER GANZE ZB-BEREICH, nicht nur die 21 Nummern.
   *
   * `SKY-0615`-`0642` gehoert der Arbeitsmappe. Steht dort IRGENDEINE Zeile,
   * dann hat jemand den Bereich anders benutzt als die Mappe ihn fuehrt —
   * und dann ist diese Migration der falsche Schritt, auch wenn die 21
   * Nummern selbst zufaellig noch frei waeren. Z0 hat den Bereich am
   * 2026-10-19 als frei gemessen (Zeile 201 = 0).
   */
  select count(*) into v_n from public.skylanders
   where sky_id between 'SKY-0615' and 'SKY-0642';
  if v_n > 0 then
    raise exception '0138 Abbruch: % Zeile(n) stehen schon im Bereich SKY-0615..SKY-0642 — '
      'der Bereich gehoert der Arbeitsmappe, und eine SKY-ID wird nie neu vergeben', v_n;
  end if;

  -- ---- Und die Kategorie darf noch keine Zeile tragen -------------------
  select count(*) into v_n
    from public.skylanders s
    join public.categories c on c.id = s.category_id
   where c.name = 'Portale';
  if v_n > 0 then
    raise exception '0138 Abbruch: % Zeile(n) stehen schon in einer Kategorie "Portale"', v_n;
  end if;

  -- ---- Die Abdruecke ----------------------------------------------------
  insert into z3_abdruck (schluessel, wert) values
    ('zeilen',     (select count(*)::text from public.skylanders)),
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
    ('override_md5',
       (select md5(coalesce(string_agg(s.sky_id || '|' || s.display_name_override,
                                       ';' order by s.sky_id), ''))
          from public.skylanders s where s.display_name_override is not null)),
    /*
     * DER SEQUENZSTAND. `last_value` aus `pg_sequences` statt `currval` oder
     * `nextval`: beide WUERDEN die Sequenz benutzen, und genau das soll diese
     * Migration nicht. Fehlt das Leserecht, steht `(unbekannt)` da — ein
     * Abdruck, der sich selbst als nicht vergleichbar ausweist, ist besser
     * als eine abgebrochene Migration oder eine stillschweigend uebersprungene
     * Pruefung.
     */
    ('sequenz',
       coalesce((select q.last_value::text from pg_sequences q
                  where q.schemaname = 'public' and q.sequencename = 'sky_id_seq'),
                '(unbekannt)'));

  raise notice '0138 Abdruck: % Zeilen, % Angebote (md5 %), % sammelbar, Typen %, Sequenz %',
    (select wert from z3_abdruck where schluessel = 'zeilen'),
    (select wert from z3_abdruck where schluessel = 'angebote'),
    (select wert from z3_abdruck where schluessel = 'angebote_md5'),
    (select wert from z3_abdruck where schluessel = 'sammelbar'),
    (select wert from z3_abdruck where schluessel = 'typen'),
    (select wert from z3_abdruck where schluessel = 'sequenz');
end $$;


-- ---------------------------------------------------------------------------
-- 2. Die Kategorie `Portale` je Serie
--
-- ANS ENDE DER REIHENFOLGE, `max(position) + 1`. Eine Position ist
-- Darstellungsreihenfolge und keine Identitaet — `max + 1` ist hier also
-- erlaubt, anders als bei einer SKY-ID. Dieselbe Regel, die
-- `seller_create_catalog_item` aus `0137` anwendet; eine zweite Regel fuer
-- dasselbe waere eine zweite Wahrheit.
--
-- EIN HINWEIS FUER SPAETER, benannt statt uebersehen: `tools/import-catalog.mts`
-- will je Serie die Positionen `0..n-1` fuer die Kategorien aus
-- `data/catalog/products.json`. `Portale` liegt mit `n` darueber und ist dem
-- Importer deshalb gleichgueltig — er loescht keine Kategorie, die er nicht
-- kennt. Kommt der Mappe aber EINE weitere Kategorie hinzu, will der Importer
-- Position `n` und stoesst auf `categories_series_position_uniq`. Das ist ein
-- lauter Fehlschlag und kein stiller Schaden; die Kategorie wird dann
-- verschoben.
--
-- `catalog_group` BLEIBT NULL — wie bei den sechs `Spiele`-Kategorien. Die
-- Spalte gehoert dem Adminbereich (ADR-0039), und ein Portal gehoert in keine
-- Kataloggruppe, weil es im oeffentlichen Katalog nicht erscheint.
-- ---------------------------------------------------------------------------
insert into public.categories (series_code, position, name)
select p.serie,
       (select coalesce(max(c.position), -1) + 1
          from public.categories c where c.series_code = p.serie),
       'Portale'
  from (select distinct serie from z3_portal) p
 where not exists (select 1 from public.categories c
                    where c.series_code = p.serie and c.name = 'Portale');


-- ---------------------------------------------------------------------------
-- 3. Die 21 Zeilen
--
-- EINE SCHLEIFE UND KEIN `insert ... select`, und zwar aus einem Grund:
-- `next_figure_slug()` ist `stable` und fragt `skylanders`, was in EINER
-- Anweisung bedeutet, dass alle 21 Aufrufe denselben Schnappschuss sehen.
-- Zwei Zeilen mit demselben Grundslug bekaemen dann denselben Slug und die
-- Anweisung scheiterte an `skylanders_slug_uniq`. Zeilenweise sieht jeder
-- Aufruf die vorherigen Einfuegungen — dieselbe Reihenfolge, die
-- `admin_create_figure` je Aufruf ohnehin herstellt.
--
-- `item_type` STEHT AUSDRUECKLICH IN DER ZEILE. Der Trigger aus `0135` leitet
-- nur ab, wenn dort der Vorgabewert `figure` steht; hier steht `portal`, also
-- laesst er ihn stehen. Und die Ableitung aus der Kategorie ergaebe dasselbe
-- — zwei Wege, ein Ergebnis, und Abschnitt 4 prueft beide.
-- ---------------------------------------------------------------------------
do $$
declare
  v_p     record;
  v_kat   bigint;
  v_slug  text;
  v_n     integer := 0;
begin
  for v_p in select sky_id, name, serie from z3_portal order by sky_id loop
    select c.id into v_kat
      from public.categories c
     where c.series_code = v_p.serie and c.name = 'Portale';
    if v_kat is null then
      raise exception '0138 Befund: die Kategorie "Portale" fehlt in Serie %', v_p.serie;
    end if;

    v_slug := public.next_figure_slug(v_p.name, v_p.serie, v_p.sky_id);

    /*
     * KEIN PREIS, KEIN BILD, KEINE CHARAKTERZUORDNUNG, KEIN OVERRIDE.
     *
     * `market_price` bleibt NULL, und NULL heisst „unbekannt" und nie 0
     * (ADR-0010) — der CHECK auf der Spalte wuerde eine 0 ohnehin ablehnen.
     * `character_id` bleibt NULL: ein Portal ist kein Charakter (ADR-0034).
     * `card_type` ist `standard`, der Vorgabewert — `card_type` ist der
     * Figurenvariantentyp (ADR-0030) und wird fuer Zubehoer nicht
     * zweckentfremdet.
     */
    insert into public.skylanders
      (sky_id, name, slug, series_code, category_id,
       item_type, card_type, catalog_visible, source, is_active)
    values
      (v_p.sky_id, v_p.name, v_slug, v_p.serie, v_kat,
       'portal', 'standard', false, 'admin', true);

    /*
     * EIN EINTRAG FUER DIE ENTSTEHUNG, wie bei `admin_create_figure` und
     * `seller_create_catalog_item`. `changed_by` ist NULL: diese Zeile kam
     * ueber ein Skript, und genau das ist die dokumentierte Bedeutung von
     * NULL in dieser Spalte (`0004`). Ein erfundener Akteur waere schlimmer
     * als keiner.
     */
    insert into public.catalog_admin_changes
      (entity, entity_id, field, old_value, new_value, changed_by)
    values ('skylander', v_p.sky_id, 'created', null, v_p.name, null);

    v_n := v_n + 1;
  end loop;

  if v_n <> 21 then
    raise exception '0138 Befund: % Zeilen angelegt, erwartet 21', v_n;
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 4. Nachbedingungen
--
-- Hier wird NICHT gelesen, was jetzt da ist, sondern gegen die Abdruecke aus
-- Abschnitt 1 verglichen. Jede Abweichung bricht die Transaktion ab, und dann
-- bleibt nichts zurueck — keine Kategorie, keine Zeile, kein Journaleintrag.
-- ---------------------------------------------------------------------------
do $$
declare
  v_ist   text;
  v_soll  text;
  v_n     integer;
begin
  if to_regclass('pg_temp.z3_abdruck') is null then
    raise exception '0138 Abbruch: der Abdruck aus Abschnitt 1 ist fort — '
      'die Datei lief nicht als eine Transaktion';
  end if;

  -- ---- Die 21 Zeilen sind da, und sie sind, was sie sein sollen --------
  select count(*) into v_n from public.skylanders s join z3_portal p on p.sky_id = s.sky_id;
  if v_n <> 21 then
    raise exception '0138 Befund: % der 21 Portale stehen im Katalog', v_n;
  end if;

  /* Der Rohname, zeichengleich zur Arbeitsmappe. Eine stillschweigende
     Korrektur faellt hier auf (CLAUDE.md Regel 4). */
  select string_agg(s.sky_id, ', ' order by s.sky_id) into v_ist
    from public.skylanders s join z3_portal p on p.sky_id = s.sky_id
   where s.name <> p.name;
  if v_ist is not null then
    raise exception '0138 Befund: der Name wurde veraendert bei %', v_ist;
  end if;

  select string_agg(s.sky_id, ', ' order by s.sky_id) into v_ist
    from public.skylanders s join z3_portal p on p.sky_id = s.sky_id
   where s.item_type <> 'portal' or s.catalog_visible or not s.is_active
      or s.market_price is not null or s.display_name_override is not null
      or s.source <> 'admin' or s.series_code <> p.serie;
  if v_ist is not null then
    raise exception '0138 Befund: Zeile(n) % tragen nicht portal / unsichtbar / aktiv / '
      'preislos / ohne Override / source=admin / die Serie der Liste', v_ist;
  end if;

  /* ZWEI WEGE, EIN ERGEBNIS: der ausdrueckliche Wert in der Zeile und die
     Ableitung aus der Kategorie muessen uebereinstimmen. Weichen sie ab, ist
     eine der beiden Regeln falsch — und welche, sagt dann der Postflight. */
  select string_agg(s.sky_id, ', ' order by s.sky_id) into v_ist
    from public.skylanders s
    join public.categories c on c.id = s.category_id
    join z3_portal p on p.sky_id = s.sky_id
   where public.catalog_item_type_for_category(c.name) <> s.item_type;
  if v_ist is not null then
    raise exception '0138 Befund: bei % widersprechen Artikeltyp und Kategorieableitung '
      'einander', v_ist;
  end if;

  /* Genau eine Kategorie je Serie, und sie heisst `Portale`. */
  select count(*) into v_n from public.categories c where c.name = 'Portale';
  if v_n <> (select count(distinct serie) from z3_portal) then
    raise exception '0138 Befund: % Kategorien "Portale", erwartet %',
      v_n, (select count(distinct serie) from z3_portal);
  end if;

  -- ---- Und der Journaleintrag je Zeile ---------------------------------
  select count(*) into v_n
    from public.catalog_admin_changes j join z3_portal p on p.sky_id = j.entity_id
   where j.entity = 'skylander' and j.field = 'created';
  if v_n <> 21 then
    raise exception '0138 Befund: % Journaleintraege fuer 21 neue Zeilen', v_n;
  end if;

  -- ---- KEIN PORTAL IST SAMMELBAR, und zwar aus zwei Gruenden -----------
  /* Der erste Riegel: die Kategorie. */
  select count(*) into v_n
    from public.skylanders s
    join public.categories c on c.id = s.category_id
    join z3_portal p on p.sky_id = s.sky_id
   where not (c.name = any (public.non_collectible_categories()));
  if v_n > 0 then
    raise exception '0138 Befund: % Portal(e) stehen in einer sammelbaren Kategorie', v_n;
  end if;

  /* Der zweite, unabhaengig davon: die Shop-Eignung am Artikeltyp. */
  select count(*) into v_n
    from public.skylanders s join z3_portal p on p.sky_id = s.sky_id
   where public.is_shop_eligible(s.sky_id);
  if v_n > 0 then
    raise exception '0138 Befund: % Portal(e) sind shopfaehig', v_n;
  end if;

  -- ---- 21 Zeilen mehr, und nichts anderes hat sich geaendert -----------
  v_soll := (select wert from z3_abdruck where schluessel = 'zeilen');
  v_ist  := (select count(*)::text from public.skylanders);
  if v_ist::integer <> v_soll::integer + 21 then
    raise exception '0138 Befund: % Katalogzeilen, erwartet % + 21', v_ist, v_soll;
  end if;

  v_soll := (select wert from z3_abdruck where schluessel = 'angebote_md5');
  v_ist  := (select md5(coalesce(string_agg(o.sky_id || '|' || o.condition || '|'
                                            || coalesce(o.price::text, ''),
                                            ';' order by o.sky_id, o.condition), ''))
               from public.shop_offers() o);
  if v_ist <> v_soll then
    raise exception '0138 Befund: die Angebotsliste hat sich geaendert (md5 % statt %)',
      v_ist, v_soll;
  end if;

  v_soll := (select wert from z3_abdruck where schluessel = 'angebote');
  v_ist  := (select count(*)::text from public.shop_offers());
  if v_ist <> v_soll then
    raise exception '0138 Befund: % Angebote, vorher %', v_ist, v_soll;
  end if;

  v_soll := (select wert from z3_abdruck where schluessel = 'shopfaehig');
  v_ist  := (select count(*)::text from public.skylanders s
              where public.is_shop_eligible(s.sky_id));
  if v_ist <> v_soll then
    raise exception '0138 Befund: % shopfaehige Zeilen, vorher %', v_ist, v_soll;
  end if;

  /* DER NENNER DES FORTSCHRITTS — insgesamt und je Serie. Das ist die Zahl,
     die Nutzer kennen, und sie darf sich nicht bewegen (ADR-0128, Punkt 7). */
  v_soll := (select wert from z3_abdruck where schluessel = 'sammelbar');
  v_ist  := (select count(*)::text from public.skylanders s
               join public.categories c on c.id = s.category_id
              where s.is_active and s.catalog_visible
                and not (c.name = any (public.non_collectible_categories())));
  if v_ist <> v_soll then
    raise exception '0138 Befund: % sammelbare Zeilen, vorher %', v_ist, v_soll;
  end if;

  v_soll := (select wert from z3_abdruck where schluessel = 'sammelbar_je_serie');
  v_ist  := (select coalesce(string_agg(x.series_code || '=' || x.n::text, ',' order by x.series_code), '')
               from (select s.series_code, count(*) as n
                       from public.skylanders s
                       join public.categories c on c.id = s.category_id
                      where s.is_active and s.catalog_visible
                        and not (c.name = any (public.non_collectible_categories()))
                      group by s.series_code) x);
  if v_ist <> v_soll then
    raise exception '0138 Befund: sammelbar je Serie ist "%", vorher "%"', v_ist, v_soll;
  end if;

  /*
   * Die Artikeltypverteilung aendert sich um genau 21 `portal` und sonst
   * nichts. Geprueft wird deshalb nicht Gleichheit, sondern die DIFFERENZ —
   * und zwar je Typ.
   *
   * `where x.n > 0` ist dabei nicht Kosmetik: gab es vorher KEINE Portalzeile
   * — der Normalfall, und genau der Zustand, den Abschnitt 1 erzwingt —, dann
   * fehlte der Schluessel `portal` im Abdruck ganz. Nach dem Abzug stuende
   * hier `portal=0`, und der Vergleich schluege an, obwohl alles richtig ist.
   * Eine Gruppe mit Null Zeilen ist keine Gruppe. (Im Probelauf P25 genau so
   * aufgefallen.)
   */
  v_soll := (select wert from z3_abdruck where schluessel = 'typen');
  v_ist  := (select coalesce(string_agg(x.item_type || '=' || x.n::text, ',' order by x.item_type), '')
               from (select s.item_type,
                            count(*) - (case when s.item_type = 'portal' then 21 else 0 end) as n
                       from public.skylanders s group by s.item_type) x
              where x.n > 0);
  if v_ist <> v_soll then
    raise exception '0138 Befund: Artikeltypverteilung ist ohne die 21 Portale "%", vorher "%"',
      v_ist, v_soll;
  end if;

  /* Kein redaktioneller Anzeigename wurde beruehrt. */
  v_soll := (select wert from z3_abdruck where schluessel = 'override_md5');
  v_ist  := (select md5(coalesce(string_agg(s.sky_id || '|' || s.display_name_override,
                                            ';' order by s.sky_id), ''))
               from public.skylanders s where s.display_name_override is not null);
  if v_ist <> v_soll then
    raise exception '0138 Befund: ein display_name_override hat sich geaendert (md5 % statt %)',
      v_ist, v_soll;
  end if;

  /* UND DIE SEQUENZ STEHT NOCH, WO SIE STAND. 21 uebernommene Nummern
     brauchen keine Ausgabe, und eine verschobene Sequenz waere der Beweis,
     dass doch eine SKY-ID erzeugt wurde. */
  v_soll := (select wert from z3_abdruck where schluessel = 'sequenz');
  v_ist  := coalesce((select q.last_value::text from pg_sequences q
                       where q.schemaname = 'public' and q.sequencename = 'sky_id_seq'),
                     '(unbekannt)');
  if v_ist <> v_soll then
    raise exception '0138 Befund: sky_id_seq steht bei %, vorher % — diese Migration '
      'zieht keine SKY-ID', v_ist, v_soll;
  end if;

  raise notice '0138 fertig: 21 Portale angelegt, % Kategorien "Portale". Unveraendert: '
    '% Angebote (md5 %), % shopfaehig, % sammelbar, Sequenz %',
    (select count(*) from public.categories c where c.name = 'Portale'),
    (select wert from z3_abdruck where schluessel = 'angebote'),
    (select wert from z3_abdruck where schluessel = 'angebote_md5'),
    (select wert from z3_abdruck where schluessel = 'shopfaehig'),
    (select wert from z3_abdruck where schluessel = 'sammelbar'),
    (select wert from z3_abdruck where schluessel = 'sequenz');
end $$;

/*
 * Kein `drop table` am Ende. `on commit drop` raeumt beide temporaeren
 * Tabellen auf — bei `commit` wie bei `rollback` —, und ein ausdrueckliches
 * Drop wuerde nur den Fall verdecken, in dem die Datei ohne
 * Transaktionsklammer laeuft.
 */
-- <<< ENDE: supabase/migrations/0138_catalog_portals.sql

commit;
