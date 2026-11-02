/**
 * Wie ein Feld der Änderungshistorie auf dem Schirm heißt (UX-A5).
 *
 * `catalog_admin_changes.field` ist ein Spaltenname — `display_name_override`,
 * `catalog_visible`, `base_sky_id`. Die Historie zeigte ihn roh. Hier wird
 * nur die BEZEICHNUNG übersetzt; Werte, Zeitpunkte und das Journal selbst
 * bleiben, was sie sind.
 *
 * DIESELBEN WÖRTER WIE IM EDITOR. Wo ein Feld schon eine Bezeichnung hat,
 * zeigt diese Liste auf genau diesen Schlüssel, damit Historie und Editor nicht
 * auseinanderlaufen. Nur was fehlte, steht neu unter `admin.changeFields`.
 *
 * Die Liste folgt der Prüfregel `catalog_admin_changes_field_known`
 * (zuletzt `0168`). Ein Feld, das eine spätere Migration einführt und das
 * hier noch fehlt, erscheint mit seinem Spaltennamen — sichtbar statt
 * verschluckt, und der Test unten fällt auf, sobald die Regel wächst.
 */
import { de } from "@/lib/i18n/de";

const own = de.admin.changeFields;

export const CHANGE_FIELD_LABELS: Readonly<Record<string, string>> = {
  catalog_visible: de.admin.visible,
  display_name_override: own.displayName,
  admin_note: de.admin.note,
  catalog_group: de.admin.group,
  image_override_path: de.admin.image,
  card_type: de.admin.cardType,
  created: own.created,
  catalog_status: own.status,
  merged_from: own.mergedFrom,
  discarded: own.discarded,
  character_id: de.admin.familyAssign,
  base_sky_id: de.admin.baseAssign,
  market_price: own.marketPrice,
  deleted: own.deleted,
  types: de.admin.typeHeading,
  visible_type: de.admin.typeBanner,
  family_deleted: own.familyDeleted,
};

export function changeFieldLabel(field: string): string {
  return CHANGE_FIELD_LABELS[field] ?? field;
}
