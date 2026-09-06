/**
 * Editorial writes.
 *
 * Every one of them is a thin wrapper around a database function. That is the
 * point: the function asks `public.is_shop_admin()` itself (migration 0004),
 * so the check that decides is in the database, not in this file. If someone
 * called these actions without the admin area, or spoke to PostgREST
 * directly, the answer is the same — `insufficient_privilege`.
 *
 * The action still asks `isAdmin()` first. Not as the boundary: as the way to
 * return a German sentence instead of a Postgres error, and to keep the
 * pointless round trip out.
 *
 * `revalidatePath` is what puts the change on screen everywhere at once: the
 * admin list, the figure page, and the public catalog whose contents just
 * changed.
 */
"use server";

import { revalidatePath } from "next/cache";

import { isAdmin } from "@/lib/auth/admin";
import { isCondition, isMovementReason } from "@/lib/admin/inventory-model";
import { createClient } from "@/lib/supabase/server";
import { de } from "@/lib/i18n/de";

export type AdminResult = { ok: true } | { ok: false; message: string };

const SKY_ID = /^SKY-[0-9]{4}$/;

/** Everything the editorial writes have in common. */
async function call(
  fn: string,
  args: Record<string, unknown>,
  paths: readonly string[],
): Promise<AdminResult> {
  if (!(await isAdmin())) return { ok: false, message: de.admin.notAllowed };

  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, message: de.admin.writeFailed };

  for (const path of paths) revalidatePath(path);
  return { ok: true };
}

export async function setCatalogVisible(skyId: string, visible: boolean): Promise<AdminResult> {
  if (!SKY_ID.test(skyId)) return { ok: false, message: de.admin.unknownFigure };
  return call(
    "admin_set_catalog_visible",
    { p_sky_id: skyId, p_visible: visible },
    ["/admin/catalog", `/admin/catalog/${skyId}`, "/", "/collection"],
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
    ["/admin/inventory"],
  );
}

/**
 * Sets price and listing together, because the database function does.
 *
 * `set_shop_listing` writes both plus the internal note in one upsert, so a
 * caller that means to change one has to pass the other two as they are.
 * That is why both editors read from the row they are editing rather than
 * from a form that only holds one field.
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
  if (input.isListed && input.salePrice === null) {
    // The database says the same thing; saying it here says it in German.
    return { ok: false, message: de.inventory.listingNeedsPrice };
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
    ["/admin/inventory"],
  );
}
