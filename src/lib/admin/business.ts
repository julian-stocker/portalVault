/**
 * The operator's own facts.
 *
 * `business_settings` is deliberately not part of `shop_settings` (ADR-0059):
 * one says what SkyIsles charges, the other says who SkyIsles is. Transactional
 * mail reads it today; the legal pages and the invoice block will read the same
 * row rather than each keeping their own copy of a fact that must agree.
 *
 * THREE SENSITIVITIES, ONE RULE
 *
 * The table holds public facts (the contact address), internal ones (the
 * Reply-To override) and — once the legal block lands — facts that must never
 * be published at all. A visitor's only route in is
 * `business_settings_public()`, which names its columns literally, so a column
 * added later is invisible until somebody lists it on purpose.
 *
 * NOTHING HERE AUTHORISES ANYBODY. `is_shop_admin()` decides who may act, over
 * `shop_admins.user_id`. An address in this table is data the operator
 * publishes, never a credential.
 */
import { cache } from "react";

import { isAdmin } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";

export type BusinessSettings = {
  /** PUBLIC. The published contact address, and the default Reply-To. */
  contactEmail: string | null;
  /** INTERNAL. Overrides the Reply-To when it should differ. */
  replyTo: string | null;
  updatedAt: string | null;
};

export const NO_BUSINESS_SETTINGS: BusinessSettings = {
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
export const fetchBusinessSettings = cache(async (): Promise<BusinessSettings> => {
  if (!(await isAdmin())) return NO_BUSINESS_SETTINGS;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_business_settings");
  if (error) return NO_BUSINESS_SETTINGS;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return NO_BUSINESS_SETTINGS;

  return {
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
