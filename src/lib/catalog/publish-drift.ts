/**
 * DER DRIFTRIEGEL — hat jemand Production von Hand angefasst?
 *
 * Rein, ohne Datenbank. Geprüft in `publish-drift.test.ts`.
 *
 * ===========================================================================
 * DAS PROBLEM, DAS RIEGEL 2 IM DAUERBETRIEB NICHT LÖSEN KANN
 * ===========================================================================
 *
 * Riegel 2 des Dry-Runs prüft beide Umgebungen gegen einen **eingefrorenen**
 * Messwert. Für den Bootstrap war das richtig: dort durfte sich nichts
 * bewegen. Im Dauerbetrieb ist es falsch, und zwar an der entscheidenden
 * Stelle — **Staging bearbeiten ist der Zweck**. Die erste redaktionelle
 * Änderung würde den Plan blockieren.
 *
 * Gleichzeitig soll eine Änderung, die jemand direkt auf PRODUCTION macht,
 * sehr wohl auffallen. Production ist nur Ziel; ein Wert, der dort entsteht,
 * ist entweder ein Versehen oder ein Eingriff an der falschen Stelle, und in
 * beiden Fällen würde ihn der nächste Publish stillschweigend überschreiben.
 *
 * ===========================================================================
 * DIE UNTERSCHEIDUNG, DIE DAS LÖST
 * ===========================================================================
 *
 * Für jedes geregelte Feld einer veröffentlichten Zeile gibt es genau drei
 * erlaubte Zustände:
 *
 *   `veroeffentlicht`  Production trägt den Wert, der im Publish-Stand
 *                      steht — seit dem letzten Publish unberührt.
 *   `publiziert`       Production trägt den AKTUELLEN Staging-Wert, obwohl
 *                      der Publish-Stand noch den alten nennt. Das ist ein
 *                      TEILWEISE gelaufener Publish: dieser Lauf hat das Feld
 *                      schon geschrieben, der Stand ist nur noch nicht
 *                      nachgezogen. Erlaubt — und genau der Grund, warum ein
 *                      abgebrochener Lauf ohne Sonderweg fortsetzbar ist.
 *   `drift`            Production trägt einen DRITTEN Wert — weder den
 *                      veröffentlichten noch den, auf den dieser Publish
 *                      zielt. Den kann kein Lauf dieses Werkzeugs erzeugt
 *                      haben. Abbruch.
 *
 * Der blinde Fleck ist benannt und harmlos: ein fremder Eingriff, der ein
 * Feld ausgerechnet auf den aktuellen Staging-Wert setzt, zählt als
 * `publiziert`. Dort will der Publish ohnehin hin.
 *
 * ===========================================================================
 * ZWEI DATEIEN, ZWEI AUFGABEN
 * ===========================================================================
 *
 *   `catalog-baseline.json`   das SIEGEL des einmaligen Abgleichs. Es wird
 *                             nie wieder geschrieben; es belegt, womit der
 *                             Dauerbetrieb begonnen hat.
 *   `publish-ledger.json`     der FORTLAUFENDE Stand. Ein erfolgreicher
 *                             Publish schreibt ihn neu, und der Git-Diff
 *                             zeigt Zeile für Zeile, was veröffentlicht wurde.
 *
 * Eine Datei für beides wäre bequemer und falsch: das Siegel wäre nach dem
 * ersten Publish keins mehr.
 */

import { createHash } from "node:crypto";

/** Eine Zeile des Publish-Stands: SKY-ID -> die geregelten Werte, `|`-verbunden. */
export type Stand = Readonly<Record<string, string>>;

export type Ledger = {
  marke: string;
  veroeffentlicht_am: string;
  staging: string;
  production: string;
  geregelte_felder: readonly string[];
  zeilen: number;
  abdruck: string;
  stand: Stand;
};

export const LEDGER_MARKE = "skyisles-publish-ledger-1";

const md5 = (zz: readonly string[]) =>
  createHash("md5").update(zz.join("\n")).digest("hex");

/** Der Abdruck über einen Stand — dieselbe Rechnung wie im Dry-Run. */
export function standAbdruck(stand: Stand): { zeilen: number; abdruck: string } {
  const ids = Object.keys(stand).sort();
  return { zeilen: ids.length, abdruck: md5(ids.map((id) => `${id}|${stand[id]}`)) };
}

/**
 * IST DER STAND IN SICH SCHLÜSSIG? Der Abdruck steht in der Datei UND lässt
 * sich aus ihr nachrechnen. Weicht er ab, ist die Datei von Hand verändert
 * worden, und dann trägt sie keine Aussage mehr.
 */
export function pruefeLedger(l: Ledger): { ok: boolean; befunde: string[] } {
  const befunde: string[] = [];
  if (l.marke !== LEDGER_MARKE) {
    befunde.push(`unbekannte Marke "${l.marke}", erwartet "${LEDGER_MARKE}"`);
  }
  const { zeilen, abdruck } = standAbdruck(l.stand);
  if (zeilen !== l.zeilen) befunde.push(`${zeilen} Zeilen im Stand, ${l.zeilen} angegeben`);
  if (abdruck !== l.abdruck) {
    befunde.push(`der Abdruck rechnet sich zu ${abdruck}, die Datei nennt ${l.abdruck} `
      + "— die Datei ist von Hand veraendert worden");
  }
  const breite = l.geregelte_felder.length;
  for (const [id, zeile] of Object.entries(l.stand)) {
    const n = zeile.split("|").length;
    if (n !== breite) {
      befunde.push(`${id}: ${n} Werte, ${breite} geregelte Felder`);
      break;      // einer genügt; die Datei ist dann ohnehin unbrauchbar
    }
  }
  return { ok: befunde.length === 0, befunde };
}

export type Abweichung = {
  sky_id: string; feld: string;
  veroeffentlicht: string; staging: string; production: string;
};

export type Befund = {
  ok: boolean;
  /** Felder, die seit dem letzten Publish unberührt sind. */
  unberuehrt: number;
  /** Felder, die dieser Publish schon geschrieben hat (Teillauf). */
  publiziert: number;
  /** Felder mit einem dritten Wert — Abbruchgrund. */
  drift: Abweichung[];
  /** Zeilen, die Production veröffentlicht und die weder Stand noch Staging kennt. */
  nur_production: string[];
  /** Zeilen aus dem Stand, die Production nicht mehr führt. */
  fehlen_auf_production: string[];
  /** Zeilen, die Staging neu veröffentlicht — kein Drift, sondern Arbeit. */
  neu_auf_staging: string[];
};

/**
 * `staging` und `production` sind die geregelten Projektionen der jeweils
 * FREIGEGEBENEN Zeilen, in derselben Feldreihenfolge wie `geregelte_felder`.
 */
export function pruefeDrift(
  ledger: Ledger,
  staging: Stand,
  production: Stand,
): Befund {
  const felder = ledger.geregelte_felder;
  const zerlege = (z: string) => z.split("|");

  let unberuehrt = 0; let publiziert = 0;
  const drift: Abweichung[] = [];

  for (const id of Object.keys(production).sort()) {
    const imStand = ledger.stand[id];
    const aufStaging = staging[id];
    if (imStand === undefined) {
      /*
       * Production veroeffentlicht eine Zeile, die der letzte Publish nicht
       * kannte. Steht sie auf Staging, ist es eine neue Figur, die dieser
       * Lauf schon angelegt hat — erlaubt. Steht sie dort nicht, hat jemand
       * auf Production eine Figur veroeffentlicht.
       */
      if (aufStaging === undefined) continue;   // unten als nur_production
      continue;
    }
    const p = zerlege(production[id]);
    const v = zerlege(imStand);
    const s = aufStaging === undefined ? null : zerlege(aufStaging);
    for (let i = 0; i < felder.length; i += 1) {
      if (p[i] === v[i]) { unberuehrt += 1; continue; }
      if (s !== null && p[i] === s[i]) { publiziert += 1; continue; }
      drift.push({ sky_id: id, feld: felder[i],
        veroeffentlicht: v[i] ?? "(fehlt)", staging: s === null ? "(Zeile fehlt)" : s[i] ?? "(fehlt)",
        production: p[i] ?? "(fehlt)" });
    }
  }

  const nur_production = Object.keys(production).sort()
    .filter((id) => ledger.stand[id] === undefined && staging[id] === undefined);
  const fehlen_auf_production = Object.keys(ledger.stand).sort()
    .filter((id) => production[id] === undefined);
  const neu_auf_staging = Object.keys(staging).sort()
    .filter((id) => ledger.stand[id] === undefined);

  return {
    ok: drift.length === 0 && nur_production.length === 0,
    unberuehrt, publiziert, drift, nur_production, fehlen_auf_production, neu_auf_staging,
  };
}

/** Der Bericht, den der Publish ausgibt — eine Zeile je Befundart. */
export function driftBericht(b: Befund): string[] {
  const zz = [
    `Felder seit dem letzten Publish unberuehrt: ${b.unberuehrt}`,
    `Felder, die dieser Publish schon geschrieben hat: ${b.publiziert}`,
    `neue Zeilen auf Staging (noch nicht veroeffentlicht): ${b.neu_auf_staging.length}`,
  ];
  if (b.fehlen_auf_production.length > 0) {
    zz.push(`Zeilen aus dem Stand, die Production nicht mehr veroeffentlicht: `
      + `${b.fehlen_auf_production.length} (${b.fehlen_auf_production.slice(0, 5).join(", ")}`
      + `${b.fehlen_auf_production.length > 5 ? ", …" : ""})`);
  }
  if (b.nur_production.length > 0) {
    zz.push(`DRIFT — Production veroeffentlicht ${b.nur_production.length} Zeile(n), die `
      + `weder der Stand noch Staging kennt: ${b.nur_production.join(", ")}`);
  }
  for (const d of b.drift) {
    zz.push(`DRIFT — ${d.sky_id}.${d.feld}: veroeffentlicht "${d.veroeffentlicht}", `
      + `Staging will "${d.staging}", Production traegt "${d.production}"`);
  }
  return zz;
}
