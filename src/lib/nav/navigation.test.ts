import { describe, expect, it } from "vitest";
import { globSync, readFileSync } from "node:fs";

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

describe("the ownership filter is one row of pills", () => {
  const filter = source("src/components/catalog/ownership-filter.tsx");

  it("draws no icon that would widen a segment when it is chosen", () => {
    // Its predecessor grew a tick when switched on, which added ~18 px and
    // pushed the control onto its own line at 390 px: the filter moved
    // because it had been used. Only colour differs between the states.
    expect(filter).not.toContain("<svg");
    expect(filter).not.toContain("CheckGlyph");
  });

  it("marks exactly the active segment, and marks it as selected", () => {
    // aria-selected on a tab, not aria-pressed on a toggle: these are three
    // views of one list, not three independent switches.
    expect(filter).toContain('role="tablist"');
    expect(filter).toContain('role="tab"');
    expect(filter).toContain("aria-selected={isActive}");
    expect(filter).not.toContain("aria-pressed");
  });

  it("keeps a 40 px touch target", () => {
    expect(filter).toContain("min-h-10");
  });
});

/**
 * Which links prefetch, and which deliberately do not (V3.6).
 *
 * A `<Link>` without a `prefetch` prop is prefetched by Next as soon as it
 * enters the viewport, and every one of those requests goes through
 * `src/proxy.ts`, which validates the session against the auth server before
 * it can tell a prefetch from a navigation. That is affordable for the handful
 * of links that make up the navigation and unaffordable for a link per figure:
 * a catalog screen carries one per offer, and the collection table one per
 * owned figure.
 *
 * So the rule is per destination, not global: figure detail pages are not
 * prefetched, the main sections still are. These tests hold both halves,
 * because switching the wrong half off is the easy mistake — and doing it
 * silently is the expensive one.
 *
 * Source is read rather than rendered: `prefetch` never reaches the DOM, so
 * no rendered output could answer the question.
 */

/**
 * The source with its comments removed.
 *
 * Every assertion below searches for words like `prefetch` and `/skylanders/`
 * — words that also appear in the comments explaining each decision. Matching
 * against the raw file would let a comment satisfy a test, or break one.
 */
function code(path: string): string {
  return source(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Every `<Link>` opening tag in a file, as text.
 *
 * A tag ends at the first `>` that is not inside a braced expression, so a
 * `className={...}` holding an angle bracket cannot end it early.
 */
function linkTags(path: string): string[] {
  const src = code(path);
  const tags: string[] = [];
  for (let i = src.indexOf("<Link"); i !== -1; i = src.indexOf("<Link", i + 1)) {
    let depth = 0;
    for (let j = i + 5; j < src.length; j++) {
      const c = src[j];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) {
        tags.push(src.slice(i, j + 1));
        break;
      }
    }
  }
  return tags;
}

/** Components that can put a figure link on screen many times over. */
const FIGURE_LINK_SOURCES = [
  "src/components/shop/offer-link.tsx",
  "src/components/catalog/figure-card.tsx",
  "src/components/collection/collection-table.tsx",
] as const;

describe("figure detail links are not prefetched", () => {
  it("the offer link on a card asks Next not to prefetch it", () => {
    const [tag] = linkTags("src/components/shop/offer-link.tsx");
    expect(tag).toContain("/skylanders/");
    expect(tag).toContain("prefetch={false}");
  });

  it("the showcase card withdraws only the per-figure prefetch", () => {
    const tags = linkTags("src/components/catalog/figure-card.tsx");
    expect(tags).toHaveLength(1);
    const [tag] = tags;
    // The same branch serves the signed-out catalog card, whose `href` is one
    // shared sign-in destination rather than one page per figure. That one
    // keeps Next's default, so the condition is the point of the assertion.
    expect(tag).toContain("prefetch={href ? undefined : false}");
    expect(tag).not.toContain("prefetch={false}");
  });

  it("both rows of the collection table ask Next not to prefetch", () => {
    // Two links per row — the desktop table and the phone list — and the
    // table is this page's default view.
    const tags = linkTags("src/components/collection/collection-table.tsx");
    expect(tags).toHaveLength(2);
    for (const tag of tags) {
      expect(tag).toContain("/skylanders/");
      expect(tag).toContain("prefetch={false}");
    }
  });

  /**
   * The positive guarantee, rather than three negative ones.
   *
   * The tests above name the three links that exist today. This one holds for
   * a link added tomorrow: anywhere in the application, a `<Link>` that leads
   * to a figure's detail page carries a `prefetch` prop that is switched off.
   */
  it("holds for every figure link in the application, including future ones", () => {
    const files = globSync("src/**/*.tsx").filter((f) => !f.endsWith(".test.tsx"));
    const figureLinks = files.flatMap((file) =>
      linkTags(file)
        .filter((tag) => tag.includes("/skylanders/"))
        .map((tag) => ({ file, tag })),
    );

    // If this drops to zero the scan broke, and the test would pass vacuously.
    expect(figureLinks.length).toBeGreaterThanOrEqual(4);

    for (const { file, tag } of figureLinks) {
      expect(tag, `${file} links to a figure page`).toMatch(/prefetch=\{[^}]*false/);
    }
  });

  it("does not disable prefetching by editing Link itself", () => {
    // A global default would be the easy shortcut and the wrong fix: it would
    // take the main navigation with it.
    for (const file of FIGURE_LINK_SOURCES) {
      expect(code(file)).not.toContain("prefetch={true}");
    }
  });
});

describe("the main sections keep their prefetch", () => {
  it("leaves the catalog and the account without a prefetch prop at all", () => {
    const nav = code(NAV);
    // Read as source rather than parsed: these are object literals in
    // DESTINATIONS, and what matters is that neither grew a `prefetch` key.
    const catalog = nav.slice(nav.indexOf('href: "/",'), nav.indexOf('href: "/collection"'));
    expect(catalog).not.toContain("prefetch");

    const account = nav.slice(nav.indexOf('href: "/account"'), nav.indexOf('href: "/login"'));
    expect(account).not.toContain("prefetch");
  });

  it("keeps the collection on Next's default for a signed-in visitor", () => {
    expect(code(NAV)).toContain("prefetch: (viewer) => (viewer.signedIn ? undefined : false)");
  });

  it("still switches prefetch off for the operator destinations only", () => {
    const nav = code(NAV);
    expect(nav.match(/prefetch: \(\) => false/g)).toHaveLength(3);
  });

  it("leaves the cart, the shop and the about page prefetching", () => {
    // The floating cart used to be in this list. It was removed in V3.4;
    // the header's cart is the one link to /cart now.
    for (const file of [
      "src/components/cart/cart-badge.tsx",
      "src/components/layout/site-footer.tsx",
    ]) {
      for (const tag of linkTags(file)) {
        expect(tag, `${file} must keep Next's default`).not.toContain("prefetch");
      }
    }
  });
});
