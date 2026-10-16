/**
 * Decides, entry by entry, what may be restored into an ALREADY INITIALISED
 * Supabase project — and writes a `pg_restore --use-list` file.
 *
 * WHY THIS EXISTS, AND WHY IT IS THE MOST DANGEROUS PIECE
 *
 * A fresh Supabase project is not an empty database. It already carries
 * `auth`, `storage`, `extensions`, `realtime`, `vault`, `cron`, their tables,
 * their functions, their policies — and two version ledgers that the platform
 * itself reads: `auth.schema_migrations` and `storage.migrations`. Restoring
 * those from another project's dump replaces the target's idea of which
 * GoTrue and which Storage version it runs. That does not throw an error. It
 * breaks the service quietly, later.
 *
 * So the dump is NOT restored wholesale. `pg_restore --list` gives a table of
 * contents, this script comments out every line that must not be applied, and
 * `pg_restore --use-list` then applies exactly the remainder. The resulting
 * file is reviewable, diffable and belongs in the protocol.
 *
 * WHAT IT KEEPS
 *   * everything in `public` — that is our own schema
 *   * `auth`: ONLY the rows of `users` and `identities`
 *   * `storage`: ONLY the rows of `buckets` and `objects`, plus our four
 *     `catalog_images_*` policies from migration 0007
 *
 * WHAT IT DROPS, ALWAYS
 *   * every `CREATE SCHEMA` (all three exist in the target)
 *   * every structural object of `auth` and `storage` — tables, functions,
 *     triggers, constraints, indexes, ACLs, and above all the two version
 *     ledgers
 *   * extensions and anything owned by the platform
 *
 * It reads a file and writes two. No database, no network.
 */
import { readFileSync, writeFileSync } from "node:fs";

/** The multi-word descriptions first, so the longest match wins. */
const DESCS = [
  "MATERIALIZED VIEW DATA", "MATERIALIZED VIEW", "TEXT SEARCH CONFIGURATION",
  "TEXT SEARCH DICTIONARY", "PUBLICATION TABLE", "FK CONSTRAINT", "TABLE DATA",
  "SEQUENCE SET", "DEFAULT ACL", "ROW SECURITY", "INDEX ATTACH", "TABLE ATTACH",
  "EVENT TRIGGER", "FOREIGN TABLE", "LARGE OBJECT", "SHELL TYPE",
  "TABLE", "VIEW", "SEQUENCE", "INDEX", "CONSTRAINT", "TRIGGER", "FUNCTION",
  "PROCEDURE", "AGGREGATE", "OPERATOR", "TYPE", "DOMAIN", "SCHEMA", "EXTENSION",
  "COMMENT", "ACL", "POLICY", "RULE", "CAST", "SERVER", "PUBLICATION",
  "SUBSCRIPTION", "DATABASE", "COLLATION", "CONVERSION", "STATISTICS", "BLOBS",
] as const;

export type Entry = { id: string; desc: string; schema: string; name: string };

/** `4711; 1259 16432 TABLE public purchases postgres` → parsed, or null. */
export function parseLine(line: string): Entry | null {
  const m = /^(\d+);\s+\d+\s+\d+\s+(.*)$/.exec(line);
  if (m === null) return null;
  const rest = m[2];
  const desc = DESCS.find((d) => rest === d || rest.startsWith(d + " "));
  if (desc === undefined) return null;
  const nach = rest.slice(desc.length).trim();
  const teile = nach.split(/\s+/);
  const schema = teile.length > 0 ? teile[0] : "-";
  /* Der letzte Token ist der Eigentuemer; dazwischen steht der Name, der
     Leerzeichen enthalten darf (Funktionssignaturen). */
  const name = teile.slice(1, Math.max(1, teile.length - 1)).join(" ");
  return { id: m[1], desc, schema, name };
}

const AUTH_DATEN = new Set(["users", "identities"]);
const STORAGE_DATEN = new Set(["buckets", "objects"]);

export type Urteil = { keep: boolean; grund: string };

export function decide(e: Entry): Urteil {
  if (e.desc === "SCHEMA") {
    return { keep: false, grund: "Schema existiert im Ziel bereits" };
  }
  if (e.desc === "EXTENSION" || e.desc === "DATABASE" || e.desc === "BLOBS"
      || e.desc === "EVENT TRIGGER" || e.desc === "PUBLICATION"
      || e.desc === "SUBSCRIPTION" || e.desc === "PUBLICATION TABLE") {
    return { keep: false, grund: "von der Plattform verwaltet" };
  }
  if (e.schema === "public") {
    return { keep: true, grund: "eigenes Schema" };
  }
  if (e.schema === "storage") {
    if (e.desc === "TABLE DATA" && STORAGE_DATEN.has(e.name)) {
      return { keep: true, grund: "eigene Fracht in storage" };
    }
    if (e.desc === "POLICY" && e.name.includes("catalog_images_")) {
      return { keep: true, grund: "eigene Policy aus 0007" };
    }
    return { keep: false, grund: "Supabase-Systemobjekt in storage" };
  }
  if (e.schema === "auth") {
    if (e.desc === "TABLE DATA" && AUTH_DATEN.has(e.name)) {
      return { keep: true, grund: "Konten und Identitaeten" };
    }
    return { keep: false, grund: "Supabase-Systemobjekt in auth" };
  }
  return { keep: false, grund: `fremdes Schema ${e.schema}` };
}

export type Ergebnis = {
  zeilen: string[];
  behalten: Entry[];
  verworfen: { e: Entry; grund: string }[];
  /** Zeilen, deren Form der Filter nicht kennt. NIE stillschweigend. */
  ungeparst: string[];
  verstoesse: string[];
};

export function filterToc(toc: string): Ergebnis {
  const zeilen: string[] = [];
  const behalten: Entry[] = [];
  const verworfen: { e: Entry; grund: string }[] = [];
  const ungeparst: string[] = [];

  for (const line of toc.split("\n")) {
    if (line.trim() === "" || line.startsWith(";")) { zeilen.push(line); continue; }
    const e = parseLine(line);
    if (e === null) {
      /*
       * Unbekannte Form NIEMALS stillschweigend uebergehen. Sie wird
       * ausgeschlossen UND gezaehlt UND fuehrt unten zum Abbruch: eine Zeile,
       * die der Filter nicht liest, ist ein Objekttyp, ueber den niemand
       * entschieden hat. Ausschliessen allein waere auch eine Entscheidung —
       * nur eine unbemerkte.
       */
      zeilen.push(`; UNGEPARST — ausgeschlossen: ${line}`);
      ungeparst.push(line);
      continue;
    }
    const u = decide(e);
    if (u.keep) { zeilen.push(line); behalten.push(e); }
    else { zeilen.push(`; ${u.grund}: ${line}`); verworfen.push({ e, grund: u.grund }); }
  }

  /* Die Zusicherungen. Ein Filter, der zu viel wegwirft, ist so gefaehrlich
     wie einer, der zu wenig wegwirft. */
  const verstoesse: string[] = [];
  const zahl = (p: (e: Entry) => boolean) => behalten.filter(p).length;

  if (zahl((e) => e.schema === "public" && e.desc === "TABLE DATA") === 0) {
    verstoesse.push("keine einzige Datenzeile aus public behalten");
  }
  if (zahl((e) => e.schema === "public" && e.desc === "SEQUENCE SET") === 0) {
    verstoesse.push("keine Sequenzstaende behalten — die erste Neuanlage vergaebe eine belegte Nummer");
  }
  if (zahl((e) => e.schema === "public" && e.desc === "TABLE") === 0) {
    verstoesse.push("keine Tabellenstruktur aus public behalten");
  }
  for (const verboten of ["schema_migrations", "migrations"]) {
    if (zahl((e) => e.name === verboten && e.schema !== "public") > 0) {
      verstoesse.push(`das Versionsregister ${verboten} wuerde ueberschrieben`);
    }
  }
  if (zahl((e) => e.desc === "SCHEMA") > 0) {
    verstoesse.push("ein CREATE SCHEMA wuerde ausgefuehrt");
  }
  const systemArten = new Set(["TABLE", "FUNCTION", "TRIGGER", "CONSTRAINT",
                               "FK CONSTRAINT", "INDEX", "ACL", "DEFAULT ACL",
                               "SEQUENCE", "VIEW", "TYPE"]);
  if (zahl((e) => (e.schema === "auth" || e.schema === "storage")
                  && systemArten.has(e.desc)) > 0) {
    verstoesse.push("ein Strukturobjekt aus auth oder storage wuerde angelegt oder geaendert");
  }
  /* Nichts aus einem vierten Schema. `cron`, `realtime`, `vault`,
     `extensions`, `supabase_functions` gehoeren der Plattform. */
  const fremd = behalten.filter((e) => !["public", "auth", "storage"].includes(e.schema));
  if (fremd.length > 0) {
    verstoesse.push(`${fremd.length} Eintrag/Eintraege aus fremden Schemata behalten: `
      + [...new Set(fremd.map((e) => e.schema))].join(", "));
  }
  /* Eine Zeile, die der Filter nicht lesen kann, ist ein Abbruchgrund — kein
     Grund zum Weitermachen. */
  if (ungeparst.length > 0) {
    verstoesse.push(`${ungeparst.length} Zeile(n) im Inhaltsverzeichnis haben eine `
      + "unbekannte Form — erst klaeren, welcher Objekttyp das ist");
  }
  return { zeilen, behalten, verworfen, ungeparst, verstoesse };
}

export function bericht(r: Ergebnis): string {
  const gruppe = new Map<string, number>();
  for (const e of r.behalten) {
    const k = `${e.schema} / ${e.desc}`;
    gruppe.set(k, (gruppe.get(k) ?? 0) + 1);
  }
  const zeilen = ["BEHALTEN", "========"];
  for (const [k, n] of [...gruppe].sort()) zeilen.push(`  ${String(n).padStart(5)}  ${k}`);
  zeilen.push("", `  Summe behalten: ${r.behalten.length}`, "",
              "VERWORFEN (nach Grund)", "======================");
  const gr = new Map<string, number>();
  for (const v of r.verworfen) gr.set(v.grund, (gr.get(v.grund) ?? 0) + 1);
  for (const [k, n] of [...gr].sort()) zeilen.push(`  ${String(n).padStart(5)}  ${k}`);
  zeilen.push("", `  Summe verworfen: ${r.verworfen.length}`, "",
              "VERWORFEN AUS auth UND storage (vollstaendig, zum Nachlesen)",
              "===========================================================");
  for (const v of r.verworfen.filter((x) => x.e.schema === "auth" || x.e.schema === "storage")) {
    zeilen.push(`  ${v.e.schema} ${v.e.desc} ${v.e.name}`);
  }
  zeilen.push("", "UNGEPARSTE ZEILEN (Abbruchgrund, nicht nur Hinweis)",
              "==================================================");
  if (r.ungeparst.length === 0) zeilen.push("  keine");
  else for (const z of r.ungeparst) zeilen.push(`  ${z}`);
  return zeilen.join("\n") + "\n";
}

function main(): void {
  const [toc, keep, rep] = process.argv.slice(2);
  if (!toc || !keep || !rep) {
    console.error("Aufruf: node tools/dr/30-filter-toc.mts <full.toc> <toc.keep> <toc.report.txt>");
    process.exit(2);
  }
  const r = filterToc(readFileSync(toc, "utf8"));
  writeFileSync(keep, r.zeilen.join("\n"), "utf8");
  writeFileSync(rep, bericht(r), "utf8");
  console.log(bericht(r));
  if (r.verstoesse.length > 0) {
    console.error("\n  ABBRUCH — der gefilterte Plan ist nicht zulaessig:");
    for (const v of r.verstoesse) console.error(`    * ${v}`);
    process.exit(1);
  }
  console.log(`  ${keep} geschrieben. Jetzt von Hand LESEN, dann 40-restore.sh.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
