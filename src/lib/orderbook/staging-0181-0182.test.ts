/**
 * The one Staging run for 0181 and 0182 — the hand corrections of workbook
 * positions and their record in both backups, in ONE transaction, so the
 * table never exists on Staging without being backed up.
 *
 * Embedded code is a copy, and a copy drifts: the operator would then run
 * something that is no longer the tested migration. So every embedded section
 * is compared with its file, character for character (as `group-run.test.ts`
 * does for 0169–0174). The migrations themselves run on PostgreSQL in
 * `legacy-item-corrections-0181.test.ts` and in probe P82.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const RUN = readFileSync("supabase/operations/staging-0181-0182.sql", "utf8");
const GROUP = ["0181_legacy_sale_item_corrections.sql", "0182_backup_sale_item_corrections.sql"];
const PLANS = JSON.parse(readFileSync("supabase/checks/migration-plans.json", "utf8")).migrationen as
  Record<string, { preflight: string; lauf: string; postflight: string; angewendet: { sql: string } }>;

const start = (file: string) => `-- >>> EINGEBETTET: supabase/migrations/${file}\n`;
const end = (file: string) => `-- <<< ENDE: supabase/migrations/${file}\n`;

function embedded(file: string): string {
  const a = RUN.indexOf(start(file));
  const b = RUN.indexOf(end(file));
  expect(a, `marker missing: ${file}`).toBeGreaterThan(-1);
  expect(b, `end marker missing: ${file}`).toBeGreaterThan(a);
  return RUN.slice(a + start(file).length, b);
}

describe("the embedded migrations are identical to their files", () => {
  for (const file of GROUP) {
    it(`${file} — character for character`, () => {
      expect(embedded(file)).toBe(readFileSync(`supabase/migrations/${file}`, "utf8"));
    });
  }

  it("and nothing else is embedded, 0181 before 0182", () => {
    const marks = [...RUN.matchAll(/^-- >>> EINGEBETTET: supabase\/migrations\/(\S+)$/gm)].map((m) => m[1]);
    expect(marks).toEqual(GROUP);
  });
});

describe("the frame: one transaction, Staging only, nothing moves", () => {
  const lines = RUN.split("\n");

  it("has exactly one begin and one commit, the commit last", () => {
    expect(lines.filter((l) => l.trim() === "begin;")).toHaveLength(1);
    expect(lines.filter((l) => l.trim() === "commit;")).toHaveLength(1);
    expect(RUN.trimEnd().endsWith("commit;")).toBe(true);
  });

  it("checks the Staging stamp inside the transaction, and names no Production project", () => {
    expect(RUN.indexOf("ABBRUCH A1: Umgebungsstempel nicht gefunden")).toBeGreaterThan(RUN.indexOf("begin;"));
    expect(RUN).toContain("'skyisles-staging qqxcpesbwfxzgytkdsac'");
    expect(RUN).not.toContain("zmiwxswrpkmizvqsgype");
  });

  it("measures sales, positions, money, stock and rights before and after, and stops on any movement", () => {
    expect(RUN.indexOf("create temporary table corr_0181_vorher")).toBeLessThan(RUN.indexOf(start(GROUP[0])));
    expect(RUN.indexOf("create temporary table corr_0181_nachher")).toBeGreaterThan(RUN.indexOf(end(GROUP[1])));
    for (const t of ["sales", "sale_items", "sale_refunds", "sale_fees", "inventory_movements", "shop_inventory", "orderbook_audit"]) {
      expect(RUN, t).toContain(`from public.${t} t) as ${t},`);
    }
    expect(RUN.indexOf("ABBRUCH Z1")).toBeGreaterThan(RUN.indexOf(end(GROUP[1])));
  });

  it("Z2 demands both sync bodies of 0181 and both backup bodies of 0182", () => {
    const z2 = RUN.slice(RUN.indexOf("/* Z2"), RUN.indexOf("ABBRUCH Z2"));
    for (const f of ["system_sync_legacy_sale_item", "system_sync_legacy_sale_group", "seller_business_backup", "system_platform_export"]) {
      expect(z2, f).toContain(`public.${f}(`);
    }
    expect(z2).toContain("b42609b64d8771f1792a09b344ba80de");
    expect(z2).toContain("307e1c10a99afdaa683292e2a495e8ad");
  });
});

describe("both numbers start the same run", () => {
  it("0181 and 0182 name the same preflight, run and postflight", () => {
    for (const n of ["0181", "0182"]) {
      expect(PLANS[n], n).toMatchObject({
        preflight: "0181-0182_preflight.sql", lauf: "staging-0181-0182.sql", postflight: "0181-0182_postflight.sql",
      });
    }
  });

  it("'applied' means both: the table AND the platform export of 0182", () => {
    for (const n of ["0181", "0182"]) {
      expect(PLANS[n].angewendet.sql).toContain("to_regclass('public.sale_item_corrections') is not null");
      expect(PLANS[n].angewendet.sql).toContain("307e1c10a99afdaa683292e2a495e8ad");
    }
  });
});
