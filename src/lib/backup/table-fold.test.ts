import { describe, expect, it } from "vitest";

import { tablesFromMigrations, tablesOf } from "@/test-support/migrations";

/**
 * Der Tabellen-Fold, an dem zwei Sicherungswächter hängen.
 *
 * WARUM ES DIESE DATEI GIBT. Beide Vollständigkeitsprüfungen der Sicherungen
 * — „jede Tabelle ist entschieden" — leiteten ihre Grundgesamtheit aus einer
 * von Hand getippten Liste ab. Beide haben deshalb zweimal geschwiegen,
 * während eine Tabelle fehlte:
 *
 *   * vor `0122` fehlten die drei Belegtabellen im Plattformmanifest;
 *   * `0142` legte `purchase_calculations` an, und wieder sagte niemand etwas
 *     — gefunden am 2026-10-25 von Hand beim Production-Release-Check.
 *
 * Seit dem 2026-10-25 kommt die Grundgesamtheit aus den Migrationen. Damit
 * verlagert sich die Frage: nicht mehr „pflegt jemand die Liste nach", sondern
 * **„versteht der Fold, was in den Migrationen steht — und sagt er es, wenn
 * nicht?"** Diese Datei beantwortet die zweite Hälfte, denn ein Fold, der
 * schweigend die leere Menge liefert, wäre genau derselbe Fehler in neuer
 * Gestalt.
 *
 * Geprüft wird über `tablesFromMigrations`, also an erfundenen Anweisungen.
 * Gegen die echte Historie prüft `platform-manifest.test.ts`.
 */

/** Eine Quelle, wie der Fold sie erwartet. */
const q = (sql: string) => [{ file: "9999_probe.sql", sql }];

describe("der Fold versteht die drei Formen, die dieses Projekt benutzt", () => {
  it("create table public.x", () => {
    expect([...tablesFromMigrations(q("create table public.alpha (\n  id bigint\n);"))])
      .toEqual(["alpha"]);
  });

  it("create table if not exists public.x", () => {
    expect([...tablesFromMigrations(
      q("create table if not exists public.beta (\n  id bigint\n);"))]).toEqual(["beta"]);
  });

  it("drop table nimmt sie wieder fort", () => {
    const sql = "create table public.gamma (id bigint);\ndrop table public.gamma;";
    expect(() => tablesFromMigrations(q(sql))).toThrow(/keine einzige Tabelle/);
  });

  it("drop table if exists ebenso", () => {
    const sql = "create table public.a (id bigint);\ncreate table public.b (id bigint);\n"
      + "drop table if exists public.a;";
    expect([...tablesFromMigrations(q(sql))]).toEqual(["b"]);
  });

  it("alter table … rename to folgt der Umbenennung", () => {
    /* `0026` tut genau das mit `business_settings` → `platform_settings`. */
    const sql = "create table public.alt (id bigint);\n"
      + "alter table public.alt rename to neu;";
    expect([...tablesFromMigrations(q(sql))]).toEqual(["neu"]);
  });

  it("und verwechselt eine Spalten- oder Constraint-Umbenennung nicht damit", () => {
    /*
     * `0026` benennt in derselben Datei drei CONSTRAINTS um. Die Zeilen
     * enthalten „rename" und „to", aber nicht „rename to" — würde der Fold
     * lockerer suchen, hieße die Tabelle hinterher
     * `platform_settings_singleton`.
     */
    const sql = "create table public.c (id bigint);\n"
      + "alter table public.c rename constraint c_eins to c_zwei;\n"
      + "alter table public.c rename column alt to neu;";
    expect([...tablesFromMigrations(q(sql))]).toEqual(["c"]);
  });

  it("die Reihenfolge gilt: anlegen, umbenennen, wieder anlegen", () => {
    const sql = "create table public.x (id bigint);\n"
      + "alter table public.x rename to y;\n"
      + "create table public.x (id bigint);";
    expect([...tablesFromMigrations(q(sql))].sort()).toEqual(["x", "y"]);
  });
});

describe("was der Fold ausdrücklich NICHT mitzählt", () => {
  it("temporäre Notizblöcke — elf Migrationen bauen sie", () => {
    /*
     * `z1_abdruck`, `tmp_0067_orders`, `_names_0117` … sie leben eine
     * Transaktion, `on commit drop` räumt sie weg, und keine Sicherung
     * könnte oder sollte sie führen. Erkannt wird das an der FORM —
     * temporär und unqualifiziert —, nie an einem Namen auf einer Liste.
     */
    const sql = "create table public.echt (id bigint);\n"
      + "create temporary table z1_abdruck (id bigint) on commit drop;\n"
      + "create temp table tmp_0067_orders (id bigint);\n"
      + "drop table z1_abdruck;";
    expect([...tablesFromMigrations(q(sql))]).toEqual(["echt"]);
  });

  it("Ansichten, denn sie tragen keine eigenen Zeilen", () => {
    /*
     * Drei gibt es auf `public`: `business_movements`,
     * `reservation_reconciliation`, `shop_inventory_reconciliation`.
     */
    const sql = "create table public.echt (id bigint);\n"
      + "create or replace view public.business_movements as select 1;\n"
      + "create view public.shop_inventory_reconciliation as select 1;";
    expect([...tablesFromMigrations(q(sql))]).toEqual(["echt"]);
  });

  it("und was in einem Kommentar steht", () => {
    /*
     * DAS IST KEINE FEINHEIT. **Jedes** `drop table` dieser Historie steht
     * in einem Kommentar: `0105` nennt eines als Rücknahmehinweis,
     * `0135`/`0137`/`0138` erklären, warum sie ihre Notizblöcke NICHT
     * löschen. Ein Fold über den Rohtext würde vier Tabellen entfernen, die
     * es gibt — darunter `platform_export_runs`.
     */
    const sql = "create table public.echt (id bigint);\n"
      + "--   drop table if exists public.echt;\n"
      + "/* create table public.erfunden (id bigint); */";
    expect([...tablesFromMigrations(q(sql))]).toEqual(["echt"]);
  });
});

describe("und er scheitert LAUT, statt zu raten", () => {
  /*
   * Der Kern dieser Datei. Der alte Fehler war ein Wächter, der bestand,
   * während etwas fehlte. Jede Form, die dieser Fold nicht versteht, muss
   * deshalb die Suite anhalten — nicht stillschweigend übergangen werden.
   */
  it("ein fremdes Schema", () => {
    expect(() => tablesFromMigrations(q("create table auth.users (id uuid);")))
      .toThrow(/nicht versteht/);
  });

  it("eine unqualifizierte, NICHT temporäre Tabelle", () => {
    expect(() => tablesFromMigrations(q("create table ohne_schema (id bigint);")))
      .toThrow(/nicht versteht/);
  });

  it("eine Umbenennung in ein anderes Schema", () => {
    const sql = "create table public.x (id bigint);\n"
      + "alter table public.x rename to anders.y;";
    expect(() => tablesFromMigrations(q(sql))).toThrow(/nicht versteht/);
  });

  it("ein drop, dessen Ziel sich nicht auflösen lässt", () => {
    /*
     * Ein unqualifizierter Name, der mit einer echten `public`-Tabelle
     * kollidiert: dann ist nicht entscheidbar, ob der Notizblock oder die
     * Tabelle gemeint ist. Lieber melden als eine Tabelle verlieren.
     */
    const sql = "create table public.kollision (id bigint);\ndrop table kollision;";
    expect(() => tablesFromMigrations(q(sql))).toThrow(/nicht versteht/);
  });

  it("die Fehlermeldung nennt Datei und Anweisung", () => {
    try {
      tablesFromMigrations([{ file: "0777_etwas.sql", sql: "create table auth.x (id uuid);" }]);
      throw new Error("hätte werfen müssen");
    } catch (e) {
      expect(String(e)).toContain("0777_etwas.sql");
      expect(String(e)).toContain("create table auth.x");
    }
  });

  it("und die leere Menge ist ein Fehler, kein Ergebnis", () => {
    /*
     * Genau dieser Riegel hat beim Bau geholfen: eine Zeichenkette statt
     * eines Regex-Literals machte aus `create\\s+` den Text `creates+`, der
     * Fold fand null Tabellen — und hätte jeden Wächter leer bestehen
     * lassen. Stattdessen stand die Suite.
     */
    expect(() => tablesFromMigrations(q("-- nichts hier"))).toThrow(/keine einzige Tabelle/);
    expect(() => tablesFromMigrations([])).toThrow(/keine einzige Tabelle/);
  });
});

describe("gegen die echte Historie", () => {
  it("66 Tabellen, die Umbenennung aus 0026 angewendet", () => {
    const alle = tablesOf();
    expect(alle.size).toBeGreaterThanOrEqual(66);
    /* `0026`: business_settings → platform_settings. Die handgepflegte Liste
       hat das mit einem `.filter().concat()` nachgestellt; jetzt fällt es aus
       dem Fold. */
    expect(alle.has("business_settings")).toBe(false);
    expect(alle.has("platform_settings")).toBe(true);
    /* Die beiden, die den Wächtern entgangen sind. */
    expect(alle.has("purchase_receipts")).toBe(true);
    expect(alle.has("purchase_calculations")).toBe(true);
    /* Und kein Notizblock, keine Ansicht. */
    for (const name of alle) {
      expect(name, "sieht nach einem Notizblock aus").not.toMatch(/^(z\d|tmp_|_names)/);
      expect(name, "ist eine Ansicht").not.toMatch(/reconciliation$|^business_movements$/);
    }
  });
});
