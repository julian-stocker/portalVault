import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  exactMatchIndex, matchFigures, nextPage, rankFigure, searchFigures, type FigureChoice,
} from "./figure-search";
import {
  sortPurchaseItemsBySeries, seriesRank, UNKNOWN_SERIES, type SeriesPositions,
} from "./series-order";
import {
  addPurchaseFigure, purchaseDraftDisplayOrder, purchaseDraftFromUnits, purchaseDraftPayload,
  splitPurchaseUnit, setPurchaseQuantity, type PurchaseDraftLine,
} from "./purchase-draft";

/**
 * Calculator- und Orderbuch-Fixes (V2): Suche ohne Abschneiden, Serie als
 * Sortierschlüssel, Einkauf in Serienblöcken.
 *
 * DIE URSACHE, DIE HIER FESTGEHALTEN WIRD. „Pop Fizz“ trifft im Katalog acht
 * Zeilen. `searchFigures` schnitt nach `limit` ab (Kalkulator: 6), und
 * „Punch Pop Fizz“ lag im Ranking als bloßer „Name enthält“-Treffer
 * alphabetisch auf Platz sieben — unsichtbar und unerreichbar.
 */

/* `series.position`, wie die Datenbank sie führt (Trap Team ist `T`). */
const POSITIONS: SeriesPositions = new Map([
  ["SA", 0], ["G", 1], ["SF", 2], ["T", 3], ["SC", 4], ["I", 5],
  ["SMOK", 98], ["TEST", 99],
]);

const fig = (skyId: string, name: string, series: string): FigureChoice => ({
  skyId, name, series, marketPrice: null, seriesPosition: POSITIONS.get(series),
});

/* Die acht Pop-Fizz-Zeilen des echten Katalogs (SKY-IDs und Serien wie dort). */
const POP_FIZZ: FigureChoice[] = [
  fig("SKY-0142", "Pop Fizz", "G"),
  fig("SKY-0143", "Pop Fizz Light Core", "G"),
  fig("SKY-0144", "Punch Pop Fizz", "G"),
  fig("SKY-0290", "Super Gulp Pop Fizz", "SF"),
  fig("SKY-0363", "Fizzy Frenzy Pop Fizz", "T"),
  fig("SKY-0364", "Love Potion Pop Fizz", "T"),
  fig("SKY-0463", "Big Bubble Pop Fizz", "SC"),
  fig("SKY-0464", "Birthday Bash Big Bubble Pop Fizz", "SC"),
];
const KATALOG: FigureChoice[] = [
  fig("SKY-0001", "Spyro", "SA"),
  fig("SKY-0012", "Eruptor", "SA"),
  ...POP_FIZZ,
  fig("SKY-0500", "King Pen", "I"),
];

const ids = (list: readonly FigureChoice[]) => list.map((c) => c.skyId);
const names = (list: readonly FigureChoice[]) => list.map((c) => c.name);

/* ===================================================================== */
describe("FIX 1 — die Suche findet alles, was passt", () => {
  it("„Pop Fizz“ findet auch „Punch Pop Fizz“", () => {
    expect(names(matchFigures(KATALOG, "Pop Fizz"))).toContain("Punch Pop Fizz");
  });

  it("findet alle acht Pop-Fizz-Zeilen und nichts sonst", () => {
    expect(new Set(ids(matchFigures(KATALOG, "Pop Fizz")))).toEqual(new Set(ids(POP_FIZZ)));
  });

  it("unabhängig von Groß- und Kleinschreibung", () => {
    const erwartet = ids(matchFigures(KATALOG, "Pop Fizz"));
    expect(ids(matchFigures(KATALOG, "pop fizz"))).toEqual(erwartet);
    expect(ids(matchFigures(KATALOG, "POP FIZZ"))).toEqual(erwartet);
    expect(ids(matchFigures(KATALOG, "  pOp FiZz "))).toEqual(erwartet);
  });

  it("die alte Ursache: mit einer Grenze von sechs fehlte „Punch Pop Fizz“", () => {
    /* `searchFigures` schneidet weiterhin — der Picker benutzt es nicht mehr. */
    expect(names(searchFigures(KATALOG, "Pop Fizz", 6))).toHaveLength(6);
    /* `matchFigures` hat keine Grenze: Treffer hinter jeder Seite bleiben da. */
    expect(matchFigures(KATALOG, "Pop Fizz").length).toBeGreaterThan(6);
  });

  it("Treffer hinter einer Seite sind erreichbar — auch bei hunderten", () => {
    const viele = Array.from({ length: 300 }, (_, i) =>
      fig(`SKY-${String(1000 + i)}`, `Pop Fizz Variante ${i}`, "G"));
    const alle = matchFigures([...viele, ...KATALOG], "pop fizz");
    expect(alle).toHaveLength(308);
    expect(names(alle)).toContain("Punch Pop Fizz");
    /* Seite für Seite kommt man bis ans Ende, und nicht darüber hinaus. */
    let shown = 6;
    let schritte = 0;
    while (shown < alle.length) { shown = nextPage(shown, 6, alle.length); schritte += 1; }
    expect(shown).toBe(308);
    expect(schritte).toBe(Math.ceil((308 - 6) / 6));
  });

  it("ein Treffer, der mit dem Gesuchten an einer Wortgrenze beginnt, ist ein Wort-Treffer", () => {
    /* Vorher NAME_CONTAINS (3): die Wörter wurden einzeln verglichen, und
       „pop fizz“ beginnt in keinem einzelnen Wort. */
    expect(rankFigure(fig("SKY-0144", "Punch Pop Fizz", "G"), "pop fizz")).toBe(2);
    expect(rankFigure(fig("SKY-0144", "Punch Pop Fizz", "G"), "op fizz")).toBe(3);
    /* Einzelwörter wie bisher. */
    expect(rankFigure(fig("SKY-0001", "Dark Wash Buckler", "T"), "wash")).toBe(2);
  });

  it("keine Figur doppelt — auch wenn der Katalog eine Zeile zweimal liefert", () => {
    const doppelt = [...KATALOG, POP_FIZZ[2], { ...POP_FIZZ[0] }];
    const treffer = ids(matchFigures(doppelt, "Pop Fizz"));
    expect(treffer).toHaveLength(new Set(treffer).size);
    expect(treffer).toHaveLength(8);
  });
});

/* ===================================================================== */
describe("Enter: wo der exakte Name steht", () => {
  const MINI = [fig("SKY-0215", "Sidekick Mini Jini", "G"), fig("SKY-0420", "Mini Jini", "T")];

  it("nach Serie kann er weiter unten stehen — der Index sagt, wo", () => {
    const treffer = matchFigures(MINI, "Mini Jini", "series");
    expect(names(treffer)).toEqual(["Sidekick Mini Jini", "Mini Jini"]);
    expect(exactMatchIndex(treffer, "Mini Jini")).toBe(1);
    expect(exactMatchIndex(treffer, "  mini JINI ")).toBe(1);
  });

  it("nach Relevanz steht er immer oben", () => {
    expect(exactMatchIndex(matchFigures(MINI, "mini jini"), "mini jini")).toBe(0);
    expect(exactMatchIndex(matchFigures(KATALOG, "pop fizz"), "pop fizz")).toBe(0);
  });

  it("kein exakter Name: -1", () => {
    expect(exactMatchIndex(matchFigures(MINI, "mini j", "series"), "mini j")).toBe(-1);
    expect(exactMatchIndex(MINI, "m")).toBe(-1);
  });

  it("gleichnamige Figuren: die frühere Serie", () => {
    const chop = [fig("SKY-0150", "Chop Chop", "G"), fig("SKY-0050", "Chop Chop", "SA")];
    const treffer = matchFigures(chop, "chop chop", "series");
    expect(treffer[exactMatchIndex(treffer, "chop chop")].series).toBe("SA");
  });
});

/* ===================================================================== */
describe("FIX 2 — Kalkulator: Serie zuerst", () => {
  it("das Beispiel: G Pop Fizz, G Punch Pop Fizz, dann SF, T, SC", () => {
    const treffer = matchFigures(KATALOG, "Pop Fizz", "series");
    expect(treffer.map((c) => `${c.series} – ${c.name}`)).toEqual([
      "G – Pop Fizz",
      "G – Pop Fizz Light Core",
      "G – Punch Pop Fizz",
      "SF – Super Gulp Pop Fizz",
      "T – Fizzy Frenzy Pop Fizz",
      "T – Love Potion Pop Fizz",
      "SC – Big Bubble Pop Fizz",
      "SC – Birthday Bash Big Bubble Pop Fizz",
    ]);
  });

  it("die Reihenfolge über alle sechs Serien: SA → G → SF → T → SC → I", () => {
    const sechs = ["I", "SC", "T", "SF", "G", "SA"].map((s, i) =>
      fig(`SKY-${String(700 + i)}`, `Kaos ${s}`, s));
    expect(matchFigures(sechs, "kaos", "series").map((c) => c.series))
      .toEqual(["SA", "G", "SF", "T", "SC", "I"]);
  });

  it("die Serie schlägt die Relevanz — und sortiert nichts weg", () => {
    const katalog = [fig("SKY-0800", "Kaos", "I"), fig("SKY-0801", "Kaos Trap", "T")];
    expect(names(matchFigures(katalog, "kaos", "series"))).toEqual(["Kaos Trap", "Kaos"]);
    expect(names(matchFigures(katalog, "kaos", "relevance"))).toEqual(["Kaos", "Kaos Trap"]);
    expect(matchFigures(katalog, "kaos", "series")).toHaveLength(2);
  });

  it("stabil innerhalb einer Serie: Relevanz, dann Name, dann SKY-ID", () => {
    const g = [
      fig("SKY-0903", "Zeta Pop", "G"),
      fig("SKY-0902", "Alpha Pop", "G"),
      fig("SKY-0901", "Alpha Pop", "G"),
      fig("SKY-0900", "Pop", "G"),
    ];
    const erwartet = ["SKY-0900", "SKY-0901", "SKY-0902", "SKY-0903"];
    expect(ids(matchFigures(g, "pop", "series"))).toEqual(erwartet);
    /* Jede Eingabereihenfolge ergibt dieselbe Liste. */
    expect(ids(matchFigures([...g].reverse(), "pop", "series"))).toEqual(erwartet);
    expect(ids(matchFigures([g[2], g[0], g[3], g[1]], "pop", "series"))).toEqual(erwartet);
  });

  it("ohne bekannte Serie: hinter allen sechs, nicht weggelassen", () => {
    const ohne: FigureChoice = { skyId: "SKY-0999", name: "Pop Fizz Fremd", series: "XX",
      marketPrice: null };
    const smok = fig("SKY-0998", "Pop Fizz Smoke", "SMOK");
    const treffer = matchFigures([ohne, smok, ...KATALOG], "pop fizz", "series");
    expect(treffer).toHaveLength(10);
    expect(ids(treffer).slice(-2)).toEqual(["SKY-0998", "SKY-0999"]);
  });

  it("die Vorgabe bleibt Relevanz — das Orderbuch sortiert wie bisher", () => {
    expect(names(matchFigures(KATALOG, "Pop Fizz")).slice(0, 2))
      .toEqual(["Pop Fizz", "Pop Fizz Light Core"]);
    expect(matchFigures(KATALOG, "Pop Fizz")).toEqual(matchFigures(KATALOG, "Pop Fizz", "relevance"));
  });

  it("der Kalkulator bestellt die Serienreihenfolge, das Orderbuch nicht", () => {
    const modal = readFileSync("src/components/calculator/calculator-modal.tsx", "utf8");
    expect(modal).toContain('order="series"');
    for (const datei of ["purchase-draft-list", "figure-draft", "add-purchase-item",
      "purchase-items", "purchase-details", "sale-items"]) {
      const quelle = readFileSync(`src/components/business/${datei}.tsx`, "utf8");
      expect(quelle.includes('order="series"'), datei).toBe(false);
    }
  });

  it("die Serienposition kommt aus der Tabelle, nicht aus einer Liste im Code", () => {
    const queries = readFileSync("src/lib/orderbook/queries.ts", "utf8");
    expect(queries).toContain('from("series").select("code, label, position")');
    expect(queries).toContain("seriesPosition: positions.get(String(r.series_code))");
  });
});

/* ===================================================================== */
type Item = { id: number; position: number; name: string; seriesCode: string | null;
  quantity?: number; marketPrice?: number | null; state?: string };

describe("FIX 3 — gespeicherter Einkauf in Serienblöcken", () => {
  const ITEMS: Item[] = [
    { id: 11, position: 1, name: "King Pen", seriesCode: "I" },
    { id: 12, position: 2, name: "Wash Buckler", seriesCode: "T" },
    { id: 13, position: 3, name: "Portal ohne Zuordnung", seriesCode: null },
    { id: 14, position: 4, name: "Spyro", seriesCode: "SA" },
    { id: 15, position: 5, name: "Punch Pop Fizz", seriesCode: "G" },
    { id: 16, position: 6, name: "Blast Zone", seriesCode: "SF" },
    { id: 17, position: 7, name: "Spitfire", seriesCode: "SC" },
    { id: 18, position: 8, name: "Eruptor", seriesCode: "SA" },
    { id: 19, position: 9, name: "Wash Buckler", seriesCode: "T" },
    { id: 20, position: 10, name: "Alte Zeile", seriesCode: null },
    { id: 21, position: 11, name: "Unbekannte Serie", seriesCode: "ZZ" },
  ];

  it("SA → G → SF → T → SC → I, ohne Serie zuletzt", () => {
    expect(sortPurchaseItemsBySeries(ITEMS, POSITIONS).map((i) => i.seriesCode))
      .toEqual(["SA", "SA", "G", "SF", "T", "T", "SC", "I", null, null, "ZZ"]);
  });

  it("innerhalb einer Serie nach Name, bei gleichem Namen nach Position", () => {
    const sortiert = sortPurchaseItemsBySeries(ITEMS, POSITIONS);
    expect(sortiert.slice(0, 2).map((i) => i.name)).toEqual(["Eruptor", "Spyro"]);
    expect(sortiert.filter((i) => i.name === "Wash Buckler").map((i) => i.position))
      .toEqual([2, 9]);
  });

  it("ohne oder mit unbekannter Serie: ein Block am Ende, in Erfassungsreihenfolge", () => {
    const rest = sortPurchaseItemsBySeries(ITEMS, POSITIONS).slice(-3);
    expect(rest.map((i) => i.position)).toEqual([3, 10, 11]);
    expect(seriesRank(null, POSITIONS)).toBe(UNKNOWN_SERIES);
    expect(seriesRank("ZZ", POSITIONS)).toBe(UNKNOWN_SERIES);
  });

  it("stabil: jede Eingabereihenfolge ergibt dieselbe Liste", () => {
    const erwartet = sortPurchaseItemsBySeries(ITEMS, POSITIONS).map((i) => i.id);
    expect(sortPurchaseItemsBySeries([...ITEMS].reverse(), POSITIONS).map((i) => i.id))
      .toEqual(erwartet);
  });

  it("nur Darstellung: keine Position fehlt, keine ändert sich", () => {
    const mitDaten = ITEMS.map((i) => ({ ...i, quantity: 1, marketPrice: 9.5, state: "arrived" }));
    const vorher = structuredClone(mitDaten);
    const sortiert = sortPurchaseItemsBySeries(mitDaten, POSITIONS);
    expect(sortiert).toHaveLength(mitDaten.length);
    /* Dieselben Objekte, unverändert — Identität, Position, Preis, Zustand. */
    for (const item of sortiert) {
      expect(item).toEqual(vorher.find((v) => v.id === item.id));
    }
    /* Und die Eingabe selbst ist nicht umgestellt worden. */
    expect(mitDaten).toEqual(vorher);
  });

  it("ohne Serientabelle (Ladefehler) bleibt die Erfassungsreihenfolge", () => {
    expect(sortPurchaseItemsBySeries(ITEMS, new Map()).map((i) => i.position))
      .toEqual(ITEMS.map((i) => i.position));
  });

  it("die eine Stelle ist `fetchPurchase` — Detailseite, Ledger und Nachlesen", () => {
    const queries = readFileSync("src/lib/orderbook/queries.ts", "utf8");
    const fetchPurchase = queries.slice(queries.indexOf("export const fetchPurchase"),
      queries.indexOf("export const fetchPurchaseYears"));
    expect(fetchPurchase).toContain("sortPurchaseItemsBySeries(");
  });

  it("ein gespeicherter Verkauf behält seine Eingabereihenfolge", () => {
    for (const datei of ["src/lib/orderbook/sales-queries.ts", "src/lib/orderbook/sales-actions.ts",
      "src/lib/orderbook/sales-view.ts", "src/components/business/sale-items.tsx",
      "src/components/business/sales-ledger.tsx", "src/components/business/figure-draft.tsx"]) {
      const quelle = readFileSync(datei, "utf8");
      expect(quelle.includes("sortPurchaseItemsBySeries"), datei).toBe(false);
      expect(quelle.includes("series-order"), datei).toBe(false);
    }
  });
});

/* ===================================================================== */
describe("FIX 3 — Einkauf während der Erfassung: neueste oben", () => {
  const wahl = (skyId: string) => KATALOG.find((c) => c.skyId === skyId)!;
  const tippe = (...skyIds: string[]) => skyIds.reduce<PurchaseDraftLine[]>(
    (lines, id) => addPurchaseFigure(lines, wahl(id)), []);

  it("die zuletzt hinzugefügte Figur steht oben", () => {
    const lines = tippe("SKY-0001", "SKY-0142", "SKY-0500");
    expect(purchaseDraftDisplayOrder(lines).map((l) => l.skyId))
      .toEqual(["SKY-0500", "SKY-0142", "SKY-0001"]);
  });

  it("nicht nach Serie — die Erfassung folgt der Hand, nicht dem Katalog", () => {
    const lines = tippe("SKY-0500", "SKY-0001");
    expect(purchaseDraftDisplayOrder(lines).map((l) => l.series)).toEqual(["SA", "I"]);
    const andersrum = tippe("SKY-0001", "SKY-0500");
    expect(purchaseDraftDisplayOrder(andersrum).map((l) => l.series)).toEqual(["I", "SA"]);
  });

  it("nur die Anzeige: die Nutzlast bleibt in Erfassungsreihenfolge", () => {
    const lines = tippe("SKY-0001", "SKY-0142", "SKY-0142", "SKY-0500");
    const vorher = structuredClone(lines);
    purchaseDraftDisplayOrder(lines);
    expect(lines).toEqual(vorher);
    expect(purchaseDraftPayload(lines).map((p) => p.sky_id))
      .toEqual(["SKY-0001", "SKY-0142", "SKY-0142", "SKY-0500"]);
  });

  it("eine weitere Einheit derselben Figur bleibt in ihrer Zeile", () => {
    const lines = tippe("SKY-0001", "SKY-0142", "SKY-0001");
    expect(purchaseDraftDisplayOrder(lines).map((l) => [l.skyId, l.quantity]))
      .toEqual([["SKY-0142", 1], ["SKY-0001", 2]]);
  });

  it("die Vorbelegung aus einer Kalkulation behält ihre Reihenfolge, Getipptes steht darüber", () => {
    const vorbelegt = purchaseDraftFromUnits(KATALOG, [
      { skyId: "SKY-0500", quantity: 1 }, { skyId: "SKY-0001", quantity: 1 },
    ]);
    const prefilled = new Set(vorbelegt.map((l) => l.key));
    let lines = addPurchaseFigure(vorbelegt, wahl("SKY-0142"));
    lines = addPurchaseFigure(lines, wahl("SKY-0290"));
    expect(purchaseDraftDisplayOrder(lines, prefilled).map((l) => l.skyId))
      .toEqual(["SKY-0290", "SKY-0142", "SKY-0500", "SKY-0001"]);
  });

  it("eine abgetrennte Einheit einer getippten Zeile bleibt neben ihr", () => {
    let lines = tippe("SKY-0001", "SKY-0142", "SKY-0142", "SKY-0500");
    const pop = lines.find((l) => l.skyId === "SKY-0142")!.key;
    lines = splitPurchaseUnit(lines, pop);
    expect(purchaseDraftDisplayOrder(lines).map((l) => [l.skyId, l.quantity]))
      .toEqual([["SKY-0500", 1], ["SKY-0142", 1], ["SKY-0142", 1], ["SKY-0001", 1]]);
  });

  it("und einer vorbelegten Zeile ebenso — sie springt nicht an den Anfang", () => {
    const vorbelegt = purchaseDraftFromUnits(KATALOG, [
      { skyId: "SKY-0500", quantity: 2 }, { skyId: "SKY-0001", quantity: 1 },
    ]);
    const prefilled = new Set(vorbelegt.map((l) => l.key));
    let lines = addPurchaseFigure(vorbelegt, wahl("SKY-0142"));
    lines = splitPurchaseUnit(lines, vorbelegt[0].key);
    expect(purchaseDraftDisplayOrder(lines, prefilled).map((l) => l.skyId))
      .toEqual(["SKY-0142", "SKY-0500", "SKY-0500", "SKY-0001"]);
  });

  it("auch die LETZTE vorbelegte Zeile behält ihre abgetrennte Einheit bei sich", () => {
    const vorbelegt = purchaseDraftFromUnits(KATALOG, [
      { skyId: "SKY-0500", quantity: 1 }, { skyId: "SKY-0001", quantity: 2 },
    ]);
    const prefilled = new Set(vorbelegt.map((l) => l.key));
    let lines = addPurchaseFigure(vorbelegt, wahl("SKY-0142"));
    lines = splitPurchaseUnit(lines, vorbelegt[1].key);
    expect(purchaseDraftDisplayOrder(lines, prefilled).map((l) => l.skyId))
      .toEqual(["SKY-0142", "SKY-0500", "SKY-0001", "SKY-0001"]);
  });

  it("keine Zeile geht verloren — auch nach Abtrennen und Mengenänderung", () => {
    let lines = tippe("SKY-0001", "SKY-0001", "SKY-0142");
    lines = splitPurchaseUnit(lines, lines[0].key);
    lines = setPurchaseQuantity(lines, lines[1].key, 4);
    const shown = purchaseDraftDisplayOrder(lines);
    expect(shown).toHaveLength(lines.length);
    expect(new Set(shown.map((l) => l.key))).toEqual(new Set(lines.map((l) => l.key)));
  });
});
