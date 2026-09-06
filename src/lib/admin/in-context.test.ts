import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The administrator works in the catalog, not beside it (ADR-0042).
 *
 * These guard the architecture the decision rests on: one catalog, one card,
 * one set of mutations. A second component tree for administrators would
 * drift from the collector's within a release, and a second mutation would
 * be a second thing to secure.
 */
function source(path: string): string {
  return readFileSync(path, "utf8");
}

/** The file without its comments — for asking what the code does, not what it says. */
function code(path: string): string {
  return source(path)
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("/*");
    })
    .join("\n");
}

const VIEW = "src/components/catalog/catalog-view.tsx";
const CARD = "src/components/catalog/catalog-card.tsx";
const FIGURE = "src/components/catalog/figure-card.tsx";
const PAGE = "src/app/(public)/(catalog)/page.tsx";
const NAV = "src/components/layout/site-nav.tsx";
const ACTIONS = "src/components/admin/card-actions.tsx";
const INLINE = "src/components/admin/inline-name.tsx";

describe("one catalog, one card", () => {
  it("has no second catalog view and no second card component", () => {
    for (const forbidden of [
      "src/components/admin/admin-catalog-view.tsx",
      "src/components/admin/admin-catalog-card.tsx",
      "src/components/catalog/admin-catalog-card.tsx",
    ]) {
      expect(() => source(forbidden), forbidden).toThrow();
    }
  });

  it("branches inside CatalogCard rather than beside it", () => {
    const card = source(CARD);
    expect(card).toContain("if (admin) {");
    // Both branches render the same presentation component.
    expect((card.match(/<FigureCard/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("keeps presentation in FigureCard, which knows nothing about roles", () => {
    const figure = code(FIGURE);
    expect(figure).not.toContain("isAdmin");
    expect(figure).not.toMatch(/\badmin\b/);
    // It gained slots, not decisions.
    for (const slot of ["nameSlot", "statusBadge", "interactive", "muted"]) {
      expect(figure, slot).toContain(slot);
    }
  });

  it("renders both modes through one card factory", () => {
    const view = source(VIEW);
    expect(view).toContain("function card(figure: CatalogFigure)");
    expect((view.match(/<CatalogCard/g) ?? []).length).toBe(1);
  });
});

describe("the role comes from the server", () => {
  it("is asked on the page, from the database predicate", () => {
    const page = source(PAGE);
    expect(page).toContain("const admin = await isAdmin();");
    expect(page).toContain('from "@/lib/auth/admin"');
  });

  it("is never derived in the browser", () => {
    // Read from the code, not from the comments that explain where the
    // decision really happens.
    for (const path of [VIEW, CARD, ACTIONS, INLINE]) {
      expect(code(path), path).not.toMatch(/@gmail|email|is_shop_admin|jwt|role\s*===/i);
    }
  });

  it("loads hidden figures only for an administrator", () => {
    expect(source(PAGE)).toContain("fetchCatalog({ includeHidden: admin })");
  });

  it("drops exactly one filter for that, keeping the rest", () => {
    const queries = source("src/lib/catalog/queries.ts");
    const fn = queries.slice(queries.indexOf("export async function fetchCatalog"), queries.indexOf("/** One figure by its slug"));
    // Software and inactive rows stay out in both modes: admin mode is the
    // collector catalog plus its hidden entries, not the whole table.
    expect(fn).toContain('.eq("is_active", true)');
    expect(fn).toContain("if (!options.includeHidden)");
    expect(fn).toContain("collectibleOnly(");
  });
});

describe("what an administrator's card offers", () => {
  const card = source(CARD);

  it("edits the public name in place", () => {
    expect(card).toContain("<InlineName");
    expect(card).toContain("override={figure.displayNameOverride}");
  });

  it("shows and hides the figure with a named control", () => {
    // Not a tap on the card: on a phone that is one mis-tap away from taking
    // a figure out of the public catalog.
    expect(card).toContain("interactive={false}");
    expect(source(ACTIONS)).toContain("aria-pressed={visible}");
  });

  it("marks a hidden figure rather than dropping it", () => {
    expect(card).toContain("muted={!visible}");
    expect(card).toContain("<HiddenBadge />");
  });

  it("links to the existing detail editor instead of a second one", () => {
    expect(source(ACTIONS)).toContain("href={`/admin/catalog/${skyId}`}");
  });

  it("offers no collection action", () => {
    const branch = card.slice(card.indexOf("if (admin) {"), card.indexOf("const footer = ("));
    expect(branch).not.toContain("onToggle");
    expect(branch).not.toContain("setCollected");
    expect(branch).not.toContain("initialCollected");
  });
});

describe("the same mutations as /admin, not new ones", () => {
  it("reuses the two server actions", () => {
    expect(source(INLINE)).toContain('import { setDisplayNameOverride } from "@/lib/admin/actions"');
    expect(source(ACTIONS)).toContain('import { setCatalogVisible } from "@/lib/admin/actions"');
  });

  it("adds no database function of its own", () => {
    const actions = source("src/lib/admin/actions.ts");
    const rpcs = [...actions.matchAll(/"(admin_[a-z_]+)"/g)].map((m) => m[1]);
    expect(new Set(rpcs)).toEqual(
      new Set([
        "admin_set_catalog_visible",
        "admin_set_display_name_override",
        "admin_set_admin_note",
        "admin_set_catalog_group",
      ]),
    );
  });

  it("still checks in the database, not in the component", () => {
    const sql = source("supabase/migrations/0004_catalog_editorial.sql");
    for (const fn of ["admin_set_catalog_visible", "admin_set_display_name_override"]) {
      const body = sql.slice(sql.indexOf(`function public.${fn}`), sql.indexOf("$$;", sql.indexOf(`function public.${fn}`)));
      expect(body, fn).toContain("if not public.is_shop_admin() then");
    }
  });
});

describe("the collector's catalog is untouched", () => {
  const view = source(VIEW);

  it("keeps the ownership filter for collectors and hides it from an admin", () => {
    expect(view).toContain("signedIn && !admin ? <OwnedToggle");
    expect(view).toContain("admin || showOwned ? figures : missingFigures(figures, owned)");
  });

  it("keeps collect and remove on a collector's card", () => {
    const card = source(CARD);
    const collector = card.slice(card.indexOf("const footer = ("));
    expect(collector).toContain("onToggle");
    expect(collector).toContain("de.catalog.info");
  });

  it("leaves search and series navigation shared", () => {
    expect(view).toContain("groupSearchResults(pool");
    expect(view).toContain("<SeriesTabs");
  });
});

describe("navigation follows the role", () => {
  const nav = source(NAV);

  it("offers the administrator catalog, admin and account", () => {
    const branch = nav.slice(nav.indexOf("if (admin) {"), nav.indexOf("return [\n    { href: \"/\""));
    expect(branch).toContain('href: "/admin"');
    expect(branch).not.toContain('href: "/collection"');
  });

  it("leaves a collector's three destinations alone", () => {
    expect(nav).toContain('href: "/collection"');
    expect(nav).toContain("de.nav.collection");
  });

  it("marks the mode without rebuilding the site", () => {
    expect(nav).toContain("de.admin.modeBadge");
  });
});
