/**
 * One stock draft per position, shared by every stepper that shows it
 * (Lagerverwaltung V2, 2026-11-10).
 *
 * WHY SHARED. The stock list renders a table row and a card for the same
 * position, and CSS shows one of them. Each had its own draft: +2 typed into
 * the card, the window widened, +1 typed into the table — and two unsaved
 * differences, measured from the same number, could both be saved. Now there
 * is one draft per position. Whichever view is visible shows it and saves it,
 * and the other shows the same number, because it reads the same entry.
 *
 * WHAT AN ENTRY HOLDS
 *
 *   base    the server quantity the draft was counted from
 *   draft   the number on screen
 *   state   "draft"   unsaved, may be saved
 *           "saving"  the movement is on its way — no second save
 *           "saved"   booked; waiting for the refresh to bring the new
 *                     quantity — still no second save
 *
 * An entry only counts while `base` equals the quantity the server last sent.
 * When the refresh brings a new number — after this save, or after a booking
 * somewhere else — the entry is stale and the draft is the server's number
 * again. That is derived while reading, not reset in an effect.
 *
 * NOTHING HERE WRITES TO THE DATABASE. Booking stays in `StockStepper`:
 * `bookMovement` → `record_inventory_movement()`, one movement per save.
 */
"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type DraftState = "draft" | "saving" | "saved";
export type DraftEntry = { base: number; draft: number; state: DraftState };

type Store = {
  get: (key: string) => DraftEntry | undefined;
  set: (key: string, entry: DraftEntry | null) => void;
};

const StockDrafts = createContext<Store | null>(null);

export function StockDraftProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Readonly<Record<string, DraftEntry>>>({});

  const set = useCallback((key: string, entry: DraftEntry | null) => {
    setEntries((current) => {
      const next = { ...current };
      if (entry === null) delete next[key];
      else next[key] = entry;
      return next;
    });
  }, []);

  const store = useMemo<Store>(() => ({ get: (key) => entries[key], set }), [entries, set]);
  return <StockDrafts.Provider value={store}>{children}</StockDrafts.Provider>;
}

/**
 * The draft of one position: shared inside a `StockDraftProvider`, local to
 * the stepper outside one — same behaviour either way.
 *
 * Returns the entry only while it still belongs to `quantity`.
 */
export function useStockDraft(
  key: string,
  quantity: number,
): [DraftEntry | null, (entry: DraftEntry | null) => void] {
  const shared = useContext(StockDrafts);
  const [local, setLocal] = useState<DraftEntry | null>(null);

  const entry = shared ? (shared.get(key) ?? null) : local;
  const live = entry !== null && entry.base === quantity ? entry : null;
  const write = useCallback(
    (next: DraftEntry | null) => (shared ? shared.set(key, next) : setLocal(next)),
    [shared, key],
  );
  return [live, write];
}
