/**
 * The items of one external sale, and where its stock is held and spent.
 *
 * ZWEI DINGE PASSIEREN HIER MIT DEM LAGER, UND SIE SIND NICHT DASSELBE (0110).
 *
 *   RESERVIEREN hebt `reserved`. Das geschieht schon beim Anlegen einer
 *   Position — `seller_add_sale_item` versucht den Hold selbst — und erneut
 *   über `Reservieren`, wenn beim ersten Versuch nichts frei war. Die Figur
 *   verschwindet damit sofort aus `shop_offers()`, liegt aber weiter im
 *   Regal: `quantity` bleibt, wie es war.
 *
 *   AUSBUCHEN senkt `quantity`. Das ist `seller_book_sale_item`: es
 *   verbraucht den Hold und schreibt die kanonische `-1 sale_external`
 *   durch das Journal — nie ein Mengen-Update —, und es lehnt ab, wenn das
 *   Regal nicht deckt. Eine fremde Reservierung kann es nicht aufessen.
 *
 * `Ausbuchen` war bis `0109` die einzige Steuerung dieses Bildschirms, die
 * Inventory berührte. Sie ist es nicht mehr. Was unverändert gilt: es ist
 * die einzige, die `quantity` bewegt.
 *
 * `Ausbuchen` ist auch, wo die zwei Snapshots einfrieren: der Buy-In-Faktor
 * des Verkaufs und der Marktpreis der Position. Keiner wird beim Anlegen
 * genommen, weil keiner wahr ist, bevor die Ware wirklich geht.
 *
 * NEVER OPTIMISTIC. Every button waits for the database. A stock movement is
 * money; a row that says `Ausgebucht` before the ledger agrees is a lie that
 * costs a stocktake to find.
 *
 * EINE ZEILE WARTET, NICHT DER BILDSCHIRM.
 *
 * Hier stand ein einziges `useTransition`, und jeder Knopf jeder Position
 * hing an dessen `pending`. Während Position 1 buchte, waren die Knöpfe von
 * Position 2 bis 10 tot — und sie blieben es, bis Next die GANZE Route neu
 * gerendert hatte, weil die Server Action `revalidatePath` rief. Bei zehn
 * Positionen war das zehnmal klicken, warten, klicken, warten.
 *
 * Jetzt merkt sich der Bildschirm eine MENGE beschäftigter Zeilen. Gesperrt
 * ist nur, was gerade läuft; alles andere ist sofort wieder bedienbar. Next
 * schickt Server Actions pro Client nacheinander los, die Arbeit reiht sich
 * also serverseitig auf — aber der Betreiber muss nicht mehr vor dem
 * nächsten Klick warten.
 *
 * UND DER ZUSTAND KOMMT WEITER VOM SERVER. Die Aktion liefert in derselben
 * Antwort die frische `seller_sale`-Projektion zurück — dieselbe, aus der
 * die Seite rendert. Die einzige Annahme, die dieser Bildschirm selbst
 * trifft, ist „dieser Knopf ist gerade beschäftigt".
 */
"use client";

import { useCallback, useState } from "react";

import { ACTION_NEUTRAL, ACTION_PRIMARY } from "@/components/ui/action";
import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";
import {
  addSaleItem, announceSaleItemReturn, bookSaleItem, holdSaleItem, loadOrderbookFigures,
  receiveSaleItemReturn, removeSaleItem,
  restockSaleItem, shipSaleItem,
  returnSaleItem, setSaleItemNotShipped, setSaleItemSky, settleSaleItem,
  type ItemResult,
} from "@/lib/orderbook/sales-actions";
import {
  legacyOutcome, saleItemActions, saleItemEdits, saleItemHold, saleItemIndicator,
  type LegacyOutcome, type SaleItemHold,
} from "@/lib/orderbook/sales-view";
import { SALE_ITEM_COLUMNS, SaleIndicator } from "./sale-indicator";
import type { FigureChoice } from "@/lib/orderbook/figure-search";
import { FigureSearch } from "./figure-search";
import {
  LedgerItemHead, LedgerItemRow, LedgerTable,
} from "./ledger-table";

const copy = de.business.sales;

/** Outcome → the sentence the status dot reads out. */
const LEGACY_LABEL: Record<LegacyOutcome, keyof typeof de.business.sales.itemIndicator> = {
  shipped: "legacyShipped",
  not_shipped: "legacyNotShipped",
  returned: "legacyReturned",
  lost: "legacyLost",
  shipped_unreferenced: "legacyShippedUnreferenced",
  unresolved: "legacyUnresolved",
};

const book = de.business.orderbook;

/*
 * The track list comes from `sale-indicator.tsx` and is shared with the
 * ledger's expansion, so the two sale screens cannot drift apart. It is the
 * Einkauf list with one narrow cell in front — see SALE_ITEM_COLUMNS.
 *
 * The floor is the one number this screen owns, because it has no ledger
 * around it to inherit a width from. The six fixed tracks, the six gaps and
 * the padding come to 34.25rem; 42.5 leaves `Figur` a little over 8rem, which
 * is about twenty characters — the readable minimum `mobile-layout.test.ts`
 * holds every item table to.
 *
 * Es sinkt mit der `Serie`-Spur: sechs Rem weniger feste Breite heißt sechs
 * Rem weniger Boden. Der Gewinn gehört der Figurenspalte, nicht dem Rand —
 * bliebe der Boden stehen, hätte die Tabelle nur mehr Leerraum.
 */
const ITEM_MIN_WIDTH = "42.5rem";

/*
 * Der Schlüssel der beiden Aktionen, die zu keiner Position gehören:
 * Hinzufügen und die Figurensuche darunter. Negativ, weil jede echte
 * `sale_items.id` positiv ist — die Mengen können sich nicht überschneiden.
 */
const ADD_ITEM = -1;

export function SaleItems({ saleId, items, catalog, historical, internal,
                           frozen, cancelled, shipped = false }: {
  saleId: number;
  items: Record<string, unknown>[];
  /*
   * Der Figurenkatalog, falls der Aufrufer ihn schon hat.
   *
   * Die Detailseite übergibt ihn NICHT mehr: er kostet zwei Abfragen und
   * über 64 KB und wird nur zum Hinzufügen oder Umhängen gebraucht. Ohne
   * Prop lädt diese Liste ihn beim ersten Hineingreifen in das Suchfeld
   * selbst nach.
   */
  catalog?: readonly FigureChoice[];
  historical: boolean;
  /** A workbook sale nobody released. Narrower than `historical` (0071). */
  frozen?: boolean;
  /** The order was called off. */
  cancelled?: boolean;
  /** The order went out — a sale fact, which is why it arrives from above. */
  shipped?: boolean;
  internal: boolean;
}) {
  /** The line whose figure is being corrected, by item id. One at a time. */
  const [remapping, setRemapping] = useState<number | null>(null);
  /** Welche Zeilen gerade laufen. Nur diese sind gesperrt. */
  const [busy, setBusy] = useState<ReadonlySet<number>>(() => new Set());
  /** Die Ablehnung je Zeile. Zwei gleichzeitige Fehler überschreiben sich nicht. */
  const [failed, setFailed] = useState<ReadonlyMap<number, string>>(() => new Map());
  /*
   * Die Positionen, wie die Datenbank sie nach der letzten Aktion kennt.
   * `null` heißt „noch keine Aktion gelaufen", dann gilt, was der Server
   * beim Rendern mitgegeben hat.
   */
  const [fresh, setFresh] = useState<Record<string, unknown>[] | null>(null);
  /** Nachgeladener Katalog, falls der Aufrufer keinen übergeben hat. */
  const [figures, setFigures] = useState<readonly FigureChoice[] | null>(null);
  const [loadingFigures, setLoadingFigures] = useState(false);

  const rows = fresh ?? items;

  /**
   * Eine Aktion auf einer Zeile.
   *
   * `key` ist die `sale_items.id` — oder `ADD_ITEM` für die Suche darunter.
   * Ein zweiter Klick auf dieselbe Zeile, während sie läuft, wird verworfen;
   * eine andere Zeile ist davon nicht betroffen.
   */
  const act = (key: number, run: () => Promise<ItemResult>) => {
    if (busy.has(key)) return;
    setBusy((current) => new Set(current).add(key));
    setFailed((current) => { const next = new Map(current); next.delete(key); return next; });
    void (async () => {
      try {
        const result = await run();
        if (!result.ok) {
          setFailed((current) => new Map(current).set(key, result.message));
          return;
        }
        /*
         * Der autoritative Zustand, nicht ein geratener. Ein internes
         * Verkaufsobjekt zeigt die Positionen der Bestellung und hat hier
         * ohnehin keine Aktion — dessen Form käme aus `order.lines` und
         * nicht aus `items`, deshalb wird sie nicht ersetzt.
         */
        const next = result.sale?.items;
        if (!internal && Array.isArray(next)) setFresh(next as Record<string, unknown>[]);
      } finally {
        setBusy((current) => { const next = new Set(current); next.delete(key); return next; });
      }
    })();
  };

  /*
   * Der Katalog, beim ersten Hineingreifen in die Suche.
   *
   * Angehängt an `onFocus` der umgebenden Kästen: Fokus steigt in React auf,
   * also braucht die Suche selbst dafür keinen neuen Handler. `MIN_QUERY`
   * ist 2 — der Katalog ist da, bevor das erste Ergebnis gezeigt werden
   * dürfte. Einmal geladen, bleibt er.
   */
  const ensureFigures = useCallback(() => {
    if (catalog !== undefined || figures !== null || loadingFigures) return;
    setLoadingFigures(true);
    void loadOrderbookFigures()
      .then((loaded) => setFigures(loaded))
      .finally(() => setLoadingFigures(false));
  }, [catalog, figures, loadingFigures]);

  const available = catalog ?? figures ?? [];
  /** Die offenen Ablehnungen, mit der Position davor, soweit bekannt. */
  const problems = [...failed].map(([key, text]) => {
    const row = rows.find((item) => Number(item.id) === key);
    const at = row?.position;
    return { key, text: at === null || at === undefined ? text : `#${String(at)} · ${text}` };
  });

  return (
    <section className="mt-6">
      <h2 className="text-sm font-medium">{book.itemColumns.figure}</h2>
      {problems.length > 0 ? (
        <div role="alert" className="mt-2 flex flex-col gap-1 rounded-sky-md bg-surface px-3 py-2 text-sm ring-1 ring-border/70">
          {problems.map((problem) => <p key={problem.key}>{problem.text}</p>)}
        </div>
      ) : null}

      <LedgerTable itemColumns={SALE_ITEM_COLUMNS} minWidth={ITEM_MIN_WIDTH}>
        <LedgerItemHead>
          {/*
            THE SAME SIX COLUMNS AN EXPANDED PURCHASE HAS. `Bestand` and
            `Retoure` stay merged into one status — a row could otherwise
            read `Ausgebucht` and `Wieder eingelagert` at once and leave the
            reader to work out which was true now — and `#` and `Serie` have
            their own tracks instead of hiding in the figure cell's tooltip,
            where a phone cannot reach them.
          */}
          {/* The indicator column has no heading: a word would be wider
              than the column and would claim to be the status, which is
              five columns along and spelled out. The dot names itself
              through its aria-label. */}
          <span aria-hidden="true" />
          <span>#</span>
          <span>{book.itemColumns.series}</span>
          <span>{copy.itemColumns.figure}</span>
          <span className="text-right">{copy.itemColumns.marketValue}</span>
          <span className="text-center">{copy.itemColumns.status}</span>
          <span className="text-right">{copy.itemColumns.action}</span>
        </LedgerItemHead>

        <ul className="divide-y divide-border/40">
          {rows.length === 0 ? (
            <li className="px-3 py-3 text-sm text-muted">{copy.noItems}</li>
          ) : rows.map((item) => {
            const can = saleItemActions(item as never, {
              frozen: frozen ?? historical, cancelled: cancelled ?? false, shipped,
              historical,
            });
            /*
             * What the workbook recorded for this line. It decides the status
             * of an imported row outright — `settled_at` is our bookkeeping,
             * not a statement about the object (0087).
             */
            const derived = can.status === "open" || can.status === "shipped"
              || can.status === "settled" || can.status === "not_shipped";
            const outcome = historical && derived ? legacyOutcome(item as never) : null;
            const edits = saleItemEdits(item as never, { historical, internal });
            const itemId = Number(item.id);
            const id = Number(item.id);
            /* One label per state, and the tick only where a movement is. */
            const strong = can.status === "outbooked" || can.status === "restocked";
            const working = busy.has(id);
            /*
             * DER HOLD (0110). `seller_sale` liefert `held` und
             * `stock_available`; die Bewertung macht `saleItemHold`, damit sie
             * an einer Stelle steht und dort, wo sie getestet werden kann.
             */
            const hold: SaleItemHold = saleItemHold(item as never);
            const holdLabel = hold === "held" ? copy.hold.held
              : hold === "no_stock" ? copy.hold.noStock
                : hold === "no_inventory" ? copy.hold.noInventory
                  : null;
            const holdHint = hold === "held" ? copy.hold.heldHint
              : hold === "no_stock" ? copy.hold.noStockHint
                : hold === "no_inventory" ? copy.hold.noInventoryHint
                  : undefined;
            const run = (fn: () => Promise<ItemResult>) => () => act(id, fn);
            const primary: Record<string, () => void> = {
              ship: run(() => shipSaleItem(id, saleId)),
              book: run(() => bookSaleItem(id, saleId)),
              announce_return: run(() => announceSaleItemReturn(id, saleId, true)),
              /* „Bestätigen": Wareneingang und Einbuchung in einem Aufruf (0092). */
              mark_returned: run(() => receiveSaleItemReturn(id, saleId)),
              restock: run(() => restockSaleItem(id, saleId)),
              settle: run(() => settleSaleItem(id, saleId, true)),
              unsettle: run(() => settleSaleItem(id, saleId, false)),
              unmark_not_shipped: run(() => setSaleItemNotShipped(id, saleId, false)),
            };
            const quiet = can.primary === "unsettle" || can.primary === "unmark_not_shipped"
              || can.primary === "announce_return";
            return (
              <LedgerItemRow key={String(item.id)}>
                <SaleIndicator
                  indicator={saleItemIndicator(can.status, shipped, { historical, outcome })}
                  label={outcome !== null
                    ? copy.itemIndicator[LEGACY_LABEL[outcome]]
                    : can.heldForReconciliation
                      ? copy.itemIndicator.legacyPending
                      : can.status === "outbooked" && !shipped
                        ? copy.itemIndicator.outbookedUnshipped
                        : copy.itemIndicator[can.status]} />
                <span className="tabular-nums text-xs text-muted">
                  {item.position === null || item.position === undefined
                    ? "—" : String(item.position)}
                </span>
                {/* A dash for a non-figure: a portal has no Skylanders
                    series, and inventing one would be worse than a blank. */}
                <span className="truncate text-xs text-muted">
                  {item.series_code ? String(item.series_code) : "—"}
                </span>
                <span className="break-words" title={String(item.name ?? item.raw_name ?? "")}>
                  {String(item.name ?? item.raw_name ?? "")}
                </span>
                <span className="ob-money text-right tabular-nums">
                  {item.market_price === null || item.market_price === undefined
                    ? "—" : formatPrice(Number(item.market_price))}
                </span>
                <span className={`min-w-0 text-center text-xs ${strong ? "text-fg" : "text-muted"}`}
                      title={can.status === "settled" ? copy.settleHint
                        : can.status === "not_shipped" ? copy.notShippedItemHint : undefined}>
                  <span className="block truncate">
                    {outcome !== null ? copy.legacyStates[outcome] : copy.itemStates[can.status]}
                  </span>
                  {/*
                    Der Hold steht UNTER dem Zustand, nicht daneben: es sind
                    zwei verschiedene Aussagen — was mit der Position passiert
                    ist, und ob sie gerade Bestand hält.
                  */}
                  {holdLabel !== null ? (
                    <span className="block truncate text-muted" title={holdHint}>
                      {holdLabel}
                    </span>
                  ) : null}
                </span>
                <span className="flex items-center justify-end gap-2 text-right">
                  {/* Only what the server would accept. An impossible button
                      invites a click that ends in a rule the screen knew. */}
                  {/* Held, not refused: the database would accept it, and
                      the reconciled stock already contains its effect. */}
                  {can.heldForReconciliation ? (
                    <span className="text-xs text-muted" title={copy.errors.heldForReconciliation}>
                      {copy.itemActionHeld}
                    </span>
                  ) : null}
                  {can.primary ? (
                    <button type="button" disabled={working} onClick={primary[can.primary]}
                            className={quiet
                              ? "min-h-9 px-2 text-xs text-muted underline underline-offset-2 disabled:opacity-50"
                              : `${can.primary === "book" || can.primary === "ship"
                                    ? ACTION_PRIMARY : ACTION_NEUTRAL} min-h-9 w-auto px-2 text-xs disabled:opacity-50`}>
                      {copy.itemActionLabels[can.primary]}
                    </button>
                  ) : null}
                  {/*
                    RESERVIEREN (0110) — der zweite Versuch.
                    Der erste läuft beim Anlegen von selbst. Dieser ist für
                    danach: die Figur war nicht da, jetzt ist sie da. Bei
                    `no_inventory` steht er nicht, weil es nichts zu halten
                    gibt, solange die Lagerzeile fehlt.
                  */}
                  {hold === "holdable" || hold === "no_stock" ? (
                    <button type="button" disabled={working}
                            title={copy.hold.actionHint}
                            onClick={() => act(id, () => holdSaleItem(id, saleId))}
                            className="min-h-9 text-xs text-muted underline underline-offset-2 disabled:opacity-50">
                      {copy.hold.action}
                    </button>
                  ) : null}
                  {/* The one secondary: a parcel can go out without a piece
                      in it, and then nothing is booked because nothing left. */}
                  {/*
                    STORNIEREN — das kleine × neben „Verschickt".
                    Zwei Wege aus einer offenen Position: verschickt (und
                    ausgebucht) oder storniert (und nie bewegt). Ein Klick,
                    keine Rückfrage: geschrieben wird `not_shipped_at` über
                    den bestehenden Weg — keine Bewegung, kein Bestand —, und
                    der Rückweg steht danach als „Rückgängig" dauerhaft in
                    derselben Spalte. Eine Ja/Nein-Stufe sicherte hier nichts
                    ab, was nicht ohnehin in einem Klick umkehrbar wäre.
                  */}
                  {can.canNotShip ? (
                    <button type="button" disabled={working}
                            title={copy.notShippedItemHint}
                            aria-label={copy.markNotShippedItem}
                            onClick={() => act(id, () => setSaleItemNotShipped(id, saleId, true))}
                            className="flex size-9 shrink-0 items-center justify-center rounded-sky-md text-sm text-muted ring-1 ring-border/70 hover:text-fg hover:ring-fg/30 disabled:opacity-40">
                      ×
                    </button>
                  ) : null}
                  {/* A line that never left the shelf may simply be wrong:
                      the wrong figure, or one figure too many. Both are gone
                      the moment it is booked out — from then on the ledger
                      describes it and only a return or a correction may. */}
                  {edits.canRemap ? (
                    <button type="button" disabled={working}
                            aria-expanded={remapping === itemId}
                            onClick={() => {
                              ensureFigures();
                              setRemapping(remapping === itemId ? null : itemId);
                            }}
                            className="min-h-9 text-xs text-muted underline underline-offset-2 disabled:opacity-50">
                      {copy.changeFigure}
                    </button>
                  ) : null}
                  {edits.canRemove ? (
                    <button type="button" disabled={working}
                            onClick={() => act(itemId, () => removeSaleItem(itemId, saleId))}
                            className="min-h-9 text-xs text-muted underline underline-offset-2 disabled:opacity-50">
                      {copy.detailsModal.remove}
                    </button>
                  ) : null}
                </span>
              </LedgerItemRow>
            );
          })}
        </ul>
      </LedgerTable>

      {/*
        The correction panel, below the table rather than inside a row: the
        item list is a grid with fixed columns and a search box does not fit
        one. It names the line it belongs to, so there is no doubt which.
      */}
      {remapping !== null ? (() => {
        const target = rows.find((i) => Number(i.id) === remapping);
        const name = String(target?.name ?? target?.raw_name ?? "");
        return (
          <div onFocus={ensureFigures}
               className="mt-3 rounded-sky-lg bg-surface/60 p-3 ring-1 ring-border/70">
            <p className="mb-1 text-xs text-muted">{copy.changeFigureOne(name)}</p>
            <FigureSearch
              catalog={available}
              autoFocus
              loading={loadingFigures}
              disabled={busy.has(remapping)}
              label={copy.changeFigureOne(name)}
              onCancel={() => setRemapping(null)}
              onSelect={(choice) => act(remapping, async () => {
                const r = await setSaleItemSky(remapping, choice.skyId, saleId);
                if (r.ok) setRemapping(null);
                return r;
              })}
            />
          </div>
        );
      })() : null}

      {/*
        An internal sale takes its items from the order — the database refuses
        to add one — and a historical sale is a reconstruction, not a workbench.
      */}
      {internal || historical ? (
        <p className="mt-2 text-xs text-muted">
          {internal ? copy.commerceOwned : copy.detailsModal.imported}
        </p>
      ) : (
        <div onFocus={ensureFigures}
             className="mt-3 rounded-sky-lg bg-surface/60 p-3 ring-1 ring-border/70">
          <p className="mb-1 text-xs text-muted">{copy.itemSearch}</p>
          {/* The same picker the create form and the Einkauf use. Selecting a
              result adds ONE physical unit; the same figure may be added
              again, because two copies are two objects. */}
          {/*
            UND WAS IN KEINEM KATALOG STEHT, geht denselben Weg wie beim
            Anlegen: findet die Suche nichts, übernimmt sie den getippten
            Namen als `raw_name` — ohne `sky_id`, also ohne Lagerbezug,
            ohne Reservierung und ohne mögliche Bewegung (`0059`,
            `sale_items_movement_needs_figure`). Ein Portal, das beim
            Anlegen vergessen wurde, muss nicht als Figur erfunden werden.
          */}
          <FigureSearch
            catalog={available}
            loading={loadingFigures}
            disabled={busy.has(ADD_ITEM)}
            onSelect={(choice) =>
              act(ADD_ITEM, () => addSaleItem(saleId, choice.skyId, null, "loose"))}
            onFree={(name) =>
              act(ADD_ITEM, () => addSaleItem(saleId, null, name, "loose"))}
          />
          <p className="mt-2 text-xs text-muted">{copy.create.stockHint}</p>
        </div>
      )}

    </section>
  );
}
