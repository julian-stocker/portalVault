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
const VIEW = "src/components/admin/inventory-view.tsx";
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
      "sale",
      "return",
      "correction",
      "writeoff",
    ]);
  });

  /**
   * Lager V2 turned the taps into a draft. Until then every tap wrote its
   * own movement: three taps from 3 to 6 left three journal rows, and a
   * mis-tap corrected back left five. The journal stayed honest and stopped
   * reading like one.
   */
  it("moves a draft by one, and the shelf by nothing", () => {
    expect(stepper).toContain("function bump(step: 1 | -1)");
    expect(stepper).toContain("setDraft((current) => current + step)");
    expect(stepper).toContain("bump(1)");
    expect(stepper).toContain("bump(-1)");
    // A tap is not a write: the only call that books sits in save().
    expect(stepper).toMatch(/function save\(\)[\s\S]*?await bookMovement\(\{/);
  });

  it("books one movement for the net difference", () => {
    expect(stepper).toContain("const delta = draftDelta(draft, quantity);");
    expect(stepper).toContain("delta,");
  });

  it("writes nothing when the draft is back where it started", () => {
    // Not a zero-delta row the database would refuse anyway — no row at all,
    // because nothing happened.
    expect(stepper).toContain("const dirty = delta !== 0;");
    expect(stepper).toContain("if (!dirty) return;");
  });

  it("offers the save only once there is something to save", () => {
    expect(stepper).toContain("{dirty ? (");
    expect(stepper).toContain("de.inventory.draftSave");
    expect(stepper).toContain("de.inventory.draftDiscard");
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
    // Why two saves cannot lose an update: two requests that each say "+2"
    // compose, two that each say "= 8" do not. Still true of the draft —
    // what travels is `draft − saved`, not `draft`.
    expect(stepper).toContain("const delta = draftDelta(draft, quantity);");
    expect(stepper).not.toMatch(/delta:\s*(draft|shown|quantity)\b/);
  });

  it("lets the database serialise them", () => {
    // apply_inventory_movement() locks the position before deciding.
    const foundation = code(FOUNDATION);
    expect(foundation).toContain("for update");
    expect(foundation).toContain("set quantity = quantity + p_delta");
  });

  it("lands the draft on the server value once the save has gone through", () => {
    // Adjusted while rendering, the way React documents it — an effect
    // would render the stale number once and cascade a second pass.
    expect(stepper).toContain("if (seen !== quantity) {");
    expect(stepper).toContain("setDraft(quantity);");
    expect(stepper).not.toContain("useEffect");
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
    expect(stepper).toContain("const floor = draftFloor(reserved);");
    expect(stepper).toContain("if (step === -1 && draft <= floor)");
    expect(stepper).toContain("disabled={pending || draft <= floor}");
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

  /**
   * Lager V2 took "Weitere Buchung" off the card. `−/+` plus a save is the
   * manual correction path now, and a second button that books the same
   * movement behind a reason field was two ways to say one thing.
   *
   * The dialog itself stays: it is how a position that does not exist yet
   * gets its first movement, which the stepper cannot do — there is no
   * quantity to step from.
   */
  it("is gone from the card, where the stepper now does that job", () => {
    const card = code(CARD);
    expect(card).not.toContain("<StockDialog");
    expect(card).not.toContain("de.inventory.changeStock");
    expect(card).toContain("<StockStepper");
  });

  it("is still how a new position is opened", () => {
    const view = code(VIEW);
    expect(view).toContain("<StockDialog");
    expect(view).toContain("de.inventory.newPosition");
  });
});

describe("who may book at all", () => {
  it("is decided in the database, not in the component", () => {
    const actions = code(ACTIONS);
    expect(actions).toContain('"record_inventory_movement"');
    // The action asks first to return a German sentence; the function asks
    // again because that is the boundary.
    expect(actions).toContain("if (!(await allowed(capability)))");
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
