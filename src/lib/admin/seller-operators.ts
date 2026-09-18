/**
 * Who may operate the shop (ADR-0077).
 *
 * A platform administrator's read: granting somebody the shop is a platform
 * act, not a commercial one, so a seller operator cannot see or widen this
 * list. `admin_seller_operators()` enforces that; this only asks.
 */
import { cache } from "react";

import { isPlatformAdmin } from "@/lib/auth/capabilities";
import { createClient } from "@/lib/supabase/server";

export type SellerOperator = {
  userId: string;
  username: string | null;
  isEnabled: boolean;
  /** Whether this account also runs the platform. Shown, never inferred. */
  isPlatformAdmin: boolean;
  createdAt: string | null;
};

export type SellerOperators = {
  sellerName: string | null;
  operators: SellerOperator[];
};

export const NO_OPERATORS: SellerOperators = { sellerName: null, operators: [] };

export const fetchSellerOperators = cache(async (): Promise<SellerOperators> => {
  if (!(await isPlatformAdmin())) return NO_OPERATORS;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_seller_operators");
  if (error || data === null || typeof data !== "object") return NO_OPERATORS;

  const root = data as Record<string, unknown>;
  const seller = (root.seller ?? null) as Record<string, unknown> | null;
  const rows = Array.isArray(root.operators) ? root.operators : [];

  return {
    sellerName: typeof seller?.display_name === "string" ? seller.display_name : null,
    operators: rows.flatMap((row) => {
      const o = row as Record<string, unknown>;
      return typeof o.user_id === "string"
        ? [{
            userId: o.user_id,
            username: typeof o.username === "string" ? o.username : null,
            isEnabled: o.is_enabled === true,
            isPlatformAdmin: o.is_platform_admin === true,
            createdAt: typeof o.created_at === "string" ? o.created_at : null,
          }]
        : [];
    }),
  };
});
