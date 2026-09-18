import type { Metadata } from "next";

import { LegalDocumentView } from "@/components/legal/legal-document-view";
import { KONTAKT } from "@/lib/legal/service-pages";

export const metadata: Metadata = { title: KONTAKT.title, description: KONTAKT.lead };

export default function Page() {
  return <LegalDocumentView document={KONTAKT} />;
}
