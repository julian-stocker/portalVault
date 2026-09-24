/**
 * Was eine Unterhaltung ist, sobald `order_conversation()` geantwortet hat.
 *
 * REIN, UND DESHALB PRÜFBAR. Hier wird nichts geladen und nichts geschrieben:
 * die Funktionen nehmen das JSON der Datenbank und geben Formen zurück, die
 * ein Bildschirm zeichnen kann. Dieselbe Trennung wie bei `order-lines.ts` —
 * die Regeln lassen sich ohne Datenbank durchspielen, und der Weg dorthin
 * liegt daneben in `queries.ts`.
 *
 * ZWEI ARTEN VON EINTRAG, EIN STRANG. `message` ist, was ein Mensch
 * geschrieben hat; `event` ist eine Projektion aus `order_events`. Der
 * Unterschied steht als Feld da und wird nicht aus dem Inhalt geraten — die
 * Oberfläche zeichnet beide sichtbar verschieden, weil sie verschieden sind.
 *
 * DER TEXT EINES SYSTEMEINTRAGS ENTSTEHT HIER, NICHT IN DER DATENBANK. Sie
 * liefert einen Typ und höchstens zwei Zahlen (`quantity`, `amount`); der
 * deutsche Satz wird daraus gebaut. Das ist der Grund, warum aus einem
 * Systemereignis kein Markup in die Seite gelangen kann: es gibt dort keinen
 * freien Text, den jemand einschleusen könnte.
 */
import { de } from "@/lib/i18n/de";
import { formatPrice } from "@/lib/format";

/**
 * Die zwei Ereignistypen, die `order_conversation_events()` durchlässt.
 *
 * Der Kanal ist ein Gespräch, keine Bestellhistorie. Versand und Erstattung
 * beantworten je eine Frage, die ein Mensch sonst stellen müsste — alles
 * andere bleibt im Ereignisjournal und auf dem Bestellschirm.
 */
export const CONVERSATION_EVENTS = ["order_shipped", "refund_recorded"] as const;

export type ConversationEvent = (typeof CONVERSATION_EVENTS)[number];

export type ConversationItem = {
  kind: "message" | "event";
  id: number;
  at: string;
  /** `customer` | `seller` bei einer Nachricht, der Akteur bei einem Ereignis. */
  authorKind: string;
  /** Nur bei `message`. Freier Text, wird als Text gerendert. */
  body: string | null;
  /** Nur bei `event`. */
  eventType: string | null;
  /** Die zwei freigegebenen Felder, mehr gibt die Datenbank nicht heraus. */
  fields: { quantity?: number; amount?: number };
  unread: boolean;
};

export type Conversation = {
  orderNumber: string;
  role: "customer" | "seller";
  unread: number;
  writable: boolean;
  items: ConversationItem[];
};

export type ConversationSummary = {
  orderNumber: string;
  lastAt: string;
  unread: number;
  total: number;
};

/** Die Grenze, die auch auf der Spalte und im RPC steht. */
export const MESSAGE_MAX = 2000;

/** Taugt dieser Text als Nachricht? Dieselbe Frage stellt der Server noch einmal. */
export function messageIsSendable(body: string): boolean {
  const trimmed = body.trim();
  return trimmed.length > 0 && trimmed.length <= MESSAGE_MAX;
}

const num = (value: unknown): number | undefined => {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

export function readConversation(raw: unknown): Conversation | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const role = row.role;
  if (role !== "customer" && role !== "seller") return null;
  if (typeof row.order_number !== "string") return null;

  const items = Array.isArray(row.items) ? row.items : [];
  return {
    orderNumber: row.order_number,
    role,
    unread: num(row.unread) ?? 0,
    writable: row.writable !== false,
    items: items.flatMap((one) => {
      if (typeof one !== "object" || one === null) return [];
      const item = one as Record<string, unknown>;
      const kind = item.kind === "event" ? "event" : "message";
      const fields = (typeof item.fields === "object" && item.fields !== null
        ? item.fields : {}) as Record<string, unknown>;
      return [{
        kind,
        id: num(item.id) ?? 0,
        at: String(item.at ?? ""),
        authorKind: String(item.author_kind ?? ""),
        body: typeof item.body === "string" ? item.body : null,
        eventType: typeof item.event_type === "string" ? item.event_type : null,
        /* Nur die zwei erlaubten Felder werden überhaupt gelesen — was die
           Datenbank sonst je mitschickte, käme hier nicht durch. */
        fields: {
          ...(num(fields.quantity) === undefined ? {} : { quantity: num(fields.quantity) }),
          ...(num(fields.amount) === undefined ? {} : { amount: num(fields.amount) }),
        },
        unread: item.unread === true,
      } satisfies ConversationItem];
    }),
  };
}

export function readSummaries(raw: unknown): ConversationSummary[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((one) => {
    if (typeof one !== "object" || one === null) return [];
    const row = one as Record<string, unknown>;
    if (typeof row.order_number !== "string") return [];
    return [{
      orderNumber: row.order_number,
      lastAt: String(row.last_at ?? ""),
      unread: num(row.unread) ?? 0,
      total: num(row.total) ?? 0,
    }];
  });
}

/**
 * Der deutsche Satz zu einem Systemeintrag.
 *
 * Gebaut aus dem Typ und höchstens zwei Zahlen. Ein unbekannter Typ bekommt
 * keinen erfundenen Satz, sondern `null` — dann zeichnet die Oberfläche ihn
 * gar nicht. Lieber eine Lücke als eine Behauptung über ein Ereignis, das
 * dieser Stand nicht kennt.
 */
export function systemEventText(item: ConversationItem): string | null {
  const copy = de.messages.events;
  switch (item.eventType) {
    case "order_shipped": return copy.order_shipped;
    case "refund_recorded":
      return item.fields.amount === undefined
        ? copy.refund_recorded_plain
        : copy.refund_recorded(formatPrice(item.fields.amount));
    /* Alles andere gehört in die Bestellhistorie, nicht ins Gespräch. Käme
       es doch einmal an, bekommt es keinen erfundenen Satz, sondern nichts. */
    default: return null;
  }
}

/** Wie viele Einträge insgesamt ungelesen sind — für die Zahl am Rand. */
export function unreadTotal(summaries: readonly ConversationSummary[]): number {
  return summaries.reduce((sum, one) => sum + Math.max(0, one.unread), 0);
}
