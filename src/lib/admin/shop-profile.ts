/**
 * Reading the shop's profile as the administrator (ADR-0075).
 *
 * `admin_shop_profile()`, not `admin_shop_settings()` — that name belongs to
 * the pricing percentage since 0007 and is read by `inventory.ts`.
 *
 * The half that talks to the database; the shapes and the fallback rules live
 * in `shop-profile-model.ts`, which the panel imports. Same split as
 * `commerce.ts` / `commerce-model.ts`.
 */
import { cache } from "react";

import { canOperateSeller } from "@/lib/auth/capabilities";
import { createClient } from "@/lib/supabase/server";

import { NO_SHOP_SETTINGS, readShopSettings, type ShopSettings } from "./shop-profile-model";

export * from "./shop-profile-model";

/**
 * Memoised per request, like every other admin reader. Asks `isAdmin()` first
 * so a collector's page load never produces an `insufficient_privilege`; the
 * database refuses either way.
 *
 * An error yields the empty settings rather than throwing — a database without
 * `0040` applied should leave the admin page usable, showing empty fields,
 * not a stack trace.
 */
export const fetchShopProfile = cache(async (): Promise<ShopSettings> => {
  if (!(await canOperateSeller())) return NO_SHOP_SETTINGS;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_shop_profile");
  if (error) return NO_SHOP_SETTINGS;
  return readShopSettings(data);
});
