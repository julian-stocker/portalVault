import { describe, expect, it } from "vitest";

import {
  BUSINESS_CUT, DATE_REPAIRS, classifyLegacyRows, eventFingerprint, groupDate,
  ORDER_2026_PURCHASE_COLUMNS, ORDER_2026_SALE_COLUMNS,
  isDamaged, orderRowsFromGrid, planPosition, planProblems, referenceKey,
  technicalFingerprint, type OrderRow, type Resolver,
} from "./legacy-history";

/** 2026-01-01 as an Excel serial, so the fixtures read like the workbook. */
const SERIAL_2026_01_01 = 46023;
const serial = (isoDaysAfterNewYear: number) => String(SERIAL_2026_01_01 + isoDaysAfterNewYear);

const row = (over: Partial<OrderRow> & { row: number }): OrderRow => ({
  header: false, dateRaw: "", name: "", reference: "",
  conditionFlag: "", stockFlag: "x", position: "1", ...over,
});
const header = (r: number): OrderRow => row({ row: r, header: true, dateRaw: "Datum" });

/** Every reference resolves, unless it names the accessory sheet. */
const resolve: Resolver = (reference) =>
  reference.startsWith("ZB!")
    ? { skyId: null, reason: "not_a_figure" }
    : { skyId: `SKY-${reference.replace(/\W/g, "")}`, reason: null };

const classify = (rows: OrderRow[], side: "purchase" | "sale" = "sale") =>
  classifyLegacyRows(rows, side, { sheet: "Order 2026", resolve, today: "2026-09-21" });

describe("the group date belongs to the first row and to no other", () => {
  /**
   * The observed trap: `Order 2026!K185` holds a lone `.` in the middle of a
   * group that opened at K179 with a real serial. Reading a date from every
   * row turned seven perfectly good sales into undated ones, which pushed
   * seven units into the opening balance that belong in the 2026 history.
   */
  it("ignores a stray character inside a group", () => {
    const events = classify([
      header(4),
      row({ row: 5, dateRaw: serial(10), name: "Bash", reference: "SA!I11" }),
      row({ row: 6, name: "Camo", reference: "SA!I18", position: "2" }),
      row({ row: 7, dateRaw: ".", name: "Hex", reference: "SA!I47", position: "3" }),
    ]);
    expect(events.map((e) => e.occurredAt)).toEqual(["2026-01-11", "2026-01-11", "2026-01-11"]);
    expect(events.every((e) => e.excluded === null)).toBe(true);
  });

  it("starts a new group only after a header", () => {
    const events = classify([
      header(4),
      row({ row: 5, dateRaw: serial(0), name: "Bash", reference: "SA!I11" }),
      header(6),
      row({ row: 7, dateRaw: serial(40), name: "Camo", reference: "SA!I18" }),
    ]);
    expect(events.map((e) => e.occurredAt)).toEqual(["2026-01-01", "2026-02-10"]);
  });
});

describe("date repairs are a short, justified list", () => {
  it("repairs only the one the workbook pins", () => {
    expect(groupDate("16.04.206")).toBe("2026-04-16");
    expect(Object.keys(DATE_REPAIRS)).toEqual(["16.04.206"]);
  });

  it("never repairs the future-dated group", () => {
    // 2026-12-31. It is almost certainly 2025-12-31, and "almost certainly"
    // is not a repair — it is excluded and reported instead.
    expect(DATE_REPAIRS["46387"]).toBeUndefined();
    const [event] = classify([header(4), row({ row: 5, dateRaw: "46387", name: "X", reference: "G!I50" })]);
    expect(event.occurredAt).toBe("2026-12-31");
    expect(event.excluded).toBe("future_date");
  });

  it("marks an unreadable date rather than guessing one", () => {
    const [event] = classify([header(4), row({ row: 5, dateRaw: "kaputt", name: "X", reference: "G!I50" })]);
    expect(event.excluded).toBe("unreadable_date");
  });
});

describe("the business cut is absolute", () => {
  it("excludes everything before 2026-01-01", () => {
    const [event] = classify([header(4),
      row({ row: 5, dateRaw: String(SERIAL_2026_01_01 - 1), name: "X", reference: "G!I50" })]);
    expect(event.occurredAt).toBe("2025-12-31");
    expect(event.excluded).toBe("before_cut");
  });

  it("includes the cut day itself", () => {
    const [event] = classify([header(4), row({ row: 5, dateRaw: serial(0), name: "X", reference: "G!I50" })]);
    expect(event.occurredAt).toBe(BUSINESS_CUT);
    expect(event.excluded).toBeNull();
  });
});

describe("what never becomes a stock event", () => {
  it("drops a damaged row however the damage is written", () => {
    for (const [name, flag] of [["Hex (B)", ""], ["Snap Shot - BESCHÄDIGT", ""], ["Hex", "b"]] as const) {
      const [event] = classify([header(4),
        row({ row: 5, dateRaw: serial(5), name, reference: "SA!I47", conditionFlag: flag })]);
      expect(event.excluded, name).toBe("damaged");
    }
  });

  it("drops a row whose value cell is not a reference", () => {
    const [event] = classify([header(4), row({ row: 5, dateRaw: serial(5), name: "0000586 (T)", reference: "" })]);
    expect(event.excluded).toBe("no_reference");
  });

  it("drops a reference that is not a figure", () => {
    const [event] = classify([header(4), row({ row: 5, dateRaw: serial(5), name: "Portal", reference: "ZB!I8" })]);
    expect(event.excluded).toBe("not_a_figure");
  });

  it("drops a position the workbook did not move through stock", () => {
    for (const flag of ["-", "r", ""]) {
      const [event] = classify([header(4),
        row({ row: 5, dateRaw: serial(5), name: "X", reference: "G!I50", stockFlag: flag })]);
      expect(event.excluded, flag).toBe("not_stock_relevant");
    }
  });

  it("asks about damage before anything else", () => {
    // A damaged row that is ALSO before the cut must report the damage: the
    // reason drives the operator's report, and "excluded because old" would
    // hide that the workbook itself discarded the piece.
    const [event] = classify([header(4),
      row({ row: 5, dateRaw: String(SERIAL_2026_01_01 - 5), name: "Hex (B)", reference: "SA!I47" })]);
    expect(event.excluded).toBe("damaged");
  });
});

describe("corrections are the workbook's own", () => {
  /**
   * `Order 2026` rows 654-656 carry no running number and the first is
   * labelled `Korrektur >`. The workbook counts them as outgoing itself: for
   * `I!74` its sold counter reads 5 = 3 sales + 2 corrections. So the sign is
   * measured, not chosen.
   */
  it("reads a sale row without a number as a correction that leaves stock", () => {
    const [event] = classify([header(4),
      row({ row: 5, dateRaw: serial(100), name: "Fire Reactor", reference: "I!I74", position: "" })]);
    expect(event.kind).toBe("correction");
    expect(event.quantity).toBe(-1);
    expect(event.excluded).toBeNull();
  });

  it("does not require the stock marker on a correction", () => {
    const [event] = classify([header(4),
      row({ row: 5, dateRaw: serial(100), name: "Fire Reactor", reference: "I!I74",
            position: "", stockFlag: "" })]);
    expect(event.excluded).toBeNull();
  });

  it("never reads a purchase row as a correction", () => {
    const [event] = classifyLegacyRows(
      [header(4), row({ row: 5, dateRaw: serial(100), name: "Bash", reference: "SA!I11", position: "" })],
      "purchase", { sheet: "Order 2026", resolve, today: "2026-09-21" });
    expect(event.kind).toBe("purchase");
    expect(event.quantity).toBe(1);
  });
});

describe("the reference is the identity", () => {
  it("reads only a market-value reference into column I", () => {
    expect(referenceKey("T!I124")).toBe("T!124");
    expect(referenceKey("=T!$I$124")).toBe("T!124");
    expect(referenceKey("'DI A'!I83")).toBe("DI A!83");
    expect(referenceKey("SUM(P5:P8)")).toBeNull();
    expect(referenceKey("ZB!B13")).toBeNull();
  });

  it("does not look at the free text when a reference is present", () => {
    // `Order 2026!1381` says `Kaos` and means SKY-0419 [T], not SKY-0563 [I].
    const [event] = classify([header(4),
      row({ row: 1381, dateRaw: serial(250), name: "Kaos", reference: "T!I124" })]);
    expect(event.skyId).toBe("SKY-T124");
  });

  it("recognises damage markers without mistaking a variant name", () => {
    expect(isDamaged("Hex (B)", "")).toBe(true);
    expect(isDamaged("Blast Zone (Dark)", "")).toBe(false);
    expect(isDamaged("0000502 (G)", "")).toBe(false);
  });
});

describe("the backwards reconstruction", () => {
  const events = (kinds: ("purchase" | "sale" | "correction")[]) =>
    kinds.map((kind, index) => ({
      kind, sourceSheet: "Order 2026", sourceRow: 100 + index, occurredAt: "2026-03-01",
      rawName: "X", reference: "G!50", skyId: "SKY-0001",
      quantity: kind === "purchase" ? 1 : -1, excluded: null,
    }));

  it("derives the start from the workbook's final stock", () => {
    // final 4, net +1 from two purchases and one sale, so the start was 3.
    const plan = planPosition("SKY-0001", 4, events(["purchase", "purchase", "sale"]));
    expect(plan.rawStart).toBe(3);
    expect(plan.openingBalance).toBe(3);
    expect(plan.legacyAdjustment).toBe(0);
    expect(plan.reconstructedFinal).toBe(4);
  });

  it("clamps a negative start and carries the remainder as an adjustment", () => {
    const plan = planPosition("SKY-0008", 0, events(["purchase", "purchase", "sale"]));
    expect(plan.rawStart).toBe(-1);
    expect(plan.openingBalance).toBe(0);
    expect(plan.legacyAdjustment).toBe(-1);
    // The point of the whole exercise: the end still lands on the workbook.
    expect(plan.reconstructedFinal).toBe(0);
  });

  it("counts a correction as leaving stock but not as a sale", () => {
    const plan = planPosition("SKY-0597", 2, events(["purchase", "correction"]));
    expect(plan.purchases).toBe(1);
    expect(plan.sales).toBe(0);
    expect(plan.corrections).toBe(1);
    expect(plan.rawStart).toBe(2);
    expect(plan.reconstructedFinal).toBe(2);
  });

  it("ignores excluded events entirely", () => {
    const mixed = [...events(["purchase"]), { ...events(["purchase"])[0], excluded: "before_cut" as const }];
    const plan = planPosition("SKY-0001", 3, mixed);
    expect(plan.purchases).toBe(1);
    expect(plan.rawStart).toBe(2);
  });

  it("lands on the workbook for a position with no events at all", () => {
    const plan = planPosition("SKY-0500", 7, []);
    expect(plan.openingBalance).toBe(7);
    expect(plan.reconstructedFinal).toBe(7);
  });
});

describe("the gate before anything is written", () => {
  const good = planPosition("SKY-0001", 4, []);

  it("passes a plan that lands on the workbook", () => {
    expect(planProblems([good])).toEqual([]);
  });

  it("accepts a negative adjustment, which is the whole point of it", () => {
    const clamped = planPosition("SKY-0008", 0, [{
      kind: "purchase", sourceSheet: "Order 2026", sourceRow: 1, occurredAt: "2026-03-01",
      rawName: "X", reference: "SA!12", skyId: "SKY-0008", quantity: 1, excluded: null,
    }]);
    expect(clamped.legacyAdjustment).toBe(-1);
    expect(planProblems([clamped])).toEqual([]);
  });

  it("refuses a plan whose end is not the workbook's", () => {
    const broken = { ...good, reconstructedFinal: 3 };
    expect(planProblems([broken])).toHaveLength(1);
    expect(planProblems([broken])[0].problem).toContain("workbook says 4");
  });

  it("refuses a negative opening balance", () => {
    expect(planProblems([{ ...good, openingBalance: -1 }])).not.toEqual([]);
  });
});

describe("fingerprints are stable, readable and distinct", () => {
  it("names the workbook row, so a row can be found from the database", () => {
    expect(eventFingerprint({ kind: "sale", sourceSheet: "Order 2026", sourceRow: 1381 }))
      .toBe("legacy-2026-v1|sale|Order 2026!1381");
  });

  it("separates the two events a single row could never both be", () => {
    const a = eventFingerprint({ kind: "sale", sourceSheet: "Order 2026", sourceRow: 5 });
    const b = eventFingerprint({ kind: "correction", sourceSheet: "Order 2026", sourceRow: 5 });
    expect(a).not.toBe(b);
  });

  it("gives each position one opening and one adjustment identity", () => {
    expect(technicalFingerprint("opening_balance", "SKY-0007"))
      .toBe("legacy-2026-v1|opening_balance|SKY-0007|loose");
    expect(technicalFingerprint("legacy_adjustment", "SKY-0007"))
      .not.toBe(technicalFingerprint("opening_balance", "SKY-0007"));
    expect(technicalFingerprint("opening_balance", "SKY-0007", "boxed"))
      .not.toBe(technicalFingerprint("opening_balance", "SKY-0007", "loose"));
  });
});

describe("shaping an order block out of a worksheet grid", () => {
  const grid = (rows: Record<number, Record<string, string>>) =>
    new Map(Object.entries(rows).map(([row, cells]) =>
      [Number(row), new Map(Object.entries(cells).map(([column, value]) =>
        [column, { value, formula: column === "P" || column === "G" ? value : "" }]))]));

  /**
   * Row 4 holds the first group header of BOTH blocks. Starting the window at
   * row 5 reads like "the first row with data" and leaves the first group of
   * each block undated — which is exactly how fifty dated 2026 sales once
   * ended up inside the reconstructed opening balance instead.
   */
  it("includes row 4, because that is where the first header lives", () => {
    const rows = orderRowsFromGrid(grid({
      1: { K: "Datum" },
      2: { K: "291" },
      4: { K: "Datum" },
      5: { K: "46023", O: "Bash", P: "SA!I11", N: "1", L: "x" },
    }), ORDER_2026_SALE_COLUMNS);

    expect(rows.map((r) => r.row)).toEqual([4, 5]);
    expect(rows[0].header).toBe(true);
    const [event] = classifyLegacyRows(rows, "sale",
      { sheet: "Order 2026", resolve, today: "2026-09-21" });
    expect(event.occurredAt).toBe("2026-01-01");
    expect(event.excluded).toBeNull();
  });

  it("keeps rows 1 to 3 out, totals and German captions alike", () => {
    const rows = orderRowsFromGrid(grid({
      1: { A: "Datum" }, 2: { A: "" }, 3: {}, 4: { A: "Date" },
    }), ORDER_2026_PURCHASE_COLUMNS);
    expect(rows.map((r) => r.row)).toEqual([4]);
  });

  it("does not treat a distant header as this row's group opener", () => {
    // Row 8 is absent from the grid entirely, so the previous ARRAY element
    // of row 9 is the header at row 7 — while the row above is not.
    const rows = orderRowsFromGrid(grid({
      4: { K: "Datum" },
      5: { K: "46023", O: "Bash", P: "SA!I11", N: "1", L: "x" },
      7: { K: "Datum" },
      9: { K: "kaputt", O: "Camo", P: "SA!I18", N: "1", L: "x" },
    }), ORDER_2026_SALE_COLUMNS);

    const events = classifyLegacyRows(rows, "sale",
      { sheet: "Order 2026", resolve, today: "2026-09-21" });
    // Row 9 keeps the group date it inherited; its own unreadable cell is
    // not a group opener and must not blank the date.
    expect(events.map((e) => e.occurredAt)).toEqual(["2026-01-01", "2026-01-01"]);
  });

  it("reads the sale block by worksheet letter, not by printed header", () => {
    // The column HEADED `T` is worksheet `L`. Worksheet `T` is the country.
    expect(ORDER_2026_SALE_COLUMNS.stock).toBe("L");
    expect(ORDER_2026_SALE_COLUMNS.position).toBe("N");
    expect(ORDER_2026_PURCHASE_COLUMNS.stock).toBe("D");
  });
});
