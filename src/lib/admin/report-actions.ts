/**
 * Writing one month down (ADR-0082).
 *
 * WHY FINALIZING IS AN ACTION AND NOT A SIDE EFFECT OF LOOKING
 *
 * The tempting shortcut is to write the report the first time somebody opens
 * the page. It would then bear the timestamp of a page view — and a month
 * nobody looked at until March would be finalized in March, quietly including
 * whatever arrived in between. It would still be stable afterwards; *when* it
 * was made would be an accident.
 *
 * So the seller issues it. One button, one moment, recorded.
 *
 * The capability is asked here and again inside `seller_finalize_monthly_report()`
 * — this one so the page can say "nicht erlaubt" in German, that one because
 * it is the boundary (ADR-0077).
 */
"use server";

import { revalidatePath } from "next/cache";

import { canOperateSeller } from "@/lib/auth/capabilities";
import { de } from "@/lib/i18n/de";
import { createClient } from "@/lib/supabase/server";

export type FinalizeResult = { ok: true } | { ok: false; message: string };

/**
 * Write one month down.
 *
 * Idempotent in the database: a month that already has a report returns it
 * unchanged rather than being recomputed. So a double click, a retry or a
 * second operator produces one statement, not two — and never a silently
 * refreshed one.
 */
export async function finalizeMonthlyReport(
  year: number,
  month: number,
): Promise<FinalizeResult> {
  if (!(await canOperateSeller())) return { ok: false, message: de.admin.notAllowed };

  const supabase = await createClient();
  const { error } = await supabase.rpc("seller_finalize_monthly_report", {
    p_year: year,
    p_month: month,
  });

  if (error) {
    const code = error.code ?? "";
    if (code === "42501") return { ok: false, message: de.admin.notAllowed };
    // The database refuses a month that has not ended. That is a fact about
    // the calendar, not a fault — and the only way to reach it is a stale page.
    if (code === "22023") return { ok: false, message: de.business.reports.monthNotOver };
    return { ok: false, message: de.business.reports.createFailed };
  }

  revalidatePath("/business/reports");
  return { ok: true };
}
