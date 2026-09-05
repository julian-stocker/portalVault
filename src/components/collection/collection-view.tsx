/**
 * The showcase.
 *
 * Holds only what is actually owned (ADR-0038). The previous version listed
 * every collectible with the missing ones at quantity zero, which made the
 * collection a second catalog with statistics on top — the same 561 cards,
 * the same grid, a different heading. Missing figures are a catalog question
 * now; this page answers "what do I have".
 *
 * All of it is client state so that a removal updates the count, the
 * progress, the value and the series bars in the same frame. The numbers come
 * from the same `collectionStats` the server uses, so the optimistic view and
 * a reloaded page cannot disagree — and the completion denominator stays the
 * full active catalog even though only owned rows are drawn.
 */
"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";

import { FigureCard } from "@/components/catalog/figure-card";
import { CollectionAction } from "@/components/collection/collection-action";
import { CollectionOverview } from "@/components/collection/collection-overview";
import { ACTION_NEUTRAL } from "@/components/ui/action";
import { FilterBar, type FilterOption } from "@/components/ui/filter-bar";
import { isCollectible } from "@/lib/catalog/collectible";
import { matchesQuery, normalizeForSearch } from "@/lib/catalog/search";
import type { CatalogFigure, CollectionEntry, SeriesOption } from "@/lib/catalog/types";
import { collectionStats } from "@/lib/collection/stats";
import { FigureGrid } from "@/components/catalog/figure-grid";
import {
  COLLECTION_ALL,
  COLLECTION_DUPLICATES,
  buildCollectionRows,
  matchesCollectionFilter,
  ownedEntries,
  segmentSummary,
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
  const [filter, setFilter] = useState<string>(COLLECTION_ALL);
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

  /**
   * What the statistics count.
   *
   * The rows, plus the owned entries that never became rows. `buildCollectionRows`
   * drops software (ADR-0029), so feeding it straight into `collectionStats`
   * hid the very entries the "these are games" note exists to explain — the
   * note could never fire. Adding them back here keeps the showcase free of
   * game cards while the summary still accounts for every owned row.
   */
  const counted = useMemo(
    () => [...ownedEntries(rows), ...owned.filter((entry) => !isCollectible(entry.figure))],
    [rows, owned],
  );

  // Statistics and series progress still see every catalog row: 448 of 561 is
  // only meaningful if both halves count the same set.
  const stats = useMemo(() => collectionStats(counted, catalogTotal), [counted, catalogTotal]);

  // Follows the tabs, never the search box: a summary that moved while you
  // typed would stop being a fact about the segment.
  const summary = useMemo(
    () => segmentSummary(rows, filter, catalogTotal),
    [rows, filter, catalogTotal],
  );

  const normalized = normalizeForSearch(deferredQuery);

  /**
   * What the grid draws: owned rows, plus anything removed in this session.
   *
   * The showcase holds only what is owned, but a figure removed a second ago
   * has to stay put — otherwise the card carrying "Rückgängig" vanishes at
   * the moment it becomes useful, and an accidental removal can only be
   * undone by finding the figure again in the catalog.
   */
  const visible = useMemo(() => {
    const justRemoved = new Set(
      [...changed.entries()].filter(([, quantity]) => quantity === 0).map(([skyId]) => skyId),
    );
    return rows.filter(
      (row) =>
        (row.quantity > 0 || justRemoved.has(row.figure.skyId)) &&
        matchesCollectionFilter(row, filter) &&
        matchesQuery(row.figure, normalized),
    );
  }, [rows, changed, filter, normalized]);

  // "Alle", the six games, then duplicates. One bar, because they answer the
  // same question: which slice of my collection am I looking at.
  const filterOptions: FilterOption[] = [
    { value: COLLECTION_ALL, label: de.collection.filter.all },
    ...series.map((option) => ({ value: option.code, label: option.label })),
    { value: COLLECTION_DUPLICATES, label: de.collection.filter.duplicates },
  ];

  // How many the segment holds before the search narrows it — so the count
  // line can say "12 von 130 Figuren" instead of a bare number.
  const inSegment = useMemo(
    () =>
      rows.filter(
        (row) =>
          (row.quantity > 0 || changed.get(row.figure.skyId) === 0) &&
          matchesCollectionFilter(row, filter),
      ).length,
    [rows, changed, filter],
  );

  const searching = query.trim() !== "";
  const filtered = filter !== COLLECTION_ALL || searching;
  // `changed.size` keeps the empty state away while an undo is still on
  // screen: emptying the last card should not swap the grid out from under it.
  const nothingCollected = stats.distinctFigures === 0 && changed.size === 0;

  function reset() {
    setFilter(COLLECTION_ALL);
    setQuery("");
  }

  return (
    <div className="flex flex-col gap-6">
      <CollectionOverview
        summary={summary}
        stats={stats}
        segmentLabel={
          filterOptions.find((option) => option.value === filter)?.label ??
          de.collection.filter.all
        }
      />

      {/* An empty showcase gets one clear way forward instead of a filter bar
          over nothing. */}
      {nothingCollected ? (
        <div className="flex flex-col items-center gap-3 rounded-sky-lg bg-surface px-4 py-12 text-center shadow-card">
          <p className="font-medium">{de.collection.showcaseEmpty}</p>
          <p className="text-sm text-muted">{de.collection.showcaseEmptyHint}</p>
          <Link href="/" className={`${ACTION_NEUTRAL} w-auto`}>
            {de.collection.toCatalog}
          </Link>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            <FilterBar
              label={de.collection.statusFilter}
              options={filterOptions}
              active={filter}
              onSelect={setFilter}
            />

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
              className={
                "min-h-11 w-full rounded-sky-md bg-surface px-3.5 py-2.5 text-base " +
                "shadow-card placeholder:text-muted"
              }
            />

            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="text-sm text-muted" aria-live="polite">
                {searching
                  ? de.collection.searchCount(visible.length, inSegment)
                  : de.catalog.figureCount(visible.length)}
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
            <div className="flex flex-col items-center gap-3 rounded-sky-lg bg-surface px-4 py-12 text-center shadow-card">
              <p className="font-medium">{de.collection.noMatch(filter)}</p>
              <p className="text-sm text-muted">{de.collection.noMatchHint}</p>
              <button type="button" onClick={reset} className={`${ACTION_NEUTRAL} w-auto`}>
                {de.collection.resetFilters}
              </button>
            </div>
          ) : (
            /* Roomier than the catalog: this grid holds what someone owns,
               and there is less of it, so the figures get more room. */
            <FigureGrid dense={false}>
              {visible.map((row) => (
                <FigureCard
                  key={row.figure.skyId}
                  figure={row.figure}
                  quantity={row.quantity}
                  // No ownership frame: everything on this page is owned, so
                  // marking every card would say nothing and would water down
                  // what the frame means in the catalog (ADR-0038). The card
                  // keeps its default `ownership="showcase"`.
                  footer={
                    <>
                      {row.quantity === 0 && row.initialQuantity > 0 ? (
                        <p className="mb-1 text-center text-xs text-muted">
                          {de.collection.removed}
                        </p>
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
            </FigureGrid>
          )}
        </>
      )}
    </div>
  );
}
