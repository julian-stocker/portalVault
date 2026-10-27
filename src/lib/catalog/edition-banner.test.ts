import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CARD_TYPES, CARD_TYPE_LABELS, DEFAULT_CARD_TYPE, EDITION_RANK } from "@/lib/catalog/card-type";
import { isHeadlineEdition } from "@/components/catalog/edition-banner";
import { namesEdition } from "@/lib/catalog/card";

/**
 * The edition banderole (UX-01C, ADR-0148).
 *
 * THE ONE RULE THIS FILE EXISTS TO HOLD: an edition is read from the COLUMN
 * and never from a name. V3.6 settled it in `card-type.ts` — "no
 * `name.includes(…)` at render time, no re-derivation from `parseVariant()`,
 * no client-side guess" — and a banner is exactly the kind of decoration
 * where somebody would be tempted to look at a name instead.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const BANNER = "src/components/catalog/edition-banner.tsx";
const SRC = read(BANNER);
const CODE = code(SRC);

describe("which editions exist is the database's answer, not this file's", () => {
  it("the seven types are the CHECK constraint's seven", () => {
    /*
     * `0032` restricts the column to exactly these. The list here is the
     * same list, so a type added to one and not the other fails.
     */
    expect([...CARD_TYPES].sort()).toEqual(
      ["chase", "dark", "elite", "legendary", "prestige", "special", "standard"],
    );
    const sql = read("supabase/migrations/0032_elite_card_type.sql");
    expect(sql).toContain(
      "check (card_type in ('standard', 'special', 'elite', 'dark', 'legendary', 'chase', 'prestige'))",
    );
  });

  it("six get a banner and `standard` gets none", () => {
    expect(namesEdition(DEFAULT_CARD_TYPE)).toBe(false);
    const withBanner = CARD_TYPES.filter((t) => namesEdition(t));
    expect(withBanner).toHaveLength(6);
    expect(withBanner).not.toContain("standard");
  });

  it("THERE IS NO CRYSTAL EDITION, and none is invented", () => {
    /*
     * The operator named Crystal among the editions. It is not a card type:
     * crystal finishes are carried by `chase` — whose artwork the build calls
     * "a crystal artwork" — and the only Crystal vocabulary in the project is
     * `VARIANT_TOKENS` ("Clear Crystal", "Green Crystal", …), which is
     * matched against NAMES. Using that here would be the guessing V3.6 and
     * ADR-0034 forbid, so the figure keeps its `chase` banner.
     */
    expect(CARD_TYPES as readonly string[]).not.toContain("crystal");
    expect(CODE).not.toMatch(/crystal/i);
    /*
     * And the name-derived vocabulary is nowhere near this component — on the
     * STRIPPED source, because the header deliberately names `VARIANT_TOKENS`
     * to say why it is not used. What matters is that no line of code reaches
     * for it.
     */
    for (const forbidden of ["VARIANT_TOKENS", "parseVariant", "sortVariantLabel",
                             "displayName"]) {
      expect(CODE, `the banner reaches for ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("nothing here reads a name, a slug or a category", () => {
    for (const forbidden of ["figure.name", "includes(", "toLowerCase", "match(",
                             "categoryName", "slug"]) {
      expect(CODE, `the banner reaches for ${forbidden}`).not.toContain(forbidden);
    }
    /* Its only input is the column. */
    expect(CODE).toContain("cardType: CardType");
  });
});

describe("two tiers, derived from the rank that already exists", () => {
  it("the top of the chain gets the bright plate", () => {
    expect(isHeadlineEdition("legendary")).toBe(true);
    expect(isHeadlineEdition("prestige")).toBe(true);
  });

  it("and everything else the quiet one", () => {
    for (const type of ["dark", "special", "elite", "chase", "standard"] as const) {
      expect(isHeadlineEdition(type), type).toBe(false);
    }
  });

  it("the split IS `EDITION_RANK`, not a second opinion", () => {
    for (const type of CARD_TYPES) {
      expect(isHeadlineEdition(type), type).toBe(EDITION_RANK[type] >= 3);
    }
    /* `chase` and `elite` sit outside the chain on purpose (card-type.ts),
       so they land in the quiet tier rather than being ranked up. */
    expect(EDITION_RANK.chase).toBe(0);
    expect(EDITION_RANK.elite).toBe(0);
  });

  it("the two plates are the variant seal's, character for character", () => {
    /*
     * `VariantSeal` answered this exact question for the vertical card and
     * measured the contrast there. The banner copies the pair rather than
     * importing it — the seal belongs to the card's artwork layer — and this
     * assertion is what keeps the two from drifting.
     */
    const seal = read("src/components/catalog/variant-seal.tsx");
    for (const pair of ['bg-[#241f19] text-[#f3e6c8]', 'bg-[#3a3442] text-[#ded7e8]']) {
      expect(seal, `the seal still uses ${pair}`).toContain(pair);
      expect(CODE, `the banner uses ${pair}`).toContain(pair);
    }
  });

  it("and never gold, because gold means possession", () => {
    expect(CODE).not.toContain("own-");
    expect(CODE).not.toContain("gold");
    expect(CODE).not.toContain("favorite-");
  });
});

describe("it costs the row no height and covers as little as it can", () => {
  it("absolutely placed across the foot of the picture", () => {
    expect(CODE).toContain("absolute inset-x-0 bottom-0");
    /* 13 px of a 64 px stage — the bottom fifth, where a figure has its
       base rather than its face. */
    expect(CODE).toContain("leading-[13px]");
    expect(CODE).toContain("text-[8px]");
  });

  it("it never eats a tap meant for the row", () => {
    expect(CODE).toContain("pointer-events-none");
  });

  it("it is decorative, because the row already names the figure", () => {
    expect(CODE).toContain('aria-hidden="true"');
  });

  it("a long label shortens rather than breaking the band", () => {
    expect(CODE).toContain("truncate");
    /* The longest label is nine characters at 8 px — about 44 px of a 64 px
       stage, so truncation is a guarantee and not an everyday event. */
    const longest = Math.max(...Object.values(CARD_TYPE_LABELS).map((l) => l.length));
    expect(longest).toBe(9);
  });

  it("and it brings no query, no action and no state", () => {
    for (const forbidden of ['"use client"', '"use server"', "useState", "fetch(",
                             "@/lib/supabase"]) {
      expect(SRC, `the banner contains ${forbidden}`).not.toContain(forbidden);
    }
  });
});
