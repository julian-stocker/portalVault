/**
 * EIN Befehl fuer alle lesenden Staging-Pruefungen.
 *
 *   npm run db:check:staging
 *
 * Er faehrt die Dateien aus `supabase/checks/staging-suite.json` gegen
 * Staging, vergleicht Zeile 9999, schreibt ein Protokoll und gibt einen
 * kompakten Bericht aus. Exitcode 1, sobald eine Datei eine blockierende
 * Abweichung meldet.
 *
 * PHASE A — AUSSCHLIESSLICH LESEND
 *
 * Es gibt in diesem Werkzeug keinen schreibenden Pfad: keine Migration, kein
 * `insert`, kein DDL, keinen Production-Modus. Jede Datei wird in `begin … 
 * rollback` geklammert, und die Sitzung ist durch die Rolleneinstellung
 * `default_transaction_read_only = on` ohnehin schreibgeschuetzt. Drei
 * Riegel, die unabhaengig voneinander greifen.
 *
 * WAS ER MITBRINGT UND WAS NICHT
 *
 *   * Er setzt den Z0-Vertrag (`skyisles.z0 = staging`) SELBST, in derselben
 *     Klammer wie die Pruefdatei. Genau daran ist S1 von Hand gescheitert.
 *   * Er ueberspringt eine Datei, deren Vorbedingung nicht erfuellt ist
 *     (`wenn` in der Suite) — mit Grund im Bericht, nicht als Fehler. So
 *     bleibt derselbe Befehl vor und nach einer Migration richtig.
 *   * Er protokolliert Zahlen, Pruefzeilen und Abdruecke. KEINE
 *     Geschaeftsdaten: die Pruefdateien geben Zaehlstaende und Prüfsummen
 *     aus, keine Namen und keine Adressen. Und keine Zugangsdaten — jede
 *     Ausgabe laeuft durch `redigiere()`.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

import {
  type DbZugang, type Zeile, ERWARTETER_STEMPEL, STAGING_REF,
  ladeUmgebung, redigiere, verbindeStaging,
} from "./lib/staging-db.mts";

const CHECK_DIR = "supabase/checks";
const SUITE = join(CHECK_DIR, "staging-suite.json");
const LOG_DIR = "supabase/log/staging";

export type SuiteEintrag = {
  datei: string;
  zweck: string;
  modus: "9999" | "messung";
  vertrag?: "staging";
  wenn?: { beschreibung: string; sql: string };
};

export type Befund = {
  datei: string;
  zweck: string;
  status: "ok" | "abweichung" | "uebersprungen" | "fehler";
  abweichungen: string | null;
  zeilen: Zeile[];
  auffaellig: Zeile[];
  grund?: string;
  dauerMs: number;
  sha256: string;
};

/** Die Suite, aus der einen Quelle. */
export function ladeSuite(pfad = SUITE): SuiteEintrag[] {
  const d = JSON.parse(readFileSync(pfad, "utf8")) as { dateien: SuiteEintrag[] };
  return d.dateien;
}

/** Eine Zeile der Ergebnistabelle, so wie die Pruefdateien sie bauen. */
const nr = (z: Zeile): number => Number(z.nr);
const befund = (z: Zeile): string => String(z.befund ?? "");

/**
 * Eine Pruefdatei fahren.
 *
 * Die Vertragszeile und die Datei gehen als EINE Einreichung an die
 * Datenbank — nur so wirkt `set_config(…, true)` auf das folgende SELECT.
 * Dieselbe Zuordnung, die der Laufzettel von Hand verlangt.
 */
export async function fahreEintrag(
  db: DbZugang, eintrag: SuiteEintrag, verzeichnis = CHECK_DIR,
  vertraege: ReadonlyMap<string, string> = new Map(),
): Promise<Befund> {
  const start = Date.now();
  const pfad = join(verzeichnis, eintrag.datei);
  const sql = readFileSync(pfad, "utf8");
  const sha256 = createHash("sha256").update(sql).digest("hex");
  const grund = (status: Befund["status"], text: string): Befund => ({
    datei: eintrag.datei, zweck: eintrag.zweck, status, abweichungen: null,
    zeilen: [], auffaellig: [], grund: text, dauerMs: Date.now() - start, sha256,
  });

  try {
    if (eintrag.wenn !== undefined) {
      const antwort = (await db.fuehre(eintrag.wenn.sql))[0]?.[0];
      if (antwort === undefined || antwort.erfuellt !== true) {
        return grund("uebersprungen", eintrag.wenn.beschreibung);
      }
    }

    /*
     * JEDER VERTRAG IN DERSELBEN KLAMMER WIE DIE DATEI.
     *
     * `set_config(…, true)` gilt nur in seiner Transaktion, und der
     * SQL-Editor fuehrt jeden Lauf getrennt aus — genau daran ist die
     * Uebergabe von Hand bei `0145` und `0146` gescheitert. Hier kann sie
     * nicht scheitern: die Zeilen und die Datei gehen als EINE Einreichung
     * hinaus.
     *
     * `vertraege` kam mit dem Migrations-Runner dazu (`db:migrate:staging`).
     * Der Z0-Vertrag bleibt, wo er war — die bestehende Suite ist davon
     * unberuehrt.
     *
     * Die Werte sind GEPRUEFTE Baselines (`tools/lib/baseline.mts`), aber
     * einfache Anfuehrungszeichen werden trotzdem verdoppelt: eine Zeile,
     * die aus einer Datei kommt, wird nicht ungepruefter Teil einer
     * Anweisung.
     */
    const vertragsZeilen = [...vertraege].map(([name, wert]) =>
      `select set_config('${name}', '${wert.split("'").join("''")}', true) as ${
        name.replace(/[^a-z]/g, "_")}`);

    const teile = [
      "begin",
      "set transaction read only",
      ...(eintrag.vertrag === "staging"
        ? [`select set_config('skyisles.z0', '${eintrag.vertrag}', true) as vertrag`]
        : []),
      ...vertragsZeilen,
      sql.replace(/;\s*$/, ""),
      "rollback",
    ];
    const ergebnisse = await db.fuehre(teile.join(";\n") + ";");

    /* Die Ergebnismenge mit einer Spalte `nr` ist die der Pruefdatei. */
    const zeilen = ergebnisse.find((m) => m.length > 0 && "nr" in m[0]) ?? [];
    if (zeilen.length === 0) {
      return grund("fehler", "die Datei hat keine Ergebniszeilen geliefert.");
    }

    const gesamt = zeilen.find((z) => nr(z) === 9999);
    /*
     * ZEILE 9999 GEHOERT NICHT ZU DEN AUFFAELLIGEN.
     *
     * Sie traegt selbst `ok = false`, sobald irgendeine Pruefung abweicht —
     * sie ist die Summe, nicht ein Befund. Ohne diese Ausnahme meldete der
     * Bericht bei einer Abweichung immer eine zu viel.
     */
    const auffaellig = zeilen.filter((z) => z.ok === false && nr(z) !== 9999);

    if (eintrag.modus === "messung") {
      return {
        datei: eintrag.datei, zweck: eintrag.zweck, status: "ok",
        abweichungen: null, zeilen, auffaellig: [],
        dauerMs: Date.now() - start, sha256,
      };
    }
    if (gesamt === undefined) {
      return grund("fehler", "die Datei hat keine Zeile 9999 — Modus 9999 verlangt sie.");
    }
    return {
      datei: eintrag.datei, zweck: eintrag.zweck,
      status: befund(gesamt) === "0" ? "ok" : "abweichung",
      abweichungen: befund(gesamt), zeilen, auffaellig,
      dauerMs: Date.now() - start, sha256,
    };
  } catch (e) {
    /*
     * NACH EINEM FEHLER MUSS ZURUECKGEROLLT WERDEN — sonst ist die Sitzung
     * verloren.
     *
     * PostgreSQL antwortet auf jede weitere Anweisung einer abgebrochenen
     * Transaktion mit `25P02 current transaction is aborted`. Ohne dieses
     * `rollback` scheiterte die ERSTE fehlerhafte Datei an ihrer Ursache und
     * jede FOLGENDE an einem Folgefehler — der Bericht waere unlesbar.
     * Dieselbe Lehre, die der Laufzettel dem Bediener aufschreibt, hier im
     * Code.
     */
    try { await db.fuehre("rollback"); } catch { /* war keine offene Klammer */ }
    return grund("fehler", redigiere(e instanceof Error ? e.message : String(e)));
  }
}

/** Die ganze Suite. */
export async function fahreSuite(
  db: DbZugang, suite: SuiteEintrag[], verzeichnis = CHECK_DIR,
): Promise<Befund[]> {
  const out: Befund[] = [];
  for (const eintrag of suite) out.push(await fahreEintrag(db, eintrag, verzeichnis));
  return out;
}

/* -------------------------------------------------------------------------
 * Bericht und Protokoll
 * ---------------------------------------------------------------------- */

const ZEICHEN: Record<Befund["status"], string> = {
  ok: "OK        ", abweichung: "ABWEICHUNG", uebersprungen: "uebersprungen",
  fehler: "FEHLER    ",
};

export function bericht(befunde: Befund[]): string {
  const z: string[] = [];
  for (const b of befunde) {
    z.push(`  ${ZEICHEN[b.status]} ${b.datei}`);
    if (b.status === "uebersprungen") z.push(`             ${b.grund}`);
    else if (b.status === "fehler") z.push(`             ${b.grund}`);
    else if (b.status === "abweichung") {
      z.push(`             9999 = ${b.abweichungen} — ${b.auffaellig.length} Zeile(n):`);
      for (const a of b.auffaellig.slice(0, 8)) {
        z.push(`             ${nr(a)} ${String(a.pruefung)}: ` +
          `${JSON.stringify(a.befund)} statt ${JSON.stringify(a.erwartet)}`);
      }
    } else {
      z.push(`             ${b.zeilen.length} Zeilen, ${b.dauerMs} ms` +
        (b.abweichungen === null ? " (Messung)" : ", 9999 = 0"));
    }
  }
  return redigiere(z.join("\n"));
}

export function protokoll(befunde: Befund[], zeitpunkt: Date): string {
  const z: string[] = [];
  z.push(`# Staging-Pruefprotokoll ${zeitpunkt.toISOString()}`);
  z.push("");
  z.push(`**Projekt:** \`${STAGING_REF}\` · **Stempel:** \`${ERWARTETER_STEMPEL}\``);
  z.push(`**Zugang:** lesender Pruefzugang, Sitzung schreibgeschuetzt, ` +
    `jede Datei in \`begin … rollback\``);
  z.push("");
  z.push("| Datei | Status | 9999 | Zeilen | ms | SHA-256 |");
  z.push("|---|---|---|---|---|---|");
  for (const b of befunde) {
    z.push(`| \`${b.datei}\` | ${b.status} | ${b.abweichungen ?? "—"} | ` +
      `${b.zeilen.length} | ${b.dauerMs} | \`${b.sha256.slice(0, 16)}…\` |`);
  }
  for (const b of befunde) {
    if (b.status === "ok" && b.auffaellig.length === 0 && b.abweichungen === "0") continue;
    z.push("");
    z.push(`## ${b.datei} — ${b.zweck}`);
    if (b.grund !== undefined) z.push("");
    if (b.grund !== undefined) z.push(`**${b.status}:** ${b.grund}`);
    if (b.auffaellig.length > 0) {
      z.push("");
      z.push("| nr | Bereich | Pruefung | Befund | erwartet |");
      z.push("|---|---|---|---|---|");
      for (const a of b.auffaellig) {
        z.push(`| ${nr(a)} | ${String(a.bereich)} | ${String(a.pruefung)} | ` +
          `\`${String(a.befund)}\` | \`${String(a.erwartet)}\` |`);
      }
    }
    if (b.status === "ok" && b.abweichungen === null) {
      z.push("");
      z.push("Messung ohne Sollwert — vollstaendige Zeilen:");
      z.push("");
      z.push("| nr | Bereich | Gegenstand | Befund |");
      z.push("|---|---|---|---|");
      for (const a of b.zeilen) {
        z.push(`| ${nr(a)} | ${String(a.bereich ?? "")} | ` +
          `${String(a.pruefung ?? a.gegenstand ?? "")} | \`${befund(a)}\` |`);
      }
    }
  }
  z.push("");
  z.push("---");
  z.push("");
  z.push("Dieses Protokoll enthaelt Zaehlstaende, Pruefzeilen und Abdruecke.");
  z.push("Keine Zugangsdaten und keine personenbezogenen Daten: die Pruefdateien");
  z.push("geben keine aus, und jede Zeile laeuft durch `redigiere()`.");
  return redigiere(z.join("\n") + "\n");
}

/* -------------------------------------------------------------------------
 * Der Lauf
 * ---------------------------------------------------------------------- */

async function main(): Promise<void> {
  ladeUmgebung(`${process.env.HOME ?? ""}/.skyisles/staging-db.env`);

  const suite = ladeSuite();
  const gewaehlt = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const lauf = gewaehlt.length === 0
    ? suite
    : suite.filter((s) => gewaehlt.some((g) => s.datei.includes(g)));
  if (lauf.length === 0) {
    console.error(`\n  keine Suite-Datei passt zu ${gewaehlt.join(", ")}.\n`);
    process.exit(1);
  }

  console.log(`\nSTAGING-PRUEFUNG — ${lauf.length} von ${suite.length} Dateien`);
  console.log(`  Projekt ${STAGING_REF}, lesend, jede Datei in begin … rollback`);
  console.log("-".repeat(76));

  let db: DbZugang;
  try {
    db = await verbindeStaging();
  } catch (e) {
    console.error("");
    console.error(`  ${redigiere(e instanceof Error ? e.message : String(e))}`);
    console.error("");
    console.error("  Es wurde nichts gelesen und nichts geschrieben.");
    console.error("");
    process.exit(1);
  }

  const zeitpunkt = new Date();
  const befunde = await fahreSuite(db, lauf);
  await db.schliesse();

  console.log(bericht(befunde));
  console.log("-".repeat(76));
  const zahl = (s: Befund["status"]) => befunde.filter((b) => b.status === s).length;
  console.log(`  ${zahl("ok")} ok, ${zahl("abweichung")} mit Abweichung, ` +
    `${zahl("fehler")} fehlerhaft, ${zahl("uebersprungen")} uebersprungen`);

  mkdirSync(LOG_DIR, { recursive: true });
  const name = `${zeitpunkt.toISOString().replace(/[:.]/g, "-")}-suite.md`;
  writeFileSync(join(LOG_DIR, name), protokoll(befunde, zeitpunkt));
  console.log(`  Protokoll: ${join(LOG_DIR, name)}\n`);

  if (zahl("abweichung") + zahl("fehler") > 0) process.exitCode = 1;
}

/* Nur als Befehl ausfuehren, nicht beim Import aus einem Test. */
if (process.argv[1]?.endsWith("db-check-staging.mts")) {
  main().catch((e: unknown) => {
    console.error(`\nAbbruch: ${redigiere(e instanceof Error ? e.message : String(e))}\n`);
    process.exit(1);
  });
}
