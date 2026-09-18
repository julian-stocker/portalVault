import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { formatNumber, formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";

/**
 * Two numbers on the shop home (ADR-0081, corrected by ADR-0083).
 *
 * The risk in a KPI is not that it fails to render — it is that it renders
 * something plausible and wrong. A count that includes test orders, an amount
 * labelled as money that has not arrived, a year that starts at midnight UTC:
 * each would look exactly like a working dashboard. So what is held here is
 * the predicate, not the pixels.
 */
const M = "supabase/migrations/0044_seller_year_to_date.sql";
const source = (path: string) => readFileSync(path, "utf8");
const code = (path: string) =>
  source(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--.*$/gm, "")
    .replace(/^\s*\/\/.*$/gm, "");

const sql = code(M);
const hub = code("src/app/(business)/business/page.tsx");
const reader = code("src/lib/admin/shop-kpi.ts");

describe("what counts is order activity, not money received", () => {
  it("does not require payment", () => {
    /*
     * The correction in ADR-0083. This used to read
     * `o.payment_status = 'paid'`, which made the figure a hybrid: bounded by
     * placement, gated on payment. An order placed on 30 December and paid on
     * 2 January counted toward neither year's number.
     */
    const aggregate = sql.slice(sql.indexOf("create or replace function public.seller_year_to_date"));
    expect(aggregate).not.toContain("o.payment_status = 'paid'");
    expect(aggregate).not.toContain("paid_at");
  });

  it("counts an order by when it was placed", () => {
    expect(sql).toContain("o.placed_at >= date_trunc('year'");
    for (const wrong of ["paid_at", "shipped_at", "completed_at"]) {
      expect(sql, wrong).not.toContain(wrong);
    }
  });

  it("excludes only the abandoned checkout", () => {
    // 'expired' is a row that never became an order: the 20-minute hold
    // lapsed, the stock went back, nobody paid. Not an order that stopped
    // counting.
    expect(sql).toContain("select p_payment_status is distinct from 'expired';");
  });

  it("and keeps a cancelled or refunded order in the year it was placed", () => {
    /*
     * Undoing an order is a LATER event and belongs to a later period. If the
     * predicate excluded these, writing 'cancelled' would retroactively remove
     * an order from a year that had already displayed it — the retroactive
     * rewriting the whole model forbids. Nothing writes them today, which is
     * exactly why the boundary is pinned before it can be got wrong.
     */
    // The function body alone. Its `comment on` has to name the states it
    // does NOT exclude in order to explain why, and prose is not a predicate.
    const start = sql.indexOf("create or replace function public.order_counts_as_placed");
    const predicate = sql.slice(start, sql.indexOf("$$;", start));
    for (const later of ["cancelled", "refunded", "partially_refunded"]) {
      expect(predicate, later).not.toContain(later);
    }
  });

  it("counts a flagged order, because it is a real order", () => {
    // `needs_resolution` means fulfilment needs a human — not that the order
    // is in doubt. The expiry sweep deliberately never touches one, so it
    // stays a genuine order awaiting a person.
    expect(sql).not.toContain("needs_resolution");
  });

  it("uses one predicate for both numbers", () => {
    const where = sql.slice(sql.indexOf("where public.can_operate_active_seller()"), sql.indexOf("$$;", sql.indexOf("seller_year_to_date")));
    expect((where.match(/order_counts_as_placed/g) ?? []).length).toBe(1);
    expect((where.match(/commerce_mode/g) ?? []).length).toBe(1);
  });

  it("and shares that predicate with the monthly report, as a function", () => {
    // Not the same text twice. The same function — which is the only way two
    // figures about the shop's money cannot drift apart (ADR-0083).
    const report = code("supabase/migrations/0045_seller_order_archive.sql");
    expect(sql).toContain("public.order_counts_as_placed(o.payment_status)");
    expect(report).toContain("public.order_counts_as_placed(o.payment_status)");
    expect(report).not.toContain("is distinct from 'expired'");
  });
});

describe("sandbox is excluded by fact, not by guesswork", () => {
  it("reads the frozen mode on the order", () => {
    expect(sql).toContain("o.commerce_mode = 'live'");
  });

  it("guesses from nothing else", () => {
    for (const brittle of ["order_number", "customer_email", "like '%test", "ilike"]) {
      expect(sql.toLowerCase(), brittle).not.toContain(brittle.toLowerCase());
    }
  });

  it("is reliable because the column admits no gap", () => {
    // 0021 backfilled every pre-existing row and made it NOT NULL, so `= 'live'`
    // never silently drops a real order for want of a value.
    const m21 = source("supabase/migrations/0021_commerce_mode.sql");
    expect(m21).toContain("update public.orders set commerce_mode = 'sandbox' where commerce_mode is null;");
    expect(m21).toContain("alter column commerce_mode set not null");
  });
});

describe("the year is Berlin's", () => {
  it("starts at 1 January in the zone the product's dates mean", () => {
    expect(sql).toContain("date_trunc('year', (now() at time zone 'Europe/Berlin'))");
    expect(sql).toContain("at time zone 'Europe/Berlin'");
  });

  it("is a calendar year, not a rolling window", () => {
    for (const rolling of ["interval '1 year'", "interval '365", "months"]) {
      expect(sql, rolling).not.toContain(rolling);
    }
  });

  it("agrees with the zone the formatter already fixed", () => {
    expect(source("src/lib/format.ts")).toContain('const TIME_ZONE = "Europe/Berlin"');
  });
});

describe("the money is the decided figure", () => {
  it("sums the order's own total", () => {
    expect(sql).toContain("sum(o.total_amount)");
  });

  it("never rebuilds a price from the catalogue", () => {
    for (const forbidden of ["shop_price", "market_price", "order_lines", "unit_price"]) {
      expect(sql, forbidden).not.toContain(forbidden);
    }
  });

  it("survives PostgREST without losing a cent", () => {
    // numeric → float would round a large total. It crosses as text and is
    // parsed once.
    expect(sql).toContain("::text");
    expect(reader).toContain('typeof row.order_value === "string" ? Number(row.order_value)');
  });
});

describe("who may see it", () => {
  it("is the seller's, inside the aggregate itself", () => {
    // In the WHERE, so a caller without the capability aggregates an empty
    // set — there is no row to leak and no error to interpret.
    expect(sql).toContain("where public.can_operate_active_seller()");
    expect(sql).not.toContain("is_shop_admin");
    expect(sql).not.toContain("is_platform_admin");
  });

  it("is granted like every other seller RPC", () => {
    expect(sql).toContain("revoke all on function public.seller_year_to_date() from public, anon");
    expect(sql).toContain("grant execute on function public.seller_year_to_date() to authenticated");
  });

  it("is asked with the same predicate in the application", () => {
    expect(reader).toContain("if (!(await canOperateSeller())) return NO_YEAR_TO_DATE;");
  });

  it("appears only on the shop home", () => {
    expect(code("src/app/(admin)/admin/page.tsx")).not.toContain("YearToDate");
    expect(code("src/app/(app)/account/page.tsx")).not.toContain("YearToDate");
  });
});

describe("the page stays a management hub", () => {
  it("still leads to all six areas", () => {
    for (const href of [
      "/business/profile", "/business/offers", "/business/inventory",
      "/business/orders", "/business/shipping", "/business/legal",
    ]) {
      expect(hub, href).toContain(href);
    }
  });

  it("asks for the aggregate alongside the rest, not before it", () => {
    expect(hub).toContain("await Promise.all([");
    expect(hub).toContain("fetchShopYearToDate()");
  });

  it("loads no order history to print two numbers", () => {
    expect(hub).not.toContain("fetchAdminOrders");
    expect(hub).not.toContain("admin_orders");
  });

  it("wraps instead of overflowing", () => {
    expect(hub).toContain("flex flex-wrap items-start justify-between");
    expect(hub).toContain("flex shrink-0 flex-wrap gap-3");
    expect(hub).not.toContain("overflow-x");
  });

  it("stays quieter than the cards it sits above", () => {
    // Status, not a destination: no link, no ring-strong hover.
    const block = hub.slice(hub.indexOf("<dl"), hub.indexOf("</dl>"));
    expect(block).not.toContain("<Link");
    expect(block).not.toContain("hover:ring-border-strong");
  });
});

describe("formatting and the zero state", () => {
  it("uses the project's own formatters", () => {
    expect(hub).toContain("formatNumber(year.orderCount)");
    expect(hub).toContain("formatPrice(year.orderValue)");
    // No second currency implementation.
    expect(hub).not.toContain("toFixed(2)");
    expect(hub).not.toContain("Intl.NumberFormat");
  });

  it("renders money the way this product already does", () => {
    /*
     * `€ 4.582,40`, not `4.582,40 €`: the project's locale is de-AT, which
     * leads with the symbol (ADR-0019, `src/lib/format.ts`). Matching a
     * mock-up instead would mean a second currency formatter, and then two
     * places where money is printed differently.
     */
    expect(formatPrice(4582.4).replace(/\s/g, " ")).toBe("€ 4.582,40");
    expect(formatNumber(127)).toBe("127");
    /*
     * `1 270`, not `1.270`: de-AT groups with a narrow no-break space. The
     * locale decides how this product writes numbers, and a KPI is not the
     * place to start a second convention (ADR-0019).
     */
    expect(formatNumber(1270).replace(/\s/g, " ")).toBe("1 270");
  });

  it("shows zeroes rather than placeholders when there is nothing yet", () => {
    expect(reader).toContain("NO_YEAR_TO_DATE: ShopYearToDate = { orderCount: 0, orderValue: 0 }");
    expect(formatPrice(0).replace(/\s/g, " ")).toBe("€ 0,00");
    expect(formatNumber(0)).toBe("0");
    // Never an em dash for a real zero.
    expect(formatPrice(0)).not.toBe("–");
  });

  it("says what the numbers mean and what they leave out", () => {
    expect(hub).toContain("de.business.ytdHint");
    const hint = de.business.ytdHint;
    // Which date it counts by, which world, and that it is not a receipt.
    expect(hint).toContain("nach Bestelldatum");
    expect(hint).toContain("Echtbetrieb");
    expect(hint).toContain("kein Zahlungseingang");
    expect(hint).toContain("Abgebrochene");
  });

  it("calls it Bestellwert, because payment is not required", () => {
    /*
     * The label has to survive the case that produced it: an order placed on
     * 30 December and paid on 2 January is in this year's figure. "Umsatz",
     * "Einnahmen" and "bezahlt" would each be a false claim about it.
     */
    expect(de.business.ytdOrderValue).toBe("Bestellwert dieses Jahr");
    expect(de.business.ytdOrders).toBe("Bestellungen dieses Jahr");
    const copy = code("src/lib/i18n/de.ts");
    for (const wrong of [
      "Umsatz dieses Jahr",
      "Einnahmen",
      "Gewinn",
      "Ertrag",
      "Netto-Umsatz",
      "Nettoumsatz",
    ]) {
      expect(copy, wrong).not.toContain(wrong);
    }
  });
});

describe("nothing else moved", () => {
  it("left 0043 alone", () => {
    expect(sql).not.toContain("seller_resolve_stock_shortfall");
    expect(sql).not.toContain("needs_resolution");
  });

  it("built no analytics system", () => {
    for (const forbidden of ["create table", "materialized", "rollup", "pg_cron"]) {
      expect(sql.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  it("changed no account type and added no seller_id", () => {
    for (const forbidden of ["platform_admins", "seller_operators", "seller_id"]) {
      expect(sql, forbidden).not.toContain(forbidden);
    }
  });
});
