import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CollectionView } from "@/components/collection/collection-view";
import { currentProfile } from "@/lib/auth/actions";
import { ONBOARDING_PATH } from "@/lib/auth/redirect";
import { countCollectibleFigures, fetchCatalog, fetchSeries } from "@/lib/catalog/queries";
import { fetchCollection } from "@/lib/collection/queries";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.collection.title };

/**
 * Someone's own collection.
 *
 * Loads the whole catalog as well as what is owned, because "what am I
 * missing" is half of what a collection page is for and cannot be answered
 * from the owned rows alone. Same queries the catalog page already uses — no
 * new query, no new table, and the browser does the filtering as before
 * (ADR-0026).
 *
 * The numbers are computed in the view so a removal updates the count, the
 * progress, the value and the series bars in the same frame.
 */
export default async function CollectionPage() {
  const profile = await currentProfile();
  if (!profile?.username) redirect(ONBOARDING_PATH);

  const [catalog, owned, series, catalogTotal] = await Promise.all([
    fetchCatalog(),
    fetchCollection(),
    fetchSeries(),
    countCollectibleFigures(),
  ]);

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
      <CollectionView
        catalog={catalog}
        owned={owned}
        series={series}
        catalogTotal={catalogTotal}
      />
    </main>
  );
}
