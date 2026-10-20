/**
 * DER ZUBEHÖRTAB: Navigation, Plattform, Modell — und die Freigabe (ADR-0128).
 *
 * Was hier geprüft wird, hat drei Teile:
 *
 *   1. die oberste Katalognavigation — zwei Bereiche, eine Leiste, zwei
 *      Seiten, und der aktive ist erkennbar;
 *   2. die abgeleiteten Angaben — Plattform aus dem Rohnamen eines Spiels,
 *      Modellnummer aus dem eines Portals, nie geraten;
 *   3. die vorbereitete Freigabe der 21 Portale, und dass sie sichtbar
 *      macht, ohne sammelbar oder verkäuflich zu machen.
 *
 * Die Trennung Katalog/Lager/Sammlung steht in `accessory-area.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  PLATFORM_LABELS, accessoryDetail, modelOf, platformOf, platformsPresent,
} from "./accessory-facts.ts";
import {
  matchesAccessoryFilters, visibleAccessories, NO_ACCESSORY_FILTERS,
  type AccessoryFilters,
} from "./accessory-filter.ts";
import type { CatalogFigure } from "@/lib/catalog/types";
import { buildSearchIndex } from "@/lib/catalog/search";
import { de } from "@/lib/i18n/de";

const read = (p: string) => readFileSync(p, "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const TABS = "src/components/catalog/area-tabs.tsx";
const VIEW = "src/components/catalog/accessory-view.tsx";
const CATALOG_VIEW = "src/components/catalog/catalog-view.tsx";
const RELEASE = "supabase/operations/staging-portal-release.sql";
const RELEASE_BACK = "supabase/rollback/R_portal_release.sql";

function artikel(over: Partial<CatalogFigure> = {}): CatalogFigure {
  const name = over.canonicalName ?? over.displayName ?? "X";
  return {
    skyId: "SKY-0001", name, slug: "x", seriesCode: "SA", seriesLabel: "Spyro's Adventure",
    seriesPosition: 0, categoryPosition: 0, categoryName: "Spiele", categoryId: 1,
    catalogGroup: null, cardType: "standard", catalogVisible: true, canonicalName: name,
    displayNameOverride: null, marketPrice: null, imageFile: null, imageOverridePath: null,
    displayName: over.displayName ?? name, sortBaseName: name, sortVariantLabel: null,
    searchIndex: buildSearchIndex([name]), isActive: true, element: null,
    characterId: null, itemType: "game", ...over,
  };
}

/* ===================================================================== */
describe("1. die oberste Katalognavigation", () => {
  it("zwei Bereiche, und sie führen auf die zwei Seiten", () => {
    const tabs = code(TABS);
    expect(tabs).toContain('href: "/"');
    expect(tabs).toContain('href: "/zubehoer"');
    expect(de.catalog.areaFigures).toBe("Figuren");
    expect(de.catalog.areaAccessories).toBe("Zubehör");
  });

  it("Verweise, keine Knöpfe — ein Bereich gehört in die Adresszeile", () => {
    /* Teilbar, als Lesezeichen brauchbar, und der Zurück-Knopf tut, was er
       soll. Ein `onClick`, der den Bereich wechselt, könnte das nicht. */
    expect(code(TABS)).toContain("<Link");
    expect(code(TABS)).not.toContain("onClick");
    expect(code(TABS)).not.toContain("useState");
  });

  it("der aktive Bereich ist für Auge UND Hilfstechnik erkennbar", () => {
    const tabs = code(TABS);
    /* Nicht nur Farbe: `aria-current` sagt es auch dem, dem die Farbe
       nichts sagt. */
    expect(tabs).toContain('aria-current={isActive ? "page" : undefined}');
    expect(tabs).toContain("bg-status-ground font-semibold text-status-ink");
  });

  it("sie ist auf dem Telefon bedienbar und bricht nicht um", () => {
    const tabs = code(TABS);
    expect(tabs).toContain("min-h-11");          // 44 px Tippfläche
    expect(tabs).toContain("no-scrollbar");      // waagrecht scrollbar wie die Serienleiste
    expect(tabs).toContain("whitespace-nowrap");
  });

  it("beide Seiten tragen sie, mit dem jeweils eigenen aktiven Eintrag", () => {
    expect(code(CATALOG_VIEW)).toContain('<CatalogAreaTabs active="figures" />');
    expect(code(VIEW)).toContain('<CatalogAreaTabs active="accessories" />');
  });

  it("und sie steht ÜBER der Serienleiste, nicht daneben", () => {
    /* Erst WAS, dann welches Spiel, dann welche Gruppe. */
    const v = code(CATALOG_VIEW);
    expect(v.indexOf("CatalogAreaTabs active=")).toBeLessThan(v.indexOf("<SeriesTabs"));
  });

  it("und nicht in der Hauptnavigation", () => {
    /* Die hat drei Ziele und behält sie (ADR-0036). */
    expect(code("src/components/layout/site-nav.tsx")).not.toContain("/zubehoer");
  });
});

/* ===================================================================== */
describe("2. Plattform und Modell, abgeleitet aus dem Rohnamen", () => {
  /** Die neun Rohnamenformen, die auf Staging wirklich vorkommen. */
  const SPIELE: [string, string][] = [
    ["Game (PC)", "PC"],
    ["Game (Xbox 360)", "Xbox 360"],
    ["Game (Nintendo 3DS)", "Nintendo 3DS"],
    ["Game (Nintendo Switch)", "Nintendo Switch"],
    ["Spiel für Sony Playstation 3 PS3", "PS3"],
    ["Spiel für Sony Playstation 4 PS4", "PS4"],
    ["Spiel für Xbox One", "Xbox One"],
    ["Spiel für Xbox One (EN)", "Xbox One"],
    ["Wii Spiel", "Wii"],
    ["Wii U Spiel", "Wii U"],
    ["Skylanders Spyro's Adventure Wii Spiel", "Wii"],
  ];

  it("jede der elf Rohnamenformen ergibt genau eine Plattform", () => {
    for (const [roh, erwartet] of SPIELE) {
      expect(platformOf(artikel({ canonicalName: roh })), roh).toBe(erwartet);
    }
  });

  it("„Wii U“ wird nicht zu „Wii“, und „Playstation 3“ nicht zu „PS4“", () => {
    /* Die Reihenfolge der Liste IST die Logik — längste zuerst. */
    expect(platformOf(artikel({ canonicalName: "Wii U Spiel" }))).toBe("Wii U");
    expect(platformOf(artikel({ canonicalName: "Spiel für Sony Playstation 3 PS3" })))
      .toBe("PS3");
  });

  it("und ein Wort trifft nur als ganzes Wort", () => {
    /* `PC` darf nicht in `PCX` treffen. */
    expect(platformOf(artikel({ canonicalName: "Spiel PCX" }))).toBeNull();
    expect(platformOf(artikel({ canonicalName: "Game (PC)" }))).toBe("PC");
  });

  it("kein Treffer heisst KEINE Angabe — es wird nie geraten", () => {
    expect(platformOf(artikel({ canonicalName: "Irgendein Spiel" }))).toBeNull();
    expect(accessoryDetail(artikel({ canonicalName: "Irgendein Spiel" }))).toBeNull();
  });

  it("ein Portal hat keine Plattform — die Mappe führt nur eine Lesehilfe", () => {
    /*
     * ADR-0128, Punkt 5: die Plattformköpfe der Arbeitsmappe sind eine
     * dokumentierte Zuordnung, keine nachgewiesene Kompatibilität, und
     * gespeichert ist davon nichts. Etwas anzuzeigen, das nirgends steht,
     * wäre eine Erfindung.
     */
    const portal = artikel({ itemType: "portal", canonicalName: "84709790 (SF)" });
    expect(platformOf(portal)).toBeNull();
  });

  it("dafür hat es eine Modellnummer, rein strukturell gelesen", () => {
    const m = (n: string) => modelOf(artikel({ itemType: "portal", canonicalName: n }));
    expect(m("84709790 (SF)")).toBe("84709790");
    expect(m("83973080A Wireless (SA)")).toBe("83973080A Wireless");
    expect(m("84721790 (SF, T, SC)")).toBe("84721790");
    /* Ohne Klammer keine Angabe — kein Muster über den Inhalt. */
    expect(m("Portal ohne Klammer")).toBeNull();
  });

  it("ein Spiel hat kein Modell, eine Figur weder noch", () => {
    expect(modelOf(artikel({ canonicalName: "Game (PC)" }))).toBeNull();
    const figur = artikel({ itemType: "figure", canonicalName: "Bash" });
    expect(platformOf(figur)).toBeNull();
    expect(modelOf(figur)).toBeNull();
  });

  it("die Zeile zeigt eines von beiden — dieselbe Frage, dasselbe Feld", () => {
    expect(accessoryDetail(artikel({ canonicalName: "Wii U Spiel" }))).toBe("Wii U");
    expect(accessoryDetail(artikel({ itemType: "portal", canonicalName: "0000502 (G)" })))
      .toBe("0000502");
  });

  it("und nichts davon wird gespeichert", () => {
    /* ADR-0128 hat `platforms` und `model_no` bewusst nicht gebaut. */
    const facts = code("src/lib/catalog/accessory-facts.ts");
    expect(facts).not.toContain("insert");
    expect(facts).not.toContain("update");
    expect(facts).not.toContain("supabase");
    const mig = read("supabase/migrations/0138_catalog_portals.sql");
    expect(mig).not.toContain("add column platforms");
    expect(mig).not.toContain("add column model_no");
  });
});

/* ===================================================================== */
describe("2b. der Plattformfilter", () => {
  const PS3 = artikel({ skyId: "SKY-0110", canonicalName: "Spiel für Sony Playstation 3 PS3" });
  const WIIU = artikel({ skyId: "SKY-0113", canonicalName: "Wii U Spiel" });
  const PORTAL = artikel({
    skyId: "SKY-0632", itemType: "portal", canonicalName: "84709790 (SF)",
    categoryName: "Portale", seriesCode: "SF",
  });
  const LISTE = [PS3, WIIU, PORTAL];
  const mit = (o: Partial<AccessoryFilters>): AccessoryFilters =>
    ({ ...NO_ACCESSORY_FILTERS, ...o });

  it("bietet nur Plattformen an, die vorkommen", () => {
    expect(platformsPresent(LISTE)).toEqual(["PS3", "Wii U"]);
    expect(platformsPresent([PORTAL])).toEqual([]);
  });

  it("in der Reihenfolge der Liste, nicht der Daten", () => {
    expect(platformsPresent([WIIU, PS3])).toEqual(["PS3", "Wii U"]);
    expect(PLATFORM_LABELS.indexOf("PS3")).toBeLessThan(PLATFORM_LABELS.indexOf("Wii U"));
  });

  it("filtert, und blendet dabei Portale aus — wer PS3 wählt, sucht ein Spiel", () => {
    expect(visibleAccessories(LISTE, mit({ platform: "PS3" })).map((i) => i.skyId))
      .toEqual(["SKY-0110"]);
    expect(matchesAccessoryFilters(PORTAL, mit({ platform: "PS3" }))).toBe(false);
  });

  it("und die Suche findet die Plattform, auch wenn sie so nirgends geschrieben steht", () => {
    /* Der Rohname sagt `Sony Playstation 3 PS3`, die Zeile zeigt `PS3`. */
    expect(visibleAccessories(LISTE, mit({ query: "PS3" })).map((i) => i.skyId))
      .toEqual(["SKY-0110"]);
  });

  it("das Feld erscheint erst ab zwei Plattformen", () => {
    expect(code(VIEW)).toContain("platforms.length > 1 ? (");
  });
});

/* ===================================================================== */
describe("3. die Darstellung kommt ohne Bilder aus", () => {
  it("keine Bildfläche, kein Platzhalter, der wie ein Produktfoto aussieht", () => {
    const view = code(VIEW);
    for (const bauteil of ["FigureImage", "AdminThumb", "<img", "next/image", "imageSrc"]) {
      expect(view, bauteil).not.toContain(bauteil);
    }
  });

  it("die Marke auf einer Zeile steht in der EINZAHL", () => {
    /* „Spiele" auf einer einzelnen Zeile behauptet, sie sei mehrere. Die
       Mehrzahl gehört in den Filter, der eine Menge wählt. */
    const view = code(VIEW);
    expect(view).toContain("const markLabels = de.inventory.itemTypes;");
    expect(view).toContain("const filterLabels = de.inventory.kinds;");
    expect(de.inventory.itemTypes.game).toBe("Spiel");
    expect(de.inventory.kinds.game).toBe("Spiele");
  });

  it("stattdessen trägt die Zeile ihre Angaben", () => {
    const view = code(VIEW);
    expect(view).toContain("<TypeMark");          // Art
    expect(view).toContain("item.displayName");   // Name
    expect(view).toContain("item.seriesLabel");   // Serie
    expect(view).toContain("detailVon(item)");    // Plattform oder Modell
    expect(view).toContain("item.skyId");
  });

  it("zwei Zeilen, und auf dem Telefon bricht nichts waagrecht aus", () => {
    const view = code(VIEW);
    expect(view).toContain("flex-wrap");
    expect(view).toContain("truncate");
    expect(view).toContain("lg:grid-cols-2");
  });
});

/* ===================================================================== */
describe("4. die vorbereitete Freigabe der 21 Portale", () => {
  const sql = read(RELEASE);

  it("nennt genau 21 SKY-IDs, ausgeschrieben", () => {
    const ids = [...sql.matchAll(/\('(SKY-\d{4})'\)/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(21);
    expect(ids).toContain("SKY-0615");
    expect(ids).toContain("SKY-0637");
    /* Die beiden Disney-Infinity-Nummern und die Beleg-URL stehen NICHT
       darin (ADR-0128, Punkt 9). */
    for (const fremd of ["SKY-0623", "SKY-0631", "SKY-0638", "SKY-0639"]) {
      expect(ids, fremd).not.toContain(fremd);
    }
  });

  it("setzt eine Spalte, und nur auf Portalzeilen", () => {
    expect(sql).toContain("set catalog_visible = true");
    expect(sql).toContain("and s.item_type = 'portal'");
  });

  it("und schreibt sonst NICHTS — eine einzige Anweisung verändert Daten", () => {
    /*
     * Gegen die SCHREIBVORGÄNGE, nicht gegen Wörter: das Skript LIEST
     * `shop_inventory` und `shop_offers()` für seine Abdrücke, und das soll
     * es. Verboten ist das Schreiben.
     *
     * Genau ein `update`, und es trifft `public.skylanders`. Jedes `insert`
     * geht in eine temporäre Tabelle (`pr_abdruck`, `pr_ziel`), die mit der
     * Transaktion verschwindet. Kein `delete`, kein `drop`, kein `grant`.
     */
    const ausfuehrbar = sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
    const updates = [...ausfuehrbar.matchAll(/^\s*update\s+(\S+)/gm)].map((m) => m[1]);
    expect(updates).toEqual(["public.skylanders"]);

    const inserts = [...ausfuehrbar.matchAll(/insert\s+into\s+(\S+)/gi)].map((m) => m[1]);
    expect(inserts.every((t) => t.startsWith("pr_")), inserts.join(", ")).toBe(true);

    for (const verboten of ["delete from", "drop ", "grant ", "revoke ", "alter table"]) {
      expect(ausfuehrbar.toLowerCase(), verboten).not.toContain(verboten);
    }
  });

  it("beweist, dass die Freigabe GEZIELT war", () => {
    /* Ein Abdruck über die Sichtbarkeit jeder ANDEREN Zeile. Bewegt sich
       daran etwas, war es eine pauschale Freigabe. */
    expect(sql).toContain("sicht_andere_md5");
    expect(sql).toContain("ABBRUCH C2: die Sichtbarkeit einer anderen Zeile");
    expect(sql).toContain("ABBRUCH C3:");
    expect(sql).toContain("ausgeblendete Figuren");
  });

  it("und dass sichtbar nicht sammelbar und nicht verkäuflich heisst", () => {
    expect(sql).toContain("ABBRUCH A4:");
    expect(sql).toContain("SAMMELBAREN Kategorie");
    expect(sql).toContain("ABBRUCH A5:");
    expect(sql).toContain("ABBRUCH C5: ein Portal steht im oeffentlichen Angebot");
    /* Und die Nachprüfung vergleicht beide Zahlen. */
    expect(sql).toContain("'sammelbar'");
    expect(sql).toContain("'angebote_md5'");
  });

  it("läuft in einer Klammer und ist nur für Staging", () => {
    const zeilen = sql.split("\n").filter((l) => /^[a-z]/.test(l)).map((l) => l.trim());
    expect(zeilen[0]).toBe("begin;");
    expect(zeilen[zeilen.length - 1]).toBe("commit;");
    expect(sql).toContain("'SKY-0821', 'SKY-0822'");
    expect(sql).toContain("qqxcpesbwfxzgytkdsac");
    expect(sql).not.toContain("zmiwxswrpkmizvqsgype");
  });

  it("und die Rücknahme nimmt genau dieselben 21 zurück", () => {
    const back = read(RELEASE_BACK);
    const ids = [...back.matchAll(/\('(SKY-\d{4})'\)/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(21);
    expect(back).toContain("set catalog_visible = false");
    expect(back).toContain("and s.item_type = 'portal'");
  });
});
