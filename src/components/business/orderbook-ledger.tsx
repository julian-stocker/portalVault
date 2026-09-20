"use client";

/**
 * The Orderbuch ledger (ADR-0088).
 *
 * WHAT THE OWNER ASKED FOR, AND WHY THE FIRST ATTEMPT MISSED IT
 *
 * Fifteen purchases took fifteen large cards and reading one meant leaving the
 * page. This is the same data as a ledger: one line per purchase, expanded in
 * place.
 *
 * The first version said that and did not render it. Two structural mistakes,
 * both removed here rather than patched:
 *
 *   1. The column template lived in a Tailwind arbitrary utility
 *      (`sm:grid-cols-[6.5rem_3.5rem_…]`), which has to be scanned out of the
 *      source, generated, and delivered. Miss any link — a dev server that did
 *      not re-scan after the class was introduced is the usual one — and the
 *      element keeps `display:grid` with NO template, so seven columns become
 *      seven stacked lines. The template is now a declared rule in
 *      `globals.css` (`.ob-row`, `.ob-item`), shared by the header and every
 *      row, with nothing to discover.
 *
 *   2. That grid sat on a `<button>`. WebKit wraps button content in an
 *      anonymous box, so `display:grid` on a button has historically not laid
 *      its children out as grid items at all. The row is now a `<div>` that
 *      owns the grid, with a transparent button stretched across it — the
 *      whole row stays clickable and the disclosure semantics are unchanged.
 *
 * ITEMS ARE FETCHED WHEN A ROW OPENS. A collapsed ledger renders no item rows;
 * 561 today and 2 193 after 2026 is not a thing to render in order to hide.
 */
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";

import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";
import { bookPurchaseItem, loadPurchaseItems } from "@/lib/orderbook/actions";
import {
  canCheckIn, itemStatus, rowStatus,
  type LedgerRow as LedgerRowData, type LedgerSummary, type RowStatus,
} from "@/lib/orderbook/ledger";
import {
  LedgerExpansion, LedgerHead, LedgerItemHead, LedgerItemRow, LedgerRow, LedgerTable,
} from "./ledger-table";
import { RowMarks } from "./orderbook-nav";
import type { PurchaseItem } from "@/lib/orderbook/queries";

const copy = de.business.orderbook;

/*
 * THE FLOOR, AND WHY IT IS NOT THE MINIMUM.
 *
 * The seven ledger tracks need 38.5rem — 32.5rem of tracks, six 0.75rem
 * gaps, 0.75rem of row padding each side. Setting the floor there would be
 * arithmetically correct and wrong in practice: the EXPANDED row's `Figur`
 * track is `minmax(0, 1fr)`, so at 38.5rem it collects the 4.25rem nobody
 * else claimed — 68 pixels, which truncates almost every figure name.
 *
 * 44rem leaves `Figur` 9.75rem. It is the same floor the Verkauf item list
 * uses, and it is chosen for the flexible column rather than for the sum:
 * a table wide enough to fit is not the same as a table wide enough to read.
 */
const PURCHASE_MIN_WIDTH = "48rem";

const formatFactor = (factor: number | null): string =>
  factor === null ? "—" : factor.toLocaleString("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/*
 * A purchase with no date says so, in words.
 *
 * Every shortcut here produces something worse than a sentence: `new Date(null)`
 * is 01.01.1970, `new Date(undefined)` is `Invalid Date`, and an empty cell in
 * a tabular row reads as a rendering bug rather than as missing information.
 */
const formatDate = (iso: string | null): string =>
  iso === null
    ? copy.undated
    : new Date(iso).toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" });

/**
 * The status cell — and the ✓ is a claim now, not a decoration.
 *
 * ONE RULE: the tick appears if and only if a stock movement exists. A
 * historical row says `Historisch` in words and carries no tick at all,
 * because a ✓ in a column about inventory reads as "this is on the shelf
 * because I put it there" — which is false for 2 103 of the 2 114 imported
 * items and, since 0067, unanswered for the other eleven.
 *
 * `text` is what the cell shows, `title` the longer form behind it. They
 * differ only where the short form would not fit the track: a partly booked
 * purchase shows `3 von 14` and says `Teilweise eingebucht` on hover.
 */
function Status({ status, text, title }: {
  status: RowStatus; text: string; title: string;
}) {
  return (
    <span
      className={"truncate text-xs " + (status === "complete" ? "text-fg" : "text-muted")}
      title={title}
      aria-label={title}
    >
      {text}
    </span>
  );
}

/** Ausgaben · Marktwert · Faktor for a whole filtered set. */
function Summary({ summary }: { summary: LedgerSummary }) {
  const unvalued = summary.itemCount - summary.knownItems;
  const mark = summary.incomplete ? (
    <abbr className="ml-0.5 cursor-help no-underline" title={copy.incompleteTitle(unvalued)}>
      {copy.incompleteMark}
    </abbr>
  ) : null;

  return (
    <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {[
        { key: "count", label: copy.summary.count, value: summary.purchaseCount.toLocaleString("de-AT"),
          hint: copy.summary.countHint(summary.itemCount), mark: null },
        { key: "expenses", label: copy.summary.expenses, value: formatPrice(summary.totalCost),
          hint: null, mark: null },
        { key: "value", label: copy.summary.marketValue,
          value: summary.knownItems > 0 ? formatPrice(summary.knownValue) : "—",
          hint: null, mark },
        { key: "factor", label: copy.summary.factor, value: formatFactor(summary.factor),
          hint: null, mark: summary.factor === null ? null : mark },
      ].map((cell) => (
        <div key={cell.key} className="rounded-sky-md bg-surface/70 px-3 py-1.5 ring-1 ring-border/60">
          <dt className="text-xs leading-tight text-muted">{cell.label}</dt>
          <dd className="leading-tight tabular-nums">{cell.value}{cell.mark}</dd>
          {cell.hint ? <dd className="text-xs leading-tight text-muted">{cell.hint}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

/**
 * One physical item, one line.
 *
 * `.ob-item` is the same five-track grid the expanded header uses, and the
 * `Aktion` track exists whether or not a button is in it — so a historical row
 * and a bookable one line up instead of the columns shifting under each other.
 */
function ItemRow({ item, onCheckIn, pending }: {
  item: PurchaseItem;
  onCheckIn: (item: PurchaseItem) => void;
  pending: boolean;
}) {
  /*
   * Asked of the movement, not of the state — `itemStatus` explains why.
   * An open unit prints its own state (`Bestellt`, `Angekommen`,
   * `Beschädigt`, `Fehlt`), which says more than "not booked" and is the
   * vocabulary of the buttons that move it on.
   */
  const status = itemStatus(item);
  const text = status === "historical" ? copy.historicalLabel
    : status === "complete" ? copy.completeCell
    : copy.states[item.state as keyof typeof copy.states] ?? item.state;
  const title = status === "historical" ? copy.historicalHint
    : status === "complete" ? copy.completeLabel
    : status === "settled" ? copy.settleHint
    : text;

  return (
    <LedgerItemRow>
      <span className="tabular-nums text-xs text-muted">{item.position}</span>
      {/*
        Serie, from the canonical catalog. It replaced `· Excel: DRobot`, which
        spent the width on how the owner once typed a name and still left
        `Drobot` ambiguous between two games. The raw text stays in the
        database and stays on the correction screen, where it is the evidence
        being corrected — here it was only noise.

        A dash for a non-figure: a portal has no Skylanders series and
        inventing one would be worse than an empty cell.
      */}
      <span className="truncate text-xs text-muted">{item.seriesLabel ?? "—"}</span>
      {/* `truncate` is a last resort, not a strategy — the floor above is
          sized so it rarely fires. When it does, the full name is still
          reachable rather than gone. */}
      <span className="truncate" title={item.name}>{item.name}</span>
      <span className="text-right tabular-nums">
        {item.marketPrice === null ? "—" : formatPrice(item.marketPrice)}
      </span>
      <span className="text-center">
        <Status status={status} text={text} title={title} />
      </span>
      <span className="text-right">
        {canCheckIn(item) ? (
          <button type="button" disabled={pending} onClick={() => onCheckIn(item)}
                  className="min-h-9 rounded-sky-md px-2 text-xs ring-1 ring-border/70 disabled:opacity-50">
            {copy.book}
          </button>
        ) : null}
      </span>
    </LedgerItemRow>
  );
}

export function OrderbookLedger({
  purchases, summary, backHref,
}: {
  purchases: LedgerRowData[];
  summary: LedgerSummary;
  /** Where a detail page should return to, filters and search preserved. */
  backHref: string;
}) {
  /*
   * A search that found an item opens that purchase by itself — otherwise the
   * operator searches `Drobot`, gets four rows back, and has to open all four
   * to discover which one he meant.
   *
   * It is the INITIAL state, not an effect that corrects the state afterwards:
   * the page gives this component a `key` built from the filters and search, so
   * a new search is a new instance with the right rows already open.
   */
  const [open, setOpen] = useState<ReadonlySet<number>>(
    () => new Set(purchases.filter((p) => p.matchItems.length > 0).map((p) => p.id)));
  const [items, setItems] = useState<Record<number, PurchaseItem[] | "failed">>({});
  const [pending, startTransition] = useTransition();
  /* Which ids are in flight. A ref, because it must not cause a render. */
  const loading = useRef<Set<number>>(new Set());

  const load = useCallback((id: number) => {
    if (loading.current.has(id)) return;
    loading.current.add(id);
    // No synchronous "loading" write: an id with no entry IS loading, which
    // keeps this effect-safe and removes a state transition nobody reads.
    void loadPurchaseItems(id).then((result) => {
      loading.current.delete(id);
      setItems((current) => ({ ...current, [id]: result.ok ? result.items : "failed" }));
    });
  }, []);

  const toggle = (id: number) => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (!open.has(id)) load(id);
  };

  /* Fetch whatever the search opened for us. Reads state, never sets it. */
  useEffect(() => {
    for (const id of open) load(id);
    // Mount only: later expansions load through `toggle`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkIn = (item: PurchaseItem, purchaseId: number) => {
    startTransition(async () => {
      const result = await bookPurchaseItem(item.id, purchaseId);
      // Reloaded from the server: a tick that appeared before the database
      // agreed would be a claim about inventory that may be false.
      if (result.ok) load(purchaseId);
    });
  };

  if (purchases.length === 0) {
    return (
      <>
        <Summary summary={summary} />
        <p className="mt-6 text-sm text-muted">{copy.searchEmpty}</p>
      </>
    );
  }

  return (
    <>
      <Summary summary={summary} />

      {/*
        The ledger scrolls inside itself. Without this the page grows with the
        data — 85 purchases in 2026 would put the search box a full screen above
        the row it produced. `dvh` so a mobile browser's collapsing toolbar does
        not clip the last row.
      */}
      {/*
        No `columns` prop: seven tracks are the ledger default, so Einkauf
        renders from the rule's own fallback and has nothing of its own to
        deliver. Verkauf passes ten. The width is not optional, though —
        without it the columns have no floor to scroll against.
      */}
      <LedgerTable minWidth={PURCHASE_MIN_WIDTH}>
        <LedgerHead>
          <span>{copy.columns.date}</span>
          <span className="text-right">{copy.columns.items}</span>
          <span className="text-right">{copy.columns.expenses}</span>
          <span className="text-right">{copy.columns.marketValue}</span>
          <span className="text-right">{copy.columns.factor}</span>
          <span className="text-center">{copy.columns.progress}</span>
          <span />
        </LedgerHead>

        <ul className="divide-y divide-border/60">
          {purchases.map((purchase) => {
            const expanded = open.has(purchase.id);
            const status = rowStatus(purchase);
            const unvalued = purchase.itemCount - purchase.knownItems;
            const loaded = items[purchase.id];
            /*
             * Four states, four different things to say. `Eingebucht ✓` is
             * reserved for the one where every unit owns a movement.
             */
            const counted = `${purchase.bookedCount} von ${purchase.itemCount}`;
            const statusText = status === "historical" ? copy.historicalLabel
              : status === "complete" ? copy.completeCell
              : status === "settled" ? copy.closedLabel
              : status === "partial" ? counted
              : copy.openRowLabel;
            const statusLabel = status === "historical" ? copy.historicalHint
              : status === "complete" ? copy.completeLabel
              : status === "settled" ? copy.closedHint(purchase.bookedCount, purchase.settledCount)
              : status === "partial" ? `${copy.partialLabel} — ${counted}`
              : copy.openRowHint;

            return (
              <li key={purchase.id}>
                <LedgerRow expanded={expanded} controls={`purchase-${purchase.id}`}
                           onToggle={() => toggle(purchase.id)}
                           label={<>
                             {expanded ? copy.collapse : copy.expand} — {formatDate(purchase.purchasedAt)},{" "}
                             {formatPrice(purchase.totalCost)}, {statusLabel}
                           </>}>
                  {/*
                    The date cell carries the row's classification marks too.
                    They go inside it rather than in a column of their own: an
                    eighth track for something almost every row lacks would
                    cost every row the width (0063).
                  */}
                  <span className={purchase.purchasedAt === null
                                     ? "font-medium text-muted"
                                     : "font-medium tabular-nums"}
                        title={purchase.purchasedAt === null ? copy.undatedHint : undefined}>
                    {formatDate(purchase.purchasedAt)}
                    <RowMarks isTest={purchase.isTest} isIncomplete={purchase.isIncomplete}
                              isOpen={purchase.isOpen} />
                  </span>
                  <span className="text-right tabular-nums text-muted">{purchase.itemCount}</span>
                  <span className="text-right tabular-nums">{formatPrice(purchase.totalCost)}</span>
                  <span className="text-right tabular-nums text-muted">
                    {purchase.knownItems > 0 ? formatPrice(purchase.knownValue) : "—"}
                    {unvalued > 0 ? (
                      <abbr className="cursor-help no-underline" title={copy.incompleteTitle(unvalued)}>
                        {copy.incompleteMark}
                      </abbr>
                    ) : null}
                  </span>
                  <span className="text-right tabular-nums">{formatFactor(purchase.factor)}</span>
                  <span className="text-center"><Status status={status} text={statusText} title={statusLabel} /></span>
                  <span aria-hidden="true" className="text-center text-muted">{expanded ? "▴" : "▾"}</span>
                </LedgerRow>

                {purchase.matchItems.length > 0 ? (
                  <p className="truncate px-3 pb-1 text-xs text-muted">
                    {copy.matchCount(purchase.matchItems.length)}
                    {": "}
                    {purchase.matchItems.slice(0, 4).map((m) => `${m.position}. ${m.name}`).join(" · ")}
                  </p>
                ) : null}

                {expanded ? (
                  <LedgerExpansion id={`purchase-${purchase.id}`}>
                    <LedgerItemHead>
                      <span>#</span>
                      <span>{copy.itemColumns.series}</span>
                      <span>{copy.itemColumns.figure}</span>
                      <span className="text-right">{copy.columns.marketValue}</span>
                      <span className="text-center">{copy.itemColumns.status}</span>
                      <span className="text-right">{copy.itemColumns.action}</span>
                    </LedgerItemHead>

                    {loaded === undefined ? (
                      <p className="px-3 py-2 text-xs text-muted">{copy.loadingItems}</p>
                    ) : loaded === "failed" ? (
                      <p className="px-3 py-2 text-xs text-muted">{copy.itemsFailed}</p>
                    ) : (
                      <ul className="divide-y divide-border/40">
                        {loaded.map((item) => (
                          <ItemRow key={item.id} item={item} pending={pending}
                                   onCheckIn={(i) => checkIn(i, purchase.id)} />
                        ))}
                      </ul>
                    )}
                    <div className="px-3 pt-1.5">
                      <Link href={`/business/orderbuch/${purchase.id}?zurueck=${encodeURIComponent(backHref)}`}
                            className="text-xs text-muted underline underline-offset-2">
                        {copy.openDetail}
                      </Link>
                    </div>
                  </LedgerExpansion>
                ) : null}
              </li>
            );
          })}
        </ul>
      </LedgerTable>
    </>
  );
}
