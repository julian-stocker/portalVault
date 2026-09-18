import type { Metadata } from "next";

import { LegalDocumentView } from "@/components/legal/legal-document-view";
import { AGB } from "@/lib/legal/agb";

export const metadata: Metadata = { title: AGB.title, description: AGB.lead };

export default function Page() {
  return <LegalDocumentView document={AGB} />;
}
