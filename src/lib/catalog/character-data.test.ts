import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { firstReleaseSeries, validateCuratedFile } from "./character.ts";
import { isCollectibleCategory } from "./collectible.ts";
import type { CatalogFigure } from "@/lib/catalog/types";

/**
 * The curated pilot data, checked against the real catalog.
 *
 * This is the test that matters most in this milestone. It does not exercise
 * a function — it asserts that 19 hand-made character assignments actually
 * describe the 561 collectibles we have, including every case where a name
 * rule would get it wrong.
 *
 * Both files ship in the repository, so this runs offline.
 */
const curated: unknown = JSON.parse(readFileSync("data/characters/characters.json", "utf8"));
const catalog = JSON.parse(readFileSync("data/catalog/products.json", "utf8")) as {
  series: { code: string; label: string }[];
  items: { id: string; name: string; series: string; category: string }[];
};

const seriesPosition = new Map(catalog.series.map((series, index) => [series.code, index]));
const seriesLabel = new Map(catalog.series.map((series) => [series.code, series.label]));
const item = new Map(catalog.items.map((entry) => [entry.id, entry]));
const knownSkyIds = new Set(catalog.items.map((entry) => entry.id));

const { problems, characters } = validateCuratedFile(curated, knownSkyIds);
const byName = new Map(characters.map((entry) => [entry.canonical_name, entry]));

function idsOf(name: string): string[] {
  const entry = byName.get(name);
  expect(entry, `character '${name}' is missing from the curated file`).toBeDefined();
  return entry!.sky_ids;
}

/** Only what firstReleaseSeries reads. */
function figuresOf(name: string): CatalogFigure[] {
  return idsOf(name).map((skyId) => {
    const row = item.get(skyId)!;
    return {
      seriesCode: row.series,
      seriesLabel: seriesLabel.get(row.series) ?? row.series,
      seriesPosition: seriesPosition.get(row.series) ?? 0,
    } as CatalogFigure;
  });
}

describe("the curated pilot file", () => {
  it("validates against the real catalog with no problems", () => {
    expect(problems).toEqual([]);
  });

  it("holds 19 characters and 104 assignments", () => {
    expect(characters).toHaveLength(19);
    expect(characters.flatMap((entry) => entry.sky_ids)).toHaveLength(104);
  });

  it("assigns only collectibles — never a console game", () => {
    for (const entry of characters) {
      for (const skyId of entry.sky_ids) {
        const row = item.get(skyId)!;
        expect(
          isCollectibleCategory(row.category),
          `${skyId} (${row.name}) is in '${row.category}'`,
        ).toBe(true);
      }
    }
  });

  it("assigns only figures — no trap, vehicle, crystal or magic item", () => {
    const NOT_FIGURES = new Set([
      "Traps",
      "Trap Items",
      "Fahrzeuge",
      "Kreationskristalle",
      "Magic Items",
      "Trophies",
      "Locations & Truhen",
    ]);
    for (const entry of characters) {
      for (const skyId of entry.sky_ids) {
        const row = item.get(skyId)!;
        expect(NOT_FIGURES.has(row.category), `${skyId} is in '${row.category}'`).toBe(false);
      }
    }
  });
});

describe("metadata completeness", () => {
  it("every character carries name, role, description and source", () => {
    for (const entry of characters) {
      expect(entry.canonical_name.length, entry.canonical_name).toBeGreaterThan(0);
      expect(entry.role_type, entry.canonical_name).not.toBeNull();
      expect(entry.short_description, entry.canonical_name).not.toBeNull();
      expect(entry.source_url, entry.canonical_name).not.toBeNull();
      expect(entry.source_label, entry.canonical_name).not.toBeNull();
      expect(entry.verified_at, entry.canonical_name).not.toBeNull();
    }
  });

  it("only Kaos has no element, and that is deliberate", () => {
    // As a Sensei he belongs to his own "Kaos" element, which is not one of
    // the ten. A guess would be worse than a null.
    const missing = characters.filter((entry) => entry.element === null);
    expect(missing.map((entry) => entry.canonical_name)).toEqual(["Kaos"]);
  });

  it("exactly three characters have no species, each with a stated reason", () => {
    // Chill: the source says her species is not established. Star Strike:
    // none was ever defined. Kaos: not defined either.
    const missing = characters.filter((entry) => entry.species === null);
    expect(missing.map((entry) => entry.canonical_name).sort()).toEqual([
      "Chill",
      "Kaos",
      "Star Strike",
    ]);
  });

  it("descriptions are short, own summaries — not pasted articles", () => {
    for (const entry of characters) {
      const text = entry.short_description ?? "";
      expect(text.length, entry.canonical_name).toBeGreaterThan(40);
      expect(text.length, entry.canonical_name).toBeLessThanOrEqual(600);
    }
  });
});

describe("the grouping cases a name rule gets wrong", () => {
  it("Drobot has three figures and does not swallow Mini Drobit", () => {
    // SKY-0373 is "Mini Drobit" — the character Drobit, not Drobot. Any
    // prefix or substring rule would merge them.
    expect(idsOf("Drobot")).toEqual(["SKY-0028", "SKY-0156", "SKY-0157"]);
    expect(idsOf("Drobot")).not.toContain("SKY-0373");
    expect(item.get("SKY-0373")!.name).toBe("Mini Drobit");
    const assigned = new Set(characters.flatMap((entry) => entry.sky_ids));
    expect(assigned.has("SKY-0373")).toBe(false);
  });

  it("Bash does not swallow Bone Bash Roller Brawl", () => {
    // Two SuperChargers figures carry the word "Bash" and belong to other
    // characters entirely.
    expect(idsOf("Bash")).toEqual(["SKY-0007", "SKY-0008", "SKY-0009", "SKY-0148"]);
    expect(idsOf("Roller Brawl")).toContain("SKY-0465");
    expect(idsOf("Roller Brawl")).toContain("SKY-0466");
    for (const skyId of idsOf("Bash")) {
      expect(idsOf("Roller Brawl")).not.toContain(skyId);
    }
    expect(item.get("SKY-0464")!.name).toBe("Birthday Bash Big Bubble Pop Fizz");
    expect(idsOf("Pop Fizz")).toContain("SKY-0464");
  });

  it("Mini Jini is her own character, separate from Ninjini", () => {
    const mini = idsOf("Mini Jini");
    const ninjini = idsOf("Ninjini");
    expect(mini).toEqual(["SKY-0190", "SKY-0377"]);
    expect(ninjini).toEqual(["SKY-0122", "SKY-0123"]);
    expect(mini.some((skyId) => ninjini.includes(skyId))).toBe(false);
    // The same character across two product lines: a Giants sidekick and a
    // Trap Team mini.
    expect(item.get("SKY-0190")!.category).toBe("Sidekicks");
    expect(item.get("SKY-0377")!.category).toBe("Minis");
  });

  it("Kaos covers the two Sensei figures and none of the trap objects", () => {
    expect(idsOf("Kaos")).toEqual(["SKY-0563", "SKY-0564"]);
    const assigned = new Set(characters.flatMap((entry) => entry.sky_ids));
    // Same name, entirely different objects — they stay character_id NULL.
    for (const skyId of ["SKY-0419", "SKY-0420", "SKY-0495"]) {
      expect(item.get(skyId)!.name).toContain("Kaos");
      expect(assigned.has(skyId), `${skyId} must stay unassigned`).toBe(false);
    }
  });

  it("Hot Dog covers Fire Bone Hot Dog, which is no display variant", () => {
    // The official Series 2 name. ADR-0030 deliberately leaves it alone,
    // because "Fire Bone" is not a variant token — but the character is the
    // same one.
    expect(idsOf("Hot Dog")).toContain("SKY-0274");
    expect(item.get("SKY-0274")!.name).toBe("Fire Bone Hot Dog");
  });

  it("covers the misspelled and oddly spelled entries in the source", () => {
    expect(idsOf("Whirlwind")).toContain("SKY-0280"); // "Horn Blast Whirwind"
    expect(idsOf("Grim Creeper")).toContain("SKY-0252"); // "Legendary Grim Creemper"
    expect(idsOf("Star Strike")).toContain("SKY-0266"); // "Start Strike (LC, Enchanted)"
    expect(idsOf("Turbo Charge Donkey Kong")).toContain("SKY-0494"); // "Dark Turbo Charge D.K."
    expect(idsOf("Dino-Rang")).toContain("SKY-0023"); // "Elite Dino Rang", no hyphen
  });

  it("keeps Eon's Elite and LightCore with their character", () => {
    expect(idsOf("Spyro")).toContain("SKY-0057"); // Elite Spyro
    expect(idsOf("Drobot")).toContain("SKY-0157"); // Drobot Light Core
    expect(idsOf("Chill")).toContain("SKY-0130"); // Legendary Chill Light Core
  });
});

describe("derived first release, checked for all 19", () => {
  const EXPECTED: Record<string, string> = {
    Drobot: "SA",
    Spyro: "SA",
    "Gill Grunt": "SA",
    "Stealth Elf": "SA",
    "Trigger Happy": "SA",
    Eruptor: "SA",
    Whirlwind: "SA",
    Bash: "SA",
    "Dino-Rang": "SA",
    "Hot Dog": "G",
    "Pop Fizz": "G",
    Chill: "G",
    Ninjini: "G",
    "Mini Jini": "G",
    "Roller Brawl": "SF",
    "Star Strike": "SF",
    "Grim Creeper": "SF",
    "Turbo Charge Donkey Kong": "SC",
    Kaos: "I",
  };

  it("covers every pilot character", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(characters.map((c) => c.canonical_name).sort());
  });

  for (const [name, code] of Object.entries(EXPECTED)) {
    it(`${name} -> ${code}`, () => {
      expect(firstReleaseSeries(figuresOf(name))?.code).toBe(code);
    });
  }

  it("Kaos is the counterexample against calling this a debut", () => {
    // The derivation is right about the figure and wrong about the character:
    // Kaos has been the villain since Spyro's Adventure in 2011, but his
    // first collectible figure is the Imaginators Sensei. That is why the
    // value is labelled "Erste Figur" and why no debut column exists
    // (ADR-0034).
    expect(firstReleaseSeries(figuresOf("Kaos"))?.code).toBe("I");
    expect(firstReleaseSeries(figuresOf("Kaos"))?.code).not.toBe("SA");
  });
});
