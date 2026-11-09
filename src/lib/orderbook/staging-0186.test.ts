/**
 * The Staging run for 0186: the migration embedded character for character,
 * one transaction, the Staging stamp, measured before and after (nothing may
 * move), the take check of 0180 and the plain assignment of 0185 pinned to
 * their applied bodies, and the plan that starts it. The migration itself
 * runs on PostgreSQL in `recon-order-ref-exclusions-0186.test.ts`.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const RUN = readFileSync("supabase/operations/staging-0186.sql", "utf8");
const FILE = "supabase/migrations/0186_recon_order_ref_with_exclusions.sql";
const PRE = readFileSync("supabase/checks/0186_preflight.sql", "utf8");
const POST = readFileSync("supabase/checks/0186_postflight.sql", "utf8");
const PLAN = JSON.parse(readFileSync("supabase/checks/migration-plans.json", "utf8")).migrationen["0186"];

describe("staging-0186.sql", () => {
  it("embeds the migration character for character, and nothing else", () => {
    const start = `-- >>> EINGEBETTET: ${FILE}\n`;
    const end = `-- <<< ENDE: ${FILE}\n`;
    expect(RUN.slice(RUN.indexOf(start) + start.length, RUN.indexOf(end))).toBe(readFileSync(FILE, "utf8"));
    expect([...RUN.matchAll(/^-- >>> EINGEBETTET: (\S+)$/gm)].map((m) => m[1])).toEqual([FILE]);
  });

  it("one transaction, the stamp inside it, no Production project", () => {
    const lines = RUN.split("\n");
    expect(lines.filter((l) => l.trim() === "begin;")).toHaveLength(1);
    expect(lines.filter((l) => l.trim() === "commit;")).toHaveLength(1);
    expect(RUN.trimEnd().endsWith("commit;")).toBe(true);
    expect(RUN.indexOf("ABBRUCH A1")).toBeGreaterThan(RUN.indexOf("begin;"));
    for (const f of [RUN, PRE, POST]) expect(f).not.toContain("zmiwxswrpkmizvqsgype");
  });

  it("measures sales, positions, money, stock, holds, the journal and the reconciliation before and after, and stops on movement", () => {
    for (const t of ["sales", "sale_items", "sale_refunds", "sale_fees", "inventory_movements", "orderbook_audit", "order_reservations",
      "shop_inventory", "sales_recon_matches", "sales_recon_orders"]) {
      expect(RUN.match(new RegExp(`from public\\.${t} t\\) as ${t},`, "g")), t).toHaveLength(2);
    }
    expect(RUN.indexOf("ABBRUCH Z1")).toBeGreaterThan(RUN.indexOf(`-- <<< ENDE: ${FILE}`));
  });

  it("the new body is pinned, and 0180's take check and 0185's assignment stay word for word (Z2, preflight 101, postflight 221)", () => {
    expect(RUN).toContain("is distinct from '7039d396e7166d623c42690bae1d0d2d'");
    for (const md5 of ["bce45f42855c25fc428cab86bd7cf081", "2ecac417b66bc59c3272440d296f9e67"]) {
      expect(RUN, md5).toContain(`is distinct from '${md5}'`);
      expect(PRE, md5).toContain(md5);
      expect(POST, md5).toContain(md5);
    }
    expect(POST).toContain("'7039d396e7166d623c42690bae1d0d2d'");
  });

  it("the plan names its files and knows when it is applied", () => {
    expect(PLAN).toMatchObject({ preflight: "0186_preflight.sql", lauf: "staging-0186.sql", postflight: "0186_postflight.sql" });
    expect(PLAN.angewendet.sql).toContain("seller_recon_confirm_order_ref(bigint,bigint,timestamptz,jsonb,text)");
  });
});
