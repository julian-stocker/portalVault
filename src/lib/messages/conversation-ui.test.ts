/**
 * Die Oberfläche der Bestellnachrichten (0098-UI).
 *
 * Zwei Sorten Test: die reinen Funktionen werden ausgeführt, die Bildschirme
 * am Quelltext festgehalten — dieselbe Aufteilung wie überall sonst in diesem
 * Projekt.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  CONVERSATION_EVENTS, MESSAGE_MAX, messageIsSendable,
  readConversation, readSummaries, systemEventText, unreadTotal,
} from "./conversation";
import { de } from "@/lib/i18n/de";
import { formatPrice } from "@/lib/format";

/** Nur der Code. Ein Kommentar, der eine verbotene Sache benennt, ist keine. */
function code(path: string): string {
  return readFileSync(path, "utf8").split("\n").filter((line) => {
    const t = line.trimStart();
    return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
  }).join("\n");
}

const THREAD = readFileSync("src/components/messages/conversation-thread.tsx", "utf8");
const INBOX_C = readFileSync("src/app/(app)/account/nachrichten/page.tsx", "utf8");
const INBOX_S = readFileSync("src/app/(business)/business/nachrichten/page.tsx", "utf8");
const ACTIONS = readFileSync("src/lib/messages/actions.ts", "utf8");
const QUERIES = readFileSync("src/lib/messages/queries.ts", "utf8");
const NAV = readFileSync("src/components/layout/site-nav.tsx", "utf8");
const ORDER_C = readFileSync("src/app/(app)/account/orders/[orderNumber]/page.tsx", "utf8");
const ORDER_S = readFileSync("src/app/(business)/business/orders/[orderNumber]/page.tsx", "utf8");
const SQL = readFileSync("supabase/migrations/0098_order_conversations.sql", "utf8");

const item = (over: Record<string, unknown> = {}) => ({
  kind: "event", id: 1, at: "2026-09-24T10:00:00Z", author_kind: "admin",
  body: null, event_type: "order_shipped", fields: {}, unread: false, ...over,
});

describe("was aus der Antwort der Datenbank gelesen wird", () => {
  it("nimmt nur die zwei freigegebenen Felder", () => {
    const c = readConversation({
      order_number: "SI-1", role: "customer", unread: 0, writable: true,
      items: [item({ fields: { quantity: 2, amount: "4.04", movement_id: 681, order_line_id: 70 } })],
    });
    expect(c!.items[0].fields).toEqual({ quantity: 2, amount: 4.04 });
  });

  it("verweigert eine Antwort ohne erkennbare Rolle", () => {
    expect(readConversation(null)).toBeNull();
    expect(readConversation({ order_number: "SI-1", role: "admin" })).toBeNull();
    expect(readConversation({ role: "customer" })).toBeNull();
  });

  it("liest die Posteingangszeilen und zählt sie zusammen", () => {
    const rows = readSummaries([
      { order_number: "SI-1", last_at: "2026-09-24T10:00:00Z", unread: 2, total: 5 },
      { order_number: "SI-2", last_at: "2026-09-23T10:00:00Z", unread: 0, total: 1 },
      "Unfug",
    ]);
    expect(rows.map((r) => r.orderNumber)).toEqual(["SI-1", "SI-2"]);
    expect(unreadTotal(rows)).toBe(2);
  });
});

describe("die deutschen Sätze der Systemereignisse", () => {
  const text = (eventType: string, fields: Record<string, number> = {}) =>
    systemEventText({
      kind: "event", id: 1, at: "", authorKind: "admin",
      body: null, eventType, fields, unread: false,
    });

  it("gibt es für beide freigegebenen Typen", () => {
    for (const t of CONVERSATION_EVENTS) expect(text(t, { amount: 1 }), t).toBeTruthy();
  });

  it("nennt den Betrag, wo es einen gibt", () => {
    expect(text("order_shipped")).toBe("Bestellung versendet.");
    /* Derselbe Geldformatierer wie überall sonst im Produkt. `de-AT` setzt
       das Zeichen voran und trennt mit einem geschützten Leerzeichen — die
       Erwartung wird deshalb gebaut, nicht getippt. */
    expect(text("refund_recorded", { amount: 4.04 }))
      .toBe(`Rückerstattung über ${formatPrice(4.04)} abgeschlossen.`);
    expect(formatPrice(4.04)).toContain("4,04");
  });

  /**
   * DER KANAL IST EIN GESPRÄCH, KEINE BESTELLHISTORIE.
   *
   * Anfangs erschienen sieben Ereignistypen im Strang. Fachlich richtig, im
   * Gespräch falsch: eine Bestellung erzeugt davon schnell ein Dutzend, und
   * die zwei Sätze zwischen Menschen gingen darin unter. Die vollständige
   * Historie bleibt unverändert in `order_events` und auf dem Bestellschirm.
   */
  it("zeigt die fünf Historientypen nicht mehr", () => {
    for (const t of ["payment_succeeded", "order_line_cancelled", "order_return_received",
                     "order_cancelled", "withdrawal_declared"]) {
      expect(text(t, { quantity: 1, amount: 1 }), t).toBeNull();
    }
  });

  it("kommt ohne Betrag trotzdem zu einem Satz", () => {
    expect(text("refund_recorded")).toBe("Rückerstattung abgeschlossen.");
  });

  it("erfindet für einen unbekannten Typ nichts", () => {
    expect(text("invoice_issued")).toBeNull();
    expect(text("sandbox_stock_reverted")).toBeNull();
    expect(text("")).toBeNull();
  });

  it("deckt genau die Typen ab, die die Datenbank durchlässt", () => {
    expect([...CONVERSATION_EVENTS]).toEqual(["order_shipped", "refund_recorded"]);
    const fn = SQL.slice(SQL.indexOf("create or replace function public.order_conversation_events"),
                         SQL.indexOf("comment on function public.order_conversation_events"));
    expect(fn).toContain("e.event_type in ('order_shipped', 'refund_recorded')");
    for (const t of ["payment_succeeded", "order_line_cancelled", "order_return_received",
                     "order_cancelled", "withdrawal_declared", "placed", "invoice_issued"]) {
      expect(fn, t).not.toContain(`'${t}'`);
    }
  });

  /*
   * Und die Folgen, die sich daraus von selbst ergeben: Posteingang und
   * Ungelesen-Zählung lesen dieselbe Funktion, also sehen sie dieselben zwei
   * Typen. Eine Bestellung ohne Nachricht und ohne diese beiden Ereignisse
   * erzeugt keine Zeile im Strang — und `having count(*) > 0` lässt sie
   * damit aus dem Posteingang heraus.
   */
  it("verengt Posteingang und Unread mit, ohne zweite Liste", () => {
    const summaries = SQL.slice(SQL.indexOf("create or replace function public.conversation_summaries"),
                                SQL.indexOf("comment on function public.conversation_summaries"));
    expect(summaries).toContain("public.order_conversation_events(s.id) e");
    expect(summaries).toContain("having count(*) > 0");
    expect(summaries).not.toContain("event_type in (");
    const conv = SQL.slice(SQL.indexOf("create or replace function public.order_conversation("),
                           SQL.indexOf("comment on function public.order_conversation(text)"));
    expect(conv).toContain("public.order_conversation_events(v_order.id) e");
    expect(conv).not.toContain("event_type in (");
  });
});

describe("die Grenze am Text", () => {
  it("ist dieselbe wie in RPC und Spalte", () => {
    expect(MESSAGE_MAX).toBe(2000);
    expect(SQL).toContain("check (length(body) between 1 and 2000)");
    expect(SQL).toContain("if length(v_body) > 2000 then");
  });

  it("lehnt leer und zu lang ab", () => {
    expect(messageIsSendable("")).toBe(false);
    expect(messageIsSendable("   \n  ")).toBe(false);
    expect(messageIsSendable("a".repeat(2000))).toBe(true);
    expect(messageIsSendable("a".repeat(2001))).toBe(false);
    // Leerraum zählt nicht mit — getrimmt wird auch serverseitig.
    expect(messageIsSendable(`  ${"a".repeat(2000)}  `)).toBe(true);
  });

  it("wird im Feld doppelt gehalten", () => {
    expect(THREAD).toContain("maxLength={MESSAGE_MAX}");
    expect(THREAD).toContain("messageIsSendable(body)");
    expect(ACTIONS).toContain("messageIsSendable(body)");
  });
});

describe("der Verlauf auf dem Bildschirm", () => {
  it("zeichnet System und Mensch verschieden", () => {
    expect(THREAD).toContain("function SystemLine");
    expect(THREAD).toContain("function MessageBubble");
    expect(THREAD).toContain('item.kind === "event"');
  });

  /* Die Chatform: eigene Beiträge rechts, die Gegenseite links. */
  it("stellt die eigene Seite nach rechts", () => {
    expect(THREAD).toContain("item.authorKind === conversation.role");
    expect(THREAD).toContain('mine ? "items-end" : "items-start"');
  });

  it("begrenzt die Blasenbreite", () => {
    expect(THREAD).toContain("max-w-[85%]");
    expect(THREAD).toContain("sm:max-w-[72%]");
  });

  it("setzt Systemmeldungen mittig und zurückhaltend", () => {
    const fn = THREAD.slice(THREAD.indexOf("function SystemLine"),
                            THREAD.indexOf("function MessageBubble"));
    expect(fn).toContain("justify-center");
    expect(fn).toContain("text-muted");
    expect(fn).toContain("text-[11px]");
    // Kein Absender, keine Blase, kein Rahmen, kein Trenner über den Chat.
    expect(fn).not.toContain("copy.youLabel");
    expect(fn).not.toContain("ring-1");
    expect(fn).not.toContain("bg-surface");
    expect(THREAD).not.toContain("divide-y");
  });

  /* Das gruppierte Widget ist weg — es löste ein Problem, das die kürzere
     Ereignisliste gar nicht erst erzeugt. */
  it("hat kein Update-Widget mehr", () => {
    for (const gone of ["OrderUpdates", "VISIBLE_UPDATES", "updatesMore", "updatesLess",
                        "groupConversation"]) {
      expect(THREAD, gone).not.toContain(gone);
    }
  });

  it("macht den Sprecherwechsel als Abstand sichtbar", () => {
    expect(THREAD).toContain("const sameKindAsPrevious = previous !== undefined");
    expect(THREAD).toContain(
      'const gap = previous === undefined ? "" : sameKindAsPrevious ? "mt-0.5" : "mt-3";');
    // Und trägt die Fußzeile nur am letzten Beitrag einer Folge.
    expect(THREAD).toContain("next.authorKind !== item.authorKind");
  });

  /**
   * Der Abstand gilt für beide Sorten: zwei Systemmeldungen hintereinander
   * gehören zum selben Vorgang und rücken zusammen; zwischen Systemblock und
   * Nachricht steht die volle Luft.
   */
  it("setzt aufeinanderfolgende Systemmeldungen eng untereinander", () => {
    expect(THREAD).toContain("previous.kind === item.kind");
    expect(THREAD).toContain('(item.kind === "event" || previous.authorKind === item.authorKind)');
    // Der Abstand kommt von außen — keine feste Marge mehr in der Zeile.
    const fn = THREAD.slice(THREAD.indexOf("function SystemLine"),
                            THREAD.indexOf("function MessageBubble"));
    expect(fn).toContain("gap");
    expect(fn).not.toContain("my-3");
  });

  it("stellt beide Seiten als Absender-Punkt-Uhrzeit dar", () => {
    const fn = THREAD.slice(THREAD.indexOf("function MessageBubble"),
                            THREAD.indexOf("export function ConversationThread"));
    // Erst der Name, dann der Punkt, dann die Zeit — auf beiden Seiten.
    expect(fn.indexOf("{who}")).toBeLessThan(fn.indexOf('aria-hidden="true">·'));
    expect(fn.indexOf('aria-hidden="true">·')).toBeLessThan(fn.indexOf("shortTime(item.at)"));
    // Die rechte Spalte wird nicht mehr in der Leserichtung gedreht.
    expect(THREAD).not.toContain("flex-row-reverse");
  });

  it("verschachtelt die Liste sauber: nur <li> unter <ul>", () => {
    // Vorher hing jede Blase in einem <div> zwischen <ul> und <li>.
    expect(THREAD).not.toContain("<div key={`m${item.id}`}");
  });

  it("hat einen kompakten Composer statt eines Vollbreiten-Knopfs", () => {
    const form = THREAD.slice(THREAD.indexOf("<form onSubmit={submit}"));
    expect(form).toContain("flex items-end gap-2");
    expect(form).toContain("shrink-0");
    expect(form).not.toContain("ACTION_PRIMARY");
    expect(form).not.toContain("w-full rounded-sky-md bg-surface-raised");
  });

  it("nutzt nur bestehende Farbtoken", () => {
    // Keine willkürliche Farbe, keine Hex-Literale, kein Tailwind-Palettenton.
    expect(THREAD).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(THREAD).not.toMatch(/\b(bg|text|ring)-(red|blue|green|slate|zinc|gray|amber)-\d/);
  });

  it("rendert Text als Text", () => {
    expect(THREAD).toContain("{item.body}");
    for (const f of ["src/components/messages/conversation-thread.tsx",
                     "src/app/(app)/account/nachrichten/page.tsx",
                     "src/app/(business)/business/nachrichten/page.tsx",
                     "src/app/(app)/account/orders/[orderNumber]/page.tsx",
                     "src/app/(business)/business/orders/[orderNumber]/page.tsx"]) {
      expect(code(f), f).not.toContain("dangerouslySetInnerHTML");
    }
  });

  it("markiert beim Öffnen gelesen, aber nur einmal", () => {
    expect(THREAD).toContain("markConversationRead(conversation.orderNumber)");
    expect(THREAD).toContain("marked.current");
    expect(THREAD).toContain("conversation.unread === 0) return;");
  });

  it("lässt die Neu-Markierung für diesen Aufruf stehen", () => {
    // Man soll sehen, was neu war; beim nächsten Laden ist es weg.
    expect(THREAD).toContain("copy.newSince");
  });

  it("zeigt das Formular nur, wo geschrieben werden darf", () => {
    expect(THREAD).toContain("{conversation.writable ?");
  });
});

describe("die beiden Posteingänge", () => {
  it("führen zur Unterhaltung an der Bestellung", () => {
    expect(INBOX_C).toContain("/account/orders/${one.orderNumber}#nachrichten");
    expect(INBOX_S).toContain("/business/orders/${one.orderNumber}#nachrichten");
    expect(ORDER_C).toContain('id="nachrichten"');
    expect(ORDER_S).toContain('id="nachrichten"');
  });

  it("übernehmen die Sortierung der Datenbank, statt selbst zu sortieren", () => {
    for (const f of [INBOX_C, INBOX_S]) {
      expect(f).not.toContain(".sort(");
    }
    expect(SQL).toContain("order by (c.unread > 0) desc, c.last_at desc)");
  });

  it("gaten den Zugang: Konto hier, Operatorrolle dort", () => {
    expect(INBOX_C).toContain("redirect(SIGN_IN_PATH)");
    expect(INBOX_S).toContain("if (!(await canOperateSeller())) notFound();");
  });

  it("sagen der Kundschaft, dass es für Gastbestellungen nichts gibt", () => {
    expect(INBOX_C).toContain("copy.guestHint");
    expect(de.messages.guestHint).toContain("ohne Konto");
  });
});

describe("Gastbestellungen bleiben ohne Unterhaltung", () => {
  it("werden auf beiden Bestellseiten schlicht nicht gezeichnet", () => {
    for (const f of [ORDER_C, ORDER_S]) {
      expect(f).toContain("{conversation === null ? null : (");
    }
  });

  it("und die Entscheidung fällt in der Datenbank", () => {
    expect(QUERIES).toContain("if (error || data === null) return null;");
    expect(SQL).toContain("o.id = p_order_id and o.user_id is not null");
  });
});

describe("die Zahlen am Rand", () => {
  it("hängen am Kontosymbol und am Menüpunkt des Betriebs", () => {
    expect(NAV).toContain("unread={unread.mine}");
    expect(NAV).toContain("badge: (_counts, unread) => unread.seller,");
    expect(NAV).toContain('href: "/business/nachrichten"');
  });

  it("nennen die Zahl auch für einen Screenreader", () => {
    expect(NAV).toContain("de.messages.unreadBadgeLabel(unread)");
    expect(de.messages.unreadBadgeLabel(3)).toContain("3");
  });

  it("kommen aus Aggregaten und werden bei einem Fehler zu 0", () => {
    expect(QUERIES).toContain("my_unread_total");
    expect(QUERIES).toContain("seller_unread_total");
    expect(QUERIES).toContain("error || !Number.isFinite(n) || n < 0 ? 0");
  });
});

/**
 * DIE ZAHL AM RAND HÄNGT AM LAYOUT.
 *
 * Beobachtet im E2E: nach einer Kundennachricht zeigte der Business-Badge auf
 * jeder Seite 0 und erst auf `/business/nachrichten` die 1. Ursache waren vier
 * einzeln revalidierte Pfade — `SiteNav` steht aber im gemeinsamen Layout, und
 * bei einer weichen Navigation rendert das Layout nicht neu.
 */
describe("nach einer Nachricht wird das Layout neu geladen", () => {
  it("revalidiert beide Bereiche als Layout, nicht als Einzelseiten", () => {
    expect(ACTIONS).toContain('revalidatePath("/account", "layout");');
    expect(ACTIONS).toContain('revalidatePath("/business", "layout");');
  });

  it("zählt keine Einzelpfade mehr auf", () => {
    // Die vier Adressen sind im Layout enthalten; sie einzeln zu nennen war
    // genau die Lücke, durch die der Badge fiel.
    expect(ACTIONS).not.toContain('"/business/nachrichten"');
    expect(ACTIONS).not.toContain('"/account/nachrichten"');
    expect(ACTIONS).not.toContain("`/business/orders/${orderNumber}`");
  });

  it("tut es nach dem Senden und nach dem Gelesenmarkieren", () => {
    expect((ACTIONS.match(/revalidateConversations\(\);/g) ?? []).length).toBe(2);
  });

  it("und löst es nicht mit Polling oder einem Sonderfall", () => {
    for (const forbidden of ["setInterval", "setTimeout", "usePathname", "router.refresh"]) {
      expect(ACTIONS, forbidden).not.toContain(forbidden);
    }
  });

  it("der Badge kommt aus dem gemeinsamen Layout, nicht aus einer Seite", () => {
    const business = readFileSync("src/app/(business)/layout.tsx", "utf8");
    expect(business).toContain("fetchSellerUnread()");
    expect(business).toContain("unread={unread}");
    // Und keine Business-Seite reicht eigene Zahlen an die Navigation.
    const inbox = readFileSync("src/app/(business)/business/nachrichten/page.tsx", "utf8");
    expect(inbox).not.toContain("SiteNav");
    expect(inbox).not.toContain("fetchSellerUnread");
  });
});

describe("kein Weg an den RPCs vorbei", () => {
  it("keine Tabelle wird direkt gelesen oder geschrieben", () => {
    for (const f of [QUERIES, ACTIONS, THREAD, INBOX_C, INBOX_S]) {
      expect(f).not.toContain('from("order_messages")');
      expect(f).not.toContain('from("order_conversation_reads")');
      expect(f).not.toContain("service_role");
      expect(f).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    }
  });

  it("es sind genau die sieben Client-Funktionen", () => {
    const used = [...`${QUERIES}${ACTIONS}`.matchAll(/rpc\("([a-z_]+)"/g)].map((m) => m[1]);
    expect(new Set(used)).toEqual(new Set([
      "order_conversation", "post_order_message", "mark_order_conversation_read",
      "my_conversations", "seller_conversations", "my_unread_total", "seller_unread_total",
    ]));
  });

  it("die Aktion setzt keine Urheberseite", () => {
    const fn = code("src/lib/messages/actions.ts");
    expect(fn).not.toContain("author_kind");
    expect(fn).not.toContain("p_author");
    // Sie kommt aus `order_conversation_role()`, und zwar dort.
    expect(SQL).toContain("values (v_order_id, v_role, (select auth.uid()), v_body)");
  });
});

describe("was V1 nicht kann, steht auch nicht im Code", () => {
  it("kein Realtime, keine Anhänge, kein Bearbeiten, keine Lesebestätigung", () => {
    for (const f of [THREAD, INBOX_C, INBOX_S, ACTIONS, QUERIES]) {
      for (const forbidden of ["realtime", "WebSocket", "setInterval",
                               'type="file"', "FormData", "deleteMessage", "editMessage"]) {
        expect(f, forbidden).not.toContain(forbidden);
      }
    }
  });
});
