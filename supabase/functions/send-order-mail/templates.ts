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
  /** Added in 0047: who sold, which terms applied, and the invoice if issued. */
  seller?: {
    name: string | null;
    legal_name: string | null;
    street: string | null;
    postal_code: string | null;
    city: string | null;
    email: string | null;
    vat_id: string | null;
  } | null;
  legal?: { agb_version: string | null; widerruf_version: string | null } | null;
  invoice_number?: string | null;
  refunded_total?: string | null;
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


/* ------------------------------------------------- 0. who sold, on every mail
 *
 * § 312f Abs. 2 BGB wants the contract confirmation on a durable medium with
 * the Art. 246a particulars. An e-mail is durable; a link to a page that can
 * be edited tomorrow is not. So the seller, the terms that applied and the
 * withdrawal instruction travel IN the message.
 *
 * The seller's details come from the order's own snapshot, not from today's
 * settings — the customer contracted with whoever was named then.
 */

/**
 * The site's own address is NOT written here.
 *
 * Every absolute URL this product emits is built from the origin it is serving
 * or from `SITE_URL`, so the same build is correct on the canonical domain, on
 * a preview deployment and on localhost — the property that made the move from
 * a vercel.app host to the real one a documentation change and nothing else
 * (src/lib/layout/domain.test.ts). A confirmation mail pointing at the wrong
 * host is exactly the failure that rule exists to prevent, so the host is
 * passed in.
 */
export type MailSite = { origin: string };

/** The contracting party, in one line. Falls back only if the snapshot is bare. */
function sellerLine(order: MailOrder): string {
  const legal = order.seller?.legal_name?.trim();
  const trade = order.seller?.name?.trim();
  if (legal && trade) return `${legal}, handelnd unter ${trade}`;
  if (legal) return legal;
  if (trade) return trade;
  return "der Verkäufer dieses Shops";
}

function sellerAddress(order: MailOrder): string[] {
  const s = order.seller;
  if (!s) return [];
  return [
    s.legal_name ?? "",
    s.name ?? "",
    s.street ?? "",
    [s.postal_code, s.city].filter(Boolean).join(" "),
    s.email ? `E-Mail: ${s.email}` : "",
    s.vat_id ? `USt-IdNr. ${s.vat_id}` : "",
  ].filter((line) => line.trim() !== "");
}

/**
 * The block every customer mail ends with: who sold, under which terms, and
 * where the withdrawal function is.
 *
 * Not a signature and not decoration — it is the part that makes the message
 * a durable record rather than a notification.
 */
function sellerFooter(order: MailOrder, site: MailSite): { html: string; text: string } {
  const address = sellerAddress(order);
  const agb = order.legal?.agb_version;
  const widerruf = order.legal?.widerruf_version;

  const versions = [
    agb ? `AGB in der Fassung ${agb}` : null,
    widerruf ? `Widerrufsbelehrung in der Fassung ${widerruf}` : null,
  ].filter((v): v is string => v !== null);

  const html =
    `<div style="margin:24px 0 0;border-top:1px solid #ddd4c1;padding-top:16px;` +
    `font-size:12px;color:#6b6153;line-height:1.6">` +
    `<strong style="color:#241f19">Verkäufer und Vertragspartner</strong><br>` +
    address.map((line) => escapeHtml(line)).join("<br>") +
    (versions.length > 0
      ? `<br><br>Für diese Bestellung gelten: ${escapeHtml(versions.join(" · "))}.`
      : "") +
    `<br><br>` +
    `<a href="${site.origin}/agb" style="color:#8a5a12">AGB</a> · ` +
    `<a href="${site.origin}/widerruf" style="color:#8a5a12">Widerrufsbelehrung</a> · ` +
    `<a href="${site.origin}/widerrufen" style="color:#8a5a12">Vertrag widerrufen</a> · ` +
    `<a href="${site.origin}/datenschutz" style="color:#8a5a12">Datenschutz</a> · ` +
    `<a href="${site.origin}/impressum" style="color:#8a5a12">Impressum</a>` +
    `</div>`;

  const text =
    `\n\n----------------------------------------\n` +
    `Verkäufer und Vertragspartner\n` +
    address.map((line) => `  ${line}`).join("\n") +
    (versions.length > 0 ? `\n\nFür diese Bestellung gelten: ${versions.join(" · ")}.` : "") +
    `\n\nAGB:                 ${site.origin}/agb\n` +
    `Widerrufsbelehrung:  ${site.origin}/widerruf\n` +
    `Vertrag widerrufen:  ${site.origin}/widerrufen\n` +
    `Datenschutz:         ${site.origin}/datenschutz\n` +
    `Impressum:           ${site.origin}/impressum\n`;

  return { html, text };
}

/**
 * The short withdrawal notice that rides on the acceptance.
 *
 * Not the full statutory Belehrung — that is linked and lives on one page, so
 * there is one authoritative copy. This is what a person needs to act: the
 * period, when it starts, and the two ways to declare.
 */
const withdrawalSummary = (site: MailSite): readonly string[] => [
  "Du kannst diesen Vertrag binnen vierzehn Tagen ohne Angabe von Gründen widerrufen. Die " +
    "Frist beginnt an dem Tag, an dem du die letzte Ware in Besitz genommen hast.",
  `Am einfachsten online über ${site.origin}/widerrufen — du bekommst dann sofort eine ` +
    "Eingangsbestätigung mit Datum und Uhrzeit. Eine E-Mail oder ein Brief genügen genauso.",
];

/* ------------------------------------------- 1. the order has reached us
 *
 * § 312i Abs. 1 Nr. 3 BGB: the receipt of the order must be confirmed
 * electronically without undue delay. Before 0047 no such message existed at
 * all — a customer whose payment hung heard nothing.
 *
 * IT IS NOT AN ACCEPTANCE, and it says so in as many words. Under the contract
 * model (docs/LEGAL.md) the acceptance is the order confirmation that follows
 * the payment; a message that let itself be read as the contract would make
 * the seller bound to an order they may not be able to fill.
 */
export function orderReceived(order: MailOrder, site: MailSite): RenderedMail {
  const subject = `Bestellung ${order.order_number} — bei uns eingegangen`;
  const footer = sellerFooter(order, site);

  const body =
    H1("Deine Bestellung ist bei uns eingegangen.") +
    P(
      `Wir haben deine Bestellung ${order.order_number} erhalten. Sobald deine Zahlung ` +
        "bestätigt ist, schicken wir dir die Bestellbestätigung — erst damit kommt der " +
        "Kaufvertrag zustande.",
    ) +
    P(
      "Diese E-Mail bestätigt nur den Eingang deiner Bestellung. Sie ist noch keine Annahme " +
        "und noch keine Rechnung.",
    ) +
    lineTable(order) +
    addressBlock(order).html;

  const text =
    "Deine Bestellung ist bei uns eingegangen.\n\n" +
    `Wir haben deine Bestellung ${order.order_number} erhalten. Sobald deine Zahlung ` +
    "bestätigt ist, schicken wir dir die Bestellbestätigung - erst damit kommt der " +
    "Kaufvertrag zustande.\n\n" +
    "Diese E-Mail bestätigt nur den Eingang deiner Bestellung. Sie ist noch keine Annahme " +
    "und noch keine Rechnung.\n\n" +
    lineText(order) +
    addressBlock(order).text +
    footer.text;

  return { subject, html: WRAP(subject, body + footer.html), text };
}

/* ------------------------------------------- 2. the contract exists
 *
 * The seller's acceptance, and the § 312f Abs. 2 confirmation on a durable
 * medium in one message — which is why the seller, the terms that applied and
 * the withdrawal notice are all in the body rather than behind links.
 */
export function orderConfirmation(order: MailOrder, site: MailSite): RenderedMail {
  const subject = `Bestellung ${order.order_number} — bestätigt`;
  const footer = sellerFooter(order, site);
  const invoice = order.invoice_number;

  const body =
    H1("Deine Bestellung ist bestätigt.") +
    P(
      `Wir haben deine Zahlung erhalten und nehmen deine Bestellung ${order.order_number} ` +
        `hiermit an. Damit ist der Kaufvertrag zwischen dir und ${sellerLine(order)} ` +
        "zustande gekommen.",
    ) +
    P("Du hörst wieder von uns, sobald die Sendung unterwegs ist.") +
    lineTable(order) +
    addressBlock(order).html +
    (invoice
      ? P(`Deine Rechnung ${invoice} findest du unter ${site.origin}/rechnung/${order.order_number}.`)
      : "") +
    `<div style="margin:20px 0 0;padding:14px 16px;background:#f6f3ec;border-radius:8px">` +
    `<strong style="font-size:14px">Widerrufsrecht</strong>` +
    withdrawalSummary(site).map((line) => P(line)).join("") +
    `</div>`;

  const text =
    "Deine Bestellung ist bestätigt.\n\n" +
    `Wir haben deine Zahlung erhalten und nehmen deine Bestellung ${order.order_number} ` +
    `hiermit an. Damit ist der Kaufvertrag zwischen dir und ${sellerLine(order)} zustande ` +
    "gekommen.\n\n" +
    "Du hörst wieder von uns, sobald die Sendung unterwegs ist.\n\n" +
    lineText(order) +
    addressBlock(order).text +
    (invoice ? `\n\nRechnung ${invoice}: ${site.origin}/rechnung/${order.order_number}` : "") +
    "\n\nWiderrufsrecht\n" +
    withdrawalSummary(site).map((line) => `  ${line}`).join("\n") +
    footer.text;

  return { subject, html: WRAP(subject, body + footer.html), text };
}

/* ------------------------------------------- 3. money on its way back */

export function refundConfirmation(order: MailOrder, site: MailSite): RenderedMail {
  const subject = `Bestellung ${order.order_number} — Erstattung`;
  const footer = sellerFooter(order, site);
  const amount = order.refunded_total ?? "0";

  const body =
    H1("Wir haben deine Erstattung angewiesen.") +
    P(
      `Für deine Bestellung ${order.order_number} haben wir insgesamt ${money(amount)} ` +
        "erstattet. Die Rückzahlung erfolgt über dasselbe Zahlungsmittel, das du bei der " +
        "Bestellung verwendet hast.",
    ) +
    P(
      "Wie lange es dauert, bis der Betrag bei dir ankommt, hängt von deiner Bank oder " +
        "deinem Zahlungsdienst ab. Darauf haben wir keinen Einfluss.",
    );

  const text =
    "Wir haben deine Erstattung angewiesen.\n\n" +
    `Für deine Bestellung ${order.order_number} haben wir insgesamt ${money(amount)} ` +
    "erstattet. Die Rückzahlung erfolgt über dasselbe Zahlungsmittel, das du bei der " +
    "Bestellung verwendet hast.\n\n" +
    "Wie lange es dauert, bis der Betrag bei dir ankommt, hängt von deiner Bank oder deinem " +
    "Zahlungsdienst ab.\n" +
    footer.text;

  return { subject, html: WRAP(subject, body + footer.html), text };
}

/* ------------------------------------------- 4. the § 356a receipt
 *
 * § 356a Abs. 4 BGB: on activation of the confirmation function the trader must
 * without undue delay transmit, **on a durable medium**, a receipt confirmation
 * containing the CONTENT of the withdrawal declaration and the DATE AND TIME of
 * its receipt.
 *
 * All three are in this message, and all three come from the stored row — so
 * the confirmation and the record cannot disagree about what was declared or
 * when it arrived.
 */
export type WithdrawalReceipt = {
  withdrawal_id: number;
  order_number: string;
  consumer_name: string;
  contact_email: string;
  declaration: string;
  received_at: string;
};

export function withdrawalReceipt(receipt: WithdrawalReceipt): RenderedMail {
  const subject = `Widerruf zu Bestellung ${receipt.order_number} — Eingang bestätigt`;
  const received = berlinDateTime(receipt.received_at);

  const body =
    H1("Wir haben deinen Widerruf erhalten.") +
    P(
      `Hiermit bestätigen wir den Eingang deiner Widerrufserklärung zur Bestellung ` +
        `${receipt.order_number}.`,
    ) +
    `<div style="margin:16px 0;padding:14px 16px;background:#f6f3ec;border-radius:8px">` +
    `<div style="font-size:12px;color:#6b6153;margin-bottom:6px">Eingegangen am</div>` +
    `<div style="font-weight:600">${escapeHtml(received)}</div>` +
    `<div style="font-size:12px;color:#6b6153;margin:14px 0 6px">Inhalt deiner Erklärung</div>` +
    `<div style="white-space:pre-line">${escapeHtml(receipt.declaration)}</div>` +
    `<div style="font-size:12px;color:#6b6153;margin:14px 0 6px">Erklärt von</div>` +
    `<div>${escapeHtml(receipt.consumer_name)}</div>` +
    `</div>` +
    P(
      "Wir melden uns bei dir und stimmen die Rücksendung ab. Die Ware sendest du innerhalb " +
        "von 14 Tagen zurück; die unmittelbaren Kosten der Rücksendung trägst du.",
    ) +
    P(
      "Deine Zahlungen einschließlich der Lieferkosten erstatten wir unverzüglich, spätestens " +
        "binnen 14 Tagen ab Eingang dieser Erklärung. Wir dürfen damit warten, bis die Ware " +
        "zurück ist oder du die Absendung nachgewiesen hast.",
    );

  const text =
    "Wir haben deinen Widerruf erhalten.\n\n" +
    `Hiermit bestätigen wir den Eingang deiner Widerrufserklärung zur Bestellung ` +
    `${receipt.order_number}.\n\n` +
    `Eingegangen am: ${received}\n\n` +
    `Inhalt deiner Erklärung:\n${receipt.declaration}\n\n` +
    `Erklärt von: ${receipt.consumer_name}\n\n` +
    "Wir melden uns bei dir und stimmen die Rücksendung ab. Die Ware sendest du innerhalb von " +
    "14 Tagen zurück; die unmittelbaren Kosten der Rücksendung trägst du.\n\n" +
    "Deine Zahlungen einschließlich der Lieferkosten erstatten wir unverzüglich, spätestens " +
    "binnen 14 Tagen ab Eingang dieser Erklärung.\n";

  return { subject, html: WRAP(subject, body), text };
}

/** Date and time as § 356a Abs. 4 requires them, in the product's zone. */
export function berlinDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  }).format(date) + " Uhr";
}

/* ------------------------------------------------------------------ dispatch */


export const MAIL_KINDS = [
  "order_received",
  "order_confirmation",
  "shipping_confirmation",
  "refund_confirmation",
  "resolution_alert",
  /*
   * Historical. `order_confirmation` replaced it in 0047 when the contract
   * model was settled: the mail after payment is the seller's ACCEPTANCE, and
   * naming it after the payment described the trigger rather than the act.
   * Rows sent under the old name stay valid; nothing new uses it.
   */
  "payment_confirmation",
] as const;

export type MailKind = (typeof MAIL_KINDS)[number];

export function isMailKind(value: unknown): value is MailKind {
  return typeof value === "string" && (MAIL_KINDS as readonly string[]).includes(value);
}

export function render(kind: MailKind, order: MailOrder, site: MailSite): RenderedMail {
  switch (kind) {
    case "order_received":
      return orderReceived(order, site);
    case "order_confirmation":
    case "payment_confirmation":
      return orderConfirmation(order, site);
    case "shipping_confirmation":
      return shippingConfirmation(order);
    case "refund_confirmation":
      return refundConfirmation(order, site);
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
