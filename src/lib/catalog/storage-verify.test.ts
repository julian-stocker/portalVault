import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { beurteile, etappeAModus, noetigeMenge, zusammenfassung, nameAusPfad,
         type Objekt } from "./storage-verify.ts";

/* ==========================================================================
 * ETAPPE A — übertragen oder verifizieren?
 *
 * Der Abbruch vom 2026-10-31 („RIEGEL 2 — der Dry-Run nennt keinen
 * Bildschritt") kam nicht von einem kaputten Riegel, sondern von einem
 * Runner, der den Apply unbedingt aufrief. Diese Datei hält beides fest: das
 * Verhalten der Urteilslogik mit echten Bytes, und die Zusagen am Quelltext
 * der beiden Werkzeuge.
 * ========================================================================== */

const WERKZEUG = readFileSync("tools/storage-transfer.mts", "utf8");
const RUNNER = readFileSync("tools/catalog-finish.mts", "utf8");
const ohneKommentare = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter((z) => !z.trimStart().startsWith("//")).join("\n");
const W = ohneKommentare(WERKZEUG);
const R = ohneKommentare(RUNNER);

/** Bytes, deren SHA-256 den Pfad trägt — so, wie der Bucket es verlangt. */
function inhaltsadressiert(sky: string, text: string, endung = "png") {
  const bytes = new Uint8Array(Buffer.from(text, "utf8"));
  const sha = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
  return { pfad: `${sky}/${sha.slice(0, 16)}.${endung}`, sky_id: sky, bytes };
}
const obj = (bytes: Uint8Array): Objekt => ({ bytes });

const A = inhaltsadressiert("SKY-0492", "bild-a");
const B = inhaltsadressiert("SKY-0585", "bild-b");

describe("etappeAModus — der Plan entscheidet, nicht der Ablauf", () => {
  it("0 offene Bildtransfers → verifizieren, nicht übertragen", () => {
    expect(etappeAModus(0)).toBe("pruefen");
  });

  it("mindestens einer → der bisherige Apply-Pfad", () => {
    expect(etappeAModus(1)).toBe("apply");
    expect(etappeAModus(17)).toBe("apply");
  });
});

describe("noetigeMenge — eng gefasst, mit Absicht", () => {
  it("vereinigt übertragene und geplante Pfade, ohne Dublette", () => {
    const m = noetigeMenge(
      [{ pfad: A.pfad, sky_id: A.sky_id }],
      [{ pfad: A.pfad, sky_id: A.sky_id }, { pfad: B.pfad, sky_id: B.sky_id }]);
    expect(m).toHaveLength(2);
    // ein Pfad, der BEIDES ist, zählt als übertragen — er liegt schon dort
    expect(m.find((x) => x.pfad === A.pfad)?.herkunft).toBe("uebertragen");
    expect(m.find((x) => x.pfad === B.pfad)?.herkunft).toBe("geplant");
  });

  it("nimmt einseitige Pfade NICHT auf", () => {
    /*
     * Die 37 Entwürfe auf Staging werden nach ADR-0163 nie veröffentlicht.
     * Eine Etappe A, die an ihnen scheitert, hält den Publish aus einem
     * Grund auf, der ihn nichts angeht.
     */
    const m = noetigeMenge([], []);
    expect(m).toEqual([]);
  });

  it("ordnet stabil nach Pfad", () => {
    const m = noetigeMenge(
      [{ pfad: B.pfad, sky_id: B.sky_id }, { pfad: A.pfad, sky_id: A.sky_id }], []);
    expect(m.map((x) => x.pfad)).toEqual([A.pfad, B.pfad].sort());
  });
});

describe("0 offene Bildtransfers, alle Objekte vorhanden → Etappe A erfolgreich", () => {
  it("ein übertragenes Objekt, beidseitig und bytegleich, ist in Ordnung", () => {
    const u = beurteile({ pfad: A.pfad, sky_id: A.sky_id, herkunft: "uebertragen" },
      obj(A.bytes), obj(A.bytes));
    expect(u.befund).toBe(false);
    expect(u.zustand).toBe("vorhanden, bytegleich, inhaltsadressiert");
    expect(u.bytegleich).toBe(true);
    expect(u.groesse).toBe(A.bytes.byteLength);
  });

  it("die Zusammenfassung ist bestanden und zählt alles als in Ordnung", () => {
    const z = zusammenfassung([
      beurteile({ pfad: A.pfad, sky_id: A.sky_id, herkunft: "uebertragen" },
        obj(A.bytes), obj(A.bytes)),
      beurteile({ pfad: B.pfad, sky_id: B.sky_id, herkunft: "uebertragen" },
        obj(B.bytes), obj(B.bytes)),
    ]);
    expect(z).toMatchObject({ geprueft: 2, in_ordnung: 2, befunde: 0,
      noch_nicht_uebertragen: 0, bestanden: true, leer: false });
  });

  it("eine LEERE Prüfung ist kein Erfolg", () => {
    const z = zusammenfassung([]);
    expect(z.leer).toBe(true);
    expect(z.geprueft).toBe(0);
  });
});

describe("0 offene Bildtransfers, Objekt fehlt → Abbruch", () => {
  it("ein übertragenes Objekt, das im Ziel fehlt, ist ein Befund", () => {
    const u = beurteile({ pfad: A.pfad, sky_id: A.sky_id, herkunft: "uebertragen" },
      null, obj(A.bytes));
    expect(u.befund).toBe(true);
    expect(u.zustand).toBe("FEHLT IM ZIEL, WAR ABER UEBERTRAGEN");
    expect(zusammenfassung([u]).bestanden).toBe(false);
  });

  it("es fehlt auch dann als Befund, wenn die Gegenseite es ebenfalls nicht hat", () => {
    const u = beurteile({ pfad: A.pfad, sky_id: A.sky_id, herkunft: "uebertragen" },
      null, null);
    expect(u.befund).toBe(true);
  });

  it("ein GEPLANTER Pfad, der fehlt, ist KEIN Befund", () => {
    /*
     * Dass er fehlt, ist der Grund, warum er im Plan steht. Dafür ist der
     * Apply-Pfad da. Hier als Befund zu werten hieße, den Normalzustand vor
     * einem Transfer zum Fehler zu erklären.
     */
    const u = beurteile({ pfad: B.pfad, sky_id: B.sky_id, herkunft: "geplant" },
      null, obj(B.bytes));
    expect(u.befund).toBe(false);
    expect(u.zustand).toBe("noch nicht uebertragen (Planschritt)");
    const z = zusammenfassung([u]);
    expect(z).toMatchObject({ bestanden: true, noch_nicht_uebertragen: 1, in_ordnung: 0 });
  });
});

describe("0 offene Bildtransfers, Hash falsch → Abbruch", () => {
  it("der Name passt nicht zum Inhalt → Befund", () => {
    const fremd = new Uint8Array(Buffer.from("ein anderer inhalt", "utf8"));
    const u = beurteile({ pfad: A.pfad, sky_id: A.sky_id, herkunft: "uebertragen" },
      obj(fremd), obj(fremd));
    expect(u.befund).toBe(true);
    expect(u.zustand).toBe("NAME PASST NICHT ZUM INHALT");
    expect(u.hinweis).toContain(nameAusPfad(A.pfad));
  });

  it("der Name wird vor dem Byte-Vergleich geprüft", () => {
    /*
     * Zwei gleich falsche Objekte wären bytegleich. Die Prüfsumme muss
     * zuerst kommen, sonst gilt derselbe Fehler auf beiden Seiten als
     * Erfolg.
     */
    const fremd = new Uint8Array(Buffer.from("beide gleich falsch", "utf8"));
    const u = beurteile({ pfad: A.pfad, sky_id: A.sky_id, herkunft: "uebertragen" },
      obj(fremd), obj(fremd));
    expect(u.zustand).toBe("NAME PASST NICHT ZUM INHALT");
    expect(u.bytegleich).toBeNull();      // gar nicht erst verglichen
  });

  it("vorhanden, Name stimmt, aber nicht bytegleich → Befund", () => {
    /*
     * Konstruiert: das Zielobjekt trägt den richtigen Hash, die Gegenseite
     * hat am selben Pfad etwas anderes. Bei inhaltsadressierten Pfaden darf
     * das nicht vorkommen — und genau deshalb ist es ein Befund und kein
     * Routinefall.
     */
    const u = beurteile({ pfad: A.pfad, sky_id: A.sky_id, herkunft: "uebertragen" },
      obj(A.bytes), obj(new Uint8Array(Buffer.from("etwas anderes", "utf8"))));
    expect(u.befund).toBe(true);
    expect(u.zustand).toBe("NICHT BYTEGLEICH");
    expect(u.bytegleich).toBe(false);
  });

  it("ein Pfad ohne Dateinamen ist ein Befund, kein stiller Durchlauf", () => {
    const u = beurteile({ pfad: "SKY-0492", sky_id: "SKY-0492", herkunft: "uebertragen" },
      obj(A.bytes), null);
    expect(u.befund).toBe(true);
  });

  it("ein Pfad, der nicht zu seiner Figur gehört, ist ein Befund (Riegel 3)", () => {
    const u = beurteile({ pfad: A.pfad, sky_id: "SKY-0999", herkunft: "uebertragen" },
      obj(A.bytes), obj(A.bytes));
    expect(u.befund).toBe(true);
    expect(u.zustand).toBe("PFAD GEHOERT NICHT ZU SEINER FIGUR");
  });

  it("einseitig vorhanden und mit richtigem Hash ist in Ordnung, aber benannt", () => {
    const u = beurteile({ pfad: A.pfad, sky_id: A.sky_id, herkunft: "uebertragen" },
      obj(A.bytes), null);
    expect(u.befund).toBe(false);
    expect(u.bytegleich).toBeNull();
    expect(u.hinweis).toContain("kein Byte-Vergleich");
  });
});

describe("offene Bildtransfers → der bisherige sichere Apply-Pfad", () => {
  it("der Runner wählt je Richtung, und zwar aus dem Plan", () => {
    expect(R).toContain("const bildschritte = (p: Plan, ziel: string)");
    expect(R).toContain('x.feld === "image_override_path" && x.ziel === ziel');
    // M-04: production carries the id-bearing confirmation into the child.
    expect(R).toContain('["--ziel", ziel, "--apply", ...(ziel === "production" ? [productionConfirmation()] : [])]');
    expect(R).toContain('["--ziel", ziel, "--pruefen"]');
    // und nicht mehr unbedingt
    expect(R).not.toContain('["--ziel", "staging", "--apply"]');
    expect(R).not.toContain('["--ziel", "production", "--apply"]');
  });

  it("der Apply-Pfad behält alle Riegel", () => {
    for (const riegel of ["RIEGEL 0", "RIEGEL 2", "RIEGEL 2b", "Riegel 3 ok"]) {
      expect(W, riegel).toContain(riegel);
    }
    expect(W).toContain('ANWENDEN && ZIEL_ARG === null');     // Riegel 0
  });

  it("Riegel 2 ist nicht deaktiviert — er prüft jetzt den PLAN statt der Auswahl", () => {
    /*
     * Vorher: `schritte.length === 0` (die Auswahl). Dadurch meldete eine
     * leere RICHTUNG „der Dry-Run nennt keinen Bildschritt" — was nicht
     * stimmte — und Riegel 2b war unerreichbar.
     */
    expect(W).toContain("alleSchritte.length === 0 && !PRUEFEN");
    expect(W).toContain("schritte.length === 0 && !PRUEFEN");
    expect(W).not.toMatch(/if \(schritte\.length === 0\) \{/);
  });

  it("`--apply` und `--pruefen` schließen sich aus", () => {
    expect(W).toContain("ANWENDEN && PRUEFEN");
  });
});

describe("keine doppelten Uploads, kein Überschreiben, kein Löschen", () => {
  it("`upsert` ist aus, und ein vorhandener Pfad wird übersprungen", () => {
    expect(W).toContain("upsert: false");
    expect(W).not.toContain("upsert: true");
    expect(W).toContain("ZIEL HAT SCHON EIN OBJEKT — uebersprungen");
  });

  it("`storage.remove` kommt nirgends vor", () => {
    expect(WERKZEUG).not.toContain(".remove(");
    expect(RUNNER).not.toContain(".remove(");
  });

  it("der Prüfmodus hat überhaupt keinen Schreibweg", () => {
    const ab = W.indexOf("if (PRUEFEN) {");
    const bis = W.indexOf("type Ergebnis = Schritt", ab);
    expect(ab).toBeGreaterThan(-1);
    expect(bis).toBeGreaterThan(ab);
    const block = W.slice(ab, bis);
    for (const schreibend of [".upload(", ".remove(", ".update(", ".insert(", ".rpc("]) {
      expect(block, schreibend).not.toContain(schreibend);
    }
    expect(block).toContain(".download(");
  });

  it("der Prüfmodus endet, bevor der Transferpfad beginnt", () => {
    /*
     * `process.exit(0)` am Ende des Prüfblocks: er fällt nicht in die
     * Übertragungsschleife durch.
     */
    const ab = W.indexOf("if (PRUEFEN) {");
    const schleife = W.indexOf("for (const s of schritte) {", ab);
    const block = W.slice(ab, schleife);
    expect(block).toContain("process.exit(0)");
  });
});

describe("ein Befund muss einen Fehlercode haben", () => {
  it("der Transferpfad endet bei einem Befund mit exit 1", () => {
    /*
     * Diese Lücke fiel erst am 2026-10-31 auf: die Datei meldete
     * „Fehler: 3" und endete mit Code 0. Der Runner ruft sie über
     * `execFileSync` auf und bricht nur bei einem Fehlercode ab — ein
     * fehlgeschlagener Upload wäre berichtet und übergangen worden.
     */
    expect(W).toContain("const befundhaft = ergebnisse.filter");
    const ab = W.indexOf("const befundhaft = ergebnisse.filter");
    expect(W.slice(ab)).toContain("process.exit(1)");
  });

  it("der Prüfmodus ebenso", () => {
    const ab = W.indexOf("if (!z.bestanden)");
    expect(ab).toBeGreaterThan(-1);
    expect(W.slice(ab, ab + 400)).toContain("process.exit(1)");
  });

  it("der Runner bricht ab, wenn ein Werkzeug einen Fehlercode liefert", () => {
    /*
     * BEIDE Aufrufstellen, nicht nur eine: `werkzeug` und `werkzeugImmer`.
     * `execFileSync` wirft bei einem Fehlercode, und beide fangen es, um
     * abzubrechen — nicht, um weiterzumachen.
     */
    const stellen = [...R.matchAll(/execFileSync\("node", \[was, \.\.\.argumente\]/g)];
    expect(stellen.length).toBe(2);
    for (const m of stellen) {
      const nach = R.slice(m.index!, m.index! + 220);
      expect(nach).toContain("} catch {");
      expect(nach).toContain("abbruch(etappe,");
      expect(nach).toContain("endete mit einem Fehler");
    }
  });
});
