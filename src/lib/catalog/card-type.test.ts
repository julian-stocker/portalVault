import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";

import {
  CARD_TYPES,
  EDITION_RANK,
  FAMILY_ORDER,
  familyRank,
  CARD_TYPE_LABELS,
  DEFAULT_CARD_TYPE,
  asCardType,
  isCardType,
  type CardType,
} from "@/lib/catalog/card-type";
import {
  ARTWORK_TONE,
  CARD_ARTWORK,
  CARD_ASPECT,
  CARD_CANVAS,
  INSET,
  ROWS,
  OWNERSHIP_OVERLAY,
  artworkFor,
} from "@/lib/catalog/card-template";

/**
 * Card types, artworks and the line between them and ownership (V3.5).
 *
 * The defect this whole feature exists to prevent is the two axes collapsing
 * back into one. `card_type` is what a collectible IS; being in somebody's
 * collection is a per-viewer state that overrides the artwork and writes
 * nothing. Most of what follows guards that boundary from both sides.
 *
 * The second thing guarded here is the coupling that must NOT appear: this
 * system reads a column and the variant system reads a name, and neither may
 * start reading the other.
 */
/**
 * A source file with its prose removed.
 *
 * Several assertions below are of the form "this string must not appear", and
 * every one of these files explains at length what it used to do — naming the
 * very classes and words being searched for. Matching raw text lets an
 * explanation fail the test it is explaining.
 */
function source(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const MIGRATION = "supabase/migrations/0030_card_types.sql";
const MIGRATION_31 = "supabase/migrations/0031_special_card_type.sql";
const bare = (path: string) =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
/** 0030, prose removed. It introduced the column and the first five values. */
const code = bare(MIGRATION);
/** 0031, prose removed. It owns the CURRENT vocabulary and `special`. */
const code31 = bare(MIGRATION_31);
const MIGRATION_32 = "supabase/migrations/0032_elite_card_type.sql";
/** 0032, prose removed. It owns the CURRENT vocabulary and `elite`. */
const code32 = bare(MIGRATION_32);

/** A migration file's hash — history, once it has been applied anywhere. */
const sha256 = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

/** Every sky_id in one `set card_type = '<type>'` statement. */
function backfill(type: CardType): string[] {
  const at = code.indexOf(`set card_type = '${type}'`);
  if (at < 0) return [];
  const block = code.slice(at, code.indexOf(");", at));
  return [...block.matchAll(/'(SKY-[0-9]{4})'/g)].map((m) => m[1]);
}

describe("there are seven card types, and collection is not one of them", () => {
  it("names exactly the seven", () => {
    expect([...CARD_TYPES]).toEqual([
      "standard",
      "special",
      "elite",
      "dark",
      "legendary",
      "chase",
      "prestige",
    ]);
  });

  it("has no collection type, and never will have one here", () => {
    /*
     * Ownership is not a property of the collectible. A sixth value would put
     * a per-viewer state into an editorial column, and collecting a figure
     * would start writing to it.
     */
    expect(CARD_TYPES as readonly string[]).not.toContain("collection");
    expect(CARD_TYPES as readonly string[]).not.toContain("owned");
    expect(code).not.toContain("'collection'");
  });

  it("falls back to standard rather than to nothing", () => {
    expect(DEFAULT_CARD_TYPE).toBe("standard");
    expect(asCardType("prestige")).toBe("prestige");
    expect(asCardType("gold")).toBe("standard");
    expect(asCardType(null)).toBe("standard");
    expect(asCardType(undefined)).toBe("standard");
    expect(isCardType("chase")).toBe(true);
    expect(isCardType("collection")).toBe(false);
  });

  it("labels all seven and invents no German for the domain's own words", () => {
    for (const type of CARD_TYPES) expect(CARD_TYPE_LABELS[type]).toBeTruthy();
    expect(CARD_TYPE_LABELS.standard).toBe("Standard");
    expect(CARD_TYPE_LABELS.special).toBe("Special");
    expect(CARD_TYPE_LABELS.elite).toBe("Elite");
    expect(CARD_TYPE_LABELS.prestige).toBe("Prestige");
    // One vocabulary: the admin select renders this list and offers nothing else.
    const select = source("src/components/admin/card-type-select.tsx");
    expect(select).toContain("CARD_TYPES.map");
    expect(select).toContain("CARD_TYPE_LABELS[option]");
    expect(select).not.toContain("<input");
    expect(select).not.toMatch(/"(standard|special|dark|legendary|chase|prestige)"/);
  });

  it("ranks the editions, and leaves chase out of that chain", () => {
    /*
     * The operator's rule: legendary > dark > special > standard. A real
     * figure carries more than one mark and the column holds one value.
     *
     * `chase` is deliberately given the plain figure's rank. It is not a
     * stronger edition of anything — it is the same edition in a different
     * finish — and ranking it against the others would invent a comparison
     * the domain does not make.
     */
    expect(EDITION_RANK.legendary).toBeGreaterThan(EDITION_RANK.dark);
    expect(EDITION_RANK.dark).toBeGreaterThan(EDITION_RANK.special);
    expect(EDITION_RANK.special).toBeGreaterThan(EDITION_RANK.standard);
    expect(EDITION_RANK.chase).toBe(EDITION_RANK.standard);
    /*
     * `elite` is outside it for a different reason: Eon's Elite is a product
     * LINE, its members come from a curated list of 42 rows, and no figure in
     * the catalogue is both an Eon's Elite and a Dark or a Legendary. It never
     * meets the chain, so it is not ranked against it.
     */
    expect(EDITION_RANK.elite).toBe(EDITION_RANK.standard);
    // Every type is ranked; a seventh could not be added without a rank.
    for (const type of CARD_TYPES) expect(typeof EDITION_RANK[type]).toBe("number");
  });

  it("orders a family the way a collector reads it", () => {
    expect([...FAMILY_ORDER]).toEqual([
      "standard",
      "special",
      "elite",
      "chase",
      "dark",
      "legendary",
      "prestige",
    ]);
    // Every card type appears exactly once, so `familyRank` is never -1.
    expect(new Set(FAMILY_ORDER).size).toBe(CARD_TYPES.length);
    for (const type of CARD_TYPES) expect(familyRank(type)).toBeGreaterThanOrEqual(0);
  });
});

describe("the database says the same seven", () => {
  it("adds the column with the default the application assumes", () => {
    expect(code).toContain("add column if not exists card_type text not null default 'standard'");
  });

  it("constrains it to exactly the application's list", () => {
    /*
     * 0031 owns the CURRENT constraint: it drops 0030's and adds its own with
     * six values. Reading 0030 here would pin the vocabulary to the state it
     * had before `special` existed, which is exactly the drift this asserts
     * against — so the newest migration that defines the constraint is the one
     * held against `CARD_TYPES`.
     *
     * `add constraint`, not the `drop constraint if exists` above it: the
     * teardown carries no values at all.
     */
    const at = code32.indexOf("add constraint skylanders_card_type_known");
    expect(at, "0032 does not define the CHECK constraint").toBeGreaterThan(-1);
    const constraint = code32.slice(at, code32.indexOf(";", at));
    for (const type of CARD_TYPES) expect(constraint, type).toContain(`'${type}'`);
    // And nothing beyond them.
    expect(constraint.match(/'[a-z]+'/g)).toHaveLength(CARD_TYPES.length);
    // Each older constraint is superseded, not still in force.
    expect(code.includes("'special'")).toBe(false);
    expect(code31.includes("'elite'")).toBe(false);
  });

  it("uses text and a CHECK, like every other closed set in this schema", () => {
    expect(code).not.toContain("create type");
    expect(code).not.toContain("as enum");
  });

  it("classifies by identity, never by name", () => {
    /*
     * A LIKE pattern here would be a second, cruder classifier disagreeing
     * with `parseVariant()` — which is what tells "Dark Spyro" (a variant of
     * a real figure) from "Dark Pyramid" (a trap whose name starts with the
     * word).
     */
    expect(code).not.toMatch(/\blike\b/i);
    expect(code).not.toMatch(/\bilike\b/i);
    expect(code).not.toMatch(/~\s*'/);
    expect(code).not.toContain("position(");
  });

  it("writes no name, no slug and no character link", () => {
    for (const column of ["set name", "set slug", "display_name_override", "character_id", "set is_active"]) {
      expect(code, `${column} must not be written`).not.toContain(column);
    }
  });

  it("touches no collection and no commerce data", () => {
    for (const table of ["collection_items", "shop_inventory", "orders", "order_lines", "cart_items"]) {
      expect(code, table).not.toContain(table);
    }
  });

  it("can be applied twice without undoing a correction", () => {
    /*
     * Every backfill is fenced on the default, so a re-run writes nothing and
     * an administrator's later change is never reverted.
     *
     * Counted in the backfill section alone. `admin_set_card_type()` updates
     * the same table with the same words and is not a backfill — an earlier
     * version of this counted it as a fourth and started failing the moment
     * that function became a one-liner.
     */
    const backfill = code.slice(0, code.indexOf("create or replace function"));
    expect(backfill.match(/update public\.skylanders set card_type/g) ?? []).toHaveLength(3);
    expect(backfill.match(/where card_type = 'standard'/g) ?? []).toHaveLength(3);
  });
});

describe("the admin mutation follows the editorial pattern", () => {
  const rpc = code.slice(code.indexOf("create or replace function public.admin_set_card_type"));

  it("writes card_type and nothing else", () => {
    /*
     * `updated_at` belongs to the import, not to an editorial decision — the
     * three comparable mutations on this table leave it alone, and an earlier
     * draft of this one did not. That was the only such divergence in the
     * schema and it is gone.
     */
    const at = rpc.indexOf("update public.skylanders");
    const update = rpc.slice(at, rpc.indexOf(";", at));
    /*
     * The SET clause in full, not a substring of it. Counting `set ` lets a
     * second assignment in through the comma — `set card_type = v_clean,
     * name = 'x'` has exactly one `set ` and writes two columns.
     */
    const setClause = update.slice(update.indexOf("set ") + 4, update.indexOf(" where "));
    expect(setClause.trim()).toBe("card_type = v_clean");
    expect(update).not.toContain("updated_at");
    expect(update).not.toContain("now()");
  });

  it("matches the three comparable RPCs on this table", () => {
    const editorial = [
      ["supabase/migrations/0004_catalog_editorial.sql", "admin_set_catalog_visible"],
      ["supabase/migrations/0004_catalog_editorial.sql", "admin_set_display_name_override"],
      ["supabase/migrations/0007_shop_pricing_and_images.sql", "admin_set_image_override"],
    ] as const;
    for (const [file, name] of editorial) {
      const text = readFileSync(file, "utf8");
      const at = text.indexOf(`create or replace function public.${name}(`);
      const body = text.slice(at, text.indexOf("$$;", at));
      expect(body, `${name} sets updated_at`).not.toContain("updated_at");
    }
  });

  it("keeps one vocabulary in the database, not two", () => {
    /*
     * `admin_set_catalog_group()` refuses to repeat its ten values, with a
     * comment saying why. This one repeated its five so a typo came back as a
     * sentence; the constraint says it well enough.
     */
    const body = rpc.slice(0, rpc.indexOf("$$;"));
    for (const type of CARD_TYPES) {
      expect(body, `${type} must not be listed a second time`).not.toContain(`'${type}'`);
    }
    expect(body).not.toContain("not in (");
  });

  it("checks the administrator first and names a missing figure", () => {
    const body = rpc.slice(0, rpc.indexOf("$$;"));
    expect(body.indexOf("is_shop_admin()")).toBeLessThan(body.indexOf("update public.skylanders"));
    expect(body).toContain("using errcode = 'insufficient_privilege'");
    expect(body).toContain("using errcode = 'no_data_found'");
    expect(body).toContain("security definer");
    expect(body).toContain("set search_path = ''");
  });

  it("is granted exactly like its pattern", () => {
    expect(code).toContain("revoke all on function public.admin_set_card_type(text, text) from public, anon;");
    expect(code).toContain("grant  execute on function public.admin_set_card_type(text, text) to authenticated;");
  });
});

describe("the backfill is the approved list, to the identity", () => {
  const dark = backfill("dark");
  const legendary = backfill("legendary");
  const chase = backfill("chase");

  it("carries the approved counts", () => {
    expect(dark).toHaveLength(21);
    expect(legendary).toHaveLength(25);
    expect(chase).toHaveLength(30);
  });

  it("assigns no figure twice", () => {
    const all = [...dark, ...legendary, ...chase];
    expect(all).toHaveLength(76);
    expect(new Set(all).size).toBe(76);
  });

  it("adds up to the 602 rows production has", () => {
    const classified = dark.length + legendary.length + chase.length;
    expect(classified).toBe(76);
    expect(602 - classified).toBe(526); // standard
  });

  it("backfills no prestige at all", () => {
    expect(backfill("prestige")).toHaveLength(0);
    expect(code).not.toContain("set card_type = 'prestige'");
  });

  it("holds the four ids that were decided one by one", () => {
    // Approved despite the series rule not reaching them, or despite a typo.
    expect(dark).toContain("SKY-0494"); // Dark Turbo Charge D.K.
    expect(legendary).toContain("SKY-0252"); // "Legendary Grim Creemper"
    expect(chase).toContain("SKY-0163"); // Metallic Gill Grunt
    expect(chase).toContain("SKY-0280"); // "Horn Blast Whirwind (Clear Crystal)"
  });

  it("leaves the borderline cases standard", () => {
    // Seasonal, event and edition variants are real things this list has no
    // word for. The admin can move them; the backfill does not guess.
    const all = [...dark, ...legendary, ...chase];
    for (const id of [
      "SKY-0119", "SKY-0127", "SKY-0135", "SKY-0154", "SKY-0222", "SKY-0232",
      "SKY-0244", "SKY-0247", "SKY-0266", "SKY-0408", "SKY-0492", "SKY-0507",
      "SKY-0558",
    ]) {
      expect(all, `${id} must stay standard`).not.toContain(id);
    }
  });
});

/** The file name each card type is built from. */
const FILE: Readonly<Record<CardType, string>> = {
  standard: "card",
  special: "special",
  elite: "elite",
  dark: "dark",
  legendary: "legendary",
  chase: "chase",
  prestige: "prestige",
};

describe("every card type has exactly one card (V3.6)", () => {
  it("maps one artwork for all seven", () => {
    for (const type of CARD_TYPES) {
      const a = CARD_ARTWORK[type];
      expect(a.src, type).toBe(`/images/cards/${FILE[type]}.webp`);
      expect(a.small, type).toBe(`/images/cards/${FILE[type]}-sm.webp`);
    }
  });

  it("has no owned/unowned pair, in the type or in the data", () => {
    /*
     * The architecture V3.6 removed. Each type used to carry a second
     * "collected" artwork; the pairs were never pixel-congruent, so collecting
     * a figure made the card and the figure inside it appear to jump. The
     * sources are gone, the switch is gone, and the shape that held them is
     * gone — because a pair with one half permanently unused is just a second
     * state to reason about.
     */
    const template = source("src/lib/catalog/card-template.ts");
    expect(template).not.toContain("CardArtworkPair");
    expect(template).not.toContain("USE_COLLECTED_ARTWORK");
    expect(template).not.toContain(".collected");
    expect(template).not.toContain("collected:");
    expect(template).not.toContain("plain:");
    for (const type of CARD_TYPES) {
      expect(CARD_ARTWORK[type], type).toEqual({
        src: expect.any(String),
        small: expect.any(String),
      });
    }
  });

  it("gives no two types the same file", () => {
    const paths = CARD_TYPES.flatMap((t) => [CARD_ARTWORK[t].src, CARD_ARTWORK[t].small]);
    expect(paths).toHaveLength(14);
    expect(new Set(paths).size).toBe(14);
  });

  it("has no ownership artwork inside the card map", () => {
    // Ownership is not a card type. Its overlay lives beside the record, not
    // in it, so it can never be reached as `artworkFor(...)`.
    const template = source("src/lib/catalog/card-template.ts");
    expect(template).not.toContain("COLLECTION_ARTWORK");
    expect(template).not.toContain("COLLECTION_TONE");
    expect(template).not.toContain("/images/cards/collection.webp");
    expect(Object.values(CARD_ARTWORK).map((a) => a.src)).not.toContain(OWNERSHIP_OVERLAY.src);
  });

  it("ships all fourteen card files plus the two overlay files", () => {
    const files = [
      ...CARD_TYPES.flatMap((t) => [CARD_ARTWORK[t].src, CARD_ARTWORK[t].small]),
      OWNERSHIP_OVERLAY.src,
      OWNERSHIP_OVERLAY.small,
    ];
    expect(files).toHaveLength(16);
    for (const p of files) {
      const file = `public${p}`;
      expect(existsSync(file), `${file} is missing`).toBe(true);
      expect(statSync(file).size, `${file} is empty`).toBeGreaterThan(1000);
    }
  });

  it("gives special its own artwork and no special case anywhere else", () => {
    expect(CARD_ARTWORK.special.src).toBe("/images/cards/special.webp");
    expect(ARTWORK_TONE.special).toBe("light");
    // No component branches on it: the sixth type is data, not a code path.
    expect(source("src/components/catalog/figure-card.tsx")).not.toMatch(/special/i);
    expect(source("src/components/catalog/collected-seal.tsx")).not.toMatch(/special/i);
  });

  it("selects through one function that no longer asks who is looking", () => {
    const card = source("src/components/catalog/figure-card.tsx");
    expect(card).toContain("const template = artworkFor(figure.cardType);");
    expect(card).toContain("const owned = marksOwnership(ownership, collected)");
    // `owned` decides the overlay and nothing about the card underneath.
    expect(card).not.toMatch(/artworkFor\([^)]*owned/);
    expect(artworkFor.length).toBe(1);
    // The component must not reach into the map itself — one place decides.
    expect(card).not.toContain("CARD_ARTWORK[");
    // Nothing writes a card type anywhere in the component.
    expect(card).not.toMatch(/cardType\s*=\s*['"]/);
  });

  it("keeps the same geometry for all six — there is no special layout", () => {
    const template = source("src/lib/catalog/card-template.ts");
    for (const forbidden of [
      "specialRows", "specialInset", "specialWindow",
      "prestigeRows", "prestigeInset", "prestigeWindow",
    ]) {
      expect(template, forbidden).not.toContain(forbidden);
    }
    // One ROWS, one INSET, one WINDOW_FILL, one canvas — each declared once.
    for (const name of ["export const ROWS", "export const INSET", "export const WINDOW_FILL", "export const CARD_CANVAS"]) {
      expect(template.match(new RegExp(name, "g")), name).toHaveLength(1);
    }
  });
});

/**
 * The mark of something owned.
 *
 * Ownership stopped changing the artwork — the two halves of a pair are not
 * pixel-congruent and the card appeared to jump — so it is shown on top of
 * the card instead. One mark, one place, one size, five card types.
 */
describe("an owned figure is sealed, not reprinted", () => {
  const seal = source("src/components/catalog/collected-seal.tsx");
  const card = source("src/components/catalog/figure-card.tsx");

  it("appears exactly when the card counts as owned", () => {
    expect(card).toContain("{owned ? <CollectedSeal /> : null}");
    expect(card).toContain("const owned = marksOwnership(ownership, collected)");
    // One call site. A second would be a second position to keep in step.
    expect(card.match(/<CollectedSeal \/>/g)).toHaveLength(1);
  });

  it("knows nothing about card types, so it cannot vary by one", () => {
    expect(seal).not.toMatch(/cardType|standard|legendary|chase|prestige|CARD_ARTWORK/);
    // It takes no props at all — there is nothing to branch on.
    expect(seal).toContain("export function CollectedSeal() {");
  });

  it("carries its own position and size, in one place", () => {
    /*
     * One constant for the size, used for both axes, and one for the top
     * offset. What is asserted is the SHAPE — a single source per value —
     * not the numbers, which the operator is still judging.
     */
    expect(seal).toMatch(/^const SIZE = "[\d.]+cqw";$/m);
    expect(seal).toContain("width: SIZE, height: SIZE");
    expect(seal.match(/\bSIZE\b/g)?.length).toBeGreaterThanOrEqual(3);
    // Exactly one top offset, and it is the constant, not a second literal.
    expect(seal).toContain("top: TOP");
    expect(seal.match(/^const TOP = /gm)).toHaveLength(1);
    // Not at the call site, where five callers could drift apart.
    expect(card).not.toMatch(/<CollectedSeal[^/]*(top|right|width|height)/);
  });

  /** The one number the whole geometry below is derived from. */
  const size = Number(seal.match(/^const SIZE = "([\d.]+)cqw";$/m)?.[1]);

  it("is 20.5 % of the card's width, the released size", () => {
    /*
     * Each earlier value was wrong for its own reason: 12 % was oversized AND
     * mispositioned by the axis bug; 9 % was correctly placed and too small;
     * 18 % was close but still floated inside the white window. 20.5 % is the
     * size the operator settled on once the medallion was anchored to the
     * window's edge rather than to the image slot's padding.
     *
     * Pinned exactly — a released value, so a drift is a regression rather
     * than a tuning — and held above 18 so the V3.6 growth cannot silently
     * be undone.
     */
    expect(size).toBe(20.5);
    expect(size).toBeGreaterThan(18);
  });

  it("stays inside the card at that size, on every card type", () => {
    /*
     * Arithmetic rather than a claim about a screenshot. The seal is anchored
     * by its right edge and its top, so both far edges have to be checked —
     * and because size is a share of the WIDTH while `top` lands in the
     * HEIGHT, the vertical check has to go through the aspect ratio. There is
     * one position for all five card types, so proving it once proves it for
     * all five.
     */
    const inset = Number(INSET.image.replace("%", ""));
    const ratio = CARD_CANVAS.height / CARD_CANVAS.width;

    // Horizontal: right edge at `inset` from the right, left edge `size` further in.
    expect(inset + size).toBeLessThan(100);
    expect(inset).toBeGreaterThan(0);

    // Vertical, in per cent of the card's HEIGHT.
    const windowTop = ROWS.slice(
      0,
      ROWS.findIndex((row) => row.area === "image"),
    ).reduce((sum, row) => sum + row.height, 0);
    const top = windowTop - size / 2 / ratio;
    const bottom = top + size / ratio;
    expect(top).toBeGreaterThan(0); // does not hang off the top edge
    expect(bottom).toBeLessThan(100);

    // And it is genuinely centred on the window's top edge.
    expect((top + bottom) / 2).toBeCloseTo(windowTop, 6);
  });

  it("does not reach the name, which begins below the window", () => {
    // The seal may sit on the frame and on the picture. It may not sit on the
    // paper: the rows below the window belong to text.
    const ratio = CARD_CANVAS.height / CARD_CANVAS.width;
    const windowTop = ROWS.slice(
      0,
      ROWS.findIndex((row) => row.area === "image"),
    ).reduce((sum, row) => sum + row.height, 0);
    const windowBottom =
      windowTop + (ROWS.find((row) => row.area === "image")?.height ?? 0);
    expect(windowTop + size / 2 / ratio).toBeLessThan(windowBottom);
  });

  it("measures everything against one axis: the card's width", () => {
    /*
     * The round-2 bug. `12cqw` is a share of the card's width, `top: 5%` a
     * share of its height, and the card is 1.55x taller than wide — so the
     * offset silently grew by half again. Percentages are allowed now only
     * where the axis is stated: `right` resolves against width by definition,
     * and the one height percentage left is inside `calc`, next to the size
     * it is being corrected by.
     */
    expect(seal).toContain("right: RIGHT");
    expect(seal).toContain("calc(${WINDOW_FILL.right} / 2)");
    expect(seal).toContain("calc(${WINDOW_TOP}% - ${SIZE} / 2 + ${DROP})");
    // No bare percentage offset anywhere in the component.
    expect(seal).not.toMatch(/top-\[[\d.]+%\]|right-\[[\d.]+%\]/);
    expect(seal).not.toMatch(/top: "[\d.]+%"/);
  });

  it("derives its position from the geometry, it does not restate it", () => {
    /*
     * `WINDOW_TOP` is summed from `ROWS` and the right offset IS `INSET.image`
     * — so moving a row or an inset moves the seal with it. A typed-out 7.42
     * or 10.8 here would be a second copy that drifts.
     */
    expect(seal).toContain(
      'import { OWNERSHIP_OVERLAY, ROWS, WINDOW_FILL } from "@/lib/catalog/card-template"',
    );
    expect(seal).toContain('ROWS.findIndex((row) => row.area === "image")');
    /*
     * The right offset is the WINDOW's own outer edge, read from the file that
     * measures it. It used to be `INSET.image` — the image SLOT's padding,
     * 3.2 % of the card further in — which left the medallion floating inside
     * the white instead of straddling the frame.
     */
    expect(seal).not.toMatch(/7\.42|10\.8|7\.6/);
    expect(seal).not.toContain("INSET");
  });

  it("sizes against the card, not the viewport", () => {
    // The card root is an `@container`, so `cqw` is a share of this card.
    expect(seal).toContain("cqw");
    // Not the viewport, and not a breakpoint: a card in a five-column desktop
    // grid is no wider than one on a phone, so the screen says nothing here.
    expect(seal).not.toMatch(/\b\d+(\.\d+)?v(w|h|min|max)\b|sm:|md:|lg:|xl:/);
    expect(card).toContain("@container");
  });

  it("is the operator's artwork, not a drawing, and not a card", () => {
    /*
     * It was an inline SVG until V3.6 — a gold disc, a struck rim, a tick —
     * because no artwork existed. `designs/cards/collected.png` does now, and
     * a seal that belongs to the same set as the cards should come from the
     * same place as the cards. The operator can redraw it without touching
     * TypeScript.
     */
    expect(seal).toContain("OWNERSHIP_OVERLAY.src");
    expect(seal).toContain("OWNERSHIP_OVERLAY.small");
    expect(OWNERSHIP_OVERLAY.src).toBe("/images/cards/collected.webp");
    expect(OWNERSHIP_OVERLAY.small).toBe("/images/cards/collected-sm.webp");
    expect(existsSync("public/images/cards/collected.webp")).toBe(true);
    expect(existsSync("public/images/cards/collected-sm.webp")).toBe(true);

    /* Not one of the six cards — it is drawn ON one, and it is square. */
    expect(Object.values(CARD_ARTWORK).map((a) => a.src)).not.toContain(OWNERSHIP_OVERLAY.src);
  });

  it("draws nothing itself any more", () => {
    // The SVG that this replaced. Its return would mean two ownership marks
    // in the codebase, and the one nobody updated would be the one shipped.
    expect(seal).not.toContain("<svg");
    expect(seal).not.toContain("<circle");
    expect(seal).not.toContain("<path");
    expect(seal).not.toContain("SealGlyph");
    expect(seal).not.toContain("viewBox");
    expect(seal).not.toContain("var(--own-ink)");
    // And it borrows no glyph either: gold means ownership, silver trade,
    // amber commerce, and none of those is set from here.
    expect(seal).not.toMatch(/import .*(Glyph|glyph)/);
    expect(seal).not.toMatch(/trade|commerce|amber/i);
  });

  it("does not resurrect the crown component or borrow the cart tick", () => {
    /*
     * `collected-crown.tsx` was deleted in 297c67a and a test keeps it
     * deleted. The artwork the operator drew for V3.6 happens to BE a crown
     * medallion — which is their call, and exactly why this asserts about the
     * component rather than about the picture.
     */
    expect(existsSync("src/components/catalog/collected-crown.tsx")).toBe(false);
    expect(card).not.toContain("CartCheckedGlyph");
    expect(seal.match(/^import /gm)).toHaveLength(1);
  });

  it("says nothing, and blocks nothing", () => {
    /*
     * The meta row already says it in words; this is decoration over a link.
     * Both layers have to be hidden: the wrapper that sits in the card, and
     * the drawing inside it. Asserting on the file as a whole would pass with
     * only one of the two, which is why the wrapper is pulled out by name.
     */
    const wrapper = seal.slice(seal.indexOf("export function CollectedSeal"));
    expect(wrapper).toContain('aria-hidden="true"');
    expect(wrapper).toContain("pointer-events-none");
    expect(seal).toContain('aria-hidden="true"');
    expect(seal).toContain("pointer-events-none");
    expect(seal).not.toContain("sr-only");
    expect(seal).not.toContain("aria-label");
  });

  it("sits above the artwork and the picture", () => {
    /*
     * Last element of the card body, so it paints over the artwork (layer 2)
     * and over the figure in the window (layer 3). The trade row is not part
     * of that body — it is a sibling of it in the article, because it has to
     * stay clickable — and the two never overlap: this sits on the top edge
     * of the image window and the trade row begins at 84 % of the card.
     */
    const at = card.indexOf("<CollectedSeal />");
    expect(at).toBeGreaterThan(card.indexOf("srcSet="));
    expect(at).toBeGreaterThan(card.lastIndexOf('<Slot area="meta"'));
    expect(seal).toContain("z-20");
  });

  it("cannot meet the variant badge", () => {
    /*
     * Diagonally opposite: this is the top right of the window, that is the
     * bottom left of it. Neither may drift to the other's corner.
     */
    expect(seal).toContain("top: TOP, right: RIGHT");
    expect(seal).not.toMatch(/\b(bottom|left):/);
    expect(source("src/components/catalog/variant-seal.tsx")).toContain("bottom-1.5 left-1.5");
  });
});

describe("the trade row is drawn by the artwork, not by a second plate", () => {
  const card = source("src/components/catalog/figure-card.tsx");
  const slot = card.slice(card.indexOf('<Slot area="trade"'));
  const row = slot.slice(0, slot.indexOf("</Slot>"));

  it("paints no ground of its own", () => {
    expect(row).not.toContain("bg-trade-solid");
    expect(row).not.toContain("ring-trade-line");
    expect(row).not.toMatch(/bg-(own|commerce|gold|amber)/);
  });

  it("keeps the box that centres and clips the row", () => {
    expect(row).toContain("flex h-full w-full items-center justify-center overflow-hidden");
    expect(row).toContain("{trade}");
  });

  it("changes nothing about what the row does", () => {
    // The link, its label, its handlers and the quick view all live inside
    // `trade`, which this never touched.
    expect(card).toContain('<Slot area="trade"');
    expect(card).toContain("pointer-events-auto");
  });
});

describe("the ink follows the artwork, and only the artwork", () => {
  it("names one tone per card type, used for both of its cards", () => {
    for (const type of CARD_TYPES) expect(["light", "dark"]).toContain(ARTWORK_TONE[type]);
    const card = readFileSync("src/components/catalog/figure-card.tsx", "utf8");
    expect(card).toContain("const tone = ARTWORK_TONE[figure.cardType];");
  });

  it("puts light ink on the dark cards and dark ink on the bright ones", () => {
    // Measured mean brightness of the flat text areas: card 219,
    // prestige/collection 205, dark 36, legendary 28.
    expect(ARTWORK_TONE.standard).toBe("light");
    expect(ARTWORK_TONE.prestige).toBe("light");
    expect(ARTWORK_TONE.dark).toBe("dark");
    expect(ARTWORK_TONE.legendary).toBe("dark");
  });

  it("keeps the colours in globals.css, not in the component", () => {
    const template = readFileSync("src/lib/catalog/card-template.ts", "utf8");
    const at = template.indexOf("export const ARTWORK_TONE");
    expect(template.slice(at, template.indexOf("};", at))).not.toMatch(/#[0-9a-f]{3,6}/i);

    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toContain("--template-ink-on-dark:");
    expect(css).toContain("--template-ink-muted-on-dark:");

    const card = readFileSync("src/components/catalog/figure-card.tsx", "utf8");
    expect(card).toContain('"--template-ink": "var(--template-ink-on-dark)"');
    expect(card).not.toMatch(/"#[0-9a-f]{3,6}"/i);
  });

  it("carries no design role — gold, silver and amber are set elsewhere", () => {
    const template = readFileSync("src/lib/catalog/card-template.ts", "utf8");
    const at = template.indexOf("export const ARTWORK_TONE");
    const decl = template.slice(at, template.indexOf("};", at));
    expect(decl).not.toMatch(/own-ink|commerce|brand/);
  });
});

describe("the lower rows moved down, and the insets finally apply", () => {
  it("still accounts for the whole card", () => {
    expect(Math.abs(ROWS.reduce((n, r) => n + r.height, 0) - 100)).toBeLessThan(0.02);
  });

  it("leaves the market value where it was and drops what follows", () => {
    const at = (area: string) => {
      let sum = 0;
      for (const r of ROWS) { if (r.area === area) return sum; sum += r.height; }
      return -1;
    };
    // Unchanged from before the shift.
    expect(at("name")).toBeCloseTo(51.95, 2);
    expect(at("market")).toBeCloseTo(62.43, 2);
    // Two points lower than the 74.73 / 82.48 they sat at.
    expect(at("meta")).toBeCloseTo(76.73, 2);
    expect(at("trade")).toBeCloseTo(84.48, 2);
  });

  it("keeps the trade row inside the card", () => {
    let sum = 0;
    for (const r of ROWS) { sum += r.height; if (r.area === "trade") break; }
    expect(sum).toBeLessThan(95); // the bottom ornament starts around 96 %
  });

  it("takes its horizontal insets from one place", () => {
    /*
     * `INSET` was imported and ignored while the slots wrote their own
     * literals, so the V3.5 values had no effect at all. These are the values
     * that were actually rendering, now applied from here.
     */
    expect(INSET).toEqual({ image: "10.8%", text: "13%", trade: "10%" });
    const card = readFileSync("src/components/catalog/figure-card.tsx", "utf8");
    expect(card).toContain("paddingInline: INSET.image");
    expect(card).toContain("paddingInline: INSET.text");
    expect(card).toContain("paddingInline: INSET.trade");
    // The literals they replace must not come back.
    for (const dead of ["px-[10.8%]", "px-[13%]", "px-[10.1%]"]) {
      expect(card, `${dead} is hardcoded again`).not.toContain(dead);
    }
  });
});

describe("the variant seal sits at the foot of the window", () => {
  const seal = source("src/components/catalog/variant-seal.tsx");

  it("is bottom left, not top left", () => {
    expect(seal).toContain("absolute bottom-1.5 left-1.5");
    expect(seal).not.toContain("top-1.5");
  });

  it("stays inside the image slot, with one position for every card type", () => {
    const card = source("src/components/catalog/figure-card.tsx");
    const at = card.indexOf("<VariantSeal");
    const slot = card.lastIndexOf('<Slot area="image"', at);
    expect(slot).toBeGreaterThan(-1);
    expect(at - slot).toBeLessThan(400); // inside that slot, not a later one
    expect(seal).not.toMatch(/cardType|standard|legendary|chase|prestige/);
  });

  it("changed nothing but its position", () => {
    // Same size, same ink, same grounds, same words.
    expect(seal).toContain("font-mono text-[9px]");
    expect(seal).toContain('bg-[#241f19] text-[#f3e6c8]');
    expect(seal).toContain('bg-[#3a3442] text-[#ded7e8]');
    expect(seal).toContain("{label}");
    expect(seal).not.toMatch(/own-ink|commerce|gold|amber/i);
  });
});

describe("the canvas moved to the new artwork, not the other way round", () => {
  it("is 1007 × 1562", () => {
    expect(CARD_CANVAS).toEqual({ width: 1007, height: 1562 });
    expect(CARD_ASPECT).toBe("1007 / 1562");
  });

  it("builds exactly the seven cards and the one overlay, on the current canvas", () => {
    const tool = readFileSync("tools/build-card-templates.mts", "utf8");
    expect(tool).toContain("const CANVAS = { width: 1007, height: 1562 };");

    /*
     * Six entries since V3.6: one per card type, and nothing else. The
     * `.collected` halves are gone with the architecture that needed them,
     * `collection` was the single ownership artwork that preceded those, and
     * `silver`/`gold` are the pre-V3.5 pair that nothing has rendered since.
     */
    const at = tool.indexOf("const TEMPLATES = [");
    const list = tool.slice(at, tool.indexOf("] as const;", at));
    for (const type of CARD_TYPES) expect(list, type).toContain(`"${FILE[type]}"`);
    expect(list.match(/"[a-z.]+"/g)).toHaveLength(CARD_TYPES.length);
    for (const gone of ["collected", "collection", "silver", "gold"]) {
      expect(list, gone).not.toContain(gone);
    }

    /* The overlay is built, and built separately — a square source cannot go
       through a 1007×1562 assertion. */
    const oat = tool.indexOf("const OVERLAYS = [");
    expect(oat, "the ownership overlay is not built").toBeGreaterThan(-1);
    expect(tool.slice(oat, tool.indexOf("] as const;", oat))).toContain('"collected"');

    /*
     * What the build refuses. A `special.png` once arrived with its
     * transparency checkerboard flattened into the pixels: right size, no
     * alpha, and the figure would have been invisible behind it. Size alone
     * was the only check at the time.
     */
    expect(tool).toContain("meta.width !== CANVAS.width");
    expect(tool).toContain("meta.hasAlpha");
    /* The comparisons themselves, not only the words they would print: a
       message is still in the file when the condition around it is gutted. */
    expect(tool).toMatch(/if \(window < 0\.\d+\) \{/);
    expect(tool).toMatch(/if \(corner < 0\.\d+\) \{/);
    expect(tool).toMatch(/if \(clear < 0\.\d+\) \{/);
    expect(tool).toContain("the image window is only");
    expect(tool).toContain("is not cut out of its background");
    expect(tool).toContain("meta.width !== meta.height");
    /* And every rejection actually fails the run. */
    expect(tool).toContain("process.exitCode = 1");
    expect(tool).toContain("artwork(s) rejected");

    /* The window rectangle it checks is the one the card renders with. */
    const template = readFileSync("src/lib/catalog/card-template.ts", "utf8");
    const zone = template.match(/export const WINDOW_FILL = zone\((\d+), (\d+), (\d+), (\d+)\)/);
    expect(zone, "WINDOW_FILL moved or changed shape").not.toBeNull();
    const [, left, right, top, height] = zone!;
    expect(tool).toContain(
      `const WINDOW = { left: ${left}, right: ${right}, top: ${top}, bottom: ${Number(top) + Number(height)} };`,
    );
    /* And that rectangle really is the overscanned fill, not the bare hole:
       the top sits above the ornamented head every artwork opens into. */
    expect(Number(top)).toBeLessThan(99);
  });

  it("keeps one geometry for all six, not six layouts", () => {
    const template = readFileSync("src/lib/catalog/card-template.ts", "utf8");
    expect(template.match(/export const ROWS/g) ?? []).toHaveLength(1);
    expect(template.match(/export const WINDOW_FILL/g) ?? []).toHaveLength(1);
    expect(template.match(/export const INSET/g) ?? []).toHaveLength(1);
    expect(template).not.toMatch(/ROWS_(DARK|CHASE|PRESTIGE)/);
  });

  it("keeps the layout debug switch", () => {
    const template = readFileSync("src/lib/catalog/card-template.ts", "utf8");
    expect(template).toContain("export const LAYOUT_DEBUG");
    expect(readFileSync("src/components/catalog/figure-card.tsx", "utf8")).toContain("LAYOUT_DEBUG");
  });
});

/**
 * The sixth card type, and the figures that moved onto it (V3.6).
 *
 * `special` is a deliberately BROAD category: an additional official form or
 * edition of a base figure within the same series, when no stronger mark
 * applies. LightCore, Eon's Elite, Nitro, Blue, Power Blue, Mystical, Granite,
 * the seasonal and event releases, and the named one-offs.
 *
 * Everything here reads `0031`. The list of figures is explicit in the
 * migration and nothing classifies at runtime — a heuristic that runs on every
 * read is a heuristic that eventually disagrees with an administrator.
 */
describe("special, and the figures that moved onto it", () => {
  /** Every sky_id in one `set card_type = 'special'` statement of 0031. */
  function reclassified(from: string): string[] {
    const marker = `where card_type = '${from}'`;
    const at = code31.indexOf(marker);
    if (at < 0) return [];
    const block = code31.slice(at, code31.indexOf(");", at));
    return [...block.matchAll(/'(SKY-\d{4})'/g)].map((m) => m[1]);
  }

  const fromStandard = reclassified("standard");
  const fromChase = reclassified("chase");
  const all = [...fromStandard, ...fromChase];

  it("reclassifies 95 figures, each named once", () => {
    expect(fromStandard).toHaveLength(94);
    expect(fromChase).toHaveLength(1);
    expect(all).toHaveLength(95);
    expect(new Set(all).size).toBe(95);
  });

  it("names the value it expects to find, so it overwrites no correction", () => {
    /*
     * 0031 runs on a database an administrator has had access to since 0030.
     * Without the guard, a figure they had already moved to `prestige` by hand
     * would be silently reset. With it, such a row simply does not match.
     */
    const updates = code31.match(/update public\.skylanders set card_type = 'special'/g) ?? [];
    expect(updates).toHaveLength(2);
    expect(code31.match(/where card_type = '(standard|chase)'/g)).toHaveLength(2);
    // No unguarded reclassification anywhere in the file.
    expect(code31).not.toMatch(/set card_type = 'special'\s*\n\s*where sky_id/);
  });

  it("moves Granite out of chase, and nothing else", () => {
    /*
     * Granite was classified `chase` in 0030, before `special` existed. It is
     * a named form of an existing figure, which is what `special` means now.
     * The other 29 chase figures — Crystal, Pearl, Jade, Glow, Scarlet,
     * Molten, Bronze, Metallic, Golden — are colour and material runs and stay
     * exactly where they are.
     */
    expect(fromChase).toEqual(["SKY-0117"]);
  });

  it("leaves the Legendary LightCore alone, because legendary outranks special", () => {
    /*
     * SKY-0130 "Legendary Chill Light Core" is the one figure in the catalogue
     * where the priority rule has to decide anything: it is a LightCore AND a
     * Legendary, and one row holds one value.
     *
     * legendary > dark > special > standard.
     */
    expect(EDITION_RANK.legendary).toBeGreaterThan(EDITION_RANK.special);
    expect(all).not.toContain("SKY-0130");
    // And 0030 is where it got its value; 0031 does not touch it at all.
    expect(backfill("legendary")).toContain("SKY-0130");
  });

  it("does not touch a single figure 0030 classified", () => {
    // Every dark, legendary and chase id from 0030 stays where it is, with
    // the one released exception above.
    const settled = [...backfill("dark"), ...backfill("legendary"), ...backfill("chase")];
    const disturbed = all.filter((id) => settled.includes(id));
    expect(disturbed).toEqual(["SKY-0117"]);
  });

  it("classifies by identity, never by name", () => {
    expect(code31).not.toMatch(/\blike\b/i);
    expect(code31).not.toMatch(/\bilike\b/i);
    expect(code31).not.toMatch(/~\s*'/);
    expect(code31).not.toContain("position(");
    expect(code31).not.toContain("lower(");
  });

  it("renames nothing and moves no identity", () => {
    /*
     * The public name is derived at read time (`lib/catalog/variant.ts`), so
     * "Crusher (Granite)" reads as "Granite Crusher" without `name` being
     * touched — which matters, because `name` is written by the import on
     * every run and a rewrite here would be silently undone.
     */
    for (const forbidden of ["set name", "set slug", "set character_id", "set is_active", "set market_price"]) {
      expect(code31, forbidden).not.toContain(forbidden);
    }
    expect(new Set([...code31.matchAll(/set (\w+) =/g)].map((m) => m[1]))).toEqual(
      new Set(["card_type", "display_name_override"]),
    );
  });

  it("touches no table but skylanders", () => {
    expect(new Set([...code31.matchAll(/public\.(\w+)/g)].map((m) => m[1]))).toEqual(
      new Set(["skylanders"]),
    );
    for (const forbidden of ["orders", "shop_inventory", "collection_items", "sellers", "order_lines"]) {
      expect(code31, forbidden).not.toContain(forbidden);
    }
  });

  it("clears only the three overrides that say nothing", () => {
    /*
     * Three rows held a `display_name_override` byte-identical to `name`. They
     * changed no text, but they made `withVariants()` return early — a silent
     * opt-out of the derivation that looks like a decision and is not one.
     *
     * The guard is equality: an override that differs is a real editorial
     * choice. SKY-0280 repairs a typo the derivation cannot ("Whirwind"), and
     * the three Mini rows spell the old suffix convention — a trade-off for
     * the operator, not a cleanup.
     */
    const at = code31.indexOf("set display_name_override = null");
    expect(at).toBeGreaterThan(-1);
    const stmt = code31.slice(at, code31.indexOf(";", at));
    expect(stmt).toContain("where display_name_override = name");
    const ids = [...stmt.matchAll(/'(SKY-\d{4})'/g)].map((m) => m[1]);
    expect(ids).toEqual(["SKY-0011", "SKY-0012", "SKY-0013"]);
    for (const kept of ["SKY-0280", "SKY-0370", "SKY-0379", "SKY-0386"]) {
      expect(stmt, kept).not.toContain(kept);
    }
  });

  it("does not change the RPC, because the CHECK is the vocabulary", () => {
    // `admin_set_card_type()` carries no list of its own (0030). Extending the
    // constraint is the whole of what it takes to offer `special`.
    expect(code31).not.toContain("create or replace function");
    expect(code31).not.toContain("admin_set_card_type(");
    expect(code31).not.toContain("grant execute");
  });

  it("is additive: it adds a value and drops no column", () => {
    for (const destructive of ["drop column", "drop table", "delete from", "truncate", "insert into"]) {
      expect(code31, destructive).not.toContain(destructive);
    }
    // The constraint is replaced rather than altered — PostgreSQL has no
    // `alter constraint ... check` — and every old value survives it.
    expect(code31).toContain("drop constraint if exists skylanders_card_type_known");
    expect(code31).toContain("add constraint skylanders_card_type_known");
  });
});

/**
 * Which ink is legible on which artwork (V3.6, second visual round).
 *
 * The tone is not a matter of taste: it decides whether the name, the market
 * value and the price are painted near-black or near-white, and the surface
 * underneath them is measurable.
 */
describe("the tone of each artwork", () => {
  it("is light on five and dark on two", () => {
    expect(ARTWORK_TONE).toEqual({
      standard: "light",
      special: "light",
      elite: "light",
      chase: "light",
      prestige: "light",
      dark: "dark",
      legendary: "dark",
    });
  });

  it("calls chase light, because chase is light", () => {
    /*
     * The one that was wrong. `chase.png` is a crystal artwork — bright, busy
     * and heavily textured — and it was entered as "dark" in V3.5 on the
     * strength of how it looks. Its text area measures 225, the second
     * brightest of the six, so the near-white on-dark ink was being painted
     * onto near-white paper: the name, the market value and the price were
     * close to invisible.
     */
    expect(ARTWORK_TONE.chase).toBe("light");
    expect(ARTWORK_TONE.chase).toBe(ARTWORK_TONE.standard);
  });

  it("has one tone per type and no figure-level exception", () => {
    for (const type of CARD_TYPES) {
      expect(["light", "dark"], type).toContain(ARTWORK_TONE[type]);
    }
    const card = source("src/components/catalog/figure-card.tsx");
    // The card branches on the TONE, never on a card type or a figure.
    expect(card).toContain("ARTWORK_TONE[figure.cardType]");
    expect(card).toContain('tone === "dark"');
    expect(card).not.toMatch(/cardType === "/);
    expect(card).not.toMatch(/skyId === "/);
    expect(card).not.toMatch(/crystal/i);
  });

  it("swaps every tone-dependent ink together, in one place", () => {
    /*
     * Four variables, one branch. Two were added in V3.6 because the trade
     * row's inks were literals compiled into `offer-link.tsx` and stayed
     * mid-grey on dark stock — "Aktuell kein Angebot" was barely visible on
     * `dark.png`.
     */
    const card = source("src/components/catalog/figure-card.tsx");
    const at = card.indexOf('tone === "dark"');
    const branch = card.slice(at, card.indexOf("aspectRatio: CARD_ASPECT }", at));
    for (const variable of [
      "--template-ink", "--template-ink-muted", "--trade-ink", "--trade-ink-quiet",
    ]) {
      expect(branch, variable).toContain(`"${variable}": "var(${variable}-on-dark)"`);
    }
    // One branch: there is no second place that decides an ink.
    expect(card.match(/tone === "dark"/g)).toHaveLength(1);
  });
});

/**
 * Eon's Elite gets its own card (V3.7, migration 0032).
 *
 * `0031` put the 42 Eon's Elite rows into `special` — nearly half of that
 * category on its own — alongside LightCore, Granite, Nitro and the seasonal
 * releases. It does not belong with them: those are ways of building or
 * finishing a figure, this is a product line with its own packaging and, since
 * V3.7, its own artwork.
 */
describe("elite, and the 42 rows that moved onto it", () => {
  /** Every sky_id in 0032's one reclassification. */
  const eliteIds = (() => {
    const at = code32.indexOf("where card_type = 'special'");
    return [...code32.slice(at, code32.indexOf(");", at)).matchAll(/'(SKY-\d{4})'/g)].map(
      (m) => m[1],
    );
  })();

  it("reclassifies exactly 42 rows, each named once", () => {
    expect(eliteIds).toHaveLength(42);
    expect(new Set(eliteIds).size).toBe(42);
  });

  it("takes all 42 out of the list 0031 put them in", () => {
    /*
     * Not a coincidence to be re-derived: every id here was `special` a
     * migration ago, and 0032 is the file that moves them. An id in 0032 that
     * 0031 never claimed would be a row this file has no business touching.
     */
    const special = (() => {
      const ids: string[] = [];
      for (const from of ["standard", "chase"]) {
        const at = code31.indexOf(`where card_type = '${from}'`);
        ids.push(
          ...[...code31.slice(at, code31.indexOf(");", at)).matchAll(/'(SKY-\d{4})'/g)].map(
            (m) => m[1],
          ),
        );
      }
      return new Set(ids);
    })();
    for (const id of eliteIds) expect(special.has(id), `${id} was never special`).toBe(true);
    // And it leaves the rest of that list alone: 95 - 42 = 53 stay special.
    expect(special.size - eliteIds.length).toBe(53);
  });

  it("requires 0031, and degrades to nothing without it", () => {
    /*
     * Production has not had 0031 as of 2026-09-15, so its 42 rows are still
     * `standard`. The guard means a premature run writes nothing rather than
     * writing the wrong thing — the release order is 0031 and THEN 0032.
     */
    expect(code32).toContain("where card_type = 'special'");
    expect(code32.match(/update public\.skylanders/g)).toHaveLength(1);
    expect(code32).not.toMatch(/set card_type = 'elite'\s*\n\s*where sky_id/);
  });

  it("classifies by identity, never by name", () => {
    // `like 'Elite %'` would also be true of a figure simply called Elite
    // something. The difference is what a curated list records.
    for (const pattern of [/\blike\b/i, /\bilike\b/i, /~\s*'/, /position\(/, /lower\(/]) {
      expect(code32, String(pattern)).not.toMatch(pattern);
    }
  });

  it("writes card_type and nothing else — not visibility, not names", () => {
    /*
     * Packaging and edition are different dimensions. All 42 rows are Eon's
     * Elite; which of them a visitor may SEE is `catalog_visible`, owned by an
     * administrator (ADR-0039) and set through `admin_set_catalog_visible()`.
     * A migration that froze that decision would take it away from them.
     */
    expect(new Set([...code32.matchAll(/set (\w+) =/g)].map((m) => m[1]))).toEqual(
      new Set(["card_type"]),
    );
    expect(code32).not.toContain("set catalog_visible");
    for (const forbidden of ["set name", "set slug", "character_id", "set is_active"]) {
      expect(code32, forbidden).not.toContain(forbidden);
    }
    expect(new Set([...code32.matchAll(/public\.(\w+)/g)].map((m) => m[1]))).toEqual(
      new Set(["skylanders"]),
    );
  });

  it("is additive, and changes no older migration", () => {
    for (const destructive of ["drop column", "drop table", "delete from", "truncate", "insert into"]) {
      expect(code32, destructive).not.toContain(destructive);
    }
    expect(code32).toContain("drop constraint if exists skylanders_card_type_known");
    expect(code32).toContain("add constraint skylanders_card_type_known");
    // The RPC still carries no vocabulary of its own.
    expect(code32).not.toContain("create or replace function");
    expect(code32).not.toContain("grant execute");
  });

  it("leaves 0030 and 0031 byte-for-byte alone", () => {
    /*
     * 0031 is already applied to staging, which makes it history. A seventh
     * value has to arrive as a new file.
     */
    expect(sha256(MIGRATION)).toBe(
      "b335b9062f5add749b2e4a25e42c826d77dd8321aa839178d69cd6097699cc15",
    );
    expect(sha256(MIGRATION_31)).toBe(
      "cc7c2c5b40126d24e596f20439bdae1d0577df17aa083b36425b91638e807830",
    );
  });

  it("leads to the counts the operator expects", () => {
    /*
     * 602 regular figures on production. 0031 makes 95 of them special; 0032
     * moves 42 of those to elite, leaving 53.
     */
    const after = { standard: 432, special: 53, elite: 42, dark: 21, legendary: 25, chase: 29, prestige: 0 };
    expect(Object.values(after).reduce((a, b) => a + b, 0)).toBe(602);
    expect(after.special + after.elite).toBe(95);
    expect(after.elite).toBe(eliteIds.length);
    // Every card type is accounted for; a new one could not be forgotten here.
    expect(Object.keys(after).sort()).toEqual([...CARD_TYPES].sort());
  });

  it("gives elite its own artwork and no special case anywhere else", () => {
    expect(CARD_ARTWORK.elite.src).toBe("/images/cards/elite.webp");
    expect(ARTWORK_TONE.elite).toBe("light");
    expect(existsSync("public/images/cards/elite.webp")).toBe(true);
    expect(existsSync("public/images/cards/elite-sm.webp")).toBe(true);
    // No component branches on it: the seventh type is data, not a code path.
    for (const file of [
      "src/components/catalog/figure-card.tsx",
      "src/components/catalog/collected-seal.tsx",
    ]) {
      expect(source(file), file).not.toMatch(/\belite\b/i);
    }
    // And no geometry of its own.
    const template = source("src/lib/catalog/card-template.ts");
    for (const forbidden of ["eliteRows", "eliteWindow", "eliteInset", "eliteNameOffset"]) {
      expect(template, forbidden).not.toContain(forbidden);
    }
  });
});

/**
 * What survives the one-off tool that reconciled staging's visibility (V3.7).
 *
 * The tool itself is gone — it hid 28 rows once and had no second job. Two of
 * the things it asserted are not about the tool at all and stay:
 *
 *   the packaging split          which 28 rows are boxed and which 14 are loose
 *   the line between the layers  no migration writes `catalog_visible`
 */
describe("packaging and visibility stay separate from the card type", () => {
  const eliteIds = (() => {
    const at = code32.indexOf("where card_type = 'special'");
    return [...code32.slice(at, code32.indexOf(");", at)).matchAll(/'(SKY-\d{4})'/g)].map(
      (m) => m[1],
    );
  })();

  /**
   * The 14 loose rows — the only Eon's Elite figures V1 shows, because V1
   * sells `loose` only (ADR-0021). The other 28 are the Series 1 and Series 2
   * boxes; they stay in the database and stay out of the public catalogue.
   */
  const LOOSE = [
    "SKY-0011", "SKY-0017", "SKY-0022", "SKY-0030", "SKY-0035", "SKY-0040", "SKY-0049",
    "SKY-0056", "SKY-0060", "SKY-0066", "SKY-0071", "SKY-0075", "SKY-0083", "SKY-0089",
  ];

  it("splits the 42 into 14 loose and 28 boxed", () => {
    expect(eliteIds).toHaveLength(42);
    for (const id of LOOSE) expect(eliteIds, id).toContain(id);
    expect(eliteIds.filter((id) => !LOOSE.includes(id))).toHaveLength(28);
  });

  it("is never written by a migration", () => {
    /*
     * `catalog_visible` is the administrator's (ADR-0039). A migration that
     * wrote it would freeze an editorial decision and re-apply it to every
     * environment it reaches — which is why the one environment that needed
     * fixing got a tool, once, and not a file in this directory.
     */
    for (const file of [MIGRATION, MIGRATION_31, MIGRATION_32]) {
      expect(readFileSync(file, "utf8"), file).not.toContain("set catalog_visible");
    }
  });

  it("is a different question from the card type", () => {
    // All 42 are `elite`. Which of them is public is decided elsewhere, and
    // nothing in the card-type vocabulary knows about packaging.
    expect(CARD_TYPES as readonly string[]).not.toContain("loose");
    expect(CARD_TYPES as readonly string[]).not.toContain("ovp");
    expect(CARD_TYPES as readonly string[]).not.toContain("boxed");
  });
});
