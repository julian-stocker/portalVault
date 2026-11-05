/**
 * The preview of a selection, read strictly (0180, step 6A), and the
 * separation between preparing and applying, read as source.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DateGapNotice } from "@/components/business/reconciliation/date-gap-notice";
import { de } from "@/lib/i18n/de";
import {
  dayDistance, largeDateGapDecisions, SELECTION_PROBLEMS, SelectionContractError, selectionIds, selectionPreviewView,
} from "./selection";

const TOKEN = "f".repeat(64);
const change = (over: Record<string, unknown> = {}) => ({
  decisionId: 7, problem: null, findingId: 70, matchId: 700, saleId: 5, orderRef: "55-1", field: "sold_on",
  decision: "take_external", old: { soldOn: "2026-03-01" }, target: { soldOn: "2026-03-02" },
  version: { analysed: "x", current: "x" }, ...over,
});
const preview = (changes: unknown[], over: Record<string, unknown> = {}) => ({
  sessionId: 3, state: "open", sessionOpen: true, count: changes.length, problems: 0, admissible: true, staleSales: 0,
  token: TOKEN, changes, ...over,
});

describe("the preview, read strictly", () => {
  it("reads every key and keeps old and target as the database said them", () => {
    const v = selectionPreviewView(preview([change()]));
    expect(v).toMatchObject({ sessionId: 3, sessionOpen: true, count: 1, problems: 0, admissible: true, token: TOKEN });
    expect(v.changes[0]).toMatchObject({ decisionId: 7, problem: null, field: "sold_on", saleId: 5,
      old: { soldOn: "2026-03-01" }, target: { soldOn: "2026-03-02" }, dateGap: { from: "2026-03-01", to: "2026-03-02", days: 1 },
      largeDateGap: false });
  });

  it.each([
    ["an unknown problem code", preview([change({ problem: "guess" })], { admissible: false, problems: 1 })],
    ["a field off the whitelist, applicable", preview([change({ field: "total" })])],
    ["applicable without a target", preview([change({ target: null })])],
    ["admissible with a problem", preview([change({ problem: "uncertain" })])],
    ["admissible without a token", preview([change()], { token: null })],
    ["a token that is none", preview([change()], { token: "x" })],
    ["a missing key", (() => { const p = preview([change()]) as Record<string, unknown>; delete p.staleSales; return p; })()],
    ["changes not a list", preview([], { changes: {} })],
  ])("refuses %s", (_, raw) => {
    expect(() => selectionPreviewView(raw)).toThrow(SelectionContractError);
  });

  it("a refused change of another session: nothing but its id and the code", () => {
    const v = selectionPreviewView(preview([change({ problem: "unknown_decision", findingId: null, matchId: null, saleId: null,
      orderRef: null, field: null, decision: null, old: null, target: null })], { admissible: false, problems: 1 }));
    expect(v.changes[0]).toMatchObject({ problem: "unknown_decision", field: null, dateGap: null, largeDateGap: false });
  });
});

describe("large date gaps (deterministic corrections over three days)", () => {
  it("over three days must be confirmed; three days and less not; backwards counts too", () => {
    const v = selectionPreviewView(preview([
      change({ decisionId: 1, old: { soldOn: "2026-03-01" }, target: { soldOn: "2026-03-04" } }),
      change({ decisionId: 2, old: { soldOn: "2026-03-01" }, target: { soldOn: "2026-03-05" } }),
      change({ decisionId: 3, old: { soldOn: "2026-03-20" }, target: { soldOn: "2026-02-01" } }),
      change({ decisionId: 4, field: "shipping", old: { shipping: 5.49 }, target: { shipping: 4.99 } }),
    ]));
    expect(v.changes.map((c) => [c.decisionId, c.dateGap?.days ?? null, c.largeDateGap])).toEqual([
      [1, 3, false], [2, 4, true], [3, -47, true], [4, null, false]]);
    expect(largeDateGapDecisions(v)).toEqual([2, 3]);
  });

  it("a refused change is never offered for confirmation, however far its days", () => {
    const v = selectionPreviewView(preview([change({ problem: "unique_ref_only", target: { soldOn: "2026-04-01" } })],
      { admissible: false, problems: 1 }));
    expect(v.changes[0].largeDateGap).toBe(false);
  });

  it("day distances only between ISO days, across month and year ends", () => {
    expect(dayDistance("2025-12-30", "2026-01-02")).toBe(3);
    expect(dayDistance("2026-02-28", "2026-03-01")).toBe(1);
    expect(dayDistance("01.03.2026", "2026-03-02")).toBeNull();
    expect(dayDistance(null, "2026-03-02")).toBeNull();
  });

  it("the prepared notice shows both days and the distance, and has no button", () => {
    const [c] = selectionPreviewView(preview([change({ old: { soldOn: "2026-03-01" }, target: { soldOn: "2026-03-10" } })])).changes;
    const html = renderToStaticMarkup(DateGapNotice({ change: c }) ?? <></>);
    expect(html).toContain('role="note"');
    expect(html).toContain(de.business.reconciliation.selection.dateGapTitle);
    expect(html).toContain("9 Tage");
    expect(html).toMatch(/01\.03\.2026.*10\.03\.2026/);
    expect(html).not.toMatch(/<button|<form|<input|href=/);
    const [small] = selectionPreviewView(preview([change()])).changes;
    expect(DateGapNotice({ change: small })).toBeNull();
  });
});

describe("the selection the browser sends", () => {
  it("1 to 500 distinct positive integers, sorted — anything else is no selection", () => {
    expect(selectionIds([9, 7])).toEqual([7, 9]);
    for (const bad of [[], [7, 7], [0], [-1], [1.5], ["7"], null, "7", Array.from({ length: 501 }, (_, i) => i + 1)]) {
      expect(selectionIds(bad)).toBeNull();
    }
    expect(selectionIds(Array.from({ length: 500 }, (_, i) => i + 1))).toHaveLength(500);
  });

  it("every reason code has a German sentence, and nothing else does", () => {
    expect(Object.keys(de.business.reconciliation.selection.problems).sort()).toEqual([...SELECTION_PROBLEMS].sort());
  });
});

// ---------------------------------------------------------------------------
// Preparing is not applying: no page, no component reaches the apply
// ---------------------------------------------------------------------------
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("the separation between preparing and applying", () => {
  const ui = [...sources("src/app"), ...sources("src/components")];

  it("no page and no component imports a deciding, previewing or applying action", () => {
    const hits = ui.filter((f) => /\b(decideFinding|previewSelection|applySelection|applyReconciliation)\b/.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });

  it("no page and no component names a deciding or applying database function", () => {
    // Code only: a comment may explain what a number needs.
    const code = (f: string) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const hits = ui.filter((f) => /seller_recon_(decide|apply|preview|pending)\b/.test(code(f)));
    expect(hits).toEqual([]);
  });

  it("the prepared date-gap notice is mounted nowhere", () => {
    const hits = ui.filter((f) => !f.endsWith("date-gap-notice.tsx") && readFileSync(f, "utf8").includes("date-gap-notice"));
    expect(hits).toEqual([]);
  });

  it("the queries the pages use read only what Staging 0179 has", () => {
    const queries = readFileSync("src/lib/reconciliation/server/queries.ts", "utf8");
    expect([...queries.matchAll(/rpc\("(\w+)"/g)].map((m) => m[1]).sort()).toEqual(["seller_recon_session", "seller_recon_sessions"]);
  });
});
