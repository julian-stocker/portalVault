/**
 * Both backups, run against the PRODUCTION schema with the NEW code (Production release F0, 2026-11-12).
 *
 * The release brings the code of `development/skyisles-v2` to Production, but
 * only 0190 and 0191 — not 0168–0189. Production therefore keeps the backup
 * functions of 0140 (`seller_business_backup`) and 0164
 * (`system_platform_export`); 0174 and 0182 replaced both on Staging only.
 * This file answers, without a database connection, what that means:
 *
 *   1. Which body Production runs — the newest definition among the
 *      migrations applied there (`APPLIED.md`, measured 2026-11-12).
 *   2. Which areas that body exports, read from its SQL, and which areas of
 *      the new code's manifest it lacks: exactly the seven of 0174 and the one
 *      of 0182, whose tables do not exist on Production. Nothing that exists
 *      there is left out.
 *   3. That the new code accepts what that body delivers: the platform archive
 *      certifies format version 2 with 54 areas (the database states the
 *      version, the code only knows how many areas it promises), and the
 *      business download passes the document through unchanged.
 *
 * WHAT THIS DOES NOT SHOW: that a restore works. None exists for either
 * format (`restore_supported: false`), and no restore from Production data
 * has ever been run (M-03). A successful export is a file, not a recovery.
 */
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { sectionCounts, withRouteMetadata } from "./document";
import {
  BACKUP_SECTIONS, SALE_ITEM_CORRECTIONS_SECTIONS, SALES_RECONCILIATION_SECTIONS,
} from "./manifest";
import { authInventoryDocument, platformArchive, type PlatformExportDocument } from "./platform-archive";
import { PLATFORM_SECTIONS, SECTIONS_BY_FORMAT_VERSION } from "./platform-manifest";

const DIR = "supabase/migrations";

/**
 * The migrations Production carries after the release: everything up to
 * 0167, minus the four never applied there (0134, 0150, 0151; 0166 by
 * decision, ADR-0167), plus 0190 and 0191. Measured read-only on 2026-11-12:
 * the objects of 0168–0191 are absent on Production.
 */
const NOT_ON_PRODUCTION = new Set(["0134", "0150", "0151", "0166"]);
const PRODUCTION_FILES = readdirSync(DIR)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort()
  .filter((f) => {
    const n = f.slice(0, 4);
    if (NOT_ON_PRODUCTION.has(n)) return false;
    return Number(n) <= 167 || n === "0190" || n === "0191";
  });

function newestBody(files: readonly string[], fn: string): { file: string; body: string } {
  for (let i = files.length - 1; i >= 0; i--) {
    const sql = readFileSync(`${DIR}/${files[i]}`, "utf8");
    const start = sql.lastIndexOf(`create or replace function public.${fn}()`);
    if (start === -1) continue;
    const end = sql.indexOf("\n$$;", start);
    return { file: files[i], body: sql.slice(start, end) };
  }
  throw new Error(`no Production migration defines public.${fn}()`);
}

/** The area keys of a body, as both backup bodies write them (one per line). */
const areaKeys = (body: string, indent: number) =>
  [...body.matchAll(new RegExp(`^ {${indent}}'([a-z_0-9]+)', coalesce\\(\\($`, "gm"))].map((m) => m[1]);

const NEW_0174 = new Set(SALES_RECONCILIATION_SECTIONS.map((s) => s.key));
const NEW_0182 = new Set(SALE_ITEM_CORRECTIONS_SECTIONS.map((s) => s.key));
const ONLY_ON_STAGING = new Set([...NEW_0174, ...NEW_0182]);

/** Tables the migrations create — to show the missing areas have no table on Production. */
function tablesCreatedIn(files: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const f of files) {
    for (const m of readFileSync(`${DIR}/${f}`, "utf8").matchAll(/create table (?:if not exists )?public\.([a-z_0-9]+)/g)) out.add(m[1]);
  }
  return out;
}
const PRODUCTION_TABLES = tablesCreatedIn(PRODUCTION_FILES);

describe("which backup bodies Production runs after the release", () => {
  it("is the migration set described (0190 and 0191 in, 0168–0189 out)", () => {
    expect(PRODUCTION_FILES).toContain("0167_ovp_removal.sql");
    expect(PRODUCTION_FILES.some((f) => f.startsWith("0190_"))).toBe(true);
    expect(PRODUCTION_FILES.some((f) => f.startsWith("0191_"))).toBe(true);
    expect(PRODUCTION_FILES.filter((f) => /^01(6[89]|7\d|8\d)_/.test(f))).toEqual([]);
  });

  it("platform export: 0164; business backup: 0140 — neither 0174 nor 0182", () => {
    expect(newestBody(PRODUCTION_FILES, "system_platform_export").file).toBe("0164_platform_export_types.sql");
    expect(newestBody(PRODUCTION_FILES, "seller_business_backup").file).toBe("0140_business_backup_sale_release.sql");
  });
});

describe("the platform export on Production", () => {
  const { body } = newestBody(PRODUCTION_FILES, "system_platform_export");
  const keys = areaKeys(body, 8);

  it("states format version 2 and exports 54 areas — the count the new code expects for version 2", () => {
    expect(body).toMatch(/'format_version', 2\b/);
    expect(keys).toHaveLength(54);
    expect(SECTIONS_BY_FORMAT_VERSION[2]).toBe(54);
  });

  it("lacks exactly the 7 areas of 0174 and the 1 of 0182 — and their tables do not exist on Production", () => {
    const manifest = PLATFORM_SECTIONS.map((s) => s.key);
    const missing = manifest.filter((k) => !keys.includes(k));
    expect(new Set(missing)).toEqual(ONLY_ON_STAGING);
    expect(keys.filter((k) => !manifest.includes(k))).toEqual([]);
    for (const k of missing) {
      const source = PLATFORM_SECTIONS.find((s) => s.key === k)!.source;
      expect(PRODUCTION_TABLES.has(source), `${source} would exist on Production`).toBe(false);
    }
  });

  it("is certified by the new code: the archive is built and counts 54 areas", async () => {
    const document: PlatformExportDocument = {
      format_version: 2, created_at: "2026-11-12T12:00:00Z", commerce_mode: "live",
      data: Object.fromEntries(keys.map((k) => [k, []])),
    };
    const archive = platformArchive({
      document, auth: authInventoryDocument([]), listed: [], expected: [],
      bytes: async () => new Uint8Array(0), sourceProject: "zmiwxswrpkmizvqsgype",
    });
    for await (const entry of archive.entries()) void entry;
    expect(archive.outcome().sectionCount).toBe(54);
    expect(archive.outcome().manifest.format_version).toBe(2);
  });

  it("negative control: version 2 with one area missing is refused, not shipped", () => {
    const document: PlatformExportDocument = {
      format_version: 2, data: Object.fromEntries(keys.slice(1).map((k) => [k, []])),
    };
    expect(() => platformArchive({
      document, auth: authInventoryDocument([]), listed: [], expected: [],
      bytes: async () => new Uint8Array(0), sourceProject: "zmiwxswrpkmizvqsgype",
    })).toThrow(/Formatversion 2, führt aber 53 Bereiche statt 54/);
  });
});

describe("the business backup on Production", () => {
  const { body } = newestBody(PRODUCTION_FILES, "seller_business_backup");
  const keys = areaKeys(body, 6);

  it("exports 28 areas — the new manifest minus exactly the areas of 0174 and 0182, whose tables do not exist there", () => {
    expect(keys).toHaveLength(28);
    const manifest = BACKUP_SECTIONS.map((s) => s.key);
    const missing = manifest.filter((k) => !keys.includes(k));
    expect(new Set(missing)).toEqual(ONLY_ON_STAGING);
    expect(keys.filter((k) => !manifest.includes(k))).toEqual([]);
    for (const k of missing) {
      const source = BACKUP_SECTIONS.find((s) => s.key === k)!.source;
      expect(PRODUCTION_TABLES.has(source), `${source} would exist on Production`).toBe(false);
    }
  });

  it("the download route passes the database's document through; only source_project and counts are added", () => {
    const document = { format_version: 1, data: Object.fromEntries(keys.map((k) => [k, [{ id: 1 }]])) };
    const shipped = withRouteMetadata(document, "zmiwxswrpkmizvqsgype");
    expect(shipped.data).toBe(document.data);
    expect(Object.keys(sectionCounts(shipped))).toHaveLength(28);
    expect(Object.keys(shipped).sort()).toEqual(["counts", "data", "format_version", "source_project"]);
  });

  it("the route does not check the document against the code's manifest — nothing there can reject an older body", () => {
    const route = readFileSync("src/app/(business)/business/datensicherung/download/route.ts", "utf8");
    expect(route).not.toMatch(/BACKUP_SECTIONS|manifest/);
    expect(route).toContain('supabase.rpc("seller_business_backup")');
  });
});
