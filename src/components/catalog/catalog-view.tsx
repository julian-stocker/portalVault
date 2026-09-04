/**
 * The interactive catalog.
 *
 * Receives the whole catalog once and does search and filtering in the
 * browser (ADR-0026). `useDeferredValue` keeps typing responsive without a
 * debounce timer that could swallow the last keystroke.
 */
"use client";

import { useDeferredValue, useMemo, useState } from "react";

import { CollectButton } from "@/components/catalog/collect-button";
import { FigureGrid } from "@/components/catalog/figure-grid";
import { SeriesTabs } from "@/components/catalog/series-tabs";
import { ALL_SERIES, filterFigures } from "@/lib/catalog/search";
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
  const [query, setQuery] = useState(initialQuery);
  const [seriesCode, setSeriesCode] = useState<string>(initialSeriesCode ?? ALL_SERIES);
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
    if (seriesCode !== ALL_SERIES) params.set("series", seriesCode);
    if (query.trim() !== "") params.set("q", query.trim());
    params.set("figure", skyId);
    return `/login?next=${encodeURIComponent(`/?${params.toString()}`)}`;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <label className="sr-only" htmlFor="catalog-search">
          {de.catalog.searchLabel}
        </label>
        <input
          id="catalog-search"
          type="search"
          inputMode="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={de.catalog.searchPlaceholder}
          className="w-full rounded-md border border-border bg-background px-3 py-2.5 text-base outline-none focus:border-foreground"
        />
        <SeriesTabs series={series} active={seriesCode} onSelect={setSeriesCode} />
        <p className="text-sm text-muted">
          {de.catalog.resultCount(visible.length, figures.length)}
        </p>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-border px-4 py-10 text-center">
          <p className="font-medium">{de.catalog.empty}</p>
          <p className="mt-1 text-sm text-muted">{de.catalog.emptyHint}</p>
        </div>
      ) : (
        <FigureGrid
          figures={visible}
          highlightSkyId={highlightSkyId}
          renderAction={(figure) => (
            <CollectButton
              skyId={figure.skyId}
              initialCollected={owned.has(figure.skyId)}
              signInHref={signedIn ? null : signInHref(figure.skyId)}
            />
          )}
        />
      )}
    </div>
  );
}
