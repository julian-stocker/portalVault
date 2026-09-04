import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { FigureGrid } from "@/components/catalog/figure-grid";
import { currentProfile } from "@/lib/auth/actions";
import { ONBOARDING_PATH } from "@/lib/auth/redirect";
import { countCollectibleFigures } from "@/lib/catalog/queries";
import { fetchCollection } from "@/lib/collection/queries";
import { collectionStats } from "@/lib/collection/stats";
import { formatNumber, formatPercent, formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.collection.title };

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border p-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-lg font-medium tabular-nums">{value}</dd>
    </div>
  );
}

export default async function CollectionPage() {
  const profile = await currentProfile();
  if (!profile?.username) redirect(ONBOARDING_PATH);

  const [entries, catalogTotal] = await Promise.all([
    fetchCollection(),
    countCollectibleFigures(),
  ]);
  const stats = collectionStats(entries, catalogTotal);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 md:py-8">
      <h1 className="text-2xl font-semibold tracking-tight">{de.collection.title}</h1>

      <dl className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={de.collection.distinctFigures} value={formatNumber(stats.distinctFigures)} />
        <Stat label={de.collection.catalogTotal} value={formatNumber(stats.catalogTotal)} />
        <Stat label={de.collection.progress} value={formatPercent(stats.progress)} />
        {/* Based on market_price, never on any later shop price (ADR-0010). */}
        <Stat label={de.collection.estimatedValue} value={formatPrice(stats.estimatedValue)} />
      </dl>

      {stats.withoutPrice > 0 ? (
        <p className="mt-2 text-sm text-muted">{de.collection.withoutPrice(stats.withoutPrice)}</p>
      ) : null}
      {stats.nonCollectibleOwned > 0 ? (
        <p className="mt-1 text-sm text-muted">
          {de.collection.nonCollectibleOwned(stats.nonCollectibleOwned)}
        </p>
      ) : null}
      {stats.inactiveOwned > 0 ? (
        <p className="mt-1 text-sm text-muted">{de.collection.inactiveOwned(stats.inactiveOwned)}</p>
      ) : null}

      <div className="mt-6">
        {entries.length === 0 ? (
          <div className="rounded-lg border border-border px-4 py-10 text-center">
            <p className="font-medium">{de.collection.empty}</p>
            <p className="mt-1 text-sm text-muted">{de.collection.emptyHint}</p>
            <Link href="/" className="mt-4 inline-block text-sm underline">
              {de.collection.emptyAction}
            </Link>
          </div>
        ) : (
          <FigureGrid figures={entries.map((entry) => entry.figure)} />
        )}
      </div>
    </main>
  );
}
