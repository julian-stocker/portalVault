import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  accountsForEveryRow,
  buildPlan,
  IMPORT_CONDITION,
  plannedPieces,
  positionKey,
  stockRows,
  type CatalogEntry,
  type LegacyStock,
  type Plan,
  type PositionState,
} from "@/lib/shop/legacy-plan";

/**
 * The legacy opening balance, as a decision (ADR-0044).
 *
 * These are the tests that make `--apply` safe to run twice, safe to resume
 * after a crash, and unable to add stock on top of a position somebody is
 * already managing by hand. They work against constructed ledger states,
 * because the alternative — a fixture in the real database — would leave a
 * permanent row in an append-only journal.
 */
function stock(skyId: string, available: number, name = `Figure ${skyId}`): LegacyStock {
  return { skyId, name, sheet: "SA", row: 4, available };
}

const COLLECTIBLE: CatalogEntry = { isActive: true, categoryName: "Figuren" };
const SOFTWARE: CatalogEntry = { isActive: true, categoryName: "Spiele" };

function catalogOf(rows: readonly LegacyStock[], entry: CatalogEntry = COLLECTIBLE) {
  return new Map(rows.map((row) => [row.skyId, entry]));
}

/**
 * What the ledger looks like after the planned movements have been booked.
 *
 * The real `system_record_inventory_movement()` opens the position and writes
 * the journal row in one transaction, so booking a movement turns "absent"
 * into "exists, one movement, opening balance set". Modelling that here is
 * what lets a test run the tool twice for real rather than assert about a
 * hand-written second state.
 *
 * `booked` limits how many of the planned movements went through — which is
 * exactly what a run that stopped half way leaves behind.
 */
function afterApplying(
  states: ReadonlyMap<string, PositionState>,
  plan: Plan,
  booked = plan.movements.length,
): Map<string, PositionState> {
  const next = new Map(states);
  for (const movement of plan.movements.slice(0, booked)) {
    const key = positionKey(movement.skyId, movement.condition);
    const before = next.get(key);
    next.set(key, {
      exists: true,
      movements: (before?.movements ?? 0) + 1,
      openingBalance: movement.quantity,
    });
  }
  return next;
}

/** A position that exists because somebody booked movements against it. */
function managedByHand(movements: number): PositionState {
  return { exists: true, movements, openingBalance: null };
}

describe("the first run", () => {
  const rows = [stock("SKY-0007", 3), stock("SKY-0008", 1), stock("SKY-0009", 2)];

  it("plans one opening balance per position, as loose", () => {
    const plan = buildPlan(rows, catalogOf(rows), new Map());

    expect(plan.movements).toHaveLength(3);
    expect(plannedPieces(plan)).toBe(6);
    expect(plan.movements.every((movement) => movement.condition === IMPORT_CONDITION)).toBe(true);
    expect(plan.already).toHaveLength(0);
    expect(plan.conflicts).toHaveLength(0);
  });

  it("accounts for every row with stock", () => {
    const plan = buildPlan(rows, catalogOf(rows), new Map());
    expect(accountsForEveryRow(plan, rows)).toBe(true);
  });

  it("ignores a row without stock entirely", () => {
    const withZero = [...rows, stock("SKY-0010", 0)];
    const plan = buildPlan(withZero, catalogOf(withZero), new Map());
    expect(plan.movements).toHaveLength(3);
    expect(stockRows(withZero)).toHaveLength(3);
    expect(accountsForEveryRow(plan, withZero)).toBe(true);
  });
});

describe("running it a second time", () => {
  const rows = [stock("SKY-0007", 3), stock("SKY-0008", 1), stock("SKY-0009", 2)];

  it("books nothing and changes nothing", () => {
    const first = buildPlan(rows, catalogOf(rows), new Map());
    const second = buildPlan(rows, catalogOf(rows), afterApplying(new Map(), first));

    expect(second.movements).toHaveLength(0);
    expect(plannedPieces(second)).toBe(0);
    expect(second.already).toHaveLength(3);
    expect(second.conflicts).toHaveLength(0);
    // The opening balances stay exactly what the first run booked.
    expect(second.already.map((row) => row.openingBalance)).toEqual([3, 1, 2]);
  });

  it("stays settled however often it runs", () => {
    let states = afterApplying(new Map(), buildPlan(rows, catalogOf(rows), new Map()));
    for (let run = 0; run < 3; run += 1) {
      const plan = buildPlan(rows, catalogOf(rows), states);
      expect(plan.movements).toHaveLength(0);
      states = afterApplying(states, plan);
    }
  });

  it("does not re-open a position whose stock is back at zero", () => {
    // Detection is by the journal, never by the stock level: a position that
    // has been sold out is still a position that was opened.
    const soldOut = new Map<string, PositionState>([
      [positionKey("SKY-0007", IMPORT_CONDITION), { exists: true, movements: 4, openingBalance: 3 }],
    ]);
    const plan = buildPlan([stock("SKY-0007", 3)], catalogOf(rows), soldOut);
    expect(plan.movements).toHaveLength(0);
    expect(plan.already).toHaveLength(1);
  });

  it("re-imports nothing when the workbook has moved on", () => {
    // The ledger is authoritative from the opening balance onwards. A
    // different number in the workbook is information, never a reason to book.
    const opened = new Map<string, PositionState>([
      [positionKey("SKY-0007", IMPORT_CONDITION), { exists: true, movements: 1, openingBalance: 3 }],
    ]);
    const plan = buildPlan([stock("SKY-0007", 11)], catalogOf(rows), opened);
    expect(plan.movements).toHaveLength(0);
    expect(plan.already[0]).toMatchObject({ openingBalance: 3, legacyQuantity: 11 });
  });
});

describe("a run that stopped half way", () => {
  const rows = Array.from({ length: 10 }, (_, i) =>
    stock(`SKY-${String(1000 + i).padStart(4, "0")}`, i + 1),
  );

  it("continues with exactly the positions that are still missing", () => {
    const first = buildPlan(rows, catalogOf(rows), new Map());
    expect(first.movements).toHaveLength(10);

    // The process died after four of the ten movements.
    const partial = afterApplying(new Map(), first, 4);
    const resumed = buildPlan(rows, catalogOf(rows), partial);

    expect(resumed.movements).toHaveLength(6);
    expect(resumed.already).toHaveLength(4);
    expect(resumed.movements.map((movement) => movement.skyId)).toEqual(
      first.movements.slice(4).map((movement) => movement.skyId),
    );
    // No position is planned twice.
    const booked = new Set(first.movements.slice(0, 4).map((movement) => movement.skyId));
    expect(resumed.movements.some((movement) => booked.has(movement.skyId))).toBe(false);
  });

  it("ends up with the same ledger as an uninterrupted run", () => {
    const uninterrupted = afterApplying(new Map(), buildPlan(rows, catalogOf(rows), new Map()));

    const first = buildPlan(rows, catalogOf(rows), new Map());
    const partial = afterApplying(new Map(), first, 4);
    const resumed = afterApplying(partial, buildPlan(rows, catalogOf(rows), partial));

    expect([...resumed.entries()].sort()).toEqual([...uninterrupted.entries()].sort());
    // And every position carries exactly one movement, not two.
    for (const state of resumed.values()) expect(state.movements).toBe(1);
  });
});

describe("a position somebody is already managing", () => {
  const rows = [stock("SKY-0007", 3, "Bash"), stock("SKY-0008", 1)];

  const states = new Map<string, PositionState>([
    [positionKey("SKY-0007", IMPORT_CONDITION), managedByHand(2)],
  ]);

  it("is a conflict, not an import", () => {
    // Existing movements and no opening balance means real stock was booked
    // here by hand. Adding the legacy number would double it, and nothing
    // would raise an error — the stock would just be wrong.
    const plan = buildPlan(rows, catalogOf(rows), states);

    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]).toMatchObject({
      skyId: "SKY-0007",
      condition: IMPORT_CONDITION,
      movements: 2,
      legacyQuantity: 3,
      name: "Bash",
    });
  });

  it("writes nothing for that position, and everything for the others", () => {
    const plan = buildPlan(rows, catalogOf(rows), states);

    expect(plan.movements.map((movement) => movement.skyId)).toEqual(["SKY-0008"]);
    expect(plannedPieces(plan)).toBe(1);
    expect(accountsForEveryRow(plan, rows)).toBe(true);
  });

  it("stays a conflict on every further run", () => {
    // Nothing this tool does can resolve it; only a human booking a
    // correction can.
    const first = buildPlan(rows, catalogOf(rows), states);
    const second = buildPlan(rows, catalogOf(rows), afterApplying(states, first));

    expect(second.conflicts).toHaveLength(1);
    expect(second.movements).toHaveLength(0);
    expect(second.already).toHaveLength(1);
  });

  it("is not confused with a position that has an opening balance", () => {
    const opened = new Map<string, PositionState>([
      [positionKey("SKY-0007", IMPORT_CONDITION), { exists: true, movements: 5, openingBalance: 3 }],
    ]);
    const plan = buildPlan(rows, catalogOf(rows), opened);
    expect(plan.conflicts).toHaveLength(0);
    expect(plan.already).toHaveLength(1);
  });
});

describe("what never enters the plan at all", () => {
  it("excludes fixtures, software, inactive rows and unknown SKY-IDs", () => {
    const rows = [
      stock("SKY-9998", 4),
      stock("SKY-9994", 1),
      stock("SKY-0002", 3, "Wii Spiel"),
      stock("SKY-0204", 2, "Blash Zone - OBERTEIL"),
      stock("SKY-0300", 1),
      stock("SKY-0007", 5),
    ];
    const catalog = new Map<string, CatalogEntry>([
      ["SKY-9998", COLLECTIBLE],
      ["SKY-9994", COLLECTIBLE],
      ["SKY-0002", SOFTWARE],
      ["SKY-0300", { isActive: false, categoryName: "Figuren" }],
      ["SKY-0007", COLLECTIBLE],
      // SKY-0204 deliberately absent: the SWAP halves have no catalog row.
    ]);

    const plan = buildPlan(rows, catalog, new Map());

    expect(plan.movements.map((movement) => movement.skyId)).toEqual(["SKY-0007"]);
    expect(
      Object.fromEntries(plan.skipped.map((row) => [row.skyId, row.reason])),
    ).toEqual({
      "SKY-9998": "fixture",
      "SKY-9994": "fixture",
      "SKY-0002": "software",
      "SKY-0204": "not-in-catalog",
      "SKY-0300": "inactive",
    });
    expect(accountsForEveryRow(plan, rows)).toBe(true);
  });

  it("checks the fixtures before anything else", () => {
    // Even if a fixture were active and collectible, it is never imported.
    const rows = [stock("SKY-9998", 4)];
    const plan = buildPlan(rows, catalogOf(rows), new Map());
    expect(plan.movements).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe("fixture");
  });
});

describe("the database keeps the last word", () => {
  it("still allows at most one opening balance per position", () => {
    // The tool's own check is what makes a second run finish cleanly. This
    // index is what makes a second opening balance impossible even if the
    // tool were wrong — and no migration may quietly drop it.
    const foundation = readFileSync("supabase/migrations/0003_shop_foundation.sql", "utf8");
    expect(foundation).toContain("create unique index inventory_movements_one_initial_import");
    expect(foundation).toContain("where reason = 'initial_import'");

    for (const file of ["0004_catalog_editorial.sql", "0005_inventory_admin_read.sql",
                        "0006_public_shop_offers.sql"]) {
      const sql = readFileSync(`supabase/migrations/${file}`, "utf8");
      expect(sql).not.toContain("inventory_movements_one_initial_import");
    }
  });
});
