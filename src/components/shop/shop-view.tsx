/**
 * The shop's grid.
 *
 * Deliberately the **same cards** the catalog draws, with the same buy action
 * and the same collect action — `CatalogCard` unchanged, nothing subclassed,
 * no second card component. A figure on offer looks here exactly as it looks
 * on `/`, because it is the same figure.
 *
 * The only interaction of its own is a search box, and it reuses the catalog's
 * own matcher. There are deliberately no series tabs and no ownership filter:
 * the whole page is usually a few dozen cards, and a filter bar over that many
 * is furniture. If the shop ever outgrows one screen, the catalog's controls
 * are there to lift over wholesale.
 *
 * NOTHING HERE KNOWS A STOCK LEVEL. Every entry arrives already filtered by
 * `shopEntries()`, and an offer carries `available: boolean` and no count.
 */
"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";

import { CatalogCard } from "@/components/catalog/catalog-card";
import { FigureGrid } from "@/components/catalog/figure-grid";
import { ACTION_NEUTRAL } from "@/components/ui/action";
import { matchesQuery, normalizeForSearch } from "@/lib/catalog/search";
import type { ShopEntry } from "@/lib/shop/surface";
import { de } from "@/lib/i18n/de";

export function ShopView({
  entries,
  ownedSkyIds,
  signedIn,
  highlightSkyId = null,
}: {
  entries: readonly ShopEntry[];
  /** Which of the offered figures the visitor already owns. Empty signed out. */
  ownedSkyIds: readonly string[];
  signedIn: boolean;
  /** Outlines the card somebody came back to after signing in (ADR-0027). */
  highlightSkyId?: string | null;
}) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const owned = useMemo(() => new Set(ownedSkyIds), [ownedSkyIds]);

  const normalized = normalizeForSearch(deferredQuery);
  const visible = useMemo(
    () => entries.filter((entry) => matchesQuery(entry.figure, normalized)),
    [entries, normalized],
  );

  // Nothing listed, or everything sold out — for a visitor those are the same
  // page, and the difference is a stock fact that is not public.
  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-sky-lg bg-deep/90 px-4 py-12 text-center ring-1 ring-gold-line backdrop-blur-sm">
        <p className="font-medium">{de.shop.page.empty}</p>
        <p className="text-sm text-on-deep-muted">{de.shop.page.emptyHint}</p>
        <Link href="/" className={`${ACTION_NEUTRAL} w-auto`}>
          {de.shop.page.toCatalog}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <label className="sr-only" htmlFor="shop-search">
          {de.shop.page.searchLabel}
        </label>
        <input
          id="shop-search"
          type="search"
          inputMode="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={de.catalog.searchPlaceholder}
          // The catalog's bar, same shape: this is one product, not two.
          className={
            "min-h-12 w-full rounded-full bg-deep/80 px-5 py-3 text-base " +
            "shadow-raised ring-1 ring-border-strong/70 backdrop-blur-sm " +
            "placeholder:text-muted focus:ring-accent/70"
          }
        />
      </div>

      <p className="text-sm text-muted" aria-live="polite">
        {de.shop.page.count(visible.length)}
      </p>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-sky-lg bg-surface/80 px-4 py-12 text-center ring-1 ring-border/70">
          <p className="font-medium">{de.shop.page.noHits}</p>
          <p className="text-sm text-muted">{de.shop.page.noHitsHint}</p>
          <button
            type="button"
            onClick={() => setQuery("")}
            className={`${ACTION_NEUTRAL} w-auto`}
          >
            {de.shop.page.resetSearch}
          </button>
        </div>
      ) : (
        <FigureGrid>
          {visible.map((entry) => (
            <CatalogCard
              key={entry.figure.skyId}
              figure={entry.figure}
              initialCollected={owned.has(entry.figure.skyId)}
              // Coming back to the shop after signing in, with the figure
              // outlined — the same contract the catalog has (ADR-0027).
              signInHref={
                signedIn
                  ? null
                  : `/login?next=${encodeURIComponent(`/shop?figure=${entry.figure.skyId}`)}`
              }
              highlighted={highlightSkyId === entry.figure.skyId}
              offers={entry.offers}
              // Unlike the catalog, this grid mixes all six games, so the
              // series is worth naming on every card.
              showSeries
            />
          ))}
        </FigureGrid>
      )}
    </div>
  );
}
