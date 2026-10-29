/**
 * "Alle · Sammlung · Fehlen · Verfügbar" — the catalogue's quick filter
 * (UX-01F).
 *
 * IT IS A PROJECTION, NOT A FOURTH PIECE OF STATE, and that is the whole
 * design. The catalogue already has two independent narrowings:
 *
 *   ownership      all · owned · missing   (`ownership.ts`)
 *   availability   all · available         (`availability.ts`)
 *
 * The operator asked for one compact, exclusive control over four values. The
 * obvious way to build that is a new filter with its own state — and it would
 * have been wrong, because `availability.ts` says why in its own header:
 *
 *   > A dimension of its own, deliberately not a third option beside
 *   > `Alle / In Besitz / Fehlend`. Owning a figure and being able to buy one
 *   > are independent facts, and the combinations people want are exactly the
 *   > ones a merged control would make impossible — "missing AND buyable" is
 *   > the whole reason somebody opens a catalog with money in mind.
 *
 * SO THE CONTROL IS EXCLUSIVE AND THE MODEL IS NOT. The four values are the
 * four common views, each written as a pair of the real dimensions; the
 * advanced dialog still sets both independently. Pick "Fehlen" in the bar and
 * then "nur mit Angebot" in the dialog, and you get missing AND buyable —
 * the bar then shows NOTHING selected, because no single one of its four
 * values describes what you are looking at, and claiming one would be a lie.
 *
 * Two consequences worth having:
 *
 *   - every combination keeps working by construction, because nothing was
 *     merged. The pool is still ownership × group × availability × series ×
 *     search, filtered in one place.
 *   - there is no second filter implementation to keep in step. `matchesOwnership`
 *     and `matchesAvailability` are untouched and remain the only predicates.
 */
import { DEFAULT_AVAILABILITY, type AvailabilityMode } from "@/lib/catalog/availability";
import { DEFAULT_OWNERSHIP, type OwnershipMode } from "@/lib/catalog/ownership";

/** The four values, in display order. `all` is the resting state. */
export const QUICK_FILTERS = ["all", "owned", "missing", "available"] as const;

export type QuickFilter = (typeof QUICK_FILTERS)[number];

export const DEFAULT_QUICK_FILTER: QuickFilter = "all";

/** The pair of real dimensions one quick value stands for. */
export type FilterPair = { ownership: OwnershipMode; availability: AvailabilityMode };

/**
 * What choosing a quick value does to the two real dimensions.
 *
 * Each value sets BOTH, which is what makes the control exclusive: picking
 * "Verfügbar" clears an ownership narrowing rather than adding to it, so the
 * highlighted segment always describes the whole of what is on screen.
 */
export function quickFilterPair(quick: QuickFilter): FilterPair {
  switch (quick) {
    case "owned":
      return { ownership: "owned", availability: DEFAULT_AVAILABILITY };
    case "missing":
      return { ownership: "missing", availability: DEFAULT_AVAILABILITY };
    case "available":
      return { ownership: DEFAULT_OWNERSHIP, availability: "available" };
    case "all":
    default:
      return { ownership: DEFAULT_OWNERSHIP, availability: DEFAULT_AVAILABILITY };
  }
}

/**
 * Which quick value the two dimensions currently add up to — or `null`.
 *
 * `null` IS THE IMPORTANT HALF. It means the dialog has set a combination
 * none of the four describes, "missing AND buyable" above all. The bar then
 * highlights nothing, which is the only honest thing it can do: highlighting
 * "Fehlen" would hide the availability narrowing, and highlighting "Alle"
 * would claim there is no narrowing at all.
 */
export function quickFilterOf(pair: FilterPair): QuickFilter | null {
  const restingAvailability = pair.availability === DEFAULT_AVAILABILITY;
  if (restingAvailability) {
    if (pair.ownership === "all") return "all";
    if (pair.ownership === "owned") return "owned";
    return "missing";
  }
  /* Availability is narrowing. Only the plain case has a name. */
  return pair.ownership === DEFAULT_OWNERSHIP ? "available" : null;
}

/**
 * Which of the four a given visitor may be offered.
 *
 * SIGNED OUT, "SAMMLUNG" AND "FEHLEN" ARE NOT QUESTIONS WITH ANSWERS, and
 * offering them would be worse than hiding them: a signed-out visitor
 * choosing "Fehlen" would see the entire catalogue, because nothing is owned
 * — the control would appear to work and would mean nothing. That is exactly
 * the trap the operator named.
 *
 * The rule is the project's existing one rather than a new one:
 * `offersOwnershipFilter({ signedIn, admin })` already decides whether the
 * ownership question can be asked at all, and this reads the same answer.
 * An administrator does not collect in their own catalogue (ADR-0042), so
 * they get the same two as a visitor.
 */
export function quickFiltersFor(offersOwnership: boolean): readonly QuickFilter[] {
  return offersOwnership ? QUICK_FILTERS : (["all", "available"] as const);
}
