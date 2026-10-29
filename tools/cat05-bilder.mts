/**
 * CAT-05 — die 102 zugeordneten Bilder an ihre Figuren haengen. EINMALIG.
 *
 *   npm run cat05:bilder:staging                      PROBELAUF (Standard)
 *   npm run cat05:bilder:staging -- --upload --rechte-geklaert    echter Lauf
 *
 * KEIN IMPORTSYSTEM. Der Excel-Import war eine einmalige Vervollstaendigung;
 * dieses Skript ist ihr Nachtrag und nichts weiter. Die Entscheidung, ob ein
 * Bild an eine Figur darf, trifft `src/lib/catalog/image-import.ts` — dort
 * ist sie pruefbar, hier wird sie nur ausgefuehrt.
 *
 * DER PROBELAUF IST DER STANDARD. Ohne BEIDE Flaggen wird nichts geladen und
 * nichts geschrieben: `--upload` ist die Absicht, `--rechte-geklaert` die
 * Zusage, dass die Nutzungsrechte geklaert sind. Der Bucket `catalog` ist
 * oeffentlich lesbar — ein Upload ist eine Veroeffentlichung.
 *
 * DIE BYTES KOMMEN AUS DER .xlsx, nicht aus dem Pruefverzeichnis. Die
 * Pruefdateien sind zum Ansehen da; die Quelle ist die Checkliste, und ihre
 * Pruefsumme muss zum Manifest passen.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

import {
  darfHochladen, entscheide, fasseZusammen, NIE_AUTOMATISCH,
  type Bildzeile, type Entscheidung, type Figur,
} from "../src/lib/catalog/image-import.ts";
import { readEnvFile, requireStaging, STAGING_ENV_FILE } from "./lib/staging-guard.mts";

const MANIFEST = "resources/analysis/cat-04-bildmanifest.json";
const XLSX = "resources/web/Complete Skylanders Checklist.xlsx";
const PROTOKOLL = "resources/analysis/cat-05-bildprotokoll.json";
const BUCKET = "catalog";

for (const datei of [MANIFEST, XLSX]) {
  if (!existsSync(datei)) {
    console.error(`CAT-05 ABBRUCH: ${datei} fehlt.`);
    process.exit(1);
  }
}

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as { zuordnungen: Bildzeile[] };
const zuordnungen = manifest.zuordnungen;

requireStaging("cat05:bilder:staging");
const env = readEnvFile(STAGING_ENV_FILE);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const dienst = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !dienst) throw new Error(`CAT-05 ABBRUCH: ${STAGING_ENV_FILE} unvollstaendig.`);
const kopf = { apikey: dienst, Authorization: `Bearer ${dienst}` };

/* ------------------------------------------- 1. Die Figuren, wie sie JETZT sind */
const antwort = await fetch(
  `${url}/rest/v1/skylanders?select=sky_id,name,series_code,image_override_path`
  + "&order=sky_id&limit=5000", { headers: kopf });
if (!antwort.ok) throw new Error(`CAT-05 ABBRUCH: REST ${antwort.status}.`);
const figuren = (await antwort.json()) as Figur[];

/* -------------------------------------------- 2. Die Bytes, aus der Checkliste */
/*
 * PYTHON LIEST DAS ZIP, aus demselben Grund wie ueberall in diesem Projekt:
 * eine .xlsx sicher zu oeffnen heisst ZIP plus XML, und beides hat Python in
 * der Standardbibliothek. Ein einziger Aufruf holt alle Medien als base64.
 */
const noetig = [...new Set(zuordnungen.filter((z) => z.zuordnung === "eindeutig")
  .map((z) => z.medium))];
const roh = execFileSync("python3", ["-c", `
import base64, json, sys, zipfile
pfad, namen = sys.argv[1], json.loads(sys.argv[2])
with zipfile.ZipFile(pfad) as z:
    print(json.dumps({n: base64.b64encode(z.read(n)).decode() for n in namen}))
`, XLSX, JSON.stringify(noetig)], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const medien = JSON.parse(roh) as Record<string, string>;

/* ------------------------------------------------------- 3. Die Entscheidungen */
const entscheidungen: { zeile: Bildzeile; e: Entscheidung }[] = [];
for (const z of zuordnungen) {
  const b64 = medien[z.medium];
  const bytes = b64 === undefined ? null : new Uint8Array(Buffer.from(b64, "base64"));
  entscheidungen.push({ zeile: z, e: entscheide(z, figuren, bytes) });
}
const plan = fasseZusammen(entscheidungen.map((x) => x.e));

console.log(`  Manifestzeilen  : ${zuordnungen.length}`);
console.log(`  Figuren gelesen : ${figuren.length}`);
console.log(`  WUERDE LADEN    : ${plan.hochladen}`);
console.log(`  uebersprungen   : mehrdeutig ${plan.uebersprungen.mehrdeutig}`
          + ` · namentlich ausgeschlossen ${plan.uebersprungen.ausgeschlossen}`
          + ` · ohne SKY-ID ${plan.uebersprungen.ohne_sky_id}`
          + ` · hat schon ein Bild ${plan.uebersprungen.hat_schon_ein_bild}`);
console.log(`  Fehler          : Format ${plan.fehler.format_unbekannt}`
          + ` · zu gross ${plan.fehler.zu_gross}`
          + ` · Hash ${plan.fehler.hash_weicht_ab}`
          + ` · keine Bytes ${plan.fehler.keine_bytes}`);
console.log(`  namentlich nie  : ${NIE_AUTOMATISCH.join(" · ")}`);

for (const { zeile, e } of entscheidungen) {
  if (e.art === "fehler") console.log(`  !! ${zeile.entwurf}: ${e.grund} — ${e.text}`);
}

/* ---------------------------------------------------------- 4. Der echte Lauf */
const echt = darfHochladen(process.argv);
const protokoll: Record<string, unknown>[] = [];

if (!echt) {
  for (const { zeile, e } of entscheidungen) {
    protokoll.push({ entwurf: zeile.entwurf, medium: zeile.medium, ...e });
  }
  writeFileSync(PROTOKOLL, JSON.stringify(
    { erzeugt: new Date().toISOString(), modus: "probelauf", plan, protokoll }, null, 1) + "\n");
  console.log("");
  console.log(`  PROBELAUF — nichts geladen, nichts geschrieben. Protokoll: ${PROTOKOLL}`);
  console.log("  Der echte Lauf braucht BEIDE Flaggen: --upload --rechte-geklaert");
  process.exit(plan.fehler.format_unbekannt + plan.fehler.zu_gross
             + plan.fehler.hash_weicht_ab + plan.fehler.keine_bytes > 0 ? 1 : 0);
}

console.log("");
console.log("  *** ECHTER LAUF — es wird geladen und geschrieben ***");
let geladen = 0, gesetzt = 0, gescheitert = 0;
for (const { zeile, e } of entscheidungen) {
  if (e.art !== "hochladen") {
    protokoll.push({ entwurf: zeile.entwurf, medium: zeile.medium, ...e });
    continue;
  }
  const bytes = Buffer.from(medien[zeile.medium], "base64");
  const art = zeile.medium.endsWith(".jpg") || zeile.medium.endsWith(".jpeg")
    ? "image/jpeg" : "image/png";
  /* `upsert: false` — dieselben Bytes liegen schon unter demselben Pfad; ein
     409 ist deshalb kein Fehler, sondern der Beweis der Idempotenz. */
  const up = await fetch(`${url}/storage/v1/object/${BUCKET}/${e.pfad}`, {
    method: "POST", headers: { ...kopf, "Content-Type": art, "x-upsert": "false" },
    body: bytes,
  });
  const schonDa = up.status === 409;
  if (!up.ok && !schonDa) {
    gescheitert += 1;
    protokoll.push({ entwurf: zeile.entwurf, art: "fehler", grund: "upload",
                     text: `HTTP ${up.status}`, skyId: e.skyId });
    console.log(`  !! ${zeile.entwurf}: Upload HTTP ${up.status}`);
    continue;
  }
  if (!schonDa) geladen += 1;

  const patch = await fetch(`${url}/rest/v1/skylanders?sky_id=eq.${e.skyId}`
                          + "&image_override_path=is.null", {
    method: "PATCH",
    headers: { ...kopf, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ image_override_path: e.pfad }),
  });
  const zeilenZurueck = patch.ok ? ((await patch.json()) as unknown[]).length : 0;
  if (!patch.ok || zeilenZurueck !== 1) {
    gescheitert += 1;
    protokoll.push({ entwurf: zeile.entwurf, art: "fehler", grund: "spalte",
                     text: `HTTP ${patch.status}, ${zeilenZurueck} Zeile(n)`, skyId: e.skyId });
    console.log(`  !! ${zeile.entwurf}: Spalte nicht gesetzt (HTTP ${patch.status})`);
    continue;
  }
  gesetzt += 1;
  protokoll.push({ entwurf: zeile.entwurf, art: "erledigt", skyId: e.skyId, pfad: e.pfad,
                   objekt: schonDa ? "lag schon" : "geladen" });
}

writeFileSync(PROTOKOLL, JSON.stringify(
  { erzeugt: new Date().toISOString(), modus: "echt", plan,
    geladen, gesetzt, gescheitert, protokoll }, null, 1) + "\n");
console.log(`  geladen ${geladen} · Spalte gesetzt ${gesetzt} · gescheitert ${gescheitert}`);
console.log(`  Protokoll: ${PROTOKOLL}`);
if (gescheitert > 0) process.exitCode = 1;
