/**
 * CAT-03 — Importwerkzeug fuer die Katalogentwuerfe.
 *
 *   npm run cat03:import:staging           PROBELAUF (Standard) — nur lesen und berichten
 *   npm run cat03:import:staging -- --sql  zusaetzlich die Einfuege-Huelle SCHREIBEN
 *
 * ES FUEHRT KEINEN IMPORT AUS, UND ZWAR GRUNDSAETZLICH NICHT.
 *
 * Dieses Werkzeug hat keinen Schreibpfad in die Datenbank — kein `insert`,
 * kein `update`, kein `rpc`. Was `--sql` tut, ist eine DATEI zu schreiben:
 * `supabase/operations/staging-cat03-import.sql`, die der Bediener im
 * SQL-Editor einfuegt. Das ist derselbe Weg wie bei jeder Migration dieses
 * Projekts (ADR-0137), und er ist strenger als ein Flag: der Schreibvorgang
 * braucht einen Menschen, der eine Anweisung liest und ausfuehrt.
 *
 * WARUM NICHT UEBER `admin_create_figure()`. Die Funktion ist der richtige
 * Weg, aber sie fragt `is_platform_admin()`, und das liest `auth.uid()`. Im
 * SQL-Editor ist `auth.uid()` NULL, und mit dem Dienstschluessel ebenfalls —
 * die Funktion wuerde also in beiden Faellen zu Recht abweisen. Die erzeugte
 * Huelle benutzt deshalb dieselben BAUSTEINE (`sky_id_seq`,
 * `next_figure_slug()`) und schreibt dieselbe Journalzeile; ersetzt ist nur
 * die Adminpruefung, und sie ist durch die Eigentuemerrolle im SQL-Editor
 * ersetzt, die stärker ist.
 *
 * WAS DER PROBELAUF PRUEFT (und was ein Lauf ohne ihn verfehlen wuerde):
 * er rechnet NICHT gegen die Momentaufnahme, sondern gegen den Katalog, wie
 * er JETZT ist. Zwischen der Aufbereitung und dem Import kann jemand eine
 * Figur angelegt haben.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { readEnvFile, requireStaging, STAGING_ENV_FILE } from "./lib/staging-guard.mts";

const ENTWUERFE = "resources/analysis/cat-03-entwuerfe.json";
const BILDMANIFEST = "resources/analysis/cat-04-bildmanifest.json";

/**
 * Eine CHARGE begrenzt den Lauf auf benannte Kandidaten.
 *
 * WOFUER. Ein erster Lauf auf Staging soll fuenf Zeilen anlegen und nicht
 * 105. „Nimm die ersten fuenf" waere dafuer die falsche Antwort: sie haengt
 * an einer Sortierung, und wer sie liest, weiss nicht, WELCHE fuenf. Die
 * Charge nennt sie beim Namen, mit Begruendung, in einer eigenen Datei.
 *
 * SIE KANN NUR VERKLEINERN. Ein Name, der nicht in den Entwuerfen steht, ist
 * ein ABBRUCH und kein stilles Weglassen — sonst koennte ein Tippfehler die
 * Charge schrumpfen lassen, ohne dass es auffaellt.
 */
const CHARGE_FLAG = "--charge";

const argIndex = process.argv.indexOf(CHARGE_FLAG);
const chargePfad = argIndex > -1 ? process.argv[argIndex + 1] : null;

type Entwurf = {
  katalogname: string;
  series_code: string;
  category_id: number;
  category_name: string;
  item_type: string;
  card_type: string;
  catalog_status: string;
  source: string;
  admin_note: string;
  bildstatus: string;
};

if (!existsSync(ENTWUERFE)) {
  console.error(`CAT-03 ABBRUCH: ${ENTWUERFE} fehlt — zuerst cat03:drafts:staging fahren.`);
  process.exit(1);
}
const akte = JSON.parse(readFileSync(ENTWUERFE, "utf8")) as {
  entwuerfe: Entwurf[]; validierungsfehler: string[];
};

let entwuerfe = akte.entwuerfe;
let chargeName = "";
let HUELLE = "supabase/operations/staging-cat03-import.sql";

if (chargePfad !== null) {
  if (!existsSync(chargePfad)) {
    console.error(`CAT-03 ABBRUCH: Chargendatei ${chargePfad} fehlt.`);
    process.exit(1);
  }
  const charge = JSON.parse(readFileSync(chargePfad, "utf8")) as {
    name: string; kandidaten: { katalogname: string; series_code: string }[];
  };
  chargeName = charge.name;
  const nach = new Map(akte.entwuerfe.map((d) => [`${d.katalogname}|${d.series_code}`, d]));
  const gewaehlt: Entwurf[] = [];
  const fehlend: string[] = [];
  for (const k of charge.kandidaten) {
    const treffer = nach.get(`${k.katalogname}|${k.series_code}`);
    if (treffer === undefined) fehlend.push(`${k.katalogname} (${k.series_code})`);
    else gewaehlt.push(treffer);
  }
  if (fehlend.length > 0) {
    console.error(`CAT-03 ABBRUCH: ${fehlend.length} Kandidat(en) der Charge stehen `
                + `nicht in den Entwuerfen: ${fehlend.join(", ")}`);
    process.exit(1);
  }
  /* DIE ZAHL MUSS STIMMEN. Ein Duplikat in der Charge wuerde sonst unbemerkt
     zu einer kuerzeren Liste fuehren. */
  if (gewaehlt.length !== charge.kandidaten.length) {
    console.error(`CAT-03 ABBRUCH: die Charge nennt ${charge.kandidaten.length} `
                + `Kandidaten, ausgewaehlt wurden ${gewaehlt.length}.`);
    process.exit(1);
  }
  entwuerfe = gewaehlt;
  HUELLE = `supabase/operations/staging-${charge.name.toLowerCase()}-import.sql`;
  console.log(`  CHARGE         : ${charge.name} — ${entwuerfe.length} von `
            + `${akte.entwuerfe.length} Entwuerfen`);
  for (const d of entwuerfe) console.log(`                   ${d.katalogname} (${d.series_code})`);
}

/* Ein Importlauf auf einer Akte mit Validierungsfehlern faengt nicht an. */
if (akte.validierungsfehler.length > 0) {
  console.error(`CAT-03 ABBRUCH: die Akte traegt ${akte.validierungsfehler.length} `
              + "Validierungsfehler. Erst beheben, dann importieren.");
  process.exit(1);
}

/**
 * Das Bildmanifest, falls es eines gibt (CAT-04D).
 *
 * ES SETZT KEIN BILD — es schreibt die ZUORDNUNG in die interne Notiz. Der
 * Grund steht in `supabase/checks/cat04d_bildimport_plan.md` und ist
 * gemessen: der Bucket `catalog` ist oeffentlich lesbar (ADR-0046, am
 * 2026-10-27 mit einem anonymen HEAD auf 200 bestaetigt). Ein Upload waere
 * damit eine VEROEFFENTLICHUNG, auch wenn die Figur ein unsichtbarer
 * Entwurf ist — und die Nutzungsrechte an den Bildern der fremden
 * Checkliste sind ungeklaert.
 *
 * Was bleibt, ist die Spur: welche Datei zu welcher Figur gehoert, mit
 * Pruefsumme. Damit ist Stufe 2 spaeter reproduzierbar, ohne dass heute
 * etwas veroeffentlicht wird.
 */
type Bildzeile = { katalogname: string; series_code: string; medium: string;
                   format: string; breite: number | string; hoehe: number | string;
                   sha256_16: string; zuordnung: string };
const bildNach = new Map<string, Bildzeile>();
if (existsSync(BILDMANIFEST)) {
  const bm = JSON.parse(readFileSync(BILDMANIFEST, "utf8")) as { zuordnungen: Bildzeile[] };
  for (const z of bm.zuordnungen) {
    if (z.zuordnung === "eindeutig") bildNach.set(`${z.katalogname}|${z.series_code}`, z);
  }
  console.log(`  Bildmanifest   : ${bildNach.size} eindeutige Zuordnungen gelesen`);
}

requireStaging("cat03:import:staging");
const env = readEnvFile(STAGING_ENV_FILE);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const dienst = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !dienst) throw new Error(`CAT-03 ABBRUCH: ${STAGING_ENV_FILE} unvollstaendig.`);
const kopf = { apikey: dienst, Authorization: `Bearer ${dienst}` };

async function lies(pfad: string): Promise<Record<string, unknown>[]> {
  const antwort = await fetch(`${url}/rest/v1/${pfad}`, { headers: kopf });
  if (!antwort.ok) throw new Error(`CAT-03 ABBRUCH: REST ${antwort.status} auf ${pfad}.`);
  return (await antwort.json()) as Record<string, unknown>[];
}

/**
 * Steht eine Spalte? Gefragt, nicht angenommen.
 *
 * PostgREST antwortet auf eine unbekannte Spalte mit `400` und nicht mit
 * einem leeren Feld. Ein Lauf, der sie einfach mitselektiert, bricht deshalb
 * ab — und zwar genau in der Lage, die dieses Werkzeug BENENNEN soll: `0152`
 * ist noch nicht angewendet. Die Frage gehoert also in eine eigene,
 * folgenlose Abfrage.
 */
async function spalteSteht(tabelle: string, spalte: string): Promise<boolean> {
  const antwort = await fetch(`${url}/rest/v1/${tabelle}?select=${spalte}&limit=1`,
                              { headers: kopf });
  return antwort.ok;
}

/* ------------------------------------------------------- 1. Vorbedingungen */
const katalog = await lies("skylanders?select=sky_id,name,display_name_override,"
                         + "series_code,category_id&order=sky_id&limit=5000");
const hatStatus = await spalteSteht("skylanders", "catalog_status");
const kategorien = await lies("categories?select=id,series_code,name");
const bekannt = new Set(kategorien.map((c) => String(c.id)));

console.log(`  Entwuerfe      : ${entwuerfe.length}`);
console.log(`  Katalog JETZT  : ${katalog.length} Zeilen`);
console.log(`  catalog_status : ${hatStatus ? "vorhanden (0152 angewendet)" : "FEHLT (0152 nicht angewendet)"}`);

/**
 * Zwei Sorten Befund, und die Unterscheidung ist keine Weichspuelerei.
 *
 * `blockierend`  die Huelle darf gar nicht erst entstehen — eine unbekannte
 *                `category_id` etwa wuerde eine Zeile erzeugen, die niemand
 *                einordnen kann.
 * `wartet`       die Huelle darf entstehen, LAUFEN darf sie noch nicht. Der
 *                einzige Fall ist ein fehlendes `0152`, und er ist deshalb
 *                anders, weil die Huelle ihn SELBST bewacht: `ABBRUCH A2`
 *                bricht die Transaktion ab, bevor eine Zeile entsteht.
 *
 * Wer freigeben soll, muss den SQL vorher lesen koennen. Ihn zurueckzuhalten,
 * bis die Vorbedingung erfuellt ist, waere keine Sicherheit, sondern nur
 * weniger Einsicht.
 */
const probleme: string[] = [];
const wartet: string[] = [];
if (!hatStatus) {
  wartet.push("0152 ist hier nicht angewendet — ohne `catalog_status` kann ein "
            + "Entwurf nicht als Entwurf entstehen. Die Huelle bricht von selbst "
            + "mit ABBRUCH A2 ab. Zuerst 0152 fahren "
            + "(supabase/checks/0152_staging_run.md).");
}

/* --------------------------------------- 2. Dubletten gegen den JETZT-Stand */
const falte = (s: string) =>
  s.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase()
   .replace(/['’`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Der Katalog, unter BEIDEN Namen.
 *
 * Eine Zeile kann oeffentlich anders heissen als intern:
 * `display_name_override` ist der Name, den der Katalog zeigt (ADR-0030).
 * Wer nur `name` vergleicht, uebersieht eine Figur, die genau unter dem
 * gesuchten Namen schon dasteht — nur eben als Ueberschreibung. Beide Namen
 * zeigen auf dieselbe SKY-ID; welcher getroffen hat, steht im Protokoll.
 */
const vorhanden = new Map<string, { skyId: string; feld: string }>();
for (const r of katalog) {
  const id = String(r.sky_id);
  vorhanden.set(`${falte(String(r.name))}|${r.series_code}`, { skyId: id, feld: "name" });
  const ueber = r.display_name_override;
  if (typeof ueber === "string" && ueber.trim() !== "") {
    const k = `${falte(ueber)}|${r.series_code}`;
    /* Der eigene Name gewinnt, wenn beide treffen — er ist die Identitaet. */
    if (!vorhanden.has(k)) vorhanden.set(k, { skyId: id, feld: "display_name_override" });
  }
}

/**
 * UEBERSPRINGEN STATT ABBRECHEN — die Zielsetzung ist eine EINMALIGE
 * Vervollstaendigung, kein Dauerbetrieb. Ein Kandidat mit einer unbekannten
 * Kategorie ist ein Einzelfall fuer den Adminbereich und kein Grund, die
 * uebrigen hundert aufzuhalten. Was uebersprungen wird, steht im Protokoll.
 */
const anlegen: Entwurf[] = [];
const dubletten: string[] = [];
const uebersprungen: { entwurf: string; grund: string }[] = [];
const gesehen = new Set<string>();
for (const d of entwuerfe) {
  const wo = `${d.katalogname} (${d.series_code})`;
  const schluessel = `${falte(d.katalogname)}|${d.series_code}`;
  const treffer = vorhanden.get(schluessel);
  if (treffer) {
    const grund = `steht schon als ${treffer.skyId}`
                + (treffer.feld === "name" ? "" : ` (ueber ${treffer.feld})`);
    dubletten.push(`${wo} ${grund}`);
    uebersprungen.push({ entwurf: wo, grund });
    continue;
  }
  if (gesehen.has(schluessel)) {
    dubletten.push(`${wo} kommt in der Akte doppelt vor`);
    uebersprungen.push({ entwurf: wo, grund: "Dublette innerhalb der Entwuerfe" });
    continue;
  }
  if (!bekannt.has(String(d.category_id))) {
    uebersprungen.push({ entwurf: wo, grund: `category_id ${d.category_id} gibt es hier nicht` });
    continue;
  }
  if (!d.katalogname.trim() || !d.series_code || d.catalog_status !== "draft") {
    uebersprungen.push({ entwurf: wo, grund: "Pflichtfeld fehlt oder Status ist nicht draft" });
    continue;
  }
  gesehen.add(schluessel);
  anlegen.push(d);
}

console.log(`  Wuerde anlegen : ${anlegen.length}`);
console.log(`  Dubletten      : ${dubletten.length}`);
for (const z of dubletten.slice(0, 8)) console.log(`                   ${z}`);
if (uebersprungen.length > 0) {
  console.log(`  Uebersprungen  : ${uebersprungen.length} (protokolliert)`);
}
console.log(`  Katalog danach : ${katalog.length} + ${anlegen.length} = `
          + `${katalog.length + anlegen.length} Zeilen`);

/* DAS PROTOKOLL IST TEIL DES ERGEBNISSES, nicht eine Bildschirmausgabe. */
writeFileSync("resources/analysis/cat-04-importprotokoll.json", JSON.stringify({
  erzeugt: new Date().toISOString(),
  katalog_vorher: katalog.length,
  anlegen: anlegen.length,
  katalog_nachher: katalog.length + anlegen.length,
  uebersprungen,
  dubletten,
}, null, 1) + "\n");
if (probleme.length > 0) {
  console.log(`  BLOCKIEREND    : ${probleme.length}`);
  for (const z of probleme.slice(0, 8)) console.log(`                   ${z}`);
}
if (wartet.length > 0) {
  console.log(`  WARTET AUF     : ${wartet.length}`);
  for (const z of wartet) console.log(`                   ${z}`);
}

/* ----------------------------------------------- 3. Die Huelle, auf Wunsch */
const willSql = process.argv.includes("--sql");
if (!willSql) {
  console.log("");
  console.log("  PROBELAUF — nichts geschrieben, weder in die Datenbank noch als Datei.");
  console.log("  Mit `-- --sql` entsteht die Einfuege-Huelle; ausgefuehrt wird sie");
  console.log("  danach vom Bediener im SQL-Editor, nicht von diesem Werkzeug.");
  process.exit(probleme.length + wartet.length > 0 ? 1 : 0);
}
if (probleme.length > 0) {
  console.error("  CAT-03 ABBRUCH: es gibt blockierende Befunde — keine Huelle erzeugt.");
  process.exit(1);
}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const notizFuer = (d: Entwurf): string => {
  const b = bildNach.get(`${d.katalogname}|${d.series_code}`);
  if (b === undefined) return d.admin_note;
  /* Die Zuordnung, nicht das Bild. Pruefsumme dazu, damit spaeter niemand
     raten muss, welche Datei gemeint war. */
  return `${d.admin_note} Zugeordnetes Bild: ${b.medium} `
       + `(${b.format} ${b.breite}x${b.hoehe}, sha256 ${b.sha256_16}) — NICHT uebernommen.`;
};
const zeilen = anlegen.map((d) =>
  `      (${q(d.katalogname)}, ${q(d.series_code)}, ${d.category_id}, `
  + `${q(d.item_type)}, ${q(d.card_type)}, ${q(notizFuer(d))})`).join(",\n");

const sql = `-- ===========================================================================
-- STAGING — ${chargeName || "CAT-03"}: ${anlegen.length} Katalogentwuerfe anlegen
--
-- ERZEUGT von \`npm run cat03:import:staging -- --sql\`, nicht von Hand.
-- Grundlage: ${ENTWUERFE}${chargePfad ? `\n-- Charge:     ${chargePfad} (${anlegen.length} benannte Kandidaten)` : ""}
--
-- EINE DATEI, EINE TRANSAKTION, EIN EINFUEGEN. Vollstaendig markieren, in den
-- SQL-Editor des Staging-Projekts einfuegen, ausfuehren.
--
-- *** JEDE ZEILE ENTSTEHT ALS ENTWURF ***
--
-- \`catalog_status = 'draft'\` und \`catalog_visible = false\`. Keine dieser
-- Figuren ist nach dem Lauf oeffentlich sichtbar — der oeffentliche Katalog
-- aendert sich NICHT. Sichtbar werden sie erst, wenn der Admin im Formular
-- den Status auf \`public\` stellt.
--
-- SIE IST IDEMPOTENT. Jede Zeile wird uebersprungen, wenn Name und Serie
-- schon im Katalog stehen; ein zweiter Lauf legt nichts doppelt an und
-- verbraucht auch keine SKY-ID (\`nextval\` wird erst nach der Pruefung
-- gezogen).
--
-- SIE VERGIBT KEINE SKY-ID IM VORAUS. Die ID kommt aus \`sky_id_seq\`
-- (ADR-0070), der Slug aus \`next_figure_slug()\` — dieselben Bausteine, die
-- \`admin_create_figure()\` benutzt. Nichts wird aus einem Namen abgeleitet.
--
-- WAS SIE NICHT TUT: keinen Preis (\`market_price\` bleibt NULL, ADR-0010),
-- kein Bild (die Rechte an den externen Bildern sind ungeklaert), keine
-- \`character_id\` (Kuratierung, ADR-0034), keine bestehende Zeile anfassen,
-- keine Kategorie anlegen, keine Migration.
--
-- HERKUNFT: \`source = 'admin'\`, weil der CHECK aus \`0033\` nur \`import\` und
-- \`admin\` kennt — und weil \`import\` dem Katalogimport sagen wuerde, die
-- Zeile gehoere ihm. Die Herkunft \`cat01\` steht in der internen Notiz
-- (\`catalog_editorial.admin_note\`), wo interne Angaben hingehoeren
-- (ADR-0039).
-- ===========================================================================

begin;

do $vor$
begin
  if (select count(*) from public.skylanders
       where sky_id in ('SKY-0821', 'SKY-0822')) <> 2 then
    raise exception 'ABBRUCH A1: Umgebungsstempel nicht gefunden. Diese Datei '
      'laeuft nur auf Staging.';
  end if;
  if not exists (select 1 from pg_attribute a
                  where a.attrelid = to_regclass('public.skylanders')
                    and a.attname = 'catalog_status' and not a.attisdropped) then
    raise exception 'ABBRUCH A2: skylanders.catalog_status fehlt — 0152 ist hier '
      'nicht angewendet. Ohne den Status kann kein Entwurf entstehen.';
  end if;
  if to_regprocedure('public.next_figure_slug(text,text,text)') is null then
    raise exception 'ABBRUCH A3: next_figure_slug() fehlt (0041).';
  end if;

  /*
   * A4 — STEHT DIE SEQUENZ WEIT GENUG?
   *
   * sky_id_seq beginnt bei 821 und wird nie zurueckgesetzt. Liegt sie
   * hinter der hoechsten vergebenen SKY-ID, zieht der Lauf eine ID, die
   * schon steht, und verletzt den Primaerschluessel — mitten in der
   * Schleife, nach ein paar erfolgreichen Zeilen. Besser vorher und mit
   * einem Satz, der sagt, was zu tun ist.
   *
   * DER RESERVIERTE BEREICH ZAEHLT NICHT MIT. 9000-9999 ist System- und
   * Testbereich (ADR-0070); auf Staging stehen dort Zeilen (z.B. SKY-9998),
   * und admin_create_figure verweigert alles hinter 8999. Die hoechste
   * RELEVANTE ID ist deshalb die hoechste unterhalb 9000.
   *
   * pg_sequence_last_value ist NULL, solange die Sequenz nie gezogen
   * wurde — dann liefert der naechste Zug den Startwert 821.
   */
  declare
    v_hoechste integer;
    v_naechste bigint;
  begin
    /*
     * DAS MUSTER TUT BEIDES: es waehlt den produktiven Bereich (0000-8999)
     * UND haelt den Cast von jeder Zeile fern, die nicht vierstellig ist.
     * Ein where ...::integer < 9000 haette den Cast zuerst ausgefuehrt und
     * waere an einer abweichenden Kennung mit 22P02 gescheitert — gefunden
     * im Probelauf P61, nicht am Bediener.
     */
    select coalesce(max((substring(sky_id from 5))::integer), 0)
      into v_hoechste
      from public.skylanders
     where sky_id ~ '^SKY-[0-8][0-9]{3}$';

    v_naechste := coalesce(pg_sequence_last_value('public.sky_id_seq'::regclass) + 1, 821);

    if v_naechste <= v_hoechste then
      raise exception 'ABBRUCH A4: sky_id_seq liefert als naechstes %, die hoechste '
        'vergebene SKY-ID unterhalb 9000 ist aber SKY-%. Der Lauf wuerde den '
        'Primaerschluessel verletzen. Sequenz zuerst nachziehen: '
        'select setval(''public.sky_id_seq'', %);',
        v_naechste, lpad(v_hoechste::text, 4, '0'), v_hoechste;
    end if;

    raise notice 'A4 ok: naechste SKY-ID waere SKY-%, hoechste vergebene SKY-% '
      '(reservierter Bereich 9000-9999 nicht mitgezaehlt).',
      lpad(v_naechste::text, 4, '0'), lpad(v_hoechste::text, 4, '0');
  end;
end
$vor$;

do $import$
declare
  v_vorher       bigint;
  v_nachher      bigint;
  r              record;
  v_sky          text;
  v_slug         text;
  v_next         bigint;
  v_angelegt     integer := 0;
  v_uebersprungen integer := 0;
begin
  -- DIE ZEILENZAHL VORHER. Zusammen mit der Zahl danach beweist sie, dass
  -- GENAU die angelegten Zeilen dazugekommen sind und keine verschwunden ist.
  select count(*) into v_vorher from public.skylanders;

  for r in
    select * from (values
${zeilen}
    ) as t(name, series_code, category_id, item_type, card_type, note)
  loop
    -- DUBLETTENPRUEFUNG, fachlich und nicht ueber die ID: Name und Serie
    -- zusammen. Die SKY-ID-Sequenz verhindert ID-Kollisionen, aber keine
    -- fachlichen Dubletten — das sind zwei getrennte Risiken.
    if exists (select 1 from public.skylanders s
                where lower(btrim(s.name)) = lower(btrim(r.name))
                  and s.series_code = r.series_code) then
      v_uebersprungen := v_uebersprungen + 1;
      continue;
    end if;

    -- ERST JETZT eine ID ziehen. Eine uebersprungene Zeile verbraucht keine.
    v_next := nextval('public.sky_id_seq');
    if v_next > 8999 then
      raise exception 'ABBRUCH: SKY-ID-Bereich erschoepft (% liegt hinter '
        'SKY-8999; 9000-9999 ist reserviert, ADR-0070)', v_next;
    end if;
    v_sky  := 'SKY-' || lpad(v_next::text, 4, '0');
    v_slug := public.next_figure_slug(r.name, r.series_code, v_sky);

    insert into public.skylanders
      (sky_id, name, slug, series_code, category_id, item_type, card_type,
       catalog_visible, catalog_status, source, is_active)
    values
      (v_sky, r.name, v_slug, r.series_code, r.category_id, r.item_type, r.card_type,
       false, 'draft', 'admin', true);

    -- Die interne Notiz traegt die Herkunft. Sie liegt NICHT auf
    -- \`skylanders\` — die Tabelle ist weltlesbar (ADR-0039).
    insert into public.catalog_editorial (sky_id, admin_note, updated_at)
      values (v_sky, r.note, now())
      on conflict (sky_id) do update set admin_note = excluded.admin_note,
                                         updated_at = now();

    -- Und dieselbe Journalzeile, die \`admin_create_figure()\` schreibt.
    insert into public.catalog_admin_changes
      (entity, entity_id, field, old_value, new_value, changed_by)
    values ('skylander', v_sky, 'created', null, r.name, null);

    v_angelegt := v_angelegt + 1;
  end loop;

  select count(*) into v_nachher from public.skylanders;
  if v_nachher - v_vorher <> v_angelegt then
    raise exception 'ABBRUCH: der Katalog wuchs um % Zeilen, angelegt wurden aber % — '
      'es ist etwas anderes passiert als dieser Lauf', v_nachher - v_vorher, v_angelegt;
  end if;

  raise notice 'CAT-03: % Entwurf/Entwuerfe angelegt, % uebersprungen (standen schon). '
    'Katalog % -> % Zeilen.', v_angelegt, v_uebersprungen, v_vorher, v_nachher;
end
$import$;

do $nach$
declare
  v_entwurf  bigint;
  v_sichtbar bigint;
begin
  select count(*) into v_entwurf  from public.skylanders where catalog_status = 'draft';
  select count(*) into v_sichtbar from public.skylanders
   where catalog_status = 'draft' and catalog_visible;
  if v_sichtbar <> 0 then
    raise exception 'NACHBEDINGUNG: % Entwurf/Entwuerfe sind sichtbar — das darf '
      'nicht sein', v_sichtbar;
  end if;
  raise notice 'CAT-03 Nachkontrolle: % Entwurf/Entwuerfe im Katalog, keiner sichtbar.',
    v_entwurf;
end
$nach$;

commit;
`;
writeFileSync(HUELLE, sql);
console.log("");
console.log(`  Huelle         : ${HUELLE} (${anlegen.length} Zeilen)`);
console.log("  AUSGEFUEHRT WIRD SIE VOM BEDIENER im SQL-Editor. Dieses Werkzeug hat");
console.log("  keinen Schreibpfad in die Datenbank.");
if (wartet.length > 0) {
  console.log("");
  console.log("  *** SIE DARF NOCH NICHT LAUFEN ***");
  for (const z of wartet) console.log(`  ${z}`);
  process.exitCode = 1;
}
