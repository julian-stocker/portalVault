/**
 * The one Staging run for 0169–0174 — and the proof that it does nothing of
 * its own.
 *
 * Embedded code is a copy, and a copy drifts: the operator would then run
 * something that is no longer the tested migration. So every embedded section
 * is compared with its file, character for character (the same assurance as
 * `src/lib/catalog/staging-oneshot.test.ts` gives the earlier runs).
 *
 * And the wrapper itself runs on PostgreSQL: with a stamped database and a
 * sales book that must not move, and without the stamp, where it must stop.
 * 0174 is cut out of that run — its latches need the real 0140/0164 backup
 * bodies, which probe P74 in `tools/validate-check-sql.mts` provides.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { one, reconciliationWorld, scriptFailsWith } from "./schema";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const RUN = readFileSync("supabase/operations/staging-0169-0170-0171-0172-0173-0174.sql", "utf8");
const GROUP = [
  "0169_sales_reconciliation_schema.sql",
  "0170_external_sale_cancel.sql",
  "0171_external_order_ref_per_channel.sql",
  "0172_sales_reconciliation_rpcs.sql",
  "0173_sales_reconciliation_apply.sql",
  "0174_backup_sales_reconciliation.sql",
];

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

  it("and nothing else is embedded, in exactly this order", () => {
    const marks = [...RUN.matchAll(/^-- >>> EINGEBETTET: supabase\/migrations\/(\S+)$/gm)].map((m) => m[1]);
    expect(marks).toEqual(GROUP);
  });
});

describe("the frame: one transaction, Staging only", () => {
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

  it("sets a lock and a statement limit", () => {
    expect(RUN).toContain("set local lock_timeout");
    expect(RUN).toContain("set local statement_timeout");
  });

  it("measures the sales book before and after and stops on any movement", () => {
    expect(RUN.indexOf("create temporary table recon_lauf_vorher")).toBeLessThan(RUN.indexOf(start(GROUP[0])));
    expect(RUN.indexOf("ABBRUCH Z1")).toBeGreaterThan(RUN.indexOf(end(GROUP[5])));
  });
});

describe("the wrapper on PostgreSQL (0174 cut out, see P74)", () => {
  /** The run without 0174 and without its two fingerprint checks. */
  const without0174 = () => {
    const a = RUN.indexOf(start(GROUP[5]));
    const b = RUN.indexOf(end(GROUP[5])) + end(GROUP[5]).length;
    return (RUN.slice(0, a) + RUN.slice(b)).replace(
      /  if md5\(\(select prosrc from pg_proc where oid = to_regprocedure\('public\.seller_business_backup\(\)'\)\)\)[\s\S]*?end if;\n/,
      "");
  };

  it("runs through on a stamped database and leaves a filled sales book exactly as it was", async () => {
    const db = await reconciliationWorld({ migrations: [] });
    await db.exec(`comment on database postgres is 'skyisles-staging qqxcpesbwfxzgytkdsac'`);
    await db.exec(`insert into public.sales (channel, sold_at, items_subtotal, source) values ('ebay', '2026-02-01', 5, 'excel_order_2026');
                   insert into public.sale_items (sale_id, raw_name) values (1, 'Swarm');
                   insert into public.inventory_movements (note) values ('x');
                   insert into public.legacy_stock_events (note) values ('y');`);
    const books = () => one<string>(db, `select md5((select string_agg(to_jsonb(s)::text, ';') from public.sales s)
      || (select string_agg(to_jsonb(i)::text, ';') from public.sale_items i))`);
    const before = await books();
    expect(await scriptFailsWith(db, without0174())).toBe("ok");
    expect(await one(db, `select count(*)::int from pg_class where relname like 'sales\\_recon\\_%' and relkind = 'r'`)).toBe(7);
    expect(await books()).toBe(before);
    await db.close();
  });

  it("a second paste after a successful run bounces as a whole — nothing is applied twice", async () => {
    const db = await reconciliationWorld({ migrations: [] });
    await db.exec(`comment on database postgres is 'skyisles-staging qqxcpesbwfxzgytkdsac'`);
    expect(await scriptFailsWith(db, without0174())).toBe("ok");
    const objects = () => one<string>(db, `select count(*)::text || '/' || (select count(*) from pg_proc
      where proname like 'seller\\_recon\\_%' or proname like 'sales\\_recon\\_%')::text
      from pg_class where relname like 'sales\\_recon\\_%'`);
    const before = await objects();
    expect(await scriptFailsWith(db, without0174())).toBe("P0001");
    expect(await objects()).toBe(before);
    await db.close();
  });

  it("stops at once without the Staging stamp — and leaves nothing behind", async () => {
    const db = await reconciliationWorld({ migrations: [] });
    expect(await scriptFailsWith(db, without0174())).toBe("P0001");
    expect(await one(db, `select to_regclass('public.sales_recon_sessions')`)).toBeNull();
    await db.close();
  });
});
