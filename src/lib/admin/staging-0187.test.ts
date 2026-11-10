/**
 * The Staging run for 0187 (M-05B): the migration embedded character for
 * character, one transaction, the Staging stamp, measured before and after
 * (nothing but this one function's rights may move), the body from 0041 and
 * its two helpers pinned, and the plan that starts it. The migration itself
 * runs on PostgreSQL in `shop-policies-grants-0187.test.ts`.
 *
 * Prepared only — not applied anywhere (see APPLIED.md).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const RUN = readFileSync("supabase/operations/staging-0187.sql", "utf8");
const FILE = "supabase/migrations/0187_revoke_shop_policies_public.sql";
const PRE = readFileSync("supabase/checks/0187_preflight.sql", "utf8");
const POST = readFileSync("supabase/checks/0187_postflight.sql", "utf8");
const PLAN = JSON.parse(readFileSync("supabase/checks/migration-plans.json", "utf8")).migrationen["0187"];
const BODY_0041 = "db2dc5fb246f6789e5de62d78ea783ec";   // md5(prosrc) of admin_set_shop_policies, Staging schema 2026-11-09 = 0041
const HELPERS = ["3e220b0b1a0b33d0b5ad9afc1be4719d", "30a1922dba899beebdf451c862b3940f"]; // can_operate_active_seller, shop_setting_value

describe("staging-0187.sql", () => {
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

  it("measures sellers, stock, collection and every OTHER right before and after, and stops on movement", () => {
    for (const t of ["sellers", "shop_inventory"]) {
      expect(RUN.match(new RegExp(`from public\\.${t} t\\) as ${t},`, "g")), t).toHaveLength(2);
    }
    expect(RUN.match(/and p\.proname not in \('admin_set_shop_policies'\)\) as funktionsrechte,/g)).toHaveLength(2);
    expect(RUN.indexOf("ABBRUCH Z1")).toBeGreaterThan(RUN.indexOf(`-- <<< ENDE: ${FILE}`));
  });

  it("the body from 0041 and both helpers are pinned (Z2, preflight 101/103, postflight 201/221)", () => {
    expect(RUN).toContain(`is distinct from '${BODY_0041}'`);
    expect(PRE).toContain(`'${BODY_0041}'`);
    expect(POST).toContain(`'${BODY_0041}'`);
    for (const md5 of HELPERS) {
      expect(RUN, md5).toContain(`is distinct from '${md5}'`);
      expect(PRE, md5).toContain(md5);
      expect(POST, md5).toContain(md5);
    }
  });

  it("Z3 and the postflight demand authenticated + service_role, never anon or PUBLIC", () => {
    for (const f of [RUN, POST]) {
      expect(f).toContain("has_function_privilege('authenticated', to_regprocedure('public.admin_set_shop_policies(text,text,text,boolean,boolean,text,text,text,numeric)'), 'execute')");
      expect(f).toContain("has_function_privilege('service_role', to_regprocedure('public.admin_set_shop_policies(text,text,text,boolean,boolean,text,text,text,numeric)'), 'execute')");
      expect(f).toContain("and not has_function_privilege('anon', to_regprocedure('public.admin_set_shop_policies(text,text,text,boolean,boolean,text,text,text,numeric)'), 'execute')");
      expect(f).toContain("a.grantee = 0");
    }
  });

  it("the preflight names the gap it closes (111) and exactly one overload (102)", () => {
    expect(PRE).toMatch(/\(111, 'Luecke', 'anon oder PUBLIC duerfen admin_set_shop_policies noch ausfuehren/);
    expect(PRE).toMatch(/\(102, 'Grundlage', 'admin_set_shop_policies existiert in genau EINER Ueberladung/);
  });

  it("the plan names its files and knows when it is applied", () => {
    expect(PLAN).toMatchObject({ preflight: "0187_preflight.sql", lauf: "staging-0187.sql", postflight: "0187_postflight.sql" });
    expect(PLAN.angewendet.sql).toContain("not has_function_privilege('anon', 'public.admin_set_shop_policies(text,text,text,boolean,boolean,text,text,text,numeric)', 'execute')");
    expect(PLAN.angewendet.sql).toMatch(/as erfuellt$/);
  });
});
