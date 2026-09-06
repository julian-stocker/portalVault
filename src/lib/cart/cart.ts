/**
 * The cart, as data.
 *
 * V1 is deliberately a **local** cart (ADR-0043): it lives in the browser's
 * `localStorage` and in nothing else. It writes no table, books no movement,
 * reserves no stock and needs no account. Someone who is not signed in can
 * fill it, and nothing in the database changes while they do.
 *
 * That is not a shortcut around a checkout — there is no checkout. Reserving
 * stock is a promise, and a promise nobody can pay for yet would take
 * articles off the shelf for as long as a browser tab stays open.
 *
 * WHAT A LINE STORES, AND WHY
 *
 * The identity of a line is `sky_id + condition`, which is exactly the
 * identity of a stock position: the same figure loose and boxed are two
 * different articles at two different prices, and adding one must not merge
 * into the other.
 *
 * Beside that, a line carries a **display snapshot** — the name and picture
 * as they were when it was added — so the cart page can show what is in it
 * without loading the whole catalog for four lines.
 *
 * It also carries the price it was added at, and that price is never spent.
 * The current price and the current availability always come from the server
 * (`shop_offers()`), and `resolveCart` below is where the two meet. A stored
 * price is only ever used to say "this has changed since you put it in".
 *
 * Everything here is pure. No storage, no React, no database.
 */
import { isOfferCondition, type Offer, type OfferCondition, type OfferIndex } from "@/lib/shop/offer";

/** Sanity bound, not a stock check: the cart cannot see stock levels. */
export const MAX_LINE_QUANTITY = 99;

export type CartLine = {
  skyId: string;
  condition: OfferCondition;
  /** At least 1, at most `MAX_LINE_QUANTITY`. */
  quantity: number;
  /** Display snapshot from the moment it was added. Never used for money. */
  name: string;
  imageFile: string | null;
  /**
   * The asking price when the line was added.
   *
   * Kept only so a change can be pointed out. Every sum in this file uses the
   * server's current price, never this one.
   */
  priceAtAdd: number;
};

export type Cart = readonly CartLine[];

export const EMPTY_CART: Cart = [];

/** The identity of a line: one article, one condition. */
export function lineKey(skyId: string, condition: OfferCondition): string {
  return `${skyId}/${condition}`;
}

export function keyOf(line: CartLine): string {
  return lineKey(line.skyId, line.condition);
}

function clampQuantity(quantity: number): number {
  if (!Number.isFinite(quantity)) return 1;
  return Math.min(MAX_LINE_QUANTITY, Math.max(1, Math.round(quantity)));
}

/**
 * Adds one article, or raises the quantity of the line that is already there.
 *
 * The display snapshot of an existing line is refreshed rather than kept: if
 * the same article is added again from a page that knows a newer name, the
 * newer name is the better label.
 */
export function addLine(
  cart: Cart,
  article: { skyId: string; condition: OfferCondition; name: string; imageFile: string | null; price: number },
  quantity = 1,
): Cart {
  const key = lineKey(article.skyId, article.condition);
  const existing = cart.find((line) => keyOf(line) === key);

  if (!existing) {
    return [
      ...cart,
      {
        skyId: article.skyId,
        condition: article.condition,
        quantity: clampQuantity(quantity),
        name: article.name,
        imageFile: article.imageFile,
        priceAtAdd: article.price,
      },
    ];
  }

  return cart.map((line) =>
    keyOf(line) === key
      ? {
          ...line,
          quantity: clampQuantity(line.quantity + quantity),
          name: article.name,
          imageFile: article.imageFile,
        }
      : line,
  );
}

/** Sets a line's quantity. Zero or less removes it — that is what 0 means. */
export function setLineQuantity(cart: Cart, key: string, quantity: number): Cart {
  if (quantity <= 0) return removeLine(cart, key);
  return cart.map((line) =>
    keyOf(line) === key ? { ...line, quantity: clampQuantity(quantity) } : line,
  );
}

export function removeLine(cart: Cart, key: string): Cart {
  return cart.filter((line) => keyOf(line) !== key);
}

/** The number on the badge: pieces, not lines. */
export function cartCount(cart: Cart): number {
  return cart.reduce((sum, line) => sum + line.quantity, 0);
}

// ---------------------------------------------------------------- reconciling

/**
 * A cart line met with what the server currently says about it.
 *
 * Four states, and none of them removes anything from the screen. A line that
 * cannot be bought stays visible with a reason — a cart that quietly drops
 * what someone chose is a cart that lies about what they chose.
 */
export type CartEntry = {
  line: CartLine;
  /** The current offer, or null when SkyIsles no longer carries the article. */
  offer: Offer | null;
  /** Current price, from the server. Null when there is no offer any more. */
  price: number | null;
  /** May this line be bought right now, and therefore counted in the total? */
  purchasable: boolean;
  /** Set when the current price differs from the one it was added at. */
  priceChanged: boolean;
  /** `price × quantity`, or null when the line cannot be bought. */
  total: number | null;
};

export function resolveLine(line: CartLine, offers: OfferIndex): CartEntry {
  const offer = offers.get(line.skyId)?.find((o) => o.condition === line.condition) ?? null;

  if (!offer) {
    return { line, offer: null, price: null, purchasable: false, priceChanged: false, total: null };
  }

  const purchasable = offer.available;
  return {
    line,
    offer,
    price: offer.price,
    purchasable,
    priceChanged: offer.price !== line.priceAtAdd,
    total: purchasable ? round(offer.price * line.quantity) : null,
  };
}

export function resolveCart(cart: Cart, offers: OfferIndex): CartEntry[] {
  return cart.map((line) => resolveLine(line, offers));
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * What the cart currently comes to.
 *
 * Only lines that can actually be bought. A sold-out or withdrawn line stays
 * on screen and stays out of this number — quoting a total that includes
 * something nobody can buy would be quoting a price that is not offered.
 */
export function cartTotal(entries: readonly CartEntry[]): number {
  return round(entries.reduce((sum, entry) => sum + (entry.total ?? 0), 0));
}

/** Lines that cannot be bought right now. Drives one line of explanation. */
export function unavailableEntries(entries: readonly CartEntry[]): CartEntry[] {
  return entries.filter((entry) => !entry.purchasable);
}

// -------------------------------------------------------------------- storage

/**
 * The stored shape, versioned.
 *
 * A version rather than bare JSON so a later change to a line has somewhere
 * to be handled. Anything that does not parse, or carries a version this
 * build does not know, is discarded — a wrong cart is worse than an empty
 * one, and there is nothing here that cannot be chosen again in two taps.
 */
export const CART_STORAGE_KEY = "skyisles.cart.v1";
const CART_VERSION = 1;

export function encodeCart(cart: Cart): string {
  return JSON.stringify({ version: CART_VERSION, lines: cart });
}

/** Parses stored JSON. Never throws: bad input is an empty cart. */
export function decodeCart(raw: string | null): Cart {
  if (!raw) return EMPTY_CART;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_CART;
  }

  if (typeof parsed !== "object" || parsed === null) return EMPTY_CART;
  const payload = parsed as { version?: unknown; lines?: unknown };
  if (payload.version !== CART_VERSION || !Array.isArray(payload.lines)) return EMPTY_CART;

  const lines: CartLine[] = [];
  const seen = new Set<string>();

  for (const candidate of payload.lines) {
    const line = parseLine(candidate);
    if (!line) continue;
    // A duplicated key in stored data would give the same article two lines
    // that could never be reconciled with one offer.
    const key = keyOf(line);
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
  }

  return lines;
}

function parseLine(candidate: unknown): CartLine | null {
  if (typeof candidate !== "object" || candidate === null) return null;
  const row = candidate as Record<string, unknown>;

  if (typeof row.skyId !== "string" || !/^SKY-[0-9]{4}$/.test(row.skyId)) return null;
  if (!isOfferCondition(row.condition)) return null;
  if (typeof row.quantity !== "number" || !Number.isFinite(row.quantity) || row.quantity < 1) {
    return null;
  }
  if (typeof row.name !== "string" || row.name === "") return null;
  if (typeof row.priceAtAdd !== "number" || !Number.isFinite(row.priceAtAdd)) return null;

  return {
    skyId: row.skyId,
    condition: row.condition,
    quantity: clampQuantity(row.quantity),
    name: row.name,
    imageFile: typeof row.imageFile === "string" ? row.imageFile : null,
    priceAtAdd: row.priceAtAdd,
  };
}
