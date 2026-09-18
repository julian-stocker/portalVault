import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

import { de } from "@/lib/i18n/de";
import {
  allMigrations,
  code,
  latestFunction,
  migrationFiles,
  migrationSource,
} from "@/test-support/migrations";

/**
 * Test orders live somewhere else, and nothing is ever deleted (ADR-0084).
 *
 * Two invariants, and the first one is the one that would be expensive to get
 * wrong: SkyIsles does not delete orders. Live ones are commercial history
 * with a retention obligation; sandbox ones are the record of how the checkout
 * and the payment webhook actually behaved. "Archiving" here is a timestamp
 * and a filter, and most of what follows exists to keep it that way.
 */

const SQL = migrationSource("0046_sandbox_order_archive.sql");
const ACTION = readFileSync("src/lib/admin/test-order-actions.ts", "utf8");
const QUERIES = readFileSync("src/lib/admin/order-queries.ts", "utf8");
const TEST_PAGE = readFileSync("src/app/(business)/business/orders/test/page.tsx", "utf8");
const LIVE_PAGE = readFileSync("src/app/(business)/business/orders/page.tsx", "utf8");

/** Every function the shop's normal order views are built from. */
const LIVE_VIEWS = [
  "admin_orders",
  "seller_orders_active",
  "seller_orders_month",
  "seller_order_calendar",
  "seller_open_order_counts",
] as const;

describe("nothing deletes an order", () => {
  it("no migration deletes from orders", () => {
    expect(code(allMigrations)).not.toMatch(/delete\s+from\s+public\.orders\b/i);
  });

  it("no migration defines a delete-order function", () => {
    expect(code(allMigrations)).not.toMatch(/function\s+public\.\w*delete\w*order/i);
    expect(code(allMigrations)).not.toMatch(/function\s+public\.\w*purge\w*/i);
  });

  it("no runtime code deletes an order", () => {
    /*
     * The whole application, not a sample. `.delete()` exists on collection
     * items, cart items and customer contacts — all of them things a person
     * owns and may remove. None of them is an order.
     */
    const files = sources("src");
    for (const [path, body] of files) {
      const deletions = [...body.matchAll(/from\(["'`](\w+)["'`]\)[\s\S]{0,80}?\.delete\(\)/g)];
      for (const hit of deletions) {
        expect(hit[1], `${path} deletes from ${hit[1]}`).not.toMatch(/^orders?$|^order_/);
      }
    }
  });

  it("and the schema refuses it anyway: every reference to orders is RESTRICT", () => {
    // An order with a line, an event or a payment attempt cannot be deleted
    // even by a hand-written statement.
    const core = migrationSource("0010_commerce_core.sql");
    const refs = [...core.matchAll(/references public\.orders \(id\)([\s\S]{0,120}?)(?:,\n|\n\s*\))/g)];
    expect(refs.length).toBeGreaterThan(3);
    for (const ref of refs) expect(ref[1]).toContain("on delete restrict");
  });

  it("the one deliberate exception is an account leaving its order behind", () => {
    // ON DELETE SET NULL on user_id, so deleting an account releases the order
    // rather than destroying it (0010).
    const core = migrationSource("0010_commerce_core.sql");
    expect(core).toContain("constraint orders_user_fk foreign key (user_id)");
    expect(core.slice(core.indexOf("constraint orders_user_fk"))).toMatch(
      /on delete set null/,
    );
  });

  it("client roles hold select on orders and nothing else", () => {
    const core = migrationSource("0010_commerce_core.sql");
    expect(core).toContain("grant select on public.orders, public.order_lines, public.order_addresses");
    expect(code(allMigrations)).not.toMatch(/grant[^;]*delete[^;]*on public\.orders/i);
  });

  it("and archiving is not a soft delete — the word never appears in the copy", () => {
    const copy = de.business.testOrders;
    expect(copy.archive).toBe("Archivieren");
    expect(copy.restore).toBe("Wiederherstellen");
    for (const word of ["löschen", "Löschen", "Papierkorb", "entfernen"]) {
      expect(copy.archiveHint, word).not.toContain(word);
    }
    // And it says out loud that nothing is deleted.
    expect(copy.archiveHint).toContain("Nichts wird");
    expect(copy.archiveHint).toContain("gelöscht");
  });
});

describe("the shop's own order views are live-only", () => {
  for (const name of LIVE_VIEWS) {
    it(`${name}() reads live orders and no others`, () => {
      expect(latestFunction(name).body).toContain("where o.commerce_mode = 'live'");
    });
  }

  it("which means 0046 is the definition the database runs, not 0045", () => {
    // The point of resolving the LATEST definition: 0045 is applied and its
    // versions of these had no mode clause at all.
    for (const name of LIVE_VIEWS) {
      expect(latestFunction(name).file, name).toBe("0046_sandbox_order_archive.sql");
    }
  });

  it("so month counts cannot be inflated by a morning of checkout testing", () => {
    const calendar = latestFunction("seller_order_calendar").body;
    expect(calendar).toContain("where o.commerce_mode = 'live'");
    expect(calendar).not.toContain("'sandbox'");
  });

  it("and the work badge counts live work only", () => {
    const counter = latestFunction("seller_open_order_counts").body;
    expect(counter).toContain("where o.commerce_mode = 'live'");
    expect(counter).not.toContain("'sandbox'");
  });

  it("nothing else about those five functions changed", () => {
    // Same arguments and same return types — which is what makes
    // `create or replace` safe here (0040 learned the other way).
    expect(latestFunction("admin_orders").body).toContain("p_open_only boolean default false");
    expect(latestFunction("seller_orders_active").body).toContain("or r.attention <= 2");
    expect(latestFunction("seller_orders_month").body).toContain("where not p_archived_only");
    expect(latestFunction("seller_order_calendar").body).toContain("archived_count integer");
    for (const name of LIVE_VIEWS) {
      expect(latestFunction(name).body, name).toContain(
        "if not public.can_operate_active_seller() then",
      );
    }
  });
});

describe("test orders are sandbox-only", () => {
  const reader = latestFunction("seller_test_orders").body;

  it("the reader selects sandbox and nothing else", () => {
    expect(reader).toContain("where o.commerce_mode = 'sandbox'");
    expect(reader).not.toContain("'live'");
  });

  it("archived ones are hidden by default", () => {
    expect(reader).toContain("(p_include_archived or o.sandbox_archived_at is null)");
    expect(reader).toContain("p_include_archived boolean default false");
    expect(QUERIES).toContain("fetchTestOrders(includeArchived = false)");
  });

  it("and can be shown on request", () => {
    expect(TEST_PAGE).toContain('const showArchived = archived === "1";');
    expect(TEST_PAGE).toContain("fetchTestOrders(showArchived)");
    expect(de.business.testOrders.showArchived).toBe("Archivierte anzeigen");
  });

  it("archived ones stay reachable, not merely listed", () => {
    // Each row still links to the order's own page, archived or not.
    expect(TEST_PAGE).toContain("href={`/business/orders/${order.order_number}`}");
  });

  it("the two lists are separate routes, not one list with a filter", () => {
    expect(TEST_PAGE).toContain("OrderTabs current=\"test\"");
    expect(LIVE_PAGE).toContain('OrderTabs current="live"');
    const tabs = readFileSync("src/components/admin/order-tabs.tsx", "utf8");
    expect(tabs).toContain('href="/business/orders"');
    expect(tabs).toContain('href="/business/orders/test"');
  });

  it("and Bestellungen is the default", () => {
    // `/business/orders` is the live list; the test list is the one that needs
    // a path segment.
    expect(de.business.testOrders.liveTab).toBe("Bestellungen");
    expect(de.business.testOrders.tab).toBe("Testbestellungen");
  });
});

describe("a live order can never be archived", () => {
  const archive = latestFunction("seller_archive_test_orders").body;

  it("the database refuses the state structurally", () => {
    /*
     * The most important line in 0046. Not a function that checks — a CHECK
     * constraint, so a buggy function, a future migration that forgets, or a
     * hand-written UPDATE all fail the same way.
     */
    expect(SQL).toContain(
      "check (sandbox_archived_at is null or commerce_mode = 'sandbox')",
    );
  });

  it("and the function refuses the request before writing anything", () => {
    expect(archive).toContain("if v_sandbox <> v_requested then");
    expect(archive).toContain("only test orders can be archived");
  });

  it("the UPDATE itself names sandbox, not only the count that precedes it", () => {
    /*
     * Asserting that the string appears SOMEWHERE in the function is not
     * enough: it also appears in the `select count(*)` above. A mutation that
     * dropped the clause from the write alone went undetected until this
     * looked at the statement that actually writes.
     */
    const statement = archive.slice(archive.indexOf("update public.orders"));
    expect(statement).toContain("and o.commerce_mode = 'sandbox'");
  });

  it("a mixed list archives NOTHING, not just the sandbox part", () => {
    /*
     * The count is compared BEFORE anything is written. Half-applying a batch
     * because most of it was acceptable is how a live order ends up hidden
     * while the operator reads a success message.
     *
     * The FIRST write in the body, not the one that happens to match an alias:
     * a mutation that inserted an earlier `update public.orders set ...`
     * slipped past an assertion looking for `update public.orders o`.
     */
    const guardAt = archive.indexOf("if v_sandbox <> v_requested then");
    const firstWrite = archive.search(/\b(update|insert|delete)\s/);
    expect(guardAt).toBeGreaterThan(-1);
    expect(firstWrite).toBeGreaterThan(guardAt);
  });

  it("an order number that does not exist fails the same way", () => {
    // v_sandbox counts matching sandbox rows; a missing number makes the
    // counts differ, so the request is refused rather than silently partial.
    expect(archive).toContain("count(distinct n) into v_requested");
    expect(archive).toContain("every order in the request must exist");
  });

  it("there is no generic order-archive function to reach for instead", () => {
    // `commerce_mode` is never a parameter. If it were, "archive this order"
    // would become a thing somebody could call with 'live'.
    const generic = [...code(allMigrations).matchAll(
      /create or replace function public\.(\w*archive\w*)\s*\(([^)]*)\)/gi,
    )];
    expect(generic.length).toBeGreaterThan(0);
    for (const fn of generic) {
      expect(fn[2], fn[1]).not.toMatch(/commerce_mode|p_mode/);
      expect(fn[1]).toMatch(/test_orders/);
    }
  });

  it("restoring is the exact reverse, and archiving is never one-way", () => {
    const restore = latestFunction("seller_restore_test_orders").body;
    expect(restore).toContain("set sandbox_archived_at = null");
    expect(restore).toContain("and o.commerce_mode = 'sandbox'");
    expect(de.business.testOrders.restore).toBe("Wiederherstellen");
    expect(TEST_PAGE).toContain('action={isArchived ? "restore" : "archive"}');
  });
});

describe("archiving has no commerce effect whatsoever", () => {
  const archive = latestFunction("seller_archive_test_orders").body;
  const restore = latestFunction("seller_restore_test_orders").body;

  it("writes two columns and no others", () => {
    for (const body of [archive, restore]) {
      const update = body.slice(body.indexOf("update public.orders o"));
      const assigned = [...update.matchAll(/set (\w+) =|^\s{9}(\w+) =/gm)]
        .map((m) => m[1] ?? m[2])
        .filter(Boolean);
      expect(new Set(assigned)).toEqual(new Set(["sandbox_archived_at", "sandbox_archived_by"]));
    }
  });

  it("touches no commercial column", () => {
    for (const body of [archive, restore]) {
      for (const column of [
        "payment_status",
        "fulfillment_status",
        "needs_resolution",
        "total_amount",
        "items_subtotal",
        "shipping_amount",
        "tracking_number",
        "paid_at",
        "shipped_at",
      ]) {
        expect(body, column).not.toContain(`${column} =`);
      }
    }
  });

  it("touches no other table", () => {
    for (const body of [archive, restore]) {
      for (const table of [
        "order_lines",
        "order_events",
        "order_reservations",
        "payment_attempts",
        "payment_events",
        "shop_inventory",
        "inventory_movements",
        "order_mail",
      ]) {
        expect(body, table).not.toContain(table);
      }
    }
  });

  it("books no stock and sends no mail", () => {
    for (const body of [archive, restore]) {
      expect(body).not.toContain("convert_order_reservations");
      expect(body).not.toContain("release_expired_reservations");
      expect(body).not.toContain("book_");
      expect(body).not.toContain("mail");
    }
    expect(ACTION).not.toContain("sendOrderMail");
  });

  it("and is not the sandbox stock-revert path, which stays separate", () => {
    // 0039's revert is a real inventory operation with its own action and its
    // own journal rows. Archiving is not related to it.
    expect(SQL).not.toContain("stock_reverted");
    expect(ACTION).not.toContain("revert");
  });

  it("all of the order's history is still there afterwards", () => {
    // Nothing is deleted or detached: the archive is a column on `orders`, so
    // every related row keeps pointing at the same order.
    expect(SQL).toContain("add column if not exists sandbox_archived_at timestamptz");
    expect(code(SQL)).not.toMatch(/delete\s+from/i);
    expect(code(SQL)).not.toMatch(/drop\s+table/i);
    expect(code(SQL)).not.toMatch(/truncate/i);
  });
});

describe("who may archive", () => {
  it("every function asks the seller predicate", () => {
    for (const name of [
      "seller_test_orders",
      "seller_archive_test_orders",
      "seller_restore_test_orders",
    ]) {
      expect(latestFunction(name).body, name).toContain(
        "if not public.can_operate_active_seller() then",
      );
      expect(latestFunction(name).body, name).toContain("insufficient_privilege");
    }
  });

  it("a USER is refused, in the database and before it", () => {
    expect(ACTION).toContain("if (!(await canOperateSeller())) return { ok: false");
    const layout = readFileSync("src/app/(business)/layout.tsx", "utf8");
    expect(layout).toContain("if (!sellerOperator) notFound();");
  });

  it("an ADMIN gains nothing here: running SkyIsles is not running the shop", () => {
    expect(SQL).not.toContain("is_platform_admin");
    expect(SQL).not.toContain("is_shop_admin");
    expect(ACTION).not.toContain("isAdmin");
    // And no admin surface reaches these functions.
    const adminHome = readFileSync("src/app/(admin)/admin/page.tsx", "utf8");
    expect(adminHome).not.toContain("test-order");
    expect(adminHome).not.toContain("/business/orders");
  });

  it("an ADMIN could not archive a LIVE order even with the shop capability", () => {
    // Because no capability can reach the state at all: the CHECK constraint
    // is not a permission.
    expect(SQL).toContain("check (sandbox_archived_at is null or commerce_mode = 'sandbox')");
  });

  it("nothing is granted to anon", () => {
    const grants = [...SQL.matchAll(/grant execute on function public\.\w+\s*\([^)]*\)\s*to ([^;]+);/g)];
    expect(grants.length).toBe(3);
    for (const grant of grants) expect(grant[1]).not.toContain("anon");
  });

  it("and it is not client-side filtering", () => {
    // The default list never receives archived rows at all; hiding them in the
    // browser would mean shipping them there first.
    expect(TEST_PAGE).not.toContain("filter((o) => o.sandbox_archived_at === null).map((o) => o)");
    expect(QUERIES).toContain('rpc("seller_test_orders"');
  });
});

describe("a test order counts toward no money, ever", () => {
  it("the year-to-date figure is live-only", () => {
    expect(latestFunction("seller_year_to_date").body).toContain("o.commerce_mode = 'live'");
  });

  it("the monthly report is live-only", () => {
    expect(latestFunction("seller_finalize_monthly_report").body).toContain(
      "o.commerce_mode = 'live'",
    );
    expect(latestFunction("seller_report_years").body).toContain("o.commerce_mode = 'live'");
  });

  it("which is why archiving cannot move a number", () => {
    /*
     * Both read `commerce_mode`, neither reads `sandbox_archived_at`. So a
     * test order is outside every financial figure whether it is active,
     * archived or restored — there is no state it can be in that changes this.
     */
    for (const name of [
      "seller_year_to_date",
      "seller_finalize_monthly_report",
      "seller_report_years",
      "seller_monthly_reports",
    ]) {
      expect(latestFunction(name).body, name).not.toContain("sandbox_archived_at");
    }
  });

  it("and 0046 did not touch either of them", () => {
    expect(SQL).not.toContain("seller_year_to_date");
    expect(SQL).not.toContain("seller_finalize_monthly_report");
  });
});

describe("the archive state model", () => {
  it("is its own column, not a reused commercial one", () => {
    expect(SQL).toContain("sandbox_archived_at timestamptz");
    // None of these is repurposed to mean "put away".
    const columns = SQL.slice(SQL.indexOf("alter table public.orders"), SQL.indexOf("-- ====", SQL.indexOf("alter table public.orders")));
    for (const reused of ["payment_status", "fulfillment_status", "needs_resolution"]) {
      expect(columns, reused).not.toContain(reused);
    }
  });

  it("and commerce_mode is not abused to hide an order", () => {
    // It is frozen by orders_protect_immutable() precisely because it decides
    // which world an order belongs to.
    // 0021 added the column and the guard in the same migration, and later
    // redefinitions of the trigger keep it — so read the effective one.
    const guard = latestFunction("orders_protect_immutable").body;
    expect(guard).toMatch(/new\.commerce_mode\s+is distinct from old\.commerce_mode/);
    expect(latestFunction("seller_archive_test_orders").body).not.toContain("set commerce_mode");
  });

  it("follows the naming this table already uses", () => {
    // paid_at, shipped_at, completed_at, cancelled_at — a nullable timestamp
    // IS the state, and no boolean says the same thing twice.
    const core = migrationSource("0010_commerce_core.sql");
    for (const existing of ["paid_at", "shipped_at", "completed_at", "cancelled_at"]) {
      expect(core, existing).toContain(existing);
    }
    // No boolean column beside the timestamp saying the same thing twice.
    const columns = SQL.slice(
      SQL.indexOf("alter table public.orders\n  add column"),
      SQL.indexOf("alter table public.orders\n  drop constraint"),
    );
    expect(columns).toContain("sandbox_archived_at timestamptz");
    expect(columns).not.toContain("boolean");
    expect(columns).not.toContain("is_archived");
  });

  it("records who, because this action leaves no other trace", () => {
    expect(SQL).toContain("sandbox_archived_by uuid");
    expect(SQL).toContain("on delete set null");
    expect(latestFunction("seller_archive_test_orders").body).toContain("auth.uid()");
  });

  it("and restoring clears both", () => {
    const restore = latestFunction("seller_restore_test_orders").body;
    expect(restore).toContain("sandbox_archived_at = null");
    expect(restore).toContain("sandbox_archived_by = null");
  });
});

describe("bulk archiving is safe because it is the same function", () => {
  it("there is one function, and it takes a list", () => {
    // A single order is a list of one. So there is no one-order function for
    // a bulk feature to loop over with the guard done once outside the loop.
    expect(latestFunction("seller_archive_test_orders").body).toContain("p_order_numbers text[]");
    expect(latestFunction("seller_restore_test_orders").body).toContain("p_order_numbers text[]");
    expect(ACTION).toContain("orderNumbers: readonly string[]");
  });

  it("the bulk button offers only what it would actually change", () => {
    expect(TEST_PAGE).toContain("orders.filter((o) => o.sandbox_archived_at === null)");
    expect(de.business.testOrders.archiveAll).toBe("Alle sichtbaren archivieren");
  });

  it("and a list has a ceiling", () => {
    expect(latestFunction("seller_archive_test_orders").body).toContain(
      "cardinality(p_order_numbers) > 500",
    );
  });
});

/** Every TypeScript source under a directory, recursively. */
function sources(dir: string): [string, string][] {
  const out: [string, string][] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sources(path));
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.includes(".test."))
      out.push([path, readFileSync(path, "utf8")]);
  }
  return out;
}

/* A guard on the guards above: if the helper ever stopped finding migrations,
   every `not.toContain` in this file would pass vacuously. */
describe("the migration history is actually being read", () => {
  it("finds every migration and the newest definitions", () => {
    expect(migrationFiles.length).toBeGreaterThan(40);
    expect(migrationFiles).toContain("0046_sandbox_order_archive.sql");
    expect(allMigrations.length).toBeGreaterThan(100_000);
    expect(() => latestFunction("no_such_function_exists")).toThrow();
  });
});
