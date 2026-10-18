/**
 * Reading the Orderbuch (ADR-0088).
 *
 * Seller-gated twice: once here so a route can answer before querying, and
 * again inside every function, which is the boundary.
 */
import { cache } from "react";

import { canOperateSeller } from "@/lib/auth/capabilities";
import { createClient } from "@/lib/supabase/server";
import { imageSrc } from "@/lib/catalog/image";
import type { FigureChoice } from "./figure-search";
import {
  EMPTY_COUNTS, readCounts, type ClassificationCounts, type StatusScope,
} from "./classification";
import type { ItemState } from "./purchase";
import {
  EMPTY_SUMMARY, UNDATED, sortLedger, summaryFactor,
  type LedgerRow, type LedgerSummary, type YearFilter,
} from "./ledger";

/**
 * One filtered, searched page of the ledger plus its summary.
 *
 * ONE ROUND TRIP, AND NO ITEMS. `seller_orderbook_ledger()` filters, searches
 * and aggregates in the database, so the browser receives fifteen rows instead
 * of five hundred and sixty-one items it would only need in order to count
 * them. Items arrive when a row is expanded — `loadPurchaseItems()` in
 * `orderbook/actions.ts`, which reads `fetchPurchase()` further down.
 *
 * This line used to name `fetchPurchaseItems`. No such function has ever
 * existed; the reference was wrong from the start and is corrected here
 * rather than appended to.
 */
export const fetchLedger = cache(
  async (
    year?: YearFilter, month?: number, search?: string, status: StatusScope = "normal",
  ): Promise<{
    purchases: LedgerRow[]; summary: LedgerSummary; counts: ClassificationCounts;
  }> => {
    const empty = { purchases: [], summary: EMPTY_SUMMARY, counts: EMPTY_COUNTS };
    if (!(await canOperateSeller())) return empty;
    const supabase = await createClient();
    const undated = year === UNDATED;
    const { data, error } = await supabase.rpc("seller_orderbook_ledger", {
      p_year: undated ? null : year ?? null,
      p_month: undated ? null : month ?? null,
      p_search: search ?? null,
      p_undated: undated,
      // `normal` by default, so a caller that forgets the argument gets the
      // business ledger rather than one with test rows mixed into it.
      p_status: status,
    });
    if (error || data === null || typeof data !== "object") {
      return empty;
    }
    const root = data as Record<string, unknown>;
    const s = (root.summary ?? {}) as Record<string, unknown>;

    const purchases = (Array.isArray(root.purchases) ? root.purchases : []).map((raw) => {
      const r = raw as Record<string, unknown>;
      return {
        id: Number(r.id),
        purchasedAt: r.purchased_at === null || r.purchased_at === undefined
          ? null : String(r.purchased_at),
        totalCost: Number(r.total_cost),
        currency: String(r.currency),
        source: String(r.source),
        note: (r.note as string) ?? null,
        itemCount: Number(r.item_count),
        bookedCount: Number(r.booked_count),
        settledCount: Number(r.settled_count ?? 0),
        openCount: Number(r.open_count),
        knownValue: Number(r.known_value),
        knownItems: Number(r.known_items),
        factor: r.factor === null || r.factor === undefined ? null : Number(r.factor),
        matchItems: (Array.isArray(r.match_items) ? r.match_items : []).map((m) => {
          const i = m as Record<string, unknown>;
          return { id: Number(i.id), position: Number(i.position), name: String(i.name ?? "") };
        }),
        isTest: r.is_test === true,
        isIncomplete: r.is_incomplete === true,
        isOpen: r.is_open === true,
        /*
         * 0115/0116. Defensiv gelesen: eine Datenbank ohne `0116` liefert
         * diese Felder nicht, und dann ist die Antwort „unbekannt" (NULL)
         * bzw. 0 — nicht NaN. Dieselbe Vorsicht wie bei `buyerDayCount` im
         * Verkaufsbuch, und aus demselben Grund: der Anwendungscode kann vor
         * der Migration live gehen.
         */
        dailyIndex: r.daily_index === null || r.daily_index === undefined
          ? null : Number(r.daily_index),
        platform: (r.platform as string) ?? null,
        sellerName: (r.seller_name as string) ?? null,
        paymentMethod: (r.payment_method as string) ?? null,
        externalRef: (r.external_ref as string) ?? null,
        itemsCost: r.items_cost === null || r.items_cost === undefined
          ? null : Number(r.items_cost),
        shippingCost: r.shipping_cost === null || r.shipping_cost === undefined
          ? null : Number(r.shipping_cost),
        buyerProtectionCost:
          r.buyer_protection_cost === null || r.buyer_protection_cost === undefined
            ? null : Number(r.buyer_protection_cost),
        damagedCount: Number(r.damaged_count ?? 0),
        missingCount: Number(r.missing_count ?? 0),
        showcaseCount: Number(r.showcase_count ?? 0),
        updatedAt: r.updated_at === null || r.updated_at === undefined
          ? null : String(r.updated_at),
        /*
         * 0124. `status_known` ist der Marker: fehlt er, hat diese Datenbank
         * die Migration nicht, und dann sind die zehn Felder darunter OHNE
         * AUSSAGE — `receipt-status.ts` antwortet darauf `unknown`, nicht
         * „kein Beleg". Ein fehlendes Feld und ein beantwortetes Nein sind
         * zwei verschiedene Dinge.
         *
         * Alles andere wird genauso defensiv gelesen wie `dailyIndex` seit
         * `0116`: `=== true` statt `Boolean(...)`, damit ein fehlendes Feld
         * `false` ergibt und nicht `undefined`, und `receiptStale` behält
         * seine drei Zustände, weil `null` hier etwas bedeutet.
         */
        statusKnown: r.status_known === true,
        hasSenderName: r.has_sender_name === true,
        hasSenderStreet: r.has_sender_street === true,
        hasSenderPostalCode: r.has_sender_postal_code === true,
        hasSenderCity: r.has_sender_city === true,
        hasOrigin: r.has_origin === true,
        hasAgreement: r.has_agreement === true,
        receiptNumber: r.receipt_number === null || r.receipt_number === undefined
          ? null : String(r.receipt_number),
        receiptIssuedAt: r.receipt_issued_at === null || r.receipt_issued_at === undefined
          ? null : String(r.receipt_issued_at),
        receiptRevision: r.receipt_revision === null || r.receipt_revision === undefined
          ? null : Number(r.receipt_revision),
        receiptStale: r.receipt_stale === true ? true
          : r.receipt_stale === false ? false
          : null,
      };
    });

    return {
      // The database already ordered it; sorting again is the guarantee that
      // the screen never inherits an accidental order.
      purchases: sortLedger(purchases),
      summary: {
        purchaseCount: Number(s.purchase_count ?? 0),
        itemCount: Number(s.item_count ?? 0),
        totalCost: Number(s.total_cost ?? 0),
        knownValue: Number(s.known_value ?? 0),
        knownItems: Number(s.known_items ?? 0),
        factor: summaryFactor(Number(s.total_cost ?? 0), Number(s.known_value ?? 0)),
        incomplete: s.incomplete === true,
      },
      counts: readCounts(root.classification),
    };
  },
);

/**
 * `series_code` → human label, from the canonical table.
 *
 * Eight rows, world-readable, and the same source `lib/catalog/queries.ts`
 * uses for every other screen that prints a series — so the Orderbuch says
 * `Spyro's Adventure` where the catalog says `Spyro's Adventure`, rather than
 * growing a second naming scheme.
 *
 * The code is the fallback, not a guess: if a figure names a series this table
 * does not have, showing `SA` is honest where inventing a label would not be.
 */
export const fetchSeriesLabels = cache(async (): Promise<Map<string, string>> => {
  const supabase = await createClient();
  const { data, error } = await supabase.from("series").select("code, label");
  if (error || !Array.isArray(data)) return new Map();
  return new Map(data.map((row) => [String(row.code), String(row.label)]));
});

export type PurchaseItem = {
  id: number;
  position: number;
  skyId: string | null;
  name: string;
  /** What the workbook called it. Provenance, shown only when it differs. */
  rawName: string | null;
  seriesCode: string | null;
  /** `Spyro's Adventure`, from `public.series`. The code when unknown. */
  seriesLabel: string | null;
  condition: string;
  state: ItemState;
  /** Frozen when booked, live otherwise — the database decides which. */
  marketPrice: number | null;
  priceIsFrozen: boolean;
  movementId: number | null;
  legacyConditionFlag: string | null;
  legacyBookedFlag: string | null;
  /**
   * The workbook line this item came from, NULL for a line the operator
   * entered here. Never shown — it decides whether removal may be offered
   * at all, which is the fourth refusal the database has always had (0064)
   * and the screen could not see until 0134.
   */
  sourceRow: number | null;
};

export type PurchaseDetail = {
  id: number;
  /** NULL when the date is not known yet. */
  purchasedAt: string | null;
  /** A deliberate test purchase (0063). */
  isTest: boolean;
  totalCost: number;
  currency: string;
  source: string;
  note: string | null;
  knownValue: number;
  knownItems: number;
  countedItems: number;
  bookedItems: number;
  factor: number | null;
  items: PurchaseItem[];
};

export const fetchPurchase = cache(async (id: number): Promise<PurchaseDetail | null> => {
  if (!(await canOperateSeller())) return null;
  const supabase = await createClient();
  const [{ data, error }, series] = await Promise.all([
    supabase.rpc("seller_purchase", { p_id: id }),
    fetchSeriesLabels(),
  ]);
  if (error || data === null || typeof data !== "object") return null;

  const root = data as Record<string, unknown>;
  const p = root.purchase as Record<string, unknown> | null;
  const v = root.value as Record<string, unknown> | null;
  if (!p) return null;

  return {
    id: Number(p.id),
    purchasedAt: p.purchased_at === null || p.purchased_at === undefined
      ? null : String(p.purchased_at),
    isTest: p.is_test === true,
    totalCost: Number(p.total_cost),
    currency: String(p.currency),
    source: String(p.source),
    note: (p.note as string) ?? null,
    knownValue: Number(v?.known_value ?? 0),
    knownItems: Number(v?.known_items ?? 0),
    countedItems: Number(v?.total_items ?? 0),
    bookedItems: Number(v?.booked_items ?? 0),
    factor: root.factor === null ? null : Number(root.factor),
    items: (Array.isArray(root.items) ? root.items : []).map((raw) => {
      const i = raw as Record<string, unknown>;
      return {
        id: Number(i.id),
        position: Number(i.position),
        skyId: (i.sky_id as string) ?? null,
        name: String(i.name ?? ""),
        rawName: (i.raw_name as string) ?? null,
        seriesCode: (i.series_code as string) ?? null,
        /*
         * CANONICAL, NOT PARSED. The label comes from `public.series` keyed by
         * the catalog row's own `series_code` — never from the raw Excel text,
         * the sky_id, or the workbook sheet. A non-figure has no series and
         * gets null, which the screen renders as a dash rather than inventing
         * a game for a portal.
         */
        seriesLabel: i.series_code
          ? series.get(String(i.series_code)) ?? String(i.series_code)
          : null,
        condition: String(i.condition),
        state: i.state as ItemState,
        marketPrice: i.market_price === null || i.market_price === undefined ? null : Number(i.market_price),
        priceIsFrozen: i.price_is_frozen === true,
        movementId: i.movement_id === null || i.movement_id === undefined ? null : Number(i.movement_id),
        legacyConditionFlag: (i.legacy_condition_flag as string) ?? null,
        legacyBookedFlag: (i.legacy_booked_flag as string) ?? null,
        sourceRow:
          i.source_row === null || i.source_row === undefined ? null : Number(i.source_row),
      };
    }),
  };
});

/**
 * Years that actually have purchases, for the filter.
 *
 * `any`, not the default `normal`: the year chips must offer 2026 even while
 * the Test view is on screen, otherwise choosing Test would silently remove
 * the only year its rows live in.
 */
export const fetchPurchaseYears = cache(async (): Promise<number[]> => {
  const { purchases } = await fetchLedger(undefined, undefined, undefined, "any");
  // Undated purchases contribute no year, by definition — they get their own
  // filter instead of inventing one.
  return [...new Set(purchases
    .filter((p): p is typeof p & { purchasedAt: string } => p.purchasedAt !== null)
    .map((p) => Number(p.purchasedAt.slice(0, 4))))].sort((a, b) => b - a);
});

/**
 * The catalog the add-item search runs over.
 *
 * `seller_import_catalog()` from `0052` already returns exactly this to a
 * seller operator — including rows hidden from the public catalog, which a
 * purchase may perfectly well contain. Reusing it means one authorization
 * story and one definition of "the catalog", not two.
 *
 * WAS 0117 GEÄNDERT HAT, UND WARUM DER FILTER HIER STEHT
 *
 * Die Funktion liefert weiter ALLE Zeilen — sie bedient auch den
 * Arbeitsmappen-Import, und dessen Namens-Matching muss eine ausgeblendete
 * Zeile finden können: eine Arbeitsmappe kennt die redaktionellen
 * Entscheidungen von heute nicht. Gefiltert wird deshalb hier, wo die
 * AUSWAHLLISTE entsteht — angeboten wird nur, was der Katalog auch anbietet.
 *
 * Beide Riegel, weil das ganze Projekt beide prüft: `is_active` ist
 * technisch, `catalog_visible` redaktionell (`0004`), und `shop_offers()`
 * verlangt seit `0006` ebenfalls beide. Vorher standen hier alle
 * Katalogzeilen zur Wahl, auch die ausgeblendeten — bei Eon's Elite hiess
 * das drei Einträge pro Figur, von denen zwei seit Langem nicht mehr
 * angeboten werden.
 */
export const fetchOrderbookCatalog = cache(
  async (): Promise<FigureChoice[]> => {
    if (!(await canOperateSeller())) return [];
    const supabase = await createClient();
    const [catalog, prices] = await Promise.all([
      supabase.rpc("seller_import_catalog"),
      /* Bild und Preis in einem Zug: `skylanders` ist weltlesbar, die Zeile
         wird ohnehin geholt, und der Kalkulator braucht beides. Aufgelöst
         wird über `imageSrc()` — dieselbe eine Stelle, die seit ADR-0046
         entscheidet, welche der drei Quellen gilt. */
      supabase.from("skylanders").select("sky_id, market_price, image_file, image_override_path"),
    ]);
    if (catalog.error || !Array.isArray(catalog.data)) return [];
    const facts = new Map(
      (Array.isArray(prices.data) ? prices.data : []).map((r) => {
        const row = r as {
          sky_id: string;
          market_price: number | string | null;
          image_file: string | null;
          image_override_path: string | null;
        };
        return [row.sky_id, {
          marketPrice: row.market_price === null ? null : Number(row.market_price),
          image: imageSrc({
            imageFile: row.image_file,
            imageOverridePath: row.image_override_path,
          }),
        }];
      }),
    );
    return (catalog.data as Record<string, unknown>[])
      /*
       * Nur gültige, angebotene Katalogzeilen. `catalog_visible` und
       * `is_active` kommen seit 0117 mit; `!== false` statt `!r.x` ist
       * Absicht — fehlt die Spalte, weil noch die alte Funktionsfassung
       * läuft (etwa zwischen Migration und Deployment), wird NICHTS
       * ausgefiltert und alles bleibt wie bisher.
       */
      .filter((r) => r.catalog_visible !== false && r.is_active !== false)
      .map((r) => {
        const fact = facts.get(String(r.sky_id));
        const raw = String(r.name);
        /* Fehlt `display_name`, ist der Rohname der Anzeigename — genau das
           Verhalten vor 0117. */
        const shown = r.display_name === undefined || r.display_name === null
          ? raw
          : String(r.display_name);
        return {
          skyId: String(r.sky_id),
          name: shown,
          rawName: raw,
          series: String(r.series_code),
          marketPrice: fact?.marketPrice ?? null,
          image: fact?.image ?? null,
        };
      });
  },
);
