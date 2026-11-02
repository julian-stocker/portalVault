/**
 * What the edit dialog needs that a catalogue card does not carry (V3.8).
 *
 * WHY THIS IS NOT IN `actions.ts`
 *
 * That module is writes, and only writes, on purpose: `lookups.test.ts` holds
 * it to reading none of the per-request-memoised catalogue queries, because a
 * write followed by a read inside one request would be answered from the memo
 * taken before the write. This is a read, so it lives beside them rather than
 * among them — and the guard stays as strict as it was.
 *
 * ONE CALL, WHEN THE DIALOG OPENS
 *
 * A catalogue screen renders up to 561 cards. None of them needs an internal
 * note or a change history until somebody decides to edit that one figure, so
 * neither is on `CatalogFigure` and neither is fetched per card. The note is
 * not there for a second reason as well: `skylanders` is world-readable and a
 * table grant knows no columns, so an internal note could not live on it
 * (ADR-0039) — it is in `catalog_editorial`.
 */
"use server";

import {
  fetchAdminNote, fetchBaseContext, fetchCatalogChanges, fetchFamilyContext,
  type CatalogChange, type FamilyRefRow,
} from "@/lib/admin/queries";
import { isEditorialCatalogSource } from "@/lib/admin/catalog-source";
import { isPlatformAdmin } from "@/lib/auth/capabilities";
import { de } from "@/lib/i18n/de";

const SKY_ID = /^SKY-[0-9]{4}$/;

export type FigureEditorData = {
  /** `""` when there is none — the dialog edits a string, not a maybe. */
  note: string;
  changes: CatalogChange[];
  /** The base figure's name, or `null` when the figure stands on its own. */
  baseName: string | null;
  /** How many variants point at THIS figure (`0159`: then it cannot become one). */
  variantCount: number;
  /** The figure's family today, or `null` (CAT-18). */
  family: FamilyRefRow | null;
  /** The base figure's family, or `null` — also when there is no base. */
  baseFamily: FamilyRefRow | null;
  /**
   * Whether this deployment is where the catalogue is edited (Staging,
   * ADR-0167). Decided on the server; the dialog only offers "Variante von"
   * as an edit when it is `true`. Not a security boundary — see
   * `catalog-source.ts`.
   */
  editorialSource: boolean;
};

export async function loadFigureEditor(
  skyId: string,
  baseSkyId: string | null = null,
  characterId: number | null = null,
): Promise<{ ok: true; data: FigureEditorData } | { ok: false; message: string }> {
  if (!SKY_ID.test(skyId)) return { ok: false, message: de.admin.unknownFigure };
  /*
   * Not the boundary — both queries call functions that ask `is_shop_admin()`
   * themselves. This returns a German sentence instead of a Postgres error,
   * and keeps a pointless round trip out.
   */
  if (!(await isPlatformAdmin())) return { ok: false, message: de.admin.notAllowed };

  if (baseSkyId !== null && !SKY_ID.test(baseSkyId)) {
    return { ok: false, message: de.admin.baseUnknown };
  }
  if (characterId !== null && (!Number.isSafeInteger(characterId) || characterId <= 0)) {
    return { ok: false, message: de.admin.familyUnknown };
  }
  const [note, changes, base, family] = await Promise.all([
    fetchAdminNote(skyId),
    fetchCatalogChanges(skyId),
    fetchBaseContext(skyId, baseSkyId),
    fetchFamilyContext(skyId, characterId, baseSkyId),
  ]);
  return {
    ok: true,
    data: {
      note: note ?? "",
      changes,
      baseName: base.baseName,
      variantCount: base.variantCount,
      family: family.family,
      baseFamily: family.baseFamily,
      editorialSource: isEditorialCatalogSource(),
    },
  };
}
