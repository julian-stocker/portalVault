/** @vitest-environment jsdom */
/**
 * "Eindeutige Bestellnummern übernehmen" on screen: the preview (counts,
 * collapsible lists, "only missing numbers"), nothing sent before the
 * confirmation, then every case with its outcome.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MOCK = vi.hoisted(() => ({ sent: [] as unknown[][], refreshed: 0, answer: null as unknown }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => { MOCK.refreshed += 1; }, push: () => {} }) }));
vi.mock("@/lib/reconciliation/server/actions", () => ({
  takeOrderNumbers: async (...args: unknown[]) => { MOCK.sent.push(args); return MOCK.answer; },
}));

const { BulkOrderNumbers } = await import("./bulk-order-numbers");
const { de } = await import("@/lib/i18n/de");
const t = de.business.reconciliation.bulkNumbers;
const problems = de.business.reconciliation.selection.problems;

const TAKEABLE = Array.from({ length: 36 }, (_, k) => ({ matchId: k + 1, orderRef: `05-${k + 1}`, saleId: 500 + k + 1 }));
const SKIPPED = [{ matchId: 40, orderRef: "05-40", saleId: 540, reason: "rivals" as const },
  { matchId: 41, orderRef: "05-41", saleId: 541, reason: "stale" as const }];

let root: Root | null = null;
let container: HTMLElement | null = null;
beforeEach(() => { MOCK.sent = []; MOCK.refreshed = 0; });
afterEach(async () => { await act(async () => { root?.unmount(); }); container?.remove(); root = null; container = null; });
async function mount(takeable = TAKEABLE, skipped = SKIPPED) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => { root!.render(createElement(BulkOrderNumbers, { sessionId: 14, takeable, skipped })); });
}
const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const outcome = (matchId: number, status: string, problem: string | null = null) =>
  ({ matchId, orderRef: `05-${matchId}`, saleId: 500 + matchId, status, problem });

describe("the preview", () => {
  it("counts what is added and what is skipped, says ONLY missing numbers — and sends nothing before the confirmation", async () => {
    await mount();
    expect(q("[data-bulk-numbers-open]")!.textContent).toBe(t.button(36));
    await act(async () => { q("[data-bulk-numbers-open]")!.click(); });
    expect(q("[data-bulk-numbers]")!.textContent).toContain(t.only);
    expect(q("[data-bulk-takeable]")!.textContent).toBe(t.takeable(36));
    expect(q("[data-bulk-skipped]")!.textContent).toBe(t.skipped(2));
    expect(document.querySelectorAll("[data-bulk-case]")).toHaveLength(36);
    expect(q('[data-bulk-skip="rivals"]')!.textContent).toContain(t.reasons.rivals);
    expect(MOCK.sent).toEqual([]);
  });

  it("nothing takeable: the reasons can be read, the confirmation stays shut", async () => {
    await mount([], SKIPPED);
    await act(async () => { q("[data-bulk-numbers-open]")!.click(); });
    expect((q("[data-bulk-numbers-go]") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("after the confirmation", () => {
  it("sends exactly the cases shown; every case not taken is named with its reason; refreshes", async () => {
    MOCK.answer = { ok: true, applied: 35, outcomes: [...TAKEABLE.slice(1).map((c) => outcome(c.matchId, "taken")), outcome(1, "refused", "rival_sale")] };
    await mount();
    await act(async () => { q("[data-bulk-numbers-open]")!.click(); });
    await act(async () => { q("[data-bulk-numbers-go]")!.click(); });
    expect(MOCK.sent).toEqual([[14, TAKEABLE.map((c) => c.matchId)]]);
    expect(q("[data-bulk-counts]")!.textContent).toBe(t.result(35, 1, 0));
    expect(q('[data-outcome="refused"]')!.textContent).toBe(`${t.caseLine("05-1", 501)}: ${t.status.refused} — ${problems.rival_sale}`);
    expect(MOCK.refreshed).toBe(1);
  });

  it("a failed apply: 'nothing added' said plainly, each accepted case 'not_applied', no refresh", async () => {
    MOCK.answer = { ok: false, message: "Die Auswahl hat sich geändert.", outcomes: [outcome(1, "not_applied"), outcome(2, "refused", "stale")] };
    await mount(TAKEABLE.slice(0, 2), []);
    await act(async () => { q("[data-bulk-numbers-open]")!.click(); });
    await act(async () => { q("[data-bulk-numbers-go]")!.click(); });
    expect(q('[role="alert"]')!.textContent).toContain(t.failed);
    expect(q('[data-outcome="not_applied"]')).not.toBeNull();
    expect(MOCK.refreshed).toBe(0);
  });
});
