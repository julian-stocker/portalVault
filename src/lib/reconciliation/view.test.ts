import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { de } from "@/lib/i18n/de";
import {
  CATEGORIES, CAUSE_CODES, CERTAINTIES, DECISIONS, FINDING_FIELDS, FINDING_KINDS, NOT_COMPARABLE_REASONS,
  REPORT_ISSUE_CODES, SESSION_STATES, ViewContractError,
  pageRequest, sessionListView, sessionPageView, summaryView,
  type PageRequest,
} from "./view";

const copy = de.business.reconciliation;
const SCHEMA = readFileSync("supabase/migrations/0169_sales_reconciliation_schema.sql", "utf8");
const RPCS = readFileSync("supabase/migrations/0172_sales_reconciliation_rpcs.sql", "utf8");
const VIEW = readFileSync("src/lib/reconciliation/view.ts", "utf8");

// ---------------------------------------------------------------------------
// Fixtures in exactly the shape 0172 builds — synthetic, no real report data.
// ---------------------------------------------------------------------------

const SUMMARY = {
  categories: { exact: 2, deviating: 1, probable: 0, ambiguous: 0, external_only: 0, ledger_only: 0, not_comparable: 1 },
  byMonth: { "2026-03": { exact: 2, deviating: 1, probable: 0, ambiguous: 0, external_only: 0, ledger_only: 0, not_comparable: 1 } },
  money: {
    items_net: { positive: 0, negative: -1.5, balance: -1.5, count: 1 },
    shipping: { positive: 0, negative: 0, balance: 0, count: 0 },
    total: { positive: 0, negative: -1.5, balance: -1.5, count: 1 },
  },
  deviations: { sold_on: 1, items_net: 1, shipping: 0, pieces: 0, figure: 0, total: 1 },
  referenceAdditions: 3,
};

const listRow = (over: Record<string, unknown> = {}) => ({
  id: 7, channel: "ebay", state: "open", coveredFrom: "2026-03-01", coveredTo: "2026-03-31", chainComplete: true,
  createdAt: "2026-11-03T10:00:00.123+00:00", closedAt: null, discardedAt: null, snapshotsPurgedAt: null,
  summary: SUMMARY, files: 2, decided: 1, applied: 0, ...over,
});

const sessionRow = (over: Record<string, unknown> = {}) => ({
  id: 7, channel: "ebay", parser: "ebay-orders-de", parser_version: 1, state: "open",
  files_key: "a".repeat(64), covered_from: "2026-03-01", covered_to: "2026-03-31",
  record_first: 1061, record_last: 1070, chain_complete: true, summary: SUMMARY,
  created_at: "2026-11-03T10:00:00.123+00:00", closed_at: null, discarded_at: null, snapshots_purged_at: null, ...over,
});

const fileRow = {
  id: 11, session_id: 7, file_name: "orders-2026-03.csv", fingerprint: "b".repeat(64), footer_count: 3,
  orders: 3, first_sold_on: "2026-03-01", last_sold_on: "2026-03-30", record_first: 1061, record_last: 1070,
};

const orderRow = (over: Record<string, unknown> = {}) => ({
  id: 21, channel: "ebay", order_ref: "01-00001-00001", record_no: 1061, sold_on: "2026-03-12",
  paid_on: "2026-03-12", shipped_on: "2026-03-13", items_value: 12.5, shipping: 4.99, total: 17.49, pieces: 1,
  combined: false, destination_country: "DE", shipping_service: "Brief", source_file: "orders-2026-03.csv",
  lines: [{ lineRef: "T1", listingId: "L1", title: "Testfigur A", variant: null, name: "Testfigur A", quantity: 1, unitPrice: 12.5, value: 12.5 }],
  ...over,
});

const saleRow = (over: Record<string, unknown> = {}) => ({
  id: 362, soldOn: "2026-03-14", itemsSubtotal: 14, discount: 0, shipping: 4.99, cancelledOn: null,
  externalOrderRef: null, source: "manual", stale: false, ...over,
});

const findingRow = (over: Record<string, unknown> = {}) => ({
  id: 31, key: "sold_on", field: "sold_on", kind: "deviation", ledger: "2026-03-14", external: "2026-03-12", delta: 2,
  causes: [{ code: "matches_shipping_date" }], allowedDecisions: ["take_external", "keep_ledger", "manual", "defer"],
  decision: null, applied: false, ...over,
});

const matchRow = (over: Record<string, unknown> = {}) => ({
  id: 41, category: "deviating", certainty: "unique", score: 0.912, dateDelta: 2, competitors: [], reason: null,
  order: orderRow(), sale: saleRow(), findings: [findingRow()], ...over,
});

const pageAnswer = (over: Record<string, unknown> = {}) => ({
  session: sessionRow(), files: [fileRow], total: 1, matches: [matchRow()], ...over,
});

const FIRST: PageRequest = { category: null, offset: 0, limit: 50 };

/** A copy of `o` without `key` — for "this field is missing". */
function without(o: Record<string, unknown>, key: string): Record<string, unknown> {
  const copyOf = { ...o };
  delete copyOf[key];
  return copyOf;
}

/** Run `fn` and return the contract error's path. */
function pathOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof ViewContractError) return error.path;
    throw error;
  }
  throw new Error("no ViewContractError");
}

// ---------------------------------------------------------------------------

describe("the vocabularies are exactly the database's", () => {
  /** The quoted words of one CHECK constraint in 0169. */
  const constraintList = (name: string): string[] => {
    const start = SCHEMA.indexOf(`constraint ${name} check`);
    expect(start, name).toBeGreaterThan(-1);
    const body = SCHEMA.slice(start, SCHEMA.indexOf("),", start) + 1);
    return [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  };

  it.each([
    ["sales_recon_sessions_state_known", SESSION_STATES],
    ["sales_recon_matches_category_known", CATEGORIES],
    ["sales_recon_matches_certainty_known", CERTAINTIES],
    ["sales_recon_matches_reason_known", NOT_COMPARABLE_REASONS],
    ["sales_recon_findings_field_known", FINDING_FIELDS],
    ["sales_recon_findings_kind_known", FINDING_KINDS],
    ["sales_recon_decisions_known", DECISIONS],
  ])("%s", (name, list) => {
    expect([...constraintList(name)].sort()).toEqual([...list].sort());
  });

  it("the manual actions in the copy are the ones seller_recon_decide accepts", () => {
    for (const action of ["refund", "cancel", "none", "clarify"]) expect(RPCS).toContain(`'${action}'`);
    expect(Object.keys(copy.manualActions).sort()).toEqual(["cancel", "clarify", "none", "refund"]);
  });
});

describe("every code has its German text — and no text lacks a code", () => {
  const texts = (record: Record<string, unknown>) => Object.entries(record);
  const nonEmpty = (v: unknown) =>
    typeof v === "string" ? v.trim().length > 0 : typeof v === "function" && String((v as (a: string) => string)("1,00 €")).length > 0;

  it.each([
    ["states", copy.states, SESSION_STATES],
    ["categories", copy.categories, CATEGORIES],
    ["categoryHints", copy.categoryHints, CATEGORIES],
    ["certainties", copy.certainties, CERTAINTIES],
    ["notComparableReasons", copy.notComparableReasons, NOT_COMPARABLE_REASONS],
    ["fields", copy.fields, FINDING_FIELDS],
    ["findingKinds", copy.findingKinds, FINDING_KINDS],
    ["causes", copy.causes, CAUSE_CODES],
    ["decisions", copy.decisions, DECISIONS],
    ["reportIssues", copy.reportIssues, REPORT_ISSUE_CODES],
    ["locks", copy.locks, ["session_not_open", "applied", "stale"]],
  ] as const)("%s", (_, record, codes) => {
    expect(Object.keys(record).sort()).toEqual([...codes].sort());
    for (const [code, text] of texts(record)) expect(nonEmpty(text), code).toBe(true);
  });

  it("parse failures cover every ParseFailure code", () => {
    const types = readFileSync("src/lib/reconciliation/types.ts", "utf8");
    const block = types.slice(types.indexOf("export type ParseFailure"), types.indexOf("export type ParseResult"));
    const codes = [...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(Object.keys(copy.parseFailures).sort()).toEqual(codes.sort());
  });

  it("causes that carry an amount put it into the sentence", () => {
    expect(copy.causes.report_total_reduced("6,99 €")).toContain("6,99 €");
    expect(copy.causes.ledger_discount_not_in_report("2,00 €")).toContain("2,00 €");
    expect(copy.causes.ledger_refund_not_in_report("3,00 €")).toContain("3,00 €");
    expect(copy.causes.report_total_increased("1,00 €")).toContain("1,00 €");
  });
});

describe("seller_recon_sessions()", () => {
  it("maps a valid answer", () => {
    const [s] = sessionListView([listRow()]);
    expect(s).toEqual({
      id: 7, channel: "ebay", state: "open", coveredFrom: "2026-03-01", coveredTo: "2026-03-31", chainComplete: true,
      createdAt: "2026-11-03T10:00:00.123+00:00", closedAt: null, discardedAt: null, snapshotsPurgedAt: null,
      summary: SUMMARY, files: 2, decided: 1, applied: 0,
    });
  });

  it("an empty list is an empty list", () => {
    expect(sessionListView([])).toEqual([]);
  });

  it("refuses a non-list, a missing field, an unknown state, a wrong type", () => {
    expect(pathOf(() => sessionListView(null))).toBe("sessions");
    expect(pathOf(() => sessionListView({}))).toBe("sessions");
    expect(pathOf(() => sessionListView([without(listRow(), "applied")]))).toBe("sessions[0].applied");
    expect(pathOf(() => sessionListView([listRow({ state: "archived" })]))).toBe("sessions[0].state");
    expect(pathOf(() => sessionListView([listRow({ chainComplete: "yes" })]))).toBe("sessions[0].chainComplete");
    expect(pathOf(() => sessionListView([listRow({ files: 1.5 })]))).toBe("sessions[0].files");
    expect(pathOf(() => sessionListView([listRow(), "x"]))).toBe("sessions[1]");
  });

  it("accepts a bigint delivered as a numeric string", () => {
    expect(sessionListView([listRow({ id: "7" })])[0].id).toBe(7);
  });

  it("names the path, never the value", () => {
    try {
      sessionListView([listRow({ channel: { secret: "Erika Mustermann" } })]);
    } catch (error) {
      expect(String((error as Error).message)).not.toContain("Erika");
      return;
    }
    throw new Error("expected a refusal");
  });
});

describe("the summary is shown, not trusted", () => {
  it("a valid summary is mapped", () => {
    expect(summaryView(SUMMARY)).toEqual(SUMMARY);
  });

  it.each([
    ["missing", null],
    ["empty", {}],
    ["a category missing", { ...SUMMARY, categories: { exact: 1 } }],
    ["a money field missing", { ...SUMMARY, money: { items_net: SUMMARY.money.items_net } }],
    ["a text instead of a number", { ...SUMMARY, referenceAdditions: "3" }],
    ["a month with a gap", { ...SUMMARY, byMonth: { "2026-03": { exact: 1 } } }],
  ])("%s → no summary, the session still opens", (_, summary) => {
    expect(summaryView(summary)).toBeNull();
    expect(sessionListView([listRow({ summary })])[0].summary).toBeNull();
  });
});

describe("seller_recon_session()", () => {
  it("maps snake_case session, files and order, camelCase match, sale and findings", () => {
    const view = sessionPageView(pageAnswer(), FIRST);
    expect(view.session).toMatchObject({
      id: 7, parser: "ebay-orders-de", parserVersion: 1, state: "open",
      coveredFrom: "2026-03-01", recordFirst: 1061, chainComplete: true, snapshotsPurgedAt: null,
    });
    expect(view.files).toEqual([{
      id: 11, fileName: "orders-2026-03.csv", fingerprint: "b".repeat(64), footerCount: 3, orders: 3,
      firstSoldOn: "2026-03-01", lastSoldOn: "2026-03-30", recordFirst: 1061, recordLast: 1070,
    }]);
    const [m] = view.matches;
    expect(m.order).toMatchObject({ orderRef: "01-00001-00001", soldOn: "2026-03-12", itemsValue: 12.5, sourceFile: "orders-2026-03.csv" });
    expect(m.order?.lines?.[0]).toMatchObject({ listingId: "L1", unitPrice: 12.5 });
    expect(m.sale).toMatchObject({ id: 362, soldOn: "2026-03-14", stale: false });
    expect(m.findings[0]).toMatchObject({
      id: 31, key: "sold_on", field: "sold_on", kind: "deviation", delta: 2,
      causes: [{ code: "matches_shipping_date", known: true, amount: null }], lock: null,
    });
  });

  it("does not carry fields the screen has no use for (files_key, session_id)", () => {
    const view = sessionPageView(pageAnswer(), FIRST);
    expect(view.session).not.toHaveProperty("files_key");
    expect(view.session).not.toHaveProperty("filesKey");
    expect(view.files[0]).not.toHaveProperty("sessionId");
  });

  it("refuses the wrong convention instead of guessing", () => {
    expect(pathOf(() => sessionPageView(pageAnswer({ session: listRow() }), FIRST))).toBe("session.parser");
    expect(pathOf(() => sessionPageView(pageAnswer({ files: [{ ...fileRow, file_name: undefined, fileName: "x.csv" }] }), FIRST)))
      .toBe("files[0].file_name");
  });

  it("an external-only match has no sale, a ledger-only one no order, and purged lines are null", () => {
    const view = sessionPageView(pageAnswer({
      total: 3,
      matches: [
        matchRow({ id: 42, category: "external_only", certainty: null, score: null, dateDelta: null, sale: null, findings: [] }),
        matchRow({ id: 43, category: "not_comparable", certainty: null, score: null, dateDelta: null, reason: "edge_day", order: null, findings: [] }),
        matchRow({ id: 44, order: orderRow({ lines: null }) }),
      ],
    }), FIRST);
    expect(view.matches[0].sale).toBeNull();
    expect(view.matches[1].order).toBeNull();
    expect(view.matches[1].reason).toBe("edge_day");
    expect(view.matches[2].order?.lines).toBeNull();
  });

  it("competitors are read with their three fields", () => {
    const view = sessionPageView(pageAnswer({
      matches: [matchRow({ category: "ambiguous", certainty: "ambiguous", competitors: [{ orderRef: "01-2", saleId: 363, score: 0.8 }] })],
    }), FIRST);
    expect(view.matches[0].competitors).toEqual([{ orderRef: "01-2", saleId: 363, score: 0.8 }]);
  });

  it.each([
    ["an unknown category", matchRow({ category: "maybe" }), "matches[0].category"],
    ["an unknown reason", matchRow({ reason: "weather" }), "matches[0].reason"],
    ["findings missing", without(matchRow(), "findings"), "matches[0].findings"],
    ["a sale without stale", matchRow({ sale: without(saleRow(), "stale") }), "matches[0].sale.stale"],
    ["an order without its number", matchRow({ order: orderRow({ order_ref: null }) }), "matches[0].order.order_ref"],
    ["a line that is not an object", matchRow({ order: orderRow({ lines: ["x"] }) }), "matches[0].order.lines[0]"],
  ])("refuses %s", (_, raw, path) => {
    expect(pathOf(() => sessionPageView(pageAnswer({ matches: [raw] }), FIRST))).toBe(path);
  });

  it("refuses a missing total, session or matches list", () => {
    expect(pathOf(() => sessionPageView(without(pageAnswer(), "total"), FIRST))).toBe("page.total");
    expect(pathOf(() => sessionPageView(without(pageAnswer(), "session"), FIRST))).toBe("page.session");
    expect(pathOf(() => sessionPageView(pageAnswer({ matches: null }), FIRST))).toBe("matches");
    expect(pathOf(() => sessionPageView(null, FIRST))).toBe("page");
  });
});

describe("findings: decisions, shown values, locks", () => {
  const finding = (over: Record<string, unknown>, match: Record<string, unknown> = {}, session: Record<string, unknown> = {}) =>
    sessionPageView(pageAnswer({ session: sessionRow(session), matches: [matchRow({ findings: [findingRow(over)], ...match })] }), FIRST)
      .matches[0].findings[0];

  it("offers exactly the decisions the database allows, in its order", () => {
    expect(finding({ field: "total", key: "total", allowedDecisions: ["manual", "keep_ledger", "defer"] }).allowedDecisions)
      .toEqual(["manual", "keep_ledger", "defer"]);
    expect(finding({ field: "external_order_ref", key: "external_order_ref", kind: "addition", allowedDecisions: ["take_external", "keep_ledger", "defer"] }).allowedDecisions)
      .toEqual(["take_external", "keep_ledger", "defer"]);
  });

  it("takes allowedDecisions from the answer, never from diff.ts", () => {
    // pieces: diff.ts would offer all four; the database only these three (sales_recon_allowed).
    expect(finding({ field: "pieces", key: "pieces", ledger: 2, external: 1, allowedDecisions: ["manual", "keep_ledger", "defer"] }).allowedDecisions)
      .toEqual(["manual", "keep_ledger", "defer"]);
    // Types only: no matching, diffing or counting code is reachable from here.
    expect(VIEW).not.toMatch(/^import (?!type )/m);
  });

  it("refuses an unknown or an empty decision list", () => {
    expect(pathOf(() => finding({ allowedDecisions: ["take_external", "overwrite"] }))).toBe("matches[0].findings[0].allowedDecisions[1]");
    expect(pathOf(() => finding({ allowedDecisions: [] }))).toBe("matches[0].findings[0].allowedDecisions");
    expect(pathOf(() => finding({ allowedDecisions: "manual" }))).toBe("matches[0].findings[0].allowedDecisions");
  });

  it("keeps the shown values exactly as they arrived — for the PT409 comparison", () => {
    const cases: [unknown, unknown][] = [["2026-03-14", "2026-03-12"], [14, 12.5], [0.1 + 0.2, 0.3], [null, "01-00001-00001"], ["Testfigur A", null]];
    for (const [ledger, external] of cases) {
      const f = finding({ ledger, external });
      expect(Object.is(f.shown.ledger, ledger)).toBe(true);
      expect(Object.is(f.shown.external, external)).toBe(true);
      expect(JSON.stringify(f.shown)).toBe(JSON.stringify({ ledger, external }));
    }
  });

  it("does not turn a numeric string into a number in the shown values", () => {
    const f = finding({ ledger: "14.00", external: "12.50" });
    expect(f.shown).toEqual({ ledger: "14.00", external: "12.50" });
  });

  it("the shown values cannot be changed afterwards", () => {
    const f = finding({});
    expect(Object.isFrozen(f.shown)).toBe(true);
  });

  it("refuses a structure as a shown value", () => {
    expect(pathOf(() => finding({ ledger: { value: 1 } }))).toBe("matches[0].findings[0].ledger");
    expect(pathOf(() => finding({ external: [1] }))).toBe("matches[0].findings[0].external");
    expect(pathOf(() => sessionPageView(pageAnswer({ matches: [matchRow({ findings: [without(findingRow(), "ledger")] })] }), FIRST)))
      .toBe("matches[0].findings[0].ledger");
  });

  it("reads the current decision, and keeps an unknown cause as unknown", () => {
    const f = finding({
      field: "total", key: "total", allowedDecisions: ["manual", "keep_ledger", "defer"],
      causes: [{ code: "report_total_reduced", amount: 6.99 }, { code: "new_reading" }],
      decision: { id: 51, decision: "manual", manualValue: { action: "refund", amount: 6.99, reason: "versandkorrektur" }, reason: "Porto", decidedAt: "2026-11-03T11:00:00+00:00" },
    });
    expect(f.causes).toEqual([
      { code: "report_total_reduced", known: true, amount: 6.99 },
      { code: "new_reading", known: false, amount: null },
    ]);
    expect(f.decision).toEqual({
      id: 51, decision: "manual", manualValue: { action: "refund", amount: 6.99, reason: "versandkorrektur" },
      reason: "Porto", decidedAt: "2026-11-03T11:00:00+00:00",
    });
    expect(pathOf(() => finding({ decision: { id: 1, decision: "maybe", manualValue: null, reason: null, decidedAt: "x" } })))
      .toBe("matches[0].findings[0].decision.decision");
  });

  it("a stale sale locks its findings — and the flag comes from the database", () => {
    const stale = sessionPageView(pageAnswer({ matches: [matchRow({ sale: saleRow({ stale: true }), findings: [findingRow(), findingRow({ id: 32, key: "shipping", field: "shipping" })] })] }), FIRST);
    expect(stale.matches[0].sale?.stale).toBe(true);
    expect(stale.matches[0].findings.map((f) => f.lock)).toEqual(["stale", "stale"]);
    expect(finding({}, { sale: saleRow({ stale: false }) }).lock).toBeNull();
  });

  it("restates the database's refusals in its order: session, applied, stale", () => {
    expect(finding({ applied: true }, { sale: saleRow({ stale: true }) }, { state: "closed", closed_at: "2026-11-03T12:00:00+00:00" }).lock)
      .toBe("session_not_open");
    expect(finding({ applied: true }, { sale: saleRow({ stale: true }) }).lock).toBe("applied");
    expect(finding({}, {}, { state: "discarded", discarded_at: "2026-11-03T12:00:00+00:00" }).lock).toBe("session_not_open");
  });
});

describe("paging", () => {
  const page = (total: number, request: PageRequest) =>
    sessionPageView(pageAnswer({ total, matches: [] }), request).page;

  it("the first of several pages", () => {
    expect(page(120, { category: null, offset: 0, limit: 50 })).toEqual({
      category: null, offset: 0, limit: 50, total: 120, page: 1, pages: 3, previousOffset: null, nextOffset: 50,
    });
  });

  it("a middle and the last page", () => {
    expect(page(120, { category: "deviating", offset: 50, limit: 50 })).toMatchObject({ page: 2, previousOffset: 0, nextOffset: 100, category: "deviating" });
    expect(page(120, { category: null, offset: 100, limit: 50 })).toMatchObject({ page: 3, pages: 3, previousOffset: 50, nextOffset: null });
  });

  it("exactly one full page has no next page; nothing at all is one empty page", () => {
    expect(page(50, { category: null, offset: 0, limit: 50 })).toMatchObject({ pages: 1, nextOffset: null });
    expect(page(0, { category: null, offset: 0, limit: 50 })).toMatchObject({ page: 1, pages: 1, previousOffset: null, nextOffset: null });
  });

  it("a page beyond the end still says where the last one is", () => {
    expect(page(10, { category: null, offset: 100, limit: 50 })).toMatchObject({ page: 3, pages: 1, previousOffset: 50, nextOffset: null });
  });

  it("reads the page from the URL and always asks within the function's limits", () => {
    expect(pageRequest({})).toEqual({ category: null, offset: 0, limit: 50 });
    expect(pageRequest({ kategorie: "deviating", seite: "3" })).toEqual({ category: "deviating", offset: 100, limit: 50 });
    expect(pageRequest({ kategorie: "drop table", seite: "-1" })).toEqual({ category: null, offset: 0, limit: 50 });
    expect(pageRequest({ seite: "0" }).offset).toBe(0);
    expect(pageRequest({ seite: "2.5" }).offset).toBe(0);
    expect(pageRequest({ seite: "1e3" }).offset).toBe(0);
    expect(pageRequest({}, 500).limit).toBe(200);
    expect(pageRequest({}, 0).limit).toBe(1);
    expect(pageRequest({}, Number.NaN).limit).toBe(50);
  });
});
