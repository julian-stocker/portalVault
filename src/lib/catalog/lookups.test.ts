import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The lookup memo (V3.6).
 *
 * `loadLookups()` reads the two smallest tables in the database — the games
 * and the categories, about sixteen rows together — and almost every catalog
 * read needs them. One render of /collection asked four separate times, which
 * is eight round trips for those sixteen rows.
 *
 * Memoising it is only safe because of two facts outside the function itself:
 * the memo lasts exactly one request, and nothing writes those tables and
 * then reads them back inside one request. A test that only checked for the
 * word `cache` would prove neither, so both are asserted here.
 */
function source(path: string): string {
  return readFileSync(path, "utf8");
}

/** The source with comments removed, so an explanation cannot satisfy a test. */
function code(path: string): string {
  return source(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const QUERIES = "src/lib/catalog/queries.ts";
const ADMIN_ACTIONS = "src/lib/admin/actions.ts";

describe("the lookup tables are read once per request", () => {
  it("is memoised with React's cache, not a module-level map", () => {
    const src = code(QUERIES);
    expect(src).toContain('import { cache } from "react"');
    expect(src).toMatch(/const loadLookups = cache\(/);
  });

  it("keeps nothing between requests", () => {
    // The failure this guards against is someone later "improving" the memo
    // into a module-scoped map, which would outlive the request, be shared
    // between users, and survive a revalidatePath.
    const src = code(QUERIES);
    expect(src).not.toMatch(/^(let|var)\s/m);
    expect(src).not.toContain("globalThis.");
    expect(src).not.toMatch(/^const \w*[Cc]ache\w* = new Map/m);
  });

  it("still has the callers that made it worth memoising", () => {
    // If these disappear the memo is pointless, and the test above would keep
    // passing while guarding nothing.
    const src = code(QUERIES);
    expect(src.match(/loadLookups\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
    expect(code("src/lib/collection/queries.ts")).toContain("loadLookups()");
  });
});

describe("nothing writes these tables and reads them back in one request", () => {
  /**
   * This is what makes a per-request memo indistinguishable from no memo at
   * all. If an action wrote a category and then re-read the lookups in the
   * same invocation, the memo would hand it the pre-write answer.
   */
  const CATALOG_READERS = [
    "loadLookups",
    "fetchCatalog",
    "fetchSeries",
    "fetchNameIndex",
    "fetchCollection",
    "countCollectibleFigures",
    "countCollectibleFiguresBySeries",
  ] as const;

  it("the only writer of series or categories is the admin action module", () => {
    expect(code(ADMIN_ACTIONS)).toContain("admin_set_catalog_group");
  });

  it("and that module reads none of the lookup-backed queries", () => {
    const admin = code(ADMIN_ACTIONS);
    for (const reader of CATALOG_READERS) {
      expect(admin, `${reader} must not be called after a category write`).not.toContain(reader);
    }
  });

  it("an edited category is visible on the next render, not the next hour", () => {
    // The memo dies with the request; what makes the edit appear is that the
    // write revalidates the two pages that show it.
    const admin = code(ADMIN_ACTIONS);
    const setGroup = admin.slice(admin.indexOf("export async function setCatalogGroup"));
    const call = setGroup.slice(0, setGroup.indexOf("}\n"));
    expect(call).toContain('"/"');
    expect(call).toContain('"/collection"');
    expect(admin).toContain("revalidatePath(path)");
  });
});
