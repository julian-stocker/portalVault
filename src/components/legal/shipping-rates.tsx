/**
 * What shipping actually costs today (ADR-0086).
 *
 * Read from `shipping_quote()` — the same function the checkout and
 * `create_order()` use, so the page cannot quote a price the order would not
 * charge. That is the whole reason this is a component and not a paragraph:
 * a number typed into prose is a second copy of a rule, and the copy is the
 * one that goes stale.
 *
 * Two quotes are taken, one below the free-shipping threshold and one above
 * it, because the threshold is what a customer actually wants to know and it
 * cannot be shown without asking for both.
 */
import { fetchShippingOptions } from "@/lib/commerce/shipping-queries";
import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";

export async function ShippingRates() {
  const rates = await fetchShippingOptions();

  if (rates === null) {
    // Nothing configured, or the database is not reachable. Saying nothing is
    // right; inventing a price would not be.
    return null;
  }

  const copy = de.legal.shipping;

  return (
    <section
      aria-labelledby="versandkosten"
      className="mx-auto w-full max-w-2xl px-4 pb-16"
    >
      <h2 id="versandkosten" className="text-lg font-semibold tracking-tight">
        {copy.ratesHeading}
      </h2>
      <p className="mt-3 text-sm text-muted">{copy.ratesHint}</p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{copy.ratesHeading}</caption>
          <thead>
            <tr className="border-b border-border/70 text-left text-xs text-muted">
              <th scope="col" className="py-2 pr-4 font-medium">
                {copy.method}
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                {copy.priceBelow}
              </th>
              <th scope="col" className="py-2 font-medium">
                {copy.priceAbove}
              </th>
            </tr>
          </thead>
          <tbody>
            {rates.methods.map((method) => (
              <tr key={method.code} className="border-b border-border/40 last:border-0">
                <th scope="row" className="py-2 pr-4 text-left font-normal">
                  {method.name}
                </th>
                <td className="py-2 pr-4 tabular-nums">{formatPrice(method.below)}</td>
                <td className="py-2 tabular-nums">
                  {method.above === 0 ? copy.free : formatPrice(method.above)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-sm">{copy.threshold(formatPrice(rates.threshold))}</p>
    </section>
  );
}
