/**
 * Die 30 OVP-Katalogduplikate, die SkyIsles dauerhaft entfernt (CAT-12,
 * ADR-0166).
 *
 * EINE QUELLE: `data/catalog/ovp-removal.json`. Dieselben 30 stehen als
 * Konstante in `system_remove_ovp_figure` (`0167`); ein Test haelt beide
 * gleich. Gelesen wird die Liste von:
 *
 *   * `tools/import-catalog.mts`  — ueberspringt sie, statt sie anzulegen
 *   * `tools/catalog-sync.mts`    — Riegel 6: kein Schritt darf eine davon
 *                                   anlegen oder beschreiben, in keinem Modus
 *
 * Die Datenbank haelt das Versprechen zusaetzlich selbst: nach der Entfernung
 * steht die SKY-ID in `catalog_removed_sky_ids`, und ein Trigger weist jede
 * Wiederanlage ab. Diese Datei ist die fruehere, lesbarere Schicht davor.
 *
 * REIN: keine Datenbank. Die JSON-Datei wird importiert, nicht gelesen.
 */
import liste from "../../../data/catalog/ovp-removal.json" with { type: "json" };

export type OvpEintrag = {
  sky_id: string;
  series_code: string;
  /** Der Rohname, exakt wie in `skylanders.name` (CLAUDE.md Regel 4). */
  name: string;
  card_type: string;
  gruppe: "elite-ovp-series-1" | "elite-ovp-series-2" | "ovp-im-namen";
  /** Die regulaere Figur, die BLEIBT — nur Auskunft, es wird nichts umgehaengt. */
  regulaere_figur: string;
};

export const OVP_REMOVAL = liste as { erhoben: string; eintraege: OvpEintrag[] };

/** Die 30 SKY-IDs. */
export const OVP_REMOVED_SKY_IDS: ReadonlySet<string> =
  new Set(OVP_REMOVAL.eintraege.map((e) => e.sky_id));

export function istEntferntesOvpDuplikat(skyId: string): boolean {
  return OVP_REMOVED_SKY_IDS.has(skyId);
}

/**
 * RIEGEL 6 — kein Publish- oder Bootstrap-Schritt darf eine entfernte SKY-ID
 * anlegen oder beschreiben. Liefert die Schritte, die es doch tun.
 */
export function pruefeEntfernte<T extends { sky_id: string; art: string }>(
  plan: readonly T[],
): T[] {
  return plan.filter((s) => s.art !== "charakter-anlegen" && OVP_REMOVED_SKY_IDS.has(s.sky_id));
}

/**
 * DAS LEDGER OHNE DIE 30 — nur wenn das alles ist, was sich geaendert hat.
 *
 * Ein Publish mit 0 Schritten schreibt das Ledger nicht neu (`catalog-publish`
 * endet dort mit „nichts zu tun"). Nach der Entfernung auf Production fuehrte
 * es die 30 deshalb weiter, als Auskunft „fehlen auf Production" — fuer
 * immer, solange keine echte Staging-Aenderung einen Publish ausloest.
 *
 * Diese Funktion erlaubt die Fortschreibung genau dann, wenn
 *
 *   * das Ledger nach Abzug der entfernten SKY-IDs ZEICHENGLEICH der heutige
 *     Production-Stand ist (kein anderer Unterschied, nicht eine Zeile),
 *   * der Staging-Stand derselbe ist (Gleichstand), und
 *   * es ueberhaupt etwas abzuziehen gibt.
 *
 * Sie schreibt nichts; sie liefert den neuen Stand oder den Grund, warum nicht.
 */
export function ledgerOhneEntfernte(
  ledgerStand: Readonly<Record<string, string>>,
  standStaging: Readonly<Record<string, string>>,
  standProduction: Readonly<Record<string, string>>,
): { ok: true; stand: Record<string, string>; entfernt: string[] } | { ok: false; grund: string } {
  const entfernt = Object.keys(ledgerStand).filter((id) => OVP_REMOVED_SKY_IDS.has(id)).sort();
  if (entfernt.length === 0) return { ok: false, grund: "das Ledger fuehrt keine entfernte SKY-ID" };
  const rest: Record<string, string> = {};
  for (const [id, z] of Object.entries(ledgerStand)) if (!OVP_REMOVED_SKY_IDS.has(id)) rest[id] = z;
  const gleich = (a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>) => {
    const ka = Object.keys(a).sort(); const kb = Object.keys(b).sort();
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
  };
  if (!gleich(rest, standProduction)) {
    return { ok: false, grund: "das Ledger ohne die entfernten SKY-IDs ist nicht der Production-Stand "
      + "— es hat sich mehr veraendert; das ist ein Publish, keine Fortschreibung" };
  }
  if (!gleich(standStaging, standProduction)) {
    return { ok: false, grund: "Staging und Production stehen nicht gleich" };
  }
  return { ok: true, stand: rest, entfernt };
}
