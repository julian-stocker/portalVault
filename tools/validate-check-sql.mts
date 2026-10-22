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
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
  console.log("\nPROBELAUF — die fuenf auf Production fehlenden Migrationen, gegen erfundene Zeilen");
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
   * (das ist der Stand `0134`, den Production führt), und die Spalten, die
   * sie anlegen, wieder weg. Welche das sind, liest er aus den Dateien
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
    if (lauf === null) {
      const blatt = await db.query(
        readFileSync("supabase/checks/0142_postflight.sql", "utf8")) as {
          rows: { nr: number; befund: string; ok: boolean | null }[] };
      nachRot = blatt.rows.filter((r) => r.ok === false).map((r) => r.nr).join(", ");
      nachZeilen = blatt.rows.find((r) => r.nr === 102)?.befund ?? "(fehlt)";
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
        && nachRot === "502, 9999" && nachZeilen === spalten
        && policies === "4" && rls === "true"
        && typeof zweimal === "string" && zweimal.includes("steht schon")
        && zweiNull === "zwei ohne Einkauf: ok" && doppelt === "abgewiesen"
        && keinArray === "abgewiesen"
        && typeof mitZeilen === "string" && mitZeilen.includes("Zeile(n) stehen in der Tabelle")
        && ohneZeilen === null && fort === "true",
      sagt: `0142: ${lauf ?? "durch"} · ${policies} Policies · RLS ${rls}`
        + ` · Nachkontrolle rot: ${nachRot}`
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
        && zurueck === null && bleibt === "true",
      sagt: `0143: ${lauf ?? "durch"} · ohne Rolle: ${ohneRolle}`
        + ` · fremde Kalkulation: ${fremd} · Einkauf ${einkauf} mit ${positionen} Positionen,`
        + ` verknuepft ${verknuepft} · zweiter Lauf desselben Entwurfs: ${nochmal}`
        + ` (Einkaeufe ${anzahlDanach}) · neuer Entwurf: ${zweiterVersuch}`
        + ` (Einkaeufe ${anzahlZuletzt}) · Ruecknahme ${zurueck ?? "durch"},`
        + ` Verknuepfung bleibt ${bleibt}`,
    });
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
