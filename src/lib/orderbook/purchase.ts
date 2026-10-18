/**
 * What a purchase is worth, and what that is worth saying (ADR-0088).
 *
 * Pure: no database, no browser. The same arithmetic the SQL does, so a screen
 * can recompute a factor without a round trip and a test can check the edges
 * without a fixture.
 */

/** The states one physical thing can be in. Mirrors purchase_items_state_known. */
export const ITEM_STATES = [
  "ordered",
  "arrived",
  "damaged",
  "missing",
  "booked",
  "reconciled_legacy",
  /*
   * The ending for something that is not a catalog figure (0069). A portal
   * arrived and is accounted for; it has no place in figure inventory, so
   * `booked` — which needs a sky_id and writes a movement — can never be
   * its ending. The database refuses `settled` for any row that HAS a
   * sky_id, so this cannot become a way past the inventory ledger.
   */
  "settled",
  /*
   * DIE VITRINE (0115, Entscheidung D1).
   *
   * Physisch da, einwandfrei, und dem Inhaber — nicht dem Shop. Sie trägt
   * KEINE Lagerbewegung, und genau das ist die Zusicherung: ohne Lagerzeile
   * gibt es kein Listing-Flag, das sie verkaufbar machen könnte.
   *
   * Im Faktor zählt sie mit VOLLEM Marktwert (D3) — sie existiert und ist
   * etwas wert, sie steht nur nicht zum Verkauf. Der Weg zurück in den Shop
   * ist `seller_book_purchase_item`, also eine echte Buchung mit Beleg.
   */
  "showcase",
] as const;
export type ItemState = (typeof ITEM_STATES)[number];

/**
 * Was das Plus-Menü einer offenen Position anbietet.
 *
 * `booked` steht nicht dabei: Bestand entsteht über `Einbuchen`, das eine
 * Lagerbewegung schreibt. `settled` auch nicht — es gilt nur für
 * Nicht-Katalogartikel und läuft über `canSettle`. `ordered`/`arrived` sind
 * keine Menüpunkte, sondern der Weg ZURÜCK aus einer Fehlklassifizierung.
 */
export const QUICK_STATES: readonly ItemState[] =
  ["ordered", "arrived", "damaged", "missing", "showcase"];

/**
 * Die drei Enden, die das Plus-Menü einer offenen Figur anbietet.
 *
 * In dieser Reihenfolge, und sie ist keine Geschmacksfrage: `damaged` und
 * `missing` kosten Marktwert (D4), `showcase` nicht (D3). Das Gefährliche
 * steht vorn, damit niemand es übersieht.
 */
export const EXTRA_ENDINGS: readonly ItemState[] = ["damaged", "missing", "showcase"];

/**
 * Trägt dieser Zustand 0 EUR in den Faktor (Entscheidung D4)?
 *
 * DIE EINE STELLE, DIE DAS ENTSCHEIDET. `valuePurchase` unten fragt sie, und
 * `purchase_market_value()` in `0116` stellt dieselbe Frage in SQL. Zwei
 * Listen wären zwei Antworten darüber, was ein Paket noch wert ist.
 *
 * SkyIsles bietet ausschliesslich einwandfreie Figuren an. Eine beschädigte
 * wird nie verkauft, eine fehlende ist nicht da — beide sind für den Shop
 * nichts wert. Die KOSTEN bleiben davon unberührt; sie stehen in
 * `purchases.total_cost` und werden von keiner Zustandsänderung angefasst.
 * Genau dadurch steigt der Faktor, statt den Verlust zu verstecken.
 */
export function creditsNoValue(state: ItemState): boolean {
  return state === "damaged" || state === "missing";
}

/**
 * Whether this item can be accepted into stock right now.
 *
 * `damaged` and `missing` are deliberately excluded: a damaged figure is not
 * sellable and one that never arrived is not present. Both stay on the
 * purchase — the money was still spent — but neither reaches the shelf without
 * the operator first saying it is in fact fine.
 *
 * `showcase` IS included (0115, D1). Eine Vitrinenfigur ist einwandfrei und
 * physisch da; sie gehörte nur dem Inhaber. Sie dem Shop zu übergeben ist
 * eine gewöhnliche Einbuchung mit gewöhnlichem Beleg — und der einzige Weg
 * aus der Vitrine heraus. Ohne diesen Zweig wäre „Vitrine" eine Sackgasse
 * ohne Ausgang, und D1 verlangt ausdrücklich das Gegenteil.
 *
 * `seller_book_purchase_item()` lehnt `damaged` und `missing` auch
 * serverseitig ab. Dies hier hält nur den Knopf von einem Druck fern, der
 * scheitern würde.
 */
export function canBook(item: { state: ItemState; skyId: string | null }): boolean {
  if (item.skyId === null) return false;
  return item.state === "ordered" || item.state === "arrived" || item.state === "showcase";
}

/**
 * Darf diese Position in die Vitrine?
 *
 * Nur eine KATALOGFIGUR. Für ein Portal wäre „Vitrine" eine Zusicherung ohne
 * Inhalt: es hat keinen Katalogpreis, trüge also 0 EUR bei — und dann sagt
 * `settled` dasselbe ehrlicher. `seller_set_purchase_item_state` weist es
 * ebenfalls ab (0116).
 *
 * Aus `booked` führt der Weg nicht hierher: dort liegt eine Lagerbewegung,
 * und die wird zurückgenommen, nicht umetikettiert.
 *
 * ---------------------------------------------------------------------------
 * UND AUS `damaged` ODER `missing` AUCH NICHT — DIREKT JEDENFALLS NICHT.
 *
 * Zuerst stand hier auch „beschädigt" und „fehlt": eine falsch
 * klassifizierte Figur sollte sich in die Vitrine korrigieren lassen. Das
 * öffnete aber einen zweiten Weg in den Verkaufsbestand, denn aus der
 * Vitrine DARF eingebucht werden (D1):
 *
 *     damaged  ->  showcase  ->  booked
 *
 * Zwei bewusste Klicks, und am Ende steht eine beschädigt verzeichnete Figur
 * im Shopbestand. Genau das verbietet D4 ausdrücklich. Der eine
 * nachvollziehbare Weg zurück ist `arrived` — „sie ist in Ordnung" —, und
 * von dort führt jeder weitere Schritt offen weiter. `showcase` wäre ein
 * Umweg, der dieselbe Aussage versteckt.
 *
 * `seller_set_purchase_item_state` lehnt denselben Sprung serverseitig ab.
 */
export function canShowcase(item: { state: ItemState; skyId: string | null }): boolean {
  if (item.skyId === null) return false;
  return item.state === "ordered" || item.state === "arrived";
}

/**
 * Darf diese Position ihr Ende überhaupt noch ändern?
 *
 * Die Frage, die das Plus-Menü stellt — und sie ist weiter als `canShowcase`:
 * eine beschädigte Figur darf nicht in die Vitrine, muss sich aber
 * zurücknehmen lassen. Ohne diese Unterscheidung wäre „beschädigt" eine
 * Sackgasse, aus der nur noch eine Migration herausführt.
 *
 * Nein für ein Nicht-Katalogartikel (dort heisst das Ende `settled`), für
 * eine Lagerposition (erst die Buchung zurücknehmen) und für eine
 * Arbeitsmappenzeile (sie ist ein Protokoll).
 */
export function canChangeEnding(item: { state: ItemState; skyId: string | null }): boolean {
  if (item.skyId === null) return false;
  return item.state !== "booked" && item.state !== "reconciled_legacy"
    && item.state !== "settled";
}

/**
 * WELCHE Enden dieses Menü anbietet — abhängig davon, wo die Position steht.
 *
 *   offen (`ordered`/`arrived`)   die drei Enden aus `EXTRA_ENDINGS`.
 *   Vitrine                       zurück in den Ablauf, oder doch ein
 *                                 Schaden: alles ausser der Vitrine selbst.
 *   beschädigt / fehlt            NUR `arrived`. Das ist die eine bewusste
 *                                 Korrektur („sie ist doch in Ordnung"),
 *                                 und sie führt nicht an der offenen Liste
 *                                 vorbei. Kein Weg direkt in die Vitrine,
 *                                 denn aus der Vitrine darf eingebucht
 *                                 werden — siehe `canShowcase`.
 */
export function endingsFor(state: ItemState): readonly ItemState[] {
  if (state === "damaged" || state === "missing") return ["arrived"];
  if (state === "showcase") return ["arrived", "damaged", "missing"];
  return EXTRA_ENDINGS;
}

/**
 * Welche Quickbox-Knöpfe die Detailseite für DIESE Position zeigt.
 *
 * Gefiltert aus `QUICK_STATES`, damit es keine dritte Liste von Zuständen
 * gibt — die Reihenfolge der Knöpfe bleibt damit überall dieselbe.
 *
 *   kein Katalogartikel   `Bestellt`/`Angekommen`. Für ein Portal bedeuten
 *                         „beschädigt" und „Vitrine" nichts; sein Ende heisst
 *                         `settled` und hat seinen eigenen Knopf.
 *   beschädigt / fehlt    NUR `Angekommen` — und die Oberfläche stellt diesen
 *                         einen Knopf hinter eine ausdrückliche Korrektur,
 *                         statt ihn neben den anderen anzubieten (D4).
 *   sonst                 `Bestellt`, `Angekommen`, die Enden aus
 *                         `endingsFor` und immer der aktuelle Zustand selbst,
 *                         damit die Position sieht, wo sie steht.
 */
export function quickStatesFor(
  item: { state: ItemState; skyId: string | null },
): readonly ItemState[] {
  if (item.skyId === null) {
    return QUICK_STATES.filter((s) => s === "ordered" || s === "arrived");
  }
  if (creditsNoValue(item.state)) return ["arrived"];
  const endings = endingsFor(item.state);
  return QUICK_STATES.filter((s) => s === "ordered" || s === "arrived"
    || s === item.state || endings.includes(s));
}

/**
 * Whether this item can be marked `Erledigt` right now (0069).
 *
 * THE MIRROR IMAGE OF `canBook`, and deliberately not its negation.
 *
 *   a catalog figure   never. It ends by being booked, and offering any
 *                      other ending would be offering a way to close a
 *                      position while the stock it represents goes missing.
 *                      The database refuses it too; this only keeps the
 *                      button away from a press that would fail.
 *   arrived only       `Bestellt -> Angekommen -> Erledigt`. Filing away
 *                      something that has not turned up yet would be a
 *                      statement nobody can make.
 */
export function canSettle(item: { state: ItemState; skyId: string | null }): boolean {
  if (item.skyId !== null) return false;
  return item.state === "arrived";
}

export type ValuedItem = {
  state: ItemState;
  /** Frozen price if booked, live catalog price if not, null if neither exists. */
  marketPrice: number | null;
};

export type PurchaseValue = {
  /** Sum over the items whose value is known. */
  knownValue: number;
  knownItems: number;
  /**
   * Items counted at all.
   *
   * SEIT 0116 JEDE POSITION. Vorher fielen `missing`-Zeilen heraus, und damit
   * fiel aus der Übersicht auch der Grund heraus, warum der Faktor gestiegen
   * ist. Eine fehlende Figur IST Teil des Pakets — sie ist nur nichts wert.
   */
  countedItems: number;
  /** Items counted but with no price. */
  unknownItems: number;
  /** Positionen, die 0 EUR beitragen: beschädigt oder fehlend (D4). */
  worthlessItems: number;
  /** cost / knownValue, or null when nothing is known. */
  factor: number | null;
  /** factor × 100, rounded to one decimal. */
  percent: number | null;
  /** True when the figure describes every counted item. */
  complete: boolean;
};

/**
 * Value a purchase.
 *
 * UNKNOWN IS NOT ZERO. A figure with no catalog price contributes nothing to
 * the sum and one to `unknownItems`, so the screen can say "Faktor 0,40 · 2
 * Artikel ohne Marktpreis" rather than quietly presenting a factor computed
 * over less than the parcel.
 *
 * A market value of zero yields `null`, not infinity: "we do not know what this
 * is worth" and "this is worth nothing" are different statements and only one
 * of them is ever true here.
 *
 * ---------------------------------------------------------------------------
 * UND SEIT 0116: NULL EURO IST AUCH EINE ANTWORT (Entscheidung D4).
 *
 * `damaged` und `missing` tragen 0 EUR bei und bleiben trotzdem GEZÄHLT. Das
 * ist der Unterschied zu „unbekannt": bei einer beschädigten Figur wissen wir
 * sehr genau, was sie für den Shop wert ist, nämlich nichts. Sie gilt deshalb
 * als `known` — täte sie es nicht, stünde jedes Paket mit einer beschädigten
 * Figur für immer auf „unvollständig".
 *
 * Die KOSTEN bleiben unangetastet. `totalCost` kommt unverändert herein, und
 * genau dadurch steigt der Faktor: 100 EUR auf 90 EUR verwertbaren Marktwert
 * sind 1,111 — der Verlust verschwindet nicht, er wird teuer.
 */
export function valuePurchase(totalCost: number, items: readonly ValuedItem[]): PurchaseValue {
  /* Jede Position zählt. Keine fällt mehr aus der Übersicht. */
  const counted = items;
  const worthless = counted.filter((i) => creditsNoValue(i.state));
  /* Bekannt ist ein Preis — oder die Regel, die 0 EUR sagt. */
  const known = counted.filter((i) => creditsNoValue(i.state) || i.marketPrice !== null);
  const knownValue = counted.reduce(
    (sum, i) => sum + (creditsNoValue(i.state) ? 0 : i.marketPrice ?? 0), 0);
  const factor = knownValue > 0 ? totalCost / knownValue : null;

  return {
    knownValue: Math.round(knownValue * 100) / 100,
    knownItems: known.length,
    countedItems: counted.length,
    unknownItems: counted.length - known.length,
    worthlessItems: worthless.length,
    factor: factor === null ? null : Math.round(factor * 10000) / 10000,
    percent: factor === null ? null : Math.round(factor * 1000) / 10,
    complete: counted.length > 0 && known.length === counted.length,
  };
}

/**
 * Progress through a parcel.
 *
 * `booked` counts only units that actually own an inventory movement — the
 * same thing `purchase_market_value()` counts, so the two can never tell
 * different stories about one purchase.
 *
 * `settled` is the wider question the ledger row wants: how much of this
 * parcel still needs a decision. A historical row needs none — it was
 * reconciled long ago — so it is settled without being booked. The pilot made
 * the difference visible: 14 historical items displayed as "0 von 14
 * eingebucht" read as fourteen pieces of outstanding work.
 */
export function bookingProgress(items: readonly { state: ItemState }[]): {
  booked: number;
  settled: number;
  open: number;
  total: number;
} {
  const booked = items.filter((i) => i.state === "booked").length;
  /*
   * ERLEDIGT HEISST: HIER IST NICHTS MEHR ZU TUN.
   *
   * SEIT 0116 GEHÖREN FÜNF ZUSTÄNDE DAZU, nicht zwei. `damaged`, `missing`,
   * `showcase` und `settled` sind Enden — der Betreiber hat entschieden, und
   * keine Handlung steht mehr aus. Sie als offen zu zählen war genau der
   * Widerspruch, den `open_count` in `seller_orderbook_ledger` hatte: die
   * Zahl sagte „noch Arbeit", der Wahrheitswert `is_open` daneben sagte nein.
   *
   * Offen bleiben `ordered` und `arrived`, und nur sie.
   */
  const settled = items.filter((i) =>
    i.state === "booked" || i.state === "reconciled_legacy"
    || i.state === "settled" || i.state === "showcase"
    || i.state === "damaged" || i.state === "missing").length;
  return { booked, settled, open: items.length - settled, total: items.length };
}

/** True when this purchase came out of the legacy workbook. */
export function isHistorical(source: string): boolean {
  return source === "excel_order_2026";
}

/**
 * What the item-level correction controls may touch (0064).
 *
 * THE SCREEN AND THE DATABASE SAY THE SAME THING, and the database is the one
 * that decides. `seller_remove_purchase_item` refuses every case below; this
 * exists so the control is not offered in the first place, because an action
 * that is always refused is worse than an absent one.
 */
export type CorrectableItem = {
  state: ItemState;
  /** Present exactly when this unit owns an inventory movement. */
  movementId: number | null;
  legacyConditionFlag: string | null;
  legacyBookedFlag: string | null;
  /** The workbook line, NULL for a line entered here (0134). */
  sourceRow: number | null;
};

/**
 * May this item be removed from its purchase?
 *
 * Four refusals, each for its own reason — the same four the database has:
 *
 *   in stock        the movement names this unit; removing the row would
 *                   orphan it, and the foreign key says so too.
 *   reconciled      the workbook's own state for a line already accounted
 *                   for in stock.
 *   source row      the line number the item was imported from. The only
 *                   marker the 109 items 0067 reopened still carry: the
 *                   workbook had them as reconciled, they were never
 *                   delivered, and `0067` set them back to `ordered`. The
 *                   database has refused them since 0064 on this ground
 *                   alone; the screen could not see it until 0134, so it
 *                   offered a removal that always failed.
 *   legacy markers  what the old spreadsheet believed about this line.
 *                   Provenance, and no importer will regenerate it — this
 *                   project does not re-import.
 *
 * ---------------------------------------------------------------------------
 * WAS HIER NICHT MEHR STEHT: DIE HERKUNFT DES EINKAUFS (ADR-0126)
 *
 * Bis 2026-10-17 war jede Zeile eines importierten Einkaufs unentfernbar,
 * auch eine, die der Betreiber selbst gerade hinzugefügt hatte. Die Regel
 * sollte die Arbeitsmappe schützen und traf dabei auch den eigenen Nachtrag:
 * wer eine Figur versehentlich an einen historischen Einkauf hängte, bekam
 * sie nie wieder weg.
 *
 * Die drei übrigen Regeln schützen die Arbeitsmappe vollständig, und das ist
 * nicht geraten: der Import (`0053`, und `0088` für Nachträge) setzt jeder
 * Zeile `state = 'reconciled_legacy'` UND eine `source_row` — zwei
 * unabhängige Merkmale, von denen jedes allein hier schon ablehnt. Eine
 * nachträglich von Hand angelegte Zeile trägt keines von beiden und darf
 * deshalb auch wieder gehen. `0132` sagt in der Datenbank dasselbe.
 * ---------------------------------------------------------------------------
 *
 * NOT a judgement about whether the figure is right. Correcting THAT stays
 * possible for every unbooked item including a historical one — see
 * `canRemapItem` and 0054.
 */
export function canRemoveItem(item: CorrectableItem): boolean {
  if (item.movementId !== null || item.state === "booked") return false;
  if (item.state === "reconciled_legacy") return false;
  if (item.sourceRow !== null) return false;
  return item.legacyConditionFlag === null && item.legacyBookedFlag === null;
}

/**
 * May which figure this item IS be corrected?
 *
 * Booking is the only bar. A historical line may absolutely be remapped —
 * that is what 0054 exists for, a workbook name matched to the wrong SKY-ID
 * has to be fixable — and doing so changes a classification while the line,
 * its row number and its provenance stay exactly where they are.
 */
export function canRemapItem(item: Pick<CorrectableItem, "state" | "movementId">): boolean {
  return item.movementId === null && item.state !== "booked";
}
