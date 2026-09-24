/**
 * Die zwei Dinge, die ein Mensch an einer Unterhaltung tut: schreiben und
 * gelesen haben.
 *
 * NUR ASYNCHRONE FUNKTIONEN. Eine `"use server"`-Datei ist kein Modul wie
 * jedes andere: Next macht aus jedem Export einen aufrufbaren Endpunkt und
 * bricht beim Übersetzen ab, sobald etwas anderes als eine async-Funktion
 * dabei ist. Eine exportierte Zahl reicht — genau daran ist der erste
 * Sendeversuch gescheitert („A `use server` file can only export async
 * functions, found number"), weil hier `MESSAGE_MAX` weitergereicht wurde.
 * Konstanten, Typen und reine Helfer stehen in `conversation.ts`.
 *
 * BEIDES ÜBER DIE RPCs AUS `0098`. Wer schreiben darf, entscheidet die
 * Datenbank; `author_kind` setzt sie selbst. Diese Datei prüft dieselben
 * Grenzen noch einmal — nicht als Sicherheit, sondern damit eine offensichtlich
 * unmögliche Eingabe gar nicht erst zur Datenbank reist und der Mensch eine
 * verständliche Antwort bekommt statt eines SQLSTATE.
 */
"use server";

import { revalidatePath } from "next/cache";

import { de } from "@/lib/i18n/de";
import { createClient } from "@/lib/supabase/server";
import { messageIsSendable } from "./conversation";

export type SendResult = { ok: true } | { ok: false; message: string };

const copy = de.messages;

/** Die Refusals, die einen eigenen Satz verdienen. */
function message(error: { code?: string; message?: string }): string {
  const text = error.message ?? "";
  if (text.includes("too many messages")) return copy.errors.tooMany;
  if (text.includes("no such conversation")) return copy.errors.notAllowed;
  if (text.includes("too long")) return copy.errors.tooLong;
  if (text.includes("needs a body")) return copy.errors.empty;
  if (error.code === "42501") return copy.errors.notAllowed;
  console.error(`order message: unmapped ${error.code ?? "?"} ${text}`);
  return copy.errors.failed;
}

/**
 * `orderNumber` dient hier nur dem Revalidieren und dem Adressieren — die
 * Datenbank entscheidet anhand der Nummer selbst, ob der Anfragende zu dieser
 * Bestellung gehört, und antwortet sonst so, als gäbe es sie nicht.
 */
export async function sendOrderMessage(input: {
  orderNumber: string;
  body: string;
}): Promise<SendResult> {
  const body = input.body.trim();
  if (!messageIsSendable(body)) {
    return { ok: false, message: body === "" ? copy.errors.empty : copy.errors.tooLong };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("post_order_message", {
    p_order_number: input.orderNumber,
    p_body: body,
  });
  if (error) return { ok: false, message: message(error) };

  revalidateConversations();
  return { ok: true };
}

/**
 * Gelesen heißt: bis hierher habe ich gesehen.
 *
 * Wiederholbar und monoton — die Datenbank nimmt das spätere von beiden
 * Daten. Ein Fehler bleibt still: dass ein Wasserstand nicht vorrückt, ist
 * ärgerlich, aber keine Nachricht wert, die über dem Verlauf steht.
 */
export async function markConversationRead(orderNumber: string): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase.rpc("mark_order_conversation_read", { p_order_number: orderNumber });
    revalidateConversations();
  } catch {
    /* Beim nächsten Öffnen noch einmal. */
  }
}

/**
 * Was nach einer Nachricht neu geladen werden muss.
 *
 * DIE ZAHL AM RAND HÄNGT AM LAYOUT, NICHT AN EINER SEITE. Vorher standen hier
 * vier einzelne Pfade — die beiden Posteingänge und die beiden
 * Bestellseiten —, und genau das war der Fehler: die Zahl wird von `SiteNav`
 * gezeichnet, und `SiteNav` steht im gemeinsamen Layout. Bei einer weichen
 * Navigation innerhalb des Bereichs rendert das Layout nicht neu, also blieb
 * der Badge auf jeder anderen Business-Seite stehen, wie er war. Er erschien
 * erst auf `/business/nachrichten` — der einzigen Adresse, die hier stand.
 *
 * `revalidatePath(…, "layout")` nimmt das Layout UND alles darunter mit; die
 * vier Einzelpfade sind damit abgedeckt und die Zahl stimmt auf jeder Route
 * des Bereichs. Kein Polling, kein Sonderfall für eine Adresse.
 *
 * Beide Bereiche, immer: eine Nachricht der Kundschaft verändert die Zahl des
 * Betriebs und umgekehrt, und wer sie ausgelöst hat, ist dafür unerheblich.
 */
function revalidateConversations(): void {
  revalidatePath("/account", "layout");
  revalidatePath("/business", "layout");
}
