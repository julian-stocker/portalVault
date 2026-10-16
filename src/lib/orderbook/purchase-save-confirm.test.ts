/**
 * „Trotzdem speichern“ — die Rückfrage bei vorhandenem Eigenbeleg.
 *
 * DREI FEHLER AUS EINEM STAGING-TEST, UND SIE SAHEN WIE EINER AUS.
 *
 * Gemeldet wurde: die Warnung erschien, „Trotzdem speichern“ liess sich nicht
 * anklicken, ein zweiter Klick auf `Speichern` schloss den Bearbeitungsmodus,
 * die Änderung war weg und der Beleg galt weiter. Tatsächlich waren es drei
 * unabhängige Defekte:
 *
 *   1. „Trotzdem speichern“ war ein `<p>` und kein Knopf. Durchkam man nur
 *      über ein zweites `Speichern` oben — undurchschaubar.
 *   2. `onSaved` im Einkaufsbuch verwarf den Zwischenspeicher der
 *      Figurenliste nicht. Das Speichern lief, danach wurde aus der ALTEN
 *      Liste gezeichnet: die Änderung sah verworfen aus.
 *   3. Das Fenster las den Belegzustand nur beim Öffnen. `stale` kommt aus
 *      einem Fingerabdruck, nicht aus `updated_at` — ohne zweites Nachlesen
 *      blieb „gültig“ stehen, obwohl der Beleg veraltet war.
 *
 * Geprüft wird am Quelltext, weil dieses Projekt keine DOM-Tests fährt. Das
 * ist die ehrliche Grenze: diese Datei sichert die STRUKTUR der Abläufe, nicht
 * das Rendern im Browser.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { de } from "@/lib/i18n/de";
import {
  emptyEdit, needsReceiptConfirm, savePayload, swapFigure,
} from "@/lib/orderbook/purchase-item-edit";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const DETAILS = read("src/components/business/purchase-details.tsx");
const LEDGER = read("src/components/business/orderbook-ledger.tsx");
const ACTIONS = read("src/lib/orderbook/actions.ts");
const modal = de.business.orderbook.detailsModal;

/** Quelltext ohne Kommentare — geprüft wird, was der Code tut. */
const strip = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/** Der Rumpf von `save()`, ohne Prosa. */
const SAVE = (() => {
  const at = DETAILS.indexOf("async function save(");
  expect(at).toBeGreaterThan(-1);
  const ende = DETAILS.indexOf("\n  }\n", at);
  return strip(DETAILS.slice(at, ende));
})();

/* ==========================================================================
 * 1. Die Rückfrage ist ein Knopf
 * ======================================================================== */

describe("„Trotzdem speichern“ ist anklickbar", () => {
  it("es ist ein button, kein Absatz", () => {
    /* DER FEHLER SELBST: ein Satz, der eine Handlung verspricht. */
    expect(DETAILS).not.toContain("<p className=\"mt-1 text-muted\">{modal.receiptWarnConfirm}</p>");
    expect(strip(DETAILS)).toMatch(
      /<button type="button" disabled=\{saving\} aria-busy=\{saving\}[\s\S]{0,120}save\(true\)/);
  });

  it("und er trägt den Text aus de.ts", () => {
    expect(DETAILS).toContain("{saving ? modal.saving : modal.receiptWarnConfirm}");
    expect(modal.receiptWarnConfirm).toBe("Trotzdem speichern");
  });

  it("während des Speicherns ist er gesperrt und sagt es", () => {
    expect(modal.saving).not.toBe(modal.save);
    const knopf = strip(DETAILS).slice(strip(DETAILS).indexOf("save(true)") - 400,
                                      strip(DETAILS).indexOf("save(true)") + 200);
    expect(knopf).toContain("disabled={saving}");
    expect(knopf).toContain("aria-busy={saving}");
  });

  it("sie verschwindet, wenn der Grund weg ist", () => {
    /* Zurückgenommener Wechsel heisst: nichts zu bestätigen. Die Anzeige
       hängt an derselben Bedingung wie das Tor in `save`. */
    expect(strip(DETAILS)).toContain(
      "{receiptPrompt && receipt !== null\n                   && needsReceiptConfirm(receipt !== null, pending) ? (");
    expect(needsReceiptConfirm(true, emptyEdit)).toBe(false);
  });

  it("der zweite Knopf schliesst nur die Frage und verwirft NICHTS", () => {
    expect(DETAILS).toContain("onClick={() => setReceiptPrompt(false)}");
    expect(DETAILS).toContain("{modal.receiptWarnBack}");
    expect(modal.receiptWarnBack).toContain("Zurück");
    /* Er darf keinen Bearbeitungszustand anfassen. */
    const stelle = DETAILS.indexOf("setReceiptPrompt(false)}");
    const umfeld = DETAILS.slice(stelle - 200, stelle + 200);
    expect(umfeld).not.toContain("setPending");
    expect(umfeld).not.toContain("cancelEditing");
  });
});

/* ==========================================================================
 * 2. Nur ein ausdrücklicher Klick schreibt
 * ======================================================================== */

describe("die Zustimmung ist ein Argument, kein geratener Zustand", () => {
  it("save nimmt sie entgegen", () => {
    expect(DETAILS).toContain("async function save(receiptConfirmed = false)");
  });

  it("das Tor fragt das Argument, nicht den Anzeigezustand", () => {
    expect(SAVE).toContain("needsReceiptConfirm(receipt !== null, pending) && !receiptConfirmed");
    /* `receiptPrompt` ist reine Anzeige — es darf das Tor nicht öffnen. */
    expect(SAVE).not.toContain("!receiptPrompt");
    /* Der Name ist weg — im Code. Im Kommentar steht er noch, als Grund. */
    expect(strip(DETAILS)).not.toContain("receiptAck");
  });

  it("und save(true) steht an GENAU EINER Stelle: in der Warnung", () => {
    const treffer = strip(DETAILS).match(/save\(true\)/g) ?? [];
    expect(treffer).toHaveLength(1);
    const vor = strip(DETAILS).slice(0, strip(DETAILS).indexOf("save(true)"));
    expect(vor.lastIndexOf("receiptWarnHeading"))
      .toBeGreaterThan(vor.lastIndexOf("function save("));
  });

  it("der Speichern-Knopf oben fragt weiter — er bestätigt nicht", () => {
    expect(DETAILS).toContain("onClick={() => void save()}");
  });
});

/* ==========================================================================
 * 3. Was bei einem Fehler stehen bleibt
 * ======================================================================== */

describe("ein Fehler verwirft nichts", () => {
  it("ein nicht gespeicherter Versuch verlässt save SOFORT", () => {
    /*
     * DER FRÜHE AUSSTIEG IST DIE GANZE ZUSICHERUNG. Alles, was den
     * Bearbeitungsstand anfasst, steht darunter — also gilt es nur für den
     * Erfolg. Vorher war es ein `if (saved) { … }` um einen Teil davon und
     * ein zweites `if (saved)` weiter unten; ein Nachlesen lief dazwischen
     * auch im Fehlerfall und überschrieb die Absenderfelder.
     */
    const ausstieg = SAVE.indexOf("if (!saved) return;");
    expect(ausstieg).toBeGreaterThan(-1);
    expect((SAVE.match(/if \(!saved\) return;/g) ?? [])).toHaveLength(1);
    expect(ausstieg).toBeGreaterThan(SAVE.indexOf("const saved = await run("));
    for (const ruf of ["setPending(emptyEdit)", "setAdding(false)",
                       "setSwapping(null)", "setReceiptPrompt(false)",
                       "setEditing(false)", "await readRecord()",
                       "await readReceipt()"]) {
      expect(SAVE.indexOf(ruf), ruf).toBeGreaterThan(ausstieg);
    }
  });

  it("und der Bearbeitungsmodus wird nur bei Erfolg verlassen", () => {
    const alle = SAVE.match(/setEditing\(/g) ?? [];
    expect(alle).toHaveLength(1);
    expect(SAVE).toContain("setEditing(false);");
  });

  it("nach einer Ablehnung wird NICHT nachgelesen", () => {
    /*
     * `readRecord` setzt Absender- und Inseratsfelder aus dem Server neu.
     * Lief es nach einer Ablehnung, überschrieb es genau die Eingabe, die
     * stehen bleiben soll. Beide Leser stehen deshalb hinter dem Ausstieg.
     */
    const ausstieg = SAVE.indexOf("if (!saved) return;");
    expect(SAVE.slice(0, ausstieg)).not.toContain("readRecord");
    expect(SAVE.slice(0, ausstieg)).not.toContain("readReceipt");
  });

  it("die Meldung kommt aus der Antwort und wird gesetzt, nicht verschluckt", () => {
    const RUN = strip(DETAILS.slice(DETAILS.indexOf("async function run("),
                                    DETAILS.indexOf("async function save(")));
    expect(RUN).toContain("if (!result.ok) { setError(result.message ?? null); return false; }");
  });

  it("ein Versionskonflikt ist ein eigener Satz, kein allgemeiner Fehler", () => {
    expect(ACTIONS).toContain("PT409");
    expect(modal.stalePurchase).toContain("inzwischen an anderer Stelle geändert");
    /* Und er sagt ausdrücklich, dass nichts gespeichert wurde. */
    expect(modal.stalePurchase).toContain("nicht gespeichert");
  });

  it("Abbrechen bleibt die einzige Handlung, die verwirft", () => {
    const CANCEL = strip(DETAILS.slice(DETAILS.indexOf("function cancelEditing()"),
                                       DETAILS.indexOf("async function run(")));
    expect(CANCEL).toContain("setPending(emptyEdit)");
    expect(CANCEL).toContain("setReceiptPrompt(false)");
    /* Zwei Stellen setzen `emptyEdit`: Abbrechen und der Erfolgszweig. */
    const treffer = strip(DETAILS).match(/setPending\(emptyEdit\)/g) ?? [];
    expect(treffer).toHaveLength(2);
  });
});

/* ==========================================================================
 * 4. Nach dem Erfolg zeigt das Fenster, was wirklich dasteht
 * ======================================================================== */

describe("der Zwischenspeicher der Figurenliste wird nach dem Speichern verworfen", () => {
  /*
   * DAS WAR DER DEFEKT, DER WIE EIN VERWERFEN AUSSAH. `router.refresh()`
   * erneuert die Ledger-Zeile, aber `items[id]` ist Client-Zustand dieses
   * Buches — ihn erneuert nur dieses Buch.
   */
  const ONSAVED = (() => {
    const at = LEDGER.indexOf("onSaved={() => {");
    expect(at).toBeGreaterThan(-1);
    return strip(LEDGER.slice(at, LEDGER.indexOf("}} />", at)));
  })();

  it("der Eintrag wird weggenommen, nicht überschrieben", () => {
    expect(ONSAVED).toContain("setItems((current) => {");
    expect(ONSAVED).toContain("delete next[showingRow.id];");
  });

  it("und sofort neu geladen, ohne die Doppelklicksperre zu erben", () => {
    expect(ONSAVED).toContain("loading.current.delete(showingRow.id);");
    expect(ONSAVED).toContain("load(showingRow.id);");
  });

  it("die Ledger-Zeile kommt weiter vom Server", () => {
    expect(ONSAVED).toContain("router.refresh();");
    expect(ONSAVED).toContain("delete next[showingRow.id]");
  });
});

describe("der Belegzustand wird nach dem Speichern neu gelesen", () => {
  it("es gibt eine Funktion dafür, und sie liest nur", () => {
    expect(DETAILS).toContain(
      "const readReceipt = useCallback(async (): Promise<boolean> => {");
    const at = DETAILS.indexOf("const readReceipt = useCallback");
    const rumpf = strip(DETAILS.slice(at, DETAILS.indexOf("}, [purchase.id]);", at)));
    expect(rumpf).toContain("loadPurchaseReceipt(purchase.id)");
    expect(rumpf).toContain("setReceipt(result.receipt)");
    expect(rumpf).not.toContain("issuePurchaseReceipt");
  });

  it("sie läuft NUR bei Erfolg, und nach dem Nachlesen des Datensatzes", () => {
    expect(SAVE).toContain("const belegFrisch = await readReceipt();");
    expect(SAVE.indexOf("const satzFrisch = await readRecord();"))
      .toBeLessThan(SAVE.indexOf("const belegFrisch = await readReceipt();"));
    expect(SAVE.indexOf("if (!saved) return;"))
      .toBeLessThan(SAVE.indexOf("const satzFrisch = await readRecord();"));
  });

  it("und ALLE DREI laufen, auch wenn der erste scheitert", () => {
    /* `&&` würde die folgenden Leser überspringen — und dann fehlte
       ausgerechnet die Veralterungsmarkierung oder die Belegkette (0128). */
    expect(SAVE).toContain("const ketteFrisch = await readHistory();");
    expect(SAVE).not.toMatch(/readRecord\(\)\s*&&\s*await readReceipt/);
    expect(SAVE).not.toMatch(/readReceipt\(\)\s*&&\s*await readHistory/);
    expect(SAVE).toContain("setRefreshFailed(!(satzFrisch && belegFrisch && ketteFrisch));");
  });

  it("und das Fenster zeigt `stale` überhaupt an", () => {
    expect(DETAILS).toContain("{receipt.stale ?");
    expect(de.business.orderbook.receipt.stale.length).toBeGreaterThan(10);
  });
});

/* ==========================================================================
 * 5. Die Nutzlast, die wirklich hinausgeht
 * ======================================================================== */

describe("die Nutzlast des bestätigten Speicherns", () => {
  it("ein Wechsel fährt als p_swap mit", () => {
    const pending = swapFigure(emptyEdit, 7, "SKY-0001",
                               { itemId: 7, skyId: "SKY-0210", label: "Spyro (Giants)" });
    expect(savePayload(pending).swap).toEqual([{ item_id: 7, sky_id: "SKY-0210" }]);
    expect(ACTIONS).toContain("p_swap: items.swap ?? []");
  });

  it("und genau dieser Wechsel löst die Rückfrage aus", () => {
    const pending = swapFigure(emptyEdit, 7, "SKY-0001",
                               { itemId: 7, skyId: "SKY-0210", label: "Spyro (Giants)" });
    expect(needsReceiptConfirm(true, pending)).toBe(true);
    /* Ohne Beleg wird nicht gefragt — die Rückfrage hängt am Beleg. */
    expect(needsReceiptConfirm(false, pending)).toBe(false);
  });

  it("der Dialog schickt die vorgemerkte Liste und die gelesene Version", () => {
    expect(SAVE).toContain("const payload = savePayload(pending);");
    expect(SAVE).toContain("payload,");
    expect(SAVE).toContain("purchase.updatedAt,");
  });

  it("und ein Speichern ohne Positionsänderung geht ungefragt durch", () => {
    expect(needsReceiptConfirm(true, emptyEdit)).toBe(false);
    expect(savePayload(emptyEdit)).toEqual({ add: [], remove: [], swap: [] });
  });
});

/* ==========================================================================
 * 6. Gespeichert ist gespeichert — auch wenn das Nachlesen scheitert
 * ======================================================================== */

describe("die Aktualisierung ist von der Speicherung getrennt", () => {
  /*
   * DER STAGING-BEFUND, DER DAZU GEFÜHRT HAT. Einkauf #105 wurde geschrieben,
   * der Beleg wich danach ab — und die Oberfläche zeigte den Stand von vorher.
   * Umgekehrt darf sie einen bestätigten Schreibvorgang nicht in Zweifel
   * ziehen, nur weil das Nachlesen danach nicht ging: der Betreiber würde ein
   * zweites Mal speichern, und das ist der Fall, für den `PT409` existiert.
   */
  const RELOAD = (() => {
    const at = DETAILS.indexOf("async function reloadNow()");
    expect(at).toBeGreaterThan(-1);
    return strip(DETAILS.slice(at, DETAILS.indexOf("\n  }\n", at)));
  })();

  it("zwei getrennte Zustände: Fehler und veraltete Anzeige", () => {
    expect(DETAILS).toContain("const [refreshFailed, setRefreshFailed] = useState(false);");
    expect(DETAILS).toContain("const [reloading, setReloading] = useState(false);");
  });

  it("beide Leser melden ihr Ergebnis zurück, statt es zu verschlucken", () => {
    expect(DETAILS).toContain("const readRecord = useCallback(async (): Promise<boolean>");
    expect(DETAILS).toContain("const readReceipt = useCallback(async (): Promise<boolean>");
  });

  it("die Warnung hängt am Nachlesen, nicht am Speichern", () => {
    expect(SAVE).toContain("setRefreshFailed(!(satzFrisch && belegFrisch && ketteFrisch));");
    /* Sie darf nicht in die Fehlerspur geraten: `setError` gehört `run`. */
    expect(SAVE).not.toContain("setError(modal.saveRefreshFailed)");
  });

  it("sie ist ein Hinweis mit Knopf, keine Fehlermeldung", () => {
    const at = DETAILS.indexOf("{refreshFailed ? (");
    expect(at).toBeGreaterThan(-1);
    const block = DETAILS.slice(at, at + 1200);
    expect(block).toContain('role="status"');
    expect(block).not.toContain('role="alert"');
    expect(block).toContain("{modal.saveRefreshFailed}");
    expect(block).toContain("void reloadNow()");
    expect(block).toContain("disabled={reloading}");
    expect(block).toContain("aria-busy={reloading}");
    expect(block).toContain("{reloading ? modal.saveRefreshRetrying : modal.saveRefreshRetry}");
  });

  it("der Satz sagt, dass gespeichert WURDE — und nennt den Beleg mit", () => {
    expect(modal.saveRefreshFailed).toContain("Gespeichert");
    expect(modal.saveRefreshFailed).toContain("nicht aktualisiert");
    expect(modal.saveRefreshFailed).toContain("Eigenbeleg");
    /* Kein Wort, das einen fehlgeschlagenen Schreibvorgang behauptet. */
    expect(modal.saveRefreshFailed).not.toContain("fehlgeschlagen");
    expect(modal.saveRefreshFailed).not.toContain("nicht gespeichert");
    expect(modal.saveRefreshRetry).toBe("Erneut laden");
  });

  it("erneutes Laden liest nur und schreibt nichts", () => {
    expect(RELOAD).toContain("await readRecord()");
    expect(RELOAD).toContain("await readReceipt()");
    expect(RELOAD).toContain("setRefreshFailed(!frisch);");
    for (const schreibend of ["savePurchaseEdit", "updatePurchase", "issuePurchaseReceipt",
                              "setPending", "setEditing"]) {
      expect(RELOAD, schreibend).not.toContain(schreibend);
    }
  });

  it("und es erneuert auch den Zwischenspeicher des Buches — aber nur bei Erfolg", () => {
    expect(RELOAD).toContain("if (frisch) onSaved();");
  });

  it("ein neuer Versuch beginnt ohne die Warnung des vorigen", () => {
    const RUN = strip(DETAILS.slice(DETAILS.indexOf("async function run("),
                                    DETAILS.indexOf("async function save(")));
    expect(RUN).toContain("setRefreshFailed(false);");
    expect(RUN).toContain("setError(null);");
  });
});

/* ==========================================================================
 * 7. Der Warntext nennt alle drei Handlungen
 * ======================================================================== */

describe("die Belegwarnung sagt, was passiert", () => {
  const satz = modal.receiptWarnBody("SI-E-2026-000001");

  it("sie nennt austauschen, hinzufügen und entfernen", () => {
    expect(satz).toContain("austauschst");
    expect(satz).toContain("hinzufügst");
    expect(satz).toContain("entfernst");
  });

  it("sie nennt den Beleg, um den es geht", () => {
    expect(satz).toContain("SI-E-2026-000001");
  });

  it("und sagt, was mit ihm geschieht: nichts, aber er wird gekennzeichnet", () => {
    expect(satz).toContain("nicht geändert");
    expect(satz).toContain("nicht neu ausgestellt");
    expect(satz).toContain("unverändert gespeichert");
    expect(satz).toContain("abweichend gekennzeichnet");
  });

  it("sie behauptet nichts über Gültigkeit oder Recht", () => {
    expect(satz).not.toContain("gültig");
    expect(satz).not.toContain("rechtlich");
    expect(satz).not.toContain("ungültig");
  });

  it("und die Kennzeichnung, die sie verspricht, gibt es wirklich", () => {
    /* `stale` aus dem Fingerabdruckvergleich, angezeigt im Belegabschnitt. */
    expect(DETAILS).toContain("{receipt.stale ?");
    expect(de.business.orderbook.receipt.stale.length).toBeGreaterThan(10);
  });
});
