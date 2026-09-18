/**
 * The legal texts, as code (ADR-0086).
 *
 * WHY CODE AND NOT A CMS
 *
 * A legal text needs three things a content editor does not give it: a diff, a
 * review, and a version that cannot be edited in place. Here a change to the
 * AGB is a commit — visible in `git log`, reviewable line by line, and unable
 * to land without bumping `LEGAL_VERSIONS`, because a test compares the
 * version in this file against the one migration 0047 seeded into
 * `legal_document_versions`.
 *
 * That database row is what a trigger copies onto every new order, so an order
 * placed today keeps pointing at today's text after tomorrow's edit. The text
 * lives here; which text applied lives in the database; neither can drift
 * without the build failing.
 *
 * WHAT THESE TEXTS ARE NOT
 *
 * They are not boilerplate adapted to fit. Every sentence about how the shop
 * works was written from the Phase-1 audit of what the code actually does —
 * the order is created before payment, the acceptance is the confirmation
 * mail, shipping is Germany only, no VAT is shown because § 19 UStG applies.
 * Where the implementation and a generic template disagreed, the
 * implementation won; where the implementation was wrong, it was changed
 * (the missing § 312i Abs. 1 Nr. 3 acknowledgement, for one).
 *
 * They have not been reviewed by a lawyer. `docs/LEGAL.md` records which norm
 * was checked, in which version, on which day, and what is still open.
 */

/**
 * The current version of each text.
 *
 * A date, because that is what a version of a legal document usefully is.
 * Bump it in the same commit that changes the text, and change the matching
 * row in a new migration — `src/lib/legal/versions.test.ts` fails otherwise.
 */
export const LEGAL_VERSIONS = {
  agb: "2026-09-17",
  widerruf: "2026-09-17",
  datenschutz: "2026-09-17",
  impressum: "2026-09-17",
} as const;

export type LegalSlug = keyof typeof LEGAL_VERSIONS;

/** One block of a document. `list` renders as a list, `paragraphs` as prose. */
export type LegalBlock =
  | { kind: "text"; paragraphs: readonly string[] }
  | { kind: "list"; items: readonly string[] }
  /** An ordered list — used where the source numbers its own items. */
  | { kind: "steps"; items: readonly string[] }
  /** Label/value pairs: addresses, contact details, figures. */
  | { kind: "pairs"; pairs: readonly (readonly [string, string])[] }
  /**
   * A verbatim statutory passage. Rendered set apart, so a reader can see
   * where the law's words end and ours begin — and so nobody edits one
   * thinking it is the other.
   */
  | { kind: "quote"; paragraphs: readonly string[]; source: string };

export type LegalSection = {
  /** Rendered as `<h2>`. Sections are the document's real structure. */
  heading: string;
  blocks: readonly LegalBlock[];
};

export type LegalDocument = {
  slug: string;
  /** The page title and the `<h1>`. */
  title: string;
  /** One sentence under the title. Never a slogan. */
  lead: string;
  /** Present only where the document is versioned and snapshotted per order. */
  version?: string;
  sections: readonly LegalSection[];
};
