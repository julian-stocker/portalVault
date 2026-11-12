/**
 * The shape of one archived set of legal texts (ADR-0184, AP5).
 *
 * An archived set is DATA, frozen when it stopped being current: the
 * documents as they were rendered, seller details included. Nothing in it is
 * computed from today's seller row — that is the point of an archive.
 */
import type { LegalDocument } from "@/lib/legal/documents";

/** The model withdrawal form, as rendered beside the Widerrufsbelehrung. */
export type WithdrawalFormText = {
  intro: string;
  recipient: readonly string[];
  lines: readonly string[];
  footnote: string;
};

export type ArchivedLegalSet = {
  impressum: LegalDocument;
  agb: LegalDocument;
  widerruf: LegalDocument;
  datenschutz: LegalDocument;
  widerrufsformular: WithdrawalFormText;
};
