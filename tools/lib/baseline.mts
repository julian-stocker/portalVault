/**
 * Der Basis-Vertrag, in TypeScript gelesen.
 *
 * WOFUER DIESE DATEI EXISTIERT. Die Nachkontrollen seit `0142` vergleichen
 * ihre Geschaeftszahlen nicht gegen Konstanten, sondern gegen den Stand VOR
 * der Migration — uebergeben als eine Zeile aus Zeile 900 des Preflights:
 *
 *   skyisles-base-1|angebote|angebote_md5|shopfaehig|sammelbar|lagerzeilen|
 *   katalogzeilen|lager_md5|schutz
 *
 * Das letzte Feld ist `left(md5(<alle Felder ausser Marke und Summe>), 12)`.
 * Es faengt ab, was beim Kopieren passiert: eine abgeschnittene Zeile, zwei
 * vertauschte Felder, eine verlorene Stelle.
 *
 * DIE PRUEFUNG GIBT ES ZWEIMAL, UND DAS IST ABSICHT. Die Nachkontrolle
 * prueft sie in SQL (Zeilen 801-804 bzw. 821-824) — das ist der Riegel, der
 * im SQL-Editor greift, auch wenn niemand ein Werkzeug benutzt. Diese Datei
 * prueft sie, BEVOR eine Zeile eingefroren wird: eine beschaedigte Baseline
 * soll gar nicht erst in die Akte kommen. Eine Doppelung, bei der beide
 * Seiten dieselbe Formel benutzen und keine die andere ersetzt.
 *
 * KEINE DATENBANK, KEINE NETZWERKVERBINDUNG, KEIN ZUSTAND. Nur Text und
 * `md5`. Deshalb ist sie ohne Staging testbar.
 */
import { createHash } from "node:crypto";

/** Die beiden Vertraege, die es gibt. */
export const VERTRAEGE = {
  "skyisles.base": { marke: "skyisles-base-1", felder: 9, zeile: 900 },
  "skyisles.coll": { marke: "skyisles-coll-1", felder: 5, zeile: 901 },
} as const;

export type VertragsName = keyof typeof VERTRAEGE;

/** Die Platzhalter, die die Huellen mitbringen. Sie zaehlen NICHT als Wert. */
export const PLATZHALTER = ["BASIS-HIER-EINSETZEN", "SAMMLUNG-HIER-EINSETZEN"] as const;

export type BaselineUrteil =
  | { ok: true; name: VertragsName; marke: string; felder: number; schutz: string }
  | { ok: false; grund: string };

/**
 * Taugt diese Zeile als Baseline?
 *
 * Vier Fragen, dieselben vier wie in SQL: ist sie ueberhaupt da, traegt sie
 * die Marke, hat sie die richtige Zahl Felder, stimmt die Schutzsumme.
 *
 * SIE FAENGT NICHT AB, dass jemand die Werte absichtlich neu setzt und die
 * Summe neu rechnet. Dagegen schuetzt kein Code, sondern die Reihenfolge der
 * Schritte: die Baseline entsteht VOR der Migration und wird danach nicht
 * mehr erhoben.
 */
export function pruefeBaseline(roh: string | null | undefined): BaselineUrteil {
  if (roh === null || roh === undefined) {
    return { ok: false, grund: "die Zeile fehlt." };
  }
  const text = roh.trim();
  if (text === "") return { ok: false, grund: "die Zeile ist leer." };
  if ((PLATZHALTER as readonly string[]).includes(text)) {
    return {
      ok: false,
      grund: `der Platzhalter "${text}" steht noch darin. Er zaehlt wie eine `
        + "fehlende Zeile — sonst waere die Bequemlichkeit der Huelle die Luecke "
        + "im Riegel.",
    };
  }

  const teile = text.split("|");
  const eintrag = (Object.entries(VERTRAEGE) as [VertragsName, typeof VERTRAEGE[VertragsName]][])
    .find(([, v]) => v.marke === teile[0]);
  if (eintrag === undefined) {
    return {
      ok: false,
      grund: `die Marke "${teile[0]}" kennt niemand. Erwartet: `
        + Object.values(VERTRAEGE).map((v) => v.marke).join(" oder ") + ".",
    };
  }
  const [name, vertrag] = eintrag;

  if (teile.length !== vertrag.felder) {
    return {
      ok: false,
      grund: `${vertrag.marke} hat ${teile.length} Felder statt ${vertrag.felder} — `
        + "abgeschnitten oder zu viel kopiert.",
    };
  }

  /* `left(md5(Felder ohne Marke und ohne Summe, mit | verbunden), 12)`. */
  const kern = teile.slice(1, teile.length - 1).join("|");
  const soll = createHash("md5").update(kern).digest("hex").slice(0, 12);
  const mitgeliefert = teile[teile.length - 1];
  if (soll !== mitgeliefert) {
    return {
      ok: false,
      grund: `die Schutzsumme stimmt nicht: "${mitgeliefert}" steht darin, `
        + `gerechnet "${soll}". Ein Feld ist vertauscht oder eine Stelle fort.`,
    };
  }

  return { ok: true, name, marke: vertrag.marke, felder: teile.length, schutz: soll };
}

/**
 * Welchen Vertrag traegt diese Zeile? `null`, wenn keinen gueltigen.
 *
 * Fuer den Fall, dass eine Datei mehrere Zeilen liefert und zugeordnet
 * werden muss, welche wohin gehoert — die Marke entscheidet, nicht die
 * Reihenfolge.
 */
export function vertragVon(roh: string | null | undefined): VertragsName | null {
  const u = pruefeBaseline(roh);
  return u.ok ? u.name : null;
}
