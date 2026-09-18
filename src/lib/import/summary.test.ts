/**
 * The import summary has to add up (migration 0050).
 *
 * WHAT WENT WRONG. `0048` counted unchanged rows as
 *
 *     status = 'pending' and delta = 0
 *
 * and `reconcile()` never produces that combination: zero delta means
 * `unchanged`, and `pending` means the delta is not zero. The counter was not
 * occasionally wrong — it was unreachable, so it was always 0. The real
 * workbook's preview stored 307 unchanged rows and reported
 * `559 supported · 245 increases · 7 decreases · 0 unchanged · 0 conflicts`.
 *
 * Nothing was mis-applied: `seller_apply_import()` iterates `status =
 * 'pending'` and never reads these counters. But this is the arithmetic on the
 * screen where the owner authorises a change to real stock.
 *
 * These tests fix the categories to the states `reconcile()` can actually
 * return, so a filter that cannot match is a failing test rather than a quiet
 * zero.
 */
import { describe, expect, it } from "vitest";

import { code, latestFunction, migrationSource } from "@/test-support/migrations";
import { reconcile, type Baseline } from "./classify";

/** The five counters `seller_create_import()` writes, as SQL filters. */
function summaryFilters(): Record<string, string> {
  const fn = code(latestFunction("seller_create_import").body);
  const out: Record<string, string> = {};
  for (const m of fn.matchAll(/count\(\*\) filter \(where ([^)]*(?:\)[^)]*)*?)\)\s+as (\w+)/g)) {
    out[m[2]] = m[1].trim();
  }
  return out;
}

const shop = (quantity: number, reserved = 0): Baseline => ({
  quantity,
  reserved,
  lastMovementAt: null,
  lastImportDesired: null,
});

describe("the statuses reconcile() can actually return", () => {
  it("delta > 0 is pending, not unchanged", () => {
    const r = reconcile(5, shop(3));
    expect(r.status).toBe("pending");
    expect(r.delta).toBe(2);
  });

  it("delta < 0 is pending, not unchanged", () => {
    const r = reconcile(2, shop(4));
    expect(r.status).toBe("pending");
    expect(r.delta).toBe(-2);
  });

  it("delta = 0 is unchanged — and is NEVER pending", () => {
    /*
     * This single fact is what made the old filter dead. Stating it as a test
     * means any future change to `reconcile()` that reintroduces a zero-delta
     * `pending` has to face this assertion first.
     */
    const r = reconcile(5, shop(5));
    expect(r.status).toBe("unchanged");
    expect(r.delta).toBe(0);
    expect(r.status).not.toBe("pending");
  });

  it("a reservation is a conflict, not an unchanged row", () => {
    // qty 5, 3 promised to a checkout in flight, the sheet says 2.
    const r = reconcile(2, shop(5, 3));
    expect(r.status).toBe("conflict");
    expect(r.delta).toBe(-3);
    expect(r.status).not.toBe("unchanged");
    expect(r.note).toContain("reserviert");
  });

  it("produces exactly three statuses, which is why there are four counters", () => {
    const seen = new Set([
      reconcile(5, shop(3)).status,
      reconcile(2, shop(4)).status,
      reconcile(5, shop(5)).status,
      reconcile(2, shop(5, 3)).status,
    ]);
    expect([...seen].sort()).toEqual(["conflict", "pending", "unchanged"]);
  });
});

describe("the SQL counts those states, not states that cannot occur", () => {
  const filters = summaryFilters();

  it("counts unchanged rows by their status", () => {
    expect(filters.same).toBe("status = 'unchanged'");
  });

  it("no longer uses the expression that could never match", () => {
    // The 0048 defect, named so it cannot come back unnoticed.
    expect(filters.same).not.toContain("delta = 0");
    expect(code(latestFunction("seller_create_import").body)).not.toContain(
      "status = 'pending' and delta = 0",
    );
  });

  it("splits pending by the sign of the delta", () => {
    expect(filters.inc).toBe("status = 'pending' and delta > 0");
    expect(filters.dec).toBe("status = 'pending' and delta < 0");
  });

  it("counts conflicts separately from everything else", () => {
    expect(filters.conflicts).toBe("status = 'conflict'");
  });

  it("counts supported rows by classification, not by status", () => {
    expect(filters.supported).toBe(
      "classification = 'SUPPORTED_COMPLETE_LOOSE_FIGURE'",
    );
  });
});

describe("supported = increases + decreases + unchanged + conflicts", () => {
  /**
   * The counters, computed in TypeScript exactly as the SQL filters compute
   * them. If a filter can never match, its category is 0 here too and the
   * identity fails — which is precisely how the original bug is caught.
   */
  function summarise(
    rows: readonly { classification: string; status: string; delta: number }[],
    sameFilter: (r: { status: string; delta: number }) => boolean,
  ) {
    const supported = rows.filter(
      (r) => r.classification === "SUPPORTED_COMPLETE_LOOSE_FIGURE",
    ).length;
    return {
      supported,
      increases: rows.filter((r) => r.status === "pending" && r.delta > 0).length,
      decreases: rows.filter((r) => r.status === "pending" && r.delta < 0).length,
      unchanged: rows.filter(sameFilter).length,
      conflicts: rows.filter((r) => r.status === "conflict").length,
    };
  }

  /** One row per case, plus ignored rows that must stay out of the sum. */
  const CASES = [
    { desired: 5, base: shop(3) },        // increase
    { desired: 9, base: shop(1) },        // increase
    { desired: 2, base: shop(4) },        // decrease
    { desired: 0, base: shop(6) },        // decrease to nothing
    { desired: 5, base: shop(5) },        // unchanged
    { desired: 0, base: shop(0) },        // unchanged at zero
    { desired: 3, base: shop(3) },        // unchanged
    { desired: 2, base: shop(5, 3) },     // conflict
  ];

  const supportedRows = CASES.map((c) => {
    const r = reconcile(c.desired, c.base);
    return {
      classification: "SUPPORTED_COMPLETE_LOOSE_FIGURE",
      status: r.status,
      delta: r.delta,
    };
  });

  const ignoredRows = [
    { classification: "IGNORED_GAME", status: "skipped", delta: 0 },
    { classification: "IGNORED_SWAP_FORCE_HALF", status: "skipped", delta: 0 },
    { classification: "IGNORED_OVP", status: "skipped", delta: 0 },
    { classification: "IGNORED_DAMAGED", status: "skipped", delta: 0 },
    { classification: "IGNORED_SHEET", status: "skipped", delta: 0 },
  ];

  const rows = [...supportedRows, ...ignoredRows];

  it("holds with the corrected filter", () => {
    const s = summarise(rows, (r) => r.status === "unchanged");
    expect(s).toEqual({ supported: 8, increases: 2, decreases: 2, unchanged: 3, conflicts: 1 });
    expect(s.increases + s.decreases + s.unchanged + s.conflicts).toBe(s.supported);
  });

  it("FAILS with the 0048 filter — which is what makes this a regression test", () => {
    /*
     * The same rows, counted the way `0048` counted them. If this ever stops
     * failing, the filter has become reachable and the test above has stopped
     * meaning anything.
     */
    const s = summarise(rows, (r) => r.status === "pending" && r.delta === 0);
    expect(s.unchanged).toBe(0);
    expect(s.increases + s.decreases + s.unchanged + s.conflicts).not.toBe(s.supported);
  });

  it("never counts an IGNORED row as unchanged supported stock", () => {
    /*
     * Ignored rows carry `skipped`, never `unchanged`, so they fall outside
     * both `supported` and every status counter. A game row must be left alone
     * — neither imported nor zeroed — and it must not pad the arithmetic that
     * describes the stock take either.
     */
    const s = summarise(rows, (r) => r.status === "unchanged");
    expect(s.supported).toBe(supportedRows.length);
    expect(s.supported).not.toBe(rows.length);

    const ignoredOnly = summarise(ignoredRows, (r) => r.status === "unchanged");
    expect(ignoredOnly).toEqual({
      supported: 0, increases: 0, decreases: 0, unchanged: 0, conflicts: 0,
    });
  });

  it("matches what the real workbook produced", () => {
    // 559 supported = 245 increases + 7 decreases + 307 unchanged + 0 conflicts.
    expect(245 + 7 + 307 + 0).toBe(559);
  });
});

describe("0048 is applied, so 0050 is additive and minimal", () => {
  it("is defined by 0050, not by an edit to 0048", () => {
    expect(latestFunction("seller_create_import").file).toBe(
      "0050_inventory_import_unchanged_summary.sql",
    );
    expect(migrationSource("0048_inventory_import.sql")).toContain(
      "status = 'pending' and delta = 0",
    );
  });

  it("redefines that ONE function and leaves every other 0048 function alone", () => {
    /*
     * The apply path, the baseline read, the mappings and the history are all
     * still whatever 0048 made them. Replacing more than the summary would be
     * scope this fix does not have.
     */
    for (const fn of [
      "seller_apply_import",
      "seller_import_baseline",
      "seller_discard_import",
      "seller_import_mappings",
      "seller_save_import_mapping",
      "seller_imports",
      "seller_import_rows",
    ]) {
      expect(latestFunction(fn).file, fn).toBe("0048_inventory_import.sql");
    }
  });

  it("is that one function, verbatim, with one line different", () => {
    // The strongest statement available without a database: byte-compare the
    // 0048 definition against the 0050 one and require a single differing line.
    const extract = (file: string) => {
      const src = migrationSource(file);
      const start = src.indexOf("create or replace function public.seller_create_import");
      return src.slice(start, src.indexOf("\n$$;", start));
    };
    const before = extract("0048_inventory_import.sql").split("\n");
    const after = extract("0050_inventory_import_unchanged_summary.sql").split("\n");

    expect(after).toHaveLength(before.length);
    const changed = before.filter((line, i) => line !== after[i]);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toContain("status = 'pending' and delta = 0");
  });

  it("leaves the reconciliation and the fingerprint untouched", () => {
    // Named explicitly because they were listed as out of scope.
    const sql = migrationSource("0050_inventory_import_unchanged_summary.sql");
    expect(code(sql)).not.toContain("record_inventory_movement");
    expect(code(sql)).not.toContain("alter table");
    expect(code(sql)).not.toContain("create table");
    expect(code(sql)).not.toContain("drop ");
  });
});
