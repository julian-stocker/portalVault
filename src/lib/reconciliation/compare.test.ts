/**
 * The comparison words: green only for proof, red only for a recorded
 * deviation of a certain pair, and never a number for an unknown.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { compareMatch, PAIRED, toneOf, type FieldStatus } from "./compare";
import type { AtAnalysisValue, Category, Finding, Ledger, Match } from "./view";
import { CATEGORIES } from "./view";

const proven = (value: string | number, basis: "stored" | "derived" = "derived"): AtAnalysisValue => ({ value, basis });
const UNKNOWN: AtAnalysisValue = { value: null, basis: "unknown" };

const ledger = (over: Partial<Ledger> = {}, at: Partial<Ledger["atAnalysis"]> = {}): Ledger => ({
  state: "unchanged",
  version: { analysed: "v1", current: "v1" },
  current: {
    soldOn: "2026-03-12", itemsSubtotal: 12.5, discount: 0, itemsNet: 12.5, shipping: 4.99, refundsTotal: 0,
    cancelledOn: null, expectedTotal: 17.49, pieces: 1, externalOrderRef: "01-1", isTest: false,
  },
  atAnalysis: {
    soldOn: proven("2026-03-12"), itemsNet: proven(12.5), shipping: proven(4.99),
    expectedTotal: proven(17.49), pieces: proven(1), ...at,
  },
  ...over,
});

const finding = (field: Finding["field"], over: Partial<Finding> = {}): Finding => ({
  id: Math.floor(Math.random() * 1e6), key: field, field, kind: "deviation",
  shown: { ledger: "2026-03-14", external: "2026-03-12" }, delta: 2, causes: [],
  allowedDecisions: ["defer"], decision: null, applied: false, lock: null, ...over,
});

const match = (over: Partial<Match> = {}): Match => ({
  id: 41, category: "exact", certainty: "deterministic", score: 1, dateDelta: 0, competitors: [], reason: null,
  order: {
    id: 21, channel: "ebay", orderRef: "01-1", recordNo: 1, soldOn: "2026-03-12", paidOn: null, shippedOn: null,
    itemsValue: 12.5, shipping: 4.99, total: 17.49, pieces: 1, combined: false, destinationCountry: "DE",
    shippingService: null, sourceFile: "a.csv",
    lines: [{ lineRef: "1", listingId: "L1", title: "T", variant: null, name: "Testfigur", quantity: 1, unitPrice: 12.5, value: 12.5 }],
  },
  sale: { id: 362, soldOn: "2026-03-12", itemsSubtotal: 12.5, discount: 0, shipping: 4.99, cancelledOn: null, externalOrderRef: "01-1", source: "manual", stale: false },
  ledger: ledger(),
  findings: [],
  ...over,
});

const statusOf = (m: Match) => Object.fromEntries(compareMatch(m).fields.map((f) => [f.field, f.status])) as Record<string, FieldStatus>;

describe("only proof is green, only a settled deviation is red", () => {
  it("exact and every field derived: all match, the row is green", () => {
    const c = compareMatch(match());
    expect(c.fields.slice(0, 5).every((f) => f.status === "match")).toBe(true);
    expect(c.tone).toBe("match");
    expect(c.deviations).toBe(0);
  });

  it("a recorded deviation on a certain pair, kept as stored: red", () => {
    const m = match({ category: "deviating", certainty: "unique", findings: [finding("sold_on")],
      ledger: ledger({}, { soldOn: proven("2026-03-14", "stored") }) });
    expect(statusOf(m).sold_on).toBe("deviation");
    expect(compareMatch(m).tone).toBe("deviation");
    expect(compareMatch(m).deviations).toBe(1);
  });

  it("a recorded deviation the database could not confirm (unknown): neutral, never red", () => {
    const m = match({ category: "deviating", findings: [finding("items_net")], ledger: ledger({}, { itemsNet: UNKNOWN }) });
    expect(statusOf(m).items_net).toBe("unknown");
    expect(compareMatch(m).deviations).toBe(0);
  });

  it("no finding but no proof (the Staging session 3 case): unknown, not green — and the row is not green", () => {
    const m = match({ ledger: ledger({}, { itemsNet: UNKNOWN, shipping: UNKNOWN, expectedTotal: UNKNOWN }) });
    const s = statusOf(m);
    expect([s.items_net, s.shipping, s.total]).toEqual(["unknown", "unknown", "unknown"]);
    expect([s.sold_on, s.pieces]).toEqual(["match", "match"]);
    expect(compareMatch(m).tone).toBe("neutral");
  });

  it("unknown keeps value null — the screen gets no number to show", () => {
    const f = compareMatch(match({ ledger: ledger({}, { itemsNet: UNKNOWN }) })).fields.find((x) => x.field === "items_net")!;
    expect(f.atAnalysis).toEqual({ value: null, basis: "unknown" });
  });

  it("a probable pair: its differences are unconfirmed, never a settled deviation", () => {
    const m = match({ category: "probable", certainty: "probable", findings: [finding("shipping"), finding("figure", { shown: { ledger: "A", external: "B" } })],
      ledger: ledger({}, { shipping: proven(5.49, "stored") }) });
    const c = compareMatch(m);
    expect(statusOf(m).shipping).toBe("unconfirmed_deviation");
    expect(c.figures.status).toBe("unconfirmed_deviation");
    expect(c.deviations).toBe(0);
    expect(c.tone).toBe("neutral");
    expect(c.uncertain).toBe(true);
  });
});

describe("changed sales: no derived value survives, a stored one stays the recorded value", () => {
  it("changed with stored sold_on and every other field unknown (the Staging session 2 case)", () => {
    const m = match({ category: "deviating", findings: [finding("sold_on")],
      ledger: ledger({ state: "changed", version: { analysed: "v1", current: "v2" } },
        { soldOn: proven("2026-03-14", "stored"), itemsNet: UNKNOWN, shipping: UNKNOWN, expectedTotal: UNKNOWN, pieces: UNKNOWN }) });
    const c = compareMatch(m);
    expect(c.state).toBe("changed");
    expect(statusOf(m)).toMatchObject({ sold_on: "deviation", items_net: "unknown", shipping: "unknown", total: "unknown", pieces: "unknown" });
    expect(c.fields[0].atAnalysis?.basis).toBe("stored");
  });

  it("the current value is shown as today's, never as the value at analysis", () => {
    const m = match({ ledger: ledger({ state: "changed", current: { ...ledger().current, itemsNet: 99 } }, { itemsNet: UNKNOWN }) });
    const f = compareMatch(m).fields.find((x) => x.field === "items_net")!;
    expect(f.current).toBe(99);
    expect(f.atAnalysis?.value).toBeNull();
  });
});

describe("every category", () => {
  it("PAIRED is exactly exact, deviating, probable", () => {
    expect(CATEGORIES.filter((c) => PAIRED.has(c))).toEqual(["exact", "deviating", "probable"]);
  });

  it("external_only: the report side only, nothing compared", () => {
    const c = compareMatch(match({ category: "external_only", certainty: null, sale: null, ledger: null }));
    expect(c.paired).toBe(false);
    expect(c.fields.every((f) => f.status === "not_compared" && f.current === null && f.atAnalysis === null)).toBe(true);
    expect(c.fields[0].csv).toBe("2026-03-12");
    expect(c.tone).toBe("neutral");
  });

  it("ledger_only and not_comparable: the SkyIsles side only, nothing compared", () => {
    for (const category of ["ledger_only", "not_comparable"] as Category[]) {
      const c = compareMatch(match({ category, certainty: null, order: null,
        ledger: ledger({}, { soldOn: UNKNOWN, itemsNet: UNKNOWN, shipping: UNKNOWN, expectedTotal: UNKNOWN, pieces: UNKNOWN }) }));
      expect(c.fields.every((f) => f.status === "not_compared" && f.csv === null)).toBe(true);
      expect(c.fields[1].current).toBe(12.5);
      expect(c.figures.lines).toBeNull();
    }
  });

  it("ambiguous: even with an order and a sale, nothing is compared", () => {
    const c = compareMatch(match({ category: "ambiguous", certainty: "ambiguous", findings: [finding("sold_on")],
      competitors: [{ orderRef: "01-2", saleId: 363, score: 0.8 }] }));
    expect(c.paired).toBe(false);
    expect(c.fields.every((f) => f.status === "not_compared")).toBe(true);
    expect(c.deviations).toBe(0);
  });

  it("each category gets a tone, and only exact or deviating can be coloured", () => {
    for (const category of CATEGORIES) {
      const tone = compareMatch(match({ category, findings: category === "deviating" ? [finding("sold_on")] : [],
        ledger: ledger({}, { soldOn: proven(category === "deviating" ? "2026-03-14" : "2026-03-12", category === "deviating" ? "stored" : "derived") }) })).tone;
      expect(tone, category).toBe(category === "exact" ? "match" : category === "deviating" ? "deviation" : "neutral");
    }
  });
});

describe("order number and figures", () => {
  it("a missing order number in SkyIsles is an addition, neutral", () => {
    const m = match({ findings: [finding("external_order_ref", { kind: "addition", shown: { ledger: null, external: "01-1" } })] });
    expect(statusOf(m).external_order_ref).toBe("addition");
    expect(toneOf("addition")).toBe("neutral");
  });

  it("figures without a finding: no finding reported — not green, no proof exists", () => {
    expect(compareMatch(match()).figures.status).toBe("no_finding");
    expect(toneOf("no_finding")).toBe("neutral");
  });

  it("a figure finding on a certain pair counts once, however many slots", () => {
    const c = compareMatch(match({ category: "deviating", findings: [
      finding("figure", { shown: { ledger: "A", external: "B" } }), finding("figure", { shown: { ledger: null, external: "C" } }),
    ] }));
    expect(c.figures.status).toBe("deviation");
    expect(c.figures.findings).toHaveLength(2);
    expect(c.deviations).toBe(1);
  });
});

describe("no second comparison", () => {
  const SRC = readFileSync("src/lib/reconciliation/compare.ts", "utf8");

  it("never compares a report value with a SkyIsles value, and never computes one", () => {
    // No arithmetic and no equality on values: the words come from findings and bases only.
    expect(SRC).not.toMatch(/\.csv\s*[!=]==|current\s*[!=]==|itemsValue\s*[-+]|Math\.abs|roundMoney|diffPair/);
  });

  it("values that disagree but carry no finding stay what the database proved", () => {
    // A report and SkyIsles value differ, but the database proved `derived`: the
    // screen does not overrule it — the analysis is the one that compares.
    const m = match({ ledger: ledger({ current: { ...ledger().current, shipping: 9 } }) });
    expect(statusOf(m).shipping).toBe("match");
  });
});
