-- ===========================================================================
-- 0067 — FIVE PARCELS THAT ARE STILL IN THE POST GO BACK TO `ordered`
-- ===========================================================================
--
-- WHAT WAS WRONG
--
-- `0053` imported every row of `Order 2026` as `reconciled_legacy`, on the
-- reasoning that historical means already reconciled. That is true of the
-- 2 001 positions the workbook had ticked into stock and wrong for five
-- parcels the owner ordered in late August and has not received.
--
-- `reconciled_legacy` is frozen: it cannot be booked, it cannot be set, and
-- the Orderbuch offers no action on it. So five open orders were recorded as
-- settled history.
--
-- THE UNIT OF TRUTH IS THE PURCHASE, NOT THE POSITION
--
-- An earlier draft of this migration opened eleven individual positions,
-- picked by SKY-ID because those eleven were the only ones the workbook's
-- stock sheets could PROVE had never arrived. The owner then checked the
-- parcels themselves and named four orders outright. A parcel arrives whole
-- or not at all, so the order is the honest unit, and that draft is gone
-- rather than kept beside this one.
--
-- THE FIFTH ORDER, AND THE TWO LEGENDARY JAWBREAKERS
--
-- There are three `Jawbreaker` figures in the workbook and they are not the
-- same thing:
--
--   SKY-0321 `Jawbreaker`            two copies, both ticked into stock.
--                                    Nothing to do with this.
--   row 2006 `Legendary Jawbreaker (b)`
--                                    the copy that arrived broken and was
--                                    discarded. C=`b`, D=`-`, and the `(b)`
--                                    in the name. `isLegacyDamaged` kept it
--                                    out of the import entirely, so it has
--                                    NO purchase_item — it cannot be booked,
--                                    cannot hold stock and cannot appear as
--                                    open goods, because it does not exist
--                                    in the database at all. Nothing here
--                                    has to protect it; its absence does.
--   SKY-0322 `legendary jawbreaker`  TWO copies, rows 2276 and 2282, both
--                                    ordered on 30.08. and both untouched.
--
-- Row 2276 is in the 181.90 EUR order, which the owner confirmed. Row 2282
-- is in the 80.71 EUR order of the same day, which he did not name — so its
-- four positions were read against his own workbook systematic instead:
--
--   2279 sunburn               C="" D=""
--   2280 lava lance eruptor    C="" D=""
--   2281 fizzy fanzy pop fizz  C="" D=""
--   2282 legendary jawbreaker  C="" D=""
--
-- All four carry the untouched signature — the same one the four confirmed
-- orders carry, and the one that means "not worked through yet". The whole
-- parcel is open, so the whole parcel is here. It is not opened because one
-- figure in it is interesting.
--
-- IDENTIFIED BY FINGERPRINT, NOT BY ID
--
-- `purchases.id` is `generated always as identity` and the two projects
-- assigned their own: the five are 88, 89, 91, 92, 93 on Staging and 79, 80,
-- 82, 83, 84 in Production. `import_fingerprint` is the same value in both — it is
-- what the transfer matched on — so it is what this matches on, and the
-- migration is byte-identical for both projects.
--
--   b12a3622…  2026-08-27 ·  70.19 EUR · 54 positions
--   9fd2e9ba…  2026-08-29 · 111.99 EUR · 41 positions
--   263f6562…  2026-08-30 · 181.90 EUR ·  9 positions
--   efd427bb…  2026-08-30 ·  80.71 EUR ·  4 positions
--   77e90e02…  2026-08-30 · 214.25 EUR ·  1 position
--
-- 109 positions. The workbook shows 55 rows for the first of them; row 2153
-- is `hex s2 (b)`, a damaged copy, and `isLegacyDamaged` kept it out of the
-- import on purpose. 54 is therefore the right number and not a loss.
--
-- WHAT THIS DOES NOT DO
--
-- NO INVENTORY. Not one movement, not one quantity. `movement_id` stays
-- NULL, which `purchase_items_booked_has_movement` enforces for every state
-- that is not `booked`, so this cannot claim stock by accident. `Einbuchen`
-- on the individual item, later, writes the `purchase` movement that proves
-- a figure is on the shelf.
--
-- NOT `arrived`. The owner knows these are in transit and does not know they
-- have landed. `Bestellt -> Angekommen -> Einbuchen` is the owner's walk to
-- make, one press at a time, and `arrived` would take the first step for him.
--
-- NO SCHEMA. No column, no function, no policy.
--
-- THREE POSITIONS IN THE 111.99 EUR ORDER HAVE NO `sky_id` — a trophy and
-- two portals. They become `ordered` with the rest of their parcel, because
-- they are part of it, and they will never be bookable: the booking function
-- requires a catalog figure. `is_open` (0066) requires one too, so they do
-- not appear as outstanding work either. They are recorded, not actionable.
-- ===========================================================================

do $$
declare
  v_expected_purchases constant integer := 5;
  v_expected_items     constant integer := 109;
  v_purchases integer;
  v_todo      integer;
  v_done      integer;
  v_updated   integer;
  v_moves     integer;
  v_stock     bigint;
  v_row       record;
begin
  /*
   * The ledger and the stock, before. Read here and compared at the end:
   * this block writes to neither, and the cheapest way to keep that true is
   * to prove it rather than to assert it.
   */
  select count(*) into v_moves from public.inventory_movements;
  select coalesce(sum(quantity), 0) into v_stock from public.shop_inventory;

  create temporary table tmp_0067_orders (
    fingerprint text primary key,
    items       integer not null
  ) on commit drop;

  insert into tmp_0067_orders (fingerprint, items) values
    ('b12a36227a55a52afdb8411bba28e26232a2af733b192bfc367eec735052b49e', 54),
    ('9fd2e9ba6adbe7ae78f983082f7dca3228d51b40ef556ba507e713a285041e0d', 41),
    ('263f65622db1f34c51b12454892d38a809fd1dc3a532f13051eae0eb0ef5d381',  9),
    ('efd427bbe67c0fb651f41e7095208700a6db2b154b24d0d392ab4e6cc32abf92',  4),
    ('77e90e02a65060f203e0572dee98d33da6e877d0ccfc8285b7560de81faaf225',  1);

  /*
   * ALL FIVE ORDERS HAVE TO BE THERE, AND EACH WITH THE POSITIONS IT HAD.
   *
   * Checked per order rather than on the total: 54 + 41 + 9 + 4 + 1 also
   * comes to 109 if two of them swapped sizes, and an order that lost or
   * gained a position since the count was taken is exactly the case this
   * must not paper over.
   */
  select count(*) into v_purchases
    from public.purchases p
    join tmp_0067_orders o on o.fingerprint = p.import_fingerprint
   where p.source = 'excel_order_2026';

  if v_purchases <> v_expected_purchases then
    raise exception 'expected % workbook orders, found % — refusing to guess',
      v_expected_purchases, v_purchases using errcode = 'data_exception';
  end if;

  for v_row in
    select o.fingerprint, o.items as expected, count(i.id) as actual
      from tmp_0067_orders o
      join public.purchases p
        on p.import_fingerprint = o.fingerprint and p.source = 'excel_order_2026'
      left join public.purchase_items i on i.purchase_id = p.id
     group by o.fingerprint, o.items
  loop
    if v_row.actual <> v_row.expected then
      raise exception 'order % holds % positions, expected % — refusing to guess',
        left(v_row.fingerprint, 12), v_row.actual, v_row.expected
        using errcode = 'data_exception';
    end if;
  end loop;

  /* How many still need moving, and how many are already where they belong. */
  select
    count(*) filter (where i.state = 'reconciled_legacy' and i.movement_id is null),
    count(*) filter (where i.state = 'ordered' and i.movement_id is null)
    into v_todo, v_done
    from public.purchase_items i
    join public.purchases p on p.id = i.purchase_id
    join tmp_0067_orders o on o.fingerprint = p.import_fingerprint
   where p.source = 'excel_order_2026';

  /* Already applied. Say so and stop, rather than failing because it worked. */
  if v_todo = 0 and v_done = v_expected_items then
    raise notice '0067: bereits angewendet — % Positionen stehen auf ordered.', v_done;
    return;
  end if;

  if v_todo <> v_expected_items or v_done <> 0 then
    raise exception 'expected % frozen positions and 0 already open, found % and % — refusing to guess',
      v_expected_items, v_todo, v_done using errcode = 'data_exception';
  end if;

  with target as (
    select i.id
      from public.purchase_items i
      join public.purchases p on p.id = i.purchase_id
      join tmp_0067_orders o on o.fingerprint = p.import_fingerprint
     where p.source = 'excel_order_2026'
       and i.state = 'reconciled_legacy'
       and i.movement_id is null
  ), moved as (
    update public.purchase_items i
       set state = 'ordered',
           updated_at = now()
      from target t
     where i.id = t.id
    returning i.id
  )
  select count(*) into v_updated from moved;

  if v_updated <> v_expected_items then
    raise exception 'updated % positions, expected % — rolling back',
      v_updated, v_expected_items using errcode = 'data_exception';
  end if;

  /*
   * Afterwards: every position of the four orders is `ordered`, and not one
   * of them owns a movement. The constraint already forbids the second; this
   * says so where it is being relied upon.
   */
  if exists (
    select 1
      from public.purchase_items i
      join public.purchases p on p.id = i.purchase_id
      join tmp_0067_orders o on o.fingerprint = p.import_fingerprint
     where p.source = 'excel_order_2026'
       and (i.state <> 'ordered' or i.movement_id is not null)
  ) then
    raise exception 'a reopened position missed its state or owns a movement'
      using errcode = 'data_exception';
  end if;

  /* And the two things this migration may not touch are untouched. */
  if (select count(*) from public.inventory_movements) <> v_moves then
    raise exception 'inventory movements changed — rolling back'
      using errcode = 'data_exception';
  end if;
  if (select coalesce(sum(quantity), 0) from public.shop_inventory) <> v_stock then
    raise exception 'stock changed — rolling back' using errcode = 'data_exception';
  end if;

  raise notice '0067: % Positionen aus % Bestellungen auf ordered gesetzt. Bestand % unveraendert, % Bewegungen unveraendert.',
    v_updated, v_purchases, v_stock, v_moves;
end;
$$;
