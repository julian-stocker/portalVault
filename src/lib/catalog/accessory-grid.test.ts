/**
 * DER ZUBEHÖRKATALOG ALS KACHELKATALOG (ADR-0128).
 *
 * Vier Teile, und jeder prüft etwas, das man sonst nur sieht:
 *
 *   1. die Mehrfachzuordnung — `SKY-0637` gilt für drei Serien, steht aber
 *      unter einer; die Serienleiste muss es unter allen dreien zeigen;
 *   2. die Sortierung — vier Ordnungen, jede stabil, keine verändert ihre
 *      Eingabe;
 *   3. die Kachel — Bildbühne ohne erfundenes Foto, kein Sammelknopf, kein
 *      Besitzsiegel, Angebotsstelle vorhanden;
 *   4. das Raster und die Bedienung am Telefon.
 *
 * Die Trennung Katalog/Lager/Sammlung steht in `accessory-area.test.ts`,
 * Navigation und Ableitungen in `accessory-tab.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { inSeries, seriesScopeOf } from "./accessory-facts.ts";
import {
  accessorySeriesPresent, visibleAccessories, NO_ACCESSORY_FILTERS,
} from "./accessory-filter.ts";
import { ACCESSORY_SORTS, isAccessorySort, sortAccessories } from "./accessory-sort.ts";
import type { CatalogFigure } from "@/lib/catalog/types";
import { buildSearchIndex } from "@/lib/catalog/search";
import { de } from "@/lib/i18n/de";

const read = (p: string) => readFileSync(p, "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const VIEW = "src/components/catalog/accessory-view.tsx";
const CARD = "src/components/catalog/accessory-card.tsx";
const FIGURE_CARD = "src/components/catalog/figure-card.tsx";
const FIGURE_GRID = "src/components/catalog/figure-grid.tsx";

/** Die sechs Serien, wie `fetchSeries()` sie liefert. */
const SERIEN = [
  { code: "SA", label: "Spyro's Adventure" },
  { code: "G", label: "Giants" },
  { code: "SF", label: "Swap Force" },
  { code: "T", label: "Trap Team" },
  { code: "SC", label: "SuperChargers" },
  { code: "I", label: "Imaginators" },
];
const BEKANNT = new Set(SERIEN.map((s) => s.code));
const POSITION = new Map(SERIEN.map((s, i) => [s.code, i]));

function artikel(over: Partial<CatalogFigure> = {}): CatalogFigure {
  const name = over.canonicalName ?? over.displayName ?? "X";
  const serie = over.seriesCode ?? "SA";
  return {
    skyId: "SKY-0001", name, slug: "x",
    seriesCode: serie,
    seriesLabel: SERIEN.find((s) => s.code === serie)?.label ?? serie,
    seriesPosition: POSITION.get(serie) ?? 0,
    categoryPosition: 0, categoryName: "Spiele", categoryId: 1,
    catalogGroup: null, cardType: "standard", catalogVisible: true, canonicalName: name,
    displayNameOverride: null, marketPrice: null, imageFile: null, imageOverridePath: null,
    displayName: over.displayName ?? name, sortBaseName: name, sortVariantLabel: null,
    searchIndex: buildSearchIndex([name]), isActive: true, element: null,
    characterId: null, itemType: "game", ...over,
  };
}

const portal = (over: Partial<CatalogFigure> = {}) => artikel({ itemType: "portal", ...over });
const spiel = (over: Partial<CatalogFigure> = {}) => artikel({ itemType: "game", ...over });

/* ===================================================================== */
describe("1. ein Portal kann für mehrere Serien gelten", () => {
  it("SKY-0637 gilt für SF, T und SC — und steht unter SF", () => {
    /*
     * Der reale Fall: `84721790 (SF, T, SC)`. `skylanders.series_code` ist
     * einwertig und trägt einen Fremdschlüssel, also steht dort `SF`. Die
     * vollständige Zuordnung blieb im Rohnamen — und wird von dort gelesen,
     * statt eine Spalte zu bauen, die niemand pflegt.
     */
    const p = portal({ skyId: "SKY-0637", canonicalName: "84721790 (SF, T, SC)",
      seriesCode: "SF" });
    expect(seriesScopeOf(p, BEKANNT)).toEqual(["SF", "T", "SC"]);
    for (const serie of ["SF", "T", "SC"]) expect(inSeries(p, serie, BEKANNT)).toBe(true);
    /* Und nicht unter den übrigen. */
    for (const serie of ["SA", "G", "I"]) expect(inSeries(p, serie, BEKANNT)).toBe(false);
  });

  it("die eingeordnete Serie steht immer vorn, auch wenn die Klammer sie nicht nennt", () => {
    const p = portal({ canonicalName: "84721790 (T)", seriesCode: "SF" });
    expect(seriesScopeOf(p, BEKANNT)).toEqual(["SF", "T"]);
    /* Die gespeicherte Wahrheit wird nicht überstimmt, nur ergänzt. */
    expect(seriesScopeOf(p, BEKANNT)[0]).toBe("SF");
  });

  it("ALLES ODER NICHTS: ein unbekannter Eintrag verwirft die ganze Klammer", () => {
    /* Eine halb verstandene Klammer ist keine Zuordnung. `(SF, XX)` könnte
       „SF und etwas" heissen oder „etwas ganz anderes" — geraten wird
       nicht. */
    const p = portal({ canonicalName: "84721790 (SF, XX)", seriesCode: "SF" });
    expect(seriesScopeOf(p, BEKANNT)).toEqual(["SF"]);
  });

  it("ein SPIEL wird nie über seine Klammer zugeordnet", () => {
    /*
     * Die Klammer eines Spiels trägt die Plattform, nicht die Serie. `(PC)`
     * ist kein Seriencode — aber `(T)` wäre einer, und ein Spiel mit `(T)`
     * im Namen dürfte trotzdem nicht nach Trap Team wandern.
     */
    const g = spiel({ canonicalName: "Skylanders Spiel (T)", seriesCode: "SA" });
    expect(seriesScopeOf(g, BEKANNT)).toEqual(["SA"]);
    expect(inSeries(g, "T", BEKANNT)).toBe(false);
  });

  it("ohne bekannte Codes gilt allein series_code", () => {
    /* Der Rückfall für jeden Aufrufer, der die Serienliste nicht kennt. */
    const p = portal({ canonicalName: "84721790 (SF, T, SC)", seriesCode: "SF" });
    expect(seriesScopeOf(p, new Set())).toEqual(["SF"]);
  });

  it("die Serienleiste bietet T an, obwohl kein Artikel unter T eingeordnet ist", () => {
    const items = [portal({ canonicalName: "84721790 (SF, T, SC)", seriesCode: "SF" })];
    expect(accessorySeriesPresent(items, SERIEN).map((s) => s.code))
      .toEqual(["SF", "T", "SC"]);
  });

  it("und die Auswahl von T zeigt das Portal wirklich", () => {
    const p = portal({ skyId: "SKY-0637", canonicalName: "84721790 (SF, T, SC)",
      seriesCode: "SF" });
    const andere = portal({ skyId: "SKY-0638", canonicalName: "84709790 (SF)",
      seriesCode: "SF" });
    const gefiltert = visibleAccessories([p, andere],
      { ...NO_ACCESSORY_FILTERS, seriesCode: "T" }, BEKANNT);
    expect(gefiltert.map((i) => i.skyId)).toEqual(["SKY-0637"]);
  });
});

/* ===================================================================== */
describe("2. die Sortierung", () => {
  const liste = [
    spiel({ skyId: "SKY-0900", displayName: "Skylanders Giants – Wii", seriesCode: "G",
      canonicalName: "Skylanders Giants Wii Spiel" }),
    portal({ skyId: "SKY-0637", displayName: "84721790", seriesCode: "SF",
      canonicalName: "84721790 (SF)" }),
    spiel({ skyId: "SKY-0901", displayName: "Skylanders Trap Team – PS3", seriesCode: "T",
      canonicalName: "Skylanders Trap Team PS3 Spiel" }),
  ];

  it("vier Ordnungen, und nur die vier", () => {
    expect([...ACCESSORY_SORTS]).toEqual(["name", "series", "platform", "kind"]);
    for (const s of ACCESSORY_SORTS) expect(isAccessorySort(s)).toBe(true);
    expect(isAccessorySort("preis")).toBe(false);
    expect(isAccessorySort(undefined)).toBe(false);
    /* Jede trägt ein deutsches Wort — ohne Wort ist sie nicht wählbar. */
    for (const s of ACCESSORY_SORTS) expect(de.accessories.sorts[s]).toBeTruthy();
  });

  it("verändert die übergebene Liste NICHT", () => {
    /* Eine Ansicht, die ihre Eingabe umsortiert, hat eine Reihenfolge, die
       davon abhängt, wie oft sie gerendert wurde. */
    const vorher = liste.map((i) => i.skyId);
    for (const s of ACCESSORY_SORTS) sortAccessories(liste, s);
    expect(liste.map((i) => i.skyId)).toEqual(vorher);
  });

  it("nach Serie: die Katalogordnung, nicht das Alphabet", () => {
    /* `Giants` vor `Swap Force` vor `Trap Team` — über `seriesPosition`.
       Alphabetisch nach Code wäre es `G, SF, T` zufällig richtig, nach
       Etikett `Giants, Swap Force, Trap Team` auch; der Fall, der sie
       trennt, ist `SA` (Spyro's Adventure) vor `G` (Giants). */
    const sa = spiel({ skyId: "SKY-0902", displayName: "Zzz", seriesCode: "SA" });
    expect(sortAccessories([...liste, sa], "series").map((i) => i.seriesCode))
      .toEqual(["SA", "G", "SF", "T"]);
  });

  it("nach Name: alphabetisch, Zahlen als Zahlen", () => {
    const namen = sortAccessories(liste, "name").map((i) => i.displayName);
    expect(namen[0]).toBe("84721790");
    /* `numeric`: `0000502` steht vor `84157790`, nicht dahinter. */
    const zahlen = [portal({ skyId: "SKY-0001", displayName: "84157790" }),
      portal({ skyId: "SKY-0002", displayName: "0000502" })];
    expect(sortAccessories(zahlen, "name").map((i) => i.displayName))
      .toEqual(["0000502", "84157790"]);
  });

  it("nach Plattform: ohne Plattform ans Ende", () => {
    /* Ein Portal hat keine Plattform (sie wird nicht geraten), und eine
       Reihe Portale unter der Überschrift „Plattform" wäre irreführend. */
    const sortiert = sortAccessories(liste, "platform");
    expect(sortiert[sortiert.length - 1]!.itemType).toBe("portal");
  });

  it("nach Art: Spiele vor Portalen, in der Reihenfolge von ITEM_TYPES", () => {
    const arten = sortAccessories(liste, "kind").map((i) => i.itemType);
    expect(arten).toEqual(["game", "game", "portal"]);
  });

  it("ist stabil: gleicher Schlüssel heisst immer dieselbe Stelle", () => {
    /* Zwei Spiele derselben Plattform, in beiden Eingabereihenfolgen —
       dasselbe Ergebnis. Sonst springt die Ansicht beim Tippen. */
    const a = spiel({ skyId: "SKY-0010", displayName: "A", canonicalName: "A PS3 Spiel" });
    const b = spiel({ skyId: "SKY-0011", displayName: "B", canonicalName: "B PS3 Spiel" });
    expect(sortAccessories([a, b], "platform").map((i) => i.skyId))
      .toEqual(sortAccessories([b, a], "platform").map((i) => i.skyId));
  });
});

/* ===================================================================== */
describe("3. die Kachel", () => {
  const card = code(CARD);

  it("hat eine Bildbühne mit festem Seitenverhältnis", () => {
    /* Damit das Raster ruhig bleibt, heute ohne Bild und später mit: ein
       Produktfoto fällt genau hierhin, ohne dass sich etwas verschiebt. */
    expect(card).toContain("aspect-[4/3]");
    expect(card).toContain("bg-plate");
  });

  it("und KEIN erfundenes Produktbild", () => {
    /*
     * Auf der Bühne steht die Art in Lettern — `SPIEL`, `PORTAL`. Das ist
     * Schrift und keine Aufnahme; niemand hält es für ein Foto. Eine graue
     * Fläche mit Kamerasymbol hätte behauptet, hier fehle etwas.
     */
    expect(card).not.toContain("<img");
    expect(card).not.toContain("next/image");
    expect(card).not.toContain("placeholder");
    expect(card).toContain("markLabels[art]");
  });

  it("trägt keinen Sammelknopf und kein Besitzsiegel", () => {
    for (const bauteil of ["CollectChip", "setCollected", "owned", "Besitz", "progress"]) {
      expect(card, bauteil).not.toContain(bauteil);
    }
  });

  it("nennt Name, Art, Serie, Plattform oder Modell und die SKY-ID", () => {
    expect(card).toContain("item.displayName");
    expect(card).toContain("markLabels[art]");
    expect(card).toContain("item.seriesLabel");
    expect(card).toContain("accessoryDetail");
    expect(card).toContain("item.skyId");
  });

  it("hat eine Angebotsstelle, und sie sagt heute das Fehlen", () => {
    expect(card).toContain("copy.noOffer");
    expect(card).toContain("formatPrice");
    expect(de.accessories.noOffer).toBe("Aktuell kein Angebot");
  });

  it("nennt die weiteren Serien eines mehrfach zugeordneten Portals", () => {
    expect(card).toContain("copy.alsoFor");
    expect(de.accessories.alsoFor("Trap Team, SuperChargers"))
      .toBe("auch Trap Team, SuperChargers");
  });

  it("und die Figurenkarte bleibt unberührt", () => {
    /*
     * Der Sinn eines eigenen Kacheldesigns: `FigureCard` muss nicht
     * nachgeben. Geprüft wird, dass die Zubehörkachel nichts davon
     * benutzt — und dass die Figurenkarte nichts von Zubehör weiss.
     */
    for (const bauteil of ["FigureCard", "CatalogCard", "figure-card"]) {
      expect(card, bauteil).not.toContain(bauteil);
    }
    const figur = code(FIGURE_CARD);
    for (const bauteil of ["AccessoryCard", "accessory", "itemType"]) {
      expect(figur, bauteil).not.toContain(bauteil);
    }
  });
});

/* ===================================================================== */
describe("4. das Raster und die Bedienung am Telefon", () => {
  const view = code(VIEW);

  it("dasselbe Raster wie der Figurenkatalog", () => {
    /* Zwei Kacheln auf dem Telefon, drei ab `sm:`, vier ab `md:` — Zeichen
       für Zeichen die Klassen aus `figure-grid.tsx`, damit die beiden
       Bereiche nicht auseinanderlaufen. */
    const raster = "grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4";
    expect(view).toContain(raster);
    expect(code(FIGURE_GRID)).toContain(raster);
  });

  it("die Serienleiste ist dieselbe Komponente wie im Figurenkatalog", () => {
    /* Also waagrecht scrollbar und nie umbrechend — das steckt in
       `FilterBar variant=„nav“` und wird dort geprüft. */
    expect(view).toContain('variant="nav"');
    expect(view).toContain("FilterBar");
  });

  it("mit einem echten Eintrag „Alle Serien“", () => {
    /* Der eine Unterschied zum Figurenkatalog: dort ist immer ein Spiel
       gewählt, weil 561 Figuren auf einmal eine Wand sind. 60 Artikel sind
       keine Wand. */
    expect(view).toContain("copy.seriesAll");
    expect(de.accessories.seriesAll).toBe("Alle Serien");
  });

  it("jedes Bedienelement ist mindestens 40 px hoch", () => {
    /* Suche 48 px, Auswahlfelder 40 px. Ein 32-px-Feld trifft man am
       Telefon nicht. */
    expect(view).toContain("min-h-12");                       // Suche
    expect(view.match(/min-h-10/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("und ein Feld erscheint nur, wenn es mehr als eine Wahl hat", () => {
    /* Ein Knopf ohne Treffer ist eine Sackgasse, und vier Felder
       nebeneinander sind auf dem Telefon eine Wand. */
    expect(view).toContain("types.length > 1");
    expect(view).toContain("platforms.length > 1");
    expect(view).toContain("seriesOptions.length > 1");
  });

  it("die Filter wirken zusammen, nicht nacheinander", () => {
    /* „Portale der Serie SF mit 84 im Namen" ist eine Frage mit einer
       Antwort. */
    const treffer = visibleAccessories(
      [portal({ skyId: "SKY-0637", canonicalName: "84721790 (SF)", seriesCode: "SF" }),
        portal({ skyId: "SKY-0640", canonicalName: "12345 (SF)", seriesCode: "SF" }),
        spiel({ skyId: "SKY-0900", canonicalName: "84er Spiel PS3", seriesCode: "SF" })],
      { query: "84", seriesCode: "SF", type: "portal", platform: "" }, BEKANNT);
    expect(treffer.map((i) => i.skyId)).toEqual(["SKY-0637"]);
  });
});
