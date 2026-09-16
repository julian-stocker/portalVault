/**
 * The five editorial fields, as a draft (V3.8).
 *
 * WHY THIS IS A MODULE AND NOT STATE INSIDE THE DIALOG
 *
 * The admin edit dialog collects changes and saves them together, which means
 * three questions have to be answered before anything is written: what did
 * the server say, what has the operator changed, and which of those changes
 * actually need a round trip. All three are pure functions of two objects, so
 * they live here where they can be tested directly — this project has no DOM
 * renderer, and logic buried in a component is logic nothing can check.
 *
 * WHAT IS EDITABLE, AND WHY ONLY THIS
 *
 * Five fields, because five is what an administrator owns:
 *
 *   display_name_override   the public name, instead of the imported one
 *   card_type               which artwork the figure is printed on
 *   image_override_path     a picture chosen over the imported one
 *   catalog_visible         whether the public catalogue shows it
 *   admin_note              an internal note, never public
 *
 * Everything else a figure has belongs to the catalogue import and is
 * rewritten on every run — the name, the slug, the series, the category, the
 * market price, the image. Offering them here would be offering an edit that
 * silently disappears. Inventory, prices and listings are a different domain
 * with a different rule (stock moves only through `record_inventory_movement`,
 * ADR-0037/0047) and stay in `/admin/inventory`.
 *
 * THERE IS NO SIXTH FIELD TO ADD WITHOUT A SCHEMA DECISION.
 */
import { asCardType, type CardType } from "@/lib/catalog/card-type";

/** What the dialog edits. Every value is what the server would store. */
export type AdminFigureDraft = {
  /** `null` means "no override" — the derived name is shown instead. */
  displayNameOverride: string | null;
  cardType: CardType;
  /** `null` means "no override" — the imported picture is shown instead. */
  imageOverridePath: string | null;
  catalogVisible: boolean;
  /** `""` is a real value: the note was cleared. */
  adminNote: string;
};

/** The fields, in the order they are saved. */
export const DRAFT_FIELDS = [
  "displayNameOverride",
  "cardType",
  "imageOverridePath",
  "catalogVisible",
  "adminNote",
] as const;

export type DraftField = (typeof DRAFT_FIELDS)[number];

/**
 * The server's answer, as a draft.
 *
 * `asCardType` rather than a cast: a value a later migration adds, read by an
 * older build, becomes `standard` here instead of an undefined artwork lookup
 * — the same guard the catalogue query uses.
 */
export function draftFrom(figure: {
  displayNameOverride: string | null;
  cardType: string;
  imageOverridePath: string | null;
  catalogVisible: boolean;
}, adminNote: string | null): AdminFigureDraft {
  return {
    displayNameOverride: figure.displayNameOverride,
    cardType: asCardType(figure.cardType),
    imageOverridePath: figure.imageOverridePath,
    catalogVisible: figure.catalogVisible,
    adminNote: adminNote ?? "",
  };
}

/**
 * Which fields differ, in save order.
 *
 * This is the save plan: an untouched field is never written, so an
 * administrator who opens a dialog, changes the note and saves does not also
 * rewrite the card type, does not appear in its journal, and cannot collide
 * with somebody who changed it meanwhile.
 */
export function changedFields(
  initial: AdminFigureDraft,
  draft: AdminFigureDraft,
): DraftField[] {
  return DRAFT_FIELDS.filter((field) => initial[field] !== draft[field]);
}

/** Whether anything at all has been changed. */
export function isDirty(initial: AdminFigureDraft, draft: AdminFigureDraft): boolean {
  return changedFields(initial, draft).length > 0;
}

/**
 * What a save attempt produced, per field.
 *
 * FIVE WRITES ARE NOT ONE TRANSACTION, and this type exists so the dialog
 * cannot pretend otherwise. Each field is its own `security definer` function
 * with its own `is_shop_admin()` check; there is no RPC that takes all five,
 * and inventing one would be a schema change for a dialog.
 *
 * So a save can end up half done, and the honest thing is to say which half.
 */
export type FieldOutcome = { field: DraftField; ok: boolean; message?: string };

export type SaveReport = {
  /** Fields that were written. */
  saved: DraftField[];
  /** Fields that were attempted and refused. */
  failed: FieldOutcome[];
  /** Fields that were never attempted, because an earlier one failed. */
  skipped: DraftField[];
};

/**
 * Reads the per-field outcomes into one verdict.
 *
 * `complete` is true only when every planned field was written. A partial
 * result is NOT a success with a warning: the dialog stays open, the values
 * that did land are the new baseline, and the ones that did not are still
 * dirty.
 */
export function summarise(plan: readonly DraftField[], outcomes: readonly FieldOutcome[]): SaveReport {
  const saved = outcomes.filter((o) => o.ok).map((o) => o.field);
  const failed = outcomes.filter((o) => !o.ok);
  const attempted = new Set(outcomes.map((o) => o.field));
  return { saved, failed, skipped: plan.filter((field) => !attempted.has(field)) };
}

/** Whether every planned field was written. */
export function isComplete(plan: readonly DraftField[], report: SaveReport): boolean {
  return report.saved.length === plan.length && report.failed.length === 0;
}

/**
 * The new baseline after a save.
 *
 * Only the fields that actually landed move; a field that failed keeps the
 * value the server still holds, so it stays dirty and the operator can try
 * again without losing what they typed.
 */
export function baselineAfter(
  initial: AdminFigureDraft,
  draft: AdminFigureDraft,
  saved: readonly DraftField[],
): AdminFigureDraft {
  const next = { ...initial };
  for (const field of saved) {
    // Each field keeps its own type; assigning through the union needs the
    // cast, and the key set is closed by `DraftField`.
    (next as Record<string, unknown>)[field] = draft[field];
  }
  return next;
}

/**
 * Visibility is not a consequence of anything else.
 *
 * Changing a figure's card type must never change whether the public
 * catalogue shows it, and the two are separate fields for that reason. Eon's
 * Elite is the case that makes it concrete: all 42 rows are `elite`, and 28
 * of them are deliberately not public (ADR-0069). A dialog that coupled the
 * two would make them public the moment somebody reclassified them.
 */
export function visibilityIsIndependent(
  initial: AdminFigureDraft,
  draft: AdminFigureDraft,
): boolean {
  return initial.catalogVisible === draft.catalogVisible
    ? true
    : changedFields(initial, draft).includes("catalogVisible");
}
