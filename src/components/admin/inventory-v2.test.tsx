/** @vitest-environment jsdom */
/**
 * Lagerverwaltung V2, rendered (AP2–AP4).
 *
 * What a source comparison cannot show: that a release really waits for the
 * second click while taking it back does not; that table and cards each sit
 * behind their CSS breakpoint and a closed table row holds no editor, so only
 * the visible view can be operated; that editing happens in the opened row;
 * that the filters come from the address and go back into it.
 *
 * Every write is mocked and recorded. Nothing here talks to a database.
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MOCK = vi.hoisted(() => ({
  params: new URLSearchParams(),
  listing: [] as Record<string, unknown>[],
  release: [] as Record<string, unknown>[],
  booked: [] as Record<string, unknown>[],
  /* What the next booking answers; `ok: true` unless a test says otherwise. */
  bookResult: { ok: true } as { ok: boolean; message?: string },
  history: 0,
  refreshes: 0,
  /* When set, a booking waits for it — a booking still on its way. */
  gate: null as Promise<void> | null,
}));

vi.mock("next/navigation", () => ({
  /* `refresh` brings no new data here — exactly the moment between a
     booked movement and the new quantity arriving. */
  useRouter: () => ({ push: () => {}, refresh: () => { MOCK.refreshes += 1; } }),
  useSearchParams: () => MOCK.params,
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));
vi.mock("@/lib/admin/actions", () => ({
  setListing: async (input: Record<string, unknown>) => { MOCK.listing.push(input); return { ok: true }; },
  setSaleRelease: async (input: Record<string, unknown>) => { MOCK.release.push(input); return { ok: true }; },
  setDeliveryScope: async () => ({ ok: true }),
  setUskRating: async () => ({ ok: true }),
  bookMovement: async (input: Record<string, unknown>) => {
    MOCK.booked.push(input);
    if (MOCK.gate) await MOCK.gate;
    return MOCK.bookResult;
  },
}));
vi.mock("@/lib/admin/legacy-actions", () => ({
  loadCardHistory: async () => { MOCK.history += 1; return { legacy: [], movements: [] }; },
}));

const { ReleaseToggle } = await import("./release-toggle");
const { InventoryView } = await import("./inventory-view");
const { de } = await import("@/lib/i18n/de");
type InventoryPosition = import("@/lib/admin/inventory-model").InventoryPosition;
type CatalogFigure = import("@/lib/catalog/types").CatalogFigure;

const copy = de.inventory;

function figure(over: Partial<CatalogFigure> = {}): CatalogFigure {
  return {
    skyId: "SKY-0001", name: "Bash", slug: "bash", seriesCode: "SA", seriesLabel: "SA",
    seriesPosition: 0, categoryPosition: 0, categoryName: "Figuren", categoryId: 1,
    catalogGroup: "figure", cardType: "standard", catalogVisible: true, canonicalName: "Bash",
    displayNameOverride: null, marketPrice: 10, imageFile: null, imageOverridePath: null,
    displayName: "Bash", sortBaseName: "Bash", sortVariantLabel: null,
    searchIndex: "bash", isActive: true, element: null, characterId: null, baseSkyId: null,
    itemType: "figure", ...over,
  };
}
function position(over: Partial<InventoryPosition> = {}): InventoryPosition {
  const quantity = over.quantity ?? 2;
  const reserved = over.reserved ?? 0;
  return {
    inventoryId: 1, skyId: "SKY-0001", condition: "loose",
    quantity, reserved, available: over.available ?? quantity - reserved,
    salePrice: null, effectivePrice: 9, priceSource: "automatic", isListed: true,
    note: null, updatedAt: "2026-11-10T00:00:00Z", figure: figure(), ...over,
  };
}

/** Im Shop · Freigabe offen · ohne Preis freigegeben · historisch (OVP) · voll reserviert. */
const STOCK: InventoryPosition[] = [
  position({ inventoryId: 1, skyId: "SKY-0001" }),
  position({
    inventoryId: 2, skyId: "SKY-0002", isListed: false,
    figure: figure({ skyId: "SKY-0002", displayName: "Eruptor", searchIndex: "eruptor" }),
  }),
  position({
    inventoryId: 3, skyId: "SKY-0003", effectivePrice: null,
    figure: figure({ skyId: "SKY-0003", displayName: "Cynder", searchIndex: "cynder", marketPrice: null }),
  }),
  position({
    inventoryId: 4, skyId: "SKY-0004", condition: "boxed", isListed: false,
    figure: figure({ skyId: "SKY-0004", displayName: "Spyro", searchIndex: "spyro" }),
  }),
  /* 3 on the shelf, 3 promised to open orders: the floor is 3. */
  position({
    inventoryId: 5, skyId: "SKY-0005", quantity: 3, reserved: 3,
    figure: figure({ skyId: "SKY-0005", displayName: "Trigger Happy", searchIndex: "trigger happy" }),
  }),
];

let root: Root | null = null;
let container: HTMLElement | null = null;
let pushed: string[] = [];
let replaced: string[] = [];

beforeEach(() => {
  MOCK.params = new URLSearchParams();
  MOCK.listing = []; MOCK.release = []; MOCK.booked = []; MOCK.history = 0; MOCK.refreshes = 0;
  MOCK.bookResult = { ok: true }; MOCK.gate = null;
  pushed = []; replaced = [];
  vi.spyOn(window.history, "pushState").mockImplementation((_s, _t, url) => { pushed.push(String(url)); });
  vi.spyOn(window.history, "replaceState").mockImplementation((_s, _t, url) => { replaced.push(String(url)); });
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container?.remove(); root = null; container = null;
  vi.restoreAllMocks();
});

async function mount(element: ReturnType<typeof createElement>) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => { root!.render(element); });
}
async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const view = () => createElement(InventoryView, {
  positions: STOCK, legacyTotals: {}, tradeTotals: {}, catalog: STOCK.map((p) => p.figure!),
  accessories: [], series: [{ code: "SA", label: "Spyro's Adventure" }] as never,
  outsideScope: 0, percentage: 90,
});
const buttons = (text: string) =>
  [...document.querySelectorAll("button")].filter((b) => b.textContent?.trim() === text);
const select = (label: string) => document.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
async function choose(el: HTMLSelectElement, value: string) {
  await act(async () => {
    el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

/* ===================================================================== */
describe("ReleaseToggle — releasing asks, taking back does not", () => {
  it("does not release on the first click, only after the confirmation", async () => {
    const calls: boolean[] = [];
    await mount(createElement(ReleaseToggle, {
      on: false, onLabel: "Im Shop", offLabel: "Nicht im Shop", name: "Bash",
      pending: false, onChange: (next: boolean) => calls.push(next),
    }));
    await act(async () => { buttons("Nicht im Shop")[0].click(); });
    expect(calls).toEqual([]);
    expect(document.body.textContent).toContain(copy.confirmListing);
    expect(document.body.textContent).toContain(copy.confirmListingHint("Bash"));
    await act(async () => { buttons(copy.confirmListingYes)[0].click(); });
    expect(calls).toEqual([true]);
  });

  it("cancelling releases nothing", async () => {
    const calls: boolean[] = [];
    await mount(createElement(ReleaseToggle, {
      on: false, onLabel: "Im Shop", offLabel: "Nicht im Shop", name: "Bash",
      pending: false, onChange: (next: boolean) => calls.push(next),
    }));
    await act(async () => { buttons("Nicht im Shop")[0].click(); });
    await act(async () => { buttons(copy.confirmListingNo)[0].click(); });
    expect(calls).toEqual([]);
    expect(buttons("Nicht im Shop")).toHaveLength(1);
  });

  it("takes a release back at once, without a confirmation", async () => {
    const calls: boolean[] = [];
    await mount(createElement(ReleaseToggle, {
      on: true, onLabel: "Im Shop", offLabel: "Nicht im Shop", name: "Bash",
      pending: false, onChange: (next: boolean) => calls.push(next),
    }));
    await act(async () => { buttons("Im Shop")[0].click(); });
    expect(calls).toEqual([false]);
    expect(document.body.textContent).not.toContain(copy.confirmListing);
  });
});

/* ===================================================================== */
describe("table and cards — CSS shows one, only one can be operated", () => {
  it("the server's markup already holds both, each behind its breakpoint", async () => {
    await mount(view());
    const table = document.querySelector("table")!;
    expect(table.closest("div")!.className).toBe("hidden md:block");
    const cards = document.querySelectorAll("article");
    expect(cards).toHaveLength(5);
    expect(cards[0].parentElement!.className).toBe("grid gap-3 md:hidden");
    for (const head of [copy.table.article, copy.table.stock, copy.table.reserved,
      copy.table.marketPrice, copy.table.salePrice, copy.table.status]) {
      expect(document.querySelector("thead")!.textContent).toContain(head);
    }
  });

  it("a closed table row holds no editor but the stock control — numbers and a status", async () => {
    await mount(view());
    const table = document.querySelector("table")!;
    /* The draft stepper lives in the details only. */
    expect(table.querySelectorAll(`button[aria-label="${copy.increase}"]`)).toHaveLength(0);
    expect(table.querySelectorAll("button[aria-pressed]")).toHaveLength(0);
    expect(table.querySelectorAll("input")).toHaveLength(0);
    /* Each row: the details button, and on a loose row − and +. */
    for (const body of table.querySelectorAll("tbody")) {
      const labels = [...body.querySelectorAll("button")].map((b) => b.getAttribute("aria-label")!);
      expect(labels.some((l) => l.startsWith("Details zu"))).toBe(true);
      expect(labels.length).toBe(body.textContent!.includes("SKY-0004") ? 1 : 3);
    }
    /* The cards keep their steppers: four loose rows, none for the OVP row. */
    expect(document.querySelectorAll(`article button[aria-label="${copy.increase}"]`)).toHaveLength(4);
  });

  it("the row shows quantity, reserved, prices and the status in its cells", async () => {
    await mount(view());
    const cells = [...row("SKY-0001").querySelectorAll("tr:first-child td")].map((td) => td.textContent!);
    expect(cells[1]).toBe("−2+");
    expect(cells[2]).toBe("0");
    expect(cells[3]).toContain("10");
    expect(cells[4]).toContain(copy.priceAuto);
    expect(cells[5]).toBe(copy.status.offered.label);
  });

  it("table and card name the same status", async () => {
    await mount(view());
    const tableText = document.querySelector("table")!.textContent!;
    for (const label of [copy.status.offered.label, copy.status.release_open.label,
      copy.status.listed_no_price.label, copy.status.historical.label]) {
      expect(tableText, label).toContain(label);
    }
    const cardText = [...document.querySelectorAll("article")].map((a) => a.textContent).join(" ");
    expect(cardText).toContain(copy.status.release_open.hint);
    expect(cardText).toContain(copy.status.listed_no_price.hint);
  });
});

/** The table body of one position. */
function row(skyId: string): HTMLElement {
  return [...document.querySelectorAll("table tbody")].find((b) => b.textContent!.includes(skyId)) as HTMLElement;
}
async function openRow(skyId: string) {
  const expand = row(skyId).querySelector<HTMLButtonElement>("button[aria-controls]")!;
  await act(async () => { expand.click(); });
  return row(skyId);
}

/* ===================================================================== */
describe("the desktop row, opened", () => {
  it("opens by the button and by the row, once per click", async () => {
    await mount(view());
    const body = row("SKY-0002");
    const expand = body.querySelector<HTMLButtonElement>("button[aria-controls]")!;
    expect(expand.getAttribute("aria-label")).toBe(copy.table.showDetails("Eruptor"));
    await act(async () => { expand.click(); });
    expect(expand.getAttribute("aria-expanded")).toBe("true");
    await act(async () => { body.querySelector<HTMLElement>("tr:first-child td")!.click(); });
    expect(expand.getAttribute("aria-expanded")).toBe("false");
  });

  it("only then shows price editor, switch, counters and status sentence — and no second stock control", async () => {
    await mount(view());
    const body = await openRow("SKY-0002");
    const details = body.querySelector<HTMLElement>("[id^=inventory-details-]")!;
    /* The column's − and + stay the only stock control of the table. */
    expect(details.querySelectorAll(`button[aria-label="${copy.increase}"]`)).toHaveLength(0);
    expect(details.querySelectorAll(`button[aria-label="${copy.decrease}"]`)).toHaveLength(0);
    expect(details.textContent).not.toContain(copy.draftSave);
    expect(body.querySelectorAll(`button[aria-label="${copy.increaseBooked("Eruptor")}"]`)).toHaveLength(1);
    expect(body.querySelector("button[aria-pressed]")).not.toBeNull();
    expect(body.textContent).toContain(copy.purchased);
    expect(body.textContent).toContain(copy.status.release_open.hint);
  });

  it("releases only after the confirmation, through set_shop_listing with nothing else changed", async () => {
    await mount(view());
    const body = await openRow("SKY-0002");
    const toggle = [...body.querySelectorAll("button")].find((b) => b.textContent === copy.notListed)!;
    await act(async () => { toggle.click(); });
    expect(MOCK.listing).toEqual([]);
    const yes = [...body.querySelectorAll("button")].find((b) => b.textContent === copy.confirmListingYes)!;
    await act(async () => { yes.click(); });
    await settle();
    expect(MOCK.listing).toEqual([{
      skyId: "SKY-0002", condition: "loose", salePrice: null, isListed: true, note: null,
    }]);
  });

  it("takes a release back at once", async () => {
    await mount(view());
    const body = await openRow("SKY-0001");
    const toggle = [...body.querySelectorAll("button")].find((b) => b.textContent === copy.listed)!;
    await act(async () => { toggle.click(); });
    await settle();
    expect(MOCK.listing).toEqual([expect.objectContaining({ skyId: "SKY-0001", isListed: false })]);
  });

  it("in every opened row, the table offers exactly one − and one +", async () => {
    await mount(view());
    for (const skyId of ["SKY-0001", "SKY-0002", "SKY-0003", "SKY-0005"]) {
      const body = await openRow(skyId);
      expect(body.querySelectorAll("button[aria-label*=\"um 1 erhöhen\"]"), skyId).toHaveLength(1);
      expect(body.querySelectorAll("button[aria-label*=\"um 1 verringern\"]"), skyId).toHaveLength(1);
    }
  });

  it("loads the history only on request", async () => {
    await mount(view());
    const body = await openRow("SKY-0002");
    expect(MOCK.history).toBe(0);
    const history = [...body.querySelectorAll("button")].find((b) => b.textContent!.includes(copy.history))!;
    await act(async () => { history.click(); });
    await settle();
    expect(MOCK.history).toBe(1);
  });

  it("offers an OVP row no stepper, no price editor and no switch (0108)", async () => {
    await mount(view());
    const body = await openRow("SKY-0004");
    expect(body.querySelector(`button[aria-label="${copy.increase}"]`)).toBeNull();
    expect(body.querySelector("button[aria-pressed]")).toBeNull();
    expect(body.textContent).toContain(copy.historicalCondition);
  });
});

/* ===================================================================== */
describe("filters in the address", () => {
  it("reads the status filter from the address", async () => {
    MOCK.params = new URLSearchParams("status=freigabe-offen");
    await mount(view());
    const rows = [...document.querySelectorAll("tbody")].map((b) => b.textContent!);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("SKY-0002");
    expect(select(copy.statusFilter).value).toBe("release_open");
  });

  it("„Handlungsbedarf“ shows the decision and the fix, nothing else", async () => {
    MOCK.params = new URLSearchParams("status=handlungsbedarf");
    await mount(view());
    const rows = [...document.querySelectorAll("tbody")].map((b) => b.textContent!);
    expect(rows.map((r) => r.match(/SKY-\d{4}/)![0])).toEqual(["SKY-0002", "SKY-0003"]);
  });

  it("a choice is pushed, so Back undoes it", async () => {
    await mount(view());
    await choose(select(copy.statusFilter), "action");
    expect(pushed).toEqual(["?status=handlungsbedarf"]);
    await choose(select(copy.stockFilter), "in");
    expect(pushed.at(-1)).toBe("?bestand=auf-lager");
  });

  it("typing replaces, so Back does not step through every letter", async () => {
    await mount(view());
    const input = document.querySelector<HTMLInputElement>("#inventory-search")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "cyn");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(replaced).toEqual(["?q=cyn"]);
    expect(pushed).toEqual([]);
    expect(document.querySelectorAll("tbody")).toHaveLength(1);
  });

  it("reset appears only with a filter, and returns to the bare address", async () => {
    await mount(view());
    expect(buttons(copy.filterReset)).toHaveLength(0);
    await act(async () => { root!.unmount(); });
    container!.remove();
    MOCK.params = new URLSearchParams("status=ohne-preis&bestand=auf-lager");
    await mount(view());
    await act(async () => { buttons(copy.filterReset)[0].click(); });
    expect(pushed).toEqual([window.location.pathname]);
  });

  it("an unknown word filters nothing", async () => {
    MOCK.params = new URLSearchParams("status=alles-loeschen&serie=XX");
    await mount(view());
    expect(document.querySelectorAll("tbody")).toHaveLength(5);
    expect(buttons(copy.filterReset)).toHaveLength(0);
  });
});

/* ===================================================================== */
describe("[−] n [+] in the Bestand column — every click books ±1", () => {
  const plus = (skyId: string) =>
    row(skyId).querySelector<HTMLButtonElement>(`button[aria-label="${copy.increaseBooked(nameOf(skyId))}"]`)!;
  const minus = (skyId: string) =>
    row(skyId).querySelector<HTMLButtonElement>(`button[aria-label="${copy.decreaseBooked(nameOf(skyId))}"]`)!;
  const shown = (skyId: string) => plus(skyId).previousElementSibling!.textContent;
  const card = (skyId: string) =>
    [...document.querySelectorAll("article")].find((a) => a.textContent!.includes(skyId))!;
  function nameOf(skyId: string) {
    return STOCK.find((p) => p.skyId === skyId)!.figure!.displayName;
  }
  const correction = (delta: number, skyId = "SKY-0001") =>
    ({ skyId, condition: "loose", delta, reason: "correction" });

  it("shows − number + in every loose row: no popup, no pencil, no cancel", async () => {
    await mount(view());
    expect(minus("SKY-0001")).not.toBeNull();
    expect(plus("SKY-0001")).not.toBeNull();
    expect(row("SKY-0001").textContent).not.toContain("✎");
    expect(row("SKY-0001").textContent).not.toContain(copy.cancel);
    expect(row("SKY-0001").textContent).not.toContain(copy.draftSave);
  });

  it("plus books +1 through bookMovement and shows the new number", async () => {
    await mount(view());
    await act(async () => { plus("SKY-0001").click(); });
    await settle();
    expect(MOCK.booked).toEqual([correction(1)]);
    expect(MOCK.refreshes).toBe(1);
    expect(shown("SKY-0001")).toBe("3");
  });

  it("minus books −1", async () => {
    await mount(view());
    await act(async () => { minus("SKY-0001").click(); });
    await settle();
    expect(MOCK.booked).toEqual([correction(-1)]);
    expect(shown("SKY-0001")).toBe("1");
  });

  it("stops at what is reserved: minus disabled, nothing booked", async () => {
    await mount(view());
    expect(shown("SKY-0005")).toBe("3");
    expect(minus("SKY-0005").disabled).toBe(true);
    expect(minus("SKY-0005").title).toBe(copy.atFloor);
    await act(async () => { minus("SKY-0005").click(); });
    await settle();
    expect(MOCK.booked).toEqual([]);
    /* Plus is still allowed. */
    expect(plus("SKY-0005").disabled).toBe(false);
  });

  it("stops at the floor after bookings too — counted from the shown number", async () => {
    await mount(view());
    await act(async () => { minus("SKY-0001").click(); });
    await settle();
    await act(async () => { minus("SKY-0001").click(); });
    await settle();
    expect(shown("SKY-0001")).toBe("0");
    expect(minus("SKY-0001").disabled).toBe(true);
    expect(MOCK.booked).toEqual([correction(-1), correction(-1)]);
  });

  it("a refused booking keeps the number and says why, in the row", async () => {
    MOCK.bookResult = { ok: false, message: copy.wouldGoNegative };
    await mount(view());
    await act(async () => { plus("SKY-0001").click(); });
    await settle();
    expect(shown("SKY-0001")).toBe("2");
    expect(row("SKY-0001").querySelector('[role="alert"]')!.textContent).toBe(copy.wouldGoNegative);
    expect(MOCK.refreshes).toBe(0);
    /* The next click clears the message and tries again. */
    MOCK.bookResult = { ok: true };
    await act(async () => { plus("SKY-0001").click(); });
    await settle();
    expect(row("SKY-0001").querySelector('[role="alert"]')).toBeNull();
    expect(shown("SKY-0001")).toBe("3");
  });

  it("rapid clicks inside one tick book once", async () => {
    await mount(view());
    await act(async () => {
      plus("SKY-0001").click();
      plus("SKY-0001").click();
      minus("SKY-0001").click();
    });
    await settle();
    expect(MOCK.booked).toEqual([correction(1)]);
  });

  it("while a booking is on its way, both buttons are disabled and clicks book nothing", async () => {
    let release!: () => void;
    MOCK.gate = new Promise<void>((resolve) => { release = resolve; });
    await mount(view());
    await act(async () => { plus("SKY-0001").click(); });
    expect(plus("SKY-0001").disabled).toBe(true);
    expect(minus("SKY-0001").disabled).toBe(true);
    await act(async () => { plus("SKY-0001").click(); });
    expect(MOCK.booked).toHaveLength(1);
    await act(async () => { release(); });
    await settle();
    expect(plus("SKY-0001").disabled).toBe(false);
    expect(shown("SKY-0001")).toBe("3");
  });

  it("sequential clicks become sequential bookings, never overlapping", async () => {
    await mount(view());
    for (let i = 0; i < 3; i += 1) {
      await act(async () => { plus("SKY-0001").click(); });
      await settle();
    }
    expect(MOCK.booked).toEqual([correction(1), correction(1), correction(1)]);
    expect(shown("SKY-0001")).toBe("5");
  });

  it("does not open the details", async () => {
    await mount(view());
    await act(async () => { plus("SKY-0001").click(); });
    await settle();
    expect(row("SKY-0001").querySelector("button[aria-controls]")!.getAttribute("aria-expanded")).toBe("false");
  });

  it("an OVP row has a number and no control (0108)", async () => {
    await mount(view());
    expect(row("SKY-0004").querySelectorAll("button")).toHaveLength(1);
  });

  it("the mobile card is unchanged: draft first, one movement on save", async () => {
    await mount(view());
    const cardPlus = card("SKY-0002").querySelector<HTMLButtonElement>(`button[aria-label="${copy.increase}"]`)!;
    await act(async () => { cardPlus.click(); });
    expect(MOCK.booked).toEqual([]);
    const save = [...card("SKY-0002").querySelectorAll("button")].find((b) => b.textContent === copy.draftSave)!;
    await act(async () => { save.click(); });
    await settle();
    expect(MOCK.booked).toEqual([correction(1, "SKY-0002")]);
  });

  it("an inline booking voids the card's unsaved draft for that position — no contradicting save", async () => {
    await mount(view());
    const cardPlus = card("SKY-0001").querySelector<HTMLButtonElement>(`button[aria-label="${copy.increase}"]`)!;
    await act(async () => { cardPlus.click(); });
    await act(async () => { cardPlus.click(); });
    expect(card("SKY-0001").textContent).toContain(copy.draftPending(2));
    await act(async () => { plus("SKY-0001").click(); });
    await settle();
    /* Even before the refresh: the card has nothing left to save. */
    expect([...card("SKY-0001").querySelectorAll("button")].some((b) => b.textContent === copy.draftSave)).toBe(false);
    expect(MOCK.booked).toEqual([correction(1)]);
  });

  it("while the card is saving its draft, the inline control waits", async () => {
    let release!: () => void;
    MOCK.gate = new Promise<void>((resolve) => { release = resolve; });
    await mount(view());
    const cardPlus = card("SKY-0001").querySelector<HTMLButtonElement>(`button[aria-label="${copy.increase}"]`)!;
    await act(async () => { cardPlus.click(); });
    const save = [...card("SKY-0001").querySelectorAll("button")].find((b) => b.textContent === copy.draftSave)!;
    await act(async () => { save.click(); });
    expect(plus("SKY-0001").disabled).toBe(true);
    expect(minus("SKY-0001").disabled).toBe(true);
    await act(async () => { plus("SKY-0001").click(); });
    expect(MOCK.booked).toHaveLength(1);
    await act(async () => { release(); });
    await settle();
    expect(MOCK.booked).toEqual([correction(1)]);
  });

  it("the card's draft saves once even before the new number arrives", async () => {
    await mount(view());
    const cardPlus = card("SKY-0002").querySelector<HTMLButtonElement>(`button[aria-label="${copy.increase}"]`)!;
    await act(async () => { cardPlus.click(); });
    const save = [...card("SKY-0002").querySelectorAll("button")].find((b) => b.textContent === copy.draftSave)!;
    await act(async () => { save.click(); save.click(); });
    await settle();
    expect(MOCK.booked).toHaveLength(1);
    expect([...card("SKY-0002").querySelectorAll("button")].some((b) => b.textContent === copy.draftSave)).toBe(false);
  });
});

describe("one number, whichever view booked last", () => {
  it("after the card's save, the column counts on from the booked value", async () => {
    await mount(view());
    const card = [...document.querySelectorAll("article")].find((a) => a.textContent!.includes("SKY-0001"))!;
    const cardPlus = card.querySelector<HTMLButtonElement>(`button[aria-label="${copy.increase}"]`)!;
    await act(async () => { cardPlus.click(); });
    await act(async () => { cardPlus.click(); });
    const save = [...card.querySelectorAll("button")].find((b) => b.textContent === copy.draftSave)!;
    await act(async () => { save.click(); });
    await settle();
    const tablePlus = [...document.querySelectorAll("table tbody")]
      .find((b) => b.textContent!.includes("SKY-0001"))!
      .querySelector<HTMLButtonElement>(`button[aria-label="${copy.increaseBooked("Bash")}"]`)!;
    /* 2 + 2 booked on the card, refresh not yet back: the column says 4. */
    expect(tablePlus.previousElementSibling!.textContent).toBe("4");
    await act(async () => { tablePlus.click(); });
    await settle();
    expect(tablePlus.previousElementSibling!.textContent).toBe("5");
    expect(MOCK.booked.map((b) => b.delta)).toEqual([2, 1]);
  });
});
