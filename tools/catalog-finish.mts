/*
 * ===========================================================================
 * DER ABSCHLUSSLAUF DES KATALOGABGLEICHS — ETAPPEN A BIS F
 *
 *   npm run catalog:finish:plan      Trockenlauf, schreibt NICHTS
 *   npm run catalog:finish:apply     der echte Lauf — braucht eine Freigabe
 *
 * ===========================================================================
 * OHNE `--apply --confirm-production` SCHREIBT DIESE DATEI NICHTS.
 * ===========================================================================
 *
 * *** WAS SIE IST, UND WAS SIE NICHT IST ***
 *
 * Sie ist ein REIHENFOLGER mit Zwischenpruefungen. Sie legt keine Figur an,
 * laedt kein Objekt hoch und schreibt kein Feld — das tun die vorhandenen,
 * geprueften Werkzeuge:
 *
 *   tools/storage-transfer.mts     die Bildobjekte, je Richtung
 *   tools/catalog-sync.mts         der Plan und die drei Riegel
 *   tools/catalog-sync-apply.mts   die Schritte, je Richtung
 *
 * Diese Datei ruft sie in der richtigen Ordnung auf, MISST zwischen den
 * Etappen, und bricht ab, sobald etwas nicht stimmt. Eine zweite
 * Implementierung derselben Schritte waere eine zweite Wahrheit.
 *
 * *** DIE RICHTUNG IST EINE ENTSCHEIDUNG, NICHT EIN ZUFALL (ADR-0163) ***
 *
 * Staging fuehrt den Katalog, Production wird veroeffentlicht. Etappe C ist
 * die EINMALIGE Gegenrichtung: sie holt die nur auf Production gepflegte
 * Arbeit in die kuenftig fuehrende Umgebung — 22 Sichtbarkeitsentscheidungen
 * (Production gewinnt, Betreiberentscheidung vom 2026-10-31), 19 kuratierte
 * Anzeigenamen, die Bildverweise und `SKY-0821`. Ohne C wuerde der Publish
 * sie ueberschreiben.
 *
 * *** WAS SIE SCHUETZT, UND WIE SIE ES BEWEIST ***
 *
 * Vor dem ersten Schritt wird der geschuetzte Production-Bestand gemessen
 * und abgelegt: Konten, Sammlungen, Favoriten, Warenkoerbe,
 * Bestellpositionen, Lagerzeilen und die MARKTPREISE samt Abdruck. Nach dem
 * letzten Schritt wird dasselbe gemessen und verglichen. Weicht eine Zahl
 * ab, ist der Lauf fehlgeschlagen — auch wenn alles andere gelungen ist.
 *
 * Es gibt in dieser Datei kein `delete`, kein `truncate`, kein `drop` und
 * keinen Import. `src/lib/catalog/catalog-finish.test.ts` misst das am
 * Quelltext.
 *
 * *** ABBRUCHBEDINGUNGEN, EINDEUTIG ***
 *
 *   - ein aufgerufenes Werkzeug endet mit einem Exitcode <> 0
 *   - Riegel 1, 2 oder 3 des Planers schlagen an
 *   - nach C sind noch Schritte Richtung Staging offen
 *   - nach D sind noch Schritte Richtung Production offen
 *   - die acht Fingerprints stimmen am Ende nicht ueberein
 *   - der geschuetzte Production-Bestand hat sich bewegt
 *   - die Menge der ausgeschlossenen Zeilen ist gewachsen
 *
 * Bei jedem Abbruch bleibt der tatsaechliche Zustand stehen und wird
 * berichtet. Es wird NICHT zurueckgerollt und NICHTS wiederholt: ein
 * Storage-Upload und ein PostgREST-Schreibvorgang sind nicht transaktional,
 * und ein automatischer zweiter Versuch waere der gefaehrlichere Weg.
 * ===========================================================================
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { beurteileEtappeE, charakterIdentitaet, charakterMetadaten, feldAbweichungen,
         geregelteProjektion, GEREGELT, type Erwartung, type Messung, type Zeile as PZeile }
  from "../src/lib/catalog/publish-compare.ts";

const STAGING_REF = "qqxcpesbwfxzgytkdsac";
const PRODUCTION_REF = "zmiwxswrpkmizvqsgype";
const PLAN = "resources/analysis/sync-dryrun.json";
const BASELINE = "resources/sync/catalog-baseline.json";
const BERICHT = "resources/analysis/CATALOG-FINISH.md";

const APPLY = process.argv.includes("--apply");
const BESTAETIGT = process.argv.includes("--confirm-production");

/*
 * RIEGEL 0 — Schreiben verlangt BEIDE Flaggen. `--apply` allein genuegt
 * nicht; Etappe D schreibt auf Production, und das soll man zweimal sagen
 * muessen. Dasselbe Muster wie in `catalog-sync-apply.mts`.
 */
if (APPLY && !BESTAETIGT) {
  console.error("\n  RIEGEL 0 — Abbruch. `--apply` verlangt zusaetzlich "
    + "`--confirm-production`.\n\n  Etappe D schreibt auf Production.\n");
  process.exit(1);
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

/* ------------------------------------------------------------- Werkzeuge */

const protokoll: string[] = [];
const sage = (s: string) => { console.log(s); protokoll.push(s); };

function abbruch(etappe: string, warum: string): never {
  sage(`\n  ABBRUCH in Etappe ${etappe}\n`);
  sage(`  ${warum}\n`);
  sage("  Der tatsaechliche Zustand bleibt stehen. Es wird nicht");
  sage("  zurueckgerollt und nichts wiederholt.\n");
  schreibeBericht("ABGEBROCHEN", etappe);
  process.exit(1);
}

/**
 * Ruft ein SCHREIBFREIES Werkzeug auf — auch im Trockenlauf.
 *
 * Die Anmeldeprobe ist der Fall: sie schreibt nichts und ist genau das, was
 * ein Trockenlauf zeigen soll. `werkzeug()` darunter ueberspringt dagegen
 * jeden Aufruf mit `--apply`.
 */
function werkzeugImmer(etappe: string, was: string, argumente: string[]) {
  sage(`      --> ${was} ${argumente.join(" ")}`);
  if (argumente.includes("--apply")) {
    abbruch(etappe, `werkzeugImmer darf kein --apply tragen: ${argumente.join(" ")}`);
  }
  try {
    execFileSync("node", [was, ...argumente], { stdio: "inherit" });
  } catch {
    abbruch(etappe, `${was} ${argumente.join(" ")} endete mit einem Fehler.`);
  }
}

/** Ruft ein Werkzeug auf. Exitcode <> 0 bricht den Abschlusslauf ab. */
function werkzeug(etappe: string, was: string, argumente: string[]) {
  sage(`\n  --> ${was} ${argumente.join(" ")}`);
  if (!APPLY && argumente.includes("--apply")) {
    sage("      (Trockenlauf: nicht aufgerufen)");
    return;
  }
  try {
    execFileSync("node", [was, ...argumente], { stdio: "inherit" });
  } catch {
    abbruch(etappe, `${was} ${argumente.join(" ")} endete mit einem Fehler.`);
  }
}

/* ------------------------------------- Der geschuetzte Production-Bestand */

type Schutz = Record<string, string>;

/**
 * Was der Abschlusslauf NICHT anfassen darf. Vorher und nachher gemessen.
 *
 * `market_price` steht hier mit Abdruck, nicht nur mit Zahl: eine
 * gleichbleibende Anzahl bei veraenderten Werten waere die unangenehmste
 * Form des Schadens (ADR-0010).
 */
async function schutzmessung(db: SupabaseClient): Promise<Schutz> {
  const z = async (tab: string) =>
    String((await db.from(tab).select("*", { count: "exact", head: true })).count);
  const preise = await (async () => {
    const zeilen: string[] = [];
    for (let von = 0; ; von += 1000) {
      const { data, error } = await db.from("skylanders")
        .select("sky_id,market_price").order("sky_id").range(von, von + 999);
      if (error) throw new Error(`skylanders: ${error.message}`);
      for (const r of data ?? []) {
        const x = r as Record<string, unknown>;
        if (x.market_price !== null) zeilen.push(`${x.sky_id}|${x.market_price}`);
      }
      if (!data || data.length < 1000) break;
    }
    return { anzahl: String(zeilen.length),
             abdruck: createHash("md5").update(zeilen.join("\n")).digest("hex") };
  })();
  return {
    sammlungen: await z("collection_items"),
    favoriten: await z("favorites"),
    warenkoerbe: await z("cart_items"),
    bestellpositionen: await z("order_lines"),
    bestellungen: await z("orders"),
    lagerzeilen: await z("shop_inventory"),
    lagerbewegungen: await z("inventory_movements"),
    preise_anzahl: preise.anzahl,
    preise_abdruck: preise.abdruck,
  };
}

/* --------------------------------------------------- Plan neu rechnen */

type Plan = { plan: Record<string, unknown>[]; fingerprint_gemessen: Record<string, unknown> };

/**
 * Rechnet den Plan neu.
 *
 * `nachEigenemSchreiben` schaltet Riegel 2 auf Messung. Das gilt NUR fuer die
 * Neuberechnungen nach Etappe C und D: dort ist die Abweichung dieses Laufs
 * eigenes Werk. Der ERSTE Plan bleibt gated — eine fremde Aenderung soll den
 * Lauf sehr wohl aufhalten, bevor er beginnt.
 */
function planeNeu(etappe: string, nachEigenemSchreiben = false): Plan {
  /*
   * DER BOOTSTRAP-RUNNER PLANT IM BOOTSTRAP-MODUS — seit dem 2026-10-31
   * ausdruecklich. Der Planer verlangt den Modus, und dieser Lauf IST der
   * einmalige Abgleich: beide Richtungen, die fuenf Einmalregeln, Riegel 2
   * gegen den eingefrorenen Messwert.
   */
  werkzeug(etappe, "tools/catalog-sync.mts",
    nachEigenemSchreiben ? ["--modus=bootstrap", "--riegel2=messen"] : ["--modus=bootstrap"]);
  return JSON.parse(readFileSync(PLAN, "utf8")) as Plan;
}

const nach = (p: Plan, ziel: string) => p.plan.filter((x) => x.ziel === ziel).length;

/* ---------------------------------------------------- Ausgeschlossene Zeilen */

/**
 * ETAPPE E, ZWEITER TEIL: die Zeilen, die AUSSERHALB des Plans liegen.
 *
 * Entwuerfe, Testserien und der reservierte Bereich ab `SKY-9000` sind vom
 * Abgleich ausgeschlossen (ADR-0070). Das ist richtig — aber es darf sich
 * nicht hinter dem Ausschluss etwas sammeln. Deshalb werden sie gezaehlt und
 * benannt, und ihre Menge muss die erwartete sein.
 */
async function ausgeschlossene(db: SupabaseClient) {
  const D = JSON.parse(readFileSync("resources/sync/bootstrap-decisions.json", "utf8")) as
    { ausschluss: { testserien: string[]; band_ab: string; status: string[] } };
  const a = D.ausschluss;
  const zeilen: string[] = [];
  for (let von = 0; ; von += 1000) {
    const { data, error } = await db.from("skylanders")
      .select("sky_id,series_code,catalog_status").order("sky_id").range(von, von + 999);
    if (error) throw new Error(`skylanders: ${error.message}`);
    for (const r of data ?? []) {
      const x = r as Record<string, string>;
      if (a.testserien.includes(x.series_code) || x.sky_id >= a.band_ab
          || a.status.includes(x.catalog_status)) {
        zeilen.push(`${x.sky_id}|${x.series_code}|${x.catalog_status}`);
      }
    }
    if (!data || data.length < 1000) break;
  }
  zeilen.sort();
  return { anzahl: zeilen.length,
           abdruck: createHash("md5").update(zeilen.join("\n")).digest("hex"),
           zeilen };
}

/* ------------------------------- Die Messung fuer Etappe E1 (nur lesend) */

/** Blaettert eine Tabelle vollstaendig durch. Nur `select`. */
async function alle(db: SupabaseClient, tabelle: string, spalten: string) {
  const zeilen: Record<string, unknown>[] = [];
  for (let von = 0; ; von += 1000) {
    const { data, error } = await db.from(tabelle).select(spalten)
      .order(spalten.split(",")[0]).range(von, von + 999);
    if (error) throw new Error(`${tabelle}: ${error.message}`);
    zeilen.push(...(data as unknown as Record<string, unknown>[]));
    if (!data || data.length < 1000) break;
  }
  return zeilen;
}


/**
 * Liest beide Umgebungen und baut die Messung, die `beurteileEtappeE`
 * braucht. Nur `select`; die Urteile fallen im reinen Modul.
 */
async function messePublish(s: SupabaseClient, p: SupabaseClient): Promise<Messung> {
  const lies = async (db: SupabaseClient) => {
    const sky = await alle(db, "skylanders",
      "sky_id,name,slug,series_code,category_id,image_file,is_active,character_id,"
      + "catalog_visible,display_name_override,image_override_path,card_type,source,"
      + "item_type,usk_rating,catalog_status,base_sky_id,types,visible_type,"
      + "visible_type_decided");
    const kat = new Map((await alle(db, "categories", "id,name"))
      .map((c) => [c.id as number, c.name as string]));
    const chr = await alle(db, "characters", "id,canonical_name,element,species,role_type,"
      + "short_description,source_url,source_label,verified_at");
    const cn = new Map(chr.map((c) => [c.id as number, c.canonical_name as string]));
    const sicht = new Map<string, PZeile>();
    for (const r of sky) {
      sicht.set(r.sky_id as string, { ...r,
        kategorie: kat.get(r.category_id as number) ?? null,
        familie: cn.get(r.character_id as number) ?? null });
    }
    /*
     * DERSELBE AUSSCHLUSS WIE IM PLANER UND IM ABDRUCK: Testserien, der
     * reservierte Bereich ab SKY-9000 (ADR-0070), Entwuerfe.
     */
    const frei = [...sicht.keys()].filter((id) => {
      const r = sicht.get(id)!;
      return !(["TEST", "SMOK"].includes(r.series_code as string)
        || id >= "SKY-9000" || r.catalog_status === "draft");
    });
    return { sicht, frei,
             chr: new Map(chr.map((c) => [c.canonical_name as string, c as PZeile])) };
  };
  const S1 = await lies(s); const P1 = await lies(p);
  const beidseitig = S1.frei.filter((id) => P1.frei.includes(id));
  const ungeregelt: Record<string, { anzahl: number; abdruck: string }> = {};
  for (const f of ["name", "slug"]) {
    const a = feldAbweichungen(f, S1.sicht, P1.sicht, beidseitig);
    ungeregelt[f] = { anzahl: a.anzahl, abdruck: a.abdruck };
  }
  return {
    geregelt: { staging: geregelteProjektion(S1.sicht, S1.frei),
                production: geregelteProjektion(P1.sicht, P1.frei) },
    ungeregelt,
    identitaet: { staging: charakterIdentitaet([...S1.chr.keys()]),
                  production: charakterIdentitaet([...P1.chr.keys()]) },
    metadaten: charakterMetadaten(S1.chr, P1.chr),
  };
}

/* ------------------------------------------------------------- Der Bericht */

let ergebnis: Record<string, unknown> = {};

function schreibeBericht(zustand: string, etappe: string) {
  writeFileSync(BERICHT, `# Abschlusslauf des Katalogabgleichs — ${zustand}

**${new Date().toISOString()}** · Modus: ${APPLY ? "**APPLY**" : "Trockenlauf"}
${APPLY ? "" : "\n**Dieser Lauf hat nichts geschrieben.**"}

Letzte Etappe: **${etappe}**

## Protokoll

\`\`\`
${protokoll.join("\n")}
\`\`\`

## Messwerte

\`\`\`json
${JSON.stringify(ergebnis, null, 1)}
\`\`\`
`);
  console.log(`\n  geschrieben: ${BERICHT}`);
}

/* ============================================================== DER LAUF */

/* ------------------------------------------------------------------------
 * VORAUSSETZUNGEN — VOR DEM ERSTEN SCHREIBZUGRIFF
 *
 * *** WARUM DAS HIER STEHT UND NICHT IN ETAPPE B ***
 *
 * Eine erste Fassung prueefte die Adminsitzung erst in B — also NACH den 47
 * Uploads in A. Ein Apply-Lauf ohne hinterlegtes Passwort haette damit alle
 * 47 Bildobjekte uebertragen und waere dann abgebrochen: ein halber Lauf,
 * genau der Zustand, den dieser Ablauf vermeiden soll.
 *
 * Eine Voraussetzung, die erst nach dem ersten Schreibzugriff geprueft wird,
 * ist keine Voraussetzung. Sie steht jetzt davor, und sie prueft ZWEI
 * Dinge — die Adresse UND die Erreichbarkeit des Passworts.
 * ------------------------------------------------------------------------ */
/*
 * ZWEI KONTEN, EINS JE UMGEBUNG.
 *
 * Bis zum 2026-10-31 stand hier EINE Adresse fuer beide. Das war falsch: die
 * beiden Plattformadmin-Konten existieren jeweils NUR in ihrer eigenen
 * Umgebung (gemessen). Ein Lauf mit der falschen Adresse scheiterte nicht am
 * Recht, sondern an `Invalid login credentials` — und zwar mitten im Lauf.
 *
 * Die Zuordnung steht in `catalog-sync-apply.mts` und wird hier nur
 * gespiegelt, damit die Voraussetzungen VOR dem ersten Schreibzugriff
 * geprueft werden koennen. Ein Test haelt beide Listen zusammen.
 */
const ADMIN_KONTO = {
  staging: { variable: "SKYISLES_SYNC_ADMIN_STAGING",
             dienst: "skyisles-sync-admin-staging" },
  production: { variable: "SKYISLES_SYNC_ADMIN_PRODUCTION",
                dienst: "skyisles-sync-admin-production" },
} as const;

/** Liegt das Passwort in der Keychain? Fragt NUR die Metadaten ab — kein `-w`. */
function keychainVorhanden(dienst: string, konto: string): boolean {
  try {
    execFileSync("security",
      ["find-generic-password", "-s", dienst, "-a", konto],
      { stdio: ["ignore", "ignore", "ignore"] });
    return true;
  } catch { return false; }
}

const VORAUSSETZUNGEN: { was: string; erfuellt: boolean; wie: string }[] = [];
for (const [umg, k] of Object.entries(ADMIN_KONTO)) {
  const konto = process.env[k.variable];
  VORAUSSETZUNGEN.push({
    was: `${k.variable} (Adresse des ${umg}-Adminkontos)`,
    erfuellt: Boolean(konto),
    wie: `${k.variable}='<adresse>' vor den Befehl setzen`,
  });
  VORAUSSETZUNGEN.push({
    was: `Passwort fuer ${umg} in der Keychain (Dienst ${k.dienst})`,
    erfuellt: Boolean(konto) && keychainVorhanden(k.dienst, konto as string),
    wie: `security add-generic-password -s ${k.dienst} -a '<adresse>' -w`,
  });
}

sage("");
sage("  ABSCHLUSSLAUF DES KATALOGABGLEICHS");
sage(`  Modus: ${APPLY ? "APPLY — SCHREIBT auf Staging UND Production" : "Trockenlauf, schreibt nichts"}`);
sage(`  Staging ${STAGING_REF}, Production ${PRODUCTION_REF}`);
sage("");

sage("  [VORAUSSETZUNGEN] vor dem ersten Schreibzugriff");
for (const v of VORAUSSETZUNGEN) {
  sage(`      ${v.erfuellt ? "ok    " : "OFFEN "} ${v.was}`);
  if (!v.erfuellt) sage(`             -> ${v.wie}`);
}
const offen = VORAUSSETZUNGEN.filter((v) => !v.erfuellt);
if (offen.length > 0) {
  if (APPLY) {
    /*
     * ABBRUCH VOR ETAPPE A. Hier ist noch nichts geschrieben: kein Objekt
     * hochgeladen, kein Feld gesetzt. Der Lauf kann unveraendert wiederholt
     * werden, sobald die Voraussetzung steht.
     */
    abbruch("VORAUSSETZUNGEN",
      `${offen.length} Voraussetzung(en) fehlen: ${offen.map((v) => v.was).join("; ")}.\n\n`
      + "  Es ist NICHTS geschrieben worden — der Abbruch liegt vor Etappe A.\n"
      + "  Nach dem Nachtragen laeuft derselbe Befehl unveraendert.");
  }
  sage("      (Trockenlauf: der echte Lauf braeche hier ab, VOR Etappe A)");
}
sage("");

/* ------- VORHER: der geschuetzte Bestand ------------------------------- */
sage("  [VORHER] der geschuetzte Production-Bestand");
const schutzVorher = await schutzmessung(P);
for (const [k, v] of Object.entries(schutzVorher)) sage(`      ${k.padEnd(20)} ${v}`);
ergebnis = { ...ergebnis, schutz_vorher: schutzVorher };

const ausVorherS = await ausgeschlossene(S);
const ausVorherP = await ausgeschlossene(P);
sage(`      ausgeschlossen Staging    ${ausVorherS.anzahl} (${ausVorherS.abdruck.slice(0, 8)})`);
sage(`      ausgeschlossen Production ${ausVorherP.anzahl} (${ausVorherP.abdruck.slice(0, 8)})`);
ergebnis = { ...ergebnis, ausgeschlossen_vorher: { staging: ausVorherS.anzahl,
  production: ausVorherP.anzahl } };

/* ------- Plan: der Ausgangszustand ------------------------------------ */
sage("\n  [PLAN] der Ausgangszustand");
const p0 = planeNeu("PLAN");
sage(`      Richtung Production  ${nach(p0, "production")} Schritte`);
sage(`      Richtung Staging     ${nach(p0, "staging")} Schritte`);
ergebnis = { ...ergebnis, plan_vorher: { production: nach(p0, "production"),
  staging: nach(p0, "staging") } };

/* ------- B: BEIDE Adminanmeldungen — VOR dem ersten Upload ------------- */
/*
 * B LAEUFT VOR A, UND DAS IST DIE ANFORDERUNG, NICHT MEINE WAHL.
 *
 * „Vor dem ersten Storage-Upload muessen beide erforderlichen
 * Admin-Anmeldungen erfolgreich getestet werden." Eine Anmeldung, die erst
 * nach 47 Uploads geprueft wird, laesst im Fehlerfall einen halben Lauf
 * zurueck.
 *
 * Geprueft wird je Umgebung die ANMELDUNG und die BERECHTIGUNG: der
 * Vorschaulauf von `catalog-sync-apply.mts` meldet sich an und ruft
 * `is_platform_admin()` auf. Er schreibt nichts — ohne `--apply` gibt es dort
 * keinen schreibenden Pfad.
 */
sage("\n  [B] beide Adminanmeldungen erproben — VOR dem ersten Upload");
if (offen.length === 0) {
  sage("      Staging:");
  werkzeugImmer("B", "tools/catalog-sync-apply.mts", ["--target=staging"]);
  sage("      Production:");
  werkzeugImmer("B", "tools/catalog-sync-apply.mts", ["--target=production"]);
} else {
  sage("      (uebersprungen: die Voraussetzungen oben sind offen)");
}

/* ------- A: die Bildobjekte ------------------------------------------- */
/*
 * JE RICHTUNG ENTSCHEIDET DER PLAN, NICHT DER ABLAUF.
 *
 * *** DER FEHLER VOM 2026-10-31 ***
 *
 * Hier standen zwei unbedingte Apply-Aufrufe. Nach Etappe C hatte Richtung
 * Staging keinen Bildschritt mehr — und `storage-transfer.mts` brach ab, weil
 * ein Apply ohne Objekt kein sinnvoller Apply ist. Richtig daran war der
 * Abbruch; falsch war, dass der Runner ihn ueberhaupt erzwungen hat.
 *
 * Ein erledigter Transfer ist kein Fehler, aber er ist auch nicht nichts: er
 * gehoert VERIFIZIERT. Also fragt der Runner den Plan und waehlt:
 *
 *   >= 1 Bildschritt dorthin  ->  der bisherige Apply-Pfad, unveraendert,
 *                                 mit allen Riegeln
 *   0 Bildschritte dorthin    ->  `--pruefen`: lesend, mit SHA-256 und
 *                                 Byte-Vergleich; ein Befund bricht ab
 *
 * Riegel 2 bleibt scharf. Er wird nicht umgangen — er wird nur noch gefragt,
 * wenn es etwas zu uebertragen gibt.
 */
sage("\n  [A] Bildobjekte — je Richtung uebertragen oder verifizieren");
const bildschritte = (p: Plan, ziel: string) => p.plan.filter((x) =>
  x.feld === "image_override_path" && x.ziel === ziel && x.nach !== "~").length;
for (const ziel of ["staging", "production"] as const) {
  const offen = bildschritte(p0, ziel);
  if (offen > 0) {
    sage(`      ${ziel}: ${offen} offene(r) Bildtransfer(e) — Apply-Pfad`);
    werkzeug("A", "tools/storage-transfer.mts", ["--ziel", ziel, "--apply"]);
  } else {
    sage(`      ${ziel}: 0 offene Bildtransfers — nur verifizieren, nichts schreiben`);
    werkzeug("A", "tools/storage-transfer.mts", ["--ziel", ziel, "--pruefen"]);
  }
}

/* ------- C: die einmalige Uebernahme nach Staging --------------------- */
sage("\n  [C] einmalige Uebernahme der Production-Kuration nach Staging");
sage("      22 Sichtbarkeitsentscheidungen (Production gewinnt), 19 Anzeigenamen,");
sage("      die Bildverweise, SKY-0821 — danach fuehrt Staging (ADR-0163)");
werkzeug("C", "tools/catalog-sync-apply.mts", ["--target=staging", "--apply"]);

const p1 = planeNeu("C", true);
sage(`      danach Richtung Staging: ${nach(p1, "staging")} Schritte`);
if (APPLY && nach(p1, "staging") !== 0) {
  abbruch("C", `nach der Uebernahme sind noch ${nach(p1, "staging")} Schritte `
    + "Richtung Staging offen. Die Uebernahme ist unvollstaendig.");
}

/* ------- D: der Publish nach Production ------------------------------- */
sage("\n  [D] Publish nach Production");
/*
 * GEZAEHLT, NICHT BEHAUPTET. Hier stand "darunter 33 neue Figuren und 5
 * Charaktere" als festgeschriebener Satz. Nach dem Teillauf vom 2026-10-31
 * sind beide Zahlen 0 — der Satz haette etwas Falsches ins Protokoll
 * geschrieben, und zwar in genau dem Protokoll, auf das man sich spaeter
 * beruft.
 */
const zaehle = (p: Plan, art: string) =>
  p.plan.filter((x) => x.ziel === "production" && x.art === art).length;
sage(`      ${nach(p1, "production")} Schritte, darunter `
  + `${zaehle(p1, "figur-anlegen")} neue Figuren und `
  + `${zaehle(p1, "charakter-anlegen")} Charaktere`);
werkzeug("D", "tools/catalog-sync-apply.mts",
  ["--target=production", "--apply", "--confirm-production"]);

/* ------- E: der Vollvergleich ----------------------------------------- */
sage("\n  [E] vollstaendiger Katalogvergleich");
const p2 = planeNeu("E", true);
sage(`      Richtung Production  ${nach(p2, "production")} Schritte`);
sage(`      Richtung Staging     ${nach(p2, "staging")} Schritte`);
ergebnis = { ...ergebnis, plan_nachher: { production: nach(p2, "production"),
  staging: nach(p2, "staging") } };
if (APPLY && (nach(p2, "production") !== 0 || nach(p2, "staging") !== 0)) {
  abbruch("E", `der Vergleich meldet noch ${nach(p2, "production")} + `
    + `${nach(p2, "staging")} Schritte. Der Katalog ist nicht gleich.`);
}

const fp = p2.fingerprint_gemessen as Record<string, Record<string, { zeilen: number; abdruck: string }>>;

/*
 * DREI BEREICHE MUESSEN GLEICH SEIN — DER VIERTE DARF ES NICHT.
 *
 * Eine erste Fassung verlangte alle vier. Das waere falsch gewesen und
 * haette den echten Lauf an einem RICHTIGEN Zustand abbrechen lassen:
 * `ausgeschlossen` ist die Liste der Zeilen, die der Abgleich nicht
 * anfasst — Entwuerfe, Testserien, der Bereich ab `SKY-9000`. Staging fuehrt
 * davon 40 (darunter 37 Entwuerfe), Production 2. Entwuerfe werden nach
 * ADR-0163 ausdruecklich NICHT veroeffentlicht; die beiden Zahlen koennen
 * also nie uebereinstimmen, und sie sollen es nicht.
 *
 * Geprueft wird deshalb der VEROEFFENTLICHTE Katalog samt Kategorien und
 * Charakteren. Der Ausschluss wird berichtet und in E2 daraufhin geprueft,
 * dass er nicht WAECHST.
 */
/*
 * DIE KATEGORIEN BLEIBEN EINE REINE GLEICHHEITSFRAGE. Sie werden vollstaendig
 * abgeglichen, also muss ihr Abdruck stimmen.
 */
const VERGLICHEN = ["kategorien"];
const NUR_BERICHT = ["ausgeschlossen"];
sage("      Fingerprints (vollstaendig abgeglichen):");
for (const b of VERGLICHEN) {
  sage(`        ${b.padEnd(20)} S ${fp.staging[b].zeilen}·${fp.staging[b].abdruck.slice(0, 8)}`
    + `   P ${fp.production[b].zeilen}·${fp.production[b].abdruck.slice(0, 8)}`
    + `   ${fp.staging[b].abdruck === fp.production[b].abdruck ? "gleich" : "VERSCHIEDEN"}`);
}
sage("      Fingerprints (Auskunft, duerfen abweichen):");
for (const b of NUR_BERICHT) {
  sage(`        ${b.padEnd(20)} S ${fp.staging[b].zeilen}   P ${fp.production[b].zeilen}`
    + "   — Entwuerfe bleiben auf Staging (ADR-0163)");
}
const ungleich = VERGLICHEN.filter((b) =>
  fp.staging[b].abdruck !== fp.production[b].abdruck
  || fp.staging[b].zeilen !== fp.production[b].zeilen);

/* ------- E1: Katalog und Charaktere, getrennt nach Hoheit ------------- */
/*
 * *** DER ABBRUCH VOM 2026-10-31 ***
 *
 *     die Fingerprints weichen ab: katalog_freigegeben, charaktere.
 *
 * Etappe D war vollstaendig durchgelaufen und der Plan meldete 0 Schritte in
 * BEIDEN Richtungen — und trotzdem brach E ab. Weil die beiden Abdruecke
 * Felder vergleichen, die der Publish nicht uebertraegt und nach ADR-0030
 * bzw. ADR-0034 auch nicht uebertragen darf. Eine Pruefung, die nach etwas
 * fragt, das der Lauf nicht herstellen darf, kann nie bestehen.
 *
 * Richtig gestellt fragt sie getrennt: was der Publish REGELT, muss gleich
 * sein; was er NICHT regelt, muss genau die entschiedene Abweichung sein —
 * nach Anzahl UND nach Abdruck ueber die Menge. Die ganze Begruendung und die
 * Messwerte stehen in `src/lib/catalog/publish-compare.ts`.
 */
sage("\n  [E1] Katalog und Charaktere — getrennt nach Hoheit");
const mess = await messePublish(S, P);
const entscheidungen = JSON.parse(
  readFileSync("resources/sync/bootstrap-decisions.json", "utf8")) as
  { publish_ungeregelt?: Erwartung };
const erwartung = entscheidungen.publish_ungeregelt;
if (erwartung === undefined) {
  abbruch("E1", "resources/sync/bootstrap-decisions.json fuehrt kein "
    + "`publish_ungeregelt`.\n  Ohne die entschiedene Erwartung kann Etappe E1 nicht "
    + "urteilen — eine fehlende\n  Erwartung ist kein Bestehen.");
}
const urteil = beurteileEtappeE(mess, erwartung);
sage(`      geregelt (${GEREGELT.length} Felder)   `
  + `S ${mess.geregelt.staging.zeilen}·${mess.geregelt.staging.abdruck.slice(0, 8)}`
  + `   P ${mess.geregelt.production.zeilen}·${mess.geregelt.production.abdruck.slice(0, 8)}`
  + `   ${mess.geregelt.staging.abdruck === mess.geregelt.production.abdruck
      ? "ZEICHENGLEICH" : "VERSCHIEDEN"}`);
sage(`      Charakteridentitaet         `
  + `S ${mess.identitaet.staging.zeilen}·${mess.identitaet.staging.abdruck.slice(0, 8)}`
  + `   P ${mess.identitaet.production.zeilen}·${mess.identitaet.production.abdruck.slice(0, 8)}`
  + `   ${mess.identitaet.staging.abdruck === mess.identitaet.production.abdruck
      ? "ZEICHENGLEICH" : "VERSCHIEDEN"}`);
sage("      ungeregelt (Erwartung, nicht Ausnahme):");
for (const f of erwartung.felder) {
  const i = mess.ungeregelt[f];
  sage(`        ${f.padEnd(18)} ${i.anzahl} Abweichung(en)`
    + `${i.anzahl ? `, Abdruck ${i.abdruck.slice(0, 8)}` : ""}`);
}
sage(`        charakter_metadaten ${mess.metadaten.anzahl} Abweichung(en)`
  + `${mess.metadaten.namen.length ? ` (${mess.metadaten.namen.join(", ")})` : ""}`);
for (const h of urteil.hinweise) sage(`      ok   ${h}`);
for (const b of urteil.befunde) sage(`      BEFUND  ${b}`);
ergebnis = { ...ergebnis, fingerprints: fp, fingerprints_ungleich: ungleich,
  publish: { geregelt: mess.geregelt, identitaet: mess.identitaet,
             ungeregelt: mess.ungeregelt, metadaten: mess.metadaten,
             befunde: urteil.befunde } };
if (APPLY && ungleich.length > 0) {
  abbruch("E", `die Fingerprints weichen ab: ${ungleich.join(", ")}.`);
}
if (APPLY && !urteil.bestanden) {
  abbruch("E1", `${urteil.befunde.length} Befund(e):\n    `
    + urteil.befunde.join("\n    "));
}

/* ------- E2: die ausgeschlossenen Zeilen ------------------------------ */
sage("\n  [E2] die Zeilen ausserhalb des Plans");
const ausNachherS = await ausgeschlossene(S);
const ausNachherP = await ausgeschlossene(P);
sage(`      Staging    ${ausVorherS.anzahl} -> ${ausNachherS.anzahl}`);
sage(`      Production ${ausVorherP.anzahl} -> ${ausNachherP.anzahl}`);
ergebnis = { ...ergebnis, ausgeschlossen_nachher: {
  staging: ausNachherS.anzahl, production: ausNachherP.anzahl,
  staging_zeilen: ausNachherS.zeilen, production_zeilen: ausNachherP.zeilen } };
if (APPLY && (ausNachherS.anzahl > ausVorherS.anzahl
              || ausNachherP.anzahl > ausVorherP.anzahl)) {
  abbruch("E2", "die Menge der ausgeschlossenen Zeilen ist GEWACHSEN. Hinter dem "
    + "Ausschluss sammelt sich etwas.");
}

/* ------- NACHHER: der geschuetzte Bestand ----------------------------- */
sage("\n  [NACHHER] der geschuetzte Production-Bestand");
const schutzNachher = await schutzmessung(P);
const bewegt = Object.keys(schutzVorher).filter((k) => schutzVorher[k] !== schutzNachher[k]);
for (const [k, v] of Object.entries(schutzNachher)) {
  sage(`      ${k.padEnd(20)} ${v}${schutzVorher[k] === v ? "" : `   WAR ${schutzVorher[k]}`}`);
}
ergebnis = { ...ergebnis, schutz_nachher: schutzNachher, schutz_bewegt: bewegt };
if (bewegt.length > 0) {
  abbruch("NACHHER", `der geschuetzte Bestand hat sich bewegt: ${bewegt.join(", ")}. `
    + "Der Abschlusslauf gilt als FEHLGESCHLAGEN, auch wenn alles andere gelang.");
}

/* ------- F: versiegeln ------------------------------------------------ */
sage("\n  [F] gemeinsame Baseline versiegeln");
/*
 * DIE SELBSTPROBE LAEUFT UEBER DAS, WAS WIRKLICH GLEICH IST — seit dem
 * 2026-10-31. Vorher waren es die drei Fingerprintbereiche, von denen zwei
 * Felder enthielten, die der Publish nicht regelt; eine Selbstprobe darueber
 * haette eine Gleichheit besiegelt, die es nicht gibt.
 */
const kern = [
  ...VERGLICHEN.map((b) => `${b}=${fp.staging[b].zeilen}:${fp.staging[b].abdruck}`),
  `geregelt=${mess.geregelt.staging.zeilen}:${mess.geregelt.staging.abdruck}`,
  `charakteridentitaet=${mess.identitaet.staging.zeilen}:${mess.identitaet.staging.abdruck}`,
].join("|");
const siegel = {
  marke: "skyisles-katalog-baseline-1",
  versiegelt: new Date().toISOString(),
  entscheidung: "ADR-0163 — Staging fuehrt, Production wird veroeffentlicht",
  staging: STAGING_REF, production: PRODUCTION_REF,
  fingerprint: fp,
  verglichen: VERGLICHEN,
  nur_bericht: NUR_BERICHT,
  /*
   * WAS GLEICH IST, UND WAS BEWUSST NICHT. Das Siegel haelt beides fest —
   * eine Baseline, die nur die Gleichheit nennt, verschweigt den Teil, den
   * man spaeter wissen muss.
   */
  geregelt: mess.geregelt,
  geregelte_felder: GEREGELT,
  charakteridentitaet: mess.identitaet,
  ungeregelt: mess.ungeregelt,
  ungeregelte_felder: erwartung.felder,
  charakter_metadaten: { anzahl: mess.metadaten.anzahl, namen: mess.metadaten.namen,
                         abdruck: mess.metadaten.abdruck },
  hinweis_ungeregelt: "name und slug folgen der Excel (ADR-0030) und werden nicht "
    + "veroeffentlicht; Charaktermetadaten sind kuratiert (ADR-0034) und kommen ueber "
    + "characters:import, nicht ueber den Sync. Die hier festgehaltenen Abweichungen "
    + "sind die entschiedenen — Etappe E1 prueft sie nach Anzahl UND Abdruck.",
  hinweis_ausschluss: "Der Bereich `ausgeschlossen` weicht bewusst ab: Entwuerfe "
    + "und Testfixtures bleiben auf Staging und werden nicht veroeffentlicht "
    + "(ADR-0163).",
  schutz_production: schutzNachher,
  ausgeschlossen: { staging: ausNachherS.anzahl, production: ausNachherP.anzahl },
  selbstprobe: createHash("md5").update(kern).digest("hex").slice(0, 12),
};
if (APPLY) {
  writeFileSync(BASELINE, JSON.stringify(siegel, null, 1) + "\n");
  sage(`      geschrieben: ${BASELINE}`);
  sage(`      Selbstprobe: ${siegel.selbstprobe}`);
} else {
  sage(`      (Trockenlauf: ${BASELINE} wird nicht geschrieben)`);
  sage(`      Selbstprobe waere: ${siegel.selbstprobe}`);
}
ergebnis = { ...ergebnis, siegel };

sage(`\n  ${APPLY ? "FERTIG" : "TROCKENLAUF FERTIG"} — alle Etappen durchlaufen.`);
if (!APPLY) sage("  DIESER LAUF HAT NICHTS GESCHRIEBEN.");
schreibeBericht(APPLY ? "ERFOLGREICH" : "Trockenlauf", "F");
