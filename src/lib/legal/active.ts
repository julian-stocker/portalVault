/**
 * The text of one legal document at one version — and the one in force
 * (ADR-0184, AP5).
 *
 * TWO KINDS OF VERSION, ONE ANSWER SHAPE.
 *
 *   built     `LEGAL_VERSIONS[slug]` — the text this code writes, filled in
 *             from the seller row (`loadLegalTexts()`).
 *   archived  a frozen set from `archive/` — nothing from today's seller row;
 *             the details in it are those of that time.
 *
 * `legalTextAt()` renders exactly the version asked for, or says it has none.
 * `activeLegalText()` asks the database which version is in force
 * (`fetchLegalVersions()`) and renders that one — it never substitutes
 * another version for a missing or unknown one.
 */
import { buildAgb } from "@/lib/legal/agb";
import { LEGAL_ARCHIVE, archivedDocument } from "@/lib/legal/archive";
import type { WithdrawalFormText } from "@/lib/legal/archive/types";
import { buildDatenschutz } from "@/lib/legal/datenschutz";
import { LEGAL_VERSIONS, type LegalDocument, type LegalSlug } from "@/lib/legal/documents";
import { buildImpressum } from "@/lib/legal/impressum";
import { loadLegalTexts } from "@/lib/legal/load";
import type { LegalSeller } from "@/lib/legal/seller-text";
import { fetchLegalVersions } from "@/lib/legal/versions";
import { buildWiderruf, buildWiderrufsformular } from "@/lib/legal/widerruf";

const BUILD: Record<LegalSlug, (seller: LegalSeller) => LegalDocument> = {
  impressum: buildImpressum,
  agb: buildAgb,
  widerruf: buildWiderruf,
  datenschutz: buildDatenschutz,
};

export type LegalText =
  | {
      status: "ok";
      version: string;
      /** Built from today's seller row (true) or frozen in the archive (false). */
      built: boolean;
      document: LegalDocument;
      /** The model withdrawal form of the same version — only for `widerruf`. */
      form: WithdrawalFormText | null;
    }
  | {
      status: "unavailable";
      /** `versions`: which version is current is unknown. `seller`: the built text lacks its data. */
      cause: "versions" | "seller";
    };

export const isLegalSlug = (slug: string): slug is LegalSlug =>
  Object.prototype.hasOwnProperty.call(LEGAL_VERSIONS, slug);

/** Exactly `version` of `slug`, or null if this code has no such version. */
export async function legalTextAt(slug: LegalSlug, version: string): Promise<LegalText | null> {
  if (version === LEGAL_VERSIONS[slug]) {
    const texts = await loadLegalTexts();
    if (texts.status !== "ok") return { status: "unavailable", cause: "seller" };
    return {
      status: "ok",
      version,
      built: true,
      document: BUILD[slug](texts.seller),
      form: slug === "widerruf" ? buildWiderrufsformular(texts.seller) : null,
    };
  }
  // The archived branch reads nothing live: no seller row, no database.
  const document = archivedDocument(slug, version);
  if (!document) return null;
  return {
    status: "ok",
    version,
    built: false,
    document,
    form: slug === "widerruf" ? LEGAL_ARCHIVE[version].widerrufsformular : null,
  };
}

/** The version in force, as the database names it — or unavailable. */
export async function activeLegalText(slug: LegalSlug): Promise<LegalText> {
  const active = await fetchLegalVersions();
  if (active.status !== "ok") return { status: "unavailable", cause: "versions" };
  // `fetchLegalVersions()` admits only versions this code can render.
  return (await legalTextAt(slug, active.versions[slug])) ?? { status: "unavailable", cause: "versions" };
}
