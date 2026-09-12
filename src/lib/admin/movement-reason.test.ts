import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { MOVEMENT_REASONS } from "@/lib/admin/inventory";
import { de } from "@/lib/i18n/de";

/**
 * `0025` — a sale is called `sale` (ADR-0065).
 *
 * Two things are easy to lose here and expensive to lose in production.
 *
 * The first is the promise that HISTORY IS UNTOUCHED. `reason` sits inside the
 * frozen tuple of `prevent_inventory_movement_change()`, so a backfill cannot
 * succeed — but it can be *written*, and a migration that tries is a migration
 * that fails halfway through. These tests read the file and assert it does not
 * try.
 *
 * The second is that `convert_order_reservations()` was carried over VERBATIM
 * from 0010, with exactly one line changed. Rewriting a function from memory
 * while replacing one string in it is how a locking order or an idempotency
 * claim quietly disappears. That property is checked here rather than trusted.
 */
const FOUNDATION = "supabase/migrations/0003_shop_foundation.sql";
const COMMERCE = "supabase/migrations/0010_commerce_core.sql";
const MIGRATION = "supabase/migrations/0025_movement_reason_neutral.sql";

const sql = readFileSync(MIGRATION, "utf8");

/** SQL with comment lines removed, so assertions test code and not prose. */
const code = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

/** The body of one function, between its `$$` markers. */
function body(file: string, name: string): string {
  const source = readFileSync(file, "utf8");
  const start = source.indexOf(`create or replace function public.${name}(`);
  expect(start, `${name} is missing from ${file}`).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf("\n$$;", start) + 4);
}

/** The values inside one CHECK constraint. */
function permitted(constraint: string): string[] {
  const start = code.indexOf(`add constraint ${constraint}`);
  expect(start, `${constraint} is missing`).toBeGreaterThan(-1);
  const block = code.slice(start, code.indexOf(");", start));
  return [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

// ---------------------------------------------------------------------------

describe("the vocabulary grows and never shrinks", () => {
  const values = permitted("inventory_movements_reason_known");

  it("adds `sale`", () => {
    expect(values).toContain("sale");
  });

  it("keeps `sale_skyisles` permanently", () => {
    /*
     * Not a courtesy. Existing rows carry the value and can never be changed,
     * so a CHECK without it would fail on `add constraint` — the migration
     * would not apply at all.
     */
    expect(values).toContain("sale_skyisles");
  });

  it("leaves `sale_external` alone", () => {
    expect(values).toContain("sale_external");
  });

  it("carries over every value 0003 permitted", () => {
    const before = readFileSync(FOUNDATION, "utf8");
    const block = before.slice(
      before.indexOf("inventory_movements_reason_known"),
      before.indexOf("inventory_movements_delta_direction"),
    );
    for (const old of [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])) {
      expect(values, `0003 permitted ${old}`).toContain(old);
    }
  });

  it("adds nothing but `sale`", () => {
    const before = readFileSync(FOUNDATION, "utf8");
    const block = before.slice(
      before.indexOf("inventory_movements_reason_known"),
      before.indexOf("inventory_movements_delta_direction"),
    );
    const old = new Set([...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
    expect(values.filter((v) => !old.has(v))).toEqual(["sale"]);
  });
});

describe("a sale still moves stock out", () => {
  const direction = permitted("inventory_movements_delta_direction");

  it("gives `sale` the same direction as the name it replaces", () => {
    const block = code.slice(code.indexOf("add constraint inventory_movements_delta_direction"));
    expect(block).toContain("when 'sale'           then delta < 0");
    expect(block).toContain("when 'sale_skyisles'  then delta < 0");
  });

  it("keeps every other branch from 0003", () => {
    for (const reason of ["purchase", "initial_import", "sale_external", "writeoff"]) {
      expect(direction, reason).toContain(reason);
    }
  });

  it("leaves the cost rule alone — a sale can still carry no cost", () => {
    expect(code).not.toContain("inventory_movements_cost_only_on_purchase");
  });
});

describe("history is not touched, and the file proves it", () => {
  it("writes no row", () => {
    expect(code).not.toMatch(/update\s+public\.inventory_movements/i);
    expect(code).not.toMatch(/insert\s+into\s+public\.inventory_movements/i);
    expect(code).not.toMatch(/delete\s+from\s+public\.inventory_movements/i);
  });

  it("reads no row", () => {
    expect(code).not.toMatch(/from\s+public\.inventory_movements/i);
  });

  it("does not weaken the append-only guard", () => {
    expect(code).not.toContain("prevent_inventory_movement_change");
    expect(code).not.toContain("disable trigger");
    expect(code).not.toContain("alter table public.inventory_movements disable");
  });

  it("does not touch the one function that books a movement", () => {
    expect(code).not.toContain("function public.apply_inventory_movement");
  });
});

describe("the single-seller line holds (ADR-0064)", () => {
  it("introduces no seller structure", () => {
    /*
     * Against `code`, not `sql`: the banner at the top explains WHY the old
     * name is wrong and says the word "seller" and "merchant" while doing it.
     * Prose may name the idea; executable SQL may not introduce it.
     */
    for (const forbidden of ["seller", "vendor", "merchant", "shop_id"]) {
      expect(code.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  it("touches one table and one function, and nothing else", () => {
    const altered = [...code.matchAll(/^alter table (\S+)/gm)].map((m) => m[1]);
    expect(new Set(altered)).toEqual(new Set(["public.inventory_movements"]));

    const defined = [...code.matchAll(/create or replace function (\S+?)\(/g)].map((m) => m[1]);
    expect(defined).toEqual(["public.convert_order_reservations"]);

    expect(code).not.toMatch(/create table/i);
    expect(code).not.toMatch(/drop table/i);
    expect(code).not.toMatch(/add column/i);
    expect(code).not.toMatch(/drop column/i);
    expect(code).not.toMatch(/create policy/i);
    expect(code).not.toMatch(/create trigger/i);
  });
});

describe("convert_order_reservations was carried over, not rewritten", () => {
  const before = body(COMMERCE, "convert_order_reservations");
  const after = body(MIGRATION, "convert_order_reservations");

  it("differs from 0010 in exactly one line", () => {
    const a = before.split("\n");
    const b = after.split("\n");
    expect(b.length, "the function gained or lost lines").toBe(a.length);
    const changed = a.map((line, i) => [i, line, b[i]] as const).filter(([, x, y]) => x !== y);
    expect(changed.map(([i]) => i), "more than one line changed").toHaveLength(1);
  });

  it("and the one line is the reason it books", () => {
    expect(before).toContain("'sale_skyisles',");
    expect(after).toContain("'sale',");
    expect(after).not.toContain("'sale_skyisles'");
  });

  it("keeps the claim-under-lock that makes it idempotent", () => {
    expect(after).toContain("for update of r");
    expect(after).toContain("set state = 'converted', converted_at = now()");
    expect(after).toContain("and state = 'active'");
  });

  it("keeps the guard that refuses to half-convert an order", () => {
    expect(after).toContain("and reserved >= v_row.quantity");
    expect(after).toContain("errcode = 'data_corrupted'");
  });

  it("still books through the existing journal and no second path", () => {
    expect(after).toContain("public.apply_inventory_movement(");
    expect(after).not.toContain("insert into public.inventory_movements");
  });

  it("restates no grant — `create or replace` keeps the ACL it had", () => {
    expect(code).not.toMatch(/grant execute on function public\.convert_order_reservations/);
    expect(code).not.toMatch(/revoke .* on function public\.convert_order_reservations/);
  });
});

describe("what the operator sees", () => {
  it("offers `sale` for a new booking and not the retired name", () => {
    expect(MOVEMENT_REASONS).toContain("sale");
    expect(MOVEMENT_REASONS).not.toContain("sale_skyisles");
  });

  it("labels both, because an old row still has to read", () => {
    expect(de.inventory.reasons.sale).toBe("Verkauf");
    expect(de.inventory.reasons.sale_skyisles).toContain("historisch");
    expect(de.inventory.reasons.sale_external).toBe("Externer Verkauf");
  });

  it("keeps the two apart — one label must not read as the other", () => {
    expect(de.inventory.reasons.sale).not.toBe(de.inventory.reasons.sale_skyisles);
  });
});
