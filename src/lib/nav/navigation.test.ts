import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * How the collection is entered (ADR-0038, V4.4).
 *
 * `/collection` is a dynamic route. Next.js skips prefetching a dynamic route
 * unless it has a `loading` boundary, so a tap on "Sammlung" used to wait for
 * a full server round trip with nothing on screen changing — the catalog just
 * stood there. These are questions about file layout and props, which no
 * rendered output would answer, so the source is read directly.
 */
function source(path: string): string {
  return readFileSync(path, "utf8");
}

const NAV = "src/components/layout/site-nav.tsx";
const LOADING = "src/app/(app)/collection/loading.tsx";

describe("the collection has a route-level loading boundary", () => {
  it("exists, which is what makes the route prefetchable at all", () => {
    expect(() => source(LOADING)).not.toThrow();
  });

  it("shows the destination, not a spinner", () => {
    const loading = source(LOADING);
    expect(loading).toContain("CollectionHeading");
    expect(loading).toContain("CollectionSkeleton");
  });

  it("uses the same heading component the page does, so nothing jumps", () => {
    expect(source("src/app/(app)/collection/page.tsx")).toContain("CollectionHeading");
  });

  it("leaves the page without a second boundary of its own", () => {
    // One fallback, sent once. Two would ship the same skeleton twice.
    // The JSX, not the comment that explains why it is gone.
    expect(source("src/app/(app)/collection/page.tsx")).not.toMatch(/^\s*<Suspense/m);
  });
});

describe("the navigation prefetches what it should and nothing else", () => {
  it("leaves the collection prefetch to Next for a signed-in visitor", () => {
    // Same rule as before, now stated per destination rather than per role
    // branch (ADR-0042): undefined keeps Next's default, false switches it
    // off for someone who would only be redirected to /login.
    expect(source(NAV)).toContain("prefetch: (viewer) => (viewer.signedIn ? undefined : false)");
  });

  it("passes the flag on to the link", () => {
    expect(source(NAV)).toMatch(/prefetch=\{item\.prefetch\}/);
  });

  it("gives immediate feedback when a navigation does have to wait", () => {
    const nav = source(NAV);
    expect(nav).toContain("useLinkStatus");
    // Always rendered, only its opacity changes — an indicator that appears
    // out of nothing would move the bar it sits in.
    expect(nav).toContain("opacity-0");
  });
});

describe("the ownership toggle keeps its box in both states", () => {
  const toggle = source("src/components/catalog/owned-toggle.tsx");

  it("draws no icon that would widen it when switched on", () => {
    // The tick added ~18 px and pushed the control onto its own line at
    // 390 px — the filter moved because it had been used.
    expect(toggle).not.toContain("<svg");
    expect(toggle).not.toContain("CheckGlyph");
  });

  it("changes only colour between the two states", () => {
    // Nothing that occupies space may differ: no padding, no gap, no weight.
    // Only the two branches of the className ternary, not the props above it.
    const active = toggle.slice(
      toggle.indexOf('"whitespace-nowrap ring-1 transition-colors " +'),
      toggle.indexOf("      }\n    >"),
    );
    for (const spacing of ["px-", "gap-", "min-h-", "font-"]) {
      expect(active, `${spacing} must not differ between states`).not.toContain(spacing);
    }
  });

  it("still states its state semantically", () => {
    expect(toggle).toContain("aria-pressed={active}");
  });
});
