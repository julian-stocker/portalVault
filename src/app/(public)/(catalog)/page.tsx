import type { Metadata } from "next";

import { CatalogView } from "@/components/catalog/catalog-view";
import { fetchCatalog, fetchSeries } from "@/lib/catalog/queries";
import { fetchOwnedSkyIds } from "@/lib/collection/queries";
import { de } from "@/lib/i18n/de";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: de.catalog.title,
  description: de.app.description,
};

/**
 * The catalog is the front page (ADR-0025).
 *
 * Two queries: the whole catalog, and — only when signed in — which figures
 * the visitor owns. Search and filtering then happen in the browser.
 */
export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ series?: string; q?: string; figure?: string }>;
}) {
  const params = await searchParams;

  const supabase = await createClient();
  const [{ data: auth }, figures, series, owned] = await Promise.all([
    supabase.auth.getUser(),
    fetchCatalog(),
    fetchSeries(),
    fetchOwnedSkyIds(),
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
        signedIn={Boolean(auth.user)}
        highlightSkyId={highlight}
        initialSeriesCode={
          params.series && series.some((s) => s.code === params.series) ? params.series : undefined
        }
        initialQuery={params.q ?? ""}
      />
    </main>
  );
}
