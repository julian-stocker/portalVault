/**
 * The Staging run for 0185: the migration embedded character for character,
 * one transaction, the Staging stamp, measured before and after (nothing may
 * move), and the plan that starts it. The migration itself runs on
 * PostgreSQL in `recon-create-sale-0183.test.ts`.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const RUN = readFileSync("supabase/operations/staging-0185.sql", "utf8");
const FILE = "supabase/migrations/0185_recon_assign_sale.sql";
const PLAN = JSON.parse(readFileSync("supabase/checks/migration-plans.json", "utf8")).migrationen["0185"];

describe("staging-0185.sql", () => {
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
    expect(RUN).not.toContain("zmiwxswrpkmizvqsgype");
  });

  it("measures sales, positions, money, stock, holds and the reconciliation before and after, and stops on movement", () => {
    for (const t of ["sales", "sale_items", "sale_refunds", "sale_fees", "inventory_movements", "order_reservations",
      "shop_inventory", "sales_recon_matches", "sales_recon_orders"]) {
      expect(RUN.match(new RegExp(`from public\\.${t} t\\) as ${t},`, "g")), t).toHaveLength(2);
    }
    expect(RUN.indexOf("ABBRUCH Z1")).toBeGreaterThan(RUN.indexOf(`-- <<< ENDE: ${FILE}`));
  });

  it("the plan names its files and knows when it is applied", () => {
    expect(PLAN).toMatchObject({ preflight: "0185_preflight.sql", lauf: "staging-0185.sql", postflight: "0185_postflight.sql" });
    expect(PLAN.angewendet.sql).toContain("seller_recon_assign_sale(bigint,bigint,timestamptz)");
  });
});
