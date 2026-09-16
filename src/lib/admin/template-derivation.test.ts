import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  EMPTY_DRAFT,
  fromTemplate,
  inheritsCharacter,
  isCreatable,
  type CategoryOption,
} from "./new-figure-draft.ts";
import { collectibleOnly } from "@/lib/catalog/collectible";
import {
  buildNameIndex,
  toFigure,
  withCharacterElement,
  withCharacterFamily,
  withCharacterSearch,
  withVariants,
  type FigureRow,
  type Lookups,
} from "@/lib/catalog/queries";
import { sortFigures } from "@/lib/catalog/sort";
import { VARIANT_TOKENS } from "@/lib/catalog/variant";
import type { CatalogFigure } from "@/lib/catalog/types";

/**
 * "Bestehende Figur als Vorlage" is a statement about identity (ADR-0070a).
 *
 * Picking Fire Kraken says the new row is another Fire Kraken — a different
 * COLLECTIBLE, the same CHARACTER. `character_id` is the column the catalogue
 * already uses for that (ADR-0034), so it travels; and it travels server-side,
 * read from the template row rather than asserted by the browser.
 */
const LOOKUPS: Lookups = {
  series: new Map([
    ["SF", { label: "Swap Force", position: 2 }],
    ["G", { label: "Giants", position: 1 }],
  ]),
  categories: new Map([
    [20, { name: "Figuren", position: 1, catalogGroup: "figure" }],
    [30, { name: "Fahrzeuge", position: 2, catalogGroup: "vehicle" }],
  ]),
};

const KRAKEN_CHARACTER = 77;
const CHARACTER_NAMES = new Map([[KRAKEN_CHARACTER, "Fire Kraken"]]);
const CHARACTER_ELEMENTS = new Map<number, "Fire" | null>([[KRAKEN_CHARACTER, "Fire"]]);

function row(over: Partial<FigureRow> = {}): FigureRow {
  return {
    sky_id: "SKY-0100",
    name: "Fire Kraken",
    slug: "fire-kraken",
    series_code: "SF",
    category_id: 20,
    market_price: 9.99,
    image_file: "0123456789abcdef.webp",
    image_override_path: null,
    is_active: true,
    character_id: KRAKEN_CHARACTER,
    catalog_visible: true,
    display_name_override: null,
    card_type: "standard",
    ...over,
  } as FigureRow;
}

const CATEGORIES: CategoryOption[] = [
  { id: 20, seriesCode: "SF", name: "Figuren", catalogGroup: "figure" },
  { id: 30, seriesCode: "G", name: "Fahrzeuge", catalogGroup: "vehicle" },
];

const figureOf = (r: FigureRow): CatalogFigure => toFigure(r, LOOKUPS);

/** The read pipeline, with the character passes `fetchCatalog()` runs. */
function pipeline(rows: readonly FigureRow[]): CatalogFigure[] {
  const figures = collectibleOnly(rows.map(figureOf));
  const named = withVariants(figures, buildNameIndex(figures));
  const searched = withCharacterSearch(named, CHARACTER_NAMES);
  const family = withCharacterFamily(searched, CHARACTER_NAMES);
  return sortFigures(withCharacterElement(family, CHARACTER_ELEMENTS));
}

const MODAL = readFileSync("src/components/admin/add-figure-modal.tsx", "utf8");
const ACTION = readFileSync("src/lib/admin/create-actions.ts", "utf8");
const MIGRATION_SOURCE = readFileSync("supabase/migrations/0034_create_figure_from_template.sql", "utf8");
/** The migration without its comments — it explains at length why it does
    NOT take a character id, and an explanation must not satisfy a test. */
const MIGRATION = MIGRATION_SOURCE.replace(/^\s*--.*$/gm, "");
const VIEW = readFileSync("src/components/catalog/catalog-view.tsx", "utf8");

describe("A — an empty start asserts no relationship", () => {
  it("carries no template", () => {
    expect(EMPTY_DRAFT.templateSkyId).toBeNull();
  });

  it("so the create sends none and the row keeps character_id NULL", () => {
    // The function only ever reads a character when a template is named.
    expect(MIGRATION).toContain("if v_template is not null then");
    expect(MIGRATION).toContain("v_character bigint := null");
  });
});

describe("B — a template with a character hands it over", () => {
  const template = figureOf(row());

  it("says so, by SKY-ID rather than by character id", () => {
    const draft = fromTemplate(template);
    expect(draft.templateSkyId).toBe("SKY-0100");
    expect(Object.keys(draft)).not.toContain("characterId");
  });

  it("is read from the template row on the server, never accepted as input", () => {
    /*
     * The security shape of this whole feature. `p_character_id` would let any
     * authenticated caller assert a curated identity for any figure; the
     * function is executable by every session and `is_shop_admin()` decides
     * who may act, not what they may claim.
     */
    expect(MIGRATION).not.toContain("p_character_id");
    expect(MIGRATION).toContain("select s.character_id");
    expect(MIGRATION).toContain("from public.skylanders s");
    expect(ACTION).not.toContain("characterId");
    expect(ACTION).toContain("p_template_sky_id: input.templateSkyId");
  });

  it("refuses a template that does not exist rather than dropping the link", () => {
    expect(MIGRATION).toContain("unknown template figure %");
    expect(MIGRATION).toContain("errcode = 'no_data_found'");
  });

  it("tells the operator what will be inherited", () => {
    expect(inheritsCharacter(template)).toBe(true);
    expect(MODAL).toContain("de.admin.templateInherits");
  });
});

describe("C — a template without a character inherits nothing, and says so", () => {
  const vehicle = figureOf(
    row({ sky_id: "SKY-0300", name: "Burn Cycle", character_id: null, series_code: "G", category_id: 30 }),
  );

  it("reports honestly instead of implying a relationship", () => {
    expect(inheritsCharacter(vehicle)).toBe(false);
    expect(MODAL).toContain("de.admin.templateNoCharacter");
  });

  it("still allows the create", () => {
    const draft = { ...fromTemplate(vehicle), name: "Gold Burn Cycle" };
    expect(isCreatable(draft, CATEGORIES)).toBe(true);
  });

  it("maps no character from the name, here or anywhere", () => {
    for (const source of [MODAL, ACTION, MIGRATION]) {
      expect(source).not.toMatch(/canonical_name\s*(=|like|ilike)/i);
    }
    expect(MODAL).not.toContain("characterId");
  });
});

describe("D — what a template still refuses to carry", () => {
  const rich = figureOf(
    row({
      sky_id: "SKY-0150",
      name: "Fire Kraken",
      card_type: "legendary",
      catalog_visible: true,
      display_name_override: "Feuerkrake",
      market_price: 49.99,
      image_override_path: "SKY-0150/0123456789abcdef.webp",
    }),
  );
  const draft = fromTemplate(rich);

  it("takes the series, the category, the name and the template id — nothing else", () => {
    expect(Object.keys(draft).sort()).toEqual(Object.keys(EMPTY_DRAFT).sort());
    expect(draft.seriesCode).toBe("SF");
    expect(draft.categoryId).toBe(20);
    expect(draft.templateSkyId).toBe("SKY-0150");
  });

  it("resets the card type rather than copying it", () => {
    expect(rich.cardType).toBe("legendary");
    expect(draft.cardType).toBe("standard");
  });

  it("does not publish the new figure because the template is published", () => {
    expect(rich.catalogVisible).toBe(true);
    expect(draft.catalogVisible).toBe(false);
  });

  it("takes no name override and no note", () => {
    expect(draft.displayNameOverride).toBe("");
    expect(draft.adminNote).toBe("");
  });

  it("has nowhere to put a picture, a price, stock, offers or history", () => {
    for (const forbidden of ["imageOverridePath", "imageFile", "marketPrice", "inventory", "offers", "changes"]) {
      expect(Object.keys(draft), forbidden).not.toContain(forbidden);
    }
    // And the create writes none of them either.
    for (const column of ["market_price", "image_file", "image_override_path"]) {
      expect(MIGRATION.slice(MIGRATION.indexOf("insert into public.skylanders")), column).not.toContain(column);
    }
  });
});

describe("E — Gold Fire Kraken, derived from Fire Kraken", () => {
  /* The row the create would write: the operator's name, the inherited
     character, hidden, standard card, no picture, no price. */
  const derived = row({
    sky_id: "SKY-0821",
    name: "Gold Fire Kraken",
    slug: "gold-fire-kraken",
    character_id: KRAKEN_CHARACTER,
    catalog_visible: false,
    card_type: "prestige",
    market_price: null,
    image_file: null,
  });
  const catalog = pipeline([row(), derived, row({ sky_id: "SKY-0102", name: "Grilla Drilla", character_id: null })]);
  const figure = catalog.find((f) => f.skyId === "SKY-0821")!;

  it("keeps the name the operator chose", () => {
    // The inherited identity decides family, element and search — not what
    // the card reads.
    expect(figure.displayName).toBe("Gold Fire Kraken");
    expect(figure.name).toBe("Gold Fire Kraken");
  });

  it("gets its element from the inherited character", () => {
    expect(figure.characterId).toBe(KRAKEN_CHARACTER);
    expect(figure.element).toBe("Fire");
  });

  it("is found by the base character's name", () => {
    expect(figure.searchIndex).toContain("fire kraken");
  });

  it("is in the admin catalogue and out of the public one", () => {
    expect(figure.catalogVisible).toBe(false);
    expect(figure.isActive).toBe(true);
  });

  it("sorts inside the Fire Kraken family, because the character says so", () => {
    /*
     * The open question ADR-0070a left is answered in ADR-0070b: where a
     * curated character exists it decides the family, and the name rule keeps
     * everything else. No "Gold" token was added and no name was parsed to
     * get here — the link did it.
     */
    expect(figure.sortBaseName).toBe("Fire Kraken");
    // And the badge is untouched: the family pass writes one field.
    expect(figure.sortVariantLabel).toBeNull();
  });
});

describe("F — none of this depends on the token list", () => {
  it("leaves VARIANT_TOKENS alone", () => {
    expect(VARIANT_TOKENS).not.toContain("Gold");
    // The two that are curated stay exactly as they were.
    expect(VARIANT_TOKENS).toContain("Golden");
    expect(VARIANT_TOKENS).toContain("Gold Metallic");
  });

  it("inherits the character without any name parsing at all", () => {
    const derived = row({ sky_id: "SKY-0821", name: "Völlig anderer Name", character_id: KRAKEN_CHARACTER });
    const [figure] = pipeline([derived]);
    // No token, no shared substring, and the identity still arrives.
    expect(figure.element).toBe("Fire");
    expect(figure.searchIndex).toContain("fire kraken");
  });
});

describe("G — provenance still sorts nothing", () => {
  it("is absent from the sort and from the catalogue view", () => {
    expect(readFileSync("src/lib/catalog/sort.ts", "utf8")).not.toContain("source");
    expect(VIEW.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/\bsource\b\s*[=:!]/);
  });

  it("sorts by neither SKY-ID nor creation time", () => {
    expect(readFileSync("src/lib/catalog/sort.ts", "utf8")).not.toContain("created_at");
    expect(readFileSync("src/lib/catalog/sort.ts", "utf8")).not.toContain("skyId");
  });
});

describe("H — imported figures are untouched", () => {
  it("0034 writes no existing row", () => {
    expect(MIGRATION).not.toMatch(/^\s*update public\./m);
    expect(MIGRATION).not.toMatch(/^\s*delete from/m);
    // Only the function is replaced, plus the drop of the 0033 signature.
    expect(MIGRATION_SOURCE).toContain("drop function if exists public.admin_create_figure(text, text, bigint, text, boolean, text, text);");
  });

  it("changes no derivation, so no existing figure moves", () => {
    const before = pipeline([row(), row({ sky_id: "SKY-0102", name: "Grilla Drilla", character_id: null })]);
    expect(before.map((f) => f.skyId)).toEqual(["SKY-0100", "SKY-0102"]);
    expect(before[0].sortBaseName).toBe("Fire Kraken");
    expect(before[0].sortVariantLabel).toBeNull();
  });

  it("leaves 0033 alone", () => {
    const zero33 = readFileSync("supabase/migrations/0033_admin_created_figures.sql", "utf8");
    expect(zero33).toContain("start with 821");
    expect(zero33).not.toContain("p_template_sky_id");
  });
});

describe("I — the visibility fix is still in place", () => {
  it("dispatches the create inside a transition", () => {
    expect(MODAL).toContain("useTransition");
    expect(MODAL).toContain("startTransition(submit)");
    expect(MODAL).not.toContain("onClick={() => void submit()}");
  });

  it("refreshes on the server and keeps the catalogue router-free", () => {
    expect(ACTION).toContain("refresh();");
    expect(VIEW).not.toContain("useRouter");
  });
});
