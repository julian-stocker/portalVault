-- ===========================================================================
-- STAGING — EIN LAUF FUER 0137 UND 0138
--            (Zubehoer wird ein Katalogartikel, und die 21 Portale entstehen)
--
-- EINE DATEI, EINE TRANSAKTION, EIN EINFUEGEN. Vollstaendig markieren, in den
-- SQL-Editor des Staging-Projekts qqxcpesbwfxzgytkdsac einfuegen, ausfuehren.
-- Nichts in Teilen, nichts nachtraeglich: jede Zeile gehoert zur selben
-- Klammer, und ein Fehler irgendwo rollt ALLES zurueck — die 21 Portale, die
-- sechs Kategorien, die Funktionsdefinitionen.
--
-- WAS DER LAUF TUT
--
--   A   Vorpruefung: Umgebungsstempel, Transaktionsklammer, 0135 UND 0136 sind
--       angewendet, 0133/0134 sind es NICHT, Belegsperre dicht, 20
--       Bezugswerte, der Z0-Vertrag, die vier Zubehoerkategorien sind leer —
--       und der ZB-Bereich SKY-0615..SKY-0642 ist frei.
--   B   Migration 0137, Zeichen fuer Zeichen aus
--       `supabase/migrations/0137_catalog_accessories.sql`: die Kategorieregel,
--       die Anlegefunktion fuer den Betrieb, `item_type` in der Artikelsuche.
--       Legt KEINEN Artikel an.
--   B2  Migration 0138, Zeichen fuer Zeichen aus
--       `supabase/migrations/0138_catalog_portals.sql`: die 21 Portale der
--       Arbeitsmappe mit den SKY-IDs des Betreibers.
--   C   Nachpruefung: dieselben 20 Bezugswerte erneut und verglichen — zwei
--       davon mit einer ERWARTETEN Differenz —, die neue Funktion in Form und
--       Rechten, die Ableitung als Positivliste, die 21 Portale Zeile fuer
--       Zeile, 0133/0134 weiter offen, Belegsperre weiter dicht.
--   D   Ein Ergebnisraster vorher/nachher zum Uebernehmen ins Protokoll.
--
-- WARUM BEIDE ZUSAMMEN, UND WARUM DAS SICHER IST
--
-- Die Reihenfolge ist zwingend: `0138` setzt `0137` voraus. Ohne die
-- erweiterte Kategorieliste waere das erste Portal in dem Augenblick, in dem
-- es entsteht, eine sammelbare, shopfaehige Figur — in der
-- Sammlungsstatistik, in `shop_offers()`, im oeffentlichen Katalog. In EINER
-- Transaktion kann das nicht passieren: die Regel ist zuerst da, und
-- `0138` fragt sie ausdruecklich ab, bevor sie eine Zeile schreibt.
--
-- Und ein Abbruch laesst keinen Zwischenstand zurueck. Es gibt also keinen
-- Zeitpunkt, an dem jemand ein halb eingefuehrtes Portal sehen koennte.
--
-- WAS ER NICHT TUT
--
--   * Keine Figur anlegen und keine SKY-ID ziehen. Die 21 Nummern sind vom
--     Betreiber vergeben und werden uebernommen; `sky_id_seq` bleibt stehen,
--     und C prueft das.
--   * Keine Disney-Infinity-Zeile, kein Bundle, keine Tasche, nicht die
--     Beleg-URL `SKY-0638` (ADR-0128, Punkt 9).
--   * Keine historische Einkaufsposition umhaengen.
--   * Keine Lagerzeile, keine Bewegung, keinen Preis, kein Bild.
--   * Keine Belegausstellung, keine Belegkorrektur, keinen Belegzaehler
--     anfassen. RECEIPT_ISSUANCE_RELEASED bleibt false.
--   * Nichts an Production. Diese Datei bricht auf jeder Datenbank ab, die
--     den Staging-Stempel nicht traegt.
--
-- ERWARTETES ERGEBNIS: das Raster in D zeigt 20 Zeilen. 17 davon `gleich`,
-- und DREI mit einer erwarteten Differenz:
--
--   katalogzeilen   + 21          (die Portale)
--   kategorien      +  6          (eine Kategorie `Portale` je Serie)
--   typen           + portal=21   (und sonst nichts: C prueft die Verteilung
--                                  ohne den ZB-Bereich gegen die von vorher)
--
-- Jede andere Abweichung ist ein Befund, und C bricht dann von selbst ab.
--
-- BEI EINEM FEHLER: die Transaktion ist abgebrochen und jede weitere
-- Anweisung meldet 25P02. Dann `rollback;` ausfuehren, die Meldung notieren
-- und nichts weiter versuchen. Es bleibt nichts zurueck.
--
-- NACH DEM LAUF: `supabase/checks/inventory_accessories_readonly.sql` zeigt,
-- was die Lageruebersicht ab jetzt benennt — darunter die 13 Lagerzeilen auf
-- Spielen.
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

  -- A9. 0138 ist noch nicht angewendet, und der ZB-Bereich gehoert der
  --     Arbeitsmappe. Geprueft wird der GANZE Bereich, nicht nur die 21
  --     Nummern: steht dort irgendeine Zeile, hat jemand ihn anders benutzt
  --     als die Mappe ihn fuehrt — und dann ist dieser Lauf der falsche
  --     Schritt, auch wenn die 21 selbst noch frei waeren.
  select count(*) into v_zahl from public.skylanders
   where sky_id between 'SKY-0615' and 'SKY-0642';
  if v_zahl > 0 then
    raise exception 'ABBRUCH A9: % Zeile(n) stehen schon im Bereich SKY-0615..SKY-0642 — '
      'der Bereich gehoert der Arbeitsmappe, und eine SKY-ID wird nie neu vergeben. '
      'Nicht fahren, erst klaeren.', v_zahl;
  end if;
  if exists (select 1 from public.categories where name = 'Portale') then
    raise exception 'ABBRUCH A9: es gibt schon eine Kategorie "Portale" — 0138 ist hier '
      'ganz oder teilweise angewendet.';
  end if;
  -- Und die sechs Serien, in denen ein Portal steht, muessen es geben.
  if (select count(*) from public.series
       where code in ('SA', 'G', 'SF', 'T', 'SC', 'I')) <> 6 then
    raise exception 'ABBRUCH A9: nicht alle sechs Serien der Portale sind vorhanden.';
  end if;

  select count(*) into v_zahl from lauf_abdruck;
  raise notice 'A ok: Staging, Stand 0136, Belegsperre dicht, Z0-Vertrag erfuellt, '
    'ZB-Bereich frei, % Bezugswerte erfasst.', v_zahl;
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
-- B2. Migration 0138 — eingebettet, Zeichen fuer Zeichen
--
-- Zwischen den beiden Markierungen steht der INHALT von
-- `supabase/migrations/0138_catalog_portals.sql`, unveraendert. Sie bringt
-- ihre eigene Vor- und Nachpruefung mit; beide laufen hier mit, und ihre
-- Vorbedingung fragt `0137` nach seiner WIRKUNG — also nach der Regel, die
-- Abschnitt B gerade angelegt hat.
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

  -- C2. Und jeder davon muss gleich sein — mit genau ZWEI Ausnahmen, und die
  --     sind benannt und beziffert, nicht ausgenommen.
  --
  --     `0137` bewegt keinen dieser Werte. `0138` legt 21 Katalogzeilen und
  --     sechs Kategorien an, und genau das sind die beiden Differenzen.
  --     Steht dort eine andere Zahl, ist es ein Befund: eine Zeile mehr
  --     hiesse, dass etwas angelegt wurde, das niemand wollte.
  for v_name, v_soll, v_ist in
    select a.schluessel, a.wert, n.wert
      from lauf_abdruck a
      join lauf_abdruck n on n.schluessel = 'n_' || a.schluessel
  loop
    if v_name = 'katalogzeilen' then
      if v_ist::integer <> v_soll::integer + 21 then
        raise exception 'ABBRUCH C2: katalogzeilen ist %, erwartet % + 21 (die Portale).',
          v_ist, v_soll;
      end if;
    elsif v_name = 'kategorien' then
      if v_ist::integer <> v_soll::integer + 6 then
        raise exception 'ABBRUCH C2: kategorien ist %, erwartet % + 6 (eine Kategorie '
          '"Portale" je Serie).', v_ist, v_soll;
      end if;
    elsif v_name = 'typen' then
      /*
       * DIE DRITTE ERWARTETE DIFFERENZ: 21 Zeilen mehr vom Typ `portal`.
       *
       * Verglichen wird nicht die Zeichenkette gegen eine erwartete Form —
       * stand vorher kein `portal` darin, waere der Schluessel neu, und eine
       * Erwartung ueber die Sortierreihenfolge waere raterei. Stattdessen
       * wird die Verteilung OHNE den ZB-Bereich neu gebildet: sie muss genau
       * die von vorher sein. Damit faellt auch auf, wenn eine Zeile
       * AUSSERHALB der 21 ihren Artikeltyp geaendert haette.
       */
      if (select coalesce(string_agg(x.item_type || '=' || x.n::text, ',' order by x.item_type), '')
            from (select s.item_type, count(*) as n
                    from public.skylanders s
                   where s.sky_id not between 'SKY-0615' and 'SKY-0642'
                   group by s.item_type) x) is distinct from v_soll then
        raise exception 'ABBRUCH C2: die Artikeltypverteilung ist ohne die 21 Portale '
          '"%", vorher "%".',
          (select coalesce(string_agg(x.item_type || '=' || x.n::text, ',' order by x.item_type), '')
             from (select s.item_type, count(*) as n
                     from public.skylanders s
                    where s.sky_id not between 'SKY-0615' and 'SKY-0642'
                    group by s.item_type) x),
          v_soll;
      end if;
      if (select count(*) from public.skylanders
           where sky_id between 'SKY-0615' and 'SKY-0642' and item_type = 'portal') <> 21 then
        raise exception 'ABBRUCH C2: nicht alle 21 neuen Zeilen tragen item_type = portal.';
      end if;
    elsif v_ist is distinct from v_soll then
      raise exception 'ABBRUCH C2: % ist "%", vorher "%" — dieser Lauf darf diesen Wert '
        'nicht bewegen.', v_name, v_ist, v_soll;
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

  -- C10. DIE 21 PORTALE: da, und genau das, was sie sein sollen.
  if (select count(*) from public.skylanders
       where sky_id between 'SKY-0615' and 'SKY-0642') <> 21 then
    raise exception 'ABBRUCH C10: % Zeile(n) im ZB-Bereich, erwartet 21',
      (select count(*) from public.skylanders
        where sky_id between 'SKY-0615' and 'SKY-0642');
  end if;
  if exists (select 1 from public.skylanders
              where sky_id in ('SKY-0623', 'SKY-0631', 'SKY-0638',
                               'SKY-0639', 'SKY-0640', 'SKY-0641', 'SKY-0642')) then
    raise exception 'ABBRUCH C10: eine Zeile ausserhalb der 21 ist entstanden — '
      'Disney Infinity, Bundle, Tasche oder die Beleg-URL (ADR-0128, Punkt 9)';
  end if;
  if exists (select 1 from public.skylanders
              where sky_id between 'SKY-0615' and 'SKY-0642'
                and (item_type <> 'portal' or catalog_visible or not is_active
                     or market_price is not null or display_name_override is not null
                     or source <> 'admin' or card_type <> 'standard')) then
    raise exception 'ABBRUCH C10: eine Portalzeile ist nicht portal / unsichtbar / aktiv / '
      'preislos / ohne Override / source=admin / card_type=standard';
  end if;
  if (select count(*) from public.categories where name = 'Portale') <> 6 then
    raise exception 'ABBRUCH C10: % Kategorien "Portale", erwartet 6',
      (select count(*) from public.categories where name = 'Portale');
  end if;
  if exists (select 1 from public.skylanders s
              join public.categories c on c.id = s.category_id
             where s.sky_id between 'SKY-0615' and 'SKY-0642'
               and (c.name <> 'Portale' or c.series_code <> s.series_code)) then
    raise exception 'ABBRUCH C10: eine Portalzeile steht nicht in der Kategorie "Portale" '
      'ihrer eigenen Serie';
  end if;
  select s.series_code into v_ist from public.skylanders s where s.sky_id = 'SKY-0637';
  if v_ist <> 'SF' then
    raise exception 'ABBRUCH C10: SKY-0637 traegt die Serie "%", erwartet SF '
      '(Entscheidung des Betreibers, 2026-10-20)', v_ist;
  end if;
  select s.name into v_ist from public.skylanders s where s.sky_id = 'SKY-0615';
  if v_ist <> '84157790 (SA)' then
    raise exception 'ABBRUCH C10: der Rohname von SKY-0615 ist "%", erwartet '
      '"84157790 (SA)" — ein Name wurde veraendert', v_ist;
  end if;

  -- C11. KEIN PORTAL IST WARE, und zwar aus zwei unabhaengigen Gruenden.
  if exists (select 1 from public.skylanders s
              where s.sky_id between 'SKY-0615' and 'SKY-0642'
                and public.is_shop_eligible(s.sky_id)) then
    raise exception 'ABBRUCH C11: ein Portal ist shopfaehig';
  end if;
  if exists (select 1 from public.skylanders s
               join public.categories c on c.id = s.category_id
              where s.sky_id between 'SKY-0615' and 'SKY-0642'
                and not (c.name = any (public.non_collectible_categories()))) then
    raise exception 'ABBRUCH C11: ein Portal steht in einer sammelbaren Kategorie';
  end if;
  if exists (select 1 from public.shop_offers() o
              where o.sky_id between 'SKY-0615' and 'SKY-0642') then
    raise exception 'ABBRUCH C11: ein Portal steht im oeffentlichen Angebot';
  end if;

  -- C12. UND DIE SEQUENZ STEHT NOCH, WO SIE STAND. 21 uebernommene Nummern
  --      brauchen keine Ausgabe; eine verschobene Sequenz waere der Beweis,
  --      dass doch eine SKY-ID erzeugt wurde.
  if (select a.wert from lauf_abdruck a where a.schluessel = 'hoechste_id')
     is distinct from (select n.wert from lauf_abdruck n where n.schluessel = 'n_hoechste_id')
  then
    raise exception 'ABBRUCH C12: die hoechste SKY-ID unter SKY-9000 hat sich bewegt';
  end if;
  if (select count(*) from public.catalog_admin_changes j
       where j.entity = 'skylander' and j.field = 'created'
         and j.entity_id between 'SKY-0615' and 'SKY-0642') <> 21 then
    raise exception 'ABBRUCH C12: es gibt nicht 21 Journaleintraege "created" fuer die '
      'neuen Portale';
  end if;

  raise notice 'C ok: 17 Bezugswerte unveraendert, katalogzeilen + 21, kategorien + 6 '
    'und typen + portal=21 '
    'wie erwartet, Kategorieliste und Ableitung erweitert, '
    'seller_create_catalog_item angelegt und abgeriegelt, seller_import_catalog '
    'liefert item_type, 21 Portale angelegt und weder sammelbar noch shopfaehig, '
    'sky_id_seq unberuehrt, 0133/0134 weiter offen, Belegsperre dicht.';
end $lauf_c$;


-- ---------------------------------------------------------------------------
-- D. Das Ergebnisraster — ins Protokoll uebernehmen
--
-- Erwartet: 20 Zeilen. 17 `gleich`, und drei mit einer ERWARTETEN Differenz:
-- `katalogzeilen` + 21, `kategorien` + 6 und `typen` um `portal=21`. Die
-- Spalte `befund` sagt es selbst, damit das Raster ohne Nebenrechnung ins
-- Protokoll kann.
--
-- Jede Zeile `GEAENDERT` ist ein Befund — und C waere dann schon abgebrochen;
-- dieses Raster ist die Lesefassung, nicht die Pruefung.
-- ---------------------------------------------------------------------------
select
  a.schluessel                                  as gegenstand,
  a.wert                                        as vorher,
  n.wert                                        as nachher,
  case
    when a.schluessel = 'katalogzeilen' then
      case when n.wert::integer = a.wert::integer + 21
           then 'erwartet + 21' else 'GEAENDERT' end
    when a.schluessel = 'kategorien' then
      case when n.wert::integer = a.wert::integer + 6
           then 'erwartet + 6' else 'GEAENDERT' end
    when a.schluessel = 'typen' then
      case when (select coalesce(string_agg(x.item_type || '=' || x.n::text,
                                            ',' order by x.item_type), '')
                   from (select s.item_type, count(*) as n
                           from public.skylanders s
                          where s.sky_id not between 'SKY-0615' and 'SKY-0642'
                          group by s.item_type) x) is not distinct from a.wert
           then 'erwartet + portal=21' else 'GEAENDERT' end
    when a.wert is not distinct from n.wert then 'gleich'
    else 'GEAENDERT'
  end                                           as befund
from lauf_abdruck a
join lauf_abdruck n on n.schluessel = 'n_' || a.schluessel
order by a.schluessel;

commit;
