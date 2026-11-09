import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  BACKUP_FORMAT_VERSION, BACKUP_SECTIONS, FORBIDDEN_FIELDS, SALE_ITEM_CORRECTIONS_SECTIONS,
} from "./manifest";
import {
  PLATFORM_FORMAT_VERSION, PLATFORM_SECTIONS, SECTIONS_BY_FORMAT_VERSION,
} from "./platform-manifest";
import { columnsOf, latestFunction } from "@/test-support/migrations";

/**
 * Migration `0182` — the hand corrections of `0181` (`sale_item_corrections`)
 * in BOTH backups.
 *
 * Same handling as `0174`: the bodies are not retyped but copied, and this
 * file recomputes that on every test run.
 *
 *   1. The fingerprints (old = 0174's, new = 0182's) match the latches.
 *   2. The new bodies MINUS the inserted area (and, for the platform export,
 *      minus the two changed lines) are character for character 0174's.
 *   3. Every column of the table is decided: ten exported, `corrected_by`
 *      (account identity) and `source_row` (legacy machinery) out.
 *   4. `R0182` restores exactly 0174's bodies, and runs before `R0181`.
 *
 * Real PostgreSQL — both bodies created, one correction exported through
 * both and restored from the archive — is probe P82 in
 * `tools/validate-check-sql.mts` (`npm run verify:check-sql`).
 */

const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");
const read = (p: string) => readFileSync(p, "utf8");

const M0174 = "supabase/migrations/0174_backup_sales_reconciliation.sql";
const M0182 = "supabase/migrations/0182_backup_sale_item_corrections.sql";
const R0182 = "supabase/rollback/R0182_backups_without_sale_item_corrections.sql";
const R0181 = "supabase/rollback/R0181_legacy_sale_item_corrections.sql";

const B_OLD = "3a798f506f5f43e5b1b69dc242a1b16f";
const P_OLD = "23be72d581589b063d6938a863757b31";
const B_NEW = "b42609b64d8771f1792a09b344ba80de";
const P_NEW = "307e1c10a99afdaa683292e2a495e8ad";

/** The body exactly as `pg_proc.prosrc` stores it. */
function body(file: string, fn: string): string {
  const sql = read(file);
  const from = sql.indexOf(`create or replace function public.${fn}()`);
  expect(from, `${file}: no definition of ${fn}`).toBeGreaterThan(-1);
  const a = sql.indexOf("as $$", from) + "as $$".length;
  const b = sql.indexOf("\n$$;", a);
  return sql.slice(a, b + 1);
}

const B_OLD_BODY = body(M0174, "seller_business_backup");
const B_NEW_BODY = body(M0182, "seller_business_backup");
const P_OLD_BODY = body(M0174, "system_platform_export");
const P_NEW_BODY = body(M0182, "system_platform_export");

const areas = (s: string) => (s.match(/coalesce\(\(/g) ?? []).length;
const SECTION = SALE_ITEM_CORRECTIONS_SECTIONS[0];

/** From the area's comment line up to (not including) the area after it. */
function insertedBlock(newBody: string, indent: number, nextArea: string): string {
  const a = newBody.indexOf(`${" ".repeat(indent)}/* ----------- Hand corrections of workbook positions (0181, 0182) */\n`);
  const b = newBody.indexOf(`${" ".repeat(indent)}'${nextArea}', coalesce((\n`, a);
  expect(a, "block comment not found").toBeGreaterThan(-1);
  expect(b, "area after the block not found").toBeGreaterThan(a);
  return newBody.slice(a, b);
}

function areaFields(src: string): string[] {
  const a = src.indexOf("'sale_item_corrections', coalesce((");
  const b = src.indexOf("from public.sale_item_corrections t", a);
  return [...src.slice(a, b).matchAll(/^\s+'([a-z_0-9]+)', (t\.[a-z_0-9]+)/gm)].map((m) => `${m[1]}=${m[2]}`);
}

describe("the fingerprints", () => {
  it("the old bodies are 0174's — the ones 0182 requires", () => {
    expect(md5(B_OLD_BODY)).toBe(B_OLD);
    expect(md5(P_OLD_BODY)).toBe(P_OLD);
    expect([areas(B_OLD_BODY), areas(P_OLD_BODY)]).toEqual([35, 61]);
  });

  it("the new bodies are the ones 0182 promises", () => {
    expect(md5(B_NEW_BODY)).toBe(B_NEW);
    expect(B_NEW_BODY.length).toBe(27009);
    expect(areas(B_NEW_BODY)).toBe(36);
    expect(md5(P_NEW_BODY)).toBe(P_NEW);
    expect(P_NEW_BODY.length).toBe(36366);
    expect(areas(P_NEW_BODY)).toBe(62);
  });

  it("the migration holds the latches: 0181 required, 0174's bodies required, a second run bounces", () => {
    const sql = read(M0182);
    expect(sql).toContain("0182 needs 0181: public.sale_item_corrections is missing");
    expect(sql).toContain(`if v_business is distinct from '${B_OLD}' then`);
    expect(sql).toContain(`if v_platform is distinct from '${P_OLD}' then`);
    expect(sql).toContain(`if v_business = '${B_NEW}' or v_platform = '${P_NEW}' then`);
    expect(sql).toContain(`if md5(v_src) is distinct from '${B_NEW}' or length(v_src) <> 27009 then`);
    expect(sql).toContain(`if md5(v_src) is distinct from '${P_NEW}' or length(v_src) <> 36366 then`);
    expect(sql.slice(0, sql.indexOf("do $pre$"))).toContain("NOT APPLIED — neither on Staging nor on Production.");
  });

  it("latestFunction() sees 0182 as the newest version of both functions", () => {
    expect(latestFunction("seller_business_backup").file).toBe("0182_backup_sale_item_corrections.sql");
    expect(latestFunction("system_platform_export").file).toBe("0182_backup_sale_item_corrections.sql");
  });
});

describe("new = 0174 + exactly the one area", () => {
  it("business: taken out again, the rest is 0174's body; it sits between the reconciliation and orders", () => {
    const block = insertedBlock(B_NEW_BODY, 6, "orders");
    expect(B_NEW_BODY.replace(block, "")).toBe(B_OLD_BODY);
    expect([...block.matchAll(/^ {6}'([a-z_0-9]+)', coalesce\(\($/gm)].map((m) => m[1])).toEqual(["sale_item_corrections"]);
    const keys = BACKUP_SECTIONS.map((s) => s.key);
    expect(keys.slice(keys.indexOf("sales_recon_applications") + 1, keys.indexOf("sales_recon_applications") + 3))
      .toEqual(["sale_item_corrections", "orders"]);
  });

  it("business: format_version stays 1 — a new area does not raise it (ADR-0114)", () => {
    expect(B_NEW_BODY).toContain("'format_version',  1,");
    expect(BACKUP_FORMAT_VERSION).toBe(1);
  });

  it("platform: taken out again, plus the two changed lines back, the rest is 0174's body", () => {
    const block = insertedBlock(P_NEW_BODY, 8, "seller_monthly_reports");
    const back = P_NEW_BODY.replace(block, "")
      .replace("'format_version', 4,", "'format_version', 3,")
      .replace("Lager und Orderbuch — 21 Bereiche, 42 Argumente", "Lager und Orderbuch — 20 Bereiche, 40 Argumente");
    expect(back).toBe(P_OLD_BODY);
    const keys = PLATFORM_SECTIONS.map((s) => s.key);
    const at = keys.indexOf("sales_recon_applications");
    expect(keys.slice(at + 1, at + 3)).toEqual(["sale_item_corrections", "seller_monthly_reports"]);
  });

  it("platform: format_version 4 with 62 sections, older archives stay readable", () => {
    expect(P_NEW_BODY).toContain("'format_version', 4,");
    expect(PLATFORM_FORMAT_VERSION).toBe(4);
    expect(SECTIONS_BY_FORMAT_VERSION).toEqual({ 1: 53, 2: 54, 3: 61, 4: 62 });
    expect(SECTIONS_BY_FORMAT_VERSION[4]).toBe(PLATFORM_SECTIONS.length);
    expect(SECTIONS_BY_FORMAT_VERSION[3]).toBe(PLATFORM_SECTIONS.length - 1);
  });

  it("the block keeps the body one statement and adds no forbidden word", () => {
    for (const block of [insertedBlock(B_NEW_BODY, 6, "orders"), insertedBlock(P_NEW_BODY, 8, "seller_monthly_reports")]) {
      expect(block).not.toContain(";");
      for (const w of ["with ", "union", "lateral", "execute", "format(", "restore", "import", "upsert",
                       "on conflict", "is_platform_admin", "can_operate"]) {
        expect(block.toLowerCase().includes(w), w).toBe(false);
      }
    }
  });
});

describe("every column of sale_item_corrections is decided", () => {
  it("fields + exclusions = the columns of 0181, nothing twice", () => {
    const decided = [...SECTION.fields, ...Object.keys(SECTION.excluded ?? {})].sort();
    expect(decided).toEqual([...columnsOf("sale_item_corrections")].sort());
    expect(SECTION.fields.filter((f) => f in (SECTION.excluded ?? {}))).toEqual([]);
  });

  it("restore-relevant: the original figure lives only here, and the sync guard of 0181 reads it", () => {
    expect(SECTION.restoreRelevant).toBe(true);
    expect(SECTION.fields).toEqual(expect.arrayContaining(["sale_item_id", "old_sky_id", "old_raw_name", "new_sky_id", "action"]));
  });

  it("out by existing rule: corrected_by (account identity) and source_row (legacy machinery)", () => {
    expect(SECTION.excluded).toEqual({ corrected_by: "Kontoidentität", source_row: "Zeilennummer in der alten Arbeitsmappe" });
    expect(FORBIDDEN_FIELDS.source_row).toBeDefined();
  });

  it("both manifests carry the SAME section — one constant", () => {
    expect(BACKUP_SECTIONS.find((s) => s.key === SECTION.key)).toBe(SECTION);
    expect(PLATFORM_SECTIONS.find((s) => s.key === SECTION.key)).toBe(SECTION);
  });

  for (const [name, src] of [["business", B_NEW_BODY], ["platform", P_NEW_BODY]] as const) {
    it(`${name}: exactly the manifest fields, sorted by id, from its own table, no excluded column`, () => {
      expect(areaFields(src)).toEqual(SECTION.fields.map((f) => `${f}=t.${f}`));
      const a = src.indexOf("'sale_item_corrections', coalesce((");
      const area = src.slice(a, src.indexOf("), '[]'::jsonb)", a));
      expect(area).toContain(") order by t.id)");
      expect(area).toContain("from public.sale_item_corrections t");
      expect(area).not.toMatch(/'corrected_by'|'source_row'/);
    });
  }
});

describe("the rollback R0182", () => {
  const sql = read(R0182);

  it("restores 0174's bodies character for character, with their comments", () => {
    expect(body(R0182, "seller_business_backup")).toBe(B_OLD_BODY);
    expect(body(R0182, "system_platform_export")).toBe(P_OLD_BODY);
    const comment = (f: string, fn: string) => {
      const s = read(f);
      const c = s.indexOf(`comment on function public.${fn}() is`);
      return s.slice(c, s.indexOf("';\n", c) + 3);
    };
    for (const fn of ["seller_business_backup", "system_platform_export"]) {
      expect(sql).toContain(comment(M0174, fn));
    }
  });

  it("refuses a third version, touches no row and no table, and comes before R0181", () => {
    expect(sql).toContain(`elsif v_business is distinct from '${B_NEW}' then`);
    expect(sql).toContain(`elsif v_platform is distinct from '${P_NEW}' then`);
    expect(sql).not.toMatch(/^\s*(drop|delete|truncate|insert|update)\b/im);
    expect(sql).toContain("run THIS before `R0181`");
    expect(read(M0182)).toContain("It must run BEFORE\n-- `R0181`");
    expect(read(R0181)).toContain("drop table");
  });
});
