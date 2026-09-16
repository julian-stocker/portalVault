import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * A contract test on the catalog importer.
 *
 * The importer upserts figures with a payload that names its columns
 * explicitly. PostgREST turns that into ON CONFLICT DO UPDATE SET for exactly
 * those columns, so a column left out survives an import untouched — which is
 * the only reason curated character links are safe today.
 *
 * That safety is by omission, and omission is easy to lose: one "let's just
 * send the whole row" would silently wipe the curation on the next import.
 * This test reads the tool as text rather than importing it, because the
 * module runs main() on load.
 */
const SOURCE = readFileSync("tools/import-catalog.mts", "utf8");

/**
 * Everything the legacy export owns — and nothing else.
 *
 * The other half of the contract is EDITORIAL below: columns an
 * administrator owns, which an import must never write (ADR-0039).
 */
const ALLOWED = [
  "sky_id",
  "name",
  "slug",
  "series_code",
  "category_id",
  "market_price",
  "image_file",
  "is_active",
];

/**
 * Admin-owned columns. None of these may ever appear in the payload.
 *
 * `image_override_path` is the one with the most to lose (ADR-0046). An
 * administrator replaces a figure's picture through the admin UI; the file
 * goes into the `catalog` storage bucket and the row keeps its path. The
 * import owns `image_file` and overwrites it on every run — so if
 * `image_override_path` ever joined the payload, the next
 * `catalog:import:prod --apply` would silently null out every picture that was
 * ever uploaded in production, and the figures would quietly fall back to the
 * imported images underneath them.
 *
 * Nothing would error. Nothing would be logged. The only symptom would be that
 * the catalog looked the way it did before anybody curated it.
 *
 * The exact-equality test below already catches that; this list is here so the
 * next person reads *why* before they add a column.
 */
const EDITORIAL = [
  "catalog_visible",
  "display_name_override",
  "admin_note",
  "edited_at",
  "edited_by",
  "image_override_path",
  /*
   * Which card the figure is printed on (V3.5).
   *
   * The single reason an administrator's classification survives: the payload
   * names only the columns the legacy export owns, PostgREST turns that into
   * ON CONFLICT DO UPDATE SET for those and no others, and `card_type` is not
   * among them. Set a figure to Chase by hand and the next import leaves it
   * alone — there is no override flag, because none is needed.
   *
   * New figures get 'standard' from the column default. No import-time
   * classification, deliberately: a heuristic that runs on every import is a
   * heuristic that eventually overwrites a decision somebody made.
   */
  "card_type",
  /*
   * Where the row came from (V3.9, ADR-0070).
   *
   * `source` defaults to 'import', so every row the export owns gets the
   * right value without the payload ever naming it — and that is exactly why
   * it must not be named. An admin-created row carries 'admin', and an import
   * that wrote this column would relabel it as its own on the next run: the
   * provenance would be lost, and with it the one thing that keeps
   * admin-created figures out of the "in the database but not in the export"
   * warning forever.
   */
  "source",
];

function figurePayloadKeys(): string[] {
  const start = SOURCE.indexOf("figures.push({");
  expect(start, "figures.push({ ... }) not found — did the importer change shape?").toBeGreaterThan(
    -1,
  );
  const end = SOURCE.indexOf("});", start);
  const block = SOURCE.slice(start, end);
  return [...block.matchAll(/^\s{6}([a-z_]+):/gm)].map((match) => match[1]);
}

describe("the catalog import payload", () => {
  it("writes exactly the columns the legacy export owns", () => {
    expect(figurePayloadKeys().sort()).toEqual([...ALLOWED].sort());
  });

  it("never writes an editorial column", () => {
    // The real guard, the second time: visibility, the public name, the
    // internal note and the uploaded picture are decisions, and an import must
    // not undo a decision.
    const keys = figurePayloadKeys();
    for (const column of EDITORIAL) expect(keys, column).not.toContain(column);
  });

  it("never writes the administrator's uploaded image, anywhere in the tool", () => {
    /*
     * Not just absent from the payload — absent from the code entirely. The
     * catalog import has no business reading or clearing an override, and an
     * `update({ image_override_path: null })` outside the upsert would be just
     * as destructive as one inside it. Comments explaining the separation are
     * welcome and are the reason for the filter.
     */
    const code = SOURCE.split("\n").filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("/*");
    });
    expect(code.filter((line) => line.includes("image_override_path"))).toEqual([]);
  });

  it("never touches the storage bucket the uploads live in", () => {
    // The override is a path; the bytes are a storage object. Deleting the
    // object would break the picture even with the row intact.
    for (const forbidden of [".storage", "CATALOG_BUCKET", "removeObject"]) {
      expect(SOURCE, forbidden).not.toContain(forbidden);
    }
  });

  it("never writes character_id", () => {
    // The real guard: curated character links must survive every import.
    expect(figurePayloadKeys()).not.toContain("character_id");
  });

  it("touches character_id in comments only, never in code", () => {
    // Not in a select, an update or a diff — the catalog import has no
    // business reading or writing the column (ADR-0034). Comments explaining
    // exactly that are welcome and are the reason for the filter.
    const code = SOURCE.split("\n").filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("/*");
    });
    expect(code.filter((line) => line.includes("character_id"))).toEqual([]);
  });

  it("still upserts on sky_id, so identity never comes from the name", () => {
    expect(SOURCE).toContain('onConflict: "sky_id"');
  });
});

/**
 * What V3.6 added to the curated side of the line.
 *
 * `card_type` was already out of the payload (0030). The public display name
 * joined it in a different way: it is not a column at all. It is derived from
 * `name` at read time, so there is nothing for an import to overwrite — which
 * is precisely why V3.6 did not migrate `name`.
 */
describe("the V3.6 naming change cannot be undone by an import", () => {
  const payload = readFileSync("tools/import-catalog.mts", "utf8");

  it("writes no display name, because there is no display name column", () => {
    expect(payload).not.toContain("display_name_override");
    expect(payload).not.toContain("displayName");
    expect(payload).not.toContain("card_type");
  });

  it("leaves the derivation entirely outside the import", () => {
    // The import knows nothing about variants: no token list, no parser, no
    // classification. A heuristic that runs on every import is a heuristic
    // that eventually overwrites a decision somebody made.
    expect(payload).not.toContain("parseVariant");
    expect(payload).not.toContain("VARIANT_TOKENS");
    expect(payload).not.toContain("displayNameFor");
  });

  it("starts a new figure on standard, from the column default", () => {
    const migration = readFileSync("supabase/migrations/0030_card_types.sql", "utf8");
    expect(migration).toContain("card_type text not null default 'standard'");
    // And 0031 does not change that default while adding the sixth value.
    const later = readFileSync("supabase/migrations/0031_special_card_type.sql", "utf8");
    expect(later).not.toContain("set default");
    expect(later).not.toContain("drop default");
  });
});
