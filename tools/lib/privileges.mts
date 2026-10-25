/**
 * DIE ERWARTETE RECHTELAGE — UND IHR ABDRUCK.
 *
 * Reine Funktionen, ohne Datenbank: was `staging-agent-setup.sql` dem
 * Pruefzugang zu erteilen BEHAUPTET, und woran eine Momentaufnahme veraltet.
 *
 * WARUM ES DIESE DATEI GIBT. Dreimal hintereinander ist eine Nachkontrolle an
 * einem fehlenden Recht gescheitert, und beim dritten Mal lag der Fehler
 * nicht im Mechanismus, sondern in der QUELLE: die Pruefungen leiteten die
 * Rechte aus der Einrichtungsdatei ab. Diese Datei ist aber ein historischer
 * Beleg dessen, was am 2026-10-19/20 erteilt wurde — kein Abbild des heutigen
 * Zustands. Am 2026-10-20 hat `0139` `shop_offers()` mit `drop function` neu
 * angelegt, und `DROP`+`CREATE` verwirft die ACL (`CREATE OR REPLACE` haette
 * sie behalten). Die Erteilung war fort, die Datei sagte weiter „erteilt".
 *
 * Seitdem gilt: **gemessen wird an der Datenbank** (`db:privileges:staging`),
 * und diese Datei sagt nur, was erwartet war und wann die Messung veraltet.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const SETUP = "supabase/operations/staging-agent-setup.sql";
export const MIG_DIR = "supabase/migrations";
export const AUFNAHME = "supabase/privileges/staging-agent.json";

/** Was die Einrichtungsdatei dem Pruefzugang zu erteilen behauptet. */
export type Erwartung = {
  tabellen: string[];
  /** Signaturen in der Form `public.name(argumente)`. */
  funktionen: string[];
};

export function erwartung(pfad = SETUP): Erwartung {
  const t = readFileSync(pfad, "utf8");
  return {
    tabellen: [...t.matchAll(
      /grant select on table public\.(\w+)\s+to skyisles_agent/g)].map((m) => m[1]).sort(),
    funktionen: [...t.matchAll(
      /grant execute on function public\.(\w+)\s*\(([^)]*)\)\s+to skyisles_agent/g)]
      .map((m) => `public.${m[1]}(${m[2].replace(/\s+/g, " ").trim()})`).sort(),
  };
}

/**
 * Welche Migration kann die Rechte des PRUEFZUGANGS veraendern?
 *
 * Genau zwei Wege, und nur die zaehlen:
 *
 *   1. Sie nennt `skyisles_agent` — erteilt oder entzieht ihm also direkt.
 *   2. Sie verwirft ein Objekt, das ihm erteilt ist (`drop function|table|
 *      view`). Dann ist die ACL fort, ohne dass irgendwo „revoke" steht.
 *
 * Ein `grant` an `anon` oder `authenticated` beruehrt ihn NICHT, und ein
 * `revoke ... from public` auch nicht — seine Erteilung ist ausdruecklich.
 * Deshalb macht eine gewoehnliche neue Migration die Momentaufnahme NICHT
 * veraltet; sonst waere der Riegel so laut, dass er abgeschaltet wuerde.
 */
export function rechtErheblich(text: string, erteilt: Erwartung): boolean {
  if (/skyisles_agent/i.test(text)) return true;
  const namen = new Set([
    ...erteilt.tabellen,
    ...erteilt.funktionen.map((f) => f.replace(/^public\./, "").replace(/\(.*$/, "")),
  ]);
  for (const m of text.matchAll(
    /drop\s+(?:function|table|view|materialized view)\s+(?:if exists\s+)?public\.(\w+)/gi)) {
    if (namen.has(m[1])) return true;
  }
  return false;
}

/**
 * Der Abdruck, an dem eine Momentaufnahme veraltet.
 *
 * Er bindet die Messung an den Zustand, GEGEN DEN gemessen wurde: die
 * Einrichtungsdatei und jede rechtserhebliche Migration. Aendert sich eines
 * davon, ist die Aufnahme nicht mehr gueltig — und das soll auffallen, nicht
 * durchgehen.
 */
export function abdruck(dir = MIG_DIR, setupPfad = SETUP): {
  abdruck: string; erheblich: string[];
} {
  const erteilt = erwartung(setupPfad);
  const teile: string[] = [
    `setup:${createHash("sha256").update(readFileSync(setupPfad)).digest("hex")}`,
  ];
  const erheblich: string[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    const text = readFileSync(join(dir, f), "utf8");
    if (!rechtErheblich(text, erteilt)) continue;
    erheblich.push(f);
    teile.push(`${f}:${createHash("sha256").update(text).digest("hex")}`);
  }
  return {
    abdruck: createHash("sha256").update(teile.join("\n")).digest("hex"),
    erheblich,
  };
}

/** Eine Momentaufnahme der GEMESSENEN Rechte. */
export type Aufnahme = {
  projekt: string;
  /** Wann gemessen — zur Auskunft. Gueltig macht sie der Abdruck, nicht das Datum. */
  erhoben: string;
  /** Der Abdruck des Zustands, gegen den gemessen wurde. */
  abdruck: string;
  rolle: string;
  schema: { usage: boolean; create: boolean };
  mitgliedschaften: { istMitgliedVon: string[]; hatAlsMitglied: string[] };
  /** Tabellen und Sichten → darf die Rolle `select`? */
  tabellen: Record<string, boolean>;
  /** Signatur → darf die Rolle `execute`, und ist die Funktion `definer`? */
  funktionen: Record<string, { execute: boolean; definer: boolean }>;
  /** Was von der Erwartung abweicht — leer heisst: Datei und Datenbank stimmen. */
  abweichungen: string[];
};

export type AufnahmeUrteil =
  | { ok: true; aufnahme: Aufnahme }
  | { ok: false; grund: string; veraltet: boolean };

/**
 * Die Momentaufnahme lesen und auf Gueltigkeit pruefen.
 *
 * EINE VERALTETE AUFNAHME GILT NICHT ALS GUELTIG. Sie fehlt dann wirksam —
 * denn eine Messung von vor der letzten rechtserheblichen Migration sagt
 * nichts ueber heute.
 */
export function ladeAufnahme(pfad = AUFNAHME, dir = MIG_DIR,
                             setupPfad = SETUP): AufnahmeUrteil {
  let roh: string;
  try {
    roh = readFileSync(pfad, "utf8");
  } catch {
    return {
      ok: false, veraltet: false,
      grund: `${pfad} gibt es nicht. Erheben mit:  npm run db:privileges:staging`,
    };
  }
  let a: Aufnahme;
  try {
    a = JSON.parse(roh) as Aufnahme;
  } catch (e) {
    return { ok: false, veraltet: false, grund: `${pfad} ist kein gueltiges JSON: `
      + `${e instanceof Error ? e.message : String(e)}` };
  }
  const jetzt = abdruck(dir, setupPfad).abdruck;
  if (a.abdruck !== jetzt) {
    return {
      ok: false, veraltet: true,
      grund: `${pfad} ist VERALTET: gemessen gegen ${String(a.abdruck).slice(0, 12)}…, `
        + `heute gilt ${jetzt.slice(0, 12)}…. Seit der Messung hat sich die `
        + "Einrichtungsdatei oder eine rechtserhebliche Migration geaendert.\n"
        + "  Neu erheben:  npm run db:privileges:staging",
    };
  }
  return { ok: true, aufnahme: a };
}
