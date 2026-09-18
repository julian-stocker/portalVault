/**
 * The importer must be able to see a figure it is expected to match
 * (migration 0052).
 *
 * WHAT THIS COSTS WHEN IT IS WRONG, MEASURED
 *
 * The first real Production import skipped 28 `Elite …` rows as
 * `UNMATCHED_RELEVANT` and left their stock unsynchronised. Every one of them
 * existed in `skylanders`. `fetchImportCatalog()` read the table as the
 * signed-in user, and `skylanders_select_authenticated` grants sight of hidden
 * rows to `is_shop_admin()` — a platform administrator. `0042` makes a Seller
 * Operator and a platform administrator mutually exclusive, so the one account
 * that runs the shop could not see them.
 *
 * AND WHY STAGING SAID IT WAS FINE
 *
 * The Staging classifier ran with the service-role key, which bypasses RLS.
 * It could not have reproduced the seller path, so it proved the classifier
 * and nothing about authorization. These tests pin the shape of the fix; the
 * role-by-role proof runs against a live database, where a policy can actually
 * refuse something.
 */
import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { code, latestFunction, migrationSource } from "@/test-support/migrations";

const SQL = migrationSource("0052_seller_import_catalog.sql");
const QUERIES = readFileSync(join(process.cwd(), "src/lib/admin/import-queries.ts"), "utf8");

describe("the importer no longer reads the table through the public policy", () => {
  it("calls the purpose-built function", () => {
    expect(QUERIES).toContain('rpc("seller_import_catalog")');
  });

  it("and reads `skylanders` directly nowhere", () => {
    /*
     * The whole defect was one `from("skylanders")` in a file whose comment
     * promised something the row policy would not give it.
     */
    expect(QUERIES).not.toContain('from("skylanders")');
    expect(QUERIES).not.toContain('from("categories")');
  });

  it("still refuses a non-seller before it asks the database", () => {
    // Cheap denial in front of the real one, not instead of it.
    expect(QUERIES).toContain("if (!(await canOperateSeller())) return [];");
  });

  it("never uses a service-role client", () => {
    // The browser-facing import path must run as the person using it.
    expect(QUERIES).not.toContain("SERVICE_ROLE");
    expect(QUERIES).not.toContain("createServiceClient");
  });
});

describe("the function is scoped to the one screen that needs it", () => {
  const fn = latestFunction("seller_import_catalog");

  it("is defined by 0052", () => {
    expect(fn.file).toBe("0052_seller_import_catalog.sql");
  });

  it("asks the canonical seller predicate and refuses everyone else", () => {
    expect(code(fn.body)).toContain("public.can_operate_active_seller()");
    expect(code(fn.body)).toContain("seller operator role required");
    expect(code(fn.body)).toContain("insufficient_privilege");
  });

  it("does NOT admit a platform administrator", () => {
    /*
     * Not an oversight. `/business/*` answers `notFound()` to an
     * administrator, and `0042` keeps the two account types apart — a function
     * unreachable through the product should not be callable around it.
     */
    expect(code(fn.body)).not.toContain("is_platform_admin");
    expect(code(fn.body)).not.toContain("is_shop_admin");
  });

  it("does not admit a commerce tester on that basis alone", () => {
    expect(code(fn.body)).not.toContain("is_commerce_tester");
    expect(code(fn.body)).not.toContain("has_tester_permission");
  });

  it("runs security definer with an empty search_path, and is read-only", () => {
    for (const property of ["security definer", "set search_path = ''", "stable"]) {
      expect(fn.body, property).toContain(property);
    }
    // A catalog read cannot move stock.
    for (const forbidden of ["insert", "update ", "delete", "record_inventory_movement"]) {
      expect(code(fn.body).toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  it("returns only what a match needs", () => {
    expect(fn.body).toContain("sky_id      text");
    expect(fn.body).toContain("name        text");
    expect(fn.body).toContain("series_code text");
    expect(fn.body).toContain("category    text");
    // Nothing else off the catalog row.
    for (const column of ["market_price", "image_file", "image_override_path", "slug", "display_name_override", "admin_note"]) {
      expect(code(fn.body), column).not.toContain(column);
    }
    expect(code(SQL)).not.toContain("catalog_editorial");
  });

  it("is granted to authenticated and revoked from anon", () => {
    expect(SQL).toContain("revoke all on function public.seller_import_catalog() from public, anon;");
    expect(SQL).toContain("grant execute on function public.seller_import_catalog() to authenticated;");
  });

  it("can see rows the public catalog hides — that is the point", () => {
    // No catalog_visible filter, and deliberately no is_active filter either:
    // a retired figure holding stock is exactly what must reconcile.
    expect(code(fn.body)).not.toContain("catalog_visible");
    expect(code(fn.body)).not.toContain("is_active");
  });
});

describe("ordinary catalog visibility is left exactly where it was", () => {
  it("0052 does not touch the row policy", () => {
    /*
     * The entire argument for a narrow function instead of a wider policy is
     * that browsing does not change. If this migration ever edits the policy,
     * that argument is gone and this fails.
     */
    expect(code(SQL)).not.toMatch(/create policy|alter policy|drop policy/i);
    expect(code(SQL)).not.toContain("skylanders_select_authenticated");
    expect(code(SQL)).not.toContain("skylanders_select_anon");
  });

  it("0052 alters no table at all", () => {
    expect(code(SQL)).not.toMatch(/alter table|create table|drop table/i);
  });

  it("does not disturb 0051", () => {
    // Two migrations, two subjects. 0051 is already applied to Staging.
    expect(code(SQL)).not.toContain("is_shop_admin_for");
    expect(code(SQL)).not.toContain("profiles_username");
    expect(code(SQL)).not.toContain("seller_operators_username_guard");
  });
});

describe("the importer's semantics are unchanged", () => {
  it("still matches on sheet plus exact name, scoped by series", () => {
    const classify = readFileSync(join(process.cwd(), "src/lib/import/classify.ts"), "utf8");
    expect(classify).toContain("bySeriesName");
    expect(classify).toContain('IMPORT_CONDITION = "loose"');
    for (const sheet of ["SA", "G", "SF", "T", "SC", "I"]) {
      expect(classify, sheet).toContain(`"${sheet}"`);
    }
  });

  it("still ignores what it always ignored", () => {
    const classify = readFileSync(join(process.cwd(), "src/lib/import/classify.ts"), "utf8");
    for (const kind of [
      "IGNORED_GAME",
      "IGNORED_SWAP_FORCE_HALF",
      "IGNORED_OVP",
      "IGNORED_DAMAGED",
      "IGNORED_SHEET",
    ]) {
      expect(classify, kind).toContain(kind);
    }
  });

  it("still treats Storage as an absolute target and recomputes at apply time", () => {
    const apply = code(latestFunction("seller_apply_import").body);
    expect(apply).toContain("record_inventory_movement");
    // The delta is derived from current stock inside the apply, not replayed.
    expect(apply).toContain("v_current");
    expect(apply).not.toContain("r.delta)");
  });

  it("the CatalogEntry shape the classifier consumes is unchanged", () => {
    const classify = readFileSync(join(process.cwd(), "src/lib/import/classify.ts"), "utf8");
    expect(classify).toContain("skyId: string");
    expect(classify).toContain("name: string");
    expect(classify).toContain("series: string");
    expect(classify).toContain("category: string");
  });
});
