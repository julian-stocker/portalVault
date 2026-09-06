import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  CONDITIONS,
  MOVEMENT_REASONS,
  isCondition,
  isMovementReason,
} from "@/lib/admin/inventory";

/**
 * Stock management (ADR-0037, phase 1).
 *
 * The rules that must not drift: stock changes only through movements,
 * `reserved` has no write path, price and listing are one call and neither
 * touches the catalog's market price, and the operational list is scoped by
 * the catalog rather than by matching names.
 */
function source(path: string): string {
  return readFileSync(path, "utf8");
}

/** The file without its comments — what the code does, not what it says. */
function code(path: string): string {
  return source(path)
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("/*");
    })
    .join("\n");
}

const ACTIONS = "src/lib/admin/actions.ts";
const QUERIES = "src/lib/admin/inventory.ts";
const MODEL = "src/lib/admin/inventory-model.ts";
const CARD = "src/components/admin/inventory-card.tsx";
const DIALOG = "src/components/admin/stock-dialog.tsx";
const VIEW = "src/components/admin/inventory-view.tsx";
const FOUNDATION = "supabase/migrations/0003_shop_foundation.sql";
const READS = "supabase/migrations/0005_inventory_admin_read.sql";

describe("the vocabulary V1 knows", () => {
  it("has exactly two conditions", () => {
    expect([...CONDITIONS]).toEqual(["loose", "boxed"]);
    for (const value of ["new", "mint", "sealed", "used", ""]) {
      expect(isCondition(value), value).toBe(false);
    }
  });

  it("offers six reasons and never initial_import", () => {
    // That value belonged to the one legacy opening balance and is booked by
    // server tooling no browser can reach.
    expect(MOVEMENT_REASONS).not.toContain("initial_import");
    expect(isMovementReason("initial_import")).toBe(false);
    expect([...MOVEMENT_REASONS].sort()).toEqual(
      ["correction", "purchase", "return", "sale_external", "sale_skyisles", "writeoff"].sort(),
    );
  });

  it("only offers reasons the database accepts", () => {
    const sql = source(FOUNDATION);
    const block = sql.slice(sql.indexOf("inventory_movements_reason_known"));
    for (const reason of MOVEMENT_REASONS) {
      expect(block.slice(0, 600), reason).toContain(`'${reason}'`);
    }
  });
});

describe("stock changes only through movements", () => {
  it("has no action that assigns quantity", () => {
    const actions = source(ACTIONS);
    expect(actions).toContain('"record_inventory_movement"');
    expect(actions).not.toMatch(/quantity\s*:/);
    expect(actions).not.toContain("p_quantity");
  });

  it("never writes reserved", () => {
    // It belongs to a later checkout. Nothing in phase 1 may set it.
    for (const path of [ACTIONS, QUERIES, MODEL, CARD, DIALOG, VIEW]) {
      expect(source(path), path).not.toMatch(/p_reserved|reserved\s*:\s*\d|setReserved/);
    }
  });

  it("books through the foundation's admin wrapper, not the system one", () => {
    const actions = source(ACTIONS);
    expect(actions).not.toContain("system_record_inventory_movement");
  });

  it("sends a cost only with a purchase", () => {
    expect(source(DIALOG)).toContain('unitCost: reason === "purchase" ? cost : null');
  });

  it("states the currency where a cost is stated", () => {
    expect(source(ACTIONS)).toContain('"EUR"');
  });

  it("refuses a zero or fractional delta before asking the database", () => {
    expect(source(ACTIONS)).toContain("!Number.isInteger(input.delta) || input.delta === 0");
  });
});

describe("price and listing", () => {
  const actions = source(ACTIONS);

  it("go through the foundation's function, both at once", () => {
    expect(actions).toContain('"set_shop_listing"');
    expect(actions).toContain("p_sale_price");
    expect(actions).toContain("p_is_listed");
  });

  it("never touch the catalog's market price", () => {
    // Read from the code: the comments explain precisely this separation.
    for (const path of [ACTIONS, QUERIES]) {
      expect(code(path), path).not.toMatch(/market_price|admin_set_market/);
    }
    // The card reads `figure.marketPrice` to display it beside the shop
    // price — reading is the point, writing is what must not exist.
    expect(code(CARD)).not.toMatch(/marketPrice\s*[:=][^=]/);
  });

  it("refuse a listing without a price, in German before in SQL", () => {
    expect(actions).toContain("input.isListed && input.salePrice === null");
  });

  it("are independent of stock", () => {
    // No code that flips is_listed because quantity changed.
    expect(source(CARD)).not.toMatch(/quantity.*isListed|isListed.*quantity\s*[<>=]/);
  });
});

describe("what the operational list contains", () => {
  it("scopes positions by the catalog, never by matching names", () => {
    expect(source(QUERIES)).toContain("catalog.filter(isCollectible)");
    // No SKY-ID and no category name in the code; the comment names the
    // fixture only to explain why the scope is data-driven.
    expect(code(QUERIES)).not.toMatch(/SKY-9998|"Spiele"|Fixture/);
  });

  it("separates historical positions instead of deleting them", () => {
    const queries = source(QUERIES);
    expect(queries).toContain("outsideScope");
    // Nothing here deletes a position or a movement.
    expect(queries).not.toMatch(/\.delete\(/);
  });

  it("reads through the admin functions, never from the tables", () => {
    const queries = source(QUERIES);
    expect(queries).toContain('rpc("admin_shop_inventory")');
    expect(queries).toContain('rpc("admin_inventory_movements"');
    expect(queries).not.toMatch(/from\("shop_inventory"\)|from\("inventory_movements"\)/);
  });
});

describe("the movement history is read-only", () => {
  it("offers no delete and no edit", () => {
    const card = source(CARD);
    expect(card).not.toMatch(/deleteMovement|löschen|Historie korrigieren/i);
  });

  it("has no database function that could remove one", () => {
    const sql = source(FOUNDATION) + source(READS);
    expect(sql).not.toMatch(/delete from public\.inventory_movements/);
  });
});

describe("migration 0005 adds reads and nothing else", () => {
  const sql = source(READS);

  it("adds two functions and no table, policy or column", () => {
    expect((sql.match(/create or replace function/g) ?? []).length).toBe(2);
    expect(sql).not.toContain("create table");
    expect(sql).not.toContain("alter table");
    expect(sql).not.toContain("create policy");
  });

  it("checks the same predicate the write path checks", () => {
    for (const fn of ["admin_shop_inventory", "admin_inventory_movements"]) {
      const body = sql.slice(sql.indexOf(`function public.${fn}`), sql.indexOf("$$;", sql.indexOf(`function public.${fn}`)));
      expect(body, fn).toContain("if not public.is_shop_admin() then");
      expect(body, fn).toContain("security definer");
      expect(body, fn).toContain("set search_path = ''");
    }
  });

  it("grants nothing to anon and no table privilege to anyone", () => {
    expect(sql).toMatch(/revoke all on function public\.admin_shop_inventory\(\)\s*from public, anon;/);
    expect(sql).not.toMatch(/grant (select|insert|update|delete)[^\n]*on public\./);
    expect(sql).not.toMatch(/to anon/);
  });
});

/**
 * The server client must not reach the browser.
 *
 * The stock page is a server component, but the cards are client components
 * and they need the vocabulary. Importing it from the query module pulled
 * `lib/supabase/server` into the client bundle and the build said so — hence
 * the split into a model without a database.
 */
describe("the model carries no database", () => {
  it("imports nothing from the server client", () => {
    const model = source(MODEL);
    expect(model).not.toContain("@/lib/supabase/server");
    expect(model).not.toContain("createClient");
  });

  it("is what the client components import", () => {
    for (const path of [CARD, DIALOG, VIEW]) {
      expect(source(path), path).toContain("@/lib/admin/inventory-model");
      expect(source(path), path).not.toMatch(/from "@\/lib\/admin\/inventory"/);
    }
  });

  it("leaves the queries on the server", () => {
    expect(source(QUERIES)).toContain("@/lib/supabase/server");
    expect(source(QUERIES)).not.toContain('"use client"');
  });
});

describe("the stock page is admin-only by construction", () => {
  it("sits inside the admin route group", () => {
    expect(() => source("src/app/(admin)/admin/inventory/page.tsx")).not.toThrow();
    // (admin)/layout.tsx answers 404 to everyone else, and the database
    // refuses the reads regardless (migration 0005).
    expect(source("src/app/(admin)/layout.tsx")).toContain("if (!(await isAdmin())) notFound();");
  });

  it("loads the catalog including hidden figures, like the admin catalog", () => {
    // A figure taken out of the public catalog can still sit in a box.
    expect(source("src/app/(admin)/admin/inventory/page.tsx")).toContain(
      "fetchCatalog({ includeHidden: true })",
    );
  });
});
