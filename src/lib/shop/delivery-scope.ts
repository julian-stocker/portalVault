/**
 * WAS IM PAKET LIEGT — und warum das nicht der Zustand ist.
 *
 * ZWEI EIGENSCHAFTEN, DIE NICHT DIESELBE SIND (Betreiber, 2026-10-20):
 *
 *   condition        der **eine** SkyIsles-Zustand: gebraucht, mindestens
 *                    gut erhalten, vollständig funktionsfähig. Gespeichert
 *                    als `loose` (interner Altwert), auf dem Schirm
 *                    „Gebraucht". Sagt über Verpackung **nichts**.
 *   deliveryScope    was liegt im Paket? Medium allein, Medium mit
 *                    Anleitung, Medium mit Originalhülle, Portal allein,
 *                    Portal mit Kabel.
 *
 * Der Lieferumfang lässt sich aus dem Zustand **nicht ableiten**, weil der
 * Zustand gar nichts darüber sagt. Genau deshalb steht er daneben.
 *
 * ---------------------------------------------------------------------------
 * KEINE KOPPLUNG AN DEN ZUSTAND, UND DAS IST DER PUNKT
 *
 * Ein Spiel **mit** Originalhülle ist genauso verkäuflich wie eines ohne
 * (ADR-0130). Ein früherer Entwurf hatte `disc_case` an `condition` gehängt
 * — damals sollte `loose` „ohne Hülle" bedeuten. Diese Deutung ist
 * aufgehoben: `condition` bezeichnet den **einen** SkyIsles-Standard, und
 * „Gebraucht" darf nie heißen, dass die Hülle fehlt.
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
 * Die fünf Stufen der USK — und `null` für „nicht erfasst".
 *
 * Spiegelt den CHECK `skylanders_usk_rating_known` aus `0139`. Keine
 * sechste Stufe, keine Schätzung: die Quelle ist die Hülle oder die
 * USK-Titeldatenbank.
 */
export const USK_RATINGS: readonly number[] = [0, 6, 12, 16, 18];

/**
 * Lässt sich diese Einstufung bei SkyIsles verkaufen?
 *
 * `18` nicht: § 12 Abs. 3 JuSchG verlangt im Versandhandel eine
 * Altersprüfung bei der Bestellung **und** eine Zustellung nur an
 * Erwachsene, und SkyIsles hat beides nicht. Die Datenbank lehnt die
 * Freigabe ohnehin ab (`seller_set_sale_release()`); hier steht es, damit
 * die Oberfläche es sagen kann, bevor jemand den Schalter sucht.
 */
export function uskSellable(rating: number | null): boolean {
  return rating !== null && rating !== 18;
}

/** Das deutsche Wort. Für einen unbekannten Wert der Wert selbst, nie geraten. */
export function deliveryScopeLabel(scope: string | null): string | null {
  if (scope === null) return null;
  return de.shop.deliveryScopes[scope] ?? scope;
}
