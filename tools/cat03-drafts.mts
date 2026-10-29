/**
 * CAT-03 — Katalogentwuerfe aus den CAT-01-Kandidaten, ausschliesslich lesend.
 *
 *   npm run cat03:drafts:staging              Momentaufnahme holen und aufbereiten
 *   npm run cat03:drafts:staging -- --offline nur aufbereiten, nichts holen
 *
 * WARUM ES CAT-01 NICHT WIEDERHOLT, SONDERN BERICHTIGT
 *
 * `cat01:diff` holt den Katalog mit dem **anon**-Schluessel. Das war fuer eine
 * Bestandsanalyse richtig (`skylanders` ist weltlesbar, ADR-0025), fuer CAT-03
 * ist es aber zu wenig: RLS zeigt `anon` nur Zeilen mit
 * `is_active and catalog_visible`. Die Momentaufnahme aus CAT-01B traegt
 * deshalb 594 Zeilen, der Katalog aber deutlich mehr — allein Eon's Elite
 * fuehrt 28 absichtlich nicht oeffentliche Zeilen (ADR-0069).
 *
 * **Daraus folgt der Fehler, den dieses Werkzeug verhindert:** ein Kandidat,
 * der als versteckte Zeile schon existiert, waere in CAT-01B als „fehlend"
 * erschienen. Wer darauf einen Entwurf anlegt, erzeugt eine fachliche
 * Dublette mit einer neuen SKY-ID — und SKY-IDs sind dauerhaft.
 *
 * ES LIEST DESHALB MIT DEM DIENSTSCHLUESSEL, und das ist der einzige Grund:
 * um zu sehen, was es NICHT anlegen darf. Es schreibt nichts — kein
 * `insert`, kein `update`, kein `rpc`, keine Migration, keine SKY-ID, kein
 * Bild. Der Schluesselwert wird nirgends ausgegeben.
 *
 * WARUM DER VERGLEICH IN PYTHON STEHT: dieselbe Begruendung wie bei
 * `cat01-diff.mts` — eine .xlsx sicher zu lesen heisst ZIP plus XML, und
 * beides hat Python in der Standardbibliothek.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

import { readEnvFile, requireStaging, STAGING_ENV_FILE } from "./lib/staging-guard.mts";

const AUSGABE = "resources/analysis";
const SNAPSHOT = `${AUSGABE}/cat-03-katalog-vollstaendig.json`;
const QUELLE = "resources/web/Complete Skylanders Checklist.xlsx";

/**
 * Die Spalten, die die Aufbereitung braucht — und nur die.
 *
 * `catalog_visible` und `is_active` sind NEU gegenueber CAT-01B und der
 * eigentliche Zweck dieses Laufs: sie sagen, ob eine gefundene Zeile
 * oeffentlich ist oder versteckt. Beides schliesst einen Entwurf aus.
 *
 * NICHT DABEI, und das ist Absicht: `admin_note` (interne Notiz, gehoert
 * nach `catalog_editorial`, ADR-0039), `market_price` (CAT-03 entscheidet
 * nichts an Preisen) und alles aus Lager, Bestellungen und Sammlung.
 */
const SPALTEN = [
  "sky_id", "name", "display_name_override", "slug", "series_code",
  "category_id", "card_type", "item_type", "character_id",
  "image_file", "image_override_path", "catalog_visible", "is_active",
].join(",");

/**
 * Und die Kategorien, weil DORT die Feinunterscheidung liegt.
 *
 * `item_type` kennt fuenf Werte (`figure`, `game`, `portal`, `bundle`,
 * `other`) und ist absichtlich grob — eine Falle, ein Fahrzeug und ein
 * Kreationskristall sind alle `figure`. Was sie unterscheidet, ist die
 * KATEGORIE je Serie: „Traps", „Fahrzeuge", „Kreationskristalle", „Magic
 * Items". Ein Entwurf ohne `category_id` waere deshalb nicht einordenbar,
 * und eine erfundene Kategorie waere schlimmer als keine.
 */
const KATEGORIESPALTEN = ["id", "series_code", "name", "position"].join(",");
const KATEGORIEN = `${AUSGABE}/cat-03-kategorien.json`;

async function holeKatalog(): Promise<void> {
  /* Der Waechter bricht ab, BEVOR eine Verbindung entsteht, wenn das Ziel
     nicht genau das in `.env.staging` genannte Projekt ist. */
  requireStaging("cat03:drafts:staging");
  const env = readEnvFile(STAGING_ENV_FILE);
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const dienst = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !dienst) {
    throw new Error(`CAT-03 ABBRUCH: ${STAGING_ENV_FILE} unvollstaendig.`);
  }

  console.log("  Lesezugriff    : Dienstschluessel, NUR LESEND — RLS zeigt dem");
  console.log("                   anon-Schluessel keine versteckten Zeilen, und");
  console.log("                   genau die muss dieser Lauf sehen.");

  const ziel = `${url}/rest/v1/skylanders?select=${SPALTEN}&order=sky_id&limit=5000`;
  const antwort = await fetch(ziel, {
    headers: { apikey: dienst, Authorization: `Bearer ${dienst}` },
  });
  if (!antwort.ok) throw new Error(`CAT-03 ABBRUCH: REST ${antwort.status}.`);
  const zeilen = (await antwort.json()) as { catalog_visible?: boolean }[];
  if (!Array.isArray(zeilen) || zeilen.length === 0) {
    throw new Error("CAT-03 ABBRUCH: Katalog kam leer zurueck.");
  }
  const versteckt = zeilen.filter((z) => z.catalog_visible === false).length;
  mkdirSync(AUSGABE, { recursive: true });
  writeFileSync(SNAPSHOT, JSON.stringify(zeilen, null, 1));
  console.log(`  Momentaufnahme : ${zeilen.length} Zeilen, davon ${versteckt} nicht`
            + ` oeffentlich → ${SNAPSHOT}`);

  const katAntwort = await fetch(
    `${url}/rest/v1/categories?select=${KATEGORIESPALTEN}&order=series_code,position`,
    { headers: { apikey: dienst, Authorization: `Bearer ${dienst}` } });
  if (!katAntwort.ok) throw new Error(`CAT-03 ABBRUCH: REST ${katAntwort.status} (Kategorien).`);
  const kategorien = (await katAntwort.json()) as unknown[];
  if (!Array.isArray(kategorien) || kategorien.length === 0) {
    throw new Error("CAT-03 ABBRUCH: Kategorien kamen leer zurueck.");
  }
  writeFileSync(KATEGORIEN, JSON.stringify(kategorien, null, 1));
  console.log(`  Kategorien     : ${kategorien.length} → ${KATEGORIEN}`);
}

const offline = process.argv.includes("--offline");
if (!existsSync(QUELLE)) {
  console.error(`CAT-03 ABBRUCH: Quelldatei fehlt (${QUELLE}).`);
  process.exit(1);
}
if (offline) {
  for (const datei of [SNAPSHOT, KATEGORIEN]) {
    if (!existsSync(datei)) {
      console.error(`CAT-03 ABBRUCH: --offline, aber ${datei} fehlt.`);
      process.exit(1);
    }
  }
  console.log(`  Momentaufnahme : unveraendert benutzt (${SNAPSHOT})`);
} else {
  await holeKatalog();
}
execFileSync("python3", ["tools/lib/cat03-drafts.py", QUELLE], { stdio: "inherit" });
console.log(`  Ergebnis       : ${AUSGABE}/cat-03-entwuerfe.{json,csv} und -bericht.md`);
