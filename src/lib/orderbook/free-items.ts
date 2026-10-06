/**
 * Positionen, die kein Katalogartikel sind (0059's own contract, surfaced).
 *
 * WAS EIN FREIER ARTIKEL IST. Ein Portal, ein Spiel, ein Konvolut-Restposten,
 * ein Poster — etwas, das mitverkauft wurde und zum Geld gehört, aber keine
 * SKY-ID hat und nie eine bekommt. `sale_items` kann das seit `0059`:
 *
 *   constraint sale_items_identifiable
 *     check (sky_id is not null or (raw_name is not null and length(btrim(raw_name)) > 0))
 *   constraint sale_items_movement_needs_figure
 *     check (movement_id is null or sky_id is not null)
 *
 * Die erste Zeile erlaubt die Position, die zweite macht sie für das Lager
 * unsichtbar: ohne `sky_id` kann sie keine Lagerbewegung besitzen. Production
 * enthält heute 54 solche Positionen — dieser Vertrag ist nicht neu, er war
 * nur im Verkaufsformular nicht erreichbar.
 *
 * WAS DABEI NICHT PASSIERT, UND ZWAR NICHT AUS HÖFLICHKEIT:
 *
 *   keine `skylanders`-Zeile      es wird keine SKY-ID erfunden. Eine SKY-ID
 *                                 wird nie abgeleitet, nie neu vergeben
 *                                 (CLAUDE.md, Regel 2).
 *   kein `shop_inventory`         es gibt keine Lagerposition ohne `sky_id`.
 *   kein Hold, kein `reserved`    `hold_sale_item` gibt `not_a_figure`
 *                                 zurück, bevor es irgendetwas anfasst
 *                                 (0110, `if v_item.sky_id is null`).
 *   keine `inventory_movements`   der CHECK oben verbietet sie.
 *
 * WARUM DAS EIN EIGENES MODELL IST UND NICHT `DraftLine`. Ein `DraftLine` ist
 * über seine SKY-ID identifiziert — die ist sein React-Key, sein
 * Zusammenführungs-Kriterium und das Einzige, was `draftPayload` sendet. Ein
 * freier Artikel hat keine, und eine erfundene („frei:0") in dieses Feld zu
 * schreiben wäre genau das, was Regel 2 verbietet. Zwei Modelle sind hier
 * billiger als ein Feld, das manchmal keine Identität enthält — und der
 * Einkauf, der dasselbe `DraftLine` benutzt, bleibt unberührt.
 */

/** Eine freie Position und wie viele physische Stücke davon. */
export type FreeItemLine = {
  /** Identität im Entwurf. Erreicht keine Datenbank. */
  key: string;
  /** Der eingegebene Name, roh — er landet als `raw_name`. */
  name: string;
  /** Physische Stücke. Mindestens 1; bei 0 verschwindet die Zeile. */
  quantity: number;
};

/** Kurz genug, dass „a" kein Artikel ist — dieselbe Schwelle wie die Suche. */
export const MIN_FREE_NAME = 2;

/**
 * Eine freie Position hinzufügen.
 *
 * `limit` ist das verbleibende Stückkontingent des Formulars; `0` heißt, es
 * passt nichts mehr hinein. Der Name wird NICHT normalisiert, nicht
 * großgeschrieben und nicht korrigiert (CLAUDE.md, Regel 4) — nur außen
 * beschnitten, weil ein Leerzeichen am Rand keine Information ist.
 *
 * ZWEI GLEICHE NAMEN WERDEN EINE ZEILE MIT ZWEI STÜCKEN, wie beim Katalog:
 * zwei identische Zeilen nebeneinander lesen sich als Versehen, und jede
 * bräuchte ihren eigenen Mengenknopf. Gespeichert wird trotzdem eine Zeile
 * pro Stück — `freeItemPayload` ist die Stelle, an der das wieder auseinander
 * geht.
 */
export function addFreeItem(
  lines: readonly FreeItemLine[], name: string, key: string, limit: number,
): FreeItemLine[] {
  const trimmed = name.trim();
  if (trimmed.length < MIN_FREE_NAME) return [...lines];
  if (limit <= 0) return [...lines];
  const existing = lines.findIndex((l) => l.name === trimmed);
  if (existing === -1) return [...lines, { key, name: trimmed, quantity: 1 }];
  return lines.map((l, i) => (i === existing ? { ...l, quantity: l.quantity + 1 } : l));
}

export function removeFreeItem(lines: readonly FreeItemLine[], key: string): FreeItemLine[] {
  return lines.filter((l) => l.key !== key);
}

/** Null oder weniger entfernt die Zeile — dasselbe wie beim Katalogentwurf. */
export function setFreeQuantity(
  lines: readonly FreeItemLine[], key: string, quantity: number, limit: number,
): FreeItemLine[] {
  if (!Number.isFinite(quantity) || quantity <= 0) return removeFreeItem(lines, key);
  const current = lines.find((l) => l.key === key)?.quantity ?? 0;
  const capped = Math.min(Math.floor(quantity), current + Math.max(0, limit));
  return lines.map((l) => (l.key === key ? { ...l, quantity: capped } : l));
}

/** Physische Stücke über alle freien Zeilen. */
export function freeItemCount(lines: readonly FreeItemLine[]): number {
  return lines.reduce((sum, l) => sum + l.quantity, 0);
}

/**
 * Was an `p_items` geht: ein Element pro Stück, `raw_name` gesetzt.
 *
 * KEIN `sky_id`-Feld, nicht einmal `null`. `seller_create_sale_with_details`
 * liest `e->>'sky_id'` und macht daraus `nullif(btrim(...), '')` — ein
 * fehlendes Feld ist dort genau so viel wie ein leeres, nämlich NULL. Das
 * Feld weglassen ist die ehrlichere Schreibweise: diese Position hat keine.
 */
export function freeItemPayload(lines: readonly FreeItemLine[]): { raw_name: string }[] {
  const payload: { raw_name: string }[] = [];
  for (const line of lines) {
    for (let i = 0; i < line.quantity; i++) payload.push({ raw_name: line.name });
  }
  return payload;
}
