import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { viewport } from "@/app/layout";

/**
 * The declaration that makes every safe-area inset a real number.
 *
 * WHY THIS FILE EXISTS RATHER THAN A THIRD CSS ASSERTION
 *
 * `floating-cart.test.ts` and `toast.test.ts` already pin the
 * `env(safe-area-inset-bottom)` expressions in the bottom bar, the toast and
 * the floating cart. Every one of those passed while the bar sat under the
 * home indicator on every iPhone — because nothing exported a viewport, Next
 * emitted its default without `viewport-fit=cover`, and iOS then reports
 * every inset as ZERO.
 *
 * A test that reads CSS out of a source file cannot see that: the string is
 * there either way. So this one asserts the VALUE Next will actually emit,
 * imported from the layout, and then asserts that the two halves exist
 * together — the declaration is meaningless without the padding, and the
 * padding is inert without the declaration.
 */
const NAV = "src/components/layout/site-nav.tsx";

describe("the root viewport is declared, not inherited", () => {
  it("opts into the display cutout — the whole reason this export exists", () => {
    expect(viewport.viewportFit).toBe("cover");
  });

  it("restates the defaults an export would otherwise drop", () => {
    /*
     * Exporting a viewport REPLACES Next's default rather than extending it.
     * Leaving these out would ship a page without `width=device-width`, which
     * is a far worse bug than the one this fixes.
     */
    expect(viewport.width).toBe("device-width");
    expect(viewport.initialScale).toBe(1);
  });

  it("does not take zoom away", () => {
    // A page that cannot be pinched is a page somebody cannot read, and
    // "it keeps the layout tidy" has never been worth that.
    expect(viewport.maximumScale).toBeUndefined();
    expect(viewport.userScalable).not.toBe(false);
  });

  it("colours the browser chrome from the sky, per scheme", () => {
    // Both values are --sky-high: dusk in the default scheme, night in the
    // dark one. A pale band above a dark page is the thing this prevents.
    expect(viewport.themeColor).toEqual([
      { media: "(prefers-color-scheme: light)", color: "#1b1b42" },
      { media: "(prefers-color-scheme: dark)", color: "#0e0d24" },
    ]);
  });
});

describe("the declaration and the padding only work together", () => {
  const nav = readFileSync(NAV, "utf8");

  it("the bottom bar pads itself with the inset this export unlocks", () => {
    expect(nav).toContain("pb-[env(safe-area-inset-bottom)]");
    expect(nav).toContain("h-[calc(2.75rem+env(safe-area-inset-bottom))]");
  });

  it("and that padding is only ever non-zero because of it", () => {
    /*
     * Stated as an assertion so the two cannot drift apart: removing
     * `viewportFit` would silently return every inset above to zero, and this
     * is the line that fails when somebody does.
     */
    expect(viewport.viewportFit, "the padding above is inert without this").toBe("cover");
  });
});
