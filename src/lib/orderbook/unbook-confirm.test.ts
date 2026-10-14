/**
 * Die Rücknahme einer Einbuchung: zwei Klicks, und zwei erklärte Ablehnungen.
 *
 * ZWEI ZUSICHERUNGEN TRAGEN DIESE DATEI.
 *
 * 1. DER ERSTE KLICK SCHREIBT NICHTS. Er setzt einen Zustand und sonst nichts
 *    — keine Server Action, kein Netzaufruf, keine Datenänderung. `Abbrechen`
 *    ebenso. Erst der bestätigte Klick ruft `unbookPurchaseItem`.
 *
 * 2. DIE LAGERABLEHNUNGEN SIND ERKLÄRT. `apply_inventory_movement` weist eine
 *    Rücknahme ab, die den Bestand unter das Reservierte drücken würde, und
 *    nennt seit `0093` welcher der beiden Gründe es war. Auf der Einkaufsseite
 *    fiel das bis hierher in „konnte nicht gespeichert werden" — ausgerechnet
 *    für den häufigsten Fall: die Figur ist schon verkauft oder für eine
 *    Bestellung gehalten.
 *
 * WAS INZWISCHEN DAZUGEKOMMEN IST: die Rücknahme im (i)-Fenster, geprüft in
 * den unteren Blöcken dieser Datei. Das Einbuchen im Fenster kam danach und
 * hat seine eigene Datei, `book-confirm.test.ts` — dieselbe Form, dieselben
 * zwei Zusicherungen. Der Satz, der hier stand („beides nicht freigegeben"),
 * war richtig, als er geschrieben wurde, und ist es seit zwei Freigaben
 * nicht mehr.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { de } from "@/lib/i18n/de";
import { allMigrations, code, latestFunction } from "@/test-support/migrations";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const ACTIONS = read("src/lib/orderbook/actions.ts");
const ITEMS = read("src/components/business/purchase-items.tsx");
const DETAILS = read("src/components/business/purchase-details.tsx");
const TABLE = read("src/components/business/purchase-item-table.tsx");
const SALES_ACTIONS = read("src/lib/orderbook/sales-actions.ts");

/** Quelltext ohne Kommentare — geprüft wird, was der Code tut. */
const strip = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const errors = de.business.orderbook.errors;

/** Der Rumpf von `orderbookMessage`, ohne Prosa. */
const MAPPER = (() => {
  const at = ACTIONS.indexOf("function orderbookMessage");
  return strip(ACTIONS.slice(at, ACTIONS.indexOf("\n}", at)));
})();

/* Die Sätze, die die Datenbank wirklich wirft — wortgleich aus 0093. */
const DB_NO_STOCK =
  "insufficient stock for SKY-0001 / loose: 0 on hand, movement of -1";
const DB_RESERVED =
  "movement would consume reserved stock for SKY-0001 / loose: 1 on hand, 1 reserved";

describe("die zwei Lagerablehnungen sind übersetzt", () => {
  it("beide werden im Einkaufs-Mapper abgebildet", () => {
    expect(MAPPER).toContain('text.includes("insufficient stock for")');
    expect(MAPPER).toContain('text.includes("would consume reserved stock")');
    expect(MAPPER).toContain("errors.unbookNoStock");
    expect(MAPPER).toContain("errors.unbookReserved");
  });

  it("die Sätze sprechen von ZURÜCKNEHMEN, nicht von Ausbuchen", () => {
    /*
     * Im Verkauf heisst die Handlung „ausbuchen" und richtet sich nach vorn;
     * hier heisst sie „zurücknehmen" und nach hinten. Derselbe Riegel, eine
     * andere Frage — ein geteilter Satz müsste eines von beiden falsch nennen.
     */
    expect(errors.unbookNoStock).toContain("zurücknehmen");
    expect(errors.unbookReserved).toContain("zurücknehmen");
    expect(errors.unbookNoStock).not.toContain("ausbuchen");
    expect(errors.unbookReserved).not.toContain("ausbuchen");
    /* Und sie sind NICHT die Sätze des Verkaufsbuchs. */
    const sale = de.business.sales.errors as Record<string, unknown>;
    expect(errors.unbookNoStock).not.toBe(sale.noStock);
    expect(errors.unbookReserved).not.toBe(sale.reserved);
  });

  it("jeder nennt seine Ursache, nicht nur einen Fehlschlag", () => {
    expect(errors.unbookNoStock).toMatch(/verkauft|Bestand/);
    expect(errors.unbookReserved).toMatch(/reserviert|Bestellung/);
    for (const text of [errors.unbookNoStock, errors.unbookReserved]) {
      expect(text).not.toMatch(/constraint|check_violation|23514/);
      expect(text.length).toBeGreaterThan(40);
    }
  });

  it("die beiden Sätze sind unterscheidbar — das war der Sinn von 0093", () => {
    /*
     * Bis `0093` warf die Datenbank für beide denselben Satz, und weil er das
     * Wort „reserved" enthielt, suchte der Betreiber auch für eine Figur ohne
     * jeden Bestand nach einer Bestellung, die es nicht gab.
     */
    expect(errors.unbookNoStock).not.toBe(errors.unbookReserved);
    const apply = code(latestFunction("apply_inventory_movement").body);
    expect(apply).toContain("insufficient stock for");
    expect(apply).toContain("movement would consume reserved stock for");
  });

  it("keine ältere Regel fängt die zwei Meldungen vorher ab", () => {
    /*
     * Die Reihenfolge im Mapper entscheidet: die erste Übereinstimmung
     * gewinnt. Also darf kein früher geprüftes Textstück in einer der beiden
     * echten Datenbankmeldungen vorkommen.
     */
    const earlier = [
      "already in inventory", "not a catalog figure", "damaged item", "never arrived",
    ];
    for (const needle of earlier) {
      expect(DB_NO_STOCK, needle).not.toContain(needle);
      expect(DB_RESERVED, needle).not.toContain(needle);
    }
    /* Und umgekehrt: die zwei neuen Prüfungen stehen hinter diesen vier. */
    for (const needle of earlier) {
      expect(MAPPER.indexOf(needle), needle)
        .toBeLessThan(MAPPER.indexOf("insufficient stock for"));
    }
  });

  it("und die späteren Regeln treffen sie nicht", () => {
    for (const later of ["purchases_cost_", "no place to swap", "a purchase needs its date",
                         "with different content", "must not move stock"]) {
      expect(DB_NO_STOCK, later).not.toContain(later);
      expect(DB_RESERVED, later).not.toContain(later);
    }
  });

  it("der Verkaufs-Mapper behält seine eigenen Sätze", () => {
    expect(SALES_ACTIONS).toContain('if (text.includes("insufficient stock for")) return copy.errors.noStock;');
    expect(SALES_ACTIONS).toContain('if (text.includes("would consume reserved stock")) return copy.errors.reserved;');
  });
});

describe("zwei Klicks, und der erste schreibt nichts", () => {
  /** Der `isBooked`-Zweig der Positionszeile. */
  const branch = (() => {
    const at = ITEMS.indexOf("{isBooked ? (");
    return ITEMS.slice(at, ITEMS.indexOf(") : nonCatalog ? (", at));
  })();

  it("der erste Klick setzt NUR den Zustand", () => {
    expect(branch).toContain("onClick={() => setConfirmingUnbook(item.id)}");
    /*
     * Und zwar nachweislich nichts weiter: der Rumpf dieses Handlers ist ein
     * einziger Aufruf. Stünde `unbook(item)` daneben, wäre die Rückfrage eine
     * Verzierung über einer bereits geschriebenen Gegenbewegung.
     */
    const first = branch.slice(branch.indexOf("onClick={() => setConfirmingUnbook(item.id)}"));
    expect(first.slice(0, 60)).not.toContain("unbook(");
  });

  it("nur der bestätigte Klick ruft die Server Action", () => {
    const confirmed = branch.slice(branch.indexOf("confirmingUnbook === item.id ? ("));
    expect(confirmed).toContain("onClick={() => unbook(item)}");
    expect(confirmed).toContain("errors.unbookYes");
    /* Genau EIN Aufruf von `unbook(` im ganzen Zweig. */
    expect(branch.split("unbook(item)")).toHaveLength(2);
  });

  it("Abbrechen setzt nur den Zustand zurück", () => {
    expect(branch).toContain("onClick={() => setConfirmingUnbook(null)}");
    expect(branch).toContain("errors.unbookCancel");
    const cancel = branch.slice(branch.indexOf("onClick={() => setConfirmingUnbook(null)}"));
    expect(cancel.slice(0, 60)).not.toContain("unbook(");
  });

  it("die Rückfrage nennt ihre Folge, nicht nur die Frage", () => {
    expect(branch).toContain("errors.unbookConfirm");
    expect(branch).toContain("errors.unbookConfirmHint");
    expect(errors.unbookConfirmHint).toContain("Gegenbewegung");
    expect(errors.unbookConfirmHint).toContain("Journal");
    /* Vorgelesen wird sie auch. */
    expect(branch).toContain('role="alert"');
  });

  it("eine Position auf einmal, wie bei den anderen Korrekturen", () => {
    expect(ITEMS).toContain("const [confirmingUnbook, setConfirmingUnbook] = useState<number | null>(null);");
    expect(ITEMS).toContain("const [remapping, setRemapping] = useState<number | null>(null);");
    expect(ITEMS).toContain("const [correcting, setCorrecting] = useState<number | null>(null);");
  });

  it("und die Rücknahme räumt die offene Rückfrage auf", () => {
    const fn = ITEMS.slice(ITEMS.indexOf("function unbook(item: PurchaseItem)"));
    expect(fn.slice(0, fn.indexOf("\n  }"))).toContain("setConfirmingUnbook(null);");
  });

  it("KEIN Modal — die Rückfrage steht in der Zeile", () => {
    const b = strip(branch);
    for (const forbidden of ["<Modal", "window.confirm", "confirm(", "createPortal"]) {
      expect(b, forbidden).not.toContain(forbidden);
    }
  });
});

describe("Lagerlogik, RPCs und Schutzregeln unverändert", () => {
  it("keine Migration fasst die Rücknahme oder die Bewegungen an", () => {
    for (const fn of ["seller_unbook_purchase_item", "record_inventory_movement",
                      "apply_inventory_movement", "seller_book_purchase_item"]) {
      const file = latestFunction(fn).file;
      expect(Number(file.slice(0, 4)), fn).toBeLessThan(119);
    }
  });

  it("die Rücknahme ist weiter eine GEGENBEWEGUNG, keine Zustandsschreibung", () => {
    const body = code(latestFunction("seller_unbook_purchase_item").body);
    expect(body).toContain("public.record_inventory_movement(");
    expect(body).toContain("-1, 'correction'");
    /* Die ursprüngliche Bewegung wird nicht gelöscht. */
    expect(body).not.toContain("delete from public.inventory_movements");
    expect(body).not.toContain("update public.inventory_movements");
  });

  it("und sie bleibt nicht idempotent — mit Absicht", () => {
    /*
     * Ein zweiter Aufruf bricht ab (`state <> 'booked'`). Eine idempotente
     * Rücknahme hiesse, er schriebe still eine zweite `−1` — ein echter
     * Bestandsfehler. Das Einbuchen ist umgekehrt idempotent, weil ein
     * Doppelklick dort sonst zwei `+1` erzeugte.
     */
    const un = code(latestFunction("seller_unbook_purchase_item").body);
    expect(un).toContain("this item is not in inventory");
    expect(un).toContain("for update");
    const book = code(latestFunction("seller_book_purchase_item").body);
    expect(book).toContain("return v_item.movement_id;");
  });

  it("der Riegel gegen verkaufte und reservierte Figuren ist unberührt", () => {
    const apply = code(latestFunction("apply_inventory_movement").body);
    expect(apply).toMatch(/quantity \+ p_delta >= reserved/);
    expect(apply).toContain("for update");
  });

  it("die Server Action der Detailseite ist unverändert", () => {
    expect(ACTIONS).toContain('rpc("seller_unbook_purchase_item", { p_item_id: itemId })');
    expect(ACTIONS).toContain("export async function unbookPurchaseItem(");
  });

  it("die Fenster-Variante benutzt DASSELBE RPC, nur einen anderen Rückweg", () => {
    /*
     * `processUnbookPurchaseItem` ist der vierte Vertreter derselben Familie
     * wie `processPurchaseItemSky`: dasselbe RPC, `runPurchaseItem` statt
     * `run`, damit die frische Positionsliste in derselben Antwort kommt.
     *
     * Es ist KEIN zweiter Weg zur Rücknahme — die Lagerlogik liegt
     * unverändert in `seller_unbook_purchase_item`.
     */
    const fn = ACTIONS.slice(ACTIONS.indexOf("export async function processUnbookPurchaseItem"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body).toContain('runPurchaseItem("seller_unbook_purchase_item"');
    expect(body).toContain("{ p_item_id: itemId }");
    expect(body).not.toMatch(/\brun\("/);
    /* Genau zwei Aufrufer des RPC, und beide nennen es beim Namen. */
    expect(ACTIONS.split('"seller_unbook_purchase_item"')).toHaveLength(3);
    /* Keine eigene Lagerlogik in der neuen Action. */
    for (const forbidden of ["record_inventory_movement", "shop_inventory",
                             "movement_id", "correction"]) {
      expect(body, forbidden).not.toContain(forbidden);
    }
  });

  it("niemand setzt den Zustand als Ersatz für eine Rückbuchung", () => {
    for (const source of [ITEMS, DETAILS, TABLE]) {
      expect(strip(source)).not.toContain('"arrived", purchaseId');
      expect(strip(source)).not.toContain("movement_id");
    }
  });
});

describe("was in diesem Schritt NICHT entstanden ist", () => {
  it("Rücknahme UND Einbuchen stehen im (i)-Fenster, beide über dispatch", () => {
    /*
     * Hier stand zweimal eine Abgrenzung, die inzwischen überholt ist: zuerst
     * „nichts davon im Fenster", dann „die Rücknahme ja, das Einbuchen
     * nicht". Beide waren richtig, als sie geschrieben wurden. Jetzt sind
     * beide Aktionen dort, und die Prüfung nennt sie namentlich.
     */
    expect(DETAILS).toContain("processUnbookPurchaseItem(item.id, purchase.id)");
    expect(DETAILS).toContain("processBookPurchaseItem(item.id, purchase.id)");
    expect(DETAILS).toContain("confirmingUnbook");
    expect(DETAILS).toContain("confirmingBook");
    /*
     * Und zwar über die Varianten mit frischer Liste, nicht über die der
     * Detailseite: `unbookPurchaseItem` und `bookPurchaseItem` stossen
     * `revalidatePath` an und geben keine Positionen zurück.
     */
    expect(DETAILS).not.toContain("unbookPurchaseItem(item.id, purchase.id)");
    /*
     * Wortgrenze, nicht „irgendein Zeichen davor": `[^s]` traf das `n` in
     * `processUnbookPurchaseItem` und verbot damit die Zeile, die hier
     * ausdrücklich stehen soll. Dieselbe Falle wie die Verbotslisten in
     * `purchase-details-figures.test.ts` — Teilzeichenketten prüfen nicht,
     * was sie zu prüfen scheinen.
     */
    expect(DETAILS).not.toMatch(/(?<![A-Za-z])bookPurchaseItem\(item\.id, purchase\.id\)/);
    /* Ein Zustandswechsel bleibt draussen. */
    expect(DETAILS).not.toContain("processPurchaseItemState");
  });

  it("keine Änderung an der Figurentabelle oder ihren Spuren", () => {
    expect(TABLE).toContain('const READ_TRACKS =');
    expect(TABLE).toContain('"sm:grid-cols-[minmax(0,1fr)_7rem_6.5rem_4.5rem]"');
    /* Die Aktionsspur ist noch 4,5rem — sie wächst erst, wenn Variante A kommt. */
    expect(TABLE).not.toContain("_9rem]");
  });

  it("kein Entfernen und kein Hinzufügen im (i)-Fenster", () => {
    for (const forbidden of ["removePurchaseItem", "addPurchaseItem", "AddPurchaseItem"]) {
      expect(DETAILS, forbidden).not.toContain(forbidden);
    }
  });

  it("und keine neue Migration", () => {
    expect(allMigrations).not.toContain("seller_apply_purchase_items");
    expect(allMigrations.split("0121_")).toHaveLength(1);
  });
});

/* =========================================================================
 * DIE RÜCKNAHME IM (i)-FENSTER — Variante A, erster Teil
 * ====================================================================== */

describe("die kompakte Aktion", () => {
  const section = (() => {
    const at = DETAILS.indexOf("<Section title={modal.figures}>");
    return DETAILS.slice(at, DETAILS.indexOf("</Section>", at));
  })();

  it("erscheint nur bei state === \"booked\"", () => {
    expect(section).toContain('const isBooked = item.state === "booked";');
    /* Die Rücknahme steht jetzt am ANFANG der Verzweigung, nicht in der
       Mitte: `isBooked` schliesst `mayBook` und `mayRemap` beide aus. */
    expect(section).toContain("actions={isBooked ? (");
  });

  it("und nie zusammen mit „Ändern“ oder „Einbuchen“", () => {
    /*
     * `canRemapItem` ist für eine gebuchte Position falsch (`movementId !==
     * null`) und `canBook` ebenso — die Rücknahme steht deshalb ALLEIN in
     * der Spur, auch jetzt, wo eine buchbare Zeile zwei Zeichen zeigt.
     *
     * Die Verzweigung ist `isBooked ? ↩ : mayBook ? ↓✎ : mayRemap ? Ändern
     * : undefined`, und `isBooked` zuerst heisst: eine gebuchte Zeile kommt
     * an den anderen Zweigen nicht vorbei.
     */
    expect(section).toContain("actions={isBooked ? (");
    expect(section).toContain(") : mayBook ? (");
    expect(section).toContain(") : mayRemap ? (");
    expect(section).toContain(") : undefined}");
    /* Der Rücknahme-Zweig enthält genau einen Knopf. */
    const branch = section.slice(section.indexOf("actions={isBooked ? ("),
                                 section.indexOf(") : mayBook ? ("));
    expect(branch.split("<button")).toHaveLength(2);
  });

  it("ist ein Zeichen mit Beschriftung, kein breiter Knopf", () => {
    /*
     * „Buchung zurücknehmen" braucht bei `text-xs` mit Innenrand etwa
     * 6,6rem; die Spur ist 4,5rem und darf nicht wachsen. Dasselbe Verfahren
     * wie beim Plus-Menü der grossen Tabelle: ein Zeichen, `aria-hidden`,
     * und die Handlung im `aria-label`.
     */
    expect(section).toContain("aria-label={copy.unbook}");
    expect(section).toContain("title={copy.unbook}");
    expect(section).toContain('<span aria-hidden="true">{copy.errors.unbookIcon}</span>');
    expect(de.business.orderbook.errors.unbookIcon.length).toBeLessThanOrEqual(2);
    /* Und die Spurenliste ist unverändert. */
    expect(TABLE).toContain('"sm:grid-cols-[minmax(0,1fr)_7rem_6.5rem_4.5rem]"');
  });
});

describe("der erste Klick öffnet nur die Rückfrage", () => {
  const section = (() => {
    const at = DETAILS.indexOf("<Section title={modal.figures}>");
    return DETAILS.slice(at, DETAILS.indexOf("</Section>", at));
  })();

  it("er setzt eine Nummer und ruft nichts", () => {
    expect(section).toContain("onClick={() => setConfirmingUnbook(confirming ? null : item.id)}");
    const at = section.indexOf("onClick={() => setConfirmingUnbook(confirming ? null : item.id)}");
    expect(section.slice(at, at + 80)).not.toContain("processUnbook");
    expect(section.slice(at, at + 80)).not.toContain("onItemAction");
  });

  it("die Rückfrage steht UNTER der Zeile, nicht in der Spur", () => {
    /* Der `below`-Steckplatz aus Schritt 2 — über die ganze Breite, im
       selben `<li>`. */
    expect(section).toContain("below={confirming ? (");
    expect(TABLE).toContain("below?: ReactNode");
  });

  it("und nur, solange die Position gebucht ist", () => {
    /*
     * `confirming` hängt an BEIDEM. Gelingt die Rücknahme, kommt die frische
     * Liste mit `state = 'arrived'` zurück, `isBooked` wird falsch, und der
     * Bereich verschwindet von selbst — ohne Rücksetzen im Erfolgspfad.
     */
    expect(section).toContain("const confirming = confirmingUnbook === item.id && isBooked;");
  });

  it("nur „Ja, zurücknehmen“ führt aus", () => {
    const below = section.slice(section.indexOf("below={confirming ? ("));
    expect(below).toContain("dispatch(item.id, () =>");
    expect(below).toContain("processUnbookPurchaseItem(item.id, purchase.id)");
    expect(below).toContain("copy.errors.unbookYes");
    /* Genau ein Aufruf. */
    expect(section.split("processUnbookPurchaseItem(")).toHaveLength(2);
  });

  it("Abbrechen verändert keine Daten", () => {
    const below = section.slice(section.indexOf("below={confirming ? ("));
    expect(below).toContain("onClick={() => setConfirmingUnbook(null)}");
    expect(below).toContain("copy.errors.unbookCancel");
    const at = below.indexOf("onClick={() => setConfirmingUnbook(null)}");
    expect(below.slice(at, at + 80)).not.toContain("processUnbook");
  });

  it("die Rückfrage nennt ihre Folge", () => {
    const below = section.slice(section.indexOf("below={confirming ? ("));
    expect(below).toContain("copy.errors.unbookConfirmHint");
    expect(below).toContain("copy.errors.unbookConfirm");
    expect(below).toContain('role="alert"');
  });
});

describe("nach dem Erfolg", () => {
  const section = (() => {
    const at = DETAILS.indexOf("<Section title={modal.figures}>");
    return DETAILS.slice(at, DETAILS.indexOf("</Section>", at));
  })();

  it("Liste, Status, Marktwert und Faktor kommen über dieselbe Maschinerie", () => {
    /*
     * `act()` im Einkaufsbuch setzt die frische Positionsliste aus derselben
     * Antwort und löst, wenn die letzte laufende Aktion fertig ist,
     * `router.refresh()` aus — das holt die Ledger-Zeile samt `known_value`
     * und `factor` neu vom Server.
     */
    const LEDGER = read("src/components/business/orderbook-ledger.tsx");
    expect(LEDGER).toContain("onItemAction={(key, run) => act(showingRow.id, key, run)}");
    expect(LEDGER).toContain("setItems((current) => ({ ...current, [purchaseId]: result.items! }))");
    expect(LEDGER).toContain("listStale.current = true;");
    expect(LEDGER).toContain("router.refresh();");
  });

  it("und das Fenster bleibt offen", () => {
    const LEDGER = read("src/components/business/orderbook-ledger.tsx");
    expect(LEDGER).toContain("<PurchaseDetails key={showingRow.id}");
    /* Kein Schliessen im Erfolgspfad der Rücknahme. */
    const below = section.slice(section.indexOf("below={confirming ? ("));
    const upTo = below.slice(0, below.indexOf(") : confirmingIn ? ("));
    expect(upTo).not.toContain("onClose");
    expect(upTo).not.toContain("onSaved");
  });

  it("„Figur ändern“ wird automatisch wieder verfügbar", () => {
    /*
     * Keine Zeile Code dafür: die Rücknahme setzt `movement_id = null` und
     * `state = 'arrived'`, und `canRemapItem` prüft genau diese beiden. Der
     * Knopf erscheint, weil die Bedingung wahr wird.
     */
    const un = code(latestFunction("seller_unbook_purchase_item").body);
    expect(un).toContain("movement_id = null");
    expect(un).toContain("state = 'arrived'");
    const PURCHASE = read("src/lib/orderbook/purchase.ts");
    expect(PURCHASE).toContain('return item.movementId === null && item.state !== "booked";');
    expect(section).toContain("const mayRemap = canRemapItem(item);");
  });
});

describe("Ablehnungen, Parallelklicks, doppelte Rücknahme", () => {
  const section = (() => {
    const at = DETAILS.indexOf("<Section title={modal.figures}>");
    return DETAILS.slice(at, DETAILS.indexOf("</Section>", at));
  })();

  it("die Ablehnung steht an der Position, im Rückfragebereich", () => {
    const below = section.slice(section.indexOf("below={confirming ? ("));
    const upTo = below.slice(0, below.indexOf(") : confirmingIn ? ("));
    expect(upTo).toContain("failure === null ? null : (");
    expect(upTo).toContain("text-danger");
    /* Und die Sätze für verkauft und reserviert sind die aus Schritt 1. */
    expect(MAPPER).toContain("errors.unbookNoStock");
    expect(MAPPER).toContain("errors.unbookReserved");
  });

  it("der laufende Zustand sperrt beide Knöpfe", () => {
    /*
     * Die Grenze ist jetzt `) : confirmingIn ? (` und nicht mehr
     * `) : open ? (`: zwischen der Rücknahme-Rückfrage und dem Suchfeld
     * steht seit dem Einbuchen die Einbuchungs-Rückfrage. Mit der alten
     * Grenze hätte dieser Ausschnitt BEIDE Rückfragen umfasst und vier
     * gesperrte Knöpfe gezählt — die Zahl hätte gestimmt und nichts geprüft.
     */
    const below = section.slice(section.indexOf("below={confirming ? ("));
    const upTo = below.slice(0, below.indexOf(") : confirmingIn ? ("));
    expect(upTo.split("disabled={running}")).toHaveLength(3);
    expect(upTo).toContain("running ? copy.itemRunning");
  });

  it("der Parallelklick fällt SCHON IM FENSTER, nicht erst im Einkaufsbuch", () => {
    /*
     * Die Rückfrage-Knöpfe sind `disabled={running}`, und `running` ist
     * `busy.has(item.id)` — STATE. Zwei Klicks innerhalb eines
     * Renderdurchlaufs sehen beide noch `false`. Dass dennoch nur eine
     * Anfrage hinausgeht, darf nicht daran hängen, dass das Eltern-Element
     * zufällig ein Ref mitbringt; `onItemAction: (key, run) => void`
     * verspricht das nicht.
     */
    expect(DETAILS).toContain('import { dispatchItemAction } from "@/lib/orderbook/dispatch-lock";');
    expect(DETAILS).toContain("const dispatching = useRef<Set<number>>(new Set());");
    /* Und das Einkaufsbuch behält seine eigene — die Sperren ersetzen sich
       nicht, sie liegen hintereinander. */
    const LEDGER = read("src/components/business/orderbook-ledger.tsx");
    expect(LEDGER).toContain("if (inflight.current.has(key)) return;");
    expect(DETAILS).not.toContain("useTransition");
  });

  it("die Rücknahme geht durch `dispatch`, nie direkt an das Eltern-Element", () => {
    const at = DETAILS.indexOf("<Section title={modal.figures}>");
    const body = DETAILS.slice(at, DETAILS.indexOf("</Section>", at));
    expect(body).not.toContain("onItemAction(");
    /*
     * Und im GANZEN Bauteil wird das Eltern-Element nirgends gerufen: die
     * Zeichenkette `onItemAction(` kommt nicht vor. Die fünf Stellen, an
     * denen der Name auftritt, sind der Parameter, seine Typangabe, ein
     * Kommentar, die Weitergabe an `dispatchItemAction` und die
     * Abhängigkeitsliste — keine davon ein Aufruf.
     *
     * Eine gezählte Trefferzahl stand hier zuerst und war schlicht falsch.
     * Sie hätte auch nichts geprüft: der Name darf beliebig oft im Text
     * stehen, es darf ihn nur niemand aufrufen.
     */
    expect(DETAILS).not.toContain("onItemAction(");
    expect(DETAILS).toContain("dispatchItemAction(dispatching.current, key, onItemAction, run)");
  });

  it("und die Freigabe der Fenster-Sperre ist ausgeführt geprüft", () => {
    /*
     * Diese Datei liest Quelltext und kann eine Zeitfrage nicht beantworten.
     * Der Beweis, dass der zweite Klick fällt und die Sperre danach wieder
     * aufgeht — auch wenn das Eltern-Element den Versuch abweist —, läuft in
     * `dispatch-lock.test.ts` mit echten Promises.
     */
    const lock = read("src/lib/orderbook/dispatch-lock.ts");
    expect(lock).toContain("if (held.has(key)) return false;");
    expect(lock).toContain("return run().finally(() => {");
    expect(lock).toContain("if (!started) held.delete(key);");
  });

  it("und die doppelte Rücknahme fällt in der Datenbank", () => {
    const un = code(latestFunction("seller_unbook_purchase_item").body);
    expect(un).toContain("where id = p_item_id for update");
    expect(un).toContain("this item is not in inventory");
  });
});

describe("die Detailseite bleibt unverändert", () => {
  it("sie behält ihre eigene Rückfrage und ihre eigene Server Action", () => {
    expect(ITEMS).toContain("const [confirmingUnbook, setConfirmingUnbook] = useState<number | null>(null);");
    expect(ITEMS).toContain("unbookPurchaseItem(item.id, purchaseId)");
    /* Und benutzt NICHT die Fenster-Variante. */
    expect(ITEMS).not.toContain("processUnbookPurchaseItem");
  });

  it("und das Fenster benutzt nicht ihre", () => {
    expect(DETAILS).not.toContain("unbookPurchaseItem(item.id, purchase.id)");
  });
});
