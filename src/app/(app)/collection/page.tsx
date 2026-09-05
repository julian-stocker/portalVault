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
    <main className="mx-auto w-full max-w-6xl px-4 py-6 md:py-8">
      <h1 className="mb-4 text-lg font-semibold tracking-tight md:mb-5">{de.collection.title}</h1>
      <CollectionView
        catalog={catalog}
        owned={owned}
        series={series}
        catalogTotal={catalogTotal}
      />
    </main>
  );
}
