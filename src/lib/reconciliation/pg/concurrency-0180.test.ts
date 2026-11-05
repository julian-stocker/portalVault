/**
 * 0180 under REAL concurrency (ADR-0178, variant C): a real PostgreSQL
 * server, several real connections, the unchanged 0180.
 *
 *   npm run test:recon-pg        (RECON_REAL_PG=1; skipped in `npm test`)
 *
 * ISOLATED. The test starts its own cluster in a fresh temporary directory
 * (`initdb`, `pg_ctl`), reachable ONLY through a Unix socket in that
 * directory (`listen_addresses = ''` — no TCP port at all), and deletes it
 * afterwards. No Supabase, no Staging, no network. The binaries come from
 * `RECON_PG_BIN` (default: Homebrew's `postgresql@17`).
 *
 * THE WORLD is the one the PGlite tests run (`reconciliationWorldScripts`):
 * the same stubbed identity, the Orderbuch functions word for word, the
 * migrations 0169–0180 as files. What changes is the server — and that two
 * transactions can now really meet.
 *
 * WHAT IT CANNOT SHOW: Supabase's PostgREST, its pooler and its roles. Two
 * HTTP calls end up as two transactions on the database; the locking they
 * meet is PostgreSQL's, which this test exercises — but the path in front
 * of it is not this test's.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RECONCILIATION_MIGRATIONS, reconciliationWorldScripts } from "../sql/schema";
import { analyseSpecs, decideOn, findingOf, type FindingRow, seedSales, type Spec } from "../sql/session-fixture";

const ENABLED = process.env.RECON_REAL_PG === "1";
const BIN = process.env.RECON_PG_BIN ?? "/usr/local/opt/postgresql@17/bin";
const WITH_0180 = [...RECONCILIATION_MIGRATIONS, "0175_sales_recon_account_deletion.sql",
  "0176_sales_recon_validate_before_dedup.sql", "0178_sales_recon_comparison_and_pending.sql",
  "0179_sales_recon_ledger_proof.sql", "0180_sales_recon_selected_apply.sql"] as const;

// Numbers as numbers, days and times as the text PostgreSQL sends — as PGlite gives them.
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));
for (const oid of [1082, 1114, 1184]) pg.types.setTypeParser(oid, (v) => v);

const X = "60-00000-00001";
const Y = "60-00000-00002";
const SPECS: Spec[] = [
  { ref: X, sold: "2026-03-10", shipping: 4.99, lines: [{ character: "Eruptor", unit: 9 }],
    ledger: { sold: "2026-03-09", subtotal: 8, shipping: 5.49, pieces: ["Eruptor"], carriesRef: true } },
  { ref: Y, sold: "2026-03-12", lines: [{ character: "Zap", unit: 7 }],
    ledger: { sold: "2026-03-11", subtotal: 7, pieces: ["Zap"], carriesRef: true } },
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
/** The session-fixture helpers take any client with `query(sql, params) → {rows}`. */
const asDb = (c: pg.Client) => c as unknown as PGlite;
const one = async <T>(c: pg.Client, sql: string, params: unknown[] = []): Promise<T> =>
  Object.values((await c.query(sql, params)).rows[0] ?? {})[0] as T;

type Outcome = { ok: true; value: unknown } | { ok: false; code: string; message: string };
const outcome = (p: Promise<pg.QueryResult>): Promise<Outcome> =>
  p.then((r) => ({ ok: true as const, value: Object.values(r.rows[0] ?? {})[0] }),
    (e: { code?: string; message?: string }) => ({ ok: false as const, code: e.code ?? "?", message: e.message ?? "" }));

const applySql = `select public.seller_recon_apply($1, $2::bigint[], $3)`;
const previewSql = `select public.seller_recon_preview($1, $2::bigint[])`;

/** Wait until `pid` waits on a lock — the proof that the second transaction really met the first. */
async function waitsOnLock(observer: pg.Client, pid: number): Promise<string> {
  for (let i = 0; i < 200; i += 1) {
    const r = await observer.query(`select wait_event_type, wait_event from pg_stat_activity where pid = $1`, [pid]);
    if (r.rows[0]?.wait_event_type === "Lock") return r.rows[0].wait_event as string;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`backend ${pid} never waited on a lock`);
}

describe.skipIf(!ENABLED)("0180 on a real PostgreSQL server, several connections", { timeout: 60_000 }, () => {
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
    database = `recon_${n}`;
    const root = await connect("postgres");
    await root.query(`create database ${database}`);
    await root.end();
    clients.splice(clients.indexOf(root), 1);
    admin = await connect();
    for (const script of reconciliationWorldScripts(WITH_0180)) await admin.query(script);
    await seedSales(asDb(admin), SPECS);
    session = await analyseSpecs(asDb(admin), SPECS);
    [a, b, observer] = [await connect(), await connect(), await connect()];
    // Asked BEFORE b blocks: a query on a waiting connection would queue behind its own wait.
    bPid = await one<number>(b, `select pg_backend_pid()`);
  }, 120_000);

  afterEach(async () => {
    for (const c of clients.splice(0)) await c.end().catch(() => {});
  });

  const finding = (ref: string, field: string, s = session): Promise<FindingRow> => findingOf(asDb(admin), s, ref, field);
  const take = async (ref: string, field: string, s = session): Promise<number> =>
    Number(await decideOn(asDb(admin), await finding(ref, field, s), "take_external"));
  const preview = async (ids: number[], s = session) => one<{ token: string; admissible: boolean; changes: { problem: string | null }[] }>(
    admin, previewSql, [s, ids]);
  const applications = (decision: number) => one<number>(admin, `select count(*)::int from public.sales_recon_applications where decision_id = $1`, [decision]);

  it("the same selection twice at once: the second waits, then finds it applied — exactly one application", async () => {
    const d = await take(X, "sold_on");
    const p = await preview([d]);
    await a.query("begin");
    await a.query(applySql, [session, [d], p.token]);
    const second = outcome(b.query(applySql, [session, [d], p.token]));
    expect(await waitsOnLock(observer, bPid)).toMatch(/transactionid|tuple/);
    await a.query("commit");
    const r = await second;
    expect(r.ok).toBe(false);
    expect(r.ok === false && [r.code, r.message.includes("already_applied")]).toEqual(["PT409", true]);
    expect(await applications(d)).toBe(1);
    expect(await one(admin, `select count(*)::int from public.orderbook_audit where field = 'sold_at'`)).toBe(1);
  });

  it("the session is locked while it applies: a decision of the same session waits, then goes through", async () => {
    const d = await take(X, "sold_on");
    const other = await finding(Y, "sold_on");
    const p = await preview([d]);
    await a.query("begin");
    await a.query(applySql, [session, [d], p.token]);
    const deciding = outcome(b.query(`select public.seller_recon_decide($1, 'take_external', null, null, $2::jsonb, $3::jsonb)`,
      [other.id, JSON.stringify(other.ledger_value), JSON.stringify(other.external_value)]));
    await waitsOnLock(observer, bPid);
    await a.query("commit");
    const r = await deciding;
    expect(r.ok).toBe(true);
    expect(await applications(d)).toBe(1);
  });

  it("two applies over the same two sales in opposite order: no deadlock — the second waits, then is stale", async () => {
    const s2 = await analyseSpecs(asDb(admin), SPECS, "c");
    const x1 = await take(X, "sold_on");
    const y1 = await take(Y, "sold_on");
    const y2 = await take(Y, "sold_on", s2);
    const x2 = await take(X, "sold_on", s2);
    const p1 = await preview([x1, y1]);
    const p2 = await preview([y2, x2], s2);
    await a.query("begin");
    await a.query(applySql, [session, [x1, y1], p1.token]);
    await b.query("begin");
    const crossing = outcome(b.query(applySql, [s2, [y2, x2], p2.token]));
    await waitsOnLock(observer, bPid);
    await a.query("commit");
    const r = await crossing;
    await b.query("rollback");
    expect(r.ok === false && r.code).not.toBe("40P01");
    expect(r.ok === false && [r.code, r.message.includes("stale")]).toEqual(["PT409", true]);
    expect([await applications(x1), await applications(y1), await applications(x2), await applications(y2)]).toEqual([1, 1, 0, 0]);
  });

  it("a sale changed by another transaction while the apply waits: PT409, nothing applied", async () => {
    const d = await take(X, "sold_on");
    const p = await preview([d]);
    const saleId = await one<number>(admin, `select id from public.sales where external_order_ref = $1`, [X]);
    await a.query("begin");
    await a.query(`select public.seller_update_sale(p_id => $1, p_note => 'anderswo')`, [saleId]);
    const applying = outcome(b.query(applySql, [session, [d], p.token]));
    await waitsOnLock(observer, bPid);
    await a.query("commit");
    const r = await applying;
    expect(r.ok === false && [r.code, r.message.includes("stale")]).toEqual(["PT409", true]);
    expect(await applications(d)).toBe(0);
    expect(await one(admin, `select sold_at from public.sales where id = $1`, [saleId])).toBe("2026-03-09");
  });

  it("a preview token outlived by a committed change elsewhere: PT409; a fresh preview says stale", async () => {
    const d = await take(X, "sold_on");
    const p = await preview([d]);
    const saleId = await one<number>(admin, `select id from public.sales where external_order_ref = $1`, [X]);
    await b.query(`select public.seller_update_sale(p_id => $1, p_note => 'zwischendurch')`, [saleId]);
    const r = await outcome(a.query(applySql, [session, [d], p.token]));
    expect(r.ok === false && r.code).toBe("PT409");
    const fresh = await preview([d]);
    expect([fresh.admissible, fresh.changes[0].problem]).toEqual([false, "stale"]);
    expect(await applications(d)).toBe(0);
  });

  it("one decision, many attempts on many connections: exactly one application", async () => {
    const d = await take(X, "sold_on");
    const p = await preview([d]);
    const extra = [await connect(), await connect(), await connect()];
    const results = await Promise.all([a, b, ...extra].map((c) => outcome(c.query(applySql, [session, [d], p.token]))));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    for (const r of results.filter((x) => !x.ok)) expect(r.ok === false && r.code).toBe("PT409");
    expect(await applications(d)).toBe(1);
  });
});

describe("the isolation of the real-server test", () => {
  it("is opt-in and never opens a TCP port", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/reconciliation/pg/concurrency-0180.test.ts", "utf8");
    expect(src).toContain('process.env.RECON_REAL_PG === "1"');
    expect(src).toContain("listen_addresses=''");
    expect(src).toMatch(/new pg\.Client\(\{ host: dir, port, user: "postgres"/);
    expect(src).not.toMatch(/supabase\.co|\.env\.staging|\.env\.local|DATABASE_?URL/);
  });
});
