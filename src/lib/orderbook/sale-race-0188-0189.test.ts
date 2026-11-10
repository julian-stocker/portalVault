/**
 * M-05C (2026-11-10) — deleting and cancelling a sale against a concurrent
 * booking, on a REAL PostgreSQL server with several real connections (the
 * isolated cluster of `concurrency-0180.test.ts`: Unix socket only, temporary
 * directory). Run with
 *   RECON_REAL_PG=1 npx vitest run src/lib/orderbook/sale-race-0188-0189.test.ts
 * skipped otherwise (and in `npm test`).
 *
 * Every function body comes WORD FOR WORD from its migration: booking, holding,
 * converting, releasing and adding (0110), the external cancel (0170, through
 * the reconciliation world), the delete (0110 — or 0188/0189 after the fix).
 * The world adds what the races depend on and the reconciliation world cuts
 * away: the cascading foreign keys of 0059 (sale_items → sales) and 0109
 * (order_reservations → sale_items) and the delete guard on reservations
 * (`reservations_deny_delete`, 0109). The stock ledger is the stand-in of
 * `create-sale-world.ts`; it updates the stock row, so it is a lock point like
 * the real `apply_inventory_movement` (`for update`).
 *
 * A third connection holds ONE lock to stop a call at a known point; the test
 * waits until the stopped connection really waits on a lock (pg_stat_activity)
 * before the next step. No timing, no sleeps.
 *
 * Each scenario runs twice: against the old bodies (what really happens) and
 * against 0188/0189 (what must happen). The invariants checked after every run:
 *   - every stock movement belongs to an existing sale position (no orphans);
 *   - stock: quantity = start − movements; reserved = Σ active holds;
 *   - a cancelled sale has no booked position.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { WITH_0180, WORKFLOW } from "../reconciliation/sql/create-sale-world";
import { body, reconciliationWorldScripts } from "../reconciliation/sql/schema";

const ENABLED = process.env.RECON_REAL_PG === "1";
const BIN = process.env.RECON_PG_BIN ?? "/usr/local/opt/postgresql@17/bin";
pg.types.setTypeParser(20, (v) => Number(v));

/* What the races depend on and the reconciliation world does not carry. */
const RACE_WORLD = `
-- the Supabase roles 0188/0189 grant to (cluster-wide: created once)
do $r$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $r$;
alter table public.sale_items drop constraint sale_items_sale_id_fkey;
alter table public.sale_items add constraint sale_items_sale_fk foreign key (sale_id) references public.sales (id) on delete cascade;
alter table public.order_reservations add column reverted_movement_id bigint;
alter table public.order_reservations add constraint order_reservations_sale_item_fk
  foreign key (sale_item_id) references public.sale_items (id) on update cascade on delete cascade;
${body("0109_external_hold_schema.sql", "reservations_deny_delete")}
create trigger order_reservations_no_delete before delete on public.order_reservations
  for each row execute function public.reservations_deny_delete();
${body("0110_external_hold_runtime.sql", "seller_add_sale_item")}
${body("0110_external_hold_runtime.sql", "seller_delete_sale")}
insert into public.skylanders (sky_id, name, series_code) values ('SKY-0001', 'Spyro', 'SA') on conflict do nothing;
insert into public.shop_inventory (sky_id, condition, quantity) values ('SKY-0001', 'loose', 5);
`;
const FIX = ["0188_sale_delete_lock_order.sql", "0189_external_cancel_lock_order.sql"]
  .map((f) => readFileSync(`supabase/migrations/${f}`, "utf8"));
const START_QUANTITY = 5;

let dir = "";
let port = 0;
let n = 0;
let database = "";
const clients: pg.Client[] = [];
async function connect(db = database): Promise<pg.Client> {
  const c = new pg.Client({ host: dir, port, user: "postgres", database: db });
  await c.connect();
  clients.push(c);
  return c;
}
const one = async <T>(c: pg.Client, sql: string, params: unknown[] = []): Promise<T> =>
  Object.values((await c.query(sql, params)).rows[0] ?? {})[0] as T;
type Outcome = { ok: true } | { ok: false; code: string; message: string };
const outcome = (p: Promise<unknown>): Promise<Outcome> => p.then(() => ({ ok: true as const }),
  (e: { code?: string; message?: string }) => ({ ok: false as const, code: e.code ?? "?", message: e.message ?? "" }));

/** Resolves once backend `pid` waits on a lock, or the call it runs has finished. */
async function stoppedOrDone(observer: pg.Client, pid: number, done: { v: boolean }): Promise<"waiting" | "done"> {
  for (let i = 0; i < 400; i += 1) {
    if (done.v) return "done";
    const r = await observer.query(`select wait_event_type from pg_stat_activity where pid = $1`, [pid]);
    if (r.rows[0]?.wait_event_type === "Lock") return "waiting";
    await new Promise((res) => setTimeout(res, 25));
  }
  throw new Error(`backend ${pid} neither waited nor finished`);
}
function tracked(p: Promise<Outcome>) {
  const done = { v: false };
  const result = p.finally(() => { done.v = true; });
  return { done, result };
}

describe.skipIf(!ENABLED)("M-05C: delete and cancel against a concurrent booking — real PostgreSQL", { timeout: 90_000 }, () => {
  beforeAll(() => {
    if (!existsSync(join(BIN, "initdb"))) throw new Error(`no PostgreSQL binaries in ${BIN} (RECON_PG_BIN)`);
    dir = mkdtempSync(join(tmpdir(), "sale-race-"));
    port = 54000 + Math.floor(Math.random() * 900);
    execFileSync(join(BIN, "initdb"), ["-D", join(dir, "data"), "-U", "postgres", "-A", "trust", "-E", "UTF8", "--no-locale"], { stdio: "ignore" });
    execFileSync(join(BIN, "pg_ctl"), ["-D", join(dir, "data"), "-l", join(dir, "log"), "-w", "-o",
      `-p ${port} -k ${dir} -c listen_addresses='' -c fsync=off -c max_connections=30 -c deadlock_timeout=200ms`, "start"], { stdio: "ignore" });
  }, 120_000);
  afterAll(() => {
    if (!dir) return;
    try { execFileSync(join(BIN, "pg_ctl"), ["-D", join(dir, "data"), "-m", "immediate", "-w", "stop"], { stdio: "ignore" }); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);
  afterEach(async () => { for (const c of clients.splice(0)) await c.end().catch(() => {}); });

  let admin: pg.Client, t1: pg.Client, t2: pg.Client, t3: pg.Client, observer: pg.Client;
  let pid1 = 0, pid2 = 0;

  async function world(fixed: boolean) {
    n += 1;
    database = `salerace_${n}`;
    const root = await connect("postgres");
    await root.query(`create database ${database}`);
    await root.end();
    clients.splice(clients.indexOf(root), 1);
    admin = await connect();
    for (const s of reconciliationWorldScripts(WITH_0180)) await admin.query(s);
    await admin.query(WORKFLOW);
    await admin.query(RACE_WORLD);
    if (fixed) for (const f of FIX) await admin.query(f);
    [t1, t2, t3, observer] = [await connect(), await connect(), await connect(), await connect()];
    pid1 = await one<number>(t1, "select pg_backend_pid()");
    pid2 = await one<number>(t2, "select pg_backend_pid()");
  }
  async function sale(positions: { hold: boolean }[]) {
    const s = await one<number>(admin, `insert into public.sales (channel, source, sold_at, items_subtotal)
      values ('ebay', 'manual', '2026-11-01', 10) returning id`);
    const items: number[] = [];
    for (const [k, p] of positions.entries()) {
      const i = await one<number>(admin, `insert into public.sale_items (sale_id, position, sky_id, raw_name, condition)
        values ($1, $2, 'SKY-0001', 'Spyro', 'loose') returning id`, [s, k + 1]);
      if (p.hold) expect(await one<string>(admin, "select public.hold_sale_item($1)", [i])).toBe("held");
      items.push(i);
    }
    return { s, items };
  }
  const lockStock = async (c: pg.Client) => { await c.query("begin"); await c.query("select 1 from public.shop_inventory for update"); };
  const lockHold = async (c: pg.Client, item: number) => {
    await c.query("begin");
    expect(await one<number>(c, "select count(*)::int from (select 1 from public.order_reservations where sale_item_id = $1 for update) x", [item])).toBe(1);
  };
  const book = (c: pg.Client, item: number) => outcome(c.query("select public.seller_book_sale_item($1)", [item]));
  const del = (c: pg.Client, s: number) => outcome(c.query("select public.seller_delete_sale($1)", [s]));
  const cancel = (c: pg.Client, s: number) => outcome(c.query("select public.seller_cancel_external_sale($1, 'Kunde storniert')", [s]));

  /* The invariants, as numbers the assertions can name. */
  async function state() {
    return {
      orphanMovements: await one<number>(admin, `select count(*)::int from public.inventory_movements m
        where not exists (select 1 from public.sale_items i where i.movement_id = m.id)`),
      movements: await one<number>(admin, "select count(*)::int from public.inventory_movements"),
      quantity: await one<number>(admin, "select quantity from public.shop_inventory"),
      reserved: await one<number>(admin, "select reserved from public.shop_inventory"),
      activeHolds: await one<number>(admin, "select coalesce(sum(quantity), 0)::int from public.order_reservations where state = 'active'"),
      cancelledWithBooking: await one<number>(admin, `select count(*)::int from public.sales s
        where s.cancelled_at is not null and exists (select 1 from public.sale_items i where i.sale_id = s.id and i.movement_id is not null)`),
      sales: await one<number>(admin, "select count(*)::int from public.sales"),
    };
  }
  const consistent = (st: Awaited<ReturnType<typeof state>>) => {
    expect(st.orphanMovements, "every movement belongs to a position").toBe(0);
    expect(st.quantity, "quantity = start − movements").toBe(START_QUANTITY - st.movements);
    expect(st.reserved, "reserved = Σ active holds").toBe(st.activeHolds);
    expect(st.cancelledWithBooking, "no cancelled sale with a booked position").toBe(0);
  };

  /* ------------------------------------------------------------------ R1 */
  describe("R1 delete ↔ book WITHOUT hold (a sale with one held and one unheld position)", () => {
    /* t3 holds the reservation of the held position B: the delete stops there,
       after it has already counted "no booked position". Meanwhile t1 books A. */
    async function run() {
      const { s, items: [a, b] } = await sale([{ hold: false }, { hold: true }]);
      await lockHold(t3, b);
      const d = tracked(del(t2, s));
      expect(await stoppedOrDone(observer, pid2, d.done)).toBe("waiting");
      const k = tracked(book(t1, a));
      const bookPhase = await stoppedOrDone(observer, pid1, k.done);
      await t3.query("rollback");
      return { s, bookPhase, del: await d.result, book: await k.result };
    }
    it("BEFORE (0110): REPRODUCED — the booking commits, the cascade deletes its position, the movement is orphaned", async () => {
      await world(false);
      const r = await run();
      expect(r.bookPhase).toBe("done");        // nothing stopped the booking
      expect(r.book.ok).toBe(true);
      expect(r.del.ok).toBe(true);              // and the delete went through anyway
      const st = await state();
      expect(st.sales).toBe(0);
      expect(st.orphanMovements).toBe(1);       // the defect
      expect(st.quantity).toBe(START_QUANTITY - 1);
    });
    it("AFTER (0188): the booking waits for the delete, then finds no position — no movement, stock untouched", async () => {
      await world(true);
      const r = await run();
      expect(r.bookPhase).toBe("waiting");      // the delete holds every position
      expect(r.del.ok).toBe(true);
      expect(r.book.ok).toBe(false);
      if (!r.book.ok) expect(r.book.message).toContain("no such sale item");
      const st = await state();
      consistent(st);
      expect(st.movements).toBe(0);
      expect(st.quantity).toBe(START_QUANTITY);
      expect(st.reserved).toBe(0);
    });
  });

  /* ------------------------------------------------------------------ R2 */
  describe("R2 delete ↔ book WITH hold", () => {
    /* t3 holds the stock row: the booking stops at its movement, already holding
       the position and the converted reservation. Then the delete starts. */
    async function run() {
      const { s, items: [a] } = await sale([{ hold: true }]);
      await lockStock(t3);
      const k = tracked(book(t1, a));
      expect(await stoppedOrDone(observer, pid1, k.done)).toBe("waiting");
      const d = tracked(del(t2, s));
      const delPhase = await stoppedOrDone(observer, pid2, d.done);
      await t3.query("rollback");
      return { delPhase, del: await d.result, book: await k.result };
    }
    it("BEFORE (0110): not reproducible as damage — the reservation guard makes the delete fail; consistent", async () => {
      await world(false);
      const r = await run();
      expect(r.book.ok).toBe(true);
      expect(r.del.ok).toBe(false);
      if (!r.del.ok) expect(r.del.message).toContain("a reservation is released, never deleted");
      const st = await state();
      consistent(st);
      expect(st.sales).toBe(1);
    });
    it("AFTER (0188): the delete refuses at once (55P03) instead of waiting; the booking completes", async () => {
      await world(true);
      const r = await run();
      expect(r.delPhase).toBe("done");
      expect(r.del.ok === false && r.del.code).toBe("55P03");
      expect(r.book.ok).toBe(true);
      consistent(await state());
    });
  });

  /* ------------------------------------------------------------------ R3 */
  describe("R3 cancel ↔ book WITHOUT hold", () => {
    async function run() {
      const { s, items: [a] } = await sale([{ hold: false }]);
      await lockStock(t3);
      const k = tracked(book(t1, a));
      expect(await stoppedOrDone(observer, pid1, k.done)).toBe("waiting");
      const c = tracked(cancel(t2, s));
      const cancelPhase = await stoppedOrDone(observer, pid2, c.done);
      await t3.query("rollback");
      return { cancelPhase, cancel: await c.result, book: await k.result };
    }
    it("BEFORE (0170): REPRODUCED — a cancelled sale with a booked position and its movement", async () => {
      await world(false);
      const r = await run();
      expect(r.cancelPhase).toBe("done");
      expect(r.cancel.ok).toBe(true);
      expect(r.book.ok).toBe(true);
      const st = await state();
      expect(st.cancelledWithBooking).toBe(1);   // the defect
    });
    it("AFTER (0189): the cancel refuses at once (55P03); the booking completes; the sale is not cancelled", async () => {
      await world(true);
      const r = await run();
      expect(r.cancelPhase).toBe("done");
      expect(r.cancel.ok === false && r.cancel.code).toBe("55P03");
      expect(r.book.ok).toBe(true);
      const st = await state();
      consistent(st);
      expect(await one(admin, "select cancelled_at from public.sales")).toBeNull();
    });
  });

  /* ------------------------------------------------------------------ R4 */
  describe("R4 cancel ↔ book WITH hold", () => {
    async function run() {
      const { s, items: [a] } = await sale([{ hold: true }]);
      await lockStock(t3);
      const k = tracked(book(t1, a));
      expect(await stoppedOrDone(observer, pid1, k.done)).toBe("waiting");
      const c = tracked(cancel(t2, s));
      const cancelPhase = await stoppedOrDone(observer, pid2, c.done);
      await t3.query("rollback");
      return { cancelPhase, cancel: await c.result, book: await k.result };
    }
    it("BEFORE (0170): REPRODUCED as a DEADLOCK — PostgreSQL aborts one of the two (40P01); the other's result is consistent", async () => {
      await world(false);
      const r = await run();
      const codes = [r.cancel, r.book].filter((o) => !o.ok).map((o) => (o.ok ? "" : o.code));
      expect(codes).toEqual(["40P01"]);
      consistent(await state());
    });
    it("AFTER (0189): no deadlock — the cancel refuses at once (55P03), the booking completes", async () => {
      await world(true);
      const r = await run();
      expect(r.cancelPhase).toBe("done");
      expect(r.cancel.ok === false && r.cancel.code).toBe("55P03");
      expect(r.book.ok).toBe(true);
      consistent(await state());
    });
  });

  /* ------------------------------------------------------- R5, R6, R7 */
  describe.each([["BEFORE (0110/0170)", false], ["AFTER (0188/0189)", true]] as const)("%s", (_label, fixed) => {
    it("R5 two deletes at once: the second waits, then deletes nothing; holds released exactly once", async () => {
      await world(fixed);
      const { s } = await sale([{ hold: true }, { hold: false }]);
      await t1.query("begin");
      expect((await del(t1, s)).ok).toBe(true);
      const d2 = tracked(del(t2, s));
      expect(await stoppedOrDone(observer, pid2, d2.done)).toBe("waiting");
      await t1.query("commit");
      expect((await d2.result).ok).toBe(true);
      const st = await state();
      consistent(st);
      expect(st.sales).toBe(0);
      expect(st.reserved).toBe(0);
      expect(st.quantity).toBe(START_QUANTITY);
    });
    it("R6 two cancels at once: the second waits, then refuses (already cancelled); holds released exactly once", async () => {
      await world(fixed);
      const { s } = await sale([{ hold: true }]);
      await t1.query("begin");
      expect((await cancel(t1, s)).ok).toBe(true);
      const c2 = tracked(cancel(t2, s));
      expect(await stoppedOrDone(observer, pid2, c2.done)).toBe("waiting");
      await t1.query("commit");
      const r2 = await c2.result;
      expect(r2.ok === false && r2.message).toContain("already cancelled");
      const st = await state();
      consistent(st);
      expect(st.reserved).toBe(0);
    });
    it("R7 delete ↔ a NEW position inserted (with hold) at the same moment: serialised by the sale row; consistent", async () => {
      await world(fixed);
      const { s } = await sale([{ hold: false }]);
      await t1.query("begin");
      await t1.query("select public.seller_add_sale_item($1, 'SKY-0001', 'Spyro', 'loose')", [s]);
      const d = tracked(del(t2, s));
      expect(await stoppedOrDone(observer, pid2, d.done)).toBe("waiting");   // on the new row's FOR KEY SHARE
      await t1.query("commit");
      const r = await d.result;
      const st = await state();
      consistent(st);
      if (fixed) {
        // the delete sees the new position after the insert committed and releases its hold
        expect(r.ok).toBe(true);
        expect(st.sales).toBe(0);
        expect(st.reserved).toBe(0);
      } else {
        // the old delete never saw it: the cascade hits the active hold and the guard stops it
        expect(r.ok === false && r.message).toContain("a reservation is released, never deleted");
        expect(st.sales).toBe(1);
      }
    });
  });

  /* ------------------------------------------------------------- rights */
  describe("rights and legitimate use after 0188/0189", () => {
    it("an operator still deletes and cancels; a non-operator is refused; anon may not execute", async () => {
      await world(true);
      const { s: s1 } = await sale([{ hold: true }]);
      expect((await cancel(admin, s1)).ok).toBe(true);
      const { s: s2 } = await sale([{ hold: true }]);
      expect((await del(admin, s2)).ok).toBe(true);
      await admin.query("update public.test_identity set operator = false");
      const { s: s3 } = await sale([{ hold: false }]);
      const refused = await del(admin, s3);
      expect(refused.ok === false && refused.message).toContain("seller operator role required");
      for (const sig of ["public.seller_delete_sale(bigint)", "public.seller_cancel_external_sale(bigint,text,date,timestamptz)"]) {
        expect(await one(admin, "select has_function_privilege('anon', $1, 'execute')", [sig]), sig).toBe(false);
        expect(await one(admin, "select has_function_privilege('authenticated', $1, 'execute')", [sig]), sig).toBe(true);
      }
      consistent(await state());
    });
    it("0189 refuses to run where 0170 is missing (Production) instead of creating the function", async () => {
      await world(false);
      await admin.query("drop function public.seller_cancel_external_sale(bigint, text, date, timestamptz)");
      const r = await outcome(admin.query(FIX[1]));
      expect(r.ok === false && r.message).toContain("0189 precondition");
      expect(await one(admin, "select to_regprocedure('public.seller_cancel_external_sale(bigint,text,date,timestamptz)') is null")).toBe(true);
    });
  });

  /* ------------------------------------------------- the Staging run files */
  describe("the Staging run files on a Staging-like database (stamp, Staging grants)", () => {
    const STAMP = "skyisles-staging qqxcpesbwfxzgytkdsac";
    const RUNS = { "0188": "public.seller_delete_sale(bigint)", "0189": "public.seller_cancel_external_sale(bigint,text,date,timestamptz)" } as const;
    const ROLLBACK = { "0188": "R0188_sale_delete_lock_order.sql", "0189": "R0189_external_cancel_lock_order.sql" } as const;
    const md5 = (sig: string) => one<string>(admin, "select md5(prosrc) from pg_proc where oid = to_regprocedure($1)", [sig]);
    const acl = (sig: string) => one<string>(admin, "select proacl::text from pg_proc where oid = to_regprocedure($1)", [sig]);
    /*
     * The world's operator check is a stub, so its body is not Staging's: the
     * run pins Staging's md5 (3e220b0b…). That one pin — and only it — is
     * swapped for the stub's md5 here; every other pin stays as written.
     */
    async function runFile(nr: keyof typeof RUNS) {
      const stub = await md5("public.can_operate_active_seller()");
      const sql = readFileSync(`supabase/operations/staging-${nr}.sql`, "utf8");
      expect(sql.split("3e220b0b1a0b33d0b5ad9afc1be4719d").length - 1, "the operator pin occurs exactly in Z2").toBe(1);
      const notices: string[] = [];
      const listener = (m: { message?: string }) => notices.push(m.message ?? "");
      admin.on("notice", listener);
      try {
        const r = await outcome(admin.query(sql.replace("3e220b0b1a0b33d0b5ad9afc1be4719d", stub)));
        return { r, notices };
      } finally { admin.off("notice", listener); await admin.query("rollback").catch(() => {}); }
    }
    async function stagingLike() {
      await world(false);
      await admin.query(`comment on database ${database} is '${STAMP}'`);
      await admin.query("create table public.collection_items (id bigint primary key, user_id uuid, sky_id text)");
      for (const sig of Object.values(RUNS)) {   // exactly the grants of the Staging dump of 2026-11-09
        await admin.query(`revoke all on function ${sig} from public`);
        await admin.query(`grant all on function ${sig} to authenticated`);
        await admin.query(`grant all on function ${sig} to service_role`);
      }
      await sale([{ hold: true }, { hold: false }]);   // something for the measurements to see
    }
    it.each(["0188", "0189"] as const)("staging-%s.sql applies, keeps the ACL byte-identical, refuses a second run (A3); the rollback restores the old body", async (nr) => {
      await stagingLike();
      const sig = RUNS[nr];
      const [oldMd5, oldAcl] = [await md5(sig), await acl(sig)];
      const first = await runFile(nr);
      expect(first.r).toEqual({ ok: true });
      expect(first.notices.some((m) => m.startsWith(`${nr} ok`))).toBe(true);
      expect(await md5(sig)).not.toBe(oldMd5);
      expect(await acl(sig), "rights untouched").toBe(oldAcl);
      const second = await runFile(nr);
      expect(second.r.ok === false && second.r.message).toContain("ABBRUCH A3");
      await admin.query(readFileSync(`supabase/rollback/${ROLLBACK[nr]}`, "utf8"));
      expect(await md5(sig)).toBe(oldMd5);
      expect(await acl(sig), "rollback keeps the rights too").toBe(oldAcl);
      consistent(await state());
    });
    it("without the Staging stamp the run refuses (A1) and changes nothing", async () => {
      await stagingLike();
      await admin.query(`comment on database ${database} is null`);
      const before = await md5(RUNS["0188"]);
      const r = await runFile("0188");
      expect(r.r.ok === false && r.r.message).toContain("ABBRUCH A1");
      expect(await md5(RUNS["0188"])).toBe(before);
    });
  });

});
