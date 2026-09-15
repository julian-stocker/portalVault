import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";

import {
  CARD_TYPES,
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
  USE_COLLECTED_ARTWORK,
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
const sql = readFileSync(MIGRATION, "utf8");
const code = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

/** Every sky_id in one `set card_type = '<type>'` statement. */
function backfill(type: CardType): string[] {
  const at = code.indexOf(`set card_type = '${type}'`);
  if (at < 0) return [];
  const block = code.slice(at, code.indexOf(");", at));
  return [...block.matchAll(/'(SKY-[0-9]{4})'/g)].map((m) => m[1]);
}

describe("there are five card types, and collection is not one of them", () => {
  it("names exactly the five", () => {
    expect([...CARD_TYPES]).toEqual(["standard", "dark", "legendary", "chase", "prestige"]);
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

  it("labels all five and invents no German for the domain's own words", () => {
    for (const type of CARD_TYPES) expect(CARD_TYPE_LABELS[type]).toBeTruthy();
    expect(CARD_TYPE_LABELS.standard).toBe("Standard");
    expect(CARD_TYPE_LABELS.prestige).toBe("Prestige");
  });
});

describe("the database says the same five", () => {
  it("adds the column with the default the application assumes", () => {
    expect(code).toContain("add column if not exists card_type text not null default 'standard'");
  });

  it("constrains it to exactly the application's list", () => {
    // `add constraint`, not the `drop constraint if exists` above it — the
    // first match is the teardown and contains no values at all.
    const at = code.indexOf("add constraint skylanders_card_type_known");
    expect(at, "the CHECK constraint is missing").toBeGreaterThan(-1);
    const constraint = code.slice(at, code.indexOf(";", at));
    for (const type of CARD_TYPES) expect(constraint, type).toContain(`'${type}'`);
    // And nothing beyond them.
    expect(constraint.match(/'[a-z]+'/g)).toHaveLength(CARD_TYPES.length);
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
  standard: "card", dark: "dark", legendary: "legendary", chase: "chase", prestige: "prestige",
};

describe("every card type has two cards: one plain, one owned", () => {
  it("maps both for all five", () => {
    for (const type of CARD_TYPES) {
      const a = CARD_ARTWORK[type];
      expect(a.plain.src, type).toBe(`/images/cards/${FILE[type]}.webp`);
      expect(a.plain.small, type).toBe(`/images/cards/${FILE[type]}-sm.webp`);
      expect(a.collected.src, type).toBe(`/images/cards/${FILE[type]}.collected.webp`);
      expect(a.collected.small, type).toBe(`/images/cards/${FILE[type]}.collected-sm.webp`);
    }
  });

  it("gives no two states the same file", () => {
    /*
     * Twenty distinct paths. An owned Legendary must not borrow the plain
     * Chase card, and — the failure this replaced — an owned anything must
     * not borrow one shared ownership artwork, which is what made every
     * collected figure look alike whatever it was.
     */
    const paths = CARD_TYPES.flatMap((t) => [
      CARD_ARTWORK[t].plain.src, CARD_ARTWORK[t].plain.small,
      CARD_ARTWORK[t].collected.src, CARD_ARTWORK[t].collected.small,
    ]);
    expect(paths).toHaveLength(20);
    expect(new Set(paths).size).toBe(20);
  });

  it("has no ownership artwork of its own any more", () => {
    // Ownership was never a card type and now has no file either: it picks
    // the second card of the type the figure already has.
    const template = readFileSync("src/lib/catalog/card-template.ts", "utf8");
    expect(template).not.toContain("COLLECTION_ARTWORK");
    expect(template).not.toContain("COLLECTION_TONE");
    expect(template).not.toContain("/images/cards/collection.webp");
  });

  it("ships all twenty files", () => {
    for (const type of CARD_TYPES) {
      for (const p of [
        CARD_ARTWORK[type].plain.src, CARD_ARTWORK[type].plain.small,
        CARD_ARTWORK[type].collected.src, CARD_ARTWORK[type].collected.small,
      ]) {
        const file = `public${p}`;
        expect(existsSync(file), `${file} is missing`).toBe(true);
        expect(statSync(file).size, `${file} is empty`).toBeGreaterThan(1000);
      }
    }
  });

  it("treats prestige like every other pair, with no fallback branch", () => {
    /*
     * `prestige.collected.png` is currently a byte-identical copy of
     * `prestige.png` — a placeholder. Handling that in code would be a branch
     * to find and remove later; handling it as data means replacing one file
     * and rebuilding. The path is its own either way.
     */
    expect(CARD_ARTWORK.prestige.collected.src).toBe("/images/cards/prestige.collected.webp");
    expect(CARD_ARTWORK.prestige.collected.src).not.toBe(CARD_ARTWORK.prestige.plain.src);
    expect(source("src/components/catalog/figure-card.tsx")).not.toMatch(/prestige/i);
  });

  it("selects through one function, without touching the type", () => {
    const card = readFileSync("src/components/catalog/figure-card.tsx", "utf8");
    expect(card).toContain("const template = artworkFor(figure.cardType, owned);");
    expect(card).toContain("const owned = marksOwnership(ownership, collected)");
    // The component must not reach into a pair itself — one place decides.
    expect(card).not.toContain("artwork.collected");
    expect(card).not.toContain(".plain");
    // Nothing writes a card type anywhere in the component.
    expect(card).not.toMatch(/cardType\s*=\s*['"]/);
  });
});

/**
 * The collected artworks are mapped, built, and deliberately not drawn.
 *
 * The two halves of each pair are not pixel-congruent: the window and frame
 * sit a few pixels apart, so collecting a figure made the card appear to
 * jump. Ownership is shown by an overlay on the plain card instead. This is a
 * switch, not a deletion — the day the artworks line up it flips back.
 */
describe("owning a figure does not change the card it is printed on", () => {
  it("is switched off, in one place", () => {
    expect(USE_COLLECTED_ARTWORK).toBe(false);
    const template = readFileSync("src/lib/catalog/card-template.ts", "utf8");
    expect(template.match(/USE_COLLECTED_ARTWORK/g) ?? []).toHaveLength(2); // declaration + the one read
  });

  it("draws the plain card for every type, owned or not", () => {
    for (const type of CARD_TYPES) {
      const plain = CARD_ARTWORK[type].plain;
      expect(artworkFor(type, false), `${type} unowned`).toEqual(plain);
      expect(artworkFor(type, true), `${type} owned`).toEqual(plain);
    }
  });

  it("keeps every collected path mapped and shipped", () => {
    // Switched off is not removed. All five stay addressable and on disk.
    for (const type of CARD_TYPES) {
      const c = CARD_ARTWORK[type].collected;
      expect(c.src, type).toMatch(/\.collected\.webp$/);
      expect(c.small, type).toMatch(/\.collected-sm\.webp$/);
      expect(existsSync(`public${c.src}`), `public${c.src}`).toBe(true);
      expect(existsSync(`public${c.small}`), `public${c.small}`).toBe(true);
    }
  });

  it("would use them again the moment the switch flips", () => {
    // The rule reads the flag; it does not hardcode `plain`.
    const template = readFileSync("src/lib/catalog/card-template.ts", "utf8");
    const at = template.indexOf("export function artworkFor(");
    const fn = template.slice(at, template.indexOf("}", template.indexOf("return", at)));
    expect(fn).toContain("owned && USE_COLLECTED_ARTWORK ? artwork.collected : artwork.plain");
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

  it("is 18 % of the card's width, the released size", () => {
    /*
     * The history matters, because each value was wrong for its own reason:
     * 12 % was oversized AND mispositioned by the axis bug; 9 % was correctly
     * placed and too small; 18 % is the doubling the operator asked for after
     * seeing 9 % rendered. Pinned exactly — this is a released value now, and
     * a drift is a regression rather than a tuning.
     */
    expect(size).toBe(18);
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
    expect(seal).toContain("right: INSET.image");
    expect(seal).toContain("calc(${WINDOW_TOP}% - ${SIZE} / 2)");
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
    expect(seal).toContain('import { INSET, ROWS } from "@/lib/catalog/card-template"');
    expect(seal).toContain('ROWS.findIndex((row) => row.area === "image")');
    expect(seal).not.toMatch(/7\.42|10\.8/);
  });

  it("sizes against the card, not the viewport", () => {
    // The card root is an `@container`, so `cqw` is a share of this card.
    expect(seal).toContain("cqw");
    // Not the viewport, and not a breakpoint: a card in a five-column desktop
    // grid is no wider than one on a phone, so the screen says nothing here.
    expect(seal).not.toMatch(/\b\d+(\.\d+)?v(w|h|min|max)\b|sm:|md:|lg:|xl:/);
    expect(card).toContain("@container");
  });

  it("is gold, from the ownership tokens, with no new colour", () => {
    expect(seal).toContain("var(--own-ink)");
    expect(seal).toContain("var(--own-ink-on-card)");
    expect(seal).toContain("var(--on-own)");
    expect(seal).not.toMatch(/#[0-9a-f]{3,6}/i);
    // Not trade silver and not commerce amber — those are other sentences.
    expect(seal).not.toMatch(/trade|commerce|amber/i);
  });

  it("is a seal with a tick, not a crown and not a cart", () => {
    expect(seal).toContain("<circle");
    expect(seal).toContain("strokeLinecap"); // the tick
    expect(seal).not.toMatch(/crown/i);
    expect(existsSync("src/components/catalog/collected-crown.tsx")).toBe(false);
    /*
     * It draws its own paths rather than borrowing a commerce glyph. It does
     * import the card's measurements — that is the point of round 3 — so what
     * is forbidden is importing a DRAWING, not importing at all.
     */
    expect(card).not.toContain("CartCheckedGlyph");
    expect(seal).not.toMatch(/import .*(Glyph|glyph|icon|Icon)/);
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
    expect(seal).toContain("top: TOP, right: INSET.image");
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

  it("leaves no active template on the old canvas", () => {
    const tool = readFileSync("tools/build-card-templates.mts", "utf8");
    expect(tool).toContain("const CANVAS = { width: 1007, height: 1562 };");
    /*
     * Ten entries since fix round 1: five card types, each with the card it
     * is printed on and the card it is printed on once owned. `collection` is
     * gone — its source PNG no longer exists and its job is done by five
     * files instead of one.
     */
    const at = tool.indexOf("const TEMPLATES = [");
    const list = tool.slice(at, tool.indexOf("] as const;", at));
    for (const name of ["card", "dark", "legendary", "chase", "prestige"]) {
      expect(list, name).toContain(`"${name}",`);
      expect(list, `${name}.collected`).toContain(`"${name}.collected",`);
    }
    expect(list).not.toContain('"collection"');
    expect(list).not.toContain('"silver"');
    expect(list).not.toContain('"gold"');
    // The assertion that stops an artwork delivered at the old size.
    expect(tool).toContain("meta.width !== CANVAS.width");
    expect(tool).toContain("meta.hasAlpha");
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
