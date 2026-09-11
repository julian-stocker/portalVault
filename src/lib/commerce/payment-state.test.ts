import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  AUTO_REFRESH_DELAYS_MS,
  isTerminal,
  shouldAutoRefresh,
  viewFor,
  type OrderPaymentState,
  type PaymentView,
} from "./payment-state";

/**
 * B2.4 — what the customer is told after paying.
 *
 * The one question worth testing hard: **when may a page say "paid"?**
 * Everything else in this phase is plumbing, but a success message shown for
 * an order that was not paid, or for one a human still has to look at, is the
 * kind of mistake a customer acts on.
 */

const state = (over: Partial<OrderPaymentState> = {}): OrderPaymentState => ({
  order_number: "SI-2026-001022",
  payment_status: "paid",
  needs_resolution: false,
  total_amount: "9.31",
  ...over,
});

describe("only a confirmed payment is a success", () => {
  it("confirms a paid order that needs nobody", () => {
    expect(viewFor(state())).toBe("confirmed");
  });

  it("never confirms without a row", () => {
    // No row means the capability did not fit, or the order does not exist.
    // Both are the same answer by design, and neither is a success.
    expect(viewFor(null)).toBe("unknown");
  });

  it("does NOT confirm a paid order that needs attention", () => {
    /*
     * The late payment from ADR-0050: money arrived, the hold was already
     * gone, nothing was converted and nothing booked. Saying "confirmed, on
     * its way" would promise goods that may not exist any more.
     */
    expect(viewFor(state({ needs_resolution: true }))).toBe("needs_attention");
  });

  it("lets needs_resolution override every status", () => {
    for (const status of ["paid", "pending", "expired", "failed", "refunded"]) {
      expect(viewFor(state({ payment_status: status, needs_resolution: true })), status).toBe(
        "needs_attention",
      );
    }
  });

  it("treats a still-pending order as awaiting, not as failed", () => {
    // The webhook is usually seconds behind the redirect. Telling the customer
    // their payment failed in that window would be wrong and alarming.
    expect(viewFor(state({ payment_status: "pending" }))).toBe("awaiting_confirmation");
  });

  it("maps the closed states honestly", () => {
    expect(viewFor(state({ payment_status: "expired" }))).toBe("expired");
    expect(viewFor(state({ payment_status: "cancelled" }))).toBe("expired");
    expect(viewFor(state({ payment_status: "failed" }))).toBe("expired");
    expect(viewFor(state({ payment_status: "refunded" }))).toBe("refunded");
    expect(viewFor(state({ payment_status: "partially_refunded" }))).toBe("refunded");
  });

  it("does not optimistically confirm an unknown status", () => {
    // A value this build has never heard of must not fall through to success.
    for (const status of ["", "PAID", "settled", "captured", "complete"]) {
      expect(viewFor(state({ payment_status: status })), status).not.toBe("confirmed");
    }
    expect(viewFor(state({ payment_status: "settled" }))).toBe("unknown");
  });
});

describe("the browser looks again only while the answer can change", () => {
  it("refreshes while awaiting and never otherwise", () => {
    expect(shouldAutoRefresh("awaiting_confirmation")).toBe(true);
    for (const view of [
      "confirmed",
      "needs_attention",
      "expired",
      "refunded",
      "unknown",
    ] as PaymentView[]) {
      expect(shouldAutoRefresh(view), view).toBe(false);
    }
  });

  it("gives up after three bounded attempts", () => {
    // Moments, not an interval: an interval is a loop, and an unbounded loop
    // against the database is the polling infrastructure ADR-0054 forbids.
    expect([...AUTO_REFRESH_DELAYS_MS]).toEqual([2_000, 5_000, 10_000]);
    expect(AUTO_REFRESH_DELAYS_MS.length).toBeLessThanOrEqual(3);
    expect(Math.max(...AUTO_REFRESH_DELAYS_MS)).toBeLessThanOrEqual(15_000);
  });
});

describe("the capability is forgotten as soon as it answers nothing", () => {
  it("is terminal once the order has settled", () => {
    for (const view of ["confirmed", "needs_attention", "expired", "refunded"] as PaymentView[]) {
      expect(isTerminal(view), view).toBe(true);
    }
  });

  it("is kept while waiting, and while the answer may have been the wrong one", () => {
    expect(isTerminal("awaiting_confirmation")).toBe(false);
    // `unknown` may mean a wrong or missing token; discarding it would make a
    // retry with the right one impossible.
    expect(isTerminal("unknown")).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("the redirect is never treated as payment truth", () => {
  const success = readFileSync("src/app/(public)/checkout/erfolg/page.tsx", "utf8");
  const status = readFileSync("src/components/checkout/payment-status.tsx", "utf8");
  const code = (text: string) =>
    text
      .split("\n")
      .filter((line) => {
        const t = line.trimStart();
        return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
      })
      .join("\n");

  it("reads no session_id anywhere", () => {
    // Stripe puts it in the URL and it stays unread: it authorises nothing and
    // identifies nothing the order number does not already.
    expect(code(success)).not.toContain("session_id");
    expect(code(status)).not.toContain("session_id");
  });

  it("asks the database rather than the URL", () => {
    expect(status).toContain("order_payment_state");
  });

  it("has no success wording that the redirect alone could trigger", () => {
    // The page renders a title chosen by viewFor(); there is no branch that
    // says "paid" because a query parameter said so.
    expect(code(success)).not.toContain("confirmedTitle");
    expect(code(status)).toContain("titles[view]");
  });
});

describe("the status reader is minimal and safe", () => {
  const migration = readFileSync("supabase/migrations/0017_order_payment_state.sql", "utf8");

  /**
   * The migration with its comment lines removed.
   *
   * The header explains in prose why there is no `is_paid` boolean, and that
   * sentence is worth keeping. Only the statements are the contract.
   */
  const sql = migration
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");

  it("is read-only and pins its search_path", () => {
    expect(migration).toContain("language sql");
    expect(migration).toContain("stable");
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = ''");
    for (const write of ["insert into", "update ", "delete from", "create table", "alter table"]) {
      expect(migration.toLowerCase(), write).not.toContain(write);
    }
  });

  it("reuses 0013's authorisation instead of copying it", () => {
    // One hash comparison, in one place. A second copy is a second thing to
    // get wrong the day the rule changes.
    expect(migration).toContain("public.authorize_order_payment(o.id, (select auth.uid()), p_token)");
    expect(sql).not.toContain("sha256");
  });

  it("returns nothing personal and no ids", () => {
    const body = migration.slice(migration.indexOf("returns table"), migration.indexOf("$$;"));
    for (const forbidden of [
      "customer_email",
      "client_hash",
      "payment_token_hash",
      "request_id",
      "o.id",
      "user_id",
      "placed_at",
    ]) {
      // `o.id` appears in the authorisation call, not in the projection.
      const projection = migration.slice(
        migration.indexOf("returns table"),
        migration.indexOf("from public.orders o"),
      );
      expect(projection, forbidden).not.toContain(forbidden);
    }
    expect(body).toContain("o.payment_status");
    expect(body).toContain("o.needs_resolution");
  });

  it("has no is_paid, because payment_status is the only truth", () => {
    // A boolean beside the status would be a second truth, and the two would
    // eventually disagree.
    expect(sql).not.toContain("is_paid");
  });

  it("grants execute to the browser roles and to nobody else", () => {
    expect(migration).toContain(
      "revoke all on function public.order_payment_state(text, text)\n  from public, anon, authenticated;",
    );
    expect(migration).toContain(
      "grant execute on function public.order_payment_state(text, text)\n  to anon, authenticated;",
    );
    expect(migration).not.toMatch(/grant[\s\S]{0,80}to\s+service_role/);
  });

  it("returns an answer that distinguishes nothing", () => {
    // Unknown order and unauthorised order produce the identical empty result:
    // the WHERE clause ands the number with the authorisation, so a wrong
    // token yields no row whether or not that order exists. The claim is about
    // the answer, not about preventing anyone from trying numbers.
    const where = migration.slice(migration.indexOf("where o.order_number"), migration.indexOf("$$;"));
    expect(where).toContain("and public.authorize_order_payment");
  });
});
