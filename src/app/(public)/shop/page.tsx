import type { Metadata } from "next";

import { ShopView } from "@/components/shop/shop-view";
import { isAdmin } from "@/lib/auth/admin";
import { currentUser } from "@/lib/auth/user";
import { fetchCatalog } from "@/lib/catalog/queries";
import { fetchOwnedSkyIds } from "@/lib/collection/queries";
import { fetchOffers } from "@/lib/shop/queries";
import { shopEntries } from "@/lib/shop/surface";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = {
  title: de.shop.page.title,
  description: de.shop.page.intro,
};

/**
 * What SkyIsles is selling.
 *
 * The shop had no address. A buyable figure was a gold pill on one of 561
 * catalog cards, behind a series tab that opens on Spyro's Adventure — so the
 * question "what do you sell?" had no answer anywhere, while the checkout was
 * already taking real money.
 *
 * THIS IS A VIEW, NOT A SECOND SHOP
 *
 * The same two calls `/` makes — `fetchCatalog()` and `fetchOffers()`, both
 * memoised per request — joined by `shopEntries()`. No new table, no new RPC,
 * no migration, no second notion of what "available" means. If `shop_offers()`
 * stops listing something, this page stops showing it in the same breath.
 *
 * Hidden figures and non-collectibles are excluded by `shopEntries()`, so a
 * figure taken out of the public catalog (ADR-0039) cannot reappear here.
 *
 * The operator gets the ordinary customer view: they manage prices and stock
 * in `/admin/inventory`, and SkyIsles does not buy from itself (ADR-0042) — so
 * unlike `/`, this page does not switch into an editorial mode. It simply does
 * not offer them a collection state.
 */
export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<{ figure?: string }>;
}) {
  const params = await searchParams;
  const admin = await isAdmin();

  const [user, catalog, offers, owned] = await Promise.all([
    currentUser(),
    // Hidden figures are filtered by `shopEntries()`, but asking for them here
    // would put them in the browser's payload on the way. The public slice is
    // the honest request.
    fetchCatalog({ includeHidden: false }),
    fetchOffers(),
    admin ? Promise.resolve(new Set<string>()) : fetchOwnedSkyIds(),
  ]);

  const entries = shopEntries(catalog, offers);

  // Only outlines a card after coming back from sign-in. Nothing is written
  // from a URL parameter (ADR-0027).
  const highlight = params.figure && /^SKY-[0-9]{4}$/.test(params.figure) ? params.figure : null;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pt-8 pb-6 md:pt-12 md:pb-10">
      {/* No panel and no picture of its own: the world artwork is already
          behind the top of this page, painted by the layout (ADR-0038, V3.3).
          The heading carries its own shadow, as on the catalog. */}
      <div className="md:max-w-[56%]">
        <h1
          className="text-3xl leading-tight font-semibold tracking-tight md:text-4xl"
          style={{ textShadow: "0 2px 20px rgb(10 9 24 / 0.85), 0 1px 3px rgb(10 9 24 / 0.95)" }}
        >
          {de.shop.page.heading}
        </h1>
        <p
          className="mt-2 text-sm text-on-deep-muted md:text-base"
          style={{ textShadow: "0 1px 14px rgb(10 9 24 / 0.9)" }}
        >
          {de.shop.page.intro}
        </p>
      </div>

      <div className="mt-7">
        <ShopView
          entries={entries}
          ownedSkyIds={[...owned]}
          signedIn={Boolean(user)}
          highlightSkyId={highlight}
        />
      </div>
    </main>
  );
}
