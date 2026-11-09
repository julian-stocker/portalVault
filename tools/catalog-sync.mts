/**
 * DER KATALOGABGLEICH — DRY-RUN.
 *
 *   npm run catalog:sync:plan
 *
 * ===========================================================================
 * DIESES WERKZEUG SCHREIBT NICHT. UEBERHAUPT NICHT.
 * ===========================================================================
 *
 * Es gibt hier keinen schreibenden Pfad: kein `insert`, kein `update`, kein
 * `delete`, kein `upsert`, kein `rpc`, kein `storage.upload`, kein
 * `storage.remove`. Es liest beide Umgebungen und schreibt zwei LOKALE
 * Dateien. `src/lib/catalog/sync-plan.test.ts` nagelt das am Quelltext fest —
 * eine Zusage im Kommentar ist keine Zusage.
 *
 * WAS ES LIEFERT
 *
 *   resources/analysis/sync-dryrun.json   der vollstaendige Plan, maschinenlesbar
 *   resources/analysis/SYNC-DRYRUN.md     derselbe Plan, nach Umgebung getrennt
 *
 * DIE DREI RIEGEL, BEVOR IRGENDETWAS GERECHNET WIRD
 *
 *   1. Projektkennung. Jede Verbindung muss das Projekt sein, das die
 *      jeweilige `.env`-Datei nennt — sonst Abbruch, bevor gelesen wird.
 *   2. Fingerprint. Beide Umgebungen muessen heute die Werte zeigen, die der
 *      Betreiber am 2026-10-30 im SQL-Editor gemessen hat
 *      (`resources/sync/bootstrap-decisions.json`). Weicht einer ab, hat sich
 *      etwas bewegt, und der Plan waere veraltet.
 *   3. Identitaetskonflikt. Eine SKY-ID, die in beiden Umgebungen steht und
 *      dort einen anderen `slug` ODER eine andere `series_code` traegt, haelt
 *      den Lauf an — solange keine Entscheidung zu ihr vorliegt. Der Riegel
 *      selbst steht in `src/lib/catalog/sync-collision-gate.ts`, rein und
 *      ohne Datenbank, und ist dort einzeln geprueft. Ein abweichender NAME
 *      ist kein Konflikt (ADR-0030), ein abweichendes BILD wird berichtet.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { PINNED_REFS, pinnedEnvFile } from "./lib/staging-guard.mts";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { riegel3, type Ausschluss, type Figur }
  from "../src/lib/catalog/sync-collision-gate.ts";
import { GEREGELT, UNGEREGELT } from "../src/lib/catalog/publish-compare.ts";
import {
  familienWidersprueche, gebrauchteFamilien, pruefeBasisziele,
} from "../src/lib/catalog/publish-variants.ts";
import { folgeschritte } from "../src/lib/catalog/publish-new-figure.ts";
import { OVP_REMOVED_SKY_IDS, pruefeEntfernte } from "../src/lib/catalog/ovp-removal.ts";
import { liesModus, pruefeEinwegrichtung, type Modus }
  from "../src/lib/catalog/publish-mode.ts";
import { driftBericht, pruefeDrift, pruefeLedger, standAbdruck,
         type Ledger, type Stand } from "../src/lib/catalog/publish-drift.ts";

const STAGING_REF = PINNED_REFS.staging;
const PRODUCTION_REF = PINNED_REFS.production;
const ENTSCHEIDUNGEN = "resources/sync/bootstrap-decisions.json";

/* ------------------------------------------------------------------ Typen */

type Zeile = Record<string, unknown>;
type Abzug = { skylanders: Zeile[]; categories: Zeile[]; characters: Zeile[] };
type Umgebung = "staging" | "production";

/** Die 19 synchronisierten Felder, in ihren drei Journalklassen (SYNC-06). */
const KLASSE_A = ["catalog_status", "catalog_visible", "display_name_override",
                  "image_override_path", "card_type"] as const;
const KLASSE_B = ["types", "visible_type", "familie", "base_sky_id"] as const;
const KLASSE_C = ["series_code", "kategorie", "name", "slug", "item_type", "is_active",
                  "visible_type_decided", "image_file", "source", "usk_rating"] as const;

/*
 * DIE REIHENFOLGE IST DIE AUS S3/S4, ZEICHEN FUER ZEICHEN — nicht die der
 * drei Klassen oben. Der Abdruck ist ein `concat_ws('|', ...)`, und eine
 * andere Reihenfolge ergibt eine andere Pruefsumme bei identischen Daten.
 * Genau daran ist die erste Fassung dieses Werkzeugs gescheitert: 654 und
 * 622 Zeilen stimmten, die Abdruecke nicht.
 */
const FELDER = ["series_code", "kategorie", "name", "slug", "display_name_override",
                "card_type", "item_type", "is_active", "catalog_visible", "catalog_status",
                "base_sky_id", "familie", "types", "visible_type", "visible_type_decided",
                "image_file", "image_override_path", "source", "usk_rating"] as const;

/** Der Schreibweg je Feld — die Tabelle aus SYNC-09 Abschnitt 3, als Code. */
const WEG: Record<string, string> = {
  catalog_status: "R update (Trigger journalisiert)",
  catalog_visible: "R update (Trigger journalisiert)",
  display_name_override: "R update (Trigger journalisiert)",
  /*
   * EIN DIREKTES `update`, NICHT DIE RPC — und das war bis zum 2026-10-31
   * falsch beschriftet. Hier stand `R system_set_image_override (0035)`, und
   * `catalog-sync-apply.mts` ruft diese Funktion NIRGENDS auf (gemessen: 0
   * Treffer). Eine Wegangabe, die etwas anderes verspricht als geschieht,
   * ist schlimmer als keine.
   *
   * Das direkte `update` ist hier auch das Richtige: es traegt die
   * Vergleichsbedingung IN der schreibenden Anweisung (TOR 2), was die RPC
   * nicht tut. Dass der Pfad zur eigenen Figur gehoert, prueft der
   * Storage-Transfer in Riegel 3 — dieselbe Bedingung, nur frueher.
   */
  image_override_path: "R update (Trigger journalisiert)",
  card_type: "R update (Trigger journalisiert)",
  types: "W admin_set_figure_types (0163)",
  visible_type: "W admin_set_visible_type (0163)",
  familie: "W admin_set_character (0158)",
  base_sky_id: "W admin_set_variant_base (0159)",
};
/*
 * Die Zuordnung ist TOTAL: jedes der 19 Felder liegt in genau einer Klasse.
 * Ein Feld, das in keiner liegt, ist ein Feld, dessen Journalpflicht niemand
 * entschieden hat — und das soll auffallen, nicht stillschweigend als C
 * durchgehen.
 */
const klasse = (f: string): "A" | "B" | "C" => {
  if ((KLASSE_A as readonly string[]).includes(f)) return "A";
  if ((KLASSE_B as readonly string[]).includes(f)) return "B";
  if ((KLASSE_C as readonly string[]).includes(f)) return "C";
  throw new Error(`catalog-sync: das Feld ${f} ist keiner Journalklasse zugeordnet`);
};

/* ------------------------------------------------------------- Verbindung */


/*
 * M-04 (2026-11-09): kein eigener Teilstring-Vergleich mehr. `pinnedEnvFile`
 * (tools/lib/staging-guard.mts) verlangt die EXAKTE Projekt-ID und dass die
 * beiden Env-Dateien weder dasselbe Projekt noch denselben Schluessel nennen.
 */
function verbinde(pfad: string, kennung: string, name: string): SupabaseClient {
  const z = pinnedEnvFile(pfad === ".env.local" ? "production" : "staging");
  if (z.ref !== kennung) {
    console.error(`\n  RIEGEL 1 — Abbruch. ${pfad} nennt nicht ${kennung} (${name}).\n`);
    process.exit(1);
  }
  return createClient(z.url, z.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Blaettert eine Tabelle vollstaendig durch. Nur `select`. */
async function alle(db: SupabaseClient, tabelle: string, spalten: string, nach: string) {
  const zeilen: Zeile[] = [];
  for (let von = 0; ; von += 1000) {
    const { data, error } = await db.from(tabelle).select(spalten).order(nach)
      .range(von, von + 999);
    if (error) throw new Error(`${tabelle}: ${error.message}`);
    zeilen.push(...(data as unknown as Zeile[]));
    if (!data || data.length < 1000) break;
  }
  return zeilen;
}

async function lies(db: SupabaseClient): Promise<Abzug> {
  return {
    skylanders: await alle(db, "skylanders",
      "sky_id,name,slug,series_code,category_id,image_file,"
      + "is_active,character_id,catalog_visible,display_name_override,image_override_path,"
      + "card_type,source,item_type,usk_rating,catalog_status,base_sky_id,types,visible_type,"
      + "visible_type_decided", "sky_id"),
    categories: await alle(db, "categories", "id,series_code,position,name,catalog_group", "id"),
    characters: await alle(db, "characters",
      "id,canonical_name,element,species,role_type,short_description,source_url,"
      + "source_label,verified_at", "canonical_name"),
  };
}

/* ------------------------------------------------- fachliche Sicht je Zeile */

const t = (v: unknown): string =>
  v === null || v === undefined ? "~"
  : typeof v === "boolean" ? (v ? "true" : "false")
  : Array.isArray(v) ? (v.length ? [...v].sort().join("+") : "~")
  : String(v);

function sicht(a: Abzug): Map<string, Zeile> {
  const kat = new Map(a.categories.map((c) => [c.id as number, c]));
  const chr = new Map(a.characters.map((c) => [c.id as number, c]));
  const m = new Map<string, Zeile>();
  for (const r of a.skylanders) {
    const c = kat.get(r.category_id as number);
    const h = chr.get(r.character_id as number);
    m.set(r.sky_id as string, {
      ...r,
      kategorie: c ? c.name : null,
      familie: h ? h.canonical_name : null,
    });
  }
  return m;
}

const ausgeschlossen = (r: Zeile, d: Zeile): boolean => {
  const a = d.ausschluss as Record<string, string[] | string>;
  return (a.testserien as string[]).includes(r.series_code as string)
    || (r.sky_id as string) >= (a.band_ab as string)
    || (a.status as string[]).includes(r.catalog_status as string);
};

/** Bereich 1-4 des Fingerprints, mit genau der Logik aus S3/S4. */
function fingerprint(a: Abzug, d: Zeile) {
  const s = sicht(a);
  const md5 = (zz: string[]) => createHash("md5").update(zz.join("\n")).digest("hex");
  const frei: string[] = []; const aus: string[] = [];
  for (const id of [...s.keys()].sort()) {
    const r = s.get(id)!;
    if (ausgeschlossen(r, d)) { aus.push(id); continue; }
    frei.push([id, ...FELDER.map((f) => t(r[f]))].join("|"));
  }
  const kat = a.categories
    .filter((c) => !(d.ausschluss as Zeile).testserien ||
      !((d.ausschluss as Zeile).testserien as string[]).includes(c.series_code as string))
    .sort((x, y) => `${x.series_code}|${x.name}` < `${y.series_code}|${y.name}` ? -1 : 1)
    .map((c) => [c.series_code, c.name, c.position, t(c.catalog_group)].join("|"));
  const chr = [...a.characters]
    .sort((x, y) => (x.canonical_name as string) < (y.canonical_name as string) ? -1 : 1)
    .map((c) => [c.canonical_name, t(c.element), t(c.species), t(c.role_type),
                 t(c.short_description), t(c.source_url), t(c.source_label),
                 t(c.verified_at)].join("|"));
  return {
    katalog_freigegeben: { zeilen: frei.length, abdruck: md5(frei) },
    kategorien: { zeilen: kat.length, abdruck: md5(kat) },
    charaktere: { zeilen: chr.length, abdruck: md5(chr) },
    ausgeschlossen: { zeilen: aus.length, abdruck: md5(aus.sort()) },
  };
}

/* ------------------------------------------------------------------- Lauf */

/*
 * RIEGEL 2 ALS TOR ODER ALS MESSUNG — UND WARUM ES BEIDES BRAUCHT.
 *
 * Riegel 2 fragt: „hat sich seit dem eingefrorenen Messwert etwas bewegt?"
 * Fuer einen KALTSTART ist das genau richtig: eine fremde Aenderung macht
 * jeden Plan veraltet, und ein Abbruch ist die richtige Antwort.
 *
 * Der Abschlusslauf (`catalog-finish.mts`) rechnet aber ZWISCHEN seinen
 * Etappen neu — nach Etappe C und nach Etappe D, also nach seinen EIGENEN
 * Schreibvorgaengen. Dort ist die Abweichung keine Ueberraschung, sondern
 * das Ergebnis. Mit Riegel 2 als Tor koennte der Runner Etappe C nie
 * verlassen: am 2026-10-31 ist genau das aufgefallen, nachdem 23 Schritte
 * geschrieben waren.
 *
 * `--riegel2=messen` macht aus dem Tor eine Auskunft. Die Flagge setzt
 * ausschliesslich der Runner, und ausschliesslich fuer die Neuberechnungen
 * NACH seinen Schreibvorgaengen — der erste Plan desselben Laufs bleibt
 * gated. Der Schutz geht dabei nicht verloren, er wandert: das
 * Abschlusskriterium von Etappe E („0 Schritte in beide Richtungen, drei
 * Fingerprints gleich") und die Schutzpruefung sind strenger als Riegel 2,
 * weil sie den ZIELzustand verlangen und nicht nur Unveraendertheit.
 */
const RIEGEL2_MESSEN = process.argv.includes("--riegel2=messen");

/*
 * DER MODUS WIRD VERLANGT, NICHT GERATEN.
 *
 * `bootstrap` ist der einmalige Abgleich vom 2026-10-30/31 — er plant in
 * beide Richtungen und kennt die Einmalregeln. `publish` ist der
 * Dauerbetrieb nach ADR-0163: einseitig nach Production, ohne jede dieser
 * Regeln. Ein Vorgabewert waere genau die stille Annahme, die hier teuer
 * ist; die ganze Begruendung steht in `src/lib/catalog/publish-mode.ts`.
 */
const modusOderFehler = liesModus(process.argv);
if (typeof modusOderFehler !== "string") {
  console.error(`\n  ABBRUCH. ${modusOderFehler.fehler}\n`);
  process.exit(1);
}
const MODUS: Modus = modusOderFehler;
const BOOTSTRAP = MODUS === "bootstrap";
const LEDGER_DATEI = "resources/sync/publish-ledger.json";

const D = JSON.parse(readFileSync(ENTSCHEIDUNGEN, "utf8")) as Zeile;

const S = verbinde(".env.staging", STAGING_REF, "Staging");
const P = verbinde(".env.local", PRODUCTION_REF, "Production");
console.log(`  Riegel 1 ok — Staging ${STAGING_REF}, Production ${PRODUCTION_REF}\n`);

const abzug: Record<Umgebung, Abzug> = { staging: await lies(S), production: await lies(P) };
const fp = {
  staging: fingerprint(abzug.staging, D),
  production: fingerprint(abzug.production, D),
};

const sS = sicht(abzug.staging); const sP = sicht(abzug.production);

/** Die geregelte Projektion der freigegebenen Zeilen — ohne name und slug. */
function geregelterStand(m: Map<string, Zeile>): Stand {
  const out: Record<string, string> = {};
  for (const id of [...m.keys()].sort()) {
    const r = m.get(id)!;
    if (ausgeschlossen(r, D)) continue;
    /*
     * DIE 30 ENTFERNTEN OVP-DUPLIKATE GEHOEREN NICHT ZUM GEREGELTEN STAND
     * (CAT-12, ADR-0166). Sie verschwinden erst auf Staging, dann auf
     * Production; dazwischen fuehrt nur Production sie. Ohne diese Zeile
     * stuende der Stand in diesem Fenster ungleich, und der Publish brache
     * nach dem Schreiben an GLEICHSTAND ab. NICHT in `ausgeschlossen()`:
     * die zaehlt im versiegelten Bootstrap-Fingerprint mit.
     */
    if (OVP_REMOVED_SKY_IDS.has(id)) continue;
    out[id] = GEREGELT.map((f) => t(r[f])).join("|");
  }
  return out;
}

if (BOOTSTRAP) {
  /* ---- RIEGEL 2 (Bootstrap): nichts darf sich bewegt haben ---- */
  const live = D.fingerprint_live as
    Record<string, Record<string, { zeilen: number; abdruck: string }>>;
  const abweichungen: string[] = [];
  for (const u of ["staging", "production"] as Umgebung[]) {
    for (const b of ["katalog_freigegeben", "kategorien", "charaktere", "ausgeschlossen"]) {
      const soll = live[u][b];
      const ist = (fp[u] as Record<string, { zeilen: number; abdruck: string }>)[b];
      if (soll.zeilen !== ist.zeilen || soll.abdruck !== ist.abdruck) {
        abweichungen.push(`${u}/${b}: erwartet ${soll.zeilen}·${soll.abdruck}, `
          + `gemessen ${ist.zeilen}·${ist.abdruck}`);
      }
    }
  }
  if (abweichungen.length > 0 && !RIEGEL2_MESSEN) {
    console.error("\n  RIEGEL 2 — Abbruch. Der Fingerprint weicht vom Messwert des "
      + "Betreibers ab:\n");
    for (const a of abweichungen) console.error(`    ${a}`);
    console.error("\n  Es hat sich seit dem 2026-10-30 etwas bewegt. Erst klaeren, "
      + "dann neu planen.\n");
    process.exit(1);
  }
  if (abweichungen.length > 0) {
    console.log("  Riegel 2 ALS MESSUNG (--riegel2=messen) — die Abweichung wird "
      + "berichtet, nicht geriegelt:");
    for (const a of abweichungen) console.log(`    ${a}`);
    console.log("  Das ist nach einem eigenen Schreibvorgang erwartet. Den Zielzustand\n"
      + "  verlangt Etappe E, nicht dieser Riegel.\n");
  } else {
    console.log("  Riegel 2 ok — alle acht Abdruecke entsprechen dem Messwert\n");
  }
} else {
  /* ---- RIEGEL 2 (Publish): der DRIFTRIEGEL ---- */
  /*
   * Staging darf sich bewegen — das ist der Zweck. Production darf es nicht.
   * Geprueft wird deshalb nicht Unveraendertheit, sondern HERKUNFT: traegt
   * jedes geregelte Feld auf Production den veroeffentlichten Wert oder den,
   * auf den dieser Publish zielt? Ein dritter Wert ist Drift. Die ganze
   * Begruendung steht in `src/lib/catalog/publish-drift.ts`.
   */
  let ledger: Ledger;
  try {
    ledger = JSON.parse(readFileSync(LEDGER_DATEI, "utf8")) as Ledger;
  } catch (e) {
    console.error(`\n  RIEGEL 2 — Abbruch. ${LEDGER_DATEI} ist nicht lesbar `
      + `(${e instanceof Error ? e.message : String(e)}).\n\n  Ohne den `
      + `veroeffentlichten Stand laesst sich Drift nicht von eigener Arbeit\n`
      + `  unterscheiden. Eine fehlende Datei ist kein Bestehen.\n`);
    process.exit(1);
  }
  const schluessig = pruefeLedger(ledger);
  if (!schluessig.ok) {
    console.error(`\n  RIEGEL 2 — Abbruch. ${LEDGER_DATEI} ist nicht schluessig:\n`);
    for (const b of schluessig.befunde) console.error(`    ${b}`);
    console.error("");
    process.exit(1);
  }
  if (ledger.geregelte_felder.join("|") !== GEREGELT.join("|")) {
    console.error(`\n  RIEGEL 2 — Abbruch. Der Stand nennt andere geregelte Felder `
      + `als der Vergleich:\n    Stand:     ${ledger.geregelte_felder.join(", ")}`
      + `\n    Vergleich: ${GEREGELT.join(", ")}\n`);
    process.exit(1);
  }
  const standS = geregelterStand(sS); const standP = geregelterStand(sP);
  const drift = pruefeDrift(ledger, standS, standP);
  console.log(`  Riegel 2 — Driftpruefung gegen ${LEDGER_DATEI}`);
  console.log(`             Stand vom ${ledger.veroeffentlicht_am}, `
    + `${ledger.zeilen} Zeilen, Abdruck ${ledger.abdruck.slice(0, 8)}`);
  for (const z of driftBericht(drift)) console.log(`             ${z}`);
  const jetztS = standAbdruck(standS); const jetztP = standAbdruck(standP);
  console.log(`             Staging jetzt ${jetztS.zeilen}·${jetztS.abdruck.slice(0, 8)}`
    + `   Production jetzt ${jetztP.zeilen}·${jetztP.abdruck.slice(0, 8)}`);
  if (!drift.ok && !RIEGEL2_MESSEN) {
    console.error(`\n  RIEGEL 2 — Abbruch. Production ist von Hand veraendert worden.\n\n`
      + `  Der naechste Publish wuerde diese Werte stillschweigend `
      + `ueberschreiben.\n  Erst klaeren: gehoert die Aenderung nach Staging, oder `
      + `war sie ein\n  Versehen? Danach neu planen.\n`);
    process.exit(1);
  }
  if (!drift.ok) {
    console.log("             (--riegel2=messen: Drift wird berichtet, nicht geriegelt)");
  }
  console.log(`  Riegel 2 ok — kein Production-Drift\n`);
}

/*
 * DIE ENTSCHIEDENEN KOLLISIONEN — ABER NUR DIE NOCH OFFENEN.
 *
 * *** DER FEHLER VOM 2026-10-31 ***
 *
 * `bekannt` hatte zwei Aufgaben: Riegel 3 laesst eine entschiedene Kollision
 * durch, und der Feldvergleich (Abschnitt 5) ueberspringt sie. Die zweite
 * war richtig, SOLANGE hinter der SKY-ID zwei verschiedene Figuren standen —
 * ein Feldvergleich zwischen `Gold Fire Kraken` und `Winterfest Lob-Star`
 * ergibt keinen Sinn.
 *
 * Nach der Aufloesung ist es dieselbe Figur auf beiden Seiten, und das
 * Ueberspringen verdeckt einen ECHTEN Unterschied: `SKY-0821` trug auf
 * Staging keinen Bildverweis, auf Production einen — und der Plan fuehrte
 * dazu NULL Schritte. Der Vergleich haette nie 0 erreichen koennen, und
 * zwar ohne es zu sagen.
 *
 * Eine Kollision mit `geloest`-Eintrag zaehlt deshalb nicht mehr als
 * „bekannt": sie ist keine Kollision mehr, sondern eine gewoehnliche Zeile.
 */
const kollisionen_entschieden = (D.sky_id as Zeile).kollision as Record<string, Zeile>;
const bekannt = Object.entries(kollisionen_entschieden)
  .filter(([, v]) => v.geloest === undefined)
  .map(([k]) => k);
const geloest = Object.entries(kollisionen_entschieden)
  .filter(([, v]) => v.geloest !== undefined).map(([k]) => k);

/*
 * RIEGEL 3 — aus `sync-collision-gate.ts`, nicht hier ausgeschrieben.
 *
 * Die Zeilen, die der Riegel ansieht, sind `sicht()`-Zeilen; `als()` holt
 * daraus genau die sechs Felder, die er kennt. Es gibt also keine zweite,
 * stillschweigend abweichende Vorstellung davon, was eine Figur ist.
 */
const als = (m: Map<string, Zeile>): Map<string, Figur> => new Map(
  [...m].map(([id, r]) => [id, {
    sky_id: id,
    name: (r.name ?? null) as string | null,
    slug: (r.slug ?? null) as string | null,
    series_code: (r.series_code ?? null) as string | null,
    image_file: (r.image_file ?? null) as string | null,
    catalog_status: (r.catalog_status ?? null) as string | null,
  }]));

const r3 = riegel3(als(sS), als(sP), D.ausschluss as unknown as Ausschluss, bekannt);
const kollisionen = r3.konflikte.map((k) => k.sky_id);

if (r3.unbekannt.length > 0) {
  console.error("\n  RIEGEL 3 — Abbruch. Unentschiedener Identitaetskonflikt:\n");
  for (const k of r3.konflikte.filter((x) => r3.unbekannt.includes(x.sky_id))) {
    console.error(`    ${k.sky_id} — abweichend: ${k.merkmale.join(", ")}`);
  }
  console.error("\n  Erst in bootstrap-decisions.json entscheiden, dann neu planen.\n");
  process.exit(1);
}
console.log(`  Riegel 3 ok — ${kollisionen.length} Identitaetskonflikt(e), alle entschieden:`
  + ` ${r3.konflikte.map((k) => `${k.sky_id} (${k.merkmale.join("+")})`).join(", ") || "keiner"}`);
console.log(`              ${r3.namensabweichungen.length} Namensabweichung(en) — kein Konflikt,`
  + " dieselbe Figur (ADR-0030)");
if (geloest.length > 0) {
  console.log(`              ${geloest.length} frueher(e) Kollision(en) AUFGELOEST und damit `
    + `wieder im Feldvergleich: ${geloest.join(", ")}`);
}
console.log(`              ${r3.ausserhalb.length} ausserhalb des Abgleichs`
  + `${r3.ausserhalb.length ? `: ${r3.ausserhalb.map((x) => x.sky_id).join(", ")}` : ""}`);
if (r3.bildhinweise.length > 0) {
  console.log(`              HINWEIS: abweichendes Bild ohne Identitaetsabweichung bei`
    + ` ${r3.bildhinweise.join(", ")} — kein Riegel, nur zur Kenntnis`);
}
console.log();

/* ----------------------------------------------------------- der Plan selbst */

type Schritt = {
  ziel: Umgebung; art: string; sky_id: string; feld?: string; klasse?: string;
  von?: string; nach?: string; weg: string; grund: string;
  /** Nur bei `figur-anlegen`: die Werte, mit denen die Zeile entsteht. */
  quelle?: Record<string, unknown>;
};
const plan: Schritt[] = [];
const ovr = D.display_name_override as Record<string, { wert: string; grund: string }>;
const nameKorr = D.name_korrektur_staging as Record<string, { wert: string; grund: string }>;

// 1. Charaktere, die Production fehlen
/*
 * NUR DIE, DIE EINE ZU VERÖFFENTLICHENDE FIGUR TRÄGT (CAT-19). Bis dahin
 * legte der Plan JEDE Staging-Familie an, die Production fehlte — auch eine
 * leere, etwa eine verlassene Pseudofamilie. Die entstand dann auf
 * Production ohne ein einziges Mitglied.
 */
const giltFuerPublish = (id: string, r: Zeile) => !ausgeschlossen(r, D) && !OVP_REMOVED_SKY_IDS.has(id);
const gebraucht = gebrauchteFamilien([...sS].map(([id, r]) => ({
  base_sky_id: (r.base_sky_id as string | null) ?? null,
  familie: (r.familie as string | null) ?? null,
  gilt: giltFuerPublish(id, r),
})));
const chrP = new Set(abzug.production.characters.map((c) => c.canonical_name as string));
for (const c of abzug.staging.characters) {
  /* Der versiegelte Bootstrap bleibt, wie er gelaufen ist. */
  if (!chrP.has(c.canonical_name as string)
      && (BOOTSTRAP || gebraucht.has(c.canonical_name as string))) {
    plan.push({ ziel: "production", art: "charakter-anlegen", sky_id: "—",
      nach: c.canonical_name as string, weg: "W admin_create_character (0158)",
      grund: "wird von einer zu uebernehmenden Figur gebraucht" });
  }
}

// 2. Anzeigenamen — die entschiedene Liste
/*
 * NUR IM BOOTSTRAP AUCH NACH STAGING. Die Liste lag als Entscheidung vor und
 * musste auf beide Umgebungen. Im Dauerbetrieb pflegt der Admin den
 * Anzeigenamen auf Staging, und der Publish traegt ihn als gewoehnlichen
 * Feldschritt nach Production — Abschnitt 5. Eine Liste, die weiter nach
 * Staging schreibt, wuerde redaktionelle Arbeit zuruecknehmen.
 */
const ovrZiele: [Umgebung, Map<string, Zeile>][] = BOOTSTRAP
  ? [["production", sP], ["staging", sS]]
  : [["production", sP]];
for (const [id, o] of Object.entries(ovr)) {
  for (const [u, s] of ovrZiele) {
    const r = s.get(id);
    if (r && t(r.display_name_override) !== o.wert) {
      plan.push({ ziel: u, art: "feld", sky_id: id, feld: "display_name_override", klasse: "A",
        von: t(r.display_name_override), nach: o.wert,
        weg: WEG.display_name_override, grund: o.grund });
    }
  }
}

// 3. Namenskorrektur auf Staging (nicht aus der Excel) — EINMALIG
/*
 * SKY-0922 traegt einen Namen, der nicht aus der Excel kommt (`source =
 * admin`), weshalb ADR-0030 ihn nicht bindet. Einmal gesetzt ist die Sache
 * erledigt; im Dauerbetrieb schreibt dieser Abgleich keinen Namen mehr,
 * nirgends.
 */
for (const [id, n] of Object.entries(BOOTSTRAP ? nameKorr : {})) {
  const r = sS.get(id);
  if (r && t(r.name) !== n.wert) {
    plan.push({ ziel: "staging", art: "feld", sky_id: id, feld: "name", klasse: "C",
      von: t(r.name), nach: n.wert, weg: "R update (nicht journalisierbar)", grund: n.grund });
  }
}

/*
 * 4. FIGUREN, DIE DER ANDEREN SEITE FEHLEN — IN BEIDE RICHTUNGEN.
 *
 * *** WARUM DAS JETZT SYMMETRISCH IST (ADR-0163) ***
 *
 * Bis zum 2026-10-31 plante dieser Abschnitt nur `staging -> production`.
 * Das war die stille Annahme, dass Production keine eigenen Katalogzeilen
 * hat — und sie war falsch: `SKY-0821` (`Winterfest Lob-Star`) existiert nur
 * dort.
 *
 * Mit einer FUEHRENDEN Umgebung wird das zum Problem, nicht zur Nebensache:
 * das Abschlusskriterium lautet „der Dry-Run meldet 0 Schritte in beide
 * Richtungen". Eine Zeile, die der Planer gar nicht ausdruecken KANN, haelt
 * ihn fuer immer bei mindestens einem Unterschied — oder zwingt zu einer
 * stillschweigenden Ausnahme im Vergleich. Beides ist schlechter als der
 * eine zusaetzliche Schritt.
 *
 * Nach der einmaligen Uebernahme (Etappe C) ist die Richtung dauerhaft
 * einseitig; dieser Abschnitt wird dann nichts mehr nach Staging planen.
 */
const SICHT_ZEILEN = new Set<string>();

/** Plant das Anlegen aller Figuren, die `ziel` fehlen. */
function planeFigurenanlage(ziel: Umgebung) {
  const quelle: Umgebung = ziel === "production" ? "staging" : "production";
  const sQ = quelle === "staging" ? sS : sP;
  const sZ = ziel === "staging" ? sS : sP;
  for (const id of [...sQ.keys()].sort()) {
    const r = sQ.get(id)!;
    if (sZ.has(id)) continue;
    if (ausgeschlossen(r, D)) continue;
    /*
     * DIE QUELLWERTE GEHEN MIT IN DEN PLAN. Der Apply-Pfad darf sie NICHT aus
     * der Quelle nachladen: dann schriebe er einen Stand, den niemand im
     * Dry-Run gesehen hat. Was angelegt wird, steht in der Datei, die du
     * freigibst.
     *
     * `category_id` ist die des ZIELS, ueber (series_code, Kategoriename)
     * aufgeloest — die Zahl der Quelle waere dort eine andere Kategorie
     * (ADR-0034). Fuer `SKY-0821` heisst das: Production fuehrt `T/Trap
     * Masters` unter 18, Staging unter 25.
     */
    const zielKat = abzug[ziel].categories.find(
      (c) => c.series_code === r.series_code && c.name === r.kategorie);
    if (!zielKat) {
      console.error(`\n  ABBRUCH: fuer ${id} fehlt die Kategorie `
        + `${r.series_code}/${r.kategorie} auf ${ziel}.\n`);
      process.exit(1);
    }
    plan.push({ ziel, art: "figur-anlegen", sky_id: id, nach: t(r.name),
      weg: "R system_sync_create_figure (0165)",
      grund: `${r.series_code}/${r.kategorie}, ${r.catalog_status}, ohne Preis`,
      quelle: {
        name: r.name, slug: r.slug, series_code: r.series_code,
        category_id: zielKat.id, card_type: r.card_type, item_type: r.item_type,
        catalog_status: r.catalog_status, source: r.source,
        image_file: r.image_file ?? null, usk_rating: r.usk_rating ?? null,
      } });
    /*
     * DIE FOLGESCHRITTE — ALLE, IN EINEM LAUF (CAT-11).
     *
     * Bis hierher standen hier vier Felder und der Bildverweis von Hand.
     * `display_name_override` und `visible_type_decided` fehlten, und eine
     * neue Figur wurde erst im ZWEITEN Publish vollstaendig. Jetzt rechnet
     * `folgeschritte()` gegen den Zustand NACH der Anlage: jedes geregelte
     * Feld, das davon abweicht, bekommt einen Schritt.
     *
     * Der Bildverweis bleibt ein direktes `update` mit Compare-and-Set
     * (nicht `system_set_image_override`) und laeuft im Apply zuletzt
     * (FELDRANG 9); der Storage-Transfer muss das Objekt vorher gebracht
     * haben.
     */
    const quelleFelder = Object.fromEntries(GEREGELT.map((f) => [f, t(r[f])]));
    for (const f of folgeschritte(quelleFelder, GEREGELT)) {
      plan.push({ ziel, art: "feld-neu", sky_id: id, feld: f.feld, klasse: klasse(f.feld),
        von: f.von, nach: f.nach,
        weg: WEG[f.feld] ?? "R update (nicht journalisierbar)",
        grund: f.feld === "image_override_path" ? "Bild der neuen Zeile" : "Wert der neuen Zeile" });
    }
  }
}

planeFigurenanlage("production");
/*
 * NACH STAGING NUR IM BOOTSTRAP. Dort fehlten Staging echte Zeilen —
 * SKY-0821 und die Production-eigenen. Im Dauerbetrieb entstehen neue
 * Figuren auf Staging; eine Figur, die nur Production fuehrt, waere ein
 * Befund und keine Arbeitsanweisung (der Driftriegel nennt sie).
 */
if (BOOTSTRAP) planeFigurenanlage("staging");
// 5. Feldabweichungen an bestehenden Zeilen
const sichtbarkeitProdGewinnt = (D.sichtbarkeit as Zeile).richtung === "production_gewinnt";
for (const id of [...sS.keys()].sort()) {
  const a = sS.get(id); const b = sP.get(id);
  if (!a || !b) continue;
  if (ausgeschlossen(a, D) && ausgeschlossen(b, D)) continue;
  if (bekannt.includes(id)) continue;
  const sichtAb = t(a.catalog_visible) !== t(b.catalog_visible);
  if (sichtAb) SICHT_ZEILEN.add(id);
  for (const f of FELDER) {
    if (t(a[f]) === t(b[f])) continue;
    /*
     * `UNGEREGELT` statt zweier Namen in einer Bedingung — seit dem
     * 2026-10-31. Hier stand `f === "name" || f === "slug"`, und die
     * Fingerprintpruefung in Etappe E kannte diese Regel nicht: sie verglich
     * `name` mit und brach ab, obwohl der Plan auf 0 stand. Zwei Quellen fuer
     * dieselbe Regel, und nur eine wusste davon.
     */
    if ((UNGEREGELT as readonly string[]).includes(f)) continue;   // Excel ist Hoheit
    if (Object.prototype.hasOwnProperty.call(ovr, id) && f === "display_name_override") continue;
    /*
     * SICHTBARKEIT: STAGING FOLGT PRODUCTION — NUR IM BOOTSTRAP.
     * Die 22 abweichenden Zeilen trugen ihre Entscheidung auf Production.
     * Im Dauerbetrieb entscheidet Staging (ADR-0163), und eine
     * Sichtbarkeitsaenderung dort ist ein gewoehnlicher Schritt nach
     * Production.
     */
    if (BOOTSTRAP && sichtAb && (f === "catalog_visible" || f === "catalog_status")) {
      plan.push({ ziel: "staging", art: "feld", sky_id: id, feld: f, klasse: "A",
        von: t(a[f]), nach: t(b[f]), weg: WEG[f],
        grund: "Sichtbarkeit: Staging folgt Production" });
      continue;
    }
    /*
     * PRODUCTION-EIGENE ENTSCHEIDUNG GEWINNT — NUR IM BOOTSTRAP.
     * Production trug Anzeigenamen und Bildverweise, die Staging fehlten.
     * Sie wurden einmal uebernommen; danach ginge dieselbe Regel in die
     * falsche Richtung und wuerde eine Loeschung auf Staging zurueckdrehen.
     */
    const prodEigen = f === "display_name_override" || f === "image_override_path";
    const prodHatWert = t(b[f]) !== "~";
    const nachStaging = BOOTSTRAP && sichtbarkeitProdGewinnt && prodEigen
      && prodHatWert && t(a[f]) === "~";
    plan.push(nachStaging
      ? { ziel: "staging", art: "feld", sky_id: id, feld: f, klasse: klasse(f),
          von: t(a[f]), nach: t(b[f]), weg: WEG[f] ?? "R update (nicht journalisierbar)",
          grund: "Production-eigene Entscheidung" }
      : { ziel: "production", art: "feld", sky_id: id, feld: f, klasse: klasse(f),
          von: t(b[f]), nach: t(a[f]), weg: WEG[f] ?? "R update (nicht journalisierbar)",
          grund: "Staging-Stand" });
  }
}

/* ------------------------ RIEGEL 6: keine entfernte SKY-ID kommt zurueck */
/*
 * IN BEIDEN MODI (CAT-12, ADR-0166). Die 30 OVP-Duplikate werden erst auf
 * Staging und spaeter auf Production entfernt. Dazwischen fuehrt Production
 * sie noch — und der BOOTSTRAP plant fehlende Figuren auch nach Staging. Ein
 * Plan, der eine davon anlegt oder beschreibt, ist falsch, egal in welche
 * Richtung. Die Datenbank wuerde die Anlage ohnehin abweisen
 * (`skylanders_refuse_removed`, 0167); hier faellt es auf, bevor geschrieben
 * wird.
 */
{
  const r6 = pruefeEntfernte(plan);
  if (r6.length > 0) {
    console.error(`\n  RIEGEL 6 — Abbruch. ${r6.length} Schritt(e) betreffen dauerhaft `
      + "entfernte OVP-Duplikate (data/catalog/ovp-removal.json):\n");
    for (const x of r6.slice(0, 20)) {
      console.error(`    ${x.ziel} ${x.art}${x.feld ? ` ${x.feld}` : ""} ${x.sky_id}`);
    }
    console.error("\n  Erst auf BEIDEN Umgebungen entfernen (supabase/operations/*-ovp-removal.sql),\n"
      + "  dann neu planen. Nie eine entfernte SKY-ID wieder anlegen (ADR-0001).\n");
    process.exit(1);
  }
  console.log("  Riegel 6 ok — kein Schritt betrifft ein entferntes OVP-Duplikat\n");
}

/* ----------------------------------- RIEGEL 4: die Einwegrichtung */
/*
 * DIE REGELN EINZELN ABZUSCHALTEN GENUEGT NICHT.
 *
 * Jede der fuenf Einmalregeln haengt jetzt an `BOOTSTRAP` — aber eine
 * kuenftig hinzugefuegte Regel koennte wieder nach Staging planen, ohne dass
 * es jemandem auffaellt. Dieser Riegel prueft das ERGEBNIS: im Publish darf
 * der Plan keinen einzigen Schritt Richtung Staging fuehren, egal woher er
 * kaeme.
 */
if (!BOOTSTRAP) {
  const einweg = pruefeEinwegrichtung(plan);
  if (!einweg.ok) {
    console.error(`\n  RIEGEL 4 — Abbruch. Der Publish-Plan fuehrt `
      + `${einweg.nachStaging.length} Schritt(e) Richtung STAGING:\n`);
    for (const x of einweg.nachStaging.slice(0, 20)) {
      console.error(`    ${x.sky_id} ${x.art}${x.feld ? ` ${x.feld}` : ""} — ${x.grund}`);
    }
    if (einweg.nachStaging.length > 20) {
      console.error(`    … und ${einweg.nachStaging.length - 20} weitere`);
    }
    console.error("\n  Im Dauerbetrieb ist Production nur Ziel (ADR-0163). Eine Regel,\n"
      + "  die nach Staging schreibt, gehoert an den Bootstrap gebunden —\n"
      + "  siehe src/lib/catalog/publish-mode.ts.\n");
    process.exit(1);
  }
  console.log("  Riegel 4 ok — kein Schritt zeigt nach Staging\n");
}

/* --------------------------- RIEGEL 5: keine verwaiste Basisfigur */
/*
 * Eine Zuordnung `base_sky_id` muss auf dem Ziel auf eine Figur zeigen, die
 * es dort gibt oder die dieser Lauf anlegt. Fehlt sie — typisch: die
 * Basisfigur ist auf Staging ein Entwurf, und Entwuerfe traegt der Publish
 * nicht —, bricht der Lauf HIER ab, im Plan, und nicht mitten im Apply am
 * Fremdschluessel aus 0159 (CAT-11, `src/lib/catalog/publish-variants.ts`).
 */
/* Nur im Publish: der versiegelte Bootstrap bleibt, wie er gelaufen ist. */
if (!BOOTSTRAP) {
  const r5 = pruefeBasisziele(plan.filter((s) => s.ziel === "production"), new Set(sP.keys()));
  if (!r5.ok) {
    console.error(`\n  RIEGEL 5 — Abbruch. ${r5.verwaist.length} Variantenzuordnung(en) `
      + "zeigen auf Production auf eine Basisfigur, die dort fehlt und nicht angelegt wird:\n");
    for (const x of r5.verwaist.slice(0, 20)) console.error(`    ${x.sky_id} → ${x.nach}`);
    console.error("\n  Meist ist die Basisfigur auf Staging ein Entwurf. Erst sie "
      + "veroeffentlichen oder ausblenden, dann neu planen.\n");
    process.exit(1);
  }
  console.log("  Riegel 5 ok — jede Variantenzuordnung hat ihre Basisfigur auf Production\n");
}

/* ------------------- RIEGEL 7: die Variante traegt die Familie der Basis */
/*
 * CAT-19, ADR-0171. Gemessen am STAGING-Stand, der veroeffentlicht wuerde.
 * Der Plan wird trotzdem geschrieben — man soll sehen koennen, was er
 * enthaelt —, aber `catalog-sync-apply.mts` bricht an TOR 1c ab, solange
 * diese Liste nicht leer ist.
 */
const familienwidersprueche = BOOTSTRAP ? [] : familienWidersprueche(
  new Map([...sS].map(([id, r]) => [id, {
    base_sky_id: (r.base_sky_id as string | null) ?? null,
    familie: (r.familie as string | null) ?? null,
  }])),
  (id) => giltFuerPublish(id, sS.get(id)!),
);
if (familienwidersprueche.length > 0) {
  console.error(`  RIEGEL 7 — ${familienwidersprueche.length} Variante(n) tragen eine andere `
    + "Familie als ihre Basisfigur. Der Plan wird geschrieben, der Publish bricht an TOR 1c ab:\n");
  for (const w of familienwidersprueche) {
    console.error(`    ${w.sky_id} (${w.familie ?? "keine"}) → Basis ${w.basis} (${w.basisFamilie ?? "keine"})`);
  }
  console.error("");
} else if (!BOOTSTRAP) {
  console.log("  Riegel 7 ok — jede Variante traegt die Familie ihrer Basisfigur\n");
}

/* ------------------------------------------------------------- Ausgabe */

const zz = (p: Schritt[]) => ({
  gesamt: p.length,
  nach_art: p.reduce<Record<string, number>>((a, s) => (a[s.art] = (a[s.art] ?? 0) + 1, a), {}),
  nach_klasse: p.reduce<Record<string, number>>((a, s) =>
    (a[s.klasse ?? "—"] = (a[s.klasse ?? "—"] ?? 0) + 1, a), {}),
});
const prod = plan.filter((s) => s.ziel === "production");
const stag = plan.filter((s) => s.ziel === "staging");

writeFileSync("resources/analysis/sync-dryrun.json", JSON.stringify({
  erzeugt: new Date().toISOString(), schreibt_nichts: true,
  modus: MODUS,
  fingerprint_gemessen: fp, kollisionen,
  familienwidersprueche,
  production: zz(prod), staging: zz(stag), plan,
}, null, 1));

const tab = (p: Schritt[]) => {
  const g: Record<string, Schritt[]> = {};
  for (const s of p) (g[`${s.art}|${s.feld ?? ""}|${s.weg}`] ??= []).push(s);
  return Object.entries(g).sort((a, b) => b[1].length - a[1].length)
    .map(([k, v]) => { const [art, feld, weg] = k.split("|");
      return `| ${art}${feld ? ` \`${feld}\`` : ""} | ${v[0].klasse ?? "—"} | ${weg} | **${v.length}** |`; })
    .join("\n");
};
writeFileSync("resources/analysis/SYNC-DRYRUN.md",
`# Dry-Run des Katalogabgleichs

**Erzeugt ${new Date().toISOString()} von \`npm run catalog:sync:plan\`.**
**Dieser Lauf hat nichts geschrieben** — weder in eine Datenbank noch in den Storage.

Riegel 1 (Projektkennung), Riegel 2 (acht Abdrücke gegen den Lauf vom 2026-10-30) und
Riegel 3 (Kollisionen) sind bestanden. Bekannte Kollision: ${kollisionen.join(", ") || "keine"}.

## Nach PRODUCTION — ${prod.length} Schritte

| Art | Klasse | Weg | Anzahl |
|---|---|---|---:|
${tab(prod)}

## Nach STAGING — ${stag.length} Schritte

| Art | Klasse | Weg | Anzahl |
|---|---|---|---:|
${tab(stag)}

## Zusammenfassung

| | Production | Staging |
|---|---:|---:|
| Schritte | **${prod.length}** | **${stag.length}** |
| Klasse A (Trigger journalisiert) | ${prod.filter(s=>s.klasse==="A").length} | ${stag.filter(s=>s.klasse==="A").length} |
| Klasse B (RPC journalisiert) | ${prod.filter(s=>s.klasse==="B").length} | ${stag.filter(s=>s.klasse==="B").length} |
| Klasse C (nicht journalisierbar) | ${prod.filter(s=>s.klasse==="C").length} | ${stag.filter(s=>s.klasse==="C").length} |
| Figuren anlegen | ${prod.filter(s=>s.art==="figur-anlegen").length} | ${stag.filter(s=>s.art==="figur-anlegen").length} |
| Charaktere anlegen | ${prod.filter(s=>s.art==="charakter-anlegen").length} | ${stag.filter(s=>s.art==="charakter-anlegen").length} |

**Der Marktwert kommt in diesem Plan nicht vor** — das Werkzeug liest die Spalte
nicht einmal, und \`src/lib/catalog/sync-plan.test.ts\` misst das am Quelltext.

## Was dieser Dry-Run NICHT plant

Er vergleicht Katalogzeilen. Drei Teile des Bootstraps stehen bewusst daneben, weil sie
keine Feldabweichung sind, sondern eigene Vorgaenge mit eigener Freigabe:

| | |
|---|---|
| **Bildobjekte** | 36 nach Production, 11 nach Staging. Sie gehen ueber Upload mit Rueck\-lesen und Byte-Vergleich, nicht ueber ein Feld |
| **\`SKY-0821\`** | die Aufloesung der Kollision auf Staging — der einzige Schritt, der eine SKY-ID verbraucht, und damit der einzige nicht wiederholbare |
| **Die Vergabebaender** | ein \`setval\` je Umgebung. Es aendert keine Zeile |

Der vollständige Plan Zeile für Zeile: \`resources/analysis/sync-dryrun.json\`.
`);

console.log(`  PRODUCTION  ${String(prod.length).padStart(4)} Schritte   ${JSON.stringify(zz(prod).nach_art)}`);
console.log(`  STAGING     ${String(stag.length).padStart(4)} Schritte   ${JSON.stringify(zz(stag).nach_art)}`);
console.log(`\n  geschrieben: resources/analysis/SYNC-DRYRUN.md und sync-dryrun.json`);
console.log(`  DIESER LAUF HAT KEINE DATENBANK VERAENDERT.\n`);
