-- ===========================================================================
-- 0020 — order_events: one permitted change, and it is the deletion of a person
--
-- THE DEFECT
--
-- `order_events` carries `actor_user_id` with `ON DELETE SET NULL` (0010), and
-- it is guarded by the blanket `deny_write()`, which refuses every UPDATE. The
-- foreign key action IS an UPDATE, so the guard refuses the very thing the
-- foreign key was written to do.
--
-- The consequence is not theoretical. Anyone who has placed an order (`placed`
-- carries the customer's id) or shipped one (`order_shipped` carries the
-- administrator's) has an account that can never be deleted. Found on staging
-- on 2026-09-11: a throwaway administrator that had shipped one order could
-- not be removed — `Database error deleting user` — while one that had only
-- sent a mail could.
--
-- That contradicts the intent written on the foreign key and the account
-- deletion promise in docs/AUTH.md.
--
-- THE FIX, AND THE SHAPE IT COPIES
--
-- `inventory_movements` met the same problem in 0003 and `catalog_admin_changes`
-- in 0004, and both solved it the same way: refuse everything except losing
-- the personal identifier, with every factual column unchanged. This is that
-- rule again, for the third and — since `order_lines` and `order_addresses`
-- carry no account reference at all — last table that needs it.
--
-- The boundary is the permitted MUTATION, not the caller. Whether PostgreSQL
-- itself issued the UPDATE cannot be detected reliably, and guessing at it
-- would be a worse guarantee than checking what actually changed.
--
-- WHAT DOES NOT CHANGE
--
-- `order_events` stays append-only. DELETE is still refused outright. A normal
-- UPDATE — from a client, from an administrator, from the service role — is
-- still refused, including one that sets `actor_user_id` to NULL while
-- touching anything else. No row is removed and no history is rewritten.
-- `order_lines` and `order_addresses` keep `deny_write()` untouched: neither
-- references an account, so neither can block a deletion.
-- ===========================================================================

create or replace function public.prevent_order_event_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    -- NULL-safe throughout: `actor_user_id` is nullable and `payload` is
    -- jsonb, so plain equality would silently pass rows that differ.
    if old.actor_user_id is not null
       and new.actor_user_id is null
       and (new.id, new.order_id, new.event_type, new.actor_kind,
            new.payload, new.created_at)
           is not distinct from
           (old.id, old.order_id, old.event_type, old.actor_kind,
            old.payload, old.created_at)
    then
      return new;
    end if;

    raise exception
      'order_events is append-only: the only permitted change is anonymising actor_user_id to NULL when the account is deleted — record a new event instead'
      using errcode = 'restrict_violation';
  end if;

  raise exception
    'order_events is append-only: an order''s history is never removed — record a new event instead'
    using errcode = 'restrict_violation';
end;
$$;

comment on function public.prevent_order_event_change() is
  'Refuses every DELETE, and every UPDATE except anonymising actor_user_id to NULL with all factual columns unchanged (the ON DELETE SET NULL path). Applies to the service role as well. Same rule as inventory_movements (ADR-0037) and catalog_admin_changes (ADR-0039).';

-- The old trigger goes; `deny_write()` itself stays, because order_lines and
-- order_addresses still use it and still should.
drop trigger if exists order_events_append_only on public.order_events;

create trigger order_events_append_only
  before update or delete on public.order_events
  for each row execute function public.prevent_order_event_change();

revoke all on function public.prevent_order_event_change() from public, anon, authenticated;
