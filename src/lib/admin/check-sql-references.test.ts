/**
 * Jede Tabelle, Spalte und Funktion, die eine Prüfdatei nennt, muss es geben.
 *
 * DER FEHLER, DEN DIESE DATEI GEFUNDEN HÄTTE.
 *
 * `0129_export_baseline.sql` zählte „alle 28 Bereiche" des Betriebsexports —
 * und hatte 29 Zeilen. Eine davon war
 *
 *     (select count(*) from public.orderbook_global_factor)
 *
 * und dieser Name gehört einer **Funktion** aus `0059`, niemals einer Tabelle.
 * Auf Staging endete die Datei mit `42P01: relation does not exist`; die
 * übrigen 55 Prüfungen liefen deshalb gar nicht.
 *
 * WARUM ES DURCHKAM. Die Gegenprobe beim Schreiben prüfte **eine Richtung**:
 * dass jeder Bereich des Manifests in der Datei vorkommt. Dass jede Zeile der
 * Datei ein Bereich ist, prüfte niemand. Eine einseitige Mengenprüfung findet
 * das Fehlende und übersieht das Erfundene.
 *
 * `columnsOf()` hätte es gesagt — es **wirft**, wenn eine Tabelle unbekannt
 * ist („failing rather than passing vacuously"). Die Prüfdatei lief nur nie
 * durch diesen Helfer. Jetzt tut es jede.
 *
 * WAS DIESE DATEI NICHT KANN. Sie liest Text, keine Datenbank. Eine Tabelle,
 * die die Migrationshistorie anlegt und eine spätere Migration löscht, hält
 * sie weiter für vorhanden — der Spalten-Fold kennt kein `drop table`. Für den
 * Fehler, um den es hier geht, genügt das: ein Name, den **nie** eine
 * Migration als Tabelle angelegt hat, fällt auf.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  allMigrations, columnsOf, migrationFiles, migrationSource,
} from "@/test-support/migrations";
import { BACKUP_SECTIONS } from "@/lib/backup/manifest";

const CHECK_DIR = "supabase/checks";
const checkSql = readdirSync(join(process.cwd(), CHECK_DIR))
  .filter((f) => f.endsWith(".sql")).sort()
  .map((f) => ({ file: f, sql: readFileSync(join(process.cwd(), CHECK_DIR, f), "utf8") }));

/** Jede Funktion, die die Historie irgendwo anlegt. */
const funktionen = new Set(
  [...allMigrations.matchAll(/create (?:or replace )?function public\.([a-z_0-9]+)\s*\(/g)]
    .map((m) => m[1]));

/**
 * Die Views der Historie — `columnsOf` kennt nur Tabellen.
 *
 * `business_movements` (`0086`) und `reservation_reconciliation` (`0010`) sind
 * Views, und Migrationen lesen aus ihnen. Ohne sie meldete dieser Wächter drei
 * Fehlalarme; mit ihnen ist er über die ganze Historie still, und das macht
 * ihn erst brauchbar.
 */
const views = new Set(
  [...allMigrations.matchAll(
    /create (?:or replace )?(?:materialized )?view public\.([a-z_0-9]+)/g)]
    .map((m) => m[1]));

/**
 * Gibt es diese Relation? `columnsOf` wirft, wenn es keine Tabelle findet —
 * für einen Wächter, der genau das wissen will, IST der Wurf die Antwort.
 */
function istTabelle(name: string): boolean {
  if (views.has(name)) return true;
  try { return columnsOf(name).size > 0; } catch { return false; }
}

/** Ausführbares SQL: ohne Kommentare und ohne Stringliterale. */
function nurCode(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--.*$/gm, "")
    /*
     * UND OHNE LITERALE. Die Prüfdateien SUCHEN Markertexte in
     * Funktionsrümpfen: `'coalesce(s.display_name_override, s.name,'` ist ein
     * gesuchter Text und keine Spaltenreferenz dieser Datei. Ohne diesen
     * Schritt meldete der Wächter drei Fehlalarme in den `0124`-Dateien.
     */
    .replace(/'(?:[^']|'')*'/g, "''");
}

/** Relationen in FROM/JOIN — ohne Klammer, also keine Funktionsaufrufe. */
function relationen(code: string): string[] {
  return [...new Set(
    [...code.matchAll(/\b(?:from|join)\s+public\.([a-z_0-9]+)(\s*\()?/g)]
      .filter((m) => m[2] === undefined)
      .map((m) => m[1]))].sort();
}

/** Aufgerufene Funktionen: `public.name(`. */
function aufrufe(code: string): string[] {
  return [...new Set(
    [...code.matchAll(/public\.([a-z_0-9]+)\s*\(/g)].map((m) => m[1]))].sort();
}

/* ==========================================================================
 * 1. Relationen
 * ======================================================================== */

describe("jede Relation einer Prüfdatei ist eine Tabelle der Historie", () => {
  it("es gibt überhaupt Prüfdateien", () => {
    expect(checkSql.length).toBeGreaterThanOrEqual(20);
    expect(checkSql.map((c) => c.file)).toContain("0129_export_baseline.sql");
  });

  /*
   * UND DIE MIGRATIONEN MIT. PostgreSQL prüft eine `language sql`-Funktion
   * beim Anlegen, einen PL/pgSQL-Rumpf aber erst beim Ausführen — eine falsche
   * Tabelle darin fällt im Betrieb auf und nicht beim Anwenden. `0047` hat
   * genau das gekostet: eine Anweisung mit der falschen Tabelle ist
   * wohlgeformter Text, und 63 Quelltextprüfungen sahen nichts.
   */
  const alleDateien = checkSql.concat(
    migrationFiles.map((f) => ({ file: f, sql: migrationSource(f) })));

  for (const { file, sql } of alleDateien) {
    it(file, () => {
      const code = nurCode(sql);
      const erfunden = relationen(code).filter((t) => !istTabelle(t));
      expect(erfunden, `${file} nennt Relationen, die keine Tabelle sind`).toEqual([]);
    });
  }

  it("POSITIVKONTROLLE: der Fehlgriff aus 0129 würde auffallen", () => {
    /*
     * Ein Wächter, der nie etwas findet, beweist nichts. Links der Name, der
     * auf Staging `42P01` ausgelöst hat, rechts eine echte Tabelle.
     */
    const kaputt = "((select count(*) from public.orderbook_global_factor))::text";
    expect(relationen(nurCode(kaputt)).filter((t) => !istTabelle(t)))
      .toEqual(["orderbook_global_factor"]);

    const richtig = "((select count(*) from public.purchase_receipts))::text";
    expect(relationen(nurCode(richtig)).filter((t) => !istTabelle(t))).toEqual([]);
  });

  it("und der Name gehört wirklich einer Funktion, nicht einer Tabelle", () => {
    expect(funktionen.has("orderbook_global_factor")).toBe(true);
    expect(istTabelle("orderbook_global_factor")).toBe(false);
    /* Im Export kommt er genau einmal vor: als Metadatum, mit Klammern. */
    expect(allMigrations).toContain("'buy_in_factor',   public.orderbook_global_factor()::text");
  });
});

/* ==========================================================================
 * 2. Funktionen
 * ======================================================================== */

describe("jede gerufene Funktion einer Prüfdatei gibt es", () => {
  /*
   * Eingebaute Funktionen stehen nicht in der Historie. Geprüft werden nur
   * Aufrufe mit `public.`-Präfix — und die sind in diesem Projekt immer
   * selbst geschrieben.
   */
  const alleDateien = checkSql.concat(
    migrationFiles.map((f) => ({ file: f, sql: migrationSource(f) })));

  for (const { file, sql } of alleDateien) {
    it(file, () => {
      const code = nurCode(sql);
      const erfunden = aufrufe(code)
        .filter((f) => !funktionen.has(f))
        /* Eine Tabelle in Klammern gibt es nicht, aber `public.t (…)` könnte
           eine Spaltenliste sein — solche Namen fallen in Prüfung 1. */
        .filter((f) => !istTabelle(f));
      expect(erfunden, `${file} ruft Funktionen, die es nicht gibt`).toEqual([]);
    });
  }
});

/* ==========================================================================
 * 3. Spalten
 * ======================================================================== */

describe("jede Spalte, die eine Prüfdatei über einen Alias nennt, gibt es", () => {
  /*
   * DIE GRENZE DIESER PRÜFUNG, EHRLICH BENANNT.
   *
   * Erstens: ein Alias, der in derselben Datei an zwei Tabellen gebunden ist
   * (`p` an `pg_proc` UND an `purchases`), wird ÜBERSPRUNGEN — sonst
   * entstünden Fehlalarme statt Befunde.
   *
   * Zweitens, und deshalb gilt sie nur für die PRÜFDATEIEN: ein Versuch über
   * die Migrationen ergab 14 Treffer, und sie waren alle unecht — Aliasse, die
   * dort an eine CTE gebunden sind, die so heißt wie eine Tabelle
   * (`order_events`, `platform_settings`, `shipping_countries`). Ein Wächter,
   * der vierzehnmal falschen Alarm schlägt, wird abgeschaltet statt gelesen.
   * Die Relations- und die Funktionsprüfung oben gelten dagegen für BEIDE
   * Verzeichnisse — dort ist er über die ganze Historie still.
   */
  for (const { file, sql } of checkSql) {
    it(file, () => {
      const code = nurCode(sql);
      const bindung = new Map<string, Set<string>>();
      for (const m of code.matchAll(
             /\b(?:from|join)\s+(?:public\.)?([a-z_0-9]+)\s+(?:as\s+)?([a-z][a-z0-9_]?)\b/g)) {
        const [, tabelle, alias] = m;
        if (!bindung.has(alias)) bindung.set(alias, new Set());
        bindung.get(alias)!.add(tabelle);
      }

      const verstoesse = new Set<string>();
      for (const [alias, tabellen] of bindung) {
        if (tabellen.size !== 1) continue;
        const tabelle = [...tabellen][0];
        if (!istTabelle(tabelle)) continue;
        const spalten = columnsOf(tabelle);
        for (const m of code.matchAll(new RegExp(`\\b${alias}\\.([a-z_0-9]+)\\b`, "g"))) {
          if (!spalten.has(m[1])) verstoesse.add(`${alias}(${tabelle}).${m[1]}`);
        }
      }
      expect([...verstoesse].sort(), `${file} nennt Spalten, die es nicht gibt`)
        .toEqual([]);
    });
  }

  it("POSITIVKONTROLLE: eine erfundene Spalte fällt auf", () => {
    const spalten = columnsOf("purchase_receipts");
    expect(spalten.has("content_fingerprint")).toBe(true);
    expect(spalten.has("is_test")).toBe(false);
  });
});

/* ==========================================================================
 * 4. Die Bereichsliste der Export-Baseline — BEIDE Richtungen
 * ======================================================================== */

describe("die Export-Baseline zählt genau die Bereiche des Manifests", () => {
  const datei = checkSql.find((c) => c.file === "0129_export_baseline.sql")!;
  const inDatei = [...datei.sql.matchAll(/\(1\d\d, 'counts', '([a-z_]+)/g)]
    .map((m) => m[1]);
  const quellen = BACKUP_SECTIONS.map((s) => s.source);

  it("jeder Bereich des Manifests hat eine Zeile", () => {
    expect(quellen.filter((t) => !inDatei.includes(t))).toEqual([]);
  });

  /*
   * DIE RICHTUNG, DIE GEFEHLT HAT. Ohne sie blieb eine erfundene Tabelle
   * stehen, und die Datei behauptete 28 Bereiche bei 29 Zeilen.
   */
  it("und jede Zeile ist ein Bereich — nicht einer mehr", () => {
    expect(inDatei.filter((t) => !quellen.includes(t))).toEqual([]);
  });

  it("die Zahlen stimmen überein", () => {
    expect(inDatei).toHaveLength(quellen.length);
    expect(inDatei).toHaveLength(28);
  });

  it("der Buy-in-Faktor wird NICHT abgefragt — er ist ein Geschäftsgeheimnis", () => {
    /* ADR-0103: `orderbook_global_factor()` ist für `authenticated` gesperrt.
       Eine Prüfdatei schreibt ihn nicht in ein Protokoll. */
    expect(datei.sql).not.toMatch(/select\s+public\.orderbook_global_factor\(\)/);
    expect(datei.sql).toContain("Geschaeftsgeheimnis");
  });
});

/* ==========================================================================
 * 5. CTE-Spalten: ein Verweis auf eine entfernte Spalte bricht beim Parsen ab
 * ======================================================================== */

/**
 * DER FEHLER, DEN DIESER BLOCK FINDET.
 *
 * `0130_export_keys_diagnosis.sql` brach auf Staging beim Parsen ab:
 *
 *     ERROR: 42703: column b.block does not exist
 *
 * Beim Umbau von der block- auf die zeilenweise Bereichserkennung lieferte das
 * CTE `bereich` nur noch `name` — zwei Prüfungen verwiesen aber weiter auf
 * `b.block`. `pglast` fand das nicht: eine Syntaxprüfung sieht keine Spalten.
 * Genau dieselbe Leiche steckte auch in `0130_postflight.sql`.
 *
 * WAS HIER GEPRÜFT WIRD. Je Datei werden die CTEs mit ihren AUSGABESPALTEN
 * erhoben und danach jede qualifizierte Referenz `alias.spalte` geprüft, deren
 * Alias auf ein CTE zeigt.
 *
 * DIE GRENZE, EHRLICH BENANNT. Das ist ein lexikalischer Leser und kein
 * PostgreSQL. Er versteht die Form, in der diese Dateien geschrieben sind: ein
 * CTE beginnt auf Spalte 0 mit `name as (` oder `name (spalten) as (`, seine
 * Ausgabespalten stehen als `… as spalte` oder als `tabelle.spalte` in der
 * Zielliste. Ein Alias, der in derselben Datei auf mehr als eine Relation
 * zeigt, wird übersprungen — in diesen Dateien steht `p` für `pg_proc` UND für
 * das CTE `probe`.
 *
 * Gegengeprüft wurde dieselbe Frage zusätzlich mit dem echten PostgreSQL-Parser
 * über den Syntaxbaum (`pglast`, `CommonTableExpr` gegen `ColumnRef`): 22
 * Prüfdateien und die eingebetteten CTE-Abfragen beider Migrationen, Befund 0.
 * Ein lokales PostgreSQL gibt es auf dieser Maschine nicht — siehe Bericht.
 */
describe("kein Verweis auf eine Spalte, die ein CTE nicht liefert", () => {
  type Cte = { name: string; spalten: Set<string> };

  /**
   * Die Namen, die eine Zielliste nach außen gibt.
   *
   * Genommen wird der Text zwischen `select` und dem ersten `from` auf
   * derselben Klammerebene, dann je Eintrag: `… as name` gewinnt, sonst der
   * letzte Namensteil (`a.name` → `name`), sonst der nackte Bezeichner. Ein
   * Eintrag, aus dem sich kein Name ableiten lässt (eine Aggregatfunktion ohne
   * Alias), liefert nichts — dann ist die Spaltenmenge unvollständig, und die
   * Prüfung unten überspringt das CTE, statt Fehlalarm zu schlagen.
   */
  function zielliste(rumpf: string): string[] {
    const ab = rumpf.search(/\bselect\b/i);
    if (ab < 0) return [];
    let rest = rumpf.slice(ab + 6);
    /* Bis zum `from` auf Ebene 0 — Unterabfragen haben ihr eigenes `from`. */
    let tiefe = 0;
    let ende = rest.length;
    for (let k = 0; k < rest.length; k += 1) {
      const c = rest[k];
      if (c === "(") tiefe += 1;
      else if (c === ")") tiefe -= 1;
      else if (tiefe === 0 && /\s/.test(c) && /^\s+from\s/i.test(rest.slice(k))) {
        ende = k;
        break;
      }
    }
    rest = rest.slice(0, ende);
    /* Auf Ebene 0 an Kommas trennen. */
    const teile: string[] = [];
    let puffer = "";
    tiefe = 0;
    for (const c of rest) {
      if (c === "(") tiefe += 1;
      if (c === ")") tiefe -= 1;
      if (c === "," && tiefe === 0) { teile.push(puffer); puffer = ""; continue; }
      puffer += c;
    }
    if (puffer.trim() !== "") teile.push(puffer);

    const namen: string[] = [];
    for (const teil of teile) {
      const s = teil.trim();
      const mitAlias = /\bas\s+([a-z_0-9]+)$/i.exec(s);
      if (mitAlias !== null) { namen.push(mitAlias[1]); continue; }
      const qualifiziert = /^[a-z_0-9]+\.([a-z_0-9]+)$/i.exec(s);
      if (qualifiziert !== null) { namen.push(qualifiziert[1]); continue; }
      const nackt = /^([a-z_0-9]+)$/i.exec(s);
      if (nackt !== null) namen.push(nackt[1]);
    }
    return namen;
  }

  /** Die CTEs einer Datei mit ihren Ausgabespalten. */
  function ctesVon(sql: string): Map<string, Cte> {
    const code = nurCode(sql);
    const zeilen = code.split("\n");
    const out = new Map<string, Cte>();

    for (let i = 0; i < zeilen.length; i += 1) {
      /* `name as (` oder `name (a, b) as (` — beides auf Spalte 0. */
      const kopf = /^([a-z_0-9]+)\s*(?:\(([^)]*)\))?\s+as\s+\($/.exec(zeilen[i]);
      if (kopf === null) continue;
      const name = kopf[1];
      const spalten = new Set<string>();

      if (kopf[2] !== undefined) {
        /* Spaltenliste im Kopf gewinnt: `lauf (rang, anzahl) as (values …)`
           hat keine Zielliste, aber sehr wohl Ausgabespalten. */
        for (const s of kopf[2].split(",")) {
          const n = s.trim();
          if (n !== "") spalten.add(n);
        }
      } else {
        /* Sonst der Rumpf bis zur schließenden Klammer auf Spalte 0. */
        const rumpf: string[] = [];
        for (let j = i + 1; j < zeilen.length; j += 1) {
          if (/^\),?$/.test(zeilen[j])) break;
          rumpf.push(zeilen[j]);
        }
        for (const n of zielliste(rumpf.join("\n"))) spalten.add(n);
      }
      out.set(name, { name, spalten });
    }
    return out;
  }

  /** alias → Relationen, über ALLE Bindungen der Datei. */
  function bindungen(sql: string): Map<string, Set<string>> {
    const code = nurCode(sql);
    const out = new Map<string, Set<string>>();
    for (const m of code.matchAll(
           /\b(?:from|join)\s+(?:public\.)?([a-z_0-9]+)\s+(?:as\s+)?([a-z][a-z0-9_]?)\b/g)) {
      const [, rel, alias] = m;
      if (!out.has(alias)) out.set(alias, new Set());
      out.get(alias)!.add(rel);
    }
    return out;
  }

  /** Die Verstöße einer Datei. */
  function verstoesse(sql: string): string[] {
    const ctes = ctesVon(sql);
    const code = nurCode(sql);
    const treffer = new Set<string>();
    for (const [alias, rel] of bindungen(sql)) {
      if (rel.size !== 1) continue;
      const name = [...rel][0];
      const cte = ctes.get(name);
      if (cte === undefined || cte.spalten.size === 0) continue;
      for (const m of code.matchAll(new RegExp(`\\b${alias}\\.([a-z_0-9]+)\\b`, "g"))) {
        if (!cte.spalten.has(m[1])) treffer.add(`${alias}(${name}).${m[1]}`);
      }
    }
    return [...treffer].sort();
  }

  const BETROFFEN = [
    ...["0130_export_keys_diagnosis", "0130_preflight", "0130_postflight",
        "0131_preflight", "0131_postflight", "0129_export_baseline"]
      .map((f) => ({ datei: `supabase/checks/${f}.sql`, kurz: f })),
    ...["0130_business_backup_fields", "0131_business_backup_seller_fields"]
      .map((f) => ({ datei: `supabase/migrations/${f}.sql`, kurz: f })),
  ];

  it("der Leser findet die CTEs überhaupt", () => {
    const ctes = ctesVon(readFileSync(
      "supabase/checks/0130_export_keys_diagnosis.sql", "utf8"));
    for (const name of ["def", "code", "zeile", "anfang", "bereich", "feld", "pruef"]) {
      expect(ctes.has(name), name).toBe(true);
    }
    /* `bereich` liefert GENAU `name` — und eben nicht `block`. */
    expect([...ctes.get("bereich")!.spalten]).toEqual(["name"]);
    expect(ctes.get("feld")!.spalten).toContain("schluessel");
    expect(ctes.get("pruef")!.spalten).toContain("befund");
  });

  for (const { datei, kurz } of BETROFFEN) {
    it(kurz, () => {
      expect(verstoesse(readFileSync(datei, "utf8")), kurz).toEqual([]);
    });
  }

  it("POSITIVKONTROLLE: `b.block` würde auffallen", () => {
    /*
     * Genau der Verweis, an dem Staging abgebrochen ist — und daneben der
     * gültige auf `b.name`, der nicht auffallen darf.
     */
    const kaputt = [
      "bereich as (",
      "  select a.name from anfang a",
      "),",
      "pruef (nr, befund) as (",
      "  values (1, (select b.block from bereich b where b.name = 'x'))",
      ")",
    ].join("\n");
    expect(verstoesse(kaputt)).toEqual(["b(bereich).block"]);

    const richtig = kaputt.replace("b.block", "b.name");
    expect(verstoesse(richtig)).toEqual([]);
  });

  it("und eine entfernte Spalte in einem anderen CTE ebenso", () => {
    const kaputt = [
      "feld as (",
      "  select b.name, (k.g)[1] as schluessel from bereich b",
      "),",
      "pruef (nr, befund) as (",
      "  values (1, (select f.block from feld f))",
      ")",
    ].join("\n");
    expect(verstoesse(kaputt)).toEqual(["f(feld).block"]);
  });
});
