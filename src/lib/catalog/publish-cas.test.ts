import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { KLASSE_B_FELDER, SPALTE, planwert, pruefeNachher, pruefeVorher } from "./publish-cas";

/* ==========================================================================
 * COMPARE-AND-SET FUER DIE FUNKTIONSSCHRITTE (CAT-11)
 *
 * Types, Banner, Basisfigur und Familie gehen ueber Admin-Funktionen, die
 * keinen erwarteten Wert kennen. Ohne diese Pruefung haette ein Publish eine
 * Aenderung, die auf Production zwischen Plan und Schritt passiert ist, still
 * ueberschrieben.
 * ========================================================================== */

const NAMEN = new Map([[7, "Spyro"], [105, "Fire Kraken"]]);
const basis = { wie: "feld base_sky_id SKY-0929", markeIst: "t1", markeErwartet: "t1" };

describe("planwert — die gelesene Spalte in der Schreibweise des Plans", () => {
  it("NULL ist ~, eine Menge sortiert mit +, eine Familie ihr Name", () => {
    expect(planwert("base_sky_id", null, NAMEN)).toBe("~");
    expect(planwert("types", ["swapper", "chase"], NAMEN)).toBe("chase+swapper");
    expect(planwert("types", [], NAMEN)).toBe("~");
    expect(planwert("familie", 105, NAMEN)).toBe("Fire Kraken");
  });

  it("eine unbekannte Familien-id stimmt mit keinem Planwert ueberein", () => {
    expect(planwert("familie", 999, NAMEN)).toBe("#999");
  });

  it("kennt die Spalte jedes der vier Felder", () => {
    expect(KLASSE_B_FELDER.map((f) => SPALTE[f]))
      .toEqual(["types", "visible_type", "base_sky_id", "character_id"]);
  });
});

describe("VORHER — der erwartete Zustand, sonst kein Schreiben", () => {
  it("der erwartete alte Wert: frei", () => {
    expect(pruefeVorher({ ...basis, ist: "~", von: "~", nach: "SKY-0010" }).ok).toBe(true);
  });

  it("schon der neue Wert (Teillauf, oder eine Nachbarfunktion hat ihn gesetzt): frei", () => {
    expect(pruefeVorher({ ...basis, ist: "SKY-0010", von: "~", nach: "SKY-0010" }).ok).toBe(true);
  });

  it("ein DRITTER Wert auf Production: Abbruch, nichts wird ueberschrieben", () => {
    const u = pruefeVorher({ ...basis, ist: "SKY-0011", von: "~", nach: "SKY-0010" });
    expect(u.ok).toBe(false);
    expect(u.grund).toContain("fremder Wert");
  });

  it("eine bewegte Marke: Abbruch, auch wenn der Wert noch passt", () => {
    const u = pruefeVorher({ ...basis, markeIst: "t2", ist: "~", von: "~", nach: "SKY-0010" });
    expect(u.ok).toBe(false);
    expect(u.grund).toContain("bewegt");
  });

  it("ohne Marke wird nicht geschrieben", () => {
    expect(pruefeVorher({ ...basis, markeErwartet: undefined, ist: "~", von: "~", nach: "x" }).ok)
      .toBe(false);
  });

  it("das Banner darf „–“ sein, wenn der Types-Schritt desselben Laufs es entfernt hat", () => {
    const ohne = pruefeVorher({ ...basis, ist: "~", von: "elite", nach: "chase" });
    const mit = pruefeVorher({ ...basis, ist: "~", von: "elite", nach: "chase", auchErlaubt: ["~"] });
    expect(ohne.ok).toBe(false);
    expect(mit.ok).toBe(true);
  });
});

describe("NACHHER — genau der geplante Wert", () => {
  it("stimmt: weiter", () => {
    expect(pruefeNachher({ wie: "x", ist: "chase", nach: "chase" }).ok).toBe(true);
  });
  it("weicht ab: Abbruch, und die fremde Marke wird nicht uebernommen", () => {
    expect(pruefeNachher({ wie: "x", ist: "giant", nach: "chase" }).ok).toBe(false);
    const apply = readFileSync("tools/catalog-sync-apply.mts", "utf8");
    const nach = apply.indexOf("const nachUrteil = pruefeNachher(");
    const marke = apply.indexOf("eintrag.updated_at = nachher.marke");
    expect(nach).toBeGreaterThan(-1);
    expect(marke).toBeGreaterThan(nach);
  });
});

describe("der Apply-Pfad prueft JEDEN Funktionsschritt", () => {
  const apply = readFileSync("tools/catalog-sync-apply.mts", "utf8");
  const zweig = apply.slice(apply.indexOf("} else if (s.feld && s.feld in RPC_B) {"),
                            apply.indexOf('} else if (s.feld === "catalog_visible"'));

  it("liest vor der Funktion, prueft, und ruft sie erst danach", () => {
    const vor = zweig.indexOf("pruefeVorher(");
    const rpc = zweig.indexOf("await W.rpc(r.fn");
    const nach = zweig.indexOf("pruefeNachher(");
    expect(vor).toBeGreaterThan(-1);
    expect(rpc).toBeGreaterThan(vor);
    expect(nach).toBeGreaterThan(rpc);
  });

  it("ein negatives Urteil bricht ab — es wird nicht weitergeschrieben", () => {
    expect(zweig).toContain("if (!vorUrteil.ok) throw new Error(`TOR 2b — ${vorUrteil.grund}`)");
    expect(zweig).toContain("if (!nachUrteil.ok) throw new Error(`TOR 2b — ${nachUrteil.grund}`)");
  });

  it("die bestehenden Riegel bleiben: TOR 1, TOR 2 (update-Felder) und TOR 3 (Journal)", () => {
    expect(apply).toContain(".eq(\"updated_at\", updatedAt as string)");
    expect(apply).toContain("journalDelta !== erwarteteJournalzeilen");
  });
});
