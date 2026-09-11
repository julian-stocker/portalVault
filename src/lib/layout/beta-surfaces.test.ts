import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

/**
 * The three surfaces the UX beta gate added or repaired, asserted against the
 * source rather than a renderer: a footer that exists, a hero that explains
 * itself to a stranger and stays quiet for a collector, and a design system
 * nobody has stepped around again.
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

const FOOTER = "src/components/layout/site-footer.tsx";
const PUBLIC_LAYOUT = "src/app/(public)/layout.tsx";
const APP_LAYOUT = "src/app/(app)/layout.tsx";
const ADMIN_LAYOUT = "src/app/(admin)/layout.tsx";
const CATALOG_VIEW = "src/components/catalog/catalog-view.tsx";
const ABOUT = "src/app/(public)/ueber-skyisles/page.tsx";

describe("the footer exists at all", () => {
  it("renders a real footer element", () => {
    expect(code(FOOTER)).toContain("<footer");
  });

  it("is mounted on the public shell and on the signed-in shell", () => {
    for (const layout of [PUBLIC_LAYOUT, APP_LAYOUT]) {
      expect(code(layout)).toContain("<SiteFooter />");
    }
  });

  /** The operator's workbench has no visitors to orient (ADR-0042). */
  it("is not mounted in the admin area", () => {
    expect(code(ADMIN_LAYOUT)).not.toContain("SiteFooter");
  });

  /**
   * A short page must still push the footer down, or it floats in the middle
   * of the viewport and looks more broken than no footer at all.
   */
  it("sits at the bottom of a short page", () => {
    for (const layout of [PUBLIC_LAYOUT, APP_LAYOUT]) {
      const source = code(layout);
      expect(source).toContain("min-h-screen flex-col");
      expect(source).toContain("flex-1");
    }
  });
});

describe("the footer links nowhere that does not exist", () => {
  const footer = code(FOOTER);

  /**
   * The legal texts are a release gate of their own and none is written. A
   * dead link is worse than a missing one, and a page called "Impressum" with
   * no Impressum in it is worse than both.
   */
  it("does not link the unwritten legal pages", () => {
    for (const slug of ["/impressum", "/datenschutz", "/widerruf", "/agb", "/kontakt"]) {
      expect(footer).not.toContain(`href="${slug}"`);
      expect(footer).not.toContain(`href: "${slug}"`);
    }
  });

  it("does not ship placeholder legal routes either", () => {
    for (const route of ["impressum", "datenschutz", "widerruf", "agb", "kontakt"]) {
      expect(existsSync(`src/app/(public)/${route}/page.tsx`)).toBe(false);
    }
  });

  it("every destination it does link is a route that exists", () => {
    // Both forms: the JSX attribute on the wordmark, and the data list the
    // navigation is built from.
    const linked = [
      ...[...footer.matchAll(/href="(\/[^"]*)"/g)].map((match) => match[1]),
      ...[...footer.matchAll(/href:\s*"(\/[^"]*)"/g)].map((match) => match[1]),
    ];
    expect(linked.length).toBeGreaterThan(1);

    const ROUTES: Record<string, string> = {
      "/": "src/app/(public)/(catalog)/page.tsx",
      "/shop": "src/app/(public)/shop/page.tsx",
      "/ueber-skyisles": "src/app/(public)/ueber-skyisles/page.tsx",
    };

    for (const href of linked) {
      expect(ROUTES[href], `footer links ${href}, which has no page`).toBeTruthy();
      expect(existsSync(ROUTES[href])).toBe(true);
    }
  });

  it("offers the shop and the about page as destinations", () => {
    expect(footer).toContain('href: "/shop"');
    expect(footer).toContain('href: "/ueber-skyisles"');
  });
});

describe("the hero explains itself — to a stranger only", () => {
  const view = code(CATALOG_VIEW);

  it("shows the value proposition when signed out and the working subline when signed in", () => {
    expect(view).toContain("signedIn || admin ? de.catalog.intro : de.catalog.valueProp");
  });

  it("offers the two actions only to somebody without an account", () => {
    expect(view).toContain("de.catalog.ctaPrimary");
    expect(view).toContain("de.catalog.ctaSecondary");
    // The whole row is behind the same guard, so a collector's catalog is
    // byte-for-byte what it was.
    expect(view).toContain("{signedIn || admin ? null : (");
  });

  it("sends a new visitor to registration, not to sign-in", () => {
    expect(view).toContain('href="/register"');
  });

  it("points the secondary action at the page ADR-0025 promised", () => {
    expect(view).toContain('href="/ueber-skyisles"');
    expect(existsSync(ABOUT)).toBe(true);
  });

  /**
   * `/` is the catalog (ADR-0025). The hero gained a sentence and a row of
   * links; it must not have gained a marketing device.
   */
  it("adds no banner, modal or dismissible interruption", () => {
    for (const forbidden of ["Dialog", "Modal", "Popup", "localStorage", "dismiss"]) {
      expect(view).not.toContain(forbidden);
    }
  });
});

describe("no design-system regressions", () => {
  /**
   * `rounded-sky` is not a class. The scale is `-sm`/`-md`/`-lg`, so the two
   * places that used the bare name rendered square-cornered among rounded
   * panels.
   */
  it("nobody uses the bare rounded-sky again", () => {
    const offenders: string[] = [];
    for (const path of shippedSources()) {
      // Comments are stripped: the two repaired files name the broken class in
      // a comment explaining why it was broken.
      // Word boundary, so `rounded-sky-md` is not a hit.
      if (/rounded-sky(?![-\w])/.test(code(path))) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });

  /**
   * The files the review named. Raw colour names in them were the whole of
   * the drift, and the tokens they should use all already existed.
   */
  it("the repaired files use tokens rather than raw colour names", () => {
    const REPAIRED = [
      "src/app/(public)/checkout/erfolg/page.tsx",
      "src/components/checkout/payment-status.tsx",
      "src/components/checkout/checkout-view.tsx",
      "src/components/admin/ship-order-form.tsx",
      "src/app/(admin)/admin/orders/page.tsx",
      "src/app/(admin)/admin/orders/[orderNumber]/page.tsx",
    ];
    const RAW =
      /(?:bg|text|border|ring)-(?:white|black|red|amber|yellow|green|emerald|blue|orange|gray|slate|zinc|neutral)[-/][0-9]/;

    for (const path of REPAIRED) {
      // Comments name the old values on purpose, so they are stripped first.
      expect(RAW.test(code(path)), `${path} still carries a raw colour`).toBe(false);
    }
  });
});

/**
 * Every source file that actually ships.
 *
 * Tests are excluded, and this one is why: a test that looks for a class name
 * has to spell it, which would otherwise make the guard find itself.
 */
function shippedSources(): string[] {
  return execSync("find src -type f \\( -name '*.ts' -o -name '*.tsx' \\)", { encoding: "utf8" })
    .split("\n")
    .filter((path) => path !== "" && !path.endsWith(".test.ts") && !path.endsWith(".test.tsx"));
}
