import type { Metadata } from "next";

import { LegalDocumentView } from "@/components/legal/legal-document-view";
import { ZAHLUNG } from "@/lib/legal/service-pages";

export const metadata: Metadata = { title: ZAHLUNG.title, description: ZAHLUNG.lead };

export default function Page() {
  return <LegalDocumentView document={ZAHLUNG} />;
}
