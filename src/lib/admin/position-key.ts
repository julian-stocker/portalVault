/**
 * How a stock position is addressed across the screens.
 *
 * A position is `SKY-ID + condition`, never the SKY-ID alone: loose and
 * boxed are separate shelves with separate prices and separate histories,
 * and nothing in this product adds them together. Stated once so the page,
 * the list and the card cannot spell it differently.
 */
export function positionKey(skyId: string, condition: string): string {
  return `${skyId}:${condition}`;
}
