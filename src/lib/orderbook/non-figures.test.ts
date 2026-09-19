/**
 * The three destinations that are never a SkyIsles figure (ADR-0088).
 *
 * WHY THESE ARE RULES AND NOT MAPPINGS
 *
 * The 2026 preview found 153 Disney Infinity rows under 99 distinct names. As
 * saved name mappings that is 99 owner decisions, 99 rows in a table, and 99
 * chances for the hundredth spelling to arrive unresolved. As a rule it is one
 * sentence: a reference into the workbook's own `DI A` sheet is not a
 * Skylander. The same for `ZB` (Zubehör) and for a Swap Force half.
 *
 * WHY THEY DO NOT WEAKEN FORMULA PRECEDENCE
 *
 * They ARE formula precedence. Each reads only where the owner's own reference
 * points; none of them looks at the free text in `F`, and none can touch a
 * reference that lands on a real catalog figure. The thing they replace is the
 * old answer for these rows — `unmatched`, "we looked and found nothing" —
 * which was true about the catalog and wrong about the object.
 */
import { describe, expect, it } from "vitest";

import {
  classifyItem, indexCatalog, nonFigureByReference, referencedSheet,
  SWAP_FORCE_HALF, type CatalogEntry, type RawRow,
} from "./order-2026.ts";

const CATALOG: CatalogEntry[] = [
  { skyId: "SKY-0371", name: "Mini Bop", series: "T" },
  { skyId: "SKY-0126", name: "Tree Rex", series: "G" },
  { skyId: "SKY-0145", name: "Shroomboom", series: "G" },
  { skyId: "SKY-0565", name: "King Pen", series: "I" },
  { skyId: "SKY-0296", name: "Wham Shell - Lightcore", series: "SF" },
  { skyId: "SKY-0203", name: "Blast Zone", series: "SF" },
];
const STOCK: Record<string, string> = {
  "T|74": "Mini Bop",
  "G|22": "Tree Rex", "G|42": "Shroomboom", "I|40": "King Pen",
  "SF|107": "Wham Shell - Lightcore",
  "SF|12": "Blast Zone", "SF|13": "Blash Zone - OBERTEIL",
  "SF|18": "Doom Stone - UNTERTEIL", "SF|40": "Rattle Shake - UNTERTEIL",
  "SF|47": "Trap Shadow - OBERTEIL",
  "ZB|8": "0000502 (G)", "ZB|14": "INF-8032386 (Disney Infinity)", "ZB|37": "Tasche Spyros Adventures",
};
const index = indexCatalog(CATALOG);
const raw = (over: Partial<RawRow> = {}): RawRow =>
  ({ row: 1, a: "", b: "", c: "x", d: "x", e: "1", f: "X", g: "", gFormula: "", h: "", i: "", ...over });
const classify = (r: RawRow, mappings = new Map<string, string | null>()) =>
  classifyItem(r, 1, (s, n) => STOCK[`${s}|${n}`] ?? null, index, mappings);

describe("where a reference points", () => {
  it("reads the sheet out of any cell reference, quoted or not", () => {
    expect(referencedSheet("'DI A'!I84")).toBe("DI A");
    expect(referencedSheet("ZB!I8")).toBe("ZB");
    expect(referencedSheet("SF!$I$47")).toBe("SF");
    expect(referencedSheet("=G!I22")).toBe("G");
  });

  it("is not fooled by an aggregate, an error or a bare value", () => {
    for (const f of ["SUM(G5:G18)", "#REF!", "", "4.49", "IF(A1=1,2,3)"]) {
      expect(referencedSheet(f), f).toBeNull();
    }
  });

  it("recognises a Swap Force half only at the end of the name", () => {
    expect(SWAP_FORCE_HALF.test("Doom Stone - UNTERTEIL")).toBe(true);
    expect(SWAP_FORCE_HALF.test("Blash Zone - OBERTEIL")).toBe(true);
    expect(SWAP_FORCE_HALF.test("Blast Zone")).toBe(false);
    // Not a half: a figure whose name merely contains the word.
    expect(SWAP_FORCE_HALF.test("Oberteil Ranger")).toBe(false);
  });
});

describe("rule A — Disney Infinity", () => {
  it("a 'DI A' reference is an intentional non-figure", () => {
    const r = classify(raw({ f: "2.0 -Thor", gFormula: "'DI A'!I84" }));
    expect(r.classification).toBe("uncategorized");
    expect(r.evidence).toBe("formula");
    expect(r.skyId).toBeNull();
    expect(r.note).toContain("Disney Infinity");
  });

  it("keeps its raw name — that IS the item's name", () => {
    const r = classify(raw({ f: "3.0 - Playset - Erwachen der Macht", gFormula: "'DI A'!I160" }));
    expect(r.rawName).toBe("3.0 - Playset - Erwachen der Macht");
  });

  it("works for every 'DI A' row shape, not only figures", () => {
    // Figures, Playsets, Power Discs and platform software all live there.
    for (const [name, cell] of [["1.0 - Jack Sparrow", "I20"], ["2.0 - Power Disc - Thor Toybox", "I95"],
                                ["3.0 - Spiel PlayStation 4", "I99"]] as const) {
      const r = classify(raw({ f: name, gFormula: `'DI A'!${cell}` }));
      expect(r.classification, name).toBe("uncategorized");
      expect(r.skyId, name).toBeNull();
    }
  });

  it("a DAMAGED Disney Infinity row is still ignored, not classified", () => {
    // Two 2026 rows are exactly this: `3.0 - Obi-Wan-Kenobi` with C=b.
    const r = classify(raw({ c: "b", f: "3.0 - Obi-Wan-Kenobi", gFormula: "'DI A'!I105" }));
    expect(r.classification).toBe("ignored_damaged");
  });

  it("and no saved mapping can turn one into a figure", () => {
    const r = classify(raw({ f: "2.0 -Thor", gFormula: "'DI A'!I84" }),
      new Map([["2 0 thor", "SKY-0371"]]));
    expect(r.skyId).toBeNull();
    expect(r.classification).toBe("uncategorized");
  });
});

describe("rule B — Zubehör", () => {
  it("a ZB reference is an intentional non-figure", () => {
    const r = classify(raw({ f: "0000502 (G)", gFormula: "ZB!I8" }));
    expect(r.classification).toBe("uncategorized");
    expect(r.evidence).toBe("formula");
    expect(r.skyId).toBeNull();
    expect(r.note).toContain("Zubehör");
  });

  it("a Giants-era PORTAL does not become a Giants figure", () => {
    /*
     * `0000502 (G)` carries a Skylanders generation in its name and is a
     * portal. The `ZB` destination is what says so; the `(G)` does not.
     */
    const r = classify(raw({ f: "0000502 (G)", gFormula: "ZB!I8" }));
    expect(r.skyId).toBeNull();
  });

  it("covers the Disney Infinity portal too, by destination", () => {
    const r = classify(raw({ f: "INF-8032386 (Disney Infinity)", gFormula: "ZB!I14" }));
    expect(r.classification).toBe("uncategorized");
    expect(r.skyId).toBeNull();
  });

  it("and a saved mapping cannot override it either", () => {
    const r = classify(raw({ f: "0000502 (G)", gFormula: "ZB!I8" }),
      new Map([["0000502 g", "SKY-0126"]]));
    expect(r.skyId).toBeNull();
  });
});

describe("rule C — Swap Force halves", () => {
  it("a reference landing on a half is an intentional non-figure", () => {
    for (const [name, cell] of [["Doom Stone (U)", 18], ["Rattle Shake (U)", 40],
                                ["Trap Shadow (O)", 47]] as const) {
      const r = classify(raw({ f: name, gFormula: `SF!I${cell}` }));
      expect(r.classification, name).toBe("uncategorized");
      expect(r.evidence, name).toBe("formula");
      expect(r.skyId, name).toBeNull();
      expect(r.note, name).toContain("Swap-Force");
    }
  });

  it("(U) and (O) are NOT damage markers", () => {
    // Only (B) and (D) are. A half is kept as a purchased object; a damaged
    // figure is discarded. Confusing the two would delete real expenditure.
    for (const name of ["Doom Stone (U)", "Trap Shadow (O)"]) {
      expect(classify(raw({ f: name, gFormula: "SF!I18" })).classification, name)
        .not.toBe("ignored_damaged");
    }
  });

  it("the half never becomes the whole character", () => {
    /*
     * `Trap Shadow (O)` names a character the catalog HAS. The reference points
     * at the half, and the parcel contained a half.
     */
    const r = classify(raw({ f: "Trap Shadow (O)", gFormula: "SF!I47" }));
    expect(r.skyId).toBeNull();
    expect(r.resolvedName).toBe("Trap Shadow - OBERTEIL");
  });

  it("and the whole figure one row away still resolves normally", () => {
    const r = classify(raw({ f: "blastzone", gFormula: "SF!I12" }));
    expect(r.classification).toBe("matched");
    expect(r.skyId).toBe("SKY-0203");
  });
});

describe("the rules cannot reach a real figure", () => {
  it("a stock-sheet reference to a catalog figure still matches", () => {
    const r = classify(raw({ f: "Bob", gFormula: "T!I74" }));
    expect(r.classification).toBe("matched");
    expect(r.skyId).toBe("SKY-0371");
    expect(r.evidence).toBe("formula");
  });

  it("nonFigureByReference says no for every figure destination", () => {
    for (const f of ["T!I74", "G!I22", "SF!I12", "SA!I32", "SC!I26", "I!I40"]) {
      expect(nonFigureByReference(f, "Tree Rex"), f).toBeNull();
    }
  });

  it("and damage is still asked before any of them", () => {
    const r = classify(raw({ c: "b", f: "0000502 (G)", gFormula: "ZB!I8" }));
    expect(r.classification).toBe("ignored_damaged");
  });
});

describe("the four confirmed figures need a saved mapping, and get one", () => {
  const APPROVED: [string, string, string][] = [
    ["Tree Rex", "tree rex", "SKY-0126"],
    ["Shroomboom", "shroomboom", "SKY-0145"],
    ["King Pen", "king pen", "SKY-0565"],
    ["Wham Shell LC", "wham shell lc", "SKY-0296"],
  ];

  it("each resolves from the mapping when the row has no formula", () => {
    for (const [name, key, sky] of APPROVED) {
      const r = classify(raw({ f: name, gFormula: "" }), new Map([[key, sky]]));
      expect(r.classification, name).toBe("matched");
      expect(r.skyId, name).toBe(sky);
      expect(r.evidence, name).toBe("mapping");
    }
  });

  it("and is overruled by a formula wherever one exists", () => {
    /*
     * `Tree Rex` appears 32 times WITH `G!I22`. Those rows never consult the
     * mapping — which is the point: the mapping exists for the one row that
     * has no reference, not as a second opinion about the other thirty-two.
     */
    const r = classify(raw({ f: "Tree Rex", gFormula: "G!I22" }),
      new Map([["tree rex", "SKY-0565"]]));
    expect(r.skyId).toBe("SKY-0126");
    expect(r.evidence).toBe("formula");
  });

  it("the five accessory names map to no figure at all", () => {
    for (const name of ["0000655 (SC)", "84721790 (SF, T, SC)", "84704790 (SF)",
                        "84151790 (SA)", "Tasche"]) {
      const key = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const r = classify(raw({ f: name, gFormula: "" }), new Map([[key, null]]));
      expect(r.classification, name).toBe("uncategorized");
      expect(r.skyId, name).toBeNull();
      expect(r.evidence, name).toBe("mapping");
    }
  });
});

describe("every migrated row reaches a terminal classification", () => {
  it("figure, or intentional non-figure — nothing in between", () => {
    const cases: [RawRow, "matched" | "uncategorized"][] = [
      [raw({ f: "Bob", gFormula: "T!I74" }), "matched"],
      [raw({ f: "2.0 -Thor", gFormula: "'DI A'!I84" }), "uncategorized"],
      [raw({ f: "0000502 (G)", gFormula: "ZB!I8" }), "uncategorized"],
      [raw({ f: "Doom Stone (U)", gFormula: "SF!I18" }), "uncategorized"],
      [raw({ f: "Tasche", gFormula: "" }), "uncategorized"],
    ];
    for (const [row, expected] of cases) {
      const r = classify(row, new Map([["tasche", null]]));
      expect(r.classification, row.f).toBe(expected);
      expect(r.classification === "matched" ? r.skyId !== null : r.skyId === null, row.f).toBe(true);
    }
  });
});
