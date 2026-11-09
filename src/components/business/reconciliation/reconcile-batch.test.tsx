// @vitest-environment jsdom
/**
 * The batch "Angaben von N Bestellungen abgleichen" (since 2026-11-09:
 * FINANCIAL values only — the order number is its own act). 35 shipping
 * corrections, two of which 0180 refuses.
 *
 *   - the batch sends the same items a single "Angaben abgleichen" would, for each order
 *   - an order number is never in it, an order without a sale neither
 *   - a refused value is marked where it stands, once — "Nicht übernommen" and
 *     its reason — and deselected; no second list, no rival lists, no code
 *   - the rest goes only with a NEW explicit confirmation: no silent partial take-over
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MOCK = vi.hoisted(() => ({ refresh: vi.fn(), confirm: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: MOCK.refresh, push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => createElement("a", { href, ...rest }, children),
}));
vi.mock("@/lib/reconciliation/server/actions", () => ({ confirmReconciliation: MOCK.confirm }));

const { de } = await import("@/lib/i18n/de");
const { ReconcileProvider } = await import("./reconcile-context");
const { ReconcileButton } = await import("./reconcile-dialog");
type Match = import("@/lib/reconciliation/view").Match;

const t = de.business.reconciliation.reconcile;
const problems = de.business.reconciliation.selection.problems;

/* One exact pair: shipping 4,99 in SkyIsles, 5,49 in the report — and the order number missing too. */
const pair = (n: number): Match => ({
  id: 200 + n, category: "exact", certainty: "deterministic", score: 105, dateDelta: 0, competitors: [], reason: null,
  order: { orderRef: `12-1457-${String(n).padStart(4, "0")}` } as Match["order"],
  sale: { id: 100 + n } as Match["sale"],
  ledger: { state: "unchanged", version: { analysed: "v", current: "v" },
    current: { soldOn: "2026-04-10", itemsSubtotal: 10, discount: 0, itemsNet: 10, shipping: 4.99, refundsTotal: 0,
      cancelledOn: null, expectedTotal: 14.99, pieces: 1, externalOrderRef: null, isTest: false },
    atAnalysis: {} as NonNullable<Match["ledger"]>["atAnalysis"] },
  findings: [{
    id: 1000 + n, key: "shipping", field: "shipping", kind: "deviation",
    shown: { ledger: 4.99, external: 5.49 }, delta: -0.5, causes: [],
    allowedDecisions: ["take_external", "keep_ledger", "defer"], decision: null, applied: false, lock: null,
  }, {
    id: 5000 + n, key: "external_order_ref", field: "external_order_ref", kind: "addition",
    shown: { ledger: null, external: `12-1457-${String(n).padStart(4, "0")}` }, delta: null, causes: [],
    allowedDecisions: ["take_external", "keep_ledger", "defer"], decision: null, applied: false, lock: null,
  }],
});
const BATCH = Array.from({ length: 35 }, (_, i) => pair(i + 1));
/* 06-14518-99785, 16.04.2026, 35,50 € — in the report, no sale. */
const UNMATCHED: Match = {
  id: 229, category: "external_only", certainty: null, score: 0, dateDelta: null, competitors: [], reason: null,
  order: { orderRef: "06-14518-99785" } as Match["order"], sale: null, ledger: null, findings: [],
} as unknown as Match;

let container: HTMLDivElement;
let root: Root;
function mount(matches: readonly Match[]) {
  act(() => root.render(
    <ReconcileProvider sessionId={12} sessionOpen applyReleased>
      <ReconcileButton matches={matches} label={t.all(matches.length)} />
    </ReconcileProvider>,
  ));
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  MOCK.refresh.mockReset();
  MOCK.confirm.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const button = (label: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(label)) ?? null;
const openDialog = () => act(() => { document.querySelector<HTMLButtonElement>("[data-reconcile]")!.click(); });
const confirm = () => act(async () => { button(t.confirm)!.click(); });
/* "CSV-Wert übernehmen" on every shipping conflict. */
const takeAll = () => act(() => {
  for (const r of document.querySelectorAll<HTMLInputElement>('input[type="radio"][value="take_external"]')) r.click();
});
const sentIds = (call = 0) => (MOCK.confirm.mock.calls[call][0].items as { findingId: number }[]).map((i) => i.findingId);

describe("the batch sends what the single orders would — financial only", () => {
  it("35 shipping corrections, one call, 35 items — each exactly as its own dialog sends it; no order number", async () => {
    MOCK.confirm.mockResolvedValue({ ok: true, applied: 35, sales: 35 });
    mount(BATCH);
    openDialog();
    takeAll();
    await confirm();
    expect(MOCK.confirm).toHaveBeenCalledTimes(1);
    const batchItems = MOCK.confirm.mock.calls[0][0].items as { findingId: number; field: string }[];
    expect(batchItems).toHaveLength(35);
    expect(batchItems.every((i) => i.field === "shipping")).toBe(true);
    for (const n of [1, 17, 35]) {
      act(() => root.unmount());
      root = createRoot(container);
      MOCK.confirm.mockClear();
      mount([BATCH[n - 1]]);
      openDialog();
      takeAll();
      await confirm();
      expect(MOCK.confirm.mock.calls[0][0].items).toEqual([batchItems[n - 1]]);
    }
  });

  it("the order number is not even shown in the dialog; the order without a sale is not in the batch", async () => {
    MOCK.confirm.mockResolvedValue({ ok: true, applied: 35, sales: 35 });
    mount([...BATCH, UNMATCHED]);
    openDialog();
    expect(document.body.textContent).not.toContain(de.business.reconciliation.fields.external_order_ref);
    takeAll();
    await confirm();
    expect(MOCK.confirm.mock.calls[0][0].items).toHaveLength(35);
  });

  it("the dialog is named for what it does", () => {
    mount([BATCH[0]]);
    openDialog();
    expect(document.body.textContent).toContain(t.dialogTitle);
    expect(t.dialogTitle).toBe("Angaben abgleichen");
    expect(button(t.confirm)!.textContent).toBe("Ausgewählte Angaben übernehmen");
  });
});

describe("two refused values among 35", () => {
  const REFUSED = { ok: false, message: de.business.reconciliation.errors.notTakeable,
    refused: [{ findingId: 1033, problem: "refunded" }, { findingId: 1034, problem: "refunded" }] };

  it("marked where they stand, once, as not taken over — no list, no code, no success, no refresh", async () => {
    MOCK.confirm.mockResolvedValue(REFUSED);
    mount(BATCH);
    openDialog();
    takeAll();
    await confirm();
    const marked = [...document.querySelectorAll<HTMLElement>("li[data-refused]")];
    expect(marked.map((li) => li.dataset.finding)).toEqual(["1033", "1034"]);
    for (const li of marked) {
      expect(li.querySelector("[data-not-taken]")!.textContent).toBe(`${t.refused.badge}: ${problems.refunded}`);
      // deselected: its choice is gone from the row
      expect(li.querySelector('input[type="radio"]')).toBeNull();
    }
    expect(document.querySelector("[data-refused-list]")).toBeNull();
    expect(document.querySelectorAll("[data-rivals]")).toHaveLength(0);
    expect(document.querySelector("[data-refused-summary]")!.textContent).toBe(t.refused.summary(2, 33));
    expect(document.body.textContent).not.toMatch(/refunded|cannot be taken over|23514/);
    expect(document.querySelector('p[role="status"]')).toBeNull();
    expect(MOCK.refresh).not.toHaveBeenCalled();
  });

  it("the other 33 go only with a NEW explicit confirmation — the refused two are not sent again", async () => {
    MOCK.confirm.mockResolvedValueOnce(REFUSED).mockResolvedValueOnce({ ok: true, applied: 33, sales: 33 });
    mount(BATCH);
    openDialog();
    takeAll();
    await confirm();
    expect(MOCK.confirm).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-summary]")!.textContent).toBe(t.summary(0, 33, 33));
    await confirm();
    expect(MOCK.confirm).toHaveBeenCalledTimes(2);
    const second = sentIds(1);
    expect(second).toHaveLength(33);
    expect(second).not.toContain(1033);
    expect(second).not.toContain(1034);
    expect(MOCK.refresh).toHaveBeenCalledTimes(1);
  });

  it("a refusal without named entries keeps the known sentence only", async () => {
    MOCK.confirm.mockResolvedValue({ ok: false, message: "this finding cannot be taken over (refunded)" });
    mount(BATCH);
    openDialog();
    takeAll();
    await confirm();
    expect(document.querySelector("[data-refused-summary]")).toBeNull();
    expect(document.body.textContent).not.toContain("cannot be taken over");
    expect(document.body.textContent).toContain(t.failed);
  });

  it("ids the dialog did not send are ignored", async () => {
    MOCK.confirm.mockResolvedValue({ ...REFUSED, refused: [{ findingId: 999999, problem: "refunded" }] });
    mount(BATCH);
    openDialog();
    takeAll();
    await confirm();
    expect(document.querySelector("[data-refused-summary]")).toBeNull();
  });
});
