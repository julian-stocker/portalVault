import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { PLATFORM_FORMAT_VERSION, PLATFORM_SECTIONS, SECTIONS_BY_FORMAT_VERSION }
  from "./platform-manifest";

/**
 * Migration `0153` — und der Beweis, dass sie den Rumpf aus `0144` KOPIERT.
 *
 * WORUM ES HIER GEHT. `0153` ersetzt `system_platform_export()`, also die
 * eine Funktion, die unter Supabase Free unsere gesamte Absicherung ist.
 * Dieselbe Lage wie bei `0144`, und derselbe Umgang damit: der Rumpf ist
 * nicht neu getippt, sondern kopiert, und diese Datei rechnet das bei jedem
 * Testlauf nach.
 *
 *   1. Beide Abdrücke stimmen mit den Zahlen in der Migration überein.
 *   2. Der neue Rumpf MINUS der einen Zeile ist Zeichen für Zeichen der
 *      alte. Das ist die eigentliche Zusicherung: 31 072 Zeichen gehen
 *      durch, und genau eine Zeile ist neu.
 *   3. `R0153` stellt genau den alten Rumpf wieder her.
 *
 * WAS DIESE MIGRATION FACHLICH LEISTET. Ohne sie führt `database.json` nur
 * `catalog_visible`. Ein Entwurf und eine versteckte Zeile sind dort beide
 * `false`, und nach einer Wiederherstellung wäre jeder Entwurf eine
 * versteckte Zeile. `catalog_status` ist die Unterscheidung, und deshalb
 * muss sie mitgesichert werden.
 *
 * WARUM DIE FORMATVERSION NICHT STEIGT. `catalog_status` ist ein FELD eines
 * bestehenden Bereichs. `format_version` zählt BEREICHE
 * (`SECTIONS_BY_FORMAT_VERSION`), und die Zahl bleibt 54 — anders als bei
 * `favorites`, das einen Bereich braucht.
 */

const md5 = (s: string) => createHash("md5").update(s).digest("hex");

const ALT = "4c4d2e7c81e4efa8e18cdffa06bba40a";
const NEU = "92c48444f99b9e294f9703d0c0ddeaa8";
const AUS_0105 = "2e2da90e976a1e73ca00aba7cd830fae";

const P0144 = "supabase/migrations/0144_platform_export_calculations.sql";
const P0153 = "supabase/migrations/0153_platform_export_catalog_status.sql";
const PR0153 = "supabase/rollback/R0153_platform_export_back_to_0144.sql";

/** Die eine neue Zeile, genau so, wie sie im Rumpf steht. */
const ZEILE = "            'catalog_status', t.catalog_status,\n";

/**
 * Der Rumpf, genau wie PostgreSQL ihn speichert.
 *
 * Ab dem Zeichen nach `as $$` — das ist der Zeilenumbruch — bis
 * einschliesslich des `\n` vor `$$;`. Dieselben gemessenen Grenzen wie in
 * `platform-export-0144.test.ts`.
 */
function rumpf(datei: string): string {
  const sql = readFileSync(datei, "utf8");
  const von = sql.indexOf("create or replace function public.system_platform_export()");
  expect(von, `${datei}: keine Funktionsdefinition`).toBeGreaterThan(-1);
  const a = sql.indexOf("as $$", von) + "as $$".length;
  const b = sql.indexOf("\n$$;", a);
  return sql.slice(a, b + 1);
}

const ALTER_RUMPF = rumpf(P0144);
const NEUER_RUMPF = rumpf(P0153);
const bereiche = (s: string) => (s.match(/coalesce\(\(/g) ?? []).length;

describe("die beiden Abdrücke", () => {
  it("der Rumpf aus 0144 ist der, den die Migration voraussetzt", () => {
    expect(md5(ALTER_RUMPF)).toBe(ALT);
    expect(bereiche(ALTER_RUMPF)).toBe(54);
  });

  it("der Rumpf aus 0153 ist der, den sie zusichert", () => {
    expect(md5(NEUER_RUMPF)).toBe(NEU);
    expect(bereiche(NEUER_RUMPF)).toBe(54);
  });

  it("und die Migration nennt alle drei — Riegel, Wiederanwendung, Reihenfolge", () => {
    const sql = readFileSync(P0153, "utf8");
    /* Der Vorriegel: nur der bekannte Rumpf wird ersetzt. */
    expect(sql).toContain(`if v_abdruck <> '${ALT}' then`);
    /* Der Wiederanwendungsschutz: der neue Rumpf steht schon. */
    expect(sql).toContain(`if v_abdruck = '${NEU}' then`);
    /* Die Nachbedingung. */
    expect(sql).toContain(`if v_abdruck <> '${NEU}' then`);
    /*
     * UND DER FALL PRODUCTION, mit eigener Meldung. Dort steht der Rumpf aus
     * `0105`; ein Lauf dieser Datei muss sagen, WARUM er nicht geht, nicht
     * nur dass er nicht geht.
     */
    expect(sql).toContain(`if v_abdruck = '${AUS_0105}' then`);
    expect(sql).toContain("erst 0144 ");
  });
});

describe("der neue Rumpf ist der alte plus EINE Zeile", () => {
  /**
   * Die Umkehrung, und sie ist die stärkste Aussage dieser Datei.
   *
   * Statt zu prüfen, dass bestimmte Dinge noch da sind — eine Liste, die
   * jemand pflegen müsste —, wird die neue Zeile herausgenommen. Was übrig
   * bleibt, MUSS byteweise der alte Rumpf sein. Eine zweite Änderung,
   * irgendwo in 31 072 Zeichen, fällt damit auf, auch wenn niemand sie
   * sucht.
   */
  it("zurückgedreht ist er Zeichen für Zeichen der alte", () => {
    expect(NEUER_RUMPF).toContain(ZEILE);
    const zurueck = NEUER_RUMPF.replace(ZEILE, "");
    expect(md5(zurueck)).toBe(ALT);
    expect(zurueck).toBe(ALTER_RUMPF);
  });

  it("genau ein Unterschied, und er ist eine Zeile", () => {
    expect(NEUER_RUMPF.match(/'catalog_status', t\.catalog_status,/g)).toHaveLength(1);
    expect(ALTER_RUMPF).not.toContain("catalog_status");
    const zeilen = (s: string) => s.split("\n").length;
    expect(zeilen(NEUER_RUMPF) - zeilen(ALTER_RUMPF)).toBe(1);
    expect(NEUER_RUMPF.length - ALTER_RUMPF.length).toBe(ZEILE.length);
  });

  it("die Zeile steht im Katalogbereich, direkt hinter catalog_visible", () => {
    /*
     * Der Ort ist nicht Geschmack: die beiden Spalten beantworten dieselbe
     * Frage, und wer den Export liest, soll sie beieinander sehen. Ein Feld
     * im falschen Bereich wäre fachlich falsch — `t` wäre dann eine andere
     * Tabelle und die Anweisung schlüge beim Erzeugen fehl.
     */
    expect(NEUER_RUMPF).toContain(
      "            'catalog_visible', t.catalog_visible,\n"
      + "            'catalog_status', t.catalog_status,\n");
    const a = NEUER_RUMPF.indexOf("'skylanders', coalesce((");
    const b = NEUER_RUMPF.indexOf("from public.skylanders t", a);
    expect(NEUER_RUMPF.indexOf(ZEILE)).toBeGreaterThan(a);
    expect(NEUER_RUMPF.indexOf(ZEILE)).toBeLessThan(b);
  });

  it("die Formatversion bleibt 2, weil kein Bereich dazukommt", () => {
    expect(NEUER_RUMPF).toContain("'format_version', 2,");
    expect(bereiche(NEUER_RUMPF)).toBe(bereiche(ALTER_RUMPF));
    expect(PLATFORM_FORMAT_VERSION).toBe(2);
    expect(SECTIONS_BY_FORMAT_VERSION[2]).toBe(54);
    /* Und keine dritte Version ist dazugekommen. */
    expect(Object.keys(SECTIONS_BY_FORMAT_VERSION)).toEqual(["1", "2"]);
  });
});

describe("das Manifest und der Rumpf sagen dasselbe", () => {
  const katalog = PLATFORM_SECTIONS.find((s) => s.key === "skylanders");

  it("der Bereich skylanders führt catalog_status", () => {
    expect(katalog).toBeDefined();
    expect(katalog?.fields).toContain("catalog_status");
  });

  it("und er führt ihn nicht mehr als Ausschluss", () => {
    /*
     * DIE LÜCKE IST GESCHLOSSEN, nicht umformuliert. Solange der Eintrag in
     * `excluded` stand, war die Aussage „fehlt mit Begründung"; jetzt ist
     * die Aussage „ist dabei", und beides gleichzeitig wäre ein Widerspruch.
     */
    expect(katalog?.excluded ?? {}).not.toHaveProperty("catalog_status");
  });

  /**
   * Die Felder, die NACH `0153` dazugekommen sind.
   *
   * WARUM DIESE LISTE NÖTIG IST. Das Manifest beschreibt die NEUESTE
   * Fassung des Rumpfes; diese Datei prüft die aus `0153`. Jede spätere
   * Migration, die ein Feld hinzufügt, muss hier genannt werden — sonst
   * würde diese Zusage von einem Rumpf verlangen, was erst sein Nachfolger
   * führt. Die Liste ist der Preis dafür, dass eine angewendete Migration
   * nicht mehr angefasst wird (Regel 1): ihr Test bleibt bei ihrem Stand.
   *
   * Dass die Felder im NEUEN Rumpf wirklich stehen, prüfen
   * `platform-export-0160.test.ts` und `platform-export-0164.test.ts` —
   * dieselbe Zusage, je eine Migration weiter.
   */
  const NACH_0153 = ["base_sky_id",
                     /* CAT-10, `0164`: drei Felder des Type-Systems. */
                     "types", "visible_type", "visible_type_decided"];

  it("jedes Feld des Manifests steht auch im Rumpf", () => {
    const a = NEUER_RUMPF.indexOf("'skylanders', coalesce((");
    const b = NEUER_RUMPF.indexOf("from public.skylanders t", a);
    const block = NEUER_RUMPF.slice(a, b);
    for (const feld of katalog?.fields ?? []) {
      if (NACH_0153.includes(feld)) continue;
      expect(block, `${feld} fehlt im Exportbereich`).toContain(`'${feld}', t.${feld}`);
    }
  });

  it("und die Nachzügler-Liste ist keine Ausrede: jedes Feld darin steht im Manifest", () => {
    /*
     * Ohne diese Zeile könnte die Liste oben ein Feld stillschweigend von
     * der Prüfung befreien, das es im Manifest gar nicht gibt — und dann
     * wäre sie eine Lücke statt einer Abgrenzung.
     */
    for (const feld of NACH_0153) {
      expect(katalog?.fields ?? [], feld).toContain(feld);
      expect(NEUER_RUMPF, `${feld} steht schon im Rumpf aus 0153`)
        .not.toContain(`'${feld}', t.${feld}`);
    }
  });
});

describe("die Rücknahme", () => {
  it("stellt den Rumpf aus 0144 zeichengleich wieder her", () => {
    expect(md5(rumpf(PR0153))).toBe(ALT);
    expect(rumpf(PR0153)).toBe(ALTER_RUMPF);
  });

  it("nennt beide Abdrücke und überschreibt keine dritte Fassung", () => {
    const sql = readFileSync(PR0153, "utf8");
    expect(sql).toContain(`if v_abdruck = '${ALT}' then`);
    expect(sql).toContain(`elsif v_abdruck <> '${NEU}' then`);
    expect(sql).toContain("Eine dritte Fassung wird nicht");
  });

  it("fasst die Spalte selbst nicht an", () => {
    /*
     * Der Rückbau nimmt das FELD aus dem Export, nicht die SPALTE aus der
     * Tabelle. Ein `alter table` oder ein `update` darin wäre Datenverlust
     * statt Rücknahme — die Spalte gehört `0152`.
     */
    const sql = readFileSync(PR0153, "utf8");
    expect(sql).not.toMatch(/alter\s+table/i);
    expect(sql).not.toMatch(/\bdrop\s+(table|column|trigger|constraint)\b/i);
    expect(sql).not.toMatch(/^\s*update\s+public\./im);
  });
});
