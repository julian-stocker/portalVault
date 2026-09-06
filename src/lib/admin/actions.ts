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
