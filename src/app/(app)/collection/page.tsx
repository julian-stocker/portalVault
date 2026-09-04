import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CollectionView } from "@/components/collection/collection-view";
import { currentProfile } from "@/lib/auth/actions";
import { ONBOARDING_PATH } from "@/lib/auth/redirect";
import { countCollectibleFigures } from "@/lib/catalog/queries";
import { fetchCollection } from "@/lib/collection/queries";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.collection.title };

/**
 * Someone's own collection.
 *
 * The figures and the catalog total are read here; the numbers themselves are
 * computed in the view, so removing a figure updates the count, the progress
 * and the value at once rather than waiting for a round trip.
 */
export default async function CollectionPage() {
  const profile = await currentProfile();
  if (!profile?.username) redirect(ONBOARDING_PATH);

  const [entries, catalogTotal] = await Promise.all([
    fetchCollection(),
    countCollectibleFigures(),
  ]);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 md:py-8">
      <h1 className="text-2xl font-semibold tracking-tight">{de.collection.title}</h1>

      {entries.length === 0 ? (
        <div className="mt-6 rounded-lg border border-border px-4 py-10 text-center">
          <p className="font-medium">{de.collection.empty}</p>
          <p className="mt-1 text-sm text-muted">{de.collection.emptyHint}</p>
          <Link href="/" className="mt-4 inline-block text-sm underline">
            {de.collection.emptyAction}
          </Link>
        </div>
      ) : (
        <CollectionView entries={entries} catalogTotal={catalogTotal} />
      )}
    </main>
  );
}
