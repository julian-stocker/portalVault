/**
 * The rivals on screen (2026-11-09): named, dated, with the shared figure,
 * all positions and a link to the Orderbuch — and no control that could make
 * the take-over pass.
 */
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children),
}));

const { RivalSales } = await import("./rival-sales");
const { de } = await import("@/lib/i18n/de");
const t = de.business.reconciliation.reconcile.rivals;

const RIVALS = [
  { saleId: 158, soldOn: "2026-05-01", shared: ["Dino Rang"], pieces: ["Eruptor", "Trigger Happy", "Drobot", "Dino Rang"], updatedAt: null },
  { saleId: 160, soldOn: "2026-05-01", shared: ["Camo"], pieces: ["Camo", "Bash"], updatedAt: null },
];

describe("the rival sales", () => {
  it("names each sale with its day, the shared figure and all positions, and links to its positions with the way back", () => {
    const html = renderToStaticMarkup(createElement(RivalSales, { rivals: RIVALS, back: { sessionId: 12, matchId: 191, view: null } }));
    expect(html).toContain(t.title);
    expect(html).toContain(t.sale(158, "01.05.2026"));
    expect(html).toContain("Camo, Bash");
    expect([...html.matchAll(/href="([^"]+)" data-rival-link=""/g)].map((m) => m[1])).toEqual([
      "/business/orderbuch/verkauf/158?abgleich=12&amp;bestellung=191#positionen",
      "/business/orderbuch/verkauf/160?abgleich=12&amp;bestellung=191#positionen",
    ]);
  });

  it("offers nothing to press but the links — display only", () => {
    const html = renderToStaticMarkup(createElement(RivalSales, { rivals: RIVALS }));
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<input");
  });

  it("no rivals: nothing at all", () => {
    expect(renderToStaticMarkup(createElement(RivalSales, { rivals: [] }))).toBe("");
  });
});
