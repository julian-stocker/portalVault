/**
 * Was koennte ein Prozess in diesem Verzeichnis erreichen?
 *
 *   npm run env:audit
 *
 * ZWEI TEILE, UND NUR EINER IST EIN TOR.
 *
 *   PHASE A (blockierend). Der lesende Staging-Zugang muss eingerichtet sein,
 *   und in dieser Prozessumgebung darf keine Production-Kennung stecken.
 *   Phase A braucht KEINE Production-Zugangsdaten — sie liest keine, sie
 *   verschiebt keine, sie importiert keine.
 *
 *   PRODUCTION (Information). Dass `.env.local` im Verzeichnis liegt und 18
 *   Skripte darauf zeigen, ist der heutige Zustand und bleibt es: die
 *   Absicherung von Production ist ein EIGENES Vorhaben mit eigener
 *   Entscheidung. Dieses Werkzeug zaehlt es auf, bewertet es aber nicht —
 *   sonst meldete es dauerhaft einen Fehler fuer etwas, das so entschieden
 *   wurde.
 *
 * UND EINE EHRLICHE EINORDNUNG. Im selben Benutzerkontext gibt es keine
 * Dateirechte-Massnahme und keine Schluesselbund-Abfrage, die einen Prozess
 * dieses Benutzers zuverlaessig aussperrt: ein Schluesselbundeintrag, dessen
 * ACL das aufrufende Programm kennt oder dem „Always Allow" erteilt wurde,
 * wird ohne Rueckfrage ausgelesen. Eine echte Grenze braucht eine andere
 * Benutzerkennung, ein Geraet oder — am einfachsten — das Fehlen des
 * Geheimnisses auf dieser Maschine. Das ist der Grund, warum Phase A ohne
 * Production-Zugangsdaten auskommt, statt sie zu bewachen.
 *
 * ES LIEST KEINE GEHEIMNISSE. Es prueft, OB eine Datei da ist, mit welchen
 * Rechten, und ob ein Skript auf sie zeigt. Der INHALT einer
 * Zugangsdatendatei wird nie geoeffnet; aus `process.env` werden nur
 * Variablennamen und ein Treffer auf die Projektkennung gemeldet, niemals ein
 * Wert.
 */
import { existsSync, readFileSync, statSync } from "node:fs";

import { PRODUCTION_REF, STAGING_REF } from "./lib/staging-db.mts";

export type Pruefpunkt = {
  nr: number;
  frage: string;
  befund: string;
  /** `true` = der gewuenschte Zustand ist erreicht. */
  erreicht: boolean;
  /**
   * `true` = dieser Punkt entscheidet ueber den Exitcode (Phase A).
   * `false` = Information; der heutige Production-Zustand ist so entschieden.
   */
  tor: boolean;
  /** Was zu tun ist, wenn nicht. */
  schritt?: string;
};

export type Eingaben = {
  /** Liegt `.env.local` (Production) im Arbeitsverzeichnis? */
  envLocalDa: boolean;
  /** npm-Skripte, die auf `.env.local` zeigen. */
  skripteMitEnvLocal: readonly string[];
  /**
   * Liegt eine Production-Datei ausserhalb? NUR zur Information: Phase A
   * benutzt sie nicht, und die Absicherung von Production ist ein eigenes
   * Vorhaben.
   */
  prodAussen: { da: boolean; modus: string | null };
  /** Liegt die Staging-Datenbankdatei ausserhalb — und mit welchen Rechten? */
  stagingAussen: { da: boolean; modus: string | null };
  /** Variablennamen in `process.env`, deren WERT die Production-Kennung enthaelt. */
  envTrefferProduction: readonly string[];
  /** Variablennamen, deren Wert die Staging-Kennung enthaelt. */
  envTrefferStaging: readonly string[];
};

/** Die ganze Bewertung, als reine Funktion — damit sie pruefbar ist. */
export function bewerte(e: Eingaben): Pruefpunkt[] {
  const p: Pruefpunkt[] = [];

  /* ---- Phase A: das Tor ------------------------------------------- */
  p.push({
    nr: 1,
    frage: "die Staging-Datenbankdatei liegt ausserhalb und ist nur fuer den Besitzer lesbar",
    befund: !e.stagingAussen.da
      ? "noch nicht angelegt — Phase A ist nicht eingerichtet"
      : `vorhanden, Rechte ${e.stagingAussen.modus}`,
    erreicht: e.stagingAussen.da && e.stagingAussen.modus === "600",
    tor: true,
    schritt: "~/.skyisles/staging-db.env anlegen und chmod 600 setzen.",
  });

  p.push({
    nr: 2,
    frage: "in dieser Prozessumgebung steckt keine Production-Kennung",
    befund: e.envTrefferProduction.length === 0
      ? "keine"
      : `${e.envTrefferProduction.length} Variable(n): ${e.envTrefferProduction.join(", ")}`,
    erreicht: e.envTrefferProduction.length === 0,
    tor: true,
    schritt: "die Sitzung ohne Production-Variablen neu starten.",
  });

  /* ---- Production: Information, kein Tor --------------------------- */
  p.push({
    nr: 11,
    frage: "Information: .env.local (Production) im Arbeitsverzeichnis",
    befund: e.envLocalDa
      ? ".env.local ist da — unveraendert, wie entschieden"
      : "nicht vorhanden",
    erreicht: true,
    tor: false,
  });

  p.push({
    nr: 12,
    frage: "Information: npm-Skripte, die auf .env.local zeigen",
    befund: e.skripteMitEnvLocal.length === 0
      ? "keines"
      : `${e.skripteMitEnvLocal.length} (unveraendert): ${e.skripteMitEnvLocal.slice(0, 4).join(", ")}`
        + (e.skripteMitEnvLocal.length > 4 ? " …" : ""),
    erreicht: true,
    tor: false,
  });

  p.push({
    nr: 13,
    frage: "Information: Variablen mit der Staging-Kennung",
    befund: e.envTrefferStaging.length === 0
      ? "keine (Phase A laedt sie erst beim Lauf)"
      : e.envTrefferStaging.join(", "),
    erreicht: true,
    tor: false,
  });

  return p;
}

/* -------------------------------------------------------------------------
 * Der Lauf
 * ---------------------------------------------------------------------- */

function modusVon(pfad: string): string | null {
  try {
    return (statSync(pfad).mode & 0o777).toString(8).padStart(3, "0");
  } catch {
    return null;
  }
}

function sammle(): Eingaben {
  const heim = process.env.HOME ?? "";
  const prod = `${heim}/.skyisles/production.env`;
  const staging = `${heim}/.skyisles/staging-db.env`;

  let skripte: string[] = [];
  try {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as
      { scripts?: Record<string, string> };
    skripte = Object.entries(pkg.scripts ?? {})
      .filter(([, v]) => v.includes(".env.local"))
      .map(([k]) => k);
  } catch { /* ohne package.json gibt es auch keine Skripte */ }

  /* NUR NAMEN, NIE WERTE. Ein Treffer heisst: der Wert dieser Variablen
     enthaelt die Projektkennung — nicht, wie er lautet. */
  const treffer = (ref: string): string[] =>
    Object.entries(process.env)
      .filter(([, v]) => typeof v === "string" && v.includes(ref))
      .map(([k]) => k)
      .sort();

  return {
    envLocalDa: existsSync(".env.local"),
    skripteMitEnvLocal: skripte,
    prodAussen: { da: existsSync(prod), modus: modusVon(prod) },
    stagingAussen: { da: existsSync(staging), modus: modusVon(staging) },
    envTrefferProduction: treffer(PRODUCTION_REF),
    envTrefferStaging: treffer(STAGING_REF),
  };
}

function main(): void {
  const punkte = bewerte(sammle());
  const tore = punkte.filter((p) => p.tor);
  const info = punkte.filter((p) => !p.tor);

  console.log("\nUMGEBUNGSPRUEFUNG — was koennte ein Prozess hier erreichen?");
  console.log("-".repeat(76));
  console.log("  PHASE A — blockierend");
  for (const p of tore) {
    console.log(`  ${p.erreicht ? "OK   " : "OFFEN"} ${p.nr}. ${p.frage}`);
    console.log(`        ${p.befund}`);
    if (!p.erreicht && p.schritt !== undefined) console.log(`        → ${p.schritt}`);
  }
  console.log("");
  console.log("  PRODUCTION — Information, eigenes Vorhaben");
  for (const p of info) {
    console.log(`  ·     ${p.nr}. ${p.frage}`);
    console.log(`        ${p.befund}`);
  }
  console.log("-".repeat(76));
  const offen = tore.filter((p) => !p.erreicht);
  console.log(`  Phase A: ${tore.length - offen.length} von ${tore.length} erreicht`);
  console.log("\n  Dieses Werkzeug liest keine Zugangsdaten. Es prueft Vorhandensein,");
  console.log("  Rechte und Verweise — nie einen Wert. Production wird nicht angefasst:");
  console.log("  Phase A braucht keine Production-Zugangsdaten.\n");
  if (offen.length > 0) process.exitCode = 1;
}

if (process.argv[1]?.endsWith("env-audit.mts")) main();
