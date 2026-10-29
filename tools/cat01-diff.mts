/**
 * CAT-01B — Katalogabgleich, ausschliesslich lesend.
 *
 *   npm run cat01:diff                 Momentaufnahme holen und vergleichen
 *   npm run cat01:diff -- --offline    nur vergleichen, nichts holen
 *
 * WAS ES TUT UND WAS NICHT. Es liest die Checkliste unter `resources/web/`,
 * holt die oeffentlichen Katalogspalten lesend aus Staging und schreibt drei
 * Dateien nach `resources/analysis/`. Es schreibt NICHTS in die Datenbank,
 * nichts nach `data/`, `public/` oder `supabase/`, legt keine SKY-ID an und
 * extrahiert kein Bild.
 *
 * WARUM DIE MOMENTAUFNAHME. Der Betreiber hat Reproduzierbarkeit verlangt:
 * eine Auswertung, die bei jedem Lauf gegen einen anderen Katalogstand
 * rechnet, ist nicht nachvollziehbar. Also wird der Stand einmal
 * festgeschrieben (`cat-01-katalog.json`) und danach dagegen gerechnet;
 * `--offline` rechnet gegen genau diesen Stand weiter.
 *
 * WARUM NUR DER ANON-SCHLUESSEL. `skylanders` ist weltlesbar (ADR-0025), der
 * Abgleich braucht also kein Privileg. Der Service-Role-Schluessel wird hier
 * nicht einmal gelesen — ein Werkzeug, das nur lesen soll, soll auch nur
 * lesen koennen.
 *
 * WARUM DER VERGLEICH IN PYTHON STEHT. Dieselbe Begruendung wie bei
 * `validate-check-sql.mts` → `stub-schema.py`: eine .xlsx sicher zu lesen
 * heisst ZIP plus XML, und beides hat Python in der Standardbibliothek. In
 * Node braeuchte es eine Fremdbibliothek, und die waere bei einer Datei aus
 * dem Internet genau der falsche Zuwachs an Angriffsflaeche.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

import { readEnvFile, STAGING_ENV_FILE } from "./lib/staging-guard.mts";

const AUSGABE = "resources/analysis";
const SNAPSHOT = `${AUSGABE}/cat-01-katalog.json`;
const QUELLE = "resources/web/Complete Skylanders Checklist.xlsx";

/**
 * Die Spalten, die der Abgleich braucht — und nur die.
 *
 * `market_price` ist ABSICHTLICH nicht dabei. Der Abgleich entscheidet nichts
 * an Preisen, und eine Momentaufnahme im Repository soll nur enthalten, was
 * sie zum Vergleichen braucht.
 */
const SPALTEN = [
  "sky_id", "name", "display_name_override", "slug", "series_code",
  "card_type", "item_type", "character_id", "image_file", "image_override_path",
].join(",");

async function holeKatalog(): Promise<void> {
  const env = readEnvFile(STAGING_ENV_FILE);
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error(`CAT-01 ABBRUCH: ${STAGING_ENV_FILE} unvollstaendig.`);

  const ziel = `${url}/rest/v1/skylanders?select=${SPALTEN}&order=sky_id&limit=2000`;
  const antwort = await fetch(ziel, { headers: { apikey: anon, Authorization: `Bearer ${anon}` } });
  if (!antwort.ok) throw new Error(`CAT-01 ABBRUCH: REST ${antwort.status}.`);
  const zeilen = (await antwort.json()) as unknown[];
  if (!Array.isArray(zeilen) || zeilen.length === 0) {
    throw new Error("CAT-01 ABBRUCH: Katalog kam leer zurueck.");
  }
  mkdirSync(AUSGABE, { recursive: true });
  writeFileSync(SNAPSHOT, JSON.stringify(zeilen, null, 1));
  console.log(`  Momentaufnahme : ${zeilen.length} Zeilen → ${SNAPSHOT}`);
}

const offline = process.argv.includes("--offline");
if (!existsSync(QUELLE)) {
  console.error(`CAT-01 ABBRUCH: Quelldatei fehlt (${QUELLE}).`);
  process.exit(1);
}
if (offline) {
  if (!existsSync(SNAPSHOT)) {
    console.error(`CAT-01 ABBRUCH: --offline, aber keine Momentaufnahme (${SNAPSHOT}).`);
    process.exit(1);
  }
  console.log(`  Momentaufnahme : unveraendert benutzt (${SNAPSHOT})`);
} else {
  await holeKatalog();
}
execFileSync("python3", ["tools/lib/cat01-diff.py", QUELLE], { stdio: "inherit" });
console.log(`  Ergebnis       : ${AUSGABE}/cat-01-differenz.{md,csv}`);
