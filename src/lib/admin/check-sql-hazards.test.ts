/**
 * Zwei Fehlerklassen, die zweimal erst im Production-SQL-Editor aufgefallen
 * sind — und die kein Parser findet, weil beide syntaktisch einwandfrei sind.
 *
 * WAS PASSIERT IST, am 2026-10-18:
 *
 *   42725  `t.tgname || ' (' || t.tgenabled || ')'`. `tgenabled` ist vom Typ
 *          `"char"`, und `text || "char"` ist in PostgreSQL MEHRDEUTIG — es
 *          gibt mehr als einen passenden Operator. Die Abfrage brach beim
 *          Planen ab, bevor eine Zeile entstand.
 *   42P01  die FROM-Klausel band den Alias `ofrfr`, die WHERE-Klausel nannte
 *          `ofr`. Folge einer Textersetzung, die ihr eigenes Ergebnis ein
 *          zweites Mal getroffen hat.
 *
 * DIESE DATEI PRÜFT DEN TEXT, NICHT DIE DATENBANK — und deckt damit genau
 * zwei der vier Klassen ab:
 *
 *   ✓ ein Alias, der nirgends in der Datei gebunden ist  (42P01)
 *   ✓ eine Katalogspalte mit Nicht-Text-Typ in einer Verkettung  (42725)
 *   ✗ ein Alias, der in der FALSCHEN Unterabfrage steht (in der Datei
 *     gebunden, im Geltungsbereich aber nicht sichtbar)
 *   ✗ eine Spalte, die es nicht gibt — das kann `check-sql-references.test.ts`
 *     für Aliasse mit eindeutiger Bindung, aber nicht allgemein
 *
 * Für die beiden offenen Klassen gibt es `npm run verify:check-sql`: echtes
 * PostgreSQL als WebAssembly mit einem Stub-Schema aus den Migrationen, das
 * jede Prüfdatei PLANT. Das ist die vollständige Prüfung — sie braucht aber
 * eine optionale Abhängigkeit und läuft deshalb nicht in dieser Suite.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHECK_DIR = "supabase/checks";
const dateien = readdirSync(join(process.cwd(), CHECK_DIR))
  .filter((f) => f.endsWith(".sql")).sort()
  .map((f) => ({ file: f, sql: readFileSync(join(process.cwd(), CHECK_DIR, f), "utf8") }));

/**
 * Kommentare, Zeichenketten und `$$`-Blöcke weg — in EINEM Durchlauf von
 * links nach rechts.
 *
 * WARUM NICHT MIT ERSETZUNGEN. Der erste Entwurf hat vier Ersetzungen
 * hintereinander laufen lassen: Blockkommentar, Zeilenkommentar, Literal. Das
 * geht in beide Richtungen schief — ein `--` INNERHALB eines Literals macht
 * den Rest der Zeile zum Kommentar, und ein Apostroph in einem deutschen
 * Kommentar verschiebt alle folgenden Literalgrenzen. Beides hat in echten
 * Prüfdateien Fehlalarm erzeugt.
 *
 * Ein Scanner kennt dagegen immer seinen Zustand und kann sich nicht
 * verschieben. `$$`-Blöcke sind plpgsql: dort ist `v_item.state` eine
 * Variable, keine Tabellenreferenz.
 */
function nurSql(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "-" && sql[i + 1] === "-") {
      const e = sql.indexOf("\n", i);
      out += " ";
      i = e < 0 ? sql.length : e;
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      const e = sql.indexOf("*/", i + 2);
      out += " ";
      i = e < 0 ? sql.length : e + 2;
      continue;
    }
    if (c === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
        if (sql[i] === "'") { i++; break; }
        i++;
      }
      out += " '' ";
      continue;
    }
    const dollar = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
    if (dollar) {
      const e = sql.indexOf(dollar[0], i + dollar[0].length);
      out += " '' ";
      i = e < 0 ? sql.length : e + dollar[0].length;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Jeder Name, der als Qualifizierer `x.` benutzt wird. */
function benutzt(code: string): Set<string> {
  const out = new Set<string>();
  for (const m of code.matchAll(/\b([a-z_][a-z0-9_]*)\.[a-z_*]/g)) out.add(m[1]);
  return out;
}

/** Jeder Name, der als Alias, als Relation oder als CTE gebunden ist. */
function gebunden(code: string): Set<string> {
  const out = new Set<string>([
    // Schemata und Pseudo-Relationen, die nie eine Bindung brauchen.
    "public", "pg_catalog", "information_schema", "auth", "storage", "extensions",
    "pg_temp", "new", "old", "excluded",
  ]);
  // from/join <relation|funktion(...)> [as] <alias>
  for (const m of code.matchAll(
         /\b(?:from|join)\s+(?:(?:[a-z_][a-z0-9_]*)\.)?([a-z_][a-z0-9_]*)\s*(?:\([^)]*\))?\s*(?:as\s+)?([a-z_][a-z0-9_]*)?/gi)) {
    out.add(m[1].toLowerCase());
    const alias = m[2]?.toLowerCase();
    if (alias && !["on", "where", "group", "order", "union", "left", "join", "inner",
                   "cross", "lateral", "using", "limit", "and", "as", "having",
                   "window", "offset", "for", "full", "right", "natural"].includes(alias)) {
      out.add(alias);
    }
  }
  // CTE-Namen: `with x as (`, `, x as (`, und `x (spalten) as (`
  for (const m of code.matchAll(/(?:with|,)\s+([a-z_][a-z0-9_]*)\s*(?:\([^)]*\))?\s+as\s*\(/gi)) {
    out.add(m[1].toLowerCase());
  }
  /*
   * Kommagetrennte FROM-Glieder (`from pg_proc p, aclexplode(p.proacl) a`),
   * Unterabfragen (`from (select …) d`) und LATERAL-Aufrufe. Ohne diese drei
   * Formen meldete der Wächter in 30 Prüfdateien Fehlalarm.
   *
   * ES WIRD ABSICHTLICH ZU VIEL GEBUNDEN. Ein Spaltenalias wie `as n` landet
   * mit in der Menge, und damit bliebe ein freier Qualifizierer, der zufällig
   * `n` heißt, unentdeckt. Das ist die richtige Richtung für einen Wächter,
   * der bei jedem Testlauf mitläuft: ein Fehlalarm wird abgeschaltet, eine
   * Lücke wird von `verify:check-sql` geschlossen.
   */
  for (const m of code.matchAll(/\)\s*(?:as\s+)?([a-z_][a-z0-9_]*)/gi)) {
    out.add(m[1].toLowerCase());
  }
  for (const m of code.matchAll(
         /,\s*(?:(?:[a-z_][a-z0-9_]*)\.)?([a-z_][a-z0-9_]*)\s*(?:\([^)]*\))?\s+(?:as\s+)?([a-z_][a-z0-9_]*)/gi)) {
    out.add(m[1].toLowerCase());
    out.add(m[2].toLowerCase());
  }
  return out;
}

describe("kein Alias ohne Bindung in einer Prüfdatei (42P01)", () => {
  for (const { file, sql } of dateien) {
    it(file, () => {
      const code = nurSql(sql);
      const frei = [...benutzt(code)].filter((n) => !gebunden(code).has(n)).sort();
      expect(frei, `${file}: diese Qualifizierer sind nirgends gebunden`).toEqual([]);
    });
  }

  it("POSITIVKONTROLLE: der echte Fehler vom 2026-10-18 fällt auf", () => {
    const kaputt = "select (select count(*) from public.shop_offers() ofrfr"
      + " where ofr.sky_id >= 'SKY-9000')";
    const code = nurSql(kaputt);
    expect([...benutzt(code)].filter((n) => !gebunden(code).has(n))).toEqual(["ofr"]);
  });

  it("GEGENKONTROLLE: dieselbe Abfrage mit passendem Alias ist still", () => {
    const heil = "select (select count(*) from public.shop_offers() ofr"
      + " where ofr.sky_id >= 'SKY-9000')";
    const code = nurSql(heil);
    expect([...benutzt(code)].filter((n) => !gebunden(code).has(n))).toEqual([]);
  });
});

/*
 * Katalogspalten, deren Typ NICHT text ist. In einer Verkettung braucht jede
 * von ihnen einen ausdrücklichen Cast — `name` hat eine implizite Umwandlung
 * und käme oft durch, `"char"` nicht, und auf diesen Unterschied soll sich
 * niemand verlassen müssen.
 */
const KATALOG_NICHT_TEXT: Record<string, string> = {
  tgenabled: '"char"', tgname: "name", tgtype: "int2",
  proname: "name", prokind: '"char"', provolatile: '"char"', proacl: "aclitem[]",
  relname: "name", relkind: '"char"', relpersistence: '"char"',
  nspname: "name", rolname: "name", attname: "name", typname: "name",
  conname: "name", amname: "name", datname: "name",
};

/**
 * Steht die Spalte UNMITTELBAR an einem `||`? Nur das ist der Fehlerfall.
 *
 * Die erste Fassung suchte im Umfeld von 40 Zeichen und meldete deshalb
 * `aclexplode(p.proacl)` in der Naehe einer Verkettung — ein Argument, keine
 * Verkettung. `string_agg(proname, ', ')` ist dagegen KEIN Fehler: `name` hat
 * eine implizite Umwandlung nach text und loest sich auf. `"char"` hat keine,
 * und genau daran brach der Lauf vom 2026-10-18 ab.
 */
function anVerkettung(code: string, index: number, laenge: number): boolean {
  const vor = code.slice(0, index).trimEnd();
  const nach = code.slice(index + laenge).trimStart();
  return vor.endsWith("||") || nach.startsWith("||");
}

function typGefahren(code: string): string[] {
  const treffer: string[] = [];
  for (const spalte of Object.keys(KATALOG_NICHT_TEXT)) {
    const re = new RegExp(`(?:[a-z_][a-z0-9_]*\\.)?\\b${spalte}\\b(::[a-z_\\[\\]"]+)?`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
      if (m[1]) continue;                                   // gecastet
      if (anVerkettung(code, m.index, m[0].length)) {
        treffer.push(`${spalte} (${KATALOG_NICHT_TEXT[spalte]})`);
      }
    }
  }
  return [...new Set(treffer)].sort();
}

describe("keine ungecastete Katalogspalte an einer Verkettung (42725)", () => {
  for (const { file, sql } of dateien) {
    it(file, () => {
      expect(typGefahren(nurSql(sql)),
             `${file}: Katalogspalte ohne ::text an einer Verkettung`).toEqual([]);
    });
  }

  it("POSITIVKONTROLLE: der echte Fehler vom 2026-10-18 faellt auf", () => {
    const kaputt =
      "select string_agg(t.tgname || ' (' || t.tgenabled || ')', ', ') from pg_trigger t";
    expect(typGefahren(nurSql(kaputt))).toEqual(['tgenabled ("char")', "tgname (name)"]);
  });

  it("GEGENKONTROLLE: gecastet ist still, und ein Argument ist keine Verkettung", () => {
    const heil =
      "select string_agg(t.tgname::text || ' (' || t.tgenabled::text || ')', ', ')"
      + " from pg_trigger t";
    expect(typGefahren(nurSql(heil))).toEqual([]);
    const argument = "select count(*) from pg_proc p, aclexplode(p.proacl) a"
      + " where a.privilege_type = 'EXECUTE' and p.proname::text || '' <> ''";
    expect(typGefahren(nurSql(argument))).toEqual([]);
  });
});

/*
 * ==========================================================================
 * Der Wächter im Stub-Schema-Generator
 * ==========================================================================
 *
 * `tools/lib/stub-schema.py` faltet Spalten aus `create table` und
 * `add column`. Was es NICHT kann, ist eine spätere Typänderung oder eine
 * Umbenennung — und das ist die gefährliche Sorte Lücke: das Stub-Schema
 * trüge den alten Typ, die Planprüfung plante gegen ein Schema, das es nicht
 * gibt, und sie meldete **grün**. Ein stilles falsches Schema ist schlimmer
 * als keines.
 *
 * Deshalb bricht der Generator bei beiden Anweisungen ab. Diese Gruppe prüft
 * das an echten Läufen gegen Wegwerf-Migrationen — nicht am Quelltext.
 */
describe("der Stub-Schema-Generator bricht bei nicht unterstützten Anweisungen ab", () => {
  const generator = "tools/lib/stub-schema.py";

  /** Legt ein Wegwerf-Migrationsverzeichnis an und lässt den Generator laufen. */
  function lauf(migrationen: Record<string, string>): { code: number; stderr: string } {
    const dir = mkdtempSync(join(tmpdir(), "stub-schema-"));
    for (const [name, sql] of Object.entries(migrationen)) {
      writeFileSync(join(dir, name), sql, "utf8");
    }
    const ziel = join(dir, "schema.sql");
    try {
      execFileSync("python3", [generator, ziel, dir], { stdio: "pipe" });
      return { code: 0, stderr: "" };
    } catch (e) {
      const err = e as { status?: number; stderr?: Buffer };
      return { code: err.status ?? -1, stderr: err.stderr?.toString() ?? "" };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const BASIS = "create table public.probe (a bigint, b text);\n";

  it("eine Typänderung führt zum Abbruch, nicht zu einem falschen Schema", () => {
    const r = lauf({
      "0001_basis.sql": BASIS,
      "0002_typ.sql": "alter table public.probe alter column a type text;\n",
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("ABBRUCH");
    expect(r.stderr).toContain("alter column a type");
    expect(r.stderr).toContain("0002_typ.sql");
  });

  it("auch die Schreibweise `set data type` fällt auf", () => {
    const r = lauf({
      "0001_basis.sql": BASIS,
      "0002_typ.sql": "alter table public.probe alter column b set data type numeric(10,2);\n",
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("alter column b type");
  });

  it("eine Spaltenumbenennung ebenfalls", () => {
    const r = lauf({
      "0001_basis.sql": BASIS,
      "0002_name.sql": "alter table public.probe rename column b to c;\n",
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("rename column b to c");
  });

  it("und der Abbruch sagt, was zu tun ist — erweitern oder ausnehmen", () => {
    const r = lauf({
      "0001_basis.sql": BASIS,
      "0002_typ.sql": "alter table public.probe alter column a type text;\n",
    });
    expect(r.stderr).toContain("Generator erweitern");
    expect(r.stderr).toContain("nicht stillschweigend weiter");
  });

  it("eine hinzugefügte Spalte ist unterstützt und läuft durch", () => {
    const r = lauf({
      "0001_basis.sql": BASIS,
      "0002_spalte.sql": "alter table public.probe add column if not exists d numeric(10,2);\n",
    });
    expect(r.code).toBe(0);
  });

  /*
   * DIE 60 SEKUNDEN SIND KEIN SCHÖNHEITSWUNSCH. Dieser Test startet `python3`
   * und lässt es ALLE Migrationen übersetzen; allein kommt er in gut einer
   * Sekunde durch, in der vollen Suite nicht. Mit dem Standardbudget von
   * fünf Sekunden ist er seit dem 2026-10-29 mehrfach gekippt — nicht, weil
   * seine Zusicherung wackelt, sondern weil parallele Testdateien die CPU
   * belegen. Ein Test, der unter Last rot wird und allein grün, sagt nichts
   * über die Sache und viel über sein Zeitbudget.
   */
  it("und die echten Migrationen enthalten keine solche Anweisung", () => {
    /*
     * Das ist die Zusicherung, auf der das Stub-Schema ruht. Fällt sie eines
     * Tages, bricht der Generator ab — und dieser Test sagt vorher, warum.
     */
    const dir = mkdtempSync(join(tmpdir(), "stub-schema-echt-"));
    const ziel = join(dir, "schema.sql");
    let code = 0;
    try { execFileSync("python3", [generator, ziel], { stdio: "pipe" }); }
    catch (e) { code = (e as { status?: number }).status ?? -1; }
    finally { rmSync(dir, { recursive: true, force: true }); }
    expect(code, "supabase/migrations/ enthält eine nicht unterstützte Anweisung").toBe(0);
  }, 60_000);
});
