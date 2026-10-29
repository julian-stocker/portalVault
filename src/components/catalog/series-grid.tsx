/**
 * The series selection as a fixed grid (UX-01F).
 *
 * WHAT IT REPLACES AND WHY. The games were a row of pills that scrolled
 * sideways — `SeriesTabs`, which chose scrolling over wrapping on the
 * reasoning that "a navigation whose height depends on how many games exist
 * is one the eye has to find again after every change". That reasoning was
 * sound and the conclusion was still wrong on a phone: the six games did not
 * fit, so Imaginators lived off the right edge of every visit, and the one
 * control used on every visit was the one you had to discover by swiping.
 *
 * A GRID ANSWERS BOTH. All six are visible at every width, so nothing is
 * hidden; and the block's height does not depend on how many games exist,
 * which is what the old comment actually cared about.
 *
 * THREE COLUMNS, THEN SIX — DECIDED BY THE CONTAINER, NOT THE SCREEN.
 *
 *   narrow   3 × 2, capped at 34 rem so the cells do not sprawl
 *   wide     6 × 1, the whole row, one game per cell
 *
 * `@container` is what makes that honest: the question is how wide this BLOCK
 * is, not how wide the display is, so the same component laid into a narrower
 * column later keeps the 3 × 2 form instead of promising six.
 *
 * THE THRESHOLD IS 44 rem (704 px) AND IT IS MEASURED. Six cells plus five
 * 6 px gaps leave 112 px a cell at that width; "Spyro's Adventure" needs
 * about 102 px of type at 12 px and so wraps to two lines, while
 * "SuperChargers" — the longest single word at 13 characters, about 78 px —
 * never has to. Below the threshold three columns give 105 px a cell on a
 * 360 px phone, which is the same arithmetic one row up. Nothing is
 * truncated at any width; long names take a second line and the grid makes
 * every cell in the row that height.
 *
 * 48 px CELLS. `min-h-12` is inside the 48–56 px the operator asked for and
 * above the 44 px touch floor, and two lines of 12 px type at `leading-tight`
 * need 30 — so the height is the floor rather than the content, and the block
 * is 102 px on a phone and 48 on a desktop.
 *
 * THE SPECIAL CATEGORIES ARE REACHABLE AND QUIET. Smoke Test and RLS Test
 * Series are in the same table as the games — the split is `position >= 90`,
 * a gap the data already uses (`series-nav.ts`) — but they are staging
 * artefacts, not games, and a grid cell each would give them the same weight
 * as Trap Team. They get a native `<select>` instead: one line, no new
 * vocabulary, and it renders only where such series exist, so production
 * shows no empty furniture.
 *
 * No series colours, unchanged from the pills: element colour is a character
 * metadatum (ADR-0034) and series is navigation. Two hue systems on one
 * screen would collide (ADR-0035).
 */
"use client";

import { isSpecialCode, mainSeries, specialSeries } from "@/lib/catalog/series-nav";
import type { SeriesOption } from "@/lib/catalog/types";
import { de } from "@/lib/i18n/de";

/** One cell. 48 px tall, two lines of label if it needs them. */
const CELL =
  "flex min-h-12 items-center justify-center rounded-sky-sm px-2 py-1 text-center "
  + "text-[12px] leading-tight transition-colors";

/**
 * THE ACTIVE CELL IS GOLD, AND THAT NEEDED A SECOND LOOK.
 *
 * Gold means POSSESSION in this product — the tile's ground, its edge and its
 * glow all say "yours", and `EditionBanner` was kept off gold for exactly
 * that reason: "a gold banner would make an unowned Legendary look owned".
 * The operator asked for a gold series selection anyway, having seen it in a
 * mockup, so it is built — and the collision is kept from mattering by
 * spending LESS gold than ownership does:
 *
 *   ownership   a warm ground, a gold edge, AND a soft outward glow
 *   series      a gold edge and a faint ground, and NO glow at all
 *
 * The glow is the signal that is missing here, which is also what the
 * operator asked for ("keine großen Glüheffekte, die den Header optisch
 * überladen"). And the two never appear on the same object: one is a
 * navigation cell in the header, the other a figure in the grid below.
 */
const CELL_ACTIVE =
  "bg-own-subtle/35 font-semibold text-own-ink ring-1 ring-own-line-strong";
const CELL_IDLE =
  "bg-deep/50 font-normal text-muted ring-1 ring-border/50 "
  + "hover:text-foreground hover:ring-border";

export function SeriesGrid({
  series,
  active,
  onSelect,
}: {
  series: readonly SeriesOption[];
  active: string;
  onSelect: (code: string) => void;
}) {
  const games = mainSeries(series);
  const specials = specialSeries(series);
  /*
   * A special category is chosen, so NO cell is current. Without this the
   * grid would highlight Spyro's Adventure while the catalogue showed Smoke
   * Test — a navigation lying about where you are.
   */
  const onSpecial = isSpecialCode(series, active);

  return (
    /*
     * `@container` turns this box into the query's subject, so the grid below
     * asks how wide IT is rather than how wide the screen is. The wrapper
     * draws nothing and takes the full available width — the cap lives on the
     * grid, where it applies to the 3-column form only.
     */
    <div className="@container flex flex-col gap-2">
      <div
        role="tablist"
        aria-label={de.catalog.seriesNav}
        /* Three columns, capped; six and uncapped once the container holds
           them. `grid` gives every cell in a row one height. */
        className={
          "grid w-full max-w-[34rem] grid-cols-3 gap-1.5 "
          + "@min-[44rem]:max-w-none @min-[44rem]:grid-cols-6"
        }
      >
        {games.map((option) => {
          const isActive = !onSpecial && option.code === active;
          return (
            <button
              key={option.code}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onSelect(option.code)}
              className={`${CELL} ${isActive ? CELL_ACTIVE : CELL_IDLE}`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {specials.length > 0 ? (
        /*
         * THE QUIET SECOND DOOR. A `<select>` and not more pills: these are
         * test categories, they are rare, and on a phone a native picker is
         * the one control that costs a single line however many there are.
         *
         * Its empty value means "a game is chosen" rather than "nothing is
         * chosen" — there is no such thing as no series (ADR-0038) — so
         * picking the blank option is not offered as an action. The label
         * says what the list is for; the grid above says where you are.
         */
        <label
          className={
            "flex w-full max-w-[34rem] items-center gap-2 text-[11px] text-muted "
            + "@min-[44rem]:max-w-[22rem]"
          }
        >
          <span className="shrink-0">{de.catalog.seriesExtraLabel}</span>
          <select
            value={onSpecial ? active : ""}
            onChange={(event) => {
              if (event.target.value !== "") onSelect(event.target.value);
            }}
            className={
              "min-h-9 min-w-0 flex-1 rounded-sky-sm bg-deep/50 px-2 text-[12px] "
              + "text-foreground ring-1 ring-border/50 transition-colors "
              + "hover:ring-border focus-ring"
            }
          >
            <option value="">{de.catalog.seriesExtraNone}</option>
            {specials.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}
