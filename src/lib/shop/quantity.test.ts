import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import { MAX_LINE_QUANTITY } from "@/lib/cart/cart";

/**
 * The stock gate (V11).
 *
 * The cart could count as high as it liked. It now asks the server whether a
 * total is possible — and the server answers with one bit, because the stock
 * level is not public (docs/SECURITY.md).
 */
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

// The action calls the server-side Supabase client, which needs a request to
// exist. The point of these tests is the action's own rules, so the client is
// replaced by the one method it uses.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc }),
}));

const { checkCartQuantity } = await import("@/lib/shop/quantity");

const MIGRATION = "supabase/migrations/0009_shop_quantity_check.sql";
const sql = readFileSync(MIGRATION, "utf8");

/** SQL with the comment banners stripped, so assertions test code. */
const code = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

beforeEach(() => {
  rpc.mockReset();
});

describe("the function returns a verdict, never a count", () => {
  it("returns a boolean", () => {
    expect(code).toContain("returns boolean");
  });

  it("has no column for a stock level anywhere in its signature", () => {
    // The whole guarantee in one assertion: there is no `returns table`, so
    // there is no field an `available_quantity` could ever be added to
    // without this failing.
    expect(code).not.toContain("returns table");
    expect(code).not.toMatch(/returns\s+integer\s+as/i);
  });

  it("compares the stock rather than selecting it", () => {
    // `available_quantity` appears exactly once, on the right-hand side of a
    // comparison — never in a select list.
    const mentions = code.split("\n").filter((line) => line.includes("available_quantity"));
    expect(mentions).toHaveLength(1);
    // The one mention is a comparison in a WHERE clause, not a selected value.
    expect(mentions[0].trim()).toBe("and i.available_quantity >= p_quantity");
  });

  it("takes reservations into account, because the column already does", () => {
    // available_quantity is `generated always as (quantity - reserved)` in
    // 0003 — one definition, and this is the same one the projection uses.
    const foundation = readFileSync("supabase/migrations/0003_shop_foundation.sql", "utf8");
    expect(foundation).toContain("generated always as (quantity - reserved) stored");
  });
});

describe("what makes an answer a no", () => {
  it("asks the one eligibility rule rather than a second copy", () => {
    expect(code).toContain("public.is_shop_eligible(i.sky_id)");
    // No re-implementation of the catalog gate.
    expect(code).not.toContain("catalog_visible");
    expect(code).not.toContain("non_collectible_categories");
  });

  it("requires the position to be released", () => {
    expect(code).toContain("i.is_listed");
  });

  it("requires an effective price, from the one function that decides it", () => {
    expect(code).toContain("public.shop_price(i.sale_price, s.market_price, st.price_percentage)");
    expect(code).toContain("is not null");
  });

  it("matches the exact article, so a condition cannot be mixed up", () => {
    expect(code).toContain("i.sky_id    = p_sky_id");
    expect(code).toContain("i.condition = p_condition");
  });

  it("bounds the quantity by the cart's own maximum", () => {
    expect(code).toContain("p_quantity >= 1");
    expect(code).toContain("p_quantity <= public.max_cart_quantity()");
  });

  it("mirrors MAX_LINE_QUANTITY exactly", () => {
    // Same coupling non_collectible_categories() has with collectible.ts: two
    // sides that must agree, asserted rather than hoped for.
    const bound = code.match(/max_cart_quantity\(\)[\s\S]*?select (\d+);/);
    expect(bound).not.toBeNull();
    expect(Number(bound![1])).toBe(MAX_LINE_QUANTITY);
  });
});

describe("the function is safe to expose", () => {
  it("is security definer with a pinned search_path", () => {
    expect(code).toContain("security definer");
    expect(code).toContain("set search_path = ''");
  });

  it("is stable and therefore cannot mutate", () => {
    expect(code).toContain("stable");
    expect(code).not.toMatch(/\b(insert|update|delete|truncate)\b/i);
  });

  it("grants execute explicitly, to the client roles only", () => {
    expect(code).toContain(
      "revoke all on function public.shop_quantity_available(text, text, integer) from public;",
    );
    expect(code).toContain(
      "grant execute on function public.shop_quantity_available(text, text, integer) to anon, authenticated;",
    );
  });

  it("grants no privilege on the table itself", () => {
    expect(code).not.toMatch(/grant[^;]*on\s+table/i);
    expect(code).not.toMatch(/grant[^;]*shop_inventory/i);
    expect(code).not.toContain("create policy");
  });
});

describe("the action refuses nonsense without asking the server", () => {
  it("refuses a malformed SKY-ID", async () => {
    expect(await checkCartQuantity("bash", "loose", 1)).toBe("denied");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a condition the shop does not know", async () => {
    expect(await checkCartQuantity("SKY-0001", "sealed" as never, 1)).toBe("denied");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses quantities no cart line may hold", async () => {
    for (const quantity of [0, -1, 1.5, MAX_LINE_QUANTITY + 1, Number.NaN]) {
      expect(await checkCartQuantity("SKY-0001", "loose", quantity)).toBe("denied");
    }
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("the action, when it does ask", () => {
  it("passes the total, not the increment", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await checkCartQuantity("SKY-0001", "loose", 3);
    expect(rpc).toHaveBeenCalledWith("shop_quantity_available", {
      p_sky_id: "SKY-0001",
      p_condition: "loose",
      p_quantity: 3,
    });
  });

  it("allows only a literal true", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await checkCartQuantity("SKY-0001", "loose", 1)).toBe("allowed");
  });

  it("denies a false", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await checkCartQuantity("SKY-0001", "loose", 4)).toBe("denied");
  });

  it("denies anything that is not a boolean true", async () => {
    for (const data of [null, undefined, 3, "true"]) {
      rpc.mockResolvedValue({ data, error: null });
      expect(await checkCartQuantity("SKY-0001", "loose", 1)).toBe("denied");
    }
  });

  it("calls exactly one function, and it is the read-only one", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await checkCartQuantity("SKY-0001", "loose", 1);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe("shop_quantity_available");
  });
});

describe("it fails closed", () => {
  it("reports 'unchecked' when the function is not there", async () => {
    // The state every environment is in until migration 0009 is applied.
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "missing" } });
    expect(await checkCartQuantity("SKY-0001", "loose", 1)).toBe("unchecked");
  });

  it("reports 'unchecked' on any other database error", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "57014", message: "timeout" } });
    expect(await checkCartQuantity("SKY-0001", "loose", 1)).toBe("unchecked");
  });

  it("reports 'unchecked' when the call throws", async () => {
    rpc.mockRejectedValue(new Error("network"));
    expect(await checkCartQuantity("SKY-0001", "loose", 1)).toBe("unchecked");
  });

  it("never answers 'allowed' when it could not ask", async () => {
    for (const outcome of [
      { data: null, error: { code: "PGRST202" } },
      { data: true, error: { code: "57014" } },
    ]) {
      rpc.mockResolvedValue(outcome);
      expect(await checkCartQuantity("SKY-0001", "loose", 1)).not.toBe("allowed");
    }
  });
});
