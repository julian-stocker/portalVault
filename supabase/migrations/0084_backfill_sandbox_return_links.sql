-- ===========================================================================
-- 0084 — linking the sandbox returns that were booked before 0083
--
-- WHAT IT DOES, AND WHAT IT REFUSES TO DO
--
-- `0083` made the link; the returns booked before it still have none. This
-- fills them in from the structure that is already there, and from nothing
-- else.
--
-- THE NOTE IS NOT EVIDENCE. Every one of these movements carries
-- 'sandbox test order SI-…' and it would be the easy way to match them.
-- Free text is what somebody typed, it has no constraint behind it, and a
-- migration that trusts it teaches the next one to do the same. So the note
-- is not read here — not as a filter, not as a tie-breaker, not at all.
--
-- WHAT IS EVIDENCE
--
-- `admin_revert_sandbox_stock` books exactly one return per CONVERTED
-- reservation of the order, in one transaction, immediately before writing
-- its `sandbox_stock_reverted` event. So for each such reservation there is
-- a movement with:
--
--     reason      = 'return'
--     inventory_id = the reservation's position
--     delta        = the reservation's quantity
--     created_at   within minutes of that order's revert event
--     and not already claimed by another reservation
--
-- EXACTLY ONE CANDIDATE OR NOTHING HAPPENS. Zero matches or more than one
-- raises and the whole migration rolls back. A partly-linked history is
-- worse than an unlinked one: it looks finished.
--
-- NO COUNTS ARE HARDCODED. The migration asks the data how many there are.
-- On a fresh database it finds none, links none and succeeds — which is
-- correct, and which a expected-count check would turn into a failure. The
-- environment-specific numbers belong in the preview and verify gates of
-- the tooling, where they are an expectation about one database rather than
-- an assumption baked into the schema.
--
-- NOTHING IN `inventory_movements` IS TOUCHED. This writes one column of
-- `order_reservations` and reads everything else.
-- ===========================================================================

do $$
declare
  v_reservation record;
  v_movement_id bigint;
  v_matches     integer;
  v_linked      integer := 0;
  v_pending     integer;
  -- The revert runs as one statement per position inside one transaction.
  -- Minutes, not hours: wide enough for a slow round trip, far too narrow
  -- to reach an unrelated return booked on another day.
  v_window      interval := interval '5 minutes';
begin
  select count(*) into v_pending
    from public.order_reservations r
    join public.orders o on o.id = r.order_id
   where r.state = 'converted'
     and r.reverted_movement_id is null
     and o.commerce_mode = 'sandbox'
     and exists (
       select 1 from public.order_events e
        where e.order_id = o.id
          and e.event_type = 'sandbox_stock_reverted'
     );

  if v_pending = 0 then
    raise notice '0084: nothing to link.';
    return;
  end if;

  for v_reservation in
    select r.id,
           r.inventory_id,
           r.quantity,
           o.order_number,
           (select e.created_at
              from public.order_events e
             where e.order_id = o.id
               and e.event_type = 'sandbox_stock_reverted'
             order by e.created_at
             limit 1) as reverted_at
      from public.order_reservations r
      join public.orders o on o.id = r.order_id
     where r.state = 'converted'
       and r.reverted_movement_id is null
       and o.commerce_mode = 'sandbox'
       and exists (
         select 1 from public.order_events e
          where e.order_id = o.id
            and e.event_type = 'sandbox_stock_reverted'
       )
     order by r.id
  loop
    select count(*), min(m.id)
      into v_matches, v_movement_id
      from public.inventory_movements m
     where m.reason = 'return'
       and m.inventory_id = v_reservation.inventory_id
       and m.delta = v_reservation.quantity
       and m.created_at between v_reservation.reverted_at - v_window
                            and v_reservation.reverted_at + v_window
       and not exists (
         select 1 from public.order_reservations other
          where other.reverted_movement_id = m.id
       );

    if v_matches <> 1 then
      raise exception
        '0084 refuses to guess: reservation % (order %) has % candidate return movements, expected exactly 1',
        v_reservation.id, v_reservation.order_number, v_matches
        using errcode = 'restrict_violation';
    end if;

    update public.order_reservations
       set reverted_movement_id = v_movement_id
     where id = v_reservation.id;

    v_linked := v_linked + 1;
  end loop;

  if v_linked <> v_pending then
    raise exception '0084: linked % of % reservations', v_linked, v_pending
      using errcode = 'restrict_violation';
  end if;

  raise notice '0084: linked % sandbox return movement(s).', v_linked;
end;
$$;
