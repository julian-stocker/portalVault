/**
 * The Staging runs for 0188 and 0189 (M-05C): the migration embedded
 * character for character, one transaction, the Staging stamp, the old body
 * required before (A3), measured before and after (no row, no right, no
 * other body may move), the new body and the called helpers pinned, and the
 * plan that starts it. The runs themselves execute on real PostgreSQL in
 * `sale-race-0188-0189.test.ts`.
 *
 * Prepared only — not applied anywhere (see APPLIED.md).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PLANS = JSON.parse(readFileSync("supabase/checks/migration-plans.json", "utf8")).migrationen;
const CASES = [
  { nr: "0188", file: "supabase/migrations/0188_sale_delete_lock_order.sql", name: "seller_delete_sale",
    sig: "seller_delete_sale(bigint)", oldFrom: "supabase/migrations/0110_external_hold_runtime.sql",
    oldMd5: "e64a0822c3cda50a1a26b0f8cf456144", newMd5: "2498b653971f54fe2b99cb76c9a98a34",
    rollback: "supabase/rollback/R0188_sale_delete_lock_order.sql",
    helpers: ["3e220b0b1a0b33d0b5ad9afc1be4719d", "fa55019eae858efa4fed3186b581a7f5"] },
  { nr: "0189", file: "supabase/migrations/0189_external_cancel_lock_order.sql", name: "seller_cancel_external_sale",
    sig: "seller_cancel_external_sale(bigint,text,date,timestamptz)", oldFrom: "supabase/migrations/0170_external_sale_cancel.sql",
    oldMd5: "8b6496f3c20f8b706db7eb1df2d8c32b", newMd5: "1a67b44de9da7fa96349aa197a05c027",
    rollback: "supabase/rollback/R0189_external_cancel_lock_order.sql",
    helpers: ["3e220b0b1a0b33d0b5ad9afc1be4719d", "fa55019eae858efa4fed3186b581a7f5",
              "a8a7e665d64e656e0ecc6515f55b3cb7", "3152b6595d78de9b479199da28b05411"] },
] as const;

/** prosrc of the LAST definition of `name` in a file: the text between `as $$` and `$$;`. */
function prosrc(path: string, name: string): string {
  const sql = readFileSync(path, "utf8");
  const start = sql.lastIndexOf(`create or replace function public.${name}(`);
  const a = sql.indexOf("$$", start) + 2;
  return sql.slice(a, sql.indexOf("\n$$;", a) + 1);
}
const md5 = (s: string) => createHash("md5").update(s).digest("hex");

describe.each(CASES)("staging-$nr.sql", (c) => {
  const RUN = readFileSync(`supabase/operations/staging-${c.nr}.sql`, "utf8");
  const PRE = readFileSync(`supabase/checks/${c.nr}_preflight.sql`, "utf8");
  const POST = readFileSync(`supabase/checks/${c.nr}_postflight.sql`, "utf8");

  it("the pinned md5s are the bodies of the files: old = source migration = rollback, new = this migration", () => {
    expect(md5(prosrc(c.oldFrom, c.name))).toBe(c.oldMd5);
    expect(md5(prosrc(c.rollback, c.name))).toBe(c.oldMd5);
    expect(md5(prosrc(c.file, c.name))).toBe(c.newMd5);
  });

  it("embeds the migration character for character, and nothing else", () => {
    const start = `-- >>> EINGEBETTET: ${c.file}\n`;
    const end = `-- <<< ENDE: ${c.file}\n`;
    expect(RUN.slice(RUN.indexOf(start) + start.length, RUN.indexOf(end))).toBe(readFileSync(c.file, "utf8"));
    expect([...RUN.matchAll(/^-- >>> EINGEBETTET: (\S+)$/gm)].map((m) => m[1])).toEqual([c.file]);
  });

  it("one transaction, stamp and old-body check (A1, A3) before the migration, no Production project", () => {
    const lines = RUN.split("\n");
    expect(lines.filter((l) => l.trim() === "begin;")).toHaveLength(1);
    expect(lines.filter((l) => l.trim() === "commit;")).toHaveLength(1);
    expect(RUN.trimEnd().endsWith("commit;")).toBe(true);
    const embedded = RUN.indexOf(`-- >>> EINGEBETTET: ${c.file}`);
    for (const stop of ["ABBRUCH A1", "ABBRUCH A3"]) {
      expect(RUN.indexOf(stop), stop).toBeGreaterThan(RUN.indexOf("begin;"));
      expect(RUN.indexOf(stop), stop).toBeLessThan(embedded);
    }
    expect(RUN).toContain(`is distinct from '${c.oldMd5}'`);
    for (const f of [RUN, PRE, POST]) expect(f).not.toContain("zmiwxswrpkmizvqsgype");
  });

  it("measures data, every function's rights (no exclusion), every other body, and stops on movement (Z1)", () => {
    for (const t of ["sales", "sale_items", "order_reservations", "shop_inventory", "inventory_movements", "orderbook_audit", "collection_items"]) {
      expect(RUN.match(new RegExp(`from public\\.${t} t\\) as ${t},`, "g")), t).toHaveLength(2);
    }
    expect(RUN.match(/where n\.nspname = 'public'\) as funktionsrechte,/g)).toHaveLength(2);
    expect(RUN.match(/ as andere_ruempfe;/g)).toHaveLength(2);
    expect(RUN.indexOf("ABBRUCH Z1")).toBeGreaterThan(RUN.indexOf(`-- <<< ENDE: ${c.file}`));
  });

  it("Z2 pins the new body and every called helper; preflight 103 the old, postflight 201 the new", () => {
    expect(RUN).toContain(`is distinct from '${c.newMd5}'`);
    for (const h of c.helpers) {
      expect(RUN, h).toContain(`is distinct from '${h}'`);
      expect(PRE, h).toContain(h);
      expect(POST, h).toContain(h);
    }
    expect(PRE).toMatch(new RegExp(`\\(103, 'Grundlage'[\\s\\S]*?'${c.oldMd5}'\\)`));
    expect(POST).toMatch(new RegExp(`\\(201, 'Rumpf'[\\s\\S]*?'${c.newMd5}'\\)`));
  });

  it("Z3 and the postflight demand authenticated + service_role, never anon or PUBLIC", () => {
    for (const f of [RUN, POST]) {
      expect(f).toContain(`has_function_privilege('authenticated', to_regprocedure('public.${c.sig}'), 'execute')`);
      expect(f).toContain(`has_function_privilege('service_role', to_regprocedure('public.${c.sig}'), 'execute')`);
      expect(f).toContain(`and not has_function_privilege('anon', to_regprocedure('public.${c.sig}'), 'execute')`);
      expect(f).toContain("a.grantee = 0");
    }
  });

  it("the plan names its files and knows when it is applied (the new body)", () => {
    expect(PLANS[c.nr]).toMatchObject({ preflight: `${c.nr}_preflight.sql`, lauf: `staging-${c.nr}.sql`, postflight: `${c.nr}_postflight.sql` });
    expect(PLANS[c.nr].angewendet.sql).toContain(`'${c.newMd5}'`);
    expect(PLANS[c.nr].angewendet.sql).toMatch(/as erfuellt$/);
  });
});

describe("0188 and 0189 change only their own function", () => {
  it.each(CASES)("$nr: one function body, no table, no data, no other function", (c) => {
    const code = readFileSync(c.file, "utf8").split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
    const created = [...code.matchAll(/create (?:or replace )?function public\.([a-z_]+)\(/g)].map((m) => m[1]);
    expect(created).toEqual([c.name]);
    expect(code).not.toMatch(/\b(create|alter|drop) (table|index|trigger|policy)\b|\balter function\b|\bdrop function\b/i);
    const granted = [...code.matchAll(/(?:revoke|grant)[^;]*on function public\.([a-z_]+)\(/g)].map((m) => m[1]);
    expect(new Set(granted)).toEqual(new Set([c.name]));
    expect(code).toMatch(/order by id for update nowait;/);
    expect(code).toMatch(/exception when lock_not_available then/);
  });
  it("0188 locks the sale before the positions; 0189 already did (0170) and keeps it", () => {
    const b88 = prosrc(CASES[0].file, CASES[0].name);
    expect(b88.indexOf("from public.sales where id = p_id for update;")).toBeGreaterThan(0);
    expect(b88.indexOf("from public.sales where id = p_id for update;")).toBeLessThan(b88.indexOf("for update nowait"));
    const b89 = prosrc(CASES[1].file, CASES[1].name);
    const saleLock = b89.search(/from public\.sales[^;]*for update;/);
    expect(saleLock).toBeGreaterThan(0);
    expect(saleLock).toBeLessThan(b89.indexOf("for update nowait"));
  });
  it("outside the inserted lock block, the new bodies are the old ones word for word", () => {
    for (const c of CASES) {
      const block = /\n *\/\*[^]*?\*\/\n(?: *perform 1 from public\.sales where id = p_id for update;\n\n *\/\*[^]*?\*\/\n)? *begin\n *perform 1 from public\.sale_items where sale_id = p_id order by id for update nowait;\n *exception when lock_not_available then\n[^\n]*\n[^\n]*\n *end;\n/;
      const stripped = prosrc(c.file, c.name).replace(block, "\n");
      const old = prosrc(c.oldFrom, c.name);
      const squash = (s: string) => s.replace(/\/\*[^]*?\*\//g, "").replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
      expect(squash(stripped), c.nr).toBe(squash(old));
    }
  });
});
