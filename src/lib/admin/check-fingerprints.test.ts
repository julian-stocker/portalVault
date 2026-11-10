/**
 * The body fingerprints the Staging check suite pins must be the bodies of
 * the LATEST migration that defines each function.
 *
 * Why this exists: on 2026-11-10 (M-05, F5) three check files reported
 * deviations on Staging although the database was right. `0168` had redefined
 * `admin_set_variant_base`, `0174` and `0182` had redefined
 * `system_platform_export` and `seller_business_backup` — and the checks still
 * expected the older bodies. Nothing in the test suite noticed, because the
 * existing tests compare each pinned value with the migration the CHECK names,
 * not with the newest one.
 *
 * This test recomputes, from the migration files alone, the body of the last
 * definition and demands that the checks accept exactly it. A future migration
 * that redefines one of these functions fails here until the check is updated
 * on evidence — it cannot drift silently again.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIG = "supabase/migrations";
const FILES = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");

/** `prosrc` of the last definition of `name`: the text between `as $tag$` and its closing tag. */
function latest(name: string): { file: string; md5: string } {
  const header = new RegExp(`create (?:or replace )?function public\\.${name}\\(`, "g");
  let found: { file: string; md5: string } | null = null;
  for (const file of FILES) {
    const sql = readFileSync(`${MIG}/${file}`, "utf8");
    for (const m of sql.matchAll(header)) {
      const open = /\bas\s+(\$[a-z_]*\$)/.exec(sql.slice(m.index));
      if (!open) throw new Error(`${file}: no body after ${name}`);
      const start = m.index + open.index + open[0].length;
      found = { file, md5: md5(sql.slice(start, sql.indexOf(open[1], start))) };
    }
  }
  if (!found) throw new Error(`no migration defines ${name}`);
  return found;
}

describe("cat08_applied_fingerprint.sql pins the latest body of every function it checks", () => {
  const CHECK = readFileSync("supabase/checks/cat08_applied_fingerprint.sql", "utf8");
  /* Every row of the form  to_regprocedure('public.NAME(...)')),  'md5'  — a body fingerprint. */
  const rows = [...CHECK.matchAll(/to_regprocedure\('public\.([a-z_0-9]+)\([^)]*\)'\)\),\s*'([0-9a-f]{32})'\)/g)]
    .map((m) => ({ name: m[1], pinned: m[2] }));

  it("finds the eight body rows (101, 111–117)", () => {
    expect(rows.map((r) => r.name)).toEqual([
      "admin_publish_variant_auto", "admin_set_variant_base", "admin_publish_with_base",
      "admin_create_character", "admin_set_character", "admin_publish_as_variant",
      "admin_set_catalog_status", "system_platform_export"]);
  });

  it.each(rows.map((r) => [r.name, r.pinned]))("%s: the pinned md5 is the last definition's", (name, pinned) => {
    const l = latest(name);
    expect(pinned, `${name} is last defined in ${l.file}`).toBe(l.md5);
  });

  it("names the evidence for the two rows moved on 2026-11-10", () => {
    expect(latest("admin_set_variant_base").file).toBe("0168_variant_family_inheritance.sql");
    expect(latest("system_platform_export").file).toBe("0182_backup_sale_item_corrections.sql");
  });
});

describe("the checks of seller_business_backup accept its latest body — and only the known ones", () => {
  const BODY = readFileSync("supabase/checks/0131_function_body_check.sql", "utf8");
  const PENDING = readFileSync("supabase/checks/staging_pending_migrations.sql", "utf8");
  const l = latest("seller_business_backup");

  it("the latest definition is 0182", () => {
    expect(l).toEqual({ file: "0182_backup_sale_item_corrections.sql", md5: "b42609b64d8771f1792a09b344ba80de" });
  });

  it("0131_function_body_check.sql: the latest body is a RELEASED state", () => {
    const row = new RegExp(`\\('${l.md5}',\\s*\\d+,\\s*'[0-9a-f]{32}',\\s*\\d+,\\s*\\d+,\\s*'([A-Z_0-9]+)',\\s*(true|false),\\s*\\d+\\)`).exec(BODY);
    expect(row, "the latest body is missing from the state table").not.toBeNull();
    expect(row![2]).toBe("true");
  });

  it("staging_pending_migrations.sql: the latest body is known and row 233 accepts it", () => {
    const known = new RegExp(`\\('${l.md5}', '(\\d{4})'\\)`).exec(PENDING);
    expect(known, "the latest body is missing from `bekannt`").not.toBeNull();
    const accepted = /when fassung in \(([^)]*)\) then 'ja'/.exec(PENDING)![1];
    expect(accepted).toContain(`'${known![1]}'`);
  });

  it("a superseded body is known but NOT accepted: 0174 in both files", () => {
    expect(BODY).toContain("'STAND_0174',               false, 35)");
    const accepted = /when fassung in \(([^)]*)\) then 'ja'/.exec(PENDING)![1];
    expect(PENDING).toContain("('3a798f506f5f43e5b1b69dc242a1b16f', '0174')");
    expect(accepted).not.toContain("'0174'");
  });
});
