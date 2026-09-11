import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Migration 0020, the third and last carve-out of its kind.
 *
 * `inventory_movements` (ADR-0037) and `catalog_admin_changes` (ADR-0039) both
 * allow exactly one change to an append-only table: losing the personal
 * identifier when an account is deleted. `order_events` was missing it, which
 * made anyone who had ever placed or shipped an order permanently
 * undeletable — found on staging, not by reading.
 */
const SQL = readFileSync("supabase/migrations/0020_order_events_anonymisation.sql", "utf8");
const CODE = SQL.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");

const MOVEMENTS = readFileSync("supabase/migrations/0003_shop_foundation.sql", "utf8");
const RUNTIME = readFileSync(
  "supabase/tests/0020_order_events_anonymisation_runtime.sql",
  "utf8",
);

describe("the carve-out permits one change and no other", () => {
  it("requires the identifier to be lost, never gained or exchanged", () => {
    expect(CODE).toContain("if old.actor_user_id is not null");
    expect(CODE).toContain("and new.actor_user_id is null");
  });

  it("requires every factual column to be identical", () => {
    for (const column of ["id", "order_id", "event_type", "actor_kind", "payload", "created_at"]) {
      expect(CODE, column).toContain(`new.${column}`);
      expect(CODE, column).toContain(`old.${column}`);
    }
  });

  it("compares NULL-safely, because payload and the actor are nullable", () => {
    expect(CODE).toContain("is not distinct from");
    expect(CODE).not.toMatch(/new\.payload\s*=\s*old\.payload/);
  });

  it("refuses DELETE outright, with no branch at all", () => {
    const body = CODE.slice(CODE.indexOf("create or replace function public.prevent_order_event_change"));
    const afterUpdate = body.slice(body.indexOf("end if;", body.indexOf("if tg_op = 'UPDATE'")));
    expect(afterUpdate).toContain("raise exception");
    expect(afterUpdate).not.toContain("return new");
  });

  it("is not a general UPDATE permission", () => {
    // Exactly one `return new`, inside the one guarded branch.
    expect((CODE.match(/return new;/g) ?? []).length).toBe(1);
  });
});

describe("it copies the shape that already exists", () => {
  it("mirrors prevent_inventory_movement_change()", () => {
    for (const fragment of [
      "if tg_op = 'UPDATE' then",
      "is not distinct from",
      "using errcode = 'restrict_violation'",
    ]) {
      expect(CODE, fragment).toContain(fragment);
      expect(MOVEMENTS, fragment).toContain(fragment);
    }
  });

  it("leaves the siblings on the blanket guard", () => {
    // order_lines and order_addresses hold no account reference, so neither
    // can block a deletion and neither needs an exception.
    expect(CODE).not.toContain("order_lines");
    expect(CODE).not.toContain("order_addresses");
    expect(CODE).not.toContain("create or replace function public.deny_write");
  });

  it("replaces only the one trigger", () => {
    expect(CODE).toContain("drop trigger if exists order_events_append_only on public.order_events");
    expect((CODE.match(/create trigger/g) ?? []).length).toBe(1);
    expect((CODE.match(/drop trigger/g) ?? []).length).toBe(1);
  });

  it("touches no table, no column and no grant beyond the guard", () => {
    for (const forbidden of ["alter table", "create table", "add column", "grant "]) {
      expect(CODE, forbidden).not.toContain(forbidden);
    }
  });
});

describe("the runtime suite asks what was asked for", () => {
  it("proves a customer and an administrator can both be deleted", () => {
    expect(RUNTIME).toContain("'placed'");
    expect(RUNTIME).toContain("'order_shipped'");
    expect(RUNTIME).toContain("delete from auth.users");
  });

  it("proves the event survives, anonymised and otherwise unchanged", () => {
    expect(RUNTIME).toContain("the shipping event vanished with the account");
    expect(RUNTIME).toContain("the administrator survived the deletion");
    expect(RUNTIME).toContain("the shipping event was altered");
  });

  it("proves a direct UPDATE is still refused", () => {
    for (const message of [
      "event_type was rewritten",
      "payload was rewritten",
      "actor_kind was rewritten",
      "created_at was rewritten",
      "an anonymised actor was restored",
      "an order event was deleted",
      "a rewrite was smuggled in with the anonymisation",
    ]) {
      expect(RUNTIME, message).toContain(message);
    }
  });

  /**
   * Three earlier runtime files cost three round trips because they created
   * fixtures the author could not test. This one creates none.
   */
  it("creates no account of its own", () => {
    expect(RUNTIME).not.toContain("insert into auth.users");
  });

  it("only ever deletes throwaway accounts", () => {
    const deletes = [...RUNTIME.matchAll(/delete from auth\.users[^;]*/g)].map((m) => m[0]);
    expect(deletes.length).toBeGreaterThan(0);
    for (const statement of deletes) {
      expect(statement, statement).toMatch(/where id = v_user(\.id)?/);
    }
    // And the only way a v_user is chosen for deletion is the throwaway suffix.
    expect(RUNTIME).toContain("email like '%@staging.invalid'");
  });

  it("rolls back everything except the one section that says it commits", () => {
    expect((RUNTIME.match(/^begin;$/gm) ?? []).length).toBe(
      (RUNTIME.match(/^rollback;$/gm) ?? []).length,
    );
    expect(RUNTIME).not.toMatch(/^commit;$/m);
    expect(RUNTIME).toContain("COMMITS");
  });

  it("refuses a database that does not look like staging", () => {
    expect(RUNTIME).toContain("This does not look like staging");
  });
});
