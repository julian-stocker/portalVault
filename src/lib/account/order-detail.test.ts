import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Was der Käufer von seiner eigenen Bestellung sieht (0102).
 *
 * DER ANLASS WAR EIN ECHTER FALL. `SI-2026-001009`: zwei Anvil Rain, eines
 * storniert, 0,76 € erstattet. In der Datenbank stand das vollständig; auf
 * dem Bestellschirm des Käufers stand weiterhin „2 × Anvil Rain — 1,52 €"
 * und als Gesamtbetrag 7,85 €. `my_order()` war seit `0039` nicht angefasst
 * worden — vor dem gesamten Commerce-Block.
 *
 * Die Regel, die diese Datei bewacht: **die ursprüngliche Position wird nicht
 * umgeschrieben.** Was bestellt wurde, bleibt stehen; was seither geschah,
 * tritt daneben.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("/*");
    })
    .join("\n");
}

const SQL = readFileSync("supabase/migrations/0102_my_order_commerce_state.sql", "utf8");
const PAGE = code("src/app/(app)/account/orders/[orderNumber]/page.tsx");

describe("die Projektion nennt dieselben Zahlen wie die Verkäuferseite", () => {
  it("je Position die vier Mengen, aus dem vorhandenen Helfer", () => {
    expect(SQL).toContain("cross join lateral public.order_line_quantities(l.id) q");
    for (const field of ["'cancelled', q.cancelled", "'returned', q.returned",
                         "'fulfillable', q.fulfillable", "'outstanding', q.outstanding"]) {
      expect(SQL, field).toContain(field);
    }
  });

  it("kein zweiter Rechenweg neben admin_order()", () => {
    const admin = readFileSync("supabase/migrations/0096_order_line_status_and_costs.sql", "utf8");
    // Beide Seiten hängen am selben Helfer; keine Summe wird hier neu gebaut.
    expect(admin).toContain("public.order_line_quantities(l.id) q");
    expect(SQL).not.toContain("sum(ev.quantity)");
  });

  it("je Position die zugeordnete Erstattung, ohne den Versandanteil", () => {
    expect(SQL).toContain("from public.order_refund_allocations al");
    expect(SQL).toContain("where al.order_line_id = l.id");
    expect(SQL).toContain("and al.allocation_type = 'line'");
  });

  it("und die ursprüngliche Position bleibt, was sie war", () => {
    // `quantity` und `line_total` kommen weiterhin roh aus `order_lines`.
    expect(SQL).toContain("'quantity', l.quantity");
    expect(SQL).toContain("'line_total', l.line_total");
    // Nichts rechnet sie klein.
    expect(SQL).not.toMatch(/'quantity',\s*l\.quantity\s*-/);
    expect(SQL).not.toMatch(/'line_total',\s*l\.line_total\s*-/);
  });
});

describe("die drei Beträge auf Bestellebene", () => {
  it("ursprünglich, erstattet, verbleibend", () => {
    expect(SQL).toContain("'total_amount',       v_order.total_amount,");
    expect(SQL).toContain("'refunded_total'");
    expect(SQL).toContain("'remaining_total', v_order.total_amount - coalesce((");
  });

  it("und `total_amount` wird nirgends verändert", () => {
    expect(SQL).not.toMatch(/update public\.orders/);
  });

  it("die Erstattung ist die Summe aller Erstattungen dieser Bestellung", () => {
    expect(SQL).toContain("select sum(r.amount) from public.order_refunds r where r.order_id = v_order.id");
  });
});

describe("die Anzeige sagt es in der Reihenfolge, in der es passiert ist", () => {
  it("storniert, erstattet, verbleibend — unter der Position", () => {
    expect(PAGE).toContain("copy.lineCancelled(line.cancelled ?? 0, line.quantity)");
    expect(PAGE).toContain("copy.lineRefunded");
    expect(PAGE).toContain("copy.lineOutstanding(line.outstanding ?? line.quantity)");
  });

  it("und nur, wenn es etwas zu sagen gibt", () => {
    expect(PAGE).toContain("{(line.cancelled ?? 0) > 0 ?");
    expect(PAGE).toContain("{Number(line.refunded ?? 0) > 0 ?");
    expect(PAGE).toContain("{refunded > 0 ? (");
  });

  it("die Erstattung trägt ihr Vorzeichen und die Warnfarbe", () => {
    expect(PAGE).toContain('className="font-semibold tabular-nums text-danger"');
    expect(PAGE).toContain("−{formatPrice(refunded)}");
  });

  it("eine Bestellung ohne Storno sieht aus wie bisher", () => {
    // Ohne Erstattung heißt die Zeile weiterhin schlicht „Gesamtbetrag".
    expect(PAGE).toContain("{refunded > 0 ? copy.originalTotal : copy.total}");
  });

  it("und eine ältere Antwort ohne die neuen Felder bricht nichts", () => {
    // Jedes neue Feld ist optional gelesen; eine Bestellung, die vor 0102
    // projiziert wurde, rendert wie zuvor.
    expect(PAGE).toContain("line.cancelled ?? 0");
    expect(PAGE).toContain("Number(order.refunded_total ?? 0)");
    expect(PAGE).toContain("line.outstanding ?? line.quantity");
  });
});

describe("die Zahlung", () => {
  it("kommt aus dem Schnappschuss, nicht aus einer Stripe-Abfrage", () => {
    expect(SQL).toContain("and a.method_recorded_at is not null");
    expect(PAGE).toContain("paymentMethodLabel(order.payment_method)");
    expect(PAGE).not.toContain("stripe");
  });

  it("und fehlt sie, steht die Zeile nicht da", () => {
    expect(PAGE).toContain("{method ? (");
  });
});

describe("die Rechnung bleibt, was sie war", () => {
  it("0102 fasst sie nicht an", () => {
    for (const forbidden of ["invoices", "invoice_number", "issue_invoice"]) {
      expect(SQL, forbidden).not.toContain(forbidden);
    }
  });

  it("und der Schutz von 0047 steht unverändert", () => {
    const legal = readFileSync("supabase/migrations/0047_legal_layer.sql", "utf8");
    expect(legal).toContain("invoices_protect_issued");
  });
});
