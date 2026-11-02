import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  familienWidersprueche, gebrauchteFamilien, ordneFamilienschritte, ordneVariantenschritte,
  type FamilienZeile, type VariantenSchritt,
} from "./publish-variants";
import { bewerteFamilienbild, type Familienbild } from "./publish-cas";

/**
 * CAT-19 — der Catalog-Publish und die vererbte Familie (`0168`, ADR-0171).
 *
 * Drei Zusagen:
 *   1. Familienschritte der Basisfiguren laufen VOR denen ihrer Varianten —
 *      sonst weist ein Ziel mit `0168` die Variante ab.
 *   2. Riegel 7 / TOR 1c: kein Plan mit einer Variante, deren Familie von
 *      ihrer Basisfigur abweicht, wird ausgeführt.
 *   3. Production legt nur Familien an, die eine veröffentlichte Figur trägt.
 * Und der Executor zählt, was die Kaskade nebenbei bewegt, statt daran zu
 * scheitern.
 */

const s = (sky_id: string, feld: string, nach = "X", von = "~"): VariantenSchritt =>
  ({ art: "feld", sky_id, feld, von, nach });

describe("ordneFamilienschritte — Basisfiguren vor Varianten", () => {
  const basisVon = (id: string) =>
    ({ "SKY-0850": "SKY-0147", "SKY-0871": "SKY-0278" } as Record<string, string>)[id] ?? null;

  it("eine Variante mit kleinerer SKY-ID wartet auf ihre Basisfigur", () => {
    const plan = [s("SKY-0001", "familie"), s("SKY-0850", "familie", "Sprocket"),
                  s("SKY-0147", "familie", "Sprocket"), s("SKY-0871", "familie"),
                  s("SKY-0278", "familie")];
    const ids = ordneFamilienschritte(plan, basisVon).map((x) => x.sky_id);
    expect(ids.indexOf("SKY-0147")).toBeLessThan(ids.indexOf("SKY-0850"));
    expect(ids.indexOf("SKY-0278")).toBeLessThan(ids.indexOf("SKY-0871"));
  });

  it("verschiebt nichts anderes und verliert und verdoppelt keinen Schritt", () => {
    const plan = [s("SKY-0010", "display_name_override"), s("SKY-0850", "base_sky_id", "SKY-0147"),
                  s("SKY-0850", "familie"), s("SKY-0147", "familie"), s("SKY-0010", "card_type")];
    const aus = ordneFamilienschritte(plan, basisVon);
    expect(aus).toHaveLength(plan.length);
    expect(new Set(aus)).toEqual(new Set(plan));
    expect(aus[0]).toBe(plan[0]);
    expect(aus[1]).toBe(plan[1]);                       // base_sky_id bleibt vor den Familien
    expect(aus.map((x) => x.feld)).toEqual(
      ["display_name_override", "base_sky_id", "familie", "familie", "card_type"]);
  });

  it("ohne Familienschritte ist sie die Identität", () => {
    const plan = [s("SKY-0010", "card_type"), s("SKY-0011", "types")];
    expect(ordneFamilienschritte(plan, basisVon)).toEqual(plan);
  });

  it("und verträgt sich mit der Ordnung der Basisschritte (CAT-11)", () => {
    const plan = [s("SKY-0850", "base_sky_id", "SKY-0147"), s("SKY-0850", "familie"),
                  s("SKY-0147", "familie")];
    const aus = ordneFamilienschritte(ordneVariantenschritte(plan), basisVon);
    expect(aus.map((x) => `${x.sky_id}:${x.feld}`))
      .toEqual(["SKY-0850:base_sky_id", "SKY-0147:familie", "SKY-0850:familie"]);
  });
});

describe("Riegel 7 — keine Variante mit fremder Familie", () => {
  const z = (base: string | null, familie: string | null): FamilienZeile => ({ base_sky_id: base, familie });
  const stand = new Map<string, FamilienZeile>([
    ["SKY-0015", z(null, "Chop Chop")],
    ["SKY-0832", z("SKY-0015", null)],                  // Gold Chop Chop: fehlt
    ["SKY-0078", z(null, null)],
    ["SKY-0829", z("SKY-0078", "Whirlwind")],           // Glow Warnado: zu viel
    ["SKY-0170", z(null, "Prism Break")],
    ["SKY-0854", z("SKY-0170", "Prism Break")],         // korrigiert: richtig
    ["SKY-0147", z(null, "Sprocket")],
    ["SKY-0278", z(null, "Sprocket")],                  // serienübergreifend: kein Widerspruch
  ]);

  it("findet beide Richtungen — fehlende und überzählige Familie", () => {
    expect(familienWidersprueche(stand)).toEqual([
      { sky_id: "SKY-0829", basis: "SKY-0078", familie: "Whirlwind", basisFamilie: null },
      { sky_id: "SKY-0832", basis: "SKY-0015", familie: null, basisFamilie: "Chop Chop" },
    ]);
  });

  it("zählt nur, was veröffentlicht würde", () => {
    expect(familienWidersprueche(stand, (id) => id !== "SKY-0829")).toHaveLength(1);
  });

  it("zwei Basisfiguren in einer Familie sind kein Widerspruch", () => {
    expect(familienWidersprueche(new Map([["SKY-0147", z(null, "Sprocket")],
                                          ["SKY-0278", z(null, "Sprocket")]]))).toEqual([]);
  });
});

describe("Production legt nur gebrauchte Familien an", () => {
  it("eine leere oder nur von Entwürfen getragene Familie entsteht dort nicht", () => {
    const gebraucht = gebrauchteFamilien([
      { base_sky_id: null, familie: "Chop Chop", gilt: true },
      { base_sky_id: null, familie: "Twin Blade Chop Chop", gilt: false },   // nur ein Entwurf
      { base_sky_id: null, familie: null, gilt: true },
    ]);
    expect([...gebraucht]).toEqual(["Chop Chop"]);
  });
});

describe("der Planer", () => {
  const planer = readFileSync("tools/catalog-sync.mts", "utf8");

  it("legt im Publish nur gebrauchte Familien an — der versiegelte Bootstrap bleibt", () => {
    expect(planer).toContain("&& (BOOTSTRAP || gebraucht.has(c.canonical_name as string))");
  });

  it("misst Riegel 7 am Staging-Stand und schreibt das Ergebnis in den Plan", () => {
    expect(planer).toContain("const familienwidersprueche = BOOTSTRAP ? [] : familienWidersprueche(");
    expect(planer).toMatch(/fingerprint_gemessen: fp, kollisionen,\s+familienwidersprueche,/);
  });
});

describe("der Executor", () => {
  const ex = readFileSync("tools/catalog-sync-apply.mts", "utf8");

  it("TOR 1c: ohne Riegel 7 im Plan oder mit einem Widerspruch wird nichts geschrieben", () => {
    expect(ex).toContain("if (plan.familienwidersprueche === undefined) {");
    expect(ex).toContain("if (plan.familienwidersprueche.length > 0) {");
    expect(ex.indexOf("TOR 1c")).toBeLessThan(ex.indexOf("const vorher = await baseline(R);"));
  });

  it("ordnet die Familien nach den Basisschritten", () => {
    expect(ex.indexOf("ordneVariantenschritte(schritte)"))
      .toBeLessThan(ex.indexOf("ordneFamilienschritte(schritte,"));
  });

  it("schreibt einen schon vererbten Familienwert nicht und erwartet dafür kein Journal", () => {
    const zweig = ex.slice(ex.indexOf('if (feldB === "familie" && vorher.ist === t(s.nach)) {'));
    expect(zweig.slice(0, 600)).toContain("erwarteteJournalzeilen -= journalt;");
    expect(zweig.slice(0, 600)).toContain("continue;");
    /* Vor dem Schreiben geprüft — nicht danach. */
    expect(ex.indexOf('if (feldB === "familie" && vorher.ist === t(s.nach)) {'))
      .toBeLessThan(ex.indexOf("await W.rpc(r.fn, { p_sky_id: s.sky_id, [r.arg]: wert })"));
  });

  it("misst die Kaskade vorher und nachher und nimmt nur den Wert der Basisfigur hin", () => {
    expect(ex).toContain("const bildVor = familienschritt ? await familienbild(s.sky_id) : null;");
    expect(ex).toContain("const bildNach = await familienbild(s.sky_id);");
    expect(ex).toContain("bewerteFamilienbild({");
    expect(ex).toContain("if (befund.fehler !== null) throw new Error(`TOR 2c");
    expect(ex).toContain("erwarteteJournalzeilen += befund.nebenbei;");
    /* Die Marken der mitbewegten Varianten — sonst scheitern ihre eigenen Schritte. */
    expect(ex).toContain("if (mit) { mit.updated_at = n.updated_at; mit.character_id = n.character_id; }");
  });

  it("ruft die Löschfunktion nie — Production räumt keine Familie selbst weg", () => {
    expect(ex).not.toContain("admin_delete_empty_character");
    expect(readFileSync("tools/catalog-sync.mts", "utf8")).not.toContain("admin_delete_empty_character");
    expect(readFileSync("tools/catalog-publish.mts", "utf8")).not.toContain("admin_delete_empty_character");
  });

  it("die geschützten Tabellen bleiben im Postflight dieselben", () => {
    for (const t of ["shop_inventory", "inventory_movements", "orders", "order_lines", "invoices",
                     "catalog_editorial", "collection_items", "favorites"]) {
      expect(ex, t).toContain(`["${t}"`);
    }
  });
});

describe("die App räumt nur auf Staging auf", () => {
  const actions = readFileSync("src/lib/admin/actions.ts", "utf8");
  it("nur über isEditorialCatalogSource, nur nach Erfolg", () => {
    const fn = actions.slice(actions.indexOf("async function leereFamilienAufraeumen"));
    expect(fn.slice(0, 400)).toContain("if (ids.length === 0 || !isEditorialCatalogSource()) return;");
    const set = actions.slice(actions.indexOf("export async function setFigureCharacter"));
    expect(set.slice(0, 2500)).toContain("if (ergebnis.ok) {");
  });
});

describe("bewerteFamilienbild — was ein Schritt nebenbei bewegen darf", () => {
  const bild = (z: [string, number | null, string | null][]): Familienbild =>
    new Map(z.map(([id, c, b]) => [id, { character_id: c, base_sky_id: b, updated_at: `t-${id}-${c}` }]));

  it("familie an der Basisfigur: jede Variante auf genau ihren Wert, je eine Journalzeile", () => {
    const b = bewerteFamilienbild({ feld: "familie", skyId: "SKY-0147",
      vor: bild([["SKY-0147", null, null], ["SKY-0850", null, "SKY-0147"], ["SKY-0851", 1, "SKY-0147"]]),
      nach: bild([["SKY-0147", 1, null], ["SKY-0850", 1, "SKY-0147"], ["SKY-0851", 1, "SKY-0147"]]) });
    expect(b.fehler).toBeNull();
    expect(b.nebenbei).toBe(1);          // SKY-0851 stand schon dort
    expect(b.mitbewegt.map(([id]) => id)).toEqual(["SKY-0850"]);
  });

  it("eine Variante auf einem ANDEREN Wert ist ein fremder Eingriff", () => {
    const b = bewerteFamilienbild({ feld: "familie", skyId: "SKY-0147",
      vor: bild([["SKY-0147", null, null], ["SKY-0850", null, "SKY-0147"]]),
      nach: bild([["SKY-0147", 1, null], ["SKY-0850", 2, "SKY-0147"]]) });
    expect(b.fehler).toContain("SKY-0850");
  });

  it("base_sky_id: die übernommene eigene Familie zählt, Varianten dürfen sich nicht bewegen", () => {
    const ok = bewerteFamilienbild({ feld: "base_sky_id", skyId: "SKY-0850",
      vor: bild([["SKY-0850", null, null]]), nach: bild([["SKY-0850", 1, "SKY-0147"]]) });
    expect(ok).toMatchObject({ fehler: null, nebenbei: 1, eigeneUebernommen: true, eigeneNeu: 1 });
    const unveraendert = bewerteFamilienbild({ feld: "base_sky_id", skyId: "SKY-0850",
      vor: bild([["SKY-0850", 1, null]]), nach: bild([["SKY-0850", 1, "SKY-0147"]]) });
    expect(unveraendert).toMatchObject({ nebenbei: 0, eigeneUebernommen: false });
  });
});

describe("das Aufräumen kann ein gelungenes Speichern nicht verderben", () => {
  const actions = readFileSync("src/lib/admin/actions.ts", "utf8");
  it("Aufräumen und Vorher-Lesen werfen nie", () => {
    const auf = actions.slice(actions.indexOf("async function leereFamilienAufraeumen"));
    expect(auf.slice(0, 1200)).toMatch(/try \{[\s\S]*\} catch \(fehler\) \{/);
    const von = actions.slice(actions.indexOf("async function familienVon"));
    expect(von.slice(0, 700)).toMatch(/try \{[\s\S]*\} catch \{\s*return \[\];/);
  });
  it("das Ergebnis der Zuordnung bleibt das Ergebnis — das Aufräumen ändert es nicht", () => {
    const set = actions.slice(actions.indexOf("export async function setFigureCharacter"));
    const rumpf = set.slice(0, set.indexOf("\n}\n"));
    expect(rumpf).toContain(
      "if (ergebnis.ok) {\n    await leereFamilienAufraeumen(vorher.filter((id) => id !== characterId));\n  }\n  return ergebnis;");
  });
});
