/**
 * From a carrier and a reference to a link, in one place.
 *
 * One function rather than a URL built at each of the two places that shows a
 * parcel: the admin order page and the customer's own order page. Two copies
 * would be two things to keep in step, and the day a carrier changes its
 * tracking path one of them would quietly keep pointing at the old one.
 *
 * THE CARRIER IS THE CODE, NOT THE NAME
 *
 * `shipping_method_name` is what the customer was shown and may be renamed —
 * "DHL" could become "DHL Paket" tomorrow without anything breaking.
 * `shipping_method_code` is what `shipping_catalog()` keys on. A URL built
 * from the display name would break on the first rename, silently.
 *
 * NOTHING IS INVENTED
 *
 * An unknown carrier gets **no link**. A wrong tracking link is worse than
 * none: it sends somebody to a page that tells them their parcel does not
 * exist. The number is still shown either way — it is what they can paste
 * into a carrier's own search.
 */

/** The carriers `shipping_catalog()` offers, and the only ones with a link. */
const TRACKING_URLS: Record<string, (reference: string) => string> = {
  /*
   * Hermes Germany's consumer tracking page. The reference travels in the
   * fragment, which is how that page reads it.
   */
  hermes: (reference) =>
    `https://www.myhermes.de/empfangen/sendungsverfolgung/sendungsinformation/#${reference}`,

  /* DHL's consumer parcel tracking, with the reference as `piececode`. */
  dhl: (reference) =>
    `https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=${reference}`,
};

export const TRACKED_CARRIERS = Object.keys(TRACKING_URLS);

/**
 * What a tracking reference may look like before it is put in a URL.
 *
 * Carriers issue alphanumerics, sometimes with a dash. This is not a format
 * check on the number — the database stores it raw and makes no claim about
 * its shape (0018) — it is the rule for whether it is safe to build a link
 * out of. Anything else is shown as text and gets no link.
 *
 * Encoding alone would be enough to be safe; refusing as well means a
 * mistyped value never becomes a link that goes somewhere unexpected.
 */
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9-]{2,63}$/;

/**
 * The tracking URL for this parcel, or null.
 *
 * Null for: no number, no carrier, a carrier without a known tracking page,
 * or a reference that does not look like one. Every caller must render the
 * number as plain text in that case.
 */
export function trackingUrl(
  shippingMethodCode: string | null | undefined,
  trackingNumber: string | null | undefined,
): string | null {
  if (typeof trackingNumber !== "string" || typeof shippingMethodCode !== "string") return null;

  const reference = trackingNumber.trim();
  if (!SAFE_REFERENCE.test(reference)) return null;

  const build = TRACKING_URLS[shippingMethodCode.trim().toLowerCase()];
  if (build === undefined) return null;

  // Encoded as well as validated. The pattern above already excludes
  // everything that would need escaping; this is the belt that does not
  // depend on that pattern staying as strict as it is today.
  return build(encodeURIComponent(reference));
}

/** True when this parcel can be followed. Reads better than a null check. */
export function hasTrackingLink(
  shippingMethodCode: string | null | undefined,
  trackingNumber: string | null | undefined,
): boolean {
  return trackingUrl(shippingMethodCode, trackingNumber) !== null;
}
