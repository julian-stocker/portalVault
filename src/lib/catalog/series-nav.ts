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

/**
 * Where the games end and the special categories begin (UX-01F).
 *
 * THE RULE IS IN THE DATA ALREADY, and this only names it. `series.position`
 * is release order, and the project has put its non-release series in a
 * deliberately distant block:
 *
 *     0  SA    Spyro's Adventure        98  SMOK  Smoke Test
 *     1  G     Giants                   99  TEST  RLS Test Series
 *     2  SF    Swap Force
 *     3  T     Trap Team
 *     4  SC    SuperChargers
 *     5  I     Imaginators
 *
 * So the threshold is a gap in the numbering, not a count. NINETY RATHER
 * THAN SIX, deliberately: this file's own rule is that nothing about the
 * games is hardcoded, and "the first six" would break the day a seventh ships
 * — it would be filed as a special category and vanish from the grid. At 90
 * a seventh game slots in at position 6 and appears where it belongs, while
 * the 98/99 block keeps its meaning.
 *
 * WHAT IT IS NOT: a visibility rule. Both kinds stay reachable and both stay
 * in the same table; this decides only WHERE a series is offered — the fixed
 * grid, or the quiet secondary list beside it.
 */
export const SPECIAL_SERIES_FROM = 90;

export function isSpecialSeries(option: SeriesOption): boolean {
  return option.position >= SPECIAL_SERIES_FROM;
}

/**
 * The games, in release order — what the 3 × 2 grid shows.
 *
 * Six today, and the grid is three columns wide, so a seventh and eighth game
 * would make it three rows rather than needing a decision.
 */
export function mainSeries(series: readonly SeriesOption[]): SeriesOption[] {
  return series.filter((option) => !isSpecialSeries(option));
}

/**
 * The special categories — Smoke Test, RLS Test Series, and whatever later
 * joins that block.
 *
 * Usually empty on production and populated on staging, which is why the
 * control that offers them renders only when there are any: an empty
 * secondary list would be a permanent piece of furniture for a case that
 * does not exist.
 */
export function specialSeries(series: readonly SeriesOption[]): SeriesOption[] {
  return series.filter(isSpecialSeries);
}

/**
 * Whether the chosen code is one of the special categories.
 *
 * The grid needs this to know that NONE of its cells is the current one —
 * otherwise a visitor in "Smoke Test" would see Spyro's Adventure
 * highlighted, which is the kind of quiet lie a navigation must not tell.
 */
export function isSpecialCode(series: readonly SeriesOption[], code: string): boolean {
  const option = series.find((entry) => entry.code === code);
  return option !== undefined && isSpecialSeries(option);
}
