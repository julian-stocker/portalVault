/**
 * 0175 on real PostgreSQL (PGlite): an account that decided or applied in a
 * reconciliation can be deleted — and nothing else about the evidence can
 * change.
 *
 * The world is the one of `schema.ts` with 0169–0173 as files; `auth.users`
 * carries the operator, and the foreign keys `decided_by` / `applied_by`
 * are the real ones from 0169 (`on delete set null`). Deleting the account
 * is `delete from auth.users`, which is what Supabase does.
 *
 *   1  deletion after a decision                 succeeds, decided_by → NULL
 *   2  deletion after an application             succeeds, applied_by → NULL
 *   3  a direct UPDATE of decided_by / applied_by refused (23001) — even to NULL
 *   4  any change to a business field            refused, before and after deletion
 *   5  the history after the deletion            every other column identical
 *   6  the migration                             second run, foreign body, rollback
 *
 * Plus the defect itself, measured on the body of 0169 — so the test fails
 * the day someone "simplifies" the fix away.
 */

import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { failsWith, migration, one, OPERATOR, reconciliationWorld, scriptFailsWith, untouchable } from "./schema";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const M0175 = "0175_sales_recon_account_deletion.sql";
const R0175 = readFileSync("supabase/rollback/R0175_sales_recon_append_only_strict.sql", "utf8");
const BODY_0169 = "aedd3c64076884fbf29d0308f5e26ec7";
const BODY_0175 = "ee1027ee285c6a31163fa3f123c07c73";
const SECOND = "00000000-0000-4000-8000-000000000002";

let db: PGlite;

const bodyHash = () => one<string>(db,
  `select md5(prosrc) from pg_proc where oid = 'public.sales_recon_evidence_is_append_only()'::regprocedure`);

/** One sale, one session with a date deviation, decided by the operator; returns the ids. */
async function decided(): Promise<{ sale: number; session: number; finding: number }> {
  const sale = await one<number>(db,
    `insert into public.sales (channel, sold_at, items_subtotal, discount_amount, shipping_charged)
     values ('ebay', '2026-02-17', 7.99, 0, 5.49) returning id`);
  await db.query(`insert into public.sale_items (sale_id, position, sky_id, raw_name) values ($1, 1, 'SKY-0001', 'Swarm')`, [sale]);
  const updatedAt = await one<string>(db, `select to_jsonb(updated_at) #>> '{}' from public.sales where id = $1`, [sale]);
  const payload = {
    channel: "ebay", parser: "ebay-orders-report-de", parserVersion: 1,
    coverage: { coveredFrom: "2026-02-01", coveredTo: "2026-02-28", recordFirst: 1, recordLast: 9, chainComplete: true },
    summary: { categories: { deviating: 1 } },
    files: [{ fileName: "feb.csv", fingerprint: "1".padStart(64, "0"), footerCount: 1, orders: 1,
      firstSoldOn: "2026-02-18", lastSoldOn: "2026-02-18", recordFirst: 5, recordLast: 5 }],
    orders: [{ orderRef: "01-00000-00001", recordNo: 5, soldOn: "2026-02-18", paidOn: "2026-02-18", shippedOn: null,
      itemsValue: 7.99, shipping: 5.49, total: 13.48, pieces: 1, combined: false, destinationCountry: "DE",
      shippingService: "Hermes Päckchen", sourceFile: "feb.csv", lines: [] }],
    matches: [{ orderRef: "01-00000-00001", saleId: sale, saleUpdatedAt: updatedAt, category: "deviating",
      certainty: "unique", score: 99, dateDelta: -1, competitors: [], reason: null,
      findings: [{ key: "sold_on", field: "sold_on", kind: "deviation", ledger: "2026-02-17", external: "2026-02-18", delta: -1, causes: [] }] }],
  };
  const session = await one<number>(db, `select public.seller_recon_create($1::jsonb)`, [JSON.stringify(payload)]);
  const finding = await one<number>(db,
    `select f.id from public.sales_recon_findings f join public.sales_recon_matches m on m.id = f.match_id where m.session_id = $1`, [session]);
  await db.query(`select public.seller_recon_decide($1, 'take_external', null, 'laut Bericht', '"2026-02-17"', '"2026-02-18"')`, [finding]);
  return { sale, session, finding };
}

const applied = async () => {
  const ids = await decided();
  await db.query(`select public.seller_recon_apply($1, 1)`, [ids.session]);
  return ids;
};

/** Every column of both evidence tables except the account reference, as one fingerprint. */
const evidence = () => one<string>(db, `select md5(
  coalesce((select string_agg((to_jsonb(d) - 'decided_by')::text, ';' order by d.id) from public.sales_recon_decisions d), '') || '|' ||
  coalesce((select string_agg((to_jsonb(a) - 'applied_by')::text, ';' order by a.id) from public.sales_recon_applications a), ''))`);

const deleteOperator = () => failsWith(db, `delete from auth.users where id = $1`, [OPERATOR]);

beforeEach(async () => {
  db = await reconciliationWorld();
});
afterEach(async () => {
  await db.close();
});

describe("the defect of 0169, measured", () => {
  it("without 0175 an account that decided cannot be deleted — on delete set null is an UPDATE", async () => {
    await decided();
    expect(await deleteOperator()).toBe("23001");
    expect(await one(db, `select count(*)::int from auth.users where id = $1`, [OPERATOR])).toBe(1);
  });
});

describe("with 0175", () => {
  beforeEach(async () => {
    expect(await scriptFailsWith(db, migration(M0175))).toBe("ok");
  });

  it("1 — deleting an account after a decision succeeds and clears only decided_by", async () => {
    await decided();
    const before = await evidence();
    expect(await deleteOperator()).toBe("ok");
    expect(await one(db, `select count(*)::int from public.sales_recon_decisions where decided_by is null`)).toBe(1);
    expect(await evidence()).toBe(before);
    // The session's own references were never guarded; they follow the same foreign key rule.
    expect(await one(db, `select created_by is null from public.sales_recon_sessions`)).toBe(true);
  });

  it("2 — deleting an account after an application succeeds and clears decided_by and applied_by", async () => {
    await applied();
    const before = await evidence();
    const stock = await untouchable(db);
    expect(await deleteOperator()).toBe("ok");
    expect(await one(db, `select count(*)::int from public.sales_recon_applications where applied_by is null and outcome = 'applied'`)).toBe(1);
    expect(await one(db, `select count(*)::int from public.sales_recon_decisions where decided_by is null`)).toBe(1);
    expect(await evidence()).toBe(before);
    expect(await untouchable(db)).toBe(stock);
  });

  it("3 — a direct UPDATE of the account reference is refused, to NULL or to another account", async () => {
    await applied();
    await db.query(`insert into auth.users values ($1)`, [SECOND]);
    for (const sql of [
      `update public.sales_recon_decisions set decided_by = null`,
      `update public.sales_recon_decisions set decided_by = '${SECOND}'`,
      `update public.sales_recon_applications set applied_by = null`,
      `update public.sales_recon_applications set applied_by = '${SECOND}'`,
    ]) expect(await failsWith(db, sql), sql).toBe("23001");
    expect(await one(db, `select count(*)::int from public.sales_recon_decisions where decided_by = $1`, [OPERATOR])).toBe(1);
  });

  it("3b — even from inside another trigger, while the account still exists", async () => {
    await decided();
    // The depth condition alone would let this through; the account check does not.
    await db.exec(`
      create table public.z_probe (id int);
      create function public.z_probe_clear() returns trigger language plpgsql as $$
        begin update public.sales_recon_decisions set decided_by = null; return new; end $$;
      create trigger z_probe_trg after insert on public.z_probe for each row execute function public.z_probe_clear();`);
    expect(await failsWith(db, `insert into public.z_probe values (1)`)).toBe("23001");
    expect(await one(db, `select count(*)::int from public.sales_recon_decisions where decided_by = $1`, [OPERATOR])).toBe(1);
  });

  it("4 — every business field stays immutable, and no row can be deleted — before and after the account deletion", async () => {
    await applied();
    const attempts = [
      `update public.sales_recon_decisions set decision = 'keep_ledger'`,
      `update public.sales_recon_decisions set reason = 'anders'`,
      `update public.sales_recon_decisions set shown_external = '"2026-02-19"'`,
      `update public.sales_recon_decisions set decided_at = now() - interval '1 day'`,
      `update public.sales_recon_applications set outcome = 'documented'`,
      `update public.sales_recon_applications set new_value = '2026-02-19'`,
      `delete from public.sales_recon_decisions`,
      `delete from public.sales_recon_applications`,
    ];
    for (const sql of attempts) expect(await failsWith(db, sql), sql).toBe("23001");
    expect(await deleteOperator()).toBe("ok");
    for (const sql of attempts) expect(await failsWith(db, sql), `${sql} (after)`).toBe("23001");
    // A cleared reference cannot be set again either.
    await db.query(`insert into auth.users values ($1)`, [SECOND]);
    expect(await failsWith(db, `update public.sales_recon_decisions set decided_by = '${SECOND}'`)).toBe("23001");
  });

  it("5 — the history reads the same after the deletion: decision, finding, application, audit", async () => {
    const { sale } = await applied();
    const chain = () => one<string>(db, `
      select string_agg(d.decision || '|' || f.field || '|' || d.shown_ledger::text || '>' || d.shown_external::text || '|'
                        || coalesce(d.reason, '-') || '|' || a.outcome || '|' || a.new_value, ';' order by d.id)
        from public.sales_recon_decisions d
        join public.sales_recon_findings f on f.id = d.finding_id
        join public.sales_recon_applications a on a.decision_id = d.id`);
    const audit = () => one<string>(db,
      `select md5(string_agg((to_jsonb(a) - 'changed_by')::text, ';' order by a.id)) from public.orderbook_audit a where a.sale_id = $1`, [sale]);
    const [c0, a0] = [await chain(), await audit()];
    expect(c0).toBe("take_external|sold_on|\"2026-02-17\">\"2026-02-18\"|laut Bericht|applied|2026-02-18");
    expect(await deleteOperator()).toBe("ok");
    expect(await chain()).toBe(c0);
    expect(await audit()).toBe(a0);
    expect(await one(db, `select sold_at::text from public.sales where id = $1`, [sale])).toBe("2026-02-18");
  });
});

describe("7 — the deletion used as a lever", () => {
  /*
   * The exception is the only door, so it is attacked from the side the
   * checks cannot see in a plain UPDATE: code running INSIDE an account
   * deletion (depth > 1, a deleted account in the same statement). Every
   * attempt must either be exactly what `on delete set null` does anyway,
   * or fail — and a failure takes the whole deletion back with it.
   */
  beforeEach(async () => {
    expect(await scriptFailsWith(db, migration(M0175))).toBe("ok");
  });

  /*
   * AFTER triggers fire in name order, and the foreign key's own action is
   * `RI_ConstraintTrigger_a_…`. A trigger named `A_…` runs BEFORE it (the
   * reference is still set), one named `z_…` AFTER it (already NULL). Both
   * orders are attacked; the first version of these tests only had `z_…`,
   * whose `where decided_by = old.id` then matched nothing — a test that
   * passed for the wrong reason.
   */
  const onDelete = (body: string, name: "A_first" | "z_last" = "A_first") => db.exec(`
    create function public."${name}"() returns trigger language plpgsql as $$ begin ${body} return old; end $$;
    create trigger "${name}" after delete on auth.users for each row execute function public."${name}"();`);

  it("the attacking trigger really runs before the foreign key's action", async () => {
    await decided();
    await db.exec(`create table public.z_seen (decided_by uuid)`);
    await onDelete(`insert into public.z_seen select decided_by from public.sales_recon_decisions;`);
    expect(await deleteOperator()).toBe("ok");
    expect(await one(db, `select decided_by::text from public.z_seen`)).toBe(OPERATOR);
  });

  for (const order of ["A_first", "z_last"] as const) {
    it(`clearing the reference AND changing a business field in the same deletion fails (${order}) — and the account stays`, async () => {
      await decided();
      const before = await evidence();
      await onDelete(`update public.sales_recon_decisions set decided_by = null, reason = 'umgeschrieben';`, order);
      expect(await deleteOperator()).toBe("23001");
      expect(await one(db, `select count(*)::int from auth.users where id = $1`, [OPERATOR])).toBe(1);
      expect(await one(db, `select count(*)::int from public.sales_recon_decisions where decided_by = $1`, [OPERATOR])).toBe(1);
      expect(await evidence()).toBe(before);
    });
  }

  it("deleting ANOTHER account cannot clear the reference of one that still exists", async () => {
    await decided();
    await db.query(`insert into auth.users values ($1)`, [SECOND]);
    await onDelete(`update public.sales_recon_decisions set decided_by = null where decided_by <> old.id;`);
    expect(await failsWith(db, `delete from auth.users where id = $1`, [SECOND])).toBe("23001");
    expect(await one(db, `select count(*)::int from public.sales_recon_decisions where decided_by = $1`, [OPERATOR])).toBe(1);
  });

  it("deleting the row inside a deletion fails", async () => {
    await applied();
    await onDelete(`delete from public.sales_recon_applications;`);
    expect(await deleteOperator()).toBe("23001");
    expect(await one(db, `select count(*)::int from public.sales_recon_applications`)).toBe(1);
  });

  it("after the deletion, a nested UPDATE of an anonymised row is refused like a direct one", async () => {
    await applied();
    expect(await deleteOperator()).toBe("ok");
    const before = await evidence();
    await db.exec(`
      create table public.z_probe (id int);
      create function public.z_probe_edit() returns trigger language plpgsql as $$
        begin update public.sales_recon_decisions set reason = 'nachtraeglich'; return new; end $$;
      create trigger z_probe_trg after insert on public.z_probe for each row execute function public.z_probe_edit();`);
    expect(await failsWith(db, `insert into public.z_probe values (1)`)).toBe("23001");
    expect(await evidence()).toBe(before);
  });

  it("within the deleting transaction, nothing else may follow — and a rollback restores the reference", async () => {
    await decided();
    expect(await scriptFailsWith(db, `begin;
      delete from auth.users where id = '${OPERATOR}';
      update public.sales_recon_decisions set reason = 'gleich danach';
      commit;`)).toBe("23001");
    expect(await one(db, `select count(*)::int from public.sales_recon_decisions where decided_by = $1 and reason = 'laut Bericht'`, [OPERATOR])).toBe(1);
  });

  it("a shown value rewritten in another form counts as a change", async () => {
    await decided();
    // "2026-02-17" wrapped as ["2026-02-17"] carries the same date — and is still a change.
    await onDelete(`update public.sales_recon_decisions set decided_by = null,
      shown_ledger = jsonb_build_array(shown_ledger) where decided_by = old.id;`);
    expect(await deleteOperator()).toBe("23001");
    expect(await one(db, `select shown_ledger::text from public.sales_recon_decisions`)).toBe('"2026-02-17"');
  });
});

describe("6 — the migration itself", () => {
  it("runs once, bounces off a second run, and refuses a foreign body", async () => {
    expect(await bodyHash()).toBe(BODY_0169);
    expect(await scriptFailsWith(db, migration(M0175))).toBe("ok");
    expect(await bodyHash()).toBe(BODY_0175);
    expect(await scriptFailsWith(db, migration(M0175))).toBe("P0001");
    expect(await bodyHash()).toBe(BODY_0175);

    await db.exec(`create or replace function public.sales_recon_evidence_is_append_only() returns trigger
      language plpgsql security definer set search_path = '' as $$ begin return new; end $$;`);
    expect(await scriptFailsWith(db, migration(M0175))).toBe("P0001");
  });

  it("needs 0169: without its tables it aborts", async () => {
    const bare = await reconciliationWorld({ migrations: [] });
    try {
      expect(await scriptFailsWith(bare, migration(M0175))).toBe("P0001");
    } finally {
      await bare.close();
    }
  });

  it("inside an aborted transaction it leaves the body of 0169", async () => {
    expect(await scriptFailsWith(db, `begin;\n${migration(M0175)}\nselect 1/0;\ncommit;`)).toBe("22012");
    expect(await bodyHash()).toBe(BODY_0169);
  });

  it("R0175 turns the body back, refuses a third version, and is idempotent", async () => {
    expect(await scriptFailsWith(db, migration(M0175))).toBe("ok");
    expect(await scriptFailsWith(db, R0175)).toBe("ok");
    expect(await bodyHash()).toBe(BODY_0169);
    expect(await scriptFailsWith(db, R0175)).toBe("ok");
    expect(await bodyHash()).toBe(BODY_0169);
    // With the old body, the defect is back — that is what the rollback costs.
    await decided();
    expect(await deleteOperator()).toBe("23001");

    await db.exec(`create or replace function public.sales_recon_evidence_is_append_only() returns trigger
      language plpgsql security definer set search_path = '' as $$ begin return new; end $$;`);
    expect(await scriptFailsWith(db, R0175)).toBe("P0001");
  });

  it("keeps the trigger function closed to every client role", async () => {
    expect(await scriptFailsWith(db, migration(M0175))).toBe("ok");
    for (const role of ["anon", "authenticated"]) {
      expect(await one(db, `select has_function_privilege($1, 'public.sales_recon_evidence_is_append_only()', 'execute')`, [role]), role).toBe(false);
    }
  });
});

describe("the Staging run file of 0175", () => {
  const RUN = readFileSync("supabase/operations/staging-0175.sql", "utf8");
  const START = `-- >>> EINGEBETTET: supabase/migrations/${M0175}\n`;
  const END = `-- <<< ENDE: supabase/migrations/${M0175}\n`;

  it("embeds the migration character for character, and nothing else", () => {
    const a = RUN.indexOf(START);
    const b = RUN.indexOf(END);
    expect(a).toBeGreaterThan(-1);
    expect(RUN.slice(a + START.length, b)).toBe(migration(M0175));
    expect([...RUN.matchAll(/^-- >>> EINGEBETTET: /gm)]).toHaveLength(1);
  });

  it("is one transaction for Staging only", () => {
    const lines = RUN.split("\n");
    expect(lines.filter((l) => l.trim() === "begin;")).toHaveLength(1);
    expect(lines.filter((l) => l.trim() === "commit;")).toHaveLength(1);
    expect(RUN.trimEnd().endsWith("commit;")).toBe(true);
    expect(RUN).toContain("'skyisles-staging qqxcpesbwfxzgytkdsac'");
    expect(RUN).not.toContain("zmiwxswrpkmizvqsgype");
  });

  it("stops without the Staging stamp and changes nothing", async () => {
    expect(await scriptFailsWith(db, RUN)).toBe("P0001");
    expect(await bodyHash()).toBe(BODY_0169);
  });

  it("runs on the stamped database with evidence present, and leaves every row as it was", async () => {
    await db.exec(`comment on database postgres is 'skyisles-staging qqxcpesbwfxzgytkdsac'`);
    await applied();
    const rows = () => one<string>(db, `select md5(
      (select string_agg(to_jsonb(d)::text, ';' order by d.id) from public.sales_recon_decisions d) ||
      (select string_agg(to_jsonb(a)::text, ';' order by a.id) from public.sales_recon_applications a))`);
    const before = await rows();
    expect(await scriptFailsWith(db, RUN)).toBe("ok");
    expect(await bodyHash()).toBe(BODY_0175);
    expect(await rows()).toBe(before);
    expect(await deleteOperator()).toBe("ok");
  });
});
