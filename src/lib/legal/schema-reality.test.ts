/**
 * Does the SQL address columns that exist? (ADR-0086)
 *
 * WHY THIS FILE EXISTS. `0047` was audited three times — a pre-apply
 * verification, a final pre-apply audit, and a 22-mutation probe — and every
 * one of those read the migration as *text*. The first apply to Staging failed
 * on its first write:
 *
 *     ERROR: 42703: column "legal_name" does not exist
 *
 * The seller's identity was being seeded into `public.shop_settings`. Those
 * columns live on `public.sellers`, put there by `0040`. Nothing in `0047`
 * said otherwise and no test could tell, because a statement naming the wrong
 * table is perfectly good text — it is only wrong against a schema, and no
 * test knew the schema.
 *
 * These tests know the schema, folded out of the migration history by
 * `columnsOf()`. They are deliberately about *existence*, not spelling: the
 * question that was never asked.
 */
import { describe, expect, it } from "vitest";

import { allMigrations, code, columnsOf, columnsWritten, latestFunction, migrationSource } from "@/test-support/migrations";

const SQL = migrationSource("0047_legal_layer.sql");

describe("the seller's identity is written where it lives", () => {
  it("goes to public.sellers", () => {
    const written = columnsWritten(SQL, "sellers");
    expect(written).toContain("legal_name");
    expect(written).toContain("trading_name");
    expect(written).toContain("vat_id");
    expect(written).toContain("display_name");
  });

  it("and every column it writes there actually exists on that table", () => {
    // The assertion that would have caught the failed apply.
    const columns = columnsOf("sellers");
    for (const column of columnsWritten(SQL, "sellers")) {
      expect(columns, `sellers.${column}`).toContain(column);
    }
  });

  it("never to shop_settings, which has none of those columns", () => {
    /*
     * `shop_settings` is platform configuration. It shares exactly one column
     * name with the seller identity — `free_shipping_threshold`, the old home
     * of a value `0041` moved — and that overlap is what made reading the
     * wrong table fail loudly in one place and silently in the other.
     */
    expect(columnsWritten(SQL, "shop_settings")).toEqual([]);
    expect(code(SQL)).not.toContain("shop_settings");
  });

  it("and the threshold is read from the seller, not from its old home", () => {
    // Comments stripped: the body explains why the OTHER table is wrong, and
    // naming it in prose is not reading from it.
    const fn = code(latestFunction("shipping_free_from").body);
    expect(fn).toContain("from public.sellers s");
    expect(fn).not.toContain("shop_settings");
    expect(columnsOf("sellers")).toContain("free_shipping_threshold");
  });
});

describe("the address has the shape the schema has", () => {
  it("is one street line, because there is no house_number column", () => {
    /*
     * `sellers` has `street` and no `house_number` — "Lechhalde 1 1/2" is a
     * single street line. The customer's address in `order_addresses` DOES
     * split the two, which is where the wrong assumption came from.
     */
    expect(columnsOf("sellers")).toContain("street");
    expect(columnsOf("sellers")).not.toContain("house_number");
    expect(columnsOf("order_addresses")).toContain("house_number");

    const seed = code(SQL).slice(code(SQL).indexOf("update public.sellers set"));
    expect(seed.slice(0, seed.indexOf("where is_active"))).not.toContain("house_number");
  });

  it("carries the owner's address exactly as given, not reformatted", () => {
    expect(SQL).toContain("'Lechhalde 1 1/2'");
    expect(SQL).toContain("'87629'");
    expect(SQL).toContain("'Füssen'");
  });
});

describe("every column this migration writes exists on its table", () => {
  /*
   * The general form. Tables `0047` creates are checked against their own
   * CREATE TABLE by `columnsOf()` folding the whole history, so they are
   * covered here too once the migration is part of that history.
   */
  const TABLES = [
    "orders",
    "sellers",
    "order_events",
    "legal_document_versions",
    "order_legal_snapshots",
    "withdrawal_requests",
    "withdrawal_attempts",
    "order_refunds",
    "invoices",
  ];

  for (const table of TABLES) {
    it(`${table}`, () => {
      const columns = columnsOf(table);
      for (const written of columnsWritten(SQL, table)) {
        expect(columns, `${table}.${written}`).toContain(written);
      }
    });
  }
});

describe("0048 writes only columns that exist", () => {
  const IMPORT_SQL = migrationSource("0048_inventory_import.sql");

  for (const table of ["inventory_imports", "inventory_import_rows", "inventory_import_mappings"]) {
    it(`${table}`, () => {
      const columns = columnsOf(table);
      for (const written of columnsWritten(IMPORT_SQL, table)) {
        expect(columns, `${table}.${written}`).toContain(written);
      }
    });
  }

  it("and does not write stock directly", () => {
    expect(columnsWritten(IMPORT_SQL, "shop_inventory")).toEqual([]);
    expect(columnsWritten(IMPORT_SQL, "inventory_movements")).toEqual([]);
  });
});

describe("the helper itself fails closed", () => {
  it("throws on a table it cannot find, rather than reporting no columns", () => {
    // A guard that returns an empty set for a typo would pass every test above
    // while checking nothing at all.
    expect(() => columnsOf("no_such_table_anywhere")).toThrow(/no columns found/);
  });

  it("really is reading the history, not a single file", () => {
    // `legal_name` is added by 0040, to a table created in 0026.
    expect(columnsOf("sellers")).toContain("legal_name");
    expect(migrationSource("0026_platform_and_seller.sql")).not.toContain("legal_name");
    expect(allMigrations).toContain("add column if not exists legal_name");
  });
});
