/**
 * Echte PostgreSQL-Validierung der Prüfdateien — vor der Ausführung.
 *
 *   npm run verify:check-sql
 *
 * WARUM ES DIESES WERKZEUG GIBT
 *
 * Am 2026-10-19 sind vier Prüfdateien im Production-SQL-Editor abgebrochen,
 * nachdem ich sie als „geprüft" gemeldet hatte. Zwei Fehlerklassen, beide
 * unsichtbar für alles, was das Projekt bis dahin konnte:
 *
 *   42725  `tgname || ' (' || tgenabled || ')'` — `tgenabled` ist `"char"`,
 *          und `text || "char"` ist mehrdeutig.
 *   42P01  ein Alias, der in der FROM-Klausel `ofrfr` heißt und in der
 *          WHERE-Klausel `ofr` — Folge einer Textersetzung, die ihr eigenes
 *          Ergebnis noch einmal getroffen hat.
 *
 * Ein Parser findet davon NICHTS: beide Dateien sind syntaktisch einwandfrei.
 * Was fehlt, ist die Namensauflösung und die Typprüfung — und die hat nur
 * PostgreSQL selbst.
 *
 * WIE
 *
 * `@electric-sql/pglite` ist PostgreSQL als WebAssembly: kein Server, keine
 * Installation, kein Netz. Dazu ein STUB-SCHEMA aus den Migrationen — jede
 * Tabelle mit ihren echten Spalten und Typen, jede Funktion mit ihrer echten
 * Signatur, die Views im Original, aber ohne Constraints, ohne Trigger und
 * ohne eine einzige Datenzeile. Dann `explain <anweisung>`: PostgreSQL
 * parst, löst jeden Namen auf und prüft jeden Typ — und führt nichts aus.
 *
 * WAS ES NICHT BEWEIST, und das ist wichtig
 *
 *   * Keine Laufzeitfehler. Ein `round(text)` auf echten Daten, ein Cast, der
 *     an einem Wert scheitert, eine Division durch Null — davon sieht ein
 *     Plan nichts.
 *   * Keine Fachlichkeit. Dass eine Prüfung das Richtige MISST, sagt kein
 *     Planer.
 *   * Nur die Typen, die die Migrationen deklarieren. Ändert eine Migration
 *     später einen Spaltentyp (`alter column … type`), wäre das Stub-Schema
 *     veraltet — heute kommt das in der Historie nicht vor, geprüft.
 *   * **Eine andere PostgreSQL-Version als Production.** PGlite ist hier 18.6,
 *     der Syntaxprüfer (pglast 5.2) benutzt die Grammatik von 15, und welche
 *     Version Supabase fährt, hält dieses Repository nirgends fest. Für die
 *     bewusst konservative SQL dieser Prüfdateien ist das unerheblich; ein
 *     Konstrukt, das erst nach 15 dazugekommen ist, käme hier aber durch und
 *     auf Production nicht. Wer es genau wissen will, liest `select version()`
 *     im SQL-Editor.
 *
 * OPTIONALE ABHÄNGIGKEIT. Ohne PGlite endet das Werkzeug mit einem Hinweis
 * und Exitcode 0 — es ist eine Zusatzprüfung, kein Tor.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const CHECK_DIR = "supabase/checks";
const STUB = ".pglite-stub-schema.sql";

/**
 * Zwei Dateien lassen sich NICHT planen, und zwar aus gutem Grund. Die Liste
 * ist eng, begründet und selbstkorrigierend: plant eine Datei von hier
 * plötzlich doch, bricht der Lauf ab und verlangt, dass die Zeile verschwindet.
 * Eine Ausnahmeliste, die niemand pflegt, ist eine Ausnahmeliste, die alles
 * durchlässt.
 */
const NICHT_PLANBAR: Record<string, string> = {
  "0124_fingerprint_failure_isolated.sql":
    "schreibt absichtlich (Temporaertabelle, Funktion, eine Zeile) und rollt zurueck — Fehlerfalltest, nur Staging",
  "0124_baseline.sql":
    "liest einen Sitzungsparameter, den sie sich selbst transaktionslokal mit set_config(…, true) setzt; ein Plan setzt nichts",
};

/** Anweisungen an den Grenzen trennen, die Zeichenketten und $$-Blöcke kennt. */
function anweisungen(sql: string): string[] {
  const out: string[] = [];
  let i = 0, start = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "-" && sql[i + 1] === "-") { i = sql.indexOf("\n", i); if (i < 0) break; continue; }
    if (c === "/" && sql[i + 1] === "*") { const e = sql.indexOf("*/", i); i = e < 0 ? sql.length : e + 2; continue; }
    if (c === "'") { i++; while (i < sql.length && !(sql[i] === "'" && sql[i + 1] !== "'")) i += sql[i] === "'" ? 2 : 1; i++; continue; }
    if (c === "$") {
      const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (m) { const e = sql.indexOf(m[0], i + m[0].length); i = e < 0 ? sql.length : e + m[0].length; continue; }
    }
    if (c === ";") { out.push(sql.slice(start, i).trim()); start = i + 1; }
    i++;
  }
  const rest = sql.slice(start).trim();
  if (rest) out.push(rest);
  return out.filter((s) => s.length > 0);
}

/** Nur das lässt sich planen, ohne etwas zu tun. */
const planbar = (s: string): boolean => /^(with|select|table|values)\b/i.test(s.replace(/^[\s]*(--[^\n]*\n|\/\*[\s\S]*?\*\/)*/, "").trim());
/** Und das schreibt — eine solche Datei gehört nie in den Production-Editor. */
const schreibt = (s: string): boolean =>
  /^(insert|update|delete|truncate|alter|drop|create|grant|revoke|comment|do|call|copy|security)\b/i
    .test(s.replace(/^[\s]*(--[^\n]*\n|\/\*[\s\S]*?\*\/)*/, "").trim());

async function main(): Promise<void> {
  /*
   * KEINE OPTIONALE ABHÄNGIGKEIT MEHR, und kein stilles Überspringen.
   *
   * Bis zum 2026-10-19 endete dieses Werkzeug bei fehlendem PGlite mit einer
   * Notiz und Exitcode 0. Das ist genau die Sorte Prüfung, die man für
   * gelaufen hält, weil sie nichts gesagt hat. Seit der Freigabe der
   * devDependency ist sie verbindlich: fehlt das Paket, schlägt der Lauf fehl.
   */
  let PGlite: new () => { exec(s: string): Promise<unknown>; query(s: string): Promise<unknown> };
  try {
    ({ PGlite } = (await import("@electric-sql/pglite")) as never);
  } catch (e) {
    console.error("\n  @electric-sql/pglite fehlt — die Planprüfung kann nicht laufen.");
    console.error("  Das ist ein Fehler, kein Hinweis: ohne sie ist eine Prüfdatei");
    console.error("  nur syntaktisch geprüft, und genau daran sind am 2026-10-19");
    console.error("  vier Dateien im Production-Editor gescheitert.");
    console.error("\n  Beheben:  npm ci   (oder  npm i -D @electric-sql/pglite )\n");
    console.error(`  Ursache: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  console.log("\nSTUB-SCHEMA aus den Migrationen erzeugen");
  execFileSync("python3", ["tools/lib/stub-schema.py", STUB], { stdio: "inherit" });

  /*
   * ES DARF KEINE DATENANWEISUNG ENTHALTEN. Das Stub-Schema entsteht
   * ausschließlich aus `supabase/migrations/` — Tabellen mit ihren Spalten
   * und Typen, Funktionen mit ihren Signaturen, die Views im Original. Keine
   * Zeile aus einer echten Datenbank, kein Export, kein Backup. Geprüft wird
   * das hier, damit es nicht irgendwann unbemerkt anders ist.
   */
  const schema = readFileSync(STUB, "utf8");
  const verboten = anweisungen(schema)
    .filter((a) => /^(insert|update|delete|copy|truncate)\b/i.test(a.trim()));
  if (verboten.length > 0) {
    console.error(`\n  ABBRUCH: das Stub-Schema enthält ${verboten.length} Datenanweisung(en).`);
    console.error("  Es darf ausschließlich Struktur beschreiben.");
    process.exit(1);
  }
  console.log("  keine Datenanweisung im Stub-Schema — reine Struktur");

  const db = new PGlite();
  let angewendet = 0, abgelehnt = 0;
  for (const s of anweisungen(readFileSync(STUB, "utf8"))) {
    try { await db.exec(s + ";"); angewendet++; } catch { abgelehnt++; }
  }
  console.log(`  ${angewendet} Anweisungen angewendet, ${abgelehnt} abgelehnt`);
  console.log("  (abgelehnte sind unerheblich, solange keine Prüfdatei den Namen braucht —");
  console.log("   sonst scheitert ihr Plan unten mit 42P01 oder 42883)");

  console.log("\nPLANPRÜFUNG — PostgreSQL löst jeden Namen auf und prüft jeden Typ");
  console.log("-".repeat(76));
  const dateien = readdirSync(join(process.cwd(), CHECK_DIR)).filter((f) => f.endsWith(".sql")).sort();
  let ok = 0, ausnahmen = 0;
  const fehler: string[] = []; const mitSchreiben: string[] = []; const ueberholt: string[] = [];
  for (const f of dateien) {
    const sql = readFileSync(join(process.cwd(), CHECK_DIR, f), "utf8");
    const teile = anweisungen(sql);
    const zuPlanen = teile.filter(planbar);
    const schreibend = teile.filter(schreibt);
    if (schreibend.length > 0) mitSchreiben.push(f);
    let dateiFehler: string | null = null;
    /*
     * In DATEIREIHENFOLGE durchgehen: `begin`/`commit` und `set` werden
     * AUSGEFÜHRT, alles Lesende wird GEPLANT. Beides ist nötig, weil die
     * `0124`-Baselines ihren Parameter mit `set_config(…, true)` TRANSAKTIONS-
     * lokal setzen — ohne die Klammer gilt er nur für die eine Anweisung, und
     * die nächste fällt mit `42704` durch, obwohl sie in einer echten Sitzung
     * läuft. Eine Transaktion in einer Wegwerf-Instanz ohne Daten kostet
     * nichts.
     */
    for (const t of teile) {
      const kopf = t.trim();
      // Ausführen statt planen: Klammer, Einstellung, und das SELECT, dessen
      // einziger Zweck eine Einstellung ist.
      if (/^(begin|commit|rollback|savepoint|release|set)\b/i.test(kopf)
          || /^select\s+set_config\s*\(/i.test(kopf)) {
        try { await db.exec(t + ";"); } catch { /* unerheblich */ }
        continue;
      }
      if (!planbar(t)) continue;
      try { await db.query(`explain ${t}`); }
      catch (e) {
        const err = e as { message?: string; code?: string };
        dateiFehler = `[${err.code ?? "?"}] ${(err.message ?? "").split("\n")[0]}`;
        break;
      }
    }
    const marke = schreibend.length > 0 ? " (SCHREIBT — nur Staging)" : "";
    const ausnahme = NICHT_PLANBAR[f];
    if (dateiFehler && ausnahme) {
      console.log(`  AUSNAHME ${f}  ${dateiFehler}`);
      console.log(`           Grund: ${ausnahme}`);
      ausnahmen++;
    } else if (dateiFehler) {
      console.log(`  FEHLER  ${f}  ${dateiFehler}`);
      fehler.push(f);
    } else if (ausnahme) {
      console.log(`  UEBERHOLT ${f} plant inzwischen — die Ausnahme in NICHT_PLANBAR entfernen.`);
      ueberholt.push(f);
      ok++;
    } else {
      console.log(`  OK      ${f}  ${zuPlanen.length} von ${teile.length} Anweisungen geplant${marke}`);
      ok++;
    }
  }
  console.log("-".repeat(76));
  console.log(`  ${ok} Dateien ohne Planfehler, ${fehler.length} mit Fehler, `
    + `${ausnahmen} begruendete Ausnahme(n)`);
  if (mitSchreiben.length > 0) {
    console.log(`\n  SCHREIBENDE PRÜFDATEIEN (niemals auf Production): ${mitSchreiben.join(", ")}`);
  }

  console.log("\nWAS DIESER LAUF BEWEIST — UND WAS NICHT");
  console.log("  bewiesen:     jede geplante Anweisung ist syntaktisch gültig, jeder Name");
  console.log("                löst auf, jeder Typ passt, jede Signatur existiert.");
  console.log("  NICHT bewiesen: dass eine Datei auf Production LÄUFT. Laufzeitfehler an");
  console.log("                echten Daten sieht ein Plan nicht, und ob eine Prüfung");
  console.log("                fachlich das Richtige misst, sagt kein Planer.");
  console.log("  Eine erfolgreiche Planprüfung ist KEIN erfolgreicher Lauf gegen");
  console.log("  Production. Nachweis bleibt allein das Ergebnisblatt aus dem");
  console.log("  SQL-Editor (supabase/checks/open_verifications.md).\n");

  if (ueberholt.length > 0) {
    console.error(`  ABBRUCH: ${ueberholt.length} Ausnahme(n) sind ueberholt — Liste kuerzen.`);
    process.exitCode = 1;
  }
  if (fehler.length > 0) process.exitCode = 1;
}

main().catch((e: unknown) => {
  console.error(`\nValidierung fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
