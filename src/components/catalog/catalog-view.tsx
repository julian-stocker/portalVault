/**
 * The interactive catalog.
 *
 * Receives the whole catalog once and does search and filtering in the
 * browser (ADR-0026). `useDeferredValue` keeps typing responsive without a
 * debounce timer that could swallow the last keystroke.
 */
"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";

import { CatalogCard } from "@/components/catalog/catalog-card";
import { AddFigureModal } from "@/components/admin/add-figure-modal";
import { AdminFigureModal } from "@/components/admin/figure-modal";
import type { AdminFigureDraft } from "@/lib/admin/figure-draft";
import type { CategoryOption } from "@/lib/admin/new-figure-draft";
import { QuickView } from "@/components/catalog/quick-view";
import { ACTION_NEUTRAL, ACTION_PRIMARY } from "@/components/ui/action";
import { FigureGrid } from "@/components/catalog/figure-grid";
import { quickViewModel } from "@/lib/ui/quick-view";
import { BrowseToolbar } from "@/components/ui/browse-toolbar";
import { AvailabilityFilter } from "@/components/catalog/availability-filter";
import {
  DEFAULT_AVAILABILITY,
  matchesAvailability,
  type AvailabilityMode,
} from "@/lib/catalog/availability";
import { FilterGroup, FilterSheet } from "@/components/ui/filter-sheet";
import type { PublicSeller } from "@/lib/shop/seller";
import { OwnershipFilter } from "@/components/catalog/ownership-filter";
import { ProductGroupTabs } from "@/components/catalog/group-tabs";
import { SeriesTabs } from "@/components/catalog/series-tabs";
import { groupTabs, matchesGroup, type CatalogGroup } from "@/lib/catalog/group";
import { filterFigures, groupSearchResults } from "@/lib/catalog/search";
import {
  catalogFilterCount,
  DEFAULT_OWNERSHIP,
  isOwnershipActive,
  matchesOwnership,
  offersOwnershipFilter,
  type OwnershipMode,
} from "@/lib/catalog/ownership";
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
  seller = null,
  categories = [],
  marketBoostPercent = 0,
  freeShippingFrom = null,
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
  /**
   * Who sells on SkyIsles, from the page's own round of queries (ADR-0064).
   *
   * `null` when nobody is published — before migration 0027, or for an
   * administrator, who is not shopping. The quick view then names no seller
   * rather than inventing one.
   */
  seller?: PublicSeller | null;
  /**
   * Warenwert, ab dem der Versand entfällt — gereicht bis in die
   * Schnellansicht, die denselben Hinweis zeigt wie die Figurenseite.
   * `null` heißt „ohne Zahl sagen"; erfunden wird keine.
   */
  freeShippingFrom?: number | null;
  /**
   * The controlled category list the create dialog offers (V3.9).
   *
   * Loaded by the page, and only for an administrator — a collector's render
   * passes nothing and the array stays empty. The series list is already a
   * prop for the series picker, so creating a figure adds one query to the
   * admin page and none to the public one.
   */
  categories?: readonly CategoryOption[];
  /**
   * The temporary catalog market-value boost, in per cent (0094).
   *
   * Read once per request by the page and handed down; no card and no dialog
   * fetches it. 0 means the stored price is shown, which is also what a
   * surface gets that passes nothing.
   */
  marketBoostPercent?: number;
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
   * "Alle · Besitz · Fehlen": display only, `all` by default (V7).
   *
   * Three named states replace the "Besitz anzeigen" toggle, which was
   * highlighted while owned figures were hidden and therefore read as
   * inverted. Exactly one segment is highlighted here, and it is always the
   * one describing what is on screen.
   *
   * Deliberately not persisted: no `localStorage`, no cookie, no URL
   * parameter. Every visit opens on the whole catalog, which is what the
   * catalog is for — and no stored value from an older filter can come back
   * meaning something else. Nothing has to be migrated, because nothing was
   * ever stored.
   */
  const [ownership, setOwnership] = useState<OwnershipMode>(DEFAULT_OWNERSHIP);

  /**
   * Whether to show only figures somebody is offering (V3.3).
   *
   * Its own dimension, combining freely with the ownership filter above it —
   * "missing and buyable" is the whole point, and a third option inside
   * `ownership` could not say it.
   */
  const [availability, setAvailability] = useState<AvailabilityMode>(DEFAULT_AVAILABILITY);

  /**
   * Visibility changed on this page, before the server has caught up.
   *
   * Same idea as `changed` above: the card has to mark itself hidden the
   * moment the switch is thrown, and stay in the list so it can be brought
   * back.
   */
  const [visibility, setVisibility] = useState<Map<string, boolean>>(() => new Map());

  /**
   * Which figure's offer is being looked at, or null (IR-001).
   *
   * A SKY-ID rather than the figure itself, so what the dialog shows is
   * resolved from the same `figures` and `offers` the grid reads on every
   * render. A captured object would keep showing a price that had changed
   * underneath it.
   *
   * Deliberately not in the URL. A query parameter would make the dialog
   * shareable and would also turn every open into a request for a dynamic
   * route — which is exactly the work commit a0353cb removed. The shareable
   * address is the figure's own page, offered in the dialog.
   */
  const [quickViewSkyId, setQuickViewSkyId] = useState<string | null>(null);
  /*
   * The administrator's editor (V3.8). A separate piece of state from the
   * quick view on purpose: the two dialogs answer different questions, only
   * one of them can be open, and a shared "which dialog" value would let a
   * future change open the buying panel for an operator.
   */
  const [editSkyId, setEditSkyId] = useState<string | null>(null);
  /*
   * Creating a figure (V3.9). Separate state from the editor's: one dialog
   * changes a figure that exists, the other brings one into existence, and a
   * shared "which dialog" value would have to encode that difference anyway.
   */
  const [adding, setAdding] = useState(false);
  /* What the last create issued, so the confirmation can name it. */
  const [created, setCreated] = useState<string | null>(null);
  /*
   * What a save changed, held here until the server's revalidation catches
   * up. `revalidatePath` reaches this component through a new render; this
   * makes the card correct in the same frame, which is what the operator is
   * looking at.
   */
  const [edited, setEdited] = useState<Record<string, AdminFigureDraft>>({});

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
    // read it, so neither needs to know that a group filter or an ownership
    // filter exists — that is what makes every combination work without any
    // of them being written twice (ADR-0041).
    //
    // An administrator has no ownership state to narrow by (ADR-0042), so
    // their pool skips the step rather than being given a third value that
    // means "not applicable".
    const owning = admin
      ? figures
      : figures.filter((figure) => matchesOwnership(figure, owned, ownership));
    const grouped = group === null ? owning : owning.filter((figure) => matchesGroup(figure, group));
    /*
     * The third narrowing, applied last and in the same pool as the other
     * two, so every combination works by construction: series × group ×
     * ownership × availability, and the search reads this pool as well.
     *
     * `offers` is the object the page already handed down — the same one the
     * cards and the quick view read. Nothing is fetched to answer this.
     */
    return availability === DEFAULT_AVAILABILITY
      ? grouped
      : grouped.filter((figure) => matchesAvailability(offers[figure.skyId], availability));
  }, [admin, ownership, figures, owned, group, availability, offers]);

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
  const filtered =
    query.trim() !== "" || (!admin && isOwnershipActive(ownership)) || group !== null;

  function reset() {
    setQuery("");
    setOwnership(DEFAULT_OWNERSHIP);
    setGroup(null);
    setAvailability(DEFAULT_AVAILABILITY);
  }

  /**
   * What the filter button reports, and what its reset clears (V3.3).
   *
   * Only the two secondary filters. The search box and the game are on
   * screen, so counting them would promise hidden narrowings that are not
   * hidden — and clearing them from inside the panel would undo navigation
   * somebody can see.
   */
  const filterCount = catalogFilterCount(group, ownership, availability);

  function resetFilters() {
    setOwnership(DEFAULT_OWNERSHIP);
    setGroup(null);
    setAvailability(DEFAULT_AVAILABILITY);
  }

  /** One card, in whichever mode the visitor is in. */
  function card(original: CatalogFigure) {
    /* What the editor has already saved, applied before the card draws. */
    const figure = withEdits(original);
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
        offers={offers[figure.skyId] ?? EMPTY_OFFERS}
        marketBoostPercent={marketBoostPercent}
        onOpenOffers={() => setQuickViewSkyId(figure.skyId)}
        onEdit={() => setEditSkyId(figure.skyId)}
      />
    );
  }

  /**
   * A figure with whatever the editor has already saved applied.
   *
   * Only the two fields a card actually draws — the card type decides the
   * artwork, the override decides the name. Visibility has its own path
   * (`isVisible`), and the note and image path are not on a card.
   */
  function withEdits(figure: CatalogFigure): CatalogFigure {
    const saved = edited[figure.skyId];
    if (!saved) return figure;
    return {
      ...figure,
      cardType: saved.cardType,
      displayName: saved.displayNameOverride ?? figure.displayName,
      displayNameOverride: saved.displayNameOverride,
    };
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
        {/*
         * The one line that says what SkyIsles is — and only to somebody who
         * does not know yet (F7).
         *
         * `/` stays the catalog (ADR-0025): the first channel is a QR code on
         * a parcel, and a page between intent and action would be a page
         * nobody asked for. What was missing was never a landing page, it was
         * this sentence. A signed-in collector keeps the quiet working
         * subline, because they have already answered the question.
         */}
        <p
          className="mt-2 text-sm text-on-deep-muted md:text-base"
          style={{ textShadow: "0 1px 14px rgb(10 9 24 / 0.9)" }}
        >
          {signedIn || admin ? de.catalog.intro : de.catalog.valueProp}
        </p>

        {/*
         * Two actions, and only for a visitor without an account.
         *
         * Nothing here is a marketing device: no countdown, no popup, no
         * modal, no dismissible banner that comes back. It is one row that
         * disappears entirely the moment somebody signs in — the catalog below
         * it is untouched, and an administrator never sees it at all
         * (ADR-0042).
         *
         * `/register` rather than `/login`: somebody reading this sentence is
         * being told what an account is for, so the honest next step is making
         * one. The sign-in link stays where it always was, in the bar.
         */}
        {signedIn || admin ? null : (
          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            <Link href="/register" className={`${ACTION_PRIMARY} w-auto`}>
              {de.catalog.ctaPrimary}
            </Link>
            <Link href="/ueber-skyisles" className={`${ACTION_NEUTRAL} w-auto`}>
              {de.catalog.ctaSecondary}
            </Link>
            {/* The shop, as a quiet third way rather than a third button:
                what SkyIsles sells is worth being findable, and it is not what
                a first-time visitor is here for. */}
            <Link
              href="/shop"
              className="inline-flex min-h-11 items-center px-1 text-sm text-on-deep-muted underline underline-offset-4 transition-colors hover:text-on-deep"
            >
              {de.catalog.ctaShop}
            </Link>
          </div>
        )}

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
            "placeholder:text-muted focus-ring"
          }
        />
      </div>

      {/* Still inside the world, at the point where it turns into the
          vitrine — so there is no bright gap between the two. */}
      <div className="flex flex-col gap-3">
        {/*
         * THE GAMES STAY OUTSIDE THE PANEL (V3.3).
         *
         * Picking a game is how somebody browses 561 figures; it is not a
         * narrowing of a list they are already looking at. Folding it into a
         * filter menu would hide the one control that is used on every visit
         * behind the one that is used on some.
         */}
        <SeriesTabs series={series} active={seriesCode} onSelect={setSeriesCode} />

        {/*
         * THE TOOLBAR (V3.3): what is being shown, and what can be done about
         * it — one row, the same row the collection has.
         *
         * The type tabs and the ownership filter used to sit out here beside
         * the games, which gave a phone three rows of pills before a single
         * figure and gave the eye no way to tell navigation from narrowing.
         *
         * There is deliberately no "Specials" toggle and no sort control.
         * Nothing in the data says which figures are specials — deriving it
         * from names would be guessing (ADR-0034) — and there is no sort
         * model to expose. Absent beats present and wrong.
         */}
        <BrowseToolbar
          count={
            searching
              ? de.catalog.searchTotal(groups?.reduce((n, g) => n + g.figures.length, 0) ?? 0)
              : activeSeries
                ? de.catalog.countInSeries(activeSeries.label, visible.length)
                : de.catalog.figureCount(visible.length)
          }
        >
          <FilterSheet activeCount={filterCount} onReset={resetFilters}>
            {/* Only what this page actually filters by. The type tabs are
                absent for a game that holds one kind of thing, exactly as
                they were when they sat outside. */}
            {tabs.length > 1 ? (
              <FilterGroup label={de.catalog.groupNav}>
                <ProductGroupTabs tabs={tabs} active={group} onSelect={setGroup} />
              </FilterGroup>
            ) : null}

            {offersOwnershipFilter({ signedIn, admin }) ? (
              <FilterGroup label={de.catalog.ownershipNav}>
                <OwnershipFilter active={ownership} onSelect={setOwnership} />
              </FilterGroup>
            ) : null}

            {/* Its own group, always — it does not depend on being signed in
                the way ownership does, because what is for sale is public
                (ADR-0025). */}
            <FilterGroup label={de.catalog.availabilityNav}>
              <AvailabilityFilter active={availability} onSelect={setAvailability} />
            </FilterGroup>
          </FilterSheet>

          {/*
            * Creating a figure (V3.9, ADR-0070), beside the filter rather than
            * on a page of its own — the administrator works in the catalogue,
            * not next to it (ADR-0042).
            *
            * `admin` gates the whole element, so a collector's render never
            * carries the button, its label or its dialog. `BrowseToolbar`
            * already lays its children out as a row, so nothing about the
            * toolbar's layout changes to make room.
            */}
          {admin ? (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className={
                "focus-ring inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full " +
                "px-4 text-sm font-medium text-on-deep-muted ring-1 ring-border/70 " +
                "transition-colors hover:text-on-deep hover:ring-border-strong"
              }
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 16 16"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              >
                <path d="M8 3.5v9M3.5 8h9" />
              </svg>
              {de.admin.addFigure}
            </button>
          ) : null}
        </BrowseToolbar>
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
            {ownership === "owned" && !searching
              ? de.catalog.ownedEmpty
              : ownership === "missing" && !searching
                ? de.catalog.missingEmpty
                : de.catalog.empty}
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

      {/*
       * The quick view — one instance for the whole grid, and a sibling of
       * it rather than a child of any card (IR-001).
       *
       * `quickViewModel` returns null for a figure with nothing buyable, so
       * a stale id cannot leave an empty shop surface standing open. Closing
       * changes this one value and nothing else: the series, the group, the
       * search, the ownership filter and the scroll position are all state
       * around this line that nobody touches.
       */}
      <QuickView
        model={
          quickViewSkyId
            ? quickViewModel(
                figures.find((figure) => figure.skyId === quickViewSkyId),
                offers[quickViewSkyId],
              )
            : null
        }
        seller={seller}
        freeShippingFrom={freeShippingFrom}
        guest={!signedIn}
        marketBoostPercent={marketBoostPercent}
        onClose={() => setQuickViewSkyId(null)}
      />

      {/*
       * The administrator's editor — one instance for the whole grid, for the
       * same reason the quick view is one: a dialog per card is 561 dialogs.
       *
       * Rendered only in admin mode, so nothing about it reaches a collector's
       * bundle path through this branch, and it holds the figure by id so a
       * save can redraw the card underneath it without closing it.
       */}
      {admin ? (
        <AdminFigureModal
          /* A different figure is a different dialog: remounting is what
             gives it a clean draft without an effect that resets one. */
          key={editSkyId ?? "none"}
          figure={
            editSkyId
              ? (withEdits(figures.find((figure) => figure.skyId === editSkyId)!) ?? null)
              : null
          }
          onClose={() => setEditSkyId(null)}
          onSaved={(skyId, draft) => {
            setEdited((current) => ({ ...current, [skyId]: draft }));
            /* Visibility has its own path through the grid, and the card is
               dimmed by it rather than by the draft. */
            onVisibilityChange(skyId, draft.catalogVisible);
          }}
        />
      ) : null}

      {admin ? (
        <AddFigureModal
          /* Remounted per opening, so a cancelled draft never comes back. */
          key={adding ? "open" : "closed"}
          open={adding}
          onClose={() => setAdding(false)}
          series={series}
          categories={categories}
          figures={figures}
          onCreated={(skyId) => {
            setCreated(skyId);
            /* Cleared from the handler rather than from an effect: there is
               no subscription here, just one message that has had its turn. */
            window.setTimeout(() => setCreated(null), 6000);
            /*
             * Nothing else to do. The new figure cannot come from the `edited`
             * overlay — that can only restate a figure the server already
             * sent — so it has to come from the server, and `createFigure()`
             * has already called `refresh()` there. The catalogue itself stays
             * free of any router, which is what `ui/browse.test.ts` and
             * `ui/quick-view-ux.test.ts` require of it.
             */
          }}
        />
      ) : null}

      {/*
        * The confirmation, as a live region that is always mounted and only
        * changes its contents — one that appears at the same moment as its
        * message is not reliably announced. Same placement rules as
        * `CartToast`: clear of the bottom bar and the home indicator.
        */}
      {admin ? (
        <div
          role="status"
          aria-live="polite"
          className={
            "pointer-events-none fixed inset-x-0 z-60 flex justify-center px-4 " +
            "bottom-[calc(2.75rem+env(safe-area-inset-bottom)+1rem)] md:bottom-6"
          }
        >
          {created !== null ? (
            <p
              className={
                "pointer-events-auto rounded-full bg-[oklch(16%_0.045_282)] px-4 py-2 text-sm " +
                "text-on-deep ring-1 ring-gold-line shadow-raised " +
                "motion-safe:animate-[rise_140ms_ease-out]"
              }
            >
              {de.admin.created(created)}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
