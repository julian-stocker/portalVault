/**
 * The comparison screen against REAL answers of `seller_recon_session` with
 * 0179 (PGlite): the page the database builds, read by `view.ts`, put side by
 * side by `compareMatch` — the path the session page takes, minus React.
 *
 *   a real analysis   certain pairs green or red where the analysis said so,
 *                     report-only and SkyIsles-only rows compared with nothing
 *   session 3         the hand-built payload: unknown, never green
 *   session 2         a sale changed elsewhere: no proven value but the stored one
 *   paging            the server's pages, one at a time, give every match once
 */
import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { compareMatch } from "../compare";
import { pageRequest, sessionPageView, type Match } from "../view";
import { RECONCILIATION_MIGRATIONS, reconciliationWorld } from "./schema";
import { analyseSpecs, contradictingSession, everything, readSession, seedSales, type Spec } from "./session-fixture";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const MIGRATIONS = [...RECONCILIATION_MIGRATIONS, "0175_sales_recon_account_deletion.sql",
  "0176_sales_recon_validate_before_dedup.sql", "0178_sales_recon_comparison_and_pending.sql",
  "0179_sales_recon_ledger_proof.sql"] as const;

const SPECS: Spec[] = [
  { ref: "90-00000-00001", sold: "2026-02-01", lines: [{ character: "Zap", unit: 3.5 }], ledger: { sold: "2026-02-01", subtotal: 3.5, pieces: ["Zap"] } },
  { ref: "01-00000-00001", sold: "2026-02-18", shipping: 15.99, lines: [{ character: "Hex", unit: 30.3 }, { character: "Cynder", unit: 24 }],
    ledger: { sold: "2026-02-17", subtotal: 54.3, shipping: 15.99, pieces: ["Hex", "Cynder"] } },
  { ref: "01-00000-00010", sold: "2026-03-10", shipping: 4.99, lines: [{ character: "Eruptor", unit: 8 }],
    ledger: { sold: "2026-03-10", subtotal: 8, shipping: 5.49, pieces: ["Eruptor"] } },
  { ref: null, sold: "2026-05-05", lines: [], ledger: { sold: "2026-05-05", subtotal: 9.99, pieces: ["Stealth Elf"] } },
  { ref: "01-00000-00011", sold: "2026-07-07", lines: [{ character: "Jet-Vac", unit: 12 }], ledger: null },
  { ref: "90-00000-00002", sold: "2026-09-30", lines: [{ character: "Zook", unit: 2.5 }], ledger: { sold: "2026-09-30", subtotal: 2.5, pieces: ["Zook"] } },
];

let db: PGlite;
let saleOf: Map<string, number>;

beforeEach(async () => {
  db = await reconciliationWorld({ migrations: MIGRATIONS });
  saleOf = await seedSales(db, SPECS);
});
afterEach(async () => { await db.close(); });

const FIRST = pageRequest({}, 200);
const view = async (session: number, request = FIRST) =>
  sessionPageView(await readSession(db, session, request.category, request.offset, request.limit), request);
const byRef = (matches: Match[], ref: string) => matches.find((m) => m.order?.orderRef === ref)!;
const statuses = (m: Match) => Object.fromEntries(compareMatch(m).fields.map((f) => [f.field, f.status]));

describe("a real analysis", () => {
  it("certain pairs: green where every field is proven equal, red exactly where the analysis found a deviation", async () => {
    const page = await view(await analyseSpecs(db, SPECS));
    const zap = compareMatch(byRef(page.matches, "90-00000-00001"));
    expect(zap.tone).toBe("match");
    expect(zap.fields.slice(0, 5).map((f) => f.status)).toEqual(["match", "match", "match", "match", "match"]);

    const hex = byRef(page.matches, "01-00000-00001");
    expect(hex.category).toBe("deviating");
    expect(statuses(hex)).toMatchObject({ sold_on: "deviation", items_net: "match", shipping: "match", pieces: "match" });
    expect(compareMatch(hex).fields[0].atAnalysis).toEqual({ value: "2026-02-17", basis: "stored" });

    const eruptor = byRef(page.matches, "01-00000-00010");
    expect(statuses(eruptor)).toMatchObject({ shipping: "deviation", total: "deviation", sold_on: "match" });
  });

  it("a report-only and a SkyIsles-only row: nothing compared, nothing coloured", async () => {
    const page = await view(await analyseSpecs(db, SPECS));
    const others = page.matches.filter((m) => !(m.order && m.sale));
    expect(others.map((m) => m.category).sort()).toEqual(["external_only", "ledger_only"]);
    for (const m of others) {
      const c = compareMatch(m);
      expect(c.tone).toBe("neutral");
      expect(c.fields.every((f) => f.status === "not_compared")).toBe(true);
    }
  });

  it("the screen reads, it never writes", async () => {
    const session = await analyseSpecs(db, SPECS);
    const before = await everything(db);
    for (const m of (await view(session)).matches) compareMatch(m);
    expect(await everything(db)).toBe(before);
  });

  it("paging: one match per page, every match once, in the server's order", async () => {
    const session = await analyseSpecs(db, SPECS);
    const all = (await view(session)).matches.map((m) => m.id);
    const seen: number[] = [];
    for (let page = 1; page <= all.length; page += 1) {
      const p = await view(session, pageRequest({ seite: String(page) }, 1));
      expect(p.page).toMatchObject({ page, pages: all.length, total: all.length });
      seen.push(...p.matches.map((m) => m.id));
    }
    expect(seen).toEqual(all);
  });
});

describe("the Staging sessions, rebuilt", () => {
  it("session 3 — a hand-built payload: the three contradicting amounts are unknown, the row is not green", async () => {
    const session = await contradictingSession(db, saleOf.get("90-00000-00001")!, "2026-02-01");
    const m = (await view(session)).matches[0];
    expect(m.category).toBe("exact");
    expect(statuses(m)).toMatchObject({ sold_on: "match", items_net: "unknown", shipping: "unknown", total: "unknown", pieces: "match" });
    const c = compareMatch(m);
    expect(c.tone).toBe("neutral");
    expect(c.fields.filter((f) => f.status === "unknown").every((f) => f.atAnalysis?.value === null)).toBe(true);
  });

  it("session 2 — a sale changed elsewhere: only the stored finding value remains, the deviation stays the recorded one", async () => {
    const session = await analyseSpecs(db, SPECS);
    await db.query(`select public.orderbook_touch_sale($1)`, [saleOf.get("01-00000-00001")]);
    const m = byRef((await view(session)).matches, "01-00000-00001");
    expect(m.ledger?.state).toBe("changed");
    expect(statuses(m)).toMatchObject({ sold_on: "deviation", items_net: "unknown", shipping: "unknown", total: "unknown", pieces: "unknown" });
    expect(compareMatch(m).fields[0].atAnalysis?.basis).toBe("stored");
  });
});
