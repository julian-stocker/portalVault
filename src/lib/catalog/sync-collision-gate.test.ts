import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  BEOBACHTETE_MERKMALE, IDENTITAETSMERKMALE, einordnen, istAusgeschlossen, riegel3,
  type Ausschluss, type Figur,
} from "./sync-collision-gate.ts";

/** Genau die Regel aus `resources/sync/bootstrap-decisions.json`. */
const AUS: Ausschluss = { testserien: ["TEST", "SMOK"], band_ab: "SKY-9000", status: ["draft"] };

const fig = (p: Partial<Figur> & { sky_id: string }): Figur => ({
  name: "Bash", slug: "bash", series_code: "SA", image_file: "abc.webp",
  catalog_status: "public", ...p,
});

const paar = (s: Partial<Figur>, p: Partial<Figur>, id = "SKY-0500") =>
  einordnen(fig({ sky_id: id, ...s }), fig({ sky_id: id, ...p }), AUS);

const karte = (zeilen: Figur[]) => new Map(zeilen.map((z) => [z.sky_id, z]));

describe("die Merkmale, die der Riegel ansieht", () => {
  it("Identitaet haengt an slug und series_code — und an nichts sonst", () => {
    expect([...IDENTITAETSMERKMALE]).toEqual(["slug", "series_code"]);
  });

  /*
   * ADR-0030: die Namenshoheit liegt bei der Excel, PortalVault darf anders
   * DARSTELLEN. Ein Name kann also abweichen, ohne dass die Identitaet eine
   * andere ist — er darf deshalb nie ein Riegelmerkmal werden.
   */
  it("der Name ist KEIN Identitaetsmerkmal (ADR-0030)", () => {
    expect(IDENTITAETSMERKMALE as readonly string[]).not.toContain("name");
  });

  it("das Bild wird beobachtet, nicht geriegelt", () => {
    expect([...BEOBACHTETE_MERKMALE]).toEqual(["image_file"]);
    expect(IDENTITAETSMERKMALE as readonly string[]).not.toContain("image_file");
  });
});

describe("was ein Identitaetskonflikt ist", () => {
  it("anderer Slug", () => {
    const e = paar({ slug: "gold-fire-kraken" }, { slug: "winterfest-lob-star" });
    expect(e.art).toBe("identitaetskonflikt");
    expect(e).toMatchObject({ merkmale: ["slug"] });
  });

  it("andere Serie — und das faengt die alte Fassung NICHT", () => {
    const e = paar({ series_code: "SF" }, { series_code: "T" });
    expect(e.art).toBe("identitaetskonflikt");
    expect(e).toMatchObject({ merkmale: ["series_code"] });
  });

  it("beides zugleich nennt beides", () => {
    const e = paar({ slug: "a", series_code: "SF" }, { slug: "b", series_code: "T" });
    expect(e).toMatchObject({ art: "identitaetskonflikt", merkmale: ["slug", "series_code"] });
  });

  it("ein abweichender Name allein ist KEIN Konflikt", () => {
    const e = paar({ name: "Empire of Ice" }, { name: "Ice Crave" });
    expect(e.art).toBe("namensabweichung");
  });

  it("ein abweichendes Bild allein ist KEIN Konflikt, sondern ein Hinweis", () => {
    const e = paar({ image_file: "neu.webp" }, { image_file: "alt.webp" });
    expect(e.art).toBe("gleich");
    expect(e).toMatchObject({ beobachtet: ["image_file"] });
  });

  it("voellig gleiche Zeilen sind gleich", () => {
    expect(paar({}, {}).art).toBe("gleich");
  });

  /*
   * NULL gegen NULL ist gleich, NULL gegen einen Wert ist eine Abweichung.
   * Ohne diese Normalisierung waere `undefined !== null` ein Dauerkonflikt.
   */
  it("NULL und NULL sind gleich, NULL und ein Wert nicht", () => {
    expect(paar({ slug: null }, { slug: null }).art).toBe("gleich");
    expect(paar({ slug: null }, { slug: "bash" }).art).toBe("identitaetskonflikt");
  });
});

describe("der Ausschluss", () => {
  it("der reservierte Bereich ab SKY-9000 liegt ausserhalb (ADR-0070)", () => {
    const e = paar({ slug: "a" }, { slug: "b" }, "SKY-9998");
    expect(e.art).toBe("ausserhalb");
    expect(e).toMatchObject({ grund: expect.stringContaining("SKY-9000") });
  });

  it("SKY-8999 liegt noch drin, SKY-9000 nicht mehr", () => {
    expect(paar({ slug: "a" }, { slug: "b" }, "SKY-8999").art).toBe("identitaetskonflikt");
    expect(paar({ slug: "a" }, { slug: "b" }, "SKY-9000").art).toBe("ausserhalb");
  });

  it("eine Testserie auf BEIDEN Seiten liegt ausserhalb", () => {
    const e = paar({ series_code: "TEST", slug: "a" }, { series_code: "TEST", slug: "b" });
    expect(e.art).toBe("ausserhalb");
    expect(e).toMatchObject({ grund: expect.stringContaining("TEST") });
  });

  it("Entwurfsstatus auf beiden Seiten liegt ausserhalb", () => {
    const e = paar({ catalog_status: "draft", slug: "a" },
                   { catalog_status: "draft", slug: "b" });
    expect(e.art).toBe("ausserhalb");
  });

  /*
   * DER WICHTIGSTE FALL DES GANZEN AUSSCHLUSSES.
   *
   * Ausgeschlossen auf EINER Seite heisst NICHT ausserhalb: der Planbau
   * ueberspringt eine Zeile nur, wenn sie auf BEIDEN Seiten ausgeschlossen
   * ist (`ausgeschlossen(a, D) && ausgeschlossen(b, D)`). Waere der Riegel
   * hier strenger als der Plan, bliebe ein Konflikt an einer Zeile
   * unentdeckt, die der Plan sehr wohl anfasst.
   */
  it("auf nur EINER Seite ausgeschlossen ist NICHT ausserhalb", () => {
    expect(paar({ series_code: "TEST" }, { series_code: "SA" }, "SKY-0500").art)
      .toBe("identitaetskonflikt");
    expect(paar({ catalog_status: "draft", slug: "a" }, { slug: "b" }).art)
      .toBe("identitaetskonflikt");
  });

  it("istAusgeschlossen misst jede der drei Bedingungen einzeln", () => {
    expect(istAusgeschlossen(fig({ sky_id: "SKY-0500" }), AUS)).toBe(false);
    expect(istAusgeschlossen(fig({ sky_id: "SKY-9001" }), AUS)).toBe(true);
    expect(istAusgeschlossen(fig({ sky_id: "SKY-0500", series_code: "SMOK" }), AUS)).toBe(true);
    expect(istAusgeschlossen(fig({ sky_id: "SKY-0500", catalog_status: "draft" }), AUS)).toBe(true);
  });
});

describe("riegel3 ueber einen Bestand", () => {
  const S = karte([
    fig({ sky_id: "SKY-0102", name: "Empire of Ice" }),
    fig({ sky_id: "SKY-0500" }),
    fig({ sky_id: "SKY-0821", name: "Gold Fire Kraken", slug: "gold-fire-kraken",
          series_code: "SF", image_file: null, catalog_status: "hidden" }),
    fig({ sky_id: "SKY-9998", series_code: "TEST", slug: "rls-shop-fixture" }),
    fig({ sky_id: "SKY-0999" }),                                   // nur auf Staging
  ]);
  const P = karte([
    fig({ sky_id: "SKY-0102", name: "Ice Crave" }),
    fig({ sky_id: "SKY-0500" }),
    fig({ sky_id: "SKY-0821", name: "Winterfest Lob-Star",
          slug: "winterfest-lob-star-trap-team", series_code: "T",
          image_file: null, catalog_status: "hidden" }),
    fig({ sky_id: "SKY-9998", series_code: "SA", slug: "rls-shop-fixture" }),
  ]);

  it("trennt Konflikt, Namensfall, ausserhalb und gleich", () => {
    const r = riegel3(S, P, AUS, ["SKY-0821"]);
    expect(r.konflikte).toEqual([{ sky_id: "SKY-0821", merkmale: ["slug", "series_code"] }]);
    expect(r.namensabweichungen).toEqual(["SKY-0102"]);
    expect(r.ausserhalb.map((x) => x.sky_id)).toEqual(["SKY-9998"]);
    expect(r.unbekannt).toEqual([]);
  });

  it("eine SKY-ID, die nur auf einer Seite steht, ist kein Fall fuer den Riegel", () => {
    const r = riegel3(S, P, AUS, ["SKY-0821"]);
    const alle = [...r.konflikte.map((x) => x.sky_id), ...r.namensabweichungen,
                  ...r.ausserhalb.map((x) => x.sky_id)];
    expect(alle).not.toContain("SKY-0999");
  });

  it("ein Konflikt OHNE Entscheidung haelt an", () => {
    expect(riegel3(S, P, AUS, []).unbekannt).toEqual(["SKY-0821"]);
  });

  it("die Ausgabe ist sortiert und damit zwischen zwei Laeufen vergleichbar", () => {
    const r = riegel3(karte([fig({ sky_id: "SKY-0300", name: "x" }), fig({ sky_id: "SKY-0100", name: "y" })]),
                      karte([fig({ sky_id: "SKY-0300" }), fig({ sky_id: "SKY-0100" })]), AUS, []);
    expect(r.namensabweichungen).toEqual(["SKY-0100", "SKY-0300"]);
  });
});

/*
 * DIE GEMESSENE WIRKLICHKEIT VOM 2026-10-30 (SYNC-18).
 *
 * Diese Zahlen sind keine Erfindung: sie stammen aus dem lesenden Lauf gegen
 * beide Umgebungen. Sie stehen hier, damit eine spaetere Lockerung des
 * Riegels auffaellt — nicht, um den Riegel zu beschreiben.
 */
describe("gegen den Befund aus SYNC-18", () => {
  it("SKY-0821 ist ein Konflikt an slug UND series_code", () => {
    const e = paar(
      { name: "Gold Fire Kraken", slug: "gold-fire-kraken", series_code: "SF" },
      { name: "Winterfest Lob-Star", slug: "winterfest-lob-star-trap-team", series_code: "T" },
      "SKY-0821");
    expect(e).toMatchObject({ art: "identitaetskonflikt", merkmale: ["slug", "series_code"] });
  });

  it("SKY-9994 und SKY-9998 bleiben ausserhalb", () => {
    expect(paar({ slug: "inventory-fixture-1789133618919" },
                { slug: "inventory-fixture-1788704275430" }, "SKY-9994").art).toBe("ausserhalb");
    expect(paar({ series_code: "TEST" }, { series_code: "SA" }, "SKY-9998").art).toBe("ausserhalb");
  });

  it("die 35 Namensfaelle aus SYNC-02 sind keine Konflikte", () => {
    // Gemeinsames Muster aller 35: gleicher Slug, gleiche Serie, gleiches Bild.
    for (const [s, p] of [["Empire of Ice", "Ice Crave"], ["Fire Bone Hot Dog", "Hot Dog"]]) {
      expect(paar({ name: s }, { name: p }).art).toBe("namensabweichung");
    }
  });
});

/*
 * DER RIEGEL UND DER PLAN MUESSEN DIESELBE AUSSCHLUSSREGEL FAHREN.
 *
 * Das ist am Quelltext gemessen und nicht am Verhalten: der Planbau darf die
 * `&&`-Bedingung nicht auf `||` aendern, ohne dass dieser Test bricht — sonst
 * waere der Riegel strenger als der Plan, und Konflikte blieben liegen.
 */
describe("Riegel und Planbau teilen die Ausschlussregel", () => {
  const quelle = readFileSync("tools/catalog-sync.mts", "utf8");

  it("der Planbau ueberspringt nur, was auf BEIDEN Seiten ausgeschlossen ist", () => {
    expect(quelle).toContain("if (ausgeschlossen(a, D) && ausgeschlossen(b, D)) continue;");
    expect(quelle).not.toContain("ausgeschlossen(a, D) || ausgeschlossen(b, D)");
  });

  it("der Dry-Run ruft den Riegel auf und schreibt ihn nicht selbst aus", () => {
    expect(quelle).toContain("sync-collision-gate.ts");
    expect(quelle).toContain("riegel3(");
    // Die alte, zu enge Bedingung darf nicht zurueckkommen.
    expect(quelle).not.toMatch(/\.name !== .*\.name && .*\.slug !== .*\.slug/);
  });

  /*
   * Die Schreibfreiheit des Dry-Runs wird hier NICHT noch einmal geprueft.
   * `sync-plan.test.ts` tut das schon — und zwar richtig: es raeumt vorher
   * die Kommentare und das erlaubte `createHash(...).update(` weg. Eine
   * zweite, groebere Fassung desselben Riegels waere kein zusaetzlicher
   * Schutz, sondern eine zweite Wahrheit, die irgendwann falsch anschlaegt.
   */
});

/*
 * ===========================================================================
 * EINE AUFGELOESTE KOLLISION IST KEINE KOLLISION MEHR
 *
 * Der Fehler vom 2026-10-31, gefunden beim Fortsetzen des Abschlusslaufs:
 * `bekannt` fuehrte `SKY-0821` weiter, weil dort eine Kollisionsentscheidung
 * stand — und der Feldvergleich ueberspringt jede ID in `bekannt`. Nach der
 * Aufloesung war es dieselbe Figur auf beiden Seiten, und das Ueberspringen
 * verdeckte einen echten Unterschied: der Bildverweis fehlte auf Staging, und
 * der Plan fuehrte dazu NULL Schritte.
 *
 * Der Vergleich haette nie 0 erreichen koennen — ohne es zu sagen. Das ist
 * die unangenehmste Sorte Fehler, und deshalb steht hier ein Test.
 * ===========================================================================
 */
describe("eine aufgelöste Kollision kehrt in den Feldvergleich zurück", () => {
  const PLANER = readFileSync("tools/catalog-sync.mts", "utf8");

  it("bekannt zählt nur Kollisionen OHNE geloest-Eintrag", () => {
    expect(PLANER).toContain("v.geloest === undefined");
    expect(PLANER).toContain("v.geloest !== undefined");
    // Die alte, pauschale Fassung darf nicht zurueckkommen.
    expect(PLANER).not.toContain(
      "const bekannt = Object.keys((D.sky_id as Zeile).kollision as Zeile)");
  });

  it("und der Lauf sagt, welche wieder im Vergleich sind", () => {
    expect(PLANER).toContain("AUFGELOEST und damit");
    expect(PLANER).toContain("wieder im Feldvergleich");
  });

  /*
   * DIE ENTSCHEIDUNGSDATEI MUSS DEN EINTRAG TRAGEN. Ohne ihn waere die
   * Unterscheidung wirkungslos — und `SKY-0821` wieder unsichtbar.
   */
  it("SKY-0821 trägt in bootstrap-decisions.json einen geloest-Eintrag", () => {
    const d = JSON.parse(readFileSync("resources/sync/bootstrap-decisions.json", "utf8")) as
      { sky_id: { kollision: Record<string, { geloest?: Record<string, unknown> }> } };
    const k = d.sky_id.kollision["SKY-0821"];
    expect(k, "SKY-0821 fehlt in der Kollisionsliste").toBeDefined();
    expect(k.geloest, "ohne geloest-Eintrag bliebe die Zeile aus dem Vergleich")
      .toBeDefined();
    expect(k.geloest).toMatchObject({ am: expect.any(String), wie: expect.any(String) });
  });
});
