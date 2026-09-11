import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The shop finally has an address (F8).
 *
 * What it shows is decided by `shopEntries()` and tested in `surface.test.ts`.
 * This asserts the two properties that make it safe: it is a view over the
 * existing projection rather than a second shop, and no stock level can reach
 * it.
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

const PAGE = "src/app/(public)/shop/page.tsx";
const VIEW = "src/components/shop/shop-view.tsx";

const page = code(PAGE);
const view = code(VIEW);

describe("it is a view, not a second shop", () => {
  it("reads the same two calls the catalog reads", () => {
    expect(page).toContain("fetchCatalog(");
    expect(page).toContain("fetchOffers()");
  });

  it("joins them with the one rule", () => {
    expect(page).toContain("shopEntries(catalog, offers)");
  });

  it("introduces no query, table or RPC of its own", () => {
    expect(page).not.toContain("supabase");
    expect(page).not.toContain(".rpc(");
    expect(view).not.toContain("supabase");
  });

  it("renders the catalog's own card", () => {
    expect(view).toContain("<CatalogCard");
    expect(view).toContain("FigureGrid");
  });

  it("names the game on each card, because this grid mixes all six", () => {
    expect(view).toContain("showSeries");
  });
});

describe("only what can actually be bought", () => {
  it("asks for the public slice of the catalog", () => {
    expect(page).toContain("includeHidden: false");
  });

  it("leaves the buyable test where it already lives", () => {
    const surface = code("src/lib/shop/surface.ts");
    expect(surface).toContain("buyableOffers(");
    // Not a second opinion about availability.
    expect(surface).not.toContain("available === true");
  });
});

describe("no stock level can reach the page", () => {
  it("neither file mentions a quantity", () => {
    for (const source of [page, view]) {
      expect(source).not.toContain("quantity");
      expect(source).not.toContain("reserved");
      expect(source).not.toContain("available:");
    }
  });

  it("the copy states no number of pieces", () => {
    const copy = readFileSync("src/lib/i18n/de.ts", "utf8");
    const block = copy.slice(copy.indexOf("page: {", copy.indexOf("shop: {")));
    expect(block.slice(0, 1200)).not.toMatch(/Nur noch|noch \d+|Stück/);
  });
});

describe("it behaves like the rest of the product", () => {
  it("carries the catalog's sign-in contract for signed-out visitors", () => {
    expect(view).toContain("signedIn");
    expect(view).toContain("/login?next=");
    expect(page).toContain("highlightSkyId={highlight}");
  });

  it("writes nothing from a URL parameter", () => {
    expect(page).toContain("/^SKY-[0-9]{4}$/.test(params.figure)");
  });

  it("does not switch into an editorial mode for the operator", () => {
    // SkyIsles does not buy from itself (ADR-0042), but the shop page is a
    // customer surface and stays one; prices are managed in /admin/inventory.
    expect(page).not.toContain("admin={admin}");
    expect(view).not.toContain("admin");
  });

  it("says the same thing when nothing is listed and when everything is sold out", () => {
    // For a visitor those are the same page, and the difference is a stock
    // fact that is not public.
    expect(view).toContain("entries.length === 0");
    expect(view).toContain("de.shop.page.empty");
  });

  it("is reachable from the footer and the hero, and adds no fourth nav destination", () => {
    expect(code("src/components/layout/site-footer.tsx")).toContain('href: "/shop"');
    expect(code("src/components/catalog/catalog-view.tsx")).toContain('href="/shop"');
    // ADR-0036 keeps three destinations in the bar.
    expect(code("src/components/layout/site-nav.tsx")).not.toContain('href: "/shop"');
  });
});
