import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { de } from "@/lib/i18n/de";

/**
 * Structural guards for the collection's controls (ADR-0038, V4.2).
 *
 * These are questions about how the page is wired, not about what a function
 * returns: whether the duplicates filter still sits in the series bar,
 * whether the table can remove a row at all. Rendering would answer neither
 * without a DOM, so the source is read directly — the same approach the world
 * background guard takes.
 */
function source(path: string): string {
  return readFileSync(path, "utf8");
}

const VIEW = "src/components/collection/collection-view.tsx";
const TABLE = "src/components/collection/collection-table.tsx";

describe("the series bar navigates, the filter narrows", () => {
  it("no longer offers duplicates as a seventh game", () => {
    // A duplicate is not a game. As a tab it also made "the duplicates in
    // Giants" unreachable, because one control answered both questions.
    const view = source(VIEW);
    const scopeOptions = view.slice(
      view.indexOf("const scopeOptions"),
      view.indexOf("];", view.indexOf("const scopeOptions")),
    );
    expect(scopeOptions).toContain("de.collection.filter.all");
    expect(scopeOptions).not.toContain("de.collection.filter.duplicates");
  });

  it("mounts the filter menu beside the series bar", () => {
    expect(source(VIEW)).toMatch(/<FilterMenu[\s\S]{0,120}onChange=\{setFilters\}/);
  });

  it("resets the filters as well as the search, and only then", () => {
    const view = source(VIEW);
    const reset = view.slice(view.indexOf("function reset()"), view.indexOf("}", view.indexOf("function reset()")));
    expect(reset).toContain("setScope(COLLECTION_ALL)");
    expect(reset).toContain("setFilters(NO_FILTERS)");
    expect(reset).toContain('setQuery("")');
    // The offer to reset is itself conditional on something being active.
    expect(view).toContain("hasActiveFilter(scope, query, filters)");
  });
});

describe("the table can remove a row", () => {
  it("has an action column, rightmost", () => {
    const table = source(TABLE);
    const head = table.slice(table.indexOf("<thead>"), table.indexOf("</thead>"));
    expect(head).toContain("de.collection.table.action");
    // Last header cell: the action never sits between two numbers.
    expect(head.lastIndexOf("de.collection.table.action")).toBeGreaterThan(
      head.lastIndexOf("de.collection.table.total"),
    );
  });

  it("reuses the card's mutation rather than writing a second one", () => {
    // One optimistic update, one rollback, one desired-end-state mutation
    // (ADR-0027) — the card and the table differ only in how they look.
    expect(source(TABLE)).toContain("useCollectionMutation");
    expect(source("src/components/collection/collection-action.tsx")).toContain(
      "useCollectionMutation",
    );
  });

  it("keeps the undo and asks nothing before removing", () => {
    // ADR-0031: no confirmation dialog, because the row stays on screen and
    // says "Rückgängig".
    const table = source(TABLE);
    expect(table).toContain("de.collection.undo");
    expect(table).not.toMatch(/confirm\(/);
  });

  it("offers nothing on a row that was never owned", () => {
    expect(source(TABLE)).toContain("if (!owned && !justRemoved) return null;");
  });
});

describe("the German surface", () => {
  it("calls the page 'Sammlung'", () => {
    // "Meine Sammlung" said "meine" on a page reachable only as oneself.
    expect(de.collection.title).toBe("Sammlung");
  });

  it("names the action column", () => {
    expect(de.collection.table.action).toBe("Aktion");
  });
});

describe("the catalog's ownership filter", () => {
  const CATALOG = "src/components/catalog/catalog-view.tsx";

  it("starts off: the catalog is the catalog first", () => {
    expect(source(CATALOG)).toContain("useState(false)");
  });

  it("is not offered to someone signed out", () => {
    expect(source(CATALOG)).toMatch(/signedIn \? <OwnedToggle/);
  });

  it("narrows the pool, so search and cross-series results cannot forget it", () => {
    const catalog = source(CATALOG);
    expect(catalog).toContain("ownedFigures(figures, owned)");
    expect(catalog).toContain("filterFigures(pool,");
    expect(catalog).toContain("groupSearchResults(pool,");
  });

  it("has no Specials toggle, because nothing in the data says what a special is", () => {
    // Deliberately absent rather than present and guessed (ADR-0034). The
    // word appears in this file only as the comment saying why there is no
    // control, so the test asks about the control: no state, no label, no
    // component.
    const catalog = source(CATALOG);
    expect(catalog).not.toMatch(/specialsOnly|SpecialsToggle|setSpecials/);
    expect(catalog).not.toMatch(/de\.catalog\.specials/);
    expect(JSON.stringify(de.catalog)).not.toMatch(/[Ss]pecial/);
  });
});
