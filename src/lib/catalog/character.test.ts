import { describe, expect, it } from "vitest";

import {
  ELEMENTS,
  MAX_DESCRIPTION_LENGTH,
  ROLE_TYPES,
  firstReleaseSeries,
  isElement,
  isRoleType,
  validateCuratedFile,
} from "./character.ts";
import type { CatalogFigure } from "@/lib/catalog/types";

function entry(overrides: Record<string, unknown> = {}) {
  return {
    canonical_name: "Drobot",
    element: "Tech",
    species: "Drache",
    role_type: "core",
    short_description: "Kurz und selbst geschrieben.",
    source_url: "https://example.org/drobot",
    source_label: "Beispielquelle",
    verified_at: "2026-09-04",
    sky_ids: ["SKY-0028"],
    ...overrides,
  };
}

function file(...characters: unknown[]) {
  return { note: "test", characters };
}

/** Only the fields the derivation looks at. */
function figure(skyId: string, seriesCode: string, seriesPosition: number): CatalogFigure {
  return {
    skyId,
    name: skyId,
    slug: skyId.toLowerCase(),
    seriesCode,
    seriesLabel: `Serie ${seriesCode}`,
    seriesPosition,
    categoryPosition: 0,
    categoryName: "Figuren",
    categoryId: 1,
    catalogGroup: "figure",
    catalogVisible: true,
    canonicalName: "",
    displayNameOverride: null,
    displayName: skyId,
    sortBaseName: skyId,
    sortVariantLabel: null,
    searchIndex: skyId.toLowerCase(),
    marketPrice: null,
    imageFile: null,
    isActive: true,
    element: null,
    characterId: 1,
  };
}

const NO_CATALOG = new Set<string>();

describe("the value lists mirror the database CHECKs", () => {
  it("holds the ten canonical elements", () => {
    expect(ELEMENTS).toHaveLength(10);
    expect([...ELEMENTS].sort()).toEqual(
      ["Air", "Dark", "Earth", "Fire", "Life", "Light", "Magic", "Tech", "Undead", "Water"].sort(),
    );
  });

  it("holds the eight product lines", () => {
    expect(ROLE_TYPES).toHaveLength(8);
    expect(ROLE_TYPES).toContain("sensei");
    expect(ROLE_TYPES).toContain("sidekick");
  });

  it("recognises valid values and rejects near misses", () => {
    expect(isElement("Tech")).toBe(true);
    expect(isElement("tech")).toBe(false); // case matters, the CHECK is exact
    expect(isElement("Kaos")).toBe(false); // Kaos' own element is not one of the ten
    expect(isRoleType("trap-master")).toBe(true);
    expect(isRoleType("trapmaster")).toBe(false);
  });
});

describe("validateCuratedFile", () => {
  it("accepts a well formed file", () => {
    const result = validateCuratedFile(file(entry()), NO_CATALOG);
    expect(result.problems).toEqual([]);
    expect(result.characters).toHaveLength(1);
  });

  it("reports every problem at once rather than stopping at the first", () => {
    const { problems } = validateCuratedFile(
      file(entry({ element: "Wind", role_type: "hero", source_url: "http://example.org" })),
      NO_CATALOG,
    );
    expect(problems).toHaveLength(3);
  });

  it("rejects an element outside the ten", () => {
    const { problems } = validateCuratedFile(file(entry({ element: "Wind" })), NO_CATALOG);
    expect(problems.join(" ")).toContain("element 'Wind'");
  });

  it("accepts a null element — unknown is not the same as wrong", () => {
    expect(validateCuratedFile(file(entry({ element: null })), NO_CATALOG).problems).toEqual([]);
  });

  it("rejects an unknown role_type", () => {
    const { problems } = validateCuratedFile(file(entry({ role_type: "villain" })), NO_CATALOG);
    expect(problems.join(" ")).toContain("role_type 'villain'");
  });

  it("rejects a description longer than the limit", () => {
    const { problems } = validateCuratedFile(
      file(entry({ short_description: "x".repeat(MAX_DESCRIPTION_LENGTH + 1) })),
      NO_CATALOG,
    );
    expect(problems.join(" ")).toContain("the limit is 600");
  });

  it("accepts a description exactly at the limit", () => {
    const { problems } = validateCuratedFile(
      file(entry({ short_description: "x".repeat(MAX_DESCRIPTION_LENGTH) })),
      NO_CATALOG,
    );
    expect(problems).toEqual([]);
  });

  it("rejects a source_url that is not https", () => {
    const { problems } = validateCuratedFile(
      file(entry({ source_url: "http://example.org" })),
      NO_CATALOG,
    );
    expect(problems.join(" ")).toContain("https://");
  });

  it("rejects the same SKY-ID assigned to two characters", () => {
    const { problems } = validateCuratedFile(
      file(
        entry({ canonical_name: "Drobot", sky_ids: ["SKY-0028"] }),
        entry({ canonical_name: "Drobit", sky_ids: ["SKY-0028"] }),
      ),
      NO_CATALOG,
    );
    expect(problems.join(" ")).toContain("SKY-0028 is already assigned to 'Drobot'");
  });

  it("rejects the same SKY-ID twice within one character", () => {
    const { problems } = validateCuratedFile(
      file(entry({ sky_ids: ["SKY-0028", "SKY-0028"] })),
      NO_CATALOG,
    );
    expect(problems.join(" ")).toContain("already assigned");
  });

  it("rejects a duplicate character name, compared case-insensitively", () => {
    const { problems } = validateCuratedFile(
      file(entry({ sky_ids: ["SKY-0028"] }), entry({ canonical_name: "drobot", sky_ids: ["SKY-0156"] })),
      NO_CATALOG,
    );
    expect(problems.join(" ")).toContain("canonical_name already used");
  });

  it("rejects a SKY-ID the catalog does not contain", () => {
    const { problems } = validateCuratedFile(
      file(entry({ sky_ids: ["SKY-9999"] })),
      new Set(["SKY-0028"]),
    );
    expect(problems.join(" ")).toContain("SKY-9999 does not exist");
  });

  it("rejects anything that is not a SKY-ID", () => {
    const { problems } = validateCuratedFile(
      file(entry({ sky_ids: ["0028", "sky-0028", ""] })),
      NO_CATALOG,
    );
    expect(problems).toHaveLength(3);
  });

  it("rejects an unknown field rather than ignoring it", () => {
    // A typo in curated data is silent data loss.
    const { problems } = validateCuratedFile(file(entry({ gender: "male" })), NO_CATALOG);
    expect(problems.join(" ")).toContain("unknown field 'gender'");
  });

  it("rejects an unknown top level field", () => {
    const { problems } = validateCuratedFile({ notes: "typo", characters: [] }, NO_CATALOG);
    expect(problems.join(" ")).toContain("unknown top level field 'notes'");
  });

  it("rejects a character without SKY-IDs", () => {
    const { problems } = validateCuratedFile(file(entry({ sky_ids: [] })), NO_CATALOG);
    expect(problems.join(" ")).toContain("non-empty array");
  });

  it("rejects a blank canonical_name", () => {
    const { problems } = validateCuratedFile(file(entry({ canonical_name: "  " })), NO_CATALOG);
    expect(problems.join(" ")).toContain("non-empty string");
  });

  it("rejects a file that is not an object", () => {
    expect(validateCuratedFile([], NO_CATALOG).problems).toEqual([
      "the file must contain a JSON object",
    ]);
  });
});

describe("firstReleaseSeries", () => {
  it("picks the earliest series among the linked figures", () => {
    const result = firstReleaseSeries([
      figure("SKY-0156", "G", 1),
      figure("SKY-0028", "SA", 0),
      figure("SKY-0157", "G", 1),
    ]);
    expect(result).toEqual({ code: "SA", label: "Serie SA" });
  });

  it("does not care about the order it is given", () => {
    const forward = firstReleaseSeries([figure("a", "SA", 0), figure("b", "I", 5)]);
    const backward = firstReleaseSeries([figure("b", "I", 5), figure("a", "SA", 0)]);
    expect(forward).toEqual(backward);
  });

  it("returns null for no figures at all", () => {
    expect(firstReleaseSeries([])).toBeNull();
  });

  it("returns the only series when a character has one figure", () => {
    expect(firstReleaseSeries([figure("SKY-0493", "SC", 4)])?.code).toBe("SC");
  });
});
