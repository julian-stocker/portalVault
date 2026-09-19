/**
 * Choosing figures while creating a purchase, and correcting them afterwards
 * (0064, ADR-0091).
 *
 * WHAT THIS FILE IS DEFENDING
 *
 * 1. THE DRAFT IS NOT A PURCHASE. Clicking a search result writes nothing.
 *    The temptation when "make the figures selectable on the create screen"
 *    arrives is to create the purchase on the first click and add items to
 *    it — which leaves an abandoned purchase every time somebody changes
 *    their mind. Nothing below calls anything.
 *
 * 2. ONE ROW PER PHYSICAL UNIT SURVIVES THE CONVENIENCE. The draft groups by
 *    SKY-ID so three Wash Bucklers are one line with a quantity; the payload
 *    expands them again into three elements. If that expansion were ever
 *    dropped, a quantity column would follow, and a purchase item would stop
 *    being one object that can be booked, damaged and valued on its own.
 *
 * 3. UNKNOWN IS NOT ZERO, live as well as stored. The screen values the draft
 *    with the SAME function the ledger uses, so a missing market price cannot
 *    quietly become €0 on the way in.
 *
 * 4. REMOVAL AND REMAPPING ARE DIFFERENT ACTS with different rules. A
 *    historical line's FIGURE may be corrected — 0054 exists for that — and
 *    the line itself may not be deleted. Getting this backwards would either
 *    freeze 2 114 workbook rows nobody can fix or make them one click from
 *    gone.
 *
 * 5. NOTHING HERE TOUCHES INVENTORY. Not the draft, not the create RPC, not
 *    the removal.
 */
import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { de } from "@/lib/i18n/de";
import { allMigrations, code, latestFunction, migrationSource } from "@/test-support/migrations";
import {
  MAX_DRAFT_UNITS, addFigure, draftPayload, draftUnitCount, draftUnits, draftValue,
  removeFigure, replaceFigure, setQuantity, type DraftLine,
} from "./draft.ts";
import {
  MIN_QUERY, moveHighlight, rankFigure, searchFigures, searchState, type FigureChoice,
} from "./figure-search.ts";
import { canRemapItem, canRemoveItem, type ItemState } from "./purchase.ts";

const SQL = migrationSource("0064_purchase_create_with_items.sql");
const CREATE_WITH_ITEMS = code(latestFunction("seller_create_purchase_with_items").body);
const REMOVE_ITEM = code(latestFunction("seller_remove_purchase_item").body);

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const NEW_PURCHASE = read("src/components/business/new-purchase.tsx");
const NEW_PURCHASE_PAGE = read("src/app/(business)/business/orderbuch/neu/page.tsx");
const DRAFT_UI = read("src/components/business/figure-draft.tsx");
const SEARCH_UI = read("src/components/business/figure-search.tsx");
const ITEMS_UI = read("src/components/business/purchase-items.tsx");
const ADD_ITEM_UI = read("src/components/business/add-purchase-item.tsx");
const PURCHASE_PAGE = read("src/app/(business)/business/orderbuch/[id]/page.tsx");
const ACTIONS = read("src/lib/orderbook/actions.ts");

/* --------------------------------------------------------------------- */
/* Fixtures. Real Staging shapes: a priced figure, a variant of it, and a  */
/* catalog row with no market price at all.                               */
/* --------------------------------------------------------------------- */

const FREE_RANGER: FigureChoice =
  { skyId: "SKY-0301", name: "Free Ranger", series: "SF", marketPrice: 11.99 };
const LEGENDARY: FigureChoice =
  { skyId: "SKY-0302", name: "Legendary Free Ranger", series: "SF", marketPrice: 14.99 };
const IGNITOR: FigureChoice =
  { skyId: "SKY-0101", name: "Ignitor", series: "G", marketPrice: 8.5 };
const STEALTH: FigureChoice =
  { skyId: "SKY-0012", name: "Stealth Elf", series: "SA", marketPrice: 6.99 };
const WASH: FigureChoice =
  { skyId: "SKY-0212", name: "Wash Buckler", series: "SF", marketPrice: 9.0 };
const DARK_WASH: FigureChoice =
  { skyId: "SKY-0213", name: "Dark Wash Buckler", series: "SF", marketPrice: 19.5 };
const UNPRICED: FigureChoice =
  { skyId: "SKY-0777", name: "Ohne Preis", series: "I", marketPrice: null };

const CATALOG = [FREE_RANGER, LEGENDARY, IGNITOR, STEALTH, WASH, DARK_WASH, UNPRICED];

const item = (over: Partial<{
  state: ItemState; movementId: number | null;
  legacyConditionFlag: string | null; legacyBookedFlag: string | null;
}> = {}) => ({
  state: "ordered" as ItemState,
  movementId: null as number | null,
  legacyConditionFlag: null as string | null,
  legacyBookedFlag: null as string | null,
  ...over,
});

/* ===================================================================== */
describe("the draft — a purchase that does not exist yet", () => {
  it("starts empty and a selection adds one unit", () => {
    const one = addFigure([], FREE_RANGER);
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ skyId: "SKY-0301", name: "Free Ranger", quantity: 1 });
  });

  it("keeps the canonical identity, not the typed name", () => {
    expect(addFigure([], FREE_RANGER)[0].skyId).toBe("SKY-0301");
  });

  it("selecting the same figure again raises the quantity rather than duplicating the line", () => {
    const twice = addFigure(addFigure([], WASH), WASH);
    expect(twice).toHaveLength(1);
    expect(twice[0].quantity).toBe(2);
  });

  it("DUPLICATES BECOME SEPARATE ROWS: three Wash Bucklers are three payload elements", () => {
    const three = addFigure(addFigure(addFigure([], WASH), WASH), WASH);
    expect(three[0].quantity).toBe(3);
    const payload = draftPayload(three);
    expect(payload).toHaveLength(3);
    expect(payload).toEqual([
      { sky_id: "SKY-0212" }, { sky_id: "SKY-0212" }, { sky_id: "SKY-0212" },
    ]);
  });

  it("never sends a quantity to the database", () => {
    const payload = draftPayload(setQuantity(addFigure([], WASH), "SKY-0212", 4));
    expect(payload).toHaveLength(4);
    for (const element of payload) expect(Object.keys(element)).toEqual(["sky_id"]);
  });

  it("a mixed parcel expands in draft order", () => {
    let d: DraftLine[] = [];
    d = addFigure(d, FREE_RANGER);
    d = addFigure(d, IGNITOR);
    d = addFigure(d, IGNITOR);
    d = addFigure(d, STEALTH);
    expect(draftPayload(d).map((p) => p.sky_id))
      .toEqual(["SKY-0301", "SKY-0101", "SKY-0101", "SKY-0012"]);
  });

  it("removes a line and every unit of it", () => {
    const d = setQuantity(addFigure(addFigure([], WASH), IGNITOR), "SKY-0212", 3);
    const after = removeFigure(d, "SKY-0212");
    expect(after.map((l) => l.skyId)).toEqual(["SKY-0101"]);
    expect(draftUnitCount(after)).toBe(1);
  });

  it("stepping below one removes the line — the − at 1 means 'not this one'", () => {
    const d = addFigure([], WASH);
    expect(setQuantity(d, "SKY-0212", 0)).toEqual([]);
    expect(setQuantity(d, "SKY-0212", -3)).toEqual([]);
  });

  it("ignores a quantity that is not a number", () => {
    const d = addFigure([], WASH);
    expect(setQuantity(d, "SKY-0212", Number.NaN)).toEqual([]);
  });

  it("caps a line at the same ceiling the migration enforces", () => {
    const d = setQuantity(addFigure([], WASH), "SKY-0212", 5000);
    expect(d[0].quantity).toBe(MAX_DRAFT_UNITS);
  });

  it("refuses to grow past the ceiling by clicking", () => {
    let d = setQuantity(addFigure([], WASH), "SKY-0212", MAX_DRAFT_UNITS);
    d = addFigure(d, IGNITOR);
    expect(draftUnitCount(d)).toBe(MAX_DRAFT_UNITS);
  });
});

/* ===================================================================== */
describe("changing a wrongly selected figure", () => {
  it("swaps the canonical identity in place, keeping the position", () => {
    let d = addFigure(addFigure([], FREE_RANGER), IGNITOR);
    d = replaceFigure(d, "SKY-0301", LEGENDARY);
    expect(d.map((l) => l.skyId)).toEqual(["SKY-0302", "SKY-0101"]);
    expect(d[0].name).toBe("Legendary Free Ranger");
    expect(d[0].marketPrice).toBe(14.99);
  });

  it("carries the units across — three wrong ones become three right ones", () => {
    const d = replaceFigure(setQuantity(addFigure([], WASH), "SKY-0212", 3), "SKY-0212", DARK_WASH);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ skyId: "SKY-0213", quantity: 3 });
    expect(draftPayload(d)).toHaveLength(3);
  });

  it("MERGES when the replacement is already in the draft, keeping the earlier position", () => {
    let d = addFigure(addFigure([], DARK_WASH), WASH);   // dark first, plain second
    d = setQuantity(d, "SKY-0212", 2);
    d = replaceFigure(d, "SKY-0212", DARK_WASH);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ skyId: "SKY-0213", quantity: 3 });
  });

  it("replacing a line with itself changes nothing but refreshes the display fields", () => {
    const d = replaceFigure(setQuantity(addFigure([], WASH), "SKY-0212", 2), "SKY-0212", WASH);
    expect(d).toHaveLength(1);
    expect(d[0].quantity).toBe(2);
  });

  it("is a no-op for a line that is not there", () => {
    const d = addFigure([], WASH);
    expect(replaceFigure(d, "SKY-9999", IGNITOR)).toEqual(d);
  });
});

/* ===================================================================== */
describe("live market value and factor", () => {
  it("THE WORKED EXAMPLE: 11,99 + 8,50 + 6,99 at 12,50 spent", () => {
    let d: DraftLine[] = [];
    d = addFigure(d, FREE_RANGER);
    d = addFigure(d, IGNITOR);
    d = addFigure(d, STEALTH);
    const v = draftValue(12.5, d);
    expect(draftUnitCount(d)).toBe(3);
    expect(v.knownValue).toBe(27.48);
    expect(v.knownItems).toBe(3);
    expect(v.percent).toBe(45.5);
    expect(v.complete).toBe(true);
  });

  it("moves the moment a figure is added", () => {
    const before = draftValue(12.5, addFigure([], FREE_RANGER));
    const after = draftValue(12.5, addFigure(addFigure([], FREE_RANGER), IGNITOR));
    expect(before.knownValue).toBe(11.99);
    expect(after.knownValue).toBe(20.49);
  });

  it("moves when a figure is removed", () => {
    const d = addFigure(addFigure([], FREE_RANGER), IGNITOR);
    expect(draftValue(12.5, removeFigure(d, "SKY-0101")).knownValue).toBe(11.99);
  });

  it("moves when a figure is replaced", () => {
    const d = replaceFigure(addFigure([], WASH), "SKY-0212", DARK_WASH);
    expect(draftValue(10, d).knownValue).toBe(19.5);
  });

  it("moves when the quantity changes", () => {
    const d = setQuantity(addFigure([], FREE_RANGER), "SKY-0301", 3);
    expect(draftValue(12.5, d).knownValue).toBe(35.97);
  });

  it("moves when only the amount changes", () => {
    const d = addFigure([], FREE_RANGER);
    expect(draftValue(6, d).percent).toBe(50);
    expect(draftValue(12, d).percent).toBe(100.1);
  });

  it("A MISSING MARKET PRICE IS NOT ZERO — it is counted and named", () => {
    const d = addFigure(addFigure([], FREE_RANGER), UNPRICED);
    const v = draftValue(12.5, d);
    expect(v.knownValue).toBe(11.99);
    expect(v.knownItems).toBe(1);
    expect(v.countedItems).toBe(2);
    expect(v.unknownItems).toBe(1);
    expect(v.complete).toBe(false);
  });

  it("no priced figure at all yields no factor, never Infinity or NaN", () => {
    const v = draftValue(12.5, addFigure([], UNPRICED));
    expect(v.knownValue).toBe(0);
    expect(v.factor).toBeNull();
    expect(v.percent).toBeNull();
    expect(Number.isNaN(v.percent as unknown as number)).toBe(false);
  });

  it("an empty draft yields no factor", () => {
    const v = draftValue(12.5, []);
    expect(v.factor).toBeNull();
    expect(v.countedItems).toBe(0);
  });

  it("zero spent on priced figures is a real 0 %, not 'unknown'", () => {
    expect(draftValue(0, addFigure([], FREE_RANGER)).percent).toBe(0);
  });

  it("values the draft as `ordered`, the state the database will give the rows", () => {
    expect(draftUnits(addFigure([], WASH))).toEqual([{ state: "ordered", marketPrice: 9 }]);
  });
});

/* ===================================================================== */
describe("figure search — variants have to be distinguishable", () => {
  it("needs two characters before it answers", () => {
    expect(searchFigures(CATALOG, "w")).toEqual([]);
    expect(MIN_QUERY).toBe(2);
    expect(searchFigures(CATALOG, "wa").length).toBeGreaterThan(0);
  });

  it("puts the plain figure above its variant — the operator is holding the plain one", () => {
    const hits = searchFigures(CATALOG, "wash");
    expect(hits[0].skyId).toBe("SKY-0212");
    expect(hits.map((h) => h.name)).toContain("Dark Wash Buckler");
  });

  it("an exact name wins outright", () => {
    expect(searchFigures(CATALOG, "Free Ranger")[0].skyId).toBe("SKY-0301");
  });

  it("finds a variant by its own name", () => {
    expect(searchFigures(CATALOG, "legendary")[0].skyId).toBe("SKY-0302");
  });

  it("ranks prefix above word-start above contains", () => {
    expect(rankFigure(FREE_RANGER, "free")).toBeLessThan(rankFigure(LEGENDARY, "free") as number);
  });

  it("finds a figure by SKY-ID, which is sometimes what the operator has", () => {
    expect(searchFigures(CATALOG, "0212")[0].skyId).toBe("SKY-0212");
  });

  it("is case-insensitive and ignores surrounding space", () => {
    expect(searchFigures(CATALOG, "  IGNITOR ")[0].skyId).toBe("SKY-0101");
  });

  it("keeps the list short enough to scan, and the limit is honoured", () => {
    expect(searchFigures(CATALOG, "a", 3).length).toBeLessThanOrEqual(3);
    expect(searchFigures(CATALOG, "e", 2).length).toBeLessThanOrEqual(2);
  });

  it("is stable: the same query gives the same order, which is what Enter relies on", () => {
    expect(searchFigures(CATALOG, "wash").map((h) => h.skyId))
      .toEqual(searchFigures(CATALOG, "wash").map((h) => h.skyId));
  });

  it("carries the series and the price, which is what tells two similar rows apart", () => {
    const hit = searchFigures(CATALOG, "ignitor")[0];
    expect(hit.series).toBe("G");
    expect(hit.marketPrice).toBe(8.5);
  });

  it("invents no variant metadata — a result is a catalog row and nothing more", () => {
    expect(Object.keys(searchFigures(CATALOG, "wash")[0]).sort())
      .toEqual(["marketPrice", "name", "series", "skyId"]);
  });

  it("names its four states rather than showing an empty box", () => {
    expect(searchState(CATALOG, "", [])).toBe("idle");
    expect(searchState(CATALOG, "w", [])).toBe("tooShort");
    expect(searchState(CATALOG, "zzzz", [])).toBe("empty");
    expect(searchState(CATALOG, "wash", searchFigures(CATALOG, "wash"))).toBe("results");
    expect(searchState([], "wash", [])).toBe("noCatalog");
  });

  it("clamps the keyboard highlight instead of wrapping past the ends", () => {
    expect(moveHighlight(0, -1, 5)).toBe(0);
    expect(moveHighlight(4, 1, 5)).toBe(4);
    expect(moveHighlight(2, 1, 5)).toBe(3);
    expect(moveHighlight(0, 1, 0)).toBe(0);
  });
});

/* ===================================================================== */
describe("what may be corrected on an existing purchase", () => {
  it("an unbooked hand-made item may be removed and remapped", () => {
    expect(canRemoveItem("manual", item())).toBe(true);
    expect(canRemapItem(item())).toBe(true);
  });

  it("A BOOKED ITEM MAY BE NEITHER", () => {
    const booked = item({ state: "booked", movementId: 552 });
    expect(canRemoveItem("manual", booked)).toBe(false);
    expect(canRemapItem(booked)).toBe(false);
  });

  it("an item owning a movement is refused even if its state says otherwise", () => {
    const odd = item({ state: "arrived", movementId: 552 });
    expect(canRemoveItem("manual", odd)).toBe(false);
    expect(canRemapItem(odd)).toBe(false);
  });

  it("A HISTORICAL ITEM MAY NOT BE REMOVED — its provenance is not regenerable", () => {
    expect(canRemoveItem("excel_order_2026", item({ state: "reconciled_legacy" }))).toBe(false);
  });

  it("nor may one on an imported purchase whose state looks ordinary", () => {
    expect(canRemoveItem("excel_order_2026", item({ state: "ordered" }))).toBe(false);
  });

  it("nor may one carrying either legacy marker", () => {
    expect(canRemoveItem("manual", item({ legacyBookedFlag: "x" }))).toBe(false);
    expect(canRemoveItem("manual", item({ legacyConditionFlag: "lose" }))).toBe(false);
  });

  it("BUT A HISTORICAL ITEM'S FIGURE MAY STILL BE CORRECTED — that is what 0054 is for", () => {
    expect(canRemapItem(item({ state: "reconciled_legacy" }))).toBe(true);
  });

  it("remapping and removing are therefore not the same permission", () => {
    const legacy = item({ state: "reconciled_legacy" });
    expect(canRemapItem(legacy)).toBe(true);
    expect(canRemoveItem("excel_order_2026", legacy)).toBe(false);
  });

  it("damaged and missing hand-made items stay correctable", () => {
    expect(canRemoveItem("manual", item({ state: "damaged" }))).toBe(true);
    expect(canRemoveItem("manual", item({ state: "missing" }))).toBe(true);
  });
});

/* ===================================================================== */
describe("0064 — the migration", () => {
  it("adds exactly the two functions the discovery found missing, and no column", () => {
    expect(SQL).toContain("create or replace function public.seller_create_purchase_with_items");
    expect(SQL).toContain("create or replace function public.seller_remove_purchase_item");
    expect(code(SQL)).not.toContain("add column");
    expect(code(SQL)).not.toContain("drop column");
    expect(code(SQL)).not.toContain("create table");
  });

  it("does not reinvent what already exists", () => {
    // 0053 and 0054 keep owning these; 0064 only calls them.
    expect(SQL).not.toContain("create or replace function public.seller_add_purchase_item");
    expect(SQL).not.toContain("create or replace function public.seller_set_purchase_item_sky");
  });

  it("IS ATOMIC BY DELEGATION: one function body, calling the canonical writers", () => {
    expect(CREATE_WITH_ITEMS).toContain("public.seller_create_purchase(");
    expect(CREATE_WITH_ITEMS).toContain("perform public.seller_add_purchase_item(");
    // No separate transaction control — a plpgsql body IS the transaction here.
    expect(CREATE_WITH_ITEMS).not.toContain("commit");
    expect(CREATE_WITH_ITEMS).not.toContain("exception when");
  });

  it("creates one row per element and collapses nothing", () => {
    expect(CREATE_WITH_ITEMS).toContain("jsonb_array_elements");
    expect(CREATE_WITH_ITEMS).not.toContain("distinct");
    expect(CREATE_WITH_ITEMS).not.toContain("group by");
    expect(CREATE_WITH_ITEMS).not.toContain("quantity");
  });

  it("allows a purchase with no items at all", () => {
    expect(CREATE_WITH_ITEMS).toContain("'[]'::jsonb");
  });

  it("rejects a payload that is not an array, and one that is absurdly long", () => {
    expect(CREATE_WITH_ITEMS).toContain("jsonb_typeof");
    expect(CREATE_WITH_ITEMS).toContain("jsonb_array_length");
    expect(CREATE_WITH_ITEMS).toContain("at most 200 items");
  });

  it("the browser ceiling and the database ceiling are the same number", () => {
    expect(MAX_DRAFT_UNITS).toBe(200);
    expect(CREATE_WITH_ITEMS).toContain("> 200");
  });

  it("REMOVAL NOW REFUSES THE WORKBOOK, three ways over", () => {
    expect(REMOVE_ITEM).toContain("reconciled_legacy");
    expect(REMOVE_ITEM).toContain("source_row is not null");
    expect(REMOVE_ITEM).toContain("legacy_booked_flag is not null");
    expect(REMOVE_ITEM).toContain("legacy_condition_flag is not null");
    expect(REMOVE_ITEM).toContain("is distinct from 'manual'");
  });

  it("and still refuses a booked item first", () => {
    expect(REMOVE_ITEM).toContain("movement_id is not null");
    expect(REMOVE_ITEM.indexOf("movement_id is not null"))
      .toBeLessThan(REMOVE_ITEM.indexOf("reconciled_legacy"));
  });

  it("NO EXECUTABLE STATEMENT TOUCHES INVENTORY", () => {
    /*
     * `code()` strips the prose, which is the point: the header names all
     * three on purpose, to say that nothing below does. Asserting on the raw
     * file would make the comment that documents the invariant break it.
     */
    const body = code(SQL);
    expect(body).not.toContain("record_inventory_movement");
    expect(body).not.toContain("shop_inventory");
    expect(body).not.toContain("inventory_movements");
    // And the promise is actually written down where a reader will find it.
    expect(SQL).toContain("No inventory.");
  });

  it("writes no historical data: no backfill, no update of an existing row", () => {
    const body = code(SQL);
    expect(body).not.toContain("update public.purchases");
    expect(body).not.toContain("update public.purchase_items\n   set sky_id");
    expect(body).not.toContain("insert into public.purchases");
  });

  it("every new or re-signed function is seller-gated, definer, fixed search_path", () => {
    for (const fn of [CREATE_WITH_ITEMS, REMOVE_ITEM]) {
      expect(fn).toContain("security definer");
      expect(fn).toContain("set search_path = ''");
      expect(fn).toContain("public.can_operate_active_seller()");
      expect(fn).toContain("insufficient_privilege");
    }
  });

  it("is revoked from anon and granted only to authenticated", () => {
    expect(SQL).toContain(
      "revoke all on function public.seller_create_purchase_with_items(date, numeric, text, boolean, jsonb)\n  from public, anon;",
    );
    expect(SQL).toContain(
      "grant execute on function public.seller_create_purchase_with_items(date, numeric, text, boolean, jsonb)\n  to authenticated;",
    );
    expect(SQL).toContain("revoke all on function public.seller_remove_purchase_item(bigint) from public, anon;");
    expect(SQL).not.toMatch(/grant[^;]*to\s+anon/);
  });

  it("CHANGES NO RLS AND NO TABLE GRANT", () => {
    const body = code(SQL);
    expect(body).not.toContain("create policy");
    expect(body).not.toContain("drop policy");
    expect(body).not.toContain("enable row level security");
    expect(body).not.toMatch(/grant[^;]*on table/);
  });

  it("is the last word on removal, so the hardening is what actually runs", () => {
    expect(latestFunction("seller_remove_purchase_item").file)
      .toBe("0064_purchase_create_with_items.sql");
  });

  it("the older signature is still the one 0063 left — no accidental overload", () => {
    expect(latestFunction("seller_create_purchase").file)
      .toBe("0063_orderbook_test_classification.sql");
    expect(allMigrations).not.toContain("drop function if exists public.seller_add_purchase_item");
  });
});

/* ===================================================================== */
describe("the create screen", () => {
  it("SEARCHES FOR FIGURES ON THE CREATE SCREEN ITSELF", () => {
    expect(NEW_PURCHASE).toContain("FigureDraft");
    expect(DRAFT_UI).toContain("FigureSearch");
  });

  it("reuses the canonical catalog rather than a second source", () => {
    expect(NEW_PURCHASE_PAGE).toContain("fetchOrderbookCatalog");
    expect(NEW_PURCHASE).not.toContain("supabase");
    expect(NEW_PURCHASE).not.toContain("skylanders");
  });

  it("writes nothing until the button is pressed", () => {
    // The only server action the form imports is the one the submit calls.
    expect(NEW_PURCHASE).toContain("createPurchaseWithItems");
    expect(NEW_PURCHASE).not.toContain("addPurchaseItem");
    expect(DRAFT_UI).not.toContain("@/lib/orderbook/actions");
  });

  it("sends the expanded payload, never the draft lines", () => {
    expect(NEW_PURCHASE).toContain("draftPayload(lines)");
  });

  it("values the draft with the ledger's own arithmetic", () => {
    expect(NEW_PURCHASE).toContain("draftValue");
    expect(read("src/lib/orderbook/draft.ts")).toContain("valuePurchase");
  });

  it("does not force a figure, and says so", () => {
    expect(NEW_PURCHASE).not.toContain("lines.length === 0 ? setError");
    expect(de.business.orderbook.figures.emptyAllowed).toContain("unvollständig");
  });

  it("keeps the nullable date and invents no default", () => {
    expect(NEW_PURCHASE).toContain("date.trim() || null");
    expect(NEW_PURCHASE).not.toContain("new Date()");
  });

  it("keeps the Testvorgang checkbox and its ?test=1 default (0063)", () => {
    expect(NEW_PURCHASE).toContain("defaultTest");
    expect(NEW_PURCHASE).toContain("copy.testFlag");
    expect(NEW_PURCHASE_PAGE).toContain('test === "1"');
  });

  it("adding figures cannot change the test classification", () => {
    expect(CREATE_WITH_ITEMS).toContain("p_is_test");
    // The item loop names no classification column.
    const loop = CREATE_WITH_ITEMS.slice(CREATE_WITH_ITEMS.indexOf("for v_element"));
    expect(loop).not.toContain("is_test");
  });

  it("still says that creating changes no stock", () => {
    expect(NEW_PURCHASE).toContain("createStockHint");
    expect(de.business.orderbook.createStockHint).toContain("ändert den Bestand nicht");
  });

  it("keeps the Notiz field, quieter than the figures", () => {
    expect(NEW_PURCHASE).toContain("Notiz");
    expect(NEW_PURCHASE).toContain("sm:min-h-9");
  });
});

/* ===================================================================== */
describe("the detail screen", () => {
  it("adds, removes and changes through the same picker as the create screen", () => {
    expect(ADD_ITEM_UI).toContain("FigureSearch");
    expect(ITEMS_UI).toContain("FigureSearch");
    // And no second search implementation survives.
    expect(ADD_ITEM_UI).not.toContain(".toLowerCase().includes(");
    expect(ITEMS_UI).not.toContain(".toLowerCase().includes(");
  });

  it("wires removal, which existed in the database and reached no screen before", () => {
    expect(ITEMS_UI).toContain("removePurchaseItem");
    expect(ACTIONS).toContain("seller_remove_purchase_item");
  });

  it("offers neither correction where the database would refuse it", () => {
    expect(ITEMS_UI).toContain("canRemoveItem(source, item)");
    expect(ITEMS_UI).toContain("canRemapItem(item)");
    expect(PURCHASE_PAGE).toContain("source={purchase.source}");
  });

  it("a booked row shows its state instead of a destructive control", () => {
    expect(ITEMS_UI).toContain("copy.booked");
    expect(ITEMS_UI).toContain("copy.unbook");
    expect(de.business.orderbook.booked).toBe("Im Bestand");
  });

  it("revalidates rather than asking the operator to reload", () => {
    expect(ACTIONS).toContain("revalidatePath");
  });

  it("keeps the uncategorised path for a portal or a game", () => {
    expect(ADD_ITEM_UI).toContain("addUncategorized");
  });
});

/* ===================================================================== */
describe("the search box itself", () => {
  it("never submits the form it sits in", () => {
    expect(SEARCH_UI).toContain('event.key === "Enter"');
    expect(SEARCH_UI).toContain("event.preventDefault()");
    expect(SEARCH_UI).toContain('type="button"');
  });

  it("handles Escape and the arrow keys", () => {
    expect(SEARCH_UI).toContain('event.key === "Escape"');
    expect(SEARCH_UI).toContain('event.key === "ArrowDown"');
    expect(SEARCH_UI).toContain("moveHighlight");
  });

  it("refocuses so the next figure can be typed straight away", () => {
    expect(SEARCH_UI).toContain("input.current?.focus()");
  });

  it("makes no request per keystroke, so there is no race to lose", () => {
    expect(SEARCH_UI).not.toContain("fetch(");
    expect(SEARCH_UI).not.toContain("useEffect");
    expect(SEARCH_UI).toContain("useMemo");
  });

  it("is finger-sized on a phone", () => {
    expect(SEARCH_UI).toContain("min-h-11");
    expect(DRAFT_UI).toContain("size-11");
  });

  it("says something in every empty state, in German, and never a raw error", () => {
    const f = de.business.orderbook.figures;
    for (const text of [f.tooShort, f.empty, f.noCatalog, f.none]) {
      expect(text.length).toBeGreaterThan(5);
      expect(text).not.toContain("PGRST");
      expect(text).not.toContain("error");
    }
  });
});

/* ===================================================================== */
describe("the German copy", () => {
  it("names every new string the screens use", () => {
    const f = de.business.orderbook.figures;
    for (const key of ["heading", "search", "empty", "remove", "change", "marketValue",
      "factor", "noMarketValue", "emptyAllowed"] as const) {
      expect(typeof f[key]).toBe("string");
    }
    expect(f.units(1)).toBe("1 Figur");
    expect(f.units(3)).toBe("3 Figuren");
  });

  it("explains a refused removal without blaming the operator", () => {
    const message = de.business.orderbook.errors.historicalItem;
    expect(message).toContain("Excel-Historie");
    expect(message).toContain("Zuordnung ändern");
  });

  it("maps the database's two new refusals to sentences", () => {
    expect(ACTIONS).toContain('text.includes("legacy workbook")');
    expect(ACTIONS).toContain('text.includes("at most 200 items")');
  });
});
