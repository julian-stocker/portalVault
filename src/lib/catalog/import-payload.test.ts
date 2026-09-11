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
