/**
 * Womit bezahlt wurde, als ein Satz (0101).
 *
 * Rein, damit derselbe Satz überall gleich lautet und sich prüfen lässt,
 * ohne eine Seite zu rendern.
 *
 * **FAIL-SOFT IST HIER DIE REGEL, NICHT DIE AUSNAHME.** Für jede Bestellung
 * vor `0101` gibt es keinen Schnappschuss, und für manche Zahlungsarten gibt
 * es weder Marke noch letzte Ziffern. Dann sagt die Anzeige weniger — oder
 * gar nichts — statt etwas zu erfinden. Eine geratene Kartenmarke neben einem
 * echten Betrag wäre schlimmer als eine Lücke.
 */
import { de } from "@/lib/i18n/de";

export type PaymentMethodSnapshot = {
  type?: string | null;
  brand?: string | null;
  last4?: string | null;
  wallet?: string | null;
};

/** Die Wallets, die einen eigenen Namen verdienen. Alles andere bleibt roh. */
const WALLETS: Record<string, string> = {
  apple_pay: "Apple Pay",
  google_pay: "Google Pay",
  samsung_pay: "Samsung Pay",
  link: "Link",
};

/** Kartenmarken, die anders geschrieben werden als Stripe sie schickt. */
const BRANDS: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  discover: "Discover",
  diners: "Diners Club",
  jcb: "JCB",
  unionpay: "UnionPay",
};

function titled(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * `Apple Pay · Visa •••• 4242` — oder so viel davon, wie bekannt ist.
 *
 * `null`, wenn gar nichts bekannt ist: dann zeigt die Seite die Zeile nicht.
 */
export function paymentMethodLabel(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const snapshot = raw as PaymentMethodSnapshot;

  const type = typeof snapshot.type === "string" ? snapshot.type.trim() : "";
  if (type === "") return null;

  const parts: string[] = [];

  const wallet = typeof snapshot.wallet === "string" ? snapshot.wallet.trim() : "";
  if (wallet !== "") parts.push(WALLETS[wallet] ?? titled(wallet.replace(/_/g, " ")));

  if (type === "card") {
    const brand = typeof snapshot.brand === "string" ? snapshot.brand.trim() : "";
    const last4 = typeof snapshot.last4 === "string" ? snapshot.last4.trim() : "";
    const card = [
      brand === "" ? de.account.orders.paymentCard : (BRANDS[brand] ?? titled(brand)),
      /^[0-9]{4}$/.test(last4) ? `•••• ${last4}` : "",
    ].filter(Boolean).join(" ");
    parts.push(card);
  } else if (wallet === "" || WALLETS[wallet] === undefined) {
    // Eine Zahlart ohne Karte nennt sich selbst: paypal, klarna, sofort …
    parts.push(titled(type.replace(/_/g, " ")));
  }

  const label = parts.filter((part) => part !== "").join(" · ");
  return label === "" ? null : label;
}
