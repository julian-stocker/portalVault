import type { Metadata } from "next";

import { LegalDocumentView } from "@/components/legal/legal-document-view";
import { LegalUnavailable } from "@/components/legal/legal-unavailable";
import { ShippingRates } from "@/components/legal/shipping-rates";
import { loadLegalTexts } from "@/lib/legal/load";
import { VERSAND_HEAD, buildVersand } from "@/lib/legal/service-pages";

export const metadata: Metadata = { title: VERSAND_HEAD.title, description: VERSAND_HEAD.lead };
export const dynamic = "force-dynamic";

/**
 * Versand (ADR-0086).
 *
 * The prose is static; the **figures are not**. Shipping prices and the
 * free-shipping threshold live in the database and the seller can change them,
 * so the page reads what is configured today rather than repeating a number
 * that would quietly go stale — and quoting a wrong shipping price on a
 * shipping page is not a typo, it is a wrong statement about the total.
 *
 * The return address comes from `seller_legal_public()` (ADR-0184, AP5);
 * without usable seller data the page names nobody.
 */
export default async function VersandPage() {
  const texts = await loadLegalTexts();
  if (texts.status !== "ok") return <LegalUnavailable title={VERSAND_HEAD.title} />;
  return (
    <>
      <LegalDocumentView document={buildVersand(texts.seller)} />
      <ShippingRates />
    </>
  );
}
