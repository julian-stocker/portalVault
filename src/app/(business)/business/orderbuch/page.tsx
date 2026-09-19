/**
 * Orderbuch — Einkauf (ADR-0088, classification 0063).
 *
 * A workbench, not a list of cards. The operator opens this to find a parcel
 * among many, so the page is: the two tabs with the one creation action beside
 * them, a summary of what is currently in view, one line to search it, the
 * filters, and then the ledger itself in a scroll area of its own.
 *
 * WHY THE LEDGER SCROLLS INSIDE ITSELF. Fifteen purchases already ran past a
 * screen as cards; 2026 brings eighty-five. If the page grew with the data the
 * search box would sit a full screen above the row it produced.
 *
 * WHAT THE DEFAULT VIEW SHOWS. Normal business purchases — test purchases are
 * out of it, and so is their money. They are not hidden: the `Test` chip
 * carries their count and a line under the filters says where they went.
 */
import type { Metadata } from "next";
import Link from "next/link";

import { OrderbookLedger } from "@/components/business/orderbook-ledger";
import { OrderbookNav, StatusFilter } from "@/components/business/orderbook-nav";
import { de } from "@/lib/i18n/de";
import { parseStatus, rpcStatus, type OrderbookStatus } from "@/lib/orderbook/classification";
import { UNDATED, ledgerHref, normaliseSearch, parseYearFilter } from "@/lib/orderbook/ledger";
import { fetchLedger, fetchPurchaseYears } from "@/lib/orderbook/queries";

export const metadata: Metadata = { title: de.business.orderbook.title };

const copy = de.business.orderbook;
const MONTHS = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];

export default async function OrderbookPage({
  searchParams,
}: {
  searchParams: Promise<{ jahr?: string; monat?: string; q?: string; status?: string }>;
}) {
  const params = await searchParams;
  const year = parseYearFilter(params.jahr);
  const month = params.monat ? Number(params.monat) : undefined;
  const search = normaliseSearch(params.q ?? "");
  const status = parseStatus(params.status);

  const [ledger, years] = await Promise.all([
    fetchLedger(year, Number.isFinite(month) ? month : undefined, search ?? undefined,
                rpcStatus(status)),
    fetchPurchaseYears(),
  ]);

  const href = (y?: number | typeof UNDATED, m?: number) => ledgerHref(y, m, search, status);
  const statusHref = (s: OrderbookStatus) => ledgerHref(year, month, search, s);
  const here = ledgerHref(year, month, search, status);

  /* The one thing that can be created from this screen. */
  const newHref = status === "test"
    // Creating from inside the Test view lands the operator in a normal
    // purchase they would then have to re-classify, so the form is reached
    // with the box already ticked instead.
    ? "/business/orderbuch/neu?test=1"
    : "/business/orderbuch/neu";

  const empty = status === "unvollstaendig" ? copy.status.emptyIncomplete
    : status === "offen" ? copy.status.emptyOpen
    : status === "test" ? copy.status.emptyTest
    : copy.empty;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pt-6 pb-10 md:pt-8">
      <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{copy.title}</h1>

      {/* Einkäufe · Verkäufe · + Neu — one row, the same place on both pages. */}
      <OrderbookNav active="purchase" newHref={newHref} newLabel={copy.newPurchase} />

      {/*
        A plain GET form, so a search is a URL. That is what makes a result
        shareable, bookmarkable, reachable with the back button — and what lets
        the detail page carry the whole view home in one query parameter.
      */}
      <form method="get" action="/business/orderbuch" className="mt-4 flex flex-wrap items-center gap-2">
        {year ? <input type="hidden" name="jahr" value={year} /> : null}
        {month ? <input type="hidden" name="monat" value={month} /> : null}
        {status !== "alle" ? <input type="hidden" name="status" value={status} /> : null}
        <label htmlFor="orderbook-search" className="sr-only">{copy.search}</label>
        <input id="orderbook-search" type="search" name="q" defaultValue={search ?? ""}
               placeholder={copy.searchHint} autoComplete="off"
               className="min-h-11 w-full max-w-xs rounded-sky-md bg-surface px-3 text-sm ring-1 ring-border/70 sm:w-64" />
        <button type="submit" className="min-h-11 rounded-sky-md px-3 text-sm ring-1 ring-border/70">
          {copy.search}
        </button>
        {search ? (
          <Link href={ledgerHref(year, month, null, status)} className="min-h-11 px-2 py-2 text-xs text-muted underline underline-offset-2">
            {copy.searchClear}
          </Link>
        ) : null}
      </form>

      {/* The classification axis, on its own line above the calendar one. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
        <StatusFilter status={status} counts={ledger.counts} href={statusHref} hint />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <nav className="flex flex-wrap gap-1" aria-label={copy.columns.date}>
          <Link href={href()} className={`rounded-sky-md px-2 py-1 text-xs ring-1 ${!year ? "bg-surface ring-fg/40" : "ring-border/70 text-muted"}`}>
            {copy.allYears}
          </Link>
          {years.map((y) => (
            <Link key={y} href={href(y)}
                  className={`rounded-sky-md px-2 py-1 text-xs ring-1 ${year === y ? "bg-surface ring-fg/40" : "ring-border/70 text-muted"}`}>
              {y}
            </Link>
          ))}
          {/*
            A third state, not a year. An undated purchase belongs to no year,
            so it gets its own chip rather than being filed under one.
          */}
          <Link href={href(UNDATED)}
                className={`rounded-sky-md px-2 py-1 text-xs ring-1 ${year === UNDATED ? "bg-surface ring-fg/40" : "ring-border/70 text-muted"}`}>
            {copy.undatedFilter}
          </Link>
        </nav>
        {/* No month chips under "Ohne Datum": there is no date to be in a month of. */}
        {typeof year === "number" ? (
          <nav className="flex flex-wrap gap-1" aria-label={copy.allMonths}>
            <Link href={href(year)} className={`rounded-sky-md px-2 py-1 text-xs ring-1 ${!month ? "bg-surface ring-fg/40" : "ring-border/70 text-muted"}`}>
              {copy.allMonths}
            </Link>
            {MONTHS.map((name, i) => (
              <Link key={name} href={href(year, i + 1)}
                    className={`rounded-sky-md px-2 py-1 text-xs ring-1 ${month === i + 1 ? "bg-surface ring-fg/40" : "ring-border/70 text-muted"}`}>
                {name.slice(0, 3)}
              </Link>
            ))}
          </nav>
        ) : null}
      </div>

      {ledger.purchases.length === 0 && !search ? (
        <p className="mt-8 text-sm text-muted">{empty}</p>
      ) : (
        <OrderbookLedger key={here} purchases={ledger.purchases} summary={ledger.summary} backHref={here} />
      )}
    </main>
  );
}
