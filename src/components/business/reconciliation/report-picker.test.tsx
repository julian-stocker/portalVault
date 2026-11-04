// @vitest-environment jsdom
/**
 * The report picker in a real DOM: choose files, see the preview, choose
 * again, cancel — and never reach a server action.
 */
import { readFileSync } from "node:fs";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { de } from "@/lib/i18n/de";
import { ebayReport, FAKE_BUYER, type FixtureOrder } from "@/lib/reconciliation/testing/ebay-fixture";
import { ReportPicker } from "./report-picker";

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

/** Put files into the input and fire `change`, as the browser does. */
async function choose(files: File[]) {
  const list = Object.assign([...files], { item: (i: number) => files[i] }) as unknown as FileList;
  Object.defineProperty(input(), "files", { value: list, configurable: true });
  await act(async () => {
    input().dispatchEvent(new Event("change", { bubbles: true }));
  });
  // Let the reads and the yields run out.
  for (let i = 0; i < 20 && !status().includes("geprüft."); i += 1) {
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  }
}

describe("ReportPicker", () => {
  it("starts with a labelled multi-file CSV input and an empty live region", () => {
    const el = input();
    expect(el.multiple).toBe(true);
    expect(el.accept).toBe(".csv,text/csv");
    expect(container.querySelector(`label[for="${el.id}"]`)?.textContent).toBe(t.input);
    expect(container.querySelector('[role="status"]')?.getAttribute("aria-live")).toBe("polite");
    expect(status()).toBe("");
  });

  it("shows the preview of the chosen reports — counts, not content", async () => {
    await choose([new File([REPORT], "maerz.csv", { type: "text/csv" })]);
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

  it("has no button that sends anything — only the reset", async () => {
    await choose([new File([REPORT], "maerz.csv")]);
    const buttons = [...container.querySelectorAll("button")].map((b) => b.textContent);
    expect(buttons).toEqual([t.reset]);
    expect(container.querySelector("form")).toBeNull();
  });

  it("a wrong file: listed with its reason, the selection blocked in an alert", async () => {
    await choose([new File([REPORT], "maerz.csv"), new File(["a;b\n1;2\n"], "notiz.csv")]);
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(t.blockers.failed_files);
    expect(container.textContent).toContain(t.fileFailures.not_this_format);
    expect(container.textContent).not.toContain(t.ready);
  });

  it("a cancelled dialog changes nothing", async () => {
    await choose([new File([REPORT], "maerz.csv")]);
    await choose([]);
    expect(status()).toBe(t.done(1));
    expect(container.textContent).toContain("maerz.csv");
  });

  it("a new choice replaces the old one, and the input is emptied for the next", async () => {
    await choose([new File([REPORT], "maerz.csv")]);
    expect(input().value).toBe("");
    await choose([new File([REPORT], "maerz.csv"), new File([REPORT], "kopie.csv")]);
    expect(status()).toBe(t.done(2));
    expect(container.textContent).toContain(t.warnings.duplicate_files);
  });

  it("reset empties the preview and returns the focus to the input", async () => {
    await choose([new File([REPORT], "maerz.csv")]);
    const reset = [...container.querySelectorAll("button")].find((b) => b.textContent === t.reset)!;
    act(() => reset.click());
    expect(status()).toBe("");
    expect(container.textContent).not.toContain("maerz.csv");
    expect(document.activeElement).toBe(input());
  });

  it("imports no server action and calls no network", () => {
    expect(SOURCE).not.toMatch(/server\/actions|analyseReconciliation|fetch\(|XMLHttpRequest|\.rpc\(/);
  });

  it("keeps long file names inside a phone's width", async () => {
    await choose([new File([REPORT], `${"sehr-langer-dateiname-".repeat(8)}.csv`)]);
    expect(container.querySelector("li p.break-all")).not.toBeNull();
    expect(input().className).toContain("max-w-full");
  });
});
