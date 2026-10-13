/**
 * Was ein Einkauf gekostet hat (0115, Entscheidung D2 und D9).
 *
 * DIE EINE RICHTUNG. Das Formular erfasst die drei Teile — Figurenpreis,
 * Versand, Käuferschutz — und die Gesamtsumme folgt daraus:
 *
 *     total_cost = items_cost + shipping_cost + buyer_protection_cost
 *
 * Nicht umgekehrt. `purchases.total_cost` bleibt dabei, was es seit `0053`
 * ist: was tatsächlich bezahlt wurde. Die Aufteilung steht DANEBEN und wird
 * von `purchases_cost_split_adds_up` gegen die Summe geprüft, damit nie zwei
 * Zahlen über dieselbe Ausgabe im Umlauf sind.
 *
 * WARUM DAS NICHT IN `sales-money.ts` LIEGT. Dort heisst eine Gebühr etwas
 * anderes: `plannedPayout` ZIEHT ab, was der Kanal einbehält. Hier wird
 * ADDIERT, was der Betrieb gezahlt hat. Zwei Vorzeichen, zwei Begriffe — in
 * einer Datei wären sie eine Einladung, das falsche zu greifen.
 */
import { parseMoney, roundMoney } from "./sales-money";

export type PurchaseCostInput = {
  /** Was die Figuren gekostet haben, als getippter Text. */
  items: string;
  /** Versand. Leer heisst „keiner", nicht „unbekannt" — siehe `purchaseCosts`. */
  shipping: string;
  /** Käuferschutz. Standard 0 €. */
  buyerProtection: string;
};

export type PurchaseCosts = {
  items: number;
  shipping: number;
  buyerProtection: number;
  /** Die Summe der drei, auf den Cent gerundet. Was bezahlt wurde. */
  total: number;
};

/**
 * Die drei Teile und ihre Summe.
 *
 * Ein leeres Feld ist 0 und nicht NULL: wer ein Formular ausfüllt und den
 * Versand leer lässt, sagt „es gab keinen". Das Unbekannte gibt es nur für
 * die Einkäufe von vor `0115`, und dort steht es als NULL in der Datenbank —
 * es entsteht nicht in einem Formular.
 *
 * ---------------------------------------------------------------------------
 * DIE SUMME WIRD AUS DEN GERUNDETEN TEILEN GEBILDET, NICHT AUS DEN ROHEN.
 *
 * Erst stand hier `roundMoney(items + shipping + buyerProtection)` über die
 * ungerundeten Werte. Das ist einen Cent daneben, sobald zwei Teile je eine
 * halbe Rundungsstelle tragen:
 *
 *     10,005 + 0,005 + 0,005   roh gerundet          = 10,02
 *     10,01  + 0,01  + 0,01    aus gerundeten Teilen = 10,03
 *
 * Gespeichert werden die GERUNDETEN Teile — `numeric(10,2)` kann nichts
 * anderes —, und `purchases_cost_split_adds_up` rechnet in der Datenbank
 * `round(items + shipping + protection, 2) = round(total_cost, 2)`. Mit der
 * rohen Summe hätte der CHECK den ganzen Einkauf abgelehnt, und die Meldung
 * hätte von einem Constraint gesprochen statt von der Sache.
 *
 * Also dieselbe Arithmetik wie in der Datenbank: runden, dann addieren.
 */
export function purchaseCosts(input: PurchaseCostInput): PurchaseCosts {
  const items = roundMoney(parseMoney(input.items) ?? 0);
  const shipping = roundMoney(parseMoney(input.shipping) ?? 0);
  const buyerProtection = roundMoney(parseMoney(input.buyerProtection) ?? 0);
  return {
    items,
    shipping,
    buyerProtection,
    total: roundMoney(items + shipping + buyerProtection),
  };
}

/**
 * Trägt dieser Einkauf überhaupt eine Aufteilung?
 *
 * Für jeden Einkauf von vor `0115` lautet die Antwort nein, und das ist keine
 * Lücke, die gefüllt werden müsste: was bezahlt wurde, steht in `total_cost`.
 * Die Aufteilung zu erfinden wäre schlimmer als sie nicht zu haben.
 */
export type StoredCosts = {
  total_cost: string | number;
  items_cost?: string | number | null;
  shipping_cost?: string | number | null;
  buyer_protection_cost?: string | number | null;
};

export function hasCostSplit(row: StoredCosts): boolean {
  return row.items_cost !== null && row.items_cost !== undefined;
}

/**
 * Die Aufteilung, wie sie angezeigt wird — oder `null`, wenn es keine gibt.
 *
 * `shipping` und `buyerProtection` sind 0, wenn die Aufteilung existiert und
 * die Zeile leer ist: eine erfasste Aufteilung ohne Versandzeile heisst „kein
 * Versand". Dieselbe Lesart wie in `purchaseCosts`, damit Erfassen und
 * Anzeigen nicht zwei Meinungen haben.
 */
export function storedCostSplit(row: StoredCosts): PurchaseCosts | null {
  if (!hasCostSplit(row)) return null;
  const n = (v: string | number | null | undefined): number =>
    v === null || v === undefined ? 0 : Number(v);
  return {
    items: n(row.items_cost),
    shipping: n(row.shipping_cost),
    buyerProtection: n(row.buyer_protection_cost),
    total: roundMoney(Number(row.total_cost)),
  };
}

/**
 * Stimmt die gespeicherte Aufteilung mit der Summe überein?
 *
 * Die Datenbank erzwingt das über `purchases_cost_split_adds_up`; dies ist
 * die Lesefassung derselben Frage, für einen Bildschirm, der eine Altzeile
 * anzeigt, deren Aufteilung jemand von Hand eingetragen hat. Eine Zeile ohne
 * Aufteilung gilt als stimmig — es gibt nichts, was nicht aufgehen könnte.
 */
export function costSplitAddsUp(row: StoredCosts): boolean {
  const split = storedCostSplit(row);
  if (split === null) return true;
  return roundMoney(split.items + split.shipping + split.buyerProtection) === split.total;
}
