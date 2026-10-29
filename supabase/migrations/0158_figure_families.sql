-- ---------------------------------------------------------------------------
-- 0158 — Figurenfamilien administrativ verwalten, und der dritte Importweg
--
-- CAT-06 Phase 2. Drei Funktionen und ein elfter Journalwert. Sie bauen
-- ausschliesslich auf dem vorhandenen Modell auf:
--
--     skylanders.character_id -> characters.id          (`0002`)
--
-- *** KEINE ZWEITE VARIANTENLOGIK ***
--
-- Diese Beziehung IST die Figurenfamilie, und sie war es von Anfang an: eine
-- stabile ID (kein Name, ADR-0011/ADR-0016), kuratiert, `on delete restrict`,
-- EINE Spalte — zwei widersprechende Familien sind damit strukturell
-- unmoeglich —, und nullable, weil NULL „nicht zuverlaessig bekannt" heisst
-- und nicht „keine" (ADR-0010). Der Spaltenkommentar aus `0002` nennt genau
-- den Anwendungsfall: „other figures of this character".
--
-- Was gefehlt hat, war kein Modell, sondern ein SCHREIBWEG. Gesetzt wurde
-- `character_id` bisher nur von `tools/import-characters.mts` (aus
-- `data/characters/characters.json`, lokal, mit Service-Role-Key) und
-- beilaeufig von der Zusammenfuehrung. `admin_create_figure` laesst sie
-- ausdruecklich NULL. In der Oberflaeche war sie nicht korrigierbar.
--
-- *** VIER BEGRIFFE, DIE NICHT VERMISCHT WERDEN ***
--
--   Figurenfamilie   `character_id`   wer das ist
--   Spielserie       `series_code`    wo es herkommt
--   Edition          `card_type`      auf welcher Karte es gedruckt ist
--   Katalogeintrag   `sky_id`         welches Sammelobjekt es ist
--
-- Jeder ist unabhaengig von den anderen. Eine Familie darf Figuren in
-- mehreren Serien haben (heute 13 von 20), eine Edition sagt nichts ueber
-- die Familie, und ein Name sagt ueber keines von beidem etwas Verbindliches.
--
-- *** DER NAME IST EIN EIGENSTAENDIGES REDAKTIONELLES ATTRIBUT ***
--
-- Keine dieser Funktionen liest, schreibt oder leitet einen Namen ab. Die
-- Familienzuordnung geschieht ueber die ID, nicht ueber ein Praefix — eine
-- Figur wird NIE allein wegen „Chrome " einer Familie zugeschlagen. Und
-- keine erzeugt einen Namen im Format `Grundfigur (Variante)`: die
-- Klammerschreibweise wird abgeschafft (CAT-06), und was hier entsteht,
-- entsteht ohne sie.
--
-- *** WAS DIESE MIGRATION NICHT TUT ***
--
-- Sie aendert KEINE Zeile: kein `update` auf Bestandsdaten, kein Backfill,
-- keine Massenverknuepfung, keine Umbenennung. Die 561 sammelbaren Zeilen
-- ohne Familie bleiben ohne Familie, bis jemand einzeln entscheidet.
-- `0154`-`0157` bleiben unveraendert.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Vorbedingungen
-- ---------------------------------------------------------------------------
do $vor$
declare
  v_def text;
begin
  if to_regclass('public.characters') is null then
    raise exception '0158 Vorbedingung: characters fehlt (0002).';
  end if;
  if not exists (select 1 from pg_attribute a
                  where a.attrelid = to_regclass('public.skylanders')
                    and a.attname = 'character_id' and not a.attisdropped) then
    raise exception '0158 Vorbedingung: skylanders.character_id fehlt (0002).';
  end if;
  if to_regprocedure('public.admin_set_catalog_status(text,text)') is null then
    raise exception '0158 Vorbedingung: admin_set_catalog_status fehlt (0152) '
      '— Weg B benutzt sie, damit es EINEN Veroeffentlichungsweg gibt.';
  end if;
  if to_regprocedure('public.is_platform_admin()') is null then
    raise exception '0158 Vorbedingung: is_platform_admin fehlt (0026/0077).';
  end if;

  -- DIE CONSTRAINT MUSS DIE AUS `0157` SEIN. Steht dort eine fremde Fassung,
  -- wird sie nicht stillschweigend ersetzt.
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = to_regclass('public.catalog_admin_changes')
     and c.conname = 'catalog_admin_changes_field_known';
  if v_def is null then
    raise exception '0158 Vorbedingung: catalog_admin_changes_field_known fehlt.';
  end if;
  if v_def not like '%merged_from%' or v_def not like '%discarded%'
     or v_def not like '%catalog_status%' then
    raise exception '0158 Vorbedingung: die Constraint ist nicht die aus 0157 '
      '(%). 0157 muss zuerst angewendet sein.', v_def;
  end if;
  -- Der eindeutige Index auf dem gefalteten Namen ist der Dublettenschutz.
  if not exists (select 1 from pg_class c
                  where c.relname = 'characters_canonical_name_key'
                    and c.relkind = 'i') then
    raise exception '0158 Vorbedingung: characters_canonical_name_key fehlt '
      '(0002) — ohne ihn gibt es keinen Dublettenschutz fuer Familien.';
  end if;
end
$vor$;


-- ---------------------------------------------------------------------------
-- 2. Das Journal kennt einen elften Wert
--
-- Dieselbe Lehre wie in `0157`, und sie hat dort einen Tag gekostet: wer eine
-- Spalte journalisiert, muss ihren Namen in die Liste aufnehmen. `0152` hat
-- das vergessen, und jeder Statuswechsel lief danach in `23514`.
--
-- ZEHN BLEIBEN, EINER KOMMT. `drop` und `add` in derselben Transaktion, ohne
-- `not valid` — die bestehenden Zeilen werden mitgeprueft.
-- ---------------------------------------------------------------------------
alter table public.catalog_admin_changes
  drop constraint if exists catalog_admin_changes_field_known;

alter table public.catalog_admin_changes
  add constraint catalog_admin_changes_field_known
    check (field in (
      -- Die sieben aus `0004`/`0007`/`0033`:
      'catalog_visible', 'display_name_override', 'admin_note', 'catalog_group',
      'image_override_path', 'card_type', 'created',
      -- die drei aus `0157`:
      'catalog_status', 'merged_from', 'discarded',
      -- und der elfte, aus dieser Migration:
      'character_id'
    ));


-- ---------------------------------------------------------------------------
-- 3. Eine Familie anlegen
--
-- NUR DER NAME. Element, Spezies, Rolle, Beschreibung und Quelle bleiben
-- NULL: das ist kuratierte Arbeit und gehoert in
-- `data/characters/characters.json`, nicht in ein Adminformular, das sie
-- raten muesste. NULL heisst „nicht zuverlaessig bekannt" (ADR-0010), und
-- das ist hier die Wahrheit.
--
-- DER DUBLETTENSCHUTZ IST DER VORHANDENE INDEX. `characters_canonical_name_key`
-- liegt auf `lower(canonical_name)` (`0002`); diese Funktion faengt den
-- Konflikt ab und nennt die bestehende Familie, statt eine zweite anzulegen.
-- Eine zweite „Spyro"-Familie waere genau die Art Fehler, nach der niemand
-- sucht, weil beide Zeilen plausibel aussehen.
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_character(p_name text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id   bigint;
  v_name text := btrim(coalesce(p_name, ''));
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  if v_name = '' then
    raise exception '0158: eine Familie braucht einen Namen';
  end if;
  if length(v_name) > 120 then
    raise exception '0158: der Familienname ist zu lang (% Zeichen, hoechstens 120)',
      length(v_name);
  end if;

  -- GIBT ES SIE SCHON? Dann wird sie genannt und nicht verdoppelt.
  select c.id into v_id from public.characters c
   where lower(c.canonical_name) = lower(v_name);
  if v_id is not null then
    raise exception '0158: die Familie "%" gibt es schon (id %). Sie auswaehlen, '
      'statt eine zweite anzulegen.', v_name, v_id;
  end if;

  insert into public.characters (canonical_name) values (v_name)
    returning id into v_id;

  return v_id;
end;
$$;

comment on function public.admin_create_character(text) is
  'Creates a figure family with nothing but its name (0158, CAT-06). Element, species, role, description and source stay NULL - that is curated work and belongs in data/characters/characters.json, not in a form that would have to guess. Refuses a name that already exists (case-insensitively, via characters_canonical_name_key from 0002) and names the existing family instead of adding a second one. Platform admins only.';

revoke all on function public.admin_create_character(text) from public, anon;
grant execute on function public.admin_create_character(text) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. Eine Figur einer Familie zuordnen — oder die Zuordnung entfernen
--
-- SIE GILT FUER JEDE FIGUR, nicht nur fuer Entwuerfe: eine Zuordnung ist eine
-- redaktionelle Korrektur und muss auch an einer laengst veroeffentlichten
-- Figur moeglich sein (CAT-06 §7).
--
-- SIE SCHREIBT EINE SPALTE UND SONST NICHTS. Kein Name, kein Status, keine
-- Sichtbarkeit, kein Preis, kein Bild, keine Serie, keine Kategorie, kein
-- `card_type`. Eine Familienzuordnung aendert, WOMIT eine Figur zusammen
-- angezeigt wird — nicht, was sie ist. Angebote, Sammlungen, Lager,
-- Favoriten und Bestellungen haengen an der SKY-ID und sind davon
-- unberuehrt.
--
-- `p_character_id = NULL` ENTFERNT die Zuordnung. Das ist kein Sonderfall,
-- sondern der Rueckweg: eine falsche Familie muss sich zuruecknehmen lassen.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_character(
  p_sky_id       text,
  p_character_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alt      bigint;
  v_altname  text;
  v_neuname  text;
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select s.character_id into v_alt from public.skylanders s
   where s.sky_id = p_sky_id for update;
  if not found then
    raise exception '0158: die Figur % gibt es nicht', p_sky_id;
  end if;

  -- DIE FAMILIE MUSS ES GEBEN. Der Fremdschluessel faenge das auch, aber mit
  -- einer Meldung, die niemand lesen will.
  if p_character_id is not null then
    select c.canonical_name into v_neuname from public.characters c
     where c.id = p_character_id;
    if not found then
      raise exception '0158: die Familie mit der id % gibt es nicht', p_character_id;
    end if;
  end if;

  if v_alt is not distinct from p_character_id then
    -- Nichts zu tun, und kein Journaleintrag fuer eine Nichtaenderung.
    return jsonb_build_object('sky_id', p_sky_id, 'character_id', p_character_id,
                              'changed', false);
  end if;

  if v_alt is not null then
    select c.canonical_name into v_altname from public.characters c where c.id = v_alt;
  end if;

  update public.skylanders set character_id = p_character_id where sky_id = p_sky_id;

  -- DAS JOURNAL. `character_id` ist seit Abschnitt 2 erlaubt. Es haelt die
  -- IDs fest und nicht die Namen: eine Umbenennung der Familie soll die
  -- Historie nicht umschreiben.
  insert into public.catalog_admin_changes
    (entity, entity_id, field, old_value, new_value, changed_by)
  values ('skylander', p_sky_id, 'character_id',
          v_alt::text, p_character_id::text, (select auth.uid()));

  return jsonb_build_object(
    'sky_id', p_sky_id,
    'character_id', p_character_id,
    'old_character_id', v_alt,
    'old_name', v_altname,
    'new_name', v_neuname,
    'changed', true);
end;
$$;

comment on function public.admin_set_character(text, bigint) is
  'Assigns a catalogue figure to a figure family, or removes the assignment with NULL (0158, CAT-06). Works on any figure, not just drafts - an assignment is an editorial correction and must stay possible after publication. Writes ONE column: no name, status, visibility, price, image, series, category or card_type, so offers, collections, stock, favourites and orders are untouched. Journals the change as field = character_id with the IDs, not the names, so renaming a family does not rewrite history. A no-op writes no journal row. Platform admins only.';

revoke all on function public.admin_set_character(text, bigint) from public, anon;
grant execute on function public.admin_set_character(text, bigint) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. Weg B: einen Entwurf als Variante veroeffentlichen — in EINER Transaktion
--
-- ZWEI SCHRITTE, EINE TRANSAKTION. Zuordnen und veroeffentlichen gehoeren
-- zusammen: eine veroeffentlichte Figur ohne Familie stuende sichtbar an der
-- falschen Stelle im Katalog, und eine zugeordnete unveroeffentlichte waere
-- ein halber Vorgang, von dem niemand weiss. plpgsql gibt die Transaktion
-- umsonst — ein Fehler in der zweiten Haelfte nimmt die erste mit.
--
-- SIE ERFINDET KEINEN ZWEITEN VEROEFFENTLICHUNGSWEG. Der Status wird von
-- `admin_set_catalog_status` aus `0152` gesetzt, derselben Funktion, die das
-- Auswahlfeld in der Katalogliste benutzt. Zwei Wege, einen Katalogeintrag
-- oeffentlich zu machen, waeren zwei Stellen, an denen eine kuenftige Regel
-- vergessen wird.
--
-- DIE GRUNDFIGUR WIRD NICHT ANGEFASST. Kein Feld von ihr wird gelesen,
-- kopiert oder ueberschrieben; die Familie ist eine Zuordnung, kein
-- Datensatz, aus dem abgeschrieben wird. Der Entwurf behaelt seine SKY-ID,
-- seinen Slug, seinen Namen, sein Bild, seine Edition und seinen Preis —
-- „Chrome Spyro" bleibt „Chrome Spyro" und wird nicht zu „Spyro (Chrome)".
-- ---------------------------------------------------------------------------
create or replace function public.admin_publish_as_variant(
  p_sky_id       text,
  p_character_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row    public.skylanders%rowtype;
  v_gesetzt jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  if p_character_id is null then
    raise exception '0158: Weg B braucht eine Familie. Ohne Familie ist es Weg C '
      '— dafuer gibt es admin_set_catalog_status.';
  end if;

  select * into v_row from public.skylanders where sky_id = p_sky_id for update;
  if not found then
    raise exception '0158: die Figur % gibt es nicht', p_sky_id;
  end if;

  -- NUR EIN ENTWURF WIRD VEROEFFENTLICHT. Eine schon oeffentliche Figur einer
  -- Familie zuzuordnen ist Abschnitt 4 und nicht dieser Weg; sie hier
  -- durchzulassen hiesse, einen Statuswechsel zu verstecken.
  if v_row.catalog_status <> 'draft' then
    raise exception '0158: % ist kein Entwurf (Status %) — nur Entwuerfe werden '
      'veroeffentlicht. Fuer eine bestehende Figur: admin_set_character.',
      p_sky_id, v_row.catalog_status;
  end if;

  -- ERST ZUORDNEN (prueft die Familie und journalisiert), DANN
  -- VEROEFFENTLICHEN. Die Reihenfolge entscheidet nichts fachlich — beides
  -- liegt in einer Transaktion —, aber so steht die Familie schon, wenn der
  -- Statustrigger laeuft.
  v_gesetzt := public.admin_set_character(p_sky_id, p_character_id);
  perform public.admin_set_catalog_status(p_sky_id, 'public');

  return jsonb_build_object(
    'sky_id', p_sky_id,
    'character_id', p_character_id,
    'family_changed', v_gesetzt -> 'changed',
    'published', true);
end;
$$;

comment on function public.admin_publish_as_variant(text, bigint) is
  'Path B of the three import paths (0158, CAT-06): publishes a draft as a figure in its own right AND links it to a figure family, in one transaction. Drafts only. Reuses admin_set_character and admin_set_catalog_status rather than inventing a second publish path. The family is an assignment, not a record to copy from: no field of the base figure is read or written, and the draft keeps its SKY-ID, slug, name, image, edition and price - "Chrome Spyro" stays "Chrome Spyro". Platform admins only.';

revoke all on function public.admin_publish_as_variant(text, bigint) from public, anon;
grant execute on function public.admin_publish_as_variant(text, bigint) to authenticated;


-- ---------------------------------------------------------------------------
-- 6. Nachbedingungen
-- ---------------------------------------------------------------------------
do $nach$
declare
  v_def   text;
  v_offen integer;
begin
  select pg_get_constraintdef(c.oid) into v_def
    from pg_constraint c
   where c.conrelid = to_regclass('public.catalog_admin_changes')
     and c.conname = 'catalog_admin_changes_field_known';
  if v_def is null then
    raise exception '0158 Nachbedingung: die Constraint ist verschwunden';
  end if;
  if v_def not like '%character_id%' then
    raise exception '0158 Nachbedingung: die Constraint kennt character_id nicht: %', v_def;
  end if;
  -- UND KEINER DER ZEHN IST VERLOREN.
  if v_def not like '%catalog_visible%' or v_def not like '%display_name_override%'
     or v_def not like '%admin_note%' or v_def not like '%catalog_group%'
     or v_def not like '%image_override_path%' or v_def not like '%card_type%'
     or v_def not like '%created%' or v_def not like '%catalog_status%'
     or v_def not like '%merged_from%' or v_def not like '%discarded%' then
    raise exception '0158 Nachbedingung: ein alter Wert ist verloren gegangen: %', v_def;
  end if;

  if to_regprocedure('public.admin_create_character(text)') is null then
    raise exception '0158 Nachbedingung: admin_create_character fehlt';
  end if;
  if to_regprocedure('public.admin_set_character(text,bigint)') is null then
    raise exception '0158 Nachbedingung: admin_set_character fehlt';
  end if;
  if to_regprocedure('public.admin_publish_as_variant(text,bigint)') is null then
    raise exception '0158 Nachbedingung: admin_publish_as_variant fehlt';
  end if;

  -- KEINE DER DREI FASST EINEN NAMEN AN. Das ist die Zusage aus CAT-06 §1,
  -- und sie laesst sich am Rumpf nachrechnen.
  if (select count(*) from pg_proc p
       where p.oid in (to_regprocedure('public.admin_set_character(text,bigint)'),
                       to_regprocedure('public.admin_publish_as_variant(text,bigint)'))
         and (p.prosrc like '%set name%' or p.prosrc like '%set slug%')) <> 0 then
    raise exception '0158 Nachbedingung: eine der Funktionen schreibt einen Namen '
      'oder einen Slug — das darf keine von ihnen';
  end if;

  select count(*) into v_offen
    from pg_proc p, aclexplode(p.proacl) a
   where p.oid in (to_regprocedure('public.admin_create_character(text)'),
                   to_regprocedure('public.admin_set_character(text,bigint)'),
                   to_regprocedure('public.admin_publish_as_variant(text,bigint)'))
     and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'public'));
  if v_offen <> 0 then
    raise exception '0158 Nachbedingung: % offene EXECUTE-Rechte', v_offen;
  end if;

  raise notice '0158: das Journal kennt character_id; admin_create_character, '
    'admin_set_character und admin_publish_as_variant stehen, nur fuer '
    'authenticated. Keine Zeile wurde geaendert.';
end
$nach$;
