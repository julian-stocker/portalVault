/**
 * The nine deviations the 2026 analysis found — rebuilt from INVENTED data.
 *
 * Each case keeps the shape that made it a case (the dates, amounts, piece
 * counts and naming patterns of the real order) and nothing that identifies
 * it: order numbers, buyers and listings are synthetic. Next to them stand the
 * counter-examples that must NOT be reported, because a reconciliation that
 * cries wolf is not used twice.
 */

import { describe, expect, it } from "vitest";
import type { Finding } from "./diff";
import { ebayReport, type FixtureOrder } from "./testing/ebay-fixture";
import { ledgerSale } from "./testing/ledger-fixture";
import { rowFor, runReconciliation } from "./testing/run";
import type { LedgerSale } from "./types";

/** Give orders record numbers the way eBay does (n + 1 for n positions), in date order. */
function chained(orders: Omit<FixtureOrder, "record">[]): FixtureOrder[] {
  let record = 1000;
  return [...orders].sort((a, b) => a.sold.localeCompare(b.sold)).map((o) => {
    record += o.lines.length > 1 ? o.lines.length + 1 : 1;
    return { ...o, record };
  });
}

const FIG = "Skylanders Spyros Adventure Figuren - Große Auswahl";
const GIANTS = "Skylanders Giants Figuren - Große Auswahl";

// Two anchors keep every case away from the uncertain first and last day.
const anchors = {
  orders: [
    { ref: "90-00000-00001", sold: "2026-02-01", lines: [{ character: "Zap", unit: 3.5 }] },
    { ref: "90-00000-00002", sold: "2026-09-30", lines: [{ character: "Zook", unit: 2.5 }] },
  ],
  sales: [
    ledgerSale({ id: 9001, sold: "2026-02-01", net: 3.5, pieces: ["Zap"] }),
    ledgerSale({ id: 9002, sold: "2026-09-30", net: 2.5, pieces: ["Zook"] }),
  ],
};

const CASES: { orders: Omit<FixtureOrder, "record">[]; sales: LedgerSale[] } = {
  orders: [
    // ① ② two orders of one day, both booked a day early
    { ref: "01-00000-00001", sold: "2026-02-18", shipping: 15.99, lines: [
      { character: "Hex", unit: 30.3 }, { character: "Cynder", unit: 24 }] },
    { ref: "01-00000-00002", sold: "2026-02-18", shipping: 10.74, lines: [
      { character: "Bash", unit: 3.35 }, { character: "Trigger Happy", unit: 3 }] },
    // ③ three days early
    { ref: "01-00000-00003", sold: "2026-06-05", lines: [{ character: "Sonic Boom", unit: 6.1 }, { character: "Voodood", unit: 4 }] },
    // ④ booked on the payment day of a combined order
    { ref: "01-00000-00004", sold: "2026-06-26", paid: "2026-06-28", shipped: "2026-06-28", lines: [{ character: "Camo", unit: 37.83 }] },
    // ⑤ Fire Reactor: three pieces at eBay, one in SkyIsles — same money
    { ref: "01-00000-00005", sold: "2026-04-27", lines: [
      { character: "Water Armor (Crystal)", unit: 5.41 }, { character: "Dark Pyramid (Crystal)", unit: 22.53 },
      { character: "Fire Reactor (Crystal)", unit: 1.8, qty: 3 }] },
    // ⑥ Scorp sold, Scorpion Striker Catapult booked
    { ref: "01-00000-00006", sold: "2026-04-24", lines: [
      { character: "Chopper", unit: 2.1 }, { character: "Food Fight", unit: 3.2 },
      { character: "Scorp", unit: 1.71 }, { character: "Wind Up", unit: 2.4 }] },
    // ⑦ a portal with a different model number — identity only probable
    { ref: "01-00000-00007", sold: "2026-04-21", lines: [{ character: "Portal 84148790 (Wireless)", unit: 14.69, title: "Skylanders Portale" }] },
    // ⑧ total 0,00 €, never shipped; SkyIsles has neither cancellation nor refund
    { ref: "01-00000-00008", sold: "2026-09-29", shipping: 5.99, total: 0, shipped: null, lines: [{ character: "Wildfire", unit: 43.19 }] },
    // ⑨ total reduced by 6,99 €; SkyIsles has no refund
    { ref: "01-00000-00009", sold: "2026-09-26", shipping: 5.99, total: 13.56, lines: [
      { character: "Pop Fizz", unit: 7 }, { character: "Gusto", unit: 4.47 }, { character: "Funny Bone", unit: 3.09 }] },
  ],
  sales: [
    ledgerSale({ id: 101, sold: "2026-02-17", net: 54.3, shipping: 15.99, pieces: ["Hex", "Cynder"] }),
    ledgerSale({ id: 102, sold: "2026-02-17", net: 6.35, shipping: 10.74, pieces: ["Bash", "Trigger Happy"] }),
    ledgerSale({ id: 103, sold: "2026-06-02", net: 10.1, discount: 0.1, pieces: ["Sonic Boom", "Voodood"] }),
    ledgerSale({ id: 104, sold: "2026-06-28", net: 37.83, pieces: ["Camo"] }),
    ledgerSale({ id: 105, sold: "2026-04-27", net: 33.34, discount: 1.76, pieces: ["Water Armor", "Dark Pyramid", "Fire Reactor"] }),
    ledgerSale({ id: 106, sold: "2026-04-24", net: 9.41, pieces: ["Chopper", "Food Fight", "Scorpion Striker Catapult", "Wind Up"] }),
    ledgerSale({ id: 107, sold: "2026-04-21", net: 14.69, pieces: [{ rawName: "83973080A Wireless (SA)", skyId: "SKY-PRT1" }] }),
    ledgerSale({ id: 108, sold: "2026-09-29", net: 43.19, shipping: 5.99, source: "manual", pieces: ["Wildfire"] }),
    ledgerSale({ id: 109, sold: "2026-09-26", net: 14.56, shipping: 5.99, source: "manual", pieces: ["Pop Fizz", "Gusto", "Funny Bone"] }),
  ],
};

const COUNTER: { orders: Omit<FixtureOrder, "record">[]; sales: LedgerSale[] } = {
  orders: [
    // a volume discount: eBay's unit prices are already reduced
    { ref: "02-00000-00001", sold: "2026-03-03", lines: [
      { character: "Swarm", unit: 2.25 }, { character: "Hex", unit: 4.96 }, { character: "Stealth Elf", unit: 1.8 }, { character: "Hot Head", unit: 9.04 }] },
    // a refund SkyIsles already has
    { ref: "02-00000-00002", sold: "2026-03-10", shipping: 5.99, total: 13.56, lines: [
      { character: "Pop Fizz", unit: 7 }, { character: "Gusto", unit: 4.47 }, { character: "Funny Bone", unit: 3.09 }] },
    // a cancellation SkyIsles already has
    { ref: "02-00000-00003", sold: "2026-03-12", total: 0, shipped: null, lines: [{ character: "Eruptor", unit: 14.95 }] },
    // the same figure, spelled the other way round
    { ref: "02-00000-00004", sold: "2026-03-16", lines: [{ character: "Stealth Elf (Legendary)", unit: 17.5 }] },
    // a Giants listing, booked as the Spyro's Adventure figure — a hint only
    { ref: "02-00000-00005", sold: "2026-03-19", lines: [{ character: "Ignitor", unit: 4.27, title: GIANTS }] },
    // ordinary
    { ref: "02-00000-00006", sold: "2026-03-23", lines: [{ character: "Chop Chop", unit: 4.27, title: FIG }] },
  ],
  sales: [
    ledgerSale({ id: 201, sold: "2026-03-03", subtotal: 19, discount: 0.95, pieces: ["Swarm", "Hex", "Stealth Elf", "Hot Head"] }),
    ledgerSale({ id: 202, sold: "2026-03-10", net: 14.56, shipping: 5.99, refunds: 6.99, pieces: ["Pop Fizz", "Gusto", "Funny Bone"] }),
    ledgerSale({ id: 203, sold: "2026-03-12", net: 14.95, cancelled: "2026-03-13", pieces: ["Eruptor"] }),
    ledgerSale({ id: 204, sold: "2026-03-16", net: 17.5, pieces: ["Legendary Stealth Elf"] }),
    ledgerSale({ id: 205, sold: "2026-03-19", net: 4.27, pieces: ["Ignitor|Ignitor|SKY-0045|SA"] }),
    ledgerSale({ id: 206, sold: "2026-03-23", net: 4.27, pieces: ["Chop Chop"] }),
  ],
};

const run = runReconciliation(
  [{ name: "synthetic-2026.csv", text: ebayReport(chained([...anchors.orders, ...CASES.orders, ...COUNTER.orders])) }],
  [...anchors.sales, ...CASES.sales, ...COUNTER.sales],
);

const findings = (orderRef: string): Finding[] => rowFor(run, { orderRef }).diff?.findings ?? [];
const deviations = (orderRef: string) => findings(orderRef).filter((f) => f.kind === "deviation");
const field = (orderRef: string, name: Finding["field"]) => findings(orderRef).find((f) => f.field === name);

describe("the nine known deviations", () => {
  it("① ② find both orders of one day, each one day early", () => {
    for (const ref of ["01-00000-00001", "01-00000-00002"]) {
      const row = rowFor(run, { orderRef: ref });
      expect(row.category).toBe("deviating");
      expect(row.entry.kind === "pair" && row.entry.certainty).toBe("unique");
      expect(deviations(ref).map((f) => [f.field, f.ledger, f.external, f.delta])).toEqual([["sold_on", "2026-02-17", "2026-02-18", -1]]);
      expect(deviations(ref)[0].causes).toEqual([]);
    }
  });

  it("③ finds a date three days early", () => {
    expect(rowFor(run, { orderRef: "01-00000-00003" }).category).toBe("deviating");
    expect(deviations("01-00000-00003").map((f) => [f.field, f.delta])).toEqual([["sold_on", -3]]);
  });

  it("④ finds a date two days late and names the payment day as a possible cause", () => {
    const date = field("01-00000-00004", "sold_on");
    expect(date?.delta).toBe(2);
    expect(date?.causes.map((c) => c.code)).toContain("matches_payment_date");
    expect(deviations("01-00000-00004")).toHaveLength(1);
  });

  it("⑤ finds three Fire Reactors at eBay against one in SkyIsles, with the money equal", () => {
    const ref = "01-00000-00005";
    const row = rowFor(run, { orderRef: ref });
    expect(row.category).toBe("deviating");
    // Per figure: Fire Reactor 3 at eBay, 1 in SkyIsles — the real case of the analysis.
    if (row.entry.kind !== "pair") throw new Error("expected a pair");
    const fireReactors = (names: string[]) => names.filter((n) => n.startsWith("Fire Reactor")).length;
    expect(fireReactors(row.entry.order.lines.flatMap((l) => Array<string>(l.quantity).fill(l.name)))).toBe(3);
    expect(fireReactors(row.entry.sale.pieces.map((p) => p.name ?? ""))).toBe(1);
    // Per order: Water Armor + Dark Pyramid + 3 Fire Reactor = 5 pieces against 3 — the same −2.
    expect(field(ref, "pieces")).toMatchObject({ ledger: 3, external: 5, delta: -2 });
    expect(deviations(ref).filter((f) => f.field === "figure").map((f) => [f.ledger, f.external])).toEqual([
      [null, "Fire Reactor (Crystal)"], [null, "Fire Reactor (Crystal)"],
    ]);
    expect(field(ref, "items_net")).toBeUndefined();
    expect(field(ref, "total")).toBeUndefined();
  });

  it("⑥ finds Scorp sold where Scorpion Striker Catapult is booked", () => {
    const ref = "01-00000-00006";
    const row = rowFor(run, { orderRef: ref });
    expect(row.category).toBe("deviating");
    expect(row.entry.kind === "pair" && row.entry.certainty).toBe("unique");
    expect(deviations(ref).map((f) => [f.field, f.ledger, f.external])).toEqual([["figure", "Scorpion Striker Catapult", "Scorp"]]);
  });

  it("⑦ pairs a portal with another model number only as probable", () => {
    const ref = "01-00000-00007";
    const row = rowFor(run, { orderRef: ref });
    expect(row.category).toBe("probable");
    expect(row.entry.kind === "pair" && row.entry.certainty).toBe("probable");
    expect(deviations(ref).map((f) => [f.field, f.ledger, f.external])).toEqual([
      ["figure", "83973080A Wireless (SA)", "Portal 84148790 (Wireless)"],
    ]);
  });

  it("⑧ finds the 49,18 € of an order eBay shows as 0,00 € — and only suggests a cancellation", () => {
    const total = field("01-00000-00008", "total");
    expect(total).toMatchObject({ ledger: 49.18, external: 0, delta: 49.18 });
    expect(total?.causes.map((c) => c.code)).toEqual(["report_total_zero_not_shipped"]);
    // A refund or cancellation is not a value to copy.
    expect(total?.decisions).not.toContain("take_external");
    expect(deviations("01-00000-00008")).toHaveLength(1);
  });

  it("⑨ finds the 6,99 € refund SkyIsles lacks — as a possible cause, not a fact", () => {
    const total = field("01-00000-00009", "total");
    expect(total).toMatchObject({ ledger: 20.55, external: 13.56, delta: 6.99 });
    expect(total?.causes).toEqual([{ code: "report_total_reduced", amount: 6.99 }]);
  });

  it("finds exactly these nine — eight certain, one probable", () => {
    const refs = (category: string) => run.rows.filter((r) => r.category === category)
      .map((r) => (r.entry.kind === "pair" ? r.entry.order.orderRef : "")).sort();
    expect(refs("deviating")).toEqual(["01-00000-00001", "01-00000-00002", "01-00000-00003", "01-00000-00004",
      "01-00000-00005", "01-00000-00006", "01-00000-00008", "01-00000-00009"]);
    expect(refs("probable")).toEqual(["01-00000-00007"]);
    expect(run.summary.categories).toMatchObject({ exact: 8, deviating: 8, probable: 1, ambiguous: 0, external_only: 0, ledger_only: 0 });
  });

  it("adds up the money it can prove — over certain pairs only", () => {
    expect(run.summary.money.total).toEqual({ positive: 56.17, negative: 0, balance: 56.17, count: 2 });
    expect(run.summary.money.items_net.count).toBe(0);
    expect(run.summary.money.shipping.count).toBe(0);
    expect(run.summary.deviations).toEqual({ sold_on: 4, items_net: 0, shipping: 0, pieces: 1, figure: 3, total: 2 });
  });
});

describe("what must not be reported", () => {
  it("compares goods AFTER discount — 19,00 € less 0,95 € is eBay's 18,05 €", () => {
    expect(rowFor(run, { orderRef: "02-00000-00001" }).category).toBe("exact");
    expect(field("02-00000-00001", "items_net")).toBeUndefined();
  });

  it("accepts a refund SkyIsles already recorded", () => {
    expect(rowFor(run, { orderRef: "02-00000-00002" }).category).toBe("exact");
  });

  it("accepts a cancellation SkyIsles already recorded", () => {
    expect(rowFor(run, { orderRef: "02-00000-00003" }).category).toBe("exact");
  });

  it("treats a different spelling as a hint, not a deviation", () => {
    const row = rowFor(run, { orderRef: "02-00000-00004" });
    expect(row.category).toBe("exact");
    expect(row.diff?.hints).toEqual([expect.objectContaining({ code: "name_spelling", tier: "normalized" })]);
  });

  it("treats a series named by the listing title as a hint, not a deviation", () => {
    const row = rowFor(run, { orderRef: "02-00000-00005" });
    expect(row.category).toBe("exact");
    expect(row.diff?.hints).toEqual([{ code: "series", line: 0, piece: 0, listing: "G", ledger: "SA" }]);
  });

  it("offers a missing order reference as an addition, which does not make a sale deviating", () => {
    const ref = field("02-00000-00006", "external_order_ref");
    expect(ref).toMatchObject({ kind: "addition", ledger: null, external: "02-00000-00006" });
    expect(ref?.decisions).toEqual(["take_external", "keep_ledger", "defer"]);
    expect(rowFor(run, { orderRef: "02-00000-00006" }).category).toBe("exact");
    expect(run.summary.referenceAdditions).toBe(run.rows.filter((r) => r.entry.kind === "pair").length);
  });
});
