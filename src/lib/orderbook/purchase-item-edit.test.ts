/**
 * Figuren hinzufügen und entfernen (`0126`).
 *
 * ZWEI SCHICHTEN, GETRENNT GEPRÜFT.
 *
 * Der lokale Bearbeitungszustand ist reine Logik und wird AUSGEFÜHRT: dass
 * „Abbrechen" wirklich alles verwirft, dass eine gebuchte Figur keinen
 * Papierkorb bekommt, dass eine vorgemerkte Zeile stehen bleibt. Die
 * Atomarität, die Rechte und der Lagerschutz liegen dagegen in der Datenbank
 * — dort wird der Quelltext der Migration geprüft, denn ohne PostgreSQL ist
 * das die einzige ehrliche Form.
 */
import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";

import { de } from "@/lib/i18n/de";

import { code, latestFunction, migrationSource } from "@/test-support/migrations";
import {
  addFigure, dropNew, emptyEdit, isDirty, needsReceiptConfirm, savePayload,
  stageRows, stagedCount, toggleRemove, type NewFigure, type PendingEdit,
} from "@/lib/orderbook/purchase-item-edit";
import type { PurchaseItem } from "@/lib/orderbook/queries";

const FILE = "0126_purchase_item_edit.sql";
const sql = migrationSource(FILE);
const exec = code(sql);
const saveFn = code(latestFunction("seller_save_purchase_edit").body);
const DE = readFileSync("src/lib/i18n/de.ts", "utf8");
const modal = de.business.orderbook.detailsModal;

/** Eine offene Position: nicht gebucht, keine Legacy-Herkunft. */
const open = (over: Partial<PurchaseItem> = {}): PurchaseItem => ({
  id: 1, position: 1, skyId: "SKY-0001", name: "Spyro", rawName: null,
  seriesCode: null, seriesLabel: null, condition: "loose", state: "ordered",
  marketPrice: 12, priceIsFrozen: false, movementId: null,
  legacyConditionFlag: null, legacyBookedFlag: null, sourceRow: null, ...over,
});
const neu = (over: Partial<NewFigure> = {}): NewFigure => ({
  tempId: "t1", skyId: "SKY-0002", rawName: null, label: "Gill Grunt",
  condition: "loose", ...over,
});

/* ==========================================================================
 * 1. Der lokale Zustand — und dass Abbrechen ihn wegwirft
 * ======================================================================== */

describe("der Bearbeitungszustand sammelt, er schreibt nicht", () => {
  it("leer heißt nicht verändert", () => {
    expect(isDirty(emptyEdit)).toBe(false);
  });

  it("eine vorgemerkte Entfernung macht ihn verändert", () => {
    expect(isDirty(toggleRemove(emptyEdit, 7))).toBe(true);
  });

  it("eine neue Figur ebenso", () => {
    expect(isDirty(addFigure(emptyEdit, neu()))).toBe(true);
  });

  it("ABBRECHEN verwirft alles — `emptyEdit` ist der ganze Rückweg", () => {
    /*
     * Das ist die Zusicherung hinter Anforderung 5. Es gibt keinen
     * Teilzustand, der ein Abbrechen überlebt: der Dialog setzt eine
     * Konstante, und `emptyEdit` ist eingefroren.
     */
    let pending: PendingEdit = emptyEdit;
    pending = addFigure(pending, neu());
    pending = toggleRemove(pending, 3);
    pending = addFigure(pending, neu({ tempId: "t2" }));
    expect(isDirty(pending)).toBe(true);
    expect(isDirty(emptyEdit)).toBe(false);
    expect(emptyEdit.add).toEqual([]);
    expect(emptyEdit.remove).toEqual([]);
  });

  it("und keine Funktion verändert den übergebenen Zustand", () => {
    /* Sonst wäre `emptyEdit` nach dem ersten Klick nicht mehr leer. */
    const vorher: PendingEdit = { add: [neu()], remove: [5], swap: [] };
    const kopie = JSON.parse(JSON.stringify(vorher));
    toggleRemove(vorher, 9);
    addFigure(vorher, neu({ tempId: "tX" }));
    dropNew(vorher, "t1");
    expect(vorher).toEqual(kopie);
  });

  it("derselbe Klick nimmt die Vormerkung zurück", () => {
    const einmal = toggleRemove(emptyEdit, 4);
    expect(toggleRemove(einmal, 4).remove).toEqual([]);
  });

  it("eine neue Figur verschwindet sofort und ganz", () => {
    const mit = addFigure(emptyEdit, neu());
    expect(dropNew(mit, "t1").add).toEqual([]);
  });
});

/* ==========================================================================
 * 2. Was die Liste zeigt
 * ======================================================================== */

describe("die Liste zeigt den Stand von nachher, ohne etwas zu verstecken", () => {
  const items = [open({ id: 1 }), open({ id: 2, position: 2 })];

  it("vorgemerkte Zeilen bleiben SICHTBAR, nur ausgegraut", () => {
    /*
     * Eine Zeile verschwinden zu lassen, die noch da ist, wäre eine
     * Behauptung über einen Zustand, den der Server nicht kennt — und nach
     * einem Abbrechen wäre sie unerklärlich wieder da.
     */
    const rows = stageRows(items, toggleRemove(emptyEdit, 1));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: "existing", removed: true });
    expect(rows[1]).toMatchObject({ kind: "existing", removed: false });
  });

  it("neue Figuren hängen unten, in der Reihenfolge der Auswahl", () => {
    const pending = addFigure(addFigure(emptyEdit, neu()), neu({ tempId: "t2" }));
    const rows = stageRows(items, pending);
    expect(rows.map((r) => r.kind)).toEqual(["existing", "existing", "new", "new"]);
    expect(rows[2]).toMatchObject({ kind: "new", figure: { tempId: "t1" } });
  });

  it("die Zahl danach rechnet beides ein", () => {
    const pending = addFigure(toggleRemove(emptyEdit, 1), neu());
    expect(stagedCount(items, pending)).toBe(2);
    expect(stagedCount(items, emptyEdit)).toBe(2);
    expect(stagedCount(items, toggleRemove(emptyEdit, 1))).toBe(1);
  });
});

/* ==========================================================================
 * 3. Lagerintegrität — kein nutzloser Papierkorb
 * ======================================================================== */

describe("der Papierkorb erscheint nur, wo er etwas tun kann", () => {
  /*
   * `mayRemove` spiegelt `seller_remove_purchase_item`. Eine Handlung, die
   * immer abgelehnt würde, ist schlimmer als eine fehlende — angeboten wird
   * sie deshalb nicht, und der Grund steht als Text daneben.
   */
  /*
   * Die Herkunft des EINKAUFS steht hier nicht mehr: seit ADR-0126
   * entscheidet die Zeile. Was die Arbeitsmappe schützt, sind ihre eigenen
   * Merkmale — `reconciled_legacy` und die beiden Legacy-Flaggen.
   */
  const darf = (item: Partial<PurchaseItem>) => {
    const rows = stageRows([open(item)], emptyEdit);
    return rows[0].kind === "existing" ? rows[0].mayRemove : null;
  };

  it("eine offene Position darf entfernt werden", () => {
    expect(darf({})).toBe(true);
  });

  it("eine EINGEBUCHTE nicht — sie besitzt eine Lagerbewegung", () => {
    expect(darf({ state: "booked", movementId: 99 })).toBe(false);
  });

  it("auch nicht, wenn nur die Bewegung da ist", () => {
    expect(darf({ movementId: 99 })).toBe(false);
  });

  it("auch nicht, wenn nur der Zustand `booked` sagt", () => {
    expect(darf({ state: "booked" })).toBe(false);
  });

  it("eine Arbeitsmappenzeile nicht — erkannt an ihrem Zustand", () => {
    /* ADR-0126: nicht mehr am Einkauf, sondern an der Zeile. Der Import gibt
       jeder Zeile `reconciled_legacy` (0053, 0088). */
    expect(darf({ state: "reconciled_legacy" })).toBe(false);
    expect(darf({ legacyBookedFlag: "x" })).toBe(false);
    expect(darf({ legacyConditionFlag: "lose" })).toBe(false);
  });

  it("eine NACHGETRAGENE Zeile an einem importierten Einkauf schon", () => {
    /* Sie trägt keines der Arbeitsmappen-Merkmale — und genau deshalb darf
       der Betreiber einen Fehlgriff wieder zurücknehmen. */
    expect(darf({ state: "ordered" })).toBe(true);
  });

  it("und die Erklärungen dafür stehen in de.ts", () => {
    expect(DE).toContain("removeBlockedBooked:");
    expect(DE).toContain("erst zurückbuchen, dann entfernen");
    expect(DE).toContain("removeBlockedLegacy:");
  });
});

/* ==========================================================================
 * 4. Eigenbeleg — die Rückfrage
 * ======================================================================== */

describe("ein vorhandener Eigenbeleg verlangt eine Bestätigung", () => {
  it("bei einer Positionsänderung ja", () => {
    expect(needsReceiptConfirm(true, toggleRemove(emptyEdit, 1))).toBe(true);
    expect(needsReceiptConfirm(true, addFigure(emptyEdit, neu()))).toBe(true);
  });

  it("ohne Positionsänderung nicht — Kosten und Notiz berühren den Hash nicht", () => {
    /*
     * `0122` hasht `lines`, aber nicht `note` und nicht `updated_at`. Eine
     * Kostenkorrektur macht keinen Beleg veraltet, also fragt hier nichts.
     */
    expect(needsReceiptConfirm(true, emptyEdit)).toBe(false);
  });

  it("und ohne Beleg gibt es nichts zu bestätigen", () => {
    expect(needsReceiptConfirm(false, toggleRemove(emptyEdit, 1))).toBe(false);
  });

  it("der Text sagt, dass der Beleg unveränderlich bleibt", () => {
    /*
     * GEPRÜFT WIRD DER FERTIGE SATZ, nicht seine Schreibweise in der Quelle.
     *
     * Und er behauptet nichts über Gültigkeit: dieses Fenster weiß, was
     * gespeichert ist — eine rechtliche Einordnung ist nicht seine Sache.
     */
    const satz = modal.receiptWarnBody("SI-E-2026-000001");
    expect(satz).toContain("möglicherweise nicht mehr");
    expect(satz).toContain("SI-E-2026-000001");
    expect(satz).toContain("unverändert gespeichert");
    expect(satz).not.toContain("gültig");
    expect(satz).not.toContain("rechtlich");
    expect(modal.receiptWarnHeading).toContain("bereits ein Eigenbeleg ausgestellt");
  });
});

/* ==========================================================================
 * 5. Was an den Server geht
 * ======================================================================== */

describe("die Nutzlast ist genau der Unterschied", () => {
  it("eine Katalogfigur schickt die SKY-ID und keinen Rohnamen", () => {
    const p = addFigure(emptyEdit, neu({ skyId: "SKY-0042", rawName: "egal" }));
    expect(savePayload(p).add).toEqual([
      { sky_id: "SKY-0042", raw_name: null, condition: "loose" },
    ]);
  });

  it("eine Figur ohne SKY-ID schickt den Namen", () => {
    const p = addFigure(emptyEdit, neu({ skyId: null, rawName: "Unbekannt" }));
    expect(savePayload(p).add).toEqual([
      { sky_id: null, raw_name: "Unbekannt", condition: "loose" },
    ]);
  });

  it("und die IDs zum Entfernen unverändert", () => {
    expect(savePayload({ add: [], remove: [3, 9], swap: [] }).remove).toEqual([3, 9]);
  });
});

/* ==========================================================================
 * 6. Die Datenbank — Atomarität, Rechte, Nebenläufigkeit
 * ======================================================================== */

describe("0126 speichert in EINER Transaktion", () => {
  it("ein Aufruf, der Felder UND Positionen anfasst", () => {
    expect(saveFn).toContain("public.seller_update_purchase(");
    expect(saveFn).toContain("public.seller_remove_purchase_item(");
    expect(saveFn).toContain("public.seller_add_purchase_item(");
  });

  it("und schreibt keine Regel neu", () => {
    /*
     * DER KERN DER FREIGABE: keine Lockerung. Die drei gerufenen Funktionen
     * tragen ihre Prüfungen selbst — hier wird nichts davon wiederholt und
     * nichts umgangen.
     */
    expect(saveFn).not.toContain("inventory_movements");
    expect(saveFn).not.toContain("shop_inventory");
    expect(saveFn).not.toContain("purchase_receipts");
    expect(saveFn).not.toContain("delete from");
    expect(saveFn).not.toContain("movement_id is not null");
  });

  it("entfernen kommt VOR hinzufügen", () => {
    /* Sonst zählte `max(position) + 1` auf eine Zeile, die gleich verschwindet. */
    expect(saveFn.indexOf("seller_remove_purchase_item"))
      .toBeLessThan(saveFn.indexOf("seller_add_purchase_item"));
  });

  it("die Position muss zu DIESEM Einkauf gehören", () => {
    /*
     * Ohne diese Prüfung könnte ein manipulierter Aufruf eine fremde Zeile
     * entfernen — deren Einkauf wurde nie gesperrt und nie versionsgeprüft.
     */
    expect(saveFn).toContain("i.purchase_id = p_id");
    expect(saveFn).toContain("does not belong to purchase");
  });

  it("und setzt für neue Figuren keinen Zustand", () => {
    /* Der Tabellendefault `ordered` bleibt stehen, `movement_id` NULL. */
    expect(saveFn).not.toContain("'booked'");
    expect(saveFn).not.toMatch(/state\s*=/);
  });
});

describe("Berechtigung und Nebenläufigkeit", () => {
  it("das Betreibertor ist die erste Anweisung", () => {
    const begin = saveFn.indexOf("begin");
    expect(saveFn.indexOf("can_operate_active_seller()")).toBeGreaterThan(begin);
    expect(saveFn.indexOf("can_operate_active_seller()"))
      .toBeLessThan(saveFn.indexOf("for update"));
  });

  it("security definer mit leerem search_path, und anon darf nicht", () => {
    expect(exec).toContain("security definer");
    expect(exec).toContain("set search_path = ''");
    expect(exec).toContain("from public, anon;");
    expect(exec).toContain("to authenticated;");
  });

  it("die Einkaufszeile wird gesperrt, bevor etwas geschrieben wird", () => {
    expect(saveFn).toContain("for update");
    expect(saveFn.indexOf("for update"))
      .toBeLessThan(saveFn.indexOf("seller_update_purchase("));
  });

  it("und eine veraltete Bearbeitung endet als PT409, nicht als Wiederholung", () => {
    /*
     * 40001 hieße „versuch es nochmal", und das Gateway tut das bis zum
     * Timeout. Eine veraltete Bearbeitung ist nicht flüchtig.
     */
    expect(saveFn).toContain("errcode = 'PT409'");
    expect(saveFn).not.toContain("serialization_failure");
  });

  it("die neue Version kommt zurück", () => {
    /* Sonst prüfte das nächste Speichern gegen den eigenen alten Stand. */
    expect(saveFn).toContain("'updated_at', v_actual");
  });
});

describe("der Trigger macht updated_at zur Version des ganzen Einkaufs", () => {
  it("er steht auf purchase_items, AFTER, für alle drei Ereignisse", () => {
    expect(exec).toContain("after insert or update or delete on public.purchase_items");
    expect(exec).toContain("for each row execute function public.purchase_items_touch_purchase()");
  });

  it("und bewegt purchases.updated_at", () => {
    const trg = code(latestFunction("purchase_items_touch_purchase").body);
    expect(trg).toContain("update public.purchases");
    expect(trg).toContain("set updated_at = now()");
    expect(trg).toContain("coalesce(new.purchase_id, old.purchase_id)");
  });

  it("die Triggerfunktion ist für niemanden ausführbar", () => {
    expect(exec).toContain(
      "revoke all on function public.purchase_items_touch_purchase()");
  });

  it("und die Nachbedingung prüft die Triggerform, nicht nur seinen Namen", () => {
    /* ROW + AFTER + insert/update/delete = 1 + 4 + 8 + 16. */
    expect(exec).toContain("(1 + 4 + 8 + 16)");
  });
});

describe("0126 fasst nichts an, was schon angewendet ist", () => {
  it("keine bestehende Funktion wird ersetzt", () => {
    for (const fn of ["seller_update_purchase", "seller_add_purchase_item",
                      "seller_remove_purchase_item", "purchase_receipt_fingerprint",
                      "seller_orderbook_ledger"]) {
      expect(exec, fn).not.toContain(`create or replace function public.${fn}(`);
    }
  });

  it("und der Lagerschutz in 0064 wird als vorhanden geprüft", () => {
    expect(exec).toContain("der Lagerschutz in seller_remove_purchase_item ist verschwunden");
  });

  it("sie liegt lückenlos hinter 0125", () => {
    expect(FILE.slice(0, 4)).toBe("0126");
  });
});
