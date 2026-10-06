import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { de } from "../i18n/de";

/**
 * EINE ZEILE WARTET, NICHT DER BILDSCHIRM.
 *
 * WAS VORHER WAR. Beide Verkaufsbildschirme hielten EIN `useTransition`, und
 * jeder Knopf jeder Position hing an dessen `pending`. Ein Klick auf Position 1
 * sperrte die Knöpfe von Position 2 bis 10 — und zwar nicht für die Dauer der
 * Datenbankabfrage, sondern bis Next die GANZE Route serverseitig neu gerendert
 * hatte, weil die Server Action `revalidatePath` rief. Auf `/verkauf/[id]` hieß
 * das `fetchSale` UND `fetchOrderbookCatalog` — zwei weitere Abfragen und über
 * 64 KB Katalog — nach jedem einzelnen Klick.
 *
 * Belegt ist der Mechanismus in der Next-Dokumentation dieses Projekts
 * (`node_modules/next/dist/docs/01-app/02-guides/server-actions.md`):
 *
 *     „When a Server Action triggers an immediate revalidation, Next.js does
 *      the work inside one HTTP request: it runs the action, then re-renders
 *      the current route server-side."
 *
 * und, für die Reihenfolge der Aufrufe:
 *
 *     „Next.js dispatches Server Actions one at a time per client."
 *
 * WAS DIESE DATEI PRÜFT. Drei Dinge, und das dritte ist das wichtigste:
 *
 *   1. Nur die laufende Zeile ist gesperrt — eine MENGE statt eines Flags.
 *   2. Der Positionspfad invalidiert die Route nicht mehr.
 *   3. Der Zustand kommt weiterhin vom Server. Keine optimistische Zahl,
 *      keine Rechnung im Browser, keine Statusvermutung.
 *
 * Geprüft wird am Quelltext. Diese Komponenten hängen an React, an
 * `next/navigation` und an Server Actions; was hier zählt, ist ohnehin, WELCHE
 * Steuerung unter welcher Bedingung gesperrt ist und woher die Daten danach
 * kommen.
 */

/** Ausführbarer Code: ohne Block-, Zeilen- und JSX-Kommentare. */
function codeOf(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//"))
    .join("\n");
}

const DETAIL_FILE = "src/components/business/sale-items.tsx";
const LEDGER_FILE = "src/components/business/sales-ledger.tsx";
const ACTIONS_FILE = "src/lib/orderbook/sales-actions.ts";
const PAGE_FILE = "src/app/(business)/business/orderbuch/verkauf/[id]/page.tsx";
const CREATE_PAGE_FILE = "src/app/(business)/business/orderbuch/verkauf/neu/page.tsx";
const PICKER_FILE = "src/components/business/figure-search.tsx";

const detail = codeOf(DETAIL_FILE);
const ledger = codeOf(LEDGER_FILE);
const actions = codeOf(ACTIONS_FILE);
const page = codeOf(PAGE_FILE);
const createPage = codeOf(CREATE_PAGE_FILE);
const picker = codeOf(PICKER_FILE);

/** Die zwölf Aktionen, die an EINER Position hängen. */
const ITEM_ACTIONS = [
  "setSaleItemSky", "addSaleItem", "removeSaleItem",
  "bookSaleItem", "shipSaleItem", "settleSaleItem", "setSaleItemNotShipped",
  "announceSaleItemReturn", "unbookSaleItem", "returnSaleItem",
  "receiveSaleItemReturn", "restockSaleItem",
] as const;

/** Die Aktionen, die den ganzen Verkauf betreffen und weiter revalidieren. */
const SALE_ACTIONS = [
  "updateSaleAmounts", "setSaleDate", "updateSaleMeta", "setSaleShipped",
  "setSaleTest", "addSaleFee", "updateSaleFee", "removeSaleFee",
  "addSaleRefund", "updateSaleRefund", "removeSaleRefund", "addAdjustment",
] as const;

/** Der Rumpf einer exportierten Action, bis zur nächsten. */
function body(name: string): string {
  const at = actions.indexOf(`export async function ${name}(`);
  expect(at, `${name} ist keine exportierte Action`).toBeGreaterThan(-1);
  const next = actions.indexOf("export ", at + 10);
  return actions.slice(at, next === -1 ? undefined : next);
}

// ---------------------------------------------------------------------------
// 1. Das globale pending ist weg
// ---------------------------------------------------------------------------

describe("kein gemeinsames pending mehr", () => {
  for (const [name, source] of [["Verkauf-Detail", detail],
                                ["Verkaufsbuch", ledger]] as const) {
    it(`${name} hält keine Transition für den ganzen Bildschirm`, () => {
      expect(source, "useTransition sperrt alles auf einmal").not.toContain("useTransition");
      expect(source).not.toContain("startTransition");
      // Und kein Knopf hängt an einem Wert, der für alle Zeilen gilt.
      expect(source).not.toContain("disabled={pending}");
    });

    it(`${name} merkt sich statt dessen die laufenden Positionen`, () => {
      expect(source).toContain("const [busy, setBusy] = useState<ReadonlySet<number>>");
      // Eine Menge, keine Zahl: zwei Zeilen können gleichzeitig unterwegs sein.
      expect(source).toContain("new Set(current).add(");
      expect(source).toContain("next.delete(");
    });

    it(`${name} gibt die Zeile in jedem Fall wieder frei`, () => {
      // `finally`, nicht nach dem Erfolgspfad: eine Ablehnung darf eine Zeile
      // nicht dauerhaft gesperrt zurücklassen.
      expect(source).toContain("} finally {");
    });

    it(`${name} verwirft den zweiten Klick auf dieselbe Zeile`, () => {
      expect(source).toMatch(/if \((?:inflight\.current|busy)\.has\(/);
    });
  }

  it("und im Verkaufsbuch ist die Sperre ein Ref, nicht der Zustand", () => {
    /*
     * WARUM DORT STRENGER.
     *
     * `busy` ist der Zustand des LETZTEN Renders. Ein Doppelklick findet
     * innerhalb eines Durchlaufs statt: beide Klicks sehen dasselbe alte
     * `busy` und kämen beide durch. Ein Ref ist sofort aktuell.
     *
     * Im Verkaufsbuch zählt das, weil dort schnell hintereinander über
     * mehrere aufgeklappte Verkäufe hinweg ausgebucht wird — das war der
     * Anlass. Die Positionsliste eines einzelnen Verkaufs behält ihre
     * bisherige Prüfung: `act` wird dort im selben Bauteil durch
     * `rows.map` gereicht, und `react-hooks/refs` verbietet, ein Ref in
     * eine Funktion zu geben, die das Rendern aufruft. Ein zweiter Klick
     * dort trifft weiterhin die Datenbank, die ihn ablehnt — ein Fehler
     * in einer Zeile, keine zweite Buchung.
     */
    expect(ledger).toContain("const inflight = useRef<Set<number>>(new Set());");
    expect(ledger).toContain("if (inflight.current.has(key)) return;");
    expect(ledger).toContain("inflight.current.add(key);");
    // Und in `finally` wieder frei, wie `busy`.
    expect(ledger).toContain("inflight.current.delete(key);");
  });

  it("das Detail sperrt genau die Zeile, die läuft", () => {
    expect(detail).toContain("const working = busy.has(id);");
    /*
     * Fünf Knöpfe in der Zeile, alle an derselben einen Bedingung. Es waren
     * vier, bis `0110` „Reservieren" dazugestellt hat — die Zahl ist hier
     * Dokumentation: wer eine sechste Steuerung einbaut, soll sie bewusst
     * an `working` hängen und nicht vergessen.
     */
    expect((detail.match(/disabled=\{working\}/g) ?? []).length).toBe(5);
  });

  it("das Verkaufsbuch ebenso, über alle aufgeklappten Zeilen hinweg", () => {
    expect(ledger).toContain("const working = busy.has(id);");
    expect((ledger.match(/disabled=\{working\}/g) ?? []).length).toBe(2);
    /*
     * `sale_items.id` ist eine Identity über die ganze Tabelle, also über
     * alle Verkäufe eindeutig. Eine Menge genügt für die ganze Liste, und
     * zwei Positionen in zwei verschiedenen Verkäufen behindern sich nicht.
     */
    expect(ledger).toContain("busy: ReadonlySet<number>;");
    expect(ledger).toContain("busy={busy}");
  });

  it("und die Ablehnung gehört der Zeile, nicht dem Bildschirm", () => {
    // Zwei gleichzeitige Fehler dürfen sich nicht gegenseitig überschreiben.
    expect(detail).toContain("const [failed, setFailed] = useState<ReadonlyMap<number, string>>");
    expect(detail).toContain("new Map(current).set(key, result.message)");
    expect(detail).toContain("problems.map((problem)");
    /*
     * Im Verkaufsbuch stand dafür EINE Meldung über der ganzen Tabelle. Bei
     * fünf schnellen Klicks war damit nicht zu sehen, welche Position
     * abgelehnt wurde — und die nächste Meldung überschrieb die vorige.
     */
    expect(ledger).toContain("const [failed, setFailed] = useState<ReadonlyMap<number, string>>");
    expect(ledger).toContain("new Map(current).set(key, result.message)");
    expect(ledger).toContain("const failure = failed.get(id) ?? null;");
    expect(ledger).toContain("failed: ReadonlyMap<number, string>;");
  });
});

// ---------------------------------------------------------------------------
// 2. Der Positionspfad rendert die Route nicht mehr neu
// ---------------------------------------------------------------------------

describe("revalidatePath ist aus dem Positions-Hotpath verschwunden", () => {
  it("alle zwölf Positionsaktionen laufen über runItem", () => {
    for (const name of ITEM_ACTIONS) {
      expect(body(name), `${name} muss über runItem laufen`).toContain("return runItem(");
      expect(body(name), `${name} darf nicht mehr revalidieren`).not.toContain("return run(");
    }
  });

  it("runItem ruft revalidatePath nicht", () => {
    const at = actions.indexOf("async function runItem(");
    expect(at).toBeGreaterThan(-1);
    const fn = actions.slice(at, actions.indexOf("\n}", at));
    expect(fn).not.toContain("revalidatePath");
    expect(fn).not.toContain("paths(");
  });

  it("die Aktionen für den ganzen Verkauf revalidieren weiter", () => {
    /*
     * Ausdrücklich NICHT mitgeändert. Sie laufen über das Bearbeitungsfenster,
     * nicht über die Positionsliste, kommen einzeln und ändern Kopfdaten, die
     * auf mehreren Bildschirmen stehen. Der Auftrag war der Hotpath.
     */
    for (const name of SALE_ACTIONS) {
      expect(body(name), `${name} soll weiter revalidieren`).toContain("return run(");
    }
    expect(actions).toContain("for (const p of paths(id)) revalidatePath(p);");
  });

  it("die Liste holt ihre eigenen Spalten nach, statt sie nachzurechnen", () => {
    /*
     * `load` erneuert die Positionen aus `seller_sale`; die Spalte `Lager`
     * der eingeklappten Zeile kommt aus `seller_sales` und wird dort von
     * 0072/0075 entschieden. Nachrechnen wäre eine zweite Wahrheit — also
     * wird nachgeholt, und zwar ohne zu warten, damit der Klick nicht
     * wieder länger wird.
     */
    expect(ledger).toContain("router.refresh();");
    expect(ledger).not.toContain("await router.refresh()");
    expect(ledger).not.toContain("revalidatePath");
    const at = ledger.indexOf("router.refresh();");
    expect(ledger.lastIndexOf("} finally {", at)).toBeGreaterThan(-1);
    /*
     * UND EINMAL FÜR ALLE, NICHT EINMAL PRO KLICK.
     *
     * Fünf Positionen schnell hintereinander hießen fünf Server-Renders der
     * ganzen Route — der eigentliche Grund für das Flackern. Gebündelt wird
     * am Ereignis und nicht an einer Wartezeit: solange noch eine Aktion
     * unterwegs ist, wird nicht nachgeholt; die letzte holt für alle nach.
     * Wer nur einmal klickt, bekommt den Refresh sofort.
     */
    expect(ledger).toContain("const outstanding = useRef(0);");
    expect(ledger).toContain("outstanding.current += 1;");
    expect(ledger).toContain("outstanding.current -= 1;");
    expect(ledger).toContain("if (outstanding.current === 0 && listStale.current) {");
    // Kein Timer als eigentliche Lösung.
    for (const timer of ["setTimeout", "setInterval", "requestAnimationFrame", "debounce"]) {
      expect(ledger, timer).not.toContain(timer);
    }
    // Und die Entscheidung selbst bleibt die eine Funktion.
    expect(ledger).toContain("saleStockStatus(sale)");
    for (const forbidden of ["outbookedCount =", "settledCount =", "closedCount ="]) {
      expect(ledger, forbidden).not.toContain(forbidden);
    }
  });

  it("die aufgeklappten Positionen bleiben beim Nachlesen stehen", () => {
    /*
     * DER EIGENTLICHE FLACKERGRUND, ALS ZUSICHERUNG.
     *
     * `load(id, true)` hat `details[id]` gelöscht, bevor es neu gelesen hat
     * — die aufgeklappte Liste fiel damit auf „Positionen werden geladen …"
     * zurück, einmal pro Klick, mitten unter dem Finger. Eine Sekunde
     * veraltet ist unendlich viel besser als eine Sekunde nicht da.
     */
    expect(ledger).not.toMatch(/delete next\[id\]/);
    expect(ledger).not.toMatch(/delete next\[saleId\]/);
    /*
     * Und eine überholte Antwort schreibt nicht über den neueren Zustand:
     * zwei Klicks heißen zwei Antworten, und die Reihenfolge, in der sie
     * zurückkommen, ist nicht die, in der sie losgeschickt wurden.
     */
    expect(ledger).toContain("const reads = useRef<Map<number, number>>(new Map());");
    expect(ledger).toContain("if (reads.current.get(id) !== token) return;");
  });

  it("der Katalog liegt nicht mehr im Render der Detailseite", () => {
    expect(page, "zwei Abfragen und 64 KB pro Render").not.toContain("fetchOrderbookCatalog");
    expect(page).toContain("const detail = await fetchSale(Number(id));");
    // Und die Anlegemaske behält ihn, weil die Suche dort der Zweck ist.
    expect(createPage).toContain("fetchOrderbookCatalog()");
  });

  it("sondern wird beim ersten Hineingreifen in die Suche geholt", () => {
    expect(detail).toContain("const ensureFigures = useCallback(");
    expect(detail).toContain("loadOrderbookFigures()");
    // Fokus steigt in React auf: die Suche braucht dafür keinen eigenen Handler.
    expect((detail.match(/onFocus=\{ensureFigures\}/g) ?? []).length).toBe(2);
    // Und einmal geholt, wird er nicht erneut geholt.
    expect(detail).toContain("if (catalog !== undefined || figures !== null || loadingFigures) return;");
  });

  it("die Action reicht die EINE Katalogquelle durch", () => {
    expect(body("loadOrderbookFigures")).toContain("return fetchOrderbookCatalog();");
    // Kein zweiter Weg zum Katalog in der Positionsliste.
    expect(detail).not.toContain("seller_import_catalog");
  });

  it("und ein noch nicht geladener Katalog behauptet nicht, gescheitert zu sein", () => {
    expect(picker).toContain('state === "noCatalog" ? (loading ? copy.loadingCatalog : copy.noCatalog)');
    expect(picker).toContain('disabled={disabled || (state === "noCatalog" && !loading)}');
    expect(de.business.orderbook.figures.loadingCatalog).toBe("Katalog wird geladen …");
    expect(de.business.orderbook.figures.noCatalog)
      .toBe("Der Katalog konnte nicht geladen werden.");
  });
});

// ---------------------------------------------------------------------------
// 3. Der Server bleibt autoritativ
// ---------------------------------------------------------------------------

describe("nichts wird optimistisch gesetzt", () => {
  it("die Aktion liest den Verkauf selbst nach, in derselben Antwort", () => {
    const at = actions.indexOf("async function runItem(");
    const fn = actions.slice(at, actions.indexOf("\n}", at));
    // Dieselbe Projektion, aus der die Seite rendert.
    expect(fn).toContain('supabase.rpc("seller_sale", { p_id: saleId })');
    expect(actions).toContain('supabase.rpc("seller_sale", { p_id: id })'); // fetchSale-Zwilling
    /*
     * In DERSELBEN Antwort, nicht als zweiter Aufruf aus dem Browser: Next
     * schickt Server Actions pro Client nacheinander los, ein zweiter hätte
     * sich hinter den nächsten Klick gestellt.
     */
    expect(fn.indexOf('rpc("seller_sale"'), "erst schreiben, dann lesen")
      .toBeGreaterThan(fn.indexOf("supabase.rpc(fn, args)"));
  });

  it("und erst nach dem Lesen gilt der neue Zustand", () => {
    expect(detail).toContain("const next = result.sale?.items;");
    expect(detail).toContain("if (!internal && Array.isArray(next)) setFresh(");
    expect(detail).toContain("const rows = fresh ?? items;");
  });

  for (const [name, source] of [["Verkauf-Detail", detail],
                                ["Verkaufsbuch", ledger]] as const) {
    it(`${name} erfindet keine Bestands- oder Statuswerte`, () => {
      expect(source).not.toContain("useOptimistic");
      // Keine Rechnung auf einer Menge, keine selbst gesetzte Endung.
      for (const forbidden of ["quantity -", "quantity +", "movement_id =",
                               "settled_at =", "not_shipped_at =", "returned_at ="]) {
        expect(source, forbidden).not.toContain(forbidden);
      }
      // Und jeder Schreibweg bleibt eine seller-gated Action.
      for (const forbidden of ['from("sales")', 'from("sale_items")',
                               "SERVICE_ROLE", "createServiceClient", ".insert("]) {
        expect(source, forbidden).not.toContain(forbidden);
      }
    });

    it(`${name} wertet die Ablehnung weiterhin aus`, () => {
      expect(source).toContain("if (!result.ok)");
    });
  }

  it("ein interner Verkauf behält seine Form aus der Bestellung", () => {
    /*
     * Dessen Positionen kommen aus `order.lines` und werden von der Seite
     * umgeformt; `result.sale.items` wäre die falsche Gestalt. Er hat hier
     * ohnehin keine Aktion — die Bedingung ist der Beweis, nicht der Zufall.
     */
    expect(detail).toContain("if (!internal && Array.isArray(next))");
  });
});

// ---------------------------------------------------------------------------
// 4. Was ausdrücklich NICHT verändert wurde
// ---------------------------------------------------------------------------

describe("die fachliche Semantik ist dieselbe", () => {
  it("dieselben Entscheidungen über Knöpfe wie vorher", () => {
    // `saleItemActions` entscheidet weiter allein, welcher Knopf erscheint.
    expect(detail).toContain("saleItemActions(item as never, {");
    expect(ledger).toContain("saleItemActions(");
  });

  it("dieselben zwölf Positionswege, keiner dazu und keiner weg", () => {
    for (const name of ITEM_ACTIONS) {
      expect(actions, name).toContain(`export async function ${name}(`);
    }
    // Und die Signaturen tragen weiter die saleId, die runItem zum Nachlesen braucht.
    expect(actions).toContain("export async function bookSaleItem(itemId: number, saleId: number)");
  });

  it("Ausbuchen bleibt der eine Weg über das Lagerjournal", () => {
    expect(body("bookSaleItem")).toContain('"seller_book_sale_item"');
    expect(body("shipSaleItem")).toContain('"seller_ship_sale_item"');
  });

  it("und es ist kein Orderstatus aus 0111 entstanden", () => {
    /*
     * `seller_hold_sale_item` stand hier auf der Verbotsliste, solange der
     * Umbau reiner Performance war. `0110` hat den External Hold dann
     * absichtlich gebaut, also ist das Verbot aufgehoben — der Hold ist
     * jetzt in `external-hold-runtime.test.ts` zu Hause.
     *
     * Was verboten BLEIBT, ist die Status-State-Machine aus `0111`: sie ist
     * nicht gebaut, und keiner dieser Bildschirme darf sie vorwegnehmen.
     */
    for (const source of [detail, ledger, actions, page]) {
      for (const forbidden of ["seller_set_sale_status", "setSaleStatus",
                               "external_stock_holds"]) {
        expect(source, forbidden).not.toContain(forbidden);
      }
    }
  });
});
