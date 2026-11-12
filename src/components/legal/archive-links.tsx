/**
 * "Frühere Fassungen" under a current legal text (ADR-0184, AP5).
 *
 * An order keeps the version it was placed under, and the confirmation mail
 * names it; this list is how a customer gets from today's page to that text.
 * Renders nothing for a document with no archived version other than the one
 * in force: while the database still names an archived version as current
 * (before 0192), that version is the page itself, not an earlier one.
 */
import Link from "next/link";

import { archivePath, archivedVersions, type ArchivedSlug } from "@/lib/legal/archive";
import { de } from "@/lib/i18n/de";

export function ArchiveLinks({ slug, active }: { slug: ArchivedSlug; active: string }) {
  const versions = archivedVersions(slug).filter((version) => version !== active);
  if (versions.length === 0) return null;
  const copy = de.legal.archive;
  return (
    <section aria-labelledby={`archive-${slug}`} className="mx-auto w-full max-w-2xl px-4 pb-16">
      <h2 id={`archive-${slug}`} className="text-lg font-semibold tracking-tight">{copy.heading}</h2>
      <p className="mt-2 text-sm text-muted">{copy.hint}</p>
      <ul className="mt-3 flex flex-col gap-1">
        {versions.map((version) => (
          <li key={version}>
            <Link href={archivePath(slug, version)} className="text-sm underline underline-offset-4">
              {copy.item(version)}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
