import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { charakterRiegel, RANG, type Schritt }
  from "./sync-character-gate.ts";

/* ==========================================================================
 * TOR 1b — die Charakterabhängigkeiten des Publish
 *
 * Der Abbruch vom 2026-10-31 in Etappe D (`feld-neu familie SKY-0854`) war
 * nicht ein Reihenfolgefehler, sondern eine Zuordnung, die nach eigenen
 * Schreibvorgängen weiterbenutzt wurde. Diese Datei hält beides fest: das
 * Verhalten des Riegels (echte Funktion, echte Eingaben) und die Zusagen am
 * Quelltext des Werkzeugs, die eine Funktion nicht prüfen kann.
 * ========================================================================== */

const Q = readFileSync("tools/catalog-sync-apply.mts", "utf8");
const CODE = Q.replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter((z) => !z.trimStart().startsWith("//")).join("\n");

/** Der Fall vom 2026-10-31, in klein: fünf Anlagen, vier Familienschritte. */
const LAUF: Schritt[] = [
  { art: "charakter-anlegen", sky_id: "—", nach: "Dune Bug" },
  { art: "charakter-anlegen", sky_id: "—", nach: "Fire Kraken" },
  { art: "charakter-anlegen", sky_id: "—", nach: "Heavy Duty Sprocket" },
  { art: "charakter-anlegen", sky_id: "—", nach: "Prism Break Light Core" },
  { art: "charakter-anlegen", sky_id: "—", nach: "Stump Smash" },
  { art: "figur-anlegen", sky_id: "SKY-0854" },
  { art: "feld-neu", sky_id: "SKY-0829", feld: "familie", nach: "Whirlwind" },
  { art: "feld-neu", sky_id: "SKY-0851", feld: "familie", nach: "Whirlwind" },
  { art: "feld-neu", sky_id: "SKY-0853", feld: "familie", nach: "Eruptor" },
  { art: "feld-neu", sky_id: "SKY-0854", feld: "familie", nach: "Prism Break Light Core" },
];
const BESTAND = new Set(["Whirlwind", "Eruptor", "Spyro"]);

describe("charakterRiegel — der Fall SKY-0854", () => {
  it("hält den Lauf NICHT auf: Prism Break Light Core wird angelegt", () => {
    const b = charakterRiegel(LAUF, BESTAND);
    expect(b.zustand).toBe("ok");
    if (b.zustand !== "ok") return;
    expect(b.familien).toBe(4);
    expect(b.ausBestand).toBe(3);      // Whirlwind, Whirlwind, Eruptor
    expect(b.ausAnlagen).toBe(1);      // Prism Break Light Core
    expect(b.anlagen).toBe(5);
  });

  it("hält ihn auf, wenn genau diese Anlage im Plan fehlt", () => {
    const ohne = LAUF.filter((s) => s.nach !== "Prism Break Light Core"
      || s.art !== "charakter-anlegen");
    const b = charakterRiegel(ohne, BESTAND);
    expect(b.zustand).toBe("unaufloesbar");
    if (b.zustand !== "unaufloesbar") return;
    expect(b.offen).toEqual([{ sky_id: "SKY-0854", name: "Prism Break Light Core" }]);
  });

  it("nennt JEDE offene Referenz, nicht nur die erste", () => {
    const b = charakterRiegel(
      LAUF.filter((s) => s.art !== "charakter-anlegen"), new Set(["Eruptor"]));
    expect(b.zustand).toBe("unaufloesbar");
    if (b.zustand !== "unaufloesbar") return;
    expect(b.offen.map((o) => o.sky_id))
      .toEqual(["SKY-0829", "SKY-0851", "SKY-0854"]);
  });
});

describe("charakterRiegel — mehrere neue Charaktere", () => {
  it("löst Familienzuordnungen auf mehrere im Lauf angelegte Charaktere auf", () => {
    const s: Schritt[] = [
      { art: "charakter-anlegen", sky_id: "—", nach: "A" },
      { art: "charakter-anlegen", sky_id: "—", nach: "B" },
      { art: "charakter-anlegen", sky_id: "—", nach: "C" },
      { art: "feld-neu", sky_id: "SKY-0001", feld: "familie", nach: "A" },
      { art: "feld-neu", sky_id: "SKY-0002", feld: "familie", nach: "B" },
      { art: "feld", sky_id: "SKY-0003", feld: "familie", nach: "C" },
      { art: "feld", sky_id: "SKY-0004", feld: "familie", nach: "A" },
    ];
    const b = charakterRiegel(s, new Set());
    expect(b.zustand).toBe("ok");
    if (b.zustand !== "ok") return;
    expect(b.anlagen).toBe(3);
    expect(b.familien).toBe(4);
    expect(b.ausBestand).toBe(0);
    expect(b.ausAnlagen).toBe(4);
  });

  it("zählt drei Anlagen auch dann als drei, wenn nur eine benutzt wird", () => {
    const s: Schritt[] = [
      { art: "charakter-anlegen", sky_id: "—", nach: "A" },
      { art: "charakter-anlegen", sky_id: "—", nach: "B" },
      { art: "charakter-anlegen", sky_id: "—", nach: "C" },
      { art: "feld-neu", sky_id: "SKY-0001", feld: "familie", nach: "A" },
    ];
    const b = charakterRiegel(s, new Set());
    expect(b.zustand).toBe("ok");
    if (b.zustand !== "ok") return;
    expect(b.anlagen).toBe(3);
    /*
     * EIN UNBENUTZTER CHARAKTER IST KEIN FEHLER. Eine Familie kann auf
     * Staging angelegt und erst später zugeordnet werden — der Publish
     * überträgt sie trotzdem. Der Riegel prüft Auflösbarkeit, nicht
     * Sparsamkeit.
     */
    expect(b.familien).toBe(1);
  });
});

describe("charakterRiegel — ein teilweise ausgeführter Lauf", () => {
  it("weist einen veralteten Plan ab: die Anlage steht schon im Ziel", () => {
    /*
     * GENAU DER ZUSTAND VOM 2026-10-31 NACH DEM ABBRUCH: die fünf
     * Charaktere stehen auf Production, der alte Plan will sie noch anlegen.
     * `admin_create_character` (0158) würde sie abweisen — aber erst mitten
     * im Schreiben. Hier fällt es auf, bevor etwas geschrieben ist.
     */
    const nachAbbruch = new Set([...BESTAND, "Dune Bug", "Fire Kraken",
      "Heavy Duty Sprocket", "Prism Break Light Core", "Stump Smash"]);
    const b = charakterRiegel(LAUF, nachAbbruch);
    expect(b.zustand).toBe("veraltet");
    if (b.zustand !== "veraltet") return;
    expect(b.schonDa).toEqual(["Dune Bug", "Fire Kraken", "Heavy Duty Sprocket",
      "Prism Break Light Core", "Stump Smash"]);
  });

  it("lässt den NEU gerechneten Plan desselben Zustands durch", () => {
    /*
     * Der neue Plan führt die fünf Anlagen nicht mehr — sie stehen. Die
     * Familienzuordnung auf SKY-0854 ist noch offen und löst sich jetzt aus
     * dem Bestand auf. Das ist die Fortsetzung, und sie braucht keinen
     * Sonderweg.
     */
    const nachAbbruch = new Set([...BESTAND, "Dune Bug", "Fire Kraken",
      "Heavy Duty Sprocket", "Prism Break Light Core", "Stump Smash"]);
    const neuerPlan = LAUF.filter((s) => s.art !== "charakter-anlegen"
      && s.art !== "figur-anlegen");
    const b = charakterRiegel(neuerPlan, nachAbbruch);
    expect(b.zustand).toBe("ok");
    if (b.zustand !== "ok") return;
    expect(b.anlagen).toBe(0);
    expect(b.familien).toBe(4);
    expect(b.ausBestand).toBe(4);     // alle vier jetzt aus dem Bestand
    expect(b.ausAnlagen).toBe(0);
  });

  it("meldet den veralteten Plan auch bei nur EINER schon stehenden Anlage", () => {
    const b = charakterRiegel(LAUF, new Set([...BESTAND, "Fire Kraken"]));
    expect(b.zustand).toBe("veraltet");
    if (b.zustand !== "veraltet") return;
    expect(b.schonDa).toEqual(["Fire Kraken"]);
  });
});

describe("charakterRiegel — die Ränder", () => {
  it("`~` ist keine Referenz: das Entfernen einer Familie braucht keinen Charakter", () => {
    const b = charakterRiegel(
      [{ art: "feld", sky_id: "SKY-0001", feld: "familie", nach: "~" }], new Set());
    expect(b.zustand).toBe("ok");
    if (b.zustand !== "ok") return;
    expect(b.familien).toBe(0);
  });

  it("ein leerer Plan ist in Ordnung und zählt null", () => {
    const b = charakterRiegel([], new Set(["Spyro"]));
    expect(b.zustand).toBe("ok");
    if (b.zustand !== "ok") return;
    expect(b).toMatchObject({ familien: 0, ausBestand: 0, ausAnlagen: 0, anlagen: 0 });
  });

  it("vergleicht Namen EXAKT — wie der Nachschlag im Apply-Pfad", () => {
    /*
     * `charakterId` ist eine `Map` auf den canonical_name, und `.get()`
     * unterscheidet Gross- und Kleinschreibung. Wenn der Riegel hier
     * nachsichtiger wäre als der Nachschlag, wäre er wertlos: er würde ein
     * Durchkommen vorhersagen, das es nicht gibt.
     */
    const b = charakterRiegel(
      [{ art: "feld", sky_id: "SKY-0001", feld: "familie", nach: "whirlwind" }],
      new Set(["Whirlwind"]));
    expect(b.zustand).toBe("unaufloesbar");
  });

  it("sieht andere Felder nicht an", () => {
    const b = charakterRiegel(
      [{ art: "feld", sky_id: "SKY-0001", feld: "base_sky_id", nach: "Whirlwind" },
       { art: "feld", sky_id: "SKY-0002", feld: "types", nach: "chase" }], new Set());
    expect(b.zustand).toBe("ok");
    if (b.zustand !== "ok") return;
    expect(b.familien).toBe(0);
  });
});

describe("die Reihenfolge der Schrittarten", () => {
  it("legt Charaktere vor Figuren und beide vor allem an, was auf sie verweist", () => {
    expect(RANG["charakter-anlegen"]).toBeLessThan(RANG["figur-anlegen"]);
    expect(RANG["figur-anlegen"]).toBeLessThan(RANG["feld-neu"]);
    expect(RANG["feld-neu"]).toBeLessThan(RANG.feld);
  });

  it("sortiert einen gemischten Plan in genau diese Reihenfolge", () => {
    const gemischt = [...LAUF].sort((a, b) =>
      (RANG[a.art] ?? 9) - (RANG[b.art] ?? 9));
    expect(gemischt.slice(0, 5).every((s) => s.art === "charakter-anlegen")).toBe(true);
    expect(gemischt[5].art).toBe("figur-anlegen");
    expect(gemischt.slice(6).every((s) => s.art === "feld-neu")).toBe(true);
  });

  it("schreibt die Bildverweise zuletzt", () => {
    /*
     * Stufe 6 der Reihenfolge. Bis zum 2026-10-31 lag
     * `image_override_path` im Vorgaberang 5, also figurweise zwischen
     * Familie und Basisfigur. Ein Bildverweis ist das Letzte, was eine Figur
     * braucht.
     */
    const feldrang = /const FELDRANG: Record<string, number> = \{([^}]*)\}/
      .exec(CODE)?.[1] ?? "";
    expect(feldrang).toContain("types: 0");
    expect(feldrang).toContain("visible_type: 1");
    expect(feldrang).toContain("image_override_path: 9");
    // 9 liegt hinter dem Vorgaberang 5 der übrigen Felder
    expect(CODE).toContain('(FELDRANG[a.feld ?? ""] ?? 5)');
  });

  it("ordnet die sechs Stufen in genau der verlangten Folge", () => {
    /*
     * 1. Charaktere  2. Figuren  3. Typen und Banner  4. Varianten und
     * Familien  5. übrige Katalogfelder  6. Bildverweise.
     *
     * Die Stufen 1 und 2 trägt RANG, die Stufen 3 bis 6 FELDRANG. Vor dem
     * 2026-10-31 lagen Familie, Basisfigur und Bildverweis alle im
     * Vorgaberang und wurden deshalb figurweise vermischt.
     */
    const roh = /const FELDRANG: Record<string, number> = \{([\s\S]*?)\n\};/
      .exec(Q)?.[1] ?? "";
    const rang: Record<string, number> = {};
    for (const [, f, n] of roh.matchAll(/(\w+): (\d+)/g)) rang[f] = Number(n);
    const VORGABE = 5;
    const stufe = (f: string) => rang[f] ?? VORGABE;
    expect(stufe("types")).toBeLessThan(stufe("visible_type"));
    expect(stufe("visible_type")).toBeLessThan(stufe("base_sky_id"));
    expect(stufe("base_sky_id")).toBeLessThan(stufe("familie"));
    expect(stufe("familie")).toBeLessThan(VORGABE);
    for (const uebrig of ["card_type", "display_name_override", "name", "slug",
                          "catalog_visible", "visible_type_decided"]) {
      expect(stufe(uebrig), uebrig).toBe(VORGABE);
      expect(stufe(uebrig)).toBeLessThan(stufe("image_override_path"));
    }
  });

  it("das Werkzeug führt RANG nicht zweimal — es nimmt diese Tabelle", () => {
    expect(CODE).toContain('from "../src/lib/catalog/sync-character-gate.ts"');
    expect(CODE).not.toMatch(/const RANG: Record<string, number> = \{/);
  });
});

describe("der Apply-Pfad — am Quelltext festgenagelt", () => {
  it("ruft TOR 1b auf, BEVOR die Ausführungsschleife beginnt", () => {
    const tor = CODE.indexOf("charakterRiegel(schritte");
    const schleife = CODE.indexOf("for (const s of schritte) {\n  const zeile =");
    expect(tor).toBeGreaterThan(-1);
    expect(schleife).toBeGreaterThan(-1);
    expect(tor).toBeLessThan(schleife);
  });

  it("bricht bei beiden Befunden ab, statt weiterzuschreiben", () => {
    const ab = CODE.indexOf("charakterRiegel(schritte");
    const block = CODE.slice(ab, ab + 1400);
    expect(block).toContain('riegelB.zustand === "veraltet"');
    expect(block).toContain('riegelB.zustand === "unaufloesbar"');
    expect((block.match(/abbruch\(/g) ?? []).length).toBe(2);
  });

  it("trägt die id der neuen Familie SOFORT in die Zuordnung ein", () => {
    /*
     * DIE URSACHE DES ABBRUCHS. Ohne diese Zeile kennt `charakterId` den im
     * Lauf angelegten Charakter nicht — und der erste `familie`-Schritt auf
     * ihn scheitert, obwohl die Zeile in der Datenbank steht.
     */
    const ab = CODE.indexOf('if (s.art === "charakter-anlegen")');
    const bis = CODE.indexOf('} else if (s.art === "figur-anlegen")', ab);
    expect(ab).toBeGreaterThan(-1);
    const zweig = CODE.slice(ab, bis);
    expect(zweig).toContain('W.rpc("admin_create_character"');
    expect(zweig).toContain("charakterId.set(name, id)");
    // die id kommt aus der RPC, nicht aus einem Namensnachschlag
    expect(zweig).toContain("data: neueId");
    expect(zweig).toContain('.eq("id", id)');
  });

  it("verweigert eine unbrauchbare id, statt sie zu benutzen", () => {
    const ab = CODE.indexOf('if (s.art === "charakter-anlegen")');
    const bis = CODE.indexOf('} else if (s.art === "figur-anlegen")', ab);
    const zweig = CODE.slice(ab, bis);
    expect(zweig).toContain("Number.isInteger(id)");
    expect(zweig).toContain("throw new Error");
  });

  it("nennt den Charakter nicht mehr fälschlich als Reihenfolgefehler", () => {
    /*
     * Die alte Meldung ("Die Charaktere muessen VOR den Figuren angelegt
     * werden") war eine falsche Spur: sie wurden vorher angelegt. Sie darf
     * nicht zurückkommen.
     */
    expect(CODE).not.toContain("muessen VOR den Figuren angelegt werden");
  });

  it("schreibt das Protokoll AUCH bei einem Abbruch mitten in der Schleife", () => {
    /*
     * Der Abbruch vom 2026-10-31 liess 142 geschriebene Schritte ohne
     * Protokoll zurueck, weil `writeFileSync` nach der Schleife stand.
     */
    expect(CODE).toContain("function schreibeProtokoll(");
    const fang = CODE.indexOf("} catch (fehler) {");
    expect(fang).toBeGreaterThan(-1);
    const block = CODE.slice(fang, fang + 500);
    expect(block).toContain("abgebrochen: true");
    expect(block).toContain("abgebrochen_nach: geschrieben");
    expect(block).toContain("throw fehler;");   // nicht verschluckt
  });

  it("lässt Compare-and-Set und die übrigen Riegel unberührt", () => {
    expect(CODE).toContain('.eq("updated_at", updatedAt as string)');
    expect(CODE).toContain("TOR 1 —");
    expect(CODE).toContain("TOR 1b —");
    expect(CODE).toContain("TOR 2 — Precondition verletzt");
    expect(CODE).toContain("TOR 3");
    expect(CODE).toContain('ZIEL === "production" && !process.argv.includes(productionConfirmation())');
    // und es gibt weiterhin keinen Fluchtweg aus TOR 2
    for (const flucht of ["--force", "skip-tor", "no-cas", "--ohne-tor"]) {
      expect(CODE).not.toContain(flucht);
    }
  });
});
