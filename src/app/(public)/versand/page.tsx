import type { Metadata } from "next";

import { LegalDocumentView } from "@/components/legal/legal-document-view";
import { ShippingRates } from "@/components/legal/shipping-rates";
import { VERSAND } from "@/lib/legal/service-pages";

export const metadata: Metadata = { title: VERSAND.title, description: VERSAND.lead };
export const dynamic = "force-dynamic";

/**
 * Versand (ADR-0086).
 *
 * The prose is static; the **figures are not**. Shipping prices and the
 * free-shipping threshold live in the database and the seller can change them,
 * so the page reads what is configured today rather than repeating a number
 * that would quietly go stale — and quoting a wrong shipping price on a
 * shipping page is not a typo, it is a wrong statement about the total.
 */
export default function VersandPage() {
  return (
    <>
      <LegalDocumentView document={VERSAND} />
      <ShippingRates />
    </>
  );
}
