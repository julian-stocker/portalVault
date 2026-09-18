import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Admin fulfilment wiring: a flagged order that cannot be missed (F5), and
 * the shipping status control.
 *
 * This file used to hold the confirmation in front of "the only irreversible
 * action in the product". 0039 removed the irreversibility rather than the
 * symptom, so the assertions moved with it: what is pinned now is that the
 * status goes both ways, that it does not dress a reversible switch as a
 * destructive one, and that the copy which claimed otherwise is gone.
 *
 * Both counting rules are pure and tested in `open-orders.test.ts`.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("/*");
    })
    .join("\n");
}

const FORM = "src/components/admin/ship-order-form.tsx";
const DETAIL = "src/app/(business)/business/orders/[orderNumber]/page.tsx";
const HOME = "src/app/(business)/business/page.tsx";
const NAV = "src/components/layout/site-nav.tsx";
const QUERIES = "src/lib/admin/order-queries.ts";
const ORDERS = "src/lib/admin/orders.ts";

const form = code(FORM);
const detail = code(DETAIL);
const home = code(HOME);
const nav = code(NAV);

describe("the shipping status goes both ways", () => {
  it("offers the forward move when the order has not gone", () => {
    expect(form).toContain("copy.shipAction");
    expect(form).toContain("markOrderShipped(orderNumber, null)");
  });

  it("offers the way back when it has", () => {
    // The correction that used to require a database session.
    expect(form).toContain("copy.unshipAction");
    expect(form).toContain("unmarkOrderShipped(orderNumber)");
  });

  it("picks the direction from the current status, not from a second flag", () => {
    expect(form).toContain("shipped ? copy.statusShipped : copy.statusUnfulfilled");
    expect(form).toContain("const result = shipped");
  });

  it("asks no question in either direction", () => {
    /*
     * A modal in front of a switch that goes both ways makes a harmless
     * operation feel dangerous, and this one sits in the middle of the work.
     */
    expect(form).not.toContain("setConfirming");
    expect(form).not.toContain('role="alertdialog"');
    expect(form).not.toContain("confirmYes");
    expect(form).not.toContain("confirmNo");
  });

  it("is not styled as destructive", () => {
    // The action takes the ordinary button styles; the old confirmation wore a
    // danger ring. `text-danger` survives only on the error line, where it
    // belongs.
    expect(form).toContain("shipped ? ACTION_NEUTRAL : ACTION_PRIMARY");
    expect(form).not.toContain("ring-danger");
    expect(form).not.toContain("font-medium text-danger");
  });

  it("guards against a double tap the way the checkout does", () => {
    expect(form).toContain("if (busy.current) return;");
    expect(form).toContain("busy.current = true;");
  });

  it("says the status keeps the tracking number", () => {
    expect(form).toContain("copy.statusKeepsTracking");
  });

  it("the copy that claimed it was irreversible is gone", () => {
    // The whole file, comments included: no sentence claiming a lock should
    // survive anywhere, not even as a quotation explaining its removal.
    const copy = readFileSync("src/lib/i18n/de.ts", "utf8");
    expect(copy).not.toContain("Das lässt sich nicht zurücknehmen");
    expect(copy).not.toContain("Trackingnummer ist danach nicht mehr");
    expect(copy).not.toContain("nachträglich nicht mehr änderbar");
    // And no orphaned keys left behind.
    expect(copy).not.toContain("confirmIrreversible");
    expect(copy).not.toContain("confirmYes");
  });
});

describe("the status is visible and survives a reload", () => {
  it("the detail page states it from the order's own status", () => {
    expect(detail).toContain('order.fulfillment_status === "shipped"');
    expect(detail).toContain("shipped={order.fulfillment_status === \"shipped\"}");
  });

  it("shows when it went out, and only while it is out", () => {
    // `admin_unmark_order_shipped()` clears `shipped_at`, so the line must not
    // outlive the status it describes.
    expect(detail).toContain('order.fulfillment_status === "shipped" && order.shipped_at');
    expect(detail).toContain("copy.shippedAt");
  });
});

describe("a flagged order cannot be missed", () => {
  it("the admin home states both numbers", () => {
    expect(home).toContain("orders.needsResolutionCount(openOrders.needsResolution)");
    expect(home).toContain("orders.toShipCount(openOrders.toShip)");
    // The hub shows the work card only when there IS work (ADR-0080).
    expect(home).toContain("hasOpenWork(openOrders)");
  });

  it("only the flagged bucket is loud there", () => {
    expect(home).toContain("ring-2 ring-danger/70");
    expect(home).toContain("text-danger");
  });

  it("the navigation carries a badge for it, and only for it", () => {
    expect(nav).toContain("badge: (counts) => counts.needsResolution");
    // Orders merely waiting to be sent are ordinary work and stay on /admin.
    expect(nav).not.toContain("counts.toShip");
  });

  it("the badge says what the number means", () => {
    expect(nav).toContain("de.admin.orders.badgeLabel(count)");
  });

  it("nothing polls and no new infrastructure was added", () => {
    const queries = code(QUERIES);
    expect(queries).toContain('supabase.rpc("admin_orders", { p_open_only: openOnly })');
    /*
     * This used to add "and no aggregate": the count reused the list call.
     * 0045 made it an aggregate deliberately — the list call is capped at 100
     * rows, so reusing it meant the badge stopped being true above a hundred
     * (ADR-0082). What the assertion was actually protecting is intact: no
     * polling, no notification table, no background job. One extra query on
     * the request that renders the page, for the operator alone.
     */
    expect(queries).toContain('supabase.rpc("seller_open_order_counts")');
    for (const source of [queries, nav, home]) {
      expect(source).not.toContain("setInterval");
      expect(source).not.toContain("setTimeout");
      expect(source).not.toContain("subscribe(");
    }
  });

  it("costs a collector nothing: the role is asked before the database is", () => {
    expect(code(QUERIES)).toContain("if (!(await canOperateSeller())) return NO_OPEN_ORDERS;");
  });
});

describe("the fulfilment rule itself did not move", () => {
  it("the four refusals are unchanged", () => {
    const orders = code(ORDERS);
    expect(orders).toContain('if (order.needs_resolution) return "needs_resolution";');
    expect(orders).toContain('if (order.payment_status !== "paid") return "not_paid";');
    /*
     * `shipped` stopped being a blocker in 0039 — the control renders the way
     * back from it. The states with no workflow behind them still block.
     */
    expect(orders).toContain(
      'if (order.fulfillment_status !== "unfulfilled" && order.fulfillment_status !== "shipped") {',
    );
  });

  it("the detail page still blocks on shipBlocker, not on the confirmation", () => {
    expect(detail).toContain("const blocker = shipBlocker(order);");
    expect(detail).toContain("{blocker === null ? (");
  });

  it("0018 is not edited — the transition is widened in 0039", () => {
    const migration = readFileSync("supabase/migrations/0018_admin_orders.sql", "utf8");
    expect(migration).toContain("orders_protect_fulfillment");
    // 0018's own text still describes the one-way rule it shipped with.
    expect(migration).toContain("Allows exactly one fulfilment transition");
  });

  it("the tracking number is still stored raw beyond a trim", () => {
    const orders = code(ORDERS);
    expect(orders).toContain("export function normaliseTracking");
    expect(orders).toContain("const trimmed = (raw ?? \"\").trim();");
  });
});
