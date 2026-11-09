/*
 * ===========================================================================
 * DIE FEHLENDEN BILDOBJEKTE UEBERTRAGEN — STAGING <-> PRODUCTION
 *
 *   npm run storage:transfer:plan                  Trockenlauf, beide Richtungen
 *   npm run storage:transfer:plan -- --ziel staging        nur eine Richtung
 *   npm run storage:transfer:apply:staging         uebertraegt nach Staging
 *   npm run storage:transfer:apply:production      uebertraegt nach Production
 *   npm run storage:verify:staging                 PRUEFT nur, schreibt nichts
 *   npm run storage:verify:production              PRUEFT nur, schreibt nichts
 *
 * *** DER PRUEFMODUS — FUER EINEN BEREITS ERLEDIGTEN TRANSFER ***
 *
 * `--pruefen` ist der Weg fuer die Richtung, die NICHTS mehr zu uebertragen
 * hat. Er laedt, rechnet und vergleicht; er legt nichts an. Geprueft wird
 * genau das, was dieser Abgleich braucht:
 *
 *   - die Pfade, die der Plan noch in diese Richtung schreiben will, und
 *   - die Pfade, die BEIDE Umgebungen referenzieren — also genau die, die
 *     dieser Abgleich schon uebertragen hat.
 *
 * Ein beidseitig referenzierter Pfad, der im Ziel fehlt, ist ein Befund: er
 * war da und ist weg. Ein noch nicht uebertragener Planpfad ist keiner — das
 * sagt der Plan ja selbst, und dafuer ist der Apply-Pfad da. Pfade, die NUR
 * eine Umgebung referenziert und die dieser Abgleich nicht anfasst, bleiben
 * ausser Betracht; sie gehoeren nicht zu Etappe A.
 *
 * *** EIN APPLY OHNE RICHTUNG LAEUFT NICHT ***
 *
 * `--apply` verlangt `--ziel staging` ODER `--ziel production`. Es gibt
 * keinen Aufruf, der in einem Zug in BEIDE Umgebungen schreibt — zwei
 * Richtungen sind zwei Freigaben, und eine Datei, die beides gleichzeitig
 * kann, macht aus zwei Freigaben eine. Der Trockenlauf darf beide zeigen; er
 * schreibt nichts.
 *
 * ===========================================================================
 * OHNE `--apply` SCHREIBT DIESE DATEI NICHTS.
 * ===========================================================================
 *
 * Der Trockenlauf laedt herunter, rechnet Pruefsummen und meldet. Er legt
 * kein Objekt an, ueberschreibt keines und loescht keines.
 *
 * *** WAS UEBERTRAGEN WIRD ***
 *
 * Genau die Pfade, die `resources/analysis/sync-dryrun.json` als
 * `image_override_path`-Schritte fuehrt — 7 nach Production, 10 nach
 * Staging. Die Liste wird NICHT hier gepflegt, sondern aus dem Dry-Run
 * gelesen: eine zweite Liste waere eine zweite Wahrheit.
 *
 * *** DREI UNABHAENGIGE PRUEFUNGEN JE OBJEKT ***
 *
 *   1  DER NAME IST DIE PRUEFSUMME. Gemessen am 2026-10-30: bei allen 17
 *      Objekten sind die 16 Hexstellen des Dateinamens die ersten 16 Stellen
 *      des SHA-256 ueber den Inhalt. Der Pfad ist also inhaltsadressiert —
 *      schon vor dem Upload laesst sich sagen, ob die Quelle die Datei ist,
 *      die der Pfad verspricht.
 *   2  BYTE-VERGLEICH NACH DEM UPLOAD. Das Objekt wird aus dem ZIEL erneut
 *      geladen und Byte fuer Byte gegen die Quelle gehalten — nicht nur die
 *      Groesse, nicht nur die Pruefsumme.
 *   3  SHA-256 DES ZURUECKGELESENEN. Dieselbe Pruefsumme wie in 1, gegen das
 *      Ziel gerechnet.
 *
 * Schlaegt eine davon fehl, bricht der Lauf ab — mit dem bereits
 * hochgeladenen Objekt an Ort und Stelle. Das ist Absicht: ein Upload laesst
 * sich nicht transaktional zuruecknehmen, und ein automatisches Loeschen im
 * Fehlerfall waere der gefaehrlichere Weg. Der Bericht nennt, was liegt.
 *
 * *** ES WIRD NIE UEBERSCHRIEBEN ***
 *
 * `upsert: false`. Existiert der Zielpfad schon, wird das Objekt
 * UEBERSPRUNGEN und gemeldet — nicht ersetzt. Ein Bildobjekt ist
 * inhaltsadressiert; ein vorhandener Pfad mit anderem Inhalt waere ein
 * Befund, kein Routinefall.
 *
 * *** ES WIRD NIE GELOESCHT ***
 *
 * `storage.remove` kommt in dieser Datei nicht vor.
 * ===========================================================================
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { confirmProductionWrite, PINNED_REFS, pinnedEnvFile, productionConfirmation } from "./lib/staging-guard.mts";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { beurteile, noetigeMenge, zusammenfassung, type Bedarf, type Objekt, type Urteil }
  from "../src/lib/catalog/storage-verify.ts";

const STAGING_REF = PINNED_REFS.staging;
const PRODUCTION_REF = PINNED_REFS.production;
const BUCKET = "catalog";
const PLAN = "resources/analysis/sync-dryrun.json";
const BERICHT_BASIS = "resources/analysis/STORAGE-TRANSFER";

const ANWENDEN = process.argv.includes("--apply");
const PRUEFEN = process.argv.includes("--pruefen");

/*
 * `--apply` und `--pruefen` schliessen sich aus. Der eine schreibt, der
 * andere sagt zu, nichts zu schreiben — beides zugleich waere eine Zusage,
 * die nicht gilt.
 */
if (ANWENDEN && PRUEFEN) {
  console.error("\n  Abbruch: `--apply` und `--pruefen` zusammen gibt es nicht. "
    + "Der eine\n  schreibt, der andere sagt zu, nichts zu schreiben.\n");
  process.exit(1);
}

/** `--ziel staging` oder `--ziel production`; ohne Angabe beide Richtungen. */
const ZIEL_ARG = (() => {
  const i = process.argv.indexOf("--ziel");
  if (i === -1) return null;
  const w = process.argv[i + 1];
  if (w !== "staging" && w !== "production") {
    console.error(`\n  Abbruch: --ziel braucht "staging" oder "production", nicht `
      + `${JSON.stringify(w ?? "(nichts)")}.\n`);
    process.exit(1);
  }
  return w as "staging" | "production";
})();

/*
 * RIEGEL 0 — EIN APPLY BRAUCHT EINE RICHTUNG.
 *
 * Ohne diese Bedingung wuerde `--apply` allein in beide Umgebungen
 * schreiben. Zwei Richtungen sind zwei Freigaben; eine Datei, die beides in
 * einem Zug kann, macht daraus eine.
 */
/*
 * RIEGEL 0b (M-04, 2026-11-09) — PRODUCTION BRAUCHT DIE BESTAETIGUNG MIT ID.
 * `npm run storage:transfer:apply:production` allein schreibt nicht mehr:
 * dazu `--confirm-production=zmiwxswrpkmizvqsgype`, und unmittelbar vor dem
 * ersten Upload die ID am Terminal.
 */
if (ANWENDEN && ZIEL_ARG === "production" && !process.argv.includes(productionConfirmation())) {
  console.error(`\n  RIEGEL 0b — Abbruch. \`--ziel production --apply\` verlangt ${productionConfirmation()}.\n`);
  process.exit(1);
}
if (ANWENDEN && ZIEL_ARG === null) {
  console.error("\n  RIEGEL 0 — Abbruch. `--apply` verlangt `--ziel staging` oder "
    + "`--ziel production`.\n\n  Zwei Richtungen sind zwei Freigaben. Es gibt "
    + "keinen Aufruf, der in einem Zug in beide Umgebungen schreibt.\n");
  process.exit(1);
}

/* ------------------------------------------------------------- Verbindung */


/** Riegel 1: jede Verbindung muss das Projekt sein, das ihre Datei nennt. */
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

const S = verbinde(".env.staging", STAGING_REF, "Staging");
const P = verbinde(".env.local", PRODUCTION_REF, "Production");
console.log("  Riegel 1 ok — beide Verbindungen an der erwarteten Kennung\n");

/* ------------------------------------------------------------- Die Liste */

type Schritt = { ziel: "staging" | "production"; sky_id: string; pfad: string };
const plan = JSON.parse(readFileSync(PLAN, "utf8")) as { plan: Record<string, unknown>[] };
const alleSchritte: Schritt[] = plan.plan
  .filter((x) => x.feld === "image_override_path" && typeof x.nach === "string" && x.nach !== "~")
  .map((x) => ({ ziel: x.ziel as Schritt["ziel"], sky_id: x.sky_id as string,
                 pfad: x.nach as string }));
const schritte: Schritt[] = ZIEL_ARG === null
  ? alleSchritte : alleSchritte.filter((s) => s.ziel === ZIEL_ARG);

/*
 * RIEGEL 2 — DER PLAN MUSS LESBAR SEIN.
 *
 * *** DER FEHLER VOM 2026-10-31 ***
 *
 * Hier stand `schritte.length === 0` — die AUSWAHL, nicht der Plan. Richtung
 * Staging hatte nach Etappe C keinen Bildschritt mehr, und der Lauf brach
 * mit der Meldung ab, "der Dry-Run nennt keinen Bildschritt". Das war
 * falsch: der Dry-Run nannte 17, alle Richtung Production. Und Riegel 2b,
 * der genau fuer "keiner in DIESER Richtung" gedacht ist, war dadurch
 * unerreichbar — er stand hinter einer Bedingung, die schon abgebrochen
 * hatte.
 *
 * Riegel 2 prueft jetzt, was er behauptet: fuehrt der Plan ueberhaupt
 * Bildschritte? Im Pruefmodus ist auch das kein Abbruchgrund — dort ist eine
 * leere Planliste der Normalfall, und geprueft wird das schon Uebertragene.
 */
if (alleSchritte.length === 0 && !PRUEFEN) {
  console.error("\n  RIEGEL 2 — Abbruch: der Dry-Run nennt keinen Bildschritt.\n\n"
    + "  Ist der Transfer schon erledigt, ist `--pruefen` der richtige Aufruf:\n"
    + "  er verifiziert die uebertragenen Objekte, ohne etwas zu schreiben.\n");
  process.exit(1);
}
console.log(`  Riegel 2 ok — ${alleSchritte.length} Bildschritte im Dry-Run `
  + `(${alleSchritte.filter((s) => s.ziel === "production").length} nach Production, `
  + `${alleSchritte.filter((s) => s.ziel === "staging").length} nach Staging)`);
console.log(`  Auswahl      ${ZIEL_ARG === null
  ? "BEIDE Richtungen (nur im Trockenlauf moeglich)"
  : `nur nach ${ZIEL_ARG.toUpperCase()} — ${schritte.length} Objekt(e)`}`);
console.log(`  Modus        ${ANWENDEN
  ? "APPLY — SCHREIBT in den Ziel-Bucket" : "Trockenlauf, schreibt nichts"}\n`);

/*
 * RIEGEL 2b — die Auswahl darf nicht leer sein. Eine stille Null waere die
 * unangenehmste Rueckmeldung: der Lauf sieht erfolgreich aus und hat nichts
 * getan.
 */
if (schritte.length === 0 && !PRUEFEN) {
  console.error(`\n  RIEGEL 2b — Abbruch: zur Richtung ${ZIEL_ARG} gibt es keinen `
    + `Bildschritt.\n\n  Diese Richtung hat nichts zu uebertragen. Fuer sie ist `
    + `\`--pruefen\` der richtige\n  Aufruf — er verifiziert lesend, was schon `
    + `uebertragen ist.\n`);
  process.exit(1);
}

/*
 * Riegel 3: jeder Pfad gehoert zu SEINER Figur. `system_set_image_override`
 * prueft dasselbe im Rumpf (0035) — hier faellt es schon vor dem Upload auf.
 */
const fremd = schritte.filter((s) => s.pfad.split("/")[0] !== s.sky_id);
if (fremd.length > 0) {
  console.error(`\n  RIEGEL 3 — Abbruch. ${fremd.length} Pfad(e) gehoeren nicht zu `
    + `ihrer Figur: ${fremd.map((f) => `${f.sky_id} -> ${f.pfad}`).join(", ")}\n`);
  process.exit(1);
}
console.log("  Riegel 3 ok — jeder Pfad traegt die SKY-ID seiner Figur\n");

/* --------------------------------------------------------------- Der Lauf */

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const nameAusPfad = (p: string) => p.split("/")[1].replace(/\.[a-z]+$/i, "");

/** Welche Pfade eine Umgebung referenziert. Nur `select`. */
async function referenzen(db: SupabaseClient): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let von = 0; ; von += 1000) {
    const { data, error } = await db.from("skylanders")
      .select("sky_id,image_override_path").order("sky_id").range(von, von + 999);
    if (error) {
      console.error(`\n  Abbruch: die Bildverweise liessen sich nicht lesen `
        + `(${error.message}).\n`);
      process.exit(1);
    }
    for (const r of data ?? []) {
      const x = r as Record<string, string | null>;
      if (x.image_override_path) out.set(x.image_override_path, x.sky_id as string);
    }
    if (!data || data.length < 1000) break;
  }
  return out;
}

/* ===========================================================================
 * DER PRUEFMODUS — liest, rechnet, vergleicht, schreibt nichts.
 *
 * Die URTEILE fallen in `src/lib/catalog/storage-verify.ts` — rein, ohne
 * Netz, und dort einzeln geprueft. Hier wird nur geladen und berichtet. Die
 * ganze Begruendung steht in diesem Modul.
 * =========================================================================== */
if (PRUEFEN) {
  const refS = await referenzen(S);
  const refP = await referenzen(P);
  const richtungen: ("staging" | "production")[] =
    ZIEL_ARG === null ? ["staging", "production"] : [ZIEL_ARG];

  const zeilen: (Urteil & { ziel: string })[] = [];

  for (const Z of richtungen) {
    const zielDb = Z === "production" ? P : S;
    const gegenDb = Z === "production" ? S : P;
    const refZ = Z === "production" ? refP : refS;

    const beidseitig = [...refS.keys()]
      .filter((pfad) => refP.has(pfad))
      .map((pfad) => ({ pfad, sky_id: refZ.get(pfad) ?? pfad.split("/")[0] }));
    const geplant = alleSchritte.filter((x) => x.ziel === Z)
      .map((x) => ({ pfad: x.pfad, sky_id: x.sky_id }));
    const bedarf: Bedarf[] = noetigeMenge(beidseitig, geplant);

    /*
     * EINE STILLE NULL WAERE DIE UNANGENEHMSTE RUECKMELDUNG: der Lauf sieht
     * erfolgreich aus und hat nichts geprueft. Dasselbe Prinzip wie Riegel 2b.
     */
    if (bedarf.length === 0) {
      console.error(`\n  PRUEFUNG — Abbruch: zur Richtung ${Z} gibt es nichts zu `
        + `pruefen.\n\n  Weder fuehrt der Plan einen Bildschritt dorthin, noch `
        + `referenzieren beide\n  Umgebungen einen gemeinsamen Pfad. Das ist kein `
        + `Erfolg, das ist ein\n  unerwarteter Zustand.\n`);
      process.exit(1);
    }

    console.log(`  [PRUEFUNG ${Z}] ${bedarf.length} benoetigte(s) Objekt(e) — `
      + `${bedarf.filter((b) => b.herkunft === "uebertragen").length} uebertragen, `
      + `${bedarf.filter((b) => b.herkunft === "geplant").length} geplant`);

    const lade = async (db: SupabaseClient, pfad: string): Promise<Objekt> => {
      const r = await db.storage.from(BUCKET).download(pfad);
      if (r.error || !r.data) return null;
      return { bytes: new Uint8Array(await r.data.arrayBuffer()) };
    };
    for (const b of bedarf) {
      zeilen.push({ ziel: Z, ...beurteile(b, await lade(zielDb, b.pfad),
                                          await lade(gegenDb, b.pfad)) });
    }
  }

  const z = zusammenfassung(zeilen);
  console.log(`\n  geprueft: ${z.geprueft}   in Ordnung: ${z.in_ordnung}   `
    + `noch nicht uebertragen: ${z.noch_nicht_uebertragen}   BEFUNDE: ${z.befunde}\n`);

  const BERICHT_P = `${BERICHT_BASIS}-pruefung${ZIEL_ARG ? `-${ZIEL_ARG}` : ""}.md`;
  writeFileSync(BERICHT_P, `# Bildobjekte pruefen — ${
    ZIEL_ARG ? `nur Richtung ${ZIEL_ARG.toUpperCase()}` : "beide Richtungen"}

**${new Date().toISOString()}**
**Dieser Lauf hat nichts geschrieben.** Kein \`upload\`, kein \`remove\`.

Geprueft wird, was dieser Abgleich braucht: die Pfade, die **beide**
Umgebungen referenzieren (also die schon uebertragenen), und die Pfade, die
der Plan noch in diese Richtung schreiben will. Jeder Pfad ist
inhaltsadressiert: die 16 Hexstellen des Dateinamens sind die ersten 16 des
SHA-256 ueber den Inhalt.

geprueft **${z.geprueft}** · in Ordnung **${z.in_ordnung}** · noch nicht
uebertragen **${z.noch_nicht_uebertragen}** · Befunde **${z.befunde}**

| Ziel | SKY-ID | Pfad | Herkunft | Bytes | SHA-256 (Ziel) | bytegleich | Zustand |
|---|---|---|---|---:|---|---|---|
${zeilen.map((u) => `| ${u.ziel} | ${u.sky_id} | \`${u.pfad}\` | ${u.herkunft} | `
  + `${u.groesse ?? "—"} | \`${(u.sha_ziel ?? "—").slice(0, 16)}\` | `
  + `${u.bytegleich === null ? "—" : u.bytegleich ? "ja" : "**NEIN**"} | `
  + `${u.zustand}${u.hinweis ? ` — ${u.hinweis}` : ""} |`).join("\n")}
`);
  console.log(`  geschrieben: ${BERICHT_P}`);
  if (!z.bestanden) {
    console.error(`\n  PRUEFUNG NICHT BESTANDEN — ${z.befunde} Befund(e):\n`);
    for (const u of zeilen.filter((x) => x.befund)) {
      console.error(`    ${u.ziel} ${u.pfad}: ${u.zustand} — ${u.hinweis}`);
    }
    console.error("");
    process.exit(1);
  }
  console.log("  ETAPPE A IN ORDNUNG — alle benoetigten Objekte vorhanden und korrekt.\n");
  process.exit(0);
}

type Ergebnis = Schritt & {
  zustand: string; groesse: number | null; sha_quelle: string | null;
  sha_ziel: string | null; bytegleich: boolean | null; hinweis: string;
};
const ergebnisse: Ergebnis[] = [];

if (ANWENDEN && ZIEL_ARG === "production") {
  await confirmProductionWrite("storage:transfer", `${schritte.length} Objekt(e) nach Production uebertragen.`);
}
for (const s of schritte) {
  const quelle = s.ziel === "production" ? S : P;
  const ziel = s.ziel === "production" ? P : S;
  const e: Ergebnis = { ...s, zustand: "", groesse: null, sha_quelle: null,
    sha_ziel: null, bytegleich: null, hinweis: "" };

  // 1. Quelle laden.
  const q = await quelle.storage.from(BUCKET).download(s.pfad);
  if (q.error || !q.data) {
    e.zustand = "QUELLE FEHLT"; e.hinweis = q.error?.message ?? "kein Inhalt";
    ergebnisse.push(e); continue;
  }
  const buf = Buffer.from(await q.data.arrayBuffer());
  e.groesse = buf.byteLength;
  e.sha_quelle = sha(buf);

  // Pruefung 1: der Name IST die Pruefsumme.
  if (!e.sha_quelle.startsWith(nameAusPfad(s.pfad))) {
    e.zustand = "NAME PASST NICHT ZUM INHALT";
    e.hinweis = `Name ${nameAusPfad(s.pfad)}, SHA ${e.sha_quelle.slice(0, 16)}`;
    ergebnisse.push(e); continue;
  }

  // 2. Liegt im Ziel schon etwas? Dann NICHT ueberschreiben.
  const vorhanden = await ziel.storage.from(BUCKET)
    .list(s.pfad.split("/")[0], { limit: 1000 });
  const da = (vorhanden.data ?? []).some((x) => x.name === s.pfad.split("/")[1]);
  if (da) {
    e.zustand = "ZIEL HAT SCHON EIN OBJEKT — uebersprungen";
    e.hinweis = "upsert ist aus; ein vorhandener Pfad wird nie ersetzt";
    ergebnisse.push(e); continue;
  }

  if (!ANWENDEN) {
    e.zustand = "BEREIT (Trockenlauf, nichts geschrieben)";
    ergebnisse.push(e); continue;
  }

  // 3. Hochladen — ohne upsert, also niemals ueberschreibend.
  const up = await ziel.storage.from(BUCKET).upload(s.pfad, buf, {
    contentType: q.data.type || undefined, upsert: false,
  });
  if (up.error) {
    e.zustand = "UPLOAD FEHLGESCHLAGEN"; e.hinweis = up.error.message;
    ergebnisse.push(e); break;
  }

  // 4. Zurueckladen und Byte fuer Byte vergleichen.
  const z = await ziel.storage.from(BUCKET).download(s.pfad);
  if (z.error || !z.data) {
    e.zustand = "RUECKLESEN FEHLGESCHLAGEN"; e.hinweis = z.error?.message ?? "";
    ergebnisse.push(e); break;
  }
  const zbuf = Buffer.from(await z.data.arrayBuffer());
  e.sha_ziel = sha(zbuf);
  e.bytegleich = buf.equals(zbuf);
  if (!e.bytegleich || e.sha_ziel !== e.sha_quelle) {
    e.zustand = "UEBERTRAGEN, ABER NICHT GLEICH";
    e.hinweis = "das Objekt liegt im Ziel und weicht ab — von Hand pruefen";
    ergebnisse.push(e); break;
  }
  e.zustand = "uebertragen und bytegleich";
  ergebnisse.push(e);
}

/* ---------------------------------------------------------------- Bericht */

const n = (z: string) => ergebnisse.filter((e) => e.zustand.startsWith(z)).length;
console.log(`  bereit: ${n("BEREIT")}  uebertragen: ${n("uebertragen")}  `
  + `uebersprungen: ${n("ZIEL HAT")}  Fehler: ${ergebnisse.filter((e) =>
      /FEHLT|FEHLGESCHLAGEN|NICHT/.test(e.zustand)).length}\n`);

const BERICHT = `${BERICHT_BASIS}${ZIEL_ARG ? `-${ZIEL_ARG}` : ""}.md`;
writeFileSync(BERICHT, `# Bildobjekte uebertragen — ${ANWENDEN ? "LAUF" : "Trockenlauf"}${
  ZIEL_ARG ? `, nur nach ${ZIEL_ARG.toUpperCase()}` : ", beide Richtungen"}

**${new Date().toISOString()}**${ANWENDEN ? "" : "\n**Dieser Lauf hat nichts geschrieben.**"}

Bucket \`${BUCKET}\` auf beiden Seiten. ${schritte.length} von
${alleSchritte.length} Schritten aus \`${PLAN}\`. Jeder Pfad ist
inhaltsadressiert: die 16 Hexstellen des Dateinamens sind die ersten 16 des
SHA-256 ueber den Inhalt.

| Ziel | SKY-ID | Pfad | Bytes | SHA-256 (Quelle) | bytegleich | Zustand |
|---|---|---|---:|---|---|---|
${ergebnisse.map((e) => `| ${e.ziel} | ${e.sky_id} | \`${e.pfad}\` | ${e.groesse ?? "—"} | `
  + `\`${(e.sha_quelle ?? "—").slice(0, 16)}\` | ${e.bytegleich === null ? "—" : e.bytegleich ? "ja" : "**NEIN**"} | `
  + `${e.zustand}${e.hinweis ? ` — ${e.hinweis}` : ""} |`).join("\n")}

**Es wurde nichts ueberschrieben und nichts geloescht.** \`upsert\` ist aus,
und \`storage.remove\` kommt in \`tools/storage-transfer.mts\` nicht vor.
`);
console.log(`  geschrieben: ${BERICHT}`);
if (!ANWENDEN) console.log("  DIESER LAUF HAT NICHTS GESCHRIEBEN.\n");

/*
 * EIN BEFUND MUSS EINEN FEHLERCODE HABEN.
 *
 * *** EINE LUECKE, DIE ERST AM 2026-10-31 AUFFIEL ***
 *
 * Diese Datei meldete "Fehler: 3" und endete mit Code 0. Der Abschlusslauf
 * ruft sie ueber `execFileSync` auf und bricht nur bei einem Fehlercode ab —
 * ein fehlgeschlagener Upload, ein nicht bytegleiches Objekt oder ein Name,
 * der nicht zum Inhalt passt, waere also BERICHTET und UEBERGANGEN worden,
 * und Etappe C haette darauf aufgebaut.
 *
 * Ein Zustand, der im Bericht fett gedruckt ist, darf den Aufrufer nicht
 * mit "alles gut" verlassen.
 */
const befundhaft = ergebnisse.filter((e) =>
  /FEHLT|FEHLGESCHLAGEN|NICHT/.test(e.zustand));
if (befundhaft.length > 0) {
  console.error(`\n  ABBRUCH — ${befundhaft.length} Befund(e):\n`);
  for (const e of befundhaft) {
    console.error(`    ${e.ziel} ${e.pfad}: ${e.zustand}${e.hinweis ? ` — ${e.hinweis}` : ""}`);
  }
  console.error("\n  Was hochgeladen wurde, liegt an Ort und Stelle. Es wird nichts\n"
    + "  zurueckgerollt und nichts geloescht.\n");
  process.exit(1);
}
