import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Which movements Lager V2 shows, and on what evidence (0083–0085).
 *
 * The rule these all serve: a movement is test or technical because a
 * REFERENCE or a CHECKED COLUMN says so, never because its note reads like
 * it. The notes say `sandbox test order …` and `verify-rls`, and they would
 * have been the easy way — which is exactly why none of these files may
 * use them.
 */
function file(path: string): string {
  return readFileSync(path, "utf8");
}
/** The file without its comments — what it does, not what it says. */
function code(path: string): string {
  return file(path)
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("--") && !trimmed.startsWith("*")
        && !trimmed.startsWith("//") && !trimmed.startsWith("/*");
    })
    .join("\n");
}

const LINK = code("supabase/migrations/0083_sandbox_return_is_linked.sql");
const BACKFILL = code("supabase/migrations/0084_backfill_sandbox_return_links.sql");
const READ = code("supabase/migrations/0085_business_movements.sql");
/** The query itself, without the prose of `comment on function`. */
const READ_BODY = READ.slice(READ.indexOf("return query"), READ.indexOf("comment on function"));
const QUERIES = code("src/lib/admin/inventory.ts");
const FOUNDATION = code("supabase/migrations/0003_shop_foundation.sql");

describe("0083 — a sandbox return gets a way back to its order", () => {
  it("adds the column beside the one that already exists", () => {
    expect(LINK).toContain("add column if not exists reverted_movement_id bigint");
    expect(LINK).toContain("references public.inventory_movements (id)");
    expect(LINK).toContain("on delete restrict");
  });

  it("lets one movement belong to one reservation and no more", () => {
    expect(LINK).toContain("create unique index if not exists order_reservations_one_return_each");
    expect(LINK).toContain("where reverted_movement_id is not null");
  });

  it("keeps the id the revert already had in its hand", () => {
    expect(LINK).toContain("v_movement_id := public.apply_inventory_movement(");
    expect(LINK).toMatch(
      /update public\.order_reservations\s+set reverted_movement_id = v_movement_id\s+where id = v_row\.id;/,
    );
  });

  it("changes nothing else about the revert", () => {
    // The sandbox guard, the idempotency check and the event all stay.
    expect(LINK).toContain("if v_order.commerce_mode <> 'sandbox' then");
    expect(LINK).toContain("and e.event_type = 'sandbox_stock_reverted'");
    expect(LINK).toContain("insert into public.order_events");
    expect(LINK).toContain("and r.state = 'converted'");
  });
});

describe("0084 — the backfill guesses at nothing", () => {
  it("never reads a note", () => {
    expect(BACKFILL).not.toContain("m.note");
    expect(BACKFILL).not.toContain("sandbox test order");
    expect(BACKFILL).not.toMatch(/\blike\b/i);
  });

  it("matches on the structure the revert actually leaves behind", () => {
    expect(BACKFILL).toContain("m.reason = 'return'");
    expect(BACKFILL).toContain("m.inventory_id = v_reservation.inventory_id");
    expect(BACKFILL).toContain("m.delta = v_reservation.quantity");
    expect(BACKFILL).toContain("m.created_at between");
    expect(BACKFILL).toContain("o.commerce_mode = 'sandbox'");
    expect(BACKFILL).toContain("e.event_type = 'sandbox_stock_reverted'");
  });

  it("takes only a movement no other reservation has claimed", () => {
    expect(BACKFILL).toContain("where other.reverted_movement_id = m.id");
  });

  it("raises on zero candidates and on more than one", () => {
    expect(BACKFILL).toContain("if v_matches <> 1 then");
    expect(BACKFILL).toContain("0084 refuses to guess");
    expect(BACKFILL).toContain("errcode = 'restrict_violation'");
  });

  it("refuses a partial result", () => {
    expect(BACKFILL).toContain("if v_linked <> v_pending then");
  });

  it("hardcodes no environment count, so a fresh database is correct", () => {
    // The concrete numbers belong in the preview and verify gates, where
    // they are an expectation about one database rather than an assumption
    // baked into the schema.
    expect(BACKFILL).not.toMatch(/v_pending\s*<>\s*\d/);
    expect(BACKFILL).not.toMatch(/=\s*8\b/);
    expect(BACKFILL).toContain("if v_pending = 0 then");
  });

  it("writes one column and touches no movement", () => {
    const updates = BACKFILL.match(/update public\.\w+/g) ?? [];
    expect(updates).toEqual(["update public.order_reservations"]);
    expect(BACKFILL).not.toContain("delete from");
    expect(BACKFILL).not.toContain("insert into public.inventory_movements");
  });
});

describe("0085 — what the business sees", () => {
  it("is seller-gated and reads only", () => {
    expect(READ).toContain("if not public.can_operate_active_seller() then");
    expect(READ).toContain("stable");
    expect(READ).toContain("grant execute on function public.seller_business_movements(bigint, integer) to authenticated");
    expect(READ).toContain("revoke all on function public.seller_business_movements(bigint, integer) from public, anon");
  });

  it("excludes the technical legacy opening balance", () => {
    expect(READ).toContain("m.reason <> 'initial_import'");
  });

  it("excludes fixture positions by their number, not their name", () => {
    expect(READ).toContain("< 9000");
    expect(READ).not.toContain("Fixture'");
    expect(READ).not.toContain("SKY-9998");
  });

  it("excludes what a sandbox order took out and what it put back", () => {
    expect(READ).toContain("o.commerce_mode = 'sandbox'");
    expect(READ).toContain("r.movement_id = m.id or r.reverted_movement_id = m.id");
  });

  it("excludes what an is_test sale booked or returned", () => {
    expect(READ).toContain("s.is_test");
    expect(READ).toContain("si.movement_id = m.id or si.return_movement_id = m.id");
  });

  it("decides none of it by reading a note", () => {
    // `m.note` is selected for display. It must not appear in a predicate.
    const where = READ.slice(READ.indexOf("where m.inventory_id"), READ.indexOf("order by m.created_at"));
    expect(where).not.toContain("note");
    expect(where).not.toMatch(/\blike\b/i);
  });

  it("keeps every real reason visible", () => {
    // Only one reason is named at all, and it is the technical one.
    const named = [...READ.matchAll(/m\.reason\s*(?:<>|=)\s*'(\w+)'/g)].map((m) => m[1]);
    expect(named).toEqual(["initial_import"]);
    for (const reason of ["purchase", "sale", "sale_external", "return", "correction", "writeoff"]) {
      expect(READ).not.toContain(`m.reason <> '${reason}'`);
    }
  });

  it("leaves the audit function alone", () => {
    // Named in the function's comment, never called by its body.
    expect(READ_BODY).not.toContain("admin_inventory_movements");
    // It still exists, unchanged, in the migration that created it.
    expect(code("supabase/migrations/0005_inventory_admin_read.sql"))
      .toContain("create or replace function public.admin_inventory_movements");
  });

  it("still cannot be reached by a browser writing initial_import", () => {
    // The reason is filtered out of the view AND unbookable to begin with.
    expect(FOUNDATION).toContain("'initial_import'");
    expect(code("src/lib/admin/inventory-model.ts")).not.toMatch(
      /MOVEMENT_REASONS[\s\S]*?"initial_import"[\s\S]*?\] as const/,
    );
  });
});

describe("history and the counters read the same thing", () => {
  it("takes both from the business function, in the read path", () => {
    expect(QUERIES).toContain('supabase.rpc("seller_business_movements"');
    expect(QUERIES).not.toContain('supabase.rpc("admin_inventory_movements"');
  });

  it("filters nothing in the browser, where the two could drift apart", () => {
    const card = code("src/components/admin/inventory-card.tsx");
    const history = code("src/lib/admin/stock-history.ts");
    for (const source of [card, history]) {
      expect(source).not.toContain("is_test");
      expect(source).not.toContain("commerce_mode");
      expect(source).not.toContain("initial_import");
    }
    // One list feeds both, so a filter could not reach one and miss the other.
    expect(card).toContain("tradeCounters(legacyTotals, movements)");
    expect(card).toContain("mergeHistory(legacy ?? [], movements)");
  });

  it("leaves the legacy events untouched", () => {
    expect(READ_BODY).not.toContain("legacy_stock_events");
    expect(BACKFILL).not.toContain("legacy_stock_events");
    expect(LINK).not.toContain("legacy_stock_events");
  });

  it("still takes the stock itself from the position and nowhere else", () => {
    expect(code("src/components/admin/inventory-card.tsx"))
      .toContain("quantity={position.quantity}");
  });
});
