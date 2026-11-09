import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  BACKUP_FORMAT_VERSION, BACKUP_SECTIONS, FORBIDDEN_FIELDS, SALES_RECONCILIATION_SECTIONS,
} from "./manifest";
import {
  PLATFORM_FORMAT_VERSION, PLATFORM_SECTIONS, SECTIONS_BY_FORMAT_VERSION,
} from "./platform-manifest";
import { columnsOf, latestFunction } from "@/test-support/migrations";

/**
 * Migration `0174` — the sales reconciliation of `0169` in BOTH backups.
 *
 * `0174` replaces the two functions that are our only self-held backups
 * (Supabase Free: no native backups, no PITR). Same handling as `0144`,
 * `0153`, `0160` and `0164`: the bodies are not retyped but copied, and this
 * file recomputes that on every test run.
 *
 *   1. All four fingerprints (old and new, both functions) match the latches
 *      in the migration.
 *   2. The new bodies MINUS the inserted block (and, for the platform export,
 *      minus the two changed lines) are character for character the old
 *      ones. Any further change anywhere in ~58 000 characters shows up here.
 *   3. Every column of the seven tables is decided: exported, or excluded
 *      with a reason. The only excluded business column is
 *      `sales_recon_orders.lines`; the rest are the five account identities.
 *   4. `R0174` restores exactly the old bodies.
 *
 * WHAT IS NOT CHECKED HERE: that the bodies are created with these
 * fingerprints in a real PostgreSQL. `npm run verify:check-sql` plans the
 * migration against the stub schema; the real run is the operator's.
 */

const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");
const read = (p: string) => readFileSync(p, "utf8");

const M0140 = "supabase/migrations/0140_business_backup_sale_release.sql";
const M0164 = "supabase/migrations/0164_platform_export_types.sql";
const M0174 = "supabase/migrations/0174_backup_sales_reconciliation.sql";
const R0174 = "supabase/rollback/R0174_backups_without_sales_reconciliation.sql";

const B_OLD = "a32b148cebe00ee0d0d469f96fd2028e";
const B_NEW = "3a798f506f5f43e5b1b69dc242a1b16f";
const P_OLD = "7e9e58e2d84a9f8a7c660262aa21926b";
const P_NEW = "23be72d581589b063d6938a863757b31";

/** The body exactly as `pg_proc.prosrc` stores it: from after `as $$` up to and including the `\n` before `$$;`. */
function body(file: string, fn: string): string {
  const sql = read(file);
  const from = sql.indexOf(`create or replace function public.${fn}()`);
  expect(from, `${file}: no definition of ${fn}`).toBeGreaterThan(-1);
  const a = sql.indexOf("as $$", from) + "as $$".length;
  const b = sql.indexOf("\n$$;", a);
  return sql.slice(a, b + 1);
}

const RECON_KEYS = SALES_RECONCILIATION_SECTIONS.map((s) => s.key);

const B_OLD_BODY = body(M0140, "seller_business_backup");
const B_NEW_BODY = body(M0174, "seller_business_backup");
const P_OLD_BODY = body(M0164, "system_platform_export");
const P_NEW_BODY = body(M0174, "system_platform_export");

const areas = (s: string) => (s.match(/coalesce\(\(/g) ?? []).length;
/** Business field lines, the counting rule of `0140`: ten spaces, a quoted key. */
const businessFieldLines = (s: string) => s.split("\n").filter((l) => /^ {10}'[a-z_0-9]+',/.test(l));

/** The contiguous inserted block: from its comment to the area after the last new one. */
function insertedBlock(newBody: string, commentStart: string, nextArea: string): string {
  const a = newBody.indexOf(commentStart);
  const b = newBody.indexOf(nextArea, a);
  expect(a, "block comment not found").toBeGreaterThan(-1);
  expect(b, "area after the block not found").toBeGreaterThan(a);
  return newBody.slice(a, b);
}

/** One area's output fields, read from a body (key line through `from public.<t> t`). */
function areaFields(src: string, key: string): string[] {
  const a = src.indexOf(`'${key}', coalesce((`);
  expect(a, `${key} is no area`).toBeGreaterThan(-1);
  const b = src.indexOf(`from public.${key} t`, a);
  return [...src.slice(a, b).matchAll(/^\s+'([a-z_0-9]+)', (t\.[a-z_0-9]+(?:::text)?)/gm)]
    .map((m) => `${m[1]}=${m[2]}`);
}

/* ==========================================================================
 * 1. The fingerprints
 * ======================================================================== */

describe("the four fingerprints", () => {
  it("the business body from 0140 is the one 0174 requires", () => {
    expect(md5(B_OLD_BODY)).toBe(B_OLD);
    expect(B_OLD_BODY.length).toBe(21622);
    expect(areas(B_OLD_BODY)).toBe(28);
    expect(businessFieldLines(B_OLD_BODY)).toHaveLength(356);
  });

  it("the platform body from 0164 is the one 0174 requires", () => {
    expect(md5(P_OLD_BODY)).toBe(P_OLD);
    expect(P_OLD_BODY.length).toBe(31248);
    expect(areas(P_OLD_BODY)).toBe(54);
  });

  it("the new bodies are the ones 0174 promises", () => {
    expect(md5(B_NEW_BODY)).toBe(B_NEW);
    expect(B_NEW_BODY.length).toBe(26388);
    expect(areas(B_NEW_BODY)).toBe(35);
    expect(businessFieldLines(B_NEW_BODY)).toHaveLength(436);
    expect(md5(P_NEW_BODY)).toBe(P_NEW);
    expect(P_NEW_BODY.length).toBe(35715);
    expect(areas(P_NEW_BODY)).toBe(61);
  });

  it("the migration holds the latches: previous body required, second run bounces", () => {
    const sql = read(M0174);
    expect(sql).toContain(`if v_business is distinct from '${B_OLD}' then`);
    expect(sql).toContain(`if v_platform is distinct from '${P_OLD}' then`);
    expect(sql).toContain(`if v_business = '${B_NEW}' or v_platform = '${P_NEW}' then`);
    /* The postcondition checks the new fingerprints and lengths. */
    expect(sql).toContain(`if md5(v_src) is distinct from '${B_NEW}' or length(v_src) <> 26388 then`);
    expect(sql).toContain(`if md5(v_src) is distinct from '${P_NEW}' or length(v_src) <> 35715 then`);
    /* And an older platform body gets its own message. */
    for (const older of ["2e2da90e976a1e73ca00aba7cd830fae", "4c4d2e7c81e4efa8e18cdffa06bba40a",
                         "92c48444f99b9e294f9703d0c0ddeaa8", "ff4f38e61cbd4e5857ea914d6be68d44"]) {
      expect(sql).toContain(`'${older}'`);
    }
  });

  it("the precondition demands every table of 0169 and the column lines", () => {
    const sql = read(M0174);
    for (const t of RECON_KEYS) expect(sql).toContain(`'${t}'`);
    expect(sql).toContain("0174 needs 0169: public.% is missing");
    expect(sql).toContain("0174 needs 0169: sales_recon_orders.lines is missing");
  });

  it("the header carries the banner, the fingerprints and the rollback", () => {
    const sql = read(M0174);
    const head = sql.slice(0, sql.indexOf("do $pre$"));
    expect(head).toContain("NOT APPLIED — neither on Staging nor on Production.");
    for (const f of [B_OLD, B_NEW, P_OLD, P_NEW]) expect(head).toContain(f);
    expect(head).toContain("supabase/rollback/R0174_backups_without_sales_reconciliation.sql");
  });

  it("latestFunction() sees 0182 as the newest version of both functions — 0174 plus one area", () => {
    // Since 0182 (hand corrections of workbook positions) the live bodies are
    // 0174's plus one area each; `backup-sale-item-corrections.test.ts` proves it.
    expect(latestFunction("seller_business_backup").file).toBe("0182_backup_sale_item_corrections.sql");
    expect(latestFunction("system_platform_export").file).toBe("0182_backup_sale_item_corrections.sql");
  });
});

/* ==========================================================================
 * 2. New = old + exactly the block
 * ======================================================================== */

describe("the business backup is the body from 0140 plus one block", () => {
  const block = insertedBlock(B_NEW_BODY,
    "      /* ------------------------------ Sales reconciliation (0169, 0174) */\n",
    "      'orders', coalesce((\n");

  it("taken out again, the rest is character for character the old body", () => {
    const back = B_NEW_BODY.replace(block, "");
    expect(back).toBe(B_OLD_BODY);
    expect(md5(back)).toBe(B_OLD);
  });

  it("the block holds exactly the seven areas, in manifest order", () => {
    const keys = [...block.matchAll(/^ {6}'([a-z_0-9]+)', coalesce\(\($/gm)].map((m) => m[1]);
    expect(keys).toEqual(RECON_KEYS);
    expect(businessFieldLines(block)).toHaveLength(80);
  });

  it("it sits between name_mappings and orders — as in the manifest", () => {
    const keys = BACKUP_SECTIONS.map((s) => s.key);
    const at = keys.indexOf("name_mappings");
    expect(keys.slice(at + 1, at + 8)).toEqual(RECON_KEYS);
    // Since 0182 the hand corrections follow, then orders.
    expect(keys.slice(at + 8, at + 10)).toEqual(["sale_item_corrections", "orders"]);
  });

  it("format_version stays 1 — a new area does not raise it (ADR-0114)", () => {
    expect(B_NEW_BODY).toContain("'format_version',  1,");
    expect(BACKUP_FORMAT_VERSION).toBe(1);
  });

  it("the block keeps the body one statement", () => {
    expect(block).not.toContain(";");
    expect((B_NEW_BODY.match(/;/g) ?? []).length).toBe(1);
  });
});

describe("the platform export is the body from 0164 plus one block and two lines", () => {
  const block = insertedBlock(P_NEW_BODY,
    "        /* Sales reconciliation (0169, added by 0174): seven sections. */\n",
    "        'seller_monthly_reports', coalesce((\n");

  it("taken out again and the two lines turned back, it is the old body", () => {
    const back = P_NEW_BODY.replace(block, "")
      .replace("    'format_version', 3,\n", "    'format_version', 2,\n")
      .replace("/* ---- Lager und Orderbuch — 20 Bereiche, 40 Argumente ---- */",
               "/* ---- Lager und Orderbuch — 13 Bereiche, 26 Argumente ---- */");
    expect(back).toBe(P_OLD_BODY);
    expect(md5(back)).toBe(P_OLD);
  });

  it("exactly two lines outside the block differ, and they are the expected two", () => {
    const outside = P_NEW_BODY.replace(block, "").split("\n");
    const old = P_OLD_BODY.split("\n");
    expect(outside).toHaveLength(old.length);
    const diff = outside.flatMap((l, i) => (l === old[i] ? [] : [`${old[i].trim()} -> ${l.trim()}`]));
    expect(diff).toEqual([
      "'format_version', 2, -> 'format_version', 3,",
      "/* ---- Lager und Orderbuch — 13 Bereiche, 26 Argumente ---- */ -> "
        + "/* ---- Lager und Orderbuch — 20 Bereiche, 40 Argumente ---- */",
    ]);
  });

  it("the block holds exactly the seven sections, in manifest order", () => {
    const keys = [...block.matchAll(/^ {8}'([a-z_0-9]+)', coalesce\(\($/gm)].map((m) => m[1]);
    expect(keys).toEqual(RECON_KEYS);
  });

  it("it sits between orderbook_audit and seller_monthly_reports — as in the manifest", () => {
    const keys = PLATFORM_SECTIONS.map((s) => s.key);
    const at = keys.indexOf("orderbook_audit");
    expect(keys.slice(at + 1, at + 8)).toEqual(RECON_KEYS);
    // Since 0182 the hand corrections follow, then seller_monthly_reports.
    expect(keys.slice(at + 8, at + 10)).toEqual(["sale_item_corrections", "seller_monthly_reports"]);
  });

  it("format_version 3 with 61 sections, and the map keeps it readable after 0182 (version 4)", () => {
    expect(P_NEW_BODY).toContain("'format_version', 3,");
    expect(PLATFORM_FORMAT_VERSION).toBe(4);
    expect(SECTIONS_BY_FORMAT_VERSION).toEqual({ 1: 53, 2: 54, 3: 61, 4: 62 });
    expect(SECTIONS_BY_FORMAT_VERSION[3]).toBe(PLATFORM_SECTIONS.length - 1);
    expect(PLATFORM_SECTIONS.length - 1 - RECON_KEYS.length).toBe(SECTIONS_BY_FORMAT_VERSION[2]);
  });

  it("the block keeps the body one statement and adds no forbidden word", () => {
    expect(block).not.toContain(";");
    for (const w of ["with ", "union", "lateral", "execute", "format(", "restore", "import",
                     "upsert", "on conflict", "is_platform_admin"]) {
      expect(block.toLowerCase().includes(w), w).toBe(false);
    }
  });
});

/* ==========================================================================
 * 3. Every column decided — and lines is the only business column left out
 * ======================================================================== */

describe("every column of the seven tables is decided", () => {
  const KONTO = ["created_by", "closed_by", "discarded_by", "decided_by", "applied_by"];

  for (const s of SALES_RECONCILIATION_SECTIONS) {
    it(`${s.key}: fields + exclusions = the columns of 0169, nothing twice`, () => {
      const decided = [...s.fields, ...Object.keys(s.excluded ?? {})].sort();
      expect(decided).toEqual([...columnsOf(s.source)].sort());
      expect(s.fields.filter((f) => f in (s.excluded ?? {}))).toEqual([]);
      expect(s.restoreRelevant).toBe(true);
      expect(s.personalData).toBeUndefined();
    });
  }

  it("the excluded columns are exactly lines and the five account identities", () => {
    const excluded = SALES_RECONCILIATION_SECTIONS.flatMap((s) =>
      Object.keys(s.excluded ?? {}).map((c) => `${s.source}.${c}`)).sort();
    expect(excluded).toEqual([
      "sales_recon_applications.applied_by",
      "sales_recon_decisions.decided_by",
      "sales_recon_orders.lines",
      "sales_recon_sessions.closed_by",
      "sales_recon_sessions.created_by",
      "sales_recon_sessions.discarded_by",
    ]);
  });

  it("each account identity is excluded as 'Kontoidentität', as everywhere else", () => {
    for (const s of SALES_RECONCILIATION_SECTIONS) {
      for (const [c, why] of Object.entries(s.excluded ?? {})) {
        if (KONTO.includes(c)) expect(why, `${s.key}.${c}`).toBe("Kontoidentität");
      }
    }
    /* And the business export forbids them outright. */
    for (const c of KONTO) expect(FORBIDDEN_FIELDS[c], c).toMatch(/^Kontoidentität/);
  });

  it("lines is excluded with a reason that says where the audit values are", () => {
    const why = SALES_RECONCILIATION_SECTIONS.find((s) => s.key === "sales_recon_orders")!
      .excluded!.lines;
    expect(why).toContain("sales_recon_findings");
    expect(why).toContain("löschbar");
  });

  it("both manifests carry the SAME seven sections — one constant", () => {
    for (const s of SALES_RECONCILIATION_SECTIONS) {
      expect(BACKUP_SECTIONS.find((x) => x.key === s.key)).toBe(s);
      expect(PLATFORM_SECTIONS.find((x) => x.key === s.key)).toBe(s);
    }
  });
});

describe("both bodies export exactly the manifest, lines nowhere", () => {
  const NUMERIC = new Set(["items_value", "shipping", "total", "score", "delta"]);

  for (const [name, src] of [["business", B_NEW_BODY], ["platform", P_NEW_BODY]] as const) {
    for (const s of SALES_RECONCILIATION_SECTIONS) {
      it(`${name}: ${s.key} — the manifest fields, numerics as text`, () => {
        expect(areaFields(src, s.key)).toEqual(s.fields.map((f) =>
          `${f}=t.${f}${NUMERIC.has(f) ? "::text" : ""}`));
      });
    }

    it(`${name}: sales_recon_orders carries no lines`, () => {
      const a = src.indexOf("'sales_recon_orders', coalesce((");
      const b = src.indexOf("from public.sales_recon_orders t", a);
      expect(src.slice(a, b)).not.toContain("'lines'");
    });

    it(`${name}: no account identity is exported`, () => {
      for (const c of ["created_by", "closed_by", "discarded_by", "decided_by", "applied_by"]) {
        expect(src, c).not.toContain(`'${c}',`);
      }
    });

    it(`${name}: every new area is sorted by id and reads only its own table`, () => {
      for (const k of RECON_KEYS) {
        const a = src.indexOf(`'${k}', coalesce((`);
        const b = src.indexOf("), '[]'::jsonb)", a);
        const area = src.slice(a, b);
        expect(area, k).toContain(") order by t.id)");
        expect([...area.matchAll(/from public\.([a-z_0-9]+)/g)].map((m) => m[1])).toEqual([k]);
      }
    });
  }

  it("the decision chain is complete in both archives", () => {
    /* decisions -> findings -> matches -> orders / sales, applications ->
       decisions / sessions / sales: every target is a section of both. */
    for (const target of ["sales_recon_findings", "sales_recon_matches", "sales_recon_orders",
                          "sales_recon_sessions", "sales_recon_decisions", "sales"]) {
      expect(BACKUP_SECTIONS.map((s) => s.source), target).toContain(target);
      expect(PLATFORM_SECTIONS.map((s) => s.source), target).toContain(target);
    }
  });
});

/* ==========================================================================
 * 4. What 0174 does not do, and the rollback
 * ======================================================================== */

describe("0174 writes nothing and changes no right", () => {
  const sql = read(M0174);
  const statements = sql
    /* Plain placeholders: `$$` in a replacement string would mean `$`. */
    .replace(/as \$\$[\s\S]*?\$\$;/g, "as BODY;")
    .replace(/do \$(pre|post)\$[\s\S]*?\$\1\$;/g, "do BLOCK;")
    .replace(/^\s*--.*$/gm, "");

  it("two create-or-replace, two comments, two DO blocks — nothing else", () => {
    const starts = statements.split("\n").filter((l) => /^[a-z]/.test(l));
    expect(starts.filter((l) => l.startsWith("create or replace function"))).toEqual([
      "create or replace function public.seller_business_backup()",
      "create or replace function public.system_platform_export()",
    ]);
    expect(starts.filter((l) => l.startsWith("comment on function"))).toHaveLength(2);
    expect(starts.filter((l) => l === "do BLOCK;")).toHaveLength(2);
    expect(starts.filter((l) => !/^(create or replace function|comment on function|do BLOCK;|returns|language|stable|security|set search_path|as BODY;)/.test(l)))
      .toEqual([]);
  });

  it("no DML, no DDL on a table, no grant or revoke", () => {
    for (const w of [/\binsert\s+into\b/i, /\bupdate\s+public\./i, /\bdelete\s+from\b/i,
                     /\btruncate\b/i, /\balter\s+table\b/i, /\bdrop\s+/i, /\bgrant\s+/i,
                     /\brevoke\s+/i, /\bcreate\s+table\b/i]) {
      expect(statements, String(w)).not.toMatch(w);
    }
  });
});

describe("the rollback R0174", () => {
  const sql = read(R0174);

  it("restores both previous bodies character for character", () => {
    expect(body(R0174, "seller_business_backup")).toBe(B_OLD_BODY);
    expect(body(R0174, "system_platform_export")).toBe(P_OLD_BODY);
    expect(md5(body(R0174, "seller_business_backup"))).toBe(B_OLD);
    expect(md5(body(R0174, "system_platform_export"))).toBe(P_OLD);
  });

  it("restores the previous comments too", () => {
    const comment = (file: string, fn: string) => {
      const s = read(file);
      const j = s.indexOf(`comment on function public.${fn}() is`);
      return s.slice(j, s.indexOf("';\n", j) + 2);
    };
    expect(comment(R0174, "seller_business_backup")).toBe(comment(M0140, "seller_business_backup"));
    expect(comment(R0174, "system_platform_export")).toBe(comment(M0164, "system_platform_export"));
  });

  it("knows both fingerprints of each function and overwrites no third version", () => {
    for (const f of [B_OLD, B_NEW, P_OLD, P_NEW]) expect(sql).toContain(`'${f}'`);
    expect(sql).toContain("A third version is not overwritten blindly.");
  });

  it("goes one step back, not two, and leaves the tables of 0169 alone", () => {
    expect(sql).toContain("sale_released from 0140 is gone — one step too many");
    expect(sql).toContain("the type fields from 0164 are gone — one step too many");
    const code = sql.replace(/as \$\$[\s\S]*?\$\$;/g, "").replace(/^\s*--.*$/gm, "");
    expect(code).not.toMatch(/\bdrop\s+(table|column|function)\b/i);
    expect(code).not.toMatch(/\balter\s+table\b/i);
    expect(code).not.toMatch(/^\s*(insert|update|delete)\b/im);
  });

  it("says it must run before the tables of 0169 are dropped", () => {
    expect(sql).toContain("run THIS before any rollback that drops the tables of `0169`");
  });
});
