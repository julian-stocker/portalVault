/**
 * The 0176 refusal probe (`tools/verify-recon-refusals.mts`), locally.
 *
 * Its payloads run against real PostgreSQL with 0176 — so the probe cannot
 * claim a refusal the database would not give — and against 0172 alone,
 * where the known-upload refusals must FAIL: the probe sees the gap it was
 * written for. Its source is read for the rules that keep it safe.
 */

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asNewUpload, FORBIDDEN, FORBIDDEN_MARKERS, miniPayload, pickTestSale, validatorState,
} from "@/../tools/verify-recon-refusals.mts";
import { failsWith, one, RECONCILIATION_MIGRATIONS, reconciliationWorld } from "../sql/schema";
import { ledgerSale } from "./ledger-fixture";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const TOOL = readFileSync("tools/verify-recon-refusals.mts", "utf8");
const main = TOOL.slice(TOOL.indexOf("async function main()"));

describe("choosing the sale to lean on", () => {
  it("takes only a test sale of 2001 that is not cancelled — never a real one", () => {
    const real = ledgerSale({ id: 1, sold: "2001-03-01", pieces: ["Zap"] });
    const cancelled = ledgerSale({ id: 2, sold: "2001-03-01", isTest: true, cancelled: "2001-03-02", pieces: ["Zap"] });
    const other = ledgerSale({ id: 3, sold: "2026-03-01", isTest: true, pieces: ["Zap"] });
    const good = ledgerSale({ id: 9, sold: "2001-05-01", isTest: true, pieces: ["Zap"] });
    const better = ledgerSale({ id: 4, sold: "2001-06-01", isTest: true, pieces: ["Zap"] });
    expect(pickTestSale([real, cancelled, other])).toBeNull();
    expect(pickTestSale([real, good, better, cancelled, other])?.saleId).toBe(4);
  });
});

describe("the local half", () => {
  it("reads 0176 from the answer to the check function", () => {
    expect(validatorState({ code: "42501" })).toBe("present");
    expect(validatorState({ code: "PGRST202" })).toBe("missing");
    expect(validatorState(null)).toBe("open");
  });

  it("a new upload differs only in its file fingerprint", () => {
    const p = miniPayload("run1", { saleId: 7, soldOn: "2001-05-01", updatedAt: "2001-05-01T00:00:00+00:00" });
    const n = asNewUpload(p, "run1");
    expect(n.files[0].fingerprint).not.toBe(p.files[0].fingerprint);
    expect({ ...n, files: [] }).toEqual({ ...p, files: [] });
    expect(p.files[0].fileName.startsWith("verify-recon-")).toBe(true);
  });

  it("each forbidden content is one of the two the first run found", () => {
    const p = miniPayload("run1", { saleId: 7, soldOn: "2001-05-01", updatedAt: null });
    const texts = FORBIDDEN.map(([, spoil]) => { const c = structuredClone(p); spoil(c); return JSON.stringify(c); });
    expect(texts[0]).toContain('"buyerName"');
    expect(texts[1]).toContain("example.invalid");
    expect(FORBIDDEN_MARKERS).toEqual(["buyerName", "example.invalid"]);
  });
});

describe("the probe's payloads on PostgreSQL", () => {
  let db: PGlite;
  afterEach(async () => {
    await db.close();
  });

  async function testSale(): Promise<{ saleId: number; soldOn: string; updatedAt: string }> {
    const saleId = await one<number>(db, `insert into public.sales (channel, sold_at, items_subtotal, discount_amount,
      shipping_charged, is_test, note) values ('ebay', '2001-05-01', 1, 0, 0, true, 'verify:sales-reconciliation x case') returning id`);
    const updatedAt = await one<string>(db, `select to_jsonb(updated_at) #>> '{}' from public.sales where id = $1`, [saleId]);
    return { saleId, soldOn: "2001-05-01", updatedAt };
  }
  const create = (p: unknown) => failsWith(db, `select public.seller_recon_create($1::jsonb)`, [JSON.stringify(p)]);
  const session = (p: unknown) => one<number>(db, `select public.seller_recon_create($1::jsonb)`, [JSON.stringify(p)]);

  it("with 0176: the mini session is valid, all four refusals hold, nothing forbidden is stored, the repeat is the same session", async () => {
    db = await reconciliationWorld({ migrations: [...RECONCILIATION_MIGRATIONS, "0176_sales_recon_validate_before_dedup.sql"] });
    const valid = miniPayload("run1", await testSale());
    for (const [what, spoil] of FORBIDDEN) {
      const p = asNewUpload(valid, "run1");
      spoil(p);
      expect(await create(p), `${what} (new)`).toBe("23514");
    }
    expect(await one(db, `select count(*)::int from public.sales_recon_sessions`)).toBe(0);
    const id = await session(valid);
    const stored = () => one<string>(db, `select coalesce(string_agg(to_jsonb(o)::text, ';'), '') from public.sales_recon_orders o`);
    const before = await stored();
    for (const [what, spoil] of FORBIDDEN) {
      const p = structuredClone(valid);
      spoil(p);
      expect(await create(p), `${what} (known)`).toBe("23514");
    }
    expect(await stored()).toBe(before);
    for (const m of FORBIDDEN_MARKERS) expect(before).not.toContain(m);
    expect(await session(valid)).toBe(id);
    expect(await one(db, `select count(*)::int from public.sales_recon_findings`)).toBe(0);
    expect(await one(db, `select count(*)::int from public.sales_recon_decisions`)).toBe(0);
    await db.query(`select public.seller_recon_discard($1)`, [id]);
    expect(await one(db, `select state from public.sales_recon_sessions where id = $1`, [id])).toBe("discarded");
  });

  it("without 0176 the probe sees the gap: the known-upload refusals do not hold", async () => {
    db = await reconciliationWorld();
    const valid = miniPayload("run1", await testSale());
    await session(valid);
    for (const [what, spoil] of FORBIDDEN) {
      const p = structuredClone(valid);
      spoil(p);
      expect(await create(p), what).toBe("ok");
    }
  });
});

describe("the tool's rules, read as source", () => {
  it("checks the target is Staging first, drops the service-role key, and knows no Production path", () => {
    expect(main.indexOf('requireStaging("verify:recon-refusals")')).toBeLessThan(main.indexOf("createClient("));
    expect(main.indexOf("delete process.env.SUPABASE_SERVICE_ROLE_KEY")).toBeLessThan(main.indexOf("createClient("));
    for (const word of ["SERVICE_ROLE_KEY\")", "auth.admin", "createUser", "deleteUser", ".from(", "requireProduction",
      ".env.local", "zmiwxswrpkmizvqsgype", "seller_create_sale", "seller_update_sale", "seller_recon_decide",
      "seller_recon_apply", "seller_recon_close"]) {
      expect(TOOL, word).not.toContain(word);
    }
  });

  it("writes nothing in the dry run: every writing call comes after the dry-run return", () => {
    const dry = main.indexOf("if (!apply)");
    expect(dry).toBeGreaterThan(-1);
    for (const call of ['rpc("seller_recon_create"', 'rpc("seller_recon_discard"']) {
      const first = main.indexOf(call);
      expect(first, call).toBeGreaterThan(dry);
    }
    expect(main.slice(dry, main.indexOf('heading("1. Neue Uploads'))).toContain("return;");
  });

  it("checks every database call, and cleans nothing up on the way out", () => {
    expect(main).not.toMatch(/^\s*await op\.(rpc|auth)/m);
    const cleanup = main.slice(main.indexOf("} finally {"));
    expect(cleanup).not.toContain(".rpc(");
    expect(cleanup).toMatch(/check\(`mini session \$\{mini\} was left open`, false/);
  });

  it("never prints the credentials", () => {
    for (const line of main.split("\n").filter((l) => /console\.(log|error)|check\(|throw new Error/.test(l))) {
      expect(line, line).not.toMatch(/EMAIL|PASSWORD|signIn\.data/);
    }
  });
});
