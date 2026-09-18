import type { Metadata } from "next";
import Link from "next/link";

import { CommercePanel } from "@/components/admin/commerce-panel";
import { ShopSettings } from "@/components/admin/shop-settings";
import { fetchCommerceState } from "@/lib/admin/commerce";
import { fetchShopSettings } from "@/lib/admin/inventory";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.business.offersHeading };

/**
 * The shop-wide commercial controls (ADR-0080).
 *
 * Whether the shop is open at all, and how prices are formed automatically.
 * Both apply to every offer, which is why they are here and not in the stock
 * list — and why the stock list keeps what is genuinely per figure: which one
 * is listed, and for how much.
 *
 * Two pages rather than one, and neither repeats the other. A second card
 * pointing at the same route would be the duplicate navigation the shop
 * redesign set out to remove.
 */
export default async function BusinessOffersPage() {
  const [settings, commerce] = await Promise.all([fetchShopSettings(), fetchCommerceState()]);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-8 pb-10 md:pt-12">
      <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
        {de.business.offersHeading}
      </h1>
      <p className="mt-2 text-sm text-muted">{de.business.offersHint}</p>

      <CommercePanel state={commerce} />
      <ShopSettings percentage={settings.pricePercentage} />

      <Link
        href="/business/inventory"
        className="mt-6 inline-block text-sm underline underline-offset-4"
      >
        {de.business.offersToInventory}
      </Link>
    </main>
  );
}
