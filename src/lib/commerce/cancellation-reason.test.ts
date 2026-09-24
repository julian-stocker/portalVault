/**
 * Der Stornierungsgrund (0097).
 *
 * DIE REGEL, DIE JEDER TEST HIER BEWACHT: der Grund entscheidet nichts über
 * den Bestand. Zwei Fragen, zwei Antworten, keine Vorauswahl — und zwischen
 * ihnen keine Leitung, weder im Formular noch in der Aktion noch im RPC.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { CANCEL_REASONS, REASON_TAKES_TEXT, isCancelReason } from "./order-lines";
import { de } from "@/lib/i18n/de";

const MIGRATION = readFileSync("supabase/migrations/0097_cancellation_reason.sql", "utf8");
const DIALOG = readFileSync("src/components/admin/order-line-actions.tsx", "utf8");
const ACTION = readFileSync("src/lib/admin/order-line-actions.ts", "utf8");
const copy = de.admin.orders.lineActions;

describe("the five reasons", () => {
  it("are the five the operator asked for", () => {
    expect([...CANCEL_REASONS]).toEqual([
      "buyer_request", "item_not_found", "item_damaged", "stock_incorrect", "other",
    ]);
  });

  it("each have a German label", () => {
    for (const value of CANCEL_REASONS) {
      expect(copy.reasons[value], value).toBeTruthy();
    }
    expect(copy.reasons.buyer_request).toBe("Käuferwunsch");
    expect(copy.reasons.item_damaged).toBe("Artikel beschädigt");
  });

  it("are the same set the database will accept", () => {
    const check = MIGRATION.slice(
      MIGRATION.indexOf("order_line_events_reason_code_known"),
      MIGRATION.indexOf("reason_code_only_on_cancel"));
    for (const value of CANCEL_REASONS) expect(check, value).toContain(`'${value}'`);
    // Und der RPC prüft dieselben, damit die Meldung brauchbar ist.
    const rpc = MIGRATION.slice(MIGRATION.indexOf("unknown cancellation reason") - 400);
    for (const value of CANCEL_REASONS) expect(rpc, value).toContain(`'${value}'`);
  });

  it("refuse anything else", () => {
    for (const value of ["", "sonstiges", "Käuferwunsch", null, undefined, 7, {}]) {
      expect(isCancelReason(value), String(value)).toBe(false);
    }
    expect(isCancelReason("other")).toBe(true);
  });

  it("take free text in exactly one of them", () => {
    expect(REASON_TAKES_TEXT).toBe("other");
    expect(DIALOG).toContain("reasonCode === REASON_TAKES_TEXT ? reason : undefined");
  });
});

describe("the reason never decides what the shelf did", () => {
  /* Die beiden Gründe, die zum Raten einladen. */
  it("still asks about the shelf for a damaged or missing article", () => {
    // Es gibt keine Abbildung Grund → presence, nirgends.
    for (const source of [DIALOG, ACTION]) {
      expect(source).not.toMatch(/item_damaged[\s\S]{0,120}(presence|missing|present)/);
      expect(source).not.toMatch(/item_not_found[\s\S]{0,120}(presence|missing|present)/);
      /* Und niemand leitet die eine Antwort aus der anderen ab. */
      expect(source).not.toMatch(/setPresence\([^)]*reason/i);
      expect(source).not.toMatch(/presence\s*[:=][^,;\n]*reasonCode/);
    }
  });

  it("keeps both questions mandatory and neither pre-selected", () => {
    expect(DIALOG).toContain("useState<CancelReason | null>(null)");
    expect(DIALOG).toContain("useState<StockPresence | null>(null)");
    expect(DIALOG).toContain("reasonCode === null");
    expect(DIALOG).toContain("presence === null");
    // Kein `checked`/`selected` auf einer bestimmten Antwort.
    expect(DIALOG).toContain('<option value="">—</option>');
  });

  it("does not compute the outcome from the reason in SQL either", () => {
    const outcome = MIGRATION.slice(
      MIGRATION.indexOf("v_outcome := case"), MIGRATION.indexOf("end;", MIGRATION.indexOf("v_outcome := case")));
    expect(outcome).toContain("p_stock_presence");
    expect(outcome).not.toContain("p_reason");
  });
});

describe("the migration", () => {
  it("adds the column without touching a row", () => {
    expect(MIGRATION).toContain("add column if not exists reason_code text");
    for (const forbidden of ["update public.order_line_events", "delete from"]) {
      expect(MIGRATION.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("keeps the reason out of a return", () => {
    expect(MIGRATION).toContain("reason_code is null or kind = 'cancelled'");
  });

  it("drops the old signature before creating the new one", () => {
    // Ein fünfter Parameter erzeugt sonst eine zweite Funktion — PGRST203,
    // derselbe Fehler wie bei seller_record_refund in 0095.
    const drop = MIGRATION.indexOf(
      "drop function if exists public.seller_cancel_order_line(bigint, integer, text, text);");
    const create = MIGRATION.indexOf("create or replace function public.seller_cancel_order_line(");
    expect(drop).toBeGreaterThan(-1);
    expect(drop).toBeLessThan(create);
  });

  it("restores the privileges the dropped function had", () => {
    expect(MIGRATION).toContain(
      "revoke all on function public.seller_cancel_order_line(bigint, integer, text, text, text)");
    expect(MIGRATION).toContain(
      "grant execute on function public.seller_cancel_order_line(bigint, integer, text, text, text)");
  });

  it("moves no stock and no money", () => {
    for (const forbidden of ["order_refunds", "shop_inventory", "sale_price"]) {
      expect(MIGRATION).not.toContain(forbidden);
    }
    // Die beiden Bewegungen des Stornos bleiben, wie 0095 sie geschrieben hat.
    expect(MIGRATION).toContain("'return',");
    expect(MIGRATION).toContain("'correction',");
  });
});

describe("the action", () => {
  it("refuses an unknown reason before it reaches the database", () => {
    expect(ACTION).toContain("if (!isCancelReason(input.reasonCode))");
    expect(ACTION).toContain("p_reason_code: input.reasonCode");
  });

  it("leaves the return untouched", () => {
    const fn = ACTION.slice(ACTION.indexOf("export async function receiveOrderReturn"));
    expect(fn).not.toContain("reasonCode");
    expect(fn).toContain("p_reason: input.reason?.trim() || null");
  });
});
