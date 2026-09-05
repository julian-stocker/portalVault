/**
 * Short codes for the series navigation.
 *
 * Presentation only. The canonical series data — code, label, position —
 * comes from the database and is not touched here. This adds one thing: a
 * two-or-three letter form short enough that all seven tabs fit a 360 px
 * screen without a single truncated label.
 *
 * The short form is NOT the database code. Trap Team is stored as `T` and
 * shown as `TT`, because `T` alone reads as nothing. That mismatch is
 * exactly why this table exists rather than reusing `series.code`.
 *
 * Deliberately no colours here. Element colour is a character metadatum
 * (ADR-0034); series is navigation chrome. Giving both a hue on the same
 * screen would invite "orange means Fire and also Giants" — see the note in
 * ADR-0035.
 */

/** Database code → the form shown in the tab. */
const SHORT: Readonly<Record<string, string>> = {
  SA: "SA",
  G: "G",
  SF: "SF",
  T: "TT",
  SC: "SC",
  I: "I",
};

/**
 * The short form, or the code itself for a series this table does not know.
 *
 * A new series would show its raw code rather than disappearing — visible,
 * slightly ugly, and impossible to miss when it is time to add it here.
 */
export function seriesShort(code: string): string {
  return SHORT[code] ?? code;
}

/** Every code this table covers. Used by the test that keeps it in step. */
export function knownSeriesCodes(): string[] {
  return Object.keys(SHORT);
}
