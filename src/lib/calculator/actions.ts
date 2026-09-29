/**
 * Der Katalog für den Kalkulator — geholt, wenn er gebraucht wird (V1).
 *
 * WARUM EINE SERVER ACTION UND KEIN PROP. Das Symbol sitzt im Kopf und damit
 * in vier Layouts. Würden die den Katalog laden, zahlte jede Seite für 820
 * Zeilen, die fast nie jemand aufschlägt. So kostet der Kalkulator genau
 * dann etwas, wenn er geöffnet wird — und danach nichts mehr, weil das
 * Modal sich die Liste merkt, solange die Seite steht.
 *
 * WER FRAGEN DARF, ENTSCHEIDET DIE BESTEHENDE PRÜFUNG. `fetchOrderbookCatalog`
 * fragt `canOperateSeller()`, bevor es irgendetwas liest, und gibt einer
 * Kundschaft eine leere Liste. Diese Datei fügt dem nichts hinzu und baut
 * ausdrücklich keine zweite Rollenlogik: dass das Symbol im Kopf nur einem
 * Betrieb gezeigt wird, ist Bequemlichkeit, nicht die Grenze.
 *
 * NUR ASYNCHRONE FUNKTIONEN. Eine `"use server"`-Datei macht aus jedem
 * Export einen Endpunkt und bricht beim Übersetzen ab, sobald etwas anderes
 * als eine async-Funktion dabei ist — der Fehler, an dem `messages/actions.ts`
 * schon einmal gescheitert ist. Typen und Konstanten stehen in
 * `calculation.ts`.
 */
"use server";

import { canOperateSeller } from "@/lib/auth/capabilities";
import { createClient } from "@/lib/supabase/server";
import { fetchOrderbookCatalog } from "@/lib/orderbook/queries";
import { historicFactorPercent } from "@/lib/calculator/calculation";
import type { FigureChoice } from "@/lib/orderbook/figure-search";

export type CalculatorContext = {
  catalog: FigureChoice[];
  /** Der eigene Schnitt in ganzen Prozent, oder `null`, wenn es keinen gibt. */
  historicFactor: number | null;
};

/**
 * Alles, was der Kalkulator beim Öffnen braucht — in einem Zug.
 *
 * Zwei Dinge, eine Runde: die Figuren und der historische Ankaufsfaktor. Ein
 * zweiter Aufruf hintendran wäre ein zweiter Wasserfall für eine einzige
 * Zahl.
 *
 * NUR LESEN. `fetchOrderbookCatalog` fragt `canOperateSeller()`, bevor es
 * irgendetwas liest, und `orderbook_global_factor()` ist `stable` — ein
 * reines SELECT über `purchases`. Nichts hier schreibt, und nichts hier
 * verändert den historischen Faktor: ihn im Kalkulator zu verstellen ist
 * eine Zahl im Browser, kein Vorgang im Orderbuch.
 */
export async function loadCalculatorContext(): Promise<CalculatorContext> {
  try {
    const [catalog, historicFactor] = await Promise.all([
      fetchOrderbookCatalog(),
      readHistoricFactor(),
    ]);
    return { catalog, historicFactor };
  } catch {
    return { catalog: [], historicFactor: null };
  }
}

/**
 * Der historische Ankaufsfaktor, gelesen und nicht nachgerechnet.
 *
 * DIE FORMEL BLEIBT IN DER DATENBANK. `orderbook_global_factor()` ist seit
 * `0059` Ausgaben ÷ bekannter Marktwert über alle Einkäufe und wird von
 * `seller_create_sale()` für den Buy-in-Schnappschuss benutzt. Sie hier in
 * TypeScript nachzubilden hieße, zwei Wahrheiten über dieselbe Kennzahl zu
 * haben, und die eine würde irgendwann abweichen.
 *
 * ZWEI SCHLÖSSER, NICHT EINS. `seller_buy_in_factor()` (0103) trägt den
 * Wächter in der Datenbank — dort, wo er auch einen direkten RPC-Aufruf
 * abweist, nicht nur diesen Weg. `canOperateSeller()` hier davor erspart
 * einer Kundschaft die Runde und hält die Antwort in dieser Datei
 * eindeutig; die Sicherheit hängt aber an der Datenbank, nicht an dieser
 * Zeile.
 *
 * `orderbook_global_factor()` selbst wird NICHT mehr gerufen: seit 0103 hält
 * keine Clientrolle EXECUTE darauf, und die Formel bleibt trotzdem die eine,
 * die dort steht — der Wächter ruft sie auf, statt sie zu wiederholen.
 */
async function readHistoricFactor(): Promise<number | null> {
  if (!(await canOperateSeller())) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_buy_in_factor");
  if (error) return null;
  return historicFactorPercent(data);
}
