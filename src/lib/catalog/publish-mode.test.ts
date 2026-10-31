import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { BOOTSTRAP_REGELN, BOOTSTRAP_SCHLUESSEL, liesModus, pruefeEinwegrichtung,
         type Schritt } from "./publish-mode.ts";

/* ==========================================================================
 * BOOTSTRAP ODER DAUERBETRIEB
 *
 * Der einmalige Abgleich schrieb in beide Richtungen und brauchte dafür fünf
 * Regeln, die genau einmal richtig waren. Seit ADR-0163 führt Staging. Diese
 * Datei hält fest, dass keine dieser Regeln im Dauerbetrieb aktiv bleibt —
 * und dass der Bootstrap trotzdem nachvollziehbar läuft.
 * ========================================================================== */

const PLANER = readFileSync("tools/catalog-sync.mts", "utf8");
const APPLY = readFileSync("tools/catalog-sync-apply.mts", "utf8");
const PUBLISH = readFileSync("tools/catalog-publish.mts", "utf8");
const RUNNER = readFileSync("tools/catalog-finish.mts", "utf8");
const ohne = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter((z) => !z.trimStart().startsWith("//")).join("\n");

describe("liesModus — der Modus wird verlangt, nicht geraten", () => {
  it("nimmt publish und bootstrap", () => {
    expect(liesModus(["node", "x", "--modus=publish"])).toBe("publish");
    expect(liesModus(["node", "x", "--modus=bootstrap"])).toBe("bootstrap");
  });

  it("verweigert einen fehlenden Modus — es gibt keinen Vorgabewert", () => {
    const r = liesModus(["node", "x"]);
    expect(typeof r).toBe("object");
    expect((r as { fehler: string }).fehler).toContain("Vorgabewert");
  });

  it("verweigert einen unbekannten Wert", () => {
    const r = liesModus(["node", "x", "--modus=beide"]);
    expect((r as { fehler: string }).fehler).toContain("beide");
  });

  it("verweigert zwei Angaben — welche gälte sonst?", () => {
    const r = liesModus(["node", "x", "--modus=publish", "--modus=bootstrap"]);
    expect((r as { fehler: string }).fehler).toContain("2-mal");
  });
});

describe("die fünf Einmalregeln sind benannt und am Modus gebunden", () => {
  it("jede trägt Zweck, Begründung und Quelle", () => {
    expect(BOOTSTRAP_REGELN).toHaveLength(5);
    for (const r of BOOTSTRAP_REGELN) {
      expect(r.was.length, r.schluessel).toBeGreaterThan(10);
      expect(r.warum_einmalig.length, r.schluessel).toBeGreaterThan(20);
      expect(r.quelle.length, r.schluessel).toBeGreaterThan(5);
    }
  });

  it("die Liste nennt genau die vier aus dem Auftrag plus die Figurenanlage", () => {
    expect(BOOTSTRAP_SCHLUESSEL).toEqual([
      "sichtbarkeit_production_gewinnt",
      "name_korrektur_staging",
      "display_name_override_nach_staging",
      "production_eigene_entscheidung",
      "figurenanlage_nach_staging",
    ]);
  });

  it("der Planer bindet jede einzelne an BOOTSTRAP", () => {
    const c = ohne(PLANER);
    // Sichtbarkeit: Staging folgt Production
    expect(c).toContain('if (BOOTSTRAP && sichtAb && (f === "catalog_visible"');
    // Namenskorrektur
    expect(c).toContain("Object.entries(BOOTSTRAP ? nameKorr : {})");
    // Anzeigenamen auch nach Staging
    expect(c).toContain("const ovrZiele: [Umgebung, Map<string, Zeile>][] = BOOTSTRAP");
    // Production-eigene Entscheidung
    expect(c).toContain("const nachStaging = BOOTSTRAP && sichtbarkeitProdGewinnt");
    // Figurenanlage nach Staging
    expect(c).toContain('if (BOOTSTRAP) planeFigurenanlage("staging")');
  });

  it("und keine von ihnen steht unbedingt da", () => {
    const c = ohne(PLANER);
    expect(c).not.toMatch(/^planeFigurenanlage\("staging"\);$/m);
    expect(c).not.toContain("Object.entries(nameKorr)");
    expect(c).not.toContain('if (sichtAb && (f === "catalog_visible"');
    expect(c).not.toContain("const nachStaging = sichtbarkeitProdGewinnt");
  });

  it("der Bootstrap bleibt lauffähig — der Runner nennt seinen Modus", () => {
    expect(ohne(RUNNER)).toContain('"--modus=bootstrap"');
    expect(ohne(RUNNER)).toContain('["--modus=bootstrap", "--riegel2=messen"]');
  });
});

describe("pruefeEinwegrichtung — Riegel 4", () => {
  const prod: Schritt[] = [
    { ziel: "production", art: "feld", sky_id: "SKY-0001", feld: "card_type" },
    { ziel: "production", art: "figur-anlegen", sky_id: "SKY-0900" },
  ];

  it("lässt einen reinen Production-Plan durch", () => {
    const r = pruefeEinwegrichtung(prod);
    expect(r.ok).toBe(true);
    expect(r.nachStaging).toEqual([]);
  });

  it("hält jeden Schritt nach Staging auf — egal welcher Art", () => {
    for (const s of [
      { ziel: "staging", art: "feld", sky_id: "SKY-0002", feld: "name", grund: "x" },
      { ziel: "staging", art: "figur-anlegen", sky_id: "SKY-0821", grund: "y" },
      { ziel: "staging", art: "charakter-anlegen", sky_id: "—", grund: "z" },
    ] as Schritt[]) {
      const r = pruefeEinwegrichtung([...prod, s]);
      expect(r.ok, s.art).toBe(false);
      expect(r.nachStaging).toHaveLength(1);
    }
  });

  it("ein leerer Plan ist einwegrichtig", () => {
    expect(pruefeEinwegrichtung([]).ok).toBe(true);
  });

  it("der Planer ruft ihn im Publish auf und bricht ab", () => {
    /*
     * DIE BEDINGUNG WIRD GEPRUEFT, NICHT NUR DIE ANWESENHEIT.
     *
     * Eine erste Fassung dieses Tests sah nur nach, ob `process.exit(1)` in
     * der Naehe steht — und liess eine Mutationsprobe durch, die `if
     * (!einweg.ok)` auf `if (false)` setzte: der Riegel stand noch da und
     * tat nichts. Ein Riegel ist seine Bedingung.
     */
    const c = ohne(PLANER);
    expect(c).toContain("if (!BOOTSTRAP) {");
    expect(c).toContain("const einweg = pruefeEinwegrichtung(plan);");
    expect(c).toContain("if (!einweg.ok) {");
    expect(c).toContain("RIEGEL 4");
    const ab = c.indexOf("if (!einweg.ok) {");
    expect(c.slice(ab, ab + 900)).toContain("process.exit(1)");
  });

  it("Riegel 4 läuft NACH dem Planaufbau, nicht davor", () => {
    const c = ohne(PLANER);
    expect(c.indexOf("pruefeEinwegrichtung(plan)"))
      .toBeGreaterThan(c.indexOf('planeFigurenanlage("production")'));
  });
});

describe("kein abgeschalteter Riegel", () => {
  /*
   * `if (false)` und `if (true)` sind die billigste Art, einen Riegel
   * stehenzulassen und auszuschalten. In diesen vier Werkzeugen hat
   * beides nichts zu suchen — und ein Test, der nur Anwesenheit prueft,
   * merkt es nicht.
   */
  it.each([["Planer", PLANER], ["Apply", APPLY], ["Publish", PUBLISH], ["Runner", RUNNER]])(
    "%s enthält kein if (false) und kein if (true)", (_n, quelle) => {
      const c = ohne(quelle);
      expect(c).not.toMatch(/if \(\s*false\s*\)/);
      expect(c).not.toMatch(/if \(\s*true\s*\)/);
    });
});

describe("der Plan trägt seinen Modus, und der Publish prüft ihn", () => {
  it("der Planer schreibt den Modus in die Plandatei", () => {
    expect(ohne(PLANER)).toContain("modus: MODUS,");
  });

  it("der Publish weist einen Bootstrap-Plan ab", () => {
    const c = ohne(PUBLISH);
    expect(c).toContain('p0.modus !== "publish"');
    expect(c).toContain("Ein Bootstrap-Plan darf hier nicht angewendet werden");
  });
});

describe("Namen und kuratierte Charaktermetadaten bleiben unangetastet", () => {
  it("der Publish-Plan schreibt nie einen Namen", () => {
    /*
     * Die einzige Stelle, die `feld: "name"` plante, war die einmalige
     * Namenskorrektur — jetzt an BOOTSTRAP gebunden. Ausserdem überspringt
     * der Feldvergleich `name` und `slug` über UNGEREGELT (ADR-0030).
     */
    const c = ohne(PLANER);
    expect(c).toContain("(UNGEREGELT as readonly string[]).includes(f)");
    const stellen = [...c.matchAll(/feld: "name"/g)];
    expect(stellen).toHaveLength(1);         // nur die Bootstrap-Korrektur
    const ab = c.lastIndexOf("Object.entries(BOOTSTRAP ? nameKorr : {})");
    expect(ab).toBeGreaterThan(-1);
    expect(ab).toBeLessThan(stellen[0].index!);
  });

  it("der Apply-Pfad nennt kein Charaktermetadatenfeld", () => {
    for (const f of ["element", "species", "role_type", "short_description",
                     "source_url", "source_label", "verified_at"]) {
      expect(ohne(APPLY), f).not.toContain(`"${f}"`);
    }
  });

  it("und er nennt market_price nirgends", () => {
    expect(ohne(APPLY)).not.toContain("market_price");
  });
});
