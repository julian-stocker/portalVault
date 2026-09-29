/**
 * Das eine, was ein Mensch mit der Aufmerksamkeit einer Bestellung tut:
 * hinsehen.
 *
 * NUR ASYNCHRONE FUNKTIONEN — eine `"use server"`-Datei macht aus jedem
 * Export einen Endpunkt und bricht beim Übersetzen ab, sobald etwas anderes
 * dabei ist. Konstanten und reine Helfer stehen in `attention.ts`.
 *
 * GELESEN WIRD BEIM ÖFFNEN DER BESTELLUNG, nie beim Öffnen einer Liste. Eine
 * Liste überfliegt man; sie als „alles gesehen" zu werten nähme genau die
 * Marke weg, derentwegen man hinsieht.
 */
"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export async function markOrderAttentionRead(orderNumber: string): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase.rpc("mark_order_attention_read", { p_order_number: orderNumber });
    /* Dieselbe Begründung wie bei den Nachrichten: die Zahl hängt am Layout,
       nicht an einer Seite, und `revalidatePath(…, "layout")` nimmt den
       ganzen Bereich mit. Beide Bereiche, weil beide Rollen eine Zahl haben. */
    revalidatePath("/account", "layout");
    revalidatePath("/business", "layout");
  } catch {
    /* Beim nächsten Öffnen noch einmal. */
  }
}
