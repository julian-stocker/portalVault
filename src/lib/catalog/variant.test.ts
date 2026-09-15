import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  VARIANT_TOKENS,
  eliteDisplayNameFor,
  eliteSearchFormsFor,
  parseEliteEdition,
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
      source: "prefix",
    });
  });

  it("recognises Dark when a base figure exists", () => {
    expect(parseVariant("Dark Spyro", SA)).toEqual({
      baseName: "Spyro",
      variantLabel: "Dark",
      source: "prefix",
    });
  });

  it("keeps a multi-word base intact", () => {
    expect(parseVariant("Legendary Chop Chop", SA)).toEqual({
      baseName: "Chop Chop",
      variantLabel: "Legendary",
      source: "prefix",
    });
  });

  it("prefers the longer token, so 'Power Blue' beats 'Blue'", () => {
    const names = new Set(["Bash"]);
    expect(parseVariant("Power Blue Bash", names)).toEqual({
      baseName: "Bash",
      variantLabel: "Power Blue",
      source: "prefix",
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

  it("leaves 'Enchanted Elven Forest' alone — there is no figure called 'Elven Forest' to be a variant OF", () => {
    /*
     * "Enchanted" BECAME a token in V3.6, when the seasonal and event forms
     * were released as variants. The location keeps its name anyway, and the
     * reason is the one that has always mattered: the base has to exist. The
     * set below deliberately does not contain it.
     */
    expect(VARIANT_TOKENS).toContain("Enchanted");
    expect(parseVariant("Enchanted Elven Forest", new Set(["King Pen"]))).toBeNull();
    expect(display("Enchanted Elven Forest", new Set(["King Pen"]))).toBe("Enchanted Elven Forest");
    // And with a base present it is a variant, which is the point of the token.
    expect(display("Enchanted Hoot Loop", new Set(["Hoot Loop"]))).toBe("Enchanted Hoot Loop");
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

  it("never reads '(2)' as a form — it is the operator's second copy", () => {
    /*
     * The one that would be actively wrong the other way round. "(2)" marks a
     * duplicate article (docs/SKYLANDERS_DATA.md 11b); "2 Elite Bash" is not a
     * figure. Held as an explicit exclusion rather than as an accident of the
     * token list, because that list is meant to grow.
     */
    const names = new Set(["Elite Bash", "Elite Boomer"]);
    expect(parseVariant("Elite Bash (2)", names)).toBeNull();
    expect(display("Elite Bash (2)", names)).toBe("Elite Bash (2)");
    /*
     * Two layers, and both are asserted. The token list is what stops it
     * today; the explicit exclusion is what keeps stopping it if somebody ever
     * adds "2" to that list — which is the only way this could regress, since
     * the list is meant to grow.
     */
    expect(VARIANT_TOKENS).not.toContain("2");
    const source = readFileSync("src/lib/catalog/variant.ts", "utf8");
    expect(source).toContain('const NOT_VARIANT_LABELS: readonly string[] = ["2", "EN"];');
    expect(source).toContain("!NOT_VARIANT_LABELS.includes(label)");
  });

  it("never reads '(EN)' as a form — it is the language of a game", () => {
    const names = new Set(["Spiel für Xbox One"]);
    expect(parseVariant("Spiel für Xbox One (EN)", names)).toBeNull();
    expect(display("Spiel für Xbox One (EN)", names)).toBe("Spiel für Xbox One (EN)");
    expect(VARIANT_TOKENS).not.toContain("EN");
    // Same two layers as above.
    expect(readFileSync("src/lib/catalog/variant.ts", "utf8")).toContain('"2", "EN"');
  });

  it("leaves the dash and the multi-label spellings alone", () => {
    /*
     * LightCore is written three ways in the catalogue — "Chill Light Core",
     * "Bumble Blast - Lightcore", "Start Strike (LC, Enchanted)" — and none of
     * them is a token here. It is a `card_type`, decided per figure in the
     * database, not a name rule; deriving it from three spellings would be a
     * second classifier disagreeing with the first.
     */
    const names = new Set(["Bumble Blast", "Elite Boomer", "Start Strike"]);
    expect(display("Bumble Blast - Lightcore", names)).toBe("Bumble Blast - Lightcore");
    expect(display("Elite Boomer - ohne OVP", names)).toBe("Elite Boomer - ohne OVP");
    expect(display("Start Strike (LC, Enchanted)", names)).toBe("Start Strike (LC, Enchanted)");
  });
});

describe("displayNameFor", () => {
  it("puts the label in front, whichever way the database spells it (V3.6)", () => {
    // Already a prefix: unchanged.
    expect(display("Legendary Astroblast", SA)).toBe("Legendary Astroblast");
    expect(display("Dark Spyro", SA)).toBe("Dark Spyro");
    // Stored in brackets: turned round.
    expect(display("Crusher (Granite)", new Set(["Crusher"]))).toBe("Granite Crusher");
    expect(display("Freeze Blade (Nitro)", new Set(["Freeze Blade"]))).toBe("Nitro Freeze Blade");
    expect(display("Flashwing (Jade)", new Set(["Flashwing"]))).toBe("Jade Flashwing");
    expect(display("Free Ranger (Legendary)", new Set(["Free Ranger"]))).toBe(
      "Legendary Free Ranger",
    );
    expect(display("Fright Rider (Halloween)", new Set(["Fright Rider"]))).toBe(
      "Halloween Fright Rider",
    );
  });

  it("gives both spellings of one idea the same three values", () => {
    /*
     * The whole point of V3.6: a visitor must not be able to tell from the
     * name which way round the spreadsheet happened to write it. Only `source`
     * differs, and nothing user-facing reads it.
     */
    const prefix = parseVariant("Blue Bash", new Set(["Bash"]));
    const suffix = parseVariant("Bash (Blue)", new Set(["Bash"]));
    expect(prefix?.baseName).toBe("Bash");
    expect(suffix?.baseName).toBe("Bash");
    expect(prefix?.variantLabel).toBe("Blue");
    expect(suffix?.variantLabel).toBe("Blue");
    expect(displayNameFor("Blue Bash", prefix)).toBe("Blue Bash");
    expect(displayNameFor("Bash (Blue)", suffix)).toBe("Blue Bash");
    expect(prefix?.source).toBe("prefix");
    expect(suffix?.source).toBe("suffix");
  });

  it("returns the raw name when nothing was recognised", () => {
    expect(display("Bash", SA)).toBe("Bash");
  });

  it("handles a base whose own name contains a form", () => {
    // The figure the priority rule exists for: a LightCore AND a Legendary.
    // The name keeps both; `card_type` keeps only the stronger one.
    const g = new Set(["Chill Light Core"]);
    expect(display("Legendary Chill Light Core", g)).toBe("Legendary Chill Light Core");
  });
});

describe("searchFormsFor", () => {
  it("covers every spelling a visitor might type", () => {
    const forms = searchFormsFor("Legendary Bash", parseVariant("Legendary Bash", SA));
    expect(forms).toEqual([
      "Legendary Bash",
      "Legendary Bash",
      "Bash Legendary",
      "Bash (Legendary)",
      "Bash",
    ]);
  });

  it("keeps the raw bracket spelling findable after the name is turned round", () => {
    /*
     * "Crusher (Granite)" is what the operator sees in the spreadsheet and in
     * the admin. It has to keep working as a query even though nobody is shown
     * that spelling any more.
     */
    const forms = searchFormsFor("Crusher (Granite)", parseVariant("Crusher (Granite)", new Set(["Crusher"])));
    expect(forms).toEqual([
      "Crusher (Granite)",
      "Granite Crusher",
      "Crusher Granite",
      "Crusher (Granite)",
      "Crusher",
    ]);
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
    // And the bracket spelling sorts to exactly the same place.
    expect(sortPartsFor("Crusher (Granite)", parseVariant("Crusher (Granite)", new Set(["Crusher"])))).toEqual({
      sortBaseName: "Crusher",
      sortVariantLabel: "Granite",
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

/**
 * What the card shows, end to end (V3.6).
 *
 * The regression this pins is a real one: the catalogue rendered
 * `sortBaseName` as the visible name, so "Crusher (Granite)" appeared as
 * "Crusher". Two values on `CatalogFigure`, two jobs, and swapping them turns
 * a Granite Crusher into an ordinary Crusher on screen.
 */
describe("display name and sort truth are different values with different jobs", () => {
  const G = new Set(["Crusher"]);
  const SA2 = new Set(["Bash"]);

  it.each([
    ["Crusher (Granite)", G, "Granite Crusher", "Crusher", "Granite"],
    ["Bash (Blue)", SA2, "Blue Bash", "Bash", "Blue"],
    ["Bash (Legendary)", SA2, "Legendary Bash", "Bash", "Legendary"],
    ["Blue Bash", SA2, "Blue Bash", "Bash", "Blue"],
    ["Legendary Bash", SA2, "Legendary Bash", "Bash", "Legendary"],
  ])("%s → shown %s, sorted under %s", (raw, names, shown, base, label) => {
    const variant = parseVariant(raw, names as Set<string>);
    expect(displayNameFor(raw, variant), "visible name").toBe(shown);
    expect(sortPartsFor(raw, variant).sortBaseName, "sort truth").toBe(base);
    expect(sortPartsFor(raw, variant).sortVariantLabel, "sort label").toBe(label);
    // The one that caused the bug: the two are not interchangeable.
    expect(displayNameFor(raw, variant)).not.toBe(sortPartsFor(raw, variant).sortBaseName);
  });

  it("is rendered by the card as the display name, never as the base", () => {
    const card = readFileSync("src/components/catalog/figure-card.tsx", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(card).toContain("{figure.displayName}");
    expect(card).not.toContain("{figure.sortBaseName}");
    /* `sortBaseName` may still be read — it is what the sort needs — but not
       as something the card prints. */
    expect(card).not.toMatch(/>\s*\{figure\.sortBaseName\}/);
  });

  it("is used by every public surface that prints a figure's name", () => {
    /*
     * Swept once rather than trusted: any component or page that renders a
     * figure name must reach for `displayName`. `sortBaseName` appearing in a
     * rendering file at all is the smell this catches.
     */
    const surfaces = [
      "src/components/catalog/figure-card.tsx",
      "src/components/catalog/catalog-card.tsx",
      "src/components/catalog/quick-view.tsx",
      "src/components/collection/collection-table.tsx",
      "src/components/collection/collection-view.tsx",
      "src/app/(public)/skylanders/[slug]/page.tsx",
    ];
    for (const file of surfaces) {
      const src = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(src, `${file} renders sortBaseName`).not.toContain("sortBaseName");
    }
  });
});

/**
 * Eon's Elite is three rows of one figure (V3.6).
 *
 * The packaging, not the figure, is what differs — and none of the three
 * names says so. `parseEliteEdition` encodes the operator's reading, licensed
 * in every case by the loose row actually existing.
 */
describe("parseEliteEdition", () => {
  /** One complete Elite family, plus the neighbours that must stay out of it. */
  const SERIES = new Set([
    /* The characters the line is a version OF — what the family sorts under. */
    "Boomer",
    "Voodood",
    "Elite Boomer",
    "Elite Boomer (2)",
    "Elite Boomer - ohne OVP",
    // SKY-0075's raw name is missing the space before the dash.
    "Elite Voodood",
    "Elite Voodood (2)",
    "Elite Voodood- ohne OVP",
    // An Elite figure with no loose row: not an OVP case at all.
    "Elite Nobody",
    "Elite Nobody (2)",
    // And an ordinary figure that happens to have a second copy.
    "Bash",
    "Bash (2)",
  ]);
  const show = (name: string) => {
    const edition = parseEliteEdition(name, SERIES);
    return edition === null ? name : eliteDisplayNameFor(edition);
  };

  it.each([
    ["Elite Boomer - ohne OVP", "Eon's Elite Boomer", null],
    ["Elite Boomer", "Eon's Elite Boomer (OVP Series 1)", "OVP Series 1"],
    ["Elite Boomer (2)", "Eon's Elite Boomer (OVP Series 2)", "OVP Series 2"],
  ])("%s → %s", (raw, shown, label) => {
    const edition = parseEliteEdition(raw, SERIES);
    expect(edition).toEqual({
      baseName: "Elite Boomer",
      characterName: "Boomer",
      editionLabel: label,
    });
    expect(eliteDisplayNameFor(edition!)).toBe(shown);
  });

  it("names the line once, never twice", () => {
    // Built from the CHARACTER: "Elite Boomer" already carries the word, and
    // "Eon's Elite Elite Boomer" is not a figure.
    expect(show("Elite Boomer - ohne OVP")).not.toContain("Elite Elite");
    expect(show("Elite Boomer")).toBe("Eon's Elite Boomer (OVP Series 1)");
  });

  it("sorts the family under the character, not under E for Eon's", () => {
    /*
     * The display name begins with "Eon's"; the sort truth must not. All three
     * packaging rows belong with SKY-0010 "Boomer", in one block under B.
     */
    for (const raw of ["Elite Boomer", "Elite Boomer (2)", "Elite Boomer - ohne OVP"]) {
      expect(parseEliteEdition(raw, SERIES)?.characterName, raw).toBe("Boomer");
    }
  });

  it("finds the character even where the Elite rows misspell it", () => {
    /*
     * SKY-0021 is "Dino-Rang"; the three Elite rows spell it "Dino Rang". The
     * name is raw source data and is not corrected, and the German collator
     * does NOT place the two together — "Dino Roar" sorts between them — so a
     * strict lookup would leave that one family stranded under its own
     * misspelling. The lookup folds punctuation and returns the CATALOGUE's
     * spelling; measured against the real data, that produces no collisions in
     * any of the six series.
     */
    const sa = new Set(["Dino-Rang", "Elite Dino Rang", "Elite Dino Rang - ohne OVP"]);
    const edition = parseEliteEdition("Elite Dino Rang - ohne OVP", sa);
    expect(edition?.characterName).toBe("Dino-Rang");
    expect(eliteDisplayNameFor(edition!)).toBe("Eon's Elite Dino-Rang");
  });

  it("falls back to the stripped name when the character is not in the catalogue", () => {
    const only = new Set(["Elite Nobody", "Elite Nobody - ohne OVP"]);
    expect(parseEliteEdition("Elite Nobody - ohne OVP", only)?.characterName).toBe("Nobody");
  });

  it("reads the loose row whose dash lost its space", () => {
    // SKY-0075 "Elite Voodood- ohne OVP". The name is raw source data and is
    // not corrected, so the lookup accommodates it.
    expect(show("Elite Voodood- ohne OVP")).toBe("Eon's Elite Voodood");
    expect(show("Elite Voodood")).toBe("Eon's Elite Voodood (OVP Series 1)");
    expect(show("Elite Voodood (2)")).toBe("Eon's Elite Voodood (OVP Series 2)");
  });

  it("declines without the loose row that licenses the reading", () => {
    /*
     * The safety rule, and the whole reason this is not a name pattern:
     * "Elite Nobody" has no `- ohne OVP` sibling, so it is a figure called
     * Elite Nobody and nothing is inferred about a box.
     */
    expect(parseEliteEdition("Elite Nobody", SERIES)).toBeNull();
    expect(parseEliteEdition("Elite Nobody (2)", SERIES)).toBeNull();
    expect(show("Elite Nobody")).toBe("Elite Nobody");
    expect(show("Elite Nobody (2)")).toBe("Elite Nobody (2)");
  });

  it("does not leak the (2) exception to any other figure", () => {
    /*
     * The global rule stands: "(2)" is the operator's second copy, never a
     * variant label. Elite is an explicit exception, and it is the loose row
     * — not the word "Elite" and not the "(2)" — that grants it.
     */
    expect(parseEliteEdition("Bash (2)", SERIES)).toBeNull();
    expect(parseVariant("Bash (2)", SERIES)).toBeNull();
    expect(show("Bash (2)")).toBe("Bash (2)");
    expect(VARIANT_TOKENS).not.toContain("2");
  });

  it("touches nothing that is not Elite", () => {
    for (const name of ["Bash", "Legendary Bash", "Crusher (Granite)", "Golden Queen"]) {
      expect(parseEliteEdition(name, SERIES), name).toBeNull();
    }
  });

  it("is gated on the word Elite, not only on the loose row existing", () => {
    /*
     * The two conditions are independent, and this is the one the other tests
     * cannot see: give a NON-Elite figure a "- ohne OVP" row and the reading
     * must still decline. Eon's Elite is a product line with a known
     * three-row shape; "ohne OVP" appearing anywhere else in the source is a
     * note on an article, not a licence to invent two boxes.
     */
    const odd = new Set(["Bash", "Bash (2)", "Bash - ohne OVP", "Spyro - ohne OVP"]);
    expect(parseEliteEdition("Bash", odd)).toBeNull();
    expect(parseEliteEdition("Bash (2)", odd)).toBeNull();
    expect(parseEliteEdition("Bash - ohne OVP", odd)).toBeNull();
    expect(parseEliteEdition("Spyro - ohne OVP", odd)).toBeNull();
    // And "Elite" on its own is not a figure to have editions of.
    expect(parseEliteEdition("Elite - ohne OVP", new Set(["Elite - ohne OVP"]))).toBeNull();
  });

  it("keeps all three rows of one figure sorting together", () => {
    for (const raw of ["Elite Boomer", "Elite Boomer (2)", "Elite Boomer - ohne OVP"]) {
      expect(parseEliteEdition(raw, SERIES)?.baseName, raw).toBe("Elite Boomer");
      expect(parseEliteEdition(raw, SERIES)?.characterName, raw).toBe("Boomer");
    }
  });

  it("stays findable by the spelling the operator sees", () => {
    const forms = eliteSearchFormsFor(
      "Elite Boomer - ohne OVP",
      parseEliteEdition("Elite Boomer - ohne OVP", SERIES)!,
    );
    // Every spelling a visitor or the operator might type.
    expect(forms).toContain("Elite Boomer - ohne OVP"); // the spreadsheet's
    expect(forms).toContain("Eon's Elite Boomer");      // what is shown
    expect(forms).toContain("Elite Boomer");            // the short form
    expect(forms).toContain("Boomer");                  // the character alone
  });

  it("is asked before the finish system, and separately from it", () => {
    /*
     * "Elite Boomer (2)" must not reach `parseVariant` — it would be a figure
     * called "Elite Boomer" with a label of "2" if the exclusion list ever
     * slipped. Order is the belt; the exclusion list is the braces.
     */
    const queries = readFileSync("src/lib/catalog/queries.ts", "utf8");
    const eliteAt = queries.indexOf("const elite = parseEliteEdition(figure.name, namesInSeries);");
    const variantAt = queries.indexOf("const variant = parseVariant(figure.name, namesInSeries);");
    expect(eliteAt, "the derivation no longer calls parseEliteEdition").toBeGreaterThan(-1);
    expect(variantAt, "the derivation no longer calls parseVariant").toBeGreaterThan(-1);
    expect(eliteAt).toBeLessThan(variantAt);
    // And its result is actually used, not computed and dropped.
    expect(queries).toContain("displayName: eliteDisplayNameFor(elite)");
    expect(queries).toContain("sortBaseName: elite.characterName");
    expect(queries).toContain("sortVariantLabel: elite.editionLabel");
    // And the two produce different shapes, so neither can stand in for the other.
    const variant = readFileSync("src/lib/catalog/variant.ts", "utf8");
    expect(variant).toContain("editionLabel");
    expect(variant).toContain("variantLabel");
  });
});
