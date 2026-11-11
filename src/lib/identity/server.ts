/**
 * Loading the identity for the management page (ADR-0184, AP2).
 *
 * THE EXISTING SECURE READS, NOTHING NEW. The seller row comes from
 * `admin_shop_profile()` — `security definer`, asking
 * `can_operate_active_seller()` itself — and the platform's support address
 * from `admin_platform_settings()`, which only a platform administrator may
 * call. A seller operator who is not also a platform admin is not shown that
 * address, and the page says so instead of guessing it.
 *
 * Unlike `fetchShopProfile()`, a failed read is reported as such: a page that
 * checks for missing legal details must not mistake "could not read" for
 * "everything is empty".
 *
 * Used only by the internal management page until AP5.
 */
import { cache } from "react";

import { fetchPlatformSettings } from "@/lib/admin/platform";
import { readShopSettings, type ShopSettings } from "@/lib/admin/shop-profile-model";
import { capabilities } from "@/lib/auth/capabilities";
import { createClient } from "@/lib/supabase/server";
import { buildIdentity, type Identity } from "@/lib/identity/model";

export type IdentityLoad =
  | { ok: true; identity: Identity; settings: ShopSettings }
  | { ok: false; reason: "forbidden" | "unavailable" };

export const fetchIdentity = cache(async (): Promise<IdentityLoad> => {
  const { sellerOperator, platformAdmin } = await capabilities();
  if (!sellerOperator) return { ok: false, reason: "forbidden" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_shop_profile");
  if (error || data === null || typeof data !== "object") return { ok: false, reason: "unavailable" };

  const settings = readShopSettings(data);
  const platform = platformAdmin ? await fetchPlatformSettings() : null;
  return {
    ok: true,
    identity: buildIdentity(settings, platform ? { supportEmail: platform.supportEmail } : null),
    settings,
  };
});
