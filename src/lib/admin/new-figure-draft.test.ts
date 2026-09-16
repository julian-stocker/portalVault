import { describe, expect, it } from "vitest";

import {
  EMPTY_DRAFT,
  categoriesFor,
  fromTemplate,
  groupOf,
  isCardTypeValue,
  isCreatable,
  nameConfirmed,
  problemsWith,
  similarFigures,
  slugPreview,
  withSeries,
  type CategoryOption,
  type NewFigureDraft,
} from "./new-figure-draft.ts";
import type { CatalogFigure } from "@/lib/catalog/types";

const CATEGORIES: CategoryOption[] = [
  { id: 1, seriesCode: "SA", name: "Figuren", catalogGroup: "figure" },
  { id: 2, seriesCode: "SA", name: "Spiele", catalogGroup: null },
  { id: 3, seriesCode: "G", name: "Giants", catalogGroup: "giant" },
];

function figure(over: Partial<CatalogFigure> = {}): CatalogFigure {
  return {
    skyId: "SKY-0001",
    name: "Bash",
    slug: "bash",
    seriesCode: "SA",
    seriesLabel: "Spyro's Adventure",
    seriesPosition: 0,
    categoryPosition: 0,
    categoryName: "Figuren",
    categoryId: 1,
    catalogGroup: "figure",
    cardType: "standard",
    displayName: "Bash",
    sortBaseName: "Bash",
    sortVariantLabel: null,
    searchIndex: "bash",
    marketPrice: 12,
    imageFile: "0123456789abcdef.webp",
    imageOverridePath: "SKY-0001/0123456789abcdef.webp",
    isActive: true,
    catalogVisible: true,
    canonicalName: "Bash",
    displayNameOverride: "Bash the Rock",
    element: "Earth",
    characterId: 7,
    ...over,
  };
}

const draftOf = (over: Partial<NewFigureDraft> = {}): NewFigureDraft => ({
  ...EMPTY_DRAFT,
  ...over,
});

describe("a new figure starts hidden and plain", () => {
  it("is not published until somebody says so", () => {
    // A figure created a second ago has no picture and no curated character.
    // Publishing it on creation shows that to every visitor (ADR-0070).
    expect(EMPTY_DRAFT.catalogVisible).toBe(false);
  });

  it("starts on the standard card, with no overrides and no note", () => {
    expect(EMPTY_DRAFT.cardType).toBe("standard");
    expect(EMPTY_DRAFT.displayNameOverride).toBe("");
    expect(EMPTY_DRAFT.adminNote).toBe("");
    expect(EMPTY_DRAFT.categoryId).toBeNull();
  });

  it("carries no identity of its own", () => {
    /*
     * The SKY-ID and the slug belong to the database. A field for either would
     * be a way to choose an identity from a browser.
     *
     * `templateSkyId` (V3.9a, ADR-0070a) is the one reference here and is not
     * an exception: it names a figure that ALREADY EXISTS, so the server can
     * read the curated character from it. It is never the new row's identity,
     * it is not stored on it, and there is still no `characterId` field —
     * which is what keeps a curated link from becoming client input.
     */
    expect(Object.keys(EMPTY_DRAFT).sort()).toEqual([
      "adminNote",
      "cardType",
      "catalogVisible",
      "categoryId",
      "displayNameOverride",
      "name",
      "seriesCode",
      "templateSkyId",
    ]);
    expect(Object.keys(EMPTY_DRAFT)).not.toContain("characterId");
    expect(EMPTY_DRAFT.templateSkyId).toBeNull();
  });
});

describe("what still stands in the way", () => {
  it("names all three missing fields at once, not the first one", () => {
    expect(problemsWith(EMPTY_DRAFT, CATEGORIES).sort()).toEqual(["category", "name", "series"]);
  });

  it("treats whitespace as no name", () => {
    const draft = draftOf({ name: "   ", seriesCode: "SA", categoryId: 1 });
    expect(problemsWith(draft, CATEGORIES)).toEqual(["name"]);
  });

  it("refuses a category that belongs to another series", () => {
    /*
     * `skylanders_category_fk` is composite over (category_id, series_code):
     * a Giants category on a Spyro's Adventure figure is refused by the
     * database. Catching it here means the operator never makes the mistake.
     */
    const draft = draftOf({ name: "Neu", seriesCode: "SA", categoryId: 3 });
    expect(problemsWith(draft, CATEGORIES)).toEqual(["category"]);
    expect(isCreatable(draft, CATEGORIES)).toBe(false);
  });

  it("is creatable once the three are answered", () => {
    const draft = draftOf({ name: "Neu", seriesCode: "SA", categoryId: 1 });
    expect(problemsWith(draft, CATEGORIES)).toEqual([]);
    expect(isCreatable(draft, CATEGORIES)).toBe(true);
  });

  it("does not require a picture, an override or a note", () => {
    const draft = draftOf({ name: "Neu", seriesCode: "SA", categoryId: 1 });
    expect(isCreatable(draft, CATEGORIES)).toBe(true);
  });
});

describe("the category follows the series", () => {
  it("offers only the categories of the chosen series", () => {
    expect(categoriesFor(CATEGORIES, "SA").map((c) => c.id)).toEqual([1, 2]);
    expect(categoriesFor(CATEGORIES, "G").map((c) => c.id)).toEqual([3]);
  });

  it("offers nothing before a series is chosen", () => {
    expect(categoriesFor(CATEGORIES, "")).toEqual([]);
  });

  it("clears the category when the series changes", () => {
    // Keeping it would leave a valid-looking selection that the composite
    // foreign key refuses.
    const draft = draftOf({ seriesCode: "SA", categoryId: 1 });
    expect(withSeries(draft, "G").categoryId).toBeNull();
  });

  it("leaves the draft alone when the series does not actually change", () => {
    const draft = draftOf({ seriesCode: "SA", categoryId: 1 });
    expect(withSeries(draft, "SA")).toBe(draft);
  });

  it("does not offer software categories any less than the others", () => {
    // `fetchAdminCategories()` drops them because software has no product
    // group (ADR-0029). A create dialog that did the same would refuse to
    // let an administrator file a game, which nobody decided.
    expect(categoriesFor(CATEGORIES, "SA").some((c) => c.name === "Spiele")).toBe(true);
  });
});

describe("the group is read, never chosen", () => {
  it("comes from the category", () => {
    expect(groupOf(CATEGORIES, 1)).toBe("figure");
    expect(groupOf(CATEGORIES, 3)).toBe("giant");
  });

  it("is null for a category that has none, and before one is picked", () => {
    expect(groupOf(CATEGORIES, 2)).toBeNull();
    expect(groupOf(CATEGORIES, null)).toBeNull();
  });
});

describe("the template carries two foreign keys and nothing else", () => {
  const source = figure({
    skyId: "SKY-0148",
    name: "Bash",
    seriesCode: "G",
    categoryId: 3,
    cardType: "legendary",
    catalogVisible: true,
    displayNameOverride: "Bash the Rock",
    characterId: 7,
    marketPrice: 29.99,
    imageFile: "abcdefabcdefabcd.webp",
    imageOverridePath: "SKY-0148/abcdefabcdefabcd.webp",
  });

  const derived = fromTemplate(source);

  it("takes the series and the category", () => {
    expect(derived.seriesCode).toBe("G");
    expect(derived.categoryId).toBe(3);
  });

  it("offers the name as a starting value", () => {
    expect(derived.name).toBe("Bash");
  });

  it("does not take the card type — that is usually what differs", () => {
    expect(derived.cardType).toBe("standard");
    expect(derived.cardType).not.toBe(source.cardType);
  });

  it("does not publish the new figure because the source was published", () => {
    expect(source.catalogVisible).toBe(true);
    expect(derived.catalogVisible).toBe(false);
  });

  it("takes no override and no note", () => {
    expect(derived.displayNameOverride).toBe("");
    expect(derived.adminNote).toBe("");
  });

  it("has nowhere to put an identity, a picture, a price or a character", () => {
    /*
     * The strongest form of "does not copy": the draft has no field for any
     * of them. `character_id` in particular stays with the curated file
     * (ADR-0034) — a link that existed only in the database would make
     * characters.json an incomplete record.
     */
    for (const forbidden of ["skyId", "slug", "characterId", "marketPrice", "imageFile", "imageOverridePath"]) {
      expect(Object.keys(derived), forbidden).not.toContain(forbidden);
    }
  });
});

describe("a templated name has to be confirmed", () => {
  it("blocks while the name is still the template's", () => {
    const draft = draftOf({ name: "Bash", seriesCode: "G", categoryId: 3 });
    expect(nameConfirmed(draft, "Bash")).toBe(false);
  });

  it("ignores surrounding whitespace, which is not a change", () => {
    const draft = draftOf({ name: "  Bash  " });
    expect(nameConfirmed(draft, "Bash")).toBe(false);
  });

  it("passes once the operator has typed something of their own", () => {
    const draft = draftOf({ name: "Bash (Legendary)" });
    expect(nameConfirmed(draft, "Bash")).toBe(true);
  });

  it("asks nothing of an empty start", () => {
    expect(nameConfirmed(draftOf({ name: "Neu" }), null)).toBe(true);
  });
});

describe("the slug preview is a preview", () => {
  it("shows stage one of the rule", () => {
    expect(slugPreview(draftOf({ name: "Spyro (Series 2)" }))).toBe("spyro-series-2");
    expect(slugPreview(draftOf({ name: "Käpt'n Blaubär" }))).toBe("kaeptn-blaubaer");
  });

  it("is empty before there is a name", () => {
    expect(slugPreview(EMPTY_DRAFT)).toBe("");
  });
});

describe("similar entries are a warning, never a refusal", () => {
  const catalog = [
    figure({ skyId: "SKY-0001", name: "Dino-Rang", seriesCode: "SA" }),
    figure({ skyId: "SKY-0049", name: "Dino Rang", seriesCode: "SA", cardType: "elite" }),
    figure({ skyId: "SKY-0300", name: "Dino-Rang", seriesCode: "G" }),
    figure({ skyId: "SKY-0400", name: "Bash", seriesCode: "SA" }),
  ];

  it("finds the same name across a punctuation difference", () => {
    // The Excel's own sheets disagree about the hyphen; both are the same
    // neighbourhood and the operator should see it.
    const found = similarFigures(draftOf({ name: "Dino Rang", seriesCode: "SA" }), catalog);
    expect(found.map((f) => f.skyId).sort()).toEqual(["SKY-0001", "SKY-0049"]);
  });

  it("does not warn about the same name in another game", () => {
    const found = similarFigures(draftOf({ name: "Dino-Rang", seriesCode: "SA" }), catalog);
    expect(found.map((f) => f.skyId)).not.toContain("SKY-0300");
  });

  it("says nothing before there is a name or a series", () => {
    expect(similarFigures(draftOf({ seriesCode: "SA" }), catalog)).toEqual([]);
    expect(similarFigures(draftOf({ name: "Bash" }), catalog)).toEqual([]);
  });

  it("never blocks the create", () => {
    /*
     * `name` is deliberately not unique: fourteen rows end in "- ohne OVP",
     * six games are called "Game (Xbox 360)", and Kaos is a trap, a trophy
     * and a Sensei. A hard rule would refuse legitimate variants.
     */
    const draft = draftOf({ name: "Dino-Rang", seriesCode: "SA", categoryId: 1 });
    expect(similarFigures(draft, catalog).length).toBeGreaterThan(0);
    expect(isCreatable(draft, CATEGORIES)).toBe(true);
  });

  it("carries what somebody needs to tell the matches apart", () => {
    const [first] = similarFigures(draftOf({ name: "Dino Rang", seriesCode: "SA" }), catalog);
    expect(Object.keys(first).sort()).toEqual(["cardType", "displayName", "seriesLabel", "skyId"]);
  });
});

describe("the card type comes from the one vocabulary", () => {
  it("accepts every value the database accepts", () => {
    for (const type of ["standard", "special", "elite", "dark", "legendary", "chase", "prestige"]) {
      expect(isCardTypeValue(type), type).toBe(true);
    }
  });

  it("refuses anything else", () => {
    expect(isCardTypeValue("gold")).toBe(false);
    expect(isCardTypeValue("")).toBe(false);
  });
});
