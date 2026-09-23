/**
 * Reading the temporary catalog market-value boost (0094).
 *
 * SEPARATE FROM `market-boost.ts` BECAUSE OF WHO IMPORTS WHAT. The arithmetic
 * next door is printed by `FigureCard`, which is compiled into the client
 * bundle; a `next/headers` import anywhere in that graph fails the build. So
 * the pure function stays there and the round trip stays here, where only
 * server components reach it.
 */
import { cache } from "react";

import { NO_MARKET_BOOST } from "@/lib/catalog/market-boost";
import { createClient } from "@/lib/supabase/server";

/**
 * The one read of the setting, per request.
 *
 * `catalog_market_boost()` returns a single number and nothing else — it
 * opens no access to `platform_settings`. Memoised with React's `cache`, so a
 * page that renders two catalog surfaces still asks once, and a card never
 * asks at all because the value is handed down as a prop. No query per card,
 * nothing duplicated into a figure row.
 *
 * FAIL CLOSED ON 0. An error, a missing row, or a database without 0094 all
 * mean "no boost", which shows the stored price — the honest answer.
 * Guessing five per cent would print a number nobody configured.
 */
export const fetchCatalogMarketBoost = cache(async (): Promise<number> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("catalog_market_boost");
  if (error || data === null || data === undefined) return NO_MARKET_BOOST;

  const percent = Number(data);
  if (!Number.isFinite(percent) || percent <= 0) return NO_MARKET_BOOST;
  return percent;
});
