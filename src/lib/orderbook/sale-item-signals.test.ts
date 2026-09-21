import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

import { de } from "@/lib/i18n/de";
import { saleItemIndicator, type SaleItemStatus } from "./sales-view";

/**
 * Two things a sold position has to communicate, and the two ways it failed.
 *
 * The dot says at a glance whether anything is still owed. The message says
 * why an action was refused — and four of `seller_book_sale_item`'s seven
 * refusals had no mapping at all, so the database's precise reason arrived as
 * "Das hat nicht geklappt."
 */

const ACTIONS = readFileSync("src/lib/orderbook/sales-actions.ts", "utf8");
const INDICATOR = readFileSync("src/components/business/sale-indicator.tsx", "utf8");
const copy = de.business.sales;

const ALL_STATES: SaleItemStatus[] = [
  "open", "shipped", "outbooked", "return_announced",
  "returned", "restocked", "settled", "not_shipped",
];

describe("the indicator is derived, and says the same thing twice", () => {
  it("grey ○ while nothing has left the shelf", () => {
    for (const shipped of [true, false]) {
      expect(saleItemIndicator("open", shipped)).toEqual({ tone: "grey", glyph: "○" });
      expect(saleItemIndicator("shipped", shipped)).toEqual({ tone: "grey", glyph: "○" });
    }
  });

  /** The one split a status cannot make on its own. */
  it("amber ✓ when the stock left but the parcel has not", () => {
    expect(saleItemIndicator("outbooked", false)).toEqual({ tone: "amber", glyph: "✓" });
  });

  it("green ✓ once nothing is outstanding", () => {
    expect(saleItemIndicator("outbooked", true)).toEqual({ tone: "green", glyph: "✓" });
    for (const shipped of [true, false]) {
      expect(saleItemIndicator("settled", shipped).tone).toBe("green");
      expect(saleItemIndicator("not_shipped", shipped).tone).toBe("green");
    }
  });

  it("orange ! while a return is in flight or waiting to be put away", () => {
    for (const shipped of [true, false]) {
      expect(saleItemIndicator("return_announced", shipped)).toEqual({ tone: "orange", glyph: "!" });
      expect(saleItemIndicator("returned", shipped)).toEqual({ tone: "orange", glyph: "!" });
    }
  });

  it("orange ✓ once the return is back in stock", () => {
    expect(saleItemIndicator("restocked", true)).toEqual({ tone: "returned", glyph: "✓" });
  });

  it("answers for every state there is, and invents none", () => {
    for (const state of ALL_STATES) {
      const dot = saleItemIndicator(state, true);
      expect(["grey", "amber", "green", "orange", "returned"], state).toContain(dot.tone);
      expect(["○", "✓", "!"], state).toContain(dot.glyph);
    }
  });

  /**
   * COLOUR IS NEVER THE ONLY CARRIER. Two independent guarantees: a tone that
   * shares its glyph with another tone must still be told apart by its label,
   * and the component must expose that label to assistive technology.
   */
  it("carries a glyph as well as a colour", () => {
    const grey = saleItemIndicator("open", false);
    const amber = saleItemIndicator("outbooked", false);
    const orange = saleItemIndicator("returned", false);
    expect(grey.glyph).not.toBe(amber.glyph);
    expect(orange.glyph).not.toBe(amber.glyph);
  });

  it("names every state in words, and the amber case separately", () => {
    for (const state of ALL_STATES) {
      const label = copy.itemIndicator[state as keyof typeof copy.itemIndicator];
      expect(typeof label, state).toBe("string");
      expect(String(label).length, state).toBeGreaterThan(8);
    }
    // `outbooked` is two different situations, so it is two different labels.
    expect(copy.itemIndicator.outbookedUnshipped).not.toBe(copy.itemIndicator.outbooked);
  });

  it("exposes the label to a screen reader, not only as a tooltip", () => {
    expect(INDICATOR).toContain("aria-label={label}");
    expect(INDICATOR).toContain('role="img"');
    // One class per tone, written out: a runtime-built name is never generated.
    for (const tone of ["grey", "amber", "green", "orange", "returned"]) {
      expect(INDICATOR, tone).toContain(`${tone}:`);
    }
  });

  it("stores nothing: the dot is a function of facts the row already has", () => {
    const view = readFileSync("src/lib/orderbook/sales-view.ts", "utf8");
    const fn = view.slice(view.indexOf("export function saleItemIndicator"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    for (const forbidden of ["indicator_", "tone_", "status_column"]) {
      expect(body).not.toContain(forbidden);
    }
    const migrations = readdirSync("supabase/migrations");
    expect(migrations.some((m) => /indicator|tone/i.test(m))).toBe(false);
  });
});

describe("the indicator is a column of its own, and the sticky one", () => {
  const LEDGER = readFileSync("src/components/business/sales-ledger.tsx", "utf8");
  const DETAIL = readFileSync("src/components/business/sale-items.tsx", "utf8");
  const CSS = readFileSync("src/app/globals.css", "utf8");
  /**
   * `a b minmax(0, 1fr) c` → four tracks, with the minmax kept whole.
   *
   * The CSS capture carries the `var(...)`\'s own closing paren; left on, it
   * makes the negative lookahead below think every space is inside a
   * function and the whole list comes back as one track.
   */
  const tracks = (list: string) =>
    list.trim().replace(/\)$/, "").trim().split(/ (?![^(]*\))/);

  const SALE = /export const SALE_ITEM_COLUMNS =\s*\n?\s*"([^"]*)"/.exec(INDICATOR)![1];
  const EINKAUF = /grid-template-columns: var\(--ob-item-columns,\s*([^)]*\)[^;]*)/
    .exec(CSS)![1].replace(/\s+/g, " ").trim();

  it("Verkauf has seven tracks, Einkauf still six", () => {
    expect(tracks(SALE)).toHaveLength(7);
    expect(tracks(EINKAUF)).toHaveLength(6);
  });

  /** Einkauf must not pay for a column it does not render. */
  it("Verkauf's seven are Einkauf's six with one narrow cell in front", () => {
    expect(tracks(SALE).slice(1)).toEqual(tracks(EINKAUF));
    expect(tracks(SALE)[0]).toBe("1.25rem");
    // The purchase number keeps the width it always had.
    expect(tracks(EINKAUF)[0]).toBe("2.5rem");
  });

  /**
   * ON A PHONE, THE DOT IS WHAT STAYS. `.ob-item > :first-child` is the
   * sticky cell, and on a sale the first child is the indicator — so the
   * state is readable at any scroll position while `#` is free to scroll
   * away, which costs nothing.
   */
  it("the sticky cell is the indicator, on both sale screens", () => {
    expect(CSS).toContain(".ob-item > :first-child");
    const sticky = CSS.slice(CSS.indexOf(".ob-item > :first-child"));
    expect(sticky.slice(0, 200)).toContain("position: sticky");

    for (const [name, source] of [["Verkaufsbuch", LEDGER],
                                  ["Verkauf-Detail", DETAIL]] as const) {
      const rows = [...source.matchAll(/<LedgerItemRow[^>]*>/g)].map((m) =>
        source.slice(m.index!, source.indexOf("</LedgerItemRow>", m.index!)));
      expect(rows.length, name).toBeGreaterThan(0);
      for (const row of rows) {
        const first = /<(span|SaleIndicator)[\s/>]/.exec(row.slice(row.indexOf(">") + 1));
        expect(first?.[1], `${name}: first cell`).toBe("SaleIndicator");
      }
    }
  });

  it("the indicator column carries no heading it is too narrow for", () => {
    for (const source of [LEDGER, DETAIL]) {
      const head = source.slice(source.indexOf("<LedgerItemHead>"),
                                source.indexOf("</LedgerItemHead>"));
      expect(head).toContain('<span aria-hidden="true" />');
    }
  });

  it("the detail floor grew with the column, not beyond it", () => {
    const floor = Number(/const ITEM_MIN_WIDTH = "([\d.]+)rem"/.exec(DETAIL)![1]);
    const fixed = tracks(SALE).slice(0, 3).concat(tracks(SALE).slice(4))
      .reduce((sum, t) => sum + Number(/([\d.]+)rem/.exec(t)?.[1] ?? 0), 0);
    const chrome = 0.75 * 6 + 1.5;
    // Figur gets at least the readable 8rem the layout test enforces.
    expect(floor - fixed - chrome).toBeGreaterThanOrEqual(8);
  });
});

/**
 * THE CLASS OF BUG, NOT THE FOUR INSTANCES.
 *
 * `message()` turns a Postgres error into a sentence by substring match. A
 * refusal nobody added a pattern for silently becomes the generic fallback —
 * which is what 0073 did three times over, and what the operator saw.
 *
 * So the test is not "these four are mapped". It is: every refusal these
 * functions can raise is either mapped or explicitly listed as deliberately
 * generic.
 */
describe("every refusal a sale action can hit has a sentence", () => {
  const FUNCTIONS = [
    "seller_book_sale_item", "seller_settle_sale_item",
    "seller_set_sale_item_not_shipped", "seller_announce_sale_item_return",
  ];

  /** Latest definition wins, as it does in the database. */
  const latest = (name: string): string => {
    const files = readdirSync("supabase/migrations").sort();
    let body = "";
    for (const f of files) {
      const sql = readFileSync(`supabase/migrations/${f}`, "utf8");
      const at = sql.indexOf(`create or replace function public.${name}(`);
      if (at !== -1) body = sql.slice(at, sql.indexOf("\n$$;", at));
    }
    return body;
  };

  /** Every `text.includes("…")` pattern the mapper knows. */
  const patterns = [...ACTIONS.matchAll(/text\.includes\("([^"]+)"\)/g)].map((m) => m[1]);

  /**
   * Refusals that may stay generic, each for a stated reason.
   *
   * `seller operator role required` is matched by code, not by text; the
   * other two cannot be reached from a button this screen offers, and saying
   * so is more honest than inventing a sentence nobody will read.
   */
  const DELIBERATELY_GENERIC = [
    "seller operator role required",
    "no such sale item",
  ];

  it("finds the functions to check", () => {
    for (const fn of FUNCTIONS) expect(latest(fn), fn).not.toBe("");
    expect(patterns.length).toBeGreaterThan(15);
  });

  it.each(FUNCTIONS)("%s", (fn) => {
    const body = latest(fn);
    /* SQL writes an apostrophe as `''`, so the literal does not end there. */
    const raised = [...body.matchAll(/raise exception\s*\n?\s*'((?:[^']|'')+)'/g)]
      .map((m) => m[1].replace(/''/g, "'").replace(/%/g, "").trim());
    expect(raised.length, `${fn} raises nothing?`).toBeGreaterThan(0);

    const unmapped = raised.filter((text) =>
      !DELIBERATELY_GENERIC.includes(text) && !patterns.some((p) => text.includes(p)));
    expect(unmapped, `${fn}: no message for these refusals`).toEqual([]);
  });

  it("the four 0073 added are mapped to their own sentences", () => {
    for (const [pattern, sentence] of [
      ["nothing left the shelf", copy.errors.saleCancelled],
      ["already moved this stock", copy.errors.commerceOwned],
      // Broadened to `already closed`: `seller_set_sale_item_not_shipped`
      // raises the shorter wording, and both mean the same to a reader.
      ["already closed", copy.errors.alreadySettled],
      ["not taken from stock", copy.errors.notFromStock],
    ] as const) {
      expect(ACTIONS, pattern).toContain(`text.includes("${pattern}")`);
      expect(String(sentence).length).toBeGreaterThan(20);
    }
  });

  /** And what is still unmapped no longer disappears. */
  it("logs an unmapped error instead of swallowing it", () => {
    const fallback = ACTIONS.slice(ACTIONS.indexOf("return de.admin.writeFailed"));
    expect(ACTIONS).toContain("orderbook sale action: unmapped");
    expect(fallback.length).toBeGreaterThan(0);
    // The log carries code and message only — never details or hint.
    expect(ACTIONS).not.toContain("error.details");
    expect(ACTIONS).not.toContain("error.hint");
  });
});
