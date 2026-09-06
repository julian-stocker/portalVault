import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { isValidPercentage, MAX_PERCENTAGE, MIN_PERCENTAGE } from "@/lib/admin/inventory-model";

/**
 * Automatic shop prices (ADR-0045).
 *
 * The arithmetic lives in the database — one `shop_price()` function that the
 * public projection, the administrator's list and the listing guard all call.
 * So most of what has to hold is asserted against the migration, and the
 * strongest assertion of all is a negative one: the application does not
 * compute money.
 */
function sql(path: string): string {
  return readFileSync(path, "utf8");
}

/** The migration without its comments — what it does, not what it says. */
function code(path: string): string {
  return sql(path)
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

const PRICING = "supabase/migrations/0007_shop_pricing_and_images.sql";
const FOUNDATION = "supabase/migrations/0003_shop_foundation.sql";

/** One function's body, so an assertion cannot match a different one. */
function body(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("$$;", start);
  return source.slice(start, end);
}

describe("the settings row", () => {
  const source = code(PRICING);

  it("starts at 90 %", () => {
    expect(source).toContain("price_percentage numeric(6,2) not null default 90.00");
  });

  it("can only ever be one row", () => {
    // A singleton by primary key, not by a trigger or a cleanup job.
    expect(source).toContain("id boolean primary key default true");
    expect(source).toContain("constraint shop_settings_singleton check (id)");
    expect(source).toContain("insert into public.shop_settings (id) values (true)");
  });

  it("is numeric, never a float", () => {
    // Money arithmetic. 0.1 + 0.2 must not enter it.
    expect(source).toMatch(/price_percentage numeric\(6,2\)/);
    expect(source).not.toMatch(/price_percentage\s+(real|double precision|float)/);
  });

  it("refuses a percentage that cannot be a price", () => {
    expect(source).toContain("check (price_percentage > 0 and price_percentage <= 500)");
  });

  it("keeps the same bounds in the application", () => {
    // Stated twice on purpose — once to enforce, once to explain — so the
    // form can say the rule instead of surfacing a constraint name.
    expect(MAX_PERCENTAGE).toBe(500);
    expect(isValidPercentage(90)).toBe(true);
    expect(isValidPercentage(0)).toBe(false);
    expect(isValidPercentage(-5)).toBe(false);
    expect(isValidPercentage(Number.NaN)).toBe(false);
    expect(isValidPercentage(501)).toBe(false);
    expect(isValidPercentage(MIN_PERCENTAGE)).toBe(true);
    expect(isValidPercentage(MAX_PERCENTAGE)).toBe(true);
  });

  it("has no client privileges at all", () => {
    expect(source).toContain("revoke all on public.shop_settings from public, anon, authenticated;");
    expect(source).toContain("alter table public.shop_settings enable row level security;");
  });
});

describe("who may change it", () => {
  const source = code(PRICING);

  it("asks is_shop_admin() inside the database", () => {
    const fn = body(source, "create or replace function public.admin_set_shop_percentage");
    expect(fn).toContain("if not public.is_shop_admin() then");
    expect(fn).toContain("raise exception 'not authorized'");
  });

  it("validates the range in the function as well as in the CHECK", () => {
    const fn = body(source, "create or replace function public.admin_set_shop_percentage");
    expect(fn).toContain("p_percentage is null or p_percentage <= 0 or p_percentage > 500");
  });

  it("is not reachable by anon", () => {
    expect(source).toContain(
      "revoke all on function public.admin_set_shop_percentage(numeric)    from public, anon;",
    );
    expect(source).toContain(
      "grant execute on function public.admin_set_shop_percentage(numeric)   to authenticated;",
    );
  });
});

describe("the price rule", () => {
  const source = code(PRICING);
  const rule = body(source, "create or replace function public.shop_price");

  it("prefers a manual override, always", () => {
    expect(rule).toContain("when p_override is not null then p_override");
  });

  it("derives from the market price when there is none", () => {
    expect(rule).toContain("round(p_market_price * p_percentage / 100, 2)");
  });

  it("rounds to cents in the database, on numeric", () => {
    // Not in TypeScript, and not on a float. `round(numeric, 2)` is
    // half-away-from-zero, the ordinary commercial rounding.
    expect(rule).toContain("round(");
    expect(rule).toContain(", 2)");
  });

  it("answers NULL rather than 0 when there is no basis", () => {
    // The same rule the catalog follows for market_price (ADR-0010).
    expect(rule).toContain("when p_market_price is null or p_percentage is null then null");
  });

  it("is immutable, so it can be trusted in a WHERE clause", () => {
    expect(source).toMatch(/create or replace function public\.shop_price[\s\S]*?immutable/);
  });
});

describe("listing", () => {
  const source = code(PRICING);

  it("no longer requires a stored sale_price", () => {
    // The constraint could not see the market price or the percentage, so it
    // could not answer the question any more (ADR-0045).
    expect(source).toContain(
      "drop constraint if exists shop_inventory_listed_needs_price",
    );
    // It really was there before.
    expect(code(FOUNDATION)).toContain("constraint shop_inventory_listed_needs_price");
  });

  it("refuses a listing with no effective price, in the function", () => {
    const fn = body(source, "create or replace function public.set_shop_listing");
    expect(fn).toContain("public.shop_price(p_sale_price, s.market_price, st.price_percentage)");
    expect(fn).toContain("if coalesce(p_is_listed, false) and v_effective is null then");
  });

  it("still never touches stock", () => {
    const fn = body(source, "create or replace function public.set_shop_listing");
    expect(fn).not.toContain("quantity");
    expect(fn).not.toContain("reserved");
  });
});

describe("what the administrator's list gains", () => {
  const source = code(PRICING);

  it("carries the effective price and where it came from", () => {
    const fn = body(source, "create or replace function public.admin_shop_inventory");
    expect(fn).toContain("effective_price  numeric");
    expect(fn).toContain("price_source     text");
    expect(fn).toContain("case when i.sale_price is not null then 'manual' else 'automatic' end");
  });

  it("is still administrator-only", () => {
    const fn = body(source, "create or replace function public.admin_shop_inventory");
    expect(fn).toContain("if not public.is_shop_admin() then");
  });
});

describe("the application does not compute money", () => {
  /** The file without its comments, so a worked example in prose is not a hit. */
  function app(path: string): string {
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => {
        const trimmed = line.trimStart();
        return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("/*");
      })
      .join("\n");
  }

  it("reads the effective price rather than deriving it", () => {
    // It reads the percentage — the cards display it — but never multiplies
    // by it. The number it shows is the number the database computed.
    const queries = app("src/lib/admin/inventory.ts");
    expect(queries).toContain("effectivePrice");
    expect(queries).not.toMatch(/[*/]\s*(percentage|100|0\.9)/);
    expect(queries).not.toContain("Math.round");
  });

  it("never derives a public price in the browser", () => {
    // The public read path takes the number the database sends and parses
    // it. It does not know a percentage exists.
    const shop = app("src/lib/shop/queries.ts");
    expect(shop).not.toContain("percentage");
    expect(shop).not.toContain("market");
  });

  it("computes only a preview, and only where an override hides the automatic price", () => {
    // One exception, deliberate and named: the card shows what a position
    // would cost without its override. It is never saved and never charged.
    const card = app("src/components/admin/inventory-card.tsx");
    const matches = card.match(/Math\.round/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(card).toContain("Math.round(figure.marketPrice * percentage) / 100");
  });
});
