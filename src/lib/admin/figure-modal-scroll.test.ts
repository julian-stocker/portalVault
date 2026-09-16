import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The administrator's editor has to stay inside the screen (V3.8a).
 *
 * WHAT WENT WRONG, SO IT CANNOT GO WRONG AGAIN
 *
 * The dialog wrapped its head, body and foot in `flex max-h-[85vh] flex-col`.
 * Two faults in one class string:
 *
 *   1. `85vh` is a SECOND ceiling, taller than the panel's own `82dvh`, and
 *      measured in `vh` — which on iOS Safari is the viewport at its tallest,
 *      address bar hidden. The wrapper was therefore allowed to be taller
 *      than the panel it lived in.
 *   2. The wrapper had no `min-h-0`, and neither did the scrolling body. A
 *      flex child's `min-height` defaults to `auto` — its min-content height
 *      — so neither would shrink below the full height of the form. The
 *      column grew past the panel, `overflow-hidden` on the panel cut it off,
 *      and `overflow-y-auto` had nothing to scroll because the element was
 *      never smaller than its content.
 *
 * The result was not a missing scrollbar. It was a clipped column: the last
 * fields existed, were laid out, and could not be reached by any gesture.
 *
 * This product has no DOM in its tests — `vitest.config.mts` collects
 * `*.test.ts` and nothing renders — so these hold the structure that makes
 * the scroll possible, the same way `lib/ui/quick-view-ux.test.ts` holds the
 * quick view's. What it LOOKS like is still checked in a browser.
 */
const source = (path: string) => readFileSync(path, "utf8");

/** The source without comments — so an explanation can never satisfy a test. */
const code = (path: string) =>
  source(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const MODAL = "src/components/admin/figure-modal.tsx";
const PRIMITIVE = "src/components/ui/modal.tsx";
const QUICK_VIEW = "src/components/catalog/quick-view.tsx";
const FILTER_SHEET = "src/components/ui/filter-sheet.tsx";

/**
 * What makes the body the body: it shrinks, it scrolls, and it keeps the
 * gesture. The padding is asserted separately, so a change to the spacing
 * fails one test rather than every test that needs to find this element.
 */
const BODY_ANCHOR = "min-h-0 overflow-y-auto overscroll-contain";

/**
 * The scrolling region's own class string, read from the file.
 *
 * Scoped on purpose: `flex-1` is right on the head's title column, which has
 * to take whatever width the picture and the close button leave it. It is
 * only wrong on the body.
 */
function bodyClasses(editor: string): string {
  const match = editor.match(/<div className="([^"]*overflow-y-auto[^"]*)">/);
  expect(match, "the editor has one scrolling region").not.toBeNull();
  return match![1];
}

/**
 * The three zones, by position.
 *
 * Head and foot are what lies outside `[bodyStart, footStart)`; the scrolling
 * content is what lies inside it. Positions rather than a parser: the file is
 * head, then body, then foot, and that order is itself part of what is being
 * guarded.
 */
function zones(editor: string) {
  const headStart = editor.indexOf("<header");
  const bodyStart = editor.lastIndexOf("<div", editor.indexOf(BODY_ANCHOR));
  const footStart = editor.indexOf("<footer");

  expect(headStart, "the editor has a head").toBeGreaterThan(-1);
  expect(bodyStart, "the editor has the one scrolling body").toBeGreaterThan(-1);
  expect(footStart, "the editor has a foot").toBeGreaterThan(-1);
  expect(headStart).toBeLessThan(bodyStart);
  expect(bodyStart).toBeLessThan(footStart);

  return {
    head: editor.slice(headStart, bodyStart),
    scrolling: editor.slice(bodyStart, footStart),
    foot: editor.slice(footStart),
  };
}

describe("the editor cannot outgrow the viewport", () => {
  const editor = code(MODAL);
  const primitive = code(PRIMITIVE);

  it("states no height of its own — the ceiling belongs to the primitive", () => {
    /*
     * One ceiling, in one place. A second one here could only ever agree with
     * the panel's by luck, and the last one disagreed by 3 percentage points
     * and a unit.
     */
    expect(editor).not.toMatch(/max-h-\[/);
    expect(editor).not.toMatch(/\d+vh/);
    for (const stretcher of ["h-screen", "h-dvh", "h-full", "min-h-screen"]) {
      expect(editor, `${stretcher} would fix the editor's height`).not.toContain(stretcher);
    }
  });

  it("gets that ceiling from a dynamic viewport unit", () => {
    // `dvh` follows the browser chrome as it comes and goes; `vh` is the
    // viewport at its tallest and would run the panel under the address bar.
    const phone = primitive.match(/max-h-\[(\d+)dvh\]/);
    const desktop = primitive.match(/sm:max-h-\[(\d+)dvh\]/);
    expect(phone, "a phone ceiling in dvh").not.toBeNull();
    expect(desktop, "a desktop ceiling in dvh").not.toBeNull();

    // A margin of catalogue stays visible on both, so the dialog reads as
    // something laid over the grid rather than as a new page.
    expect(Number(phone![1])).toBeLessThan(100);
    expect(Number(desktop![1])).toBeLessThanOrEqual(75);

    // And the panel clips rather than growing, which is what makes the
    // body's `min-h-0` the thing that decides.
    expect(primitive).toContain("flex-col overflow-hidden");
  });

  it("keeps clear of the safe area at the bottom", () => {
    expect(primitive).toContain("env(safe-area-inset-bottom)");
  });
});

describe("only the body scrolls", () => {
  const editor = code(MODAL);

  it("puts head, body and foot straight into the panel", () => {
    /*
     * No wrapper. `Modal` is already `flex flex-col` with the ceiling on it,
     * so a wrapper adds a link to the chain and one more place for a missing
     * `min-h-0` to hide. `filter-sheet.tsx` does it this way too.
     */
    const panel = editor.slice(editor.indexOf("<Modal"), editor.indexOf("</Modal>"));
    expect(panel).not.toMatch(/<Modal[^>]*>\s*<div className="flex[^"]*flex-col/);
  });

  it("spells the body so it can actually shrink", () => {
    /*
     * `min-h-0` is the fix. Without it the body never gets smaller than its
     * content, and an element that is never smaller than its content has
     * nothing to scroll however `overflow-y` is set.
     */
    expect(editor).toContain("min-h-0 overflow-y-auto overscroll-contain");
  });

  it("does not let the body reach for the ceiling", () => {
    /*
     * `flex-1` is `flex: 1 1 0%` — it would claim the panel's whole ceiling
     * even for a figure with no history, leaving a band of empty space above
     * the buttons. The default `flex: 0 1 auto` is the half that was wanted:
     * be the size of the content, give way at the ceiling. The quick view
     * records the same reasoning.
     */
    const classes = bodyClasses(editor);
    expect(classes).toContain("min-h-0");
    expect(classes).not.toContain("flex-1");
  });

  it("has exactly one scrolling region", () => {
    expect((editor.match(/overflow-y-auto/g) ?? []).length).toBe(1);
    // And it contains the gesture, so the catalogue behind never takes over.
    expect((editor.match(/overscroll-contain/g) ?? []).length).toBe(1);
  });

  it("holds the head and the foot at their size", () => {
    const { head, foot } = zones(editor);
    expect(head, "the head must not be squeezed by a long form").toContain("shrink-0");
    expect(foot, "saving must not be squeezed off the panel").toContain("shrink-0");
  });

  it("leaves room below the last field", () => {
    // The last field must not sit against the foot, and on a phone the
    // bottom edge is where the browser's own chrome comes and goes.
    expect(editor).toMatch(/min-h-0 overflow-y-auto overscroll-contain p-4 pb-\d/);
  });

  it("does not scroll the catalogue behind it", () => {
    const primitive = code(PRIMITIVE);
    expect(primitive).toContain('body.style.overflow = "hidden"');
    // Restored to what was there, not to a hard-coded default — so the
    // catalogue comes back exactly where it was left.
    expect(primitive).toContain("body.style.overflow = previousOverflow;");
  });
});

describe("the head and the foot stay reachable", () => {
  const editor = code(MODAL);

  it("keeps the close button out of the scrolling content", () => {
    const { head, scrolling } = zones(editor);
    expect(head).toContain("de.admin.closeEditor");
    expect(scrolling).not.toContain("de.admin.closeEditor");
  });

  it("closes through the same door as Escape, so an unsaved edit is not lost", () => {
    const { head } = zones(editor);
    // `requestClose`, not `onClose`: it asks first while the draft is dirty.
    expect(head).toContain("onClick={requestClose}");
    expect(head).not.toContain("onClick={onClose}");
  });

  it("keeps saving and cancelling out of the scrolling content", () => {
    const { scrolling, foot } = zones(editor);
    for (const label of ["de.admin.saveChanges", "de.admin.cancel"]) {
      expect(foot, label).toContain(label);
      expect(scrolling, label).not.toContain(label);
    }
  });

  it("names the figure in the head, where it stays visible", () => {
    const { head } = zones(editor);
    expect(head).toContain("id={headingId}");
    expect(head).toContain("figure.displayName");
    expect(head).toContain("figure.skyId");
  });

  it("puts every setting inside the scrolling content", () => {
    const { head, scrolling, foot } = zones(editor);
    const sections = scrolling.match(/<Section\b/g) ?? [];
    expect(sections.length, "the editor's sections all scroll").toBeGreaterThanOrEqual(4);
    expect(head).not.toContain("<Section");
    expect(foot).not.toContain("<Section");
  });
});

describe("it still works when the editor grows", () => {
  /*
   * REQUIREMENT: the dialog must not be built for today's five fields.
   *
   * There is no DOM here to measure, so growth is applied to the SOURCE: the
   * body is given twenty more sections than it has, and the invariants that
   * make it scrollable are asserted again. Any of them that depended on how
   * much is in the editor would fail here — a fixed height, a height counted
   * from the sections, a second scrolling region, a control that drifted out
   * of the head or the foot.
   */
  const editor = code(MODAL);

  /** The editor as it would look with a great many more settings in it. */
  function grown(times: number): string {
    const { head, scrolling, foot } = zones(editor);
    const extra = Array.from(
      { length: times },
      (_, i) =>
        `<Section title={"Section ${i}"}>` +
        `<label className="flex flex-col gap-1">` +
        `<input type="text" className="min-h-11 rounded-sky-md" />` +
        `</label></Section>`,
    ).join("\n");

    // Injected just before the body ends, which is where a new section goes.
    return head + scrolling.replace(/(\s*)$/, `\n${extra}$1`) + foot;
  }


  it("still has one scrolling body, and the same one", () => {
    const tall = grown(20);
    expect(tall).toContain(BODY_ANCHOR);
    expect((tall.match(/overflow-y-auto/g) ?? []).length).toBe(1);
    expect((tall.match(/overscroll-contain/g) ?? []).length).toBe(1);
  });

  it("still states no height, so the extra sections change no measurement", () => {
    const tall = grown(20);
    expect(tall).not.toMatch(/max-h-\[/);
    expect(tall).not.toMatch(/\d+vh/);
    expect(bodyClasses(tall)).not.toContain("flex-1");
  });

  it("still keeps every one of them inside the scroll", () => {
    const { head, scrolling, foot } = zones(grown(20));
    expect((scrolling.match(/<Section\b/g) ?? []).length).toBeGreaterThanOrEqual(24);
    expect(head).not.toContain("<Section");
    expect(foot).not.toContain("<Section");
  });

  it("still leaves the close button and saving reachable", () => {
    const { head, scrolling, foot } = zones(grown(20));
    expect(head).toContain("de.admin.closeEditor");
    expect(head).toContain("shrink-0");
    expect(foot).toContain("de.admin.saveChanges");
    expect(foot).toContain("shrink-0");
    expect(scrolling).not.toContain("de.admin.saveChanges");
  });
});

describe("the public quick view is untouched", () => {
  const primitive = code(PRIMITIVE);
  const quick = code(QUICK_VIEW);
  const sheet = code(FILTER_SHEET);

  it("keeps its own scrolling structure", () => {
    expect(quick).toContain("min-h-0 overflow-y-auto overscroll-contain");
    expect(quick).not.toContain("flex-1");
    expect(quick).toContain("de.quickView.close");
  });

  it("shares the primitive, which learned nothing about administrators", () => {
    /*
     * The fix was structural and belonged entirely to the editor, so the
     * primitive did not change. Guarding that keeps the next fix from being
     * made in the one file all three dialogs render through.
     */
    for (const leak of ["admin", "Admin", "figure", "Figure", "skyId"]) {
      expect(primitive, leak).not.toContain(leak);
    }
  });

  it("is one of three dialogs built the same way", () => {
    // The filter sheet already had the shape the editor now has: head, one
    // `min-h-0` scrolling region, foot — straight into the panel.
    expect(sheet).toContain("min-h-0 overflow-y-auto overscroll-contain");
    for (const file of [MODAL, QUICK_VIEW, FILTER_SHEET]) {
      expect(code(file), file).toContain('from "@/components/ui/modal"');
    }
  });
});
