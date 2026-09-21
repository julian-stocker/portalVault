import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

/**
 * The trigger that turns a paid order into an Orderbuch sale, and the type
 * error that meant it had never once run.
 *
 * `orders_register_sale()` filled `sales.created_by` — a `uuid` with a
 * foreign key to `auth.users` — with `new.id * 0 + null`. `new.id` is
 * `orders.id`, a bigint, so the expression is a bigint-typed NULL and
 * PostgreSQL refuses it: 42804.
 *
 * It raised at runtime, not at definition time, so `0059` applied cleanly and
 * the fault waited for the first genuine payment to arrive after it. That was
 * order #65 on 2026-09-21; every internal sale before it came from `0060`'s
 * backfill, which is why they all share one `created_at`.
 */

const DIR = "supabase/migrations";
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const read = (name: string): string =>
  readFileSync(`${DIR}/${files.find((f) => f.startsWith(name))}`, "utf8");

/**
 * Comments are prose ABOUT the rule, not the rule.
 *
 * 0078 quotes the broken expression in its header to explain it, and a naive
 * scan reads that quotation as a fresh offence. Stripping first is what makes
 * the guards below about code.
 */
const code = (sql: string): string =>
  sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");

/** 0059 is applied history on both projects and is never edited. */
const HISTORICAL = files.find((f) => f.startsWith("0059_"))!;

const ORIGINAL = read("0059_");
const FIX = read("0078_");

/** The function body, from `create or replace` to its closing `$$;`. */
function trigger(sql: string): string {
  const start = sql.indexOf("create or replace function public.orders_register_sale()");
  expect(start, "orders_register_sale is defined").toBeGreaterThan(-1);
  return sql.slice(start, sql.indexOf("\n$$;", start));
}

describe("the bug, pinned so it cannot come back", () => {
  it("0059 really did assign a bigint expression to a uuid column", () => {
    // Kept as evidence: the test would be meaningless if the premise drifted.
    expect(trigger(ORIGINAL)).toContain("new.id * 0 + null");
  });

  it("no migration after 0059 carries that expression in its code", () => {
    const offenders = files.filter(
      (f) => f !== HISTORICAL && code(readFileSync(`${DIR}/${f}`, "utf8")).includes("* 0 + null"),
    );
    expect(offenders).toEqual([]);
  });

  /**
   * The narrow class guard. An actor column references `auth.users`, so the
   * only things that belong in one are a uuid or NULL — never something
   * derived from a row id, however it is dressed up.
   */
  it("no migration derives an actor column from a row id", () => {
    const bad: string[] = [];
    for (const f of files) {
      if (f === HISTORICAL) continue;
      for (const line of code(readFileSync(`${DIR}/${f}`, "utf8")).split("\n")) {
        if (/\bnew\.id\s*[*+\-]/.test(line)) bad.push(`${f}: ${line.trim()}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("0078 fixes it, and changes nothing else", () => {
  it("redefines the function", () => {
    expect(FIX).toContain("create or replace function public.orders_register_sale()");
  });

  it("writes a plain NULL, not a cast over the wrong value", () => {
    const body = trigger(FIX);
    expect(body).toContain("public.orderbook_global_factor(), null, null)");
    // No rescue-by-cast: that would keep a bigint expression and paper over it.
    expect(body).not.toMatch(/::uuid/);
    expect(body).not.toContain("new.id * 0");
  });

  /**
   * Extracted and patched rather than retyped — the same discipline 0077 used
   * for `start_payment_attempt`. This redoes the substitution and insists the
   * rest matches, so a silent drift in the idempotency guard, the paid check
   * or the conflict clause fails here.
   */
  it("differs from 0059 in that one expression and nowhere else", () => {
    const before = trigger(ORIGINAL);
    const after = trigger(FIX);
    const normalise = (s: string): string =>
      s
        .replace("public.orderbook_global_factor(), new.id * 0 + null, null)", "@@ACTOR@@")
        .replace("public.orderbook_global_factor(), null, null)", "@@ACTOR@@")
        .replace(/\s+/g, " ")
        .trim();
    expect(normalise(after)).toBe(normalise(before));
  });

  it("keeps every guarantee the trigger had", () => {
    const body = trigger(FIX);
    // Only on becoming paid, and only once.
    expect(body).toContain("if new.payment_status <> 'paid' then");
    expect(body).toContain("if tg_op = 'UPDATE' and old.payment_status = 'paid' then");
    // Idempotent through the partial unique index.
    expect(body).toContain("on conflict (order_id) where order_id is not null do nothing");
    // And it still creates no inventory movement.
    expect(body).not.toContain("record_inventory_movement");
    expect(body).not.toContain("apply_inventory_movement");
    expect(body).not.toContain("shop_inventory");
  });

  it("does not touch the trigger itself, which needs no change", () => {
    // `create or replace function` is enough: the trigger binds by name.
    expect(FIX).not.toContain("create trigger");
    expect(FIX).not.toContain("drop trigger");
  });

  /**
   * A definition, not a data change. 0078 replaces one function body and
   * touches not a single row — no `do $$` block, no UPDATE, no DELETE.
   */
  it("changes no data at all", () => {
    const body = code(FIX);
    expect(body).not.toMatch(/^\s*update\s+public\./im);
    expect(body).not.toMatch(/^\s*delete\s+from\s+public\./im);
    expect(body).not.toContain("do $$");
  });
});
