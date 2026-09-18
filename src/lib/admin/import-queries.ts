/**
 * What the importer needs to know before it can propose anything (ADR-0087).
 *
 * Three reads, all of them cheap, all of them made once per import rather than
 * once per row: the catalog to match against, the resolutions the owner has
 * already made, and the shop's current stock for the figures the workbook
 * actually names.
 */
import { cache } from "react";

import type { CatalogEntry, SavedMapping } from "@/lib/import/classify";
import { canOperateSeller } from "@/lib/auth/capabilities";
import { createClient } from "@/lib/supabase/server";

/**
 * The catalog, flat.
 *
 * Read on the server and handed to the browser with the page rather than
 * fetched from the browser: 600 rows travelling once in the page payload beats
 * 600 rows fetched over a phone connection.
 *
 * **Every** row, not just the publicly visible ones. A figure hidden from the
 * catalog still has stock, and an importer that could not see it reports the
 * owner's own inventory as unmatched.
 *
 * THAT SENTENCE USED TO BE FALSE, AND IT COST A REAL IMPORT. This read a table
 * as the signed-in user, and `skylanders_select_authenticated` grants sight of
 * hidden rows to `is_shop_admin()` — a platform administrator. A Seller
 * Operator is deliberately not one (`0042`), so the account that actually runs
 * the shop saw only `catalog_visible` rows. The first real Production import
 * skipped 28 `Elite …` figures as UNMATCHED_RELEVANT and left their stock
 * unsynchronised.
 *
 * `seller_import_catalog()` (`0052`) is the fix: one `security definer`
 * function, seller-gated, returning the four columns a match needs. The row
 * policy on `skylanders` is unchanged, so nothing about ordinary catalog
 * browsing moved — see the migration for why widening it was the wrong shape
 * of fix.
 */
export const fetchImportCatalog = cache(async (): Promise<CatalogEntry[]> => {
  if (!(await canOperateSeller())) return [];

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_import_catalog");
  if (error || !Array.isArray(data)) return [];

  return (
    data as { sky_id: string; name: string; series_code: string; category: string }[]
  ).map((row) => ({
    skyId: row.sky_id,
    name: row.name,
    series: row.series_code,
    category: row.category ?? "",
  }));
});

/** Resolutions from earlier imports, keyed the way `classifyRow` expects. */
export const fetchImportMappings = cache(async (): Promise<Map<string, SavedMapping>> => {
  if (!(await canOperateSeller())) return new Map();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_import_mappings");
  if (error || !Array.isArray(data)) return new Map();

  return new Map(
    (data as { sheet: string; normalised_name: string; sky_id: string | null; ignored: boolean }[])
      .map((row) => [
        `${row.sheet} ${row.normalised_name}`,
        { skyId: row.sky_id, ignored: row.ignored },
      ]),
  );
});

/** One import and its rows, for the history. */
export type ImportSummary = {
  id: number;
  file_name: string;
  workbook_modified_at: string | null;
  rows_seen: number;
  supported_rows: number;
  ignored_rows: number;
  conflict_rows: number;
  increases: number;
  decreases: number;
  unchanged: number;
  new_positions: number;
  units_before: number;
  units_after: number;
  state: "preview" | "applied" | "discarded";
  created_at: string;
  applied_at: string | null;
};

export const fetchImports = cache(async (): Promise<ImportSummary[]> => {
  if (!(await canOperateSeller())) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_imports", { p_limit: 30 });
  if (error || !Array.isArray(data)) return [];
  return data as ImportSummary[];
});

export type ImportRow = {
  id: number;
  sheet: string;
  source_row: number;
  raw_name: string;
  classification: string;
  sky_id: string | null;
  previous_quantity: number | null;
  desired_quantity: number | null;
  delta: number | null;
  status: string;
  note: string | null;
};

export async function fetchImportRows(importId: number): Promise<ImportRow[]> {
  if (!(await canOperateSeller())) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_import_rows", { p_import_id: importId });
  if (error || !Array.isArray(data)) return [];
  return data as ImportRow[];
}
