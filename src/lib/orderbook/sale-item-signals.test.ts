import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

import { de } from "@/lib/i18n/de";
import {
  legacyOutcome, saleItemActions, saleItemIndicator,
  type LegacyOutcome, type SaleItemStatus,
} from "./sales-view";

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
    }
  });

  /*
   * STORNIERT IST EIN ENDE OHNE ERFOLG, UND SIEHT AUCH SO AUS.
   *
   * Es teilte sich den grünen Haken mit `settled`, und eine stornierte
   * Position las sich wie eine erledigte. Sie ist weiterhin abgeschlossen —
   * `saleItemClosed` ist davon unberührt —, trägt aber das Symbol, das es
   * für diesen Ausgang schon gab: den grauen Rückwärtspfeil der importierten
   * `-`/`-`-Zeile. Ein Zustand, ein Symbol.
   */
  it("grey ↩ for a position that never went out", () => {
    for (const shipped of [true, false]) {
      expect(saleItemIndicator("not_shipped", shipped)).toEqual({ tone: "grey", glyph: "↩" });
    }
    expect(saleItemIndicator("not_shipped", false).glyph).not.toBe("✓");
    // Dasselbe Symbol, das die Arbeitsmappe für denselben Ausgang bekommt.
    expect(saleItemIndicator("settled", false, { historical: true, outcome: "not_shipped" }))
      .toEqual(saleItemIndicator("not_shipped", false));
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
      expect(["○", "✓", "!", "↩"], state).toContain(dot.glyph);
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

describe("imported history is finished, and is not booked out from here", () => {
  const item = (over: Record<string, unknown> = {}) => ({
    sky_id: "SKY-0010", movement_id: null, return_movement_id: null,
    returned_at: null, return_announced_at: null, settled_at: null,
    not_shipped_at: null, legacy_stock_flag: null, ...over,
  }) as never;
  const ctx = (over: Record<string, unknown> = {}) =>
    ({ frozen: false, cancelled: false, shipped: true, ...over }) as never;

  /**
   * The three markers column L of the workbook can carry, and the absence
   * of one. 1 061 of Production's 1 253 imported lines have a marker; the
   * 192 that do not are exactly the ones 0071 released to be worked on.
   */
  /*
   * THE FOUR OUTCOMES, BINDING SINCE 2026-09-21 (0087).
   *
   * Column L decides; column M is consulted only for the one pair L cannot
   * resolve alone. Until this date all three of x, `-` and r got the same
   * green tick, so a figure that never shipped looked delivered.
   */
  it("derives one outcome per workbook marker", () => {
    expect(legacyOutcome({ legacy_stock_flag: "x", legacy_shipped_flag: "x", sky_id: "SKY-0001" }))
      .toBe("shipped");
    expect(legacyOutcome({ legacy_stock_flag: "-", legacy_shipped_flag: "-", sky_id: "SKY-0001" }))
      .toBe("not_shipped");
    expect(legacyOutcome({ legacy_stock_flag: "r", legacy_shipped_flag: "x", sky_id: "SKY-0001" }))
      .toBe("returned");
    expect(legacyOutcome({ legacy_stock_flag: "l", legacy_shipped_flag: "x", sky_id: "SKY-0001" }))
      .toBe("lost");
  });

  it("lets column L decide when M contradicts it", () => {
    // The owner's ruling: a stray `x` in M is an old typing mistake.
    expect(legacyOutcome({ legacy_stock_flag: "l", legacy_shipped_flag: "-", sky_id: "SKY-1" }))
      .toBe("lost");
    expect(legacyOutcome({ legacy_stock_flag: "r", legacy_shipped_flag: "r", sky_id: "SKY-1" }))
      .toBe("returned");
    expect(legacyOutcome({ legacy_stock_flag: "x", legacy_shipped_flag: "", sky_id: "SKY-1" }))
      .toBe("shipped");
  });

  /** The Battlecast packs: sold and shipped, never in the figure inventory. */
  it("calls an unreferenced `-`/`x` line shipped without a stock claim", () => {
    expect(legacyOutcome({ legacy_stock_flag: "-", legacy_shipped_flag: "x", sky_id: null }))
      .toBe("shipped_unreferenced");
  });

  /*
   * THE SAME PAIR ON A REAL FIGURE IS NOT SILENTLY TREATED AS BATTLECAST.
   *
   * Nobody has defined what `-`/`x` means for a referenced figure, so it is
   * not guessed. No such row exists today; this keeps it that way.
   */
  it("refuses to interpret a referenced `-`/`x`", () => {
    expect(legacyOutcome({ legacy_stock_flag: "-", legacy_shipped_flag: "x", sky_id: "SKY-0181" }))
      .toBe("unresolved");
  });

  it("says nothing where the workbook recorded nothing", () => {
    for (const flag of [null, undefined, "", "  "]) {
      expect(legacyOutcome({ legacy_stock_flag: flag as string, sky_id: "SKY-1" }), String(flag))
        .toBeNull();
    }
  });

  it("does not invent a meaning for an undefined marker", () => {
    for (const flag of ["q", "done", "1"]) {
      expect(legacyOutcome({ legacy_stock_flag: flag, sky_id: "SKY-1" }), flag).toBe("unresolved");
    }
  });

  it("gives each outcome its own dot, and only shipped gets the tick", () => {
    const dot = (outcome: LegacyOutcome) =>
      saleItemIndicator("shipped", true, { historical: true, outcome });
    expect(dot("shipped")).toEqual({ tone: "green", glyph: "✓" });
    expect(dot("shipped_unreferenced")).toEqual({ tone: "green", glyph: "✓" });
    expect(dot("returned").glyph).not.toBe("✓");
    expect(dot("lost").glyph).not.toBe("✓");
    expect(dot("not_shipped").glyph).not.toBe("✓");
    // Four distinct appearances, so no two states look alike.
    const seen = (["shipped", "returned", "lost", "not_shipped"] as const)
      .map((o) => JSON.stringify(dot(o)));
    expect(new Set(seen).size).toBe(4);
  });

  /*
   * `settled_at` IS OUR BOOKKEEPING, NOT A FACT ABOUT THE OBJECT.
   *
   * 0081 wrote it on 191 imported lines in one run. It must not turn a line
   * the workbook calls lost or never-shipped into a green "Erledigt".
   */
  it("does not let settled_at overwrite the workbook's outcome", () => {
    for (const outcome of ["lost", "not_shipped", "returned"] as const) {
      const dot = saleItemIndicator("settled", true, { historical: true, outcome });
      expect(dot.glyph, outcome).not.toBe("✓");
    }
    expect(saleItemIndicator("settled", true, { historical: true, outcome: "shipped" }))
      .toEqual({ tone: "green", glyph: "✓" });
  });

  /** The 192 with no marker are gone from the workbook, but the rule stays. */
  it("an unrecorded historical line stays grey", () => {
    expect(saleItemIndicator("shipped", true, { historical: true, outcome: null }).tone)
      .toBe("grey");
    expect(saleItemIndicator("open", false, { historical: true, outcome: null }).tone)
      .toBe("grey");
  });

  /**
   * Present-tense work outranks the workbook. A line that HAS a movement or
   * a return in flight is describing today, not 2026's import.
   */
  it("never paints over a live movement or a return", () => {
    const legacy = { historical: true, outcome: "shipped" as LegacyOutcome };
    expect(saleItemIndicator("return_announced", true, legacy).tone).toBe("orange");
    expect(saleItemIndicator("returned", true, legacy).tone).toBe("orange");
    expect(saleItemIndicator("restocked", true, legacy).tone).toBe("returned");
    expect(saleItemIndicator("outbooked", false, legacy).tone).toBe("amber");
  });

  it("a non-historical sale is unaffected by the marker", () => {
    expect(saleItemIndicator("shipped", true, { historical: false, outcome: "shipped" }).tone)
      .toBe("grey");
    // And the old two-argument call still means what it did.
    expect(saleItemIndicator("shipped", true).tone).toBe("grey");
  });

  /**
   * THE DOUBLE-BOOKING HOLD.
   *
   * `seller_book_sale_item` would accept the 192 released lines — 0071
   * released them for exactly that. But the reconciled workbook stock
   * already contains their effect, so booking one now takes the same piece
   * off the shelf twice. The refusal therefore lives here, and it is a hold
   * rather than a rule: nothing in the database changed.
   */
  it("offers no Ausbuchen on an imported line, released or not", () => {
    const can = saleItemActions(item(), ctx({ historical: true }));
    expect(can.primary).toBeNull();
    expect(can.heldForReconciliation).toBe(true);
  });

  it("still offers it on a normal sale", () => {
    const can = saleItemActions(item(), ctx({ historical: false }));
    expect(can.primary).toBe("book");
    expect(can.heldForReconciliation).toBe(false);
  });

  /** Timestamps write no movement, so they are not held back. */
  it("keeps the endings that move no stock", () => {
    const notAFigure = saleItemActions(item({ sky_id: null }), ctx({ historical: true }));
    expect(notAFigure.primary).toBe("settle");
    const shelf = saleItemActions(item(), ctx({ historical: true }));
    expect(shelf.canNotShip).toBe(true);
  });

  it("holds nothing back on a frozen or cancelled sale, which had nothing to offer", () => {
    for (const over of [{ frozen: true }, { cancelled: true }]) {
      const can = saleItemActions(item(), ctx({ historical: true, ...over }));
      expect(can.primary).toBeNull();
      expect(can.heldForReconciliation).toBe(false);
    }
  });

  it("both sale screens pass the flag and say why the button is gone", () => {
    for (const source of [
      readFileSync("src/components/business/sales-ledger.tsx", "utf8"),
      readFileSync("src/components/business/sale-items.tsx", "utf8"),
    ]) {
      expect(source).toContain("historical,");
      expect(source).toContain("legacyOutcome(item as never)");
      expect(source).toContain("can.heldForReconciliation");
      expect(source).toContain("itemActionHeld");
    }
  });

  it("creates no inventory movement to achieve any of it", () => {
    const view = readFileSync("src/lib/orderbook/sales-view.ts", "utf8");
    for (const forbidden of ["record_inventory_movement", "apply_inventory_movement",
                             "shop_inventory", "rpc("]) {
      expect(view).not.toContain(forbidden);
    }
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
    /*
     * ZWEI SPUREN WEICHEN AB, UND BEIDE, WEIL DIE ZELLE ETWAS ANDERES ENTHÄLT.
     *
     * `Serie` — Einkauf schreibt die Serie aus (`seriesLabel`), ein Verkauf
     * zeigt das Kürzel (`series_code`, ein bis zwei Zeichen). 9,5rem für „T"
     * waren eine Lücke, die der Figurenspalte abging.
     *
     * `Aktion` — die Aktionsspalte eines Verkaufs trägt seit 0090/0092 zwei
     * Steuerelemente nebeneinander, „Verschickt" und das × zum Stornieren;
     * ein Einkauf hat dort höchstens eines.
     *
     * Der Rest bleibt Spur für Spur derselbe: wer eine dritte Abweichung
     * einführt, fällt hier auf und muss sie begründen.
     */
    expect(tracks(SALE).slice(3, -1)).toEqual(tracks(EINKAUF).slice(2, -1));
    expect(tracks(SALE)[0]).toBe("1.25rem");
    expect(tracks(SALE)[1]).toBe(tracks(EINKAUF)[0]);   // `#`, unverändert
    // Die Kürzelspalte ist deutlich schmaler als die ausgeschriebene.
    expect(tracks(SALE)[2]).toBe("3.5rem");
    expect(tracks(EINKAUF)[1]).toBe("9.5rem");
    expect(Number(/([\d.]+)rem/.exec(tracks(SALE)[2])![1]))
      .toBeLessThan(Number(/([\d.]+)rem/.exec(tracks(EINKAUF)[1])![1]) / 2);
    // Und die flexible Figurenspalte steht bei beiden an derselben Stelle.
    expect(tracks(SALE)[3]).toBe("minmax(0, 1fr)");
    expect(tracks(SALE).at(-1)).toBe("9rem");
    expect(tracks(EINKAUF).at(-1)).toBe("6.5rem");
    // The purchase number keeps the width it always had.
    expect(tracks(EINKAUF)[0]).toBe("2.5rem");
  });

  /*
   * Und der Platz, der dabei frei wird, landet in der Figurenspalte — nicht
   * im Rand. Deshalb sinkt der Boden der Detailansicht mit, sonst wäre der
   * Gewinn nur Leerraum.
   */
  it("hands the freed width to the figure column, not to the margin", () => {
    const floor = Number(/const ITEM_MIN_WIDTH = "([\d.]+)rem"/.exec(DETAIL)![1]);
    const fixed = tracks(SALE).filter((t) => t.includes("rem") && !t.includes("minmax"))
      .reduce((sum, t) => sum + Number(/([\d.]+)rem/.exec(t)![1]), 0);
    const chrome = 0.75 * 6 + 1.5;
    const figure = floor - fixed - chrome;
    expect(figure).toBeGreaterThanOrEqual(8);
    // Kein aufgeblähter Boden: die Figur bekommt den Gewinn, nicht der Rand.
    expect(figure).toBeLessThan(9);
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
