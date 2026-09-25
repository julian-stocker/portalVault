/**
 * What shipping costs, for a page that is not a checkout (ADR-0086).
 *
 * `shipping_quote()` is the authoritative rule and the only place it exists
 * (migration 0011): the checkout displays what it returns and `create_order()`
 * charges what it returns. The shipping information page asks the same
 * function, so the three can never disagree.
 *
 * TWO QUOTES, NOT ONE. The interesting fact for a customer is the threshold —
 * "free from X" — and a single quote cannot show it. One below and one above
 * makes both columns real numbers rather than a sentence about a rule.
 */
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

export type ShippingRate = {
  code: string;
  name: string;
  /** What a basket under the threshold pays. */
  below: number;
  /** What a basket over it pays — zero where free shipping applies. */
  above: number;
};

export type ShippingRates = {
  methods: ShippingRate[];
  /** The goods value from which shipping is free. */
  threshold: number;
};

/** A goods value certain to sit under any sane threshold. */
const UNDER = 1;

/**
 * The goods value from which shipping is free — the one place it is read.
 *
 * `shipping_free_from()` is what `/versand` already quotes and what the
 * seller's own setting feeds; it is granted to `anon`, so a signed-out
 * visitor on a figure page gets the same number as the shipping page. Every
 * customer-facing surface that names the threshold calls THIS, and nothing
 * writes the figure into copy — a hard-coded "ab 75 €" goes quietly wrong the
 * day the seller changes the setting, and it did (`de.shop.page.intro`).
 *
 * `null` is a real answer and means "say it without the number". Never a
 * fallback amount: a wrong threshold beside a price is a wrong statement
 * about the total.
 */
export const fetchFreeShippingFrom = cache(async (): Promise<number | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("shipping_free_from");
  if (error) return null;
  const value = typeof data === "string" ? Number(data) : typeof data === "number" ? data : null;
  return value !== null && Number.isFinite(value) ? value : null;
});

export const fetchShippingOptions = cache(async (): Promise<ShippingRates | null> => {
  const supabase = await createClient();

  // The threshold decides what "over" means, so it is read before the second
  // quote rather than guessed at with a large number. Same helper as every
  // other surface, so the two can never disagree.
  const [low, threshold] = await Promise.all([
    supabase.rpc("shipping_quote", { p_items_subtotal: UNDER }),
    fetchFreeShippingFrom(),
  ]);

  if (low.error || !Array.isArray(low.data) || low.data.length === 0) return null;
  if (threshold === null) return null;

  const over = await supabase.rpc("shipping_quote", { p_items_subtotal: threshold });
  if (over.error || !Array.isArray(over.data)) return null;

  const aboveByCode = new Map(
    (over.data as { code: string; amount: string | number }[]).map((row) => [
      row.code,
      Number(row.amount),
    ]),
  );

  const methods = (low.data as { code: string; name: string; amount: string | number }[]).map(
    (row) => ({
      code: row.code,
      name: row.name,
      below: Number(row.amount),
      above: aboveByCode.get(row.code) ?? Number(row.amount),
    }),
  );

  return { methods, threshold };
});
