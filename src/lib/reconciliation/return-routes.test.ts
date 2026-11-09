/**
 * From the reconciliation into the Orderbuch and back (`routes.ts`,
 * 2026-11-08): three checked parts, never a URL; the way back is built.
 */
import { describe, expect, it } from "vitest";

import { orderbookEditHref, orderbookItemsHref, parseReturn, parseViewParam, returnHref, returnQuery, withReturn } from "./routes";

describe("the way back", () => {
  it("is built from session, filter and order — never taken from the address bar", () => {
    const t = parseReturn({ abgleich: "5", bestellung: "50", ansicht: "ergaenzen" })!;
    expect(t).toEqual({ sessionId: 5, matchId: 50, view: "supplement" });
    expect(returnHref(t)).toBe("/business/orderbuch/abgleich/5?ansicht=ergaenzen#recon-match-50");
    expect(returnQuery(t)).toBe("abgleich=5&bestellung=50&ansicht=ergaenzen");
  });

  it("without a filter it returns to 'Alle'", () => {
    expect(returnHref(parseReturn({ abgleich: "5", bestellung: "50" })!)).toBe("/business/orderbuch/abgleich/5#recon-match-50");
  });

  it.each([
    ["https://evil.example", "50"], ["//evil.example", "50"], ["5", "javascript:alert(1)"], ["0", "50"], ["-5", "50"],
    ["5.0", "50"], ["05", "50"], ["5", ""], ["", "50"], ["9".repeat(17), "50"], ["5 ", "50"], ["5%2F..", "50"],
  ])("refuses anything but two plain ids (%s, %s)", (abgleich, bestellung) => {
    expect(parseReturn({ abgleich, bestellung })).toBeNull();
  });

  it("a filter word outside the list is dropped, never passed on", () => {
    for (const w of ["../admin", "kategorie", "<script>", "IDENTISCH"]) {
      expect(parseViewParam(w)).toBeNull();
      expect(parseReturn({ abgleich: "5", bestellung: "50", ansicht: w })?.view).toBeNull();
    }
  });

  it("without a way back an Orderbuch address stays exactly as it was", () => {
    for (const href of ["/business/orderbuch/verkauf", "/business/orderbuch/verkauf?jahr=2026&monat=2"]) {
      expect(withReturn(href, null)).toBe(href);
    }
    expect(withReturn("/business/orderbuch/verkauf?jahr=2026", { sessionId: 5, matchId: 50, view: null }))
      .toBe("/business/orderbuch/verkauf?jahr=2026&abgleich=5&bestellung=50");
  });

  it("'Im Orderbuch bearbeiten' opens the sale's edit dialog on the sales list — the one place a date is corrected", () => {
    expect(orderbookEditHref(64, { sessionId: 5, matchId: 50, view: "deviation" }))
      .toBe("/business/orderbuch/verkauf?verkauf=64&abgleich=5&bestellung=50&ansicht=abweichung");
    expect(orderbookEditHref(64, null)).toBe("/business/orderbuch/verkauf?verkauf=64");
  });
});

describe("to the sale's positions (figures and count, 2026-11-08)", () => {
  it("the sale's own page at its positions, with the same checked parts", () => {
    expect(orderbookItemsHref(152, { sessionId: 12, matchId: 191, view: "deviation" }))
      .toBe("/business/orderbuch/verkauf/152?abgleich=12&bestellung=191&ansicht=abweichung#positionen");
    expect(orderbookItemsHref(152, null)).toBe("/business/orderbuch/verkauf/152#positionen");
  });

  it("the page reads the same parts back into the way to the same card", () => {
    const href = orderbookItemsHref(152, { sessionId: 12, matchId: 191, view: null });
    const q = new URLSearchParams(href.split("?")[1].split("#")[0]);
    expect(returnHref(parseReturn({ abgleich: q.get("abgleich"), bestellung: q.get("bestellung"), ansicht: q.get("ansicht") })!))
      .toBe("/business/orderbuch/abgleich/12#recon-match-191");
  });
});
