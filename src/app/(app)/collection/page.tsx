import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { CollectionHeading } from "@/components/collection/collection-heading";
import { CollectionView } from "@/components/collection/collection-view";
import { isCollector } from "@/lib/auth/capabilities";
import { currentProfile } from "@/lib/auth/profile";
import { ONBOARDING_PATH } from "@/lib/auth/redirect";
import {
  countCollectibleFigures,
  countCollectibleFiguresBySeries,
  fetchSeries,
} from "@/lib/catalog/queries";
import { fetchCatalogMarketBoost } from "@/lib/catalog/market-boost-server";
import { fetchCollection } from "@/lib/collection/queries";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.collection.title };

/**
 * Someone's own collection.
 *
 * The numbers are computed in the view so a removal updates the count, the
 * progress, the value and the series bars in the same frame.
 *
 * There is no `<Suspense>` here any more, and that is not a step back: since
 * V4.4 the fallback lives in `loading.tsx`, which Next wraps this page in
 * automatically. One boundary instead of two means the same skeleton is sent
 * once rather than twice, and — the actual point — a dynamic route with a
 * `loading` boundary is one the router can prefetch and enter immediately.
 *
 * Everything below is one round of parallel queries. What used to be a
 * fourth — the whole catalog, 561 figures with names, prices, images and
 * search indexes — is two counts, because counting is all this page ever did
 * with it (V4.3).
 */
export default async function CollectionPage() {
  /*
   * The collection is a collector's (ADR-0078). A Business or Admin
   * account has none, so the page does not exist for them — the same
   * 404 the two management areas answer to everybody else.
   */
  if (!(await isCollector())) notFound();

  const profile = await currentProfile();
  if (!profile?.username) redirect(ONBOARDING_PATH);

  const [owned, series, catalogTotal, bySeries, marketBoost] = await Promise.all([
    fetchCollection(),
    fetchSeries(),
    countCollectibleFigures(),
    countCollectibleFiguresBySeries(),
    /*
     * The temporary catalog market-value boost (0094, ADR-0105). ONE call for
     * the whole page: the cards, the table and every sum below are built from
     * the same percentage, so the collection cannot contradict the catalog it
     * is made of. No card and no row asks for it.
     */
    fetchCatalogMarketBoost(),
  ]);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pt-8 pb-6 md:pt-12 md:pb-10">
      <CollectionHeading />
      <CollectionView owned={owned} series={series} totals={{ total: catalogTotal, bySeries }}
                      marketBoostPercent={marketBoost} />
    </main>
  );
}
