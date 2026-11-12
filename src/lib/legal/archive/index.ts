/**
 * Earlier versions of the legal texts, reachable under stable URLs
 * (`/rechtstexte/<slug>/<version>`, ADR-0184, AP5).
 *
 * An order keeps the version id of the AGB and the Widerrufsbelehrung it was
 * placed under (`order_legal_snapshots`, migration 0047), and the confirmation
 * mail names it. Without this archive, a customer following that mail to
 * `/agb` would read a text they never agreed to.
 *
 * ADD, NEVER CHANGE. When a version stops being current, its rendered text is
 * frozen into a new file here and listed below. An entry is never edited or
 * removed (`archive.test.ts`).
 *
 * WHAT AN ENTRY PROVES. A documented REPOSITORY STATE — the text the code of a
 * named commit renders — not necessarily the only text ever served under that
 * version id. For `2026-09-17`:
 *
 *   9977fdd (archived)  the state since `dc86497` (2026-09-18 13:46 +0200)
 *   713527c             the first state, `main` from 13:17 to 13:46 the same
 *                       day. Identical except the contact e-mail: all nine
 *                       occurrences (two in each document, one in the model
 *                       form) read `info@skyisles.app`.
 *
 * Whether `713527c` was ever deployed is not in the repository; the Vercel
 * deployment history is the source that could show it. It is NOT archived
 * here: an entry needs a basis, and a guess is not one (ADR-0184, AP5).
 */
import { ARCHIVE_2026_09_17 } from "@/lib/legal/archive/2026-09-17";
import type { ArchivedLegalSet } from "@/lib/legal/archive/types";
import type { LegalDocument } from "@/lib/legal/documents";

/** Version id → frozen set. Ordered oldest first. */
export const LEGAL_ARCHIVE: Readonly<Record<string, ArchivedLegalSet>> = {
  "2026-09-17": ARCHIVE_2026_09_17,
};

export const ARCHIVED_SLUGS = ["impressum", "agb", "widerruf", "datenschutz"] as const;
export type ArchivedSlug = (typeof ARCHIVED_SLUGS)[number];

/** The stable URL of one version of a document (defined data-free in `documents.ts`). */
export { legalTextPath as archivePath } from "@/lib/legal/documents";

/** One archived document, or null for an unknown slug or version. */
export function archivedDocument(slug: string, version: string): LegalDocument | null {
  if (!(ARCHIVED_SLUGS as readonly string[]).includes(slug)) return null;
  if (!Object.prototype.hasOwnProperty.call(LEGAL_ARCHIVE, version)) return null;
  return LEGAL_ARCHIVE[version][slug as ArchivedSlug];
}

/** Every archived version of one document, oldest first. */
export const archivedVersions = (slug: ArchivedSlug): string[] =>
  Object.keys(LEGAL_ARCHIVE).filter((version) => LEGAL_ARCHIVE[version][slug] !== undefined);
