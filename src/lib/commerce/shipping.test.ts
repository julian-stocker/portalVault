import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  DEFAULT_SHIPPING_METHOD,
  DELIVERY_COUNTRY,
  isShippingMethod,
  SHIPPING_METHODS,
} from "@/lib/commerce/shipping";

/**
 * Shipping and the tax regime (B1, migration 0011).
 *
 * The migration is the authority for both, so these are contract tests
 * against the SQL. The rule they protect is short and easy to lose: a browser
 * chooses a carrier and never a price, § 19 is a regime and never a rate, and
 * both facts are frozen on the order once it exists.
 */
const MIGRATION = "supabase/migrations/0011_checkout_shipping_and_tax.sql";
const sql = readFileSync(MIGRATION, "utf8");

const code = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

/**
 * The migration with its `comment on … is '…'` statements removed as well.
 *
 * Those are documentation stored in the database, and this one explains at
 * length why a 0 % rate is the wrong model — so the prose contains exactly
 * the strings the assertions below look for in code.
 */
const statements = code.replace(/comment on [\s\S]*?';/g, "");

function fn(name: string): string {
  const start = code.indexOf(`create or replace function public.${name}(`);
  expect(start, `function ${name} is missing`).toBeGreaterThan(-1);
  const open = code.indexOf("as $$", start);
  return code.slice(open, code.indexOf("$$;", open));
}

/**
 * The rule, mirrored here only so the expectations below are readable. The
 * assertions compare it against the SQL rather than against itself.
 */
const BASE = { hermes: 5.49, dhl: 6.49 };
const THRESHOLD = 75;

describe("the two methods, and only those", () => {
  it("matches the catalog in the migration", () => {
    const catalog = fn("shipping_catalog");
    const codes = [...catalog.matchAll(/\('(\w+)',\s*'[^']+',/g)].map((m) => m[1]);
    expect(codes).toEqual([...SHIPPING_METHODS]);
  });

  it("carries the agreed names and prices", () => {
    const catalog = fn("shipping_catalog");
    expect(catalog).toContain("('hermes', 'Hermes', 5.49::numeric, 1)");
    expect(catalog).toContain("('dhl',    'DHL',    6.49::numeric, 2)");
  });

  it("preselects Hermes, which is the first and the cheaper one", () => {
    expect(DEFAULT_SHIPPING_METHOD).toBe("hermes");
    expect(fn("shipping_quote")).toContain("(c.sort_order = 1)");
  });

  it("recognises exactly those two codes", () => {
    expect(isShippingMethod("hermes")).toBe(true);
    expect(isShippingMethod("dhl")).toBe(true);
    for (const wrong of ["post", "ups", "free_shipping", "", null, 5]) {
      expect(isShippingMethod(wrong)).toBe(false);
    }
  });

  it("delivers to Germany and says so once", () => {
    expect(DELIVERY_COUNTRY).toBe("DE");
    expect(fn("create_order")).toContain("if v_country <> 'DE' then");
    expect(fn("create_order")).toContain("SkyIsles delivers to Germany only");
  });
});

describe("what shipping costs", () => {
  it("is decided in one function and nowhere else", () => {
    // The charge and the displayed price both come from here.
    expect(fn("create_order")).toContain("public.shipping_amount_for(p_shipping_method, v_subtotal)");
    expect(fn("shipping_quote")).toContain("public.shipping_amount_for(c.code");
  });

  it("charges the base price below the threshold", () => {
    const amount = fn("shipping_amount_for");
    expect(amount).toContain("select c.base_price into v_base");
    expect(amount).toContain("return v_base;");
    expect(BASE.hermes).toBe(5.49);
    expect(BASE.dhl).toBe(6.49);
  });

  it("is free at the threshold and above, not only above it", () => {
    // `>=`, so exactly 75,00 € already ships free.
    expect(fn("shipping_amount_for")).toContain(
      "if p_items_subtotal >= public.free_shipping_threshold() then",
    );
    expect(fn("shipping_amount_for")).toContain("return 0.00;");
    expect(fn("free_shipping_threshold")).toContain("select 75.00::numeric;");
    expect(THRESHOLD).toBe(75);
  });

  it("measures the threshold on the goods value, before any discount", () => {
    // items_subtotal is the figure a customer can check in their own basket.
    expect(fn("create_order")).toContain("public.shipping_amount_for(p_shipping_method, v_subtotal)");
    expect(code).not.toMatch(/discount_amount[^;]*free_shipping/i);
  });

  it("refuses an unknown method instead of shipping it for nothing", () => {
    const amount = fn("shipping_amount_for");
    expect(amount).toContain("raise exception 'unknown shipping method %'");
    expect(fn("create_order")).toContain("raise exception 'unknown shipping method %'");
  });

  it("keeps the method even when it is free", () => {
    // "Hermes, free" is what happened; "free shipping" is not a carrier.
    expect(code).toContain("shipping_method_code");
    expect(code).not.toContain("'free_shipping'");
  });
});

describe("the browser cannot name a price", () => {
  it("has no shipping amount parameter to send one in", () => {
    const signature = code.slice(
      code.indexOf("create or replace function public.create_order("),
      code.indexOf("returns table (", code.indexOf("create or replace function public.create_order(")),
    );
    expect(signature).toContain("p_shipping_method text");
    expect(signature).not.toMatch(/amount|price|total|subtotal|discount/i);
  });

  it("writes the shipping charge from what it computed itself", () => {
    expect(fn("create_order")).toContain("shipping_amount = v_shipping");
    expect(fn("create_order")).toContain("total_amount    = v_subtotal + v_shipping");
  });

  it("but does it by UPDATE, which 0016 had to replace", () => {
    // 0011's create_order inserted the order with zero amounts and patched
    // them afterwards — and `orders_protect_immutable()` refuses exactly
    // that, so every call raised 23001 and no order could be created. The
    // assertion above still describes 0011 correctly; it is not what runs.
    // 0016 computes the amounts before the INSERT and updates nothing.
    // The live contract is `create-order.test.ts`.
    expect(fn("create_order")).toContain("update public.orders");
    // Comments stripped: 0016's header quotes the defective statement in
    // order to explain it, and that quotation is not code.
    const next = readFileSync(
      "supabase/migrations/0016_fix_create_order_amount_initialization.sql", "utf8",
    )
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(next).toContain("create or replace function public.create_order(");
    expect(next).not.toContain("update public.orders");
  });

  it("exposes only the display projection to clients", () => {
    expect(code).toContain("grant execute on function public.shipping_quote(numeric) to anon, authenticated;");
    for (const internal of ["free_shipping_threshold()", "shipping_catalog()"]) {
      expect(code).toContain(`revoke all on function public.${internal}`);
    }
    expect(code).not.toMatch(/grant execute on function public\.(shipping_amount_for|shipping_catalog|free_shipping_threshold)/);
  });
});

describe("the tax regime is a regime, not a rate", () => {
  it("stores a named scheme on the order", () => {
    expect(code).toContain("add column if not exists tax_regime text not null default 'small_business_19'");
    expect(code).toContain("check (tax_regime in ('small_business_19'))");
  });

  it("introduces no rate, no percentage and no VAT line", () => {
    // A 0 % rate is a taxable transaction taxed at zero; § 19 is the tax not
    // being levied. Modelling it as a rate would produce a 0,00 € VAT line.
    expect(statements).not.toMatch(/tax_rate|vat_rate|tax_percent|vat_amount|tax_amount/i);
    expect(statements).not.toMatch(/\b19\.0|0\.19|\b0\s*%/);
  });

  it("keeps it on the order and not on the line", () => {
    // § 19 is a property of the seller, not of an article.
    expect(code).not.toMatch(/alter table public\.order_lines[\s\S]{0,120}tax/i);
  });

  it("does not touch the existing amount columns", () => {
    for (const column of ["items_subtotal", "discount_amount", "total_amount"]) {
      expect(code).not.toMatch(new RegExp(`alter table public\\.orders[\\s\\S]{0,80}${column}\\s+(type|drop)`));
    }
  });
});

describe("both new facts are frozen", () => {
  const trigger = fn("orders_protect_immutable");

  it("refuses to change the tax regime after the order exists", () => {
    expect(trigger).toContain("new.tax_regime           is distinct from old.tax_regime");
  });

  it("refuses to change the shipping method or its name", () => {
    expect(trigger).toContain("new.shipping_method_code is distinct from old.shipping_method_code");
    expect(trigger).toContain("new.shipping_method_name is distinct from old.shipping_method_name");
  });

  it("still freezes everything 0010 froze", () => {
    for (const frozen of ["order_number", "items_subtotal", "shipping_amount", "total_amount"]) {
      expect(trigger).toContain(`new.${frozen}`);
    }
  });

  it("keeps a code and a name together or absent together", () => {
    expect(code).toContain("check ((shipping_method_code is null) = (shipping_method_name is null))");
  });
});

describe("the migration stays additive", () => {
  it("creates no table and drops nothing but the function it replaces", () => {
    expect(code).not.toMatch(/create table/i);
    const drops = [...code.matchAll(/drop function[^;]*;/g)].map((m) => m[0]);
    expect(drops).toHaveLength(1);
    expect(drops[0]).toContain("create_order(text, text, jsonb, jsonb)");
  });

  it("re-grants create_order after recreating it", () => {
    // Dropping a function drops its grants with it.
    expect(code).toContain(
      "grant execute on function public.create_order(text, text, jsonb, jsonb, text) to anon, authenticated;",
    );
  });

  it("opens no new function to clients beyond the display quote", () => {
    const granted = [...code.matchAll(/grant execute on function public\.(\w+)\([^)]*\) to ([^;]+);/g)]
      .filter(([, , roles]) => /anon|authenticated/.test(roles))
      .map(([, name]) => name);
    expect(granted.sort()).toEqual(["create_order", "shipping_quote"]);
  });

  it("makes a client-callable function that uses internals a definer", () => {
    /*
     * The bug this exists to prevent, found in production on the first run of
     * 0011: `shipping_quote()` was granted to anon but declared INVOKER, so it
     * ran `shipping_catalog()` as the caller and was refused — "permission
     * denied for function shipping_catalog". The grant was right; the
     * execution context was not.
     */
    const defined = [...code.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]);
    const granted = [...code.matchAll(/grant execute on function public\.(\w+)\([^)]*\) to ([^;]+);/g)]
      .filter(([, , roles]) => /anon|authenticated/.test(roles))
      .map(([, name]) => name);
    const internal = defined.filter((name) => !granted.includes(name));

    for (const name of granted) {
      const start = code.indexOf(`create or replace function public.${name}(`);
      const head = code.slice(start, code.indexOf("as $$", start));
      const body = fn(name);
      const uses = internal.filter((other) => body.includes(`public.${other}(`));
      if (uses.length === 0) continue;
      expect(
        head,
        `${name}() calls ${uses.join(", ")} but is not security definer`,
      ).toContain("security definer");
    }
  });

  it("pins search_path on every function it defines", () => {
    const defined = [...code.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]);
    for (const name of defined) {
      const start = code.indexOf(`create or replace function public.${name}(`);
      const head = code.slice(start, code.indexOf("as $$", start));
      expect(head, `${name} does not pin search_path`).toContain("set search_path = ''");
    }
  });
});
