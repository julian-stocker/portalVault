/**
 * WAS IM PAKET LIEGT — und warum das nicht der Zustand ist.
 *
 * ZWEI EIGENSCHAFTEN, DIE NICHT DIESELBE SIND (Betreiber, 2026-10-20):
 *
 *   condition        in welchem Zustand ist der Artikel? Das vorhandene
 *                    Vokabular `loose` / `boxed`. Für ein Spiel heißt
 *                    `loose` ausdrücklich: **Spielmedium ohne
 *                    Originalhülle**. Dieses Modul deutet daran nichts um.
 *   deliveryScope    was liegt im Paket? Disc allein, Disc mit Anleitung,
 *                    Portal allein, Portal mit USB-Kabel.
 *
 * Der Lieferumfang lässt sich aus dem Zustand **nicht ableiten** — „lose"
 * sagt, dass keine Originalhülle dabei ist; es sagt nicht, ob eine
 * Anleitung oder ein Kabel dabei ist. Genau deshalb steht er daneben.
 *
 * ---------------------------------------------------------------------------
 * WARUM `disc_case` DABEI IST, OBWOHL ES HEUTE NICHT VERKAUFT WIRD
 *
 * Nach der Festlegung oben ist ein Spiel **mit** Originalhülle nicht
 * `loose` — und V1 verkauft nur `loose` (`v1_sale_condition()`, ADR-0029,
 * `0108`). `disc_case` ist deshalb modelliert und wählbar, aber an einer
 * losen Position durch den CHECK `shop_inventory_case_is_not_loose`
 * ausgeschlossen. Das ist kein toter Wert: es ist die Stelle, an der die
 * Frage „verkaufen wir auch Spiele mit Hülle?" sichtbar wird, statt
 * unausgesprochen zu bleiben. Sie zu beantworten ist eine eigene
 * Produktentscheidung (ADR-0129).
 * ---------------------------------------------------------------------------
 *
 * KEIN DATENBANKZUGRIFF. Spiegelt `shop_inventory_delivery_scope_known` aus
 * `0139`; `delivery-scope.test.ts` vergleicht beide Fassungen Zeichen für
 * Zeichen, damit sie nicht auseinanderlaufen.
 */
import { de } from "@/lib/i18n/de";

/** Die Werte, die ein Spiel haben kann — in der Reihenfolge der Vollständigkeit. */
export const GAME_SCOPES = ["disc_only", "disc_manual", "disc_case"] as const;

/** Die Werte, die ein Portal haben kann. */
export const PORTAL_SCOPES = ["portal_only", "portal_cable"] as const;

/** Alle, wie sie im CHECK stehen. */
export const DELIVERY_SCOPES = [...GAME_SCOPES, ...PORTAL_SCOPES] as const;

export type DeliveryScope = (typeof DELIVERY_SCOPES)[number];

export function isDeliveryScope(value: unknown): value is DeliveryScope {
  return typeof value === "string" && (DELIVERY_SCOPES as readonly string[]).includes(value);
}

/**
 * Welche Werte diese Artikelart kennt.
 *
 * Eine Figur bekommt eine leere Liste, und das ist die Aussage: dort
 * beantwortet `condition` die Frage, und ein Auswahlfeld ohne Wirkung wäre
 * eine Falle.
 */
export function scopesFor(itemType: string): readonly DeliveryScope[] {
  if (itemType === "game") return GAME_SCOPES;
  if (itemType === "portal") return PORTAL_SCOPES;
  return [];
}

/**
 * Kann dieser Lieferumfang an einer Position dieser Beschaffenheit stehen?
 *
 * Spiegelt `shop_inventory_case_is_not_loose`. Die Antwort wird hier
 * **vorher** gegeben, damit die Oberfläche die Wahl gar nicht erst
 * anbietet — der CHECK bleibt trotzdem die Wahrheit.
 */
export function scopeFitsCondition(scope: DeliveryScope, condition: string): boolean {
  return scope !== "disc_case" || condition !== "loose";
}

/** Das deutsche Wort. Für einen unbekannten Wert der Wert selbst, nie geraten. */
export function deliveryScopeLabel(scope: string | null): string | null {
  if (scope === null) return null;
  return de.shop.deliveryScopes[scope] ?? scope;
}
