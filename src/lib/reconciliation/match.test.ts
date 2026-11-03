import { describe, expect, it } from "vitest";
import { ebayReport, type FixtureOrder } from "./testing/ebay-fixture";
import { ledgerSale } from "./testing/ledger-fixture";
import { rowFor, runReconciliation } from "./testing/run";
import type { LedgerSale } from "./types";

function chained(orders: Omit<FixtureOrder, "record">[]): FixtureOrder[] {
  let record = 5000;
  return [...orders].sort((a, b) => a.sold.localeCompare(b.sold)).map((o) => {
    record += o.lines.length > 1 ? o.lines.length + 1 : 1;
    return { ...o, record };
  });
}

/** One report from Feb 1 to Feb 28 with an anchor at both ends, plus whatever a test adds. */
function scenario(orders: Omit<FixtureOrder, "record">[], sales: LedgerSale[]) {
  const all = [
    { ref: "90-0-first", sold: "2026-02-01", lines: [{ character: "Zap", unit: 3.5 }] },
    { ref: "90-0-last", sold: "2026-02-28", lines: [{ character: "Zook", unit: 2.5 }] },
    ...orders,
  ];
  return runReconciliation([{ name: "feb.csv", text: ebayReport(chained(all)) }], [
    ledgerSale({ id: 9001, sold: "2026-02-01", net: 3.5, pieces: ["Zap"] }),
    ledgerSale({ id: 9002, sold: "2026-02-28", net: 2.5, pieces: ["Zook"] }),
    ...sales,
  ]);
}

describe("stage A — a stored order reference decides", () => {
  it("pairs deterministically even ten days and a figure apart", () => {
    const run = scenario(
      [{ ref: "11-11111-11111", sold: "2026-02-10", lines: [{ character: "Swarm", unit: 8.99 }] }],
      [ledgerSale({ id: 1, sold: "2026-02-20", net: 7.99, ref: "11-11111-11111", pieces: ["Hex"] })],
    );
    const row = rowFor(run, { orderRef: "11-11111-11111" });
    expect(row.entry.kind === "pair" && row.entry.certainty).toBe("deterministic");
    expect(row.category).toBe("deviating");
    expect(row.diff?.findings.map((f) => f.field)).toEqual(["sold_on", "items_net", "figure", "total"]);
    // The reference is already there: nothing to add.
    expect(row.diff?.findings.some((f) => f.field === "external_order_ref")).toBe(false);
  });

  it("never offers a sale that names ANOTHER order", () => {
    const run = scenario(
      [{ ref: "11-11111-11111", sold: "2026-02-10", lines: [{ character: "Swarm", unit: 8.99 }] }],
      [ledgerSale({ id: 1, sold: "2026-02-10", net: 8.99, ref: "22-22222-22222", pieces: ["Swarm"] })],
    );
    expect(rowFor(run, { orderRef: "11-11111-11111" }).category).toBe("external_only");
    expect(rowFor(run, { saleId: 1 }).category).toBe("ledger_only");
  });

  it("treats two sales claiming one order number as ambiguous", () => {
    const run = scenario(
      [{ ref: "11-11111-11111", sold: "2026-02-10", lines: [{ character: "Swarm", unit: 8.99 }] }],
      [
        ledgerSale({ id: 1, sold: "2026-02-10", net: 8.99, ref: "11-11111-11111", pieces: ["Swarm"] }),
        ledgerSale({ id: 2, sold: "2026-02-10", net: 8.99, ref: "11-11111-11111", pieces: ["Swarm"] }),
      ],
    );
    expect(rowFor(run, { orderRef: "11-11111-11111" }).category).toBe("ambiguous");
  });
});

describe("stage B — evidence and one global assignment", () => {
  it("leaves two indistinguishable orders ambiguous instead of picking one", () => {
    const run = scenario(
      [
        { ref: "33-0-a", sold: "2026-02-10", shipping: 4.99, lines: [{ character: "Trap Team Portal", unit: 8.79 }] },
        { ref: "33-0-b", sold: "2026-02-10", shipping: 4.99, lines: [{ character: "Trap Team Portal", unit: 8.79 }] },
      ],
      [
        ledgerSale({ id: 1, sold: "2026-02-10", net: 8.79, shipping: 4.99, pieces: ["Trap Team Portal"] }),
        ledgerSale({ id: 2, sold: "2026-02-10", net: 8.79, shipping: 4.99, pieces: ["Trap Team Portal"] }),
      ],
    );
    for (const ref of ["33-0-a", "33-0-b"]) {
      const row = rowFor(run, { orderRef: ref });
      expect(row.category).toBe("ambiguous");
      expect(row.entry.kind === "pair" && row.entry.competitors.length).toBeGreaterThan(0);
    }
    expect(run.summary.money.total.count).toBe(0);
  });

  it("separates the same portal sold twice when the days tell them apart", () => {
    const run = scenario(
      [
        { ref: "33-0-a", sold: "2026-02-07", shipping: 4.99, lines: [{ character: "Trap Team Portal (0000586)", unit: 8.79 }] },
        { ref: "33-0-b", sold: "2026-02-10", shipping: 4.99, lines: [{ character: "Trap Team Portal (84394790)", unit: 8.79 }] },
      ],
      [
        ledgerSale({ id: 1, sold: "2026-02-07", net: 8.79, shipping: 4.99, pieces: [{ rawName: "0000586 (T)", skyId: "SKY-P1" }] }),
        ledgerSale({ id: 2, sold: "2026-02-10", net: 8.79, shipping: 4.99, pieces: [{ rawName: "84394790 (G)", skyId: "SKY-P2" }] }),
      ],
    );
    const a = rowFor(run, { orderRef: "33-0-a" });
    const b = rowFor(run, { orderRef: "33-0-b" });
    expect(a.entry.kind === "pair" && a.entry.sale.saleId).toBe(1);
    expect(b.entry.kind === "pair" && b.entry.sale.saleId).toBe(2);
    expect([a.category, b.category]).toEqual(["exact", "exact"]);
  });

  it("gives every sale to at most one order", () => {
    const run = scenario(
      [
        { ref: "44-0-a", sold: "2026-02-12", lines: [{ character: "Eruptor", unit: 4 }] },
        { ref: "44-0-b", sold: "2026-02-12", lines: [{ character: "Eruptor", unit: 4 }] },
        { ref: "44-0-c", sold: "2026-02-13", lines: [{ character: "Eruptor", unit: 4 }] },
      ],
      [
        ledgerSale({ id: 1, sold: "2026-02-12", net: 4, pieces: ["Eruptor"] }),
        ledgerSale({ id: 2, sold: "2026-02-13", net: 4, pieces: ["Eruptor"] }),
      ],
    );
    const saleIds = run.rows.flatMap((r) => (r.entry.kind === "pair" ? [r.entry.sale.saleId] : []));
    expect(new Set(saleIds).size).toBe(saleIds.length);
    expect(run.rows.filter((r) => r.category === "external_only")).toHaveLength(1);
  });

  it("does not look further than three days", () => {
    const run = scenario(
      [{ ref: "55-0-a", sold: "2026-02-10", lines: [{ character: "Gill Grunt", unit: 6 }] }],
      [ledgerSale({ id: 1, sold: "2026-02-14", net: 6, pieces: ["Gill Grunt"] })],
    );
    expect(rowFor(run, { orderRef: "55-0-a" }).category).toBe("external_only");
    expect(rowFor(run, { saleId: 1 }).category).toBe("ledger_only");
  });
});

describe("what cannot be compared", () => {
  const run = scenario(
    [{ ref: "66-0-a", sold: "2026-02-15", lines: [{ character: "Bash", unit: 5 }] }],
    [
      ledgerSale({ id: 1, sold: "2025-12-31", net: 25.74, pieces: ["Double Trouble", "Ignitor", "Ninjini", "Stealth Elf"] }),
      ledgerSale({ id: 2, sold: "2026-03-05", net: 9, pieces: ["Wham-Shell"] }),
      ledgerSale({ id: 3, sold: "2026-02-15", net: 5, isTest: true, pieces: ["Bash"] }),
      ledgerSale({ id: 4, sold: null, net: 5, pieces: ["Bash"] }),
      ledgerSale({ id: 5, sold: "2026-02-28", net: 7, pieces: ["Cynder"] }),
      ledgerSale({ id: 6, sold: "2026-02-20", net: 7, pieces: ["Cynder"] }),
    ],
  );

  it("keeps a sale before the reports apart — the order of 31 December is not counted as missing", () => {
    expect(rowFor(run, { saleId: 1 })).toMatchObject({ category: "not_comparable", entry: { reason: "before_coverage" } });
  });

  it("keeps a sale after the reports apart", () => {
    expect(rowFor(run, { saleId: 2 })).toMatchObject({ category: "not_comparable", entry: { reason: "after_coverage" } });
  });

  it("never matches a test sale", () => {
    expect(rowFor(run, { saleId: 3 })).toMatchObject({ category: "not_comparable", entry: { reason: "test" } });
    expect(rowFor(run, { orderRef: "66-0-a" }).category).toBe("external_only");
  });

  it("keeps a sale without a date apart", () => {
    expect(rowFor(run, { saleId: 4 })).toMatchObject({ category: "not_comparable", entry: { reason: "no_date" } });
  });

  it("does not call an unmatched sale on the last covered day missing", () => {
    expect(rowFor(run, { saleId: 5 })).toMatchObject({ category: "not_comparable", entry: { reason: "edge_day" } });
  });

  it("reports an unmatched sale well inside the period as SkyIsles-only", () => {
    expect(rowFor(run, { saleId: 6 }).category).toBe("ledger_only");
  });
});
