import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/* ==========================================================================
 * DER REGULAERE PUBLISH — die Reihenfolge und ihre Riegel
 *
 * Die sechs Stufen sind eine Anforderung: ein Bildverweis, der vor seinem
 * Objekt geschrieben wird, zeigt öffentlich ins Leere, denn `skylanders` ist
 * weltlesbar.
 * ========================================================================== */

const PUBLISH = readFileSync("tools/catalog-publish.mts", "utf8");
const APPLY = readFileSync("tools/catalog-sync-apply.mts", "utf8");
const TRANSFER = readFileSync("tools/storage-transfer.mts", "utf8");
const ohne = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter((z) => !z.trimStart().startsWith("//")).join("\n");
const C = ohne(PUBLISH);
const PKG = JSON.parse(readFileSync("package.json", "utf8")) as
  { scripts: Record<string, string> };

describe("die drei vorgesehenen Befehle", () => {
  it("catalog:publish:plan rechnet im Publish-Modus und schreibt nichts", () => {
    expect(PKG.scripts["catalog:publish:plan"])
      .toBe("node tools/catalog-sync.mts --modus=publish");
  });

  it("catalog:publish ruft den Sequenzer mit ausdrücklicher Freigabe", () => {
    expect(PKG.scripts["catalog:publish"])
      .toBe("node tools/catalog-publish.mts --apply --confirm-production");
  });

  it("der Bootstrap behält seinen eigenen Befehl, mit eigenem Modus", () => {
    expect(PKG.scripts["catalog:sync:plan"])
      .toBe("node tools/catalog-sync.mts --modus=bootstrap");
    expect(PKG.scripts["catalog:finish:apply"])
      .toBe("node tools/catalog-finish.mts --apply --confirm-production");
  });

  it("es gibt keinen Publish ohne Freigabe", () => {
    expect(C).toContain('APPLY && !process.argv.includes("--confirm-production")');
    expect(C).toContain("RIEGEL 0");
    const ab = C.indexOf("RIEGEL 0");
    expect(C.slice(ab, ab + 400)).toContain("process.exit(1)");
  });

  it("RIEGEL 0 steht vor allem anderen — ein halber Lauf soll nicht daran scheitern", () => {
    expect(C.indexOf("--confirm-production")).toBeLessThan(C.indexOf("[1] Plan rechnen"));
  });
});

describe("die sechs Stufen, in genau dieser Folge", () => {
  const pos = (s: string) => {
    const i = C.indexOf(s);
    expect(i, s).toBeGreaterThan(-1);
    return i;
  };

  it("Plan vor Bildobjekten vor Katalogänderungen", () => {
    const plan = pos('["--modus=publish"]');
    const bild = pos('["--ziel", "production", "--pruefen"]');
    const kat = pos('["--target=production", "--apply", "--confirm-production"]');
    expect(plan).toBeLessThan(bild);
    expect(bild).toBeLessThan(kat);
  });

  it("fehlende Objekte werden übertragen und DANACH erneut geprüft", () => {
    const ab = pos("if (bilder === 0) {");
    const block = C.slice(ab, pos("[6] Katalogaenderungen"));
    const uebertragen = block.indexOf('["--ziel", "production", "--apply"]');
    const nachpruefen = block.indexOf('["--ziel", "production", "--pruefen"]', uebertragen);
    expect(uebertragen).toBeGreaterThan(-1);
    expect(nachpruefen).toBeGreaterThan(uebertragen);
  });

  it("auch ohne neuen Bildverweis wird verifiziert", () => {
    const ab = pos("if (bilder === 0) {");
    expect(C.slice(ab, ab + 400)).toContain('["--ziel", "production", "--pruefen"]');
  });

  it("der Plan nach dem Schreiben muss 0 melden", () => {
    expect(C).toContain('nach(p1, "production") !== 0 || nach(p1, "staging") !== 0');
    expect(C).toContain('abbruch("NACHHER"');
  });

  it("und die geregelte Projektion muss zeichengleich sein", () => {
    expect(C).toContain("aS.abdruck !== aP.abdruck");
    expect(C).toContain('abbruch("GLEICHSTAND"');
  });
});

describe("Abbruch heißt Abbruch", () => {
  it("kein Rollback, keine Wiederholung", () => {
    expect(PUBLISH).toContain("Es wird nicht zurueckgerollt");
    expect(PUBLISH).toContain("nichts wiederholt");
    expect(C).not.toMatch(/retry|versuch\s*\+\+|for \(let v = 0; v < 3/i);
  });

  it("ein Fehlercode eines Werkzeugs bricht den Publish ab", () => {
    const ab = C.indexOf('execFileSync("node", [was, ...argumente]');
    expect(ab).toBeGreaterThan(-1);
    const nach = C.slice(ab, ab + 220);
    expect(nach).toContain("} catch {");
    expect(nach).toContain("abbruch(stufe,");
  });

  it("jeder Abbruch schreibt einen Bericht", () => {
    const ab = C.indexOf("function abbruch(");
    expect(C.slice(ab, ab + 500)).toContain("schreibeBericht(\"ABGEBROCHEN\"");
  });
});

describe("13. geschützte Nutzer- und Shopdaten", () => {
  it("werden vorher und nachher gemessen, und jede Bewegung bricht ab", () => {
    for (const tab of ["collection_items", "favorites", "cart_items", "order_lines",
                       "orders", "shop_inventory", "inventory_movements"]) {
      expect(C, tab).toContain(`z("${tab}")`);
    }
    expect(C).toContain("preise_abdruck");
    expect(C).toContain('abbruch("SCHUTZ"');
    expect(C).toContain("APPLY && bewegt.length > 0");
  });

  it("der Sequenzer selbst schreibt in keine Tabelle", () => {
    /*
     * `createHash(...).update(` ist kein Schreibweg — dieselbe Falle wie in
     * `catalog-finish.test.ts`. Erst herausnehmen, dann suchen.
     */
    const rein = C.replace(/createHash\([^)]*\)\.update\(/g, "createHash(");
    for (const w of [".insert(", ".update(", ".upsert(", ".delete(", ".rpc(",
                     ".upload(", ".remove("]) {
      expect(rein, w).not.toContain(w);
    }
    expect(rein).toContain(".select(");
  });
});

describe("TOR 4 — kein Bildverweis ohne das Bildobjekt", () => {
  const A = ohne(APPLY);

  it("steht im Apply-Pfad, nicht nur im Sequenzer", () => {
    /*
     * Ein Riegel, der nur im Sequenzer steht, ist umgehbar: man könnte den
     * Apply-Pfad direkt aufrufen.
     */
    expect(A).toContain("TOR 4");
    expect(A).toContain('R.storage.from("catalog").download(pfad)');
  });

  it("läuft VOR der Schreibschleife", () => {
    expect(A.indexOf("TOR 4")).toBeLessThan(
      A.indexOf("for (const s of schritte) {\n  const zeile ="));
  });

  it("prüft Name gegen Inhalt und die Zugehörigkeit zur Figur", () => {
    /*
     * ANKER IST DER RUMPF, NICHT DIE MELDUNG. Nach dem Entfernen der
     * Kommentare ist das erste "TOR 4" im Quelltext der Text der
     * Abbruchmeldung — ab dort vorwärts zu suchen findet den Riegel nicht.
     */
    const ab = A.indexOf("const bildschritte = schritte.filter(");
    expect(ab).toBeGreaterThan(-1);
    const block = A.slice(ab, ab + 2200);
    expect(block).toContain('createHash("sha256")');
    expect(block).toContain("sha.startsWith(erwartet)");
    expect(block).toContain('pfad.split("/")[0] !== s.sky_id');
  });

  it("bricht ab und nennt den Weg, statt zu übertragen", () => {
    /*
     * DIE BEDINGUNG, NICHT NUR DER ABBRUCH. Eine Mutationsprobe setzte
     * `if (fehlend.length > 0 || falsch.length > 0)` auf `if (false)` — der
     * Abbruch stand noch da und war unerreichbar.
     */
    expect(A).toContain("if (fehlend.length > 0 || falsch.length > 0) {");
    const ab = A.indexOf("const bildschritte = schritte.filter(");
    const block = A.slice(ab, ab + 2600);
    expect(block).toContain("abbruch(");
    expect(block).toContain("Es ist nichts geschrieben worden");
    expect(block).toContain("storage:transfer:apply:");
    // es überträgt selbst nichts
    expect(block).not.toContain(".upload(");
  });

  it("ein Plan ohne Bildverweis meldet das ausdrücklich", () => {
    expect(A).toContain("TOR 4 ok — der Plan nennt keinen neuen Bildverweis");
  });
});

describe("9. bereits übertragene Bilder werden nicht erneut geschrieben", () => {
  it("upsert ist aus, und es wird nie gelöscht", () => {
    expect(TRANSFER).toContain("upsert: false");
    expect(ohne(TRANSFER)).not.toContain("upsert: true");
    expect(ohne(TRANSFER)).not.toContain(".remove(");
  });

  it("ein vorhandener Zielpfad wird übersprungen und gemeldet", () => {
    expect(TRANSFER).toContain("ZIEL HAT SCHON EIN OBJEKT — uebersprungen");
  });
});

describe("der Bericht ist der Nachweis", () => {
  it("er nennt Stufe, Protokoll und Messwerte", () => {
    expect(C).toContain("resources/analysis/CATALOG-PUBLISH.md");
    expect(C).toContain("Letzte Stufe:");
    expect(C).toContain("ledger_vorher");
    expect(C).toContain("ledger_nachher");
    expect(C).toContain("schutz_vorher");
    expect(C).toContain("schutz_nachher");
  });

  it("ein No-op endet mit Erfolg und ohne Schreibvorgang", () => {
    const ab = C.indexOf('nach(p0, "production") === 0');
    expect(ab).toBeGreaterThan(-1);
    const block = C.slice(ab, ab + 700);
    expect(block).toContain("0 offene Schritte");
    expect(block).toContain("Der Publish-Stand bleibt unveraendert");
    expect(block).toContain("process.exit(0)");
  });
});
