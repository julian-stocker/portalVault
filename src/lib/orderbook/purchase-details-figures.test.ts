/**
 * „Gekaufte Figuren“ im (i)-Fenster des Einkaufsbuchs — Schritt 2.
 *
 * DREI ZUSICHERUNGEN TRAGEN DIESE DATEI.
 *
 * 1. DER ABSCHNITT IST LESEND. Kein Einbuchen, kein Zustandswechsel, kein
 *    Entfernen, keine Server Action. Das Fenster ist zum Nachsehen da, und
 *    eine Lagerbuchung gehört auf die Detailseite.
 *
 * 2. DIE SPUREN STIMMEN. Drei Zellen in der Zeile, drei in der Kopfzeile, und
 *    keine vierte — eine leere Aktionsspalte war ausdrücklich nicht gewollt.
 *    Der Steckplatz für später existiert, füllt heute aber niemand.
 *
 * 3. DAS EINKAUFSBUCH BLEIBT, WIE ES WAR. Seine eigene sechsspurige Tabelle
 *    mit allen Aktionen ist unberührt; der Dialog bekommt eine zweite, kleinere
 *    Darstellung und nicht eine veränderte erste.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { de } from "@/lib/i18n/de";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const TABLE = read("src/components/business/purchase-item-table.tsx");
const DETAILS = read("src/components/business/purchase-details.tsx");
const LEDGER = read("src/components/business/orderbook-ledger.tsx");
const QUERIES = read("src/lib/orderbook/queries.ts");

/** Zellen auf der ersten Ebene eines JSX-Blocks — wie in `sales.test.ts`. */
const cells = (block: string): number => {
  let depth = 0;
  let count = 0;
  for (const m of block.matchAll(/<(\/?)(span)\b[^>]*?(\/?)>/g)) {
    const [, closing, , selfClosing] = m;
    if (closing) { depth -= 1; continue; }
    if (depth === 0) count += 1;
    if (!selfClosing) depth += 1;
  }
  return count;
};

/**
 * Quelltext ohne Kommentare.
 *
 * Sechs Prüfungen in dieser Sitzung sind daran gescheitert, dass ein
 * Kommentar genau den Ausdruck zitiert, dessen Abwesenheit er begründet. Eine
 * Prüfung auf „tut der Code das“ darf nicht an der Prosa hängen, die
 * erklärt, warum er es nicht tut.
 */
const strip = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const inside = (source: string, open: string, close: string): string => {
  const i = source.indexOf(open);
  return i < 0 ? "" : source.slice(i, source.indexOf(close, i));
};

/** Der Rumpf einer exportierten Funktion bis zur schliessenden Klammer. */
const fn = (source: string, name: string): string => {
  const at = source.indexOf(`export function ${name}`);
  expect(at, name).toBeGreaterThan(-1);
  const next = source.indexOf("\nexport ", at + 1);
  return source.slice(at, next === -1 ? undefined : next);
};

describe("der Abschnitt steht an der verlangten Stelle", () => {
  it("unter den Kosten und dem Absenderabschnitt, als letzter Abschnitt", () => {
    /*
     * HIER STAND „und über dem Bearbeiten-Block". Den gibt es nicht mehr:
     * das Fenster bearbeitet seit der Umstellung an Ort und Stelle, und ein
     * angehängter Abschnitt `modal.edit` existiert nicht. Die Prüfung ist
     * dadurch strenger geworden — sie sagt jetzt, dass die Figuren der
     * LETZTE Abschnitt sind, und verbietet den alten Block ausdrücklich.
     */
    const costs = DETAILS.indexOf("<Section title={modal.costs}>");
    const sender = DETAILS.indexOf("<Section title={modal.senderSection}>");
    const figures = DETAILS.indexOf("<Section title={modal.figures}>");
    expect(costs).toBeGreaterThan(-1);
    expect(sender).toBeGreaterThan(costs);
    expect(figures).toBeGreaterThan(sender);
    expect(DETAILS).not.toContain("<Section title={modal.edit}>");
    /*
     * HIER STAND „kein weiterer Abschnitt dahinter". Seit `0122` folgt der
     * Eigenbeleg — und er ist der einzige, der folgen darf. Die Prüfung sagt
     * das jetzt namentlich, statt die Stelle für immer zuzusperren.
     */
    const after = DETAILS.slice(figures + 1);
    expect([...after.matchAll(/<Section title=\{([\w.]+)\}>/g)].map((m) => m[1]))
      .toEqual(["receiptCopy.section"]);
  });

  it("und heißt, was er zeigt", () => {
    expect(de.business.orderbook.detailsModal.figures).toBe("Gekaufte Figuren");
  });

  it("die Stammdaten bleiben hinter „Bearbeiten“", () => {
    /*
     * Der neue Abschnitt ändert daran nichts: Datum, Plattform, Verkäufer und
     * die Kostenaufteilung erscheinen weiter nur, wenn der Betreiber sagt,
     * dass er korrigiert.
     */
    expect(DETAILS).toContain("{editing ? (");
    const section = inside(DETAILS, "<Section title={modal.figures}>", "</Section>");
    for (const field of ["draft.purchasedAt", "draft.platform", "seller_update_purchase",
                         "updatePurchase"]) {
      expect(section, field).not.toContain(field);
    }
  });
});

describe("drei Zustände der Liste, und alle drei stehen da", () => {
  const section = inside(DETAILS, "<Section title={modal.figures}>", "</Section>");

  it("wird geladen — ein Eintrag ohne Wert IST der Ladezustand", () => {
    expect(section).toContain("items === undefined");
    expect(section).toContain("copy.loadingItems");
  });

  it("Ladefehler", () => {
    expect(section).toContain('items === "failed"');
    expect(section).toContain("copy.itemsFailed");
  });

  it("leere Liste — und das ist kein Fehler", () => {
    /* Ein Einkauf ohne Positionen ist gültig und heisst `Unvollständig`
       (0063); er braucht einen Satz, nicht eine Fehlermeldung. */
    expect(section).toContain("items.length === 0");
    expect(section).toContain("modal.noFigures");
    expect(de.business.orderbook.detailsModal.noFigures).toContain("keine Figur");
  });

  it("die Sätze für Laden und Fehlschlag sind die des Einkaufsbuchs", () => {
    /* Zwei Formulierungen für dasselbe Warten wären zwei Stellen, an denen es
       auseinanderläuft. */
    expect(LEDGER).toContain("copy.loadingItems");
    expect(LEDGER).toContain("copy.itemsFailed");
    expect(de.business.orderbook.loadingItems).toBe("Artikel werden geladen …");
  });

  it("die Reihenfolge der Prüfungen ist die einzige, die stimmt", () => {
    /*
     * `undefined` zuerst, dann `"failed"`, dann `length === 0`. Stünde die
     * Längenprüfung vorn, wäre `undefined.length` ein Absturz, und
     * `"failed".length` wäre 6 — eine Zeichenkette, die als Liste gelesen
     * wird.
     */
    expect(section.indexOf("items === undefined"))
      .toBeLessThan(section.indexOf('items === "failed"'));
    expect(section.indexOf('items === "failed"'))
      .toBeLessThan(section.indexOf("items.length === 0"));
  });
});

describe("der Datenfluss — der vorhandene, kein neuer", () => {
  it("onDetails lädt die Positionen über load()", () => {
    const onDetails = LEDGER.slice(LEDGER.indexOf("const onDetails ="));
    const body = onDetails.slice(0, onDetails.indexOf("\n  };"));
    expect(body).toContain("if (items[id] === undefined) load(id);");
  });

  it("und nur, wenn sie fehlen", () => {
    /* `load` ist zusätzlich gegen den doppelten Aufruf gesichert; die
       Bedingung hier erspart den Aufruf ganz, wenn die Zeile schon offen war. */
    expect(LEDGER).toContain("if (loading.current.has(id)) return;");
  });

  it("das Fenster bekommt sie als Eigenschaft", () => {
    expect(LEDGER).toContain("items={items[showingRow.id]}");
  });

  it("keine zweite Abfrage — es bleibt bei loadPurchaseItems", () => {
    expect(LEDGER).toContain("loadPurchaseItems(id)");
    /* Das Fenster selbst ruft nichts. */
    expect(DETAILS).not.toContain("loadPurchaseItems");
    expect(DETAILS).not.toContain("fetchPurchase");
    expect(DETAILS).not.toContain('rpc("');
  });

  it("der Kommentar in queries.ts nennt den Weg, der wirklich existiert", () => {
    expect(QUERIES).toContain("`loadPurchaseItems()` in");
    expect(QUERIES).toContain("No such function has ever");
  });
});

describe("die Lesetabelle: vier feste Spuren, überall dieselben", () => {
  const row = fn(TABLE, "PurchaseItemReadRow");
  const head = fn(TABLE, "PurchaseItemReadHead");

  it("die Zeile zeigt Figur, Serie/SKY-ID und Zustand", () => {
    expect(row).toContain("{item.position}. {item.name}");
    expect(row).toContain('{item.seriesLabel ?? "—"}');
    expect(row).toContain("item.skyId");
    expect(row).toContain("<Status status={status} text={text} title={title} />");
  });

  it("VIER Zellen in der Zeile und VIER in der Kopfzeile — bedingungslos", () => {
    /*
     * Hier stand bis zum Layoutfix „drei, und die vierte nur mit Aktionen".
     * Genau das war der Fehler: eine Zeile ohne Knopf teilte ihre Breite
     * anders auf als eine mit, weil jede Zeile ihr EIGENES Gitter ist.
     *
     * Jetzt sind es vier, immer, in beiden — und die Zählung läuft über den
     * ganzen Block, nicht bis zu einer Verzweigung, weil es keine mehr gibt.
     */
    expect(cells(inside(row, "<li", "</li>"))).toBe(4);
    expect(cells(head)).toBe(4);
    /* Keine Verzweigung mehr im Zellenbau. */
    expect(row).not.toContain("actions === undefined ? null");
    expect(head).not.toContain("withActions");
  });

  it("EINE Spurenliste, von der Kopfzeile und jeder Zeile benutzt", () => {
    /*
     * Die eigentliche Zusicherung des Fixes. Eine Liste, ein Name, zwei
     * Verwendungsstellen — die Kopfzeile kann den Zeilen nicht mehr
     * widersprechen.
     */
    expect(TABLE).toContain('const READ_TRACKS =');
    expect(TABLE).toContain('"grid-cols-[minmax(0,1fr)_5.5rem] "');
    expect(TABLE).toContain('"sm:grid-cols-[minmax(0,1fr)_7rem_6.5rem_4.5rem]"');
    expect(head).toContain("${READ_TRACKS}");
    expect(row).toContain("${READ_TRACKS}");
    /* Die zwei alten Listen sind weg. */
    expect(TABLE).not.toContain("READ_TRACKS_3");
    expect(TABLE).not.toContain("READ_TRACKS_4");
    expect(TABLE).not.toContain("READ_ROW");
  });

  it("alle Spuren außer dem Namen haben FESTE Breiten", () => {
    /*
     * `auto` war Ursache 3: jede Zeile ist ihr eigenes Gitter, also misst
     * `auto` je Zeile neu — eine Zeile mit Knopf wäre anders aufgeteilt als
     * eine ohne, selbst bei gleicher Spurenzahl.
     */
    const tracks = inside(TABLE, "const READ_TRACKS =", ";");
    expect(tracks).not.toContain("auto");
    expect(tracks).not.toContain("max-content");
    expect(tracks).not.toContain("min-content");
    /* Genau eine flexible Spur, und das ist der Name. */
    expect(tracks.split("minmax(0,1fr)")).toHaveLength(3);  // je Haltepunkt eine
  });

  it("Abstände und Innenrand sind für Kopfzeile und Zeile derselbe Wert", () => {
    expect(TABLE).toContain("const READ_BOX =");
    expect(head).toContain("${READ_BOX}");
    expect(row).toContain("${READ_BOX}");
  });

  it("der Steckplatz hält jetzt bis zu zwei Aktionen, zustandsabhängig", () => {
    /*
     * In Schritt 2 stand hier, dass niemand `actions` übergibt. Schritt 3 tut
     * es, und das war der Zweck des Steckplatzes: die Tabelle entstand nicht
     * ein zweites Mal.
     *
     * Die Prüfung ist dadurch STRENGER geworden, nicht lockerer: sie sagt
     * jetzt, WAS in der Spalte steht — genau eine Aktion, und sie hängt an
     * `canRemapItem`.
     */
    expect(row).toContain("actions?: ReactNode");
    /*
     * Seit dem Einbuchen hält die Spur bis zu ZWEI Aktionen, und die
     * Verzweigung beginnt bei `isBooked`. Die Reihenfolge ist die Prüfung:
     * `canBook` gilt nur für `ordered`, `arrived` und `showcase`, und für
     * genau diese ist `canRemapItem` ebenfalls wahr — stünde `mayRemap`
     * zuerst, wäre „Einbuchen" nie erreichbar.
     */
    expect(DETAILS).toContain("actions={isBooked ? (");
    expect(DETAILS).toContain("const mayRemap = canRemapItem(item);");
    expect(DETAILS).toContain("const mayBook = canBook(item);");
    expect(DETAILS.indexOf(") : mayBook ? ("))
      .toBeLessThan(DETAILS.indexOf(") : mayRemap ? ("));
    /* Ein `actions`-Steckplatz, nicht zwei. */
    expect(DETAILS.split("actions={")).toHaveLength(2);
    /*
     * Die Spur bleibt auch ohne Knopf — leer, und ohne einen gesperrten
     * Knopf, der nie erreichbar wird. `actions ?? null` ist genau das.
     */
    expect(row).toContain("{actions ?? null}");
  });

  it("keine leere Aktionsspalte im Fenster", () => {
    const section = inside(DETAILS, "<Section title={modal.figures}>", "</Section>");
    expect(section).toContain("<PurchaseItemReadHead />");
    expect(section).not.toContain("withActions");
  });
});

describe("der Abschnitt schreibt nichts", () => {
  const section = inside(DETAILS, "<Section title={modal.figures}>", "</Section>");
  const row = fn(TABLE, "PurchaseItemReadRow");

  it("die schreibenden Aufrufe sind GENAU drei, namentlich", () => {
    /*
     * Hier stand eine Verbotsliste aus Teilzeichenketten. Sie hat sich selbst
     * widerlegt: `processUnbookPurchaseItem` ENTHÄLT `bookPurchaseItem`, und
     * die Prüfung schlug an, obwohl nichts eingebucht wird.
     *
     * Eine Mengenprüfung über die tatsächlich gerufenen Namen ist schärfer
     * und kann nicht zufällig treffen: sie sagt, WAS gerufen wird, statt was
     * nicht.
     */
    const called = [...new Set([...section.matchAll(/\b(process[A-Za-z]+)\(/g)]
      .map((m) => m[1]))].sort();
    expect(called).toEqual(["processBookPurchaseItem", "processPurchaseItemSky",
                            "processUnbookPurchaseItem"]);
    /* Und die Zeile selbst ruft gar nichts. */
    expect([...row.matchAll(/\b(process[A-Za-z]+)\(/g)]).toHaveLength(0);
  });

  it("kein Zustandswechsel, kein Entfernen, kein Hinzufügen", () => {
    /*
     * `processBookPurchaseItem` und `copy.book` standen hier — bis das
     * Einbuchen im Fenster freigegeben wurde. Verboten bleibt, was wirklich
     * etwas anderes täte: Zustandswechsel, Entfernen, Hinzufügen.
     */
    for (const forbidden of ["processPurchaseItemState",
                             "removePurchaseItem", "addPurchaseItem",
                             "ACTION_PRIMARY", "onBook", "onState"]) {
      expect(section, `Abschnitt/${forbidden}`).not.toContain(forbidden);
      expect(row, `Zeile/${forbidden}`).not.toContain(forbidden);
    }
  });

  it("die Zeile hat keinen Knopf und keinen eigenen Zustand", () => {
    expect(row).not.toContain("<button");
    expect(row).not.toContain("useState");
    expect(row).not.toContain("onClick");
  });

  it("raw_name steht NUR im Bearbeitungsbereich und wird nie geschrieben", () => {
    /*
     * In der Tabellenzeile erscheint der aufgelöste Name aus `0119`
     * (`display_name_override` vor `skylanders.name`) — die Zeile selbst
     * kennt `rawName` nicht.
     *
     * Seit Schritt 3 zeigt der AUFGEKLAPPTE Bereich den ursprünglichen Namen
     * vollständig: er ist das Beweisstück, nach dem korrigiert wird.
     * `break-words` statt `truncate`, weil „vollständig“ genau das heisst.
     */
    expect(row).not.toContain("rawName");
    expect(section).toContain("copy.rawLabel(item.rawName)");
    expect(section).toContain("break-words");
    /* Und geschrieben wird er nirgends: das RPC fasst `sky_id` an. */
    const ACTIONS = read("src/lib/orderbook/actions.ts");
    const fnBody = ACTIONS.slice(ACTIONS.indexOf("export async function processPurchaseItemSky"));
    expect(fnBody.slice(0, fnBody.indexOf("\n}"))).not.toContain("raw_name");
    expect(section).not.toContain("raw_name:");
  });
});

describe("historische und gebuchte Positionen", () => {
  it("der Zustandstext kommt aus EINER Funktion, für beide Tabellen", () => {
    /*
     * Zwei Orte, die „Historisch“ entscheiden, wären zwei Orte, an denen ein
     * Zustand irgendwann verschieden heisst. `itemStatusText` ist die eine
     * Stelle; `ItemRow` und `PurchaseItemReadRow` lesen beide daraus.
     */
    expect(TABLE).toContain("export function itemStatusText(item: PurchaseItem)");
    expect(fn(TABLE, "ItemRow")).toContain("itemStatusText(item)");
    expect(fn(TABLE, "PurchaseItemReadRow")).toContain("itemStatusText(item)");
    /* Und die Entscheidung steht nur dort — nicht ein zweites Mal daneben. */
    expect(TABLE.split("copy.historicalLabel")).toHaveLength(2);
    expect(TABLE.split("copy.completeCell")).toHaveLength(2);
  });

  it("die Worte für historisch und eingebucht sind die bestehenden", () => {
    const copy = de.business.orderbook;
    expect(copy.historicalLabel).toBe("Historisch");
    expect(copy.historicalHint).toBe("Bestand separat abgeglichen");
    expect(copy.completeCell).toBe("Eingebucht ✓");
  });

  it("eine Nicht-Figur bekommt einen Strich und keine erfundene Serie", () => {
    const row = fn(TABLE, "PurchaseItemReadRow");
    expect(row).toContain('{item.seriesLabel ?? "—"}');
    /* Kein Trenner mehr — die beiden stehen jetzt untereinander. */
    expect(row).toContain("{item.skyId === null ? null : (");
  });

  it("Serie über SKY-ID, und die ID wird NIE gekürzt", () => {
    /*
     * Ursache 4 des Layoutfehlers: `seriesLabel` ist das volle Label, nicht
     * der Code. „Spyro's Adventure · SKY-0056" sind 28 Zeichen und brauchen
     * bei `text-xs` etwa 12,6rem; in einer 9rem-Zelle schnitt `truncate`
     * die SKY-ID ab — also genau die Identität, um die es geht.
     *
     * Gestapelt kürzt nur das Label. Die ID hat kein `truncate`.
     */
    const row = fn(TABLE, "PurchaseItemReadRow");
    const cell = inside(row, '<span className="min-w-0 text-xs text-muted">', "</span>\n      <span");
    expect(cell).toContain('<span className="block truncate">{item.seriesLabel ?? "—"}</span>');
    expect(cell).toContain('<span className="block tabular-nums">{item.skyId}</span>');
    /* Die ID-Zeile trägt kein truncate. */
    const idLine = cell.slice(cell.indexOf("tabular-nums"));
    expect(idLine).not.toContain("truncate");
  });

  it("der Name verschiebt die anderen Spalten nicht", () => {
    const row = fn(TABLE, "PurchaseItemReadRow");
    expect(row).toContain('<span className="min-w-0 truncate text-sm" title={item.name}>');
    /* `minmax(0,1fr)` statt `1fr`: ohne die 0-Untergrenze wäre die
       Mindestbreite der Inhalt, und ein langer Name drückte die festen
       Spuren weg. */
    expect(TABLE).toContain("minmax(0,1fr)");
    expect(TABLE).not.toMatch(/grid-cols-\[1fr/);
  });

  it("auf dem Telefon zwei Reihen, zwei Spalten, kein Überlauf", () => {
    /*
     * Unter `sm:` ein 2×2-Feld in DOM-Reihenfolge: Figur | Serie/SKY-ID über
     * Status | Aktion. Keine ausdrückliche Platzierung, kein
     * `col-span`-Flickwerk, und nichts, was breiter als der Bildschirm wird.
     */
    expect(TABLE).toContain("grid-cols-[minmax(0,1fr)_5.5rem] ");
    const row = fn(TABLE, "PurchaseItemReadRow");
    expect(row).not.toContain("col-span-2");
    expect(row).not.toContain("overflow-x");
    /* Im CODE, nicht in der Prosa: der Kopfkommentar erklärt gerade, warum
       `LedgerTable` und sein `.ob-min`-Boden hier falsch wären. */
    const code = strip(TABLE);
    expect(code).not.toContain("min-w-[");
    expect(code).not.toContain("ob-min");
    /* Nur die LESEZEILE meidet das geteilte Zeilenprimitiv — `ItemRow`, die
       grosse Tabelle, benutzt es zu Recht weiter. */
    expect(strip(row)).not.toContain("LedgerItemRow");
  });
});

describe("das Fenster bleibt scrollbar", () => {
  it("alle Abschnitte liegen im scrollenden Bereich", () => {
    const scroll = DETAILS.indexOf('<div className="min-h-0 flex-1 overflow-y-auto">');
    expect(scroll).toBeGreaterThan(-1);
    expect(DETAILS.indexOf("<Section title={modal.figures}>")).toBeGreaterThan(scroll);
  });

  it("und die Liste bekommt KEINEN zweiten Scrollbereich", () => {
    /*
     * Zwei verschachtelte Scrollflächen sind auf einem Telefon die Geste, die
     * niemand trifft. Das Fenster scrollt als Ganzes; der Kopf mit
     * `Bearbeiten` und `Schließen` steht ausserhalb und bleibt stehen.
     */
    const section = inside(DETAILS, "<Section title={modal.figures}>", "</Section>");
    /*
     * Geprüft wird die KLASSE, nicht das Wort: der Kommentar im Abschnitt
     * erklärt gerade, dass das Fenster als Ganzes scrollt, und darf
     * `overflow-y-auto` dabei nennen.
     */
    expect(section).not.toMatch(/className="[^"]*overflow-y/);
    expect(section).not.toMatch(/className="[^"]*max-h-/);
    /* Der Kopf liegt vor dem Scrollbereich. */
    expect(DETAILS.indexOf("modal.close"))
      .toBeLessThan(DETAILS.indexOf('<div className="min-h-0 flex-1 overflow-y-auto">'));
  });
});

describe("das Einkaufsbuch bleibt, wie es war", () => {
  it("seine eigene Tabelle hat weiter sechs Spuren und alle Aktionen", () => {
    expect(cells(inside(TABLE, "<LedgerItemRow>", "</LedgerItemRow>"))).toBe(6);
    expect(cells(inside(TABLE, "<LedgerItemHead>", "</LedgerItemHead>"))).toBe(6);
    const row = fn(TABLE, "ItemRow");
    expect(row).toContain("canCheckIn(item)");
    expect(row).toContain("copy.book");
    expect(row).toContain("endingsFor(item.state as ItemState).map");
  });

  it("und wird im Aufklappbereich unverändert benutzt", () => {
    expect(LEDGER).toContain("<PurchaseItemHead />");
    expect(LEDGER.split("{expanded ? (")[1]).toContain("<ItemRow");
    expect(LEDGER.split("{expanded ? (")[0]).not.toContain("<ItemRow");
  });

  it("die Lesevariante erscheint NUR im Fenster", () => {
    expect(LEDGER).not.toContain("PurchaseItemReadRow");
    expect(LEDGER).not.toContain("PurchaseItemReadHead");
    expect(DETAILS).not.toContain("<ItemRow");
    expect(DETAILS).not.toContain("LedgerItemRow");
  });

  it("und sie benutzt das ob-item-Gitter NICHT", () => {
    /*
     * `.ob-item` holt seine Spuren aus `--ob-item-columns`, und die setzt
     * `LedgerTable`. Im Fenster gibt es kein `LedgerTable`, also griffe der
     * CSS-Rückfall mit SECHS Spuren — die drei leeren hinten wären genau die
     * Aktionsspalte, die hier nicht erscheinen soll.
     */
    const row = fn(TABLE, "PurchaseItemReadRow");
    expect(row).not.toContain("LedgerItemRow");
    expect(row).not.toContain("ob-item");
    expect(read("src/app/globals.css"))
      .toContain("2.5rem 9.5rem minmax(0, 1fr) 6rem 6rem 6.5rem");
  });
});

/* =========================================================================
 * SCHRITT 3 — „Figur ändern“ im Fenster
 * ====================================================================== */

describe("die Server Action: dasselbe RPC, ein anderer Rückweg", () => {
  const ACTIONS = read("src/lib/orderbook/actions.ts");
  const body = (() => {
    const at = ACTIONS.indexOf("export async function processPurchaseItemSky");
    return ACTIONS.slice(at, ACTIONS.indexOf("\n}", at));
  })();

  it("benutzt runPurchaseItem, damit die frische Liste zurückkommt", () => {
    /*
     * `run` würde `revalidatePath` anstossen und die Liste NICHT
     * zurückgeben — die Tabelle im offenen Fenster bliebe alt. Dieselbe
     * Teilung wie zwischen `setPurchaseItemState` und
     * `processPurchaseItemState`.
     */
    expect(body).toContain('runPurchaseItem("seller_set_purchase_item_sky"');
    expect(body).not.toMatch(/\brun\("/);
    expect(ACTIONS).toContain("const fresh = await fetchPurchase(purchaseId);");
  });

  it("es ist das vorhandene RPC, kein neues", () => {
    expect(body).toContain("p_item_id: itemId");
    expect(body).toContain("p_sky_id: skyId");
    /* Die Variante der Detailseite bleibt unberührt. */
    expect(ACTIONS).toContain("export async function setPurchaseItemSky(");
    expect(ACTIONS).toContain('return run("seller_set_purchase_item_sky"');
  });

  it("p_remember bleibt false — das Fenster stellt diese Frage nicht", () => {
    expect(body).toContain("p_remember: false");
    /* Und das Fenster bietet den Haken nicht an. */
    expect(DETAILS).not.toContain("remapRemember");
  });

  it("und schreibt keinen Rohnamen", () => {
    expect(body).not.toContain("raw_name");
    expect(body).not.toContain("p_raw_name");
  });
});

describe("wer umhängen darf, und wer nicht", () => {
  const section = inside(DETAILS, "<Section title={modal.figures}>", "</Section>");

  it("die Aktion hängt an canRemapItem — der bestehenden Regel", () => {
    expect(section).toContain("const mayRemap = canRemapItem(item);");
    expect(section).toContain(") : mayRemap ? (");
    /* Beide Regeln kommen aus derselben Datei, keine wird hier nachgebaut. */
    expect(DETAILS).toContain('import { canBook, canRemapItem, isHistorical } from "@/lib/orderbook/purchase";');
  });

  it("und die Regel selbst ist unverändert", () => {
    /*
     * `movementId === null && state !== "booked"`. Eine gebuchte Position
     * besitzt eine Lagerbewegung, und die Bewegung nennt die Figur, die
     * tatsächlich eingebucht wurde — sie umzuhängen trennte den Bestand von
     * seiner Buchung. Eine Arbeitsmappenzeile darf umgehängt werden, dafür
     * gibt es 0054.
     */
    const PURCHASE = read("src/lib/orderbook/purchase.ts");
    expect(PURCHASE).toContain(
      'return item.movementId === null && item.state !== "booked";');
  });

  it("das Fenster erfindet keine eigene Regel daneben", () => {
    /* Im CODE, nicht in der Prosa: der Kommentar daneben zitiert die Regel,
       um zu erklären, warum sie nicht hier steht. */
    const code = strip(section);
    /*
     * Die UMHÄNGE-Regel darf das Fenster nicht nachbauen — `canRemapItem`
     * prüft `movementId === null && state !== "booked"`, und beide Hälften
     * dürfen hier nicht einzeln auftauchen.
     */
    for (const own of ["item.movementId", 'state !== "booked"']) {
      expect(code, own).not.toContain(own);
    }
    /*
     * `item.state === "booked"` steht seit der Rücknahme dort — aber für eine
     * ANDERE Frage: welche kompakte Aktion die Zeile trägt. Es ist derselbe
     * Ausdruck, den die Detailseite seit je benutzt, und er ersetzt keine
     * Schutzregel.
     */
    expect(code).toContain('const isBooked = item.state === "booked";');
    expect(read("src/components/business/purchase-items.tsx"))
      .toContain('const isBooked = item.state === "booked";');
  });

  it("und die Datenbank bleibt die Grenze", () => {
    /* Die Ablehnung für eine gebuchte Position ist schon formuliert. */
    expect(de.business.orderbook.errors.bookedRemap).toContain("Bestand");
    expect(read("src/lib/orderbook/actions.ts")).toContain("bookedRemap");
  });
});

describe("die Katalogsuche", () => {
  const section = inside(DETAILS, "<Section title={modal.figures}>", "</Section>");

  it("es ist die bestehende, und sie öffnet unter der Zeile", () => {
    expect(section).toContain("<FigureSearch");
    expect(section).toContain("catalog={figures}");
    expect(section).toContain("copy.figures.changeOne(item.name)");
    /* Zwei Fälle im selben Steckplatz, und sie schliessen einander aus:
       eine gebuchte Position ist nicht umhängbar. */
    expect(section).toContain("below={confirming ? (");
    expect(section).toContain(") : open ? (");
  });

  it("eine Position auf einmal", () => {
    /* Zwei offene Suchfelder wären zwei Autofokus-Felder, und das zweite
       nähme dem ersten den Fokus, während jemand tippt. */
    expect(DETAILS).toContain("const [remapping, setRemapping] = useState<number | null>(null);");
    expect(section).toContain("const open = remapping === item.id;");
    expect(section).toContain("setRemapping(open ? null : item.id)");
  });

  it("der Katalog lädt erst beim Hineingreifen, und nur einmal", () => {
    /*
     * 605 Preiszeilen über 64 KB. Als Prop der Orderbuchseite wären sie bei
     * JEDEM Seitenaufruf dabei, für ein Werkzeug am Rand. `loadOrderbook-
     * Figures` ist die vorhandene Funktion, die das Verkaufsbuch genauso
     * benutzt.
     */
    expect(DETAILS).toContain("const ensureFigures = useCallback(() => {");
    expect(DETAILS).toContain("if (figures !== null || loadingFigures) return;");
    expect(DETAILS).toContain("void loadOrderbookFigures()");
    expect(section).toContain("if (!open) ensureFigures();");
    /* Kein Katalog als Prop — weder am Fenster noch am Orderbuch. */
    expect(DETAILS).not.toContain("catalog: readonly FigureChoice[]");
    expect(LEDGER).not.toContain("catalog={");
  });

  it("und sagt, dass er lädt", () => {
    expect(section).toContain("figures === null ? (");
    expect(section).toContain("copy.figures.loadingCatalog");
    expect(de.business.orderbook.figures.loadingCatalog).toBe("Katalog wird geladen …");
  });

  it("abbrechen schließt nur den Bereich", () => {
    expect(section).toContain("onCancel={() => setRemapping(null)}");
    expect(section).toContain("copy.figures.changeCancel");
  });
});

describe("Laden, Fehler, Parallelklick", () => {
  const section = inside(DETAILS, "<Section title={modal.figures}>", "</Section>");

  it("die laufende Position sperrt ihren Knopf und sagt es", () => {
    expect(section).toContain("const running = busy.has(item.id);");
    expect(section).toContain("disabled={running}");
    expect(section).toContain("running ? copy.itemRunning");
  });

  it("der Parallelklick fällt an ZWEI Sperren, und beide sind Refs", () => {
    /*
     * KORREKTUR EINER FRÜHEREN ANNAHME. Hier stand, das Fenster baue keine
     * eigene Sperre, weil „zwei Sperren zwei Orte wären, an denen eine
     * Position hängen bleiben kann". Der zweite Halbsatz ist richtig — er ist
     * der Grund, warum `dispatchItemAction` sofort freigibt, wenn das
     * Eltern-Element den Versuch abweist. Der erste war ein Fehlschluss: der
     * Prop-Typ `onItemAction` verspricht keine Sperre, und `disabled={running}`
     * im Fenster hängt an STATE und ist einen Renderdurchlauf zu spät.
     *
     * Also beide: `inflight` im Einkaufsbuch und `dispatching` im Fenster.
     * Dass die zweite nicht verklemmt, ist in `dispatch-lock.test.ts`
     * tatsächlich ausgeführt und nicht nur zugesichert.
     */
    expect(LEDGER).toContain("if (inflight.current.has(key)) return;");
    expect(DETAILS).toContain("const dispatching = useRef<Set<number>>(new Set());");
    expect(DETAILS).toContain("dispatchItemAction(dispatching.current, key, onItemAction, run)");
    /* Keine Transition — die wäre asynchron und damit keine Sperre. */
    expect(DETAILS).not.toContain("useTransition");
  });

  it("die Ablehnung steht an der Position, nicht am Fenster", () => {
    expect(section).toContain("const failure = failed.get(item.id) ?? null;");
    expect(section).toContain('role="alert"');
    expect(section).toContain("text-danger");
  });

  it("und das Fenster geht nach dem Erfolg NICHT zu", () => {
    /*
     * Anforderung 8. Der Erfolgspfad ruft `onItemAction` und schliesst nur
     * den Suchbereich; `onClose` kommt darin nicht vor. Offen bleibt das
     * Fenster, weil `key={showingRow.id}` sich nicht ändert, wenn
     * `router.refresh()` die Liste erneuert.
     */
    const select = section.slice(section.indexOf("onSelect={(choice) => {"));
    const body = select.slice(0, select.indexOf("}}"));
    expect(body).toContain("setRemapping(null);");
    expect(body).toContain("dispatch(item.id, () =>");
    expect(body).toContain("processPurchaseItemSky(item.id, choice.skyId, purchase.id)");
    expect(body).not.toContain("onClose");
    expect(body).not.toContain("onSaved");
  });

  it("Marktwert und Faktor kommen über dieselbe Maschinerie", () => {
    /* `act` setzt die frische Liste und löst, wenn die letzte Aktion fertig
       ist, `router.refresh()` aus — das holt die Ledger-Zeile samt Faktor. */
    expect(LEDGER).toContain("onItemAction={(key, run) => act(showingRow.id, key, run)}");
    expect(LEDGER).toContain("busy={busy}");
    expect(LEDGER).toContain("failed={failed}");
    expect(LEDGER).toContain("listStale.current = true;");
    expect(LEDGER).toContain("router.refresh();");
    expect(LEDGER).toContain("setItems((current) => ({ ...current, [purchaseId]: result.items! }))");
  });
});

describe("und sonst nichts — Anforderung 10", () => {
  const section = inside(DETAILS, "<Section title={modal.figures}>", "</Section>");

  it("weiterhin kein Zustandswechsel, kein Entfernen, kein Hinzufügen", () => {
    /*
     * `bookPurchaseItem` und `unbookPurchaseItem` sind hier KEINE brauchbaren
     * Verbote mehr: beide sind Teilzeichenketten von
     * `processUnbookPurchaseItem`, das seit der Rücknahme im Fenster steht.
     * Verboten bleiben die Namen, die wirklich etwas anderes täten.
     */
    for (const forbidden of ["processPurchaseItemState",
                             "removePurchaseItem", "addPurchaseItem", "AddPurchaseItem",
                             "copy.settle",
                             "PURCHASE_DRAFT_STATES", "endingsFor"]) {
      expect(section, forbidden).not.toContain(forbidden);
    }
    /*
     * `copy.book` DARF vorkommen — wie `copy.unbook` nur als `aria-label` und
     * `title` des Zeichens, nicht als Knopftext. „Einbuchen" neben „Ändern"
     * bräuchte über 7rem in einer Spur von 4,5rem.
     */
    expect(section).toContain("aria-label={copy.book}");
    expect(section).toContain("title={copy.book}");
    expect(section).not.toContain(">{copy.book}<");
    /*
     * `copy.unbook` DARF vorkommen — als `aria-label` und `title` des
     * Zeichens, weil „Buchung zurücknehmen" nicht in eine 4,5rem-Spur passt.
     * Geprüft wird deshalb, dass es nur dort steht und nicht als Beschriftung
     * eines eigenen Knopftextes.
     */
    expect(section).toContain("aria-label={copy.unbook}");
    expect(section).toContain("title={copy.unbook}");
    expect(section).not.toContain(">{copy.unbook}<");
  });

  it("und auch nicht „keine Figur“ oder der Merk-Haken", () => {
    /*
     * Beide stehen auf der Detailseite und bleiben dort. „Keine Figur“ setzt
     * `sky_id` auf NULL — eine andere Handlung mit anderen Folgen —, und der
     * Merk-Haken entscheidet über künftige Importe.
     */
    expect(section).not.toContain("remapNotAFigure");
    expect(section).not.toContain("remapRemember");
    expect(read("src/components/business/purchase-items.tsx")).toContain("remapNotAFigure");
  });

  it("genau drei schreibende Aktionen im ganzen Fenster-Abschnitt", () => {
    /*
     * Umhängen und Zurücknehmen — je einmal, und beide über `dispatch` und
     * damit über die Sperre. `onItemAction` kommt im Abschnitt gar nicht mehr
     * vor: es wird nur noch einmal, oben im Bauteil, an `dispatch` gebunden.
     * Genau das hält diese Zusicherung fest — ein neuer schreibender Knopf,
     * der das Eltern-Element direkt ruft, fällt hier auf.
     */
    expect(section).not.toContain("onItemAction(");
    expect(section.split("dispatch(item.id, () =>")).toHaveLength(4);
    expect(section.split("processPurchaseItemSky(")).toHaveLength(2);
    expect(section.split("processUnbookPurchaseItem(")).toHaveLength(2);
    expect(section.split("processBookPurchaseItem(")).toHaveLength(2);
  });
});
