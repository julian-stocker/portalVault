/*
 * ===========================================================================
 * SKY-ID-KOLLISIONEN UNTERSUCHEN — REIN LESEND
 *
 * Die Frage, die diese Datei beantwortet: darf eine auf Production neu
 * angelegte Figur, deren SKY-ID auch auf Staging vergeben wurde, geloescht
 * und durch die Staging-Fassung ersetzt werden — oder ist die Umnummerierung
 * auf Staging der sicherere Weg?
 *
 * SIE SCHREIBT NICHTS. Kein `insert`, kein `update`, kein `delete`, kein
 * `upsert`, kein `rpc`. `src/lib/catalog/sync-collision.test.ts` misst das am
 * Quelltext dieser Datei, nicht an ihrem Verhalten — eine Zusicherung, die
 * man lesen kann, ohne sie laufen zu lassen.
 *
 * SIE ZIEHT KEINE SKY-ID. Kein `nextval`, kein Anlegen, kein Entwurf.
 *
 * Riegel 1: jede Verbindung muss das Projekt nennen, das die jeweilige
 * `.env`-Datei nennt — sonst Abbruch, bevor gelesen wird.
 *
 * WAS „PERSONENBEZOGEN" HIER HEISST: aus Sammlungen, Favoriten, Warenkoerben
 * und Verfuegbarkeitswuenschen wird NUR GEZAEHLT. Keine `user_id`, keine
 * Adresse, keine Bestelldaten verlassen die Datenbank — CLAUDE.md Regel 3.
 * Der Bericht landet in `resources/analysis/`, und das ist gitignoriert.
 * ===========================================================================
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { PINNED_REFS, pinnedEnvFile } from "./lib/staging-guard.mts";
import { writeFileSync } from "node:fs";

const STAGING_REF = PINNED_REFS.staging;
const PRODUCTION_REF = PINNED_REFS.production;
const BERICHT = "resources/analysis/SYNC-18-kollisionen.md";

type Zeile = Record<string, unknown>;

/*
 * JEDER WEG, AUF DEM EINE ZEILE AN EINER FIGUR HAENGT.
 *
 * `loeschen` ist das, was PostgreSQL bei `delete from skylanders` TAETE —
 * aus den Migrationen abgelesen, nicht geraten. Es ist die wichtigste Spalte
 * der Tabelle: `restrict` blockiert das Loeschen und ist damit harmlos,
 * `cascade` nimmt die Zeile STILL mit, und `(kein FK)` heisst, dass
 * PostgreSQL ueberhaupt nicht hinsieht.
 */
const BEZUEGE = [
  { t: "collection_items",           s: "sky_id",      loeschen: "restrict",  was: "Sammlungen",                    privat: true,  quelle: "0001" },
  { t: "favorites",                  s: "sky_id",      loeschen: "restrict",  was: "Favoriten",                     privat: true,  quelle: "0145" },
  { t: "cart_items",                 s: "sky_id",      loeschen: "CASCADE",   was: "Warenkoerbe",                   privat: true,  quelle: "0022" },
  { t: "availability_alerts",        s: "sky_id",      loeschen: "restrict",  was: "Verfuegbarkeitswuensche",       privat: true,  quelle: "0150" },
  { t: "availability_notifications", s: "sky_id",      loeschen: "restrict",  was: "Verfuegbarkeitsmails",          privat: true,  quelle: "0148" },
  { t: "shop_inventory",             s: "sky_id",      loeschen: "restrict",  was: "Lager",                         privat: false, quelle: "0003" },
  { t: "offer_state",                s: "sky_id",      loeschen: "restrict",  was: "Angebotszustand",               privat: false, quelle: "0146" },
  { t: "purchase_items",             s: "sky_id",      loeschen: "restrict",  was: "Einkaufspositionen (Orderbuch)", privat: false, quelle: "0053" },
  { t: "sale_items",                 s: "sky_id",      loeschen: "NO ACTION", was: "Verkaufspositionen (Orderbuch)", privat: false, quelle: "0059" },
  { t: "legacy_stock_events",        s: "sky_id",      loeschen: "restrict",  was: "Legacy-Lagerereignisse",        privat: false, quelle: "0079" },
  { t: "inventory_import_rows",      s: "sky_id",      loeschen: "restrict",  was: "Lagerimport-Zeilen",            privat: false, quelle: "0048" },
  { t: "inventory_import_mappings",  s: "sky_id",      loeschen: "CASCADE",   was: "Lagerimport-Zuordnungen",       privat: false, quelle: "0048" },
  { t: "orderbook_name_mappings",    s: "sky_id",      loeschen: "CASCADE",   was: "Orderbuch-Namenszuordnungen",   privat: false, quelle: "0054" },
  { t: "catalog_editorial",          s: "sky_id",      loeschen: "CASCADE",   was: "redaktionelle Notizen",         privat: false, quelle: "0004" },
  { t: "skylanders",                 s: "base_sky_id", loeschen: "restrict",  was: "Varianten (base_sky_id)",       privat: false, quelle: "0159" },
  /*
   * DER EINE OHNE FREMDSCHLUESSEL, UND DER GEFAEHRLICHSTE.
   *
   * `order_lines.sky_id` ist `text not null` ohne FK — absichtlich (0010):
   * „the line remembers what was sold, not what that article is called
   * today". Ein Loeschen der Figur wird hier also NICHT blockiert, und die
   * Bestellposition zeigt danach auf eine SKY-ID, die etwas ANDERES
   * bedeutet. Der Name selbst ist in `name_snapshot` eingefroren und
   * ueberlebt; die Identitaet dahinter nicht.
   */
  { t: "order_lines",                s: "sky_id",      loeschen: "(kein FK)", was: "Bestellpositionen (Kundenbestellungen)", privat: true, quelle: "0010" },
] as const;

/*
 * ZWEI HELFER, DAMIT `null` NIRGENDS ZU EINER NULL WIRD.
 *
 * `(x.anzahl ?? 0) > 0` sieht harmlos aus und ist genau der Fehler, der am
 * 2026-10-30 eine nicht existierende Tabelle als „0 Verweise" gemeldet hat:
 * unbekannt und leer sind damit dasselbe. Hier sind sie es nicht.
 */
/** Wahr nur bei einem GEMESSENEN Wert groesser null. */
const belegt = (x: { anzahl: number | null }) => x.anzahl !== null && x.anzahl > 0;

/**
 * Die Summe — oder `null`, wenn irgendein Pfad UNBESTIMMT ist.
 *
 * Ein Pfad mit dem Zustand `fehlt` zaehlt mit 0 mit, und das ist richtig: zu
 * einer Tabelle, die es nicht gibt, kann keine Zeile gehoeren. Der
 * Unterschied zu `unbestimmt` ist der ganze Punkt — dort WEISS man es nicht,
 * und dann gibt es keine Summe.
 */
const summeOderNull = (xs: { anzahl: number | null }[]): number | null =>
  xs.some((x) => x.anzahl === null) ? null : xs.reduce((a, x) => a + (x.anzahl as number), 0);

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

/**
 * Zaehlt, ohne eine Zeile zu holen — `head: true` schickt kein Ergebnis
 * zurueck, nur die Anzahl. Genau deshalb steht es hier: eine Sammlung oder
 * ein Warenkorb wird gezaehlt und nicht gelesen.
 *
 * *** DIE FALLE, DIE DIESE FUNKTION AM 2026-10-30 GESTELLT HAT ***
 *
 * Eine erste Fassung endete mit `return { anzahl: count ?? 0 }`. Das war
 * falsch, und zwar auf die gefaehrlichste denkbare Weise: PostgREST
 * antwortet auf eine HEAD-Anfrage an eine NICHT EXISTIERENDE Tabelle mit
 * **204 und ohne Fehler** — kein `error`, kein `Content-Range`, also
 * `count === null`. Das `?? 0` machte daraus eine Null, und der Bericht
 * meldete „0 Verweise" fuer eine Tabelle, die es gar nicht gibt.
 *
 * Gemessen, nicht vermutet:
 *
 *     head: true              -> 204, error null, count null
 *     ohne head               -> 404, PGRST205 "Could not find the table"
 *
 * `availability_alerts` (Migration `0150`, nirgends angewendet) ist auf
 * beiden Umgebungen so durchgelaufen. Aufgefallen ist es erst, als der
 * SQL-Preflight dieselbe Tabelle mit `42P01` abgewiesen hat — PostgreSQL
 * luegt bei einer unbekannten Relation nicht.
 *
 * Deshalb zwei Schritte statt einem: ein lesender Tastversuch OHNE `head`,
 * der eine fehlende Tabelle als Fehler liefert, und erst danach die
 * Zaehlung. `limit(0)` holt dabei keine Zeile — die Privatheit der
 * personenbezogenen Tabellen bleibt gewahrt.
 *
 * `null` heisst ab jetzt UNBESTIMMT und wird nirgends zu einer Null.
 */
async function zaehle(db: SupabaseClient, tabelle: string, spalte: string, wert: string) {
  // 1. Gibt es die Tabelle? Ohne `head` antwortet PostgREST ehrlich.
  const tast = await db.from(tabelle).select(spalte).limit(0);
  if (tast.error) {
    /*
     * PGRST205 heisst: die Tabelle ist nicht da. Dann KANN keine Zeile auf
     * die Figur zeigen, und 0 ist die richtige Antwort — aber eine, die der
     * Bericht AUSSPRICHT. Jeder andere Fehler bleibt unbestimmt.
     */
    const fehlt = tast.error.code === "PGRST205";
    return { anzahl: fehlt ? 0 : null, zustand: fehlt ? "fehlt" : "unbestimmt",
             fehler: `${tast.error.code ?? "?"}: ${tast.error.message}` } as const;
  }
  // 2. Erst jetzt zaehlen, und zwar ohne eine Zeile zu holen.
  const { count, error } = await db.from(tabelle)
    .select(spalte, { count: "exact", head: true }).eq(spalte, wert);
  if (error) {
    return { anzahl: null, zustand: "unbestimmt", fehler: error.message } as const;
  }
  if (count === null) {
    return { anzahl: null, zustand: "unbestimmt",
             fehler: "kein Zaehlstand (204 ohne Content-Range)" } as const;
  }
  return { anzahl: count, zustand: "gezaehlt", fehler: null } as const;
}

/* ------------------------------------------------------------------- Lauf */

const S = verbinde(".env.staging", STAGING_REF, "Staging");
const P = verbinde(".env.local", PRODUCTION_REF, "Production");
console.log("  Riegel 1 ok — Staging und Production, beide an der erwarteten Kennung\n");

const FELDER = "sky_id,name,slug,series_code,category_id,image_file,is_active,"
  + "character_id,catalog_visible,display_name_override,image_override_path,card_type,"
  + "source,item_type,usk_rating,catalog_status,base_sky_id,created_at,updated_at";

const sRows = await alle(S, "skylanders", FELDER, "sky_id");
const pRows = await alle(P, "skylanders", FELDER, "sky_id");
const sM = new Map(sRows.map((r) => [r.sky_id as string, r]));
const pM = new Map(pRows.map((r) => [r.sky_id as string, r]));
console.log(`  gelesen: Staging ${sRows.length} Zeilen, Production ${pRows.length} Zeilen\n`);

/*
 * DREI SICHTEN AUF „KOLLISION", WEIL DIE ENGE ALLEIN NICHT GENUEGT.
 *
 * Der Dry-Run nimmt die enge: Name UND Slug verschieden. Das ist die
 * Definition, mit der er 682 Schritte geplant hat, und sie liefert
 * SKY-0821. Eine Kollision, bei der nur der Name abweicht und der Slug
 * zufaellig gleich blieb, faellt dort aber durch. Der Auftrag lautet „alle
 * Kollisionen", also wird hier auch die weite Sicht gemessen.
 */
const gemeinsam = [...sM.keys()].filter((id) => pM.has(id));
/*
 * DIE EINORDNUNG, DIE DEN BERICHT TRAEGT.
 *
 * Eine IDENTITAETSKOLLISION ist eine SKY-ID, hinter der in den beiden
 * Umgebungen VERSCHIEDENE SACHEN stehen — anderer Slug, anderes Bild oder
 * andere Serie. Nur sie ist ein Konflikt um eine Identitaet.
 *
 * Eine NAMENSABWEICHUNG ist dieselbe Figur mit einem anderen Namen: Slug,
 * Bild und Serie stimmen. Das sind die Faelle aus SYNC-02, und sie sind
 * KEINE Kollision — hier ist nichts zu loeschen, hier ist ein Feld zu
 * setzen.
 */
const identitaet = gemeinsam.filter((id) => {
  const a = sM.get(id)!; const b = pM.get(id)!;
  return a.slug !== b.slug || (a.image_file ?? null) !== (b.image_file ?? null)
    || a.series_code !== b.series_code;
});
const eng = gemeinsam.filter((id) =>
  sM.get(id)!.name !== pM.get(id)!.name && sM.get(id)!.slug !== pM.get(id)!.slug);
const weit = gemeinsam.filter((id) =>
  sM.get(id)!.name !== pM.get(id)!.name || sM.get(id)!.slug !== pM.get(id)!.slug);

console.log(`  gemeinsame SKY-IDs: ${gemeinsam.length}`);
console.log(`  eng  (Name UND Slug verschieden): ${eng.length} — ${eng.join(", ") || "keine"}`);
console.log(`  weit (Name ODER Slug verschieden): ${weit.length}`);
console.log(`  davon ECHTE Identitaetskollisionen: ${identitaet.length} — ${identitaet.join(", ") || "keine"}`);
console.log(`  davon blosse Namensabweichungen: ${weit.filter((x) => !identitaet.includes(x)).length}\n`);

/* --------------------------------------------------- je Kandidat pruefen */

type Befund = {
  sky_id: string;
  p: Zeile; s: Zeile;
  bezuege: { was: string; tabelle: string; spalte: string; loeschen: string;
             anzahl: number | null; zustand: string; fehler: string | null;
             privat: boolean; quelle: string }[];
  /** Dieselben Pfade auf STAGING — fuer die Frage, was eine Umnummerierung DORT kostet. */
  bezuegeS: { was: string; tabelle: string; anzahl: number | null }[];
  journalS: Zeile[];
  journal: Zeile[];
  bildGeteiltP: number; overrideGeteiltP: number;
  gleicherNameP: string[]; gleicherSlugP: string[];
  stagingFigurInP: string[];
};

const befunde: Befund[] = [];

/*
 * UNTERSUCHT WIRD DIE VEREINIGUNG, NICHT `weit`.
 *
 * Eine erste Fassung lief nur ueber `weit` (Name oder Slug verschieden) und
 * liess damit genau die Faelle liegen, in denen Name UND Slug gleich sind und
 * nur Bild oder Serie abweichen — SKY-9998 ist so einer. Wer nach
 * Identitaeten fragt, darf nicht nach Namen filtern.
 */
const kandidaten = [...new Set([...weit, ...identitaet])].sort();

for (const id of kandidaten) {
  const p = pM.get(id)!; const s = sM.get(id)!;
  process.stdout.write(`  ${id} … `);

  const bezuege: Befund["bezuege"] = [];
  for (const b of BEZUEGE) {
    const r = await zaehle(P, b.t, b.s, id);
    bezuege.push({ was: b.was, tabelle: b.t, spalte: b.s, loeschen: b.loeschen,
      anzahl: r.anzahl, zustand: r.zustand, fehler: r.fehler,
      privat: b.privat, quelle: b.quelle });
  }

  /*
   * DIE ANDERE SEITE DER WAAGE.
   *
   * Eine „Umnummerierung auf Staging" ist KEIN `update`: die SKY-ID ist
   * durch `skylanders_sky_id_immutable` (0001) auch fuer die Service-Rolle
   * unveraenderlich. Sie ist also dasselbe Paar Handgriffe wie ein Ersetzen
   * auf Production — anlegen und loeschen —, nur in der anderen Umgebung.
   * Was dort an der Figur haengt, entscheidet, welche der beiden billiger
   * ist, und deshalb wird es hier mitgemessen.
   */
  const bezuegeS: Befund["bezuegeS"] = [];
  for (const b of BEZUEGE) {
    const r = await zaehle(S, b.t, b.s, id);
    bezuegeS.push({ was: b.was, tabelle: `${b.t}.${b.s}`, anzahl: r.anzahl });
  }
  const { data: jsd } = await S.from("catalog_admin_changes")
    .select("field,old_value,new_value,changed_at")
    .eq("entity", "skylander").eq("entity_id", id).order("changed_at");
  const journalS = (jsd ?? []) as Zeile[];

  // Das Journal — nur Feld, Werte und Zeitpunkt. KEIN `changed_by`.
  const { data: jd, error: je } = await P.from("catalog_admin_changes")
    .select("field,old_value,new_value,changed_at")
    .eq("entity", "skylander").eq("entity_id", id).order("changed_at");
  const journal = (je ? [{ fehler: je.message }] : (jd ?? [])) as Zeile[];

  // Teilt die Figur ihr Bild mit anderen Zeilen? Dann haengt an der Datei mehr.
  const bildGeteiltP = p.image_file
    ? pRows.filter((r) => r.image_file === p.image_file && r.sky_id !== id).length : 0;
  const overrideGeteiltP = p.image_override_path
    ? pRows.filter((r) => r.image_override_path === p.image_override_path && r.sky_id !== id).length : 0;

  // Gibt es die Production-Figur fachlich schon unter einer anderen SKY-ID?
  const gleicherNameP = pRows.filter((r) => r.name === p.name && r.sky_id !== id)
    .map((r) => r.sky_id as string);
  const gleicherSlugP = pRows.filter((r) => r.slug === p.slug && r.sky_id !== id)
    .map((r) => r.sky_id as string);

  // Und steht die STAGING-Figur auf Production vielleicht schon anderswo?
  const stagingFigurInP = pRows
    .filter((r) => (r.name === s.name || r.slug === s.slug) && r.sky_id !== id)
    .map((r) => `${r.sky_id as string} (${r.name as string})`);

  befunde.push({ sky_id: id, p, s, bezuege, bezuegeS, journal, journalS,
    bildGeteiltP, overrideGeteiltP, gleicherNameP, gleicherSlugP, stagingFigurInP });
  console.log("geprueft");
}

/* ---------------------------------------------------------------- Bericht */

const t = (v: unknown) => v === null || v === undefined ? "—" : String(v);
const z = (b: Befund["bezuege"][number]) =>
  b.zustand === "fehlt" ? "— Tabelle fehlt"
  : b.zustand === "unbestimmt" ? `**UNBESTIMMT** (${b.fehler})`
  : b.anzahl === 0 ? "0" : `**${b.anzahl}**`;

let md = `# SYNC-18 — die SKY-ID-Kollisionen, lesend untersucht

**Erzeugt ${new Date().toISOString()} von \`npm run catalog:collisions\`.**
**Dieser Lauf hat nichts geschrieben** — kein \`insert\`, \`update\`, \`delete\`,
\`upsert\` oder \`rpc\`, und keine SKY-ID gezogen. Aus Sammlungen, Favoriten,
Warenkoerben, Verfuegbarkeitswuenschen und Bestellpositionen wurde **nur
gezaehlt**; keine \`user_id\` hat die Datenbank verlassen.

## Der Kollisionsbestand

| | |
|---|---:|
| SKY-IDs in beiden Umgebungen | ${gemeinsam.length} |
| davon mit abweichendem Namen **oder** Slug | ${weit.length} |
| **davon echte Identitaetskollisionen** (Slug, Bild oder Serie verschieden) | **${identitaet.length}** |
| davon blosse Namensabweichungen (SYNC-02, dieselbe Figur) | ${weit.filter((x) => !identitaet.includes(x)).length} |
| Definition des Dry-Runs (Name UND Slug verschieden) | ${eng.length} |

**Die echten Kollisionen: ${identitaet.join(", ") || "keine"}.**

Die ${weit.filter((x) => !identitaet.includes(x)).length} uebrigen Faelle sind
**keine Kollisionen**: dort stimmen Slug, Bild und Serie, und nur der Name weicht
ab. Das sind die Namensabweichungen aus SYNC-02 — zu entscheiden ist dort ein
Feld, nicht eine Identitaet. Niemand muss dafuer etwas loeschen.

${eng.length === identitaet.length
  ? `Riegel 3 des Dry-Runs faengt ${eng.length} davon.`
  : `**Riegel 3 des Dry-Runs faengt nur ${eng.length} der ${identitaet.length}.**
Uebersehen: ${identitaet.filter((x) => !eng.includes(x)).join(", ")}. Seine
Definition verlangt Name UND Slug verschieden; wo der Name gleich blieb, laesst er
durch. Fuer eine SKY-ID im reservierten Bereich ab SKY-9000 ist das harmlos, weil
der Abgleich sie ohnehin ausschliesst — als Riegel ist es trotzdem zu eng.`}

`;

for (const b of befunde) {
  const blockiert = b.bezuege.filter((x) => belegt(x) && x.loeschen === "restrict");
  const still = b.bezuege.filter((x) => belegt(x)
    && (x.loeschen === "CASCADE" || x.loeschen === "(kein FK)"));
  /*
   * UNBESTIMMT IST NICHT NULL. Steht irgendein Pfad auf `null`, gibt es keine
   * Summe — und der Bericht sagt das, statt eine zu erfinden.
   */
  const unbestimmt = b.bezuege.filter((x) => x.zustand === "unbestimmt");
  const fehlend = b.bezuege.filter((x) => x.zustand === "fehlt");
  const summe: number | null = summeOderNull(b.bezuege);

  md += `---

## ${b.sky_id}

| | Production | Staging |
|---|---|---|
| \`name\` | \`${t(b.p.name)}\` | \`${t(b.s.name)}\` |
| \`slug\` | \`${t(b.p.slug)}\` | \`${t(b.s.slug)}\` |
| \`series_code\` | ${t(b.p.series_code)} | ${t(b.s.series_code)} |
| \`catalog_status\` | ${t(b.p.catalog_status)} | ${t(b.s.catalog_status)} |
| \`catalog_visible\` | ${t(b.p.catalog_visible)} | ${t(b.s.catalog_visible)} |
| \`is_active\` | ${t(b.p.is_active)} | ${t(b.s.is_active)} |
| \`source\` | ${t(b.p.source)} | ${t(b.s.source)} |
| \`item_type\` | ${t(b.p.item_type)} | ${t(b.s.item_type)} |
| \`card_type\` | ${t(b.p.card_type)} | ${t(b.s.card_type)} |
| \`image_file\` | ${t(b.p.image_file)} | ${t(b.s.image_file)} |
| \`image_override_path\` | ${t(b.p.image_override_path)} | ${t(b.s.image_override_path)} |
| \`display_name_override\` | ${t(b.p.display_name_override)} | ${t(b.s.display_name_override)} |
| \`base_sky_id\` | ${t(b.p.base_sky_id)} | ${t(b.s.base_sky_id)} |
| \`character_id\` | ${t(b.p.character_id)} | ${t(b.s.character_id)} |
| \`created_at\` | ${t(b.p.created_at)} | ${t(b.s.created_at)} |
| \`updated_at\` | ${t(b.p.updated_at)} | ${t(b.s.updated_at)} |

### Was auf Production an \`${b.sky_id}\` haengt

| Was | Tabelle.Spalte | bei \`delete\` | Zeilen | Quelle |
|---|---|---|---:|---|
${b.bezuege.map((x) => `| ${x.was}${x.privat ? " ·" : ""} | \`${x.tabelle}.${x.spalte}\` | ${x.loeschen} | ${z(x)} | ${x.quelle} |`).join("\n")}
| | | | **${summe === null ? `UNBESTIMMT (${unbestimmt.length} Pfad(e))` : summe}** | |

\`·\` = personenbezogen, nur gezaehlt.

${summe === null
  ? `**DIESE FIGUR IST NICHT BEURTEILT.** ${unbestimmt.length} von ${b.bezuege.length}
Pfaden haben keinen Zaehlstand geliefert: ${unbestimmt.map((x) => `\`${x.tabelle}\` (${x.fehler})`).join(", ")}.
Ein fehlender Pfad gilt NICHT als leer. Erst klaeren, ob die Tabelle existiert —
\`supabase/checks/sky_id_reference_paths.sql\` liest die Pfade aus dem Katalog.`
  : summe === 0
  ? `**Keine einzige Zeile zeigt auf diese Figur.**${fehlend.length > 0
      ? ` ${fehlend.length} der ${b.bezuege.length} Pfade existieren in dieser
Umgebung nicht (${fehlend.map((x) => `\`${x.tabelle}\` aus ${x.quelle}`).join(", ")}) —
zu einer Tabelle, die es nicht gibt, kann keine Zeile gehoeren, und das ist
ausgesprochen statt unterstellt.` : ""} Sie ist in allen
${b.bezuege.length} Pfaden unbenutzt — Sammlung, Favorit, Lager, Lagerbewegung
(ueber \`shop_inventory\`), Angebot, Warenkorb, Bestellposition, Orderbuch,
Import, Variante und redaktionelle Notiz.`
  : `**${blockiert.length > 0
      ? `Ein \`delete\` wuerde ABGEWIESEN` : `Ein \`delete\` wuerde DURCHGEHEN`}.**
${blockiert.length > 0 ? `\`on delete restrict\` greift bei: ${blockiert.map((x) => `${x.tabelle} (${x.anzahl})`).join(", ")}.` : ""}
${still.length > 0 ? `\n**STILL MITGENOMMEN bzw. ungeprueft:** ${still.map((x) => `${x.tabelle} (${x.anzahl}, ${x.loeschen})`).join(", ")}.` : ""}`}

### Was auf STAGING an \`${b.sky_id}\` haengt

Die andere Seite der Waage: eine Umnummerierung auf Staging ist **kein
\`update\`** — \`skylanders_sky_id_immutable\` (0001) haelt die SKY-ID auch
gegen die Service-Rolle fest. Sie ist dasselbe Paar Handgriffe wie ein Ersetzen
auf Production, nur in der anderen Umgebung.

${b.bezuegeS.filter(belegt).length === 0
  ? `**Auch hier zeigt keine Zeile auf die Figur** — alle ${b.bezuegeS.length} Pfade sind leer.`
  : `| Was | Tabelle.Spalte | Zeilen |
|---|---|---:|
${b.bezuegeS.filter(belegt).map((x) => `| ${x.was} | \`${x.tabelle}\` | **${x.anzahl}** |`).join("\n")}`}

Journal auf Staging: ${b.journalS.length} Zeile(n)${b.journalS.length ? ` — ${b.journalS.map((j) => t(j.field)).join(", ")}` : ""}.

### Aenderungsjournal und Erstellhistorie

${b.journal.length === 0
  ? `**Keine Journalzeile.** \`catalog_admin_changes\` kennt \`${b.sky_id}\` nicht —
an dieser Figur ist auf Production nie eine redaktionelle Entscheidung getroffen
worden. Sie entstand mit \`created_at = ${t(b.p.created_at)}\` und ist seither
${b.p.created_at === b.p.updated_at ? "**nicht mehr angefasst** worden (`created_at` = `updated_at`)." : `am ${t(b.p.updated_at)} veraendert worden.`}`
  : `${b.journal.length} Zeile(n):

| Feld | alt | neu | wann |
|---|---|---|---|
${b.journal.map((j) => `| ${t(j.field)} | ${t(j.old_value)} | ${t(j.new_value)} | ${t(j.changed_at)} |`).join("\n")}

\`created_at = ${t(b.p.created_at)}\`, \`updated_at = ${t(b.p.updated_at)}\`.`}

### Bilder

| | |
|---|---|
| \`image_file\` | \`${t(b.p.image_file)}\` — von ${b.bildGeteiltP} weiteren Production-Zeilen mitbenutzt |
| \`image_override_path\` | \`${t(b.p.image_override_path)}\` — von ${b.overrideGeteiltP} weiteren mitbenutzt |

${b.bildGeteiltP > 0 || b.overrideGeteiltP > 0
  ? `**Geteilte Bildreferenz.** Die Datei gehoert nicht dieser Figur allein; sie
darf beim Ersetzen nicht entfernt werden.`
  : `Keine geteilte Bildreferenz.`}

### Besteht die Figur fachlich schon unter einer anderen SKY-ID?

| | |
|---|---|
| gleicher \`name\` auf Production | ${b.gleicherNameP.length ? b.gleicherNameP.join(", ") : "nein"} |
| gleicher \`slug\` auf Production | ${b.gleicherSlugP.length ? b.gleicherSlugP.join(", ") : "nein"} |
| die **Staging**-Figur auf Production (nach Name/Slug) | ${b.stagingFigurInP.length ? b.stagingFigurInP.join(", ") : "nein — sie fehlt dort wirklich"} |

`;
}

/* ------------------------------------------------- Die Entscheidungstabelle */

/*
 * SIE WIRD GERECHNET, NICHT GETIPPT.
 *
 * Verlustgefahr und Empfehlung folgen aus den gemessenen Zahlen, damit ein
 * zweiter Lauf nach einer Datenaenderung eine ANDERE Empfehlung liefern kann
 * statt derselben hingeschriebenen.
 */
const ausgeschlossenVomAbgleich = (id: string) => id >= "SKY-9000";

let tabelle = "";
for (const id of identitaet) {
  const b = befunde.find((x) => x.sky_id === id)!;
  const offenP = b.bezuege.filter((x) => x.anzahl === null).length;
  const offenS = b.bezuegeS.filter((x) => x.anzahl === null).length;
  const refP = summeOderNull(b.bezuege);
  const refS = summeOderNull(b.bezuegeS);
  const hatOverride = Boolean(b.p.image_override_path);

  let gefahr: string; let empfehlung: string;
  if (offenP > 0 || offenS > 0) {
    // Erst die Beurteilbarkeit, dann die Beurteilung.
    gefahr = `**unbekannt** — ${offenP + offenS} Pfad(e) ohne Zaehlstand`;
    empfehlung = "**nichts entscheiden.** Erst die fehlenden Pfade klaeren";
  } else if (ausgeschlossenVomAbgleich(id)) {
    gefahr = "**keine** — liegt ab SKY-9000 und ist vom Abgleich ausgeschlossen";
    empfehlung = "**nichts tun.** Keine Kollision, die der Sync je sieht";
  } else if ((refP ?? 0) > 0) {
    gefahr = `**hoch** — ${refP} Zeile(n) zeigen auf die Production-Figur`;
    empfehlung = "**nicht ersetzen.** Auf Staging umnummerieren";
  } else {
    // Unbenutzt auf beiden Seiten. Dann entscheidet, was beim Ersetzen
    // NEBEN der Zeile noch mitwandern muesste.
    gefahr = `**mittel** — unbenutzt (0 Referenzen), aber ein eigenstaendiger, `
      + `kuratierter Katalogeintrag mit ${b.journal.length} Journalzeile(n)`
      + (hatOverride ? " und einem eigenen Bildobjekt" : "");
    empfehlung = refS === 0
      ? "**auf Staging umnummerieren.** Billiger und ohne Production-Schreibzugriff"
      : `**Einzelfall** — auf Staging haengen ${refS} Zeile(n)`;
  }

  tabelle += `| \`${id}\` | ${t(b.p.name)} (${t(b.p.series_code)}, ${t(b.p.catalog_status)}) `
    + `| ${t(b.s.name)} (${t(b.s.series_code)}, ${t(b.s.catalog_status)}) `
    + `| P: **${refP}** · S: **${refS}** `
    + `| P: ${b.journal.length} Journalzeile(n) · S: ${b.journalS.length} `
    + `| ${gefahr} | ${empfehlung} |\n`;
}

md += `---

# Die Entscheidungstabelle

| SKY-ID | Production-Figur | Staging-Figur | Referenzen | Historie | Verlustgefahr | Empfehlung |
|---|---|---|---|---|---|---|
${tabelle}
*Vollstaendige Rohdaten: \`resources/analysis/sync-collisions.json\`.*
`;

writeFileSync(BERICHT, md);
writeFileSync("resources/analysis/sync-collisions.json", JSON.stringify({
  erzeugt: new Date().toISOString(), schreibt_nichts: true,
  gemeinsam: gemeinsam.length, eng, weit, identitaet, kandidaten, befunde,
}, null, 1));

console.log(`\n  geschrieben: ${BERICHT}`);
console.log(`  geschrieben: resources/analysis/sync-collisions.json\n`);
