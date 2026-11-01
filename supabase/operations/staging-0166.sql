-- ===========================================================================
-- STAGING — EIN LAUF FUER 0166
--            (eine Variante in EINEM Schritt anlegen)
--
-- EINE DATEI, EINE TRANSAKTION, EIN EINFUEGEN. Vollstaendig markieren, in den
-- SQL-Editor des Staging-Projekts qqxcpesbwfxzgytkdsac einfuegen, ausfuehren.
-- Ueblicher Weg: `npm run db:migrate:staging -- 0166`, dann die eine
-- schreibende Anweisung — diese Datei — im SQL-Editor, dann
-- `npm run db:migrate:staging -- 0166 --resume`.
--
-- *** SIE LEGT EINE FUNKTION AN — SONST NICHTS ***
--
-- Keine Tabelle, keine Spalte, keine Zeile, kein Trigger, kein veraendertes
-- Recht an etwas Bestehendem. Sie ruft die Funktion auch nicht auf: nach
-- diesem Lauf stehen genau so viele Katalog- und Journalzeilen da wie vorher,
-- und `sky_id_seq` ist unberuehrt. Silver Boomer wird NICHT verknuepft.
--
-- ERWARTET: die NOTICE-Zeile der Migration und `commit`.
-- ===========================================================================

begin;

do $lauf_a$
begin
  /*
   * A1 — DER UMGEBUNGSSTEMPEL. Der Datenbankkommentar, den auch der lesende
   * Pruefzugang als erste Anweisung jeder Sitzung prueft
   * (`tools/lib/staging-db.mts`, STEMPEL_ABFRAGE). Das alte Paar
   * SKY-0821/SKY-0822 traegt seit der Umnummerierung vom 2026-10-30 nicht
   * mehr (`supabase/checks/open_verifications.md`, 0d).
   */
  if coalesce((select shobj_description(d.oid, 'pg_database') from pg_database d
                where d.datname = current_database()), '')
     <> 'skyisles-staging qqxcpesbwfxzgytkdsac' then
    raise exception 'ABBRUCH A1: Umgebungsstempel nicht gefunden. Diese Datei '
      'laeuft nur auf Staging qqxcpesbwfxzgytkdsac.';
  end if;

  /*
   * A3 — DER BESTAND, ALS NOTICE. Diese Zahlen muessen nach dem Lauf
   * unveraendert sein; die Journalzeilen stehen nur hier, weil dem lesenden
   * Pruefzugang `catalog_admin_changes` nicht geteilt ist.
   */
  raise notice 'A3: % Katalogzeilen, % Journalzeilen, sky_id_seq bei % '
    '(is_called %). Nach diesem Lauf muss jede dieser Zahlen gleich sein.',
    (select count(*) from public.skylanders),
    (select count(*) from public.catalog_admin_changes),
    (select last_value from public.sky_id_seq),
    (select is_called from public.sky_id_seq);
end
$lauf_a$;

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

commit;
