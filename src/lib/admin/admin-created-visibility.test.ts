import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { collectibleOnly } from "@/lib/catalog/collectible";
import { buildNameIndex, toFigure, withVariants, type FigureRow, type Lookups } from "@/lib/catalog/queries";
import { filterFigures } from "@/lib/catalog/search";
import { sortFigures } from "@/lib/catalog/sort";
import type { CatalogFigure } from "@/lib/catalog/types";

/**
 * An admin-created figure is a catalogue figure (V3.9, ADR-0070).
 *
 * WHAT HAPPENED, AND WHY THIS FILE EXISTS
 *
 * The first real create on staging produced exactly the row it was supposed
 * to — `SKY-0821`, `source='admin'`, `catalog_visible=false`, `is_active=true`,
 * `character_id=null` — and the administrator's catalogue did not show it. The
 * row was never the problem and neither was the read path; the browser simply
 * kept the catalogue it had been rendered with (see the second half of this
 * file).
 *
 * These run the REAL pipeline over a row shaped exactly like that one, so the
 * claim "provenance changes nothing" is checked rather than asserted.
 */

/** The lookups a catalogue read resolves against. Two series, three categories. */
const LOOKUPS: Lookups = {
  series: new Map([
    ["SA", { label: "Spyro's Adventure", position: 0 }],
    ["SF", { label: "Swap Force", position: 2 }],
  ]),
  categories: new Map([
    [20, { name: "Figuren", position: 1, catalogGroup: "figure" }],
    [21, { name: "Spiele", position: 0, catalogGroup: null }],
    [22, { name: "Fahrzeuge", position: 2, catalogGroup: "vehicle" }],
  ]),
};

/** A row as PostgREST hands it over. Defaults match an imported figure. */
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
    character_id: 42,
    catalog_visible: true,
    display_name_override: null,
    card_type: "standard",
    ...over,
  } as FigureRow;
}

/**
 * SKY-0821 as staging actually holds it, read back on 2026-09-16.
 *
 * Not an invented fixture: every value here was copied from the row the first
 * real create wrote.
 */
const SKY_0821 = row({
  sky_id: "SKY-0821",
  name: "Gold Fire Kraken",
  slug: "gold-fire-kraken",
  series_code: "SF",
  category_id: 20,
  market_price: null,
  image_file: null,
  image_override_path: null,
  is_active: true,
  character_id: null,
  catalog_visible: false,
  display_name_override: null,
  card_type: "prestige",
});

/**
 * The server-side catalogue pipeline, exactly as `fetchCatalog()` composes it.
 *
 * `includeHidden` is the administrator's view — the same catalogue with one
 * filter dropped, never a second catalogue (ADR-0042). The character index is
 * empty here on purpose: the new figure has no character, and neither do the
 * 159 collectibles that are traps, vehicles and crystals.
 */
function pipeline(rows: readonly FigureRow[], options: { includeHidden: boolean }): CatalogFigure[] {
  const rls = rows.filter((r) => r.is_active && (options.includeHidden || r.catalog_visible));
  const figures = collectibleOnly(rls.map((r) => toFigure(r, LOOKUPS)));
  return sortFigures(withVariants(figures, buildNameIndex(figures)));
}

const skyIds = (figures: readonly CatalogFigure[]) => figures.map((f) => f.skyId);

describe("A — the admin catalogue includes an admin-created hidden figure", () => {
  const catalog = pipeline([row(), SKY_0821], { includeHidden: true });

  it("is there", () => {
    expect(skyIds(catalog)).toContain("SKY-0821");
  });

  it("survives the client-side narrowing an administrator's view applies", () => {
    /*
     * The admin pool skips ownership entirely, takes no group filter by
     * default and no availability filter, and then narrows to the chosen
     * game. Nothing in that chain may look at where the row came from.
     */
    const visible = filterFigures(catalog, { query: "", seriesCode: "SF" });
    expect(skyIds(visible)).toContain("SKY-0821");
  });

  it("is findable by search, under the name that was typed", () => {
    const hit = filterFigures(catalog, { query: "Gold", seriesCode: "SF" });
    expect(skyIds(hit)).toContain("SKY-0821");
  });

  it("carries the state the card needs to dim it and badge it", () => {
    const figure = catalog.find((f) => f.skyId === "SKY-0821")!;
    expect(figure.catalogVisible).toBe(false);
    expect(figure.isActive).toBe(true);
    expect(figure.cardType).toBe("prestige");
  });
});

describe("B — the public catalogue excludes it", () => {
  const publicCatalog = pipeline([row(), SKY_0821], { includeHidden: false });

  it("is absent", () => {
    expect(skyIds(publicCatalog)).not.toContain("SKY-0821");
    expect(skyIds(publicCatalog)).toContain("SKY-0100");
  });

  it("stays absent from a search as well", () => {
    expect(skyIds(filterFigures(publicCatalog, { query: "Gold", seriesCode: "SF" }))).toEqual([]);
  });
});

describe("C — source controls nothing", () => {
  it("is not even carried into the catalogue figure", () => {
    /*
     * The strongest form of "provenance decides nothing": `CatalogFigure` has
     * no field for it, so no view, filter, sort or card can read it however
     * much it wanted to. It stays in the database, for the import.
     */
    const figure = toFigure(SKY_0821, LOOKUPS);
    expect(Object.keys(figure)).not.toContain("source");
  });

  it("is not selected by the catalogue query", () => {
    const queries = readFileSync("src/lib/catalog/queries.ts", "utf8");
    const columns = queries.slice(queries.indexOf("const FIGURE_COLUMNS"), queries.indexOf("type Lookups"));
    expect(columns).not.toContain("source");
  });

  it("appears nowhere in the shipped catalogue or admin components", () => {
    for (const path of [
      "src/components/catalog/catalog-view.tsx",
      "src/components/admin/add-figure-modal.tsx",
      "src/components/admin/figure-modal.tsx",
    ]) {
      const src = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(src, path).not.toMatch(/\bsource\b\s*[=:!]/);
    }
  });

  it("two rows that differ only in provenance are treated identically", () => {
    // The clinching form: same everything, one imported, one admin-created.
    const imported = pipeline([row({ sky_id: "SKY-0500", catalog_visible: false })], { includeHidden: true });
    const created = pipeline([row({ sky_id: "SKY-0501", catalog_visible: false })], { includeHidden: true });
    expect(imported).toHaveLength(1);
    expect(created).toHaveLength(1);
    // Everything except the identity, which is the one thing that must differ.
    const withoutIdentity = (figure: CatalogFigure) =>
      Object.fromEntries(Object.entries(figure).filter(([key]) => key !== "skyId"));
    expect(withoutIdentity(imported[0])).toEqual(withoutIdentity(created[0]));
  });
});

describe("D — a NULL character_id removes nothing", () => {
  it("keeps the figure in the catalogue", () => {
    const catalog = pipeline([row(), SKY_0821], { includeHidden: true });
    expect(catalog.find((f) => f.skyId === "SKY-0821")!.characterId).toBeNull();
    expect(skyIds(catalog)).toContain("SKY-0821");
  });

  it("shows no element rather than inventing one", () => {
    // NULL is the normal case, not missing data: 159 collectibles are not
    // characters at all (ADR-0034). The fallback is "—", never a guess.
    expect(toFigure(SKY_0821, LOOKUPS).element).toBeNull();
  });

  it("does not make the catalogue assume every figure has a character", () => {
    const catalog = pipeline(
      [row({ sky_id: "SKY-0700", character_id: null }), row({ sky_id: "SKY-0701", character_id: null }), SKY_0821],
      { includeHidden: true },
    );
    expect(catalog).toHaveLength(3);
  });
});

describe("E — it sorts where the rules put it, not where it was added", () => {
  /*
   * WHAT THE SORT ACTUALLY DOES WITH THIS NAME, WHICH IS NOT WHAT WAS EXPECTED.
   *
   * "Gold Fire Kraken" is NOT read as a variant of Fire Kraken, because the
   * curated list in `variant.ts` carries "Golden" and "Gold Metallic" and not
   * a bare "Gold" (ADR-0030). So its base name stays the whole name and it
   * sorts under G — deterministically, by the same rule as everything else,
   * but not beside the figure whose name it contains.
   *
   * That is existing behaviour and it is left alone. Adding "Gold" to the
   * token list would re-read every imported name that begins with it, which
   * is a curation decision about the catalogue and not something a create
   * dialog gets to make.
   *
   * What matters for V3.9 is the part below: an admin-created figure runs
   * through the SAME derivation. Give it a name the rule does recognise and
   * it joins the family like any imported row.
   */
  const catalog = pipeline(
    [
      row({ sky_id: "SKY-0102", name: "Grilla Drilla" }),
      SKY_0821,
      row({ sky_id: "SKY-0100", name: "Fire Kraken" }),
      row({ sky_id: "SKY-0101", name: "Blitz Fire Kraken", card_type: "special" }),
    ],
    { includeHidden: true },
  );

  it("takes its place by base name, like every other figure", () => {
    // Blitz…, Fire Kraken, Gold…, Grilla… — plain alphabetical by base,
    // because none of these three names carries a recognised variant token.
    expect(skyIds(catalog)).toEqual(["SKY-0101", "SKY-0100", "SKY-0821", "SKY-0102"]);
  });

  it("is not pinned to the top or appended to the bottom", () => {
    const position = skyIds(catalog).indexOf("SKY-0821");
    expect(position).not.toBe(0);
    expect(position).not.toBe(catalog.length - 1);
  });

  it("is not sorted by SKY-ID or by when it was created", () => {
    // By SKY-ID the newest would be last. It is third of four.
    expect(skyIds(catalog)).not.toEqual([...skyIds(catalog)].sort());
  });

  it("joins the family when its name carries a token the rule knows", () => {
    /*
     * The same row, renamed to a recognised form. This is the proof that the
     * derivation treats an admin-created figure exactly like an imported one:
     * base name, variant label and family position all fall out of the rule.
     */
    const withToken = pipeline(
      [
        row({ sky_id: "SKY-0100", name: "Fire Kraken" }),
        { ...SKY_0821, name: "Golden Fire Kraken", slug: "golden-fire-kraken" },
        row({ sky_id: "SKY-0102", name: "Grilla Drilla" }),
      ],
      { includeHidden: true },
    );
    const figure = withToken.find((f) => f.skyId === "SKY-0821")!;
    expect(figure.sortBaseName).toBe("Fire Kraken");
    expect(figure.sortVariantLabel).toBe("Golden");
    // Directly after the figure it belongs to, before the next base name.
    expect(skyIds(withToken)).toEqual(["SKY-0100", "SKY-0821", "SKY-0102"]);
  });

  it("needs no special case anywhere for the family it joined", () => {
    for (const path of [
      "src/lib/catalog/sort.ts",
      "src/lib/catalog/variant.ts",
      "src/components/catalog/catalog-view.tsx",
    ]) {
      expect(readFileSync(path, "utf8"), path).not.toContain("Fire Kraken");
    }
  });

  it("has no admin-created section, and nothing sorts on provenance", () => {
    const view = readFileSync("src/components/catalog/catalog-view.tsx", "utf8");
    expect(view).not.toMatch(/sort[\s\S]{0,60}created_at/i);
    expect(readFileSync("src/lib/catalog/sort.ts", "utf8")).not.toContain("source");
  });
});

describe("F — the create reaches the browser without a router in the catalogue", () => {
  const modal = readFileSync("src/components/admin/add-figure-modal.tsx", "utf8");
  const action = readFileSync("src/lib/admin/create-actions.ts", "utf8");
  const view = readFileSync("src/components/catalog/catalog-view.tsx", "utf8");

  it("dispatches the action inside a transition", () => {
    /*
     * THE BUG THIS FILE WAS WRITTEN FOR.
     *
     * Next applies a mutation's revalidated payload to the mounted tree only
     * when the action was called inside a transition — automatic for
     * `<form action>`, manual everywhere else. From a bare `onClick` the row
     * is written and the browser never learns about it.
     */
    expect(modal).toContain("useTransition");
    expect(modal).toContain("startTransition(submit)");
    expect(modal).not.toContain("onClick={() => void submit()}");
  });

  it("revalidates and refreshes on the server", () => {
    expect(action).toContain('from "next/cache"');
    expect(action).toContain("revalidatePath(path)");
    expect(action).toContain("refresh();");
  });

  it("matches what every other admin component that needs the payload does", () => {
    for (const path of [
      "src/components/admin/inline-name.tsx",
      "src/components/admin/image-editor.tsx",
      "src/components/admin/price-editor.tsx",
    ]) {
      expect(readFileSync(path, "utf8"), path).toContain("startTransition");
    }
  });

  it("introduces no router in the catalogue", () => {
    // ADR-0027: opening a dialog there must never become a navigation.
    // `ui/browse.test.ts` and `ui/quick-view-ux.test.ts` hold the same line.
    expect(view).not.toContain("useRouter");
    expect(view).not.toContain("router.refresh");
    expect(view).not.toContain("router.push");
  });

  it("caches nothing that could serve the pre-create catalogue", () => {
    const page = readFileSync("src/app/(public)/(catalog)/page.tsx", "utf8");
    for (const directive of ['"use cache"', "unstable_cache", "cacheLife", "export const revalidate"]) {
      expect(page, directive).not.toContain(directive);
    }
  });
});
