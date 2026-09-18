import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * A flagged order needs a way out — and only the right one (ADR-0079).
 *
 * `needs_resolution` blocked shipping from 0010 onward and nothing in the
 * product ever cleared it. The danger in fixing that is obvious: a button that
 * clears the flag would let a seller ship goods the ledger still counts as
 * present, which is the exact thing the flag exists to stop. So what is held
 * here is not that the order becomes shippable, but that it becomes shippable
 * ONLY when the inconsistency has actually been repaired.
 */
const M = "supabase/migrations/0043_order_review_recovery.sql";
const source = (path: string) => readFileSync(path, "utf8");
const code = (path: string) =>
  source(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--.*$/gm, "")
    .replace(/^\s*\/\/.*$/gm, "");

const sql = code(M);
function fn(name: string): string {
  const at = sql.indexOf(`create or replace function public.${name}(`);
  expect(at, name).toBeGreaterThan(-1);
  return sql.slice(at, sql.indexOf("$$;", at));
}
const resolve = () => fn("seller_resolve_stock_shortfall");

describe("the flag is never cleared on its own", () => {
  it("clears it only after the booking loop", () => {
    const body = resolve();
    const booked = body.indexOf("perform public.apply_inventory_movement(");
    const cleared = body.indexOf("set needs_resolution = false");
    expect(booked).toBeGreaterThan(-1);
    expect(cleared).toBeGreaterThan(booked);
  });

  it("is the only place in the schema that clears it", () => {
    // 0010 said "never cleared automatically"; it turned out never to be
    // cleared at all. This is the one deliberate exception.
    expect((sql.match(/needs_resolution\s*=\s*false/g) ?? []).length).toBe(1);
  });

  it("offers no naked toggle", () => {
    expect(sql).not.toMatch(/function public\.\w*(unblock|force|override|clear_review)/i);
  });
});

describe("only the repairable cause is repaired", () => {
  it("refuses a payment discrepancy by name", () => {
    const body = resolve();
    expect(body).toContain("'payment_amount_mismatch'");
    expect(body).toContain("that is settled with the payment, not with stock");
  });

  it("requires the late-payment event to be present", () => {
    expect(resolve()).toContain("'late_payment_unresolved'");
    expect(resolve()).toContain("was not flagged for an unbooked late payment");
  });

  it("requires the order to be paid", () => {
    expect(resolve()).toContain("if v_order.payment_status <> 'paid' then");
  });

  it("refuses an order that still holds a reservation", () => {
    // The ordinary conversion path is still open there; this would double-book.
    expect(resolve()).toContain("r.state = 'active'");
    expect(resolve()).toContain("convert its reservation instead");
  });

  it("refuses an order that is not flagged, and a second run", () => {
    expect(resolve()).toContain("if not v_order.needs_resolution then");
    expect(resolve()).toContain("'stock_booked_after_late_payment'");
    expect(resolve()).toContain("has already been booked");
  });
});

describe("the repair is a real booking, through the ordinary journal", () => {
  it("books one sale movement per line", () => {
    const body = resolve();
    expect(body).toContain("from public.order_lines l");
    expect(body).toContain("-v_line.quantity, 'sale'");
  });

  it("uses the existing movement function rather than writing stock directly", () => {
    expect(resolve()).toContain("perform public.apply_inventory_movement(");
    expect(resolve()).not.toMatch(/update public\.shop_inventory/i);
    expect(resolve()).not.toMatch(/insert into public\.inventory_movements/i);
  });

  it("does not catch a shortfall — it lets the transaction roll back", () => {
    /*
     * `apply_inventory_movement()` refuses to take a position below its
     * reserved quantity. Swallowing that would book part of an order and clear
     * the flag anyway, which is worse than the state it started in.
     */
    expect(resolve()).not.toContain("exception when");
    expect(resolve()).not.toContain("begin\n    perform");
  });

  it("locks the order while it decides", () => {
    expect(resolve()).toContain("for update");
  });

  it("journals what it did", () => {
    expect(resolve()).toContain("insert into public.order_events");
    expect(resolve()).toContain("jsonb_build_object('positions', v_booked)");
  });
});

describe("who may do it", () => {
  it("is the seller's, not the platform's", () => {
    for (const name of ["seller_order_review", "seller_resolve_stock_shortfall"]) {
      expect(fn(name), name).toContain("if not public.can_operate_active_seller() then");
      expect(fn(name), name).not.toContain("is_shop_admin");
      expect(fn(name), name).not.toContain("is_platform_admin");
    }
  });

  it("is granted the way every seller RPC is", () => {
    for (const name of ["seller_order_review(text)", "seller_resolve_stock_shortfall(text)"]) {
      expect(sql, name).toContain(`revoke all on function public.${name} from public, anon`);
      expect(sql, name).toContain(`grant execute on function public.${name} to authenticated`);
    }
  });

  it("is asked in the application with the same predicate", () => {
    expect(code("src/lib/admin/order-review.ts")).toContain("if (!(await canOperateSeller())) return NOT_FLAGGED;");
    const action = code("src/lib/admin/order-actions.ts");
    const block = action.slice(action.indexOf("export async function resolveStockShortfall"));
    expect(block).toContain("if (!(await canOperateSeller()))");
  });
});

describe("the seller is told which problem they have", () => {
  const panel = code("src/components/admin/order-review-panel.tsx");
  const copy = source("src/lib/i18n/de.ts");

  it("names the cause instead of the event", () => {
    expect(panel).toContain('review.cause === "payment_amount_mismatch"');
    expect(panel).toContain('review.cause === "late_payment_unresolved"');
    // No internal vocabulary reaches the screen.
    expect(copy).not.toContain("needs_resolution ist");
    expect(copy).toContain("Bestand wurde bei der Zahlung nicht abgebucht");
    expect(copy).toContain("Der gezahlte Betrag passt nicht zur Bestellung");
  });

  it("distinguishes 'repairable' from 'not enough stock'", () => {
    expect(panel).toContain("review.resolvable");
    expect(copy).toContain("Dafür reicht der Bestand nicht");
  });

  it("shows the numbers the sentence rests on", () => {
    expect(panel).toContain("copy.reviewNeeded");
    expect(panel).toContain("copy.reviewAvailable");
    expect(panel).toContain("line.available < line.required");
  });

  it("offers the action only where there is one", () => {
    expect(panel).toContain("review.resolvable ? (");
    expect(panel).toContain("copy.reviewResolve");
  });

  it("replaced the dead-end panel on the order page", () => {
    const page = code("src/app/(business)/business/orders/[orderNumber]/page.tsx");
    expect(page).toContain("<OrderReviewPanel");
    expect(page).not.toContain("copy.needsResolutionTitle");
  });
});

describe("what the repair must not disturb", () => {
  it("leaves the flagged count deriving from order state", () => {
    // The badge counts rows the database returns; clearing the flag removes
    // the order from that set and nothing clears the badge on its own.
    const orders = code("src/lib/admin/orders.ts");
    expect(orders).toContain("needs_resolution");
    expect(code("src/components/admin/order-review-panel.tsx")).not.toContain("openOrders");
  });

  it("leaves tracking alone", () => {
    // A number entered before the repair survives it, and entering one never
    // bypassed the review in the first place.
    expect(resolve()).not.toContain("tracking_number");
  });

  it("leaves 0039's reversible fulfilment untouched", () => {
    for (const untouched of [
      "admin_mark_order_shipped", "admin_unmark_order_shipped",
      "admin_set_tracking_number", "orders_protect_fulfillment",
    ]) {
      expect(sql, untouched).not.toContain(`function public.${untouched}`);
    }
  });

  it("leaves the account-type model untouched", () => {
    for (const untouched of ["platform_admins", "seller_operators", "collection_items"]) {
      expect(sql, untouched).not.toContain(untouched);
    }
  });

  it("weakens no invariant for the sake of an old test order", () => {
    // The Staging order is sandbox and from before the fulfilment work. It is
    // repairable because its goods are in stock — not because sandbox orders
    // get an easier path.
    expect(sql).not.toContain("sandbox");
    expect(sql).not.toContain("commerce_mode");
  });

  it("still refuses to ship a flagged order", () => {
    const blocker = code("src/lib/admin/orders.ts");
    expect(blocker).toContain('if (order.needs_resolution) return "needs_resolution";');
  });
});
