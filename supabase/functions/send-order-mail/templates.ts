/**
 * What the three transactional mails say.
 *
 * Pure functions over the projection `order_mail_payload()` returns — no Deno,
 * no network, no environment. That is deliberate: the wording of a mail a
 * customer receives after paying is worth testing, and a template that imports
 * a runtime cannot be tested from the unit suite.
 *
 * GERMAN, BECAUSE THE PRODUCT IS (ADR-0012, ADR-0019)
 *
 * The copy lives here rather than in `src/lib/i18n/de.ts`: an Edge Function
 * cannot import from the Next.js application, and a second copy of the whole
 * dictionary would be worse than a page of strings next to the only code that
 * renders them. Identifiers stay English.
 *
 * WHAT NO TEMPLATE MAY CONTAIN
 *
 * No capability token, no payment session id, no order id, no SKY-ID, no
 * tracking pixel and no link that carries a secret. `order_mail_payload()`
 * already withholds all of it, and `mail-templates.test.ts` checks the
 * rendered output as well — a projection can be widened by accident, a
 * rendered string is the last place to notice.
 */

/** The order as `order_mail_payload()` returns it. Money arrives as strings. */
export type MailOrder = {
  order_number: string;
  placed_at: string;
  customer_email: string;
  currency: string;
  items_subtotal: string | number;
  shipping_amount: string | number;
  discount_amount: string | number;
  total_amount: string | number;
  shipping_method: string | null;
  tracking_number: string | null;
  shipped_at: string | null;
  payment_status: string;
  needs_resolution: boolean;
  address: {
    first_name: string;
    last_name: string;
    company: string | null;
    street: string;
    house_number: string;
    address_line_2: string | null;
    postal_code: string;
    city: string;
    country_code: string;
  } | null;
  lines: {
    condition: string;
    name: string;
    quantity: number;
    unit_price: string | number;
    line_total: string | number;
  }[];
};

export type RenderedMail = { subject: string; html: string; text: string };

/** The two conditions, as a customer knows them. Mirrors `de.shop`. */
export function conditionLabel(condition: string): string {
  return condition === "boxed" ? "OVP" : "Lose";
}

/**
 * Money, in the product's locale.
 *
 * `numeric` arrives from PostgREST as a string so the exact decimal survives;
 * parsing it here is the last step and the only place a float appears.
 */
export function money(value: string | number | null | undefined): string {
  const amount = typeof value === "string" ? Number(value) : value;
  if (typeof amount !== "number" || !Number.isFinite(amount)) return "–";
  return new Intl.NumberFormat("de-AT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Everything that reaches the HTML goes through this.
 *
 * Names, street names and company names come from a customer's own typing and
 * are stored raw on purpose (CLAUDE.md rule 4). Raw in the database, escaped
 * on the way into markup — an ampersand in a company name must not become
 * broken HTML, and nothing a customer types may become an element.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The delivery address as a customer would write it on an envelope. */
export function addressLines(address: MailOrder["address"]): string[] {
  if (!address) return [];
  const country = address.country_code === "DE" ? "Deutschland" : address.country_code;
  return [
    `${address.first_name} ${address.last_name}`.trim(),
    address.company ?? "",
    `${address.street} ${address.house_number}`.trim(),
    address.address_line_2 ?? "",
    `${address.postal_code} ${address.city}`.trim(),
    country,
  ].filter((line) => line !== "");
}

/* ---------------------------------------------------------------- rendering */

const WRAP = (title: string, body: string): string =>
  `<!doctype html><html lang="de"><head><meta charset="utf-8">` +
  `<meta name="viewport" content="width=device-width,initial-scale=1">` +
  `<title>${escapeHtml(title)}</title></head>` +
  // Inline styles only: mail clients discard a stylesheet, and a dark palette
  // would be unreadable in the many clients that force a white ground.
  `<body style="margin:0;padding:24px;background:#f6f3ec;` +
  `font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;` +
  `color:#241f19;line-height:1.55">` +
  `<div style="max-width:560px;margin:0 auto;background:#fffdf8;border:1px solid #ddd4c1;` +
  `border-radius:10px;padding:28px">` +
  `<div style="font-size:20px;font-weight:600;letter-spacing:-0.01em;margin-bottom:20px">` +
  `Sky<span style="color:#8a5a12">Isles</span></div>` +
  body +
  `</div></body></html>`;

const H1 = (text: string): string =>
  `<h1 style="font-size:19px;margin:0 0 12px;font-weight:600">${escapeHtml(text)}</h1>`;

const P = (text: string): string =>
  `<p style="margin:0 0 12px">${escapeHtml(text)}</p>`;

const MUTED = (text: string): string =>
  `<p style="margin:16px 0 0;font-size:12px;color:#6b6153">${escapeHtml(text)}</p>`;

function lineTable(order: MailOrder): string {
  const rows = order.lines
    .map(
      (line) =>
        `<tr>` +
        `<td style="padding:6px 0;vertical-align:top">${escapeHtml(line.name)}` +
        `<br><span style="font-size:12px;color:#6b6153">${escapeHtml(conditionLabel(line.condition))}` +
        ` · ${line.quantity} × ${escapeHtml(money(line.unit_price))}</span></td>` +
        `<td style="padding:6px 0;text-align:right;vertical-align:top;white-space:nowrap">` +
        `${escapeHtml(money(line.line_total))}</td>` +
        `</tr>`,
    )
    .join("");

  const shipping =
    Number(order.shipping_amount) === 0 ? "Kostenlos" : money(order.shipping_amount);

  return (
    `<table style="width:100%;border-collapse:collapse;font-size:14px;margin:8px 0 0">` +
    rows +
    `<tr><td colspan="2" style="padding:10px 0 0;border-top:1px solid #ddd4c1"></td></tr>` +
    `<tr><td style="padding:2px 0;color:#6b6153">Zwischensumme</td>` +
    `<td style="padding:2px 0;text-align:right">${escapeHtml(money(order.items_subtotal))}</td></tr>` +
    `<tr><td style="padding:2px 0;color:#6b6153">Versand${
      order.shipping_method ? ` (${escapeHtml(order.shipping_method)})` : ""
    }</td>` +
    `<td style="padding:2px 0;text-align:right">${escapeHtml(shipping)}</td></tr>` +
    `<tr><td style="padding:8px 0 0;font-weight:600;border-top:1px solid #ddd4c1">Gesamtbetrag</td>` +
    `<td style="padding:8px 0 0;text-align:right;font-weight:600;border-top:1px solid #ddd4c1">` +
    `${escapeHtml(money(order.total_amount))}</td></tr>` +
    `</table>`
  );
}

function lineText(order: MailOrder): string {
  const rows = order.lines
    .map(
      (line) =>
        `  ${line.quantity} × ${line.name} (${conditionLabel(line.condition)})` +
        `  ${money(line.line_total)}`,
    )
    .join("\n");
  const shipping =
    Number(order.shipping_amount) === 0 ? "Kostenlos" : money(order.shipping_amount);
  return (
    `${rows}\n\n` +
    `  Zwischensumme: ${money(order.items_subtotal)}\n` +
    `  Versand${order.shipping_method ? ` (${order.shipping_method})` : ""}: ${shipping}\n` +
    `  Gesamtbetrag: ${money(order.total_amount)}`
  );
}

function addressBlock(order: MailOrder): { html: string; text: string } {
  const lines = addressLines(order.address);
  if (lines.length === 0) return { html: "", text: "" };
  return {
    html:
      `<p style="margin:20px 0 0;font-size:13px;color:#6b6153">Lieferadresse</p>` +
      `<p style="margin:2px 0 0;font-size:14px">${lines.map(escapeHtml).join("<br>")}</p>`,
    text: `\n\nLieferadresse\n${lines.map((l) => `  ${l}`).join("\n")}`,
  };
}

/**
 * The invoice note — and it belongs to ONE mail.
 *
 * Quiet, at the end, and unambiguous. Invoices are their own release step, and
 * an order confirmation that let itself be mistaken for one would be the kind
 * of document somebody files for their accounts.
 *
 * It is deliberately absent from the shipping confirmation and the operator
 * alert: neither is a Bestellbestätigung, so the sentence would be describing
 * a document the reader is not holding. It said so anyway in the first staging
 * run, which is how it was caught.
 */
const NOT_AN_INVOICE = "Diese Bestellbestätigung ist keine Rechnung.";

/* ------------------------------------------------------- 1. payment confirmed */

export function paymentConfirmation(order: MailOrder): RenderedMail {
  const address = addressBlock(order);
  const subject = `Bestellung ${order.order_number} — Zahlung bestätigt`;

  const html = WRAP(
    subject,
    H1("Danke — wir haben deine Zahlung erhalten.") +
      P(
        `Deine Bestellung ${order.order_number} ist bei uns eingegangen und bezahlt. ` +
          `Du hörst wieder von uns, sobald die Sendung unterwegs ist.`,
      ) +
      lineTable(order) +
      address.html +
      MUTED(NOT_AN_INVOICE),
  );

  const text =
    `Danke — wir haben deine Zahlung erhalten.\n\n` +
    `Deine Bestellung ${order.order_number} ist bei uns eingegangen und bezahlt.\n` +
    `Du hörst wieder von uns, sobald die Sendung unterwegs ist.\n\n` +
    lineText(order) +
    address.text +
    `\n\n${NOT_AN_INVOICE}\n`;

  return { subject, html, text };
}

/* ------------------------------------------------------- 2. shipping confirmed */

export function shippingConfirmation(order: MailOrder): RenderedMail {
  const address = addressBlock(order);
  const subject = `Bestellung ${order.order_number} — unterwegs`;

  /*
   * The tracking number is shown, never linked.
   *
   * It is stored exactly as the carrier issued it, with no carrier detection
   * (0018) — so there is no URL this code could build that is right for both
   * DHL and Hermes, and a wrong link is worse than none.
   */
  const tracking = order.tracking_number
    ? P(`Sendungsnummer: ${order.tracking_number}`)
    : "";
  const trackingText = order.tracking_number
    ? `\nSendungsnummer: ${order.tracking_number}\n`
    : "";

  const html = WRAP(
    subject,
    H1("Deine Bestellung ist unterwegs.") +
      P(
        `Wir haben Bestellung ${order.order_number} verschickt` +
          (order.shipping_method ? ` — ${order.shipping_method}.` : "."),
      ) +
      tracking +
      lineTable(order) +
      address.html,
  );

  const text =
    `Deine Bestellung ist unterwegs.\n\n` +
    `Wir haben Bestellung ${order.order_number} verschickt` +
    (order.shipping_method ? ` — ${order.shipping_method}.\n` : ".\n") +
    trackingText +
    `\n` +
    lineText(order) +
    address.text +
    "\n";

  return { subject, html, text };
}

/* --------------------------------------------------------- 3. operator alert */

/**
 * The internal warning. Goes to the operator, never to a customer.
 *
 * Deliberately terse and deliberately alarming: it means money arrived and
 * nothing was booked, so stock the ledger still counts as present may be
 * about to go out of the door (ADR-0050). It names the order and what to do,
 * and carries no customer address — the operator opens the order to see that.
 */
export function resolutionAlert(order: MailOrder): RenderedMail {
  const subject = `SkyIsles: Bestellung ${order.order_number} muss geprüft werden`;

  const body =
    `Bestellung ${order.order_number} ist bezahlt, aber es wurde keine Reservierung ` +
    `umgewandelt und kein Bestand gebucht. Der Versand ist gesperrt, bis das geklärt ist.`;
  const next = "Zu entscheiden: nachbestellen oder erstatten. Details im Adminbereich unter Bestellungen.";

  const html = WRAP(
    subject,
    H1(`Prüfen: ${order.order_number}`) +
      P(body) +
      P(next) +
      `<p style="margin:16px 0 0;font-size:14px">Gesamtbetrag: ` +
      `<strong>${escapeHtml(money(order.total_amount))}</strong></p>`,
  );

  const text =
    `Prüfen: ${order.order_number}\n\n${body}\n\n${next}\n\n` +
    `Gesamtbetrag: ${money(order.total_amount)}\n`;

  return { subject, html, text };
}

/* ------------------------------------------------------------------ dispatch */

export const MAIL_KINDS = [
  "payment_confirmation",
  "shipping_confirmation",
  "resolution_alert",
] as const;

export type MailKind = (typeof MAIL_KINDS)[number];

export function isMailKind(value: unknown): value is MailKind {
  return typeof value === "string" && (MAIL_KINDS as readonly string[]).includes(value);
}

export function render(kind: MailKind, order: MailOrder): RenderedMail {
  switch (kind) {
    case "payment_confirmation":
      return paymentConfirmation(order);
    case "shipping_confirmation":
      return shippingConfirmation(order);
    case "resolution_alert":
      return resolutionAlert(order);
  }
}

/** Who a mail is for. Decides the recipient and whether a Reply-To is set. */
export function goesToCustomer(kind: MailKind): boolean {
  return kind !== "resolution_alert";
}

/**
 * The idempotency key Resend deduplicates on.
 *
 * Stable per logical mail, never per attempt: a retry of the same mail inside
 * Resend's 24-hour window must be recognised as the same request, which is the
 * whole point. The order **number** rather than the row id — it is the only
 * customer-facing identity an order has, and the id is internal.
 *
 * Resend allows 256 characters; this is well under thirty.
 */
export function idempotencyKey(kind: MailKind, orderNumber: string): string {
  return `skyisles/${kind.replace(/_/g, "-")}/${orderNumber}`;
}
