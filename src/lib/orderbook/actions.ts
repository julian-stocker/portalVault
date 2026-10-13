/**
 * Writing the Orderbuch (ADR-0088).
 *
 * Every one of these is a thin pass-through to a seller-gated function. The
 * checks here are a courtesy so a denied click gets a sentence instead of a
 * stack trace; the database is what actually refuses.
 */
"use server";

import { revalidatePath } from "next/cache";

import { canOperateSeller } from "@/lib/auth/capabilities";
import { de } from "@/lib/i18n/de";
import { createClient } from "@/lib/supabase/server";
import { fetchPurchase, type PurchaseItem } from "./queries";

export type Result = { ok: true } | { ok: false; message: string };
export type BookResult = { ok: true; movementId: number } | { ok: false; message: string };

const paths = (id?: number) => (id ? ["/business/orderbuch", `/business/orderbuch/${id}`] : ["/business/orderbuch"]);

async function run(fn: string, args: Record<string, unknown>, id?: number): Promise<Result> {
  if (!(await canOperateSeller())) return { ok: false, message: de.admin.notAllowed };
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, message: orderbookMessage(error) };
  for (const p of paths(id)) revalidatePath(p);
  return { ok: true };
}

/**
 * Turns the database's refusals into sentences.
 *
 * These are rules, not faults: the operator is being told what to do next, so
 * a generic "could not be saved" would waste the explanation the function
 * already wrote.
 */
function orderbookMessage(error: { code?: string; message?: string }): string {
  const text = error.message ?? "";
  if (error.code === "42501") return de.admin.notAllowed;
  if (text.includes("already in inventory")) return de.business.orderbook.errors.alreadyBooked;
  if (text.includes("not a catalog figure")) return de.business.orderbook.errors.notAFigure;
  if (text.includes("damaged item")) return de.business.orderbook.errors.damaged;
  if (text.includes("never arrived")) return de.business.orderbook.errors.missing;
  /*
   * 0115/0116 — VIER ABLEHNUNGEN, DIE BISHER IN „konnte nicht gespeichert
   * werden" endeten.
   *
   * Jede davon ist eine Regel und keine Störung, also gehört ihr Grund auf
   * den Bildschirm. Die Reihenfolge ist geprüft: keines dieser Textstücke
   * kommt in einer der älteren Meldungen vor, und keine ältere Regel trifft
   * diese vier — sonst hätte die erste Übereinstimmung gewonnen und die
   * genauere verdrängt (`purchase-workbench.test.ts` hält das fest).
   *
   * `a damaged unit does not move into the showcase` ist dabei die Sperre
   * aus D4 und NICHT dieselbe Meldung wie `damaged item` oben: die eine
   * verbietet das Einbuchen, die andere den Umweg über die Vitrine.
   */
  if (text.includes("does not move into the showcase")) {
    return de.business.orderbook.errors.showcaseFromDamaged;
  }
  if (text.includes("only a catalog figure goes into the showcase")) {
    return de.business.orderbook.errors.showcaseNeedsFigure;
  }
  if (text.includes("a cost split needs the price of the figures")) {
    return de.business.orderbook.errors.splitNeedsItems;
  }
  /*
   * Die drei CHECKs der Aufteilung melden sich mit ihrem Namen im Text
   * (`violates check constraint "purchases_cost_split_adds_up"`). Ein
   * gemeinsamer Präfix trifft alle drei, und der Betreiber liest einen Satz
   * über Beträge statt über einen Constraint.
   */
  if (text.includes("purchases_cost_")) return de.business.orderbook.errors.costSplit;
  /*
   * DIE VIER ABLEHNUNGEN DES PLATZTAUSCHS (0116).
   *
   * Dieselbe Behandlung, die der Verkauf seit `0113` hat — bis hierher war
   * sie Paritätslücke: der Tausch ist neu, und seine vier Ablehnungen fielen
   * alle in „konnte nicht gespeichert werden". Drei davon heissen „der
   * Bildschirm ist veraltet" (der Platz ist weg, der Tag hat sich geändert,
   * die Zahl ist aus der Liste gefallen), eine „dieser Einkauf hat kein
   * Datum".
   */
  if (text.includes("no place to swap")) {
    return de.business.orderbook.errors.undatedHasNoPlace;
  }
  if (text.includes("no purchase holds that place")
      || text.includes("changed its date concurrently")
      || text.includes("a place in a day starts at one")) {
    return de.business.orderbook.errors.placeGone;
  }
  if (text.includes("historical")) return de.business.orderbook.errors.historical;
  if (text.includes("reverse those bookings")) return de.business.orderbook.errors.hasBookings;
  if (text.includes("before changing which figure")) return de.business.orderbook.errors.bookedRemap;
  // 0064. Distinct from `historical` above, which is about booking a whole
  // imported purchase; this one is about deleting a single workbook line.
  if (text.includes("legacy workbook")) return de.business.orderbook.errors.historicalItem;
  if (text.includes("at most 200 items")) return de.business.orderbook.errors.tooManyItems;
  if (text.includes("plausible range")) return de.business.orderbook.errors.dateRange;
  return de.admin.writeFailed;
}

/**
 * The items of one purchase, fetched when its row is expanded.
 *
 * ON DEMAND, NOT UP FRONT. Fifteen collapsed rows must not cost 561 item rows
 * of payload and DOM, and 2026 would make that 2 193. One expansion is one
 * query, and a collapsed ledger makes none.
 */
export async function loadPurchaseItems(
  id: number,
): Promise<{ ok: true; items: PurchaseItem[] } | { ok: false; message: string }> {
  if (!(await canOperateSeller())) return { ok: false, message: de.admin.notAllowed };
  const detail = await fetchPurchase(id);
  if (!detail) return { ok: false, message: de.admin.writeFailed };
  return { ok: true, items: detail.items };
}

/**
 * Assign, correct or clear a purchase date.
 *
 * `null` CLEARS IT, and that is the whole reason this is not
 * `updatePurchase`: there, null means "leave this field alone", which is right
 * for a partial update and makes clearing impossible to say. The database
 * function has the same shape for the same reason.
 *
 * It changes one column. Not the identity, not the fingerprint, not the items,
 * and never stock — so a date arriving three months late costs nothing.
 */
export async function setPurchaseDate(id: number, purchasedAt: string | null): Promise<Result> {
  return run("seller_set_purchase_date", { p_id: id, p_purchased_at: purchasedAt }, id);
}

/**
 * Creating a purchase and the figures in it, as ONE operation (0064).
 *
 * `items` is one element per physical unit — three Wash Bucklers are three
 * elements — and the database expands nothing: `seller_create_purchase_with_
 * items` inserts one `purchase_items` row each.
 *
 * ATOMIC, AND THAT IS WHY IT IS ONE CALL. The old path was create-then-add-
 * then-add, each its own request and its own transaction, so a failure on the
 * fifth figure left a purchase that exists and is wrong. Here the function
 * body is a single statement to PostgREST: an invalid figure anywhere takes
 * the purchase with it and the operator is looking at the same form they can
 * correct and resubmit.
 *
 * An empty list is legitimate and stays so — the purchase is then
 * `Unvollständig` (0063), which is a thing the owner may want on purpose.
 *
 * STOCKS NOTHING, whatever the list contains. `Einbuchen` on the individual
 * item is still the only path into inventory.
 */
/**
 * Die Kopfdaten eines Einkaufs, die seit `0115` dazugehören.
 *
 * Jedes Feld ist freiwillig: ein Einkauf, den jemand nur mit Datum und Summe
 * erfasst, bleibt gültig — er ist dann `Unvollständig` (0063), und das ist
 * ein Zustand, den der Betreiber bewusst will.
 *
 * `items`, `shipping` und `buyerProtection` gehören ZUSAMMEN. Entweder steht
 * die Aufteilung da und ergibt `totalCost`, oder sie steht nicht da;
 * `purchases_cost_split_adds_up` lehnt alles dazwischen ab, und zwar den
 * ganzen Einkauf statt der halben Erfassung.
 */
export type PurchaseHead = {
  platform?: string | null;
  sellerName?: string | null;
  items?: number | null;
  shipping?: number | null;
  buyerProtection?: number | null;
  paymentMethod?: string | null;
  externalRef?: string | null;
};

export async function createPurchaseWithItems(
  purchasedAt: string | null,
  totalCost: number,
  items: readonly { sky_id?: string; raw_name?: string }[],
  note?: string,
  isTest = false,
  head: PurchaseHead = {},
) {
  if (!(await canOperateSeller())) return { ok: false as const, message: de.admin.notAllowed };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_create_purchase_with_items", {
    p_purchased_at: purchasedAt, p_total_cost: totalCost, p_note: note ?? null,
    p_is_test: isTest, p_items: items,
    p_platform: head.platform ?? null,
    p_seller_name: head.sellerName ?? null,
    p_items_cost: head.items ?? null,
    p_shipping_cost: head.shipping ?? null,
    p_buyer_protection_cost: head.buyerProtection ?? null,
    p_payment_method: head.paymentMethod ?? null,
    p_external_ref: head.externalRef ?? null,
  });
  if (error || typeof data !== "number") {
    return { ok: false as const, message: orderbookMessage(error ?? {}) };
  }
  revalidatePath("/business/orderbuch");
  return { ok: true as const, id: data };
}

/**
 * Die Kopfdaten eines Einkaufs ändern (0053, erweitert in 0116).
 *
 * `undefined` heisst „nicht anfassen" — dieselbe Konvention wie überall hier,
 * und die Server-Funktion liest `NULL` genauso. Die Aufteilung zu ENTFERNEN
 * kann NULL nicht ausdrücken, dafür gibt es `clearCostSplit`: genau wie
 * `p_clear_date` beim Verkauf seit `0062`.
 */
export async function updatePurchase(
  id: number, purchasedAt?: string, totalCost?: number, note?: string,
  head: PurchaseHead & { clearCostSplit?: boolean } = {},
): Promise<Result> {
  return run("seller_update_purchase", {
    p_id: id,
    p_purchased_at: purchasedAt ?? null,
    p_total_cost: totalCost ?? null,
    p_note: note ?? null,
    p_platform: head.platform ?? null,
    p_seller_name: head.sellerName ?? null,
    p_items_cost: head.items ?? null,
    p_shipping_cost: head.shipping ?? null,
    p_buyer_protection_cost: head.buyerProtection ?? null,
    p_payment_method: head.paymentMethod ?? null,
    p_external_ref: head.externalRef ?? null,
    p_clear_cost_split: head.clearCostSplit ?? false,
  }, id);
}

/** Was aus dem Tauschen zurückkommt: der neue Platz, oder die Ablehnung. */
export type SwappedPlace =
  | { ok: true; moved: boolean; dailyIndex: number }
  | { ok: false; message: string };

/**
 * ZWEI EINKÄUFE TAUSCHEN IHREN PLATZ AM TAG (0116).
 *
 * Ein Aufruf, eine Transaktion. Der Server tauscht; hier wird nichts
 * umsortiert — der Platz, der zurückkommt, IST der neue Platz.
 */
export async function swapPurchaseDailyIndex(
  id: number, withIndex: number,
): Promise<SwappedPlace> {
  if (!(await canOperateSeller())) return { ok: false, message: de.admin.notAllowed };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_swap_purchase_daily_index", {
    p_id: id, p_with_index: withIndex,
  });
  if (error) return { ok: false, message: orderbookMessage(error) };
  for (const p of paths(id)) revalidatePath(p);
  const result = (data ?? {}) as { moved?: boolean; daily_index?: number };
  return {
    ok: true,
    moved: result.moved === true,
    dailyIndex: Number(result.daily_index ?? withIndex),
  };
}

export async function addPurchaseItem(
  purchaseId: number, skyId: string | null, rawName: string | null, condition = "loose",
): Promise<Result> {
  return run("seller_add_purchase_item", {
    p_purchase_id: purchaseId, p_sky_id: skyId, p_raw_name: rawName, p_condition: condition,
  }, purchaseId);
}

/**
 * Removing one item from an existing purchase (0053, hardened in 0064).
 *
 * For the ordinary correction: three figures were entered and the box held
 * two. The database refuses it once the item owns an inventory movement, and
 * refuses it outright for anything carrying legacy provenance — an imported
 * parent, the `reconciled_legacy` state, a workbook row number or either
 * legacy marker. The screen hides the control in those cases; the function is
 * what actually decides.
 */
export async function removePurchaseItem(itemId: number, purchaseId: number): Promise<Result> {
  return run("seller_remove_purchase_item", { p_item_id: itemId }, purchaseId);
}

export async function setPurchaseItemState(
  itemId: number, state: string, purchaseId: number,
): Promise<Result> {
  return run("seller_set_purchase_item_state", { p_item_id: itemId, p_state: state }, purchaseId);
}

/**
 * Die belegten Tagesplätze eines Einkaufs (0116).
 *
 * `seller_purchase()` liefert sie als `day_order` — die Plätze folgen aus den
 * NACHBARN desselben Tages, nicht aus der Zeile selbst, und deshalb kennt
 * `seller_orderbook_ledger()` sie nicht. Das Fenster holt sie beim Öffnen
 * nach; eine Lücke bleibt dabei sichtbar, statt mit `1…n` erschlossen zu
 * werden.
 */
export async function loadPurchaseDay(
  id: number,
): Promise<{ id: number; dailyIndex: number }[] | null> {
  if (!(await canOperateSeller())) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_purchase", { p_id: id });
  if (error || data === null || typeof data !== "object") return null;
  const rows = (data as { day_order?: unknown }).day_order;
  if (!Array.isArray(rows)) return null;
  return rows
    .map((raw) => raw as Record<string, unknown>)
    .map((row) => ({ id: Number(row.id), dailyIndex: Number(row.daily_index) }))
    .filter((row) => Number.isFinite(row.id) && Number.isFinite(row.dailyIndex));
}

/** Was eine Positionsaktion im Einkaufsbuch zurückgibt: die Ablehnung, oder
 *  der nachgelesene Zustand des ganzen Einkaufs. */
export type PurchaseItemResult =
  | { ok: true; items: PurchaseItem[] | null }
  | { ok: false; message: string };

/**
 * EINE POSITIONSAKTION — WIE `runItem` IM VERKAUFSBUCH, UND OHNE
 * `revalidatePath`.
 *
 * WARUM DAS EINE EIGENE FUNKTION IST.
 *
 * `bookPurchaseItem` und `setPurchaseItemState` darunter rufen
 * `revalidatePath`, und das kostet auf diesen Bildschirmen keinen
 * Cache-Eintrag — beide Routen sind dynamisch —, sondern einen vollständigen
 * Server-Render der GERADE ANGEZEIGTEN Route, den Next in dieselbe Antwort
 * legt. Für die Detailseite ist das richtig: dort ist eine Handlung eine
 * Handlung, und danach soll alles stimmen.
 *
 * Für das Einkaufsbuch war es der eigentliche Grund für die Wartezeit. Fünf
 * Positionen hintereinander einbuchen hiess fünf Server-Renders der ganzen
 * Liste. Diese Funktion liest stattdessen den EINEN Einkauf nach und gibt ihn
 * zurück; die eingeklappte Zeile holt sich das Verkaufsbuch gebündelt über
 * ein `router.refresh()`, wenn die letzte Aktion fertig ist.
 *
 * NICHT OPTIMISTISCH IM ERGEBNIS. Die Oberfläche sagt „läuft", nie
 * „eingebucht" — ein vorweggenommener Haken wäre eine Behauptung über den
 * Bestand, und die Lagerbuchung ist Geld. Was die Position danach IST,
 * entscheidet allein dieser nachgelesene Zustand.
 */
async function runPurchaseItem(
  fn: string, args: Record<string, unknown>, purchaseId: number,
): Promise<PurchaseItemResult> {
  if (!(await canOperateSeller())) return { ok: false, message: de.admin.notAllowed };
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, message: orderbookMessage(error) };

  /*
   * Der Bestand hat sich bewegt, also muss die Lagerseite es erfahren — aber
   * sie ist nicht die Seite, auf der der Betreiber steht. Ein
   * `revalidatePath` darauf rendert eine Route neu, die niemand ansieht.
   * Deshalb nur die Datenwahrheit zurück, und das Nachholen entscheidet die
   * Oberfläche.
   */
  const fresh = await fetchPurchase(purchaseId);
  return { ok: true, items: fresh === null ? null : fresh.items };
}

/** Einbuchen, schnell: für das Einkaufsbuch. Dieselbe RPC, dieselbe
 *  Idempotenz — ein zweiter Klick liefert dieselbe Bewegung zurück. */
export async function processBookPurchaseItem(
  itemId: number, purchaseId: number,
): Promise<PurchaseItemResult> {
  return runPurchaseItem("seller_book_purchase_item", { p_item_id: itemId }, purchaseId);
}

/** Beschädigt, Fehlt, Vitrine — die drei Enden aus dem Plus-Menü. */
export async function processPurchaseItemState(
  itemId: number, state: string, purchaseId: number,
): Promise<PurchaseItemResult> {
  return runPurchaseItem(
    "seller_set_purchase_item_state", { p_item_id: itemId, p_state: state }, purchaseId);
}

/**
 * Einbuchen.
 *
 * Deliberately NOT optimistic in the UI that calls it: a state flag is cheap
 * to reconcile and a stock movement is money. The caller waits for the
 * movement id, which is also what makes a double tap harmless — the second
 * call returns the first one's id rather than creating a second unit.
 */
export async function bookPurchaseItem(itemId: number, purchaseId: number): Promise<BookResult> {
  if (!(await canOperateSeller())) return { ok: false, message: de.admin.notAllowed };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_book_purchase_item", { p_item_id: itemId });
  if (error || typeof data !== "number") {
    return { ok: false, message: orderbookMessage(error ?? {}) };
  }
  for (const p of paths(purchaseId)) revalidatePath(p);
  revalidatePath("/business/inventory");
  return { ok: true, movementId: data };
}

export async function unbookPurchaseItem(itemId: number, purchaseId: number): Promise<BookResult> {
  if (!(await canOperateSeller())) return { ok: false, message: de.admin.notAllowed };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_unbook_purchase_item", { p_item_id: itemId });
  if (error || typeof data !== "number") {
    return { ok: false, message: orderbookMessage(error ?? {}) };
  }
  for (const p of paths(purchaseId)) revalidatePath(p);
  revalidatePath("/business/inventory");
  return { ok: true, movementId: data };
}

/**
 * Correcting which figure an item is (ADR-0088, `0054`).
 *
 * `skyId` NULL is the instruction "this is not a catalog figure", not an
 * omission — a portal keeps its name and its cost and simply stops pretending
 * to be a Skylander. `remember` saves the resolution so a recurring legacy
 * shorthand is only asked about once.
 */
export async function setPurchaseItemSky(
  itemId: number, skyId: string | null, purchaseId: number, remember = false,
): Promise<Result> {
  return run("seller_set_purchase_item_sky",
    { p_item_id: itemId, p_sky_id: skyId, p_remember: remember }, purchaseId);
}

/**
 * Marking a purchase as a test, or taking the mark away (0063).
 *
 * A classification, not a fact about the parcel: it changes which list the row
 * appears in and nothing else. No cost, no item, no date, no provenance, and
 * no stock — `seller_set_purchase_test` names none of those columns.
 */
export async function setPurchaseTest(id: number, isTest: boolean): Promise<Result> {
  return run("seller_set_purchase_test", { p_id: id, p_is_test: isTest }, id);
}

export async function deletePurchase(id: number): Promise<Result> {
  return run("seller_delete_purchase", { p_id: id });
}
