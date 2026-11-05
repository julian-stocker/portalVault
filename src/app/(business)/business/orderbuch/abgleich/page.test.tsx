/**
 * /business/orderbuch/abgleich — the route, its gates and its states,
 * rendered on the server the way Next renders it (static markup).
 */
import { readdirSync, readFileSync } from "node:fs";

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionListResult } from "@/lib/reconciliation/server/queries";

const MOCK = vi.hoisted(() => ({
  environment: true,
  result: { status: "ok", sessions: [] } as SessionListResult,
  fetched: 0,
}));
vi.mock("@/lib/reconciliation/server/queries", () => ({
  reconciliationEnvironment: () => MOCK.environment,
  fetchReconciliationSessions: async () => { MOCK.fetched += 1; return MOCK.result; },
}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  useRouter: () => ({ push: () => {} }),
}));
vi.mock("@/lib/reconciliation/server/actions", () => ({ analyseReconciliation: async () => ({ ok: false, message: "-" }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children),
}));

const { default: ReconciliationPage } = await import("./page");
const { de } = await import("@/lib/i18n/de");
const copy = de.business.reconciliation;

const PAGE = readFileSync("src/app/(business)/business/orderbuch/abgleich/page.tsx", "utf8");
const SALES = readFileSync("src/app/(business)/business/orderbuch/verkauf/page.tsx", "utf8");
const NAV = readFileSync("src/components/business/orderbook-nav.tsx", "utf8");

const render = async (sitzung?: string) =>
  renderToStaticMarkup(await ReconciliationPage({ searchParams: Promise.resolve({ sitzung }) }));

const session = (id: number, state: "open" | "closed" | "discarded") => ({
  id, channel: "ebay", state, coveredFrom: "2026-01-01", coveredTo: "2026-01-31", chainComplete: true,
  createdAt: "2026-11-03T10:00:00+00:00",
  closedAt: state === "closed" ? "2026-11-04T10:00:00+00:00" : null,
  discardedAt: state === "discarded" ? "2026-11-04T10:00:00+00:00" : null,
  snapshotsPurgedAt: null, summary: null, files: 1, decided: 0, applied: 0,
});

beforeEach(() => {
  MOCK.environment = true;
  MOCK.result = { status: "ok", sessions: [] };
  MOCK.fetched = 0;
});

describe("the gates", () => {
  it("outside Staging: 404, before anything is read", async () => {
    MOCK.environment = false;
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(MOCK.fetched).toBe(0);
  });

  it("not the seller operator: 404 (the layout's gate, asked again)", async () => {
    MOCK.result = { status: "unavailable" };
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("the environment is checked before the first query, in the source too", () => {
    expect(PAGE.indexOf("if (!reconciliationEnvironment()) notFound();"))
      .toBeLessThan(PAGE.indexOf("await fetchReconciliationSessions()"));
  });

  it("no loading boundary in the seller area: it would stream before the layout's 404", () => {
    // Measured on the local Staging server (2026-11-03): an anonymous request to
    // this route received the 404 AND the loading.tsx fallback — heading and
    // sentence of a page that, for that visitor, must not exist (ADR-0077).
    const loading = readdirSync("src/app/(business)", { recursive: true })
      .map(String).filter((f) => /(^|\/)loading\.(tsx|ts|jsx|js)$/.test(f));
    expect(loading).toEqual([]);
  });

  it("reads only — no server action, no RPC, no table", () => {
    expect(PAGE).not.toMatch(/server\/actions|\.rpc\(|\.from\(|"use client"/);
  });
});

describe("the states", () => {
  it("empty: the heading and one sentence, no alert", async () => {
    const html = await render();
    expect(html).toContain(`<h1`);
    expect(html).toContain(copy.title);
    expect(html).toContain(copy.list.empty);
    expect(html).not.toContain('role="alert"');
  });

  it("error: an alert with a way to reload — never the empty sentence", async () => {
    MOCK.result = { status: "error" };
    const html = await render();
    expect(html).toContain('role="alert"');
    expect(html).toContain(copy.errors.loadFailed);
    expect(html).toContain('href="/business/orderbuch/abgleich"');
    expect(html).not.toContain(copy.list.empty);
  });

  it("sessions in all three states, newest first as delivered", async () => {
    MOCK.result = { status: "ok", sessions: [session(3, "open"), session(2, "closed"), session(1, "discarded")] };
    const html = await render();
    const order = ["Sitzung 3", "Sitzung 2", "Sitzung 1"].map((t) => html.indexOf(t));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (const s of ["open", "closed", "discarded"] as const) expect(html).toContain(copy.states[s]);
  });

  it("links back to Verkauf and to each session's comparison page", async () => {
    MOCK.result = { status: "ok", sessions: [session(3, "open")] };
    const hrefs = [...(await render()).matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(["/business/orderbuch/verkauf", "/business/orderbuch/abgleich/3"]);
  });
});

describe("after an analysis (?sitzung=)", () => {
  it("marks exactly that session (older links; an analysis now opens the session page)", async () => {
    MOCK.result = { status: "ok", sessions: [session(3, "open"), session(2, "closed")] };
    const html = await render("3");
    expect(html.match(/data-marked="true"/g)?.length).toBe(1);
    expect(html).toMatch(/data-marked="true"[^>]*>[\s\S]*?Sitzung 3/);
    expect(html).toContain(copy.list.justAnalysed);
  });

  it("ignores anything that is not a session id", async () => {
    MOCK.result = { status: "ok", sessions: [session(3, "open")] };
    for (const value of ["abc", "-3", "3.5", "", "0"]) expect(await render(value)).not.toContain("data-marked");
  });
});

describe("the way in from Verkauf", () => {
  it("is a link under Extern, only where the reconciliation exists", () => {
    expect(SALES).toMatch(/scope === "extern" && reconciliationEnvironment\(\) \?[\s\S]*href=\{RECONCILIATION_PATH\}/);
    expect(SALES).toContain('import { RECONCILIATION_PATH } from "@/lib/reconciliation/routes"');
    expect(SALES).toContain("de.business.reconciliation.entry");
  });

  it("is not a third tab — the Orderbuch keeps its two", () => {
    expect(NAV.match(/role="tab"/g)?.length).toBe(4); // Einkauf and Verkauf, each as span or link
    expect(NAV).not.toContain("abgleich");
  });
});
