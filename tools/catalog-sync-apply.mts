/**
 * DER APPLY-PFAD DES KATALOGABGLEICHS.
 *
 *   npm run catalog:sync:apply -- --target=staging
 *   npm run catalog:sync:apply -- --target=staging    --apply
 *   npm run catalog:sync:apply -- --target=production --apply --confirm-production
 *
 * ===========================================================================
 * OHNE `--apply` SCHREIBT ER NICHTS. Das ist der Vorgabewert, nicht eine
 * Einstellung: der Schalter heisst `--apply`, und ohne ihn laeuft derselbe
 * Code bis unmittelbar vor jede Anweisung und sagt, was er schriebe.
 * ===========================================================================
 *
 * WARUM EINE EIGENE DATEI UND NICHT EIN MODUS IN `catalog-sync.mts`
 *
 * Weil `src/lib/catalog/sync-plan.test.ts` am Quelltext festnagelt, dass der
 * Dry-Run KEIN `.insert(`, `.update(`, `.rpc(` und kein `signInWithPassword`
 * enthaelt. Diese Zusage ist mehr wert als die Bequemlichkeit eines
 * gemeinsamen Rumpfes. Der Plan bleibt beweisbar schreibfrei; das Schreiben
 * steht hier, sichtbar getrennt.
 *
 * ZWEI VERBINDUNGEN (SYNC-09 §1.2)
 *
 *   R  Service-Role   — liest alles, schreibt Klasse A und C, legt Figuren an
 *   W  Adminsitzung   — ausschliesslich die vier atomaren `admin_set_*`-RPCs
 *
 * Das Passwort kommt aus der macOS-Keychain oder aus einer verdeckten
 * Eingabe. Es steht nie in einer Datei, nie in `argv`, nie im Protokoll.
 *
 * DIE DREI TORE (SYNC-06 §3)
 *
 *   1  Der Plan hat eine Haltbarkeit. Vor dem ersten Schreibvorgang werden
 *      die Fingerprints beider Umgebungen gegen den Plan gemessen.
 *   2  Compare-and-Set je Zeile, IN der schreibenden Anweisung.
 *   3  Postflight misst nach, statt zu glauben.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { charakterRiegel, RANG } from "../src/lib/catalog/sync-character-gate.ts";
import { createInterface } from "node:readline";

const STAGING_REF = "qqxcpesbwfxzgytkdsac";
const PRODUCTION_REF = "zmiwxswrpkmizvqsgype";
const PLAN = "resources/analysis/sync-dryrun.json";
/*
 * ZWEI KONTEN, ZWEI DIENSTE — EINS JE UMGEBUNG.
 *
 * Bis zum 2026-10-31 gab es EINE Variable `SKYISLES_SYNC_ADMIN` und EINEN
 * Keychain-Dienst fuer beide Umgebungen. Das war falsch, und zwar nicht nur
 * unsauber: die beiden Plattformadmin-Konten existieren jeweils NUR in ihrer
 * eigenen Umgebung (am 2026-10-31 gemessen). Ein Lauf gegen Production mit
 * der Staging-Adresse haette also nicht etwa das falsche Konto benutzt — er
 * waere an `Invalid login credentials` gescheitert, und zwar erst mitten im
 * Lauf.
 *
 * Die Zuordnung steht hier und nirgends sonst. Das PASSWORT steht nirgends:
 * es kommt aus der Keychain oder aus verdeckter Eingabe.
 */
const ADMIN_KONTO: Record<"staging" | "production", { variable: string; dienst: string }> = {
  staging: {
    variable: "SKYISLES_SYNC_ADMIN_STAGING",
    dienst: "skyisles-sync-admin-staging",
  },
  production: {
    variable: "SKYISLES_SYNC_ADMIN_PRODUCTION",
    dienst: "skyisles-sync-admin-production",
  },
};

/* ------------------------------------------------------------- Schalter */

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const flag = (n: string) => process.argv.includes(`--${n}`);
const ZIEL = arg("target") as "staging" | "production" | undefined;
const APPLY = flag("apply");

function abbruch(warum: string): never {
  console.error(`\n  ABBRUCH.\n\n  ${warum}\n`);
  process.exit(1);
}

if (ZIEL !== "staging" && ZIEL !== "production") {
  abbruch("--target=staging oder --target=production fehlt.");
}
if (APPLY && ZIEL === "production" && !flag("confirm-production")) {
  abbruch("Schreiben auf PRODUCTION verlangt --confirm-production zusaetzlich zu --apply.");
}

/* --------------------------------------------------- Verbindungen und Pfade */

type Zeile = Record<string, unknown>;
type Schritt = {
  ziel: string; art: string; sky_id: string; feld?: string; klasse?: string;
  von?: string; nach?: string; weg: string; grund: string;
};

/** Die EINZIGEN Felder, die dieses Werkzeug schreiben darf. */
const ERLAUBT_A = ["catalog_status", "catalog_visible", "display_name_override",
                   "image_override_path", "card_type"] as const;
const ERLAUBT_C = ["series_code", "category_id", "name", "slug", "item_type",
                   "is_active", "visible_type_decided", "image_file", "source",
                   "usk_rating"] as const;
/** Klasse B geht NIE ueber ein `update`, sondern immer ueber ihre RPC. */
const RPC_B: Record<string, { fn: string; arg: string }> = {
  types:        { fn: "admin_set_figure_types", arg: "p_types" },
  visible_type: { fn: "admin_set_visible_type", arg: "p_type" },
  familie:      { fn: "admin_set_character",    arg: "p_character_id" },
  base_sky_id:  { fn: "admin_set_variant_base", arg: "p_base_sky_id" },
};

function envDatei(pfad: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const z of readFileSync(pfad, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(z.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const ENV = ZIEL === "staging"
  ? { datei: ".env.staging", ref: STAGING_REF }
  : { datei: ".env.local", ref: PRODUCTION_REF };

function serviceClient(datei: string, ref: string): SupabaseClient {
  const e = envDatei(datei);
  if (!String(e.NEXT_PUBLIC_SUPABASE_URL).includes(ref)) {
    abbruch(`TOR 0 — ${datei} nennt nicht das Projekt ${ref}.`);
  }
  return createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * Das Passwort des Sync-Kontos — Keychain zuerst, sonst verdeckte Eingabe.
 * NIE aus `argv`, NIE aus einer Datei im Repository, NIE ins Protokoll.
 */
async function adminPasswort(konto: string, dienst: string): Promise<string> {
  try {
    return execFileSync("security",
      ["find-generic-password", "-w", "-s", dienst, "-a", konto],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    return await new Promise<string>((loese) => {
      process.stdout.write(`  Passwort fuer ${konto} (verdeckt): `);
      const stdin = process.stdin as NodeJS.ReadStream & { isTTY?: boolean };
      if (stdin.isTTY) stdin.setRawMode?.(true);
      let s = "";
      const auf = (b: Buffer) => {
        const c = b.toString("utf8");
        if (c === "\r" || c === "\n") {
          stdin.setRawMode?.(false); stdin.off("data", auf); rl.close();
          process.stdout.write("\n"); loese(s);
        } else if (c === "\u0003") { process.exit(1); }
        else if (c === "\u007f") { s = s.slice(0, -1); }
        else s += c;
      };
      stdin.on("data", auf);
    });
  }
}

/**
 * Die Adminsitzung — nur fuer die vier RPCs, und am Ende abgemeldet.
 *
 * *** EINE ANMELDUNG IST KEINE BERECHTIGUNG ***
 *
 * Eine erste Fassung prueefte nur, ob `signInWithPassword` ohne Fehler
 * zurueckkam. Das genuegt nicht: ein Konto, das sich anmelden kann, aber
 * nicht in `platform_admins` steht, haette den Lauf begonnen und waere beim
 * ERSTEN der vier RPCs mit `42501 not authorised` gescheitert — mitten im
 * Schreiben.
 *
 * Deshalb wird nach der Anmeldung `is_platform_admin()` aufgerufen. Sie ist
 * `stable`, schreibt nichts und hat `grant execute to authenticated`; eine
 * angemeldete Sitzung darf sie also fragen. Kommt nicht `true` zurueck —
 * oder kommt sie gar nicht zurueck —, bricht der Lauf ab, BEVOR etwas
 * geschrieben ist.
 */
async function adminClient(
  datei: string, ref: string, umgebung: "staging" | "production",
): Promise<SupabaseClient> {
  const e = envDatei(datei);
  const { variable, dienst } = ADMIN_KONTO[umgebung];
  const konto = process.env[variable];
  if (!konto) {
    abbruch(`${variable} (die Adresse des ${umgebung}-Adminkontos) ist nicht gesetzt.`);
  }
  if (!String(e.NEXT_PUBLIC_SUPABASE_URL).includes(ref)) abbruch("falsches Projekt fuer W.");
  const c = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: true } });
  const { error } = await c.auth.signInWithPassword({
    email: konto, password: await adminPasswort(konto, dienst),
  });
  if (error) {
    abbruch(`Adminanmeldung ${umgebung} (${konto}) fehlgeschlagen: ${error.message}`);
  }

  // DIE BERECHTIGUNG, nicht nur die Anmeldung.
  const { data: istAdmin, error: rpcFehler } = await c.rpc("is_platform_admin");
  if (rpcFehler) {
    await c.auth.signOut();
    abbruch(`is_platform_admin() auf ${umgebung} nicht aufrufbar: ${rpcFehler.message}. `
      + "Die Berechtigung ist damit nicht belegt — es wird nichts geschrieben.");
  }
  if (istAdmin !== true) {
    await c.auth.signOut();
    abbruch(`${konto} ist auf ${umgebung} KEIN Plattformadmin `
      + `(is_platform_admin() = ${JSON.stringify(istAdmin)}). `
      + "Die vier RPCs wuerden mit 42501 scheitern.");
  }
  console.log(`  W-Sitzung ${umgebung}: ${konto} — is_platform_admin() = true`);
  return c;
}

/* ------------------------------------------------- Abdruck und Baselines */

const t = (v: unknown): string =>
  v === null || v === undefined ? "~"
  : typeof v === "boolean" ? (v ? "true" : "false")
  : Array.isArray(v) ? (v.length ? [...v].sort().join("+") : "~")
  : String(v);

const FELDER = ["series_code", "kategorie", "name", "slug", "display_name_override",
                "card_type", "item_type", "is_active", "catalog_visible", "catalog_status",
                "base_sky_id", "familie", "types", "visible_type", "visible_type_decided",
                "image_file", "image_override_path", "source", "usk_rating"] as const;

const SKY_SPALTEN =
  "sky_id,name,slug,series_code,category_id,image_file,is_active,character_id,"
  + "catalog_visible,display_name_override,image_override_path,card_type,source,item_type,"
  + "usk_rating,catalog_status,base_sky_id,types,visible_type,visible_type_decided,updated_at";

async function alle(db: SupabaseClient, tab: string, sp: string, nach: string) {
  const z: Zeile[] = [];
  for (let von = 0; ; von += 1000) {
    const { data, error } = await db.from(tab).select(sp).order(nach).range(von, von + 999);
    if (error) throw new Error(`${tab}: ${error.message}`);
    z.push(...(data as unknown as Zeile[]));
    if (!data || data.length < 1000) break;
  }
  return z;
}

async function abdruck(db: SupabaseClient) {
  const sky = await alle(db, "skylanders", SKY_SPALTEN, "sky_id");
  const kat = await alle(db, "categories", "id,series_code,position,name,catalog_group", "id");
  const chr = await alle(db, "characters",
    "id,canonical_name,element,species,role_type,short_description,source_url,source_label,verified_at",
    "canonical_name");
  const kmap = new Map(kat.map((c) => [c.id as number, c]));
  const cmap = new Map(chr.map((c) => [c.id as number, c]));
  const md5 = (zz: string[]) => createHash("md5").update(zz.join("\n")).digest("hex");
  const frei: string[] = []; const aus: string[] = [];
  for (const r of [...sky].sort((a, b) => (a.sky_id as string) < (b.sky_id as string) ? -1 : 1)) {
    const k = kmap.get(r.category_id as number);
    const h = cmap.get(r.character_id as number);
    const v: Zeile = { ...r, kategorie: k ? k.name : null, familie: h ? h.canonical_name : null };
    const raus = ["TEST", "SMOK"].includes(r.series_code as string)
      || (r.sky_id as string) >= "SKY-9000" || r.catalog_status === "draft";
    if (raus) { aus.push(r.sky_id as string); continue; }
    frei.push([r.sky_id, ...FELDER.map((f) => t(v[f]))].join("|"));
  }
  return {
    katalog_freigegeben: { zeilen: frei.length, abdruck: md5(frei) },
    kategorien: {
      zeilen: kat.filter((c) => !["TEST", "SMOK"].includes(c.series_code as string)).length,
      abdruck: md5(kat.filter((c) => !["TEST", "SMOK"].includes(c.series_code as string))
        .sort((a, b) => `${a.series_code}|${a.name}` < `${b.series_code}|${b.name}` ? -1 : 1)
        .map((c) => [c.series_code, c.name, c.position, t(c.catalog_group)].join("|"))),
    },
    charaktere: {
      zeilen: chr.length,
      abdruck: md5([...chr].sort((a, b) =>
        (a.canonical_name as string) < (b.canonical_name as string) ? -1 : 1)
        .map((c) => [c.canonical_name, t(c.element), t(c.species), t(c.role_type),
                     t(c.short_description), t(c.source_url), t(c.source_label),
                     t(c.verified_at)].join("|"))),
    },
    ausgeschlossen: { zeilen: aus.length, abdruck: md5(aus.sort()) },
    _zeilen: new Map(sky.map((r) => [r.sky_id as string, r])),
  };
}

/**
 * Die geschuetzten Tabellen, in zwei Arten (SYNC-04 §5).
 *
 *   A — nur der Betrieb schreibt sie: der Abdruck muss BYTE-IDENTISCH bleiben.
 *   B — Nutzer schreiben sie laufend: jede VORHER vorhandene Zeile muss
 *       unveraendert sein; neue Zeilen sind erlaubt und werden ignoriert.
 */
const ART_A: [string, string][] = [
  ["shop_inventory", "sky_id,condition,quantity,price,is_listed"],
  ["inventory_movements", "id,sky_id,delta,reason"],
  ["orders", "id,order_number,payment_status,fulfillment_status,total_amount"],
  ["order_lines", "order_id,sky_id,condition,quantity,unit_price"],
  ["invoices", "id,invoice_number"],
  ["catalog_editorial", "sky_id,admin_note"],
];
const ART_B: [string, string, string[]][] = [
  ["collection_items", "id,sky_id,quantity,note", ["id"]],
  ["favorites", "user_id,sky_id", ["user_id", "sky_id"]],
];

async function baseline(db: SupabaseClient) {
  const md5 = (zz: string[]) => createHash("md5").update(zz.sort().join("\n")).digest("hex");
  const a: Record<string, { zeilen: number; abdruck: string }> = {};
  for (const [tab, sp] of ART_A) {
    const z = await alle(db, tab, sp, sp.split(",")[0]).catch(() => null);
    a[tab] = z === null
      ? { zeilen: -1, abdruck: "n/v" }
      : { zeilen: z.length, abdruck: md5(z.map((r) => sp.split(",").map((c) => t(r[c])).join("|"))) };
  }
  const b: Record<string, Map<string, string>> = {};
  for (const [tab, sp, pk] of ART_B) {
    const z = await alle(db, tab, sp, pk[0]).catch(() => null);
    b[tab] = new Map(z === null ? []
      : z.map((r) => [pk.map((c) => t(r[c])).join("|"),
                      sp.split(",").map((c) => t(r[c])).join("|")]));
  }
  const { count } = await db.from("catalog_admin_changes")
    .select("*", { count: "exact", head: true });
  return { artA: a, artB: b, journal: count ?? -1 };
}

/* -------------------------------------------------------------- Der Lauf */

const plan = JSON.parse(readFileSync(PLAN, "utf8")) as
  { erzeugt: string; fingerprint_gemessen: Record<string, Zeile>; plan: Schritt[] };
const schritte = plan.plan.filter((s) => s.ziel === ZIEL);

console.log(`\n  Ziel      ${ZIEL} (${ENV.ref})`);
console.log(`  Plan      ${PLAN}, erzeugt ${plan.erzeugt}`);
console.log(`  Modus     ${APPLY ? "APPLY — SCHREIBT" : "Vorschau, schreibt nichts"}`);
console.log(`  Schritte  ${schritte.length}\n`);

const R = serviceClient(ENV.datei, ENV.ref);

/* ---- TOR 1: hat sich seit dem Plan etwas bewegt? ---- */
const jetzt = await abdruck(R);
const soll = plan.fingerprint_gemessen[ZIEL] as Record<string, { zeilen: number; abdruck: string }>;
for (const b of ["katalog_freigegeben", "kategorien", "charaktere", "ausgeschlossen"]) {
  const i = (jetzt as unknown as Record<string, { zeilen: number; abdruck: string }>)[b];
  if (soll[b].zeilen !== i.zeilen || soll[b].abdruck !== i.abdruck) {
    abbruch(`TOR 1 — ${ZIEL}/${b} hat sich seit dem Plan bewegt: `
      + `Plan ${soll[b].zeilen}·${soll[b].abdruck}, jetzt ${i.zeilen}·${i.abdruck}.\n`
      + "  Neu planen: npm run catalog:sync:plan");
  }
}
console.log("  TOR 1 ok — der Plan ist noch gueltig.\n");

/* ---- Feld-Positivliste ---- */
for (const s of schritte) {
  if (!s.feld) continue;
  const ok = (ERLAUBT_A as readonly string[]).includes(s.feld)
    || (ERLAUBT_C as readonly string[]).includes(s.feld)
    || s.feld in RPC_B || s.feld === "kategorie";
  if (!ok) abbruch(`Feld-Positivliste: ${s.feld} (${s.sky_id}) steht nicht darauf.`);
}
console.log("  Feld-Positivliste ok — kein Schritt nennt ein verbotenes Feld.\n");

const vorher = await baseline(R);

/* ---- Reihenfolge: die drei Abhaengigkeiten aus SYNC-11 §1.4 ---- */
/*
 * SECHS STUFEN, IN DIESER FOLGE: Charaktere, Figuren, Typen und Banner,
 * Varianten und Familien, uebrige Katalogfelder, zuletzt die Bildverweise.
 * `RANG` (gemeinsames Modul) traegt die ersten zwei und die Trennung
 * feld-neu/feld; `FELDRANG` ordnet innerhalb einer Schrittart.
 *
 * `image_override_path` steht bewusst GANZ HINTEN — seit dem 2026-10-31.
 * Vorher lag er im selben Rang wie `familie` und `base_sky_id` und wurde
 * deshalb figurweise dazwischen geschrieben. Das lief, aber es ist die
 * falsche Reihenfolge: ein Bildverweis ist das Letzte, was eine Figur
 * braucht, und ein Abbruch soll keine Figur hinterlassen, die auf ein Bild
 * zeigt, deren Typ und Familie aber noch offen sind.
 */
const FELDRANG: Record<string, number> = {
  types: 0, visible_type: 1,          // 3. Typen und Banner
  base_sky_id: 2, familie: 3,         // 4. Varianten und Familien
  /* 5. uebrige Katalogfelder: Vorgaberang 5 */
  image_override_path: 9,             // 6. Bildverweise, zuletzt
};
schritte.sort((a, b) =>
  (RANG[a.art] ?? 9) - (RANG[b.art] ?? 9)
  || (FELDRANG[a.feld ?? ""] ?? 5) - (FELDRANG[b.feld ?? ""] ?? 5)
  || a.sky_id.localeCompare(b.sky_id));

const brauchtW = schritte.some((s) => s.feld && s.feld in RPC_B);
const W = APPLY && brauchtW ? await adminClient(ENV.datei, ENV.ref, ZIEL) : null;
if (brauchtW && !APPLY) console.log("  (ein APPLY braeuchte hier die Adminsitzung W)\n");

let geschrieben = 0; let erwarteteJournalzeilen = 0;
const protokoll: Zeile[] = [];

/*
 * EIN SCHRITT, DER DEN BANNER SETZT, SETZT `visible_type_decided` MIT.
 * `admin_set_visible_type` (0163) schreibt beide Spalten. Der Plan fuehrt
 * `visible_type_decided` als eigenen Klasse-C-Schritt — wer ihn nach der RPC
 * noch einmal schreibt, trifft einen bereits geaenderten Wert und scheitert
 * am Compare-and-Set. Also wird er uebersprungen, wenn dieselbe SKY-ID einen
 * `visible_type`-Schritt hat.
 */
const setztBanner = new Set(
  schritte.filter((s) => s.feld === "visible_type").map((s) => s.sky_id));

/** Charaktername -> id im ZIELprojekt. Die id ist projektlokal (ADR-0034). */
const charakterId = new Map<string, number>(
  (await alle(R, "characters", "id,canonical_name", "canonical_name"))
    .map((c) => [c.canonical_name as string, c.id as number]));

/* ---- TOR 1b: jede Charakterreferenz muss aufloesbar sein ---- */
/*
 * Der Riegel selbst steht in `src/lib/catalog/sync-character-gate.ts` — rein,
 * ohne Datenbank, und dort einzeln geprueft. Die ganze Begruendung steht
 * ebenfalls dort; hier bleibt, was dieses Werkzeug daraus macht.
 *
 * Er laeuft VOR dem ersten Schreibzugriff. Der Lauf vom 2026-10-31 kam 142
 * Schritte weit, bevor eine unaufloesbare Referenz auffiel.
 */
const riegelB = charakterRiegel(schritte, new Set(charakterId.keys()));
if (riegelB.zustand === "veraltet") {
  abbruch(`TOR 1b — der Plan will ${riegelB.schonDa.length} Charakter(e) anlegen, `
    + `die ${ZIEL} schon fuehrt: ${riegelB.schonDa.join(", ")}.\n`
    + "  Der Plan ist veraltet — vermutlich der eines teilweise ausgefuehrten\n"
    + "  Laufs. Neu planen: npm run catalog:sync:plan");
}
if (riegelB.zustand === "unaufloesbar") {
  abbruch(`TOR 1b — ${riegelB.offen.length} Familienzuordnung(en) nennen einen `
    + `Charakter,\n  den ${ZIEL} nicht fuehrt und den der Plan auch nicht anlegt:\n\n`
    + riegelB.offen.map((o) => `    ${o.sky_id}  "${o.name}"`).join("\n")
    + "\n\n  Es ist nichts geschrieben worden. Entweder fehlt dem Plan eine "
    + "Charakteranlage,\n  oder der Name weicht ab (Gross-/Kleinschreibung, "
    + "Leerzeichen) — beides\n  gehoert geklaert, nicht uebersprungen.");
}
console.log(`  TOR 1b ok — ${riegelB.familien} Familienzuordnung(en) sind aufloesbar: `
  + `${riegelB.ausBestand} aus dem Bestand, ${riegelB.ausAnlagen} aus den `
  + `${riegelB.anlagen} geplanten Charakteranlagen.\n`);

/**
 * TOR 2 — Compare-and-Set. Die Bedingung steht IN der schreibenden Anweisung,
 * nicht davor: es gibt kein Fenster zwischen Pruefen und Schreiben.
 */
async function setzeFelder(
  sky_id: string, werte: Record<string, unknown>, erwartet: Record<string, unknown>,
  updatedAt: unknown,
): Promise<void> {
  /*
   * OHNE VERGLEICHSMARKE WIRD NICHT GESCHRIEBEN.
   *
   * `undefined` hier hiess bisher: PostgREST bekommt die Zeichenkette
   * `"undefined"` und PostgreSQL antwortet mit `invalid input syntax`. Der
   * Fehler war lesbar, aber er kam von der Datenbank — und er haette auch
   * durchgehen koennen, wenn die Spalte ein Text waere. Eine fehlende Marke
   * ist ein Fehler im Ablauf, und sie wird hier als solcher gemeldet.
   */
  if (updatedAt === undefined || updatedAt === null) {
    throw new Error(`${sky_id}: keine Vergleichsmarke (updated_at) fuer `
      + `${Object.keys(werte).join(", ")}. Entweder steht die Zeile nicht in der `
      + "Momentaufnahme, oder sie ist in diesem Lauf entstanden und wurde nicht "
      + "zurueckgelesen. Es wird nichts geschrieben.");
  }
  let q = R.from("skylanders").update(werte).eq("sky_id", sky_id)
    .eq("updated_at", updatedAt as string);
  for (const [f, v] of Object.entries(erwartet)) {
    q = v === null ? q.is(f, null) : q.eq(f, v as never);
  }
  /*
   * DAS `returning` GIBT DIE NEUE MARKE MIT — UND DAS IST DIE KORREKTUR.
   *
   * *** DIE DRITTE ERSCHEINUNGSFORM DESSELBEN FEHLERS ***
   *
   * `jetzt._zeilen` ist EINE Momentaufnahme, einmal vor dem Lauf genommen.
   * Jeder Schreibvorgang verschiebt aber `updated_at` (Trigger
   * `skylanders_set_updated_at`, 0001). Ein ZWEITER Schritt an derselben
   * Figur verglich danach gegen die alte Marke und scheiterte an TOR 2 —
   * obwohl sich nichts Fremdes bewegt hatte, sondern nur dieser Lauf selbst.
   *
   * Am 2026-10-31 ist der Abschlusslauf daran abgebrochen:
   *
   *     TOR 2 — Precondition verletzt: SKY-0584 hat sich seit dem Plan
   *     bewegt (image_override_path)
   *
   * SKY-0584 hat zwei Feldschritte; der erste (Anzeigename) hatte die Marke
   * verschoben. Auf Production waere es weit groesser geworden: 288 Figuren
   * tragen mehr als einen Schreibvorgang, 283 davon eine RPC UND ein
   * `update`.
   *
   * Die Korrektur ist NICHT, die Bedingung zu lockern. Sie ist, die
   * Momentaufnahme nach jedem eigenen Schreibvorgang nachzuziehen. Hier
   * kostet das nichts: die neue Marke steht im `returning`.
   */
  const { data, error } = await q.select("sky_id,updated_at");
  if (error) throw new Error(`${sky_id}: ${error.message}`);
  if ((data ?? []).length !== 1) {
    throw new Error(`TOR 2 — Precondition verletzt: ${sky_id} hat sich seit dem Plan `
      + `bewegt (${Object.keys(werte).join(", ")}). Nichts geschrieben. Neu planen.`);
  }
  const neueMarke = (data as unknown as Record<string, unknown>[])[0]?.updated_at;
  const vorhanden = jetzt._zeilen.get(sky_id);
  if (vorhanden) vorhanden.updated_at = neueMarke;
}

/**
 * Zieht die Vergleichsmarke einer Figur nach, wenn sie nicht aus einem
 * `returning` kommt — also nach den Klasse-B-RPCs. Sie schreiben ueber
 * `skylanders` und verschieben `updated_at` genauso, geben es aber nicht
 * zurueck.
 */
async function markeNachziehen(sky_id: string): Promise<void> {
  const { data, error } = await R.from("skylanders")
    .select("updated_at").eq("sky_id", sky_id).single();
  if (error || !data) {
    throw new Error(`${sky_id}: die Vergleichsmarke liess sich nach dem Schreiben `
      + `nicht nachziehen (${error?.message ?? "keine Zeile"}). Ein Folgeschritt `
      + "an derselben Figur wuerde an TOR 2 scheitern.");
  }
  const vorhanden = jetzt._zeilen.get(sky_id);
  if (vorhanden) {
    vorhanden.updated_at = (data as unknown as Record<string, unknown>).updated_at;
  }
}

/**
 * Schreibt das Protokoll — auch wenn der Lauf mitten in der Schleife abbricht.
 *
 * *** WARUM DAS NOETIG WAR ***
 *
 * Bis zum 2026-10-31 stand `writeFileSync` NACH der Schleife. Ein Abbruch in
 * Etappe D (SKY-0854) liess damit ueberhaupt kein Protokoll zurueck: 142
 * geschriebene Schritte, und die einzige Spur davon war die Fehlermeldung im
 * Terminal. Was wirklich geschrieben war, musste hinterher aus der Datenbank
 * zurueckgerechnet werden.
 *
 * Ein Lauf, der schreibt, muss sagen WAS er geschrieben hat — und der
 * Fehlerfall ist der Fall, in dem das am meisten zaehlt.
 */
function schreibeProtokoll(extra: Record<string, unknown>): string {
  mkdirSync("supabase/log/sync", { recursive: true });
  const datei = `supabase/log/sync/${new Date().toISOString().replace(/[:.]/g, "-")}-${ZIEL}.json`;
  writeFileSync(datei, JSON.stringify({
    ziel: ZIEL, modus: APPLY ? "apply" : "vorschau", plan: plan.erzeugt,
    schritte: schritte.length, geschrieben, erwarteteJournalzeilen,
    ...extra, protokoll,
  }, null, 1));
  return datei;
}

try {
for (const s of schritte) {
  const zeile = jetzt._zeilen.get(s.sky_id);
  const wie = `${s.art}${s.feld ? ` ${s.feld}` : ""} ${s.sky_id}`;

  if (s.feld === "kategorie") {
    abbruch(`${wie}: ein Kategoriewechsel ist kein Feldabgleich. `
      + "Er beruehrt den zusammengesetzten Fremdschluessel (category_id, series_code) "
      + "und gehoert in eine eigene, einzeln freigegebene Handlung.");
  }
  if (s.feld === "visible_type_decided" && setztBanner.has(s.sky_id)) {
    console.log(`  [uebersprungen] ${wie.padEnd(42)} setzt admin_set_visible_type mit`);
    continue;
  }

  /*
   * DIE JOURNALERWARTUNG — vorher ausgerechnet, nicht hinterher gezaehlt.
   *
   * *** `types` SCHREIBT EINE ODER ZWEI ZEILEN ***
   *
   * `admin_set_figure_types` (0163, Zeile 79 und 85) journalisiert IMMER
   * `types` — und zusaetzlich `visible_type`, wenn das Banner aus der neuen
   * Menge faellt. Der Rumpf rechnet
   *
   *     v_sicht := case when v_row.visible_type = any (v_neu)
   *                     then v_row.visible_type else null end
   *
   * und schreibt die zweite Zeile, wenn `v_sicht` vom alten Banner abweicht.
   * Nachgezaehlt am 2026-10-30 gegen die Production-Zeilen: **6 der 10**
   * Schritte an bestehenden Zeilen bewegen das Banner (SKY-0009, SKY-0123,
   * SKY-0132, SKY-0137, SKY-0193, SKY-0211), die 31 Schritte an FRISCHEN
   * Zeilen keiner — dort ist `visible_type` NULL und kann nicht fallen.
   *
   * Die Erwartung wird hier aus der GELESENEN Zeile gerechnet, nicht aus
   * einer eingefrorenen Zahl: sie stimmt damit auch, wenn sich der Bestand
   * zwischen zwei Laeufen bewegt.
   */
  let journalt =
    s.art === "figur-anlegen" ? 1
    : s.feld && s.feld in RPC_B ? 1
    : s.feld === "catalog_visible" || s.feld === "catalog_status" ? 1
    : (ERLAUBT_A as readonly string[]).includes(s.feld ?? "") ? 1 : 0;
  if (s.feld === "types") {
    const altesBanner = zeile?.visible_type ?? null;
    const neueMenge = s.nach === "~" ? [] : String(s.nach).split("+");
    if (altesBanner !== null && !neueMenge.includes(String(altesBanner))) journalt += 1;
  }
  erwarteteJournalzeilen += journalt;

  if (!APPLY) {
    console.log(`  [wuerde] ${wie.padEnd(44)} ${t(s.von)} -> ${t(s.nach)}   via ${s.weg}`);
    continue;
  }

  /* ------------------------------------------------------ wirklich schreiben */
  if (s.art === "charakter-anlegen") {
    if (!W) abbruch("charakter-anlegen braucht die Adminsitzung W.");
    const name = String(s.nach);
    const { data: neueId, error } = await W.rpc("admin_create_character", { p_name: name });
    if (error) throw new Error(`${wie}: ${error.message}`);
    /*
     * DIE NEUE id GEHOERT IN DIE ZUORDNUNG — SOFORT.
     *
     * *** DIE FUENFTE ERSCHEINUNGSFORM DESSELBEN FEHLERS ***
     *
     * `charakterId` wird einmal vor der Schleife gelesen (oben, bei TOR 1b
     * steht die ganze Begruendung). Ohne diese Zeile kennt die Zuordnung die
     * hier entstandene Familie nicht, und der erste `familie`-Schritt auf
     * sie bricht ab — mit der irrefuehrenden Meldung, der Charakter stehe im
     * Ziel nicht. Er stand da. Nur nicht in der Momentaufnahme.
     *
     * `admin_create_character` (0158) gibt die id zurueck, also wird nichts
     * geraten und nichts ueber den Namen nachgeschlagen: die Zuordnung
     * bekommt genau die id, die der Einfuegevorgang erzeugt hat.
     */
    const id = typeof neueId === "number" ? neueId : Number(neueId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error(`${wie}: admin_create_character hat keine verwertbare id `
        + `geliefert (${JSON.stringify(neueId)}). Ohne sie kann keine `
        + "Familienzuordnung auf diesen Charakter geschrieben werden.");
    }
    /*
     * Und ein Rueckblick darauf, dass die Zeile wirklich steht. Die RPC
     * laeuft unter der Adminsitzung W, gelesen wird mit R — wer anlegt und
     * wer liest, sind verschiedene Zugaenge, und genau deshalb ist das
     * Nachlesen aussagekraeftig.
     */
    const { data: frisch, error: leseFehler } = await R.from("characters")
      .select("id,canonical_name").eq("id", id).single();
    if (leseFehler || !frisch) {
      throw new Error(`${wie}: angelegt (id ${id}), aber nicht zurueckgelesen `
        + `(${leseFehler?.message ?? "keine Zeile"}).`);
    }
    charakterId.set(name, id);
  } else if (s.art === "figur-anlegen") {
    const q = jetzt._zeilen.get(s.sky_id);
    if (q) throw new Error(`${wie}: die Figur steht schon.`);
    const quelle = (plan.plan.find((x) => x.art === "figur-anlegen"
      && x.sky_id === s.sky_id) as unknown as Zeile).quelle as Zeile | undefined;
    if (!quelle) {
      throw new Error(`${wie}: der Plan fuehrt keine Quellwerte. `
        + "Der Dry-Run muss sie mitschreiben, bevor angelegt werden kann.");
    }
    const { error } = await R.rpc("system_sync_create_figure", {
      p_sky_id: s.sky_id, p_name: quelle.name, p_slug: quelle.slug,
      p_series_code: quelle.series_code, p_category_id: quelle.category_id,
      p_card_type: quelle.card_type, p_item_type: quelle.item_type,
      p_catalog_status: quelle.catalog_status, p_source: quelle.source,
      p_image_file: quelle.image_file ?? null, p_usk_rating: quelle.usk_rating ?? null,
    });
    if (error) throw new Error(`${wie}: ${error.message}`);
    /*
     * DEN NEUEN STAND ZURUECKLESEN — UND ZWAR GENAU DESHALB.
     *
     * *** DER FEHLER VOM 2026-10-31 ***
     *
     * `jetzt._zeilen` ist die Momentaufnahme des ZIELS vor dem Lauf. Eine
     * Figur, die IN diesem Lauf entsteht, steht dort nicht — `zeile` ist
     * `undefined`, und `zeile?.updated_at` ebenso. PostgREST hat das als
     * Zeichenkette `"undefined"` weitergegeben:
     *
     *     SKY-0821: invalid input syntax for type timestamp with time zone:
     *     "undefined"
     *
     * Der Lauf ist daran in Etappe C abgebrochen. Betroffen war NICHT nur
     * SKY-0821: 30 Schritte haengen an einer im Lauf angelegten Figur — 1
     * nach Staging und **29 nach Production**. Etappe D haette denselben
     * Fehler 29-mal gehabt.
     *
     * Die Korrektur ist nicht, die Bedingung weglassen zu duerfen. Sie ist,
     * der Momentaufnahme den WIRKLICHEN Stand der neuen Zeile mitzugeben:
     * ein Lesen direkt nach dem Anlegen, in derselben Reihenfolge. Danach
     * hat jeder Folgeschritt eine echte Vergleichsmarke, und
     * Compare-and-Set gilt fuer neue Zeilen genauso wie fuer alte.
     */
    const { data: frisch, error: leseFehler } = await R.from("skylanders")
      .select(SKY_SPALTEN).eq("sky_id", s.sky_id).single();
    if (leseFehler || !frisch) {
      throw new Error(`${wie}: angelegt, aber nicht zurueckgelesen `
        + `(${leseFehler?.message ?? "keine Zeile"}). Ohne den Stand der neuen `
        + "Zeile kann kein Folgeschritt sicher schreiben.");
    }
    jetzt._zeilen.set(s.sky_id, frisch as unknown as Zeile);
  } else if (s.feld && s.feld in RPC_B) {
    if (!W) abbruch(`${wie} braucht die Adminsitzung W.`);
    const r = RPC_B[s.feld];
    let wert: unknown = s.nach;
    if (s.feld === "types") wert = s.nach === "~" ? [] : String(s.nach).split("+");
    if (s.feld === "visible_type") wert = s.nach === "~" ? null : s.nach;
    if (s.feld === "base_sky_id") wert = s.nach === "~" ? null : s.nach;
    if (s.feld === "familie") {
      if (s.nach === "~") wert = null;
      else {
        const id = charakterId.get(String(s.nach));
        if (id === undefined) {
          /*
           * HIERHER KOMMT MAN JETZT NICHT MEHR DURCH EINE VERALTETE
           * ZUORDNUNG. TOR 1b hat vor dem ersten Schreibzugriff geprueft,
           * dass jede Referenz aufloesbar wird, und die Anlage traegt ihre
           * id selbst ein. Bleibt diese Pruefung trotzdem haengen, ist
           * zwischen Tor und Schritt etwas passiert, das niemand geplant
           * hat — und die alte Meldung ("die Charaktere muessen VOR den
           * Figuren angelegt werden") waere dann genau die falsche Spur.
           */
          throw new Error(`${wie}: der Charakter "${s.nach}" ist nicht aufloesbar, `
            + "obwohl TOR 1b ihn vor dem Lauf als aufloesbar gemessen hat. "
            + `Bekannt sind ${charakterId.size} Charaktere. Nichts weiter `
            + "schreiben, Zustand lesend feststellen, neu planen.");
        }
        wert = id;
      }
    }
    const { error } = await W.rpc(r.fn, { p_sky_id: s.sky_id, [r.arg]: wert });
    if (error) throw new Error(`${wie}: ${error.message}`);
    /*
     * Die RPC hat `skylanders` geschrieben und damit `updated_at`
     * verschoben. Ohne dieses Nachziehen scheitert jeder Folgeschritt an
     * derselben Figur an TOR 2 — auf Production waeren das 283 Figuren.
     */
    await markeNachziehen(s.sky_id);
  } else if (s.feld === "catalog_visible" || s.feld === "catalog_status") {
    /*
     * BEIDE IN EINER ANWEISUNG. Sonst waere der CHECK
     * `skylanders_catalog_status_matches_visibility` zwischendurch verletzt.
     * Der Trigger schreibt dafuer ZWEI Journalzeilen (0152), und die
     * Erwartung oben zaehlt jede der beiden Schrittzeilen einzeln — das geht
     * auf, weil der Plan beide fuehrt.
     */
    if (s.feld === "catalog_status") { geschrieben += 1; continue; }  // mit catalog_visible erledigt
    const status = schritte.find((x) => x.sky_id === s.sky_id && x.feld === "catalog_status");
    if (!status) throw new Error(`${wie}: ohne zugehoerigen catalog_status-Schritt.`);
    await setzeFelder(s.sky_id,
      { catalog_visible: s.nach === "true", catalog_status: status.nach },
      { catalog_visible: s.von === "true", catalog_status: status.von },
      zeile?.updated_at);
  } else if (s.feld) {
    const wert = s.nach === "~" ? null : s.nach;
    const alt = s.von === "~" ? null : s.von;
    await setzeFelder(s.sky_id, { [s.feld]: wert }, { [s.feld]: alt }, zeile?.updated_at);
  }

  geschrieben += 1;
  protokoll.push({ art: s.art, sky_id: s.sky_id, feld: s.feld ?? null,
                   von: s.von ?? null, nach: s.nach ?? null, journalt });
}
} catch (fehler) {
  /*
   * ABGEFANGEN WIRD NUR, UM ES AUFZUSCHREIBEN. Der Fehler wird erneut
   * geworfen; dazwischen liegt nichts als das Protokoll. Es wird nichts
   * zurueckgerollt und nichts wiederholt — der tatsaechliche Zustand bleibt
   * stehen, so wie der Abschlusslauf es zusagt.
   */
  const datei = schreibeProtokoll({
    abgebrochen: true,
    fehler: fehler instanceof Error ? fehler.message : String(fehler),
    abgebrochen_nach: geschrieben,
  });
  console.error(`\n  ABBRUCH nach ${geschrieben} von ${schritte.length} Schritten.`);
  console.error(`  Protokoll           ${datei}`);
  await W?.auth.signOut();
  throw fehler;
}

const nachher = APPLY ? await baseline(R) : vorher;

/* ---- TOR 3: Postflight ---- */
const befunde: string[] = [];
for (const [tab] of ART_A) {
  if (vorher.artA[tab].abdruck !== nachher.artA[tab].abdruck) {
    befunde.push(`${tab}: der Abdruck hat sich bewegt — diese Tabelle gehoert dem Betrieb.`);
  }
}
for (const [tab, , ] of ART_B) {
  for (const [pk, inhalt] of vorher.artB[tab]) {
    const neu = nachher.artB[tab].get(pk);
    if (neu === undefined) befunde.push(`${tab}: die vorher vorhandene Zeile ${pk} fehlt.`);
    else if (neu !== inhalt) befunde.push(`${tab}: die Zeile ${pk} hat sich veraendert.`);
  }
}
const journalDelta = nachher.journal - vorher.journal;
if (APPLY && journalDelta !== erwarteteJournalzeilen) {
  befunde.push(`catalog_admin_changes ist um ${journalDelta} gewachsen, erwartet waren `
    + `${erwarteteJournalzeilen}. Eine Zeile mehr ist so verdaechtig wie eine weniger.`);
}

const protokollDatei = schreibeProtokoll({ abgebrochen: false, journalDelta, befunde });

console.log(`\n  Schritte            ${schritte.length}`);
console.log(`  geschrieben         ${geschrieben}`);
console.log(`  erwartete Journalzeilen ${erwarteteJournalzeilen}`);
console.log(`  Protokoll           ${protokollDatei}`);
if (befunde.length > 0) {
  console.error("\n  TOR 3 — BEFUNDE:\n");
  for (const b of befunde) console.error(`    ${b}`);
  process.exit(1);
}
console.log(`  TOR 3 ok — keine geschuetzte Zeile hat sich bewegt.`);
if (!APPLY) console.log(`\n  DIESER LAUF HAT NICHTS GESCHRIEBEN.\n`);
await W?.auth.signOut();
