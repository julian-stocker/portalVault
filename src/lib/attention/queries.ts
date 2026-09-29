/**
 * Der Weg zur Aufmerksamkeit: die vier Clientfunktionen aus `0099`.
 *
 * Kein Tabellenzugriff — `order_attention_reads` ist jeder Clientrolle
 * entzogen, und wer welche Seite sieht, entscheidet `order_attention_role()`
 * in der Datenbank. `cache()` je Anfrage: Kopf, Karte und Liste fragen
 * einmal, deshalb können sie sich nicht widersprechen.
 */
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import { readAttention, type AttentionSummary } from "./attention";

/** Ein Fehler wird zu 0. Eine erfundene Zahl wäre schlimmer als keine. */
function total(data: unknown, error: unknown): number {
  const n = Number(data);
  return error || !Number.isFinite(n) || n < 0 ? 0 : Math.trunc(n);
}

export const fetchMyOrderAttention = cache(async (): Promise<AttentionSummary[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_order_attention");
  return error ? [] : readAttention(data);
});

export const fetchSellerOrderAttention = cache(async (): Promise<AttentionSummary[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_order_attention");
  return error ? [] : readAttention(data);
});

export const fetchMyAttentionTotal = cache(async (): Promise<number> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_attention_total");
  return total(data, error);
});

export const fetchSellerAttentionTotal = cache(async (): Promise<number> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_attention_total");
  return total(data, error);
});
