-- ===========================================================================
-- STAGING — EIN LAUF FUER 0137 (Zubehoer wird ein Katalogartikel)
--
-- EINE DATEI, EINE TRANSAKTION, EIN EINFUEGEN. Vollstaendig markieren, in den
-- SQL-Editor des Staging-Projekts qqxcpesbwfxzgytkdsac einfuegen, ausfuehren.
-- Nichts in Teilen, nichts nachtraeglich: jede Zeile gehoert zur selben
-- Klammer, und ein Fehler irgendwo rollt alles zurueck — einschliesslich der
-- Funktionsdefinitionen.
--
-- WAS DER LAUF TUT
--
--   A  Vorpruefung: Umgebungsstempel, Transaktionsklammer, 0135 UND 0136 sind
--      angewendet, 0133/0134 sind es NICHT, Belegsperre dicht, 20 Bezugswerte,
--      der Z0-Vertrag, und die vier neuen Zubehoerkategorien sind leer.
--   B  Migration 0137, Zeichen fuer Zeichen aus
--      `supabase/migrations/0137_catalog_accessories.sql`. Sie bringt ihre
--      eigene Vor- und Nachpruefung mit; beide laufen hier mit.
--   C  Nachpruefung: dieselben 20 Bezugswerte erneut, verglichen; die neue
--      Funktion in Form und Rechten; die Ableitung als Positivliste;
--      0133/0134 weiter offen; Belegsperre weiter dicht.
--   D  Ein Ergebnisraster vorher/nachher zum Uebernehmen ins Protokoll.
--
-- WAS ER NICHT TUT
--
--   * Keinen Artikel anlegen. Keine Kategorie. Keine SKY-ID ziehen. Die 21
--     Arbeitsmappen-Portale bleiben Z3 mit eigener Freigabe.
--   * Keine historische Einkaufsposition umhaengen.
--   * Keine Belegausstellung, keine Belegkorrektur, keinen Belegzaehler
--     anfassen. RECEIPT_ISSUANCE_RELEASED bleibt false.
--   * Nichts an Production. Diese Datei bricht auf jeder Datenbank ab, die
--     den Staging-Stempel nicht traegt.
--
-- ERWARTETES ERGEBNIS: das Raster in D zeigt 20 Zeilen `gleich`. Jede Zeile
-- `GEAENDERT` ist ein Befund — 0137 aendert keinen dieser Werte.
--
-- BEI EINEM FEHLER: die Transaktion ist abgebrochen und jede weitere Anweisung
-- meldet 25P02. Dann `rollback;` ausfuehren, die Meldung notieren und nichts
-- weiter versuchen. Es bleibt nichts zurueck.
-- ===========================================================================

begin;

/* Ein langer Lauf, aber keine Ewigkeit — und die Funktionssperre wartet nicht
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
do $lauf_a$
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

  -- A3. 0135 UND 0136 sind angewendet — 0137 setzt beide voraus.
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'skylanders'
                    and column_name = 'item_type') then
    raise exception 'ABBRUCH A3: skylanders.item_type fehlt — erst 0135 anwenden.';
  end if;
  if to_regprocedure('public.catalog_item_type_for_category(text)') is null then
    raise exception 'ABBRUCH A3: die Ableitungsfunktion aus 0135 fehlt.';
  end if;
  if coalesce((select md5(p.prosrc) from pg_proc p
                where p.oid = to_regprocedure('public.seller_business_backup()')), '(fehlt)')
     <> 'f6d08440707ba72a8040a8d1e666c092' then
    raise exception 'ABBRUCH A3: die Betriebssicherung ist nicht der Stand 0136 (md5 %) — '
      'erst 0136 anwenden.',
      coalesce((select md5(p.prosrc) from pg_proc p
                 where p.oid = to_regprocedure('public.seller_business_backup()')), '(fehlt)');
  end if;

  -- A4. 0133 und 0134 sind NICHT angewendet.
  if to_regprocedure('public.purchases_paid_total_is_final()') is not null then
    raise exception 'ABBRUCH A4: 0133 ist hier angewendet — dieser Lauf ist fuer '
      'den Stand 0136 geschrieben.';
  end if;
  if exists (select 1 from pg_trigger t
              where not t.tgisinternal
                and t.tgrelid = 'public.purchases'::regclass
                and t.tgname = 'purchases_paid_total_immutable_trg') then
    raise exception 'ABBRUCH A4: der Trigger aus 0133 steht.';
  end if;
  if position('''source_row'', i.source_row' in
       coalesce((select p.prosrc from pg_proc p
                  where p.oid = to_regprocedure('public.seller_purchase(bigint)')), '')) > 0 then
    raise exception 'ABBRUCH A4: 0134 ist hier angewendet.';
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
    ('typen',
       (select coalesce(string_agg(x.item_type || '=' || x.n::text, ',' order by x.item_type), '')
          from (select s.item_type, count(*) as n
                  from public.skylanders s group by s.item_type) x)),
    ('override_md5',
       (select md5(coalesce(string_agg(s.sky_id || '=' || s.display_name_override,
                                       ';' order by s.sky_id), ''))
          from public.skylanders s where s.display_name_override is not null)),
    ('spiele_overrides', (select count(*)::text from public.skylanders s
                            join public.categories c on c.id = s.category_id
                           where c.name = 'Spiele'
                             and s.display_name_override is not null)),
    ('katalogzeilen', (select count(*)::text from public.skylanders)),
    ('kategorien',   (select count(*)::text from public.categories)),
    ('spiele_zeilen', (select count(*)::text from public.skylanders s
                        join public.categories c on c.id = s.category_id
                       where c.name = 'Spiele')),
    ('hoechste_id',  coalesce((select max(sky_id) from public.skylanders
                                where sky_id < 'SKY-9000'), '(keine)')),
    ('einkaeufe',    (select count(*)::text from public.purchases where source <> 'manual')),
    ('positionen',   (select count(*)::text from public.purchase_items)),
    ('ohne_sky_id',  (select count(*)::text from public.purchase_items where sky_id is null)),
    ('lagerzeilen',  (select count(*)::text from public.shop_inventory)),
    ('einheiten',    (select coalesce(sum(quantity), 0)::text from public.shop_inventory)),
    ('bewegungen',   (select count(*)::text from public.inventory_movements)),
    ('belege',       (select count(*)::text from public.purchase_receipts)),
    ('sicherung_md5', coalesce((select md5(p.prosrc) from pg_proc p
                                 where p.oid = to_regprocedure(
                                   'public.seller_business_backup()')), '(fehlt)'));

  -- A7. Der Z0-Vertrag. Dieselben fuenf Werte wie beim Lauf 0135/0136, und
  --     `spiele_overrides` ist Spiele-bezogen — nicht katalogweit (Korrektur
  --     vom 2026-10-19).
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

  -- A8. 0137 ist noch nicht angewendet, und die vier Zubehoerkategorien sind leer.
  if to_regprocedure('public.seller_create_catalog_item(text, text, text)') is not null then
    raise exception 'ABBRUCH A8: seller_create_catalog_item steht schon — 0137 ist hier '
      'angewendet.';
  end if;
  if (select array_to_string(public.non_collectible_categories(), ',')) <> 'Spiele' then
    raise exception 'ABBRUCH A8: non_collectible_categories() ist "%", erwartet "Spiele"',
      (select array_to_string(public.non_collectible_categories(), ','));
  end if;
  select count(*) into v_zahl
    from public.skylanders s
    join public.categories c on c.id = s.category_id
   where c.name in ('Portale', 'Bundles', 'Taschen', 'Zubehör');
  if v_zahl > 0 then
    raise exception 'ABBRUCH A8: % Katalogzeile(n) stehen schon in einer Zubehoerkategorie — '
      '0137 wuerde sie aus Sammlung und Shop nehmen. Nicht fahren, erst klaeren.', v_zahl;
  end if;

  select count(*) into v_zahl from lauf_abdruck;
  raise notice 'A ok: Staging, Stand 0136, Belegsperre dicht, Z0-Vertrag erfuellt, '
    '% Bezugswerte erfasst.', v_zahl;
end $lauf_a$;


-- ---------------------------------------------------------------------------
-- B. Migration 0137 — eingebettet, Zeichen fuer Zeichen
--
-- Zwischen den beiden Markierungen steht der INHALT von
-- `supabase/migrations/0137_catalog_accessories.sql`, unveraendert. Dass
-- beides zeichengleich ist, prueft `src/lib/catalog/accessories.test.ts`
-- bei jedem Testlauf.
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


-- ---------------------------------------------------------------------------
-- C. Nachher: dieselben Werte, verglichen — und die neue Funktion geprueft
-- ---------------------------------------------------------------------------
do $lauf_c$
declare
  v_name text;
  v_ist  text;
  v_soll text;
begin
  if to_regclass('pg_temp.lauf_abdruck') is null then
    raise exception 'ABBRUCH C0: der Abdruck aus A ist fort — der Lauf war nicht EINE '
      'Transaktion.';
  end if;

  -- C1. Dieselben zwanzig Werte, unter `n_` daneben gelegt.
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
    ('n_typen',
       (select coalesce(string_agg(x.item_type || '=' || x.n::text, ',' order by x.item_type), '')
          from (select s.item_type, count(*) as n
                  from public.skylanders s group by s.item_type) x)),
    ('n_override_md5',
       (select md5(coalesce(string_agg(s.sky_id || '=' || s.display_name_override,
                                       ';' order by s.sky_id), ''))
          from public.skylanders s where s.display_name_override is not null)),
    ('n_spiele_overrides', (select count(*)::text from public.skylanders s
                              join public.categories c on c.id = s.category_id
                             where c.name = 'Spiele'
                               and s.display_name_override is not null)),
    ('n_katalogzeilen', (select count(*)::text from public.skylanders)),
    ('n_kategorien',   (select count(*)::text from public.categories)),
    ('n_spiele_zeilen', (select count(*)::text from public.skylanders s
                          join public.categories c on c.id = s.category_id
                         where c.name = 'Spiele')),
    ('n_hoechste_id',  coalesce((select max(sky_id) from public.skylanders
                                  where sky_id < 'SKY-9000'), '(keine)')),
    ('n_einkaeufe',    (select count(*)::text from public.purchases where source <> 'manual')),
    ('n_positionen',   (select count(*)::text from public.purchase_items)),
    ('n_ohne_sky_id',  (select count(*)::text from public.purchase_items where sky_id is null)),
    ('n_lagerzeilen',  (select count(*)::text from public.shop_inventory)),
    ('n_einheiten',    (select coalesce(sum(quantity), 0)::text from public.shop_inventory)),
    ('n_bewegungen',   (select count(*)::text from public.inventory_movements)),
    ('n_belege',       (select count(*)::text from public.purchase_receipts)),
    ('n_sicherung_md5', coalesce((select md5(p.prosrc) from pg_proc p
                                   where p.oid = to_regprocedure(
                                     'public.seller_business_backup()')), '(fehlt)'));

  -- C2. Und JEDER davon muss gleich sein. 0137 aendert keine Zeile.
  for v_name, v_soll, v_ist in
    select a.schluessel, a.wert, n.wert
      from lauf_abdruck a
      join lauf_abdruck n on n.schluessel = 'n_' || a.schluessel
  loop
    if v_ist is distinct from v_soll then
      raise exception 'ABBRUCH C2: % ist "%", vorher "%" — 0137 darf diesen Wert nicht '
        'bewegen.', v_name, v_ist, v_soll;
    end if;
  end loop;

  -- C3. Die Kategorieliste und die Ableitung.
  select array_to_string(public.non_collectible_categories(), ',') into v_ist;
  if v_ist <> 'Spiele,Portale,Bundles,Taschen,Zubehör' then
    raise exception 'ABBRUCH C3: non_collectible_categories() ist "%"', v_ist;
  end if;
  if public.catalog_item_type_for_category('Spiele') <> 'game'
     or public.catalog_item_type_for_category('Portale') <> 'portal'
     or public.catalog_item_type_for_category('Bundles') <> 'bundle'
     or public.catalog_item_type_for_category('Taschen') <> 'other'
     or public.catalog_item_type_for_category('Zubehör') <> 'other' then
    raise exception 'ABBRUCH C3: die Ableitung kennt die fuenf Zubehoerkategorien nicht';
  end if;

  -- C4. DIE POSITIVLISTE BLEIBT EINE POSITIVLISTE. Kein unbekannter Name wird
  --     Zubehoer, und eine Zeile ohne Kategorie auch nicht.
  foreach v_name in array array['Figuren', 'Senseis', 'Traps', 'Magic Items',
                                'Portal', 'portale', 'Starter Pack', 'Zubehoer',
                                '', 'Unbekannt'] loop
    if public.catalog_item_type_for_category(v_name) <> 'figure' then
      raise exception 'ABBRUCH C4: Kategorie "%" leitet auf % ab, erwartet figure',
        v_name, public.catalog_item_type_for_category(v_name);
    end if;
  end loop;
  if public.catalog_item_type_for_category(null) is distinct from 'figure' then
    raise exception 'ABBRUCH C4: eine Zeile ohne Kategorie leitet nicht auf figure ab';
  end if;

  -- C5. Der Trigger aus 0135 steht unveraendert.
  if not exists (select 1 from pg_trigger t
                  where not t.tgisinternal
                    and t.tgrelid = 'public.skylanders'::regclass
                    and t.tgname = 'skylanders_item_type_from_category') then
    raise exception 'ABBRUCH C5: der Trigger aus 0135 fehlt';
  end if;

  -- C6. Die neue Funktion: Form, Sicherheit, Rechte.
  if to_regprocedure('public.seller_create_catalog_item(text, text, text)') is null then
    raise exception 'ABBRUCH C6: seller_create_catalog_item fehlt';
  end if;
  select pg_get_function_arguments(p.oid) into v_ist
    from pg_proc p where p.oid = to_regprocedure(
      'public.seller_create_catalog_item(text, text, text)');
  if v_ist <> 'p_name text, p_series_code text, p_item_type text' then
    raise exception 'ABBRUCH C6: seller_create_catalog_item nimmt (%)', v_ist;
  end if;
  /*
   * DER SEARCH_PATH WIRD AUSGEPACKT, NICHT VERGLICHEN.
   *
   * `set search_path = ''` landet in `proconfig` als `search_path=""` — MIT
   * den zwei Anfuehrungszeichen, weil PostgreSQL den leeren Wert quotiert.
   * Ein `@> array['search_path=']` findet das NIE und haette diesen Lauf in
   * Abschnitt C abgebrochen, obwohl die Funktion in Ordnung ist. Dieselbe
   * Falle hat `0126`/`0129` schon einmal gestellt; die Form hier ist die
   * bewaehrte und dieselbe wie in `supabase/checks/0137_postflight.sql`.
   */
  if not exists (select 1 from pg_proc p
                  where p.oid = to_regprocedure(
                    'public.seller_create_catalog_item(text, text, text)')
                    and p.prosecdef) then
    raise exception 'ABBRUCH C6: seller_create_catalog_item ist nicht security definer';
  end if;
  select coalesce(
           (select nullif(btrim(substring(c from 'search_path=(.*)$'), '"'), '')
              from pg_proc p, unnest(coalesce(p.proconfig, '{}'::text[])) c
             where p.oid = to_regprocedure(
                     'public.seller_create_catalog_item(text, text, text)')
               and c like 'search\_path=%'),
           '(leer)') into v_ist;
  if v_ist <> '(leer)' then
    raise exception 'ABBRUCH C6: seller_create_catalog_item traegt search_path "%", '
      'erwartet leer', v_ist;
  end if;
  if has_function_privilege('anon',
       'public.seller_create_catalog_item(text, text, text)', 'execute') then
    raise exception 'ABBRUCH C6: anon darf seller_create_catalog_item ausfuehren';
  end if;
  if not has_function_privilege('authenticated',
       'public.seller_create_catalog_item(text, text, text)', 'execute') then
    raise exception 'ABBRUCH C6: authenticated darf seller_create_catalog_item NICHT ausfuehren';
  end if;
  if exists (select 1 from pg_proc p
              where p.oid = to_regprocedure(
                'public.seller_create_catalog_item(text, text, text)')
                and (p.proacl is null
                     or exists (select 1 from aclexplode(p.proacl) a
                                 where a.grantee = 0 and a.privilege_type = 'EXECUTE'))) then
    raise exception 'ABBRUCH C6: PUBLIC darf seller_create_catalog_item ausfuehren';
  end if;

  -- C7. Die Artikelauswahl liefert acht Spalten, item_type hinten.
  select string_agg(a.name, ',' order by a.ord) into v_ist
    from (select unnest(p.proargnames) as name,
                 generate_subscripts(p.proargnames, 1) as ord
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'seller_import_catalog') a;
  if v_ist <> 'sky_id,name,series_code,category,display_name,catalog_visible,is_active,item_type' then
    raise exception 'ABBRUCH C7: seller_import_catalog liefert "%"', v_ist;
  end if;
  if has_function_privilege('anon', 'public.seller_import_catalog()', 'execute') then
    raise exception 'ABBRUCH C7: anon darf seller_import_catalog ausfuehren';
  end if;

  -- C8. 0133 und 0134 sind weiter NICHT angewendet.
  if to_regprocedure('public.purchases_paid_total_is_final()') is not null
     or position('''source_row'', i.source_row' in
          coalesce((select p.prosrc from pg_proc p
                     where p.oid = to_regprocedure('public.seller_purchase(bigint)')), '')) > 0 then
    raise exception 'ABBRUCH C8: 0133 oder 0134 ist angewendet worden — dieser Lauf '
      'fasst sie nicht an';
  end if;

  -- C9. Und die Belegsperre ist unveraendert dicht.
  if exists (select 1 from (values
               ('public.seller_issue_purchase_receipt(bigint)'),
               ('public.seller_issue_purchase_receipt_correction(bigint)')) f(sig)
              cross join (values ('anon'), ('authenticated'), ('service_role')) r(n)
             where to_regprocedure(f.sig) is not null
               and has_function_privilege(r.n, f.sig, 'execute')) then
    raise exception 'ABBRUCH C9: die Belegsperre ist nicht mehr dicht';
  end if;

  raise notice 'C ok: 20 Bezugswerte unveraendert, Kategorieliste und Ableitung '
    'erweitert, seller_create_catalog_item angelegt und abgeriegelt, '
    'seller_import_catalog liefert item_type, 0133/0134 weiter offen, '
    'Belegsperre dicht.';
end $lauf_c$;


-- ---------------------------------------------------------------------------
-- D. Das Ergebnisraster — ins Protokoll uebernehmen
--
-- Erwartet: 20 Zeilen, alle `gleich`. 0137 aendert keinen dieser Werte; der
-- Zugewinn sind die neue Funktion und die erweiterte Regel, und die stehen
-- nicht in diesem Raster, sondern in C3 bis C7.
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
