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
 */
"use client";

import { useMemo, useState } from "react";

import { InventoryCard } from "@/components/admin/inventory-card";
import { StockDialog } from "@/components/admin/stock-dialog";
import { AdminThumb } from "@/components/admin/admin-thumb";
import { CONDITIONS, type Condition, type InventoryPosition, type Movement } from "@/lib/admin/inventory-model";
import { matchesQuery, normalizeForSearch } from "@/lib/catalog/search";
import type { CatalogFigure, SeriesOption } from "@/lib/catalog/types";
import { de } from "@/lib/i18n/de";
import { useRouter } from "next/navigation";

type Stock = "all" | "in" | "out";
type Listing = "all" | "listed" | "unlisted";

export function InventoryView({
  positions,
  movements,
  catalog,
  series,
  outsideScope,
}: {
  positions: readonly InventoryPosition[];
  /** Movements per position id, loaded once by the page. */
  movements: Readonly<Record<number, Movement[]>>;
  /** The operational range: active collectible figures (ADR-0029, ADR-0039). */
  catalog: readonly CatalogFigure[];
  series: readonly SeriesOption[];
  /** Historical positions on something outside that range. Counted, not listed. */
  outsideScope: number;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [seriesCode, setSeriesCode] = useState("");
  const [stock, setStock] = useState<Stock>("all");
  const [listing, setListing] = useState<Listing>("all");
  const [opening, setOpening] = useState<{ figure: CatalogFigure; condition: Condition } | null>(
    null,
  );

  const normalized = normalizeForSearch(query);
  const searching = query.trim() !== "";

  const visible = useMemo(
    () =>
      positions.filter((position) => {
        const figure = position.figure;
        if (seriesCode && figure?.seriesCode !== seriesCode) return false;
        if (stock === "in" && position.available <= 0) return false;
        if (stock === "out" && position.available > 0) return false;
        if (listing === "listed" && !position.isListed) return false;
        if (listing === "unlisted" && position.isListed) return false;
        if (!searching) return true;
        // The figure's own search index covers every spelling of the name,
        // the canonical one included; the SKY-ID is matched directly.
        return (
          (figure !== null && matchesQuery(figure, normalized)) ||
          position.skyId.toLowerCase().includes(query.trim().toLowerCase())
        );
      }),
    [positions, seriesCode, stock, listing, searching, normalized, query],
  );

  /**
   * Figures the search found that have no position for a condition yet.
   *
   * Only while searching: this is the way into stock, not a list of 561
   * things you do not own.
   */
  const openable = useMemo(() => {
    if (!searching) return [];
    const held = new Set(positions.map((position) => `${position.skyId}:${position.condition}`));
    return catalog
      .filter(
        (figure) =>
          matchesQuery(figure, normalized) ||
          figure.skyId.toLowerCase().includes(query.trim().toLowerCase()),
      )
      .flatMap((figure) =>
        CONDITIONS.filter((condition) => !held.has(`${figure.skyId}:${condition}`)).map(
          (condition) => ({ figure, condition }),
        ),
      )
      .slice(0, 12);
  }, [searching, positions, catalog, normalized, query]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <label className="sr-only" htmlFor="inventory-search">
          {de.inventory.searchLabel}
        </label>
        <input
          id="inventory-search"
          type="search"
          inputMode="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={de.inventory.searchLabel}
          className="min-h-12 w-full rounded-sky-md bg-surface/80 px-4 text-base ring-1 ring-border/70 focus:ring-border-strong"
        />

        <div className="flex flex-wrap gap-2">
          <select
            aria-label={de.inventory.seriesAll}
            value={seriesCode}
            onChange={(event) => setSeriesCode(event.target.value)}
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
            onChange={(event) => setStock(event.target.value as Stock)}
            className="min-h-10 rounded-sky-md bg-surface/80 px-3 text-sm ring-1 ring-border/70"
          >
            <option value="all">{de.inventory.stockAll}</option>
            <option value="in">{de.inventory.stockIn}</option>
            <option value="out">{de.inventory.stockOut}</option>
          </select>

          <select
            aria-label={de.inventory.listingFilter}
            value={listing}
            onChange={(event) => setListing(event.target.value as Listing)}
            className="min-h-10 rounded-sky-md bg-surface/80 px-3 text-sm ring-1 ring-border/70"
          >
            <option value="all">{de.inventory.listingAll}</option>
            <option value="listed">{de.inventory.listingOn}</option>
            <option value="unlisted">{de.inventory.listingOff}</option>
          </select>
        </div>

        <p className="text-sm text-muted" aria-live="polite">
          {de.inventory.positions(visible.length)}
          {outsideScope > 0 ? ` · ${de.inventory.outsideScope(outsideScope)}` : ""}
        </p>
      </div>

      {visible.length === 0 && openable.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-sky-lg bg-surface/70 px-4 py-10 text-center ring-1 ring-border/70">
          <p className="font-medium">{de.inventory.empty}</p>
          <p className="text-sm text-muted">{de.inventory.emptyHint}</p>
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        {visible.map((position) => (
          <InventoryCard
            key={position.inventoryId}
            position={position}
            movements={movements[position.inventoryId] ?? []}
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
                    <AdminThumb file={figure.imageFile} name={figure.displayName} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{figure.displayName}</p>
                      <p className="text-[11px] text-muted">
                        <span className="font-mono">{figure.skyId}</span> ·{" "}
                        {condition === "loose"
                          ? de.inventory.conditionLoose
                          : de.inventory.conditionBoxed}{" "}
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
  );
}
