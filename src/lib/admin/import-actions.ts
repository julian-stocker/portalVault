/**
 * The three writes an import makes (ADR-0087).
 *
 * The browser has already read the workbook, classified every row and computed
 * what it proposes. These send that proposal to the database, fetch the shop's
 * side of it, and — separately, and only when the owner says so — apply it.
 *
 * NOTHING HERE TOUCHES STOCK. `seller_apply_import()` does, by calling
 * `record_inventory_movement()` for each row, inside one transaction, with the
 * delta recomputed against current stock rather than against the preview.
 */
"use server";

import { revalidatePath } from "next/cache";

import type { Baseline } from "@/lib/import/classify";
import { canOperateSeller } from "@/lib/auth/capabilities";
import { de } from "@/lib/i18n/de";
import { createClient } from "@/lib/supabase/server";

/** What the shop currently holds, for the figures a workbook names. */
export async function loadBaseline(
  skyIds: readonly string[],
): Promise<Record<string, Baseline>> {
  if (!(await canOperateSeller()) || skyIds.length === 0) return {};

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_import_baseline", {
    p_sky_ids: skyIds,
    p_condition: "loose",
  });
  if (error || !Array.isArray(data)) return {};

  const out: Record<string, Baseline> = {};
  for (const row of data as {
    sky_id: string;
    quantity: number;
    reserved: number;
    last_movement_at: string | null;
    last_import_desired: number | null;
  }[]) {
    out[row.sky_id] = {
      quantity: row.quantity,
      reserved: row.reserved,
      lastMovementAt: row.last_movement_at,
      lastImportDesired: row.last_import_desired,
    };
  }
  return out;
}

export type PreviewRow = {
  sheet: string;
  source_row: number;
  raw_name: string;
  classification: string;
  sky_id: string | null;
  condition: string | null;
  previous_quantity: number | null;
  desired_quantity: number | null;
  delta: number | null;
  status: string;
  note: string | null;
};

export type CreateResult = { ok: true; importId: number } | { ok: false; message: string };

/**
 * Store the proposal.
 *
 * Nothing is applied. The import exists in `preview` and changes no stock until
 * `applyImport()` is called — which is a separate act, on a separate screen,
 * after the owner has seen every line.
 */
export async function createImportPreview(input: {
  fileName: string;
  contentFingerprint: string | null;
  workbookModifiedAt: string | null;
  sheets: string[];
  rows: PreviewRow[];
}): Promise<CreateResult> {
  if (!(await canOperateSeller())) return { ok: false, message: de.admin.notAllowed };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_create_import", {
    p_file_name: input.fileName,
    p_content_fingerprint: input.contentFingerprint,
    p_workbook_modified_at: input.workbookModifiedAt,
    p_sheets: input.sheets,
    p_rows: input.rows,
  });

  if (error || typeof data !== "number") {
    return { ok: false, message: de.business.imports.previewFailed };
  }

  revalidatePath("/business/inventory/import");
  return { ok: true, importId: data };
}

export type ApplyResult =
  | { ok: true; applied: number; unchanged: number }
  | { ok: false; message: string };

/**
 * Apply it.
 *
 * One transaction in the database: if any row fails — a decrement that would
 * strand reserved stock, most likely — the whole import rolls back and nothing
 * changed. There is no half-applied state to explain and no resume to design.
 */
export async function applyImport(importId: number): Promise<ApplyResult> {
  if (!(await canOperateSeller())) return { ok: false, message: de.admin.notAllowed };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_apply_import", { p_import_id: importId });

  if (error) {
    const code = error.code ?? "";
    if (code === "42501") return { ok: false, message: de.admin.notAllowed };
    // The database refused a movement — almost always stock that is reserved
    // for an order in flight. A fact about the shop, not a fault.
    if (code === "22023" || code === "23514" || code === "P0001") {
      return { ok: false, message: de.business.imports.applyRefused };
    }
    return { ok: false, message: de.business.imports.applyFailed };
  }

  const row = (data ?? {}) as Record<string, unknown>;

  revalidatePath("/business/inventory/import");
  revalidatePath("/business/inventory");
  return {
    ok: true,
    applied: typeof row.applied === "number" ? row.applied : 0,
    unchanged: typeof row.unchanged === "number" ? row.unchanged : 0,
  };
}

export async function discardImport(importId: number): Promise<void> {
  if (!(await canOperateSeller())) return;
  const supabase = await createClient();
  await supabase.rpc("seller_discard_import", { p_import_id: importId });
  revalidatePath("/business/inventory/import");
}

/**
 * Remember how a line was resolved, so the question is asked once.
 *
 * Stored against the sheet and the normalised name — a statement about the
 * spreadsheet, which survives re-saving it, reordering rows and editing other
 * cells.
 */
export async function saveImportMapping(input: {
  sheet: string;
  normalisedName: string;
  skyId: string | null;
  ignored: boolean;
}): Promise<void> {
  if (!(await canOperateSeller())) return;
  const supabase = await createClient();
  await supabase.rpc("seller_save_import_mapping", {
    p_sheet: input.sheet,
    p_normalised_name: input.normalisedName,
    p_sky_id: input.skyId,
    p_ignored: input.ignored,
  });
  revalidatePath("/business/inventory/import");
}
