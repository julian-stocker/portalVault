/**
 * The stock list, with the search that opens new positions.
 *
 * Two jobs in one page, because they are one job in practice: what is in
 * stock, and putting something into stock that is not there yet. A figure
 * without a position is found by the same search and gets its position from
 * the first movement — no empty rows for 561 figures, and no separate
 * "create position" screen that would have to invent one anyway.
 *
 * Filtering happens here, on data the page already loaded. The catalog does
 * the same (ADR-0026) and the amounts are far smaller.
 *
 * LAGERVERWALTUNG V2.
 *
 *   - THE FILTERS LIVE IN THE ADDRESS (`?q=`, `?serie=`, `?bestand=`,
 *     `?shop=`, `?art=`, `?status=`), read and written by the pure functions
 *     in `inventory-filter.ts`. A filtered list is a link; Back undoes the
 *     last filter. Written with the browser's history API, which Next keeps
 *     in sync with `useSearchParams` — no server round trip, the page does
 *     not reload 600 catalog rows for a changed select.
 *   - TABLE FROM `md:`, CARDS BELOW, CHOSEN BY CSS (corrected 2026-11-10).
 *     The first version chose in JavaScript (`matchMedia` after hydration):
 *     the server sent cards, and a wide screen only switched once the page
 *     was hydrated — a visible jump at best, the cards for good if the
 *     scripts never ran. Now both are in the markup and CSS shows one; the
 *     server's HTML is already right at every width.
 *
 *     Still only one operable copy: the hidden one is `display: none`, which
 *     can be neither clicked nor focused nor read out, and the table holds no
 *     editor until a row is opened — which a hidden row cannot be.
 *   - ONE STOCK DRAFT PER POSITION (`StockDraftProvider`). Table row, its
 *     inline editor and the card read and write the same draft, so a
 *     breakpoint change can never leave two unsaved differences for one
 *     position, and whichever view saves, it saves once.
 */
"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { InventoryCard } from "@/components/admin/inventory-card";
import { InventoryTable } from "@/components/admin/inventory-table";
import { StockDialog } from "@/components/admin/stock-dialog";
import { StockDraftProvider } from "@/components/admin/stock-drafts";
import { AdminThumb } from "@/components/admin/admin-thumb";
import {
  OPERATIVE_CONDITION, type Condition, type InventoryPosition,
} from "@/lib/admin/inventory-model";
import {
  NO_FILTERS, STATUS_FILTERS, filtersFromParams, filtersToQuery, hasActiveFilters, kindsInStock,
  visiblePositions,
  type InventoryFilters, type KindFilter, type ListingFilter, type StatusFilter, type StockFilter,
} from "@/lib/admin/inventory-filter";
import { positionKey } from "@/lib/admin/position-key";
import type { TradeTotals } from "@/lib/admin/stock-history";
import { InventoryOverviewPanel } from "@/components/admin/inventory-overview";
import { inventoryOverview } from "@/lib/admin/inventory-overview";
import { matchesQuery, normalizeForSearch } from "@/lib/catalog/search";
import type { CatalogFigure, SeriesOption } from "@/lib/catalog/types";
import { imageSrc } from "@/lib/catalog/image";
import { de } from "@/lib/i18n/de";
import { useRouter } from "next/navigation";

/** The label of a status filter value: a group word or the kind's label. */
function statusFilterLabel(value: Exclude<StatusFilter, "all">): string {
  if (value === "action") return de.inventory.statusGroupAction;
  if (value === "fix") return de.inventory.statusGroupFix;
  return de.inventory.status[value].label;
}

export function InventoryView({
  positions,
  legacyTotals,
  tradeTotals,
  catalog,
  accessories,
  series,
  outsideScope,
  percentage,
}: {
  positions: readonly InventoryPosition[];
  /** Reconstructed 2026 totals per `SKY-ID:condition` (ADR-0102). */
  legacyTotals: Readonly<Record<string, TradeTotals>>;
  /**
   * Lifetime operative totals per inventory id (0086).
   *
   * Complete aggregates, both of them. No movement list reaches this
   * component any more — a card fetches its own timeline when opened.
   */
  tradeTotals: Readonly<Record<number, TradeTotals>>;
  /** The operational range: active collectible figures (ADR-0029, ADR-0039). */
  catalog: readonly CatalogFigure[];
  /**
   * Die nicht sammelbaren Zeilen derselben Tabelle (ADR-0128) — Spiele,
   * Portale, Bundles, Zubehör.
   *
   * GETRENNT ÜBERGEBEN UND NICHT EINGEMISCHT. `catalog` ist der
   * Sammlerkatalog und bleibt es; was aus ihm folgt — der Fortschritt, die
   * Variantenregel, der öffentliche Katalog — darf von dieser Liste nichts
   * mitbekommen. Gebraucht wird sie an genau zwei Stellen: um eine
   * Lagerposition benennen zu können, und um für ein Zubehörteil ohne
   * Position eine anlegen zu können.
   */
  accessories: readonly CatalogFigure[];
  series: readonly SeriesOption[];
  /** Historical positions on something outside that range. Counted, not listed. */
  outsideScope: number;
  /** The shop-wide price percentage, shown on every card (ADR-0045). */
  percentage: number;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [opening, setOpening] = useState<{ figure: CatalogFigure; condition: Condition } | null>(
    null,
  );

  /*
   * Die Arten nur anbieten, die wirklich im Lager liegen (ADR-0128) — und
   * eine Art aus der Adresse, die es im Lager nicht gibt, gilt als „alle":
   * sonst filterte ein Feld, das gar nicht angezeigt wird.
   */
  const kinds = useMemo(() => kindsInStock(positions), [positions]);

  /* What the address says — unknown words already mean "all". */
  const fromUrl = useMemo(() => filtersFromParams(params), [params]);
  const seriesCode = series.some((option) => option.code === fromUrl.seriesCode)
    ? fromUrl.seriesCode : "";
  const stock: StockFilter = fromUrl.stock;
  const listing: ListingFilter = fromUrl.listing;
  const kind: KindFilter = fromUrl.kind !== "all" && kinds.includes(fromUrl.kind) ? fromUrl.kind : "all";
  const status: StatusFilter = fromUrl.status;

  /*
   * THE SEARCH FIELD KEEPS ITS OWN TEXT while typing — the address stores it
   * trimmed, and a field fed back from there would eat the space before the
   * next word. When the address changes from outside (Back, a link, reset),
   * the field follows.
   */
  const [query, setQuery] = useState(fromUrl.query);
  const [seenQuery, setSeenQuery] = useState(fromUrl.query);
  if (seenQuery !== fromUrl.query) {
    setSeenQuery(fromUrl.query);
    if (fromUrl.query !== query.trim()) setQuery(fromUrl.query);
  }

  /**
   * Write filters to the address. `push` for a choice, so Back undoes it;
   * `replace` while typing, so Back does not step through every letter.
   */
  function navigate(next: InventoryFilters, mode: "push" | "replace") {
    const search = filtersToQuery(next);
    const url = search === "" ? window.location.pathname : `?${search}`;
    if (mode === "push") window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  }

  const normalized = normalizeForSearch(query);
  const searching = query.trim() !== "";

  /*
   * DIE REGEL STEHT IN `inventory-filter.ts`, nicht hier.
   *
   * Fünf Bedingungen, die zusammenwirken, sind genau die Art Logik, die man
   * einzeln nachfahren will — „ein Portal mit Bestand, Serie SF, nicht im
   * Shop" ist eine Frage mit einer Antwort. In diesem `useMemo` ließe sie
   * sich nur über den Quelltext behaupten; dort lässt sie sich prüfen, ohne
   * Browser und ohne Datenbank (`inventory-filter.test.ts`).
   */
  const filters: InventoryFilters = useMemo(
    () => ({ query, seriesCode, stock, listing, kind, status }),
    [query, seriesCode, stock, listing, kind, status],
  );
  const visible = useMemo(() => visiblePositions(positions, filters), [positions, filters]);
  const choose = (over: Partial<InventoryFilters>) => navigate({ ...filters, ...over }, "push");

  /**
   * Figures the search found that have no position for a condition yet.
   *
   * Only while searching: this is the way into stock, not a list of 561
   * things you do not own.
   */
  const openable = useMemo(() => {
    if (!searching) return [];
    const held = new Set(positions.map((position) => `${position.skyId}:${position.condition}`));
    /*
     * FIGUREN UND ZUBEHÖR, beide suchbar (ADR-0128). Ein Portal, das nicht
     * über das Einkaufsbuch kam, braucht denselben Weg ins Lager wie eine
     * Figur: suchen, Position anlegen, buchen. `record_inventory_movement()`
     * fragt nur den Zustand, und `lose` ist er.
     */
    return [...catalog, ...accessories]
      .filter(
        (figure) =>
          matchesQuery(figure, normalized) ||
          figure.skyId.toLowerCase().includes(query.trim().toLowerCase()),
      )
      /*
       * NUR DIE OPERATIVE POSITION (0108). Vorher stand hier
       * `CONDITIONS.filter(...)`, und die Übersicht bot deshalb für jede
       * Figur ZWEI neue Positionen an — Lose und OVP. So sind die acht
       * OVP-Zeilen auf Staging entstanden.
       *
       * Seit 0108 weist `record_inventory_movement()` jede andere Condition
       * ab. Ein Knopf, von dem schon bekannt ist, dass die Datenbank ihn
       * ablehnt, ist keine Auswahl, sondern eine Falle.
       */
      .filter((figure) => !held.has(`${figure.skyId}:${OPERATIVE_CONDITION}`))
      .map((figure) => ({ figure, condition: OPERATIVE_CONDITION as Condition }))
      .slice(0, 12);
  }, [searching, positions, catalog, accessories, normalized, query]);

  /*
   * Die Kennzahlen über der Suche (V4.9).
   *
   * Aus GENAU DEN ZEILEN, die diese Ansicht ohnehin hält — keine zweite
   * Abfrage, kein Aufruf je Position. `positions` ist die operative Liste
   * (`shop_inventory` über `admin_shop_inventory()`), und sie ist die
   * aktuelle Bestandswahrheit; nichts hier summiert Bewegungen nach oder
   * liest eine historische Zahl.
   *
   * Bewusst NICHT gefiltert: die Übersicht beschreibt das Lager, nicht die
   * gerade sichtbare Auswahl. Eine Zahl, die sich beim Tippen in der Suche
   * ändert, wäre keine Kennzahl mehr.
   */
  const overview = useMemo(() => inventoryOverview(positions), [positions]);

  return (
    <StockDraftProvider>
    <div className="flex flex-col gap-5">
      <InventoryOverviewPanel overview={overview} />

      <div className="flex flex-col gap-3">
        <label className="sr-only" htmlFor="inventory-search">
          {de.inventory.searchLabel}
        </label>
        <input
          id="inventory-search"
          type="search"
          inputMode="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            navigate({ ...filters, query: event.target.value }, "replace");
          }}
          placeholder={de.inventory.searchLabel}
          className="min-h-12 w-full rounded-sky-md bg-surface/80 px-4 text-base ring-1 ring-border/70 focus:ring-border-strong"
        />

        <div className="flex flex-wrap gap-2">
          <select
            aria-label={de.inventory.seriesAll}
            value={seriesCode}
            onChange={(event) => choose({ seriesCode: event.target.value })}
            className="min-h-10 rounded-sky-md bg-surface/80 px-3 text-sm ring-1 ring-border/70"
          >
            <option value="">{de.inventory.seriesAll}</option>
            {series.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            aria-label={de.inventory.stockFilter}
            value={stock}
            onChange={(event) => choose({ stock: event.target.value as StockFilter })}
            className="min-h-10 rounded-sky-md bg-surface/80 px-3 text-sm ring-1 ring-border/70"
          >
            <option value="all">{de.inventory.stockAll}</option>
            <option value="in">{de.inventory.stockIn}</option>
            <option value="out">{de.inventory.stockOut}</option>
          </select>

          <select
            aria-label={de.inventory.listingFilter}
            value={listing}
            onChange={(event) => choose({ listing: event.target.value as ListingFilter })}
            className="min-h-10 rounded-sky-md bg-surface/80 px-3 text-sm ring-1 ring-border/70"
          >
            <option value="all">{de.inventory.listingAll}</option>
            <option value="listed">{de.inventory.listingOn}</option>
            <option value="unlisted">{de.inventory.listingOff}</option>
          </select>

          {/*
            DIE ART — nur wenn es mehr als eine gibt (ADR-0128).
            Liegen ausschliesslich Figuren im Lager, waere dieses Feld ein
            Auswahlfeld mit einer Auswahl. Es erscheint also mit dem ersten
            Spiel und verschwindet mit dem letzten; es steht am Ende der
            Reihe, weil Serie und Bestand die haeufigeren Fragen sind, und es
            bricht auf dem Telefon mit den anderen drei um.
          */}
          {kinds.length > 1 ? (
            <select
              aria-label={de.inventory.kindFilter}
              value={kind}
              onChange={(event) => choose({ kind: event.target.value as KindFilter })}
              className="min-h-10 rounded-sky-md bg-surface/80 px-3 text-sm ring-1 ring-border/70"
            >
              <option value="all">{de.inventory.kindAll}</option>
              {kinds.map((value) => (
                <option key={value} value={value}>
                  {de.inventory.kinds[value]}
                </option>
              ))}
            </select>
          ) : null}

          {/*
            DER SHOPSTATUS (Lagerverwaltung V2). Die zwei Sammelgruppen
            zuerst — „Handlungsbedarf" ist die Frage, mit der man die Seite
            öffnet —, dann jede Art aus `positionStatus()`.
          */}
          <select
            aria-label={de.inventory.statusFilter}
            value={status}
            onChange={(event) => choose({ status: event.target.value as StatusFilter })}
            className="min-h-10 rounded-sky-md bg-surface/80 px-3 text-sm ring-1 ring-border/70"
          >
            <option value="all">{de.inventory.statusAll}</option>
            {STATUS_FILTERS.map((value) => (
              <option key={value} value={value}>{statusFilterLabel(value)}</option>
            ))}
          </select>

          {hasActiveFilters(filters) ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                navigate(NO_FILTERS, "push");
              }}
              className="min-h-10 rounded-sky-md px-3 text-sm text-muted underline underline-offset-2 hover:text-foreground"
            >
              {de.inventory.filterReset}
            </button>
          ) : null}
        </div>

        <p className="text-sm text-muted" aria-live="polite">
          {de.inventory.positions(visible.length)}
          {/*
            Zubehör getrennt ausgewiesen, und zwar aus der UNGEFILTERTEN
            Liste: der Satz beschreibt das Lager, nicht die gerade sichtbare
            Auswahl — wie die Kennzahlen darüber. Nur wenn es welches gibt.
          */}
          {overview.accessoryPositions > 0
            ? ` · ${de.inventory.accessoryStock(
                overview.accessoryPositions, overview.accessoryPieces)}`
            : ""}
          {outsideScope > 0 ? ` · ${de.inventory.outsideScope(outsideScope)}` : ""}
        </p>
      </div>

      {visible.length === 0 && openable.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-sky-lg bg-surface/70 px-4 py-10 text-center ring-1 ring-border/70">
          <p className="font-medium">{de.inventory.empty}</p>
          <p className="text-sm text-muted">{de.inventory.emptyHint}</p>
        </div>
      ) : null}

      {visible.length > 0 ? (
        <div className="hidden md:block">
          <InventoryTable
            positions={visible}
            legacyTotals={legacyTotals}
            tradeTotals={tradeTotals}
            percentage={percentage}
          />
        </div>
      ) : null}
      <div className="grid gap-3 md:hidden">
        {visible.map((position) => (
          <InventoryCard
            key={position.inventoryId}
            position={position}
            legacyTotals={legacyTotals[positionKey(position.skyId, position.condition)]}
            tradeTotals={tradeTotals[position.inventoryId]}
            percentage={percentage}
          />
        ))}
      </div>

      {openable.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted">{de.inventory.newPosition}</h2>
          <div className="grid gap-2 lg:grid-cols-2">
            {openable.map(({ figure, condition }) => {
              const open =
                opening?.figure.skyId === figure.skyId && opening.condition === condition;
              return (
                <div
                  key={`${figure.skyId}:${condition}`}
                  className="flex flex-col gap-2 rounded-sky-md bg-surface/60 p-3 ring-1 ring-border/50"
                >
                  <div className="flex items-center gap-3">
                    <AdminThumb src={imageSrc(figure)} name={figure.displayName} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{figure.displayName}</p>
                      <p className="text-[11px] text-muted">
                        <span className="font-mono">{figure.skyId}</span> ·{" "}
                        {/* Immer die operative Position — siehe `openable`. */}
                        {de.inventory.conditionLoose}{" "}
                        · {de.inventory.noPositions}
                      </p>
                    </div>
                    {!open ? (
                      <button
                        type="button"
                        onClick={() => setOpening({ figure, condition })}
                        className="min-h-9 shrink-0 rounded-sky-md bg-surface px-3 text-xs font-medium ring-1 ring-border-strong"
                      >
                        {de.inventory.changeStock}
                      </button>
                    ) : null}
                  </div>
                  {open ? (
                    /* The position is created by its first movement — no
                       empty rows, and the opening balance is a booking like
                       any other (ADR-0037). */
                    <StockDialog
                      skyId={figure.skyId}
                      condition={condition}
                      quantity={0}
                      reserved={0}
                      onDone={() => {
                        setOpening(null);
                        router.refresh();
                      }}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
    </StockDraftProvider>
  );
}
