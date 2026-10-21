/**
 * VERTRÄGT DER CODE DEN ZWISCHENSTAND? (Production-Release 0135–0141)
 *
 * Ein Release in acht Schritten hat sieben Zwischenzustände, und in jedem
 * läuft echter Code gegen ein Schema, das noch nicht fertig ist. Die
 * Behauptungen des Release-Plans sind deshalb hier Tests, nicht Zusagen:
 *
 *   1. Der DEPLOYTE Code (`81386e6`) verträgt `0135`–`0137`.
 *   2. Der NEUE Code verträgt den Zwischenstand `0137` — also ohne
 *      `0138`–`0141`.
 *   3. `0138` darf nicht vor dem Deployment laufen.
 *
 * Punkt 1 wird gegen den Quelltext von `origin/main` geprüft: das ist, was
 * auf `skyisles.app` wirklich läuft. Dafür wird `git show` gebraucht — eine
 * Datei im Arbeitsbaum sagt nichts über das Deployment.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** Eine Datei, wie sie auf `origin/main` steht — also wie sie deployt ist. */
function deployt(pfad: string): string {
  return execFileSync("git", ["show", `origin/main:${pfad}`], { encoding: "utf8" });
}

const read = (p: string) => readFileSync(p, "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*(?:\/\/|\*).*$/gm, "");

/* ===================================================================== */
describe("1. der DEPLOYTE Code verträgt 0135 bis 0137", () => {
  it("er liest `item_type` nicht — 0135 ist für ihn unsichtbar", () => {
    /*
     * DER ENTSCHEIDENDE PUNKT DER REIHENFOLGE, von der anderen Seite. Der
     * NEUE Code braucht `item_type` in `FIGURE_COLUMNS` und stürzt ohne
     * `0135` ab; der DEPLOYTE nennt die Spalte nicht und übersteht ihre
     * Entstehung, ohne es zu merken.
     */
    const q = deployt("src/lib/catalog/queries.ts");
    const spalten = q.slice(q.indexOf("const FIGURE_COLUMNS"),
                            q.indexOf("const FIGURE_COLUMNS") + 400);
    expect(spalten).not.toContain("item_type");
    expect(spalten).toContain("card_type");
    /* Und der neue Code braucht sie — deshalb Migration vor Deployment. */
    const neu = read("src/lib/catalog/queries.ts");
    expect(neu.slice(neu.indexOf("const FIGURE_COLUMNS"),
                     neu.indexOf("const FIGURE_COLUMNS") + 400)).toContain("item_type");
  });

  it("seine Kategorienliste ist kleiner als die aus 0137 — ohne Wirkung", () => {
    /*
     * `0137` nennt fünf Kategorien, der deployte Code eine. Die vier neuen
     * Namen treffen auf Production auf keine Zeile, solange `0138` nicht
     * gelaufen ist — und genau daran hängt die Reihenfolge.
     */
    expect(deployt("src/lib/catalog/collectible.ts"))
      .toContain('new Set(["Spiele"])');
    /* Der neue Code nennt alle fünf. */
    expect(read("src/lib/catalog/collectible.ts")).toContain("Portale");
  });

  it("und er verträgt die achte Spalte von seller_import_catalog()", () => {
    /*
     * `0137` droppt die Funktion und legt sie mit einer zusätzlichen Spalte
     * an. Der deployte Verbraucher liest feldweise mit toleranten Vorgaben
     * — und benennt den Fall ausdrücklich.
     */
    const q = deployt("src/lib/orderbook/queries.ts");
    expect(q).toContain("Record<string, unknown>");
    expect(q).toContain("r.catalog_visible !== false && r.is_active !== false");
    /* Der Kommentar, der diesen Zwischenzustand schon vorhergesehen hat. */
    expect(q).toContain("etwa zwischen Migration und Deployment");
  });
});

/* ===================================================================== */
describe("2. der NEUE Code verträgt den Zwischenstand 0137", () => {
  it("shop_offers() mit vier Spalten: kein Lieferumfang, kein Fehler", () => {
    const q = code("src/lib/shop/queries.ts");
    /* Das Feld ist optional deklariert UND beim Lesen abgesichert. */
    expect(read("src/lib/shop/queries.ts")).toContain("delivery_scope?: string | null;");
    expect(q).toContain("deliveryScope: row.delivery_scope ?? null,");
  });

  it("usk_rating fehlt: GENAU 42703 wird abgefangen, nichts anderes", () => {
    const q = code("src/lib/catalog/queries.ts");
    expect(q).toContain('const COLUMN_MISSING = "42703";');
    expect(q).toContain("if (error.code === COLUMN_MISSING) return null;");
    /* Und jeder andere Fehler fliegt — eine stille Oberfläche aus einem
       unbekannten Grund wäre schlimmer als ein Fehler. */
    expect(q).toContain("throw new Error(`usk rating: ${error.message}`);");
  });

  it("seller_sale_state() fehlt: GENAU PGRST202 wird abgefangen", () => {
    const q = code("src/lib/admin/inventory.ts");
    expect(q).toContain('const FUNCTION_MISSING = "PGRST202";');
    expect(q).toContain("if (error.code === FUNCTION_MISSING) return null;");
    expect(q).toContain("throw new Error(`sale state: ${error.message}`);");
  });

  it("und ohne Auskunft wird keine Steuerung angeboten", () => {
    /* Der Unterschied zwischen „nicht freigegeben" und „weiß nicht": beide
       zeigen nichts an, aber nur der erste ist ein Schalter. */
    const m = code("src/lib/admin/inventory-model.ts");
    expect(m).toContain("return position.saleState?.saleReleased === true;");
    expect(m).toContain("(position.saleState ?? null) !== null");
  });

  it("usk_rating steht NICHT in FIGURE_COLUMNS", () => {
    /*
     * Die Spaltenliste läuft auf JEDER Umgebung. Eine Spalte darin, die
     * Production nicht hat, legte den ganzen Katalog lahm — dieselbe Klasse
     * Fehler, die am 2026-10-20 den Preflight von `0139` abgebrochen hat.
     */
    const q = read("src/lib/catalog/queries.ts");
    const spalten = q.slice(q.indexOf("const FIGURE_COLUMNS"),
                            q.indexOf("const FIGURE_COLUMNS") + 400);
    for (const spalte of ["usk_rating", "sale_released", "delivery_scope"]) {
      expect(spalten, spalte).not.toContain(spalte);
    }
  });

  it("und ohne 0138 zeigt der Zubehörkatalog einfach weniger", () => {
    /* Kein Sonderfall, kein leerer Zustand: die Auswahlfelder erscheinen
       ohnehin nur, wenn sie mehr als eine Wahl haben. */
    const v = code("src/components/catalog/accessory-view.tsx");
    expect(v).toContain("types.length > 1");
    expect(v).toContain("seriesOptions.length > 1");
  });
});

/* ===================================================================== */
describe("3. 0138 gehört hinter das Deployment", () => {
  it("die Production-Datei sagt es in ihrem eigenen Kopf", () => {
    const f = read("supabase/operations/prod-0138.sql");
    expect(f).toContain("ERST NACH DEM VERCEL-DEPLOYMENT");
    /* Mit dem Grund, nicht nur der Anweisung. */
    expect(f).toContain("Fortschrittsnenner");
    expect(f).toContain("81386e6");
  });

  it("und der Plan nennt dieselbe Reihenfolge", () => {
    const plan = read("supabase/checks/production_release_0135_0141.md");
    expect(plan).toContain("0135 → 0136 → 0137 → [ VERCEL-DEPLOYMENT ] → 0138 → 0139 → 0140 → 0141");
    /* Die drei Behauptungen stehen dort als Behauptungen, mit Beleg. */
    expect(plan).toContain("git show origin/main");
    expect(plan).toContain("unbegrenzt");
  });

  it("0134 ist nicht im Release", () => {
    /* Sie ist nirgends angewendet, und der Code arbeitet ohne sie. */
    const plan = read("supabase/checks/production_release_0135_0141.md");
    expect(plan).toContain("`0134` gehört NICHT dazu");
    expect(plan).not.toContain("prod-0134.sql");
  });
});

/* ===================================================================== */
describe("4. Die Zuordnung der Spiele ist eine Invariante, keine Momentaufnahme", () => {
  /*
   * `0135` setzt `item_type = 'game'` genau auf den Zeilen der Kategorie
   * `Spiele` und hält das mit einem Trigger. „39 Spiele korrekt zugeordnet"
   * ist deshalb nichts, was man einmal nach der Migration abhakt, sondern
   * eine Aussage, die dauerhaft prüfbar sein muss — sonst merkt niemand,
   * wenn sie später auseinanderläuft.
   */
  const verifier = code("tools/verify-shop.mts");

  it("prüft aus der Kategorie, nicht aus dem Namen", () => {
    expect(verifier).toContain('kategorie(z) === "Spiele"');
    /* Kein Namensraten — das ist die Regel aus ADR-0034. */
    expect(verifier).not.toMatch(/name.*includes\("Spiel/);
  });

  it("prüft in beide Richtungen, weil eine Richtung blind wäre", () => {
    expect(verifier).toContain("gameAusserhalb");
    expect(verifier).toContain("spieleNichtGame");
    expect(verifier).toContain("gameAusserhalb.length === 0 && spieleNichtGame.length === 0");
  });

  it("nennt die Zahl, die der Betrieb kennt — aktiv UND sichtbar", () => {
    expect(verifier).toContain("z.is_active && z.catalog_visible");
  });

  it("meldet eine gedeckelte Antwort als Fehler, nicht als Unauffälligkeit", () => {
    expect(verifier).toContain('count: "exact"');
    expect(verifier).toContain("zeilen.length === alle.count");
  });

  it("läuft nur, wenn item_type überhaupt da ist", () => {
    /* Dieselbe Datei läuft gegen eine Datenbank ohne `0135`. Dort darf die
       Prüfung schweigen, nicht scheitern. */
    expect(verifier).toContain("if (probe.error === null) {");
  });

  it("verlangt keinen Typ, den noch keine Migration erzeugt hat", () => {
    /* Ohne `0137`/`0138` gibt es weder Portale noch Bundles — die Liste ist
       eine Obergrenze, keine Erwartung. */
    expect(verifier).toContain('["figure", "game", "portal", "bundle", "other"]');
  });
});
