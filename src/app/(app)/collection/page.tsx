import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { CollectionSkeleton } from "@/components/collection/collection-skeleton";
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
 * The data half of the page.
 *
 * Split out so the heading above it can be sent before any of this has been
 * asked for (V4.3). Everything here is one round of parallel queries; what
 * used to be a fourth — the whole catalog, 561 figures with names, prices,
 * images and search indexes — is now two counts, because counting is all the
 * page ever did with it.
 */
async function CollectionData() {
  const [owned, series, catalogTotal, bySeries] = await Promise.all([
    fetchCollection(),
    fetchSeries(),
    countCollectibleFigures(),
    countCollectibleFiguresBySeries(),
  ]);

  return (
    <CollectionView
      owned={owned}
      series={series}
      totals={{ total: catalogTotal, bySeries }}
    />
  );
}

/**
 * Someone's own collection.
 *
 * The numbers are computed in the view so a removal updates the count, the
 * progress, the value and the series bars in the same frame.
 *
 * The heading is outside the Suspense boundary on purpose: it needs no data,
 * so it can be on screen while the collection is still being fetched. A
 * collection of 448 figures took about half a second to assemble, and for
 * that half second the visitor used to see the previous page.
 */
export default async function CollectionPage() {
  const profile = await currentProfile();
  if (!profile?.username) redirect(ONBOARDING_PATH);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pt-8 pb-6 md:pt-12 md:pb-10">
      {/* A strip of the world, not a wallpaper (ADR-0038, V3.2): enough sky
          that the collection belongs to the same place as the catalog,
          nowhere near the figures the panel below has to state. */}
      <div className="mb-6 md:mb-8">
        <h1
          className="text-3xl leading-tight font-semibold tracking-tight md:text-5xl"
          style={{ textShadow: "0 2px 20px rgb(10 9 24 / 0.85), 0 1px 3px rgb(10 9 24 / 0.95)" }}
        >
          {de.collection.title}
        </h1>
        <p
          className="mt-2 text-sm text-on-deep-muted md:text-base"
          style={{ textShadow: "0 1px 14px rgb(10 9 24 / 0.9)" }}
        >
          {de.collection.subline}
        </p>
      </div>

      <Suspense fallback={<CollectionSkeleton />}>
        <CollectionData />
      </Suspense>
    </main>
  );
}
