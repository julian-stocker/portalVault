/**
 * What this account may do — two answers, neither implying the other.
 *
 * ONE ACCOUNT, ONE TYPE (ADR-0078):
 *
 *   "user"      a private collector — no privileged membership
 *   "business"  a commercial shop — no collection
 *   "admin"     the platform — no collection, no shop
 *
 * There is no fourth state. `0042` refuses an account that would hold both
 * memberships, so the two booleans below can never both be true; somebody who
 * collects privately and runs a shop uses two accounts.
 *
 * WHY THE IDENTITIES ARE SEPARATE AND NOT LAYERED. SkyIsles may one day let a
 * collector sell out of their own collection. If a Business were "a collector
 * with a selling permission", that future feature and the commercial shop
 * would be one thing under two names, with no way to give them different
 * rules.
 *
 * THERE IS STILL NO HIERARCHY. An administrator does not get the shop, and the
 * shop does not get the catalog.
 *
 * WHERE THE ANSWER COMES FROM
 *
 * `my_capabilities()` in Postgres, over the caller's own session, reading
 * `platform_admins` and `seller_operators` — tables no client role can read or
 * write. Never from an e-mail address, a display name, a cookie or component
 * state.
 *
 * AND IT IS NOT THE BOUNDARY. Hiding a link or answering 404 is presentation.
 * The boundary is that every privileged function asks the same predicate again
 * inside the database, so a request that never touches this file still fails.
 */
import { cache } from "react";

import { currentUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";

/** Exactly one of these, decided in the database (ADR-0078). */
export type AccountType = "user" | "business" | "admin";

export type Capabilities = {
  /** Which of the three this account is. */
  accountType: AccountType;
  /** Runs SkyIsles: catalog, categories, testers, platform settings. */
  platformAdmin: boolean;
  /** Runs the shop: offers, inventory, orders, fulfilment, seller settings. */
  sellerOperator: boolean;
  /**
   * A private collector — the only type with a collection.
   *
   * Signed out this is false: there is no collection without an account, and
   * the routes redirect long before it is asked.
   */
  collector: boolean;
};

/** A signed-out visitor, and the answer every failure falls back to. */
export const NO_CAPABILITIES: Capabilities = {
  accountType: "user",
  platformAdmin: false,
  sellerOperator: false,
  collector: false,
};

export const capabilities = cache(async (): Promise<Capabilities> => {
  // No session, no round trip: an anonymous request holds neither capability,
  // and the RPC would only confirm it at the cost of a query.
  if (!(await currentUser())) return NO_CAPABILITIES;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_capabilities");
  // An error is not permission. A failing check denies, it never grants — and
  // a database without 0041 yields a collector, not an administrator.
  if (error || data === null || typeof data !== "object") return NO_CAPABILITIES;

  const row = data as Record<string, unknown>;
  const platformAdmin = row.is_platform_admin === true;
  const sellerOperator = row.can_operate_seller === true;
  /*
   * The type comes from the database, which derives it once. Recomputing it
   * from the booleans here would be a second implementation of a precedence
   * rule — and the only reason a precedence would be needed is a state the
   * database refuses to create.
   */
  const declared = row.account_type;
  const accountType: AccountType =
    declared === "admin" || declared === "business" || declared === "user"
      ? declared
      : platformAdmin
        ? "admin"
        : sellerOperator
          ? "business"
          : "user";

  return {
    accountType,
    platformAdmin,
    sellerOperator,
    collector: accountType === "user",
  };
});

/** Runs SkyIsles itself. Grants nothing commercial. */
export async function isPlatformAdmin(): Promise<boolean> {
  return (await capabilities()).platformAdmin;
}

/** May operate the shop. Grants nothing on the catalog. */
export async function canOperateSeller(): Promise<boolean> {
  return (await capabilities()).sellerOperator;
}

/**
 * A private collector — the only account type with a collection (ADR-0078).
 *
 * A Business or Admin account is refused by the row policies regardless; this
 * is what lets a route answer before the query rather than after it.
 */
export async function isCollector(): Promise<boolean> {
  return (await capabilities()).collector;
}
