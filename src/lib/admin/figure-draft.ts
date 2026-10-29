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
import { statusOf, type CatalogStatus } from "@/lib/catalog/catalog-status";
import { asCardType, type CardType } from "@/lib/catalog/card-type";
import { asCatalogTypes, type CatalogType }
  from "@/lib/catalog/catalog-type";

/** What the dialog edits. Every value is what the server would store. */
export type AdminFigureDraft = {
  /** `null` means "no override" — the derived name is shown instead. */
  displayNameOverride: string | null;
  cardType: CardType;
  /** `null` means "no override" — the imported picture is shown instead. */
  imageOverridePath: string | null;
  /**
   * Der redaktionelle Status (CAT-02B) — drei Werte statt eines Häkchens.
   *
   * Er ERSETZT `catalogVisible` im Entwurf: zwei Felder für eine Frage wären
   * zwei Wahrheiten, und das Formular schreibt ohnehin nur geänderte Felder.
   * Die Sichtbarkeit folgt in der Datenbank aus dem Status (`0152`).
   */
  catalogStatus: CatalogStatus;
  /** `""` is a real value: the note was cleared. */
  adminNote: string;
  /**
   * DIE TYPMENGE (CAT-10, `0163`) — das sechste Feld, und die Schemaänderung,
   * die der Kopf dieser Datei verlangt hat.
   *
   * Sie steht hier und nicht neben `cardType`, weil sie etwas anderes ist:
   * `cardType` ist die KARTENKUNST (eine von sieben PNG-Dateien),
   * `types` die fachliche Klassifikation (eine Menge aus siebzehn). Die
   * Kartenkunst aus der Menge abzuleiten wäre falsch, und zwar gemessen —
   * `supabase/checks/cat10_projection_proof.sql`.
   *
   * ALS SORTIERTE LISTE, nicht als Menge: der Vergleich in `changedFields`
   * ist ein Zeichenvergleich, und zwei gleiche Mengen in anderer Reihenfolge
   * wären sonst eine Änderung. `asCatalogTypes()` sortiert.
   */
  types: readonly CatalogType[];
};

/** The fields, in the order they are saved. */
export const DRAFT_FIELDS = [
  "displayNameOverride",
  "cardType",
  "types",
  "imageOverridePath",
  "catalogStatus",
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
  catalogStatus?: CatalogStatus;
  types?: readonly string[];
}, adminNote: string | null): AdminFigureDraft {
  return {
    displayNameOverride: figure.displayNameOverride,
    cardType: asCardType(figure.cardType),
    /* Dieselbe Bewachung wie bei `cardType`: ein Wert, den diese Fassung
       nicht kennt, fällt heraus statt eine Beschriftungssuche zu
       zerbrechen. */
    types: asCatalogTypes(figure.types ?? []),
    imageOverridePath: figure.imageOverridePath,
    /* `statusOf` und nicht `figure.catalogStatus`: fehlt das Feld, ist die
       Ableitung aus der Sichtbarkeit exakt — siehe `catalog-status.ts`. */
    catalogStatus: statusOf(figure),
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
  return DRAFT_FIELDS.filter((field) => {
    /*
     * EIN ARRAY IST MIT `!==` IMMER UNGLEICH, auch wenn nichts geändert
     * wurde — und dann schriebe jedes Speichern die Typmenge neu, stünde in
     * ihrem Journal und kollidierte mit jedem, der sie inzwischen geändert
     * hat. Verglichen wird deshalb der Inhalt; beide Seiten sind sortiert
     * (`asCatalogTypes`), also genügt die Verkettung.
     */
    if (field === "types") {
      /*
       * `?? []` UND NICHT EIN VERLASS AUF DEN TYP: ein Entwurf, der aus einem
       * aelteren Build oder aus einer unvollstaendigen Antwort kommt, traegt
       * die Menge nicht — und „kein Feld" soll „keine Aenderung" heissen und
       * nicht einen Absturz im Speicherplan.
       */
      return (initial.types ?? []).join(",") !== (draft.types ?? []).join(",");
    }
    return initial[field] !== draft[field];
  });
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
 * Der Status ist keine Folge von etwas anderem.
 *
 * Den Kartentyp zu ändern darf niemals ändern, ob der öffentliche Katalog
 * eine Figur zeigt, und genau deshalb sind es getrennte Felder. Eon's Elite
 * ist der Fall, der es greifbar macht: alle 42 Zeilen sind `elite`, und 28
 * davon sind absichtlich nicht öffentlich (ADR-0069). Ein Dialog, der die
 * beiden koppelte, machte sie öffentlich, sobald jemand sie umklassifiziert.
 *
 * SEIT CAT-02B HEISST DAS FELD `catalogStatus` und hat drei Werte. Die Zusage
 * ist dieselbe und sogar etwas stärker: ein Statuswechsel steht genau dann im
 * Speicherplan, wenn jemand ihn gewählt hat.
 */
export function visibilityIsIndependent(
  initial: AdminFigureDraft,
  draft: AdminFigureDraft,
): boolean {
  return initial.catalogStatus === draft.catalogStatus
    ? true
    : changedFields(initial, draft).includes("catalogStatus");
}
