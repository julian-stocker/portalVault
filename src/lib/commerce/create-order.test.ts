import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

/**
 * `create_order()` after the amount-initialisation fix (migration 0016).
 *
 * The defect these tests exist for: from 0010 until 0016, the function
 * inserted the order with zero amounts and updated them immediately
 * afterwards, while `orders_protect_immutable()` — added in the same
 * migration — refused any change to those columns. Every call raised
 * SQLSTATE 23001 and rolled back, so no order could be created at all.
 *
 * It survived 1300+ tests because each of them asserted on the text of one
 * file. The trigger named the amount columns; the function contained an
 * UPDATE; both were true in isolation. Nothing compared the two, and nothing
 * had ever executed either.
 *
 * These tests therefore assert the *shape* that makes the contradiction
 * impossible — final amounts in the INSERT, no UPDATE at all — and the
 * runtime proof lives in `supabase/tests/0015_runtime_verification.sql`,
 * which actually runs it against PostgreSQL.
 */
const MIGRATION = "supabase/migrations/0016_fix_create_order_amount_initialization.sql";
const sql = readFileSync(MIGRATION, "utf8");

const code = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

/** The migration with `comment on … is '…'` removed: prose, not code. */
const statements = code.replace(/comment on [\s\S]*?';/g, "");

function fn(name: string): string {
  const start = code.indexOf(`create or replace function public.${name}(`);
  expect(start, `function ${name} is missing`).toBeGreaterThan(-1);
  const open = code.indexOf("as $$", start);
  return code.slice(open, code.indexOf("$$;", open));
}

function head(name: string): string {
  const start = code.indexOf(`create or replace function public.${name}(`);
  expect(start, `function ${name} is missing`).toBeGreaterThan(-1);
  return code.slice(start, code.indexOf("as $$", start));
}

const create = fn("create_order");

/** The INSERT into orders, from the keyword to the RETURNING clause. */
const orderInsert = create.slice(
  create.indexOf("insert into public.orders"),
  create.indexOf("returning id, orders.order_number"),
);

// ---------------------------------------------------------------------------

describe("the migration changes one function and nothing else", () => {
  it("replaces only create_order", () => {
    const defined = [...code.matchAll(/create or replace function public\.(\w+)\(/g)].map(
      (m) => m[1],
    );
    expect(defined).toEqual(["create_order"]);
  });

  it("touches no table, trigger, constraint, policy or index", () => {
    expect(code).not.toMatch(/create table|alter table|drop table/);
    expect(code).not.toMatch(/create trigger|drop trigger/);
    expect(code).not.toMatch(/create policy|drop policy/);
    expect(code).not.toMatch(/create (unique )?index/);
    expect(code).not.toMatch(/add constraint|drop constraint/);
  });

  it("leaves the immutability trigger exactly as it was", () => {
    // The whole point of this fix: the trigger is not the thing that gives.
    expect(code).not.toContain("orders_protect_immutable");
  });

  it("issues no GRANT and no REVOKE", () => {
    // `create or replace` preserves privileges, so 0013's grant still stands.
    expect(code).not.toMatch(/\bgrant\b|\brevoke\b/i);
  });

  it("drops nothing", () => {
    expect(code).not.toMatch(/drop function/);
  });

  it("sits in the numbered sequence without disturbing it", () => {
    const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
    expect(files).toContain("0016_fix_create_order_amount_initialization.sql");
    const numbers = files.map((f) => Number(f.slice(0, 4)));
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });
});

// ---------------------------------------------------------------------------

describe("the amounts are final when the order is written", () => {
  it("names all three amount columns in the INSERT", () => {
    for (const column of ["items_subtotal", "shipping_amount", "total_amount"]) {
      expect(orderInsert, `${column} is not written by the INSERT`).toContain(column);
    }
  });

  it("inserts the computed values, not placeholders", () => {
    expect(orderInsert).toContain("v_subtotal, v_shipping, v_subtotal + v_shipping");
    // The old shape, which the trigger refused.
    expect(orderInsert).not.toMatch(/v_client,\s*0,\s*0/);
  });

  it("computes the shipping charge before the order exists", () => {
    const shipping = create.indexOf("v_shipping := public.shipping_amount_for(");
    const insert = create.indexOf("insert into public.orders");
    expect(shipping).toBeGreaterThan(-1);
    expect(shipping).toBeLessThan(insert);
  });

  it("finishes the subtotal before the order exists", () => {
    const lastSum = create.lastIndexOf("v_subtotal := v_subtotal +");
    const insert = create.indexOf("insert into public.orders");
    expect(lastSum).toBeGreaterThan(-1);
    expect(lastSum).toBeLessThan(insert);
  });
});

// ---------------------------------------------------------------------------

describe("nothing updates an order's amounts afterwards", () => {
  it("contains no UPDATE of public.orders at all", () => {
    expect(create).not.toContain("update public.orders");
  });

  it("assigns none of the three columns outside the INSERT", () => {
    const afterInsert = create.slice(create.indexOf("returning id, orders.order_number"));
    for (const column of ["items_subtotal", "shipping_amount", "total_amount"]) {
      // The tail assigns the OUT parameters of the same name; an assignment
      // to a table column would read `set <column> =`.
      expect(afterInsert).not.toMatch(new RegExp(`set\\s+${column}\\s*=`));
    }
  });

  it("would not survive a reintroduced patch-up", () => {
    // The exact shape 0010 through 0013 had.
    expect(create).not.toMatch(/set\s+items_subtotal\s*=\s*v_subtotal/);
    expect(create).not.toMatch(/total_amount\s*=\s*v_subtotal \+ v_shipping\s*\n\s*where id/);
  });
});

// ---------------------------------------------------------------------------

describe("every position is priced exactly once", () => {
  const resolve = create.indexOf("for v_item in select * from jsonb_array_elements(p_items)");
  const write = create.indexOf("for v_item in select * from jsonb_array_elements(v_resolved)");

  it("resolves from p_items, then writes from the resolved snapshots", () => {
    expect(resolve).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(resolve);
  });

  it("reads the catalog in exactly one place", () => {
    const lookups = [...create.matchAll(/from public\.shop_inventory i/g)];
    expect(lookups).toHaveLength(1);
    // And that one lookup is in the resolve pass, before the order exists.
    expect(lookups[0].index).toBeLessThan(create.indexOf("insert into public.orders"));
  });

  it("prices through shop_price() and nowhere else", () => {
    const prices = [...create.matchAll(/public\.shop_price\(/g)];
    expect(prices).toHaveLength(1);
    expect(create).toContain("public.is_shop_eligible(i.sky_id)");
  });

  it("writes the lines from the snapshot, never from a second lookup", () => {
    const lineWrite = create.slice(write, create.indexOf("insert into public.order_addresses"));
    expect(lineWrite).toContain("insert into public.order_lines");
    for (const field of ["sky_id", "condition", "quantity", "name", "image",
                         "unit_price", "line_total", "inventory_id"]) {
      expect(lineWrite, `${field} is not taken from the snapshot`).toContain(`'${field}'`);
    }
    expect(lineWrite).not.toContain("shop_inventory");
    expect(lineWrite).not.toContain("shop_price");

    // The loop BODY queries nothing. The `select` in the loop header is the
    // iteration over the snapshot itself, which is the whole point.
    const body = lineWrite.slice(lineWrite.indexOf("loop") + 4, lineWrite.indexOf("end loop;"));
    expect(body).not.toMatch(/\bselect\b/);
    expect(body).not.toMatch(/\bfrom\s+public\./);
  });

  it("carries money through jsonb as exact numeric, never as a float", () => {
    expect(create).toContain("(v_item ->> 'unit_price')::numeric(10,2)");
    expect(create).toContain("(v_item ->> 'line_total')::numeric(10,2)");
    expect(statements).not.toMatch(/\b(float|float4|float8|double precision|real)\b/i);
  });

  it("keeps the snapshot local — it is never returned", () => {
    expect(head("create_order")).not.toContain("v_resolved");
    const tail = create.slice(create.indexOf("order_id        := v_order_id;"));
    expect(tail).not.toContain("v_resolved");
  });
});

// ---------------------------------------------------------------------------

describe("the client still supplies no amount", () => {
  const signature = head("create_order");

  it("has no parameter for a price, amount or total", () => {
    const params = signature.slice(0, signature.indexOf("returns table ("));
    expect(params).not.toMatch(/amount|price|total|subtotal|discount/i);
  });

  it("takes only the six arguments it always took", () => {
    for (const p of ["p_request_id", "p_email", "p_items", "p_address",
                     "p_shipping_method", "p_payment_token"]) {
      expect(signature).toContain(p);
    }
    expect(signature).toContain("create or replace function public.create_order(");
  });

  it("reads nothing about money out of p_items", () => {
    const resolve = create.slice(
      create.indexOf("for v_item in select * from jsonb_array_elements(p_items)"),
      create.indexOf("v_resolved := v_resolved ||"),
    );
    for (const money of ["price", "amount", "total", "subtotal"]) {
      expect(resolve, `p_items must not carry ${money}`).not.toContain(`->> '${money}`);
    }
    // Only these three come from the caller.
    expect(resolve).toContain("v_item ->> 'sky_id'");
    expect(resolve).toContain("v_item ->> 'condition'");
    expect(resolve).toContain("v_item ->> 'quantity'");
  });
});

// ---------------------------------------------------------------------------

describe("everything else is unchanged", () => {
  it("keeps the signature and its security posture", () => {
    const signature = head("create_order");
    expect(signature).toContain("security definer");
    expect(signature).toContain("set search_path = ''");
    expect(signature).toContain("returns table (");
  });

  it("keeps every validation, with the same error codes", () => {
    for (const guard of [
      "a checkout needs a request id",
      "a checkout needs a payment capability",
      "this checkout belongs to somebody else",
      "a checkout needs a contact address",
      "a checkout needs at least one article",
      "SkyIsles delivers to Germany only",
      "unknown shipping method %",
      "invalid quantity for %",
      "article % / % is not offered",
    ]) {
      expect(create, `"${guard}" was dropped`).toContain(guard);
    }
    expect(create).toContain("using errcode = 'insufficient_privilege'");
    expect(create).toContain("using errcode = 'no_data_found'");
  });

  it("still hashes the capability and never stores the token", () => {
    expect(create).toContain("encode(sha256(convert_to(p_payment_token, 'utf8')), 'hex')");
    const events = create.slice(create.indexOf("insert into public.order_events"));
    expect(events).not.toContain("p_payment_token");
    expect(events).not.toContain("v_token_hash");
  });

  it("still enforces the checkout limits before writing anything", () => {
    const limits = create.indexOf("perform public.enforce_checkout_limits(");
    const insert = create.indexOf("insert into public.orders");
    expect(limits).toBeGreaterThan(-1);
    expect(limits).toBeLessThan(insert);
  });

  it("still reserves in the same call, after the lines exist", () => {
    const lines = create.indexOf("insert into public.order_lines");
    const reserve = create.indexOf("perform public.reserve_for_order(v_order_id)");
    expect(reserve).toBeGreaterThan(lines);
  });

  it("still writes the address and the placed event", () => {
    expect(create).toContain("insert into public.order_addresses");
    expect(create).toContain("'placed'");
  });

  it("returns the same five columns", () => {
    for (const column of ["order_id", "order_number", "items_subtotal",
                          "shipping_amount", "total_amount"]) {
      expect(head("create_order")).toContain(column);
    }
  });
});

// ---------------------------------------------------------------------------

describe("the idempotent retry is untouched", () => {
  const retry = create.slice(
    create.indexOf("if found then"),
    create.indexOf("if p_email is null"),
  );

  it("still proves the capability before handing an order back", () => {
    expect(retry).toContain("if v_existing.payment_token_hash is distinct from v_token_hash then");
    expect(retry).toContain("this checkout belongs to somebody else");
  });

  it("still updates no order amounts", () => {
    expect(retry).not.toContain("update public.orders");
    for (const column of ["items_subtotal", "shipping_amount", "total_amount"]) {
      expect(retry).not.toMatch(new RegExp(`set\\s+${column}\\s*=`));
    }
  });

  it("still writes nothing at all on that path", () => {
    expect(retry).not.toContain("insert into");
    expect(retry).not.toContain("gen_random");
    expect(retry).not.toContain("reserve_for_order");
  });

  it("returns the stored amounts rather than recomputing them", () => {
    expect(retry).toContain("items_subtotal  := v_existing.items_subtotal;");
    expect(retry).toContain("shipping_amount := v_existing.shipping_amount;");
    expect(retry).toContain("total_amount    := v_existing.total_amount;");
  });
});
