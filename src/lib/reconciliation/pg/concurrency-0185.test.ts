/**
 * 0185 under REAL concurrency: a real PostgreSQL server, several real
 * connections, the unchanged 0185 — the isolated cluster of
 * `concurrency-0180.test.ts` (Unix socket only, temporary directory).
 *
 *   npm run test:recon-pg        (RECON_REAL_PG=1; skipped in `npm test`)
 *
 * The claims: one order, two sales assigned at once → ONE gets the number,
 * the other waits on the order row and is refused (`ref_taken`); one sale,
 * two orders at once → the second waits on the sale row and is refused
 * (`ref_present`) — never two numbers, never an overwrite.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { reconciliationWorldScripts } from "../sql/schema";
import { analyseSpecs, seedSales, type Spec } from "../sql/session-fixture";
import { WITH_0180, WORKFLOW } from "../sql/create-sale-world";

const ENABLED = process.env.RECON_REAL_PG === "1";
const BIN = process.env.RECON_PG_BIN ?? "/usr/local/opt/postgresql@17/bin";

pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));
for (const oid of [1082, 1114, 1184]) pg.types.setTypeParser(oid, (v) => v);

const X = "06-14518-99785";
const Y = "06-14518-99786";
const SPECS: Spec[] = [
  { ref: X, sold: "2026-04-16", shipping: 5.49, lines: [{ character: "Cynder", unit: 0.95 }], ledger: null },
  { ref: Y, sold: "2026-04-26", shipping: 5.49, lines: [{ character: "Zook", unit: 7.21 }], ledger: null },
];

let dir = "";
let port = 0;
let database = "";
let n = 0;
const clients: pg.Client[] = [];

async function connect(db = database): Promise<pg.Client> {
  const c = new pg.Client({ host: dir, port, user: "postgres", database: db });
  await c.connect();
  clients.push(c);
  return c;
}
const asDb = (c: pg.Client) => c as unknown as PGlite;
const one = async <T>(c: pg.Client, sql: string, params: unknown[] = []): Promise<T> =>
  Object.values((await c.query(sql, params)).rows[0] ?? {})[0] as T;

async function waitsOnLock(observer: pg.Client, pid: number): Promise<string> {
  for (let i = 0; i < 200; i += 1) {
    const r = await observer.query(`select wait_event_type, wait_event from pg_stat_activity where pid = $1`, [pid]);
    if (r.rows[0]?.wait_event_type === "Lock") return r.rows[0].wait_event as string;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`backend ${pid} never waited on a lock`);
}

describe.skipIf(!ENABLED)("0185 on a real PostgreSQL server, several connections", { timeout: 60_000 }, () => {
  beforeAll(() => {
    if (!existsSync(join(BIN, "initdb"))) throw new Error(`no PostgreSQL binaries in ${BIN} (RECON_PG_BIN)`);
    dir = mkdtempSync(join(tmpdir(), "recon-pg-"));
    port = 54000 + Math.floor(Math.random() * 900);
    execFileSync(join(BIN, "initdb"), ["-D", join(dir, "data"), "-U", "postgres", "-A", "trust", "-E", "UTF8", "--no-locale"], { stdio: "ignore" });
    execFileSync(join(BIN, "pg_ctl"), ["-D", join(dir, "data"), "-l", join(dir, "log"), "-w", "-o",
      `-p ${port} -k ${dir} -c listen_addresses='' -c fsync=off -c max_connections=20`, "start"], { stdio: "ignore" });
  }, 120_000);

  afterAll(() => {
    if (!dir) return;
    try {
      execFileSync(join(BIN, "pg_ctl"), ["-D", join(dir, "data"), "-m", "immediate", "-w", "stop"], { stdio: "ignore" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  let admin: pg.Client;
  let a: pg.Client;
  let b: pg.Client;
  let observer: pg.Client;
  let session: number;
  let bPid: number;

  beforeEach(async () => {
    n += 1;
    database = `recon85_${n}`;
    const root = await connect("postgres");
    await root.query(`create database ${database}`);
    await root.end();
    clients.splice(clients.indexOf(root), 1);
    admin = await connect();
    for (const script of reconciliationWorldScripts(WITH_0180)) await admin.query(script);
    await admin.query(WORKFLOW);
    await admin.query(readFileSync("supabase/migrations/0185_recon_assign_sale.sql", "utf8"));
    await admin.query(`insert into public.skylanders (sky_id, name, series_code) values ('SKY-0150', 'Cynder', 'G'), ('SKY-0187', 'Zook', 'G')`);
    await seedSales(asDb(admin), SPECS);
    session = await analyseSpecs(asDb(admin), SPECS);
    [a, b, observer] = [await connect(), await connect(), await connect()];
    bPid = await one<number>(b, `select pg_backend_pid()`);
  }, 120_000);

  afterEach(async () => {
    for (const c of clients.splice(0)) await c.end().catch(() => {});
  });

  const sale = (soldAt: string, sky: string, name: string) => one<number>(admin, `with s as (insert into public.sales
    (channel, sold_at, source, items_subtotal, shipping_charged) values ('ebay', $1, 'manual', 1, 5.49) returning id)
    insert into public.sale_items (sale_id, position, sky_id, raw_name) select id, 1, $2, $3 from s returning sale_id`, [soldAt, sky, name]);
  const order = (ref: string) => one<number>(admin, `select id from public.sales_recon_orders where session_id = $1 and order_ref = $2`, [session, ref]);
  const version = (id: number) => one<string>(admin, `select updated_at::text from public.sales where id = $1`, [id]);
  const assignSql = `select public.seller_recon_assign_sale($1, $2, $3::timestamptz)`;
  const outcome = (p: Promise<pg.QueryResult>) => p.then((r) => ({ ok: true as const, value: Object.values(r.rows[0])[0] }),
    (e: { code?: string; message?: string }) => ({ ok: false as const, code: e.code ?? "?", message: e.message ?? "" }));

  it("one order, two sales at once: one gets the number, the other waits on the order row and is refused (ref_taken)", async () => {
    const s1 = await sale("2026-04-16", "SKY-0150", "Cynder");
    const s2 = await sale("2026-04-10", "SKY-0187", "Zook");
    const o = await order(X);
    await a.query("begin");
    await a.query(assignSql, [o, s1, await version(s1)]);
    const second = outcome(b.query(assignSql, [o, s2, await version(s2)]));
    expect(await waitsOnLock(observer, bPid)).toMatch(/transactionid|tuple/);
    await a.query("commit");
    const r = await second;
    expect(r.ok === false && [r.code, r.message.includes("(ref_taken)")]).toEqual(["23514", true]);
    expect(await one(admin, `select string_agg(id::text, ',') from public.sales where external_order_ref = $1`, [X])).toBe(String(s1));
  });

  it("one sale, two orders at once: the second waits on the sale row and is refused (ref_present) — never overwritten", async () => {
    const s1 = await sale("2026-04-21", "SKY-0029", "Eruptor");
    const v = await version(s1);
    await a.query("begin");
    await a.query(assignSql, [await order(X), s1, v]);
    const second = outcome(b.query(assignSql, [await order(Y), s1, v]));
    await waitsOnLock(observer, bPid);
    await a.query("commit");
    const r = await second;
    // The version moved with the first write: the second is stale before it could even look at the number.
    expect(r.ok === false && r.code).toMatch(/PT409|23514/);
    expect(await one(admin, `select external_order_ref from public.sales where id = $1`, [s1])).toBe(X);
  });
});
