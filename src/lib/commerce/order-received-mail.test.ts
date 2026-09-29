import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Die Eingangsbestätigung bleibt — und sieht nicht mehr aus wie die Annahme.
 *
 * WAS BEIM ERSTEN ECHTEN KAUF PASSIERT IST. Vor Stripe ging „Bestellung … bei
 * uns eingegangen" raus, nach der Zahlung „Bestellung … bestätigt". Zwei
 * Zeilen im Posteingang, die zusammen wie zwei Bestätigungen für einen Kauf
 * aussahen.
 *
 * DIE MAIL WIRD DESHALB NICHT ENTFERNT. Sie ist die Zugangsbestätigung nach
 * § 312i Abs. 1 Nr. 3 BGB und ausdrücklich keine Annahme — das
 * Vertragsmodell in `docs/LEGAL.md` hängt daran und bleibt unberührt.
 * Geändert ist nur, wie deutlich sie das sagt.
 *
 * Diese Datei hält beides fest: dass es sie weiterhin gibt, und dass sie die
 * vier Aussagen trägt, die sie von der Annahme unterscheiden.
 */
const TEMPLATES = readFileSync("supabase/functions/send-order-mail/templates.ts", "utf8");
const ACTIONS = readFileSync("src/lib/commerce/actions.ts", "utf8");

/** Der Rumpf einer Vorlage, ohne die Kommentare darüber. */
function template(name: string): string {
  const from = TEMPLATES.indexOf(`export function ${name}(`);
  const to = TEMPLATES.indexOf("export function ", from + 10);
  return TEMPLATES.slice(from, to === -1 ? undefined : to)
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("/*");
    })
    .join("\n");
}

const RECEIVED = template("orderReceived");

describe("die Mail vor der Zahlung gibt es weiterhin", () => {
  it("der Checkout schickt sie, vor der Weiterleitung zu Stripe", () => {
    expect(ACTIONS).toContain("await acknowledgeOrder(orderNumber);");
    expect(ACTIONS).toContain('body: { orderNumber, kind: "order_received" }');
  });

  it("und die Art bleibt im Schema erlaubt", () => {
    const legal = readFileSync("supabase/migrations/0047_legal_layer.sql", "utf8");
    expect(legal).toContain("'order_received'");
  });

  it("sie kann die Bestellung nie scheitern lassen", () => {
    const fn = ACTIONS.slice(ACTIONS.indexOf("async function acknowledgeOrder"));
    expect(fn).toContain("try {");
    expect(fn).toContain("} catch {");
  });
});

describe("sie sagt vier Dinge, und keines davon im Nebensatz", () => {
  it("1 — die Bestellung ist empfangen", () => {
    expect(RECEIVED).toContain("Wir haben deine Bestellung ${order.order_number} erhalten.");
  });

  it("2 — die Zahlung ist noch nicht bestätigt, schon im Betreff", () => {
    expect(RECEIVED).toContain("eingegangen, Zahlung noch offen");
    expect(RECEIVED).toContain("Deine Zahlung ist noch nicht bestätigt.");
    expect(RECEIVED).toContain("Bestellung eingegangen — Zahlung noch nicht bestätigt.");
  });

  it("3 — dies ist keine Bestellbestätigung und keine Annahme", () => {
    expect(RECEIVED).toContain(
      "Diese E-Mail ist noch keine Bestellbestätigung und keine Annahme.",
    );
  });

  it("4 — die Bestätigung folgt nach der Zahlung", () => {
    expect(RECEIVED).toContain(
      "Sobald die Zahlung bestätigt ist, bekommst du die Bestellbestätigung mit Rechnung.",
    );
  });

  it("und das Vertragsmodell steht unverändert drin", () => {
    expect(RECEIVED).toContain("kommt erst mit dieser Bestellbestätigung");
    expect(RECEIVED).toContain("entsteht kein Vertrag und es wird nichts");
  });
});

describe("die beiden Mails sind nicht mehr zu verwechseln", () => {
  const confirmation = template("orderConfirmation");

  it("verschiedene Betreffzeilen, beide eindeutig", () => {
    expect(RECEIVED).toContain("— eingegangen, Zahlung noch offen`");
    expect(confirmation).toContain("— bestätigt`");
  });

  it("nur die zweite spricht von Annahme und Rechnung", () => {
    expect(confirmation).toContain("nehmen deine Bestellung");
    expect(confirmation).toContain("hiermit an.");
    expect(confirmation).toContain("order.invoice_number");
    expect(RECEIVED).not.toContain("invoice_number");
  });

  it("und nur die zweite trägt die Widerrufsbelehrung", () => {
    expect(confirmation).toContain("withdrawalSummary(site)");
    expect(RECEIVED).not.toContain("withdrawalSummary");
  });
});

/*
 * Wie der Verkäufer im Text auftritt (UX, nach dem ersten echten Kauf).
 *
 * Die Annahmeerklärung trug „<rechtlicher Name>, handelnd unter
 * <Handelsname>" mitten im Satz. Richtig, aber sperrig — und es stellte den
 * privaten Namen an die prominenteste Stelle der Mail. Die rechtliche
 * Identität steht jetzt vollständig im Fußblock, wo § 312f Abs. 2 BGB sie
 * ohnehin verlangt, und im Anschreiben steht der Shop.
 *
 * WAS SICH NICHT ÄNDERT und hier festgehalten ist: `order_confirmation`
 * bleibt die Annahmeerklärung nach erfolgreicher Zahlung, die Mail davor
 * bleibt reine Eingangsbestätigung, und die Rechnung bleibt unberührt.
 */
describe("der Verkäufer steht im Fuß, der Shop im Text", () => {
  const confirmation = template("orderConfirmation");
  const TEXT_TEMPLATES = [confirmation, RECEIVED];

  it("kennt einen Handelsnamen für den Fließtext", () => {
    expect(TEMPLATES).toContain("function shopName(order: MailOrder)");
    // Handelsname zuerst, rechtlicher Name nur als Rückfall — und beides aus
    // dem Snapshot der Bestellung, nie aus einer Konstante.
    expect(TEMPLATES).toContain("const trade = order.seller?.name?.trim();");
    expect(TEMPLATES).toContain("return trade || legal || ");
  });

  it("setzt die Konstruktion mit dem persönlichen Namen nirgends mehr in den Text", () => {
    // Die Hilfsfunktion, die sie gebaut hat, gibt es nicht mehr.
    expect(TEMPLATES).not.toContain("sellerLine");
    for (const text of TEXT_TEMPLATES) {
      expect(text).not.toContain("handelnd unter");
      expect(text).not.toContain("legal_name");
    }
  });

  it("dankt im Namen des Shops und kündigt den Versand an", () => {
    expect(confirmation).toContain("Vielen Dank für deine Bestellung bei ${shopName(order)}");
    expect(confirmation).toContain("sobald deine Sendung unterwegs ist");
  });

  it("sagt die Annahme in einem eigenen, kurzen Satz", () => {
    // Der Vertragsschluss-Nebensatz ist weg; die Annahme selbst bleibt und
    // ist damit die erste Aussage der Mail.
    expect(confirmation).toContain("Deine Bestellung ist bestätigt.");
    expect(confirmation).not.toContain("zustande gekommen");
    expect(confirmation).not.toContain("Kaufvertrag zwischen dir");
  });

  it("nennt den Shop auch in der Eingangsbestätigung, ohne die Aussage zu ändern", () => {
    // Der Satz bleibt: vor der Zahlung besteht kein Vertrag. Nur wer darin
    // genannt wird, ist jetzt der Shop statt der Person.
    expect(RECEIVED).toContain("${shopName(order)} kommt erst mit dieser Bestellbestätigung");
    expect(RECEIVED).toContain("entsteht kein Vertrag und es wird nichts");
  });

  it("trägt die volle rechtliche Identität im Fußblock, Handelsname zuerst", () => {
    const footer = TEMPLATES.slice(
      TEMPLATES.indexOf("function sellerAddress(order: MailOrder)"),
      TEMPLATES.indexOf("function sellerFooter("),
    );
    const trade = footer.indexOf("s.name ??");
    const legal = footer.indexOf("s.legal_name ??");
    const street = footer.indexOf("s.street ??");
    expect(trade).toBeGreaterThan(-1);
    expect(legal).toBeGreaterThan(trade);
    expect(street).toBeGreaterThan(legal);
    // Und der Block ist weiterhin als das überschrieben, was er ist.
    expect(TEMPLATES).toContain("Verkäufer und Vertragspartner");
  });

  it("lässt Auslöser und Zeitpunkt der Mail unangetastet", () => {
    // Die Annahme hängt weiterhin am bestätigten Zahlungsausgang des
    // Webhooks, nicht an dieser Textänderung.
    const webhook = readFileSync("supabase/functions/stripe-webhook/index.ts", "utf8");
    expect(webhook).toContain('confirmed: "order_confirmation"');
    expect(ACTIONS).toContain("await acknowledgeOrder(orderNumber);");
  });

  it("ändert an der Rechnung nichts — dort bleibt der volle Name", () => {
    const sql = readFileSync("supabase/migrations/0047_legal_layer.sql", "utf8");
    expect(sql).toContain("seller_legal_name");
    expect(sql).toContain("seller_trade_name");
  });
});
