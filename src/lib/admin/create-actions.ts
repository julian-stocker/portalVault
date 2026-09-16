/**
 * Creating a catalogue figure (V3.9, ADR-0070).
 *
 * WHY THIS IS NOT IN `actions.ts`
 *
 * That module is the editorial writes — five wrappers around five functions
 * that each change one column of a figure that already exists. This one calls
 * a function that brings a figure INTO existence, allocates an identity that
 * can never be reissued, and returns it. Different question, different file,
 * and `create.test.ts` can hold this one to rules that would make no sense
 * next to a setter.
 *
 * WHAT THE ACTION DOES AND DOES NOT DECIDE
 *
 * `admin_create_figure()` asks `public.is_shop_admin()` itself, so the check
 * that decides is in the database. `isAdmin()` here returns a German sentence
 * instead of a Postgres error and keeps a pointless round trip out — exactly
 * the split `actions.ts` documents.
 *
 * It sends no SKY-ID and no slug. Both are the database's, and an argument
 * for either would be an invitation to choose an identity from a browser.
 */
"use server";

import { refresh, revalidatePath } from "next/cache";

import { isCardTypeValue } from "@/lib/admin/new-figure-draft";
import { isAdmin } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";
import { de } from "@/lib/i18n/de";

export type CreateResult =
  /** The identity the database issued. The caller needs it for the picture. */
  | { ok: true; skyId: string }
  | { ok: false; message: string };

const SKY_ID = /^SKY-[0-9]{4}$/;

/** Same ceiling as the column's own CHECK — a form field, not a document. */
const MAX_NAME = 200;
const MAX_OVERRIDE = 120;
const MAX_NOTE = 2000;

export type CreateFigureInput = {
  name: string;
  seriesCode: string;
  categoryId: number;
  cardType: string;
  catalogVisible: boolean;
  displayNameOverride: string;
  adminNote: string;
  /**
   * The figure this one is derived from, or `null` (ADR-0070a).
   *
   * A SKY-ID and never a character id. `admin_create_figure()` reads the
   * character from that row itself, so the worst a caller can do is name a
   * different existing figure — it cannot assert a curated identity that the
   * catalogue does not already hold.
   */
  templateSkyId: string | null;
};

export async function createFigure(input: CreateFigureInput): Promise<CreateResult> {
  const name = input.name.trim();
  if (name === "" || name.length > MAX_NAME) return { ok: false, message: de.admin.createNameRequired };
  if (input.seriesCode === "") return { ok: false, message: de.admin.createSeriesRequired };
  if (!Number.isInteger(input.categoryId)) return { ok: false, message: de.admin.createCategoryRequired };
  if (!isCardTypeValue(input.cardType)) return { ok: false, message: de.admin.unknownCardType };
  if (input.displayNameOverride.length > MAX_OVERRIDE) return { ok: false, message: de.admin.nameTooLong };
  if (input.adminNote.length > MAX_NOTE) return { ok: false, message: de.admin.writeFailed };
  if (input.templateSkyId !== null && !SKY_ID.test(input.templateSkyId)) {
    return { ok: false, message: de.admin.unknownFigure };
  }

  if (!(await isAdmin())) return { ok: false, message: de.admin.notAllowed };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_create_figure", {
    p_name: name,
    p_series_code: input.seriesCode,
    p_category_id: input.categoryId,
    p_card_type: input.cardType,
    p_catalog_visible: input.catalogVisible,
    // The database turns an empty string into NULL; sending "" rather than
    // null keeps the two optional fields the same shape as everywhere else.
    p_display_name_override: input.displayNameOverride.trim(),
    p_admin_note: input.adminNote.trim(),
    p_template_sky_id: input.templateSkyId,
  });

  /*
   * Every failure below has already rolled the row back — the function is one
   * transaction. What it has NOT rolled back is the sequence value, which is
   * why a retry produces the next number rather than the same one. That is
   * the intended behaviour (ADR-0001: never reissued), and it is also why
   * this returns a message rather than retrying by itself.
   */
  if (error) return { ok: false, message: de.admin.createFailed };
  if (typeof data !== "string") return { ok: false, message: de.admin.createFailed };

  /*
   * The public catalogue is revalidated even though the figure starts hidden.
   * It costs one rebuild and it is the honest list of what this write can
   * reach: the next thing the operator does is publish it, from a different
   * action, and a stale public page after that would be the harder bug.
   */
  for (const path of ["/", "/admin/catalog", "/collection"]) revalidatePath(path);

  /*
   * And refresh the router that called us.
   *
   * SERVER SIDE, from `next/cache`, rather than `router.refresh()` in the
   * catalogue. `catalog-view.tsx` is held to using no router at all —
   * `ui/browse.test.ts` and `ui/quick-view-ux.test.ts` both assert it — because
   * opening a dialog there must never become a navigation and no state may be
   * written to the URL (ADR-0027). That rule is right and this write has no
   * reason to bend it: the new figure has to come from the server either way,
   * and `refresh()` here brings it without the catalogue learning the word
   * "router". It writes no URL, pushes no route and keeps scroll and client
   * state exactly where they were.
   */
  refresh();

  return { ok: true, skyId: data };
}
