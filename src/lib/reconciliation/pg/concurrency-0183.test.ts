/**
 * 0183 under REAL concurrency: a real PostgreSQL server, two real
 * connections, the unchanged 0183 — the same isolated cluster as
 * `concurrency-0180.test.ts` (Unix socket only, temporary directory, deleted
 * afterwards; no Supabase, no Staging, no network).
 *
 *   npm run test:recon-pg        (RECON_REAL_PG=1; skipped in `npm test`)
 *
 * The claim: two "Als offene Bestellung anlegen" for the same order at the
 * same moment create ONE sale. The second waits on the order row the first
 * locked, and when the first commits it finds the sale and answers `exists`.
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

const REF = "06-14518-99785";
const SPECS: Spec[] = [{ ref: REF, sold: "2026-04-16", shipping: 5.49,
  lines: [{ character: "Cynder", unit: 0.95 }, { character: "Dino-Rang", unit: 2.32 }], ledger: null }];
const PIECES = JSON.stringify([{ line: 0, skyId: "SKY-0150" }, { line: 1, skyId: "SKY-0021" }]);

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

describe.skipIf(!ENABLED)("0183 on a real PostgreSQL server, two connections", { timeout: 60_000 }, () => {
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
  let order: number;
  let bPid: number;

  beforeEach(async () => {
    n += 1;
    database = `recon83_${n}`;
    const root = await connect("postgres");
    await root.query(`create database ${database}`);
    await root.end();
    clients.splice(clients.indexOf(root), 1);
    admin = await connect();
    for (const script of reconciliationWorldScripts(WITH_0180)) await admin.query(script);
    await admin.query(WORKFLOW);
    await admin.query(readFileSync("supabase/migrations/0183_recon_create_open_sale.sql", "utf8"));
    await admin.query(`insert into public.skylanders (sky_id, name, series_code) values
      ('SKY-0150', 'Cynder', 'SG'), ('SKY-0021', 'Dino-Rang', 'SSA')`);
    await seedSales(asDb(admin), SPECS);
    const session = await analyseSpecs(asDb(admin), SPECS);
    order = await one<number>(admin, `select id from public.sales_recon_orders where session_id = $1 and order_ref = $2`, [session, REF]);
    [a, b, observer] = [await connect(), await connect(), await connect()];
    bPid = await one<number>(b, `select pg_backend_pid()`);
  }, 120_000);

  afterEach(async () => {
    for (const c of clients.splice(0)) await c.end().catch(() => {});
  });

  const createSql = `select public.seller_recon_create_sale($1, $2::jsonb)`;

  it("the same order twice at once: the second waits on the order row, then answers exists — one sale", async () => {
    await a.query("begin");
    const first = await one<{ status: string; sale_id: number }>(a, createSql, [order, PIECES]);
    const second = b.query(createSql, [order, PIECES]);
    expect(await waitsOnLock(observer, bPid)).toMatch(/transactionid|tuple/);
    await a.query("commit");
    const r = Object.values((await second).rows[0])[0] as { status: string; sale_id: number };
    expect(first.status).toBe("created");
    expect(r).toEqual({ status: "exists", sale_id: first.sale_id });
    expect(await one(admin, `select count(*)::int from public.sales where external_order_ref = $1`, [REF])).toBe(1);
    expect(await one(admin, `select count(*)::int from public.sale_items where sale_id = $1`, [first.sale_id])).toBe(2);
  });

  it("the first rolls back: the second, released, creates the one sale itself", async () => {
    await a.query("begin");
    await a.query(createSql, [order, PIECES]);
    const second = b.query(createSql, [order, PIECES]);
    await waitsOnLock(observer, bPid);
    await a.query("rollback");
    const r = Object.values((await second).rows[0])[0] as { status: string };
    expect(r.status).toBe("created");
    expect(await one(admin, `select count(*)::int from public.sales where external_order_ref = $1`, [REF])).toBe(1);
  });
});
