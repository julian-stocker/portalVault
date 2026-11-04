// @vitest-environment jsdom
/**
 * The report picker in a real DOM: choose files, see the preview, confirm
 * the analysis — and nothing is sent without that confirmation.
 *
 * `analyseReconciliation` and the router are replaced: no request leaves
 * the test, nothing is written anywhere.
 */
import { readFileSync } from "node:fs";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ActionResult = { ok: true; sessionId: number } | { ok: false; message: string };
const MOCK = vi.hoisted(() => ({
  push: vi.fn(),
  analyse: vi.fn<(input: unknown) => Promise<ActionResult>>(async () => ({ ok: true, sessionId: 7 })),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: MOCK.push }) }));
vi.mock("@/lib/reconciliation/server/actions", () => ({ analyseReconciliation: MOCK.analyse }));

const { de } = await import("@/lib/i18n/de");
const { ebayReport, FAKE_BUYER } = await import("@/lib/reconciliation/testing/ebay-fixture");
const { ReportPicker } = await import("./report-picker");
type FixtureOrder = import("@/lib/reconciliation/testing/ebay-fixture").FixtureOrder;

const t = de.business.reconciliation.picker;
const SOURCE = readFileSync("src/components/business/reconciliation/report-picker.tsx", "utf8");

const order = (n: number): FixtureOrder => ({
  ref: `01-0000${n}-0000${n}`, record: 1000 + n, sold: `2026-03-0${n}`, lines: [{ unit: 10, character: `Testfigur ${n}` }],
});
const REPORT = ebayReport([order(1), order(2)]);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  MOCK.push.mockReset();
  MOCK.analyse.mockReset();
  MOCK.analyse.mockResolvedValue({ ok: true, sessionId: 7 });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(ReportPicker)));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const input = () => container.querySelector<HTMLInputElement>('input[type="file"]')!;
const status = () => container.querySelector('[role="status"]')!.textContent ?? "";
/** The dialog is portalled to `document.body`. */
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const button = (label: string, scope: ParentNode = document) =>
  [...scope.querySelectorAll("button")].find((b) => b.textContent?.includes(label)) ?? null;
const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

/** Put files into the input and fire `change`, as the browser does. */
async function choose(files: File[]) {
  const list = Object.assign([...files], { item: (i: number) => files[i] }) as unknown as FileList;
  Object.defineProperty(input(), "files", { value: list, configurable: true });
  await act(async () => {
    input().dispatchEvent(new Event("change", { bubbles: true }));
  });
  for (let i = 0; i < 20 && !status().includes("geprüft."); i += 1) {
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  }
}

async function chooseValid() {
  await choose([new File([REPORT], "maerz.csv", { type: "text/csv" })]);
}

function openDialog() {
  act(() => button(t.analyse.start, container)!.click());
}

describe("choosing and previewing", () => {
  it("starts with a labelled multi-file CSV input and an empty live region", () => {
    const el = input();
    expect(el.multiple).toBe(true);
    expect(el.accept).toBe(".csv,text/csv");
    expect(container.querySelector(`label[for="${el.id}"]`)?.textContent).toBe(t.input);
    expect(container.querySelector('[role="status"]')?.getAttribute("aria-live")).toBe("polite");
    expect(status()).toBe("");
  });

  it("shows the preview of the chosen reports — counts, not content", async () => {
    await chooseValid();
    expect(status()).toBe(t.done(1));
    const text = container.textContent ?? "";
    expect(text).toContain("maerz.csv");
    expect(text).toContain(t.platforms["ebay-orders-report-de"]);
    expect(text).toContain("01.03.2026 – 02.03.2026");
    expect(text).toContain(t.ready);
    for (const value of Object.values(FAKE_BUYER)) expect(text).not.toContain(value);
    expect(text).not.toContain("Testfigur");
    expect(text).not.toContain("01-00001");
  });

  it("a cancelled file dialog changes nothing", async () => {
    await chooseValid();
    await choose([]);
    expect(status()).toBe(t.done(1));
    expect(container.textContent).toContain("maerz.csv");
  });

  it("a new choice replaces the old one, and the input is emptied for the next", async () => {
    await chooseValid();
    expect(input().value).toBe("");
    await choose([new File([REPORT], "maerz.csv"), new File([REPORT], "kopie.csv")]);
    expect(status()).toBe(t.done(2));
    expect(container.textContent).toContain(t.warnings.duplicate_files);
  });

  it("reset empties the preview and returns the focus to the input", async () => {
    await chooseValid();
    act(() => button(t.reset, container)!.click());
    expect(status()).toBe("");
    expect(container.textContent).not.toContain("maerz.csv");
    expect(document.activeElement).toBe(input());
  });

  it("keeps long file names inside a phone's width", async () => {
    await choose([new File([REPORT], `${"sehr-langer-dateiname-".repeat(8)}.csv`)]);
    expect(container.querySelector("li p.break-all")).not.toBeNull();
    expect(input().className).toContain("max-w-full");
  });
});

describe("Analyse starten", () => {
  it("is not there before a preview, and disabled while anything blocks", async () => {
    expect(button(t.analyse.start, container)).toBeNull();
    await choose([new File([REPORT], "maerz.csv"), new File(["a;b\n1;2\n"], "notiz.csv")]);
    const start = button(t.analyse.start, container)!;
    expect(start.disabled).toBe(true);
    expect(start.getAttribute("aria-describedby")).toBe("recon-start-blocked");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(t.blockers.failed_files);
    act(() => start.click());
    expect(dialog()).toBeNull();
    expect(MOCK.analyse).not.toHaveBeenCalled();
  });

  it("opens a dialog with platform, files, orders, period, size and the note — and sends nothing yet", async () => {
    await chooseValid();
    openDialog();
    const d = dialog()!;
    expect(d.getAttribute("aria-labelledby")).toBe("recon-confirm-title");
    const text = d.textContent ?? "";
    expect(text).toContain(t.platforms["ebay-orders-report-de"]);
    expect(text).toContain(`${t.analyse.sentFiles}1`);
    expect(text).toContain(`${t.summary.orders}2`);
    expect(text).toContain("01.03.2026 – 02.03.2026");
    expect(text).toMatch(/\d+ KiB von höchstens 900 KiB/);
    expect(text).toContain(t.analyse.note);
    expect(MOCK.analyse).not.toHaveBeenCalled();
  });

  it("cancel closes the dialog and sends nothing", async () => {
    await chooseValid();
    openDialog();
    act(() => button(t.analyse.cancel, dialog()!)!.click());
    expect(dialog()).toBeNull();
    expect(MOCK.analyse).not.toHaveBeenCalled();
    expect(container.textContent).toContain("maerz.csv");
  });

  it("Escape closes it as well, without sending", async () => {
    await chooseValid();
    openDialog();
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(dialog()).toBeNull();
    expect(MOCK.analyse).not.toHaveBeenCalled();
  });

  it("confirm sends exactly the checked upload, once, and goes to the session", async () => {
    await chooseValid();
    openDialog();
    await act(async () => { button(t.analyse.confirm, dialog()!)!.click(); });
    await settle();
    expect(MOCK.analyse).toHaveBeenCalledTimes(1);
    const sent = MOCK.analyse.mock.calls[0][0] as { channel: string; files: { fingerprint: string; report: { fileName: string } }[] };
    expect(sent.channel).toBe("ebay");
    expect(sent.files.map((f) => f.report.fileName)).toEqual(["maerz.csv"]);
    expect(sent.files[0].fingerprint).toMatch(/^[0-9a-f]{64}$/);
    for (const value of Object.values(FAKE_BUYER)) expect(JSON.stringify(sent)).not.toContain(value);
    expect(MOCK.push).toHaveBeenCalledWith("/business/orderbuch/abgleich?sitzung=7");
    expect(dialog()).toBeNull();
    expect(status()).toBe(t.analyse.done(7));
  });

  it("a double click — and a third — starts ONE analysis", async () => {
    let release: (v: ActionResult) => void = () => {};
    MOCK.analyse.mockImplementation(() => new Promise<ActionResult>((r) => { release = r; }));
    await chooseValid();
    openDialog();
    const confirm = button(t.analyse.confirm, dialog()!)!;
    await act(async () => { confirm.click(); confirm.click(); });
    await act(async () => { confirm.click(); });
    expect(MOCK.analyse).toHaveBeenCalledTimes(1);
    expect(confirm.disabled).toBe(true);
    expect(confirm.getAttribute("aria-busy")).toBe("true");
    expect(dialog()?.textContent).toContain(t.analyse.running);
    // While it runs: no closing, no new selection.
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(dialog()).not.toBeNull();
    expect(input().disabled).toBe(true);
    await act(async () => { release({ ok: true, sessionId: 9 }); });
    await settle();
    expect(MOCK.push).toHaveBeenCalledTimes(1);
    expect(MOCK.push).toHaveBeenCalledWith("/business/orderbuch/abgleich?sitzung=9");
  });

  it("a refusal stays in the dialog as an alert, with the server's sentence, and can be retried", async () => {
    MOCK.analyse.mockResolvedValueOnce({ ok: false, message: de.business.reconciliation.errors.conflictingOrders });
    await chooseValid();
    openDialog();
    await act(async () => { button(t.analyse.confirm, dialog()!)!.click(); });
    await settle();
    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toBe(de.business.reconciliation.errors.conflictingOrders);
    expect(MOCK.push).not.toHaveBeenCalled();
    await act(async () => { button(t.analyse.confirm, dialog()!)!.click(); });
    await settle();
    expect(MOCK.analyse).toHaveBeenCalledTimes(2);
    expect(MOCK.push).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a database text", 'duplicate key value violates unique constraint "sales_external_order_ref_key"'],
    ["a report value", "Bestellung 01-00001-00001 von kaeuferin@example.invalid"],
    ["an empty sentence", ""],
    ["not a string", 42],
  ])("a refusal that is not a known sentence (%s) shows the general sentence instead", async (_, message) => {
    MOCK.analyse.mockResolvedValueOnce({ ok: false, message } as ActionResult);
    await chooseValid();
    openDialog();
    await act(async () => { button(t.analyse.confirm, dialog()!)!.click(); });
    await settle();
    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toBe(t.analyse.failed);
    expect(MOCK.push).not.toHaveBeenCalled();
  });

  it("a thrown error (network, refused body) shows a general sentence — no detail, no file content", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    MOCK.analyse.mockRejectedValueOnce(new Error("Body exceeded 1 MB limit: kaeuferin@example.invalid"));
    await chooseValid();
    openDialog();
    await act(async () => { button(t.analyse.confirm, dialog()!)!.click(); });
    await settle();
    const alert = dialog()?.querySelector('[role="alert"]')?.textContent ?? "";
    expect(alert).toBe(t.analyse.failed);
    expect(JSON.stringify(log.mock.calls)).not.toContain("kaeuferin");
    expect(MOCK.push).not.toHaveBeenCalled();
    log.mockRestore();
  });
});

describe("the source", () => {
  it("calls the action in exactly one place, with the checked upload only", () => {
    expect(SOURCE.match(/analyseReconciliation\(/g)?.length).toBe(1);
    expect(SOURCE).toContain("analyseReconciliation(preview.upload)");
    expect(SOURCE).not.toMatch(/fetch\(|XMLHttpRequest|\.rpc\(|decideFinding|applyReconciliation/);
  });

  it("guards the call with a ref before any state update", () => {
    const body = SOURCE.slice(SOURCE.indexOf("async function analyse("));
    expect(body.indexOf("if (busy.current")).toBeLessThan(body.indexOf("busy.current = true"));
    expect(body.indexOf("busy.current = true")).toBeLessThan(body.indexOf("await analyseReconciliation"));
  });
});
