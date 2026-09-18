/**
 * One declaration, one statutory receipt (migration 0049).
 *
 * WHAT WENT WRONG. `0047` shipped with a comment promising that the receipt
 * function "refuses a withdrawal whose receipt is no longer `pending`". No
 * such refusal was ever written. Invoking it twice against Staging sent twice
 * and moved `receipt_sent_at` from 08:34:31 to 08:34:45 — the second call
 * overwrote the record of when the § 356a Abs. 4 confirmation actually went
 * out. The duplicate was held off only by Resend's `idempotencyKey`, which is
 * a provider convenience with a finite window.
 *
 * The lesson is the one this project keeps relearning: a guarantee written in
 * a comment is not a guarantee. These tests pin the mechanism instead.
 */
import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { code, columnsOf, latestFunction, migrationSource } from "@/test-support/migrations";

const SQL = migrationSource("0049_withdrawal_receipt_idempotency.sql");
const EDGE = readFileSync(join(process.cwd(), "supabase/functions/send-order-mail/index.ts"), "utf8");
const EDGE_CODE = EDGE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("0047 is applied, so the fix is additive", () => {
  it("does not touch the applied migration", () => {
    // 0047 is live on Staging. Staging's real order is 0047 → 0049 → 0048.
    expect(SQL).toContain("alter table public.withdrawal_requests");
    expect(SQL).not.toContain("create table if not exists public.withdrawal_requests");
    expect(SQL).not.toContain("drop table");
  });

  it("says out loud why the numbering is what it is", () => {
    expect(SQL).toContain("0047 → 0049 → 0048");
  });
});

describe("claiming, rather than checking and then acting", () => {
  it("decides and writes in one statement", () => {
    /*
     * "Read the state, then send" is a race with itself: two requests arriving
     * together both read `pending` and both send. The UPDATE's WHERE clause IS
     * the check, so the decision and the write cannot be separated.
     */
    const fn = code(latestFunction("claim_withdrawal_receipt").body);
    expect(fn).toContain("update public.withdrawal_requests");
    expect(fn).toContain("set receipt_state = 'sending'");
    expect(fn).toContain("get diagnostics");
    // No separate read that a second caller could interleave with.
    expect(fn).not.toMatch(/select\s+.*\s+into\s+.*from public\.withdrawal_requests/);
  });

  it("claims only from states that may be sent", () => {
    const fn = code(latestFunction("claim_withdrawal_receipt").body);
    expect(fn).toContain("w.receipt_state = 'pending'");
    expect(fn).toContain("w.receipt_state = 'failed'");
    // Never from 'sent'. That is the whole point.
    expect(fn).not.toMatch(/receipt_state\s*=\s*'sent'\s*$/m);
  });

  it("lets a legitimate retry through after a real failure", () => {
    // pending → provider failure → failed → claimable again.
    expect(code(latestFunction("claim_withdrawal_receipt").body)).toContain(
      "w.receipt_state = 'failed'",
    );
  });

  it("does not strand a receipt when a sender dies mid-flight", () => {
    /*
     * Without this, a process that claims and then crashes leaves the row in
     * `sending` forever and the consumer never receives the confirmation the
     * statute promises. 15 minutes is far longer than a mail API call.
     */
    const fn = code(latestFunction("claim_withdrawal_receipt").body);
    expect(fn).toContain("w.receipt_state = 'sending'");
    expect(fn).toContain("receipt_attempt_at < now() - interval '15 minutes'");
  });

  it("is reachable by no client role", () => {
    expect(SQL).toContain(
      "revoke all on function public.claim_withdrawal_receipt(bigint)\n  from public, anon, authenticated;",
    );
  });
});

describe("the send time is written once", () => {
  it("is kept by coalesce, not overwritten by now()", () => {
    const fn = code(latestFunction("mark_withdrawal_receipt").body);
    expect(fn).toContain("coalesce(w.receipt_sent_at, now())");
    // The 0047 version. Its absence here is the fix.
    expect(fn).not.toContain("when p_state = 'sent' then now() else");
  });

  it("and an already-sent receipt is never resolved again", () => {
    expect(code(latestFunction("mark_withdrawal_receipt").body)).toContain(
      "w.receipt_state <> 'sent'",
    );
  });

  it("keeps the signature 0047 callers already use", () => {
    // So applying 0049 before redeploying the function breaks nothing.
    const fn = latestFunction("mark_withdrawal_receipt").body;
    expect(fn).toContain("p_withdrawal_id bigint");
    expect(fn).toContain("p_state         text");
  });
});

describe("the database holds the line, not the callers", () => {
  it("refuses to un-send a sent receipt", () => {
    const fn = code(latestFunction("withdrawal_receipt_protect").body);
    expect(fn).toContain("old.receipt_state = 'sent' and new.receipt_state <> 'sent'");
    expect(fn).toContain("a receipt that has been sent cannot become unsent");
  });

  it("refuses to rewrite when it was sent", () => {
    const fn = code(latestFunction("withdrawal_receipt_protect").body);
    expect(fn).toContain("old.receipt_sent_at is not null");
    expect(fn).toContain("new.receipt_sent_at is distinct from old.receipt_sent_at");
    expect(fn).toContain("the time a statutory receipt was sent cannot be changed");
  });

  it("is a trigger, so bypassing the functions does not bypass the rule", () => {
    expect(SQL).toContain("create trigger withdrawal_receipt_protect_trg");
    expect(SQL).toContain("before update on public.withdrawal_requests");
  });

  it("states the invariant structurally as well", () => {
    // sent ⟺ has a send time. A CHECK cannot express the transition rules
    // above, and a trigger cannot express this as cheaply. Both, therefore.
    expect(SQL).toContain(
      "check ((receipt_state = 'sent') = (receipt_sent_at is not null))",
    );
  });

  it("admits the new state before requiring it", () => {
    expect(SQL).toContain("check (receipt_state in ('pending', 'sending', 'sent', 'failed'))");
    expect(columnsOf("withdrawal_requests")).toContain("receipt_attempt_at");
  });

  it("normalises history before constraining it", () => {
    /*
     * A constraint added over data that violates it fails the whole migration.
     * Both halves must exist AND precede the constraint — an earlier version
     * of this test compared indexOf() results without checking for -1, so
     * deleting the backfill outright made it pass.
     */
    const backfill = code(SQL);
    const normaliseState = backfill.indexOf("set receipt_state = 'sent'");
    const normaliseTime = backfill.indexOf("set receipt_sent_at = received_at");
    const constraint = backfill.indexOf("withdrawal_requests_sent_has_a_time");

    expect(normaliseState, "state backfill present").toBeGreaterThan(-1);
    expect(normaliseTime, "time backfill present").toBeGreaterThan(-1);
    expect(constraint, "constraint present").toBeGreaterThan(-1);
    expect(normaliseState).toBeLessThan(constraint);
    expect(normaliseTime).toBeLessThan(constraint);
  });
});

describe("the edge function asks before it sends", () => {
  it("claims before composing or sending anything", () => {
    const claim = EDGE_CODE.indexOf("claim_withdrawal_receipt");
    expect(claim).toBeGreaterThan(-1);
    expect(claim).toBeLessThan(EDGE_CODE.indexOf("withdrawalReceipt(receipt)"));
    expect(claim).toBeLessThan(EDGE_CODE.indexOf("resend.emails.send"));
  });

  it("stands down when it did not win the claim", () => {
    expect(EDGE_CODE).toContain("if (claimed !== true)");
    expect(EDGE_CODE).toContain('outcome: "already_sent"');
  });

  it("treats a losing claim as success, not as an error", () => {
    // A retry finding the work already done is the system behaving correctly.
    const block = EDGE_CODE.slice(EDGE_CODE.indexOf("if (claimed !== true)"));
    expect(block.slice(0, 120)).toContain("respond(200");
  });

  it("still reports failure so a retry stays possible", () => {
    /*
     * Both outcomes, and each the right number of times. Asserting only that
     * the two strings appear let `failed` be replaced by `sent` — which would
     * mark a receipt that never went out as sent, losing both the retry and
     * the truth of the record.
     */
    const sent = EDGE_CODE.match(/p_state: "sent"/g) ?? [];
    const failed = EDGE_CODE.match(/p_state: "failed"/g) ?? [];
    expect(failed.length, "two failure paths: provider error and thrown").toBe(2);
    expect(sent.length, "exactly one success path").toBe(1);

    // And the success mark is the last thing, after the send returned cleanly.
    expect(EDGE_CODE.lastIndexOf('p_state: "sent"')).toBeGreaterThan(
      EDGE_CODE.indexOf("resend.emails.send"),
    );
  });

  it("keeps the provider key as a second belt, not the only one", () => {
    expect(EDGE).toContain("idempotencyKey: `skyisles/withdrawal-receipt/${withdrawalId}`");
  });
});

describe("the comment that lied has been corrected", () => {
  it("no longer claims a refusal that did not exist", () => {
    const actions = readFileSync(join(process.cwd(), "src/lib/legal/withdrawal-actions.ts"), "utf8");
    expect(actions).not.toContain("The function refuses a withdrawal whose receipt is no longer");
    expect(actions).toContain("claim_withdrawal_receipt()");
    expect(actions).toContain("0049");
  });
});

describe("privacy and enumeration are not made worse", () => {
  it("0049 does not touch the public withdrawal entry point", () => {
    expect(code(SQL)).not.toContain("receive_withdrawal");
    expect(code(SQL)).not.toContain("withdrawal_attempts");
  });

  it("adds nothing a client role may call except the seller's own read", () => {
    const grants = [...code(SQL).matchAll(/grant execute on function ([^;]+);/g)].map((m) => m[1]);
    expect(grants).toHaveLength(1);
    expect(grants[0]).toContain("withdrawal_receipt_state(bigint)");
    expect(grants[0]).toContain("to authenticated");
    // And it is seller-gated inside, like every other seller read.
    expect(code(latestFunction("withdrawal_receipt_state").body)).toContain(
      "public.can_operate_active_seller()",
    );
  });

  it("stores no new personal data", () => {
    // One timestamp. No address, no provider id, no message id.
    const added = code(SQL).match(/add column if not exists (\w+)/g) ?? [];
    expect(added).toEqual(["add column if not exists receipt_attempt_at"]);
  });
});
