import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

import {
  darfHochladen, entscheide, fasseZusammen, figurFuer,
  NIE_AUTOMATISCH, schluessel, type Bildzeile, type Figur,
} from "./image-import";

/**
 * CAT-04E — die Entscheidung, ob ein Bild an eine Figur darf.
 *
 * SIEBEN FÄLLE, UND JEDER IST EINER, DER SCHADEN ANRICHTEN KÖNNTE:
 * eine falsche Zuordnung, ein zweiter Lauf, eine fehlende Figur, ein
 * bestehendes Adminbild, eine kaputte Datei, ein Lauf ohne Freigabe — und
 * die drei namentlich ausgeschlossenen Entwürfe.
 *
 * Der Bucket `catalog` ist öffentlich lesbar: ein Upload ist eine
 * Veröffentlichung. Deshalb wird hier nicht die Hülle geprüft, sondern die
 * Entscheidung selbst, und zwar ohne jedes I/O.
 */

/** Ein echtes, winziges PNG — die Bytes entscheiden, nicht der Name. */
const PNG = (() => {
  const b = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64");
  return new Uint8Array(b);
})();
const PNG_HASH = createHash("sha256").update(PNG).digest("hex").slice(0, 16);

const zeile = (ueber: Partial<Bildzeile> = {}): Bildzeile => ({
  entwurf: "Crystal Clear Cynder (SA)",
  katalogname: "Crystal Clear Cynder",
  series_code: "SA",
  medium: "xl/media/image35.png",
  sha256_16: PNG_HASH,
  zuordnung: "eindeutig",
  ...ueber,
});

const figur = (ueber: Partial<Figur> = {}): Figur => ({
  sky_id: "SKY-0823",
  name: "Crystal Clear Cynder",
  series_code: "SA",
  image_override_path: null,
  ...ueber,
});

describe("1 — die Zuordnung trifft die richtige Figur", () => {
  it("über Name UND Serie, nicht über die Reihenfolge", () => {
    const figuren = [
      figur({ sky_id: "SKY-0900", name: "Crystal Clear Cynder", series_code: "G" }),
      figur({ sky_id: "SKY-0823" }),
    ];
    expect(figurFuer(zeile(), figuren)?.sky_id).toBe("SKY-0823");
  });

  it("und niemals über fortlaufende SKY-IDs", () => {
    /*
     * `sky_id_seq` zieht auch bei einem abgebrochenen Lauf weiter, und
     * zwischen zwei Läufen kann jemand anderes anlegen. „erste + i" würde
     * irgendwann die falsche Figur bebildern — deshalb wird gesucht.
     */
    const e = entscheide(zeile(), [figur({ sky_id: "SKY-4711" })], PNG);
    expect(e.art).toBe("hochladen");
    if (e.art === "hochladen") {
      expect(e.skyId).toBe("SKY-4711");
      expect(e.pfad).toBe(`SKY-4711/${PNG_HASH}.png`);
    }
  });

  it("zwei gleichnamige Figuren in derselben Serie sind KEINE Identität", () => {
    const zwei = [figur({ sky_id: "SKY-0823" }), figur({ sky_id: "SKY-0824" })];
    expect(figurFuer(zeile(), zwei)).toBeNull();
    expect(entscheide(zeile(), zwei, PNG)).toMatchObject(
      { art: "uebersprungen", grund: "ohne_sky_id" });
  });

  it("der Schlüssel faltet Schreibweisen, trennt aber Serien", () => {
    expect(schluessel("Crystal-Clear Cynder", "SA")).toBe(schluessel("Crystal Clear Cynder", "SA"));
    expect(schluessel("Cynder", "SA")).not.toBe(schluessel("Cynder", "G"));
  });
});

describe("2 — Wiederaufnahme nach einem Fehler", () => {
  it("was schon ein Bild hat, wird übersprungen", () => {
    const e = entscheide(zeile(), [figur({ image_override_path: "SKY-0823/abc.png" })], PNG);
    expect(e).toMatchObject({ art: "uebersprungen", grund: "hat_schon_ein_bild" });
  });

  it("und was noch keines hat, wird nachgeholt — ohne Zustandsdatei", () => {
    /*
     * DAS IST DER GANZE WIEDEREINSTIEG. Der Zustand steht in der Datenbank,
     * nicht in einer Akte neben dem Werkzeug: eine Akte könnte veralten, die
     * Spalte nicht.
     */
    const vorher = entscheide(zeile(), [figur()], PNG);
    expect(vorher.art).toBe("hochladen");
    const danach = entscheide(zeile(), [figur({ image_override_path: "SKY-0823/x.png" })], PNG);
    expect(danach.art).toBe("uebersprungen");
  });
});

describe("3 — ein zweiter Lauf ist folgenlos", () => {
  it("derselbe Inhalt ergibt denselben Pfad", () => {
    /* Inhaltsadressiert: ein zweiter Upload schreibt dasselbe Objekt an
       dieselbe Stelle. */
    const a = entscheide(zeile(), [figur()], PNG);
    const b = entscheide(zeile(), [figur()], PNG);
    expect(a).toEqual(b);
  });

  it("und nach dem ersten Lauf steht die Spalte, also greift Fall 2", () => {
    const nachLauf = figur({ image_override_path: `SKY-0823/${PNG_HASH}.png` });
    expect(entscheide(zeile(), [nachLauf], PNG)).toMatchObject(
      { art: "uebersprungen", grund: "hat_schon_ein_bild" });
  });
});

describe("4 — die Figur gibt es noch nicht", () => {
  it("ohne SKY-ID wird übersprungen, nicht geraten", () => {
    expect(entscheide(zeile(), [], PNG)).toMatchObject(
      { art: "uebersprungen", grund: "ohne_sky_id", skyId: null });
  });
});

describe("5 — eine fehlerhafte Bilddatei", () => {
  it("unbekanntes Format wird nicht hochgeladen", () => {
    const muell = new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e]);   // "<html>"
    expect(entscheide(zeile(), [figur()], muell)).toMatchObject(
      { art: "fehler", grund: "format_unbekannt" });
  });

  it("zu groß wird nicht hochgeladen", () => {
    const riesig = new Uint8Array(2 * 1024 * 1024 + 1);
    riesig.set(PNG.slice(0, 8));
    expect(entscheide(zeile(), [figur()], riesig)).toMatchObject(
      { art: "fehler", grund: "zu_gross" });
  });

  it("keine Bytes ist ein Fehler und kein stilles Überspringen", () => {
    expect(entscheide(zeile(), [figur()], null)).toMatchObject(
      { art: "fehler", grund: "keine_bytes" });
    expect(entscheide(zeile(), [figur()], new Uint8Array(0))).toMatchObject(
      { art: "fehler", grund: "keine_bytes" });
  });

  it("und eine Datei, die nicht zum Manifest passt, hält den Lauf an", () => {
    /*
     * DIE PRÜFSUMME IST DER ABGLEICH. Weicht sie ab, ist es eine andere
     * Datei als die, die CAT-04D zugeordnet hat — dann wird nicht geraten.
     */
    const e = entscheide(zeile({ sha256_16: "0000000000000000" }), [figur()], PNG);
    expect(e).toMatchObject({ art: "fehler", grund: "hash_weicht_ab" });
    if (e.art === "fehler") expect(e.text).toContain(PNG_HASH);
  });
});

describe("6 — ohne Freigabe wird nicht hochgeladen", () => {
  it("der Probelauf ist der Standard", () => {
    expect(darfHochladen([])).toBe(false);
    expect(darfHochladen(["--upload"])).toBe(false);
    expect(darfHochladen(["--rechte-geklaert"])).toBe(false);
  });

  it("und es braucht BEIDE Aussagen", () => {
    /* `--upload` ist die Absicht, `--rechte-geklaert` die Verantwortung für
       eine Veröffentlichung in einen öffentlich lesbaren Bucket. */
    expect(darfHochladen(["--upload", "--rechte-geklaert"])).toBe(true);
  });
});

describe("7 — die drei namentlich ausgeschlossenen", () => {
  it("bekommen nie automatisch ein Bild", () => {
    for (const name of NIE_AUTOMATISCH) {
      const e = entscheide(zeile({ katalogname: name }),
                           [figur({ name })], PNG);
      expect(e, name).toMatchObject({ art: "uebersprungen" });
    }
  });

  it("Mobile Hot Streak steht namentlich drin — mit dem Grund", () => {
    /* Es teilt sein Bild mit dem GEWÖHNLICHEN „Hot Streak"; das wäre das
       Standardbild für eine Variante. */
    expect(NIE_AUTOMATISCH).toContain("Mobile Hot Streak");
    expect(NIE_AUTOMATISCH).toHaveLength(3);
  });

  it("und mehrdeutige Zeilen ebenfalls nicht", () => {
    expect(entscheide(zeile({ zuordnung: "mehrdeutig" }), [figur()], PNG))
      .toMatchObject({ art: "uebersprungen", grund: "mehrdeutig" });
    expect(entscheide(zeile({ zuordnung: "fehlt" }), [figur()], PNG))
      .toMatchObject({ art: "uebersprungen", grund: "mehrdeutig" });
  });
});

describe("der Plan zählt, was zu tun wäre", () => {
  it("und unterscheidet Übersprungenes von Fehlern", () => {
    const plan = fasseZusammen([
      entscheide(zeile(), [figur()], PNG),
      entscheide(zeile(), [], PNG),
      entscheide(zeile({ zuordnung: "mehrdeutig" }), [figur()], PNG),
      entscheide(zeile(), [figur()], null),
    ]);
    expect(plan.hochladen).toBe(1);
    expect(plan.uebersprungen.ohne_sky_id).toBe(1);
    expect(plan.uebersprungen.mehrdeutig).toBe(1);
    expect(plan.fehler.keine_bytes).toBe(1);
  });
});
