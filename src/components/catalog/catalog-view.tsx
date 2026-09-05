/**
 * The interactive catalog.
 *
 * Receives the whole catalog once and does search and filtering in the
 * browser (ADR-0026). `useDeferredValue` keeps typing responsive without a
 * debounce timer that could swallow the last keystroke.
 */
"use client";

import { useDeferredValue, useMemo, useState } from "react";

import { CatalogCard } from "@/components/catalog/catalog-card";
import { ACTION_NEUTRAL } from "@/components/ui/action";
import { FigureGrid } from "@/components/catalog/figure-grid";
import { SeriesTabs } from "@/components/catalog/series-tabs";
import { filterFigures } from "@/lib/catalog/search";
import { defaultSeriesCode } from "@/lib/catalog/series-nav";
import type { CatalogFigure, SeriesOption } from "@/lib/catalog/types";
import { de } from "@/lib/i18n/de";

export function CatalogView({
  figures,
  series,
  ownedSkyIds,
  signedIn,
  highlightSkyId,
  initialSeriesCode,
  initialQuery = "",
}: {
  figures: readonly CatalogFigure[];
  series: readonly SeriesOption[];
  ownedSkyIds: readonly string[];
  signedIn: boolean;
  highlightSkyId: string | null;
  /** Restores the view someone left when they went to sign in (ADR-0027). */
  initialSeriesCode?: string;
  initialQuery?: string;
}) {
  // A series is always chosen (ADR-0038). The first one is the default, so
  // the catalog opens on Spyro's Adventure rather than on all 561 at once.
  const defaultSeries = defaultSeriesCode(series);
  const [query, setQuery] = useState(initialQuery);
  const [seriesCode, setSeriesCode] = useState<string>(initialSeriesCode ?? defaultSeries);
  const deferredQuery = useDeferredValue(query);

  const owned = useMemo(() => new Set(ownedSkyIds), [ownedSkyIds]);
  const visible = useMemo(
    () => filterFigures(figures, { query: deferredQuery, seriesCode }),
    [figures, deferredQuery, seriesCode],
  );

  /**
   * Signing in returns the visitor to this exact view — same series, same
   * search, with the figure they meant outlined. `figure` only highlights;
   * nothing is written from a URL parameter (ADR-0027).
   */
  function signInHref(skyId: string): string {
    const params = new URLSearchParams();
    params.set("series", seriesCode);
    if (query.trim() !== "") params.set("q", query.trim());
    params.set("figure", skyId);
    return `/login?next=${encodeURIComponent(`/?${params.toString()}`)}`;
  }

  const activeSeries = series.find((option) => option.code === seriesCode) ?? null;
  // Only the search is resettable now — a series is always chosen, so
  // "clear the series" is not a state the catalog can be in.
  const filtered = query.trim() !== "";

  function reset() {
    setQuery("");
  }

  return (
    <div className="flex flex-col gap-4">
      {/*
       * The catalog tools.
       *
       * Sticky from `md:` upwards only: on a desktop the figure grid runs far
       * past the fold, and losing the search on the way down is the actual
       * annoyance. On a phone the same bar would eat a fifth of the viewport
       * for the whole scroll, so it stays put there.
       */}
      <div className="flex flex-col gap-3 md:sticky md:top-0 md:z-10 md:-mx-4 md:bg-canvas md:px-4 md:pt-4 md:pb-3">
        <label className="sr-only" htmlFor="catalog-search">
          {de.catalog.searchLabel}
        </label>
        {/* Filled rather than outlined: one less line on a page that had too
            many, and the surface already separates it from the canvas. */}
        <input
          id="catalog-search"
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
        <SeriesTabs series={series} active={seriesCode} onSelect={setSeriesCode} />

        {/*
         * The count, quietly. The series name is on the active tab now, so
         * repeating it here would say the same thing twice.
         * `aria-live` so a filter change is announced without moving focus.
         */}
        <p className="text-sm text-muted" aria-live="polite">
          {activeSeries
            ? de.catalog.countInSeries(activeSeries.label, visible.length)
            : de.catalog.figureCount(visible.length)}
        </p>
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-sky-lg bg-surface px-4 py-12 text-center shadow-card">
          <p className="font-medium">{de.catalog.empty}</p>
          <p className="text-sm text-muted">{de.catalog.emptyHint}</p>
          {filtered ? (
            <button type="button" onClick={reset} className={`${ACTION_NEUTRAL} w-auto`}>
              {de.catalog.resetFilters}
            </button>
          ) : null}
        </div>
      ) : (
        <FigureGrid>
          {visible.map((figure) => (
            <CatalogCard
              key={figure.skyId}
              figure={figure}
              initialCollected={owned.has(figure.skyId)}
              signInHref={signedIn ? null : signInHref(figure.skyId)}
              highlighted={highlightSkyId === figure.skyId}
            />
          ))}
        </FigureGrid>
      )}
    </div>
  );
}
