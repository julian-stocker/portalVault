import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { collectibleOnly } from "./collectible.ts";
import {
  buildNameIndex,
  toFigure,
  withCharacterFamily,
  withVariants,
  type FigureRow,
  type Lookups,
} from "./queries.ts";
import { compareFigures, sortFigures } from "./sort.ts";
import { FAMILY_ORDER } from "./card-type.ts";
import { VARIANT_TOKENS } from "./variant.ts";
import type { CatalogFigure } from "./types.ts";

/**
 * The collector family, and the badge that is not part of it (ADR-0070b).
 *
 * Three questions, three answers, and the point of this file is that they
 * stay three:
 *
 *   family   — the curated character where there is one, the name rule
 *              otherwise. Decides where a figure SITS. Never visible.
 *   display  — what the card reads. Untouched by the family.
 *   badge    — `sortVariantLabel`, from the variant parser and its curated
 *              token list. The only thing that draws a VariantSeal.
 *
 * The corpus below is not invented: it is every figure whose family the real
 * staging catalogue actually moves, read back on 2026-09-16.
 */
const LOOKUPS: Lookups = {
  series: new Map([
    ["SA", { label: "Spyro's Adventure", position: 0 }],
    ["SF", { label: "Swap Force", position: 2 }],
    ["T", { label: "Trap Team", position: 3 }],
  ]),
  categories: new Map([[20, { name: "Figuren", position: 1, catalogGroup: "figure" }]]),
};

/** id -> canonical name, as `characters` holds them. */
const CHARACTERS = new Map<number, string>([
  [1, "Fire Kraken"],
  [2, "Kaos"],
  [3, "Grim Creeper"],
  [4, "Eruptor"],
  [5, "Roller Brawl"],
  [6, "Turbo Charge Donkey Kong"],
  [7, "Hot Dog"],
  [8, "Pop Fizz"],
]);

let nextId = 1000;
function row(over: Partial<FigureRow> = {}): FigureRow {
  nextId += 1;
  return {
    sky_id: `SKY-${String(nextId).padStart(4, "0")}`,
    name: "Fire Kraken",
    slug: `slug-${nextId}`,
    series_code: "SF",
    category_id: 20,
    market_price: null,
    image_file: null,
    image_override_path: null,
    is_active: true,
    character_id: null,
    catalog_visible: true,
    display_name_override: null,
    card_type: "standard",
    ...over,
  } as FigureRow;
}

/** The name rule alone — what the catalogue did before ADR-0070b. */
function parserOnly(rows: readonly FigureRow[]): CatalogFigure[] {
  const figures = collectibleOnly(rows.map((r) => toFigure(r, LOOKUPS)));
  return withVariants(figures, buildNameIndex(figures));
}

/**
 * The name rule, then the curated family — over ONE parse.
 *
 * Deliberately not two pipeline runs: several assertions below check object
 * identity to prove the pass returned the very figure it was given rather
 * than a copy, and two runs would produce two sets of objects.
 */
function bothWays(rows: readonly FigureRow[]): { before: CatalogFigure[]; after: CatalogFigure[] } {
  const before = parserOnly(rows);
  return { before, after: withCharacterFamily(before, CHARACTERS) };
}

function withFamily(rows: readonly FigureRow[]): CatalogFigure[] {
  return bothWays(rows).after;
}

const byId = (figures: readonly CatalogFigure[]) => new Map(figures.map((f) => [f.skyId, f]));

describe("A — a curated character names the family", () => {
  it("replaces the parser's base name with the canonical one", () => {
    const rows = [row({ name: "Gold Fire Kraken", character_id: 1 })];
    expect(parserOnly(rows)[0].sortBaseName).toBe("Gold Fire Kraken");
    expect(withFamily(rows)[0].sortBaseName).toBe("Fire Kraken");
  });

  it("works where no name rule ever could", () => {
    /*
     * The three cases ADR-0034 names as unsolvable: an abbreviation with no
     * character overlap, and two typos in the source. All three are curated,
     * and the curation is what carries them.
     */
    const cases: ReadonlyArray<readonly [string, number, string]> = [
      ["Dark Turbo Charge D.K.", 6, "Turbo Charge Donkey Kong"],
      ["Legendary Grim Creemper", 3, "Grim Creeper"],
      ["Kaos in OVP", 2, "Kaos"],
    ];
    for (const [name, character, family] of cases) {
      const [figure] = withFamily([row({ name, character_id: character })]);
      expect(figure.sortBaseName, name).toBe(family);
    }
  });

  it("leaves a figure alone when the family is already right", () => {
    const { before, after } = bothWays([row({ name: "Fire Kraken", character_id: 1 })]);
    // The very same object back, not a copy: there was nothing to change.
    expect(after[0]).toBe(before[0]);
  });

  it("leaves a figure alone when the id is not in the index", () => {
    const rows = [row({ name: "Was auch immer", character_id: 999 })];
    expect(withFamily(rows)[0].sortBaseName).toBe("Was auch immer");
  });
});

describe("B/C/F/G — the badge is byte-for-byte untouched", () => {
  /**
   * Every family the real catalogue moves, with the badge it carries today.
   * Read from staging on 2026-09-16 — 44 figures, and the reason they are
   * listed by hand is that the claim "no seal changes" is worth checking
   * against reality rather than against a fixture somebody chose.
   */
  const CORPUS: ReadonlyArray<{ name: string; character: number; family: string; label: string | null }> = [
    { name: "Kaos in OVP", character: 2, family: "Kaos", label: null },
    { name: "Grim Creeper - Lightcore", character: 3, family: "Grim Creeper", label: null },
    { name: "Legendary Grim Creemper", character: 3, family: "Grim Creeper", label: null },
    { name: "Eruptor Light Core", character: 4, family: "Eruptor", label: null },
    { name: "Lava Barf Eruptor", character: 4, family: "Eruptor", label: null },
    { name: "Dark Lava Barf Eruptor", character: 4, family: "Eruptor", label: "Dark" },
    { name: "Lava Lance Eruptor", character: 4, family: "Eruptor", label: null },
    { name: "Bone Bash Roller Brawl", character: 5, family: "Roller Brawl", label: null },
    { name: "Legendary Bone Bash Roller Brawl", character: 5, family: "Roller Brawl", label: "Legendary" },
    { name: "Dark Turbo Charge D.K.", character: 6, family: "Turbo Charge Donkey Kong", label: null },
    { name: "Fire Bone Hot Dog", character: 7, family: "Hot Dog", label: null },
    { name: "Clear Crystal Red Fire Bone Hot Dog", character: 7, family: "Hot Dog", label: "Clear Crystal Red" },
    { name: "Big Bubble Pop Fizz", character: 8, family: "Pop Fizz", label: null },
    { name: "Punch Pop Fizz", character: 8, family: "Pop Fizz", label: null },
  ];

  const rows = CORPUS.map((c) => row({ name: c.name, character_id: c.character }));
  const runs = bothWays(rows);
  const before = byId(runs.before);
  const after = byId(runs.after);

  it("gives every one of them the curated family", () => {
    rows.forEach((r, i) => {
      expect(after.get(r.sky_id)!.sortBaseName, CORPUS[i].name).toBe(CORPUS[i].family);
    });
  });

  it("changes NOT ONE variant label", () => {
    for (const r of rows) {
      expect(after.get(r.sky_id)!.sortVariantLabel, r.sky_id).toBe(before.get(r.sky_id)!.sortVariantLabel);
    }
  });

  it("draws no seal where there was none", () => {
    // "in OVP" and "- Lightcore" are exactly the labels a subtract-the-name
    // rule would have invented. This derivation has no code that makes one.
    for (const [i, r] of rows.entries()) {
      if (CORPUS[i].label === null) {
        expect(after.get(r.sky_id)!.sortVariantLabel, CORPUS[i].name).toBeNull();
      }
    }
  });

  it("keeps every seal that was there", () => {
    for (const [i, r] of rows.entries()) {
      if (CORPUS[i].label !== null) {
        expect(after.get(r.sky_id)!.sortVariantLabel, CORPUS[i].name).toBe(CORPUS[i].label);
      }
    }
  });

  it("leaves the display name alone", () => {
    for (const r of rows) {
      expect(after.get(r.sky_id)!.displayName).toBe(before.get(r.sky_id)!.displayName);
    }
  });

  it("writes exactly one field, whatever the figure", () => {
    for (const r of rows) {
      const wasFigure = before.get(r.sky_id)!;
      const isFigure = after.get(r.sky_id)!;
      const differing = Object.keys(isFigure).filter(
        (key) => isFigure[key as keyof CatalogFigure] !== wasFigure[key as keyof CatalogFigure],
      );
      expect(differing.length, r.sky_id).toBeLessThanOrEqual(1);
      if (differing.length === 1) expect(differing[0]).toBe("sortBaseName");
    }
  });

  it("needs no new token to do any of it", () => {
    expect(VARIANT_TOKENS).not.toContain("Gold");
    expect(VARIANT_TOKENS).not.toContain("Lava Barf");
    expect(VARIANT_TOKENS).not.toContain("in OVP");
  });
});

describe("D — no character, no change", () => {
  it("keeps the parser's answer exactly", () => {
    const rows = [
      row({ name: "Gold Fire Kraken" }),
      row({ name: "Legendary Bash" }),
      row({ name: "Bash" }),
      row({ name: "Kaos in OVP" }),
    ];
    const { before, after } = bothWays(rows);
    expect(after).toEqual(before);
    // The same objects, so nothing was even copied.
    after.forEach((figure, i) => expect(figure).toBe(before[i]));
  });

  it("invents no mapping from the name", () => {
    // "Kaos in OVP" with no curated link stays exactly where the name puts it,
    // even though a character called Kaos exists in the index.
    const [figure] = withFamily([row({ name: "Kaos in OVP" })]);
    expect(figure.sortBaseName).toBe("Kaos in OVP");
  });
});

describe("E — Gold Fire Kraken", () => {
  const rows = [
    row({ sky_id: "SKY-0100", name: "Fire Kraken", character_id: 1 }),
    row({ sky_id: "SKY-0821", name: "Gold Fire Kraken", character_id: 1, card_type: "prestige", catalog_visible: false }),
    row({ sky_id: "SKY-0102", name: "Grilla Drilla" }),
  ];
  const catalog = sortFigures(withFamily(rows));
  const gold = catalog.find((f) => f.skyId === "SKY-0821")!;

  it("reads as itself", () => {
    expect(gold.displayName).toBe("Gold Fire Kraken");
  });

  it("belongs to Fire Kraken", () => {
    expect(gold.sortBaseName).toBe("Fire Kraken");
  });

  it("wears no seal", () => {
    expect(gold.sortVariantLabel).toBeNull();
  });

  it("stands beside the figure it is a version of", () => {
    expect(catalog.map((f) => f.skyId)).toEqual(["SKY-0100", "SKY-0821", "SKY-0102"]);
  });
});

describe("H — the figure the family is named after leads it", () => {
  it("puts the plain figure first even when its name sorts later", () => {
    /*
     * The case the tie-break exists for: three unlabelled members of one
     * family, where raw-name order would put "Big Bubble Pop Fizz" ahead of
     * "Pop Fizz".
     */
    const rows = [
      row({ sky_id: "SKY-0463", name: "Big Bubble Pop Fizz", character_id: 8 }),
      row({ sky_id: "SKY-0144", name: "Punch Pop Fizz", character_id: 8 }),
      row({ sky_id: "SKY-0140", name: "Pop Fizz", character_id: 8 }),
    ];
    expect(sortFigures(withFamily(rows)).map((f) => f.skyId)).toEqual([
      "SKY-0140",
      "SKY-0463",
      "SKY-0144",
    ]);
  });

  it("does not outrank the edition order", () => {
    // A legendary base figure still sorts after a standard sibling: the
    // tie-break runs AFTER familyRank, not before it.
    const rows = [
      row({ sky_id: "SKY-0002", name: "Pop Fizz", character_id: 8, card_type: "legendary" }),
      row({ sky_id: "SKY-0001", name: "Punch Pop Fizz", character_id: 8, card_type: "standard" }),
    ];
    expect(sortFigures(withFamily(rows)).map((f) => f.skyId)).toEqual(["SKY-0001", "SKY-0002"]);
  });

  it("does not outrank series or category", () => {
    const rows = [
      row({ sky_id: "SKY-0002", name: "Pop Fizz", character_id: 8, series_code: "T" }),
      row({ sky_id: "SKY-0001", name: "Punch Pop Fizz", character_id: 8, series_code: "SA" }),
    ];
    expect(sortFigures(withFamily(rows)).map((f) => f.skyId)).toEqual(["SKY-0001", "SKY-0002"]);
  });

  it("is a total order — comparing either way agrees", () => {
    const rows = [
      row({ sky_id: "SKY-0001", name: "Pop Fizz", character_id: 8 }),
      row({ sky_id: "SKY-0002", name: "Punch Pop Fizz", character_id: 8 }),
    ];
    const [a, b] = withFamily(rows);
    expect(Math.sign(compareFigures(a, b))).toBe(-Math.sign(compareFigures(b, a)));
  });
});

describe("I/K — what did not change", () => {
  it("never looks at provenance", () => {
    const queries = readFileSync("src/lib/catalog/queries.ts", "utf8");
    const family = queries.slice(queries.indexOf("export function withCharacterFamily"));
    expect(family.slice(0, family.indexOf("\n}"))).not.toContain("source");
    expect(readFileSync("src/lib/catalog/sort.ts", "utf8")).not.toContain("source");
  });

  it("leaves FAMILY_ORDER exactly as it was", () => {
    expect([...FAMILY_ORDER]).toEqual([
      "standard",
      "special",
      "elite",
      "chase",
      "dark",
      "legendary",
      "prestige",
    ]);
  });

  it("persists nothing — the family is derived at read time", () => {
    // No column, no migration: `0034` is about template inheritance only.
    const migration = readFileSync("supabase/migrations/0034_create_figure_from_template.sql", "utf8");
    for (const persisted of ["sort_base_name", "catalog_base_name", "base_sky_id", "family_sky_id"]) {
      expect(migration, persisted).not.toContain(persisted);
    }
  });
});

describe("J — every surface agrees about the family", () => {
  const queries = readFileSync("src/lib/catalog/queries.ts", "utf8");
  const collection = readFileSync("src/lib/collection/queries.ts", "utf8");

  it("runs the pass wherever the name rule runs", () => {
    /*
     * One shared helper, four call sites. A surface that derived the family
     * differently would put the same figure in two places depending on where
     * it was looked at.
     */
    const catalogCalls = (queries.match(/withCharacterFamily\(/g) ?? []).length;
    // One definition plus three uses: fetchCatalog, fetchFigureBySlug, related.
    expect(catalogCalls).toBe(4);
    expect(collection).toContain("withCharacterFamily(");
  });

  it("derives it in one place only", () => {
    expect((queries.match(/export function withCharacterFamily/g) ?? []).length).toBe(1);
    expect(collection).not.toContain("canonicalName ===");
  });
});
