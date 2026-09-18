/**
 * Reading the shop's monthly settlement reports (ADR-0082).
 *
 * Both calls go through `security definer` functions that ask
 * `can_operate_active_seller()` themselves (migration 0045). The session is the
 * seller's own — anon key plus their JWT — so no service-role key is involved
 * and none may be. `seller_monthly_reports` is revoked from every client role,
 * so a request that reaches PostgREST without these functions reads nothing.
 * * Reads only. Issuing one is a write and lives in `report-actions.ts`, the
 * same split `order-queries.ts` and `order-actions.ts` already keep — and here
 * it is also a requirement: a `"use server"` module may export nothing but
 * async functions, and `cache()` returns something else.
 */
import { cache } from "react";

import type { MonthlyReport } from "@/lib/admin/report-archive";
import { canOperateSeller } from "@/lib/auth/capabilities";
import { createClient } from "@/lib/supabase/server";

/**
 * Every report the shop has, newest first.
 *
 * Small by construction — at most twelve rows a year, and each one is eleven
 * scalars. There is no pagination because there is nothing to paginate.
 */
export const fetchMonthlyReports = cache(async (): Promise<MonthlyReport[]> => {
  if (!(await canOperateSeller())) return [];

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_monthly_reports", { p_year: null });
  // A database without 0045 has no reports, which renders as a year of months
  // waiting to be issued — honest, and not an error page.
  if (error || !Array.isArray(data)) return [];
  return data as MonthlyReport[];
});

/** The years the selector offers: those with a live sale, plus this one. */
export const fetchReportYears = cache(async (): Promise<number[]> => {
  if (!(await canOperateSeller())) return [];

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_report_years");
  if (error || !Array.isArray(data)) return [];
  return (data as unknown[]).filter((y): y is number => typeof y === "number");
});
