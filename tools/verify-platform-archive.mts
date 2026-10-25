/**
 * Ein heruntergeladenes PLATTFORM-Archiv prüfen — rein lokal, rein lesend.
 *
 *   npm run verify:platform-archive -- --file ~/Downloads/skyisles-platform-backup-….zip
 *
 * WOFÜR ES DAS GIBT. Für die Betriebssicherung existiert `verify:backup`; für
 * das Plattformarchiv existierte **nichts**. Es ist unter Supabase Free die
 * einzige Absicherung, die wir selbst in der Hand haben, und bis heute war
 * „sieht gut aus" die Prüfung. Mit `0144` kommt ein Bereich dazu, die
 * Formatversion steigt, und genau dann will niemand von Hand zählen.
 *
 * KEINE DATENBANK, KEIN NETZ, KEIN SCHLÜSSEL. Dieses Werkzeug öffnet genau
 * die Datei, die es bekommt. Es schreibt nichts, auch nicht in die Datei.
 *
 * WAS ES AUSGIBT UND WAS NICHT. Zahlen, Wahrheitswerte, Prüfsummen,
 * Bereichsnamen. **Keine Zeileninhalte** — kein Name, keine Anschrift, keine
 * Kalkulationsbezeichnung. Ein Archiv trägt Käuferadressen, Bestellungen und
 * fremde Sammlungen; ein Prüfbericht, der daraus zitiert, trägt sie in ein
 * Terminal, in eine Logdatei und womöglich in einen Chat. Wo ein Inhalt
 * belegt werden muss, tut es ein kurzer Abdruck oder eine Länge.
 *
 * DIE DATEI DARF NICHT IM ARBEITSVERZEICHNIS LIEGEN. Dieselbe Regel wie bei
 * `verify:backup`, hier mit mehr Grund: dieses Archiv ist das umfassendere.
 *
 * WARUM `unzip` UND KEIN EIGENER LESER. Die Einträge sind `deflate` (Methode
 * 8); ein eigener Leser wäre Entpackungscode für einen einzigen Zweck. `unzip`
 * liegt auf jedem macOS, `unzip -t` prüft außerdem jede CRC-32 des Archivs —
 * das ist die Integritätsprüfung je Eintrag, die das Deckblatt NICHT führt
 * (siehe unten).
 *
 * WAS `manifest.json` WIRKLICH FÜHRT. `files` ist eine **Pfadliste**, nicht
 * eine Liste aus Größe und Prüfsumme je Datei — der Feldkommentar in
 * `platform-manifest.ts` sagt etwas anderes, und das ist dort zu berichtigen.
 * Integrität je Eintrag kommt deshalb aus der ZIP-CRC, Integrität des Ganzen
 * aus dem SHA-256 über die Datei, den `platform_export_runs` festhält.
 *
 * Rückgabewert 1 bei mindestens einer Abweichung, damit ein Durchlauf nicht
 * aus Versehen als bestanden gelesen wird.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import { PLATFORM_ARCHIVE_LAYOUT, PLATFORM_SECTIONS, SECTIONS_BY_FORMAT_VERSION }
  from "../src/lib/backup/platform-manifest.ts";
import { projectRef, readEnvFile, STAGING_ENV_FILE } from "./lib/staging-guard.mts";

/* --------------------------------------------------------------- Aufruf */

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}
const zahlArg = (name: string): number | null => {
  const v = arg(name);
  return v === null ? null : Number(v);
};

const pfad = arg("file");
if (pfad === null) {
  console.error(
    "Aufruf: npm run verify:platform-archive -- --file <pfad zum zip>\n"
    + "        [--project <ref>]           erwartete Projektkennung\n"
    + "                                    (Vorgabe: die aus .env.staging)\n"
    + "        [--calculations <n>]        erwartete Anzahl Kalkulationen\n"
    + "        [--positions <n>]           erwartete Positionen in der ersten\n"
    + "        [--units <n>]               erwartete Stückzahl in der ersten\n"
    + "        [--version <n>]             erwartete Formatversion (Vorgabe 2)");
  process.exit(2);
}

const absolut = resolve(pfad.replace(/^~(?=\/|$)/, process.env.HOME ?? "~"));
const innerhalb = relative(process.cwd(), absolut);
if (!innerhalb.startsWith("..") && !innerhalb.startsWith("/")) {
  console.error(
    "ABBRUCH: die Datei liegt im Arbeitsverzeichnis des Projekts.\n"
    + "Ein Plattformarchiv traegt Kaeuferadressen, Bestellungen und fremde\n"
    + "Sammlungen. Es gehoert auf die eigene Platte, nicht hierher\n"
    + "(docs/SECURITY.md). Verschiebe es heraus und ruf das Werkzeug erneut auf.");
  process.exit(2);
}

/** Die erwartete Projektkennung — aus `.env.staging`, nicht aus einem Literal. */
const ERWARTETES_PROJEKT =
  arg("project") ?? projectRef(readEnvFile(STAGING_ENV_FILE).NEXT_PUBLIC_SUPABASE_URL);
const ERWARTETE_VERSION = zahlArg("version") ?? 2;

/* ---------------------------------------------------------- Berichtsform */

let abweichungen = 0;
function pruef(ok: boolean, name: string, sagt = ""): void {
  if (!ok) abweichungen += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${sagt ? `  — ${sagt}` : ""}`);
}
function info(name: string, sagt: string): void {
  console.log(`  INFO  ${name}  — ${sagt}`);
}
const kopf = (t: string) => console.log(`\n${t}\n${"-".repeat(t.length)}`);

/* ------------------------------------------------------------ Das Archiv */

const bytes = readFileSync(absolut);
const archivHash = createHash("sha256").update(bytes).digest("hex");

/** Eine Datei aus dem Archiv, als Text. */
function eintrag(pfadImArchiv: string): string {
  return execFileSync("unzip", ["-p", absolut, pfadImArchiv],
                      { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
}
/** Alle Einträge mit ihrer unkomprimierten Größe. */
function liste(): { pfad: string; groesse: number }[] {
  const roh = execFileSync("unzip", ["-l", absolut],
                           { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const out: { pfad: string; groesse: number }[] = [];
  for (const zeile of roh.split("\n")) {
    const m = zeile.match(/^\s*(\d+)\s+\S+\s+\S+\s+(.+?)\s*$/);
    if (m && m[2] !== "Name") out.push({ pfad: m[2], groesse: Number(m[1]) });
  }
  return out;
}

console.log(`Plattformarchiv: ${absolut}`);
console.log(`Groesse: ${bytes.length} Bytes · SHA-256: ${archivHash}`);

/* ================================================= 1. Gueltiges Archiv */
kopf("1. Ein gueltiges Archiv, und die vier Dateien");

let eintraege: { pfad: string; groesse: number }[] = [];
try {
  /* `unzip -t` prueft JEDE CRC-32 — die Integritaet je Eintrag. */
  const t = execFileSync("unzip", ["-t", absolut], { encoding: "utf8" });
  pruef(/No errors detected/.test(t), "ZIP ist gueltig, jede CRC-32 stimmt",
        (t.match(/testing:.*\n?/g) ?? []).length + " Eintraege geprueft");
  eintraege = liste();
} catch (fehler) {
  pruef(false, "ZIP ist lesbar", fehler instanceof Error ? fehler.message : String(fehler));
  console.log("\nABBRUCH: ohne lesbares Archiv ist nichts weiter zu pruefen.");
  process.exit(1);
}

const L = PLATFORM_ARCHIVE_LAYOUT;
const pfade = new Set(eintraege.map((e) => e.pfad));
for (const [name, p] of [["manifest.json", L.manifest], ["database.json", L.database],
                         ["auth-users.json", L.authUsers],
                         ["storage-manifest.json", L.storageManifest]] as const) {
  pruef(pfade.has(p), `${name} liegt im Archiv`);
}
const storageEintraege = eintraege.filter((e) => e.pfad.startsWith(L.storagePrefix));
info("Storage-Eintraege", `${storageEintraege.length} Dateien unter ${L.storagePrefix}`);

/* ------------------------------------------------- Die JSON-Dokumente */
type Json = Record<string, unknown>;
const lese = (p: string, name: string): Json | null => {
  try { return JSON.parse(eintrag(p)) as Json; } catch (f) {
    pruef(false, `${name} ist lesbares JSON`,
          f instanceof Error ? f.message : String(f));
    return null;
  }
};
const manifest = lese(L.manifest, "manifest.json");
const datenbank = lese(L.database, "database.json");
const authUsers = lese(L.authUsers, "auth-users.json");
const storage = lese(L.storageManifest, "storage-manifest.json");
if (!manifest || !datenbank || !authUsers || !storage) {
  console.log("\nABBRUCH: eine der vier Dateien ist nicht lesbar.");
  process.exit(1);
}

/* ========================================= 2. Version und Projekt */
kopf("2. Formatversion und Herkunft");

pruef(manifest.format_version === ERWARTETE_VERSION,
      `manifest.json nennt format_version ${ERWARTETE_VERSION}`,
      `gefunden: ${String(manifest.format_version)}`);
pruef(datenbank.format_version === ERWARTETE_VERSION,
      `database.json nennt dieselbe Version`,
      `gefunden: ${String(datenbank.format_version)}`);
pruef(manifest.format_version === datenbank.format_version,
      "Deckblatt und Dokument sind sich einig — kein Ueberclaim");
pruef(manifest.format === "skyisles-platform-backup", "der Formatname stimmt",
      String(manifest.format));

if (ERWARTETES_PROJEKT === null) {
  pruef(false, "erwartete Projektkennung bekannt",
        "weder --project noch .env.staging liefern eine");
} else {
  const ist = String(manifest.source_project);
  pruef(ist === ERWARTETES_PROJEKT, `source_project ist ${ERWARTETES_PROJEKT}`, ist);
  /*
   * DIE FALSCHE-UMGEBUNG-FALLE, die `verify:backup` schon einmal gestellt
   * wurde: ein Archiv aus einem anderen Projekt gegen die Erwartungen dieses
   * Laufs gehalten. Ein abweichender Wert ist hier kein Mangel der Datei,
   * sondern ein Mangel des Vergleichs — und er muss laut sein.
   */
  if (ist !== ERWARTETES_PROJEKT) {
    info("Hinweis", "das Archiv stammt aus einem ANDEREN Projekt als erwartet — "
      + "mit --project pruefen oder die richtige Datei nehmen");
  }
}

/* ============================================== 3. Die Bereiche */
kopf("3. Die Bereiche — Anzahl, Deckung, nichts verloren");

const data = datenbank.data;
const imDokument = data !== null && typeof data === "object"
  ? Object.keys(data as Json).sort() : [];
const sollZahl = SECTIONS_BY_FORMAT_VERSION[ERWARTETE_VERSION];
pruef(imDokument.length === sollZahl,
      `database.json fuehrt ${sollZahl} Bereiche`, `gefunden: ${imDokument.length}`);

const counts = manifest.counts as Json | undefined;
const imDeckblatt = counts ? Object.keys(counts).sort() : [];
pruef(imDeckblatt.length === sollZahl,
      `manifest.json zaehlt ${sollZahl} Bereiche`, `gefunden: ${imDeckblatt.length}`);
pruef(JSON.stringify(imDokument) === JSON.stringify(imDeckblatt),
      "Deckblatt und Dokument nennen DIESELBEN Bereiche");

/*
 * NICHTS VERLOREN. Gegen das Manifest dieser Codebasis, und zwar getrennt:
 * die 53 alten muessen vollstaendig da sein, der neue dazu. So faellt ein
 * verschwundener alter Bereich auf, auch wenn die Gesamtzahl stimmt, weil ein
 * anderer dazugekommen ist.
 */
const NEU = "purchase_calculations";
const alte = PLATFORM_SECTIONS.map((s) => s.key).filter((k) => k !== NEU);
const fehlendeAlte = alte.filter((k) => !imDokument.includes(k));
pruef(fehlendeAlte.length === 0, `alle ${alte.length} bisherigen Bereiche sind da`,
      fehlendeAlte.length ? `fehlen: ${fehlendeAlte.join(", ")}` : "");
pruef(imDokument.includes(NEU), `der neue Bereich ${NEU} ist da`);

const unbekannte = imDokument.filter((k) => !PLATFORM_SECTIONS.some((s) => s.key === k));
pruef(unbekannte.length === 0, "kein Bereich, den das Manifest nicht kennt",
      unbekannte.join(", "));

/* Und die Zahlen des Deckblatts stimmen mit den Zeilen des Dokuments. */
let zaehlerStimmen = true;
const abweichendeZaehler: string[] = [];
for (const name of imDokument) {
  const zeilen = (data as Json)[name];
  const istZahl = Array.isArray(zeilen) ? zeilen.length : 0;
  if ((counts as Json)[name] !== istZahl) {
    zaehlerStimmen = false;
    abweichendeZaehler.push(name);
  }
}
pruef(zaehlerStimmen, "jede Zahl in counts stimmt mit den Zeilen im Dokument",
      abweichendeZaehler.join(", "));

/* ================================ 4. Der neue Bereich, Spalte fuer Spalte */
kopf("4. purchase_calculations");

const abschnitt = PLATFORM_SECTIONS.find((s) => s.source === NEU);
const sollFelder = abschnitt ? [...abschnitt.fields].sort() : [];
const zeilen = Array.isArray((data as Json)[NEU]) ? (data as Json)[NEU] as Json[] : [];

const sollKalk = zahlArg("calculations");
if (sollKalk === null) {
  pruef(zeilen.length >= 1, "mindestens eine Kalkulation ist exportiert",
        `${zeilen.length} Zeile(n) — mit --calculations <n> genau pruefen`);
} else {
  pruef(zeilen.length === sollKalk, `genau ${sollKalk} Kalkulation(en)`,
        `${zeilen.length} gefunden`);
}
pruef(sollFelder.length === 12, "das Manifest fuehrt zwoelf Spalten",
      `${sollFelder.length}`);

let alleSpalten = true;
let linesOk = true;
const fehlerMeldungen: string[] = [];
for (const [i, zeile] of zeilen.entries()) {
  const haben = Object.keys(zeile).sort();
  if (JSON.stringify(haben) !== JSON.stringify(sollFelder)) {
    alleSpalten = false;
    const fehlt = sollFelder.filter((f) => !haben.includes(f));
    const zuviel = haben.filter((f) => !sollFelder.includes(f));
    fehlerMeldungen.push(
      `Zeile ${i}: ${haben.length} Spalten${fehlt.length ? `, fehlt: ${fehlt.join("/")}` : ""}`
      + `${zuviel.length ? `, unerwartet: ${zuviel.join("/")}` : ""}`);
  }
  const lines = zeile.lines;
  const istObjekt = lines !== null && typeof lines === "object" && !Array.isArray(lines);
  const hatArray = istObjekt && Array.isArray((lines as Json).lines);
  if (!istObjekt || !hatArray) {
    linesOk = false;
    fehlerMeldungen.push(`Zeile ${i}: lines ist ${typeof lines}, Array innen: ${hatArray}`);
  }
}
pruef(alleSpalten, "jede Zeile traegt genau die zwoelf Spalten des Manifests",
      fehlerMeldungen.filter((m) => m.includes("Spalten")).join(" · "));
pruef(linesOk, "lines ist ein JSON-OBJEKT mit einem Array darin, keine Zeichenkette",
      fehlerMeldungen.filter((m) => m.includes("lines")).join(" · "));

/*
 * DIE ERSTE ZEILE, OHNE SIE AUSZUPLAUDERN. Positionen, Stueckzahl und ein
 * kurzer Abdruck — kein Name, kein Inhalt. Wer genau pruefen will, gibt die
 * erwarteten Zahlen mit und laesst dieses Werkzeug vergleichen.
 */
if (zeilen.length > 0) {
  const z = zeilen[0];
  const lines = (z.lines ?? {}) as Json;
  const positionen = Array.isArray(lines.lines) ? (lines.lines as unknown[]).length : -1;
  info("erste Kalkulation",
       `Positionen ${positionen} · units ${String(z.units)} · positions ${String(z.positions)}`
       + ` · lines.version ${String(lines.version)} · purchase_id ${String(z.purchase_id)}`
       + ` · user_id gesetzt ${Boolean(z.user_id)}`
       + ` · Abdruck ${createHash("sha256").update(JSON.stringify(z)).digest("hex").slice(0, 12)}`);
  const sollPos = zahlArg("positions");
  if (sollPos !== null) {
    pruef(z.positions === sollPos, `positions ist ${sollPos}`, String(z.positions));
    pruef(positionen === sollPos, `und lines traegt ${sollPos} Eintraege`, String(positionen));
  }
  const sollUnits = zahlArg("units");
  if (sollUnits !== null) {
    pruef(z.units === sollUnits, `units ist ${sollUnits}`, String(z.units));
  }
}

/* ================================== 5. Groessen und Vollstaendigkeit */
kopf("5. Groessen, Pruefsummen, Vollstaendigkeit");

/*
 * `manifest.files` IST EINE PFADLISTE. Keine Groessen, keine Pruefsummen je
 * Datei — der Feldkommentar in `platform-manifest.ts` behauptet mehr, als
 * implementiert ist, und das ist dort zu berichtigen. Geprueft wird deshalb,
 * was wirklich zugesichert wird: dass die Liste und das Archiv sich DECKEN.
 * Integritaet je Eintrag kommt aus der CRC-32 (Abschnitt 1), Integritaet des
 * Ganzen aus dem SHA-256 oben.
 */
const gelistet = Array.isArray(manifest.files) ? (manifest.files as unknown[]).map(String) : [];
pruef(gelistet.length > 0, "manifest.files nennt Dateien", `${gelistet.length}`);
const fehltImArchiv = gelistet.filter((p) => !pfade.has(p));
const fehltImDeckblatt = [...pfade].filter((p) => !gelistet.includes(p));
pruef(fehltImArchiv.length === 0, "jede gelistete Datei liegt wirklich im Archiv",
      fehltImArchiv.slice(0, 5).join(", "));
pruef(fehltImDeckblatt.length === 0, "und jede Datei im Archiv ist gelistet",
      fehltImDeckblatt.slice(0, 5).join(", "));

for (const [name, p] of [["manifest.json", L.manifest], ["database.json", L.database],
                         ["auth-users.json", L.authUsers],
                         ["storage-manifest.json", L.storageManifest]] as const) {
  const e = eintraege.find((x) => x.pfad === p);
  if (e) info(name, `${e.groesse} Bytes`);
}

const sO = Number(storage.storage_object_count ?? -1);
const sM = Number(storage.storage_missing_count ?? -1);
pruef(storageEintraege.length === sO,
      "so viele Storage-Dateien im Archiv wie das Storage-Manifest zaehlt",
      `${storageEintraege.length} im ZIP, ${sO} gezaehlt`);
info("fehlende Storage-Objekte", `${sM} (ein dokumentierter Zustand, kein Fehler)`);
pruef(manifest.storage_object_count === sO && manifest.storage_missing_count === sM,
      "und das Deckblatt nennt dieselben Storage-Zahlen");

/* ============================ 6. Keine behauptete Wiederherstellbarkeit */
kopf("6. Das Archiv behauptet keine Wiederherstellbarkeit");

pruef(manifest.restore_supported === false, "manifest.json: restore_supported ist false",
      String(manifest.restore_supported));
pruef(authUsers.restore_supported === false, "auth-users.json: restore_supported ist false",
      String(authUsers.restore_supported));
const disclaimer = String(authUsers.disclaimer ?? "");
pruef(disclaimer.includes("kein Auth-Backup"),
      "und der Disclaimer sagt ausdruecklich: kein Auth-Backup",
      disclaimer ? `${disclaimer.length} Zeichen` : "fehlt");
pruef(manifest.auth_inventory_only === true, "auth_inventory_only ist true");
pruef(manifest.contains_personal_data === true,
      "contains_personal_data ist true — die Datei sagt, was sie ist");
info("Auth-Konten im Inventar", String(authUsers.auth_user_count));

/* ================================ 7. Was in die Historie gehoert */
kopf("7. Gegen den Historieneintrag vergleichen");

console.log("  Diese drei Werte muss platform_export_runs fuer diesen Lauf zeigen:");
console.log(`    format_version  ${String(manifest.format_version)}`);
console.log(`    section_count   ${imDokument.length}`);
console.log(`    sha256          ${archivHash}`);
console.log("");
console.log("  Lesende Abfrage dafuer:");
console.log("    select format_version, section_count, size_bytes, sha256");
console.log("      from public.platform_export_runs order by id desc limit 1;");
console.log(`    size_bytes muss ${bytes.length} sein.`);

/* ------------------------------------------------------------- Ergebnis */
const gesamt = abweichungen;
console.log("");
console.log(gesamt === 0
  ? "ALLE PRUEFUNGEN BESTANDEN."
  : `${gesamt} ABWEICHUNG(EN) — siehe FAIL-Zeilen oben.`);
console.log("");
console.log("NICHT GEPRUEFT, und das gehoert dazu: ob sich aus diesem Archiv etwas");
console.log("WIEDERHERSTELLEN laesst. Es gibt keine Importfunktion, und die Grenzen");
console.log("stehen in supabase/checks/0144_restore_limits.md.");
process.exit(gesamt === 0 ? 0 : 1);
