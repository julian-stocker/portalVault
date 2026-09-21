import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Lager V2 — the card and its history (ADR-0102).
 *
 * Source assertions, like the rest of this folder: the rules worth pinning
 * here are structural, and a rendered snapshot would pin the markup instead.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("/*");
    })
    .join("\n");
}

const CARD = code("src/components/admin/inventory-card.tsx");
const LEDGER = code("src/components/admin/stock-ledger.tsx");
const HISTORY = code("src/lib/admin/stock-history.ts");
const PAGE = code("src/app/(business)/business/inventory/page.tsx");

/**
 * Both components alias `de.inventory` to `copy`, so a label is referenced
 * either way. Asserting on the key rather than on the prefix keeps these
 * from breaking the next time somebody adds or removes the alias.
 */
function usesLabel(source: string, key: string): boolean {
  return new RegExp(`\\b(?:copy|de\\.inventory)\\.${key}\\b`).test(source);
}

describe("the three numbers at the top of a card", () => {
  it("shows bought, sold and stock on one line, in that order", () => {
    for (const key of ["purchased", "sold", "stockLabel"]) {
      expect(usesLabel(CARD, key), key).toBe(true);
    }
    // Order matters: `Bestand` is last because it is the one that gets
    // touched, and it ends up beside the stepper instead of splitting it.
    const at = (key: string) => CARD.search(new RegExp(`\\bcopy\\.${key}\\b`));
    expect(at("purchased")).toBeLessThan(at("sold"));
    expect(at("sold")).toBeLessThan(at("stockLabel"));
    // One row rather than a stack, grouped left, and no box around the
    // three — `justify-between` on a wide card is what produced the empty
    // middle the first two passes had.
    expect(CARD).toContain("flex flex-wrap items-center gap-x-4");
    expect(CARD).not.toContain("grid-cols-3");
    // The three rows group left; only the history header pushes its count
    // to the far edge, which is what its mock asks for.
    const rows = CARD.slice(CARD.indexOf("{/* 1."), CARD.indexOf("{failed ?"));
    expect(rows).not.toContain("justify-between");
  });

  it("takes bought and sold from one place, not from the markup", () => {
    expect(CARD).toContain("tradeCounters(legacyTotals, movements)");
  });

  it("takes stock from the position, never from the history", () => {
    // `shop_inventory.quantity`, passed straight into the stepper.
    expect(CARD).toContain("quantity={position.quantity}");
    expect(CARD).not.toMatch(/quantity=\{[^}]*(entries|movements|legacy)/);
  });

  it("does not add the two conditions together", () => {
    // A card is one position — SKY-ID plus condition — and loose and boxed
    // are separate shelves with separate prices and histories.
    expect(CARD).toContain("condition={position.condition}");
    expect(CARD).not.toContain("CONDITIONS.reduce");
  });
});

describe("Verfügbar appears only when something is promised", () => {
  it("is hidden while nothing is reserved", () => {
    // With reserved 0 it is the same number as Bestand, and a second copy
    // of a number teaches a reader that one of them means something else.
    expect(CARD).toContain("{position.reserved > 0 ? (");
    expect(usesLabel(CARD, "available")).toBe(true);
  });
});

describe("the detailed booking is off the card", () => {
  it("leaves −/+ as the manual correction path", () => {
    expect(CARD).not.toContain("StockDialog");
    expect(CARD).not.toContain("changeStock");
    expect(CARD).toContain("<StockStepper");
  });
});

describe("the history is one list from two sources", () => {
  it("merges them rather than rendering two blocks", () => {
    expect(CARD).toContain("mergeHistory(legacy ?? [], movements)");
    expect(LEDGER).toContain("entries.map((entry)");
  });

  it("marks which source a row came from, quietly", () => {
    // ○ reconstructed, ● booked. One mark and a word — two lists would
    // suggest two histories, a loud treatment that one is suspect.
    expect(LEDGER).toContain('{legacy ? "\u25cb" : "\u25cf"}');
    expect(usesLabel(LEDGER, "historyLegacy")).toBe(true);
  });

  it("fetches the reconstructed events only when a card is opened", () => {
    expect(CARD).toContain("loadLegacyEvents(position.skyId, position.condition)");
    expect(PAGE).not.toContain("fetchLegacyEvents");
  });

  it("loads the reconstruction's totals once for the whole page", () => {
    expect(PAGE).toContain("fetchLegacyTotals()");
  });
});

describe("no historical running balance, anywhere", () => {
  /**
   * ADR-0102 gave the curve up: the reconstruction guarantees its end, not
   * its path, and for fifteen figures the intermediate sums go negative.
   * A "stock after" column would present that gap as a fact.
   */
  it("is not computed in the merge", () => {
    expect(HISTORY).not.toMatch(/\brunning\w*\s*[+-]?=/);
    expect(HISTORY).not.toContain("balanceAfter");
  });

  it("is not rendered in the table", () => {
    expect(LEDGER).not.toContain("balance");
    expect(LEDGER).not.toContain("Bestand nach");
    // Four columns and no fifth that could hold one.
    for (const key of ["historyDate", "historyBooking", "historyAmount", "historyValue"]) {
      expect(usesLabel(LEDGER, key), key).toBe(true);
    }
  });

  it("says so where a later reader will look", () => {
    expect(usesLabel(LEDGER, "historyHint")).toBe(true);
  });
});

describe("the market value is never invented", () => {
  it("prints a dash where none was recorded", () => {
    expect(LEDGER).toContain("entry.marketValue === null ? copy.historyNoValue");
  });

  it("does not reach for today's catalog price", () => {
    expect(LEDGER).not.toContain("marketPrice");
    expect(LEDGER).not.toContain("figure");
  });
});

describe("the history scrolls, the card does not grow", () => {
  it("caps the viewport instead of fixing a height", () => {
    // max-h, so three movements do not leave a hand's width of empty box.
    expect(LEDGER).toContain("max-h-[13.75rem]");
    expect(LEDGER).toContain("overflow-y-auto");
  });

  it("scrolls only itself", () => {
    expect(LEDGER).toContain("overscroll-contain");
  });

  it("parks at the newest entry when it opens", () => {
    expect(LEDGER).toContain("node.scrollTop = node.scrollHeight;");
    expect(LEDGER).toContain("}, [entries]);");
  });

  it("never scrolls sideways out of the card", () => {
    expect(LEDGER).not.toContain("overflow-x");
    expect(LEDGER).not.toContain("min-w-[");
    // The kind column is the one that gives, so two numbers cannot be
    // pushed off a 390 px screen.
    expect(LEDGER).toContain("minmax(0,1fr)_");
  });
});

describe("the compact pass, so it does not drift back", () => {
  it("keeps a history row to one line and puts the detail behind a tap", () => {
    // The first pass wrapped provenance under the kind and every row became
    // three lines; twelve entries filled a screen.
    expect(LEDGER).toContain("aria-expanded={detail === null ? undefined : expanded}");
    expect(LEDGER).toContain("setOpen(expanded ? null : entry.key)");
    // Source and note are not printed in the row itself.
    expect(LEDGER).not.toMatch(/entry\.sourceRef\s*\?\s*`/);
  });

  it("does not offer a disclosure on a row with nothing to tell", () => {
    expect(LEDGER).toContain("disabled={detail === null}");
  });

  it("shows the visible stepper small and the tap target large", () => {
    const stepper = code("src/components/admin/stock-stepper.tsx");
    expect(stepper).toContain("h-7 w-7");
    // 28 px of circle plus 8 px of invisible reach on every side.
    expect(stepper).toContain("after:absolute after:-inset-2");
    expect(stepper).toContain("touch-manipulation");
  });

  it("keeps the four tracks in one place so head and rows cannot drift", () => {
    expect(LEDGER).toContain("const TRACKS =");
    expect((LEDGER.match(/\$\{TRACKS\}/g) ?? []).length).toBe(2);
  });

  it("keeps the dividers quiet", () => {
    // Structure comes from alignment; a line per row was louder than the
    // data. One hairline under the head, none between rows.
    expect(LEDGER).toContain("border-b border-border/25");
    expect(LEDGER).not.toContain("border-b border-border/30 py-1.5");
  });

  it("states the price and its source on one line", () => {
    const price = code("src/components/admin/price-editor.tsx");
    expect(price).toContain("inline-flex min-w-0 flex-wrap items-baseline");
    expect(price).not.toContain('<span className="block text-sm tabular-nums">');
  });
});

describe("the rebuilt grid, at both widths", () => {
  it("keeps the four columns side by side on a phone and on a desktop", () => {
    // Same four tracks either way — narrower on mobile, never stacked.
    expect(LEDGER).toContain("grid-cols-[4rem_minmax(0,1fr)_2.625rem_3.75rem]");
    expect(LEDGER).toContain("sm:grid-cols-[5.625rem_minmax(0,1fr)_4.375rem_5.625rem]");
  });

  it("lets nothing inside a row wrap", () => {
    // A wrapping row is how date and kind ended up above amount and price.
    const rowArea = LEDGER.slice(LEDGER.indexOf("const TRACKS"));
    expect(rowArea).not.toContain("flex-wrap");
  });

  it("gives a row a fixed height so seven fit the viewport", () => {
    expect(LEDGER).toContain("h-[30px] w-full items-center");
  });

  it("holds the picture to a square that cannot be squeezed", () => {
    const thumb = code("src/components/admin/admin-thumb.tsx");
    expect(thumb).toContain("h-10 w-10 shrink-0");
    expect(thumb).toContain("object-contain");
    expect(thumb).not.toContain("w-full h-full");
  });

  it("gives the header one flexible part, and it is the name", () => {
    expect(CARD).toContain('<p className="min-w-0 flex-1 truncate text-xs leading-tight">');
  });
});
