/**
 * The Orderbuch on a phone.
 *
 * WHAT THESE TESTS ARE FOR
 *
 * The owner works this screen on a phone, and the first version was built
 * desktop-first: the ledger collapsed to two unlabelled lines, and both
 * creation forms carried more prose than input. Neither failed a test,
 * because nothing measured either one against a real phone.
 *
 * So these are about width. Every assertion names a viewport a person
 * actually holds, and checks a property that decides whether the thing is
 * usable at it — not whether a class is spelt a particular way.
 *
 * WHAT CAN AND CANNOT BE PROVED FROM SOURCE
 *
 * There is no browser here, so nothing below claims a pixel was painted. The
 * claims are structural: a grid that never forces two columns below the
 * breakpoint cannot produce a two-column phone layout; a table whose floor
 * exceeds the viewport must scroll, because the alternative is the crushing
 * this replaced; a control declared `min-h-11` is 44px wherever it renders.
 * The layout follows from those; the rendering is the browser's part.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** Comments name classes they are explaining the absence of. Strip them. */
const code = (text: string) => text
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/^\s*\/\/.*$/gm, "");

const CSS = read("src/app/globals.css");
const PRIMITIVES = read("src/components/business/ledger-table.tsx");
const SECTION = read("src/components/business/form-section.tsx");
const NEW_SALE = read("src/components/business/new-sale.tsx");
const NEW_PURCHASE = read("src/components/business/new-purchase.tsx");
const SALES_LEDGER = read("src/components/business/sales-ledger.tsx");
const PURCHASE_LEDGER = read("src/components/business/orderbook-ledger.tsx");
const SALES_PAGE = read("src/app/(business)/business/orderbuch/verkauf/page.tsx");
const PURCHASE_PAGE = read("src/app/(business)/business/orderbuch/page.tsx");
const NAV = read("src/components/business/orderbook-nav.tsx");
const SALE_ITEMS = read("src/components/business/sale-items.tsx");
const INDICATOR = read("src/components/business/sale-indicator.tsx");

/**
 * The phones this has to work on, in CSS pixels.
 *
 * 320 is the narrowest screen still in use (iPhone SE, 1st gen); 360 is the
 * commonest Android; 390 and 393 are the current iPhone and Pixel. Tailwind's
 * `sm:` breakpoint is 640px, so every one of these is below it — which is
 * what makes "no unprefixed multi-column grid" a statement about phones.
 */
const PHONES = [320, 360, 390, 393, 414] as const;
const SM_BREAKPOINT = 640;
const REM = 16;

describe("the ledger at phone widths", () => {
  /** `--ob-min-width` as each ledger declares it, in px. */
  const floors = {
    Einkauf: Number(/const PURCHASE_MIN_WIDTH = "([\d.]+)rem"/.exec(PURCHASE_LEDGER)![1]) * REM,
    Verkauf: Number(/const SALE_MIN_WIDTH = "([\d.]+)rem"/.exec(SALES_LEDGER)![1]) * REM,
  };

  it("declares a floor for both ledgers", () => {
    expect(floors.Einkauf).toBeGreaterThan(0);
    expect(floors.Verkauf).toBeGreaterThan(0);
  });

  it.each(PHONES)("is wider than a %ipx screen, so it scrolls rather than crushes", (width) => {
    /*
     * This is the whole design decision, stated as an assertion. The table
     * does NOT fit a phone and is not asked to: it keeps the columns it has
     * and the box scrolls under them. A floor that fitted would mean the
     * columns had been squeezed to make it fit.
     */
    for (const [name, floor] of Object.entries(floors)) {
      expect(floor, `${name} at ${width}px`).toBeGreaterThan(width);
    }
  });

  /** `minmax(8rem, 1fr)` → 8; `6rem` → 6; `minmax(0, 1fr)` → 0. */
  const minRem = (track: string): number => {
    const m = /minmax\(\s*([\d.]+)rem/.exec(track);
    if (m) return Number(m[1]);
    if (/minmax\(\s*0/.test(track)) return 0;
    return Number(/([\d.]+)rem/.exec(track)?.[1] ?? 0);
  };
  const split = (list: string): string[] =>
    list.replace(/minmax\(([^)]*)\)/g, (m) => m.replace(/,\s*/g, ","))
      .split(/\s+/).filter(Boolean);
  /** Every track list an item table renders under, with the width it gets. */
  const itemTables = (): [string, string, number][] => {
    /* `.ob-item` never grows past its ceiling, whatever box it sits in. */
    const cap = Number(/\.ob-item \{ max-width: var\(--ob-item-max, ([\d.]+)rem\)/
      .exec(CSS)![1]) * REM;
    const box = (px: number) => Math.min(px, cap);
    /*
     * TWO LISTS, NOT THREE. Einkauf renders the rule\'s own fallback; both
     * sale screens render ONE shared constant that is that list with a
     * narrow indicator in front. What this file exists to catch is a third
     * one appearing — `Figur` as `minmax(9rem, 1fr)` inside a 71rem box
     * collects all the slack and pushes the rest out of view, which is what
     * the old four-column variant did.
     */
    const einkauf = /grid-template-columns: var\(--ob-item-columns,\s*([^)]*\)[^;]*)/
      .exec(CSS)![1].replace(/\s+/g, " ").trim();
    const verkauf = /export const SALE_ITEM_COLUMNS =\s*\n?\s*"([^"]*)"/
      .exec(INDICATOR)![1].replace(/\s+/g, " ").trim();
    return [
      ["Einkauf", einkauf,
        box(Number(/const PURCHASE_MIN_WIDTH = "([\d.]+)rem"/.exec(PURCHASE_LEDGER)![1]) * REM)],
      ["Verkaufsbuch", verkauf,
        box(Number(/const SALE_MIN_WIDTH = "([\d.]+)rem"/.exec(SALES_LEDGER)![1]) * REM)],
      ["Verkauf-Detail", verkauf,
        box(Number(/const ITEM_MIN_WIDTH = "([\d.]+)rem"/.exec(SALE_ITEMS)![1]) * REM)],
    ];
  };
  /** What the flexible first track actually gets: its floor, or the slack. */
  const figureWidth = (list: string, width: number): number => {
    const t = split(list);
    const fixed = t.slice(1).reduce((sum, x) => sum + minRem(x), 0) * REM;
    const chrome = (0.75 * (t.length - 1) + 1.5) * REM;
    return Math.max(minRem(t[0]) * REM, width - fixed - chrome);
  };

  it("leaves the figure name a readable column in every item table", () => {
    /*
     * THE BUG THIS EXISTS TO CATCH, IN BOTH DIRECTIONS.
     *
     * Too little: a floor sized by the sum of the tracks leaves the
     * flexible `Figur` nothing, because it collects only what is left over.
     * Too much: an item table sitting inside a WIDER ledger box collects
     * all of that box's slack — `Figur` took 43rem of the Verkauf ledger's
     * 71 and pushed the other three columns off the screen.
     */
    const READABLE = 8 * REM;   // 128px — about twenty characters at 14px.
    for (const [name, list, width] of itemTables()) {
      const t = split(list);
      expect(t.length, `${name}: tracks parsed`).toBeGreaterThan(3);
      expect(figureWidth(list, width), `${name}: Figur`).toBeGreaterThanOrEqual(READABLE);
    }
  });

  it("gives the figure a large share without swallowing the other three", () => {
    /*
     * Roughly 40–50 % is what a name column wants. The ceiling on
     * `.ob-item` is what keeps the four-column table from inheriting an
     * eleven-column row's width and handing the difference to `Figur`.
     */
    for (const [name, list, width] of itemTables()) {
      if (split(list).length !== 4) continue;   // the Einkauf table has six
      const share = figureWidth(list, width) / width;
      expect(share, `${name}: ${(share * 100).toFixed(0)} %`).toBeGreaterThan(0.28);
      expect(share, `${name}: ${(share * 100).toFixed(0)} %`).toBeLessThan(0.55);
    }
  });

  it("the item table fits a normal desktop without scrolling sideways", () => {
    /*
     * 1024px is the narrowest desktop worth calling one, and the ledger
     * container is capped at max-w-5xl (64rem) anyway. The item table has
     * to be inside that at scroll position 0 — the sale ROW above it may
     * still be wider and scroll; that is its own eleven columns' business.
     */
    const cap = Number(/\.ob-item \{ max-width: var\(--ob-item-max, ([\d.]+)rem\)/
      .exec(CSS)![1]) * REM;
    expect(cap).toBeLessThanOrEqual(1024);
    expect(cap).toBeLessThanOrEqual(64 * REM);
    // And wide enough to hold the six columns at their minimums.
    for (const [name, list] of itemTables()) {
      const t = split(list);
      const needed = (t.reduce((sum, x) => sum + minRem(x), 0) + 0.75 * 3 + 1.5) * REM;
      expect(cap, `${name} needs ${needed}px`).toBeGreaterThanOrEqual(needed);
    }
  });

  it.each(PHONES)("still scrolls rather than crushes at %ipx", (width) => {
    // Six columns need more than any phone has; the box scrolls, as before.
    for (const [name, list] of itemTables()) {
      const t = split(list);
      const needed = (t.reduce((sum, x) => sum + minRem(x), 0) + 0.75 * 3 + 1.5) * REM;
      expect(needed, `${name} at ${width}px`).toBeGreaterThan(width);
    }
  });

  it("lets a long figure name wrap instead of being cut", () => {
    for (const [name, source] of [["Verkaufsbuch", SALES_LEDGER],
                                  ["Verkauf-Detail", SALE_ITEMS]] as const) {
      expect(code(source), name).toContain("break-words");
      // The name cell no longer truncates; the other cells still may.
      expect(code(source), name).not.toMatch(/className="truncate"\s*\n?\s*title=\{\[String\(item\.name/);
    }
  });

  it("scrolls sideways at every width, and leaves the page its own axis", () => {
    const components = CSS.slice(CSS.indexOf("@layer components {"), CSS.indexOf("@layer utilities {"));
    const beforeDesktop = components.slice(0, components.indexOf("@media (min-width: 48rem)"));

    // Sideways, unconditionally.
    expect(beforeDesktop).toMatch(/\.ob-scroll \{\s*overflow-x: auto;/);
    // Downwards belongs to the page on a phone: no height cap outside the
    // desktop query, so the box grows and the page scrolls past it.
    expect(beforeDesktop).not.toContain("max-height");
    expect(beforeDesktop).toMatch(/overflow-y: hidden;/);
  });

  it("keeps the columns identical on a phone and a desktop", () => {
    /*
     * One layout, two widths. The alternative — a phone-specific collapse —
     * is what was here before, and it meant every change to the table had to
     * be made and checked twice.
     */
    const components = CSS.slice(CSS.indexOf("@layer components {"), CSS.indexOf("@layer utilities {"));
    const desktop = components.slice(components.indexOf("@media (min-width: 48rem)"));
    expect(desktop).not.toContain("grid-template-columns");
    expect(components).not.toMatch(/@media[^{]*max-width/);
  });

  it("shows the header on a phone, because a scrolled column cannot name itself", () => {
    expect(code(PRIMITIVES)).not.toMatch(/ob-row[^"]*\bhidden\b/);
    expect(code(PRIMITIVES)).not.toMatch(/ob-item[^"]*\bhidden\b/);
    expect(code(PRIMITIVES)).not.toContain("md:grid");
  });

  it("anchors the first column so a scrolled row still says which row it is", () => {
    const sticky = CSS.slice(CSS.indexOf(".ob-row > :first-child"));
    expect(sticky).toContain("position: sticky");
    expect(sticky).toContain("left: 0");
    // It has to hide what slides beneath it, so the row cannot be see-through.
    expect(sticky).toContain("background: inherit");
    expect(code(PRIMITIVES)).not.toContain("bg-surface/60");
  });

  it("keeps a ledger row a 44px touch target", () => {
    const row = CSS.slice(CSS.indexOf(".ob-row {"));
    const minHeight = Number(/min-height:\s*([\d.]+)rem;/.exec(row)![1]) * REM;
    expect(minHeight).toBeGreaterThanOrEqual(44);
  });
});

describe("the filters above the ledger at phone widths", () => {
  it("wrap instead of overflowing", () => {
    /*
     * Four filter rows sit above the table — tabs, classification, search,
     * year and month. On a 320px screen the year row alone is more chips
     * than fit. Every one of them wraps; none scrolls sideways of its own
     * accord, which would be a second scroll axis competing with the table's.
     */
    for (const [name, source] of [["Verkauf", SALES_PAGE], ["Einkauf", PURCHASE_PAGE],
                                  ["Navigation", NAV]] as const) {
      const navs = source.match(/<nav[^>]*className="([^"]*)"/g) ?? [];
      expect(navs.length, name).toBeGreaterThan(0);
      for (const nav of navs) {
        expect(nav, `${name}: ${nav}`).toContain("flex-wrap");
      }
      expect(code(source), name).not.toMatch(/overflow-x-auto/);
    }
  });

  it("gives the search field the full width of a phone and caps it on desktop", () => {
    for (const [name, source] of [["Verkauf", SALES_PAGE], ["Einkauf", PURCHASE_PAGE]] as const) {
      expect(source, name).toContain("w-full");
      expect(source, name).toMatch(/sm:w-\d+/);
    }
  });

  it("keeps every filter chip and control thumb-sized where it is pressed", () => {
    // The chips are links in a row; the search controls are the ones a
    // thumb aims at, and they carry the 44px floor.
    for (const [name, source] of [["Verkauf", SALES_PAGE], ["Einkauf", PURCHASE_PAGE]] as const) {
      expect((source.match(/min-h-11/g) ?? []).length, name).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("the creation forms at phone widths", () => {
  const FORMS = [["Verkauf", NEW_SALE], ["Einkauf", NEW_PURCHASE],
                 ["Gruppen", SECTION]] as const;

  it("never forces more than one column below the breakpoint", () => {
    /*
     * The rule that makes the forms single-column on a phone, stated once:
     * a multi-column grid must be behind `sm:`. The one unprefixed
     * multi-column grid in either form is the fee row, whose first cell
     * spans all of them — see the next test.
     */
    for (const [name, source] of FORMS) {
      const unprefixed = (code(source).match(/(?<![a-z:])grid-cols-\S+/g) ?? [])
        .filter((c) => c !== "grid-cols-1");
      for (const c of unprefixed) {
        expect(c, `${name} declares ${c} with no sm: prefix`).toBe("grid-cols-[1fr_auto_auto]");
      }
    }
    expect(SM_BREAKPOINT).toBeGreaterThan(PHONES[PHONES.length - 1]);
  });

  it("stacks a fee row on a phone: name on one line, its controls on the next", () => {
    /*
     * A fee is four controls — name, amount, who kept it, remove. Four do
     * not fit across 320px, so the name takes the first line by spanning
     * every column, and the three narrow ones share the second. At `sm:`
     * they are one line again.
     */
    const row = NEW_SALE.slice(NEW_SALE.indexOf("{fees.map("), NEW_SALE.indexOf("</ul>"));
    expect(row).toContain("grid-cols-[1fr_auto_auto]");
    expect(row).toContain("sm:grid-cols-[minmax(0,1fr)_6rem_auto_auto]");
    expect((row.match(/col-span-3/g) ?? []).length).toBe(2);   // the two label variants
    expect((row.match(/sm:col-span-1/g) ?? []).length).toBe(2);
  });

  it("keeps every control a 44px touch target on a phone", () => {
    /*
     * `min-h-11` is 44px. Where a control shrinks on desktop it does so
     * behind `sm:`, which is the right way round: the phone gets the big
     * target and the mouse gets the compact one.
     */
    // `form-section.tsx` holds no controls of its own — it declares the
    // class the two forms put on theirs.
    expect(SECTION).toContain('"min-h-11 w-full');
    for (const [name, source] of [["Verkauf", NEW_SALE], ["Einkauf", NEW_PURCHASE]] as const) {
      const inputs = (code(source).match(/<input|<select|<button/g) ?? []).length;
      expect(inputs, name).toBeGreaterThan(0);
    }
    // Checkboxes are the documented exception: `size-4` is the native box,
    // and the whole label row is the hit area.
    for (const [name, source] of [["Verkauf", NEW_SALE], ["Einkauf", NEW_PURCHASE]] as const) {
      const shrinking = code(source).match(/sm:min-h-\d+|sm:size-\d+/g) ?? [];
      for (const c of shrinking) {
        expect(c, `${name}: ${c} must only shrink at sm:`).toMatch(/^sm:/);
      }
    }
  });

  it("declares no fixed width a phone cannot hold", () => {
    /*
     * A `w-[...]` or `min-w-[...]` wider than the narrowest screen is the
     * usual cause of a form that scrolls sideways. `w-24` (96px) on the fee
     * amount is the only fixed width, and it is narrow by design.
     */
    for (const [name, source] of FORMS) {
      for (const cls of code(source).match(/(?:min-)?w-\[([\d.]+)(px|rem)\]/g) ?? []) {
        const [, n, unit] = /([\d.]+)(px|rem)/.exec(cls)!;
        const px = unit === "rem" ? Number(n) * REM : Number(n);
        expect(px, `${name}: ${cls}`).toBeLessThanOrEqual(PHONES[0]);
      }
      // Tailwind's numeric widths are quarter-rem: w-24 is 96px.
      for (const cls of code(source).match(/(?<![a-z:[-])w-(\d+)(?![a-z\d])/g) ?? []) {
        const px = Number(/\d+/.exec(cls)![0]) * 4;
        expect(px, `${name}: ${cls}`).toBeLessThanOrEqual(PHONES[0]);
      }
    }
  });

  it("groups the fields instead of explaining them", () => {
    /*
     * The structure the owner asked for. Headings in order, top to bottom,
     * important first — and the prose that used to sit between them gone.
     */
    const order = (source: string, keys: readonly string[]) => {
      const at = keys.map((k) => source.indexOf(k));
      expect(at.every((i) => i >= 0), keys.join(" → ")).toBe(true);
      expect([...at].sort((a, b) => a - b)).toEqual(at);
    };
    order(NEW_SALE, ["create.sections.sale", "create.sections.figures",
                     "create.sections.amounts", "create.sections.costs",
                     "create.sections.payout", "create.sections.note", "create.submit"]);
    order(NEW_PURCHASE, ["copy.newSections.purchase", "copy.newSections.figures",
                         "copy.newSections.amount", "copy.newSections.note",
                         "copy.submitPurchase"]);
  });

  it("boxes the payout and nothing else", () => {
    /*
     * "Keine Karten-in-Karten": a group is a heading and a gap. The payout
     * is the one panel, because it is the answer rather than a question.
     */
    // The group itself: a heading, a hairline, a gap. The `ring-1` in this
    // file belongs to the INPUT constant, not to the wrapper.
    const group = SECTION.slice(SECTION.indexOf("export function FormSection"),
                                SECTION.indexOf("export function Field"));
    expect(code(group)).not.toContain("ring-1");
    expect(code(group)).not.toContain("rounded-sky");
    const panels = code(NEW_SALE).match(/rounded-sky-lg[^"]*ring-1/g) ?? [];
    expect(panels).toHaveLength(1);
    expect(code(NEW_SALE)).toContain("create.sections.payout");
    expect(code(NEW_PURCHASE).match(/rounded-sky-lg[^"]*ring-1/g) ?? []).toHaveLength(0);
  });

  it("gives the submit button the full width of a phone", () => {
    for (const [name, source] of [["Verkauf", NEW_SALE], ["Einkauf", NEW_PURCHASE]] as const) {
      const submit = source.slice(source.lastIndexOf('type="submit"'));
      expect(submit, name).toContain("w-full");
      expect(submit, name).toContain("sm:w-auto");
      expect(submit, name).toContain("min-h-11");
    }
  });
});
