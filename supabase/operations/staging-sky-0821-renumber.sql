-- ===========================================================================
-- STAGING — `Gold Fire Kraken` VON SKY-0821 AUF EINE NEUE NUMMER
--
-- EINE DATEI, EINE TRANSAKTION. Vollstaendig markieren, in den SQL-Editor des
-- Projekts qqxcpesbwfxzgytkdsac einfuegen, als `postgres` ausfuehren.
--
-- *** VORAUSSETZUNG, NICHT VORSICHT ***
--
-- `supabase/operations/staging-sky-id-band.sql` MUSS gelaufen sein. Vor der
-- Bereichssperre steht `last_value` unter 928, und `admin_create_figure` zieht
-- dann die naechste Nummer der ALTEN Zaehlung statt einer aus dem Band. A2
-- bricht deshalb ab, wenn die Sperre fehlt.
--
-- *** WARUM ANLEGEN UND LOESCHEN UND NICHT UMBENENNEN ***
--
-- Eine SKY-ID ist nicht aenderbar. `skylanders_sky_id_immutable` (0001) weist
-- jedes `update` darauf ab, und zwar AUCH FUER DIE SERVICE-ROLLE — der Trigger
-- haengt an der Tabelle, nicht am Recht. Eine Umnummerierung ist deshalb
-- zwangslaeufig eine neue Zeile und das Loeschen der alten. Das ist kein
-- Umweg, das ist die einzige Form, die es gibt.
--
-- *** WAS MIT DER HISTORIE PASSIERT — UND WAS NICHT ***
--
-- Sie wandert NICHT mit. `catalog_admin_changes` haengt an einem `entity_id`
-- aus Text und hat hierher keinen Fremdschluessel; die zwei Zeilen von
-- SKY-0821 (`created` am 2026-09-16, `card_type` am 2026-10-29) BLEIBEN
-- stehen, und `admin_delete_figure` legt eine dritte dazu (`deleted`). Die
-- neue Nummer beginnt mit einer eigenen `created`-Zeile.
--
-- Das ist richtig so: SKY-0821 ist auf Staging danach VERBRAUCHT und kommt
-- nie zurueck (ADR-0001). Genau diese Journalzeilen sind der Beweis dafuer —
-- der Waechter A3 der Bereichssperre zaehlt sie aus demselben Grund mit.
--
-- Damit der Zusammenhang trotzdem lesbar bleibt, setzt Schritt 6 eine
-- redaktionelle Notiz auf die neue Figur. Sie ist der einzige Ort, an dem
-- „vormals SKY-0821" steht.
--
-- *** WAS SIE NICHT TUT ***
--
--   * KEIN Production-Zugriff. Dort behaelt SKY-0821 `Winterfest Lob-Star`.
--   * KEIN `market_price`. Die neue Zeile entsteht mit NULL und bleibt so
--     (ADR-0010: NULL heisst unbekannt, nie 0).
--   * KEINE Storage-Datei. `Gold Fire Kraken` hat weder `image_file` noch
--     `image_override_path`; es ist nichts zu verschieben.
--   * KEIN Abgleich nach Production. Die neue Figur wandert spaeter mit dem
--     Katalogabgleich, mit eigener Freigabe.
--
-- *** DAS EINE, WAS EIN ABBRUCH NICHT ZURUECKNIMMT ***
--
-- Sequenzen sind nicht transaktional. Bricht die Datei NACH Schritt 2 ab, ist
-- die gezogene Nummer verbraucht — die Zeile ist fort, die Nummer bleibt weg.
-- Ein zweiter Lauf bekommt dann die naechste. Deshalb nennt diese Datei
-- nirgends „SKY-0928" als Bedingung: sie nimmt, was die Sequenz gibt, prueft
-- dass es im Band liegt, und sagt im NOTICE, welche Nummer es wurde.
--
-- Ruecknahme: `supabase/rollback/R_staging_sky_0821_renumber.md` — nach dem
-- `commit` ist sie KEIN Rueckbau, sondern dieselbe Uebung in der anderen
-- Richtung, und sie kostet erneut eine Nummer.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Die Identitaet, unter der gehandelt wird
--
-- Die sechs Funktionen dieses Laufs pruefen `is_platform_admin()`, und das
-- fragt nach `auth.uid()`. Im SQL-Editor ist die NULL. Hier wird deshalb der
-- Anspruch lokal auf einen ECHTEN Plattformadmin gesetzt — die Pruefung wird
-- damit ERFUELLT, nicht umgangen, und `changed_by` traegt im Journal eine
-- echte Person statt NULL. `set_config(..., true)` gilt nur in dieser
-- Transaktion.
-- ---------------------------------------------------------------------------
do $ident$
declare v_uid uuid; v_n integer;
begin
  select count(*) into v_n from public.platform_admins;
  if v_n <> 1 then
    raise exception 'A0 ABBRUCH: % Plattformadmins gefunden. Diese Datei '
      'erwartet genau einen, damit eindeutig ist, wer handelt.', v_n;
  end if;
  select user_id into v_uid from public.platform_admins;
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_uid::text, 'role', 'authenticated')::text,
                     true);
  if not public.is_platform_admin() then
    raise exception 'A0 ABBRUCH: der gesetzte Anspruch greift nicht — '
      'is_platform_admin() ist weiter falsch. Ohne sie laeuft hier nichts.';
  end if;
  raise notice 'A0: handelnd als Plattformadmin %', v_uid;
end
$ident$;


-- ---------------------------------------------------------------------------
-- 1. Waechter
-- ---------------------------------------------------------------------------
do $w$
declare
  v_min bigint; v_max bigint; v_refs bigint; v_f public.skylanders%rowtype;
begin
  -- A1 — die Umgebung, am vollstaendigen Staging-Markerpaar.
  if (select count(*) from public.skylanders
       where sky_id in ('SKY-0821','SKY-0822')) <> 2 then
    raise exception 'A1 ABBRUCH: das Staging-Markerpaar ist nicht vollstaendig. '
      'Diese Datei laeuft nur auf STAGING, und nur VOR der Umnummerierung.';
  end if;

  -- A2 — die Bereichssperre liegt. Ohne sie kaeme die Nummer aus der alten Zaehlung.
  select min_value, max_value into v_min, v_max from pg_sequences
   where schemaname = 'public' and sequencename = 'sky_id_seq';
  if v_min <> 928 or v_max <> 4999 then
    raise exception 'A2 ABBRUCH: das Band ist % .. %, erwartet 928 .. 4999. '
      'Erst supabase/operations/staging-sky-id-band.sql fahren.', v_min, v_max;
  end if;

  -- A3 — es ist die erwartete Figur. Jedes Feld, das der Lauf wiederherstellt.
  select * into v_f from public.skylanders where sky_id = 'SKY-0821';
  if not found then
    raise exception 'A3 ABBRUCH: SKY-0821 gibt es hier nicht.';
  end if;
  if v_f.name <> 'Gold Fire Kraken' or v_f.slug <> 'gold-fire-kraken'
     or v_f.series_code <> 'SF' or v_f.category_id <> 20
     or v_f.card_type <> 'chase' or v_f.catalog_status <> 'hidden'
     or v_f.catalog_visible or v_f.character_id <> 105
     or v_f.visible_type <> 'chase' or not v_f.visible_type_decided
     or v_f.types <> array['chase','swapper']::text[] then
    raise exception 'A3 ABBRUCH: SKY-0821 traegt nicht die Werte, die der '
      'Preflight gemessen hat (%, %, %, Kategorie %, %, %, Charakter %, % / %). '
      'Es hat sich etwas bewegt — erst klaeren.',
      v_f.name, v_f.slug, v_f.series_code, v_f.category_id, v_f.card_type,
      v_f.catalog_status, v_f.character_id, v_f.visible_type, v_f.types;
  end if;
  if v_f.image_file is not null or v_f.image_override_path is not null
     or v_f.base_sky_id is not null or v_f.usk_rating is not null
     or v_f.display_name_override is not null or v_f.market_price is not null then
    raise exception 'A3 ABBRUCH: SKY-0821 traegt inzwischen ein Bild, eine '
      'Basisfigur, eine USK-Angabe, einen Anzeigenamen oder einen Preis. '
      'Dieser Lauf uebertraegt davon NICHTS — erst die Schrittfolge erweitern.';
  end if;

  -- A4 — auf die alte Nummer zeigt nichts. Dieselbe Funktion, auf die sich
  --      `admin_delete_figure` spaeter stuetzt, plus der stille Pfad.
  select coalesce(sum(zeilen), 0) into v_refs
    from public.admin_merge_references('SKY-0821');
  v_refs := v_refs + (select count(*) from public.order_lines where sky_id = 'SKY-0821')
                   + (select count(*) from public.skylanders where base_sky_id = 'SKY-0821');
  if v_refs > 0 then
    raise exception 'A4 ABBRUCH: auf SKY-0821 zeigen % Zeile(n). Der Schritt 7 '
      'wuerde sie ohnehin abweisen — hier ist es die fruehere Meldung.', v_refs;
  end if;

  -- A5 — der Bestand, als NOTICE. Die Nachkontrolle vergleicht ihn.
  raise notice 'A5: % Katalogzeilen, % Journalzeilen, % Lagerzeilen, % '
    'Sammlungszeilen. Sequenz bei % (is_called %).',
    (select count(*) from public.skylanders),
    (select count(*) from public.catalog_admin_changes),
    (select count(*) from public.shop_inventory),
    (select count(*) from public.collection_items),
    (select last_value from public.sky_id_seq),
    (select is_called from public.sky_id_seq);
end
$w$;


-- ---------------------------------------------------------------------------
-- 2.-8. Die Umnummerierung
--
-- Alles in EINEM Block, weil es EINE Handlung ist. Sieben PostgREST-Aufrufe
-- waeren sieben Transaktionen und koennten in der Mitte stehenbleiben: eine
-- halb eingerichtete neue Figur neben der alten. Hier gilt entweder alles
-- oder nichts — mit der einen genannten Ausnahme, der gezogenen Nummer.
-- ---------------------------------------------------------------------------
do $lauf$
declare
  v_neu  text;
  v_slug text;
  v_nr   integer;
begin
  -- 2. ANLEGEN. Zieht die Nummer aus `sky_id_seq` und schreibt Zeile und
  --    `created`-Journalzeile. `catalog_visible => false` laesst
  --    `admin_create_figure` den Status 'draft' setzen; Schritt 3 korrigiert das.
  v_neu := public.admin_create_figure(
    p_name            => 'Gold Fire Kraken',
    p_series_code     => 'SF',
    p_category_id     => 20,
    p_card_type       => 'chase',
    p_catalog_visible => false);

  -- Die Nummer MUSS aus dem Band kommen. Tut sie es nicht, ist die Sperre
  -- nicht die, fuer die A2 sie gehalten hat.
  v_nr := substring(v_neu from 5)::integer;
  if v_nr < 928 or v_nr > 4999 then
    raise exception 'ABBRUCH nach Schritt 2: die Sequenz gab %, das liegt '
      'ausserhalb des Bandes 928..4999.', v_neu;
  end if;
  raise notice '2: angelegt als % (Status draft, Slug noch qualifiziert)', v_neu;

  -- 3. STATUS. 'hidden' wie auf der alten Nummer — nicht 'draft'. Der
  --    Unterschied ist nicht kosmetisch: 'draft' ist vom Katalogabgleich
  --    AUSGESCHLOSSEN, die Figur kaeme nie auf Production.
  perform public.admin_set_catalog_status(v_neu, 'hidden');

  -- 4. CHARAKTER. 105 = `Fire Kraken`. Die Zuordnung ist kuratiert und wird
  --    nie aus dem Namen geraten (ADR-0034).
  perform public.admin_set_character(v_neu, 105::bigint);

  -- 5. TYPEN, dann die Sicht. In dieser Reihenfolge: `admin_set_figure_types`
  --    rechnet `visible_type` neu, wenn der alte Wert aus der Menge fiele.
  perform public.admin_set_figure_types(v_neu, array['chase','swapper']::text[]);
  perform public.admin_set_visible_type(v_neu, 'chase');

  -- 6. DIE HERKUNFT. Der einzige Ort, an dem der Zusammenhang steht.
  perform public.admin_set_admin_note(v_neu,
    'Vormals SKY-0821 auf Staging. Umnummeriert am ' || current_date::text
    || ', weil SKY-0821 auf Production `Winterfest Lob-Star` ist (SYNC-18). '
    || 'Die Journalzeilen der alten Nummer stehen unter SKY-0821.');

  -- 7. DIE ALTE ZEILE. `admin_delete_figure` zaehlt vorher jeden
  --    Fremdschluessel aus `pg_constraint`, nennt die vier mit ON DELETE
  --    CASCADE einzeln, fragt `order_lines` eigens, weist Varianten ab und
  --    schreibt die `deleted`-Journalzeile VOR dem Loeschen.
  perform public.admin_delete_figure('SKY-0821');
  raise notice '7: SKY-0821 geloescht, Journalzeile deleted geschrieben';

  -- 8. DER SLUG. Erst jetzt moeglich: solange die alte Zeile stand, war
  --    `gold-fire-kraken` belegt, und `next_figure_slug` hat die neue Figur
  --    qualifiziert (ADR-0011). `slug` ist nicht journalisierbar — es gibt
  --    dafuer keine RPC und soll keine geben.
  select slug into v_slug from public.skylanders where sky_id = v_neu;
  if exists (select 1 from public.skylanders where slug = 'gold-fire-kraken') then
    raise exception 'ABBRUCH bei Schritt 8: der Slug gold-fire-kraken ist '
      'belegt. Das sollte nach Schritt 7 nicht sein.';
  end if;
  update public.skylanders set slug = 'gold-fire-kraken' where sky_id = v_neu;
  raise notice '8: Slug % -> gold-fire-kraken', v_slug;

  /*
   * NUR FUER DEN NACHBEDINGUNGSBLOCK WEITER UNTEN. `true` heisst
   * TRANSAKTIONSLOKAL: mit dem `commit` ist dieser Wert fort. Am 2026-10-30
   * hat die Nachkontrolle sich darauf verlassen und ohne ihn 19 Abweichungen
   * gemeldet — nicht weil etwas schiefging, sondern weil sie nicht wusste,
   * worueber sie urteilen sollte.
   *
   * Darauf verlaesst sie sich NICHT MEHR: `sky_0821_renumber_postflight.sql`
   * leitet die Nummer aus der Datenbank ab (Zeilen 101-105), und zwar aus
   * Dingen, die dieser Lauf dauerhaft hinterlaesst — der einzigen Zeile im
   * Band, dem Namen, und der redaktionellen Notiz aus Schritt 6.
   */
  perform set_config('skyisles.neu', v_neu, true);
  raise notice 'FERTIG: Gold Fire Kraken steht unter %. Die Nachkontrolle '
    'findet diese Nummer von selbst — aufschreiben hilft, ist aber nicht '
    'mehr noetig.', v_neu;
end
$lauf$;


-- ---------------------------------------------------------------------------
-- 9. Nachbedingungen — noch in derselben Transaktion
-- ---------------------------------------------------------------------------
do $n$
declare
  v_neu text := current_setting('skyisles.neu', true);
  v_f   public.skylanders%rowtype;
begin
  select * into v_f from public.skylanders where sky_id = v_neu;
  if not found then raise exception 'Nachbedingung: % steht nicht da.', v_neu; end if;

  if v_f.name <> 'Gold Fire Kraken' or v_f.slug <> 'gold-fire-kraken'
     or v_f.series_code <> 'SF' or v_f.category_id <> 20
     or v_f.card_type <> 'chase' or v_f.catalog_status <> 'hidden'
     or v_f.catalog_visible or v_f.character_id <> 105
     or v_f.visible_type <> 'chase' or not v_f.visible_type_decided
     or v_f.types <> array['chase','swapper']::text[] then
    raise exception 'Nachbedingung: % traegt nicht die Werte der alten Zeile.', v_neu;
  end if;
  if v_f.market_price is not null then
    raise exception 'Nachbedingung: % traegt einen Preis. Dieser Lauf setzt keinen.', v_neu;
  end if;
  if v_f.item_type <> 'figure' then
    raise exception 'Nachbedingung: item_type ist %, erwartet figure (Trigger aus '
      'der Kategorie).', v_f.item_type;
  end if;

  if exists (select 1 from public.skylanders where sky_id = 'SKY-0821') then
    raise exception 'Nachbedingung: SKY-0821 steht noch.';
  end if;
  -- Die Historie der alten Nummer MUSS die Zeile ueberlebt haben.
  if (select count(*) from public.catalog_admin_changes
       where entity = 'skylander' and entity_id = 'SKY-0821') < 3 then
    raise exception 'Nachbedingung: unter SKY-0821 stehen weniger als drei '
      'Journalzeilen. Die Historie muss das Loeschen ueberleben.';
  end if;
  if not exists (select 1 from public.catalog_admin_changes
                  where entity = 'skylander' and entity_id = 'SKY-0821'
                    and field = 'deleted') then
    raise exception 'Nachbedingung: die deleted-Journalzeile zu SKY-0821 fehlt.';
  end if;
  if not exists (select 1 from public.catalog_admin_changes
                  where entity = 'skylander' and entity_id = v_neu
                    and field = 'created') then
    raise exception 'Nachbedingung: die created-Journalzeile zu % fehlt.', v_neu;
  end if;

  raise notice 'ok: % traegt alle Werte, SKY-0821 ist fort, und beide '
    'Journalspuren stehen. Production ist nicht angefasst worden.', v_neu;
end
$n$;

commit;
