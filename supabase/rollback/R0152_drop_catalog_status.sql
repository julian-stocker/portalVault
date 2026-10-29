-- ===========================================================================
-- RUECKNAHME VON 0152 — der redaktionelle Katalogstatus wird zurueckgebaut
--
-- WAS SIE TUT, in dieser Reihenfolge:
--
--   1. sie ZAEHLT UND NENNT die Entwuerfe, bevor sie etwas anfasst
--   2. Trigger `skylanders_sync_catalog_status` und seine Funktion fort
--   3. die zwei CHECKs fort
--   4. `admin_set_catalog_status(text,text)` fort
--   5. die Spalte `skylanders.catalog_status` fort
--   6. die zwei ersetzten Ruempfe zurueck auf ihre Vorfassungen —
--      `log_skylander_editorial_change` aus `0033`, `admin_create_figure`
--      aus `0041`, beide ZEICHEN FUER ZEICHEN
--
-- *** SIE IST KEIN DATENVERLUST, ABER EIN VERLUST VON ABSICHT ***
--
-- Keine Figur verschwindet, keine Sichtbarkeit aendert sich: `catalog_visible`
-- wird nicht angefasst, und der CHECK hat dafuer gesorgt, dass sie zu jedem
-- Status passt. Was verloren geht, ist die UNTERSCHEIDUNG: jede Zeile, die
-- als Entwurf geführt wurde, ist danach nur noch „versteckt". Deshalb nennt
-- Schritt 1 die betroffenen SKY-IDs — wer diese Datei faehrt, soll wissen,
-- was er verliert, und zwar VORHER.
--
-- SIE IST NICHT DIE ERSTE WAHL. `0152` ist additiv; die Spalte stehen zu
-- lassen kostet nichts, und ein Problem in der Oberflaeche ist kein Grund
-- fuer eine Migration. Diese Datei ist fuer den Fall, dass der TRIGGER sich
-- an echten Daten anders verhaelt als im Probelauf P60.
--
-- WAS SIE NICHT ANFASST: keine RLS-Politik, keinen Index, keine andere
-- Tabelle, keine Zeile ausser der Spalte selbst, nicht
-- `admin_set_catalog_visible` (die hat `0152` nie ersetzt), nicht
-- `seller_create_catalog_item`, nicht `shop_offers()`.
--
-- ZUERST `R0153`, FALLS SIE LIEF. `0153` nimmt `catalog_status` in den Rumpf
-- von `system_platform_export()` auf. Stuende dieser Rumpf noch, waere die
-- Sicherungsfunktion nach dem `drop column` gebrochen — und zwar still, bis
-- jemand eine Sicherung zieht. Schritt 0 prueft genau das und bricht ab.
--
-- AUSFUEHRUNG: in `begin` / `commit` geklammert.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 0. Steht hier ueberhaupt etwas zurueckzunehmen — und ist 0153 fort?
-- ---------------------------------------------------------------------------
do $vor$
declare
  v_entwurf  bigint;
  v_ids      text;
begin
  if not exists (select 1 from pg_attribute a
                  where a.attrelid = to_regclass('public.skylanders')
                    and a.attname = 'catalog_status' and not a.attisdropped) then
    raise exception 'R0152 Abbruch: skylanders.catalog_status gibt es hier nicht. '
      '0152 ist nicht angewendet; es gibt nichts zurueckzunehmen.';
  end if;

  /*
   * DER RIEGEL GEGEN EINEN STILLEN BRUCH. `0153` nennt `t.catalog_status` im
   * Rumpf der Plattformsicherung. Ein `drop column` darunter laesst die
   * Funktion stehen und bricht sie erst beim Aufruf — also erst dann, wenn
   * jemand eine Sicherung braucht.
   */
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'system_platform_export'
                and p.prosrc like '%''catalog_status'', t.catalog_status,%') then
    raise exception 'R0152 Abbruch: system_platform_export() nennt catalog_status '
      '(0153 ist angewendet). Zuerst R0153 fahren, sonst bricht die '
      'Plattformsicherung erst beim naechsten Aufruf.';
  end if;

  select count(*), coalesce(string_agg(sky_id, ', ' order by sky_id), '(keine)')
    into v_entwurf, v_ids
    from public.skylanders where catalog_status = 'draft';

  if v_entwurf > 0 then
    raise notice 'R0152: % Zeile(n) stehen als ENTWURF und werden danach nur '
      'noch versteckt sein: %', v_entwurf, v_ids;
  else
    raise notice 'R0152: kein Entwurf vorhanden — es geht keine Absicht verloren.';
  end if;
end
$vor$;


-- ---------------------------------------------------------------------------
-- 1. Trigger, Funktion, CHECKs, Schreibweg, Spalte
--
-- Die Reihenfolge ist nicht beliebig: der Trigger muss fort sein, bevor die
-- Spalte fort ist, sonst laeuft sein Rumpf gegen ein Feld, das es nicht mehr
-- gibt. `drop column` nimmt die CHECKs ohnehin mit; sie stehen trotzdem
-- einzeln da, damit die Datei sagt, was sie entfernt.
-- ---------------------------------------------------------------------------
drop trigger if exists skylanders_sync_catalog_status on public.skylanders;
drop function if exists public.skylanders_sync_catalog_status();

alter table public.skylanders
  drop constraint if exists skylanders_catalog_status_matches_visibility;
alter table public.skylanders
  drop constraint if exists skylanders_catalog_status_known;

drop function if exists public.admin_set_catalog_status(text, text);

alter table public.skylanders drop column if exists catalog_status;


-- ---------------------------------------------------------------------------
-- 2. Das Journal, zurueck auf den Rumpf aus `0033`
--
-- Zeichen fuer Zeichen. Ein von Hand zurueckgebauter Rumpf waere eine dritte
-- Fassung, und die gibt es nicht.
-- ---------------------------------------------------------------------------
create or replace function public.log_skylander_editorial_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.catalog_visible is distinct from old.catalog_visible then
    insert into public.catalog_admin_changes
      (entity, entity_id, field, old_value, new_value, changed_by)
    values ('skylander', old.sky_id, 'catalog_visible',
            old.catalog_visible::text, new.catalog_visible::text,
            (select auth.uid()));
  end if;

  if new.display_name_override is distinct from old.display_name_override then
    insert into public.catalog_admin_changes
      (entity, entity_id, field, old_value, new_value, changed_by)
    values ('skylander', old.sky_id, 'display_name_override',
            old.display_name_override, new.display_name_override,
            (select auth.uid()));
  end if;

  if new.image_override_path is distinct from old.image_override_path then
    insert into public.catalog_admin_changes
      (entity, entity_id, field, old_value, new_value, changed_by)
    values ('skylander', old.sky_id, 'image_override_path',
            old.image_override_path, new.image_override_path,
            (select auth.uid()));
  end if;

  if new.card_type is distinct from old.card_type then
    insert into public.catalog_admin_changes
      (entity, entity_id, field, old_value, new_value, changed_by)
    values ('skylander', old.sky_id, 'card_type',
            old.card_type, new.card_type,
            (select auth.uid()));
  end if;

  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- 3. Und `admin_create_figure`, zurueck auf den Rumpf aus `0041`
--
-- Danach legt eine neu angelegte Figur wieder ein VERSTECKTES Objekt an und
-- keinen Entwurf — das war der Zustand vor `0152`.
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_figure(
  p_name                  text,
  p_series_code           text,
  p_category_id           bigint,
  p_card_type             text    default 'standard',
  p_catalog_visible       boolean default false,
  p_display_name_override text    default null,
  p_admin_note            text    default null,
  p_template_sky_id       text    default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name      text   := btrim(coalesce(p_name, ''));
  v_next      bigint;
  v_sky_id    text;
  v_slug      text;
  v_override  text   := nullif(btrim(coalesce(p_display_name_override, '')), '');
  v_note      text   := nullif(btrim(coalesce(p_admin_note, '')), '');
  v_template  text   := nullif(btrim(coalesce(p_template_sky_id, '')), '');
  v_character bigint := null;
  v_found     boolean;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrator role required' using errcode = 'insufficient_privilege';
  end if;

  if v_name = '' then
    raise exception 'a figure needs a name' using errcode = 'check_violation';
  end if;

  /*
   * The template, read from the catalogue rather than believed.
   *
   * A SKY-ID that does not exist is refused instead of silently ignored: the
   * operator picked something, and a create that quietly dropped the
   * relationship would produce a figure that looks derived and is not.
   *
   * `v_character` may still be NULL afterwards - that is a template without a
   * curated character, and it is a normal answer.
   */
  if v_template is not null then
    select s.character_id, true
      into v_character, v_found
      from public.skylanders s
     where s.sky_id = v_template;

    if not coalesce(v_found, false) then
      raise exception 'unknown template figure %', v_template
        using errcode = 'no_data_found';
    end if;
  end if;

  v_next := nextval('public.sky_id_seq');

  if v_next > 8999 then
    raise exception
      'SKY-ID allocation range exhausted: % is beyond SKY-8999, and SKY-9000-9999 is the reserved system/test range (ADR-0070)',
      v_next
      using errcode = 'check_violation';
  end if;

  v_sky_id := 'SKY-' || lpad(v_next::text, 4, '0');
  v_slug   := public.next_figure_slug(v_name, p_series_code, v_sky_id);

  insert into public.skylanders
    (sky_id, name, slug, series_code, category_id,
     card_type, catalog_visible, display_name_override, character_id, source, is_active)
  values
    (v_sky_id, v_name, v_slug, p_series_code, p_category_id,
     coalesce(nullif(btrim(coalesce(p_card_type, '')), ''), 'standard'),
     coalesce(p_catalog_visible, false), v_override, v_character, 'admin', true);

  if v_note is not null then
    insert into public.catalog_editorial (sky_id, admin_note)
    values (v_sky_id, v_note);
  end if;

  insert into public.catalog_admin_changes
    (entity, entity_id, field, old_value, new_value, changed_by)
  values ('skylander', v_sky_id, 'created', null, v_name, (select auth.uid()));

  return v_sky_id;
end;
$$;


-- ---------------------------------------------------------------------------
-- 4. Nachbedingungen
-- ---------------------------------------------------------------------------
do $nach$
declare
  v_spalte   integer;
  v_trigger  integer;
  v_checks   integer;
  v_zeilen   bigint;
  v_policies integer;
begin
  select count(*) into v_spalte from pg_attribute a
   where a.attrelid = to_regclass('public.skylanders')
     and a.attname = 'catalog_status' and not a.attisdropped;
  if v_spalte <> 0 then
    raise exception 'R0152 Nachbedingung: die Spalte steht noch';
  end if;

  select count(*) into v_trigger from pg_trigger t
   where t.tgrelid = to_regclass('public.skylanders')
     and not t.tgisinternal and t.tgname = 'skylanders_sync_catalog_status';
  if v_trigger <> 0 then
    raise exception 'R0152 Nachbedingung: der Trigger steht noch';
  end if;

  select count(*) into v_checks from pg_constraint c
   where c.conrelid = to_regclass('public.skylanders')
     and c.contype = 'c' and c.conname like '%catalog_status%';
  if v_checks <> 0 then
    raise exception 'R0152 Nachbedingung: % CHECK(s) mit catalog_status', v_checks;
  end if;

  if to_regprocedure('public.admin_set_catalog_status(text,text)') is not null then
    raise exception 'R0152 Nachbedingung: admin_set_catalog_status steht noch';
  end if;

  -- Die zwei Ruempfe nennen die Spalte nicht mehr.
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public'
                and p.proname in ('log_skylander_editorial_change',
                                  'admin_create_figure')
                and p.prosrc like '%catalog_status%') then
    raise exception 'R0152 Nachbedingung: ein ersetzter Rumpf nennt catalog_status '
      'noch — er wuerde gegen eine fehlende Spalte laufen';
  end if;

  -- Und was unberuehrt bleiben musste, ist unberuehrt.
  if to_regprocedure('public.admin_set_catalog_visible(text,boolean)') is null then
    raise exception 'R0152 Nachbedingung: admin_set_catalog_visible ist fort — '
      'diese Datei haette sie nicht anfassen duerfen';
  end if;
  select count(*) into v_policies from pg_policies
   where schemaname = 'public' and tablename = 'skylanders';
  select count(*) into v_zeilen from public.skylanders;

  raise notice 'R0152: Spalte, Trigger, zwei CHECKs und admin_set_catalog_status '
    'fort; Journal auf dem Rumpf aus 0033, admin_create_figure auf dem aus 0041. '
    'Katalog unberuehrt: % Zeile(n), % Richtlinie(n), admin_set_catalog_visible '
    'steht.', v_zeilen, v_policies;
end
$nach$;
