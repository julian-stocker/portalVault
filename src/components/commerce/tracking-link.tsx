/**
 * A parcel reference, linked when it can be and plain when it cannot.
 *
 * Used on both order pages — the operator's and the customer's — so the two
 * cannot disagree about what is clickable. The URL comes from
 * `trackingUrl()`; this component builds none of its own.
 *
 * `rel="noreferrer"`: a carrier's tracking page has no business knowing which
 * order page somebody came from. `noopener` comes with it in every browser
 * that matters and costs nothing to state.
 */
import { trackingUrl } from "@/lib/commerce/tracking";

export function TrackingLink({
  shippingMethodCode,
  trackingNumber,
  className,
}: {
  shippingMethodCode: string | null | undefined;
  trackingNumber: string | null | undefined;
  className?: string;
}) {
  const number = typeof trackingNumber === "string" ? trackingNumber.trim() : "";
  if (number === "") return null;

  const url = trackingUrl(shippingMethodCode, number);

  // React escapes the text either way. The reason there is no link is that
  // the carrier is unknown or the reference does not look like one — and a
  // link that goes somewhere unexpected is worse than no link at all.
  if (url === null) {
    return <span className={className ?? "tabular-nums"}>{number}</span>;
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={`${className ?? "tabular-nums"} underline underline-offset-4`}
    >
      {number}
    </a>
  );
}
