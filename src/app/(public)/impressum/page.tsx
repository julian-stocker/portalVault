import type { Metadata } from "next";

import { ActiveLegalPage, activeLegalMetadata } from "@/components/legal/active-legal-page";
import { IMPRESSUM_HEAD } from "@/lib/legal/impressum";

export function generateMetadata(): Promise<Metadata> {
  return activeLegalMetadata("impressum", IMPRESSUM_HEAD.title);
}

/**
 * The version `legal_versions_public()` names as current (ADR-0184, AP5):
 * archived and frozen, or built per request from `seller_legal_public()`.
 * Without either answer the page says so and names nobody.
 */
export default function Page() {
  return <ActiveLegalPage slug="impressum" title={IMPRESSUM_HEAD.title} />;
}
