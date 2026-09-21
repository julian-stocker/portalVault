/**
 * The Orderbuch workbench (ADR-0088).
 *
 * WHAT THE OWNER ACTUALLY COMPLAINED ABOUT
 *
 * Fifteen purchases took fifteen large cards, reading one meant leaving the
 * page, and there was no way back. The redesign is mostly layout — but three
 * of its decisions are arithmetic or semantics, and those are the ones a
 * screenshot cannot check:
 *
 *   the summary factor is a ratio of sums, not a mean of ratios
 *   the tick on a historical row means "settled", never "in inventory"
 *   `?zurueck=` is a URL from the address bar, not a trusted value
 */
import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { de } from "@/lib/i18n/de";
import { code, latestFunction } from "@/test-support/migrations";
import {
  averageOfFactors, canCheckIn, itemStatus, ledgerHref, normaliseSearch,
  rowStatus, safeBackHref, sortLedger, summaryFactor,
} from "./ledger";

const LEDGER_SQL = code(latestFunction("seller_orderbook_ledger").body);
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const COMPONENT = read("src/components/business/orderbook-ledger.tsx");
const PAGE = read("src/app/(business)/business/orderbuch/page.tsx");
const DETAIL = read("src/app/(business)/business/orderbuch/[id]/page.tsx");
const CSS = read("src/app/globals.css");
/** The shared ledger primitives — where the markup of BOTH ledgers now lives. */
const PRIMITIVES = read("src/components/business/ledger-table.tsx");

/**
 * The `.ob-row` / `.ob-item` rules.
 *
 * There is no longer a mobile half and a desktop half to tell apart: the
 * tracks are unconditional and the only thing left inside a media query is
 * which axis the box scrolls on. `desktop` still names that query's contents
 * so the scroll rules can be asserted where they live.
 */
const ledgerCss = (() => {
  const start = CSS.indexOf("@layer components {");
  const desktop = CSS.indexOf("@media (min-width: 48rem) {", start);
  return {
    all: CSS.slice(start, CSS.indexOf("@layer utilities {")),
    mobile: CSS.slice(start, desktop),
    desktop: CSS.slice(desktop, CSS.indexOf("@layer utilities {")),
  };
})();
/** Strip TSX comments: a comment that NAMES a class is not the class. */
const withoutComments = (text: string) => text
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");
const PRIMITIVES_CODE = withoutComments(PRIMITIVES);

/** The component with its comments removed — a comment is not a class. */
const COMPONENT_CODE = COMPONENT
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");
/**
 * `grid-template-columns: a b c;` → ["a","b","c"], minmax() kept whole.
 *
 * The desktop declaration is `var(--ob-columns, <the purchase tracks>)`, so
 * the fallback is unwrapped first: that fallback IS Einkauf's column list, and
 * it is what renders when a ledger passes no property of its own.
 */
const tracks = (rule: string, selector: string): string[] => {
  /*
   * `.ob-item {` occurs twice: once in the shared `display: grid` rule it
   * shares with `.ob-row`, and once in its own. Only one of them declares
   * tracks, so take the first block that does rather than the first block.
   */
  let block = "";
  for (let at = rule.indexOf(`.${selector} {`); at !== -1;
       at = rule.indexOf(`.${selector} {`, at + 1)) {
    const candidate = rule.slice(at, rule.indexOf("}", at));
    if (candidate.includes("grid-template-columns")) { block = rule.slice(at); break; }
  }
  const decl = /grid-template-columns:\s*([\s\S]*?);/.exec(block);
  if (!decl) return [];
  const value = decl[1].replace(/\s+/g, " ").trim();
  const fallback = /^var\(\s*--[\w-]+\s*,\s*([\s\S]*)\)$/.exec(value);
  return (fallback ? fallback[1] : value).trim()
    .split(/ (?![^(]*\))/).filter(Boolean);
};

/* The real December 2025 numbers, read back from Staging. */
const DECEMBER = [
  { id: 23, purchasedAt: "2025-12-27", totalCost: 113.17, knownValue: 332.21, factor: 0.3407 },
  { id: 22, purchasedAt: "2025-12-26", totalCost: 159.19, knownValue: 273.69, factor: 0.5816 },
  { id: 21, purchasedAt: "2025-12-26", totalCost: 64.17, knownValue: 221.13, factor: 0.2902 },
  { id: 20, purchasedAt: "2025-12-21", totalCost: 47.59, knownValue: 187.95, factor: 0.2532 },
  { id: 19, purchasedAt: "2025-12-17", totalCost: 37.34, knownValue: 141.75, factor: 0.2634 },
  { id: 18, purchasedAt: "2025-12-16", totalCost: 31.63, knownValue: 92.87, factor: 0.3406 },
  { id: 17, purchasedAt: "2025-12-16", totalCost: 15.84, knownValue: 37.34, factor: 0.4242 },
  { id: 16, purchasedAt: "2025-12-13", totalCost: 74.62, knownValue: 232.48, factor: 0.3210 },
  { id: 15, purchasedAt: "2025-12-12", totalCost: 110.49, knownValue: 332.34, factor: 0.3325 },
  { id: 14, purchasedAt: "2025-12-11", totalCost: 47.19, knownValue: 129.30, factor: 0.3650 },
  { id: 13, purchasedAt: "2025-12-08", totalCost: 185.00, knownValue: 482.02, factor: 0.3838 },
  { id: 12, purchasedAt: "2025-12-08", totalCost: 77.27, knownValue: 172.25, factor: 0.4486 },
  { id: 11, purchasedAt: "2025-12-08", totalCost: 70.50, knownValue: 208.21, factor: 0.3386 },
  { id: 10, purchasedAt: "2025-12-06", totalCost: 67.02, knownValue: 187.18, factor: 0.3581 },
  { id: 6, purchasedAt: "2025-12-06", totalCost: 288.14, knownValue: 468.56, factor: 0.6149 },
];

describe("the summary factor is a ratio of sums", () => {
  const cost = DECEMBER.reduce((s, p) => s + p.totalCost, 0);
  const value = DECEMBER.reduce((s, p) => s + p.knownValue, 0);

  it("is SUM(Ausgaben) / SUM(Marktwert)", () => {
    expect(cost).toBeCloseTo(1389.16, 2);
    expect(value).toBeCloseTo(3499.28, 2);
    expect(summaryFactor(cost, value)).toBeCloseTo(0.3970, 4);
  });

  it("and averaging the fifteen purchase factors gives a DIFFERENT number", () => {
    /*
     * 0,3771 against 0,3970 — a 5 % error in the number the owner judges a
     * parcel by, and nothing on screen would look wrong. Averaging weights
     * purchase #22 (three items) exactly like #23 (sixty-five).
     */
    const averaged = averageOfFactors(DECEMBER.map((p) => p.factor));
    expect(averaged).toBeCloseTo(0.3771, 4);
    expect(averaged).not.toBeCloseTo(summaryFactor(cost, value)!, 3);
  });

  it("is null and not zero when nothing is valued", () => {
    // "No market value known" is not the claim "worth nothing".
    expect(summaryFactor(500, 0)).toBeNull();
    expect(summaryFactor(0, 0)).toBeNull();
    expect(summaryFactor(500, Number.NaN)).toBeNull();
  });

  it("and the database computes it the same way", () => {
    expect(LEDGER_SQL).toContain("sum(m.total_cost) / sum(m.known_value)");
    // Never avg(factor): that is the mistake this whole block exists to stop.
    expect(LEDGER_SQL).not.toMatch(/avg\s*\(/i);
  });
});

describe("ordering", () => {
  it("puts the newest purchase first", () => {
    expect(sortLedger(DECEMBER)[0]).toMatchObject({ id: 23, purchasedAt: "2025-12-27" });
  });

  it("breaks a tie on id, so two parcels from one day never swap places", () => {
    /*
     * 2025-12-06 is two purchases: the pilot (#6) and group 19 (#10). Without
     * the tiebreak their order is whatever the database returns — stable enough
     * in testing to look deliberate.
     */
    const sameDay = sortLedger([
      { id: 6, purchasedAt: "2025-12-06" }, { id: 10, purchasedAt: "2025-12-06" },
    ]);
    expect(sameDay.map((p) => p.id)).toEqual([10, 6]);
    expect(sortLedger([...sameDay].reverse()).map((p) => p.id)).toEqual([10, 6]);
  });

  it("keeps the two same-day purchases separate rows", () => {
    const sorted = sortLedger(DECEMBER);
    const sixth = sorted.filter((p) => p.purchasedAt === "2025-12-06");
    expect(sixth.map((p) => p.id)).toEqual([10, 6]);
  });

  it("and the database orders the same way, not by accident", () => {
    /*
     * `nulls last`, and that word is the point: Postgres sorts NULLs FIRST
     * under `desc`, which would put thirteen dateless purchases above the
     * newest real one and make them read as this week's parcels.
     */
    expect(LEDGER_SQL).toContain("order by m.purchased_at desc nulls last, m.id desc");
  });

  it("the whole real month sorts to the expected sequence", () => {
    expect(sortLedger(DECEMBER).map((p) => p.id))
      .toEqual([23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 6]);
  });
});

describe("search", () => {
  it("an empty term is no search at all, not a search for nothing", () => {
    expect(normaliseSearch("")).toBeNull();
    expect(normaliseSearch("   ")).toBeNull();
    expect(normaliseSearch(" Drobot ")).toBe("Drobot");
  });

  it("German decimals reach the database as decimals", () => {
    // `67,02` is the same money as `67.02`; only the separator is translated.
    expect(LEDGER_SQL).toContain("replace(coalesce(v_q, ''), ',', '.')");
  });

  it("covers the purchase fields the owner names", () => {
    for (const field of ["purchased_at", "total_cost", "known_value", "factor", "note", "source"]) {
      expect(LEDGER_SQL, field).toContain(field);
    }
    // German date, so `27.12.2025` finds the parcel.
    expect(LEDGER_SQL).toContain("to_char(h.purchased_at, 'DD.MM.YYYY')");
  });

  it("covers the raw Excel name and the canonical figure name", () => {
    expect(LEDGER_SQL).toContain("i.raw_name ilike");
    expect(LEDGER_SQL).toContain("s.name     ilike");
    expect(LEDGER_SQL).toContain("i.sky_id   ilike");
  });

  it("returns the matching items, so the row can open on the reason", () => {
    expect(LEDGER_SQL).toContain("match_items");
    expect(COMPONENT).toContain("p.matchItems.length > 0");
  });

  it("rounds nothing and tolerates nothing — a near-miss is not an answer", () => {
    for (const forbidden of ["similarity(", "levenshtein", "soundex", "%>", "<->"]) {
      expect(LEDGER_SQL, forbidden).not.toContain(forbidden);
    }
  });

  it("a search is a URL, so it survives the back button and a bookmark", () => {
    expect(PAGE).toContain('method="get"');
    expect(PAGE).toContain('name="q"');
    expect(ledgerHref(2025, 12, "Drobot")).toBe("/business/orderbuch?jahr=2025&monat=12&q=Drobot");
    expect(ledgerHref(2025, 12, null)).toBe("/business/orderbuch?jahr=2025&monat=12");
    expect(ledgerHref()).toBe("/business/orderbuch");
  });
});

describe("the summary describes what is on screen, not everything", () => {
  it("year, month and search all reach the same function call", () => {
    expect(PAGE).toContain("fetchLedger(");
    expect(PAGE).toContain("search ?? undefined");
    expect(LEDGER_SQL).toContain("p_year");
    expect(LEDGER_SQL).toContain("p_month");
    expect(LEDGER_SQL).toContain("p_search");
  });

  it("the summary is aggregated over the SAME filtered set the rows come from", () => {
    // One CTE, read twice. Not a second query with its own idea of the filter.
    expect(LEDGER_SQL).toContain("from matched m");
    expect(LEDGER_SQL).toContain("'purchase_count', count(*)");
  });

  it("Anzahl counts purchases, and items are the secondary line", () => {
    expect(LEDGER_SQL).toContain("'purchase_count', count(*)");
    expect(LEDGER_SQL).toContain("'item_count',     coalesce(sum(m.total_items), 0)");
    expect(COMPONENT).toContain("summary.purchaseCount");
    expect(COMPONENT).toContain("copy.summary.countHint(summary.itemCount)");
  });

  it("Ausgaben comes from purchase totals, never from item rows", () => {
    expect(LEDGER_SQL).toContain("'total_cost',     coalesce(sum(m.total_cost), 0)");
  });

  it("an incomplete valuation is marked, not hidden and not zeroed", () => {
    expect(LEDGER_SQL).toContain("'incomplete', coalesce(sum(m.known_items), 0) < coalesce(sum(m.total_items), 0)");
    expect(COMPONENT).toContain("copy.incompleteMark");
    expect(COMPONENT).toContain("copy.incompleteTitle");
  });
});

describe("status: a tick is a claim, so it had better be the right one", () => {
  /*
   * V4.7. `Eingebucht` now means one thing and only one: a stock movement
   * exists for this unit. The previous vocabulary gave every imported
   * purchase a ✓ under a column headed `Eingebucht`, for 84 purchases and
   * 2 114 items of which not one owns a `movement_id`.
   */
  it("a workbook purchase is historical, and says so in words", () => {
    expect(rowStatus({ source: "excel_order_2026", bookedCount: 0, itemCount: 14 })).toBe("historical");
    // Even with an open unit in it since 0067: the purchase is still
    // history, and `is_open` is what surfaces the outstanding work.
    expect(rowStatus({ source: "excel_order_2026", bookedCount: 0, itemCount: 54 })).toBe("historical");
  });

  it("a manual purchase distinguishes none, some and all", () => {
    expect(rowStatus({ source: "manual", bookedCount: 0, itemCount: 10 })).toBe("open");
    expect(rowStatus({ source: "manual", bookedCount: 3, itemCount: 10 })).toBe("partial");
    expect(rowStatus({ source: "manual", bookedCount: 10, itemCount: 10 })).toBe("complete");
  });

  it("counts a settled position as closed, but never as booked (0070)", () => {
    /*
     * Ten figures booked and two portals settled. Nothing is outstanding —
     * `is_open` says so — but two of the twelve own no movement, so
     * `Eingebucht ✓` would claim two bookings that do not exist.
     */
    const row = { source: "manual", bookedCount: 10, itemCount: 12, settledCount: 2 };
    expect(rowStatus(row)).toBe("settled");
    expect(rowStatus(row)).not.toBe("complete");

    // All twelve booked and none settled is still the tick.
    expect(rowStatus({ source: "manual", bookedCount: 12, itemCount: 12, settledCount: 0 }))
      .toBe("complete");
    // A portal settled while figures are still outstanding is partial.
    expect(rowStatus({ source: "manual", bookedCount: 0, itemCount: 12, settledCount: 2 }))
      .toBe("partial");
    // Nothing done at all is open, settled or not.
    expect(rowStatus({ source: "manual", bookedCount: 0, itemCount: 12, settledCount: 0 }))
      .toBe("open");
    // A parcel that is nothing but portals, all filed away.
    expect(rowStatus({ source: "manual", bookedCount: 0, itemCount: 2, settledCount: 2 }))
      .toBe("settled");
  });

  it("agrees with the Offen axis instead of contradicting it", () => {
    /*
     * The bug this closes: the column said `10 von 12` for ever while
     * `is_open` said there was nothing to do. One screen, two answers.
     * `closed === itemCount` is exactly the SQL's `open_count = 0`.
     */
    const closed = (r: { bookedCount: number; settledCount: number; itemCount: number }) =>
      r.itemCount - r.bookedCount - r.settledCount === 0;
    for (const r of [
      { bookedCount: 10, itemCount: 12, settledCount: 2 },
      { bookedCount: 12, itemCount: 12, settledCount: 0 },
      { bookedCount: 0, itemCount: 2, settledCount: 2 },
    ]) {
      expect(closed(r), JSON.stringify(r)).toBe(true);
      expect(["complete", "settled"]).toContain(rowStatus({ source: "manual", ...r }));
    }
    for (const r of [
      { bookedCount: 3, itemCount: 10, settledCount: 0 },
      { bookedCount: 0, itemCount: 12, settledCount: 2 },
    ]) {
      expect(closed(r), JSON.stringify(r)).toBe(false);
      expect(["partial", "open"]).toContain(rowStatus({ source: "manual", ...r }));
    }
  });

  it("a historical purchase stays `Historisch` whatever the counts say", () => {
    // Including the five 0067 reopened: a workbook purchase is history
    // however much of it is still in the post, and the `Offen` axis is
    // where that outstanding work is shown.
    expect(rowStatus({ source: "excel_order_2026", bookedCount: 0, itemCount: 41, settledCount: 3 }))
      .toBe("historical");
  });

  it("treats a caller that predates 0070 as having settled nothing", () => {
    expect(rowStatus({ source: "manual", bookedCount: 10, itemCount: 10 })).toBe("complete");
  });

  it("an empty purchase is open, not complete", () => {
    // `bookedCount === itemCount` is true of 0 === 0, and "everything is
    // booked" is the wrong thing to say about nothing.
    expect(rowStatus({ source: "manual", bookedCount: 0, itemCount: 0 })).toBe("open");
  });

  it("an item is asked of its movement, not of its state", () => {
    expect(itemStatus({ state: "reconciled_legacy", movementId: null })).toBe("historical");
    expect(itemStatus({ state: "booked", movementId: 42 })).toBe("complete");
    expect(itemStatus({ state: "ordered", movementId: null })).toBe("open");
    expect(itemStatus({ state: "arrived", movementId: null })).toBe("open");
    expect(itemStatus({ state: "damaged", movementId: null })).toBe("open");
    expect(itemStatus({ state: "missing", movementId: null })).toBe("open");
  });

  it("nothing without a movement can read as booked", () => {
    /*
     * The property, stated over every state the column constraint allows.
     * `reconciled_legacy` is the case that mattered: it has no movement and
     * used to draw the same ✓ as a real booking.
     */
    for (const state of ["ordered", "arrived", "damaged", "missing", "reconciled_legacy"]) {
      expect(itemStatus({ state, movementId: null }), state).not.toBe("complete");
    }
  });

  it("names all four states, and the tick belongs to exactly one", () => {
    const c = de.business.orderbook;
    expect(c.historicalLabel).toBe("Historisch");
    // Closed-without-a-booking carries no tick either (0070).
    expect(c.closedLabel).toBe("Erledigt");
    expect(c.closedLabel).not.toContain("✓");
    expect(c.closedHint(10, 2)).toContain("10 eingebucht");
    expect(c.closedHint(10, 2)).toContain("2 erledigt");
    expect(c.states.ordered).toBe("Bestellt");
    expect(c.states.arrived).toBe("Angekommen");
    expect(c.completeCell).toContain("Eingebucht");
    expect(c.completeCell).toContain("✓");
    // And no other label carries a tick.
    for (const label of [c.historicalLabel, c.openRowLabel, c.partialLabel,
                         c.states.ordered, c.states.arrived, c.states.damaged,
                         c.states.missing, c.states.reconciled_legacy]) {
      expect(label, label).not.toContain("✓");
    }
  });

  it("the column no longer claims `Eingebucht` for everything under it", () => {
    expect(de.business.orderbook.columns.progress).not.toBe("Eingebucht");
    expect(de.business.orderbook.historicalLabel.toLowerCase()).not.toContain("eingebucht");
  });

  it("and the tick never says the word `eingebucht` for a historical row", () => {
    expect(de.business.orderbook.settled).toBe("Historisch übernommen");
    expect(de.business.orderbook.settled.toLowerCase()).not.toContain("eingebucht");
    expect(de.business.orderbook.settled.toLowerCase()).not.toContain("bestand");
  });

  it("every status carries its long form where a reader can reach it", () => {
    expect(COMPONENT).toContain("aria-label={title}");
    expect(COMPONENT).toContain("title={title}");
  });

  it("presentation only — the redesign changes no database semantics", () => {
    // Nothing here writes, and nothing here reinterprets a state.
    expect(COMPONENT).not.toContain("reconciled_legacy'");
    expect(LEDGER_SQL).not.toMatch(/insert|update |delete/i);
    expect(LEDGER_SQL).toContain("stable");
  });
});

describe("Einchecken", () => {
  it("is never offered on a historical row", () => {
    expect(canCheckIn({ state: "reconciled_legacy", skyId: "SKY-0371" })).toBe(false);
  });

  it("is never offered on a row already in inventory", () => {
    expect(canCheckIn({ state: "booked", skyId: "SKY-0371" })).toBe(false);
  });

  it("is never offered on something that is not a catalog figure", () => {
    expect(canCheckIn({ state: "arrived", skyId: null })).toBe(false);
  });

  it("IS offered on an arrived or ordered figure", () => {
    expect(canCheckIn({ state: "arrived", skyId: "SKY-0371" })).toBe(true);
    expect(canCheckIn({ state: "ordered", skyId: "SKY-0371" })).toBe(true);
  });

  it("is not offered on a damaged or missing unit either", () => {
    expect(canCheckIn({ state: "damaged", skyId: "SKY-0371" })).toBe(false);
    expect(canCheckIn({ state: "missing", skyId: "SKY-0371" })).toBe(false);
  });

  it("and the row is redrawn from the server, never optimistically", () => {
    /*
     * A tick that appears before the database agreed is a claim about
     * inventory that may be false. The component re-reads the purchase.
     */
    expect(COMPONENT).toContain("if (result.ok) load(purchaseId);");
    expect(COMPONENT).not.toContain("useOptimistic");
    expect(COMPONENT).toContain("bookPurchaseItem");
  });
});

describe("the ledger stays cheap when it is closed", () => {
  it("collapsed rows render no item rows at all", () => {
    // `expanded ? … : null` — the item list has no hidden-but-rendered form.
    expect(COMPONENT).toContain("{expanded ? (");
    // There is no hidden-but-rendered form: the only <ItemRow> sits inside
    // that branch, so a closed ledger has none in the DOM at all.
    expect(COMPONENT.split("{expanded ? (")[1]).toContain("<ItemRow");
    expect(COMPONENT.split("{expanded ? (")[0]).not.toContain("<ItemRow");
  });

  it("items are fetched per expansion, not shipped with the page", () => {
    expect(COMPONENT).toContain("loadPurchaseItems(id)");
    // The page ships purchases; items never travel with it.
    expect(PAGE).not.toContain("fetchPurchase(");
    expect(PAGE).not.toContain("loadPurchaseItems");
    expect(PAGE).not.toContain("PurchaseItem");
  });

  it("an id already in flight is not fetched twice", () => {
    expect(COMPONENT).toContain("if (loading.current.has(id)) return;");
  });

  it("the ledger asks the database once, not once per purchase", () => {
    // N+1 would be a second RPC inside the row loop.
    expect(PAGE).toContain("fetchLedger(");
    expect((PAGE.match(/await\s+Promise\.all/g) ?? []).length).toBe(1);
  });

  it("and on desktop the ledger scrolls inside itself so the page does not grow", () => {
    // On a phone the page keeps the vertical axis — see the scroll-axis test
    // below. `62dvh` is the desktop box, and it lives in the stylesheet now.
    expect(PRIMITIVES).toContain("ob-scroll");
    expect(ledgerCss.desktop).toContain("dvh");
  });
});

describe("expansion", () => {
  it("opens and closes the same row", () => {
    expect(COMPONENT).toContain("if (next.has(id)) next.delete(id);");
    expect(COMPONENT).toContain("else next.add(id);");
  });

  it("is a disclosure, announced as one", () => {
    expect(PRIMITIVES).toContain("aria-expanded={expanded}");
    expect(COMPONENT).toContain("controls={`purchase-${purchase.id}`}");
  });

  it("several rows may be open at once", () => {
    // A Set, not a single id: closing one to read another is the frustration.
    expect(COMPONENT).toContain("useState<ReadonlySet<number>>");
  });

  it("does not navigate away", () => {
    expect(PRIMITIVES).toContain('<button type="button" onClick={onToggle}');
  });
});

describe("the detail route and getting back from it", () => {
  it("still exists", () => {
    expect(DETAIL).toContain("export default async function PurchasePage");
  });

  it("has a back control at the top", () => {
    expect(DETAIL).toContain("{copy.back}");
    expect(DETAIL).toContain("← ");
    expect(de.business.orderbook.back).toBe("Zurück zum Orderbuch");
  });

  it("returns to the filtered view it came from", () => {
    expect(COMPONENT).toContain("?zurueck=${encodeURIComponent(backHref)}");
    expect(DETAIL).toContain("safeBackHref(query.zurueck)");
    expect(safeBackHref("/business/orderbuch?jahr=2025&monat=12&q=Drobot"))
      .toBe("/business/orderbuch?jahr=2025&monat=12&q=Drobot");
  });

  it("refuses to send the operator anywhere else", () => {
    /*
     * `?zurueck=` arrives from the address bar. Unchecked, the most trusted
     * button on the page becomes an open redirect.
     */
    for (const hostile of ["https://evil.example/x", "//evil.example", "/admin",
                           "javascript:alert(1)", "/business/orderbuchXXX/../../admin"]) {
      expect(safeBackHref(hostile), hostile).toBe("/business/orderbuch");
    }
    expect(safeBackHref(undefined)).toBe("/business/orderbuch");
    expect(safeBackHref("%E0%A4%A")).toBe("/business/orderbuch"); // malformed escape
  });
});

describe("the function is seller-gated like everything else here", () => {
  it("asks the canonical predicate and is read-only", () => {
    expect(LEDGER_SQL).toContain("can_operate_active_seller()");
    expect(LEDGER_SQL).toContain("insufficient_privilege");
    expect(LEDGER_SQL).toContain("security definer");
    expect(LEDGER_SQL).toContain("set search_path = ''");
  });

  it("is granted to authenticated and revoked from anon", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/0056_orderbook_ledger.sql"), "utf8");
    expect(sql).toContain("revoke all on function public.seller_orderbook_ledger(integer, integer, text) from public, anon;");
    expect(sql).toContain("grant execute on function public.seller_orderbook_ledger(integer, integer, text) to authenticated;");
  });

  it("0056 adds a function and touches no table", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/0056_orderbook_ledger.sql"), "utf8");
    expect(code(sql)).not.toMatch(/create table|alter table|drop table|create policy/i);
  });
});


/**
 * Layout, pinned.
 *
 * WHY THIS BLOCK EXISTS, AND WHAT IT COST NOT TO HAVE IT
 *
 * The first redesign described a seven-column row and shipped one that
 * rendered as seven stacked lines. Every test in this file passed — they
 * asserted behaviour, and the whole desktop grid could be deleted without one
 * of them noticing. A screenshot found it instead.
 *
 * These assert the two things a screenshot would otherwise have to: that the
 * column template exists as a real declared rule, and that the header and the
 * rows read the SAME one.
 */
describe("the ledger renders as a table, not as stacked lines", () => {
  it("the column template is a declared CSS rule, not an arbitrary utility", () => {
    /*
     * A Tailwind arbitrary value has to be scanned out of the source,
     * generated and delivered. Miss any link — a dev server that did not
     * re-scan after the class appeared is the usual one — and the element
     * keeps `display:grid` with NO template, which is seven stacked lines.
     */
    expect(ledgerCss.all).toContain(".ob-row");
    expect(ledgerCss.all).toContain(".ob-item");
    expect(COMPONENT_CODE).not.toMatch(/grid-cols-\[/);
  });

  it("the purchase row has exactly seven tracks, in the required order, at every width", () => {
    const columns = tracks(ledgerCss.all, "ob-row");
    expect(columns).toHaveLength(7);
    // Datum · Artikel · Ausgaben · Marktwert · Faktor · Status · Chevron
    expect(columns[0]).toBe("7rem");                    // Datum, fixed
    expect(columns[1]).toBe("4rem");                    // Artikel, fixed
    expect(columns[2]).toContain("minmax");             // Ausgaben, flexible
    expect(columns[3]).toContain("minmax");             // Marktwert, flexible
    expect(columns[6]).toBe("1.5rem");                  // Chevron, in the row
  });

  it("the item row has exactly six tracks, and Aktion keeps its track", () => {
    const columns = tracks(ledgerCss.all, "ob-item");
    expect(columns).toHaveLength(6);
    /*
     * # · Serie · Figur · Marktwert · Status · Aktion
     *
     * Unchanged by Verkauf\'s status dot. Verkauf renders a seventh cell and
     * overrides the list with its own — which is what `--ob-item-columns` is
     * for — so Einkauf keeps exactly these six tracks and this width.
     */
    expect(columns[0]).toBe("2.5rem");                  // #
    expect(columns[1]).toBe("9.5rem");                  // Serie, fixed
    expect(columns[2]).toContain("minmax(0");           // Figur takes the rest
    // A historical row has no button; the track exists anyway, so the columns
    // of a settled row and a bookable one line up instead of shifting.
    expect(columns[5]).toBe("6.5rem");
  });

  it("Serie took its width from Figur, not from the row height", () => {
    // The approved 36px item row must survive a sixth column.
    const item = ledgerCss.all.slice(ledgerCss.all.indexOf(".ob-item {"));
    expect(/min-height:\s*2\.25rem;/.test(item)).toBe(true);
    expect(tracks(ledgerCss.all, "ob-item")[2]).toBe("minmax(0, 1fr)");
  });

  it("the header and the rows come from one primitive, so they cannot drift", () => {
    /*
     * The classes live in `ledger-table.tsx` now, and BOTH ledgers render
     * through it. A ledger that wrote `ob-row` itself would be a second place
     * the table could be defined, which is the thing this refactor removed.
     */
    expect(PRIMITIVES).toContain('className="ob-row sticky top-0');
    expect(PRIMITIVES).toContain('className="ob-row relative');
    expect(PRIMITIVES).toContain('className="ob-item grid');
    expect(PRIMITIVES).toContain('<li className="ob-item bg-canvas text-sm">');
    expect(COMPONENT_CODE).not.toMatch(/className="ob-(row|item)/);
    for (const primitive of ["LedgerTable", "LedgerHead", "LedgerRow", "LedgerItemRow"]) {
      expect(COMPONENT, primitive).toContain(`<${primitive}`);
    }
  });

  it("the grid is never on a <button>", () => {
    /*
     * WebKit wraps a button's content in an anonymous box, so `display:grid`
     * on a `<button>` has historically not laid its children out as grid items
     * at all. The row is a <div>; the click target is stretched over it.
     */
    expect(PRIMITIVES).not.toMatch(/<button[^>]*className="ob-/);
    expect(PRIMITIVES).toContain('className="absolute inset-0 z-10 h-full w-full');
  });

  it("the whole row is still one disclosure control", () => {
    expect(PRIMITIVES).toContain("aria-expanded={expanded}");
    expect(PRIMITIVES).toContain("aria-controls={controls}");
    // The overlay button has no visible text, so it carries its own name.
    expect(PRIMITIVES).toContain('<span className="sr-only">');
    expect(COMPONENT).toContain("controls={`purchase-${purchase.id}`}");
    expect(COMPONENT).toContain("{expanded ? copy.collapse : copy.expand}");
  });

  it("a collapsed row is about one control high, not a card", () => {
    const row = ledgerCss.all.slice(ledgerCss.all.indexOf(".ob-row {"));
    const minHeight = /min-height:\s*([\d.]+)rem;/.exec(row)?.[1];
    expect(minHeight).toBeDefined();
    const px = Number(minHeight) * 16;
    expect(px).toBeGreaterThanOrEqual(44);   // touch target
    expect(px).toBeLessThanOrEqual(52);      // and no taller than a table row
  });

  it("a phone gets the same seven columns, not two stacked lines", () => {
    /*
     * The tracks used to be declared inside `@media (min-width: 48rem)`,
     * with `1fr auto` below it: two lines per row, no header, five values
     * crushed together on the second. That is the layout the owner
     * photographed and could not read.
     *
     * A ledger is a table. A table too wide for the window scrolls.
     */
    const outsideQueries = ledgerCss.mobile;
    expect(outsideQueries).toContain("--ob-columns");
    expect(outsideQueries).toContain("--ob-item-columns");
    expect(outsideQueries).not.toMatch(/grid-template-columns:\s*1fr auto;/);
    // No width-conditional column list is left anywhere, in either direction.
    expect(ledgerCss.desktop).not.toContain("grid-template-columns");
    expect(ledgerCss.all).not.toMatch(/@media[^{]*max-width[^{]*\{[^}]*ob-(row|item)/);
  });

  it("the table scrolls sideways at every width, and the floor is not optional", () => {
    // `.ob-min` used to be rendered only when a ledger passed a width, and
    // Einkauf passed none — so its seven columns had nothing to scroll
    // against and were free to be squeezed.
    expect(ledgerCss.mobile).toMatch(/\.ob-min \{ min-width: var\(--ob-min-width, 0\); \}/);
    expect(PRIMITIVES).toContain('<div className="ob-min">');
    expect(PRIMITIVES).not.toContain("minWidth ? <div");
    expect(PRIMITIVES).toContain('"--ob-min-width": minWidth');
    expect(COMPONENT).toContain("minWidth={PURCHASE_MIN_WIDTH}");
  });

  it("the purchase floor is wide enough for the columns it has to hold", () => {
    /*
     * Not a guess: every track at its narrowest, the gaps between them, and
     * the row's own padding. A floor below that is a floor that still
     * crushes something.
     */
    const declared = /const PURCHASE_MIN_WIDTH = "([\d.]+)rem"/.exec(COMPONENT);
    expect(declared).not.toBeNull();
    const minRem = (track: string): number => {
      const m = /minmax\(\s*([\d.]+)rem/.exec(track);
      if (m) return Number(m[1]);
      if (/minmax\(\s*0/.test(track)) return 0;
      return Number(/([\d.]+)rem/.exec(track)?.[1] ?? 0);
    };
    for (const selector of ["ob-row", "ob-item"] as const) {
      const t = tracks(ledgerCss.all, selector);
      const needed = t.reduce((sum, x) => sum + minRem(x), 0)
        + 0.75 * (t.length - 1) + 0.75 * 2;
      expect(Number(declared![1]), selector).toBeGreaterThanOrEqual(needed);
    }
  });

  it("the page keeps the vertical axis on a phone and the ledger takes it back on desktop", () => {
    /*
     * A table that swallows the downward swipe is the complaint people
     * actually have about tables on phones. Sideways is the ledger's axis;
     * downwards is the page's — until there is a desktop window, where 85
     * purchases would otherwise push the search field off the top.
     */
    expect(ledgerCss.mobile).toMatch(/\.ob-scroll \{\s*overflow-x: auto;\s*overflow-y: hidden;/);
    expect(ledgerCss.desktop).toMatch(/\.ob-scroll \{[\s\S]*?overflow: auto;/);
    expect(ledgerCss.desktop).toMatch(/max-height: min\(62dvh, 42rem\);/);
    // The height is no longer an inline style that applies at every width.
    expect(PRIMITIVES).not.toContain('maxHeight: "min(62dvh, 42rem)"');
    expect(PRIMITIVES).toContain("ob-scroll");
  });

  it("the first column stays put while the rest scrolls under it", () => {
    /*
     * A row of numbers with no date in front of it belongs to nothing. The
     * sticky cell inherits the row's background so the columns passing
     * beneath are hidden — which is why the row is opaque — and the overlay
     * button outranks it so the whole row is still one click target.
     */
    const sticky = ledgerCss.all.slice(ledgerCss.all.indexOf(".ob-row > :first-child"));
    expect(sticky).toContain("position: sticky");
    expect(sticky).toContain("left: 0");
    expect(sticky).toContain("background: inherit");
    // Pulled over the row's own padding, or the scrolled content shows
    // through a 0.75rem stripe at the left edge.
    expect(sticky).toContain("margin-left: -0.75rem");
    expect(sticky).toContain("padding-left: 0.75rem");
    expect(ledgerCss.all).toContain(".ob-item > :first-child");

    expect(PRIMITIVES).toContain("bg-surface text-sm hover:bg-surface-raised");
    expect(PRIMITIVES).not.toContain("bg-surface/60 text-sm");
    // `isolate` keeps the button's z-index inside its row, so it cannot also
    // paint over the sticky header on a vertical scroll.
    expect(PRIMITIVES).toContain("ob-row relative isolate");
    expect(PRIMITIVES).toContain("absolute inset-0 z-10");
  });

  it("the expansion has a real background token", () => {
    // `bg-bg/40` named no theme colour, so no utility was ever generated
    // and the expansion had no background at all.
    expect(PRIMITIVES_CODE).not.toContain("bg-bg/");
    expect(PRIMITIVES_CODE).toContain("bg-canvas");
    expect(CSS).toContain("--color-canvas:");
  });

  it("the Excel provenance is no longer printed in the ledger", () => {
    /*
     * `Drobot · Excel: DRobot` spent the width on how the name was once typed
     * and still left `Drobot` ambiguous between two games. The raw text is
     * untouched in the database and still shown on the correction screen,
     * where it is the evidence being corrected.
     */
    expect(COMPONENT_CODE).not.toContain("rawLabel");
    expect(COMPONENT_CODE).not.toContain("item.rawName");
  });

  it("and the ledger still scrolls inside itself", () => {
    // `overflow-auto` was a utility on the element; the axis depends on the
    // viewport now, so it is `.ob-scroll` in the stylesheet instead.
    expect(PRIMITIVES).toContain("ob-scroll");
    expect(ledgerCss.desktop).toContain("62dvh");
  });
});


/**
 * Serie in the item table.
 *
 * WHY IT IS THERE AT ALL: 32 display names in the real catalog belong to more
 * than one game — `Chop Chop` and `Cynder` are both Spyro's Adventure AND
 * Giants figures — so a ledger line reading `Drobot` does not say which shelf
 * the unit came off. `Serie + Figur` does.
 */
describe("Serie comes from the catalog and nowhere else", () => {
  const QUERIES = read("src/lib/orderbook/queries.ts");

  it("is read from the canonical `series` table", () => {
    expect(QUERIES).toContain('from("series").select("code, label")');
    expect(QUERIES).toContain("fetchSeriesLabels");
  });

  it("is keyed by the CATALOG row's series_code, never by anything guessable", () => {
    expect(QUERIES).toContain("series.get(String(i.series_code))");
    // Not parsed out of the raw Excel text, the sky_id or the sheet name.
    expect(QUERIES).not.toMatch(/seriesLabel[^;]*raw_name/);
    expect(QUERIES).not.toMatch(/seriesLabel[^;]*sky_id\.slice/);
    expect(QUERIES).not.toMatch(/seriesLabel[^;]*source/);
  });

  it("falls back to the code rather than inventing a label", () => {
    // `SA` is honest for a series the table does not carry; a made-up name is not.
    expect(QUERIES).toContain("?? String(i.series_code)");
  });

  it("a non-figure gets no series at all", () => {
    // sky_id NULL -> series_code NULL -> null -> the screen shows a dash.
    expect(QUERIES).toContain("i.series_code\n          ? series.get");
  });

  it("the screen renders a dash for it, and never a game", () => {
    expect(COMPONENT).toContain('{item.seriesLabel ?? "—"}');
  });

  it("the column sits between # and Figur, in the header and the rows", () => {
    const header = COMPONENT.slice(COMPONENT.indexOf('<span>#</span>'));
    const seriesAt = header.indexOf("copy.itemColumns.series");
    const figureAt = header.indexOf("copy.itemColumns.figure");
    expect(seriesAt).toBeGreaterThan(-1);
    expect(seriesAt).toBeLessThan(figureAt);

    const row = COMPONENT.slice(COMPONENT.indexOf("<LedgerItemRow>"));
    expect(row.indexOf("item.seriesLabel")).toBeLessThan(row.indexOf("{item.name}"));
  });

  it("is a human label, not an internal code", () => {
    expect(de.business.orderbook.itemColumns.series).toBe("Serie");
    // The label comes from `series.label` — the same source every other screen
    // in the product prints — so the Orderbuch does not grow a second scheme.
    expect(QUERIES).toContain("String(row.label)");
  });

  it("the detail screen shows the same label", () => {
    const detailItems = read("src/components/business/purchase-items.tsx");
    expect(detailItems).toContain('{item.seriesLabel ?? "—"}');
  });
});

describe("searching by game", () => {
  const SQL57 = read("supabase/migrations/0057_orderbook_series_search.sql");

  it("matches the series LABEL, because `SA` is not what anyone types", () => {
    expect(LEDGER_SQL).toContain("left join public.series se on se.code = s.series_code");
    expect(LEDGER_SQL).toContain("se.label   ilike '%' || v_q || '%'");
  });

  it("0057 replaces the function instead of rewriting applied 0056", () => {
    expect(SQL57).toContain("create or replace function public.seller_orderbook_ledger");
    expect(code(SQL57)).not.toMatch(/create table|alter table|drop function/i);
  });

  it("and changes nothing else about it", () => {
    // Same gate, same ordering, same summary arithmetic.
    expect(LEDGER_SQL).toContain("can_operate_active_seller()");
    /*
     * `nulls last`, and that word is the point: Postgres sorts NULLs FIRST
     * under `desc`, which would put thirteen dateless purchases above the
     * newest real one and make them read as this week's parcels.
     */
    expect(LEDGER_SQL).toContain("order by m.purchased_at desc nulls last, m.id desc");
    expect(LEDGER_SQL).toContain("sum(m.total_cost) / sum(m.known_value)");
    expect(LEDGER_SQL).not.toMatch(/avg\s*\(/i);
  });

  it("the older search fields are all still matched", () => {
    for (const field of ["i.raw_name ilike", "s.name     ilike", "i.sky_id   ilike",
                         "to_char(h.purchased_at, 'DD.MM.YYYY')", "h.total_cost::text",
                         "round(h.known_value, 2)::text", "h.source"]) {
      expect(LEDGER_SQL, field).toContain(field);
    }
  });
});
