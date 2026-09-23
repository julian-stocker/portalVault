/**
 * THE TEMPORARY CATALOG MARKET-VALUE BOOST — A DISPLAY VALUE AND NOTHING ELSE.
 *
 * `skylanders.market_price` is the canonical market price and stays exactly
 * what it is: the shop price is computed from it in the database
 * (`shop_price()`), the buy-in factor is taken against it, every
 * `market_price_snapshot` is frozen from it, and the collection is valued
 * with it. None of that is touched here, and none of it may ever read this
 * module.
 *
 * What this module does is one thing: the stored price is currently a
 * competitor's shop price and sits roughly five per cent under what the
 * operator believes the real market value is, so the PUBLIC CATALOG shows a
 * boosted figure until a better price can actually be computed. The boosted
 * number is produced at the last possible moment, in the component that
 * prints it, and it is never written anywhere, never fed back into a
 * calculation, and never stored.
 *
 * WHY IT IS A PROP AND NOT A CONTEXT OR A GLOBAL
 *
 * `FigureCard` is rendered by four surfaces — the catalog, the shop page, the
 * figure page's siblings and the collection — and only the first three are
 * catalog surfaces. A context or a module-level read would silently boost the
 * collection too, where the card would then disagree with the collection
 * total right beside it. `marketBoostPercent` defaults to 0, so a surface
 * that says nothing gets the stored value, and the three lines that pass it
 * are the whole list of places where the boost applies.
 *
 * TEMPORARY, AND BUILT TO BE REMOVED. Delete this file, the column it reads
 * and the three props, and the catalog is back to the stored price. Nothing
 * was migrated, no value was overwritten, and no pricing model changed.
 */
/**
 * The stored price as the public catalog should print it.
 *
 * EXACT, NOT FLOATING POINT — the same technique, and the same reason, as
 * `automaticShopPrice()` in `lib/shop/offer.ts`. `16.65 × 90 %` is 14.985 and
 * must round to 14.99, but `Math.round(16.65 * 90) / 100` gives 14.98,
 * because 16.65 × 90 is 1498.4999999999998 in binary. That was a real defect
 * once; it is not repeated here.
 *
 * So the arithmetic runs on integers: cents × ten-thousandths, divided by
 * 10 000, rounded half away from zero — which is what `round(numeric, 2)`
 * does in Postgres. `market_price` is `numeric(10,2)` and the boost is
 * `numeric(5,2)`, so scaling both by 100 recovers the exact integers they
 * represent.
 *
 * NULL STAYS NULL (ADR-0010). "No known market price" is not a price, and a
 * boost on nothing is still nothing — never 0, never an invented figure.
 *
 * Anything that is not a usable pair comes back as the STORED value rather
 * than as null or as a guess: a boost of 0 is "switched off", and a boost
 * that is negative, NaN or missing is a fault in the setting, not a reason to
 * stop showing the price the database holds.
 */
export function catalogDisplayMarketPrice(
  storedMarketPrice: number | null,
  boostPercent: number,
): number | null {
  if (storedMarketPrice === null) return null;
  // A CHECK constraint keeps `market_price > 0`, so this is defence rather
  // than a case — and defence that shows the stored value instead of one this
  // function made up.
  if (!Number.isFinite(storedMarketPrice) || storedMarketPrice <= 0) return storedMarketPrice;
  if (!Number.isFinite(boostPercent) || boostPercent <= 0) return storedMarketPrice;

  const cents = Math.round(storedMarketPrice * 100);
  // 5 % → 10500, 7.5 % → 10750. One factor, so there is one rounding step.
  const factor = 10000 + Math.round(boostPercent * 100);
  // Both operands are positive, so "half away from zero" is "+ half, floor".
  return Math.floor((cents * factor + 5000) / 10000) / 100;
}

/**
 * No boost. What every surface gets that does not ask for one.
 *
 * NOTHING SERVER-SIDE IS IMPORTED HERE, on purpose: `FigureCard` is compiled
 * into the client bundle, and a `next/headers` import anywhere in its graph
 * breaks the build. The reader lives in `market-boost-server.ts` beside it.
 */
export const NO_MARKET_BOOST = 0;
