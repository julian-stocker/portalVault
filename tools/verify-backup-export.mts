/**
 * Eine heruntergeladene Betriebssicherung gegen die Staging-Baseline halten.
 *
 *   npm run verify:backup -- --file ~/Downloads/skyisles-business-backup-….json
 *
 * NUR LESEN, UND ZWAR EINE DATEI. Keine Datenbank, kein Netz, kein Schlüssel,
 * keine Umgebungsvariable. Dieses Werkzeug öffnet genau den Pfad, den es
 * bekommt, und schreibt nichts.
 *
 * DIE DATEI DARF NICHT IN DAS REPOSITORY WANDERN. Sie trägt Käufernamen,
 * Anschriften und Einkaufskosten — die drei Klassen, die `docs/SECURITY.md`
 * hier verbietet. `.gitignore` fängt den kanonischen Dateinamen ab; dieses
 * Werkzeug fängt den Weg ab: liegt der Pfad innerhalb des
 * Arbeitsverzeichnisses, bricht es ab, statt die Datei zu lesen. Ein
 * Werkzeug, das bequem mit einer Kopie im Projektordner arbeitet, lädt dazu
 * ein, sie dort liegen zu lassen.
 *
 * WAS ES AUSGIBT. Zahlen, Belegnummern, SKY-IDs und Prüfsummen. Keine Namen,
 * keine Anschriften, keinen Belegsnapshot, keinen Buy-in-Faktor — die Logik
 * dahinter steht in `src/lib/backup/export-audit.ts`, und ein Test füttert sie
 * mit erfundenen personenbezogenen Daten und hält fest, dass keine davon im
 * Bericht erscheint.
 *
 * Rückgabewert 1 bei mindestens einer Abweichung, damit ein Durchlauf nicht
 * aus Versehen als bestanden gelesen wird.
 */
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import {
  auditBackup, buildFieldPlan, report, STAGING_BASELINE,
} from "../src/lib/backup/export-audit.ts";
/*
 * DAS MANIFEST DIREKT — es hat selbst keine Abhängigkeiten, läuft also unter
 * dem TypeScript-Lader von Node. `export-audit.ts` importiert es bewusst NICHT
 * (dort wäre jede transitive Endung ein Problem); zusammengesetzt wird hier.
 */
import { BACKUP_SECTIONS } from "../src/lib/backup/manifest.ts";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const pfad = arg("file");
if (pfad === null) {
  console.error("Aufruf: npm run verify:backup -- --file <pfad zur backup.json>");
  process.exit(2);
}

const absolut = resolve(pfad.replace(/^~(?=\/|$)/, process.env.HOME ?? "~"));
const innerhalb = relative(process.cwd(), absolut);
if (!innerhalb.startsWith("..") && !innerhalb.startsWith("/")) {
  console.error(
    "ABBRUCH: die Datei liegt im Arbeitsverzeichnis des Projekts.\n"
    + "Eine Betriebssicherung gehört auf die eigene Platte, nicht hierher "
    + "(docs/SECURITY.md).\nVerschiebe sie heraus und ruf das Werkzeug mit dem "
    + "neuen Pfad auf.");
  process.exit(2);
}

let doc: unknown;
try {
  doc = JSON.parse(readFileSync(absolut, "utf8"));
} catch (fehler) {
  console.error(`ABBRUCH: ${absolut} ist nicht lesbar oder kein JSON.`);
  console.error(fehler instanceof Error ? fehler.message : String(fehler));
  process.exit(2);
}

/*
 * DER FELDPLAN AUS DEN ZWEI QUELLEN, DIE OHNE DIE DATEI AUSKOMMEN.
 *
 * `manifest.ts` ist die Entscheidung, der Rumpf der letzten Migration mit
 * `seller_business_backup()` ihre Ausführung. Weichen sie voneinander ab, ist
 * das der erste Befund — und zwar bevor die Datei gelesen wird: dann
 * beschreibt die Entscheidung etwas anderes als der Code, und welche von
 * beiden in der Datei steht, wäre Glückssache.
 *
 * Gelesen wird die LETZTE Fassung, nicht die erste Datei. Die
 * Migrationshistorie ist eine Faltung; `0104` legt die Funktion an, `0129`,
 * `0130` und `0131` ersetzen sie.
 */
const MIGRATIONEN = "supabase/migrations";
const letzteFassung = (): string => {
  const dateien = readdirSync(MIGRATIONEN).filter((f) => f.endsWith(".sql")).sort();
  for (let i = dateien.length - 1; i >= 0; i -= 1) {
    const sql = readFileSync(`${MIGRATIONEN}/${dateien[i]}`, "utf8");
    if (sql.includes("create or replace function public.seller_business_backup()")) {
      return sql;
    }
  }
  throw new Error("keine Migration legt seller_business_backup() an");
};

const { plan, conflicts } = buildFieldPlan(BACKUP_SECTIONS, letzteFassung());
if (conflicts.length > 0) {
  console.error("ABBRUCH: Manifest und SQL-Rumpf sind sich nicht einig.");
  for (const c of conflicts) console.error(`  ${c}`);
  console.error(
    "\nDie Datei wurde NICHT geprüft: ohne einen widerspruchsfreien Plan wäre\n"
    + "jedes Ergebnis eine Aussage über die falsche Erwartung.");
  process.exit(2);
}

const baseline = { ...STAGING_BASELINE, fieldPlan: plan };
const ergebnis = auditBackup(doc, baseline);
console.log(report(ergebnis, baseline).join("\n"));
process.exit(ergebnis.failed === 0 ? 0 : 1);
