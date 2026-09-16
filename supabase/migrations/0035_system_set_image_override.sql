-- ===========================================================================
-- 0035 - the system path for image overrides
--
-- WHY
--
-- `admin_set_image_override()` (0007) asks `public.is_shop_admin()`, which
-- reads `auth.uid()`. Controlled server tooling runs as the service role and
-- has no `auth.uid()` at all, so that function refuses it — correctly, and
-- unhelpfully: restoring a backed-up picture into an environment is exactly
-- the kind of work a script does and a browser cannot.
--
-- 0003 already met this and answered it. `record_inventory_movement()` is for
-- administrators and checks `is_shop_admin()`; `system_record_inventory_movement()`
-- is for tooling and is executable only by `service_role`, with the comment
-- that says why: "the authorization IS the EXECUTE privilege". This file is
-- the same shape for the same reason.
--
-- WHAT IT DOES NOT CHANGE
--
-- Not the admin path: `admin_set_image_override()` is untouched, still the
-- only way a browser session can move a picture, still behind
-- `is_shop_admin()`. Not `image_file`, which belongs to the catalogue import
-- (ADR-0046). Not the journal: the UPDATE below fires
-- `skylanders_log_editorial_change` exactly as the admin path does, and
-- records `changed_by = NULL`, which `catalog_admin_changes` already documents
-- as "the change came through the service role (an import, a script)".
--
-- WHY NOT A DIRECT UPDATE FROM THE TOOL
--
-- The service role bypasses RLS, so a tool could write the column itself. It
-- would also bypass the one check that makes an override safe: that the path
-- belongs to the figure it is being attached to. That check is repeated here
-- rather than trusted to the caller, because a tool with a bug is exactly the
-- caller it is meant to protect against.
-- ===========================================================================

create or replace function public.system_set_image_override(
  p_sky_id text,
  p_path   text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clean text := nullif(btrim(coalesce(p_path, '')), '');
begin
  -- No is_shop_admin() check: the authorization IS the EXECUTE privilege,
  -- which only service_role holds. A request running as anon or authenticated
  -- is rejected by Postgres before this body is reached.

  -- The same guarantee `admin_set_image_override()` gives. The CHECK on the
  -- column accepts any well-formed path; only this rejects a well-formed path
  -- that belongs to a different figure.
  if v_clean is not null and split_part(v_clean, '/', 1) <> p_sky_id then
    raise exception 'image path % does not belong to %', v_clean, p_sky_id
      using errcode = 'check_violation';
  end if;

  update public.skylanders set image_override_path = v_clean where sky_id = p_sky_id;

  if not found then
    raise exception 'unknown sky_id %', p_sky_id using errcode = 'no_data_found';
  end if;
end;
$$;

comment on function public.system_set_image_override(text, text) is
  'Points a figure at an uploaded image from controlled server tooling - the backup restore and the staging sync. Executable only by service_role; the EXECUTE privilege is the authorization, exactly as system_record_inventory_movement() (0003). Validates that the path belongs to the figure, never touches image_file (ADR-0046), and journals through the existing editorial trigger with changed_by NULL.';

revoke all on function public.system_set_image_override(text, text)
  from public, anon, authenticated;
grant  execute on function public.system_set_image_override(text, text)
  to service_role;
