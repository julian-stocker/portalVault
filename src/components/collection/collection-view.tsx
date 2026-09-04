/**
 * The collection, with its figures and its numbers.
 *
 * A client component so that removing a figure updates the count, the
 * progress, the value and the note about priceless figures at once. The
 * numbers come from `collectionStats` — the same tested function the server
 * uses, so the optimistic view and the reloaded page cannot disagree.
 */
"use client";

import { useMemo, useState } from "react";

import { FigureCard } from "@/components/catalog/figure-card";
import { RemoveButton } from "@/components/collection/remove-button";
import type { CollectionEntry } from "@/lib/catalog/types";
import { remainingEntries, withRemoval } from "@/lib/collection/removal";
import { collectionStats } from "@/lib/collection/stats";
import { formatNumber, formatPercent, formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border p-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-lg font-medium tabular-nums">{value}</dd>
    </div>
  );
}

export function CollectionView({
  entries,
  catalogTotal,
}: {
  entries: readonly CollectionEntry[];
  catalogTotal: number;
}) {
  // Removed figures stay rendered so the undo has something to sit on.
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());

  function onRemovedChange(skyId: string, isRemoved: boolean) {
    setRemoved((current) => withRemoval(current, skyId, isRemoved));
  }

  const remaining = useMemo(() => remainingEntries(entries, removed), [entries, removed]);
  const stats = useMemo(
    () => collectionStats(remaining, catalogTotal),
    [remaining, catalogTotal],
  );

  return (
    <>
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

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {entries.map((entry) => {
          const isRemoved = removed.has(entry.figure.skyId);
          return (
            <div key={entry.figure.skyId} className={isRemoved ? "opacity-60" : undefined}>
              <FigureCard
                figure={entry.figure}
                action={
                  <>
                    {/* Says out loud what the dimming only hints at. */}
                    {isRemoved ? (
                      <p className="text-center text-xs text-muted">{de.collection.removed}</p>
                    ) : null}
                    <RemoveButton
                      skyId={entry.figure.skyId}
                      name={entry.figure.displayName}
                      removed={isRemoved}
                      onRemovedChange={onRemovedChange}
                    />
                  </>
                }
              />
            </div>
          );
        })}
      </div>
    </>
  );
}
