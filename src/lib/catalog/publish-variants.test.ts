import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { ordneVariantenschritte, pruefeBasisziele, type VariantenSchritt }
  from "./publish-variants";

/* ==========================================================================
 * DIE VARIANTENBEZIEHUNG IM PUBLISH (CAT-11)
 *
 * Zwei Faelle, die bis hierher mitten im Apply abgebrochen waeren: ein
 * Verweis auf eine Basisfigur, die Production nie bekommt, und eine
 * Reihenfolge, die 0159 ablehnt. Beide werden jetzt vor dem ersten
 * Schreibzugriff entschieden.
 * ========================================================================== */

const anlegen = (sky: string): VariantenSchritt => ({ art: "figur-anlegen", sky_id: sky });
const basis = (sky: string, von: string, nach: string, art = "feld"): VariantenSchritt =>
  ({ art, sky_id: sky, feld: "base_sky_id", von, nach });
const feld = (sky: string, f: string, art = "feld"): VariantenSchritt =>
  ({ art, sky_id: sky, feld: f, von: "~", nach: "x" });

const reihe = (s: readonly VariantenSchritt[]) =>
  s.map((x) => `${x.sky_id}:${x.feld ?? x.art}${x.feld === "base_sky_id" ? `→${x.nach}` : ""}`);

describe("Riegel 5 — keine verwaiste Basisfigur", () => {
  it("Silver Boomer → Boomer: Boomer steht auf Production, also gut", () => {
    const plan = [anlegen("SKY-0929"), basis("SKY-0929", "~", "SKY-0010", "feld-neu")];
    expect(pruefeBasisziele(plan, new Set(["SKY-0010"])).ok).toBe(true);
  });

  it("eine Basisfigur, die derselbe Lauf anlegt, ist kein Waise", () => {
    const plan = [anlegen("SKY-0930"), anlegen("SKY-0931"),
                  basis("SKY-0931", "~", "SKY-0930", "feld-neu")];
    expect(pruefeBasisziele(plan, new Set()).ok).toBe(true);
  });

  it("eine Entwurfs-Basisfigur, die nie ankommt, bricht VOR dem Apply ab", () => {
    const plan = [anlegen("SKY-0931"), basis("SKY-0931", "~", "SKY-0836", "feld-neu")];
    const r = pruefeBasisziele(plan, new Set(["SKY-0010"]));
    expect(r.ok).toBe(false);
    expect(r.verwaist.map((s) => s.nach)).toEqual(["SKY-0836"]);
  });

  it("Loesen (nach = ~) zeigt auf nichts und ist nie verwaist", () => {
    expect(pruefeBasisziele([basis("SKY-0011", "SKY-0010", "~")], new Set()).ok).toBe(true);
  });
});

describe("ordneVariantenschritte — die Reihenfolge, die 0159 verlangt", () => {
  it("laesst einen Plan ohne Variantenschritte unveraendert", () => {
    const plan = [anlegen("A"), feld("A", "types", "feld-neu"), feld("B", "card_type")];
    expect(ordneVariantenschritte(plan)).toEqual(plan);
  });

  it("Fall 1: X wird Basisfigur, die NEUE Figur Y Variante von X — X zuerst", () => {
    /* So sortiert der Apply-Pfad: feld-neu (Y) vor feld (X). */
    const plan = [
      anlegen("Y"),
      feld("Y", "types", "feld-neu"),
      basis("Y", "~", "X", "feld-neu"),
      feld("Y", "familie", "feld-neu"),
      basis("X", "W", "~"),
      feld("X", "card_type"),
    ];
    expect(reihe(ordneVariantenschritte(plan))).toEqual([
      "Y:figur-anlegen", "Y:types", "X:base_sky_id→~", "Y:base_sky_id→X", "Y:familie", "X:card_type",
    ]);
  });

  it("Fall 2: F wird Variante, ihre alte Variante V haengt erst um — V zuerst", () => {
    const plan = [basis("F", "~", "G"), basis("V", "F", "G")];
    expect(reihe(ordneVariantenschritte(plan))).toEqual(["V:base_sky_id→G", "F:base_sky_id→G"]);
  });

  it("ist stabil: unabhaengige Schritte behalten ihre Reihenfolge", () => {
    const plan = [basis("A", "~", "P"), basis("B", "~", "Q"), basis("C", "~", "R")];
    expect(ordneVariantenschritte(plan)).toEqual(plan);
  });

  it("verliert und verdoppelt keinen Schritt", () => {
    const plan = [anlegen("Y"), basis("Y", "~", "X", "feld-neu"), feld("Y", "familie", "feld-neu"),
                  basis("X", "W", "~"), basis("V", "F", "G"), basis("F", "~", "G"), feld("Z", "usk_rating")];
    const geordnet = ordneVariantenschritte(plan);
    expect(geordnet).toHaveLength(plan.length);
    expect(new Set(geordnet)).toEqual(new Set(plan));
  });

  it("haelt „Varianten vor Familien“: kein familie-Schritt rutscht vor den ersten Basisschritt", () => {
    const plan = [anlegen("Y"), basis("Y", "~", "X", "feld-neu"), feld("Y", "familie", "feld-neu"),
                  basis("X", "W", "~"), feld("X", "familie")];
    const g = reihe(ordneVariantenschritte(plan));
    const ersteBasis = g.findIndex((x) => x.includes("base_sky_id"));
    const ersteFamilie = g.findIndex((x) => x.includes("familie"));
    expect(ersteBasis).toBeLessThan(ersteFamilie);
  });

  it("bricht bei einem Zyklus ab, statt irgendeine Reihenfolge zu raten", () => {
    const plan = [basis("A", "B", "B"), basis("B", "A", "A")];
    expect(() => ordneVariantenschritte(plan)).toThrow(/Zyklus/);
  });
});

describe("beide Werkzeuge benutzen die Riegel", () => {
  it("der Planer prueft Riegel 5 im Publish", () => {
    const sync = readFileSync("tools/catalog-sync.mts", "utf8");
    expect(sync).toContain("pruefeBasisziele(");
    expect(sync).toContain("RIEGEL 5");
  });

  it("der Apply-Pfad ordnet nach der Sortierung und vor dem ersten Schreiben", () => {
    const apply = readFileSync("tools/catalog-sync-apply.mts", "utf8");
    const sortiert = apply.indexOf("schritte.sort(");
    const geordnet = apply.indexOf("ordneVariantenschritte(schritte)");
    const schreibt = apply.indexOf("W.rpc(");
    expect(sortiert).toBeGreaterThan(-1);
    expect(geordnet).toBeGreaterThan(sortiert);
    expect(schreibt).toBeGreaterThan(geordnet);
  });
});
