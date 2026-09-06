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

/** Admin-owned columns. None of these may ever appear in the payload. */
const EDITORIAL = [
  "catalog_visible",
  "display_name_override",
  "admin_note",
  "edited_at",
  "edited_by",
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
    // The real guard, the second time: visibility, the public name and the
    // internal note are decisions, and an import must not undo a decision.
    const keys = figurePayloadKeys();
    for (const column of EDITORIAL) expect(keys, column).not.toContain(column);
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
