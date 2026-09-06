/**
 * What SkyIsles asks for a figure, on a catalog card.
 *
 * One line under the market value, and only when there is something to say.
 * Most of the 561 figures are not offered, and a "nicht im Angebot" line on
 * all of them would be 561 lines of noise (ADR-0043).
 *
 * The two prices are never allowed to blur into one another (ADR-0033), so
 * this line names its source: "SkyIsles 9,90 €" beside a market value of
 * 14,00 € reads as two facts, where a bare second price would read as a
 * correction of the first. Gold, because it is the only thing on the card
 * that is an offer rather than a description.
 *
 * "ab 9,90 €" appears only when the buyable offers really are at different
 * prices — loose and boxed at the same price is one price (`summarizeOffers`).
 */
import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";
import { summarizeOffers, type Offer } from "@/lib/shop/offer";

export function OfferLine({ offers }: { offers: readonly Offer[] }) {
  const summary = summarizeOffers(offers);
  if (summary.kind === "none") return null;

  if (summary.kind === "soldOut") {
    // Carried, but not in stock. Worth saying: it means the shop has the
    // article at all, which silence does not.
    return <span className="text-[11px] leading-tight text-on-card-muted">{de.shop.soldOut}</span>;
  }

  const price = formatPrice(summary.price);

  return (
    <span className="text-[13px] leading-tight font-semibold text-shop-on-card tabular-nums">
      {summary.kind === "from" ? de.shop.offerFrom(price) : de.shop.offerPrice(price)}
    </span>
  );
}
