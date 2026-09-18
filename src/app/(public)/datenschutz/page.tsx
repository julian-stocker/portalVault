import type { Metadata } from "next";

import { LegalDocumentView } from "@/components/legal/legal-document-view";
import { DATENSCHUTZ } from "@/lib/legal/datenschutz";

export const metadata: Metadata = { title: DATENSCHUTZ.title, description: DATENSCHUTZ.lead };

export default function Page() {
  return <LegalDocumentView document={DATENSCHUTZ} />;
}
