-- ===========================================================================
-- STAGING IN EINEM DURCHGANG: 0135 und 0136
--
-- ###########################################################################
-- ##  NUR STAGING — qqxcpesbwfxzgytkdsac.                                  ##
-- ##  Abschnitt A bricht ab, wenn der Umgebungsstempel fehlt.              ##
-- ###########################################################################
--
-- WOZU DIESE DATEI. Der Laufzettel `supabase/checks/0135_0136_staging_run.md`
-- fuehrt durch elf Schritte und sieben Dateien. Das ist gruendlich und
-- unbequem. Diese Datei ist derselbe Ablauf als EIN Einfuegen, EINE
-- Transaktion und EIN Ergebnisraster — und jede Pruefung darin ist
-- BLOCKIEREND: sie wirft eine Ausnahme, statt eine Zeile zu melden, die
-- niemand liest.
--
-- EINE TRANSAKTION, EIN AUSGANG
--
--   * Jeder Fehler rollt ALLES zurueck: Spalte, CHECK, Backfill, Trigger,
--     beide Funktionen, beide Kommentare. Es gibt keinen Halbzustand.
--   * `begin` und `commit` stehen in dieser Datei. Nicht zusaetzlich klammern.
--   * Nach einem Fehler antwortet PostgreSQL auf jede weitere Anweisung mit
--     `25P02`. Die einzige richtige Reaktion ist `rollback;` — danach ist
--     nichts geschehen.
--   * Wer vor dem `commit` abbrechen will: `rollback;` statt weiterlaufen
--     lassen. Das `commit` steht als LETZTE Zeile; bis dahin ist nichts
--     endgueltig.
--
-- WAS EINGEBETTET IST, UND WIE GENAU
--
-- Abschnitt B und C enthalten `0135_catalog_item_type.sql` und
-- `0136_business_backup_item_type.sql` **Zeichen fuer Zeichen**. Das ist
-- nicht behauptet, sondern geprueft: `src/lib/catalog/staging-oneshot.test.ts`
-- vergleicht die eingebetteten Bloecke bei jedem Testlauf mit den
-- Migrationsdateien. Weichen sie ab, faellt der Test.
--
-- Beide Migrationen bringen ihre eigenen Vor- und Nachbedingungen mit und
-- brechen selbst ab — diese Datei legt nur den Rahmen darum.
--
-- WAS SIE NICHT ERSETZT. Die Pruefdateien `0135_preflight.sql`,
-- `0135_postflight.sql`, `0136_preflight.sql`, `0136_postflight.sql` zeigen
-- je 40 bis 60 Einzelzeilen zur Diagnose. Diese Datei prueft dieselben Werte,
-- aber als Abbruchbedingung statt als Raster. Wer nach einem Abbruch wissen
-- will, WO es klemmt, faehrt danach die Pruefdatei.
--
-- WAS SIE NICHT ANFASST. `0133` und `0134` (Abschnitt A und D pruefen, dass
-- sie weiter fehlen), die Belegausstellung (Abschnitt A und D pruefen die
-- Sperre), Production, kein Eigenbeleg, keine historische Einkaufsposition,
-- kein `display_name_override`, keine SKY-ID.
--
-- DIE Z0-WERTE STEHEN HIER FEST. 534 shopfaehige Zeilen, 256 Angebote,
-- Abdruck `4d1d6c30fe0ae886ca2689bcb1fe9634`, 534 sammelbare Artikel und 39
-- Spiele-Zeilen mit `display_name_override` — gemessen am 2026-10-19 (Z0,
-- `supabase/checks/open_verifications.md`, Abschnitt 0f). Weicht einer ab,
-- bricht Abschnitt A ab: dann hat sich der Katalog seit Z0 bewegt, und Z0
-- ist neu zu erheben, statt die Migration zu fahren. Diese Datei ist
-- deshalb **nicht** fuer Production geeignet — dort gelten andere Zahlen.
--
-- BERICHTIGT AM 2026-10-19. Der Vertrag verlangte „39 Overrides KATALOGWEIT"
-- und brach ab: es sind 53. Z0 hatte aber die Overrides der 39 SPIELE
-- gezaehlt, nicht die des ganzen Katalogs — eine katalogweite Zahl steht in
-- Z0 nirgends. Der Vertrag prueft jetzt die belegte Aussage („jede der 39
-- Spiele-Zeilen traegt einen Anzeigenamen"); die katalogweite Zahl bleibt als
-- Wert, der sich WAEHREND des Laufs nicht bewegen darf (Abschnitt D2), samt
-- `md5` ueber alle Overrides. Ursachenanalyse:
-- `supabase/checks/z0_overrides_diagnosis.sql`.
--
-- ERGEBNIS. Die letzte Anweisung vor dem `commit` liefert ein Raster mit
-- jedem Bezugswert vorher und nachher. Es gehoert ins Protokoll
-- (`supabase/checks/open_verifications.md`).
-- ===========================================================================

begin;

/* Ein langer Lauf, aber keine Ewigkeit — und die Katalogsperre wartet nicht
   endlos auf eine fremde Abfrage. */
set local statement_timeout = '180s';
set local lock_timeout = '5s';

/* Der Vertragsmodus fuer die Pruefdateien, falls sie in derselben Klammer
   nachgefahren werden. Transaktionslokal, verschwindet mit dem `commit`. */
select set_config('skyisles.z0', 'staging', true) as z0_modus;

create temporary table lauf_abdruck (
  schluessel text primary key,
  wert       text not null
) on commit drop;


-- ---------------------------------------------------------------------------
-- A. Vorher: Umgebung, Waechter, Z0-Vertrag, Bezugswerte
-- ---------------------------------------------------------------------------
do $$
declare
  v_wert text;
  v_zahl integer;
begin
  -- A1. Bin ich auf Staging?
  if (select count(*) from public.skylanders
       where sky_id in ('SKY-0821', 'SKY-0822')) <> 2 then
    raise exception 'ABBRUCH A1: Umgebungsstempel nicht gefunden. Diese Datei '
      'laeuft nur auf Staging qqxcpesbwfxzgytkdsac.';
  end if;

  -- A2. Laeuft sie wirklich in einer Transaktion?
  if to_regclass('pg_temp.lauf_abdruck') is null then
    raise exception 'ABBRUCH A2: die Datei laeuft nicht in einer Transaktion — '
      'vollstaendig einfuegen, nicht in Teilen ausfuehren.';
  end if;

  -- A3. 0133 und 0134 sind NICHT angewendet.
  if to_regprocedure('public.purchases_paid_total_is_final()') is not null then
    raise exception 'ABBRUCH A3: 0133 ist hier angewendet — dieser Lauf ist fuer '
      'den Stand 0132 geschrieben.';
  end if;
  if exists (select 1 from pg_trigger t
              where not t.tgisinternal
                and t.tgrelid = 'public.purchases'::regclass
                and t.tgname = 'purchases_paid_total_immutable_trg') then
    raise exception 'ABBRUCH A3: der Trigger aus 0133 steht.';
  end if;
  if position('''source_row'', i.source_row' in
       coalesce((select p.prosrc from pg_proc p
                  where p.oid = to_regprocedure('public.seller_purchase(bigint)')), '')) > 0 then
    raise exception 'ABBRUCH A3: 0134 ist hier angewendet.';
  end if;

  -- A4. 0132 IST angewendet.
  if position('total_cost' in
       coalesce((select p.prosrc from pg_proc p
                  where p.oid = to_regprocedure(
                    'public.seller_update_purchase(bigint, date, numeric, text, text, text,'
                    || ' numeric, numeric, numeric, text, text, boolean, text, text, text,'
                    || ' text, text, text, text, text, text)')), '')) = 0 then
    raise exception 'ABBRUCH A4: der Riegel aus 0132 fehlt — erst 0132 anwenden.';
  end if;

  -- A5. Die Belegsperre ist dicht.
  if exists (select 1 from (values
               ('public.seller_issue_purchase_receipt(bigint)'),
               ('public.seller_issue_purchase_receipt_correction(bigint)')) f(sig)
              cross join (values ('anon'), ('authenticated'), ('service_role')) r(n)
             where to_regprocedure(f.sig) is not null
               and has_function_privilege(r.n, f.sig, 'execute')) then
    raise exception 'ABBRUCH A5: die Belegsperre ist nicht dicht.';
  end if;
  if exists (select 1 from (values
               ('public.seller_issue_purchase_receipt(bigint)'),
               ('public.seller_issue_purchase_receipt_correction(bigint)')) f(sig)
             where to_regprocedure(f.sig) is not null
               and ((select p.proacl is null from pg_proc p where p.oid = to_regprocedure(f.sig))
                 or exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                             where p.oid = to_regprocedure(f.sig)
                               and a.privilege_type = 'EXECUTE' and a.grantee = 0))) then
    raise exception 'ABBRUCH A5: PUBLIC darf einen Eigenbeleg ausstellen.';
  end if;

  -- A6. Die Bezugswerte erfassen.
  insert into lauf_abdruck (schluessel, wert) values
    ('shopfaehig',   (select count(*)::text from public.skylanders s
                       where public.is_shop_eligible(s.sky_id))),
    ('angebote',     (select count(*)::text from public.shop_offers())),
    ('angebote_md5', (select md5(coalesce(string_agg(o.sky_id || '|' || o.condition || '|'
                                        || coalesce(o.price::text, ''),
                                        ';' order by o.sky_id, o.condition), ''))
                        from public.shop_offers() o)),
    ('sammelbar',    (select count(*)::text from public.skylanders s
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
    ('override_md5', (select md5(coalesce(string_agg(s.sky_id || '=' || s.display_name_override,
                                        ';' order by s.sky_id), ''))
                        from public.skylanders s where s.display_name_override is not null)),
    ('overrides',    (select count(*)::text from public.skylanders
                       where display_name_override is not null)),
    /*
     * DIE ZAHL, DIE Z0 WIRKLICH FESTGEHALTEN HAT.
     *
     * Z0 zaehlte die Overrides INNERHALB der Kategorie `Spiele` — „39, alle
     * mit display_name_override". Der erste Entwurf dieses Vertrags las das
     * als katalogweite Gesamtzahl und brach deshalb am 2026-10-19 mit
     * „overrides ist 53, erwartet 39" ab: katalogweit tragen auch Figuren
     * einen redaktionellen Anzeigenamen, und das war nie anders. Der Vertrag
     * prueft jetzt die Aussage, die Z0 belegt hat.
     */
    ('spiele_overrides', (select count(*)::text from public.skylanders s
                            join public.categories c on c.id = s.category_id
                           where c.name = 'Spiele'
                             and s.display_name_override is not null)),
    /* Nur zur Information im Ergebnisraster: hat heute jemand einen
       Anzeigenamen geaendert? Kein Sollwert — eine redaktionelle Aenderung
       ist erlaubt, sie soll nur sichtbar sein. */
    ('aenderungen_heute', (select count(*)::text from public.catalog_admin_changes
                            where entity = 'skylander'
                              and field = 'display_name_override'
                              and changed_at >= current_date)),
    ('katalogzeilen', (select count(*)::text from public.skylanders)),
    ('spiele_zeilen', (select count(*)::text from public.skylanders s
                        join public.categories c on c.id = s.category_id
                       where c.name = 'Spiele')),
    ('einkaeufe',    (select count(*)::text from public.purchases where source <> 'manual')),
    ('positionen',   (select count(*)::text from public.purchase_items)),
    ('lagerzeilen',  (select count(*)::text from public.shop_inventory)),
    ('einheiten',    (select coalesce(sum(quantity), 0)::text from public.shop_inventory)),
    ('bewegungen',   (select count(*)::text from public.inventory_movements)),
    ('importsumme',  (select coalesce(sum(total_cost), 0)::text from public.purchases
                       where source <> 'manual')),
    ('belege',       (select count(*)::text from public.purchase_receipts)),
    ('zaehler',      (select count(*)::text from public.purchase_receipt_counters)),
    ('abrufe',       (select count(*)::text from public.purchase_receipt_downloads)),
    ('sicherung_md5', coalesce((select md5(p.prosrc) from pg_proc p
                                 where p.oid = to_regprocedure(
                                   'public.seller_business_backup()')), '(fehlt)'));

  -- A7. Der Z0-Vertrag.
  foreach v_wert in array array['shopfaehig=534', 'angebote=256',
                                'angebote_md5=4d1d6c30fe0ae886ca2689bcb1fe9634',
                                'sammelbar=534', 'spiele_overrides=39'] loop
    if (select a.wert from lauf_abdruck a
         where a.schluessel = split_part(v_wert, '=', 1)) <> split_part(v_wert, '=', 2) then
      raise exception 'ABBRUCH A7: der Z0-Vertrag stimmt nicht mehr — % ist %, erwartet %. '
        'Der Katalog hat sich seit Z0 bewegt: Z0 neu erheben, nicht migrieren.',
        split_part(v_wert, '=', 1),
        (select a.wert from lauf_abdruck a where a.schluessel = split_part(v_wert, '=', 1)),
        split_part(v_wert, '=', 2);
    end if;
  end loop;

  -- A8. Der Ausgangsstand der Sicherung.
  if (select a.wert from lauf_abdruck a where a.schluessel = 'sicherung_md5')
     <> '24c3810288bb20929fe995554a267adf' then
    raise exception 'ABBRUCH A8: die Betriebssicherung ist nicht der Stand 0131 (md5 %)',
      (select a.wert from lauf_abdruck a where a.schluessel = 'sicherung_md5');
  end if;

  -- A9. Und item_type gibt es noch nicht.
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'skylanders'
                and column_name = 'item_type') then
    raise exception 'ABBRUCH A9: skylanders.item_type steht schon — 0135 ist hier '
      'angewendet. Dann nur 0136 fahren (Abschnitt C) oder den Laufzettel nehmen.';
  end if;

  select count(*) into v_zahl from lauf_abdruck;
  raise notice 'A ok: Staging, Stand 0132, Belegsperre dicht, Z0-Vertrag erfuellt, '
    '% Bezugswerte erfasst.', v_zahl;
end $$;


-- ---------------------------------------------------------------------------
-- B. Migration 0135 — eingebettet, Zeichen fuer Zeichen
-- ---------------------------------------------------------------------------
-- >>> EINGEBETTET: supabase/migrations/0135_catalog_item_type.sql
-- ===========================================================================
-- 0135 — DER KATALOG SAGT, WAS EIN ARTIKEL IST
--
-- ###########################################################################
-- ##  NICHT ANGEWENDET — WEDER AUF STAGING NOCH AUF PRODUCTION.            ##
-- ##  Entwurf nach ADR-0128, Schritt Z1. Braucht eine eigene Freigabe.     ##
-- ###########################################################################
--
-- WAS SIE TUT, UND NUR DAS
--
--   1. `skylanders.item_type` — eine Spalte mit Vorgabewert `figure` und
--      gesicherter Wertemenge.
--   2. Backfill: die Zeilen der Kategorie `Spiele` werden `game`. AUS DER
--      KATEGORIE, aus keinem Namen. 39 Zeilen auf Staging.
--   3. Eine Ableitungsregel samt Trigger, damit eine NEUE Zeile den
--      richtigen Artikeltyp bekommt — Positivliste, keine Heuristik.
--   4. `is_shop_eligible()` verlangt zusaetzlich `item_type = 'figure'`.
--
-- WARUM DIE DRITTE AENDERUNG DER EIGENTLICHE GRUND IST
--
-- `is_shop_eligible()` schliesst heute allein die KATEGORIE `'Spiele'` aus.
-- Kommen Portale als neue Kategorie dazu (Z3), waeren sie damit
-- AUTOMATISCH shopfaehig — `shop_offers()` wuerde sie anbieten, ohne dass
-- jemand eine Entscheidung getroffen haette. Die Eignung gehoert deshalb an
-- den ARTIKELTYP, nicht an einen Kategorienamen.
--
-- DIE ERGEBNISMENGE AENDERT SICH DABEI NICHT, UND DAS BEWEIST DIESE MIGRATION
-- SELBST. Figuren sind `figure`, Spiele sind ueber die Kategorie ohnehin
-- ausgeschlossen. Abschnitt 1 nimmt deshalb VOR der Aenderung drei Abdruecke
-- — die Zahl der shopfaehigen Zeilen, die Zahl der Angebote und ein `md5`
-- ueber die vollstaendige Angebotsliste (sky_id, condition, price) — und
-- Abschnitt 5 vergleicht sie danach. Weicht einer ab, bricht die Migration ab
-- und die Transaktion rollt alles zurueck, die Spalte eingeschlossen.
--
-- WAS SIE NICHT TUT
--
--   * Sie legt KEINEN Katalogartikel an und loescht keinen. Kein Portal, kein
--     Spiel, keine SKY-ID — Z3 ist ein eigener Schritt mit eigener Freigabe.
--   * Sie fasst KEINEN `display_name_override` an. Abschnitt 1 nimmt auch
--     darueber einen Abdruck, Abschnitt 5 prueft ihn.
--   * Sie aendert `non_collectible_categories()` NICHT. Die Kategorieregel
--     bleibt, wo sie ist; `item_type` tritt daneben. Damit bleibt die Paritaet
--     zwischen SQL und `src/lib/catalog/collectible.ts` unberuehrt, die
--     `verify:shop` prueft.
--   * Sie aendert KEINE Anwendungsschicht. Die TypeScript-Seite rechnet
--     Sammelbarkeit weiter ueber die Kategorie — unveraendertes Verhalten,
--     weil es noch kein Portal gibt. Der Umstieg gehoert zu Z3.
--   * Keine Lagerzeile, keine Bewegung, kein Beleg, kein Einkauf.
--
-- REIHENFOLGE UND ABHAENGIGKEITEN
--
-- Diese Migration haengt an `0001` (Tabelle) und `0008` (`is_shop_eligible`,
-- `non_collectible_categories`). An `0133` und `0134` haengt sie NICHT:
--
--   `0133`  Trigger und Funktion an `purchases` — kein gemeinsames Objekt.
--   `0134`  Funktion `seller_purchase(bigint)` — liest `skylanders`, nennt
--           seine Spalten aber einzeln; eine zusaetzliche Spalte ist fuer sie
--           unsichtbar. Keine Reihenfolgebedingung in beide Richtungen.
--
-- Auf Staging fehlen `0133` und `0134` am 2026-10-19. `0135` darf trotzdem
-- vorher laufen; die Luecke ist in `supabase/migrations/APPLIED.md` benannt
-- („Die Nummer ist eine Reihenfolge, keine Kette") samt der Tabelle, welche
-- Migration welche Objekte aendert.
--
-- NACHFOLGER: `0136_business_backup_item_type.sql` nimmt `item_type` in die
-- Betriebssicherung auf. Sie SETZT DIESE MIGRATION VORAUS und laeuft als
-- eigene Transaktion danach — nicht in derselben, damit der Beweis dieser
-- Datei („nichts hat sich geaendert") lesbar bleibt und beide Ruecknahmen
-- unabhaengig bleiben.
--
-- EINE TRANSAKTION, UND SIE PRUEFT SICH SELBST
--
-- Abschnitt 1 legt eine temporaere Tabelle mit `on commit drop` an und bricht
-- ab, wenn sie unmittelbar danach schon wieder fort ist — genau das passiert,
-- wenn die Datei ohne Klammer laeuft (jede Anweisung waere ihre eigene
-- Transaktion). Es gibt deshalb keinen Weg, diese Migration halb anzuwenden:
-- entweder sie laeuft als EINE Transaktion, oder sie laeuft nicht. Nach einem
-- Abbruch bleibt nichts zurueck — keine Spalte, kein CHECK, kein Kommentar,
-- kein Backfill, keine Hilfstabelle.
--
-- AUSFUEHRUNG: im SQL-Editor, vollstaendig in `begin` / `commit` geklammert.
-- Vorher `0135_preflight.sql`, danach `0135_postflight.sql`.
-- Ruecknahme: `supabase/rollback/R0135_drop_item_type.sql` — und zwar erst
-- NACH `R0136_back_to_0131.sql`, falls `0136` schon lief: die Sicherung liest
-- dann `item_type`, und PostgreSQL vermerkt dafuer keine Abhaengigkeit.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen und die Abdruecke, gegen die am Ende geprueft wird
--
-- Die Abdruecke liegen in einer TEMPORAEREN Tabelle: sie lebt nur in dieser
-- Sitzung, verschwindet mit ihr und kann keine Geschaeftszeile beruehren.
-- ---------------------------------------------------------------------------
create temporary table z1_abdruck (
  schluessel text primary key,
  wert       text not null
) on commit drop;

do $$
declare
  v_spiele integer;
begin
  /*
   * DER KLAMMERGRIFF — die Transaktion prueft sich selbst.
   *
   * Die Tabelle oben traegt `on commit drop`: sie verschwindet am Ende dieser
   * Transaktion, ob mit `commit` oder mit `rollback`. Laeuft die Datei NICHT
   * in einer Klammer, ist jede Anweisung ihre eigene Transaktion — dann ist
   * die Tabelle unmittelbar nach ihrer Erzeugung wieder weg, und dieser Block
   * bricht ab, BEVOR die Spalte entsteht. Es gibt damit keinen Weg, diese
   * Migration halb anzuwenden: entweder sie laeuft als eine Transaktion, oder
   * sie laeuft ueberhaupt nicht.
   *
   * `create temporary table` ohne `if not exists`: eine Tabelle dieses Namens
   * aus einem frueheren Versuch waere ein Befund, kein Grund zum Weitermachen
   * mit ALTEN Abdruecken.
   */
  if to_regclass('pg_temp.z1_abdruck') is null then
    raise exception '0135 Abbruch: die Datei laeuft nicht in einer Transaktion — '
      'in begin / commit klammern und vollstaendig ausfuehren';
  end if;

  /*
   * EIN ZEITLIMIT AUF DIE SPERRE, transaktionslokal.
   *
   * `alter table ... add column` nimmt ACCESS EXCLUSIVE auf `skylanders` —
   * die weltlesbare Katalogtabelle. Steht gerade eine lange lesende Abfrage,
   * stellte sich die Migration hinter sie, und JEDER weitere Katalogzugriff
   * stellte sich hinter die Migration: der Shop stuende, solange die Kette
   * laeuft. Mit fuenf Sekunden Grenze bricht stattdessen die Migration ab,
   * rollt zurueck und laesst sich wiederholen. Ein Vorgabewert ohne
   * Volatilitaet schreibt die Tabelle seit PostgreSQL 11 nicht um, der
   * Sperrzeitraum ist also kurz — aber nicht null.
   */
  perform set_config('lock_timeout', '5s', true);

  if to_regclass('public.skylanders') is null then
    raise exception '0135 setzt 0001 voraus: skylanders fehlt';
  end if;
  if to_regprocedure('public.is_shop_eligible(text)') is null then
    raise exception '0135 setzt 0008 voraus: is_shop_eligible fehlt';
  end if;
  if to_regprocedure('public.non_collectible_categories()') is null then
    raise exception '0135 setzt 0008 voraus: non_collectible_categories fehlt';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'skylanders'
                and column_name = 'item_type') then
    raise exception '0135 Abbruch: die Spalte item_type steht schon';
  end if;

  /* Die Kategorie, auf der der Backfill ruht, muss es geben — und zwar
     genau unter diesem Namen, denselben, den `non_collectible_categories()`
     nennt. Ohne sie waere der Backfill lautlos leer. */
  select count(*) into v_spiele from public.categories where name = 'Spiele';
  if v_spiele = 0 then
    raise exception '0135 Abbruch: keine Kategorie "Spiele" — der Backfill haette nichts zu tun';
  end if;

  insert into z1_abdruck (schluessel, wert) values
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
    ('override_md5',
       (select md5(coalesce(string_agg(s.sky_id || '=' || s.display_name_override,
                                       ';' order by s.sky_id), ''))
          from public.skylanders s where s.display_name_override is not null)),
    ('zeilen',     (select count(*)::text from public.skylanders)),
    ('spiele_zeilen',
       (select count(*)::text from public.skylanders s
          join public.categories c on c.id = s.category_id
         where c.name = 'Spiele'));

  raise notice '0135 Abdruck: % shopfaehig, % Angebote, md5 %, % sammelbar',
    (select wert from z1_abdruck where schluessel = 'shopfaehig'),
    (select wert from z1_abdruck where schluessel = 'angebote'),
    (select wert from z1_abdruck where schluessel = 'angebote_md5'),
    (select wert from z1_abdruck where schluessel = 'sammelbar');
end $$;


-- ---------------------------------------------------------------------------
-- 2. Die Spalte
--
-- `not null default 'figure'` — jede der vorhandenen Zeilen ist eine Figur,
-- bis der Backfill etwas anderes sagt. Ein Vorgabewert statt NULL, weil
-- „unbekannter Artikeltyp" kein Zustand ist, den eine Abfrage behandeln
-- muesste; jede Zeile hat einen.
-- ---------------------------------------------------------------------------
alter table public.skylanders
  add column item_type text not null default 'figure';

/*
 * Die Wertemenge. `bundle` und `other` stehen schon drin, obwohl noch kein
 * solcher Artikel existiert: die Starter Packs und die beiden Taschen aus dem
 * Blatt `ZB` sind ein spaeterer, eigener Schritt (ADR-0128, Punkt 9), und ein
 * CHECK nachtraeglich zu erweitern hiesse, ihn zu ersetzen — eine Aenderung
 * mehr an einer Tabelle, die 605 Zeilen traegt.
 */
alter table public.skylanders
  add constraint skylanders_item_type_known
    check (item_type in ('figure', 'game', 'portal', 'bundle', 'other'));

comment on column public.skylanders.item_type is
  'Was dieser Katalogartikel IST (0135, ADR-0128): figure | game | portal | bundle | other. Vorgabewert figure. Entscheidet die Shop-Eignung (is_shop_eligible) und spaeter die Sammelbarkeit — statt eines Kategorienamens, denn eine neue Kategorie waere sonst automatisch shopfaehig. Die Kategorie bleibt daneben bestehen und wird nicht ersetzt.';


-- ---------------------------------------------------------------------------
-- 3. Der Backfill — aus der Kategorie, aus keinem Namen
--
-- `0117` hat gezeigt, wohin Namensheuristik fuehrt: „Wii U Spiel" ist der
-- Name von drei verschiedenen Spielen. Die Kategorie `Spiele` ist dagegen
-- eine redaktionelle Zuordnung, sie ist je Serie eindeutig, und
-- `non_collectible_categories()` nennt genau sie.
-- ---------------------------------------------------------------------------
update public.skylanders s
   set item_type = 'game'
 where exists (select 1 from public.categories c
                where c.id = s.category_id and c.name = 'Spiele');


-- ---------------------------------------------------------------------------
-- 3a. DAMIT EINE NEUE ZEILE NICHT WIEDER FALSCH ANFAENGT
--
-- Der Backfill oben trifft die 605 Zeilen von heute. Eine Zeile, die MORGEN
-- entsteht, trifft er nicht — und der Katalogimport nennt `item_type` nicht:
-- er schreibt genau neun Spalten, und das ist richtig so (`card_type` und
-- `source` stehen aus demselben Grund nicht im Payload, siehe
-- `src/lib/catalog/import-payload.test.ts`). Ein neu importiertes Spiel
-- bekaeme damit `figure` aus dem Vorgabewert.
--
-- WARUM NICHT IM IMPORTER. Wer `item_type` in den Payload nimmt, schreibt ihn
-- bei JEDEM Lauf — und ueberschreibt damit irgendwann eine Entscheidung, die
-- jemand von Hand getroffen hat. Genau diese Falle ist bei `card_type`
-- schriftlich festgehalten: „a heuristic that runs on every import is a
-- heuristic that eventually overwrites a decision somebody made."
--
-- WARUM EIN TRIGGER. Er greift auf JEDEM Schreibweg — Import, Adminbereich,
-- SQL-Editor, kuenftiges Werkzeug — und nicht nur auf dem, an den jemand
-- gedacht hat.
--
-- DIE REGEL IST EINE POSITIVLISTE, KEINE HEURISTIK.
-- `catalog_item_type_for_category()` ist die EINE Stelle, an der eine
-- Kategorie einen Artikeltyp bekommt:
--
--     'Spiele'  ->  'game'
--     alles andere  ->  'figure'
--
-- Ein UNBEKANNTER Kategoriename wird also NIE zum Spiel. Z3 erweitert diese
-- Funktion um 'Portale' -> 'portal' — zusammen mit den Zeilen, die dann
-- entstehen, und mit einer eigenen Freigabe. Bis dahin gibt es kein Portal,
-- also auch keine Ableitung dafuer.
--
-- UND ER UEBERSCHREIBT KEINE ENTSCHEIDUNG. Der Trigger setzt nur, wenn die
-- Zeile den VORGABEWERT traegt. Wer ausdruecklich 'portal', 'bundle' oder
-- 'other' schreibt, behaelt es.
-- ---------------------------------------------------------------------------
create or replace function public.catalog_item_type_for_category(p_category_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  -- Positivliste. Kein `else 'game'`, nirgends: ein unbekannter Name ist eine
  -- Figur, kein Spiel.
  select case p_category_name
           when 'Spiele' then 'game'
           else 'figure'
         end;
$$;

comment on function public.catalog_item_type_for_category(text) is
  'The one place a category name maps to an item type (0135, ADR-0128): Spiele -> game, everything else -> figure. A POSITIVE list: an unknown category is a figure, never a game. Z3 extends it with Portale -> portal, together with the rows that need it. Pure, immutable, reads nothing.';

revoke all on function public.catalog_item_type_for_category(text) from public, anon, authenticated, service_role;

create or replace function public.skylanders_set_item_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_abgeleitet text;
begin
  select public.catalog_item_type_for_category(c.name) into v_abgeleitet
    from public.categories c where c.id = new.category_id;

  /*
   * NUR DEN VORGABEWERT ERSETZEN.
   *
   * `item_type = 'figure'` heisst „niemand hat etwas anderes gesagt" — der
   * Vorgabewert der Spalte. Steht dort 'portal', 'bundle' oder 'other', hat
   * jemand ausdruecklich entschieden, und das bleibt stehen.
   *
   * `security definer`: der Trigger liest `categories`, und die Tabelle
   * fuehrt RLS. Ein Schreibweg, der die Kategorie nicht lesen darf, soll
   * trotzdem den richtigen Artikeltyp bekommen.
   */
  if new.item_type = 'figure'
     and v_abgeleitet is not null
     and v_abgeleitet <> 'figure' then
    new.item_type := v_abgeleitet;
  end if;

  return new;
end;
$$;

comment on function public.skylanders_set_item_type() is
  'Derives skylanders.item_type from the row category on insert, and when the category changes (0135). Only replaces the column default: an explicit portal/bundle/other survives. The mapping lives in catalog_item_type_for_category() and is a positive list - an unknown category stays figure.';

/*
 * `insert or update of category_id`, nicht `update` ohne Spalte: der Backfill
 * oben schreibt `item_type` selbst, und ein Trigger, der dabei feuert, waere
 * ein Kreis. Die Kategorieaenderung ist dagegen genau der Fall, in dem eine
 * Berichtigung den Artikeltyp mitnehmen soll — eine Figur, die nach `Spiele`
 * umgehaengt wird, IST ein Spiel.
 */
create trigger skylanders_item_type_from_category
  before insert or update of category_id on public.skylanders
  for each row execute function public.skylanders_set_item_type();


-- ---------------------------------------------------------------------------
-- 4. Die Shop-Eignung haengt am Artikeltyp
--
-- Der Rumpf ist der aus `0008`, Zeichen fuer Zeichen, mit genau einer Zeile
-- mehr. Die Kategoriebedingung bleibt ausdruecklich stehen: zwei Riegel sind
-- hier kein Widerspruch, sondern Gurt und Hosentraeger — und sie halten die
-- Parität zu `src/lib/catalog/collectible.ts`, die `verify:shop` prueft.
-- ---------------------------------------------------------------------------
create or replace function public.is_shop_eligible(p_sky_id text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
      from public.skylanders s
      join public.categories c on c.id = s.category_id
     where s.sky_id = p_sky_id
       and s.is_active
       and s.catalog_visible
       and s.item_type = 'figure'
       and not (c.name = any (public.non_collectible_categories()))
  );
$$;

comment on function public.is_shop_eligible(text) is
  'Whether a figure may be offered in the shop at all: active, editorially visible, item_type = figure, and a collectible rather than software (ADR-0048, ADR-0128). The item_type clause came with 0135 and is what keeps a NEW category — portals, bundles — out of the storefront by construction instead of by somebody remembering to extend non_collectible_categories(). Says nothing about stock or price.';

revoke all on function public.is_shop_eligible(text) from public;
grant execute on function public.is_shop_eligible(text) to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 5. Nachbedingungen — und der Beweis, dass kein Angebot sich geaendert hat
-- ---------------------------------------------------------------------------
do $$
declare
  v_soll text;
  v_ist  text;
  v_n    integer;
begin
  -- 5a. Die Spalte, der CHECK, die Wertemenge
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'skylanders'
                    and column_name = 'item_type' and is_nullable = 'NO'
                    and column_default like '%figure%') then
    raise exception '0135 Abbruch: item_type fehlt, ist nullable oder hat nicht den Vorgabewert figure';
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'skylanders_item_type_known') then
    raise exception '0135 Abbruch: der CHECK auf item_type fehlt';
  end if;

  -- 5b. Der Backfill trifft genau die Spiele-Zeilen
  select count(*) into v_n from public.skylanders where item_type = 'game';
  v_soll := (select wert from z1_abdruck where schluessel = 'spiele_zeilen');
  if v_n::text <> v_soll then
    raise exception '0135 Abbruch: % Zeilen sind game, erwartet % (Kategorie Spiele)', v_n, v_soll;
  end if;
  if exists (select 1 from public.skylanders s
              where s.item_type = 'game'
                and not exists (select 1 from public.categories c
                                 where c.id = s.category_id and c.name = 'Spiele')) then
    raise exception '0135 Abbruch: eine game-Zeile liegt nicht in der Kategorie Spiele';
  end if;
  if exists (select 1 from public.skylanders s
              join public.categories c on c.id = s.category_id
             where c.name = 'Spiele' and s.item_type <> 'game') then
    raise exception '0135 Abbruch: eine Zeile der Kategorie Spiele ist nicht game';
  end if;
  if exists (select 1 from public.skylanders
              where item_type not in ('figure', 'game')) then
    raise exception '0135 Abbruch: es gibt bereits einen anderen Artikeltyp als figure/game';
  end if;

  -- 5c. Zeilenzahl unveraendert — es wurde nichts angelegt und nichts geloescht
  v_soll := (select wert from z1_abdruck where schluessel = 'zeilen');
  select count(*) into v_n from public.skylanders;
  if v_n::text <> v_soll then
    raise exception '0135 Abbruch: % Katalogzeilen, vorher % — es wurde angelegt oder geloescht',
      v_n, v_soll;
  end if;

  -- 5d. DIE ANGEBOTE. Identitaet, Zustand und Preis, als ein Abdruck.
  v_soll := (select wert from z1_abdruck where schluessel = 'angebote_md5');
  select md5(coalesce(string_agg(o.sky_id || '|' || o.condition || '|'
                                  || coalesce(o.price::text, ''),
                                  ';' order by o.sky_id, o.condition), ''))
    into v_ist from public.shop_offers() o;
  if v_ist is distinct from v_soll then
    raise exception '0135 Abbruch: die Angebotsliste hat sich geaendert (md5 % statt %)',
      v_ist, v_soll;
  end if;

  v_soll := (select wert from z1_abdruck where schluessel = 'angebote');
  select count(*) into v_n from public.shop_offers();
  if v_n::text <> v_soll then
    raise exception '0135 Abbruch: % Angebote, vorher %', v_n, v_soll;
  end if;

  v_soll := (select wert from z1_abdruck where schluessel = 'shopfaehig');
  select count(*) into v_n from public.skylanders s
   where public.is_shop_eligible(s.sky_id);
  if v_n::text <> v_soll then
    raise exception '0135 Abbruch: % shopfaehige Zeilen, vorher %', v_n, v_soll;
  end if;

  -- 5e. Der Fortschritts-Nenner, gesamt und je Serie
  v_soll := (select wert from z1_abdruck where schluessel = 'sammelbar');
  select count(*) into v_n from public.skylanders s
    join public.categories c on c.id = s.category_id
   where s.is_active and s.catalog_visible
     and not (c.name = any (public.non_collectible_categories()));
  if v_n::text <> v_soll then
    raise exception '0135 Abbruch: % sammelbare Artikel, vorher %', v_n, v_soll;
  end if;

  v_soll := (select wert from z1_abdruck where schluessel = 'sammelbar_je_serie');
  select coalesce(string_agg(x.series_code || '=' || x.n::text, ',' order by x.series_code), '')
    into v_ist
    from (select s.series_code, count(*) as n
            from public.skylanders s
            join public.categories c on c.id = s.category_id
           where s.is_active and s.catalog_visible
             and not (c.name = any (public.non_collectible_categories()))
           group by s.series_code) x;
  if v_ist is distinct from v_soll then
    raise exception '0135 Abbruch: der Nenner je Serie hat sich geaendert (% statt %)',
      v_ist, v_soll;
  end if;

  -- 5f. Kein display_name_override angefasst
  v_soll := (select wert from z1_abdruck where schluessel = 'override_md5');
  select md5(coalesce(string_agg(s.sky_id || '=' || s.display_name_override,
                                 ';' order by s.sky_id), ''))
    into v_ist from public.skylanders s where s.display_name_override is not null;
  if v_ist is distinct from v_soll then
    raise exception '0135 Abbruch: ein display_name_override hat sich geaendert';
  end if;

  -- 5f2. Die Ableitungsregel steht, und sie ist eine Positivliste
  if to_regprocedure('public.catalog_item_type_for_category(text)') is null then
    raise exception '0135 Abbruch: catalog_item_type_for_category fehlt';
  end if;
  if public.catalog_item_type_for_category('Spiele') <> 'game' then
    raise exception '0135 Abbruch: die Kategorie Spiele ergibt nicht game';
  end if;
  /* KEINE pauschale Einordnung: was die Regel nicht kennt, ist eine Figur. */
  foreach v_soll in array array['Portale', 'Bundles', 'Taschen', '', 'Unbekannt'] loop
    if public.catalog_item_type_for_category(v_soll) <> 'figure' then
      raise exception '0135 Abbruch: der unbekannte Kategoriename "%" ergibt % statt figure',
        v_soll, public.catalog_item_type_for_category(v_soll);
    end if;
  end loop;
  if public.catalog_item_type_for_category(null) is distinct from 'figure' then
    raise exception '0135 Abbruch: eine Zeile ohne Kategorie ergibt nicht figure';
  end if;

  -- 5f3. Der Trigger steht, auf insert UND auf die Kategorieaenderung
  if not exists (select 1 from pg_trigger t
                  where not t.tgisinternal
                    and t.tgrelid = 'public.skylanders'::regclass
                    and t.tgname = 'skylanders_item_type_from_category') then
    raise exception '0135 Abbruch: der Trigger skylanders_item_type_from_category fehlt';
  end if;
  if (select t.tgtype & 4 from pg_trigger t                       -- BEFORE INSERT
        where t.tgrelid = 'public.skylanders'::regclass
          and t.tgname = 'skylanders_item_type_from_category') = 0 then
    raise exception '0135 Abbruch: der Trigger feuert nicht bei INSERT';
  end if;
  if (select t.tgtype & 16 from pg_trigger t                      -- BEFORE UPDATE
        where t.tgrelid = 'public.skylanders'::regclass
          and t.tgname = 'skylanders_item_type_from_category') = 0 then
    raise exception '0135 Abbruch: der Trigger feuert nicht bei UPDATE';
  end if;
  if (select count(*) from pg_trigger t, unnest(t.tgattr) a
        where t.tgrelid = 'public.skylanders'::regclass
          and t.tgname = 'skylanders_item_type_from_category'
          and a = (select attnum from pg_attribute
                    where attrelid = 'public.skylanders'::regclass
                      and attname = 'category_id')) <> 1 then
    raise exception '0135 Abbruch: der UPDATE-Trigger haengt nicht an category_id';
  end if;

  -- 5f4. Regel und Sammelbarkeit widersprechen sich nicht
  /*
   * Eine Kategorie, die `game` ergibt, MUSS nicht sammelbar sein — sonst
   * zaehlte der Fortschritt Spiele mit, und die Ableitung haette eine
   * Nebenwirkung, die niemand entschieden hat.
   */
  if exists (select 1 from public.categories c
              where public.catalog_item_type_for_category(c.name) = 'game'
                and not (c.name = any (public.non_collectible_categories()))) then
    raise exception '0135 Abbruch: eine Kategorie ergibt game, ist aber sammelbar';
  end if;

  -- 5g. Die Kategorieregel ist unberuehrt — die Paritaet zur Anwendung haelt
  if (select array_to_string(public.non_collectible_categories(), ',')) <> 'Spiele' then
    raise exception '0135 Abbruch: non_collectible_categories() wurde veraendert';
  end if;

  -- 5h. Der neue Riegel steht wirklich im Rumpf
  if position('s.item_type = ''figure''' in
       coalesce((select p.prosrc from pg_proc p
                  where p.oid = to_regprocedure('public.is_shop_eligible(text)')), '')) = 0 then
    raise exception '0135 Abbruch: is_shop_eligible prueft item_type nicht';
  end if;
  if position('non_collectible_categories' in
       coalesce((select p.prosrc from pg_proc p
                  where p.oid = to_regprocedure('public.is_shop_eligible(text)')), '')) = 0 then
    raise exception '0135 Abbruch: is_shop_eligible hat die Kategoriebedingung verloren';
  end if;

  -- 5i. Die Rechte sind die von 0008
  if (select p.proacl is null from pg_proc p
       where p.oid = to_regprocedure('public.is_shop_eligible(text)')) then
    raise exception '0135 Abbruch: is_shop_eligible hat keinen ACL — der Standard waere PUBLIC';
  end if;
  if not (has_function_privilege('anon', 'public.is_shop_eligible(text)', 'execute')
          and has_function_privilege('authenticated', 'public.is_shop_eligible(text)', 'execute')) then
    raise exception '0135 Abbruch: anon oder authenticated darf is_shop_eligible nicht ausfuehren';
  end if;

  raise notice '0135: item_type steht, % Spiele markiert, Angebote unveraendert (md5 %)',
    (select wert from z1_abdruck where schluessel = 'spiele_zeilen'),
    (select wert from z1_abdruck where schluessel = 'angebote_md5');
end $$;

/*
 * KEIN `drop table` AM ENDE, UND DAS IST DER PUNKT.
 *
 * Hier stand `drop table if exists z1_abdruck;`. Das raeumte nur den
 * ERFOLGSFALL auf: bricht die Migration in Abschnitt 5 ab und ist sie nicht
 * geklammert, waeren die vier Anweisungen davor bereits bestaetigt und die
 * Temporaertabelle lebte mit veralteten Abdruecken weiter. `on commit drop`
 * raeumt beide Faelle auf — `commit` und `rollback` — und braucht keine
 * Anweisung dafuer. Damit bleibt nach einem Abbruch nichts zurueck: keine
 * Spalte, kein CHECK, kein Kommentar, kein Backfill, keine Hilfstabelle.
 */
-- <<< ENDE: supabase/migrations/0135_catalog_item_type.sql


-- ---------------------------------------------------------------------------
-- C. Migration 0136 — eingebettet, Zeichen fuer Zeichen
-- ---------------------------------------------------------------------------
-- >>> EINGEBETTET: supabase/migrations/0136_business_backup_item_type.sql
-- ===========================================================================
-- 0136 — DER ARTIKELTYP STEHT IN DER SICHERUNG
--
-- ###########################################################################
-- ##  NICHT ANGEWENDET — WEDER AUF STAGING NOCH AUF PRODUCTION.            ##
-- ##  Entwurf. Braucht eine eigene Freigabe.                               ##
-- ##                                                                       ##
-- ##  SIE SETZT `0135` VORAUS. Der Rumpf liest `t.item_type`, und ein      ##
-- ##  `language sql`-Rumpf wird bei der Erzeugung aufgeloest: ohne die      ##
-- ##  Spalte scheitert schon `create or replace function` mit 42703.       ##
-- ##  Reihenfolge: `0135`, dann `0136`. Nicht umgekehrt, nicht zugleich.   ##
-- ###########################################################################
--
-- DIE ENTSCHEIDUNG, UND WER SIE GETROFFEN HAT
--
-- Der Betreiber hat am 2026-10-19 entschieden, `item_type` ausdruecklich in
-- die Betriebssicherung aufzunehmen. Begruendung, wortgleich: „Der Artikeltyp
-- ist langfristig eine eigenstaendige fachliche Eigenschaft und soll bei
-- einer Wiederherstellung nicht aus Kategorien rekonstruiert werden muessen."
--
-- Der Entwurf zu `0135` hatte das Gegenteil vorgeschlagen — ableitbar aus der
-- exportierten `category_id`, also verzichtbar. Das Argument war richtig und
-- ist jetzt gegenstandslos: ableitbar heisst, die Regel muss bei jeder
-- Wiederherstellung erneut angewendet werden, und eine Regel, die nirgends
-- ausgefuehrt wird, verfaellt. Der Wert steht jetzt in der Datei.
--
-- WARUM EINE EIGENE MIGRATION UND NICHT EIN ABSCHNITT IN `0135`
--
--   1. `0135` beweist sich selbst dadurch, dass sich NICHTS aendert — die
--      Angebotsliste, der Fortschrittsnenner, die Overrides. Ein zweiter,
--      600 Zeilen langer Funktionsrumpf in derselben Datei macht diesen
--      Beweis unlesbar, ohne ihn zu verbessern.
--   2. Die Sicherungsfunktion hat eine EIGENE Abdruckkette: `0129` → `0130`
--      → `0131`, jede Fassung mit md5 von Rumpf und Kommentar, jede mit einer
--      Ruecknahme (`R0130`, `R0131`). `0136` ist das naechste Glied dieser
--      Kette. In einer Spaltenmigration verschwunden, waere es keines.
--   3. Die Ruecknahmen bleiben unabhaengig: `R0136` stellt den Rumpf aus
--      `0131` wieder her, `R0135` nimmt die Spalte zurueck. In EINER Migration
--      waere nur noch beides zusammen ruecknehmbar.
--
-- WAS SIE TUT: sie ersetzt `seller_business_backup()` durch denselben Rumpf
-- wie `0131`, mit GENAU EINER zusaetzlichen Zeile im Bereich `figures`:
--
--      'item_type', t.item_type,
--
-- Sie steht unmittelbar nach `'card_type', t.card_type,` — die beiden
-- Typspalten nebeneinander — und ist deshalb eine reine EINFUEGUNG: der
-- restliche Rumpf ist Zeichen fuer Zeichen der aus `0131`. Dass das so ist,
-- rechnet `src/lib/backup/backup-item-type.test.ts` bei jedem Testlauf nach.
--
-- ABDRUECKE
--   vorher  md5(prosrc) = 24c3810288bb20929fe995554a267adf  (21458 Zeichen)
--   nachher md5(prosrc) = f6d08440707ba72a8040a8d1e666c092  (21494 Zeichen)
--   Kommentar nachher   = c12618f312b413571eeabe912ca03651  (890 Zeichen)
--   Form                = 28 Bereiche, 353 Feldzeilen (vorher 352),
--                         Bereich figures 10 Felder (vorher 9)
--
-- WAS SIE NICHT TUT
--
--   * Sie aendert KEINE bereits angewendete Migration. `0131` bleibt, wie sie
--     ist; ihr Abdruck bleibt gueltig fuer jede Umgebung, die noch auf `0131`
--     steht. `0131_function_body_check.sql` kennt ab jetzt BEIDE Staende.
--   * Sie aendert `BACKUP_FORMAT_VERSION` nicht. Die Version steigt, wenn
--     sich die BEDEUTUNG eines Feldes aendert oder ein Bereich verschwindet —
--     nicht, wenn ein Feld dazukommt (`src/lib/backup/manifest.ts`). Eine
--     aeltere Sicherung bleibt damit lesbar; ihr fehlt im Bereich `figures`
--     ein Schluessel, und genau das sagt die Formatversion nicht.
--   * Sie fasst KEIN Recht an. `create or replace function` behaelt den
--     bestehenden ACL; weder `revoke` noch `grant` steht in dieser Datei. Die
--     Nachbedingung prueft, dass PUBLIC und `anon` weiterhin draussen sind.
--   * Sie liest und schreibt KEINE Geschaeftszeile. Die Funktion bleibt
--     `stable`, `security definer`, mit leerem `search_path`.
--   * Sie beruehrt die Belegtabellen nicht, und die neun personenbezogenen
--     Einkaufsfelder bleiben ausgeschlossen — die Nachbedingung prueft beides
--     ein zweites Mal, bereichsgenau.
--
-- AUSFUEHRUNG: im SQL-Editor, vollstaendig in `begin` / `commit` geklammert.
-- Vorher und nachher `0131_function_body_check.sql` (vorher: STAND_0131,
-- nachher: STAND_0136). Ruecknahme: `supabase/rollback/R0136_back_to_0131.sql`.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 0. Der Abdruck VOR der Aenderung
--
-- Er liegt in einer temporaeren Tabelle mit `on commit drop`: sie lebt genau
-- bis zum Ende dieser Transaktion — ob sie mit `commit` oder mit `rollback`
-- endet — und kann keine Geschaeftszeile beruehren.
-- ---------------------------------------------------------------------------
create temporary table abdruck_0136 (
  schluessel text primary key,
  wert       text not null
) on commit drop;


-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen
-- ---------------------------------------------------------------------------
do $$
declare
  v_md5   text;
  v_def   text;
  v_code  text;
begin
  /*
   * DER KLAMMERGRIFF, UND WARUM ER FUNKTIONIERT.
   *
   * Die Tabelle oben traegt `on commit drop`. Laeuft diese Datei NICHT in
   * einer Klammer, ist jede Anweisung ihre eigene Transaktion — dann ist die
   * Tabelle nach ihrer Erzeugung sofort wieder weg, und dieser Block bricht
   * ab, BEVOR die Funktion ersetzt wird. Laeuft die Datei als Ganzes (ein
   * Mehranweisungs-Lauf ist eine implizite Transaktion) oder in einem
   * ausdruecklichen `begin` / `commit`, steht sie.
   */
  if to_regclass('pg_temp.abdruck_0136') is null then
    raise exception '0136 Abbruch: die Datei laeuft nicht in einer Transaktion — '
      'in begin / commit klammern und vollstaendig ausfuehren';
  end if;

  if to_regprocedure('public.seller_business_backup()') is null then
    raise exception '0136 setzt 0104 voraus: seller_business_backup fehlt';
  end if;

  /*
   * `0135` IST DIE HARTE VORBEDINGUNG. Der Rumpf unten liest `t.item_type`.
   * Ein `language sql`-Rumpf wird bei der Erzeugung vollstaendig aufgeloest,
   * die Migration scheiterte also ohnehin — aber mit `42703 column
   * t.item_type does not exist` statt mit einem Satz, der sagt, was fehlt.
   */
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'skylanders'
                    and column_name = 'item_type') then
    raise exception '0136 setzt 0135 voraus: skylanders.item_type fehlt';
  end if;

  select md5(p.prosrc) into v_md5
    from pg_proc p where p.oid = to_regprocedure('public.seller_business_backup()');

  if v_md5 = 'f6d08440707ba72a8040a8d1e666c092' then
    raise exception '0136 Abbruch: schon angewendet — der lebende Rumpf IST der aus 0136';
  end if;
  if v_md5 <> '24c3810288bb20929fe995554a267adf' then
    raise exception '0136 Abbruch: der lebende Rumpf ist nicht der aus 0131 (md5 %) — '
      'erst 0131_function_body_check.sql lesen', v_md5;
  end if;

  -- Der Rumpf ohne Kommentare, wie in 0130 und 0131.
  v_def := pg_get_functiondef(to_regprocedure('public.seller_business_backup()'));
  if exists (select 1 from regexp_matches(v_def, $re$'(?:[^']|'')*'$re$, 'g') as m(lit)
              where lit[1] like '%--%' or lit[1] like '%/*%' or lit[1] like '%*/%') then
    raise exception '0136 Abbruch: ein Stringliteral im Rumpf enthaelt einen Kommentarstarter';
  end if;
  v_code := regexp_replace(v_def,  $re$/\*.*?\*/$re$, '', 'g');
  v_code := regexp_replace(v_code, '--.*', '', 'gn');

  /*
   * DER ABDRUCK: ALLE BEREICH-FELD-PAARE AUSSER DENEN DES BEREICHS `figures`.
   *
   * Das ist der Beweis, den diese Migration ueber sich selbst fuehrt. Sie
   * aendert genau einen Bereich; die 27 anderen muessen danach Zeichen fuer
   * Zeichen dieselben Paare in derselben Reihenfolge tragen. Zeilenweise
   * bestimmt, ohne jeden mehrzeiligen Ausdruck — dieselbe Lehre wie in `0130`
   * und `0131` (Handbuch 9.7.3.5).
   */
  insert into abdruck_0136 (schluessel, wert)
  with zeile as (
    select z.nr, z.txt
      from regexp_split_to_table(v_code, E'\n') with ordinality as z(txt, nr)
  ),
  anfang as (
    select z.nr,
           (regexp_match(z.txt, '^ {6}''([a-z_0-9]+)'', coalesce\(\($'))[1] as name
      from zeile z
     where z.txt ~ '^ {6}''[a-z_0-9]+'', coalesce\(\($'
  ),
  paar as (
    select z.nr,
           coalesce((select a.name from anfang a
                      where a.nr < z.nr order by a.nr desc limit 1), '') as bereich,
           rtrim(btrim(z.txt), ',') as feld
      from zeile z
     where z.txt ~ '^ {10}''[a-z_0-9]+'','
  )
  select * from (values
    ('bereiche', (select count(*)::text from anfang)),
    ('felder',   (select count(*)::text from paar)),
    ('ohne_figures_md5',
       (select md5(coalesce(string_agg(p.bereich || '|' || p.feld, ';' order by p.nr), ''))
          from paar p where p.bereich <> 'figures')),
    ('ohne_figures_anzahl',
       (select count(*)::text from paar p where p.bereich <> 'figures')),
    ('figures',
       (select coalesce(string_agg(p.feld, ';' order by p.nr), '')
          from paar p where p.bereich = 'figures'))
  ) v(schluessel, wert);

  if (select wert from abdruck_0136 where schluessel = 'bereiche') <> '28' then
    raise exception '0136 Abbruch: der Bereichsparser erkennt % Bereiche statt 28 — '
      'Abbruch vor jeder Feldaussage',
      (select wert from abdruck_0136 where schluessel = 'bereiche');
  end if;
  if (select wert from abdruck_0136 where schluessel = 'felder') <> '352' then
    raise exception '0136 Abbruch: % Feldzeilen statt 352 — der lebende Rumpf ist nicht der aus 0131',
      (select wert from abdruck_0136 where schluessel = 'felder');
  end if;
  if (select wert from abdruck_0136 where schluessel = 'figures')
     <> '''sky_id'', t.sky_id;''name'', t.name;''slug'', t.slug;'
      || '''series_code'', t.series_code;''card_type'', t.card_type;'
      || '''market_price'', t.market_price::text;''category_id'', t.category_id;'
      || '''is_active'', t.is_active;''source'', t.source' then
    raise exception '0136 Abbruch: der Bereich figures ist nicht der aus 0131 (%)',
      (select wert from abdruck_0136 where schluessel = 'figures');
  end if;

  raise notice '0136: Vorbedingungen erfuellt — 28 Bereiche, 352 Feldzeilen, '
    'figures mit 9 Feldern, 27 andere Bereiche als Abdruck %',
    (select wert from abdruck_0136 where schluessel = 'ohne_figures_md5');
end
$$;


-- ---------------------------------------------------------------------------
-- 2. Die Sicherung, um GENAU EINE Feldzeile ergaenzt
-- ---------------------------------------------------------------------------
create or replace function public.seller_business_backup()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with used_figures as (
    /*
     * Die SKY-IDs, die im Backup überhaupt vorkommen. Der
     * Stammdatenschnappschuss beschränkt sich darauf — 605 Katalogzeilen
     * mitzuschicken, von denen die Hälfte nie gehandelt wurde, machte die
     * Datei größer und nicht verständlicher.
     */
    select sky_id from public.shop_inventory
    union select sky_id from public.purchase_items
    union select sky_id from public.sale_items
    union select sky_id from public.order_lines
  )
  select case when not public.can_operate_active_seller() then null else jsonb_build_object(

    /* ---- Metadaten -------------------------------------------------- */
    'format',          'skyisles-business-backup',
    'format_version',  1,
    'created_at',      now(),
    'commerce_mode',   (select s.mode from public.commerce_settings s limit 1),
    'seller_legal_name', (select s.legal_name from public.sellers s limit 1),
    'snapshot_txid',   pg_current_snapshot()::text,
    'inventory_units', (select coalesce(sum(i.quantity), 0) from public.shop_inventory i),
    'buy_in_factor',   public.orderbook_global_factor()::text,
    'contains_personal_data', true,
    'restore_supported',      false,

    /* ---- Die Bereiche ----------------------------------------------- */
    'data', jsonb_build_object(
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
          'items_cost', t.items_cost::text,
          'shipping_cost', t.shipping_cost::text,
          'buyer_protection_cost', t.buyer_protection_cost::text,
          'currency', t.currency,
          'payment_method', t.payment_method,
          'platform', t.platform,
          'seller_name', t.seller_name,
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
  
      /* ---------------------------------------------- Eigenbelege (0129) */
      /*
       * DIE DREI BELEGTABELLEN. Sie fehlten bis `0129` ganz — eine
       * Wiederherstellung aus dieser Datei haette jeden Eigenbeleg verloren,
       * samt Nummernkreis und Abrufnachweis.
       *
       * `lines` kommt als ganzes `jsonb` mit: es IST der eingefrorene
       * Snapshot und wird nicht neu aus `purchase_items` gebildet. Genau
       * darin liegt sein Zweck.
       */
      'purchase_receipts', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'purchase_id', t.purchase_id,
          'receipt_number', t.receipt_number,
          'issued_at', t.issued_at,
          'revision', t.revision,
          'supersedes_id', t.supersedes_id,
          'supersedes_number', t.supersedes_number,
          'supersedes_issued_at', t.supersedes_issued_at,
          'format_version', t.format_version,
          'content_fingerprint', t.content_fingerprint,
          'buyer_legal_name', t.buyer_legal_name,
          'buyer_trade_name', t.buyer_trade_name,
          'buyer_street', t.buyer_street,
          'buyer_postal_code', t.buyer_postal_code,
          'buyer_city', t.buyer_city,
          'buyer_country', t.buyer_country,
          'buyer_email', t.buyer_email,
          'buyer_vat_id', t.buyer_vat_id,
          'seller_platform', t.seller_platform,
          'seller_handle', t.seller_handle,
          'sender_name', t.sender_name,
          'sender_street', t.sender_street,
          'sender_postal_code', t.sender_postal_code,
          'sender_city', t.sender_city,
          'sender_country', t.sender_country,
          'listing_ref', t.listing_ref,
          'listing_title', t.listing_title,
          'listing_url', t.listing_url,
          'listing_details', t.listing_details,
          'purchased_at', t.purchased_at,
          'items_cost', t.items_cost::text,
          'shipping_cost', t.shipping_cost::text,
          'buyer_protection_cost', t.buyer_protection_cost::text,
          'total_cost', t.total_cost::text,
          'currency', t.currency,
          'payment_method', t.payment_method,
          'agreement_note', t.agreement_note,
          'lines', t.lines
        ) order by t.id)
          from public.purchase_receipts t
      ), '[]'::jsonb),
  
      /*
       * DER ABRUFNACHWEIS. Ohne ihn waere nach einer Wiederherstellung nicht
       * mehr belegbar, dass ein Beleg je vollstaendig ausgeliefert wurde —
       * und der gruene Haken in der Oberflaeche haengt daran.
       */
      'purchase_receipt_downloads', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'receipt_id', t.receipt_id,
          'delivered_at', t.delivered_at,
          'byte_count', t.byte_count
        ) order by t.id)
          from public.purchase_receipt_downloads t
      ), '[]'::jsonb),
  
      /*
       * DER NUMMERNZAEHLER. Er ist der Grund, warum der Nummernkreis
       * lueckenlos bleibt. Ohne ihn vergaebe eine wiederhergestellte Datenbank
       * Nummern, die es schon gibt — und `receipts_number_unique` schluege
       * beim naechsten Ausstellen zu.
       */
      'purchase_receipt_counters', coalesce((
        select jsonb_agg(jsonb_build_object(
          'year', t.year,
          'next_number', t.next_number
        ) order by t.year)
          from public.purchase_receipt_counters t
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
          'sale_day', t.sale_day,
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
  
      'name_mappings', coalesce((
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
  
      'orders', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'order_number', t.order_number,
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
          'series_snapshot', t.series_snapshot,
          'unit_price', t.unit_price::text,
          'discount_amount', t.discount_amount::text,
          'line_total', t.line_total::text,
          'inventory_id', t.inventory_id,
          'created_at', t.created_at
        ) order by t.id)
          from public.order_lines t
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
          'sale_item_id', t.sale_item_id,
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
          'requested_at', t.requested_at,
          'settled_at', t.settled_at,
          'provider_status', t.provider_status,
          'failure_code', t.failure_code,
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
  
      'monthly_reports', coalesce((
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
  
      'figures', coalesce((
        select jsonb_agg(jsonb_build_object(
          'sky_id', t.sky_id,
          'name', t.name,
          'slug', t.slug,
          'series_code', t.series_code,
          'card_type', t.card_type,
          'item_type', t.item_type,
          'market_price', t.market_price::text,
          'category_id', t.category_id,
          'is_active', t.is_active,
          'source', t.source
        ) order by t.sky_id)
          from public.skylanders t
         where t.sky_id in (select sky_id from used_figures)
      ), '[]'::jsonb),
  
      'series', coalesce((
        select jsonb_agg(jsonb_build_object(
          'code', t.code,
          'label', t.label,
          'release_year', t.release_year,
          'position', t.position
        ) order by t.code)
          from public.series t
      ), '[]'::jsonb),
  
      'categories', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id,
          'series_code', t.series_code,
          'name', t.name,
          'catalog_group', t.catalog_group,
          'position', t.position
        ) order by t.id)
          from public.categories t
      ), '[]'::jsonb),
  
      'seller', coalesce((
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
          'small_business_19', t.small_business_19,
          'contact_email', t.contact_email,
          'transactional_reply_to', t.transactional_reply_to,
          'withdrawal_contact_email', t.withdrawal_contact_email,
          'complaints_contact_email', t.complaints_contact_email,
          'dispute_participation', t.dispute_participation,
          'dispute_body', t.dispute_body,
          'dispatch_statement', t.dispatch_statement,
          'return_postage_borne_by', t.return_postage_borne_by,
          'is_active', t.is_active,
          'free_shipping_threshold', t.free_shipping_threshold::text
        ) order by t.id)
          from public.sellers t
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
  
      'shipping_methods', coalesce((
        select jsonb_agg(jsonb_build_object(
          'code', t.code,
          'name', t.name,
          'base_price', t.base_price::text,
          'is_enabled', t.is_enabled,
          'sort_order', t.sort_order
        ) order by t.code)
          from public.shipping_methods t
      ), '[]'::jsonb)
    )
  ) end;
$$;

comment on function public.seller_business_backup() is
  'Eine Momentaufnahme der Betriebsdaten als JSON (0104; Eigenbelege in 0129, Kostenteile und Katalogordnung in 0130, Haendlerstammdaten in 0131, Artikeltyp in 0136) — 28 Bereiche in EINER Anweisung und damit aus EINER MVCC-Momentaufnahme. Liest nur. Der Bereich seller traegt seit 0131 die Rechtsangaben, die auf jeder Rechnung stehen, samt is_active: nach einer Wiederherstellung ist damit entscheidbar, welche Zeile der Betrieb ist. Der Bereich figures traegt seit 0136 item_type: der Artikeltyp ist eine eigenstaendige fachliche Eigenschaft und wird bei einer Wiederherstellung abgelesen, nicht aus der Kategorie rekonstruiert. Absender, Inserat und Kaufvereinbarung eines Einkaufs bleiben AUSDRUECKLICH draussen (personenbezogen, offene Aufbewahrungsfrage); Kontoidentitaeten, Zeitstempel der Stammdaten und Zahlungsdienstleister-Interna ebenso. Kein Restore: restore_supported ist false.';

-- ---------------------------------------------------------------------------
-- 3. Nachbedingungen
--
-- Erstens der Abdruck: 27 Bereiche muessen Zeichen fuer Zeichen dieselben
-- Paare in derselben Reihenfolge tragen wie vorher. Zweitens der Bereich
-- `figures`: genau zehn Felder in genau dieser Reihenfolge. Drittens alles,
-- was `0131` schon geprueft hat — eine Sicherung, die ploetzlich schreibt,
-- Rechte verschenkt oder die Formatversion verschiebt, waere ein Befund, auch
-- wenn der Abdruck stimmt.
-- ---------------------------------------------------------------------------
do $$
declare
  v_def          text;
  v_code         text;
  v_key          text;
  v_md5          text;
  v_laenge       integer;
  v_bereiche     integer;
  v_felder       integer;
  v_ohne_bereich integer;
  v_rest_md5     text;
  v_rest_anzahl  integer;
  v_figures      text;
  v_wer          text := '0136 Abbruch';
begin
  v_def := pg_get_functiondef(to_regprocedure('public.seller_business_backup()'));
  if v_def is null then
    raise exception '0136 unvollstaendig: seller_business_backup fehlt';
  end if;

  -- ---- der Abdruck der Funktion selbst --------------------------------
  select md5(p.prosrc), length(p.prosrc) into v_md5, v_laenge
    from pg_proc p where p.oid = to_regprocedure('public.seller_business_backup()');
  if v_md5 <> 'f6d08440707ba72a8040a8d1e666c092' then
    raise exception '%: md5 des Rumpfs ist % statt f6d08440707ba72a8040a8d1e666c092',
      v_wer, v_md5;
  end if;
  if v_laenge <> 21494 then
    raise exception '%: der Rumpf hat % Zeichen statt 21494', v_wer, v_laenge;
  end if;
  if md5(obj_description(to_regprocedure('public.seller_business_backup()'), 'pg_proc'))
     is distinct from 'c12618f312b413571eeabe912ca03651' then
    raise exception '%: der Funktionskommentar ist nicht der aus 0136', v_wer;
  end if;

  -- ---- der Rumpf ohne Kommentare, wie in 0130 und 0131 ----------------
  if exists (select 1 from regexp_matches(v_def, $re$'(?:[^']|'')*'$re$, 'g') as m(lit)
              where lit[1] like '%--%' or lit[1] like '%/*%' or lit[1] like '%*/%') then
    raise exception '%: ein Stringliteral im Rumpf enthaelt einen Kommentarstarter', v_wer;
  end if;
  v_code := regexp_replace(v_def,  $re$/\*.*?\*/$re$, '', 'g');
  v_code := regexp_replace(v_code, '--.*', '', 'gn');

  -- ---- 27 Bereiche unveraendert, figures genau zehn Felder ------------
  with zeile as (
    select z.nr, z.txt
      from regexp_split_to_table(v_code, E'\n') with ordinality as z(txt, nr)
  ),
  anfang as (
    select z.nr,
           (regexp_match(z.txt, '^ {6}''([a-z_0-9]+)'', coalesce\(\($'))[1] as name
      from zeile z
     where z.txt ~ '^ {6}''[a-z_0-9]+'', coalesce\(\($'
  ),
  paar as (
    select z.nr,
           coalesce((select a.name from anfang a
                      where a.nr < z.nr order by a.nr desc limit 1), '') as bereich,
           rtrim(btrim(z.txt), ',') as feld
      from zeile z
     where z.txt ~ '^ {10}''[a-z_0-9]+'','
  )
  select (select count(*) from anfang),
         (select count(*) from paar),
         (select count(*) from paar p where p.bereich = ''),
         (select md5(coalesce(string_agg(p.bereich || '|' || p.feld, ';' order by p.nr), ''))
            from paar p where p.bereich <> 'figures'),
         (select count(*) from paar p where p.bereich <> 'figures'),
         (select coalesce(string_agg(p.feld, ';' order by p.nr), '')
            from paar p where p.bereich = 'figures')
    into v_bereiche, v_felder, v_ohne_bereich, v_rest_md5, v_rest_anzahl, v_figures;

  if v_bereiche <> 28 then
    raise exception '%: % Bereiche statt 28 — Abbruch vor jeder Feldaussage',
      v_wer, v_bereiche;
  end if;
  if v_ohne_bereich <> 0 then
    raise exception '%: % Feldzeile(n) gehoeren zu keinem Bereich', v_wer, v_ohne_bereich;
  end if;
  if v_felder <> 353 then
    raise exception '%: % Feldzeilen statt 353 (352 aus 0131 plus item_type)',
      v_wer, v_felder;
  end if;
  if v_rest_anzahl::text
     <> (select wert from abdruck_0136 where schluessel = 'ohne_figures_anzahl') then
    raise exception '%: % Feldzeilen ausserhalb von figures, vorher %',
      v_wer, v_rest_anzahl,
      (select wert from abdruck_0136 where schluessel = 'ohne_figures_anzahl');
  end if;
  if v_rest_md5 <> (select wert from abdruck_0136 where schluessel = 'ohne_figures_md5') then
    raise exception '%: die 27 anderen Bereiche haben sich geaendert (% statt %)',
      v_wer, v_rest_md5,
      (select wert from abdruck_0136 where schluessel = 'ohne_figures_md5');
  end if;
  if v_figures <> '''sky_id'', t.sky_id;''name'', t.name;''slug'', t.slug;'
               || '''series_code'', t.series_code;''card_type'', t.card_type;'
               || '''item_type'', t.item_type;'
               || '''market_price'', t.market_price::text;''category_id'', t.category_id;'
               || '''is_active'', t.is_active;''source'', t.source' then
    raise exception '%: der Bereich figures ist nicht der erwartete (%)', v_wer, v_figures;
  end if;

  -- ---- und alles, was 0131 schon verlangt hat --------------------------
  foreach v_key in array array['insert into', 'update public.', 'delete from',
                               'create temp', 'truncate', 'nextval', 'setval',
                               'txid_current()'] loop
    if position(v_key in v_code) > 0 then
      raise exception '%: die Sicherung schreibt (%)', v_wer, v_key;
    end if;
  end loop;
  foreach v_key in array array['''updated_by''', '''issued_by''', '''delivered_by''',
                               '''client_salt''', '''idempotency_key'''] loop
    if position(v_key in v_code) > 0 then
      raise exception '%: der Export nennt % ', v_wer, v_key;
    end if;
  end loop;

  /*
   * DIE NEUN PERSONENBEZOGENEN FELDER — bereichsgenau, nicht rumpfweit.
   *
   * Dieselbe Lehre wie in `0130` und `0131`: im Belegsnapshot stehen sie
   * berechtigt, in jedem anderen Bereich waere es ein Befund. Rumpfweit
   * gesucht pruefte das nichts.
   */
  foreach v_key in array array[
    '''sender_name''', '''sender_street''', '''sender_postal_code''',
    '''sender_city''', '''sender_country''', '''listing_title''',
    '''listing_url''', '''listing_details''', '''agreement_note'''] loop
    if exists (
      with zeile as (
        select z.nr, z.txt
          from regexp_split_to_table(v_code, E'\n') with ordinality as z(txt, nr)
      ),
      anfang as (
        select z.nr,
               (regexp_match(z.txt, '^ {6}''([a-z_0-9]+)'', coalesce\(\($'))[1] as name
          from zeile z
         where z.txt ~ '^ {6}''[a-z_0-9]+'', coalesce\(\($'
      )
      select 1 from zeile z
       where z.txt ~ ('^ {10}' || v_key || ',')
         and coalesce((select a.name from anfang a
                        where a.nr < z.nr order by a.nr desc limit 1), '')
             <> 'purchase_receipts') then
      raise exception '%: % steht in einem anderen Bereich als purchase_receipts — '
        'personenbezogen und nicht freigegeben', v_wer, v_key;
    end if;
  end loop;

  if (select p.provolatile from pg_proc p
       where p.oid = to_regprocedure('public.seller_business_backup()')) <> 's' then
    raise exception '%: seller_business_backup muss stable bleiben', v_wer;
  end if;
  if (select p.prosecdef from pg_proc p
       where p.oid = to_regprocedure('public.seller_business_backup()')) is not true then
    raise exception '%: security definer ist weg', v_wer;
  end if;
  if position('''format_version'',  1' in v_code) = 0 then
    raise exception '%: die Formatversion wurde veraendert', v_wer;
  end if;
  if position('''restore_supported'',      false' in v_code) = 0 then
    raise exception '%: restore_supported ist nicht mehr false', v_wer;
  end if;
  if exists (select 1 from pg_proc p, aclexplode(p.proacl) a
              where p.oid = to_regprocedure('public.seller_business_backup()')
                and a.privilege_type = 'EXECUTE'
                and (a.grantee = 0 or a.grantee::regrole::text = 'anon')) then
    raise exception '%: PUBLIC oder anon darf die Sicherung abrufen', v_wer;
  end if;
  if (select p.proacl is null from pg_proc p
       where p.oid = to_regprocedure('public.seller_business_backup()')) then
    raise exception '%: die Funktion hat keinen ACL — der Standard waere PUBLIC', v_wer;
  end if;

  raise notice '0136 ok: der Bereich figures traegt item_type, 28 Bereiche, '
    '353 Feldzeilen, die 27 anderen Bereiche unveraendert (Abdruck %).',
    v_rest_md5;
end
$$;
-- <<< ENDE: supabase/migrations/0136_business_backup_item_type.sql

-- ---------------------------------------------------------------------------
-- D. Nachher: dieselben Werte, dieselben Waechter
--
-- Die beiden Migrationen haben ihre eigenen Nachbedingungen schon gefahren.
-- Dieser Abschnitt prueft, was KEINE von beiden allein pruefen kann: dass
-- nach BEIDEN Laeufen zusammen noch alles steht — und dass sich kein Wert
-- bewegt hat, der sich nicht bewegen durfte.
-- ---------------------------------------------------------------------------
do $$
declare
  v_schluessel text;
  v_vorher text;
  v_nachher text;
  v_abweichung text := '';
begin
  -- D1. Die Werte von nachher, mit demselben Ausdruck wie in A6.
  insert into lauf_abdruck (schluessel, wert) values
    ('n_shopfaehig',   (select count(*)::text from public.skylanders s
                         where public.is_shop_eligible(s.sky_id))),
    ('n_angebote',     (select count(*)::text from public.shop_offers())),
    ('n_angebote_md5', (select md5(coalesce(string_agg(o.sky_id || '|' || o.condition || '|'
                                          || coalesce(o.price::text, ''),
                                          ';' order by o.sky_id, o.condition), ''))
                          from public.shop_offers() o)),
    ('n_sammelbar',    (select count(*)::text from public.skylanders s
                          join public.categories c on c.id = s.category_id
                         where s.is_active and s.catalog_visible
                           and not (c.name = any (public.non_collectible_categories())))),
    ('n_sammelbar_je_serie',
       (select coalesce(string_agg(x.series_code || '=' || x.n::text, ',' order by x.series_code), '')
          from (select s.series_code, count(*) as n
                  from public.skylanders s
                  join public.categories c on c.id = s.category_id
                 where s.is_active and s.catalog_visible
                   and not (c.name = any (public.non_collectible_categories()))
                 group by s.series_code) x)),
    ('n_override_md5', (select md5(coalesce(string_agg(s.sky_id || '=' || s.display_name_override,
                                          ';' order by s.sky_id), ''))
                          from public.skylanders s where s.display_name_override is not null)),
    ('n_overrides',    (select count(*)::text from public.skylanders
                         where display_name_override is not null)),
    ('n_spiele_overrides', (select count(*)::text from public.skylanders s
                              join public.categories c on c.id = s.category_id
                             where c.name = 'Spiele'
                               and s.display_name_override is not null)),
    ('n_aenderungen_heute', (select count(*)::text from public.catalog_admin_changes
                              where entity = 'skylander'
                                and field = 'display_name_override'
                                and changed_at >= current_date)),
    ('n_katalogzeilen', (select count(*)::text from public.skylanders)),
    ('n_spiele_zeilen', (select count(*)::text from public.skylanders s
                          join public.categories c on c.id = s.category_id
                         where c.name = 'Spiele')),
    ('n_einkaeufe',    (select count(*)::text from public.purchases where source <> 'manual')),
    ('n_positionen',   (select count(*)::text from public.purchase_items)),
    ('n_lagerzeilen',  (select count(*)::text from public.shop_inventory)),
    ('n_einheiten',    (select coalesce(sum(quantity), 0)::text from public.shop_inventory)),
    ('n_bewegungen',   (select count(*)::text from public.inventory_movements)),
    ('n_importsumme',  (select coalesce(sum(total_cost), 0)::text from public.purchases
                         where source <> 'manual')),
    ('n_belege',       (select count(*)::text from public.purchase_receipts)),
    ('n_zaehler',      (select count(*)::text from public.purchase_receipt_counters)),
    ('n_abrufe',       (select count(*)::text from public.purchase_receipt_downloads)),
    ('n_sicherung_md5', coalesce((select md5(p.prosrc) from pg_proc p
                                   where p.oid = to_regprocedure(
                                     'public.seller_business_backup()')), '(fehlt)'));

  -- D2. Jeder Wert, der sich NICHT bewegen durfte.
  foreach v_schluessel in array array[
    'shopfaehig', 'angebote', 'angebote_md5', 'sammelbar', 'sammelbar_je_serie',
    'override_md5', 'overrides', 'spiele_overrides', 'katalogzeilen', 'spiele_zeilen',
    'einkaeufe', 'positionen', 'lagerzeilen', 'einheiten', 'bewegungen',
    'importsumme', 'belege', 'zaehler', 'abrufe'] loop
    select a.wert into v_vorher  from lauf_abdruck a where a.schluessel = v_schluessel;
    select a.wert into v_nachher from lauf_abdruck a where a.schluessel = 'n_' || v_schluessel;
    if v_vorher is distinct from v_nachher then
      v_abweichung := v_abweichung || v_schluessel || ': ' || coalesce(v_vorher, '(null)')
                      || ' -> ' || coalesce(v_nachher, '(null)') || '  ';
    end if;
  end loop;
  if v_abweichung <> '' then
    raise exception 'ABBRUCH D2: diese Werte haben sich bewegt, durften es aber nicht: %',
      v_abweichung;
  end if;

  -- D3. Die Sicherung IST jetzt der Stand 0136 — der eine Wert, der sich
  --     bewegen MUSSTE.
  select a.wert into v_nachher from lauf_abdruck a where a.schluessel = 'n_sicherung_md5';
  if v_nachher <> 'f6d08440707ba72a8040a8d1e666c092' then
    raise exception 'ABBRUCH D3: die Betriebssicherung ist nicht der Stand 0136 (md5 %)',
      v_nachher;
  end if;

  -- D4. item_type steht, der Backfill trifft genau die Spiele, nichts sonst.
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'skylanders'
                    and column_name = 'item_type' and is_nullable = 'NO') then
    raise exception 'ABBRUCH D4: item_type fehlt oder ist nullable';
  end if;
  if (select count(*) from public.skylanders where item_type = 'game')::text
     <> (select a.wert from lauf_abdruck a where a.schluessel = 'spiele_zeilen') then
    raise exception 'ABBRUCH D4: % game-Zeilen, erwartet % (Kategorie Spiele)',
      (select count(*) from public.skylanders where item_type = 'game'),
      (select a.wert from lauf_abdruck a where a.schluessel = 'spiele_zeilen');
  end if;
  if exists (select 1 from public.skylanders where item_type not in ('figure', 'game')) then
    raise exception 'ABBRUCH D4: es gibt einen anderen Artikeltyp als figure/game — '
      'Z3 ist ein eigener Schritt';
  end if;

  -- D5. Die Ableitungsregel und der Trigger stehen.
  if public.catalog_item_type_for_category('Spiele') <> 'game'
     or public.catalog_item_type_for_category('Portale') <> 'figure'
     or public.catalog_item_type_for_category(null) is distinct from 'figure' then
    raise exception 'ABBRUCH D5: die Ableitungsregel ist nicht die erwartete';
  end if;
  if not exists (select 1 from pg_trigger t
                  where not t.tgisinternal
                    and t.tgrelid = 'public.skylanders'::regclass
                    and t.tgname = 'skylanders_item_type_from_category') then
    raise exception 'ABBRUCH D5: der Trigger fehlt';
  end if;

  -- D6. 0133 und 0134 sind weiter NICHT angewendet.
  if to_regprocedure('public.purchases_paid_total_is_final()') is not null
     or position('''source_row'', i.source_row' in
          coalesce((select p.prosrc from pg_proc p
                     where p.oid = to_regprocedure('public.seller_purchase(bigint)')), '')) > 0 then
    raise exception 'ABBRUCH D6: 0133 oder 0134 ist angewendet worden — dieser Lauf '
      'faesst sie nicht an';
  end if;

  -- D7. Und die Belegsperre ist unveraendert dicht.
  if exists (select 1 from (values
               ('public.seller_issue_purchase_receipt(bigint)'),
               ('public.seller_issue_purchase_receipt_correction(bigint)')) f(sig)
              cross join (values ('anon'), ('authenticated'), ('service_role')) r(n)
             where to_regprocedure(f.sig) is not null
               and has_function_privilege(r.n, f.sig, 'execute')) then
    raise exception 'ABBRUCH D7: die Belegsperre ist nicht mehr dicht';
  end if;

  raise notice 'D ok: 18 Bezugswerte unveraendert, Sicherung auf Stand 0136, '
    'item_type gesetzt, Ableitung und Trigger stehen, 0133/0134 weiter offen, '
    'Belegsperre dicht.';
end $$;


-- ---------------------------------------------------------------------------
-- E. Das Ergebnisraster — ins Protokoll uebernehmen
-- ---------------------------------------------------------------------------
select
  a.schluessel                                  as gegenstand,
  a.wert                                        as vorher,
  n.wert                                        as nachher,
  case when a.wert is not distinct from n.wert then 'gleich' else 'GEAENDERT' end as befund
from lauf_abdruck a
join lauf_abdruck n on n.schluessel = 'n_' || a.schluessel
order by a.schluessel;

commit;
