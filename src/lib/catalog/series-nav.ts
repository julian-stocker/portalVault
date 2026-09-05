/**
 * Which series the catalog opens on.
 *
 * The catalog no longer has an "Alle" option (ADR-0038): 561 figures across
 * six games is a wall nobody scrolls, and the games are what collectors think
 * in. So a series is always chosen, and something has to choose the first one.
 *
 * The order comes from the database — `series.position`, ascending — which is
 * release order, so the default is Spyro's Adventure. Nothing is hardcoded
 * here: a seventh game would slot in wherever its position says.
 *
 * The previous short-code table (`SA`, `TT`, `SF` …) is gone with it. The
 * tabs spell the games out now, so an abbreviation table would have been a
 * second vocabulary with nothing reading it.
 *
 * Deliberately no colours. Element colour is a character metadatum
 * (ADR-0034); series is navigation chrome. Giving both a hue on the same
 * screen would invite "orange means Fire and also Giants" — see ADR-0035.
 */
import type { SeriesOption } from "@/lib/catalog/types";

/**
 * The series the catalog starts on.
 *
 * The list arrives already ordered by `position`; this takes the first of it
 * rather than sorting again, so the order stays a database decision.
 *
 * Empty input returns an empty string. That only happens when the catalog
 * itself is empty, and a made-up code would be worse than a filter that
 * matches nothing.
 */
export function defaultSeriesCode(series: readonly SeriesOption[]): string {
  return series[0]?.code ?? "";
}
