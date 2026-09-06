import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CollectionHeading } from "@/components/collection/collection-heading";
import { CollectionView } from "@/components/collection/collection-view";
import { currentProfile } from "@/lib/auth/profile";
import { ONBOARDING_PATH } from "@/lib/auth/redirect";
import {
  countCollectibleFigures,
  countCollectibleFiguresBySeries,
  fetchSeries,
} from "@/lib/catalog/queries";
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
  const profile = await currentProfile();
  if (!profile?.username) redirect(ONBOARDING_PATH);

  const [owned, series, catalogTotal, bySeries] = await Promise.all([
    fetchCollection(),
    fetchSeries(),
    countCollectibleFigures(),
    countCollectibleFiguresBySeries(),
  ]);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pt-8 pb-6 md:pt-12 md:pb-10">
      <CollectionHeading />
      <CollectionView owned={owned} series={series} totals={{ total: catalogTotal, bySeries }} />
    </main>
  );
}
