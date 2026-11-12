/**
 * A legal page at the version the database names as current (ADR-0184, AP5).
 *
 * `/impressum`, `/agb`, `/widerruf` and `/datenschutz` render whichever
 * version `legal_versions_public()` names — the archived 2026-09-17 text until
 * 0192 switches, the built 2026-11-11 text after it. Nothing here picks a
 * version itself; without an answer from the database the page says so.
 */
import type { Metadata } from "next";

import { ArchiveLinks } from "@/components/legal/archive-links";
import { LegalDocumentView } from "@/components/legal/legal-document-view";
import { LegalUnavailable } from "@/components/legal/legal-unavailable";
import { WithdrawalForm } from "@/components/legal/withdrawal-form";
import { activeLegalText } from "@/lib/legal/active";
import type { LegalSlug } from "@/lib/legal/documents";

/** Title and lead of the version in force — "Fassung vom …" is that version's. */
export async function activeLegalMetadata(slug: LegalSlug, fallbackTitle: string): Promise<Metadata> {
  const text = await activeLegalText(slug);
  if (text.status !== "ok") return { title: fallbackTitle };
  return { title: text.document.title, description: text.document.lead };
}

export async function ActiveLegalPage({ slug, title }: { slug: LegalSlug; title: string }) {
  const text = await activeLegalText(slug);
  if (text.status !== "ok") return <LegalUnavailable title={title} cause={text.cause} />;
  return (
    <>
      <LegalDocumentView document={text.document} />
      {text.form ? <WithdrawalForm form={text.form} /> : null}
      <ArchiveLinks slug={slug} active={text.version} />
    </>
  );
}
