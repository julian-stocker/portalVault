import type { Metadata } from "next";

import { ShopProfilePanel } from "@/components/admin/shop-profile-panel";
import { fetchShopProfile } from "@/lib/admin/shop-profile";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.business.legalHeading };

/**
 * Who the seller legally is, and where a customer writes (ADR-0080).
 *
 * These are the values Legal V1 will render into an Impressum, an invoice and
 * a withdrawal instruction. Nothing here is published yet, and every field may
 * stay empty — a placeholder in an Impressum field is a false statement about
 * a real person, not a half-finished setting (ADR-0075).
 *
 * The public trade name is NOT here; it belongs to Händlerprofil, which is the
 * shop's face rather than its paperwork.
 */
export default async function BusinessLegalPage() {
  const settings = await fetchShopProfile();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-8 pb-10 md:pt-12">
      <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
        {de.business.legalHeading}
      </h1>
      <ShopProfilePanel
        settings={settings}
        groups={["seller", "contact", "tax", "withdrawal"]}
        heading={de.business.legalHeading}
        hint={de.business.legalPageHint}
      />
    </main>
  );
}
