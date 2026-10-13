/**
 * Die Plattformvorlagen für einen Einkauf (0115/0116).
 *
 * DASSELBE MUSTER WIE `sale-template.ts`, UND ABSICHTLICH NICHT DIESELBE
 * DATEI. Ein Verkauf trägt Gebühren, die der Kanal einbehält; ein Einkauf
 * trägt Kosten, die der Betrieb zahlt. Eine gemeinsame Abstraktion müsste
 * beides „Kostenzeile" nennen und hätte damit genau die Unterscheidung
 * verwischt, auf der die ganze Auszahlungs- und Faktorrechnung beruht.
 *
 * Geteilt wird deshalb die FORM — ein Objekt je Vorlage, ein Union der
 * Kennungen, Vorbelegung über eine Funktion —, nicht der Inhalt. Eine neue
 * Plattform ist ein Eintrag in `PURCHASE_TEMPLATES`, kein zweites Formular.
 */

/** Was in `purchases.platform` landet. Der CHECK aus 0115 kennt genau diese. */
export type PurchasePlatform = "kleinanzeigen" | "willhaben" | "manual";

/** Was in `purchases.payment_method` landet (Entscheidung D8). */
export type PaymentMethod = "card" | "paypal" | "transfer" | "cash" | "platform";

export const PAYMENT_METHODS: readonly PaymentMethod[] =
  ["card", "paypal", "transfer", "cash", "platform"];

/**
 * Kreditkarte als Vorbelegung des FORMULARS, nicht der Spalte.
 *
 * `purchases.payment_method` hat bewusst keinen Standardwert in der
 * Datenbank: ein `default 'card'` hätte jedem der 84 bestehenden Einkäufe
 * rückwirkend eine Zahlungsart zugeschrieben, die niemand erfasst hat. Hier
 * ist es eine Vorbelegung, die der Betreiber überschreibt — dort wäre es eine
 * Behauptung über die Vergangenheit.
 */
export const DEFAULT_PAYMENT_METHOD: PaymentMethod = "card";

export type PurchaseTemplate = {
  readonly id: PurchasePlatform;
  /** Was in `purchases.platform` geschrieben wird. */
  readonly platform: PurchasePlatform;
  /**
   * Ob diese Plattform üblicherweise einen Käuferschutz berechnet.
   *
   * Entscheidet NICHT über einen Betrag — nur darüber, ob das Feld
   * vorbelegt sichtbar ist. Kleinanzeigen und Willhaben berechnen einen,
   * beim Kauf von privat per Überweisung gibt es keinen.
   */
  readonly opensBuyerProtection: boolean;
  /** Die Zahlungsart, die diese Plattform meistens bedeutet. */
  readonly payment: PaymentMethod;
};

export const PURCHASE_TEMPLATES: readonly PurchaseTemplate[] = [
  /*
   * Kleinanzeigen zuerst und als Standard: es ist die Plattform, über die
   * der Betrieb einkauft. Käuferschutz vorbelegt, weil der dort der
   * Normalfall ist — als Feld, nicht als Betrag.
   */
  { id: "kleinanzeigen", platform: "kleinanzeigen", opensBuyerProtection: true, payment: "card" },
  { id: "willhaben", platform: "willhaben", opensBuyerProtection: true, payment: "card" },
  /*
   * „Manuell / Sonstige" ist die Vorlage für alles andere — ein Flohmarkt,
   * eine Übernahme, ein Kauf per Überweisung. Kein Käuferschutz, weil es
   * keine Plattform gibt, die einen erheben könnte.
   */
  { id: "manual", platform: "manual", opensBuyerProtection: false, payment: "transfer" },
];

export const DEFAULT_PURCHASE_TEMPLATE: PurchasePlatform = "kleinanzeigen";

export function purchaseTemplate(id: string): PurchaseTemplate {
  return PURCHASE_TEMPLATES.find((t) => t.id === id)
    ?? PURCHASE_TEMPLATES.find((t) => t.id === DEFAULT_PURCHASE_TEMPLATE)!;
}

export function isPurchasePlatform(value: unknown): value is PurchasePlatform {
  return PURCHASE_TEMPLATES.some((t) => t.id === value);
}

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return (PAYMENT_METHODS as readonly unknown[]).includes(value);
}
