/**
 * One position's history: reconstruction and ledger as one grid table.
 *
 * FOUR COLUMNS, ALWAYS SIDE BY SIDE, ONE LINE PER ENTRY.
 *
 *   Datum | Buchung | Menge | Marktwert
 *
 * The grid is declared once and used by the head and by every row, so they
 * cannot drift. `minmax(0, 1fr)` on the booking is the column that gives:
 * a long label truncates instead of pushing the two numbers off a 390 px
 * screen. Nothing in a row wraps and nothing scrolls sideways — the two
 * earlier attempts let provenance wrap under the kind and a twelve-entry
 * history filled a screen.
 *
 * Provenance is one tap away instead, which is where a thing belongs that
 * is read once a month.
 *
 * OLDEST FIRST, PARKED AT THE BOTTOM. A ledger reads downwards, so the
 * newest entry is the last one — and that is the one the history is opened
 * for. Older entries are a scroll up.
 *
 * ○ reconstructed, ● booked. One mark and a word: two lists would suggest
 * two histories, a heavier treatment would suggest the reconstruction is
 * suspect. It is not suspect, it is reconstructed.
 *
 * NO RUNNING BALANCE. There is no "stock after" column and there must not
 * be: the reconstruction guarantees the end, not the path (ADR-0102). The
 * current number lives in the card and comes from `shop_inventory`.
 */
"use client";

import { useEffect, useRef, useState } from "react";

import { formatNumber, formatPrice } from "@/lib/format";
import type { LedgerEntry } from "@/lib/admin/stock-history";
import { de } from "@/lib/i18n/de";

const copy = de.inventory;

/**
 * The four tracks. Narrower on a phone, roomier from `sm` up — the same
 * four columns either way, never stacked.
 *
 *   mobile   64 | 1fr | 42 | 60
 *   desktop  90 | 1fr | 70 | 90
 */
const TRACKS =
  "grid grid-cols-[4rem_minmax(0,1fr)_2.625rem_3.75rem] " +
  "sm:grid-cols-[5.625rem_minmax(0,1fr)_4.375rem_5.625rem] gap-x-2";

/** ~220 px: seven rows of 30 px, and the eighth peeking. */
const VIEWPORT = "max-h-[13.75rem]";

/** `2026-03-23` → `23.03.26`. Narrow on purpose; the year is still there. */
function shortDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return year && month && day ? `${day}.${month}.${year.slice(2)}` : iso;
}

function kindLabel(entry: LedgerEntry): string {
  return entry.source === "legacy"
    ? copy.legacyKinds[entry.kind] ?? entry.kind
    : copy.reasons[entry.kind] ?? entry.kind;
}

/** Everything not worth a column. Null when there is nothing to tell. */
function detailOf(entry: LedgerEntry): string | null {
  const parts = [entry.sourceRef, entry.note].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function StockLedger({ entries }: { entries: readonly LedgerEntry[] }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<string | null>(null);

  /*
   * Park at the newest entry. Assigning `scrollTop` is what an effect is
   * for — pushing state into a node the browser owns — and `scrollHeight`
   * is only known once the rows are laid out.
   */
  useEffect(() => {
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [entries]);

  if (entries.length === 0) {
    return <p className="py-1.5 text-[11px] text-muted">{copy.noHistory}</p>;
  }

  return (
    <div className="text-[11px]">
      <div className={`${TRACKS} border-b border-border/25 pb-1 text-[10px] text-muted`}>
        <span>{copy.historyDate}</span>
        <span>{copy.historyBooking}</span>
        <span className="text-right">{copy.historyAmount}</span>
        <span className="text-right">{copy.historyValue}</span>
      </div>

      <div ref={scroller} className={`${VIEWPORT} overflow-y-auto overscroll-contain`}>
        {entries.map((entry) => {
          const legacy = entry.source === "legacy";
          const detail = detailOf(entry);
          const expanded = open === entry.key;
          return (
            <div key={entry.key}>
              {/*
                A button rather than a row with a handler: disclosure has to
                be reachable from the keyboard. A row with nothing to tell
                stays inert instead of offering an empty panel.
              */}
              <button
                type="button"
                disabled={detail === null}
                aria-expanded={detail === null ? undefined : expanded}
                onClick={() => setOpen(expanded ? null : entry.key)}
                className={
                  `${TRACKS} h-[30px] w-full items-center text-left ` +
                  (detail === null ? "cursor-default" : "hover:bg-border/20")
                }
              >
                <span className="truncate tabular-nums text-muted">{shortDate(entry.date)}</span>

                <span className="flex min-w-0 items-center gap-1">
                  <span aria-hidden="true" className={legacy ? "text-muted" : "text-foreground"}>
                    {legacy ? "○" : "●"}
                  </span>
                  <span className="truncate">
                    {kindLabel(entry)}
                    {legacy ? <span className="text-muted"> · {copy.historyLegacy}</span> : null}
                  </span>
                </span>

                <span
                  className={
                    "truncate text-right tabular-nums " +
                    (entry.quantity > 0 ? "text-foreground" : "text-muted")
                  }
                >
                  {entry.quantity > 0 ? "+" : "−"}
                  {formatNumber(Math.abs(entry.quantity))}
                </span>

                {/* NULL stays a dash. Today's market price is not a
                    historical one, and an operative movement stores none
                    at all (ADR-0102). */}
                <span className="truncate text-right tabular-nums text-muted">
                  {entry.marketValue === null ? copy.historyNoValue : formatPrice(entry.marketValue)}
                </span>
              </button>

              {expanded && detail !== null ? (
                <p className="pb-1.5 pl-[4.5rem] text-[10px] leading-snug text-muted sm:pl-[6.125rem]">
                  {detail}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      <p className="mt-1 text-[10px] leading-tight text-muted">{copy.historyHint}</p>
    </div>
  );
}
