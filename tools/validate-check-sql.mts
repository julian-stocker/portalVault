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
 * VIER STUFEN, UND JEDE SAGT ETWAS ANDERES
 *
 *   1. STUB-SCHEMA aus den Migrationen — Tabellen, Spalten, Typen, Sequenzen,
 *      Funktionssignaturen, Views. Keine Daten, und das wird geprüft.
 *   2. PLANPRÜFUNG der Dateien in `supabase/checks` — `explain` über jede
 *      lesende Anweisung.
 *   3. DEFINITIONSLAUF: jeder Funktionsrumpf, den die Migrationshistorie in
 *      ihrer Faltung übrig lässt, wird in PostgreSQL ERZEUGT. Für
 *      `language sql` ist das eine vollständige Namens- und Typauflösung des
 *      Rumpfs — genau das, was `0136` braucht, bevor jemand sie anwendet.
 *   4. PROBELAUF der noch nicht angewendeten Migrationen gegen erfundene
 *      Zeilen, mit Gegenproben: drei der vier Durchgänge MÜSSEN scheitern.
 *
 * KEINE OPTIONALE ABHÄNGIGKEIT. Fehlt PGlite, schlägt der Lauf fehl (Exitcode
 * 1). Eine Prüfung, die bei fehlendem Werkzeug schweigend durchwinkt, ist
 * keine.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ladeAufnahme } from "./lib/privileges.mts";
import { execFileSync } from "node:child_process";

const CHECK_DIR = "supabase/checks";
const MIG_DIR = "supabase/migrations";
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
};

/*
 * `0124_baseline.sql` STAND HIER UND IST FORT.
 *
 * Grund war: „liest einen Sitzungsparameter, den sie sich selbst
 * transaktionslokal mit set_config(…, true) setzt; ein Plan setzt nichts."
 * Das war nie die Ursache. Die Datei liess sich nicht planen, weil der
 * Kopfkommentar am Statement hing (siehe `ohneKopf`) — ihre Anweisungen
 * wurden gar nicht als planbar ERKANNT, und die eine, die es war, lief in die
 * Klammer. Seit der Kopf richtig abgeschnitten wird, plant sie. Die
 * Selbstkorrektur der Liste hat das gemeldet, statt es durchzulassen.
 */

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

/**
 * Ein Statement ohne seinen Kopfkommentar — jede dieser Dateien erklärt sich.
 *
 * DIE FASSUNG VORHER HAT STILL ÜBERSPRUNGEN.
 * Sie verlangte, dass jede Kommentarzeile direkt an die nächste
 * stößt: die Zeilenalternative endete am Zeilenumbruch, und eine LEERZEILE danach passte
 * auf keine Alternative. Ein Kopf mit Leerzeile — in diesen Dateien die Regel —
 * blieb damit am Statement hängen. Folge: `planbar()` sagte `false`, die
 * Anweisung wurde nicht geplant, und die Datei meldete trotzdem „OK". Genau die
 * eine Richtung, die dieses Werkzeug nie nehmen darf. Gefunden am 2026-10-19
 * beim Bau des Definitionslaufs: `0125_function_test.sql` hatte sein erstes
 * SELECT nie geplant bekommen.
 *
 * Jetzt wird jede Folge aus Weißraum und Kommentaren am Anfang verschluckt,
 * in beliebiger Reihenfolge.
 */
const ohneKopf = (s: string): string =>
  s.replace(/^(?:\s|--[^\n]*|\/\*[\s\S]*?\*\/)*/, "").trim();

/** Nur das lässt sich planen, ohne etwas zu tun. */
const planbar = (s: string): boolean => /^(with|select|table|values)\b/i.test(ohneKopf(s));
/** Und das schreibt — eine solche Datei gehört nie in den Production-Editor. */
const schreibt = (s: string): boolean =>
  /^(insert|update|delete|truncate|alter|drop|create|grant|revoke|comment|do|call|copy|security)\b/i
    .test(ohneKopf(s));

/**
 * Die FALTUNG der Funktionsdefinitionen über die ganze Migrationshistorie.
 *
 * Die Historie ist keine Liste, sondern eine Faltung: `0104` definiert
 * `seller_business_backup()`, `0129`, `0130` und `0131` ersetzen sie. Was in
 * der Datenbank LEBT, ist die letzte Fassung — und nur die wird hier geprüft.
 * `drop function` nimmt einen Eintrag wieder heraus, sonst stünde eine
 * Funktion zur Prüfung, die es nicht mehr gibt (`business_settings_public()`
 * aus `0019`, von `0026` entfernt).
 */
function funktionsfaltung(ausser: readonly string[] = []):
  Map<string, { datei: string; sql: string }> {
  const fold = new Map<string, { datei: string; sql: string }>();
  const dateien = readdirSync(MIG_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f) && !ausser.includes(f)).sort();
  for (const datei of dateien) {
    for (const roh of anweisungen(readFileSync(join(MIG_DIR, datei), "utf8"))) {
      const s = ohneKopf(roh);
      const weg = /^drop\s+function\s+(if\s+exists\s+)?(public\.)?([a-z_0-9]+)\s*\(([^)]*)\)/i.exec(s);
      if (weg) { fold.delete(`${weg[3]}(${weg[4].replace(/\s+/g, " ").trim()})`); continue; }
      const neu = /^create\s+(or\s+replace\s+)?function\s+(public\.)?([a-z_0-9]+)\s*\(/i.exec(s);
      if (!neu) continue;
      const args = s.slice(s.indexOf("(") + 1, s.indexOf(")")).replace(/\s+/g, " ").trim();
      fold.set(`${neu[3]}(${args})`, { datei, sql: s });
    }
  }
  return fold;
}

/**
 * Dieselbe Signatur, ohne die `default`-Ausdrücke.
 *
 * Der Schlüssel der Faltung trägt die Parameterliste so, wie sie in der
 * Migration steht — `p_limit integer default 20` eingeschlossen. `drop
 * function` nimmt das nicht an; es will die Typen, nicht die Vorgaben.
 */
function signaturOhneVorgaben(sig: string): string {
  return sig.replace(/\(([\s\S]*)\)$/, (_m, args: string) =>
    `(${args.split(",").map((a) => a.replace(/\s+default\s+[\s\S]*$/i, "").trim())
            .filter((a) => a !== "").join(", ")})`);
}

/**
 * Ein Rumpf, der sich im Stub-Schema NICHT erzeugen lässt — mit Grund.
 *
 * Dieselbe Bauart wie `NICHT_PLANBAR`: eng, begründet, selbstkorrigierend.
 * Lässt sich ein Eintrag plötzlich doch erzeugen, bricht der Lauf ab und
 * verlangt, dass die Zeile verschwindet.
 */
const NICHT_ERZEUGBAR: Record<string, string> = {
  "system_auth_inventory()":
    "liest auth.users — eine Tabelle, die Supabase mitbringt und keine Migration beschreibt. "
    + "Das Stub-Schema beschreibt `public`; Spalten eines fremden Schemas zu erfinden waere "
    + "geraten, und ein geratenes Schema ist genau der stille Fehlgrund, den dieses Werkzeug "
    + "verhindern soll.",
};

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

  /** Das Stub-Schema in eine frische Instanz spielen — Stufe 2, 3 und 4 brauchen es. */
  const stubAnweisungen = anweisungen(readFileSync(STUB, "utf8"));
  /**
   * Die `create view`-Anweisungen des Stub-Schemas, gesondert.
   *
   * Der Definitionslauf muss eine Funktion gelegentlich mit
   * `drop ... cascade` ersetzen, und das nimmt jede abhaengige Sicht mit.
   * Danach werden sie aus dieser Liste wieder angelegt.
   */
  const stubSichten = stubAnweisungen.filter((x) => /^\s*create\s+view\b/i.test(x));

  async function stubAnwenden(
    ziel: InstanceType<typeof PGlite>,
  ): Promise<{ angewendet: number; abgelehnt: number }> {
    let angewendet = 0, abgelehnt = 0;
    for (const s of stubAnweisungen) {
      try { await ziel.exec(s + ";"); angewendet++; } catch { abgelehnt++; }
    }
    return { angewendet, abgelehnt };
  }

  const db = new PGlite();
  const { angewendet, abgelehnt } = await stubAnwenden(db);
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
      const kopf = ohneKopf(t);
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


  /* =======================================================================
   * STUFE 3 — DER DEFINITIONSLAUF
   *
   * Die Planprüfung oben prüft LESENDE Anweisungen gegen ein Stub-Schema. Was
   * sie nicht anfasst, ist der Inhalt der Funktionen selbst — und genau dort
   * liegt der Rumpf, den `0136` austauscht: 21 494 Zeichen, die 28 Tabellen
   * lesen. Ein `language sql`-Rumpf wird bei der ERZEUGUNG vollständig
   * aufgelöst: jeder Tabellenname, jede Spalte, jeder Typ. Diese Stufe
   * erzeugt deshalb jeden gefalteten Rumpf in PostgreSQL und meldet jeden,
   * der nicht entsteht.
   *
   * WAS SIE FÜR `language plpgsql` NICHT LEISTET. Dort prüft PostgreSQL bei
   * der Erzeugung nur die SYNTAX des Rumpfs, keine Namen und keine Typen —
   * `check_function_bodies` kann nicht mehr. Für die 23 SQL-Funktionen der
   * Historie ist diese Stufe eine echte Auflösungsprüfung, für die übrigen
   * eine Syntaxprüfung mit dem richtigen Parser.
   * ==================================================================== */
  console.log("\nDEFINITIONSLAUF — jeder gefaltete Funktionsrumpf wird in PostgreSQL erzeugt");
  console.log("-".repeat(76));
  const fold = funktionsfaltung();
  const dbDef = new PGlite();
  await stubAnwenden(dbDef);
  let erzeugt = 0, sprachSql = 0;
  const nichtErzeugt: string[] = [];
  const unnoetigeAusnahme: string[] = [];
  for (const [sig, { datei, sql }] of fold) {
    if (/^\s*create[\s\S]{0,400}?language\s+sql\b/i.test(sql)) sprachSql++;
    try {
      await dbDef.exec(sql + ";");
      erzeugt++;
      if (NICHT_ERZEUGBAR[sig]) unnoetigeAusnahme.push(sig);
    } catch (e0) {
      /*
       * ERST WEG, DANN NOCH EINMAL — und nur in diesen zwei Fällen.
       *
       * Das Stub-Schema legt jede Signatur als Hülle an. Eine Migration, die
       * den RÜCKGABETYP ändert, kann die Hülle deshalb weder mit `create`
       * überschreiben (42723, schon da) noch mit `create or replace`
       * (42P13, Rückgabetyp lässt sich nicht ersetzen). `0139` tut genau das
       * mit `shop_offers()`.
       *
       * Vorsorglich zu droppen wäre falsch: der Schlüssel der Faltung trägt
       * die Parameterliste MIT `default`-Ausdrücken, und die nimmt
       * `drop function` nicht an. Deshalb nur im Fehlerfall, und mit einer
       * Signatur, aus der die Vorgaben entfernt sind.
       */
      const code0 = (e0 as { code?: string }).code;
      if (code0 === "42723" || code0 === "42P13") {
        try {
          await dbDef.exec(
            `drop function if exists public.${signaturOhneVorgaben(sig)} cascade;`);
          await dbDef.exec(sql + ";");
          /*
           * `cascade` NIMMT DIE ABHAENGIGEN SICHTEN MIT — und die braucht
           * eine spaetere Funktion vielleicht noch.
           *
           * `offer_state_live` (0146) liest `shop_offers()`. Wird dessen
           * Rumpf hier ersetzt, faellt die Sicht mit, und
           * `offer_availability_due()` (0147) scheiterte danach mit
           * `42P01 relation "public.offer_state_live" does not exist` —
           * ein Fehler, der nichts ueber die Migration sagte, sondern ueber
           * die Reihenfolge in diesem Werkzeug.
           *
           * Also: die Sichten des Stub-Schemas danach wieder anlegen. Was
           * schon steht, lehnt `create view` ab; das ist unerheblich.
           */
          for (const v of stubSichten) {
            try { await dbDef.exec(v + ";"); } catch { /* steht schon */ }
          }
          erzeugt++;
          if (NICHT_ERZEUGBAR[sig]) unnoetigeAusnahme.push(sig);
          continue;
        } catch { /* faellt unten durch, mit der ZWEITEN Meldung */ }
      }
      const err = e0 as { message?: string; code?: string };
      const zeile = `${sig}  (${datei})  [${err.code ?? "?"}] ${(err.message ?? "").split("\n")[0]}`;
      if (NICHT_ERZEUGBAR[sig]) {
        console.log(`  AUSNAHME ${zeile}`);
        console.log(`           Grund: ${NICHT_ERZEUGBAR[sig]}`);
      } else {
        console.log(`  FEHLER   ${zeile}`);
        nichtErzeugt.push(sig);
      }
    }
  }
  console.log("-".repeat(76));
  console.log(`  ${erzeugt} von ${fold.size} Rümpfen erzeugt, davon ${sprachSql} mit `
    + `language sql (vollständig aufgelöst), ${nichtErzeugt.length} Fehler, `
    + `${Object.keys(NICHT_ERZEUGBAR).length} begründete Ausnahme(n)`);

  /* =======================================================================
   * STUFE 4 — DER PROBELAUF DER NOCH NICHT ANGEWENDETEN MIGRATIONEN
   *
   * Eine Migration lässt sich nicht „planen": sie ändert das Schema. Was sich
   * prüfen lässt, ist ihr LAUF — gegen das Stub-Schema, mit erfundenen Zeilen,
   * in einer Wegwerf-Instanz. Vier Durchgänge, und drei davon müssen
   * SCHEITERN: eine Sicherung ist nur dann eine, wenn sie auch anschlägt.
   *
   * DIE ZEILEN SIND ERFUNDEN. Fünf Katalogzeilen, zwei Lagerzeilen, eine
   * Einstellung — kein Export, kein Backup, keine echte SKY-ID, keine
   * Verbindung zu Staging oder Production. Die Zahlen, die dabei
   * herauskommen, sagen über die echten Datenbestände NICHTS; was sie zeigen,
   * ist das VERHALTEN der Migration: dass sie prüft, bevor sie ändert, dass
   * sie bei Abweichung abbricht, und dass nach einem Abbruch nichts
   * zurückbleibt.
   * ==================================================================== */
  console.log("\nPROBELAUF — die Migrationen 0135-0144, gegen erfundene Zeilen");
  console.log("-".repeat(76));

  /**
   * Die Dateien, die auf PRODUCTION fehlen (`supabase/migrations/APPLIED.md`).
   *
   * WARUM PRODUCTION UND NICHT STAGING DER AUSGANGSPUNKT IST. Der Vorstand
   * unten entsteht als Faltung OHNE diese Dateien, und das ist genau der
   * Stand `0134`, den Production fuehrt. Staging ist seit dem 2026-10-19
   * weiter — dort stehen `0135` und `0136` schon —, und die Durchgaenge zu
   * `0137` und `0138` stellen diesen Stand deshalb ausdruecklich her, indem
   * sie die beiden zuerst fahren (`frischNach0136()`). So wird jede Datei
   * gegen den Zustand gefahren, den sie in der Wirklichkeit vorfindet, und
   * die Reihenfolge selbst wird mitgeprueft.
   */
  const PROBELAUF = ["0135_catalog_item_type.sql",
                     "0136_business_backup_item_type.sql",
                     "0137_catalog_accessories.sql",
                     "0138_catalog_portals.sql",
                     "0139_accessory_sale_release.sql",
                     "0140_business_backup_sale_release.sql",
                     "0141_seller_sale_state.sql"] as const;
  const M135 = join(MIG_DIR, PROBELAUF[0]);
  const M136 = join(MIG_DIR, PROBELAUF[1]);
  const M137 = join(MIG_DIR, PROBELAUF[2]);
  const M138 = join(MIG_DIR, PROBELAUF[3]);
  const M139 = join(MIG_DIR, PROBELAUF[4]);
  const R139 = "supabase/rollback/R0139_drop_sale_release.sql";
  const M140 = join(MIG_DIR, PROBELAUF[5]);
  const R140 = "supabase/rollback/R0140_back_to_0136.sql";
  const M141 = join(MIG_DIR, PROBELAUF[6]);
  const R141 = "supabase/rollback/R0141_drop_sale_state.sql";
  const R135 = "supabase/rollback/R0135_drop_item_type.sql";
  const R136 = "supabase/rollback/R0136_back_to_0131.sql";
  const R137 = "supabase/rollback/R0137_back_to_0135.sql";
  const R138 = "supabase/rollback/R0138_drop_portals.sql";

  /** Fünf Katalogzeilen, zwei davon mit Angebot, zwei in der Kategorie Spiele. */
  const ZEILEN = `
    insert into public.shop_settings (price_percentage) values (100);
    insert into public.categories (id, name, series_code)
         values (1, 'Figuren', 'PROBE'), (2, 'Spiele', 'PROBE');
    insert into public.skylanders
           (sky_id, name, slug, series_code, category_id, is_active, catalog_visible,
            market_price, card_type, source, display_name_override)
         values ('PROBE-1', 'Eins', 'eins', 'PROBE', 1, true, true, 10.00, 'core', 'probe', null),
                ('PROBE-2', 'Zwei', 'zwei', 'PROBE', 1, true, true, 20.00, 'core', 'probe', 'Zwei!'),
                ('PROBE-3', 'Drei', 'drei', 'PROBE', 1, true, false, 30.00, 'core', 'probe', null),
                /* EIN SPIEL MIT ANZEIGENAME, EINE FIGUR MIT ANZEIGENAME.
                   So unterscheiden sich „Overrides der Spiele" (1) und
                   „Overrides katalogweit" (2) — ein Vertrag, der wieder
                   katalogweit zaehlte, fiele in P21 auf. */
                ('PROBE-4', 'Spiel A', 'spiel-a', 'PROBE', 2, true, true, 40.00, 'game', 'probe', 'Spiel A!'),
                ('PROBE-5', 'Spiel B', 'spiel-b', 'PROBE', 2, true, true, 50.00, 'game', 'probe', null),
                -- Genau die zwei IDs, nach denen der Staging-Stempel in
                -- staging_pending_migrations.sql fragt. Erfundene Zeilen, wie
                -- alle hier — sie tragen nur den Namen.
                ('SKY-0821', 'Stempel A', 'stempel-a', 'PROBE', 1, true, true, 1.00, 'core', 'probe', null),
                ('SKY-0822', 'Stempel B', 'stempel-b', 'PROBE', 1, true, true, 1.00, 'core', 'probe', null);
    insert into public.shop_inventory (sky_id, condition, is_listed, available_quantity, sale_price)
         values ('PROBE-1', 'loose', true, 1, null),
                ('PROBE-2', 'loose', true, 2, 17.50);`;

  /** Der Ausgangszustand der Sicherungsfunktion: der Rumpf aus `0131`, mit ACL. */
  const STAND_0131 = `
    revoke all on function public.seller_business_backup() from public, anon;
    grant execute on function public.seller_business_backup() to authenticated;`;

  /*
   * DER AUSGANGSZUSTAND IST DER DER UMGEBUNGEN, NICHT DER DES REPOSITORIES.
   *
   * Das Stub-Schema entsteht aus ALLEN Migrationen — die noch nicht
   * angewendeten eingeschlossen. Es trägt `skylanders.item_type` also schon,
   * und die Faltung oben liefert `is_shop_eligible` in der Fassung aus
   * `0135`, `seller_business_backup` in der aus `0136` und
   * `non_collectible_categories` samt `seller_import_catalog` in der aus
   * `0137`. Gegen diesen Zustand gefahren, meldete jede der vier
   * Migrationen zu Recht „steht schon".
   *
   * Der Probelauf setzt deshalb zurück: die Faltung OHNE die vier Dateien
   * (das ist der Stand `0134`) und die Spalten, die sie anlegen, wieder weg.
   *
   * BIS ZUM 2026-10-25 STAND HIER „den Production führt". Das stimmt nicht
   * mehr: seit dem 2026-10-21 liegen `0135`–`0141` auf Production, seit dem
   * 2026-10-25 auch `0142` und `0143`. Der Rückstand ist jetzt ein
   * AUSGANGSPUNKT FÜR DEN PROBELAUF und nicht mehr das Abbild einer
   * Umgebung — die Probeläufe fahren damit weiter, was eine Migration an
   * echtem PostgreSQL tut, und das bleibt ihr Zweck. Welche das sind, liest er aus den Dateien
   * selbst — eine Liste, die niemand pflegen muss.
   */
  const vorstand = funktionsfaltung(PROBELAUF);
  const zurueck: string[] = [];
  for (const datei of PROBELAUF) {
    const sql = readFileSync(join(MIG_DIR, datei), "utf8");
    for (const m of sql.matchAll(
      /alter\s+table\s+(?:public\.)?([a-z_0-9]+)\s+add\s+column\s+([a-z_0-9]+)\b/gi)) {
      zurueck.push(`alter table public.${m[1]} drop column if exists ${m[2]};`);
    }
  }

  /*
   * UND DIE FUNKTIONEN, DIE ES VOR DIESEN DATEIEN NOCH NICHT GAB.
   *
   * Das Stub-Schema beschreibt nicht nur Tabellen: es legt fuer JEDE Funktion
   * aller Migrationen eine SIGNATUR an, damit die Planprüfung in Stufe 2 jeden
   * Aufruf auflösen kann. Für `seller_create_catalog_item` — die `0137`
   * einführt — heisst das: sie steht schon, bevor `0137` läuft. Und `0137`
   * bricht genau dann zu Recht mit „steht schon" ab. Das wäre ein Befund des
   * Stubs und keiner der Migration.
   *
   * Zurückgenommen wird deshalb jede Signatur, die diese Dateien NEU
   * einführen — also jede, die die Faltung OHNE sie nicht kennt. Eine
   * Funktion, die eine frühere Migration schon definiert hat
   * (`is_shop_eligible`, `non_collectible_categories`, `seller_import_catalog`,
   * `seller_business_backup`), bleibt stehen: sie SOLL vorhanden sein, und die
   * Migration ersetzt sie.
   *
   * Die Liste pflegt niemand — sie entsteht aus den Dateien selbst, wie die
   * Spaltenliste darüber.
   */
  for (const [sig] of funktionsfaltung().entries()) {
    if (vorstand.has(sig)) continue;
    zurueck.push(`drop function if exists public.${sig} cascade;`);
  }

  /*
   * Die Kommentare gehören dazu. `0131_function_body_check.sql` liest den
   * Funktionskommentar mit — ohne ihn wäre sein Abdruck leer und die Prüfung
   * meldete eine Abweichung, die nur dem Probelauf gehört.
   */
  const kommentare: string[] = [];
  for (const datei of readdirSync(MIG_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f) && !PROBELAUF.includes(f as never)).sort()) {
    for (const roh of anweisungen(readFileSync(join(MIG_DIR, datei), "utf8"))) {
      const s = ohneKopf(roh);
      if (/^comment\s+on\s+function\b/i.test(s)) kommentare.push(s);
    }
  }

  async function frisch(): Promise<InstanceType<typeof PGlite>> {
    const db = new PGlite();
    await stubAnwenden(db);
    /*
     * DIE HUELLE DARF DEN VORSTAND NICHT BLOCKIEREN.
     *
     * Das Stub-Schema legt jede Signatur aus ALLEN Migrationen an — auch aus
     * denen, die hier gerade NICHT gelten sollen. Aendert eine davon den
     * Rueckgabetyp (`0139` tut das mit `shop_offers()`), scheitert die
     * aeltere Fassung aus dem Vorstand an der neueren Huelle. Frueher fiel
     * das in den stillen `catch`, und der Probelauf lief mit einer leeren
     * Huelle weiter — eine Funktion, die 0 Zeilen liefert, statt der
     * richtigen. Genau diese Art Fehler soll dieses Werkzeug finden, nicht
     * erzeugen.
     */
    for (const [sig, { sql }] of vorstand) {
      try { await db.exec(sql + ";"); } catch (e) {
        const code = (e as { code?: string }).code;
        if (code !== "42723" && code !== "42P13") continue;   /* s. Stufe 3 */
        try {
          await db.exec(`drop function if exists public.${signaturOhneVorgaben(sig)} cascade;`);
          await db.exec(sql + ";");
        } catch { /* s. Stufe 3 */ }
      }
    }
    for (const s of kommentare) { try { await db.exec(s + ";"); } catch { /* s. Stufe 3 */ } }
    for (const s of zurueck) await db.exec(s);
    for (const s of anweisungen(ZEILEN)) await db.exec(s + ";");
    for (const s of anweisungen(STAND_0131)) await db.exec(s + ";");
    return db;
  }

  /**
   * Eine Prüfdatei fahren und die Zeilen 401, 902 und 9999 zurückgeben.
   *
   * `vorher` läuft in DERSELBEN Klammer — nur so wirkt ein
   * `set_config(…, true)` auf das folgende SELECT. Genau diese Zuordnung
   * verlangt der Z0-Vertrag, und genau sie wird hier nachgefahren.
   */
  async function pruefdatei(db: InstanceType<typeof PGlite>, datei: string,
                            opt: { vorher?: string } = {},
  ): Promise<{ abweichungen: string; befund: string; modus: string }> {
    const sql = anweisungen(readFileSync(join(CHECK_DIR, datei), "utf8"))
      .filter((s) => planbar(s));
    await db.exec("begin;");
    if (opt.vorher) await db.exec(opt.vorher);
    const r = (await db.query(`select nr, befund from (${ohneKopf(sql[0])}) x
                                where nr in (401, 902, 9999)`)) as
      { rows: { nr: number; befund: string }[] };
    await db.exec("rollback;");
    return {
      abweichungen: r.rows.find((z) => z.nr === 9999)?.befund ?? "(keine Zeile 9999)",
      befund: r.rows.find((z) => z.nr === 401)?.befund ?? "(keine Zeile 401)",
      modus: r.rows.find((z) => z.nr === 902)?.befund ?? "(keine Zeile 902)",
    };
  }

  /** Die Anweisungen einer Migration, ohne die reinen Kommentarblöcke. */
  const teileVon = (pfad: string): string[] =>
    anweisungen(readFileSync(pfad, "utf8")).filter((s) => ohneKopf(s).length > 0);

  /**
   * Eine Migration Anweisung für Anweisung, mit oder ohne Klammer.
   *
   * `zwischen` schiebt eine fremde Anweisung VOR die Anweisung mit dem
   * genannten Index ein — so wird aus einer Nachbedingung eine Prüfung: ändert
   * sich zwischen Abdruck und Vergleich etwas, muss sie anschlagen.
   */
  async function fahre(db: InstanceType<typeof PGlite>, pfad: string,
                      opt: {
                        klammer: boolean;
                        zwischen?: { vor: number; sql: string };
                        /** Textersetzung vor dem Lauf — fuer den Passwortplatzhalter. */
                        ersetze?: readonly [string, string];
                      } = { klammer: true },
  ): Promise<string | null> {
    const teile = opt.ersetze === undefined
      ? teileVon(pfad)
      : teileVon(pfad).map((s) => s.split(opt.ersetze![0]).join(opt.ersetze![1]));
    try {
      if (opt.klammer) await db.exec("begin;");
      for (const [i, s] of teile.entries()) {
        if (opt.zwischen && opt.zwischen.vor === i) await db.exec(opt.zwischen.sql);
        await db.exec(s + ";");
      }
      if (opt.klammer) await db.exec("commit;");
      return null;
    } catch (e) {
      const err = e as { message?: string; code?: string };
      /* IMMER zuruecknehmen, nicht nur bei eigener Klammer: eine Datei, die
         ihr `begin` selbst mitbringt (das Staging-Skript), laesst sonst eine
         abgebrochene Transaktion offen — und jede folgende Anweisung dieser
         Instanz scheitert mit `25P02`. Ohne offene Klammer ist `rollback`
         eine Warnung, kein Fehler. */
      try { await db.exec("rollback;"); } catch { /* keine offene Klammer */ }
      return `[${err.code ?? "?"}] ${(err.message ?? "").split("\n")[0]}`;
    }
  }

  const spalte = async (db: InstanceType<typeof PGlite>): Promise<boolean> =>
    ((await db.query(`select count(*)::int as n from information_schema.columns
                       where table_schema = 'public' and table_name = 'skylanders'
                         and column_name = 'item_type'`)) as { rows: { n: number }[] })
      .rows[0].n > 0;
  const abdruck = async (db: InstanceType<typeof PGlite>): Promise<string> =>
    ((await db.query(`select md5(prosrc) as m from pg_proc
                       where proname = 'seller_business_backup'`)) as { rows: { m: string }[] })
      .rows[0].m;

  /** Ein SQL-Literal aus einer Zeichenkette — Hochkomma verdoppelt. */
  function quote(text: string): string {
    return `'${text.split("'").join("''")}'`;
  }

  const probe: { name: string; ok: boolean; sagt: string }[] = [];

  /* P1 — der gute Fall: 0135, dann 0136, beide geklammert. */
  {
    const db = await frisch();
    const f1 = await fahre(db, M135);
    const f2 = f1 ? "nicht gefahren" : await fahre(db, M136);
    const spiele = ((await db.query(
      `select count(*)::int as n from public.skylanders where item_type = 'game'`,
    )) as { rows: { n: number }[] }).rows[0].n;
    const angebote = ((await db.query(
      `select count(*)::int as n from public.shop_offers()`,
    )) as { rows: { n: number }[] }).rows[0].n;
    const ok = f1 === null && f2 === null && spiele === 2 && angebote === 2
      && await abdruck(db) === "f6d08440707ba72a8040a8d1e666c092";
    probe.push({ name: "P1  0135 und 0136 laufen durch", ok,
      sagt: f1 ?? f2 ?? `${spiele} Spiele markiert, ${angebote} Angebote unverändert, `
        + `Sicherung md5 ${(await abdruck(db)).slice(0, 8)}…` });
  }

  /* P2 — ohne Klammer: 0135 muss abbrechen, BEVOR die Spalte entsteht. */
  {
    const db = await frisch();
    const fehler = await fahre(db, M135, { klammer: false });
    const ok = fehler !== null && fehler.includes("nicht in einer Transaktion")
      && !(await spalte(db));
    probe.push({ name: "P2  0135 ohne begin/commit bricht ab", ok,
      sagt: fehler ?? "LIEF DURCH — das wäre ein Befund" });
  }

  /* P3 — die Angebotsliste wird zwischen Abdruck und Nachbedingung verändert. */
  {
    const db = await frisch();
    const teile = teileVon(M135);
    /* Unmittelbar VOR die Nachbedingung — das ist der letzte DO-Block. */
    const nachbedingung = teile.reduce(
      (letzter, s, i) => (/^do\s+\$\$/i.test(ohneKopf(s)) ? i : letzter), -1);
    const fehler = await fahre(db, M135, {
      klammer: true,
      zwischen: { vor: nachbedingung,
        sql: "update public.shop_inventory set is_listed = false where sky_id = 'PROBE-1';" },
    });
    const ok = fehler !== null && fehler.includes("Angebotsliste hat sich geaendert")
      && !(await spalte(db));
    probe.push({ name: "P3  verändertes Angebot bricht 0135 ab und rollt zurück", ok,
      sagt: fehler ?? "LIEF DURCH — das wäre ein Befund" });
  }

  /* P4 — 0136 ohne 0135: die harte Reihenfolge. */
  {
    const db = await frisch();
    const fehler = await fahre(db, M136);
    const ok = fehler !== null && fehler.includes("setzt 0135 voraus")
      && await abdruck(db) === "24c3810288bb20929fe995554a267adf";
    probe.push({ name: "P4  0136 vor 0135 bricht ab, die Sicherung bleibt die aus 0131", ok,
      sagt: fehler ?? "LIEF DURCH — das wäre ein Befund" });
  }

  /* P5/P6 — die Prüfdatei zur Sicherungsfunktion muss BEIDE Stände als in
     Ordnung lesen: den aus `0131` und den aus `0136`. Genau daran war die
     einzelne Abdruckerwartung gescheitert, die bis zum 2026-10-19 dort stand. */
  {
    const db = await frisch();
    const vor = await pruefdatei(db, "0131_function_body_check.sql");
    probe.push({ name: "P5  0131_function_body_check liest den Stand 0131 als in Ordnung",
      ok: vor.abweichungen === "0" && vor.befund === "STAND_0131_ZEICHENGLEICH",
      sagt: `9999 = ${vor.abweichungen}, Befund ${vor.befund}` });

    const f1 = await fahre(db, M135);
    const f2 = await fahre(db, M136);
    const nach = await pruefdatei(db, "0131_function_body_check.sql");
    probe.push({ name: "P6  und nach 0136 den Stand 0136 — dieselbe Datei, kein Fehlalarm",
      ok: f1 === null && f2 === null && nach.abweichungen === "0"
        && nach.befund === "STAND_0136_ZEICHENGLEICH",
      sagt: f1 ?? f2 ?? `9999 = ${nach.abweichungen}, Befund ${nach.befund}` });
  }

  /* P7/P8 — die Ruecknahmen, und ihre Reihenfolge. `R0135` darf die Spalte
     nicht wegnehmen, solange die Sicherung sie liest: PostgreSQL vermerkt fuer
     einen `language sql`-Rumpf keine Abhaengigkeit, der `drop column` wuerde
     also gelingen und die Sicherung erst beim naechsten Aufruf scheitern. */
  {
    const db = await frisch();
    await fahre(db, M135);
    await fahre(db, M136);
    const zuFrueh = await fahre(db, R135);
    const spalteDa = await spalte(db);
    probe.push({ name: "P7  R0135 verweigert, solange die Sicherung item_type liest",
      ok: zuFrueh !== null && zuFrueh.includes("liest item_type noch")
        && spalteDa && await abdruck(db) === "f6d08440707ba72a8040a8d1e666c092",
      sagt: zuFrueh ?? "LIEF DURCH — das wäre ein Befund" });

    const r136 = await fahre(db, R136);
    const r135 = r136 ? "nicht gefahren" : await fahre(db, R135);
    probe.push({ name: "P8  in der Reihenfolge R0136, R0135 nimmt sich beides zurück",
      ok: r136 === null && r135 === null && !(await spalte(db))
        && await abdruck(db) === "24c3810288bb20929fe995554a267adf",
      sagt: r136 ?? r135
        ?? `Sicherung wieder md5 ${(await abdruck(db)).slice(0, 8)}…, Spalte weg` });
  }

  /* P9–P11 — der Z0-Vertrag. Drei Durchgänge, und der entscheidende ist der
     dritte: im Modus `staging` muss der Postflight an den erfundenen Zeilen
     SCHEITERN. Täte er das nicht, läse er die Werte nur aus. */
  {
    const db = await frisch();
    await fahre(db, M135);
    const SETZE = (m: string) => `select set_config('skyisles.z0', '${m}', true);`;

    const ohne = await pruefdatei(db, "0135_postflight.sql");
    probe.push({ name: "P9  ohne Vertragsmodus ist der Postflight blockierend",
      ok: ohne.abweichungen !== "0" && ohne.modus.startsWith("nein"),
      sagt: `9999 = ${ohne.abweichungen}, Zeile 902: ${ohne.modus}` });

    const verzicht = await pruefdatei(db, "0135_postflight.sql",
      { vorher: SETZE("keine") });
    probe.push({ name: "P10 mit ausdrücklichem Verzicht läuft er durch",
      ok: verzicht.abweichungen === "0" && verzicht.modus === "ja",
      sagt: `9999 = ${verzicht.abweichungen}, Zeile 902: ${verzicht.modus}` });

    const vertrag = await pruefdatei(db, "0135_postflight.sql",
      { vorher: SETZE("staging") });
    probe.push({ name: "P11 im Modus staging schlägt er an erfundenen Zeilen FEHL",
      ok: vertrag.abweichungen !== "0" && vertrag.modus === "ja",
      sagt: `9999 = ${vertrag.abweichungen} (erwartet > 0: 5 Zeilen gegen 534/256/…), `
        + `Zeile 902: ${vertrag.modus}` });
  }

  /* P12/P13 — die zwei Flüge zu `0136` messen gegenläufige Zustände. Eine
     Prüfdatei, die vor UND nach der Migration grün meldet, prüft nichts. */
  {
    const db = await frisch();
    await fahre(db, M135);
    const KEINE = "select set_config('skyisles.z0', 'keine', true);";

    const vorPre  = await pruefdatei(db, "0136_preflight.sql",  { vorher: KEINE });
    const vorPost = await pruefdatei(db, "0136_postflight.sql", { vorher: KEINE });
    probe.push({ name: "P12 vor 0136: Preflight grün, Postflight blockierend",
      ok: vorPre.abweichungen === "0" && vorPost.abweichungen !== "0"
        && vorPre.befund === "STAND_0131",
      sagt: `Preflight 9999 = ${vorPre.abweichungen} (${vorPre.befund}), `
        + `Postflight 9999 = ${vorPost.abweichungen}` });

    await fahre(db, M136);
    const nachPre  = await pruefdatei(db, "0136_preflight.sql",  { vorher: KEINE });
    const nachPost = await pruefdatei(db, "0136_postflight.sql", { vorher: KEINE });
    probe.push({ name: "P13 nach 0136: Postflight grün, Preflight blockierend",
      ok: nachPost.abweichungen === "0" && nachPre.abweichungen !== "0"
        && nachPost.befund === "STAND_0136",
      sagt: `Postflight 9999 = ${nachPost.abweichungen} (${nachPost.befund}), `
        + `Preflight 9999 = ${nachPre.abweichungen}` });
  }

  /* P14 — der Staging-Wächter. Er behauptet, dass `0133` und `0134` NICHT
     stehen; also wird er gegen einen Stand gefahren, in dem sie fehlen — und
     danach gegen einen, in dem `0133` steht. Nur wenn der zweite Lauf
     anschlägt, prüft der erste etwas. */
  {
    const ohne0133 = funktionsfaltung([...PROBELAUF,
      "0133_paid_total_immutable.sql", "0134_purchase_item_source_row_visible.sql"]);
    const db = new PGlite();
    await stubAnwenden(db);
    for (const [, { sql }] of ohne0133) { try { await db.exec(sql + ";"); } catch { /* s. Stufe 3 */ } }
    for (const s of kommentare) { try { await db.exec(s + ";"); } catch { /* s. Stufe 3 */ } }
    for (const s of zurueck) await db.exec(s);
    for (const s of anweisungen(ZEILEN)) await db.exec(s + ";");

    const vorher = await pruefdatei(db, "staging_pending_migrations.sql");
    /* Jetzt 0133 nachziehen — die Funktion allein genügt für den Gegenbeweis. */
    for (const roh of anweisungen(readFileSync(
      join(MIG_DIR, "0133_paid_total_immutable.sql"), "utf8"))) {
      const s = ohneKopf(roh);
      if (/^create or replace function/i.test(s)) await db.exec(s + ";");
    }
    const nachher = await pruefdatei(db, "staging_pending_migrations.sql");
    probe.push({ name: "P14 der Staging-Wächter erkennt 0133 — grün ohne, blockierend mit",
      ok: vorher.abweichungen === "0" && nachher.abweichungen !== "0",
      sagt: `ohne 0133: 9999 = ${vorher.abweichungen}, mit 0133: 9999 = ${nachher.abweichungen}` });
  }

  /* P15/P16 — der Einrichtungsschritt fuer den lesenden Staging-Zugang.
     Er verteilt Rechte, und Rechte lassen sich nicht durch Lesen pruefen:
     also wird er gefahren. Der Aufbau bildet nach, was in der echten
     Datenbank gilt — RLS auf den zwoelf Tabellen, die bestehenden Policies
     `to anon, authenticated`, und die Rechte der sensiblen Funktionen. */
  const AGENT_SETUP = "supabase/operations/staging-agent-setup.sql";
  /* Der Einrichtungsschritt bricht beim Platzhalter ab — zu Recht. Fuer den
     Probelauf tritt ein Wegwerf-Passwort an seine Stelle; es verlaesst diese
     Instanz nie. */
  const SETUP_PW: readonly [string, string] =
    ["HIER-EIN-NEUES-LANGES-PASSWORT-EINSETZEN", "ProbelaufOhneBedeutung0123456789"];
  const DIE_12 = ["categories", "collection_items", "inventory_movements",
    "purchase_items", "purchase_receipt_counters", "purchase_receipt_downloads",
    "purchase_receipts", "purchases", "sale_items", "series",
    "shop_inventory", "skylanders"] as const;
  const SENSIBEL = ["public.seller_issue_purchase_receipt(bigint)",
    "public.seller_issue_purchase_receipt_correction(bigint)",
    "public.seller_business_backup()", "public.system_platform_export()",
    "public.purchase_receipt_fingerprint(bigint)",
    "public.is_shop_eligible(text)", "public.non_collectible_categories()",
    "public.shop_offers()"] as const;

  async function wieEchteDatenbank(): Promise<InstanceType<typeof PGlite>> {
    const db = new PGlite();
    await stubAnwenden(db);
    for (const t of DIE_12) {
      await db.exec(`alter table public.${t} enable row level security;`);
    }
    /* Die bestehenden Policies: alle `to anon, authenticated` gebunden. */
    for (const t of ["skylanders", "categories", "series"]) {
      await db.exec(`create policy ${t}_select_public on public.${t} `
        + "for select to anon, authenticated using (true);");
      await db.exec(`grant select on table public.${t} to anon, authenticated;`);
    }
    for (const sig of SENSIBEL) {
      try {
        await db.exec(`revoke all on function ${sig} from public, anon, authenticated, service_role;`);
      } catch { /* im Stub fehlt vielleicht eine Signatur */ }
    }
    await db.exec("insert into public.skylanders (sky_id) values ('SKY-0821'), ('SKY-0822');");
    await db.exec("insert into public.purchases (id) values (1), (2), (3);");
    return db;
  }

  {
    const db = await wieEchteDatenbank();
    const fehler = await fahre(db, AGENT_SETUP, { klammer: false, ersetze: SETUP_PW });
    let liest = -1, schreibt = "offen", backup = "offen";
    if (fehler === null) {
      await db.exec("set role skyisles_agent");
      liest = ((await db.query("select count(*)::int as n from public.purchases")) as
        { rows: { n: number }[] }).rows[0].n;
      for (const [sql, name] of [["insert into public.purchases (id) values (99)", "schreibt"],
                                 ["select public.seller_business_backup()", "backup"]] as const) {
        try { await db.exec(sql); }
        catch (e) {
          const c = (e as { code?: string }).code ?? "?";
          if (name === "schreibt") schreibt = c; else backup = c;
        }
      }
      await db.exec("reset role");
    }
    probe.push({
      name: "P15 der Staging-Einrichtungsschritt läuft durch, und die Rolle liest ohne bypassrls",
      ok: fehler === null && liest === 3 && schreibt === "42501" && backup === "42501",
      sagt: fehler ?? `liest ${liest} von 3 Zeilen, Schreibversuch ${schreibt}, `
        + `seller_business_backup ${backup}`,
    });
  }

  {
    /* Gegenprobe: ohne die Policy liest die Rolle null Zeilen — das ist der
       Grund, warum es sie gibt, und der Beweis, dass `bypassrls` dafuer nicht
       noetig ist. */
    const db = await wieEchteDatenbank();
    await fahre(db, AGENT_SETUP, { klammer: false, ersetze: SETUP_PW });
    await db.exec("drop policy agent_read_purchases on public.purchases;");
    await db.exec("set role skyisles_agent");
    const ohne = ((await db.query("select count(*)::int as n from public.purchases")) as
      { rows: { n: number }[] }).rows[0].n;
    await db.exec("reset role");

    /* Und: der Einrichtungsschritt bricht ab, wenn die Belegsperre nicht
       dicht ist. */
    const db2 = await wieEchteDatenbank();
    await db2.exec("grant execute on function public.seller_issue_purchase_receipt(bigint) to anon;");
    const abbruch = await fahre(db2, AGENT_SETUP, { klammer: false, ersetze: SETUP_PW });

    probe.push({
      name: "P16 ohne Policy liest sie 0 Zeilen, und bei offener Belegsperre bricht sie ab",
      ok: ohne === 0 && abbruch !== null && abbruch.includes("Belegsperre ist nicht dicht"),
      sagt: `ohne Policy: ${ohne} Zeilen (erwartet 0); `
        + `offene Belegsperre: ${abbruch ?? "LIEF DURCH — das wäre ein Befund"}`,
    });
  }

  /* P17 — WAS DARF DIE ROLLE WIRKLICH AUSFUEHREN?
   *
   * Der statische Bericht (`npm run db:acl:audit`) sagt: 19 schreibende und 2
   * lesende `security definer`-Funktionen sind von PUBLIC aufrufbar, und jede
   * traegt `can_operate_active_seller()` VOR dem ersten Schreibvorgang. Das
   * ist eine Aussage ueber den Text. Hier wird sie AUSGEFUEHRT: die echten
   * Ruempfe, die Rolle `skyisles_agent`, `auth.uid()` NULL — und dann jede
   * der 21 Funktionen aufgerufen. Keine darf durchlaufen, und keine
   * Zeilenzahl darf sich bewegen. */
  {
    const GEPRUEFT = [
      "seller_add_sale_fee", "seller_add_sale_item", "seller_add_sale_refund",
      "seller_add_settlement_adjustment", "seller_create_sale", "seller_delete_sale",
      "seller_import_sale_group", "seller_remove_sale_fee", "seller_remove_sale_refund",
      "seller_restock_sale_item", "seller_return_sale_item", "seller_set_purchase_test",
      "seller_set_sale_date", "seller_set_sale_payout", "seller_set_sale_shipped",
      "seller_set_sale_test", "seller_unbook_sale_item", "seller_update_sale_fee",
      "seller_update_sale_refund", "seller_sale_audit", "seller_sale_fingerprints",
    ] as const;
    const GEZAEHLT = ["sales", "sale_items", "sale_fees", "sale_refunds",
                      "settlement_adjustments", "purchases", "purchase_items",
                      "inventory_movements", "shop_inventory"] as const;

    /* Die Argumenttypen stehen im Stub-Schema — dort ist die Signatur auf
       Typen reduziert, und genau die braucht ein Aufruf mit NULL-Werten. */
    const signatur = new Map<string, string>();
    for (const m of readFileSync(STUB, "utf8").matchAll(
      /create or replace function public\.([a-z_0-9]+)\(([^)]*)\)\s+returns/g)) {
      signatur.set(m[1], m[2].trim());
    }

    const db = await wieEchteDatenbank();
    /* Die ECHTEN Ruempfe ueber die Stubs legen — sonst wuerde eine Huelle
       geprueft, die ohnehin null zurueckgibt. */
    for (const [, { sql }] of fold) { try { await db.exec(sql + ";"); } catch { /* s. Stufe 3 */ } }
    const setupFehler = await fahre(db, AGENT_SETUP, { klammer: false, ersetze: SETUP_PW });

    const vorher = new Map<string, number>();
    for (const tab of GEZAEHLT) {
      vorher.set(tab, ((await db.query(`select count(*)::int as n from public.${tab}`)) as
        { rows: { n: number }[] }).rows[0].n);
    }

    await db.exec("set role skyisles_agent");
    let abgewiesen = 0;
    const auffaellig: string[] = [];
    for (const f of GEPRUEFT) {
      const args = (signatur.get(f) ?? "").split(",").map((s) => s.trim())
        .filter((s) => s !== "").map((ty) => `null::${ty}`).join(", ");
      try {
        await db.query(`select * from public.${f}(${args})`);
        auffaellig.push(`${f}: DURCHGELAUFEN`);
      } catch (e) {
        const m = (e as { message?: string }).message ?? "";
        if (m.includes("seller operator role required")) abgewiesen++;
        else auffaellig.push(`${f}: ${m.split("\n")[0].slice(0, 60)}`);
      }
    }
    await db.exec("reset role");

    const bewegt: string[] = [];
    for (const tab of GEZAEHLT) {
      const jetzt = ((await db.query(`select count(*)::int as n from public.${tab}`)) as
        { rows: { n: number }[] }).rows[0].n;
      if (jetzt !== vorher.get(tab)) bewegt.push(`${tab} ${vorher.get(tab)}→${jetzt}`);
    }

    probe.push({
      name: "P17 die Rolle kann keine der 21 von PUBLIC erreichbaren Schreib-/Definer-Funktionen ausführen",
      ok: setupFehler === null && abgewiesen === GEPRUEFT.length
        && auffaellig.length === 0 && bewegt.length === 0,
      sagt: setupFehler ?? `${abgewiesen} von ${GEPRUEFT.length} abgewiesen ("seller operator `
        + `role required"), Zeilenzahlen unverändert`
        + (auffaellig.length > 0 ? ` — AUFFÄLLIG: ${auffaellig.join("; ")}` : "")
        + (bewegt.length > 0 ? ` — BEWEGT: ${bewegt.join(", ")}` : ""),
    });
  }

  /* P18 — DIE MITGLIEDSCHAFTSPRUEFUNG, IN BEIDEN RICHTUNGEN.
   *
   * Der Lauf vom 2026-10-19 ist an dieser Stelle abgebrochen: die
   * Nachbedingung verbot JEDE Mitgliedschaft an der Rolle, und PostgreSQL
   * erzeugt selbst eine, sobald ein CREATEROLE-Nutzer ohne Superuser-Recht
   * die Rolle anlegt (`admin` ja, `inherit`/`set` nein). Hier werden die drei
   * Faelle gefahren, die der Unterschied ausmacht. */
  {
    const nachbedingung = (): string => {
      const teile = teileVon(AGENT_SETUP);
      return teile[teile.length - 1];     // der letzte DO-Block
    };
    const db = await wieEchteDatenbank();
    await fahre(db, AGENT_SETUP, { klammer: false, ersetze: SETUP_PW });

    const nach = async (sql: string): Promise<string | null> => {
      try { await db.exec(sql); } catch (e) {
        return `Aufbau: ${(e as { message?: string }).message ?? ""}`;
      }
      try { await db.exec(nachbedingung() + ";"); return null; }
      catch (e) { return ((e as { message?: string }).message ?? "").split("\n")[0]; }
    };

    /* 1. Die Mitgliedschaft, die PostgreSQL selbst anlegt: Ersteller, mit
          admin, ohne inherit, ohne set. Muss DURCHLAUFEN. */
    const erlaubt = await nach(
      "grant skyisles_agent to postgres with admin option, inherit false, set false;");

    /* 2. Dieselbe Rolle, aber MIT set/inherit — das gibt Rechte weiter. */
    await db.exec("revoke skyisles_agent from postgres;");
    const mitSet = await nach("grant skyisles_agent to postgres with inherit true;");

    /* 3. Eine FREMDE Rolle als Mitglied. */
    await db.exec("revoke skyisles_agent from postgres;");
    await db.exec("create role fremder_gast login;");
    const fremd = await nach("grant skyisles_agent to fremder_gast;");

    probe.push({
      name: "P18 Mitgliedschaft: Ersteller erlaubt, inherit/set und fremde Rollen nicht",
      ok: erlaubt === null
        && mitSet !== null && mitSet.includes("inherit")
        && fremd !== null && fremd.includes("fremde Rolle"),
      sagt: `Ersteller (admin, ohne inherit/set): ${erlaubt ?? "durchgelaufen"} · `
        + `mit inherit: ${mitSet ?? "DURCHGELAUFEN — Befund"} · `
        + `fremde Rolle: ${fremd ?? "DURCHGELAUFEN — Befund"}`,
    });
  }

  /* P19 — die Diagnosedatei zum Abbruch. Sie muss BEIDE Ausgaenge richtig
     benennen: „nichts angewendet" und „teilweise angewendet". */
  {
    const DIAG = "staging_agent_role_diagnosis.sql";
    const db = await wieEchteDatenbank();

    const lies = async (): Promise<{ abweichungen: string; deutung: string }> => {
      const sql = anweisungen(readFileSync(join(CHECK_DIR, DIAG), "utf8"))
        .filter((s) => planbar(s));
      const r = (await db.query(`select nr, befund from (${ohneKopf(sql[0])}) x
                                  where nr in (306, 9999)`)) as
        { rows: { nr: number; befund: string }[] };
      return {
        abweichungen: r.rows.find((z) => z.nr === 9999)?.befund ?? "(keine)",
        deutung: r.rows.find((z) => z.nr === 306)?.befund ?? "(keine)",
      };
    };

    const vorher = await lies();
    await fahre(db, AGENT_SETUP, { klammer: false, ersetze: SETUP_PW });
    const nachher = await lies();
    /* Und eine Mitgliedschaft, die Rechte weitergibt, muss sie als
       blockierende Abweichung melden. */
    await db.exec("grant skyisles_agent to postgres with inherit true;");
    const mitSet = await lies();

    probe.push({
      name: "P19 die Diagnose benennt beide Ausgänge und schlägt bei inherit/set an",
      ok: vorher.abweichungen === "0" && vorher.deutung.includes("ZURUECKGEROLLT")
        && nachher.abweichungen === "0" && nachher.deutung.includes("TEILWEISE")
        && mitSet.abweichungen !== "0",
      sagt: `ohne Rolle: 9999 = ${vorher.abweichungen}, "${vorher.deutung}" · `
        + `nach dem Setup: 9999 = ${nachher.abweichungen}, "${nachher.deutung}" · `
        + `mit inherit: 9999 = ${mitSet.abweichungen}`,
    });
  }

  /* P20 — DIE ABLEITUNG FUER NEUE ZEILEN.
   *
   * Der Backfill in `0135` trifft nur die Zeilen von heute. Hier wird
   * geprueft, was MORGEN passiert: sechs Schreibfaelle gegen die echten
   * Ruempfe, nach angewendeter `0135`. Besonders der vierte — ein
   * unbekannter Kategoriename darf NIE zum Spiel werden. */
  {
    const db = await frisch();
    const fehler = await fahre(db, M135);
    const zahl = async (sql: string): Promise<string> =>
      String(((await db.query(sql)) as { rows: Record<string, unknown>[] }).rows[0]?.w ?? "?");

    const angeboteVor = await zahl("select count(*)::text as w from public.shop_offers()");
    await db.exec("insert into public.categories (id, name, series_code) "
      + "values (3, 'Taschen', 'PROBE');");
    await db.exec(`
      insert into public.skylanders
             (sky_id, name, slug, series_code, category_id, is_active, catalog_visible,
              market_price, card_type, source)
      values ('NEU-SPIEL', 'Neues Spiel', 'neues-spiel', 'PROBE', 2, true, true, 9, 'game', 'probe'),
             ('NEU-FIGUR', 'Neue Figur', 'neue-figur', 'PROBE', 1, true, true, 9, 'core', 'probe'),
             ('NEU-TASCHE', 'Neue Tasche', 'neue-tasche', 'PROBE', 3, true, true, 9, 'core', 'probe');
      insert into public.skylanders
             (sky_id, name, slug, series_code, category_id, is_active, catalog_visible,
              market_price, card_type, source, item_type)
      values ('NEU-PORTAL', 'Neues Portal', 'neues-portal', 'PROBE', 2, true, true, 9,
              'core', 'probe', 'portal');
      update public.skylanders set category_id = 2 where sky_id = 'NEU-FIGUR';
      insert into public.skylanders
             (sky_id, name, slug, series_code, category_id, is_active, catalog_visible,
              market_price, card_type, source, item_type)
      values ('NEU-BUNDLE', 'Neues Bundle', 'neues-bundle', 'PROBE', 1, true, true, 9,
              'core', 'probe', 'bundle');
      update public.skylanders set category_id = 3 where sky_id = 'NEU-BUNDLE';`);

    const typ = async (id: string): Promise<string> =>
      zahl(`select item_type as w from public.skylanders where sky_id = '${id}'`);
    const faelle: [string, string, string][] = [
      ["Spiele-Zeile ohne Angabe", await typ("NEU-SPIEL"), "game"],
      ["Figurenzeile ohne Angabe", await typ("NEU-TASCHE"), "figure"],
      ["ausdrueckliches portal in Spiele", await typ("NEU-PORTAL"), "portal"],
      ["Figur nach Spiele umgehaengt", await typ("NEU-FIGUR"), "game"],
      ["bundle bleibt bundle nach Umhaengen", await typ("NEU-BUNDLE"), "bundle"],
    ];
    const falsch = faelle.filter(([, ist, soll]) => ist !== soll);

    /* Und keine der neuen Zeilen wird shopfaehig, ausser der echten Figur —
       die hat kein Lager, also auch kein Angebot. */
    const shopfaehig = await zahl(
      "select string_agg(sky_id || '=' || public.is_shop_eligible(sky_id)::text, ' ' "
      + "order by sky_id) as w from public.skylanders where sky_id like 'NEU-%'");
    const angeboteNach = await zahl("select count(*)::text as w from public.shop_offers()");

    probe.push({
      name: "P20 eine neue Zeile bekommt den richtigen Artikeltyp — und Unbekanntes wird nie zum Spiel",
      ok: fehler === null && falsch.length === 0 && angeboteNach === angeboteVor
        && shopfaehig === "NEU-BUNDLE=false NEU-FIGUR=false NEU-PORTAL=false "
          + "NEU-SPIEL=false NEU-TASCHE=true",
      sagt: fehler ?? (falsch.length > 0
        ? falsch.map(([n, ist, soll]) => `${n}: ${ist} statt ${soll}`).join("; ")
        : `5 von 5 Faellen richtig, Angebote ${angeboteVor} → ${angeboteNach}, `
          + `shopfaehig: ${shopfaehig}`),
    });
  }

  /* P21 — DAS STAGING-SKRIPT IN EINEM DURCHGANG.
   *
   * Es bringt `begin`/`commit` selbst mit, bettet beide Migrationen ein und
   * prueft 18 Bezugswerte vorher und nachher. Gefahren wird es zweimal:
   * einmal mit dem Z0-Vertrag auf die Zahlen dieser Wegwerf-Instanz
   * umgestellt (dann muss es DURCHLAUFEN), und einmal unveraendert (dann muss
   * der Vertrag ANSCHLAGEN — er ist auf die echten Staging-Zahlen geschrieben). */
  {
    const SKRIPT = "supabase/operations/staging-0135-0136.sql";
    const ORIGINAL = readFileSync(SKRIPT, "utf8");

    /** Stand 0132: die Faltung ohne 0133, 0134, 0135, 0136. */
    const bauen = async (): Promise<InstanceType<typeof PGlite>> => {
      const fold0132 = funktionsfaltung([...PROBELAUF,
        "0133_paid_total_immutable.sql", "0134_purchase_item_source_row_visible.sql"]);
      const db = new PGlite();
      await stubAnwenden(db);
      /* Wie in `frisch()`: eine Huelle mit anderem Rueckgabetyp darf die
         gueltige Fassung nicht still verdraengen. */
      for (const [sig, { sql }] of fold0132) {
        try { await db.exec(sql + ";"); } catch (e) {
          const code = (e as { code?: string }).code;
          if (code !== "42723" && code !== "42P13") continue;   /* s. Stufe 3 */
          try {
            await db.exec(`drop function if exists public.${signaturOhneVorgaben(sig)} cascade;`);
            await db.exec(sql + ";");
          } catch { /* s. Stufe 3 */ }
        }
      }
      for (const s of kommentare) { try { await db.exec(s + ";"); } catch { /* s. Stufe 3 */ } }
      for (const s of zurueck) await db.exec(s);
      for (const s of anweisungen(ZEILEN)) await db.exec(s + ";");
      for (const s of anweisungen(STAND_0131)) await db.exec(s + ";");
      for (const sig of SENSIBEL) {
        try {
          await db.exec(`revoke all on function ${sig} from public, anon, authenticated, service_role;`);
        } catch { /* im Stub fehlt vielleicht eine Signatur */ }
      }
      await db.exec("insert into public.purchases (id, source, total_cost) "
        + "values (1, 'excel_order_2026', 10.50), (2, 'excel_order_2026', 5.25);");
      return db;
    };

    /* Der Vertrag, auf die Zahlen dieser Instanz umgestellt. */
    const messen = async (db: InstanceType<typeof PGlite>): Promise<string> => {
      const w = async (sql: string): Promise<string> =>
        String(((await db.query(sql)) as { rows: { w: unknown }[] }).rows[0].w);
      const shopfaehig = await w("select count(*)::text as w from public.skylanders s "
        + "where public.is_shop_eligible(s.sky_id)");
      const angebote = await w("select count(*)::text as w from public.shop_offers()");
      const md5 = await w("select md5(coalesce(string_agg(o.sky_id || '|' || o.condition || '|' "
        + "|| coalesce(o.price::text, ''), ';' order by o.sky_id, o.condition), '')) as w "
        + "from public.shop_offers() o");
      const sammelbar = await w("select count(*)::text as w from public.skylanders s "
        + "join public.categories c on c.id = s.category_id where s.is_active and s.catalog_visible "
        + "and not (c.name = any (public.non_collectible_categories()))");
      const overrides = await w("select count(*)::text as w from public.skylanders s "
        + "join public.categories c on c.id = s.category_id "
        + "where c.name = 'Spiele' and s.display_name_override is not null");
      return `array['shopfaehig=${shopfaehig}', 'angebote=${angebote}',\n`
        + `                                'angebote_md5=${md5}',\n`
        + `                                'sammelbar=${sammelbar}', 'spiele_overrides=${overrides}']`;
    };

    /* Lauf 1: angepasster Vertrag, muss durchlaufen. */
    const db1 = await bauen();
    const vertragAlt = ORIGINAL.slice(
      ORIGINAL.indexOf("array['shopfaehig=534'"),
      ORIGINAL.indexOf("] loop", ORIGINAL.indexOf("array['shopfaehig=534'")) + 1);
    const angepasst = join(process.cwd(), ".pglite-oneshot.sql");
    writeFileSync(angepasst, ORIGINAL.replace(vertragAlt, await messen(db1)));
    const lauf1 = await fahre(db1, angepasst, { klammer: false });

    const w1 = async (sql: string): Promise<string> =>
      String(((await db1.query(sql)) as { rows: { w: unknown }[] }).rows[0]?.w ?? "?");
    const spalte1 = await w1("select (count(*) = 1)::text as w from information_schema.columns "
      + "where table_schema = 'public' and table_name = 'skylanders' and column_name = 'item_type'");
    const sicherung1 = await w1("select md5(prosrc) as w from pg_proc "
      + "where proname = 'seller_business_backup'");

    /* Lauf 2: unveraendert, der Vertrag muss anschlagen. */
    const db2 = await bauen();
    const lauf2 = await fahre(db2, SKRIPT, { klammer: false });
    const spalte2 = await w1.call(null, "select 1 as w") === "1"
      ? String((((await db2.query("select (count(*) = 1)::text as w from information_schema.columns "
          + "where table_schema = 'public' and table_name = 'skylanders' "
          + "and column_name = 'item_type'")) as { rows: { w: unknown }[] }).rows[0].w))
      : "?";

    probe.push({
      name: "P21 das Staging-Skript läuft in einem Durchgang durch — und der Z0-Vertrag greift",
      ok: lauf1 === null && spalte1 === "true"
        && sicherung1 === "f6d08440707ba72a8040a8d1e666c092"
        && lauf2 !== null && lauf2.includes("Z0-Vertrag stimmt nicht mehr")
        && spalte2 === "false",
      sagt: lauf1 !== null ? `Lauf 1: ${lauf1}` : `Lauf 1 durch (item_type ${spalte1}, `
        + `Sicherung ${sicherung1.slice(0, 8)}…) · Lauf 2 ohne Anpassung: `
        + `${lauf2 ?? "DURCHGELAUFEN — Befund"} (item_type ${spalte2})`,
    });
  }

  /* =======================================================================
   * P22-P27 — ZUBEHOER WIRD EIN KATALOGARTIKEL (`0137`) UND DIE 21 PORTALE
   *           DER ARBEITSMAPPE (`0138`), ADR-0128 Schritt Z2 und Z3.
   *
   * ALLE SECHS FAHREN VOM STAND VOR DEM LAUF AUS. `frischNach0136()` stellt
   * ihn her: der Stand `0134` aus der Faltung, dann `0135` und `0136`. Das
   * war der Zustand, den `0137` am 2026-10-20 auf Staging vorgefunden hat —
   * und dass er dafuer gebraucht wird, zeigt P23. Staging steht seitdem auf
   * `0138`; dieser Probelauf baut den Ausgangszustand jedes Mal neu auf und
   * bleibt davon unberuehrt.
   *
   * DREI VON SECHS MUESSEN SCHEITERN. Eine Sicherung ist nur dann eine,
   * wenn sie auch anschlaegt.
   * ==================================================================== */

  /** Der Staging-Stand: 0134 aus der Faltung, dann 0135 und 0136. */
  /**
   * DREI ATTRAPPEN, DAMIT DIE BASELINE UEBERHAUPT MESSBAR IST (2026-10-25).
   *
   * Seit dem 2026-10-25 messen die Preflights zu `0142`/`0143` sieben
   * Geschaeftszahlen und uebergeben sie als eine Zeile an ihre
   * Nachkontrollen. Die Messung liest `shop_inventory.sale_released`
   * (`0139`), `skylanders.item_type` (`0135`) und `shop_offers().price`
   * (ebenfalls `0139` — davor hiess die Spalte `sale_price`). `frisch()`
   * setzt das Stub-Schema aber auf den Stand `0134` zurueck, und dort gibt
   * es keines von dreien.
   *
   * DIE SIEBEN MIGRATIONEN HIER ZU FAHREN GEHT NICHT: `0138` legt 21
   * Katalogzeilen an und bricht ohne die Serien `G, I, SA, SC, SF, T` ab,
   * die das Stub-Schema nicht mit Daten fuellt, und `0139` braucht eine
   * Identitaet auf `shop_inventory.id`. Beides sind Grenzen der erfundenen
   * Zeilen, keine der Migrationen — `P45`/`P46` bauen diese Fixtures eigens
   * auf und pruefen dort die ECHTE Projektion.
   *
   * HIER STEHT ETWAS ANDERES ZUR PRUEFUNG: die UEBERGABE der Baseline —
   * fehlt sie, ist sie abgeschnitten, vertauscht, manipuliert? Dafuer muss
   * die Messung LAUFEN, nicht richtig rechnen. Zwei Spalten und eine
   * Projektion in der FORM von `0135`/`0139`, ausdruecklich als Attrappe
   * benannt und ausdruecklich KEIN Nachweis ueber `shop_offers()`,
   * `item_type` oder `sale_released`.
   */
  async function attrappenFuerBaseline(db: InstanceType<typeof PGlite>): Promise<void> {
    await db.exec(`
      alter table public.shop_inventory
        add column if not exists sale_released boolean not null default false;
      alter table public.skylanders
        add column if not exists item_type text not null default 'figure';
      drop function if exists public.shop_offers();
      create function public.shop_offers()
      returns table (sky_id text, condition text, price numeric,
                     available boolean, delivery_scope text)
      language sql stable as $attrappe$
        select i.sky_id, i.condition, i.sale_price, true, null::text
          from public.shop_inventory i
         where i.is_listed;
      $attrappe$;`);
  }

  async function frischNach0136(): Promise<InstanceType<typeof PGlite>> {
    const db = await frisch();
    const f1 = await fahre(db, M135);
    if (f1 !== null) throw new Error(`Aufbau: 0135 scheiterte — ${f1}`);
    const f2 = await fahre(db, M136);
    if (f2 !== null) throw new Error(`Aufbau: 0136 scheiterte — ${f2}`);
    return db;
  }

  /**
   * Was das Stub-Schema nicht hat und `0138` braucht: sechs Serien und eine
   * Identitaet auf `categories.id`.
   *
   * DAS STUB-SCHEMA TRAEGT KEINE DEFAULTS UND KEINE SCHLUESSEL — es ist aus
   * den Migrationen abgeleitete reine Struktur. In der Wirklichkeit ist
   * `categories.id` `generated always as identity`; hier muss die Sequenz
   * nachgereicht werden, sonst bekaeme die Kategorie `Portale` die id NULL
   * und `0138` fiele mit „die Kategorie fehlt in Serie" ab — ein Befund des
   * Stubs und keiner der Migration. Dasselbe gilt fuer die sechs Serien: die
   * erfundenen Zeilen oben kennen nur `PROBE`.
   */
  async function serienUndIdentitaet(db: InstanceType<typeof PGlite>): Promise<void> {
    await db.exec(`
      create sequence if not exists public.z_kat_id_seq start 1000;
      alter table public.categories
        alter column id set default nextval('public.z_kat_id_seq');
      insert into public.series (code, label, release_year, position) values
        ('SA', 'Spyro''s Adventure', 2011, 0),
        ('G',  'Giants',             2012, 1),
        ('SF', 'Swap Force',         2013, 2),
        ('T',  'Trap Team',          2014, 3),
        ('SC', 'SuperChargers',      2015, 4),
        ('I',  'Imaginators',        2016, 5);`);
  }

  /* P22 — der gute Fall: 0137 auf dem Staging-Stand. */
  {
    const db = await frischNach0136();
    const w = async (sql: string): Promise<string> =>
      String(((await db.query(sql)) as { rows: Record<string, unknown>[] }).rows[0]?.w ?? "?");

    const angeboteVor = await w("select count(*)::text as w from public.shop_offers()");
    const sammelbarVor = await w(
      `select count(*)::text as w from public.skylanders s
         join public.categories c on c.id = s.category_id
        where s.is_active and s.catalog_visible
          and not (c.name = any (public.non_collectible_categories()))`);

    const lauf = await fahre(db, M137);

    const liste = await w("select array_to_string(public.non_collectible_categories(), ',') as w");
    const spalten = await w(
      `select string_agg(a.name, ',' order by a.ord) as w
         from (select unnest(p.proargnames) as name,
                      generate_subscripts(p.proargnames, 1) as ord
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = 'seller_import_catalog') a`);
    const anlegen = await w(
      `select (to_regprocedure('public.seller_create_catalog_item(text, text, text)')
                is not null)::text as w`);
    const angeboteNach = await w("select count(*)::text as w from public.shop_offers()");
    const sammelbarNach = await w(
      `select count(*)::text as w from public.skylanders s
         join public.categories c on c.id = s.category_id
        where s.is_active and s.catalog_visible
          and not (c.name = any (public.non_collectible_categories()))`);

    probe.push({
      name: "P22 0137 laeuft durch: fuenf Kategorienamen, acht Spalten, und kein Angebot bewegt sich",
      ok: lauf === null && liste === "Spiele,Portale,Bundles,Taschen,Zubehör"
        && spalten === "sky_id,name,series_code,category,display_name,"
          + "catalog_visible,is_active,item_type"
        && anlegen === "true" && angeboteNach === angeboteVor
        && sammelbarNach === sammelbarVor,
      sagt: lauf ?? `Liste "${liste}", Spalten "${spalten}", Anlegefunktion ${anlegen}, `
        + `Angebote ${angeboteVor} → ${angeboteNach}, sammelbar ${sammelbarVor} → ${sammelbarNach}`,
    });
  }

  /* P23 — 0137 OHNE 0135: die harte Reihenfolge, und nichts bleibt zurueck. */
  {
    const db = await frisch();
    const lauf = await fahre(db, M137);
    const anlegen = String((((await db.query(
      `select (to_regprocedure('public.seller_create_catalog_item(text, text, text)')
                is not null)::text as w`)) as { rows: { w: unknown }[] }).rows[0].w));
    const liste = String((((await db.query(
      "select array_to_string(public.non_collectible_categories(), ',') as w",
    )) as { rows: { w: unknown }[] }).rows[0].w));

    probe.push({
      name: "P23 0137 vor 0135 bricht ab, und weder Funktion noch Kategorieliste bleiben zurueck",
      ok: lauf !== null && lauf.includes("setzt 0135 voraus")
        && anlegen === "false" && liste === "Spiele",
      sagt: lauf === null
        ? "DURCHGELAUFEN — Befund"
        : `${lauf} · Anlegefunktion ${anlegen}, Liste "${liste}"`,
    });
  }

  /* P24 — 0137 bei BESETZTER Zubehoerkategorie: die Erweiterung waere eine
   * stillschweigende Entfernung aus Sammlung und Shop, also bricht sie ab. */
  {
    const db = await frischNach0136();
    await db.exec(`
      insert into public.categories (id, name, series_code) values (9, 'Portale', 'PROBE');
      insert into public.skylanders
             (sky_id, name, slug, series_code, category_id, is_active, catalog_visible,
              market_price, card_type, source, item_type)
      values ('PROBE-P', 'Ein Portal', 'ein-portal', 'PROBE', 9, true, true, 9,
              'standard', 'probe', 'figure');`);
    const lauf = await fahre(db, M137);

    probe.push({
      name: "P24 0137 bricht ab, wenn in einer Zubehoerkategorie schon eine Zeile steht",
      ok: lauf !== null && lauf.includes("stehen schon in einer der vier neuen"),
      sagt: lauf ?? "DURCHGELAUFEN — Befund",
    });
  }

  /* P25 — der gute Fall fuer 0138: 21 Portale, und keine Zahl bewegt sich. */
  {
    const db = await frischNach0136();
    const f137 = await fahre(db, M137);
    await serienUndIdentitaet(db);
    const w = async (sql: string): Promise<string> =>
      String(((await db.query(sql)) as { rows: Record<string, unknown>[] }).rows[0]?.w ?? "?");

    const angeboteVor = await w("select count(*)::text as w from public.shop_offers()");
    const sammelbarVor = await w(
      `select count(*)::text as w from public.skylanders s
         join public.categories c on c.id = s.category_id
        where s.is_active and s.catalog_visible
          and not (c.name = any (public.non_collectible_categories()))`);
    const seqVor = await w(
      `select coalesce((select last_value::text from pg_sequences
                         where schemaname = 'public' and sequencename = 'sky_id_seq'),
                       '(unbekannt)') as w`);

    const lauf = f137 ? "0137 scheiterte" : await fahre(db, M138);

    const portale = await w(
      `select count(*)::text as w from public.skylanders
        where sky_id between 'SKY-0615' and 'SKY-0642'`);
    const typen = await w(
      `select count(*)::text as w from public.skylanders
        where sky_id between 'SKY-0615' and 'SKY-0642' and item_type = 'portal'`);
    const kategorien = await w(
      "select count(*)::text as w from public.categories where name = 'Portale'");
    const shopfaehig = await w(
      `select count(*)::text as w from public.skylanders s
        where s.sky_id between 'SKY-0615' and 'SKY-0642'
          and public.is_shop_eligible(s.sky_id)`);
    const journal = await w(
      `select count(*)::text as w from public.catalog_admin_changes
        where entity = 'skylander' and field = 'created'
          and entity_id between 'SKY-0615' and 'SKY-0642'`);
    const angeboteNach = await w("select count(*)::text as w from public.shop_offers()");
    const sammelbarNach = await w(
      `select count(*)::text as w from public.skylanders s
         join public.categories c on c.id = s.category_id
        where s.is_active and s.catalog_visible
          and not (c.name = any (public.non_collectible_categories()))`);
    const seqNach = await w(
      `select coalesce((select last_value::text from pg_sequences
                         where schemaname = 'public' and sequencename = 'sky_id_seq'),
                       '(unbekannt)') as w`);

    probe.push({
      name: "P25 0138 legt 21 Portale an — kein Angebot, kein Nenner und keine Sequenz bewegt sich",
      ok: lauf === null && portale === "21" && typen === "21" && kategorien === "6"
        && shopfaehig === "0" && journal === "21"
        && angeboteNach === angeboteVor && sammelbarNach === sammelbarVor
        && seqNach === seqVor,
      sagt: lauf ?? `${portale} Portale (${typen} als portal), ${kategorien} Kategorien, `
        + `${shopfaehig} shopfaehig, ${journal} Journaleintraege, `
        + `Angebote ${angeboteVor} → ${angeboteNach}, sammelbar ${sammelbarVor} → `
        + `${sammelbarNach}, Sequenz ${seqVor} → ${seqNach}`,
    });
  }

  /* P26 — 0138 VOR 0137: ohne die erweiterte Kategorieliste waere das erste
   * Portal eine sammelbare, shopfaehige Figur. Also bricht es ab. */
  {
    const db = await frischNach0136();
    await serienUndIdentitaet(db);
    const lauf = await fahre(db, M138);
    const portale = String((((await db.query(
      `select count(*)::text as w from public.skylanders
        where sky_id between 'SKY-0615' and 'SKY-0642'`,
    )) as { rows: { w: unknown }[] }).rows[0].w));

    probe.push({
      name: "P26 0138 vor 0137 bricht ab, und keine Portalzeile bleibt zurueck",
      ok: lauf !== null && lauf.includes("setzt 0137 voraus") && portale === "0",
      sagt: lauf === null ? "DURCHGELAUFEN — Befund" : `${lauf} · ${portale} Portalzeilen`,
    });
  }

  /* P27 — DIE RUECKNAHMEN, UND IHRE REIHENFOLGE. `R0137` darf nicht
   * gelingen, solange ein Portal steht: ohne die erweiterte Kategorieliste
   * wuerde es sammelbar. Erst `R0138`, dann `R0137`. */
  {
    const db = await frischNach0136();
    const f137 = await fahre(db, M137);
    await serienUndIdentitaet(db);
    const f138 = f137 ? "0137 scheiterte" : await fahre(db, M138);

    const zuFrueh = await fahre(db, R137);
    const zurueck138 = await fahre(db, R138);
    const dann137 = await fahre(db, R137);

    const w = async (sql: string): Promise<string> =>
      String(((await db.query(sql)) as { rows: Record<string, unknown>[] }).rows[0]?.w ?? "?");
    const portale = await w(
      `select count(*)::text as w from public.skylanders
        where sky_id between 'SKY-0615' and 'SKY-0642'`);
    const liste = await w("select array_to_string(public.non_collectible_categories(), ',') as w");
    /* Das Journal bleibt — append-only, und das ist Absicht. */
    const journal = await w(
      `select count(*)::text as w from public.catalog_admin_changes
        where entity = 'skylander' and field = 'created'
          and entity_id between 'SKY-0615' and 'SKY-0642'`);

    probe.push({
      name: "P27 R0137 verweigert, solange ein Portal steht; in der Reihenfolge R0138, R0137 geht beides",
      ok: f138 === null && zuFrueh !== null
        && zuFrueh.includes("stehen in einer Zubehoerkategorie")
        && zurueck138 === null && dann137 === null
        && portale === "0" && liste === "Spiele" && journal === "21",
      sagt: f138 !== null ? `Aufbau: ${f138}` : `R0137 zu frueh: `
        + `${zuFrueh ?? "DURCHGELAUFEN — Befund"} · R0138 ${zurueck138 ?? "durch"} · `
        + `R0137 ${dann137 ?? "durch"} · ${portale} Portale, Liste "${liste}", `
        + `${journal} Journaleintraege bleiben`,
    });
  }

  /* P28 — DIE LAGERZEILE AUF EINEM SPIEL WIRD SICHTBAR, OHNE SHOPWARE ZU
   *        WERDEN (ADR-0128).
   *
   * Der Fall, den die Aufgabe ausdruecklich nennt: auf Staging haengen 13
   * Lagerzeilen an Spielen. Hier haengt eine an einem erfundenen Spiel, und
   * zwar die unangenehme Variante — `is_listed = true`, eine Altlast. Die
   * Pruefdatei muss sie als BENANNT melden (sie bekommt kuenftig einen Namen
   * in der Uebersicht) und gleichzeitig als NICHT shopfaehig und NICHT im
   * Angebot.
   *
   * Im Modus `keine`: die Zahl 13 ist der Staging-Wert, und die Zeilen hier
   * sind erfunden. Geprueft wird die STRUKTUR, nicht die Menge.
   */
  {
    const db = await frischNach0136();
    const w = async (sql: string): Promise<string> =>
      String(((await db.query(sql)) as { rows: Record<string, unknown>[] }).rows[0]?.w ?? "?");

    /* Eine Lagerzeile auf PROBE-4 — einem Spiel, das `0135` als `game`
       markiert hat —, gelistet und mit Bestand. */
    await db.exec(`
      insert into public.shop_inventory
             (sky_id, condition, is_listed, quantity, available_quantity, sale_price)
           values ('PROBE-4', 'loose', true, 3, 3, 19.90);`);

    const spiele = await w(
      "select count(*)::text as w from public.skylanders where item_type = 'game'");
    const eligible = await w(
      "select public.is_shop_eligible('PROBE-4')::text as w");
    const imAngebot = await w(
      "select count(*)::text as w from public.shop_offers() where sky_id = 'PROBE-4'");

    const flug = await pruefdatei(db, "inventory_accessories_readonly.sql",
      { vorher: "select set_config('skyisles.z0', 'keine', true);" });

    probe.push({
      name: "P28 eine gelistete Lagerzeile auf einem Spiel wird benannt — und ist trotzdem kein Angebot",
      ok: spiele === "2" && eligible === "false" && imAngebot === "0"
        && flug.abweichungen === "0",
      sagt: `${spiele} Spiele im Katalog, is_shop_eligible(PROBE-4) = ${eligible}, `
        + `${imAngebot} Angebote darauf, Pruefdatei 9999 = ${flug.abweichungen}`,
    });
  }

  /* P29 — UND DIE PRUEFDATEI SCHLAEGT AN, wenn die Trennung bricht.
   *
   * Eine Sicherung, die nur gruen werden kann, ist keine. Hier bekommt
   * dieselbe Zeile einen Artikeltyp, den `0135` shopfaehig machen wuerde —
   * `figure` in der Kategorie `Spiele` —, und damit muss Pruefung 305
   * („alle stehen in einer Kategorie Spiele" greift nicht mehr, weil die
   * Zeile als Figur zaehlt) beziehungsweise der Vertrag anschlagen.
   */
  {
    const db = await frischNach0136();
    await db.exec(`
      insert into public.shop_inventory
             (sky_id, condition, is_listed, quantity, available_quantity, sale_price)
           values ('PROBE-4', 'loose', true, 3, 3, 19.90);
      /* Eine KATEGORIE, die kein Spiel ist, mit einem Artikel, der als
         game markiert bleibt: damit widersprechen Kategorie und Artikeltyp
         einander, und Pruefung 305 muss das sehen. */
      insert into public.categories (id, name, series_code) values (7, 'Figuren 2', 'PROBE');
      update public.skylanders set category_id = 7 where sky_id = 'PROBE-4';
      update public.skylanders set item_type = 'game' where sky_id = 'PROBE-4';`);

    const flug = await pruefdatei(db, "inventory_accessories_readonly.sql",
      { vorher: "select set_config('skyisles.z0', 'keine', true);" });

    probe.push({
      name: "P29 und sie schlaegt an, wenn Kategorie und Artikeltyp einer Lagerzeile auseinanderlaufen",
      ok: flug.abweichungen !== "0" && flug.abweichungen !== "(keine Zeile 9999)",
      sagt: `Pruefdatei 9999 = ${flug.abweichungen} (erwartet > 0)`,
    });
  }

  /* P30 — DER MANUELLE STAGING-ABLAUF, IN EINEM DURCHGANG.
   *
   * `supabase/operations/staging-0137-0138.sql` ist das, was der Betreiber
   * wirklich einfuegt: eine Datei, eine Transaktion, beide Migrationen. Hier
   * laeuft sie gegen echtes PostgreSQL — zweimal, wie bei P21:
   *
   *   Lauf 1  mit dem Z0-Vertrag auf die Zahlen dieser Wegwerf-Instanz
   *           umgestellt: er muss DURCHLAUFEN, 21 Portale anlegen und sechs
   *           Kategorien, ohne ein Angebot zu bewegen.
   *   Lauf 2  unveraendert: der Vertrag ist auf die echten Staging-Zahlen
   *           geschrieben und muss ANSCHLAGEN, bevor irgendetwas entsteht.
   */
  {
    const SKRIPT = "supabase/operations/staging-0137-0138.sql";
    const ORIGINAL = readFileSync(SKRIPT, "utf8");

    /** Der Stand, den Staging fuehrt: 0132, dann 0135 und 0136. */
    const bauen = async (): Promise<InstanceType<typeof PGlite>> => {
      const fold0132 = funktionsfaltung([...PROBELAUF,
        "0133_paid_total_immutable.sql", "0134_purchase_item_source_row_visible.sql"]);
      const db = new PGlite();
      await stubAnwenden(db);
      /* Wie in `frisch()`: eine Huelle mit anderem Rueckgabetyp darf die
         gueltige Fassung nicht still verdraengen. */
      for (const [sig, { sql }] of fold0132) {
        try { await db.exec(sql + ";"); } catch (e) {
          const code = (e as { code?: string }).code;
          if (code !== "42723" && code !== "42P13") continue;   /* s. Stufe 3 */
          try {
            await db.exec(`drop function if exists public.${signaturOhneVorgaben(sig)} cascade;`);
            await db.exec(sql + ";");
          } catch { /* s. Stufe 3 */ }
        }
      }
      for (const s of kommentare) { try { await db.exec(s + ";"); } catch { /* s. Stufe 3 */ } }
      for (const s of zurueck) await db.exec(s);
      for (const s of anweisungen(ZEILEN)) await db.exec(s + ";");
      for (const s of anweisungen(STAND_0131)) await db.exec(s + ";");
      for (const sig of SENSIBEL) {
        try {
          await db.exec(`revoke all on function ${sig} from public, anon, authenticated, service_role;`);
        } catch { /* im Stub fehlt vielleicht eine Signatur */ }
      }
      /* Die sechs Serien und die Identitaet auf `categories.id` — was das
         Stub-Schema nicht mitbringt und `0138` braucht. */
      await serienUndIdentitaet(db);
      /* Und der Stand 0136, den der Lauf in A3 verlangt. */
      const f1 = await fahre(db, M135);
      if (f1 !== null) throw new Error(`P30 Aufbau: 0135 scheiterte — ${f1}`);
      const f2 = await fahre(db, M136);
      if (f2 !== null) throw new Error(`P30 Aufbau: 0136 scheiterte — ${f2}`);
      return db;
    };

    /** Der Vertragsblock, auf die Zahlen dieser Instanz umgestellt. */
    const messen = async (db: InstanceType<typeof PGlite>): Promise<string> => {
      const w = async (sql: string): Promise<string> =>
        String(((await db.query(sql)) as { rows: { w: unknown }[] }).rows[0].w);
      const shopfaehig = await w("select count(*)::text as w from public.skylanders s "
        + "where public.is_shop_eligible(s.sky_id)");
      const angebote = await w("select count(*)::text as w from public.shop_offers()");
      const md5 = await w("select md5(coalesce(string_agg(o.sky_id || '|' || o.condition || '|' "
        + "|| coalesce(o.price::text, ''), ';' order by o.sky_id, o.condition), '')) as w "
        + "from public.shop_offers() o");
      const sammelbar = await w("select count(*)::text as w from public.skylanders s "
        + "join public.categories c on c.id = s.category_id where s.is_active and s.catalog_visible "
        + "and not (c.name = any (public.non_collectible_categories()))");
      const overrides = await w("select count(*)::text as w from public.skylanders s "
        + "join public.categories c on c.id = s.category_id "
        + "where c.name = 'Spiele' and s.display_name_override is not null");
      return `array['shopfaehig=${shopfaehig}', 'angebote=${angebote}',\n`
        + `                                'angebote_md5=${md5}',\n`
        + `                                'sammelbar=${sammelbar}', `
        + `'spiele_overrides=${overrides}']`;
    };

    const db1 = await bauen();
    const vertragAlt = ORIGINAL.slice(
      ORIGINAL.indexOf("array['shopfaehig=534'"),
      ORIGINAL.indexOf("] loop", ORIGINAL.indexOf("array['shopfaehig=534'")) + 1);
    const angepasst = join(process.cwd(), ".pglite-oneshot-0137-0138.sql");
    writeFileSync(angepasst, ORIGINAL.replace(vertragAlt, await messen(db1)));
    const lauf1 = await fahre(db1, angepasst, { klammer: false });

    const w1 = async (sql: string): Promise<string> =>
      String(((await db1.query(sql)) as { rows: { w: unknown }[] }).rows[0]?.w ?? "?");
    const portale = await w1("select count(*)::text as w from public.skylanders "
      + "where sky_id between 'SKY-0615' and 'SKY-0642'");
    const kategorien = await w1(
      "select count(*)::text as w from public.categories where name = 'Portale'");
    const angebote1 = await w1("select count(*)::text as w from public.shop_offers()");
    const serie0637 = await w1(
      "select coalesce(max(series_code), '(keine)') as w from public.skylanders "
      + "where sky_id = 'SKY-0637'");
    const anlegen = await w1("select (to_regprocedure("
      + "'public.seller_create_catalog_item(text, text, text)') is not null)::text as w");

    /* Lauf 2: unveraendert, der Vertrag muss anschlagen — und VOR der
       ersten Zeile, die entstehen wuerde. */
    const db2 = await bauen();
    const lauf2 = await fahre(db2, SKRIPT, { klammer: false });
    const portale2 = String((((await db2.query(
      "select count(*)::text as w from public.skylanders "
      + "where sky_id between 'SKY-0615' and 'SKY-0642'")) as { rows: { w: unknown }[] })
      .rows[0].w));

    probe.push({
      name: "P30 der Staging-Ablauf fuer 0137+0138 laeuft in einem Durchgang — und der Z0-Vertrag greift",
      ok: lauf1 === null && portale === "21" && kategorien === "6" && angebote1 === "2"
        && serie0637 === "SF" && anlegen === "true"
        && lauf2 !== null && lauf2.includes("Z0-Vertrag stimmt nicht mehr")
        && portale2 === "0",
      sagt: lauf1 !== null ? `Lauf 1: ${lauf1}` : `Lauf 1 durch (${portale} Portale, `
        + `${kategorien} Kategorien, SKY-0637 = ${serie0637}, Angebote ${angebote1}, `
        + `Anlegefunktion ${anlegen}) · Lauf 2 ohne Anpassung: `
        + `${lauf2 ?? "DURCHGELAUFEN — Befund"} (${portale2} Portale)`,
    });
  }

  /* =======================================================================
   * P31/P32 — DIE PORTALZUORDNUNG UND IHRE RUECKNAHME
   *
   * `supabase/operations/staging-portal-assignment.sql` setzt auf 35
   * Einkaufspositionen eine `sky_id`. Es ist das einzige Stueck dieser
   * Arbeit, das GESCHAEFTSDATEN aendert — also faehrt es hier gegen echtes
   * PostgreSQL, zusammen mit seiner Ruecknahme.
   *
   * DIE ZEILEN SIND ERFUNDEN, die Formen die echten: elf Portalartikel mit
   * den Rohnamen der Arbeitsmappe, dazu Freitextpositionen in der
   * Verteilung von Staging (1/2/5/7/11/2/3/1/1/1/1 = 35) und zwei
   * Positionen, die NICHT getroffen werden duerfen.
   * ==================================================================== */
  {
    const SKRIPT = "supabase/operations/staging-portal-assignment.sql";
    const RUECK = "supabase/rollback/R_portal_assignment.sql";

    /** Die elf Paare, wie sie im Skript stehen. */
    const PAARE: [string, string, number][] = [
      ["SKY-0615", "84157790 (SA)", 1],
      ["SKY-0616", "83973080 (SA)", 2],
      ["SKY-0617", "83973080A Wireless (SA)", 5],
      ["SKY-0618", "0000502 (G)", 7],
      ["SKY-0619", "0000547 (SF)", 11],
      ["SKY-0620", "0000586 (T)", 2],
      ["SKY-0621", "0000655 (SC)", 3],
      ["SKY-0622", "0000726 (I)", 1],
      ["SKY-0624", "84151790 (SA)", 1],
      ["SKY-0627", "84704790 (SF)", 1],
      ["SKY-0637", "84721790 (SF, T, SC)", 1],
    ];

    const bauen = async (): Promise<InstanceType<typeof PGlite>> => {
      const db = await frischNach0136();
      /* DIE BELEGSPERRE, wie Staging sie fuehrt. Das Skript prueft sie in C8,
         und in einer Wegwerf-Instanz traegt eine neue Funktion sonst die
         Vorgaberechte — ein Befund des Stubs, keiner des Skripts. */
      for (const sig of SENSIBEL) {
        try {
          await db.exec(`revoke all on function ${sig} from public, anon, authenticated, service_role;`);
        } catch { /* im Stub fehlt vielleicht eine Signatur */ }
      }
      const f137 = await fahre(db, M137);
      if (f137 !== null) throw new Error(`P31 Aufbau: 0137 scheiterte — ${f137}`);
      await serienUndIdentitaet(db);
      const f138 = await fahre(db, M138);
      if (f138 !== null) throw new Error(`P31 Aufbau: 0138 scheiterte — ${f138}`);

      /* Ein Einkauf, und die 35 Freitextpositionen in der Verteilung von
         Staging. `source_row` gesetzt, Zustand `reconciled_legacy`, keine
         Bewegung — genau die Vorbedingungen, die das Skript verlangt. */
      await db.exec("insert into public.purchases (id, source, total_cost) "
        + "values (9001, 'excel_order_2026', 100.00);");
      let id = 500000;
      const zeilen: string[] = [];
      for (const [, name, n] of PAARE) {
        for (let i = 0; i < n; i++) {
          id += 1;
          zeilen.push(`(${id}, 9001, null, ${quote(name)}, 'reconciled_legacy', 'loose', ${id})`);
        }
      }
      /* UND ZWEI, DIE NICHT GETROFFEN WERDEN DUERFEN: ein fremder Rohname,
         und einer der elf Namen mit einer LAGERBEWEGUNG daran. */
      zeilen.push(`(${++id}, 9001, null, '1.0 - Sulley', 'reconciled_legacy', 'loose', ${id})`);
      await db.exec(
        "insert into public.purchase_items "
        + "(id, purchase_id, sky_id, raw_name, state, condition, source_row) values "
        + zeilen.join(", ") + ";");
      return db;
    };

    const w = async (db: InstanceType<typeof PGlite>, sql: string): Promise<string> =>
      String(((await db.query(sql)) as { rows: Record<string, unknown>[] }).rows[0]?.w ?? "?");

    const AUF_PORTALEN = "select count(*)::text as w from public.purchase_items pi "
      + "join public.skylanders s on s.sky_id = pi.sky_id where s.item_type = 'portal'";
    const FREITEXT = "select count(*)::text as w from public.purchase_items where sky_id is null";
    const FREMD = "select coalesce(max(sky_id), '(null)') as w from public.purchase_items "
      + "where raw_name = '1.0 - Sulley'";

    /* P31 — der gute Fall, und danach die Ruecknahme. */
    {
      const db = await bauen();
      const vorPortale = await w(db, AUF_PORTALEN);
      const vorFrei = await w(db, FREITEXT);
      const vorBeweg = await w(db, "select count(*)::text as w from public.inventory_movements");

      const lauf = await fahre(db, SKRIPT, { klammer: false });

      const nachPortale = await w(db, AUF_PORTALEN);
      const nachFrei = await w(db, FREITEXT);
      const nachBeweg = await w(db, "select count(*)::text as w from public.inventory_movements");
      const fremd = await w(db, FREMD);
      /* Der Rohname MUSS stehengeblieben sein — er ist der Herkunftsnachweis. */
      const rohnamen = await w(db,
        "select count(*)::text as w from public.purchase_items pi "
        + "join public.skylanders s on s.sky_id = pi.sky_id "
        + "where s.item_type = 'portal' and pi.raw_name = s.name");
      /* Und je Artikel die erwartete Zahl. */
      const verteilung = await w(db,
        "select string_agg(sky_id || '=' || n::text, ',' order by sky_id) as w from ("
        + "select pi.sky_id, count(*) as n from public.purchase_items pi "
        + "join public.skylanders s on s.sky_id = pi.sky_id "
        + "where s.item_type = 'portal' group by pi.sky_id) x");
      const erwartet = PAARE.map(([sky, , n]) => `${sky}=${n}`).join(",");

      const zurueck = lauf === null ? await fahre(db, RUECK, { klammer: false }) : "nicht gefahren";
      const endPortale = await w(db, AUF_PORTALEN);
      const endFrei = await w(db, FREITEXT);

      probe.push({
        name: "P31 die Portalzuordnung setzt genau 35 SKY-IDs, laesst alles andere stehen — und nimmt sich zurueck",
        ok: lauf === null && vorPortale === "0" && nachPortale === "35"
          && vorFrei === "36" && nachFrei === "1"
          && nachBeweg === vorBeweg && fremd === "(null)" && rohnamen === "35"
          && verteilung === erwartet
          && zurueck === null && endPortale === "0" && endFrei === "36",
        sagt: lauf ?? `Portale ${vorPortale} → ${nachPortale}, Freitext ${vorFrei} → ${nachFrei}, `
          + `Bewegungen ${vorBeweg} → ${nachBeweg}, fremde Zeile ${fremd}, `
          + `${rohnamen}/35 Rohnamen unveraendert · Ruecknahme ${zurueck ?? "durch"}: `
          + `Portale ${endPortale}, Freitext ${endFrei}`,
      });
    }

    /* P32 — und sie bricht ab, wenn die Datenlage nicht stimmt.
     *
     * Eine Freitextposition mehr mit einem der elf Rohnamen: dann sind es 36
     * statt 35, und das Skript darf NICHT raten, welche gemeint ist. */
    {
      const db = await bauen();
      await db.exec("insert into public.purchase_items "
        + "(id, purchase_id, sky_id, raw_name, state, condition, source_row) "
        + "values (599999, 9001, null, '0000547 (SF)', 'reconciled_legacy', 'loose', 599999);");
      const lauf = await fahre(db, SKRIPT, { klammer: false });
      const portale = await w(db, AUF_PORTALEN);

      /* Und der Fall mit einer Lagerbewegung: dieselbe Bedingung, mit der
         `seller_set_purchase_item_sky` sich schuetzt. */
      const db2 = await bauen();
      await db2.exec("insert into public.shop_inventory (id, sky_id, condition, quantity) "
        + "values (9500, 'PROBE-1', 'loose', 1);");
      await db2.exec("insert into public.inventory_movements (id, inventory_id, delta, reason) "
        + "values (9500, 9500, 1, 'purchase');");
      await db2.exec("update public.purchase_items set movement_id = 9500 "
        + "where raw_name = '0000726 (I)';");
      const lauf2 = await fahre(db2, SKRIPT, { klammer: false });
      const portale2 = await w(db2, AUF_PORTALEN);

      probe.push({
        name: "P32 sie bricht ab, wenn eine Position zuviel da ist oder eine Lagerbewegung haengt",
        ok: lauf !== null && lauf.includes("ABBRUCH A5") && portale === "0"
          && lauf2 !== null && lauf2.includes("ABBRUCH A6") && portale2 === "0",
        sagt: `zu viele: ${lauf ?? "DURCHGELAUFEN — Befund"} (${portale} zugeordnet) · `
          + `mit Bewegung: ${lauf2 ?? "DURCHGELAUFEN — Befund"} (${portale2} zugeordnet)`,
      });
    }
  }

  /* P33 — DIE FREIGABE DER 21 PORTALE, und ihre Ruecknahme.
   *
   * Die Zusicherung, die zaehlt: sichtbar heisst NICHT sammelbar und NICHT
   * verkaeuflich. Hier steht daneben eine ausgeblendete FIGUR, die
   * ausgeblendet bleiben muss — eine pauschale Freigabe faellt damit auf.
   */
  {
    const SKRIPT = "supabase/operations/staging-portal-release.sql";
    const RUECK = "supabase/rollback/R_portal_release.sql";
    const db = await frischNach0136();
    const f137 = await fahre(db, M137);
    if (f137 !== null) throw new Error(`P33 Aufbau: 0137 scheiterte — ${f137}`);
    await serienUndIdentitaet(db);
    const f138 = await fahre(db, M138);
    if (f138 !== null) throw new Error(`P33 Aufbau: 0138 scheiterte — ${f138}`);
    /* Eine ausgeblendete FIGUR — sie darf die Freigabe nicht mitnehmen. */
    await db.exec("update public.skylanders set catalog_visible = false "
      + "where sky_id = 'PROBE-1';");

    const w = async (sql: string): Promise<string> =>
      String(((await db.query(sql)) as { rows: Record<string, unknown>[] }).rows[0]?.w ?? "?");
    const SICHTBAR = "select count(*)::text as w from public.skylanders "
      + "where item_type = 'portal' and catalog_visible";
    const SAMMELBAR = "select count(*)::text as w from public.skylanders s "
      + "join public.categories c on c.id = s.category_id where s.is_active and s.catalog_visible "
      + "and not (c.name = any (public.non_collectible_categories()))";

    const vorSicht = await w(SICHTBAR);
    const vorSammel = await w(SAMMELBAR);
    const vorAngebote = await w("select count(*)::text as w from public.shop_offers()");

    const lauf = await fahre(db, SKRIPT, { klammer: false });

    const nachSicht = await w(SICHTBAR);
    const nachSammel = await w(SAMMELBAR);
    const nachAngebote = await w("select count(*)::text as w from public.shop_offers()");
    const figurVersteckt = await w(
      "select catalog_visible::text as w from public.skylanders where sky_id = 'PROBE-1'");
    const shopfaehig = await w("select count(*)::text as w from public.skylanders s "
      + "where s.item_type = 'portal' and public.is_shop_eligible(s.sky_id)");

    const zurueck = lauf === null ? await fahre(db, RUECK, { klammer: false }) : "nicht gefahren";
    const endSicht = await w(SICHTBAR);

    probe.push({
      name: "P33 die Freigabe macht 21 Portale sichtbar — und weder sammelbar noch verkaeuflich",
      ok: lauf === null && vorSicht === "0" && nachSicht === "21"
        && nachSammel === vorSammel && nachAngebote === vorAngebote
        && figurVersteckt === "false" && shopfaehig === "0"
        && zurueck === null && endSicht === "0",
      sagt: lauf ?? `sichtbar ${vorSicht} → ${nachSicht}, sammelbar ${vorSammel} → `
        + `${nachSammel}, Angebote ${vorAngebote} → ${nachAngebote}, shopfaehige Portale `
        + `${shopfaehig}, die ausgeblendete Figur bleibt ausgeblendet (${figurVersteckt}) · `
        + `Ruecknahme ${zurueck ?? "durch"}: sichtbar ${endSicht}`,
    });
  }

  /* ====================================================================
   * P34–P37 — 0139: ZUBEHOER DARF VERKAUFT WERDEN, ABER NUR STUECK FUER STUECK
   *
   * Vier Durchgaenge, und jeder prueft eine andere Zusicherung:
   *
   *   P34  die Migration veroeffentlicht NICHTS — auch nicht die Altlast
   *        aus `is_listed = true` mit Preis. Und sie nimmt sich zurueck.
   *   P35  eine freigegebene Portalposition wird wirklich zum Angebot,
   *        und das Zuruecknehmen nimmt es wieder fort.
   *   P36  ein Spiel OHNE USK-Kennzeichnung bleibt draussen, auch
   *        freigegeben, auch bepreist, auch mit Bestand.
   *   P37  die Betriebsfunktion lehnt ab, was sie ablehnen muss.
   * ==================================================================== */
  {
    /** Der Stand nach 0138 — der Ausgangspunkt jedes der vier Durchgaenge. */
    async function frischNach0138(): Promise<InstanceType<typeof PGlite>> {
      const db = await frischNach0136();
      const f137 = await fahre(db, M137);
      if (f137 !== null) throw new Error(`Aufbau: 0137 scheiterte — ${f137}`);
      await serienUndIdentitaet(db);
      const f138 = await fahre(db, M138);
      if (f138 !== null) throw new Error(`Aufbau: 0138 scheiterte — ${f138}`);
      /*
       * EINE IDENTITAET AUF `shop_inventory.id`, aus demselben Grund wie bei
       * `categories.id` (siehe `serienUndIdentitaet`): das Stub-Schema ist
       * reine Struktur und traegt keine Defaults. In der Wirklichkeit ist
       * `id` `generated always as identity`; hier bliebe sie NULL — und
       * `is_position_sellable(NULL)` waere fuer jede Zeile `false`. Das waere
       * ein Befund des Stubs und keiner der Migration.
       */
      await db.exec(`
        create sequence if not exists public.z_inv_id_seq start 1000;
        alter table public.shop_inventory
          alter column id set default nextval('public.z_inv_id_seq');
        update public.shop_inventory set id = nextval('public.z_inv_id_seq')
         where id is null;`);
      return db;
    }

    const wert = async (db: InstanceType<typeof PGlite>, sql: string): Promise<string> =>
      String(((await db.query(sql)) as { rows: Record<string, unknown>[] }).rows[0]?.w ?? "?");
    /** Eine Anweisung fahren und die Fehlermeldung zurueckgeben — oder null. */
    const fehlschlag = async (db: InstanceType<typeof PGlite>, sql: string):
      Promise<string | null> => {
      try { await db.exec(sql); return null; }
      catch (e) { return e instanceof Error ? e.message : String(e); }
    };

    const ANGEBOTE = "select count(*)::text as w from public.shop_offers()";
    const ZUBEHOERANGEBOTE = "select count(*)::text as w from public.shop_offers() o "
      + "join public.skylanders s on s.sky_id = o.sky_id where s.item_type <> 'figure'";
    const SAMMELBAR = "select count(*)::text as w from public.skylanders s "
      + "join public.categories c on c.id = s.category_id where s.is_active "
      + "and not (c.name = any (public.non_collectible_categories()))";
    /* Die Altlast, in der Form, die `0003` erzwingt: `is_listed` ohne Preis
       ist durch den CHECK verboten, also hat jede gelistete Zeile einen. */
    const ALTLAST = "insert into public.shop_inventory "
      + "(sky_id, condition, is_listed, quantity, available_quantity, sale_price) "
      + "values ('PROBE-4', 'loose', true, 3, 3, 9.99);";
    const PORTALBESTAND = "insert into public.shop_inventory "
      + "(sky_id, condition, is_listed, quantity, available_quantity, sale_price) "
      + "values ('SKY-0615', 'loose', true, 2, 2, 24.90);";

    /* P34 — die Migration selbst. */
    {
      const db = await frischNach0138();
      await db.exec(ALTLAST);
      const vorAngebote = await wert(db, ANGEBOTE);
      const vorSammel = await wert(db, SAMMELBAR);
      const vorShopfaehig = await wert(db,
        "select count(*)::text as w from public.skylanders s "
        + "where public.is_shop_eligible(s.sky_id)");

      const lauf = await fahre(db, M139);

      const nachAngebote = lauf === null ? await wert(db, ANGEBOTE) : "-";
      const zubehoer = lauf === null ? await wert(db, ZUBEHOERANGEBOTE) : "-";
      const nachSammel = lauf === null ? await wert(db, SAMMELBAR) : "-";
      const nachShopfaehig = lauf === null ? await wert(db,
        "select count(*)::text as w from public.skylanders s "
        + "where public.is_shop_eligible(s.sky_id)") : "-";
      const freigegeben = lauf === null ? await wert(db,
        "select count(*)::text as w from public.shop_inventory where sale_released") : "-";
      /* Die Altlastzeile behaelt ihre Listung — 0139 fasst sie nicht an. */
      const altlastGelistet = lauf === null ? await wert(db,
        "select is_listed::text as w from public.shop_inventory where sky_id = 'PROBE-4'") : "-";

      const zurueck = lauf === null ? await fahre(db, R139) : "nicht gefahren";
      const spalteFort = zurueck === null ? await wert(db,
        "select (count(*) = 0)::text as w from information_schema.columns "
        + "where table_schema = 'public' and table_name = 'shop_inventory' "
        + "and column_name = 'sale_released'") : "-";
      const endAngebote = zurueck === null ? await wert(db, ANGEBOTE) : "-";

      probe.push({
        name: "P34 0139 veroeffentlicht nichts — auch nicht die gelistete, bepreiste Altlast",
        ok: lauf === null && nachAngebote === vorAngebote && zubehoer === "0"
          && nachSammel === vorSammel && nachShopfaehig === vorShopfaehig
          && freigegeben === "0" && altlastGelistet === "true"
          && zurueck === null && spalteFort === "true" && endAngebote === vorAngebote,
        sagt: lauf ?? `Angebote ${vorAngebote} → ${nachAngebote}, davon Zubehoer ${zubehoer}, `
          + `freigegebene Positionen ${freigegeben}, shopfaehig ${vorShopfaehig} → `
          + `${nachShopfaehig}, sammelbar ${vorSammel} → ${nachSammel}, die Altlast bleibt `
          + `gelistet (${altlastGelistet}) · Ruecknahme ${zurueck ?? "durch"}: Spalte fort `
          + `${spalteFort}, Angebote ${endAngebote}`,
      });
    }

    /* P35 — eine Portalposition, freigegeben und wieder zurueckgenommen. */
    {
      const db = await frischNach0138();
      const f = await fahre(db, M139);
      if (f !== null) throw new Error(`P35 Aufbau: 0139 scheiterte — ${f}`);
      await db.exec(PORTALBESTAND);

      /* 0138 legt die Portale mit `catalog_visible = false` an — die
         oeffentliche Freigabe war ein eigener Schritt. Damit prueft dieser
         Durchgang beide Richtungen auf einmal. */
      const versteckt = await wert(db, ZUBEHOERANGEBOTE);
      await db.exec("update public.skylanders set catalog_visible = true "
        + "where sky_id = 'SKY-0615';");
      /* SICHTBAR ALLEIN BEWIRKT KEINE FREIGABE — Punkt 1 des Auftrags. */
      const ohneFreigabe = await wert(db, ZUBEHOERANGEBOTE);
      await db.exec("update public.shop_inventory set sale_released = true "
        + "where sky_id = 'SKY-0615';");
      /* UND FREIGEGEBEN ALLEIN AUCH NICHT: ohne Angabe zum Lieferumfang
         bleibt das Angebot aus. */
      const ohneUmfang = await wert(db, ZUBEHOERANGEBOTE);
      await db.exec("update public.shop_inventory set delivery_scope = 'portal_cable' "
        + "where sky_id = 'SKY-0615';");
      const mitFreigabe = await wert(db, ZUBEHOERANGEBOTE);
      /* Und der Lieferumfang steht im Angebot, damit ihn jemand lesen kann. */
      const umfangImAngebot = await wert(db,
        "select coalesce(delivery_scope, '(null)') as w from public.shop_offers() "
        + "where sky_id = 'SKY-0615'");
      const umfangFigur = await wert(db,
        "select count(*)::text as w from public.shop_offers() o "
        + "join public.skylanders s on s.sky_id = o.sky_id "
        + "where s.item_type = 'figure' and o.delivery_scope is not null");
      /* Und umgekehrt: freigegeben, aber aus dem Katalog genommen. */
      await db.exec("update public.skylanders set catalog_visible = false "
        + "where sky_id = 'SKY-0615';");
      const wiederVersteckt = await wert(db, ZUBEHOERANGEBOTE);
      await db.exec("update public.skylanders set catalog_visible = true "
        + "where sky_id = 'SKY-0615';");
      const preis = await wert(db, "select price::text as w from public.shop_offers() "
        + "where sky_id = 'SKY-0615'");
      const sammelbar = await wert(db, SAMMELBAR);
      /* Und die Verfuegbarkeitsfrage sagt jetzt ja — dieselbe Tuer, die der
         Warenkorb fragt. */
      const kaufbar = await wert(db,
        "select public.shop_quantity_available('SKY-0615', 'loose', 1)::text as w");
      await db.exec("update public.shop_inventory set sale_released = false "
        + "where sky_id = 'SKY-0615';");
      const zurueck = await wert(db, ZUBEHOERANGEBOTE);
      const kaufbarDanach = await wert(db,
        "select public.shop_quantity_available('SKY-0615', 'loose', 1)::text as w");

      probe.push({
        name: "P35 eine freigegebene Portalposition wird zum Angebot — und die Ruecknahme nimmt es fort",
        ok: versteckt === "0" && ohneFreigabe === "0" && ohneUmfang === "0"
          && mitFreigabe === "1" && umfangImAngebot === "portal_cable"
          && umfangFigur === "0"
          && wiederVersteckt === "0" && preis === "24.90"
          && kaufbar === "true" && zurueck === "0" && kaufbarDanach === "false"
          && sammelbar === await wert(db, SAMMELBAR),
        sagt: `versteckt+ungefreigegeben ${versteckt}, nur sichtbar ${ohneFreigabe}, `
          + `freigegeben ohne Lieferumfang ${ohneUmfang}, vollstaendig ${mitFreigabe} `
          + `(Preis ${preis}, Lieferumfang ${umfangImAngebot}, Figurenangebote mit `
          + `Lieferumfang ${umfangFigur}), freigegeben aber versteckt ${wiederVersteckt}, `
          + `shop_quantity_available ${kaufbar} → ${kaufbarDanach}, nach Ruecknahme `
          + `${zurueck}, sammelbar ${sammelbar} unveraendert`,
      });
    }

    /* P36 — ein Spiel ohne Alterskennzeichnung bleibt draussen. */
    {
      const db = await frischNach0138();
      const f = await fahre(db, M139);
      if (f !== null) throw new Error(`P36 Aufbau: 0139 scheiterte — ${f}`);
      await db.exec(ALTLAST);
      /* Alles erfuellt — gelistet, bepreist, Bestand, FREIGEGEBEN. Es fehlt
         allein die USK-Angabe. */
      await db.exec("update public.shop_inventory set sale_released = true, "
        + "delivery_scope = 'disc_only' where sky_id = 'PROBE-4';");

      const ohneUsk = await wert(db, ZUBEHOERANGEBOTE);
      const grundOhne = await wert(db,
        "select coalesce(reason, '(kein Grund)') as w from public.admin_shop_listing_audit() "
        + "where sky_id = 'PROBE-4'").catch(() => "(nicht lesbar)");
      await db.exec("update public.skylanders set usk_rating = 6 where sky_id = 'PROBE-4';");
      const mitUsk = await wert(db, ZUBEHOERANGEBOTE);
      /* Und eine erfundene Einstufung laesst der CHECK nicht zu. */
      const unsinn = await fehlschlag(db,
        "update public.skylanders set usk_rating = 7 where sky_id = 'PROBE-4';");
      /*
       * UND „mit Originalhuelle" IST ZULAESSIG — auch an einer Position
       * mit dem einen SkyIsles-Zustand (ADR-0130). Ein Spiel mit Huelle
       * ist genauso verkaeuflich wie eines ohne; die frueher hier
       * gepruefte Kopplung ist aufgehoben.
       */
      const huelleLose = await fehlschlag(db,
        "update public.shop_inventory set delivery_scope = 'disc_case' "
        + "where sky_id = 'PROBE-4';");
      const mitHuelleAngebot = await wert(db, ZUBEHOERANGEBOTE);
      const huelleImAngebot = await wert(db,
        "select coalesce(delivery_scope, '(null)') as w from public.shop_offers() "
        + "where sky_id = 'PROBE-4'");
      /* Ein Portalvokabular an einem Spiel laesst der Tabellen-CHECK zwar zu
         (er kennt den Artikeltyp nicht) — die Setzfunktion nicht, siehe P37. */
      const unbekannterUmfang = await fehlschlag(db,
        "update public.shop_inventory set delivery_scope = 'disc_box' "
        + "where sky_id = 'PROBE-4';");

      probe.push({
        name: "P36 ohne USK bleibt ein Spiel draussen — mit Originalhuelle ist es verkaeuflich",
        ok: ohneUsk === "0" && mitUsk === "1" && unsinn !== null
          && huelleLose === null && mitHuelleAngebot === "1"
          && huelleImAngebot === "disc_case" && unbekannterUmfang !== null,
        sagt: `ohne USK ${ohneUsk} Angebote (Grund: ${grundOhne}), mit USK 6 ${mitUsk}; `
          + `USK 7 abgelehnt (${unsinn === null ? "NEIN — der CHECK fehlt" : "ja"}), `
          + `mit Originalhuelle ${huelleLose === null ? "zulaessig" : `ABGELEHNT: ${huelleLose}`} `
          + `→ ${mitHuelleAngebot} Angebot mit Lieferumfang ${huelleImAngebot}, `
          + `unbekannter Lieferumfang abgelehnt `
          + `(${unbekannterUmfang === null ? "NEIN" : "ja"})`,
      });
    }

    /* P37 — die Betriebsfunktion lehnt ab, was sie ablehnen muss.
     *
     * `can_operate_active_seller()` liest `auth.uid()`, und das gibt es in
     * einer Wegwerfinstanz nicht. Sie wird deshalb fuer diesen Durchgang
     * durch eine Fassung ersetzt, die `true` sagt — so wird geprueft, was
     * HINTER der Rechteschranke steht. Dass die Schranke selbst da ist,
     * prueft der Textvergleich in `accessory-sale.test.ts`.
     */
    {
      const db = await frischNach0138();
      const f = await fahre(db, M139);
      if (f !== null) throw new Error(`P37 Aufbau: 0139 scheiterte — ${f}`);
      await db.exec(ALTLAST);
      await db.exec(PORTALBESTAND);
      await db.exec("update public.skylanders set catalog_visible = true "
        + "where sky_id = 'SKY-0615';");
      await db.exec("create or replace function public.can_operate_active_seller() "
        + "returns boolean language sql stable as $fn$ select true $fn$;");

      const figur = await fehlschlag(db,
        "select public.seller_set_sale_release('PROBE-2', 'loose', true);");
      const spielOhneUsk = await fehlschlag(db,
        "select public.seller_set_sale_release('PROBE-4', 'loose', true);");
      const unbekannt = await fehlschlag(db,
        "select public.seller_set_sale_release('SKY-0616', 'loose', true);");

      /* ---- der Lieferumfang, bevor das Portal freigegeben werden kann ---- */
      const umfangFigur = await fehlschlag(db,
        "select public.seller_set_delivery_scope('PROBE-2', 'loose', 'disc_only');");
      const umfangFalsch = await fehlschlag(db,
        "select public.seller_set_delivery_scope('SKY-0615', 'loose', 'disc_only');");
      /* „Mit Originalhuelle" ist zulaessig und fuehrt zu einem Angebot. */
      const umfangHuelle = await fehlschlag(db,
        "select public.seller_set_delivery_scope('PROBE-4', 'loose', 'disc_case');");
      const portalOhneUmfang = await fehlschlag(db,
        "select public.seller_set_sale_release('SKY-0615', 'loose', true);");
      const umfangOk = await fehlschlag(db,
        "select public.seller_set_delivery_scope('SKY-0615', 'loose', 'portal_cable');");

      const portal = await fehlschlag(db,
        "select public.seller_set_sale_release('SKY-0615', 'loose', true);");
      const angebote = await wert(db, ZUBEHOERANGEBOTE);

      /* ---- ein Spiel MIT Originalhuelle ist verkaeuflich (ADR-0130) ---- */
      await db.exec("update public.skylanders set usk_rating = 6 where sky_id = 'PROBE-4';");
      const spielMitHuelle = await fehlschlag(db,
        "select public.seller_set_sale_release('PROBE-4', 'loose', true);");
      const angeboteMitHuelle = await wert(db, ZUBEHOERANGEBOTE);
      await db.exec("select public.seller_set_sale_release('PROBE-4', 'loose', false);");

      /* ---- ohne Preis keine Freigabe ---- */
      await db.exec("update public.shop_inventory set sale_price = null, is_listed = false "
        + "where sky_id = 'SKY-0615';");
      await db.exec("select public.seller_set_sale_release('SKY-0615', 'loose', false);");
      const ohnePreis = await fehlschlag(db,
        "select public.seller_set_sale_release('SKY-0615', 'loose', true);");
      await db.exec("update public.shop_inventory set sale_price = 24.90, is_listed = true "
        + "where sky_id = 'SKY-0615';");
      await db.exec("select public.seller_set_sale_release('SKY-0615', 'loose', true);");

      /* ---- und ein Spiel ab 18 wird gar nicht erst freigegeben ---- */
      await db.exec("update public.skylanders set usk_rating = 18 where sky_id = 'PROBE-4';");
      const ab18 = await fehlschlag(db,
        "select public.seller_set_sale_release('PROBE-4', 'loose', true);");
      /* Das Zuruecknehmen eines Spiels geht AUCH ohne USK — ein Riegel, der
         das Abschalten verhindert, zeigt in die falsche Richtung. */
      const abschalten = await fehlschlag(db,
        "select public.seller_set_sale_release('PROBE-4', 'loose', false);");

    const sagtNein = (x: string | null) => (x === null ? "DURCHGELASSEN" : "abgelehnt");
    probe.push({
        name: "P37 die Freigabe- und Lieferumfangsfunktion lehnen ab, was sie ablehnen muessen",
        ok: figur !== null && spielOhneUsk !== null && unbekannt !== null
          && umfangFigur !== null && umfangFalsch !== null && umfangHuelle === null
          && portalOhneUmfang !== null && umfangOk === null
          && portal === null && angebote === "1"
          && spielMitHuelle === null && angeboteMitHuelle === "2"
          && ohnePreis !== null && ab18 !== null && abschalten === null,
        sagt: `Freigabe: Figur ${sagtNein(figur)}, Spiel ohne USK ${sagtNein(spielOhneUsk)}, `
          + `unbekannte Position ${sagtNein(unbekannt)}, Portal ohne Lieferumfang `
          + `${sagtNein(portalOhneUmfang)}, Spiel ab USK 18 ${sagtNein(ab18)} · `
          + `ohne Preis ${sagtNein(ohnePreis)} · Lieferumfang: Figur ${sagtNein(umfangFigur)}, `
          + `Spielvokabular am Portal ${sagtNein(umfangFalsch)}, Originalhuelle `
          + `${umfangHuelle === null ? "zulaessig" : `ABGELEHNT: ${umfangHuelle}`}, `
          + `portal_cable ${umfangOk === null ? "gesetzt" : `ABGELEHNT: ${umfangOk}`} · `
          + `danach Portal ${portal === null ? "freigegeben" : `ABGELEHNT: ${portal}`} → `
          + `${angebote} Angebot, mit dem Spiel MIT Huelle ${angeboteMitHuelle}; `
          + `Abschalten ohne USK ${abschalten === null ? "geht" : "GESPERRT"}`,
      });
    }
  }

  /* P38 — 0140: die Sicherung lernt zwei Felder, und sonst nichts.
   *
   * Sie SETZT 0139 VORAUS, und das wird hier mitgeprueft: erst der Lauf
   * ohne 0139 (muss scheitern), dann der mit.
   */
  {
    const db = await frisch();
    const f135 = await fahre(db, M135);
    if (f135 !== null) throw new Error(`P38 Aufbau: 0135 scheiterte — ${f135}`);
    const f136 = await fahre(db, M136);
    if (f136 !== null) throw new Error(`P38 Aufbau: 0136 scheiterte — ${f136}`);
    /* Die Identitaet auf `shop_inventory.id`, aus demselben Grund wie in
       `frischNach0138()`: das Stub-Schema traegt keine Defaults. */
    await db.exec(`
      create sequence if not exists public.z_inv_id_seq start 1000;
      alter table public.shop_inventory
        alter column id set default nextval('public.z_inv_id_seq');
      update public.shop_inventory set id = nextval('public.z_inv_id_seq')
       where id is null;`);

    const w = async (sql: string): Promise<string> =>
      String(((await db.query(sql)) as { rows: Record<string, unknown>[] }).rows[0]?.w ?? "?");
    const FELDER = "select (length(prosrc) - length(replace(prosrc, E'\\n', '')))::text as w "
      + "from pg_proc where oid = to_regprocedure('public.seller_business_backup()')";

    /* OHNE 0139 muss sie abbrechen — und zwar mit einem Satz, der sagt was fehlt. */
    const ohne0139 = await fahre(db, M140);

    const f139 = await fahre(db, M139);
    if (f139 !== null) throw new Error(`P38 Aufbau: 0139 scheiterte — ${f139}`);
    const zeilenVor = await w(FELDER);
    const mit0139 = await fahre(db, M140);
    const kennt = mit0139 === null ? await w(
      "select (position('sale_released' in prosrc) > 0 "
      + "and position('delivery_scope' in prosrc) > 0 "
      + "and position('usk_rating' in prosrc) > 0)::text as w from pg_proc "
      + "where oid = to_regprocedure('public.seller_business_backup()')") : "-";
    const zeilenNach = mit0139 === null ? await w(FELDER) : "-";

    const zurueck = mit0139 === null ? await fahre(db, R140) : "nicht gefahren";
    const wiederOhne = zurueck === null ? await w(
      "select (position('sale_released' in prosrc) = 0)::text as w from pg_proc "
      + "where oid = to_regprocedure('public.seller_business_backup()')") : "-";

    probe.push({
      name: "P38 0140 braucht 0139, nimmt dann genau drei Felder auf — und nimmt sie zurueck",
      ok: ohne0139 !== null && ohne0139.includes("setzt 0139 voraus")
        && mit0139 === null && kennt === "true"
        && Number(zeilenNach) === Number(zeilenVor) + 3
        && zurueck === null && wiederOhne === "true",
      sagt: `ohne 0139: ${ohne0139 === null ? "DURCHGELAUFEN" : "abgebrochen"}; `
        + `mit 0139: ${mit0139 ?? "durch"}, beide Felder da (${kennt}), Rumpfzeilen `
        + `${zeilenVor} → ${zeilenNach} · Ruecknahme ${zurueck ?? "durch"}: `
        + `wieder ohne (${wiederOhne})`,
    });
  }

  /* P39 — DIE DREI EINZELLAEUFE, und der Umgebungsstempel.
   *
   * `staging-0139.sql` und `staging-0140.sql` betten die Migrationen
   * zeichengleich ein (geprueft in `staging-oneshot.test.ts`) und fuegen
   * EINE Pruefung hinzu: laeuft das hier auf Staging? Dass sie anschlaegt,
   * laesst sich nur fahren, nicht lesen — hier wird sie gefahren.
   */
  {
    const OP139 = "supabase/operations/staging-0139.sql";
    const OP140 = "supabase/operations/staging-0140.sql";

    const wert = async (db: InstanceType<typeof PGlite>, sql: string): Promise<string> =>
      String(((await db.query(sql)) as { rows: Record<string, unknown>[] }).rows[0]?.w ?? "?");

    /* Der gute Fall: beide nacheinander, wie der Betreiber sie faehrt. */
    const db = await frischNach0136();
    const f137 = await fahre(db, M137);
    if (f137 !== null) throw new Error(`P39 Aufbau: 0137 scheiterte — ${f137}`);
    await serienUndIdentitaet(db);
    const f138 = await fahre(db, M138);
    if (f138 !== null) throw new Error(`P39 Aufbau: 0138 scheiterte — ${f138}`);
    await db.exec(`
      create sequence if not exists public.z_inv_id_seq start 1000;
      alter table public.shop_inventory
        alter column id set default nextval('public.z_inv_id_seq');
      update public.shop_inventory set id = nextval('public.z_inv_id_seq')
       where id is null;`);

    const lauf139 = await fahre(db, OP139, { klammer: false });
    const lauf140 = lauf139 === null ? await fahre(db, OP140, { klammer: false }) : "nicht gefahren";
    const freigegeben = lauf140 === null ? await wert(db,
      "select count(*)::text as w from public.shop_inventory where sale_released") : "-";
    const felder = lauf140 === null ? await wert(db,
      "select (position('delivery_scope' in prosrc) > 0)::text as w from pg_proc "
      + "where oid = to_regprocedure('public.seller_business_backup()')") : "-";

    /*
     * UND DER ZWEITE LAUF MUSS ABPRALLEN. Das ist der eigentliche Schutz
     * davor, dass `0139` versehentlich erneut angewendet wird: kein
     * Register, sondern die Migration selbst. Ihre Vorbedingung 1b fragt,
     * ob die Spalten schon stehen.
     */
    /* 0141 hinterher: rein additiv, liest nur. */
    const OP141 = "supabase/operations/staging-0141.sql";
    const lauf141 = lauf140 === null ? await fahre(db, OP141, { klammer: false }) : "nicht gefahren";
    const spalten141 = lauf141 === null ? await wert(db,
      "select count(*)::text as w from pg_proc p, "
      + "unnest(p.proargnames, p.proargmodes) as a(nm, md) "
      + "where p.oid = to_regprocedure('public.seller_sale_state()') and a.md = 't'") : "-";

    const zweimal139 = lauf140 === null ? await fahre(db, OP139, { klammer: false }) : "-";
    const zweimal140 = lauf140 === null ? await fahre(db, OP140, { klammer: false }) : "-";
    const nachZweitlauf = lauf140 === null ? await wert(db,
      "select count(*)::text as w from public.shop_inventory where sale_released") : "-";

    /* Der schlechte Fall: dieselbe Datei ohne den Stempel. */
    const db2 = await frischNach0136();
    const g137 = await fahre(db2, M137);
    if (g137 !== null) throw new Error(`P39 Aufbau: 0137 scheiterte — ${g137}`);
    await serienUndIdentitaet(db2);
    const g138 = await fahre(db2, M138);
    if (g138 !== null) throw new Error(`P39 Aufbau: 0138 scheiterte — ${g138}`);
    await db2.exec("delete from public.skylanders where sky_id in ('SKY-0821', 'SKY-0822');");
    const falschesProjekt = await fahre(db2, OP139, { klammer: false });
    const nichtsDa = await wert(db2,
      "select (count(*) = 0)::text as w from information_schema.columns "
      + "where table_schema = 'public' and table_name = 'shop_inventory' "
      + "and column_name = 'sale_released'");

    probe.push({
      name: "P39 die drei Einzellaeufe gehen EINMAL durch — nicht zweimal, nicht im falschen Projekt",
      ok: lauf139 === null && lauf140 === null && lauf141 === null
        && spalten141 === "8" && freigegeben === "0" && felder === "true"
        && zweimal139 !== null && zweimal139.includes("steht schon")
        && zweimal140 !== null && nachZweitlauf === "0"
        && falschesProjekt !== null && falschesProjekt.includes("ABBRUCH A1")
        && nichtsDa === "true",
      sagt: `0139 ${lauf139 ?? "durch"}, 0140 ${lauf140 ?? "durch"}, freigegebene `
        + `Positionen ${freigegeben}, Sicherung kennt den Lieferumfang (${felder}), `
        + `0141 ${lauf141 ?? "durch"} mit ${spalten141} Spalten · `
        + `zweiter Lauf: 0139 ${zweimal139 === null ? "DURCHGELAUFEN — Befund" : "prallt ab"}, `
        + `0140 ${zweimal140 === null ? "DURCHGELAUFEN — Befund" : "prallt ab"}, `
        + `freigegeben danach ${nachZweitlauf} · `
        + `ohne Stempel: ${falschesProjekt === null ? "DURCHGELAUFEN — Befund"
            : "abgebrochen"}, und keine Spalte zurueckgelassen (${nichtsDa})`,
    });
  }

  /* P40 — DIE PREFLIGHTS GEGEN DEN ZUSTAND, DEN SIE WIRKLICH VORFINDEN.
   *
   * DER FEHLER, DEN ES NIE WIEDER GEBEN SOLL. `0139_preflight.sql` lief am
   * 2026-10-20 auf Staging in `column s.usk_rating does not exist` — eine
   * Spalte, die `0139` erst ANLEGT. Die Planpruefung in Stufe 2 hatte das
   * nicht gesehen, und sie KONNTE es nicht: ihr Stub-Schema entsteht aus
   * ALLEN Migrationen, die noch nicht angewendeten eingeschlossen. Dort gibt
   * es `usk_rating`, also loest der Name auf.
   *
   * Ein Preflight misst aber den Zustand VOR seiner Migration. Er muss
   * deshalb gegen genau diesen Zustand laufen — und das ist der Instanz, die
   * Stufe 4 ohnehin baut: `frisch()` nimmt die Spalten der PROBELAUF-Dateien
   * wieder heraus.
   *
   * Gefahren wird mit `skyisles.z0 = 'keine'`: die Z0-Bezugszahlen gelten
   * fuer Staging, nicht fuer sieben erfundene Zeilen. Blockierend bleibt
   * alles Strukturelle — welche Spalte es gibt, welche nicht, welche
   * Funktion steht.
   */
  {
    const VOR_0139 = [
      ["0139_preflight.sql", "misst den Zustand vor 0139"],
      ["accessory_offer_readonly.sql", "misst, was eine Lockerung freigaebe"],
    ] as const;

    const db = await frischNach0136();
    const f137 = await fahre(db, M137);
    if (f137 !== null) throw new Error(`P40 Aufbau: 0137 scheiterte — ${f137}`);
    await serienUndIdentitaet(db);
    const f138 = await fahre(db, M138);
    if (f138 !== null) throw new Error(`P40 Aufbau: 0138 scheiterte — ${f138}`);

    const befunde: string[] = [];
    let alleOk = true;
    for (const [datei, zweck] of VOR_0139) {
      try {
        const r = await pruefdatei(db, datei,
          { vorher: "select set_config('skyisles.z0', 'keine', true);" });
        const ok = r.abweichungen === "0" && r.modus === "ja";
        alleOk &&= ok;
        befunde.push(`${datei}: ${ok ? "ok" : `Abweichungen ${r.abweichungen}, `
          + `Modus ${r.modus}`} (${zweck})`);
      } catch (e) {
        alleOk = false;
        befunde.push(`${datei}: ${(e as Error).message.split("\n")[0]}`);
      }
    }

    probe.push({
      name: "P40 die Preflights laufen gegen den Zustand VOR ihrer Migration",
      ok: alleOk,
      sagt: befunde.join(" · "),
    });
  }

  /* P41 — DER PRODUCTION-STEMPEL, in beide Richtungen.
   *
   * `prod-0135.sql` bettet dieselbe Migration ein wie der Staging-Lauf
   * (zeichengleich, geprueft in `staging-oneshot.test.ts`); der einzige
   * Unterschied ist der Stempel. Dass er greift, laesst sich nur fahren.
   *
   * Drei Faelle: mit Staging-Stempel (A1), ohne Stempel aber mit winzigem
   * Katalog (A3), und richtig — Stempel fort, Katalog gross genug.
   */
  {
    const PROD135 = "supabase/operations/prod-0135.sql";
    const wert = async (db: InstanceType<typeof PGlite>, sql: string): Promise<string> =>
      String(((await db.query(sql)) as { rows: Record<string, unknown>[] }).rows[0]?.w ?? "?");
    const HAT_SPALTE = "select (count(*) = 1)::text as w from information_schema.columns "
      + "where table_schema = 'public' and table_name = 'skylanders' "
      + "and column_name = 'item_type'";

    /* 1. Der Fixture-Katalog TRAEGT den Staging-Stempel (SKY-0821/0822). */
    const db1 = await frisch();
    const aufStaging = await fahre(db1, PROD135, { klammer: false });
    const spalte1 = await wert(db1, HAT_SPALTE);

    /* 2. Stempel fort — aber sieben Katalogzeilen sind kein Production. */
    const db2 = await frisch();
    await db2.exec("delete from public.skylanders where sky_id in ('SKY-0821', 'SKY-0822');");
    const zuKlein = await fahre(db2, PROD135, { klammer: false });

    /* 120 Zeilen, damit A3 nicht greift — ein Fixture-Katalog ist kein
       Production-Katalog. */
    const FUELLEN = `
      insert into public.skylanders
             (sky_id, name, slug, series_code, category_id, is_active, catalog_visible,
              market_price, card_type, source, display_name_override)
      select 'FILL-' || g::text, 'Fill ' || g::text, 'fill-' || g::text, 'PROBE', 1,
             true, true, 1.00, 'core', 'probe', null
        from generate_series(1, 120) g;`;

    /* 3. Beide Marker fort, Katalog gross genug: jetzt muss sie durchlaufen. */
    const db3 = await frisch();
    await db3.exec("delete from public.skylanders where sky_id in ('SKY-0821', 'SKY-0822');");
    await db3.exec(FUELLEN);
    const alsProduction = await fahre(db3, PROD135, { klammer: false });
    const spalte3 = alsProduction === null ? await wert(db3, HAT_SPALTE) : "-";

    /*
     * 4. DER WIRKLICHE PRODUCTION-FALL: `SKY-0821` liegt da, `SKY-0822`
     *    nicht.
     *
     * Gemessen am 2026-10-21: `SKY-0821` ist auf Production ein ECHTER
     * Artikel — „Winterfest Lob-Star", `source = admin`, angelegt
     * 2026-09-16 —, und die ID gehoert in den produktiven
     * Allokationsbereich `SKY-0821`-`SKY-8999`. Eine Pruefung auf
     * „irgendeine der beiden" hat die Datei deshalb auf Production
     * abgewiesen. Dieser Durchgang ist der Grund, warum der Riegel das
     * PAAR prueft.
     */
    const db4 = await frisch();
    await db4.exec("delete from public.skylanders where sky_id = 'SKY-0822';");
    await db4.exec(FUELLEN);
    const nurEiner = await fahre(db4, PROD135, { klammer: false });
    const spalte4 = nurEiner === null ? await wert(db4, HAT_SPALTE) : "-";
    const artikelBleibt = await wert(db4,
      "select (count(*) = 1)::text as w from public.skylanders where sky_id = 'SKY-0821'");

    /*
     * 5. UND DER ZWEITE RIEGEL TRAEGT ALLEIN.
     *
     * Das ist, was die Lockerung von A1 vertretbar macht: ohne `0133` ist
     * es nicht Production, auch wenn kein Markerpaar da ist. Staging faellt
     * damit zweifach — an A1 (beide Marker) UND an A2.
     */
    const db5 = await frisch();
    await db5.exec("delete from public.skylanders where sky_id in ('SKY-0821', 'SKY-0822');");
    await db5.exec(FUELLEN);
    await db5.exec("drop function if exists public.purchases_paid_total_is_final() cascade;");
    const ohne0133 = await fahre(db5, PROD135, { klammer: false });

    probe.push({
      name: "P41 der Production-Riegel: Paar weist ab, nur SKY-0821 laesst durch, ohne 0133 weist ab",
      ok: aufStaging !== null && aufStaging.includes("ABBRUCH A1") && spalte1 === "false"
        && zuKlein !== null && zuKlein.includes("ABBRUCH A3")
        && alsProduction === null && spalte3 === "true"
        && nurEiner === null && spalte4 === "true" && artikelBleibt === "true"
        && ohne0133 !== null && ohne0133.includes("ABBRUCH A2"),
      sagt: `Markerpaar (Staging): ${aufStaging === null ? "DURCHGELAUFEN — Befund" : "A1"}`
        + ` (Spalte danach ${spalte1}) · winziger Katalog: `
        + `${zuKlein === null ? "DURCHGELAUFEN — Befund" : "A3"} · ohne Marker: `
        + `${alsProduction ?? "durch"} (item_type ${spalte3}) · NUR SKY-0821 (Production): `
        + `${nurEiner ?? "durch"} (item_type ${spalte4}, Artikel unberuehrt ${artikelBleibt})`
        + ` · ohne 0133: ${ohne0133 === null ? "DURCHGELAUFEN — Befund" : "A2"}`,
    });
  }

  /* P42 — DIE LESENDE NACHKONTROLLE ZU 0136, GEFAHREN.
   *
   * `prod-s-postflight-0136.sql` ist die Datei, die der Bediener nach
   * `prod-0136.sql` auf Production ausfuehrt — weil der SQL-Editor
   * `NOTICE`-Meldungen nicht anzeigt und „Success" allein kein Befund ist.
   *
   * Zwei Faelle, und dann die Zahlen:
   *
   *   1. Mit Staging-Markerpaar muss sie abbrechen (A1). Ein LESENDER Lauf
   *      in der falschen Datenbank richtet keinen Schaden an, aber er
   *      liefert einen falschen Befund — und das ist genau die Panne vom
   *      2026-10-20.
   *   2. In einem Stand, der Production nachbildet (0135 und 0136
   *      angewendet, kein Marker, Katalog gross genug), muss sie durchlaufen.
   *
   * UND DANN DAS EIGENTLICHE: die vier Zeilen, auf die es ankommt, muessen
   * die erwarteten Werte zeigen. Das prueft nicht nur die DATEI, sondern die
   * ERWARTUNG: `f6d08440…`, 28 Bereiche, 353 Feldzeilen, `item_type` genau
   * einmal — gegen einen Rumpf, der nachweislich aus der Migration dieses
   * Repositories stammt.
   */
  {
    const LESEND = "supabase/operations/prod-s-postflight-0136.sql";
    const PRUEFDATEI = "supabase/checks/0136_postflight.sql";
    /* 120 Zeilen, damit A3 nicht greift — derselbe Grund wie in P41. */
    const FUELLEN = `
      insert into public.skylanders
             (sky_id, name, slug, series_code, category_id, is_active, catalog_visible,
              market_price, card_type, source, display_name_override)
      select 'FILL-' || g::text, 'Fill ' || g::text, 'fill-' || g::text, 'PROBE', 1,
             true, true, 1.00, 'core', 'probe', null
        from generate_series(1, 120) g;`;

    /* 1. Fixture-Katalog MIT Markerpaar. */
    const dbA = await frischNach0136();
    const aufStaging = await fahre(dbA, LESEND, { klammer: false });

    /* 2. Production nachgebildet. */
    const dbB = await frischNach0136();
    await dbB.exec("delete from public.skylanders where sky_id in ('SKY-0821', 'SKY-0822');");
    await dbB.exec(FUELLEN);
    const alsProduction = await fahre(dbB, LESEND, { klammer: false });

    /*
     * 3. Die Zeilen selbst. Das `rollback` der Datei nimmt ihr Ergebnis mit,
     *    also wird die eingebettete Pruefung einmal als ABFRAGE gefahren —
     *    derselbe Text, nur dass die Zeilen diesmal lesbar sind. Der Modus
     *    gilt hier fuer die Sitzung (`false`), weil keine Klammer drumherum
     *    liegt.
     */
    await dbB.exec("select set_config('skyisles.z0', 'keine', false);");
    const blatt = await dbB.query(readFileSync(PRUEFDATEI, "utf8")) as {
      rows: { nr: number; befund: string; ok: boolean | null }[] };
    const zeile = (nr: number): string =>
      blatt.rows.find((r) => r.nr === nr)?.befund ?? "(fehlt)";
    const abweichungen = blatt.rows.filter((r) => r.ok === false)
      .map((r) => r.nr).join(", ");

    probe.push({
      name: "P42 die lesende Nachkontrolle zu 0136: weist Staging ab, laeuft auf Production, "
        + "und ihre vier Zahlen stimmen",
      ok: aufStaging !== null && aufStaging.includes("ABBRUCH A1")
        && alsProduction === null
        && zeile(102) === "f6d08440707ba72a8040a8d1e666c092"
        && zeile(105) === "28" && zeile(106) === "353" && zeile(108) === "1"
        && abweichungen === "",
      sagt: `Markerpaar: ${aufStaging === null ? "DURCHGELAUFEN — Befund" : "A1"}`
        + ` · als Production: ${alsProduction ?? "durch"}`
        + ` · Abdruck ${zeile(102).slice(0, 8)}… · ${zeile(105)} Bereiche`
        + ` · ${zeile(106)} Feldzeilen · item_type ${zeile(108)}×`
        + ` · blockierende Abweichungen: ${abweichungen === "" ? "keine" : abweichungen}`,
    });
  }

  /* P43 — DIE LESENDE NACHKONTROLLE ZU 0137, GEFAHREN.
   *
   * Derselbe Gedanke wie P42, eine Migration weiter: die Datei, die der
   * Bediener nach `prod-0137.sql` auf Production ausfuehrt, muss Staging
   * abweisen, auf einem Production-Stand durchlaufen — und die Zeilen
   * zeigen, auf die es ankommt.
   *
   * Dieser Durchgang prueft die ERWARTUNG mit: dass `0137` fuenf Kategorien
   * fuehrt, `seller_create_catalog_item` mit genau einer Overload steht,
   * `seller_import_catalog` acht Spalten liefert und KEINE Zeile angelegt
   * wurde — gegen Objekte, die aus den Migrationen dieses Repositories
   * entstanden sind.
   */
  {
    const LESEND = "supabase/operations/prod-s-postflight-0137.sql";
    const PRUEFDATEI = "supabase/checks/0137_postflight.sql";
    const FUELLEN = `
      insert into public.skylanders
             (sky_id, name, slug, series_code, category_id, is_active, catalog_visible,
              market_price, card_type, source, display_name_override)
      select 'FILL-' || g::text, 'Fill ' || g::text, 'fill-' || g::text, 'PROBE', 1,
             true, true, 1.00, 'core', 'probe', null
        from generate_series(1, 120) g;`;

    /** Der Stand, den Production nach Schritt 5 hat: 0135, 0136, 0137. */
    async function frischNach0137(): Promise<InstanceType<typeof PGlite>> {
      const db = await frischNach0136();
      const f = await fahre(db, M137);
      if (f !== null) throw new Error(`P43 Aufbau: 0137 scheiterte — ${f}`);
      return db;
    }

    /* 1. Fixture-Katalog MIT Markerpaar — muss abbrechen. */
    const dbA = await frischNach0137();
    const aufStaging = await fahre(dbA, LESEND, { klammer: false });

    /* 2. Production nachgebildet — muss durchlaufen. */
    const dbB = await frischNach0137();
    await dbB.exec("delete from public.skylanders where sky_id in ('SKY-0821', 'SKY-0822');");
    await dbB.exec(FUELLEN);
    const alsProduction = await fahre(dbB, LESEND, { klammer: false });

    /* 3. Und die Zeilen selbst, als Abfrage — das `rollback` der Datei nimmt
     *    ihr Ergebnis mit. */
    await dbB.exec("select set_config('skyisles.z0', 'keine', false);");
    const blatt = await dbB.query(readFileSync(PRUEFDATEI, "utf8")) as {
      rows: { nr: number; befund: string; ok: boolean | null }[] };
    const zeile = (nr: number): string =>
      blatt.rows.find((r) => r.nr === nr)?.befund ?? "(fehlt)";
    const abweichungen = blatt.rows.filter((r) => r.ok === false)
      .map((r) => r.nr).join(", ");

    probe.push({
      name: "P43 die lesende Nachkontrolle zu 0137: weist Staging ab, laeuft auf Production, "
        + "und die fuenf Fragen sind beantwortet",
      ok: aufStaging !== null && aufStaging.includes("ABBRUCH A1")
        && alsProduction === null
        && zeile(201) === "Spiele,Portale,Bundles,Taschen,Zubehör"
        && zeile(204) === "true"
        && zeile(205) === "sky_id,name,series_code,category,display_name,"
          + "catalog_visible,is_active,item_type"
        && zeile(301) === "0" && zeile(604) === "0"
        && abweichungen === "",
      sagt: `Markerpaar: ${aufStaging === null ? "DURCHGELAUFEN — Befund" : "A1"}`
        + ` · als Production: ${alsProduction ?? "durch"}`
        + ` · fuenf Kategorien ${zeile(201)} · Anlegefunktion ${zeile(204)}`
        + ` · import_catalog ${zeile(205)} · angelegte Zeilen ${zeile(301)}`
        + ` · shopfaehig in den fuenf ${zeile(604)}`
        + ` · blockierende Abweichungen: ${abweichungen === "" ? "keine" : abweichungen}`,
    });
  }

  /* P44 — DER GANZE SCHRITT 7: VORHER, 0138, NACHHER.
   *
   * Die drei Dateien, die der Bediener auf Production hintereinander fahren
   * soll, einmal wirklich hintereinander gefahren — und zwar auf dem Stand,
   * den Production heute hat (`0135`, `0136`, `0137`).
   *
   * Was dieser Durchgang prueft, prueft keiner der anderen:
   *
   *   1. Der Preflight laeuft VOR `0138` — er darf nichts lesen, was erst
   *      `0138` anlegt (die Lehre vom 2026-10-20, siehe P40).
   *   2. `0138` laeuft auf diesem Stand ueberhaupt durch.
   *   3. Der Postflight ist danach gruen, ZEILE FUER ZEILE.
   *   4. Und die eine erwartete Aenderung ist wirklich die eine: 21
   *      Katalogzeilen mehr, `portal=21` neu — und Angebote, Abdruck,
   *      sammelbare Zeilen, Nenner je Serie, Overrides und `sky_id_seq`
   *      Zeichen fuer Zeichen gleich.
   *
   * Punkt 4 ist die Zusicherung, auf die es dem Bediener ankommt, und sie
   * wird hier nicht behauptet, sondern gerechnet: die Abdruckzeilen des
   * Preflights werden mit den gleichnamigen Zeilen des Postflights
   * verglichen, so wie er es auf Production von Hand tun wird.
   */
  {
    const VORHER = "supabase/operations/prod-s-preflight-0138.sql";
    const NACHHER = "supabase/operations/prod-s-postflight-0138.sql";
    const FUELLEN = `
      insert into public.skylanders
             (sky_id, name, slug, series_code, category_id, is_active, catalog_visible,
              market_price, card_type, source, display_name_override)
      select 'FILL-' || g::text, 'Fill ' || g::text, 'fill-' || g::text, 'PROBE', 1,
             true, true, 1.00, 'core', 'probe', null
        from generate_series(1, 120) g;`;

    type Blatt = { rows: { nr: number; befund: string; ok: boolean | null }[] };
    const lies = async (db: InstanceType<typeof PGlite>, pfad: string): Promise<Blatt> => {
      await db.exec("select set_config('skyisles.z0', 'keine', false);");
      return await db.query(readFileSync(pfad, "utf8")) as Blatt;
    };
    const feld = (b: Blatt, nr: number): string =>
      b.rows.find((r) => r.nr === nr)?.befund ?? "(fehlt)";
    const rot = (b: Blatt): string =>
      b.rows.filter((r) => r.ok === false).map((r) => r.nr).join(", ");

    /* Der Stand von Production: 0135, 0136, 0137 — und die sechs Serien,
       die `0138` braucht (das Stub-Schema traegt keine). */
    const db = await frischNach0136();
    const f137 = await fahre(db, M137);
    if (f137 !== null) throw new Error(`P44 Aufbau: 0137 scheiterte — ${f137}`);
    await serienUndIdentitaet(db);
    await db.exec("delete from public.skylanders where sky_id in ('SKY-0821', 'SKY-0822');");
    await db.exec(FUELLEN);

    /* 1. VORHER — die ganze Datei, mit Riegel und Klammer. */
    const vorherLauf = await fahre(db, VORHER, { klammer: false });
    const vorher = await lies(db, "supabase/checks/0138_preflight.sql");

    /* 2. Und auf Staging muss dieselbe Datei abbrechen. */
    const dbS = await frischNach0136();
    const f137s = await fahre(dbS, M137);
    if (f137s !== null) throw new Error(`P44 Aufbau: 0137 scheiterte — ${f137s}`);
    const aufStaging = await fahre(dbS, VORHER, { klammer: false });

    /* 3. 0138 selbst. */
    const lauf = await fahre(db, M138);

    /* 4. NACHHER. */
    const nachherLauf = await fahre(db, NACHHER, { klammer: false });
    const nachher = await lies(db, "supabase/checks/0138_postflight.sql");

    /* 5. Der Vergleich, den der Bediener von Hand macht. */
    const zeilenMehr = Number(feld(nachher, 501)) - Number(feld(vorher, 401));
    const gleich = ([
      [502, 402], [503, 403], [504, 404], [505, 405], [506, 406], [508, 408], [509, 409],
      [510, 501], [511, 503],
    ] as const).filter(([n, v]) => feld(nachher, n) !== feld(vorher, v))
      .map(([n, v]) => `${n}≠${v}`).join(", ");
    const typen = feld(nachher, 507);

    /*
     * EINE ZEILE DARF HIER ROT SEIN, UND ZWAR GENAU EINE.
     *
     * Preflight 104 fragt, ob der CHECK `catalog_admin_changes_field_known`
     * den Wert `created` kennt. Das STUB-SCHEMA traegt ueberhaupt keinen
     * CHECK (0 Stueck, nachgezaehlt) — die Zeile kann hier also nicht gruen
     * werden. Das ist eine Grenze der Wegwerf-Instanz und kein Befund.
     *
     * Sie wird deshalb NAMENTLICH zugelassen und nicht weggelassen: jede
     * ANDERE rote Zeile laesst diesen Durchgang weiter scheitern. Auf
     * Production muss 104 `true` zeigen — `0004`/`0033` liegen dort seit
     * Langem, und der Release-Plan nennt die Zeile als Vorbedingung.
     */
    const STUB_ARTEFAKT = "104, 9999";

    probe.push({
      name: "P44 Schritt 7 am Stueck: Preflight, 0138, Postflight — und nur die 21 Zeilen aendern sich",
      ok: vorherLauf === null && nachherLauf === null && lauf === null
        && aufStaging !== null && aufStaging.includes("ABBRUCH A1")
        && rot(vorher) === STUB_ARTEFAKT && rot(nachher) === ""
        && zeilenMehr === 21 && gleich === ""
        && typen.includes("portal=21"),
      sagt: `Vorher: ${vorherLauf ?? "durch"} (rot: ${rot(vorher) || "keine"}`
        + `${rot(vorher) === STUB_ARTEFAKT ? " — nur das Stub-Artefakt 104" : ""})`
        + ` · auf Staging: ${aufStaging === null ? "DURCHGELAUFEN — Befund" : "A1"}`
        + ` · 0138: ${lauf ?? "durch"}`
        + ` · Nachher: ${nachherLauf ?? "durch"} (rot: ${rot(nachher) || "keine"})`
        + ` · Katalogzeilen +${zeilenMehr} · Typen ${typen}`
        + ` · GLEICH-Zeilen: ${gleich === "" ? "alle gleich" : gleich}`,
    });
  }

  /* P45 — SCHRITT 8 AM STUECK, IM MODUS `production`.
   *
   * Die drei Dateien fuer `0139`, hintereinander auf einem Stand, der
   * Production nachbildet (`0135`-`0138`). Was dieser Durchgang zeigt und
   * kein anderer:
   *
   *   1. Der Preflight laeuft VOR `0139` und liest keine Spalte, die erst
   *      `0139` anlegt — der Fehler vom 2026-10-20, hier fuer die
   *      Production-Huelle nachgefahren.
   *   2. `0139` laeuft auf diesem Stand durch.
   *   3. Der Postflight ist danach STRUKTURELL vollstaendig gruen: nichts
   *      freigegeben, nichts mit USK, kein Zubehoerangebot, vier Tueren am
   *      neuen Tor, null Tueren am alten, die Riegel dicht, die Belegsperre
   *      unveraendert.
   *   4. Und der MODUS WIRKT: die sechs Bezugszahlen sind blockierend. Im
   *      Fixture koennen sie nicht stimmen — 287 Angebote hat eine
   *      Wegwerf-Instanz nicht —, also MUESSEN genau sie rot sein und sonst
   *      nichts. Waere der Modus nicht gewaehlt, waeren sie still.
   *
   * Punkt 4 ist der Grund, warum hier eine ERWARTETE Rotmenge steht statt
   * „alles gruen": eine Pruefung, die im Probelauf gruen ist, weil sie
   * nichts prueft, ist das, was dieses Werkzeug finden soll.
   */
  {
    const VORHER = "supabase/operations/prod-s-preflight-0139.sql";
    const NACHHER = "supabase/operations/prod-s-postflight-0139.sql";
    const FUELLEN = `
      insert into public.skylanders
             (sky_id, name, slug, series_code, category_id, is_active, catalog_visible,
              market_price, card_type, source, display_name_override)
      select 'FILL-' || g::text, 'Fill ' || g::text, 'fill-' || g::text, 'PROBE', 1,
             true, true, 1.00, 'core', 'probe', null
        from generate_series(1, 120) g;`;

    type Blatt = { rows: { nr: number; befund: string; ok: boolean | null }[] };
    const feld = (b: Blatt, nr: number): string =>
      b.rows.find((r) => r.nr === nr)?.befund ?? "(fehlt)";
    const rot = (b: Blatt): string =>
      b.rows.filter((r) => r.ok === false).map((r) => r.nr).join(", ");
    const lies = async (db: InstanceType<typeof PGlite>, pfad: string): Promise<Blatt> => {
      await db.exec("select set_config('skyisles.z0', 'production', false);");
      return await db.query(readFileSync(pfad, "utf8")) as Blatt;
    };

    /* Der Stand von Production nach Schritt 7: 0135-0138. */
    const db = await frischNach0136();
    const f137 = await fahre(db, M137);
    if (f137 !== null) throw new Error(`P45 Aufbau: 0137 scheiterte — ${f137}`);
    await serienUndIdentitaet(db);
    const f138 = await fahre(db, M138);
    if (f138 !== null) throw new Error(`P45 Aufbau: 0138 scheiterte — ${f138}`);
    await db.exec("delete from public.skylanders where sky_id in ('SKY-0821', 'SKY-0822');");
    await db.exec(FUELLEN);
    /*
     * EINE IDENTITAET AUF `shop_inventory.id` — dieselbe Vorkehrung wie in
     * `frischNach0138()` (P34-P37). Das Stub-Schema ist reine Struktur und
     * traegt keine Defaults; in der Wirklichkeit ist `id`
     * `generated always as identity`. Hier blieb sie NULL, und
     * `is_position_sellable(NULL)` ist fuer jede Zeile `false` — `0139`
     * brach deshalb mit „2 Positionen antworten am neuen Tor anders als am
     * alten" ab. Das war ein Befund des STUBS und keiner der Migration; die
     * Abbruchbedingung selbst hat genau richtig gegriffen.
     */
    await db.exec(`
      create sequence if not exists public.z_inv_id_seq start 1000;
      alter table public.shop_inventory
        alter column id set default nextval('public.z_inv_id_seq');
      update public.shop_inventory set id = nextval('public.z_inv_id_seq')
       where id is null;`);

    const vorherLauf = await fahre(db, VORHER, { klammer: false });
    const vorher = await lies(db, "supabase/checks/0139_preflight.sql");
    const lauf = await fahre(db, M139);
    /* Scheitert 0139, kann der Postflight nicht laufen — er liest Spalten,
       die dann fehlen. Dann ist der Befund der Abbruch selbst. */
    const nachherLauf = lauf === null
      ? await fahre(db, NACHHER, { klammer: false }) : "0139 scheiterte";
    const nachher: Blatt = lauf === null
      ? await lies(db, "supabase/checks/0139_postflight.sql") : { rows: [] };

    /*
     * DIE ERWARTETE ROTMENGE. Nur Bezugszahlen, die ein Fixture nicht haben
     * kann — und 9999, das sie zaehlt. Jede ANDERE rote Zeile laesst diesen
     * Durchgang scheitern.
     *
     * Preflight: 401 Angebote, 402 Abdruck, 403 shopfaehig, 405 sammelbar,
     * 406 Lagerzeilen, 407 Katalogzeilen. Postflight: 301, 302, 303 und
     * 501, 502, 503 — dieselben sechs, nur anders numeriert.
     */
    const ROT_VORHER = "401, 402, 403, 405, 406, 407, 9999";
    const ROT_NACHHER = "301, 302, 303, 501, 502, 503, 9999";

    probe.push({
      name: "P45 Schritt 8 am Stueck: Preflight, 0139, Postflight — nichts freigegeben, "
        + "und der Modus production wirkt",
      ok: vorherLauf === null && lauf === null && nachherLauf === null
        && rot(vorher) === ROT_VORHER && rot(nachher) === ROT_NACHHER
        /* Der Stempel: auf einer Nicht-Staging-Instanz muss Zeile 1 false sein. */
        && feld(vorher, 1) === "false"
        /* Und die Aussage, auf die es ankommt. */
        && feld(nachher, 201) === "0" && feld(nachher, 202) === "0"
        && feld(nachher, 203) === "0" && feld(nachher, 204) === "0"
        && feld(nachher, 304) === "0"
        && feld(nachher, 401) === "4" && feld(nachher, 402) === "0",
      sagt: `Vorher: ${vorherLauf ?? "durch"} (rot: ${rot(vorher)})`
        + ` · Stempel ${feld(vorher, 1)} · 0139: ${lauf ?? "durch"}`
        + ` · Nachher: ${nachherLauf ?? "durch"} (rot: ${rot(nachher)})`
        + ` · freigegeben ${feld(nachher, 201)} · USK ${feld(nachher, 202)}`
        + ` · Zubehoerangebote ${feld(nachher, 203)} · durchs neue Tor `
        + `${feld(nachher, 204)} · anders als am alten Tor ${feld(nachher, 304)}`
        + ` · Tueren am neuen Tor ${feld(nachher, 401)}, am alten `
        + `${feld(nachher, 402)}`,
    });
  }

  /* P46 — SCHRITT 9 AM STUECK: VORHER, 0140, NACHHER.
   *
   * `0140` ist die zweite Migration dieses Releases, die nur einen
   * Funktionsrumpf schreibt — und die erste, deren Pruefdateien ERST JETZT
   * entstanden sind. Die drei Abdruecke darin (Rumpf, Laenge, Kommentar)
   * sind aus der Migrationsdatei GERECHNET; dieser Durchgang fuehrt sie an
   * echtem PostgreSQL nach. Eine gerechnete Konstante, die niemand gegen
   * eine laufende Datenbank gehalten hat, ist eine Vermutung.
   *
   * Vier Faelle:
   *
   *   1. Der Preflight laeuft VOR `0140` und verlangt dort den Stand `0136`.
   *   2. `0140` laeuft auf dem Stand `0135`-`0139` durch.
   *   3. Der Postflight ist danach STRUKTURELL gruen — 356 Feldzeilen, 28
   *      Bereiche, die drei neuen Felder, nichts freigegeben, Belegsperre.
   *   4. Und `0140` BRICHT AB, wenn `0139` fehlt. Das ist ihre einzige
   *      harte Vorbedingung, und ohne sie waere der Rumpf nicht lauffaehig.
   */
  {
    const VORHER = "supabase/operations/prod-s-preflight-0140.sql";
    const NACHHER = "supabase/operations/prod-s-postflight-0140.sql";
    const FUELLEN = `
      insert into public.skylanders
             (sky_id, name, slug, series_code, category_id, is_active, catalog_visible,
              market_price, card_type, source, display_name_override)
      select 'FILL-' || g::text, 'Fill ' || g::text, 'fill-' || g::text, 'PROBE', 1,
             true, true, 1.00, 'core', 'probe', null
        from generate_series(1, 120) g;`;

    type Blatt = { rows: { nr: number; befund: string; ok: boolean | null }[] };
    const feld = (b: Blatt, nr: number): string =>
      b.rows.find((r) => r.nr === nr)?.befund ?? "(fehlt)";
    const rot = (b: Blatt): string =>
      b.rows.filter((r) => r.ok === false).map((r) => r.nr).join(", ");
    const lies = async (db: InstanceType<typeof PGlite>, pfad: string): Promise<Blatt> => {
      await db.exec("select set_config('skyisles.z0', 'production', false);");
      return await db.query(readFileSync(pfad, "utf8")) as Blatt;
    };

    /** Der Stand von Production nach Schritt 8: 0135-0139. */
    async function frischNach0139(): Promise<InstanceType<typeof PGlite>> {
      const db = await frischNach0136();
      const f137 = await fahre(db, M137);
      if (f137 !== null) throw new Error(`P46 Aufbau: 0137 scheiterte — ${f137}`);
      await serienUndIdentitaet(db);
      const f138 = await fahre(db, M138);
      if (f138 !== null) throw new Error(`P46 Aufbau: 0138 scheiterte — ${f138}`);
      await db.exec("delete from public.skylanders where sky_id in ('SKY-0821', 'SKY-0822');");
      await db.exec(FUELLEN);
      /* Identitaet auf `shop_inventory.id` — siehe P45. */
      await db.exec(`
        create sequence if not exists public.z_inv_id_seq start 1000;
        alter table public.shop_inventory
          alter column id set default nextval('public.z_inv_id_seq');
        update public.shop_inventory set id = nextval('public.z_inv_id_seq')
         where id is null;`);
      const f139 = await fahre(db, M139);
      if (f139 !== null) throw new Error(`P46 Aufbau: 0139 scheiterte — ${f139}`);
      return db;
    }

    const db = await frischNach0139();
    const vorherLauf = await fahre(db, VORHER, { klammer: false });
    const vorher = await lies(db, "supabase/checks/0140_preflight.sql");
    const lauf = await fahre(db, M140);
    const nachherLauf = lauf === null
      ? await fahre(db, NACHHER, { klammer: false }) : "0140 scheiterte";
    const nachher: Blatt = lauf === null
      ? await lies(db, "supabase/checks/0140_postflight.sql") : { rows: [] };

    /* 4. Ohne 0139 muss sie abbrechen. */
    const dbOhne = await frischNach0136();
    const ohne0139 = await fahre(dbOhne, M140);

    /*
     * Die erwartete Rotmenge: nur die sechs Bezugszahlen, die ein Fixture
     * nicht haben kann (287 Angebote, 531, 306, 624 …) — und 9999. Jede
     * andere rote Zeile laesst diesen Durchgang scheitern. Im Postflight
     * sind es dieselben sechs.
     */
    const ROT = "301, 302, 303, 304, 305, 306, 9999";

    probe.push({
      name: "P46 Schritt 9 am Stueck: Preflight, 0140, Postflight — 356 Feldzeilen, "
        + "Abdruck wie gerechnet, und ohne 0139 ein Abbruch",
      ok: vorherLauf === null && lauf === null && nachherLauf === null
        && rot(vorher) === ROT && rot(nachher) === ROT
        && feld(vorher, 102) === "f6d08440707ba72a8040a8d1e666c092"
        && feld(vorher, 105) === "353"
        && feld(nachher, 102) === "a32b148cebe00ee0d0d469f96fd2028e"
        && feld(nachher, 103) === "21622" && feld(nachher, 104) === "28"
        && feld(nachher, 105) === "356" && feld(nachher, 108) === "3"
        && feld(nachher, 110) === "ffc66ad2060e89b7cf982c3f95012ffa"
        && feld(nachher, 201) === "0" && feld(nachher, 204) === "0"
        && feld(nachher, 401) === "0" && feld(nachher, 402) === "0"
        && ohne0139 !== null && ohne0139.includes("0140 setzt 0139 voraus"),
      sagt: `Vorher: ${vorherLauf ?? "durch"} (rot: ${rot(vorher)}, Stand `
        + `${feld(vorher, 102).slice(0, 8)}…, ${feld(vorher, 105)} Felder)`
        + ` · 0140: ${lauf ?? "durch"} · Nachher: ${nachherLauf ?? "durch"}`
        + ` (rot: ${rot(nachher)}) · Abdruck ${feld(nachher, 102).slice(0, 8)}…`
        + ` · ${feld(nachher, 104)} Bereiche · ${feld(nachher, 105)} Feldzeilen`
        + ` · ${feld(nachher, 108)} neue Felder · Kommentar `
        + `${feld(nachher, 110).slice(0, 8)}… · freigegeben ${feld(nachher, 201)}`
        + ` · Belegsperre ${feld(nachher, 401)}/${feld(nachher, 402)}`
        + ` · ohne 0139: ${ohne0139 === null ? "DURCHGELAUFEN — Befund" : "Abbruch"}`,
    });
  }

  /* P47 — SCHRITT 10 AM STUECK: VORHER, 0141, NACHHER.
   *
   * Der letzte Schritt des Releases, und der erste, dessen Pruefdateien
   * ABDRUECKE VON NACHBARFUNKTIONEN verlangen: `admin_shop_inventory`
   * (Stand `0041`), `admin_shop_listing_audit` (Stand `0139`) und die
   * Betriebssicherung (Stand `0140`). Das ist die Pruefung der Aussage
   * „`0141` ist rein additiv" — und sie ist nur so gut wie die drei
   * Konstanten. Die sind gerechnet; dieser Durchgang faehrt sie an echtem
   * PostgreSQL nach.
   *
   * Vier Faelle: Preflight VOR `0141` (die Funktion fehlt noch), `0141`
   * laeuft, Postflight danach vollstaendig gruen, und ein ZWEITER Lauf von
   * `0141` prallt ab.
   */
  {
    const VORHER = "supabase/operations/prod-s-preflight-0141.sql";
    const NACHHER = "supabase/operations/prod-s-postflight-0141.sql";
    const FUELLEN = `
      insert into public.skylanders
             (sky_id, name, slug, series_code, category_id, is_active, catalog_visible,
              market_price, card_type, source, display_name_override)
      select 'FILL-' || g::text, 'Fill ' || g::text, 'fill-' || g::text, 'PROBE', 1,
             true, true, 1.00, 'core', 'probe', null
        from generate_series(1, 120) g;`;

    type Blatt = { rows: { nr: number; befund: string; ok: boolean | null }[] };
    const feld = (b: Blatt, nr: number): string =>
      b.rows.find((r) => r.nr === nr)?.befund ?? "(fehlt)";
    const rot = (b: Blatt): string =>
      b.rows.filter((r) => r.ok === false).map((r) => r.nr).join(", ");
    const lies = async (db: InstanceType<typeof PGlite>, pfad: string): Promise<Blatt> => {
      await db.exec("select set_config('skyisles.z0', 'production', false);");
      return await db.query(readFileSync(pfad, "utf8")) as Blatt;
    };

    /** Der Stand von Production nach Schritt 9: 0135-0140. */
    const db = await frischNach0136();
    const f137 = await fahre(db, M137);
    if (f137 !== null) throw new Error(`P47 Aufbau: 0137 scheiterte — ${f137}`);
    await serienUndIdentitaet(db);
    const f138 = await fahre(db, M138);
    if (f138 !== null) throw new Error(`P47 Aufbau: 0138 scheiterte — ${f138}`);
    await db.exec("delete from public.skylanders where sky_id in ('SKY-0821', 'SKY-0822');");
    await db.exec(FUELLEN);
    await db.exec(`
      create sequence if not exists public.z_inv_id_seq start 1000;
      alter table public.shop_inventory
        alter column id set default nextval('public.z_inv_id_seq');
      update public.shop_inventory set id = nextval('public.z_inv_id_seq')
       where id is null;`);
    const f139 = await fahre(db, M139);
    if (f139 !== null) throw new Error(`P47 Aufbau: 0139 scheiterte — ${f139}`);
    const f140 = await fahre(db, M140);
    if (f140 !== null) throw new Error(`P47 Aufbau: 0140 scheiterte — ${f140}`);

    const vorherLauf = await fahre(db, VORHER, { klammer: false });
    const vorher = await lies(db, "supabase/checks/0141_preflight.sql");
    const lauf = await fahre(db, M141);
    const nachherLauf = lauf === null
      ? await fahre(db, NACHHER, { klammer: false }) : "0141 scheiterte";
    const nachher: Blatt = lauf === null
      ? await lies(db, "supabase/checks/0141_postflight.sql") : { rows: [] };
    /* Und ein zweiter Lauf muss abprallen. */
    const zweimal = lauf === null ? await fahre(db, M141) : "-";

    /*
     * Die erwartete Rotmenge: die sechs Z0-Zahlen, die ein Fixture nicht
     * haben kann, PLUS 307 (der Lagerabdruck aus Production) — und 9999.
     * Jede andere rote Zeile laesst diesen Durchgang scheitern; dazu
     * gehoeren ausdruecklich 107, 108 und 109 (die drei Nachbarabdruecke)
     * und im Postflight 111-114 und 131-133.
     */
    const ROT = "301, 302, 303, 304, 305, 306, 307, 9999";

    probe.push({
      name: "P47 Schritt 10 am Stueck: Preflight, 0141, Postflight — acht Spalten, "
        + "drei Nachbarn unveraendert, zweiter Lauf prallt ab",
      ok: vorherLauf === null && lauf === null && nachherLauf === null
        && rot(vorher) === ROT && rot(nachher) === ROT
        && feld(vorher, 110) === "true"
        && feld(nachher, 111) === "7befc95e690d91b239e4368b41644871"
        && feld(nachher, 112) === "e979fee9e458bedc3b52609e936e7922"
        && feld(nachher, 113) === "sky_id,condition,item_type,sale_released,"
          + "delivery_scope,usk_rating,sellable,reason"
        && feld(nachher, 114) === "text,text,text,boolean,text,smallint,boolean,text"
        && feld(nachher, 131) === "857b767d4ad5ea9bfc2e333fd6605b1f"
        && feld(nachher, 132) === "f36137c40155375b92bae76b5dd63740"
        && feld(nachher, 133) === "a32b148cebe00ee0d0d469f96fd2028e"
        && feld(nachher, 201) === "0" && feld(nachher, 205) === "0"
        && feld(nachher, 401) === "0" && feld(nachher, 402) === "0"
        && typeof zweimal === "string" && zweimal.includes("steht schon"),
      sagt: `Vorher: ${vorherLauf ?? "durch"} (rot: ${rot(vorher)}, Funktion fehlt `
        + `${feld(vorher, 110)}) · 0141: ${lauf ?? "durch"} · Nachher: `
        + `${nachherLauf ?? "durch"} (rot: ${rot(nachher)}) · Rumpf `
        + `${feld(nachher, 111).slice(0, 8)}… · Spalten ${feld(nachher, 113)}`
        + ` · Nachbarn ${feld(nachher, 131).slice(0, 8)}…/`
        + `${feld(nachher, 132).slice(0, 8)}…/${feld(nachher, 133).slice(0, 8)}…`
        + ` · freigegeben ${feld(nachher, 201)} · Belegsperre `
        + `${feld(nachher, 401)}/${feld(nachher, 402)} · zweiter Lauf: `
        + `${zweimal === null ? "DURCHGELAUFEN — Befund" : "prallt ab"}`,
    });
  }

  /* P48 — `0142`: DIE GESPEICHERTEN KALKULATIONEN (Calculator V2).
   *
   * Eine neue Tabelle mit vier Richtlinien. Was ein Probelauf daran prueft
   * und kein Test im Arbeitsbaum:
   *
   *   1. Sie laeuft in einer Transaktion durch, und ihre Nachbedingungen
   *      halten — zwoelf Spalten, RLS an, vier Policies, zwei Indizes, der
   *      `updated_at`-Trigger, kein Recht fuer `anon`, keine Zeile.
   *   2. Ein ZWEITER Lauf prallt ab. Eine Migration, die sich zweimal
   *      anwenden laesst, ist eine Falle.
   *   3. Der partielle Unique-Index laesst `null` beliebig oft zu und einen
   *      Einkauf genau einmal — das ist die halbe Sperre gegen eine zweite
   *      Uebernahme ins Orderbuch, und sie wird hier gefahren.
   *   4. Der CHECK auf `lines` weist etwas ab, das kein Array ist.
   *   5. Die Ruecknahme laeuft, solange keine Zeile steht — und bricht ab,
   *      sobald eine steht.
   *
   * Das STUB-SCHEMA traegt die Tabelle schon (es entsteht aus allen
   * Migrationen), deshalb faellt sie vorher. Dass `0142` auf eine bereits
   * stehende Tabelle mit einem Abbruch antwortet, ist genau Fall 2.
   */
  {
    const M142 = join(MIG_DIR, "0142_purchase_calculations.sql");
    const R142 = "supabase/rollback/R0142_drop_purchase_calculations.sql";
    const wert = async (db: InstanceType<typeof PGlite>, sql: string): Promise<string> =>
      String(((await db.query(sql)) as { rows: Record<string, unknown>[] }).rows[0]?.w ?? "?");

    const db = await frisch();
    await db.exec("drop table if exists public.purchase_calculations cascade;");
    /*
     * EINE HUELLE FUER `auth.users`.
     *
     * Das Stub-Schema beschreibt `public`; `auth.users` bringt Supabase mit,
     * und keine Migration beschreibt sie (dieselbe Grenze, an der
     * `system_auth_inventory()` in Stufe 3 als begruendete Ausnahme steht).
     * Hier steht deshalb eine Huelle mit genau der Spalte, auf die der
     * Fremdschluessel zeigt — damit der Lauf etwas zu referenzieren hat.
     * Ueber die echte Tabelle sagt das nichts, und es soll auch nichts
     * sagen: gepruefft wird `0142`, nicht Supabase.
     */
    await db.exec(`
      create schema if not exists auth;
      create table if not exists auth.users (id uuid primary key);
      insert into auth.users (id) values ('11111111-1111-1111-1111-111111111111')
        on conflict do nothing;`);

    /*
     * UND EIN SCHLUESSEL AUF `purchases.id`.
     *
     * Das Stub-Schema ist reine Struktur: es uebernimmt Spalten und Typen,
     * aber keine Schluessel (`id bigint`, kein `primary key`). Ein
     * Fremdschluessel braucht aber einen eindeutigen Schluessel auf der
     * Gegenseite, sonst antwortet PostgreSQL mit `42830` — was hier
     * passierte und eine Auskunft ueber den Stub war, nicht ueber `0142`.
     * In der Wirklichkeit ist `purchases.id`
     * `generated always as identity primary key` (0053).
     */
    await db.exec(
      "alter table public.purchases add constraint z_purchases_pk primary key (id);");

    /* Die drei Attrappen, die die Baseline messbar machen — s. Helfer. */
    await attrappenFuerBaseline(db);

    /*
     * 0. DIE BASELINE, SO WIE DER BEDIENER SIE BEKOMMT.
     *
     * Seit dem 2026-10-25 vergleicht die Nachkontrolle die sieben
     * Geschaeftszahlen nicht gegen Konstanten, sondern gegen den Stand VOR
     * der Migration — uebergeben als eine Zeile aus Zeile 900 des
     * Preflights. Hier wird genau dieser Weg gefahren: erst den Preflight
     * lesen, dann die Migration, dann die Nachkontrolle MIT der Zeile.
     * Damit ist die Uebergabe selbst geprueft und nicht nur beschrieben.
     */
    const basisBlatt = (await db.query(
      readFileSync("supabase/checks/0142_preflight.sql", "utf8"))) as {
        rows: { nr: number; befund: string }[] };
    const basis142 = basisBlatt.rows.find((r) => r.nr === 900)?.befund ?? "(keine)";

    /* 1. Der Lauf. */
    const lauf = await fahre(db, M142);

    const spalten = lauf === null ? await wert(db,
      "select string_agg(column_name, ',' order by ordinal_position) as w "
      + "from information_schema.columns where table_schema = 'public' "
      + "and table_name = 'purchase_calculations'") : "-";
    const policies = lauf === null ? await wert(db,
      "select count(*)::text as w from pg_policies where schemaname = 'public' "
      + "and tablename = 'purchase_calculations'") : "-";
    const rls = lauf === null ? await wert(db,
      "select relrowsecurity::text as w from pg_class "
      + "where oid = 'public.purchase_calculations'::regclass") : "-";

    /*
     * 1b. UND DIE NACHKONTROLLE, GEFAHREN — SOLANGE DIE TABELLE LEER IST.
     *
     * `0142_postflight.sql` ist das Blatt, das der Bediener nach der
     * Migration liest. Seine Erwartungen sind damit geprueft, nicht
     * behauptet — bis auf EINE Zeile, die ein Stub nicht erfuellen kann:
     * 502 verlangt die vier eigenen Richtlinien von `collection_items`, und
     * das Stub-Schema ist reine Struktur OHNE Richtlinien. Sie wird
     * namentlich zugelassen; jede andere rote Zeile laesst diesen Durchgang
     * scheitern.
     *
     * (Bis zum 2026-10-22 zaehlte diese Zeile Richtlinien und verlangte
     * „genau vier". Auf Staging sind es fuenf — `staging-agent-setup.sql`
     * legt eine Lesepolicy fuer die Pruefrolle an —, und eine Zahl war
     * damit die falsche Formulierung. Siehe den Kommentar im Postflight.)
     *
     * SIE LAEUFT HIER UND NICHT WEITER UNTEN: Zeile 104 verlangt eine LEERE
     * Tabelle, und die Einfuegeproben unten legen Zeilen an. Eine
     * Nachkontrolle nach ihnen haette 104 rot gemeldet — eine Auskunft ueber
     * die Reihenfolge dieses Durchgangs, nicht ueber die Migration.
     */
    let nachRot = "-";
    let nachZeilen = "-";
    let nachLeer = "-";
    if (lauf === null) {
      await db.exec("begin;");
      await db.exec(`select set_config('skyisles.base', `
        + `'${basis142.split("'").join("''")}', true);`);
      const blatt = await db.query(
        readFileSync("supabase/checks/0142_postflight.sql", "utf8")) as {
          rows: { nr: number; befund: string; ok: boolean | null }[] };
      await db.exec("rollback;");
      nachRot = blatt.rows.filter((r) => r.ok === false).map((r) => r.nr).join(", ");
      nachZeilen = blatt.rows.find((r) => r.nr === 102)?.befund ?? "(fehlt)";
      /*
       * Zeile 104 ist seit dem 2026-10-22 eine MESSUNG und keine Erwartung
       * mehr (eine Kalkulation, die jemand speichert, ist keine
       * Abweichung). Dass die Migration selbst keine Zeile anlegt, wird
       * deshalb hier gelesen — unmittelbar nach ihr, wo die Aussage gilt.
       */
      nachLeer = blatt.rows.find((r) => r.nr === 104)?.befund ?? "(fehlt)";
    }


    /* 2. Noch einmal — muss abbrechen. */
    const zweimal = lauf === null ? await fahre(db, M142) : "-";

    /*
     * 3. Der partielle Unique-Index, gefahren. Zwei Zeilen ohne Einkauf
     *    muessen gehen, zwei mit demselben nicht. `auth.users` ist im Stub
     *    eine Huelle ohne Zeilen, deshalb faellt der Fremdschluessel vorher
     *    — gepruefft wird der INDEX, nicht die Fremdschluessel.
     */
    let zweiNull = "-";
    let doppelt = "-";
    if (lauf === null) {
      /* Ein echter Einkauf, damit `purchase_id` auf etwas zeigt: so prueft
         dieser Durchgang den Index UND den Fremdschluessel, statt einen
         davon wegzunehmen. */
      await db.exec(
        "insert into public.purchases (id, purchased_at, total_cost) "
        + "values (7, '2026-10-22', 10.00) on conflict do nothing;");
      try {
        await db.exec(`
          insert into public.purchase_calculations (user_id, name, factor_percent)
          values ('11111111-1111-1111-1111-111111111111', 'A', 50),
                 ('11111111-1111-1111-1111-111111111111', 'B', 50);`);
        zweiNull = "zwei ohne Einkauf: ok";
      } catch (fehler) {
        zweiNull = `BEFUND: ${(fehler as Error).message}`;
      }
      try {
        await db.exec(`
          insert into public.purchase_calculations (user_id, name, factor_percent, purchase_id)
          values ('11111111-1111-1111-1111-111111111111', 'C', 50, 7),
                 ('11111111-1111-1111-1111-111111111111', 'D', 50, 7);`);
        doppelt = "DURCHGELAUFEN — Befund";
      } catch {
        doppelt = "abgewiesen";
      }
    }

    /* 4. Der CHECK auf `lines`. */
    let keinArray = "-";
    if (lauf === null) {
      try {
        await db.exec(`
          insert into public.purchase_calculations (user_id, name, factor_percent, lines)
          values ('11111111-1111-1111-1111-111111111111', 'E', 50,
                 '{"version": 1, "lines": "nein"}'::jsonb);`);
        keinArray = "DURCHGELAUFEN — Befund";
      } catch {
        keinArray = "abgewiesen";
      }
    }

    /* 5. Die Ruecknahme: mit Zeilen abbrechen, ohne Zeilen durchlaufen. */
    const mitZeilen = lauf === null ? await fahre(db, R142) : "-";
    if (lauf === null) await db.exec("delete from public.purchase_calculations;");
    const ohneZeilen = lauf === null ? await fahre(db, R142) : "-";
    const fort = lauf === null && ohneZeilen === null
      ? await wert(db, "select (to_regclass('public.purchase_calculations') is null)::text as w")
      : "-";

    probe.push({
      name: "P48 0142 legt die Kalkulationstabelle an: vier Policies, RLS, der partielle "
        + "Unique-Index greift, zweiter Lauf prallt ab, Ruecknahme schuetzt Zeilen",
      ok: lauf === null
        && spalten === "id,user_id,name,status,lines,factor_percent,total_cents,"
          + "positions,units,purchase_id,created_at,updated_at"
        /* Die Nachkontrolle: nur die eine Stub-Zeile darf rot sein. */
        && nachRot === "502, 9999" && nachZeilen === spalten && nachLeer === "0"
        && policies === "4" && rls === "true"
        && typeof zweimal === "string" && zweimal.includes("steht schon")
        && zweiNull === "zwei ohne Einkauf: ok" && doppelt === "abgewiesen"
        && keinArray === "abgewiesen"
        && typeof mitZeilen === "string" && mitZeilen.includes("Zeile(n) stehen in der Tabelle")
        && ohneZeilen === null && fort === "true",
      sagt: `0142: ${lauf ?? "durch"} · ${policies} Policies · RLS ${rls}`
        + ` · Nachkontrolle rot: ${nachRot} (Zeilen nach der Migration ${nachLeer})`
        + `${nachRot === "502, 9999" ? " (nur die Stub-Zeile 502)" : ""}`
        + ` · zweiter Lauf: ${zweimal === null ? "DURCHGELAUFEN — Befund" : "prallt ab"}`
        + ` · ${zweiNull} · derselbe Einkauf zweimal: ${doppelt}`
        + ` · lines ohne Array: ${keinArray}`
        + ` · Ruecknahme mit Zeilen: ${mitZeilen === null ? "DURCHGELAUFEN — Befund" : "bricht ab"}`
        + ` · ohne Zeilen: ${ohneZeilen ?? "durch"} (Tabelle fort ${fort})`,
    });
  }

  /* P49 — `0143`: EIN EINKAUF AUS EINER KALKULATION, UND NUR EINER.
   *
   * Die Funktion legt den Einkauf nicht selbst an — sie ruft die bestehende
   * und schreibt in DERSELBEN Transaktion die Verknuepfung. Was ein Probelauf
   * daran zeigt und kein Test im Arbeitsbaum:
   *
   *   1. Ohne Betriebsrolle weist sie ab (Riegel 1).
   *   2. Mit Rolle, aber fremder oder unbekannter Kalkulation: „not found"
   *      (Riegel 2) — und zwar derselbe Satz fuer beide Faelle.
   *   3. Der gute Fall: ein Einkauf entsteht, die Kalkulation zeigt darauf,
   *      und die Positionen sind die uebergebenen.
   *   4. Dasselbe noch einmal mit demselben Token: KEIN zweiter Einkauf,
   *      dieselbe Antwort (die Idempotenz aus `0120` traegt durch).
   *   5. Und mit einem NEUEN Token: abgewiesen (Riegel 3) — **und kein
   *      Einkauf zurueckgelassen.** Das ist der Teilzustand, um den es geht.
   *
   * WAS DAFUER GESTELLT WIRD. `auth.uid()` ist im Stub `null`, und
   * `can_operate_active_seller()` liest Tabellen, die hier leer sind. Beide
   * werden deshalb fuer diesen Durchgang ERSETZT — sichtbar und begrenzt:
   * `auth.uid()` gibt eine feste Kennung, die Rolle gibt `true`. Geprueft
   * wird damit `0143`, nicht die Rollenlogik; dass die Rolle ueberhaupt
   * gefragt wird, ist Fall 1.
   */
  {
    const M143 = join(MIG_DIR, "0143_purchase_from_calculation.sql");
    const R143 = "supabase/rollback/R0143_drop_purchase_from_calculation.sql";
    const KONTO = "22222222-2222-2222-2222-222222222222";
    const wert = async (db: InstanceType<typeof PGlite>, sql: string): Promise<string> =>
      String(((await db.query(sql)) as { rows: Record<string, unknown>[] }).rows[0]?.w ?? "?");

    const db = await frisch();
    /*
     * Der Stand, auf dem `0143` aufsetzt: `0142` angewendet, `0143` nicht.
     *
     * Das Stub-Schema entsteht aus ALLEN Migrationen und traegt die Tabelle
     * und die Funktion deshalb schon. Beide fallen, damit die zwei
     * Migrationen hier wirklich LAUFEN und nicht an ihrer eigenen
     * „steht schon"-Pruefung abprallen — dass sie das tun, prueft P48
     * (Tabelle) und Fall 1 unten nicht, sondern die Migration selbst.
     */
    await db.exec("drop table if exists public.purchase_calculations cascade;");
    await db.exec(`
      drop function if exists public.seller_create_purchase_from_calculation(
        uuid, date, numeric, text, boolean, jsonb, text, text, numeric, numeric,
        numeric, text, text, text);`);
    await db.exec(`
      create schema if not exists auth;
      create table if not exists auth.users (id uuid primary key);
      insert into auth.users (id) values ('${KONTO}') on conflict do nothing;
      alter table public.purchases add constraint z_purchases_pk primary key (id);
      -- IDENTITAETEN AUF purchases.id UND purchase_items.id.
      --
      -- Das Stub-Schema ist reine Struktur: id bigint, kein
      -- "generated always as identity" und kein Default. 0053 legt beide als
      -- Identitaet an; ohne sie scheitert schon seller_create_purchase mit
      -- "null value in column id", und das waere eine Auskunft ueber den
      -- Stub, nicht ueber 0143. Dieselbe Vorkehrung wie bei
      -- shop_inventory.id in P45.
      --
      -- (Als SQL-Kommentar, nicht als Blockkommentar: dieser Text steht in
      -- einem Template-Literal, und ein Gravis darin wuerde es beenden.)
      create sequence if not exists public.z_purchase_id_seq start 1;
      alter table public.purchases
        alter column id set default nextval('public.z_purchase_id_seq');
      create sequence if not exists public.z_purchase_item_id_seq start 1;
      alter table public.purchase_items
        alter column id set default nextval('public.z_purchase_item_id_seq');`);
    const f142 = await fahre(db, join(MIG_DIR, "0142_purchase_calculations.sql"));
    if (f142 !== null) throw new Error(`P49 Aufbau: 0142 scheiterte — ${f142}`);

    /* Die drei Attrappen, die die Baseline messbar machen — s. Helfer. */
    await attrappenFuerBaseline(db);

    /*
     * Und die Baseline, wie der Bediener sie bekommt: Zeile 900 des
     * Preflights zu `0143`. Sie wird unten in derselben Klammer wie die
     * Nachkontrolle gesetzt — `set_config(…, true)` gilt nur dort.
     */
    const basisBlatt143 = (await db.query(
      readFileSync("supabase/checks/0143_preflight.sql", "utf8"))) as {
        rows: { nr: number; befund: string }[] };
    const basis143 = basisBlatt143.rows.find((r) => r.nr === 900)?.befund ?? "(keine)";

    const lauf = await fahre(db, M143);

    /* 1. Ohne Betriebsrolle. `can_operate_active_seller()` liest im Stub
     *    leere Tabellen und antwortet `false` — genau der Fall. */
    const eineKalkulation = async (name: string): Promise<string> => wert(db, `
      insert into public.purchase_calculations (user_id, name, factor_percent, lines)
      values ('${KONTO}', '${name}', 55,
              '{"version": 1, "lines": [{"sky_id": "SKY-0001", "quantity": 2}]}'::jsonb)
      returning id::text as w`);
    const idA = lauf === null ? await eineKalkulation("A") : "-";
    const RUF = (id: string, token: string) => `
      select public.seller_create_purchase_from_calculation(
        '${id}'::uuid, '2026-10-22'::date, 10.00, null, false,
        '[{"sky_id": "SKY-0001"}, {"sky_id": "SKY-0001"}]'::jsonb,
        null, null, null, null, null, null, null, '${token}') as w`;

    let ohneRolle = "-";
    if (lauf === null) {
      try { await db.query(RUF(idA, "00000000-0000-4000-8000-000000000001"));
            ohneRolle = "DURCHGELAUFEN — Befund"; }
      catch (f) { ohneRolle = (f as Error).message.includes("seller operator role required")
        ? "abgewiesen" : `anderer Fehler: ${(f as Error).message}`; }
    }

    /* Ab hier mit Rolle und Kennung — beide ersetzt, siehe Kopf. */
    if (lauf === null) {
      await db.exec(`
        create or replace function public.can_operate_active_seller() returns boolean
          language sql stable as $stub$ select true $stub$;
        create or replace function auth.uid() returns uuid
          language sql stable as $stub$ select '${KONTO}'::uuid $stub$;`);
    }

    /* 2. Fremde oder unbekannte Kalkulation. */
    let fremd = "-";
    if (lauf === null) {
      try { await db.query(RUF("33333333-3333-3333-3333-333333333333",
                               "00000000-0000-4000-8000-000000000002"));
            fremd = "DURCHGELAUFEN — Befund"; }
      catch (f) { fremd = (f as Error).message.includes("calculation not found")
        ? "not found" : `anderer Fehler: ${(f as Error).message}`; }
    }

    /* 3. Der gute Fall. */
    let einkauf = "-";
    let verknuepft = "-";
    let positionen = "-";
    const TOKEN = "00000000-0000-4000-8000-000000000003";
    if (lauf === null) {
      einkauf = await wert(db, RUF(idA, TOKEN));
      verknuepft = await wert(db,
        `select (purchase_id = ${einkauf})::text as w from public.purchase_calculations
          where id = '${idA}'`);
      positionen = await wert(db,
        `select count(*)::text as w from public.purchase_items
          where purchase_id = ${einkauf}`);
    }

    /* 4. Dasselbe noch einmal, derselbe Token. */
    let nochmal = "-";
    let anzahlDanach = "-";
    if (lauf === null) {
      nochmal = await wert(db, RUF(idA, TOKEN));
      anzahlDanach = await wert(db, "select count(*)::text as w from public.purchases");
    }

    /* 5. Neuer Token auf dieselbe Kalkulation — und kein Einkauf dazu. */
    let zweiterVersuch = "-";
    let anzahlZuletzt = "-";
    if (lauf === null) {
      try { await db.query(RUF(idA, "00000000-0000-4000-8000-000000000004"));
            zweiterVersuch = "DURCHGELAUFEN — Befund"; }
      catch (f) { zweiterVersuch = (f as Error).message.includes("already handed over")
        ? "abgewiesen" : `anderer Fehler: ${(f as Error).message}`; }
      anzahlZuletzt = await wert(db, "select count(*)::text as w from public.purchases");
    }

    /*
     * 5b. UND DIE NACHKONTROLLE, GEFAHREN — vor der Ruecknahme, denn danach
     *     gibt es die Funktion nicht mehr.
     *
     * Ihre Erwartungen sind damit geprueft und nicht behauptet — bis auf
     * ZWEI Zeilen, die ein Stub nicht erfuellen kann, und das ist eine
     * lehrreiche Stelle:
     *
     *   601/602 verlangen, dass `seller_create_purchase_with_items` und
     *   `seller_create_purchase` GENAU EINMAL existieren. Im Stub gibt es
     *   drei bzw. zwei Signaturen, weil das Stub-Schema die Signaturen ALLER
     *   Migrationen anlegt und deren `drop function` nicht ausfuehrt. In
     *   einer echten Datenbank ist es genau eine: `0116` droppt die
     *   Fassung mit fuenf Parametern, bevor sie die mit zwoelf anlegt, und
     *   `0120` droppt die mit zwoelf, bevor sie die mit dreizehn anlegt.
     *
     * Die Pruefung ist deshalb RICHTIG und bleibt blockierend: zeigt sie auf
     * Staging oder Production mehr als eins, ist eine alte Overload
     * stehengeblieben — und dann gaebe es tatsaechlich zwei Wege, einen
     * Einkauf anzulegen. Hier werden die zwei Zeilen namentlich zugelassen;
     * jede andere rote laesst den Durchgang scheitern.
     */
    let postRot = "-";
    if (lauf === null) {
      await db.exec("begin;");
      await db.exec(`select set_config('skyisles.base', `
        + `'${basis143.split("'").join("''")}', true);`);
      const blatt = await db.query(
        readFileSync("supabase/checks/0143_postflight.sql", "utf8")) as {
          rows: { nr: number; befund: string; ok: boolean | null }[] };
      await db.exec("rollback;");
      postRot = blatt.rows.filter((r) => r.ok === false).map((r) => r.nr).join(", ");
    }

    /* Und die Ruecknahme laesst die Verknuepfung stehen. */
    const zurueck = lauf === null ? await fahre(db, R143) : "-";
    const bleibt = zurueck === null
      ? await wert(db, `select (purchase_id is not null)::text as w
                          from public.purchase_calculations where id = '${idA}'`)
      : "-";

    probe.push({
      name: "P49 0143 legt einen Einkauf aus einer Kalkulation an, verknuepft ihn in derselben "
        + "Transaktion und laesst keinen zweiten zu",
      ok: lauf === null
        && ohneRolle === "abgewiesen" && fremd === "not found"
        && einkauf !== "-" && verknuepft === "true" && positionen === "2"
        && nochmal === einkauf && anzahlDanach === "1"
        && zweiterVersuch === "abgewiesen" && anzahlZuletzt === "1"
        && postRot === "601, 602, 9999"
        && zurueck === null && bleibt === "true",
      sagt: `0143: ${lauf ?? "durch"} · ohne Rolle: ${ohneRolle}`
        + ` · fremde Kalkulation: ${fremd} · Einkauf ${einkauf} mit ${positionen} Positionen,`
        + ` verknuepft ${verknuepft} · zweiter Lauf desselben Entwurfs: ${nochmal}`
        + ` (Einkaeufe ${anzahlDanach}) · neuer Entwurf: ${zweiterVersuch}`
        + ` (Einkaeufe ${anzahlZuletzt}) · Nachkontrolle rot: ${postRot}`
        + `${postRot === "601, 602, 9999" ? " (nur 601/602: der Stub traegt alle "
          + "Signaturen, die echten Migrationen droppen die alten)" : ""}`
        + ` · Ruecknahme ${zurueck ?? "durch"},`
        + ` Verknuepfung bleibt ${bleibt}`,
    });
  }

  /* P50 — DIE BASELINE-UEBERGABE, und was eine falsche Basis anrichtet.
   *
   * ANLASS. Bis zum 2026-10-25 standen sieben Geschaeftszahlen als feste
   * Sollwerte im Preflight und blockierten dort. Am 2026-10-25 hielt genau
   * das den Production-Lauf an, weil der Betrieb Ware eingebucht hatte.
   * Seitdem messen sie im Preflight und werden in der Nachkontrolle gegen
   * das tatsaechliche Vorher verglichen — uebergeben als EINE Zeile.
   *
   * EINE UEBERGABE PER HAND IST EINE FEHLERQUELLE, also wird sie gefahren
   * und nicht beschrieben. Acht Faelle, und jeder muss anders ausgehen:
   *
   *   1. die richtige Zeile          → nur die Stub-Zeile 502 ist rot
   *   2. keine Zeile                 → 801 blockiert
   *   3. der Platzhalter steht noch  → 801 blockiert (er ist KEINE Basis)
   *   4. abgeschnitten (8 Felder)    → 803 blockiert
   *   5. ein Feld zuviel (10)        → 803 blockiert
   *   6. falsche Marke               → 802 blockiert
   *   7. zwei Felder vertauscht      → 804 blockiert (die Schutzsumme)
   *   8. ein Wert geaendert, Summe
   *      NICHT nachgerechnet         → 804 blockiert
   *   9. ein Wert geaendert UND die
   *      Summe nachgerechnet         → 811 blockiert — der VERGLEICH faengt
   *                                    es, nicht die Schutzsumme
   *
   * FALL 9 IST DER WICHTIGSTE. Er zeigt, dass die Schutzsumme nicht die
   * Sicherung ist, sondern nur die Bequemlichkeit: sie faengt Kopierfehler.
   * Was wirklich traegt, ist der Vergleich Wert gegen Wert.
   *
   * UND ER STEHT FUER DEN FALL, DEN EIN STUB NICHT BAUEN KANN: dass sich
   * zwischen Preflight und Nachkontrolle der SHOP bewegt. Aus Sicht der
   * Datei ist das dasselbe Ereignis — ein Wert, der nicht zur Basis passt —
   * und es landet auf derselben Zeile. Ein echter Wareneingang im Stub
   * braeuchte eine Katalogzeile, eine Lagerzeile und die Fremdschluessel
   * dazu; das waere eine Auskunft ueber das Stub-Schema und nicht ueber den
   * Vergleich.
   */
  {
    const M142 = join(MIG_DIR, "0142_purchase_calculations.sql");
    const POST = readFileSync("supabase/checks/0142_postflight.sql", "utf8");
    const PRE = readFileSync("supabase/checks/0142_preflight.sql", "utf8");

    const db = await frisch();
    await db.exec("drop table if exists public.purchase_calculations cascade;");
    await db.exec(`
      create schema if not exists auth;
      create table if not exists auth.users (id uuid primary key);`);
    await db.exec(
      "alter table public.purchases add constraint z_purchases_pk primary key (id);");

    /* Die drei Attrappen, die die Baseline messbar machen — s. Helfer. */
    await attrappenFuerBaseline(db);

    /* Die Basis, wie der Bediener sie bekommt: Zeile 900 des Preflights. */
    const vorBlatt = (await db.query(PRE)) as { rows: { nr: number; befund: string }[] };
    const echt = vorBlatt.rows.find((r) => r.nr === 900)?.befund ?? "(keine)";

    const aufbau = await fahre(db, M142);

    /** Die Nachkontrolle mit einer gegebenen Basis fahren; rote Zeilen zurueck. */
    const rot = async (basis: string | null): Promise<string> => {
      await db.exec("begin;");
      if (basis !== null) {
        await db.exec(`select set_config('skyisles.base', `
          + `'${basis.split("'").join("''")}', true);`);
      }
      const blatt = (await db.query(POST)) as {
        rows: { nr: number; ok: boolean | null }[] };
      await db.exec("rollback;");
      return blatt.rows.filter((r) => r.ok === false).map((r) => r.nr).join(", ");
    };

    const teile = echt.split("|");
    const summe = (kern: string): string =>
      createHash("md5").update(kern).digest("hex").slice(0, 12);
    /* Fall 7: die beiden Abdruecke tauschen. */
    const vertauscht = [...teile];
    [vertauscht[3], vertauscht[8]] = [vertauscht[8], vertauscht[3]];
    /* Fall 8/9: eine Zahl veraendern — einmal ohne, einmal mit neuer Summe. */
    const geaendert = [...teile];
    geaendert[1] = String(Number(teile[1]) + 1);
    const ohneSumme = geaendert.join("|");
    const mitSumme = [...geaendert.slice(0, 8),
      summe(geaendert.slice(1, 8).join("|"))].join("|");

    const f1 = aufbau === null ? await rot(echt) : "-";
    const f2 = aufbau === null ? await rot(null) : "-";
    const f3 = aufbau === null ? await rot("BASIS-HIER-EINSETZEN") : "-";
    const f4 = aufbau === null ? await rot(teile.slice(0, 8).join("|")) : "-";
    const f5 = aufbau === null ? await rot(echt + "|zuviel") : "-";
    const f6 = aufbau === null
      ? await rot(["skyisles-base-9", ...teile.slice(1)].join("|")) : "-";
    const f7 = aufbau === null ? await rot(vertauscht.join("|")) : "-";
    const f8 = aufbau === null ? await rot(ohneSumme) : "-";
    const f9 = aufbau === null ? await rot(mitSumme) : "-";

    /* Die Erwartungen. 502 ist im Stub immer rot (keine Richtlinien). */
    const ALLE_SIEBEN = "811, 812, 813, 814, 815, 816, 817";
    const e1 = "502, 9999";
    const e2 = `502, 801, 802, 803, 804, ${ALLE_SIEBEN}, 9999`;
    const e4 = `502, 803, 804, ${ALLE_SIEBEN}, 9999`;
    const e6 = `502, 802, ${ALLE_SIEBEN}, 9999`;
    const e7 = `502, 804, ${ALLE_SIEBEN}, 9999`;
    const e9 = "502, 811, 9999";

    probe.push({
      name: "P50 die Baseline-Uebergabe: die richtige Zeile laeuft durch, und eine "
        + "fehlende, abgeschnittene, vertauschte oder manipulierte blockiert",
      ok: aufbau === null
        && echt.startsWith("skyisles-base-1|") && teile.length === 9
        && f1 === e1 && f2 === e2 && f3 === e2 && f4 === e4 && f5 === e4
        && f6 === e6 && f7 === e7 && f8 === e7 && f9 === e9,
      sagt: `Basis aus Zeile 900: ${teile.length} Felder, Marke ${teile[0]}`
        + ` · richtig: ${f1}${f1 === e1 ? " (nur die Stub-Zeile)" : " BEFUND"}`
        + ` · fehlt: ${f2 === e2 ? "801 blockiert" : `BEFUND ${f2}`}`
        + ` · Platzhalter: ${f3 === e2 ? "801 blockiert" : `BEFUND ${f3}`}`
        + ` · 8 Felder: ${f4 === e4 ? "803 blockiert" : `BEFUND ${f4}`}`
        + ` · 10 Felder: ${f5 === e4 ? "803 blockiert" : `BEFUND ${f5}`}`
        + ` · falsche Marke: ${f6 === e6 ? "802 blockiert" : `BEFUND ${f6}`}`
        + ` · vertauscht: ${f7 === e7 ? "804 blockiert" : `BEFUND ${f7}`}`
        + ` · Wert ohne neue Summe: ${f8 === e7 ? "804 blockiert" : `BEFUND ${f8}`}`
        + ` · Wert MIT neuer Summe: ${f9 === e9 ? "811 blockiert (der Vergleich)" : `BEFUND ${f9}`}`,
    });
  }

  /* P51 — `0144`: DIE SICHERUNGSFUNKTION WIRD ERSETZT.
   *
   * Das ist der heikelste Lauf dieses Projekts: `system_platform_export()`
   * IST unsere Absicherung, und ein Fehler darin faellt erst auf, wenn man
   * sie braucht. Was ein Probelauf daran zeigt und kein Test im Arbeitsbaum:
   *
   *   1. Der Abdruck, auf dem die Migration besteht, ist der, den
   *      PostgreSQL wirklich speichert. Lokal gerechnet und hier gemessen —
   *      das Verfahren selbst wird geprueft, nicht nur sein Ergebnis.
   *   2. Ohne `0142` bricht sie ab.
   *   3. Gegen eine FREMDE Fassung bricht sie ab, statt sie zu
   *      ueberschreiben. Das ist der Riegel, der sie von einem Blindflug
   *      unterscheidet.
   *   4. Der gute Lauf: 54 Bereiche, Attribute und Rechte unveraendert.
   *   5. Ein zweiter Lauf prallt ab.
   *   6. Die Ruecknahme stellt den alten Rumpf zeichengleich wieder her —
   *      und laesst die gespeicherten Kalkulationen stehen.
   *   7. Auch die Ruecknahme ist idempotent und weist eine dritte Fassung ab.
   *
   * DER STUB TRAEGT SCHON DEN NEUEN RUMPF, weil das Stub-Schema aus ALLEN
   * Migrationen entsteht — `0144` eingeschlossen. Production steht aber auf
   * `0143`. Deshalb wird hier zuerst der Rumpf aus `0105` eingesetzt: das
   * ist die Lage, in der die Migration wirklich laeuft.
   */
  {
    const M142 = join(MIG_DIR, "0142_purchase_calculations.sql");
    const M144 = join(MIG_DIR, "0144_platform_export_calculations.sql");
    const R144 = "supabase/rollback/R0144_platform_export_back_to_0105.sql";
    const ALT = "2e2da90e976a1e73ca00aba7cd830fae";
    const NEU = "4c4d2e7c81e4efa8e18cdffa06bba40a";

    /** Die Funktionsanweisung einer Datei, von `create` bis `$$;`. */
    const anweisungVon = (datei: string): string => {
      const sql = readFileSync(datei, "utf8");
      const von = sql.indexOf("create or replace function public.system_platform_export()");
      const bis = sql.indexOf("\n$$;", von) + "\n$$;".length;
      return sql.slice(von, bis);
    };
    const abdruck = async (db: InstanceType<typeof PGlite>): Promise<string> => {
      const r = (await db.query(
        "select md5(prosrc) as w from pg_proc p join pg_namespace n on n.oid = p.pronamespace"
        + " where n.nspname = 'public' and p.proname = 'system_platform_export'")) as {
          rows: { w: string }[] };
      return r.rows[0]?.w ?? "(keine Funktion)";
    };
    const zahl = async (db: InstanceType<typeof PGlite>, sql: string): Promise<string> => {
      const r = (await db.query(sql)) as { rows: Record<string, unknown>[] };
      return String(r.rows[0]?.w ?? "?");
    };

    const db = await frisch();
    await db.exec("drop table if exists public.purchase_calculations cascade;");
    await db.exec(`
      create schema if not exists auth;
      create table if not exists auth.users (id uuid primary key);
      insert into auth.users (id) values ('11111111-1111-1111-1111-111111111111')
        on conflict do nothing;`);
    await db.exec(
      "alter table public.purchases add constraint z_purchases_pk primary key (id);");

    /* Der Stand, auf dem Production steht: der Rumpf aus `0105`. */
    await db.exec("set check_function_bodies = off;");
    await db.exec(anweisungVon(join(MIG_DIR, "0105_platform_export.sql")));
    await db.exec("set check_function_bodies = on;");
    const vorher = await abdruck(db);

    /* 2. Ohne `0142` muss `0144` abbrechen. */
    const ohne0142 = await fahre(db, M144);

    /* Jetzt `0142`, damit die Vorbedingung erfuellt ist. */
    const f142 = await fahre(db, M142);
    if (f142 !== null) throw new Error(`P51 Aufbau: 0142 scheiterte — ${f142}`);

    /* Eine echte Kalkulation, damit die Ruecknahme etwas zu verschonen hat. */
    await db.exec(`
      insert into public.purchase_calculations
        (user_id, name, factor_percent, lines, total_cents, positions, units)
      values ('11111111-1111-1111-1111-111111111111', 'P51', 50,
              '{"version": 1, "lines": []}'::jsonb, 0, 0, 0);`);

    /* 3. Eine FREMDE Fassung darf nicht ueberschrieben werden. */
    await db.exec("set check_function_bodies = off;");
    await db.exec(`create or replace function public.system_platform_export()
      returns jsonb language sql stable security definer set search_path = ''
      as $fremd$ select null::jsonb; $fremd$;`);
    await db.exec("set check_function_bodies = on;");
    const fremd = await fahre(db, M144);

    /* Zurueck auf den Stand aus `0105` und dann der gute Lauf. */
    await db.exec("set check_function_bodies = off;");
    await db.exec(anweisungVon(join(MIG_DIR, "0105_platform_export.sql")));
    await db.exec("set check_function_bodies = on;");
    const lauf = await fahre(db, M144);

    const nachher = lauf === null ? await abdruck(db) : "-";
    const bereiche = lauf === null ? await zahl(db,
      "select ((length(prosrc) - length(replace(prosrc, 'coalesce((', '')))"
      + " / length('coalesce(('))::text as w from pg_proc p"
      + " join pg_namespace n on n.oid = p.pronamespace"
      + " where n.nspname = 'public' and p.proname = 'system_platform_export'") : "-";
    const attribute = lauf === null ? await zahl(db,
      "select (prosecdef::text || '/' || provolatile::text || '/'"
      /*
       * `search_path=""` UND NICHT `search_path=`. Gemessen, nicht geraten:
       * PostgreSQL legt `set search_path = ''` als `search_path=""` ab —
       * mit zwei echten Anfuehrungszeichen. Die erste Fassung dieses
       * Probelaufs verlangte `search_path=` und war deshalb rot; dieselbe
       * falsche Erwartung stand auch in der Nachkontrolle zu `0144` und
       * waere auf Production aufgefallen. Genau dafuer ist P51 da.
       */
      + " || (coalesce(array_to_string(proconfig, ','), '') = 'search_path=\"\"')::text) as w"
      + " from pg_proc p join pg_namespace n on n.oid = p.pronamespace"
      + " where n.nspname = 'public' and p.proname = 'system_platform_export'") : "-";
    const offen = lauf === null ? await zahl(db,
      "select count(*)::text as w from pg_proc p, aclexplode(p.proacl) a"
      + " where p.oid = to_regprocedure('public.system_platform_export()')"
      + " and a.privilege_type = 'EXECUTE'"
      + " and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'public'))") : "-";
    const fuerAuth = lauf === null ? await zahl(db,
      "select count(*)::text as w from pg_proc p, aclexplode(p.proacl) a"
      + " where p.oid = to_regprocedure('public.system_platform_export()')"
      + " and a.privilege_type = 'EXECUTE'"
      + " and a.grantee::regrole::text = 'authenticated'") : "-";

    /* 5. Ein zweiter Lauf prallt ab. */
    const zweimal = lauf === null ? await fahre(db, M144) : "-";

    /* 6. Die Ruecknahme — und was sie verschont. */
    const zurueck = lauf === null ? await fahre(db, R144) : "-";
    const danach = zurueck === null ? await abdruck(db) : "-";
    const bereicheDanach = zurueck === null ? await zahl(db,
      "select ((length(prosrc) - length(replace(prosrc, 'coalesce((', '')))"
      + " / length('coalesce(('))::text as w from pg_proc p"
      + " join pg_namespace n on n.oid = p.pronamespace"
      + " where n.nspname = 'public' and p.proname = 'system_platform_export'") : "-";
    const zeilenDanach = zurueck === null
      ? await zahl(db, "select count(*)::text as w from public.purchase_calculations") : "-";

    /* 7. Noch einmal zuruecknehmen: aendert nichts. Und eine dritte Fassung. */
    const nochmalZurueck = zurueck === null ? await fahre(db, R144) : "-";
    let dritteFassung = "-";
    if (nochmalZurueck === null) {
      await db.exec("set check_function_bodies = off;");
      await db.exec(`create or replace function public.system_platform_export()
        returns jsonb language sql stable security definer set search_path = ''
        as $dritt$ select '{}'::jsonb; $dritt$;`);
      await db.exec("set check_function_bodies = on;");
      const r = await fahre(db, R144);
      dritteFassung = r === null ? "DURCHGELAUFEN — Befund" : "abgewiesen";
    }

    probe.push({
      name: "P51 0144 ersetzt die Sicherungsfunktion: Abdruck gemessen, ohne 0142 und gegen "
        + "eine fremde Fassung abgewiesen, 54 Bereiche, Rechte gleich, Ruecknahme verschont "
        + "die Kalkulationen",
      ok: vorher === ALT
        && typeof ohne0142 === "string" && ohne0142.includes("setzt 0142 voraus")
        && typeof fremd === "string" && fremd.includes("nicht blind ueberschrieben")
        && lauf === null && nachher === NEU && bereiche === "54"
        && attribute === "true/s/true" && offen === "0" && fuerAuth === "1"
        && typeof zweimal === "string" && zweimal.includes("bereits angewendet")
        && zurueck === null && danach === ALT && bereicheDanach === "53"
        && zeilenDanach === "1"
        && nochmalZurueck === null && dritteFassung === "abgewiesen",
      sagt: `Abdruck vorher ${vorher === ALT ? "wie gerechnet" : `ABWEICHUNG ${vorher}`}`
        + ` · ohne 0142: ${ohne0142 === null ? "DURCHGELAUFEN — Befund" : "abgewiesen"}`
        + ` · fremde Fassung: ${fremd === null ? "UEBERSCHRIEBEN — Befund" : "abgewiesen"}`
        + ` · Lauf: ${lauf ?? "durch"} · ${bereiche} Bereiche · Abdruck`
        + ` ${nachher === NEU ? "wie gerechnet" : `ABWEICHUNG ${nachher}`}`
        + ` · definer/volatility/search_path ${attribute}`
        + ` · offene EXECUTE ${offen}, authenticated ${fuerAuth}`
        + ` · zweiter Lauf: ${zweimal === null ? "DURCHGELAUFEN — Befund" : "prallt ab"}`
        + ` · Ruecknahme ${zurueck ?? "durch"} → ${bereicheDanach} Bereiche,`
        + ` Abdruck ${danach === ALT ? "wieder 0105" : `ABWEICHUNG ${danach}`},`
        + ` Kalkulationen ${zeilenDanach} (unberuehrt)`
        + ` · zweite Ruecknahme: ${nochmalZurueck === null ? "aendert nichts" : "BEFUND"}`
        + ` · dritte Fassung: ${dritteFassung}`,
    });
  }


  /* P52 — `0145`: DIE FAVORITEN.
   *
   * Eine neue Tabelle mit DREI Richtlinien und einer Aggregatfunktion. Was
   * ein Probelauf daran prueft und kein Test im Arbeitsbaum:
   *
   *   1. Sie laeuft in einer Transaktion durch, und ihre Nachbedingungen
   *      halten — drei Spalten, der zusammengesetzte Primaerschluessel, RLS
   *      an, drei Richtlinien, der Index, kein Recht fuer `anon`, keine
   *      Zeile.
   *   2. Ein ZWEITER Lauf prallt ab.
   *   3. DER PRIMAERSCHLUESSEL GREIFT. Zweimal dieselbe Figur fuer dasselbe
   *      Konto wird abgewiesen; dieselbe Figur fuer ZWEI Konten geht, und
   *      zwei VARIANTEN fuer dasselbe Konto gehen auch — das ist die
   *      Zusage „Varianten getrennt" an echtem PostgreSQL gefahren.
   *   4. `on conflict do nothing` laeuft durch. Das ist die
   *      Endzustandssemantik der Oberflaeche: „Favorit" zweimal gesagt ist
   *      „Favorit".
   *   5. `favorite_demand()` WEIST OHNE BETRIEBSROLLE AB — und gibt mit
   *      Rolle ausschliesslich `(sky_id, users)` zurueck. Die Spaltenliste
   *      wird gelesen, nicht behauptet: eine `user_id` darin waere der
   *      Fehler, den die ganze Funktion verhindern soll.
   *   6. Die Ruecknahme bricht ab, solange Zeilen stehen — und nimmt
   *      danach die Funktion MIT, nicht nur die Tabelle.
   *   7. Der SAMMLUNGS-VERTRAG blockiert. Fehlt die Zeile, ist sie
   *      abgeschnitten, vertauscht oder von Hand gesetzt, meldet die
   *      Nachkontrolle es — dieselbe Pruefung, die P50 fuer die
   *      Shop-Baseline fuehrt, hier fuer die neue zweite Zeile.
   *
   * WAS DAFUER GESTELLT WIRD. `auth.uid()` ist im Stub `null` und
   * `can_operate_active_seller()` liest leere Tabellen. Fuer Fall 5 wird die
   * Rolle sichtbar und begrenzt ERSETZT; dass sie ueberhaupt gefragt wird,
   * ist der erste Teil desselben Falls. Die Richtlinien selbst greifen hier
   * NICHT — PGlite faehrt als Eigentuemer, und RLS gilt fuer ihn nicht. Dass
   * sie DA sind, prueft die Nachkontrolle; dass sie GREIFEN, prueft
   * `npm run verify:rls:staging` mit zwei echten Konten.
   */
  {
    const M145 = join(MIG_DIR, "0145_favorites.sql");
    const R145 = "supabase/rollback/R0145_drop_favorites.sql";
    const KONTO_A = "44444444-4444-4444-4444-444444444444";
    const KONTO_B = "55555555-5555-5555-5555-555555555555";
    const wert = async (db: InstanceType<typeof PGlite>, sql: string): Promise<string> =>
      String(((await db.query(sql)) as { rows: Record<string, unknown>[] }).rows[0]?.w ?? "?");

    const db = await frisch();
    /* Das Stub-Schema entsteht aus ALLEN Migrationen und traegt beide schon.
       Beide fallen, damit `0145` wirklich LAEUFT und nicht an ihrer eigenen
       „steht schon"-Pruefung abprallt — dass sie das tut, ist Fall 2. */
    await db.exec("drop table if exists public.favorites cascade;");
    await db.exec("drop function if exists public.favorite_demand(text[]);");
    await db.exec(`
      create schema if not exists auth;
      create table if not exists auth.users (id uuid primary key);
      insert into auth.users (id) values ('${KONTO_A}'), ('${KONTO_B}')
        on conflict do nothing;
      -- Der Fremdschluessel auf die Figur braucht einen eindeutigen
      -- Schluessel auf der Gegenseite; das Stub-Schema ist reine Struktur
      -- ohne Schluessel. In der Wirklichkeit ist sky_id Primaerschluessel
      -- (0001, ADR-0002).
      --
      -- (Als SQL-Kommentar, nicht als Blockkommentar: dieser Text steht in
      -- einem Template-Literal, und ein Gravis darin wuerde es beenden.)
      alter table public.skylanders add constraint z_sky_pk primary key (sky_id);
      insert into public.skylanders (sky_id, name, slug)
      values ('SKY-0001', 'Basis', 'basis'), ('SKY-0002', 'Variante', 'variante')
        on conflict do nothing;
      -- DREI SAMMLUNGSZEILEN AUS ZWEI KONTEN, und der Grund ist Fall 8.
      --
      -- Der Vertauschungsfall tauscht Feld 2 (zeilen) gegen Feld 3 (konten).
      -- Bei LEERER Sammlung sind beide 0, und zwei vertauschte Nullen sind
      -- keine Vertauschung: der Durchgang meldete "NICHTS ROT" und hatte
      -- recht damit. Drei Zeilen aus zwei Konten machen 3 <> 2, und der Fall
      -- prueft, was er pruefen soll. Gefunden vom Durchgang selbst.
      insert into public.collection_items (user_id, sky_id, quantity) values
        ('${KONTO_A}', 'SKY-0001', 1), ('${KONTO_A}', 'SKY-0002', 2),
        ('${KONTO_B}', 'SKY-0001', 1)
        on conflict do nothing;`);

    /* Die drei Attrappen, die die Baseline messbar machen — s. Helfer. */
    await attrappenFuerBaseline(db);

    /*
     * 0. BEIDE BASISZEILEN, SO WIE DER BEDIENER SIE BEKOMMT: Zeile 900 und
     *    Zeile 901 des Preflights. Damit ist die Uebergabe selbst geprueft
     *    und nicht nur beschrieben.
     */
    const vorBlatt = (await db.query(
      readFileSync("supabase/checks/0145_preflight.sql", "utf8"))) as {
        rows: { nr: number; befund: string; ok: boolean | null }[] };
    const basis145 = vorBlatt.rows.find((r) => r.nr === 900)?.befund ?? "(keine)";
    const coll145 = vorBlatt.rows.find((r) => r.nr === 901)?.befund ?? "(keine)";
    /* Der Preflight selbst: Zeile 110/111 muessen „true" sagen — die Tabelle
       ist oben gefallen, also ist sie wirklich noch nicht da. */
    const vorNochNicht = [110, 111]
      .map((n) => vorBlatt.rows.find((r) => r.nr === n)?.befund ?? "(fehlt)").join("/");

    /* 1. Der Lauf. */
    const lauf = await fahre(db, M145);

    const spalten = lauf === null ? await wert(db,
      "select string_agg(column_name, ',' order by ordinal_position) as w "
      + "from information_schema.columns where table_schema = 'public' "
      + "and table_name = 'favorites'") : "-";
    const pk = lauf === null ? await wert(db,
      "select string_agg(a.attname, ',' order by k.ord) as w from pg_constraint c "
      + "cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord) "
      + "join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum "
      + "where c.conrelid = 'public.favorites'::regclass and c.contype = 'p'") : "-";
    const policies = lauf === null ? await wert(db,
      "select count(*)::text as w from pg_policies where schemaname = 'public' "
      + "and tablename = 'favorites'") : "-";
    const rls = lauf === null ? await wert(db,
      "select relrowsecurity::text as w from pg_class "
      + "where oid = 'public.favorites'::regclass") : "-";

    /*
     * 1b. UND DIE NACHKONTROLLE, GEFAHREN — SOLANGE DIE TABELLE LEER IST.
     *
     * Zeile 108 verlangt eine LEERE Tabelle, und die Einfuegeproben unten
     * legen Zeilen an. Dieselbe Reihenfolge wie in P48.
     *
     * DREI ZEILEN KANN EIN STUB NICHT ERFUELLEN und sie werden namentlich
     * zugelassen: 141 und 143 verlangen die vier eigenen Richtlinien von
     * `collection_items` (Existenz und Inhalt), 142 verlangt RLS darauf —
     * das Stub-Schema ist reine Struktur OHNE Richtlinien. Jede andere rote
     * Zeile laesst diesen Durchgang scheitern.
     *
     * 144 UND 145 SIND NICHT DARUNTER, und das ist der interessante Teil:
     * „keine Richtlinie gibt anon etwas" und „keine unbekannte sechste"
     * sind im Stub beide WAHR, weil es dort gar keine Richtlinien gibt.
     * Beide Zeilen laufen hier also mit — eine berechtigte Agentenpolicy
     * waere zugelassen, eine fremde nicht.
     */
    let nachRot = "-";
    let nachLeer = "-";
    if (lauf === null) {
      await db.exec("begin;");
      await db.exec(`select set_config('skyisles.base', `
        + `'${basis145.split("'").join("''")}', true);`);
      await db.exec(`select set_config('skyisles.coll', `
        + `'${coll145.split("'").join("''")}', true);`);
      const blatt = await db.query(
        readFileSync("supabase/checks/0145_postflight.sql", "utf8")) as {
          rows: { nr: number; befund: string; ok: boolean | null }[] };
      await db.exec("rollback;");
      nachRot = blatt.rows.filter((r) => r.ok === false).map((r) => r.nr).join(", ");
      nachLeer = blatt.rows.find((r) => r.nr === 108)?.befund ?? "(fehlt)";
    }

    /* 2. Noch einmal — muss abbrechen. */
    const zweimal = lauf === null ? await fahre(db, M145) : "-";

    /*
     * 3. Der Primaerschluessel, gefahren: was gehen MUSS und was nicht.
     */
    let zweiKonten = "-";
    let zweiVarianten = "-";
    let doppelt = "-";
    let idempotent = "-";
    if (lauf === null) {
      try {
        await db.exec(`
          insert into public.favorites (user_id, sky_id) values
            ('${KONTO_A}', 'SKY-0001'), ('${KONTO_B}', 'SKY-0001');`);
        zweiKonten = "ok";
      } catch (f) { zweiKonten = `BEFUND: ${(f as Error).message}`; }

      try {
        await db.exec(
          `insert into public.favorites (user_id, sky_id) values ('${KONTO_A}', 'SKY-0002');`);
        zweiVarianten = "ok";
      } catch (f) { zweiVarianten = `BEFUND: ${(f as Error).message}`; }

      try {
        await db.exec(
          `insert into public.favorites (user_id, sky_id) values ('${KONTO_A}', 'SKY-0001');`);
        doppelt = "DURCHGELAUFEN — Befund";
      } catch { doppelt = "abgewiesen"; }

      /* 4. Und derselbe Satz MIT `on conflict do nothing`: das ist der Weg,
       *    den die Server Action geht, und er muss durchlaufen. */
      try {
        await db.exec(`
          insert into public.favorites (user_id, sky_id) values ('${KONTO_A}', 'SKY-0001')
          on conflict (user_id, sky_id) do nothing;`);
        idempotent = "laeuft durch";
      } catch (f) { idempotent = `BEFUND: ${(f as Error).message}`; }
    }

    /* 5. `favorite_demand()`: erst ohne Rolle, dann mit. */
    let ohneRolle = "-";
    let demandSpalten = "-";
    let demandZeilen = "-";
    let demandZahl = "-";
    if (lauf === null) {
      try {
        await db.query("select * from public.favorite_demand(null);");
        ohneRolle = "DURCHGELAUFEN — Befund";
      } catch (f) {
        ohneRolle = (f as Error).message.includes("seller operator role required")
          ? "abgewiesen" : `ANDERER FEHLER: ${(f as Error).message}`;
      }

      await db.exec(`
        create or replace function public.can_operate_active_seller() returns boolean
          language sql stable as $stub$ select true $stub$;`);

      const blatt = (await db.query("select * from public.favorite_demand(null);")) as {
        rows: Record<string, unknown>[] };
      demandSpalten = Object.keys(blatt.rows[0] ?? {}).sort().join(",");
      demandZeilen = String(blatt.rows.length);
      demandZahl = String(
        (blatt.rows.find((r) => r.sky_id === "SKY-0001") ?? {}).users ?? "?");
    }

    /*
     * 6. DIE DECKE. Mehr als 2000 SKY-IDs weist sie ab — eine Schleife, die
     *    einmal zu oft anhaengt, laeuft nicht in einen Seq Scan ueber ein
     *    Array mit Zehntausenden Werten.
     */
    let decke = "-";
    if (lauf === null) {
      try {
        await db.query(
          "select * from public.favorite_demand("
          + "(select array_agg('SKY-' || lpad(g::text, 4, '0')) "
          + "from generate_series(1, 2001) g));");
        decke = "DURCHGELAUFEN — Befund";
      } catch (f) {
        decke = (f as Error).message.includes("zu viele") ? "abgewiesen"
          : `ANDERER FEHLER: ${(f as Error).message}`;
      }
    }

    /* 7. Die Ruecknahme: mit Zeilen abbrechen, ohne Zeilen durchlaufen —
     *    und die Funktion MIT fortnehmen. */
    const mitZeilen = lauf === null ? await fahre(db, R145) : "-";
    if (lauf === null) await db.exec("delete from public.favorites;");
    const ohneZeilen = lauf === null ? await fahre(db, R145) : "-";
    const fort = lauf === null && ohneZeilen === null
      ? await wert(db, "select ((to_regclass('public.favorites') is null) and "
          + "(to_regprocedure('public.favorite_demand(text[])') is null))::text as w")
      : "-";
    /* Und die Sammlung steht noch — das ist die Zusage der Ruecknahme. */
    const sammlungDa = lauf === null && ohneZeilen === null
      ? await wert(db, "select (to_regclass('public.collection_items') is not null)::text as w")
      : "-";

    /*
     * 8. DER SAMMLUNGS-VERTRAG, UNTER FALSCHEN ZEILEN.
     *
     * Dieselbe Pruefung, die P50 fuer die Shop-Baseline fuehrt, hier fuer
     * die zweite Zeile: fehlt sie, ist sie abgeschnitten, vertauscht oder
     * von Hand gesetzt — die Nachkontrolle muss es melden. Die Tabelle ist
     * inzwischen fort, deshalb laeuft `0145` noch einmal.
     */
    const collRot: string[] = [];
    if (lauf === null && ohneZeilen === null) {
      const nochmal = await fahre(db, M145);
      if (nochmal !== null) throw new Error(`P52 Aufbau 8: 0145 scheiterte — ${nochmal}`);
      const teile = coll145.split("|");
      const faelle: [string, string | null][] = [
        ["fehlt", null],
        ["Platzhalter", "SAMMLUNG-HIER-EINSETZEN"],
        ["vier Felder", teile.slice(0, 4).join("|")],
        ["falsche Marke", ["skyisles-coll-9", ...teile.slice(1)].join("|")],
        ["vertauscht", [teile[0], teile[2], teile[1], teile[3], teile[4]].join("|")],
        ["Wert ohne neue Summe",
          [teile[0], String(Number(teile[1]) + 1), ...teile.slice(2)].join("|")],
      ];
      for (const [titel, zeile] of faelle) {
        await db.exec("begin;");
        await db.exec(`select set_config('skyisles.base', `
          + `'${basis145.split("'").join("''")}', true);`);
        if (zeile !== null) {
          await db.exec(`select set_config('skyisles.coll', `
            + `'${zeile.split("'").join("''")}', true);`);
        }
        const blatt = await db.query(
          readFileSync("supabase/checks/0145_postflight.sql", "utf8")) as {
            rows: { nr: number; ok: boolean | null }[] };
        await db.exec("rollback;");
        const rot = blatt.rows.filter((r) => r.ok === false && r.nr >= 821 && r.nr < 900)
          .map((r) => r.nr);
        collRot.push(`${titel}: ${rot.length > 0 ? rot.join("/") : "NICHTS ROT — Befund"}`);
      }
    }

    probe.push({
      name: "P52 0145 legt die Favoriten an: PK (user_id, sky_id) greift, Varianten bleiben "
        + "getrennt, favorite_demand weist ohne Betriebsrolle ab und gibt nur Zahlen, "
        + "Ruecknahme schuetzt Zeilen, und eine falsche Sammlungs-Baseline blockiert",
      ok: lauf === null
        && vorNochNicht === "true/true"
        && spalten === "user_id,sky_id,created_at"
        && pk === "user_id,sky_id"
        && policies === "3" && rls === "true"
        /* Die Nachkontrolle: nur die beiden Stub-Zeilen duerfen rot sein. */
        && nachRot === "141, 142, 143, 9999" && nachLeer === "0"
        && typeof zweimal === "string" && zweimal.includes("steht schon")
        && zweiKonten === "ok" && zweiVarianten === "ok"
        && doppelt === "abgewiesen" && idempotent === "laeuft durch"
        && ohneRolle === "abgewiesen"
        /* KEINE user_id im Ergebnis — das ist der Kern der Funktion. */
        && demandSpalten === "sky_id,users"
        && demandZeilen === "2" && demandZahl === "2"
        && decke === "abgewiesen"
        && typeof mitZeilen === "string" && mitZeilen.includes("Zeile(n) stehen in der Tabelle")
        && ohneZeilen === null && fort === "true" && sammlungDa === "true"
        /* Jeder der sechs Faelle muss mindestens eine Zeile rot machen. */
        && collRot.length === 6 && collRot.every((z) => !z.includes("NICHTS ROT")),
      sagt: `0145: ${lauf ?? "durch"} · vorher noch nicht da ${vorNochNicht}`
        + ` · Spalten ${spalten} · PK ${pk} · ${policies} Richtlinien · RLS ${rls}`
        + ` · Nachkontrolle rot: ${nachRot}`
        + `${nachRot === "141, 142, 143, 9999" ? " (nur die Stub-Zeilen 141/142/143)" : ""}`
        + ` (Zeilen nach der Migration ${nachLeer})`
        + ` · zweiter Lauf: ${zweimal === null ? "DURCHGELAUFEN — Befund" : "prallt ab"}`
        + ` · dieselbe Figur fuer zwei Konten: ${zweiKonten}`
        + ` · zwei Varianten fuer ein Konto: ${zweiVarianten}`
        + ` · derselbe Favorit zweimal: ${doppelt}`
        + ` · mit on conflict: ${idempotent}`
        + ` · favorite_demand ohne Rolle: ${ohneRolle}`
        + ` · mit Rolle: Spalten ${demandSpalten}, ${demandZeilen} Zeilen,`
        + ` SKY-0001 von ${demandZahl} Konten`
        + ` · Decke bei 2001 IDs: ${decke}`
        + ` · Ruecknahme mit Zeilen: ${mitZeilen === null ? "DURCHGELAUFEN — Befund" : "bricht ab"}`
        + ` · ohne Zeilen: ${ohneZeilen ?? "durch"} (Tabelle UND Funktion fort ${fort},`
        + ` Sammlung steht ${sammlungDa})`
        + ` · Sammlungs-Baseline — ${collRot.join(" · ")}`,
    });
  }


  /* P53 — `0146`: DER ANGEBOTSSPIEGEL, und jeder Zustandswechsel gefahren.
   *
   * Was ein Probelauf hier zeigt und kein Test im Arbeitsbaum: der Spiegel
   * reagiert auf ECHTE Vorgaenge. Ein Quelltextvergleich kann sagen, dass
   * `changed_at` in einem `case` steht; er kann nicht sagen, dass es nach
   * einer Reservierung unveraendert bleibt.
   *
   * NEUN SZENARIEN, die der Auftrag nennt — und die Erstbefuellung, die
   * Drosselung und die Ruecknahme dazu.
   *
   * WAS DAFUER GESTELLT WIRD. `shop_offers()` wird fuer diesen Durchgang
   * ERSETZT, und zwar durch eine Fassung, die alle DREI Preisquellen
   * wirklich benutzt: `sale_price`, `market_price` und `price_percentage`,
   * durch `shop_price()` gerechnet. `available_quantity` wird als generierte
   * Spalte neu angelegt, weil das Stub-Schema Generierung nicht uebernimmt —
   * so reagiert der Spiegel auf `reserved` genau wie im Betrieb.
   *
   * WAS ER NICHT ZEIGT: die Antwort `locked`. PGlite faehrt EINE Verbindung,
   * und ein Beratschlagungsschloss laesst dieselbe Sitzung wieder durch.
   * Dass der Zweig existiert und `locked` zurueckgibt, prueft
   * `src/lib/favorites/offer-state.test.ts`; dass er im Betrieb greift,
   * gehoert in die funktionale Staging-Pruefung.
   */
  {
    const M146 = join(MIG_DIR, "0146_offer_state.sql");
    const R146 = "supabase/rollback/R0146_drop_offer_state.sql";
    /*
     * `Date` UND NICHT `string`. PGlite gibt `timestamptz` als JS-`Date`
     * zurueck, und zwei `Date`-Objekte sind NIEMALS `===` — der erste
     * Leerlauftest meldete deshalb „changed_at hat sich geaendert", obwohl
     * die Funktion sie korrekt stehen liess. Verglichen wird mit `+date`,
     * also als Zahl.
     */
    type Zeile = {
      sky_id: string; buyable: boolean; cheapest_cents: number | null;
      changed_at: Date; checked_at: Date;
      announced_buyable: boolean | null; announced_cents: number | null;
      announced_at: Date | null;
    };

    const db = await frisch();
    /* Das Stub-Schema entsteht aus ALLEN Migrationen und traegt beides schon.
       Beide fallen, damit `0146` wirklich LAEUFT. */
    await db.exec("drop function if exists public.refresh_offer_state();");
    await db.exec("drop view if exists public.offer_state_live;");
    await db.exec("drop table if exists public.offer_state cascade;");
    await db.exec("drop function if exists public.offer_state_window();");

    await attrappenFuerBaseline(db);

    await db.exec(`
      alter table public.skylanders add constraint z_sky_pk primary key (sky_id);
      insert into public.skylanders (sky_id, name, slug, market_price)
      values ('SKY-7001', 'Probe Bash', 'probe-bash', 20.00),
             ('SKY-7002', 'Probe Legendary Bash', 'probe-legendary-bash', 30.00)
        on conflict do nothing;
      insert into public.shop_settings (id, price_percentage)
      values (true, 100) on conflict do nothing;
      -- DIE GENERIERTE SPALTE, wie im Betrieb: available_quantity ist
      -- quantity - reserved. Das Stub-Schema uebernimmt Generierung nicht,
      -- also wird sie hier neu angelegt — sonst reagierte der Spiegel nicht
      -- auf eine Reservierung, und genau das soll er.
      --
      -- (Als SQL-Kommentar, nicht als Blockkommentar: dieser Text steht in
      -- einem Template-Literal, und ein Gravis darin wuerde es beenden.)
      alter table public.shop_inventory drop column if exists available_quantity;
      alter table public.shop_inventory
        add column available_quantity integer
        generated always as (quantity - reserved) stored;
      create sequence if not exists public.z_inv_seq start 1;
      alter table public.shop_inventory alter column id set default nextval('public.z_inv_seq');`);

    /*
     * Die ersetzte Projektion. Sie benutzt `shop_price()` wirklich, also
     * haengen alle drei Preisquellen daran — und `available` kommt aus der
     * generierten Spalte.
     */
    await db.exec(`
      drop function if exists public.shop_offers();
      create function public.shop_offers()
      returns table (sky_id text, condition text, price numeric,
                     available boolean, delivery_scope text)
      language sql stable as $probe$
        select i.sky_id, i.condition,
               public.shop_price(i.sale_price, s.market_price, st.price_percentage),
               (i.available_quantity > 0),
               null::text
          from public.shop_inventory i
          join public.skylanders s on s.sky_id = i.sky_id
          cross join public.shop_settings st
         where i.is_listed
           and i.condition = public.v1_sale_condition()
           and public.shop_price(i.sale_price, s.market_price, st.price_percentage)
               is not null;
      $probe$;`);

    /* Zwei Lagerzeilen: die Basisfigur zu 20 EUR, die Variante zu 30. */
    await db.exec(`
      insert into public.shop_inventory (sky_id, condition, quantity, reserved, is_listed)
      values ('SKY-7001', 'loose', 2, 0, true),
             ('SKY-7002', 'loose', 1, 0, true);`);

    /* -------------------------------------------------------- Werkzeuge */
    const wert = async (sql: string): Promise<string> =>
      String(((await db.query(sql)) as { rows: Record<string, unknown>[] })
        .rows[0]?.w ?? "?");
    /** Den Spiegel lesen, nach SKY-ID. */
    const spiegel = async (): Promise<Map<string, Zeile>> => {
      const r = (await db.query(
        "select * from public.offer_state order by sky_id")) as { rows: Zeile[] };
      return new Map(r.rows.map((z) => [z.sky_id, z]));
    };
    /** Die Drossel oeffnen: so tun, als waere der letzte Lauf lange her. */
    const oeffne = async () => {
      await db.exec(
        "update public.offer_state set checked_at = changed_at;"
        + "update public.offer_state set changed_at = changed_at - interval '2 hours',"
        + " checked_at = checked_at - interval '2 hours';");
    };
    /** Auffrischen und die Antwort lesen. */
    const ruf = async (): Promise<{ ran: boolean; reason: string; changed: number }> => {
      const r = (await db.query("select * from public.refresh_offer_state()")) as {
        rows: { ran: boolean; reason: string; rows_changed: number }[] };
      return { ran: r.rows[0].ran, reason: r.rows[0].reason,
               changed: r.rows[0].rows_changed };
    };
    const befund: string[] = [];
    const sag = (was: string, gut: boolean, text: string) => {
      befund.push(`${was}: ${gut ? text : `BEFUND ${text}`}`);
      return gut;
    };

    /* 1. Der Lauf. */
    const lauf = await fahre(db, M146);
    let ok = lauf === null;

    const spalten = ok ? await wert(
      "select string_agg(column_name, ',' order by ordinal_position) as w "
      + "from information_schema.columns where table_schema = 'public' "
      + "and table_name = 'offer_state'") : "-";
    ok = ok && sag("Spalten", spalten === "sky_id,buyable,cheapest_cents,changed_at,"
      + "checked_at,announced_buyable,announced_cents,announced_at", spalten);

    const leer = ok ? await wert("select count(*)::text as w from public.offer_state") : "-";
    ok = ok && sag("Migration legt keine Zeile an", leer === "0", `${leer} Zeilen`);

    /* 2. ERSTBEFUELLUNG: beide Figuren kaufbar, und BEREITS GEMELDET. */
    let erst = "-";
    if (ok) {
      const a = await ruf();
      const s = await spiegel();
      const beide = s.size === 2;
      const gemeldet = [...s.values()].every(
        (z) => z.announced_buyable === true && z.announced_at !== null
               && z.announced_cents === z.cheapest_cents);
      const preise = s.get("SKY-7001")?.cheapest_cents === 2000
                  && s.get("SKY-7002")?.cheapest_cents === 3000;
      erst = `${a.reason}, ${s.size} Zeilen, gemeldet ${gemeldet}, Preise ${preise}`;
      ok = sag("Erstbefuellung", a.ran && beide && gemeldet && preise, erst);
    }

    /* 3. DROSSELUNG: sofort nochmal → `throttled`, nichts geaendert. */
    let drossel = "-";
    if (ok) {
      const a = await ruf();
      drossel = `${a.reason}, ${a.changed} geaendert`;
      ok = sag("Drosselung", !a.ran && a.reason === "throttled" && a.changed === 0, drossel);
    }

    /* 4. KEINE UNNOETIGEN SCHREIBVORGAENGE: Drossel oeffnen, nichts aendern,
     *    auffrischen → `changed_at` bleibt, `checked_at` wandert. */
    let leerlauf = "-";
    if (ok) {
      await oeffne();
      const vor = await spiegel();
      const a = await ruf();
      const nach = await spiegel();
      const z = "SKY-7001";
      const changedGleich = +vor.get(z)!.changed_at === +nach.get(z)!.changed_at;
      const checkedNeu = +nach.get(z)!.checked_at > +vor.get(z)!.checked_at;
      leerlauf = `${a.reason}, ${a.changed} geaendert, changed_at gleich `
        + `${changedGleich}, checked_at neu ${checkedNeu}`;
      ok = sag("Leerlauf", a.ran && a.changed === 0 && changedGleich && checkedNeu,
               leerlauf);
    }

    /* 5. RESERVIERUNGSFLATTERN: voll reserviert → wieder frei.
     *    Der Spiegel muss BEIDE Kanten sehen — S2 entscheidet spaeter, dass
     *    daraus keine Meldung wird. */
    let flattern = "-";
    if (ok) {
      await oeffne();
      await db.exec("update public.shop_inventory set reserved = quantity "
        + "where sky_id = 'SKY-7001';");
      const a1 = await ruf();
      const s1 = await spiegel();
      await oeffne();
      await db.exec("update public.shop_inventory set reserved = 0 "
        + "where sky_id = 'SKY-7001';");
      const a2 = await ruf();
      const s2 = await spiegel();
      const z = "SKY-7001";
      const raus = s1.get(z)!.buyable === false && s1.get(z)!.cheapest_cents === null;
      const rein = s2.get(z)!.buyable === true && s2.get(z)!.cheapest_cents === 2000;
      /* Der GEMELDETE Stand hat sich nie bewegt — das ist der Flattern-Schutz. */
      const gemeldetGleich = s2.get(z)!.announced_buyable === true;
      flattern = `raus ${raus} (${a1.changed}), rein ${rein} (${a2.changed}), `
        + `gemeldet unveraendert ${gemeldetGleich}`;
      ok = sag("Reservierungsflattern", raus && rein && gemeldetGleich
        && a1.changed === 1 && a2.changed === 1, flattern);
    }

    /* 6. AUSVERKAUFT → WIEDER AUFGEFUELLT (ueber `quantity`, nicht `reserved`). */
    let bestand = "-";
    if (ok) {
      await oeffne();
      await db.exec("update public.shop_inventory set quantity = 0 "
        + "where sky_id = 'SKY-7001';");
      await ruf();
      const s1 = await spiegel();
      await oeffne();
      await db.exec("update public.shop_inventory set quantity = 3 "
        + "where sky_id = 'SKY-7001';");
      await ruf();
      const s2 = await spiegel();
      bestand = `ausverkauft ${!s1.get("SKY-7001")!.buyable}, `
        + `nachgeliefert ${s2.get("SKY-7001")!.buyable}`;
      ok = sag("Bestand", !s1.get("SKY-7001")!.buyable && s2.get("SKY-7001")!.buyable,
               bestand);
    }

    /* 7. NICHT KAUFBAR → KAUFBAR ueber `is_listed` (Veroeffentlichung). */
    let listung = "-";
    if (ok) {
      await oeffne();
      await db.exec("update public.shop_inventory set is_listed = false "
        + "where sky_id = 'SKY-7002';");
      await ruf();
      const s1 = await spiegel();
      await oeffne();
      await db.exec("update public.shop_inventory set is_listed = true "
        + "where sky_id = 'SKY-7002';");
      await ruf();
      const s2 = await spiegel();
      listung = `entlistet ${!s2.get("SKY-7002")!.buyable === false
        && !s1.get("SKY-7002")!.buyable}, wieder gelistet `
        + `${s2.get("SKY-7002")!.buyable}`;
      ok = sag("Veroeffentlichung", !s1.get("SKY-7002")!.buyable
        && s2.get("SKY-7002")!.buyable, listung);
    }

    /* 8. PREIS SINKT und STEIGT — ueber `sale_price` (Quelle 1). */
    let preis1 = "-";
    if (ok) {
      await oeffne();
      await db.exec("update public.shop_inventory set sale_price = 14.99 "
        + "where sky_id = 'SKY-7001';");
      const a1 = await ruf();
      const s1 = await spiegel();
      await oeffne();
      await db.exec("update public.shop_inventory set sale_price = 17.50 "
        + "where sky_id = 'SKY-7001';");
      const a2 = await ruf();
      const s2 = await spiegel();
      preis1 = `gesunken ${s1.get("SKY-7001")!.cheapest_cents} (${a1.changed}), `
        + `gestiegen ${s2.get("SKY-7001")!.cheapest_cents} (${a2.changed})`;
      ok = sag("sale_price", s1.get("SKY-7001")!.cheapest_cents === 1499
        && s2.get("SKY-7001")!.cheapest_cents === 1750
        && a1.changed === 1 && a2.changed === 1, preis1);
    }

    /* 9. QUELLE 2: `market_price`. Der Override muss weg, sonst gewinnt er. */
    let preis2 = "-";
    if (ok) {
      await oeffne();
      await db.exec("update public.shop_inventory set sale_price = null "
        + "where sky_id = 'SKY-7001';"
        + "update public.skylanders set market_price = 11.00 where sky_id = 'SKY-7001';");
      await ruf();
      const s = await spiegel();
      preis2 = `${s.get("SKY-7001")!.cheapest_cents} Cent`;
      ok = sag("market_price", s.get("SKY-7001")!.cheapest_cents === 1100, preis2);
    }

    /* 10. QUELLE 3: `price_percentage` — EINE Zahl, alle automatischen Preise. */
    let preis3 = "-";
    if (ok) {
      await oeffne();
      await db.exec("update public.shop_settings set price_percentage = 50;");
      const a = await ruf();
      const s = await spiegel();
      /* 11,00 * 50 % = 5,50 und 30,00 * 50 % = 15,00 — beide Figuren. */
      preis3 = `SKY-7001 ${s.get("SKY-7001")!.cheapest_cents}, `
        + `SKY-7002 ${s.get("SKY-7002")!.cheapest_cents}, ${a.changed} geaendert`;
      ok = sag("price_percentage", s.get("SKY-7001")!.cheapest_cents === 550
        && s.get("SKY-7002")!.cheapest_cents === 1500 && a.changed === 2, preis3);
      await db.exec("update public.shop_settings set price_percentage = 100;");
    }

    /* 11. MEHRERE ANGEBOTE EINER FIGUR: das guenstigste verschwindet, ein
     *     teureres bleibt — und kehrt dann zurueck. `min` muss folgen. */
    let mehrere = "-";
    if (ok) {
      await oeffne();
      await db.exec(
        "update public.shop_inventory set sale_price = 20.00 where sky_id = 'SKY-7001';"
        + "insert into public.shop_inventory (sky_id, condition, quantity, reserved,"
        + " is_listed, sale_price) values ('SKY-7001', 'loose', 1, 0, true, 12.00);");
      await ruf();
      const s1 = await spiegel();
      await oeffne();
      /* Das guenstige ausverkaufen. */
      await db.exec("update public.shop_inventory set quantity = 0 "
        + "where sky_id = 'SKY-7001' and sale_price = 12.00;");
      await ruf();
      const s2 = await spiegel();
      await oeffne();
      /* Und zurueck. */
      await db.exec("update public.shop_inventory set quantity = 1 "
        + "where sky_id = 'SKY-7001' and sale_price = 12.00;");
      await ruf();
      const s3 = await spiegel();
      mehrere = `min ${s1.get("SKY-7001")!.cheapest_cents} → `
        + `${s2.get("SKY-7001")!.cheapest_cents} → ${s3.get("SKY-7001")!.cheapest_cents}`;
      ok = sag("mehrere Angebote", s1.get("SKY-7001")!.cheapest_cents === 1200
        && s2.get("SKY-7001")!.cheapest_cents === 2000
        && s3.get("SKY-7001")!.cheapest_cents === 1200, mehrere);
    }

    /* 12. VIELE AENDERUNGEN IN EINER MINUTE: nur der erste Lauf greift. */
    let schnell = "-";
    if (ok) {
      await oeffne();
      const a1 = await ruf();                     // laeuft
      await db.exec("update public.shop_inventory set quantity = 0 where sky_id = 'SKY-7002';");
      const a2 = await ruf();                     // gedrosselt
      await db.exec("update public.shop_inventory set quantity = 5 where sky_id = 'SKY-7002';");
      const a3 = await ruf();                     // gedrosselt
      const s = await spiegel();
      schnell = `${a1.reason}/${a2.reason}/${a3.reason}, SKY-7002 kaufbar `
        + `${s.get("SKY-7002")!.buyable}`;
      ok = sag("Drosselung bei schnellen Aenderungen",
        a1.ran && a2.reason === "throttled" && a3.reason === "throttled"
        && s.get("SKY-7002")!.buyable === true, schnell);
    }

    /* 13. LAENGER ALS 30 MINUTEN STABIL: `changed_at` bleibt alt, `checked_at`
     *     wandert — genau die Lage, in der S2 spaeter meldet. */
    let stabil = "-";
    if (ok) {
      await db.exec(
        "update public.offer_state set changed_at = now() - interval '45 minutes',"
        + " checked_at = now() - interval '45 minutes';");
      const a = await ruf();
      const s = await spiegel();
      const z = s.get("SKY-7001")!;
      const alt = await wert(
        "select (now() - changed_at > interval '30 minutes')::text as w "
        + "from public.offer_state where sky_id = 'SKY-7001'");
      stabil = `${a.reason}, ${a.changed} geaendert, ueber 30 min stabil ${alt}, `
        + `checked_at frisch ${+z.checked_at > +z.changed_at}`;
      ok = sag("30 Minuten stabil", a.ran && a.changed === 0 && alt === "true"
        && +z.checked_at > +z.changed_at, stabil);
    }

    /* 14. KEINE ZEILE VERSCHWINDET, und `announced_*` hat S1 nie angefasst. */
    let unberuehrt = "-";
    if (ok) {
      const s = await spiegel();
      const nurErst = [...s.values()].every((z) => z.announced_buyable === true);
      unberuehrt = `${s.size} Zeilen, announced_* unveraendert ${nurErst}`;
      ok = sag("announced_* unberuehrt", s.size === 2 && nurErst, unberuehrt);
    }

    /* 15. EINE SPAETER DAZUKOMMENDE FIGUR ist eine NEUIGKEIT: announced_* null. */
    let neue = "-";
    if (ok) {
      await oeffne();
      await db.exec(
        "insert into public.skylanders (sky_id, name, slug, market_price)"
        + " values ('SKY-7003', 'Probe Neu', 'probe-neu', 9.00);"
        + "insert into public.shop_inventory (sky_id, condition, quantity, reserved,"
        + " is_listed) values ('SKY-7003', 'loose', 1, 0, true);");
      await ruf();
      const s = await spiegel();
      const z = s.get("SKY-7003");
      neue = z === undefined ? "fehlt"
        : `kaufbar ${z.buyable}, announced ${z.announced_buyable ?? "null"}`;
      ok = sag("spaetere Figur ist Neuigkeit",
        z !== undefined && z.buyable && z.announced_buyable === null
        && z.announced_at === null, neue);
    }

    /* ------------- DER AUFRUF ALS `authenticated` — PUNKT 1 DES AUFTRAGS
     *
     * BIS HIERHER WAR DIESE NAHTSTELLE UNGEMESSEN. Jeder Lauf oben ruft
     * `refresh_offer_state()` als EIGNER. Die Anwendung ruft sie aber als
     * `authenticated`, und zwar ueber genau ein Recht: das `grant execute`
     * aus `0146`. Dass das ausreicht, ist eine Behauptung ueber das
     * Zusammenspiel von `security definer`, RLS und entzogenen
     * Tabellenrechten — und solche Behauptungen gehoeren gemessen.
     *
     * Geprueft wird dreierlei in einem:
     *   1. ein Sammlerkonto DARF sie aufrufen und sie schreibt dabei,
     *   2. es darf `offer_state` trotzdem NICHT selbst lesen,
     *   3. und es erfaehrt keine fremden Daten — die Antwort sind vier
     *      Zahlen bzw. Zustaende ueber die oeffentliche Angebotslage.
     */
    if (ok) {
      /* Die Rollen, wie Supabase sie mitbringt. `nologin`, weil hier nur
         `set local role` gebraucht wird. */
      await db.exec(`do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then
          create role authenticated nologin;
        end if;
      end $$;`);
      /* Und genau die Rechte aus `0146`, nicht mehr: `usage` auf dem Schema
         und `execute` auf dieser einen Funktion. */
      await db.exec(`
        grant usage on schema public to authenticated;
        revoke all on public.offer_state from authenticated;
        revoke all on public.offer_state_live from authenticated;
        grant execute on function public.refresh_offer_state() to authenticated;`);

      await oeffne();
      const vorher = await wert("select max(checked_at)::text as w from public.offer_state");

      /*
       * ZWEI TRANSAKTIONEN, UND DAS WAR EIN BEFUND AN DIESEM PROBELAUF.
       *
       * Der erste Entwurf machte beides in EINER: aufrufen, und danach im
       * selben Rollenkontext die Gegenprobe „lesen darf sie nicht". Die
       * Gegenprobe loest `42501` aus — und ein Fehler in einer Transaktion
       * versetzt sie in PostgreSQL in den Abbruchzustand. Das folgende
       * `commit` wirkte dann als ROLLBACK, und die Messung meldete
       * „checked_at UNVERAENDERT": die Gegenprobe hatte genau das zerstoert,
       * was sie beobachten sollte.
       *
       * Deshalb getrennt: erst schreiben und festschreiben, dann in einer
       * eigenen Transaktion das Verbot pruefen und verwerfen. `set local
       * role` gilt ohnehin nur fuer seine Transaktion.
       */
      let grund = "(nichts)";
      await db.exec("begin;");
      try {
        await db.exec("set local role authenticated;");
        const r = (await db.query("select * from public.refresh_offer_state()")) as {
          rows: { ran: boolean; reason: string }[] };
        grund = `${r.rows[0]?.ran}/${r.rows[0]?.reason}`;
        await db.exec("commit;");
      } catch (e) {
        await db.exec("rollback;");
        grund = `WURF ${(e as { message?: string }).message ?? String(e)}`;
      }

      const nachher = await wert("select max(checked_at)::text as w from public.offer_state");

      /* Die Gegenprobe, in ihrer eigenen Transaktion. */
      let darfLesen = "(nicht geprueft)";
      await db.exec("begin;");
      try {
        await db.exec("set local role authenticated;");
        await db.query("select count(*) from public.offer_state");
        darfLesen = "JA — das waere ein Befund";
      } catch (e) {
        darfLesen = (e as { code?: string }).code === "42501"
          ? "nein (42501)" : `nein (${(e as { code?: string }).code})`;
      } finally { await db.exec("rollback;"); }
      ok = sag("als authenticated: Aufruf gelingt, schreibt, und lesen bleibt verboten",
        grund === "true/ran" && darfLesen === "nein (42501)" && nachher !== vorher,
        `Antwort ${grund}, select auf offer_state: ${darfLesen}, `
        + `checked_at ${nachher === vorher ? "UNVERAENDERT" : "nachgezogen"}`);
    }

    /* ---- UND DIE DROSSEL GILT AUCH FUER IHN — PUNKT 2 DES AUFTRAGS ----
     *
     * Ein zweiter Aufruf in derselben Minute darf NICHT `ran` sagen. Das ist
     * die Zeile, an der die Unterscheidung `refreshed` gegen `reason` haengt:
     * `throttled` heisst „jemand war schon da", nicht „ich habe
     * nachgezogen".
     */
    if (ok) {
      let zweiter = "(nichts)";
      await db.exec("begin;");
      try {
        await db.exec("set local role authenticated;");
        const r = (await db.query("select * from public.refresh_offer_state()")) as {
          rows: { ran: boolean; reason: string }[] };
        zweiter = `${r.rows[0]?.ran}/${r.rows[0]?.reason}`;
      } finally { await db.exec("rollback;"); }
      ok = sag("als authenticated: der zweite Aufruf ist gedrosselt, nicht erfolgreich",
        zweiter === "false/throttled", `Antwort ${zweiter}`);
    }

    /* 16. DIE RUECKNAHME: bricht ab, solange ein gemeldeter Stand steht. */
    let mitGemeldet = "-";
    let ohneGemeldet = "-";
    let fort = "-";
    if (ok) {
      const r1 = await fahre(db, R146);
      mitGemeldet = r1 === null ? "DURCHGELAUFEN — Befund" : "bricht ab";
      await db.exec("update public.offer_state set announced_buyable = null,"
        + " announced_cents = null, announced_at = null;");
      const r2 = await fahre(db, R146);
      ohneGemeldet = r2 ?? "durch";
      fort = r2 === null ? await wert(
        "select ((to_regclass('public.offer_state') is null)"
        + " and (to_regclass('public.offer_state_live') is null)"
        + " and (to_regprocedure('public.refresh_offer_state()') is null)"
        + " and (to_regprocedure('public.offer_state_window()') is null))::text as w")
        : "-";
      ok = sag("Ruecknahme", typeof r1 === "string" && r1.includes("GEMELDETEN Stand")
        && r2 === null && fort === "true",
        `mit gemeldetem Stand: ${mitGemeldet}, ohne: ${ohneGemeldet}, fort ${fort}`);
    }

    probe.push({
      name: "P53 0146 spiegelt die Angebotslage: Erstbefuellung bereits gemeldet, alle drei "
        + "Preisquellen, Reservierungsflattern sichtbar, Drosselung greift, keine unnoetigen "
        + "Schreibvorgaenge, Ruecknahme schuetzt den gemeldeten Stand",
      ok: lauf === null && ok,
      sagt: `0146: ${lauf ?? "durch"} · Spalten ${spalten} · ${befund.join(" · ")}`,
    });
  }

  /* P54 — DIE NACHKONTROLLE VON `0146` UNTER DEM LESENDEN PRUEFZUGANG.
   *
   * DER ANLASS. `npm run db:migrate:staging -- 0146 --resume` scheiterte mit
   * `permission denied for view offer_state_live`. Richtig so: `0146`
   * erteilt auf `offer_state` und `offer_state_live` bewusst KEIN
   * Clientrecht, und der Pruefzugang hat `select` auf genau zwoelf Tabellen
   * — diese zwei nicht.
   *
   * Falsch war nur die FOLGE: PostgreSQL prueft die Rechte ALLER Relationen
   * eines Plans beim Ausfuehrungsstart, also nahm EIN fehlendes Recht die
   * ganze Einreichung mit — rund hundert gute Katalogpruefungen inbegriffen.
   *
   * DIESER PROBELAUF FAEHRT GENAU DIESE LAGE. Eine Rolle bekommt exakt die
   * zwoelf Erteilungen aus `staging-agent-setup.sql` — mehr nicht — und
   * dann laeuft die Nachkontrolle. Erwartet: sie laeuft DURCH, die beiden
   * Datenzeilen melden `KEIN-RECHT`, und Zeile 9998 zaehlt sie. Als Eigner
   * stehen dort Zahlen und 9998 ist 0.
   */
  {
    const db = await frisch();
    const befund: string[] = [];
    let ok = true;
    const sag = (was: string, gut: boolean, text: string): boolean => {
      befund.push(`${was}: ${text}`);
      return gut;
    };

    /*
     * DIE ATTRAPPEN, DAMIT DIE BASELINE-MESSUNG UEBERHAUPT LAEUFT — und die
     * Sicht danach neu, weil `attrappenFuerBaseline` `shop_offers()`
     * ersetzt und die Sicht davon abhaengt.
     *
     * Die Sicht entsteht hier in der FORM der Migration, ausdruecklich als
     * Attrappe: dass ihre Definition stimmt, pruefen die Zeilen 121–123 und
     * `P53`. HIER steht etwas anderes zur Pruefung — ob ein fehlendes
     * Leserecht die Einreichung mitnimmt.
     */
    await db.exec("drop view if exists public.offer_state_live;");
    await attrappenFuerBaseline(db);
    await db.exec(`create view public.offer_state_live as
      select o.sky_id, min(round(o.price * 100))::integer as cheapest_cents
        from public.shop_offers() o
       where o.available and o.condition = public.v1_sale_condition()
       group by o.sky_id;`);

    /*
     * DIE WELT DIESES PROBELAUFS KOMMT AUS DER MESSUNG, NICHT AUS DER
     * ABSICHTSDATEI — und das ist die Lehre aus dem dritten Fehlschlag.
     *
     * Vorher las dieser Abschnitt `staging-agent-setup.sql`. Diese Datei ist
     * aber ein historischer Beleg dessen, was am 2026-10-19/20 erteilt
     * wurde: am 2026-10-20 hat `0139` `shop_offers()` mit `drop function`
     * neu angelegt, `DROP`+`CREATE` verwirft die ACL, und die Erteilung war
     * fort. Der Probelauf erteilte sie trotzdem und bildete eine Welt nach,
     * die es nicht mehr gab — dreimal hintereinander fiel der naechste
     * fehlende Zugriff erst im echten Lauf auf.
     *
     * Jetzt gilt `supabase/privileges/staging-agent.json`, erhoben mit
     * `npm run db:privileges:staging`. Fehlt sie oder ist sie VERALTET,
     * scheitert dieser Durchgang — eine Messung von vor der letzten
     * rechtserheblichen Migration sagt nichts ueber heute.
     */
    const urteil = ladeAufnahme();
    if (!urteil.ok) {
      probe.push({
        name: "P54 jede Runner-Pruefdatei laeuft unter dem lesenden Pruefzugang DURCH",
        ok: false,
        sagt: `keine gueltige Rechteaufnahme: ${urteil.grund.split("\n")[0]}`,
      });
    } else {
      const a = urteil.aufnahme;
      const erteilt = Object.entries(a.tabellen).filter(([, d]) => d).map(([t]) => t);
      const erteiltFn = Object.entries(a.funktionen)
        .filter(([, w]) => w.execute).map(([sig]) => sig);
      ok = sag("Aufnahme", true, `${erteilt.length} Tabellen, ${erteiltFn.length} Funktionen`
        + ` (erhoben ${a.erhoben.slice(0, 10)})`);

      await db.exec("create role pruefrolle nologin;");
      await db.exec("grant usage on schema public to pruefrolle;");
      for (const t of erteilt) {
        try { await db.exec(`grant select on table public.${t} to pruefrolle;`); }
        catch { /* im Stub nicht vorhanden */ }
      }
      for (const f of erteiltFn) {
        try { await db.exec(`grant execute on function ${f} to pruefrolle;`); }
        catch { /* im Stub nicht vorhanden */ }
      }
      /*
       * UND WAS DIE MESSUNG ALS `false` AUSWEIST, MUSS AUCH HIER FEHLEN.
       * PostgreSQL erteilt auf eine neue Funktion automatisch `EXECUTE TO
       * PUBLIC`; ohne diesen Entzug haette `pruefrolle` das Recht ueber
       * PUBLIC, und genau so sind `offer_state_window()` und `shop_offers()`
       * durch alle Netze gefallen.
       */
      for (const [sig, w] of Object.entries(a.funktionen)) {
        if (w.execute) continue;
        try { await db.exec(`revoke all on function ${sig} from public;`); }
        catch { /* im Stub nicht vorhanden */ }
      }

    /* Die Nachkontrolle, nur die interessanten Zeilen. Ohne Baselines
       weichen die Vertragszeilen ab — das ist hier nicht die Frage. */
    const sql = anweisungen(readFileSync(join(CHECK_DIR, "0146_postflight.sql"), "utf8"))
      .filter((x) => planbar(x));
    const hol = async (rolle: string | null) => {
      await db.exec("begin;");
      if (rolle) await db.exec(`set local role ${rolle};`);
      try {
        const r = (await db.query(`select nr, befund from (${ohneKopf(sql[0])}) x
                                    where nr in (124, 142, 161, 811, 812, 9998, 9999)`)) as
          { rows: { nr: number; befund: string }[] };
        return new Map(r.rows.map((z) => [Number(z.nr), String(z.befund)]));
      } catch (e) {
        return (e as Error).message.split("\n")[0];
      } finally {
        await db.exec("rollback;");
      }
    };

    /*
     * Als Eigner stehen in 124 und 161 ZAHLEN — welche, haengt an den
     * erfundenen Zeilen des Stub-Schemas und ist hier nicht die Frage.
     * Entscheidend: keine davon sagt `KEIN-RECHT`, und 9998 ist 0.
     */
    const eigner = await hol(null);
    const zahl = (x: string | undefined) => x !== undefined && /^\d+$/.test(x);
    ok = ok && sag("als Eigner", typeof eigner !== "string"
      && zahl(eigner.get(124)) && eigner.get(142) !== "KEIN-RECHT"
      && eigner.get(161) === "0" && eigner.get(9998) === "0",
      typeof eigner === "string" ? `FEHLER ${eigner}`
        : `124=${eigner.get(124)} 142=${eigner.get(142)} `
          + `161=${eigner.get(161)} 9998=${eigner.get(9998)}`);

    const pruefer = await hol("pruefrolle");
    /*
     * KEINE GERATENE GESAMTZAHL. Wie viele Zeilen offen sind, haengt an der
     * Messung — und eine festgeschriebene Zahl waere genau die Sorte
     * Konstante, die am 2026-10-25 schon ein Release angehalten hat. Dass
     * `9998` mit der Zahl der `KEIN-RECHT`-Zeilen uebereinstimmt, prueft der
     * Durchgang ueber alle Dateien weiter unten.
     *
     * HIER STEHT DIE FACHLICHE AUSSAGE: die drei Zeilen zu `offer_state` und
     * `offer_state_window()` sind immer offen (darauf hat der Zugang nie ein
     * Recht), und die zwei Baselinezeilen 811/812 GENAU DANN, wenn `execute`
     * auf `shop_offers()` fehlt. Ist die Erteilung wiederhergestellt, werden
     * sie wieder gemessen und verglichen — das ist der Sinn von Variante C.
     */
    const darfOffers = Object.entries(urteil.aufnahme.funktionen).some(
      ([sig, w]) => sig.startsWith("public.shop_offers(") && w.execute);
    const basisOffen = !darfOffers;
    ok = ok && sag("als Pruefzugang", typeof pruefer !== "string"
      && pruefer.get(124) === "KEIN-RECHT" && pruefer.get(142) === "KEIN-RECHT"
      && pruefer.get(161) === "KEIN-RECHT"
      && (pruefer.get(811) === "KEIN-RECHT") === basisOffen
      && (pruefer.get(812) === "KEIN-RECHT") === basisOffen,
      typeof pruefer === "string" ? `BRICHT AB: ${pruefer}`
        : `124=${pruefer.get(124)} 142=${pruefer.get(142)} `
          + `161=${pruefer.get(161)} 811=${pruefer.get(811)} `
          + `9998=${pruefer.get(9998)} (shop_offers=${darfOffers})`);

    /*
     * UND DIE GEGENPROBE: ohne den Schutz bricht dieselbe Datei ab. Ohne
     * sie wuesste dieser Probelauf nicht, ob er etwas prueft — es koennte
     * ja sein, dass die Rolle das Recht doch hat.
     */
    const roh = ohneKopf(sql[0]).replace(
      /case when has_table_privilege\('public\.offer_state_live', 'select'\)[\s\S]*?else 'KEIN-RECHT' end/,
      "(select count(*)::text from public.offer_state_live)");
    await db.exec("begin; set local role pruefrolle;");
    let abgebrochen = "(nicht abgebrochen)";
    try {
      await db.query(`select nr from (${roh}) x where nr = 124`);
    } catch (e) { abgebrochen = (e as Error).message.split("\n")[0]; }
    await db.exec("rollback;");
    ok = ok && sag("ohne Schutz", abgebrochen.includes("permission denied"), abgebrochen);

    /*
     * GEGENPROBE FUER DEN FUNKTIONSAUFRUF — der Fehler, der nach den
     * Tabellen uebrig blieb. Ohne den Schutz bricht dieselbe Datei mit
     * `permission denied for function offer_state_window` ab.
     */
    const rohFn = ohneKopf(sql[0]).replace(
      /case when has_function_privilege\('public\.offer_state_window\(\)', 'execute'\)[\s\S]*?else 'KEIN-RECHT' end/,
      "(select public.offer_state_window()::text)");
    await db.exec("begin; set local role pruefrolle;");
    let fnAb = "(nicht abgebrochen)";
    try {
      await db.query(`select nr from (${rohFn}) x where nr = 142`);
    } catch (e) { fnAb = (e as Error).message.split("\n")[0]; }
    await db.exec("rollback;");
    ok = ok && sag("Funktion ohne Schutz",
      fnAb.includes("permission denied for function"), fnAb);

    /*
     * UND DAS GANZE NETZ: JEDE DATEI, DIE DER RUNNER FAEHRT.
     *
     * Erst der Tabellenfehler, dann der Funktionsfehler — zweimal fiel
     * derselbe Mangel bei einem erneuten Versuch auf. Dieser Durchgang
     * fragt deshalb nicht einzelne Zeilen, sondern: laeuft die Datei unter
     * dem Pruefzugang UEBERHAUPT durch, und stimmt ihre eigene Zaehlung in
     * 9998 mit der Zahl der `KEIN-RECHT`-Zeilen?
     */
    const plaene = JSON.parse(readFileSync(
      join(CHECK_DIR, "migration-plans.json"), "utf8")) as
      { migrationen: Record<string, { preflight: string; postflight: string }> };
    const durchlauf: string[] = [];
    for (const [nummer, plan] of Object.entries(plaene.migrationen)) {
      for (const datei of [plan.preflight, plan.postflight]) {
        const anw = anweisungen(readFileSync(join(CHECK_DIR, datei), "utf8"))
          .filter((x) => planbar(x));
        await db.exec("begin; set local role pruefrolle;");
        try {
          const r = (await db.query(`select nr, befund from (${ohneKopf(anw[0])}) x`)) as
            { rows: { nr: number; befund: string }[] };
          const keinRecht = r.rows.filter(
            (z) => String(z.befund) === "KEIN-RECHT").length;
          const gezaehlt = r.rows.find((z) => Number(z.nr) === 9998)?.befund;
          const stimmt = String(gezaehlt) === String(keinRecht);
          ok = ok && stimmt;
          durchlauf.push(`${datei}: durch, ${keinRecht} offen (9998=${gezaehlt})`
            + (stimmt ? "" : " ZAEHLUNG FALSCH"));
        } catch (e) {
          ok = false;
          durchlauf.push(`${datei} (${nummer}): BRICHT AB — `
            + (e as Error).message.split("\n")[0]);
        } finally {
          await db.exec("rollback;");
        }
      }
    }
    befund.push(`alle Runner-Dateien → ${durchlauf.join(" | ")}`);

    /*
     * ============================================================
     * DER STRENGSTE DURCHGANG: ZWEIMAL FAHREN UND JEDE ABWEICHUNG
     * ERKLAEREN MUESSEN.
     * ============================================================
     *
     * Die vorigen Pruefungen finden, was ABBRICHT. Sie finden nicht, was
     * STILL FALSCH ist — und genau das war der letzte Befund:
     * `information_schema` ist rechtegefiltert, und
     * `information_schema.role_table_grants` lieferte dem Pruefzugang 0
     * Erteilungen auf `public.skylanders`, wo `aclexplode(relacl)` 4 zaehlt.
     * Eine Zeile „keine Grants fuer anon — erwartet 0" war damit gruen, OHNE
     * HINGESEHEN ZU HABEN. Ein Abbruch faellt auf; das hier nicht.
     *
     * DIE REGEL, DIE DAS ERSCHLAEGT: dieselbe Datei, als Eigner und als
     * Pruefzugang gefahren, muss Zeile fuer Zeile DASSELBE liefern — mit
     * genau einer erlaubten Ausnahme: eine Zeile, die beim Pruefzugang
     * `KEIN-RECHT` sagt. Jeder andere Unterschied heisst, dass eine Abfrage
     * je nach Rolle etwas anderes sieht, und das ist eine Pruefung, die
     * nicht prueft.
     */
    const abweichend: string[] = [];
    for (const [nummer, plan] of Object.entries(plaene.migrationen)) {
      for (const datei of [plan.preflight, plan.postflight]) {
        const anw = anweisungen(readFileSync(join(CHECK_DIR, datei), "utf8"))
          .filter((x) => planbar(x));
        /*
         * EIN FEHLER HIER IST EIN BEFUND, KEIN ABBRUCH DER VALIDIERUNG.
         *
         * Ohne `catch` riss eine Pruefdatei, die unter dem Pruefzugang
         * abbricht, den ganzen Lauf mit — und dann sagte die Ausgabe
         * „Validierung fehlgeschlagen: permission denied for schema auth"
         * ohne zu nennen, WELCHE Datei es war. Genau so ist `0148`s
         * Preflight-Zeile zu `auth.users` aufgefallen, nur unnoetig
         * schwer.
         */
        const fahre = async (rolle: string | null) => {
          await db.exec("begin;");
          if (rolle) await db.exec(`set local role ${rolle};`);
          try {
            const r = (await db.query(`select nr, befund from (${ohneKopf(anw[0])}) x`)) as
              { rows: { nr: number; befund: string }[] };
            return new Map(r.rows.map((z) => [Number(z.nr), String(z.befund)]));
          } catch (e) {
            return (e as Error).message.split("\n")[0];
          } finally { await db.exec("rollback;"); }
        };
        const alsEigner = await fahre(null);
        const alsAgent = await fahre("pruefrolle");
        if (typeof alsEigner === "string" || typeof alsAgent === "string") {
          abweichend.push(`${nummer}/${datei}: BRICHT AB — `
            + `${typeof alsEigner === "string" ? alsEigner : alsAgent}`);
          continue;
        }
        for (const [nr, wert] of alsEigner) {
          /* Die Summenzeilen haengen naturgemaess an den offenen Zeilen. */
          if (nr >= 9998) continue;
          const dort = alsAgent.get(nr);
          if (dort === wert) continue;
          if (dort === "KEIN-RECHT") continue;
          abweichend.push(`${nummer}/${datei} Zeile ${nr}: Eigner ${JSON.stringify(wert)}`
            + ` ≠ Pruefzugang ${JSON.stringify(dort)}`);
        }
      }
    }
    ok = ok && sag("rollenunabhaengig", abweichend.length === 0,
      abweichend.length === 0
        ? "jede Zeile liefert fuer Eigner und Pruefzugang dasselbe (ausser KEIN-RECHT)"
        : `${abweichend.length} ROLLENABHAENGIGE ZEILE(N): ${abweichend.slice(0, 4).join(" | ")}`);

    /*
     * UND DIE GEGENPROBE: mit `information_schema` statt `pg_catalog` MUSS
     * dieser Durchgang anschlagen. Ohne sie wuesste er nicht, ob er etwas
     * prueft.
     */
    {
      const anw = anweisungen(readFileSync(join(CHECK_DIR, "0146_postflight.sql"), "utf8"))
        .filter((x) => planbar(x));
      const zurueck = ohneKopf(anw[0]).replace(
        /\(select count\(\*\)::text from pg_class c, aclexplode\(c\.relacl\) a\s*where c\.oid = to_regclass\('public\.offer_state'\)[\s\S]*?\)\), '0'\)/,
        "(select count(*)::text from information_schema.role_table_grants "
        + "where table_schema = 'public' and table_name = 'offer_state' "
        + "and grantee in ('anon', 'authenticated', 'PUBLIC')), '0')");
      const hole = async (rolle: string | null) => {
        await db.exec("begin;");
        if (rolle) await db.exec(`set local role ${rolle};`);
        try {
          const r = (await db.query(
            `select befund from (${zurueck}) x where nr = 113`)) as
            { rows: { befund: string }[] };
          return String(r.rows[0]?.befund);
        } finally { await db.exec("rollback;"); }
      };
      /* Im Stub hat `offer_state` keine Clientrechte, also liefern beide 0 —
         die Gegenprobe braucht eine Tabelle MIT Rechten. */
      await db.exec("grant select on table public.offer_state to anon;");
      const e = await hole(null);
      const a2 = await hole("pruefrolle");
      await db.exec("revoke select on table public.offer_state from anon;");
      ok = ok && sag("Gegenprobe information_schema", e !== a2,
        `Eigner ${e}, Pruefzugang ${a2}`
        + (e !== a2 ? " — rollenabhaengig, wie erwartet" : " — NICHT erkannt!"));
    }

    /* Zahlen sind auch dann noch Zahlen, wenn Zeilen dastehen. */
    await db.exec(`insert into public.offer_state (sky_id, buyable, cheapest_cents)
                   values ('SKY-0001', true, 1200), ('SKY-0002', false, null);`);
    const mitZeilen = await hol(null);
    ok = ok && sag("mit zwei Zeilen", typeof mitZeilen !== "string"
      && mitZeilen.get(161) === "2",
      typeof mitZeilen === "string" ? mitZeilen : `161=${mitZeilen.get(161)}`);

    probe.push({
      name: "P54 jede Runner-Pruefdatei laeuft unter dem lesenden Pruefzugang DURCH: "
        + "geschuetzte Tabellen, Sichten UND Funktionsaufrufe melden KEIN-RECHT statt die "
        + "Einreichung mitzunehmen, und 9998 zaehlt sie richtig",
      ok,
      sagt: befund.join(" · "),
    });
    } /* Ende: gueltige Rechteaufnahme */
  }

  /* P55 — `0147`: DIE VERFUEGBARKEITSKANTE, jeder geforderte Fall gefahren.
   *
   * WAS HIER ZUR PRUEFUNG STEHT: dass aus dem Spiegel eine KANTE wird, und
   * zwar ohne falsche Meldungen. Die acht Faelle des Auftrags, in einer
   * Instanz hintereinander — und am Ende der Abdruck von Shop, Lager und
   * Sammlung, der sich nicht bewegt haben darf.
   *
   * ZEITREISE DURCH ZURUECKDATIEREN. PGlite faehrt eine Verbindung, `now()`
   * ist die Transaktionszeit. Dreissig Minuten vergehen hier also, indem die
   * Zeitstempel im Spiegel zurueckdatiert werden — das ist genau die Groesse,
   * auf die die Karenzzeit rechnet, und es prueft die Regel und nicht die Uhr.
   */
  {
    const db = await frisch();
    await db.exec("drop function if exists public.offer_availability_due();");
    await db.exec("drop function if exists public.offer_availability_grace();");
    await db.exec("drop function if exists public.refresh_offer_state();");
    await db.exec("drop view if exists public.offer_state_live;");
    await db.exec("drop table if exists public.offer_state cascade;");
    await db.exec("drop function if exists public.offer_state_window();");
    await attrappenFuerBaseline(db);

    await db.exec(`
      alter table public.skylanders add constraint z55_sky_pk primary key (sky_id);
      insert into public.skylanders (sky_id, name, slug, market_price)
      values ('SKY-7001', 'Probe Bash', 'probe-bash-55', 20.00),
             ('SKY-7002', 'Probe Legendary Bash', 'probe-legendary-55', 30.00)
        on conflict do nothing;
      insert into public.shop_settings (id, price_percentage)
      values (true, 100) on conflict do nothing;
      alter table public.shop_inventory drop column if exists available_quantity;
      alter table public.shop_inventory
        add column available_quantity integer
        generated always as (quantity - reserved) stored;
      create sequence if not exists public.z55_inv_seq start 1;
      alter table public.shop_inventory alter column id set default nextval('public.z55_inv_seq');
      drop function if exists public.shop_offers();
      create function public.shop_offers()
      returns table (sky_id text, condition text, price numeric,
                     available boolean, delivery_scope text)
      language sql stable as $p55$
        select i.sky_id, i.condition,
               public.shop_price(i.sale_price, s.market_price, st.price_percentage),
               (i.available_quantity > 0),
               null::text
          from public.shop_inventory i
          join public.skylanders s on s.sky_id = i.sky_id
          cross join public.shop_settings st
         where i.is_listed
           and i.condition = public.v1_sale_condition()
           and public.shop_price(i.sale_price, s.market_price, st.price_percentage)
               is not null;
      $p55$;
      insert into public.shop_inventory (sky_id, condition, quantity, reserved, is_listed)
      values ('SKY-7001', 'loose', 2, 0, true),
             ('SKY-7002', 'loose', 1, 0, true);`);

    /*
     * DIE SECHS BEKANNTEN TRIGGER, wie Staging sie hat.
     *
     * Das Stub-Schema legt keine Trigger an, und genau dadurch war der
     * Fehlgriff in `0147` hier UNSICHTBAR: die Migration zaehlte Trigger an
     * den Quellen und erwartete null, der Probelauf fand null, alles gruen —
     * und auf Staging brach sie mit sechs voellig legitimen Triggern ab.
     * Ein Probelauf, der eine leerere Welt nachbildet als die echte, beweist
     * nichts. (Dieselbe Lehre wie bei `P54` und den Entzuegen.)
     *
     * Die Namen stammen aus `0001`, `0003`, `0004` und `0135`; die
     * Triggerfunktion ist hier eine Attrappe, denn geprueft wird die
     * ERWARTUNGSLISTE und nicht ihr Rumpf.
     */
    await db.exec(`
      create or replace function public.z55_trg() returns trigger
      language plpgsql as $t$ begin return new; end $t$;
      create trigger shop_inventory_identity_immutable before update
        on public.shop_inventory for each row execute function public.z55_trg();
      create trigger shop_inventory_set_updated_at before update
        on public.shop_inventory for each row execute function public.z55_trg();
      create trigger skylanders_item_type_from_category before insert
        on public.skylanders for each row execute function public.z55_trg();
      create trigger skylanders_log_editorial after update
        on public.skylanders for each row execute function public.z55_trg();
      create trigger skylanders_set_updated_at before update
        on public.skylanders for each row execute function public.z55_trg();
      create trigger skylanders_sky_id_immutable before update
        on public.skylanders for each row execute function public.z55_trg();`);

    const befund: string[] = [];
    let ok = true;
    const sag = (was: string, gut: boolean, text: string): boolean => {
      befund.push(`${was}: ${gut ? text : `BEFUND ${text}`}`);
      return gut;
    };
    const wert = async (sql: string): Promise<string> =>
      String(((await db.query(sql)) as { rows: Record<string, unknown>[] })
        .rows[0]?.w ?? "?");
    const ruf = async (): Promise<string> =>
      String(((await db.query("select reason as w from public.refresh_offer_state()")) as
        { rows: { w: string }[] }).rows[0]?.w);
    /** Welche SKY-IDs sind faellig? */
    const faellig = async (): Promise<string> =>
      await wert("select coalesce(string_agg(sky_id, ',' order by sky_id), '(keine)') as w "
        + "from public.offer_availability_due()");
    /**
     * Zeit vergehen lassen.
     *
     * ES MUSS DIE GANZE VORGESCHICHTE SEIN, nicht nur ein Zeitstempel. Ein
     * erster Entwurf datierte allein `buyable_since` und `changed_at`
     * zurueck — damit rutschte der Phasenbeginn VOR `announced_at`, und die
     * Bedingung `buyable_since > announced_at` war falsch. Der Fall sah aus
     * wie ein Fehler in der Migration und war einer im Test: in der
     * Wirklichkeit laeuft die Uhr vorwaerts, also wird hier ALLES
     * Vergangene gleich weit zurueckgeschoben.
     *
     * `announced_at` darf dabei `null` sein (Zeilen, die nach der
     * Erstbefuellung entstanden sind) — `null - interval` bleibt `null`.
     */
    const warte = (minuten: number, nur = "") => db.exec(
      `update public.offer_state set`
      + ` buyable_since = buyable_since - interval '${minuten} minutes',`
      + ` changed_at = changed_at - interval '${minuten} minutes',`
      + ` checked_at = checked_at - interval '${minuten} minutes',`
      + ` announced_at = announced_at - interval '${minuten} minutes'`
      + (nur ? ` where sky_id = '${nur}'` : ""));
    /** Was S3 tun wird: das Ereignis uebernehmen. */
    const melde = (sky: string) => db.exec(
      `update public.offer_state set announced_buyable = true, announced_at = now(),`
      + ` announced_cents = cheapest_cents where sky_id = '${sky}'`);
    /**
     * Ist die Phasengrenze FRISCH, also gerade neu gesetzt?
     *
     * Absolute Zeitstempel ueber ein `warte()` hinweg zu vergleichen geht
     * nicht — `warte` verschiebt sie mit. Gefragt ist die Aussage: wurde die
     * Phase NEU BEGONNEN (`buyable_since` ist eben entstanden) oder
     * UEBERNOMMEN (sie ist aelter)?
     */
    const phaseNeu = (sky: string) => wert(
      `select (buyable_since > now() - interval '1 minute')::text as w`
      + ` from public.offer_state where sky_id = '${sky}'`);

    /**
     * Der Abdruck von Shop, Lager und Sammlung.
     *
     * Die Szenarien unten veraendern das Lager ABSICHTLICH — sie bauen
     * damit die Angebotslage. Gefragt ist etwas anderes: dass die MIGRATION
     * und die ENTSCHEIDUNGSFUNKTION nichts daran aendern.
     */
    const abdruck = () => wert(`select md5(
        coalesce((select string_agg(i.id::text || '|' || i.sky_id || '|'
                                    || i.is_listed::text || '|' || i.quantity::text || '|'
                                    || i.reserved::text, ';' order by i.id)
                    from public.shop_inventory i), '-')
     || coalesce((select string_agg(k.sky_id || '|' || coalesce(k.market_price::text, '-'),
                                    ';' order by k.sky_id)
                    from public.skylanders k), '-')
     || coalesce((select count(*)::text from public.collection_items), '-')) as w`);

    /* -------------------------------------------------- 1. Die Migrationen */
    const l146 = await fahre(db, join(MIG_DIR, "0146_offer_state.sql"));
    ok = sag("0146", l146 === null, l146 ?? "durch");
    /* Erstbefuellung: beide kaufbar, beide BEREITS GEMELDET. */
    if (ok) await ruf();
    /* ----- 1x. DIE DREI TRIGGERFAELLE: erlaubt, unerwartet, am Spiegel ---- */
    if (ok) {
      /*
       * DER ABBRUCH VOM 2026-10-26, als Pruefung. Erst muessen die sechs
       * bekannten DURCHGEHEN — das war der Fehler. Dann muss ein siebter
       * auffallen, und einer am Spiegel auch.
       */
      const mitTrigger = async (ddl: string): Promise<string> => {
        await db.exec(ddl);
        const r = await fahre(db, join(MIG_DIR, "0147_offer_availability.sql"));
        return r ?? "(durchgelaufen)";
      };

      /* a) ein siebter an einer Quelle */
      const siebter = await mitTrigger(
        "create trigger z55_unerwartet after insert on public.shop_inventory"
        + " for each row execute function public.z55_trg();");
      await db.exec("drop trigger z55_unerwartet on public.shop_inventory;");

      /* b) einer am Spiegel selbst */
      const amSpiegel = await mitTrigger(
        "create trigger z55_am_spiegel after insert on public.offer_state"
        + " for each row execute function public.z55_trg();");
      await db.exec("drop trigger z55_am_spiegel on public.offer_state;");

      ok = sag("Triggerfaelle",
        siebter.includes("unerwartete Trigger")
        && siebter.includes("z55_unerwartet")
        && amSpiegel.includes("Trigger auf offer_state"),
        `siebter: ${siebter.slice(0, 70)} · am Spiegel: ${amSpiegel.slice(0, 60)}`);
    }

    /* Der Preflight, als Eigner, VOR 0147 — mit seinen echten Erwartungen. */
    if (ok) {
      const anw = anweisungen(readFileSync(
        join(CHECK_DIR, "0147_preflight.sql"), "utf8")).filter((x) => planbar(x));
      const r = (await db.query(`select nr, befund, erwartet
                                   from (${ohneKopf(anw[0])}) x
                                  where ok is false and nr < 800`)) as
        { rows: { nr: number; befund: string; erwartet: string }[] };
      ok = sag("Preflight 0147 als Eigner", r.rows.length === 0,
        r.rows.length === 0 ? "jede Zeile mit Erwartung stimmt"
          : r.rows.map((z) => `${z.nr} ${JSON.stringify(z.befund)} statt `
              + `${JSON.stringify(z.erwartet)}`).join(" | "));
    }

    const vorMigration = ok ? await abdruck() : "-";
    const l147 = ok ? await fahre(db, join(MIG_DIR, "0147_offer_availability.sql")) : "-";
    ok = ok && sag("0147", l147 === null, l147 ?? "durch");
    if (ok) {
      ok = sag("Migration ruehrt Shop/Lager/Sammlung nicht an",
        await abdruck() === vorMigration, "Abdruck unveraendert");
    }

    /*
     * DIE DROSSEL BLEIBT OFFEN — ueber das Fenster, NACH den Migrationen.
     *
     * Drei Anlaeufe, drei Lehren: `checked_at` zurueckzudatieren verletzt
     * `offer_state_checked_after_changed`; `changed_at` mitzualtern laesst
     * JEDE Abwesenheit echt aussehen und macht den Warenkorbfall unpruefbar;
     * und das Fenster VOR den Migrationen zu setzen hilft nicht, weil `0146`
     * `offer_state_window()` selbst neu anlegt.
     *
     * Dass die Drosselung greift, faehrt `P53`. Hier steht die Kante zur
     * Pruefung, nicht die Uhr.
     */
    if (ok) {
      await db.exec(`create or replace function public.offer_state_window()
        returns interval language sql immutable set search_path = ''
        as $p55w$ select interval '0' $p55w$;`);
    }

    const spalten = ok ? await wert(
      "select string_agg(a.attname::text, ',' order by a.attnum) as w from pg_attribute a "
      + "where a.attrelid = to_regclass('public.offer_state') "
      + "and a.attnum > 0 and not a.attisdropped") : "-";
    ok = ok && sag("Spalten", spalten.endsWith(",buyable_since"), spalten);

    /* ---- 1a. DIE NACHKONTROLLE VON 0147, MIT IHREN ECHTEN ERWARTUNGEN -- */
    if (ok) {
      /*
       * Eine Nachkontrolle, deren Sollwerte nie gelaufen sind, ist eine
       * Vermutung. Hier laeuft sie als EIGNER direkt nach der Migration:
       * jede Zeile mit einer Erwartung muss stimmen.
       *
       * Die Baselinezeilen (8xx) bleiben aussen vor — die brauchen die zwei
       * Vertragszeilen des Preflights, und die reicht der Runner erst beim
       * Lauf mit. Dass sie greifen, faehrt `P52` fuer `0145`.
       */
      const anw = anweisungen(readFileSync(
        join(CHECK_DIR, "0147_postflight.sql"), "utf8")).filter((x) => planbar(x));
      const r = (await db.query(`select nr, pruefung, befund, erwartet, ok
                                   from (${ohneKopf(anw[0])}) x
                                  where ok is false and nr < 800`)) as
        { rows: { nr: number; pruefung: string; befund: string; erwartet: string }[] };
      ok = sag("Nachkontrolle 0147 als Eigner",
        r.rows.length === 0,
        r.rows.length === 0 ? "jede Zeile mit Erwartung stimmt"
          : r.rows.map((z) => `${z.nr} ${JSON.stringify(z.befund)} statt `
              + `${JSON.stringify(z.erwartet)}`).join(" | "));
    }

    /* ---- 1b. EINE PREISAENDERUNG VOR 0147 DARF KEINE NEUIGKEIT WERDEN --- */
    if (ok) {
      /*
       * DER FALL, DER DIE NACHFUELLUNG BEINAHE FALSCH GEMACHT HAETTE.
       *
       * `changed_at` bewegt sich auch bei einer Preisaenderung. Hat sich
       * nach der Erstbefuellung bei einer durchgehend kaufbaren Figur der
       * Preis geaendert, steht `changed_at` HINTER `announced_at` — und ein
       * `buyable_since = changed_at` haette sie faellig gemacht. Hier wird
       * genau das hergestellt und geprueft.
       *
       * Gefahren wird es NACH `0147`, indem die Lage nachgebaut und die
       * Nachfuellung noch einmal angewandt wird: `buyable_since` bekommt
       * `least(changed_at, announced_at)`, und damit ist die Zeile nicht
       * faellig.
       */
      await db.exec("update public.shop_inventory set sale_price = 25.00"
        + " where sky_id = 'SKY-7001'");
      await ruf();
      const preisNeuer = await wert(
        "select (changed_at > announced_at)::text as w from public.offer_state"
        + " where sky_id = 'SKY-7001'");
      /* Die Nachfuellung von 0147 noch einmal, auf genau diese Zeile. */
      await db.exec(`update public.offer_state
           set buyable_since = case
                 when announced_at is not null then least(changed_at, announced_at)
                 else changed_at
               end
         where buyable and sky_id = 'SKY-7001'`);
      await warte(31, "SKY-7001");
      const faelligNachPreis = (await faellig()).includes("SKY-7001");
      ok = sag("Preisaenderung vor 0147 ist keine Neuigkeit",
        preisNeuer === "true" && !faelligNachPreis,
        `changed_at hinter announced_at: ${preisNeuer}, `
        + `danach faellig: ${faelligNachPreis} (muss false sein)`);
      /* Fuer die folgenden Szenarien denselben Stand wiederherstellen. */
      await db.exec("update public.shop_inventory set sale_price = null"
        + " where sky_id = 'SKY-7001'");
      await ruf();
      await db.exec("update public.offer_state set announced_cents = cheapest_cents,"
        + " announced_at = now(), buyable_since = least(buyable_since, now())"
        + " where sky_id = 'SKY-7001'");
    }

    /* ------------- 2. BEREITS VERFUEGBARE AUS DER ERSTINITIALISIERUNG ----- */
    if (ok) {
      await warte(90);
      ok = sag("Erstbestand nie faellig", await faellig() === "(keine)",
        `nach 90 min: ${await faellig()}`);
    }

    /* --------------- 3. NICHT VERFUEGBAR → VERFUEGBAR → 30 min STABIL ---- */
    if (ok) {
      /* Weg: entlisten, auffrischen. */
      await db.exec("update public.shop_inventory set is_listed = false where sky_id = 'SKY-7001'");
      await ruf();
      const weg = await wert("select buyable::text as w from public.offer_state "
        + "where sky_id = 'SKY-7001'");
      /* Die Abwesenheit muss ECHT sein: laenger als reservation_ttl(). */
      await warte(25, "SKY-7001");
      /* Wieder da. */
      await db.exec("update public.shop_inventory set is_listed = true where sky_id = 'SKY-7001'");
      await ruf();
      const sofort = await faellig();
      await warte(31, "SKY-7001");
      const spaeter = await faellig();
      ok = sag("nicht kaufbar → kaufbar → 30 min",
        weg === "false" && sofort === "(keine)" && spaeter === "SKY-7001",
        `weg ${weg}, sofort ${sofort}, nach 31 min ${spaeter}`);
    }

    /* --------------------- 4. VARIANTEN BLEIBEN GETRENNT ----------------- */
    if (ok) {
      ok = sag("nur die exakte SKY-ID", await faellig() === "SKY-7001",
        `faellig: ${await faellig()} (SKY-7002 ist dieselbe Figur als Variante)`);
    }

    /* -------- 5. WIEDERHOLTE UND PARALLELE AUFRUFE, DANN UEBERNAHME ------ */
    if (ok) {
      const a = await faellig();
      const b = await faellig();
      const c = await faellig();
      /* Rein lesend heisst: dreimal dasselbe, nichts verbraucht. */
      const gleich = a === b && b === c;
      await melde("SKY-7001");
      const danach = await faellig();
      ok = sag("mehrfach lesen, dann uebernehmen",
        gleich && danach === "(keine)",
        `dreimal ${a}, nach der Uebernahme ${danach}`);
    }

    /* ------- 6. ANGEBOT VERSCHWINDET VOR ABLAUF DER 30 MINUTEN ---------- */
    if (ok) {
      await db.exec("update public.shop_inventory set is_listed = false where sky_id = 'SKY-7002'");
      await ruf();
      await warte(25, "SKY-7002");
      await db.exec("update public.shop_inventory set is_listed = true where sky_id = 'SKY-7002'");
      await ruf();
      await warte(10, "SKY-7002");                     /* erst 10 von 30 min */
      const mitten = await faellig();
      await db.exec("update public.shop_inventory set is_listed = false where sky_id = 'SKY-7002'");
      await ruf();
      const fort = await faellig();
      ok = sag("verschwindet vor 30 min", mitten === "(keine)" && fort === "(keine)",
        `nach 10 min ${mitten}, nach dem Verschwinden ${fort}`);
    }

    /* --------------- 7. KURZE WARENKORBRESERVIERUNG ---------------------- */
    if (ok) {
      /* SKY-7002 wieder da und 31 min stabil, aber NOCH NICHT gemeldet. */
      await db.exec("update public.shop_inventory set is_listed = true where sky_id = 'SKY-7002'");
      await ruf();
      await warte(31, "SKY-7002");
      const vorher = await faellig();
      await melde("SKY-7002");

      /* Jetzt die Reservierung: reserved = quantity → available_quantity 0. */
      await db.exec("update public.shop_inventory set reserved = 1 where sky_id = 'SKY-7002'");
      await ruf();
      const wegDurchKorb = await wert("select buyable::text as w from public.offer_state "
        + "where sky_id = 'SKY-7002'");
      /* Zwei Minuten spaeter wieder frei — kuerzer als reservation_ttl(). */
      await warte(2, "SKY-7002");
      await db.exec("update public.shop_inventory set reserved = 0 where sky_id = 'SKY-7002'");
      await ruf();
      /* DIE ENTSCHEIDENDE FRAGE: uebernommen, nicht neu begonnen. */
      const neuBegonnen = await phaseNeu("SKY-7002");
      await warte(31, "SKY-7002");
      const nachKorb = await faellig();
      ok = sag("kurze Reservierung",
        vorher === "SKY-7002" && wegDurchKorb === "false"
        && neuBegonnen === "false" && nachKorb === "(keine)",
        `vorher ${vorher}, durch Korb weg ${wegDurchKorb}, `
        + `Phase neu begonnen ${neuBegonnen} (muss false sein), danach ${nachKorb}`);
    }

    /* ---- 7b. MEHRERE AUFFRISCHUNGEN WAEHREND EINER KURZEN ABWESENHEIT -- */
    if (ok) {
      /*
       * DIE FRAGE DES BETREIBERS: haelt die Uebernahme auch, wenn WAEHREND
       * der Reservierung mehrfach aufgefrischt wird?
       *
       * Sie haelt, und zwar aus einem Grund, der am SQL zu lesen ist:
       * Schritt 6 setzt `changed_at` nur, WENN die Zeile vorher kaufbar war
       * (`case when s.buyable then now() else s.changed_at end`). Jede
       * weitere Auffrischung derselben Abwesenheit laesst ihn also stehen,
       * und `now() - s.changed_at` waechst mit der echten Zeit statt mit der
       * Zahl der Aufrufe. Hier wird das gefahren, nicht behauptet.
       */
      /*
       * ERST EINEN ECHTEN ZYKLUS HERSTELLEN. SKY-7001 ist an dieser Stelle
       * kaufbar UND gemeldet — ohne diesen Schritt waere sie nie faellig,
       * und der Test pruefte nichts. (Genau das war der erste Entwurf.)
       */
      await db.exec("update public.shop_inventory set reserved = 2 where sky_id = 'SKY-7001'");
      await ruf();
      await warte(25, "SKY-7001");
      await db.exec("update public.shop_inventory set reserved = 0 where sky_id = 'SKY-7001'");
      await ruf();
      await warte(31, "SKY-7001");
      const vorher = (await faellig()).includes("SKY-7001") ? "faellig" : "NICHT faellig";
      await melde("SKY-7001");

      /* Reservierung, und dann VIER Auffrischungen ueber drei Minuten. */
      await db.exec("update public.shop_inventory set reserved = 2 where sky_id = 'SKY-7001'");
      await ruf();
      const zwischen: string[] = [];
      for (let i = 0; i < 3; i++) {
        await warte(1, "SKY-7001");            /* eine Minute je Runde */
        await ruf();
        zwischen.push(await wert(
          "select (now() - changed_at)::text as w from public.offer_state"
          + " where sky_id = 'SKY-7001'"));
      }
      await db.exec("update public.shop_inventory set reserved = 0 where sky_id = 'SKY-7001'");
      await ruf();
      const neuBegonnen = await phaseNeu("SKY-7001");
      await warte(31, "SKY-7001");
      const danach = (await faellig()).includes("SKY-7001") ? "faellig" : "nicht faellig";
      ok = sag("vier Auffrischungen in der Reservierung",
        vorher === "faellig" && neuBegonnen === "false" && danach === "nicht faellig",
        `vorher ${vorher}, Abwesenheit wuchs auf ${zwischen[zwischen.length - 1]}, `
        + `Phase neu begonnen ${neuBegonnen} (muss false sein), danach ${danach}`);
    }

    /* ---- 7c. DIE GRENZE: GENAU AB reservation_ttl() IST ES EIN ZYKLUS --- */
    if (ok) {
      /*
       * Die Bedingung ist `< reservation_ttl()`, also ist GENAU die TTL
       * schon eine echte Abwesenheit. Beide Seiten der Grenze werden
       * gefahren — eine Regel, deren Rand nicht geprueft ist, ist eine
       * halbe Regel.
       */
      const rand = async (minuten: number): Promise<string> => {
        await db.exec("update public.shop_inventory set reserved = 2 where sky_id = 'SKY-7001'");
        await ruf();
        await warte(minuten, "SKY-7001");
        await db.exec("update public.shop_inventory set reserved = 0 where sky_id = 'SKY-7001'");
        await ruf();
        return await phaseNeu("SKY-7001");
      };
      const knappDrunter = await rand(19);   /* 19 < 20 → dieselbe Phase */
      const genauDrauf = await rand(20);     /* 20 → neue Phase */
      ok = sag("die Grenze bei reservation_ttl()",
        knappDrunter === "false" && genauDrauf === "true",
        `19 min: neu ${knappDrunter} (muss false) · 20 min: neu ${genauDrauf} (muss true)`);
    }

    /* ------------------ 8. MEHRERE ZYKLEN DERSELBEN SKY-ID --------------- */
    if (ok) {
      /* Echte Abwesenheit: 25 min > reservation_ttl(). */
      await db.exec("update public.shop_inventory set is_listed = false where sky_id = 'SKY-7002'");
      await ruf();
      await warte(25, "SKY-7002");
      await db.exec("update public.shop_inventory set is_listed = true where sky_id = 'SKY-7002'");
      await ruf();
      /* Hier MUSS die Phase neu beginnen — die Gegenprobe zum Warenkorbfall. */
      const neuBegonnen = await phaseNeu("SKY-7002");
      await warte(31, "SKY-7002");
      const zweiterZyklus = await faellig();
      ok = sag("zweiter echter Zyklus",
        neuBegonnen === "true" && zweiterZyklus === "SKY-7002",
        `Phase neu begonnen ${neuBegonnen} (muss true sein), faellig ${zweiterZyklus}`);
    }

    /* ---------------- 9. DIE GEGENPROBE GEGEN DIE GEGENWART -------------- */
    if (ok) {
      /*
       * Der Spiegel sagt kaufbar, die Sicht nicht mehr — genau das Szenario
       * aus dem Vertrag von `0146`. Das Angebot wird entlistet, OHNE den
       * Spiegel nachzuziehen.
       */
      const vorher = await faellig();
      await db.exec("update public.shop_inventory set is_listed = false where sky_id = 'SKY-7002'");
      const nachher = await faellig();
      const spiegelSagt = await wert("select buyable::text as w from public.offer_state "
        + "where sky_id = 'SKY-7002'");
      await db.exec("update public.shop_inventory set is_listed = true where sky_id = 'SKY-7002'");
      ok = sag("Gegenprobe gegen offer_state_live",
        vorher === "SKY-7002" && nachher === "(keine)" && spiegelSagt === "true",
        `vorher ${vorher}, nach dem Entlisten ${nachher}, Spiegel sagt noch ${spiegelSagt}`);
    }

    /* ------- 9b. DIE UEBERNAHME DURCH S3: ATOMAR UND NUR EINMAL --------- */
    if (ok) {
      /*
       * Der Vertrag aus dem Kopf von `0147`, gefahren. Zwei Aufrufe
       * versuchen dasselbe Ereignis zu uebernehmen; der zweite muss NULL
       * Zeilen bekommen.
       *
       * ECHTE GLEICHZEITIGKEIT ist in PGlite nicht fahrbar (eine
       * Verbindung). Was hier laeuft, ist die Lage NACH dem Warten auf die
       * Zeilensperre: der zweite Aufruf prueft sein `where` gegen die neue
       * Fassung der Zeile. Genau das tut PostgreSQL unter READ COMMITTED,
       * und genau das ist der Riegel.
       */
      const uebernimm = async (sky: string): Promise<number> => {
        const r = (await db.query(`
          update public.offer_state s
             set announced_buyable = true,
                 announced_cents   = s.cheapest_cents,
                 announced_at      = now()
           where s.sky_id = '${sky}'
             and s.buyable
             and s.buyable_since is not null
             and now() - s.buyable_since >= public.offer_availability_grace()
             and (s.announced_at is null or s.buyable_since > s.announced_at)
          returning s.sky_id`)) as { rows: unknown[] };
        return r.rows.length;
      };
      /* SKY-7002 ist aus Szenario 8 faellig. */
      const faelligVor = (await faellig()).includes("SKY-7002");
      const ersterLauf = await uebernimm("SKY-7002");
      const zweiterLauf = await uebernimm("SKY-7002");
      const faelligNach = (await faellig()).includes("SKY-7002");
      ok = sag("Uebernahme genau einmal",
        faelligVor && ersterLauf === 1 && zweiterLauf === 0 && !faelligNach,
        `vorher faellig ${faelligVor}, erster Lauf ${ersterLauf} Zeile(n), `
        + `zweiter ${zweiterLauf} (muss 0 sein), danach faellig ${faelligNach}`);
    }

    /* ------------------- 10. KARENZZEIT UND RUECKNAHME ------------------- */
    if (ok) {
      const grace = await wert("select public.offer_availability_grace()::text as w");
      const ttl = await wert("select public.reservation_ttl()::text as w");
      ok = sag("Karenzzeit", grace === "00:30:00" && ttl === "00:20:00",
        `${grace} aus ${ttl} + 10 min`);
    }
    /* ------------- 11. DIE ENTSCHEIDUNG SCHREIBT NICHT, UND KANN NICHT --- */
    if (ok) {
      const vor = await abdruck();
      const zustandVor = await wert(
        "select md5(string_agg(sky_id || '|' || buyable::text || '|'"
        + " || coalesce(buyable_since::text, '-') || '|'"
        + " || coalesce(announced_at::text, '-'), ';' order by sky_id)) as w"
        + " from public.offer_state");
      for (let i = 0; i < 5; i++) await faellig();
      const nach = await abdruck();
      const zustandNach = await wert(
        "select md5(string_agg(sky_id || '|' || buyable::text || '|'"
        + " || coalesce(buyable_since::text, '-') || '|'"
        + " || coalesce(announced_at::text, '-'), ';' order by sky_id)) as w"
        + " from public.offer_state");
      /*
       * UND SIE KANN ES AUCH NICHT: `stable` statt `volatile`. Das ist die
       * Zusage an S3 — ein Ereignis gilt erst als uebernommen, wenn S3
       * `announced_*` setzt, in derselben Transaktion wie die Meldungen.
       *
       * ECHTE PARALLELITAET ist hier nicht fahrbar: PGlite faehrt EINE
       * Verbindung. Dass gleichzeitige Aufrufe unkritisch sind, folgt
       * daraus, dass diese Funktion nichts schreibt — und das steht hier
       * als Messung.
       */
      const art = await wert("select provolatile::text as w from pg_proc"
        + " where oid = to_regprocedure('public.offer_availability_due()')");
      ok = sag("fuenf Aufrufe schreiben nichts",
        vor === nach && zustandVor === zustandNach && art === "s",
        `Abdruck ${vor === nach}, Spiegel ${zustandVor === zustandNach}, provolatile ${art}`);
    }

    if (ok) {
      const r = await fahre(db, "supabase/rollback/R0147_offer_availability.sql");
      const fort = r === null ? await wert(
        "select ((to_regprocedure('public.offer_availability_due()') is null)"
        + " and (to_regprocedure('public.offer_availability_grace()') is null)"
        + " and (select count(*) = 0 from pg_attribute a"
        + "        where a.attrelid = to_regclass('public.offer_state')"
        + "          and a.attname = 'buyable_since' and not a.attisdropped))::text as w")
        : "-";
      ok = sag("Ruecknahme", r === null && fort === "true", `${r ?? "durch"}, fort ${fort}`);
    }

    probe.push({
      name: "P55 0147 erkennt die Verfuegbarkeitskante: 30 min Stabilisierung, "
        + "Warenkorbreservierung unterbricht die Phase nicht, kein Duplikat, spaetere "
        + "Zyklen wieder moeglich, Gegenprobe gegen die Gegenwart",
      ok,
      sagt: `0147: ${befund.join(" · ")}`,
    });
  }

  /* P56 — `0148`: AUS EINEM EREIGNIS WERDEN PERSOENLICHE MELDUNGEN.
   *
   * WAS DAFUER GESTELLT WIRD, sichtbar und begrenzt: `auth.uid()` liest hier
   * eine Sitzungsvariable, damit mehrere Nutzer pruefbar sind, und
   * `is_collector_account()` gibt `true`. Geprueft wird `0148`, nicht die
   * Rollenlogik — dass die Richtlinie ueberhaupt fragt, steht im Text und in
   * der Nachkontrolle.
   *
   * ZEITREISE durch Zurueckdatieren, wie in P55: die ganze Vorgeschichte
   * wird gleich weit zurueckgeschoben, `announced_at` und `created_at` der
   * Favoriten eingeschlossen.
   */
  {
    const A = "aaaaaaaa-0000-0000-0000-000000000001";
    const B = "bbbbbbbb-0000-0000-0000-000000000002";
    const C = "cccccccc-0000-0000-0000-000000000003";

    const db = await frisch();
    /* Das Stub-Schema kennt ALLE Migrationen, also auch 0148 und 0149. Beide
       werden hier erst wieder angelegt — die Reihenfolge ist Teil dessen,
       was geprueft wird. */
    await db.exec("drop function if exists public.mark_availability_notifications_read(text[]);");
    await db.exec("drop function if exists public.claim_availability_notifications();");
    await db.exec("drop table if exists public.availability_notifications cascade;");
    await db.exec("drop function if exists public.offer_availability_due();");
    await db.exec("drop function if exists public.offer_availability_grace();");
    await db.exec("drop function if exists public.refresh_offer_state();");
    await db.exec("drop view if exists public.offer_state_live;");
    await db.exec("drop table if exists public.offer_state cascade;");
    await db.exec("drop function if exists public.offer_state_window();");
    await attrappenFuerBaseline(db);

    await db.exec(`
      create schema if not exists auth;
      create table if not exists auth.users (id uuid primary key);
      insert into auth.users (id) values ('${A}'), ('${B}'), ('${C}')
        on conflict do nothing;
      create or replace function auth.uid() returns uuid
        language sql stable
        as $u$ select nullif(current_setting('z56.uid', true), '')::uuid $u$;
      create or replace function public.is_collector_account() returns boolean
        language sql stable as $k$ select true $k$;
      alter table public.skylanders add constraint z56_sky_pk primary key (sky_id);
      insert into public.skylanders (sky_id, name, slug, market_price)
      values ('SKY-7001', 'Probe Bash', 'probe-bash-56', 20.00),
             ('SKY-7002', 'Probe Variante', 'probe-variante-56', 30.00)
        on conflict do nothing;
      insert into public.shop_settings (id, price_percentage)
      values (true, 100) on conflict do nothing;
      alter table public.shop_inventory drop column if exists available_quantity;
      alter table public.shop_inventory
        add column available_quantity integer
        generated always as (quantity - reserved) stored;
      create sequence if not exists public.z56_inv_seq start 1;
      alter table public.shop_inventory alter column id set default nextval('public.z56_inv_seq');
      drop function if exists public.shop_offers();
      create function public.shop_offers()
      returns table (sky_id text, condition text, price numeric,
                     available boolean, delivery_scope text)
      language sql stable as $p56$
        select i.sky_id, i.condition,
               public.shop_price(i.sale_price, s.market_price, st.price_percentage),
               (i.available_quantity > 0), null::text
          from public.shop_inventory i
          join public.skylanders s on s.sky_id = i.sky_id
          cross join public.shop_settings st
         where i.is_listed
           and i.condition = public.v1_sale_condition()
           and public.shop_price(i.sale_price, s.market_price, st.price_percentage)
               is not null;
      $p56$;
      insert into public.shop_inventory (sky_id, condition, quantity, reserved, is_listed)
      values ('SKY-7001', 'loose', 2, 0, true),
             ('SKY-7002', 'loose', 1, 0, true);`);

    /*
     * `favorites` WIE 0145 SIE ANLEGT — und das war noetig.
     *
     * Das Stub-Schema ist reine Struktur: Spalten mit Typen, ohne Default
     * und ohne `not null`. Ein `insert into favorites (user_id, sky_id)`
     * speicherte dort also `created_at = NULL`, der Verbund
     * `created_at < buyable_since` wurde NULL, und es entstand STILL keine
     * Meldung. Der erste Lauf meldete „0 Meldungen" und sah aus wie ein
     * Fehler in `0148` — er war einer im Probelauf, der eine mildere Welt
     * nachbildete als die echte. Dieselbe Lehre wie bei P54 (Entzuege) und
     * P55 (die sechs Trigger).
     *
     * Deshalb: Default UND `not null`, so wie `0145` es legt. Ein kuenftiges
     * Versaeumnis derselben Art bricht dann LAUT ab.
     */
    await db.exec(`
      alter table public.favorites alter column created_at set default now();
      update public.favorites set created_at = now() where created_at is null;
      alter table public.favorites alter column created_at set not null;
      alter table public.favorites add constraint z56_fav_pk
        primary key (user_id, sky_id);
      -- Und die drei Richtlinien aus 0145, in ihrer Form: der Preflight von
      -- 0148 prueft, dass sie dastehen, und ein Stub ohne sie ist wieder
      -- eine mildere Welt als die echte.
      --
      -- (Als SQL-Kommentar, nicht als Blockkommentar: dieser Text steht in
      -- einem Template-Literal, und ein Gravis darin wuerde es beenden.)
      alter table public.favorites enable row level security;
      create policy favorites_select_own on public.favorites
        for select to authenticated
        using ((select auth.uid()) = user_id and public.is_collector_account());
      create policy favorites_insert_own on public.favorites
        for insert to authenticated
        with check ((select auth.uid()) = user_id and public.is_collector_account());
      create policy favorites_delete_own on public.favorites
        for delete to authenticated
        using ((select auth.uid()) = user_id and public.is_collector_account());`);

    const befund: string[] = [];
    let ok = true;
    const sag = (was: string, gut: boolean, text: string): boolean => {
      befund.push(`${was}: ${gut ? text : `BEFUND ${text}`}`);
      return gut;
    };
    const wert = async (sql: string): Promise<string> =>
      String(((await db.query(sql)) as { rows: Record<string, unknown>[] })
        .rows[0]?.w ?? "?");
    const ruf = () => db.exec("select public.refresh_offer_state()");
    /** Zeit vergehen lassen — die GANZE Vorgeschichte, wie in P55. */
    const warte = async (minuten: number) => {
      await db.exec(`update public.offer_state set
          buyable_since = buyable_since - interval '${minuten} minutes',
          changed_at    = changed_at - interval '${minuten} minutes',
          checked_at    = checked_at - interval '${minuten} minutes',
          announced_at  = announced_at - interval '${minuten} minutes'`);
      await db.exec(`update public.favorites set
          created_at = created_at - interval '${minuten} minutes'`);
      await db.exec(`update public.availability_notifications set
          created_at = created_at - interval '${minuten} minutes'`);
    };
    /** Als wer? */
    const als = (uid: string | null) => db.exec(
      uid === null ? "select set_config('z56.uid', '', false)"
                   : `select set_config('z56.uid', '${uid}', false)`);
    const beansprucht = async (): Promise<string> =>
      await wert("select public.claim_availability_notifications()::text as w");
    const meldungen = (uid?: string) => wert(
      "select count(*)::text as w from public.availability_notifications"
      + (uid ? ` where user_id = '${uid}'` : ""));
    /** Eine echte Abwesenheit herstellen und danach 31 Minuten warten. */
    const neuerZyklus = async (sky: string) => {
      await db.exec(`update public.shop_inventory set is_listed = false
                      where sky_id = '${sky}'`);
      await ruf();
      await warte(25);
      await db.exec(`update public.shop_inventory set is_listed = true
                      where sky_id = '${sky}'`);
      await ruf();
      await warte(31);
    };
    const abdruck = () => wert(`select md5(
        coalesce((select string_agg(i.id::text || '|' || i.sky_id || '|'
                                    || i.is_listed::text || '|' || i.quantity::text,
                                    ';' order by i.id)
                    from public.shop_inventory i), '-')
     || coalesce((select count(*)::text from public.collection_items), '-')) as w`);

    /* ------------------------------------------------- 1. Die Migrationen */
    const l146 = await fahre(db, join(MIG_DIR, "0146_offer_state.sql"));
    ok = sag("0146", l146 === null, l146 ?? "durch");
    if (ok) await ruf();                        /* Erstbefuellung, beide gemeldet */
    const l147 = ok ? await fahre(db, join(MIG_DIR, "0147_offer_availability.sql")) : "-";
    ok = ok && sag("0147", l147 === null, l147 ?? "durch");
    await db.exec(`create or replace function public.offer_state_window()
      returns interval language sql immutable set search_path = ''
      as $w$ select interval '0' $w$;`);

    /* ---- AUFFUELLEN IST KEIN EREIGNIS — der Fall vom 2026-10-26 ----------
     *
     * DER ANLASS. Im selben Testeinkauf lagen zwei Figuren. Bei der einen
     * entstand die Lagerposition NEU (0 → 1): eine echte neue
     * Verfuegbarkeitsphase. Bei der anderen stieg nur die Menge einer
     * bestehenden, gelisteten, bepreisten Position (5 → 6) — und die war
     * schon bei der Erstbefuellung kaufbar und damit als angekuendigt
     * markiert. Der Betreiber erwartete fuer beide eine Meldung; richtig ist
     * sie nur fuer die erste.
     *
     * Diese Zeile haelt das fest: eine Mengenerhoehung an einer bereits
     * kaufbaren Figur aendert `offer_state_live` nicht (weder `buyable` noch
     * `cheapest_cents`), also bleibt `buyable_since` stehen, `announced_at`
     * bleibt stehen, und es wird nichts faellig. „Wieder verfuegbar" setzt
     * voraus, dass sie weg war.
     */
    if (ok) {
      const stand = () => wert(`select buyable::text || '|' || buyable_since::text
          || '|' || coalesce(announced_at::text, '-') as w
        from public.offer_state where sky_id = 'SKY-7002'`);
      const vorher = await stand();
      await db.exec(`update public.shop_inventory set quantity = quantity + 5
                      where sky_id = 'SKY-7002'`);
      await ruf();
      const nachher = await stand();
      ok = sag("Auffuellen einer kaufbaren Figur erzeugt keine neue Phase",
        nachher === vorher && vorher.startsWith("true|"),
        nachher === vorher ? `buyable|buyable_since|announced_at unveraendert`
          : `${vorher} → ${nachher}`);
    }

    /* Der Preflight, als Eigner, VOR 0148 — mit seinen echten Erwartungen. */
    if (ok) {
      const anw = anweisungen(readFileSync(
        join(CHECK_DIR, "0148_preflight.sql"), "utf8")).filter((x) => planbar(x));
      const r = (await db.query(`select nr, befund, erwartet from (${ohneKopf(anw[0])}) x
                                  where ok is false and nr < 800`)) as
        { rows: { nr: number; befund: string; erwartet: string }[] };
      ok = sag("Preflight 0148 als Eigner", r.rows.length === 0,
        r.rows.length === 0 ? "jede Zeile mit Erwartung stimmt"
          : r.rows.map((z) => `${z.nr} ${JSON.stringify(z.befund)} statt `
              + `${JSON.stringify(z.erwartet)}`).join(" | "));
    }

    const vorMigration = ok ? await abdruck() : "-";
    const l148 = ok ? await fahre(db, join(MIG_DIR, "0148_availability_notifications.sql"))
                    : "-";
    ok = ok && sag("0148", l148 === null, l148 ?? "durch");
    if (ok) {
      ok = sag("Migration ruehrt Lager und Sammlung nicht an",
        await abdruck() === vorMigration, "Abdruck unveraendert");
    }

    /* Die Nachkontrolle, als Eigner, direkt nach 0148. */
    if (ok) {
      const anw = anweisungen(readFileSync(
        join(CHECK_DIR, "0148_postflight.sql"), "utf8")).filter((x) => planbar(x));
      const r = (await db.query(`select nr, befund, erwartet from (${ohneKopf(anw[0])}) x
                                  where ok is false and nr < 800`)) as
        { rows: { nr: number; befund: string; erwartet: string }[] };
      ok = sag("Nachkontrolle 0148 als Eigner", r.rows.length === 0,
        r.rows.length === 0 ? "jede Zeile mit Erwartung stimmt"
          : r.rows.map((z) => `${z.nr} ${JSON.stringify(z.befund)} statt `
              + `${JSON.stringify(z.erwartet)}`).join(" | "));
    }

    /* -------- 2. ZWEI NUTZER VOR DER PHASE, EINER DANACH ---------------- */
    if (ok) {
      /* A und B merken JETZT vor — bevor die neue Phase beginnt. */
      await db.exec(`insert into public.favorites (user_id, sky_id)
                     values ('${A}', 'SKY-7001'), ('${B}', 'SKY-7001')`);
      await neuerZyklus("SKY-7001");
      /* C merkt ERST JETZT vor — nach dem Beginn der Phase. */
      await db.exec(`insert into public.favorites (user_id, sky_id)
                     values ('${C}', 'SKY-7001')`);

      await als(A);
      const faellig = await wert(
        "select coalesce(string_agg(sky_id, ',' order by sky_id), '(keine)') as w "
        + "from public.offer_availability_due()");
      /* Drei Favoriten, zwei davor — als Zahl, nicht als Zeitstempelwand. */
      const davor = await wert(`select count(*)::text as w
        from public.favorites v join public.offer_state s on s.sky_id = v.sky_id
       where v.sky_id = 'SKY-7001' and v.created_at < s.buyable_since`);
      const fuerA = await beansprucht();
      const gesamt = await meldungen();
      const cHat = await meldungen(C);
      ok = sag("zwei vor der Phase, einer danach",
        faellig === "SKY-7001" && davor === "2"
        && fuerA === "1" && gesamt === "2" && cHat === "0",
        `faellig ${faellig}, ${davor} von 3 Favoriten vor der Phase, `
        + `Rueckgabe fuer A ${fuerA}, gesamt ${gesamt}, C hat ${cHat}`);
    }

    /* ------------------- 3. WIEDERHOLTE UND „PARALLELE" AUFRUFE --------- */
    if (ok) {
      /*
       * ECHTE GLEICHZEITIGKEIT ist in PGlite nicht fahrbar (eine
       * Verbindung). Was hier laeuft, ist die Lage NACH dem Warten auf die
       * Zeilensperre: der zweite Aufruf prueft sein `where` gegen die neue
       * Zeile. Genau das tut PostgreSQL unter READ COMMITTED.
       */
      const zweiter = await beansprucht();
      await als(B);
      const dritter = await beansprucht();
      const gesamt = await meldungen();
      ok = sag("wiederholte Aufrufe", zweiter === "0" && dritter === "0" && gesamt === "2",
        `zweiter ${zweiter}, dritter (als B) ${dritter}, Meldungen gesamt ${gesamt}`);
    }

    /* --------------------- 4. PREISAENDERUNG ALLEIN --------------------- */
    if (ok) {
      await db.exec("update public.shop_inventory set sale_price = 12.00 "
        + "where sky_id = 'SKY-7001'");
      await ruf();
      await warte(31);
      const nach = await beansprucht();
      ok = sag("Preisaenderung allein", nach === "0" && await meldungen() === "2",
        `beansprucht ${nach}, Meldungen ${await meldungen()}`);
      await db.exec("update public.shop_inventory set sale_price = null "
        + "where sky_id = 'SKY-7001'");
      await ruf();
    }

    /* ------------------- 5. KURZE WARENKORBRESERVIERUNG ----------------- */
    if (ok) {
      await db.exec("update public.shop_inventory set reserved = 2 "
        + "where sky_id = 'SKY-7001'");
      await ruf();
      await warte(2);                       /* kuerzer als reservation_ttl() */
      await db.exec("update public.shop_inventory set reserved = 0 "
        + "where sky_id = 'SKY-7001'");
      await ruf();
      await warte(31);
      const nach = await beansprucht();
      ok = sag("kurze Reservierung", nach === "0" && await meldungen() === "2",
        `beansprucht ${nach}, Meldungen ${await meldungen()}`);
    }

    /* ----------------------- 6. ECHTER ZWEITER ZYKLUS ------------------- */
    if (ok) {
      await neuerZyklus("SKY-7001");
      await als(A);
      const fuerA = await beansprucht();
      const gesamt = await meldungen();
      const aHat = await meldungen(A);
      const cHat = await meldungen(C);
      ok = sag("zweiter echter Zyklus",
        fuerA === "1" && gesamt === "5" && aHat === "2" && cHat === "1",
        `Rueckgabe fuer A ${fuerA}, gesamt ${gesamt} (erwartet 5: A,B je 2 und C 1), `
        + `A hat ${aHat}, C hat ${cHat}`);
    }

    /* --------------- 7. DIE VARIANTE BLEIBT UNBERUEHRT ------------------ */
    if (ok) {
      const fuerVariante = await wert(
        "select count(*)::text as w from public.availability_notifications "
        + "where sky_id = 'SKY-7002'");
      ok = sag("nur die exakte SKY-ID", fuerVariante === "0",
        `Meldungen fuer SKY-7002: ${fuerVariante}`);
    }

    /* ----------------------- 8. RLS: NUR DAS EIGENE --------------------- */
    if (ok) {
      /*
       * ALS `authenticated`, UND NICHT ALS EIGENE ROLLE.
       *
       * Die Richtlinie lautet `for select to authenticated`. Ein erster
       * Entwurf legte eine Rolle `z56_leser` an und sah 0 Zeilen — RICHTIG,
       * denn fuer eine Rolle ohne passende Richtlinie verweigert RLS alles.
       * Der Test war falsch gebaut, nicht die Richtlinie. Gelesen wird
       * deshalb als `authenticated`, so wie es die Anwendung tut, und die
       * Identitaet kommt aus `auth.uid()`.
       */
      await db.exec("grant usage on schema auth to authenticated;");
      const alsLeser = async (uid: string | null): Promise<string> => {
        await db.exec("begin;");
        try {
          await db.exec(uid === null
            ? "select set_config('z56.uid', '', true)"
            : `select set_config('z56.uid', '${uid}', true)`);
          await db.exec("set local role authenticated;");
          const r = (await db.query(
            "select count(*)::text as w from public.availability_notifications")) as
            { rows: { w: string }[] };
          return String(r.rows[0]?.w);
        } finally { await db.exec("rollback;"); }
      };
      const sichtA = await alsLeser(A);
      const sichtC = await alsLeser(C);
      const sichtOhne = await alsLeser(null);
      ok = sag("RLS: nur das Eigene",
        sichtA === "2" && sichtC === "1" && sichtOhne === "0",
        `A sieht ${sichtA}, C sieht ${sichtC}, ohne Anmeldung ${sichtOhne}`);
    }

    /* --------- 9. JEDE BEANSPRUCHTE ZEILE HAT IHRE MELDUNGEN ------------ */
    if (ok) {
      /*
       * DIE ATOMARITAET, als Zustandspruefung: es darf keine Phase geben,
       * die als gemeldet gilt, obwohl fuer einen berechtigten Favoriten
       * keine Meldung existiert.
       */
      const luecken = await wert(`select count(*)::text as w
        from public.offer_state s
        join public.favorites v on v.sky_id = s.sky_id
       where s.announced_at is not null
         and s.buyable_since is not null
         and v.created_at < s.buyable_since
         and not exists (select 1 from public.availability_notifications n
                          where n.user_id = v.user_id and n.sky_id = s.sky_id
                            and n.buyable_since = s.buyable_since)`);
      ok = sag("keine beanspruchte Phase ohne Meldung", luecken === "0",
        `Luecken: ${luecken}`);
    }

    /* =====================================================================
     * P57 — `0149`: GELESEN ODER NICHT.
     *
     * Dieselbe Welt, dieselbe PGlite-Instanz: hier liegen jetzt Meldungen
     * von drei Nutzern, erzeugt von `0148` und nicht gestellt. Genau daran
     * laesst sich pruefen, was `0149` zusagt — und die wichtigste Zusage ist
     * eine NEGATIVE: lesen markiert nicht.
     * ================================================================== */
    const befund49: string[] = [];
    let ok49 = ok;
    const sag49 = (was: string, gut: boolean, text: string): boolean => {
      befund49.push(`${was}: ${gut ? text : `BEFUND ${text}`}`);
      return gut;
    };
    const ungelesen = (uid?: string) => wert(
      "select count(*)::text as w from public.availability_notifications"
      + " where read_at is null" + (uid ? ` and user_id = '${uid}'` : ""));
    const markiere = async (skyIds: string[] | null): Promise<string> => wert(
      "select public.mark_availability_notifications_read("
      /* `::text[]` ausgeschrieben: `array[]` ohne Typ ist in PostgreSQL ein
         Fehler („cannot determine type of empty array"), und genau die leere
         Liste ist einer der Faelle, die hier geprueft werden. */
      + (skyIds === null
          ? "null"
          : `array[${skyIds.map((x) => `'${x}'`).join(",")}]::text[]`)
      + ")::text as w");

    /* --------------- 1. Der Preflight als Eigner, VOR 0149 -------------- */
    if (ok49) {
      const anw = anweisungen(readFileSync(
        join(CHECK_DIR, "0149_preflight.sql"), "utf8")).filter((x) => planbar(x));
      const r = (await db.query(`select nr, befund, erwartet from (${ohneKopf(anw[0])}) x
                                  where ok is false and nr < 800`)) as
        { rows: { nr: number; befund: string; erwartet: string }[] };
      ok49 = sag49("Preflight 0149 als Eigner", r.rows.length === 0,
        r.rows.length === 0 ? "jede Zeile mit Erwartung stimmt"
          : r.rows.map((z) => `${z.nr} ${JSON.stringify(z.befund)} statt `
              + `${JSON.stringify(z.erwartet)}`).join(" | "));
    }

    /* -------------------------- 2. Die Migration ------------------------ */
    const vor49 = ok49 ? await abdruck() : "-";
    const meldungenVor = ok49 ? await meldungen() : "-";
    const l149 = ok49 ? await fahre(db, join(MIG_DIR, "0149_notification_read_state.sql"))
                      : "-";
    ok49 = ok49 && sag49("0149", l149 === null, l149 ?? "durch");
    if (ok49) {
      ok49 = sag49("Migration ruehrt Lager und Sammlung nicht an",
        await abdruck() === vor49, "Abdruck unveraendert");
    }

    /* ------- 3. KEINE ZEILE WURDE ALS GELESEN ERFUNDEN ------------------ */
    if (ok49) {
      /*
       * DIE ZEILE, AUF DIE ES ANKOMMT. Ein Vorgabewert `now()` oder ein
       * Backfill haetten alle bestehenden Meldungen auf einen Schlag als
       * gelesen gefuehrt — eine Lesehandlung, die nicht stattgefunden hat.
       */
      const alle = await meldungen();
      const neu = await ungelesen();
      ok49 = sag49("bestehende Meldungen gelten alle als ungelesen",
        alle === meldungenVor && neu === alle,
        `${alle} Meldungen, davon ${neu} ungelesen (vorher ${meldungenVor})`);
    }

    /* ------------- 4. Die Nachkontrolle als Eigner ---------------------- */
    if (ok49) {
      const anw = anweisungen(readFileSync(
        join(CHECK_DIR, "0149_postflight.sql"), "utf8")).filter((x) => planbar(x));
      const r = (await db.query(`select nr, befund, erwartet from (${ohneKopf(anw[0])}) x
                                  where ok is false and nr < 800`)) as
        { rows: { nr: number; befund: string; erwartet: string }[] };
      ok49 = sag49("Nachkontrolle 0149 als Eigner", r.rows.length === 0,
        r.rows.length === 0 ? "jede Zeile mit Erwartung stimmt"
          : r.rows.map((z) => `${z.nr} ${JSON.stringify(z.befund)} statt `
              + `${JSON.stringify(z.erwartet)}`).join(" | "));
    }

    /* ---------- 5. LESEN MARKIERT NICHT — die Zusage, gemessen --------- */
    if (ok49) {
      /*
       * Die Anzeige liest mit einem `select` unter RLS. Dass ein solcher
       * Lesevorgang `read_at` nicht setzt, ist in PostgreSQL selbstredend —
       * geprueft wird es trotzdem, weil die Zusage genau hier haengt und ein
       * kuenftiger Trigger sie unbemerkt brechen koennte.
       */
      await als(A);
      for (let i = 0; i < 3; i += 1) {
        await db.exec("begin;");
        try {
          await db.exec("set local role authenticated;");
          await db.query("select * from public.availability_notifications");
        } finally { await db.exec("rollback;"); }
      }
      const nach = await ungelesen();
      const alle = await meldungen();
      ok49 = sag49("dreimal gelesen, nichts markiert", nach === alle,
        `${nach} von ${alle} weiter ungelesen`);
    }

    /* ------------------ 6. NUR DIE GENANNTE FIGUR ---------------------- */
    if (ok49) {
      /*
       * EINE SKY-ID MARKIERT ALLE UNGELESENEN MELDUNGEN ZU DIESER FIGUR —
       * und das ist Absicht, nicht Zufall: nach einem zweiten echten Zyklus
       * koennen zu derselben Figur zwei Meldungen liegen (zwei Phasen), und
       * „ich habe gesehen, dass sie wieder da ist" gilt dann fuer beide.
       * Die Karte zeigt sie uebereinander; ein Klick, der nur eine davon
       * still macht, waere nicht erklaerbar.
       *
       * Zuerst die Gegenprobe mit einer Figur OHNE Meldung: markiert sie
       * etwas, trifft das Argument nicht.
       */
      await als(A);
      const fremd = await markiere(["SKY-7002"]);
      const eigen7001 = await wert(`select count(*)::text as w
        from public.availability_notifications
       where user_id = '${A}' and sky_id = 'SKY-7001' and read_at is null`);
      const n = await markiere(["SKY-7001"]);
      const rest = await wert(`select count(*)::text as w
        from public.availability_notifications
       where user_id = '${A}' and sky_id = 'SKY-7001' and read_at is null`);
      ok49 = sag49("nur die genannte Figur",
        fremd === "0" && n === eigen7001 && Number(n) >= 1 && rest === "0",
        `SKY-7002 ohne Meldung: ${fremd} markiert · SKY-7001: ${n} von `
        + `${eigen7001} markiert, ${rest} ungelesen`);
    }

    /* ------- 7. NOCHMAL DIESELBE: KEIN VERSCHIEBEN DES ZEITPUNKTS ------ */
    if (ok49) {
      /*
       * `read_at is null` im `where` ist kein Schmuck: ohne sie wuerde ein
       * zweiter Klick den Lesezeitpunkt nach vorn schieben, und „seit wann
       * gesehen" waere nicht mehr beantwortbar.
       */
      const vorher = await wert(`select read_at::text as w
        from public.availability_notifications
       where user_id = '${A}' and sky_id = 'SKY-7001'`);
      const n = await markiere(["SKY-7001"]);
      const nachher = await wert(`select read_at::text as w
        from public.availability_notifications
       where user_id = '${A}' and sky_id = 'SKY-7001'`);
      ok49 = sag49("zweiter Aufruf markiert nichts und verschiebt nichts",
        n === "0" && nachher === vorher, `${n} markiert, read_at unveraendert`);
    }

    /* --------- 8. FREMDE ZEILEN BLEIBEN UNBERUEHRT --------------------- */
    if (ok49) {
      /*
       * DIE GEGENPROBE ZUR GRENZE. `A` markiert alles, was `A` markieren
       * darf — und `C` hat danach genauso viele ungelesene wie vorher. Das
       * `where` der Definer-Funktion IST die Grenze; faellt es weg, schlaegt
       * genau diese Zeile an.
       */
      const cVorher = await ungelesen(C);
      await als(A);
      await markiere(null);
      const aNachher = await ungelesen(A);
      const cNachher = await ungelesen(C);
      ok49 = sag49("alles markieren trifft nur das Eigene",
        aNachher === "0" && cNachher === cVorher,
        `A ${aNachher} ungelesen, C unveraendert ${cNachher}`);
    }

    /* ------- 9. OHNE ANMELDUNG MARKIERT NIEMAND ----------------------- */
    if (ok49) {
      const cVorher = await ungelesen(C);
      await als(null);
      const n = await markiere(null);
      const cNachher = await ungelesen(C);
      await als(C);
      ok49 = sag49("ohne Anmeldung markiert niemand",
        n === "0" && cNachher === cVorher, `${n} markiert, C unveraendert`);
    }

    /* --------- 10. EINE LEERE LISTE MARKIERT NICHTS ------------------- */
    if (ok49) {
      /*
       * `null` heisst „alle", eine LEERE Liste heisst „keine". Waeren beide
       * gleich, wuerde aus „markiere diese null Karten" stillschweigend
       * „markiere alles" — in der Datenbank, nicht nur in der Oberflaeche.
       */
      await als(C);
      const vorher = await ungelesen(C);
      const n = await markiere([]);
      const nachher = await ungelesen(C);
      ok49 = sag49("leere Liste markiert nichts", n === "0" && nachher === vorher,
        `${n} markiert, ${nachher} weiter ungelesen`);
    }

    /* ----- 11. EINE NEUE MELDUNG ENTSTEHT UNGELESEN ------------------- */
    if (ok49) {
      /*
       * Nach einem echten neuen Zyklus entsteht eine Meldung mit neuer
       * Phasengrenze. Sie muss ungelesen sein — auch fuer einen Nutzer, der
       * die vorige Meldung zu derselben Figur schon als gesehen markiert hat.
       */
      await als(A);
      await neuerZyklus("SKY-7001");
      const entstanden = await beansprucht();
      const neu = await wert(`select count(*)::text as w
        from public.availability_notifications
       where sky_id = 'SKY-7001' and read_at is null`);
      ok49 = sag49("ein neuer Zyklus erzeugt eine UNGELESENE Meldung",
        Number(entstanden) >= 1 && Number(neu) >= 1,
        `${entstanden} fuer den Aufrufer, ${neu} ungelesen zu SKY-7001`);
    }

    /* ----- 12. DER ZAEHLER SIEHT NUR DAS EIGENE ----------------------- */
    if (ok49) {
      /*
       * Die Marke zaehlt mit `count(*) … where read_at is null` UNTER RLS.
       * Geprueft wird hier, dass die Rolle `authenticated` dabei genau die
       * eigenen Zeilen zaehlt — dieselbe Form wie in Schritt 8 von P56,
       * jetzt mit dem Lesezustand.
       */
      const zaehleAls = async (uid: string | null): Promise<string> => {
        await db.exec("begin;");
        try {
          await db.exec(uid === null
            ? "select set_config('z56.uid', '', true)"
            : `select set_config('z56.uid', '${uid}', true)`);
          await db.exec("set local role authenticated;");
          const r = (await db.query("select count(*)::text as w"
            + " from public.availability_notifications where read_at is null")) as
            { rows: { w: string }[] };
          return String(r.rows[0]?.w);
        } finally { await db.exec("rollback;"); }
      };
      const eigenA = await ungelesen(A);
      const sichtA = await zaehleAls(A);
      const sichtOhne = await zaehleAls(null);
      ok49 = sag49("der Zaehler zaehlt nur das Eigene",
        sichtA === eigenA && sichtOhne === "0",
        `A zaehlt ${sichtA} (eigene ${eigenA}), ohne Anmeldung ${sichtOhne}`);
    }

    /* ----------------- 13. RUECKNAHME VON 0149 ----------------------- */
    if (ok49) {
      const gelesenVorher = await wert(`select count(*)::text as w
        from public.availability_notifications where read_at is not null`);
      const r = await fahre(db, "supabase/rollback/R0149_notification_read_state.sql");
      const fort = r === null ? await wert(
        "select ((to_regprocedure('public.mark_availability_notifications_read(text[])')"
        + "        is null)"
        + " and (to_regclass('public.availability_notifications_unread_idx') is null)"
        + " and not exists (select 1 from pg_attribute a"
        + "                  where a.attrelid = to_regclass("
        + "                          'public.availability_notifications')"
        + "                    and a.attname = 'read_at' and a.attnum > 0"
        + "                    and not a.attisdropped))::text as w") : "-";
      /* Die Meldungen selbst bleiben liegen — R0149 nimmt 0149 zurueck, nicht 0148. */
      const bleiben = r === null ? await meldungen() : "-";
      ok49 = sag49("Ruecknahme 0149", r === null && fort === "true" && bleiben !== "0",
        `${r ?? "durch"}, fort ${fort}, ${bleiben} Meldungen bleiben `
        + `(${gelesenVorher} waren gelesen und gelten wieder als neu)`);
    }

    probe.push({
      name: "P57 0149 trennt gelesen von ungelesen: die Migration erfindet keine Lesehandlung, "
        + "dreimal lesen markiert nichts, ein zweiter Klick verschiebt den Zeitpunkt nicht, "
        + "eine leere Liste markiert nichts statt alles, fremde Zeilen bleiben unberuehrt",
      ok: ok49,
      sagt: `0149: ${befund49.join(" · ")}`,
    });

    /* ------------------------- 10. RUECKNAHME ---------------------------- */
    if (ok) {
      const r = await fahre(db, "supabase/rollback/R0148_availability_notifications.sql");
      const fort = r === null ? await wert(
        "select ((to_regclass('public.availability_notifications') is null)"
        + " and (to_regprocedure('public.claim_availability_notifications()')"
        + "      is null))::text as w") : "-";
      ok = sag("Ruecknahme", r === null && fort === "true", `${r ?? "durch"}, fort ${fort}`);
    }

    probe.push({
      name: "P56 0148 macht aus einem Ereignis persoenliche Meldungen: zwei Nutzer vor der "
        + "Phase und einer danach, keine Duplikate bei wiederholten Aufrufen, Preis und "
        + "Reservierung erzeugen nichts, zweiter Zyklus erzeugt neue, RLS zeigt nur Eigenes",
      ok,
      sagt: `0148: ${befund.join(" · ")}`,
    });
  }

  /* =====================================================================
   * P58 — `0150`: FIRE AND FORGET, OHNE SPIEGELZUSTAND.
   *
   * WAS DIESE WELT ABSICHTLICH NICHT ENTHAELT: `favorites`, `offer_state`,
   * `availability_notifications` und die vier Spiegelfunktionen. Sie werden
   * aus dem Stub-Schema GELOESCHT, bevor `0150` laeuft — und genau das ist
   * der Beweis fuer die Unabhaengigkeit, um die der Auftrag gebeten hat
   * (Punkt 4): die Migration muss in einer Welt laufen, in der die alte
   * Bauform nie existiert hat. So sieht Production aus.
   *
   * Stehen bleibt genau eines: die SICHT `offer_state_live`, angelegt wie
   * `0146` sie anlegt. Sie ist die einzige Definition von „jetzt kaufbar".
   *
   * WAS DAFUER GESTELLT WIRD, sichtbar und begrenzt: `auth.uid()` liest eine
   * Sitzungsvariable, damit zwei Nutzer pruefbar sind, und
   * `is_collector_account()` gibt `true`. Geprueft wird `0150`, nicht die
   * Rollenlogik — dass die Richtlinie ueberhaupt fragt, messen die
   * Nachkontrolle (113) und die Migration selbst.
   *
   * KEINE ZEITREISE. Es gibt keine Karenzzeit mehr, also auch nichts
   * vorzuspulen — das ist der sichtbarste Unterschied zu P55 und P56.
   * ================================================================== */
  {
    const A = "aaaaaaaa-0000-0000-0000-000000000011";
    const B = "bbbbbbbb-0000-0000-0000-000000000012";

    const db = await frisch();

    /* 0150 kommt aus dem Stub-Schema wieder heraus — die Reihenfolge ist
       Teil dessen, was geprueft wird. */
    await db.exec("drop function if exists public.acknowledge_availability_alerts(bigint[]);");
    await db.exec("drop function if exists public.fire_availability_alerts();");
    await db.exec("drop function if exists public.unwatch_availability(text);");
    await db.exec("drop function if exists public.watch_availability(text);");
    await db.exec("drop table if exists public.availability_alerts cascade;");

    /* UND DIE GANZE ALTE BAUFORM. Nicht um sie zu pruefen, sondern um sie
       ABWESEND zu haben: was `0150` nicht braucht, darf hier nicht stehen. */
    await db.exec("drop function if exists public.mark_availability_notifications_read(text[]);");
    await db.exec("drop function if exists public.claim_availability_notifications();");
    await db.exec("drop table if exists public.availability_notifications cascade;");
    await db.exec("drop function if exists public.offer_availability_due();");
    await db.exec("drop function if exists public.offer_availability_grace();");
    await db.exec("drop function if exists public.refresh_offer_state();");
    await db.exec("drop function if exists public.offer_state_window();");
    await db.exec("drop table if exists public.offer_state cascade;");
    await db.exec("drop function if exists public.favorite_demand(text[]);");
    await db.exec("drop table if exists public.favorites cascade;");
    await db.exec("drop view if exists public.offer_state_live;");

    await attrappenFuerBaseline(db);

    await db.exec(`
      create schema if not exists auth;
      create table if not exists auth.users (id uuid primary key);
      insert into auth.users (id) values ('${A}'), ('${B}')
        on conflict do nothing;
      create or replace function auth.uid() returns uuid
        language sql stable
        as $u$ select nullif(current_setting('z58.uid', true), '')::uuid $u$;
      create or replace function public.is_collector_account() returns boolean
        language sql stable as $k$ select true $k$;
      alter table public.skylanders add constraint z58_sky_pk primary key (sky_id);
      insert into public.skylanders (sky_id, name, slug, market_price)
      values ('SKY-7101', 'Probe Glocke', 'probe-glocke-58', 20.00),
             ('SKY-7102', 'Probe Zweite', 'probe-zweite-58', 30.00)
        on conflict do nothing;
      insert into public.shop_settings (id, price_percentage)
      values (true, 100) on conflict do nothing;
      alter table public.shop_inventory drop column if exists available_quantity;
      alter table public.shop_inventory
        add column available_quantity integer
        generated always as (quantity - reserved) stored;
      create sequence if not exists public.z58_inv_seq start 1;
      alter table public.shop_inventory alter column id set default nextval('public.z58_inv_seq');
      drop function if exists public.shop_offers();
      create function public.shop_offers()
      returns table (sky_id text, condition text, price numeric,
                     available boolean, delivery_scope text)
      language sql stable as $p58$
        select i.sky_id, i.condition,
               public.shop_price(i.sale_price, s.market_price, st.price_percentage),
               (i.available_quantity > 0), null::text
          from public.shop_inventory i
          join public.skylanders s on s.sky_id = i.sky_id
          cross join public.shop_settings st
         where i.is_listed
           and i.condition = public.v1_sale_condition()
           and public.shop_price(i.sale_price, s.market_price, st.price_percentage)
               is not null;
      $p58$;
      -- Die Sicht legt 0151 an — siehe Schritt 0 unten. Hier NICHT.
      -- SKY-7101 ist NICHT kaufbar (kein Bestand), SKY-7102 ist es.
      insert into public.shop_inventory (sky_id, condition, quantity, reserved, is_listed)
      values ('SKY-7101', 'loose', 0, 0, true),
             ('SKY-7102', 'loose', 1, 0, true);
      grant usage on schema auth to authenticated;`);

    const befund58: string[] = [];
    let ok58 = true;
    const sag58 = (was: string, gut: boolean, text: string): boolean => {
      befund58.push(`${was}: ${gut ? text : `BEFUND ${text}`}`);
      return gut;
    };
    const w58 = async (sql: string): Promise<string> =>
      String(((await db.query(sql)) as { rows: Record<string, unknown>[] })
        .rows[0]?.w ?? "?");
    /** Eine Funktion als ein bestimmtes Konto rufen. */
    const als = async (uid: string | null, sql: string): Promise<string> => {
      await db.exec("begin;");
      try {
        await db.exec(uid === null
          ? "select set_config('z58.uid', '', true)"
          : `select set_config('z58.uid', '${uid}', true)`);
        const r = (await db.query(sql)) as { rows: { w: string }[] };
        await db.exec("commit;");
        return String(r.rows[0]?.w);
      } catch (e) {
        await db.exec("rollback;");
        const err = e as { message?: string; code?: string };
        return `[${err.code ?? "?"}] ${(err.message ?? "").split("\n")[0]}`;
      }
    };
    const merke = (uid: string, sky: string) =>
      als(uid, `select public.watch_availability('${sky}')::text as w`);
    const feuere = (uid: string | null) =>
      als(uid, "select public.fire_availability_alerts()::text as w");
    const alarme = () => w58("select count(*)::text as w from public.availability_alerts");
    const gemeldet = () => w58(
      "select count(*)::text as w from public.availability_alerts"
      + " where notified_at is not null");
    const offenFuer = (uid: string) => w58(
      `select count(*)::text as w from public.availability_alerts`
      + ` where user_id = '${uid}' and read_at is null`);
    /* Lager und Sammlung in einer Zahl — derselbe Abdruck wie in P56/P57. */
    const abdruck58 = () => w58(`select md5(
        coalesce((select string_agg(i.id::text || '|' || i.sky_id || '|'
                                    || i.is_listed::text || '|' || i.quantity::text,
                                    ';' order by i.id)
                    from public.shop_inventory i), '-')
     || coalesce((select count(*)::text from public.collection_items), '-')) as w`);

    /* ------- 0. DIE ECHTE REIHENFOLGE: 0151 LEGT DIE SICHT AN ---------- */
    /*
     * Bis zur Entscheidung E-1/B2 stellte dieser Probelauf die Sicht selbst
     * her — eine mildere Welt als die echte, denn dort legt sie eine
     * MIGRATION an. Jetzt laeuft `0151` zuerst, so wie es auf Production
     * laufen wird: die Sicht fehlt, `0151` erzeugt sie, und erst danach
     * beginnt `0150`. Damit faehrt P58 die Abhaengigkeit `0151 → 0150` nach
     * und behauptet sie nicht.
     */
    if (ok58) {
      const vorhanden = await w58(
        "select (to_regclass('public.offer_state_live') is not null)::text as w");
      const l151 = await fahre(db, join(MIG_DIR, "0151_offer_state_live.sql"));
      const danach = await w58(
        "select (to_regclass('public.offer_state_live') is not null)::text as w");
      ok58 = sag58("0151 legt die Sicht an, dann 0150",
        vorhanden === "false" && l151 === null && danach === "true",
        `vorher ${vorhanden} · 0151: ${l151 ?? "durch"} · nachher ${danach}`);
    }

    /* --------------- 1. Der Preflight als Eigner, VOR 0150 -------------- */
    if (ok58) {
      const anw = anweisungen(readFileSync(
        join(CHECK_DIR, "0150_preflight.sql"), "utf8")).filter((x) => planbar(x));
      const r = (await db.query(`select nr, befund, erwartet from (${ohneKopf(anw[0])}) x
                                  where ok is false and nr < 800`)) as
        { rows: { nr: number; befund: string; erwartet: string }[] };
      ok58 = sag58("Preflight 0150 als Eigner", r.rows.length === 0,
        r.rows.length === 0 ? "jede Zeile mit Erwartung stimmt"
          : r.rows.map((z) => `${z.nr} ${JSON.stringify(z.befund)} statt `
              + `${JSON.stringify(z.erwartet)}`).join(" | "));
    }

    /* ---- 2. DIE MIGRATION, in einer Welt OHNE die alte Bauform -------- */
    const vor58 = ok58 ? await abdruck58() : "-";
    const l150 = ok58 ? await fahre(db, join(MIG_DIR, "0150_availability_alerts.sql"))
                      : "-";
    ok58 = ok58 && sag58("0150 laeuft OHNE favorites, offer_state und "
      + "availability_notifications", l150 === null, l150 ?? "durch");
    if (ok58) {
      ok58 = sag58("Migration ruehrt Lager und Sammlung nicht an",
        await abdruck58() === vor58, "Abdruck unveraendert");
      ok58 = ok58 && sag58("die alte Bauform ist und bleibt abwesend",
        await w58("select ((to_regclass('public.favorites') is null)"
          + " and (to_regclass('public.offer_state') is null)"
          + " and (to_regclass('public.availability_notifications') is null))::text as w")
          === "true", "keine der drei steht");
    }

    /* ------------- 3. Die Nachkontrolle als Eigner, NACH 0150 ---------- */
    if (ok58) {
      const anw = anweisungen(readFileSync(
        join(CHECK_DIR, "0150_postflight.sql"), "utf8")).filter((x) => planbar(x));
      const r = (await db.query(`select nr, befund, erwartet from (${ohneKopf(anw[0])}) x
                                  where ok is false and nr < 800`)) as
        { rows: { nr: number; befund: string; erwartet: string }[] };
      ok58 = sag58("Nachkontrolle 0150 als Eigner", r.rows.length === 0,
        r.rows.length === 0 ? "jede Zeile mit Erwartung stimmt"
          : r.rows.map((z) => `${z.nr} ${JSON.stringify(z.befund)} statt `
              + `${JSON.stringify(z.erwartet)}`).join(" | "));
    }

    /* ------------- 4. Ein zweiter Lauf prallt ab ----------------------- */
    if (ok58) {
      const r = await fahre(db, join(MIG_DIR, "0150_availability_alerts.sql"));
      ok58 = sag58("zweiter Lauf", r !== null && r.includes("steht schon"),
        r ?? "lief durch (muss abbrechen)");
    }

    /* ------------- 5. SCHARF STELLEN: die drei Antworten --------------- */
    if (ok58) {
      const a1 = await merke(A, "SKY-7101");
      const a2 = await merke(A, "SKY-7101");
      const a3 = await merke(A, "SKY-7102");
      const n = await alarme();
      ok58 = sag58("drei Antworten", a1 === "armed" && a2 === "already_open"
        && a3 === "buyable" && n === "1",
        `nicht kaufbar: ${a1} · nochmal: ${a2} · kaufbar: ${a3} · Zeilen: ${n}`);
    }

    /* ------------- 6. Zwei Konten, dieselbe Figur ---------------------- */
    if (ok58) {
      const b1 = await merke(B, "SKY-7101");
      const n = await alarme();
      ok58 = sag58("der Teilindex gilt JE KONTO", b1 === "armed" && n === "2",
        `B: ${b1} · Zeilen: ${n}`);
    }

    /* ------------- 7. Ohne Anmeldung geht nichts ----------------------- */
    if (ok58) {
      const r = await als(null,
        "select public.watch_availability('SKY-7101')::text as w");
      ok58 = sag58("ohne Anmeldung scharf stellen",
        r.includes("insufficient_privilege") || r.includes("[42501]"), r);
    }

    /* ------------- 8. DER ABGLEICH: ein Ereignis, eine Meldung --------- */
    if (ok58) {
      /* Bestand kommt an — SKY-7101 wird kaufbar. Mehr passiert nicht. */
      await db.exec("update public.shop_inventory set quantity = 3 "
        + "where sky_id = 'SKY-7101';");
      const live = await w58("select coalesce(min(cheapest_cents)::text, '(keine)') as w"
        + " from public.offer_state_live where sky_id = 'SKY-7101'");
      const fuerA = await feuere(A);
      const g = await gemeldet();
      const cents = await w58("select string_agg(distinct notified_cents::text, ',') as w"
        + " from public.availability_alerts where notified_at is not null");
      ok58 = sag58("Auslösung ohne Karenzzeit",
        live === "2000" && fuerA === "1" && g === "2" && cents === "2000",
        `live ${live} Cent · Rueckgabe fuer A ${fuerA} (nur das Eigene) · `
        + `gemeldet ${g} · Preis ${cents}`);
    }

    /* ------------- 9. EIN ZWEITER LAUF MELDET NICHTS NEU --------------- */
    if (ok58) {
      const stand = await w58("select md5(string_agg(id::text || '|' "
        + "|| notified_at::text, ',' order by id)) as w "
        + "from public.availability_alerts");
      const z1 = await feuere(A);
      const z2 = await feuere(B);
      const z3 = await feuere(null);
      const danach = await w58("select md5(string_agg(id::text || '|' "
        + "|| notified_at::text, ',' order by id)) as w "
        + "from public.availability_alerts");
      ok58 = sag58("dreimal nachgefeuert", z1 === "0" && z2 === "0" && z3 === "0"
        && stand === danach,
        `${z1}/${z2}/${z3} Meldungen, notified_at unveraendert ${stand === danach}`);
    }

    /* ------------- 10. OHNE NUTZERKONTEXT (der spaetere Scheduler) ----- */
    if (ok58) {
      /* Ein frischer Alarm von B auf die zweite Figur, die gerade nicht
         kaufbar ist — dann Bestand, dann feuern OHNE Anmeldung. */
      await db.exec("update public.shop_inventory set quantity = 0 "
        + "where sky_id = 'SKY-7102';");
      const b2 = await merke(B, "SKY-7102");
      await db.exec("update public.shop_inventory set quantity = 4 "
        + "where sky_id = 'SKY-7102';");
      const vorher = await gemeldet();
      const r = await feuere(null);
      const nachher = await gemeldet();
      ok58 = sag58("Abgleich ohne Nutzerkontext", b2 === "armed" && r === "0"
        && nachher === String(Number(vorher) + 1),
        `Rueckgabe ${r} (muss 0 sein, auth.uid() ist NULL) · gemeldet `
        + `${vorher} → ${nachher} · die Ausloesung lief vollstaendig`);
    }

    /* ------------- 11. „GESEHEN" IST EREIGNISGENAU --------------------- */
    if (ok58) {
      const idA = await w58("select min(id)::text as w from public.availability_alerts"
        + ` where user_id = '${A}'`);
      const idB = await w58("select min(id)::text as w from public.availability_alerts"
        + ` where user_id = '${B}'`);
      /* A bestaetigt B's Alarm: nichts. */
      const fremd = await als(A, "select public.acknowledge_availability_alerts("
        + `array[${idB}]::bigint[])::text as w`);
      /* A bestaetigt eine LEERE Liste: nichts, und nicht alles. */
      const leer = await als(A, "select public.acknowledge_availability_alerts("
        + "array[]::bigint[])::text as w");
      /* A bestaetigt den eigenen: genau einen. */
      const eigen = await als(A, "select public.acknowledge_availability_alerts("
        + `array[${idA}]::bigint[])::text as w`);
      /* Und ein zweites Mal: nichts, und der Zeitpunkt bleibt. */
      const zeit = await w58(`select read_at::text as w from public.availability_alerts
                               where id = ${idA}`);
      const nochmal = await als(A, "select public.acknowledge_availability_alerts("
        + `array[${idA}]::bigint[])::text as w`);
      const zeit2 = await w58(`select read_at::text as w from public.availability_alerts
                                where id = ${idA}`);
      const bOffen = await w58("select (read_at is null)::text as w "
        + `from public.availability_alerts where id = ${idB}`);
      ok58 = sag58("Gesehen trifft das Ereignis", fremd === "0" && leer === "0"
        && eigen === "1" && nochmal === "0" && zeit === zeit2 && bOffen === "true",
        `fremd ${fremd} · leere Liste ${leer} · eigen ${eigen} · zweiter Klick `
        + `${nochmal} und read_at unveraendert ${zeit === zeit2} · B unberuehrt ${bOffen}`);
    }

    /* ------------- 12. ERNEUT VORMERKEN: erst wenn wieder weg ---------- */
    if (ok58) {
      /* SKY-7101 ist noch kaufbar — also nein. */
      const jetzt = await merke(A, "SKY-7101");
      await db.exec("update public.shop_inventory set quantity = 0 "
        + "where sky_id = 'SKY-7101';");
      const danach = await merke(A, "SKY-7101");
      const zeilen = await w58("select count(*)::text as w from public.availability_alerts"
        + ` where user_id = '${A}' and sky_id = 'SKY-7101'`);
      const offen = await offenFuer(A);
      ok58 = sag58("neuer Alarm erst bei neuer Nichtverfuegbarkeit",
        jetzt === "buyable" && danach === "armed" && zeilen === "2" && offen === "1",
        `kaufbar: ${jetzt} · nicht kaufbar: ${danach} · Zeilen zu SKY-7101: `
        + `${zeilen} (eine abgeschlossen, eine offen) · offen fuer A: ${offen}`);
    }

    /* ------------- 13. Zuruecknehmen nur vor der Ausloesung ------------ */
    if (ok58) {
      const weg = await als(A, "select public.unwatch_availability('SKY-7101')::text as w");
      const gemeldeteWeg = await als(B, "select public.unwatch_availability('SKY-7101')::text as w");
      const bSteht = await w58("select count(*)::text as w from public.availability_alerts"
        + ` where user_id = '${B}' and sky_id = 'SKY-7101'`);
      ok58 = sag58("zurueckziehen", weg === "1" && gemeldeteWeg === "0" && bSteht === "1",
        `scharf: ${weg} · ausgeloest: ${gemeldeteWeg} (muss 0 sein) · B's Meldung `
        + `steht noch: ${bSteht}`);
    }

    /* ------------- 14. Die CHECKs halten ------------------------------- */
    if (ok58) {
      /* read_at ohne notified_at ist kein Zustand. */
      let verweigert = "lief durch (muss abbrechen)";
      await db.exec("begin;");
      try {
        await db.exec("insert into public.availability_alerts (user_id, sky_id, read_at) "
          + `values ('${A}', 'SKY-7102', now());`);
      } catch (e) {
        verweigert = `[${(e as { code?: string }).code ?? "?"}]`;
      } finally { await db.exec("rollback;"); }
      /* Ein Preis ohne Zeitpunkt ebenso. */
      let verweigert2 = "lief durch (muss abbrechen)";
      await db.exec("begin;");
      try {
        await db.exec("insert into public.availability_alerts (user_id, sky_id, notified_cents) "
          + `values ('${A}', 'SKY-7102', 100);`);
      } catch (e) {
        verweigert2 = `[${(e as { code?: string }).code ?? "?"}]`;
      } finally { await db.exec("rollback;"); }
      ok58 = sag58("die CHECKs halten", verweigert.startsWith("[23514]")
        && verweigert2.startsWith("[23514]"),
        `read_at ohne notified_at: ${verweigert} · Preis ohne Zeitpunkt: ${verweigert2}`);
    }

    /* ------------- 15. RLS: nur das Eigene ----------------------------- */
    if (ok58) {
      const alsLeser = async (uid: string | null): Promise<string> => {
        await db.exec("begin;");
        try {
          await db.exec(uid === null
            ? "select set_config('z58.uid', '', true)"
            : `select set_config('z58.uid', '${uid}', true)`);
          await db.exec("set local role authenticated;");
          const r = (await db.query(
            "select count(*)::text as w from public.availability_alerts")) as
            { rows: { w: string }[] };
          return String(r.rows[0]?.w);
        } finally { await db.exec("rollback;"); }
      };
      const alle = await alarme();
      const sichtA = await alsLeser(A);
      const sichtB = await alsLeser(B);
      const sichtOhne = await alsLeser(null);
      ok58 = sag58("RLS: nur das Eigene",
        Number(sichtA) + Number(sichtB) === Number(alle) && sichtOhne === "0"
        && sichtA !== alle,
        `insgesamt ${alle} · A sieht ${sichtA} · B sieht ${sichtB} · `
        + `ohne Anmeldung ${sichtOhne}`);
    }

    /* ------------- 16. Die Ruecknahme ---------------------------------- */
    if (ok58) {
      const mit = await fahre(db, "supabase/rollback/R0150_drop_availability_alerts.sql");
      const bleibt = await alarme();
      await db.exec("delete from public.availability_alerts;");
      const ohne = await fahre(db, "supabase/rollback/R0150_drop_availability_alerts.sql");
      const fort = ohne === null ? await w58(
        "select ((to_regclass('public.availability_alerts') is null)"
        + " and (to_regprocedure('public.watch_availability(text)') is null)"
        + " and (to_regprocedure('public.fire_availability_alerts()') is null)"
        + " and (to_regclass('public.offer_state_live') is not null))::text as w") : "-";
      ok58 = sag58("Ruecknahme",
        mit !== null && mit.includes("stehen in der Tabelle") && bleibt !== "0"
        && ohne === null && fort === "true",
        `mit Zeilen: bricht ab (${bleibt} blieben) · ohne Zeilen: ${ohne ?? "durch"} · `
        + `fort und offer_state_live steht: ${fort}`);
    }

    probe.push({
      name: "P58 0150 meldet genau einmal, ohne Spiegel und ohne Karenzzeit: 0151 legt die Sicht an, laeuft ohne "
        + "favorites/offer_state/availability_notifications, drei Antworten beim Scharfstellen, "
        + "ein zweiter Lauf meldet nichts, ohne Nutzerkontext loest er vollstaendig aus, "
        + "Gesehen trifft das Ereignis, neuer Alarm erst bei neuer Nichtverfuegbarkeit",
      ok: ok58,
      sagt: `0150: ${befund58.join(" · ")}`,
    });
  }

  /* =====================================================================
   * P59 — `0151`: ZWEI AUSGANGSLAGEN, EIN ENDZUSTAND — UND VIER
   *       ABWEICHUNGEN, DIE AUFFALLEN MUESSEN.
   *
   * `0151` ist die einzige Migration dieser Reihe, die eine bestehende Welt
   * ANTREFFEN darf: auf Production fehlt die Sicht und wird angelegt, auf
   * Staging steht sie seit `0146` und wird geprueft. Beides ist richtig, und
   * beides wird hier gefahren.
   *
   * DER EIGENTLICHE GEGENSTAND dieses Durchgangs ist aber der dritte Fall:
   * eine bestehende Sicht, die ANDERS ist. Der Auftrag verlangt, dass sie
   * nicht stillschweigend durchgeht — also wird jede der vier Pruefstufen
   * einzeln provoziert:
   *
   *   Stufe 1  Bauart     eine dritte Spalte
   *   Stufe 2  Herkunft   dieselben Spalten, aber sie liest eine RELATION
   *   Stufe 3  Wortlaut   `max` statt `min` — Spalten und Herkunft gleich
   *   Stufe 4  Verhalten  jedes Stueck im Wortlaut vorhanden, Ergebnis anders
   *
   * Stufe 4 ist der Fall, den nur ein Vergleich am echten Datenbestand
   * findet — und er ist der Grund, warum dieser Probelauf eine Figur hat,
   * die kaufbar ist, und eine, die es nicht ist.
   * ================================================================== */
  {
    const db = await frisch();

    /* 0151 und 0150 aus dem Stub-Schema heraus, und die ganze alte Bauform:
       diese Welt ist Production, nicht Staging. */
    await db.exec("drop function if exists public.acknowledge_availability_alerts(bigint[]);");
    await db.exec("drop function if exists public.fire_availability_alerts();");
    await db.exec("drop function if exists public.unwatch_availability(text);");
    await db.exec("drop function if exists public.watch_availability(text);");
    await db.exec("drop table if exists public.availability_alerts cascade;");
    await db.exec("drop function if exists public.mark_availability_notifications_read(text[]);");
    await db.exec("drop function if exists public.claim_availability_notifications();");
    await db.exec("drop table if exists public.availability_notifications cascade;");
    await db.exec("drop function if exists public.offer_availability_due();");
    await db.exec("drop function if exists public.offer_availability_grace();");
    await db.exec("drop function if exists public.refresh_offer_state();");
    await db.exec("drop function if exists public.offer_state_window();");
    await db.exec("drop table if exists public.offer_state cascade;");
    await db.exec("drop function if exists public.favorite_demand(text[]);");
    await db.exec("drop table if exists public.favorites cascade;");
    await db.exec("drop view if exists public.offer_state_live;");

    await attrappenFuerBaseline(db);

    await db.exec(`
      alter table public.skylanders add constraint z59_sky_pk primary key (sky_id);
      insert into public.skylanders (sky_id, name, slug, market_price)
      values ('SKY-7201', 'Probe Kaufbar', 'probe-kaufbar-59', 20.00),
             ('SKY-7202', 'Probe Vergriffen', 'probe-vergriffen-59', 30.00)
        on conflict do nothing;
      insert into public.shop_settings (id, price_percentage)
      values (true, 100) on conflict do nothing;
      alter table public.shop_inventory drop column if exists available_quantity;
      alter table public.shop_inventory
        add column available_quantity integer
        generated always as (quantity - reserved) stored;
      create sequence if not exists public.z59_inv_seq start 1;
      alter table public.shop_inventory alter column id set default nextval('public.z59_inv_seq');
      drop function if exists public.shop_offers();
      create function public.shop_offers()
      returns table (sky_id text, condition text, price numeric,
                     available boolean, delivery_scope text)
      language sql stable as $p59$
        select i.sky_id, i.condition,
               public.shop_price(i.sale_price, s.market_price, st.price_percentage),
               (i.available_quantity > 0), null::text
          from public.shop_inventory i
          join public.skylanders s on s.sky_id = i.sky_id
          cross join public.shop_settings st
         where i.is_listed
           and i.condition = public.v1_sale_condition()
           and public.shop_price(i.sale_price, s.market_price, st.price_percentage)
               is not null;
      $p59$;
      -- EINE kaufbare und EINE gelistete, aber vergriffene Figur. Die zweite
      -- ist der Grund, warum Stufe 4 ueberhaupt etwas unterscheiden kann.
      insert into public.shop_inventory (sky_id, condition, quantity, reserved, is_listed)
      values ('SKY-7201', 'loose', 2, 0, true),
             ('SKY-7202', 'loose', 0, 0, true);`);

    const befund59: string[] = [];
    let ok59 = true;
    const sag59 = (was: string, gut: boolean, text: string): boolean => {
      befund59.push(`${was}: ${gut ? text : `BEFUND ${text}`}`);
      return gut;
    };
    const w59 = async (sql: string): Promise<string> =>
      String(((await db.query(sql)) as { rows: Record<string, unknown>[] })
        .rows[0]?.w ?? "?");
    const sichtDa = () => w59(
      "select (to_regclass('public.offer_state_live') is not null)::text as w");
    /** Der Abdruck der Sicht: Definition UND Rechte in einer Zahl. */
    const sichtAbdruck = () => w59(
      `select md5(pg_get_viewdef(to_regclass('public.offer_state_live'), true)
        || coalesce((select string_agg(a.grantee::regrole::text || ':'
                                      || a.privilege_type, ',' order by a.privilege_type)
                       from pg_class c, aclexplode(c.relacl) a
                      where c.oid = to_regclass('public.offer_state_live')), '-')) as w`);
    const M151 = join(MIG_DIR, "0151_offer_state_live.sql");
    /** Eine abweichende Sicht stellen — und 0151 darauf loslassen. */
    const abweichung = async (name: string, ddl: string): Promise<string> => {
      await db.exec("drop view if exists public.offer_state_live;");
      await db.exec(ddl);
      const r = await fahre(db, M151);
      await db.exec("drop view if exists public.offer_state_live;");
      return r ?? `${name}: LIEF DURCH (muss abbrechen)`;
    };

    /* ---- 1. AUSGANGSLAGE PRODUCTION: die Sicht fehlt ------------------ */
    if (ok59) {
      const vorher = await sichtDa();
      const r = await fahre(db, M151);
      const nachher = await sichtDa();
      const spalten = await w59(
        `select string_agg(a.attname::text || ' '
                || format_type(a.atttypid, a.atttypmod), ', ' order by a.attnum) as w
           from pg_attribute a
          where a.attrelid = to_regclass('public.offer_state_live')
            and a.attnum > 0 and not a.attisdropped`);
      ok59 = sag59("Production: die Sicht fehlt und entsteht",
        vorher === "false" && r === null && nachher === "true"
        && spalten === "sky_id text, cheapest_cents integer",
        `vorher ${vorher} · ${r ?? "durch"} · nachher ${nachher} · Spalten ${spalten}`);
    }

    /* ---- 2. Sie liest keine Relation, nur die zwei Funktionen --------- */
    if (ok59) {
      const relationen = await w59(
        `select count(*)::text as w from pg_depend d
           join pg_rewrite r on r.oid = d.objid
          where d.classid = 'pg_rewrite'::regclass
            and d.refclassid = 'pg_class'::regclass
            and r.ev_class = to_regclass('public.offer_state_live')
            and d.refobjid <> to_regclass('public.offer_state_live')`);
      const funktionen = await w59(
        `select string_agg(distinct p.proname::text, ',' order by p.proname::text) as w
           from pg_depend d
           join pg_rewrite r on r.oid = d.objid
           join pg_proc p on p.oid = d.refobjid
          where d.classid = 'pg_rewrite'::regclass
            and d.refclassid = 'pg_proc'::regclass
            and r.ev_class = to_regclass('public.offer_state_live')`);
      const rechte = await w59(
        `select coalesce((select count(*)::text from pg_class c, aclexplode(c.relacl) a
                           where c.oid = to_regclass('public.offer_state_live')
                             and (a.grantee = 0
                                  or a.grantee::regrole::text
                                     in ('anon', 'authenticated'))), '0') as w`);
      ok59 = sag59("Herkunft und Rechte", relationen === "0"
        && funktionen !== null && funktionen.includes("shop_offers")
        && funktionen.includes("v1_sale_condition") && rechte === "0",
        `Relationen ${relationen} · Funktionen ${funktionen} · Clientrechte ${rechte}`);
    }

    /* ---- 3. Und sie trifft fachlich zu: nur die kaufbare Figur -------- */
    if (ok59) {
      const inhalt = await w59(
        `select coalesce(string_agg(x.sky_id || '=' || x.cheapest_cents::text,
                                    ',' order by x.sky_id), '(leer)') as w
           from public.offer_state_live x`);
      ok59 = sag59("die Sicht sagt, was kaufbar ist", inhalt === "SKY-7201=2000",
        `${inhalt} (SKY-7202 ist gelistet, aber vergriffen)`);
    }

    /* ---- 4. WIEDERHOLBAR: ein zweiter Lauf aendert nichts ------------- */
    if (ok59) {
      const vor = await sichtAbdruck();
      const r2 = await fahre(db, M151);
      const nach = await sichtAbdruck();
      const r3 = await fahre(db, M151);
      const nach3 = await sichtAbdruck();
      ok59 = sag59("wiederholbar", r2 === null && r3 === null
        && vor === nach && nach === nach3,
        `zweiter Lauf ${r2 ?? "durch"} · dritter ${r3 ?? "durch"} · `
        + `Abdruck unveraendert ${vor === nach && nach === nach3}`);
    }

    /* ---- 5. STUFE 1: eine dritte Spalte faellt auf -------------------- */
    if (ok59) {
      const r = await abweichung("Spalten", `
        create view public.offer_state_live as
          select o.sky_id,
                 min(round(o.price * 100))::integer as cheapest_cents,
                 count(*)::integer as wie_viele
            from public.shop_offers() o
           where o.available and o.condition = public.v1_sale_condition()
           group by o.sky_id;`);
      ok59 = sag59("Stufe 1 Bauart", r.includes("die Spalten"), r);
    }

    /* ---- 6. STUFE 2: dieselben Spalten, aber sie liest eine Relation -- */
    if (ok59) {
      const r = await abweichung("Relation", `
        create view public.offer_state_live as
          select o.sky_id,
                 min(round(o.price * 100))::integer as cheapest_cents
            from public.shop_offers() o
           where o.available and o.condition = public.v1_sale_condition()
             and exists (select 1 from public.shop_inventory)
           group by o.sky_id;`);
      ok59 = sag59("Stufe 2 Herkunft", r.includes("Relation(en) direkt"), r);
    }

    /* ---- 7. STUFE 3: max statt min — Spalten und Herkunft gleich ------ */
    if (ok59) {
      const r = await abweichung("Wortlaut", `
        create view public.offer_state_live as
          select o.sky_id,
                 max(round(o.price * 100))::integer as cheapest_cents
            from public.shop_offers() o
           where o.available and o.condition = public.v1_sale_condition()
           group by o.sky_id;`);
      ok59 = sag59("Stufe 3 Wortlaut (max statt min)",
        r.includes("im Wortlaut der bestehenden Sicht fehlt"), r);
    }

    /* ---- 8. STUFE 4: jedes Stueck da, Ergebnis anders ----------------- */
    if (ok59) {
      /*
       * DER FALL, DEN NUR DER DATENVERGLEICH FINDET. Spalten stimmen,
       * Herkunft stimmt, und der Wortlaut enthaelt `shop_offers`,
       * `v1_sale_condition`, `min(round(`, `*100`, `available` und
       * `group by` — alle sechs. Nur das Ergebnis ist ein anderes.
       */
      const r = await abweichung("Verhalten", `
        create view public.offer_state_live as
          select o.sky_id,
                 min(round(o.price * 100))::integer as cheapest_cents
            from public.shop_offers() o
           where o.available and o.condition = public.v1_sale_condition()
             and o.sky_id <> 'SKY-7201'
           group by o.sky_id;`);
      ok59 = sag59("Stufe 4 Verhalten", r.includes("ein anderes Ergebnis"), r);
    }

    /* ---- 9. Ein Clientrecht faellt ebenfalls auf ---------------------- */
    if (ok59) {
      await db.exec("drop view if exists public.offer_state_live;");
      await db.exec(`
        create view public.offer_state_live as
          select o.sky_id,
                 min(round(o.price * 100))::integer as cheapest_cents
            from public.shop_offers() o
           where o.available and o.condition = public.v1_sale_condition()
           group by o.sky_id;
        grant select on public.offer_state_live to authenticated;`);
      const r = await fahre(db, M151);
      ok59 = sag59("ein Clientrecht faellt auf",
        r !== null && r.includes("Clientrecht"), r ?? "LIEF DURCH (muss abbrechen)");
      /* Wieder herstellen, wie 0151 sie will. */
      await db.exec("revoke all on public.offer_state_live from authenticated;");
      const gut = await fahre(db, M151);
      ok59 = ok59 && sag59("und nach dem Entzug laeuft sie wieder durch",
        gut === null, gut ?? "durch");
    }

    /* ---- 10. AUSGANGSLAGE STAGING: 0146 hat sie angelegt ------------- */
    if (ok59) {
      /*
       * Die Staging-Welt: der Spiegel samt Sicht aus `0146`. Danach `0151` —
       * sie muss pruefen und NICHTS anfassen, und zwar auch die Rechte und
       * den Kommentar nicht.
       */
      await db.exec("drop view if exists public.offer_state_live;");
      const l146 = await fahre(db, join(MIG_DIR, "0146_offer_state.sql"));
      const vorhanden = await sichtDa();
      const vor = l146 === null ? await sichtAbdruck() : "-";
      const kommentarVor = l146 === null ? await w59(
        `select coalesce(obj_description(to_regclass('public.offer_state_live'),
                                         'pg_class'), '(keiner)') as w`) : "-";
      const r = l146 === null ? await fahre(db, M151) : "-";
      const nach = r === null ? await sichtAbdruck() : "-";
      const kommentarNach = r === null ? await w59(
        `select coalesce(obj_description(to_regclass('public.offer_state_live'),
                                         'pg_class'), '(keiner)') as w`) : "-";
      const spiegelSteht = await w59(
        "select (to_regclass('public.offer_state') is not null)::text as w");
      ok59 = sag59("Staging: 0146 hat sie angelegt, 0151 laesst sie unberuehrt",
        l146 === null && vorhanden === "true" && r === null && vor === nach
        && kommentarVor === kommentarNach && kommentarVor !== "(keiner)"
        && spiegelSteht === "true",
        `0146: ${l146 ?? "durch"} · 0151: ${r ?? "durch"} · Abdruck unveraendert `
        + `${vor === nach} · Kommentar unveraendert ${kommentarVor === kommentarNach} `
        + `· offer_state steht ${spiegelSteht}`);
    }

    /* ---- 11. R0151 verweigert, solange jemand liest ------------------- */
    if (ok59) {
      /* In dieser Welt steht `refresh_offer_state()` aus 0146 — ein Leser. */
      const mitLeser = await fahre(db, "supabase/rollback/R0151_drop_offer_state_live.sql");
      const stehtNoch = await sichtDa();
      /* Die Leser der alten Bauform fort (R0146 nimmt die Sicht mit — genau
         deshalb braucht M9 eine eigene Fassung; hier reicht ein drop). */
      await db.exec("drop function if exists public.refresh_offer_state();");
      await db.exec("drop function if exists public.offer_availability_due();");
      const ohneLeser = await fahre(db, "supabase/rollback/R0151_drop_offer_state_live.sql");
      const fort = ohneLeser === null ? await sichtDa() : "-";
      const shopSteht = await w59(
        "select (to_regprocedure('public.shop_offers()') is not null)::text as w");
      ok59 = sag59("R0151",
        mitLeser !== null && mitLeser.includes("lesen die Sicht")
        && stehtNoch === "true" && ohneLeser === null && fort === "false"
        && shopSteht === "true",
        `mit Leser: bricht ab und die Sicht steht noch (${stehtNoch}) · ohne Leser: `
        + `${ohneLeser ?? "durch"}, fort ${fort} · shop_offers unberuehrt ${shopSteht}`);
    }

    probe.push({
      name: "P59 0151 stellt die Live-Sicht eigenstaendig bereit: sie entsteht, wo sie fehlt, "
        + "bleibt unberuehrt, wo sie steht, ist wiederholbar — und eine abweichende Fassung "
        + "faellt in jeder der vier Stufen auf (Bauart, Herkunft, Wortlaut, Verhalten)",
      ok: ok59,
      sagt: `0151: ${befund59.join(" · ")}`,
    });
  }

  /* ==================================================================
   * P60 — `0152`: DIE WAHRHEITSTABELLE DES STATUS-TRIGGERS.
   *
   * WOFUER. `0152` fuegt eine Spalte hinzu, deren Wert ein Trigger aus der
   * jeweils anderen ableitet. Das ist genau die Art Mechanik, die man nicht
   * durch Lesen pruefen kann: welcher Zweig feuert, haengt davon ab, welche
   * Spalte sich gegenueber der alten Zeile UNTERSCHEIDET — und PL/pgSQL kann
   * „genannt" nicht von „genannt mit demselben Wert" unterscheiden.
   *
   * Dieser Durchgang fuehrt deshalb JEDEN Schreibweg an echtem PostgreSQL
   * und schreibt das Ergebnis auf. Vierzehn Faelle, darunter die acht, die
   * der Betreiber ausdruecklich genannt hat, die drei Legacy-Pfade und die
   * beiden Faelle, die kontrolliert abgewiesen werden muessen.
   *
   * DIE WELT IST „VOR DER MIGRATION": Spalte, Trigger und beide CHECKs
   * werden aus dem Stub-Schema entfernt, dann laeuft `0152`.
   * ================================================================== */
  {
    const db = await frisch();
    const M152 = join(MIG_DIR, "0152_catalog_status.sql");
    const befund60: string[] = [];
    let ok60 = true;
    const sag60 = (was: string, gut: boolean, text: string): boolean => {
      /* Der Schritt, der anschlaegt, nennt sich selbst — sonst muss man bei
         siebzehn Befunden raten, welcher gemeint ist. */
      befund60.push(`${gut ? "" : "!! "}${was}: ${text}`);
      if (!gut) ok60 = false;
      return gut;
    };
    const w60 = async (sql: string): Promise<string> =>
      String(((await db.query(sql)) as { rows: Record<string, unknown>[] })
        .rows[0]?.w ?? "?");
    /** Der Zustand einer Zeile, als ein Wort: `status/visible`. */
    const zustand = (id: string) => w60(
      `select catalog_status || '/' || catalog_visible::text as w
         from public.skylanders where sky_id = '${id}'`);
    /** Eine Anweisung fahren; gibt den Fehlercode zurueck oder null. */
    const tu = async (sql: string): Promise<string | null> => {
      try { await db.exec(sql); return null; }
      catch (e) { return (e as { code?: string }).code ?? "FEHLER"; }
    };

    /* --- die Welt vor der Migration ------------------------------------ */
    /*
     * ZUERST EIN BEFUND DES WERKZEUGS, NICHT DER MIGRATION.
     *
     * `0033` legte `admin_create_figure` mit SIEBEN Parametern an, `0034` mit
     * acht — und `0034` loescht die alte Fassung ausdruecklich (Zeile 41).
     * In der echten Datenbank gibt es also genau eine. Das Stub-Schema
     * sammelt Funktionen aber nach Signatur und wertet `drop function`
     * NICHT aus, also stehen hier beide, und ein Aufruf mit drei Argumenten
     * ist mehrdeutig.
     *
     * Deshalb wird die ueberholte Fassung hier genauso entfernt, wie `0034`
     * sie entfernt. Die Welt dieses Durchgangs soll der Datenbank
     * entsprechen, nicht dem Stub.
     */
    await db.exec(`drop function if exists
      public.admin_create_figure(text, text, bigint, text, boolean, text, text);`);
    await db.exec("drop trigger if exists skylanders_sync_catalog_status on public.skylanders;");
    await db.exec("drop function if exists public.skylanders_sync_catalog_status();");
    await db.exec(`alter table public.skylanders
                     drop constraint if exists skylanders_catalog_status_known,
                     drop constraint if exists skylanders_catalog_status_matches_visibility,
                     drop column if exists catalog_status;`);
    const vorher = await w60(
      `select (not exists (select 1 from information_schema.columns
                where table_schema='public' and table_name='skylanders'
                  and column_name='catalog_status'))::text as w`);
    await serienUndIdentitaet(db);
    /*
     * ZWEITER WERKZEUGBEFUND. Das Stub-Schema beschreibt Spalten, aber keine
     * Schluessel — in der echten Tabelle ist `sky_id` der Primaerschluessel
     * (`0001`), hier gibt es keinen, und ein `on conflict (sky_id)` wie der
     * Katalogimport es benutzt scheitert mit `42P10`. Der Index wird deshalb
     * nachgezogen: dieser Durchgang soll den Import in seiner ECHTEN Form
     * fahren, nicht in einer, die der Stub zufaellig zulaesst.
     */
    await db.exec("create unique index if not exists z_sky_id_uniq on public.skylanders (sky_id);");
    await db.exec(`insert into public.categories (series_code, name, position)
                   values ('SA', 'Skylanders', 0);`);
    /* Zwei Zeilen VOR der Migration: eine sichtbare, eine versteckte. Der
       Backfill muss aus ihnen 'public' und 'hidden' machen — und keinen
       Entwurf. */
    await db.exec(`insert into public.skylanders
                     (sky_id, name, slug, series_code, category_id, is_active, catalog_visible)
                   select 'SKY-9001', 'Alt sichtbar', 'alt-sichtbar', 'SA', c.id, true, true
                     from public.categories c limit 1;`);
    await db.exec(`insert into public.skylanders
                     (sky_id, name, slug, series_code, category_id, is_active, catalog_visible)
                   select 'SKY-9002', 'Alt versteckt', 'alt-versteckt', 'SA', c.id, true, false
                     from public.categories c limit 1;`);

    const lauf = await fahre(db, M152);
    sag60("Lauf", vorher === "true" && lauf === null,
          `Spalte fehlte vorher ${vorher} · Migration ${lauf ?? "durch"}`);

    if (lauf === null) {
      /* --- der Backfill --------------------------------------------- */
      const b1 = await zustand("SKY-9001");
      const b2 = await zustand("SKY-9002");
      const entwuerfe = await w60(
        "select count(*)::text as w from public.skylanders where catalog_status = 'draft'");
      sag60("Backfill", b1 === "public/true" && b2 === "hidden/false" && entwuerfe === "0",
            `sichtbar → ${b1} · versteckt → ${b2} · Entwuerfe nach dem Backfill: ${entwuerfe}`);

      /* --- eine Zeile je Fall, damit die Faelle sich nicht stoeren ---- */
      const neu = async (id: string, sichtbar: boolean, status: string | null) => {
        const spalten = status === null
          ? "(sky_id, name, slug, series_code, category_id, is_active, catalog_visible)"
          : "(sky_id, name, slug, series_code, category_id, is_active, catalog_visible, catalog_status)";
        const werte = status === null
          ? `'${id}', '${id}', '${id.toLowerCase()}', 'SA', c.id, true, ${sichtbar}`
          : `'${id}', '${id}', '${id.toLowerCase()}', 'SA', c.id, true, ${sichtbar}, '${status}'`;
        return tu(`insert into public.skylanders ${spalten}
                   select ${werte} from public.categories c limit 1;`);
      };

      /* FALL 5 und 6: INSERT ohne Status. */
      const f5 = await neu("SKY-9005", true, null);
      const f6 = await neu("SKY-9006", false, null);
      sag60("F5/F6 INSERT ohne Status",
            f5 === null && f6 === null
            && (await zustand("SKY-9005")) === "public/true"
            && (await zustand("SKY-9006")) === "hidden/false",
            `sichtbar → ${await zustand("SKY-9005")} · unsichtbar → ${await zustand("SKY-9006")}`);

      /* FALL 7: INSERT mit ausdruecklichem 'draft'. */
      const f7 = await neu("SKY-9007", false, "draft");
      sag60("F7 INSERT mit draft", f7 === null && (await zustand("SKY-9007")) === "draft/false",
            `${await zustand("SKY-9007")}`);

      /* FALL 10: INSERT mit 'draft' UND catalog_visible = true.
         Der Status gewinnt — die Sichtbarkeit hat einen Vorgabewert und kann
         unbeabsichtigt dort stehen, ein genannter Status nicht. */
      const f10 = await neu("SKY-9010", true, "draft");
      sag60("F10 INSERT draft + visible true", f10 === null
            && (await zustand("SKY-9010")) === "draft/false",
            `${await zustand("SKY-9010")} (der Status gewinnt)`);

      /* FALL 1: public → catalog_visible false. */
      await neu("SKY-9011", true, null);
      const f1 = await tu("update public.skylanders set catalog_visible = false where sky_id = 'SKY-9011';");
      sag60("F1 public → visible false", f1 === null && (await zustand("SKY-9011")) === "hidden/false",
            `${await zustand("SKY-9011")}`);

      /* FALL 2: hidden → catalog_visible true. */
      await neu("SKY-9012", false, "hidden");
      const f2 = await tu("update public.skylanders set catalog_visible = true where sky_id = 'SKY-9012';");
      sag60("F2 hidden → visible true", f2 === null && (await zustand("SKY-9012")) === "public/true",
            `${await zustand("SKY-9012")}`);

      /* FALL 3: draft → catalog_visible true. Der Entwurf wird oeffentlich,
         denn der Wechsel nach sichtbar ist der eine eindeutige. */
      await neu("SKY-9013", false, "draft");
      const f3 = await tu("update public.skylanders set catalog_visible = true where sky_id = 'SKY-9013';");
      sag60("F3 draft → visible true", f3 === null && (await zustand("SKY-9013")) === "public/true",
            `${await zustand("SKY-9013")}`);

      /* FALL 4: draft → catalog_visible false. KEINE Aenderung, also bleibt
         der Entwurf ein Entwurf — das ist die Zusage aus ADR-0151 F-6. */
      await neu("SKY-9014", false, "draft");
      const f4 = await tu("update public.skylanders set catalog_visible = false where sky_id = 'SKY-9014';");
      sag60("F4 draft → visible false", f4 === null && (await zustand("SKY-9014")) === "draft/false",
            `${await zustand("SKY-9014")} (Entwurf bleibt Entwurf)`);

      /* FALL 8 und 9: UPDATE nur des Status. */
      await neu("SKY-9008", false, "hidden");
      const f8 = await tu("update public.skylanders set catalog_status = 'draft' where sky_id = 'SKY-9008';");
      await neu("SKY-9009", true, null);
      const f9 = await tu("update public.skylanders set catalog_status = 'draft' where sky_id = 'SKY-9009';");
      sag60("F8/F9 nur Status geaendert",
            f8 === null && f9 === null
            && (await zustand("SKY-9008")) === "draft/false"
            && (await zustand("SKY-9009")) === "draft/false",
            `hidden→draft ${await zustand("SKY-9008")} · public→draft ${await zustand("SKY-9009")}`);

      /* FALL 11: BEIDE genannt, der Status unveraendert, die Sichtbarkeit
         geaendert. Die geaenderte Spalte entscheidet — und das ist die
         einzige Regel, die ein Trigger haben KANN: „genannt mit demselben
         Wert" ist von „nicht genannt" nicht unterscheidbar. */
      await neu("SKY-9015", false, "hidden");
      const f11 = await tu(`update public.skylanders
                              set catalog_status = 'hidden', catalog_visible = true
                            where sky_id = 'SKY-9015';`);
      sag60("F11 beide genannt, nur Sichtbarkeit geaendert",
            f11 === null && (await zustand("SKY-9015")) === "public/true",
            `${await zustand("SKY-9015")} (die geaenderte Spalte entscheidet)`);

      /* FALL 12 und 13: was abgewiesen werden MUSS. */
      await neu("SKY-9016", true, null);
      const f12 = await tu("update public.skylanders set catalog_status = 'bogus' where sky_id = 'SKY-9016';");
      const f13 = await tu("update public.skylanders set catalog_status = null where sky_id = 'SKY-9016';");
      const nach1213 = await zustand("SKY-9016");
      sag60("F12/F13 abgewiesen",
            f12 !== null && f13 !== null && nach1213 === "public/true",
            `unbekannter Wert ${f12} · NULL ${f13} · Zeile unveraendert ${nach1213}`);

      /* FALL 14: ein UPDATE, das keine der beiden Spalten nennt. */
      await neu("SKY-9017", false, "draft");
      const f14 = await tu("update public.skylanders set name = 'Umbenannt' where sky_id = 'SKY-9017';");
      sag60("F14 UPDATE ohne die beiden Spalten",
            f14 === null && (await zustand("SKY-9017")) === "draft/false",
            `${await zustand("SKY-9017")}`);

      /* DER IMPORT, in seiner echten Form: ein Upsert ueber acht Spalten,
         der keine der beiden nennt. Eine bestehende Zeile darf sich nicht
         bewegen — auch nicht ihr Entwurfszustand. */
      await neu("SKY-9018", false, "draft");
      const fImp = await tu(`insert into public.skylanders
                               (sky_id, name, slug, series_code, category_id, market_price,
                                image_file, is_active)
                             select 'SKY-9018', 'Import', 'sky-9018', 'SA', c.id, 9.99, null, true
                               from public.categories c limit 1
                             on conflict (sky_id) do update set
                               name = excluded.name, market_price = excluded.market_price;`);
      sag60("Import-Upsert", fImp === null && (await zustand("SKY-9018")) === "draft/false",
            `${await zustand("SKY-9018")} (Entwurf unberuehrt)`);

      /*
       * DIE WIEDERHERSTELLUNG, und sie ist der Fall, der CAT-02C Teil B
       * entscheidet: ein `pg_restore` spielt die Tabelle mit ALLEN Spalten
       * ein, nennt also beide — und ein widerspruchsfreies Paar, weil der
       * CHECK es beim Sichern erzwungen hat. Der Trigger muss dann NICHTS
       * tun: seine Ableitung trifft genau den Wert, der schon dasteht.
       *
       * `COPY` feuert Zeilentrigger genauso wie `INSERT`, deshalb modelliert
       * ein INSERT mit beiden Spalten den Einspielweg richtig.
       *
       * Wuerde der Trigger hier etwas anderes ableiten, waere jeder Entwurf
       * nach einer Wiederherstellung still verloren.
       */
      let wh = "";
      for (const [id, sichtbar, status] of [
        ["SKY-9031", "true",  "public"],
        ["SKY-9032", "false", "hidden"],
        ["SKY-9033", "false", "draft"],
      ] as const) {
        const f = await tu(`insert into public.skylanders
                              (sky_id, name, slug, series_code, category_id, market_price,
                               image_file, is_active, catalog_visible, catalog_status)
                            select '${id}', 'Restore', '${id.toLowerCase()}', 'SA', c.id,
                                   9.99, null, true, ${sichtbar}, '${status}'
                              from public.categories c limit 1;`);
        const soll = `${status}/${sichtbar}`;
        const ist = await zustand(id);
        sag60(`Restore ${status}`, f === null && ist === soll, `${ist} (gesichert: ${soll})`);
        wh += ist;
      }
      sag60("Restore erhaelt den Entwurf", wh === "public/truehidden/falsedraft/false",
            wh.replaceAll("/", ":"));

      /* DIE BEIDEN CHECKS sind da und greifen auch gegen einen direkten
         Widerspruch, den der Trigger nicht aufloesen kann: eine Zeile, die
         den Trigger umgeht, gibt es nicht — aber der CHECK ist der
         Nachweis, dass es sie nicht geben KANN. */
      const checks = await w60(
        `select count(*)::text as w from pg_constraint
          where conrelid = 'public.skylanders'::regclass
            and conname in ('skylanders_catalog_status_known',
                            'skylanders_catalog_status_matches_visibility')`);
      const widerspruch = await w60(
        `select count(*)::text as w from public.skylanders
          where (catalog_status = 'public') <> catalog_visible`);
      sag60("Zwei CHECKs, kein Widerspruch", checks === "2" && widerspruch === "0",
            `CHECKs ${checks} · widerspruechliche Zeilen ${widerspruch}`);

      /* DAS JOURNAL: ein Statuswechsel schreibt eine Zeile, und der alte
         Weg schreibt weiterhin seine.
         .
         DER TRIGGER WIRD HIER ANGELEGT, weil das Stub-Schema Funktionen und
         Tabellen fuehrt, aber KEINE Trigger — `skylanders_log_editorial`
         stammt aus `0004` und fehlt deshalb in dieser Welt. `0152` ersetzt
         nur den Rumpf; ohne den Trigger waere der Rumpf nie aufgerufen und
         die Pruefung sagte nichts. Zeichengleich mit `0004`, Zeile 412. */
      await db.exec(`create trigger skylanders_log_editorial
                       after update on public.skylanders
                       for each row execute function public.log_skylander_editorial_change();`);
      /* MIT PRUEFUNG, und das ist eine Lehre aus diesem Durchgang: `neu` gibt
         einen Fehlercode ZURUECK statt zu werfen. Ein stilles Scheitern hier
         liesse die Pruefung an einer Zeile arbeiten, die ein anderer Fall
         angelegt hat — sie waere dann gruen, ohne etwas zu zeigen. */
      const fJ = await neu("SKY-9019", true, null);
      sag60("Journalzeile entsteht", fJ === null, fJ ?? "angelegt");
      await db.exec("delete from public.catalog_admin_changes;");
      await db.exec("update public.skylanders set catalog_status = 'hidden' where sky_id = 'SKY-9019';");
      const journal = await w60(
        `select string_agg(field || ':' || coalesce(old_value,'-') || '→' || coalesce(new_value,'-'),
                           ' ' order by field) as w
           from public.catalog_admin_changes where entity_id = 'SKY-9019'`);
      sag60("Journal", journal.includes("catalog_status:public→hidden")
            && journal.includes("catalog_visible:true→false"),
            journal);

      /* `admin_create_figure`: eine neu angelegte Figur ist ein Entwurf. */
      await db.exec(`create or replace function public.is_platform_admin() returns boolean
                     language sql as $stub$ select true $stub$;`);
      const neueId = await w60(
        `select public.admin_create_figure('Neu aus dem Editor', 'SA',
                  (select id from public.categories limit 1)) as w`);
      const neuerStatus = neueId.startsWith("SKY-") ? await zustand(neueId) : "?";
      sag60("admin_create_figure", neuerStatus === "draft/false",
            `${neueId} → ${neuerStatus}`);

      /*
       * DIE RUECKNAHME, gefahren und nicht behauptet — so wie P58 und P59 es
       * mit `R0150` und `R0151` tun. Sie muss drei Dinge zugleich leisten:
       * die Spalte samt Trigger, CHECKs und Schreibweg entfernen, die ZEILEN
       * unberuehrt lassen, und die beiden ersetzten Ruempfe auf ihre
       * Vorfassungen stellen — sonst liefe `admin_create_figure` danach
       * gegen eine Spalte, die es nicht mehr gibt.
       */
      const zeilenVorher = await w60("select count(*)::text as w from public.skylanders");

      /*
       * ZUERST `R0153`, UND DAS HAT DIESER DURCHGANG SELBST GEZEIGT. Das
       * Stub-Schema wird aus ALLEN Migrationen gebaut, `0153` eingeschlossen
       * — der Rumpf von `system_platform_export()` nennt hier also
       * `t.catalog_status`. `R0152` hat das erkannt und sich verweigert,
       * genau wie vorgesehen: ein `drop column` darunter liesse die
       * Sicherungsfunktion stehen und braeche sie erst beim naechsten
       * Aufruf. Die richtige Reihenfolge steht im Laufzettel, und hier wird
       * sie gefahren statt behauptet.
       */
      /*
       * UND SEIT `0160` IST ES EINE KETTE VON DREI. Dasselbe Argument eine
       * Stufe weiter: das Stub-Schema traegt auch `0160`, der Rumpf nennt
       * hier also `t.base_sky_id`. `R0153` hat das erkannt und sich
       * verweigert — eine dritte Fassung wird nicht ueberschrieben, genau
       * wie vorgesehen. Die Reihenfolge ist R0160 → R0153 → R0152, und sie
       * ist keine Konvention, sondern die Folge der Abdruck-Riegel.
       */
      /*
       * UND SEIT `0164` IST ES EINE KETTE VON VIER — mit einem Unterschied:
       * `R0164` stellt den Rumpf NICHT selbst her. Sie prueft den Abdruck und
       * sagt, welcher Abschnitt einzufuegen ist (eine zweite Kopie von 31 000
       * Zeichen waere die dritte Fassung, die auseinanderlaufen kann). Hier
       * wird deshalb getan, was ihr Hinweis verlangt: der Abschnitt aus
       * `0160`, aus der Datei geschnitten.
       *
       * Ohne diesen Schritt findet `R0160` den Rumpf aus `0164` vor und
       * verweigert sich — richtig, und genau daran ist dieser Durchgang beim
       * ersten Lauf nach `0164` gescheitert.
       */
      const rumpf0160 = (() => {
        const sql = readFileSync(
          join(MIG_DIR, "0160_platform_export_base_sky_id.sql"), "utf8");
        const von = sql.indexOf(
          "create or replace function public.system_platform_export()");
        const bis = sql.indexOf("\n$$;", von) + "\n$$;".length;
        return sql.slice(von, bis);
      })();
      const fR64 = await (async () => {
        try { await db.exec(rumpf0160); return null; }
        catch (e) { return String((e as { message?: string }).message ?? "FEHLER"); }
      })();
      sag60("R0164 zuerst: der Abschnitt aus 0160 bringt den Exportrumpf auf "
            + "den Stand von 0160 zurueck",
            fR64 === null, fR64 ?? "durch");

      const fR60 = await fahre(db, "supabase/rollback/R0160_platform_export_back_to_0153.sql");
      const basisFort = await w60(
        `select (count(*) = 0)::text as w from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'system_platform_export'
            and p.prosrc like '%''base_sky_id'', t.base_sky_id,%'`);
      sag60("R0160 vor R0153", fR60 === null && basisFort === "true",
            `durch ${fR60 ?? "ok"} · Export ohne base_sky_id ${basisFort}`);

      const fR53 = await fahre(db, "supabase/rollback/R0153_platform_export_back_to_0144.sql");
      const exportSauber = await w60(
        `select (count(*) = 0)::text as w from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'system_platform_export'
            and p.prosrc like '%''catalog_status'', t.catalog_status,%'`);
      sag60("R0153 vor R0152", fR53 === null && exportSauber === "true",
            `durch ${fR53 ?? "ok"} · Export ohne das Feld ${exportSauber}`);

      const fR = await fahre(db, "supabase/rollback/R0152_drop_catalog_status.sql");
      const spalteFort = await w60(
        `select (count(*) = 0)::text as w from pg_attribute a
          where a.attrelid = to_regclass('public.skylanders')
            and a.attname = 'catalog_status' and not a.attisdropped`);
      const triggerFort = await w60(
        `select (count(*) = 0)::text as w from pg_trigger t
          where t.tgrelid = to_regclass('public.skylanders')
            and not t.tgisinternal and t.tgname = 'skylanders_sync_catalog_status'`);
      const checksFort = await w60(
        `select (count(*) = 0)::text as w from pg_constraint c
          where c.conrelid = to_regclass('public.skylanders')
            and c.contype = 'c' and c.conname like '%catalog_status%'`);
      const ruempfeRein = await w60(
        `select (count(*) = 0)::text as w from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in ('log_skylander_editorial_change', 'admin_create_figure')
            and p.prosrc like '%catalog_status%'`);
      const zeilenNachher = await w60("select count(*)::text as w from public.skylanders");
      sag60("R0152",
            fR === null && spalteFort === "true" && triggerFort === "true"
            && checksFort === "true" && ruempfeRein === "true"
            && zeilenVorher === zeilenNachher,
            `durch ${fR ?? "ok"} · Spalte fort ${spalteFort} · Trigger fort ${triggerFort}`
            + ` · CHECKs fort ${checksFort} · Ruempfe sauber ${ruempfeRein}`
            + ` · Zeilen ${zeilenVorher} → ${zeilenNachher}`);

      /* UND DANACH LEGT DER EDITOR WIEDER EIN VERSTECKTES OBJEKT AN, keinen
         Entwurf — das war der Zustand vor `0152`, und die Rücknahme muss ihn
         wirklich herstellen, nicht nur die Spalte entfernen. */
      const nachR = await w60(
        `select public.admin_create_figure('Nach der Ruecknahme', 'SA',
                  (select id from public.categories limit 1)) as w`);
      const sichtNachR = nachR.startsWith("SKY-")
        ? await w60(`select catalog_visible::text as w from public.skylanders
                      where sky_id = '${nachR}'`)
        : "?";
      sag60("nach R0152 legt der Editor wieder versteckt an", sichtNachR === "false",
            `${nachR} → catalog_visible ${sichtNachR}`);
    }

    probe.push({
      name: "P60 0152 leitet den Status in jedem Schreibweg richtig ab: die acht genannten Faelle, "
        + "die Legacy-Pfade, der Import-Upsert, der Einspielweg einer Wiederherstellung, "
        + "zwei kontrollierte Abweisungen, das Journal, "
        + "eine neu angelegte Figur als Entwurf — und R0152 nimmt alles zurueck, "
        + "ohne eine Zeile anzufassen",
      ok: ok60,
      sagt: `0152: ${befund60.join(" · ")}`,
    });
  }

  /* ========================================================================
   * P61 — die ERZEUGTE Einfuege-Huelle aus CAT-04A, wirklich gefahren.
   *
   * WARUM SIE EINEN PROBELAUF BRAUCHT. Jede Migration dieses Projekts wird
   * geplant und probegefahren, bevor jemand sie einfuegt. Die Huelle aus
   * `cat03:import:staging -- --sql` ist genauso eine Datei, die im
   * SQL-Editor landet — nur dass sie ERZEUGT wird und deshalb bisher von
   * niemandem geprueft wurde. Ein Tippfehler im Generator faellt sonst erst
   * dem Bediener auf, und zwar an der Produktionsdatenbank-Oberflaeche.
   *
   * SIE PRUEFT VIER ZUSAGEN, und jede ist eine, die der Laufzettel macht:
   * fuenf Zeilen als Entwurf, keine davon sichtbar, der zweite Lauf legt
   * nichts an, und der Sequenzwaechter A4 schlaegt an, wenn `sky_id_seq`
   * hinter der hoechsten SKY-ID steht.
   * ===================================================================== */
  {
    /* SEIT CAT-04E gibt es EINE Huelle fuer den einmaligen Lauf. */
    const HUELLE_04A = "supabase/operations/staging-cat03-import.sql";
    const befund61: string[] = [];
    let ok61 = true;
    const sag61 = (was: string, gut: boolean, text: string): boolean => {
      befund61.push(`${gut ? "" : "!! "}${was}: ${text}`);
      if (!gut) ok61 = false;
      return gut;
    };

    if (!existsSync(HUELLE_04A)) {
      sag61("Huelle", false, `${HUELLE_04A} fehlt — zuerst cat03:import:staging -- --sql`);
    } else {
      /** Die Welt, auf die die Huelle trifft. */
      const welt = async (): Promise<InstanceType<typeof PGlite>> => {
        /* `frischNach0136()` statt `frisch()`: die Spalte `item_type` kommt
           aus `0135`, und die Huelle nennt sie. Dieselbe Welt wie P22. */
        const db = await frischNach0136();
        await serienUndIdentitaet(db);
        /*
         * DIE KATEGORIEN WERDEN AUS DER HUELLE GELESEN, nicht getippt.
         *
         * Sie nennt je Zeile eine `category_id`, weil die auf Staging so
         * heisst. Welche das sind, aendert sich mit der Charge — eine feste
         * Liste hier waere beim naechsten Lauf falsch, ohne dass es
         * auffiele. Also: aus der Datei ziehen, mit genau diesen ids
         * anlegen, und die Serie aus derselben Zeile nehmen.
         */
        const werte = huelleText.slice(huelleText.indexOf("select * from (values"),
                                       huelleText.indexOf(") as t(name, series_code"));
        const kat = new Map<string, string>();
        for (const m of werte.matchAll(/^\s*\('(?:[^']|'')*',\s*'([A-Z]+)',\s*(\d+),/gm)) {
          kat.set(m[2], m[1]);
        }
        if (kat.size === 0) throw new Error("P61: keine Kategorien in der Huelle gefunden");
        const zeilen = [...kat].map(([id, serie]) =>
          `(${id}, '${serie}', 'Kategorie ${id}', 1)`).join(", ");
        await db.exec(`insert into public.categories (id, series_code, name, position)
                       values ${zeilen};`);
        /*
         * DER UMGEBUNGSSTEMPEL, den ABBRUCH A1 verlangt — aber NUR, wenn er
         * fehlt. Die Welt dieses Werkzeugs traegt SKY-0821 und SKY-0822
         * bereits, und weil das Stub-Schema keinen Primaerschluessel setzt,
         * legte ein blindes `insert` sie ein ZWEITES Mal an. A1 zaehlt dann
         * vier statt zwei und bricht ab — ein Befund ueber den Probelauf und
         * keiner ueber die Huelle.
         */
        for (const id of ["SKY-0821", "SKY-0822"]) {
          await db.exec(`insert into public.skylanders
            (sky_id, name, slug, series_code, category_id, is_active, catalog_visible)
            select '${id}', '${id}', '${id.toLowerCase()}', 'SA', 10, true, true
             where not exists (select 1 from public.skylanders where sky_id = '${id}');`);
        }
        /*
         * VIERTER WERKZEUGBEFUND. Das Stub-Schema legt Sequenzen zwar an,
         * aber ohne Startwert — `sky_id_seq` beginnt dort bei 1 statt bei
         * 821 (`0033`). Der erste Zug liefere sonst SKY-0001, und das waere
         * ein Befund ueber den Stub und keiner ueber die Huelle. Sie wird
         * deshalb auf den Stand gesetzt, den die echte Datenbank hat: hinter
         * der hoechsten vergebenen ID.
         */
        await db.exec("select setval('public.sky_id_seq', 822);");
        /*
         * UND DER SCHLUESSEL AUF `catalog_editorial`. In der Wirklichkeit ist
         * `sky_id` dort Primaerschluessel (`0004`); das Stub-Schema
         * beschreibt Spalten, aber keine Schluessel, und das
         * `on conflict (sky_id)` der Huelle scheitert deshalb mit `42P10` —
         * derselbe Werkzeugbefund wie beim Katalogimport in P60.
         */
        await db.exec(`create unique index if not exists z_ce_sky_uniq
                         on public.catalog_editorial (sky_id);`);
        return db;
      };

      const huelleText = readFileSync(HUELLE_04A, "utf8");
      /* Wie viele Zeilen die Huelle traegt, sagt sie selbst im Kopf. */
      const erwartet = Number(/(\d+) Katalogentwuerfe anlegen/.exec(huelleText)?.[1] ?? "0");
      const db = await welt();
      const w61 = async (sql: string): Promise<string> =>
        String(((await db.query(sql)) as { rows: Record<string, unknown>[] }).rows[0]?.w ?? "?");

      /*
       * `0152` WIRD HIER NICHT GEFAHREN, und das ist kein Auslassen.
       *
       * FUENFTER WERKZEUGBEFUND: das Stub-Schema wird aus ALLEN Migrationen
       * gebaut, `0152` eingeschlossen — `catalog_status` steht in dieser Welt
       * also schon, und ein Lauf von `0152` scheitert mit `42701`. Geprueft
       * wird deshalb, dass die Spalte DA ist; dass `0152` sie richtig anlegt,
       * fuehrt P60 an einer eigens zurueckgebauten Welt vor.
       *
       * DER TRIGGER FEHLT HIER (das Stub traegt keine Trigger), und genau
       * deshalb ist dieser Lauf ein schaerferer Test der Huelle als die
       * Wirklichkeit: sie muss `catalog_status` und `catalog_visible` SELBST
       * widerspruchsfrei schreiben, ohne dass ein Trigger nachbessert.
       */
      const spalteDa = await w61(
        `select (count(*) = 1)::text as w from pg_attribute a
          where a.attrelid = to_regclass('public.skylanders')
            and a.attname = 'catalog_status' and not a.attisdropped`);
      const stempel = await w61(
        `select count(*)::text as w from public.skylanders
          where sky_id in ('SKY-0821', 'SKY-0822')`);
      const start = await w61("select count(*)::text as w from public.skylanders");
      sag61("Welt steht", spalteDa === "true" && stempel === "2",
            `catalog_status ${spalteDa} · Stempel ${stempel} · Zeilen ${start}`);

      /* ERSTER LAUF. Die Huelle bringt ihre eigene Klammer mit. */
      const f1 = await fahre(db, HUELLE_04A, { klammer: false });
      const angelegt = await w61(
        `select count(*)::text as w from public.skylanders where source = 'admin'
          and catalog_status = 'draft'`);
      const sichtbar = await w61(
        `select count(*)::text as w from public.skylanders
          where catalog_status = 'draft' and catalog_visible`);
      sag61("erster Lauf legt alle Entwuerfe an",
            f1 === null && angelegt === String(erwartet) && sichtbar === "0",
            `${f1 ?? "durch"} · Entwuerfe ${angelegt}/${erwartet} · davon sichtbar ${sichtbar}`);

      /* DIE IDENTITAETEN: aus der Sequenz, nicht aus einem Namen. */
      const ids = await w61(
        `select string_agg(sky_id, ',' order by sky_id) as w from public.skylanders
          where catalog_status = 'draft'`);
      const slugs = await w61(
        `select string_agg(slug, ',' order by slug) as w from public.skylanders
          where catalog_status = 'draft'`);
      /* KEINE ERWARTUNG AUF FORTLAUFENDE IDs — nur darauf, dass sie aus der
         Sequenz stammen und das Format halten. */
      const idListe = ids.split(",");
      sag61("SKY-IDs aus sky_id_seq, Slugs aus next_figure_slug",
            idListe.length === erwartet
            && idListe.every((x) => /^SKY-0[89]\d{2}$/.test(x))
            && slugs.includes("crystal-clear-cynder"),
            `${idListe.length} IDs, ${idListe[0]}…${idListe[idListe.length - 1]} · `
            + `${slugs.slice(0, 40)}`);

      /* DIE NOTIZ traegt die Herkunft, und sie steht NICHT auf skylanders. */
      const notiz = await w61(
        `select count(*)::text as w from public.catalog_editorial
          where admin_note like 'CAT-01 Kandidat%'`);
      const mitBild = await w61(
        `select count(*)::text as w from public.catalog_editorial
          where admin_note like '%Zugeordnetes Bild:%'`);
      const journal = await w61(
        `select count(*)::text as w from public.catalog_admin_changes
          where field = 'created'`);
      sag61("Herkunft in der internen Notiz, Journal geschrieben",
            notiz === String(erwartet) && journal === String(erwartet),
            `Notizen ${notiz} · Journalzeilen ${journal} · davon mit Bildzuordnung ${mitBild}`);

      /* ZWEITER LAUF: idempotent, und er verbraucht keine SKY-ID. */
      const start7 = await w61("select count(*)::text as w from public.skylanders");
      const vorher = await w61("select last_value::text as w from public.sky_id_seq");
      const f2 = await fahre(db, HUELLE_04A, { klammer: false });
      const nachher = await w61("select last_value::text as w from public.sky_id_seq");
      const zeilen = await w61("select count(*)::text as w from public.skylanders");
      sag61("zweiter Lauf legt nichts an und zieht keine ID",
            f2 === null && vorher === nachher && zeilen === start7,
            `${f2 ?? "durch"} · Sequenz ${vorher} → ${nachher} · Zeilen ${zeilen} (erwartet ${start7})`);

      /*
       * UND DER SEQUENZWAECHTER. Er ist der Grund, warum es ihn gibt: steht
       * `sky_id_seq` hinter der hoechsten vergebenen ID, wuerde der Lauf
       * mitten in der Schleife einen Primaerschluessel verletzen.
       */
      await db.exec("select setval('public.sky_id_seq', 822);");
      const f3 = await fahre(db, HUELLE_04A, { klammer: false });
      const nochZeilen = await w61("select count(*)::text as w from public.skylanders");
      sag61("A4 faengt eine zurueckliegende Sequenz ab",
            f3 !== null && f3.includes("A4") && nochZeilen === start7,
            `${f3 ?? "durchgelaufen (falsch)"} · Zeilen unveraendert ${nochZeilen}`);
    }

    probe.push({
      name: "P61 die erzeugte Einfuege-Huelle des einmaligen Katalogimports laeuft: alle "
        + "Entwuerfe angelegt, keiner sichtbar, IDs aus der Sequenz (nicht fortlaufend "
        + "erwartet), Herkunft in der internen Notiz, zweiter Lauf folgenlos — und der "
        + "Sequenzwaechter greift",
      ok: ok61,
      sagt: `Katalogimport: ${befund61.join(" · ")}`,
    });
  }

  /* ========================================================================
   * P62 — 0154: einen Entwurf mit einer bestehenden Figur zusammenfuehren.
   *
   * DIE EINE ZUSAGE, AN DER ALLES HAENGT: die bestehende SKY-ID bleibt. An
   * ihr haengen Sammlungen, Favoriten, Lager, Angebote und Bestellungen —
   * eine Zusammenfuehrung, die sie verschiebt, ist Datenverlust mit einem
   * freundlichen Namen. Dieser Durchgang fuehrt sie wirklich aus und sieht
   * danach nach, was steht.
   * ===================================================================== */
  {
    const befund62: string[] = [];
    let ok62 = true;
    const sag62 = (was: string, gut: boolean, text: string): void => {
      befund62.push(`${gut ? "" : "!! "}${was}: ${text}`);
      if (!gut) ok62 = false;
    };

    const db = await frischNach0136();
    await serienUndIdentitaet(db);
    const w62 = async (sql: string): Promise<string> =>
      String(((await db.query(sql)) as { rows: Record<string, unknown>[] }).rows[0]?.w ?? "?");
    const tu62 = async (sql: string): Promise<string | null> => {
      try { await db.exec(sql); return null; }
      catch (e) { return ((e as { message?: string }).message ?? "FEHLER").slice(0, 110); }
    };

    await db.exec(`insert into public.categories (id, series_code, name, position)
                   values (10, 'SA', 'Figuren', 1), (11, 'G', 'Giants', 1);`);
    await db.exec(`create unique index if not exists z_ce2_uniq
                     on public.catalog_editorial (sky_id);`);
    /*
     * SECHSTER WERKZEUGBEFUND, und ohne ihn prueft dieser Durchgang nichts.
     *
     * `admin_merge_references()` leitet die verweisenden Tabellen aus
     * `pg_constraint` her — das ist ihre Staerke, denn eine getippte Liste
     * veraltet. Das Stub-Schema traegt aber KEINE Fremdschluessel: die
     * Herleitung findet dort nichts, der Waechter greift nie, und der
     * Durchgang waere gruen, ohne die Zusage geprueft zu haben. Genau so ist
     * es beim ersten Lauf passiert.
     *
     * Zwei Schluessel werden deshalb nachgezogen — einer, der blockieren
     * MUSS (`collection_items`), und einer, der ausdruecklich NICHT zaehlt
     * (`catalog_editorial`, die eigene Notiz des Entwurfs).
     */
    await db.exec(`create unique index if not exists z_sky2_uniq
                     on public.skylanders (sky_id);`);
    await db.exec(`alter table public.collection_items
                     add constraint z_ci_sky_fk foreign key (sky_id)
                     references public.skylanders (sky_id);`);
    await db.exec(`alter table public.catalog_editorial
                     add constraint z_ce_sky_fk foreign key (sky_id)
                     references public.skylanders (sky_id);`);
    /* Das Stub-Schema traegt keine Trigger; der Admincheck wird gestellt. */
    await db.exec(`create or replace function public.is_platform_admin() returns boolean
                   language sql as $stub$ select true $stub$;`);

    const f154 = await fahre(db, "supabase/migrations/0154_merge_draft_into_figure.sql");
    sag62("0154 laeuft", f154 === null, f154 ?? "durch");

    const anlegen = async (id: string, name: string, status: string, extra = "") =>
      db.exec(`insert into public.skylanders
                 (sky_id, name, slug, series_code, category_id, item_type, card_type,
                  is_active, catalog_visible, catalog_status, source${extra ? ", " + extra.split("=")[0] : ""})
               values ('${id}', '${name}', '${id.toLowerCase()}', 'SA', 10, 'figure',
                  'standard', true, ${status === "public"}, '${status}', 'admin'${extra ? ", " + extra.split("=")[1] : ""});`);

    /* Ziel: eine oeffentliche Figur mit Preis und Bild. Entwurf: der Import. */
    await anlegen("SKY-0100", "Mystery Chest Bronze", "public");
    await db.exec(`update public.skylanders set market_price = 9.99,
                     image_file = 'aaaaaaaaaaaaaaaa.webp' where sky_id = 'SKY-0100';`);
    await anlegen("SKY-0900", "Bronze Mystery Chest", "draft");
    await db.exec(`update public.skylanders set card_type = 'chase',
                     image_override_path = 'SKY-0900/bbbbbbbbbbbbbbbb.png'
                   where sky_id = 'SKY-0900';`);
    await db.exec(`insert into public.catalog_editorial (sky_id, admin_note, updated_at)
                   values ('SKY-0900', 'CAT-01 Kandidat', now());`);

    /* ---- Abweisungen zuerst: sie duerfen NICHTS hinterlassen. */
    const fSelbst = await tu62("select public.admin_merge_draft('SKY-0900','SKY-0900');");
    const fZielEntwurf = await tu62("select public.admin_merge_draft('SKY-0100','SKY-0900');");
    const fFehlt = await tu62("select public.admin_merge_draft('SKY-7777','SKY-0100');");
    sag62("drei kontrollierte Abweisungen",
          [fSelbst, fZielEntwurf, fFehlt].every((x) => x !== null),
          [fSelbst, fZielEntwurf, fFehlt].map((x) => (x ?? "DURCHGELAUFEN").slice(0, 36)).join(" | "));

    /* ---- Eine Referenz auf den Entwurf blockiert. */
    await db.exec(`insert into public.collection_items (user_id, sky_id, quantity)
                   values ('00000000-0000-0000-0000-000000000001', 'SKY-0900', 1);`);
    const fRef = await tu62("select public.admin_merge_draft('SKY-0900','SKY-0100');");
    const nochDa = await w62("select count(*)::text as w from public.skylanders where sky_id = 'SKY-0900'");
    sag62("eine Referenz blockiert und laesst den Entwurf stehen",
          fRef !== null && fRef.includes("zeigen noch Daten") && nochDa === "1",
          `${(fRef ?? "DURCHGELAUFEN").slice(0, 60)} · Entwurf steht ${nochDa}`);

    await db.exec("delete from public.collection_items where sky_id = 'SKY-0900';");

    /*
     * ---- UND NUN DER GUTE FALL, mit den beiden Platzhalterregeln.
     *
     * Das Ziel traegt eine ECHTE Notiz und einen GENERISCHEN `item_type`;
     * der Entwurf einen spezifischen `card_type`, einen generischen
     * `item_type` und eine Herkunftsnotiz. Erwartet:
     *   name            geht ueber          (der Entwurf hat einen)
     *   card_type       geht ueber          (chase schlaegt standard)
     *   item_type       bleibt              (figure gegen figure, kein Zuwachs)
     *   image           geht ueber          (der Entwurf hat eines)
     *   admin_note      wird ANGEHAENGT     (beide bleiben lesbar)
     */
    await db.exec(`insert into public.catalog_editorial (sky_id, admin_note, updated_at)
                   values ('SKY-0100', 'vom Admin gepflegt', now());`);
    /* MIT BILDPFAD: er muss der ZIELFIGUR gehoeren. Der Aufrufer hat das
       Objekt vorher dorthin kopiert; die Funktion prueft nur. */
    const fFremd = await tu62(`select public.admin_merge_draft('SKY-0900','SKY-0100',
                                 'SKY-0900/bbbbbbbbbbbbbbbb.png');`);
    sag62("ein fremder Bildpfad wird abgewiesen",
          fFremd !== null && fFremd.includes("gehoert nicht zu"),
          (fFremd ?? "DURCHGELAUFEN").slice(0, 56));

    const fGut = await tu62(`select public.admin_merge_draft('SKY-0900','SKY-0100',
                               'SKY-0100/bbbbbbbbbbbbbbbb.png');`);
    const ziel = await w62(`select sky_id || '|' || name || '|' || card_type || '|'
                              || coalesce(image_override_path,'-') || '|' || catalog_status
                              || '|' || catalog_visible::text || '|' || coalesce(market_price::text,'-')
                              || '|' || coalesce(image_file,'-') || '|' || slug as w
                            from public.skylanders where sky_id = 'SKY-0100'`);
    const entwurfFort = await w62("select (count(*) = 0)::text as w from public.skylanders where sky_id = 'SKY-0900'");
    const notizFort = await w62("select (count(*) = 0)::text as w from public.catalog_editorial where sky_id = 'SKY-0900'");
    const notizZiel = await w62("select coalesce(max(admin_note),'-') as w from public.catalog_editorial where sky_id = 'SKY-0100'");
    sag62("zusammengefuehrt: die SKY-ID des Ziels bleibt, Status/Preis/Slug unberuehrt",
          fGut === null
          && ziel === "SKY-0100|Bronze Mystery Chest|chase|SKY-0100/bbbbbbbbbbbbbbbb.png|public|true|9.99|aaaaaaaaaaaaaaaa.webp|sky-0100"
          && entwurfFort === "true" && notizFort === "true",
          `${fGut ?? "durch"} · ${ziel} · Entwurf fort ${entwurfFort}`);
    sag62("die Notiz wird ANGEHAENGT, nicht ersetzt",
          notizZiel.includes("vom Admin gepflegt") && notizZiel.includes("CAT-01 Kandidat"),
          notizZiel.replace(/\n/g, " ⏎ "));

    /*
     * ---- DER PLATZHALTERFALL, und er ist der eigentliche Zuwachs dieser
     * Fassung: ein generisches `standard` darf ein spezifisches `chase`
     * NICHT ersetzen. Sonst machte jeder der 51 Entwuerfe mit unsicherer
     * Edition aus einer belegten Angabe wieder einen Vorgabewert.
     */
    await anlegen("SKY-0901", "Noch ein Entwurf", "draft");
    const fPlatz = await tu62("select public.admin_merge_draft('SKY-0901','SKY-0100');");
    const nachPlatz = await w62(`select card_type || '|' || name as w
                                 from public.skylanders where sky_id = 'SKY-0100'`);
    sag62("ein generisches standard ersetzt kein spezifisches chase",
          fPlatz === null && nachPlatz.startsWith("chase|"),
          `${fPlatz ?? "durch"} · ${nachPlatz}`);

    const journal = await w62(`select coalesce(string_agg(field, ',' order by field),'-') as w
                               from public.catalog_admin_changes where entity_id = 'SKY-0100'`);
    sag62("der Vorgang steht im Journal", journal.includes("merged_from"), journal);

    /* ====================================================================
     * 0155 — denselben Entwurf stattdessen VERWERFEN.
     *
     * Drei Riegel, und jeder einzeln geprueft: nur Entwuerfe, nur
     * `source = admin`, und nichts darf auf die Zeile zeigen. Der letzte
     * benutzt dieselbe Zaehlung wie die Zusammenfuehrung — es soll sie
     * genau einmal geben.
     * ================================================================= */
    const f155 = await fahre(db, "supabase/migrations/0155_discard_draft.sql");
    sag62("0155 laeuft", f155 === null, f155 ?? "durch");

    /* Eine oeffentliche Figur wird nie geloescht. */
    const dOeff = await tu62("select public.admin_discard_draft('SKY-0100');");
    const oeffDa = await w62("select count(*)::text as w from public.skylanders where sky_id = 'SKY-0100'");
    sag62("eine oeffentliche Figur wird nicht geloescht",
          dOeff !== null && dOeff.includes("kein Entwurf") && oeffDa === "1",
          `${(dOeff ?? "DURCHGELAUFEN").slice(0, 50)} · steht noch ${oeffDa}`);

    /* Ein Entwurf aus dem Katalogimport ebenfalls nicht. */
    await anlegen("SKY-0902", "Importzeile", "draft");
    await db.exec("update public.skylanders set source = 'import' where sky_id = 'SKY-0902';");
    const dImport = await tu62("select public.admin_discard_draft('SKY-0902');");
    sag62("eine Importzeile wird nicht geloescht",
          dImport !== null && dImport.includes("source="),
          (dImport ?? "DURCHGELAUFEN").slice(0, 52));

    /* Eine Zeile mit Vergangenheit: war einmal oeffentlich, ist jetzt Entwurf. */
    await anlegen("SKY-0905", "War mal oeffentlich", "draft");
    await db.exec(`insert into public.catalog_admin_changes
                     (entity, entity_id, field, old_value, new_value, changed_by)
                   values ('skylander', 'SKY-0905', 'catalog_status', 'public', 'draft', null);`);
    const dFrueher = await tu62("select public.admin_discard_draft('SKY-0905');");
    const frueherDa = await w62("select count(*)::text as w from public.skylanders where sky_id = 'SKY-0905'");
    sag62("eine Zeile, die einmal oeffentlich stand, wird nicht geloescht",
          dFrueher !== null && dFrueher.includes("oeffentlich") && frueherDa === "1",
          `${(dFrueher ?? "DURCHGELAUFEN").slice(0, 50)} · steht noch ${frueherDa}`);

    /* Mit einer Referenz: abgewiesen, und die Zeile steht noch. */
    await anlegen("SKY-0903", "Mit Referenz", "draft");
    await db.exec(`insert into public.collection_items (user_id, sky_id, quantity)
                   values ('00000000-0000-0000-0000-000000000002', 'SKY-0903', 1);`);
    const dRef = await tu62("select public.admin_discard_draft('SKY-0903');");
    const refDa = await w62("select count(*)::text as w from public.skylanders where sky_id = 'SKY-0903'");
    sag62("eine Referenz blockiert auch das Verwerfen",
          dRef !== null && dRef.includes("zeigen noch Daten") && refDa === "1",
          `${(dRef ?? "DURCHGELAUFEN").slice(0, 48)} · steht noch ${refDa}`);

    /* Und der gute Fall: referenzfrei, mit Bild und Notiz. */
    await anlegen("SKY-0904", "Zu verwerfen", "draft");
    await db.exec(`update public.skylanders
                     set image_override_path = 'SKY-0904/cccccccccccccccc.png'
                   where sky_id = 'SKY-0904';`);
    await db.exec(`insert into public.catalog_editorial (sky_id, admin_note, updated_at)
                   values ('SKY-0904', 'CAT-01 Kandidat', now());`);
    const vorherZeilen = await w62("select count(*)::text as w from public.skylanders");
    const dGut = await w62("select public.admin_discard_draft('SKY-0904')::text as w");
    const fort = await w62("select (count(*) = 0)::text as w from public.skylanders where sky_id = 'SKY-0904'");
    const notizFort2 = await w62("select (count(*) = 0)::text as w from public.catalog_editorial where sky_id = 'SKY-0904'");
    const nachherZeilen = await w62("select count(*)::text as w from public.skylanders");
    const jDisc = await w62(`select coalesce(max(field),'-') as w from public.catalog_admin_changes
                             where entity_id = 'SKY-0904' and field = 'discarded'`);
    sag62("ein referenzfreier Entwurf wird geloescht, Journal bleibt, Bild wird benannt",
          fort === "true" && notizFort2 === "true" && jDisc === "discarded"
          && dGut.includes("cccccccccccccccc.png")
          && Number(nachherZeilen) === Number(vorherZeilen) - 1,
          `fort ${fort} · Journal ${jDisc} · Zeilen ${vorherZeilen}→${nachherZeilen} `
          + `· verwaistes Bild genannt ${dGut.includes("orphaned_image")}`);

    probe.push({
      name: "P62 0154 und 0155: zusammenfuehren nach der einfachen Regel (was der Entwurf "
        + "hat, geht ueber; ein Platzhalter ersetzt keine Angabe; die Notiz wird angehaengt), "
        + "die SKY-ID des Ziels bleibt samt Status, Preis und Slug — und verwerfen scheitert "
        + "an jedem der drei Riegel, raeumt sonst Zeile und Notiz weg und nennt das "
        + "verwaiste Bild",
      ok: ok62,
      sagt: `0154: ${befund62.join(" · ")}`,
    });
  }

  /* ========================================================================
   * P63 — 0156: die Zusammenfuehrung uebernimmt nur die AUSGEWAEHLTEN Felder.
   *
   * WAS HIER WIRKLICH GEPRUEFT WIRD. Nicht, dass ein Kaestchen angezeigt
   * wird — das sieht man. Sondern dass die Auswahl die SCHREIBENDE Seite
   * bestimmt: dass ein abgewaehltes Feld seinen alten Wert behaelt, dass ein
   * Feld ausserhalb der Allowlist abgewiesen wird, bevor etwas geschrieben
   * ist, und dass eine veraltete Vorschau zum Abbruch fuehrt und nicht zu
   * einem stillen Fremdwert.
   *
   * UND DASS DIE ALTE FASSUNG WEITERLAEUFT. `admin_merge_draft(text,text,text)`
   * aus `0154` bleibt die Abwaertskompatibilitaet; sie leitet jetzt weiter,
   * damit es die Uebernahmelogik genau einmal gibt.
   * ===================================================================== */
  {
    const befund63: string[] = [];
    let ok63 = true;
    const sag63 = (was: string, gut: boolean, text: string): void => {
      befund63.push(`${gut ? "" : "!! "}${was}: ${text}`);
      if (!gut) ok63 = false;
    };

    const db = await frischNach0136();
    await serienUndIdentitaet(db);
    const w63 = async (sql: string): Promise<string> =>
      String(((await db.query(sql)) as { rows: Record<string, unknown>[] }).rows[0]?.w ?? "?");
    const tu63 = async (sql: string): Promise<string | null> => {
      try { await db.exec(sql); return null; }
      catch (e) { return ((e as { message?: string }).message ?? "FEHLER").slice(0, 130); }
    };

    await db.exec(`insert into public.categories (id, series_code, name, position)
                   values (10, 'SA', 'Figuren', 1), (11, 'G', 'Giants', 1);`);
    await db.exec(`create unique index if not exists z_ce3_uniq
                     on public.catalog_editorial (sky_id);`);
    await db.exec(`create unique index if not exists z_sky3_uniq
                     on public.skylanders (sky_id);`);
    /* Dieselben zwei Fremdschluessel wie in P62: das Stub-Schema traegt
       keine, und ohne sie prueft die Referenzzaehlung nichts. */
    await db.exec(`alter table public.collection_items
                     add constraint z_ci3_sky_fk foreign key (sky_id)
                     references public.skylanders (sky_id);`);
    await db.exec(`alter table public.catalog_editorial
                     add constraint z_ce3_sky_fk foreign key (sky_id)
                     references public.skylanders (sky_id);`);
    await db.exec(`create or replace function public.is_platform_admin() returns boolean
                   language sql as $stub$ select true $stub$;`);

    const f154b = await fahre(db, "supabase/migrations/0154_merge_draft_into_figure.sql");
    const f156 = await fahre(db, "supabase/migrations/0156_merge_selected_fields.sql");
    sag63("0154 und 0156 laufen in dieser Reihenfolge",
          f154b === null && f156 === null,
          `0154 ${f154b ?? "durch"} · 0156 ${f156 ?? "durch"}`);

    /*
     * 0156 OHNE 0154 MUSS ABBRECHEN — die Vorbedingung ist echt.
     *
     * SIEBTER WERKZEUGBEFUND, und ohne ihn prueft diese Zeile nichts. Das
     * Stub-Schema legt JEDE Signatur aus ALLEN Migrationen an, also auch
     * `admin_merge_draft(text,text,text)` aus `0154` — in einer frischen
     * Welt steht sie schon, bevor `0154` gelaufen ist. Die Vorbedingung von
     * `0156` fragt `to_regprocedure`, findet sie und liess den ersten Lauf
     * gruen durchgehen, ohne die Abhaengigkeit geprueft zu haben.
     *
     * Die beiden Fassungen werden deshalb erst weggenommen. Das ist der
     * Zustand, den eine Datenbank ohne `0154` wirklich hat.
     */
    {
      const leer = await frischNach0136();
      await serienUndIdentitaet(leer);
      await leer.exec(`create or replace function public.is_platform_admin() returns boolean
                       language sql as $stub$ select true $stub$;`);
      await leer.exec(`drop function if exists public.admin_merge_draft(text,text,text) cascade;
                       drop function if exists public.admin_merge_draft(text,text,text,jsonb) cascade;
                       drop function if exists public.admin_merge_references(text) cascade;`);
      const stehtNoch = String(((await leer.query(
        `select (to_regprocedure('public.admin_merge_draft(text,text,text)') is null)::text as w`,
      )) as { rows: Record<string, unknown>[] }).rows[0]?.w ?? "?");
      const nurs156 = await fahre(leer, "supabase/migrations/0156_merge_selected_fields.sql");
      sag63("0156 ohne 0154 bricht ab (die Vorbedingung ist echt)",
            stehtNoch === "true" && nurs156 !== null
            && nurs156.includes("0154 ist hier nicht angewendet"),
            `0154 wirklich abwesend ${stehtNoch} · ${(nurs156 ?? "DURCHGELAUFEN").slice(0, 56)}`);
    }

    const anlegen = async (id: string, name: string, status: string) =>
      db.exec(`insert into public.skylanders
                 (sky_id, name, slug, series_code, category_id, item_type, card_type,
                  is_active, catalog_visible, catalog_status, source)
               values ('${id}', '${name}', '${id.toLowerCase()}', 'SA', 10, 'figure',
                  'standard', true, ${status === "public"}, '${status}', 'admin');`);

    /*
     * DIE WELT: ein oeffentliches Ziel mit Bild, Preis, Notiz und Sammlung,
     * und Entwuerfe, die jeweils etwas anderes mitbringen.
     */
    await anlegen("SKY-0100", "Pirate Ship", "public");
    await db.exec(`update public.skylanders
                     set market_price = 9.99, card_type = 'chase',
                         image_override_path = 'SKY-0100/1111111111111111.webp'
                   where sky_id = 'SKY-0100';`);
    await db.exec(`insert into public.catalog_editorial (sky_id, admin_note, updated_at)
                   values ('SKY-0100', 'vom Admin gepflegt', now());`);
    /* EINE REFERENZ AUF DAS ZIEL. Sie muss die Zusammenfuehrung ueberleben —
       das ist der ganze Zweck, die bestehende SKY-ID zu behalten. */
    await db.exec(`insert into public.collection_items (user_id, sky_id, quantity)
                   values ('00000000-0000-0000-0000-000000000009', 'SKY-0100', 3);`);

    const neuerEntwurf = async (id: string) => {
      await anlegen(id, "Pirate Seas", "draft");
      await db.exec(`update public.skylanders
                       set series_code = 'G', category_id = 11, character_id = null,
                           image_override_path = '${id}/2222222222222222.webp'
                     where sky_id = '${id}';`);
      await db.exec(`insert into public.catalog_editorial (sky_id, admin_note, updated_at)
                     values ('${id}', 'CAT-01 Kandidat', now());`);
    };

    /* ---- DER PLAN. Rein lesend, und er ist die EINE Rechnung. */
    await neuerEntwurf("SKY-0900");
    const plan = await w63(`select public.admin_merge_plan('SKY-0900','SKY-0100',
                              'SKY-0100/2222222222222222.webp')::text as w`);
    const planFelder = await w63(`select coalesce(string_agg(e.wert ->> 'field', ','),'-') as w
                                  from jsonb_array_elements(
                                    public.admin_merge_plan('SKY-0900','SKY-0100',
                                      'SKY-0100/2222222222222222.webp')) as e(wert)`);
    sag63("der Plan nennt genau die anstehenden Felder, in fester Reihenfolge",
          planFelder === "name,series_code,category_id,image_override_path,admin_note",
          planFelder);
    sag63("der Plan ist rein lesend — das Ziel ist unberuehrt",
          (await w63("select name as w from public.skylanders where sky_id = 'SKY-0100'"))
            === "Pirate Ship",
          plan.slice(0, 40));

    /* ---- FALL 1: ALLE FELDER AUSGEWAEHLT. */
    const alle = `'{"name":{"old":"Pirate Ship","new":"Pirate Seas"},
                    "series_code":{"old":"SA","new":"G"},
                    "category_id":{"old":"10","new":"11"},
                    "image_override_path":{"old":"SKY-0100/1111111111111111.webp",
                                           "new":"SKY-0100/2222222222222222.webp"},
                    "admin_note":{"old":"vom Admin gepflegt",
                                  "new":"vom Admin gepflegt\\nCAT-01 Kandidat"}}'::jsonb`;
    const fAlle = await tu63(`select public.admin_merge_draft('SKY-0900','SKY-0100',
                                'SKY-0100/2222222222222222.webp', ${alle});`);
    const nachAlle = await w63(`select name || '|' || series_code || '|' || category_id::text
                                  || '|' || coalesce(image_override_path,'-') || '|' || card_type
                                  || '|' || catalog_status || '|' || coalesce(market_price::text,'-')
                                  || '|' || slug as w
                                from public.skylanders where sky_id = 'SKY-0100'`);
    const sammlungDa = await w63(`select coalesce(max(quantity)::text,'-') as w
                                  from public.collection_items where sky_id = 'SKY-0100'`);
    sag63("alle Felder ausgewaehlt: alles geht ueber, Status/Preis/Slug/Edition bleiben",
          fAlle === null
          && nachAlle === "Pirate Seas|G|11|SKY-0100/2222222222222222.webp|chase|public|9.99|sky-0100",
          `${fAlle ?? "durch"} · ${nachAlle}`);
    sag63("die Referenz auf das Ziel ueberlebt",
          sammlungDa === "3", `Sammlung ${sammlungDa}`);

    /* ---- FALL 2: NUR NAME AUSGEWAEHLT. Alles andere behaelt seinen Wert. */
    await db.exec(`update public.skylanders set name = 'Pirate Ship', series_code = 'SA',
                     category_id = 10, image_override_path = 'SKY-0100/1111111111111111.webp'
                   where sky_id = 'SKY-0100';`);
    await db.exec(`update public.catalog_editorial set admin_note = 'vom Admin gepflegt'
                   where sky_id = 'SKY-0100';`);
    await neuerEntwurf("SKY-0901");
    const fNur = await tu63(`select public.admin_merge_draft('SKY-0901','SKY-0100', null,
                               '{"name":{"old":"Pirate Ship","new":"Pirate Seas"}}'::jsonb);`);
    const nachNur = await w63(`select name || '|' || series_code || '|' || category_id::text
                                 || '|' || coalesce(image_override_path,'-') as w
                               from public.skylanders where sky_id = 'SKY-0100'`);
    const notizNur = await w63(`select coalesce(max(admin_note),'-') as w
                                from public.catalog_editorial where sky_id = 'SKY-0100'`);
    const entwurfFort63 = await w63(`select (count(*) = 0)::text as w
                                     from public.skylanders where sky_id = 'SKY-0901'`);
    sag63("nur Name ausgewaehlt: Serie, Kategorie, Bild und Notiz bleiben unberuehrt",
          fNur === null
          && nachNur === "Pirate Seas|SA|10|SKY-0100/1111111111111111.webp"
          && notizNur === "vom Admin gepflegt"
          && entwurfFort63 === "true",
          `${fNur ?? "durch"} · ${nachNur} · Notiz "${notizNur}" · Entwurf fort ${entwurfFort63}`);

    /*
     * ---- FALL 2b: DER FALL DES BETREIBERS, Zeile fuer Zeile (CAT-05H).
     *
     * Am 2026-10-28 ist der erste echte Merge-Versuch fehlgeschlagen:
     * Entwurf „Pirate Seas" in die bestehende „Pirate Ship", nur der Name
     * ausgewaehlt, das Bild ABGEWAEHLT. Die Oberflaeche zeigte den
     * Auffangtext.
     *
     * Was FALL 2 nicht nachstellt und dieser Fall schon:
     *   * Das Ziel hat KEIN `image_override_path`, aber ein Bild aus dem
     *     Altimport (`image_file`). Genau so steht SKY-0103 da.
     *   * Der Entwurf hat ein `image_override_path` UND eine interne Notiz —
     *     der Plan nennt also mehr Felder, als ausgewaehlt sind.
     *   * Auf dem ZIEL haengen Verweise (Lager, Einkauf, Verkauf). Sie sind
     *     der Grund, warum die SKY-ID bleiben muss, und sie muessen den
     *     Vorgang ueberleben.
     */
    {
      await db.exec(`update public.skylanders
                       set name = 'Pirate Ship', image_override_path = null,
                           image_file = 'f6da37ded1e8fac4.webp'
                     where sky_id = 'SKY-0100';`);
      await db.exec(`update public.catalog_editorial set admin_note = 'vom Admin gepflegt'
                     where sky_id = 'SKY-0100';`);
      await neuerEntwurf("SKY-0910");
      /* Verweise auf das ZIEL — sie duerfen nicht verschwinden. */
      await db.exec(`insert into public.collection_items (user_id, sky_id, quantity)
                     values ('00000000-0000-0000-0000-00000000000a', 'SKY-0100', 2);`);

      const vorZiel = await w63(`select coalesce(image_override_path,'-') || '|'
                                   || coalesce(image_file,'-') || '|' || catalog_status
                                   || '|' || coalesce(market_price::text,'-') || '|' || slug as w
                                 from public.skylanders where sky_id = 'SKY-0100'`);
      /* Der Plan nennt mehr als der Bediener ausgewaehlt hat — das ist der
         Normalfall und darf nichts bewirken. */
      const planFelder2b = await w63(`select coalesce(string_agg(e.wert ->> 'field', ','),'-') as w
                                      from jsonb_array_elements(
                                        public.admin_merge_plan('SKY-0910','SKY-0100', null)) as e(wert)`);

      const f2b = await tu63(`select public.admin_merge_draft('SKY-0910','SKY-0100', null,
                                '{"name":{"old":"Pirate Ship","new":"Pirate Seas"}}'::jsonb);`);
      const nachZiel = await w63(`select coalesce(image_override_path,'-') || '|'
                                    || coalesce(image_file,'-') || '|' || catalog_status
                                    || '|' || coalesce(market_price::text,'-') || '|' || slug as w
                                  from public.skylanders where sky_id = 'SKY-0100'`);
      const nameNach = await w63(`select name as w from public.skylanders where sky_id = 'SKY-0100'`);
      const notizNach = await w63(`select coalesce(max(admin_note),'-') as w
                                   from public.catalog_editorial where sky_id = 'SKY-0100'`);
      const entwurfWeg = await w63(`select (count(*) = 0)::text as w
                                    from public.skylanders where sky_id = 'SKY-0910'`);
      /* GENAU DIESE Zeile, nicht „irgendeine" — FALL 1 hat auf derselben
         Zielfigur schon eine angelegt, und `max()` haette die gemessen. */
      const verweisDa = await w63(`select coalesce(max(quantity)::text,'-') as w
                                   from public.collection_items
                                  where sky_id = 'SKY-0100'
                                    and user_id = '00000000-0000-0000-0000-00000000000a'`);

      sag63("DER FALL DES BETREIBERS: nur Name, Bild abgewaehlt — der Name wandert, das "
            + "Altimportbild und das fehlende Override bleiben, die Notiz bleibt, der "
            + "Entwurf verschwindet, die Verweise auf das Ziel ueberleben",
            f2b === null
            && nameNach === "Pirate Seas"
            && nachZiel === vorZiel
            && notizNach === "vom Admin gepflegt"
            && entwurfWeg === "true"
            && verweisDa === "2",
            `${f2b ?? "durch"} · Plan nannte [${planFelder2b}], ausgewaehlt war nur name `
            + `· Name ${nameNach} · unveraendert ${nachZiel === vorZiel} (${nachZiel}) `
            + `· Notiz "${notizNach}" · Entwurf fort ${entwurfWeg} · Sammlung ${verweisDa}`);

      await db.exec(`delete from public.collection_items
                      where sky_id = 'SKY-0100'
                        and user_id = '00000000-0000-0000-0000-00000000000a';`);
    }

    /* ---- FALL 3: NUR BILD AUSGEWAEHLT.
     *
     * JEDER FALL SETZT SEINE VORAUSSETZUNG SELBST. Fall 2b laesst das Ziel
     * ohne `image_override_path` zurueck — das gehoert zu seinem Befund und
     * wird hier nicht stillschweigend vorausgesetzt, sondern gesetzt. Sonst
     * waere dieser Fall von der Reihenfolge der Faelle abhaengig, und das
     * ist genau die Art stiller Kopplung, die spaeter als Raetsel auftaucht.
     */
    await db.exec(`update public.skylanders
                     set name = 'Pirate Ship',
                         image_override_path = 'SKY-0100/1111111111111111.webp'
                   where sky_id = 'SKY-0100';`);
    await neuerEntwurf("SKY-0902");
    const fBild = await tu63(`select public.admin_merge_draft('SKY-0902','SKY-0100',
                                'SKY-0100/2222222222222222.webp',
                                '{"image_override_path":{"old":"SKY-0100/1111111111111111.webp",
                                  "new":"SKY-0100/2222222222222222.webp"}}'::jsonb);`);
    const nachBild = await w63(`select name || '|' || coalesce(image_override_path,'-') as w
                                from public.skylanders where sky_id = 'SKY-0100'`);
    sag63("nur Bild ausgewaehlt: der Name bleibt der alte",
          fBild === null && nachBild === "Pirate Ship|SKY-0100/2222222222222222.webp",
          `${fBild ?? "durch"} · ${nachBild}`);

    /* ---- FALL 4: BILD DEAKTIVIERT. Kein Pfad darf mitkommen, und das
     *      bisherige Bild bleibt stehen. Beide Richtungen sind ein Abbruch. */
    await neuerEntwurf("SKY-0903");
    const fPfadOhneWahl = await tu63(`select public.admin_merge_draft('SKY-0903','SKY-0100',
                                        'SKY-0100/2222222222222222.webp',
                                        '{"name":{"old":"Pirate Ship","new":"Pirate Seas"}}'::jsonb);`);
    const fWahlOhnePfad = await tu63(`select public.admin_merge_draft('SKY-0903','SKY-0100', null,
                                        '{"image_override_path":{"old":null,"new":"x"}}'::jsonb);`);
    sag63("Bild abgewaehlt: ein Pfad ohne Auswahl und eine Auswahl ohne Pfad brechen ab",
          fPfadOhneWahl !== null && fPfadOhneWahl.includes("nicht ausgewaehlt")
          && fWahlOhnePfad !== null && fWahlOhnePfad.includes("kein Bildpfad"),
          `${(fPfadOhneWahl ?? "DURCH").slice(0, 44)} | ${(fWahlOhnePfad ?? "DURCH").slice(0, 40)}`);

    /*
     * ---- FALL 4b: DERSELBE FALL, ABER AN DEN DATEN GEMESSEN.
     *
     * WARUM ES DIESEN DURCHGANG GIBT. Am 2026-10-28 hat die Nachkontrolle
     * von `0156` auf Staging an Zeile 115 abgewichen — die Zeile, die genau
     * diesen Riegel sucht. Die Ursache lag in der PRUEFDATEI (ein Muster
     * ueber zwei SQL-Literale), nicht in der Funktion; der Riegel stand und
     * wirkte. Dass der Riegel wirkt, war aber nur an einer FEHLERMELDUNG
     * belegt, und eine Meldung ist kein Nachweis ueber Daten: eine Funktion
     * koennte abbrechen und vorher doch geschrieben haben.
     *
     * Deshalb wird hier der Zustand VOR und NACH dem Fehlversuch gemessen:
     * die Zielfigur Zeichen fuer Zeichen, der Entwurf, seine Notiz und die
     * Zeilenzahl. Nichts davon darf sich bewegen.
     *
     * Vier Gestalten des Fehlers, und alle vier sind „Bilduebernahme ohne
     * gueltigen Zielbildpfad": kein Pfad, leerer Pfad, ein Pfad der
     * ZIELFIGUR eines anderen Eintrags, und ein formal falscher Pfad.
     */
    {
      const abdruck = async (): Promise<string> => w63(
        `select (select name || '|' || series_code || '|' || category_id::text
                   || '|' || coalesce(image_override_path,'-') || '|' || card_type
                   || '|' || catalog_status || '|' || catalog_visible::text
                   || '|' || coalesce(market_price::text,'-') || '|' || slug
                 from public.skylanders where sky_id = 'SKY-0100')
             || ' ## Entwurf ' || (select count(*)::text from public.skylanders
                                   where sky_id = 'SKY-0903')
             || ' ## Notiz ' || (select count(*)::text from public.catalog_editorial
                                  where sky_id = 'SKY-0903')
             || ' ## Zeilen ' || (select count(*)::text from public.skylanders) as w`);

      const vorher4b = await abdruck();
      const versuche: [string, string][] = [
        ["kein Pfad",
         `select public.admin_merge_draft('SKY-0903','SKY-0100', null,
            '{"image_override_path":{"old":"SKY-0100/1111111111111111.webp",
              "new":"SKY-0100/2222222222222222.webp"}}'::jsonb);`],
        ["leerer Pfad",
         `select public.admin_merge_draft('SKY-0903','SKY-0100', '   ',
            '{"image_override_path":{"old":"SKY-0100/1111111111111111.webp",
              "new":"SKY-0100/2222222222222222.webp"}}'::jsonb);`],
        ["fremde SKY-ID im Pfad",
         `select public.admin_merge_draft('SKY-0903','SKY-0100',
            'SKY-0903/2222222222222222.webp',
            '{"image_override_path":{"old":"SKY-0100/1111111111111111.webp",
              "new":"SKY-0903/2222222222222222.webp"}}'::jsonb);`],
        ["formal falscher Pfad",
         `select public.admin_merge_draft('SKY-0903','SKY-0100',
            'SKY-0100/nicht-hex.gif',
            '{"image_override_path":{"old":"SKY-0100/1111111111111111.webp",
              "new":"SKY-0100/nicht-hex.gif"}}'::jsonb);`],
      ];
      const meldungen: string[] = [];
      let alleAb = true;
      let allesStill = true;
      for (const [was, sql] of versuche) {
        const fehler = await tu63(sql);
        if (fehler === null) alleAb = false;
        meldungen.push(`${was}: ${(fehler ?? "DURCHGELAUFEN").slice(0, 30)}`);
        if ((await abdruck()) !== vorher4b) allesStill = false;
      }
      sag63("Bilduebernahme ohne gueltigen Zielbildpfad: vier Gestalten, vier Abbrueche "
            + "— und danach ist die Zielfigur Zeichen fuer Zeichen dieselbe, der Entwurf "
            + "steht noch, seine Notiz auch, die Zeilenzahl ist unveraendert",
            alleAb && allesStill,
            `${meldungen.join(" | ")} · Abdruck unveraendert ${allesStill} · ${vorher4b}`);
    }

    const fOhneBild = await tu63(`select public.admin_merge_draft('SKY-0903','SKY-0100', null,
                                    '{"name":{"old":"Pirate Ship","new":"Pirate Seas"}}'::jsonb);`);
    const bildGeblieben = await w63(`select coalesce(image_override_path,'-') as w
                                     from public.skylanders where sky_id = 'SKY-0100'`);
    sag63("und ohne Bild laeuft es durch, das bisherige Bild bleibt",
          fOhneBild === null && bildGeblieben === "SKY-0100/2222222222222222.webp",
          `${fOhneBild ?? "durch"} · ${bildGeblieben}`);

    /* ---- FALL 5: KEINE AENDERUNG AUSGEWAEHLT. Kein Grund, zu loeschen. */
    await db.exec("update public.skylanders set name = 'Pirate Ship' where sky_id = 'SKY-0100';");
    await neuerEntwurf("SKY-0904");
    const fLeer = await tu63(`select public.admin_merge_draft('SKY-0904','SKY-0100', null,
                                '{}'::jsonb);`);
    const leerDa = await w63(`select count(*)::text as w from public.skylanders
                              where sky_id = 'SKY-0904'`);
    sag63("leere Auswahl: Abbruch, und der Entwurf steht noch",
          fLeer !== null && fLeer.includes("kein Feld zur Übernahme") && leerDa === "1",
          `${(fLeer ?? "DURCHGELAUFEN").slice(0, 52)} · steht noch ${leerDa}`);

    /* ---- FALL 6: MANIPULIERTE FELDAUSWAHL. Vier Angriffe, vier Abbrueche,
     *      und in jedem Fall steht hinterher alles unveraendert da. */
    const vorAngriff = await w63(`select name || '|' || slug || '|' || catalog_status
                                    || '|' || coalesce(market_price::text,'-')
                                    || '|' || sky_id as w
                                  from public.skylanders where sky_id = 'SKY-0100'`);
    const aGeschuetzt = await tu63(`select public.admin_merge_draft('SKY-0904','SKY-0100', null,
                                      '{"market_price":{"old":"9.99","new":"0.01"}}'::jsonb);`);
    const aStatus = await tu63(`select public.admin_merge_draft('SKY-0904','SKY-0100', null,
                                  '{"catalog_status":{"old":"public","new":"draft"}}'::jsonb);`);
    const aSkyId = await tu63(`select public.admin_merge_draft('SKY-0904','SKY-0100', null,
                                 '{"sky_id":{"old":"SKY-0100","new":"SKY-0900"}}'::jsonb);`);
    const aKeinObjekt = await tu63(`select public.admin_merge_draft('SKY-0904','SKY-0100', null,
                                      '["name"]'::jsonb);`);
    const nachAngriff = await w63(`select name || '|' || slug || '|' || catalog_status
                                     || '|' || coalesce(market_price::text,'-')
                                     || '|' || sky_id as w
                                   from public.skylanders where sky_id = 'SKY-0100'`);
    sag63("manipulierte Auswahl: vier Abweisungen, und nichts hat sich bewegt",
          [aGeschuetzt, aStatus, aSkyId].every(
            (x) => x !== null && x.includes("kein uebernehmbares Feld"))
          && aKeinObjekt !== null && aKeinObjekt.includes("muss ein Objekt sein")
          && nachAngriff === vorAngriff,
          `${[aGeschuetzt, aStatus, aSkyId, aKeinObjekt]
              .map((x) => (x ?? "DURCH").slice(0, 28)).join(" | ")} · unveraendert `
          + `${nachAngriff === vorAngriff}`);

    /* ---- FALL 7: SERIE UND KATEGORIE HALB AUSGEWAEHLT. */
    const aHalb = await tu63(`select public.admin_merge_draft('SKY-0904','SKY-0100', null,
                                '{"series_code":{"old":"SA","new":"G"}}'::jsonb);`);
    sag63("Serie ohne Kategorie: Abbruch, ein zusammengesetzter Schluessel bleibt ganz",
          aHalb !== null && aHalb.includes("zusammengesetzter Fremdschluessel"),
          (aHalb ?? "DURCHGELAUFEN").slice(0, 56));

    /* ---- FALL 8: VERALTETE VORSCHAU. Drei Gestalten, und keine schreibt. */
    const sAlterWert = await tu63(`select public.admin_merge_draft('SKY-0904','SKY-0100', null,
                                     '{"name":{"old":"Irgendwas Anderes","new":"Pirate Seas"}}'::jsonb);`);
    const sNeuerWert = await tu63(`select public.admin_merge_draft('SKY-0904','SKY-0100', null,
                                     '{"name":{"old":"Pirate Ship","new":"Was ich will"}}'::jsonb);`);
    const sNichtImPlan = await tu63(`select public.admin_merge_draft('SKY-0904','SKY-0100', null,
                                       '{"card_type":{"old":"chase","new":"standard"}}'::jsonb);`);
    const nachStale = await w63(`select name || '|' || card_type as w
                                 from public.skylanders where sky_id = 'SKY-0100'`);
    sag63("veraltete Vorschau: anderer Ausgangswert, erfundener Zielwert und ein Feld "
          + "ohne Aenderung brechen alle ab",
          sAlterWert !== null && sAlterWert.includes("seit der Vorschau geaendert")
          && sNeuerWert !== null && sNeuerWert.includes("seit der Vorschau geaendert")
          && sNichtImPlan !== null && sNichtImPlan.includes("nicht (mehr) zur Uebernahme")
          && nachStale === "Pirate Ship|chase",
          `${(sAlterWert ?? "DURCH").slice(0, 30)} | ${(sNeuerWert ?? "DURCH").slice(0, 30)} | `
          + `${(sNichtImPlan ?? "DURCH").slice(0, 34)} · unveraendert ${nachStale}`);

    /* ---- FALL 9: DIE ALTE DREIPARAMETERFASSUNG. Sie muss weiterlaufen und
     *      alles uebernehmen — das ist die Abwaertskompatibilitaet. */
    const fAlt = await tu63(`select public.admin_merge_draft('SKY-0904','SKY-0100',
                               'SKY-0100/2222222222222222.webp');`);
    const nachAlt = await w63(`select name || '|' || series_code || '|' || category_id::text as w
                               from public.skylanders where sky_id = 'SKY-0100'`);
    sag63("die Dreiparameterfassung aus 0154 laeuft weiter und uebernimmt alles",
          fAlt === null && nachAlt === "Pirate Seas|G|11",
          `${fAlt ?? "durch"} · ${nachAlt}`);

    /* ---- FALL 10: Referenzen auf den ENTWURF blockieren weiterhin. */
    await neuerEntwurf("SKY-0905");
    await db.exec(`insert into public.collection_items (user_id, sky_id, quantity)
                   values ('00000000-0000-0000-0000-000000000008', 'SKY-0905', 1);`);
    const fRef63 = await tu63(`select public.admin_merge_draft('SKY-0905','SKY-0100', null,
                                 '{"name":{"old":"Pirate Seas","new":"Pirate Seas"}}'::jsonb);`);
    const refDa63 = await w63(`select count(*)::text as w from public.skylanders
                               where sky_id = 'SKY-0905'`);
    sag63("eine Referenz auf den Entwurf blockiert auch mit Auswahl",
          fRef63 !== null && fRef63.includes("zeigen noch Daten") && refDa63 === "1",
          `${(fRef63 ?? "DURCHGELAUFEN").slice(0, 44)} · steht noch ${refDa63}`);

    /* ---- Rechte und Attribute: wie 0154, und der Plan ist `stable`. */
    const rechte = await w63(`select coalesce(string_agg(p.proname || ':' || p.pronargs::text
                                || ':' || p.prosecdef::text || ':' || p.provolatile::text, ',' order by p.proname, p.pronargs),'-') as w
                              from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                              where n.nspname = 'public'
                                and p.proname in ('admin_merge_plan','admin_merge_draft')`);
    sag63("beide Fassungen und der Plan stehen, alle security definer",
          rechte.includes("admin_merge_draft:3:true")
          && rechte.includes("admin_merge_draft:4:true")
          && rechte.includes("admin_merge_plan:3:true:s"),
          rechte);

    /* ---- Das Journal nennt den Vorgang, mit der Zahl der Felder. */
    const j63 = await w63(`select coalesce(string_agg(new_value, ';' order by new_value),'-') as w
                           from public.catalog_admin_changes
                           where entity_id = 'SKY-0100' and field = 'merged_from'`);
    sag63("jeder Vorgang steht mit seiner Feldzahl im Journal",
          j63.includes("1 Feld(er)") && j63.includes("5 Feld(er)"), j63);

    probe.push({
      name: "P63 0156: die Auswahl entscheidet wirklich — alle Felder, nur der Name, nur das "
        + "Bild, Bild abgewaehlt, leere Auswahl, vier manipulierte Auswahlen, ein halber "
        + "Fremdschluessel und drei Gestalten einer veralteten Vorschau; die Referenz auf "
        + "das Ziel ueberlebt, die auf den Entwurf blockiert, und die Dreiparameterfassung "
        + "aus 0154 laeuft unveraendert weiter",
      ok: ok63,
      sagt: `0156: ${befund63.join(" · ")}`,
    });
  }

  /* ========================================================================
   * P64 — 0157: die echte Audit-Constraint, und die Notiz ohne Kaestchen.
   *
   * WARUM DIESER DURCHGANG EXISTIERT. Am 2026-10-28 scheiterte der erste
   * echte Merge mit `SQLSTATE 23514` an
   * `catalog_admin_changes_field_known` — die Constraint kennt sieben
   * `field`-Werte, und `merged_from` ist keiner davon. P62 und P63 waren
   * gruen, weil das Stub-Schema **keine CHECK-Constraints traegt**. Ein
   * Probelauf, der die eine Einschraenkung nicht hat, an der es scheitert,
   * prueft an der entscheidenden Stelle nichts.
   *
   * DESHALB LEGT DIESER DURCHGANG SIE WORTGETREU AN — den Wortlaut aus der
   * laufenden Staging-Datenbank gemessen (`cat05i_audit_constraint.sql`,
   * Zeile 403) — und faehrt dann drei Schritte:
   *
   *   1. VORHER: der Merge scheitert mit 23514, und zwar genau so wie beim
   *      Betreiber. Danach ist nachgemessen, dass NICHTS geschrieben wurde.
   *   2. `0157` laeuft.
   *   3. NACHHER: derselbe Merge geht durch, die Journalzeile steht, und die
   *      interne Notiz ist automatisch verarbeitet.
   * ===================================================================== */
  {
    const befund64: string[] = [];
    let ok64 = true;
    const sag64 = (was: string, gut: boolean, text: string): void => {
      befund64.push(`${gut ? "" : "!! "}${was}: ${text}`);
      if (!gut) ok64 = false;
    };

    const db = await frischNach0136();
    await serienUndIdentitaet(db);
    const w64 = async (sql: string): Promise<string> =>
      String(((await db.query(sql)) as { rows: Record<string, unknown>[] }).rows[0]?.w ?? "?");
    const tu64 = async (sql: string): Promise<string | null> => {
      try { await db.exec(sql); return null; }
      catch (e) {
        const f = e as { message?: string; code?: string };
        /* 180 ZEICHEN, NICHT 100. Der Name der Constraint steht am ENDE der
           Meldung („violates check constraint \"…\""), und genau auf ihn
           kommt es hier an — eine zu kurze Kuerzung hat die erste Fassung
           dieses Durchgangs scheitern lassen. */
        return `[${f.code ?? "?"}] ${(f.message ?? "FEHLER").slice(0, 180)}`;
      }
    };


    await db.exec(`insert into public.categories (id, series_code, name, position)
                   values (10, 'SA', 'Figuren', 1), (11, 'G', 'Giants', 1);`);
    await db.exec(`create unique index if not exists z_ce4_uniq
                     on public.catalog_editorial (sky_id);`);
    await db.exec(`create unique index if not exists z_sky4_uniq
                     on public.skylanders (sky_id);`);
    await db.exec(`alter table public.collection_items
                     add constraint z_ci4_sky_fk foreign key (sky_id)
                     references public.skylanders (sky_id);`);
    /* WIRKLICHKEITSTREU: auf Staging heisst er `ON UPDATE CASCADE ON DELETE
       CASCADE` (gemessen in `cat05i_audit_constraint.sql`, Zeile 202). Ohne
       das Kaskadieren verhielte sich die Probewelt strenger als die echte. */
    await db.exec(`alter table public.catalog_editorial
                     add constraint z_ce4_sky_fk foreign key (sky_id)
                     references public.skylanders (sky_id)
                     on update cascade on delete cascade;`);
    await db.exec(`create or replace function public.is_platform_admin() returns boolean
                   language sql as $stub$ select true $stub$;`);

    /*
     * ACHTER WERKZEUGBEFUND, und er hat einen echten Fehlschlag gekostet:
     * das Stub-Schema traegt KEINE CHECK-Constraints. Die hier wird
     * nachgezogen, wortgetreu wie auf Staging — sieben Werte, ohne
     * `catalog_status`, ohne `merged_from`, ohne `discarded`.
     */
    await db.exec(`alter table public.catalog_admin_changes
                     add constraint catalog_admin_changes_field_known
                     check (field in ('catalog_visible', 'display_name_override',
                                      'admin_note', 'catalog_group',
                                      'image_override_path', 'card_type', 'created'));`);
    const conDa = await w64(`select count(*)::text as w from pg_constraint
                             where conname = 'catalog_admin_changes_field_known'`);
    sag64("die echte Audit-Constraint steht in der Probewelt", conDa === "1",
          `Constraints ${conDa}`);

    for (const m of ["supabase/migrations/0154_merge_draft_into_figure.sql",
                     "supabase/migrations/0155_discard_draft.sql",
                     "supabase/migrations/0156_merge_selected_fields.sql"]) {
      const f = await fahre(db, m);
      if (f !== null) sag64(`Aufbau ${m.slice(21, 25)}`, false, f);
    }

    const anlegen = async (id: string, name: string, status: string) =>
      db.exec(`insert into public.skylanders
                 (sky_id, name, slug, series_code, category_id, item_type, card_type,
                  is_active, catalog_visible, catalog_status, source)
               values ('${id}', '${name}', '${id.toLowerCase()}', 'SA', 10, 'figure',
                  'standard', true, ${status === "public"}, '${status}', 'admin');`);

    /* Die Welt: der Fall des Betreibers, mit der echten Importnotiz. */
    const IMPORTNOTIZ = "CAT-01 Kandidat, Quelle B412 der externen Checkliste "
      + "(Trap Team). Kein Bild uebernommen; externe Bildrechte ungeklaert.";
    const HERKUNFT = "CAT-01 Kandidat, Quelle B412 der externen Checkliste (Trap Team).";

    await anlegen("SKY-0103", "Pirate Ship", "public");
    await db.exec(`update public.skylanders set market_price = 9.99,
                     image_file = 'f6da37ded1e8fac4.webp'
                   where sky_id = 'SKY-0103';`);
    await db.exec(`insert into public.collection_items (user_id, sky_id, quantity)
                   values ('00000000-0000-0000-0000-00000000000b', 'SKY-0103', 5);`);

    const neuerEntwurf64 = async (id: string, notiz: string | null) => {
      await anlegen(id, "Pirate Seas", "draft");
      await db.exec(`update public.skylanders
                       set image_override_path = '${id}/c478a8fcef4098d1.png'
                     where sky_id = '${id}';`);
      if (notiz !== null) {
        await db.exec(`insert into public.catalog_editorial (sky_id, admin_note, updated_at)
                       values ('${id}', ${notiz === "" ? "null" : `'${notiz}'`}, now());`);
      }
    };

    /* ================================================================
     * SCHRITT 1 — VORHER: der Fehler des Betreibers, reproduziert.
     * ============================================================= */
    await neuerEntwurf64("SKY-0824", IMPORTNOTIZ);
    const vorherAbdruck = await w64(
      `select (select name || '|' || coalesce(image_override_path,'-') from public.skylanders
                where sky_id = 'SKY-0103')
           || ' ## Entwurf ' || (select count(*)::text from public.skylanders
                                 where sky_id = 'SKY-0824')
           || ' ## Zeilen ' || (select count(*)::text from public.skylanders) as w`);
    const f23514 = await tu64(`select public.admin_merge_draft('SKY-0824','SKY-0103', null,
                                 '{"name":{"old":"Pirate Ship","new":"Pirate Seas"}}'::jsonb);`);
    const nachFehler = await w64(
      `select (select name || '|' || coalesce(image_override_path,'-') from public.skylanders
                where sky_id = 'SKY-0103')
           || ' ## Entwurf ' || (select count(*)::text from public.skylanders
                                 where sky_id = 'SKY-0824')
           || ' ## Zeilen ' || (select count(*)::text from public.skylanders) as w`);
    sag64("VORHER: der Merge scheitert mit 23514 an catalog_admin_changes_field_known, "
          + "und der ganze Vorgang ist zurueckgerollt",
          f23514 !== null && f23514.includes("23514")
          && f23514.includes("catalog_admin_changes_field_known")
          && nachFehler === vorherAbdruck,
          `${f23514 ?? "DURCHGELAUFEN"} · unveraendert ${nachFehler === vorherAbdruck} `
          + `(${nachFehler})`);

    /* Und derselbe Fehler trifft schon den Statuswechsel aus 0152 — das ist
       der zweite, bereits aktive Fall. */
    const fStatus = await tu64(`insert into public.catalog_admin_changes
                                  (entity, entity_id, field, old_value, new_value)
                                values ('skylander','SKY-0103','catalog_status','public','hidden');`);
    const fDiscard = await tu64(`insert into public.catalog_admin_changes
                                   (entity, entity_id, field, old_value, new_value)
                                 values ('skylander','SKY-0824','discarded','x',null);`);
    sag64("VORHER: catalog_status und discarded sind ebenso verboten — nicht nur der Merge "
          + "ist betroffen",
          fStatus !== null && fStatus.includes("23514")
          && fDiscard !== null && fDiscard.includes("23514"),
          `catalog_status ${(fStatus ?? "DURCH").slice(0, 24)} | discarded `
          + `${(fDiscard ?? "DURCH").slice(0, 24)}`);

    /* ================================================================
     * SCHRITT 2 — 0157.
     * ============================================================= */
    const f157 = await fahre(db, "supabase/migrations/0157_audit_fields_and_automatic_notes.sql");
    const conDef = await w64(`select pg_get_constraintdef(oid) as w from pg_constraint
                              where conname = 'catalog_admin_changes_field_known'`);
    sag64("0157 laeuft und die Constraint kennt jetzt zehn Werte — und keinen weniger",
          f157 === null
          && ["catalog_visible", "display_name_override", "admin_note", "catalog_group",
              "image_override_path", "card_type", "created",
              "catalog_status", "merged_from", "discarded"].every((v) => conDef.includes(v)),
          `${f157 ?? "durch"} · ${conDef.slice(0, 70)}…`);

    /* `merge_note()` ist rein — sie laesst sich einzeln pruefen. */
    const n1 = await w64(`select public.merge_note('vom Admin gepflegt', '${IMPORTNOTIZ}') as w`);
    const n2 = await w64(`select coalesce(public.merge_note(null, '${IMPORTNOTIZ}'),'(null)') as w`);
    const n3 = await w64(`select coalesce(public.merge_note('vom Admin', null),'(null)') as w`);
    const n4 = await w64(`select coalesce(public.merge_note('vom Admin', '   '),'(null)') as w`);
    const n5 = await w64(`select coalesce(public.merge_note(
                            'vom Admin' || chr(10) || '${HERKUNFT}', '${IMPORTNOTIZ}'),'(null)') as w`);
    const n6 = await w64(`select coalesce(public.merge_note('vom Admin',
                            'Kein Bild uebernommen; externe Bildrechte ungeklaert.'),'(null)') as w`);
    sag64("merge_note: der veraltete Bildhinweis faellt weg, die Herkunft bleibt",
          n1 === `vom Admin gepflegt\n${HERKUNFT}` && !n1.includes("ungeklaert"),
          n1.replace(/\n/g, " ⏎ "));
    sag64("merge_note: ohne Zielnotiz bleibt nur die Herkunft",
          n2 === HERKUNFT, n2);
    sag64("merge_note: ohne Entwurfsnotiz aendert sich nichts",
          n3 === "vom Admin", n3);
    sag64("merge_note: eine leere Entwurfsnotiz aendert nichts",
          n4 === "vom Admin", n4);
    sag64("merge_note: Doppeltes wird nicht doppelt angehaengt",
          n5 === `vom Admin\n${HERKUNFT}`, n5.replace(/\n/g, " ⏎ "));
    sag64("merge_note: bleibt nach dem Aufraeumen nichts, wird nichts angehaengt",
          n6 === "vom Admin", n6);

    /* ================================================================
     * SCHRITT 3 — NACHHER: derselbe Merge, derselbe Aufruf.
     * ============================================================= */
    const fGut = await tu64(`select public.admin_merge_draft('SKY-0824','SKY-0103', null,
                               '{"name":{"old":"Pirate Ship","new":"Pirate Seas"}}'::jsonb);`);
    const ziel = await w64(`select name || '|' || coalesce(image_override_path,'-') || '|'
                              || coalesce(image_file,'-') || '|' || catalog_status || '|'
                              || coalesce(market_price::text,'-') || '|' || slug as w
                            from public.skylanders where sky_id = 'SKY-0103'`);
    const notiz = await w64(`select coalesce(max(admin_note),'(keine)') as w
                             from public.catalog_editorial where sky_id = 'SKY-0103'`);
    const journal = await w64(`select coalesce(string_agg(field || '=' || coalesce(new_value,'-'),
                                                          ', ' order by field),'-') as w
                               from public.catalog_admin_changes where entity_id = 'SKY-0103'`);
    const entwurfFort = await w64(`select (count(*) = 0)::text as w from public.skylanders
                                   where sky_id = 'SKY-0824'`);
    const sammlung = await w64(`select coalesce(max(quantity)::text,'-') as w
                                from public.collection_items where sky_id = 'SKY-0103'`);
    sag64("NACHHER: derselbe Merge geht durch — Name uebernommen, Bild unberuehrt, "
          + "Journalzeile merged_from steht, Entwurf fort, Sammlung erhalten",
          fGut === null
          && ziel === "Pirate Seas|-|f6da37ded1e8fac4.webp|public|9.99|sky-0103"
          && journal.includes("merged_from=1 Feld(er)")
          && entwurfFort === "true" && sammlung === "5",
          `${fGut ?? "durch"} · ${ziel} · Journal [${journal}] · Entwurf fort `
          + `${entwurfFort} · Sammlung ${sammlung}`);
    sag64("NACHHER: die Notiz ist automatisch verarbeitet — Herkunft da, veralteter "
          + "Hinweis fort, und das ohne jedes Kaestchen",
          notiz === HERKUNFT && !notiz.includes("ungeklaert"),
          notiz);

    /*
     * ---- ALLE 105 ECHTEN IMPORTNOTIZEN, durch `merge_note()` gerechnet.
     *
     * Nicht ein erfundenes Beispiel, sondern der Bestand: die Notizen, die
     * der einmalige Katalogimport wirklich geschrieben hat, aus
     * `resources/analysis/cat-03-entwuerfe.json`. Die Zusage ist zweiteilig
     * und beides muss fuer JEDE der 105 gelten — der veraltete Hinweis ist
     * weg, UND die Herkunft ist noch da. Eine Regel, die aufraeumt und dabei
     * die Quelle verliert, waere schlimmer als keine.
     */
    {
      type Entwurf = { admin_note?: string | null };
      const roh = JSON.parse(
        readFileSync("resources/analysis/cat-03-entwuerfe.json", "utf8"),
      ) as Entwurf[] | { entwuerfe?: Entwurf[] };
      const liste = Array.isArray(roh) ? roh : (roh.entwuerfe ?? []);
      const notizen = liste.map((e) => e.admin_note ?? "").filter((n) => n.trim() !== "");

      let mitHinweis = 0;
      let sauber = 0;
      let herkunftErhalten = 0;
      let leerGeworden = 0;
      for (const n of notizen) {
        if (n.includes("Bildrechte ungeklaert")) mitHinweis += 1;
        const rest = await w64(
          `select coalesce(public.merge_note(null, $kl$${n}$kl$), '') as w`);
        if (!rest.includes("ungeklaert") && !rest.includes("Kein Bild")) sauber += 1;
        if (rest.includes("CAT-01 Kandidat") && rest.includes("Checkliste")) {
          herkunftErhalten += 1;
        }
        if (rest.trim() === "") leerGeworden += 1;
      }
      sag64("alle echten Importnotizen: der veraltete Hinweis faellt bei JEDER weg, "
            + "die Herkunft bleibt bei JEDER, und keine wird leer",
            notizen.length === 105 && mitHinweis === 105
            && sauber === 105 && herkunftErhalten === 105 && leerGeworden === 0,
            `${notizen.length} Notizen · ${mitHinweis} trugen den Hinweis · ${sauber} `
            + `danach sauber · ${herkunftErhalten} mit Herkunft · ${leerGeworden} leer`);
    }

    /* ---- Eine manipulierte Auswahl mit `admin_note` wird abgewiesen. */
    await neuerEntwurf64("SKY-0825", IMPORTNOTIZ);
    const fNote = await tu64(`select public.admin_merge_draft('SKY-0825','SKY-0103', null,
                                '{"admin_note":{"old":null,"new":"was ich will"}}'::jsonb);`);
    const notizUnberuehrt = await w64(`select coalesce(max(admin_note),'(keine)') as w
                                       from public.catalog_editorial where sky_id = 'SKY-0103'`);
    sag64("eine manipulierte Auswahl mit admin_note wird abgewiesen — das Entfernen des "
          + "Kaestchens ist keine blosse Anzeigeaenderung",
          fNote !== null && fNote.includes("kein uebernehmbares Feld")
          && notizUnberuehrt === HERKUNFT,
          `${(fNote ?? "DURCHGELAUFEN").slice(0, 56)} · Notiz unveraendert `
          + `${notizUnberuehrt === HERKUNFT}`);

    /* ---- Der Plan nennt admin_note nicht mehr. */
    const planFelder = await w64(`select coalesce(string_agg(e.wert ->> 'field', ','),'-') as w
                                  from jsonb_array_elements(
                                    public.admin_merge_plan('SKY-0825','SKY-0103', null)) as e(wert)`);
    sag64("der Plan nennt admin_note nicht mehr", !planFelder.includes("admin_note"),
          planFelder);

    /* ---- Ein Entwurf OHNE Notiz: die Zielnotiz bleibt, keine leere Zeile. */
    await db.exec("delete from public.skylanders where sky_id = 'SKY-0825';");
    await neuerEntwurf64("SKY-0826", null);
    await db.exec(`update public.skylanders set name = 'Pirate Ship' where sky_id = 'SKY-0103';`);
    const fOhneNotiz = await tu64(`select public.admin_merge_draft('SKY-0826','SKY-0103', null,
                                     '{"name":{"old":"Pirate Ship","new":"Pirate Seas"}}'::jsonb);`);
    const notizDanach = await w64(`select coalesce(max(admin_note),'(keine)') as w
                                   from public.catalog_editorial where sky_id = 'SKY-0103'`);
    const notizZeilen = await w64(`select count(*)::text as w from public.catalog_editorial
                                   where sky_id = 'SKY-0103'`);
    sag64("ein Entwurf ohne Notiz laesst die Zielnotiz unberuehrt und legt keine Zeile an",
          fOhneNotiz === null && notizDanach === HERKUNFT && notizZeilen === "1",
          `${fOhneNotiz ?? "durch"} · "${notizDanach}" · Zeilen ${notizZeilen}`);

    /* ---- Bild UND Name zusammen, mit echter Constraint: zwei Journalzeilen
     *      (merged_from von der Funktion, image_override_path vom Trigger —
     *      letzterer fehlt im Stub, deshalb wird nur merged_from erwartet). */
    await neuerEntwurf64("SKY-0827", IMPORTNOTIZ);
    await db.exec(`update public.skylanders set name = 'Pirate Ship' where sky_id = 'SKY-0103';`);
    const fBeides = await tu64(`select public.admin_merge_draft('SKY-0827','SKY-0103',
                                  'SKY-0103/c478a8fcef4098d1.png',
                                  '{"name":{"old":"Pirate Ship","new":"Pirate Seas"},
                                    "image_override_path":{"old":null,
                                      "new":"SKY-0103/c478a8fcef4098d1.png"}}'::jsonb);`);
    const zielBeides = await w64(`select name || '|' || coalesce(image_override_path,'-') as w
                                  from public.skylanders where sky_id = 'SKY-0103'`);
    const jBeides = await w64(`select coalesce(max(new_value),'-') as w
                               from public.catalog_admin_changes
                              where entity_id = 'SKY-0103' and field = 'merged_from'
                                and new_value = '2 Feld(er)'`);
    sag64("Name UND Bild: beide wandern, das Journal zaehlt zwei Felder",
          fBeides === null
          && zielBeides === "Pirate Seas|SKY-0103/c478a8fcef4098d1.png"
          && jBeides === "2 Feld(er)",
          `${fBeides ?? "durch"} · ${zielBeides} · Journal ${jBeides}`);

    /* ---- Keine fachliche Aenderung ausgewaehlt: Abbruch, Entwurf bleibt. */
    await neuerEntwurf64("SKY-0828", IMPORTNOTIZ);
    const fLeer = await tu64(`select public.admin_merge_draft('SKY-0828','SKY-0103', null,
                                '{}'::jsonb);`);
    const leerDa = await w64(`select count(*)::text as w from public.skylanders
                              where sky_id = 'SKY-0828'`);
    sag64("keine fachliche Aenderung ausgewaehlt: Abbruch, und der Entwurf steht noch — "
          + "die automatische Notiz zaehlt nicht als Aenderung",
          fLeer !== null && fLeer.includes("kein Feld zur Übernahme") && leerDa === "1",
          `${(fLeer ?? "DURCHGELAUFEN").slice(0, 50)} · steht noch ${leerDa}`);

    /* ---- UND DER ROLLBACK, an der Audit-Zeile erzwungen. */
    await db.exec(`alter table public.catalog_admin_changes
                     drop constraint catalog_admin_changes_field_known;`);
    /*
     * `not valid`, UND ZWAR ABSICHTLICH. Die vorigen Faelle haben schon
     * `merged_from`-Zeilen geschrieben; eine geprueft angelegte Constraint
     * scheiterte an denen, statt den naechsten Schreibvorgang zu treffen.
     * Hier geht es allein darum, die Journalzeile des NAECHSTEN Merges
     * scheitern zu lassen — und zu sehen, dass dann alles zurueckgeht.
     */
    await db.exec(`alter table public.catalog_admin_changes
                     add constraint catalog_admin_changes_field_known
                     check (field <> 'merged_from') not valid;`);
    await db.exec(`update public.skylanders set name = 'Pirate Ship' where sky_id = 'SKY-0103';`);
    const vorRollback = await w64(
      `select (select name from public.skylanders where sky_id = 'SKY-0103')
           || ' ## ' || (select count(*)::text from public.skylanders where sky_id = 'SKY-0828')
           || ' ## ' || (select coalesce(max(admin_note),'-') from public.catalog_editorial
                          where sky_id = 'SKY-0103') as w`);
    const fRoll = await tu64(`select public.admin_merge_draft('SKY-0828','SKY-0103', null,
                                '{"name":{"old":"Pirate Ship","new":"Pirate Seas"}}'::jsonb);`);
    const nachRollback = await w64(
      `select (select name from public.skylanders where sky_id = 'SKY-0103')
           || ' ## ' || (select count(*)::text from public.skylanders where sky_id = 'SKY-0828')
           || ' ## ' || (select coalesce(max(admin_note),'-') from public.catalog_editorial
                          where sky_id = 'SKY-0103') as w`);
    sag64("ein Fehler an der Journalzeile rollt ALLES zurueck — Name, Notiz und der "
          + "Entwurf stehen danach wie vorher",
          fRoll !== null && fRoll.includes("23514") && nachRollback === vorRollback,
          `${(fRoll ?? "DURCHGELAUFEN").slice(0, 40)} · unveraendert `
          + `${nachRollback === vorRollback} (${nachRollback.replace(/\n/g, " ⏎ ")})`);

    probe.push({
      name: "P64 0157 an der ECHTEN Audit-Constraint: der Fehler 23514 des Betreibers wird "
        + "reproduziert und faellt danach weg, catalog_status und discarded ebenso, "
        + "merge_note raeumt den veralteten Bildhinweis weg ohne die Herkunft zu "
        + "verlieren, admin_note ist kein auswaehlbares Feld mehr (auch nicht fuer eine "
        + "manipulierte Anfrage) — und ein Fehler an der Journalzeile rollt alles zurueck",
      ok: ok64,
      sagt: `0157: ${befund64.join(" · ")}`,
    });
  }

  /* ========================================================================
   * P65 — 0158: die Figurenfamilien und der dritte Importweg.
   *
   * MIT DER ECHTEN AUDIT-CONSTRAINT, wie P64: das Stub-Schema traegt keine
   * CHECK-Constraints (achter Werkzeugbefund), und `character_id` ist der
   * ELFTE erlaubte Journalwert. Ohne die Constraint im Spiel wuerde dieser
   * Durchgang die eine Zeile nicht pruefen, an der es scheitern koennte —
   * genau der Fehler, der CAT-05I einen Tag gekostet hat.
   * ===================================================================== */
  {
    const befund65: string[] = [];
    let ok65 = true;
    const sag65 = (was: string, gut: boolean, text: string): void => {
      befund65.push(`${gut ? "" : "!! "}${was}: ${text}`);
      if (!gut) ok65 = false;
    };

    const db = await frischNach0136();
    await serienUndIdentitaet(db);
    const w65 = async (sql: string): Promise<string> =>
      String(((await db.query(sql)) as { rows: Record<string, unknown>[] }).rows[0]?.w ?? "?");
    const tu65 = async (sql: string): Promise<string | null> => {
      try { await db.exec(sql); return null; }
      catch (e) {
        const f = e as { message?: string; code?: string };
        return `[${f.code ?? "?"}] ${(f.message ?? "FEHLER").slice(0, 180)}`;
      }
    };

    await db.exec(`insert into public.categories (id, series_code, name, position)
                   values (10, 'SA', 'Figuren', 1), (11, 'G', 'Giants', 1);`);
    await db.exec(`create unique index if not exists z_sky5_uniq
                     on public.skylanders (sky_id);`);
    await db.exec(`create unique index if not exists z_ce5_uniq
                     on public.catalog_editorial (sky_id);`);
    /* Der Dublettenschutz fuer Familien ist dieser Index (`0002`); das
       Stub-Schema traegt ihn nicht, und `0158` verlangt ihn ausdruecklich. */
    await db.exec(`create unique index if not exists characters_canonical_name_key
                     on public.characters (lower(canonical_name));`);
    /*
     * DAS STUB-SCHEMA TRAEGT KEINE IDENTITAETSSPALTEN UND KEINE SCHLUESSEL.
     * In der Wirklichkeit ist `characters.id` `generated always as identity`
     * (`0002`); hier bekaeme eine neue Familie die id NULL, und
     * `admin_create_character` gaebe NULL zurueck — der Durchgang waere
     * gruen, ohne eine Familie angelegt zu haben. Dieselbe Nachhilfe, die
     * `serienUndIdentitaet()` fuer `categories.id` leistet.
     */
    await db.exec(`create sequence if not exists public.z_char_id_seq start 1;
                   alter table public.characters
                     alter column id set default nextval('public.z_char_id_seq');`);
    await db.exec(`create unique index if not exists z_char5_id_uniq
                     on public.characters (id);`);
    await db.exec(`alter table public.skylanders
                     add constraint z_sk5_char_fk foreign key (character_id)
                     references public.characters (id);`);
    await db.exec(`alter table public.collection_items
                     add constraint z_ci5_sky_fk foreign key (sky_id)
                     references public.skylanders (sky_id);`);
    await db.exec(`create or replace function public.is_platform_admin() returns boolean
                   language sql as $stub$ select true $stub$;`);
    await db.exec(`alter table public.catalog_admin_changes
                     add constraint catalog_admin_changes_field_known
                     check (field in ('catalog_visible', 'display_name_override',
                                      'admin_note', 'catalog_group',
                                      'image_override_path', 'card_type', 'created',
                                      'catalog_status', 'merged_from', 'discarded'));`);

    for (const m of ["supabase/migrations/0154_merge_draft_into_figure.sql",
                     "supabase/migrations/0155_discard_draft.sql",
                     "supabase/migrations/0156_merge_selected_fields.sql",
                     "supabase/migrations/0157_audit_fields_and_automatic_notes.sql"]) {
      const f = await fahre(db, m);
      if (f !== null) sag65(`Aufbau ${m.slice(21, 25)}`, false, f);
    }

    const anlegen = async (id: string, name: string, status: string, kt = "standard") =>
      db.exec(`insert into public.skylanders
                 (sky_id, name, slug, series_code, category_id, item_type, card_type,
                  is_active, catalog_visible, catalog_status, source)
               values ('${id}', '${name}', '${id.toLowerCase()}', 'SA', 10, 'figure',
                  '${kt}', true, ${status === "public"}, '${status}', 'admin');`);

    /* Die Welt: Spyro steht oeffentlich, Chrome Spyro ist ein Entwurf. */
    await anlegen("SKY-0001", "Spyro", "public");
    await anlegen("SKY-0825", "Chrome Spyro", "draft");
    await db.exec(`insert into public.collection_items (user_id, sky_id, quantity)
                   values ('00000000-0000-0000-0000-00000000000c', 'SKY-0001', 4);`);

    /* ---- 8./7. VORHER: ohne 0158 scheitert die Zuordnung an der Constraint. */
    const fVorher = await tu65(`insert into public.catalog_admin_changes
                                  (entity, entity_id, field, old_value, new_value)
                                values ('skylander','SKY-0825','character_id',null,'1');`);
    sag65("VORHER: character_id ist als Journalfeld verboten (23514) — ohne 0158 "
          + "waere jede Zuordnung derselbe Fehler wie in CAT-05I",
          fVorher !== null && fVorher.includes("23514")
          && fVorher.includes("catalog_admin_changes_field_known"),
          (fVorher ?? "DURCHGELAUFEN").slice(0, 70));

    /* ---- 0158 ohne 0157 bricht ab: die Reihenfolge ist echt. */
    {
      const leer = await frischNach0136();
      await serienUndIdentitaet(leer);
      await leer.exec(`create or replace function public.is_platform_admin() returns boolean
                       language sql as $stub$ select true $stub$;`);
      await leer.exec(`create unique index if not exists characters_canonical_name_key
                         on public.characters (lower(canonical_name));`);
      await leer.exec(`alter table public.catalog_admin_changes
                         add constraint catalog_admin_changes_field_known
                         check (field in ('catalog_visible', 'created'));`);
      await leer.exec(`drop function if exists public.admin_set_catalog_status(text,text) cascade;`);
      const nur158 = await fahre(leer, "supabase/migrations/0158_figure_families.sql");
      sag65("0158 ohne 0152/0157 bricht ab (die Vorbedingungen sind echt)",
            nur158 !== null && nur158.includes("0158 Vorbedingung"),
            (nur158 ?? "DURCHGELAUFEN").slice(0, 62));
    }

    const f158 = await fahre(db, "supabase/migrations/0158_figure_families.sql");
    const conDef = await w65(`select pg_get_constraintdef(oid) as w from pg_constraint
                              where conname = 'catalog_admin_changes_field_known'`);
    sag65("0158 laeuft; die Constraint kennt elf Werte und keinen weniger",
          f158 === null
          && ["catalog_visible", "display_name_override", "admin_note", "catalog_group",
              "image_override_path", "card_type", "created", "catalog_status",
              "merged_from", "discarded", "character_id"].every((v) => conDef.includes(v)),
          `${f158 ?? "durch"} · ${conDef.slice(-60)}`);

    /* ---- 5. Familie anlegen, und der Dublettenschutz. */
    const famId = await w65(`select public.admin_create_character('Spyro')::text as w`);
    const fDupl = await tu65(`select public.admin_create_character('spyro');`);
    const fLeer = await tu65(`select public.admin_create_character('   ');`);
    const famZahl = await w65(`select count(*)::text as w from public.characters`);
    sag65("eine Familie entsteht; derselbe Name — auch anders geschrieben — wird "
          + "abgewiesen und die bestehende genannt",
          famId !== "?" && famId !== ""
          && fDupl !== null && fDupl.includes("gibt es schon")
          && fLeer !== null && fLeer.includes("braucht einen Namen")
          && famZahl === "1",
          `id ${famId} · ${(fDupl ?? "DURCH").slice(0, 44)} · Familien ${famZahl}`);
    /* Element, Spezies und Beschreibung bleiben leer — kuratierte Arbeit. */
    const famLeerFelder = await w65(`select (element is null and species is null
                                        and short_description is null)::text as w
                                      from public.characters where id = ${famId}`);
    sag65("sie traegt nur den Namen — Element, Spezies und Beschreibung bleiben leer",
          famLeerFelder === "true", famLeerFelder);

    /* ---- 1./10./11. WEG B: atomar veroeffentlichen und zuordnen. */
    const vorB = await w65(`select (select count(*)::text from public.skylanders)
                              || '|' || (select coalesce(max(quantity)::text,'-')
                                          from public.collection_items where sky_id = 'SKY-0001')
                              || '|' || (select name || '/' || slug from public.skylanders
                                          where sky_id = 'SKY-0001') as w`);
    const fB = await tu65(`select public.admin_publish_as_variant('SKY-0825', ${famId});`);
    const nachB = await w65(`select sky_id || '|' || name || '|' || slug || '|'
                               || catalog_status || '|' || catalog_visible::text || '|'
                               || character_id::text || '|' || card_type as w
                             from public.skylanders where sky_id = 'SKY-0825'`);
    const nachBWelt = await w65(`select (select count(*)::text from public.skylanders)
                                   || '|' || (select coalesce(max(quantity)::text,'-')
                                               from public.collection_items where sky_id = 'SKY-0001')
                                   || '|' || (select name || '/' || slug from public.skylanders
                                               where sky_id = 'SKY-0001') as w`);
    const jB = await w65(`select coalesce(string_agg(field || '=' || coalesce(new_value,'-'),
                                                     ', ' order by field),'-') as w
                          from public.catalog_admin_changes where entity_id = 'SKY-0825'`);
    sag65("WEG B: der Entwurf wird oeffentlich UND der Familie zugeordnet — SKY-ID, "
          + "Slug, Name und Edition bleiben seine eigenen",
          fB === null
          && nachB === `SKY-0825|Chrome Spyro|sky-0825|public|true|${famId}|standard`,
          `${fB ?? "durch"} · ${nachB}`);
    sag65("WEG B: die Grundfigur und ihre Referenzen sind unberuehrt",
          nachBWelt === vorB, `${nachBWelt} (vorher ${vorB})`);
    /*
     * NUR `character_id`, UND DAS IST KEINE LUECKE DIESES DURCHGANGS.
     * Die Zeile schreibt `admin_set_character` selbst, also laesst sie sich
     * hier sehen. Die Zeile `catalog_status` schreibt dagegen der
     * Journaltrigger `log_skylander_editorial_change` — und das Stub-Schema
     * traegt KEINE Trigger (dokumentierter Werkzeugbefund). Dass der Trigger
     * `catalog_status` schreibt und die Constraint ihn seit `0157` kennt,
     * belegen P60 und P64; hier waere es eine Behauptung ueber eine
     * Umgebung, die es nicht gibt.
     */
    sag65("WEG B: das Journal nennt die Familienzuordnung mit IDs (die Statuszeile "
          + "schreibt der Trigger, den das Stub-Schema nicht hat)",
          jB.includes(`character_id=${famId}`), jB);
    /* 12. DER NAME TRAEGT KEINE KLAMMER. */
    sag65("WEG B: der Name bleibt natuerlich — kein Grundfigur-(Variante)-Format",
          !nachB.includes("(") && nachB.includes("Chrome Spyro"), nachB.split("|")[1]);

    /* ---- 6./7. Manipulierte Eingaben und Berechtigung. */
    await anlegen("SKY-0826", "Dark Spyro", "draft");
    const mFam = await tu65(`select public.admin_publish_as_variant('SKY-0826', 999);`);
    const mNull = await tu65(`select public.admin_publish_as_variant('SKY-0826', null);`);
    const mFigur = await tu65(`select public.admin_publish_as_variant('SKY-9999', ${famId});`);
    const mOeff = await tu65(`select public.admin_publish_as_variant('SKY-0001', ${famId});`);
    const nachAngriff = await w65(`select catalog_status || '|'
                                     || coalesce(character_id::text,'-') as w
                                   from public.skylanders where sky_id = 'SKY-0826'`);
    const grundUnberuehrt = await w65(`select catalog_status || '|'
                                         || coalesce(character_id::text,'-') as w
                                       from public.skylanders where sky_id = 'SKY-0001'`);
    sag65("vier manipulierte Eingaben, vier Abweisungen — und danach ist nichts bewegt",
          [mFam, mNull, mFigur, mOeff].every((x) => x !== null)
          && nachAngriff === "draft|-" && grundUnberuehrt === "public|-",
          `${[mFam, mNull, mFigur, mOeff].map((x) => (x ?? "DURCH").slice(0, 26)).join(" | ")} `
          + `· Entwurf ${nachAngriff} · Grundfigur ${grundUnberuehrt}`);

    await db.exec(`create or replace function public.is_platform_admin() returns boolean
                   language sql as $stub$ select false $stub$;`);
    const kSet = await tu65(`select public.admin_set_character('SKY-0826', ${famId});`);
    const kNeu = await tu65(`select public.admin_create_character('Fremd');`);
    const kPub = await tu65(`select public.admin_publish_as_variant('SKY-0826', ${famId});`);
    await db.exec(`create or replace function public.is_platform_admin() returns boolean
                   language sql as $stub$ select true $stub$;`);
    sag65("ohne Adminrecht weist jede der drei Funktionen ab (42501)",
          [kSet, kNeu, kPub].every((x) => x !== null && x.includes("42501")),
          [kSet, kNeu, kPub].map((x) => (x ?? "DURCH").slice(0, 22)).join(" | "));

    /* ---- 4. Zuordnung setzen, aendern, entfernen — auch an einer
     *      VEROEFFENTLICHTEN Figur. */
    const sSet = await tu65(`select public.admin_set_character('SKY-0001', ${famId});`);
    const nachSet = await w65(`select coalesce(character_id::text,'-') || '|' || catalog_status
                                 || '|' || name as w
                               from public.skylanders where sky_id = 'SKY-0001'`);
    const famZwei = await w65(`select public.admin_create_character('Eruptor')::text as w`);
    const sAendern = await tu65(`select public.admin_set_character('SKY-0001', ${famZwei});`);
    const nachAendern = await w65(`select coalesce(character_id::text,'-') as w
                                   from public.skylanders where sky_id = 'SKY-0001'`);
    const sWeg = await tu65(`select public.admin_set_character('SKY-0001', null);`);
    const nachWeg = await w65(`select coalesce(character_id::text,'(null)') as w
                               from public.skylanders where sky_id = 'SKY-0001'`);
    const jSet = await w65(`select coalesce(string_agg(coalesce(old_value,'-') || '->'
                                            || coalesce(new_value,'-'), ', ' order by id),'-') as w
                            from public.catalog_admin_changes
                           where entity_id = 'SKY-0001' and field = 'character_id'`);
    sag65("setzen, aendern, entfernen — an einer VEROEFFENTLICHTEN Figur, und das "
          + "Journal fuehrt alle drei Schritte mit IDs",
          sSet === null && nachSet === `${famId}|public|Spyro`
          && sAendern === null && nachAendern === famZwei
          && sWeg === null && nachWeg === "(null)"
          && jSet === `-->${famId}, ${famId}->${famZwei}, ${famZwei}->-`,
          `${nachSet} → ${nachAendern} → ${nachWeg} · Journal [${jSet}]`);

    /* Eine Nichtaenderung schreibt keine Journalzeile. */
    const vorNoop = await w65(`select count(*)::text as w from public.catalog_admin_changes
                               where entity_id = 'SKY-0001' and field = 'character_id'`);
    const noop = await w65(`select (public.admin_set_character('SKY-0001', null)
                                     ->> 'changed') as w`);
    const nachNoop = await w65(`select count(*)::text as w from public.catalog_admin_changes
                                where entity_id = 'SKY-0001' and field = 'character_id'`);
    sag65("eine Nichtaenderung schreibt keine Journalzeile",
          noop === "false" && vorNoop === nachNoop, `changed ${noop} · Zeilen ${nachNoop}`);

    /* ---- 2. WEG C: eigenstaendig, ohne Familie. */
    await anlegen("SKY-0827", "Flocked Stump Smash", "draft");
    const fC = await tu65(`select public.admin_set_catalog_status('SKY-0827', 'public');`);
    const nachC = await w65(`select catalog_status || '|' || catalog_visible::text || '|'
                               || coalesce(character_id::text,'(null)') || '|' || slug as w
                             from public.skylanders where sky_id = 'SKY-0827'`);
    sag65("WEG C: eigenstaendig veroeffentlicht, ohne Familie, mit eigenem Slug",
          fC === null && nachC === "public|true|(null)|sky-0827", `${fC ?? "durch"} · ${nachC}`);

    /* ---- 9. ROLLBACK: ein Fehler an der Journalzeile nimmt alles mit. */
    await anlegen("SKY-0828", "Legendary Spyro", "draft");
    await db.exec(`alter table public.catalog_admin_changes
                     drop constraint catalog_admin_changes_field_known;`);
    await db.exec(`alter table public.catalog_admin_changes
                     add constraint catalog_admin_changes_field_known
                     check (field <> 'character_id') not valid;`);
    const vorRoll = await w65(`select catalog_status || '|'
                                 || coalesce(character_id::text,'-') as w
                               from public.skylanders where sky_id = 'SKY-0828'`);
    const fRoll = await tu65(`select public.admin_publish_as_variant('SKY-0828', ${famId});`);
    const nachRoll = await w65(`select catalog_status || '|'
                                  || coalesce(character_id::text,'-') as w
                                from public.skylanders where sky_id = 'SKY-0828'`);
    sag65("ein Fehler an der Journalzeile rollt BEIDE Haelften zurueck — der Entwurf "
          + "ist danach weder veroeffentlicht noch zugeordnet",
          fRoll !== null && fRoll.includes("23514") && nachRoll === vorRoll
          && nachRoll === "draft|-",
          `${(fRoll ?? "DURCHGELAUFEN").slice(0, 34)} · ${nachRoll} (vorher ${vorRoll})`);

    /* ---- 14. Eine Familie ueber mehrere Serien. */
    await db.exec(`alter table public.catalog_admin_changes
                     drop constraint catalog_admin_changes_field_known;`);
    await db.exec(`alter table public.catalog_admin_changes
                     add constraint catalog_admin_changes_field_known
                     check (field in ('catalog_visible', 'display_name_override',
                                      'admin_note', 'catalog_group', 'image_override_path',
                                      'card_type', 'created', 'catalog_status',
                                      'merged_from', 'discarded', 'character_id'));`);
    await db.exec(`insert into public.skylanders
                     (sky_id, name, slug, series_code, category_id, item_type, card_type,
                      is_active, catalog_visible, catalog_status, source)
                   values ('SKY-0829', 'LightCore Spyro', 'sky-0829', 'G', 11, 'figure',
                      'special', true, false, 'draft', 'admin');`);
    const fSerie = await tu65(`select public.admin_publish_as_variant('SKY-0829', ${famId});`);
    const serienDerFamilie = await w65(`select coalesce(string_agg(distinct series_code, ',' ),'-') as w
                                        from public.skylanders where character_id = ${famId}`);
    const serieErhalten = await w65(`select series_code || '|' || category_id::text as w
                                     from public.skylanders where sky_id = 'SKY-0829'`);
    sag65("eine Familie darf Figuren in mehreren Serien haben, und die Serie der "
          + "Figur bleibt ihre eigene",
          fSerie === null && serienDerFamilie === "G,SA" && serieErhalten === "G|11",
          `Serien der Familie ${serienDerFamilie} · SKY-0829 ${serieErhalten}`);

    /* ---- 3. Die Zusammenfuehrung aus 0157 laeuft unveraendert weiter. */
    await anlegen("SKY-0830", "Pirate Seas", "draft");
    await anlegen("SKY-0103", "Pirate Ship", "public");
    const fMerge = await tu65(`select public.admin_merge_draft('SKY-0830','SKY-0103', null,
                                 '{"name":{"old":"Pirate Ship","new":"Pirate Seas"}}'::jsonb);`);
    const nachMerge = await w65(`select name || '|' || slug as w from public.skylanders
                                 where sky_id = 'SKY-0103'`);
    sag65("die Zusammenfuehrung aus 0157 ist unberuehrt — 0158 verschlechtert Weg A nicht",
          fMerge === null && nachMerge === "Pirate Seas|sky-0103",
          `${fMerge ?? "durch"} · ${nachMerge}`);

    /* ---- 16. Ein Altbestandsname mit Klammer bleibt, wie er ist. */
    await db.exec(`insert into public.skylanders
                     (sky_id, name, slug, series_code, category_id, item_type, card_type,
                      is_active, catalog_visible, catalog_status, source)
                   values ('SKY-0831', 'Crusher (Granite)', 'sky-0831', 'SA', 10, 'figure',
                      'special', true, true, 'public', 'import');`);
    const fAlt = await tu65(`select public.admin_set_character('SKY-0831', ${famId});`);
    const nachAlt = await w65(`select name || '|' || coalesce(character_id::text,'-') as w
                               from public.skylanders where sky_id = 'SKY-0831'`);
    sag65("ein vorhandener Klammername wird zugeordnet und NICHT umbenannt — "
          + "Altbestand bleibt Altbestand",
          fAlt === null && nachAlt === `Crusher (Granite)|${famId}`, nachAlt);

    probe.push({
      name: "P65 0158 an der echten Audit-Constraint: Familie anlegen mit Dublettenschutz, "
        + "Weg B atomar (veroeffentlichen UND zuordnen, Grundfigur unberuehrt), Weg C "
        + "eigenstaendig, Zuordnung setzen/aendern/entfernen auch an veroeffentlichten "
        + "Figuren, vier manipulierte Eingaben und drei Rechtepruefungen abgewiesen, "
        + "vollstaendiger Rollback an der Journalzeile, eine Familie ueber zwei Serien, "
        + "Weg A unveraendert — und kein Name bekommt eine Klammer",
      ok: ok65,
      sagt: `0158: ${befund65.join(" · ")}`,
    });
  }

  /* ========================================================================
   * P66 — 0153: `catalog_status` in der Plattformsicherung, und der UMLAUF.
   *
   * WAS DIESER DURCHGANG ZEIGT, DEN ES SO NOCH NICHT GAB: er RUFT die
   * Sicherungsfunktion auf. P51 prueft `0144` am Rumpf — Abdruck, Attribute,
   * Rechte, Ruecknahme — und fuehrt sie nie aus. Hier geht es aber genau um
   * das ERGEBNIS: traegt das Archiv den Status, und kommt ein Entwurf nach
   * einer Wiederherstellung als Entwurf zurueck?
   *
   * Deshalb faehrt dieser Durchgang einen echten UMLAUF an erfundenen
   * Zeilen: drei Katalogzeilen mit `draft`, `hidden` und `public`,
   * exportieren, die Zeilen loeschen, aus dem Archiv wieder einspielen, und
   * danach die Status vergleichen. Einmal OHNE `0153` — da muss es
   * scheitern, und zwar genau so, wie die Migration es beschreibt — und
   * einmal MIT.
   *
   * Dazu die Riegel: ohne `0152` bricht sie ab, gegen eine fremde Fassung
   * ebenso, ein zweiter Lauf prallt ab, und die Ruecknahme stellt den Rumpf
   * aus `0144` zeichengleich her, ohne die Spalte anzufassen.
   * ===================================================================== */
  {
    const befund66: string[] = [];
    let ok66 = true;
    const sag66 = (was: string, gut: boolean, text: string): void => {
      befund66.push(`${gut ? "" : "!! "}${was}: ${text}`);
      if (!gut) ok66 = false;
    };

    const M153 = join(MIG_DIR, "0153_platform_export_catalog_status.sql");
    const R153 = "supabase/rollback/R0153_platform_export_back_to_0144.sql";
    const A0105 = "2e2da90e976a1e73ca00aba7cd830fae";
    const A0144 = "4c4d2e7c81e4efa8e18cdffa06bba40a";
    const A0153 = "92c48444f99b9e294f9703d0c0ddeaa8";

    const anweisungVon66 = (datei: string): string => {
      const sql = readFileSync(datei, "utf8");
      const von = sql.indexOf("create or replace function public.system_platform_export()");
      const bis = sql.indexOf("\n$$;", von) + "\n$$;".length;
      return sql.slice(von, bis);
    };

    /* `frischNach0136()` und nicht `frisch()`: das Stub-Schema traegt
       `skylanders.item_type` erst ab `0135` (dokumentierter Werkzeugbefund),
       und die drei erfundenen Zeilen brauchen die Spalte. */
    const db = await frischNach0136();
    const w66 = async (sql: string): Promise<string> =>
      String(((await db.query(sql)) as { rows: Record<string, unknown>[] }).rows[0]?.w ?? "?");
    const tu66 = async (sql: string): Promise<string | null> => {
      try { await db.exec(sql); return null; }
      catch (e) {
        const f = e as { message?: string; code?: string };
        return `[${f.code ?? "?"}] ${(f.message ?? "FEHLER").slice(0, 160)}`;
      }
    };
    const abdruck66 = async (): Promise<string> => w66(
      "select md5(prosrc) as w from pg_proc p join pg_namespace n on n.oid = p.pronamespace"
      + " where n.nspname = 'public' and p.proname = 'system_platform_export'");

    await db.exec(`create schema if not exists auth;
                   create table if not exists auth.users (id uuid primary key);`);
    await db.exec(`create or replace function public.is_platform_admin() returns boolean
                   language sql as $stub$ select true $stub$;`);
    await db.exec(`create unique index if not exists z_sky6_uniq
                     on public.skylanders (sky_id);`);
    await db.exec(`insert into public.categories (id, series_code, name, position)
                   values (10, 'SA', 'Figuren', 1);`);

    /*
     * DIE SPALTE AUS `0152` IST IM STUB SCHON DA (dokumentierter
     * Werkzeugbefund). Fuer den ersten Riegel muss sie weg — das ist die
     * Lage, in der `0153` ohne `0152` wirklich laeuft.
     */
    await db.exec("set check_function_bodies = off;");
    await db.exec(anweisungVon66(join(MIG_DIR, "0144_platform_export_calculations.sql")));
    await db.exec("set check_function_bodies = on;");
    const start66 = await abdruck66();
    sag66("Aufbau: der Rumpf aus 0144 steht", start66 === A0144, start66);

    await db.exec("alter table public.skylanders drop column catalog_status;");
    const ohne0152 = await fahre(db, M153);
    sag66("ohne 0152 bricht 0153 ab", ohne0152 !== null && ohne0152.includes("0152"),
          (ohne0152 ?? "DURCHGELAUFEN").slice(0, 56));
    /* Die Spalte zurueck, so wie `0152` sie anlegt. */
    await db.exec(`alter table public.skylanders add column catalog_status text;
                   update public.skylanders set catalog_status =
                     case when catalog_visible then 'public' else 'hidden' end;
                   alter table public.skylanders alter column catalog_status set not null;`);

    /* Eine FREMDE Fassung wird nicht ueberschrieben. */
    await db.exec("set check_function_bodies = off;");
    await db.exec(anweisungVon66(join(MIG_DIR, "0105_platform_export.sql")));
    await db.exec("set check_function_bodies = on;");
    const gegen0105 = await fahre(db, M153);
    sag66("gegen den Rumpf aus 0105 bricht sie ab, statt ihn zu ueberschreiben",
          gegen0105 !== null && gegen0105.includes("0105"),
          (gegen0105 ?? "DURCHGELAUFEN").slice(0, 60));
    sag66("und der fremde Rumpf steht unveraendert",
          (await abdruck66()) === A0105, await abdruck66());

    await db.exec("set check_function_bodies = off;");
    await db.exec(anweisungVon66(join(MIG_DIR, "0144_platform_export_calculations.sql")));
    await db.exec("set check_function_bodies = on;");

    /* ================================================================
     * DIE DREI ZEILEN, auf die alles ankommt.
     * ============================================================= */
    const anlegen66 = async (id: string, status: string) =>
      db.exec(`insert into public.skylanders
                 (sky_id, name, slug, series_code, category_id, item_type, card_type,
                  is_active, catalog_visible, catalog_status, source)
               values ('${id}', 'P66 ${status}', '${id.toLowerCase()}', 'SA', 10,
                  'figure', 'standard', true, ${status === "public"}, '${status}',
                  'admin');`);
    await anlegen66("SKY-7001", "public");
    await anlegen66("SKY-7002", "hidden");
    await anlegen66("SKY-7003", "draft");

    /** Der Katalogbereich des Archivs, als eine Zeile je SKY-ID. */
    const archivStatus = async (): Promise<string> => w66(
      `select coalesce(string_agg(x.sky_id || '=' || coalesce(x.status, '(FEHLT)'),
                                  ', ' order by x.sky_id), '(leer)') as w
         from (select e ->> 'sky_id' as sky_id, e ->> 'catalog_status' as status
                 from jsonb_array_elements(
                        (public.system_platform_export() -> 'data' -> 'skylanders')) as e
                where e ->> 'sky_id' like 'SKY-700%') x`);

    /* ---- OHNE 0153: das Archiv kennt den Status NICHT. Genau die Luecke. */
    const vorher66 = await archivStatus();
    sag66("OHNE 0153 fuehrt das Archiv keinen catalog_status — Entwurf und versteckte "
          + "Zeile sind darin nicht zu unterscheiden",
          vorher66.includes("SKY-7003=(FEHLT)") && vorher66.includes("SKY-7002=(FEHLT)"),
          vorher66);
    /* Und `catalog_visible` ist bei beiden `false` — der Beweis der Luecke. */
    const sichtbarkeit = await w66(
      `select coalesce(string_agg(e ->> 'sky_id' || '=' || (e ->> 'catalog_visible'),
                                  ', ' order by e ->> 'sky_id'), '(leer)') as w
         from jsonb_array_elements(
                (public.system_platform_export() -> 'data' -> 'skylanders')) as e
        where e ->> 'sky_id' in ('SKY-7002', 'SKY-7003')`);
    sag66("und catalog_visible ist bei Entwurf UND versteckter Zeile false — daraus "
          + "laesst sich der Status nicht zurueckgewinnen",
          sichtbarkeit === "SKY-7002=false, SKY-7003=false", sichtbarkeit);

    /* ---- 0153 laeuft. */
    const lauf = await fahre(db, M153);
    const nachher = await abdruck66();
    const laenge = await w66(
      "select length(prosrc)::text as w from pg_proc p join pg_namespace n"
      + " on n.oid = p.pronamespace where n.nspname = 'public'"
      + " and p.proname = 'system_platform_export'");
    sag66("0153 laeuft; der Rumpf ist der zugesagte und 31072 Zeichen lang",
          lauf === null && nachher === A0153 && laenge === "31072",
          `${lauf ?? "durch"} · ${nachher} · ${laenge} Zeichen`);

    /* DIE UMKEHRPROBE AM LEBENDEN RUMPF. */
    const zurueckgedreht = await w66(
      "select md5(replace(prosrc, E'\\n            ''catalog_status'', t.catalog_status,',"
      + " '')) as w from pg_proc p join pg_namespace n on n.oid = p.pronamespace"
      + " where n.nspname = 'public' and p.proname = 'system_platform_export'");
    sag66("zieht man die eine Zeile ab, ist er zeichengleich der aus 0144",
          zurueckgedreht === A0144, zurueckgedreht);

    /* ---- MIT 0153: das Archiv fuehrt alle drei Werte. */
    const nachher66 = await archivStatus();
    sag66("MIT 0153 fuehrt das Archiv alle drei Werte",
          nachher66 === "SKY-7001=public, SKY-7002=hidden, SKY-7003=draft", nachher66);

    /* ================================================================
     * DER UMLAUF: sichern, loeschen, aus dem Archiv wieder einspielen.
     *
     * Das ist die Frage aus CAT-02C in einem Satz: bleibt ein Entwurf nach
     * einer Wiederherstellung ein Entwurf? Hier wird sie nicht beantwortet,
     * sondern gemessen.
     * ============================================================= */
    await db.exec(`create table z_archiv as
                   select public.system_platform_export() as doc;`);
    await db.exec("delete from public.skylanders where sky_id like 'SKY-700%';");
    const weg = await w66("select count(*)::text as w from public.skylanders"
                          + " where sky_id like 'SKY-700%'");
    const einspielen = await tu66(`
      insert into public.skylanders
        (sky_id, name, slug, series_code, category_id, item_type, card_type,
         is_active, catalog_visible, catalog_status, source)
      select e ->> 'sky_id', e ->> 'name', e ->> 'slug', e ->> 'series_code',
             (e ->> 'category_id')::bigint, 'figure', 'standard',
             (e ->> 'is_active')::boolean, (e ->> 'catalog_visible')::boolean,
             e ->> 'catalog_status', 'admin'
        from z_archiv z, jsonb_array_elements(z.doc -> 'data' -> 'skylanders') as e
       where e ->> 'sky_id' like 'SKY-700%';`);
    const danach = await w66(
      `select coalesce(string_agg(sky_id || '=' || catalog_status || '/'
                                  || catalog_visible::text, ', ' order by sky_id), '(leer)') as w
         from public.skylanders where sky_id like 'SKY-700%'`);
    sag66("DER UMLAUF: nach dem Einspielen aus dem Archiv steht jeder Status wieder "
          + "da — ein Entwurf ist wieder ein Entwurf",
          weg === "0" && einspielen === null
          && danach === "SKY-7001=public/true, SKY-7002=hidden/false, "
                      + "SKY-7003=draft/false",
          `geloescht ${weg} · ${einspielen ?? "eingespielt"} · ${danach}`);

    /* ---- Ein zweiter Lauf prallt ab. */
    const zweimal = await fahre(db, M153);
    sag66("ein zweiter Lauf prallt an seinem eigenen Riegel ab",
          zweimal !== null && zweimal.includes("schon der neue"),
          (zweimal ?? "DURCHGELAUFEN").slice(0, 52));

    /* ---- Die Ruecknahme. */
    const zurueck = await fahre(db, R153);
    const nachRuecknahme = await abdruck66();
    const spalteDa = await w66(
      "select count(*)::text as w from pg_attribute a"
      + " where a.attrelid = to_regclass('public.skylanders')"
      + " and a.attname = 'catalog_status' and not a.attisdropped");
    const zeilenDa = await w66(
      `select coalesce(string_agg(sky_id || '=' || catalog_status, ', ' order by sky_id),
                       '(leer)') as w
         from public.skylanders where sky_id like 'SKY-700%'`);
    sag66("die Ruecknahme stellt den Rumpf aus 0144 zeichengleich her und laesst die "
          + "Spalte samt Werten stehen",
          zurueck === null && nachRuecknahme === A0144 && spalteDa === "1"
          && zeilenDa === "SKY-7001=public, SKY-7002=hidden, SKY-7003=draft",
          `${zurueck ?? "durch"} · ${nachRuecknahme} · Spalte ${spalteDa} · ${zeilenDa}`);

    probe.push({
      name: "P66 0153: das Archiv fuehrt catalog_status — und zwar GEMESSEN, nicht am "
        + "Rumpf behauptet. Dieser Durchgang RUFT die Sicherung auf, zeigt die Luecke "
        + "ohne 0153 (Entwurf und versteckte Zeile beide catalog_visible=false, Status "
        + "fehlt), faehrt die Migration und spielt dann aus dem Archiv wieder ein: "
        + "public, hidden und draft kommen alle drei zurueck. Dazu die Riegel (ohne "
        + "0152, gegen 0105, zweiter Lauf) und die Ruecknahme, die die Spalte verschont",
      ok: ok66,
      sagt: `0153: ${befund66.join(" · ")}`,
    });
  }

  /* ========================================================================
   * P67 — 0159: die Variante kennt ihre Basisfigur.
   *
   * MIT DEN ECHTEN SCHLUESSELN UND DER ECHTEN AUDIT-CONSTRAINT. Das
   * Stub-Schema traegt weder Schluessel noch CHECKs (Werkzeugbefunde); ein
   * Durchgang ohne sie koennte die zwei wichtigsten Zusagen dieser Migration
   * nicht pruefen — die Serienregel ist ein FREMDSCHLUESSEL, und der zwoelfte
   * Journalwert haengt an einer CHECK-Constraint.
   *
   * WAS HIER AUSEINANDERGEHALTEN WIRD: welcher Riegel greift. Die Serie
   * faengt der zusammengesetzte Fremdschluessel (23503), den Selbstbezug ein
   * CHECK (23514), die Ketten ein Trigger. Ein Durchgang, der nur „es bricht
   * ab" prueft, saehe nicht, ob der strukturelle Riegel ueberhaupt da ist —
   * und genau der ist die Zusage.
   * ===================================================================== */
  {
    const befund67: string[] = [];
    let ok67 = true;
    const sag67 = (was: string, gut: boolean, text: string): void => {
      befund67.push(`${gut ? "" : "!! "}${was}: ${text}`);
      if (!gut) ok67 = false;
    };

    const db = await frischNach0136();
    await serienUndIdentitaet(db);
    const w67 = async (sql: string): Promise<string> =>
      String(((await db.query(sql)) as { rows: Record<string, unknown>[] }).rows[0]?.w ?? "?");
    const tu67 = async (sql: string): Promise<string | null> => {
      try { await db.exec(sql); return null; }
      catch (e) {
        const f = e as { message?: string; code?: string };
        return `[${f.code ?? "?"}] ${(f.message ?? "FEHLER").slice(0, 150)}`;
      }
    };

    await db.exec(`insert into public.categories (id, series_code, name, position)
                   values (10, 'SA', 'Figuren', 1), (11, 'G', 'Giants', 1);`);
    await db.exec(`create unique index if not exists z_sky7_uniq
                     on public.skylanders (sky_id);`);
    await db.exec(`create unique index if not exists z_ce7_uniq
                     on public.catalog_editorial (sky_id);`);
    await db.exec(`create sequence if not exists public.z_char7_seq start 1;
                   alter table public.characters
                     alter column id set default nextval('public.z_char7_seq');`);
    await db.exec(`create unique index if not exists z_char7_id
                     on public.characters (id);`);
    await db.exec(`create unique index if not exists characters_canonical_name_key
                     on public.characters (lower(canonical_name));`);
    await db.exec(`alter table public.skylanders
                     add constraint z_sk7_char_fk foreign key (character_id)
                     references public.characters (id);`);
    await db.exec(`alter table public.collection_items
                     add constraint z_ci7_sky_fk foreign key (sky_id)
                     references public.skylanders (sky_id);`);
    await db.exec(`create or replace function public.is_platform_admin() returns boolean
                   language sql as $stub$ select true $stub$;`);
    await db.exec(`alter table public.catalog_admin_changes
                     add constraint catalog_admin_changes_field_known
                     check (field in ('catalog_visible', 'display_name_override',
                                      'admin_note', 'catalog_group',
                                      'image_override_path', 'card_type', 'created',
                                      'catalog_status', 'merged_from', 'discarded',
                                      'character_id'));`);

    for (const m of ["0154_merge_draft_into_figure.sql", "0155_discard_draft.sql",
                     "0156_merge_selected_fields.sql",
                     "0157_audit_fields_and_automatic_notes.sql",
                     "0158_figure_families.sql"]) {
      const f = await fahre(db, join(MIG_DIR, m));
      if (f !== null) sag67(`Aufbau ${m.slice(0, 4)}`, false, f);
    }

    /* ---- Ohne 0158 bricht 0159 ab: die Reihenfolge ist echt. */
    {
      const leer = await frischNach0136();
      await serienUndIdentitaet(leer);
      await leer.exec(`create or replace function public.is_platform_admin() returns boolean
                       language sql as $stub$ select true $stub$;`);
      await leer.exec(`drop function if exists public.admin_set_character(text,bigint) cascade;`);
      const nur159 = await fahre(leer, join(MIG_DIR, "0159_variant_base_figure.sql"));
      sag67("0159 ohne 0158 bricht ab (die Vorbedingung ist echt)",
            nur159 !== null && nur159.includes("0158"),
            (nur159 ?? "DURCHGELAUFEN").slice(0, 58));
    }

    const anlegen67 = async (id: string, name: string, serie: string, kat: number,
                             status = "public") =>
      db.exec(`insert into public.skylanders
                 (sky_id, name, slug, series_code, category_id, item_type, card_type,
                  is_active, catalog_visible, catalog_status, source)
               values ('${id}', '${name}', '${id.toLowerCase()}', '${serie}', ${kat},
                  'figure', 'standard', true, ${status === "public"}, '${status}',
                  'admin');`);

    /* Die Welt: Spyro (SA), drei Varianten (SA), ein Spyro in Giants. */
    await anlegen67("SKY-0053", "Spyro", "SA", 10);
    await anlegen67("SKY-0825", "Chrome Spyro", "SA", 10, "draft");
    await anlegen67("SKY-0826", "Dark Spyro", "SA", 10);
    await anlegen67("SKY-0827", "Legendary Spyro", "SA", 10);
    await anlegen67("SKY-0900", "Spyro", "G", 11);     /* andere Serie */
    await db.exec(`insert into public.collection_items (user_id, sky_id, quantity)
                   values ('00000000-0000-0000-0000-00000000000d', 'SKY-0053', 6);`);

    const f159 = await fahre(db, join(MIG_DIR, "0159_variant_base_figure.sql"));
    const struktur = await w67(
      `select (select count(*)::text from pg_attribute a
                where a.attrelid = to_regclass('public.skylanders')
                  and a.attname = 'base_sky_id' and not a.attisdropped)
           || '|' || (select count(*)::text from pg_constraint c
                       where c.conrelid = to_regclass('public.skylanders')
                         and c.conname = 'skylanders_base_same_series' and c.contype = 'f')
           || '|' || (select count(*)::text from pg_constraint c
                       where c.conrelid = to_regclass('public.skylanders')
                         and c.conname = 'skylanders_id_series_uniq' and c.contype = 'u')
           || '|' || (select count(*)::text from pg_constraint c
                       where c.conrelid = to_regclass('public.skylanders')
                         and c.conname = 'skylanders_base_not_self' and c.contype = 'c')
           || '|' || (select count(*)::text from pg_trigger t
                       where t.tgrelid = to_regclass('public.skylanders')
                         and t.tgname = 'skylanders_variant_base_guard_trg'
                         and not t.tgisinternal) as w`);
    const journal12 = await w67(`select (pg_get_constraintdef(oid) like '%base_sky_id%')::text as w
                                 from pg_constraint
                                where conname = 'catalog_admin_changes_field_known'`);
    const fkDef = await w67(`select pg_get_constraintdef(oid) as w from pg_constraint
                             where conname = 'skylanders_base_same_series'`);
    sag67("0159 laeuft: Spalte, Serienriegel, Eindeutigkeit, Selbstbezugsriegel, "
          + "Kettenriegel und der zwoelfte Journalwert stehen",
          f159 === null && struktur === "1|1|1|1|1" && journal12 === "true",
          `${f159 ?? "durch"} · ${struktur} · Journal ${journal12}`);
    sag67("der Serienriegel nennt BEIDE Spalten und RESTRICT (nicht CASCADE)",
          fkDef.includes("base_sky_id") && fkDef.includes("series_code")
          && fkDef.includes("ON UPDATE RESTRICT"),
          fkDef);
    sag67("und die Migration hat NICHTS zugeordnet",
          (await w67("select count(*)::text as w from public.skylanders"
                     + " where base_sky_id is not null")) === "0",
          await w67("select count(*)::text as w from public.skylanders"
                    + " where base_sky_id is not null"));

    /* ---- DER SERIENRIEGEL IST STRUKTURELL: 23503 vom Fremdschluessel. */
    const fSerieRoh = await tu67(`update public.skylanders set base_sky_id = 'SKY-0900'
                                  where sky_id = 'SKY-0826';`);
    sag67("eine Basisfigur aus einer ANDEREN Serie weist der FREMDSCHLUESSEL ab "
          + "(23503) — nicht die Anwendung, nicht ein Trigger",
          fSerieRoh !== null && fSerieRoh.includes("23503")
          && fSerieRoh.includes("skylanders_base_same_series"),
          (fSerieRoh ?? "DURCHGELAUFEN").slice(0, 92));

    /* ---- DER SELBSTBEZUG: 23514 vom CHECK. */
    const fSelbstRoh = await tu67(`update public.skylanders set base_sky_id = 'SKY-0826'
                                   where sky_id = 'SKY-0826';`);
    sag67("der Selbstbezug weist ein CHECK ab (23514)",
          fSelbstRoh !== null && fSelbstRoh.includes("23514")
          && fSelbstRoh.includes("skylanders_base_not_self"),
          (fSelbstRoh ?? "DURCHGELAUFEN").slice(0, 80));

    /* ---- DIE GUTE ZUORDNUNG, ueber die RPC. */
    const fGut = await tu67(`select public.admin_set_variant_base('SKY-0826', 'SKY-0053');`);
    const nachGut = await w67(`select sky_id || '|' || name || '|' || slug || '|'
                                 || coalesce(base_sky_id,'-') || '|' || series_code
                                 || '|' || catalog_status || '|' || card_type as w
                               from public.skylanders where sky_id = 'SKY-0826'`);
    const basisUnberuehrt = await w67(`select name || '|' || coalesce(base_sky_id,'-')
                                         || '|' || coalesce(character_id::text,'-') as w
                                       from public.skylanders where sky_id = 'SKY-0053'`);
    const sammlung = await w67(`select coalesce(max(quantity)::text,'-') as w
                                from public.collection_items where sky_id = 'SKY-0053'`);
    const jBase = await w67(`select coalesce(string_agg(coalesce(old_value,'-') || '->'
                                            || coalesce(new_value,'-'), ', ' order by id),'-') as w
                             from public.catalog_admin_changes
                            where entity_id = 'SKY-0826' and field = 'base_sky_id'`);
    sag67("zugeordnet: SKY-ID, Name, Slug, Serie, Status und Edition bleiben; die "
          + "Basisfigur und ihre Sammlung sind unberuehrt; das Journal fuehrt es",
          fGut === null
          && nachGut === "SKY-0826|Dark Spyro|sky-0826|SKY-0053|SA|public|standard"
          && basisUnberuehrt === "Spyro|-|-" && sammlung === "6"
          && jBase === "-->SKY-0053",
          `${fGut ?? "durch"} · ${nachGut} · Basis ${basisUnberuehrt} · Sammlung `
          + `${sammlung} · Journal [${jBase}]`);

    /* ---- KEINE KETTEN, BEIDE RICHTUNGEN. */
    const fKette1 = await tu67(`select public.admin_set_variant_base('SKY-0827', 'SKY-0826');`);
    const fKette2 = await tu67(`select public.admin_set_variant_base('SKY-0053', 'SKY-0827');`);
    const fKetteRoh = await tu67(`update public.skylanders set base_sky_id = 'SKY-0826'
                                  where sky_id = 'SKY-0827';`);
    sag67("Varianten von Varianten: beide Richtungen abgewiesen — und auch der rohe "
          + "UPDATE, der die RPC umgeht, faellt am Trigger",
          fKette1 !== null && fKette1.includes("selbst eine Variante")
          && fKette2 !== null && fKette2.includes("zeigen schon Varianten")
          && fKetteRoh !== null && fKetteRoh.includes("Varianten von"),
          `${(fKette1 ?? "DURCH").slice(0, 34)} | ${(fKette2 ?? "DURCH").slice(0, 34)} `
          + `| roh ${(fKetteRoh ?? "DURCH").slice(0, 30)}`);

    /* ---- SERIENAENDERUNG an einer Basisfigur mit Varianten: RESTRICT. */
    const fSerieWechsel = await tu67(`update public.skylanders set series_code = 'G',
                                        category_id = 11 where sky_id = 'SKY-0053';`);
    const serieNoch = await w67(`select series_code as w from public.skylanders
                                 where sky_id = 'SKY-0053'`);
    /*
     * `23001` IST DER BEWEIS, NICHT EIN DETAIL. PostgreSQL meldet
     * `restrict_violation` nur bei einem ausdruecklichen `RESTRICT`; ein
     * `NO ACTION` haette `23503` ergeben und ein `CASCADE` haette die Serie
     * der Varianten stillschweigend mitgezogen. Der Fehlercode sagt also,
     * WELCHE der drei Fassungen wirklich dasteht.
     */
    sag67("eine Serienaenderung an einer Basisfigur mit Varianten wird ABGEWIESEN, "
          + "und der Code 23001 belegt RESTRICT (nicht CASCADE, nicht NO ACTION) "
          + "— die Serie steht unveraendert",
          fSerieWechsel !== null && fSerieWechsel.includes("23001")
          && fSerieWechsel.includes("skylanders_base_same_series")
          && serieNoch === "SA",
          `${(fSerieWechsel ?? "DURCHGELAUFEN").slice(0, 86)} · Serie ${serieNoch}`);

    /*
     * ---- LOESCHEN einer Basisfigur mit Varianten.
     *
     * AN EINER FIGUR OHNE SAMMLUNGSZEILE. Der erste Versuch nahm SKY-0053,
     * und die traegt eine Sammlungszeile — geblockt haette dann der
     * Sammlungsschluessel (`23503`) und nicht der Variantenschluessel. Der
     * Durchgang waere gruen gewesen, ohne die Zusage geprueft zu haben.
     * Hier steht eine Basisfigur, auf die NUR eine Variante zeigt.
     */
    await anlegen67("SKY-0940", "Wrecking Ball", "SA", 10);
    await anlegen67("SKY-0941", "Chrome Wrecking Ball", "SA", 10);
    await db.exec(`select public.admin_set_variant_base('SKY-0941', 'SKY-0940');`);
    const fLoeschRoh = await tu67("delete from public.skylanders where sky_id = 'SKY-0940';");
    const refs = await w67(`select coalesce(string_agg(tabelle || ':' || zeilen::text, ', '),'-') as w
                            from public.admin_merge_references('SKY-0940')`);
    const nochDa67 = await w67(`select count(*)::text as w from public.skylanders
                                where sky_id = 'SKY-0940'`);
    sag67("eine Basisfigur, auf die NUR eine Variante zeigt, wird nicht geloescht "
          + "(23001 vom Variantenschluessel) — und admin_merge_references zaehlt sie, "
          + "weil sie aus pg_constraint herleitet und 0159 sie mehrspaltig lesen lehrt",
          fLoeschRoh !== null && fLoeschRoh.includes("23001")
          && fLoeschRoh.includes("skylanders_base_same_series")
          && refs.includes("skylanders:1") && nochDa67 === "1",
          `${(fLoeschRoh ?? "DURCHGELAUFEN").slice(0, 80)} · Verweise [${refs}] `
          + `· steht noch ${nochDa67}`);

    /* ---- DIE FAMILIE, vier Lagen. */
    const famA = await w67(`select public.admin_create_character('Spyro')::text as w`);
    await db.exec(`select public.admin_set_character('SKY-0053', ${famA});`);
    /* (1) Basisfigur hat eine, Variante keine -> uebernehmen. */
    const r1 = await w67(`select (public.admin_set_variant_base('SKY-0827', 'SKY-0053')
                                   ->> 'family') as w`);
    const fam1 = await w67(`select coalesce(character_id::text,'-') as w
                            from public.skylanders where sky_id = 'SKY-0827'`);
    /* (2) beide dieselbe -> nichts. */
    const r2 = await w67(`select (public.admin_set_variant_base('SKY-0827', 'SKY-0053')
                                   ->> 'family') as w`);
    /* (3) verschiedene -> Abbruch. */
    const famB = await w67(`select public.admin_create_character('Eruptor')::text as w`);
    await db.exec(`select public.admin_set_character('SKY-0825', ${famB});`);
    const r3 = await tu67(`select public.admin_set_variant_base('SKY-0825', 'SKY-0053');`);
    const fam3 = await w67(`select coalesce(character_id::text,'-') || '|'
                              || coalesce(base_sky_id,'-') as w
                            from public.skylanders where sky_id = 'SKY-0825'`);
    sag67("die Familie: aus der Basisfigur uebernommen, beim zweiten Mal unveraendert, "
          + "und ein WIDERSPRUCH bricht ab, ohne etwas zu ueberschreiben",
          r1 === "aus der Basisfigur uebernommen" && fam1 === famA
          && r2 === "war schon dieselbe"
          && r3 !== null && r3.includes("klaeren") && fam3 === `${famB}|-`,
          `(1) ${r1} -> ${fam1} · (2) ${r2} · (3) ${(r3 ?? "DURCH").slice(0, 30)} `
          + `· unveraendert ${fam3}`);

    /* (4) beide ohne Familie: nur mit ausdruecklicher Bestaetigung. */
    await anlegen67("SKY-0930", "Bash", "SA", 10);
    await anlegen67("SKY-0931", "Chrome Bash", "SA", 10);
    const r4a = await w67(`select (public.admin_set_variant_base('SKY-0931', 'SKY-0930', false)
                                    ->> 'family') as w`);
    const fam4a = await w67(`select coalesce(character_id::text,'(null)') as w
                             from public.skylanders where sky_id = 'SKY-0931'`);
    const r4b = await w67(`select (public.admin_set_variant_base('SKY-0931', 'SKY-0930', true)
                                    ->> 'family') as w`);
    const fam4b = await w67(`select coalesce(string_agg(sky_id || '=' || character_id::text,
                                              ', ' order by sky_id),'-') as w
                             from public.skylanders
                            where sky_id in ('SKY-0930', 'SKY-0931')
                              and character_id is not null`);
    sag67("beide ohne Familie: ohne Bestaetigung wird KEINE angelegt, mit Bestaetigung "
          + "eine, und beide bekommen sie",
          r4a === "beide ohne Familie — keine angelegt" && fam4a === "(null)"
          && r4b === "neu angelegt und beiden zugeordnet"
          && fam4b.includes("SKY-0930=") && fam4b.includes("SKY-0931="),
          `ohne: ${r4a} (${fam4a}) · mit: ${r4b} (${fam4b})`);

    /* ---- UMORDNEN und LOESEN. */
    await anlegen67("SKY-0932", "Dino-Rang", "SA", 10);
    const rUm = await w67(`select (public.admin_set_variant_base('SKY-0931', 'SKY-0932')
                                    ->> 'base_sky_id') as w`);
    const rWeg = await w67(`select coalesce(public.admin_set_variant_base('SKY-0931', null)
                                     ->> 'base_sky_id', '(null)') as w`);
    const nachWeg = await w67(`select coalesce(base_sky_id,'(null)') as w
                               from public.skylanders where sky_id = 'SKY-0931'`);
    const jAlle = await w67(`select coalesce(string_agg(coalesce(old_value,'-') || '->'
                                             || coalesce(new_value,'-'), ', ' order by id),'-') as w
                             from public.catalog_admin_changes
                            where entity_id = 'SKY-0931' and field = 'base_sky_id'`);
    sag67("umordnen und loesen gehen, und das Journal fuehrt jeden Schritt",
          rUm === "SKY-0932" && rWeg === "(null)" && nachWeg === "(null)"
          && jAlle === "-->SKY-0930, SKY-0930->SKY-0932, SKY-0932->-",
          `${rUm} -> ${rWeg} · Journal [${jAlle}]`);

    /* ---- WEG B: veroeffentlichen und zuordnen in EINER Transaktion. */
    await anlegen67("SKY-0933", "Silver Bash", "SA", 10, "draft");
    const vorB67 = await w67(`select catalog_status || '|' || coalesce(base_sky_id,'-') as w
                              from public.skylanders where sky_id = 'SKY-0933'`);
    const fB67 = await tu67(`select public.admin_publish_with_base('SKY-0933', 'SKY-0930');`);
    const nachB67 = await w67(`select catalog_status || '|' || catalog_visible::text || '|'
                                 || coalesce(base_sky_id,'-') || '|' || slug as w
                               from public.skylanders where sky_id = 'SKY-0933'`);
    sag67("WEG B: aus dem Entwurf wird eine veroeffentlichte Variante — in einer "
          + "Transaktion, mit eigenem Slug",
          fB67 === null && vorB67 === "draft|-"
          && nachB67 === "public|true|SKY-0930|sky-0933",
          `${fB67 ?? "durch"} · ${vorB67} -> ${nachB67}`);

    /* Eine schon veroeffentlichte Figur geht nicht durch Weg B. */
    const fB67Oeff = await tu67(`select public.admin_publish_with_base('SKY-0930', 'SKY-0932');`);
    sag67("Weg B weist eine schon veroeffentlichte Figur ab",
          fB67Oeff !== null && fB67Oeff.includes("kein Entwurf"),
          (fB67Oeff ?? "DURCHGELAUFEN").slice(0, 44));

    /* ---- RECHTE. */
    await db.exec(`create or replace function public.is_platform_admin() returns boolean
                   language sql as $stub$ select false $stub$;`);
    const kSet67 = await tu67(`select public.admin_set_variant_base('SKY-0931', 'SKY-0930');`);
    const kPub67 = await tu67(`select public.admin_publish_with_base('SKY-0931', 'SKY-0930');`);
    await db.exec(`create or replace function public.is_platform_admin() returns boolean
                   language sql as $stub$ select true $stub$;`);
    sag67("ohne Adminrecht weisen beide ab (42501)",
          [kSet67, kPub67].every((x) => x !== null && x.includes("42501")),
          [kSet67, kPub67].map((x) => (x ?? "DURCH").slice(0, 20)).join(" | "));

    /* ---- VOLLSTAENDIGER ROLLBACK an der Journalzeile. */
    await db.exec(`alter table public.catalog_admin_changes
                     drop constraint catalog_admin_changes_field_known;`);
    await db.exec(`alter table public.catalog_admin_changes
                     add constraint catalog_admin_changes_field_known
                     check (field <> 'base_sky_id') not valid;`);
    const vorRoll67 = await w67(`select coalesce(base_sky_id,'-') || '|'
                                   || coalesce(character_id::text,'-') as w
                                 from public.skylanders where sky_id = 'SKY-0931'`);
    const fRoll67 = await tu67(`select public.admin_set_variant_base('SKY-0931', 'SKY-0930');`);
    const nachRoll67 = await w67(`select coalesce(base_sky_id,'-') || '|'
                                    || coalesce(character_id::text,'-') as w
                                  from public.skylanders where sky_id = 'SKY-0931'`);
    sag67("ein Fehler an der Journalzeile rollt die ganze Zuordnung zurueck — "
          + "Basisfigur UND Familie stehen danach wie vorher",
          fRoll67 !== null && fRoll67.includes("23514") && nachRoll67 === vorRoll67,
          `${(fRoll67 ?? "DURCHGELAUFEN").slice(0, 34)} · ${nachRoll67} `
          + `(vorher ${vorRoll67})`);

    probe.push({
      name: "P67 0159 mit den ECHTEN Schluesseln: die Serienregel weist eine fremde "
        + "Serie als FREMDSCHLUESSEL ab (23503) und nicht als Anwendungslogik, der "
        + "Selbstbezug als CHECK (23514), die Ketten in beiden Richtungen am Trigger "
        + "— auch bei einem rohen UPDATE, der die RPC umgeht. Serienaenderung und "
        + "Loeschen einer Basisfigur mit Varianten werden abgewiesen, "
        + "admin_merge_references zaehlt sie ohne eine Zeile Aenderung, die Familie "
        + "kommt in vier Lagen richtig heraus (Widerspruch bricht ab), umordnen und "
        + "loesen fuehren Journal, Weg B ist atomar — und ein Fehler an der "
        + "Journalzeile rollt alles zurueck",
      ok: ok67,
      sagt: `0159: ${befund67.join(" · ")}`,
    });
  }

  /* =====================================================================
   * P68 — die MASKIERUNG eines LIKE-Musters, an der echten Semantik.
   *
   * WARUM DIESER DURCHGANG EXISTIERT. Am 2026-10-28 hat die Nachkontrolle
   * von `0159` mit `9999 = 1` abgewichen — an Zeile 123, und die Ursache lag
   * wieder in der PRUEFDATEI. Sie suchte in `pg_proc.proconfig` nach
   *
   *     c like 'search\\_path=%'      (zwei Backslashes)
   *
   * SQL `LIKE` deutet `\\` als EINEN echten Backslash im Suchmuster. Die
   * Zeile suchte also Eintraege, die woertlich mit `search\_path=` beginnen —
   * die gibt es nicht, die Zaehlung war 0, und die Zeile meldete 0 statt 2,
   * obwohl beide Funktionen richtig konfiguriert sind.
   *
   * WAS KEIN ANDERES WERKZEUG FINDET. Die Datei ist syntaktisch
   * einwandfrei, jeder Name loest auf, jeder Typ passt — Stufe 2 dieses
   * Laufs ist gruen und bleibt gruen. Der Fehler sitzt in der BEDEUTUNG des
   * Musters, und die sieht nur, wer es gegen echte `proconfig`-Eintraege
   * haelt. Genau das tut dieser Durchgang.
   *
   * ER LIEST DIE PRUEFDATEI SELBST, nicht eine Kopie des Musters: nur so
   * sagt er etwas ueber das Artefakt, das am Ende im SQL-Editor laeuft.
   * ===================================================================== */
  {
    const befund68: string[] = [];
    let ok68 = true;
    const sag68 = (was: string, gut: boolean, text: string): void => {
      befund68.push(`${gut ? "" : "!! "}${was}: ${text}`);
      if (!gut) ok68 = false;
    };

    const db = new PGlite();
    const z68 = async (sql: string): Promise<string> =>
      String(((await db.query(sql)) as { rows: Record<string, unknown>[] }).rows[0]?.w ?? "?");

    /*
     * Zwei Attrappen mit den ECHTEN Signaturen aus `0159` und derselben
     * Festlegung, die die Migration setzt: `security definer` und ein leerer
     * Suchpfad. Mehr braucht es nicht — gemessen wird `pg_proc`, nicht das
     * Verhalten der Funktionen.
     */
    for (const sig of ["admin_set_variant_base(p_a text, p_b text, p_c boolean)",
                       "admin_publish_with_base(p_a text, p_b text, p_c boolean)"]) {
      await db.exec(`create function public.${sig} returns text
                     language sql security definer set search_path = ''
                     as $stub$ select 'ok'::text $stub$;`);
    }

    /* ---- Die Semantik selbst, nebeneinander. */
    const einfach68 = await z68(`select count(*)::text as w
                                   from pg_proc p,
                                        unnest(coalesce(p.proconfig, '{}')) c
                                  where p.proname = 'admin_set_variant_base'
                                    and c like 'search\\_path=%'`);
    const doppelt68 = await z68(`select count(*)::text as w
                                   from pg_proc p,
                                        unnest(coalesce(p.proconfig, '{}')) c
                                  where p.proname = 'admin_set_variant_base'
                                    and c like 'search\\\\_path=%'`);
    sag68("ein Backslash trifft den Eintrag, zwei treffen nichts",
          einfach68 === "1" && doppelt68 === "0",
          `einfach ${einfach68} · doppelt ${doppelt68}`);

    /* ---- Und was wirklich in `proconfig` steht. */
    const wert68 = await z68(`select string_agg(c, ' | ') as w
                                from pg_proc p,
                                     unnest(coalesce(p.proconfig, '{}')) c
                               where p.proname = 'admin_set_variant_base'`);
    sag68("der Eintrag traegt keinen Backslash, deshalb kann ihn keiner finden",
          !wert68.includes("\\"), wert68);

    /*
     * ---- DIE ZEILE SELBST, aus der Datei gelesen.
     *
     * Der Ausdruck wird woertlich uebernommen und gefahren. Stimmt die
     * Maskierung in `supabase/checks/0159_postflight.sql` nicht, kommt hier
     * 0 heraus — und dieser Durchgang bricht ab, bevor jemand den
     * SQL-Editor oeffnet.
     */
    const datei68 = readFileSync(join(process.cwd(), CHECK_DIR, "0159_postflight.sql"), "utf8");
    /*
     * Die runde Klammer am Ende GEHOERT in den Ausdruck. Nimmt man sie ins
     * Trennmuster, kommt ein unbalancierter Ausdruck heraus und PostgreSQL
     * meldet `syntax error at or near "as"` — beim ersten Versuch genau so
     * passiert.
     */
    const roh68 = /\n {2}\(123, '[^']*', '[^']*',\n([\s\S]*?\)), '(\d+)'\),\n/.exec(datei68);
    sag68("Zeile 123 laesst sich aus der Pruefdatei lesen", roh68 !== null,
          roh68 === null ? "NICHT GEFUNDEN" : `erwartet ${roh68[2]}`);
    if (roh68 !== null) {
      const ist68 = await z68(`select (${roh68[1].trim()}) as w`);
      sag68("und sie zaehlt an zwei richtig konfigurierten Funktionen wirklich zwei",
            ist68 === roh68[2], `${ist68} (erwartet ${roh68[2]})`);
    }

    /* ---- Gegenprobe: eine Funktion OHNE Festlegung darf nicht mitzaehlen. */
    await db.exec(`create or replace function public.admin_publish_with_base(
                     p_a text, p_b text, p_c boolean) returns text
                   language sql security definer
                   as $stub$ select 'ok'::text $stub$;`);
    if (roh68 !== null) {
      const ohne68 = await z68(`select (${roh68[1].trim()}) as w`);
      sag68("nimmt man einer Funktion den Suchpfad, zaehlt die Zeile nur noch eine "
            + "— sie prueft also wirklich, was sie behauptet",
            ohne68 === "1", `${ohne68} (vorher ${roh68[2]})`);
    }

    probe.push({
      name: "P68 die Maskierung von Zeile 123: ein Backslash trifft den "
        + "proconfig-Eintrag, zwei treffen nichts — und der Ausdruck AUS DER "
        + "Pruefdatei zaehlt an zwei richtig konfigurierten Funktionen zwei, an "
        + "einer entwaffneten nur eine",
      ok: ok68,
      sagt: `0159 Zeile 123: ${befund68.join(" · ")}`,
    });
  }

  /* =====================================================================
   * P69 — 0160: `base_sky_id` in der Plattformsicherung, und der UMLAUF
   *       MIT DER SCHLECHTESTEN REIHENFOLGE.
   *
   * WAS DIESER DURCHGANG ZEIGT. P66 hat dieselbe Frage fuer `catalog_status`
   * beantwortet; hier kommt eine Schwierigkeit dazu, die es dort nicht gab:
   * `base_sky_id` zeigt auf DIESELBE Tabelle. Eine Wiederherstellung hat
   * damit eine Reihenfolge INNERHALB einer Tabelle — und das ist der Fall,
   * den eine Tabellenreihenfolge nicht loest.
   *
   * Deshalb faehrt dieser Durchgang den Umlauf an erfundenen Zeilen: eine
   * Basisfigur und DREI Varianten, exportieren, loeschen, und aus dem Archiv
   * wieder einspielen — in der SCHLECHTESTEN Reihenfolge, Varianten zuerst.
   * Einmal OHNE `0160` (da fehlt das Feld, und die Beziehung ist fort) und
   * einmal MIT.
   *
   * DAZU DIE VIER MESSUNGEN, die `supabase/checks/0160_restore_order.md`
   * behauptet, und keine davon ist hier eine Behauptung:
   *
   *   A  EINE Anweisung, Varianten vor der Basisfigur      -> laeuft durch
   *   B  ZWEI Anweisungen, Variante zuerst                 -> 23503
   *   C  erst alles mit NULL, dann ein UPDATE              -> durch, 0 Journalzeilen
   *   D  `set constraints all deferred` auf einem nicht
   *      aufschiebbaren Fremdschluessel                    -> wirkungslos, 23503
   *
   * D IST DER WICHTIGSTE. Die Anweisung laeuft ohne Fehler durch und tut
   * nichts — wer glaubt, er habe die Pruefung aufgeschoben, hat sie nicht
   * aufgeschoben. Eine Falle, die mitten in einer Wiederherstellung
   * auffaellt.
   *
   * Dazu die Riegel: ohne `0159` bricht `0160` ab, gegen eine fremde Fassung
   * ebenso, ein zweiter Lauf prallt ab, und die Ruecknahme stellt den Rumpf
   * aus `0153` zeichengleich her — EINEN Schritt zurueck, nicht zwei.
   * ===================================================================== */
  {
    const befund69: string[] = [];
    let ok69 = true;
    const sag69 = (was: string, gut: boolean, text: string): void => {
      befund69.push(`${gut ? "" : "!! "}${was}: ${text}`);
      if (!gut) ok69 = false;
    };

    const M160 = join(MIG_DIR, "0160_platform_export_base_sky_id.sql");
    const R160 = "supabase/rollback/R0160_platform_export_back_to_0153.sql";
    /* Die zwei fremden Fassungen (`0105` und `0144`) werden hier an der
       MELDUNG erkannt und nicht am Abdruck: die Zusage ist, dass die
       Migration SAGT, welche Fassung dasteht — nicht nur, dass sie
       abbricht. */
    const A0153 = "92c48444f99b9e294f9703d0c0ddeaa8";
    const A0160 = "ff4f38e61cbd4e5857ea914d6be68d44";

    const anweisungVon69 = (datei: string): string => {
      const sql = readFileSync(datei, "utf8");
      const von = sql.indexOf("create or replace function public.system_platform_export()");
      const bis = sql.indexOf("\n$$;", von) + "\n$$;".length;
      return sql.slice(von, bis);
    };

    const db = await frischNach0136();
    await serienUndIdentitaet(db);
    const w69 = async (sql: string): Promise<string> =>
      String(((await db.query(sql)) as { rows: Record<string, unknown>[] }).rows[0]?.w ?? "?");
    const tu69 = async (sql: string): Promise<string | null> => {
      try { await db.exec(sql); return null; }
      catch (e) {
        const f = e as { message?: string; code?: string };
        return `[${f.code ?? "?"}] ${(f.message ?? "FEHLER").slice(0, 150)}`;
      }
    };
    const abdruck69 = async (): Promise<string> => w69(
      "select md5(prosrc) as w from pg_proc p join pg_namespace n on n.oid = p.pronamespace"
      + " where n.nspname = 'public' and p.proname = 'system_platform_export'");

    await db.exec(`create schema if not exists auth;
                   create table if not exists auth.users (id uuid primary key);`);
    await db.exec(`create or replace function public.is_platform_admin() returns boolean
                   language sql as $stub$ select true $stub$;`);
    await db.exec(`insert into public.categories (id, series_code, name, position)
                   values (10, 'SA', 'Figuren', 1), (11, 'G', 'Giants', 1);`);

    /*
     * DIE ECHTEN SCHLUESSEL UND DIE ECHTE AUDIT-CONSTRAINT, wie in P67. Ohne
     * sie koennte dieser Durchgang seine wichtigste Frage nicht stellen: die
     * Reihenfolge zaehlt NUR, weil der Fremdschluessel wirklich dasteht.
     */
    await db.exec(`create unique index if not exists z_sky9_uniq
                     on public.skylanders (sky_id);`);
    await db.exec(`create unique index if not exists z_ce9_uniq
                     on public.catalog_editorial (sky_id);`);
    await db.exec(`create sequence if not exists public.z_char9_seq start 1;
                   alter table public.characters
                     alter column id set default nextval('public.z_char9_seq');
                   create unique index if not exists z_char9_id
                     on public.characters (id);
                   create unique index if not exists characters_canonical_name_key
                     on public.characters (lower(canonical_name));`);
    await db.exec(`alter table public.catalog_admin_changes
                     add constraint catalog_admin_changes_field_known
                     check (field in ('catalog_visible', 'display_name_override',
                                      'admin_note', 'catalog_group',
                                      'image_override_path', 'card_type', 'created',
                                      'catalog_status', 'merged_from', 'discarded',
                                      'character_id'));`);

    /* ---- Der Rumpf aus `0153`, und darauf baut alles auf. */
    await db.exec("set check_function_bodies = off;");
    await db.exec(anweisungVon69(join(MIG_DIR, "0144_platform_export_calculations.sql")));
    await db.exec("set check_function_bodies = on;");
    await db.exec(`alter table public.skylanders drop column if exists catalog_status;
                   alter table public.skylanders add column catalog_status text;
                   update public.skylanders set catalog_status =
                     case when catalog_visible then 'public' else 'hidden' end;
                   alter table public.skylanders alter column catalog_status set not null;`);
    const f153 = await fahre(db, join(MIG_DIR, "0153_platform_export_catalog_status.sql"));
    sag69("Aufbau: 0153 laeuft, der Rumpf ist der aus 0153",
          f153 === null && (await abdruck69()) === A0153,
          `${f153 ?? "durch"} · ${await abdruck69()}`);

    /*
     * ---- OHNE 0159 bricht 0160 ab: die Vorbedingung ist echt.
     *
     * DIE SPALTE IST IM STUB SCHON DA (dokumentierter Werkzeugbefund: das
     * Stub-Schema entsteht aus ALLEN Migrationen). Fuer diesen Riegel muss
     * sie weg — das ist die Lage, in der `0160` ohne `0159` wirklich laeuft.
     * `cascade` nimmt den Fremdschluessel und den CHECK mit, die der Stub
     * ohnehin nicht traegt; `0159` legt beides unten neu an.
     */
    await db.exec("alter table public.skylanders drop column base_sky_id cascade;");
    const ohne0159 = await fahre(db, M160);
    sag69("ohne 0159 bricht 0160 ab (skylanders.base_sky_id fehlt)",
          ohne0159 !== null && ohne0159.includes("0159"),
          (ohne0159 ?? "DURCHGELAUFEN").slice(0, 58));

    /* ---- Jetzt 0154-0159, damit die Spalte und die Riegel wirklich da sind. */
    for (const m of ["0154_merge_draft_into_figure.sql", "0155_discard_draft.sql",
                     "0156_merge_selected_fields.sql",
                     "0157_audit_fields_and_automatic_notes.sql",
                     "0158_figure_families.sql", "0159_variant_base_figure.sql"]) {
      const f = await fahre(db, join(MIG_DIR, m));
      if (f !== null) sag69(`Aufbau ${m.slice(0, 4)}`, false, f);
    }
    const riegel69 = await w69(
      `select (count(*) filter (where c.conname = 'skylanders_base_same_series'
                                 and c.confrelid = c.conrelid
                                 and array_length(c.conkey, 1) = 2
                                 and c.confupdtype = 'r' and c.confdeltype = 'r'))::text as w
         from pg_constraint c where c.conrelid = to_regclass('public.skylanders')`);
    sag69("der zweispaltige Selbst-Fremdschluessel mit RESTRICT steht",
          riegel69 === "1", riegel69);

    /* ================================================================
     * EINE BASISFIGUR UND DREI VARIANTEN.
     * ============================================================= */
    const anlegen69 = async (id: string, name: string, basis: string | null) =>
      db.exec(`insert into public.skylanders
                 (sky_id, name, slug, series_code, category_id, item_type, card_type,
                  is_active, catalog_visible, catalog_status, source, base_sky_id)
               values ('${id}', '${name}', '${id.toLowerCase()}', 'SA', 10,
                  'figure', 'standard', true, true, 'public', 'admin',
                  ${basis === null ? "null" : `'${basis}'`});`);
    await anlegen69("SKY-9001", "P69 Spyro", null);
    await anlegen69("SKY-9002", "P69 Chrome Spyro", "SKY-9001");
    await anlegen69("SKY-9003", "P69 Dark Spyro", "SKY-9001");
    await anlegen69("SKY-9004", "P69 Legendary Spyro", "SKY-9001");

    /** Der Katalogbereich des Archivs, als eine Zeile je SKY-ID. */
    const archivBasis = async (): Promise<string> => w69(
      `select coalesce(string_agg(x.sky_id || '->' || coalesce(x.basis, '(FEHLT)'),
                                  ', ' order by x.sky_id), '(leer)') as w
         from (select e ->> 'sky_id' as sky_id, e ->> 'base_sky_id' as basis
                 from jsonb_array_elements(
                        (public.system_platform_export() -> 'data' -> 'skylanders')) as e
                where e ->> 'sky_id' like 'SKY-900%') x`);

    /* ---- OHNE 0160: das Archiv kennt die Beziehung NICHT. Genau die Luecke. */
    const vorher69 = await archivBasis();
    sag69("OHNE 0160 fuehrt das Archiv kein base_sky_id — jede Variante stuende nach "
          + "einer Wiederherstellung allein",
          vorher69 === "SKY-9001->(FEHLT), SKY-9002->(FEHLT), SKY-9003->(FEHLT), "
                     + "SKY-9004->(FEHLT)", vorher69);
    /* Und die Familie waere da — das ist der Grund, warum es LEISE ist. */
    const familie69 = await w69(
      `select coalesce(string_agg(e ->> 'sky_id' || '=' || coalesce(e ->> 'character_id', '-'),
                                  ', ' order by e ->> 'sky_id'), '(leer)') as w
         from jsonb_array_elements(
                (public.system_platform_export() -> 'data' -> 'skylanders')) as e
        where e ->> 'sky_id' like 'SKY-900%'`);
    sag69("das Archiv fuehrt character_id schon (die FAMILIE) — es fehlt nur die MITTE",
          familie69.includes("SKY-9002="), familie69.slice(0, 48));

    /* ---- Gegen eine fremde Fassung bricht sie ab. */
    await db.exec("set check_function_bodies = off;");
    await db.exec(anweisungVon69(join(MIG_DIR, "0105_platform_export.sql")));
    await db.exec("set check_function_bodies = on;");
    const gegen0105 = await fahre(db, M160);
    sag69("gegen den Rumpf aus 0105 bricht sie ab, statt ihn zu ueberschreiben",
          gegen0105 !== null && gegen0105.includes("0105"),
          (gegen0105 ?? "DURCHGELAUFEN").slice(0, 60));
    await db.exec("set check_function_bodies = off;");
    await db.exec(anweisungVon69(join(MIG_DIR, "0144_platform_export_calculations.sql")));
    await db.exec("set check_function_bodies = on;");
    const gegen0144 = await fahre(db, M160);
    sag69("und gegen den aus 0144 ebenso — mit eigener Meldung",
          gegen0144 !== null && gegen0144.includes("0144"),
          (gegen0144 ?? "DURCHGELAUFEN").slice(0, 60));
    await db.exec("set check_function_bodies = off;");
    await db.exec(anweisungVon69(join(MIG_DIR, "0153_platform_export_catalog_status.sql")));
    await db.exec("set check_function_bodies = on;");

    /* ---- 0160 laeuft. */
    const lauf69 = await fahre(db, M160);
    const nach69 = await abdruck69();
    const laenge69 = await w69(
      "select length(prosrc)::text as w from pg_proc p join pg_namespace n"
      + " on n.oid = p.pronamespace where n.nspname = 'public'"
      + " and p.proname = 'system_platform_export'");
    sag69("0160 laeuft; der Rumpf ist der zugesagte und 31114 Zeichen lang",
          lauf69 === null && nach69 === A0160 && laenge69 === "31114",
          `${lauf69 ?? "durch"} · ${nach69} · ${laenge69} Zeichen`);

    /* DIE UMKEHRPROBE AM LEBENDEN RUMPF. */
    const zurueck69 = await w69(
      "select md5(replace(prosrc, E'\\n            ''base_sky_id'', t.base_sky_id,',"
      + " '')) as w from pg_proc p join pg_namespace n on n.oid = p.pronamespace"
      + " where n.nspname = 'public' and p.proname = 'system_platform_export'");
    sag69("zieht man die eine Zeile ab, ist er zeichengleich der aus 0153",
          zurueck69 === A0153, zurueck69);

    /* ---- MIT 0160: das Archiv fuehrt die Beziehung. */
    const nachher69 = await archivBasis();
    sag69("MIT 0160 fuehrt das Archiv die Basisfigur jeder Variante",
          nachher69 === "SKY-9001->(FEHLT), SKY-9002->SKY-9001, SKY-9003->SKY-9001, "
                      + "SKY-9004->SKY-9001", nachher69);

    /* ================================================================
     * DER UMLAUF, IN DER SCHLECHTESTEN REIHENFOLGE.
     *
     * Das Archiv sortiert nach `sky_id`, also gerade nicht nach
     * Abhaengigkeit. Hier wird absichtlich UMGEKEHRT eingespielt — die drei
     * Varianten zuerst, die Basisfigur zuletzt — und zwar in EINER
     * Anweisung. Laeuft das durch, ist die Reihenfolge der Katalogzeilen im
     * Archiv gleichgueltig, und genau das ist die Zusage.
     * ============================================================= */
    await db.exec(`create table z_archiv69 as
                   select public.system_platform_export() as doc;`);
    await db.exec("delete from public.skylanders where sky_id like 'SKY-900%';");
    const weg69 = await w69("select count(*)::text as w from public.skylanders"
                            + " where sky_id like 'SKY-900%'");
    const einEinzeln = `
      insert into public.skylanders
        (sky_id, name, slug, series_code, category_id, item_type, card_type,
         is_active, catalog_visible, catalog_status, source, base_sky_id)
      select e ->> 'sky_id', e ->> 'name', e ->> 'slug', e ->> 'series_code',
             (e ->> 'category_id')::bigint, 'figure', 'standard',
             (e ->> 'is_active')::boolean, (e ->> 'catalog_visible')::boolean,
             e ->> 'catalog_status', 'admin', e ->> 'base_sky_id'
        from z_archiv69 z, jsonb_array_elements(z.doc -> 'data' -> 'skylanders') as e
       where e ->> 'sky_id' like 'SKY-900%'`;
    /* A: EINE Anweisung, absteigend sortiert — Varianten vor der Basisfigur. */
    const einA = await tu69(`${einEinzeln} order by e ->> 'sky_id' desc;`);
    const danach69 = await w69(
      `select coalesce(string_agg(sky_id || '->' || coalesce(base_sky_id, '-'),
                                  ', ' order by sky_id), '(leer)') as w
         from public.skylanders where sky_id like 'SKY-900%'`);
    sag69("DER UMLAUF in der schlechtesten Reihenfolge: EINE Anweisung, Varianten vor "
          + "der Basisfigur — laeuft durch, und jede Beziehung steht wieder",
          weg69 === "0" && einA === null
          && danach69 === "SKY-9001->-, SKY-9002->SKY-9001, SKY-9003->SKY-9001, "
                        + "SKY-9004->SKY-9001",
          `geloescht ${weg69} · ${einA ?? "eingespielt"} · ${danach69}`);

    /* B: ZWEI Anweisungen, Variante zuerst — das MUSS scheitern. */
    await db.exec("delete from public.skylanders where sky_id like 'SKY-900%';");
    const einB = await tu69(
      `insert into public.skylanders
         (sky_id, name, slug, series_code, category_id, item_type, card_type,
          is_active, catalog_visible, catalog_status, source, base_sky_id)
       values ('SKY-9002', 'P69 Chrome Spyro', 'sky-9002', 'SA', 10, 'figure',
               'standard', true, true, 'public', 'admin', 'SKY-9001');`);
    sag69("ZEILENWEISE in der falschen Reihenfolge scheitert — 23503, am "
          + "Fremdschluessel und nicht an Anwendungslogik",
          einB !== null && einB.includes("23503")
          && einB.includes("skylanders_base_same_series"),
          (einB ?? "DURCHGELAUFEN").slice(0, 62));

    /* D: und `set constraints all deferred` hilft NICHT. Die leise Falle. */
    const einD = await tu69(
      `set constraints all deferred;
       insert into public.skylanders
         (sky_id, name, slug, series_code, category_id, item_type, card_type,
          is_active, catalog_visible, catalog_status, source, base_sky_id)
       values ('SKY-9002', 'P69 Chrome Spyro', 'sky-9002', 'SA', 10, 'figure',
               'standard', true, true, 'public', 'admin', 'SKY-9001');`);
    sag69("`set constraints all deferred` laeuft durch und TUT NICHTS — der "
          + "Fremdschluessel ist nicht aufschiebbar, und PostgreSQL sagt es nicht",
          einD !== null && einD.includes("23503"),
          (einD ?? "DURCHGELAUFEN").slice(0, 46));

    /* C: zwei Durchgaenge, und sie schreiben KEINE Journalzeile. */
    const journalVor = await w69("select count(*)::text as w"
                                 + " from public.catalog_admin_changes");
    const einC1 = await tu69(`${einEinzeln.replace("e ->> 'base_sky_id'", "null")};`);
    const einC2 = await tu69(
      `update public.skylanders s
          set base_sky_id = a.basis
         from (select e ->> 'sky_id' as sky_id, e ->> 'base_sky_id' as basis
                 from z_archiv69 z,
                      jsonb_array_elements(z.doc -> 'data' -> 'skylanders') as e
                where e ->> 'sky_id' like 'SKY-900%') a
        where a.sky_id = s.sky_id and a.basis is not null;`);
    const danachC = await w69(
      `select coalesce(string_agg(sky_id || '->' || coalesce(base_sky_id, '-'),
                                  ', ' order by sky_id), '(leer)') as w
         from public.skylanders where sky_id like 'SKY-900%'`);
    const journalNach = await w69("select count(*)::text as w"
                                  + " from public.catalog_admin_changes");
    sag69("ZWEI DURCHGAENGE (erst NULL, dann UPDATE) fuehren zum selben Ergebnis — und "
          + "schreiben KEINE Journalzeile, denn der Trigger journalisiert base_sky_id nicht",
          einC1 === null && einC2 === null
          && danachC === "SKY-9001->-, SKY-9002->SKY-9001, SKY-9003->SKY-9001, "
                       + "SKY-9004->SKY-9001"
          && journalNach === journalVor,
          `${einC1 ?? "durch"} · ${einC2 ?? "durch"} · ${danachC} · Journal `
          + `${journalVor} -> ${journalNach}`);

    /* ---- Und die Riegel aus 0159 wirken auch auf dem Weg ueber das Archiv. */
    const kette69 = await tu69(
      "update public.skylanders set base_sky_id = 'SKY-9002' where sky_id = 'SKY-9003';");
    sag69("eine Kette ueber den Wiederherstellungsweg wird abgewiesen (23514)",
          kette69 !== null && kette69.includes("23514"),
          (kette69 ?? "DURCHGELAUFEN").slice(0, 44));
    const serie69 = await tu69(
      "update public.skylanders set series_code = 'G' where sky_id = 'SKY-9001';");
    sag69("und die Serienaenderung einer Basisfigur mit Varianten ebenso (23001)",
          serie69 !== null && serie69.includes("23001"),
          (serie69 ?? "DURCHGELAUFEN").slice(0, 44));

    /* ---- Ein zweiter Lauf prallt ab. */
    const zweimal69 = await fahre(db, M160);
    sag69("ein zweiter Lauf prallt an seinem eigenen Riegel ab",
          zweimal69 !== null && zweimal69.includes("schon der neue"),
          (zweimal69 ?? "DURCHGELAUFEN").slice(0, 52));

    /* ---- Die Ruecknahme: EINEN Schritt zurueck, nicht zwei. */
    const zurueckLauf = await fahre(db, R160);
    const nachRuecknahme69 = await abdruck69();
    const spalte69 = await w69(
      "select count(*)::text as w from pg_attribute a"
      + " where a.attrelid = to_regclass('public.skylanders')"
      + " and a.attname = 'base_sky_id' and not a.attisdropped");
    const beziehung69 = await w69(
      `select coalesce(string_agg(sky_id || '->' || base_sky_id, ', ' order by sky_id),
                       '(leer)') as w
         from public.skylanders where base_sky_id is not null`);
    const statusNoch = await w69(
      "select (prosrc like '%''catalog_status'', t.catalog_status,%')::text as w"
      + " from pg_proc p join pg_namespace n on n.oid = p.pronamespace"
      + " where n.nspname = 'public' and p.proname = 'system_platform_export'");
    sag69("die Ruecknahme stellt den Rumpf aus 0153 zeichengleich her, laesst "
          + "catalog_status drin und die Spalte samt Beziehungen stehen",
          zurueckLauf === null && nachRuecknahme69 === A0153 && spalte69 === "1"
          && statusNoch === "true"
          && beziehung69 === "SKY-9002->SKY-9001, SKY-9003->SKY-9001, "
                           + "SKY-9004->SKY-9001",
          `${zurueckLauf ?? "durch"} · ${nachRuecknahme69} · catalog_status `
          + `${statusNoch} · Spalte ${spalte69} · ${beziehung69}`);

    probe.push({
      name: "P69 0160: das Archiv fuehrt base_sky_id — GEMESSEN, nicht am Rumpf "
        + "behauptet. Dieser Durchgang RUFT die Sicherung auf, zeigt die Luecke ohne "
        + "0160 (die Familie ist da, die Mitte fehlt), faehrt die Migration und spielt "
        + "aus dem Archiv wieder ein — in der SCHLECHTESTEN Reihenfolge, Varianten vor "
        + "der Basisfigur, in EINER Anweisung: laeuft durch. Zeilenweise in derselben "
        + "Reihenfolge scheitert mit 23503, `set constraints all deferred` hilft NICHT "
        + "(die leise Falle), und zwei Durchgaenge mit anschliessendem UPDATE fuehren "
        + "zum selben Ergebnis ohne eine Journalzeile. Dazu die Riegel (ohne 0159, "
        + "gegen 0105, gegen 0144, zweiter Lauf) und die Ruecknahme, die EINEN Schritt "
        + "zurueckgeht",
      ok: ok69,
      sagt: `0160: ${befund69.join(" · ")}`,
    });
  }

  /* =====================================================================
   * P70 — 0161: die Familie entsteht von selbst, und der NAME allein
   *       entscheidet nicht.
   *
   * WAS DIESER DURCHGANG BEWEIST, und keine andere Stelle kann es: dass die
   * drei Faelle, die der Betreiber namentlich genannt hat, wirklich
   * aufgehen. „Chop Chop", „Stump Smash" und „Wrecking Ball" stehen je
   * ZWEIMAL im Katalog — einmal in `SA`, einmal in `G` Series 2 —, beide
   * Zeilen sind Basisfigur eines Entwurfs, und beide sind DERSELBE
   * Charakter. Der zweite Lauf darf also nicht an
   * `admin_create_character` abbrechen, sondern muss die vorhandene Familie
   * BENUTZEN.
   *
   * UND DAS GEGENSTUECK: eine Familie gleichen Namens, die etwas anderes
   * enthaelt, darf NICHT benutzt werden. Dafuer steht hier die Familie
   * „Zook", in die eine fremde Figur gelegt wurde — der Lauf muss abbrechen
   * und das Mitglied nennen. Das ist die Antwort auf die Frage, ob
   * Namensgleichheit als Identitaetsbeweis reicht: sie FINDET eine Familie,
   * aber sie BESTAETIGT sie nicht.
   *
   * MIT DEN ECHTEN SCHLUESSELN UND DER ECHTEN AUDIT-CONSTRAINT, wie P67 und
   * P69: ohne den Eindeutigkeitsindex auf `lower(canonical_name)` waere die
   * ganze Frage gegenstandslos, und ohne die Constraint fiele jede
   * Journalzeile.
   * ===================================================================== */
  {
    const befund70: string[] = [];
    let ok70 = true;
    const sag70 = (was: string, gut: boolean, text: string): void => {
      befund70.push(`${gut ? "" : "!! "}${was}: ${text}`);
      if (!gut) ok70 = false;
    };

    const M161 = join(MIG_DIR, "0161_variant_family_auto.sql");
    const R161 = "supabase/rollback/R0161_drop_variant_family_auto.sql";

    const db = await frischNach0136();
    await serienUndIdentitaet(db);
    const w70 = async (sql: string): Promise<string> =>
      String(((await db.query(sql)) as { rows: Record<string, unknown>[] }).rows[0]?.w ?? "?");
    const tu70 = async (sql: string): Promise<string | null> => {
      try { await db.exec(sql); return null; }
      catch (e) {
        const f = e as { message?: string; code?: string };
        return `[${f.code ?? "?"}] ${(f.message ?? "FEHLER").slice(0, 170)}`;
      }
    };

    await db.exec(`insert into public.categories (id, series_code, name, position)
                   values (10, 'SA', 'Figuren', 1), (11, 'G', 'Giants Series 2 Figuren', 1);`);
    await db.exec(`create unique index if not exists z_sky10_uniq
                     on public.skylanders (sky_id);`);
    await db.exec(`create unique index if not exists z_ce10_uniq
                     on public.catalog_editorial (sky_id);`);
    await db.exec(`create sequence if not exists public.z_char10_seq start 1;
                   alter table public.characters
                     alter column id set default nextval('public.z_char10_seq');
                   create unique index if not exists z_char10_id
                     on public.characters (id);`);
    /*
     * DER EINDEUTIGKEITSINDEX IST DIE VORBEDINGUNG VON `0161`, und das
     * Stub-Schema traegt ihn nicht (keine Keys, Werkzeugbefund). Ohne ihn
     * koennten zwei Familien denselben Namen tragen — dann waere „die
     * Familie mit diesem Namen" keine Beschreibung mehr.
     */
    await db.exec(`create unique index if not exists characters_canonical_name_key
                     on public.characters (lower(canonical_name));`);
    await db.exec(`alter table public.skylanders
                     add constraint z_sk10_char_fk foreign key (character_id)
                     references public.characters (id);`);
    await db.exec(`create or replace function public.is_platform_admin() returns boolean
                   language sql as $stub$ select true $stub$;`);
    await db.exec(`alter table public.catalog_admin_changes
                     add constraint catalog_admin_changes_field_known
                     check (field in ('catalog_visible', 'display_name_override',
                                      'admin_note', 'catalog_group',
                                      'image_override_path', 'card_type', 'created',
                                      'catalog_status', 'merged_from', 'discarded',
                                      'character_id', 'base_sky_id'));`);

    for (const m of ["0154_merge_draft_into_figure.sql", "0155_discard_draft.sql",
                     "0156_merge_selected_fields.sql",
                     "0157_audit_fields_and_automatic_notes.sql",
                     "0158_figure_families.sql", "0159_variant_base_figure.sql"]) {
      const f = await fahre(db, join(MIG_DIR, m));
      if (f !== null) sag70(`Aufbau ${m.slice(0, 4)}`, false, f);
    }

    /*
     * DIE FUNKTION IST IM STUB SCHON DA (dokumentierter Werkzeugbefund: das
     * Stub-Schema entsteht aus ALLEN Migrationen, `0161` eingeschlossen).
     * Fuer jeden Riegel dieser Migration muss sie weg — das ist die Lage, in
     * der `0161` wirklich laeuft. Derselbe Handgriff wie in P69 fuer
     * `base_sky_id`.
     */
    await db.exec("drop function if exists public.admin_publish_variant_auto(text,text);");

    /* ---- Ohne den Eindeutigkeitsindex bricht 0161 ab: die Zusage ist echt. */
    {
      await db.exec("drop index if exists characters_canonical_name_key;");
      const ohneIndex = await fahre(db, M161);
      await db.exec(`create unique index characters_canonical_name_key
                       on public.characters (lower(canonical_name));`);
      sag70("ohne den eindeutigen Index auf lower(canonical_name) bricht 0161 ab",
            ohneIndex !== null && ohneIndex.includes("canonical_name"),
            (ohneIndex ?? "DURCHGELAUFEN").slice(0, 56));
    }

    const f161 = await fahre(db, M161);
    sag70("0161 laeuft", f161 === null, f161 ?? "durch");
    const zweimal70 = await fahre(db, M161);
    sag70("ein zweiter Lauf prallt ab", zweimal70 !== null && zweimal70.includes("steht schon"),
          (zweimal70 ?? "DURCHGELAUFEN").slice(0, 48));

    const anlegen70 = async (id: string, name: string, serie: string, kat: number,
                             status: string, familie: string | null = null) =>
      db.exec(`insert into public.skylanders
                 (sky_id, name, slug, series_code, category_id, item_type, card_type,
                  is_active, catalog_visible, catalog_status, source, character_id)
               values ('${id}', '${name.replace(/'/g, "''")}',
                  '${id.toLowerCase()}', '${serie}', ${kat}, 'figure', 'standard',
                  true, ${status === "public"}, '${status}', 'admin', ${familie ?? "null"});`);

    const fam70 = async (id: string): Promise<string> => w70(
      `select coalesce(s.character_id::text, '-') || '/' || coalesce(c.canonical_name, '-')
              || '/' || coalesce(s.base_sky_id, '-') || '/' || s.catalog_status as w
         from public.skylanders s
         left join public.characters c on c.id = s.character_id
        where s.sky_id = '${id}'`);

    /* ================================================================
     * DER FALL CHOP CHOP: zweimal derselbe Name, zwei Serien, zwei
     * Entwuerfe. Genau der Fall, an dem die naive Fassung abgebrochen waere.
     * ============================================================= */
    await anlegen70("SKY-9101", "Chop Chop", "SA", 10, "public");
    await anlegen70("SKY-9102", "Chop Chop", "G", 11, "public");
    await anlegen70("SKY-9103", "Gold Chop Chop", "SA", 10, "draft");
    await anlegen70("SKY-9104", "Metallic Blue Chop Chop", "G", 11, "draft");

    const famVor = await w70("select count(*)::text as w from public.characters");
    const ersterLauf = await tu70(
      "select public.admin_publish_variant_auto('SKY-9103', 'SKY-9101');");
    const nach9103 = await fam70("SKY-9103");
    const nach9101 = await fam70("SKY-9101");
    sag70("CHOP CHOP, erster Entwurf: eine Familie entsteht, benannt nach der "
          + "Basisfigur, und beide bekommen sie",
          ersterLauf === null
          && nach9101.includes("/Chop Chop/-/public")
          && nach9103.includes("/Chop Chop/SKY-9101/public"),
          `${ersterLauf ?? "durch"} · Basis ${nach9101} · Variante ${nach9103}`);

    /* DIE ENTSCHEIDENDE ZEILE DIESES DURCHGANGS. */
    const zweiterLauf = await tu70(
      "select public.admin_publish_variant_auto('SKY-9104', 'SKY-9102');");
    const nach9104 = await fam70("SKY-9104");
    const nach9102 = await fam70("SKY-9102");
    const famNach = await w70("select count(*)::text as w from public.characters");
    const mitglieder = await w70(
      `select count(*)::text as w from public.skylanders s
        where s.character_id = (select id from public.characters
                                 where lower(canonical_name) = 'chop chop')`);
    sag70("CHOP CHOP, zweiter Entwurf in der ANDEREN Serie: dieselbe Familie wird "
          + "BENUTZT statt abgebrochen — vier Mitglieder, EINE Familie",
          zweiterLauf === null
          && nach9102.includes("/Chop Chop/-/public")
          && nach9104.includes("/Chop Chop/SKY-9102/public")
          && mitglieder === "4"
          && Number(famNach) - Number(famVor) === 1,
          `${zweiterLauf ?? "durch"} · ${nach9104} · Mitglieder ${mitglieder} `
          + `· Familien ${famVor} -> ${famNach}`);
    /* Und die Basisfiguren sind NICHT Varianten geworden. */
    const basenFrei = await w70(
      `select (count(*) = 0)::text as w from public.skylanders
        where sky_id in ('SKY-9101', 'SKY-9102') and base_sky_id is not null`);
    sag70("die beiden Basisfiguren bleiben Basisfiguren (keine Kette)",
          basenFrei === "true", basenFrei);

    /* ---- STUMP SMASH und WRECKING BALL: dieselbe Form, beide namentlich. */
    for (const [n, basis1, basis2, v1, v2, name, var1, var2] of [
      ["9110", "SKY-9111", "SKY-9112", "SKY-9113", "SKY-9114", "Stump Smash",
       "Flocked Stump Smash", "White Flocked Stump Smash"],
      ["9120", "SKY-9121", "SKY-9122", "SKY-9123", "SKY-9124", "Wrecking Ball",
       "Glow-in-the-Dark Wrecking Ball", "Metallic Purple Wrecking Ball"],
    ] as const) {
      await anlegen70(basis1, name, "SA", 10, "public");
      await anlegen70(basis2, name, "G", 11, "public");
      await anlegen70(v1, var1, "SA", 10, "draft");
      await anlegen70(v2, var2, "G", 11, "draft");
      const a = await tu70(`select public.admin_publish_variant_auto('${v1}', '${basis1}');`);
      const b = await tu70(`select public.admin_publish_variant_auto('${v2}', '${basis2}');`);
      const m = await w70(
        `select count(*)::text as w from public.skylanders s
          where s.character_id = (select id from public.characters
                                   where lower(canonical_name) = lower('${name}'))`);
      sag70(`${name.toUpperCase()}: beide Serien in EINER Familie`,
            a === null && b === null && m === "4",
            `${a ?? "durch"} · ${b ?? "durch"} · Mitglieder ${m}`);
      void n;
    }

    /* ================================================================
     * DAS VETO: eine Familie gleichen Namens, die etwas anderes enthaelt.
     * ============================================================= */
    await anlegen70("SKY-9131", "Zook", "SA", 10, "public");
    await anlegen70("SKY-9132", "Stone Zook", "SA", 10, "draft");
    await db.exec(`insert into public.characters (canonical_name) values ('Zook');`);
    await db.exec(`insert into public.skylanders
                     (sky_id, name, slug, series_code, category_id, item_type,
                      card_type, is_active, catalog_visible, catalog_status, source,
                      character_id)
                   values ('SKY-9133', 'Cynder', 'sky-9133', 'G', 11, 'figure',
                      'standard', true, true, 'public', 'admin',
                      (select id from public.characters where canonical_name = 'Zook'));`);
    const veto = await tu70(
      "select public.admin_publish_variant_auto('SKY-9132', 'SKY-9131');");
    const nach9132 = await fam70("SKY-9132");
    const nach9131 = await fam70("SKY-9131");
    sag70("DAS VETO: es gibt eine Familie „Zook\", aber sie enthaelt „Cynder\" — der "
          + "Lauf bricht ab, nennt das Mitglied, und schreibt NICHTS",
          veto !== null && veto.includes("Cynder") && veto.includes("nicht vereinbar")
          && nach9132 === "-/-/-/draft" && nach9131 === "-/-/-/public",
          `${(veto ?? "DURCHGELAUFEN").slice(0, 80)} · Variante ${nach9132}`);

    /* Und die Gegenprobe: ist das fremde Mitglied vereinbar, geht es durch. */
    await db.exec(`update public.skylanders set name = 'Gold Zook' where sky_id = 'SKY-9133';`);
    const nachVeto = await tu70(
      "select public.admin_publish_variant_auto('SKY-9132', 'SKY-9131');");
    const nach9132b = await fam70("SKY-9132");
    sag70("heisst dasselbe Mitglied „Gold Zook\", ist die Identitaet bestaetigt und "
          + "die Familie wird benutzt",
          nachVeto === null && nach9132b.includes("/Zook/SKY-9131/public"),
          `${nachVeto ?? "durch"} · ${nach9132b}`);

    /* ================================================================
     * DIE UEBERNAHME und die vier Abweisungen.
     * ============================================================= */
    await db.exec(`insert into public.characters (canonical_name) values ('Spyro');`);
    await anlegen70("SKY-9141", "Spyro", "SA", 10, "public",
                    "(select id from public.characters where canonical_name = 'Spyro')");
    await anlegen70("SKY-9142", "Chrome Spyro", "SA", 10, "draft");
    const uebernahme = await tu70(
      "select public.admin_publish_variant_auto('SKY-9142', 'SKY-9141');");
    const famNeu = await w70("select count(*)::text as w from public.characters");
    sag70("UEBERNAHME: hat die Basisfigur eine Familie, wird sie uebernommen und "
          + "KEINE neue angelegt",
          uebernahme === null && (await fam70("SKY-9142")).includes("/Spyro/SKY-9141/public"),
          `${uebernahme ?? "durch"} · ${await fam70("SKY-9142")} · Familien ${famNeu}`);

    /* WIDERSPRUCH: beide haben eine, und zwar verschiedene. */
    await db.exec(`insert into public.characters (canonical_name) values ('Cynder');`);
    await anlegen70("SKY-9143", "Dark Spyro", "SA", 10, "draft",
                    "(select id from public.characters where canonical_name = 'Cynder')");
    const widerspruch = await tu70(
      "select public.admin_publish_variant_auto('SKY-9143', 'SKY-9141');");
    sag70("WIDERSPRUCH: verschiedene Familien brechen ab, statt zu ueberschreiben",
          widerspruch !== null && widerspruch.includes("klaeren"),
          (widerspruch ?? "DURCHGELAUFEN").slice(0, 58));
    const unberuehrt = await fam70("SKY-9143");
    sag70("und die Variante behaelt ihre Familie und bleibt Entwurf",
          unberuehrt.includes("/Cynder/-/draft"), unberuehrt);

    /* FREMDE SERIE, KETTE, KEIN ENTWURF, SELBSTBEZUG. */
    await anlegen70("SKY-9151", "Bash", "G", 11, "public");
    await anlegen70("SKY-9152", "Blue Bash", "SA", 10, "draft");
    const serie = await tu70(
      "select public.admin_publish_variant_auto('SKY-9152', 'SKY-9151');");
    const kette = await tu70(
      "select public.admin_publish_variant_auto('SKY-9152', 'SKY-9103');");
    const keinEntwurf = await tu70(
      "select public.admin_publish_variant_auto('SKY-9101', 'SKY-9102');");
    const selbst = await tu70(
      "select public.admin_publish_variant_auto('SKY-9152', 'SKY-9152');");
    sag70("vier Abweisungen mit eigener Meldung: fremde Serie, Kette, kein Entwurf, "
          + "Selbstbezug",
          serie !== null && serie.includes("DERSELBEN Serie")
          && kette !== null && kette.includes("selbst eine Variante")
          && keinEntwurf !== null && keinEntwurf.includes("kein Entwurf")
          && selbst !== null && selbst.includes("eigene Variante"),
          [serie, kette, keinEntwurf, selbst]
            .map((x) => (x ?? "DURCH").slice(0, 22)).join(" | "));

    /* ---- Und ohne Adminrecht gar nichts. */
    await db.exec(`create or replace function public.is_platform_admin() returns boolean
                   language sql as $stub$ select false $stub$;`);
    const ohneRecht = await tu70(
      "select public.admin_publish_variant_auto('SKY-9152', 'SKY-9151');");
    await db.exec(`create or replace function public.is_platform_admin() returns boolean
                   language sql as $stub$ select true $stub$;`);
    sag70("ohne Adminrecht weist sie ab (42501)",
          ohneRecht !== null && ohneRecht.includes("42501"),
          (ohneRecht ?? "DURCHGELAUFEN").slice(0, 24));

    /* ================================================================
     * KEINE MASSENZUORDNUNG: die Funktion schreibt ZWEI Zeilen.
     * ============================================================= */
    await anlegen70("SKY-9161", "Camo", "SA", 10, "public");
    await anlegen70("SKY-9162", "Red Camo", "SA", 10, "draft");
    await anlegen70("SKY-9163", "Thorn Horn Camo", "SA", 10, "public");
    const vorZahl = await w70(
      "select count(*)::text as w from public.skylanders where character_id is not null");
    await db.exec("select public.admin_publish_variant_auto('SKY-9162', 'SKY-9161');");
    const nachZahl = await w70(
      "select count(*)::text as w from public.skylanders where character_id is not null");
    const dritte = await fam70("SKY-9163");
    sag70("KEINE MASSENZUORDNUNG: genau zwei Zeilen bekommen die Familie, die "
          + "gleichnamige dritte Figur bleibt unberuehrt",
          Number(nachZahl) - Number(vorZahl) === 2 && dritte === "-/-/-/public",
          `${vorZahl} -> ${nachZahl} · Thorn Horn Camo ${dritte}`);

    /* ---- Das Journal: zwei Familienzeilen und eine Basiszeile je Lauf. */
    const journal = await w70(
      `select coalesce(string_agg(x.field || ':' || x.n::text, ', ' order by x.field),
                       '(leer)') as w
         from (select field, count(*) as n from public.catalog_admin_changes
                where entity_id in ('SKY-9161', 'SKY-9162') group by field) x`);
    sag70("jede Schreibung steht im Journal — character_id zweimal, base_sky_id "
          + "einmal, catalog_status einmal",
          journal.includes("base_sky_id:1") && journal.includes("character_id:2"),
          journal);

    /* ================================================================
     * DER „VERLORENE WETTLAUF": die Familie ist schon da, wenn der Aufruf
     * kommt. Genau das Ergebnis, das der Advisory-Lock herstellt — PGlite
     * hat eine Verbindung, also wird das ERGEBNIS geprueft und nicht die
     * Gleichzeitigkeit.
     * ============================================================= */
    await anlegen70("SKY-9171", "Warnado", "SA", 10, "public");
    await anlegen70("SKY-9172", "Glow Warnado", "SA", 10, "draft");
    await db.exec(`insert into public.characters (canonical_name) values ('Warnado');`);
    const wettlauf = await tu70(
      "select public.admin_publish_variant_auto('SKY-9172', 'SKY-9171');");
    const famZahlW = await w70(
      "select count(*)::text as w from public.characters where lower(canonical_name) = 'warnado'");
    sag70("VERLORENER WETTLAUF: steht die Familie schon (leer, von einem anderen "
          + "Lauf), wird sie benutzt — keine zweite, kein 23505",
          wettlauf === null && famZahlW === "1"
          && (await fam70("SKY-9172")).includes("/Warnado/SKY-9171/public"),
          `${wettlauf ?? "durch"} · Familien mit dem Namen ${famZahlW}`);
    sag70("und der Rumpf nimmt den Advisory-Lock, bevor er sucht",
          await w70(
            "select (prosrc like '%pg_advisory_xact_lock%' and prosrc like '%skyisles.family:%')"
            + "::text as w from pg_proc p where p.oid = "
            + "to_regprocedure('public.admin_publish_variant_auto(text,text)')") === "true",
          "pg_advisory_xact_lock steht im Rumpf");

    /* ---- Die Wege aus 0158/0159 sind unveraendert aufrufbar. */
    await anlegen70("SKY-9181", "Hex", "SA", 10, "public");
    await anlegen70("SKY-9182", "Pearl Hex", "SA", 10, "draft");
    const alt159 = await tu70(
      "select public.admin_publish_with_base('SKY-9182', 'SKY-9181', true);");
    sag70("admin_publish_with_base aus 0159 laeuft unveraendert weiter (0161 ersetzt "
          + "sie nicht)",
          alt159 === null && (await fam70("SKY-9182")).includes("/Hex/SKY-9181/public"),
          `${alt159 ?? "durch"} · ${await fam70("SKY-9182")}`);

    /* ---- Die Ruecknahme nimmt EINE Funktion und keine Zuordnung. */
    const famVorR = await w70(
      "select count(*)::text as w from public.skylanders where character_id is not null");
    const rueck = await fahre(db, R161);
    const weg = await w70(
      "select (to_regprocedure('public.admin_publish_variant_auto(text,text)') is null)"
      + "::text as w");
    const famNachR = await w70(
      "select count(*)::text as w from public.skylanders where character_id is not null");
    const andereDa = await w70(
      `select (to_regprocedure('public.admin_set_variant_base(text,text,boolean)') is not null
           and to_regprocedure('public.admin_publish_with_base(text,text,boolean)') is not null
           and to_regprocedure('public.admin_create_character(text)') is not null)::text as w`);
    sag70("R0161 entfernt genau eine Funktion, laesst die aus 0158/0159 stehen und "
          + "fasst keine Zuordnung an",
          rueck === null && weg === "true" && andereDa === "true" && famNachR === famVorR,
          `${rueck ?? "durch"} · fort ${weg} · andere ${andereDa} · Zuordnungen `
          + `${famVorR} -> ${famNachR}`);

    probe.push({
      name: "P70 0161: die Familie entsteht von selbst — und der NAME allein "
        + "entscheidet nicht. Die drei Faelle des Betreibers namentlich: Chop Chop, "
        + "Stump Smash und Wrecking Ball stehen je zweimal im Katalog, und der zweite "
        + "Entwurf BENUTZT die Familie des ersten statt abzubrechen (vier Mitglieder, "
        + "eine Familie). Das Veto: eine Familie „Zook\", die „Cynder\" enthaelt, "
        + "wird NICHT benutzt — Abbruch mit Nennung des Mitglieds, und nach der "
        + "Umbenennung in „Gold Zook\" geht derselbe Lauf durch. Dazu die Uebernahme "
        + "ohne neue Familie, der Widerspruchsabbruch, vier Abweisungen mit eigener "
        + "Meldung, die Rechtepruefung, der verlorene Wettlauf, das Journal, KEINE "
        + "Massenzuordnung (genau zwei Zeilen), die unveraenderte Funktion aus 0159 "
        + "und eine Ruecknahme, die keine Zuordnung anfasst",
      ok: ok70,
      sagt: `0161: ${befund70.join(" · ")}`,
    });
  }

  /* =====================================================================
   * P71 — 0162: der Marktwert, und die Loeschung einer Zeile, auf die
   *       nichts zeigt.
   *
   * WAS DIESER DURCHGANG BEWEIST, und keine andere Stelle kann es: dass
   * jede Abhaengigkeitsklasse die Loeschung WIRKLICH blockiert. Eine Liste
   * im Kopf der Migration ist eine Behauptung; hier wird fuer jede Klasse
   * eine Zeile angelegt und die Loeschung versucht.
   *
   * MIT DEN ECHTEN SCHLUESSELN: das Stub-Schema traegt keine (Werkzeugbefund),
   * und ohne sie waere die ganze Frage gegenstandslos — `admin_merge_references`
   * leitet aus `pg_constraint` her, und wo kein Schluessel steht, zaehlt sie
   * nichts.
   *
   * DAZU DER STILLE VERWEIS. `order_lines.sky_id` traegt KEINEN
   * Fremdschluessel; die Funktion fragt ihn ausdruecklich. Ohne diese Zeile
   * waere „referenzfrei" eine halbe Aussage, und eine Bestellung haette ihre
   * Figur verloren.
   * ===================================================================== */
  {
    const befund71: string[] = [];
    let ok71 = true;
    const sag71 = (was: string, gut: boolean, text: string): void => {
      befund71.push(`${gut ? "" : "!! "}${was}: ${text}`);
      if (!gut) ok71 = false;
    };

    const M162 = join(MIG_DIR, "0162_admin_price_and_delete.sql");
    const R162 = "supabase/rollback/R0162_drop_price_and_delete.sql";

    const db = await frischNach0136();
    await serienUndIdentitaet(db);
    const w71 = async (sql: string): Promise<string> =>
      String(((await db.query(sql)) as { rows: Record<string, unknown>[] }).rows[0]?.w ?? "?");
    const tu71 = async (sql: string): Promise<string | null> => {
      try { await db.exec(sql); return null; }
      catch (e) {
        const f = e as { message?: string; code?: string };
        return `[${f.code ?? "?"}] ${(f.message ?? "FEHLER").slice(0, 180)}`;
      }
    };

    await db.exec(`insert into public.categories (id, series_code, name, position)
                   values (10, 'SA', 'Figuren', 1);`);
    await db.exec(`create or replace function public.is_platform_admin() returns boolean
                   language sql as $stub$ select true $stub$;`);
    await db.exec(`create schema if not exists auth;
                   create table if not exists auth.users (id uuid primary key);`);
    await db.exec(`create unique index if not exists z_sky11_uniq
                     on public.skylanders (sky_id);`);
    await db.exec(`create unique index if not exists z_ce11_uniq
                     on public.catalog_editorial (sky_id);`);
    /*
     * DERSELBE AUFBAU WIE IN P70, UND ER IST KEINE ZIERDE. `0158` verlangt
     * den eindeutigen Index auf `lower(characters.canonical_name)`, `0159`
     * verlangt die Fassung der Audit-Constraint aus `0158`. Fehlt das
     * Erste, bricht die Kette ab, die Constraint bleibt bei zehn Werten,
     * und der erste Aufruf von `admin_set_variant_base` schreibt
     * `base_sky_id` in eine Liste, die es nicht kennt — `23514`, und zwar
     * UNGEFANGEN. Mein erster Anlauf hat damit den ganzen Probelauf
     * abgerissen, nicht nur diesen Durchgang.
     */
    await db.exec(`create sequence if not exists public.z_char11_seq start 1;
                   alter table public.characters
                     alter column id set default nextval('public.z_char11_seq');
                   create unique index if not exists z_char11_id
                     on public.characters (id);`);
    /*
     * DER NAME IST TEIL DER VORBEDINGUNG. `0158` fragt nach
     * `characters_canonical_name_key` — namentlich, nicht nach „irgendeinem
     * eindeutigen Index auf lower(canonical_name)". Mein erster Anlauf nannte
     * ihn `z_char11_name_key`, und daran brach die ganze Kette: `0158` ab,
     * `0159` ab, die Audit-Constraint bei zehn Werten, `0162` ab.
     */
    await db.exec(`create unique index if not exists characters_canonical_name_key
                     on public.characters (lower(canonical_name));`);
    await db.exec(`alter table public.skylanders
                     add constraint z_sk11_char_fk foreign key (character_id)
                     references public.characters (id);`);
    await db.exec(`alter table public.catalog_admin_changes
                     add constraint catalog_admin_changes_field_known
                     check (field in ('catalog_visible', 'display_name_override',
                                      'admin_note', 'catalog_group',
                                      'image_override_path', 'card_type', 'created',
                                      'catalog_status', 'merged_from', 'discarded',
                                      'character_id', 'base_sky_id'));`);
    for (const m of ["0154_merge_draft_into_figure.sql", "0155_discard_draft.sql",
                     "0156_merge_selected_fields.sql",
                     "0157_audit_fields_and_automatic_notes.sql",
                     "0158_figure_families.sql", "0159_variant_base_figure.sql"]) {
      const f = await fahre(db, join(MIG_DIR, m));
      if (f !== null) sag71(`Aufbau ${m.slice(0, 4)}`, false, f);
    }

    /*
     * DIE ECHTEN SCHLUESSEL, EINER JE ABHAENGIGKEITSKLASSE. Gemessen auf
     * Staging am 2026-10-29 sind es vierzehn; hier stehen die, die eine
     * Loeschung blockieren muessen — je einer mit RESTRICT und einer mit
     * CASCADE, damit beide Wege geprueft sind.
     */
    for (const [tab, spalte, art] of [
      ["collection_items", "sky_id", "restrict"],
      ["favorites", "sky_id", "restrict"],
      ["shop_inventory", "sky_id", "restrict"],
      ["cart_items", "sky_id", "cascade"],
      ["catalog_editorial", "sky_id", "cascade"],
    ] as const) {
      await db.exec(`alter table public.${tab}
                       add constraint z_${tab}_sky_fk foreign key (${spalte})
                       references public.skylanders (sky_id) on delete ${art};`);
    }

    /* Die Funktion ist im Stub schon da (Werkzeugbefund) — fuer die Riegel weg. */
    await db.exec(`drop function if exists public.admin_set_market_price(text,numeric);
                   drop function if exists public.admin_delete_figure(text);`);

    /*
     * UND DIE KETTE WIRD NACHGESEHEN, BEVOR ES WEITERGEHT. Ein abgebrochener
     * Aufbau ist kein Befund ueber `0162`, und er soll nicht als einer
     * aussehen.
     */
    const kette = await w71(
      `select (pg_get_constraintdef(c.oid) like '%base_sky_id%'
           and pg_get_constraintdef(c.oid) like '%character_id%')::text as w
         from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'`);
    sag71("Aufbau: die Audit-Constraint ist die Fassung aus 0159 (zwoelf Werte)",
          kette === "true", kette);

    const f162 = await fahre(db, M162);
    sag71("0162 laeuft", f162 === null, f162 ?? "durch");
    const zweimal = await fahre(db, M162);
    sag71("ein zweiter Lauf prallt ab", zweimal !== null && zweimal.includes("steht schon"),
          (zweimal ?? "DURCHGELAUFEN").slice(0, 44));
    const vierzehn = await w71(
      `select (pg_get_constraintdef(c.oid) like '%market_price%'
           and pg_get_constraintdef(c.oid) like '%deleted%'
           and pg_get_constraintdef(c.oid) like '%base_sky_id%')::text as w
         from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'`);
    sag71("das Journal kennt market_price und deleted — und die zwoelf alten",
          vierzehn === "true", vierzehn);

    const anlegen71 = async (id: string, name: string, status = "public",
                             preis: string | null = "9.99") =>
      db.exec(`insert into public.skylanders
                 (sky_id, name, slug, series_code, category_id, item_type, card_type,
                  is_active, catalog_visible, catalog_status, source, market_price)
               values ('${id}', '${name}', '${id.toLowerCase()}', 'SA', 10, 'figure',
                  'standard', true, ${status === "public"}, '${status}', 'admin',
                  ${preis ?? "null"});`);

    /* ================================================================
     * DER MARKTWERT.
     * ============================================================= */
    await anlegen71("SKY-9201", "P71 Preisfigur", "public", "5.48");
    const preisLesen = async (id: string): Promise<string> => w71(
      `select coalesce(market_price::text, '(offen)') || '/'
              || coalesce(price_updated_at is not null, false)::text as w
         from public.skylanders where sky_id = '${id}'`);

    const setzen = await tu71("select public.admin_set_market_price('SKY-9201', 7.25);");
    sag71("der Preis wird gesetzt, und das Datum folgt ihm",
          setzen === null && (await preisLesen("SKY-9201")) === "7.25/true",
          `${setzen ?? "durch"} · ${await preisLesen("SKY-9201")}`);

    const offen = await tu71("select public.admin_set_market_price('SKY-9201', null);");
    sag71("NULL macht „Preis offen“ — und nimmt das Datum mit",
          offen === null && (await preisLesen("SKY-9201")) === "(offen)/false",
          `${offen ?? "durch"} · ${await preisLesen("SKY-9201")}`);

    const zurueck = await tu71("select public.admin_set_market_price('SKY-9201', 4.99);");
    sag71("und wieder zurueck auf einen Preis",
          zurueck === null && (await preisLesen("SKY-9201")) === "4.99/true",
          `${zurueck ?? "durch"} · ${await preisLesen("SKY-9201")}`);

    const null_euro = await tu71("select public.admin_set_market_price('SKY-9201', 0);");
    const negativ = await tu71("select public.admin_set_market_price('SKY-9201', -3);");
    sag71("0 und ein negativer Betrag werden mit einem SATZ abgewiesen, nicht von "
          + "der Constraint",
          null_euro !== null && null_euro.includes("kein Preis")
          && negativ !== null && negativ.includes("kein Preis")
          && (await preisLesen("SKY-9201")) === "4.99/true",
          `${(null_euro ?? "DURCH").slice(0, 40)} · unveraendert `
          + `${await preisLesen("SKY-9201")}`);

    const journalPreis = await w71(
      `select coalesce(string_agg(old_value || '→' || coalesce(new_value, 'NULL'), ', '
                                  order by changed_at), '(leer)') as w
         from public.catalog_admin_changes
        where entity_id = 'SKY-9201' and field = 'market_price'`);
    sag71("jede Preisaenderung steht im Journal, mit altem und neuem Wert",
          journalPreis.includes("5.48→7.25") && journalPreis.includes("7.25→NULL"),
          journalPreis);

    /* Und sie fasst KEINE andere Spalte an. */
    const nebenan = await w71(
      `select (catalog_status = 'public' and catalog_visible
           and name = 'P71 Preisfigur' and card_type = 'standard'
           and base_sky_id is null and character_id is null)::text as w
         from public.skylanders where sky_id = 'SKY-9201'`);
    sag71("und keine andere Spalte der Zeile", nebenan === "true", nebenan);

    /* ================================================================
     * DIE LOESCHUNG — JE ABHAENGIGKEITSKLASSE EIN VERSUCH.
     * ============================================================= */
    const konto = "11111111-1111-1111-1111-111111111111";
    await db.exec(`insert into auth.users (id) values ('${konto}')
                   on conflict do nothing;`);

    /* ---- A: eine Zeile, auf die NICHTS zeigt. */
    await anlegen71("SKY-9210", "P71 Doppelt angelegt", "hidden", null);
    const journalVor = await w71("select count(*)::text as w"
                                 + " from public.catalog_admin_changes");
    const weg = await tu71("select public.admin_delete_figure('SKY-9210');");
    const nochDa = await w71("select count(*)::text as w from public.skylanders"
                             + " where sky_id = 'SKY-9210'");
    const journalNach = await w71(
      `select coalesce(max(old_value), '(keine)') as w
         from public.catalog_admin_changes
        where entity_id = 'SKY-9210' and field = 'deleted'`);
    sag71("EINE REFERENZFREIE ZEILE wird geloescht — und das Journal UEBERLEBT sie",
          weg === null && nochDa === "0" && journalNach.includes("P71 Doppelt angelegt")
          && Number(journalVor) + 1
             === Number(await w71("select count(*)::text as w"
                                  + " from public.catalog_admin_changes")),
          `${weg ?? "durch"} · Zeilen ${nochDa} · Journal „${journalNach.slice(0, 44)}"`);

    /* ---- B: jede Abhaengigkeitsklasse, einzeln. */
    const klassen: readonly (readonly [string, string, string])[] = [
      ["collection_items",
       `insert into public.collection_items (user_id, sky_id, quantity)
          values ('${konto}', 'SKY-9220', 1)`, "Sammlung"],
      ["favorites",
       `insert into public.favorites (user_id, sky_id)
          values ('${konto}', 'SKY-9220')`, "Favorit"],
      ["shop_inventory",
       `insert into public.shop_inventory (sky_id, condition, quantity, is_listed)
          values ('SKY-9220', 'loose', 1, false)`, "Lager"],
      ["cart_items",
       `insert into public.cart_items (user_id, sky_id, condition, quantity)
          values ('${konto}', 'SKY-9220', 'loose', 1)`, "Warenkorb (CASCADE!)"],
    ];
    for (const [tab, einfuegen, was] of klassen) {
      await anlegen71("SKY-9220", `P71 ${was}`, "public", "3.00");
      const f = await tu71(einfuegen);
      if (f !== null) { sag71(`Aufbau ${tab}`, false, f); continue; }
      const versuch = await tu71("select public.admin_delete_figure('SKY-9220');");
      const steht = await w71("select count(*)::text as w from public.skylanders"
                              + " where sky_id = 'SKY-9220'");
      const fremdNoch = await w71(
        `select count(*)::text as w from public.${tab} where sky_id = 'SKY-9220'`);
      sag71(`${was} blockiert, und die fremde Zeile bleibt`,
            versuch !== null && versuch.includes("zeigen noch Daten")
            && versuch.includes(tab) && steht === "1" && fremdNoch === "1",
            `${(versuch ?? "DURCHGELAUFEN").slice(0, 52)} · Figur ${steht} · `
            + `${tab} ${fremdNoch}`);
      await db.exec(`delete from public.${tab} where sky_id = 'SKY-9220';`);
      await db.exec("delete from public.catalog_editorial where sky_id = 'SKY-9220';");
      await db.exec("delete from public.skylanders where sky_id = 'SKY-9220';");
    }

    /* ---- C: der CASCADE-Schluessel wird NAMENTLICH genannt. */
    await anlegen71("SKY-9230", "P71 Warenkorb", "public", "3.00");
    await db.exec(`insert into public.cart_items (user_id, sky_id, condition, quantity)
                   values ('${konto}', 'SKY-9230', 'loose', 2);`);
    const cascade = await tu71("select public.admin_delete_figure('SKY-9230');");
    sag71("und die Meldung sagt, dass es ein CASCADE-Schluessel war — der waere "
          + "stillschweigend mitgegangen",
          cascade !== null && cascade.includes("CASCADE")
          && cascade.includes("cart_items"),
          (cascade ?? "DURCHGELAUFEN").slice(0, 100));

    /* ---- D: DER STILLE VERWEIS. `order_lines.sky_id` hat keinen Schluessel. */
    /*
     * DIE SPALTEN SIND DIE ECHTEN AUS `0010`, und das war beim ersten Anlauf
     * nicht so: ich hatte `status` und `total_cents` geraten, der Einschub
     * scheiterte an `42703`, und die Probe hat sich selbst uebersprungen —
     * eine uebersprungene Probe ist bei DIESER Frage das Schlimmste, denn
     * sie ist der Kern der ganzen Funktion.
     */
    const ordnung = await tu71(
      `insert into public.orders
         (id, order_number, request_id, user_id, customer_email,
          items_subtotal, total_amount)
       values (99071, 'P71-0001', 'p71-req', '${konto}', 'p71@example.invalid',
               5.00, 5.00)`);
    if (ordnung !== null) {
      sag71("Aufbau orders", false, ordnung.slice(0, 90));
    } else {
      await anlegen71("SKY-9240", "P71 Bestellt", "public", "5.00");
      const zeile = await tu71(
        `insert into public.order_lines
           (order_id, sky_id, condition, quantity, name_snapshot,
            unit_price, line_total)
         values (99071, 'SKY-9240', 'loose', 1, 'P71 Bestellt', 5.00, 5.00)`);
      if (zeile !== null) {
        sag71("Aufbau order_lines", false, zeile.slice(0, 90));
      } else {
        const refs = await w71(
          `select count(*)::text as w from public.admin_merge_references('SKY-9240')
            where zeilen > 0`);
        const versuch = await tu71("select public.admin_delete_figure('SKY-9240');");
        const steht = await w71("select count(*)::text as w from public.skylanders"
                                + " where sky_id = 'SKY-9240'");
        const bestellung = await w71("select count(*)::text as w"
                                     + " from public.order_lines"
                                     + " where sky_id = 'SKY-9240'");
        sag71("DER STILLE VERWEIS: `admin_merge_references` zaehlt NICHTS, weil "
              + "order_lines keinen Fremdschluessel hat — und die Loeschung "
              + "blockiert trotzdem, und die Bestellzeile bleibt",
              refs === "0" && versuch !== null && versuch.includes("Bestellzeile")
              && steht === "1" && bestellung === "1",
              `gezaehlte Verweise ${refs} · ${(versuch ?? "DURCH").slice(0, 46)} · `
              + `Figur ${steht} · Bestellzeile ${bestellung}`);
      }
    }

    /* ---- E: eine Basisfigur mit Variante. */
    await anlegen71("SKY-9250", "P71 Basis", "public", "4.00");
    await anlegen71("SKY-9251", "P71 Gold Basis", "public", "6.00");
    const basisSetzen = await tu71(
      "select public.admin_set_variant_base('SKY-9251', 'SKY-9250', false);");
    sag71("Aufbau: SKY-9251 ist Variante von SKY-9250", basisSetzen === null,
          basisSetzen ?? "durch");
    const basis = await tu71("select public.admin_delete_figure('SKY-9250');");
    const variante = await tu71("select public.admin_delete_figure('SKY-9251');");
    sag71("eine BASISFIGUR mit Variante blockiert mit einem lesbaren Satz — die "
          + "Variante selbst ist loeschbar",
          basis !== null && basis.includes("Basisfigur") && variante === null
          && (await w71("select count(*)::text as w from public.skylanders"
                        + " where sky_id = 'SKY-9250'")) === "1",
          `${(basis ?? "DURCHGELAUFEN").slice(0, 46)} · Variante `
          + `${variante ?? "geloescht"}`);

    /* ---- F: ohne Adminrecht gar nichts. */
    await anlegen71("SKY-9260", "P71 Ohne Recht", "public", "2.00");
    await db.exec(`create or replace function public.is_platform_admin() returns boolean
                   language sql as $stub$ select false $stub$;`);
    const ohnePreis = await tu71("select public.admin_set_market_price('SKY-9260', 1);");
    const ohneWeg = await tu71("select public.admin_delete_figure('SKY-9260');");
    await db.exec(`create or replace function public.is_platform_admin() returns boolean
                   language sql as $stub$ select true $stub$;`);
    sag71("ohne Adminrecht weisen beide ab (42501), und die Zeile steht",
          ohnePreis !== null && ohnePreis.includes("42501")
          && ohneWeg !== null && ohneWeg.includes("42501")
          && (await w71("select count(*)::text as w from public.skylanders"
                        + " where sky_id = 'SKY-9260'")) === "1",
          `${(ohnePreis ?? "DURCH").slice(0, 18)} | ${(ohneWeg ?? "DURCH").slice(0, 18)}`);

    /* ---- G: DER WETTLAUF. Eine Referenz entsteht NACH der Pruefung —
     *         dann faengt sie der Fremdschluessel, und nichts geht verloren. */
    await anlegen71("SKY-9270", "P71 Wettlauf", "public", "2.00");
    /*
     * DER EINSCHUB UND DER AUFRUF SIND ZWEI ANWEISUNGEN, und das muss so
     * sein: steckten beide in EINEM `do`-Block, nähme die Ausnahme des
     * Aufrufs den Einschub mit zurück — PostgreSQL rollt die ganze
     * Anweisung zurück —, und die Probe wuerde „die fremde Zeile bleibt"
     * pruefen, nachdem sie sie selbst wieder entfernt hat. Meine erste
     * Fassung tat genau das.
     */
    await db.exec(`insert into public.collection_items (user_id, sky_id, quantity)
                   values ('${konto}', 'SKY-9270', 1);`);
    const rollback = await tu71("select public.admin_delete_figure('SKY-9270');");
    const nachRace = await w71(
      `select (select count(*) from public.skylanders where sky_id = 'SKY-9270')::text
              || '/' || (select count(*) from public.collection_items
                          where sky_id = 'SKY-9270')::text as w`);
    sag71("WETTLAUF: entsteht die Referenz vor dem Aufruf, blockiert die Pruefung — "
          + "und beide Zeilen stehen danach unveraendert",
          rollback !== null && nachRace === "1/1",
          `${(rollback ?? "DURCHGELAUFEN").slice(0, 46)} · ${nachRace}`);

    /*
     * UND DIE ANDERE RICHTUNG, die der Fremdschluessel faengt: die Referenz
     * entsteht NACH der Pruefung. Nachgestellt wird sie, indem die Pruefung
     * ueberhaupt nichts findet und der `delete` trotzdem scheitert — dafuer
     * wird die Zeile in einer Transaktion geloescht, in der zuvor eine
     * Sammlungszeile steht, die `admin_merge_references` nicht sieht. Das
     * ist in einer einzelnen Verbindung nicht echt nachzustellen (zwei
     * Sitzungen braeuchte es dafuer), also wird hier das BELEGBARE geprueft:
     * der Fremdschluessel steht auf RESTRICT und wuerde es faengen.
     */
    const letzteSchicht = await w71(
      `select (select count(*) from pg_constraint c
                where c.conrelid = to_regclass('public.collection_items')
                  and c.contype = 'f'
                  and c.confrelid = to_regclass('public.skylanders')
                  and c.confdeltype in ('r', 'a'))::text as w`);
    sag71("und die letzte Schicht steht: der Fremdschluessel der Sammlung "
          + "verweigert (RESTRICT/NO ACTION) — er faengt, was nach der "
          + "Pruefung entsteht",
          letzteSchicht === "1", letzteSchicht);

    /* ---- H: und das Bild bleibt liegen. */
    /*
     * DIE ZWEITE ZEILE MUSS NOCH STEHEN. SKY-9251 ist in Fall E geloescht
     * worden (die Variante ist loeschbar) — ein `update` darauf traf nichts,
     * und „die andere behaelt die Datei" pruefte dann an null Zeilen.
     * SKY-9250 steht, weil die Loeschung sie als Basisfigur abgewiesen hat.
     */
    await db.exec(`update public.skylanders set image_file = 'abc1234567890def.webp'
                    where sky_id in ('SKY-9250');`);
    await anlegen71("SKY-9280", "P71 Geteiltes Bild", "hidden", null);
    await db.exec(`update public.skylanders set image_file = 'abc1234567890def.webp'
                    where sky_id = 'SKY-9280';`);
    const mitBild = await tu71("select public.admin_delete_figure('SKY-9280');");
    const bildNoch = await w71(
      `select count(*)::text as w from public.skylanders
        where image_file = 'abc1234567890def.webp'`);
    sag71("eine Zeile mit GETEILTEM Bild wird geloescht, und die andere behaelt die "
          + "Datei — die Funktion fasst Storage nicht an",
          mitBild === null && bildNoch === "1",
          `${mitBild ?? "durch"} · Zeilen mit der Datei ${bildNoch}`);
    /*
     * GESUCHT WIRD DER SCHEMANAME MIT PUNKT, und das ist der ganze
     * Unterschied. Der Rumpf NENNT `0162_storage_note.md` in einem
     * Kommentar — die Datei, die festhaelt, was liegen bleibt. Eine Pruefung
     * auf „enthaelt das Wort storage" hat diesen Kommentar als Zugriff
     * gelesen; `storage.` mit Punkt trifft nur das Schema, denn der
     * Dateiname traegt einen Unterstrich.
     *
     * UND KEINE REGEX DAFUER. Mein zweiter Anlauf wollte die Kommentare
     * wegrechnen und schickte ein Muster an PostgreSQL, das mit einem Stern
     * hinter einem Schraegstrich beginnt — ein Quantifizierer ohne Operand,
     * und der Probelauf brach ab, statt etwas zu messen. (Dasselbe Muster
     * hat danach diesen Kommentar selbst geschlossen; es wird hier deshalb
     * beschrieben und nicht zitiert.)
     * Eine Pruefung, die genauer sein will als notwendig, wird dabei
     * zerbrechlich.
     */
    const ohneProsa71 = await w71(
      `select (prosrc not ilike '%storage.%')::text as w
         from pg_proc p
        where p.oid = to_regprocedure('public.admin_delete_figure(text)')`);
    sag71("und der Rumpf greift nirgends auf das Schema `storage` zu "
          + "(am Code gemessen, nicht am Kommentar)",
          ohneProsa71 === "true", ohneProsa71);

    /* ================================================================
     * V: DIE DREI PRUEFZEILEN DER NACHKONTROLLE, IN BEIDE RICHTUNGEN.
     *
     * WARUM DIESER ABSCHNITT EXISTIERT. Am 2026-10-29 hat die Nachkontrolle
     * des echten Laufs zweimal falschen Alarm geschlagen: Zeile 114 suchte
     * das Wort `card_type`, und der Rumpf NENNT es in seinem eigenen
     * Kommentar; Zeile 122 suchte `storage`, und der Rumpf nennt die Datei
     * `0162_storage_note.md`. Beide Zusagen waren erfuellt, beide Zeilen
     * sagten das Gegenteil.
     *
     * Eine berichtigte Pruefung ist nur dann besser, wenn sie den ECHTEN
     * Fall weiter faengt. Deshalb laufen hier beide Richtungen:
     *
     *   1. gegen die richtigen Ruempfe            -> bestanden
     *   2. gegen eine fremde Spaltenaenderung     -> faellt
     *   3. gegen einen echten Storage-Zugriff     -> faellt
     *   4. gegen einen zweiten Schreibweg         -> faellt
     *   5. gegen einen Rumpf, der beide Woerter nur im KOMMENTAR nennt
     *      -> bestanden (die Regression, die diesen Abschnitt ausgeloest hat)
     *
     * Gefahren wird der ECHTE Zeilentext aus `0162_postflight.sql`, aus der
     * Datei geschnitten — eine Kopie koennte von ihr abweichen.
     * ============================================================= */
    {
      const post = readFileSync("supabase/checks/0162_postflight.sql", "utf8");
      /** Eine Pruefzeile, von ihrer Nummer bis zum Beginn der naechsten. */
      const zeile = (nr: number): string => {
        const a = post.indexOf(`  (${nr}, `);
        if (a < 0) return "";
        let b = post.length;
        for (const marke of ["\n  (", "\n  /*"]) {
          const k = post.indexOf(marke, a + 4);
          if (k >= 0 && k < b) b = k;
        }
        return post.slice(a, b).trimEnd().replace(/,$/, "");
      };
      const frage = async (nr: number): Promise<string> => w71(
        `with pruef (nr, bereich, pruefung, befund, erwartet) as (values\n`
        + `${zeile(nr)}\n) select befund || '|' || coalesce(erwartet, '-') as w`
        + ` from pruef`);

      sag71("Aufbau V: die drei Pruefzeilen sind aus der Nachkontrolle "
            + "geschnitten",
            zeile(114) !== "" && zeile(120) !== "" && zeile(122) !== "",
            `114 ${zeile(114).length} · 120 ${zeile(120).length} · `
            + `122 ${zeile(122).length}`);

      /* ---- V1: gegen die ECHTEN Ruempfe. */
      const echt114 = await frage(114);
      const echt120 = await frage(120);
      const echt122 = await frage(122);
      sag71("RICHTIG HERUM: 114, 120 und 122 bestehen gegen die echten "
            + "Ruempfe — obwohl diese `card_type` und `0162_storage_note.md` "
            + "in ihren Kommentaren nennen",
            echt114 === "true|true" && echt120 === "7|7" && echt122 === "0|0",
            `114 ${echt114} · 120 ${echt120} · 122 ${echt122}`);

      /** Eine Preisfunktion mit dem genannten Rumpf — fuer die Gegenproben. */
      const preisRumpf = async (rumpf: string): Promise<string | null> => tu71(
        `create or replace function public.admin_set_market_price(
           p_sky_id text, p_price numeric) returns jsonb
         language plpgsql security definer set search_path = '' as $boese$
         begin ${rumpf} return '{}'::jsonb; end $boese$;`);

      /* ---- V2: eine FREMDE SPALTENAENDERUNG wird gefangen. */
      await preisRumpf(`update public.skylanders
                          set market_price = p_price, card_type = 'dark'
                        where sky_id = p_sky_id;`);
      const fremd = await frage(114);
      sag71("GEGENPROBE: eine fremde Spaltenaenderung (`card_type` hinter dem "
            + "Komma, ohne eigenes `set`) wird gefangen",
            fremd === "false|true", fremd);

      /* ---- V3: und jede andere Schreibweise ebenso. */
      const schreibweisen: readonly (readonly [string, string])[] = [
        ["set name='x', market_price=p_price", "ohne Leerzeichen"],
        [`set "card_type" = 'dark'`, "angefuehrt"],
        ["set\n            base_sky_id = null", "mit Umbruch nach set"],
        ["set (slug, market_price) = ('x', p_price)", "zeilenweise Zuweisung"],
        ["set market_price = (select market_price from public.skylanders"
         + " where item_type = 'figure' limit 1)", "nur LESEND genannt"],
      ];
      let gefangen = 0;
      for (const [satz, was] of schreibweisen) {
        await preisRumpf(`update public.skylanders ${satz} where sky_id = p_sky_id;`);
        const r = await frage(114);
        if (r === "false|true") gefangen += 1;
        else befund71.push(`!! Schreibweise „${was}" NICHT gefangen: ${r}`);
      }
      sag71("und zwar in JEDER Schreibweise — ohne Leerzeichen, angefuehrt, "
            + "mit Umbruch, zeilenweise, und sogar nur lesend genannt",
            gefangen === schreibweisen.length,
            `${gefangen} von ${schreibweisen.length}`);

      /* ---- V4: ein ZWEITER Schreibweg wird gefangen (Zeile 120). */
      await preisRumpf(`update public.skylanders set market_price = p_price
                        where sky_id = p_sky_id;
                        update public.skylanders set market_price = p_price
                        where sky_id = p_sky_id;`);
      const zweiWege = await frage(120);
      sag71("ZWEI `update` im Rumpf werden gefangen (Zeile 120)",
            zweiWege === "14|7", zweiWege);

      /* ---- V5: ein ECHTER Storage-Zugriff wird gefangen (Zeile 122). */
      for (const [zugriff, was] of [
        ["perform 1 from storage.objects;", "storage.objects"],
        ["perform 1 from storage . objects;", "mit Abstand vor dem Punkt"],
        [`perform 1 from "storage".objects;`, "angefuehrt"],
      ] as const) {
        await preisRumpf(zugriff);
        const r = await frage(122);
        sag71(`GEGENPROBE Storage (${was}) wird gefangen`, r === "1|0", r);
      }

      /* ---- V6: DIE REGRESSION. Ein Rumpf, der beide Woerter NUR im
       *          Kommentar nennt, besteht — genau der Fall, an dem die erste
       *          Fassung gescheitert ist. */
      await preisRumpf(
        `/* kein card_type, kein slug, kein base_sky_id — und die Datei\n`
        + `   supabase/checks/0162_storage_note.md haelt fest, was liegen\n`
        + `   bleibt. */\n`
        + `-- auch hier: card_type und storage_note bleiben Prosa\n`
        + `update public.skylanders set market_price = p_price\n`
        + ` where sky_id = p_sky_id;`);
      const nurProsa114 = await frage(114);
      const nurProsa122 = await frage(122);
      sag71("DIE REGRESSION: ein Rumpf, der `card_type` und "
            + "`0162_storage_note.md` NUR im Kommentar nennt, besteht beide "
            + "Zeilen — daran ist die erste Fassung gescheitert",
            nurProsa114 === "true|true" && nurProsa122 === "0|0",
            `114 ${nurProsa114} · 122 ${nurProsa122}`);
    }

    /* ---- I: die Ruecknahme. */
    const rueck = await fahre(db, R162);
    const fort = await w71(
      `select (to_regprocedure('public.admin_set_market_price(text,numeric)') is null
           and to_regprocedure('public.admin_delete_figure(text)') is null)::text as w`);
    const constraintNoch = await w71(
      `select (pg_get_constraintdef(c.oid) like '%market_price%')::text as w
         from pg_constraint c
        where c.conrelid = to_regclass('public.catalog_admin_changes')
          and c.conname = 'catalog_admin_changes_field_known'`);
    const journalNochDa = await w71(
      "select count(*)::text as w from public.catalog_admin_changes"
      + " where field in ('market_price', 'deleted')");
    sag71("R0162 entfernt die zwei Funktionen, laesst die Constraint stehen und "
          + "jede Journalzeile",
          rueck === null && fort === "true" && constraintNoch === "true"
          && Number(journalNochDa) > 0,
          `${rueck ?? "durch"} · fort ${fort} · Constraint ${constraintNoch} · `
          + `Journalzeilen ${journalNochDa}`);

    probe.push({
      name: "P71 0162: der Marktwert und die Loeschung. Der Preis wird gesetzt, auf "
        + "„offen“ zurueckgenommen und wieder gesetzt; 0 und negative Betraege weist "
        + "sie mit einem SATZ ab; jede Aenderung steht im Journal und keine andere "
        + "Spalte bewegt sich. Die Loeschung nimmt eine referenzfreie Zeile mit — und "
        + "das Journal ueberlebt sie —, blockiert aber an JEDER "
        + "Abhaengigkeitsklasse einzeln (Sammlung, Favorit, Lager, Warenkorb), nennt "
        + "den CASCADE-Schluessel namentlich, faengt den STILLEN Verweis in "
        + "order_lines, den `admin_merge_references` nicht zaehlt, weist eine "
        + "Basisfigur mit Variante ab, weist ohne Adminrecht ab (42501), verliert im "
        + "Wettlauf nichts, und laesst ein GETEILTES Bild unberuehrt. Dazu die "
        + "Ruecknahme, die die Audit-Constraint und jede Journalzeile stehen laesst",
      ok: ok71,
      sagt: `0162: ${befund71.join(" · ")}`,
    });
  }

  /* =====================================================================
   * P72 — 0163: der Type als MENGE, und genau ein Banner.
   *
   * WAS DIESER DURCHGANG BEWEIST, und keine andere Stelle kann es: dass die
   * MITGLIEDSCHAFT eine Eigenschaft der Datenbank ist. „Der sichtbare Type
   * gehoert zur Menge" steht als Zeilen-CHECK da; hier wird versucht, sie zu
   * verletzen — von Hand, an der Tabelle vorbei an jeder Funktion.
   *
   * UND DASS DIE KARTENKUNST SICH NICHT BEWEGT. Der Betreiber hat genau das
   * verlangt. Die Erstbelegung wird mit einem Bestand gefahren, der jeden
   * gemessenen Fall enthaelt — Giant mit Legendary, Trap mit Special,
   * LightCore mit und ohne weitere Eigenschaft, die Zeile mit `standard` —,
   * und der Abdruck von `card_type` wird vorher und nachher verglichen.
   * ===================================================================== */
  {
    const befund72: string[] = [];
    let ok72 = true;
    const sag72 = (was: string, gut: boolean, text: string): void => {
      befund72.push(`${gut ? "" : "!! "}${was}: ${text}`);
      if (!gut) ok72 = false;
    };

    const M163 = join(MIG_DIR, "0163_catalog_types.sql");
    const R163 = "supabase/rollback/R0163_drop_catalog_types.sql";

    const db = await frischNach0136();
    await serienUndIdentitaet(db);
    const w72 = async (sql: string): Promise<string> =>
      String(((await db.query(sql)) as { rows: Record<string, unknown>[] }).rows[0]?.w ?? "?");
    const tu72 = async (sql: string): Promise<string | null> => {
      try { await db.exec(sql); return null; }
      catch (e) {
        const f = e as { message?: string; code?: string };
        return `[${f.code ?? "?"}] ${(f.message ?? "FEHLER").slice(0, 200)}`;
      }
    };

    /* ---- Die Welt, in der `0163` laufen kann. Wie P70/P71. */
    await db.exec(`create unique index if not exists z_sky12_uniq
                     on public.skylanders (sky_id);`);
    await db.exec(`create unique index if not exists z_ce12_uniq
                     on public.catalog_editorial (sky_id);`);
    await db.exec(`create sequence if not exists public.z_char12_seq start 1;
                   alter table public.characters
                     alter column id set default nextval('public.z_char12_seq');
                   create unique index if not exists z_char12_id
                     on public.characters (id);`);
    await db.exec(`create unique index if not exists characters_canonical_name_key
                     on public.characters (lower(canonical_name));`);
    await db.exec(`create or replace function public.is_platform_admin() returns boolean
                   language sql as $stub$ select true $stub$;`);
    await db.exec(`create schema if not exists auth;
                   create table if not exists auth.users (id uuid primary key);`);
    /*
     * DER CHECK AUF `card_type`, DEN DAS STUB-SCHEMA NICHT TRAEGT (es hat
     * keine CHECKs, Werkzeugbefund). `0163` prueft als Nachbedingung, dass er
     * UNVERAENDERT dasteht — die Zusage, dass die Kartenkunst nicht angefasst
     * wird. Ohne ihn waere diese Pruefung in der Probe gegenstandslos, und
     * genau daran ist mein zweiter Lauf gescheitert.
     */
    /*
     * ERST DIE ERFUNDENEN ZEILEN IN ORDNUNG BRINGEN, DANN DEN CHECK. Die
     * Attrappe traegt Kartentypen, die es in Wirklichkeit nicht gibt (sie
     * kennt keine CHECKs, Werkzeugbefund). `not valid` genuegt dafuer nicht:
     * ein solcher CHECK gilt sehr wohl fuer jedes spaetere UPDATE, und die
     * Erstbelegung von `0163` fasst jede Zeile an.
     */
    await db.exec(`update public.skylanders set card_type = 'standard'
                    where card_type is null
                       or card_type not in ('standard', 'special', 'elite',
                                            'dark', 'legendary', 'chase',
                                            'prestige');`);
    await db.exec(`alter table public.skylanders
                     add constraint skylanders_card_type_known
                     check (card_type in ('standard', 'special', 'elite', 'dark',
                                          'legendary', 'chase', 'prestige'));`);
    /*
     * DIE AUDIT-CONSTRAINT MIT VIERZEHN WERTEN — also so, wie sie NACH `0162`
     * aussieht. `0163` verlangt das ausdruecklich, und genau diese
     * Vorbedingung wird unten auch einmal verletzt.
     */
    await db.exec(`alter table public.catalog_admin_changes
                     add constraint catalog_admin_changes_field_known
                     check (field in ('catalog_visible', 'display_name_override',
                                      'admin_note', 'catalog_group',
                                      'image_override_path', 'card_type', 'created',
                                      'catalog_status', 'merged_from', 'discarded',
                                      'character_id', 'base_sky_id',
                                      'market_price', 'deleted'));`);
    for (const m of ["0154_merge_draft_into_figure.sql", "0155_discard_draft.sql",
                     "0156_merge_selected_fields.sql",
                     "0157_audit_fields_and_automatic_notes.sql",
                     "0158_figure_families.sql", "0159_variant_base_figure.sql"]) {
      const f = await fahre(db, join(MIG_DIR, m));
      if (f !== null) sag72(`Aufbau ${m.slice(0, 4)}`, false, f);
    }
    /* Das Stub-Schema traegt die Spalten schon (Werkzeugbefund) — fuer die
       Riegel weg, samt allem, was `0163` selbst anlegt. */
    await db.exec(`drop trigger if exists skylanders_canonical_types
                     on public.skylanders;
                   drop function if exists public.skylanders_canonical_types();
                   drop function if exists
                     public.admin_set_figure_types(text,text[]);
                   drop function if exists public.admin_set_visible_type(text,text);
                   alter table public.skylanders
                     drop constraint if exists skylanders_visible_type_decided,
                     drop constraint if exists skylanders_visible_type_member,
                     drop constraint if exists skylanders_types_known,
                     drop column if exists visible_type_decided,
                     drop column if exists visible_type,
                     drop column if exists types;`);

    /*
     * DER BESTAND, UND ER IST DER GEMESSENE IM KLEINEN. Jede Kategorie, die
     * eine Gruppe traegt, und jeder Fall, den der Betreiber genannt hat.
     */
    const kat: readonly (readonly [number, string, string | null])[] = [
      [20, "Figuren", "figure"],
      [21, "Giants grosse Figuren", "giant"],
      [22, "SWAP Force", "swapper"],
      [23, "Trap Masters", "trap_master"],
      [24, "Senseis", "sensei"],
      [25, "Minis", "mini"],
      [26, "Sidekicks", "mini"],
      [27, "Magic Items", "item"],
      [28, "Traps", "trap"],
      [29, "Fahrzeuge", "vehicle"],
      [30, "Kreationskristalle", "creation_crystal"],
      [31, "Portale", null],
    ];
    for (const [id, name, gruppe] of kat) {
      await db.exec(`insert into public.categories
                       (id, series_code, name, position, catalog_group)
                     values (${id}, 'SA', '${name}', ${id},
                             ${gruppe === null ? "null" : `'${gruppe}'`});`);
    }
    const anlegen72 = async (id: string, name: string, katId: number,
                             kunst = "standard", status = "public") =>
      db.exec(`insert into public.skylanders
                 (sky_id, name, slug, series_code, category_id, item_type,
                  card_type, is_active, catalog_visible, catalog_status, source)
               values ('${id}', '${name}', '${id.toLowerCase()}', 'SA', ${katId},
                       'figure', '${kunst}', true, ${status === "public"},
                       '${status}', 'admin');`);

    /* Die Faelle des Betreibers, namentlich. */
    await anlegen72("SKY-9301", "P72 Spyro", 20, "standard");
    await anlegen72("SKY-9302", "P72 Legendary Bouncer", 21, "legendary");  // Giant+Legendary
    await anlegen72("SKY-9303", "P72 Fire Torch", 28, "special");           // Trap+Special
    await anlegen72("SKY-9304", "P72 Chill Light Core", 20, "special");     // LightCore allein
    await anlegen72("SKY-9305", "P72 Legendary LightCore Chill", 20, "legendary");
    await anlegen72("SKY-9306", "P72 Employee LightCore", 20, "prestige");
    await anlegen72("SKY-9307", "P72 White Flocked LightCore", 20, "standard");
    await anlegen72("SKY-9308", "P72 Barkley", 26, "standard");             // Sidekick
    await anlegen72("SKY-9309", "P72 Eye Small", 25, "standard");           // Mini
    await anlegen72("SKY-9310", "P72 Hot Streak", 29, "chase");             // Vehicle+Chase
    await anlegen72("SKY-9311", "P72 Portal", 31, "standard");              // ohne Gruppe
    await anlegen72("SKY-9312", "P72 Gusto", 24, "elite");                  // Sensei+Elite
    await anlegen72("SKY-9313", "P72 Kristall", 30, "dark");                // Crystal+Dark
    await anlegen72("SKY-9314", "P72 Wash Buckler", 22, "standard");        // Swapper
    await anlegen72("SKY-9315", "P72 Snap Shot", 23, "standard");           // Master

    /*
     * DIE KURATIERTE LISTE DER MIGRATION TRIFFT DIESE ZEILEN NICHT — sie
     * nennt die echten SKY-IDs. Fuer die Probe werden die vier erfundenen
     * LightCores deshalb NACH dem Lauf von Hand zugeordnet, und die
     * Erstbelegung wird an den echten Regeln geprueft.
     */
    const kunstVor = await w72(
      `select coalesce(md5(string_agg(sky_id || '|' || card_type, E'\n'
                                      order by sky_id)), '(leer)') as w
         from public.skylanders`);

    /* ---- A: ohne 0162 bricht sie ab. */
    await db.exec(`alter table public.catalog_admin_changes
                     drop constraint catalog_admin_changes_field_known;
                   alter table public.catalog_admin_changes
                     add constraint catalog_admin_changes_field_known
                     check (field in ('catalog_visible', 'display_name_override',
                                      'admin_note', 'catalog_group',
                                      'image_override_path', 'card_type', 'created',
                                      'catalog_status', 'merged_from', 'discarded',
                                      'character_id', 'base_sky_id'));`);
    const ohne0162 = await fahre(db, M163);
    sag72("ohne 0162 bricht 0163 ab — und nennt die Reihenfolge",
          ohne0162 !== null && ohne0162.includes("setzt 0162 voraus"),
          (ohne0162 ?? "DURCHGELAUFEN").slice(0, 60));
    await db.exec(`alter table public.catalog_admin_changes
                     drop constraint catalog_admin_changes_field_known;
                   alter table public.catalog_admin_changes
                     add constraint catalog_admin_changes_field_known
                     check (field in ('catalog_visible', 'display_name_override',
                                      'admin_note', 'catalog_group',
                                      'image_override_path', 'card_type', 'created',
                                      'catalog_status', 'merged_from', 'discarded',
                                      'character_id', 'base_sky_id',
                                      'market_price', 'deleted'));`);

    /* ---- B: der gute Lauf. */
    const f163 = await fahre(db, M163);
    sag72("0163 laeuft", f163 === null, f163 ?? "durch");
    /*
     * OHNE DIE MIGRATION GIBT ES NICHTS ZU PRUEFEN, und jede weitere Zeile
     * liefe in „column types does not exist" — ein Fehlgrund, der den
     * eigentlichen verdeckt. Also hier abbrechen und BERICHTEN.
     */
    if (f163 !== null) {
      probe.push({
        name: "P72 0163: der Type als MENGE und genau ein Banner",
        ok: false,
        sagt: `0163 LAEUFT NICHT: ${f163}`,
      });
    } else {
    const zweimal = await fahre(db, M163);
    sag72("ein zweiter Lauf prallt ab", zweimal !== null && zweimal.includes("steht schon"),
          (zweimal ?? "DURCHGELAUFEN").slice(0, 44));

    /* ---- C: DIE KARTENKUNST HAT SICH NICHT BEWEGT. */
    const kunstNach = await w72(
      `select coalesce(md5(string_agg(sky_id || '|' || card_type, E'\n'
                                      order by sky_id)), '(leer)') as w
         from public.skylanders`);
    sag72("DIE KARTENKUNST IST ZEICHENGLEICH — derselbe Abdruck vor und nach "
          + "der Erstbelegung", kunstVor === kunstNach,
          `${kunstVor.slice(0, 12)} / ${kunstNach.slice(0, 12)}`);

    /* ---- D: die Erstbelegung, Zeile fuer Zeile. */
    const menge = async (id: string): Promise<string> => w72(
      `select coalesce(array_to_string(types, '+'), '(null)')
              || ' / ' || coalesce(visible_type, '-')
              || ' / ' || visible_type_decided::text as w
         from public.skylanders where sky_id = '${id}'`);
    for (const [id, erwartet, was] of [
      ["SKY-9301", " / - / false", "eine Figur ohne alles bleibt Standard"],
      ["SKY-9302", "giant+legendary / legendary / true", "GIANT + LEGENDARY"],
      ["SKY-9303", "special+trap / special / true", "TRAP + SPECIAL"],
      ["SKY-9310", "chase+vehicle / chase / true", "VEHICLE + CHASE"],
      ["SKY-9312", "elite+sensei / elite / true", "SENSEI + ELITE"],
      ["SKY-9313", "crystal+dark / dark / true", "CRYSTAL + DARK"],
      ["SKY-9308", "sidekick / - / false", "SIDEKICK — aus dem Kategorienamen"],
      ["SKY-9309", "mini / - / false", "MINI — ebenso, und nicht dasselbe"],
      ["SKY-9314", "swapper / - / false", "SWAPPER"],
      ["SKY-9315", "master / - / false", "MASTER (Trap Master)"],
      ["SKY-9311", " / - / false", "ein PORTAL bekommt keinen Figurentype"],
    ] as const) {
      const ist = await menge(id);
      sag72(`Erstbelegung ${was}`, ist === erwartet, `${id} ${ist}`);
    }
    sag72("und keine Gruppe ist auf einem Banner gelandet (D4): Zeilen mit "
          + "Gruppentype UND Banner, deren Banner ein Gruppentype ist",
          await w72(
            `select count(*)::text as w from public.skylanders
              where visible_type = any (array['giant','swapper','master','sensei',
                                              'mini','sidekick','item','trap',
                                              'vehicle','crystal'])`) === "0",
          "0");

    /* ---- E: die Menge ist kanonisch — der Trigger. */
    await db.exec(`update public.skylanders
                      set types = array['legendary','giant','legendary']
                    where sky_id = 'SKY-9302';`);
    sag72("der Trigger macht die Menge kanonisch: sortiert, jeder Wert einmal",
          (await w72("select array_to_string(types, '+') as w"
                     + " from public.skylanders where sky_id = 'SKY-9302'"))
          === "giant+legendary", await menge("SKY-9302"));

    /* ---- F: DIE MITGLIEDSCHAFT, AN DER TABELLE VORBEI VERSUCHT. */
    const fremd = await tu72(
      "update public.skylanders set visible_type = 'chase' where sky_id = 'SKY-9302';");
    sag72("DIE CHECK WEIST EIN BANNER AB, DAS NICHT IN DER MENGE STEHT — auch "
          + "an jeder Funktion vorbei",
          fremd !== null && fremd.includes("skylanders_visible_type_member"),
          (fremd ?? "DURCHGELAUFEN").slice(0, 70));
    const unbekannt = await tu72(
      "update public.skylanders set types = array['giant','superduper']"
      + " where sky_id = 'SKY-9302';");
    sag72("und ein unbekannter Type an der Menge ebenso",
          unbekannt !== null && unbekannt.includes("skylanders_types_known"),
          (unbekannt ?? "DURCHGELAUFEN").slice(0, 70));
    const unentschieden = await tu72(
      "update public.skylanders set visible_type = 'giant',"
      + " visible_type_decided = false where sky_id = 'SKY-9302';");
    sag72("und ein Banner ohne Entscheidung auch",
          unentschieden !== null && unentschieden.includes("visible_type_decided"),
          (unentschieden ?? "DURCHGELAUFEN").slice(0, 70));

    /* ---- G: ALLE SIEBZEHN WERTE sind einzeln zulaessig. */
    const alle = ["giant", "swapper", "master", "sensei", "mini", "sidekick",
                  "item", "trap", "vehicle", "crystal", "lightcore", "special",
                  "dark", "legendary", "elite", "chase", "prestige"];
    let einzeln = 0;
    for (const t of alle) {
      const f = await tu72(
        `select public.admin_set_figure_types('SKY-9301', array['${t}']);`);
      if (f === null
          && (await w72("select array_to_string(types, '+') as w"
                        + " from public.skylanders where sky_id = 'SKY-9301'")) === t) {
        einzeln += 1;
      }
    }
    sag72("alle siebzehn Types sind einzeln zuweisbar", einzeln === 17,
          `${einzeln} von 17`);

    /* ---- H: DIE VIER KOMBINATIONEN DES BETREIBERS, ueber die RPC. */
    for (const [paar, was] of [
      [["lightcore", "legendary"], "Legendary + LightCore"],
      [["mini", "chase"], "Mini + Chase"],
      [["giant", "legendary"], "Giant + Legendary"],
      [["trap", "special"], "Trap + Special"],
    ] as const) {
      const f = await tu72(
        `select public.admin_set_figure_types('SKY-9301',`
        + ` array['${paar[0]}','${paar[1]}']);`);
      const ist = await w72("select array_to_string(types, '+') as w"
                            + " from public.skylanders where sky_id = 'SKY-9301'");
      const beide = ist.split("+").sort().join("+")
                 === [...paar].sort().join("+");
      sag72(`${was} stehen NEBENEINANDER`, f === null && beide,
            `${f ?? ""} {${ist}}`);
    }

    /* ---- I: das Banner — nur ein hinterlegter Type, und „–" bleibt. */
    await db.exec("select public.admin_set_figure_types('SKY-9301',"
                  + " array['lightcore','legendary']);");
    const nichtDrin = await tu72(
      "select public.admin_set_visible_type('SKY-9301', 'chase');");
    sag72("die RPC weist einen Type ab, der nicht zugeordnet ist — und NENNT, "
          + "was zur Wahl stand",
          nichtDrin !== null && nichtDrin.includes("nicht zugeordnet")
          && nichtDrin.includes("legendary"),
          (nichtDrin ?? "DURCHGELAUFEN").slice(0, 80));
    const gesetzt = await tu72(
      "select public.admin_set_visible_type('SKY-9301', 'legendary');");
    sag72("LEGENDARY wird Banner, LightCore bleibt hinterlegt",
          gesetzt === null && (await menge("SKY-9301"))
            === "legendary+lightcore / legendary / true",
          await menge("SKY-9301"));
    const gewechselt = await tu72(
      "select public.admin_set_visible_type('SKY-9301', 'lightcore');");
    sag72("und der Wechsel auf LIGHTCORE laesst Legendary stehen",
          gewechselt === null && (await menge("SKY-9301"))
            === "legendary+lightcore / lightcore / true",
          await menge("SKY-9301"));
    const strich = await tu72(
      "select public.admin_set_visible_type('SKY-9301', null);");
    sag72("AUSDRUECKLICHES „–“: kein Banner, aber ENTSCHIEDEN — der Vorschlag "
          + "greift nie wieder",
          strich === null && (await menge("SKY-9301"))
            === "legendary+lightcore / - / true",
          await menge("SKY-9301"));
    const leer = await tu72(
      "select public.admin_set_visible_type('SKY-9301', '  ');");
    sag72("ein leerer String ist dasselbe wie „–“", leer === null
          && (await menge("SKY-9301")) === "legendary+lightcore / - / true",
          await menge("SKY-9301"));

    /* ---- J: wird der sichtbare Type entfernt, faellt das Banner auf „–". */
    await db.exec("select public.admin_set_visible_type('SKY-9301', 'legendary');");
    const entfernt = await tu72(
      "select public.admin_set_figure_types('SKY-9301', array['lightcore']);");
    sag72("ENTFERNEN DES SICHTBAREN TYPES setzt das Banner auf ausdrueckliches "
          + "„–“ — und die uebrigen Types bleiben",
          entfernt === null && (await menge("SKY-9301")) === "lightcore / - / true",
          await menge("SKY-9301"));

    /* ---- K: eine Zeile OHNE Banner bleibt UNENTSCHIEDEN. */
    await db.exec("select public.admin_set_figure_types('SKY-9309',"
                  + " array['mini','chase']);");
    sag72("eine Zeile ohne Banner bleibt nach einer Mengenaenderung "
          + "UNENTSCHIEDEN — sonst waere der Vorschlag still stillgelegt",
          (await menge("SKY-9309")) === "chase+mini / - / false",
          await menge("SKY-9309"));

    /* ---- L: das Journal. */
    const journal = await w72(
      `select coalesce(string_agg(field || ':' || coalesce(old_value, '-') || '>'
                                  || coalesce(new_value, '-'), ', '
                                  order by changed_at, id), '(leer)') as w
         from public.catalog_admin_changes
        where entity_id = 'SKY-9301' and field in ('types', 'visible_type')`);
    sag72("jede Mengen- und Banneraenderung steht im Journal",
          journal.includes("types:") && journal.includes("visible_type:")
          && journal.includes("legendary>-"),
          journal.slice(0, 120));

    /* ---- M: keine andere Spalte bewegt sich. */
    const nebenan = await w72(
      `select (card_type = 'standard' and name = 'P72 Spyro'
           and slug = 'sky-9301' and series_code = 'SA' and category_id = 20
           and catalog_status = 'public' and catalog_visible
           and base_sky_id is null and character_id is null)::text as w
         from public.skylanders where sky_id = 'SKY-9301'`);
    sag72("und KEINE andere Spalte der Zeile — auch nicht die Kartenkunst",
          nebenan === "true", nebenan);

    /* ---- N: ohne Adminrecht gar nichts. */
    await db.exec(`create or replace function public.is_platform_admin() returns boolean
                   language sql as $stub$ select false $stub$;`);
    const ohneRecht1 = await tu72(
      "select public.admin_set_figure_types('SKY-9302', array['giant']);");
    const ohneRecht2 = await tu72(
      "select public.admin_set_visible_type('SKY-9302', 'giant');");
    await db.exec(`create or replace function public.is_platform_admin() returns boolean
                   language sql as $stub$ select true $stub$;`);
    sag72("ohne Adminrecht weisen beide ab (42501)",
          ohneRecht1 !== null && ohneRecht1.includes("42501")
          && ohneRecht2 !== null && ohneRecht2.includes("42501"),
          `${(ohneRecht1 ?? "DURCH").slice(0, 16)} | ${(ohneRecht2 ?? "DURCH").slice(0, 16)}`);

    /* ---- O: DER WETTLAUF. Zwei Aenderungen an derselben Zeile. */
    const race = await tu72(
      `do $t$
       begin
         perform public.admin_set_figure_types('SKY-9313', array['crystal']);
         perform public.admin_set_visible_type('SKY-9313', 'crystal');
         perform public.admin_set_figure_types('SKY-9313', array['crystal','dark']);
       end $t$;`);
    sag72("drei Aenderungen in EINER Transaktion: die letzte gilt, das Banner "
          + "bleibt gueltig", race === null
          && (await menge("SKY-9313")) === "crystal+dark / crystal / true",
          `${race ?? ""} ${await menge("SKY-9313")}`);

    /* ---- P: DIE ZUSAMMENFUEHRUNG traegt die Menge. */
    await anlegen72("SKY-9320", "P72 Ziel", 20, "standard");
    await anlegen72("SKY-9321", "P72 Entwurf", 20, "standard", "draft");
    await db.exec("select public.admin_set_figure_types('SKY-9321',"
                  + " array['giant','chase']);");
    const plan = await w72(
      `select coalesce((select string_agg(e.wert ->> 'field', ',' order by
                                          e.wert ->> 'field')
                          from jsonb_array_elements(
                                 public.admin_merge_plan('SKY-9321','SKY-9320',null))
                               as e(wert)), '(leer)') as w`);
    sag72("der Plan nennt `types` als neuntes Feld",
          plan.includes("types"), plan);
    const verschmolzen = await tu72(
      "select public.admin_merge_draft('SKY-9321','SKY-9320',null,null);");
    sag72("und die Zusammenfuehrung uebernimmt sie",
          verschmolzen === null
          && (await w72("select array_to_string(types, '+') as w"
                        + " from public.skylanders where sky_id = 'SKY-9320'"))
             === "chase+giant",
          `${verschmolzen ?? ""} ${await menge("SKY-9320")}`);

    /* ---- Q: ein Entwurf OHNE Types nimmt dem Ziel nichts. */
    await anlegen72("SKY-9322", "P72 Entwurf leer", 20, "standard", "draft");
    await db.exec("select public.admin_set_visible_type('SKY-9320', 'giant');");
    const leerVerschmolzen = await tu72(
      "select public.admin_merge_draft('SKY-9322','SKY-9320',null,null);");
    sag72("ein Entwurf OHNE Types laesst die Menge des Ziels unberuehrt",
          leerVerschmolzen === null
          && (await menge("SKY-9320")) === "chase+giant / giant / true",
          `${leerVerschmolzen ?? ""} ${await menge("SKY-9320")}`);

    /* ---- R: faellt das Banner des Ziels aus der uebernommenen Menge,
     *         bricht die Zusammenfuehrung NICHT ab. */
    await anlegen72("SKY-9323", "P72 Entwurf anders", 20, "standard", "draft");
    await db.exec("select public.admin_set_figure_types('SKY-9323',"
                  + " array['trap','special']);");
    const andersVerschmolzen = await tu72(
      "select public.admin_merge_draft('SKY-9323','SKY-9320',null,null);");
    sag72("faellt das Banner aus der uebernommenen Menge, wird es auf „–“ "
          + "gesetzt — und die Zusammenfuehrung laeuft durch",
          andersVerschmolzen === null
          && (await menge("SKY-9320")) === "special+trap / - / true",
          `${andersVerschmolzen ?? ""} ${await menge("SKY-9320")}`);

    /* ---- S: die Variantenbeziehung ist unberuehrt (D7). */
    await anlegen72("SKY-9330", "P72 Basis", 20, "standard");
    await anlegen72("SKY-9331", "P72 Gold Basis", 20, "standard");
    await db.exec("select public.admin_set_variant_base('SKY-9331','SKY-9330',false);");
    await db.exec("select public.admin_set_figure_types('SKY-9331', array['chase']);");
    sag72("ein Type erzeugt KEINE Variantenbeziehung, und eine "
          + "Variantenbeziehung keinen Type (D7)",
          await w72(
            `select ((select base_sky_id from public.skylanders
                       where sky_id = 'SKY-9331') = 'SKY-9330'
                 and (select cardinality(types) from public.skylanders
                       where sky_id = 'SKY-9330') = 0)::text as w`) === "true",
          `${await menge("SKY-9330")} | ${await menge("SKY-9331")}`);

    /* ================================================================
     * U: DIE ZWEI MESSENDEN WAECHTER DER HUELLE — aus der Datei
     *    geschnitten und hier wirklich gefahren.
     *
     * WARUM DAS HIERHIN GEHOERT. `staging-0163.sql` wird vom Bediener in
     * den SQL-Editor eingefuegt; was dort schiefgeht, geht in einer
     * Transaktion auf der echten Datenbank schief. Die Huelle traegt seit
     * dem 2026-10-29 zwei Waechter, die den Bestand MESSEN statt eine Zahl
     * zu nennen — der eingefrorene Abdruck `4d6bbb02…` war nach zwei
     * Stunden redaktioneller Arbeit des Betreibers veraltet und haette die
     * Transaktion abgebrochen.
     *
     * Gefahren wird der ECHTE Text aus der Datei, nicht eine Kopie: so
     * kann die Probe nicht davon abweichen, was der Bediener einfuegt.
     * ============================================================= */
    {
      const huelle = readFileSync("supabase/operations/staging-0163.sql", "utf8");
      const schnitt = (von: string, bis: string): string => {
        const a = huelle.indexOf(von);
        const b = huelle.indexOf(bis, a);
        return a < 0 || b < 0 ? "" : huelle.slice(a, b);
      };
      /* A7: die zwei `set_config`-Anweisungen. */
      const a7 = schnitt("perform set_config('skyisles.kunst_vor'",
                         "  /*\n   * A7b:");
      /* B3 und B5, je bis zum naechsten Waechter. */
      const b3 = schnitt("v_vorher := current_setting", "  /* B4:");
      const b5 = schnitt("v_erwartet := current_setting", "  /*\n   * UND DIE REGEL");
      const rumpf = (sql: string) =>
        `do $u$ declare v_n integer; v_vorher text; v_nachher text;`
        + ` v_erwartet text; begin ${sql} end $u$;`;

      sag72("Aufbau U: die drei Blöcke sind aus der Hülle geschnitten",
            a7 !== "" && b3 !== "" && b5 !== "",
            `A7 ${a7.length} · B3 ${b3.length} · B5 ${b5.length}`);

      /* ---- U1: ohne A7 brechen beide ab, und sie sagen warum. */
      const ohneA7 = await tu72(rumpf(b3));
      sag72("OHNE den abgelegten Wert bricht B3 ab — ein Riegel, der sich "
            + "durch Weglassen entschaerfen laesst, ist keiner",
            ohneA7 !== null && ohneA7.includes("Waechter A7"),
            (ohneA7 ?? "DURCHGELAUFEN").slice(0, 60));
      const ohneA7b = await tu72(rumpf(b5));
      sag72("und B5 ebenso", ohneA7b !== null && ohneA7b.includes("Waechter A7"),
            (ohneA7b ?? "DURCHGELAUFEN").slice(0, 60));

      /* ---- U2: mit A7 und unveraenderter Kartenkunst gehen beide durch. */
      const gut = await tu72(
        `begin;\n${rumpf(a7)}\n${rumpf(b3)}\n${rumpf(b5)}\ncommit;`);
      sag72("MIT dem abgelegten Wert und unveraenderter Kartenkunst gehen "
            + "beide durch — bei JEDEM Bestand, ohne eingefrorene Zahl",
            gut === null, gut ?? "durch");

      /* ---- U3: und sie FANGEN eine veraenderte Kartenkunst. */
      const faengt = await tu72(
        `begin;\n${rumpf(a7)}\n`
        + `update public.skylanders set card_type = 'chase'`
        + ` where sky_id = 'SKY-9301';\n${rumpf(b3)}\ncommit;`);
      await tu72("rollback;");
      sag72("UND SIE FANGEN EINE VERAENDERTE KARTENKUNST — vorher/nachher "
            + "stehen beide in der Meldung",
            faengt !== null && faengt.includes("KARTENKUNST hat sich bewegt"),
            (faengt ?? "DURCHGELAUFEN").slice(0, 70));
      sag72("und die Transaktion ist zurueckgerollt: die Kartenkunst steht "
            + "unveraendert da",
            (await w72("select card_type as w from public.skylanders"
                       + " where sky_id = 'SKY-9301'")) === "standard",
            await w72("select card_type as w from public.skylanders"
                      + " where sky_id = 'SKY-9301'"));
    }

    /* ---- T: die Ruecknahme. */
    const journalVorR = await w72(
      "select count(*)::text as w from public.catalog_admin_changes"
      + " where field in ('types', 'visible_type')");
    const rueck = await fahre(db, R163);
    const fort = await w72(
      `select (select count(*) from pg_attribute a
                where a.attrelid = to_regclass('public.skylanders')
                  and a.attname in ('types','visible_type','visible_type_decided')
                  and not a.attisdropped)::text as w`);
    const kunstBleibt = await w72(
      `select (select count(*) from pg_attribute a
                where a.attrelid = to_regclass('public.skylanders')
                  and a.attname = 'card_type' and not a.attisdropped)::text as w`);
    const journalNachR = await w72(
      "select count(*)::text as w from public.catalog_admin_changes"
      + " where field in ('types', 'visible_type')");
    sag72("R0163 verweigert, solange die 0163-Fassung der Zusammenfuehrung "
          + "steht — sie wuerde eine Spalte schreiben, die es nicht mehr gibt",
          rueck !== null && rueck.includes("admin_merge_plan"),
          (rueck ?? "DURCHGELAUFEN").slice(0, 70));
    /*
     * ZURUECK MIT DEN ZWEI RUEMPFEN — und NICHT mit der ganzen Datei `0157`.
     *
     * DAS IST EIN ECHTER BEFUND UND KEINE BEQUEMLICHKEIT: `0157` schreibt
     * auch die Audit-Constraint neu, mit ZEHN Werten. Im Journal stehen
     * inzwischen Zeilen mit `field = 'types'`, und die Constraint wird beim
     * Anlegen gegen den Bestand geprueft — der Lauf scheitert also an seiner
     * eigenen Regel (`23514`). Deshalb nennt R0163 ausdruecklich „die
     * Abschnitte 4 und 5" und nicht „die Datei", und hier wird genau das
     * getan: die zwei Funktionsdefinitionen, herausgeschnitten.
     */
    const t0157 = readFileSync(
      join(MIG_DIR, "0157_audit_fields_and_automatic_notes.sql"), "utf8");
    const schnitt = (marke: string): string => {
      const a = t0157.indexOf(marke);
      const b = t0157.indexOf("\n$$;", a);
      return a < 0 || b < 0 ? "" : t0157.slice(a, b + 4);
    };
    const zurueck = await tu72(
      schnitt("create or replace function public.admin_merge_plan("));
    const zurueck2 = zurueck !== null ? zurueck : await tu72(
      schnitt("create or replace function public.admin_merge_draft(\n"
              + "  p_draft      text,\n  p_target     text,\n"
              + "  p_image_path text,\n  p_selection  jsonb\n)"));
    const rueck2 = zurueck2 === null ? await fahre(db, R163)
                                     : `0157-Abschnitt: ${zurueck2}`;
    sag72("danach entfernt sie die drei Spalten, laesst card_type stehen und "
          + "jede Journalzeile",
          rueck2 === null && fort !== "0" && kunstBleibt === "1"
          && journalVorR === journalNachR && Number(journalVorR) > 0,
          `${rueck2 ?? "durch"} · Spalten vorher ${fort} · card_type `
          + `${kunstBleibt} · Journal ${journalVorR}/${journalNachR}`);
    const fortNach = await w72(
      `select (select count(*) from pg_attribute a
                where a.attrelid = to_regclass('public.skylanders')
                  and a.attname in ('types','visible_type','visible_type_decided')
                  and not a.attisdropped)::text as w`);
    sag72("und die drei Spalten sind wirklich fort", fortNach === "0", fortNach);

    probe.push({
      name: "P72 0163: der Type als MENGE und genau ein Banner. Die "
        + "Erstbelegung aus Gruppe, Kategoriename und Kartentyp laesst die "
        + "KARTENKUNST zeichengleich — derselbe Abdruck vor und nach dem Lauf; "
        + "Giant+Legendary, Trap+Special, Vehicle+Chase, Sensei+Elite und "
        + "Crystal+Dark stehen nebeneinander, Sidekick und Mini sind "
        + "auseinandergehalten, ein Portal bekommt keinen Figurentype und "
        + "keine Gruppe landet auf einem Banner. Die MITGLIEDSCHAFT ist eine "
        + "CHECK: ein Banner ausserhalb der Menge, ein unbekannter Type und "
        + "ein Banner ohne Entscheidung werden an der Tabelle selbst "
        + "abgewiesen. Alle siebzehn Werte sind einzeln zuweisbar, die vier "
        + "Kombinationen des Betreibers stehen nebeneinander, „–“ bleibt "
        + "erhalten, das Entfernen des sichtbaren Types setzt auf „–“ "
        + "zurueck, eine Zeile ohne Banner bleibt unentschieden, ohne "
        + "Adminrecht geht nichts (42501), die Zusammenfuehrung traegt die "
        + "Menge als neuntes Feld, und die Variantenbeziehung bleibt "
        + "unberuehrt. Dazu die Ruecknahme, die card_type und jede "
        + "Journalzeile stehen laesst",
      ok: ok72,
      sagt: `0163: ${befund72.join(" · ")}`,
    });
    }
  }

  /* =====================================================================
   * P73 — 0164: der TYPE kommt in die Plattformsicherung.
   *
   * WAS DIESER DURCHGANG BEWEIST, und keine andere Stelle kann es: dass ein
   * Archiv OHNE diese Migration die Types VERLIERT, und mit ihr nicht. Nicht
   * am Rumpf abgelesen, sondern am Umlauf: sichern, loeschen, aus dem Archiv
   * wieder einspielen, vergleichen.
   *
   * UND DASS ALLE DREI FELDER NOETIG SIND. Mit `types` allein stuende die
   * Menge nach dem Einspielen wieder da und JEDES Banner waere fort; ohne
   * `visible_type_decided` waere „ausdruecklich kein Banner" danach wieder
   * „unentschieden". Jedes der drei wird einzeln geprueft.
   * ===================================================================== */
  {
    const befund73: string[] = [];
    let ok73 = true;
    const sag73 = (was: string, gut: boolean, text: string): void => {
      befund73.push(`${gut ? "" : "!! "}${was}: ${text}`);
      if (!gut) ok73 = false;
    };

    const M163 = join(MIG_DIR, "0163_catalog_types.sql");
    const M164 = join(MIG_DIR, "0164_platform_export_types.sql");
    const A0160 = "ff4f38e61cbd4e5857ea914d6be68d44";
    const A0164 = "7e9e58e2d84a9f8a7c660262aa21926b";

    const db = await frischNach0136();
    await serienUndIdentitaet(db);
    const w73 = async (sql: string): Promise<string> =>
      String(((await db.query(sql)) as { rows: Record<string, unknown>[] }).rows[0]?.w ?? "?");
    const tu73 = async (sql: string): Promise<string | null> => {
      try { await db.exec(sql); return null; }
      catch (e) {
        const f = e as { message?: string; code?: string };
        return `[${f.code ?? "?"}] ${(f.message ?? "FEHLER").slice(0, 160)}`;
      }
    };
    const abdruck73 = async (): Promise<string> => w73(
      "select md5(prosrc) as w from pg_proc p join pg_namespace n"
      + " on n.oid = p.pronamespace where n.nspname = 'public'"
      + " and p.proname = 'system_platform_export'");

    /* ---- Die Welt: wie P72, plus der Exportrumpf aus `0160`. */
    await db.exec(`create schema if not exists auth;
                   create table if not exists auth.users (id uuid primary key);`);
    await db.exec(`create or replace function public.is_platform_admin() returns boolean
                   language sql as $stub$ select true $stub$;`);
    await db.exec(`create unique index if not exists z_sky13_uniq
                     on public.skylanders (sky_id);`);
    await db.exec(`create unique index if not exists z_ce13_uniq
                     on public.catalog_editorial (sky_id);`);
    await db.exec(`create sequence if not exists public.z_char13_seq start 1;
                   alter table public.characters
                     alter column id set default nextval('public.z_char13_seq');
                   create unique index if not exists z_char13_id
                     on public.characters (id);`);
    await db.exec(`create unique index if not exists characters_canonical_name_key
                     on public.characters (lower(canonical_name));`);
    await db.exec(`insert into public.categories
                     (id, series_code, name, position, catalog_group)
                   values (40, 'SA', 'Figuren', 1, 'figure'),
                          (41, 'SA', 'Traps', 2, 'trap');`);
    await db.exec(`update public.skylanders set card_type = 'standard'
                    where card_type is null
                       or card_type not in ('standard', 'special', 'elite',
                                            'dark', 'legendary', 'chase',
                                            'prestige');`);
    await db.exec(`alter table public.skylanders
                     add constraint skylanders_card_type_known
                     check (card_type in ('standard', 'special', 'elite', 'dark',
                                          'legendary', 'chase', 'prestige'));`);
    await db.exec(`alter table public.catalog_admin_changes
                     add constraint catalog_admin_changes_field_known
                     check (field in ('catalog_visible', 'display_name_override',
                                      'admin_note', 'catalog_group',
                                      'image_override_path', 'card_type', 'created',
                                      'catalog_status', 'merged_from', 'discarded',
                                      'character_id', 'base_sky_id'));`);
    for (const m of ["0154_merge_draft_into_figure.sql", "0155_discard_draft.sql",
                     "0156_merge_selected_fields.sql",
                     "0157_audit_fields_and_automatic_notes.sql",
                     "0158_figure_families.sql", "0159_variant_base_figure.sql"]) {
      const f = await fahre(db, join(MIG_DIR, m));
      if (f !== null) sag73(`Aufbau ${m.slice(0, 4)}`, false, f);
    }
    /*
     * DIE VIERZEHN WERTE ERST JETZT — also so, wie die Constraint NACH `0162`
     * aussieht. `0157` schreibt sie neu und `0159` laesst sie mit zwoelf
     * Werten zurueck; wer sie vorher setzt, findet sie hinterher kleiner vor,
     * und `0163` bricht an seiner Reihenfolgepruefung ab. Daran ist mein
     * erster Lauf dieses Durchgangs gescheitert.
     */
    await db.exec(`alter table public.catalog_admin_changes
                     drop constraint catalog_admin_changes_field_known;
                   alter table public.catalog_admin_changes
                     add constraint catalog_admin_changes_field_known
                     check (field in ('catalog_visible', 'display_name_override',
                                      'admin_note', 'catalog_group',
                                      'image_override_path', 'card_type', 'created',
                                      'catalog_status', 'merged_from', 'discarded',
                                      'character_id', 'base_sky_id',
                                      'market_price', 'deleted'));`);
    await db.exec(`drop trigger if exists skylanders_canonical_types
                     on public.skylanders;
                   drop function if exists public.skylanders_canonical_types();
                   drop function if exists
                     public.admin_set_figure_types(text,text[]);
                   drop function if exists public.admin_set_visible_type(text,text);
                   alter table public.skylanders
                     drop constraint if exists skylanders_visible_type_decided,
                     drop constraint if exists skylanders_visible_type_member,
                     drop constraint if exists skylanders_types_known,
                     drop column if exists visible_type_decided,
                     drop column if exists visible_type,
                     drop column if exists types;`);

    /*
     * DER EXPORTRUMPF AUS `0160`, aus der Datei geschnitten — das Stub-Schema
     * traegt die Fassung aus `0164`, weil es aus ALLEN Migrationen entsteht.
     * Fuer den Riegel muss der VORGAENGER dastehen.
     */
    const anweisungVon73 = (datei: string): string => {
      const sql = readFileSync(datei, "utf8");
      const von = sql.indexOf(
        "create or replace function public.system_platform_export()");
      const bis = sql.indexOf("\n$$;", von) + "\n$$;".length;
      return sql.slice(von, bis);
    };
    await db.exec(anweisungVon73(
      join(MIG_DIR, "0160_platform_export_base_sky_id.sql")));
    sag73("Aufbau: der Exportrumpf ist der aus 0160",
          (await abdruck73()) === A0160, await abdruck73());

    /* ---- A: OHNE 0163 bricht 0164 ab. */
    const ohne0163 = await fahre(db, M164);
    sag73("ohne 0163 bricht 0164 ab — die drei Spalten fehlen",
          ohne0163 !== null && ohne0163.includes("setzt 0163 voraus"),
          (ohne0163 ?? "DURCHGELAUFEN").slice(0, 60));

    /* ---- B: 0163, dann der Bestand. */
    const f163 = await fahre(db, M163);
    if (f163 !== null) {
      probe.push({ name: "P73 0164: der Type in der Plattformsicherung",
                   ok: false, sagt: `0163 laeuft nicht: ${f163}` });
    } else {
      const anlegen73 = async (id: string, name: string, katId: number) =>
        db.exec(`insert into public.skylanders
                   (sky_id, name, slug, series_code, category_id, item_type,
                    card_type, is_active, catalog_visible, catalog_status, source)
                 values ('${id}', '${name}', '${id.toLowerCase()}', 'SA',
                         ${katId}, 'figure', 'standard', true, true, 'public',
                         'admin');`);
      await anlegen73("SKY-7301", "P73 mit Banner", 41);
      await anlegen73("SKY-7302", "P73 ohne Banner", 41);
      await anlegen73("SKY-7303", "P73 ausdruecklich ohne", 41);
      await db.exec(`select public.admin_set_figure_types('SKY-7301',
                       array['trap','legendary']);
                     select public.admin_set_visible_type('SKY-7301', 'legendary');
                     select public.admin_set_figure_types('SKY-7302',
                       array['trap','chase']);
                     select public.admin_set_figure_types('SKY-7303',
                       array['trap']);
                     select public.admin_set_visible_type('SKY-7303', null);`);

      /** Der Katalogbereich des Archivs, als eine Zeile je SKY-ID. */
      const archiv = async (): Promise<string> => w73(
        `select coalesce(string_agg(x.sky_id || '=' || x.t || '/' || x.v || '/' || x.d,
                                    ', ' order by x.sky_id), '(leer)') as w
           from (select e ->> 'sky_id' as sky_id,
                        coalesce(e ->> 'types', '(FEHLT)') as t,
                        coalesce(e ->> 'visible_type', '-') as v,
                        coalesce(e ->> 'visible_type_decided', '(FEHLT)') as d
                   from jsonb_array_elements(
                          (public.system_platform_export() -> 'data' -> 'skylanders')) as e
                  where e ->> 'sky_id' like 'SKY-730%') x`);

      /* ---- C: OHNE 0164 fuehrt das Archiv die Types NICHT. Die Luecke. */
      const vorher = await archiv();
      sag73("OHNE 0164 fuehrt das Archiv weder Menge noch Banner — eine "
            + "Wiederherstellung verlore beides",
            vorher.includes("(FEHLT)") && !vorher.includes("legendary"),
            vorher.slice(0, 110));

      /* ---- D: 0164 laeuft. */
      const lauf = await fahre(db, M164);
      const nachher = await abdruck73();
      const laenge = await w73(
        "select length(prosrc)::text as w from pg_proc p join pg_namespace n"
        + " on n.oid = p.pronamespace where n.nspname = 'public'"
        + " and p.proname = 'system_platform_export'");
      sag73("0164 laeuft; der Rumpf ist der zugesagte und 31248 Zeichen lang",
            lauf === null && nachher === A0164 && laenge === "31248",
            `${lauf ?? "durch"} · ${nachher} · ${laenge}`);

      /* DIE UMKEHRPROBE AM LEBENDEN RUMPF: die drei Zeilen abziehen. */
      const zurueckgedreht = await w73(
        "select md5(replace(replace(replace(prosrc,"
        + " E'\\n            ''types'', t.types,', ''),"
        + " E'\\n            ''visible_type'', t.visible_type,', ''),"
        + " E'\\n            ''visible_type_decided'', t.visible_type_decided,',"
        + " '')) as w from pg_proc p join pg_namespace n on n.oid = p.pronamespace"
        + " where n.nspname = 'public' and p.proname = 'system_platform_export'");
      sag73("zieht man die DREI Zeilen ab, ist er zeichengleich der aus 0160",
            zurueckgedreht === A0160, zurueckgedreht);

      /* ---- E: MIT 0164 fuehrt das Archiv alle drei Felder. */
      const nachArchiv = await archiv();
      sag73("MIT 0164 fuehrt das Archiv Menge, Banner UND das Kennzeichen",
            nachArchiv === 'SKY-7301=["legendary", "trap"]/legendary/true, '
                         + 'SKY-7302=["chase", "trap"]/-/false, '
                         + 'SKY-7303=["trap"]/-/true',
            nachArchiv);

      /* ================================================================
       * DER UMLAUF: sichern, loeschen, aus dem Archiv wieder einspielen.
       * ============================================================= */
      await db.exec(`create table z_archiv73 as
                     select public.system_platform_export() as doc;`);
      await db.exec("delete from public.skylanders where sky_id like 'SKY-730%';");
      const weg = await w73("select count(*)::text as w from public.skylanders"
                            + " where sky_id like 'SKY-730%'");
      const einspielen = await tu73(`
        insert into public.skylanders
          (sky_id, name, slug, series_code, category_id, item_type, card_type,
           is_active, catalog_visible, catalog_status, source,
           types, visible_type, visible_type_decided)
        select e ->> 'sky_id', e ->> 'name', e ->> 'slug', e ->> 'series_code',
               (e ->> 'category_id')::bigint, 'figure', 'standard',
               (e ->> 'is_active')::boolean, (e ->> 'catalog_visible')::boolean,
               e ->> 'catalog_status', 'admin',
               array(select jsonb_array_elements_text(e -> 'types')),
               e ->> 'visible_type',
               (e ->> 'visible_type_decided')::boolean
          from z_archiv73 z,
               jsonb_array_elements(z.doc -> 'data' -> 'skylanders') as e
         where e ->> 'sky_id' like 'SKY-730%';`);
      const danach = await w73(
        `select coalesce(string_agg(sky_id || '=' || array_to_string(types, '+')
                                    || '/' || coalesce(visible_type, '-')
                                    || '/' || visible_type_decided::text,
                                    ', ' order by sky_id), '(leer)') as w
           from public.skylanders where sky_id like 'SKY-730%'`);
      sag73("DER UMLAUF: nach dem Einspielen stehen Menge, Banner und das "
            + "Kennzeichen wieder da — auch das ausdrueckliche „–“",
            weg === "0" && einspielen === null
            && danach === "SKY-7301=legendary+trap/legendary/true, "
                        + "SKY-7302=chase+trap/-/false, "
                        + "SKY-7303=trap/-/true",
            `geloescht ${weg} · ${einspielen ?? "eingespielt"} · ${danach}`);

      /*
       * UND DIE MITGLIEDSCHAFT HAT DAS EINSPIELEN UEBERLEBT. Das ist der
       * Grund, warum alle drei Felder mitmuessen: ein Archiv mit `types`
       * aber ohne `visible_type` koennte eine Zeile nur noch ohne Banner
       * zurueckbringen, und ein Archiv mit `visible_type` ohne die Menge
       * braechte eine Zeile, die die CHECK gar nicht annimmt.
       */
      const halb = await tu73(`
        insert into public.skylanders
          (sky_id, name, slug, series_code, category_id, item_type, card_type,
           is_active, catalog_visible, catalog_status, source,
           types, visible_type, visible_type_decided)
        values ('SKY-7309', 'P73 halbes Archiv', 'sky-7309', 'SA', 41, 'figure',
                'standard', true, true, 'public', 'admin',
                '{}', 'legendary', true);`);
      sag73("ein halbes Archiv — Banner ohne Menge — wird von der CHECK "
            + "abgewiesen, nicht stillschweigend eingespielt",
            halb !== null && halb.includes("visible_type_member"),
            (halb ?? "DURCHGELAUFEN").slice(0, 60));

      /* ---- F: ein zweiter Lauf prallt ab. */
      const zweimal = await fahre(db, M164);
      sag73("ein zweiter Lauf prallt am eigenen Abdruck ab",
            zweimal !== null && zweimal.includes("bereits angewendet"),
            (zweimal ?? "DURCHGELAUFEN").slice(0, 50));

      /* ---- G: eine fremde Fassung wird nicht ueberschrieben. */
      await db.exec(`create or replace function public.system_platform_export()
                     returns jsonb language sql security definer
                     set search_path = '' as $fremd$ select '{}'::jsonb $fremd$;`);
      const fremd = await fahre(db, M164);
      sag73("und eine FREMDE Fassung erst recht nicht",
            fremd !== null && fremd.includes("nicht der aus 0160"),
            (fremd ?? "DURCHGELAUFEN").slice(0, 60));

      /* ---- H: die Ruecknahme — sie verweigert bei einer fremden Fassung. */
      const rueckFremd = await fahre(db,
        "supabase/rollback/R0164_platform_export_back_to_0160.sql");
      sag73("R0164 verweigert bei einer fremden Fassung",
            rueckFremd !== null && rueckFremd.includes("weder der aus 0164"),
            (rueckFremd ?? "DURCHGELAUFEN").slice(0, 60));

      /* Mit dem Rumpf aus 0164 zurueck: dann sagt sie, was einzufuegen ist. */
      await db.exec(anweisungVon73(M164));
      const rueckEcht = await fahre(db,
        "supabase/rollback/R0164_platform_export_back_to_0160.sql");
      sag73("mit dem Rumpf aus 0164 verlangt sie den Abschnitt aus 0160 — und "
            + "ohne ihn schlaegt ihre Nachbedingung an",
            rueckEcht !== null && rueckEcht.includes("Abschnitt oben fehlt"),
            (rueckEcht ?? "DURCHGELAUFEN").slice(0, 70));

      /* Und mit dem Abschnitt laeuft sie durch. */
      await db.exec(anweisungVon73(
        join(MIG_DIR, "0160_platform_export_base_sky_id.sql")));
      const rueckGut = await fahre(db,
        "supabase/rollback/R0164_platform_export_back_to_0160.sql");
      sag73("mit ihm laeuft sie durch, und der Abdruck ist der aus 0160",
            rueckGut === null && (await abdruck73()) === A0160,
            `${rueckGut ?? "durch"} · ${await abdruck73()}`);

      /* ---- I: UND DIE SPALTEN SIND UNBERUEHRT. */
      sag73("die drei Spalten stehen nach der Ruecknahme unveraendert da — "
            + "R0164 nimmt nur den Rumpf zurueck",
            await w73(
              `select coalesce(string_agg(sky_id || '=' || array_to_string(types, '+'),
                                          ', ' order by sky_id), '(leer)') as w
                 from public.skylanders where sky_id like 'SKY-730%'`)
            === "SKY-7301=legendary+trap, SKY-7302=chase+trap, SKY-7303=trap",
            "unveraendert");

      probe.push({
        name: "P73 0164: der TYPE kommt in die Plattformsicherung. Ohne sie "
          + "fuehrt das Archiv weder Menge noch Banner noch Kennzeichen — mit "
          + "ihr alle drei, und der UMLAUF beweist es: sichern, loeschen, "
          + "einspielen, und jede Menge, jedes Banner und jedes ausdrueckliche "
          + "„–“ steht wieder da. Ein halbes Archiv (Banner ohne Menge) weist "
          + "die Mitgliedschafts-CHECK ab. Dazu die drei Riegel — ohne 0163, "
          + "ein zweiter Lauf, eine fremde Fassung —, die Umkehrprobe am "
          + "lebenden Rumpf (die drei Zeilen abgezogen ergibt zeichengleich "
          + "den aus 0160) und die Ruecknahme, die nur den Rumpf zurueckdreht "
          + "und die Spalten stehen laesst",
        ok: ok73,
        sagt: `0164: ${befund73.join(" · ")}`,
      });
    }
  }

  for (const p of probe) console.log(`  ${p.ok ? "OK     " : "FEHLER "} ${p.name}\n           ${p.sagt}`);
  console.log("-".repeat(76));
  const probeFehler = probe.filter((p) => !p.ok);
  console.log(`  ${probe.length - probeFehler.length} von ${probe.length} Durchgängen wie erwartet`);

  console.log("\nWAS DIESER LAUF BEWEIST — UND WAS NICHT");
  console.log("  bewiesen (Stufe 2): jede geplante Anweisung ist syntaktisch gültig, jeder");
  console.log("                Name löst auf, jeder Typ passt, jede Signatur existiert.");
  console.log("  bewiesen (Stufe 3): jeder gefaltete Funktionsrumpf lässt sich erzeugen. Für");
  console.log("                `language sql` ist darin jede Spalte und jeder Typ aufgelöst;");
  console.log("                für `language plpgsql` prüft PostgreSQL bei der Erzeugung nur");
  console.log("                die Syntax — Namen darin sieht erst der Aufruf.");
  console.log("  bewiesen (Stufe 4): die Migrationen laufen in EINER Transaktion durch, sie");
  console.log("                brechen ohne Klammer ab, sie brechen bei verändertem Angebot");
  console.log("                ab, und sie lassen nach einem Abbruch nichts zurück.");
  console.log("  NICHT bewiesen: dass eine Datei auf Production LÄUFT. Die Zeilen in Stufe 4");
  console.log("                sind ERFUNDEN — fünf Katalogzeilen, zwei Lagerzeilen. Über die");
  console.log("                echten Bestände, über Laufzeitfehler an echten Daten und über");
  console.log("                die fachliche Richtigkeit einer Prüfung sagt dieser Lauf nichts.");
  console.log("  Eine erfolgreiche Plan-, Definitions- und Probeprüfung ist KEIN erfolgreicher");
  console.log("  Lauf gegen Production. Nachweis bleibt allein das Ergebnisblatt aus dem");
  console.log("  SQL-Editor (supabase/checks/open_verifications.md).\n");

  if (ueberholt.length > 0) {
    console.error(`  ABBRUCH: ${ueberholt.length} Ausnahme(n) sind ueberholt — Liste kuerzen.`);
    process.exitCode = 1;
  }
  if (fehler.length > 0) process.exitCode = 1;
  if (nichtErzeugt.length > 0) {
    console.error(`  ABBRUCH: ${nichtErzeugt.length} Funktionsrumpf/-rümpfe lassen sich nicht erzeugen.`);
    process.exitCode = 1;
  }
  if (unnoetigeAusnahme.length > 0) {
    console.error(`  ABBRUCH: ${unnoetigeAusnahme.length} Ausnahme(n) in NICHT_ERZEUGBAR sind `
      + `überholt — Liste kürzen: ${unnoetigeAusnahme.join(", ")}`);
    process.exitCode = 1;
  }
  if (probeFehler.length > 0) {
    console.error(`  ABBRUCH: ${probeFehler.length} Probelauf/-läufe weichen ab.`);
    process.exitCode = 1;
  }
}

main().catch((e: unknown) => {
  console.error(`\nValidierung fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
