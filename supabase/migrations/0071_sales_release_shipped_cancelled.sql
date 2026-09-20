-- ===========================================================================
-- 0071 — TWENTY-TWO HISTORICAL SALES GET THEIR REAL STATE BACK
-- ===========================================================================
--
-- The Verkauf side was frozen the same way the Einkauf side was, and with the
-- same blunt instrument: `source = 'excel_order_2026'`. `seller_book_sale_item`
-- refuses that source outright and `is_open` excludes it, so every workbook
-- sale is history that nothing can act on.
--
-- That is right for 271 of them and wrong for 22. Those 22 are the orders the
-- owner placed from 13.08.2026 on:
--
--   21 shipped, and NOT taken out of stock. The workbook says so itself:
--      column M (header `S`) is `x`, column L (header `T`) is empty. Across
--      the whole sheet M=x on 1219 rows and L=x on only 991, so "shipped but
--      still on the shelf" is a state the workbook records, not one we infer.
--    1 cancelled: L and M both `-`, never shipped, never taken out.
--
-- WHY THREE NEW COLUMNS AND NOT A STATE MACHINE
--
-- `sale_items` has no `state`; the Verkauf side records facts, and each of
-- these is a fact with a time:
--
--   sales.cancelled_at       this order was called off
--   sales.stock_released_at  this historical order may do stock work
--   sale_items.settled_at    this position is finished WITHOUT a movement
--
-- `stock_released_at` is the release itself, and it defaults to NULL — so
-- every other workbook sale stays exactly as frozen as it is today, and a
-- sale can only ever be released by being named. Fail-closed by construction
-- rather than by a filter somebody has to keep correct.
--
-- THE TIMESTAMPS ARE THE SALE'S OWN DATE, NOT NOW
--
-- The workbook records THAT an order shipped, never when. `sold_at` is the
-- nearest thing it does record, so `shipped_at` and `cancelled_at` take it
-- rather than a `now()` that would state a falsehood precisely. Only
-- `stock_released_at` is `now()`, because the release really is happening now.
--
-- NO INVENTORY. No movement, no quantity, no `shop_inventory`. Counted before
-- and after and compared.
--
-- NO SKY-IDs ARE WRITTEN. The workbook never linked these 22 to the catalog —
-- 0 of their 197 rows carry a column-P formula, against 1014 of the other
-- 1059 — but the IMPORTER resolved 193 of them anyway, from the owner's own
-- references to the same names elsewhere. They are already in the database.
-- There is nothing to write and nothing to guess; the remaining 4 are a
-- portal and three Disney Infinity figures, which have no catalog row by
-- nature and keep none.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. The three facts
-- ---------------------------------------------------------------------------

alter table public.sales
  add column if not exists cancelled_at      timestamptz,
  add column if not exists stock_released_at timestamptz;

alter table public.sale_items
  add column if not exists settled_at timestamptz;

comment on column public.sales.cancelled_at is
  'When this order was called off (0071). A cancelled sale is never open, never books stock and needs no per-item ending: nothing left the shelf.';
comment on column public.sales.stock_released_at is
  'When a HISTORICAL sale was released for stock work (0071). NULL for every workbook sale by default, which is what keeps `seller_book_sale_item` refusing them. Set only for orders confirmed to be shipped-but-not-taken-out; it has no meaning for a hand-made sale, which was never frozen.';
comment on column public.sale_items.settled_at is
  'When this position was closed WITHOUT an inventory movement (0071) — a non-catalog article, or one the workbook marked as not taken from stock (`legacy_stock_flag = ''-''`). Never an outbooking: `movement_id` stays NULL and the two may not coexist.';

/*
 * SETTLED AND BOOKED ARE MUTUALLY EXCLUSIVE, at the table level.
 *
 * `settled_at` means "finished, and no movement was made". A row holding
 * both would be claiming the position left the shelf AND that it did not.
 */
alter table public.sale_items
  drop constraint if exists sale_items_settled_has_no_movement;
alter table public.sale_items
  add constraint sale_items_settled_has_no_movement
  check (settled_at is null or movement_id is null);

/*
 * A CANCELLED ORDER IS NEVER RELEASED.
 *
 * The one cancelled sale must not become bookable by any route, so the two
 * columns cannot both be set. The booking function checks `cancelled_at`
 * too — this is the floor under that check, not a replacement for it.
 */
alter table public.sales
  drop constraint if exists sales_cancelled_is_not_released;
alter table public.sales
  add constraint sales_cancelled_is_not_released
  check (cancelled_at is null or stock_released_at is null);


-- ---------------------------------------------------------------------------
-- 2. The twenty-two, by fingerprint
-- ---------------------------------------------------------------------------

do $$
declare
  v_expected_shipped   constant integer := 21;
  v_expected_cancelled constant integer := 1;
  v_expected_items     constant integer := 197;
  v_shipped   integer;
  v_cancelled integer;
  v_items     integer;
  v_moves     integer;
  v_stock     bigint;
  v_updated   integer;
begin
  select count(*) into v_moves from public.inventory_movements;
  select coalesce(sum(quantity), 0) into v_stock from public.shop_inventory;

  /*
   * Identified by `import_fingerprint`, never by id: the projects assigned
   * their own (290…311 on Staging, 274…295 in Production) and the
   * fingerprint is the same value in both, so this file is byte-identical
   * for each.
   */
  create temporary table tmp_0071_shipped (fingerprint text primary key) on commit drop;
  insert into tmp_0071_shipped values
    ('e99299d6c4a842b052b8936d678e5f080b3a6b8ae091d06472db2ab2d9d656f3'), -- 13.08.   3.31 ·  2
    ('cefee8c42d5e42020fd4012a4d02c50794d7d2a6c6c76946fb07c4d8d7d7852b'), -- 31.08.  26.04 ·  6
    ('f02694ce3b91b4db57cc5a9da24ffbdda0470c302f8e4bed194dfeeba6f74e33'), -- 31.08.   9.43 ·  2
    ('df709e8b719b498c6550c8bf142bbc483fd5ecdd50bf04fa5074cebcf3e7824f'), -- 05.09.  39.92 · 12
    ('f6ba018db4ff4bc27075eb825733f673d15b02131bc7ba051d87fa99328adffc'), -- 06.09.  18.30 ·  6
    ('5d120e657df87a8b1235a49b6bfc0297bffa23006113201f3d58ca626b411059'), -- 06.09.  87.28 ·  4
    ('fbae0d650d5eb29d2247a4bcec319f73044214eb8ab509ba3cdb939d10fc3f7b'), -- 06.09.  35.08 ·  2
    ('b1b68148c13934310dc76fca2f1aefb394a94cf6e958eb6fa1a0393ce7847b7f'), -- 10.09.  31.49 ·  1
    ('043720ff8cc55fb30c77a6728ac82fc472f5d9ca8c3845d522188a4b1fb626cb'), -- 11.09.  10.79 ·  1
    ('d2588fb1dacacadd0e962355c325f9a94fa9964653cf3fdfee2ea237e777c7bc'), -- 13.09.  59.37 ·  3
    ('8b52e5a0eb8ed1f520697d1aae102d006b32a1d46ec10049175c5f207b772733'), -- 13.09.  98.40 · 95
    ('de6cb294cae860251f0e937227fbe1e0337df68613ab0b69460cf338879b8bf8'), -- 13.09.  13.92 ·  3
    ('3ca98147c95810863cbe51282612a998a6d41a6fc0763d0573d8fe3cd54ab64f'), -- 14.09.  52.07 · 27
    ('3feab643a6392def4bbb4b26cef6c23dc5293187e309c3f9a27ba7604314717d'), -- 14.09.   4.04 ·  1
    ('d993446fd67153797e70f6f12491be516b340459756e0cb977ce1621df2c6fc5'), -- 14.09.   1.79 ·  1
    ('22fe5be78cd098749c4ae8bb27305b2cbb2813800687bbf91e68c0c67569f744'), -- 14.09.   2.24 ·  1
    ('a5598a000c637a7a0442b6e1a9ccfb32ad5ff86f06fe3e98808408880d0e5809'), -- 14.09.  28.32 ·  3
    ('b4efc7a34097ee21f57e7e4097f41d15eabd2e08319095afd77c76437c0739bd'), -- 14.09.  61.13 ·  7
    ('3e5c1163d8b4b5965b81ee02569e4a35e129cea53a2d5483e2271e00db51c849'), -- 14.09.  14.42 ·  9
    ('2d5e2b77a157904271920f3a6121466c2fdde84b0e2a16b378c0671f5a29254f'), -- 15.09.   6.72 ·  3
    ('fae1dbdabd681e5352ad4785d9253e71811ecb5dbc6749dae60771940b4aef71'); -- 16.09.  20.80 ·  3

  create temporary table tmp_0071_cancelled (fingerprint text primary key) on commit drop;
  insert into tmp_0071_cancelled values
    ('94293f2a32c77305455bc2b5b0d83fb8f9c88e11f1c17d3f7df3f4533ba2c237'); -- 31.08.  17.50 ·  5

  /* Already applied — say so and stop, rather than failing because it worked. */
  if exists (select 1 from public.sales s join tmp_0071_shipped t
                     on t.fingerprint = s.import_fingerprint
              where s.stock_released_at is not null)
  then
    raise notice '0071: bereits angewendet.';
    return;
  end if;

  select count(*) into v_shipped from public.sales s
    join tmp_0071_shipped t on t.fingerprint = s.import_fingerprint
   where s.source = 'excel_order_2026';
  select count(*) into v_cancelled from public.sales s
    join tmp_0071_cancelled t on t.fingerprint = s.import_fingerprint
   where s.source = 'excel_order_2026';

  if v_shipped <> v_expected_shipped or v_cancelled <> v_expected_cancelled then
    raise exception 'expected % shipped and % cancelled orders, found % and % — refusing to guess',
      v_expected_shipped, v_expected_cancelled, v_shipped, v_cancelled
      using errcode = 'data_exception';
  end if;

  select count(*) into v_items
    from public.sale_items i
    join public.sales s on s.id = i.sale_id
   where s.import_fingerprint in (select fingerprint from tmp_0071_shipped
                                  union all select fingerprint from tmp_0071_cancelled);
  if v_items <> v_expected_items then
    raise exception 'expected % positions, found % — refusing to guess',
      v_expected_items, v_items using errcode = 'data_exception';
  end if;

  /*
   * NOT ONE OF THEM MAY ALREADY OWN A MOVEMENT. If one did, this release
   * would be handing out a second ending to something already finished.
   */
  if exists (
    select 1 from public.sale_items i
      join public.sales s on s.id = i.sale_id
     where s.import_fingerprint in (select fingerprint from tmp_0071_shipped
                                    union all select fingerprint from tmp_0071_cancelled)
       and (i.movement_id is not null or i.return_movement_id is not null
            or i.settled_at is not null))
  then
    raise exception 'a position of these orders already owns a movement or an ending'
      using errcode = 'data_exception';
  end if;

  /* The catalog picture must be the one that was measured. */
  if (select count(*) from public.sale_items i
        join public.sales s on s.id = i.sale_id
       where s.import_fingerprint in (select fingerprint from tmp_0071_shipped
                                      union all select fingerprint from tmp_0071_cancelled)
         and i.sky_id is not null) <> 193
  then
    raise exception 'expected 193 positions with a sky_id — refusing to guess'
      using errcode = 'data_exception';
  end if;

  /*
   * And the one position that carries a sky_id but is NOT stock-relevant:
   * `Terrafin S2`, the workbook's `L = "-"` on a shipped line. Six rows carry
   * that marker; five are the cancelled order, so exactly one sits inside a
   * released order — and 0073 is written around that number being one.
   */
  if (select count(*) from public.sale_items i
        join public.sales s on s.id = i.sale_id
       where s.import_fingerprint in (select fingerprint from tmp_0071_shipped)
         and i.legacy_stock_flag = '-') <> 1
  then
    raise exception 'expected exactly one not-from-stock position among the shipped orders'
      using errcode = 'data_exception';
  end if;

  /* --------------------------------------------------------------- write */

  update public.sales s
     set shipped_at = coalesce(s.shipped_at, s.sold_at::timestamptz),
         stock_released_at = now(),
         updated_at = now()
    from tmp_0071_shipped t
   where t.fingerprint = s.import_fingerprint and s.source = 'excel_order_2026';
  get diagnostics v_updated = row_count;
  if v_updated <> v_expected_shipped then
    raise exception 'released % orders, expected % — rolling back', v_updated, v_expected_shipped
      using errcode = 'data_exception';
  end if;

  update public.sales s
     set cancelled_at = coalesce(s.cancelled_at, s.sold_at::timestamptz),
         updated_at = now()
    from tmp_0071_cancelled t
   where t.fingerprint = s.import_fingerprint and s.source = 'excel_order_2026';
  get diagnostics v_updated = row_count;
  if v_updated <> v_expected_cancelled then
    raise exception 'cancelled % orders, expected % — rolling back', v_updated, v_expected_cancelled
      using errcode = 'data_exception';
  end if;

  /* --------------------------------------------------------------- check */

  if (select count(*) from public.inventory_movements) <> v_moves then
    raise exception 'inventory movements changed — rolling back' using errcode = 'data_exception';
  end if;
  if (select coalesce(sum(quantity), 0) from public.shop_inventory) <> v_stock then
    raise exception 'stock changed — rolling back' using errcode = 'data_exception';
  end if;

  raise notice '0071: % Bestellungen freigegeben und als verschickt markiert, % storniert, % Positionen unberuehrt. Bestand % unveraendert, % Bewegungen unveraendert.',
    v_expected_shipped, v_expected_cancelled, v_items, v_stock, v_moves;
end;
$$;
