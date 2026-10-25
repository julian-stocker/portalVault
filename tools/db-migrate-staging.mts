/**
 * EIN BEFEHL FUER EINE MIGRATION AUF STAGING.
 *
 *   npm run db:migrate:staging -- 0146
 *   npm run db:migrate:staging -- 0146 --resume
 *
 * WAS ER LOEST. Der Laufzettel verlangte bisher vier Handgriffe: Preflight
 * fahren, Zeile 900 und 901 von Hand kopieren, zwei Platzhalter in der
 * Nachkontrolle ersetzen, Nachkontrolle fahren. Bei `0145` UND bei `0146`
 * ist genau der zweite und dritte Schritt vergessen worden — und beide Male
 * meldete die Nachkontrolle `9999 = 18`: achtzehn rote Zeilen, und zwar
 * ausschliesslich die der Baseline-Uebergabe. Die Riegel haben also
 * funktioniert; der Ablauf war der Fehler.
 *
 * ==========================================================================
 * WAS DIESER RUNNER NICHT KANN, UND WARUM NICHT
 * ==========================================================================
 *
 * ER KANN DIE MIGRATION NICHT ANWENDEN. Der lesende Pruefzugang
 * (`skyisles_agent`) ist an der ROLLE auf `default_transaction_read_only`
 * gesetzt, und das ist kein Versehen, sondern die Absicherung, die dieses
 * Projekt bewusst gebaut hat (`docs/SECURITY.md`, 4b). Es gibt auch keinen
 * zweiten Weg: der Dienstschluessel laeuft ueber PostgREST und kann kein
 * DDL, und eine `exec_sql`-Funktion existiert nicht — nachgesehen, nicht
 * vermutet.
 *
 * Einen schreibenden Zugang dafuer anzulegen waere die falsche
 * Vereinfachung: er muesste DDL duerfen, also alles, und er laege in einer
 * Datei auf diesem Rechner. Der Preis fuer „ein Befehl" waere eine
 * Schluesseldatei mit Vollzugriff auf Staging.
 *
 * ALSO: EIN BEFEHL, EIN EINFUEGEN, EIN BEFEHL. Der Runner macht alles
 * Lesende und alles Rechnende; die eine schreibende Anweisung fuegt der
 * Bediener ein — OHNE etwas daran zu aendern. Genau die Handarbeit, die
 * schiefgegangen ist, faellt weg.
 *
 * ==========================================================================
 *
 * DIE BAULINIE: BASELINES WERDEN VOR DER MIGRATION EINGEFROREN.
 *
 * Nach dem Preflight schreibt der Runner die Vertragszeilen in eine Akte
 * (`supabase/baselines/baseline-<nr>.json`) und liest sie fuer die
 * Nachkontrolle von DORT. Er erhebt sie nach der Migration NIE neu — das
 * waere der eine Fehler, der alle Abweichungen verschwinden laesst und
 * nichts beweist. Steht die Akte schon, wird sie nicht ueberschrieben.
 *
 * JEDE EINGEFRORENE ZEILE IST GEPRUEFT. `tools/lib/baseline.mts` rechnet
 * Marke, Feldzahl und Schutzsumme nach, bevor etwas in die Akte kommt. Eine
 * beschaedigte Baseline soll gar nicht erst aufgeschrieben werden.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  bericht, fahreEintrag, offeneZeilen, protokoll,
  type Befund, type SuiteEintrag,
} from "./db-check-staging.mts";
import type { Zeile } from "./lib/staging-db.mts";
import { pruefeBaseline, VERTRAEGE, type VertragsName } from "./lib/baseline.mts";
import {
  ERWARTETER_STEMPEL, STAGING_REF, ladeUmgebung, redigiere, verbindeStaging,
} from "./lib/staging-db.mts";

const CHECK_DIR = "supabase/checks";
const OPS_DIR = "supabase/operations";
const PLAENE = join(CHECK_DIR, "migration-plans.json");
/*
 * ZWEI VERZEICHNISSE, ZWEI AUFGABEN.
 *
 * `AKTE_DIR` ist VERSIONIERT. Die eingefrorenen Baselines sind Teil der
 * Akte eines Rollouts — wie `APPLIED.md` —, und ein Wiederaufnahmelauf muss
 * sie auch nach einem frischen Clone finden. Sie enthalten Zaehlstaende und
 * Pruefsummen, keine Namen und keine Adressen.
 *
 * `LOG_DIR` ist Laufausgabe und bleibt ungetrackt (`.gitignore`).
 */
const AKTE_DIR = "supabase/baselines";
const LOG_DIR = "supabase/log/staging";

/* ------------------------------------------------------------------ Plaene */

export type Plan = {
  zweck: string;
  preflight: string;
  lauf: string;
  postflight: string;
  angewendet: { beschreibung: string; sql: string };
  liefert: Partial<Record<VertragsName, number>>;
  braucht: VertragsName[];
};

export function ladePlaene(pfad = PLAENE): Record<string, Plan> {
  const d = JSON.parse(readFileSync(pfad, "utf8")) as { migrationen: Record<string, Plan> };
  return d.migrationen;
}

/* ------------------------------------------------------------------- Akte */

export type Akte = {
  migration: string;
  /** Wann die Baselines erhoben wurden — VOR der Migration. */
  erhoben: string;
  /** Woher sie kommen. `preflight` oder `bediener` (einmalige Nachtragung). */
  herkunft: "preflight" | "bediener";
  /** Der Lauf, aus dem sie stammen, als SHA-256 der Preflight-Datei. */
  preflightSha256: string | null;
  vertraege: Record<string, string>;
  bemerkung?: string;
};

export const aktePfad = (nr: string, dir = AKTE_DIR): string =>
  join(dir, `baseline-${nr}.json`);

/**
 * Die Akte lesen und JEDE Zeile nachrechnen.
 *
 * Eine Akte, der man blind glaubt, ist keine Akte. Dass eine Datei auf der
 * Platte liegt, heisst nicht, dass ihr Inhalt heil ist.
 */
export function ladeAkte(pfad: string): { ok: true; akte: Akte } | { ok: false; grund: string } {
  if (!existsSync(pfad)) return { ok: false, grund: `${pfad} gibt es nicht.` };
  let akte: Akte;
  try {
    akte = JSON.parse(readFileSync(pfad, "utf8")) as Akte;
  } catch (e) {
    return { ok: false, grund: `${pfad} ist kein gueltiges JSON: ${String(e)}` };
  }
  for (const [name, wert] of Object.entries(akte.vertraege ?? {})) {
    const u = pruefeBaseline(wert);
    if (!u.ok) return { ok: false, grund: `${pfad}, ${name}: ${u.grund}` };
    if (u.name !== name) {
      return {
        ok: false,
        grund: `${pfad}: unter "${name}" steht eine Zeile mit der Marke `
          + `"${u.marke}" — sie gehoert zu "${u.name}".`,
      };
    }
  }
  return { ok: true, akte };
}

/* --------------------------------------------------------------- Werkzeuge */

const nr = (z: Record<string, unknown>): number => Number(z.nr);

/** Die Vertragszeilen aus einem Preflight-Befund ziehen und pruefen. */
export function sammleBaselines(
  befund: Befund, liefert: Partial<Record<VertragsName, number>>,
): { ok: true; vertraege: Record<string, string> } | { ok: false; grund: string } {
  const out: Record<string, string> = {};
  for (const [name, zeile] of Object.entries(liefert) as [VertragsName, number][]) {
    const treffer = befund.zeilen.find((z) => nr(z as Record<string, unknown>) === zeile);
    if (treffer === undefined) {
      return { ok: false, grund: `der Preflight hat keine Zeile ${zeile} (${name}).` };
    }
    const roh = String((treffer as Record<string, unknown>).befund ?? "");
    const u = pruefeBaseline(roh);
    if (!u.ok) return { ok: false, grund: `Zeile ${zeile} (${name}): ${u.grund}` };
    if (u.name !== name) {
      return {
        ok: false,
        grund: `Zeile ${zeile} sollte "${name}" liefern, traegt aber die Marke `
          + `"${u.marke}".`,
      };
    }
    out[name] = roh;
  }
  return { ok: true, vertraege: out };
}

/*
 * ABBRUCH, und zwar so, dass TypeScript es GLAUBT.
 *
 * `const ab = (t: string): never => …` genuegt nicht: fuer die
 * Kontrollflussanalyse muss die VARIABLE den Typ tragen, nicht nur die
 * Funktion. Ohne das verengte TS nach `if (!x.ok) ab(...)` nicht, und jeder
 * Zugriff auf `x.vertraege` darunter war ein Fehler.
 */
/* ---------------------------------------------------------------- Ablauf */

/**
 * Was der Ablauf braucht, um zu entscheiden — und nichts darueber hinaus.
 *
 * WARUM EINGESETZT UND NICHT FEST VERDRAHTET. Die Zusagen dieses Runners
 * sind Zusagen UEBER EINE REIHENFOLGE: Baselines vor der Migration, kein
 * zweiter Lauf nach einem roten Postflight, Abbruch bei unklarem Stand. Eine
 * Reihenfolge laesst sich nur pruefen, indem man sie durchlaeuft. Mit fest
 * verdrahteter Verbindung waere jede dieser Zusagen nur im Kommentar
 * behauptet und erst im Ernstfall gegen Staging ueberpruefbar — und genau
 * das ist die Lage, aus der die achtzehn Abweichungen entstanden sind.
 *
 * Die Dateiablage ist ABSICHTLICH echt und nicht eingesetzt: die Akte ist
 * der Kern der Zusage, und ein Test soll sie wirklich schreiben und wirklich
 * zurueckgelesen bekommen. Dafuer genuegt ein eigenes `akteDir`.
 */
export type Werkzeuge = {
  /** Lesender Zugang. Nur `angewendet.sql` laeuft hierueber. */
  db: { fuehre(sql: string): Promise<Record<string, unknown>[][]> };
  /** Eine Pruefdatei fahren — mit den Vertragszeilen in derselben Einreichung. */
  fahre(eintrag: SuiteEintrag, vertraege: ReadonlyMap<string, string>): Promise<Befund>;
  plaene: Record<string, Plan>;
  akteDir: string;
  /** Wo die Pruefdateien liegen — gebraucht fuer die erzeugte Huelle. */
  checkDir: string;
  /** Wohin die erzeugte Huelle geschrieben wird. */
  logDir: string;
  jetzt(): Date;
  melde(text: string): void;
};

/** Wo der Ablauf stehengeblieben ist. Fuer Tests und fuer den Bericht. */
export type Stufe =
  | "plan" | "stand" | "liegt-schon" | "liegt-noch-nicht"
  | "preflight" | "baselines" | "akte" | "nachkontrolle" | "verbindung";

export type Ablauf =
  /** Preflight bestanden, Baselines eingefroren — jetzt die eine Handarbeit. */
  | { ende: "handarbeit"; befunde: Befund[]; akte: string;
      vertraege: ReadonlyMap<string, string>; neu: boolean }
  /**
   * Nachkontrolle bestanden, 9999 = 0.
   *
   * `offen` sind Zeilen, die der lesende Pruefzugang nicht lesen DURFTE —
   * nicht bestanden, nicht abgewichen, sondern nicht durchgefuehrt. Sie
   * gehoeren in den berechtigten Weg, und `huelle` ist die dafuer
   * erzeugte, einfuegefertige Datei.
   */
  | { ende: "bestanden"; befunde: Befund[]; vertraege: ReadonlyMap<string, string>;
      offen: Zeile[]; huelle: string | null }
  /** Sicher abgebrochen. `befunde` ist alles, was bis dahin gemessen wurde. */
  | { ende: "abbruch"; stufe: Stufe; grund: string; befunde: Befund[] };

/**
 * Die Entscheidungsfolge. Sie faellt kein Urteil ueber die Umgebung — das
 * hat `verbindeStaging()` schon getan, bevor ein Werkzeug entstand — und sie
 * schreibt nichts in die Datenbank.
 *
 * SIE BEENDET DEN PROZESS NICHT. Jeder Abbruch ist ein Rueckgabewert; das
 * Beenden ist Sache der Huelle unten. Sonst waere ein Abbruch nicht
 * pruefbar, sondern nur beobachtbar.
 */
export async function fahreAblauf(
  w: Werkzeuge, nummer: string, resume: boolean,
): Promise<Ablauf> {
  const befunde: Befund[] = [];
  const plan = w.plaene[nummer];
  if (plan === undefined) {
    return { ende: "abbruch", stufe: "plan", befunde, grund:
      `fuer ${nummer} gibt es keinen Plan in ${PLAENE}.\n`
      + "  Eine neue Migration braucht dort einen Eintrag — und keinen neuen Code.\n"
      + `  Bekannt: ${Object.keys(w.plaene).join(", ")}` };
  }

  try {
    /*
     * 1. LIEGT SIE SCHON? Die Antwort entscheidet ueber den
     *    Wiederaufnahmemodus — und sie muss zweifelsfrei sein. Eine Abfrage,
     *    die nicht genau eine Zeile mit `erfuellt` liefert, ist keine
     *    Antwort, sondern eine Vermutung; dann wird abgebrochen.
     */
    const antwort = (await w.db.fuehre(plan.angewendet.sql))[0];
    if (antwort === undefined || antwort.length !== 1 || !("erfuellt" in antwort[0])) {
      return { ende: "abbruch", stufe: "stand", befunde, grund:
        `der Stand von ${nummer} ist nicht zweifelsfrei feststellbar: die Abfrage\n`
        + `  "${plan.angewendet.beschreibung}" liefert keine eindeutige Antwort.\n`
        + "  Abgebrochen. Nichts wurde geschrieben." };
    }
    const liegtSchon = antwort[0].erfuellt === true;
    w.melde(`  Stand:     ${plan.angewendet.beschreibung} → `
      + `${liegtSchon ? "JA, liegt schon" : "nein"}`);

    if (liegtSchon && !resume) {
      return { ende: "abbruch", stufe: "liegt-schon", befunde, grund:
        `${nummer} liegt auf Staging schon (${plan.angewendet.beschreibung}).\n`
        + "  Sie wird NICHT erneut angewendet.\n\n"
        + "  Fuer die Nachkontrolle mit den urspruenglichen Baselines:\n"
        + `      npm run db:migrate:staging -- ${nummer} --resume` };
    }
    if (!liegtSchon && resume) {
      return { ende: "abbruch", stufe: "liegt-noch-nicht", befunde, grund:
        `--resume, aber ${nummer} liegt noch nicht (${plan.angewendet.beschreibung}).\n`
        + "  Es gibt keine Nachkontrolle wiederaufzunehmen. Ohne --resume starten." };
    }

    const akte = aktePfad(nummer, w.akteDir);

    if (!resume) {
      /* ---------------------------------------------- 2. PREFLIGHT */
      w.melde("");
      w.melde("  Preflight …");
      const b = await w.fahre(
        { datei: plan.preflight, zweck: `${nummer} Preflight`, modus: "9999" }, new Map());
      befunde.push(b);
      w.melde(bericht([b]));
      if (b.status !== "ok") {
        return { ende: "abbruch", stufe: "preflight", befunde, grund:
          "der Preflight ist NICHT bestanden. Die Migration wird nicht angewendet.\n"
          + "  Erst die Ursache klaeren — nichts davon verschwindet durch einen\n"
          + "  zweiten Lauf." };
      }

      /* ------------------------- 3. BASELINES EINFRIEREN, VOR der Migration */
      const gesammelt = sammleBaselines(b, plan.liefert);
      if (!gesammelt.ok) {
        return { ende: "abbruch", stufe: "baselines", befunde, grund:
          `die Baselines sind nicht uebernehmbar: ${gesammelt.grund}\n`
          + "  Abgebrochen, bevor etwas eingefroren wurde." };
      }

      let vertraege: Map<string, string>;
      let neu: boolean;
      if (existsSync(akte)) {
        /*
         * EINE VORHANDENE AKTE GEWINNT. Sie ist der Stand VOR der Migration;
         * was der Preflight heute misst, ist es moeglicherweise nicht mehr.
         * Ueberschreiben hiesse, den Beweis durch die Gegenwart zu ersetzen.
         */
        const alt = ladeAkte(akte);
        if (!alt.ok) {
          return { ende: "abbruch", stufe: "akte", befunde, grund:
            `${akte} liegt schon, ist aber beschaedigt: ${alt.grund}` };
        }
        w.melde(`  Akte:      ${akte} liegt schon (erhoben ${alt.akte.erhoben}) — `
          + "sie wird NICHT ueberschrieben.");
        vertraege = new Map(Object.entries(alt.akte.vertraege));
        neu = false;
      } else {
        const inhalt: Akte = {
          migration: nummer,
          erhoben: w.jetzt().toISOString(),
          herkunft: "preflight",
          preflightSha256: b.sha256,
          vertraege: gesammelt.vertraege,
        };
        mkdirSync(w.akteDir, { recursive: true });
        writeFileSync(akte, `${JSON.stringify(inhalt, null, 2)}\n`, "utf8");
        w.melde(`  Akte:      ${akte} geschrieben — ab hier unveraendert.`);
        vertraege = new Map(Object.entries(gesammelt.vertraege));
        neu = true;
      }
      for (const [name, wert] of vertraege) {
        w.melde(`             ${name} = ${wert.slice(0, 28)}… `
          + `(Zeile ${VERTRAEGE[name as VertragsName].zeile})`);
      }
      return { ende: "handarbeit", befunde, akte, vertraege, neu };
    }

    /* ------------------------------------- 4. NACHKONTROLLE (Wiederaufnahme) */
    const gelesen = ladeAkte(akte);
    if (!gelesen.ok) {
      return { ende: "abbruch", stufe: "akte", befunde, grund:
        "die eingefrorenen Baselines fehlen oder sind unbrauchbar:\n"
        + `  ${gelesen.grund}\n\n`
        + "  Sie werden NICHT neu erhoben — nach der Migration erhoben waeren sie\n"
        + "  der aktuelle Stand, und dann verglichen sich die Daten mit sich\n"
        + "  selbst. Fehlt die Akte, muss sie aus dem Protokoll des damaligen\n"
        + "  Preflights nachgetragen werden." };
    }
    const vertraege = new Map(Object.entries(gelesen.akte.vertraege));
    for (const name of plan.braucht) {
      if (!vertraege.has(name)) {
        return { ende: "abbruch", stufe: "akte", befunde, grund:
          `die Akte ${akte} hat keinen Vertrag "${name}", die Nachkontrolle `
          + "braucht ihn aber." };
      }
    }
    w.melde("");
    w.melde(`  Akte:      ${akte}`);
    w.melde(`             erhoben ${gelesen.akte.erhoben} · `
      + `Herkunft ${gelesen.akte.herkunft}`);
    for (const [name, wert] of vertraege) w.melde(`             ${name} = ${wert}`);

    w.melde("");
    w.melde("  Nachkontrolle …");
    const b = await w.fahre(
      { datei: plan.postflight, zweck: `${nummer} Nachkontrolle`, modus: "9999" }, vertraege);
    befunde.push(b);
    w.melde(bericht([b]));

    if (b.status !== "ok") {
      return { ende: "abbruch", stufe: "nachkontrolle", befunde, grund:
        "die Nachkontrolle ist NICHT bestanden.\n"
        + "  Die Migration wird deshalb NICHT erneut angewendet — sie liegt schon,\n"
        + "  und ein zweiter Lauf wuerde an ihrer eigenen Vorbedingung abprallen.\n"
        + "  Oben steht, welche Zeilen abweichen." };
    }
    /*
     * OFFENE ZEILEN: DIE EINE DATEI, DIE DEN REST ERLEDIGT.
     *
     * Der Runner hat die eingefrorenen Baselines — also schreibt er sie
     * gleich mit hinein, statt den Bediener wieder Platzhalter ersetzen zu
     * lassen. Das ist dieselbe Lehre wie bei den achtzehn Abweichungen: ein
     * Handgriff, den ein Werkzeug tun kann, gehoert nicht auf den
     * Laufzettel.
     */
    const offen = offeneZeilen(b);
    const huelle = offen.length === 0
      ? null
      : schreibeBerechtigteHuelle(w, nummer, plan.postflight, vertraege);
    return { ende: "bestanden", befunde, vertraege, offen, huelle };
  } catch (e) {
    /*
     * VERBINDUNGSABBRUCH UND ALLES ANDERE UNERWARTETE.
     *
     * Ein Abbruch ist hier IMMER sicher, und zwar nicht weil sorgfaeltig
     * aufgeraeumt wird, sondern weil es nichts aufzuraeumen gibt: dieser
     * Runner hat keinen schreibenden Zugang. Er kann keine halbe Migration
     * hinterlassen. Was er hinterlassen kann, ist eine Akte — und die wird
     * erst nach einem bestandenen Preflight geschrieben und danach nie
     * geaendert.
     *
     * Die Meldung wird redigiert: eine Verbindungsmeldung kann die
     * Zeichenkette samt Kennwort enthalten.
     */
    return { ende: "abbruch", stufe: "verbindung", befunde, grund:
      `unterbrochen: ${redigiere(e instanceof Error ? e.message : String(e))}\n`
      + "  Nichts wurde geschrieben; die Migration wurde nicht angewendet." };
  }
}

/* --------------------------------------------------------------- Huelle */

const ab: (text: string) => never = (text) => {
  console.error(`\n  ${text}\n`);
  process.exit(1);
};

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const resume = argv.includes("--resume");
  const nummer = argv.find((a) => /^\d{4}$/.test(a));

  console.log("");
  console.log("  MIGRATION AUF STAGING");
  console.log("  ---------------------");

  if (nummer === undefined) {
    ab("Aufruf: npm run db:migrate:staging -- <nummer> [--resume]\n"
      + `  Bekannt: ${Object.keys(ladePlaene()).join(", ")}`);
  }

  /*
   * DIE UMGEBUNG. `verbindeStaging` prueft die Verbindungszeichenkette
   * (keine Production-Kennung, `sslmode` vorhanden), verbindet und liest den
   * Datenbankstempel samt `transaction_read_only`. Drei Riegel, und keiner
   * davon ist hier noch einmal nachgebaut — eine zweite Pruefung waere eine
   * zweite Wahrheit darueber, was Staging ist.
   *
   * Dieselbe Zugangsdatei wie `db:check:staging` — ausserhalb des
   * Repositorys, `chmod 600` (`docs/SECURITY.md`).
   */
  ladeUmgebung(`${process.env.HOME ?? ""}/.skyisles/staging-db.env`);
  const db = await verbindeStaging();
  const plaene = ladePlaene();
  console.log(`  Ziel:      ${STAGING_REF}  ·  ${ERWARTETER_STEMPEL}`);
  console.log(`  Zugang:    lesend, Sitzung schreibgeschuetzt`);
  console.log(`  TLS:       ${db.tls}`);
  console.log(`  Migration: ${nummer} — ${plaene[nummer!]?.zweck ?? "unbekannt"}`);
  console.log("");

  let ergebnis: Ablauf;
  try {
    ergebnis = await fahreAblauf({
      db,
      fahre: (eintrag, vertraege) => fahreEintrag(db, eintrag, CHECK_DIR, vertraege),
      plaene,
      akteDir: AKTE_DIR,
      checkDir: CHECK_DIR,
      logDir: LOG_DIR,
      jetzt: () => new Date(),
      melde: (text) => console.log(text),
    }, nummer!, resume);
  } finally {
    await db.schliesse();
  }

  /* Das Protokoll wird IMMER geschrieben, auch bei Abbruch — gerade dann. */
  if (ergebnis.befunde.length > 0) schreibeProtokoll(nummer!, ergebnis.befunde);

  if (ergebnis.ende === "abbruch") ab(ergebnis.grund);

  if (ergebnis.ende === "handarbeit") {
    const plan = plaene[nummer!]!;
    console.log("");
    console.log("  ========================================================");
    console.log("  JETZT DIE MIGRATION ANWENDEN — die eine Anweisung, die");
    console.log("  dieser Runner nicht geben kann (siehe Kopf der Datei).");
    console.log("");
    console.log(`      ${join(OPS_DIR, plan.lauf)}`);
    console.log("");
    console.log("  Vollstaendig markieren, in den SQL-Editor von");
    console.log(`  ${STAGING_REF} einfuegen, ausfuehren. NICHTS daran aendern.`);
    console.log("  Erwartet: die NOTICE-Zeile der Migration und `commit`.");
    console.log("");
    console.log("  Danach:");
    console.log(`      npm run db:migrate:staging -- ${nummer} --resume`);
    console.log("  ========================================================");
    console.log("");
    return;
  }

  if (ergebnis.offen.length === 0) {
    console.log("  BESTANDEN. 9999 = 0, Baselines unveraendert uebernommen,");
    console.log("  jede Zeile geprueft (9998 = 0).");
    console.log("");
    return;
  }

  /*
   * NICHT ALS BESTANDEN AUSGEBEN. `9999 = 0` heisst hier: null Abweichungen
   * UNTER DEN DURCHGEFUEHRTEN Pruefungen. Was offen ist, wird benannt — und
   * der Weg dazu steht gleich darunter.
   */
  console.log("  9999 = 0 — keine Abweichung unter den durchgefuehrten Pruefungen.");
  console.log("  Baselines unveraendert uebernommen.");
  console.log("");
  console.log(`  OFFEN: ${ergebnis.offen.length} Zeile(n) darf dieser Zugang nicht lesen.`);
  for (const o of ergebnis.offen) {
    console.log(`         ${o.nr} ${String(o.pruefung)}`);
  }
  console.log("");
  console.log("  ========================================================");
  console.log("  DIESE EINE DATEI SCHLIESST SIE AB — im SQL-Editor von");
  console.log(`  ${STAGING_REF}, als \`postgres\`:`);
  console.log("");
  console.log(`      ${ergebnis.huelle}`);
  console.log("");
  console.log("  Die Baselines sind darin schon eingesetzt. Erwartet:");
  console.log("  Zeile 9998 = 0 UND Zeile 9999 = 0.");
  console.log("  ========================================================");
  console.log("");
}

/**
 * Die einfuegefertige Datei fuer den berechtigten Weg.
 *
 * Inhalt: `begin`, die beiden Vertragszeilen als `set_config`, die
 * Pruefdatei Zeichen fuer Zeichen, `rollback`. Dieselbe Datei wie der
 * Runner fahrt — nur als `postgres` ausgefuehrt, und dann liefern die
 * rechtegeschuetzten Zeilen ihren echten Wert statt `KEIN-RECHT`.
 *
 * Sie landet in `LOG_DIR` (ungetrackt): sie enthaelt die Zaehlstaende der
 * Baselines, und sie ist Laufausgabe, kein Quelltext.
 */
function schreibeBerechtigteHuelle(
  w: Werkzeuge, nummer: string, postflight: string,
  vertraege: ReadonlyMap<string, string>,
): string {
  const pruefdatei = readFileSync(join(w.checkDir, postflight), "utf8");
  const zeilen = [
    "-- =====================================================================",
    `-- ${nummer} — DIE OFFENEN ZEILEN DER NACHKONTROLLE, REIN LESEND`,
    "--",
    "-- Vom Runner erzeugt. Vollstaendig markieren, in den SQL-Editor von",
    `-- ${STAGING_REF} einfuegen, ausfuehren. NICHTS daran aendern.`,
    "--",
    "-- WOZU. Einige Zeilen lesen Objekte, auf die der lesende Pruefzugang",
    "-- kein `select` hat; bei ihm liefern sie `KEIN-RECHT` und zaehlen in",
    "-- Zeile 9998. Hier laeuft dieselbe Datei als `postgres`: 9998 muss 0",
    "-- sein und 9999 ebenfalls.",
    "--",
    "-- Die Baselines sind EINGESETZT — aus der eingefrorenen Akte, nicht",
    "-- neu erhoben. Kein Platzhalter, kein Kopieren.",
    "--",
    "-- `begin … rollback`: diese Datei schreibt nichts.",
    "-- =====================================================================",
    "",
    "begin;",
    "",
  ];
  for (const [name, wert] of vertraege) {
    /* Einfache Anfuehrungszeichen verdoppeln — dieselbe Regel wie in
       `fahreEintrag`. */
    zeilen.push(`select set_config('${name}', '${wert.replace(/'/g, "''")}', true);`);
  }
  zeilen.push("");
  zeilen.push(`-- >>> EINGEBETTET: ${join(w.checkDir, postflight)}`);
  zeilen.push(pruefdatei.replace(/\n$/, ""));
  zeilen.push(`-- <<< ENDE: ${join(w.checkDir, postflight)}`);
  zeilen.push("");
  zeilen.push("rollback;");
  zeilen.push("");

  mkdirSync(w.logDir, { recursive: true });
  const pfad = join(w.logDir, `${nummer}-postflight-berechtigt.sql`);
  writeFileSync(pfad, zeilen.join("\n"), "utf8");
  return pfad;
}

function schreibeProtokoll(nummer: string, befunde: Befund[]): void {
  const zeitpunkt = new Date();
  mkdirSync(LOG_DIR, { recursive: true });
  const name = `migrate-${nummer}-${zeitpunkt.toISOString().replace(/[:.]/g, "-")}.md`;
  const pfad = join(LOG_DIR, name);
  writeFileSync(pfad, protokoll(befunde, zeitpunkt), "utf8");
  console.log(`  Protokoll: ${pfad}`);
}

/* Nur beim direkten Aufruf. Der Ablauf oben ist ohne Datenbank pruefbar. */
if (process.argv[1]?.endsWith("db-migrate-staging.mts")) {
  main().catch((e) => {
    console.error(`\n  ABBRUCH: ${redigiere(e instanceof Error ? e.message : String(e))}\n`);
    process.exit(1);
  });
}
