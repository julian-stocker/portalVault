/**
 * 0186 under REAL concurrency: a real PostgreSQL server, several real
 * connections — the isolated cluster of `concurrency-0180.test.ts` (Unix
 * socket only, temporary directory).
 *
 *   npm run test:recon-pg        (RECON_REAL_PG=1; skipped in `npm test`)
 *
 * The claims: an excluded rival edited AT THE SAME MOMENT is waited for
 * (`for share`), and its new version refuses (`rivals_changed`) — no
 * exclusion of a version nobody saw; the same order confirmed twice at once
 * → the second waits on the order row and writes nothing more; a sale that
 * becomes a rival before the confirmation refuses it.
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

const P157 = "12-14570-08869";
const SPECS: Spec[] = [
  { ref: P157, sold: "2026-04-30", shipping: 5.49, lines: [{ character: "Warnado", unit: 4 }, { character: "Camo", unit: 5 }],
    ledger: { sold: "2026-04-30", subtotal: 9, pieces: ["Warnado", "Camo"] } },
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

describe.skipIf(!ENABLED)("0186 on a real PostgreSQL server, several connections", { timeout: 60_000 }, () => {
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
    database = `recon86_${n}`;
    const root = await connect("postgres");
    await root.query(`create database ${database}`);
    await root.end();
    clients.splice(clients.indexOf(root), 1);
    admin = await connect();
    for (const script of reconciliationWorldScripts(WITH_0180)) await admin.query(script);
    await admin.query(WORKFLOW);
    await admin.query(readFileSync("supabase/migrations/0186_recon_order_ref_with_exclusions.sql", "utf8"));
    await admin.query(`insert into public.skylanders (sky_id, name, series_code) values ('SKY-0014', 'Camo', 'SA'),
      ('SKY-0078', 'Warnado', 'SA'), ('SKY-0007', 'Bash', 'SA') on conflict do nothing`);
    await seedSales(asDb(admin), SPECS);
    session = await analyseSpecs(asDb(admin), SPECS);
    [a, b, observer] = [await connect(), await connect(), await connect()];
    bPid = await one<number>(b, `select pg_backend_pid()`);
  }, 120_000);

  afterEach(async () => {
    for (const c of clients.splice(0)) await c.end().catch(() => {});
  });

  const sale = async (soldAt: string, names: string[]) => {
    const id = await one<number>(admin, `insert into public.sales (channel, sold_at, source, items_subtotal, shipping_charged)
      values ('ebay', $1, 'manual', 5, 5.49) returning id`, [soldAt]);
    for (const [k, nm] of names.entries()) await admin.query(`insert into public.sale_items (sale_id, position, raw_name) values ($1, $2, $3)`, [id, k + 1, nm]);
    return id;
  };
  const order = () => one<number>(admin, `select id from public.sales_recon_orders where session_id = $1 and order_ref = $2`, [session, P157]);
  const paired = () => one<number>(admin, `select m.sale_id from public.sales_recon_matches m join public.sales_recon_orders o on o.id = m.order_id
    where o.order_ref = $1 and m.session_id = $2`, [P157, session]);
  const version = (id: number) => one<string>(admin, `select updated_at::text from public.sales where id = $1`, [id]);
  const confirmSql = `select public.seller_recon_confirm_order_ref($1, $2, $3::timestamptz, $4::jsonb, $5)`;
  const args = async (s157: number, rivals: number[]) => [await order(), s157, await version(s157),
    JSON.stringify({ sales: await Promise.all(rivals.map(async (id) => ({ id, updatedAt: await version(id) }))), orders: [] }), "Mai-Verkauf"];
  const outcome = (p: Promise<pg.QueryResult>) => p.then((r) => ({ ok: true as const, value: Object.values(r.rows[0])[0] }),
    (e: { code?: string; message?: string }) => ({ ok: false as const, code: e.code ?? "?", message: e.message ?? "" }));
  const ref = (id: number) => one<string | null>(admin, `select external_order_ref from public.sales where id = $1`, [id]);

  it("a rival edited at the same moment: the confirmation waits for it, then refuses (rivals_changed) — nothing written", async () => {
    const s157 = await paired();
    const r158 = await sale("2026-05-01", ["Camo", "Bash"]);
    const seen = await args(s157, [r158]);
    await a.query("begin");
    await a.query(`update public.sales set note = 'edited', updated_at = clock_timestamp() where id = $1`, [r158]);
    const confirm = outcome(b.query(confirmSql, seen));
    expect(await waitsOnLock(observer, bPid)).toMatch(/transactionid|tuple/);
    await a.query("commit");
    const r = await confirm;
    expect(r.ok === false && [r.code, r.message.includes("(rivals_changed)")]).toEqual(["23514", true]);
    expect(await ref(s157)).toBeNull();
    expect(await one(admin, `select count(*)::int from public.orderbook_audit where field = 'rival_excluded'`)).toBe(0);
  });

  it("the same confirmation twice at once: the second waits on the order row and writes nothing more", async () => {
    const s157 = await paired();
    const r158 = await sale("2026-05-01", ["Camo", "Bash"]);
    const seen = await args(s157, [r158]);
    await a.query("begin");
    await a.query(confirmSql, seen);
    const second = outcome(b.query(confirmSql, seen));
    await waitsOnLock(observer, bPid);
    await a.query("commit");
    const r = await second;
    // The sale's version moved with the first write: stale — or, had it not, `exists`. Never a second journal.
    expect(r.ok ? (r.value as { status: string }).status : r.code).toMatch(/PT409|exists/);
    expect(await ref(s157)).toBe(P157);
    expect(await one(admin, `select count(*)::int from public.orderbook_audit where field = 'rival_excluded'`)).toBe(1);
  });

  it("a sale that became a rival after the operator looked refuses the confirmation (rivals_changed)", async () => {
    const s157 = await paired();
    const r158 = await sale("2026-05-01", ["Camo", "Bash"]);
    const seen = await args(s157, [r158]);
    await sale("2026-05-02", ["Warnado"]); // committed before the confirmation runs
    const r = await outcome(b.query(confirmSql, seen));
    expect(r.ok === false && r.message.includes("(rivals_changed)")).toBe(true);
    expect(await ref(s157)).toBeNull();
  });
});
