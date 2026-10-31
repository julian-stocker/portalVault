-- ===========================================================================
-- STAGING — DAS VERGABEBAND DER SKY-IDs DAUERHAFT BEGRENZEN
--            (SKY-0928 .. SKY-4999)
--
-- EINE DATEI, EINE TRANSAKTION, EINE WIRKSAME ANWEISUNG. Vollstaendig
-- markieren, in den SQL-Editor des Projekts qqxcpesbwfxzgytkdsac
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
--     absichtlich fremdbandige IDs. Eine auf Production 5001..8999 vergebene Nummer muss
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
-- `alter sequence … minvalue 928` allein wird abgewiesen:
-- `START value (…) cannot be less than MINVALUE (928)`. Der Startwert steht
-- noch auf dem alten Stand und liegt unter der neuen Untergrenze. Beide
-- muessen in dieselbe Anweisung. Auch das ist gemessen, nicht vermutet.
--
-- *** FOLGE FUER S5/S6 ***
--
-- Nach `RESTART WITH 928` steht `is_called = false`, und der naechste Zug
-- ist `SKY-0928` SELBST — nicht einer mehr. Die korrigierte Fassung von
-- `s5`/`s6` rechnet das richtig; eine aeltere meldete hier eine Nummer zu
-- hoch.
--
-- Ruecknahme: `supabase/rollback/R_staging_sky_id_band.sql`.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Waechter — vor der einzigen wirksamen Anweisung
-- ---------------------------------------------------------------------------
do $w$
declare
  v_last  bigint;
  v_anzahl integer;
begin
  /*
   * A1 — DIE RICHTIGE UMGEBUNG, an einem Stempel, den ein Katalogabgleich
   * NICHT bewegt.
   *
   * Die erste Fassung nahm dafuer die hoechste je gezogene SKY-ID. Ein Test
   * hat gezeigt, warum das falsch ist: sobald der Sync eine fremde Nummer
   * eintraegt — und genau dafuer gibt es die Baender —, stuende dort eine
   * Zahl aus dem Band der ANDEREN Umgebung, und A1 schluege faelschlich an.
   * Der Stempel ist deshalb: SKY-0821 UND SKY-0822 (nur Staging fuehrt beide).
   */
  if (select count(*) from public.skylanders where sky_id in ('SKY-0821','SKY-0822')) <> 2 then
    raise exception 'A1 ABBRUCH: Umgebungsstempel nicht gefunden. Diese Datei '
      'laeuft nur auf STAGING.';
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
   * `restart with 928` laesst den naechsten Zug 928 treffen. Stuende im Band
   * 928..4999 schon eine SKY-ID — in der Tabelle ODER im Journal, also auch
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
         and sky_id between 'SKY-0928' and 'SKY-4999'
    union
      select entity_id from public.catalog_admin_changes
       where entity = 'skylander' and entity_id ~ '^SKY-[0-9]{4}$'
         and entity_id between 'SKY-0928' and 'SKY-4999') q;
  if v_anzahl > 0 then
    raise exception 'A3 ABBRUCH: im Band SKY-0928..SKY-4999 stehen bereits % '
      'SKY-ID(s) — ein RESTART wuerde sie ein zweites Mal vergeben.', v_anzahl;
  end if;

  -- A4 — und die Sequenz selbst darf das Band noch nicht erreicht haben.
  select last_value into v_last from public.sky_id_seq;
  if v_last >= 928 then
    raise exception 'A4 ABBRUCH: last_value steht bereits bei % und damit im '
      'neuen Band. Hier ist mehr gezogen worden als angenommen.', v_last;
  end if;

  /*
   * A5 — DER BESTAND, ALS NOTICE. Diese Zahlen muessen nach dem Lauf
   * unveraendert sein; `sky_id_band_postflight.sql` vergleicht sie gegen die
   * Baseline aus dem Preflight.
   */
  raise notice 'A5: % Katalogzeilen, % Journalzeilen, % Lagerzeilen, % '
    'Sammlungszeilen. Sequenz bei % (is_called %). Nach diesem Lauf muss jede '
    'dieser Zahlen gleich sein.',
    (select count(*) from public.skylanders),
    (select count(*) from public.catalog_admin_changes),
    (select count(*) from public.shop_inventory),
    (select count(*) from public.collection_items),
    v_last, (select is_called from public.sky_id_seq);
end
$w$;


-- ---------------------------------------------------------------------------
-- 2. Die eine wirksame Anweisung
-- ---------------------------------------------------------------------------
alter sequence public.sky_id_seq
  minvalue 928
  maxvalue 4999
  no cycle
  start with 928
  restart with 928;

-- ---------------------------------------------------------------------------
-- 3. Nachbedingungen
-- ---------------------------------------------------------------------------
do $n$
declare
  v_min bigint; v_max bigint; v_cyc boolean; v_last bigint; v_called boolean;
begin
  select min_value, max_value, cycle into v_min, v_max, v_cyc
    from pg_sequences where schemaname = 'public' and sequencename = 'sky_id_seq';
  select last_value, is_called into v_last, v_called from public.sky_id_seq;

  if v_min <> 928 or v_max <> 4999 then
    raise exception 'Nachbedingung: das Band ist % .. %, erwartet % .. %.',
      v_min, v_max, 928, 4999;
  end if;
  if v_cyc then
    raise exception 'Nachbedingung: CYCLE ist an — die Sequenz liefe um.';
  end if;
  if v_called then
    raise exception 'Nachbedingung: is_called ist true — der erste Zug waere % '
      'statt %.', v_last + 1, 928;
  end if;
  if v_last <> 928 then
    raise exception 'Nachbedingung: last_value ist %, erwartet %.', v_last, 928;
  end if;

  raise notice 'ok: Band % .. %, NO CYCLE, is_called false — der naechste Zug '
    'ist SKY-0928. KEINE Zeile wurde angefasst.', v_min, v_max;
end
$n$;

commit;
