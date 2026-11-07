// @vitest-environment jsdom
/**
 * "Abgleichen" in a real DOM — with the action replaced: no request leaves
 * the test, nothing is written anywhere.
 *
 *   - the addition is preselected, the conflict asks, the date and the
 *     figure are only shown, with the way to the Orderbuch
 *   - not released: "Abgleich bestätigen" stays disabled, nothing is sent
 *   - released: disabled until the conflict is chosen, then exactly the
 *     addition and the choice are sent — never the date, never the figure —
 *     and the page is read anew
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
type Finding = import("@/lib/reconciliation/view").Finding;

const t = de.business.reconciliation.reconcile;

const finding = (over: Partial<Finding>): Finding => ({
  id: 1, key: "external_order_ref", field: "external_order_ref", kind: "addition",
  shown: { ledger: null, external: "06-14260-71832" }, delta: null, causes: [],
  allowedDecisions: ["take_external", "keep_ledger", "defer"], decision: null, applied: false, lock: null, ...over,
});
const MATCH: Match = {
  id: 50, category: "deviating", certainty: "deterministic", score: 1, dateDelta: 1, competitors: [], reason: null,
  order: { orderRef: "06-14260-71832" } as Match["order"],
  sale: { id: 64 } as Match["sale"],
  ledger: { state: "unchanged", version: { analysed: "v", current: "v" },
    current: { soldOn: "2026-02-10", itemsSubtotal: 12.5, discount: 0, itemsNet: 12.5, shipping: 4.99, refundsTotal: 0,
      cancelledOn: null, expectedTotal: 17.49, pieces: 1, externalOrderRef: null, isTest: false },
    atAnalysis: {} as NonNullable<Match["ledger"]>["atAnalysis"] },
  findings: [
    finding({}),
    finding({ id: 2, key: "shipping", field: "shipping", kind: "deviation", shown: { ledger: 4.99, external: 5.49 } }),
    finding({ id: 3, key: "sold_on", field: "sold_on", kind: "deviation", shown: { ledger: "2026-02-10", external: "2026-02-09" } }),
    finding({ id: 4, key: "figure:0", field: "figure", kind: "deviation", shown: { ledger: "Spyro – Giants", external: "Spyro – Spyro's Adventure" } }),
  ],
};

let container: HTMLDivElement;
let root: Root;

function mount(applyReleased: boolean) {
  act(() => root.render(
    <ReconcileProvider sessionId={5} sessionOpen applyReleased={applyReleased}>
      <ReconcileButton matches={[MATCH]} />
    </ReconcileProvider>,
  ));
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  MOCK.refresh.mockReset();
  MOCK.confirm.mockReset();
  MOCK.confirm.mockResolvedValue({ ok: true, applied: 2, sales: 1 });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const button = (label: string, scope: ParentNode = document) =>
  [...scope.querySelectorAll("button")].find((b) => b.textContent?.includes(label)) ?? null;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
const row = (id: number) => dialog().querySelector<HTMLElement>(`[data-finding="${id}"]`)!;
const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const open = () => act(() => button(t.button, container)!.click());

describe("the dialog", () => {
  it("addition preselected, conflict asks, date and figure only shown — with the way to the Orderbuch", () => {
    mount(false);
    open();
    expect(row(1).dataset.state).toBe("MISSING_IN_SKYISLES");
    expect(row(1).textContent).toContain(t.missing);
    expect(row(1).textContent).toContain("06-14260-71832");
    expect(row(1).querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true);
    expect(row(2).dataset.state).toBe("CONFLICT");
    expect(row(2).querySelectorAll('input[type="radio"]')).toHaveLength(2);
    expect(row(2).textContent).toContain("4,99");
    expect(row(2).textContent).toContain("5,49");
    for (const id of [3, 4]) {
      expect(row(id).dataset.state).toBe("READ_ONLY_DIFFERENCE");
      expect(row(id).querySelector("input")).toBeNull();
      expect(row(id).querySelector('a[href="/business/orderbuch/verkauf/64"]')).not.toBeNull();
    }
    expect(row(3).textContent).toContain(t.reasons.date);
    expect(row(4).textContent).toContain(t.reasons.positions);
    expect(dialog().textContent).toContain(t.openConflicts(1));
  });

  it("not released: the confirmation stays disabled, even with every conflict chosen — nothing is sent", async () => {
    mount(false);
    open();
    act(() => row(2).querySelector<HTMLInputElement>('input[value="take_external"]')!.click());
    expect(dialog().textContent).toContain(t.summary(1, 1, 1));
    expect(dialog().textContent).toContain(t.notReleased);
    const confirm = button(t.confirm, dialog())!;
    expect(confirm.disabled).toBe(true);
    act(() => confirm.click());
    await settle();
    expect(MOCK.confirm).not.toHaveBeenCalled();
  });
});

describe("once released", () => {
  it("waits for the conflict, then sends exactly the addition and the choice — never the date or the figure", async () => {
    mount(true);
    open();
    expect(button(t.confirm, dialog())!.disabled).toBe(true);
    act(() => row(2).querySelector<HTMLInputElement>('input[value="keep_ledger"]')!.click());
    expect(dialog().textContent).toContain(t.summary(1, 0, 1));
    expect(button(t.confirm, dialog())!.disabled).toBe(false);
    act(() => button(t.confirm, dialog())!.click());
    await settle();
    expect(MOCK.confirm).toHaveBeenCalledWith({ sessionId: 5, items: [
      { findingId: 1, field: "external_order_ref", decision: "take_external", shownLedger: null, shownExternal: "06-14260-71832" },
      { findingId: 2, field: "shipping", decision: "keep_ledger", shownLedger: 4.99, shownExternal: 5.49 },
    ] });
    expect(MOCK.refresh).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain(t.done(2, 1));
  });

  it("an unticked addition is not sent; a refusal shows a known sentence only", async () => {
    MOCK.confirm.mockResolvedValue({ ok: false, message: "ERROR: relation sales 06-14260-71832" });
    mount(true);
    open();
    act(() => row(1).querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    act(() => row(2).querySelector<HTMLInputElement>('input[value="take_external"]')!.click());
    act(() => button(t.confirm, dialog())!.click());
    await settle();
    expect(MOCK.confirm.mock.calls[0][0].items.map((i: { findingId: number }) => i.findingId)).toEqual([2]);
    expect(dialog().textContent).toContain(t.failed);
    expect(dialog().textContent).not.toContain("relation sales");
    expect(MOCK.refresh).not.toHaveBeenCalled();
  });
});
