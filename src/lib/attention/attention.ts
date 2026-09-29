/**
 * Aufmerksamkeit an einer Bestellung — der reine Teil (0099).
 *
 * ZWEI KANÄLE, EINE REGEL. Seit 0098 gilt für Nachrichten: ungelesen ist,
 * was neuer ist als mein Wasserstand und nicht von mir stammt. 0099 wendet
 * dieselbe Regel auf Bestellereignisse an. Hier steht nichts weiter als das
 * Lesen der Antwort und das Zusammenzählen — die Entscheidung, WAS zählt,
 * trifft die Datenbank, und zwar an genau einer Stelle.
 *
 * STATUS IST NICHT AUFMERKSAMKEIT. In dieser Datei taucht deshalb kein
 * einziger Bestellstatus auf. „Bezahlt", „zu versenden" und „versendet" sind
 * Arbeit und werden gezählt, wo Arbeit gezählt wird (`seller_open_order_counts`,
 * ADR-0050) — nicht hier.
 */

/** Eine Bestellung mit etwas Neuem, so wie die Datenbank sie meldet. */
export type AttentionSummary = {
  orderNumber: string;
  lastAt: string;
  unread: number;
  total: number;
};

/** Leere, aber gültige Antwort — der Fall „nichts liegt an". */
export const NO_ATTENTION: readonly AttentionSummary[] = [];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Eine nicht-negative ganze Zahl oder 0. Niemals NaN nach außen. */
function count(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/**
 * Liest, was `my_order_attention()` / `seller_order_attention()` liefern.
 *
 * Alles, was nicht passt, fällt weg statt zu werfen: ein Badge ist kein Ort
 * für eine Ausnahme, und eine halbe Liste ist besser als eine Seite, die
 * nicht lädt.
 */
export function readAttention(value: unknown): AttentionSummary[] {
  if (!Array.isArray(value)) return [];
  const rows: AttentionSummary[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const orderNumber = raw.order_number;
    const lastAt = raw.last_at;
    if (typeof orderNumber !== "string" || orderNumber === "") continue;
    if (typeof lastAt !== "string" || lastAt === "") continue;
    rows.push({
      orderNumber,
      lastAt,
      unread: count(raw.unread),
      total: count(raw.total),
    });
  }
  return rows;
}

/**
 * Die Zahl an der Karte.
 *
 * Summe über die Zeilen, nicht deren Anzahl: zwei ungesehene Ereignisse an
 * einer Bestellung sind zwei, nicht eins. Dieselbe Rechnung wie in der
 * Datenbank — sie steht hier nur für die Fälle, in denen die Liste ohnehin
 * schon geladen ist.
 */
export function attentionTotal(rows: readonly AttentionSummary[]): number {
  return rows.reduce((sum, row) => sum + row.unread, 0);
}

/** Die Bestellnummern, an denen „Neu" steht. */
export function unreadOrderNumbers(rows: readonly AttentionSummary[]): Set<string> {
  return new Set(rows.filter((row) => row.unread > 0).map((row) => row.orderNumber));
}

/**
 * Was am Konto-Symbol steht: die Summe der Kanäle der aktiven Rolle.
 *
 * Eine Ebene höher als die Karten, und ausdrücklich deren Summe — die drei
 * Ebenen dürfen nicht auseinanderlaufen, und der einzige Weg, das zu
 * garantieren, ist, sie auseinander zu rechnen statt nebeneinander zu
 * erheben.
 */
export function roleAttention(channels: { messages: number; orders: number }): number {
  return Math.max(0, channels.messages) + Math.max(0, channels.orders);
}
