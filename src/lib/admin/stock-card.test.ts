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

/** The file as written — for reading a whole module, comments included. */
function source(path: string): string {
  return readFileSync(path, "utf8");
}

/** SQL without its `--` comments: what the database runs, not what it says. */
function sql(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
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
    expect(CARD).toContain("tradeCounters(legacyTotals, tradeTotals)");
  });

  it("builds the two counters from aggregates, never from the timeline", () => {
    /*
     * The regression that 0086 removed. Both halves are complete sums the
     * database produced; the card holds no list when it renders them, and
     * the list it later fetches is capped and must stay out of the
     * arithmetic. A card that adds up rows is a card that undercounts.
     */
    expect(CARD).not.toMatch(/tradeCounters\([^)]*(movements|entries|history)/);
    // The fetch happens in the toggle and nowhere else — the counters are
    // already on screen before a single timeline row exists.
    expect((CARD.match(/loadCardHistory\(/g) ?? []).length).toBe(1);
    const toggle = CARD.slice(CARD.indexOf("function toggleHistory"));
    expect(toggle).toContain("loadCardHistory(");
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
    expect(CARD).toContain("mergeHistory(");
    expect(CARD).toContain("history?.legacy ?? []");
    expect(CARD).toContain("history?.movements ?? []");
    expect(LEDGER).toContain("entries.map((entry)");
  });

  it("marks which source a row came from, quietly", () => {
    // ○ reconstructed, ● booked. One mark and a word — two lists would
    // suggest two histories, a loud treatment that one is suspect.
    expect(LEDGER).toContain('{legacy ? "\u25cb" : "\u25cf"}');
    expect(usesLabel(LEDGER, "historyLegacy")).toBe(true);
  });

  it("fetches BOTH sources only when a card is opened, in one round trip", () => {
    expect(CARD).toContain(
      "loadCardHistory(position.skyId, position.condition, position.inventoryId)",
    );
    expect(PAGE).not.toContain("fetchLegacyEvents");
    const action = source("src/lib/admin/legacy-actions.ts");
    expect(action).toContain("Promise.all");
    expect(action).toContain("fetchLegacyEvents(skyId, condition)");
    expect(action).toContain("fetchMovements(inventoryId, HISTORY_LIMIT)");
  });

  it("loads both lifetime aggregates once for the whole page", () => {
    expect(PAGE).toContain("fetchLegacyTotals()");
    expect(PAGE).toContain("fetchTradeTotals()");
  });

  /*
   * THE FAN-OUT THIS PAGE USED TO HAVE.
   *
   * `positions.map(p => fetchMovements(p.inventoryId, 200))` issued one RPC
   * per position — 273 on production — because the rows it returned were
   * being summed into the counters. With the counters on aggregates there
   * is nothing left to fetch per position, and the page must not grow it
   * back: this asserts the shape, not a number.
   */
  it("issues no per-position request on the initial load", () => {
    expect(PAGE).not.toContain("fetchMovements");
    expect(PAGE).not.toMatch(/positions\s*\.\s*map/);
    expect(PAGE).not.toMatch(/Promise\.all\(\s*positions/);
    // Two awaits on the whole page: the one batch, and the position read.
    expect((PAGE.match(/await Promise\.all\(/g) ?? []).length).toBe(1);
    const awaited = [...PAGE.matchAll(/await\s+([A-Za-z]+)\(/g)].map((m) => m[1]);
    expect(awaited).toEqual(["fetchInventory"]);
  });

  it("keeps the timeline limit small and purely visual", () => {
    expect(HISTORY).toContain("export const HISTORY_LIMIT = 20");
    expect(source("src/lib/admin/legacy-actions.ts")).toContain("HISTORY_LIMIT");
    // The query module's default is the same order of magnitude and is
    // never used to compute anything.
    expect(source("src/lib/admin/inventory.ts")).toContain(
      "fetchMovements(inventoryId: number, limit = 20)",
    );
  });
});

/**
 * One definition of a business movement, in one place.
 *
 * `seller_business_movements()` and `seller_business_trade_totals()` must
 * mean exactly the same set of rows. If the filter were written twice,
 * somebody would eventually change one copy — and the timeline and the
 * counters would disagree with nothing on screen to show it. 0086 extracts
 * the filter into `public.business_movements` and has both read it.
 */
describe("the timeline and the lifetime counters read one definition", () => {
  const TOTALS = sql("supabase/migrations/0086_business_trade_totals.sql");

  it("defines the business view once and gives it to nobody", () => {
    expect(TOTALS).toContain("create or replace view public.business_movements");
    expect(TOTALS).toContain(
      "revoke all on table public.business_movements from public, anon, authenticated",
    );
    expect(TOTALS).not.toMatch(/grant\s+select[^\n]*business_movements/i);
  });

  it("carries every exclusion 0085 had", () => {
    const view = TOTALS.slice(
      TOTALS.indexOf("create or replace view"),
      TOTALS.indexOf("comment on view"),
    );
    expect(view).toContain("m.reason <> 'initial_import'");
    expect(view).toContain("< 9000");
    expect(view).toContain("o.commerce_mode = 'sandbox'");
    expect(view).toContain("r.movement_id = m.id or r.reverted_movement_id = m.id");
    expect(view).toContain("s.is_test");
    expect(view).toContain("si.movement_id = m.id or si.return_movement_id = m.id");
  });

  it("has both readers select from the view and neither repeat the filter", () => {
    for (const fn of ["seller_business_movements", "seller_business_trade_totals"]) {
      const start = TOTALS.indexOf(`create or replace function public.${fn}`);
      const body = TOTALS.slice(start, TOTALS.indexOf("$$;", start));
      expect(body, fn).toContain("from public.business_movements b");
      expect(body, fn).not.toContain("initial_import");
      expect(body, fn).not.toContain("commerce_mode");
      expect(body, fn).not.toContain("is_test");
      expect(body, fn).not.toContain("9000");
    }
  });

  it("aggregates without any limit, and pages only the timeline", () => {
    const totals = TOTALS.slice(TOTALS.indexOf("function public.seller_business_trade_totals"));
    const body = totals.slice(0, totals.indexOf("$$;"));
    expect(body).not.toMatch(/\blimit\b/i);
    expect(body).not.toMatch(/\boffset\b/i);
    expect(body).toContain("group by b.inventory_id");
    // The timeline keeps its cut-off; that is the one place a limit belongs.
    const list = TOTALS.slice(TOTALS.indexOf("function public.seller_business_movements"));
    expect(list.slice(0, list.indexOf("$$;"))).toContain("limit least(greatest(");
  });

  it("splits purchases and sales the way the application says", () => {
    // PURCHASE_REASONS / SALE_REASONS in `stock-history.ts`, mirrored in SQL.
    expect(TOTALS).toContain("b.reason = 'purchase' and b.delta > 0");
    expect(TOTALS).toContain("in ('sale', 'sale_external', 'sale_skyisles')");
    expect(TOTALS).toContain("and b.delta < 0");
    // A return, a correction or a write-off is neither.
    for (const reason of ["'return'", "'correction'", "'writeoff'"]) {
      expect(TOTALS, reason).not.toContain(reason);
    }
  });

  it("asks the same operator gate the rest of /business asks", () => {
    for (const fn of ["seller_business_movements", "seller_business_trade_totals"]) {
      const start = TOTALS.indexOf(`create or replace function public.${fn}`);
      const body = TOTALS.slice(start, TOTALS.indexOf("$$;", start));
      expect(body, fn).toContain("if not public.can_operate_active_seller() then");
      expect(body, fn).toContain("insufficient_privilege");
      expect(body, fn).toContain("security definer");
      expect(body, fn).toContain("set search_path = ''");
    }
    expect(TOTALS).toContain("set search_path = ''");
    expect(TOTALS).toContain(
      "revoke all on function public.seller_business_trade_totals() from public, anon",
    );
    expect(TOTALS).toContain(
      "grant execute on function public.seller_business_trade_totals() to authenticated",
    );
  });

  it("drops nothing and rewrites no history", () => {
    expect(TOTALS).not.toMatch(/\bdrop\b/i);
    expect(TOTALS).not.toMatch(/\bdelete\s+from\b|\btruncate\b|\balter\s+table\b/i);
    // The audit function is named in the comments and nowhere else: this
    // migration does not touch it.
    expect(TOTALS).not.toMatch(/function\s+public\.admin_inventory_movements/);
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
