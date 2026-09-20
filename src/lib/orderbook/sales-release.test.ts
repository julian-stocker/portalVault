/**
 * 0071–0073 — twenty-two workbook sales get their real state back (V4.8).
 *
 * WHAT THESE TESTS GUARD
 *
 * The Verkauf side was frozen with `source = 'excel_order_2026'`, the same
 * blunt instrument the Einkauf side had. Twenty-two orders from 13.08.2026
 * on are not history: 21 shipped and still on the shelf, one cancelled.
 *
 * Three promises, and each is easy to break by accident:
 *
 *   1. Only those 22 are released. `stock_released_at` defaults to NULL, so
 *      the other 271 stay as frozen as they are today.
 *   2. `Ausgebucht` still means a `sale_external` movement and nothing else.
 *   3. THE LOCK. A catalog figure can never be closed without being booked —
 *      except the one kind the workbook itself marks as never having stood
 *      on the shelf.
 *
 * The migrations run by hand in the SQL editor; there is no DDL path from
 * here, so what is held still is their text. The runtime proof is
 * `npm run verify:settled:staging`'s sibling, to be written when these are
 * applied.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { de } from "@/lib/i18n/de";
import {
  notFromStock, saleItemActions, saleItemClosed, saleStockStatus,
} from "./sales-view";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
/** A comment that names a rule is not the rule. */
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");

const RELEASE = read("supabase/migrations/0071_sales_release_shipped_cancelled.sql");
const LEDGER = read("supabase/migrations/0072_sales_open_and_endings.sql");
const RULES = read("supabase/migrations/0073_sales_settle_and_cancel_rules.sql");
const releaseSql = code(RELEASE);
const ledgerSql = code(LEDGER);
const rulesSql = code(RULES);

/** The two functions 0073 defines, each on its own. */
const fn = (name: string) => {
  const from = rulesSql.indexOf(`create or replace function public.${name}`);
  const end = rulesSql.indexOf("$$;", from);
  return rulesSql.slice(from, end);
};
const book = fn("seller_book_sale_item");
const settle = fn("seller_settle_sale_item");

describe("0071 — what is released, and what stays frozen", () => {
  it("names 21 shipped orders and exactly one cancelled", () => {
    const fingerprints = releaseSql.match(/'[0-9a-f]{64}'/g) ?? [];
    expect(new Set(fingerprints).size).toBe(22);
    expect(releaseSql).toMatch(/v_expected_shipped\s+constant\s+integer\s*:=\s*21/);
    expect(releaseSql).toMatch(/v_expected_cancelled\s+constant\s+integer\s*:=\s*1/);
    expect(releaseSql).toMatch(/v_expected_items\s+constant\s+integer\s*:=\s*197/);
  });

  it("identifies them by fingerprint, never by id", () => {
    // 290…311 on Staging, 274…295 in Production. An id would correct the
    // wrong rows in one of them.
    expect(releaseSql).toContain("t.fingerprint = s.import_fingerprint");
    expect(releaseSql).not.toMatch(/s\.id\s*(in|=)\s*\(?\s*\d/);
  });

  it("releases by setting a column that defaults to NULL", () => {
    /*
     * Fail-closed by construction: every other workbook sale is frozen
     * because nobody named it, not because a filter excluded it.
     */
    expect(releaseSql).toContain("add column if not exists");
    expect(releaseSql).toContain("stock_released_at timestamptz");
    expect(releaseSql).toMatch(/set shipped_at = coalesce\(s\.shipped_at, s\.sold_at::timestamptz\)/);
    expect(releaseSql).toContain("stock_released_at = now()");
  });

  it("never releases the cancelled order, at the table level", () => {
    expect(releaseSql).toContain("sales_cancelled_is_not_released");
    expect(releaseSql).toMatch(/check \(cancelled_at is null or stock_released_at is null\)/);
  });

  it("keeps settled and booked mutually exclusive, at the table level", () => {
    expect(releaseSql).toContain("sale_items_settled_has_no_movement");
    expect(releaseSql).toMatch(/check \(settled_at is null or movement_id is null\)/);
  });

  it("writes no sky_id — all 193 are already stored", () => {
    /*
     * The workbook never linked these 22 to the catalog (0 of 197 rows carry
     * a column-P formula). The IMPORTER resolved 193 of them from the
     * owner's own references elsewhere, and they have been in the database
     * since. There is nothing to write and nothing to guess.
     */
    expect(releaseSql).not.toMatch(/set[^;]*sky_id/);
    expect(releaseSql).not.toMatch(/SKY-\d{4}/);
    // It does CHECK the number, so a changed catalog picture stops the run.
    expect(releaseSql).toMatch(/i\.sky_id is not null\) <> 193/);
  });

  it("refuses to run unless the state is exactly what was measured", () => {
    expect(releaseSql).toMatch(/refusing to guess/);
    expect(releaseSql).toMatch(/already owns a movement or an ending/);
    // Exactly one not-from-stock line among the released orders: Terrafin.
    expect(releaseSql).toMatch(/i\.legacy_stock_flag = '-'\) <> 1/);
  });

  it("creates no movement and changes no stock", () => {
    for (const forbidden of ["record_inventory_movement", "insert into public.inventory_movements",
                             "update public.shop_inventory"]) {
      expect(releaseSql.toLowerCase(), forbidden).not.toContain(forbidden);
    }
    expect(releaseSql).toMatch(/select count\(\*\) into v_moves from public\.inventory_movements/);
    expect(releaseSql).toMatch(/inventory movements changed/);
    expect(releaseSql).toMatch(/stock changed/);
  });

  it("is safe to run twice", () => {
    expect(releaseSql).toMatch(/bereits angewendet/);
    expect(releaseSql).toContain("return;");
  });
});

describe("0072 — the ledger reads the release", () => {
  const openExpr = (() => {
    const at = ledgerSql.indexOf("as is_open");
    return ledgerSql.slice(ledgerSql.lastIndexOf("(b.cancelled_at", at), at);
  })();

  it("a sale is open only when it is not cancelled and not frozen", () => {
    expect(openExpr).toContain("b.cancelled_at is null");
    expect(openExpr).toContain("b.order_id is null");
    expect(openExpr).toContain("b.source <> 'excel_order_2026' or b.stock_released_at is not null");
  });

  it("a position counts as outstanding until it has a movement or an ending", () => {
    expect(openExpr).toContain("i.movement_id is null");
    expect(openExpr).toContain("i.settled_at is null");
    // And no longer asks for a figure — the reasoning 0068 gave the Einkauf.
    expect(openExpr).not.toContain("sky_id");
  });

  it("counts the three endings apart", () => {
    expect(ledgerSql).toContain("as outbooked_count");
    expect(ledgerSql).toContain("as settled_count");
    expect(ledgerSql).toContain("'open_count', m.item_count - m.outbooked_count - m.settled_count");
  });

  it("never folds settled into outbooked", () => {
    expect(ledgerSql).toMatch(/where i\.sale_id = b\.id and i\.movement_id is not null\)::integer as outbooked_count/);
    expect(ledgerSql).not.toMatch(/outbooked_count\s*\+\s*\S*settled/);
    expect(ledgerSql).not.toMatch(/settled\S*\s*\+\s*\S*outbooked/);
  });

  it("is read-only", () => {
    for (const forbidden of ["insert into", "update public.", "delete from", "alter table"]) {
      expect(ledgerSql.toLowerCase(), forbidden).not.toContain(forbidden);
    }
    expect((ledgerSql.match(/create or replace function/g) ?? [])).toHaveLength(1);
  });
});

describe("0073 — THE LOCK", () => {
  it("refuses to close any catalog figure that is not marked not-from-stock", () => {
    /*
     * The door that must not exist. `settled` writes no movement; a figure
     * reaching it would be off the open list, never booked, and the stock
     * short by one with nothing to show for it.
     */
    expect(settle).toContain(
      "if v_item.sky_id is not null and v_item.legacy_stock_flag is distinct from '-' then");
    expect(settle).toMatch(/a catalog figure leaves stock by being booked, never by being closed/);
  });

  it("reads what kind of item it is from the row, never from the caller", () => {
    expect(settle).toContain("select * into v_item from public.sale_items where id = p_item_id for update");
    expect(settle).not.toMatch(/p_sky|p_is_figure|p_not_from_stock|p_force/);
    // The only parameters are the item and the direction.
    expect(rulesSql).toMatch(/seller_settle_sale_item\(\s*p_item_id bigint,\s*p_settled boolean default true\s*\)/);
  });

  it("uses a marker no RPC can write", () => {
    /*
     * `legacy_stock_flag` is provenance, set once by the import. If anything
     * could set it, the lock would be a door with the key beside it.
     */
    const migrations = ["0059_orderbook_sales.sql", "0062_orderbook_sale_maintenance.sql",
                        "0065_sale_create_with_details.sql", "0071_sales_release_shipped_cancelled.sql",
                        "0073_sales_settle_and_cancel_rules.sql"];
    for (const file of migrations) {
      const sql = code(read(`supabase/migrations/${file}`));
      /*
       * Every real UPDATE statement, and none of them may name the marker.
       * Scanning for the word `set` would also hit `settled_at` in a
       * sentence — a comment that mentions a rule is not the rule.
       */
      for (const start of [...sql.matchAll(/\bupdate\s+public\.\w+/g)].map((m) => m.index!)) {
        const statement = sql.slice(start, sql.indexOf(";", start));
        expect(statement, `${file}: ${statement.slice(0, 40)}`).not.toContain("legacy_stock_flag");
      }
    }
  });

  it("bars BOOKING the same marker, so the line has exactly one ending", () => {
    expect(book).toContain("if v_item.legacy_stock_flag = '-' then");
    expect(book).toMatch(/not taken from stock; close it instead/);
  });

  it("still refuses an unreleased workbook sale, a cancelled one and an order", () => {
    expect(book).toContain("v_sale.source = 'excel_order_2026' and v_sale.stock_released_at is null");
    expect(book).toContain("if v_sale.cancelled_at is not null then");
    expect(book).toContain("if v_sale.order_id is not null then");
    expect(settle).toContain("v_sale.source = 'excel_order_2026' and v_sale.stock_released_at is null");
    expect(settle).toContain("if v_sale.order_id is not null then");
  });

  it("refuses to close something that already left the shelf, and vice versa", () => {
    expect(settle).toContain("if v_item.movement_id is not null then");
    expect(book).toContain("if v_item.settled_at is not null then");
  });

  it("creates exactly one kind of movement, through the one canonical path", () => {
    expect(book).toContain("public.record_inventory_movement(");
    expect(book).toContain("'sale_external'");
    expect(book).toMatch(/-1, 'sale_external'/);
    expect(book).not.toMatch(/update public\.shop_inventory/);
    // And settling makes none at all.
    expect(settle).not.toContain("record_inventory_movement");
    expect(settle).not.toContain("shop_inventory");
  });

  it("writes one timestamp when it closes, and clears it to reopen", () => {
    expect(settle).toContain("set settled_at = now()");
    expect(settle).toContain("set settled_at = null");
  });
});

describe("the screen offers only what the server would accept", () => {
  const item = (over: Record<string, unknown> = {}) => ({
    movement_id: null, returned_at: null, return_movement_id: null,
    sky_id: "SKY-0181", settled_at: null, legacy_stock_flag: null, ...over,
  } as never);

  it("mirrors the lock exactly", () => {
    const ctx = { frozen: false, cancelled: false, shipped: true };
    // Shelf-bound figure: book, never close.
    expect(saleItemActions(item(), ctx)).toMatchObject({ primary: "book" });
    // No catalog row: close, never book.
    expect(saleItemActions(item({ sky_id: null }), ctx)).toMatchObject({ primary: "settle" });
    // Terrafin's case: has a figure, marked not-from-stock.
    expect(saleItemActions(item({ legacy_stock_flag: "-" }), ctx))
      .toMatchObject({ primary: "settle" });
  });

  it("names the marker in one place", () => {
    expect(notFromStock({ legacy_stock_flag: "-" })).toBe(true);
    expect(notFromStock({ legacy_stock_flag: "x" })).toBe(false);
    expect(notFromStock({})).toBe(false);
  });

  it("gives the tick to real movements only", () => {
    expect(de.business.sales.stock.outbooked).toContain("✓");
    for (const label of [de.business.sales.stock.closed, de.business.sales.stock.cancelled,
                         de.business.sales.stock.frozen, de.business.sales.stock.open,
                         de.business.sales.stock.partial, de.business.sales.settle]) {
      expect(label, label).not.toContain("✓");
    }
    /*
     * Mixed endings are `Abgeschlossen` and carry no tick: one piece left
     * the shelf, one never had one to leave, and neither sentence covers
     * both.
     */
    expect(saleStockStatus({
      source: "manual", cancelledAt: null, stockReleasedAt: null, orderId: null,
      itemCount: 2, outbookedCount: 1, settledCount: 1,
    })).toBe("closed");
    /* And a fully returned sale is `Retour`, never `Ausgebucht` — sale 15. */
    expect(saleStockStatus({
      source: "manual", cancelledAt: null, stockReleasedAt: null, orderId: null,
      itemCount: 1, outbookedCount: 0, restockedCount: 1, settledCount: 0,
    })).toBe("returned");
  });
});

/* ===================================================================== */
describe("0074 — the two facts that were missing", () => {
  const SQL = code(read("supabase/migrations/0074_sale_items_not_shipped_and_return_announced.sql"));
  const fn2 = (name: string) => {
    const from = SQL.indexOf(`create or replace function public.${name}`);
    return SQL.slice(from, SQL.indexOf("$$;", from));
  };
  const notShipped = fn2("seller_set_sale_item_not_shipped");
  const announce = fn2("seller_announce_sale_item_return");

  it("adds exactly two nullable columns", () => {
    /*
     * Nullable is the whole point: NULL is "this has not happened", which
     * is true of every existing row and of every row created from now on.
     * `is not null` appears in the constraints; a NOT NULL column type
     * would not.
     */
    expect(SQL).toContain("not_shipped_at       timestamptz");
    expect(SQL).toContain("return_announced_at  timestamptz");
    expect(SQL).not.toMatch(/timestamptz\s+not null/);
    expect(SQL).not.toContain("default now()");
  });

  it("`Nicht verschickt` is refused once the piece has left the shelf", () => {
    /*
     * The one thing that would make the claim false. Everything else is
     * allowed — including for an ordinary catalog figure, because the piece
     * never left and NOT booking it out is the correct bookkeeping.
     */
    expect(notShipped).toContain("if v_item.movement_id is not null then");
    expect(notShipped).toMatch(/left the shelf; reverse the booking first/);
    expect(SQL).toContain("sale_items_not_shipped_has_no_movement");
    expect(SQL).toMatch(/check \(not_shipped_at is null or movement_id is null\)/);
  });

  it("and it does NOT loosen the settle lock", () => {
    // Two separate columns precisely so `settled_at` keeps its hard rule.
    expect(notShipped).not.toContain("settled_at = now()");
    expect(notShipped).not.toContain("legacy_stock_flag");
    expect(SQL).toContain("sale_items_one_ending_without_movement");
    expect(SQL).toMatch(/check \(settled_at is null or not_shipped_at is null\)/);
  });

  it("`Retoure unterwegs` needs something to return", () => {
    expect(announce).toContain("if v_item.movement_id is null then");
    expect(announce).toMatch(/nothing was booked out of stock/);
    expect(SQL).toContain("sale_items_return_needs_a_movement");
    expect(SQL).toMatch(/check \(return_announced_at is null or movement_id is not null\)/);
  });

  it("leaves `returned_at` meaning what 0059 said it means", () => {
    // "marks the physical fact" — the goods are back. Untouched here.
    expect(SQL).not.toContain("create or replace function public.seller_return_sale_item");
    expect(announce).toContain("if v_item.returned_at is not null then");
  });

  it("creates no movement and changes no stock", () => {
    for (const forbidden of ["record_inventory_movement", "shop_inventory", "insert into"]) {
      expect(SQL.toLowerCase(), forbidden).not.toContain(forbidden);
    }
    const updates = [...SQL.matchAll(/update\s+(\S+)/g)].map((m) => m[1]);
    expect(new Set(updates)).toEqual(new Set(["public.sale_items"]));
  });
});

describe("0075 — a returned position is not an outbooked one", () => {
  const SQL = code(read("supabase/migrations/0075_sales_returns_in_the_counts.sql"));

  it("outbooked means left AND still gone", () => {
    expect(SQL).toMatch(
      /i\.movement_id is not null and i\.return_movement_id is null\s*\n?\s*and i\.return_announced_at is null and i\.returned_at is null\)::integer\s*\n?\s*as outbooked_count/);
  });

  it("counts the four endings apart and adds none of them together", () => {
    for (const c of ["outbooked_count", "restocked_count", "settled_count", "not_shipped_count"]) {
      expect(SQL, c).toContain(`as ${c}`);
    }
    expect(SQL).toContain("'open_count', m.item_count - m.closed_count");
    expect(SQL).not.toMatch(/outbooked_count\s*\+/);
  });

  it("asks one predicate what `finished` means", () => {
    /*
     * `is_open` and `closed_count` used to be two expressions answering the
     * same question. One function now, so they cannot drift.
     */
    expect(SQL).toContain("create or replace function public.sale_item_is_closed");
    expect(SQL).toContain("not public.sale_item_is_closed(i)");
    expect(SQL).toContain("public.sale_item_is_closed(i))::integer as closed_count");
  });

  it("a return in progress is not finished", () => {
    const pred = SQL.slice(SQL.indexOf("create or replace function public.sale_item_is_closed"),
                           SQL.indexOf("$$;"));
    expect(pred).toContain("p_item.return_announced_at is null");
    expect(pred).toContain("p_item.returned_at is null");
    expect(pred).toContain("p_item.return_movement_id is not null");
  });

  it("is read-only", () => {
    for (const f of ["insert into", "update public.", "delete from", "alter table"]) {
      expect(SQL.toLowerCase(), f).not.toContain(f);
    }
  });

  it("the screen agrees with the database about `finished`", () => {
    // `saleItemClosed` is the TypeScript half of the same predicate.
    const item = (o: Record<string, unknown>) => ({
      movement_id: null, returned_at: null, return_movement_id: null,
      settled_at: null, not_shipped_at: null, return_announced_at: null,
      sky_id: null, ...o,
    } as never);
    expect(saleItemClosed(item({ movement_id: 1 }))).toBe(true);
    expect(saleItemClosed(item({ movement_id: 1, returned_at: "t" }))).toBe(false);
    expect(saleItemClosed(item({ movement_id: 1, return_movement_id: 2 }))).toBe(true);
  });
});

describe("0076 — the two leftover smoke sales", () => {
  const SQL = code(read("supabase/migrations/0076_flag_leftover_smoke_sales.sql"));

  it("flags, never deletes", () => {
    expect(SQL).toContain("set is_test = true");
    expect(SQL.toLowerCase()).not.toContain("delete from");
    // The four movements those two sales own are the honest record of what
    // the shelf did. Append-only, and untouched.
    expect(SQL.toLowerCase()).not.toContain("inventory_movements\n     set");
    expect(SQL).toMatch(/inventory movements changed/);
  });

  it("identifies them by what they are, and refuses any other count", () => {
    expect(SQL).toContain("s.external_order_ref in ('SMOKE-1', 'UIFLOW-1')");
    expect(SQL).toContain("s.import_fingerprint is null");
    expect(SQL).toContain("s.is_test = false");
    expect(SQL).toMatch(/v_expected constant integer := 2/);
    expect(SQL).toMatch(/refusing to guess/);
  });

  it("requires both to be completed out-and-back runs", () => {
    expect(SQL).toMatch(/i\.movement_id is null or i\.return_movement_id is null/);
    expect(SQL).toMatch(/not a completed out-and-back run/);
  });

  it("does nothing in Production instead of failing there", () => {
    // Neither sale was transferred; a raise would make the set unapplyable.
    expect(SQL).toMatch(/if v_found = 0 then/);
    expect(SQL).toMatch(/nichts zu tun/);
  });
});

describe("no tool may create a sale that looks like real trade", () => {
  /*
   * Sale 15 and 19 exist because the scripts of the time did not set the
   * flag. This is the guard that keeps that from happening again.
   */
  const tools = ["verify-sale-workflow.mts", "verify-sale-locks.mts"];

  it("every sale-creating tool flags its sale as a test", () => {
    for (const file of tools) {
      const src = read(`tools/${file}`);
      if (!/seller_create_sale/.test(src)) continue;
      const flags = /p_is_test:\s*true/.test(src)
        || /seller_set_sale_test[\s\S]{0,120}p_is_test:\s*true/.test(src);
      expect(flags, `${file} must mark its sale as a test`).toBe(true);
    }
  });

  it("and the list of such tools is complete", () => {
    /*
     * A new tool that creates sales must be added here, or this fails —
     * which is the point. The check is worth nothing if the list can go
     * stale silently.
     */
    const creators = readdirSync(join(process.cwd(), "tools"))
      .filter((f) => f.endsWith(".mts"))
      .filter((f) => /seller_create_sale\b|seller_create_sale_with_details/
        .test(read(`tools/${f}`)));
    expect(new Set(creators)).toEqual(new Set(tools));
  });
});
