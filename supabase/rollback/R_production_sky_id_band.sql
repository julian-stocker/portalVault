-- ===========================================================================
-- PRODUCTION — RUECKNAHME DER SKY-ID-BEREICHSSPERRE
--
-- ###########################################################################
-- ##  DIES IST EINE PRODUCTION-DATEI. Projekt zmiwxswrpkmizvqsgype.        ##
-- ##  Sie bricht auf Staging ab, und zwar bevor sie etwas anfasst.         ##
-- ###########################################################################
--
-- Nimmt zurueck, was `supabase/operations/production-sky-id-band.sql`
-- gesetzt hat. Als `postgres` im SQL-Editor.
--
-- ===========================================================================
-- DER URSPRUNGSZUSTAND, FESTGEHALTEN
-- ===========================================================================
--
-- Gemessen am 2026-10-30 mit `supabase/checks/prod_0159_0165_state.sql` und
-- mit `prod_0165_postflight.sql`, beide als `postgres` im Production-Editor:
--
--     min_value    1
--     max_value    9223372036854775807
--     cycle        false  (NO CYCLE)
--     start_value  1
--     last_value   821
--     is_called    true      -> der naechste Zug waere SKY-0822 gewesen
--
-- Dazu der Bestand zum selben Zeitpunkt: 624 Katalogzeilen, 217
-- Journalzeilen, 340 Lagerzeilen, 622 Sammlungszeilen, 95 Favoriten, 0
-- Warenkoerbe, 2 Bestellpositionen, Katalogabdruck
-- `95bbbb51bd6ca2fd9d0be184b22bfda4`.
--
-- Diese Datei stellt `1 .. 9223372036854775807`, `start with 1` und
-- `restart with 821` (is_called true) wieder her — also genau den Zustand
-- oben. Die Zahl steht NICHT fest eingetragen: sie wird verlangt, siehe A5.
--
-- ===========================================================================
-- WANN SIE LAUFEN DARF — UND WANN NICHT
-- ===========================================================================
--
-- SIE DARF NICHT LAUFEN, sobald unter dem Band eine SKY-ID vergeben wurde.
--
-- Der Grund ist nicht Vorsicht, sondern ADR-0001: eine SKY-ID wird niemals
-- wiederverwendet. Stuende im Band `SKY-5001`..`SKY-8999` schon eine Nummer
-- — in der Tabelle ODER im Journal, also auch eine laengst verworfene — und
-- diese Datei setzte die Zaehlung auf 821 zurueck, dann vergaebe die Sequenz
-- spaeter dieselbe Nummer ein zweites Mal. A3 bricht deshalb ab, und zwar
-- OHNE Ausweg: es gibt keinen Schalter, der das uebergeht.
--
-- WER IN DIESEM ZUSTAND NUR DIE GRENZEN LOESEN WILL, nimmt nicht diese
-- Datei. Er nimmt eine eigene Anweisung mit dem AKTUELLEN `last_value`:
--
--     alter sequence public.sky_id_seq
--       minvalue 1 maxvalue 9223372036854775807
--       start with 1 restart with <aktueller last_value>;
--
-- und traegt in `APPLIED.md` ein, warum. Das ist dann keine Ruecknahme mehr,
-- sondern eine zweite Entscheidung.
--
-- ===========================================================================
-- DIE VORAUSSETZUNGEN, EINZELN
-- ===========================================================================
--
--   A1  Die Umgebung ist Production — POSITIV und am Schema: `0133` mit
--       beiden Objekten, und die Sequenz traegt nicht das Staging-Band.
--       KEIN Zeilenstempel: `SKY-0821` und `SKY-0822` taugen dafuer nicht
--       mehr, seit der Abgleich `SKY-0822` dort anlegt.
--   A2  Das Band liegt ueberhaupt. Ohne es gibt es nichts zurueckzunehmen.
--   A3  IM BAND IST KEINE NUMMER VERGEBEN — Tabelle UND Journal.
--   A4  Die Sequenz steht noch auf dem Startwert und hat nicht gezogen
--       (`last_value = 5001`, `is_called = false`). Hat sie gezogen, ist
--       eine Nummer verbraucht, auch wenn die Zeile wieder verworfen wurde.
--   A5  Die Zielzahl ist ANGEGEBEN. Sie wird nicht geraten:
--
--           select set_config('skyisles.zurueck', '821', true);
--
--       in DERSELBEN Klammer davor. `821` ist der oben festgehaltene
--       Ursprungswert; wer einen anderen Stand wiederherstellen will, setzt
--       seinen eigenen.
--   A6  Der Bestand wird abgelegt und in B gegen sich selbst gehalten —
--       dasselbe Fenster wie beim Setzen: zwischen A4 und der Anweisung
--       koennte eine gleichzeitige Figurenanlage ziehen. An der Sequenz
--       waere das hinterher nicht mehr zu sehen, an der Tabelle schon.
--
-- Transaktionsverhalten: `ALTER SEQUENCE … RESTART` ist vollstaendig
-- transaktional (am 2026-10-30 an echtem PostgreSQL gemessen, siehe den Kopf
-- von `production-sky-id-band.sql`). Ein Abbruch laesst nichts zurueck.
-- ===========================================================================

begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';

do $w$
declare
  v_zurueck bigint;
  v_min     bigint;
  v_max     bigint;
  v_last    bigint;
  v_called  boolean;
  v_im_band bigint;
begin
  -- A1a/A1b — Production, positiv und am Schema.
  if to_regprocedure('public.purchases_paid_total_is_final()') is null then
    raise exception 'A1a ABBRUCH: die Triggerfunktion aus 0133 fehlt. 0133 liegt '
      'NUR auf Production — diese Datenbank ist nicht Production.';
  end if;
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = to_regclass('public.purchases')
                    and t.tgname = 'purchases_paid_total_immutable_trg'
                    and not t.tgisinternal) then
    raise exception 'A1b ABBRUCH: der Trigger aus 0133 fehlt, obwohl die Funktion '
      'liegt. Halb angewendeter Stand — erst klaeren.';
  end if;

  select min_value, max_value into v_min, v_max from pg_sequences
   where schemaname = 'public' and sequencename = 'sky_id_seq';
  if v_min = 928 and v_max = 4999 then
    raise exception 'A1c ABBRUCH: sky_id_seq traegt das STAGING-Band. Diese '
      'Datei ist fuer PRODUCTION; auf Staging gehoert '
      'supabase/rollback/R_staging_sky_id_band.sql.';
  end if;

  -- A2 — es gibt ueberhaupt etwas zurueckzunehmen.
  if v_min <> 5001 or v_max <> 8999 then
    raise exception 'A2 ABBRUCH: das Band ist % .. %, erwartet 5001 .. 8999. '
      'Hier ist die Production-Bereichssperre nicht gesetzt.', v_min, v_max;
  end if;

  /*
   * A3 — DER WICHTIGSTE. Tabelle UND Journal: eine Nummer, die gezogen und
   * wieder verworfen wurde, steht nur noch im Journal und ist trotzdem
   * verbraucht (ADR-0001).
   */
  select count(*) into v_im_band from (
      select sky_id from public.skylanders
       where sky_id ~ '^SKY-[0-9]{4}$'
         and sky_id between 'SKY-5001' and 'SKY-8999'
    union
      select entity_id from public.catalog_admin_changes
       where entity = 'skylander' and entity_id ~ '^SKY-[0-9]{4}$'
         and entity_id between 'SKY-5001' and 'SKY-8999') q;
  if v_im_band > 0 then
    raise exception 'A3 ABBRUCH: im Band SKY-5001..SKY-8999 stehen bereits % '
      'SKY-ID(s). Ein Zuruecksetzen der Zaehlung vergaebe sie ein zweites Mal '
      '(ADR-0001). Diese Datei ist hier die falsche — siehe ihren Kopf.',
      v_im_band;
  end if;

  /*
   * A4 — UND DIE SEQUENZ HAT NICHT GEZOGEN. `is_called = false` ist der
   * Beweis: nach `restart with 5001` steht sie so, und der erste `nextval`
   * setzt sie auf `true`. Ist sie true, ist SKY-5001 verbraucht — auch wenn
   * A3 nichts findet, weil die Zeile nie geschrieben oder wieder geloescht
   * wurde.
   */
  select last_value, is_called into v_last, v_called from public.sky_id_seq;
  if v_called or v_last <> 5001 then
    raise exception 'A4 ABBRUCH: die Sequenz steht auf % (is_called %). Erwartet '
      '5001 mit is_called false. Es ist unter dem Band schon gezogen worden; '
      'die Nummer ist verbraucht und kommt nicht zurueck.', v_last, v_called;
  end if;

  -- A5 — die Zielzahl ist angegeben und liegt unter dem Band.
  v_zurueck := nullif(btrim(coalesce(current_setting('skyisles.zurueck', true), '')), '')::bigint;
  if v_zurueck is null then
    raise exception 'A5 ABBRUCH: skyisles.zurueck ist nicht gesetzt. Der '
      'Ursprungswert ist 821 (im Kopf dieser Datei festgehalten); er wird '
      'angegeben, nicht geraten.';
  end if;
  if v_zurueck >= 5001 then
    raise exception 'A5b ABBRUCH: % liegt im Band. Das war nicht der Stand vor '
      'der Sperre.', v_zurueck;
  end if;
  if v_zurueck < (select coalesce(max(substring(sky_id from 5)::integer), 0)
                    from public.skylanders where sky_id ~ '^SKY-[0-8][0-9]{3}$') then
    raise exception 'A5c ABBRUCH: % liegt UNTER der hoechsten vergebenen '
      'SKY-ID. Die Sequenz wuerde eine bereits vergebene Nummer erneut '
      'liefern (ADR-0001).', v_zurueck;
  end if;

  -- A6 — der Bestand, abgelegt fuer B.
  perform set_config('skyisles.pband_r',
    (select count(*) from public.skylanders)::text || '|'
    || (select count(*) from public.catalog_admin_changes)::text || '|'
    || (select coalesce(max(sky_id), '(leer)') from public.skylanders
         where sky_id ~ '^SKY-[0-8][0-9]{3}$'), true);

  raise notice 'A6: Band % .. % wird geloest, Zaehlung auf % zurueckgesetzt. '
    'Bestand %', v_min, v_max, v_zurueck, current_setting('skyisles.pband_r', true);
end
$w$;

-- ---------------------------------------------------------------------------
-- Die eine wirksame Anweisung. `format`, weil die Zielzahl eine Angabe ist.
-- ---------------------------------------------------------------------------
do $r$
declare v_zurueck bigint := current_setting('skyisles.zurueck', true)::bigint;
begin
  execute format('alter sequence public.sky_id_seq minvalue 1 maxvalue %s '
                 'start with 1 restart with %s',
                 9223372036854775807::text, v_zurueck::text);
  -- `restart with n` setzt is_called auf false; der Ursprung hatte true.
  perform setval('public.sky_id_seq', v_zurueck, true);
end
$r$;

-- ---------------------------------------------------------------------------
-- Nachbedingungen
-- ---------------------------------------------------------------------------
do $n$
declare
  v_min bigint; v_max bigint; v_last bigint; v_called boolean;
  v_a6 text; v_t text[];
begin
  v_a6 := current_setting('skyisles.pband_r', true);
  if v_a6 is null then
    raise exception 'ABBRUCH B0: die Ablage aus A6 fehlt.';
  end if;
  v_t := string_to_array(v_a6, '|');

  if (select count(*) from public.skylanders)::text <> v_t[1]
     or (select count(*) from public.catalog_admin_changes)::text <> v_t[2] then
    raise exception 'ABBRUCH B1: Katalog- oder Journalzeilen haben sich waehrend '
      'des Laufs bewegt. Alles wird zurueckgerollt.';
  end if;
  if (select coalesce(max(sky_id), '(leer)') from public.skylanders
       where sky_id ~ '^SKY-[0-8][0-9]{3}$') <> v_t[3] then
    raise exception 'ABBRUCH B2: die hoechste SKY-ID hat sich bewegt — waehrend '
      'des Laufs ist eine Nummer vergeben worden.';
  end if;

  select min_value, max_value into v_min, v_max from pg_sequences
   where schemaname = 'public' and sequencename = 'sky_id_seq';
  select last_value, is_called into v_last, v_called from public.sky_id_seq;

  if v_min <> 1 or v_max <> 9223372036854775807 then
    raise exception 'Nachbedingung: die Grenzen stehen noch (% .. %).', v_min, v_max;
  end if;
  if v_last <> current_setting('skyisles.zurueck', true)::bigint or not v_called then
    raise exception 'Nachbedingung: die Sequenz steht auf % (is_called %), '
      'erwartet % mit is_called true.', v_last, v_called,
      current_setting('skyisles.zurueck', true);
  end if;

  raise notice 'ok: Grenzen geloest, Sequenz bei % (is_called true). Der '
    'reservierte Bereich ab SKY-9000 ist damit wieder NUR per Konvention '
    'geschuetzt (ADR-0070), nicht mehr strukturell. KEINE Zeile wurde '
    'angefasst.', v_last;
end
$n$;

commit;
