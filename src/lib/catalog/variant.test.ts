import { describe, expect, it } from "vitest";

import {
  VARIANT_TOKENS,
  displayNameFor,
  parseVariant,
  searchFormsFor,
  sortPartsFor,
} from "./variant.ts";

/** Collectible names of Spyro's Adventure, as far as these tests need them. */
const SA = new Set(["Bash", "Spyro", "Astroblast", "Chop Chop", "Voodood", "Hot Dog"]);
/** Trap Team: traps are named <element> <shape>, so no bare "Sword" exists. */
const T = new Set(["Air Sword", "Dark Sword", "Earth Hammer", "Head Rush", "Snap Shot"]);
/** Imaginators. */
const I = new Set(["Elven Forest", "King Pen", "Wolfgang", "Pit Boss"]);

function display(name: string, names: Set<string>): string {
  return displayNameFor(name, parseVariant(name, names));
}

describe("parseVariant — recognised variants", () => {
  it("turns a Legendary prefix into a base and a label", () => {
    expect(parseVariant("Legendary Astroblast", SA)).toEqual({
      baseName: "Astroblast",
      variantLabel: "Legendary",
    });
  });

  it("recognises Dark when a base figure exists", () => {
    expect(parseVariant("Dark Spyro", SA)).toEqual({ baseName: "Spyro", variantLabel: "Dark" });
  });

  it("keeps a multi-word base intact", () => {
    expect(parseVariant("Legendary Chop Chop", SA)).toEqual({
      baseName: "Chop Chop",
      variantLabel: "Legendary",
    });
  });

  it("prefers the longer token, so 'Power Blue' beats 'Blue'", () => {
    const names = new Set(["Bash"]);
    expect(parseVariant("Power Blue Bash", names)).toEqual({
      baseName: "Bash",
      variantLabel: "Power Blue",
    });
  });
});

describe("parseVariant — deliberately not recognised", () => {
  it("leaves a trap alone: 'Dark' is its element, and no bare 'Sword' exists", () => {
    expect(parseVariant("Dark Sword", T)).toBeNull();
    expect(display("Dark Sword", T)).toBe("Dark Sword");
  });

  it("leaves 'Golden Queen' alone — there is no figure called 'Queen'", () => {
    expect(parseVariant("Golden Queen", I)).toBeNull();
    expect(display("Golden Queen", I)).toBe("Golden Queen");
  });

  it("leaves 'Enchanted Elven Forest' alone — Enchanted is not a token", () => {
    expect(parseVariant("Enchanted Elven Forest", I)).toBeNull();
    expect(display("Enchanted Elven Forest", I)).toBe("Enchanted Elven Forest");
  });

  it("leaves 'Elite Bash' alone — Eon's Elite is a product line, not a finish", () => {
    expect(VARIANT_TOKENS).not.toContain("Elite");
    expect(parseVariant("Elite Bash", SA)).toBeNull();
    expect(display("Elite Bash", SA)).toBe("Elite Bash");
  });

  it("leaves an ordinary character name alone", () => {
    expect(parseVariant("Fire Bone Hot Dog", SA)).toBeNull();
    expect(display("Fire Bone Hot Dog", SA)).toBe("Fire Bone Hot Dog");
  });

  it("does not recognise a variant when the base figure does not exist", () => {
    // The real case: "Legendary Grim Creemper" — the base is spelled
    // "Grim Creeper" in the source, so the rule correctly declines.
    const sf = new Set(["Grim Creeper"]);
    expect(parseVariant("Legendary Grim Creemper", sf)).toBeNull();
  });

  it("only looks inside the same series", () => {
    // "Spyro" exists in SA, so a Trap Team entry must not borrow it.
    expect(parseVariant("Dark Spyro", T)).toBeNull();
    expect(parseVariant("Dark Spyro", SA)).not.toBeNull();
  });

  it("does not treat the token alone as a variant", () => {
    expect(parseVariant("Dark", SA)).toBeNull();
  });

  it("leaves existing bracket and suffix spellings untouched", () => {
    const names = new Set(["Hex", "Elite Bash", "Bumble Blast"]);
    expect(display("Hex (Pearl)", names)).toBe("Hex (Pearl)");
    expect(display("Elite Bash (2)", names)).toBe("Elite Bash (2)");
    expect(display("Bumble Blast - Lightcore", names)).toBe("Bumble Blast - Lightcore");
    expect(display("Elite Boomer - ohne OVP", names)).toBe("Elite Boomer - ohne OVP");
  });
});

describe("displayNameFor", () => {
  it("moves the token into brackets", () => {
    expect(display("Legendary Astroblast", SA)).toBe("Astroblast (Legendary)");
    expect(display("Dark Spyro", SA)).toBe("Spyro (Dark)");
  });

  it("returns the raw name when nothing was recognised", () => {
    expect(display("Bash", SA)).toBe("Bash");
  });

  it("handles a base whose own name contains a suffix", () => {
    const g = new Set(["Chill Light Core"]);
    expect(display("Legendary Chill Light Core", g)).toBe("Chill Light Core (Legendary)");
  });
});

describe("searchFormsFor", () => {
  it("covers all three spellings for a variant", () => {
    const forms = searchFormsFor("Legendary Bash", parseVariant("Legendary Bash", SA));
    expect(forms).toEqual(["Legendary Bash", "Bash (Legendary)", "Bash Legendary"]);
  });

  it("returns just the name when there is no variant", () => {
    expect(searchFormsFor("Bash", parseVariant("Bash", SA))).toEqual(["Bash"]);
  });
});

describe("sortPartsFor", () => {
  it("sorts a variant under its base name", () => {
    expect(sortPartsFor("Legendary Bash", parseVariant("Legendary Bash", SA))).toEqual({
      sortBaseName: "Bash",
      sortVariantLabel: "Legendary",
    });
  });

  it("leaves a plain figure sorting under itself", () => {
    expect(sortPartsFor("Bash", parseVariant("Bash", SA))).toEqual({
      sortBaseName: "Bash",
      sortVariantLabel: null,
    });
  });
});

describe("identity is never touched", () => {
  it("derives only display data — SKY-ID and slug are not inputs at all", () => {
    // The functions take a name and a name set. There is no parameter through
    // which an identity could be changed (ADR-0011, ADR-0030).
    expect(parseVariant.length).toBe(2);
    expect(displayNameFor.length).toBe(2);
  });
});
