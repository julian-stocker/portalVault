import { describe, expect, it } from "vitest";

import {
  attentionTotal, readAttention, roleAttention, unreadOrderNumbers,
} from "./attention.ts";

/**
 * Die reine Hälfte von 0099: lesen, summieren, „Neu" entscheiden.
 *
 * Was hier NICHT steht, ist so wichtig wie der Rest: kein Bestellstatus.
 * „Bezahlt", „zu versenden" und „versendet" sind Arbeit, keine
 * Aufmerksamkeit — sie kommen in dieser Datei nicht vor, weil sie in der
 * Rechnung nicht vorkommen dürfen.
 */
const ROW = (orderNumber: string, unread: number, total = unread) => ({
  order_number: orderNumber,
  last_at: "2026-09-25T17:05:33.000Z",
  unread,
  total,
});

describe("was die Datenbank liefert, kommt heil an", () => {
  it("liest eine gewöhnliche Antwort", () => {
    const rows = readAttention([ROW("SI-2026-001009", 2, 3)]);
    expect(rows).toEqual([{
      orderNumber: "SI-2026-001009",
      lastAt: "2026-09-25T17:05:33.000Z",
      unread: 2,
      total: 3,
    }]);
  });

  it("wirft nie, sondern lässt Unbrauchbares weg", () => {
    expect(readAttention(null)).toEqual([]);
    expect(readAttention("nope")).toEqual([]);
    expect(readAttention([null, 7, {}, { order_number: "" }])).toEqual([]);
    // Eine kaputte Zeile nimmt die gesunde daneben nicht mit.
    expect(readAttention([{ order_number: "X" }, ROW("SI-1", 1)])).toHaveLength(1);
  });

  it("macht aus Unsinn nie eine Zahl", () => {
    const [row] = readAttention([{ ...ROW("SI-1", 0), unread: "viele", total: -4 }]);
    expect(row.unread).toBe(0);
    expect(row.total).toBe(0);
  });
});

describe("die drei Ebenen rechnen dieselbe Zahl", () => {
  const rows = readAttention([ROW("SI-1", 2), ROW("SI-2", 0, 5), ROW("SI-3", 1)]);

  it("die Karte summiert die Ereignisse, nicht die Bestellungen", () => {
    // Zwei ungesehene Meldungen an einer Bestellung sind zwei, nicht eine.
    expect(attentionTotal(rows)).toBe(3);
  });

  it("markiert nur die Bestellungen mit etwas Ungesehenem", () => {
    expect(unreadOrderNumbers(rows)).toEqual(new Set(["SI-1", "SI-3"]));
  });

  it("das Symbol ist die Summe der Kanäle der Rolle", () => {
    expect(roleAttention({ messages: 1, orders: 3 })).toBe(4);
    expect(roleAttention({ messages: 0, orders: 0 })).toBe(0);
  });

  it("und niemals negativ, was auch immer hereinkommt", () => {
    expect(roleAttention({ messages: -5, orders: 2 })).toBe(2);
  });
});
