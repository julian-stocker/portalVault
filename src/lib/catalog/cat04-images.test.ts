import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

/**
 * CAT-04D — die Bilder der Checkliste, den Entwürfen zugeordnet.
 *
 * WORUM ES GEHT, und es ist eine Identitätsfrage und keine Kosmetik: ein
 * Variantenbild gehört zu GENAU einer Variante. Ein „Crystal Clear Cynder"
 * mit dem Foto des violetten Standard-Cynder wäre nicht ein hübscheres
 * Produkt, sondern ein falsches.
 *
 * WAS DIESE DATEI PRÜFT: die Zusagen des Werkzeugs, aus seinem Quelltext,
 * und das Ergebnis, wenn ein Lauf es erzeugt hat. Die .xlsx selbst kann der
 * Testlauf nicht voraussetzen.
 */
const lies = (p: string) => readFileSync(p, "utf8");
const PY = lies("tools/lib/cat04-images.py");
const TS_ = lies("tools/cat04-images.mts");
const IMPORT = lies("tools/cat03-import.mts");
const MANIFEST = "resources/analysis/cat-04-bildmanifest.json";

describe("die Zuordnung kommt aus den Ankern", () => {
  it("nicht aus der Reihenfolge der Mediendateien", () => {
    /* `image47.png` ist die ERSTE Figur der Liste, `image3.png` die zweite —
       die Dateinummern sagen nichts. */
    expect(PY).toContain("drawing1.xml.rels");
    expect(PY).toContain("blip");
    expect(PY).toContain('frm.find(XDR + "col")');
    expect(PY).toContain('frm.find(XDR + "row")');
  });

  it("und die Zeilenverschiebung ist bewiesen, nicht angenommen", () => {
    /*
     * DER FEHLSCHLUSS, DER BEIM BAUEN PASSIERT IST: ein Test „steht in der
     * Zeile darunter ein Name?" bestätigt auch `+3`, weil die Mengenspalte
     * die Zeichenkette "0" enthält und als Name durchgeht. Erst die
     * Mengenprüfung trennt die beiden Fälle.
     */
    for (const teil of ["bildzeile", "name_darunter", "mit_hyperlink", "menge_darunter"]) {
      expect(PY, teil).toContain(teil);
    }
    /* Und der Beweis ist eine BEDINGUNG: trägt er nicht, wird nichts
       zugeordnet. */
    expect(PY).toContain("der Strukturbeweis traegt nicht");
    expect(PY).toContain('hart = ("bildzeile", "name_darunter", "menge_darunter")');
  });

  it("ein unbekannter Ankertyp bricht ab statt still zu fehlen", () => {
    expect(PY).toContain("twoCellAnchor");
    expect(PY).toContain("Ankerelemente, die dieser Lauf nicht liest");
  });
});

describe("kein Standardbild für eine Sonderedition", () => {
  it("ein mehrfach benutztes Medium gilt als mehrdeutig", () => {
    expect(PY).toContain('"eindeutig" if mehrfach[medium] == 1 else "mehrdeutig"');
  });

  it("und nur Eindeutiges wird ausgepackt", () => {
    expect(PY).toContain('if zeile["zuordnung"] == "eindeutig" and zeile["pipeline"] == "geeignet"');
  });
});

describe("die Bilder bleiben lokal", () => {
  it("das Werkzeug hat keinen Datenbank- und keinen Netzzugang", () => {
    const code = PY.replace(/"""[\s\S]*?"""/g, "").replace(/^\s*#.*$/gm, "");
    for (const verboten of ["urlopen", "requests", "socket", "SUPABASE", "fetch("]) {
      expect(code, verboten).not.toContain(verboten);
    }
    const tsCode = TS_.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*(\/\/|\*).*$/gm, "");
    expect(tsCode).not.toContain("fetch(");
    expect(tsCode).not.toContain("staging-guard");
  });

  it("und nichts landet in public/ oder im Bucket", () => {
    const code = PY.replace(/"""[\s\S]*?"""/g, "").replace(/^\s*#.*$/gm, "");
    expect(code).not.toContain("public/images");
    expect(code).toContain('PRUEFDIR = Path("resources/review/cat-04-bilder")');
    /* Der Riegel gegen einen versehentlichen Commit steht VOR dem Auspacken. */
    expect(TS_).toContain('writeFileSync("resources/review/.gitignore"');
    expect(TS_.indexOf("resources/review/.gitignore"))
      .toBeLessThan(TS_.indexOf("cat04-images.py"));
  });

  it("die Herkunft und der Rechtestand stehen bei den Dateien", () => {
    /*
     * SEIT DEM 2026-10-27 IST DIE NUTZUNG FREIGEGEBEN — vom Betreiber, der
     * erklärt hat, die Rechte selbst geprüft zu haben. Diese Zeile prüft,
     * dass die Dateien das sagen UND dass sie dazusagen, WESSEN Aussage es
     * ist. Eine Freigabe als eigene Prüfung auszugeben wäre die eine
     * Formulierung, die hier nicht stehen darf.
     */
    expect(TS_).toContain("HERKUNFT.md");
    expect(TS_).toContain("vom Betreiber freigegeben");
    expect(TS_).toContain("SEINE Aussage, nicht meine");
    if (existsSync("resources/review/cat-04-bilder/HERKUNFT.md")) {
      const h = lies("resources/review/cat-04-bilder/HERKUNFT.md");
      expect(h).toContain("vom Betreiber freigegeben");
      expect(h).toContain("SEINE Aussage, nicht meine");
      /* Und sie bleiben trotzdem aus dem Repository draußen. */
      expect(h).toContain("gitignore");
    }
  });
});

describe("die Importhülle setzt weiterhin kein Bild", () => {
  it("sie schreibt die ZUORDNUNG in die Notiz, nicht das Bild", () => {
    expect(IMPORT).toContain("NICHT uebernommen");
    expect(IMPORT).toContain("Zugeordnetes Bild");
    /* Und sie sagt, warum: der Bucket ist öffentlich. */
    expect(IMPORT).toContain("oeffentlich lesbar");
  });

  it.runIf(existsSync("supabase/operations/staging-cat03-import.sql"))(
    "und die erzeugte Hülle nennt keine Bildspalte", () => {
      const sql = lies("supabase/operations/staging-cat03-import.sql");
      const insert = sql.slice(sql.indexOf("insert into public.skylanders"),
                               sql.indexOf("-- Die interne Notiz"));
      expect(insert).not.toContain("image_file");
      expect(insert).not.toContain("image_override_path");
      /* Die Zuordnung steht trotzdem drin — als Notiz. */
      expect(sql).toContain("Zugeordnetes Bild: xl/media/");
    });
});

describe("das Manifest, wenn ein Lauf es erzeugt hat", () => {
  it.runIf(existsSync(MANIFEST))("der Strukturbeweis trägt an allen Ankern", () => {
    const m = JSON.parse(lies(MANIFEST));
    const b = m.strukturbeweis;
    expect(b.anker).toBeGreaterThan(0);
    for (const k of ["bildzeile", "name_darunter", "menge_darunter"]) {
      expect(b[k], k).toBe(b.anker);
    }
    /* Genau ein Blatt und eine Zeichnung — sonst wäre die Lesart unvollständig. */
    expect(b.blaetter_und_zeichnungen).toBe(2);
    expect(b.anker_elemente).toBe(b.anker);
  });

  it.runIf(existsSync(MANIFEST))("jede eindeutige Zuordnung ist pipelinetauglich", () => {
    const m = JSON.parse(lies(MANIFEST));
    for (const z of m.zuordnungen) {
      expect(["eindeutig", "mehrdeutig", "fehlt"]).toContain(z.zuordnung);
      if (z.zuordnung !== "eindeutig") {
        /* Mehrdeutiges und Fehlendes wird NICHT ausgepackt. */
        expect(z.pruefdatei, z.entwurf).toBe("");
        continue;
      }
      expect(["png", "jpg", "webp"], z.entwurf).toContain(z.format);
      expect(z.bytes, z.entwurf).toBeLessThanOrEqual(2 * 1024 * 1024);
      expect(z.sha256_16, z.entwurf).toMatch(/^[0-9a-f]{16}$/);
      /* Der Zielpfad ist eine SCHABLONE — die SKY-ID gibt es noch nicht. */
      expect(z.zielpfad).toMatch(/^catalog\/<SKY-ID>\/[0-9a-f]{16}\.(png|jpg|webp)$/);
    }
  });

  it.runIf(existsSync(MANIFEST))("kein Medium hängt an zwei eindeutigen Zuordnungen", () => {
    /*
     * DIE EIGENTLICHE ZUSAGE. Teilen sich zwei Entwürfe eine Datei, ist
     * mindestens einer von beiden falsch bebildert — und welcher, entscheidet
     * kein Werkzeug.
     */
    const m = JSON.parse(lies(MANIFEST));
    const gesehen = new Map<string, string>();
    for (const z of m.zuordnungen) {
      if (z.zuordnung !== "eindeutig") continue;
      expect(gesehen.has(z.medium), `${z.medium} doppelt: ${gesehen.get(z.medium)} / ${z.entwurf}`)
        .toBe(false);
      gesehen.set(z.medium, z.entwurf);
    }
  });
});

describe("der Plan für Stufe 2", () => {
  const PLAN = "supabase/checks/cat04d_bildimport_plan.md";

  it("nennt den Blocker, die Zweistufigkeit und die Wiederaufnahme", () => {
    const p = lies(PLAN);
    expect(p).toContain("öffentlich lesbar");
    expect(p).toContain("Ein Upload in diesen Bucket ist eine Veröffentlichung");
    expect(p).toContain("Der Pfad braucht die SKY-ID");
    /* SEIT CAT-04E: einmalige Vervollständigung statt Dauerbetrieb — der
       Wiedereinstieg bleibt derselbe, nur ohne eigenes System. */
    expect(p).toContain("EINMALIGER Lauf, kein System");
    expect(p).toContain("image-import.ts");
    expect(p).toContain("nie überschreiben");
  });
});
