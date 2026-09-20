/**
 * 0067 — five parcels that are still in the post (V4.7).
 *
 * WHAT THE MIGRATION IS
 *
 * A data correction with an exact predicate. `0053` imported every row of
 * `Order 2026` as `reconciled_legacy`, which is frozen: it cannot be booked,
 * it cannot be set, and the Orderbuch offers no action on it. That is right
 * for the 2 001 positions the workbook had ticked into stock and wrong for
 * five orders the owner placed in late August and has not received.
 *
 * THE UNIT IS THE PURCHASE. An earlier draft opened eleven positions picked
 * by SKY-ID, because those were the only ones the stock sheets could prove
 * had never arrived. The owner then checked the parcels and named four
 * orders; the fifth was read out of the workbook, because all four of its
 * positions carry the same untouched signature. A parcel arrives whole or
 * not at all.
 *
 * The copy that arrived broken — `Legendary Jawbreaker (b)`, row 2006 — was
 * never imported, so there is nothing here to protect it from.
 *
 * WHAT THESE TESTS GUARD
 *
 * The migration runs once, by hand, in the SQL editor — there is no DDL path
 * from here — so it cannot be executed in a unit test. What can be held
 * still is its text: that it touches no inventory, creates no movement,
 * changes no schema, and refuses to run unless it finds all five orders
 * with exactly the positions each of them had.
 *
 * A migration that quietly corrected 108 or 110 rows would be worse than one
 * that failed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { de } from "@/lib/i18n/de";

const SQL = readFileSync(
  join(process.cwd(), "supabase/migrations/0067_reopen_undelivered_legacy_items.sql"), "utf8");

/** The statements, with the commentary stripped: a comment is not a command. */
const code = SQL.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");

/** The five orders, by the fingerprint both projects share. */
const ORDERS: [string, number][] = [
  ["b12a36227a55a52afdb8411bba28e26232a2af733b192bfc367eec735052b49e", 54],
  ["9fd2e9ba6adbe7ae78f983082f7dca3228d51b40ef556ba507e713a285041e0d", 41],
  ["263f65622db1f34c51b12454892d38a809fd1dc3a532f13051eae0eb0ef5d381", 9],
  ["efd427bbe67c0fb651f41e7095208700a6db2b154b24d0d392ab4e6cc32abf92", 4],
  ["77e90e02a65060f203e0572dee98d33da6e877d0ccfc8285b7560de81faaf225", 1],
];

describe("what 0067 changes", () => {
  it("moves the frozen rows to `ordered`, and to nothing else", () => {
    expect(code).toMatch(/set state = 'ordered'/);
    /*
     * NOT `arrived`. The owner knows these are in transit and does not know
     * they have landed; `arrived` would state a fact nobody has. The detail
     * screen moves them on with one press when they turn up.
     */
    expect(code).not.toContain("'arrived'");
    expect(code).not.toContain("'booked'");
  });

  it("names the five orders and the positions each must hold", () => {
    for (const [fp, n] of ORDERS) {
      expect(code, fp.slice(0, 12)).toContain(`'${fp}', `);
      expect(code, `${fp.slice(0, 12)} → ${n}`).toMatch(
        new RegExp(`'${fp}',\\s*${n}\\b`));
    }
    expect(code).toMatch(/v_expected_purchases\s+constant\s+integer\s*:=\s*5/);
    expect(code).toMatch(/v_expected_items\s+constant\s+integer\s*:=\s*109/);
    expect(ORDERS.reduce((s2, [, n]) => s2 + n, 0)).toBe(109);
  });

  it("identifies the orders by fingerprint, never by id", () => {
    /*
     * `purchases.id` is `generated always as identity` and the projects
     * assigned their own: 88/89/91/92/93 on Staging, 79/80/82/83/84 in
     * Production. A migration keyed on those would correct the wrong rows
     * in one of them.
     */
    expect(code).toContain("o.fingerprint = p.import_fingerprint");
    expect(code).not.toMatch(/p\.id\s*(in|=)\s*\(?\s*\d/);
  });

  it("no longer opens positions by SKY-ID", () => {
    // The eleven-unit draft is gone, not kept beside this one. One of those
    // eleven sits in an order the owner did not confirm, and it stays frozen.
    expect(code).not.toMatch(/SKY-\d{4}/);
    expect(code).not.toContain("legacy_booked_flag");
  });

  it("updates exactly one table", () => {
    const updated = [...code.matchAll(/update\s+(public\.\w+)/g)].map((m) => m[1]);
    expect(new Set(updated)).toEqual(new Set(["public.purchase_items"]));
  });
});

describe("what 0067 must not touch", () => {
  it("creates no stock movement", () => {
    expect(code).not.toContain("record_inventory_movement");
    expect(code).not.toMatch(/insert\s+into\s+public\.inventory_movements/);
    // It READS the ledger, to prove it left it alone.
    expect(code).toMatch(/select count\(\*\) into v_moves from public\.inventory_movements/);
  });

  it("changes no stock quantity", () => {
    expect(code).not.toMatch(/update\s+public\.shop_inventory/);
    expect(code).not.toMatch(/insert\s+into\s+public\.shop_inventory/);
    expect(code).toMatch(/select coalesce\(sum\(quantity\), 0\) into v_stock/);
  });

  it("leaves `movement_id` alone, so nothing can claim stock by accident", () => {
    expect(code).not.toMatch(/set[^;]*movement_id/);
    // And it only ever selects rows that have none.
    expect(code).toMatch(/movement_id is null/);
  });

  it("changes no schema at all", () => {
    for (const ddl of ["create table", "alter table", "drop table", "create or replace function",
                       "create policy", "alter policy", "create index"]) {
      expect(code.toLowerCase(), ddl).not.toContain(ddl);
    }
  });

  it("keeps the provenance that justifies the correction", () => {
    // `source_row` and the two legacy flags are the evidence. A correction
    // that erased its own evidence could not be checked afterwards.
    expect(code).not.toMatch(/set[^;]*legacy_booked_flag/);
    expect(code).not.toMatch(/set[^;]*legacy_condition_flag/);
    expect(code).not.toMatch(/set[^;]*source_row/);
  });

  it("touches only the temporary list it builds, and the items", () => {
    const written = [...code.matchAll(/(?:insert into|update)\s+(\S+)/g)].map((m) => m[1]);
    expect(new Set(written)).toEqual(new Set(["tmp_0067_orders", "public.purchase_items"]));
  });

  it("opens no other historical purchase", () => {
    /*
     * Every other workbook order stays frozen. The join to the five
     * fingerprints is the whole of the selection — there is no flag test
     * that could widen it, and no SKY-ID that could single a figure out.
     */
    expect(code).toContain("join tmp_0067_orders o on o.fingerprint = p.import_fingerprint");
    expect(code).toContain("p.source = 'excel_order_2026'");
    const fingerprints = code.match(/'[0-9a-f]{64}'/g) ?? [];
    expect(new Set(fingerprints).size).toBe(5);
  });
});

describe("0067 refuses to guess", () => {
  it("raises unless all five orders are present", () => {
    expect(code).toMatch(/if v_purchases <> v_expected_purchases then/);
    expect(code).toMatch(/expected % workbook orders/);
  });

  it("checks the size of each order, not just the total", () => {
    /*
     * 54 + 41 + 9 + 4 + 1 is still 109 if two of them swapped sizes, and an
     * order that lost or gained a position is exactly what must not be
     * papered over.
     */
    expect(code).toMatch(/for v_row in/);
    expect(code).toMatch(/if v_row\.actual <> v_row\.expected then/);
    expect(code).toMatch(/order % holds % positions, expected %/);
  });

  it("raises unless it finds exactly 109 frozen positions", () => {
    expect(code).toMatch(/if v_todo <> v_expected_items or v_done <> 0 then/);
    expect(code).toMatch(/raise exception[\s\S]*?refusing to guess/);
  });

  it("raises unless it updated exactly 109", () => {
    expect(code).toMatch(/if v_updated <> v_expected_items then/);
    expect(code).toMatch(/rolling back/);
  });

  it("checks the ledger and the stock again afterwards", () => {
    expect(code).toMatch(/if \(select count\(\*\) from public\.inventory_movements\) <> v_moves then/);
    expect(code).toMatch(/if \(select coalesce\(sum\(quantity\), 0\) from public\.shop_inventory\) <> v_stock then/);
  });

  it("is safe to run twice", () => {
    // A second run finds the eleven already `ordered` and says so, rather
    // than failing a count check that is only wrong because it worked.
    expect(code).toMatch(/if v_todo = 0 and v_done = v_expected_items then/);
    expect(code).toMatch(/bereits angewendet/);
    expect(code).toContain("return;");
  });

  it("does the whole thing in one block, so a failure leaves nothing behind", () => {
    expect((SQL.match(/\$\$/g) ?? [])).toHaveLength(2);
    expect(code.trimStart().startsWith("do $$")).toBe(true);
  });
});

describe("what the reopened items may do afterwards", () => {
  /*
   * Nothing in `0053` needed changing for this, and these assertions say
   * why: the guards are written against `reconciled_legacy`, so a row that
   * is no longer in that state is an ordinary open position and the
   * existing workflow reaches it — `Bestellt → Angekommen → Einbuchen`.
   */
  const CREATE = readFileSync(
    join(process.cwd(), "supabase/migrations/0053_orderbook_purchases.sql"), "utf8");

  it("the booking function refuses the state they left, not the one they are in", () => {
    expect(CREATE).toMatch(/if v_item\.state = 'reconciled_legacy' then\s*\n\s*raise exception 'a historical purchase item/);
  });

  it("the state setter accepts `ordered` and `arrived`", () => {
    expect(CREATE).toMatch(/p_state not in \('ordered', 'arrived', 'damaged', 'missing'\)/);
  });

  it("`booked` remains unreachable except through a real booking", () => {
    // Which is what makes `state = 'booked'` and `movement_id is not null`
    // the same statement, and the ✓ in the ledger truthful.
    expect(CREATE).toMatch(/p_state not in \('ordered', 'arrived', 'damaged', 'missing'\)/);
    expect(CREATE).toContain("constraint purchase_items_booked_has_movement");
    expect(CREATE).toMatch(/check \(\(state = 'booked'\) = \(movement_id is not null\)\)/);
  });

  it("the detail screen gates on the state, so nothing else had to change", () => {
    const ITEMS = readFileSync(
      join(process.cwd(), "src/components/business/purchase-items.tsx"), "utf8");
    expect(ITEMS).toContain('const legacy = item.state === "reconciled_legacy"');
    expect(ITEMS).toContain("QUICK_STATES.map");
  });
});

/* ===================================================================== */
describe("0068 — outstanding is not the same as bookable", () => {
  /*
   * The trophy and the two portals in the 111.99 EUR parcel. They are in
   * the post with the other 38 positions, they can never enter figure
   * inventory, and `is_open` used to hide them for the second reason while
   * the first was still true.
   */
  const LEDGER = readFileSync(
    join(process.cwd(), "supabase/migrations/0068_open_counts_non_catalog_items.sql"), "utf8");
  /* A comment that NAMES the removed clause is not the clause. */
  const sql = LEDGER.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");

  /** The `is_open` expression as the function actually declares it. */
  const openExpr = (() => {
    const at = sql.indexOf("as is_open");
    return sql.slice(sql.lastIndexOf("exists (select 1", at), at);
  })();

  it("no longer requires a catalog figure to count as outstanding", () => {
    expect(openExpr).not.toContain("sky_id");
  });

  it("still asks the two things that DO decide it", () => {
    expect(openExpr).toContain("i.movement_id is null");
    expect(openExpr).toContain("i.state in ('ordered', 'arrived')");
  });

  it("keeps a historical row out of the open count", () => {
    /*
     * `reconciled_legacy` is not in the state list, so a workbook line the
     * owner never ticked is still not outstanding — which is why 0067 had
     * to move the five parcels to `ordered` rather than widen this.
     */
    expect(openExpr).not.toContain("reconciled_legacy");
  });

  it("offers no button it cannot honour", () => {
    // The screen-side rule is untouched: no `Einbuchen` without a figure,
    // so nothing invites the fake movement this must not create.
    const LEDGER_TS = readFileSync(join(process.cwd(), "src/lib/orderbook/ledger.ts"), "utf8");
    expect(LEDGER_TS).toContain("if (item.skyId === null) return false;");
  });

  it("changes one expression and nothing else", () => {
    // No DML, no schema, no movement, no stock.
    for (const forbidden of ["record_inventory_movement", "shop_inventory",
                             "insert into", "update public.", "delete from",
                             "alter table", "create table"]) {
      expect(sql.toLowerCase(), forbidden).not.toContain(forbidden);
    }
    expect(sql).toContain("create or replace function public.seller_orderbook_ledger(");
    expect((sql.match(/create or replace function/g) ?? [])).toHaveLength(1);
  });

  it("keeps the signature, so every caller still fits", () => {
    expect(sql).toContain("p_year    integer default null");
    expect(sql).toContain("p_status  text    default 'normal'");
    expect(LEDGER).toContain(
      "comment on function public.seller_orderbook_ledger(integer, integer, text, boolean, text)");
  });

  it("leaves the Verkauf ledger alone", () => {
    // Selling takes stock OUT; something that never entered cannot leave.
    expect(sql).not.toContain("seller_sales");
  });
});

/* ===================================================================== */
describe("0069 — `settled`, and the door it must not open", () => {
  const SETTLED = readFileSync(
    join(process.cwd(), "supabase/migrations/0069_settled_non_catalog_items.sql"), "utf8");
  const sql = SETTLED.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
  /** The Quickbox function body as 0069 leaves it. */
  const quickbox = sql.slice(sql.indexOf("create or replace function public.seller_set_purchase_item_state"),
                             sql.indexOf("comment on function public.seller_set_purchase_item_state"));

  describe("THE LOCK", () => {
    it("refuses `settled` for anything that has a sky_id", () => {
      /*
       * The whole reason this migration needs care. `settled` writes no
       * movement; a catalog figure reaching it would be off the open list,
       * never booked, and the stock short by one with nothing to show.
       */
      expect(quickbox).toContain("if p_state = 'settled' and v_sky is not null then");
      expect(quickbox).toMatch(/raise exception 'a catalog figure is booked into inventory, never settled'/);
    });

    it("reads the figure from the row, never from the caller", () => {
      /*
       * An RPC client chooses the item and the state. It does not get to say
       * whether the item is a figure — that is looked up, under the same
       * `for update` lock as the state.
       */
      expect(quickbox).toContain("select state, sky_id into v_current, v_sky");
      expect(quickbox).toContain("for update");
      // The guard tests the variable that was read, not a parameter.
      expect(quickbox).not.toMatch(/p_sky|p_is_figure|p_catalog/);
    });

    it("cannot be reached through the booking function either", () => {
      const CREATE = readFileSync(
        join(process.cwd(), "supabase/migrations/0053_orderbook_purchases.sql"), "utf8");
      // Booking still sets `booked` and nothing else, and still needs a figure.
      expect(CREATE).toMatch(/set state = 'booked'/);
      expect(CREATE).toMatch(/this item is not a catalog figure and cannot enter figure inventory/);
      // 0069 redefines the Quickbox and nothing else — the booking function
      // is named only in the sentence that documents the difference.
      expect(quickbox).not.toContain("seller_book_purchase_item");
      expect((sql.match(/create or replace function/g) ?? [])).toHaveLength(1);
    });

    it("keeps `booked` out of the Quickbox, as before", () => {
      expect(quickbox).toContain("if p_state not in ('ordered', 'arrived', 'damaged', 'missing', 'settled') then");
      expect(quickbox).not.toMatch(/p_state not in \([^)]*'booked'/);
    });

    it("still refuses to touch a booked or historical row", () => {
      expect(quickbox).toContain("if v_current = 'booked' then");
      expect(quickbox).toContain("if v_current = 'reconciled_legacy' then");
    });

    it("and the screen never offers what the server would refuse", () => {
      const PURCHASE = readFileSync(join(process.cwd(), "src/lib/orderbook/purchase.ts"), "utf8");
      expect(PURCHASE).toContain("export function canSettle");
      expect(PURCHASE).toMatch(/canSettle[\s\S]*?if \(item\.skyId !== null\) return false;/);
    });
  });

  describe("what settled is", () => {
    it("is in the constraint, so the column can hold it", () => {
      expect(sql).toContain("add constraint purchase_items_state_known");
      expect(sql).toMatch(/'reconciled_legacy', 'settled'/);
    });

    it("writes no movement and no stock", () => {
      for (const forbidden of ["record_inventory_movement", "shop_inventory",
                               "insert into", "delete from"]) {
        expect(sql.toLowerCase(), forbidden).not.toContain(forbidden);
      }
      // The only UPDATE is the state of the one row being set.
      const updates = [...sql.matchAll(/update\s+(\S+)/g)].map((m) => m[1]);
      expect(updates).toEqual(["public.purchase_items"]);
    });

    it("is terminal without any change to `is_open`", () => {
      /*
       * `is_open` asks for `ordered` or `arrived`. `settled` is neither, so
       * 0068 needed nothing added — which is why 0069 does not touch it.
       */
      const LEDGER = readFileSync(
        join(process.cwd(), "supabase/migrations/0068_open_counts_non_catalog_items.sql"), "utf8");
      expect(LEDGER).toContain("i.state in ('ordered', 'arrived')");
      expect(sql).not.toContain("seller_orderbook_ledger");
    });

    it("is reversible, because nothing irreversible happened", () => {
      // No `if v_current = 'settled' then raise` — unlike `booked`, which
      // owns a movement and has to be reversed rather than overwritten.
      expect(quickbox).not.toMatch(/v_current = 'settled'/);
    });
  });

  describe("what the screens show", () => {
    const LEDGER_TS = readFileSync(join(process.cwd(), "src/lib/orderbook/ledger.ts"), "utf8");
    const ITEMS = readFileSync(
      join(process.cwd(), "src/components/business/purchase-items.tsx"), "utf8");

    it("gives settled its own status, and no tick", () => {
      /*
       * A tick means a stock movement. Filing a portal away is an ending,
       * not a booking, so it says `Erledigt` and leaves the ✓ alone.
       */
      expect(LEDGER_TS).toMatch(/if \(item\.state === "settled"\) return "settled";/);
      expect(de.business.orderbook.states.settled).toBe("Erledigt");
      expect(de.business.orderbook.states.settled).not.toContain("✓");
      // And it is checked AFTER the movement, so a booked row still wins.
      expect(LEDGER_TS.indexOf('movementId !== null'))
        .toBeLessThan(LEDGER_TS.indexOf('item.state === "settled"'));
    });

    it("offers Erledigt instead of a permanently disabled Einbuchen", () => {
      expect(ITEMS).toContain("const nonCatalog = item.skyId === null;");
      expect(ITEMS).toContain("canSettle({ state: item.state, skyId: item.skyId })");
      expect(ITEMS).toContain('quick(item, "settled")');
      // The booking branch is the `else`, so a portal never reaches it.
      expect(ITEMS).toMatch(/\) : nonCatalog \? \(/);
    });

    it("lets a mis-click be taken back", () => {
      expect(ITEMS).toContain('quick(item, "arrived")');
      expect(de.business.orderbook.unsettle).toBe("Zurücknehmen");
    });

    it("leaves a normal figure alone", () => {
      // `QUICK_STATES` is untouched: settled is not something to pick from
      // the row of four, it is an action with a precondition.
      const PURCHASE = readFileSync(join(process.cwd(), "src/lib/orderbook/purchase.ts"), "utf8");
      expect(PURCHASE).toContain(
        'export const QUICK_STATES: readonly ItemState[] = ["ordered", "arrived", "damaged", "missing"];');
      expect(ITEMS).toContain("canBook({ state: item.state, skyId: item.skyId })");
    });
  });
});

/* ===================================================================== */
describe("0070 — the ledger row carries the settled count", () => {
  const SQL70 = readFileSync(
    join(process.cwd(), "supabase/migrations/0070_ledger_settled_count.sql"), "utf8");
  const sql = SQL70.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");

  it("counts the settled positions of each purchase", () => {
    expect(sql).toMatch(/where s\.purchase_id = p\.id and s\.state = 'settled'/);
    expect(sql).toContain("'settled_count', m.settled_items");
  });

  it("never folds them into the booked count", () => {
    /*
     * The rule the whole release exists to restore: `Eingebucht` means a
     * movement exists. A settled portal owns none, so it may be counted as
     * closed and never as booked.
     */
    expect(sql).toContain("'booked_count', m.booked_items");
    expect(sql).not.toMatch(/booked_items\s*\+\s*\S*settled/);
    expect(sql).not.toMatch(/settled\S*\s*\+\s*\S*booked_items/);
  });

  it("subtracts both from what is left open", () => {
    expect(sql).toContain("'open_count', m.total_items - m.booked_items - m.settled_items");
  });

  it("leaves purchase_market_value alone", () => {
    // Widening a typed row would mean dropping it and everything that reads
    // it, for a number one caller needs.
    expect(sql).not.toContain("create or replace function public.purchase_market_value");
    expect(sql).toContain("cross join lateral public.purchase_market_value(p.id) v");
  });

  it("is read-only: one stable function, no movement, no stock", () => {
    for (const forbidden of ["record_inventory_movement", "insert into",
                             "update public.", "delete from", "alter table"]) {
      expect(sql.toLowerCase(), forbidden).not.toContain(forbidden);
    }
    expect((sql.match(/create or replace function/g) ?? [])).toHaveLength(1);
    expect(sql).toContain("stable");
  });

  it("the reader maps it, defaulting to nought", () => {
    const QUERIES = readFileSync(join(process.cwd(), "src/lib/orderbook/queries.ts"), "utf8");
    expect(QUERIES).toContain("settledCount: Number(r.settled_count ?? 0)");
  });
});
