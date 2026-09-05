/**
 * The collection.
 *
 * Holds every collectible, not only the owned ones — that is what lets it
 * answer "what am I missing", which is the question a collection page exists
 * for. Missing figures carry quantity zero.
 *
 * All of it is client state so that a removal updates the count, the
 * progress, the value, the series bars and the active filter in the same
 * frame. The numbers come from the same `collectionStats` the server uses, so
 * the optimistic view and a reloaded page cannot disagree.
 *
 * The series filter lives in the progress list rather than in a second tab
 * bar: the catalog's `SeriesTabs` was reused here first, and having the six
 * games on screen twice pushed the figures off a phone screen entirely.
 */
"use client";

import { useDeferredValue, useMemo, useState } from "react";

import { FigureCard } from "@/components/catalog/figure-card";
import { CollectionAction } from "@/components/collection/collection-action";
import { CollectionOverview } from "@/components/collection/collection-overview";
import { ACTION_NEUTRAL } from "@/components/ui/action";
import { ALL_SERIES, matchesQuery, matchesSeries, normalizeForSearch } from "@/lib/catalog/search";
import type { CatalogFigure, CollectionEntry, SeriesOption } from "@/lib/catalog/types";
import { collectionStats } from "@/lib/collection/stats";
import {
  COLLECTION_STATUSES,
  buildCollectionRows,
  matchesStatus,
  ownedEntries,
  seriesProgress,
  type CollectionStatus,
} from "@/lib/collection/view";
import { de } from "@/lib/i18n/de";

export function CollectionView({
  catalog,
  owned,
  series,
  catalogTotal,
}: {
  catalog: readonly CatalogFigure[];
  owned: readonly CollectionEntry[];
  series: readonly SeriesOption[];
  catalogTotal: number;
}) {
  const base = useMemo(() => buildCollectionRows(catalog, owned), [catalog, owned]);

  /** Optimistic quantities, keyed by SKY-ID. Absent means "as the server said". */
  const [changed, setChanged] = useState<ReadonlyMap<string, number>>(new Map());
  const [status, setStatus] = useState<CollectionStatus>("all");
  const [seriesCode, setSeriesCode] = useState<string>(ALL_SERIES);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);

  function onQuantityChange(skyId: string, quantity: number) {
    setChanged((current) => {
      const next = new Map(current);
      next.set(skyId, quantity);
      return next;
    });
  }

  const rows = useMemo(
    () =>
      base.map((row) => {
        const override = changed.get(row.figure.skyId);
        return override === undefined ? row : { ...row, quantity: override };
      }),
    [base, changed],
  );

  const stats = useMemo(() => collectionStats(ownedEntries(rows), catalogTotal), [rows, catalogTotal]);
  const progress = useMemo(() => seriesProgress(rows, series), [rows, series]);

  const normalized = normalizeForSearch(deferredQuery);
  const visible = useMemo(
    () =>
      rows.filter(
        (row) =>
          matchesStatus(row, status) &&
          matchesSeries(row.figure, seriesCode) &&
          matchesQuery(row.figure, normalized),
      ),
    [rows, status, seriesCode, normalized],
  );

  const filtered = status !== "all" || seriesCode !== ALL_SERIES || query.trim() !== "";
  const nothingCollected = stats.distinctFigures === 0;

  function reset() {
    setStatus("all");
    setSeriesCode(ALL_SERIES);
    setQuery("");
  }

  return (
    <div className="flex flex-col gap-6">
      <CollectionOverview
        stats={stats}
        series={progress}
        activeSeries={seriesCode}
        onSelectSeries={setSeriesCode}
      />

      <div className="flex flex-col gap-3">
        <div
          role="tablist"
          aria-label={de.collection.statusFilter}
          className="-mx-4 flex snap-x gap-1.5 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0"
        >
          {COLLECTION_STATUSES.map((option) => {
            const isActive = option === status;
            return (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setStatus(option)}
                className={
                  "flex min-h-11 shrink-0 snap-start items-center rounded-sky-md px-3.5 " +
                  "text-sm font-medium whitespace-nowrap " +
                  (isActive
                    ? "bg-foreground text-background"
                    : "border border-border text-muted hover:border-border-strong hover:text-foreground")
                }
              >
                {de.collection.status[option]}
              </button>
            );
          })}
        </div>

        <label className="sr-only" htmlFor="collection-search">
          {de.catalog.searchLabel}
        </label>
        <input
          id="collection-search"
          type="search"
          inputMode="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={de.catalog.searchPlaceholder}
          className="min-h-11 w-full rounded-sky-md border border-border bg-surface px-3 py-2.5 text-base focus:border-border-strong"
        />

        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-sm text-muted" aria-live="polite">
            {de.catalog.figureCount(visible.length)}
          </p>
          {filtered ? (
            <button
              type="button"
              onClick={reset}
              className="text-sm text-muted underline underline-offset-2 hover:text-foreground"
            >
              {de.collection.resetFilters}
            </button>
          ) : null}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-sky-lg border border-border px-4 py-10 text-center">
          {/* With no filter the grid is never empty — every collectible has a
              row — so this only appears once something is filtered. A brand
              new collection lands here through "Gesammelt" or "Duplikate",
              and gets the message about starting rather than about matching. */}
          <p className="font-medium">
            {nothingCollected ? de.collection.empty : de.collection.noMatch(status)}
          </p>
          <p className="text-sm text-muted">
            {nothingCollected ? de.collection.emptyHint : de.collection.noMatchHint}
          </p>
          {filtered ? (
            <button type="button" onClick={reset} className={`${ACTION_NEUTRAL} w-auto`}>
              {de.collection.resetFilters}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          {visible.map((row) => (
            <FigureCard
              key={row.figure.skyId}
              figure={row.figure}
              collected={row.quantity > 0}
              quantity={row.quantity}
              action={
                <>
                  {row.quantity === 0 && row.initialQuantity > 0 ? (
                    <p className="mb-1 text-center text-xs text-muted">{de.collection.removed}</p>
                  ) : null}
                  <CollectionAction
                    skyId={row.figure.skyId}
                    name={row.figure.displayName}
                    quantity={row.quantity}
                    initialQuantity={row.initialQuantity}
                    onQuantityChange={onQuantityChange}
                  />
                </>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
