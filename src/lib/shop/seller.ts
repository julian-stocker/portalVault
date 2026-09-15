/**
 * Who is selling on SkyIsles.
 *
 * SkyIsles is the platform; yulez.collectibles is the first and for now only
 * commercial seller on it (ADR-0064). A customer contracts with the seller,
 * and a shop surface that names a price without naming the seller is missing
 * the more important of the two.
 *
 * ONE CALL PER REQUEST, NOT ONE PER OFFER. `seller_public()` (migration 0027)
 * returns the active seller's id and trade name and nothing else, and
 * `cache()` memoises it for the render — the same shape `fetchOffers()` has.
 * Nothing is fetched when the quick view opens: the name travels in the page
 * payload that drew the grid.
 *
 * AN IDENTITY, NOT A RELATION. This says who sells on SkyIsles, not who sells
 * a particular article. No table carries a `seller_id`, and `sellers_one_active`
 * guarantees there is exactly one seller to be. The `id` here is the key a
 * real offer→seller relation would hang off one day; today it is a constant,
 * and reading it as evidence of multi-seller support would be wrong
 * (ADR-0021 stands).
 */
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

/** The seller, as a visitor may see them. Two fields, and there is no third. */
export type PublicSeller = {
  id: number;
  displayName: string;
};

/** PostgREST's code for "no function by that name". See below. */
const FUNCTION_MISSING = "PGRST202";

/**
 * The active seller, or `null`.
 *
 * `null` is an ordinary answer, not an error: it is what an environment
 * without migration 0027 returns, and what a database with no active seller
 * row returns. Every caller renders nothing rather than a placeholder — a
 * made-up trade name would be a false statement about who a customer is
 * contracting with, which is worse than saying nothing.
 */
export const fetchSellerPublic = cache(async (): Promise<PublicSeller | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_public");

  if (error) {
    // The same narrow swallow `fetchOffers()` makes: before the migration is
    // applied, "there is no published seller" is exactly true, and a catalog
    // that refused to render because of it would be a worse answer. Every
    // other failure is raised.
    if (error.code === FUNCTION_MISSING) return null;
    throw new Error(`seller: ${error.message}`);
  }

  const row = (data as { id: number; display_name: string | null }[] | null)?.[0];
  // A seller row with no trade name yet is not a seller anybody can be told
  // about. Same rule as a price that will not parse (ADR-0010).
  if (!row || typeof row.display_name !== "string" || row.display_name.trim() === "") return null;

  return { id: row.id, displayName: row.display_name };
});
