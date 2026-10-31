import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { beurteileEtappeE, charakterIdentitaet, charakterMetadaten, feldAbweichungen,
         geregelteProjektion, CHARAKTER_METADATEN, FELDER, GEREGELT, UNGEREGELT,
         type Erwartung, type Messung, type Zeile } from "./publish-compare.ts";

/* ==========================================================================
 * ETAPPE E — die Prüfung, die nie bestehen konnte
 *
 * Etappe D lief am 2026-10-31 vollständig durch (573/573, journalDelta
 * 331 = erwartet, TOR 3 ohne Befund) und der Plan meldete 0 Schritte in
 * beiden Richtungen — und Etappe E brach trotzdem ab. Weil die beiden
 * Abdrücke Felder verglichen, die der Publish nicht überträgt und nach
 * ADR-0030 bzw. ADR-0034 auch nicht übertragen darf.
 * ========================================================================== */

const PLANER = readFileSync("tools/catalog-sync.mts", "utf8");
const RUNNER = readFileSync("tools/catalog-finish.mts", "utf8");
const APPLY = readFileSync("tools/catalog-sync-apply.mts", "utf8");
const ohne = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter((z) => !z.trimStart().startsWith("//")).join("\n");

/* -------------------------------------------------- die Felderaufteilung */

describe("welche Felder der Publish regelt", () => {
  it("ungeregelt sind genau name und slug — die Excel ist Hoheit (ADR-0030)", () => {
    expect([...UNGEREGELT]).toEqual(["name", "slug"]);
  });

  it("geregelt sind die übrigen 17 der 19 Felder", () => {
    expect(FELDER).toHaveLength(19);
    expect(GEREGELT).toHaveLength(17);
    expect(GEREGELT).not.toContain("name");
    expect(GEREGELT).not.toContain("slug");
    /*
     * `display_name_override` IST geregelt und wird übertragen — das ist der
     * sichtbare Name. Nur der gespeicherte folgt der Excel.
     */
    expect(GEREGELT).toContain("display_name_override");
  });

  it("die Reihenfolge der geregelten Felder folgt der von FELDER", () => {
    expect(GEREGELT).toEqual(FELDER.filter((f) => f !== "name" && f !== "slug"));
  });

  it("keines der sieben Charakterfelder steht unter den 19", () => {
    for (const f of CHARAKTER_METADATEN) {
      expect(FELDER as readonly string[], f).not.toContain(f);
    }
  });
});

describe("EINE Quelle für die Regel, nicht zwei", () => {
  it("der Planer nimmt UNGEREGELT, statt die Namen selbst zu nennen", () => {
    /*
     * GENAU HIER LAG DER FEHLER. Im Planer stand
     * `if (f === "name" || f === "slug") continue;` — und die
     * Fingerprintprüfung in Etappe E kannte diese Regel nicht.
     */
    expect(ohne(PLANER)).toContain('import { UNGEREGELT } from "../src/lib/catalog/publish-compare.ts"');
    expect(ohne(PLANER)).toContain("(UNGEREGELT as readonly string[]).includes(f)");
    expect(ohne(PLANER)).not.toContain('f === "name" || f === "slug"');
  });

  it("die drei FELDER-Listen stimmen Feld für Feld überein", () => {
    /*
     * Modul, Planer und Apply-Pfad führen je eine Liste. Sie werden hier
     * nicht zusammengelegt (der Apply-Pfad trägt sie in TOR 1 und Riegel 2),
     * aber ein Auseinanderlaufen wäre genau die Sorte Fehler, die Etappe E
     * aufgehalten hat.
     */
    const aus = (q: string) => {
      const m = /const FELDER = \[([\s\S]*?)\] as const;/.exec(q);
      return [...(m?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
    };
    expect(aus(PLANER)).toEqual([...FELDER]);
    expect(aus(APPLY)).toEqual([...FELDER]);
  });
});

/* --------------------------------------------------- die reine Urteilslogik */

const KN = ["element", "species", "role_type", "short_description",
            "source_url", "source_label", "verified_at"] as const;
const chr = (name: string, kuratiert: boolean): Zeile =>
  Object.fromEntries([["canonical_name", name],
    ...KN.map((f) => [f, kuratiert ? `${f}-wert` : null])]);

/** Eine Zeile, die in allen 19 Feldern einen Wert trägt. */
const fig = (id: string, name: string, extra: Partial<Zeile> = {}): Zeile => ({
  sky_id: id, name, slug: id.toLowerCase(), series_code: "SA", kategorie: "Kat",
  display_name_override: null, card_type: "standard", item_type: "figure",
  is_active: true, catalog_visible: true, catalog_status: "public",
  base_sky_id: null, familie: "Spyro", types: [], visible_type: null,
  visible_type_decided: false, image_file: `${id}.png`,
  image_override_path: null, source: "excel", usk_rating: null, ...extra,
});

describe("die geregelte Projektion", () => {
  it("ist gleich, wenn nur name und slug abweichen", () => {
    const S = new Map([["SKY-0001", fig("SKY-0001", "Air Lantern")]]);
    const P = new Map([["SKY-0001", fig("SKY-0001", "Air Latern",
      { slug: "anders" })]]);
    const a = geregelteProjektion(S, ["SKY-0001"]);
    const b = geregelteProjektion(P, ["SKY-0001"]);
    expect(a.abdruck).toBe(b.abdruck);
    expect(a.zeilen).toBe(1);
  });

  it("ist verschieden, sobald ein GEREGELTES Feld abweicht", () => {
    const S = new Map([["SKY-0001", fig("SKY-0001", "X")]]);
    const P = new Map([["SKY-0001", fig("SKY-0001", "X", { card_type: "chase" })]]);
    expect(geregelteProjektion(S, ["SKY-0001"]).abdruck)
      .not.toBe(geregelteProjektion(P, ["SKY-0001"]).abdruck);
  });

  it("sortiert nach SKY-ID — eine andere Eingabereihenfolge ändert nichts", () => {
    const m = new Map([["SKY-0002", fig("SKY-0002", "B")],
                       ["SKY-0001", fig("SKY-0001", "A")]]);
    expect(geregelteProjektion(m, ["SKY-0002", "SKY-0001"]).abdruck)
      .toBe(geregelteProjektion(m, ["SKY-0001", "SKY-0002"]).abdruck);
  });
});

describe("die ungeregelten Felder werden GEZÄHLT, nicht übergangen", () => {
  const S = new Map([
    ["SKY-0001", fig("SKY-0001", "Air Lantern")],
    ["SKY-0002", fig("SKY-0002", "Fire Acorn")],
    ["SKY-0003", fig("SKY-0003", "Gleich")],
  ]);
  const P = new Map([
    ["SKY-0001", fig("SKY-0001", "Air Latern")],
    ["SKY-0002", fig("SKY-0002", "Fire Acron")],
    ["SKY-0003", fig("SKY-0003", "Gleich")],
  ]);
  const ids = ["SKY-0001", "SKY-0002", "SKY-0003"];

  it("zählt genau die abweichenden Zeilen und nennt beide Werte", () => {
    const a = feldAbweichungen("name", S, P, ids);
    expect(a.anzahl).toBe(2);
    expect(a.liste).toEqual([
      { schluessel: "SKY-0001", staging: "Air Lantern", production: "Air Latern" },
      { schluessel: "SKY-0002", staging: "Fire Acorn", production: "Fire Acron" },
    ]);
  });

  it("der Abdruck ändert sich, wenn eine ANDERE Zeile abweicht", () => {
    const a = feldAbweichungen("name", S, P, ids);
    const P2 = new Map(P);
    P2.set("SKY-0001", fig("SKY-0001", "Air Lantern"));      // diese stimmt jetzt
    P2.set("SKY-0003", fig("SKY-0003", "Anders"));            // dafür diese nicht
    const b = feldAbweichungen("name", S, P2, ids);
    expect(b.anzahl).toBe(a.anzahl);          // gleiche Anzahl
    expect(b.abdruck).not.toBe(a.abdruck);    // andere Menge
  });

  it("ist unabhängig von der Reihenfolge der Eingabe", () => {
    expect(feldAbweichungen("name", S, P, [...ids].reverse()).abdruck)
      .toBe(feldAbweichungen("name", S, P, ids).abdruck);
  });
});

describe("Charaktere: Identität und Metadaten getrennt", () => {
  it("die Identität ist gleich, auch wenn die Metadaten abweichen", () => {
    const a = charakterIdentitaet(["Spyro", "Fire Kraken"]);
    const b = charakterIdentitaet(["Fire Kraken", "Spyro"]);
    expect(a.abdruck).toBe(b.abdruck);
    expect(a.zeilen).toBe(2);
  });

  it("ein fehlender Name bricht die Identität", () => {
    expect(charakterIdentitaet(["Spyro"]).abdruck)
      .not.toBe(charakterIdentitaet(["Spyro", "Fire Kraken"]).abdruck);
  });

  it("findet genau die Charaktere mit abweichenden Metadaten", () => {
    const S = new Map([["Spyro", chr("Spyro", true)],
                       ["Fire Kraken", chr("Fire Kraken", true)]]);
    const P = new Map([["Spyro", chr("Spyro", true)],
                       ["Fire Kraken", chr("Fire Kraken", false)]]);
    const m = charakterMetadaten(S, P);
    expect(m.anzahl).toBe(1);
    expect(m.namen).toEqual(["Fire Kraken"]);
    expect(m.liste).toHaveLength(CHARAKTER_METADATEN.length);
    expect(m.liste.every((x) => x.production === "~")).toBe(true);
  });

  it("beidseitig NULL ist keine Abweichung", () => {
    /*
     * Vier der fünf im Lauf angelegten Charaktere sind auf BEIDEN Seiten
     * NULL — nur `Fire Kraken` ist auf Staging kuratiert.
     */
    const S = new Map([["Dune Bug", chr("Dune Bug", false)]]);
    const P = new Map([["Dune Bug", chr("Dune Bug", false)]]);
    expect(charakterMetadaten(S, P).anzahl).toBe(0);
  });
});

/* ------------------------------------------------------------- Das Urteil */

const GEMESSEN: Messung = {
  geregelt: { staging: { zeilen: 655, abdruck: "df54fd6e" },
              production: { zeilen: 655, abdruck: "df54fd6e" } },
  ungeregelt: { name: { anzahl: 35, abdruck: "72897221" },
                slug: { anzahl: 0, abdruck: "d41d8cd9" } },
  identitaet: { staging: { zeilen: 24, abdruck: "ec1e750f" },
                production: { zeilen: 24, abdruck: "ec1e750f" } },
  metadaten: { anzahl: 1, abdruck: "e9cd4896", namen: ["Fire Kraken"] },
};
const ERWARTET: Erwartung = {
  felder: ["name", "slug"],
  name: { abweichungen: 35, abdruck: "72897221" },
  slug: { abweichungen: 0, abdruck: null },
  charakter_metadaten: { abweichungen: 1, namen: ["Fire Kraken"], abdruck: "e9cd4896" },
};

describe("beurteileEtappeE — der gemessene Zustand vom 2026-10-31", () => {
  it("besteht, und sagt zu jedem Punkt, warum", () => {
    const u = beurteileEtappeE(GEMESSEN, ERWARTET);
    expect(u.befunde).toEqual([]);
    expect(u.bestanden).toBe(true);
    expect(u.hinweise).toHaveLength(5);   // geregelt, Identität, name, slug, Metadaten
  });
});

describe("beurteileEtappeE — was abbrechen MUSS", () => {
  it("eine echte Abweichung in einem geregelten Feld", () => {
    const u = beurteileEtappeE({ ...GEMESSEN,
      geregelt: { staging: { zeilen: 655, abdruck: "aaa" },
                  production: { zeilen: 655, abdruck: "bbb" } } }, ERWARTET);
    expect(u.bestanden).toBe(false);
    expect(u.befunde.join(" ")).toContain("ECHTE Katalogabweichung");
  });

  it("verschieden viele freigegebene Zeilen", () => {
    const u = beurteileEtappeE({ ...GEMESSEN,
      geregelt: { staging: { zeilen: 655, abdruck: "x" },
                  production: { zeilen: 654, abdruck: "x" } } }, ERWARTET);
    expect(u.bestanden).toBe(false);
    expect(u.befunde.join(" ")).toContain("verschieden viele Zeilen");
  });

  it("eine abweichende Charakteridentität", () => {
    const u = beurteileEtappeE({ ...GEMESSEN,
      identitaet: { staging: { zeilen: 24, abdruck: "a" },
                    production: { zeilen: 25, abdruck: "b" } } }, ERWARTET);
    expect(u.bestanden).toBe(false);
    expect(u.befunde.join(" ")).toContain("Charakteridentitaet");
  });

  it("eine 36. Namensabweichung", () => {
    const u = beurteileEtappeE({ ...GEMESSEN,
      ungeregelt: { ...GEMESSEN.ungeregelt, name: { anzahl: 36, abdruck: "neu" } } },
      ERWARTET);
    expect(u.bestanden).toBe(false);
    expect(u.befunde.join(" ")).toContain("36 Abweichung");
  });

  it("eine Namensabweichung WENIGER — auch das ist ein Befund", () => {
    const u = beurteileEtappeE({ ...GEMESSEN,
      ungeregelt: { ...GEMESSEN.ungeregelt, name: { anzahl: 34, abdruck: "neu" } } },
      ERWARTET);
    expect(u.bestanden).toBe(false);
  });

  it("gleiche Anzahl, aber eine ANDERE Menge", () => {
    /*
     * Das ist der Fall, den eine reine Zählung durchlassen würde: 35 bleiben
     * 35, aber eine andere Figur ist betroffen.
     */
    const u = beurteileEtappeE({ ...GEMESSEN,
      ungeregelt: { ...GEMESSEN.ungeregelt, name: { anzahl: 35, abdruck: "ANDERS" } } },
      ERWARTET);
    expect(u.bestanden).toBe(false);
    expect(u.befunde.join(" ")).toContain("andere Menge");
  });

  it("ein zweiter Charakter ohne kuratierte Metadaten", () => {
    const u = beurteileEtappeE({ ...GEMESSEN,
      metadaten: { anzahl: 2, abdruck: "x", namen: ["Fire Kraken", "Stump Smash"] } },
      ERWARTET);
    expect(u.bestanden).toBe(false);
    expect(u.befunde.join(" ")).toContain("Stump Smash");
  });

  it("derselbe Charakter, aber andere Felder", () => {
    const u = beurteileEtappeE({ ...GEMESSEN,
      metadaten: { anzahl: 1, abdruck: "ANDERS", namen: ["Fire Kraken"] } }, ERWARTET);
    expect(u.bestanden).toBe(false);
    expect(u.befunde.join(" ")).toContain("andere Menge");
  });

  it("ein ungeregeltes Feld ohne Erwartung", () => {
    const u = beurteileEtappeE(GEMESSEN,
      { ...ERWARTET, felder: ["name", "slug", "etwas_neues"] });
    expect(u.bestanden).toBe(false);
    expect(u.befunde.join(" ")).toContain("etwas_neues");
  });

  it("ein Abdruck `null` in der Erwartung prüft nur die Anzahl", () => {
    /*
     * Für `slug` ist 0 die Erwartung, und über eine leere Menge gibt es
     * keinen sinnvollen Abdruck. Bei einer Abweichung greift die Anzahl.
     */
    expect(beurteileEtappeE(GEMESSEN, ERWARTET).bestanden).toBe(true);
    const u = beurteileEtappeE({ ...GEMESSEN,
      ungeregelt: { ...GEMESSEN.ungeregelt, slug: { anzahl: 1, abdruck: "x" } } },
      ERWARTET);
    expect(u.bestanden).toBe(false);
  });
});

/* ----------------------------------------- der Runner, am Quelltext */

describe("Etappe E1 im Runner", () => {
  it("ruft das reine Modul auf, statt die Frage ein zweites Mal zu beantworten", () => {
    expect(ohne(RUNNER)).toContain("beurteileEtappeE(mess, erwartung)");
    expect(ohne(RUNNER)).toContain("await messePublish(S, P)");
  });

  it("bricht bei einem Befund ab", () => {
    expect(ohne(RUNNER)).toContain("if (APPLY && !urteil.bestanden)");
    expect(ohne(RUNNER)).toContain('abbruch("E1"');
  });

  it("verweigert eine FEHLENDE Erwartung, statt sie als Bestehen zu lesen", () => {
    expect(ohne(RUNNER)).toContain("erwartung === undefined");
    expect(RUNNER).toContain("eine fehlende");
  });

  it("vergleicht die Fingerprints nur noch dort, wo Gleichheit gilt", () => {
    expect(ohne(RUNNER)).toContain('const VERGLICHEN = ["kategorien"]');
    // katalog_freigegeben und charaktere sind NICHT mehr blind verglichen
    expect(ohne(RUNNER)).not.toContain('["katalog_freigegeben", "kategorien", "charaktere"]');
  });

  it("die Messung ist lesend — kein Schreibweg", () => {
    const ab = ohne(RUNNER).indexOf("async function messePublish");
    const bis = ohne(RUNNER).indexOf("function schreibeBericht", ab);
    expect(ab).toBeGreaterThan(-1);
    const block = ohne(RUNNER).slice(ab, bis);
    for (const w of [".insert(", ".update(", ".upsert(", ".delete(", ".rpc(", ".upload("]) {
      expect(block, w).not.toContain(w);
    }
    /*
     * Gelesen wird über `alle()` — und das hat selbst nur ein `.select`.
     * Beides prüfen, sonst beweist der leere Block nichts.
     */
    expect(block).toContain("await alle(db,");
    const h = ohne(RUNNER).indexOf("async function alle(");
    const hBlock = ohne(RUNNER).slice(h, ohne(RUNNER).indexOf("\n}", h));
    expect(hBlock).toContain('.from(tabelle).select(spalten)');
    for (const w of [".insert(", ".update(", ".upsert(", ".delete(", ".rpc("]) {
      expect(hBlock, w).not.toContain(w);
    }
  });

  it("die Messung benutzt denselben Ausschluss wie der Planer", () => {
    const ab = ohne(RUNNER).indexOf("async function messePublish");
    const block = ohne(RUNNER).slice(ab, ab + 2600);
    expect(block).toContain('["TEST", "SMOK"].includes');
    expect(block).toContain('id >= "SKY-9000"');
    expect(block).toContain('r.catalog_status === "draft"');
  });
});

describe("Etappe F versiegelt, was wirklich gleich ist", () => {
  it("die Selbstprobe läuft über die geregelte Projektion und die Identität", () => {
    expect(ohne(RUNNER)).toContain("geregelt=${mess.geregelt.staging.zeilen}");
    expect(ohne(RUNNER)).toContain("charakteridentitaet=${mess.identitaet.staging.zeilen}");
  });

  it("das Siegel hält auch die ungeregelten Abweichungen fest", () => {
    for (const k of ["geregelt:", "geregelte_felder:", "charakteridentitaet:",
                     "ungeregelt:", "ungeregelte_felder:", "charakter_metadaten:"]) {
      expect(ohne(RUNNER), k).toContain(k);
    }
    expect(RUNNER).toContain("hinweis_ungeregelt");
  });
});

describe("die Erwartung in bootstrap-decisions.json", () => {
  const D = JSON.parse(readFileSync("resources/sync/bootstrap-decisions.json", "utf8")) as
    { publish_ungeregelt: Erwartung & Record<string, unknown> };

  it("ist vorhanden und nennt genau die ungeregelten Felder", () => {
    expect(D.publish_ungeregelt).toBeTruthy();
    expect(D.publish_ungeregelt.felder).toEqual([...UNGEREGELT]);
  });

  it("hält die gemessenen Abweichungen mit Abdruck fest", () => {
    expect(D.publish_ungeregelt.name).toEqual(
      expect.objectContaining({ abweichungen: 35, abdruck: expect.any(String) }));
    expect(D.publish_ungeregelt.slug.abweichungen).toBe(0);
    expect(D.publish_ungeregelt.charakter_metadaten).toEqual(
      expect.objectContaining({ abweichungen: 1, namen: ["Fire Kraken"] }));
  });

  it("begründet sich mit den ADRs, nicht mit Bequemlichkeit", () => {
    const text = JSON.stringify(D.publish_ungeregelt);
    expect(text).toContain("ADR-0030");
    expect(text).toContain("ADR-0034");
    expect(text).toContain("characters:import");
  });
});
