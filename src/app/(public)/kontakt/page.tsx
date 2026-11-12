import type { Metadata } from "next";

import { LegalDocumentView } from "@/components/legal/legal-document-view";
import { LegalUnavailable } from "@/components/legal/legal-unavailable";
import { loadLegalTexts } from "@/lib/legal/load";
import { KONTAKT_HEAD, buildKontakt } from "@/lib/legal/service-pages";

export const metadata: Metadata = { title: KONTAKT_HEAD.title, description: KONTAKT_HEAD.lead };

/** Built per request from `seller_legal_public()` (ADR-0184, AP5). */
export default async function Page() {
  const texts = await loadLegalTexts();
  if (texts.status !== "ok") return <LegalUnavailable title={KONTAKT_HEAD.title} />;
  return <LegalDocumentView document={buildKontakt(texts.seller)} />;
}
