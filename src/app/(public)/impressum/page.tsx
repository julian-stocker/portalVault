import type { Metadata } from "next";

import { LegalDocumentView } from "@/components/legal/legal-document-view";
import { IMPRESSUM } from "@/lib/legal/impressum";

export const metadata: Metadata = { title: IMPRESSUM.title, description: IMPRESSUM.lead };

export default function Page() {
  return <LegalDocumentView document={IMPRESSUM} />;
}
