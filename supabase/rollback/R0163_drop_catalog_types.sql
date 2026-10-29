-- ===========================================================================
-- RUECKNAHME VON 0163 — der Type verschwindet, die Kartenkunst bleibt
--
-- WAS SIE TUT, in dieser Reihenfolge:
--
--   1. die zwei Funktionen `admin_set_figure_types` und
--      `admin_set_visible_type`
--   2. den Trigger und seine Funktion
--   3. die drei Constraints
--   4. DIE DREI SPALTEN — und damit JEDE Typzuordnung
--   5. die zwei Zusammenfuehrungsruempfe zurueck auf die Fassung aus `0157`
--
-- WAS SIE NICHT ANFASST:
--
--   * `card_type`. Die Kartenkunst war nie Teil dieser Migration, und sie ist
--     nach der Ruecknahme, was sie vorher war — das ist der ganze Grund,
--     warum `0163` sie nicht abgeleitet hat.
--   * `base_sky_id`, `character_id`, Name, Slug, Serie, Kategorie, Preis,
--     Bild, Status, Lager, Angebote, Sammlungen, Bestellungen.
--   * KEINE JOURNALZEILE. Jede Typaenderung steht in
--     `catalog_admin_changes` und bleibt dort — das ist der Zweck eines
--     Journals.
--   * DIE AUDIT-CONSTRAINT WIRD NICHT ZURUECKGEDREHT. Sie kennt nach `0163`
--     sechzehn Werte; `types` und `visible_type` stehen dann in echten
--     Journalzeilen. Nimmt man sie aus der Liste, ist die Tabelle mit ihrer
--     eigenen Historie unvereinbar.
--
-- *** SIE VERWIRFT DATEN, UND ZWAR UNWIEDERBRINGLICH ***
--
-- Die Typzuordnungen aller Katalogzeilen gehen mit den Spalten verloren. Ein
-- erneutes `0163` stellt die ERSTBELEGUNG wieder her — sie entsteht aus
-- `catalog_group` und `card_type` —, aber jede Zuordnung, die ein
-- Administrator seitdem von Hand geaendert hat, ist fort. Deshalb ZAEHLT
-- diese Datei sie vorher und sagt die Zahl.
--
-- AUSFUEHRUNG: in `begin` / `commit` geklammert.
-- ===========================================================================

do $warnung$
declare
  v_zeilen  integer := 0;
  v_banner  integer := 0;
  v_journal integer := 0;
begin
  if (select count(*) from pg_attribute a
       where a.attrelid = to_regclass('public.skylanders')
         and a.attname = 'types' and not a.attisdropped) = 1 then
    execute 'select count(*) from public.skylanders where cardinality(types) > 0'
      into v_zeilen;
    execute 'select count(*) from public.skylanders where visible_type is not null'
      into v_banner;
  end if;
  select count(*) into v_journal from public.catalog_admin_changes
   where field in ('types', 'visible_type');

  raise notice 'R0163: % Zeilen mit Types und % mit Banner werden verworfen. '
    '% Journalzeilen bleiben stehen — sie sind danach die einzige Spur.',
    v_zeilen, v_banner, v_journal;
end
$warnung$;

drop function if exists public.admin_set_figure_types(text, text[]);
drop function if exists public.admin_set_visible_type(text, text);

drop trigger if exists skylanders_canonical_types on public.skylanders;
drop function if exists public.skylanders_canonical_types();

alter table public.skylanders
  drop constraint if exists skylanders_visible_type_decided,
  drop constraint if exists skylanders_visible_type_member,
  drop constraint if exists skylanders_types_known;

alter table public.skylanders
  drop column if exists visible_type_decided,
  drop column if exists visible_type,
  drop column if exists types;

-- ---------------------------------------------------------------------------
-- Die zwei Zusammenfuehrungsruempfe zurueck auf `0157`
--
-- SIE MUESSEN ZURUECK, und das ist keine Formalie: die Fassung aus `0163`
-- nennt `types` in ihrer Allowlist und schreibt die Spalte — nach dem
-- Spaltenabwurf oben waere jeder Aufruf mit dieser Auswahl ein `42703`.
--
-- Wiederhergestellt wird aus der Datei, nicht aus dem Gedaechtnis:
-- `supabase/migrations/0157_audit_fields_and_automatic_notes.sql`, Abschnitte
-- 4 und 5. Wer diese Ruecknahme fahren muss, fuegt sie von dort ein — eine
-- dritte Kopie derselben 315 Zeilen in dieser Datei waere die vierte
-- Fassung, die auseinanderlaufen kann.
-- ---------------------------------------------------------------------------
do $hinweis$
begin
  if to_regprocedure('public.admin_merge_plan(text,text,text)') is not null
     and (select prosrc from pg_proc
           where oid = to_regprocedure('public.admin_merge_plan(text,text,text)'))
         like '%''types''%' then
    raise exception 'R0163: admin_merge_plan und admin_merge_draft tragen noch '
      'die Fassung aus 0163 und wuerden eine Spalte schreiben, die es nicht '
      'mehr gibt. Bitte die Abschnitte 4 und 5 aus '
      'supabase/migrations/0157_audit_fields_and_automatic_notes.sql '
      'einfuegen und diese Datei erneut fahren.';
  end if;
end
$hinweis$;

do $nach$
declare
  v_n integer;
begin
  if (select count(*) from pg_attribute a
       where a.attrelid = to_regclass('public.skylanders')
         and a.attname in ('types', 'visible_type', 'visible_type_decided')
         and not a.attisdropped) <> 0 then
    raise exception 'R0163 Nachbedingung: eine der drei Spalten steht noch';
  end if;
  if to_regprocedure('public.admin_set_figure_types(text,text[])') is not null
     or to_regprocedure('public.admin_set_visible_type(text,text)') is not null then
    raise exception 'R0163 Nachbedingung: eine der zwei Funktionen steht noch';
  end if;
  if (select count(*) from pg_attribute a
       where a.attrelid = to_regclass('public.skylanders')
         and a.attname = 'card_type' and not a.attisdropped) <> 1 then
    raise exception 'R0163 Nachbedingung: card_type ist mit abgeraeumt worden — '
      'das waere ein Schritt zu viel';
  end if;
  select count(*) into v_n from public.catalog_admin_changes
   where field in ('types', 'visible_type');
  raise notice 'R0163: die drei Spalten sind fort. Unberuehrt: card_type, '
    'base_sky_id, character_id und % Journalzeile(n).', v_n;
end
$nach$;
