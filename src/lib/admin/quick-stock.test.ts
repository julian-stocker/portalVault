import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { MOVEMENT_REASONS, isMovementReason } from "@/lib/admin/inventory-model";

/**
 * `−  7  +` (ADR-0047).
 *
 * The interface got faster; the audit trail did not get weaker. Every one of
 * these asserts the second half of that sentence — that a tap is an ordinary
 * movement, that stock is never assigned, and that the guards which used to
 * be reached through a dialog are still the ones deciding.
 */
function source(path: string): string {
  return readFileSync(path, "utf8");
}

/** The file without its comments — what it does, not what it says. */
function code(path: string): string {
  return source(path)
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("/*");
    })
    .join("\n");
}

const STEPPER = "src/components/admin/stock-stepper.tsx";
const CARD = "src/components/admin/inventory-card.tsx";
const DIALOG = "src/components/admin/stock-dialog.tsx";
const ACTIONS = "src/lib/admin/actions.ts";
const FOUNDATION = "supabase/migrations/0003_shop_foundation.sql";

describe("a tap is a movement", () => {
  const stepper = code(STEPPER);

  it("books through the same action the dialog uses", () => {
    expect(stepper).toContain("await bookMovement({");
    expect(stepper).toContain('from "@/lib/admin/actions"');
  });

  it("uses correction, which already meant exactly this", () => {
    // A recount, either direction, with no cost basis. No new reason was
    // invented for a button.
    expect(stepper).toContain('reason: "correction",');
    expect(isMovementReason("correction")).toBe(true);
    expect([...MOVEMENT_REASONS]).toEqual([
      "purchase",
      "sale_external",
      "sale_skyisles",
      "return",
      "correction",
      "writeoff",
    ]);
  });

  it("moves by exactly one, in one direction", () => {
    expect(stepper).toContain("function bump(step: 1 | -1)");
    expect(stepper).toContain("delta: step,");
    expect(stepper).toContain("bump(1)");
    expect(stepper).toContain("bump(-1)");
  });

  it("never assigns a quantity", () => {
    // ADR-0037: quantity changes only inside apply_inventory_movement(),
    // together with its journal row, in one transaction. `quantity` appears
    // here as an incoming prop and nowhere else — there is no write path in
    // this component except the one movement.
    expect(stepper).not.toContain(".rpc(");
    expect(stepper).not.toContain(".from(");
    expect(stepper).not.toContain("set_shop_listing");
    expect(stepper).not.toContain("shop_inventory");
    const writes = stepper.match(/await \w+\(/g) ?? [];
    expect(writes).toEqual(["await bookMovement("]);
  });

  it("carries no cost and no note", () => {
    // `correction` may not carry a cost — the CHECK says so — and a note
    // nobody typed would be noise in the journal.
    expect(stepper).not.toContain("unitCost");
    expect(stepper).not.toContain("note");
  });

  it("records the administrator, because the database does", () => {
    // created_by is auth.uid(), read inside record_inventory_movement().
    // Nothing in the browser supplies it.
    expect(stepper).not.toContain("created_by");
    expect(code(FOUNDATION)).toContain("p_unit_cost, p_currency, p_note, (select auth.uid())");
  });
});

describe("rapid taps", () => {
  const stepper = code(STEPPER);

  it("sends a delta, never a target", () => {
    // Why concurrent taps cannot lose an update: two requests that each say
    // "+1" compose, two that each say "= 8" do not.
    expect(stepper).toContain("delta: step,");
    expect(stepper).not.toMatch(/delta:\s*(shown|quantity)/);
  });

  it("lets the database serialise them", () => {
    // apply_inventory_movement() locks the position before deciding.
    const foundation = code(FOUNDATION);
    expect(foundation).toContain("for update");
    expect(foundation).toContain("set quantity = quantity + p_delta");
  });

  it("holds the optimistic value until the transition that made it settles", () => {
    // useOptimistic, not a manual counter reset by an effect: the value
    // disappears exactly when the refreshed server value arrives.
    expect(stepper).toContain("useOptimistic");
    expect(stepper).toContain("startTransition(async () => {");
    expect(stepper).toContain("router.refresh();");
  });

  it("shows that something is in flight", () => {
    expect(stepper).toContain("pending");
    expect(stepper).toContain('aria-live="polite"');
  });
});

describe("the floor", () => {
  const stepper = code(STEPPER);

  it("stops at reserved rather than at zero", () => {
    // reserved is never below 0, so this covers negative stock as well.
    expect(stepper).toContain("const canDecrease = shown > reserved;");
    expect(stepper).toContain("disabled={!canDecrease}");
  });

  it("does not replace the database's guard", () => {
    const foundation = code(FOUNDATION);
    expect(foundation).toContain("and quantity + p_delta >= reserved");
    expect(foundation).toContain("would take % / % below its reserved quantity");
  });

  it("shows what the database says when it refuses", () => {
    expect(stepper).toContain("onFailed(result.message);");
  });
});

describe("the detailed booking is still there", () => {
  it("keeps every reason, the cost and the note", () => {
    const dialog = code(DIALOG);
    expect(dialog).toContain("MOVEMENT_REASONS.map");
    expect(dialog).toContain("unitCost");
    expect(dialog).toContain("de.inventory.noteLabel");
    expect(dialog).toContain("de.inventory.preview(quantity, after)");
  });

  it("is one tap away from the card", () => {
    const card = code(CARD);
    expect(card).toContain("<StockDialog");
    expect(card).toContain("setBooking(true)");
    expect(card).toContain("de.inventory.changeStock");
  });

  it("is no longer the only way to change stock", () => {
    const card = code(CARD);
    expect(card).toContain("<StockStepper");
  });
});

describe("who may book at all", () => {
  it("is decided in the database, not in the component", () => {
    const actions = code(ACTIONS);
    expect(actions).toContain('"record_inventory_movement"');
    // The action asks first to return a German sentence; the function asks
    // again because that is the boundary.
    expect(actions).toContain("if (!(await isAdmin()))");
    const foundation = code(FOUNDATION);
    expect(foundation).toMatch(
      /create or replace function public\.record_inventory_movement[\s\S]*?if not public\.is_shop_admin\(\) then/,
    );
  });

  it("still refuses initial_import from a browser", () => {
    // It belonged to the one legacy opening balance and is booked by server
    // tooling only (ADR-0044).
    expect([...MOVEMENT_REASONS]).not.toContain("initial_import");
    expect(isMovementReason("initial_import")).toBe(false);
  });
});
