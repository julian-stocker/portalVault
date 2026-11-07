/**
 * /business/orderbuch/abgleich/<id> — the comparison page: its gates, its
 * states, the paging and the filter, and what it must never show or offer.
 * Rendered on the server the way Next renders it (static markup).
 */
import { readFileSync } from "node:fs";

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionPageResult } from "@/lib/reconciliation/server/queries";
import { sessionPageView, type PageRequest } from "@/lib/reconciliation/view";

const MOCK = vi.hoisted(() => ({
  environment: true,
  result: null as unknown as SessionPageResult,
  calls: [] as { id: number; request: unknown }[],
}));
vi.mock("@/lib/reconciliation/server/queries", () => ({
  reconciliationEnvironment: () => MOCK.environment,
  fetchReconciliationSession: async (id: number, request: unknown) => { MOCK.calls.push({ id, request }); return MOCK.result; },
}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));
// The client blocks import the actions; a static render never calls them.
vi.mock("@/lib/reconciliation/server/actions", () => ({ confirmReconciliation: vi.fn(), closeReconciliation: vi.fn() }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children),
}));

const { default: SessionPage } = await import("./page");
const { de } = await import("@/lib/i18n/de");
const copy = de.business.reconciliation;
const t = copy.detail;

const PAGE = readFileSync("src/app/(business)/business/orderbuch/abgleich/[id]/page.tsx", "utf8");
const COMPONENTS = ["session-detail.tsx", "match-comparison.tsx"]
  .map((f) => readFileSync(`src/components/business/reconciliation/${f}`, "utf8")).join("\n");

// ---------------------------------------------------------------------------
// Synthetic answers in the shape of seller_recon_session (0172, ledger 0179)
// ---------------------------------------------------------------------------

const SUMMARY = {
  categories: { exact: 1, deviating: 1, probable: 1, ambiguous: 1, external_only: 1, ledger_only: 1, not_comparable: 1 },
  byMonth: {},
  money: {
    items_net: { positive: 0, negative: 0, balance: 0, count: 0 },
    shipping: { positive: 0, negative: 0, balance: 0, count: 0 },
    total: { positive: 0, negative: 0, balance: 0, count: 0 },
  },
  deviations: { sold_on: 1, items_net: 0, shipping: 0, pieces: 0, figure: 0, total: 0 },
  referenceAdditions: 0,
};
const session = (over: Record<string, unknown> = {}) => ({
  id: 3, channel: "ebay", parser: "ebay-orders-report-de", parser_version: 1, state: "closed",
  covered_from: "2026-01-01", covered_to: "2026-01-31", record_first: 1061, record_last: 1070, chain_complete: true,
  summary: SUMMARY, created_at: "2026-11-03T10:00:00+00:00", closed_at: "2026-11-04T10:00:00+00:00",
  discarded_at: null, snapshots_purged_at: null, ...over,
});
const file = { id: 11, file_name: "orders-2026-01.csv", fingerprint: "b".repeat(64), footer_count: 7, orders: 7,
  first_sold_on: "2026-01-02", last_sold_on: "2026-01-30", record_first: 1061, record_last: 1070 };
const order = (over: Record<string, unknown> = {}) => ({
  id: 21, channel: "ebay", order_ref: "01-00001-00001", record_no: 1061, sold_on: "2026-01-12", paid_on: null,
  shipped_on: null, items_value: 12.5, shipping: 4.99, total: 17.49, pieces: 1, combined: false,
  destination_country: "DE", shipping_service: null, source_file: "orders-2026-01.csv",
  lines: [{ lineRef: "T1", listingId: "L1", title: "Testfigur A", variant: null, name: "Testfigur A", quantity: 1, unitPrice: 12.5, value: 12.5 }],
  ...over,
});
const sale = (over: Record<string, unknown> = {}) => ({
  id: 362, soldOn: "2026-01-12", itemsSubtotal: 12.5, discount: 0, shipping: 4.99, cancelledOn: null,
  externalOrderRef: "01-00001-00001", source: "manual", stale: false, ...over,
});
const at = (v: unknown, basis: string) => ({ value: basis === "unknown" ? null : v, basis });
const ledger = (over: Record<string, unknown> = {}, fields: Record<string, unknown> = {}) => ({
  state: "unchanged", version: { analysed: "v1", current: "v1" },
  current: { soldOn: "2026-01-12", itemsSubtotal: 12.5, discount: 0, itemsNet: 12.5, shipping: 4.99, refundsTotal: 0,
    cancelledOn: null, expectedTotal: 17.49, pieces: 1, externalOrderRef: "01-00001-00001", isTest: false },
  atAnalysis: { soldOn: at("2026-01-12", "derived"), itemsNet: at(12.5, "derived"), shipping: at(4.99, "derived"),
    expectedTotal: at(17.49, "derived"), pieces: at(1, "derived"), ...fields },
  ...over,
});
const finding = (over: Record<string, unknown> = {}) => ({
  id: 31, key: "sold_on", field: "sold_on", kind: "deviation", ledger: "2026-01-14", external: "2026-01-12", delta: 2,
  causes: [], allowedDecisions: ["take_external", "keep_ledger", "manual", "defer"], decision: null, applied: false, ...over,
});
const match = (id: number, over: Record<string, unknown> = {}) => ({
  id, category: "exact", certainty: "deterministic", score: 1, dateDelta: 0, competitors: [], reason: null,
  order: order({ order_ref: `01-0000${id}-0000${id}` }), sale: sale({ id: 360 + id }), ledger: ledger(), findings: [], ...over,
});
const ALL_CATEGORIES = [
  match(1),
  match(2, { category: "deviating", certainty: "unique", findings: [finding()],
    ledger: ledger({}, { soldOn: at("2026-01-14", "stored") }) }),
  match(3, { category: "probable", certainty: "probable", findings: [finding({ id: 33 })],
    ledger: ledger({}, { soldOn: at("2026-01-14", "stored") }) }),
  match(4, { category: "ambiguous", certainty: "ambiguous", sale: null, ledger: null,
    competitors: [{ orderRef: "01-00004-00004", saleId: 370, score: 0.8 }, { orderRef: "01-00004-00004", saleId: 371, score: 0.8 }] }),
  match(5, { category: "external_only", certainty: null, score: null, dateDelta: null, sale: null, ledger: null }),
  match(6, { category: "ledger_only", certainty: null, score: null, dateDelta: null, order: null,
    ledger: ledger({}, { soldOn: at(null, "unknown"), itemsNet: at(null, "unknown"), shipping: at(null, "unknown"),
      expectedTotal: at(null, "unknown"), pieces: at(null, "unknown") }) }),
  match(7, { category: "not_comparable", certainty: null, score: null, dateDelta: null, reason: "edge_day", order: null,
    ledger: ledger({}, { soldOn: at(null, "unknown"), itemsNet: at(null, "unknown"), shipping: at(null, "unknown"),
      expectedTotal: at(null, "unknown"), pieces: at(null, "unknown") }) }),
];

const ok = (raw: Record<string, unknown>, request: PageRequest = { category: null, offset: 0, limit: 50 }): SessionPageResult =>
  ({ status: "ok", page: sessionPageView({ session: session(), files: [file], total: 7, matches: ALL_CATEGORIES, ...raw }, request) });

const render = async (id = "3", query: Record<string, string> = {}) =>
  renderToStaticMarkup(await SessionPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(query) }));

/** The markup of one match card. */
const card = (html: string, category: string) => {
  const start = html.indexOf(`data-category="${category}"`);
  expect(start, category).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("</article>", start));
};

beforeEach(() => {
  MOCK.environment = true;
  MOCK.result = ok({});
  MOCK.calls = [];
});

// ---------------------------------------------------------------------------

describe("the gates", () => {
  it("outside Staging: 404, before anything is read", async () => {
    MOCK.environment = false;
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(MOCK.calls).toEqual([]);
    expect(PAGE.indexOf("if (!reconciliationEnvironment()) notFound();")).toBeLessThan(PAGE.indexOf("await fetchReconciliationSession("));
  });

  it.each(["0", "-1", "abc", "1.5", "01", "3%20OR%201", "1e3", "9".repeat(17), ""])("an id that is not a session id (%s): 404, nothing read", async (id) => {
    await expect(render(id)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(MOCK.calls).toEqual([]);
  });

  it("not the seller operator, or no such session: 404", async () => {
    for (const status of ["unavailable", "not_found"] as const) {
      MOCK.result = { status };
      await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
    }
  });

  it("no loading boundary, no action, no database call of its own — the comparison stays server-rendered", () => {
    expect(PAGE).not.toMatch(/server\/actions|\.rpc\(|\.from\(|"use client"/);
    // "Abgleichen" is its own client block; the comparison is not one.
    expect(COMPONENTS).not.toMatch(/server\/actions|\.rpc\(|\.from\(|"use client"|useState|onClick/);
  });
});

describe("paging and filter are the server's", () => {
  it("reads the page from the URL and asks for exactly that page", async () => {
    await render("3", { kategorie: "deviating", seite: "2" });
    expect(MOCK.calls).toEqual([{ id: 3, request: { category: "deviating", offset: 50, limit: 50 } }]);
  });

  it("anything else in the URL falls back to the first page of everything", async () => {
    await render("3", { kategorie: "<script>", seite: "-4" });
    expect(MOCK.calls[0].request).toEqual({ category: null, offset: 0, limit: 50 });
  });

  it("previous and next link to the neighbouring pages, keeping the filter", async () => {
    MOCK.result = ok({ total: 120 }, { category: "deviating", offset: 50, limit: 50 });
    const html = await render("3", { kategorie: "deviating", seite: "2" });
    expect(html).toContain('href="/business/orderbuch/abgleich/3?kategorie=deviating" rel="prev"');
    expect(html).toContain('href="/business/orderbuch/abgleich/3?kategorie=deviating&amp;seite=3" rel="next"');
    expect(html).toContain(t.pageOf(2, 3));
  });

  it("one page only: no page navigation", async () => {
    expect(await render()).not.toContain(`aria-label="${t.pagination}"`);
  });

  it("the filter links every category with its stored count, and marks the active one", async () => {
    MOCK.result = ok({}, { category: "probable", offset: 0, limit: 50 });
    const html = await render("3", { kategorie: "probable" });
    for (const c of ["exact", "deviating", "probable", "ambiguous", "external_only", "ledger_only", "not_comparable"]) {
      expect(html).toContain(`href="/business/orderbuch/abgleich/3?kategorie=${c}"`);
    }
    expect(html).toMatch(/href="\/business\/orderbuch\/abgleich\/3\?kategorie=probable" aria-current="page"/);
  });

  it("a page beyond the end says so and links to the first page", async () => {
    MOCK.result = ok({ total: 7, matches: [] }, { category: null, offset: 50, limit: 50 });
    const html = await render("3", { seite: "2" });
    expect(html).toContain(t.beyondEnd);
    expect(html).toContain(`href="/business/orderbuch/abgleich/3"`);
  });

  it("an empty session and an empty category are said in words, not as an error", async () => {
    MOCK.result = ok({ total: 0, matches: [] });
    expect(await render()).toContain(t.empty);
    MOCK.result = ok({ total: 0, matches: [] }, { category: "ambiguous", offset: 0, limit: 50 });
    const html = await render("3", { kategorie: "ambiguous" });
    expect(html).toContain(t.emptyCategory);
    expect(html).not.toContain('role="alert"');
  });
});

describe("the states", () => {
  it("error: an alert with a way to reload this session — no matches, no empty sentence", async () => {
    MOCK.result = { status: "error" };
    const html = await render();
    expect(html).toContain('role="alert"');
    expect(html).toContain(copy.errors.loadFailed);
    expect(html).toContain('href="/business/orderbuch/abgleich/3"');
    expect(html).not.toContain(t.empty);
    expect(html).not.toContain("data-category");
  });

  it("the overview: platform, state, period, files, counts — and the way back to the list", async () => {
    const html = await render();
    expect(html).toContain('href="/business/orderbuch/abgleich"');
    expect(html).toContain(t.backToList);
    expect(html).toContain("eBay");
    expect(html).toContain(`data-testid="state">${copy.states.closed}<`);
    expect(html).toContain("orders-2026-01.csv");
    expect(html).toContain(t.fileOrders(7));
    expect(html).toContain(t.deviatingMatches);
    expect(html).toContain(t.readOnly);
  });

  it("every session state is named", async () => {
    for (const state of ["open", "closed", "discarded"]) {
      MOCK.result = ok({ session: session({ state }) });
      expect(await render()).toContain(`data-testid="state">${copy.states[state as "open"]}<`);
    }
  });
});

describe("every category, side by side", () => {
  it("one card per match, each with its category in words", async () => {
    const html = await render();
    for (const c of ["exact", "deviating", "probable", "ambiguous", "external_only", "ledger_only", "not_comparable"]) {
      expect(card(html, c)).toContain(copy.categories[c as "exact"]);
    }
  });

  it("exact: green; deviating: red with its count; everything else neutral", async () => {
    const html = await render();
    expect(card(html, "exact")).toContain('data-tone="match"');
    expect(card(html, "deviating")).toContain('data-tone="deviation"');
    expect(card(html, "deviating")).toContain(t.deviationCount(1));
    for (const c of ["probable", "ambiguous", "external_only", "ledger_only", "not_comparable"]) {
      expect(card(html, c), c).toContain('data-tone="neutral"');
    }
  });

  it("probable: the difference is shown as unconfirmed, never as a settled deviation", async () => {
    const c = card(await render(), "probable");
    expect(c).toContain(t.statuses.unconfirmed_deviation);
    expect(c).not.toContain('data-status="deviation"');
    expect(c).not.toContain(t.deviationCount(1));
  });

  it("external-only and unmatched: the missing side is named, nothing is compared", async () => {
    const html = await render();
    expect(card(html, "external_only")).toContain(t.noSale);
    expect(card(html, "ledger_only")).toContain(t.noOrder);
    expect(card(html, "not_comparable")).toContain(copy.notComparableReasons.edge_day);
    for (const c of ["ambiguous", "external_only", "ledger_only", "not_comparable"]) {
      expect(card(html, c)).toContain(`data-status="not_compared"`);
      expect(card(html, c)).not.toMatch(/data-status="(match|deviation)"/);
    }
    expect(card(html, "ambiguous")).toContain(t.competitor(370));
  });
});

describe("the value at analysis, as 0179 proved it", () => {
  const unknownSession = () => ok({ total: 1, matches: [match(1, {
    ledger: ledger({}, { itemsNet: at(null, "unknown"), shipping: at(null, "unknown"), expectedTotal: at(null, "unknown") }),
  })] });

  it("unknown is written as unknown — never as 0, never green", async () => {
    MOCK.result = unknownSession();
    const html = await render();
    const row = html.slice(html.indexOf('data-field="items_net"'), html.indexOf('data-field="shipping"'));
    expect(row).toContain('data-basis="unknown"');
    expect(row).toContain(t.unknownValue);
    expect(row).toContain(t.bases.unknown);
    expect(row).toContain('data-status="unknown"');
    // The report's and today's 12,50 € are there; no third amount stands for the unknown.
    expect(row.match(/12,50/g)?.length).toBe(2);
    expect(row).not.toMatch(/0,00/);
    expect(card(html, "exact")).toContain('data-tone="neutral"');
  });

  it("stored is labelled as the recorded finding value, derived as proven", async () => {
    const html = await render();
    const deviating = card(html, "deviating");
    const soldOn = deviating.slice(deviating.indexOf('data-field="sold_on"'), deviating.indexOf('data-field="items_net"'));
    expect(soldOn).toContain('data-basis="stored"');
    expect(soldOn).toContain(t.bases.stored);
    expect(soldOn).toContain(t.basisHints.stored);
    expect(card(html, "exact")).toContain(t.bases.derived);
  });

  it("a changed sale says so, keeps the stored value and shows today's next to it", async () => {
    MOCK.result = ok({ total: 1, matches: [match(2, {
      category: "deviating", certainty: "unique", findings: [finding()], sale: sale({ id: 362, stale: true }),
      ledger: ledger({ state: "changed", current: { ...ledger().current, itemsNet: 20, expectedTotal: 24.99 } },
        { soldOn: at("2026-01-14", "stored"), itemsNet: at(null, "unknown"), shipping: at(null, "unknown"),
          expectedTotal: at(null, "unknown"), pieces: at(null, "unknown") }),
    })] });
    const html = await render();
    expect(html).toContain(t.ledgerStates.changed);
    expect(html).toContain(t.ledgerStateHints.changed);
    const net = html.slice(html.indexOf('data-field="items_net"'), html.indexOf('data-field="shipping"'));
    expect(net).toContain("20,00");
    expect(net).toContain(t.unknownValue);
  });

  it("cancelled and refunded sales say so", async () => {
    MOCK.result = ok({ total: 1, matches: [match(1, { ledger: ledger({ current: { ...ledger().current, cancelledOn: "2026-02-01", refundsTotal: 3 } }) })] });
    const html = await render();
    expect(html).toContain(t.cancelled("01.02.2026"));
    expect(html).toContain("3,00");
  });
});

describe("read-only, and nothing private where it does not belong", () => {
  it("a closed session: no decision, no button, no form — nothing to take over or keep", async () => {
    const html = await render();
    expect(html).toContain(t.readOnly);
    expect(html).not.toMatch(/<button|<form|<input|<select|<textarea/);
    for (const d of Object.values(copy.decisions)) expect(html).not.toContain(d);
  });

  it("every link is the list, a session page, or a session page with category and page — no report value in a URL", async () => {
    MOCK.result = ok({ total: 120 }, { category: "deviating", offset: 50, limit: 50 });
    const hrefs = [...(await render("3", { kategorie: "deviating", seite: "2" })).matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(5);
    for (const h of hrefs) {
      // The list, a session page — or a sale in the Orderbuch, by its id only (AP1).
      expect(h).toMatch(/^\/business\/orderbuch\/(abgleich(\/3(\?kategorie=[a-z_]+(&amp;seite=\d+)?|\?seite=\d+)?)?|verkauf\/\d+)$/);
      expect(h).not.toContain("01-0000");
    }
  });

  it("report text is text: markup in a title or name is escaped, never rendered", async () => {
    MOCK.result = ok({ total: 1, matches: [match(1, { order: order({ lines: [{ lineRef: "T1", listingId: "L1", title: "x",
      variant: null, name: "<img src=x onerror=alert(1)>", quantity: 1, unitPrice: 1, value: 1 }] }) })] });
    const html = await render();
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(COMPONENTS + PAGE).not.toContain("dangerouslySetInnerHTML");
  });
});

describe("one layout for a phone and a desktop", () => {
  it("no table and no sideways scrolling: rows stack, one line of five columns from lg: up", async () => {
    const html = await render();
    expect(html).not.toMatch(/<table|overflow-x-(auto|scroll)/);
    expect(html).toContain("lg:grid-cols-[8rem_repeat(3,minmax(0,1fr))_13.5rem]");
    expect(html).toContain("sm:grid-cols-2");
    expect(html).toContain("break-words");
    // No fixed width that could outgrow a 320 px screen, other than the lg: columns.
    expect(html.replace(/lg:grid-cols-\[[^\]]+\]/g, "")).not.toMatch(/\bw-\[|min-w-\[|\bw-(7[2-9]|[89]\d|\d{3})\b/);
  });

  it("the labels of a stacked row are there for a phone and for a screen reader", async () => {
    const row = (await render()).match(/data-field="shipping"[\s\S]*?<\/li>/)?.[0] ?? "";
    for (const label of [t.csvValue, t.atAnalysis, t.current, t.result]) expect(row).toContain(label);
    expect(row).toContain("lg:sr-only");
  });

  it("the details open without a script, with a tap target of 44 px on a phone", async () => {
    const html = await render();
    expect(html.match(/<details data-match-details/g)?.length).toBe(7);
    expect(html).toMatch(/<summary class="[^"]*min-h-11/);
  });

  it("the origin of a value sits next to it, in the same summary — no extra text line under the value", async () => {
    const html = await render();
    const soldOn = card(html, "deviating").match(/data-field="sold_on"[\s\S]*?<\/li>/)?.[0] ?? "";
    const origin = soldOn.match(/<details data-basis="stored"[\s\S]*?<\/details>/)?.[0] ?? "";
    const summary = origin.match(/<summary[\s\S]*?<\/summary>/)?.[0] ?? "";
    // value, mark and the spoken origin are one tappable line; the hint follows only when opened
    expect(summary).toContain("14.01.2026");
    expect(summary).toContain('data-basis-icon="stored"');
    expect(summary).toContain(t.basisLabel(t.bases.stored));
    expect(summary).toMatch(/min-h-11[^"]*lg:min-h-6/);
    expect(summary).not.toContain(t.basisHints.stored);
    expect(origin.slice(origin.indexOf("</summary>"))).toContain(t.basisHints.stored);
    expect(soldOn).not.toContain("mt-0.5 block text-xs");
  });
});

describe("the three origins at analysis, each its own mark", () => {
  const ICON = (html: string, basis: string) => html.match(new RegExp(`<svg data-basis-icon="${basis}"[\\s\\S]*?</svg>`))?.[0] ?? "";

  it("derived, stored and unknown: each says its origin in words, with its own shape and its own hint", async () => {
    MOCK.result = ok({ total: 1, matches: [match(2, { category: "deviating", certainty: "unique", findings: [finding()],
      ledger: ledger({}, { soldOn: at("2026-01-14", "stored"), itemsNet: at(12.5, "derived"), shipping: at(null, "unknown") }) })] });
    const html = await render();
    for (const basis of ["derived", "stored", "unknown"] as const) {
      const block = html.match(new RegExp(`<details data-basis="${basis}"[\\s\\S]*?</details>`))?.[0] ?? "";
      expect(block, basis).toContain(t.basisLabel(t.bases[basis]));
      expect(block, basis).toContain(t.basisHints[basis]);
      expect(block, basis).toContain(`data-basis-icon="${basis}"`);
      expect(block, basis).toContain('aria-hidden="true"');
    }
    // The shapes differ, so colour is never the only difference.
    expect(new Set(["derived", "stored", "unknown"].map((b) => ICON(html, b).replace(/data-basis-icon="\w+"/, ""))).size).toBe(3);
  });

  it("stored never carries the check mark of derived — it is not independently proven", async () => {
    const html = await render();
    const check = ICON(html, "derived").match(/<path d="([^"]+)"/)?.[1] ?? "";
    expect(check).not.toBe("");
    expect(ICON(html, "stored")).not.toContain(check);
    expect(t.basisHints.stored).toContain("kein unabhängig nachgewiesener Wert");
  });

  it("unknown is written out as unbekannt inside its summary, with no value", async () => {
    MOCK.result = ok({ total: 1, matches: [match(1, { ledger: ledger({}, { itemsNet: at(null, "unknown") }) })] });
    const html = await render();
    const block = html.match(/<details data-basis="unknown"[\s\S]*?<\/summary>/)?.[0] ?? "";
    expect(block).toContain(t.unknownValue);
    expect(block).not.toMatch(/\d+,\d{2}/);
  });

  it("the legend names all three marks once per opened card", async () => {
    const exact = card(await render(), "exact");
    expect(exact).toContain(t.basisLegend);
    for (const basis of ["derived", "stored", "unknown"] as const) expect(exact).toContain(t.bases[basis]);
  });
});

describe("the period: pairs, one-sided rows and candidates at the edge", () => {
  const sessionFive = () => {
    const summary = { ...SUMMARY, categories: { exact: 30, deviating: 2, probable: 0, ambiguous: 0, external_only: 0, ledger_only: 0, not_comparable: 3 } };
    const unpaired = (id: number, reason: string, soldOn: string) => match(id, {
      category: "not_comparable", certainty: null, score: null, dateDelta: null, reason, order: null,
      sale: sale({ id: 70 + id, soldOn }),
      ledger: ledger({ current: { ...ledger().current, soldOn } }, { soldOn: at(null, "unknown"), itemsNet: at(null, "unknown"),
        shipping: at(null, "unknown"), expectedTotal: at(null, "unknown"), pieces: at(null, "unknown") }),
    });
    return ok({
      session: session({ id: 5, covered_from: "2026-02-05", covered_to: "2026-02-28", summary }),
      total: 35,
      matches: [match(1), unpaired(7, "after_coverage", "2026-03-01"), unpaired(8, "before_coverage", "2026-02-03"),
        unpaired(9, "edge_day", "2026-02-28")],
    });
  };

  it("32 pairs and 3 unpaired candidates are counted apart; the 35 stored rows are named as such", async () => {
    MOCK.result = sessionFive();
    const html = await render("5");
    expect(html).toContain(`data-count="pairs">32<`);
    expect(html).toContain(`data-count="unpaired">3<`);
    expect(html).toContain(`data-count="ledger-only">0<`);
    expect(html).toContain(`data-count="report-only">0<`);
    expect(html).toContain(`data-count="records">35<`);
    for (const label of [t.pairs, t.unpairedCount, t.ledgerOnlyCount, t.reportOnlyCount, t.matchRecords]) expect(html).toContain(label);
    expect(html).toContain(t.unpairedHint);
  });

  it("before and after the period are told apart in the head of the card, each with its own sentence", async () => {
    MOCK.result = sessionFive();
    const html = await render("5");
    for (const reason of ["after_coverage", "before_coverage", "edge_day"] as const) {
      const start = html.indexOf(`data-reason="${reason}"`);
      expect(start, reason).toBeGreaterThan(-1);
      const head = html.slice(start, html.indexOf("<details", start));
      expect(head).toContain(copy.notComparableReasons[reason]);
      expect(head).toContain(t.reasonHints[reason]);
    }
    expect(copy.notComparableReasons.before_coverage).not.toBe(copy.notComparableReasons.after_coverage);
  });

  it("an edge candidate is never shown as a missing order", async () => {
    MOCK.result = sessionFive();
    const html = await render("5");
    const after = html.slice(html.indexOf('data-reason="after_coverage"'));
    const cardAfter = after.slice(0, after.indexOf("</article>"));
    expect(cardAfter).toContain(t.notCompared);
    expect(cardAfter).not.toContain(t.noOrder);
    expect(cardAfter).not.toContain(copy.categories.ledger_only);
    // A real ledger-only sale keeps its wording.
    MOCK.result = ok({});
    expect(card(await render(), "ledger_only")).toContain(t.noOrder);
  });

  it("a sale without an order never claims its lines were purged — there were none", async () => {
    MOCK.result = sessionFive();
    const html = await render("5");
    const after = html.slice(html.indexOf('data-reason="after_coverage"'));
    const cardAfter = after.slice(0, after.indexOf("</article>"));
    expect(cardAfter).toContain(t.noReportLines);
    expect(cardAfter).not.toContain(t.linesPurged);
    // ...and neither does a SkyIsles-only sale; a purged order still says so.
    MOCK.result = ok({});
    expect(card(await render(), "ledger_only")).not.toContain(t.linesPurged);
    MOCK.result = ok({ total: 1, matches: [match(1, { order: order({ lines: null }) })] });
    expect(card(await render(), "exact")).toContain(t.linesPurged);
  });

  it("a session without a hint-worthy candidate shows no hint", async () => {
    MOCK.result = ok({ session: session({ summary: { ...SUMMARY, categories: { ...SUMMARY.categories, not_comparable: 0 } } }) });
    expect(await render()).not.toContain(t.unpairedHint);
  });
});

// ---------------------------------------------------------------------------
// An open session: one "Abgleichen" per order — the confirmation stays locked
// ---------------------------------------------------------------------------

describe("an open session", () => {
  const r = copy.reconcile;
  const openWith = (matches: unknown[]) => {
    MOCK.result = ok({ session: session({ state: "open", closed_at: null }), matches, total: matches.length });
  };
  const ref = (over: Record<string, unknown> = {}) => finding({ id: 41, key: "external_order_ref", field: "external_order_ref",
    kind: "addition", ledger: null, external: "06-14260-71832", delta: null, allowedDecisions: ["take_external", "keep_ledger", "defer"], ...over });
  const noRef = { ...ledger().current, externalOrderRef: null };

  it("a short intro, no decision buttons and no selection panel — one Abgleichen per order with something to do", async () => {
    openWith([match(1), match(2, { category: "deviating", certainty: "unique", findings: [finding(), ref()],
      sale: sale({ id: 362, externalOrderRef: null }), ledger: ledger({ current: noRef }, { soldOn: at("2026-01-14", "stored") }) })]);
    const html = await render();
    expect(html).toContain(t.decideIntro);
    expect(html).not.toContain(t.readOnly);
    for (const gone of ["CSV-Wert übernehmen", "Zurückstellen", "Vorschau prüfen", "Auswahl und Übernahme", 'type="checkbox"']) {
      expect(html).not.toContain(gone);
    }
    expect(card(html, "deviating").match(/data-reconcile=""/g)).toHaveLength(1);
    // The exact order without anything to add has no action — one line and its details.
    expect(card(html, "exact")).not.toContain("data-reconcile");
    expect(html).toContain(r.close.button);
  });

  it("the card names the order, the sale, the counts and one line per difference — addition and date apart", async () => {
    openWith([match(2, { category: "deviating", certainty: "unique", findings: [finding(), ref()],
      sale: sale({ id: 362, externalOrderRef: null }), ledger: ledger({ current: noRef }, { soldOn: at("2026-01-14", "stored") }) })]);
    const c = card(await render(), "deviating");
    expect(c).toContain(t.order("01-00002-00002"));
    expect(c).toContain(t.sale(362));
    expect(c).toContain(t.deviationCount(1));
    expect(c).toContain(t.additionCount(1));
    expect(c).toMatch(/data-plan="MISSING_IN_SKYISLES" data-plan-field="external_order_ref"/);
    expect(c).toMatch(/data-plan="READ_ONLY_DIFFERENCE" data-plan-field="sold_on"/);
    expect(c).toContain(r.badges.MISSING_IN_SKYISLES);
    expect(c).toContain(r.badges.READ_ONLY_DIFFERENCE);
    expect(c).toContain(`href="/business/orderbuch/verkauf/362"`);
    expect(c).toContain(r.orderbook);
  });

  it("a figure that differs is a check, never an addition or a conflict", async () => {
    openWith([match(2, { category: "deviating", findings: [finding({ id: 36, key: "figure:0", field: "figure", ledger: "Spyro", external: "Dark Spyro", delta: null })] })]);
    const c = card(await render(), "deviating");
    expect(c).toMatch(/data-plan="READ_ONLY_DIFFERENCE" data-plan-field="figure"/);
    expect(c).not.toMatch(/data-plan="(MISSING_IN_SKYISLES|CONFLICT)"/);
  });

  it("several orders to reconcile: one action for the page as well", async () => {
    openWith([1, 2, 3].map((id) => match(id, { findings: [ref({ id: 40 + id })], sale: sale({ id: 360 + id, externalOrderRef: null }),
      ledger: ledger({ current: noRef }) })));
    expect(await render()).toContain(r.all(3));
  });

  it("a closed session shows no Abgleichen at all", async () => {
    MOCK.result = ok({ matches: [match(2, { findings: [ref()], sale: sale({ id: 362, externalOrderRef: null }), ledger: ledger({ current: noRef }) })], total: 1 });
    const html = await render();
    expect(html).not.toContain("data-reconcile");
    expect(html).not.toContain(r.close.button);
  });
});

describe("the report's orders first — extra candidates of the search window apart", () => {
  it("in 'Alle' the candidates after the period wait collapsed below the orders, never among them", async () => {
    MOCK.result = ok({ total: 3, matches: [match(1),
      match(7, { category: "not_comparable", certainty: null, score: null, dateDelta: null, reason: "after_coverage", order: null,
        sale: sale({ id: 377, soldOn: "2026-03-01" }) }),
      match(2, { category: "deviating", findings: [finding()] })] });
    const html = await render();
    const list = html.slice(html.indexOf(`aria-label="${t.matchesHeading}"`), html.indexOf("data-extra-candidates"));
    expect(list).toContain('data-category="exact"');
    expect(list).toContain('data-category="deviating"');
    expect(list).not.toContain('data-category="not_comparable"');
    const extra = html.slice(html.indexOf("<details data-extra-candidates"));
    expect(extra).toContain(t.extraCandidates(1));
    expect(extra).toContain(t.extraCandidatesHint);
    expect(extra).toContain('data-category="not_comparable"');
  });

  it("their own filter still lists them as cards; an order of the report is never moved there", async () => {
    MOCK.result = ok({ total: 1, matches: [match(7, { category: "not_comparable", certainty: null, reason: "after_coverage", order: null })] },
      { category: "not_comparable", offset: 0, limit: 50 });
    const html = await render("3", { kategorie: "not_comparable" });
    expect(html).not.toContain("data-extra-candidates");
    expect(html).toContain('data-category="not_comparable"');
    MOCK.result = ok({ total: 2, matches: [match(1, { order: order({ sold_on: "2026-03-01" }) }), match(5, { category: "external_only",
      certainty: null, score: null, dateDelta: null, sale: null, ledger: null, order: order({ sold_on: "2026-03-02" }) })] });
    expect(await render()).not.toContain("data-extra-candidates");
  });
});
