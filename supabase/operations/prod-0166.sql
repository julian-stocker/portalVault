-- ===========================================================================
-- PRODUCTION — EIN LAUF FUER 0166
--              (eine Figur als Variante einer Basisfigur in EINER Transaktion)
--
-- ###########################################################################
-- ##  DIES IST EINE PRODUCTION-DATEI. Projekt zmiwxswrpkmizvqsgype.        ##
-- ##  Sie bricht auf Staging ab, und zwar bevor sie etwas anfasst.         ##
-- ###########################################################################
--
-- EINE DATEI, EINE TRANSAKTION, EIN EINFUEGEN. Vollstaendig markieren, in den
-- SQL-Editor des Production-Projekts zmiwxswrpkmizvqsgype einfuegen,
-- ausfuehren. Nichts in Teilen. KEINE automatische Wiederholung: ein zweiter
-- Lauf bricht an A5a ab (die Migration selbst ebenso).
--
-- *** SIE LEGT EINE FUNKTION AN — SONST NICHTS ***
--
-- `admin_create_variant_figure(text,text,text,bigint,text,boolean,text,text)`.
-- Keine Tabelle, keine Spalte, keine Zeile, kein Trigger, kein veraendertes
-- Recht an Bestehendem. Sie ruft die Funktion nicht auf. B1-B6 messen das
-- gegen die Ablage aus A6 — Katalog, Journal, Lager, Bestellzeilen, ein
-- Katalogabdruck MIT Variantenbeziehung, Types und Banner, und die Sequenz.
-- Nutzerdaten (Sammlungen, Favoriten) liegen ausserhalb dessen, was 0166
-- beruehren kann, und werden deshalb NICHT blockierend verglichen — sie
-- bewegen sich im laufenden Betrieb (Lehre aus P-1, 0167, Zeile 804).
--
-- Auf Staging angewendet am 2026-10-31 (`APPLIED.md`), berechtigter
-- Postflight 9998 = 0 und 9999 = 0. Die eingebettete Migration ist
-- zeichengleich dieselbe Datei.
--
-- VORHER: `supabase/checks/prod_0166_preflight.sql`, 9999 = 0.
-- NACHHER: `supabase/operations/prod-s-postflight-0166.sql` (Baseline aus
-- Preflight-Zeile 900 einsetzen; begin … rollback).
--
-- Der SQL-Editor zeigt keine NOTICE-Meldungen. Erwartet: „Success".
-- Ruecknahme: `supabase/rollback/R0166_drop_admin_create_variant_figure.sql`.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- A0  ZWEI OBERGRENZEN, VOR DEM ERSTEN ZUGRIFF
-- ---------------------------------------------------------------------------
set local lock_timeout = '5s';
set local statement_timeout = '300s';

-- ---------------------------------------------------------------------------
-- A1-A5  WAECHTER — A1-A4 wortgleich aus `prod-0165.sql`/`prod-0167.sql`
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
      'auf Staging gehoert supabase/operations/staging-0166.sql.';
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

  /* A0 — zusaetzlich der Datenbankstempel: auf Staging steht er, hier darf er
     nicht stehen. Die Schema-Riegel A1/A2 fangen Staging schon; dieser kostet
     nichts und faengt auch eine Kopie mit Production-Schema. */
  if coalesce((select shobj_description(d.oid, 'pg_database') from pg_database d
                where d.datname = current_database()), '')
     = 'skyisles-staging qqxcpesbwfxzgytkdsac' then
    raise exception 'ABBRUCH A1: das ist Staging (Datenbankstempel). Diese Datei ist fuer '
      'Production (zmiwxswrpkmizvqsgype); auf Staging gehoert staging-0166.sql.';
  end if;

  /* A5 — die eigenen Vorbedingungen, einzeln. */
  if to_regprocedure('public.admin_create_variant_figure(text,text,text,bigint,text,boolean,text,text)') is not null then
    raise exception 'ABBRUCH A5a: admin_create_variant_figure liegt schon. Diese Datei laeuft einmal.';
  end if;
  if to_regprocedure('public.admin_create_figure(text,text,bigint,text,boolean,text,text,text)') is null then
    raise exception 'ABBRUCH A5b: admin_create_figure fehlt (0152). 0166 ruft sie auf.';
  end if;
  if to_regprocedure('public.admin_set_variant_base(text,text,boolean)') is null then
    raise exception 'ABBRUCH A5c: admin_set_variant_base fehlt (0159). 0166 ruft sie auf.';
  end if;
  if to_regprocedure('public.admin_set_figure_types(text,text[])') is null then
    raise exception 'ABBRUCH A5d: admin_set_figure_types fehlt (0163). 0166 ruft sie auf.';
  end if;
  if to_regprocedure('public.admin_set_visible_type(text,text)') is null then
    raise exception 'ABBRUCH A5e: admin_set_visible_type fehlt (0163). 0166 ruft sie auf.';
  end if;
  if to_regprocedure('public.is_platform_admin()') is null then
    raise exception 'ABBRUCH A5f: is_platform_admin fehlt (0026/0077). 0166 ruft sie auf.';
  end if;
  select count(*) into v_n from pg_attribute a
   where a.attrelid = to_regclass('public.skylanders') and not a.attisdropped
     and a.attname in ('base_sky_id', 'types', 'visible_type', 'visible_type_decided', 'catalog_status');
  if v_n <> 5 then
    raise exception 'ABBRUCH A5g: von den fuenf Spalten aus 0152/0159/0163 stehen %.', v_n;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'skylanders_base_same_series')
     or not exists (select 1 from pg_trigger where tgname = 'skylanders_variant_base_guard_trg') then
    raise exception 'ABBRUCH A5h: die Variantenriegel aus 0159 fehlen (Serienschluessel oder Kettenriegel).';
  end if;
  if coalesce((select pg_get_constraintdef(c.oid) from pg_constraint c
                where c.conrelid = to_regclass('public.catalog_admin_changes')
                  and c.conname = 'catalog_admin_changes_field_known'), '') not like '%''created''%' or
     coalesce((select pg_get_constraintdef(c.oid) from pg_constraint c
                where c.conrelid = to_regclass('public.catalog_admin_changes')
                  and c.conname = 'catalog_admin_changes_field_known'), '') not like '%''types''%' or
     coalesce((select pg_get_constraintdef(c.oid) from pg_constraint c
                where c.conrelid = to_regclass('public.catalog_admin_changes')
                  and c.conname = 'catalog_admin_changes_field_known'), '') not like '%''base_sky_id''%' or
     coalesce((select pg_get_constraintdef(c.oid) from pg_constraint c
                where c.conrelid = to_regclass('public.catalog_admin_changes')
                  and c.conname = 'catalog_admin_changes_field_known'), '') not like '%''visible_type''%' then
    raise exception 'ABBRUCH A5i: das Journal kennt created, types, base_sky_id oder visible_type nicht — '
      'die aufgerufenen Funktionen schrieben ihre Journalzeile nicht.';
  end if;
end
$lauf_a$;

-- ---------------------------------------------------------------------------
-- A6  DER BESTAND, von der Huelle selbst gemessen und abgelegt
-- ---------------------------------------------------------------------------
select set_config('skyisles.b0166', (
  select (select count(*) from public.skylanders)::text || '|'
      || (select count(*) from public.catalog_admin_changes)::text || '|'
      || (select count(*) from public.shop_inventory)::text || '|'
      || (select count(*) from public.order_lines)::text || '|'
      || (select coalesce(md5(string_agg(s.sky_id || '|' || s.name || '|' || s.slug || '|'
                                         || coalesce(s.base_sky_id, '~') || '|'
                                         || array_to_string(s.types, '+') || '|'
                                         || coalesce(s.visible_type, '~'),
                                         chr(10) order by s.sky_id collate "C")), '(leer)')
            from public.skylanders s) || '|'
      || (select last_value::text || ';' || is_called::text from public.sky_id_seq)
), true);

-- >>> EINGEBETTET: supabase/migrations/0166_admin_create_variant_figure.sql
-- ---------------------------------------------------------------------------
-- 0166 — eine Variante in EINEM Schritt anlegen (CAT-11)
--
-- WOFUER
--
-- Der Dialog „Neue Figur" bekommt ein Feld „Variante von". Bisher war eine
-- Variante ZWEI Vorgaenge: die Figur anlegen (`admin_create_figure`, 0152),
-- danach im Bearbeiten die Basisfigur zuordnen (`admin_set_variant_base`,
-- 0159) und die Types setzen (`admin_set_figure_types`/`admin_set_visible_type`,
-- 0163). Ueber PostgREST sind das vier Anfragen und KEINE Transaktion. Bricht
-- die dritte ab, steht eine Figur im Katalog, die nach Variante aussieht und
-- keine ist — genau der Zustand, in dem `Silver Boomer` (SKY-0929) heute
-- steht: angelegt, `card_type = chase`, aber ohne `base_sky_id`, ohne Type
-- und ohne Banner.
--
-- *** KEINE ZWEITE VARIANTENLOGIK ***
--
-- Diese Funktion schreibt KEINE Spalte selbst. Sie ruft die vier
-- vorhandenen Schreibwege in fester Reihenfolge, in EINEM Rumpf, also in
-- EINER Transaktion:
--
--   1. `admin_create_figure`     SKY-ID aus `sky_id_seq`, Slug, `created`
--                                im Journal; Charakter aus der Basisfigur
--                                (die Basisfigur ist die Vorlage, ADR-0070a)
--   2. `admin_set_variant_base`  `base_sky_id` — mit allen Riegeln aus 0159:
--                                dieselbe Serie, keine Kette, nicht sie selbst
--   3. `admin_set_figure_types`  die Typmenge
--   4. `admin_set_visible_type`  das Banner, `visible_type_decided = true`
--
-- Jede dieser Funktionen prueft `is_platform_admin()` selbst und schreibt
-- ihre eigene Journalzeile. Scheitert eine, nimmt der Abbruch ALLE mit:
-- keine halbe Figur, keine Zuordnung ohne Figur. Was ein Abbruch nicht
-- zuruecknimmt, ist die gezogene Sequenznummer — Sequenzen sind nicht
-- transaktional, und eine verbrauchte SKY-ID kommt nie wieder (ADR-0001).
-- Das ist gewollt und derselbe Fall wie bei jedem `admin_create_figure`.
--
-- *** DIE TYPMENGE, UND WAS VON DER BASISFIGUR KOMMT ***
--
-- Die Variante bekommt den gewaehlten Variantentype UND die Figurenart der
-- Basisfigur: eine Variante eines Giant ist ein Giant, eine Variante eines
-- Swappers ein Swapper. Die VARIANTENtypes der Basisfigur kommen NICHT mit —
-- eine Chase-Variante einer Legendary-Figur ist nicht von selbst Legendary.
-- Die Liste der sieben Variantentypes ist dieselbe wie
-- `TYPE_GROUPS.variants` in `src/lib/catalog/catalog-type.ts`; ein Test
-- haelt beide gleich.
--
-- Die KARTENKUNST (`card_type`) bleibt ein eigener Parameter (ADR-0160):
-- der Dialog schlaegt sie vor, entschieden wird sie hier nicht.
--
-- *** EINE BASISFIGUR IST KEIN ENTWURF ***
--
-- Der reguläre Publish (ADR-0164) traegt Entwuerfe nicht nach Production.
-- Eine Variante, deren Basisfigur ein Entwurf ist, kaeme dort mit einer
-- `base_sky_id` an, die auf nichts zeigt — und der zusammengesetzte
-- Fremdschluessel aus 0159 wuerde den Publish mitten im Lauf abbrechen.
-- Darum weist diese Funktion eine Entwurfs-Basisfigur ab, mit Namen.
-- `admin_set_variant_base` selbst bleibt unveraendert.
--
-- *** WAS DIESE MIGRATION NICHT TUT ***
--
-- Keine Tabelle, keine Spalte, keine Zeile, kein Trigger, kein Backfill,
-- keine Aenderung an einer bestehenden Funktion, kein veraendertes Recht an
-- etwas Bestehendem. Sie verknuepft weder `SKY-0929` noch `SKY-0836` mit
-- Boomer — das ist eine eigene Entscheidung mit eigener Freigabe.
--
-- Ruecknahme: `supabase/rollback/R0166_drop_admin_create_variant_figure.sql`.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen
-- ---------------------------------------------------------------------------
do $vor$
begin
  if to_regprocedure('public.admin_create_figure(text,text,bigint,text,boolean,text,text,text)') is null then
    raise exception '0166 Vorbedingung: admin_create_figure fehlt (0152).';
  end if;
  if to_regprocedure('public.admin_set_variant_base(text,text,boolean)') is null then
    raise exception '0166 Vorbedingung: admin_set_variant_base fehlt (0159).';
  end if;
  if to_regprocedure('public.admin_set_figure_types(text,text[])') is null then
    raise exception '0166 Vorbedingung: admin_set_figure_types fehlt (0163).';
  end if;
  if to_regprocedure('public.admin_set_visible_type(text,text)') is null then
    raise exception '0166 Vorbedingung: admin_set_visible_type fehlt (0163).';
  end if;
  if to_regprocedure('public.is_platform_admin()') is null then
    raise exception '0166 Vorbedingung: is_platform_admin fehlt (0026/0077).';
  end if;
  if to_regprocedure('public.admin_create_variant_figure(text,text,text,bigint,text,boolean,text,text)') is not null then
    raise exception '0166 Abbruch: admin_create_variant_figure steht schon.';
  end if;
end
$vor$;


-- ---------------------------------------------------------------------------
-- 2. Die Funktion
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_variant_figure(
  p_base_sky_id           text,
  p_name                  text,
  p_variant_type          text,
  -- NULL heisst: die Kategorie der Basisfigur.
  p_category_id           bigint  default null,
  p_card_type             text    default 'standard',
  p_catalog_visible       boolean default false,
  p_display_name_override text    default null,
  p_admin_note            text    default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_basis  public.skylanders%rowtype;
  v_typ    text := nullif(btrim(coalesce(p_variant_type, '')), '');
  v_sky_id text;
  v_types  text[];
  -- Dieselben sieben wie TYPE_GROUPS.variants in catalog-type.ts.
  v_varianten constant text[] := array['lightcore', 'special', 'dark', 'legendary',
                                       'elite', 'chase', 'prestige'];
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  if v_typ is null or not (v_typ = any (v_varianten)) then
    raise exception '0166: „%" ist kein Variantentype. Erlaubt sind: %.',
      coalesce(v_typ, ''), array_to_string(v_varianten, ', ')
      using errcode = 'check_violation';
  end if;

  select * into v_basis from public.skylanders
   where sky_id = btrim(coalesce(p_base_sky_id, ''));
  if not found then
    raise exception '0166: die Basisfigur % gibt es nicht', coalesce(p_base_sky_id, '<null>')
      using errcode = 'no_data_found';
  end if;

  -- Lesbare Saetze fuer die zwei Faelle, die der Publish nicht tragen kann.
  -- Die Kettenregel prueft 0159 noch einmal; hier steht sie, damit der
  -- Abbruch VOR der Nummernvergabe kommt und keine SKY-ID kostet.
  if v_basis.base_sky_id is not null then
    raise exception '0166: % ist selbst eine Variante (von %). Die Basisfigur '
      'muss eine Basisfigur sein.', v_basis.sky_id, v_basis.base_sky_id
      using errcode = 'check_violation';
  end if;
  if v_basis.catalog_status = 'draft' then
    raise exception '0166: % ist ein Entwurf. Eine Basisfigur muss veroeffentlicht '
      'oder ausgeblendet sein — Entwuerfe traegt der Publish nicht nach Production.',
      v_basis.sky_id
      using errcode = 'check_violation';
  end if;

  -- 1. Die Figur. Serie IMMER die der Basisfigur (0159: dieselbe Serie),
  --    die Basisfigur als Vorlage: ihr Charakter kommt mit, sonst keiner.
  v_sky_id := public.admin_create_figure(
    p_name, v_basis.series_code, coalesce(p_category_id, v_basis.category_id),
    p_card_type, p_catalog_visible, p_display_name_override, p_admin_note,
    v_basis.sky_id);

  -- 2. Die Zuordnung. Keine Familie wird neu angelegt.
  perform public.admin_set_variant_base(v_sky_id, v_basis.sky_id, false);

  -- 3. Die Typmenge: die Figurenart der Basisfigur plus der Variantentype.
  select coalesce(array_agg(t), '{}'::text[]) into v_types
    from (select distinct t
            from unnest(coalesce(v_basis.types, '{}'::text[]) || array[v_typ]) t
           where t = v_typ or not (t = any (v_varianten))) x;
  perform public.admin_set_figure_types(v_sky_id, v_types);

  -- 4. Das Banner.
  perform public.admin_set_visible_type(v_sky_id, v_typ);

  return v_sky_id;
end;
$$;

comment on function public.admin_create_variant_figure(text,text,text,bigint,text,boolean,text,text) is
  'Creates a catalogue figure AS A VARIANT of an existing base figure, in one transaction (0166, CAT-11). It writes no column itself: it calls admin_create_figure (SKY-ID, slug, created journal row, character taken from the base), admin_set_variant_base (base_sky_id, with every 0159 guard), admin_set_figure_types (the base''s figure kind plus the variant type, never the base''s own variant types) and admin_set_visible_type (the variant type as banner). If any step fails, all of them roll back; only the drawn sequence number stays spent (ADR-0001). The series is always the base''s. Refuses a base that is itself a variant or still a draft - the regular publish does not carry drafts, and a variant pointing at one would break it. Platform admins only.';

revoke all on function public.admin_create_variant_figure(text,text,text,bigint,text,boolean,text,text) from public, anon;
grant execute on function public.admin_create_variant_figure(text,text,text,bigint,text,boolean,text,text) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Nachbedingungen
-- ---------------------------------------------------------------------------
do $nach$
declare
  v_oid oid := to_regprocedure(
    'public.admin_create_variant_figure(text,text,text,bigint,text,boolean,text,text)');
begin
  if v_oid is null then
    raise exception '0166 Nachbedingung: die Funktion steht nicht.';
  end if;
  if not (select p.prosecdef from pg_proc p where p.oid = v_oid) then
    raise exception '0166 Nachbedingung: die Funktion ist nicht SECURITY DEFINER.';
  end if;
  if coalesce((select nullif(btrim(substring(c from 'search_path=(.*)$'), '"'), '')
                 from pg_proc p, unnest(coalesce(p.proconfig, '{}'::text[])) c
                where p.oid = v_oid and c like 'search\_path=%'), '(leer)')
     <> '(leer)' then
    raise exception '0166 Nachbedingung: der search_path ist nicht LEER.';
  end if;
  if has_function_privilege('anon', v_oid, 'execute')
     or has_function_privilege('public', v_oid, 'execute') then
    raise exception '0166 Nachbedingung: anon oder PUBLIC darf die Funktion ausfuehren.';
  end if;
  if not has_function_privilege('authenticated', v_oid, 'execute') then
    raise exception '0166 Nachbedingung: authenticated darf die Funktion nicht ausfuehren '
      '— der Adminbereich erreicht sie dann nicht.';
  end if;
  -- Sie vergibt selbst keine Nummer und kennt keinen Preis.
  if exists (select 1 from pg_proc p
              where p.oid = v_oid
                and (p.prosrc like '%nextval%' or p.prosrc like '%setval%'
                     or p.prosrc like '%sky_id_seq%' or p.prosrc like '%market_price%')) then
    raise exception '0166 Nachbedingung: der Rumpf nennt die Sequenz oder market_price.';
  end if;
  -- Und sie schreibt keine Spalte selbst — nur ueber die vier Schreibwege.
  if exists (select 1 from pg_proc p
              where p.oid = v_oid
                and (p.prosrc ~* '\mupdate\s+public\.skylanders'
                     or p.prosrc ~* '\minsert\s+into\s+public\.')) then
    raise exception '0166 Nachbedingung: der Rumpf schreibt selbst eine Tabelle.';
  end if;

  raise notice '0166 ok: admin_create_variant_figure steht; SECURITY DEFINER mit leerem '
    'search_path; authenticated darf sie, anon und PUBLIC nicht; sie schreibt nur ueber '
    'admin_create_figure, admin_set_variant_base, admin_set_figure_types und '
    'admin_set_visible_type.';
end
$nach$;
-- <<< ENDE: supabase/migrations/0166_admin_create_variant_figure.sql

-- ---------------------------------------------------------------------------
-- B  NACHBEDINGUNGEN — noch in derselben Transaktion
-- ---------------------------------------------------------------------------
do $lauf_b$
declare
  v_soll text := current_setting('skyisles.b0166', true);
  v_t    text[];
  v_ist  text;
begin
  if v_soll is null then
    raise exception 'ABBRUCH B0: die Ablage aus A6 fehlt.';
  end if;
  v_t := string_to_array(v_soll, '|');
  if (select count(*) from public.skylanders)::text <> v_t[1] then
    raise exception 'ABBRUCH B1: Katalogzeilen bewegt. 0166 legt keine Zeile an.';
  end if;
  if (select count(*) from public.catalog_admin_changes)::text <> v_t[2] then
    raise exception 'ABBRUCH B2: Journalzeilen bewegt. 0166 ruft nichts auf.';
  end if;
  if (select count(*) from public.shop_inventory)::text <> v_t[3] then
    raise exception 'ABBRUCH B3: Lagerzeilen bewegt.';
  end if;
  if (select count(*) from public.order_lines)::text <> v_t[4] then
    raise exception 'ABBRUCH B4: Bestellzeilen bewegt.';
  end if;
  v_ist := (select coalesce(md5(string_agg(s.sky_id || '|' || s.name || '|' || s.slug || '|'
                                           || coalesce(s.base_sky_id, '~') || '|'
                                           || array_to_string(s.types, '+') || '|'
                                           || coalesce(s.visible_type, '~'),
                                           chr(10) order by s.sky_id collate "C")), '(leer)')
              from public.skylanders s);
  if v_ist <> v_t[5] then
    raise exception 'ABBRUCH B5: Katalog, Variantenbeziehung, Types oder Banner haben sich bewegt.';
  end if;
  if (select last_value::text || ';' || is_called::text from public.sky_id_seq) <> v_t[6] then
    raise exception 'ABBRUCH B6: sky_id_seq hat sich bewegt — 0166 zieht keine Nummer.';
  end if;
  raise notice 'ok: 0166 liegt, der Bestand ist unveraendert — %', v_soll;
end
$lauf_b$;

commit;
