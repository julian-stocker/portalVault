/*
 * ===========================================================================
 * DER REGULAERE KATALOG-PUBLISH — STAGING -> PRODUCTION, EINSEITIG
 *
 *   npm run catalog:publish:plan     Vorschau, schreibt nichts
 *   npm run catalog:publish          veroeffentlicht, nach ausdruecklicher Freigabe
 *   npm run catalog:publish:plan     danach: muss 0 melden
 *
 * ===========================================================================
 * DIESES WERKZEUG REIHT, ES IMPLEMENTIERT NICHT NACH
 * ===========================================================================
 *
 * Es ruft die vorhandenen Werkzeuge in der einen richtigen Reihenfolge auf
 * und prueft dazwischen. Jede Regel steht dort, wo sie hingehoert:
 *
 *   tools/catalog-sync.mts        der Plan, Riegel 1-4 (Driftriegel, Einwegrichtung)
 *   tools/storage-transfer.mts    Bildobjekte, verifizieren oder uebertragen
 *   tools/catalog-sync-apply.mts  das Schreiben, TOR 0-4
 *
 * ===========================================================================
 * DIE REIHENFOLGE IST DIE ANFORDERUNG, NICHT MEINE WAHL
 * ===========================================================================
 *
 *   1  Plan rechnen (Publish-Modus: kein Schritt nach Staging)
 *   2  die benoetigten Bildobjekte bestimmen
 *   3  vorhandene auf SHA-256 und Bytegleichheit pruefen
 *   4  fehlende uebertragen — `upsert: false`, nie ueberschreiben
 *   5  erneut verifizieren
 *   6  ERST DANACH die Katalogaenderungen anwenden
 *
 * Ein Bildverweis, der vor seinem Objekt geschrieben wird, zeigt oeffentlich
 * ins Leere: `skylanders` ist weltlesbar. Deshalb diese Folge — und deshalb
 * prueft der Apply-Pfad es in TOR 4 noch einmal selbst, denn ein Riegel, der
 * nur hier steht, ist umgehbar.
 *
 * ===========================================================================
 * BEI EINEM FEHLER WIRD ABGEBROCHEN
 * ===========================================================================
 *
 * Kein Rollback, keine Wiederholung. Der tatsaechliche Zustand bleibt
 * stehen, und der naechste Lauf rechnet den Plan aus der Datenbank neu — der
 * Driftriegel nennt die bereits geschriebenen Felder `publiziert` und laesst
 * sie durch. Genau dafuer ist er so gebaut.
 *
 * Nach einem erfolgreichen Lauf wird `resources/sync/publish-ledger.json`
 * neu geschrieben. Das ist der NACHWEIS des veroeffentlichten Stands, Zeile
 * fuer Zeile — der Git-Diff zeigt, was dieser Publish getan hat. Das Siegel
 * des einmaligen Abgleichs (`catalog-baseline.json`) wird dabei NICHT
 * angefasst.
 * ===========================================================================
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

import { GEREGELT, t, type Zeile } from "../src/lib/catalog/publish-compare.ts";
import { LEDGER_MARKE, pruefeLedger, standAbdruck,
         type Ledger, type Stand } from "../src/lib/catalog/publish-drift.ts";

const STAGING_REF = "qqxcpesbwfxzgytkdsac";
const PRODUCTION_REF = "zmiwxswrpkmizvqsgype";
const PLAN = "resources/analysis/sync-dryrun.json";
const LEDGER = "resources/sync/publish-ledger.json";
const BERICHT = "resources/analysis/CATALOG-PUBLISH.md";

const APPLY = process.argv.includes("--apply");

/*
 * RIEGEL 0 — EIN SCHREIBENDER LAUF BRAUCHT DIE AUSDRUECKLICHE FREIGABE.
 * Dieselbe Bedingung wie im Apply-Pfad, und sie steht hier VOR allem
 * anderen: ein halber Lauf soll nicht daran scheitern, dass die Freigabe
 * fehlt.
 */
if (APPLY && !process.argv.includes("--confirm-production")) {
  console.error("\n  RIEGEL 0 — Abbruch. `--apply` verlangt `--confirm-production`.\n\n"
    + "  Dieser Lauf schreibt in die Production-Datenbank. Die Freigabe steht\n"
    + "  im Befehl, nicht in einer Voreinstellung.\n");
  process.exit(1);
}

const protokoll: string[] = [];
function sage(zeile: string): void { console.log(zeile); protokoll.push(zeile); }

function schreibeBericht(zustand: string, stufe: string, extra: Record<string, unknown>): void {
  writeFileSync(BERICHT, `# Katalog-Publish — ${zustand}

**${new Date().toISOString()}** · Modus: ${APPLY ? "**APPLY**" : "Vorschau"}
${APPLY ? "" : "\n**Dieser Lauf hat nichts geschrieben.**"}

Letzte Stufe: **${stufe}**

## Protokoll

\`\`\`
${protokoll.join("\n")}
\`\`\`

## Messwerte

\`\`\`json
${JSON.stringify(extra, null, 1)}
\`\`\`
`);
  console.log(`\n  geschrieben: ${BERICHT}`);
}

function abbruch(stufe: string, warum: string, extra: Record<string, unknown> = {}): never {
  sage(`\n  ABBRUCH in Stufe ${stufe}\n`);
  sage(`  ${warum}`);
  sage("\n  Der tatsaechliche Zustand bleibt stehen. Es wird nicht zurueckgerollt\n"
    + "  und nichts wiederholt. Der naechste Lauf rechnet den Plan neu.");
  schreibeBericht("ABGEBROCHEN", stufe, extra);
  process.exit(1);
}

/** Ruft ein Werkzeug auf. Ein Fehlercode bricht den Publish ab. */
function werkzeug(stufe: string, was: string, argumente: string[]): void {
  sage(`\n  --> ${was} ${argumente.join(" ")}`);
  if (!APPLY && argumente.includes("--apply")) {
    sage("      (Vorschau: nicht aufgerufen)");
    return;
  }
  try {
    execFileSync("node", [was, ...argumente], { stdio: "inherit" });
  } catch {
    abbruch(stufe, `${was} ${argumente.join(" ")} endete mit einem Fehler.`);
  }
}

/* ------------------------------------------------------------- Verbindung */

function envDatei(pfad: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const z of readFileSync(pfad, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(z.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}
function verbinde(pfad: string, kennung: string, name: string): SupabaseClient {
  const e = envDatei(pfad);
  const url = e.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes(kennung)) {
    console.error(`\n  RIEGEL 1 — Abbruch. ${pfad} nennt nicht ${kennung} (${name}).\n`);
    process.exit(1);
  }
  return createClient(url, e.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
const S = verbinde(".env.staging", STAGING_REF, "Staging");
const P = verbinde(".env.local", PRODUCTION_REF, "Production");

async function alle(db: SupabaseClient, tab: string, sp: string) {
  const z: Zeile[] = [];
  for (let von = 0; ; von += 1000) {
    const { data, error } = await db.from(tab).select(sp)
      .order(sp.split(",")[0]).range(von, von + 999);
    if (error) throw new Error(`${tab}: ${error.message}`);
    z.push(...(data as unknown as Zeile[]));
    if (!data || data.length < 1000) break;
  }
  return z;
}

/** Die geregelte Projektion der freigegebenen Zeilen — nur `select`. */
async function geregelterStand(db: SupabaseClient): Promise<Stand> {
  const sky = await alle(db, "skylanders",
    "sky_id,name,slug,series_code,category_id,image_file,is_active,character_id,"
    + "catalog_visible,display_name_override,image_override_path,card_type,source,"
    + "item_type,usk_rating,catalog_status,base_sky_id,types,visible_type,"
    + "visible_type_decided");
  const kat = new Map((await alle(db, "categories", "id,name"))
    .map((c) => [c.id as number, c.name as string]));
  const chr = new Map((await alle(db, "characters", "id,canonical_name"))
    .map((c) => [c.id as number, c.canonical_name as string]));
  const out: Record<string, string> = {};
  for (const r of sky) {
    const id = r.sky_id as string;
    if (["TEST", "SMOK"].includes(r.series_code as string) || id >= "SKY-9000"
        || r.catalog_status === "draft") continue;
    const v: Zeile = { ...r, kategorie: kat.get(r.category_id as number) ?? null,
                       familie: chr.get(r.character_id as number) ?? null };
    out[id] = GEREGELT.map((f) => t(v[f])).join("|");
  }
  return out;
}

/**
 * Die geschuetzten Production-Zahlen, vorher und nachher. Der Publish fasst
 * nichts davon an; eine Veraenderung ist ein Befund, kein Nebeneffekt.
 */
async function schutzmessung(db: SupabaseClient): Promise<Record<string, string>> {
  const z = async (tab: string) => {
    const r = await db.from(tab).select("*", { count: "exact", head: true });
    if (r.error) throw new Error(`${tab}: ${r.error.message}`);
    return String(r.count);
  };
  const preise: string[] = [];
  for (const r of await alle(db, "skylanders", "sky_id,market_price")) {
    if (r.market_price !== null) preise.push(`${r.sky_id}|${r.market_price}`);
  }
  const { createHash } = await import("node:crypto");
  return {
    sammlungen: await z("collection_items"), favoriten: await z("favorites"),
    warenkoerbe: await z("cart_items"), bestellpositionen: await z("order_lines"),
    bestellungen: await z("orders"), lagerzeilen: await z("shop_inventory"),
    lagerbewegungen: await z("inventory_movements"),
    preise_anzahl: String(preise.length),
    preise_abdruck: createHash("md5").update(preise.join("\n")).digest("hex"),
  };
}

type Plan = { modus?: string; plan: Record<string, unknown>[] };
const liesPlan = (): Plan => JSON.parse(readFileSync(PLAN, "utf8")) as Plan;
const nach = (p: Plan, ziel: string) => p.plan.filter((x) => x.ziel === ziel).length;
const bildschritte = (p: Plan) => p.plan.filter((x) =>
  x.feld === "image_override_path" && x.ziel === "production" && x.nach !== "~").length;

/* ============================================================== DER LAUF */

sage("");
sage("  KATALOG-PUBLISH — STAGING -> PRODUCTION");
sage(`  Modus: ${APPLY ? "APPLY — SCHREIBT auf Production" : "Vorschau, schreibt nichts"}`);
sage(`  Staging ${STAGING_REF} (fuehrt), Production ${PRODUCTION_REF} (Ziel)`);
sage("");

/* ---- Der veroeffentlichte Stand, als Ausgangspunkt ---- */
const ledgerRoh = JSON.parse(readFileSync(LEDGER, "utf8")) as Ledger;
const schluessig = pruefeLedger(ledgerRoh);
if (!schluessig.ok) {
  sage(`  [STAND] ${LEDGER} ist nicht schluessig:`);
  for (const b of schluessig.befunde) sage(`      ${b}`);
  abbruch("STAND", "Ohne einen schluessigen Publish-Stand gibt es keinen Vergleich.");
}
sage(`  [STAND] ${LEDGER}`);
sage(`      veroeffentlicht am ${ledgerRoh.veroeffentlicht_am}`);
sage(`      ${ledgerRoh.zeilen} Zeilen, Abdruck ${ledgerRoh.abdruck}`);

/* ---- Die geschuetzten Zahlen, vorher ---- */
sage("\n  [VORHER] der geschuetzte Production-Bestand");
const schutzVorher = await schutzmessung(P);
for (const [k, v] of Object.entries(schutzVorher)) sage(`      ${k.padEnd(20)} ${v}`);

/* ---- 1. Der Plan ---- */
sage("\n  [1] Plan rechnen — Publish-Modus, Riegel 1 bis 4");
werkzeug("1", "tools/catalog-sync.mts", ["--modus=publish"]);
const p0 = liesPlan();
if (p0.modus !== "publish") {
  abbruch("1", `der Plan nennt den Modus "${p0.modus ?? "(keinen)"}" und nicht "publish". `
    + "Ein Bootstrap-Plan darf hier nicht angewendet werden.");
}
sage(`      Richtung Production  ${nach(p0, "production")} Schritte`);
sage(`      Richtung Staging     ${nach(p0, "staging")} Schritte`);
if (nach(p0, "staging") !== 0) {
  abbruch("1", `der Plan fuehrt ${nach(p0, "staging")} Schritt(e) nach Staging. `
    + "Im Dauerbetrieb ist Production nur Ziel (ADR-0163).");
}

/* ---- Kein Schritt? Dann ist der Lauf fertig, und das ist ein Erfolg. ---- */
if (nach(p0, "production") === 0) {
  sage("\n  [FERTIG] 0 offene Schritte — es gibt nichts zu veroeffentlichen.");
  sage("      Der Publish-Stand bleibt unveraendert. Kein Schreibvorgang, kein Befund.");
  schreibeBericht(APPLY ? "NICHTS ZU TUN" : "Vorschau — nichts zu tun", "FERTIG",
    { schutz_vorher: schutzVorher, plan: { production: 0, staging: 0 },
      ledger: { zeilen: ledgerRoh.zeilen, abdruck: ledgerRoh.abdruck } });
  process.exit(0);
}

/* ---- 2.-5. Die Bildobjekte ---- */
sage("\n  [2-5] Bildobjekte — bestimmen, pruefen, fehlende uebertragen, erneut pruefen");
const bilder = bildschritte(p0);
sage(`      der Plan nennt ${bilder} neue(n) Bildverweis(e)`);
if (bilder === 0) {
  sage("      nichts zu uebertragen — die Verifikation laeuft trotzdem");
  werkzeug("2-5", "tools/storage-transfer.mts", ["--ziel", "production", "--pruefen"]);
} else {
  /*
   * ERST UEBERTRAGEN, DANN ERNEUT PRUEFEN. Der Transferpfad ueberspringt
   * vorhandene Pfade (`upsert: false`) und verifiziert jedes Objekt dreifach;
   * der Pruefmodus danach ist die unabhaengige Nachkontrolle, und er faellt
   * ueber ein Objekt, das der Transfer nicht hinbekommen hat.
   */
  werkzeug("2-5", "tools/storage-transfer.mts", ["--ziel", "production", "--apply"]);
  werkzeug("2-5", "tools/storage-transfer.mts", ["--ziel", "production", "--pruefen"]);
}

/* ---- 6. Die Katalogaenderungen ---- */
sage("\n  [6] Katalogaenderungen anwenden — TOR 0 bis 4, Compare-and-Set");
werkzeug("6", "tools/catalog-sync-apply.mts",
  ["--target=production", "--apply", "--confirm-production"]);

/* ---- Nachkontrolle: der Plan muss auf 0 stehen ---- */
sage("\n  [NACHHER] Plan neu rechnen");
werkzeug("NACHHER", "tools/catalog-sync.mts", ["--modus=publish"]);
const p1 = liesPlan();
sage(`      Richtung Production  ${nach(p1, "production")} Schritte`);
sage(`      Richtung Staging     ${nach(p1, "staging")} Schritte`);

const schutzNachher = await schutzmessung(P);
const bewegt = Object.keys(schutzVorher).filter((k) => schutzVorher[k] !== schutzNachher[k]);
sage("\n  [SCHUTZ] der geschuetzte Production-Bestand, nachher");
for (const [k, v] of Object.entries(schutzNachher)) {
  sage(`      ${k.padEnd(20)} ${v}${schutzVorher[k] === v ? "" : `   WAR ${schutzVorher[k]}`}`);
}
if (APPLY && bewegt.length > 0) {
  abbruch("SCHUTZ", `${bewegt.length} geschuetzte(r) Wert(e) hat sich bewegt: `
    + `${bewegt.join(", ")}. Der Publish fasst davon nichts an.`,
    { schutz_vorher: schutzVorher, schutz_nachher: schutzNachher });
}

const standS = await geregelterStand(S);
const standP = await geregelterStand(P);
const aS = standAbdruck(standS); const aP = standAbdruck(standP);
sage("\n  [GLEICHSTAND] die geregelte Projektion");
sage(`      Staging    ${aS.zeilen}·${aS.abdruck}`);
sage(`      Production ${aP.zeilen}·${aP.abdruck}`);
sage(`      ${aS.abdruck === aP.abdruck ? "ZEICHENGLEICH" : "VERSCHIEDEN"}`);

if (APPLY && (nach(p1, "production") !== 0 || nach(p1, "staging") !== 0)) {
  abbruch("NACHHER", `der neu gerechnete Plan meldet noch `
    + `${nach(p1, "production")} + ${nach(p1, "staging")} Schritt(e).`,
    { plan_nachher: { production: nach(p1, "production"), staging: nach(p1, "staging") } });
}
if (APPLY && aS.abdruck !== aP.abdruck) {
  abbruch("GLEICHSTAND", "die geregelte Projektion weicht ab, obwohl der Plan auf 0 "
    + "steht. Das waere ein Widerspruch zwischen Plan und Abdruck — nicht "
    + "weiterschreiben.", { staging: aS, production: aP });
}

/* ---- Der neue Publish-Stand ---- */
sage("\n  [STAND NEU] den veroeffentlichten Stand fortschreiben");
const neu: Ledger = {
  marke: LEDGER_MARKE, veroeffentlicht_am: new Date().toISOString(),
  staging: STAGING_REF, production: PRODUCTION_REF,
  geregelte_felder: GEREGELT, zeilen: aP.zeilen, abdruck: aP.abdruck, stand: standP,
};
const probe = pruefeLedger(neu);
if (!probe.ok) {
  abbruch("STAND NEU", `der neue Stand ist nicht schluessig: ${probe.befunde.join("; ")}`);
}
if (APPLY) {
  writeFileSync(LEDGER, JSON.stringify({
    _zweck: (JSON.parse(readFileSync(LEDGER, "utf8")) as Record<string, unknown>)._zweck,
    _abgrenzung: (JSON.parse(readFileSync(LEDGER, "utf8")) as Record<string, unknown>)._abgrenzung,
    ...neu,
  }, null, 1) + "\n");
  sage(`      geschrieben: ${LEDGER}  (${aP.zeilen} Zeilen, Abdruck ${aP.abdruck})`);
  sage(`      vorher war: ${ledgerRoh.zeilen} Zeilen, Abdruck ${ledgerRoh.abdruck}`);
  sage("      Das Siegel resources/sync/catalog-baseline.json bleibt unangetastet.");
} else {
  sage(`      (Vorschau: ${LEDGER} wird nicht geschrieben)`);
  sage(`      er wuerde lauten: ${aP.zeilen} Zeilen, Abdruck ${aP.abdruck}`);
}

sage(`\n  ${APPLY ? "FERTIG" : "VORSCHAU FERTIG"} — alle Stufen durchlaufen.`);
if (!APPLY) sage("  DIESER LAUF HAT NICHTS GESCHRIEBEN.");
schreibeBericht(APPLY ? "ERFOLGREICH" : "Vorschau", "STAND NEU", {
  schutz_vorher: schutzVorher, schutz_nachher: schutzNachher,
  plan_vorher: { production: nach(p0, "production"), staging: nach(p0, "staging") },
  plan_nachher: { production: nach(p1, "production"), staging: nach(p1, "staging") },
  bildschritte: bilder,
  ledger_vorher: { zeilen: ledgerRoh.zeilen, abdruck: ledgerRoh.abdruck },
  ledger_nachher: { zeilen: aP.zeilen, abdruck: aP.abdruck },
});
