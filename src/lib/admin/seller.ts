/**
 * The seller's own facts.
 *
 * SkyIsles is the platform; **yulez.collectibles** is the first and for now
 * only commercial seller on it (ADR-0064). This module reads the seller —
 * `src/lib/admin/platform.ts` reads the platform. They were one module and one
 * table until 0026, which is exactly the ambiguity this split removes: an
 * address on an order mail is the seller's, an address on a privacy request is
 * the platform's, and one person owning both today does not merge the duties.
 *
 * THREE SENSITIVITIES, ONE RULE
 *
 * `sellers` holds public facts (trade name, contact address), internal ones
 * (the Reply-To override) and — once the legal block lands — facts that must
 * never be published at all. Every route in names its columns literally, so a
 * column added later is invisible until somebody lists it on purpose
 * (ADR-0059).
 *
 * NOTHING HERE AUTHORISES ANYBODY, AND A SELLER IS NOT A ROLE. `is_shop_admin()`
 * decides who may act, over `shop_admins.user_id`. No account is linked to a
 * seller, no table carries a `seller_id`, and there is at most one active
 * seller — enforced by `sellers_one_active` in the database, not by convention.
 */
import { cache } from "react";

import { isAdmin } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";

export type Seller = {
  /** PUBLIC. The trade name customers know. */
  displayName: string | null;
  /** PUBLIC. The address a customer writes to about an order. */
  contactEmail: string | null;
  /** INTERNAL. Overrides the Reply-To when it should differ. */
  replyTo: string | null;
  updatedAt: string | null;
};

export const NO_SELLER: Seller = {
  displayName: null,
  contactEmail: null,
  replyTo: null,
  updatedAt: null,
};

/**
 * What the administrator sees. Memoised per request, like every other reader.
 *
 * Asks `isAdmin()` first for the same reason `fetchOpenOrderCounts()` does: a
 * collector has nothing to read here, and generating an
 * `insufficient_privilege` on every page they load is noise, not security. The
 * database refuses either way.
 */
export const fetchSeller = cache(async (): Promise<Seller> => {
  if (!(await isAdmin())) return NO_SELLER;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_seller");
  if (error) return NO_SELLER;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return NO_SELLER;

  return {
    displayName: row.display_name ?? null,
    contactEmail: row.contact_email ?? null,
    replyTo: row.transactional_reply_to ?? null,
    updatedAt: row.updated_at ?? null,
  };
});

/**
 * The same loose test the database applies, for an answer before a round trip.
 *
 * A mirror of the CHECK constraint, not a second rule — address syntax is not
 * a useful gate and the database decides. This exists so the form can say
 * something in German instead of surfacing a constraint name.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function looksLikeEmail(value: string): boolean {
  return EMAIL.test(value.trim()) && value.trim().length <= 254;
}

/** Empty means "not configured", which is a real and supported state. */
export function normaliseContact(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}
