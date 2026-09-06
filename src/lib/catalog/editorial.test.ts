import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { withVariants } from "@/lib/catalog/queries";
import { normalizeForSearch } from "@/lib/catalog/search";
import type { CatalogFigure } from "@/lib/catalog/types";

/**
 * The editorial layer on a figure (ADR-0039).
 *
 * An administrator can choose the public name. The imported name stays, the
 * slug stays, and the search keeps finding both spellings — otherwise a
 * rename would quietly break every link and every remembered search.
 */
function figure(overrides: Partial<CatalogFigure> = {}): CatalogFigure {
  const name = overrides.name ?? "Legendary Bash";
  const override = overrides.displayNameOverride ?? null;
  return {
    skyId: "SKY-0002",
    name,
    slug: "legendary-bash",
    seriesCode: "SA",
    seriesLabel: "Spyro's Adventure",
    seriesPosition: 0,
    categoryPosition: 0,
    categoryName: "Figuren",
    categoryId: 1,
    catalogGroup: "figure",
    displayName: override ?? name,
    sortBaseName: override ?? name,
    sortVariantLabel: null,
    searchIndex: [override, name]
      .filter(Boolean)
      .map((form) => normalizeForSearch(form as string))
      .join(" | "),
    marketPrice: 10,
    imageFile: null,
    isActive: true,
    catalogVisible: true,
    canonicalName: name,
    displayNameOverride: override,
    element: null,
    characterId: null,
    ...overrides,
  };
}

const NAMES = new Map([["SA", new Set(["Bash"])]]);

describe("the display name override", () => {
  it("wins over the derived name", () => {
    // Without an override this row would read "Bash (Legendary)" (ADR-0030).
    const [derived] = withVariants([figure()], NAMES);
    expect(derived.displayName).toBe("Bash (Legendary)");

    const [chosen] = withVariants([figure({ displayNameOverride: "Bash, legend\u00e4r" })], NAMES);
    expect(chosen.displayName).toBe("Bash, legend\u00e4r");
  });

  it("leaves the imported name untouched", () => {
    const [chosen] = withVariants([figure({ displayNameOverride: "Bash, legend\u00e4r" })], NAMES);
    expect(chosen.name).toBe("Legendary Bash");
    expect(chosen.canonicalName).toBe("Legendary Bash");
  });

  it("does not move the slug", () => {
    // ADR-0011: the slug is navigation, the SKY-ID is identity. A rename must
    // not break an existing link.
    const [chosen] = withVariants([figure({ displayNameOverride: "Etwas ganz anderes" })], NAMES);
    expect(chosen.slug).toBe("legendary-bash");
  });

  it("is found by both names", () => {
    const chosen = figure({ displayNameOverride: "Bash, legend\u00e4r" });
    expect(chosen.searchIndex).toContain(normalizeForSearch("Bash, legend\u00e4r"));
    expect(chosen.searchIndex).toContain(normalizeForSearch("Legendary Bash"));
  });

  it("comes back to the derivation when it is cleared", () => {
    const [reset] = withVariants([figure({ displayNameOverride: null })], NAMES);
    expect(reset.displayName).toBe("Bash (Legendary)");
  });

  it("switches the variant derivation off while it is set", () => {
    // The public name has been decided; inferring a base name from the
    // canonical one would fight that decision in the sort order.
    const [chosen] = withVariants([figure({ displayNameOverride: "Zebra" })], NAMES);
    expect(chosen.sortBaseName).toBe("Zebra");
    expect(chosen.sortVariantLabel).toBeNull();
  });
});

/**
 * Import safety (ADR-0039).
 *
 * The importer's payload names its columns, so PostgREST writes ON CONFLICT
 * DO UPDATE SET for exactly those and leaves everything else alone. That is
 * the only thing keeping editorial work from being erased on the next run.
 */
describe("the import never touches editorial columns", () => {
  const source = readFileSync("tools/import-catalog.mts", "utf8");

  const ADMIN_OWNED = [
    "catalog_visible",
    "display_name_override",
    "admin_note",
    "edited_at",
    "edited_by",
    "catalog_group",
  ];

  it("does not name one of them anywhere in its code", () => {
    const code = source
      .split("\n")
      .filter((line) => {
        const trimmed = line.trimStart();
        return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("/*");
      })
      .join("\n");
    for (const column of ADMIN_OWNED) {
      expect(code, column).not.toContain(column);
    }
  });

  it("writes categories with position only, so a group survives an import", () => {
    expect(source).toContain(".update({ position: category.position })");
  });

  it("is readable by text tools again", () => {
    // Five raw NUL bytes made `file` call this source binary and made grep
    // skip it silently. The escape below is the same character at runtime.
    expect(source.includes(String.fromCharCode(0))).toBe(false);
    expect(source).toContain("\\u0000");
  });

  it("still separates its lookup keys with a character no name contains", () => {
    const separator = String.fromCharCode(0);
    const key = `SA${separator}Figuren`;
    expect(key.length).toBe(10);
    expect(key.split(separator)).toEqual(["SA", "Figuren"]);
  });
});
