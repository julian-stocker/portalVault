import type { Metadata } from "next";

import { ShopProfilePanel } from "@/components/admin/shop-profile-panel";
import { fetchShopProfile } from "@/lib/admin/shop-profile";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.business.shippingHeading };

/**
 * Where this shop delivers, with what, and from what value it is free
 * (ADR-0080).
 *
 * The seller's decisions, not the platform's (ADR-0076) — and the server
 * decides: the checkout form mirrors the country list but `create_order()`
 * refuses an order for a country that is not enabled here.
 */
export default async function BusinessShippingPage() {
  const settings = await fetchShopProfile();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-8 pb-10 md:pt-12">
      <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
        {de.business.shippingHeading}
      </h1>
      <ShopProfilePanel
        settings={settings}
        groups={["shipping"]}
        heading={de.business.shippingHeading}
        hint={de.business.shippingPageHint}
      />
    </main>
  );
}
