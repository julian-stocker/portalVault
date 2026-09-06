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
import { OwnedToggle } from "@/components/catalog/owned-toggle";
import { ProductGroupTabs } from "@/components/catalog/group-tabs";
import { SeriesTabs } from "@/components/catalog/series-tabs";
import { groupTabs, matchesGroup, type CatalogGroup } from "@/lib/catalog/group";
import { filterFigures, groupSearchResults, missingFigures } from "@/lib/catalog/search";
import { SeriesSectionHeader } from "@/components/collection/series-section";
import { defaultSeriesCode } from "@/lib/catalog/series-nav";
import type { CatalogFigure, SeriesOption } from "@/lib/catalog/types";
import type { Offer } from "@/lib/shop/offer";
import { de } from "@/lib/i18n/de";

/** One shared empty array, so a card without an offer keeps a stable prop. */
const EMPTY_OFFERS: readonly Offer[] = [];

export function CatalogView({
  figures,
  series,
  ownedSkyIds,
  signedIn,
  admin = false,
  highlightSkyId,
  initialSeriesCode,
  initialQuery = "",
  initialGroup = null,
  offers = {},
}: {
  figures: readonly CatalogFigure[];
  series: readonly SeriesOption[];
  ownedSkyIds: readonly string[];
  signedIn: boolean;
  /**
   * Administrator mode (ADR-0042): the same catalog, with editorial actions
   * on the cards instead of collection actions — and hidden figures included,
   * because otherwise a figure could be hidden and never found again.
   */
  admin?: boolean;
  highlightSkyId: string | null;
  /** Restores the view someone left when they went to sign in (ADR-0027). */
  initialSeriesCode?: string;
  initialQuery?: string;
  initialGroup?: CatalogGroup | null;
  /**
   * The public shop, by SKY-ID (ADR-0043). A plain object rather than a Map
   * because it crosses the server/client boundary, where a Map does not
   * survive serialisation.
   *
   * Loaded once for the whole catalog: the alternative is one request per
   * card, and there are 561 cards.
   */
  offers?: Readonly<Record<string, readonly Offer[]>>;
}) {
  // A series is always chosen (ADR-0038). The first one is the default, so
  // the catalog opens on Spyro's Adventure rather than on all 561 at once.
  const defaultSeries = defaultSeriesCode(series);
  const [query, setQuery] = useState(initialQuery);
  const [seriesCode, setSeriesCodeState] = useState<string>(initialSeriesCode ?? defaultSeries);

  /**
   * The product group inside the chosen game (ADR-0041). `null` is "Alle".
   *
   * A second navigation level, not a third filter dimension in disguise:
   * series says where you are, this says what kind of thing you are looking
   * at, and neither says anything about variants or completion.
   */
  const [group, setGroup] = useState<CatalogGroup | null>(initialGroup ?? null);

  /**
   * Picking a game resets the group to "Alle".
   *
   * Carrying `trap` from Trap Team into SuperChargers would land on a filter
   * that exists nowhere in that game — an empty grid with no visible cause.
   */
  function setSeriesCode(code: string) {
    setSeriesCodeState(code);
    setGroup(null);
  }
  const deferredQuery = useDeferredValue(query);

  const searching = deferredQuery.trim() !== "";

  /**
   * What was collected or given up on this page, before the server has told
   * anyone about it.
   *
   * The cards toggle ownership themselves and the filter has to see that in
   * the same frame: collecting a figure while "Besitz anzeigen" is off means
   * it belongs to the owned pile now, so it leaves the list. Waiting for the
   * server to say so would leave it sitting there under a filter that
   * excludes it.
   */
  const [changed, setChanged] = useState<Map<string, boolean>>(() => new Map());

  const owned = useMemo(() => {
    const set = new Set(ownedSkyIds);
    for (const [skyId, isOwned] of changed) {
      if (isOwned) set.add(skyId);
      else set.delete(skyId);
    }
    return set;
  }, [ownedSkyIds, changed]);

  function onCollectedChange(skyId: string, collected: boolean) {
    setChanged((current) => new Map(current).set(skyId, collected));
  }

  /**
   * "Besitz anzeigen": display only, **on by default** (ADR-0038, V4.3).
   *
   * On is the plain catalog, owned and missing together. Off hides what is
   * already owned and leaves what is still missing. Never offered signed
   * out, where it has no answer.
   *
   * Deliberately not persisted: no `localStorage`, no cookie, no URL
   * parameter. Every visit opens on the full catalog, which is what the
   * catalog is for — and there is no stored value from the old, inverted
   * V4.2 filter that could quietly come back meaning the opposite.
   */
  const [showOwned, setShowOwned] = useState(true);

  /**
   * Visibility changed on this page, before the server has caught up.
   *
   * Same idea as `changed` above: the card has to mark itself hidden the
   * moment the switch is thrown, and stay in the list so it can be brought
   * back.
   */
  const [visibility, setVisibility] = useState<Map<string, boolean>>(() => new Map());

  function onVisibilityChange(skyId: string, visible: boolean) {
    setVisibility((current) => new Map(current).set(skyId, visible));
  }

  const isVisible = (figure: CatalogFigure) =>
    visibility.get(figure.skyId) ?? figure.catalogVisible;

  /**
   * The pool everything else works from.
   *
   * Narrowing here rather than inside the search means the filter applies to
   * the grid and to the cross-series results by construction: there is no
   * second code path that could forget it.
   */
  const pool = useMemo(() => {
    // One pool, narrowed in turn. Search and the cross-series search both
    // read it, so neither needs to know that a group filter exists — the
    // same trick the ownership filter uses (ADR-0041).
    const owning = admin || showOwned ? figures : missingFigures(figures, owned);
    return group === null ? owning : owning.filter((figure) => matchesGroup(figure, group));
  }, [admin, showOwned, figures, owned, group]);

  /**
   * The second level's tabs, for the chosen game.
   *
   * Counted from the catalog that was loaded and before search, ownership or
   * the group itself apply — so the numbers describe the game rather than
   * the current view, and they do not move while someone types. An
   * administrator's catalog includes hidden figures, so their counts do too;
   * nobody else's catalog contains them to begin with.
   */
  const tabs = useMemo(
    () => groupTabs(figures.filter((figure) => figure.seriesCode === seriesCode), de.catalog.groupAll),
    [figures, seriesCode],
  );

  const visible = useMemo(
    () => filterFigures(pool, { query: deferredQuery, seriesCode }),
    [pool, deferredQuery, seriesCode],
  );

  /**
   * While searching, the whole catalog answers — the active game first, the
   * others as their own sections below it (ADR-0038, V4.1). The tab does not
   * move: clearing the search has to return the visitor to the view they
   * left, and a tab that changed itself would not.
   */
  const groups = useMemo(
    () =>
      searching
        ? groupSearchResults(pool, { query: deferredQuery, seriesCode, series })
        : null,
    [searching, pool, deferredQuery, seriesCode, series],
  );

  /**
   * Signing in returns the visitor to this exact view — same series, same
   * search, with the figure they meant outlined. `figure` only highlights;
   * nothing is written from a URL parameter (ADR-0027).
   */
  function signInHref(skyId: string): string {
    const params = new URLSearchParams();
    params.set("series", seriesCode);
    if (group !== null) params.set("group", group);
    if (query.trim() !== "") params.set("q", query.trim());
    params.set("figure", skyId);
    return `/login?next=${encodeURIComponent(`/?${params.toString()}`)}`;
  }

  const activeSeries = series.find((option) => option.code === seriesCode) ?? null;
  // The series is not resettable — one is always chosen — so what is left is
  // the search box and the ownership filter. "Besitz anzeigen" counts as
  // active only when it is off, because on is the resting state.
  const filtered = query.trim() !== "" || (!admin && !showOwned) || group !== null;

  function reset() {
    setQuery("");
    setShowOwned(true);
    setGroup(null);
  }

  /** One card, in whichever mode the visitor is in. */
  function card(figure: CatalogFigure) {
    return (
      <CatalogCard
        key={figure.skyId}
        figure={figure}
        initialCollected={owned.has(figure.skyId)}
        onCollectedChange={onCollectedChange}
        signInHref={signedIn ? null : signInHref(figure.skyId)}
        highlighted={highlightSkyId === figure.skyId}
        admin={admin}
        visible={isVisible(figure)}
        onVisibilityChange={onVisibilityChange}
        offers={offers[figure.skyId] ?? EMPTY_OFFERS}
      />
    );
  }

  return (
    <div className="flex flex-col gap-7">
      {/*
       * The intro. No panel and no picture of its own (ADR-0038, V3.3): the
       * world is already behind this whole block, painted by the layout's
       * WorldZone, so anything with a ground here would cut a rectangle out
       * of it. The title carries its own shadow instead.
       *
       * The column is capped at half the width on desktop so it never
       * reaches the portal on the right.
       */}
      <div className="md:max-w-[52%]">
        <h1
          className="text-3xl leading-tight font-semibold tracking-tight md:text-5xl"
          style={{ textShadow: "0 2px 20px rgb(10 9 24 / 0.85), 0 1px 3px rgb(10 9 24 / 0.95)" }}
        >
          {de.catalog.heading}
        </h1>
        <p
          className="mt-2 text-sm text-on-deep-muted md:text-base"
          style={{ textShadow: "0 1px 14px rgb(10 9 24 / 0.9)" }}
        >
          {de.catalog.intro}
        </p>

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
          className={
            // A dark bar in the world, not a form field on a panel.
            "mt-5 min-h-12 w-full rounded-full bg-deep/80 px-5 py-3 text-base " +
            "shadow-raised ring-1 ring-border-strong/70 backdrop-blur-sm " +
            "placeholder:text-muted focus:ring-accent/70"
          }
        />
      </div>

      {/* Still inside the world, at the point where it turns into the
          vitrine — so there is no bright gap between the two. */}
      <div className="flex flex-col gap-3">
        <SeriesTabs series={series} active={seriesCode} onSelect={setSeriesCode} />

        {/* The second level, directly under the games it narrows. Absent for
            a game that holds only one kind of thing. */}
        <ProductGroupTabs tabs={tabs} active={group} onSelect={setGroup} />

        {/*
         * The section header (ADR-0038, V4.2): what is being shown on the
         * left, what can be done about it on the right. The count line was
         * already here; it gains the controls rather than a bar of its own,
         * because a second bar under the tabs would read as a second
         * navigation.
         *
         * `aria-live` so a filter change is announced without moving focus.
         *
         * There is deliberately no "Specials" toggle. Nothing in the data
         * says which figures are specials — deriving it from names would be
         * guessing (ADR-0034) — so the control is absent rather than present
         * and wrong.
         */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="text-sm text-muted" aria-live="polite">
            {searching
              ? de.catalog.searchTotal(groups?.reduce((n, g) => n + g.figures.length, 0) ?? 0)
              : activeSeries
                ? de.catalog.countInSeries(activeSeries.label, visible.length)
                : de.catalog.figureCount(visible.length)}
          </p>
          {signedIn && !admin ? <OwnedToggle active={showOwned} onChange={setShowOwned} /> : null}
        </div>
      </div>

      {groups ? (
        /* Searching: sections, the active game first. */
        <div className="flex flex-col gap-9">
          {groups.map((group) => (
            <section key={group.code} className="flex flex-col gap-4">
              <SeriesSectionHeader
                label={group.label}
                count={de.catalog.hitCount(group.figures.length)}
              />
              {group.figures.length === 0 ? (
                <p className="text-sm text-muted">{de.catalog.noHitsHere}</p>
              ) : (
                <FigureGrid>{group.figures.map(card)}</FigureGrid>
              )}
            </section>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-sky-lg bg-surface/80 px-4 py-12 text-center ring-1 ring-border/70">
          <p className="font-medium">
            {!showOwned && !searching ? de.catalog.ownedEmpty : de.catalog.empty}
          </p>
          <p className="text-sm text-muted">{de.catalog.emptyHint}</p>
          {filtered ? (
            <button type="button" onClick={reset} className={`${ACTION_NEUTRAL} w-auto`}>
              {de.catalog.resetFilters}
            </button>
          ) : null}
        </div>
      ) : (
        <FigureGrid>{visible.map(card)}</FigureGrid>
      )}
    </div>
  );
}
