import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { driftBericht, LEDGER_MARKE, pruefeDrift, pruefeLedger, standAbdruck,
         type Ledger, type Stand } from "./publish-drift.ts";
import { GEREGELT } from "./publish-compare.ts";

/* ==========================================================================
 * DER DRIFTRIEGEL
 *
 * Riegel 2 des Bootstrap prüfte beide Umgebungen gegen einen eingefrorenen
 * Messwert. Im Dauerbetrieb wäre das falsch: Staging bearbeiten ist der
 * Zweck. Geprüft wird deshalb Herkunft statt Unverändertheit — jedes Feld
 * auf Production trägt entweder den veröffentlichten oder den Staging-Wert.
 * ========================================================================== */

const PLANER = readFileSync("tools/catalog-sync.mts", "utf8");
const PUBLISH = readFileSync("tools/catalog-publish.mts", "utf8");
const ohne = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter((z) => !z.trimStart().startsWith("//")).join("\n");

/** Drei Felder genügen, um jeden Fall zu zeigen. */
const FELDER = ["card_type", "catalog_visible", "familie"] as const;
function ledgerVon(stand: Stand): Ledger {
  const { zeilen, abdruck } = standAbdruck(stand);
  return { marke: LEDGER_MARKE, veroeffentlicht_am: "2026-10-31T12:00:00.000Z",
           staging: "s", production: "p", geregelte_felder: FELDER,
           zeilen, abdruck, stand };
}

describe("pruefeLedger — eine von Hand veränderte Datei trägt keine Aussage", () => {
  it("ein in sich schlüssiger Stand besteht", () => {
    expect(pruefeLedger(ledgerVon({ "SKY-0001": "standard|true|Spyro" })).ok).toBe(true);
  });

  it("ein verfälschter Abdruck fällt auf", () => {
    const l = { ...ledgerVon({ "SKY-0001": "standard|true|Spyro" }), abdruck: "0".repeat(32) };
    const r = pruefeLedger(l);
    expect(r.ok).toBe(false);
    expect(r.befunde.join(" ")).toContain("von Hand veraendert");
  });

  it("eine falsche Zeilenzahl fällt auf", () => {
    const l = { ...ledgerVon({ "SKY-0001": "standard|true|Spyro" }), zeilen: 2 };
    expect(pruefeLedger(l).ok).toBe(false);
  });

  it("eine falsche Marke fällt auf", () => {
    const l = { ...ledgerVon({ "SKY-0001": "a|b|c" }), marke: "etwas-anderes" };
    expect(pruefeLedger(l).befunde.join(" ")).toContain("unbekannte Marke");
  });

  it("eine Zeile mit falscher Feldzahl fällt auf", () => {
    const l = ledgerVon({ "SKY-0001": "nur|zwei" });
    expect(pruefeLedger(l).befunde.join(" ")).toContain("2 Werte, 3 geregelte Felder");
  });

  it("der Abdruck ist von der Schlüsselreihenfolge unabhängig", () => {
    const a = standAbdruck({ "SKY-0002": "x|y|z", "SKY-0001": "a|b|c" });
    const b = standAbdruck({ "SKY-0001": "a|b|c", "SKY-0002": "x|y|z" });
    expect(a.abdruck).toBe(b.abdruck);
  });
});

describe("1. eine normale Staging-Feldänderung", () => {
  const l = ledgerVon({ "SKY-0001": "standard|true|Spyro" });
  it("ist kein Drift — Production trägt noch den veröffentlichten Wert", () => {
    const b = pruefeDrift(l, { "SKY-0001": "chase|true|Spyro" },
                             { "SKY-0001": "standard|true|Spyro" });
    expect(b.ok).toBe(true);
    expect(b.unberuehrt).toBe(3);
    expect(b.publiziert).toBe(0);
    expect(b.drift).toEqual([]);
  });
});

describe("2. das unveränderte Production-Ziel wird aktualisiert", () => {
  const l = ledgerVon({ "SKY-0001": "standard|true|Spyro" });
  it("danach zählt das Feld als publiziert, nicht als Drift", () => {
    const b = pruefeDrift(l, { "SKY-0001": "chase|true|Spyro" },
                             { "SKY-0001": "chase|true|Spyro" });
    expect(b.ok).toBe(true);
    expect(b.publiziert).toBe(1);
    expect(b.unberuehrt).toBe(2);
  });
});

describe("3. Production-Drift wird erkannt und blockiert", () => {
  const l = ledgerVon({ "SKY-0001": "standard|true|Spyro" });

  it("ein dritter Wert ist Drift, mit Feld und allen drei Werten benannt", () => {
    const b = pruefeDrift(l, { "SKY-0001": "chase|true|Spyro" },
                             { "SKY-0001": "prestige|true|Spyro" });
    expect(b.ok).toBe(false);
    expect(b.drift).toEqual([{ sky_id: "SKY-0001", feld: "card_type",
      veroeffentlicht: "standard", staging: "chase", production: "prestige" }]);
  });

  it("Drift auch dann, wenn Staging gar nichts geändert hat", () => {
    const b = pruefeDrift(l, { "SKY-0001": "standard|true|Spyro" },
                             { "SKY-0001": "standard|false|Spyro" });
    expect(b.ok).toBe(false);
    expect(b.drift[0].feld).toBe("catalog_visible");
  });

  it("eine Zeile, die nur Production veröffentlicht, ist Drift", () => {
    const b = pruefeDrift(l, { "SKY-0001": "standard|true|Spyro" },
      { "SKY-0001": "standard|true|Spyro", "SKY-0777": "standard|true|~" });
    expect(b.ok).toBe(false);
    expect(b.nur_production).toEqual(["SKY-0777"]);
  });

  it("der Bericht nennt jeden Befund einzeln", () => {
    const b = pruefeDrift(l, { "SKY-0001": "chase|false|Spyro" },
                             { "SKY-0001": "prestige|true|Eruptor" });
    expect(b.drift).toHaveLength(2);     // card_type und familie; visible ist veroeffentlicht
    const z = driftBericht(b).filter((x) => x.startsWith("DRIFT"));
    expect(z).toHaveLength(2);
    expect(z.join(" ")).toContain("SKY-0001.card_type");
    expect(z.join(" ")).toContain("SKY-0001.familie");
  });
});

describe("5. eine neue Figur mit neuem Charakter", () => {
  it("steht als neu auf Staging, nicht als Drift", () => {
    const l = ledgerVon({ "SKY-0001": "standard|true|Spyro" });
    const b = pruefeDrift(l,
      { "SKY-0001": "standard|true|Spyro", "SKY-0929": "chase|true|Dune Bug" },
      { "SKY-0001": "standard|true|Spyro" });
    expect(b.ok).toBe(true);
    expect(b.neu_auf_staging).toEqual(["SKY-0929"]);
    expect(b.drift).toEqual([]);
  });

  it("und nach dem Publish ist sie auf beiden Seiten, immer noch kein Drift", () => {
    const l = ledgerVon({ "SKY-0001": "standard|true|Spyro" });
    const b = pruefeDrift(l,
      { "SKY-0001": "standard|true|Spyro", "SKY-0929": "chase|true|Dune Bug" },
      { "SKY-0001": "standard|true|Spyro", "SKY-0929": "chase|true|Dune Bug" });
    expect(b.ok).toBe(true);
    expect(b.nur_production).toEqual([]);
  });
});

describe("10. ein teilweise abgeschlossener Publish lässt sich neu planen", () => {
  /*
   * DER FALL, DER DEN RIEGEL GEFORMT HAT. Drei Felder sollen von A nach B;
   * der Lauf schreibt zwei und bricht ab. Eine reine Gleichheitsprüfung
   * gegen den Stand würde hier blockieren — und genau daran ist der
   * Bootstrap viermal gescheitert.
   */
  const l = ledgerVon({
    "SKY-0001": "standard|true|Spyro",
    "SKY-0002": "standard|true|Spyro",
    "SKY-0003": "standard|true|Spyro",
  });
  const staging: Stand = {
    "SKY-0001": "chase|true|Spyro",
    "SKY-0002": "chase|true|Spyro",
    "SKY-0003": "chase|true|Spyro",
  };
  const halb: Stand = {
    "SKY-0001": "chase|true|Spyro",     // geschrieben
    "SKY-0002": "chase|true|Spyro",     // geschrieben
    "SKY-0003": "standard|true|Spyro",  // offen
  };

  it("kommt durch, und benennt was schon geschrieben ist", () => {
    const b = pruefeDrift(l, staging, halb);
    expect(b.ok).toBe(true);
    expect(b.publiziert).toBe(2);
    expect(b.unberuehrt).toBe(7);       // 9 Felder minus die zwei geschriebenen
  });

  it("ein fremder Eingriff MITTEN im Teillauf fällt trotzdem auf", () => {
    const b = pruefeDrift(l, staging,
      { ...halb, "SKY-0003": "prestige|true|Spyro" });
    expect(b.ok).toBe(false);
    expect(b.drift).toHaveLength(1);
    expect(b.drift[0].sky_id).toBe("SKY-0003");
  });
});

describe("14. null Änderungen ergeben einen sauberen No-op", () => {
  it("alles unberührt, kein Befund", () => {
    const stand: Stand = { "SKY-0001": "standard|true|Spyro" };
    const b = pruefeDrift(ledgerVon(stand), stand, stand);
    expect(b).toMatchObject({ ok: true, unberuehrt: 3, publiziert: 0 });
    expect(b.drift).toEqual([]);
    expect(b.neu_auf_staging).toEqual([]);
    expect(b.nur_production).toEqual([]);
  });
});

describe("eine Zeile, die Staging nicht mehr veröffentlicht", () => {
  it("wird gemeldet, ist aber kein Drift — Production folgt dem Status", () => {
    const l = ledgerVon({ "SKY-0001": "standard|true|Spyro",
                          "SKY-0002": "standard|true|Spyro" });
    const b = pruefeDrift(l, { "SKY-0001": "standard|true|Spyro" },
      { "SKY-0001": "standard|true|Spyro", "SKY-0002": "standard|true|Spyro" });
    expect(b.ok).toBe(true);
    expect(driftBericht(b).join(" ")).not.toContain("DRIFT");
  });

  it("wird sie auf Production verändert, während Staging sie nicht führt, ist es Drift", () => {
    const l = ledgerVon({ "SKY-0001": "standard|true|Spyro" });
    const b = pruefeDrift(l, {}, { "SKY-0001": "prestige|true|Spyro" });
    expect(b.ok).toBe(false);
    expect(b.drift[0].staging).toBe("(Zeile fehlt)");
  });
});

/* ------------------------------------------------- Verdrahtung und Trennung */

describe("der Planer benutzt den Driftriegel im Publish", () => {
  const c = ohne(PLANER);

  it("im Publish gegen den Stand, im Bootstrap gegen den Einfrierwert", () => {
    expect(c).toContain("if (BOOTSTRAP) {");
    expect(c).toContain("D.fingerprint_live");
    expect(c).toContain("pruefeDrift(ledger, standS, standP)");
    // der eingefrorene Wert wird im Publish NICHT mehr gelesen
    const ab = c.indexOf("} else {", c.indexOf("if (BOOTSTRAP) {"));
    expect(c.slice(ab)).not.toContain("fingerprint_live");
  });

  it("eine fehlende oder unschlüssige Standdatei bricht ab", () => {
    expect(c).toContain("ist nicht lesbar");
    expect(c).toContain("Eine fehlende Datei ist kein Bestehen");
    expect(c).toContain("pruefeLedger(ledger)");
  });

  it("er prüft, dass der Stand dieselben geregelten Felder nennt", () => {
    expect(c).toContain('ledger.geregelte_felder.join("|") !== GEREGELT.join("|")');
  });

  it("Drift bricht ab, statt berichtet zu werden", () => {
    expect(c).toContain("if (!drift.ok && !RIEGEL2_MESSEN)");
    expect(c).toContain("Production ist von Hand veraendert worden");
  });
});

describe("zwei Dateien, zwei Aufgaben", () => {
  it("das Siegel wird vom Publish NICHT geschrieben", () => {
    const c = ohne(PUBLISH);
    expect(c).toContain("resources/sync/publish-ledger.json");
    expect(c).not.toContain('writeFileSync("resources/sync/catalog-baseline.json"');
    expect(PUBLISH).toContain("bleibt unangetastet");
  });

  it("der Stand wird nur bei --apply fortgeschrieben", () => {
    const c = ohne(PUBLISH);
    const ab = c.indexOf("const probe = pruefeLedger(neu)");
    expect(ab).toBeGreaterThan(-1);
    const block = c.slice(ab, ab + 900);
    expect(block).toContain("if (APPLY) {");
    expect(block).toContain("writeFileSync(LEDGER");
  });

  it("der fortgeschriebene Stand wird vor dem Schreiben auf Schlüssigkeit geprüft", () => {
    const c = ohne(PUBLISH);
    expect(c.indexOf("pruefeLedger(neu)")).toBeLessThan(c.indexOf("writeFileSync(LEDGER"));
  });

  it("die Standdatei im Repository ist schlüssig und passt zum Vergleich", () => {
    const l = JSON.parse(readFileSync("resources/sync/publish-ledger.json", "utf8")) as Ledger;
    expect(pruefeLedger(l).befunde).toEqual([]);
    expect(l.geregelte_felder).toEqual([...GEREGELT]);
    expect(l.zeilen).toBe(655);
  });

  it("und sie entspricht dem Siegel des einmaligen Abgleichs", () => {
    const l = JSON.parse(readFileSync("resources/sync/publish-ledger.json", "utf8")) as Ledger;
    const siegel = JSON.parse(readFileSync("resources/sync/catalog-baseline.json", "utf8")) as
      { geregelt: { production: { zeilen: number; abdruck: string } } };
    expect(l.abdruck).toBe(siegel.geregelt.production.abdruck);
    expect(l.zeilen).toBe(siegel.geregelt.production.zeilen);
  });
});
