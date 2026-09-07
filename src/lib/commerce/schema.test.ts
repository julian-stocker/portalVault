import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { FULFILLMENT_STATUSES, PAYMENT_STATUSES } from "@/lib/commerce/order";
import { RESERVATION_STATES, RESERVATION_TTL_MINUTES } from "@/lib/commerce/reservation";
import { MAX_LINE_QUANTITY } from "@/lib/cart/cart";

/**
 * The commerce core, as SQL (Phase A).
 *
 * The migration is NOT applied to any database, so nothing here executes it.
 * What these tests can do is hold the file to the contract the plan promised —
 * the guarantees that are easy to lose in a later edit and expensive to lose
 * in production: the deletion semantics, the locking order, the idempotency
 * keys, and the absence of tax and provider guesses.
 */
const MIGRATION = "supabase/migrations/0010_commerce_core.sql";
const sql = readFileSync(MIGRATION, "utf8");

/** SQL with the comment banners stripped, so assertions test code. */
const code = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

/** The body of one CREATE TABLE, for constraint assertions. */
function table(name: string): string {
  const start = code.indexOf(`create table public.${name} (`);
  expect(start, `table ${name} is missing`).toBeGreaterThan(-1);
  return code.slice(start, code.indexOf("\n);", start));
}

/** Everything between a function's name and its body — signature and flags. */
function fnHead(name: string): string {
  const start = code.indexOf(`create or replace function public.${name}(`);
  if (start < 0) return "";
  return code.slice(start, code.indexOf("as $$", start));
}

/** The body of one function, between its $$ markers. */
function fn(name: string): string {
  const start = code.indexOf(`create or replace function public.${name}(`);
  expect(start, `function ${name} is missing`).toBeGreaterThan(-1);
  const open = code.indexOf("as $$", start);
  return code.slice(open, code.indexOf("$$;", open));
}

describe("the tables exist and nothing else does", () => {
  const expected = [
    "commerce_settings",
    "orders",
    "order_lines",
    "order_addresses",
    "order_events",
    "order_reservations",
  ];

  it("creates exactly the five Phase A tables", () => {
    const created = [...code.matchAll(/create table public\.(\w+) \(/g)].map((m) => m[1]);
    expect(created.sort()).toEqual([...expected].sort());
  });

  it("creates no payment or invoice table yet", () => {
    // Both belong to later phases and to decisions that are still open.
    for (const absent of ["payment_attempts", "payment_events", "invoices", "refunds"]) {
      expect(code).not.toContain(`create table public.${absent}`);
    }
  });

  it("alters no existing table", () => {
    // Additive means additive: 0010 adds objects, it does not change any.
    expect(code).not.toMatch(/alter table public\.(shop_inventory|inventory_movements|skylanders|profiles)/);
    expect(code).not.toMatch(/\bdrop\s+(table|function|column|constraint)\b/i);
  });

  it("re-signs none of the existing shop functions", () => {
    for (const existing of [
      "apply_inventory_movement",
      "record_inventory_movement",
      "shop_offers",
      "shop_quantity_available",
      "is_shop_eligible",
      "shop_price",
    ]) {
      expect(code).not.toContain(`create or replace function public.${existing}(`);
    }
  });
});

describe("an order survives its customer", () => {
  it("sets user_id to NULL rather than deleting the order", () => {
    // The single most important foreign key in the file: an order is a
    // commercial document with a retention obligation.
    const orders = table("orders");
    expect(orders).toContain("references auth.users (id)");
    expect(orders).toContain("on delete set null");
    expect(orders).not.toContain("on delete cascade");
  });

  it("keeps the contact address so the order still has one", () => {
    expect(table("orders")).toMatch(/customer_email text\s+not null/);
  });

  it("allows user_id to be cleared, and only cleared", () => {
    const trigger = fn("orders_protect_immutable");
    expect(trigger).toContain("new.user_id is distinct from old.user_id and new.user_id is not null");
  });

  it("refuses to delete an order that has lines", () => {
    expect(table("order_lines")).toContain("on delete restrict");
  });
});

describe("the two status axes", () => {
  it("stores payment and fulfillment separately", () => {
    const orders = table("orders");
    expect(orders).toContain("payment_status     text not null");
    expect(orders).toContain("fulfillment_status text not null");
  });

  it("matches the payment statuses the application knows", () => {
    const check = code.slice(code.indexOf("orders_payment_status_known"));
    const values = [...check.slice(0, check.indexOf("))")).matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(values.sort()).toEqual([...PAYMENT_STATUSES].sort());
  });

  it("matches the fulfillment statuses the application knows", () => {
    const check = code.slice(code.indexOf("orders_fulfillment_status_known"));
    const values = [...check.slice(0, check.indexOf("))")).matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(values.sort()).toEqual([...FULFILLMENT_STATUSES].sort());
  });

  it("mixes no withdrawal or return state into either", () => {
    for (const later of ["withdraw", "return", "complaint", "revoked"]) {
      expect(table("orders").toLowerCase()).not.toContain(later);
    }
  });
});

describe("amounts are facts, not opinions", () => {
  it("makes the total the sum of its named parts", () => {
    expect(table("orders")).toContain(
      "check (total_amount = items_subtotal + shipping_amount - discount_amount)",
    );
  });

  it("makes a line total the sum of its own parts", () => {
    expect(table("order_lines")).toContain(
      "check (line_total = round(unit_price * quantity, 2) - discount_amount)",
    );
  });

  it("refuses a line without a price", () => {
    expect(table("order_lines")).toContain("check (unit_price > 0)");
  });

  it("keeps a timestamp and its status in agreement", () => {
    expect(table("orders")).toContain("orders_paid_at_matches_status");
  });
});

describe("the snapshot really is one", () => {
  it("stores the name and picture with the line", () => {
    const lines = table("order_lines");
    expect(lines).toContain("name_snapshot  text not null");
    expect(lines).toContain("image_snapshot text");
  });

  it("does not join sky_id back to a mutable catalog row", () => {
    // A cascade here would let a rename or a delete rewrite history.
    const lines = table("order_lines");
    expect(lines).not.toMatch(/references public\.skylanders/);
  });

  it("refuses to update or delete a sold line", () => {
    expect(code).toContain("create trigger order_lines_append_only");
    expect(code).toContain("before update or delete on public.order_lines");
  });

  it("freezes an order's identity and its money", () => {
    const trigger = fn("orders_protect_immutable");
    for (const frozen of [
      "order_number",
      "request_id",
      "placed_at",
      "currency",
      "customer_email",
      "items_subtotal",
      "shipping_amount",
      "discount_amount",
      "total_amount",
    ]) {
      expect(trigger).toContain(`new.${frozen}`);
    }
  });
});

describe("order numbers", () => {
  it("come from a sequence, so two checkouts cannot collide", () => {
    expect(code).toContain("create sequence if not exists public.order_number_seq");
    expect(fn("next_order_number")).toContain("nextval('public.order_number_seq')");
  });

  it("are set by the column default, never by a caller", () => {
    expect(table("orders")).toContain("default public.next_order_number()");
  });

  it("are unique and human-readable", () => {
    expect(table("orders")).toContain("unique (order_number)");
    expect(fn("next_order_number")).toContain("'SI-'");
    expect(fn("next_order_number")).toContain("lpad(");
  });

  it("are not the primary key", () => {
    expect(table("orders")).toContain("id            bigint      generated always as identity primary key");
  });
});

describe("reservations", () => {
  it("knows exactly the three states the application knows", () => {
    const check = code.slice(code.indexOf("order_reservations_state_known"));
    const values = [...check.slice(0, check.indexOf("))")).matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(values.sort()).toEqual([...RESERVATION_STATES].sort());
  });

  it("cannot reserve the same position twice for one order", () => {
    expect(table("order_reservations")).toContain("unique (order_id, inventory_id)");
  });

  it("cannot turn two reservations into one movement", () => {
    expect(table("order_reservations")).toContain("order_reservations_movement_unique unique (movement_id)");
  });

  it("keeps a state and its timestamp in agreement", () => {
    const reservations = table("order_reservations");
    expect(reservations).toContain("check ((state = 'released') = (released_at is not null))");
    expect(reservations).toContain("check ((state = 'converted') = (converted_at is not null))");
  });

  it("is released rather than deleted, so a number stays explainable", () => {
    expect(code).toContain("create trigger order_reservations_no_delete");
    expect(code).toContain("before delete on public.order_reservations");
  });
});

describe("the reservation timeout", () => {
  it("is defined once, in the database", () => {
    expect(fn("reservation_ttl")).toContain("interval '20 minutes'");
  });

  it("matches the constant the application shows", () => {
    const declared = fn("reservation_ttl").match(/interval '(\d+) minutes'/);
    expect(declared).not.toBeNull();
    expect(Number(declared![1])).toBe(RESERVATION_TTL_MINUTES);
  });

  it("is applied by the server, never taken from a caller", () => {
    const reserve = fn("reserve_for_order");
    expect(reserve).toContain("now() + public.reservation_ttl()");
    // No expiry parameter exists to pass one in.
    expect(code).not.toMatch(/reserve_for_order\([^)]*expires/);
  });
});

describe("holding stock is all or nothing", () => {
  const reserve = fn("reserve_for_order");

  it("locks every position before deciding anything", () => {
    expect(reserve).toContain("for update");
    expect(reserve).toContain("where i.id = any (v_ids)");
  });

  it("locks them in a fixed order, which is the deadlock protection", () => {
    expect(reserve).toContain("array_agg(distinct l.inventory_id order by l.inventory_id)");
    expect(reserve).toContain("order by i.id");
  });

  it("sweeps expired holds while it has the locks", () => {
    const locked = reserve.indexOf("for update");
    const swept = reserve.indexOf("release_expired_reservations(v_ids)");
    expect(swept).toBeGreaterThan(locked);
  });

  it("re-checks eligibility and price rather than trusting the cart", () => {
    expect(reserve).toContain("public.is_shop_eligible(i.sky_id)");
    expect(reserve).toContain("public.shop_price(i.sale_price, s.market_price, st.price_percentage)");
    expect(reserve).toContain("i.is_listed");
  });

  it("tests availability inside the UPDATE, not before it", () => {
    // No window between reading a stock level and writing a new one.
    expect(reserve).toContain("set reserved = reserved + v_row.quantity");
    expect(reserve).toContain("and quantity - reserved >= v_row.quantity");
  });

  it("raises on the first shortfall, so nothing stays half reserved", () => {
    expect(reserve).toContain("raise exception 'not enough stock for % / %'");
  });

  it("takes no stock off the shelf and books no movement", () => {
    // Nothing has been sold: quantity is untouched and the journal is silent.
    expect(reserve).not.toContain("set quantity");
    expect(reserve).not.toContain("apply_inventory_movement");
  });
});

describe("giving stock back", () => {
  it("only ever touches a reservation that is still active", () => {
    for (const name of ["release_expired_reservations", "release_order_reservations"]) {
      expect(fn(name)).toContain("and state = 'active'");
    }
  });

  it("lowers reserved only when it actually changed the state", () => {
    // `if found` after the guarded UPDATE is what makes a second call a no-op.
    for (const name of ["release_expired_reservations", "release_order_reservations"]) {
      const body = fn(name);
      expect(body).toContain("if found then");
      expect(body).toContain("set reserved = reserved - v_row.quantity");
    }
  });

  it("refuses an impossible number rather than clamping it away", () => {
    // A valid active reservation means `reserved` covers it. If it does not,
    // the ledger and the counter have already diverged and the transaction
    // must roll back loudly — greatest(0, ...) would hide that forever.
    expect(code).not.toContain("greatest(0");
    for (const name of ["release_expired_reservations", "release_order_reservations"]) {
      const body = fn(name);
      expect(body).toContain("set reserved = reserved - v_row.quantity");
      expect(body).toContain("and reserved >= v_row.quantity");
      expect(body).toContain("using errcode = 'data_corrupted'");
    }
  });

  it("can be scoped to the positions a checkout is about to lock", () => {
    expect(code).toContain("release_expired_reservations(\n  p_inventory_ids bigint[] default null\n)");
    expect(fn("release_expired_reservations")).toContain(
      "(p_inventory_ids is null or r.inventory_id = any (p_inventory_ids))",
    );
  });

  it("installs no scheduler", () => {
    // Infrastructure is a decision of its own; 0010 only ships the primitive.
    expect(code).not.toMatch(/pg_cron|cron\.schedule|create extension/i);
  });
});

describe("turning a hold into a sale", () => {
  const convert = fn("convert_order_reservations");

  it("claims the reservation under lock before booking anything", () => {
    expect(convert).toContain("for update of r");
    const claim = convert.indexOf("set state = 'converted'");
    const book = convert.indexOf("apply_inventory_movement");
    expect(claim).toBeGreaterThan(-1);
    expect(book).toBeGreaterThan(claim);
  });

  it("does nothing at all on a second call", () => {
    expect(convert).toContain("and state = 'active'");
    expect(convert).toContain("if not found then\n      continue;");
  });

  it("lowers reserved before booking, or the journal's own guard would trip", () => {
    const release = convert.indexOf("set reserved = reserved - v_row.quantity");
    const book = convert.indexOf("apply_inventory_movement");
    expect(release).toBeGreaterThan(-1);
    expect(book).toBeGreaterThan(release);
  });

  it("books through the existing journal, not a second inventory path", () => {
    expect(convert).toContain("public.apply_inventory_movement(");
    expect(convert).toContain("'sale_skyisles'");
    expect(convert).not.toContain("insert into public.inventory_movements");
    expect(convert).not.toContain("set quantity = quantity");
  });

  it("records which movement the reservation became", () => {
    expect(convert).toContain("set movement_id = v_movement_id");
  });

  it("is called by nothing yet", () => {
    // The payment phase calls it; Phase A only ships it. It appears three
    // times — the definition, the comment and the revoke — and in no other
    // function's body.
    expect(code.match(/convert_order_reservations\(/g) ?? []).toHaveLength(3);
    for (const caller of ["create_order", "reserve_for_order", "release_order_reservations"]) {
      expect(fn(caller)).not.toContain("convert_order_reservations");
    }
  });
});

describe("creating an order", () => {
  const create = fn("create_order");

  it("takes no price, total or discount from the caller", () => {
    const signature = code.slice(
      code.indexOf("create or replace function public.create_order("),
      code.indexOf("returns table (order_id bigint, order_number text)"),
    );
    for (const forbidden of ["price", "total", "amount", "discount", "subtotal"]) {
      expect(signature.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("reads every price from the one function that decides prices", () => {
    expect(create).toContain("public.shop_price(i.sale_price, s.market_price, st.price_percentage)");
  });

  it("re-checks that the article may be sold at all", () => {
    expect(create).toContain("i.is_listed");
    expect(create).toContain("public.is_shop_eligible(i.sky_id)");
  });

  it("refuses an article that is not offered", () => {
    expect(create).toContain("raise exception 'article % / % is not offered'");
  });

  it("bounds the quantity by the cart's own maximum", () => {
    expect(create).toContain("v_qty > public.max_cart_quantity()");
  });

  it("takes the customer from the session, never from the payload", () => {
    expect(create).toContain("v_user_id  uuid := (select auth.uid());");
  });

  it("accepts a guest, because auth.uid() may be NULL", () => {
    // No branch rejects a missing user; the email is what is required.
    expect(create).not.toMatch(/if v_user_id is null then\s+raise/);
    expect(create).toContain("raise exception 'a checkout needs a contact address'");
  });

  it("returns the existing order for a repeated request id", () => {
    expect(create).toContain("where o.request_id = p_request_id");
    expect(create).toContain("if found then");
  });

  it("reserves in the same call, so an order is never created unheld", () => {
    expect(create).toContain("perform public.reserve_for_order(v_order_id)");
  });

  it("writes shipping as zero rather than guessing a price", () => {
    // Carrier, countries and prices are open decisions.
    expect(create).toContain("total_amount   = v_subtotal");
    expect(create).not.toMatch(/shipping_amount\s*=\s*[1-9]/);
  });
});

describe("nothing about tax or a payment provider is guessed", () => {
  it("has no tax column, rate or arithmetic", () => {
    // Word boundaries, not substrings: "ust" lives inside "customer_email".
    const forbidden = /\btax\w*|\bvat\b|\bust\b|\bsteuer\w*|\bmargin\b|\bnetto\b|\bbrutto\b/i;
    expect(table("orders")).not.toMatch(forbidden);
    expect(table("order_lines")).not.toMatch(forbidden);
  });

  it("names no payment provider anywhere", () => {
    for (const provider of ["stripe", "mollie", "paypal", "klarna", "adyen"]) {
      expect(code.toLowerCase()).not.toContain(provider);
    }
  });
});

describe("no client may write, and none may read what is not theirs", () => {
  it("enables row level security on every new table", () => {
    for (const t of ["commerce_settings", "orders", "order_lines", "order_addresses", "order_events", "order_reservations"]) {
      expect(code, `${t} has no RLS`).toMatch(
        new RegExp(`alter table public\\.${t}\\s+enable row level security;`),
      );
    }
  });

  it("grants no write privilege to any client role", () => {
    const grants = [...code.matchAll(/grant ([^;]+?) on public\.[^;]+? to ([^;]+);/g)];
    for (const [, privileges, roles] of grants) {
      if (!/anon|authenticated/.test(roles)) continue;
      expect(privileges).not.toMatch(/insert|update|delete|all/i);
    }
  });

  it("gives anon nothing at all", () => {
    expect(code).toContain("revoke all on public.orders, public.order_lines, public.order_addresses,");
    expect(code).not.toMatch(/grant select on public\.orders[^;]*to[^;]*anon/);
  });

  it("has no INSERT, UPDATE or DELETE policy anywhere", () => {
    expect(code).not.toMatch(/create policy[\s\S]{0,120}for (insert|update|delete)/);
  });

  it("lets a customer read only their own order", () => {
    expect(code).toContain("using ((select auth.uid()) = user_id)");
  });

  it("keeps reservations and the audit trail away from clients entirely", () => {
    expect(code).not.toMatch(/grant[^;]*public\.order_reservations[^;]*to (anon|authenticated)/);
    expect(code).not.toMatch(/grant[^;]*public\.order_events[^;]*to (anon|authenticated)/);
  });
});

describe("the functions are safe to expose, or not exposed", () => {
  it("pins search_path on every one of them", () => {
    // Trigger functions are excluded: they return `trigger`, which PostgREST
    // does not expose as an RPC at all, and calling one outside a trigger
    // raises. They are unreachable by construction rather than by grant.
    const defined = [...code.matchAll(/create or replace function public\.(\w+)\(/g)]
      .map((m) => m[1])
      .filter((name) => !fnHead(name).includes("returns trigger"));
    expect(defined.length).toBeGreaterThan(5);
    for (const name of defined) {
      const start = code.indexOf(`create or replace function public.${name}(`);
      const head = code.slice(start, code.indexOf("as $$", start));
      expect(head, `${name} does not pin search_path`).toContain("set search_path = ''");
    }
  });

  it("exposes only create_order to client roles", () => {
    const granted = [...code.matchAll(/grant execute on function public\.(\w+)\([^)]*\) to ([^;]+);/g)]
      .filter(([, , roles]) => /anon|authenticated/.test(roles))
      .map(([, name]) => name);
    expect(granted).toEqual(["create_order"]);
  });

  it("revokes every non-public function from all three roles, not just PUBLIC", () => {
    // The bug this exists to prevent: Supabase's default privileges grant
    // EXECUTE on every new function in `public` to `anon` and `authenticated`
    // explicitly, so `revoke ... from public` alone leaves them reachable.
    // reservation_ttl() and next_order_number() shipped that way in 0010 and
    // were live in production until the grants were corrected.
    // Trigger functions are excluded: they return `trigger`, which PostgREST
    // does not expose as an RPC at all, and calling one outside a trigger
    // raises. They are unreachable by construction rather than by grant.
    const defined = [...code.matchAll(/create or replace function public\.(\w+)\(/g)]
      .map((m) => m[1])
      .filter((name) => !fnHead(name).includes("returns trigger"));
    const granted = [...code.matchAll(/grant execute on function public\.(\w+)\([^)]*\) to ([^;]+);/g)]
      .filter(([, , roles]) => /anon|authenticated/.test(roles))
      .map(([, name]) => name);

    for (const name of defined) {
      if (granted.includes(name)) continue;
      const revoke = code.match(
        new RegExp(`revoke all on function public\\.${name}\\([^)]*\\)\\s+from ([^;]+);`),
      );
      expect(revoke, `${name} is never revoked`).not.toBeNull();
      expect(revoke![1], `${name} is revoked only from ${revoke![1]}`).toContain("anon");
      expect(revoke![1], `${name} is revoked only from ${revoke![1]}`).toContain("authenticated");
    }
  });

  it("keeps the stock primitives callable by nobody", () => {
    for (const internal of [
      "reserve_for_order",
      "release_order_reservations",
      "release_expired_reservations",
      "convert_order_reservations",
      "enforce_checkout_limits",
      "request_client_hash",
      "reservation_ttl",
      "next_order_number",
    ]) {
      expect(code, `${internal} is not fully revoked`).toMatch(
        new RegExp(`revoke all on function public\\.${internal}\\([^)]*\\)\\s+from public, anon, authenticated;`),
      );
    }
  });
});

describe("reconciliation, in the shape the stock journal already uses", () => {
  it("compares reserved against the sum of active holds", () => {
    expect(code).toContain("create or replace view public.reservation_reconciliation");
    expect(code).toContain("(i.reserved - coalesce(h.held, 0))::integer as drift");
    expect(code).toContain("where r.state = 'active'");
  });

  it("is not readable by any client role", () => {
    expect(code).toContain("revoke all on public.reservation_reconciliation from anon, authenticated;");
  });
});

describe("the cart is untouched", () => {
  it("still bounds a line by the cart's own maximum", () => {
    expect(MAX_LINE_QUANTITY).toBe(99);
    expect(code).toContain("public.max_cart_quantity()");
  });

  it("adds no reservation to the cart itself", () => {
    // The cart's prose says it reserves nothing; what matters is that its
    // code calls none of the reservation primitives.
    for (const path of ["src/lib/cart/cart.ts", "src/lib/cart/store.ts"]) {
      const source = readFileSync(path, "utf8")
        .split("\n")
        .filter((line) => {
          const t = line.trimStart();
          return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
        })
        .join("\n");
      expect(source).not.toMatch(/reserve_for_order|order_reservations|create_order/);
    }
  });
});

describe("holding stock cannot be hoarded", () => {
  const limits = fn("enforce_checkout_limits");

  it("is enforced in the database, where it cannot be routed around", () => {
    // The application uses the anon key with the visitor's session, so a
    // server action and a direct RPC call are the same database role. A limit
    // in TypeScript would be bypassed by one curl.
    expect(fn("create_order")).toContain("perform public.enforce_checkout_limits(");
  });

  it("runs before anything is written or held", () => {
    const create = fn("create_order");
    expect(create.indexOf("enforce_checkout_limits")).toBeLessThan(
      create.indexOf("insert into public.orders"),
    );
  });

  it("counts three things, not one", () => {
    expect(limits).toContain("max_open_checkouts");
    expect(limits).toContain("max_reserved_units");
    expect(limits).toContain("max_orders_per_hour");
  });

  it("matches an identity on any of three dimensions", () => {
    // A single dimension is rotated in a second; an email is free.
    expect(limits).toContain("o.user_id = p_user_id");
    expect(limits).toContain("lower(o.customer_email) = lower(p_email)");
    expect(limits).toContain("o.client_hash = p_client_hash");
  });

  it("counts only holds that are still live", () => {
    expect(limits).toContain("r.state = 'active'");
    expect(limits).toContain("r.expires_at > now()");
  });

  it("needs no counter table, scheduler or external service", () => {
    // Everything is derived from state that already exists.
    expect(code).not.toMatch(/rate_limit|throttle_counter|redis|upstash/i);
  });

  it("keeps the limits changeable without a deployment", () => {
    expect(code).toContain("create table public.commerce_settings");
    expect(table("commerce_settings")).toContain("max_open_checkouts   integer not null default 5");
  });

  it("is generous enough for a customer who retries", () => {
    const defaults = table("commerce_settings");
    expect(defaults).toMatch(/max_open_checkouts\s+integer not null default ([5-9]|\d\d)/);
  });
});

describe("the client fingerprint is not an address", () => {
  const hash = fn("request_client_hash");

  it("stores a salted hash and never the address itself", () => {
    expect(hash).toContain("sha256(convert_to(v_salt || ':' || v_ip, 'utf8'))");
    expect(table("orders")).toContain("client_hash text");
    expect(table("orders")).not.toMatch(/\bip\b|ip_address|remote_addr/i);
  });

  it("keeps the salt out of reach of every client", () => {
    expect(code).toContain("revoke all on public.commerce_settings from anon, authenticated;");
    expect(table("commerce_settings")).toContain("client_salt text not null default gen_random_uuid()::text");
  });

  it("returns NULL rather than one shared bucket when there is no address", () => {
    // A constant hash would throttle every visitor as if they were one person.
    expect(hash).toContain("if v_ip = '' then\n    return null;");
    expect(hash).toContain("when others then");
  });

  it("can only ever be cleared, never rewritten", () => {
    expect(fn("orders_protect_immutable")).toContain(
      "new.client_hash is distinct from old.client_hash and new.client_hash is not null",
    );
  });
});

describe("a late payment cannot oversell", () => {
  it("converts only what is still active", () => {
    expect(fn("convert_order_reservations")).toContain("and r.state = 'active'");
  });

  it("never revives a released reservation", () => {
    const convert = fn("convert_order_reservations");
    expect(convert).not.toContain("'released'");
    expect(convert).not.toMatch(/set state = 'active'/);
  });

  it("leaves the shortfall visible instead of forcing the sale", () => {
    // The count comes back lower than the order has lines; the payment phase
    // compares them and sets needs_resolution.
    expect(code).toContain("needs_resolution");
    expect(sql).toContain("The payment phase must compare the two and set needs_resolution rather than oversell.");
  });
});
