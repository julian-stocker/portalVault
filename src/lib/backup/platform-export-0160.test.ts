import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { PLATFORM_FORMAT_VERSION, PLATFORM_SECTIONS, SECTIONS_BY_FORMAT_VERSION }
  from "./platform-manifest";
import { formatVersionOf } from "./platform-archive";
import { sectionCounts } from "./document";

/**
 * Migration `0160` — und der Beweis, dass sie den Rumpf aus `0153` KOPIERT.
 *
 * WORUM ES HIER GEHT. `0160` ersetzt `system_platform_export()`, also die
 * eine Funktion, die unter Supabase Free unsere gesamte Absicherung ist.
 * Dieselbe Lage wie bei `0144` und `0153`, und derselbe Umgang damit: der
 * Rumpf ist nicht neu getippt, sondern kopiert, und diese Datei rechnet das
 * bei jedem Testlauf nach.
 *
 *   1. Beide Abdrücke stimmen mit den Zahlen in der Migration überein.
 *   2. Der neue Rumpf MINUS der einen Zeile ist Zeichen für Zeichen der
 *      alte. Das ist die eigentliche Zusicherung: 31 072 Zeichen gehen
 *      durch, und genau eine Zeile ist neu.
 *   3. `R0160` stellt genau den alten Rumpf wieder her — einen Schritt
 *      zurück, nicht zwei: `catalog_status` aus `0153` bleibt.
 *
 * WAS DIESE MIGRATION FACHLICH LEISTET. Ohne sie führt `database.json`
 * `character_id`, also die FAMILIE einer Figur, aber nicht die MITTE: nach
 * einer Wiederherstellung käme jede Variante als eigenständige Figur
 * zurück. `base_sky_id` ist die Mitte, und deshalb muss sie mitgesichert
 * werden.
 *
 * WARUM DIE FORMATVERSION NICHT STEIGT. `base_sky_id` ist ein FELD eines
 * bestehenden Bereichs. `format_version` zählt BEREICHE
 * (`SECTIONS_BY_FORMAT_VERSION`), und die Zahl bleibt 54 — anders als bei
 * `favorites`, das einen Bereich braucht.
 *
 * WAS HIER NICHT GEPRÜFT WIRD: ob eine Wiederherstellung funktioniert. Es
 * gibt keine. Was eine mit Varianten verlangt, steht in
 * `supabase/checks/0160_restore_order.md` und wird in Probelauf **P69**
 * gegen echtes PostgreSQL gemessen.
 */

const md5 = (s: string) => createHash("md5").update(s).digest("hex");

const ALT = "92c48444f99b9e294f9703d0c0ddeaa8";
const NEU = "ff4f38e61cbd4e5857ea914d6be68d44";
const AUS_0144 = "4c4d2e7c81e4efa8e18cdffa06bba40a";
const AUS_0105 = "2e2da90e976a1e73ca00aba7cd830fae";

const P0153 = "supabase/migrations/0153_platform_export_catalog_status.sql";
const P0160 = "supabase/migrations/0160_platform_export_base_sky_id.sql";
const PR0160 = "supabase/rollback/R0160_platform_export_back_to_0153.sql";

/** Die eine neue Zeile, genau so, wie sie im Rumpf steht. */
const ZEILE = "            'base_sky_id', t.base_sky_id,\n";

/**
 * Der Rumpf, genau wie PostgreSQL ihn speichert.
 *
 * Ab dem Zeichen nach `as $$` — das ist der Zeilenumbruch — bis
 * einschliesslich des `\n` vor `$$;`. Dieselben gemessenen Grenzen wie in
 * `platform-export-0144.test.ts` und `-0153.test.ts`.
 */
function rumpf(datei: string): string {
  const sql = readFileSync(datei, "utf8");
  const von = sql.indexOf("create or replace function public.system_platform_export()");
  expect(von, `${datei}: keine Funktionsdefinition`).toBeGreaterThan(-1);
  const a = sql.indexOf("as $$", von) + "as $$".length;
  const b = sql.indexOf("\n$$;", a);
  return sql.slice(a, b + 1);
}

const ALTER_RUMPF = rumpf(P0153);
const NEUER_RUMPF = rumpf(P0160);
const bereiche = (s: string) => (s.match(/coalesce\(\(/g) ?? []).length;

describe("die beiden Abdrücke", () => {
  it("der Rumpf aus 0153 ist der, den die Migration voraussetzt", () => {
    expect(md5(ALTER_RUMPF)).toBe(ALT);
    expect(ALTER_RUMPF.length).toBe(31072);
    expect(bereiche(ALTER_RUMPF)).toBe(54);
  });

  it("der Rumpf aus 0160 ist der, den sie zusichert", () => {
    expect(md5(NEUER_RUMPF)).toBe(NEU);
    expect(NEUER_RUMPF.length).toBe(31114);
    expect(bereiche(NEUER_RUMPF)).toBe(54);
  });

  it("und die Migration nennt alle vier — Riegel, Wiederanwendung, zwei Reihenfolgen", () => {
    const sql = readFileSync(P0160, "utf8");
    /* Der Vorriegel: nur der bekannte Rumpf wird ersetzt. */
    expect(sql).toContain(`if v_abdruck <> '${ALT}' then`);
    /* Der Wiederanwendungsschutz: der neue Rumpf steht schon. */
    expect(sql).toContain(`if v_abdruck = '${NEU}' then`);
    /* Die Nachbedingung. */
    expect(sql).toContain(`if v_abdruck <> '${NEU}' then`);
    /*
     * UND ZWEI FÄLLE MIT EIGENER MELDUNG. Auf Production steht der Rumpf aus
     * `0105`; stünde irgendwo noch der aus `0144`, fehlte `0153`. Ein Lauf
     * muss sagen, WARUM er nicht geht, nicht nur dass er nicht geht.
     */
    expect(sql).toContain(`if v_abdruck = '${AUS_0105}' then`);
    expect(sql).toContain(`if v_abdruck = '${AUS_0144}' then`);
    expect(sql).toContain("Erst 0153 anwenden, dann diese.");
  });

  it("und sie setzt die Spalte aus 0159 voraus", () => {
    const sql = readFileSync(P0160, "utf8");
    expect(sql).toContain("0160 setzt 0159 voraus: skylanders.base_sky_id fehlt");
    expect(sql).toContain("column_name = 'base_sky_id'");
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
    expect(NEUER_RUMPF.match(/'base_sky_id', t\.base_sky_id,/g)).toHaveLength(1);
    expect(ALTER_RUMPF).not.toContain("base_sky_id");
    const zeilen = (s: string) => s.split("\n").length;
    expect(zeilen(NEUER_RUMPF) - zeilen(ALTER_RUMPF)).toBe(1);
    expect(NEUER_RUMPF.length - ALTER_RUMPF.length).toBe(ZEILE.length);
  });

  it("die Zeile steht im Katalogbereich, direkt hinter character_id", () => {
    /*
     * Der Ort ist nicht Geschmack: `character_id` sagt WER dargestellt ist
     * (serienübergreifend), `base_sky_id` sagt WOVON diese Variante eine
     * Variante ist (innerhalb einer Serie). Wer den Export liest, soll sie
     * beieinander sehen. Ein Feld im falschen Bereich wäre fachlich falsch —
     * `t` wäre dann eine andere Tabelle und die Anweisung schlüge beim
     * Erzeugen fehl.
     */
    expect(NEUER_RUMPF).toContain(
      "            'character_id', t.character_id,\n"
      + "            'base_sky_id', t.base_sky_id,\n");
    const a = NEUER_RUMPF.indexOf("'skylanders', coalesce((");
    const b = NEUER_RUMPF.indexOf("from public.skylanders t", a);
    expect(NEUER_RUMPF.indexOf(ZEILE)).toBeGreaterThan(a);
    expect(NEUER_RUMPF.indexOf(ZEILE)).toBeLessThan(b);
  });

  it("und catalog_status aus 0153 steht unverändert daneben", () => {
    /* Eine Ersetzung, die ein Feld gegen das andere tauscht, hätte denselben
       Zeilenzuwachs. Der Abdruck fängt das ab; hier steht es namentlich. */
    expect(NEUER_RUMPF).toContain("            'catalog_status', t.catalog_status,\n");
    expect(readFileSync(P0160, "utf8"))
      .toContain("0160 Nachbedingung: das Feld catalog_status aus 0153 ist fort");
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

  it("der Bereich skylanders führt base_sky_id", () => {
    expect(katalog).toBeDefined();
    expect(katalog?.fields).toContain("base_sky_id");
  });

  it("und er führt ihn nicht mehr als Ausschluss", () => {
    /*
     * DIE LÜCKE IST GESCHLOSSEN, nicht umformuliert. Solange der Eintrag in
     * `excluded` stand, war die Aussage „fehlt mit Begründung"; jetzt ist
     * die Aussage „ist dabei", und beides gleichzeitig wäre ein Widerspruch.
     */
    expect(katalog?.excluded ?? {}).not.toHaveProperty("base_sky_id");
  });

  /**
   * Die Felder, die NACH `0160` dazugekommen sind.
   *
   * Dieselbe Liste, die `platform-export-0153.test.ts` fuehrt, und aus
   * demselben Grund: das Manifest beschreibt die NEUESTE Fassung des
   * Rumpfes, diese Datei prueft die aus `0160`. Eine angewendete Migration
   * wird nicht mehr angefasst (Regel 1) — ihr Test bleibt bei ihrem Stand,
   * und der Preis dafuer ist diese Liste.
   *
   * Dass die drei im NEUEN Rumpf wirklich stehen, prueft
   * `platform-export-0164.test.ts`.
   */
  const NACH_0160 = ["types", "visible_type", "visible_type_decided"];

  it("jedes Feld des Manifests steht auch im Rumpf", () => {
    const a = NEUER_RUMPF.indexOf("'skylanders', coalesce((");
    const b = NEUER_RUMPF.indexOf("from public.skylanders t", a);
    const block = NEUER_RUMPF.slice(a, b);
    for (const feld of katalog?.fields ?? []) {
      if (NACH_0160.includes(feld)) continue;
      expect(block, `${feld} fehlt im Exportbereich`).toContain(`'${feld}', t.${feld}`);
    }
  });

  it("und die Nachzuegler-Liste ist keine Ausrede: jedes Feld darin steht im "
     + "Manifest", () => {
    for (const feld of NACH_0160) {
      expect(katalog?.fields ?? [], feld).toContain(feld);
    }
  });

  it("die Betriebssicherung bleibt draußen — dauerhaft, nicht vorläufig", () => {
    /*
     * Eine Variantenbeziehung ist redaktionelle Gruppierung der PLATTFORM
     * und kein Händlerdatum. Derselbe Grund wie bei `catalog_visible` und
     * `catalog_status`. Dieser Ausschluss hat KEIN Ablaufdatum — anders als
     * der, den `0160` gerade aufgehoben hat.
     */
    const sql = readFileSync("src/lib/backup/manifest.ts", "utf8");
    expect(sql).toContain("base_sky_id");
    expect(readFileSync(P0160, "utf8"))
      .toContain("seller_business_backup()` wird NICHT angefasst");
  });
});

describe("alte Archive bleiben lesbar", () => {
  /**
   * DIE ZUSAGE AUS DER AUFGABE, und sie ist hier nachgerechnet statt
   * behauptet: ein Archiv der Version 2, das VOR `0160` entstanden ist,
   * führt 54 Bereiche und kein `base_sky_id`. Die Vollständigkeitsprüfung
   * zählt BEREICHE — `sectionCounts()` und `SECTIONS_BY_FORMAT_VERSION` —,
   * und Felder kommen darin nicht vor. Deshalb ändert `0160` an der
   * Lesbarkeit alter Archive nichts.
   */
  const altesDokument = {
    format: "skyisles-platform-backup",
    format_version: 2,
    created_at: "2026-10-26T00:00:00.000Z",
    commerce_mode: "live",
    data: Object.fromEntries(PLATFORM_SECTIONS.map((s) => [s.source, []])),
  };

  it("ein Archiv der Version 2 ohne base_sky_id führt trotzdem 54 Bereiche", () => {
    expect(formatVersionOf(altesDokument)).toBe(2);
    expect(Object.keys(sectionCounts(altesDokument)).length).toBe(54);
    expect(SECTIONS_BY_FORMAT_VERSION[2]).toBe(54);
  });

  it("und eine Zeile ohne das Feld ist weiterhin eine gültige Katalogzeile", () => {
    /*
     * `base_sky_id` ist nullbar, und `NULL` ist der Normalfall (ADR-0156).
     * Eine alte Zeile ohne das Feld ist deshalb nicht unvollständig, sondern
     * eine Figur ohne Basisfigur — genau das, was 659 von 729 Katalogzeilen
     * auf Staging sind.
     */
    const alteZeile: Record<string, unknown> = { sky_id: "SKY-0053", name: "Spyro" };
    expect("base_sky_id" in alteZeile).toBe(false);
    expect(alteZeile.base_sky_id ?? null).toBeNull();
  });
});

describe("die Rücknahme", () => {
  it("stellt den Rumpf aus 0153 zeichengleich wieder her", () => {
    expect(md5(rumpf(PR0160))).toBe(ALT);
    expect(rumpf(PR0160)).toBe(ALTER_RUMPF);
  });

  it("nennt beide Abdrücke und überschreibt keine dritte Fassung", () => {
    const sql = readFileSync(PR0160, "utf8");
    expect(sql).toContain(`if v_abdruck = '${ALT}' then`);
    expect(sql).toContain(`elsif v_abdruck <> '${NEU}' then`);
    expect(sql).toContain("Eine dritte Fassung wird nicht");
  });

  it("geht EINEN Schritt zurück, nicht zwei", () => {
    /*
     * Die Gefahr bei einer Kette von Rumpfersetzungen: eine Rücknahme, die
     * zu weit zurückgeht, nimmt stillschweigend das Feld der vorigen
     * Migration mit. `R0160` prüft das ausdrücklich nach.
     */
    const sql = readFileSync(PR0160, "utf8");
    expect(sql).toContain("catalog_status aus 0153 ist mit");
    expect(rumpf(PR0160)).toContain("'catalog_status', t.catalog_status,");
    expect(rumpf(PR0160)).not.toContain("'base_sky_id', t.base_sky_id,");
  });

  it("fasst die Spalte und die Riegel aus 0159 nicht an", () => {
    /*
     * Der Rückbau nimmt das FELD aus dem Export, nicht die SPALTE aus der
     * Tabelle und nicht den Fremdschlüssel. Ein `alter table` darin wäre
     * Datenverlust statt Rücknahme — die Spalte gehört `0159`.
     */
    const sql = readFileSync(PR0160, "utf8");
    expect(sql).not.toMatch(/alter\s+table/i);
    expect(sql).not.toMatch(/\bdrop\s+(table|column|trigger|constraint)\b/i);
    expect(sql).not.toMatch(/^\s*update\s+public\./im);
  });
});
