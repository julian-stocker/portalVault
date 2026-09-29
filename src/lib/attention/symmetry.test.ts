import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { de } from "@/lib/i18n/de";

/**
 * Käufer und Verkäufer verhalten sich gleich (0099).
 *
 * Das ist die Regel, aus der diese Migration entstanden ist, und sie lässt
 * sich nicht an einer Funktion festmachen — sie ist eine Eigenschaft von
 * sieben Dateien zusammen. Deshalb steht sie hier: Spiegelbild für
 * Spiegelbild, und daneben die zwei Sätze, die sie begrenzen — Status ist
 * keine Benachrichtigung, und eine Liste markiert nichts als gelesen.
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

const SQL = readFileSync("supabase/migrations/0099_order_attention.sql", "utf8");
const SQL_0098 = readFileSync("supabase/migrations/0098_order_conversations.sql", "utf8");
const NAV = code("src/components/layout/site-nav.tsx");
const ACCOUNT = code("src/app/(app)/account/page.tsx");
const BUSINESS = code("src/app/(business)/business/page.tsx");
const BUYER_LIST = code("src/app/(app)/account/orders/page.tsx");
const SELLER_LIST = code("src/app/(business)/business/orders/page.tsx");
const BUYER_DETAIL = code("src/app/(app)/account/orders/[orderNumber]/page.tsx");
const SELLER_DETAIL = code("src/app/(business)/business/orders/[orderNumber]/page.tsx");
const QUERIES = code("src/lib/attention/queries.ts");

describe("beide Rollen haben dieselben zwei Kanäle", () => {
  it("und für jede Seite dieselben vier Funktionen", () => {
    for (const pair of [
      ["my_order_attention", "seller_order_attention"],
      ["my_attention_total", "seller_attention_total"],
    ]) {
      for (const fn of pair) {
        expect(SQL, fn).toContain(`create or replace function public.${fn}()`);
        expect(SQL, fn).toContain(`grant execute on function public.${fn}() to authenticated`);
      }
    }
    // Und eine gemeinsame Rechnung darunter, nicht zwei.
    expect((SQL.match(/create or replace function public\.attention_summaries/g) ?? []))
      .toHaveLength(1);
  });

  it("die Abfrageschicht spiegelt sie eins zu eins", () => {
    for (const fn of ["fetchMyOrderAttention", "fetchSellerOrderAttention",
                      "fetchMyAttentionTotal", "fetchSellerAttentionTotal"]) {
      expect(QUERIES, fn).toContain(`export const ${fn} = cache(`);
    }
  });

  it("jede Rolle hat ihre Liste, ihre Karte und ihr Symbol", () => {
    // Liste
    expect(BUYER_LIST).toContain("fetchMyOrderAttention()");
    expect(SELLER_LIST).toContain("fetchSellerOrderAttention()");
    // Karte
    expect(ACCOUNT).toContain("fetchMyAttentionTotal()");
    expect(BUSINESS).toContain("fetchSellerAttentionTotal()");
    // Detail
    expect(BUYER_DETAIL).toContain("<MarkOrderSeen");
    expect(SELLER_DETAIL).toContain("<MarkOrderSeen");
  });
});

describe("das Kontosymbol gehört der aktiven Rolle", () => {
  it("führt in den Kontobereich dieser Rolle", () => {
    expect(NAV).toContain('href={!signedIn ? "/login" : business ? "/business" : "/account"}');
  });

  it("und trägt niemals mehr die Käuferzahl eines Betriebs", () => {
    expect(NAV).not.toContain("unread={unread.mine}");
    expect(NAV).toContain("{ messages: unread.seller, orders: attention.seller }");
    expect(NAV).toContain("{ messages: unread.mine, orders: attention.mine }");
  });

  it("zeigt die Summe der beiden Kanäle, ausgerechnet statt erhoben", () => {
    expect(NAV).toContain("unread={roleAttention(");
    expect(code("src/lib/attention/attention.ts"))
      .toContain("export function roleAttention");
  });

  it("und jedes Layout reicht beide Zahlen durch", () => {
    for (const layout of ["src/app/(app)/layout.tsx", "src/app/(business)/layout.tsx",
                          "src/app/(public)/layout.tsx", "src/app/(admin)/layout.tsx"]) {
      expect(code(layout), layout).toContain("attention={attention}");
      expect(code(layout), layout).toContain("unread={unread}");
    }
  });
});

describe("eine Karte trägt die Zahl ihres Kanals, nie eine Summe", () => {
  it("beim Käufer", () => {
    expect(ACCOUNT).toContain('if (section.channel === "messages") return unread;');
    expect(ACCOUNT).toContain('if (section.channel === "orders") return attention;');
  });

  it("beim Verkäufer", () => {
    expect(BUSINESS).toContain('if (channel === "orders") return attention;');
    expect(BUSINESS).toContain('if (channel === "messages") return unread;');
  });

  it("und der Betrieb hat beide Karten plus die Kontoeinstellungen", () => {
    expect(BUSINESS).toContain('{ href: "/business/orders", copy: de.business.areas.orders, channel: "orders" }');
    expect(BUSINESS).toContain('{ href: "/business/nachrichten", copy: de.business.areas.messages, channel: "messages" }');
    expect(BUSINESS).toContain('{ href: "/account/security", copy: de.business.areas.security }');
    expect(de.business.areas.security.title).toBe("Konto & Sicherheit");
  });

  it("und der Käufer sieht seine zwei nur als Käuferkonto", () => {
    expect(ACCOUNT).toContain('!("buyer" in s) || !caps.sellerOperator');
  });
});

describe("gelesen wird beim Öffnen der Bestellung, nicht der Liste", () => {
  it("keine Liste markiert etwas", () => {
    for (const [name, list] of [["Käufer", BUYER_LIST], ["Verkäufer", SELLER_LIST]] as const) {
      expect(list, name).not.toContain("markOrderAttentionRead");
      expect(list, name).not.toContain("MarkOrderSeen");
    }
  });

  it("beide Detailseiten tun es, einmal und nur wenn nötig", () => {
    const marker = code("src/components/orders/mark-order-seen.tsx");
    expect(marker).toContain("if (marked.current || !unseen) return;");
    expect(marker).toContain("markOrderAttentionRead(orderNumber)");
    for (const detail of [BUYER_DETAIL, SELLER_DETAIL]) {
      expect(detail).toContain("unseen={unseen}");
    }
  });

  it("und der Wasserstand geht in der Datenbank nur vorwärts", () => {
    expect(SQL).toContain("greatest(public.order_attention_reads.last_read_at");
  });
});

describe("Status erzeugt niemals eine Benachrichtigung", () => {
  it("die Migration kennt keinen Bestellstatus", () => {
    const body = SQL.split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    for (const status of ["payment_status", "fulfillment_status", "needs_resolution",
                          "attention =", "to_ship", "unfulfilled"]) {
      expect(body, status).not.toContain(status);
    }
  });

  it("die reine Schicht auch nicht", () => {
    for (const status of ["paid", "shipped", "pending", "to_ship"]) {
      expect(code("src/lib/attention/attention.ts"), status).not.toContain(status);
    }
  });

  it("und der Arbeitszähler bleibt, wo er war", () => {
    // `seller_open_order_counts()` zählt weiter Arbeit auf der Arbeitskarte —
    // das ist der Zähler, der bewusst NICHT verschwindet, wenn man hinsieht.
    expect(BUSINESS).toContain("openOrders.needsResolution");
    expect(BUSINESS).toContain("hasOpenWork(openOrders)");
  });
});

describe("die zwei Kanäle zählen getrennt", () => {
  it("Nachrichten zählen nur Menschen", () => {
    const narrowed = SQL.slice(SQL.indexOf("create or replace function public.conversation_summaries"));
    expect(narrowed).toContain("join public.order_messages m on m.order_id = s.id");
    // Der Ereignisteil des Stroms ist fort.
    expect(narrowed).not.toContain("order_conversation_events");
  });

  it("und die Käuferereignisse zählen im Bestellkanal", () => {
    /* Storno kam nach dem ersten echten Teilstorno dazu: der Käufer bekam
       eine Meldung über das Geld, aber keine über die Änderung seiner
       Bestellung — und die ist die eigentliche Nachricht. */
    expect(SQL).toContain(
      "then e.event_type in ('order_shipped', 'refund_recorded',\n" +
      "                                                 'order_line_cancelled', 'order_cancelled')",
    );
  });

  it("und eine Bestellung ist eine Marke, nicht drei", () => {
    /* Die Summen zählen ZEILEN mit `unread > 0`, nicht Ereignisse: drei neue
       Meldungen an einer Bestellung sind eine Bestellung, in die man sehen
       muss. Am Eintrag steht genau ein „Neu". */
    expect((SQL.match(/count\(\*\) filter \(where a\.unread > 0\)::integer/g) ?? []))
      .toHaveLength(2);
    expect(SQL).not.toContain("sum(a.unread)");
    const chip = code("src/components/ui/new-chip.tsx");
    expect(chip).toContain("if (count < 1) return null;");
  });

  it("die Verkäufer-Whitelist ist die vereinbarte", () => {
    expect(SQL).toContain(
      "else e.event_type in ('payment_succeeded', 'withdrawal_declared',\n" +
      "                                 'payment_amount_mismatch', 'late_payment_unresolved')",
    );
  });

  it("eigene Handlungen zählen für niemanden", () => {
    expect(SQL).toContain("when 'customer' then e.actor_kind <> 'customer'");
    expect(SQL).toContain("else e.actor_kind <> 'admin'");
  });

  it("aber im Strang bleiben die Systemzeilen sichtbar", () => {
    // 0098 unverändert: `order_conversation()` zeigt beide weiterhin an.
    expect(SQL_0098).toContain("and e.event_type in ('order_shipped', 'refund_recorded')");
    expect(SQL).not.toContain("create or replace function public.order_conversation(");
    expect(SQL).not.toContain("create or replace function public.order_conversation_events(");
  });
});

describe("der Schnitt bei der Einführung", () => {
  it("setzt jede bestehende Bestellung auf gesehen", () => {
    expect(SQL).toContain("insert into public.order_attention_reads");
    expect(SQL).toContain("where not exists (select 1 from public.order_attention_reads)");
    expect(SQL).toContain("on conflict (order_id, reader) do nothing");
  });

  it("und die Tabelle ist jeder Clientrolle entzogen", () => {
    expect(SQL).toContain("alter table public.order_attention_reads enable row level security");
    expect(SQL).toContain(
      "revoke all on public.order_attention_reads from public, anon, authenticated",
    );
  });

  it("die internen Funktionen haben kein Clientrecht", () => {
    for (const fn of ["order_attention_role(bigint)", "attention_summaries(text)"]) {
      expect(SQL, fn).toContain(`revoke all on function public.${fn} from public, anon, authenticated`);
    }
    expect(SQL).toContain(
      "revoke all on function public.order_attention_events(bigint, text) from public, anon, authenticated",
    );
  });
});

describe("Neu steht am Eintrag, in beiden Listen", () => {
  it("aus derselben Komponente", () => {
    for (const [name, list] of [["Käufer", BUYER_LIST], ["Verkäufer", SELLER_LIST]] as const) {
      expect(list, name).toContain("<NewChip count=");
      expect(list, name).toContain("unreadOrderNumbers(");
    }
  });

  it("und sie sagt nichts über den Status", () => {
    const chip = code("src/components/ui/new-chip.tsx");
    expect(chip).toContain("de.attention.new");
    expect(de.attention.new).toBe("Neu");
    for (const status of ["paid", "bezahlt", "versendet", "offen"]) {
      expect(chip.toLowerCase(), status).not.toContain(status);
    }
  });
});
