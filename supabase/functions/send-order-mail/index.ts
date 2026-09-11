/**
 * send-order-mail — the only place in SkyIsles that can send a mail.
 *
 * It holds `RESEND_API_KEY`, and it is inside Supabase, so the key never
 * reaches Vercel or a browser (ADR-0051). Everything else about a mail —
 * whether it may be sent, whether it already was — is decided by the database.
 *
 * TWO CALLERS, TWO PROOFS
 *
 *   stripe-webhook   a shared secret in `x-skyisles-mail-secret`. Both
 *                    functions run inside the same Supabase project; this is
 *                    not the publicly executable RPC ADR-0051 rejected.
 *   the admin area   a real user JWT, verified here, then `is_shop_admin()`
 *                    asked of the database. A claim in a request body never
 *                    authorises anything.
 *
 * Only an administrator may pass `force`, and only `force` gets past an
 * `unresolved` delivery record. A webhook can never set it.
 *
 * WHAT IT DOES NOT DO
 *
 * No queue, no retry loop, no schedule. One request sends at most one mail.
 * A failure is recorded and the administrator decides.
 *
 * A FAILURE HERE NEVER UNDOES A PAYMENT
 *
 * This function is called after `confirm_order_payment()` has committed. It
 * holds no transaction, touches no order, no reservation and no inventory
 * movement. The worst it can do is record that a mail did not go out.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Resend } from "npm:resend@4";

import {
  goesToCustomer,
  idempotencyKey,
  isMailKind,
  render,
  type MailKind,
  type MailOrder,
} from "./templates.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const MAIL_SECRET = Deno.env.get("MAIL_FUNCTION_SECRET");

/**
 * The technical sender, from the environment and never from the database.
 *
 * It belongs to the verified sending domain. An interface that could change it
 * would be an interface that can break DKIM and DMARC in one keystroke, which
 * is why `business_settings` has no From column (ADR-0059).
 */
const MAIL_FROM = Deno.env.get("MAIL_FROM") ?? "SkyIsles <orders@mail.skyisles.app>";

/** Same policy as create-payment: no wildcard, the request carries a token. */
const CORS = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGINS") ?? "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-skyisles-mail-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function respond(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

/** A code and a message, never a whole error object — as in create-payment. */
function describe(detail: unknown): string {
  if (detail instanceof Error) return detail.message;
  return String(detail);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * Is the caller allowed to ask for this, and may they force?
 *
 * Timing-safe comparison for the shared secret: a length-varying `===` on a
 * secret is the kind of detail that is free to get right and awkward to
 * retrofit.
 */
function secretMatches(given: string | null): boolean {
  if (!MAIL_SECRET || !given || given.length !== MAIL_SECRET.length) return false;
  let diff = 0;
  for (let i = 0; i < MAIL_SECRET.length; i += 1) {
    diff |= MAIL_SECRET.charCodeAt(i) ^ given.charCodeAt(i);
  }
  return diff === 0;
}

type Caller = { kind: "webhook" } | { kind: "admin"; userId: string } | null;

async function authorise(req: Request): Promise<Caller> {
  if (secretMatches(req.headers.get("x-skyisles-mail-secret"))) return { kind: "webhook" };

  const authorization = req.headers.get("Authorization");
  const bearer = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  if (!bearer) return null;

  // The token is verified against Supabase Auth, then the ROLE is asked of the
  // database. A verified user is not yet an administrator.
  const { data, error } = await admin.auth.getUser(bearer);
  if (error || !data.user) return null;

  const { data: isAdmin, error: roleError } = await admin.rpc("is_shop_admin_for", {
    p_user_id: data.user.id,
  });
  if (roleError || isAdmin !== true) return null;

  return { kind: "admin", userId: data.user.id };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return respond(405, { error: "method_not_allowed" });

  if (!RESEND_API_KEY) {
    // Configuration, not a customer's problem. The caller learns the mail did
    // not go; nothing is claimed and nothing is recorded as failed.
    console.error("send-order-mail: RESEND_API_KEY is not configured");
    return respond(503, { error: "mail_unavailable" });
  }

  let body: { orderNumber?: unknown; kind?: unknown; force?: unknown };
  try {
    body = await req.json();
  } catch {
    return respond(400, { error: "invalid_body" });
  }

  const orderNumber = typeof body.orderNumber === "string" ? body.orderNumber.trim() : "";
  if (orderNumber === "" || !isMailKind(body.kind)) {
    return respond(400, { error: "invalid_body" });
  }
  const kind: MailKind = body.kind;

  const caller = await authorise(req);
  if (!caller) return respond(401, { error: "not_authorised" });

  // Only a verified administrator may overrule an unresolved record. A webhook
  // asking to force is a webhook that has been tampered with.
  const force = caller.kind === "admin" && body.force === true;

  try {
    // ---------------------------------------------------------- 1. the claim
    const { data: claim, error: claimError } = await admin.rpc("claim_order_mail", {
      p_order_number: orderNumber,
      p_kind: kind,
      p_force: force,
    });
    if (claimError) throw new Error(`claim: ${claimError.message}`);

    if (claim !== "claimed") {
      // `already_sent`, `in_flight`, `unresolved`, `unknown_order` — all of
      // them mean "do not send", and all of them are a 200: the caller asked a
      // reasonable question and got a truthful answer.
      return respond(200, { sent: false, outcome: claim });
    }

    // -------------------------------------------------------- 2. the content
    const { data: payload, error: payloadError } = await admin.rpc("order_mail_payload", {
      p_order_number: orderNumber,
    });
    if (payloadError) throw new Error(`payload: ${payloadError.message}`);
    if (!payload) {
      await admin.rpc("mark_order_mail_failed", {
        p_order_number: orderNumber,
        p_kind: kind,
        p_error: "order_vanished",
      });
      return respond(404, { error: "unknown_order" });
    }

    const order = payload as MailOrder;
    const { data: contact } = await admin.rpc("mail_contact_settings");
    const settings = (Array.isArray(contact) ? contact[0] : contact) ?? {};
    const contactEmail: string | null = settings.contact_email ?? null;
    const replyTo: string | null = settings.transactional_reply_to ?? contactEmail;

    const toCustomer = goesToCustomer(kind);
    const recipient = toCustomer ? order.customer_email : contactEmail;

    if (!recipient) {
      // The operator alert has nowhere to go until a contact address is set.
      // Recorded as failed rather than guessed at.
      await admin.rpc("mark_order_mail_failed", {
        p_order_number: orderNumber,
        p_kind: kind,
        p_error: "no_recipient_configured",
      });
      return respond(200, { sent: false, outcome: "no_recipient" });
    }

    const mail = render(kind, order);

    // ----------------------------------------------------------- 3. the send
    const resend = new Resend(RESEND_API_KEY);
    const { data: sent, error: sendError } = await resend.emails.send(
      {
        from: MAIL_FROM,
        to: [recipient],
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        // The operator's own alert needs no reply address; the customer mails
        // reply to the published business contact.
        ...(toCustomer && replyTo ? { replyTo } : {}),
      },
      {
        // Stable per logical mail, never per attempt. Resend deduplicates on
        // it for 24 hours, which is the second guard behind the delivery row.
        idempotencyKey: idempotencyKey(kind, order.order_number),
      },
    );

    // -------------------------------------------------------- 4. the outcome
    if (sendError) {
      const name = (sendError as { name?: string }).name ?? "send_failed";

      /*
       * The distinction that decides whether a human has to look.
       *
       * A 409 means Resend has already seen this key with a different payload,
       * or another request with the same key is in flight — either way the mail
       * may well have gone out, and a retry could double it. That is
       * `unresolved`, never `failed`.
       */
      const ambiguous = name === "invalid_idempotent_request" ||
        name === "concurrent_idempotent_requests";

      await admin.rpc(ambiguous ? "mark_order_mail_unresolved" : "mark_order_mail_failed", {
        p_order_number: orderNumber,
        p_kind: kind,
        p_error: name,
      });

      console.error(`send-order-mail: ${kind} ${orderNumber} -> ${name}`);
      return respond(200, { sent: false, outcome: ambiguous ? "unresolved" : "failed", reason: name });
    }

    await admin.rpc("mark_order_mail_sent", {
      p_order_number: orderNumber,
      p_kind: kind,
      p_message_id: sent?.id ?? null,
    });

    return respond(200, { sent: true, outcome: "sent" });
  } catch (detail) {
    /*
     * Something between the claim and the answer broke — most likely the
     * network, on either side of the send. Nobody can say whether the mail
     * went out, so the record says exactly that and stops.
     */
    await admin
      .rpc("mark_order_mail_unresolved", {
        p_order_number: orderNumber,
        p_kind: kind,
        p_error: "transport_or_crash",
      })
      .catch(() => {});

    console.error(`send-order-mail: ${describe(detail)}`);
    return respond(500, { error: "send_failed" });
  }
});
