import type { Metadata } from "next";

import { SellerSettings } from "@/components/admin/seller-settings";
import { fetchSeller } from "@/lib/admin/seller";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.business.profileHeading };

/**
 * The shop's public face (ADR-0080).
 *
 * What a collector sees when an offer belongs to this seller: the trade name,
 * and one day an icon beside it. **Not** the legal data — that is
 * Geschäftsdaten & Kontakt, a different audience and a different duty
 * (ADR-0075).
 *
 * THE NAME IS THE SELLER'S, NOT THE ACCOUNT'S. It comes from
 * `sellers.display_name` through `seller_public()`, which is what the quick
 * view already renders. The login username is a personal handle and happens
 * to resemble the shop's name today; treating one as the other would break
 * the moment somebody else operates the shop.
 */
export default async function BusinessProfilePage() {
  const seller = await fetchSeller();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-8 pb-10 md:pt-12">
      <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
        {de.business.profileHeading}
      </h1>
      <p className="mt-2 text-sm text-muted">{de.business.profileHint}</p>
      <p className="mt-1 text-sm text-muted">{de.business.profileNameSource}</p>

      <SellerSettings
        displayName={seller.displayName}
        contactEmail={seller.contactEmail}
        replyTo={seller.replyTo}
      />

      {/*
       * Stated, not faked. There is no column for a seller image and no
       * storage policy for one, so the honest thing is to say so rather than
       * draw an empty frame that implies an upload exists (ADR-0080).
       */}
      <p className="mt-6 text-sm text-muted">{de.business.profileIconMissing}</p>
    </main>
  );
}
