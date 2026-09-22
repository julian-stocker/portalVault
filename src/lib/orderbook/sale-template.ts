/**
 * Layout templates for the external-sale form (ADR-0092).
 *
 * A TEMPLATE IS A LAYOUT AND NOTHING ELSE. `eBay` decides which inputs the
 * form shows, what they are called, and which fee rows it starts with. It
 * decides no storage: every value it collects lands in the structures that
 * have existed since `0059` — `sales.items_subtotal`, `shipping_charged`,
 * `discount_amount`, `sale_fees` (with `kind` and `settled_by`),
 * `settlement_adjustments`.
 *
 * There is no eBay table, no `ebay_fee` column and no eBay branch in any
 * query. Staging already shows the existing model is enough: 820 fee rows
 * across four kind/settlement combinations, 282 sales with more than one fee.
 *
 * WHY `settled_by` IS THE INTERESTING FIELD
 *
 * It is the whole of the distinction the workbook kept as two columns, `lbl
 * eBay` and `lbl ext`, and the reason the form has to ask about a shipping
 * label rather than just taking a number. A label eBay billed reduces what
 * eBay pays out; one bought at the post office does not, however real the
 * money was. Both are `kind = 'shipping_label'`; only `settled_by` differs,
 * and `plannedPayout` reads exactly that.
 */

import {
  parseMoney, parseSignedMoney, plannedPayout, roundMoney,
  type AdjustmentPlan, type FeePlan,
} from "./sales-money";

export type SaleTemplateId = "ebay" | "manual";
export type SettledBy = "channel" | "external";

/** A fee row as the form holds it: amounts are still raw text. */
export type FeeDraft = {
  /** Stable across re-renders and reorderings. */
  key: string;
  /** `sale_fees.kind` — validated by the database, not here. */
  kind: string;
  /** Shown beside the input, and stored as `sale_fees.label` for `other`. */
  label: string;
  amount: string;
  settledBy: SettledBy;
};

export type SaleTemplate = {
  id: SaleTemplateId;
  /** What lands in `sales.channel`. */
  channel: string;
  /** The rows the form opens with. The operator may clear or delete any. */
  defaultFees: readonly Omit<FeeDraft, "key" | "amount">[];
  /** Whether the layout offers these at all. */
  showsDiscount: boolean;
  showsAdjustment: boolean;
};

/**
 * DIE GEBÜHRENARTEN, DIE DER BETREIBER KENNT — UND WIE SIE GESPEICHERT WERDEN.
 *
 * Ein Marktplatz rechnet in mehreren Posten ab: Transaktion, Anzeige,
 * Werbung, Zahlung. Für das Lager und die Auszahlung sind sie alle dasselbe —
 * Geld, das der Kanal einbehält —, für den Beleg sind sie es nicht.
 *
 * DESHALB ZWEI EBENEN, BEIDE SCHON VORHANDEN (0059):
 *
 *   `kind`   die Verrechnungskategorie, die die Datenbank kennt und jede
 *            Auswertung summiert: payment · marketplace · shipping_label ·
 *            other. Sie bleibt unverändert, und deshalb braucht diese
 *            Erweiterung KEINE Migration.
 *   `label`  der Name der Gebührenart, wie der Betreiber sie gewählt hat.
 *            Die Spalte gibt es seit 0059; bisher füllte das Formular sie nur
 *            für `other`, weil nur dort ein CHECK sie verlangt. Jetzt trägt
 *            jede neue Zeile ihren Namen — und die historischen Zeilen, die
 *            keinen haben, zeigen weiterhin den Namen ihrer Kategorie
 *            (`feeName()` im Detailfenster fällt darauf zurück).
 *
 * Die Auszahlung interessiert sich für keine dieser beiden Ebenen:
 * `plannedPayout` zieht jede Gebühr ab, die der Kanal einbehalten hat, egal
 * welcher Art. Mehr Gebührenzeilen heißt deshalb automatisch mehr Abzug, und
 * es gibt keine Stelle, die eine einzelne Art gesondert behandelt.
 */
export type SaleFeeType = {
  /** Stabil, nur intern — landet nirgends in der Datenbank. */
  id: string;
  /** `sale_fees.label`. Leer heißt: der Betreiber benennt sie selbst. */
  label: string;
  /** `sale_fees.kind`, die Verrechnungskategorie. */
  kind: string;
  settledBy: SettledBy;
};

export const SALE_FEE_TYPES: readonly SaleFeeType[] = [
  { id: "transaction", label: "Transaktionsgebühr", kind: "payment", settledBy: "channel" },
  { id: "listing", label: "Anzeigegebühr", kind: "marketplace", settledBy: "channel" },
  { id: "advertising", label: "Werbegebühr", kind: "marketplace", settledBy: "channel" },
  { id: "payment", label: "Zahlungsgebühr", kind: "payment", settledBy: "channel" },
  { id: "shipping_label", label: "Versandkosten (Label)", kind: "shipping_label", settledBy: "channel" },
  { id: "other", label: "", kind: "other", settledBy: "channel" },
];

export function saleFeeType(id: string): SaleFeeType | undefined {
  return SALE_FEE_TYPES.find((t) => t.id === id);
}

/** Eine Gebührenzeile aus einer gewählten Art. */
export function feeFromType(key: string, typeId: string): FeeDraft {
  const type = saleFeeType(typeId) ?? SALE_FEE_TYPES[SALE_FEE_TYPES.length - 1];
  return { key, kind: type.kind, label: type.label, amount: "", settledBy: type.settledBy };
}

/**
 * eBay, as the reconciliation actually works.
 *
 * Zwei Zeilen vorab, weil jede eBay-Abrechnung der Arbeitsmappe sie hat: die
 * Transaktionsgebühr und das Label. Das Label steht auf `channel` — über eBay
 * gekauft ist der Normalfall —, und der Betreiber stellt es auf `external`
 * für eines von der Post.
 *
 * MEHR NICHT. Anzeige-, Werbe- und Zahlungsgebühr fallen nicht bei jedem
 * Verkauf an; vorausgefüllte Zeilen, die meistens leer bleiben, laden zu
 * einer Null ein, wo nichts stehen sollte. Sie stehen stattdessen unter
 * „+ Gebühr" bereit.
 *
 * Es gibt weiterhin kein eBay-Feld und keine eBay-Spalte: das hier ist eine
 * Vorbelegung von zwei gewöhnlichen `sale_fees`-Zeilen.
 */
const EBAY: SaleTemplate = {
  id: "ebay",
  channel: "ebay",
  defaultFees: [
    { kind: "payment", label: "Transaktionsgebühr", settledBy: "channel" },
    { kind: "shipping_label", label: "Versandkosten (Label)", settledBy: "channel" },
  ],
  showsDiscount: true,
  showsAdjustment: true,
};

/**
 * Anything sold away from a marketplace — a collector, a forum, a fair.
 *
 * No default fees: there is usually no channel to deduct anything, and a
 * template that starts with two empty fee rows is a template that has to be
 * cleaned up before it can be used. Everything is still available; nothing is
 * assumed.
 */
const MANUAL: SaleTemplate = {
  id: "manual",
  channel: "manual",
  defaultFees: [],
  showsDiscount: true,
  showsAdjustment: true,
};

export const SALE_TEMPLATES: readonly SaleTemplate[] = [EBAY, MANUAL];

export function saleTemplate(id: string): SaleTemplate {
  return SALE_TEMPLATES.find((t) => t.id === id) ?? EBAY;
}

/** The rows a freshly chosen template starts with. */
export function initialFees(template: SaleTemplate, key: (n: number) => string): FeeDraft[] {
  return template.defaultFees.map((f, i) => ({ ...f, key: key(i), amount: "" }));
}

/**
 * A fee row the operator added by hand.
 *
 * `other` is the only kind that requires a label — `sale_fees_other_has_label`
 * — so the form supplies one and the operator renames it.
 */
export function extraFee(key: string, label: string): FeeDraft {
  return { key, kind: "other", label, amount: "", settledBy: "channel" };
}

/**
 * Fee rows → what `plannedPayout` and the RPC both take.
 *
 * A row with no amount is dropped rather than written as `0,00 €`: an empty
 * field means the fee did not occur, and a zero-amount fee row would show up
 * on the detail screen for ever as a cost of nothing.
 */
export function feePlans(drafts: readonly FeeDraft[]): FeePlan[] {
  const out: FeePlan[] = [];
  for (const d of drafts) {
    const raw = d.amount.trim().replace(",", ".");
    if (raw === "") continue;
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const label = d.label.trim();
    out.push({
      kind: d.kind,
      amount,
      settled_by: d.settledBy,
      /*
       * Der Name der Gebührenart wird MITGESPEICHERT, nicht nur bei `other`.
       * Vorher war das Etikett reine Bildschirmsprache; seit es mehrere
       * Arten pro Kategorie gibt (Anzeige- und Werbegebühr sind beide
       * `marketplace`), wäre die Unterscheidung sonst beim Speichern weg.
       * Leer bleibt leer — die Spalte ist nullable, und eine Zeile ohne
       * Namen zeigt weiterhin den ihrer Kategorie.
       */
      ...(label === "" ? {} : { label }),
    });
  }
  return out;
}

/** True when a row has text in it that is not a usable amount. */
export function invalidFees(drafts: readonly FeeDraft[]): FeeDraft[] {
  return drafts.filter((d) => {
    const raw = d.amount.trim().replace(",", ".");
    if (raw === "") return false;
    const amount = Number(raw);
    return !Number.isFinite(amount) || amount < 0;
  });
}

/** An `other` fee with no label cannot be stored — the CHECK refuses it. */
export function unlabelledFees(drafts: readonly FeeDraft[]): FeeDraft[] {
  return drafts.filter((d) =>
    d.kind === "other" && d.amount.trim() !== "" && d.label.trim() === "");
}

export type SaleDraftMoney = {
  subtotal: number;
  shipping: number;
  discount: number;
  fees: readonly FeePlan[];
  adjustments: readonly AdjustmentPlan[];
};

/**
 * What the sale will pay out (ADR-0095).
 *
 * ONE NUMBER, DERIVED. It used to return a reported figure, a difference and
 * a `matches` flag, because the owner typed in what the marketplace had
 * actually paid and the screen reconciled the two. That workflow is gone:
 * the payout IS the formula, so there is nothing left to compare against.
 *
 * `plannedPayout` is that formula — the one the historical import used to
 * reconstruct 292 workbook sales — and `sale_expected_payout()` computes the
 * identical expression in SQL for a sale that already exists. Nothing here
 * re-derives anything; it rounds once, at the boundary.
 *
 * A REFUND IS NOT PART OF THIS. A new sale has none; one that arrives later
 * is its own event, and from then on the database's figure is the one shown.
 */
export function payoutView(money: SaleDraftMoney): number {
  return roundMoney(
    plannedPayout(money.subtotal, money.shipping, money.discount, money.fees, [], money.adjustments),
  );
}

export type SaleFormInput = {
  subtotal: string;
  shipping: string;
  discount: string;
  fees: readonly FeeDraft[];
  /** Signed. Empty or `0` means there is no adjustment at all. */
  adjustment: string;
  adjustmentNote: string;
};

export type SaleFormMoney = {
  subtotal: number;
  shipping: number;
  discount: number;
  fees: FeePlan[];
  adjustments: AdjustmentPlan[];
  /** What the channel will pay out, by the workbook's own formula. */
  payout: number;
};

export function saleFormMoney(input: SaleFormInput): SaleFormMoney {
  const subtotal = parseMoney(input.subtotal) ?? 0;
  const shipping = parseMoney(input.shipping) ?? 0;
  const discount = parseMoney(input.discount) ?? 0;
  const fees = feePlans(input.fees);

  /*
   * A zero adjustment is NO adjustment, not a row worth zero:
   * `settlement_adjustments_amount_not_zero` refuses one, and a correction of
   * nothing is not a correction.
   */
  const signed = parseSignedMoney(input.adjustment) ?? 0;
  const adjustments: AdjustmentPlan[] = signed === 0
    ? []
    : [{ amount: signed, ...(input.adjustmentNote.trim() ? { note: input.adjustmentNote.trim() } : {}) }];

  return {
    subtotal, shipping, discount, fees, adjustments,
    payout: payoutView({ subtotal, shipping, discount, fees, adjustments }),
  };
}
