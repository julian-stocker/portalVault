/**
 * 0176 on real PostgreSQL (PGlite): forbidden content is refused on EVERY
 * upload — a new one and one the database already knows.
 *
 * The gap it closes: `seller_recon_create` (0172) recognised a known upload
 * (an open session with the same files) before it looked at orders, lines,
 * matches and findings, and answered with that session. Found by the Staging
 * functional test of 2026-11-03 (run `mw12dxva`). Nothing was stored — the
 * tests below also prove that for the old body — but nothing was refused.
 *
 *   the gap, measured        without 0176 a known upload with a buyer field "succeeds"
 *   every forbidden content  refused as a new AND as a known upload, nothing stored
 *   unchanged                a correct known upload returns its session; the
 *                            whole flow create → decide → apply works as before
 *   rights                   the check function is closed to every client role
 *   the migration            latches, aborted transaction, R0176, run file
 */

import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { failsWith, migration, one, RECONCILIATION_MIGRATIONS, reconciliationWorld, scriptFailsWith } from "./schema";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const M0176 = "0176_sales_recon_validate_before_dedup.sql";
const R0176 = readFileSync("supabase/rollback/R0176_sales_recon_validate_after_dedup.sql", "utf8");
const CREATE_0172 = "c54080be8908ef61589629314c1c0d9c";
const CREATE_0176 = "21fab5ff4ea2c7cb2550f3db821fce0f";
const WITH_0176 = [...RECONCILIATION_MIGRATIONS, M0176] as const;

let db: PGlite;

const createHash = () => one<string>(db,
  `select md5(prosrc) from pg_proc where oid = 'public.seller_recon_create(jsonb)'::regprocedure`);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Payload = any;

async function validPayload(fingerprint = "1"): Promise<Payload> {
  let sale = await one<number | null>(db, `select min(id)::int from public.sales`);
  if (sale === null) {
    sale = await one<number>(db,
      `insert into public.sales (channel, sold_at, items_subtotal, discount_amount, shipping_charged)
       values ('ebay', '2026-02-17', 7.99, 0, 5.49) returning id`);
  }
  const updatedAt = await one<string>(db, `select to_jsonb(updated_at) #>> '{}' from public.sales where id = $1`, [sale]);
  return {
    channel: "ebay", parser: "ebay-orders-report-de", parserVersion: 1,
    coverage: { coveredFrom: "2026-02-01", coveredTo: "2026-02-28", recordFirst: 1, recordLast: 9, chainComplete: true },
    summary: { categories: { deviating: 1 } },
    files: [{ fileName: "feb.csv", fingerprint: fingerprint.padStart(64, "0"), footerCount: 1, orders: 1,
      firstSoldOn: "2026-02-18", lastSoldOn: "2026-02-18", recordFirst: 5, recordLast: 5 }],
    orders: [{ orderRef: "01-00000-00001", recordNo: 5, soldOn: "2026-02-18", paidOn: "2026-02-18", shippedOn: null,
      itemsValue: 7.99, shipping: 5.49, total: 13.48, pieces: 1, combined: false, destinationCountry: "DE",
      shippingService: "Hermes Päckchen", sourceFile: "feb.csv",
      lines: [{ lineRef: "9000001", listingId: "100000000001", title: "Skylanders Figuren", variant: "[Charakter:Swarm]",
        name: "Swarm", quantity: 1, unitPrice: 7.99, value: 7.99 }] }],
    matches: [{ orderRef: "01-00000-00001", saleId: sale, saleUpdatedAt: updatedAt, category: "deviating",
      certainty: "unique", score: 99, dateDelta: -1, competitors: [{ orderRef: "01-00000-00009", saleId: sale, score: 3 }],
      reason: null,
      findings: [{ key: "sold_on", field: "sold_on", kind: "deviation", ledger: "2026-02-17", external: "2026-02-18",
        delta: -1, causes: [{ code: "report_day_shift", amount: null }] }] }],
  };
}

const create = (p: Payload) => one<number>(db, `select public.seller_recon_create($1::jsonb)`, [JSON.stringify(p)]);
const tryCreate = (p: Payload) => failsWith(db, `select public.seller_recon_create($1::jsonb)`, [JSON.stringify(p)]);

/** Everything 0169 stores, as one fingerprint. */
const stored = () => one<string>(db, `select md5(
  (select count(*)::text from public.sales_recon_sessions) || '|' ||
  coalesce((select string_agg(to_jsonb(f)::text, ';' order by f.id) from public.sales_recon_files f), '') || '|' ||
  coalesce((select string_agg(to_jsonb(o)::text, ';' order by o.id) from public.sales_recon_orders o), '') || '|' ||
  coalesce((select string_agg(to_jsonb(m)::text, ';' order by m.id) from public.sales_recon_matches m), '') || '|' ||
  coalesce((select string_agg(to_jsonb(x)::text, ';' order by x.id) from public.sales_recon_findings x), ''))`);

/** Every kind of forbidden content, at every level of the payload. */
const FORBIDDEN: [string, (p: Payload) => void][] = [
  ["a buyer field on an order", (p) => { p.orders[0].buyerName = "x"; }],
  ["a buyer field on the payload", (p) => { p.buyerEmail = "x"; }],
  ["an unknown key on a line", (p) => { p.orders[0].lines[0].buyer = "x"; }],
  ["an unknown key on a file", (p) => { p.files[0].owner = "x"; }],
  ["an unknown key in the coverage", (p) => { p.coverage.note = "x"; }],
  ["an unknown key on a match", (p) => { p.matches[0].buyerRef = "x"; }],
  ["an unknown key on a competitor", (p) => { p.matches[0].competitors[0].buyer = "x"; }],
  ["an unknown key on a finding", (p) => { p.matches[0].findings[0].note = "x"; }],
  ["an unknown key on a cause", (p) => { p.matches[0].findings[0].causes[0].who = "x"; }],
  ["an e-mail address in a line title", (p) => { p.orders[0].lines[0].title = "Fragen an test@example.invalid"; }],
  ["a phone number in a line name", (p) => { p.orders[0].lines[0].name = "Anruf +49 151 0000000"; }],
  ["an e-mail address in the shipping service", (p) => { p.orders[0].shippingService = "an test@example.invalid"; }],
  ["an e-mail address in a finding value", (p) => { p.matches[0].findings[0].external = "test@example.invalid"; }],
  ["text in the summary", (p) => { p.summary.categories.note = "Kaeufer"; }],
  ["an object as a finding value", (p) => { p.matches[0].findings[0].external = { name: "x" }; }],
  ["a cause code that is not a plain word", (p) => { p.matches[0].findings[0].causes[0].code = "Kunde Meier"; }],
  ["a finding without a sale", (p) => { p.matches[0].saleId = null; }],
  ["an order of another channel", (p) => { p.orders[0].channel = "amazon"; }],
  ["a malformed day", (p) => { p.orders[0].soldOn = "18.02.2026"; }],
];

afterEach(async () => {
  await db.close();
});

describe("the gap of 0172, measured", () => {
  beforeEach(async () => {
    db = await reconciliationWorld();
  });

  it("without 0176 a known upload with a buyer field returns the session — and stores nothing", async () => {
    const session = await create(await validPayload());
    const before = await stored();
    const bad = await validPayload();
    bad.orders[0].buyerName = "x";
    bad.orders[0].lines[0].title = "Fragen an test@example.invalid";
    expect(await create(bad)).toBe(session);
    expect(await stored()).toBe(before);
  });
});

describe("with 0176", () => {
  beforeEach(async () => {
    db = await reconciliationWorld({ migrations: WITH_0176 });
  });

  for (const [what, spoil] of FORBIDDEN) {
    it(`${what}: refused as a NEW upload, nothing stored`, async () => {
      const before = await stored();
      const p = await validPayload("7");
      spoil(p);
      expect(await tryCreate(p)).not.toBe("ok");
      expect(await stored()).toBe(before);
    });

    it(`${what}: refused as a KNOWN upload, nothing stored`, async () => {
      await create(await validPayload());
      const before = await stored();
      const p = await validPayload();
      spoil(p);
      expect(await tryCreate(p)).not.toBe("ok");
      expect(await stored()).toBe(before);
    });
  }

  it("the refusals keep their messages — the field is named, never the value", async () => {
    await create(await validPayload());
    const p = await validPayload();
    p.orders[0].buyerName = "Erika Mustermann";
    await expect(db.query(`select public.seller_recon_create($1::jsonb)`, [JSON.stringify(p)]))
      .rejects.toThrow(/order carries unknown field\(s\): buyerName/);
    const q = await validPayload();
    q.orders[0].lines[0].title = "Fragen an erika@example.invalid";
    await expect(db.query(`select public.seller_recon_create($1::jsonb)`, [JSON.stringify(q)]))
      .rejects.toThrow(/line\.title looks like it contains an e-mail address/);
  });

  it("a correct known upload still returns its session, and nothing is added", async () => {
    const session = await create(await validPayload());
    const before = await stored();
    expect(await create(await validPayload())).toBe(session);
    expect(await stored()).toBe(before);
  });

  it("the whole flow works as before: create, decide, apply", async () => {
    const session = await create(await validPayload());
    const finding = await one<number>(db, `select f.id from public.sales_recon_findings f
      join public.sales_recon_matches m on m.id = f.match_id where m.session_id = $1`, [session]);
    await db.query(`select public.seller_recon_decide($1, 'take_external', null, null, '"2026-02-17"', '"2026-02-18"')`, [finding]);
    expect(await one(db, `select public.seller_recon_apply($1, 1)`, [session])).toEqual({ applied: 1, documented: 0, sales: 1 });
    expect(await one(db, `select sold_at::text from public.sales order by id limit 1`)).toBe("2026-02-18");
  });

  it("what depends on the database is still checked on a new upload: a stale sale is PT409", async () => {
    const p = await validPayload("5");
    p.matches[0].saleUpdatedAt = "2001-01-01T00:00:00+00:00";
    expect(await tryCreate(p)).toBe("PT409");
  });

  it("the check function is closed to every client role; the operator function stays open to authenticated", async () => {
    for (const role of ["anon", "authenticated"]) {
      expect(await one(db, `select has_function_privilege($1, 'public.sales_recon_validate_payload(jsonb)', 'execute')`, [role]), role).toBe(false);
    }
    expect(await one(db, `select has_function_privilege('authenticated', 'public.seller_recon_create(jsonb)', 'execute')`)).toBe(true);
    expect(await one(db, `select has_function_privilege('anon', 'public.seller_recon_create(jsonb)', 'execute')`)).toBe(false);
  });

  it("the check reads no table: it runs on a payload whose sale does not exist", async () => {
    const p = await validPayload();
    p.matches[0].saleId = 999999;
    expect(await failsWith(db, `select public.sales_recon_validate_payload($1::jsonb)`, [JSON.stringify(p)])).toBe("ok");
  });
});

describe("the migration itself", () => {
  beforeEach(async () => {
    db = await reconciliationWorld();
  });

  it("runs once, bounces off a second run, and refuses a foreign body", async () => {
    expect(await createHash()).toBe(CREATE_0172);
    expect(await scriptFailsWith(db, migration(M0176))).toBe("ok");
    expect(await createHash()).toBe(CREATE_0176);
    expect(await scriptFailsWith(db, migration(M0176))).toBe("P0001");

    const other = await reconciliationWorld();
    try {
      await other.exec(`create or replace function public.seller_recon_create(p_payload jsonb) returns bigint
        language plpgsql security definer set search_path = '' as $$ begin return 1; end $$;`);
      expect(await scriptFailsWith(other, migration(M0176))).toBe("P0001");
      expect(await one(other, `select to_regprocedure('public.sales_recon_validate_payload(jsonb)')`)).toBeNull();
    } finally {
      await other.close();
    }
  });

  it("needs 0172", async () => {
    const bare = await reconciliationWorld({ migrations: RECONCILIATION_MIGRATIONS.slice(0, 1) });
    try {
      expect(await scriptFailsWith(bare, migration(M0176))).toBe("P0001");
    } finally {
      await bare.close();
    }
  });

  it("inside an aborted transaction it leaves the body of 0172 and no check function", async () => {
    expect(await scriptFailsWith(db, `begin;\n${migration(M0176)}\nselect 1/0;\ncommit;`)).toBe("22012");
    expect(await createHash()).toBe(CREATE_0172);
    expect(await one(db, `select to_regprocedure('public.sales_recon_validate_payload(jsonb)')`)).toBeNull();
  });

  it("R0176 turns it back, keeps the rights, is idempotent and refuses a third version", async () => {
    expect(await scriptFailsWith(db, migration(M0176))).toBe("ok");
    const session = await create(await validPayload());
    expect(await scriptFailsWith(db, R0176)).toBe("ok");
    expect(await createHash()).toBe(CREATE_0172);
    expect(await one(db, `select to_regprocedure('public.sales_recon_validate_payload(jsonb)')`)).toBeNull();
    expect(await one(db, `select has_function_privilege('authenticated', 'public.seller_recon_create(jsonb)', 'execute')`)).toBe(true);
    expect(await one(db, `select count(*)::int from public.sales_recon_sessions where id = $1`, [session])).toBe(1);
    expect(await scriptFailsWith(db, R0176)).toBe("ok");

    await db.exec(`create or replace function public.seller_recon_create(p_payload jsonb) returns bigint
      language plpgsql security definer set search_path = '' as $$ begin return 1; end $$;`);
    expect(await scriptFailsWith(db, R0176)).toBe("P0001");
  });
});

describe("the Staging run file of 0176", () => {
  const RUN = readFileSync("supabase/operations/staging-0176.sql", "utf8");
  const START = `-- >>> EINGEBETTET: supabase/migrations/${M0176}\n`;
  const END = `-- <<< ENDE: supabase/migrations/${M0176}\n`;

  beforeEach(async () => {
    db = await reconciliationWorld();
  });

  it("embeds the migration character for character, and nothing else", () => {
    const a = RUN.indexOf(START);
    expect(a).toBeGreaterThan(-1);
    expect(RUN.slice(a + START.length, RUN.indexOf(END))).toBe(migration(M0176));
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
    expect(await createHash()).toBe(CREATE_0172);
  });

  it("runs on the stamped database with a session present, and leaves every row as it was", async () => {
    await db.exec(`comment on database postgres is 'skyisles-staging qqxcpesbwfxzgytkdsac'`);
    await create(await validPayload());
    const before = await stored();
    expect(await scriptFailsWith(db, RUN)).toBe("ok");
    expect(await createHash()).toBe(CREATE_0176);
    expect(await stored()).toBe(before);
  });
});
