/**
 * MEHR ZURÜCKNEHMEN, ALS RAUSGEGANGEN IST — DER FALL, DER NICHT PASSIEREN DARF.
 *
 * Endzustand von A3 auf SI-2026-001067, line 70: 3 bestellt, 1 storniert,
 * 2 zurückgenommen. Nichts ist mehr beim Kunden. Ein dritter Wareneingang
 * würde eine Figur ins Regal buchen, die niemand geschickt hat — Bestand aus
 * dem Nichts, und im Gefolge ein Erstattungsvorschlag für Geld, das niemand
 * bezahlt hat.
 *
 * Drei Sperren, unabhängig voneinander:
 *
 *   1. Der Bildschirm bietet die Aktion nicht an (`returnable = 0`).
 *   2. `seller_receive_order_return()` weist ab — BEVOR irgendetwas
 *      geschrieben wird, und unter der Zeilensperre, die oben genommen wurde.
 *   3. Die Mengenableitung selbst kann nicht negativ werden.
 *
 * GEPRÜFT WIRD DER CODE, NICHT DIE STAGING-DATENBANK. Ein Negativtest gegen
 * Staging hieße, den Fehlversuch dort wirklich auszulösen; das Ergebnis wäre
 * dasselbe, das Risiko unnötig, und ein manueller SQL-Write nur zum Aufbau
 * eines Verstoßzustands ist in diesem Projekt ausgeschlossen.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { lineQuantities } from "./order-lines";

const SQL = readFileSync("supabase/migrations/0095_order_cancellation_and_returns.sql", "utf8");
const RETURN_FN = SQL.slice(
  SQL.indexOf("create or replace function public.seller_receive_order_return"),
  SQL.indexOf("\n$$;", SQL.indexOf("create or replace function public.seller_receive_order_return")),
);
const DIALOG = readFileSync("src/components/admin/order-line-actions.tsx", "utf8");
const ORDER_PAGE = readFileSync(
  "src/app/(business)/business/orders/[orderNumber]/page.tsx", "utf8");

/** Genau der Zustand, in dem line 70 nach A3 steht. */
const A3_END = lineQuantities(3, [
  { kind: "cancelled", quantity: 1 },
  { kind: "returned", quantity: 1 },
  { kind: "returned", quantity: 1 },
]);

describe("nothing is left to come back", () => {
  it("is what the quantities say after A3", () => {
    expect(A3_END).toMatchObject({
      ordered: 3, cancelled: 1, returned: 2,
      outstanding: 0, returnable: 0, cancellable: 0,
      /* `fulfillable` ist `ordered − cancelled` und damit eine andere Frage. */
      fulfillable: 2,
    });
  });

  it("stays at zero however the ledger is read", () => {
    // Auch ein (unmöglicher) dritter Eingang im Journal macht es nicht negativ.
    const beyond = lineQuantities(3, [
      { kind: "cancelled", quantity: 1 },
      { kind: "returned", quantity: 1 },
      { kind: "returned", quantity: 1 },
      { kind: "returned", quantity: 1 },
    ]);
    expect(beyond.returnable).toBe(0);
    expect(beyond.outstanding).toBe(0);
  });
});

describe("1 — the screen offers nothing", () => {
  it("renders no control at all once nothing is open", () => {
    expect(DIALOG).toContain('if (mode === "none" || open <= 0) return null;');
  });

  it("feeds it the returnable quantity, not the ordered one", () => {
    expect(ORDER_PAGE).toContain('open={lineMode === "return"');
    expect(ORDER_PAGE).toContain("(line.returnable ?? 0)");
  });

  it("would refuse a hand-typed quantity above what is open", () => {
    // Der Dialog prüft gegen `open`, bevor er die Aktion überhaupt ruft.
    expect(DIALOG).toContain("amount > open");
    expect(DIALOG).toContain("setError(copy.quantityInvalid)");
  });
});

describe("2 — the server refuses before it writes", () => {
  it("reads what is still out and compares against it", () => {
    expect(RETURN_FN).toContain("select q.returnable into v_open");
    expect(RETURN_FN).toContain("if p_quantity > v_open then");
    expect(RETURN_FN).toContain("only % of this position are still out");
    expect(RETURN_FN).toContain("errcode = 'check_violation'");
  });

  /* DER KERN DES SCHUTZES: die Reihenfolge. */
  it("puts that check ahead of every single write", () => {
    const guard = RETURN_FN.indexOf("if p_quantity > v_open then");
    expect(guard).toBeGreaterThan(-1);
    for (const write of [
      "public.apply_inventory_movement(",
      "insert into public.order_line_events",
      "insert into public.order_events",
    ]) {
      const at = RETURN_FN.indexOf(write);
      expect(at, write).toBeGreaterThan(-1);
      expect(at, write).toBeGreaterThan(guard);
    }
  });

  it("holds the row locks while it decides", () => {
    // Zwei gleichzeitige Rücknahmen können sich nicht aneinander vorbeimogeln.
    const lock = RETURN_FN.indexOf("for update");
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(RETURN_FN.indexOf("if p_quantity > v_open then"));
  });

  it("changes no stock by any other route", () => {
    // Der einzige Bestandsweg ist `apply_inventory_movement`; kein direktes
    // UPDATE auf `shop_inventory`, nirgends.
    expect(RETURN_FN).not.toContain("update public.shop_inventory");
    expect(RETURN_FN).not.toContain("insert into public.inventory_movements");
  });

  it("touches no money at all, refused or not", () => {
    // Eine Retoure erstattet nie — also kann ein abgewiesener Versuch erst
    // recht keinen Erstattungsdatensatz hinterlassen.
    expect(RETURN_FN).not.toContain("order_refunds");
    expect(RETURN_FN).not.toContain("order_refund_allocations");
    expect(RETURN_FN).not.toContain("payment_status =");
  });

  /**
   * Und weil ein RPC über PostgREST eine Transaktion ist, macht ein `raise`
   * alles rückgängig, was davor in derselben Anweisung geschehen wäre. Hier
   * ist davor ohnehin nichts — die beiden Sätze zusammen sind der Beweis,
   * dass ein Overreturn weder Ereignis noch Bewegung noch Bestand hinterlässt.
   */
  it("refuses with an exception, not a silent return", () => {
    const guardBlock = RETURN_FN.slice(
      RETURN_FN.indexOf("if p_quantity > v_open then"),
      RETURN_FN.indexOf("public.apply_inventory_movement("));
    expect(guardBlock).toContain("raise exception");
    expect(guardBlock).not.toContain("return");
  });
});

describe("3 — the client maps the refusal to something readable", () => {
  it("has a sentence for it", () => {
    const actions = readFileSync("src/lib/admin/order-line-actions.ts", "utf8");
    expect(actions).toContain('text.includes("are still out")');
    expect(actions).toContain("copy.tooMany");
  });
});
