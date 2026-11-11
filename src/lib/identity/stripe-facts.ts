/**
 * What is known about the Stripe payment presentation — and what is not
 * (ADR-0184, AP7).
 *
 * MEASURED, NOT ASSUMED. Every "sent" entry below is a field that
 * `buildSessionForm()` in `supabase/functions/create-payment/session.ts`
 * actually sets, and every "not sent" entry one it deliberately leaves out;
 * `stripe-facts.test.ts` holds this list against that file. SkyIsles reads no
 * Stripe account data, so the dashboard settings are listed as unknown rather
 * than filled in from memory.
 *
 * Static data: no Stripe call, no secret, no setting changed.
 */

export type StripeFact = { label: string; detail: string };

/** What SkyIsles sends with every Checkout Session (`buildSessionForm`). */
export const SENT_TO_STRIPE: readonly (StripeFact & { field: string })[] = [
  { field: "mode", label: "Zahlungsart der Sitzung", detail: "Einmalzahlung (mode=payment), gehostete Stripe-Checkout-Seite." },
  { field: "line_items", label: "Positionen", detail: "Artikelname aus der Bestellung, Einzelpreis und Menge; Versand als eigene Position „Versand · <Versandart>“." },
  { field: "customer_email", label: "Kunden-E-Mail", detail: "Die E-Mail-Adresse aus der Bestellung." },
  { field: "locale", label: "Sprache", detail: "Deutsch (locale=de)." },
  { field: "client_reference_id", label: "Referenz", detail: "Die Bestellnummer, für den Abgleich mit SkyIsles." },
  { field: "metadata", label: "Metadaten", detail: "Interne Bestell- und Versuchsnummer, für den Webhook." },
  { field: "success_url", label: "Rücksprung", detail: "Erfolgs- und Abbruchseite von SkyIsles." },
  { field: "expires_at", label: "Ablauf", detail: "Die Sitzung läuft nach festgelegter Zeit ab." },
];

/** What SkyIsles deliberately does NOT send — so Stripe's own settings apply. */
export const NOT_SENT_TO_STRIPE: readonly (StripeFact & { field: string })[] = [
  { field: "statement_descriptor", label: "Kontoauszugstext", detail: "Kein eigener Text und kein Zusatz je Zahlung — es gilt der im Stripe-Konto hinterlegte." },
  { field: "payment_method_types", label: "Zahlungsarten", detail: "Nicht festgelegt — Stripe zeigt die im Dashboard aktivierten Zahlungsarten." },
  { field: "invoice_creation", label: "Stripe-Rechnungen", detail: "Nicht verwendet. Die Rechnung stellt SkyIsles selbst aus." },
  { field: "automatic_tax", label: "Stripe Tax", detail: "Nicht verwendet — Stripe würde sonst eine Steuerzeile berechnen, die die Bestellung nicht trägt." },
];

/** Settings that live only in the Stripe dashboard. Their values are not known here. */
export const DASHBOARD_ONLY: readonly StripeFact[] = [
  { label: "Öffentlicher Unternehmensname", detail: "Steht auf der Checkout-Seite und auf Stripe-Belegen." },
  { label: "Statement Descriptor (Kontoauszugstext)", detail: "Der Text, den Stripe an die Bank übergibt." },
  { label: "Zahlungsbelege per E-Mail", detail: "Ob Stripe nach einer erfolgreichen Zahlung selbst einen Beleg an die Kunden-E-Mail schickt." },
  { label: "Checkout-Branding", detail: "Logo, Symbol, Farben und Schrift der Checkout-Seite." },
  { label: "Aktivierte Zahlungsarten", detail: "Karte, PayPal, Klarna usw. — je nach Konto und Land." },
  { label: "Support-Kontakt bei Stripe", detail: "Telefon, E-Mail und Website, die Stripe Kunden zeigt." },
];

/** What neither SkyIsles nor the dashboard fully controls. */
export const STRIPE_OR_BANK: readonly StripeFact[] = [
  { label: "Darstellung auf dem Kontoauszug", detail: "Die Bank kürzt, ergänzt oder ersetzt den übergebenen Text nach eigenen Regeln." },
  { label: "Gestaltung des Stripe-Belegs", detail: "Aufbau und Wortlaut des Belegs legt Stripe fest." },
  { label: "Angebotene Zahlungsarten im Einzelfall", detail: "Stripe blendet Zahlungsarten je nach Gerät, Land und Betrag ein oder aus." },
];

/** The dashboard's settings page. A link, nothing more. */
export const STRIPE_DASHBOARD_URL = "https://dashboard.stripe.com/settings";
