/**
 * Zwei Zustände für die Orderbuch-Übersicht: reichen die Daten, und stimmt
 * der Beleg noch? (`0124`)
 *
 * ---------------------------------------------------------------------------
 * WARUM DAS URTEIL HIER FÄLLT UND NICHT IN SQL
 *
 * `0124` projiziert FAKTEN — elf Felder je Zeile, sechs davon Wahrheitswerte
 * über das Vorhandensein von Daten. Die Farbe daraus zu machen ist eine
 * Regel, und eine Regel in SQL ist eine Regel ohne Test: man kann sie nur
 * gegen eine Datenbank prüfen, und dann prüft man sie an den Daten, die dort
 * gerade liegen. Hier lässt sie sich über jede Kombination prüfen,
 * einschliesslich der Nullwerte, die in echten Daten selten zusammentreffen.
 *
 * ---------------------------------------------------------------------------
 * DIE ZWEI FRAGEN SIND NICHT DIESELBE FRAGE
 *
 * „Lässt sich ein Eigenbeleg ausstellen?" und „dokumentiert er den Ankauf
 * vollständig?" fallen auseinander, und das ist der ganze Grund für drei
 * Farben statt zwei.
 *
 * `seller_issue_purchase_receipt` verlangt NUR: kein Testeinkauf, ein
 * Kaufdatum, mindestens eine Position — und eine vollständige
 * Geschäftsadresse des Shops, die aber shopweit gilt und keine Eigenschaft
 * einer Zeile ist. Absenderdaten verlangt sie NICHT. Ein Beleg ohne
 * Absender entsteht also anstandslos; er dokumentiert nur nicht, von wem
 * gekauft wurde.
 *
 * Deshalb:
 *
 *   grau    `blocked`    ausstellen würde fehlschlagen
 *   orange  `partial`    ausstellen geht, der Absender fehlt aber
 *   grün    `complete`   ausstellen geht und der Absender ist vollständig
 *
 * Orange sagt NIE „geht nicht". Das muss der Tooltip tragen, sonst liest der
 * Betreiber eine Sperre, wo eine Empfehlung steht.
 *
 * ---------------------------------------------------------------------------
 * UND GRÜN IST KEINE RECHTLICHE AUSSAGE
 *
 * `complete` heisst: die Felder, die der Beleg zeigt, sind gefüllt. Ob die
 * Form des Eigenbelegs steuerlich anerkannt wird, ist nicht geprüft und steht
 * als offener Punkt in `docs/LEGAL.md`. Keine Farbe dieser Spalte behauptet
 * etwas darüber.
 *
 * ---------------------------------------------------------------------------
 * `unknown` IST KEIN FEHLER, SONDERN EINE EHRLICHE ANTWORT
 *
 * Gegen eine Datenbank ohne `0124` liefert der Ledger diese Felder nicht.
 * Dann ist `receiptNumber` undefined — und das darf NICHT als „kein Beleg
 * ausgestellt" gelesen werden: die Frage wurde nicht gestellt, nicht mit nein
 * beantwortet. Ein vorhandener Beleg, der als nicht vorhanden dargestellt
 * wird, wäre die irreführendste Antwort von allen; ein Betreiber, der danach
 * einen zweiten ausstellt, bekommt zu Recht denselben zurück (die Funktion
 * ist idempotent), aber er hätte es nicht versuchen sollen.
 *
 * `statusKnown` ist der Marker aus `0124` und immer `true`. Fehlt er, lautet
 * die Antwort `unknown`.
 */

/** Die Fakten, die `0124` je Zeile liefert — und nichts darüber hinaus. */
export type ReceiptFacts = {
  /** Der Marker aus `0124`. Fehlt er, weiss der Ledger nichts über Belege. */
  statusKnown: boolean;

  /* ---- was die Ausstellung technisch verlangt ------------------------- */
  isTest: boolean;
  purchasedAt: string | null;
  itemCount: number;

  /* ---- was den Beleg aussagekräftig macht ----------------------------- */
  hasSenderName: boolean;
  hasSenderStreet: boolean;
  hasSenderPostalCode: boolean;
  hasSenderCity: boolean;
  /** Plattform, Inseratsnummer, -titel oder -adresse. Nur für den Tooltip. */
  hasOrigin: boolean;
  /** Der Kommentar zur Kaufvereinbarung. Nur für den Tooltip. */
  hasAgreement: boolean;

  /* ---- der ausgestellte Beleg ----------------------------------------- */
  receiptNumber: string | null;
  receiptIssuedAt: string | null;
  receiptRevision: number | null;
  /**
   * `true` = weicht ab, `false` = stimmt, `null` = es gibt keinen Beleg ODER
   * der Vergleich war nicht zu bilden. Die zweite Lesart ist der Grund, warum
   * `receiptStatus` sie nicht mit „kein Beleg" verwechselt.
   */
  receiptStale: boolean | null;
};

export type DataStatus = "unknown" | "blocked" | "partial" | "complete";
export type ReceiptStatus = "unknown" | "none" | "stale" | "match";

/**
 * Warum der Datenstatus so ausfällt — als Aufzählung, nicht als Satz.
 *
 * Der deutsche Text wohnt in `de.ts`, wie jeder benutzersichtbare Text in
 * diesem Projekt. Hier stehen die Gründe, damit der Tooltip sie zusammensetzen
 * kann und ein Test sie prüfen kann, ohne eine Übersetzung zu lesen.
 */
export type DataReason =
  | "test"
  | "noDate"
  | "noItems"
  | "noSenderName"
  | "noAddress"
  | "addressPartial"
  | "noOrigin"
  | "noAgreement";

const addressComplete = (f: ReceiptFacts): boolean =>
  f.hasSenderStreet && f.hasSenderPostalCode && f.hasSenderCity;

const addressStarted = (f: ReceiptFacts): boolean =>
  f.hasSenderStreet || f.hasSenderPostalCode || f.hasSenderCity;

/**
 * Lässt sich für diesen Einkauf überhaupt ein Beleg ausstellen?
 *
 * Genau die drei Zeilenbedingungen aus `seller_issue_purchase_receipt`. Die
 * vierte — die Geschäftsadresse des Shops — gilt shopweit und gehört nicht in
 * eine Spalte, die achtundachtzig Mal dasselbe anzeigt.
 */
export function canIssueReceipt(f: ReceiptFacts): boolean {
  return !f.isTest && f.purchasedAt !== null && f.itemCount > 0;
}

/**
 * Der Datenstatus und seine Gründe.
 *
 * REIHENFOLGE MIT ABSICHT: `blocked` wird VOR `statusKnown` geprüft. Ein
 * Testeinkauf ist auch ohne `0124` ein Testeinkauf, und ein fehlendes
 * Kaufdatum ist auch ohne `0124` eines — diese drei Felder liefert der Ledger
 * seit `0063`. Nur die Unterscheidung zwischen orange und grün braucht die
 * neuen Wahrheitswerte. So gibt die Spalte vor der Migration die Auskunft,
 * die sie geben kann, und schweigt über die, die sie nicht geben kann.
 */
export function dataStatus(f: ReceiptFacts): { status: DataStatus; reasons: DataReason[] } {
  const reasons: DataReason[] = [];

  if (f.isTest) reasons.push("test");
  if (f.purchasedAt === null) reasons.push("noDate");
  if (f.itemCount <= 0) reasons.push("noItems");
  if (reasons.length > 0) return { status: "blocked", reasons };

  if (!f.statusKnown) return { status: "unknown", reasons: [] };

  if (!f.hasSenderName) reasons.push("noSenderName");
  if (!addressStarted(f)) reasons.push("noAddress");
  else if (!addressComplete(f)) reasons.push("addressPartial");

  /*
   * HINWEISE, DIE DIE FARBE NICHT ÄNDERN.
   *
   * Herkunft und Kaufvereinbarung stehen im Tooltip, wenn sie fehlen, aber
   * sie machen aus grün kein orange. Ein Inserat ist Referenz und niemals
   * Beleggrundlage — es grün-relevant zu machen hiesse, eine Angabe zu
   * verlangen, die der Beleg bewusst nur als Hinweis trägt.
   */
  const hints: DataReason[] = [];
  if (!f.hasOrigin) hints.push("noOrigin");
  if (!f.hasAgreement) hints.push("noAgreement");

  return reasons.length === 0
    ? { status: "complete", reasons: hints }
    : { status: "partial", reasons: [...reasons, ...hints] };
}

/**
 * Gibt es einen Beleg, und stimmt er noch?
 *
 * `statusKnown` zuerst, und hier ist die Reihenfolge das Gegenteil von oben:
 * ohne den Marker ist `receiptNumber` nicht „null, also keiner", sondern
 * „nicht gefragt". Erst danach ist ein fehlender Beleg ein fehlender Beleg.
 *
 * Und ein vorhandener Beleg mit `receiptStale === null` ist `unknown`, nicht
 * `match`: der Vergleich war nicht zu bilden, und „stimmt überein" wäre dann
 * eine Behauptung ohne Grundlage.
 */
export function receiptStatus(f: ReceiptFacts): ReceiptStatus {
  if (!f.statusKnown) return "unknown";
  if (f.receiptNumber === null) return "none";
  if (f.receiptStale === true) return "stale";
  if (f.receiptStale === false) return "match";
  return "unknown";
}

/**
 * Die Farbe, die ein Zustand trägt — eine Stelle für beide Spalten.
 *
 * `unknown` ist bewusst NICHT grau: grau bedeutet in der Datenspalte „geht
 * nicht" und in der Belegspalte „gibt es nicht", und beides sind Antworten.
 * `unknown` ist keine Antwort und sieht deshalb anders aus.
 */
export type StatusTone = "blocked" | "partial" | "complete" | "unknown";

export function dataTone(status: DataStatus): StatusTone {
  return status === "blocked" ? "blocked"
    : status === "partial" ? "partial"
    : status === "complete" ? "complete"
    : "unknown";
}

export function receiptTone(status: ReceiptStatus): StatusTone {
  return status === "none" ? "blocked"
    : status === "stale" ? "partial"
    : status === "match" ? "complete"
    : "unknown";
}
