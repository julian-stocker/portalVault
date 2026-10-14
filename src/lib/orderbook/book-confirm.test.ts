/**
 * Das Einbuchen im (i)-Fenster des Einkaufsbuchs: zwei Klicks, eine Bewegung.
 *
 * DREI ZUSICHERUNGEN TRAGEN DIESE DATEI.
 *
 * 1. DER ERSTE KLICK SCHREIBT NICHTS. Er setzt eine Nummer — keine Server
 *    Action, kein Netzaufruf, keine Bewegung im Lager. `Abbrechen` ebenso.
 *    Erst `Ja, einbuchen` ruft `processBookPurchaseItem`.
 *
 * 2. KEINE NEUE LAGERLOGIK. Es ist dieselbe Server Action und dieselbe RPC,
 *    die die grosse Tabelle und die Detailseite seit je benutzen:
 *    `seller_book_purchase_item` → `record_inventory_movement` → `apply_
 *    inventory_movement`. Dieses Fenster fügt keine Zeile Bestandslogik hinzu
 *    und ändert keinen Zustand von Hand.
 *
 * 3. DREI AKTIONEN, EINDEUTIG JE ZUSTAND. `Einbuchen`, `Figur ändern` und
 *    `Zurücknehmen` teilen eine Spur von 4,5rem. Welche erscheint, entscheidet
 *    allein der Positionszustand, und die Reihenfolge der Verzweigung ist
 *    dabei die eigentliche Regel — siehe den Block „die Reihenfolge".
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { de } from "@/lib/i18n/de";
import { canBook, canRemapItem } from "@/lib/orderbook/purchase";
import { code, latestFunction } from "@/test-support/migrations";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const DETAILS = read("src/components/business/purchase-details.tsx");
const TABLE = read("src/components/business/purchase-item-table.tsx");
const LEDGER = read("src/components/business/orderbook-ledger.tsx");
const ITEMS = read("src/components/business/purchase-items.tsx");
const ACTIONS = read("src/lib/orderbook/actions.ts");
const copy = de.business.orderbook;

/** Der Figurenabschnitt des Fensters, ohne den Rest der Datei. */
const section = (() => {
  const at = DETAILS.indexOf("<Section title={modal.figures}>");
  expect(at).toBeGreaterThan(-1);
  return DETAILS.slice(at, DETAILS.indexOf("</Section>", at));
})();

/** Der Zweig der Aktionsspalte, der für eine buchbare Zeile gilt. */
const bookBranch = section.slice(section.indexOf(") : mayBook ? ("),
                                 section.indexOf(") : mayRemap ? ("));

/** Der Rückfragebereich unter der Zeile. */
const bookArea = (() => {
  const below = section.slice(section.indexOf("below={confirming ? ("));
  const from = below.indexOf(") : confirmingIn ? (");
  return below.slice(from, below.indexOf(") : open ? (", from));
})();

describe("Anforderung 1 — die kompakte Aktion hängt an canBook", () => {
  it("dieselbe Regel wie in der grossen Tabelle, nicht nachgebaut", () => {
    expect(section).toContain("const mayBook = canBook(item);");
    expect(DETAILS).toContain('import { canBook, canRemapItem } from "@/lib/orderbook/purchase";');
    /* Und die Ledger-Fassung delegiert seit 0116 an dieselbe Funktion, damit
       nicht zwei Zustandslisten auseinanderlaufen. */
    expect(read("src/lib/orderbook/ledger.ts"))
      .toContain("return canBook({ state: item.state as ItemState, skyId: item.skyId });");
  });

  it("die Regel selbst, ausgeführt und nicht nur zitiert", () => {
    for (const state of ["ordered", "arrived", "showcase"] as const) {
      expect(canBook({ state, skyId: "SKY-0001" }), state).toBe(true);
    }
    for (const state of ["damaged", "missing", "booked", "settled"] as const) {
      expect(canBook({ state, skyId: "SKY-0001" }), state).toBe(false);
    }
    /* Ohne SKY-ID nie — ein Portal hat keinen Katalogbestand. */
    expect(canBook({ state: "arrived", skyId: null })).toBe(false);
  });

  it("ein Zeichen, kein breiter Knopf, und die Spur wächst nicht", () => {
    /*
     * „Einbuchen" neben „Ändern" bräuchte über 7rem; die Spur ist 4,5rem und
     * darf nicht wachsen. Zwei Zeichen sind 3,45rem. Die Handlung steht im
     * `aria-label` und im `title`, ausgeschrieben in der Rückfrage darunter.
     */
    expect(bookBranch).toContain("aria-label={copy.book}");
    expect(bookBranch).toContain("title={copy.book}");
    expect(bookBranch).toContain('<span aria-hidden="true">{copy.errors.bookIcon}</span>');
    expect(copy.errors.bookIcon.length).toBeLessThanOrEqual(2);
    expect(copy.errors.remapIcon.length).toBeLessThanOrEqual(2);
    /* Die Spurenliste der Lesetabelle ist unverändert — Anforderung 7. */
    expect(TABLE).toContain('"grid-cols-[minmax(0,1fr)_5.5rem] "');
    expect(TABLE).toContain('"sm:grid-cols-[minmax(0,1fr)_7rem_6.5rem_4.5rem]"');
    /* Und die vierte Zelle ordnet die zwei Zeichen, ohne ein neues Gitter. */
    expect(TABLE).toContain('<span className="flex items-center justify-end gap-1">{actions ?? null}</span>');
  });
});

describe("Anforderung 2 — der bestehende Pfad, keine neue Lagerlogik", () => {
  it("die Server Action ist die bestehende, mit frischer Positionsliste", () => {
    expect(bookArea).toContain("processBookPurchaseItem(item.id, purchase.id)");
    expect(ACTIONS).toContain(
      'return runPurchaseItem("seller_book_purchase_item", { p_item_id: itemId }, purchaseId);');
    /* Genau ein Aufruf im ganzen Fenster. */
    expect(DETAILS.split("processBookPurchaseItem(")).toHaveLength(2);
  });

  it("dieselbe RPC wie Detailseite und grosse Tabelle", () => {
    expect(ITEMS).toContain("bookPurchaseItem(");
    expect(TABLE).toContain("canCheckIn(item)");
    const book = code(latestFunction("seller_book_purchase_item").body);
    expect(book).toContain("record_inventory_movement");
  });

  it("keine Zeile Bestandslogik und keine Statusmanipulation im Fenster", () => {
    for (const forbidden of ["shop_inventory", "inventory_movements",
                             "record_inventory_movement", "apply_inventory_movement",
                             "processPurchaseItemState", "p_delta", "p_quantity"]) {
      expect(DETAILS, forbidden).not.toContain(forbidden);
    }
    /* Und kein direktes Setzen von `state` oder `movement_id`. */
    expect(DETAILS).not.toContain('state: "booked"');
    expect(DETAILS).not.toContain("movementId:");
  });
});

describe("Anforderungen 3 und 4 — die Rückfrage unter der Zeile", () => {
  it("sie steht im `below`-Steckplatz, nicht in der Spur", () => {
    expect(section).toContain(") : confirmingIn ? (");
    expect(TABLE).toContain("below?: ReactNode");
    /* Über die ganze Breite, im selben `<li>` wie die Zeile. */
    expect(TABLE).toContain('<div className="border-t border-border/50 px-4 py-2">{below}</div>');
  });

  it("der erste Klick setzt eine Nummer und ruft nichts", () => {
    expect(section).toContain("const toggleBook = () => {");
    const toggle = section.slice(section.indexOf("const toggleBook = () => {"),
                                 section.indexOf("const toggleRemap = () => {"));
    expect(toggle).toContain("setConfirmingBook(confirmingIn ? null : item.id)");
    expect(toggle).not.toContain("processBook");
    expect(toggle).not.toContain("dispatch(");
    /* Der Knopf in der Spur ruft nur den Umschalter. */
    expect(bookBranch).toContain("onClick={toggleBook}");
    expect(bookBranch).not.toContain("processBook");
  });

  it("nur „Ja, einbuchen“ führt aus", () => {
    expect(bookArea).toContain("copy.errors.bookYes");
    expect(bookArea).toContain("dispatch(item.id, () =>");
    expect(bookArea).toContain("processBookPurchaseItem(item.id, purchase.id)");
  });

  it("Abbrechen verändert keine Daten", () => {
    expect(bookArea).toContain("onClick={() => setConfirmingBook(null)}");
    expect(bookArea).toContain("copy.errors.bookCancel");
    const at = bookArea.indexOf("onClick={() => setConfirmingBook(null)}");
    expect(bookArea.slice(at, at + 90)).not.toContain("processBook");
  });

  it("die Rückfrage nennt ihre Folge, und beide Hälften sind durchgesetzt", () => {
    expect(bookArea).toContain("copy.errors.bookConfirmHint");
    expect(bookArea).toContain("copy.errors.bookConfirm");
    expect(bookArea).toContain('role="alert"');
    /* „+1 ins Lager" — die Bewegung schreibt die RPC. */
    expect(copy.errors.bookConfirmHint).toContain("+1");
    const book = code(latestFunction("seller_book_purchase_item").body);
    expect(book).toContain("record_inventory_movement");
    /* „Zuordnung erst wieder änderbar nach der Rücknahme" — `canRemapItem`. */
    expect(canRemapItem({ state: "booked", movementId: 7 })).toBe(false);
    expect(canRemapItem({ state: "arrived", movementId: null })).toBe(true);
  });

  it("und nur, solange die Position buchbar ist", () => {
    /*
     * `confirmingIn` hängt an BEIDEM. Gelingt die Einbuchung, kommt die
     * frische Liste mit `state = 'booked'`, `mayBook` wird falsch, und der
     * Bereich verschwindet von selbst — ohne Rücksetzen im Erfolgspfad.
     * Scheitert sie, bleibt er offen und trägt die Ablehnung.
     */
    expect(section).toContain("const confirmingIn = confirmingBook === item.id && mayBook;");
    expect(bookArea).toContain("failure === null ? null : (");
    expect(bookArea).toContain("text-danger");
  });
});

describe("Anforderung 5 — nach dem Erfolg", () => {
  it("Status, Marktwert und Faktor kommen über dieselbe Maschinerie", () => {
    expect(LEDGER).toContain("onItemAction={(key, run) => act(showingRow.id, key, run)}");
    expect(LEDGER).toContain("setItems((current) => ({ ...current, [purchaseId]: result.items! }))");
    expect(LEDGER).toContain("listStale.current = true;");
    expect(LEDGER).toContain("router.refresh();");
  });

  it("das Fenster bleibt offen", () => {
    expect(LEDGER).toContain("<PurchaseDetails key={showingRow.id}");
    expect(bookArea).not.toContain("onClose");
    expect(bookArea).not.toContain("onSaved");
  });

  it("und die verfügbaren Aktionen wechseln von selbst", () => {
    /*
     * Keine Zeile Code dafür. Die Einbuchung setzt `state = 'booked'` und
     * `movement_id`; danach ist `canBook` falsch und `canRemapItem` falsch,
     * `isBooked` wahr — die Spur zeigt `↩`. Das ist dieselbe Mechanik, die
     * bei der Rücknahme in die andere Richtung läuft.
     */
    const book = code(latestFunction("seller_book_purchase_item").body);
    expect(book).toContain("state = 'booked'");
    expect(canBook({ state: "booked", skyId: "SKY-0001" })).toBe(false);
    expect(canRemapItem({ state: "booked", movementId: 1 })).toBe(false);
  });
});

describe("Anforderung 6 — die synchrone Sperre", () => {
  it("das Einbuchen geht durch `dispatch`, nie direkt an das Eltern-Element", () => {
    expect(bookArea).toContain("dispatch(item.id, () =>");
    expect(section).not.toContain("onItemAction(");
    expect(DETAILS).toContain("dispatchItemAction(dispatching.current, key, onItemAction, run)");
  });

  it("beide Knöpfe der Rückfrage sind währenddessen gesperrt", () => {
    expect(bookArea.split("disabled={running}")).toHaveLength(3);
    expect(bookArea).toContain("running ? copy.itemRunning");
  });

  it("und die Spur selbst ebenso, damit nichts parallel aufgeht", () => {
    expect(bookBranch.split("disabled={running}")).toHaveLength(3);
  });

  it("die Freigabe der Sperre ist ausgeführt geprüft, nicht zugesichert", () => {
    const lock = read("src/lib/orderbook/dispatch-lock.ts");
    expect(lock).toContain("if (held.has(key)) return false;");
    expect(lock).toContain("if (!started) held.delete(key);");
  });
});

describe("Anforderungen 7 und 8 — die Reihenfolge ist die Regel", () => {
  it("mayBook steht VOR mayRemap, sonst wäre Einbuchen unerreichbar", () => {
    /*
     * DIE WICHTIGSTE ZUSICHERUNG DIESER DATEI.
     *
     * `canBook` gilt nur für `ordered`, `arrived` und `showcase` — und für
     * genau diese Zustände ist `canRemapItem` ebenfalls wahr, weil eine nicht
     * gebuchte Position keine Lagerbewegung hat. Die beiden Regeln treffen
     * also dieselbe Zeile. Stünde `mayRemap` zuerst, gewänne „Ändern" immer
     * und „Einbuchen" erschiene nie.
     */
    for (const state of ["ordered", "arrived", "showcase"] as const) {
      expect(canBook({ state, skyId: "SKY-0001" }), state).toBe(true);
      expect(canRemapItem({ state, movementId: null }), state).toBe(true);
    }
    const i = section.indexOf("actions={isBooked ? (");
    const b = section.indexOf(") : mayBook ? (");
    const r = section.indexOf(") : mayRemap ? (");
    expect(i).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(i);
    expect(r).toBeGreaterThan(b);
  });

  it("jeder Zustand bekommt genau eine Zuordnung", () => {
    /* gebucht → ein Knopf; buchbar → zwei Zeichen; sonst → ein Wort. */
    const booked = section.slice(section.indexOf("actions={isBooked ? ("),
                                 section.indexOf(") : mayBook ? ("));
    const remap = section.slice(section.indexOf(") : mayRemap ? ("),
                                section.indexOf(") : undefined}"));
    expect(booked.split("<button")).toHaveLength(2);
    expect(bookBranch.split("<button")).toHaveLength(3);
    expect(remap.split("<button")).toHaveLength(2);
    /* Und ein Zustand ohne Aktion bekommt keine leere Spalte voller
       gesperrter Knöpfe, sondern nichts. */
    expect(section).toContain(") : undefined}");
  });

  it("das Öffnen einer Fläche schliesst die andere", () => {
    /*
     * `mayBook` und `mayRemap` gelten für dieselbe Zeile. Ohne das wären
     * Rückfrage und Suchfeld gleichzeitig offen — zwei Bearbeitungsbereiche
     * unter einer Zeile, von denen nur einer gemeint ist.
     */
    const toggles = section.slice(section.indexOf("const toggleBook = () => {"),
                                  section.indexOf("return ("));
    expect(toggles).toContain("setRemapping(null);");
    expect(toggles).toContain("setConfirmingBook(null);");
  });

  it("die Rücknahme behält ihr eigenes Zeichen und ihre eigene Frage", () => {
    expect(copy.errors.bookIcon).not.toBe(copy.errors.unbookIcon);
    expect(copy.errors.bookConfirm).not.toBe(copy.errors.unbookConfirm);
    expect(copy.errors.bookYes).not.toBe(copy.errors.unbookYes);
  });
});

describe("Anforderung 9 — die Detailseite bleibt unverändert", () => {
  it("sie behält ihren eigenen Pfad und kennt die Fenster-Varianten nicht", () => {
    expect(ITEMS).toContain("bookPurchaseItem(");
    expect(ITEMS).not.toContain("processBookPurchaseItem");
    expect(ITEMS).not.toContain("confirmingBook");
    expect(ITEMS).not.toContain("dispatchItemAction");
  });

  it("und das Fenster benutzt nicht ihre", () => {
    expect(DETAILS).not.toMatch(/(?<![A-Za-z])bookPurchaseItem\(item\.id, purchase\.id\)/);
  });
});

describe("was in diesem Schritt NICHT entstanden ist", () => {
  it("kein Hinzufügen, kein Entfernen, keine Stapelbuchung, keine 0121", () => {
    for (const forbidden of ["addPurchaseItem", "AddPurchaseItem", "removePurchaseItem",
                             "seller_apply_purchase_items", "bookAll", "processBookAll",
                             "PURCHASE_DRAFT_STATES", "endingsFor", "copy.settle"]) {
      expect(DETAILS, forbidden).not.toContain(forbidden);
    }
    /*
     * UND KEINE STAPELBUCHUNG IN DER DATENBANK.
     *
     * Hier stand „es gibt keine Migration 0121". Das war die Nummer als
     * Stellvertreter für die Sache, und der Stellvertreter ist überholt:
     * `0121` existiert inzwischen, sie legt aber Absender-, Inserats- und
     * Vereinbarungsfelder an und keine Stapelbuchung. Geprüft wird jetzt die
     * SACHE — keine Migration dieses Projekts kennt eine Funktion, die
     * mehrere Positionen auf einmal einbucht.
     */
    const dir = join(process.cwd(), "supabase/migrations");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
      const sql = readFileSync(join(dir, file), "utf8");
      expect(sql, file).not.toContain("seller_apply_purchase_items");
      expect(sql, file).not.toContain("seller_book_purchase_items(");
    }
  });

  it("und die schreibenden Aufrufe des Abschnitts sind genau drei", () => {
    const called = [...new Set([...section.matchAll(/\b(process[A-Za-z]+)\(/g)]
      .map((m) => m[1]))].sort();
    expect(called).toEqual(["processBookPurchaseItem", "processPurchaseItemSky",
                            "processUnbookPurchaseItem"]);
  });
});
