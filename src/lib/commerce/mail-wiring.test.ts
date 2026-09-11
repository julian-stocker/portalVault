import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * Where a mail is triggered, and where the key that sends it lives.
 *
 * The templates and the delivery state are tested on their own. These are the
 * properties that live between the pieces and that no single file would
 * reveal: that the key never reaches the browser or Vercel, that a replayed
 * webhook cannot produce a second confirmation, and that a mail failure cannot
 * reach back into a payment.
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

const FUNCTION = "supabase/functions/send-order-mail/index.ts";
const WEBHOOK = "supabase/functions/stripe-webhook/index.ts";
const SHIP_ACTION = "src/lib/admin/order-actions.ts";

const fn = code(FUNCTION);
const webhook = code(WEBHOOK);
const ship = code(SHIP_ACTION);

/**
 * Just `mailFor`, to its own closing brace.
 *
 * Slicing to the end of the file would sweep in `callDatabase`, which throws
 * on purpose — that is how a database outage becomes a webhook Stripe retries,
 * and it is exactly the behaviour the mail path must NOT share.
 */
function mailForBody(): string {
  const start = webhook.indexOf("async function mailFor");
  const end = webhook.indexOf("\n}", start);
  return webhook.slice(start, end);
}

describe("the Resend key never leaves the Edge Function", () => {
  /**
   * Comments are stripped before looking. Several files explain *why* they do
   * not hold the key, and an explanation must not read as a use — otherwise
   * the guard would push people to stop documenting the rule.
   */
  it("is read in exactly one file in the repository", () => {
    const files = execSync(
      "grep -rl 'RESEND_API_KEY' --include='*.ts' --include='*.tsx' --include='*.mts' " +
        "--include='*.json' src supabase tools || true",
      { encoding: "utf8" },
    )
      .split("\n")
      .filter((p) => p !== "" && !p.endsWith(".test.ts"));

    const reading = files.filter((p) => code(p).includes("RESEND_API_KEY"));
    expect(reading).toEqual([FUNCTION]);
  });

  it("never reaches the application, and never as a NEXT_PUBLIC_ value", () => {
    const files = execSync(
      "grep -rl 'RESEND' --include='*.ts' --include='*.tsx' src || true",
      { encoding: "utf8" },
    )
      .split("\n")
      .filter((p) => p !== "" && !p.endsWith(".test.ts"));

    // Nothing under src/ may read it in code, comment or not as NEXT_PUBLIC_.
    expect(files.filter((p) => code(p).includes("RESEND"))).toEqual([]);
    // Excluding tests: this file has to spell the name it is forbidding.
    expect(
      execSync(
        "grep -rn 'NEXT_PUBLIC_RESEND' --include='*.ts' --include='*.tsx' src supabase " +
          "| grep -v '.test.ts' || true",
        { encoding: "utf8" },
      ).trim(),
    ).toBe("");
  });

  it("is read from the environment, never from the database", () => {
    expect(fn).toContain('Deno.env.get("RESEND_API_KEY")');
    // A key in a settings table would be a key an administrator could read.
    expect(fn).not.toContain("business_settings");
  });

  it("the From address is environment configuration too", () => {
    expect(fn).toContain('Deno.env.get("MAIL_FROM")');
    const sql = readFileSync("supabase/migrations/0019_transactional_mail.sql", "utf8");
    expect(sql).not.toContain("mail_from");
    expect(sql).not.toContain("from_address");
  });
});

describe("the webhook sends exactly one confirmation, and only for a real one", () => {
  it("maps only the three outcomes that deserve a mail", () => {
    const map = webhook.slice(
      webhook.indexOf("const MAIL_FOR_OUTCOME"),
      webhook.indexOf("}", webhook.indexOf("const MAIL_FOR_OUTCOME")),
    );
    expect(map).toContain("confirmed:");
    expect(map).toContain("late_payment_unresolved:");
    expect(map).toContain("amount_mismatch:");

    /*
     * The two that a replayed Stripe event produces. Their absence is what
     * makes a redelivery send nothing — before the delivery row is even
     * consulted.
     */
    expect(map).not.toContain("already_confirmed");
    expect(map).not.toContain("duplicate_event");
    expect(map).not.toContain("unknown_payment");
  });

  it("never sends a customer confirmation for a flagged order", () => {
    const map = webhook.slice(
      webhook.indexOf("const MAIL_FOR_OUTCOME"),
      webhook.indexOf("};", webhook.indexOf("const MAIL_FOR_OUTCOME")),
    );
    // A flagged order is paid and nothing was booked: the customer gets the
    // "we are checking" status page, the operator gets woken up.
    expect(map).toMatch(/late_payment_unresolved:\s*"resolution_alert"/);
    expect(map).toMatch(/amount_mismatch:\s*"resolution_alert"/);
    expect(map).toMatch(/confirmed:\s*"payment_confirmation"/);
  });

  it("dispatches after the outcome is settled, never inside it", () => {
    expect(webhook.indexOf("await callDatabase(decision)")).toBeLessThan(
      webhook.indexOf("await mailFor(outcome"),
    );
  });

  it("cannot turn a mail failure into a retried payment", () => {
    // Every path logs and returns; none rethrows, and none touches the status
    // Stripe is about to read. A 500 here would cost the delivery.
    expect(mailForBody()).toContain("catch (error)");
    expect(mailForBody()).not.toContain("throw ");
    expect(mailForBody()).not.toContain("respond(");
  });

  it("never asks to force a send", () => {
    expect(mailForBody()).not.toContain("force");
  });
});

describe("shipping tells the customer after the parcel is recorded", () => {
  it("sends only once the RPC has succeeded", () => {
    expect(ship.indexOf("admin_mark_order_shipped")).toBeLessThan(
      ship.indexOf('sendOrderMail(orderNumber, "shipping_confirmation")'),
    );
  });

  it("does not let a mail failure report the shipment as failed", () => {
    const body = ship.slice(ship.indexOf("export async function markOrderShipped"));
    const call = body.indexOf('sendOrderMail(orderNumber, "shipping_confirmation")');
    const ok = body.indexOf("return { ok: true }", call);
    expect(ok).toBeGreaterThan(call);
    // Nothing between the send and the success answer inspects its result.
    expect(body.slice(call, ok)).not.toContain("if (");
  });

  it("holds no key: it asks the function that has one", () => {
    expect(ship).toContain('functions.invoke("send-order-mail"');
    expect(ship).not.toContain("RESEND");
    expect(ship).not.toContain("resend");
  });
});

describe("the retry cannot resend a delivered mail", () => {
  it("has no path that ignores the delivery state", () => {
    // The refusal lives in claim_order_mail(); the function never writes
    // `sent` on its own and never deletes a record to start over.
    expect(fn).toContain('claim !== "claimed"');
    expect(fn).not.toContain("delete");
    expect(fn).not.toContain("order_mail_reset");
  });

  it("only an administrator can pass force", () => {
    expect(fn).toContain('const force = caller.kind === "admin" && body.force === true');
  });

  it("verifies the JWT and then asks the database for the role", () => {
    expect(fn).toContain("admin.auth.getUser(bearer)");
    expect(fn).toContain('admin.rpc("is_shop_admin_for"');
    // The order matters: a verified user is not yet an administrator.
    expect(fn.indexOf("admin.auth.getUser(bearer)")).toBeLessThan(
      fn.indexOf('admin.rpc("is_shop_admin_for"'),
    );
  });

  it("compares the shared secret without leaking its length by early exit", () => {
    expect(fn).toContain("diff |=");
  });
});

describe("the provider is used as documented", () => {
  it("uses the official SDK rather than a hand-rolled request", () => {
    expect(fn).toContain('from "npm:resend@');
    expect(fn).toContain("resend.emails.send(");
    expect(fn).not.toContain("api.resend.com");
  });

  it("passes the idempotency key in the options argument, as the SDK expects", () => {
    expect(fn).toContain("idempotencyKey: idempotencyKey(kind, order.order_number)");
  });

  it("treats a 409 as ambiguous, never as a plain failure", () => {
    expect(fn).toContain('name === "invalid_idempotent_request"');
    expect(fn).toContain('name === "concurrent_idempotent_requests"');
    expect(fn).toContain("mark_order_mail_unresolved");
  });

  it("records the provider's error name, never the whole error", () => {
    expect(fn).toContain('(sendError as { name?: string }).name ?? "send_failed"');
    expect(fn).not.toContain("JSON.stringify(sendError");
  });
});

describe("no queue and no schedule was introduced", () => {
  it("nothing loops, sleeps or retries on its own", () => {
    for (const forbidden of ["setInterval", "setTimeout", "while (", "cron", "Deno.cron"]) {
      expect(fn, forbidden).not.toContain(forbidden);
      expect(mailForBody(), forbidden).not.toContain(forbidden);
    }
  });

  it("one request sends at most one mail", () => {
    expect((fn.match(/resend\.emails\.send\(/g) ?? []).length).toBe(1);
  });
});
