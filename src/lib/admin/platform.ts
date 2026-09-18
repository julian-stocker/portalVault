/**
 * The platform's own facts.
 *
 * SkyIsles operates the catalogue, the accounts, the collection and the
 * checkout. It does not sell the goods — that is the seller
 * (`src/lib/admin/seller.ts`, ADR-0064).
 *
 * Which address belongs here is decided by the duty, not by who happens to
 * hold it: a privacy request, an account problem or a complaint about SkyIsles
 * goes to the platform; a question about an ORDER goes to the seller. Today
 * both may be the same address, because one person is both. They are separate
 * fields because they are separate duties, and the day they diverge no code
 * has to change.
 *
 * The only route out for a visitor is `platform_settings_public()`, which
 * names its columns literally and is granted to nobody yet — there is still no
 * public page that renders a company fact (ADR-0059).
 */
import { cache } from "react";

import { isPlatformAdmin } from "@/lib/auth/capabilities";
import { createClient } from "@/lib/supabase/server";

export type PlatformSettings = {
  /** PUBLIC. The platform's published contact address. */
  contactEmail: string | null;
  /**
   * PUBLIC. Where somebody writes about SkyIsles itself — account, data
   * protection, the site. A question about an order goes to the seller
   * (ADR-0077). NULL until an address exists; none is invented.
   */
  supportEmail: string | null;
  updatedAt: string | null;
};

export const NO_PLATFORM_SETTINGS: PlatformSettings = {
  contactEmail: null,
  supportEmail: null,
  updatedAt: null,
};

/** What the administrator sees. Memoised per request, like `fetchSeller()`. */
export const fetchPlatformSettings = cache(async (): Promise<PlatformSettings> => {
  if (!(await isPlatformAdmin())) return NO_PLATFORM_SETTINGS;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_platform_settings");
  if (error) return NO_PLATFORM_SETTINGS;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return NO_PLATFORM_SETTINGS;

  return {
    contactEmail: row.contact_email ?? null,
    supportEmail: row.support_email ?? null,
    updatedAt: row.updated_at ?? null,
  };
});
