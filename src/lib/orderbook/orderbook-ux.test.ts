/**
 * FÜNF VERBESSERUNGEN AM EXTERNEN VERKAUFSABLAUF, JEDE MIT IHRER ZUSICHERUNG.
 *
 * Diese Datei prüft genau die fünf Punkte, die in einem Durchgang entstanden
 * sind, und sie prüft sie dort, wo sie entschieden werden:
 *
 *   1. Datum beim Anlegen            Pflicht, im Client UND im Server.
 *   2. Freie Artikel                 `raw_name`, `sky_id NULL` — und damit
 *                                    ohne Katalog, Lager, Hold und Bewegung.
 *   3. Vier vorbelegte Kostenzeilen  drei Gebühren plus eine Rückerstattung,
 *                                    die Rückerstattung in `sale_refunds`.
 *   4. Schnelles Ausbuchen           keine blanke Liste, kein Refresh pro
 *                                    Klick, kein doppelter Klick, veraltete
 *                                    Antworten überschreiben nichts.
 *   5. Kompaktere Übersicht          Artikelzahl und Käufer in der Zeile,
 *                                    Auszahlung im Geldfenster, Lagerstatus
 *                                    als Punkt mit vollem Namen.
 *
 * WAS HIER NICHT GEPRÜFT WIRD, UND WARUM NICHT. Keine dieser fünf Änderungen
 * hat eine Migration. Punkt 2 benutzt den Vertrag aus `0059` und das
 * Reservierungsverhalten aus `0110`; beide stehen unverändert da, und beide
 * werden deshalb AM MIGRATIONSTEXT nachgelesen statt nachgebaut — ein
 * nachgebauter Vertrag ist eine zweite Wahrheit.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { code, latestFunction, migrationSource } from "@/test-support/migrations";
import { de } from "@/lib/i18n/de";
import {
  addFreeItem, freeItemCount, freeItemPayload, removeFreeItem, setFreeQuantity,
} from "./free-items";
import {
  REFUND_COST_ID, SALE_COST_TYPES, initialFees, initialRefunds, refundAmounts,
  saleTemplate,
} from "./sale-template";
import { saleStockIndicator } from "./sales-view";

/**
 * Ausführbarer Code: ohne Block-, Zeilen- und JSX-Kommentare.
 *
 * Dieselbe Vorbehandlung wie in `sale-items-performance.test.ts`, und aus
 * demselben Grund: diese Datei prüft, WAS der Code tut. Ein Kommentar, der
 * erklärt, was früher dastand („hier stand ein `useTransition`"), darf eine
 * Zusicherung über das Jetzt nicht auslösen.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("//"))
  .join("\n");

/** Derselbe Pfad, aber wortwörtlich — für die Prüfsummen der Migrationen. */
const raw = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const NEW_SALE = read("src/components/business/new-sale.tsx");
const ACTIONS = read("src/lib/orderbook/sales-actions.ts");
const LEDGER = read("src/components/business/sales-ledger.tsx");
const DETAILS = read("src/components/business/sale-details.tsx");
const SEARCH = read("src/components/business/figure-search.tsx");
const DRAFT = read("src/components/business/figure-draft.tsx");
const FREE = read("src/components/business/free-items.tsx");
const SALE_ITEMS = read("src/components/business/sale-items.tsx");

/** Der Rumpf einer exportierten Server Action, bis zur nächsten. */
function action(name: string): string {
  const at = ACTIONS.indexOf(`export async function ${name}(`);
  expect(at, `${name} ist keine exportierte Action`).toBeGreaterThan(-1);
  const next = ACTIONS.indexOf("\nexport ", at + 10);
  return ACTIONS.slice(at, next === -1 ? undefined : next);
}

// ---------------------------------------------------------------------------
// 1. Das Datum ist beim Anlegen Pflicht
// ---------------------------------------------------------------------------

describe("1. ein Verkauf ohne Datum wird nicht angelegt", () => {
  it("der Server weist ihn ab, nicht nur das Formular", () => {
    /*
     * Das ist die eigentliche Sperre. `required` ist eine Bitte an den
     * Browser, und `createSaleWithDetails` ist eine Server Action — über
     * ihre eigene Route aufrufbar, ganz ohne das Formular.
     */
    const create = action("createSaleWithDetails");
    expect(create).toContain("const soldAt = input.soldAt.trim();");
    expect(create).toContain("if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(soldAt)) {");
    expect(create).toContain("message: de.business.sales.create.dateRequired");
    // Geprüft VOR dem RPC: es darf nichts entstehen, was danach abgelehnt wird.
    expect(create.indexOf("test(soldAt)"))
      .toBeLessThan(create.indexOf('supabase.rpc("seller_create_sale_with_details"'));
    // Und der Typ sagt es auch: kein `null` mehr an dieser Stelle.
    expect(create).toContain("soldAt: string;");
    expect(create).not.toContain("soldAt: string | null;");
  });

  it("das Formular sagt es auf Deutsch und hält den Absenden-Knopf auf", () => {
    expect(NEW_SALE).toContain('if (soldAt.trim() === "") { setError(create.dateRequired); return; }');
    expect(NEW_SALE).toContain('<input type="date"');
    expect(NEW_SALE).toContain('required aria-required="true"');
    expect(de.business.sales.create.dateRequired).toBe("Bitte das Verkaufsdatum eintragen.");
    // Geprüft, bevor irgendein Betrag geprüft wird: das Datum steht oben.
    expect(NEW_SALE.indexOf("create.dateRequired"))
      .toBeLessThan(NEW_SALE.indexOf("create.invalidAmount"));
    // Und es wird nicht mehr als „leer heißt null" weitergereicht.
    expect(NEW_SALE).not.toContain("soldAt: soldAt.trim() || null");
    expect(NEW_SALE).toContain("soldAt: soldAt.trim(),");
  });

  it("aber bestehende undatierte Verkäufe bleiben, wie sie sind", () => {
    /*
     * 0059 lässt `sales.sold_at` bewusst null — manche Zeilen der
     * Arbeitsmappe tragen kein Datum, und 0058 hat dieselbe Freiheit für
     * Einkäufe geschaffen. Die Pflicht gilt NUR beim Anlegen.
     */
    expect(code(migrationSource("0059_orderbook_sales.sql")))
      .toMatch(/create table if not exists public\.sales \([\s\S]*?sold_at date,/);
    // Das Bearbeiten verlangt weiterhin keines.
    expect(action("setSaleDate")).toContain("p_sold_at: soldAt");
    expect(action("setSaleDate")).not.toContain("dateRequired");
    // Und das Verkaufsbuch stellt undatierte Zeilen weiter dar.
    expect(LEDGER).toContain("copy.undated");
    expect(de.business.sales.undated).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 2. Freie Artikel
// ---------------------------------------------------------------------------

describe("2. freie Artikel über raw_name, ohne jede Lagerwirkung", () => {
  it("speichern den eingegebenen Namen, roh und unverändert", () => {
    const lines = addFreeItem([], "  Portal of Power  ", "k0", 200);
    expect(lines).toHaveLength(1);
    expect(lines[0].name).toBe("Portal of Power");
    // Nicht normalisiert, nicht großgeschrieben, nicht korrigiert (Regel 4).
    expect(addFreeItem([], "spyro's adventure PORTAL", "k1", 200)[0].name)
      .toBe("spyro's adventure PORTAL");
    expect(freeItemPayload(lines)).toEqual([{ raw_name: "Portal of Power" }]);
  });

  it("haben keine sky_id — auch keine erfundene", () => {
    const payload = freeItemPayload(addFreeItem([], "Trap Team Spiel", "k0", 200));
    expect(payload).toEqual([{ raw_name: "Trap Team Spiel" }]);
    /*
     * Das Feld fehlt, statt `null` zu sein, und das ist Absicht:
     * `seller_create_sale_with_details` liest `e->>'sky_id'` und macht
     * daraus `nullif(btrim(...), '')` — ein fehlendes Feld ist dort genau
     * so viel wie ein leeres, nämlich NULL.
     */
    expect("sky_id" in payload[0]).toBe(false);
    // Und nichts im Entwurfsmodell kennt ein SKY-ID-förmiges Feld.
    expect(read("src/lib/orderbook/free-items.ts")).not.toMatch(/skyId:/);
    expect(FREE).not.toMatch(/skyId/);
  });

  it("ein Element pro physischem Stück, wie beim Katalogentwurf", () => {
    let lines = addFreeItem([], "Poster", "k0", 200);
    lines = addFreeItem(lines, "Poster", "k1", 199);
    // Zwei gleiche Namen sind EINE Zeile mit zwei Stücken …
    expect(lines).toHaveLength(1);
    expect(freeItemCount(lines)).toBe(2);
    // … und trotzdem zwei Datensätze.
    expect(freeItemPayload(lines)).toEqual([{ raw_name: "Poster" }, { raw_name: "Poster" }]);
    expect(setFreeQuantity(lines, "k0", 0, 198)).toEqual([]);
    expect(removeFreeItem(lines, "k0")).toEqual([]);
  });

  it("zu kurze Namen und ein erschöpftes Kontingent erzeugen nichts", () => {
    expect(addFreeItem([], "a", "k0", 200)).toEqual([]);
    expect(addFreeItem([], "   ", "k0", 200)).toEqual([]);
    expect(addFreeItem([], "Portal", "k0", 0)).toEqual([]);
    // Und eine bestehende Zeile wächst nicht über das Kontingent hinaus.
    const lines = addFreeItem([], "Portal", "k0", 200);
    expect(setFreeQuantity(lines, "k0", 5, 0)[0].quantity).toBe(1);
  });

  it("erzeugen keinen Hold — das entscheidet 0110, nicht die Oberfläche", () => {
    /*
     * `hold_sale_item` verlässt sich auf nichts im Browser: die erste
     * Prüfung im Rumpf ist die auf eine fehlende `sky_id`, und sie kommt
     * VOR jedem Zugriff auf `shop_inventory` und vor jedem Insert in
     * `order_reservations`.
     */
    const hold = code(latestFunction("hold_sale_item").body);
    expect(hold).toContain("if v_item.sky_id is null then");
    expect(hold).toContain("return 'not_a_figure';");
    const guard = hold.indexOf("v_item.sky_id is null");
    expect(guard).toBeGreaterThan(-1);
    for (const after of ["shop_inventory", "order_reservations", "reserved"]) {
      const at = hold.indexOf(after);
      if (at === -1) continue;
      expect(at, `${after} darf erst nach der sky_id-Prüfung vorkommen`)
        .toBeGreaterThan(guard);
    }
  });

  it("und können per CHECK keine Lagerbewegung besitzen", () => {
    /*
     * `sale_items_movement_needs_figure` ist der Grund, warum eine freie
     * Position für das Lager unsichtbar ist: ohne `sky_id` kein
     * `movement_id`, und ohne `movement_id` keine `inventory_movements`.
     */
    const sales = code(migrationSource("0059_orderbook_sales.sql"));
    expect(sales).toContain("constraint sale_items_movement_needs_figure");
    expect(sales).toContain("check (movement_id is null or sky_id is not null)");
    // Und identifizierbar bleibt sie über den Namen.
    expect(sales).toContain("constraint sale_items_identifiable");
    expect(sales)
      .toContain("check (sky_id is not null or (raw_name is not null and length(btrim(raw_name)) > 0))");
  });

  it("verändern weder Katalog noch Lager: die Oberfläche kennt dafür keinen Weg", () => {
    // Kein Schreibpfad auf `skylanders` oder `shop_inventory` im Verkauf.
    for (const [name, source] of [["Formular", NEW_SALE], ["Positionsliste", SALE_ITEMS],
                                  ["freie Liste", FREE]] as const) {
      for (const forbidden of ["skylanders", "shop_inventory", "inventory_movements",
                               "record_inventory_movement", "set_shop_listing"]) {
        expect(source, `${name}/${forbidden}`).not.toContain(forbidden);
      }
    }
    // Und die Anlage geht weiter durch die EINE Funktion, die es dafür gibt.
    expect(action("createSaleWithDetails")).toContain("seller_create_sale_with_details");
    expect(action("addSaleItem")).toContain("seller_add_sale_item");
  });

  it("der Katalogartikel funktioniert unverändert und reserviert weiter", () => {
    /*
     * Die wichtigste Zusicherung dieses Abschnitts: der freie Artikel ist
     * ein ZWEITER Weg und nicht ein geänderter erster. Eine Figur wird
     * weiter über `addFigure`/`draftPayload` gewählt und trägt ihre
     * `sky_id`.
     */
    expect(NEW_SALE).toContain("items: [...draftPayload(lines), ...freeItemPayload(freeLines)],");
    expect(DRAFT).toContain("onChange(addFigure(lines, choice))");
    expect(read("src/lib/orderbook/draft.ts")).toContain("payload.push({ sky_id: line.skyId })");
    // Und `seller_add_sale_item` reserviert für sie wie seit 0110.
    const add = code(latestFunction("seller_add_sale_item").body);
    expect(add).toContain("hold_sale_item");
  });

  it("der Rückfall steht in der Suche, nur bei keinem Treffer, nie auf Enter", () => {
    expect(SEARCH).toContain('const free = onFree !== undefined && state === "empty" ? query.trim() : null;');
    expect(SEARCH).toContain("{copy.addFree(free)}");
    expect(de.business.orderbook.figures.addFree("Portal"))
      .toBe('+ „Portal" ohne Katalogzuordnung hinzufügen');
    // Enter nimmt weiterhin nur einen Treffer.
    expect(SEARCH).toContain("if (results[active]) choose(results[active]);");
    expect(SEARCH).not.toMatch(/Enter[\s\S]{0,200}chooseFree/);
    /*
     * Und das Korrekturfeld in einer Zeile bekommt ihn NICHT: „Ändern"
     * tauscht eine Figur gegen eine andere Figur. Genau eine Suche im
     * Figurenentwurf trägt `onFree`, und es ist die obere.
     */
    expect((DRAFT.match(/onFree=\{onFree\}/g) ?? []).length).toBe(1);
    expect(DRAFT.indexOf("onFree={onFree}")).toBeLessThan(DRAFT.indexOf("changeOne(line.name)"));
    // Der Einkauf übergibt nichts und bleibt damit unverändert.
    expect(read("src/components/business/new-purchase.tsx")).not.toContain("onFree");
  });

  it("und derselbe Weg steht an einem bestehenden Verkauf offen", () => {
    /*
     * Ein Portal, das beim Anlegen vergessen wurde, muss nicht als Figur
     * erfunden werden. Dieselbe Suche, derselbe Rückfall, derselbe Aufruf
     * wie für einen Katalogartikel — nur mit `null` statt einer `sky_id`.
     */
    expect(SALE_ITEMS).toContain("act(ADD_ITEM, () => addSaleItem(saleId, null, name, \"loose\"))");
    expect(action("addSaleItem")).toContain("p_raw_name: rawName");
  });

  it("die Obergrenze gilt für Figuren und freie Positionen zusammen", () => {
    /*
     * `p_items` nimmt 200 Elemente, und `addFigure` kennt nur seine eigene
     * Hälfte. Ohne diese Prüfung käme als Antwort ein
     * `program_limit_exceeded` aus der Datenbank statt eines Satzes.
     */
    expect(NEW_SALE)
      .toContain("if (draftUnitCount(lines) + freeItemCount(freeLines) > MAX_DRAFT_UNITS) {");
    expect(NEW_SALE).toContain("de.business.orderbook.figures.limit(MAX_DRAFT_UNITS)");
    expect(code(latestFunction("seller_create_sale_with_details").body))
      .toContain("jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 200");
  });
});

// ---------------------------------------------------------------------------
// 3. Vier vorbelegte Kostenzeilen
// ---------------------------------------------------------------------------

describe("3. vier Default-Kostenfelder, und das vierte ist keine Gebühr", () => {
  it("drei Gebührenzeilen plus eine Rückerstattungszeile", () => {
    const fees = initialFees(saleTemplate("ebay"), (n) => `f${n}`);
    const refunds = initialRefunds(saleTemplate("ebay"), (n) => `r${n}`);
    expect(fees.map((f) => f.label)).toEqual([
      "Transaktionsgebühr", "Versandkosten (Label)", "Anzeigegebühr",
    ]);
    expect(refunds).toHaveLength(1);
    expect(fees.length + refunds.length).toBe(4);
    // Alle leer: eine vorbelegte Zeile ist ein Platz, keine Behauptung.
    expect([...fees.map((f) => f.amount), ...refunds.map((r) => r.amount)])
      .toEqual(["", "", "", ""]);
  });

  it("die Anzeigegebühr benutzt die bestehende Fee-Semantik", () => {
    const listing = initialFees(saleTemplate("ebay"), (n) => `f${n}`)[2];
    expect(listing.kind).toBe("marketplace");
    expect(listing.settledBy).toBe("channel");
    // Genau dieselbe Art, die das Menü schon immer angeboten hat.
    const fromMenu = SALE_COST_TYPES.find((t) => t.id === "listing");
    expect(fromMenu?.label).toBe(listing.label);
    expect(fromMenu?.storage).toBe("fee");
    // Und `marketplace` ist einer der vier Werte, die 0059 erlaubt.
    expect(code(migrationSource("0059_orderbook_sales.sql")))
      .toContain("kind in ('payment', 'marketplace', 'shipping_label', 'other')");
  });

  it("die Rückerstattung ist im Menü wählbar und landet in sale_refunds", () => {
    expect(SALE_COST_TYPES.some((t) => t.id === REFUND_COST_ID)).toBe(true);
    expect(de.business.sales.create.feeTypes.refund).toBe("Rückerstattung");
    const create = action("createSaleWithDetails");
    expect(create).toContain('supabase.rpc("seller_add_sale_refund"');
    // Nicht als Gebühr, nirgends.
    expect(create).not.toMatch(/p_fees[\s\S]{0,200}refund/);
    expect(refundAmounts([{ key: "r", amount: "7,50" }])).toEqual([7.5]);
    // Und die Tabelle dahinter ist die, die es dafür seit 0059 gibt.
    expect(code(migrationSource("0059_orderbook_sales.sql")))
      .toContain("create table if not exists public.sale_refunds");
  });

  it("ein leeres Feld erzeugt keinen Datensatz", () => {
    expect(refundAmounts([{ key: "r", amount: "" }])).toEqual([]);
    expect(refundAmounts([{ key: "r", amount: "0,00" }])).toEqual([]);
    // Und der Server lässt eine Null zusätzlich fallen.
    expect(action("createSaleWithDetails")).toContain("if (!(amount > 0)) continue;");
  });
});

// ---------------------------------------------------------------------------
// 3b. Der Teilerfolg
// ---------------------------------------------------------------------------

describe("3b. Verkauf angelegt, Rückerstattung nicht", () => {
  it("der Server meldet den Teilerfolg, statt den Verkauf zu verleugnen", () => {
    const create = action("createSaleWithDetails");
    /*
     * Die gefährlichste Antwort wäre „fehlgeschlagen" für einen Verkauf,
     * der existiert: der Betreiber würde es erneut versuchen und hätte
     * zwei. Also drei Lagen statt zwei.
     */
    expect(ACTIONS).toContain('| { ok: true; id: number; refund: "none" | "saved" | "failed" }');
    expect(create).toContain('if (refundError) { refund = "failed"; break; }');
    expect(create).toContain("return { ok: true as const, id: data, refund };");
    // Kein Rückbau des Verkaufs, keine Löschung, kein zweiter Versuch.
    for (const forbidden of ["seller_delete_sale", "retry", "while ("]) {
      expect(create, forbidden).not.toContain(forbidden);
    }
  });

  it("kein automatischer zweiter Versuch, der doppelt erstatten könnte", () => {
    const create = action("createSaleWithDetails");
    // `break` und nicht `continue`: nach dem ersten Fehlschlag ist Schluss.
    expect(create).toMatch(/if \(refundError\) \{ refund = "failed"; break; \}/);
    expect((create.match(/seller_add_sale_refund/g) ?? []).length).toBe(1);
  });

  it("das Formular leitet dann NICHT weiter und sperrt den Knopf", () => {
    expect(NEW_SALE).toContain('if (created.refund === "failed") { setPartial(created.id); return; }');
    // Weitergeleitet wird erst danach — der Teilerfolg kommt vorher.
    expect(NEW_SALE.indexOf("setPartial(created.id)"))
      .toBeLessThan(NEW_SALE.indexOf("router.push(`/business/orderbuch/verkauf?verkauf="));
    expect(NEW_SALE).toContain("disabled={partial !== null}");
    expect(NEW_SALE).toContain("if (partial !== null) return;");
  });

  it("und bietet den Weg an, die Rückerstattung nachzutragen", () => {
    expect(NEW_SALE).toContain("{create.refundFailed}");
    expect(NEW_SALE).toContain("{create.openCreatedSale}");
    expect(NEW_SALE).toContain("href={`/business/orderbuch/verkauf?verkauf=${partial}`}");
    expect(de.business.sales.create.refundFailed).toContain("Verkauf wurde angelegt");
    expect(de.business.sales.create.refundFailed).toContain("Rückerstattung konnte nicht");
    // Und dort gibt es den Pfad dafür, unverändert.
    expect(DETAILS).toContain("addRefund");
    expect(ACTIONS).toContain("export async function addSaleRefund(");
  });
});

// ---------------------------------------------------------------------------
// 4. Schnelles Ausbuchen
// ---------------------------------------------------------------------------

describe("4. mehrere Positionen schnell hintereinander", () => {
  it("verschiedene Positionen behindern sich nicht", () => {
    /*
     * Die Sperre hängt an `sale_items.id` — einer Identity über die ganze
     * Tabelle —, nicht am Verkauf und nicht am Bildschirm. Zwei Positionen,
     * auch in zwei verschiedenen Verkäufen, laufen gleichzeitig.
     */
    expect(LEDGER).toContain("const [busy, setBusy] = useState<ReadonlySet<number>>");
    expect(LEDGER).toContain("inflight.current.add(key);");
    expect(LEDGER).not.toContain("useTransition");
    expect(LEDGER).not.toContain("disabled={pending}");
    // Und die Sperre betrifft genau eine Position.
    expect(LEDGER).toContain("const working = busy.has(id);");
  });

  it("dieselbe Position kann nicht doppelt ausgelöst werden", () => {
    /*
     * Die Sperre ist ein Ref und damit sofort wirksam: `busy` ist der
     * Zustand des letzten Renders, und ein Doppelklick findet innerhalb
     * eines Durchlaufs statt — beide Klicks sähen dasselbe alte `busy`.
     */
    expect(LEDGER).toContain("if (inflight.current.has(key)) return;");
    expect(LEDGER).toContain("inflight.current.add(key);");
    // Und in `finally` wieder frei — eine Ablehnung sperrt nicht dauerhaft.
    expect(LEDGER).toContain("inflight.current.delete(key);");
    expect(LEDGER).toContain("} finally {");
    /*
     * Die Positionsliste eines einzelnen Verkaufs behält ihre bisherige
     * Prüfung über `busy`. Dort reicht `rows.map` dieselbe `act`-Funktion
     * durch, und `react-hooks/refs` verbietet, ein Ref in eine Funktion zu
     * geben, die das Rendern aufruft. Ein zweiter Klick trifft dort
     * weiterhin die Datenbank, die ihn ablehnt.
     */
    expect(SALE_ITEMS).toContain("if (busy.has(key)) return;");
    expect(SALE_ITEMS).toContain("} finally {");
  });

  it("die aufgeklappte Liste wird beim Nachlesen nicht geleert", () => {
    expect(LEDGER).not.toMatch(/delete next\[id\]/);
    expect(LEDGER).toContain("setDetails((current) => ({ ...current, [id]: d ?? \"failed\" }))");
  });

  it("veraltete Antworten überschreiben keinen neueren Zustand", () => {
    expect(LEDGER).toContain("const reads = useRef<Map<number, number>>(new Map());");
    expect(LEDGER).toContain("if (reads.current.get(id) !== token) return;");
    // Auch die Antwort der Aktion selbst zählt als Lesung.
    expect(LEDGER).toContain("reads.current.set(saleId, (reads.current.get(saleId) ?? 0) + 1);");
  });

  it("router.refresh() wird gebündelt, ohne Timer", () => {
    expect(LEDGER).toContain("const outstanding = useRef(0);");
    expect(LEDGER).toContain("if (outstanding.current === 0 && listStale.current) {");
    expect((LEDGER.match(/router\.refresh\(\)/g) ?? []).length).toBe(1);
    for (const timer of ["setTimeout", "setInterval", "requestAnimationFrame"]) {
      expect(LEDGER, timer).not.toContain(timer);
    }
    // Und der Positionspfad revalidiert die Route weiterhin nicht.
    expect(LEDGER).not.toContain("revalidatePath");
  });

  it("die betroffene Position reagiert sofort, behauptet aber kein Ergebnis", () => {
    expect(LEDGER).toContain(": working ? copy.itemRunning");
    expect(de.business.sales.itemRunning).toBe("läuft …");
    /*
     * Der Endzustand kommt aus der Antwort der Aktion — `runItem` liest
     * `seller_sale` in derselben Server Action nach —, nicht aus einer
     * Vermutung im Browser.
     */
    expect(LEDGER).toContain("const items = (result.sale as Detail | null)?.items;");
    expect(LEDGER).toContain("setDetails((current) => ({ ...current, [saleId]: result.sale as Detail }));");
    // Und `saleItemActions` bleibt die einzige Stelle, die einen Zustand bestimmt.
    expect(LEDGER).toContain("saleItemActions(item as never");
    expect(LEDGER).not.toMatch(/movement_id:\s*-1/);
  });

  it("ein Fehler rollt nur die betroffene Position zurück", () => {
    expect(LEDGER).toContain("const [failed, setFailed] = useState<ReadonlyMap<number, string>>");
    expect(LEDGER).toContain("setFailed((current) => new Map(current).set(key, result.message));");
    expect(LEDGER).toContain("const failure = failed.get(id) ?? null;");
    // Bei einer Ablehnung wird `details` nicht angefasst.
    const act = LEDGER.slice(LEDGER.indexOf("const act = (saleId: number"),
                             LEDGER.indexOf("const showingSale"));
    expect(act.indexOf("setFailed((current) => new Map"))
      .toBeLessThan(act.indexOf("setDetails((current) =>"));
    expect(act).toContain("if (!result.ok) {");
  });
});

// ---------------------------------------------------------------------------
// 5. Die kompaktere Übersicht
// ---------------------------------------------------------------------------

describe("5. die Verkaufszeile zeigt Artikel und Käufer", () => {
  it("Artikelanzahl und Käufer stehen in der Zeile", () => {
    const row = LEDGER.slice(LEDGER.indexOf("<LedgerRow "), LEDGER.indexOf("</LedgerRow>"));
    expect(row).toContain("{copy.itemsCount(sale.itemCount)}");
    expect(row).toContain("{sale.buyerRef ?? \"—\"}");
    expect(de.business.sales.itemsCount(1)).toBe("1 Artikel");
    expect(de.business.sales.itemsCount(3)).toBe("3 Artikel");
    /*
     * Beide kommen aus `seller_sales()` und werden nicht nachgerechnet —
     * `item_count` und `buyer_ref` liegen seit 0062 im Lesemodell.
     */
    const queries = read("src/lib/orderbook/sales-queries.ts");
    expect(queries).toContain("itemCount: n(r.item_count),");
    expect(queries).toContain("buyerRef: (r.buyer_ref as string) ?? null,");
  });

  it("der Lagerstatus bleibt sichtbar — als Punkt mit vollem Namen", () => {
    expect(LEDGER).toContain("<StockDot sale={sale} />");
    expect(LEDGER).toContain("saleStockStatus(sale)");
    expect(LEDGER).toContain("saleStockIndicator(status)");
    expect(LEDGER).toContain("label={`${text} — ${title}`}");
    /*
     * Dieselbe Entscheidung wie vorher, nur anders dargestellt: Status und
     * Satz kommen unverändert aus `saleStockStatus()` und `copy.stock`.
     */
    for (const key of ["outbooked", "returned", "closed", "cancelled", "frozen",
                       "open", "partial"] as const) {
      expect(de.business.sales.stock[key], key).toBeTruthy();
    }
    // Nichts wird nachgerechnet.
    for (const forbidden of ["outbookedCount =", "settledCount =", "closedCount ="]) {
      expect(LEDGER, forbidden).not.toContain(forbidden);
    }
  });

  it("jeder Lagerzustand hat sein eigenes Zeichen, nicht nur eine Farbe", () => {
    const statuses = ["outbooked", "returned", "closed", "partial", "cancelled",
                      "frozen", "open"] as const;
    const seen = new Map<string, string>();
    for (const status of statuses) {
      const dot = saleStockIndicator(status);
      expect(dot.glyph, status).toBeTruthy();
      seen.set(status, `${dot.tone}/${dot.glyph}`);
    }
    // „offen" und „teilweise" — die beiden, auf die der Betreiber schaut —
    // sind weder in Ton noch in Zeichen zu verwechseln.
    expect(seen.get("open")).not.toBe(seen.get("partial"));
    expect(seen.get("partial")).not.toBe(seen.get("outbooked"));
    expect(saleStockIndicator("outbooked").glyph).toBe("✓");
    expect(saleStockIndicator("open").glyph).toBe("○");
    // Und der Punkt rendert über die EINE vorhandene Komponente.
    expect(LEDGER).toContain('from "./sale-indicator"');
    expect(read("src/components/business/sale-indicator.tsx"))
      .toContain("aria-label={label} title={label}");
  });

  it("die Auszahlung bleibt über das Geldfenster erreichbar", () => {
    expect(LEDGER).not.toContain("function Payout");
    expect(LEDGER.slice(LEDGER.indexOf("<LedgerRow "), LEDGER.indexOf("</LedgerRow>")))
      .not.toContain("expectedPayout");
    // Im Fenster unverändert da, aus derselben Quelle wie zuvor.
    expect(DETAILS).toContain("copy.summary.expected");
    expect(DETAILS).toContain("loaded?.expected_payout");
    expect(de.business.sales.columns.payout).toBe("Auszahlung");
    // Und der Weg dorthin steht in der aufgeklappten Zeile.
    const expansion = LEDGER.slice(LEDGER.indexOf("<LedgerExpansion"),
                                   LEDGER.indexOf("</LedgerExpansion>"));
    expect(expansion).toContain("onDetails(sale.id)");
  });

  it("die Geldspalten sind eng, EU ist sehr schmal, Käufer wächst mit", () => {
    const tracks = /const SALE_COLUMNS =\s*\n?\s*"([^;]*)";/.exec(LEDGER)![1]
      .replace(/"\s*\+\s*"/g, "")
      .replace(/minmax\(([^)]*)\)/g, (m) => m.replace(/,\s*/g, ","))
      .trim().split(/\s+/);
    expect(tracks).toHaveLength(10);
    const rem = (t: string) => Number(/([\d.]+)rem/.exec(t)![1]);
    // EU ist die schmalste Spur von allen.
    expect(rem(tracks[1])).toBeLessThan(2.5);
    expect(Math.min(...tracks.map(rem))).toBe(rem(tracks[1]));
    // Keine Geldspur wächst mehr mit; sie waren alle `minmax(5rem, 1fr)`.
    for (const i of [3, 4, 5, 6, 7, 8]) {
      expect(tracks[i], `Spur ${i}`).toMatch(/^[\d.]+rem$/);
      expect(rem(tracks[i]), `Spur ${i}`).toBeLessThanOrEqual(5);
    }
    // Und genau eine Spur ist flexibel: die letzte, der Käufer.
    expect(tracks.filter((t) => t.includes("1fr"))).toHaveLength(1);
    expect(tracks[9]).toContain("1fr");
    // Die Tabelle ist dadurch schmaler geworden, nicht breiter.
    const floor = Number(/const SALE_MIN_WIDTH = "([\d.]+)rem"/.exec(LEDGER)![1]);
    expect(floor).toBeLessThan(71);
    expect(floor).toBeGreaterThan(26);   // breiter als jedes Telefon: es scrollt
  });

  it("und die aufgeklappte Positionsliste bleibt ausgerichtet", () => {
    /*
     * Sie hängt an `--ob-item-columns` und an der Obergrenze von `.ob-item`,
     * nicht an der Spurenliste der Zeile — die Verdichtung der Zeile kann
     * sie deshalb nicht verschieben.
     */
    expect(LEDGER).toContain("itemColumns={SALE_ITEM_COLUMNS}");
    expect(LEDGER).not.toMatch(/const (SALE_)?ITEM_COLUMNS\s*=/);
    const css = read("src/app/globals.css");
    expect(css).toContain("--ob-item-max");
  });
});

// ---------------------------------------------------------------------------
// Keine Migration, keine Änderung an 0108–0110
// ---------------------------------------------------------------------------

describe("der ganze Umbau kommt ohne Migration aus", () => {
  it("es gibt keine 0111", () => {
    expect(() => migrationSource("0111_orderbook_ux.sql")).toThrow();
  });

  it("0108, 0109 und 0110 sind unverändert", () => {
    /*
     * Die drei liegen auf Staging UND Production. Ihre Prüfsummen stehen
     * hier, weil eine Datei, die bereits angewendet wurde, nicht mehr
     * bearbeitet werden darf — eine Änderung wäre in keiner Datenbank
     * angekommen und die Migrationsgeschichte wäre eine Fiktion.
     */
    for (const [file, bytes] of [
      ["0108_loose_only_inventory.sql", 13604],
      ["0109_external_hold_schema.sql", 21267],
      ["0110_external_hold_runtime.sql", 55450],
    ] as const) {
      expect(Buffer.byteLength(raw(`supabase/migrations/${file}`), "utf8"), file).toBe(bytes);
    }
  });
});
