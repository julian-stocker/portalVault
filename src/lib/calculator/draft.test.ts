import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  decodeDraft, DRAFT_KEY, draftFingerprint, encodeDraft, EMPTY_DRAFT,
  hasUnsavedChanges, isEmptyDraft,
} from "./draft";
import { addFigure, setUnitCents, type CalculationLine } from "./calculation";

/**
 * Der Arbeitsstand (Calculator V2, ADR-0131).
 *
 * Die Frage, die diese Datei beantwortet: kann ein Arbeitsstand unbemerkt
 * verloren gehen oder mit einer gespeicherten Kalkulation verwechselt
 * werden? Alles hier ist reine Form — kein Browser, keine Datenbank.
 */

const SPYRO = { skyId: "SKY-0001", name: "Spyro", series: "SA", marketPrice: 12.9 };
const GILL = { skyId: "SKY-0003", name: "Gill Grunt", series: "SA", marketPrice: 8 };

const bau = (...c: { skyId: string; name: string; series: string; marketPrice: number }[]) =>
  c.reduce<CalculationLine[]>((lines, choice) => addFigure(lines, choice), []);

describe("Form und Rückform", () => {
  it("überlebt eine Runde durch den Text", () => {
    const draft = {
      lines: bau(SPYRO, GILL),
      factor: 65,
      loadedId: "0b6c0f3e-3a4a-4f0e-9a2a-9f5f5f5f5f5f",
      loadedName: "Willhaben – 35 Figuren",
      loadedFingerprint: "x",
    };
    const zurueck = decodeDraft(encodeDraft(draft));
    expect(zurueck.factor).toBe(65);
    expect(zurueck.loadedId).toBe(draft.loadedId);
    expect(zurueck.loadedName).toBe(draft.loadedName);
    expect(zurueck.lines.map((l) => l.skyId)).toEqual(draft.lines.map((l) => l.skyId));
  });

  it("behält die REIHENFOLGE — zuletzt hinzugefügt bleibt oben", () => {
    /* Die Reihenfolge ist fachlich (ADR-0131, Punkt 4) und muss ein
       Neuladen überleben, nicht nur ein Rendern. */
    const draft = { ...EMPTY_DRAFT, lines: bau(SPYRO, GILL) };
    expect(draft.lines[0].skyId).toBe("SKY-0003");
    expect(decodeDraft(encodeDraft(draft)).lines[0].skyId).toBe("SKY-0003");
  });

  it("behält einen selbst gesetzten Wert samt Kennzeichnung", () => {
    const lines = setUnitCents(bau(SPYRO), "SKY-0001", 1000);
    const [zurueck] = decodeDraft(encodeDraft({ ...EMPTY_DRAFT, lines })).lines;
    expect(zurueck.unitCents).toBe(1000);
    expect(zurueck.manual).toBe(true);
    /* Und der Katalogvorschlag von damals bleibt daneben stehen. */
    expect(zurueck.suggestedCents).toBe(1290);
  });

  it("wirft nie — Unlesbares ist ein leerer Stand", () => {
    for (const roh of [null, "", "{", "[]", '{"version":1}', '{"version":99,"lines":[]}',
      '{"version":1,"lines":"nein"}', "42"]) {
      expect(() => decodeDraft(roh)).not.toThrow();
      expect(decodeDraft(roh).lines).toEqual([]);
    }
  });

  it("verwirft eine Position ohne gültige SKY-ID, nicht den ganzen Stand", () => {
    const text = JSON.stringify({
      version: 1,
      factor: 50,
      lines: [
        { sky_id: "SKY-0001", name: "Spyro", quantity: 1, unit_cents: 1290 },
        { sky_id: "kaputt", name: "Nichts", quantity: 1, unit_cents: 100 },
        { sky_id: "SKY-0003", name: "Gill Grunt", quantity: 2, unit_cents: 800 },
      ],
    });
    const zurueck = decodeDraft(text);
    expect(zurueck.lines.map((l) => l.skyId)).toEqual(["SKY-0001", "SKY-0003"]);
  });

  it("führt dieselbe Figur nicht zweimal — zwei gleiche React-Schlüssel gibt es nicht", () => {
    const text = JSON.stringify({
      version: 1,
      lines: [
        { sky_id: "SKY-0001", name: "Spyro", quantity: 1, unit_cents: 100 },
        { sky_id: "SKY-0001", name: "Spyro", quantity: 5, unit_cents: 900 },
      ],
    });
    expect(decodeDraft(text).lines).toHaveLength(1);
  });
});

describe("der Abdruck beantwortet genau eine Frage", () => {
  it("gleiche Rechnung, gleicher Abdruck", () => {
    expect(draftFingerprint(bau(SPYRO, GILL), 50))
      .toBe(draftFingerprint(bau(SPYRO, GILL), 50));
  });

  it("eine andere Menge, ein anderer Abdruck", () => {
    const a = bau(SPYRO);
    const b = addFigure(a, SPYRO);
    expect(draftFingerprint(a, 50)).not.toBe(draftFingerprint(b, 50));
  });

  it("ein anderer Faktor zählt auch als Änderung", () => {
    const lines = bau(SPYRO);
    expect(draftFingerprint(lines, 50)).not.toBe(draftFingerprint(lines, 60));
  });

  it("die REIHENFOLGE zählt mit — sonst wäre Umsortieren unsichtbar", () => {
    expect(draftFingerprint(bau(SPYRO, GILL), 50))
      .not.toBe(draftFingerprint(bau(GILL, SPYRO), 50));
  });

  it("ein Bild oder ein Name ändert nichts — das ist keine Änderung des Händlers", () => {
    const lines = bau(SPYRO);
    const anders = lines.map((l) => ({ ...l, image: "/anders.webp", name: "Spyro (neu)" }));
    expect(draftFingerprint(anders, 50)).toBe(draftFingerprint(lines, 50));
  });
});

describe("ungespeicherte Änderungen", () => {
  it("ein leerer Stand hat keine", () => {
    expect(hasUnsavedChanges(EMPTY_DRAFT)).toBe(false);
    expect(isEmptyDraft(EMPTY_DRAFT)).toBe(true);
  });

  it("ein frisch getipptes Inserat hat welche — es gehört noch keiner Kalkulation", () => {
    expect(hasUnsavedChanges({ ...EMPTY_DRAFT, lines: bau(SPYRO) })).toBe(true);
  });

  it("direkt nach dem Öffnen einer gespeicherten Kalkulation nicht", () => {
    const lines = bau(SPYRO, GILL);
    const draft = {
      lines, factor: 55, loadedId: "x", loadedName: "n",
      loadedFingerprint: draftFingerprint(lines, 55),
    };
    expect(hasUnsavedChanges(draft)).toBe(false);
  });

  it("nach einer Änderung schon", () => {
    const lines = bau(SPYRO);
    const draft = {
      lines, factor: 55, loadedId: "x", loadedName: "n",
      loadedFingerprint: draftFingerprint(lines, 55),
    };
    expect(hasUnsavedChanges({ ...draft, lines: addFigure(lines, GILL) })).toBe(true);
  });

  it("und eine zurückgenommene Änderung ist keine", () => {
    /*
     * DER GRUND FÜR EINEN ABDRUCK STATT EINES SCHALTERS. Wer eine Menge
     * erhöht und wieder senkt, hat nichts geändert — ein `dirty`-Schalter
     * hätte hier eine Rückfrage für nichts erzeugt, und Rückfragen für
     * nichts bringen bei, sie wegzuklicken.
     */
    const lines = bau(SPYRO);
    const abdruck = draftFingerprint(lines, 55);
    const hin = addFigure(lines, SPYRO);
    const zurueck = hin.map((l) => ({ ...l, quantity: 1 }));
    expect(hasUnsavedChanges({
      lines: zurueck, factor: 55, loadedId: "x", loadedName: "n",
      loadedFingerprint: abdruck,
    })).toBe(false);
  });
});

describe("der Schlüssel im Browser", () => {
  it("heißt nach dem Kalkulator und trägt seine Fassung", () => {
    expect(DRAFT_KEY).toBe("skyisles.calculator.draft.v1");
  });

  it("ist weder der Warenkorb noch die Ansichtswahl", () => {
    /* Ein geteilter Schlüssel wäre ein stiller Datenverlust in beide
       Richtungen. */
    const cart = readFileSync("src/lib/cart/cart.ts", "utf8");
    expect(cart).not.toContain(DRAFT_KEY);
    expect(readFileSync("src/components/collection/view-mode.ts", "utf8"))
      .not.toContain(DRAFT_KEY);
  });

  it("es gab vorher nichts zu übernehmen — V1 schrieb nicht in den Browser", () => {
    /*
     * Die Behauptung aus dem Kopf von `draft.ts`, hier nachgerechnet: kein
     * anderer Schlüssel beginnt mit `skyisles.calculator`, und der
     * Kalkulator V1 fasste `localStorage` nirgends an. Es kann also kein
     * Altstand verloren gehen — das ist der Nachweis, nicht eine Zusage.
     */
    for (const datei of ["src/components/calculator/calculator-modal.tsx",
      "src/lib/calculator/calculation.ts", "src/lib/calculator/actions.ts"]) {
      const roh = readFileSync(datei, "utf8");
      const code = roh.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*(?:\/\/|\*).*$/gm, "");
      expect(code, datei).not.toContain("skyisles.calculator");
    }
  });
});
