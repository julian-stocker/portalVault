/**
 * Lexikalische Prüfung jeder Migration und jeder Prüfdatei.
 *
 * WARUM ES DIESE DATEI GIBT
 *
 * `0124` ist zweimal auf Staging gescheitert, und beide Male hat kein Test
 * es vorher gesehen. Der zweite Abbruch war dieser:
 *
 *   ERROR 42601: unterminated dollar-quoted string
 *   LINE 659: v_code := regexp_replace(v_def, $re$/\*.*?\*\/$re$, '', 'g');
 *
 * Die Ursache war kein Dollar-Quote-Problem, sondern zwei Tatsachen, die
 * zusammenwirken:
 *
 *   1. POSTGRESQL-BLOCKKOMMENTARE NESTEN. Ein Kommentar-Anfang im TEXT eines
 *      Kommentars öffnet einen zweiten, der sein eigenes Ende braucht.
 *   2. Der äußere Lexer sieht `do $$ … $$` als ein Literal. Die Kommentare
 *      darin liest erst PL/pgSQL.
 *
 * Ein Kommentar in der Nachbedingung erklärte, dass ein Stringliteral keinen
 * Kommentar-Anfang enthalten darf — und schrieb das Zeichenpaar dabei aus.
 * Das öffnete einen inneren Kommentar; das nächste Kommentar-Ende schloss nur
 * ihn, der äußere lief weiter, verschlang die Wache und endete erst mitten in
 * einer Regex. Was danach kam, war ein `$re$` ohne Partner.
 *
 * WARUM EIN ECHTER SQL-PARSER DAS NICHT GEFUNDEN HÄTTE: `pglast` 5.2
 * (libpg_query 15.1) akzeptiert die kaputte Datei mit `parse_sql` — neun
 * Anweisungen, keine Beanstandung. Für die SQL-Grammatik ist der Rumpf eines
 * `do`-Blocks eine Zeichenkette. Erst `parse_plpgsql_json` meldet den Fehler,
 * und zwar wortgleich mit Staging. Der Parser ist also nötig und NICHT
 * hinreichend; nötig ist zusätzlich, in die Rümpfe abzusteigen.
 *
 * Genau das tut der Lexer hier — ohne Abhängigkeit, damit er in jedem Lauf
 * mitläuft und nicht nur von Hand.
 */
import { describe, expect, it } from "vitest";

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { migrationFiles, migrationSource } from "@/test-support/migrations";

type Befund = { art: string; zeile: number; ebene: number };

/**
 * Verschachtelungsbewusster Scan, der in Funktionsrümpfe absteigt.
 *
 * Ein Dollar-Quote gilt als RUMPF — und wird als SQL weitergelesen —, wenn
 * das letzte Wort davor `as` oder `do` ist. Alles andere bleibt opak: ein
 * Regex in `$re$…$re$` ist Daten und darf Kommentarzeichen enthalten.
 */
function scan(sql: string, basis = 1, ebene = 0, out: Befund[] = []): Befund[] {
  let i = 0;
  let zeile = basis;
  let tiefe = 0;
  const offen: number[] = [];
  let letztesWort = "";
  const n = sql.length;
  const zeilenIn = (von: number, bis: number) =>
    sql.slice(von, bis).split("\n").length - 1;

  while (i < n) {
    if (sql[i] === "\n") { zeile += 1; i += 1; continue; }

    if (tiefe > 0) {
      if (sql.startsWith("/*", i)) {
        tiefe += 1; offen.push(zeile);
        out.push({ art: "verschachtelter Kommentar geöffnet", zeile, ebene });
        i += 2; continue;
      }
      if (sql.startsWith("*/", i)) { tiefe -= 1; offen.pop(); i += 2; continue; }
      i += 1; continue;
    }
    if (sql.startsWith("/*", i)) { tiefe = 1; offen.push(zeile); i += 2; continue; }
    if (sql.startsWith("--", i)) { while (i < n && sql[i] !== "\n") i += 1; continue; }

    if (sql[i] === "'") {
      i += 1;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
        if (sql[i] === "'") { i += 1; break; }
        if (sql[i] === "\n") zeile += 1;
        i += 1;
      }
      letztesWort = "''"; continue;
    }

    if (sql[i] === "$") {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(sql[j])) j += 1;
      if (j < n && sql[j] === "$") {
        const tag = sql.slice(i, j + 1);
        const start = j + 1;
        const ende = sql.indexOf(tag, start);
        if (ende === -1) {
          out.push({ art: `nicht geschlossenes Dollar-Quote ${tag}`, zeile, ebene });
          break;
        }
        if (letztesWort === "as" || letztesWort === "do") {
          scan(sql.slice(start, ende), zeile + zeilenIn(i, start), ebene + 1, out);
        }
        zeile += zeilenIn(i, ende);
        i = ende + tag.length;
        letztesWort = tag;
        continue;
      }
    }

    if (/[A-Za-z_]/.test(sql[i])) {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(sql[j])) j += 1;
      letztesWort = sql.slice(i, j).toLowerCase();
      i = j; continue;
    }
    i += 1;
  }
  if (tiefe !== 0) {
    out.push({ art: `Kommentar nicht geschlossen (Tiefe ${tiefe})`,
               zeile: offen[0] ?? zeile, ebene });
  }
  return out;
}

/* ==========================================================================
 * Der Lexer muss zuerst beweisen, dass er etwas kann
 * ======================================================================== */

describe("der Lexer erkennt die Fälle, um die es geht", () => {
  /*
   * OHNE DIESE VIER WÄRE DER BLOCK DARUNTER WERTLOS. Ein Prüfwerkzeug, das
   * nie etwas findet, ist von einem, das nichts finden kann, nicht zu
   * unterscheiden — genau das war der Zustand vor diesem Abbruch.
   */
  const KOMMENTAR_AUF = "/" + "*";
  const KOMMENTAR_ZU = "*" + "/";

  it("ein Kommentar-Anfang im Text eines Kommentars", () => {
    const sql = `do $$ begin ${KOMMENTAR_AUF} erklaert ${KOMMENTAR_AUF} hier ${KOMMENTAR_ZU} end $$;`;
    expect(scan(sql).map((b) => b.art))
      .toContain("verschachtelter Kommentar geöffnet");
  });

  it("und genau die Verkettung, die 0124 zerlegt hat", () => {
    /* Innerer Kommentar, dann ein Dollar-Quote, dessen Partner verschluckt wird. */
    const sql = [
      "do $$",
      "begin",
      `  ${KOMMENTAR_AUF} ein Literal mit ${KOMMENTAR_AUF} darin`,
      `   ${KOMMENTAR_ZU}`,
      "  x := regexp_replace(y, $re$/\\*.*?\\*/$re$, '', 'g');",
      "end",
      "$$;",
    ].join("\n");
    const arten = scan(sql).map((b) => b.art);
    expect(arten).toContain("verschachtelter Kommentar geöffnet");
    expect(arten.some((a) => a.startsWith("nicht geschlossenes Dollar-Quote"))).toBe(true);
  });

  it("ein nicht geschlossener Kommentar", () => {
    expect(scan(`select 1; ${KOMMENTAR_AUF} ohne Ende`).map((b) => b.art))
      .toContain("Kommentar nicht geschlossen (Tiefe 1)");
  });

  it("und er hält ein Dollar-Quote mit Kommentarzeichen als DATEN aus", () => {
    /*
     * Das ist die Gegenprobe: `$re$…$re$` ist kein Rumpf, sondern ein Regex.
     * Ein Lexer, der auch dort absteigt, würde falschen Alarm schlagen.
     */
    expect(scan(`select regexp_replace(x, $re$/\\*.*?\\*/$re$, '', 'g');`)).toEqual([]);
  });

  it("und ein Kommentarzeichen in einem Stringliteral", () => {
    expect(scan(`select '${KOMMENTAR_AUF} kein Kommentar' as t;`)).toEqual([]);
  });
});

/* ==========================================================================
 * Und jetzt über alles, was ausgeführt wird
 * ======================================================================== */

const CHECKS = "supabase/checks";
const checkFiles = readdirSync(join(process.cwd(), CHECKS))
  .filter((f) => f.endsWith(".sql")).sort();

describe("jede Migration ist lexikalisch heil", () => {
  for (const file of migrationFiles) {
    it(file, () => {
      expect(scan(migrationSource(file))).toEqual([]);
    });
  }
});

describe("und jede Prüfdatei unter supabase/checks", () => {
  it("es gibt sie überhaupt", () => {
    expect(checkFiles.length).toBeGreaterThanOrEqual(8);
  });

  for (const file of checkFiles) {
    it(file, () => {
      expect(scan(readFileSync(join(process.cwd(), CHECKS, file), "utf8"))).toEqual([]);
    });
  }
});

describe("und kein Kommentar schreibt die Kommentarzeichen aus", () => {
  /*
   * DIE REGEL, DIE AUS DEM ABBRUCH FOLGT.
   *
   * Der Lexer oben fängt den Schaden; diese Zusicherung fängt die Ursache.
   * In Code sind beide Zeichenfolgen harmlos — in einem Stringliteral und in
   * einem Dollar-Quote sind sie Daten. In Prosa haben sie nichts zu suchen,
   * und wer sie erklären muss, schreibt sie aus wie dieser Kommentar: in
   * Worten.
   */
  /*
   * LITERALBEWUSST — die dritte Instanz derselben Lektion.
   *
   * Die erste Fassung war ein Regex über die Zeile: `--` suchen, dann im Rest
   * nach den Kommentarzeichen. Das schlug an bei
   *
   *     where lit[1] like '%--%' or lit[1] like '%/*%' ...
   *
   * also an CODE: die Suchmuster, mit denen der Postflight Stringliterale auf
   * Kommentarstarter prüft. Ein `--` in einem Literal ist kein Kommentar, und
   * ein Prüfwerkzeug, das das nicht weiß, erzeugt genau die Fehlalarme, deren
   * Klasse es finden soll.
   *
   * Deshalb wird hier gelext und nicht gesucht: Literale und Dollar-Quotes
   * werden übersprungen, und geprüft wird nur der TEXT der Kommentare.
   */
  const inKommentaren = (sql: string): string[] => {
    const treffer: string[] = [];
    const AUF = "/" + "*";
    const ZU = "*" + "/";
    let i = 0;
    const n = sql.length;
    while (i < n) {
      if (sql[i] === "'") {
        i += 1;
        while (i < n) {
          if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
          if (sql[i] === "'") { i += 1; break; }
          i += 1;
        }
        continue;
      }
      if (sql[i] === "$") {
        let j = i + 1;
        while (j < n && /[A-Za-z0-9_]/.test(sql[j])) j += 1;
        if (j < n && sql[j] === "$") {
          const tag = sql.slice(i, j + 1);
          const ende = sql.indexOf(tag, j + 1);
          if (ende !== -1) { i = ende + tag.length; continue; }
        }
      }
      if (sql.startsWith(AUF, i)) {
        /* Der Text des Blockkommentars, bis zu SEINEM Ende — nicht nestend
           gelesen, denn ein genesteter Anfang ist genau der Befund. */
        const start = i + 2;
        let k = start;
        while (k < n && !sql.startsWith(ZU, k)) k += 1;
        const text = sql.slice(start, k);
        if (text.includes(AUF)) treffer.push("Kommentar-Anfang im Blockkommentar");
        i = Math.min(k + 2, n);
        continue;
      }
      if (sql.startsWith("--", i)) {
        const start = i + 2;
        while (i < n && sql[i] !== "\n") i += 1;
        const text = sql.slice(start, i);
        if (text.includes(AUF)) treffer.push("Kommentar-Anfang im Zeilenkommentar");
        continue;
      }
      i += 1;
    }
    return treffer;
  };

  for (const file of [...migrationFiles.filter((f) => Number(f.slice(0, 4)) >= 124)]) {
    it(file, () => { expect(inKommentaren(migrationSource(file))).toEqual([]); });
  }
  for (const file of checkFiles) {
    it(file, () => {
      expect(inKommentaren(readFileSync(join(process.cwd(), CHECKS, file), "utf8"))).toEqual([]);
    });
  }
});
