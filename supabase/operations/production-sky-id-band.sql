-- ===========================================================================
-- PRODUCTION — DAS VERGABEBAND DER SKY-IDs DAUERHAFT BEGRENZEN
--            (SKY-5001 .. SKY-8999)
--
-- EINE DATEI, EINE TRANSAKTION, EINE WIRKSAME ANWEISUNG. Vollstaendig
-- markieren, in den SQL-Editor des Projekts zmiwxswrpkmizvqsgype
-- einfuegen, als `postgres` ausfuehren.
--
-- *** WAS SIE TUT ***
--
-- Sie setzt an `public.sky_id_seq` eine Unter- und eine Obergrenze. Danach
-- kann die automatische Vergabe dieser Umgebung das Band nicht mehr
-- verlassen — weder durch `nextval`, noch durch `setval`, noch durch eine
-- `security definer`-Funktion.
--
-- *** WAS SIE NICHT TUT ***
--
--   * KEINE Zeile wird angefasst. Keine Figur, kein Name, kein Preis, kein
--     Journal, kein Bild.
--   * KEINE bestehende SKY-ID aendert sich. Die Grenze gilt fuer die VERGABE,
--     nicht fuer die SPEICHERUNG — und das ist der Unterschied, auf dem der
--     Katalogabgleich beruht.
--   * KEINE CHECK-Constraint auf `skylanders.sky_id`. Eine solche waere der
--     naheliegende zweite Riegel und sie waere FALSCH: der Sync schreibt
--     absichtlich fremdbandige IDs. Eine auf Staging 928..4999 vergebene Nummer muss
--     hier unter genau dieser Nummer entstehen koennen. Eine Constraint, die
--     nur das eigene Band zuliesse, blockierte den Abgleich, fuer den die
--     Baender gebaut werden.
--   * KEINE Funktion wird geaendert. Die vier Vergabewege
--     (`admin_create_figure`, `create_figure_from_template`,
--     `seller_create_catalog_item`, die Huelle von `cat03-import`) ziehen
--     alle aus DIESER Sequenz und sind damit ohne eine Zeile Code gebunden.
--
-- *** WARUM NICHT EINFACH `setval` ***
--
-- `setval` setzt einen Startpunkt, den der naechste `setval` wieder
-- verlaesst. Eine Grenze ist eine Schranke. Nachgemessen an echtem
-- PostgreSQL am 2026-10-30, mit genau diesen Zahlen:
--
--     nextval hinter der Obergrenze   -> FEHLER `reached maximum value`
--     setval unterhalb der Grenze     -> FEHLER `value … is out of bounds`
--     setval oberhalb der Grenze      -> FEHLER `value … is out of bounds`
--     nextval ueber SECURITY DEFINER  -> FEHLER — die Grenze haengt an der
--                                        Sequenz, nicht am Aufrufer
--
-- Damit ist der reservierte System- und Testbereich ab `SKY-9000`
-- (ADR-0070) STRUKTURELL unerreichbar und nicht mehr nur per Konvention in
-- vier Funktionsruempfen.
--
-- *** WARUM `START WITH` UND `RESTART WITH` MIT IN DIE ANWEISUNG MUESSEN ***
--
-- `alter sequence … minvalue 5001` allein wird abgewiesen:
-- `START value (…) cannot be less than MINVALUE (5001)`. Der Startwert steht
-- noch auf dem alten Stand und liegt unter der neuen Untergrenze. Beide
-- muessen in dieselbe Anweisung. Auch das ist gemessen, nicht vermutet.
--
-- *** FOLGE FUER S5/S6 ***
--
-- Nach `RESTART WITH 5001` steht `is_called = false`, und der naechste Zug
-- ist `SKY-5001` SELBST — nicht einer mehr. Die korrigierte Fassung von
-- `s5`/`s6` rechnet das richtig; eine aeltere meldete hier eine Nummer zu
-- hoch.
--
-- *** TRANSAKTIONSVERHALTEN — GEMESSEN, NICHT AUS DER DOKU ZITIERT ***
--
-- Die verbreitete Annahme lautet, `RESTART` sei wie `setval` NICHT
-- transaktional und ueberlebe ein `rollback`. Waere das so, koennte ein
-- Fehler in den Nachbedingungen eine HALB umgestellte Sequenz hinterlassen:
-- Grenzen zurueckgerollt, Zaehlstand verschoben.
--
-- Am 2026-10-30 an echtem PostgreSQL (PGlite) mit genau dieser Anweisung
-- nachgemessen, Ausgangslage `last=821 called=true, min=1, max=bigint`:
--
--   in der Transaktion   last=5001 called=false | min=5001 max=8999 start=5001
--   nach ROLLBACK        last=821  called=true  | min=1    max=bigint start=1
--   nach FEHLER im DO    last=821  called=true  | min=1    max=bigint start=1
--   nach COMMIT          last=5001 called=false | min=5001 max=8999 start=5001
--   erster nextval       5001, danach last=5001 called=true
--
-- `ALTER SEQUENCE … RESTART` IST also vollstaendig transaktional. Nach einem
-- Abbruch bleibt NICHTS zurueck — weder eine verschobene Zaehlung noch halbe
-- Grenzen. Das gilt NICHT fuer `setval()`; genau deshalb benutzt diese Datei
-- `alter sequence … restart with` und nicht `setval`.
--
-- Dazu kommt: Grenzen, Startwert und Zaehlstand stehen in EINER Anweisung.
-- Es gibt also auch innerhalb des Laufs keinen Zwischenzustand, in dem etwa
-- die Untergrenze schon stuende und der Zaehlstand noch nicht.
--
-- *** KEIN `nextval` ***
--
-- Diese Datei zieht keine Nummer. `restart with 5001` SETZT den Zaehlstand
-- und laesst `is_called` auf `false` — der naechste Zug ist `SKY-5001`
-- SELBST. Weder der Lauf noch die beiden Pruefdateien rufen `nextval` auf;
-- eine Pruefung, die eine Nummer verbraucht, um zu pruefen, ob man eine
-- ziehen kann, hat die Pruefung zur Handlung gemacht.
--
-- *** DER IMPORTBEREICH BLEIBT UNBERUEHRT ***
--
-- `SKY-0822` bis `SKY-0928` liegt UNTER dem neuen Band. Das ist kein
-- Widerspruch und kein Problem: ein Band regelt die VERGABE, nicht die
-- SPEICHERUNG. `system_sync_create_figure` (0165) bekommt die SKY-ID als
-- Parameter und zieht die Sequenz nicht — die 33 Figuren entstehen also
-- weiterhin unter ihren Staging-Nummern. Diese Datei fasst keine Zeile an;
-- B-Nachbedingungen messen das.
--
-- UMGEKEHRT SCHUETZT DAS BAND DEN IMPORTBEREICH: ohne es stuende der
-- naechste Zug bei `SKY-0822` — genau der ersten Importnummer. Eine
-- gewoehnliche Figurenanlage ueber `admin_create_figure` wuerde sie ziehen
-- und dem Abgleich wegnehmen. Deshalb gehoert diese Umstellung VOR den
-- Figurenimport.
--
-- Ruecknahme: `supabase/rollback/R_production_sky_id_band.sql`.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- A0  ZWEI OBERGRENZEN, VOR DEM ERSTEN ZUGRIFF
--
-- `ALTER SEQUENCE` nimmt ACCESS EXCLUSIVE auf die Sequenz. Ein gleichzeitiges
-- `nextval` — also eine laufende Figurenanlage — wartet dann auf diese
-- Transaktion, und umgekehrt wartet diese Transaktion, falls jemand anders
-- die Sequenz gerade haelt. `lock_timeout` sorgt dafuer, dass dieser Lauf
-- nicht unbegrenzt wartet und dabei die Figurenanlage blockiert: nach fuenf
-- Sekunden bricht er ab und gibt die Sperre zurueck. Ein Abbruch kostet hier
-- nichts (siehe das Messergebnis oben).
-- ---------------------------------------------------------------------------
set local lock_timeout = '5s';
set local statement_timeout = '300s';

-- ---------------------------------------------------------------------------
-- 1. Waechter — vor der einzigen wirksamen Anweisung
-- ---------------------------------------------------------------------------
do $w$
declare
  v_last  bigint;
  v_anzahl integer;
begin
  /*
   * ======================================================================
   * A1  DER UMGEBUNGSNACHWEIS — POSITIV UND AM SCHEMA
   * ======================================================================
   *
   * *** WARUM DER ALTE STEMPEL WEG MUSSTE ***
   *
   * Er lautete: „`SKY-0821` steht, `SKY-0822` steht NICHT". Beides sind
   * ZEILEN, und der Katalogabgleich legt `SKY-0822` auf Production demnaechst
   * an — es ist die erste der 33 Figuren. Der Stempel haette sich also durch
   * den eigenen Sync selbst zerstoert, und diese Datei waere danach auf
   * Production nicht mehr lauffaehig gewesen.
   *
   * Genau derselbe Mangel wie in den Gruppen G3'-G5', nur mit umgekehrtem
   * Vorzeichen — und er ist in `prod-0165.sql` schon behoben. Hier steht
   * jetzt dasselbe Muster.
   *
   * *** WAS STATTDESSEN GEPRUEFT WIRD ***
   *
   * Zwei POSITIVE Nachweise am SCHEMA. Ein Katalogabgleich schreibt Zeilen;
   * er legt keine Triggerfunktion an und veraendert keine Sequenzgrenze.
   * Beides bleibt gueltig, nachdem `SKY-0822` importiert ist.
   *
   *   A1a/A1b  `0133` liegt — BEIDE Objekte, die Triggerfunktion
   *            `purchases_paid_total_is_final()` UND der Trigger
   *            `purchases_paid_total_immutable_trg` auf `purchases`. `0133`
   *            ist auf Production seit dem 2026-10-18 angewendet und auf
   *            Staging ausdruecklich OFFEN; Staging und Production sind
   *            bewusst nicht auf demselben Stand. Zwei Objekte, damit ein
   *            halb angewendeter Stand nicht durchgeht.
   *
   *   A1c      `sky_id_seq` traegt NICHT das Staging-Band (928 .. 4999).
   *            Eine Sequenzgrenze ist Schema und wandert durch keinen
   *            Abgleich. A2 verlangt gleich noch, dass ueberhaupt kein Band
   *            liegt — A1c sagt zusaetzlich, WELCHES es nicht sein darf, und
   *            liefert damit die lesbare Meldung.
   *
   *   A1d      Der Katalog traegt Zeilen. Gegen eine leere Datenbank.
   */
  if to_regprocedure('public.purchases_paid_total_is_final()') is null then
    raise exception 'A1a ABBRUCH: die Triggerfunktion purchases_paid_total_is_final '
      'fehlt. Sie kommt aus 0133, und 0133 liegt NUR auf Production. Diese '
      'Datenbank ist nicht Production.';
  end if;
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = to_regclass('public.purchases')
                    and t.tgname = 'purchases_paid_total_immutable_trg'
                    and not t.tgisinternal) then
    raise exception 'A1b ABBRUCH: der Trigger purchases_paid_total_immutable_trg '
      'fehlt, obwohl die Funktion aus 0133 liegt. Halb angewendeter Stand — '
      'erst klaeren.';
  end if;
  if exists (select 1 from pg_sequences
              where schemaname = 'public' and sequencename = 'sky_id_seq'
                and min_value = 928 and max_value = 4999) then
    raise exception 'A1c ABBRUCH: sky_id_seq traegt das STAGING-Band '
      '(928 .. 4999). Diese Datei ist fuer PRODUCTION — auf Staging gehoert '
      'supabase/operations/staging-sky-id-band.sql, und die ist dort gelaufen.';
  end if;
  if (select count(*) from public.skylanders) < 100 then
    raise exception 'A1d ABBRUCH: der Katalog hat weniger als 100 Zeilen — das '
      'ist kein Production-Projekt.';
  end if;

  -- A2 — die Sequenz darf nicht schon begrenzt sein. Diese Datei laeuft einmal.
  if exists (select 1 from pg_sequences
              where schemaname = 'public' and sequencename = 'sky_id_seq'
                and (min_value <> 1 or max_value <> 9223372036854775807)) then
    raise exception 'A2 ABBRUCH: die Sequenz traegt schon ein Band.';
  end if;

  /*
   * A3 — DER WICHTIGSTE: DAS BAND MUSS LEER SEIN.
   *
   * `restart with 5001` laesst den naechsten Zug 5001 treffen. Stuende im Band
   * 5001..8999 schon eine SKY-ID — in der Tabelle ODER im Journal, also auch
   * eine laengst verworfene —, vergaebe die Sequenz sie ein zweites Mal. Eine
   * SKY-ID wird NIEMALS wiederverwendet (ADR-0001, CLAUDE.md Regel 2).
   *
   * Das Journal zaehlt mit, und das ist der Unterschied zu einer Pruefung nur
   * an der Tabelle: auf Staging sind 37 Nummern gezogen und wieder
   * verschwunden, ihre Journalzeilen stehen noch.
   */
  select count(*) into v_anzahl from (
      select sky_id from public.skylanders
       where sky_id ~ '^SKY-[0-9]{4}$'
         and sky_id between 'SKY-5001' and 'SKY-8999'
    union
      select entity_id from public.catalog_admin_changes
       where entity = 'skylander' and entity_id ~ '^SKY-[0-9]{4}$'
         and entity_id between 'SKY-5001' and 'SKY-8999') q;
  if v_anzahl > 0 then
    raise exception 'A3 ABBRUCH: im Band SKY-5001..SKY-8999 stehen bereits % '
      'SKY-ID(s) — ein RESTART wuerde sie ein zweites Mal vergeben.', v_anzahl;
  end if;

  -- A4 — und die Sequenz selbst darf das Band noch nicht erreicht haben.
  select last_value into v_last from public.sky_id_seq;
  if v_last >= 5001 then
    raise exception 'A4 ABBRUCH: last_value steht bereits bei % und damit im '
      'neuen Band. Hier ist mehr gezogen worden als angenommen.', v_last;
  end if;

  /*
   * A5 — DER BESTAND, ALS NOTICE. Diese Zahlen muessen nach dem Lauf
   * unveraendert sein; `sky_id_band_postflight.sql` vergleicht sie gegen die
   * Baseline aus dem Preflight.
   */
  /*
   * UND ER WIRD ABGELEGT, NICHT NUR GEMELDET.
   *
   * DAS SCHLIESST DAS EINZIGE ZEITFENSTER DIESES LAUFS. Zwischen A4 (liest
   * `last_value`) und der `alter sequence`-Anweisung haelt niemand die
   * Sequenz; eine gleichzeitige Figurenanlage koennte dort `nextval` ziehen
   * und `SKY-0822` bekommen — genau die erste Importnummer. An der Sequenz
   * waere das hinterher nicht mehr zu sehen, denn `restart with 5001`
   * ueberschreibt den Stand.
   *
   * An der TABELLE ist es zu sehen: die neue Figur ist eine Katalogzeile und
   * eine Journalzeile. B1-B3 vergleichen beide Zahlen und die hoechste
   * SKY-ID gegen diese Ablage und brechen ab, wenn sich etwas bewegt hat.
   * Der ganze Lauf rollt dann zurueck, und zwar vollstaendig — auch die
   * Sequenz (gemessen, siehe Kopf).
   */
  perform set_config('skyisles.pband_a5',
    (select count(*) from public.skylanders)::text || '|'
    || (select count(*) from public.catalog_admin_changes)::text || '|'
    || (select count(*) from public.shop_inventory)::text || '|'
    || (select count(*) from public.collection_items)::text || '|'
    || (select coalesce(max(sky_id), '(leer)') from public.skylanders
         where sky_id ~ '^SKY-[0-8][0-9]{3}$'), true);

  raise notice 'A5: % Katalogzeilen, % Journalzeilen, % Lagerzeilen, % '
    'Sammlungszeilen, hoechste SKY-ID %. Sequenz bei % (is_called %). Nach '
    'diesem Lauf muss jede dieser Zahlen gleich sein.',
    (select count(*) from public.skylanders),
    (select count(*) from public.catalog_admin_changes),
    (select count(*) from public.shop_inventory),
    (select count(*) from public.collection_items),
    (select coalesce(max(sky_id), '(leer)') from public.skylanders
      where sky_id ~ '^SKY-[0-8][0-9]{3}$'),
    v_last, (select is_called from public.sky_id_seq);
end
$w$;


-- ---------------------------------------------------------------------------
-- 2. Die eine wirksame Anweisung
-- ---------------------------------------------------------------------------
alter sequence public.sky_id_seq
  minvalue 5001
  maxvalue 8999
  no cycle
  start with 5001
  restart with 5001;

-- ---------------------------------------------------------------------------
-- 3. Nachbedingungen
-- ---------------------------------------------------------------------------
do $n$
declare
  v_min bigint; v_max bigint; v_cyc boolean; v_last bigint; v_called boolean;
  v_a5 text; v_t text[]; v_ist text;
begin
  /*
   * B1-B3 ZUERST: hat sich waehrend des Laufs eine Zeile bewegt?
   *
   * Siehe die Begruendung an A5. Eine gleichzeitige Figurenanlage im Fenster
   * vor der `alter sequence`-Anweisung ist an der Sequenz nicht mehr
   * erkennbar — an Katalog, Journal und hoechster SKY-ID schon.
   */
  v_a5 := current_setting('skyisles.pband_a5', true);
  if v_a5 is null then
    raise exception 'ABBRUCH B0: die Ablage aus A5 fehlt. Dieser Lauf ist '
      'nicht vollstaendig durch die Waechter gegangen.';
  end if;
  v_t := string_to_array(v_a5, '|');

  v_ist := (select count(*) from public.skylanders)::text;
  if v_ist <> v_t[1] then
    raise exception 'ABBRUCH B1: Katalogzeilen % statt %. Waehrend dieses Laufs '
      'ist eine Figur entstanden — moeglicherweise mit einer Nummer aus dem '
      'Importbereich. Alles wird zurueckgerollt.', v_ist, v_t[1];
  end if;
  v_ist := (select count(*) from public.catalog_admin_changes)::text;
  if v_ist <> v_t[2] then
    raise exception 'ABBRUCH B2: Journalzeilen % statt %.', v_ist, v_t[2];
  end if;
  v_ist := (select coalesce(max(sky_id), '(leer)') from public.skylanders
             where sky_id ~ '^SKY-[0-8][0-9]{3}$');
  if v_ist <> v_t[5] then
    raise exception 'ABBRUCH B3: die hoechste SKY-ID ist % statt %. Es ist '
      'waehrend des Laufs eine Nummer vergeben worden.', v_ist, v_t[5];
  end if;
  if (select count(*) from public.shop_inventory)::text <> v_t[3]
     or (select count(*) from public.collection_items)::text <> v_t[4] then
    raise exception 'ABBRUCH B4: Lager- oder Sammlungszeilen haben sich '
      'bewegt. Diese Datei fasst keine Zeile an.';
  end if;

  select min_value, max_value, cycle into v_min, v_max, v_cyc
    from pg_sequences where schemaname = 'public' and sequencename = 'sky_id_seq';
  select last_value, is_called into v_last, v_called from public.sky_id_seq;

  if v_min <> 5001 or v_max <> 8999 then
    raise exception 'Nachbedingung: das Band ist % .. %, erwartet % .. %.',
      v_min, v_max, 5001, 8999;
  end if;
  if v_cyc then
    raise exception 'Nachbedingung: CYCLE ist an — die Sequenz liefe um.';
  end if;
  if v_called then
    raise exception 'Nachbedingung: is_called ist true — der erste Zug waere % '
      'statt %.', v_last + 1, 5001;
  end if;
  if v_last <> 5001 then
    raise exception 'Nachbedingung: last_value ist %, erwartet %.', v_last, 5001;
  end if;

  raise notice 'ok: Band % .. %, NO CYCLE, is_called false — der naechste Zug '
    'ist SKY-5001. KEINE Zeile wurde angefasst, und waehrend des Laufs ist '
    'keine Nummer vergeben worden (B1-B4 gegen die Ablage aus A5).',
    v_min, v_max;
end
$n$;

commit;
