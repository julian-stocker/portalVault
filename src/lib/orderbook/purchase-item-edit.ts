/**
 * Der lokale Bearbeitungszustand der Figurenliste eines Einkaufs (0126).
 *
 * WARUM ES DIESE DATEI GIBT
 *
 * Hinzufügen und Entfernen passieren im Dialog zunächst NUR hier. Erst
 * `Speichern` schickt den Unterschied an `seller_save_purchase_edit`, und
 * `Abbrechen` wirft ihn weg. Das ist der ausdrückliche Wunsch — und es ist
 * auch die einzige Form, in der ein Speichern atomar sein kann: ein Aufruf,
 * eine Transaktion, entweder alles oder nichts.
 *
 * Die Funktionen hier sind rein. Keine Abfrage, kein Zustand, kein React —
 * damit „Abbrechen verwirft alles" und „eine gebuchte Figur lässt sich nicht
 * entfernen" prüfbar sind, ohne einen Browser zu starten.
 *
 * DIE GRENZE BLEIBT DIE DATENBANK. `canRemoveItem` spiegelt
 * `seller_remove_purchase_item`; was hier erlaubt aussieht, kann der Server
 * immer noch ablehnen, und er hat recht. Umgekehrt wird nichts angeboten, was
 * er ohnehin ablehnen würde — eine Aktion, die immer scheitert, ist schlimmer
 * als eine fehlende.
 */
import { canRemapItem, canRemoveItem } from "./purchase";
import type { PurchaseItem } from "./queries";

/** Eine Figur, die noch keine Zeile in der Datenbank hat. */
export type NewFigure = {
  /** Nur im Browser gültig; die Datenbank vergibt die echte ID. */
  tempId: string;
  skyId: string | null;
  /** Für eine Figur ohne SKY-ID — `seller_add_purchase_item` verlangt eines von beidem. */
  rawName: string | null;
  /** Anzeigename für die Liste. Wird nicht gespeichert; der Katalog entscheidet. */
  label: string;
  condition: string;
};

/** Eine Position, die auf eine andere Katalogfigur zeigen soll (0127). */
export type SwapFigure = {
  itemId: number;
  skyId: string;
  /** Anzeigename der NEUEN Figur. Nur für die Liste; der Katalog entscheidet. */
  label: string;
};

/** Was der Dialog zwischen Öffnen und Speichern gesammelt hat. */
export type PendingEdit = {
  add: NewFigure[];
  /** IDs bestehender Positionen, die beim Speichern verschwinden sollen. */
  remove: number[];
  /** Positionen, die eine andere Figur bekommen sollen — ID und Position bleiben. */
  swap: SwapFigure[];
};

export const emptyEdit: PendingEdit = { add: [], remove: [], swap: [] };

/** Hat der Betreiber überhaupt etwas an der Liste geändert? */
export function isDirty(pending: PendingEdit): boolean {
  return pending.add.length > 0 || pending.remove.length > 0
    || pending.swap.length > 0;
}

/**
 * Zum Entfernen vormerken — oder die Vormerkung zurücknehmen.
 *
 * Derselbe Klick in beide Richtungen: die Zeile bleibt sichtbar, bis
 * gespeichert wird, also muss sie sich auch zurückholen lassen. Ein zweites
 * Papierkorbsymbol dafür wäre eine zweite Erklärung.
 */
export function toggleRemove(pending: PendingEdit, itemId: number): PendingEdit {
  if (pending.remove.includes(itemId)) {
    return { ...pending, remove: pending.remove.filter((id) => id !== itemId) };
  }
  /*
   * ENTFERNEN UND WECHSELN SCHLIESSEN EINANDER AUS.
   *
   * Beides zugleich ist kein Auftrag, sondern ein Widerspruch — und der
   * Server lehnt ihn ab (`an item cannot be swapped and removed in the same
   * save`). Die spätere Handlung gewinnt und räumt die frühere weg, damit es
   * nie zu dieser Ablehnung kommt.
   */
  return {
    ...pending,
    remove: [...pending.remove, itemId],
    swap: pending.swap.filter((s) => s.itemId !== itemId),
  };
}

/**
 * Eine Position auf eine andere Figur zeigen lassen (0127).
 *
 * Drei Regeln, und jede hat einen Grund:
 *
 *   gleiche SKY-ID   wird verworfen. Ein Leerauftrag würde `updated_at`
 *                    bewegen — über den Trigger aus `0126` sogar die Version
 *                    des ganzen Einkaufs — und jede andere offene Bearbeitung
 *                    mit `PT409` scheitern lassen.
 *   zweiter Wechsel  ersetzt den ersten. Zwei Ziele für eine Zeile sind keine
 *                    zwei Aufträge.
 *   vorgemerkt-weg   die Vormerkung zum Entfernen fällt. Siehe `toggleRemove`.
 */
export function swapFigure(
  pending: PendingEdit, itemId: number, currentSkyId: string | null, next: SwapFigure,
): PendingEdit {
  const ohne = {
    ...pending,
    remove: pending.remove.filter((id) => id !== itemId),
    swap: pending.swap.filter((s) => s.itemId !== itemId),
  };
  if (next.skyId === currentSkyId) return ohne;
  return { ...ohne, swap: [...ohne.swap, next] };
}

/** Einen vorgemerkten Wechsel zurücknehmen. */
export function dropSwap(pending: PendingEdit, itemId: number): PendingEdit {
  return { ...pending, swap: pending.swap.filter((s) => s.itemId !== itemId) };
}

/** Eine neue Figur anhängen. Reihenfolge = Reihenfolge der Auswahl. */
export function addFigure(pending: PendingEdit, figure: NewFigure): PendingEdit {
  return { ...pending, add: [...pending.add, figure] };
}

/**
 * Eine noch nicht gespeicherte Figur wieder wegnehmen.
 *
 * Sie verschwindet sofort und vollständig — es gibt nichts, was man
 * zurückholen müsste, denn sie hat nie existiert.
 */
export function dropNew(pending: PendingEdit, tempId: string): PendingEdit {
  return { ...pending, add: pending.add.filter((f) => f.tempId !== tempId) };
}

/** Eine Zeile der Liste, wie sie der Dialog zeichnet. */
export type StagedRow =
  | {
      kind: "existing";
      item: PurchaseItem;
      removed: boolean;
      mayRemove: boolean;
      /** Seit `0127`: `movementId === null && state !== "booked"`. */
      maySwap: boolean;
      /** Gesetzt, wenn für diese Zeile ein Wechsel vorgemerkt ist. */
      swap: SwapFigure | null;
    }
  | { kind: "new"; figure: NewFigure };

/**
 * Die Liste zum Zeichnen: bestehende Positionen in ihrer Reihenfolge, neue
 * unten angehängt.
 *
 * ZUM ENTFERNEN VORGEMERKTE ZEILEN BLEIBEN STEHEN, nur ausgegraut. Eine Zeile
 * verschwinden zu lassen, die noch da ist, wäre eine Behauptung über einen
 * Zustand, den der Server noch nicht kennt — und nach einem `Abbrechen` wäre
 * sie unerklärlich wieder da.
 */
export function stageRows(
  items: PurchaseItem[], pending: PendingEdit,
): StagedRow[] {
  const existing: StagedRow[] = items.map((item) => ({
    kind: "existing" as const,
    item,
    removed: pending.remove.includes(item.id),
    mayRemove: canRemoveItem(item),
    /*
     * `canRemapItem` prüft die Herkunft ABSICHTLICH NICHT: eine
     * Arbeitsmappenzeile darf eine andere Figur bekommen — das ist der Zweck
     * von `0054` — und nur nicht verschwinden. Deshalb stehen hier zwei
     * verschiedene Regeln und nicht eine.
     */
    maySwap: canRemapItem(item),
    swap: pending.swap.find((s) => s.itemId === item.id) ?? null,
  }));
  const neu: StagedRow[] = pending.add.map((figure) => ({ kind: "new" as const, figure }));
  return [...existing, ...neu];
}

/**
 * Wie viele Figuren der Einkauf nach dem Speichern hätte.
 *
 * Nur für die Anzeige. Die Zahl, die zählt, kommt nach dem Speichern aus
 * `purchase_market_value` — hier wird nichts nachgerechnet, was die Datenbank
 * ohnehin weiß.
 */
export function stagedCount(items: PurchaseItem[], pending: PendingEdit): number {
  return items.length - pending.remove.length + pending.add.length;
}

/**
 * Braucht dieses Speichern eine Rückfrage wegen eines Eigenbelegs?
 *
 * NUR bei Positionsänderungen. Der Fingerabdruck aus `0122` hasht `lines` mit
 * Nummer, SKY-ID, Namen und Ausführung — eine Figur mehr oder weniger macht
 * einen ausgestellten Beleg also veraltet. Eine Änderung an Kosten oder Notiz
 * tut das nicht (`note` steht nicht im Hash), und `0124` zeigt den Zustand
 * ohnehin in der Übersicht.
 *
 * Der Beleg selbst bleibt unveränderlich — `purchase_receipts_immutable_trg`
 * lehnt jedes UPDATE und DELETE ab. Veraltet heißt: er beschreibt einen
 * früheren Stand, und das soll sichtbar sein, nicht geheilt werden.
 */
export function needsReceiptConfirm(hasReceipt: boolean, pending: PendingEdit): boolean {
  /*
   * `isDirty` zählt seit `0127` auch Wechsel mit — und das ist richtig: der
   * Fingerabdruck aus `0122` hasht `'sky_id'` UND `'name'`, ein Wechsel bewegt
   * ihn also genauso wie ein Hinzufügen.
   */
  return hasReceipt && isDirty(pending);
}

/** Was an `seller_save_purchase_edit` geht. Leer heißt: nichts an der Liste. */
export function savePayload(pending: PendingEdit): {
  add: { sky_id: string | null; raw_name: string | null; condition: string }[];
  remove: number[];
  swap: { item_id: number; sky_id: string }[];
} {
  return {
    add: pending.add.map((f) => ({
      sky_id: f.skyId, raw_name: f.skyId === null ? f.rawName : null, condition: f.condition,
    })),
    remove: [...pending.remove],
    swap: pending.swap.map((s) => ({ item_id: s.itemId, sky_id: s.skyId })),
  };
}
