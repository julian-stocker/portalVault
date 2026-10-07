/**
 * Gebucht ist nicht erstattet (0111).
 *
 * Diese Datei hält die eine Unterscheidung, die bei SI-2026-001009 gefehlt
 * hat, in reiner Form: `order_refunds` sagt, was erstattet werden SOLL,
 * `provider_status` sagt, ob Geld geflossen IST.
 *
 *   `none`       gebucht und nie an den Zahlungsdienst geschickt. Für die
 *                Kundschaft existiert diese Erstattung nicht.
 *   `pending`    geschickt, keine Bestätigung. Kein Geld und kein Nein — ein
 *                offener Vorgang, der fortgesetzt wird, nicht wiederholt.
 *   `succeeded`  der Zahlungsdienst hat bestätigt. ERST HIER ist es Geld.
 *   `failed`     der Zahlungsdienst hat abgelehnt oder zurückgezogen.
 *
 * WARUM DAS HIER LIEGT UND NICHT IN EINER KOMPONENTE. Vier Zustände, drei
 * Bildschirme (Betreiberliste, Bestelldetail, Kundenansicht) und eine Mail
 * hängen daran. Eine Regel, die an vier Stellen steht, ist vier Regeln, die
 * auseinanderlaufen können — und die eine, die hier falsch wäre, hat schon
 * einmal einer Kundin gesagt, ihr Geld sei unterwegs.
 */

export const PROVIDER_REFUND_STATES = ["none", "pending", "succeeded", "failed"] as const;

export type ProviderRefundStatus = (typeof PROVIDER_REFUND_STATES)[number];

export function isProviderRefundStatus(value: unknown): value is ProviderRefundStatus {
  return (PROVIDER_REFUND_STATES as readonly unknown[]).includes(value);
}

/** Eine Erstattung, so weit diese Datei sie braucht. */
export type RefundFacts = {
  amount: string | number;
  provider_status?: string | null;
  provider_refund_id?: string | null;
};

/**
 * Der Zustand einer Erstattung, defensiv gelesen.
 *
 * Ein fehlendes Feld ist `none` und nicht „wahrscheinlich erstattet": wo die
 * Antwort unbekannt ist, ist die vorsichtige die richtige. Genau diese
 * Richtung war der Fehler.
 */
export function providerStatus(refund: RefundFacts): ProviderRefundStatus {
  const raw = refund.provider_status ?? null;
  return isProviderRefundStatus(raw) ? raw : "none";
}

/** Geld, das zurückgegangen ist. Die Zahl für jede Außenwirkung. */
export function settledRefundTotal(refunds: readonly RefundFacts[]): number {
  return round(refunds
    .filter((one) => providerStatus(one) === "succeeded")
    .reduce((sum, one) => sum + Number(one.amount), 0));
}

/** Alles Gebuchte, gleich welchen Zustands. Die Zahl für die Obergrenze. */
export function bookedRefundTotal(refunds: readonly RefundFacts[]): number {
  return round(refunds.reduce((sum, one) => sum + Number(one.amount), 0));
}

/**
 * Was gebucht, aber nicht erstattet ist — die offene Arbeit.
 *
 * Die eine Zahl, die der Betrieb sehen muss und die Kundschaft nicht: sie ist
 * eine Absicht des Betriebs und keine Tatsache über ein fremdes Konto.
 */
export function unsettledRefundTotal(refunds: readonly RefundFacts[]): number {
  return round(bookedRefundTotal(refunds) - settledRefundTotal(refunds));
}

/** In ganzen Cent rechnen und einmal zurück — kein Gleitkommastaub. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Was mit einer Erstattung in diesem Zustand noch getan werden kann.
 *
 * `submit` ist der erste Versuch oder ein neuer nach einer ausdrücklichen
 * Ablehnung. `resume` ist der offene Vorgang: dort wird NACHGESEHEN und nur
 * dann erneut gesendet, wenn beim Zahlungsdienst nichts liegt. Eine bestätigte
 * Erstattung lässt nichts mehr zu, und das ist der Punkt.
 */
export type RefundAction = "submit" | "resume" | null;

export function refundAction(refund: RefundFacts): RefundAction {
  switch (providerStatus(refund)) {
    case "none":
    case "failed":
      return "submit";
    case "pending":
      return "resume";
    case "succeeded":
      return null;
  }
}

/**
 * Darf diese Erstattung die Kundschaft erreichen?
 *
 * Status, Kundenansicht, Nachrichtenzeile und Mail fragen alle genau das —
 * und bekommen genau eine Antwort.
 */
export function refundIsVisibleToCustomer(refund: RefundFacts): boolean {
  return providerStatus(refund) === "succeeded";
}
