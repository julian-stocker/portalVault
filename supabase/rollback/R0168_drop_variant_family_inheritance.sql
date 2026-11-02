-- ===========================================================================
-- RUECKNAHME R0168 — die Familienvererbung aus 0168 entfernen
--
-- KEINE MIGRATION. Nur nach ausdruecklicher Entscheidung, einzeln, in
-- begin/commit geklammert (supabase/rollback/README.md).
--
-- WAS SIE TUT
--   * entfernt die zwei Trigger skylanders_variant_family_follow_trg und
--     skylanders_variant_family_cascade_trg samt ihrer Funktionen
--   * entfernt admin_delete_empty_character(bigint)
--   * setzt admin_set_variant_base auf den Rumpf aus 0159 zurueck — WOERTLICH
--     uebernommen (Familie uebertragen, bei Widerspruch abbrechen)
--
-- WAS SIE NICHT TUT
--   * Die Journalwerte `character` und `family_deleted` bleiben in den zwei
--     CHECK-Constraints. Eine erweiterte Liste schadet nicht, und sie zu
--     verengen hiesse, bereits geschriebene Journalzeilen ungueltig zu machen.
--   * KEINE DATENANWEISUNG. Familien, die 0168 vererbt hat, bleiben vererbt;
--     geloeschte Familien kommen nicht zurueck — ihr Name steht im Journal
--     (`family_deleted`), und eine Familie ohne Mitglied ist mit
--     admin_create_character jederzeit neu anlegbar.
-- ===========================================================================

begin;

do $vor$
begin
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = to_regclass('public.skylanders')
                    and t.tgname = 'skylanders_variant_family_follow_trg') then
    raise exception 'R0168: 0168 steht nicht (kein Folge-Trigger) — nichts zurueckzunehmen.';
  end if;
end
$vor$;

drop trigger if exists skylanders_variant_family_cascade_trg on public.skylanders;
drop trigger if exists skylanders_variant_family_follow_trg on public.skylanders;
drop function if exists public.skylanders_variant_family_cascade();
drop function if exists public.skylanders_variant_family_follow();
drop function if exists public.admin_delete_empty_character(bigint);

-- admin_set_variant_base — der Rumpf aus 0159, woertlich.
create or replace function public.admin_set_variant_base(
  p_sky_id        text,
  p_base_sky_id   text,
  -- Nur wirksam, wenn WEDER Variante NOCH Basisfigur eine Familie haben.
  -- Dann entsteht eine neue, benannt nach der Basisfigur, und beide bekommen
  -- sie. Ohne dieses Kennzeichen bleibt die Familie leer — eine Zuordnung
  -- ohne Familie ist vollstaendig gueltig.
  p_create_family boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row       public.skylanders%rowtype;
  v_basis     public.skylanders%rowtype;
  v_alt       text;
  v_fam_neu   bigint := null;
  v_fam_tat   text   := 'unveraendert';
begin
  if not public.is_platform_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select * into v_row from public.skylanders where sky_id = p_sky_id for update;
  if not found then
    raise exception '0159: die Figur % gibt es nicht', p_sky_id;
  end if;
  v_alt := v_row.base_sky_id;

  -- ---- LOESEN. Der Rueckweg ist kein Sonderfall, sondern die Haelfte.
  if p_base_sky_id is null then
    if v_alt is null then
      return jsonb_build_object('sky_id', p_sky_id, 'base_sky_id', null,
                                'changed', false, 'family', 'unveraendert');
    end if;
    update public.skylanders set base_sky_id = null where sky_id = p_sky_id;
    insert into public.catalog_admin_changes
      (entity, entity_id, field, old_value, new_value, changed_by)
    values ('skylander', p_sky_id, 'base_sky_id', v_alt, null, (select auth.uid()));
    return jsonb_build_object('sky_id', p_sky_id, 'base_sky_id', null,
                              'old_base_sky_id', v_alt, 'changed', true,
                              'family', 'unveraendert');
  end if;

  if p_base_sky_id = p_sky_id then
    raise exception '0159: eine Figur kann nicht ihre eigene Variante sein (%)',
      p_sky_id;
  end if;

  select * into v_basis from public.skylanders where sky_id = p_base_sky_id for update;
  if not found then
    raise exception '0159: die Basisfigur % gibt es nicht', p_base_sky_id;
  end if;

  -- DIESELBE SERIE. Der Fremdschluessel faengt es auch, aber mit einer
  -- Meldung, die niemand lesen will.
  if v_basis.series_code is distinct from v_row.series_code then
    raise exception '0159: % steht in Serie %, die Basisfigur % in Serie %. Eine '
      'Variante gehoert zu einer Basisfigur DERSELBEN Serie.',
      p_sky_id, v_row.series_code, p_base_sky_id, v_basis.series_code;
  end if;

  -- KEINE KETTEN. Der Trigger faengt es auch; hier steht der lesbare Satz.
  if v_basis.base_sky_id is not null then
    raise exception '0159: % ist selbst eine Variante (von %). Die Basisfigur '
      'muss eine Basisfigur sein.', p_base_sky_id, v_basis.base_sky_id;
  end if;
  if exists (select 1 from public.skylanders s where s.base_sky_id = p_sky_id) then
    raise exception '0159: auf % zeigen schon Varianten. Sie kann nicht selbst '
      'Variante werden — erst die Varianten loesen.', p_sky_id;
  end if;

  -- ======================================================================
  -- DIE FAMILIE, und sie wird NIE gegen eine vorhandene geschrieben.
  -- ======================================================================
  if v_basis.character_id is not null then
    if v_row.character_id is null then
      perform public.admin_set_character(p_sky_id, v_basis.character_id);
      v_fam_neu := v_basis.character_id;
      v_fam_tat := 'aus der Basisfigur uebernommen';
    elsif v_row.character_id = v_basis.character_id then
      v_fam_neu := v_row.character_id;
      v_fam_tat := 'war schon dieselbe';
    else
      raise exception '0159: % gehoert zur Familie %, die Basisfigur % zur '
        'Familie %. Das wird nicht stillschweigend ueberschrieben — erst '
        'klaeren, welche gilt.',
        p_sky_id, v_row.character_id, p_base_sky_id, v_basis.character_id;
    end if;
  elsif v_row.character_id is not null then
    -- Die Variante hat eine, die Basisfigur nicht. Die Basisfigur wird NICHT
    -- angefasst: eine Familienzuordnung nach OBEN zu schreiben waere eine
    -- Entscheidung ueber eine fremde Zeile.
    v_fam_neu := v_row.character_id;
    v_fam_tat := 'nur die Variante hat eine — die Basisfigur bleibt unberuehrt';
  elsif p_create_family then
    -- Beide ohne Familie, und der Bediener hat es ausdruecklich bestaetigt.
    v_fam_neu := public.admin_create_character(v_basis.name);
    perform public.admin_set_character(p_base_sky_id, v_fam_neu);
    perform public.admin_set_character(p_sky_id, v_fam_neu);
    v_fam_tat := 'neu angelegt und beiden zugeordnet';
  else
    v_fam_tat := 'beide ohne Familie — keine angelegt';
  end if;

  -- ---- Und jetzt die Zuordnung selbst.
  if v_alt is distinct from p_base_sky_id then
    update public.skylanders set base_sky_id = p_base_sky_id where sky_id = p_sky_id;
    insert into public.catalog_admin_changes
      (entity, entity_id, field, old_value, new_value, changed_by)
    values ('skylander', p_sky_id, 'base_sky_id', v_alt, p_base_sky_id,
            (select auth.uid()));
  end if;

  return jsonb_build_object(
    'sky_id', p_sky_id,
    'base_sky_id', p_base_sky_id,
    'old_base_sky_id', v_alt,
    'base_name', v_basis.name,
    'series_code', v_row.series_code,
    'character_id', v_fam_neu,
    'family', v_fam_tat,
    'changed', (v_alt is distinct from p_base_sky_id));
end;
$$;

comment on function public.admin_set_variant_base(text, text, boolean) is
  'Links a catalogue figure to its base figure within the same series, or detaches it with NULL (0159, CAT-07). Works on any figure, not just drafts - an assignment is an editorial correction. Refuses a different series, a base that is itself a variant, a row that already has variants, and itself. Carries the family over FROM the base figure when the variant has none, does nothing when both already agree, and ABORTS when they disagree - a conflicting character_id is never silently overwritten. With p_create_family it creates one named after the base figure, but only when neither side has one. Writes base_sky_id and journals it; the family goes through admin_set_character from 0158, so there is one write path for it. Platform admins only.';

revoke all on function public.admin_set_variant_base(text, text, boolean) from public, anon;
grant execute on function public.admin_set_variant_base(text, text, boolean) to authenticated;

do $nach$
begin
  if exists (select 1 from pg_trigger t
              where t.tgrelid = to_regclass('public.skylanders')
                and t.tgname in ('skylanders_variant_family_follow_trg',
                                 'skylanders_variant_family_cascade_trg')) then
    raise exception 'R0168 Nachbedingung: ein Trigger aus 0168 steht noch.';
  end if;
  if to_regprocedure('public.admin_delete_empty_character(bigint)') is not null then
    raise exception 'R0168 Nachbedingung: admin_delete_empty_character steht noch.';
  end if;
  if (select p.prosrc from pg_proc p
       where p.oid = to_regprocedure('public.admin_set_variant_base(text,text,boolean)'))
     not like '%nicht stillschweigend ueberschrieben%' then
    raise exception 'R0168 Nachbedingung: admin_set_variant_base ist nicht der Rumpf aus 0159.';
  end if;
  raise notice 'R0168 ok: Vererbung entfernt, admin_set_variant_base wie in 0159.';
end
$nach$;

commit;
