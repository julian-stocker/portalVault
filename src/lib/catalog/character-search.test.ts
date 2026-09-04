import { describe, expect, it } from "vitest";

import { buildSearchIndex, filterFigures, normalizeForSearch } from "./search.ts";
import { withCharacterSearch } from "./queries.ts";
import { displayNameFor, parseVariant, searchFormsFor } from "./variant.ts";
import type { CatalogFigure } from "@/lib/catalog/types";

/**
 * Character names as an additional search form.
 *
 * "Hot Dog" should also find "Fire Bone Hot Dog" — but only because the two
 * are linked by a curated character_id, never because the strings resemble
 * each other. These tests pin both halves: what it must find, and what it
 * must keep apart.
 */

/** Names of the same series, so the variant rule has its context. */
const SERIES_NAMES = new Set([
  "Hot Dog",
  "Fire Bone Hot Dog",
  "Drobot",
  "Mini Drobit",
  "Bash",
  "Legendary Bash",
  "Bone Bash Roller Brawl",
  "Roller Brawl",
]);

function figure(name: string, characterId: number | null): CatalogFigure {
  const variant = parseVariant(name, SERIES_NAMES);
  return {
    skyId: `SKY-${name.length.toString().padStart(4, "0")}`,
    name,
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    seriesCode: "X",
    seriesLabel: "Testserie",
    seriesPosition: 0,
    categoryPosition: 0,
    categoryName: "Figuren",
    displayName: displayNameFor(name, variant),
    sortBaseName: name,
    sortVariantLabel: null,
    searchIndex: buildSearchIndex(searchFormsFor(name, variant)),
    marketPrice: null,
    imageFile: null,
    isActive: true,
    characterId,
  };
}

const HOT_DOG = 1;
const DROBOT = 2;
const DROBIT = 3;
const BASH = 4;
const ROLLER_BRAWL = 5;

const NAMES = new Map([
  [HOT_DOG, "Hot Dog"],
  [DROBOT, "Drobot"],
  [DROBIT, "Drobit"],
  [BASH, "Bash"],
  [ROLLER_BRAWL, "Roller Brawl"],
]);

const FIGURES = withCharacterSearch(
  [
    figure("Hot Dog", HOT_DOG),
    figure("Fire Bone Hot Dog", HOT_DOG),
    figure("Drobot", DROBOT),
    figure("Mini Drobit", DROBIT),
    figure("Bash", BASH),
    figure("Legendary Bash", BASH),
    figure("Bone Bash Roller Brawl", ROLLER_BRAWL),
    figure("Anvil Rain", null),
  ],
  NAMES,
);

function found(query: string): string[] {
  return filterFigures(FIGURES, { query }).map((entry) => entry.name);
}

describe("withCharacterSearch", () => {
  it("finds a figure by its character name", () => {
    // "Fire Bone Hot Dog" is not a display variant (ADR-0030 leaves it
    // alone), yet a search for the character finds it.
    expect(found("Hot Dog")).toContain("Fire Bone Hot Dog");
  });

  it("appends nothing when the name already contains the character", () => {
    // "fire bone hot dog" already contains "hot dog", so the search above
    // would work even without the link. Adding the form would be redundant.
    const fireBone = FIGURES.find((entry) => entry.name === "Fire Bone Hot Dog")!;
    expect(fireBone.searchIndex).toBe("fire bone hot dog");
  });

  it("carries the search where the name alone cannot — the cases that matter", () => {
    // Modelled on the real catalog: an abbreviation, a hyphen mismatch and a
    // typo in the source. Without the character link none of these three is
    // findable by the character's actual name.
    const cases = [
      { name: "Dark Turbo Charge D.K.", character: "Turbo Charge Donkey Kong" },
      { name: "Elite Dino Rang", character: "Dino-Rang" },
      { name: "Legendary Grim Creemper", character: "Grim Creeper" },
    ];
    const names = new Map(cases.map((entry, index) => [100 + index, entry.character]));
    const figures = withCharacterSearch(
      cases.map((entry, index) => figure(entry.name, 100 + index)),
      names,
    );

    for (const [index, entry] of cases.entries()) {
      const plain = figure(entry.name, null);
      // Proves the append is load-bearing: without it, nothing matches.
      expect(filterFigures([plain], { query: entry.character })).toEqual([]);
      expect(filterFigures([figures[index]], { query: entry.character })).toHaveLength(1);
    }
  });

  it("keeps the existing variant search working", () => {
    expect(found("Bash (Legendary)")).toContain("Legendary Bash");
    expect(found("Bash Legendary")).toContain("Legendary Bash");
  });

  it("does not touch a figure without a character", () => {
    const before = figure("Anvil Rain", null);
    const [after] = withCharacterSearch([before], NAMES);
    expect(after.searchIndex).toBe(before.searchIndex);
  });

  it("does not touch a figure whose character id is unknown", () => {
    const before = figure("Hot Dog", 99);
    const [after] = withCharacterSearch([before], NAMES);
    expect(after.searchIndex).toBe(before.searchIndex);
  });

  it("does not duplicate a name the index already holds", () => {
    const base = figure("Hot Dog", HOT_DOG);
    const once = withCharacterSearch([base], NAMES)[0];
    const twice = withCharacterSearch([once], NAMES)[0];
    expect(twice.searchIndex).toBe(once.searchIndex);
    expect(once.searchIndex).toBe(base.searchIndex);
  });

  it("is idempotent for a figure whose name differs from the character", () => {
    const base = figure("Fire Bone Hot Dog", HOT_DOG);
    const once = withCharacterSearch([base], NAMES)[0];
    const twice = withCharacterSearch([once], NAMES)[0];
    expect(twice.searchIndex).toBe(once.searchIndex);
  });
});

describe("what character search must NOT do", () => {
  it("Drobot never finds Drobit", () => {
    // Two different characters, one letter apart. Nothing fuzzy is allowed
    // to bridge them.
    expect(found("Drobot")).toEqual(["Drobot"]);
    expect(found("Drobot")).not.toContain("Mini Drobit");
    expect(found("Drobit")).toEqual(["Mini Drobit"]);
  });

  it("does not put the character 'Bash' on a Roller Brawl figure", () => {
    const boneBash = FIGURES.find((entry) => entry.name === "Bone Bash Roller Brawl")!;
    expect(boneBash.characterId).toBe(ROLLER_BRAWL);
    expect(boneBash.characterId).not.toBe(BASH);
    expect(boneBash.searchIndex).toContain(normalizeForSearch("Roller Brawl"));
  });

  it("a search for Bash finds Bone Bash Roller Brawl only through its own name", () => {
    // The official product name really does contain the word, so a substring
    // search has always matched it — that behaviour is unchanged and correct.
    // What matters is that the character link does not create the match.
    const boneBash = FIGURES.find((entry) => entry.name === "Bone Bash Roller Brawl")!;
    const withoutCharacter = withCharacterSearch(
      [{ ...boneBash, characterId: null }],
      NAMES,
    )[0];
    expect(withoutCharacter.searchIndex).toContain(normalizeForSearch("Bash"));
    expect(found("Bash")).toContain("Bone Bash Roller Brawl");
  });

  it("finds every Bash figure and no figure of another character by character link", () => {
    const bashFigures = FIGURES.filter((entry) => entry.characterId === BASH).map((e) => e.name);
    expect(bashFigures).toEqual(["Bash", "Legendary Bash"]);
  });
});
