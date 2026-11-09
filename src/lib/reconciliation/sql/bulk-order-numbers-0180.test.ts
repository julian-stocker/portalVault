/**
 * "Eindeutige Bestellnummern übernehmen" on real PostgreSQL (PGlite), with
 * the unchanged 0180 functions and exactly the order of calls the server
 * action makes: decide each order number (a refusal sets that one aside), one
 * preview of the accepted, one apply with its token.
 *
 * Twelve certain pairs without number; one gets a rival typed in after the
 * analysis (rival_sale), one is changed since (stale). The other ten get their
 * number — and nothing else moves: no amount, no date, no figure, no stock,
 * no hold, no movement; the two set aside keep no number.
 */
import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WITH_0180 } from "./create-sale-world";
import { one, reconciliationWorld } from "./schema";
import { analyseSpecs, decideOn, findingOf, type FindingRow, previewSelection, applySelection, seedSales, type Spec } from "./session-fixture";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

const NAMES = ["Eruptor", "Zap", "Hex", "Camo", "Bash", "Drobot", "Gill Grunt", "Cynder", "Spyro", "Trigger Happy", "Warnado", "Stump Smash"];
const ref = (k: number) => `05-11111-${String(k + 1).padStart(5, "0")}`;
// Four days apart: no order's window of ±3 days reaches another sale with the same figure.
const day = (k: number) => new Date(Date.UTC(2026, 4, 1 + 4 * k)).toISOString().slice(0, 10);
const SPECS: Spec[] = NAMES.map((name, k) => ({ ref: ref(k), sold: day(k), lines: [{ character: name, unit: 6 + k }],
  ledger: { sold: day(k), subtotal: 6 + k, pieces: [name] } }));

let db: PGlite;
let session: number;
let saleOf: Map<string, number>;

const untouched = () => one<string>(db, `select md5(concat_ws('|',
  (select string_agg(concat_ws(',', id, sold_at, items_subtotal, shipping_charged, discount_amount, is_test, cancelled_at, note), ';' order by id) from public.sales),
  (select string_agg(concat_ws(',', id, sale_id, position, sky_id, raw_name, movement_id), ';' order by id) from public.sale_items),
  (select string_agg(to_jsonb(i)::text, ';' order by i.id) from public.shop_inventory i),
  (select count(*) from public.order_reservations), (select count(*) from public.inventory_movements),
  (select count(*) from public.sale_refunds)))`);

/** The server action's sequence, in SQL: decide each, set refusals aside, preview, apply. */
async function bulk(findings: FindingRow[]) {
  const accepted: number[] = [];
  const refused: Record<string, string> = {};
  for (const f of findings) {
    try {
      accepted.push(Number(await decideOn(db, f, "take_external")));
    } catch (e) {
      const x = e as { code?: string; message?: string };
      // as the server reads it (`caseRefusal`): a named refusal, or PT409 = stale
      refused[String(f.external_value)] = /cannot be taken over \(([a-z_]+)\)/.exec(x.message ?? "")?.[1]
        ?? (x.code === "PT409" ? "stale" : `${x.code}: ${x.message}`);
    }
  }
  const p = await previewSelection(db, session, accepted);
  expect(p.admissible).toBe(true);
  expect(p.changes.every((c: { field: string }) => c.field === "external_order_ref")).toBe(true);
  await applySelection(db, session, accepted, p.token);
  return { accepted: accepted.length, refused };
}

beforeEach(async () => {
  db = await reconciliationWorld({ migrations: WITH_0180 });
  await db.exec(`insert into public.skylanders (sky_id, name, series_code) values
    ${NAMES.map((n, k) => `('SKY-9${String(k).padStart(3, "0")}', '${n}', 'SA')`).join(", ")} on conflict do nothing`);
  saleOf = await seedSales(db, SPECS);
  session = await analyseSpecs(db, SPECS);
});
afterEach(async () => { await db.close(); });

describe("twelve certain pairs, one rival, one changed since", () => {
  it("ten numbers written, two set aside with their reasons — nothing else moves", async () => {
    const pairs = await one<number>(db, `select count(*)::int from public.sales_recon_matches
      where session_id = $1 and category in ('exact', 'deviating') and sale_id is not null`, [session]);
    expect(pairs).toBe(12);
    const findings = await Promise.all(NAMES.map((_, k) => findingOf(db, session, ref(k), "external_order_ref")));

    // after the analysis: a rival for order 4 (same figure, ±3 days), and order 7's sale edited
    const rival = await one<number>(db, `insert into public.sales (channel, sold_at, source, items_subtotal, shipping_charged)
      values ('ebay', $1, 'manual', 5, 5.49) returning id`, [day(3)]);
    await db.query(`insert into public.sale_items (sale_id, position, raw_name) values ($1, 1, $2)`, [rival, NAMES[3]]);
    await db.query(`update public.sales set updated_at = updated_at + interval '1 second' where id = $1`, [saleOf.get(ref(6))]);
    const before = await untouched();

    const r = await bulk(findings);
    expect(r.accepted).toBe(10);
    expect(r.refused).toEqual({ [ref(3)]: "rival_sale", [ref(6)]: "stale" });

    const refs = await db.query<{ id: number; external_order_ref: string | null }>(
      `select id, external_order_ref from public.sales where id = any($1::bigint[]) order by id`, [[...saleOf.values()]]);
    for (const [k] of NAMES.entries()) {
      const got = refs.rows.find((x) => x.id === saleOf.get(ref(k)))!.external_order_ref;
      expect(got, ref(k)).toBe(k === 3 || k === 6 ? null : ref(k));
    }
    expect(await one(db, `select external_order_ref from public.sales where id = $1`, [rival])).toBeNull();
    expect(await untouched()).toBe(before);
  });

  it("the same run again: nothing is taken twice — each case is refused on its own (the apply moved its sale)", async () => {
    const findings = await Promise.all(NAMES.map((_, k) => findingOf(db, session, ref(k), "external_order_ref")));
    await bulk(findings);
    const again: string[] = [];
    for (const f of findings) {
      try { await decideOn(db, f, "take_external"); again.push("accepted"); } catch (e) {
        const x = e as { code?: string; message?: string };
        again.push(x.code === "PT409" ? "stale" : /already been applied/.test(x.message ?? "") ? "already_applied" : `${x.code}: ${x.message}`);
      }
    }
    expect(again.includes("accepted")).toBe(false);
    for (const a of again) expect(["stale", "already_applied"]).toContain(a);
  });
});
