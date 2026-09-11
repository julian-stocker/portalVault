import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The two admin changes before the beta: a flagged order that cannot be
 * missed (F5), and a confirmation in front of the only irreversible action in
 * the product (F6).
 *
 * Both counting rules are pure and tested in `open-orders.test.ts`. What is
 * asserted here is the wiring — and that the fulfilment rule itself did not
 * move a millimetre.
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
const DETAIL = "src/app/(admin)/admin/orders/[orderNumber]/page.tsx";
const HOME = "src/app/(admin)/admin/page.tsx";
const NAV = "src/components/layout/site-nav.tsx";
const QUERIES = "src/lib/admin/order-queries.ts";
const ORDERS = "src/lib/admin/orders.ts";

const form = code(FORM);
const detail = code(DETAIL);
const home = code(HOME);
const nav = code(NAV);

describe("shipping asks first", () => {
  it("the button opens a question rather than shipping", () => {
    expect(form).toContain("setConfirming(true)");
    // The visible action must not be wired straight to the call.
    expect(form).not.toContain("onClick={() => void ship()}\n        className");
  });

  it("the confirmation names the order and the recipient", () => {
    expect(form).toContain("copy.confirmFor(orderNumber, recipient)");
    expect(detail).toContain("recipient={recipient}");
  });

  it("it repeats the tracking number that is about to be frozen", () => {
    expect(form).toContain("copy.confirmWithTracking(normalised)");
    expect(form).toContain("copy.confirmWithoutTracking");
  });

  it("it says the action cannot be taken back", () => {
    expect(form).toContain("copy.confirmIrreversible");
    const copy = readFileSync("src/lib/i18n/de.ts", "utf8");
    expect(copy).toContain("Das lässt sich nicht zurücknehmen");
  });

  it("it can be refused", () => {
    expect(form).toContain("copy.confirmNo");
    expect(form).toContain("setConfirming(false)");
  });

  it("it is announced, not merely drawn", () => {
    expect(form).toContain('role="alertdialog"');
  });

  it("only the confirmed path calls the action", () => {
    const calls = form.match(/markOrderShipped\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(form).toContain("onClick={() => void ship()}");
  });
});

describe("success is visible and survives a reload", () => {
  it("the detail page states it from the order's own status", () => {
    expect(detail).toContain('order.fulfillment_status === "shipped"');
    expect(detail).toContain("copy.shipSucceeded(order.order_number)");
  });

  it("it shows when and with what", () => {
    expect(detail).toContain("copy.shippedAt");
    expect(detail).toContain("copy.trackingNumber");
    expect(detail).toContain("copy.noTracking");
  });
});

describe("a flagged order cannot be missed", () => {
  it("the admin home states both numbers", () => {
    expect(home).toContain("copy.needsResolutionCount(openOrders.needsResolution)");
    expect(home).toContain("copy.toShipCount(openOrders.toShip)");
    expect(home).toContain("copy.nothingOpen");
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
    // The count reuses the list call; there is no second RPC and no aggregate.
    expect(queries).toContain("fetchAdminOrders(true)");
    for (const source of [queries, nav, home]) {
      expect(source).not.toContain("setInterval");
      expect(source).not.toContain("setTimeout");
    }
  });

  it("costs a collector nothing: the role is asked before the database is", () => {
    expect(code(QUERIES)).toContain("if (!(await isAdmin())) return NO_OPEN_ORDERS;");
  });
});

describe("the fulfilment rule itself did not move", () => {
  it("the four refusals are unchanged", () => {
    const orders = code(ORDERS);
    expect(orders).toContain('if (order.needs_resolution) return "needs_resolution";');
    expect(orders).toContain('if (order.payment_status !== "paid") return "not_paid";');
    expect(orders).toContain(
      'if (order.fulfillment_status !== "unfulfilled") return "already_shipped";',
    );
  });

  it("the detail page still blocks on shipBlocker, not on the confirmation", () => {
    expect(detail).toContain("const blocker = shipBlocker(order);");
    expect(detail).toContain("{blocker === null ? (");
  });

  it("the trigger is not touched by any of this", () => {
    const migration = readFileSync("supabase/migrations/0018_admin_orders.sql", "utf8");
    expect(migration).toContain("orders_protect_fulfillment");
  });

  it("the tracking number is still stored raw beyond a trim", () => {
    const orders = code(ORDERS);
    expect(orders).toContain("export function normaliseTracking");
    expect(orders).toContain("const trimmed = (raw ?? \"\").trim();");
  });
});
