import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

import { OFFER_CONDITIONS, V1_CONDITION } from "@/lib/shop/offer";

/**
 * `0028` — the loose-only contract, enforced where it cannot be bypassed.
 *
 * The application decides what to *show*; this migration decides what the
 * database will *accept*. Both `shop_quantity_available()` and `create_order()`
 * are reachable over PostgREST with the anon key, so until now a request built
 * outside the application could buy a boxed position: real stock, listed, at a
 * real price, through a purchase the product does not offer.
 *
 * What these tests guard is narrow and specific:
 *
 *  - the rule is added, not substituted — every other guarantee of both
 *    functions survives, because they were replaced with their own current
 *    definitions rather than reconstructed;
 *  - the rejection happens before anything is written, so a mixed cart cannot
 *    half-succeed;
 *  - nothing about the data model moves — `boxed` remains a legal value, and
 *    boxed rows are neither read nor written by the migration;
 *  - the SQL rule and `V1_CONDITION` say the same word.
 *
 * The first draft of this migration was built on `create_order` as it stood in
 * 0011 — five arguments, no commerce-mode gate, no capability hash. That
 * definition was superseded three times and its signature dropped outright in
 * 0014, so applying it would have resurrected the legacy overload and undone
 * four migrations of commerce work. Several assertions below exist only to
 * make that specific mistake loud.
 */
const MIGRATIONS = "supabase/migrations";
const MIGRATION = `${MIGRATIONS}/0028_v1_loose_only_commerce.sql`;

const sql = readFileSync(MIGRATION, "utf8");

/** Executable SQL: comment lines removed. */
const code = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

/** The migration with `comment on … is '…'` removed: prose, not code. */
const statements = code.replace(/comment on [\s\S]*?';/g, "");

/**
 * What the migration does when it is applied — every `$$ … $$` body removed.
 *
 * `create_order()` is full of INSERTs, and so it should be; the question this
 * answers is whether *applying* the migration writes anything, which is a
 * different question and the one F and G ask.
 */
const applied = statements.replace(/as \$\$[\s\S]*?\$\$;/g, "as $$ … $$;");

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

const quantity = fn("shop_quantity_available");
const order = fn("create_order");

/** The current definition each replacement was taken from. */
const source = {
  quantity: readFileSync(`${MIGRATIONS}/0009_shop_quantity_check.sql`, "utf8"),
  order: readFileSync(`${MIGRATIONS}/0021_commerce_mode.sql`, "utf8"),
};

function sourceBody(file: string, name: string): string {
  // Comment-stripped exactly as `code` is, so a diff compares SQL with SQL
  // rather than reporting every added comment line as a deletion.
  const stripped = file
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  const start = stripped.indexOf(`create or replace function public.${name}(`);
  expect(start, `${name} is missing from its own migration`).toBeGreaterThan(-1);
  const open = stripped.indexOf("as $$", start);
  return stripped.slice(open, stripped.indexOf("$$;", open));
}

/** Lines the replacement added to the definition it was taken from. */
function addedLines(before: string, after: string): string[] {
  const kept = new Map<string, number>();
  for (const line of before.split("\n")) kept.set(line, (kept.get(line) ?? 0) + 1);
  const added: string[] = [];
  for (const line of after.split("\n")) {
    const left = kept.get(line) ?? 0;
    if (left > 0) kept.set(line, left - 1);
    else added.push(line);
  }
  return added;
}

/** Lines the replacement dropped from the definition it was taken from. */
function removedLines(before: string, after: string): string[] {
  return addedLines(after, before);
}

describe("the migration is additive and replaces the definitions that are live", () => {
  it("holds its number alone, after the definitions it replaces", () => {
    /*
     * Not "is the newest migration": the series keeps growing, and an
     * assertion that breaks every time somebody adds a file is a false alarm
     * rather than a guard. What matters is that 0028 is unique — two files
     * claiming one number apply in an order nobody chose — and that it runs
     * after 0009 and 0021, whose definitions it replaces.
     */
    const numbers = readdirSync(MIGRATIONS)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => name.slice(0, 4));
    expect(numbers.filter((n) => n === "0028")).toHaveLength(1);
    for (const earlier of ["0009", "0021"]) {
      expect(numbers).toContain(earlier);
      expect("0028" > earlier, `0028 must run after ${earlier}`).toBe(true);
    }
  });

  it("replaces create_order as it stands in 0021, not an ancestor", () => {
    // 0011's version had five arguments and neither of these. Building on it
    // would have reverted 0013, 0016 and 0021 in one step.
    expect(head("create_order")).toContain("p_payment_token   text");
    expect(order).toContain("public.commerce_checkout_allowed()");
    expect(order).toContain("v_token_hash := encode(sha256(");
    expect(order).toContain("commerce_mode");
  });

  it("never re-creates the five-argument shim dropped in 0014", () => {
    expect(code).not.toContain("public.create_order(text, text, jsonb, jsonb, text)");
    expect(head("create_order").match(/p_[a-z_]+\s+(text|jsonb)/g)).toHaveLength(6);
  });

  it("removes nothing from either definition", () => {
    expect(removedLines(sourceBody(source.quantity, "shop_quantity_available"), quantity)).toEqual(
      [],
    );
    expect(removedLines(sourceBody(source.order, "create_order"), order)).toEqual([]);
  });

  it("adds exactly one executable line to shop_quantity_available", () => {
    const added = addedLines(
      sourceBody(source.quantity, "shop_quantity_available"),
      quantity,
    ).filter((line) => line.trim() && !line.trimStart().startsWith("--"));
    expect(added).toEqual(["         and i.condition = public.v1_sale_condition()"]);
  });

  it("adds only the guard to create_order", () => {
    const added = addedLines(sourceBody(source.order, "create_order"), order).filter(
      (line) => line.trim() && !line.trimStart().startsWith("--"),
    );
    expect(added).toEqual([
      "    if v_cond is distinct from public.v1_sale_condition() then",
      "      raise exception 'condition % is not offered', coalesce(v_cond, '(null)')",
      "        using errcode = 'check_violation';",
      "    end if;",
    ]);
  });

  it("changes no table, constraint, trigger, policy or index", () => {
    for (const forbidden of [
      "alter table",
      "create table",
      "drop table",
      "drop column",
      "add constraint",
      "drop constraint",
      "create trigger",
      "create policy",
      "create index",
      "drop function",
    ]) {
      expect(statements.toLowerCase(), `${forbidden} has no business here`).not.toContain(
        forbidden,
      );
    }
  });

  it("reads and writes no row at all (F, G)", () => {
    // Existing boxed inventory and existing boxed order lines are left exactly
    // as they are. A migration that touched them would be a data change, and
    // this one is a rule change. Measured outside the function bodies: what
    // `create_order()` inserts when somebody buys something is not what this
    // migration does when it is applied.
    for (const forbidden of ["insert into", "update public.", "delete from", "truncate"]) {
      expect(applied.toLowerCase(), `${forbidden} would change data`).not.toContain(forbidden);
    }
  });
});

describe("A — a loose article behaves exactly as it did", () => {
  it("keeps every condition shop_quantity_available already applied", () => {
    for (const clause of [
      "i.sky_id    = p_sky_id",
      "i.condition = p_condition",
      "i.available_quantity >= p_quantity",
      "i.is_listed",
      "public.is_shop_eligible(i.sky_id)",
    ]) {
      expect(quantity).toContain(clause);
    }
  });

  it("keeps the boolean contract and publishes no count", () => {
    expect(head("shop_quantity_available")).toContain("returns boolean");
    expect(head("shop_quantity_available")).toContain("language sql");
    expect(head("shop_quantity_available")).toContain("stable");
    expect(head("shop_quantity_available")).toContain("security definer");
    expect(head("shop_quantity_available")).toContain("set search_path = ''");
    expect(quantity).toContain("exists");
  });

  it("still takes the same three arguments in the same order", () => {
    expect(head("shop_quantity_available")).toContain("p_sky_id    text");
    expect(head("shop_quantity_available")).toContain("p_condition text");
    expect(head("shop_quantity_available")).toContain("p_quantity  integer");
  });
});

describe("B — a boxed article is not buyable", () => {
  it("narrows the same predicate rather than adding a second door", () => {
    // Both clauses stand: the caller's condition must match the row AND the
    // row's condition must be the one V1 sells. Dropping either one reopens it.
    expect(quantity).toContain("and i.condition = p_condition");
    expect(quantity).toContain("and i.condition = public.v1_sale_condition()");
  });

  it("answers with the boolean it always answered with, not an error", () => {
    // The brief was explicit: no invented error semantics for a function whose
    // whole contract is a boolean.
    expect(quantity).not.toContain("raise exception");
  });
});

describe("C — the successful order path is structurally untouched", () => {
  it("keeps the gate, the capability and the idempotent retry", () => {
    expect(order).toContain("if not public.commerce_checkout_allowed() then");
    expect(order).toContain("using errcode = 'insufficient_privilege'");
    expect(order).toContain("this checkout belongs to somebody else");
  });

  it("keeps two passes, with pricing in the first and writing in the second", () => {
    const resolve = order.indexOf("v_resolved := v_resolved || jsonb_build_object");
    const insertOrder = order.indexOf("insert into public.orders");
    const insertLines = order.indexOf("insert into public.order_lines");
    expect(resolve).toBeGreaterThan(-1);
    expect(resolve).toBeLessThan(insertOrder);
    expect(insertOrder).toBeLessThan(insertLines);
  });

  it("still prices through shop_price() and never from the caller", () => {
    expect(order).toContain("public.shop_price(i.sale_price, s.market_price, st.price_percentage)");
    expect(head("create_order")).not.toMatch(/p_(price|amount|total)/);
  });

  it("still writes the final amounts in the INSERT and updates none afterwards", () => {
    expect(order).toContain("v_subtotal, v_shipping, v_subtotal + v_shipping");
    expect(order).not.toContain("update public.orders");
  });

  it("returns the same five columns", () => {
    for (const column of [
      "order_id        bigint",
      "order_number    text",
      "items_subtotal  numeric",
      "shipping_amount numeric",
      "total_amount    numeric",
    ]) {
      expect(head("create_order")).toContain(column);
    }
  });
});

describe("D — a boxed position is refused explicitly", () => {
  it("validates the condition instead of letting the lookup miss", () => {
    expect(order).toContain("if v_cond is distinct from public.v1_sale_condition() then");
  });

  it("says what is actually wrong", () => {
    // "article X / boxed is not offered" would be untrue: the position exists,
    // is listed, is eligible and is priced. It is the request that is wrong.
    expect(order).toContain("raise exception 'condition % is not offered'");
  });

  it("raises the errcode the application already understands", () => {
    const guard = order.slice(order.indexOf("if v_cond is distinct from"));
    expect(guard.slice(0, guard.indexOf("end if;"))).toContain(
      "using errcode = 'check_violation'",
    );

    const actions = readFileSync("src/lib/commerce/actions.ts", "utf8");
    const set = actions.slice(actions.indexOf("const UNAVAILABLE"));
    expect(set.slice(0, set.indexOf(")"))).toContain("check_violation");
  });

  it("names the condition it rejected without crashing on a missing one", () => {
    expect(order).toContain("coalesce(v_cond, '(null)')");
  });
});

describe("E — a mixed cart is refused whole, never in part", () => {
  it("checks every position, inside the loop", () => {
    const loopStart = order.indexOf("for v_item in select * from jsonb_array_elements(p_items)");
    const loopEnd = order.indexOf("end loop;", loopStart);
    const guard = order.indexOf("if v_cond is distinct from");
    expect(loopStart).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(loopStart);
    expect(guard).toBeLessThan(loopEnd);
  });

  it("raises before the first write of any kind", () => {
    const guard = order.indexOf("if v_cond is distinct from");
    for (const write of [
      "insert into public.orders",
      "insert into public.order_lines",
      "insert into public.order_addresses",
      "insert into public.order_events",
      "perform public.reserve_for_order(v_order_id);",
    ]) {
      const at = order.indexOf(write);
      expect(at, `${write} is missing`).toBeGreaterThan(-1);
      expect(at, `${write} must come after the guard`).toBeGreaterThan(guard);
    }
  });

  it("catches nothing, so the exception aborts the transaction", () => {
    // A single `exception when others` anywhere in this function would turn a
    // refused line into a partial order.
    expect(order).not.toContain("exception when");
    expect(order).not.toContain("begin\n  exception");
  });

  it("reserves stock only once every position has been accepted", () => {
    expect(order.indexOf("perform public.reserve_for_order(v_order_id);")).toBeGreaterThan(
      order.indexOf("end loop;"),
    );
  });
});

describe("F, G — boxed stays a legal value and boxed rows stay as they are", () => {
  it("leaves both conditions in the application's vocabulary", () => {
    expect(OFFER_CONDITIONS).toContain("boxed");
    expect(OFFER_CONDITIONS).toContain("loose");
  });

  it("touches neither the CHECK constraint nor the column", () => {
    expect(code).not.toContain("shop_inventory_condition");
    expect(code.toLowerCase()).not.toContain("alter column");
  });

  it("keeps order_lines.condition able to hold a historical boxed line", () => {
    // Orders placed before this migration are still readable, and their lines
    // still say what was sold.
    expect(order).toContain("'condition',    v_cond");
    expect(order).toContain("v_item ->> 'condition'");
  });

  it("does not delete, archive or unlist a single boxed position", () => {
    expect(applied.toLowerCase()).not.toContain("is_listed = false");
    expect(applied.toLowerCase()).not.toContain("delete");
  });
});

describe("H — the application rule and the database rule are the same rule", () => {
  it("writes the condition in exactly one place in SQL", () => {
    const body = fn("v1_sale_condition");
    expect(body).toContain(`select '${V1_CONDITION}'::text`);

    // Nowhere else. A second literal is a second opinion waiting to drift.
    const literals = statements.match(/'loose'/g) ?? [];
    expect(literals).toHaveLength(1);
  });

  it("makes both commerce functions ask that one place", () => {
    expect(quantity).toContain("public.v1_sale_condition()");
    expect(order).toContain("public.v1_sale_condition()");
  });

  it("agrees with V1_CONDITION in the application", () => {
    expect(V1_CONDITION).toBe("loose");
    expect(fn("v1_sale_condition")).toContain(`'${V1_CONDITION}'`);
  });

  it("keeps the shared rule immutable and pinned", () => {
    expect(head("v1_sale_condition")).toContain("returns text");
    expect(head("v1_sale_condition")).toContain("immutable");
    expect(head("v1_sale_condition")).toContain("set search_path = ''");
  });
});

describe("the grants are restated, not widened", () => {
  it("re-states both pairs exactly as their own migrations wrote them", () => {
    for (const [file, signature] of [
      [source.quantity, "public.shop_quantity_available(text, text, integer)"],
      [source.order, "public.create_order(text, text, jsonb, jsonb, text, text)"],
    ] as const) {
      const lines = (text: string) =>
        text
          .split("\n")
          .map((line) => line.trim())
          .filter(
            (line) =>
              line.includes(signature) &&
              (line.startsWith("revoke") || line.startsWith("grant")),
          );
      expect(lines(code)).toEqual(lines(file));
    }
  });

  it("grants nothing to any role the functions did not already have", () => {
    const grants = code.split("\n").filter((line) => line.trimStart().startsWith("grant"));
    for (const line of grants) {
      expect(line).toContain("to anon, authenticated;");
      expect(line).not.toContain("public;");
      expect(line).not.toContain("service_role");
    }
  });

  it("closes the new helper to everybody, since a new function is PUBLIC by default", () => {
    expect(code).toContain(
      "revoke all on function public.v1_sale_condition() from public, anon, authenticated;",
    );
    expect(code).not.toMatch(/grant execute on function public\.v1_sale_condition/);
  });

  it("keeps both commerce functions security definer with a pinned path", () => {
    for (const name of ["shop_quantity_available", "create_order"]) {
      expect(head(name)).toContain("security definer");
      expect(head(name)).toContain("set search_path = ''");
    }
  });
});
