import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Hinweismails: genau einmal je EREIGNIS, und ohne den Lesestand anzufassen
 * (0100).
 *
 * Bis hierher war der Schlüssel `(order_id, kind)` — eine Mail je Art und
 * Bestellung, für immer. Für Bestätigung und Versand ist das genau richtig
 * und bleibt so. Für die zweite Erstattung derselben Bestellung war es nicht
 * eine Unterdrückung, sondern eine Unmöglichkeit.
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

const SQL = readFileSync("supabase/migrations/0100_mail_event_identity.sql", "utf8");
const MAILER = code("supabase/functions/send-order-mail/index.ts");
const TEMPLATES = code("supabase/functions/send-order-mail/templates.ts");
const NOTIFY = code("src/lib/commerce/notify.ts");

describe("der Schlüssel kennt jetzt das Ereignis", () => {
  it("die Spalte und der eindeutige Index", () => {
    expect(SQL).toContain("add column if not exists ref text");
    expect(SQL).toContain("on public.order_mail (order_id, kind, coalesce(ref, ''))");
  });

  it("und der alte Primärschlüssel ist fort, nicht umgangen", () => {
    expect(SQL).toContain("drop constraint if exists order_mail_pk");
  });

  it("NULL zählt als Wert, sonst wäre einmal-je-Bestellung dahin", () => {
    // `coalesce(ref,'')` im Index: ohne das wären zwei Zeilen mit ref NULL
    // beide erlaubt, weil NULL in einem Unique-Index nicht mit sich selbst
    // kollidiert — und die Bestätigungsmail käme doppelt.
    expect(SQL).toContain("coalesce(ref, '')");
  });

  it("zwei Erstattungen derselben Bestellung sind zwei Mails", () => {
    const refunds = code("src/lib/admin/refund-actions.ts");
    expect(refunds).toContain('kind: "refund_confirmation"');
    // Die Referenz ist die Erstattung selbst — zwei Erstattungen, zwei refs,
    // zwei Schlüssel.
    expect(refunds).toContain("row.refund_id");
  });

  it("zwei Nachrichten kollidieren nicht", () => {
    const messages = code("src/lib/messages/actions.ts");
    expect(messages).toContain("ref: row.id ?? null");
  });

  it("zwei Teilstornos ebenso", () => {
    const lines = code("src/lib/admin/order-line-actions.ts");
    expect(lines).toContain('kind: "cancellation_notice"');
    expect(lines).toContain("row.event_id");
    // Dafür gibt die Datenbank ihre Ereignis-Id zurück.
    expect(SQL).toContain("'event_id', v_event");
    expect(SQL).toContain(") returning id into v_event;");
  });

  it("und Resend dedupliziert nicht quer über Ereignisse hinweg", () => {
    expect(TEMPLATES).toContain("ref: string | null = null");
    expect(TEMPLATES).toContain("return ref ? `${base}/${ref.replace");
    expect(MAILER).toContain("idempotencyKey(kind, order.order_number, ref)");
  });
});

describe("die einmaligen Arten bleiben einmalig", () => {
  it("sie schicken weiterhin ohne Referenz", () => {
    const checkout = code("src/lib/commerce/actions.ts");
    expect(checkout).toContain('kind: "order_received"');
    expect(checkout).not.toContain("ref:");
    const webhook = code("supabase/functions/stripe-webhook/index.ts");
    expect(webhook).toContain('kind: "new_order_notice"');
  });

  it("und die Migration erzeugt keine einzige neue Mail", () => {
    expect(SQL).not.toMatch(/insert into public\.order_mail\s*\(order_id, kind, ref, state, claimed_at, attempts\)\s*select/);
    // Der einzige INSERT steht in `claim_order_mail()` und ist der Anspruch.
    expect((SQL.match(/insert into public\.order_mail/g) ?? [])).toHaveLength(1);
  });
});

describe("eine Mail verändert keinen Lesestand", () => {
  it("nicht in der Migration", () => {
    for (const forbidden of ["order_conversation_reads\n     set", "order_attention_reads",
                             "mark_order_conversation_read", "mark_order_attention_read"]) {
      expect(SQL, forbidden).not.toContain(forbidden);
    }
    // Gelesen wird der Wasserstand sehr wohl — für die Drosselung.
    expect(SQL).toContain("from public.order_conversation_reads r");
  });

  it("nicht im Auslöser", () => {
    for (const forbidden of ["markConversationRead", "markOrderAttentionRead",
                             "order_conversation_reads", "order_attention_reads"]) {
      expect(NOTIFY, forbidden).not.toContain(forbidden);
    }
  });

  it("und nicht in der Function, die sie verschickt", () => {
    for (const forbidden of ["mark_order_conversation_read", "mark_order_attention_read"]) {
      expect(MAILER, forbidden).not.toContain(forbidden);
    }
  });
});

describe("ein lebhaftes Gespräch ist keine Maillawine", () => {
  it("die Regel liest zwei Zeitpunkte und entscheidet daraus", () => {
    expect(SQL).toContain("create or replace function public.message_notice_due(p_order_number text, p_recipient text)");
    expect(SQL).toContain("when (select at from last_notice) is null then true");
    expect(SQL).toContain("else (select at from seen) >= (select at from last_notice)");
  });

  it("sie greift vor dem Anspruch, nicht danach", () => {
    const before = MAILER.indexOf("message_notice_due");
    const claim = MAILER.indexOf('admin.rpc("claim_order_mail"');
    expect(before).toBeGreaterThan(-1);
    expect(before).toBeLessThan(claim);
  });

  it("und im Zweifel wird nicht gesendet", () => {
    expect(MAILER).toContain("if (dueError || due !== true)");
    expect(MAILER).toContain('outcome: "not_due"');
  });

  it("nur für Nachrichten, nie für Geld oder Versand", () => {
    expect(MAILER).toContain('if (kind === "message_to_customer" || kind === "message_to_seller")');
  });
});

describe("wer einen Hinweis auslösen darf", () => {
  it("die Kundschaft nur für die eigene Bestellung und nur für Nachrichten", () => {
    expect(MAILER).toContain("async function authoriseParty(");
    expect(MAILER).toContain('.eq("user_id", data.user.id)');
    expect(MAILER).toContain(
      'kind === "message_to_customer" || kind === "message_to_seller"\n        ? await authoriseParty(req, orderNumber)',
    );
  });

  it("und der Empfänger ergibt sich aus der Art, nie aus dem Aufruf", () => {
    expect(TEMPLATES).toContain('kind !== "message_to_seller"');
    expect(TEMPLATES).toContain('kind !== "new_order_notice"');
    expect(MAILER).toContain("const recipient = toCustomer ? order.customer_email : contactEmail;");
  });
});
