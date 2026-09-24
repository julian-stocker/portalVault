/**
 * Der Weg zu einer Unterhaltung: die sieben RPCs aus `0098`, sonst nichts.
 *
 * KEIN TABELLENZUGRIFF. `order_messages` und `order_conversation_reads` haben
 * für jede Clientrolle `revoke all` — ein direkter Lesezugriff scheiterte
 * ohnehin. Er stünde hier aber auch dann nicht, wenn er ginge: wer darf was
 * sehen, entscheidet `order_conversation_role()` in der Datenbank, und eine
 * zweite Antwort auf dieselbe Frage wäre eine, die abweichen kann.
 *
 * `cache()` je Anfrage, wie überall: eine Seite, die Verlauf und Zahl am Rand
 * braucht, fragt einmal.
 */
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import {
  readConversation, readSummaries,
  type Conversation, type ConversationSummary,
} from "./conversation";

export const fetchConversation = cache(
  async (orderNumber: string): Promise<Conversation | null> => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("order_conversation", {
      p_order_number: orderNumber,
    });
    // NULL heißt: gibt es nicht, gehört dir nicht, oder ist eine
    // Gastbestellung. Die Seite behandelt alle drei gleich — sie zeigt
    // einfach keine Unterhaltung.
    if (error || data === null) return null;
    return readConversation(data);
  });

export const fetchMyConversations = cache(async (): Promise<ConversationSummary[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_conversations");
  return error ? [] : readSummaries(data);
});

export const fetchSellerConversations = cache(async (): Promise<ConversationSummary[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_conversations");
  return error ? [] : readSummaries(data);
});

/**
 * Die Zahl am Rand.
 *
 * Ein Aggregat in der Datenbank, keine gezählte Liste — ADR-0082 hält fest,
 * was passiert, wenn ein Badge über eine gedeckelte Seite zählt.
 *
 * Ein Fehler wird zu 0. Ein Badge, der bei einer hakenden Abfrage eine
 * erfundene Zahl zeigte, wäre schlimmer als keiner.
 */
export const fetchMyUnread = cache(async (): Promise<number> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_unread_total");
  const n = Number(data);
  return error || !Number.isFinite(n) || n < 0 ? 0 : Math.trunc(n);
});

export const fetchSellerUnread = cache(async (): Promise<number> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_unread_total");
  const n = Number(data);
  return error || !Number.isFinite(n) || n < 0 ? 0 : Math.trunc(n);
});
