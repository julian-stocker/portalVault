/**
 * Editorial writes.
 *
 * Every one of them is a thin wrapper around a database function. That is the
 * point: the function asks `public.is_shop_admin()` itself (migration 0004),
 * so the check that decides is in the database, not in this file. If someone
 * called these actions without the admin area, or spoke to PostgREST
 * directly, the answer is the same — `insufficient_privilege`.
 *
 * The action still asks its capability first. Not as the boundary: as the way to
 * return a German sentence instead of a Postgres error, and to keep the
 * pointless round trip out.
 *
 * `revalidatePath` is what puts the change on screen everywhere at once: the
 * admin list, the figure page, and the public catalog whose contents just
 * changed.
 */
"use server";

import { isCardType } from "@/lib/catalog/card-type";
import { revalidatePath } from "next/cache";

import { looksLikeEmail, normaliseContact } from "@/lib/admin/seller";
import {
  isCommerceMode,
  MIN_ACCOUNT_QUERY,
  readAccountMatches,
  type AccountMatch,
} from "@/lib/admin/commerce-model";
import { canOperateSeller, isPlatformAdmin } from "@/lib/auth/capabilities";
import {
  isCondition,
  isMovementReason,
  isValidPercentage,
} from "@/lib/admin/inventory-model";
import { isOverridePath } from "@/lib/catalog/image";
import { createClient } from "@/lib/supabase/server";
import { de } from "@/lib/i18n/de";

export type AdminResult = { ok: true } | { ok: false; message: string };

const SKY_ID = /^SKY-[0-9]{4}$/;

/** Everything the editorial writes have in common. */
/**
 * Which capability an action needs (ADR-0077).
 *
 * It must match the predicate the function asks in the database, or the two
 * disagree — and the disagreement has only one shape: the screen offers
 * something the database then refuses. `"platform"` is not a stronger
 * `"seller"`; they are different authorities and neither contains the other.
 */
type Capability = "platform" | "seller";

async function allowed(capability: Capability): Promise<boolean> {
  return capability === "platform" ? isPlatformAdmin() : canOperateSeller();
}

async function call(
  fn: string,
  args: Record<string, unknown>,
  paths: readonly string[],
  capability: Capability,
  /**
   * Turns one specific database refusal into a sentence worth reading.
   *
   * Everything else stays `writeFailed`: an administrator does not need the
   * error code, and a raw Postgres message is not a user interface. This is
   * for refusals that are a rule of the product rather than a fault — the
   * caller is being told what to do, not that something broke.
   */
  domainError?: (error: { code?: string; message?: string }) => string | null,
): Promise<AdminResult> {
  if (!(await allowed(capability))) return { ok: false, message: de.admin.notAllowed };

  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) {
    const specific = domainError?.(error) ?? null;
    return { ok: false, message: specific ?? de.admin.writeFailed };
  }

  for (const path of paths) revalidatePath(path);
  return { ok: true };
}

export async function setCatalogVisible(skyId: string, visible: boolean): Promise<AdminResult> {
  if (!SKY_ID.test(skyId)) return { ok: false, message: de.admin.unknownFigure };
  return call(
    "admin_set_catalog_visible",
    { p_sky_id: skyId, p_visible: visible },
    ["/admin/catalog", `/admin/catalog/${skyId}`, "/", "/collection"],
    "platform",
  );
}

/**
 * Which base artwork a figure is printed on (V3.5).
 *
 * The value is validated in the database as well — `admin_set_card_type()`
 * refuses an unknown one before it reads the row, and the CHECK constraint
 * refuses it again. This guard is here so a typo comes back as a readable
 * refusal rather than as a generic write failure.
 *
 * Revalidates the catalogue and the collection, because the card is drawn on
 * both, and the figure's own admin page. Not the shop: a card type changes
 * no price, no offer and no availability.
 */
export async function setCardType(skyId: string, cardType: string): Promise<AdminResult> {
  if (!SKY_ID.test(skyId)) return { ok: false, message: de.admin.unknownFigure };
  if (!isCardType(cardType)) return { ok: false, message: de.admin.unknownCardType };
  return call(
    "admin_set_card_type",
    { p_sky_id: skyId, p_card_type: cardType },
    ["/admin/catalog", `/admin/catalog/${skyId}`, "/", "/collection"],
    "platform",
  );
}

/** An empty string resets the override — the database turns it into NULL. */
export async function setDisplayNameOverride(skyId: string, value: string): Promise<AdminResult> {
  if (!SKY_ID.test(skyId)) return { ok: false, message: de.admin.unknownFigure };
  if (value.length > 120) return { ok: false, message: de.admin.nameTooLong };
  return call(
    "admin_set_display_name_override",
    { p_sky_id: skyId, p_value: value },
    ["/admin/catalog", `/admin/catalog/${skyId}`, "/", "/collection"],
    "platform",
  );
}

export async function setAdminNote(skyId: string, value: string): Promise<AdminResult> {
  if (!SKY_ID.test(skyId)) return { ok: false, message: de.admin.unknownFigure };
  if (value.length > 2000) return { ok: false, message: de.admin.noteTooLong };
  // Internal only — no public path to revalidate.
  return call(
    "admin_set_admin_note",
    { p_sky_id: skyId, p_value: value },
    ["/admin/catalog", `/admin/catalog/${skyId}`],
    "platform",
  );
}

/**
 * The product group of a category (ADR-0041).
 *
 * An empty value clears the classification back to "not classified yet",
 * which is a real state: such a category stays visible under "Alle" and is
 * never filed under a group nobody chose.
 */
export async function setCatalogGroup(categoryId: number, group: string): Promise<AdminResult> {
  if (!Number.isInteger(categoryId)) return { ok: false, message: de.admin.unknownCategory };
  return call(
    "admin_set_catalog_group",
    { p_category_id: categoryId, p_group: group },
    ["/admin/catalog/categories", "/admin/catalog", "/", "/collection"],
    "platform",
  );
}

// --------------------------------------------------------------- inventory

/**
 * Books a stock movement.
 *
 * The only way stock changes. `quantity` is never assigned — the database
 * function updates it and writes the journal row in one transaction, and it
 * refuses a movement that would take a position below what is reserved
 * (ADR-0037). The position is created by the first movement, so nothing has
 * to be prepared for a figure that has never been stocked.
 *
 * `initial_import` is not among the reasons a browser may pick: that value
 * belonged to the legacy opening balance and is booked by server tooling
 * through a function no client role can execute.
 */
export async function bookMovement(input: {
  skyId: string;
  condition: string;
  delta: number;
  reason: string;
  unitCost?: number | null;
  note?: string | null;
}): Promise<AdminResult> {
  if (!SKY_ID.test(input.skyId)) return { ok: false, message: de.admin.unknownFigure };
  if (!isCondition(input.condition)) return { ok: false, message: de.inventory.unknownCondition };
  if (!isMovementReason(input.reason)) return { ok: false, message: de.inventory.unknownReason };
  if (!Number.isInteger(input.delta) || input.delta === 0) {
    return { ok: false, message: de.inventory.deltaRequired };
  }
  if (input.unitCost !== undefined && input.unitCost !== null && !(input.unitCost > 0)) {
    return { ok: false, message: de.inventory.costPositive };
  }

  return call(
    "record_inventory_movement",
    {
      p_sky_id: input.skyId,
      p_condition: input.condition,
      p_delta: input.delta,
      p_reason: input.reason,
      p_unit_cost: input.unitCost ?? null,
      // Single currency by decision (ADR-0037, section 7). Stated where a
      // cost is stated, so a later second currency has a place to go.
      p_currency: input.unitCost === undefined || input.unitCost === null ? null : "EUR",
      p_note: input.note?.trim() ? input.note.trim() : null,
    },
    ["/business/inventory"],
    "seller",
  );
}

/**
 * Sets the manual price override and the listing together.
 *
 * `set_shop_listing` writes both plus the internal note in one upsert, so a
 * caller that means to change one has to pass the other two as they are.
 * That is why both editors read from the row they are editing rather than
 * from a form that only holds one field.
 *
 * `salePrice` is the **override** since ADR-0045: null means "no override,
 * use the automatic price", not "no price".
 *
 * `isListed` is the **release**, not "in stock" (ADR-0048). Releasing does
 * not require a price and never could sensibly: "sell this when possible" is
 * a decision somebody can make before a market price is known, and
 * `shop_offers()` simply leaves the position out until there is one. So this
 * function no longer refuses anything a price is missing for.
 *
 * It never touches quantity or reserved, and it never touches
 * `skylanders.market_price` — the reference price belongs to the catalog
 * (ADR-0033).
 */
export async function setListing(input: {
  skyId: string;
  condition: string;
  salePrice: number | null;
  isListed: boolean;
  note?: string | null;
}): Promise<AdminResult> {
  if (!SKY_ID.test(input.skyId)) return { ok: false, message: de.admin.unknownFigure };
  if (!isCondition(input.condition)) return { ok: false, message: de.inventory.unknownCondition };
  if (input.salePrice !== null && !(input.salePrice > 0)) {
    return { ok: false, message: de.inventory.pricePositive };
  }
  return call(
    "set_shop_listing",
    {
      p_sky_id: input.skyId,
      p_condition: input.condition,
      p_sale_price: input.salePrice,
      p_is_listed: input.isListed,
      p_note: input.note?.trim() ? input.note.trim() : null,
    },
    // The public catalog too: a release is what makes an offer appear on a
    // card, and the card is cached with the page.
    ["/business/inventory", "/", "/cart"],
    "seller",
  );
}

/**
 * The shop-wide percentage of the market price (ADR-0045).
 *
 * One number, and changing it moves every automatic price at once — no batch
 * update, because no row stores an automatic price. Manual overrides are
 * untouched by construction: they are a different column.
 *
 * Revalidates the public surfaces as well as the admin ones, since every
 * automatic price on every card has just changed.
 */
export async function setShopPercentage(percentage: number): Promise<AdminResult> {
  if (!isValidPercentage(percentage)) {
    return { ok: false, message: de.admin.percentageRange };
  }
  return call(
    "admin_set_shop_percentage",
    { p_percentage: percentage },
    ["/admin", "/business/inventory", "/", "/cart"],
    "seller",
  );
}

/**
 * Points a figure at an uploaded image, or clears the override (ADR-0046).
 *
 * The upload itself happens in `lib/admin/images.ts`; this only records which
 * object the figure should use. `image_file` is never touched, so clearing
 * the override brings the imported picture back rather than leaving a gap.
 */
export async function setImageOverride(skyId: string, path: string | null): Promise<AdminResult> {
  if (!SKY_ID.test(skyId)) return { ok: false, message: de.admin.unknownFigure };
  if (path !== null && !isOverridePath(path, skyId)) {
    return { ok: false, message: de.admin.imageFailed };
  }
  return call(
    "admin_set_image_override",
    { p_sky_id: skyId, p_path: path ?? "" },
    ["/admin/catalog", `/admin/catalog/${skyId}`, "/business/inventory", "/", "/collection"],
    "platform",
  );
}

/**
 * The operator's own facts (ADR-0059).
 *
 * A narrow writer for one group of facts, not a god-function that sets
 * everything: the legal block adds `setBusinessIdentity()` beside this one, so
 * each keeps its own validation instead of branching inside a shared body.
 *
 * `admin_set_seller_contact()` asks `is_shop_admin()` in the database. The
 * check here answers in German and saves a round trip; it is not the boundary.
 *
 * Takes no seller id and never will while SkyIsles has one seller: the
 * database addresses the ACTIVE seller, so no caller can name a second one
 * into existence (ADR-0064).
 */
/**
 * The seller's identity — who yulez.collectibles legally is (ADR-0075).
 *
 * Every field is optional and an empty string clears it, which is what the
 * database function means by NULL-leaves-alone. Nothing is validated beyond
 * being a string: a legal form, a register number and a Wirtschafts-ID have
 * no shape this code could check that would not eventually reject a real one.
 *
 * These values are **not** published anywhere yet. Legal V1 renders them; this
 * only records them, and a field left empty stays empty.
 */
export async function setSellerDetails(fields: {
  legalName?: string;
  tradingName?: string;
  legalForm?: string;
  street?: string;
  postalCode?: string;
  city?: string;
  countryCode?: string;
  phone?: string;
  directContact?: string;
  registerCourt?: string;
  registerNumber?: string;
  vatId?: string;
  wId?: string;
}): Promise<AdminResult> {
  return call(
    "admin_set_seller_details",
    {
      p_legal_name: fields.legalName ?? null,
      p_trading_name: fields.tradingName ?? null,
      p_legal_form: fields.legalForm ?? null,
      p_street: fields.street ?? null,
      p_postal_code: fields.postalCode ?? null,
      p_city: fields.city ?? null,
      p_country_code: fields.countryCode ?? null,
      p_phone: fields.phone ?? null,
      p_direct_contact: fields.directContact ?? null,
      p_register_court: fields.registerCourt ?? null,
      p_register_number: fields.registerNumber ?? null,
      p_vat_id: fields.vatId ?? null,
      p_w_id: fields.wId ?? null,
    },
    ["/admin"],
    "seller",
  );
}

/**
 * The shop's contacts and policies, plus the PLATFORM support address.
 *
 * The PLATFORM's support address is deliberately absent. It used to ride along
 * because the two were edited on one screen — but a seller-guarded function
 * that writes `platform_settings` is a seller editing a platform setting, and
 * no amount of UI placement fixes that (ADR-0077). It has its own
 * administrator-guarded writer.
 *
 * Leaving the withdrawal or complaints address empty is meaningful: it means
 * "the seller's address", resolved with `coalesce` rather than copied, so it
 * keeps following that address when it changes.
 */
export async function setShopPolicies(fields: {
  contactEmail?: string;
  withdrawalContactEmail?: string;
  complaintsContactEmail?: string;
  smallBusiness19?: boolean;
  disputeParticipation?: boolean;
  disputeBody?: string;
  returnPostageBorneBy?: "customer" | "seller";
  dispatchStatement?: string;
  freeShippingThreshold?: number;
}): Promise<AdminResult> {
  for (const value of [fields.contactEmail, fields.withdrawalContactEmail,
                       fields.complaintsContactEmail]) {
    const trimmed = normaliseContact(value ?? "");
    if (trimmed !== null && !looksLikeEmail(trimmed)) {
      return { ok: false, message: de.admin.seller.invalidEmail };
    }
  }
  if (fields.freeShippingThreshold !== undefined &&
      (!Number.isFinite(fields.freeShippingThreshold) || fields.freeShippingThreshold < 0)) {
    return { ok: false, message: de.admin.writeFailed };
  }

  return call(
    "admin_set_shop_policies",
    {
      p_contact_email: fields.contactEmail ?? null,
      p_withdrawal_contact_email: fields.withdrawalContactEmail ?? null,
      p_complaints_contact_email: fields.complaintsContactEmail ?? null,
      p_small_business_19: fields.smallBusiness19 ?? null,
      p_dispute_participation: fields.disputeParticipation ?? null,
      p_dispute_body: fields.disputeBody ?? null,
      p_return_postage_borne_by: fields.returnPostageBorneBy ?? null,
      p_dispatch_statement: fields.dispatchStatement ?? null,
      p_free_shipping_threshold: fields.freeShippingThreshold ?? null,
    },
    // The threshold and the countries reach the checkout, so it re-reads too.
    ["/admin", "/checkout", "/cart"],
    "seller",
  );
}

/**
 * The SkyIsles support address — a PLATFORM setting (ADR-0077).
 *
 * Separate from `setShopPolicies()` because it is a different authority, not
 * merely a different field: `admin_set_platform_support()` asks
 * `is_platform_admin()`, so a seller operator is refused in the database
 * whatever screen the input happens to sit on.
 */
export async function setPlatformSupport(supportEmail: string): Promise<AdminResult> {
  if (!(await isPlatformAdmin())) return { ok: false, message: de.admin.notAllowed };

  const trimmed = normaliseContact(supportEmail);
  if (trimmed !== null && !looksLikeEmail(trimmed)) {
    return { ok: false, message: de.admin.seller.invalidEmail };
  }
  return call("admin_set_platform_support", { p_support_email: supportEmail }, ["/admin"], "platform");
}

/** Enables or disables one delivery country. The server decides, always. */
export async function setShippingCountry(
  countryCode: string,
  label: string,
  enabled: boolean,
): Promise<AdminResult> {
  if (!/^[A-Za-z]{2}$/.test(countryCode.trim())) {
    return { ok: false, message: de.admin.writeFailed };
  }
  return call(
    "admin_set_shipping_country",
    {
      p_country_code: countryCode.trim().toUpperCase(),
      p_label: label.trim(),
      p_enabled: enabled,
    },
    ["/admin", "/checkout"],
    "seller",
  );
}

export async function setSellerContact(
  displayName: string,
  contactEmail: string,
  replyTo: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!(await canOperateSeller())) return { ok: false, message: de.admin.notAllowed };

  const name = normaliseContact(displayName);
  const contact = normaliseContact(contactEmail);
  const reply = normaliseContact(replyTo);

  for (const value of [contact, reply]) {
    if (value !== null && !looksLikeEmail(value)) {
      return { ok: false, message: de.admin.seller.invalidEmail };
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_seller_contact", {
    p_display_name: name,
    p_contact_email: contact,
    p_reply_to: reply,
  });
  if (error) return { ok: false, message: de.admin.seller.saveFailed };

  revalidatePath("/admin");
  return { ok: true };
}

/**
 * The platform's own contact address.
 *
 * Deliberately a separate action from `setSellerContact()`: two subjects, two
 * narrow writers (ADR-0059). Neither can touch the other's field, which is a
 * property the runtime proof checks in both directions.
 */
export async function setPlatformContact(
  contactEmail: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!(await isPlatformAdmin())) return { ok: false, message: de.admin.notAllowed };

  const contact = normaliseContact(contactEmail);
  if (contact !== null && !looksLikeEmail(contact)) {
    return { ok: false, message: de.admin.platform.invalidEmail };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_platform_contact", {
    p_contact_email: contact,
  });
  if (error) return { ok: false, message: de.admin.platform.saveFailed };

  revalidatePath("/admin");
  return { ok: true };
}

/* ------------------------------------------------------- the commerce mode */

/**
 * Switches commerce between closed, sandbox and live.
 *
 * `admin_set_commerce_mode()` checks the role itself and refuses an unknown
 * value; this wrapper exists to answer in German and to revalidate the pages
 * whose content the switch changes — the admin dashboard and the checkout,
 * which stops offering a form the moment the mode closes.
 */
export async function setCommerceMode(mode: string): Promise<AdminResult> {
  if (!isCommerceMode(mode)) return { ok: false, message: de.admin.commerce.modeFailed };
  if (!(await canOperateSeller())) return { ok: false, message: de.admin.notAllowed };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_commerce_mode", { p_mode: mode });
  if (error) return { ok: false, message: de.admin.commerce.modeFailed };

  revalidatePath("/admin");
  revalidatePath("/checkout");
  revalidatePath("/cart");
  return { ok: true };
}

/**
 * Grants or withdraws sandbox checkout for one account.
 *
 * The argument is a `user_id` and nothing else. An address never reaches this
 * function, because an address never authorises anything (ADR-0032) — the
 * search below is how an operator turns a person they know into an id.
 */
export async function setCommerceTester(
  userId: string,
  enabled: boolean,
  note?: string,
): Promise<AdminResult> {
  if (!(await isPlatformAdmin())) return { ok: false, message: de.admin.notAllowed };
  if (typeof userId !== "string" || userId === "") {
    return { ok: false, message: de.admin.writeFailed };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_commerce_tester", {
    p_user_id: userId,
    p_enabled: enabled,
    p_note: typeof note === "string" && note.trim() !== "" ? note.trim() : null,
  });
  if (error) return { ok: false, message: de.admin.writeFailed };

  revalidatePath("/admin");
  return { ok: true };
}

/**
 * Adds or removes a tester account (ADR-0071).
 *
 * The argument is a `user_id` and nothing else, for the same reason
 * `setCommerceTester()` takes one: an address never authorises anything
 * (ADR-0032). Removing takes the account's permissions with it by cascade and
 * touches nothing else about the account.
 */
export async function setTester(
  userId: string,
  enabled: boolean,
  note?: string,
): Promise<AdminResult> {
  if (!(await isPlatformAdmin())) return { ok: false, message: de.admin.notAllowed };
  if (typeof userId !== "string" || userId === "") {
    return { ok: false, message: de.admin.writeFailed };
  }
  return call(
    "admin_set_tester",
    {
      p_user_id: userId,
      p_enabled: enabled,
      p_note: typeof note === "string" && note.trim() !== "" ? note.trim() : null,
    },
    ["/admin"],
    "platform",
  );
}

/**
 * Grants or revokes one tester permission (ADR-0071).
 *
 * The permission is not validated here beyond being a non-empty string: the
 * registry in the database decides what exists, and inventing a second list to
 * check against would be the drift this design removes. An unknown key comes
 * back refused, by name.
 */
export async function setTesterPermission(
  userId: string,
  permission: string,
  enabled: boolean,
): Promise<AdminResult> {
  if (!(await isPlatformAdmin())) return { ok: false, message: de.admin.notAllowed };
  if (typeof userId !== "string" || userId === "") {
    return { ok: false, message: de.admin.writeFailed };
  }
  if (typeof permission !== "string" || permission === "") {
    return { ok: false, message: de.admin.writeFailed };
  }
  return call(
    "admin_set_tester_permission",
    { p_user_id: userId, p_permission: permission, p_enabled: enabled },
    ["/admin", "/checkout", "/cart"],
    "platform",
  );
}

/**
 * Finds accounts by the beginning of a username or address.
 *
 * Read-only, and deliberately narrow: three characters minimum, ten results,
 * prefix matching. It is a lookup box for an operator who already knows who
 * they are looking for, not a directory to browse.
 */
/**
 * Grants or withdraws permission to operate the shop (ADR-0077).
 *
 * A PLATFORM act: `admin_set_seller_operator()` asks `is_platform_admin()`, so
 * a seller operator cannot add a second operator to its own shop. Granting the
 * shop does not grant the catalog, and holding the catalog does not grant the
 * shop — there is no inheritance in either direction.
 *
 * The argument is a `user_id`. An address may FIND the account (`findAccounts`)
 * but never authorises one, for the same reason `setTester()` takes an id.
 */
export async function setSellerOperator(
  userId: string,
  enabled: boolean,
  note?: string,
): Promise<AdminResult> {
  if (!(await isPlatformAdmin())) return { ok: false, message: de.admin.notAllowed };
  if (typeof userId !== "string" || userId === "") {
    return { ok: false, message: de.admin.writeFailed };
  }
  return call(
    "admin_set_seller_operator",
    {
      p_user_id: userId,
      p_enabled: enabled,
      p_note: typeof note === "string" && note.trim() !== "" ? note.trim() : null,
    },
    ["/admin"],
    "platform",
    /*
     * `0051` refuses to withdraw the last shop grant from an account whose
     * username still contains a dot. That is a rule, not a failure, and the
     * administrator can act on it — so it gets its own sentence instead of
     * "could not be saved".
     */
    (error) =>
      error.message?.includes("seller_operators_username_guard")
        ? de.businessAccounts.revokeBlockedByUsername
        : null,
  );
}

export async function findAccounts(
  query: string,
): Promise<{ ok: true; matches: AccountMatch[] } | { ok: false; message: string }> {
  if (!(await isPlatformAdmin())) return { ok: false, message: de.admin.notAllowed };
  const trimmed = typeof query === "string" ? query.trim() : "";
  if (trimmed.length < MIN_ACCOUNT_QUERY) {
    return { ok: false, message: de.admin.commerce.searchTooShort };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_find_accounts", { p_query: trimmed });
  if (error) return { ok: false, message: de.admin.writeFailed };

  return { ok: true, matches: readAccountMatches(data) };
}

/**
 * Books the return movements for a sandbox order's stock.
 *
 * The correction path this schema has always had (ADR-0037): nothing is
 * edited and nothing is deleted, a new movement says what happened. The
 * database refuses any order that was not placed in sandbox, so this button
 * can never put a real customer's goods back on the shelf.
 */
export async function revertSandboxStock(orderNumber: string): Promise<AdminResult> {
  if (!(await canOperateSeller())) return { ok: false, message: de.admin.notAllowed };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_revert_sandbox_stock", {
    p_order_number: orderNumber,
  });
  if (error) return { ok: false, message: de.admin.commerce.revertStockFailed };

  revalidatePath("/admin");
  revalidatePath("/business/inventory");
  revalidatePath(`/business/orders/${orderNumber}`);
  return { ok: true };
}
