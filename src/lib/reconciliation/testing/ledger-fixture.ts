/**
 * SYNTHETIC SkyIsles sales for tests — the ledger side of a reconciliation.
 *
 * A piece is given by its catalog name, optionally `name|raw name|SKY-ID|series`.
 * Everything else has a neutral default, so a test states only what it is about.
 */

import type { IsoDay, LedgerPiece, LedgerSale } from "../types.ts";

export type FixtureSale = {
  id: number;
  sold: IsoDay | null;
  /** Goods BEFORE discount. Defaults to `net + discount` when `net` is given. */
  subtotal?: number;
  /** Goods AFTER discount — the comparable value. */
  net?: number;
  discount?: number;
  shipping?: number;
  refunds?: number;
  cancelled?: IsoDay | null;
  ref?: string | null;
  isTest?: boolean;
  source?: string;
  pieces: (string | Partial<LedgerPiece>)[];
};

let itemCounter = 5000;

function piece(spec: string | Partial<LedgerPiece>): LedgerPiece {
  if (typeof spec !== "string") {
    return { itemId: (itemCounter += 1), skyId: null, name: null, rawName: null, ...spec };
  }
  const [name, raw, sky, series] = spec.split("|");
  return {
    itemId: (itemCounter += 1),
    name: name || null,
    rawName: raw || null,
    skyId: sky || `SKY-T${(name || raw || "x").replace(/\W/g, "").slice(0, 8)}`,
    seriesCode: series || null,
  };
}

export function ledgerSale(spec: FixtureSale): LedgerSale {
  const discount = spec.discount ?? 0;
  const subtotal = spec.subtotal ?? (spec.net !== undefined ? Math.round((spec.net + discount) * 100) / 100 : 0);
  return {
    saleId: spec.id,
    source: spec.source ?? "excel_order_2026",
    isTest: spec.isTest ?? false,
    soldOn: spec.sold,
    itemsSubtotal: subtotal,
    discount,
    shipping: spec.shipping ?? 5.49,
    refundsTotal: spec.refunds ?? 0,
    cancelledOn: spec.cancelled ?? null,
    externalOrderRef: spec.ref ?? null,
    pieces: spec.pieces.map(piece),
  };
}
