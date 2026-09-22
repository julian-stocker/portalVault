/**
 * Orderbuch — Verkauf (ADR-0089, classification 0063).
 *
 * The same workbench as Einkauf, over the other half of the ledger: the tabs
 * with the one creation action beside them, a summary of what is in view, one
 * line to search it, the filters, then the rows in their own scroll area.
 *
 * TWO AXES, NOT ONE ROW OF TABS.
 *
 *   Intern | Extern              WHERE the sale happened. A channel.
 *   Alle | Unvollständig | Test  WHAT KIND of record it is.
 *
 * They are independent, so they are two compact filter rows rather than five
 * tabs in a line: `Intern` + `Test` is an ordinary view and so is `Extern` +
 * `Unvollständig`. Extern is the default because it is the half with work in
 * it — internal sales register themselves and need reading, not doing.
 *
 * `+ Neu` appears under Extern and nowhere else. An internal sale exists
 * because an order was paid; there is nothing here to create.
 */
import type { Metadata } from "next";
import Link from "next/link";

import { OrderbookNav, StatusFilter } from "@/components/business/orderbook-nav";
import { SalesLedger } from "@/components/business/sales-ledger";
import { de } from "@/lib/i18n/de";
import { parseStatus, rpcStatus, type OrderbookStatus } from "@/lib/orderbook/classification";
import { normaliseSearch, parseYearFilter, UNDATED } from "@/lib/orderbook/ledger";
import { fetchSaleYears, fetchSales } from "@/lib/orderbook/sales-queries";
import { parseScope, salesHref, SALE_SCOPES } from "@/lib/orderbook/sales-view";

export const metadata: Metadata = { title: de.business.sales.title };

const copy = de.business.sales;
const book = de.business.orderbook;
const MONTHS = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];

export default async function SalesPage({ searchParams }: {
  searchParams: Promise<{ bereich?: string; jahr?: string; monat?: string; q?: string;
                          status?: string; verkauf?: string }>;
}) {
  const params = await searchParams;
  /*
   * `?verkauf=` öffnet einen Verkauf sofort im vorhandenen Fenster.
   *
   * Das Anlegen-Formular schickt hierher statt auf die eigene Detailseite:
   * eine Oberfläche für denselben Zweck reicht. Die Route `/verkauf/[id]`
   * bleibt für Direktaufrufe bestehen.
   */
  const openSale = Number.isFinite(Number(params.verkauf)) && Number(params.verkauf) > 0
    ? Number(params.verkauf) : undefined;
  const scope = parseScope(params.bereich);
  const year = parseYearFilter(params.jahr);
  const month = params.monat ? Number(params.monat) : undefined;
  const search = normaliseSearch(params.q ?? "");
  const status = parseStatus(params.status);

  const [ledger, years] = await Promise.all([
    fetchSales(scope, year === UNDATED ? "ohne" : year,
               Number.isFinite(month) ? month : undefined, search ?? undefined,
               rpcStatus(status)),
    fetchSaleYears(),
  ]);

  const href = (y?: number | "ohne", m?: number) => salesHref(scope, y, m, search, status);
  const statusHref = (s: OrderbookStatus) =>
    salesHref(scope, year === UNDATED ? "ohne" : year, month, search, s);
  const here = salesHref(scope, year === UNDATED ? "ohne" : year, month, search, status);
  const chip = (active: boolean) =>
    `rounded-sky-md px-2 py-1 text-xs ring-1 ${active ? "bg-surface ring-fg/40" : "ring-border/70 text-muted"}`;

  /*
   * THE ONE PLACE THAT DECIDES WHETHER ANYTHING MAY BE CREATED HERE.
   *
   * Null under `Intern`, so `OrderbookNav` renders no action at all — not a
   * disabled one. The database would refuse the `skyisles` channel anyway
   * (`seller_create_sale`), and a button whose only outcome is an error
   * message teaches the operator that the door exists.
   */
  const newHref = scope === "extern"
    ? (status === "test" ? "/business/orderbuch/verkauf/neu?test=1" : "/business/orderbuch/verkauf/neu")
    : null;

  const empty = status === "unvollstaendig" ? book.status.emptyIncomplete
    : status === "offen" ? book.status.emptyOpen
    : status === "test" ? book.status.emptyTest
    : copy.empty;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pt-6 pb-10 md:pt-8">
      <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{book.title}</h1>

      {/* Einkäufe · Verkäufe · + Neu — one row, the same place on both pages. */}
      <OrderbookNav active="sale" newHref={newHref} newLabel={copy.newSale} />

      {/* Intern | Extern — a channel filter over one domain, not a second system. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
        <nav className="flex flex-wrap gap-1" aria-label={copy.tabs.external}>
          {SALE_SCOPES.map((s) => (
            <Link key={s} href={salesHref(s, year === UNDATED ? "ohne" : year, month, search, status)}
                  className={chip(scope === s)}>
              {s === "intern" ? copy.tabs.internal : copy.tabs.external}
            </Link>
          ))}
        </nav>
        <span aria-hidden="true" className="text-border">|</span>
        {/* …and the classification axis beside it, on the same line when it fits. */}
        <StatusFilter status={status} counts={ledger.counts} href={statusHref} hint />
      </div>

      {scope === "intern" ? (
        <p className="mt-1 text-xs text-muted">{copy.internalNoCreate}</p>
      ) : null}

      <form method="get" action="/business/orderbuch/verkauf" className="mt-4 flex flex-wrap items-center gap-2">
        {scope !== "extern" ? <input type="hidden" name="bereich" value={scope} /> : null}
        {year !== undefined ? <input type="hidden" name="jahr" value={String(year)} /> : null}
        {month && year !== UNDATED ? <input type="hidden" name="monat" value={month} /> : null}
        {status !== "alle" ? <input type="hidden" name="status" value={status} /> : null}
        <label htmlFor="sales-search" className="sr-only">{book.search}</label>
        <input id="sales-search" type="search" name="q" defaultValue={search ?? ""}
               placeholder={book.searchHint} autoComplete="off"
               className="min-h-11 w-full max-w-xs rounded-sky-md bg-surface px-3 text-sm ring-1 ring-border/70 sm:w-64" />
        <button type="submit" className="min-h-11 rounded-sky-md px-3 text-sm ring-1 ring-border/70">
          {book.search}
        </button>
        {search ? (
          <Link href={salesHref(scope, year === UNDATED ? "ohne" : year, month, null, status)}
                className="min-h-11 px-2 py-2 text-xs text-muted underline underline-offset-2">
            {book.searchClear}
          </Link>
        ) : null}
      </form>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <nav className="flex flex-wrap gap-1" aria-label={copy.columns.date}>
          <Link href={href()} className={chip(year === undefined)}>{book.allYears}</Link>
          {years.map((y) => (
            <Link key={y} href={href(y)} className={chip(year === y)}>{y}</Link>
          ))}
          <Link href={href("ohne")} className={chip(year === UNDATED)}>{book.undatedFilter}</Link>
        </nav>
        {typeof year === "number" ? (
          <nav className="flex flex-wrap gap-1" aria-label={book.allMonths}>
            <Link href={href(year)} className={chip(!month)}>{book.allMonths}</Link>
            {MONTHS.map((name, i) => (
              <Link key={name} href={href(year, i + 1)} className={chip(month === i + 1)}>
                {name.slice(0, 3)}
              </Link>
            ))}
          </nav>
        ) : null}
      </div>

      {/*
        `scope` no longer reaches the ledger: the financial row is the same for
        Intern and Extern, and what differs — the order number, the channel —
        lives in the Details overlay. It still selects the rows above.
      */}
      {ledger.sales.length === 0 ? (
        <p className="mt-8 text-sm text-muted">{empty}</p>
      ) : (
        <SalesLedger key={here} sales={ledger.sales} summary={ledger.summary} backHref={here}
                     openSale={openSale} />
      )}
    </main>
  );
}
