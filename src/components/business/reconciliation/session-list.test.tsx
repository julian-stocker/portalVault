/**
 * The "Abgleich-Historie": only reconciliations that took a value over, with
 * period, day and number of changes — and a way into each.
 */
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { de } from "@/lib/i18n/de";
import type { SessionListItem } from "@/lib/reconciliation/view";
import { HistoryList, inHistory } from "./session-list";

const h = de.business.reconciliation.history;

const item = (over: Partial<SessionListItem> = {}): SessionListItem => ({
  id: 7, channel: "ebay", state: "open", coveredFrom: "2026-02-05", coveredTo: "2026-02-28", chainComplete: true,
  createdAt: "2026-11-05T10:00:00+00:00", closedAt: null, discardedAt: null, snapshotsPurgedAt: null,
  summary: null, files: 1, decided: 4, applied: 2, ...over,
});

const html = (sessions: SessionListItem[]) => renderToStaticMarkup(<HistoryList sessions={sessions} />);
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("the history", () => {
  it("only a session that took a value over belongs in it", () => {
    expect(inHistory({ applied: 0 })).toBe(false);
    expect(inHistory({ applied: 1 })).toBe(true);
  });

  it("uploads, analyses and unconfirmed sessions stay out — then one sentence, no list", () => {
    const out = html([item({ id: 1, applied: 0 }), item({ id: 2, applied: 0, state: "discarded" }), item({ id: 3, applied: 0, decided: 9 })]);
    expect(out).toContain(h.empty);
    expect(out).not.toContain("<ul");
  });

  it("an entry: period, day of the reconciliation, changes taken over, a link to its page", () => {
    const out = html([item()]);
    const t = text(out);
    expect(t).toContain(`${h.period} 05.02.2026 – 28.02.2026`);
    expect(t).toContain(`${h.date} 05.11.2026`);
    expect(t).toContain(`${h.applied} ${h.appliedCount(2)}`);
    expect(out).toContain('href="/business/orderbuch/abgleich/7"');
    expect(t).toContain(h.open);
  });

  it("lists only the applied ones, in the order delivered, and says when one is closed", () => {
    const out = html([item({ id: 9, applied: 3, state: "closed" }), item({ id: 8, applied: 0 }), item({ id: 7, applied: 1 })]);
    expect(out.match(/<article/g)).toHaveLength(2);
    expect(out.indexOf("abgleich/9")).toBeLessThan(out.indexOf("abgleich/7"));
    expect(out).not.toContain("abgleich/8");
    expect(text(out)).toContain(h.closed);
  });

  it("shows no analysis categories, protocol or decision counts", () => {
    const t = text(html([item()]));
    for (const word of ["Stimmt überein", "Verkaufsprotokoll", "Befunde mit Entscheidung", "Sitzung 7"]) {
      expect(t).not.toContain(word);
    }
  });

  it("offers no way to remove an entry — that needs a database change first", () => {
    const src = readFileSync("src/components/business/reconciliation/session-list.tsx", "utf8");
    expect(src).not.toMatch(/discardReconciliation|seller_recon_discard|delete|onClick/);
  });

  it("is a labelled list of articles, each named by its heading", () => {
    const out = html([item()]);
    expect(out).toContain(`aria-label="${h.heading}"`);
    expect(out).toContain('aria-labelledby="recon-history-7"');
    expect(out).toContain('id="recon-history-7"');
  });
});
