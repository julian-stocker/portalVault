/**
 * The invoice as an accessible page (ADR-0086).
 *
 * The same figures as the PDF, in a real table with real headers — so the
 * document is usable by someone whose screen reader would get nothing but
 * loose text runs out of an untagged PDF. The PDF is offered beside it, for
 * filing and printing.
 *
 * WHAT MUST NOT APPEAR HERE. No VAT line. § 19 UStG supplies are steuerfrei,
 * and a row reading "USt 0,00 €" would say the transaction was taxed at zero,
 * which is a different and untrue statement. The § 19 sentence stands where
 * § 34a UStDV Nr. 5 wants it: with the sum.
 */
import { SMALL_BUSINESS_NOTE, type InvoiceDocument } from "@/lib/legal/invoice";
import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";

const money = (value: string) => formatPrice(Number(value));

export function InvoiceView({
  invoice,
  token,
}: {
  invoice: InvoiceDocument;
  token: string | null;
}) {
  const copy = de.invoice;
  const { seller, customer } = invoice;
  const pdfHref = `/rechnung/${invoice.order_number}/pdf${token ? `?t=${encodeURIComponent(token)}` : ""}`;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pt-8 pb-16 md:pt-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{copy.title}</h1>
          <p className="mt-2 text-sm text-muted tabular-nums">{invoice.invoice_number}</p>
        </div>
        {/* A real download, not a print dialogue. */}
        <a
          href={pdfHref}
          className="rounded-sky-md bg-surface px-4 py-2 text-sm ring-1 ring-border/70 hover:ring-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
        >
          {copy.download}
        </a>
      </div>

      <dl className="mt-8 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
        <dt className="text-muted">{copy.issuedAt}</dt>
        <dd className="tabular-nums">{germanDate(invoice.issued_at)}</dd>
        <dt className="text-muted">{copy.orderNumber}</dt>
        <dd className="tabular-nums">{invoice.order_number}</dd>
        <dt className="text-muted">{copy.placedAt}</dt>
        <dd className="tabular-nums">{germanDate(invoice.placed_at)}</dd>
      </dl>

      <div className="mt-8 grid gap-8 sm:grid-cols-2">
        <section aria-labelledby="inv-seller">
          <h2 id="inv-seller" className="text-sm font-semibold">
            {copy.seller}
          </h2>
          <address className="mt-2 text-sm not-italic leading-relaxed">
            {seller.legal_name}
            {seller.trade_name ? (
              <>
                <br />
                {seller.trade_name}
              </>
            ) : null}
            <br />
            {seller.street}
            <br />
            {seller.postal_code} {seller.city}
            <br />
            {seller.country}
            <br />
            {seller.email}
            {seller.vat_id ? (
              <>
                <br />
                USt-IdNr. {seller.vat_id}
              </>
            ) : null}
          </address>
        </section>

        <section aria-labelledby="inv-customer">
          <h2 id="inv-customer" className="text-sm font-semibold">
            {copy.customer}
          </h2>
          <address className="mt-2 text-sm not-italic leading-relaxed">
            {customer.name}
            {customer.company ? (
              <>
                <br />
                {customer.company}
              </>
            ) : null}
            <br />
            {customer.street}
            <br />
            {customer.postal_code} {customer.city}
            <br />
            {customer.country}
          </address>
        </section>
      </div>

      <div className="mt-10 overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{copy.tableCaption}</caption>
          <thead>
            <tr className="border-b border-border/70 text-left text-xs text-muted">
              <th scope="col" className="py-2 pr-4 font-medium">
                {copy.description}
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                {copy.quantity}
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">
                {copy.unitPrice}
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                {copy.amount}
              </th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line, index) => (
              <tr key={`${line.sky_id}-${index}`} className="border-b border-border/40">
                <th scope="row" className="py-2.5 pr-4 text-left font-normal">
                  {line.name}
                  <span className="block text-xs text-muted">
                    {line.sky_id} · {line.condition === "sealed" ? copy.sealed : copy.loose}
                  </span>
                </th>
                <td className="py-2.5 pr-4 text-right tabular-nums">{line.quantity}</td>
                <td className="py-2.5 pr-4 text-right tabular-nums">{money(line.unit_price)}</td>
                <td className="py-2.5 text-right tabular-nums">{money(line.line_total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={3} className="py-2 pr-4 text-right font-normal text-muted">
                {copy.itemsSubtotal}
              </th>
              <td className="py-2 text-right tabular-nums">{money(invoice.items_subtotal)}</td>
            </tr>
            <tr>
              <th scope="row" colSpan={3} className="py-2 pr-4 text-right font-normal text-muted">
                {copy.shipping}
                {invoice.shipping_method ? ` (${invoice.shipping_method})` : ""}
              </th>
              <td className="py-2 text-right tabular-nums">{money(invoice.shipping_amount)}</td>
            </tr>
            {Number(invoice.discount_amount) > 0 ? (
              <tr>
                <th scope="row" colSpan={3} className="py-2 pr-4 text-right font-normal text-muted">
                  {copy.discount}
                </th>
                <td className="py-2 text-right tabular-nums">
                  −{money(invoice.discount_amount)}
                </td>
              </tr>
            ) : null}
            <tr className="border-t border-border/70">
              <th scope="row" colSpan={3} className="py-3 pr-4 text-right font-semibold">
                {copy.total}
              </th>
              <td className="py-3 text-right font-semibold tabular-nums">
                {money(invoice.total_amount)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* § 34a UStDV Nr. 5 — the note belongs with the sum. */}
      <p className="mt-6 text-sm">{SMALL_BUSINESS_NOTE}</p>
      <p className="mt-2 text-sm text-muted">{copy.paid}</p>
    </main>
  );
}

function germanDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "–";
  return new Intl.DateTimeFormat("de-AT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Berlin",
  }).format(date);
}
