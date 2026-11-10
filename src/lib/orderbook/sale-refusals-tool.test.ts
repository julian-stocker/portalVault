/**
 * `verify:sale-refusals:staging` (F5 / B2) — offline, against an in-memory
 * stand-in for Staging that answers like the database functions do.
 *
 * What is proven here, before the tool may ever run:
 *   - the safe run passes, deletes only its own sale through `seller_delete_sale`
 *     and leaves stock, reservations and the ledger exactly as they were;
 *   - no booking, return, restock or shipping function is reachable;
 *   - every fault path ends in a defined state: an unexpected acceptance is
 *     taken back, a failed update stops the run, and whenever the sale can NOT
 *     be proven unbooked, nothing is deleted and the leftover is named.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  ALLOWED_RPCS, FORBIDDEN_RPCS, runSaleRefusals, type ItemRow, type RefusalPort, type RpcResult, type SaleRow,
} from "../../../tools/lib/sale-refusals.mts";

type Faults = {
  acceptFigureSettle?: boolean;     // the lock does not hold
  bookBehindOurBack?: boolean;      // a movement appears on a position during the run
  journalMoves?: boolean;           // someone else writes a movement during the run
  holdOnAdd?: boolean;              // adding a figure reserves stock
  updateNoRow?: "cancel" | "source" | "flag";
  throwOn?: string;                 // an RPC fails with an exception (network)
  throwWhileFrozen?: boolean;       // the exception comes while the sale is marked as a workbook sale
  operatorRemovalFails?: boolean;
  deleteRefused?: boolean;
};

function fakeStaging(f: Faults = {}) {
  const calls: string[] = [];
  const sales = new Map<number, SaleRow>();
  const items = new Map<number, ItemRow & { sky_id: string | null; legacy: string | null; not_shipped_at: null }>();
  const reservations: number[] = [];
  let movements = 1000;
  let maxMovement = 5000;
  let operators = 0;
  let users = 0;
  let nextSale = 900;
  let nextItem = 9000;
  let deletes = 0;
  const err = (message: string): RpcResult => ({ data: null, error: { message } });
  const ok = (data: unknown = null): RpcResult => ({ data, error: null });

  const port: RefusalPort = {
    activeSellerId: async () => 1,
    figureWithoutStock: async () => "SKY-0001",
    snapshot: async () => ({ quantity: 594, reserved: 3, movements, maxMovementId: maxMovement, activeReservations: 3 + reservations.length }),
    sale: async (id) => sales.get(id) ?? null,
    items: async (saleId) => [...items.values()].filter((i) => i.sale_id === saleId)
      .map(({ id, sale_id, movement_id, return_movement_id, returned_at, return_announced_at, settled_at }) =>
        ({ id, sale_id, movement_id, return_movement_id, returned_at, return_announced_at, settled_at })),
    reservationsFor: async (ids) => reservations.filter((r) => ids.includes(r)).length,
    movementsNaming: async (_saleId, ids) => [...items.values()].filter((i) => ids.includes(i.id) && i.movement_id !== null).length,
    leftovers: async (note) => ({ sales: [...sales.values()].filter((s) => s.note === note).map((s) => s.id), operators, users }),
    createOperator: async () => { operators += 1; users += 1; return "aaaaaaaa-0000-4000-8000-000000000001"; },
    removeOperator: async () => {
      if (f.operatorRemovalFails) return false;
      operators -= 1; users -= 1; return true;
    },
    updateSale: async (id, patch) => {
      const s = sales.get(id);
      if (!s || !s.is_test) return 0;
      if (f.updateNoRow === "cancel" && "cancelled_at" in patch && patch.cancelled_at !== null) return 0;
      if (f.updateNoRow === "source" && patch.source === "excel_order_2026") return 0;
      Object.assign(s, patch);
      return 1;
    },
    updateItem: async (id, patch) => {
      const i = items.get(id);
      if (!i || i.movement_id !== null || f.updateNoRow === "flag") return 0;
      i.legacy = patch.legacy_stock_flag;
      return 1;
    },
    rpc: async (fn, args) => {
      calls.push(fn);
      if (f.throwOn === fn) throw new Error(`fetch failed (${fn})`);
      const a = args as Record<string, never>;
      switch (fn) {
        case "seller_create_sale": {
          const id = nextSale++;
          sales.set(id, { id, is_test: false, note: a.p_note, order_id: null, source: "manual", cancelled_at: null, stock_released_at: null });
          return ok(id);
        }
        case "seller_set_sale_test": sales.get(a.p_id)!.is_test = a.p_is_test; return ok();
        case "seller_add_sale_item": {
          const id = nextItem++;
          items.set(id, { id, sale_id: a.p_sale_id, sky_id: a.p_sky_id, legacy: null, movement_id: null, return_movement_id: null,
            returned_at: null, return_announced_at: null, settled_at: null, not_shipped_at: null });
          if (f.holdOnAdd && a.p_sky_id !== null) reservations.push(id);
          return ok(id);
        }
        case "seller_settle_sale_item": {
          const i = items.get(a.p_item_id)!;
          const s = sales.get(i.sale_id)!;
          if (f.throwWhileFrozen && s.source === "excel_order_2026") throw new Error("fetch failed (frozen)");
          if (a.p_settled) {
            if (s.source === "excel_order_2026" && s.stock_released_at === null) return err("this sale has not been released for stock work");
            if (i.sky_id !== null && i.legacy !== "-" && !f.acceptFigureSettle) {
              return err("a catalog figure leaves stock by being booked out, never by being closed");
            }
            i.settled_at = "2026-11-10T00:00:00Z";
          } else i.settled_at = null;
          if (f.bookBehindOurBack && i.settled_at) { i.movement_id = 77; movements += 1; maxMovement += 1; }
          return ok();
        }
        case "seller_announce_sale_item_return": {
          const i = items.get(a.p_item_id)!;
          if (i.movement_id === null && a.p_announced) return err("nothing was booked out of stock; a return cannot be announced");
          i.return_announced_at = a.p_announced ? "x" : null;
          return ok();
        }
        case "seller_sales": {
          if (f.journalMoves) { movements += 1; maxMovement += 1; f.journalMoves = false; }
          const rows = [...sales.values()].filter((s) => s.note === a.p_search).map((s) => {
            const its = [...items.values()].filter((i) => i.sale_id === s.id);
            const settled = its.filter((i) => i.settled_at !== null).length;
            const out = its.filter((i) => i.movement_id !== null).length;
            return { id: s.id, outbooked_count: out, settled_count: settled, open_count: its.length - settled - out,
              is_open: s.cancelled_at === null && its.length - settled - out > 0 };
          });
          return ok({ sales: rows });
        }
        case "seller_delete_sale": {
          deletes += 1;
          const its = [...items.values()].filter((i) => i.sale_id === a.p_id);
          if (f.deleteRefused || its.some((i) => i.movement_id !== null)) return err("this sale has 1 item(s) with stock movements; reverse them first");
          for (const i of its) items.delete(i.id);
          sales.delete(a.p_id);
          return ok();
        }
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
  };
  return { port, calls, sales, items, deletesCalled: () => deletes };
}

const run = (f: Faults = {}) => {
  const world = fakeStaging(f);
  return runSaleRefusals(world.port, "t1").then((report) => ({ report, ...world }));
};
const failedNames = (r: { results: { name: string; passed: boolean }[] }) => r.results.filter((x) => !x.passed).map((x) => x.name);

describe("the safe run", () => {
  it("passes every check, deletes its own sale through seller_delete_sale, and leaves nothing", async () => {
    const { report, calls, sales } = await run();
    expect(failedNames(report)).toEqual([]);
    expect(report.deleted).toBe(true);
    expect(report.leftOver).toEqual([]);
    expect(sales.size).toBe(0);
    expect(calls.filter((c) => c === "seller_delete_sale")).toHaveLength(1);
    expect(calls.at(-1)).toBe("seller_delete_sale");
  });

  it("calls only allowed functions, none that books, returns, restocks or ships", async () => {
    const { calls } = await run();
    for (const c of calls) expect(ALLOWED_RPCS as readonly string[]).toContain(c);
    for (const c of calls) expect(FORBIDDEN_RPCS as readonly string[]).not.toContain(c);
  });

  it("names every refusal it expects, and the after-checks are before/after equalities, not totals", async () => {
    const { report } = await run();
    const names = report.results.map((r) => r.name);
    for (const n of ["2  Erledigt für eine gewöhnliche Katalogfigur wird verweigert",
      "5  Retoure ankündigen ohne Ausbuchung wird verweigert", "7  Erledigt SETZEN ist dort gesperrt",
      "keine neue Lagerbewegung (Anzahl)", "keine neue Lagerbewegung (höchste id)", "aktive Reservierungen unverändert"]) {
      expect(names).toContain(n);
    }
  });
});

describe("fault paths end in a defined state", () => {
  it("the lock does not hold: FAIL, the acceptance is taken back, then the sale is proven unbooked and deleted", async () => {
    const { report, calls } = await run({ acceptFigureSettle: true });
    expect(failedNames(report)).toEqual(["2  Erledigt für eine gewöhnliche Katalogfigur wird verweigert"]);
    expect(calls.filter((c) => c === "seller_settle_sale_item")).toHaveLength(2);   // the accept and the take-back
    expect(report.deleted).toBe(true);
    expect(report.leftOver).toEqual([]);
  });

  it("a movement appears on a position: NOTHING is deleted, the leftover is named", async () => {
    const { report, deletesCalled, sales } = await run({ bookBehindOurBack: true });
    expect(deletesCalled()).toBe(0);
    expect(report.deleted).toBe(false);
    expect(sales.size).toBe(1);
    expect(report.leftOver.join(" ")).toMatch(/Testverkauf #900 .*eine Position trägt eine Bewegung/);
    expect(failedNames(report)).toContain("Testverkauf NICHT gelöscht — sichere Rücksetzung nicht nachgewiesen");
  });

  it("the ledger moved elsewhere during the run: no deletion, reason stated", async () => {
    const { report, deletesCalled } = await run({ journalMoves: true });
    expect(deletesCalled()).toBe(0);
    expect(report.leftOver.join(" ")).toContain("Lagerjournal bewegt");
    expect(failedNames(report)).toContain("keine neue Lagerbewegung (Anzahl)");
  });

  it("adding a figure reserved stock: the run stops, nothing is deleted, the reservation is named", async () => {
    const { report, deletesCalled } = await run({ holdOnAdd: true });
    expect(failedNames(report)).toContain("keine Reservierung entstanden (Figur ohne Lagerposten)");
    expect(deletesCalled()).toBe(0);
    expect(report.leftOver.join(" ")).toContain("eine Reservierung zeigt auf eine Position");
  });

  it.each(["cancel", "source", "flag"] as const)("a direct update that changes no row (%s) stops the run; cleanup still proves and deletes", async (which) => {
    const { report } = await run({ updateNoRow: which });
    expect(failedNames(report).some((n) => n.endsWith("(genau eine Zeile)"))).toBe(true);
    expect(report.deleted).toBe(true);
    expect(report.leftOver).toEqual([]);
  });

  it("stopping after the source was set to the workbook: cleanup resets it first, then deletes", async () => {
    const world = fakeStaging({ throwWhileFrozen: true });
    const resets: string[] = [];
    const update = world.port.updateSale;
    world.port.updateSale = async (id, patch) => { resets.push(JSON.stringify(patch)); return update(id, patch); };
    const report = await runSaleRefusals(world.port, "t1");
    expect(failedNames(report)).toContain("Durchlauf ohne Ausnahme");
    expect(resets.at(-1)).toBe('{"source":"manual"}');          // the reset happened in cleanup, before the proof
    expect(report.deleted).toBe(true);
    expect(world.sales.size).toBe(0);
  });

  it("an exception before any sale exists: nothing to delete, the operator is still removed", async () => {
    const { report, calls } = await run({ throwOn: "seller_create_sale" });
    expect(report.saleId).toBeNull();
    expect(calls).not.toContain("seller_delete_sale");
    expect(report.results.find((r) => r.name === "temporärer Operator entfernt")?.passed).toBe(true);
  });

  it("seller_delete_sale refuses: the sale is reported, not forced", async () => {
    const { report, sales } = await run({ deleteRefused: true });
    expect(report.deleted).toBe(false);
    expect(sales.size).toBe(1);
    expect(report.leftOver.join(" ")).toContain("Löschen abgelehnt");
  });

  it("the operator cannot be removed: reported as leftover", async () => {
    const { report } = await run({ operatorRemovalFails: true });
    expect(report.leftOver.join(" ")).toContain("temporärer Operator");
  });
});

describe("the source cannot reach a stock-moving function", () => {
  const LIB = readFileSync("tools/lib/sale-refusals.mts", "utf8");
  const TOOL = readFileSync("tools/verify-sale-refusals.mts", "utf8");
  const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("allowed and forbidden lists do not overlap", () => {
    for (const f of FORBIDDEN_RPCS) expect(ALLOWED_RPCS as readonly string[]).not.toContain(f);
  });

  it("no forbidden name appears in the code outside the FORBIDDEN_RPCS list itself", () => {
    const lib = code(LIB);
    const list = lib.slice(lib.indexOf("export const FORBIDDEN_RPCS"), lib.indexOf("] as const;", lib.indexOf("export const FORBIDDEN_RPCS")));
    const rest = lib.replace(list, "") + code(TOOL);
    for (const f of FORBIDDEN_RPCS) expect(rest, f).not.toContain(f);
  });

  it("every RPC goes through the allowlist, in the core and again in the Staging binding", () => {
    expect(code(LIB).match(/port\.rpc\(/g)).toHaveLength(1);                   // only inside callRpc
    expect(code(LIB)).toMatch(/if \(!\(ALLOWED_RPCS as readonly string\[\]\)\.includes\(fn\)\) throw/);
    expect(code(TOOL)).toMatch(/if \(!\(ALLOWED_RPCS as readonly string\[\]\)\.includes\(fn\)\) throw/);
    expect(code(TOOL).match(/\.rpc\(/g)).toHaveLength(1);                     // the operator's, inside the bound port
  });

  it("the tool writes nothing to the ledger tables, and deletes no sale directly", () => {
    const t = code(TOOL);
    expect(t).not.toMatch(/from\("inventory_movements"\)\s*\.(insert|update|upsert|delete)/);
    expect(t).not.toMatch(/from\("shop_inventory"\)\s*\.(insert|update|upsert|delete)/);
    expect(t).not.toMatch(/from\("(sales|sale_items|order_reservations)"\)\s*\.delete/);
    expect(t).not.toMatch(/from\("sale_items"\)\s*\.insert/);
  });

  it("stays a Staging-only tool: the shared guard before any client, the pinned env file in its script", () => {
    expect(TOOL.indexOf('requireStaging("verify:sale-refusals")')).toBeGreaterThan(0);
    expect(TOOL.indexOf('requireStaging("verify:sale-refusals")')).toBeLessThan(TOOL.indexOf("createClient(url"));
    const scripts = (JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> }).scripts;
    expect(scripts["verify:sale-refusals:staging"]).toBe(
      "SKYISLES_REQUIRE_STAGING=1 node --env-file=.env.staging tools/verify-sale-refusals.mts");
  });

  it("leaves the original verify-sale-locks tool in place", () => {
    expect(readFileSync("tools/verify-sale-locks.mts", "utf8")).toContain("seller_book_sale_item");
  });
});
