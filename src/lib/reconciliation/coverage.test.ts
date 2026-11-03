import { describe, expect, it } from "vitest";
import { chainGaps, coverageOf, fileCoverage, judgeDay, recordsConsumed } from "./coverage";
import { mergeReports } from "./dedupe";
import { parseEbayOrdersReport } from "./ebay/parse";
import { ebayReport, type FixtureOrder } from "./testing/ebay-fixture";
import type { ExternalReport } from "./types";

const one = (ref: string, record: number, sold: string): FixtureOrder =>
  ({ ref, record, sold, lines: [{ character: "Swarm", unit: 3 }] });
const many = (ref: string, record: number, sold: string, positions: number): FixtureOrder =>
  ({ ref, record, sold, lines: Array.from({ length: positions }, (_, i) => ({ character: `Figur ${i}`, unit: 1 })) });

function report(orders: FixtureOrder[], fileName: string, footer?: number | null): ExternalReport {
  const result = parseEbayOrdersReport(ebayReport(orders, { footer }), fileName);
  if (!result.ok) throw new Error(result.error.code);
  return result.report;
}

describe("the record number chain", () => {
  it("counts n + 1 numbers for an order of n positions, 1 for a single one", () => {
    const [single, combined] = report([one("00-0-1", 1, "2026-03-01"), many("00-0-2", 5, "2026-03-01", 4)], "a").orders;
    expect(recordsConsumed(single)).toBe(1);
    expect(recordsConsumed(combined)).toBe(5);
  });

  it("is complete when every jump is explained by the next order's positions", () => {
    // 1498 → 1513 between March and April 2026: the next order had 14 positions.
    const orders = report([one("00-0-1", 1498, "2026-03-31"), many("00-0-2", 1513, "2026-04-03", 14)], "a").orders;
    expect(chainGaps(orders)).toEqual([]);
  });

  it("finds a real gap and names its days and size", () => {
    const orders = report([one("00-0-1", 100, "2026-05-01"), one("00-0-2", 103, "2026-05-04")], "a").orders;
    expect(chainGaps(orders)).toEqual([{
      afterRecord: 100, afterSoldOn: "2026-05-01", beforeRecord: 103, beforeSoldOn: "2026-05-04", missingNumbers: 2,
    }]);
  });

  it("reports two orders claiming the same numbers as a negative gap", () => {
    const orders = report([one("00-0-1", 100, "2026-05-01"), many("00-0-2", 102, "2026-05-01", 3)], "a").orders;
    expect(chainGaps(orders)[0].missingNumbers).toBe(-2);
  });
});

describe("fileCoverage", () => {
  it("compares the footer with the orders actually read", () => {
    expect(fileCoverage(report([one("00-0-1", 1, "2026-03-01")], "a")).footerMatches).toBe(true);
    expect(fileCoverage(report([one("00-0-1", 1, "2026-03-01")], "a", 2)).footerMatches).toBe(false);
    expect(fileCoverage(report([one("00-0-1", 1, "2026-03-01")], "a", null)).footerMatches).toBeNull();
  });

  it("names the period and every month a file touches", () => {
    const c = fileCoverage(report([one("00-0-1", 1, "2026-03-31"), one("00-0-2", 2, "2026-04-01")], "a"));
    expect([c.firstSoldOn, c.lastSoldOn]).toEqual(["2026-03-31", "2026-04-01"]);
    expect(c.months).toEqual({ "2026-03": 1, "2026-04": 1 });
  });
});

describe("coverageOf several files", () => {
  const march = report([one("00-0-1", 10, "2026-03-02"), one("00-0-2", 11, "2026-03-30")], "march");
  const april = report([one("00-0-3", 12, "2026-04-02"), one("00-0-4", 13, "2026-04-28")], "april");

  it("checks the chain across file borders", () => {
    const merged = mergeReports([{ report: march, fingerprint: "m" }, { report: april, fingerprint: "a" }]);
    const c = coverageOf([march, april], merged.orders);
    expect(c.chainComplete).toBe(true);
    expect([c.firstSoldOn, c.lastSoldOn, c.recordFirst, c.recordLast]).toEqual(["2026-03-02", "2026-04-28", 10, 13]);
    expect(c.overlappingFiles).toEqual([]);
  });

  it("finds a gap between two files", () => {
    const may = report([one("00-0-9", 20, "2026-05-03")], "may");
    const merged = mergeReports([{ report: march, fingerprint: "m" }, { report: may, fingerprint: "y" }]);
    const c = coverageOf([march, may], merged.orders);
    expect(c.chainComplete).toBe(false);
    expect(c.gaps[0]).toMatchObject({ afterRecord: 11, beforeRecord: 20, missingNumbers: 8 });
  });

  it("names files whose periods overlap", () => {
    const late = report([one("00-0-2", 11, "2026-03-30"), one("00-0-3", 12, "2026-04-02")], "late");
    const merged = mergeReports([{ report: march, fingerprint: "m" }, { report: late, fingerprint: "l" }]);
    expect(coverageOf([march, late], merged.orders).overlappingFiles).toEqual([{ a: "march", b: "late" }]);
  });
});

describe("judgeDay", () => {
  const march = report([one("00-0-1", 10, "2026-03-02"), one("00-0-2", 13, "2026-03-20"), one("00-0-3", 14, "2026-03-30")], "m");
  const c = coverageOf([march], march.orders);

  it("says no outside the covered period", () => {
    expect(judgeDay(c, "2026-03-01")).toEqual({ comparable: false, reason: "before_coverage" });
    expect(judgeDay(c, "2026-03-31")).toEqual({ comparable: false, reason: "after_coverage" });
    expect(judgeDay(c, null)).toEqual({ comparable: false, reason: "no_coverage" });
  });

  it("says no inside a chain gap, edges of the gap included", () => {
    expect(judgeDay(c, "2026-03-02")).toEqual({ comparable: false, reason: "inside_gap" });
    expect(judgeDay(c, "2026-03-10")).toEqual({ comparable: false, reason: "inside_gap" });
    expect(judgeDay(c, "2026-03-20")).toEqual({ comparable: false, reason: "inside_gap" });
  });

  it("says yes after the gap, and marks the last covered day as an edge", () => {
    expect(judgeDay(c, "2026-03-25")).toEqual({ comparable: true, edge: false });
    expect(judgeDay(c, "2026-03-30")).toEqual({ comparable: true, edge: true });
  });
});
