/**
 * The session cards: every state in words, only the database's numbers,
 * and nothing that looks like a count of pending decisions.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { de } from "@/lib/i18n/de";
import type { SessionListItem, SessionSummary } from "@/lib/reconciliation/view";
import { SessionList } from "./session-list";

const copy = de.business.reconciliation;

const SUMMARY: SessionSummary = {
  categories: { exact: 302, deviating: 8, probable: 1, ambiguous: 0, external_only: 0, ledger_only: 0, not_comparable: 23 },
  byMonth: {},
  money: {
    items_net: { positive: 0, negative: 0, balance: 0, count: 0 },
    shipping: { positive: 0, negative: 0, balance: 0, count: 0 },
    total: { positive: 56.17, negative: 0, balance: 56.17, count: 2 },
  },
  deviations: { sold_on: 3, items_net: 0, shipping: 0, pieces: 0, figure: 0, total: 2 },
  referenceAdditions: 311,
};

const item = (over: Partial<SessionListItem> = {}): SessionListItem => ({
  id: 7, channel: "ebay", state: "open", coveredFrom: "2026-01-01", coveredTo: "2026-09-30", chainComplete: true,
  createdAt: "2026-11-03T10:00:00+00:00", closedAt: null, discardedAt: null, snapshotsPurgedAt: null,
  summary: SUMMARY, files: 9, decided: 4, applied: 2, ...over,
});

const html = (sessions: SessionListItem[]) => renderToStaticMarkup(<SessionList sessions={sessions} />);
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("SessionList", () => {
  it("empty: one sentence, no list", () => {
    const out = html([]);
    expect(out).toContain(copy.list.empty);
    expect(out).not.toContain("<ul");
  });

  it("an open session: state in words, period, files, protocol, the delivered numbers", () => {
    const t = text(html([item()]));
    expect(t).toContain("Sitzung 7");
    expect(t).toContain("eBay");
    expect(t).toContain(copy.states.open);
    expect(t).toContain(copy.list.stateHints.open);
    expect(t).toContain("01.01.2026 – 30.09.2026");
    expect(t).toContain(`${copy.list.files} 9`);
    expect(t).toContain(`${copy.list.chain} ${copy.list.chainComplete}`);
    expect(t).toContain(`${copy.list.decided} 4 (${copy.list.decidedHint})`);
    expect(t).toContain(`${copy.list.applied} 2`);
  });

  it("closed and discarded say so, with their day", () => {
    const t = text(html([
      item({ id: 2, state: "closed", closedAt: "2026-11-04T10:00:00+00:00" }),
      item({ id: 1, state: "discarded", discardedAt: "2026-11-05T10:00:00+00:00", applied: 0 }),
    ]));
    expect(t).toContain(`${copy.states.closed}`);
    expect(t).toContain(`${copy.list.closedAt} 04.11.2026`);
    expect(t).toContain(`${copy.states.discarded}`);
    expect(t).toContain(`${copy.list.discardedAt} 05.11.2026`);
    expect(t).not.toContain(copy.list.stateHints.open);
  });

  it("each state has its own marker, so the state is never only a tint", () => {
    const out = html([item({ state: "open" }), item({ id: 2, state: "closed", closedAt: "2026-11-04T10:00:00+00:00" })]);
    expect(out).toContain('data-state="open"');
    expect(out).toContain('data-state="closed"');
  });

  it("shows the non-empty categories of the stored summary, and nothing else from it", () => {
    const t = text(html([item()]));
    expect(t).toContain(`${copy.categories.exact} 302`);
    expect(t).toContain(`${copy.categories.deviating} 8`);
    expect(t).toContain(`${copy.categories.not_comparable} 23`);
    expect(t).not.toContain(copy.categories.ambiguous);
    expect(t).not.toContain("56,17");
  });

  it("without a readable summary: says so instead of inventing zeros", () => {
    const t = text(html([item({ summary: null })]));
    expect(t).toContain(copy.list.noSummary);
    expect(t).not.toContain(copy.categories.exact);
  });

  it("no period, gaps in the protocol, purged snapshots", () => {
    const t = text(html([item({ coveredFrom: null, coveredTo: null, chainComplete: false, state: "closed", closedAt: "2026-11-04T10:00:00+00:00", snapshotsPurgedAt: "2026-11-05T10:00:00+00:00" })]));
    expect(t).toContain(copy.list.noPeriod);
    expect(t).toContain(copy.list.chainIncomplete);
    expect(t).toContain(copy.snapshotsPurged);
  });

  it("never calls `decided` open, pending or applicable", () => {
    // The state chip says "Offen" about the SESSION; nothing else may use the word.
    const t = text(html([item()])).toLowerCase().replace(` ${copy.states.open.toLowerCase()} `, " ");
    expect(t).not.toMatch(/\b(offene?[nrs]?|ausstehend\w*|anwendbar\w*)\b/);
  });

  it("is a labelled list of articles, each named by its heading — the heading opens the session", () => {
    const out = html([item(), item({ id: 8 })]);
    expect(out).toContain(`aria-label="${copy.list.heading}"`);
    expect(out.match(/<article aria-labelledby="recon-session-(7|8)"/g)?.length).toBe(2);
    expect(out).toContain('id="recon-session-7"');
    const hrefs = [...out.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(["/business/orderbuch/abgleich/7", "/business/orderbuch/abgleich/8"]);
  });

  it("stacks on a phone and uses two columns from sm: up", () => {
    const out = html([item()]);
    expect(out).toContain("grid-cols-1");
    expect(out).toContain("sm:grid-cols-2");
  });
});
