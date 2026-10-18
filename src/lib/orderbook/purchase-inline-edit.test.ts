/**
 * Bearbeiten an Ort und Stelle statt in einem angehängten Block.
 *
 * WAS SICH GEÄNDERT HAT UND WARUM.
 *
 * „Bearbeiten" klappte bisher UNTER der Detailansicht einen zweiten
 * Abschnitt auf, der jede Angabe ein zweites Mal zeigte — einmal als Zeile
 * zum Lesen, einmal als Feld zum Ändern. Das Fenster wurde dadurch doppelt
 * so lang, der Speichern-Knopf stand ganz unten, und wer die Plattform
 * ändern wollte, scrollte an allem vorbei, was er gerade gelesen hatte.
 *
 * Jetzt wird jede Angabe an ihrer Stelle zum Feld. Der angehängte Abschnitt
 * ist ersatzlos weg; `modal.edit` kommt im Bauteil nur noch als Beschriftung
 * des Knopfes vor.
 *
 * DREI ZUSICHERUNGEN TRAGEN DIESE DATEI.
 *
 * 1. KEIN ZWEITER BLOCK. Es gibt genau vier Abschnitte, und der letzte ist
 *    die Figurentabelle.
 * 2. ABBRECHEN VERWIRFT WIRKLICH. Entwurf und Kontakt werden aus denselben
 *    Funktionen neu gebaut, die auch der Eintritt benutzt — es wird nichts
 *    zugeklappt, es wird zurückgesetzt.
 * 3. DIE SICHERUNGEN AUS 0121 STEHEN UNVERÄNDERT. Die neun Felder erscheinen
 *    erst nach dem Laden, und `save` schickt sie erst dann.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { de } from "@/lib/i18n/de";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const DETAILS = read("src/components/business/purchase-details.tsx");
const TABLE = read("src/components/business/purchase-item-table.tsx");
const modal = de.business.orderbook.detailsModal;

/** Der Inhalt eines Abschnitts, von seiner Überschrift bis zur nächsten. */
function section(title: string): string {
  const at = DETAILS.indexOf(`<Section title={${title}}>`);
  expect(at, title).toBeGreaterThan(-1);
  const next = DETAILS.indexOf("<Section title={", at + 1);
  return DETAILS.slice(at, next === -1 ? undefined : next);
}

/* ==========================================================================
 * 1. Kein zusätzlicher Bearbeitungsbereich
 * ======================================================================== */

describe("der angehängte Bearbeitungsblock ist weg", () => {
  it("es gibt keinen Abschnitt `modal.edit` mehr", () => {
    expect(DETAILS).not.toContain("<Section title={modal.edit}>");
  });

  it("`modal.edit` steht nur noch am Knopf", () => {
    expect(DETAILS.split("modal.edit")).toHaveLength(2);
    expect(DETAILS).toContain("{modal.edit}\n");
  });

  it("und der Umschalter „Fertig“ ist verschwunden", () => {
    /*
     * `done` hiess „zuklappen". Mit der Bearbeitung an Ort und Stelle ist
     * das Gegenstück zu Speichern nicht mehr Zuklappen, sondern Verwerfen.
     */
    expect(DETAILS).not.toContain("modal.done");
    expect(DETAILS).not.toContain("setEditing((on) => !on)");
  });

  it("genau fünf Abschnitte, in fester Reihenfolge", () => {
    /*
     * DIESER TEST HAT EINEN FEHLER GEHABT. Sein Muster suchte
     * `modal.\w+` — der Eigenbeleg-Abschnitt aus `0122` heisst aber
     * `receiptCopy.section` und wurde deshalb NICHT mitgezählt. Die Zusicherung
     * „genau vier" blieb grün, während es fünf waren. Jetzt zählt das Muster
     * jeden Abschnitt, wie er auch benannt ist.
     */
    const titles = [...DETAILS.matchAll(/<Section title=\{([\w.]+)\}>/g)].map((m) => m[1]);
    expect(titles).toEqual([
      "modal.purchase", "modal.costs", "modal.senderSection", "modal.figures",
      "receiptCopy.section",
    ]);
  });
});

/* ==========================================================================
 * 2. Jede Angabe an ihrer Stelle
 * ======================================================================== */

describe("die Felder stehen dort, wo vorher die Werte standen", () => {
  const purchase = section("modal.purchase");

  it("Kaufdatum: Zeile oder Feld, an derselben Stelle", () => {
    expect(purchase).toContain("{editing ? (");
    expect(purchase).toContain('<input type="date" value={draft.purchasedAt}');
    expect(purchase).toContain("<Line label={copy.columns.date}");
  });

  it("Plattform, Verkäufer, Zahlungsmethode, Referenz und Notiz ebenso", () => {
    for (const [control, line] of [
      ["value={draft.platform}", "<Line label={modal.platform}"],
      ["value={draft.seller}", "<Line label={modal.seller}"],
      ["value={draft.payment}", "<Line label={modal.payment}"],
      ["value={draft.reference}", "<Line label={modal.reference}"],
      ["value={draft.note}", "<Line label={modal.note}"],
    ] as [string, string][]) {
      expect(purchase, control).toContain(control);
      expect(purchase, line).toContain(line);
    }
  });

  it("Referenz und Notiz erscheinen im Bearbeiten IMMER", () => {
    /*
     * In der Ansicht stehen sie nur, wenn sie gefüllt sind — eine leere
     * Zeile behauptete sonst, da fehle etwas. Im Bearbeiten müssen sie
     * stehen: ein Feld, das man nicht sieht, kann man nicht füllen.
     */
    const editing = purchase.slice(purchase.indexOf("{editing ? (\n            <>"));
    const view = purchase.slice(purchase.indexOf(") : (\n            <>"));
    expect(editing).toContain("<Field label={modal.reference}>");
    expect(editing).toContain("<Field label={modal.note}>");
    expect(view).toContain("{purchase.externalRef");
    expect(view).toContain("{purchase.note ?");
  });

  it("die Kosten werden im Kostenabschnitt bearbeitet, nicht anderswo", () => {
    const costs = section("modal.costs");
    for (const needle of ["value={draft.items}", "value={draft.shipping}",
                          "value={draft.protection}", "{modal.clearSplit}",
                          "modal.splitHint"]) {
      expect(costs, needle).toContain(needle);
    }
    /* Die Summe rechnet beim Tippen mit. */
    expect(costs).toContain("value={formatPrice(typed.total)}");
    /* Marktwert und Faktor bleiben Anzeige — sie werden nicht getippt. */
    expect(costs).toContain("<Line label={copy.columns.marketValue}");
    expect(costs).toContain("<Line label={copy.columns.factor}");
  });

  it("die neun Felder aus 0121 stehen im Absenderabschnitt", () => {
    const sender = section("modal.senderSection");
    for (const field of ["senderName", "senderStreet", "senderPostalCode", "senderCity",
                         "senderCountry", "listingTitle", "listingUrl", "listingDetails",
                         "agreementNote"]) {
      expect(sender, field).toContain(`contact.${field}`);
    }
    /* Die Kaufvereinbarung ist mehrzeilig. */
    expect(sender).toContain("<textarea value={contact.agreementNote}");
    expect(sender).toContain("<textarea value={contact.listingDetails}");
  });
});

/* ==========================================================================
 * 3. Die Knöpfe oben rechts
 * ======================================================================== */

describe("Speichern, Abbrechen und Schliessen", () => {
  const head = DETAILS.slice(DETAILS.indexOf("<Modal open={open}"),
                             DETAILS.indexOf("<div className=\"min-h-0 flex-1"));

  it("im Bearbeiten stehen Speichern und Abbrechen oben", () => {
    expect(head).toContain("{saving ? modal.saving : modal.save}");
    expect(head).toContain("{modal.cancel}");
    expect(head).toContain("onClick={() => void save()}");
    expect(head).toContain("onClick={cancelEditing}");
  });

  it("Schliessen steht in beiden Zuständen", () => {
    /* Ausserhalb der Verzweigung: ein `onClose`-Knopf, immer sichtbar. */
    expect(head).toContain("{modal.close}");
    const branch = head.slice(head.indexOf("editing ? ("), head.indexOf("{modal.close}"));
    expect(branch).not.toContain("{modal.close}");
  });

  it("während des Speicherns ist keine zweite Aktion möglich", () => {
    /*
     * Gezählt werden KNÖPFE, nicht Zeichenketten: der Kommentar über den
     * beiden erklärt `disabled={saving}` und wurde von der ersten Fassung
     * mitgezählt — drei Treffer für zwei Knöpfe.
     */
    const branch = head.slice(head.indexOf("editing ? ("), head.indexOf("{modal.close}"));
    const guarded = branch.split('<button type="button" disabled={saving}');
    expect(guarded).toHaveLength(3);
  });

  it("die drei Beschriftungen sagen drei verschiedene Dinge", () => {
    /*
     * `Abbrechen` ist neu und ersetzt nicht `Schliessen`: das eine verwirft
     * Eingaben und bleibt im Fenster, das andere geht hinaus. Stünde
     * zweimal dasselbe Wort, wäre eine der beiden Handlungen eine
     * Überraschung.
     */
    expect(modal.save).toBe("Speichern");
    expect(modal.cancel).toBe("Abbrechen");
    expect(modal.edit).toBe("Bearbeiten");
    expect(modal.saving.length).toBeGreaterThan(0);
    expect(new Set([modal.save, modal.cancel, modal.close, modal.edit]).size).toBe(4);
  });

  it("und in der Ansicht steht nur Bearbeiten", () => {
    expect(head).toContain("onClick={startEditing}");
    expect(head).toContain("{editing ? (");
    /*
     * ADR-0126: das Tor für `excel_order_2026` ist weg — auch ein
     * historischer Einkauf wird bearbeitet. Was ihn schützt, sind die Regeln
     * darunter, nicht ein fehlender Knopf.
     */
    expect(head).not.toContain('purchase.source === "excel_order_2026" ? null');
  });
});

/* ==========================================================================
 * 4. Eintritt, Verwerfen, Erfolg
 * ======================================================================== */

describe("Eintritt und Verwerfen bauen denselben Stand", () => {
  it("beide gehen über dieselben zwei Funktionen", () => {
    for (const fn of ["function startEditing()", "function cancelEditing()"]) {
      const at = DETAILS.indexOf(fn);
      expect(at, fn).toBeGreaterThan(-1);
      const body = DETAILS.slice(at, DETAILS.indexOf("\n  }", at));
      expect(body, fn).toContain("setDraft(draftOf(purchase));");
      expect(body, fn).toContain("setContact(contactOf(record));");
      expect(body, fn).toContain("setError(null);");
    }
  });

  it("Eintritt schaltet ein, Verwerfen schaltet aus", () => {
    const start = DETAILS.slice(DETAILS.indexOf("function startEditing()"));
    expect(start.slice(0, start.indexOf("\n  }"))).toContain("setEditing(true);");
    const cancel = DETAILS.slice(DETAILS.indexOf("function cancelEditing()"));
    expect(cancel.slice(0, cancel.indexOf("\n  }"))).toContain("setEditing(false);");
  });

  it("der Entwurf wird aus der AKTUELLEN Zeile gebaut, nicht aus der von vorhin", () => {
    /*
     * `router.refresh()` erneuert die Ledger-Zeile, während das Fenster
     * offen ist — eine Einbuchung tut genau das. Würde „Bearbeiten" den
     * Entwurf vom Einhängen weiterbenutzen, trüge er alte Werte.
     */
    expect(DETAILS).toContain("function draftOf(purchase: LedgerRow) {");
    expect(DETAILS).toContain("function contactOf(record: PurchaseRecord | null) {");
    expect(DETAILS).toContain("useState(() => draftOf(purchase))");
    expect(DETAILS).toContain("useState(() => contactOf(null))");
  });

  it("nach erfolgreichem Speichern steht wieder die Ansicht da", () => {
    /* Seit `0126` ein Aufruf für Felder UND Figuren — siehe dort, warum. */
    expect(DETAILS).toContain("const saved = await run(() => savePurchaseEdit(");
    /*
     * UND SEIT DER TRENNUNG VON SPEICHERN UND NACHLESEN IST ES EIN FRÜHER
     * AUSSTIEG. `if (saved) setEditing(false)` stand am Ende; jetzt steht
     * `if (!saved) return;` am Anfang, und alles darunter gilt nur für den
     * Erfolg. Dieselbe Zusicherung, eine andere Form.
     */
    const save = DETAILS.slice(DETAILS.indexOf("async function save("));
    const body = save.slice(0, save.indexOf("\n  }"));
    expect(body).toContain("if (!saved) return;");
    expect(body.indexOf("if (!saved) return;"))
      .toBeLessThan(body.indexOf("setEditing(false);"));
  });

  it("bei einem Fehler bleiben die Eingaben stehen", () => {
    /*
     * `run` setzt bei `ok === false` die Meldung und gibt `false` zurück;
     * `setEditing(false)` läuft dann nicht, und kein Entwurf wird
     * zurückgesetzt. Die Felder tragen weiter, was getippt wurde.
     */
    const run = DETAILS.slice(DETAILS.indexOf("async function run("));
    const body = run.slice(0, run.indexOf("\n  }"));
    expect(body).toContain("if (!result.ok) { setError(result.message ?? null); return false; }");
    expect(body).toContain("return true;");
  });
});

/* ==========================================================================
 * 5. Was unverändert bleiben musste
 * ======================================================================== */

describe("die Sicherungen und die Figurentabelle", () => {
  it("die neun Felder werden erst nach dem Laden geschickt", () => {
    expect(DETAILS).toContain("...(record === null ? {} : {");
  });

  it("und erscheinen erst nach dem Laden überhaupt", () => {
    const sender = section("modal.senderSection");
    expect(sender.indexOf("{modal.recordLoading}"))
      .toBeLessThan(sender.indexOf("contact.senderName"));
  });

  it("der Wechsel zwischen Einkäufen vermischt nichts", () => {
    expect(DETAILS).toContain("let alive = true;");
    expect(DETAILS).toContain("return () => { alive = false; };");
    expect(read("src/components/business/orderbook-ledger.tsx"))
      .toContain("<PurchaseDetails key={showingRow.id}");
  });

  it("die NULL-/Leerstring-Bedeutung ist unberührt", () => {
    /* Getrimmt gesendet: "" löscht, `undefined` lässt stehen. Unverändert. */
    expect(DETAILS).toContain("senderName: contact.senderName.trim(),");
    expect(DETAILS).toContain("sellerName: draft.seller.trim(),");
    expect(DETAILS).toContain('platform: draft.platform.trim() === "" ? undefined : draft.platform.trim(),');
  });

  it("keine RPC und keine Signatur wurde angefasst", () => {
    /*
     * `updatePurchase(` kommt nur noch EINMAL vor: der Knopf, der die
     * Kostenaufteilung wegräumt, schreibt weiter sofort — er ist eine
     * einzelne Handlung und kein Teil des gestapelten Speicherns.
     * Das Speichern selbst geht seit `0126` über `savePurchaseEdit`.
     */
    expect(DETAILS.split("updatePurchase(")).toHaveLength(2);
    expect(DETAILS.split("savePurchaseEdit(")).toHaveLength(2);
    expect(DETAILS).toContain("processBookPurchaseItem(item.id, purchase.id)");
    expect(DETAILS).toContain("processUnbookPurchaseItem(item.id, purchase.id)");
    expect(DETAILS).toContain("processPurchaseItemSky(item.id, choice.skyId, purchase.id)");
  });

  it("die Figurentabelle und ihre Aktionen sind unverändert", () => {
    expect(TABLE).toContain('"sm:grid-cols-[minmax(0,1fr)_7rem_6.5rem_4.5rem]"');
    expect(DETAILS).toContain("actions={isBooked ? (");
    expect(DETAILS).toContain(") : mayBook ? (");
    expect(DETAILS).toContain(") : mayRemap ? (");
    expect(DETAILS).toContain("dispatchItemAction(dispatching.current, key, onItemAction, run)");
  });
});

/* ==========================================================================
 * 6. Schmale Bildschirme
 * ======================================================================== */

describe("die Felder brechen sauber um", () => {
  it("eine Zeile aus Beschriftung und Feld darf umbrechen", () => {
    expect(DETAILS).toContain(
      'className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-0.5 text-sm"');
  });

  it("und ein Feld wird nie breiter als sein Platz", () => {
    expect(DETAILS).toContain('"min-h-9 max-w-full rounded-sky-md bg-surface');
  });

  it("die mehrzeiligen Felder nehmen die ganze Breite", () => {
    expect(DETAILS).toContain('const AREA =\n  "min-h-20 w-full rounded-sky-md');
  });

  it("das Fenster wächst nicht um einen zweiten Satz derselben Angaben", () => {
    /*
     * Die eigentliche Messung gegen den alten Zustand: jede Angabe kommt
     * genau EINMAL als Eingabefeld vor. Vorher stand sie zusätzlich als
     * Zeile darüber — zwei Darstellungen desselben Werts gleichzeitig.
     */
    for (const value of ["value={draft.platform}", "value={draft.seller}",
                         "value={draft.payment}", "value={draft.reference}",
                         "value={draft.note}", "value={draft.items}",
                         "value={contact.senderName}", "value={contact.agreementNote}"]) {
      expect(DETAILS.split(value), value).toHaveLength(2);
    }
  });
});
