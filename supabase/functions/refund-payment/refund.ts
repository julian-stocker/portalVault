/**
 * refund-payment — alles, was ohne Netz entschieden werden kann (0111).
 *
 * Dieselbe Trennung wie `create-payment/session.ts`: der Teil, der rechnet und
 * entscheidet, liegt hier und ist von Vitest aus prüfbar; `index.ts` ist die
 * Verdrahtung. Ein Geldfluss-Pfad, dessen Entscheidungen nur im Deployment
 * überprüfbar sind, ist ein Geldfluss-Pfad, der nicht geprüft wird.
 *
 * WARUM DIESE DATEI IHRE EIGENE SCHLÜSSELWAHL HAT, obwohl `session.ts` eine
 * fast gleiche besitzt: eine Edge Function wird pro Ordner gebündelt. Ein
 * Import aus dem Nachbarordner wäre eine Abhängigkeit, die im Deployment
 * fehlen kann — und die Schlüsselwahl ist das Letzte, was zur Laufzeit
 * überraschen darf. Die Regel ist dieselbe und wird von beiden Seiten
 * getestet.
 *
 * ES IST DERSELBE SCHLÜSSEL WIE BEI DER ZAHLUNG — `STRIPE_SECRET_KEY_SANDBOX`
 * bzw. `_LIVE`. Ein eigener Restricted Key wäre engeres Recht gewesen, kostet
 * aber ein zweites Schlüsselpaar, eine zweite Rotation und eine zweite Stelle,
 * an der eine fehlende Konfiguration eine Erstattung verhindert; für genau
 * einen Sandbox-Aufbau und genau einen Live-Aufbau ist das mehr Verwaltung als
 * Schutz (ADR-0118).
 *
 * WAS DIE GRENZE STATTDESSEN TRÄGT, IST DER CODE. Dieser Schlüssel darf bei
 * Stripe mehr, als diese Function tun soll — deshalb ist die Liste der
 * erreichbaren Endpunkte selbst die Grenze: `POST /v1/refunds`,
 * `GET /v1/refunds` und `GET /v1/checkout/sessions/{id}`, und nichts
 * darüber hinaus. `refund-contract.test.ts` liest sie aus dem Quelltext und
 * lässt keinen vierten zu.
 */

/* ------------------------------------------------------------- die Anfrage */

export type RefundAction = "submit" | "resume";

export type RefundRequest = {
  refundId: number;
  action: RefundAction;
};

/**
 * Die ganze akzeptierte Oberfläche: eine Erstattungs-ID und was damit zu tun
 * ist. KEIN Betrag, keine Bestellung, keine Zahlungskennung.
 *
 * Das ist der Kern des Sicherheitsmodells dieser Function: sie kann nur
 * erstatten, was ein berechtigter Operator über `seller_record_refund()`
 * gebucht hat, und sie erfährt den Betrag aus der Datenbank. Ein manipulierter
 * Aufruf kann die Summe nicht nennen und die Bestellung nicht wählen.
 */
export function parseRefundRequest(body: unknown): RefundRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = body as Record<string, unknown>;

  const id =
    typeof raw.refund_id === "number"
      ? raw.refund_id
      : typeof raw.refund_id === "string" && /^\d+$/.test(raw.refund_id)
        ? Number(raw.refund_id)
        : null;
  if (id === null || !Number.isSafeInteger(id) || id < 1) return null;

  const action = raw.action === undefined || raw.action === null ? "submit" : raw.action;
  if (action !== "submit" && action !== "resume") return null;

  return { refundId: id, action };
}

/* --------------------------------------------------------- der Schlüssel */

export type RefundMode = "live" | "sandbox";

export type RefundKeyring = {
  live?: string | null;
  sandbox?: string | null;
};

export type RefundKeyChoice = { key: string } | { problem: string };

export function isRefundMode(value: unknown): value is RefundMode {
  return value === "live" || value === "sandbox";
}

/**
 * `sk_live_…`/`rk_live_…` → live, `sk_test_…`/`rk_test_…` → test.
 *
 * Beide Präfixe, weil beide Formen zulässig sind: heute benutzt diese Function
 * den gewöhnlichen Secret Key (`sk_`), und ein später eingeschränkter
 * Restricted Key (`rk_`) würde ohne Codeänderung passen.
 */
export function refundKeyMode(key: string): "live" | "test" | "unknown" {
  if (/^(sk|rk)_live_/.test(key)) return "live";
  if (/^(sk|rk)_test_/.test(key)) return "test";
  return "unknown";
}

/**
 * Welcher Schlüssel für welche Welt — und niemals ein Rückfall.
 *
 * Die Welt kommt aus der BESTELLUNG (`orders.commerce_mode`, bei der Anlage
 * eingefroren), nie aus der Anfrage. Ein `sk_live_` im Sandbox-Fach ist ein
 * Konfigurationsunfall, der echtes Geld bewegen würde: deshalb muss der
 * Schlüssel dasselbe sagen wie die Welt, sonst gibt es keinen Aufruf.
 *
 * Ein Deployment, das nur den Sandbox-Schlüssel hält, bedient Sandbox-Orders
 * und verweigert Live-Orders. Genau dieser Zustand ist gewollt, solange der
 * Live-Schlüssel nicht gesetzt ist — und er ist auf Staging der Dauerzustand.
 */
export function selectRefundKey(mode: unknown, keys: RefundKeyring): RefundKeyChoice {
  if (!isRefundMode(mode)) return { problem: `unknown_refund_mode:${String(mode)}` };

  const key = mode === "live" ? keys.live : keys.sandbox;
  if (!key) return { problem: `missing_refund_key_for_${mode}` };

  const keyMode = refundKeyMode(key);
  if (keyMode === "unknown") return { problem: `unrecognised_refund_key_for_${mode}` };

  const wanted = mode === "live" ? "live" : "test";
  if (keyMode !== wanted) return { problem: `refund_key_is_${keyMode}_but_mode_is_${mode}` };

  return { key };
}

/* ------------------------------------------------------- die Stripe-Anfrage */

/** Was `POST /v1/refunds` bekommt. Minor Units kommen aus SQL, nicht von hier. */
export function refundForm(input: {
  intentId: string;
  amountCents: number;
  refundId: number;
  orderId: number;
  orderNumber: string;
}): URLSearchParams {
  const form = new URLSearchParams();
  form.set("payment_intent", input.intentId);
  form.set("amount", String(input.amountCents));
  /*
   * DIE METADATEN SIND DIE ZUORDNUNG (0111).
   *
   * Ohne sie müsste ein Webhook über Betrag und Zeit raten, welche Buchung
   * gemeint ist — und bei zwei Erstattungen gleicher Höhe wäre jede Antwort
   * eine Wahrscheinlichkeit. Mit ihnen ist sie exakt.
   *
   * `reason` wird bewusst NICHT gesetzt: Stripe kennt dort nur `duplicate`,
   * `fraudulent` und `requested_by_customer`, und ein falsch gewähltes Wort
   * hat Folgen für Streitfälle. Der echte Grund steht in `order_refunds.reason`.
   */
  form.set("metadata[order_refund_id]", String(input.refundId));
  form.set("metadata[order_id]", String(input.orderId));
  form.set("metadata[order_number]", input.orderNumber);
  form.set("metadata[source]", "skyisles");
  return form;
}

/* ------------------------------------------------------- die Abgleichslese */

/** Nur die Felder, die wir von einem Stripe-Refund lesen dürfen. */
export type StripeRefund = {
  id: string;
  object?: string;
  amount?: number | null;
  currency?: string | null;
  status?: string | null;
  payment_intent?: string | null;
  charge?: string | null;
  failure_reason?: string | null;
  metadata?: Record<string, string> | null;
};

/**
 * Liegt bei Stripe schon eine Erstattung für GENAU DIESE Buchung?
 *
 * Das ist die dritte Idempotenzschicht und die einzige, die auch nach Ablauf
 * eines Stripe-Idempotenzschlüssels (dokumentiert: 24 Stunden) noch hält.
 * Gefunden wird über unsere eigene Metadaten-Kennung — nicht über den Betrag,
 * denn zwei Positionen desselben Preises ergeben zwei gleich hohe
 * Erstattungen, und die darf man nicht verwechseln.
 */
export function matchOwnRefund(
  refunds: readonly StripeRefund[], refundId: number,
): StripeRefund | null {
  const wanted = String(refundId);
  for (const refund of refunds) {
    if (refund.metadata?.order_refund_id === wanted) return refund;
  }
  return null;
}

/**
 * Was bei Stripe insgesamt schon zurückgegangen ist, in Cent.
 *
 * `failed` und `canceled` zählen NICHT: das Geld ist dort nicht geflossen.
 * Alles andere zählt, auch `pending` — eine angestoßene Erstattung ist
 * unterwegs, und sie zweimal anzustoßen wäre genau der Fehler, den dieser
 * Vertrag verhindert.
 */
export function refundedCents(refunds: readonly StripeRefund[]): number {
  let total = 0;
  for (const refund of refunds) {
    if (refund.status === "failed" || refund.status === "canceled") continue;
    total += Number(refund.amount ?? 0);
  }
  return total;
}

/**
 * Darf dieser Betrag überhaupt noch erstattet werden?
 *
 * Die Datenbank prüft dieselbe Grenze gegen ihre eigenen bestätigten
 * Erstattungen; diese Prüfung fragt den Zahlungsdienst. Beide müssen
 * zustimmen — eine im Dashboard erstattete Summe kennt nur Stripe, eine
 * gebuchte nur wir.
 */
export function headroomCents(paidCents: number, refunds: readonly StripeRefund[]): number {
  return paidCents - refundedCents(refunds);
}

/* ----------------------------------------------------- Stripe-Fehlerklassen */

export type RefundFailure = {
  /** Stabil, kurz, für `order_refunds.failure_code`. */
  code: string;
  /**
   * `true` heißt: der Zustand ist UNKLAR, nicht fehlgeschlagen. Die Buchung
   * bleibt `pending`, und der Operator setzt fort. `false` heißt: Stripe hat
   * ausdrücklich abgelehnt, und die Buchung wird `failed`.
   */
  unresolved: boolean;
};

/**
 * Ein Netzwerkabbruch ist kein Nein.
 *
 * Das ist die wichtigste Unterscheidung dieser Datei. Wer eine verlorene
 * Antwort als „fehlgeschlagen" verbucht, lädt zu einem zweiten Versuch ein —
 * und wenn der erste doch durchkam, ist das Geld zweimal unterwegs. Also:
 * nur eine ausdrückliche Ablehnung von Stripe ist eine Ablehnung.
 */
export function classifyRefundFailure(
  status: number | null, payload: unknown,
): RefundFailure {
  if (status === null) return { code: "provider_unreachable", unresolved: true };
  if (status >= 500) return { code: `provider_${status}`, unresolved: true };
  if (status === 429) return { code: "provider_rate_limited", unresolved: true };

  const error = (payload as { error?: { code?: string; type?: string } } | null)?.error;
  const code = error?.code ?? error?.type ?? `provider_${status}`;
  /*
   * `idempotency_error` heißt: derselbe Schlüssel wurde mit einem ANDEREN
   * Rumpf benutzt. Das ist ein Programmierfehler bei uns und kein Nein von
   * Stripe — und solange er nicht geklärt ist, darf nichts erneut gesendet
   * werden. Also unaufgelöst.
   */
  if (code === "idempotency_error") return { code: "idempotency_conflict", unresolved: true };
  return { code: String(code).slice(0, 80), unresolved: false };
}

/* ------------------------------------------------------------- die Antwort */

export type RefundOutcome =
  /** Stripe hat erstattet (oder hatte es schon) und die Buchung trägt den Beweis. */
  | { kind: "settled"; providerRefundId: string; replayed: boolean }
  /** Stripe hat ausdrücklich abgelehnt. Die Buchung ist `failed`. */
  | { kind: "failed"; code: string }
  /** Unklar. Die Buchung bleibt `pending` und ist fortsetzbar. */
  | { kind: "unresolved"; code: string }
  /** Gar nicht erst versucht — die Vorbedingungen stimmten nicht. */
  | { kind: "refused"; reason: string };

/** HTTP-Code je Ausgang. `unresolved` ist 503: bitte später fortsetzen. */
export function statusForOutcome(outcome: RefundOutcome): number {
  switch (outcome.kind) {
    case "settled":
      return 200;
    case "failed":
      return 422;
    case "unresolved":
      return 503;
    case "refused":
      return 409;
  }
}
