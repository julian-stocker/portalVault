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
import { useDeferredValue, useMemo, useState, useSyncExternalStore } from "react";

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
import { CollectionTable } from "@/components/collection/collection-table";
import { SeriesSectionHeader } from "@/components/collection/series-section";
import { ViewToggle } from "@/components/collection/view-toggle";
import {
  readViewMode,
  serverViewMode,
  subscribeViewMode,
  writeViewMode,
  type ViewMode,
} from "@/components/collection/view-mode";
import { FilterMenu } from "@/components/collection/filter-menu";
import {
  COLLECTION_ALL,
  NO_FILTERS,
  buildCollectionRows,
  duplicateSummary,
  groupBySeries,
  hasActiveFilter,
  matchesFilters,
  matchesScope,
  ownedEntries,
  segmentSummary,
  type CollectionFilters,
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
  /** The game being looked at — navigation, not a filter. */
  const [scope, setScope] = useState<string>(COLLECTION_ALL);
  /** What narrows it further. */
  const [filters, setFilters] = useState<CollectionFilters>(NO_FILTERS);
  const [query, setQuery] = useState("");

  /**
   * Symbols or table.
   *
   * `useSyncExternalStore` rather than an effect: the remembered choice lives
   * outside React, the server's answer differs from the browser's, and that
   * is precisely what this hook is for. The server snapshot is the default,
   * so the first paint matches what was rendered and React swaps in the
   * stored value immediately after hydration — no mismatch, and no render
   * triggered from inside another one.
   */
  const mode = useSyncExternalStore(subscribeViewMode, readViewMode, serverViewMode);
  function selectMode(next: ViewMode) {
    writeViewMode(next);
  }
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
    () => segmentSummary(rows, scope, catalogTotal),
    [rows, scope, catalogTotal],
  );

  // Only while the filter is on: an extra line, never a second summary.
  const duplicates = useMemo(
    () => (filters.duplicatesOnly ? duplicateSummary(rows, scope) : null),
    [filters.duplicatesOnly, rows, scope],
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
        matchesScope(row, scope) &&
        // A row kept for undo has dropped to zero and would fail the
        // duplicates test; it stays so the undo does not vanish under the
        // filter that was on when it was removed.
        (justRemoved.has(row.figure.skyId) || matchesFilters(row, filters)) &&
        matchesQuery(row.figure, normalized),
    );
  }, [rows, changed, scope, filters, normalized]);

  // "Alle" and the six games. Duplicates left this bar in V4.2: a duplicate
  // is not a game, and putting it here made "Giants and duplicates"
  // unreachable (ADR-0038).
  const scopeOptions: FilterOption[] = [
    { value: COLLECTION_ALL, label: de.collection.filter.all },
    ...series.map((option) => ({ value: option.code, label: option.label })),
  ];

  // How many the segment holds before the search narrows it — so the count
  // line can say "12 von 130 Figuren" instead of a bare number.
  const inSegment = useMemo(
    () =>
      rows.filter(
        (row) =>
          (row.quantity > 0 || changed.get(row.figure.skyId) === 0) &&
          matchesScope(row, scope) &&
          matchesFilters(row, filters),
      ).length,
    [rows, changed, scope, filters],
  );

  const searching = query.trim() !== "";
  /**
   * The grouped view, or null for a flat one.
   *
   * "Alle" becomes six sections; a chosen series becomes exactly one. V4.1
   * kept the heading for the single case as well — the same shape whichever
   * tab is active, and the section states how far that game has come, which
   * the tab does not.
   *
   * Duplicates stay flat: they are a cross-section of every game, so
   * splitting them by game would scatter the very thing being looked at.
   */
  const sections = useMemo(
    () => groupBySeries(visible, rows, series),
    [visible, rows, series],
  );

  const filtered = hasActiveFilter(scope, query, filters);
  // `changed.size` keeps the empty state away while an undo is still on
  // screen: emptying the last card should not swap the grid out from under it.
  const nothingCollected = stats.distinctFigures === 0 && changed.size === 0;

  function reset() {
    setScope(COLLECTION_ALL);
    setFilters(NO_FILTERS);
    setQuery("");
  }

  /** One card, however the view chose to arrange them. */
  function showcaseCard(row: (typeof rows)[number]) {
    return (
      <FigureCard
        key={row.figure.skyId}
        figure={row.figure}
        quantity={row.quantity}
        // No ownership frame and no crown: everything on this page is owned,
        // so marking every card would say nothing and would water down what
        // the gold means in the catalog (ADR-0038). The card keeps its
        // default `ownership="showcase"`.
        footer={
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
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <CollectionOverview
        summary={summary}
        duplicates={duplicates}
        stats={stats}
        segmentLabel={
          scopeOptions.find((option) => option.value === scope)?.label ??
          de.collection.filter.all
        }
      />

      {/* An empty showcase gets one clear way forward instead of a filter bar
          over nothing. */}
      {nothingCollected ? (
        <div className="flex flex-col items-center gap-3 rounded-sky-lg bg-surface/80 px-4 py-12 text-center ring-1 ring-border/70">
          <p className="font-medium">{de.collection.showcaseEmpty}</p>
          <p className="text-sm text-muted">{de.collection.showcaseEmptyHint}</p>
          <Link href="/" className={`${ACTION_NEUTRAL} w-auto`}>
            {de.collection.toCatalog}
          </Link>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {/* Two controls, two jobs: the bar picks the game, the menu
                narrows it. They share a row on a wide screen and stack on a
                phone, where the bar needs the full width to scroll. */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              <FilterBar
                label={de.collection.statusFilter}
                options={scopeOptions}
                active={scope}
                onSelect={setScope}
              />
              <FilterMenu filters={filters} onChange={setFilters} />
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
              className={
                "min-h-11 w-full rounded-sky-md bg-surface/80 px-3.5 py-2.5 text-base " +
                "ring-1 ring-border/70 placeholder:text-muted focus:ring-border-strong"
              }
            />

            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <p className="text-sm text-muted" aria-live="polite">
                {searching
                  ? de.collection.searchCount(visible.length, inSegment)
                  : de.catalog.figureCount(visible.length)}
              </p>
              <div className="flex items-center gap-4">
                {filtered ? (
                  <button
                    type="button"
                    onClick={reset}
                    className="text-sm text-muted underline underline-offset-2 hover:text-foreground"
                  >
                    {de.collection.resetFilters}
                  </button>
                ) : null}
                <ViewToggle mode={mode} onSelect={selectMode} />
              </div>
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-sky-lg bg-surface/80 px-4 py-12 text-center ring-1 ring-border/70">
              <p className="font-medium">{de.collection.noMatch(scope)}</p>
              <p className="text-sm text-muted">{de.collection.noMatchHint}</p>
              {/* Only when there is something to reset: an empty showcase with
                  no filter set has nothing this button could undo. */}
              {filtered ? (
                <button type="button" onClick={reset} className={`${ACTION_NEUTRAL} w-auto`}>
                  {de.collection.resetFilters}
                </button>
              ) : null}
            </div>
          ) : sections.length > 0 ? (
            /* Always by game, whatever is selected (ADR-0038, V4.1): "Alle"
               yields six sections, one game yields one, and the duplicates
               filter yields whichever games hold duplicates. One structure
               means the page does not rearrange itself under a filter. */
            <div className="flex flex-col gap-9">
              {sections.map((section) => (
                <section key={section.code} className="flex flex-col gap-4">
                  <SeriesSectionHeader
                    label={section.label}
                    owned={section.owned}
                    total={section.total}
                    ratio={section.ratio}
                  />
                  {mode === "table" ? (
                    <CollectionTable rows={section.rows} onRemove={onQuantityChange} />
                  ) : (
                    <FigureGrid>{section.rows.map(showcaseCard)}</FigureGrid>
                  )}
                </section>
              ))}
            </div>
          ) : mode === "table" ? (
            /* Only reachable for rows no game claims — an owned figure whose
               series left the catalog. Rare, but it must not vanish. */
            <CollectionTable rows={visible} onRemove={onQuantityChange} />
          ) : (
            <FigureGrid dense={false}>{visible.map(showcaseCard)}</FigureGrid>
          )}
        </>
      )}
    </div>
  );
}
