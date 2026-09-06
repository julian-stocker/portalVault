import type { Metadata } from "next";

import { CatalogView } from "@/components/catalog/catalog-view";
import { isCatalogGroup } from "@/lib/catalog/group";
import { fetchCatalog, fetchSeries } from "@/lib/catalog/queries";
import { fetchOwnedSkyIds } from "@/lib/collection/queries";
import { offerRecord } from "@/lib/shop/offer";
import { fetchOffers } from "@/lib/shop/queries";
import { de } from "@/lib/i18n/de";
import { isAdmin } from "@/lib/auth/admin";
import { currentUser } from "@/lib/auth/user";

export const metadata: Metadata = {
  title: de.catalog.title,
  description: de.app.description,
};

/**
 * The catalog is the front page (ADR-0025).
 *
 * Three queries: the whole catalog, the public shop, and — only when signed
 * in — which figures the visitor owns. Search and filtering then happen in
 * the browser.
 *
 * The shop is one call for all 561 cards (ADR-0043). It carries a price and
 * an availability flag and nothing else: stock levels never leave the
 * database (migration 0006).
 */
export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ series?: string; q?: string; figure?: string; group?: string }>;
}) {
  const params = await searchParams;

  // The role decides which slice of the same catalog is loaded, and which
  // actions the cards carry (ADR-0042). Asked on the server, from the
  // database — never from a claim the browser sent.
  const admin = await isAdmin();

  const [user, figures, series, owned, offers] = await Promise.all([
    currentUser(),
    fetchCatalog({ includeHidden: admin }),
    fetchSeries(),
    // An administrator manages the shop's catalog, not a personal collection
    // (ADR-0042). Their own collection is simply not part of this page.
    admin ? Promise.resolve(new Set<string>()) : fetchOwnedSkyIds(),
    // Not for an administrator: their card carries editorial actions, and
    // the price they can actually change is in /admin/inventory (ADR-0042).
    admin ? Promise.resolve(new Map()) : fetchOffers(),
  ]);

  // Only used to outline a card after coming back from sign-in. It changes
  // nothing — no state is written from a URL parameter (ADR-0027).
  const highlight = params.figure && /^SKY-[0-9]{4}$/.test(params.figure) ? params.figure : null;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pt-8 pb-6 md:pt-12 md:pb-10">
      {/* The heading lives inside CatalogView's intro panel since V3, so the
          title, the subline and the tools read as one block (ADR-0038). */}
      <CatalogView
        figures={figures}
        series={series}
        ownedSkyIds={[...owned]}
        signedIn={Boolean(user)}
        admin={admin}
        highlightSkyId={highlight}
        initialSeriesCode={
          params.series && series.some((s) => s.code === params.series) ? params.series : undefined
        }
        initialQuery={params.q ?? ""}
        // Same role as `series` and `q`: restoring the view someone left when
        // they went to sign in (ADR-0027). The catalog's state stays in the
        // client — these parameters are read once, never written back.
        initialGroup={isCatalogGroup(params.group) ? params.group : null}
        // A plain object: a Map does not survive the server → client
        // boundary and would arrive empty.
        offers={offerRecord(offers)}
      />
    </main>
  );
}
