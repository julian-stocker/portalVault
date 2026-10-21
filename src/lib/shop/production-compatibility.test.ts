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

/**
 * Der Stand, der bis zum 2026-10-21 auf `skyisles.app` lief.
 *
 * WARUM HIER EINE FESTE PRUEFSUMME STEHT UND NICHT `origin/main`.
 *
 * Bis zum Deployment war `origin/main` genau dieser Code, und die Abfrage
 * war dieselbe. Seit dem Push vom 2026-10-21 ist `origin/main` der NEUE
 * Code — die Aussage dieses Abschnitts waere damit still zur Tautologie
 * geworden („der neue Code ist der neue Code"), und die drei Zeilen hier
 * haetten genau das Gegenteil von dem gemeldet, was sie behaupten.
 *
 * Die Aussage ist historisch und bleibt pruefbar: `81386e6` ist der Stand,
 * gegen den die Reihenfolge `0135`-`0137` VOR dem Deployment begruendet
 * wurde, und `81386e6` ist das Ziel, auf das ein Rollback zuruecksetzt.
 * Deshalb steht der Commit jetzt als Literal da.
 */
const VORIGES_DEPLOYMENT = "81386e6";

function deployt(pfad: string): string {
  return execFileSync("git", ["show", `${VORIGES_DEPLOYMENT}:${pfad}`], { encoding: "utf8" });
}

const read = (p: string) => readFileSync(p, "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*(?:\/\/|\*).*$/gm, "");

/* ===================================================================== */
describe("1. der bis zum 2026-10-21 deployte Code (81386e6) verträgt 0135 bis 0137", () => {
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

/* ===================================================================== */
describe("5. der DEPLOYTE Code (21353e4) verträgt 0139 ohne 0140 und 0141", () => {
  /*
   * DER NÄCHSTE ZWISCHENSTAND, UND ER DAUERT LÄNGER ALS EINE SITZUNG.
   *
   * Nach `0139` stehen drei neue Spalten und vier neue Funktionen in der
   * Datenbank, während `seller_sale_state()` (`0141`) noch fehlt. Dieser
   * Zustand ist kein Augenblick: zwischen den Freigaben liegen Tage. Der
   * Code, der auf `skyisles.app` läuft, muss ihn also AUSHALTEN — und zwar
   * der, der dort wirklich läuft, nicht der im Arbeitsbaum.
   */
  const DEPLOYT = "21353e4";
  const live = (pfad: string): string =>
    execFileSync("git", ["show", `${DEPLOYT}:${pfad}`], { encoding: "utf8" });

  it("die fünfte Spalte von shop_offers() ist optional, nicht erwartet", () => {
    /* `0139` tauscht den Rückgabetyp: vier Spalten werden fünf. Ein Code,
       der vier ERWARTET, bricht; dieser nimmt die fünfte, wenn sie da ist. */
    const q = live("src/lib/shop/queries.ts");
    expect(q).toContain("delivery_scope?: string | null");
    expect(q).toContain("row.delivery_scope ?? null");
  });

  it("und fehlt sie, ist das kein Fehler, sondern null", () => {
    const o = live("src/lib/shop/offer.ts");
    expect(o).toContain("deliveryScope: string | null");
  });

  it("usk_rating darf da sein und leer — beides", () => {
    /*
     * Vor `0139` fängt der Code `42703` („Spalte gibt es nicht") ab. NACH
     * `0139` gibt es die Spalte, und sie ist überall `null` — die Migration
     * erfindet keine Alterskennzeichnung. Beide Wege müssen tragen.
     */
    const q = live("src/lib/catalog/queries.ts");
    expect(q).toContain('const COLUMN_MISSING = "42703"');
    expect(q).toMatch(/usk_rating/);
  });

  it("seller_sale_state() fehlt noch, und die Lagerkarte verträgt das", () => {
    const inv = live("src/lib/admin/inventory.ts");
    expect(inv).toContain('const FUNCTION_MISSING = "PGRST202"');
    /* Ohne Zustand keine Steuerung — nicht eine Steuerung ohne Zustand. */
    const modell = live("src/lib/admin/inventory-model.ts");
    expect(modell).toContain("saleState?.saleReleased === true");
  });

  it("und kein freigegebenes Zubehör kann es geben, solange niemand freigibt", () => {
    /*
     * Das ist die Zusicherung, die über den Code hinausgeht: `0139` setzt
     * `sale_released` auf `false` bei JEDER Zeile, und das Tor fragt es.
     * Die Oberfläche kann es nach `0139` nicht einmal umschalten — die
     * Steuerungen erscheinen erst mit `0141`.
     */
    const migration = readFileSync(
      "supabase/migrations/0139_accessory_sale_release.sql", "utf8");
    expect(migration).toContain("add column sale_released boolean not null default false");
    /*
     * OHNE DIE FUNKTIONSRÜMPFE. `seller_set_sale_release()` schreibt
     * natürlich `update public.shop_inventory` — das ist ihre Aufgabe, und
     * sie tut es erst, wenn der Betrieb sie aufruft. Was hier nicht stehen
     * darf, ist ein `update` auf ANWEISUNGSEBENE: das liefe mit der
     * Migration und gäbe etwas frei.
     */
    const anweisungen = migration
      .replace(/as \$\$[\s\S]*?\$\$;/g, "as $$ … $$;")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*--.*$/gm, "");
    for (const dml of [/^\s*update public\.shop_inventory/m,
      /^\s*update public\.skylanders/m, /^\s*insert into public\./m]) {
      expect(anweisungen, String(dml)).not.toMatch(dml);
    }
  });
});
