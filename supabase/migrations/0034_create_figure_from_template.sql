-- ===========================================================================
-- 0034 - "Bestehende Figur als Vorlage" inherits the collector identity
--
-- WHY
--
-- 0033 shipped the create with two starting points, and the template one
-- prefilled two form fields: series and category. That is a convenience, and
-- it is not what the operator means when they pick Fire Kraken as a template.
-- What they mean is "this is another Fire Kraken" - a special edition, a
-- finish, a colourway. The new row is a different COLLECTIBLE and the same
-- CHARACTER.
--
-- `character_id` is the column that already says exactly that (ADR-0034), so
-- template mode sets it and empty mode does not. ADR-0070a records the
-- decision; nothing about the curated-character philosophy changes.
--
-- WHY THE TEMPLATE IS PASSED, NOT THE CHARACTER
--
-- The obvious shape is `p_character_id bigint`. It is the wrong one: it lets
-- a caller assert any character identity for any figure, and this function is
-- executable by every authenticated session - the `is_shop_admin()` check
-- decides who may act, not what they may claim. Curated links would become
-- client input.
--
-- So the function takes a SKY-ID that must already exist, and reads the
-- character from that row itself. The only identities it can ever write are
-- ones the catalogue already holds, and the operator's choice of template is
-- the one thing the client actually gets to decide. One extra lookup buys
-- that; it is not a trade worth making the other way.
--
-- 0033 IS NOT EDITED. It is applied to staging. The old signature is dropped
-- here and replaced, because leaving it would make the seven-argument and
-- eight-argument forms two overloads of one name - and a caller that omitted
-- the template would be ambiguous rather than defaulted.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. The 0033 signature goes, so there is exactly one function to call
-- ---------------------------------------------------------------------------
drop function if exists public.admin_create_figure(text, text, bigint, text, boolean, text, text);


-- ---------------------------------------------------------------------------
-- 2. The same transaction, with one more thing it may inherit
--
-- Everything 0033 established stands: one transaction, the identity from the
-- sequence, the 8999 ceiling, the derived slug, `source = 'admin'`, hidden by
-- default, and no price, image or name-override taken from anywhere.
--
-- WHAT A TEMPLATE GIVES, AND WHAT IT DOES NOT
--
-- It gives `character_id`, and only that. Series and category still arrive as
-- arguments because the operator may change them in the form before saving -
-- a Swap Force variant of a figure first released in Giants is a real case,
-- and the composite foreign key is what decides whether the pair is valid.
--
-- It does not give the card type, the visibility, the picture, the price, the
-- note or the name. A variant differs from its base in exactly those things,
-- so inheriting them would pre-fill the fields most likely to be wrong.
--
-- A TEMPLATE WITHOUT A CHARACTER INHERITS NOTHING, AND SAYS SO
--
-- `character_id` is NULL for 500 of the 604 rows - traps, vehicles, crystals,
-- and everything not yet curated. Taking NULL from such a template is the
-- correct answer, not a failure: the new figure simply has no curated
-- character either, exactly as an empty start would leave it. Nothing is
-- guessed from the name, here or anywhere (ADR-0034).
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
  if not public.is_shop_admin() then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
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

comment on function public.admin_create_figure(text, text, bigint, text, boolean, text, text, text) is
  'Creates a catalogue figure and returns its SKY-ID (ADR-0070, template inheritance in ADR-0070a). Administrators only. Atomic: row, note and journal entry commit together or not at all. p_template_sky_id names an EXISTING figure whose character_id the new row inherits - the character is read from that row, never accepted as an argument, so no caller can assert a curated identity. A template without a character yields NULL, which is the normal case. Still writes source = admin, catalog_visible = false, and no price, image or name override.';

revoke all on function public.admin_create_figure(text, text, bigint, text, boolean, text, text, text)
  from public, anon, authenticated;
grant  execute on function public.admin_create_figure(text, text, bigint, text, boolean, text, text, text)
  to authenticated;


-- ---------------------------------------------------------------------------
-- 3. What is deliberately absent, again
--
-- No `p_character_id`. See the header: it would turn a curated link into
-- client input.
--
-- No parent, ancestor or derived_from column. The relationship the operator
-- means is "same character", and `character_id` already carries it. A second
-- one would be a second answer to the same question, and the first would be
-- the one every query already uses.
--
-- No change to how `sortBaseName` is derived. That is `variant.ts`, it is
-- read-time, and it is not a database concern - see ADR-0070a for the open
-- question about whether a curated character should inform it.
-- ---------------------------------------------------------------------------
