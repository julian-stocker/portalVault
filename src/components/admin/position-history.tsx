/**
 * Where the number came from — a position's history, on request.
 *
 * Shared by the mobile card and the desktop table's details.
 *
 * BOTH SOURCES ARE FETCHED ON FIRST OPEN, NOT WITH THE PAGE. 2 671
 * reconstructed rows sit across 600 positions, and the operative ledger grows
 * for as long as the shop runs. Only an opened position shows its history, so
 * only an opened position pays for it — one round trip for both sources
 * (`loadCardHistory`).
 *
 * The counters "Eingekauft"/"Verkauft" are NOT built from this list and must
 * never be: it is capped, they are complete aggregates (0086).
 *
 * READ-ONLY, AND STRUCTURALLY SO. Movements are append-only and legacy events
 * are too. A wrong booking is answered with a correction, never an edit. The
 * history of an OVP row stays readable — 0108 closes write paths only.
 */
"use client";

import { useState } from "react";

import { StockLedger } from "@/components/admin/stock-ledger";
import type { InventoryPosition } from "@/lib/admin/inventory-model";
import { loadCardHistory } from "@/lib/admin/legacy-actions";
import { mergeHistory, type CardHistory, type LedgerEntry } from "@/lib/admin/stock-history";
import { de } from "@/lib/i18n/de";

const copy = de.inventory;

export function PositionHistory({ position }: { position: InventoryPosition }) {
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<CardHistory | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  function toggleHistory() {
    const next = !showHistory;
    setShowHistory(next);
    if (!next || history !== null || loadingHistory) return;
    setLoadingHistory(true);
    void loadCardHistory(position.skyId, position.condition, position.inventoryId)
      .then(setHistory)
      .catch(() => setHistory({ legacy: [], movements: [] }))
      .finally(() => setLoadingHistory(false));
  }

  const entries: LedgerEntry[] = mergeHistory(
    history?.legacy ?? [],
    history?.movements ?? [],
  );

  return (
    <div className="border-t border-border/30 pt-1.5">
      <button
        type="button"
        onClick={toggleHistory}
        aria-expanded={showHistory}
        className="flex w-full items-baseline justify-between gap-2 text-xs text-muted hover:text-foreground"
      >
        <span className="flex items-baseline gap-1.5">
          <span aria-hidden="true" className="text-[10px]">{showHistory ? "▴" : "▾"}</span>
          {copy.history}
        </span>
        {/* Only once the history has arrived: before that there is
            nothing to count, and a zero that jumps is worse than none. */}
        {history !== null ? (
          <span className="text-[11px] tabular-nums">{copy.historyCount(entries.length)}</span>
        ) : null}
      </button>

      {showHistory ? (
        <div className="mt-1.5">
          {loadingHistory && history === null ? (
            <p className="px-1 py-2 text-xs text-muted">{copy.historyLoading}</p>
          ) : (
            <StockLedger entries={entries} />
          )}
        </div>
      ) : null}
    </div>
  );
}
