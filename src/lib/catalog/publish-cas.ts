/**
 * Compare-and-Set fuer die Funktionsschritte des Publish (Klasse B, CAT-11).
 *
 * DIE LUECKE. Die Klasse-A- und -C-Felder schreibt der Apply-Pfad mit einem
 * `update`, das den erwarteten alten Wert UND die Vergleichsmarke
 * `updated_at` in seiner WHERE-Bedingung traegt (TOR 2). Die vier Felder der
 * Klasse B — `types`, `visible_type`, `base_sky_id`, `familie` — gehen
 * dagegen ueber ihre Admin-Funktionen (`0158`, `0159`, `0163`), und die
 * nehmen keinen erwarteten Wert entgegen. Bis hierher schuetzten sie nur
 * TOR 1 und der Driftriegel VOR dem Lauf. Eine Aenderung auf Production
 * zwischen Plan und Schritt waere still ueberschrieben worden.
 *
 * DIE ANTWORT, OHNE NEUE MIGRATION AUF PRODUCTION:
 *
 *   VORHER  Die Zeile wird unmittelbar vor der Funktion gelesen. Die Marke
 *           muss die sein, die dieser Lauf zuletzt gesehen oder selbst
 *           erzeugt hat, und der Feldwert der erwartete alte (`von`) — oder
 *           schon der neue (`nach`), denn ein Teillauf und eine Funktion,
 *           die ein Nachbarfeld mitschreibt (`admin_set_variant_base` setzt
 *           die Familie aus der Basisfigur), duerfen keinen Abbruch ausloesen.
 *   NACHHER Die Zeile wird wieder gelesen; der Feldwert MUSS jetzt `nach`
 *           sein. Erst dann wird die neue Marke uebernommen.
 *
 * WAS DAS NICHT IST: atomar. Zwischen der Vorabpruefung und der Funktion
 * liegt ein Lesevorgang Abstand. Eine fremde Schreibung genau dort wird
 * nicht verhindert, aber sie bleibt nicht unbemerkt: jede Admin-Funktion
 * journalisiert, und TOR 3 vergleicht das Journalwachstum mit der vorher
 * gerechneten Erwartung — „eine Zeile mehr ist so verdaechtig wie eine
 * weniger". Atomar waere nur eine Datenbankfunktion, die Pruefung und
 * Schreibung in einer Transaktion haelt; das ist eine eigene Migration auf
 * Production mit eigener Freigabe.
 *
 * REIN: keine Datenbank, kein Netz. Der Apply-Pfad liest, diese Datei urteilt.
 */

export const KLASSE_B_FELDER = ["types", "visible_type", "base_sky_id", "familie"] as const;
export type KlasseBFeld = (typeof KLASSE_B_FELDER)[number];

/** Die Spalte, die ein Klasse-B-Feld in `skylanders` hat. */
export const SPALTE: Readonly<Record<KlasseBFeld, string>> = {
  types: "types",
  visible_type: "visible_type",
  base_sky_id: "base_sky_id",
  familie: "character_id",
};

/**
 * Ein gelesener Spaltenwert in der Schreibweise des Plans: `~` fuer NULL,
 * eine Menge sortiert und mit `+` verbunden, eine Familie als Name.
 */
export function planwert(
  feld: KlasseBFeld,
  roh: unknown,
  charakterName: ReadonlyMap<number, string>,
): string {
  if (roh === null || roh === undefined) return "~";
  if (feld === "types") {
    const menge = Array.isArray(roh) ? roh.map(String) : [];
    return menge.length === 0 ? "~" : [...menge].sort().join("+");
  }
  if (feld === "familie") {
    const name = charakterName.get(Number(roh));
    /* Eine id, die das Ziel nicht kennt, ist ein eigener, sprechender Wert —
       er stimmt mit keinem Plan ueberein und fuehrt damit zum Abbruch. */
    return name ?? `#${String(roh)}`;
  }
  return String(roh);
}

/** `grund` ist leer, wenn `ok`. Eine Form, damit jeder Aufrufer sie ohne Eingrenzung liest. */
export type Urteil = { ok: boolean; grund: string };

/** VORHER: darf die Funktion jetzt laufen? */
export function pruefeVorher(args: {
  wie: string;
  ist: string;
  von: string;
  nach: string;
  markeIst: unknown;
  markeErwartet: unknown;
  /**
   * Weitere Werte, die dieser Lauf selbst hinterlassen haben kann. Einziger
   * Fall heute: `admin_set_figure_types` setzt das Banner auf „–" (`~`),
   * wenn es aus der neuen Menge faellt — der folgende `visible_type`-Schritt
   * findet dann `~` vor, und das ist kein fremder Eingriff.
   */
  auchErlaubt?: readonly string[];
}): Urteil {
  const { wie, ist, von, nach, markeIst, markeErwartet, auchErlaubt = [] } = args;
  if (markeErwartet === undefined || markeErwartet === null) {
    return { ok: false, grund: `${wie}: keine Vergleichsmarke — die Zeile steht nicht in `
      + "der Momentaufnahme und wurde in diesem Lauf nicht zurueckgelesen." };
  }
  if (String(markeIst) !== String(markeErwartet)) {
    return { ok: false, grund: `${wie}: die Zeile hat sich seit dem letzten Lesen bewegt `
      + `(updated_at ${String(markeErwartet)} -> ${String(markeIst)}). Ein fremder `
      + "Eingriff auf dem Ziel — nichts weiter schreiben, neu planen." };
  }
  if (ist !== von && ist !== nach && !auchErlaubt.includes(ist)) {
    return { ok: false, grund: `${wie}: erwartet ${von} (oder bereits ${nach}), `
      + `vorgefunden ${ist}. Ein fremder Wert — er wird nicht ueberschrieben.` };
  }
  return { ok: true, grund: "" };
}

/** NACHHER: hat die Funktion genau den geplanten Wert hinterlassen? */
export function pruefeNachher(args: { wie: string; ist: string; nach: string }): Urteil {
  const { wie, ist, nach } = args;
  return ist === nach
    ? { ok: true, grund: "" }
    : { ok: false, grund: `${wie}: nach dem Schreiben steht ${ist}, geplant war ${nach}.` };
}

/* ==========================================================================
 * CAT-19 — was ein Familien- oder Basisschritt NEBENBEI bewegt hat
 * ======================================================================= */

/** Die Familie einer Zeile und ihrer direkten Varianten, wie gelesen. */
export type Familienbild = ReadonlyMap<string, {
  character_id: number | null; base_sky_id: string | null; updated_at: unknown;
}>;

export type Familienbefund = {
  /** Journalzeilen, die der Schritt über seine eigene hinaus erzeugt hat. */
  nebenbei: number;
  /** Die Familie der Zeile selbst nach dem Schritt. */
  eigeneNeu: number | null;
  /** Hat ein `base_sky_id`-Schritt die Familie der Zeile selbst bewegt? */
  eigeneUebernommen: boolean;
  /** Mitbewegte Varianten mit ihrem neuen Wert und ihrer neuen Marke. */
  mitbewegt: [string, { character_id: number | null; updated_at: unknown }][];
  /** Gesetzt, wenn sich etwas bewegt hat, das die Regel nicht erklärt. */
  fehler: string | null;
};

/**
 * Bewertet das Familienbild vor und nach einem Klasse-B-Schritt (`0168`).
 *
 *   * `base_sky_id`-Schritt: die Zeile selbst darf ihre Familie wechseln —
 *     auf die ihrer neuen Basisfigur (`0168`) oder, ohne `0168`, durch die
 *     Übertragung aus `0159`. Eine Journalzeile mehr.
 *   * `familie`-Schritt: die eigene Änderung ist der Schritt selbst; jede
 *     Variante der Zeile, die sich bewegt, muss GENAU den neuen Wert der
 *     Zeile tragen und noch auf sie zeigen. Je eine Journalzeile mehr.
 *   * Alles andere ist ein fremder Eingriff — `fehler`.
 *
 * REIN: der Executor liest, diese Funktion urteilt.
 */
export function bewerteFamilienbild(args: {
  feld: "familie" | "base_sky_id";
  skyId: string;
  vor: Familienbild;
  nach: Familienbild;
}): Familienbefund {
  const { feld, skyId, vor, nach } = args;
  const eigeneNeu = nach.get(skyId)?.character_id ?? null;
  const eigeneAlt = vor.get(skyId)?.character_id ?? null;
  const befund: Familienbefund = {
    nebenbei: 0, eigeneNeu, eigeneUebernommen: false, mitbewegt: [], fehler: null,
  };
  if (feld === "base_sky_id" && eigeneNeu !== eigeneAlt) {
    befund.nebenbei += 1;
    befund.eigeneUebernommen = true;
  }
  for (const [id, n] of nach) {
    if (id === skyId) continue;
    const v = vor.get(id);
    if (v === undefined || v.character_id === n.character_id) continue;
    if (feld !== "familie" || n.base_sky_id !== skyId || n.character_id !== eigeneNeu) {
      befund.fehler = `${id} hat sich mitbewegt, aber nicht auf die Familie der Basisfigur `
        + `(${String(n.character_id)} statt ${String(eigeneNeu)}).`;
      return befund;
    }
    befund.nebenbei += 1;
    befund.mitbewegt.push([id, { character_id: n.character_id, updated_at: n.updated_at }]);
  }
  return befund;
}
