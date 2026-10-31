-- ===========================================================================
-- PRODUCTION — EIN LAUF FUER 0165
--              (der Systemweg fuer die Figurenanlage mit vorgegebener SKY-ID)
--
-- ###########################################################################
-- ##  DIES IST EINE PRODUCTION-DATEI. Projekt zmiwxswrpkmizvqsgype.        ##
-- ##  Sie bricht auf Staging ab, und zwar bevor sie etwas anfasst.         ##
-- ###########################################################################
--
-- EINE DATEI, EINE TRANSAKTION, EIN EINFUEGEN. Vollstaendig markieren, in den
-- SQL-Editor des Production-Projekts zmiwxswrpkmizvqsgype einfuegen,
-- ausfuehren. Nichts in Teilen.
--
-- *** SIE LEGT EINE FUNKTION AN — SONST NICHTS ***
--
-- Keine Tabelle, keine Spalte, keine Zeile, kein Trigger, kein veraendertes
-- Recht an etwas Bestehendem. Sie ruft die Funktion auch nicht auf: nach
-- diesem Lauf stehen genau so viele Katalog- und Journalzeilen da wie vorher,
-- und `sky_id_seq` ist unberuehrt. B1-B5 messen das.
--
-- *** WARUM DIESE HUELLE KUERZER IST ALS G3', G4' UND G5' ***
--
-- Jene Gruppen schreiben in JEDE Katalogzeile. Ihre Huellen tragen deshalb
-- den vollen Basis- und Shop-Vertrag: Angebotszahl, Angebotsabdruck,
-- shopfaehige Zeilen, sammelbare Zeilen, Lagerabdruck. Das ist dort richtig,
-- weil eine Erstbelegung ein Angebot verschieben KANN.
--
-- `0165` kann das nicht. Sie legt eine Funktion an und fuehrt keine einzige
-- schreibende Anweisung auf einer Tabelle aus. Ein Angebotsabdruck waere hier
-- kein Schutz, sondern Zierde — und 450 Zeilen Vertrag, die niemand liest,
-- sind schlechter als zehn, die jemand prueft. Gemessen wird deshalb der
-- BESTAND: Katalog-, Journal-, Lager- und Sammlungszeilen und der
-- Katalogabdruck. Bewegt sich eines davon, bricht B ab.
--
-- *** WAS SIE NICHT VORAUSSETZT ***
--
-- `0159` bis `0164` sind KEINE Voraussetzung. `0165` nennt `types`,
-- `visible_type` und `base_sky_id` an genau einer Stelle — im `comment on
-- function`, als Aufzaehlung dessen, was sie NICHT anfasst. Im ausfuehrbaren
-- Rumpf kommt keines davon vor; nachgerechnet am Quelltext.
--
-- Sie setzt voraus: `skylanders` mit `catalog_status` (`0152`) und `item_type`
-- (`0135`), `catalog_admin_changes` mit dem erlaubten Feldwert `created`, und
-- die Rolle `service_role`. A5 prueft jedes einzeln.
--
-- *** WOFUER ***
--
-- Der Katalogabgleich muss eine Figur im Zielprojekt unter DERSELBEN SKY-ID
-- anlegen wie in der Quelle. Keine der sechs vorhandenen Anlagestellen kann
-- das — alle ziehen aus `sky_id_seq`. Und ein INSERT journalisiert nicht:
-- `skylanders_log_editorial` (0004) ist `after update`. Zwei Anfragen ueber
-- PostgREST sind keine Transaktion; diese Funktion macht beides in EINEM
-- Rumpf.
--
-- Auf Production sind damit 33 Figuren anzulegen (`SKY-0822` bis `SKY-0928`),
-- jede unter ihrer Staging-Nummer. Dieser Lauf legt KEINE davon an.
--
-- *** DAS BAND SPIELT HIER KEINE ROLLE ***
--
-- `system_sync_create_figure` nimmt die SKY-ID als Parameter und ZIEHT DIE
-- SEQUENZ NICHT — die Migration misst am Funktionsrumpf, dass weder
-- `nextval` noch `setval` noch `sky_id_seq` darin vorkommen. Die 33 Nummern
-- liegen unter dem Production-Band `SKY-5001`-`SKY-8999`, und das ist kein
-- Widerspruch: ein Band regelt die VERGABE, nicht die SPEICHERUNG. Genau
-- deshalb traegt `skylanders.sky_id` keine CHECK-Constraint auf ein Band.
--
-- ERWARTET: die NOTICE-Zeilen von A6 und der Migration, dann `commit`.
--
-- Ruecknahme: `supabase/rollback/R0165_drop_system_sync_create_figure.sql`
-- (loescht nur die Funktion, verwirft keine Daten).
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- A0  ZWEI OBERGRENZEN, VOR DEM ERSTEN ZUGRIFF
-- ---------------------------------------------------------------------------
set local lock_timeout = '5s';
set local statement_timeout = '300s';

-- ---------------------------------------------------------------------------
-- A1-A5  WAECHTER
--
-- A1/A2 sind POSITIVE Nachweise am Schema (0133 und die Sequenzgrenzen) und
-- haben den rein negativen Markerriegel der Gruppen G3'-G5' ersetzt. Die
-- Begruendung steht im Block darunter.
-- ---------------------------------------------------------------------------
do $lauf_a$
declare
  v_n integer;
begin
  /*
   * ======================================================================
   * A1-A3  DER UMGEBUNGSNACHWEIS — POSITIV UND AN SCHEMA, NICHT AN DATEN
   * ======================================================================
   *
   * *** WARUM DER ALTE RIEGEL NICHT MEHR GENUEGT ***
   *
   * `prod-g3` bis `prod-g5` erkennen Staging daran, dass dort das
   * vollstaendige Markerpaar `SKY-0821` + `SKY-0822` liegt. Seit der
   * Umnummerierung vom 2026-10-30 liegt es dort NICHT mehr vollstaendig —
   * `SKY-0821` ist fort. Dieser Riegel faengt Staging also nicht mehr, und
   * ein negativer Riegel allein war ohnehin schwach: „kein Staging" stimmt
   * auch fuer eine leere Datenbank, fuer eine Kopie und fuer ein drittes
   * Projekt.
   *
   * Schlimmer: beide Marker sind ZEILEN. Der Katalogabgleich legt auf
   * Production demnaechst `SKY-0822` an — es ist die erste der 33 Figuren.
   * Ein Stempel, den der eigene Sync umwirft, ist kein Stempel.
   *
   * *** WAS STATTDESSEN GEPRUEFT WIRD ***
   *
   * Zwei POSITIVE Nachweise, beide am SCHEMA. Ein Katalogabgleich schreibt
   * Zeilen; er legt keine Triggerfunktion an und veraendert keine
   * Sequenzgrenze. Was hier geprueft wird, kann er also nicht herstellen.
   *
   *   A1  `0133` liegt — und zwar BEIDE ihrer Objekte, die Triggerfunktion
   *       `purchases_paid_total_is_final()` UND der Trigger
   *       `purchases_paid_total_immutable_trg` auf `purchases`. `0133` ist
   *       auf Production seit dem 2026-10-18 angewendet und auf Staging
   *       ausdruecklich OFFEN (`APPLIED.md`: Staging offen `0133`, `0134`,
   *       `0150`, `0151`) — und sie bleibt es, Staging und Production sind
   *       bewusst nicht auf demselben Stand. Zwei Objekte statt einem, damit
   *       ein halb angewendeter Stand nicht durchgeht.
   *
   *   A2  `sky_id_seq` traegt NICHT das Staging-Band. Staging fuehrt seit
   *       SYNC-16 `minvalue 928 maxvalue 4999`; Production fuehrt entweder
   *       noch `1 .. 9223372036854775807` oder — nach der eigenen
   *       Bandsperre — `5001 .. 8999`. Genau diese zwei Faelle sind erlaubt.
   *       Eine Sequenzgrenze ist Schema und wandert durch keinen Abgleich.
   *
   *   A3  Der Katalog traegt Zeilen. Gegen eine leere oder frische Datenbank.
   *
   * Der alte negative Riegel ist GANZ ENTFALLEN — nicht nur entwertet. Er
   * haette nach dem Figurenimport auf Production selbst angeschlagen, denn
   * dann stehen `SKY-0821` und `SKY-0822` dort beide. Die Begruendung steht
   * an seiner Stelle weiter unten.
   */
  if to_regprocedure('public.purchases_paid_total_is_final()') is null then
    raise exception 'ABBRUCH A1a: die Triggerfunktion purchases_paid_total_is_final '
      'fehlt. Sie kommt aus 0133, und 0133 liegt NUR auf Production. Diese '
      'Datenbank ist nicht Production.';
  end if;
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = to_regclass('public.purchases')
                    and t.tgname = 'purchases_paid_total_immutable_trg'
                    and not t.tgisinternal) then
    raise exception 'ABBRUCH A1b: der Trigger purchases_paid_total_immutable_trg '
      'fehlt, obwohl die Funktion aus 0133 liegt. Halb angewendeter Stand — '
      'erst klaeren.';
  end if;

  select count(*) into v_n from pg_sequences
   where schemaname = 'public' and sequencename = 'sky_id_seq'
     and min_value = 928 and max_value = 4999;
  if v_n > 0 then
    raise exception 'ABBRUCH A2: sky_id_seq traegt das STAGING-Band '
      '(928 .. 4999). Diese Datei ist fuer Production (zmiwxswrpkmizvqsgype) — '
      'auf Staging gehoert supabase/operations/staging-0165.sql.';
  end if;
  select count(*) into v_n from pg_sequences
   where schemaname = 'public' and sequencename = 'sky_id_seq'
     and ((min_value = 1 and max_value = 9223372036854775807)
          or (min_value = 5001 and max_value = 8999));
  if v_n <> 1 then
    raise exception 'ABBRUCH A2b: sky_id_seq traegt weder den unbegrenzten '
      'Production-Stand (1 .. 9223372036854775807) noch das Production-Band '
      '(5001 .. 8999). Erst klaeren, welches Projekt das ist.';
  end if;

  if (select count(*) from public.skylanders) < 100 then
    raise exception 'ABBRUCH A3: der Katalog hat weniger als 100 Zeilen — das ist '
      'kein Production-Projekt.';
  end if;

  /*
   * A3b IST ENTFERNT, UND DAS IST EINE KORREKTUR.
   *
   * Hier stand der alte negative Riegel: „bricht ab, wenn SKY-0821 UND
   * SKY-0822 beide stehen". Als Zugabe gedacht — und er waere zur Falle
   * geworden. Der Katalogabgleich legt `SKY-0822` auf PRODUCTION an (erste
   * der 33 Figuren), und `SKY-0821` traegt dort `Winterfest Lob-Star`.
   * Danach stuenden beide, der Riegel schluege an, und diese Datei waere auf
   * ihrer eigenen Zielumgebung nicht mehr lauffaehig.
   *
   * Gefunden am 2026-10-30 bei der Durchsicht aller Production-Waechter auf
   * Abhaengigkeiten von diesen zwei Zeilen. Der Lauf selbst hatte sie schon
   * hinter sich; die Datei bleibt trotzdem richtig, weil sie gelesen und
   * wiederverwendet wird.
   *
   * Der Nachweis steht ohnehin in A1a/A1b (0133, Schema) und A2 (die
   * Sequenzgrenzen) — beide ueberleben jeden Zeilenimport. Ein vierter
   * Riegel, der bei normalem Betrieb falsch anschlaegt, macht nichts
   * sicherer.
   */

  -- A4 — die Rolle, an der die Autorisierung der Funktion haengt.
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise exception 'ABBRUCH A4: die Rolle service_role gibt es nicht. Ohne sie '
      'hat die Funktion keinen Aufrufer und das EXECUTE-Recht keinen Traeger.';
  end if;

  /*
   * A5 — DIE EIGENEN VORBEDINGUNGEN, einzeln statt gesammelt. Eine Meldung,
   * die sagt „eine Vorbedingung fehlt", kostet einen zweiten Lauf.
   */
  if to_regprocedure('public.system_sync_create_figure(text,text,text,text,bigint,'
                     'text,text,text,text,text,smallint)') is not null then
    raise exception 'ABBRUCH A5a: system_sync_create_figure liegt schon. Diese '
      'Datei laeuft einmal.';
  end if;
  select count(*) into v_n from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'system_sync_create_figure';
  if v_n > 0 then
    raise exception 'ABBRUCH A5b: es liegen % Fassung(en) von '
      'system_sync_create_figure mit anderer Signatur. Erst klaeren.', v_n;
  end if;

  if to_regclass('public.skylanders') is null then
    raise exception 'ABBRUCH A5c: skylanders fehlt.';
  end if;
  if to_regclass('public.catalog_admin_changes') is null then
    raise exception 'ABBRUCH A5d: catalog_admin_changes fehlt (0004).';
  end if;
  select count(*) into v_n from pg_attribute a
   where a.attrelid = to_regclass('public.skylanders') and not a.attisdropped
     and a.attname in ('catalog_status', 'item_type', 'source', 'usk_rating',
                       'image_file', 'card_type', 'slug', 'series_code', 'category_id');
  if v_n <> 9 then
    raise exception 'ABBRUCH A5e: von den neun Spalten, in die 0165 schreibt, '
      'stehen %. Erwartet 9 — 0135 (item_type) und 0152 (catalog_status) '
      'muessen liegen.', v_n;
  end if;

  /*
   * A5f — DER FELDWERT, AN DEM DIE JOURNALZEILE HAENGT. `0165` schreibt
   * `field = 'created'`. Laesst die CHECK das nicht zu, scheitert die
   * Funktion erst beim AUFRUF — und dann mitten im Abgleich.
   */
  if not exists (select 1 from pg_constraint c
                  where c.conrelid = to_regclass('public.catalog_admin_changes')
                    and c.conname = 'catalog_admin_changes_field_known') then
    raise exception 'ABBRUCH A5f: catalog_admin_changes_field_known fehlt.';
  end if;
  if (select pg_get_constraintdef(c.oid) from pg_constraint c
       where c.conrelid = to_regclass('public.catalog_admin_changes')
         and c.conname = 'catalog_admin_changes_field_known') not like '%''created''%' then
    raise exception 'ABBRUCH A5g: die Journal-Constraint laesst den Feldwert '
      'created nicht zu. 0165 wuerde beim ersten Aufruf scheitern.';
  end if;
end
$lauf_a$;

-- ---------------------------------------------------------------------------
-- A6  DER BESTAND, von der Huelle selbst gemessen und abgelegt
-- ---------------------------------------------------------------------------
select set_config('skyisles.b0165', (
  select (select count(*) from public.skylanders)::text || '|'
      || (select count(*) from public.catalog_admin_changes)::text || '|'
      || (select count(*) from public.shop_inventory)::text || '|'
      || (select count(*) from public.collection_items)::text || '|'
      || (select coalesce(md5(string_agg(s.sky_id || '|' || s.name || '|' || s.slug,
                                         chr(10) order by s.sky_id collate "C")), '(leer)')
            from public.skylanders s) || '|'
      -- Die Sequenz MIT in die Ablage, sonst kann B sie nicht vergleichen.
      || (select last_value::text || ';' || is_called::text from public.sky_id_seq)
), true);

do $a6$
begin
  raise notice 'A6: Bestand abgelegt — %', current_setting('skyisles.b0165', true);
end
$a6$;


-- >>> EINGEBETTET: supabase/migrations/0165_system_sync_create_figure.sql
-- ===========================================================================
-- 0165 — DER SYSTEMWEG, UM EINE FIGUR MIT VORGEGEBENER SKY-ID ANZULEGEN
--
-- WOFUER
--
-- Der Katalogabgleich Staging <-> Production muss eine Figur im Zielprojekt
-- unter DERSELBEN SKY-ID anlegen, unter der sie in der Quelle steht. Eine
-- Figur, die auf Staging `SKY-0893` heisst, heisst auf Production auch
-- `SKY-0893` — sonst waere es keine Synchronisierung, sondern eine zweite
-- Identitaet fuer dieselbe Sache (ADR-0001, CLAUDE.md Regel 2).
--
-- DAS KANN HEUTE KEINE FUNKTION. Jede der sechs Stellen im Schema, die eine
-- Katalogzeile anlegt, zieht ihre Nummer aus `sky_id_seq`:
-- `admin_create_figure` (0033/0041/0152), `create_figure_from_template`
-- (0034), `seller_create_catalog_item` (0137), `0138`. Keine nimmt eine
-- Kennung entgegen.
--
-- UND EIN INSERT WIRD NICHT JOURNALISIERT. `skylanders_log_editorial` (0004)
-- ist `after UPDATE`. Ein Werkzeug muesste also zweimal schreiben — einmal
-- die Zeile, einmal die Journalzeile — und PostgREST haelt keine Transaktion
-- ueber zwei Anfragen. Zwischen den beiden liegt ein Fenster, in dem eine
-- angelegte Figur ohne Journaleintrag zurueckbleibt. Genau das schliesst
-- diese Funktion: BEIDE Anweisungen stehen in EINEM Rumpf, also in EINER
-- Transaktion. Entweder beide, oder keine.
--
-- DIE BAUFORM IST NICHT NEU. `system_set_image_override` (0035) ist dieselbe
-- Antwort auf dieselbe Frage, und `0035` zitiert dafuer wiederum
-- `system_record_inventory_movement` (0003): „the authorization IS the
-- EXECUTE privilege". Eine dritte Funktion derselben Art ist keine neue
-- Bauart.
--
-- ---------------------------------------------------------------------------
-- WAS SIE NICHT TUT, UND WARUM JEWEILS
-- ---------------------------------------------------------------------------
--
--   * KEIN `market_price`, kein `price_updated_at`. Der Marktwert gehoert
--     Production (ADR-0010, Betreiberentscheidung). Dass der Abgleich ihn
--     nicht schreibt, ist hier STRUKTURELL und nicht eine Zusage des
--     aufrufenden Werkzeugs: die Funktion kennt den Parameter nicht.
--   * KEIN `character_id`, kein `base_sky_id`, keine `types`, kein
--     `visible_type`. Fuer die vier gibt es seit `0158`, `0159` und `0163`
--     bereits atomare Funktionen, die ihre eigene Journalzeile schreiben.
--     Sie hier zu wiederholen hiesse, zwei Schreibwege fuer dasselbe Feld zu
--     haben — und einer davon ohne die fachlichen Riegel der anderen.
--   * KEIN `display_name_override`, kein `image_override_path`. Beide sind
--     Klasse A: ein spaeteres `update` journalisiert sie ueber den
--     vorhandenen Trigger, und `image_override_path` hat mit `0035` ohnehin
--     seinen eigenen Systemweg, der die Pfadzugehoerigkeit prueft.
--   * KEIN `nextval`, kein `setval`. Die Funktion fasst `sky_id_seq` NICHT
--     an. Sie vergibt keine Nummer, sie uebernimmt eine.
--   * KEINE Aenderung an einer bestehenden Funktion, keine neue Tabelle,
--     keine neue Spalte, kein veraendertes Recht an etwas Bestehendem.
--
-- ---------------------------------------------------------------------------
-- WARUM NICHT EINFACH EIN DIREKTES INSERT AUS DEM WERKZEUG
-- ---------------------------------------------------------------------------
--
-- Dieselbe Antwort wie in `0035`: der Service-Role-Key umgeht RLS, ein
-- Werkzeug KOENNTE die Zeile selbst schreiben. Es umginge dabei aber genau
-- die Pruefungen, die eine Anlage sicher machen — und vor allem die
-- Journalzeile, die der Anlass dieser Datei ist. Ein Werkzeug mit einem
-- Fehler ist der Aufrufer, gegen den sie gebaut ist.
--
-- ---------------------------------------------------------------------------
-- WAS DIE TRIGGER WEITER TUN, UND DAS IST ABSICHT
-- ---------------------------------------------------------------------------
--
--   `skylanders_sync_catalog_status` (0152, BEFORE INSERT) leitet
--       `catalog_visible` aus dem uebergebenen `catalog_status` ab. Genau die
--       Zusage, die `0152` gibt: „wer nur eine der beiden Spalten schreibt,
--       bekommt die andere abgeleitet". Deshalb nennt der INSERT unten NUR
--       den Status.
--   `skylanders_set_item_type` (0135, BEFORE INSERT) ersetzt den Vorgabewert
--       `figure` durch den aus der Kategorie abgeleiteten Typ. Ein
--       ausdruecklicher `portal`/`bundle`/`other` ueberlebt.
--   `skylanders_sky_id_immutable` (0001) bleibt, wie er ist: die hier
--       vergebene Kennung ist ab dem COMMIT unveraenderlich.
--
-- Ruecknahme: `supabase/rollback/R0165_drop_system_sync_create_figure.sql`.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen
-- ---------------------------------------------------------------------------
do $vor$
begin
  if to_regclass('public.skylanders') is null then
    raise exception '0165 Vorbedingung: skylanders fehlt (0001).';
  end if;

  if to_regclass('public.catalog_admin_changes') is null then
    raise exception '0165 Vorbedingung: catalog_admin_changes fehlt (0004).';
  end if;

  -- `catalog_status` wird vom INSERT benannt.
  if not exists (select 1 from pg_attribute a
                  where a.attrelid = to_regclass('public.skylanders')
                    and a.attname = 'catalog_status' and not a.attisdropped) then
    raise exception '0165 setzt 0152 voraus: skylanders.catalog_status fehlt.';
  end if;

  -- Die Journalzeile traegt `field = 'created'`. Kennt die Audit-Constraint
  -- den Wert nicht, waere die Funktion von der ersten Zeile an unbrauchbar —
  -- und der Fehler fiele erst beim Aufruf auf.
  if not exists (
    select 1 from pg_constraint c
     where c.conrelid = to_regclass('public.catalog_admin_changes')
       and c.conname  = 'catalog_admin_changes_field_known'
       and pg_get_constraintdef(c.oid) like '%''created''%'
  ) then
    raise exception '0165 Vorbedingung: catalog_admin_changes kennt den Feldwert '
      '''created'' nicht (0033).';
  end if;

  if to_regprocedure('public.system_sync_create_figure(text,text,text,text,bigint,text,text,text,text,text,smallint)')
       is not null then
    raise exception '0165 Abbruch: system_sync_create_figure steht schon.';
  end if;
end
$vor$;


-- ---------------------------------------------------------------------------
-- 2. Die Funktion
-- ---------------------------------------------------------------------------
create or replace function public.system_sync_create_figure(
  p_sky_id         text,
  p_name           text,
  p_slug           text,
  p_series_code    text,
  p_category_id    bigint,
  p_card_type      text,
  p_item_type      text,
  p_catalog_status text,
  p_source         text,
  p_image_file     text     default null,
  p_usk_rating     smallint default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_slug text := nullif(btrim(coalesce(p_slug, '')), '');
  v_nr   integer;
begin
  -- Keine `is_platform_admin()`-Pruefung: die Berechtigung IST das
  -- EXECUTE-Recht, und das hat nur `service_role`. Ein Aufruf als `anon`
  -- oder `authenticated` wird von PostgreSQL abgewiesen, bevor dieser
  -- Rumpf erreicht ist. Dieselbe Begruendung wie in `0003` und `0035`.

  if p_sky_id !~ '^SKY-[0-9]{4}$' then
    raise exception '0165: % ist keine SKY-ID im Format SKY-0000', coalesce(p_sky_id, '<null>')
      using errcode = 'check_violation';
  end if;

  /*
   * DER RESERVIERTE BEREICH BLEIBT UNERREICHBAR. 9000-9999 ist System- und
   * Testbereich (ADR-0070); dort stehen die Fixtures, die Werkzeuge von Hand
   * setzen. Ein Abgleich legt dort NIE etwas an. `admin_create_figure` zieht
   * dieselbe Grenze bei 8999, und sie wird hier wiederholt statt dem
   * Aufrufer geglaubt.
   */
  v_nr := (substring(p_sky_id from 5))::integer;
  if v_nr > 8999 then
    raise exception '0165: % liegt im reservierten System- und Testbereich '
      'SKY-9000..SKY-9999 (ADR-0070); ein Abgleich legt dort nichts an', p_sky_id
      using errcode = 'check_violation';
  end if;

  if v_name is null then
    raise exception '0165: eine Figur braucht einen Namen' using errcode = 'check_violation';
  end if;
  if v_slug is null then
    raise exception '0165: eine Figur braucht einen Slug' using errcode = 'check_violation';
  end if;

  /*
   * `source` IST HERKUNFT UND NIE EIN RECHT (ADR-0070). Der Spalten-CHECK
   * aus `0033` faengt einen falschen Wert ohnehin — hier wird er mit Namen
   * abgewiesen, damit die Meldung sagt, was gemeint war.
   */
  if p_source is null or p_source not in ('import', 'admin') then
    raise exception '0165: source muss import oder admin sein, nicht %',
      coalesce(p_source, '<null>') using errcode = 'check_violation';
  end if;

  if p_catalog_status is null or p_catalog_status not in ('public', 'hidden', 'draft') then
    raise exception '0165: catalog_status muss public, hidden oder draft sein, nicht %',
      coalesce(p_catalog_status, '<null>') using errcode = 'check_violation';
  end if;

  /*
   * EINE ANLAGE IST KEINE UEBERSCHREIBUNG. Ohne diese Zeile fiele der Fall
   * auf den Primaerschluessel und erzeugte `23505` — richtig, aber ohne zu
   * sagen, dass hier jemand eine bestehende Figur anlegen wollte.
   */
  if exists (select 1 from public.skylanders s where s.sky_id = p_sky_id) then
    raise exception '0165: % steht bereits im Katalog; eine Anlage ueberschreibt nichts',
      p_sky_id using errcode = 'unique_violation';
  end if;

  /*
   * NUR DEN STATUS NENNEN. `skylanders_sync_catalog_status` (0152, BEFORE
   * INSERT) leitet `catalog_visible` daraus ab — genau die Zusage, die jene
   * Migration gibt. Beides zu schreiben waere eine zweite Quelle fuer
   * dieselbe Aussage.
   *
   * `types`, `visible_type`, `visible_type_decided`, `is_active` tragen ihre
   * Spaltenvorgaben (`'{}'`, NULL, false, true). `character_id` und
   * `base_sky_id` bleiben NULL und werden danach einzeln gesetzt.
   */
  insert into public.skylanders
    (sky_id, name, slug, series_code, category_id,
     card_type, item_type, catalog_status, source, image_file, usk_rating)
  values
    (p_sky_id, v_name, v_slug, p_series_code, p_category_id,
     coalesce(nullif(btrim(coalesce(p_card_type, '')), ''), 'standard'),
     coalesce(nullif(btrim(coalesce(p_item_type, '')), ''), 'figure'),
     p_catalog_status, p_source,
     nullif(btrim(coalesce(p_image_file, '')), ''), p_usk_rating);

  /*
   * DIE JOURNALZEILE, IN DERSELBEN TRANSAKTION. Wort fuer Wort die, die
   * `admin_create_figure` schreibt — nur mit `changed_by = NULL`, weil hier
   * kein Mensch handelt. `0004` sieht NULL dafuer ausdruecklich vor:
   * „NULL when the change came through the service role (an import, a
   * script)".
   *
   * Scheitert sie, rollt der INSERT mit zurueck. Das ist der ganze Zweck
   * dieser Datei.
   */
  insert into public.catalog_admin_changes
    (entity, entity_id, field, old_value, new_value, changed_by)
  values ('skylander', p_sky_id, 'created', null, v_name, null);

  return p_sky_id;
end;
$$;

comment on function public.system_sync_create_figure(text,text,text,text,bigint,text,text,text,text,text,smallint) is
  'Creates ONE catalogue figure under a SKY-ID the caller supplies, for the Staging<->Production catalogue sync (0165). Executable only by service_role; the EXECUTE privilege is the authorization, exactly as system_set_image_override (0035) and system_record_inventory_movement (0003). Row and created journal entry are written in ONE transaction, which is why this exists: an INSERT fires no journal trigger (0004 is AFTER UPDATE) and PostgREST holds no transaction across two requests. Refuses a malformed SKY-ID, the reserved range SKY-9000..9999 (ADR-0070), an existing SKY-ID, an unknown source or catalog_status, and a blank name or slug. It never touches market_price, character_id, base_sky_id, types or visible_type - those have their own atomic functions - and never reads or advances sky_id_seq.';

revoke all on function public.system_sync_create_figure(text,text,text,text,bigint,text,text,text,text,text,smallint)
  from public, anon, authenticated;
grant  execute on function public.system_sync_create_figure(text,text,text,text,bigint,text,text,text,text,text,smallint)
  to service_role;


-- ---------------------------------------------------------------------------
-- 3. Nachbedingungen
-- ---------------------------------------------------------------------------
do $nach$
declare
  v_oid oid := to_regprocedure(
    'public.system_sync_create_figure(text,text,text,text,bigint,text,text,text,text,text,smallint)');
begin
  if v_oid is null then
    raise exception '0165 Nachbedingung: die Funktion ist nicht entstanden.';
  end if;

  if not has_function_privilege('service_role', v_oid, 'execute') then
    raise exception '0165 Nachbedingung: service_role darf die Funktion nicht ausfuehren.';
  end if;

  if has_function_privilege('anon', v_oid, 'execute')
     or has_function_privilege('authenticated', v_oid, 'execute') then
    raise exception '0165 Nachbedingung: anon oder authenticated duerfen die Funktion '
      'ausfuehren — das Recht IST hier die Berechtigung.';
  end if;

  /*
   * UND PUBLIC ERST RECHT NICHT — und das wird ueber `has_function_privilege`
   * geprueft, nicht ueber `proacl`.
   *
   * DER UNTERSCHIED IST NICHT KOSMETISCH. Eine frisch angelegte Funktion hat
   * `proacl = NULL`, und NULL heisst nicht „niemand", sondern „der Vorgabewert"
   * — und der Vorgabewert fuer eine Funktion ist EXECUTE FUER PUBLIC. Eine
   * Pruefung ueber `aclexplode(proacl)` findet dann KEINE Zeile und meldet
   * faelschlich „PUBLIC darf nicht". Nachgemessen am 2026-10-30:
   * `aclexplode` sagte `false`, `has_function_privilege('public', …)` sagte
   * `true` — und letzteres war richtig.
   */
  if has_function_privilege('public', v_oid, 'execute') then
    raise exception '0165 Nachbedingung: PUBLIC darf die Funktion ausfuehren. '
      'Das `revoke all … from public` hat nicht gegriffen.';
  end if;

  /*
   * SECURITY DEFINER MIT LEEREM SUCHPFAD. Ein Definer ohne festgelegten
   * `search_path` ist die klassische Rechteausweitung: wer das Schema vor
   * `public` schieben kann, laesst die Funktion seine Tabelle schreiben.
   * `set search_path = ''` erzwingt, dass jeder Name im Rumpf voll
   * qualifiziert ist — und der Rumpf ist es.
   */
  if not exists (select 1 from pg_proc p where p.oid = v_oid and p.prosecdef) then
    raise exception '0165 Nachbedingung: die Funktion ist nicht SECURITY DEFINER.';
  end if;

  /*
   * DER WERT WIRD AUSGEPACKT, NICHT VERGLICHEN. PostgreSQL schreibt den
   * leeren Suchpfad als `search_path=""` — mit Anfuehrungszeichen —, und
   * die Darstellung ist nicht zugesagt. Ein Vergleich gegen ein Literal
   * haette `staging-0137.sql` am 2026-10-20 abbrechen lassen, obwohl die
   * Funktion in Ordnung war; seither nagelt
   * `src/lib/admin/migration-integrity.test.ts` die richtige Form fest.
   * Also: erst pruefen, DASS eine Festlegung da ist, dann den Wert
   * auspacken und auf leer pruefen.
   */
  if not exists (select 1 from pg_proc p,
                      unnest(coalesce(p.proconfig, '{}'::text[])) c
                  where p.oid = v_oid and c like 'search\_path=%') then
    raise exception '0165 Nachbedingung: die Funktion hat gar keine '
      'search_path-Festlegung — eine SECURITY-DEFINER-Funktion ohne festen '
      'Suchpfad ist eine Rechteausweitung.';
  end if;

  if coalesce((select nullif(btrim(substring(c from 'search_path=(.*)$'), '"'), '')
                 from pg_proc p, unnest(coalesce(p.proconfig, '{}'::text[])) c
                where p.oid = v_oid and c like 'search\_path=%'), '(leer)')
     <> '(leer)' then
    raise exception '0165 Nachbedingung: der search_path ist festgelegt, aber '
      'nicht LEER.';
  end if;

  -- Sie darf die Sequenz nicht anfassen. Am Quelltext gemessen, nicht am
  -- Kommentar: dasselbe Muster, mit dem `0162` seine Storage-Zusage prueft.
  if exists (select 1 from pg_proc p
              where p.oid = v_oid
                and (p.prosrc like '%nextval%' or p.prosrc like '%setval%'
                     or p.prosrc like '%sky_id_seq%')) then
    raise exception '0165 Nachbedingung: der Rumpf nennt die Sequenz — '
      'diese Funktion vergibt keine Nummer, sie uebernimmt eine.';
  end if;

  -- Und sie darf den Marktwert nicht kennen.
  if exists (select 1 from pg_proc p
              where p.oid = v_oid and p.prosrc like '%market_price%') then
    raise exception '0165 Nachbedingung: der Rumpf nennt market_price.';
  end if;

  raise notice '0165 ok: system_sync_create_figure steht; nur service_role darf sie '
    '(nicht anon, nicht authenticated, nicht PUBLIC); sie ist SECURITY DEFINER mit '
    'leerem search_path; und sie nennt weder sky_id_seq noch market_price.';
end
$nach$;
-- <<< ENDE: supabase/migrations/0165_system_sync_create_figure.sql


-- ---------------------------------------------------------------------------
-- B  NACHBEDINGUNGEN — noch in derselben Transaktion
--
-- Die Migration prueft sich selbst (Funktion da, prosecdef, leerer
-- search_path, Rechte, und dass ihr Rumpf weder sky_id_seq noch market_price
-- nennt). Hier steht das, was die Migration NICHT wissen kann: dass sich der
-- Bestand nicht bewegt hat.
-- ---------------------------------------------------------------------------
do $lauf_b$
declare
  v_soll text := current_setting('skyisles.b0165', true);
  v_t    text[];
  v_ist  text;
begin
  if v_soll is null then
    raise exception 'ABBRUCH B0: die Ablage aus A6 fehlt.';
  end if;
  v_t := string_to_array(v_soll, '|');

  v_ist := (select count(*) from public.skylanders)::text;
  if v_ist <> v_t[1] then
    raise exception 'ABBRUCH B1: Katalogzeilen % statt %. Diese Datei legt '
      'keine Zeile an.', v_ist, v_t[1];
  end if;

  v_ist := (select count(*) from public.catalog_admin_changes)::text;
  if v_ist <> v_t[2] then
    raise exception 'ABBRUCH B2: Journalzeilen % statt %. Diese Datei ruft die '
      'Funktion nicht auf.', v_ist, v_t[2];
  end if;

  v_ist := (select count(*) from public.shop_inventory)::text;
  if v_ist <> v_t[3] then
    raise exception 'ABBRUCH B3: Lagerzeilen % statt %.', v_ist, v_t[3];
  end if;

  v_ist := (select count(*) from public.collection_items)::text;
  if v_ist <> v_t[4] then
    raise exception 'ABBRUCH B4: Sammlungszeilen % statt %.', v_ist, v_t[4];
  end if;

  v_ist := (select coalesce(md5(string_agg(s.sky_id || '|' || s.name || '|' || s.slug,
                                           chr(10) order by s.sky_id collate "C")), '(leer)')
              from public.skylanders s);
  if v_ist <> v_t[5] then
    raise exception 'ABBRUCH B5: der Katalogabdruck hat sich bewegt (% statt %). '
      'Keine SKY-ID, kein Name und kein Slug darf sich geaendert haben.',
      v_ist, v_t[5];
  end if;

  /*
   * B6 — DIE SEQUENZ IST UNBERUEHRT.
   *
   * Eine erste Fassung dieser Pruefung verglich `sky_id_seq` mit sich selbst
   * und konnte deshalb nie anschlagen. Jetzt steht ihr Stand in der Ablage
   * aus A6 und wird dagegen gehalten: die Funktion zieht nicht, und dieser
   * Lauf ruft sie nicht auf — der Stand MUSS gleich sein.
   */
  v_ist := (select last_value::text || ';' || is_called::text from public.sky_id_seq);
  if v_ist <> v_t[6] then
    raise exception 'ABBRUCH B6: sky_id_seq steht auf % statt %. Dieser Lauf '
      'zieht keine Nummer.', v_ist, v_t[6];
  end if;

  raise notice 'ok: system_sync_create_figure liegt, und der Bestand ist '
    'unveraendert — % Katalogzeilen, % Journalzeilen, % Lagerzeilen, % '
    'Sammlungszeilen, Abdruck %, Sequenz %.',
    v_t[1], v_t[2], v_t[3], v_t[4], v_t[5], v_t[6];
end
$lauf_b$;

commit;
