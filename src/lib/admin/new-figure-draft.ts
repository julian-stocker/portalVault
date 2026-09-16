/**
 * What "a new figure" is, before anything is written (V3.9).
 *
 * WHY THIS IS A MODULE AND NOT PART OF THE DIALOG
 *
 * Everything decidable about a create is decidable without a browser: which
 * fields are required, whether the chosen category belongs to the chosen
 * series, what a template may carry over, which existing figures look close
 * enough to warn about. The dialog renders these answers; it does not make
 * them. `figure-draft.ts` splits the V3.8 editor the same way.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * The SKY-ID and the slug. Both are decided by the database inside the
 * transaction that creates the row — the ID by a sequence, the slug against
 * what is actually taken (ADR-0011, ADR-0070). This module can PREVIEW a slug
 * so the operator sees what is coming, and the preview is explicitly not a
 * promise: between preview and create somebody else's figure may take the
 * bare form, and then the database qualifies it.
 */
import { CARD_TYPES, type CardType } from "@/lib/catalog/card-type";
import { slugify } from "@/lib/catalog/slug";
import type { CatalogFigure } from "@/lib/catalog/types";

/** Exactly what the operator fills in. Nothing derived, nothing allocated. */
export type NewFigureDraft = {
  name: string;
  seriesCode: string;
  /** `null` until a series is chosen — the categories depend on it. */
  categoryId: number | null;
  cardType: CardType;
  /**
   * Hidden by default (ADR-0070).
   *
   * A figure that has just been created has no picture, no curated character
   * and possibly a working title. Publishing it the moment the button is
   * pressed shows every visitor a half-described row; the operator turns it
   * on when it is ready.
   */
  catalogVisible: boolean;
  /** `""` means "no override" — the derived display name applies. */
  displayNameOverride: string;
  /** `""` means "no note". */
  adminNote: string;
  /**
   * Which existing figure this one is derived from, or `null` for an empty
   * start (ADR-0070a).
   *
   * A SKY-ID, not a character id. The server reads the character from this
   * row, so the client cannot assert a curated identity — it can only point
   * at a figure that already exists. It is not stored on the new row and
   * establishes no parent relationship: what survives the create is the
   * shared `character_id`, which is the catalogue's own way of saying two
   * collectibles are the same character.
   */
  templateSkyId: string | null;
};

export const EMPTY_DRAFT: NewFigureDraft = {
  name: "",
  seriesCode: "",
  categoryId: null,
  cardType: "standard",
  catalogVisible: false,
  displayNameOverride: "",
  adminNote: "",
  templateSkyId: null,
};

/**
 * The options one dropdown needs. Both lists come from the catalogue, which
 * is why neither is a free-text field: the domain is already known and typing
 * it again is how a second spelling of "Spyro's Adventure" gets into the
 * data (ADR-0019, and rule 4 of the data rules).
 */
export type SeriesOption = { code: string; label: string };
export type CategoryOption = {
  id: number;
  seriesCode: string;
  name: string;
  /** Shown read-only once the category is picked. Never chosen directly. */
  catalogGroup: string | null;
};

/**
 * Which categories may be offered for a series.
 *
 * `skylanders_category_fk` is a COMPOSITE key over (category_id,
 * series_code): a category of Giants on a figure of Trap Team is refused by
 * the database. Filtering here means the operator never gets to make that
 * mistake, rather than being told about it afterwards.
 */
export function categoriesFor(
  categories: readonly CategoryOption[],
  seriesCode: string,
): CategoryOption[] {
  if (seriesCode === "") return [];
  return categories.filter((category) => category.seriesCode === seriesCode);
}

/** The group the figure will land in — a property of the category (ADR-0041). */
export function groupOf(
  categories: readonly CategoryOption[],
  categoryId: number | null,
): string | null {
  if (categoryId === null) return null;
  return categories.find((category) => category.id === categoryId)?.catalogGroup ?? null;
}

export type DraftProblem = "name" | "series" | "category";

/**
 * What still stands in the way of creating this figure.
 *
 * Three answers, because there are three required columns the operator owns.
 * Everything else on `skylanders` is either allocated, derived, defaulted or
 * owned by somebody who is not in this dialog.
 */
export function problemsWith(
  draft: NewFigureDraft,
  categories: readonly CategoryOption[],
): DraftProblem[] {
  const problems: DraftProblem[] = [];
  if (draft.name.trim() === "") problems.push("name");
  if (draft.seriesCode === "") problems.push("series");

  const chosen = categories.find((category) => category.id === draft.categoryId);
  // Not merely "is one picked": a category left over from a series the
  // operator has since changed is worse than none, because it looks answered.
  if (chosen === undefined || chosen.seriesCode !== draft.seriesCode) problems.push("category");

  return problems;
}

export function isCreatable(
  draft: NewFigureDraft,
  categories: readonly CategoryOption[],
): boolean {
  return problemsWith(draft, categories).length === 0;
}

/**
 * Changing the series clears the category.
 *
 * Keeping it would leave a category of the old series selected against the
 * new one — valid-looking in the form and refused by the composite foreign
 * key. The dialog never has to remember this; the transition does.
 */
export function withSeries(draft: NewFigureDraft, seriesCode: string): NewFigureDraft {
  if (seriesCode === draft.seriesCode) return draft;
  return { ...draft, seriesCode, categoryId: null };
}

/**
 * THE TEMPLATE, AND WHAT PICKING ONE ACTUALLY MEANS (ADR-0070a).
 *
 * Not a form-prefill. Choosing Fire Kraken as a template says "the thing I am
 * adding is another Fire Kraken" — a special edition, a finish, a colourway.
 * The new row is a different COLLECTIBLE and the same CHARACTER, and
 * `character_id` is the column that already says exactly that (ADR-0034).
 *
 * So the relationship travels, and it travels SERVER-SIDE: this function
 * carries the template's SKY-ID, and `admin_create_figure()` reads the
 * character from that row itself. The client never states a character id — it
 * states which figure the operator pointed at.
 *
 * WHAT ELSE IT CARRIES
 *
 * Series and category, as starting values the operator may still change. Both
 * are arguments to the create either way; the composite foreign key decides
 * whether the pair is valid, and changing them does not sever the inherited
 * character — `character_id` has no series component (see ADR-0070a).
 *
 * WHAT IT REFUSES TO CARRY
 *
 *   - `card_type` is usually the very thing that DIFFERS on a new variant, so
 *     copying it would pre-fill the field most likely to be wrong. It starts
 *     at `standard`.
 *   - `catalog_visible` copied from a published figure would publish the new
 *     one. It starts hidden, like every create.
 *   - `display_name_override` and `admin_note` are about that figure.
 *   - the picture, the price, the stock, the offers and the history are not
 *     on this draft at all and never were.
 *
 * The name is offered as a STARTING VALUE only. `problemsWith()` does not
 * know it came from a template, which is the point: the operator has to look
 * at the field either way, and `nameConfirmed()` below is what the dialog
 * asks before it will create.
 */
export function fromTemplate(figure: CatalogFigure): NewFigureDraft {
  return {
    ...EMPTY_DRAFT,
    seriesCode: figure.seriesCode,
    categoryId: figure.categoryId,
    name: figure.name,
    templateSkyId: figure.skyId,
  };
}

/**
 * What a template can hand over, for the dialog to say out loud.
 *
 * `character_id` is NULL on 500 of the 604 rows — traps, vehicles, crystals,
 * and everything not yet curated. A template like that inherits nothing, and
 * the operator is told so rather than left to assume a relationship exists.
 * Nothing is ever guessed from the name to fill the gap (ADR-0034).
 */
export function inheritsCharacter(template: CatalogFigure | null): boolean {
  return template !== null && template.characterId !== null;
}

/**
 * Whether the operator has settled on a name of their own.
 *
 * A template hands over the source figure's name so the new one can be typed
 * as a change to it rather than from nothing. Creating a second row with the
 * identical name is legal — the catalogue is full of legitimately repeated
 * names — but doing it by simply not touching the field is almost never what
 * was meant.
 */
export function nameConfirmed(draft: NewFigureDraft, templateName: string | null): boolean {
  if (templateName === null) return true;
  return draft.name.trim() !== templateName.trim();
}

/**
 * A preview of the slug the figure will get, computed the way the database
 * computes stage one.
 *
 * Stage one only. The qualified forms depend on what is taken at the moment
 * of the insert, which this side cannot know and must not guess — the
 * database decides, and `next_figure_slug()` is where that lives.
 */
export function slugPreview(draft: NewFigureDraft): string {
  return slugify(draft.name);
}

export type SimilarFigure = {
  skyId: string;
  displayName: string;
  seriesLabel: string;
  cardType: CardType;
};

/** How many matches are worth putting in front of somebody at once. */
const MAX_SIMILAR = 6;

/**
 * Existing figures close enough to be worth a second look — a WARNING, never
 * a refusal.
 *
 * `name` is deliberately not unique and must stay that way. The real
 * catalogue has fourteen rows ending in "- ohne OVP", six copies of
 * "Game (Xbox 360)" across the series, and "Kaos" as a trap, a trophy and a
 * Sensei. A unique constraint on (name, series) would refuse legitimate
 * variants, so the check is advisory and the operator may proceed.
 *
 * Compared on the slug form rather than the raw string, so "Dino-Rang" and
 * "Dino Rang" — a real disagreement between the Excel's own sheets — are
 * recognised as the same neighbourhood. Only the same series: the same name
 * in another game is the normal case, not a warning.
 */
export function similarFigures(
  draft: NewFigureDraft,
  figures: readonly CatalogFigure[],
): SimilarFigure[] {
  const base = slugify(draft.name);
  if (base === "" || draft.seriesCode === "") return [];

  return figures
    .filter((figure) => figure.seriesCode === draft.seriesCode && slugify(figure.name) === base)
    .slice(0, MAX_SIMILAR)
    .map((figure) => ({
      skyId: figure.skyId,
      displayName: figure.displayName,
      seriesLabel: figure.seriesLabel,
      cardType: figure.cardType,
    }));
}

/** Narrowing for a value that arrived from a `<select>`. */
export function isCardTypeValue(value: string): value is CardType {
  return (CARD_TYPES as readonly string[]).includes(value);
}
