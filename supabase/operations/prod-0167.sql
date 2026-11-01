-- ===========================================================================
-- PRODUCTION — EIN LAUF FUER 0167
--              (Grabstein, Anlage-Riegel und Entfernungsfunktion fuer die 30
--               OVP-Duplikate — die Entfernung selbst ist ein eigener Vorgang)
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
-- *** SIE ENTFERNT NICHTS ***
--
-- Sie legt eine Tabelle (leer), einen Trigger und zwei Funktionen an. Keine
-- Katalogzeile, kein Importprotokoll, keine Lagerposition, keine Journalzeile
-- wird beruehrt; `sky_id_seq` bleibt, wie er ist. B1-B7 messen das gegen die
-- Ablage aus A6.
--
-- Auf Staging angewendet am 2026-10-31 (`APPLIED.md`), dort berechtigter
-- Postflight 9998 = 0 und 9999 = 0. Die eingebettete Migration ist
-- zeichengleich dieselbe Datei.
--
-- VORHER: `supabase/checks/prod_0167_preflight.sql`, Zeile 9999 = 0, und
-- Zeile 900 als Baseline aufheben. NACHHER: `prod_0167_postflight.sql` mit
-- dieser Baseline.
--
-- ERWARTET: NOTICE A6, NOTICE `0167 ok`, NOTICE `ok: 0167 liegt …`, `commit`.
-- Ruecknahme: `supabase/rollback/R0167_drop_ovp_removal.sql` (nur solange
-- kein Grabstein steht).
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- A0  ZWEI OBERGRENZEN, VOR DEM ERSTEN ZUGRIFF
-- ---------------------------------------------------------------------------
set local lock_timeout = '5s';
set local statement_timeout = '300s';

-- ---------------------------------------------------------------------------
-- A1-A5  WAECHTER — A1-A4 wortgleich aus `prod-0165.sql`
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
      'auf Staging gehoert supabase/operations/staging-0167.sql.';
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

  /* A5 — die eigenen Vorbedingungen, einzeln. */
  if to_regclass('public.catalog_removed_sky_ids') is not null then
    raise exception 'ABBRUCH A5a: catalog_removed_sky_ids liegt schon. Diese Datei laeuft einmal.';
  end if;
  if to_regprocedure('public.system_remove_ovp_figure(text)') is not null then
    raise exception 'ABBRUCH A5b: system_remove_ovp_figure liegt schon.';
  end if;
  if to_regclass('public.inventory_import_rows') is null
     or to_regclass('public.order_lines') is null
     or to_regclass('public.shop_inventory') is null then
    raise exception 'ABBRUCH A5c: eine Tabelle, die die Funktion liest, fehlt '
      '(inventory_import_rows, order_lines, shop_inventory).';
  end if;
  if coalesce((select pg_get_constraintdef(c.oid) from pg_constraint c
                where c.conrelid = to_regclass('public.catalog_admin_changes')
                  and c.conname = 'catalog_admin_changes_field_known'), '') not like '%''deleted''%' then
    raise exception 'ABBRUCH A5d: die Journal-Constraint laesst den Feldwert deleted '
      'nicht zu (0162). Die Funktion wuerde beim ersten Aufruf scheitern.';
  end if;
  select count(*) into v_n from public.skylanders where sky_id in (
    'SKY-0012','SKY-0013','SKY-0018','SKY-0019','SKY-0023','SKY-0024','SKY-0031','SKY-0032',
    'SKY-0036','SKY-0037','SKY-0041','SKY-0042','SKY-0050','SKY-0051','SKY-0057','SKY-0058',
    'SKY-0061','SKY-0062','SKY-0067','SKY-0068','SKY-0072','SKY-0073','SKY-0076','SKY-0077',
    'SKY-0084','SKY-0085','SKY-0090','SKY-0091','SKY-0564','SKY-0591');
  if v_n <> 30 then
    raise exception 'ABBRUCH A5e: von den 30 OVP-Duplikaten stehen % im Katalog, erwartet 30. '
      'Erst klaeren.', v_n;
  end if;
end
$lauf_a$;

-- ---------------------------------------------------------------------------
-- A6  DER BESTAND, von der Huelle selbst gemessen und abgelegt
-- ---------------------------------------------------------------------------
select set_config('skyisles.b0167', (
  select (select count(*) from public.skylanders)::text || '|'
      || (select count(*) from public.catalog_admin_changes)::text || '|'
      || (select count(*) from public.shop_inventory)::text || '|'
      || (select count(*) from public.collection_items)::text || '|'
      || (select count(*) from public.inventory_import_rows)::text || '|'
      || (select coalesce(md5(string_agg(s.sky_id || '|' || s.name || '|' || s.slug,
                                         chr(10) order by s.sky_id collate "C")), '(leer)')
            from public.skylanders s) || '|'
      || (select last_value::text || ';' || is_called::text from public.sky_id_seq)
), true);

do $a6$
begin
  raise notice 'A6: Bestand abgelegt — %', current_setting('skyisles.b0167', true);
end
$a6$;

-- >>> EINGEBETTET: supabase/migrations/0167_ovp_removal.sql
-- ---------------------------------------------------------------------------
-- 0167 — die 30 OVP-Katalogduplikate dauerhaft entfernen koennen (CAT-12)
--
-- BETREIBERENTSCHEIDUNG 2026-10-31 (ADR-0166): die 30 eigenstaendigen
-- OVP-Eintraege — 28 Eon's-Elite-Schachteln, `Kaos in OVP`, `Dark Pyramid -
-- OVP` — verschwinden aus `skylanders`, auf Staging UND Production. OVP
-- bleibt als Bestandszustand an der regulaeren Figur erlaubt
-- (`shop_inventory.condition = 'boxed'`, ADR-0037 §5a).
--
-- WAS DIESE MIGRATION ANLEGT — UND WAS SIE NICHT TUT
--
--   `catalog_removed_sky_ids`         der Grabstein: welche SKY-ID entfernt
--                                     wurde, mit Serie und Name
--   `skylanders_refuse_removed`       BEFORE INSERT: eine SKY-ID mit Grabstein
--                                     wird nie wieder angelegt — von keinem
--                                     Weg: Import, Publish, Bootstrap, SQL
--   `system_remove_ovp_figure(text)`  entfernt EINE der 30, sonst keine
--
-- Sie LOESCHT NICHTS. Die Entfernung selbst ist ein eigener Betriebsvorgang
-- mit eigener Freigabe je Umgebung (`staging-ovp-removal.sql`,
-- `prod-ovp-removal.sql` unter `supabase/operations/`).
--
-- *** DIE ALLGEMEINEN LOESCHSPERREN BLEIBEN, WIE SIE SIND ***
--
-- `admin_delete_figure` (0162) und `admin_discard_draft` (0155) werden nicht
-- angefasst. Diese Funktion ist ENGER als beide: sie kennt genau 30 SKY-IDs,
-- als Konstante im Rumpf, jede mit Serie, Rohname und Kartenkunst — eine
-- Zeile, die nicht EXAKT so aussieht, wird abgewiesen. Eine Liste in einer
-- Tabelle liesse sich erweitern; eine Konstante nur durch eine neue Migration.
--
-- *** WAS SIE MITENTFERNT, UND NUR DAS ***
--
--   `inventory_import_rows`   die Protokollzeilen der Legacy-Lagerimporte zu
--                             DIESER SKY-ID — nur wenn keine eine
--                             Lagerbewegung traegt (`movement_id`)
--   `shop_inventory`          eine Position zu DIESER SKY-ID nur, wenn sie
--                             leer ist (Menge 0, nichts reserviert) und
--                             NICHTS auf sie zeigt — keine Bewegung, keine
--                             Bestellzeile, keine Reservierung, kein Verweis
--                             gleich welcher Art (aus `pg_constraint`)
--   `catalog_editorial`       die interne Notiz der Zeile
--
-- JEDER ANDERE VERWEIS BRICHT AB: Sammlungen, Favoriten, Warenkoerbe,
-- Einkauf, Verkauf, Bestellzeilen (auch `order_lines.sky_id` ohne
-- Fremdschluessel), Angebotsstatus, Benachrichtigungen, Zuordnungen,
-- Altbestand, Varianten — und jede kuenftige Tabelle, die auf `skylanders`
-- zeigt, denn die Pfade kommen aus `pg_constraint` und nicht aus einer Liste.
-- Nichts wird umgehaengt.
--
-- Der Marktwert geht mit der Zeile. Bilder werden NICHT angefasst: jede der
-- 28 Bilddateien wird auch von der regulaeren Figur benutzt (gemessen
-- 2026-10-31, beide Umgebungen), und Storage-Objekte gibt es keine.
--
-- Recht: NUR der Eigentuemer (`postgres`, SQL-Editor). Kein `anon`, kein
-- `authenticated`, kein `service_role` — kein Werkzeug kann sie rufen.
--
-- Ruecknahme: `supabase/rollback/R0167_drop_ovp_removal.sql` — entfernt
-- Funktion und Trigger; den Grabstein nur, solange er leer ist.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen
-- ---------------------------------------------------------------------------
do $vor$
declare
  v_def text;
begin
  if to_regclass('public.skylanders') is null then
    raise exception '0167 Vorbedingung: skylanders fehlt (0001).';
  end if;
  if to_regclass('public.inventory_import_rows') is null then
    raise exception '0167 Vorbedingung: inventory_import_rows fehlt (0048).';
  end if;
  if to_regclass('public.order_lines') is null then
    raise exception '0167 Vorbedingung: order_lines fehlt (0010).';
  end if;
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = to_regclass('public.catalog_admin_changes')
     and c.conname = 'catalog_admin_changes_field_known';
  if v_def is null or v_def not like '%''deleted''%' then
    raise exception '0167 Vorbedingung: das Journal kennt den Feldwert deleted nicht '
      '(0162 muss zuerst angewendet sein).';
  end if;
  if to_regclass('public.catalog_removed_sky_ids') is not null then
    raise exception '0167 Abbruch: catalog_removed_sky_ids steht schon.';
  end if;
end
$vor$;


-- ---------------------------------------------------------------------------
-- 2. Der Grabstein
-- ---------------------------------------------------------------------------
create table public.catalog_removed_sky_ids (
  sky_id      text primary key,
  series_code text not null,
  name        text not null,
  removed_at  timestamptz not null default now(),
  reason      text not null,
  constraint catalog_removed_sky_ids_format check (sky_id ~ '^SKY-[0-9]{4}$')
);

comment on table public.catalog_removed_sky_ids is
  'SKY-IDs that were removed from the catalogue for good (0167, ADR-0166). A row here means: this identity existed, was deliberately removed, and must never be created again - the BEFORE INSERT trigger on skylanders refuses it on every path. The journal (catalog_admin_changes, field deleted) keeps the history; this table keeps the promise.';

alter table public.catalog_removed_sky_ids enable row level security;
revoke all on table public.catalog_removed_sky_ids from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. Nie wieder anlegen
-- ---------------------------------------------------------------------------
create or replace function public.skylanders_refuse_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.catalog_removed_sky_ids r where r.sky_id = new.sky_id) then
    raise exception '0167: % wurde dauerhaft aus dem Katalog entfernt und wird nie wieder '
      'angelegt (ADR-0001, ADR-0166).', new.sky_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function public.skylanders_refuse_removed() is
  'Refuses to insert a catalogue row whose SKY-ID is in catalog_removed_sky_ids (0167). It sits on the table, so no path gets past it - not the legacy import (upsert), not the catalogue publish (system_sync_create_figure), not a bootstrap, not plain SQL.';

revoke all on function public.skylanders_refuse_removed() from public, anon, authenticated;

create trigger skylanders_refuse_removed_trg
  before insert on public.skylanders
  for each row execute function public.skylanders_refuse_removed();


-- ---------------------------------------------------------------------------
-- 4. Eine der 30 entfernen
-- ---------------------------------------------------------------------------
create or replace function public.system_remove_ovp_figure(p_sky_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- DIE 30, wortgleich mit data/catalog/ovp-removal.json (ein Test haelt beide gleich).
  v_liste constant text[][] := array[
    array['SKY-0012', 'SA', 'Elite Boomer', 'elite'],
    array['SKY-0013', 'SA', 'Elite Boomer (2)', 'elite'],
    array['SKY-0018', 'SA', 'Elite Chop Chop', 'elite'],
    array['SKY-0019', 'SA', 'Elite Chop Chop (2)', 'elite'],
    array['SKY-0023', 'SA', 'Elite Dino Rang', 'elite'],
    array['SKY-0024', 'SA', 'Elite Dino Rang (2)', 'elite'],
    array['SKY-0031', 'SA', 'Elite Eruptor', 'elite'],
    array['SKY-0032', 'SA', 'Elite Eruptor (2)', 'elite'],
    array['SKY-0036', 'SA', 'Elite Ghost Roaster', 'elite'],
    array['SKY-0037', 'SA', 'Elite Ghost Roaster (2)', 'elite'],
    array['SKY-0041', 'SA', 'Elite Gill Grunt', 'elite'],
    array['SKY-0042', 'SA', 'Elite Gill Grunt (2)', 'elite'],
    array['SKY-0050', 'SA', 'Elite Slam Bam', 'elite'],
    array['SKY-0051', 'SA', 'Elite Slam Bam (2)', 'elite'],
    array['SKY-0057', 'SA', 'Elite Spyro', 'elite'],
    array['SKY-0058', 'SA', 'Elite Spyro (2)', 'elite'],
    array['SKY-0061', 'SA', 'Elite Stealth Elf', 'elite'],
    array['SKY-0062', 'SA', 'Elite Stealth Elf (2)', 'elite'],
    array['SKY-0067', 'SA', 'Elite Terrafin', 'elite'],
    array['SKY-0068', 'SA', 'Elite Terrafin (2)', 'elite'],
    array['SKY-0072', 'SA', 'Elite Trigger Happy', 'elite'],
    array['SKY-0073', 'SA', 'Elite Trigger Happy (2)', 'elite'],
    array['SKY-0076', 'SA', 'Elite Voodood', 'elite'],
    array['SKY-0077', 'SA', 'Elite Voodood (2)', 'elite'],
    array['SKY-0084', 'SA', 'Elite Whirlwind', 'elite'],
    array['SKY-0085', 'SA', 'Elite Whirlwind (2)', 'elite'],
    array['SKY-0090', 'SA', 'Elite Zook', 'elite'],
    array['SKY-0091', 'SA', 'Elite Zook (2)', 'elite'],
    array['SKY-0564', 'I', 'Kaos in OVP', 'standard'],
    array['SKY-0591', 'I', 'Dark Pyramid - OVP', 'standard']
  ];
  v_i          integer;
  v_serie      text;
  v_name       text;
  v_karte      text;
  v_row        public.skylanders%rowtype;
  r            record;
  v_n          bigint;
  v_fremd      text := '';
  v_importe    bigint := 0;
  v_lager      bigint := 0;
begin
  -- ---- 1. Steht sie auf der Liste?
  for v_i in 1 .. array_length(v_liste, 1) loop
    if v_liste[v_i][1] = p_sky_id then
      v_serie := v_liste[v_i][2]; v_name := v_liste[v_i][3]; v_karte := v_liste[v_i][4];
    end if;
  end loop;
  if v_name is null then
    raise exception '0167: % steht nicht auf der Liste der 30 OVP-Duplikate. Diese '
      'Funktion entfernt nichts anderes.', coalesce(p_sky_id, '<null>')
      using errcode = 'check_violation';
  end if;

  -- ---- 2. Schon entfernt? Dann ist ein zweiter Aufruf ein Nichtstun.
  select * into v_row from public.skylanders where sky_id = p_sky_id for update;
  if not found then
    if exists (select 1 from public.catalog_removed_sky_ids where sky_id = p_sky_id) then
      return jsonb_build_object('sky_id', p_sky_id, 'status', 'schon entfernt');
    end if;
    raise exception '0167: % gibt es nicht, und einen Grabstein auch nicht. Ein '
      'unerwarteter Zustand — nichts wird geschrieben.', p_sky_id;
  end if;

  -- ---- 3. Ist es WIRKLICH diese Zeile?
  if v_row.series_code is distinct from v_serie or v_row.name is distinct from v_name
     or v_row.card_type is distinct from v_karte then
    raise exception '0167: % ist nicht die erwartete Zeile (erwartet %/%/%, '
      'vorgefunden %/%/%). Abbruch.', p_sky_id, v_serie, v_name, v_karte,
      v_row.series_code, v_row.name, v_row.card_type
      using errcode = 'check_violation';
  end if;
  if v_row.catalog_status = 'public' or v_row.catalog_visible then
    raise exception '0167: % ist oeffentlich sichtbar. Eine oeffentliche Zeile wird hier '
      'nicht entfernt — erst ausblenden.', p_sky_id
      using errcode = 'check_violation';
  end if;
  if v_row.base_sky_id is not null
     or exists (select 1 from public.skylanders s where s.base_sky_id = p_sky_id) then
    raise exception '0167: % steht in einer Variantenbeziehung. Abbruch.', p_sky_id
      using errcode = 'check_violation';
  end if;

  -- ---- 4. Die Volkszaehlung der Verweise, aus pg_constraint.
  for r in
    select c.conrelid::regclass::text as tabelle, a.attname::text as spalte
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid
                         and a.attnum = c.conkey[array_position(c.confkey,
                               (select x.attnum from pg_attribute x
                                 where x.attrelid = c.confrelid and x.attname = 'sky_id'))]
     where c.contype = 'f' and c.confrelid = 'public.skylanders'::regclass
       and c.conrelid <> 'public.skylanders'::regclass
  loop
    execute format('select count(*) from %s where %I = $1', r.tabelle, r.spalte)
      into v_n using p_sky_id;
    if v_n = 0 then continue; end if;
    if r.tabelle in ('inventory_import_rows', 'public.inventory_import_rows') then
      v_importe := v_n;
    elsif r.tabelle in ('shop_inventory', 'public.shop_inventory') then
      v_lager := v_n;
    elsif r.tabelle in ('catalog_editorial', 'public.catalog_editorial') then
      null;   -- die interne Notiz geht mit der Zeile
    else
      v_fremd := v_fremd || case when v_fremd = '' then '' else ', ' end
                 || r.tabelle || '.' || r.spalte || '=' || v_n;
    end if;
  end loop;

  -- Der stille Verweis: eine Bestellzeile traegt die SKY-ID als Text.
  select count(*) into v_n from public.order_lines ol where ol.sky_id = p_sky_id;
  if v_n > 0 then
    v_fremd := v_fremd || case when v_fremd = '' then '' else ', ' end
               || 'order_lines.sky_id=' || v_n;
  end if;

  if v_fremd <> '' then
    raise exception '0167: auf % zeigen geschuetzte Daten: %. Nichts wird entfernt, '
      'nichts umgehaengt.', p_sky_id, v_fremd
      using errcode = 'foreign_key_violation';
  end if;

  -- Importprotokolle: keines darf eine Lagerbewegung tragen.
  if exists (select 1 from public.inventory_import_rows i
              where i.sky_id = p_sky_id and i.movement_id is not null) then
    raise exception '0167: ein Importprotokoll zu % traegt eine Lagerbewegung. Abbruch.',
      p_sky_id using errcode = 'foreign_key_violation';
  end if;

  -- Lagerpositionen: nur leere, auf die NICHTS zeigt.
  if v_lager > 0 then
    if exists (select 1 from public.shop_inventory i
                where i.sky_id = p_sky_id and (i.quantity <> 0 or i.reserved <> 0)) then
      raise exception '0167: % hat eine Lagerposition mit Bestand oder Reservierung. Abbruch.',
        p_sky_id using errcode = 'foreign_key_violation';
    end if;
    for r in
      select c.conrelid::regclass::text as tabelle, a.attname::text as spalte
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
       where c.contype = 'f' and c.confrelid = 'public.shop_inventory'::regclass
    loop
      execute format('select count(*) from %s t where t.%I in '
                     '(select i.id from public.shop_inventory i where i.sky_id = $1)',
                     r.tabelle, r.spalte)
        into v_n using p_sky_id;
      if v_n > 0 then
        raise exception '0167: auf die Lagerposition von % zeigt %.% (% Zeile(n)). Abbruch.',
          p_sky_id, r.tabelle, r.spalte, v_n using errcode = 'foreign_key_violation';
      end if;
    end loop;
  end if;

  -- ---- 5. Das Journal ZUERST — es ueberlebt die Zeile (wie 0162).
  insert into public.catalog_admin_changes
    (entity, entity_id, field, old_value, new_value, changed_by)
  values ('skylander', p_sky_id, 'deleted',
          v_row.name || ' | ' || v_row.series_code || ' | ' || v_row.catalog_status
            || ' | ' || v_row.source || coalesce(' | ' || v_row.market_price::text, '')
            || ' | OVP-Duplikat (0167)',
          null, (select auth.uid()));

  -- ---- 6. Die freigegebenen Mitlaeufer, dann die Zeile, dann der Grabstein.
  delete from public.inventory_import_rows where sky_id = p_sky_id;
  delete from public.shop_inventory where sky_id = p_sky_id;
  delete from public.catalog_editorial where sky_id = p_sky_id;
  delete from public.skylanders where sky_id = p_sky_id;
  insert into public.catalog_removed_sky_ids (sky_id, series_code, name, reason)
  values (p_sky_id, v_row.series_code, v_row.name, 'OVP-Duplikat (ADR-0166)');

  return jsonb_build_object('sky_id', p_sky_id, 'status', 'entfernt',
                            'importprotokolle', v_importe, 'lagerpositionen', v_lager);
end;
$$;

comment on function public.system_remove_ovp_figure(text) is
  'Removes ONE of the 30 standalone OVP catalogue duplicates named as a constant in its body (0167, ADR-0166) - nothing else. Verifies series, raw name and card art, refuses a public row and any variant relation, and counts every reference from pg_constraint plus order_lines.sky_id: only legacy import log rows (without a stock movement), an EMPTY inventory position nothing points at, and the internal note go with it; anything else aborts, nothing is re-pointed. Journals deleted before deleting, writes the tombstone after. A second call on a removed id is a no-op. Owner only - no client role and no service role may call it.';

revoke all on function public.system_remove_ovp_figure(text) from public, anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 5. Nachbedingungen
-- ---------------------------------------------------------------------------
do $nach$
declare
  v_oid oid := to_regprocedure('public.system_remove_ovp_figure(text)');
begin
  if v_oid is null then
    raise exception '0167 Nachbedingung: system_remove_ovp_figure steht nicht.';
  end if;
  if has_function_privilege('anon', v_oid, 'execute')
     or has_function_privilege('authenticated', v_oid, 'execute')
     or has_function_privilege('public', v_oid, 'execute')
     or (exists (select 1 from pg_roles where rolname = 'service_role')
         and has_function_privilege('service_role', v_oid, 'execute')) then
    raise exception '0167 Nachbedingung: eine Client- oder Dienstrolle darf die '
      'Entfernungsfunktion ausfuehren.';
  end if;
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'public.skylanders'::regclass
                    and t.tgname = 'skylanders_refuse_removed_trg') then
    raise exception '0167 Nachbedingung: der Anlage-Riegel fehlt.';
  end if;
  if (select count(*) from public.catalog_removed_sky_ids) <> 0 then
    raise exception '0167 Nachbedingung: der Grabstein ist nicht leer.';
  end if;
  raise notice '0167 ok: Grabstein leer, Anlage-Riegel steht, system_remove_ovp_figure '
    'nur fuer den Eigentuemer. Es wurde NICHTS entfernt.';
end
$nach$;
-- <<< ENDE: supabase/migrations/0167_ovp_removal.sql

-- ---------------------------------------------------------------------------
-- B  NACHBEDINGUNGEN — noch in derselben Transaktion
-- ---------------------------------------------------------------------------
do $lauf_b$
declare
  v_soll text := current_setting('skyisles.b0167', true);
  v_t    text[];
  v_ist  text;
begin
  if v_soll is null then
    raise exception 'ABBRUCH B0: die Ablage aus A6 fehlt.';
  end if;
  v_t := string_to_array(v_soll, '|');

  v_ist := (select count(*) from public.skylanders)::text;
  if v_ist <> v_t[1] then
    raise exception 'ABBRUCH B1: Katalogzeilen % statt %. 0167 entfernt nichts.', v_ist, v_t[1];
  end if;
  v_ist := (select count(*) from public.catalog_admin_changes)::text;
  if v_ist <> v_t[2] then
    raise exception 'ABBRUCH B2: Journalzeilen % statt %.', v_ist, v_t[2];
  end if;
  v_ist := (select count(*) from public.shop_inventory)::text;
  if v_ist <> v_t[3] then
    raise exception 'ABBRUCH B3: Lagerzeilen % statt %.', v_ist, v_t[3];
  end if;
  v_ist := (select count(*) from public.collection_items)::text;
  if v_ist <> v_t[4] then
    raise exception 'ABBRUCH B4: Sammlungszeilen % statt %.', v_ist, v_t[4];
  end if;
  v_ist := (select count(*) from public.inventory_import_rows)::text;
  if v_ist <> v_t[5] then
    raise exception 'ABBRUCH B5: Importprotokolle % statt %.', v_ist, v_t[5];
  end if;
  v_ist := (select coalesce(md5(string_agg(s.sky_id || '|' || s.name || '|' || s.slug,
                                           chr(10) order by s.sky_id collate "C")), '(leer)')
              from public.skylanders s);
  if v_ist <> v_t[6] then
    raise exception 'ABBRUCH B6: der Katalogabdruck hat sich bewegt (% statt %).', v_ist, v_t[6];
  end if;
  v_ist := (select last_value::text || ';' || is_called::text from public.sky_id_seq);
  if v_ist <> v_t[7] then
    raise exception 'ABBRUCH B7: sky_id_seq steht auf % statt %.', v_ist, v_t[7];
  end if;
  if (select count(*) from public.catalog_removed_sky_ids) <> 0 then
    raise exception 'ABBRUCH B8: der Grabstein ist nicht leer.';
  end if;

  raise notice 'ok: 0167 liegt, und der Bestand ist unveraendert — % Katalogzeilen, % '
    'Journalzeilen, % Lagerzeilen, % Sammlungszeilen, % Importprotokolle, Abdruck %, '
    'Sequenz %; Grabstein leer.', v_t[1], v_t[2], v_t[3], v_t[4], v_t[5], v_t[6], v_t[7];
end
$lauf_b$;

commit;
