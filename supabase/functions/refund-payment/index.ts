/**
 * refund-payment — die einzige Stelle in SkyIsles, die Geld zurückgeben kann.
 *
 * Sie läuft in Supabase und nicht auf Vercel, aus demselben Grund wie
 * `create-payment`: der Restricted Key und der Service-Role-Key müssen im
 * Web-Deployment nie existieren (ADR-0051, `docs/DEPLOYMENT.md`).
 *
 * ---------------------------------------------------------------------------
 * WAS SIE NICHT KANN, UND ZWAR VON BAUART
 *
 *   * Sie kann keinen Betrag wählen. Der Rumpf nennt eine Erstattungs-ID und
 *     sonst nichts; Betrag, Währung, Welt und Zahlung kommen aus der
 *     Datenbank. Ein manipulierter Aufruf kann deshalb nicht mehr erstatten,
 *     als ein berechtigter Operator gebucht hat.
 *   * Sie kann nichts buchen. `seller_record_refund()` ist der einzige Weg zu
 *     einer Erstattungszeile, und der liegt hinter
 *     `can_operate_active_seller()`.
 *   * Sie kann nichts belasten — nicht wegen des Schlüssels, sondern wegen
 *     ihrer Endpunktliste. Sie benutzt denselben Stripe-Secret-Key wie
 *     `create-payment`, erreicht damit aber ausschließlich `POST /v1/refunds`,
 *     `GET /v1/refunds` und `GET /v1/checkout/sessions/{id}`. Siehe den
 *     Kommentar an den Schlüsseln.
 *   * Sie kann nichts stornieren und nichts einlagern. Bestand, Reservierungen
 *     und Positionszustände werden hier nicht berührt.
 *
 * ---------------------------------------------------------------------------
 * DIE REIHENFOLGE, UND WARUM SIE SO UND NICHT ANDERS IST
 *
 *   1. ANSPRUCH in der Datenbank (`submit_order_refund`). Vor dem Netz, unter
 *      Zeilensperre. Zwei Klicks können nicht beide weiterkommen.
 *   2. SCHLÜSSEL zur Welt der Bestellung. Kein Rückfall zwischen live und
 *      sandbox.
 *   3. ZAHLUNG auflösen. Fehlt die PaymentIntent-Kennung (Bestellungen von
 *      vor `0101` tragen keine), wird sie aus der Checkout-Session gelesen und
 *      über `attach_payment_intent()` nachgetragen.
 *   4. ABGLEICH beim Zahlungsdienst, lesend. Liegt dort schon eine Erstattung
 *      mit unserer Metadaten-Kennung, wird nur angeheftet und NICHT erstattet.
 *      Reicht der Spielraum nicht, wird abgelehnt.
 *   5. ERSTATTEN, mit dem Idempotenzschlüssel aus Schritt 1.
 *   6. ANHEFTEN (`attach_order_refund`) — oder, bei ausdrücklicher Ablehnung,
 *      `fail_order_refund`. Bei unklarer Lage NICHTS: die Buchung bleibt
 *      `pending` und ist fortsetzbar.
 *
 * Schritt 4 ist der Grund, warum ein Wiederholungsversuch auch nach Ablauf des
 * Stripe-Idempotenzschlüssels (dokumentiert 24 Stunden) kein zweites Mal
 * erstattet. Schritt 5 ist der Grund, warum er es innerhalb dieser 24 Stunden
 * nicht einmal versucht — Stripe antwortet dann mit derselben Erstattung.
 *
 * ---------------------------------------------------------------------------
 * DEPLOY MIT JWT-PRÜFUNG AUS
 *
 * `config.toml` setzt `verify_jwt = false`, und die Prüfung findet hier statt —
 * wie bei `send-order-mail`. Nur so lässt sich „kein Benutzer" von
 * „ungültiger Benutzer" unterscheiden, und nur so kann der Rolle NACH dem
 * Token nachgefragt werden: ein gültiger Token allein ist keine Erlaubnis,
 * Geld zu bewegen.
 */

import {
  classifyRefundFailure,
  matchOwnRefund,
  parseRefundRequest,
  refundForm,
  refundedCents,
  selectRefundKey,
  statusForOutcome,
  type RefundOutcome,
  type StripeRefund,
} from "./refund.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
/**
 * DIESELBEN SCHLÜSSEL WIE DIE ZAHLUNG (ADR-0118, geändert vor dem Rollout).
 *
 * Kein eigenes Schlüsselpaar: es gibt genau einen Sandbox- und genau einen
 * Live-Aufbau, und ein zweites Paar hätte eine zweite Rotation, eine zweite
 * Ablaufstelle und eine zweite Art gebracht, eine Erstattung an fehlender
 * Konfiguration scheitern zu lassen.
 *
 * DAS HEISST: DIESER SCHLÜSSEL DARF MEHR, ALS DIESE FUNCTION TUN SOLL. Die
 * Grenze trägt deshalb der Code, nicht das Recht — und sie ist kurz genug, um
 * sie aufzuschreiben:
 *
 *   POST /v1/refunds                  erstatten
 *   GET  /v1/refunds?payment_intent=  abgleichen, bevor erstattet wird
 *   GET  /v1/checkout/sessions/{id}   die PaymentIntent-Kennung nachtragen
 *
 * Mehr erreicht diese Function nicht: keine Zahlung, keine Session-Erzeugung,
 * kein Kundenobjekt, kein Payout. `refund-contract.test.ts` liest die Liste
 * aus diesem Quelltext und lässt keinen vierten Endpunkt zu — das ist die
 * Zusicherung, die an die Stelle des engeren Schlüssels tritt.
 */
const REFUND_KEY_LIVE = Deno.env.get("STRIPE_SECRET_KEY_LIVE");
const REFUND_KEY_SANDBOX = Deno.env.get("STRIPE_SECRET_KEY_SANDBOX");
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const STRIPE_REFUNDS = "https://api.stripe.com/v1/refunds";
const STRIPE_SESSIONS = "https://api.stripe.com/v1/checkout/sessions";

/** Niemals ein ganzer Schlüssel, niemals eine ganze Session. */
function mask(id: string): string {
  const separator = id.lastIndexOf("_");
  return `${separator > 0 ? id.slice(0, separator + 1) : ""}…${id.slice(-4)}`;
}

function respond(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * WER DARF ERSTATTEN — geprüft hier, und nicht geglaubt.
 *
 * Kein geteiltes Geheimnis, und das ist eine Entscheidung: ein Geheimnis, das
 * eine Erstattung auslösen kann, müsste im Web-Deployment liegen, und dort
 * liegt nichts Privilegiertes (ADR-0051, `docs/DEPLOYMENT.md`). Stattdessen
 * derselbe Weg, den `send-order-mail` für den Adminbereich geht: der
 * Benutzertoken wird hier verifiziert, und die Rolle dahinter wird in der
 * Datenbank nachgefragt.
 *
 * Zwei Türen am selben Weg: die Buchung lag schon hinter
 * `can_operate_active_seller()`, und dies ist die zweite. Ein gültiger
 * Benutzertoken ohne Betriebsrolle kommt nicht durch, und ohne Token kommt
 * gar nichts durch.
 */
async function operatorFrom(req: Request): Promise<{ id: string } | { error: string }> {
  const authorization = req.headers.get("Authorization");
  const bearer = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  if (!bearer || bearer === ANON_KEY) return { error: "no_user" };

  const user = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${bearer}` },
  });
  if (!user.ok) return { error: "invalid_user" };
  const payload = await user.json();
  const id = typeof payload?.id === "string" ? payload.id : null;
  if (!id) return { error: "invalid_user" };

  const allowed = await rpc("can_operate_seller_for", { p_user_id: id });
  if (allowed !== true) return { error: "not_an_operator" };
  return { id };
}

async function rpc(fn: string, body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${fn} failed: ${response.status} ${detail.slice(0, 200)}`);
  }
  return await response.json();
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return respond(405, { error: "method_not_allowed" });

  let operator: Awaited<ReturnType<typeof operatorFrom>>;
  try {
    operator = await operatorFrom(req);
  } catch (error) {
    console.error("refund-payment could not authorise:", error);
    return respond(500, { error: "internal" });
  }
  if ("error" in operator) {
    console.log(`refund-payment rejected a caller: ${operator.error}`);
    return respond(403, { error: "forbidden" });
  }

  let request: ReturnType<typeof parseRefundRequest>;
  try {
    request = parseRefundRequest(await req.json());
  } catch {
    request = null;
  }
  if (!request) return respond(400, { error: "bad_request" });

  const finish = (outcome: RefundOutcome): Response =>
    respond(statusForOutcome(outcome), { ...outcome });

  // ---- 1. Anspruch -------------------------------------------------------
  let claim: Record<string, unknown>;
  try {
    claim = (await rpc(
      request.action === "resume" ? "resume_order_refund" : "submit_order_refund",
      { p_refund_id: request.refundId },
    )) as Record<string, unknown>;
  } catch (error) {
    console.error("refund-payment claim failed:", error);
    return respond(500, { error: "internal" });
  }
  if (claim.ok !== true) {
    console.log(`refund-payment refused ${request.refundId}: ${String(claim.reason)}`);
    return finish({ kind: "refused", reason: String(claim.reason ?? "refused") });
  }

  const refundId = Number(claim.refund_id);
  const orderId = Number(claim.order_id);
  const orderNumber = String(claim.order_number);
  const amountCents = Number(claim.amount_cents);
  const paidCents = Math.round(Number(claim.paid_amount) * 100);
  const idempotencyKey = String(claim.idempotency_key);
  const sessionId = claim.session_id === null ? null : String(claim.session_id);
  let intentId = claim.intent_id === null || claim.intent_id === undefined
    ? null : String(claim.intent_id);

  // ---- 2. Schlüssel zur Welt der Bestellung ------------------------------
  const chosen = selectRefundKey(claim.mode, {
    live: REFUND_KEY_LIVE,
    sandbox: REFUND_KEY_SANDBOX,
  });
  if ("problem" in chosen) {
    console.error(`refund-payment ${orderNumber}: ${chosen.problem}`);
    return finish({ kind: "refused", reason: chosen.problem });
  }
  const stripeKey = chosen.key;
  const stripeHeaders = { Authorization: `Bearer ${stripeKey}` };

  // ---- 3. Die Zahlung auflösen ------------------------------------------
  if (intentId === null) {
    if (sessionId === null) {
      return finish({ kind: "refused", reason: "no_successful_payment" });
    }
    try {
      const response = await fetch(`${STRIPE_SESSIONS}/${sessionId}`, { headers: stripeHeaders });
      const payload = await response.json();
      if (!response.ok) {
        const failure = classifyRefundFailure(response.status, payload);
        console.error(`refund-payment session read failed ${mask(sessionId)}: ${failure.code}`);
        // Noch wurde nichts erstattet, also ist auch ein klares Nein hier nur
        // eine Ablehnung des Versuchs — nie ein fehlgeschlagener Geldfluss.
        return finish(failure.unresolved
          ? { kind: "unresolved", code: failure.code }
          : { kind: "refused", reason: failure.code });
      }
      intentId = typeof payload.payment_intent === "string" ? payload.payment_intent : null;
    } catch (error) {
      console.error("refund-payment session unreachable:", error);
      return finish({ kind: "unresolved", code: "provider_unreachable" });
    }
    if (intentId === null) {
      return finish({ kind: "refused", reason: "session_without_payment_intent" });
    }
    // Die Lücke von 0101 nachtragen. Idempotent, überschreibt nie.
    try {
      await rpc("attach_payment_intent", {
        p_provider_payment_id: sessionId,
        p_provider_intent_id: intentId,
      });
    } catch (error) {
      // Kein Abbruch: das ist eine Notiz, keine Bedingung für die Erstattung.
      console.error("refund-payment could not record the intent:", error);
    }
  }

  // ---- 4. Abgleich, lesend ----------------------------------------------
  let existing: StripeRefund[] = [];
  try {
    const url = `${STRIPE_REFUNDS}?payment_intent=${encodeURIComponent(intentId)}&limit=100`;
    const response = await fetch(url, { headers: stripeHeaders });
    const payload = await response.json();
    if (!response.ok) {
      const failure = classifyRefundFailure(response.status, payload);
      console.error(`refund-payment refund list failed: ${failure.code}`);
      return finish({ kind: "unresolved", code: failure.code });
    }
    existing = Array.isArray(payload.data) ? (payload.data as StripeRefund[]) : [];
  } catch (error) {
    console.error("refund-payment refund list unreachable:", error);
    return finish({ kind: "unresolved", code: "provider_unreachable" });
  }

  /*
   * SCHON DA? DANN NUR ANHEFTEN.
   *
   * Das ist die Schicht, die auch nach 24 Stunden hält — wenn Stripes
   * Idempotenzschlüssel abgelaufen ist und ein zweiter POST tatsächlich ein
   * zweites Mal erstatten würde.
   */
  const mine = matchOwnRefund(existing, refundId);
  if (mine) {
    await attach(refundId, mine.id, intentId);
    console.log(`refund-payment ${orderNumber}: replayed ${mask(mine.id)}`);
    return finish({ kind: "settled", providerRefundId: mine.id, replayed: true });
  }

  if (refundedCents(existing) + amountCents > paidCents) {
    console.error(`refund-payment ${orderNumber}: provider headroom exceeded`);
    return finish({ kind: "refused", reason: "provider_already_refunded" });
  }

  // ---- 5. Erstatten ------------------------------------------------------
  let created: StripeRefund | null = null;
  try {
    const response = await fetch(STRIPE_REFUNDS, {
      method: "POST",
      headers: {
        ...stripeHeaders,
        "Content-Type": "application/x-www-form-urlencoded",
        // Aus der Buchung abgeleitet, nicht aus Zeit oder Zufall. Innerhalb
        // von Stripes Fenster antwortet ein zweiter Aufruf mit derselben
        // Erstattung statt mit einer zweiten.
        "Idempotency-Key": idempotencyKey,
      },
      body: refundForm({ intentId, amountCents, refundId, orderId, orderNumber }).toString(),
    });
    const payload = await response.json();
    if (!response.ok) {
      const failure = classifyRefundFailure(response.status, payload);
      if (failure.unresolved) {
        console.error(`refund-payment ${orderNumber} unresolved: ${failure.code}`);
        return finish({ kind: "unresolved", code: failure.code });
      }
      await rpc("fail_order_refund", { p_refund_id: refundId, p_code: failure.code });
      console.error(`refund-payment ${orderNumber} refused by provider: ${failure.code}`);
      return finish({ kind: "failed", code: failure.code });
    }
    created = payload as StripeRefund;
  } catch (error) {
    /*
     * HIER WIRD NICHTS ALS FEHLGESCHLAGEN VERBUCHT.
     *
     * Eine abgerissene Verbindung sagt nichts darüber, ob Stripe die
     * Erstattung angenommen hat. Die Buchung bleibt `pending`, und der
     * nächste Versuch läuft über Schritt 4 — der NACHSIEHT, bevor er sendet.
     */
    console.error("refund-payment provider unreachable:", error);
    return finish({ kind: "unresolved", code: "provider_unreachable" });
  }

  if (!created?.id) {
    return finish({ kind: "unresolved", code: "refund_without_id" });
  }

  /*
   * Stripe kann eine Erstattung sofort als `failed` zurückgeben (manche
   * Zahlungsarten lehnen direkt ab). Dann ist die Antwort erfolgreich, das
   * Geld aber nicht unterwegs.
   */
  if (created.status === "failed" || created.status === "canceled") {
    await rpc("fail_order_refund", {
      p_refund_id: refundId,
      p_code: created.failure_reason ?? `provider_${created.status}`,
    });
    return finish({ kind: "failed", code: created.failure_reason ?? String(created.status) });
  }

  // ---- 6. Anheften ------------------------------------------------------
  await attach(refundId, created.id, intentId);
  console.log(`refund-payment ${orderNumber}: refunded ${mask(created.id)}`);
  return finish({ kind: "settled", providerRefundId: created.id, replayed: false });

  /**
   * Den Beweis schreiben. Scheitert das, ist die Erstattung trotzdem
   * geschehen — deshalb wird geloggt und NICHT als Fehlschlag gemeldet: der
   * Zustand bleibt `pending`, und sowohl der Webhook als auch ein Fortsetzen
   * finden die Erstattung über ihre Metadaten wieder.
   */
  async function attach(id: number, providerRefundId: string, ref: string): Promise<void> {
    try {
      await rpc("attach_order_refund", {
        p_refund_id: id,
        p_provider_refund_id: providerRefundId,
        p_payment_ref: ref,
        p_confirmed_by: "api",
      });
    } catch (error) {
      console.error("refund-payment could not attach the proof:", error);
    }
  }
});
