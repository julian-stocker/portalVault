import { describe, expect, it } from "vitest";

import { code, latestFunction, migrationFiles, migrationSource } from "@/test-support/migrations";
import {
  EXTRA_ENDINGS, ITEM_STATES, bookingProgress, canBook, canSettle, canShowcase,
  creditsNoValue, valuePurchase, type ItemState, type ValuedItem,
} from "./purchase";

/**
 * `0116` — DER EINKAUFSFAKTOR, DIE VITRINE UND DIE INVENTARINTEGRITÄT.
 *
 * Die Arithmetik wird AUSGEFÜHRT; die SQL-Zusicherungen werden am
 * Migrationstext gelesen. Und eine Zusicherung wird gegen BEIDE Seiten
 * geprüft: dass TypeScript und SQL dieselbe Regel über den anrechenbaren
 * Wert haben. Zwei Listen wären zwei Antworten darüber, was ein Paket noch
 * wert ist, und dann stimmt der Bildschirm nicht mit der Bilanz.
 */

const FILE = "0116_purchase_factor_showcase_and_ledger.sql";
const raw = migrationSource(FILE);
const exec = code(raw);

const item = (state: ItemState, marketPrice: number | null): ValuedItem => ({ state, marketPrice });

describe("0116 ersetzt Funktionen und fasst kein Schema an", () => {
  it("ist die neueste Migration und steht allein auf ihrer Nummer", () => {
    expect(migrationFiles).toContain(FILE);
    expect(migrationFiles.filter((f) => f.startsWith("0116"))).toEqual([FILE]);
  });

  it("kein DDL und keine Zeile geschrieben", () => {
    for (const forbidden of [/create table/i, /alter table/i, /create\s+(unique\s+)?index/i,
                             /create trigger/i, /add constraint/i, /drop constraint/i,
                             /insert into/i, /delete from/i, /truncate/i]) {
      expect(exec, String(forbidden)).not.toMatch(forbidden);
    }
  });

  it("…und kein DML auf OBERSTER Ebene", () => {
    /*
     * `update public.purchases` kommt vor — INNERHALB der Funktionsrümpfe,
     * und dort gehört es hin: der Platztausch und das Anlegen schreiben
     * Spalten. Was diese Migration nicht tun darf, ist beim ANWENDEN Zeilen
     * zu ändern. Alles im Rumpf ist eingerückt, eine Anweisung der Migration
     * selbst beginnt in Spalte 1 — darauf prüft diese Zeile, und die vorige
     * Fassung tat es mit `^\s*` und traf damit beides.
     */
    const topLevel = exec.split("\n").filter((l) => /^[a-z]/.test(l));
    expect(topLevel.filter((l) => /^(update|insert|delete|truncate)\b/i.test(l))).toEqual([]);
    /* Was auf oberster Ebene stehen darf: nur diese Wörter. */
    const words = [...new Set(topLevel.map((l) => l.split(/\s+/)[0].toLowerCase()))].sort();
    expect(words.filter((w) => !["as", "begin", "comment", "create", "declare", "do",
                                 "drop", "end;", "grant", "language", "returns", "revoke",
                                 "security", "set", "stable", "volatile"].includes(w)))
      .toEqual([]);
  });

  it("ersetzt genau die neun geplanten Funktionen", () => {
    expect([...exec.matchAll(/create or replace function public\.(\w+)/g)].map((m) => m[1]))
      .toEqual(["purchase_market_value", "orderbook_global_factor",
                "seller_set_purchase_item_state", "seller_book_purchase_item",
                "seller_swap_purchase_daily_index", "seller_create_purchase_with_items",
                "seller_update_purchase", "seller_purchase", "seller_orderbook_ledger"]);
  });

  /*
   * ZWEI SIGNATUREN WERDEN GEDROPPT, UND DAS MUSS SO SEIN.
   *
   * Ein `create or replace` mit zusätzlichen Parametern erzeugt in PostgreSQL
   * eine zweite OVERLOAD — die Identität einer Funktion umfasst ihre
   * Argumenttypen. Zwei Fassungen, die sich nur in nachgestellten
   * Standardwerten unterscheiden, machen jeden Aufruf mehrdeutig.
   */
  it("droppt die alten Signaturen, statt eine zweite Overload zu erzeugen", () => {
    expect(exec).toContain(
      "drop function if exists public.seller_create_purchase_with_items(date, numeric, text, boolean, jsonb);");
    expect(exec).toContain(
      "drop function if exists public.seller_update_purchase(bigint, date, numeric, text);");
    expect(raw).toContain("zweite OVERLOAD");
    /* Und die Nachbedingung verlangt für jede Funktion genau eine. */
    const after = exec.slice(exec.lastIndexOf("do $$"));
    expect(after).toContain("Overload(s), erwartet 1");
  });
});

// ---------------------------------------------------------------------------
describe("0116 — der anrechenbare Wert (Entscheidung D4)", () => {
  const fn = code(latestFunction("purchase_market_value").body);

  it("beschädigt und fehlend tragen 0 EUR bei", () => {
    expect(fn).toContain("case when i.state in ('damaged', 'missing') then 0");
  });

  it("und bleiben GEZÄHLT — der alte Ausschluss ist weg", () => {
    /*
     * `and i.state <> 'missing'` war die alte Regel. Sie machte den Wert
     * richtig und die Übersicht falsch: aus ihr fiel der GRUND heraus, warum
     * der Faktor gestiegen ist.
     */
    expect(fn).not.toContain("state <> 'missing'");
    expect(fn).toContain("count(*)::integer");
  });

  it("0 EUR gilt als BEKANNT, nicht als Lücke", () => {
    /* Täte es das nicht, stünde jedes Paket mit einer beschädigten Figur für
       immer auf „unvollständig". */
    const known = fn.slice(fn.indexOf("count(*) filter ("));
    expect(known).toContain("i.state in ('damaged', 'missing')");
    expect(known).toContain("or coalesce(i.market_price_snapshot, s.market_price) is not null");
  });

  it("TypeScript und SQL haben DIESELBE Regel", () => {
    /*
     * Die wichtigste Zusicherung dieser Datei. `creditsNoValue` in
     * `purchase.ts` und der `case` in `purchase_market_value` beantworten
     * dieselbe Frage; liefen sie auseinander, zeigte der Bildschirm einen
     * anderen Faktor als die Bilanz.
     */
    const worthless = ITEM_STATES.filter((s) => creditsNoValue(s));
    expect([...worthless]).toEqual(["damaged", "missing"]);
    for (const state of worthless) {
      expect(fn, state).toContain(`'${state}'`);
    }
    /* Und kein anderer Zustand steht in dem `case`. */
    for (const state of ITEM_STATES.filter((s) => !creditsNoValue(s))) {
      expect(fn.slice(fn.indexOf("case when i.state in ("),
                      fn.indexOf("then 0")), state).not.toContain(`'${state}'`);
    }
  });
});

describe("0116 — der globale Faktor (Entscheidung D5)", () => {
  const fn = code(latestFunction("orderbook_global_factor").body);

  it("schliesst Testeinkäufe aus", () => {
    expect(fn).toContain("where not p.is_test");
  });

  it("und teilt niemals durch null", () => {
    expect(fn).toContain("case when sum(v.known_value) > 0");
  });

  it("niemand darf ihn direkt aufrufen — der Faktor ist ein Betriebsgeheimnis", () => {
    /* 0103 hat das entschieden; 0116 darf es nicht aufweichen. */
    expect(exec).toContain(
      "revoke all on function public.orderbook_global_factor() from public, anon, authenticated;");
    expect(exec).not.toMatch(/grant[^;]*orderbook_global_factor/);
  });
});

// ---------------------------------------------------------------------------
describe("die Arithmetik, ausgeführt", () => {
  it("DAS BEISPIEL: 100 EUR, 5 × 30 EUR, eine beschädigt, eine fehlt → 1,111", () => {
    const v = valuePurchase(100, [
      item("arrived", 30), item("arrived", 30), item("arrived", 30),
      item("damaged", 30), item("missing", 30),
    ]);
    expect(v.knownValue).toBe(90);
    expect(v.factor).toBeCloseTo(1.1111, 4);
    expect(v.countedItems).toBe(5);
    expect(v.worthlessItems).toBe(2);
  });

  it("die Vitrine verschlechtert den Faktor NICHT (D3)", () => {
    const v = valuePurchase(100, [item("arrived", 50), item("showcase", 50)]);
    expect(v.knownValue).toBe(100);
    expect(v.factor).toBe(1);
  });

  it("und `booked` zählt wie `arrived` — der Zustand ändert den Wert nicht", () => {
    const a = valuePurchase(60, [item("arrived", 30), item("arrived", 30)]);
    const b = valuePurchase(60, [item("booked", 30), item("booked", 30)]);
    expect(a.factor).toBe(b.factor);
  });

  it("die KOSTEN bleiben in jedem Zustandswechsel vollständig erhalten", () => {
    /*
     * Die Zusicherung aus Punkt 8, als Rechnung: dieselben 100 EUR, fünf
     * Verteilungen. Der Faktor ändert sich, das Produkt Faktor × Wert ist
     * immer wieder die Ausgabe.
     */
    for (const states of [
      ["arrived", "arrived"], ["booked", "showcase"], ["arrived", "damaged"],
      ["showcase", "showcase"], ["booked", "missing"],
    ] as const) {
      const v = valuePurchase(100, states.map((s) => item(s, 50)));
      if (v.factor === null) { expect(v.knownValue).toBe(0); continue; }
      expect(v.factor * v.knownValue, states.join("+")).toBeCloseTo(100, 6);
    }
  });

  it("ein Paket ohne jeden verwertbaren Wert ergibt NULL statt Unendlich", () => {
    const v = valuePurchase(100, [item("damaged", 40), item("missing", 60)]);
    expect(v.factor).toBeNull();
    expect(v.percent).toBeNull();
  });

  it("unbekannt ist nicht null — das bleibt unterschieden", () => {
    const v = valuePurchase(100, [item("arrived", 50), item("arrived", null)]);
    expect(v.knownValue).toBe(50);
    expect(v.unknownItems).toBe(1);
    expect(v.worthlessItems).toBe(0);
    expect(v.complete).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("die Vitrine (Entscheidung D1)", () => {
  it("ist ein Zustand und trägt niemals eine Lagerbewegung", () => {
    /* Ohne Lagerzeile gibt es kein Listing-Flag, das sie verkaufbar machen
       könnte. Das ist die Zusicherung, strukturell statt zugesagt. */
    const after = exec.slice(exec.lastIndexOf("do $$"));
    expect(after).toContain("state in ('damaged', 'missing', 'showcase', 'settled')");
    expect(after).toContain("movement_id is not null");
    expect(after).toContain("Sonderzustand UND Lagerbewegung");
  });

  it("nur eine Katalogfigur geht hinein", () => {
    const fn = code(latestFunction("seller_set_purchase_item_state").body);
    expect(fn).toContain("if p_state = 'showcase' and v_sky is null then");
    expect(canShowcase({ state: "arrived", skyId: "SKY-0001" })).toBe(true);
    expect(canShowcase({ state: "arrived", skyId: null })).toBe(false);
  });

  it("und aus ihr HERAUS führt genau ein Weg: einbuchen", () => {
    /* Eine Sackgasse ohne Ausgang wäre genau das, was D1 ausschliesst. */
    expect(canBook({ state: "showcase", skyId: "SKY-0001" })).toBe(true);
    const fn = code(latestFunction("seller_book_purchase_item").body);
    /* Die Funktion lehnt showcase NICHT ab — anders als damaged und missing. */
    expect(fn).toContain("v_item.state = 'damaged'");
    expect(fn).toContain("v_item.state = 'missing'");
    expect(fn).not.toMatch(/v_item\.state = 'showcase'[\s\S]{0,120}raise exception/);
    /* Und der Grund steht daneben, damit Schweigen nicht als Zufall gilt. */
    expect(raw).toContain("AUS DER VITRINE DARF EINGEBUCHT WERDEN");
  });

  it("beschädigt wird NIEMALS verkaufbar (D4)", () => {
    expect(canBook({ state: "damaged", skyId: "SKY-0001" })).toBe(false);
    expect(canBook({ state: "missing", skyId: "SKY-0001" })).toBe(false);
    const fn = code(latestFunction("seller_book_purchase_item").body);
    expect(fn).toContain("a damaged item does not enter sellable stock");
    /* Der Weg zurück ist bewusst ein Umweg: erst `arrived`, dann einbuchen. */
    expect(fn).toContain("set it to arrived first if it is in fact fine");
  });

  it("…AUCH NICHT ÜBER DIE VITRINE, und das ist der zweite Riegel (D4)", () => {
    /*
     * DER WEG, DER ZUERST OFFEN STAND:
     *
     *     damaged  ->  showcase  ->  booked
     *
     * Beide Schritte waren erlaubt — der erste, weil eine falsch
     * klassifizierte Figur korrigierbar sein muss, der zweite, weil D1 die
     * Überführung aus der Vitrine ausdrücklich verlangt. Zusammen ergaben
     * sie genau das, was D4 verbietet: eine als beschädigt verzeichnete
     * Figur im Verkaufsbestand, in zwei Klicks.
     *
     * Geschlossen wird er an der ersten Kante, in SQL und in TypeScript.
     * Der eine nachvollziehbare Weg zurück bleibt `arrived`.
     */
    const fn = code(latestFunction("seller_set_purchase_item_state").body);
    expect(fn).toContain("if p_state = 'showcase' and v_current in ('damaged', 'missing') then");
    expect(fn).toContain("a damaged unit does not move into the showcase");
    expect(canShowcase({ state: "damaged", skyId: "SKY-0001" })).toBe(false);
    expect(canShowcase({ state: "missing", skyId: "SKY-0001" })).toBe(false);
    /* Und die Korrektur selbst ist nicht verboten, nur sichtbar. */
    expect(fn).not.toMatch(/p_state = 'arrived'[\s\S]{0,120}raise exception/);
  });

  it("`booked` bleibt kein Menüpunkt — Bestand entsteht durch Buchen", () => {
    const fn = code(latestFunction("seller_set_purchase_item_state").body);
    expect(fn).toContain("p_state not in ('ordered', 'arrived', 'damaged', 'missing', 'settled', 'showcase')");
    expect(fn).toContain("this item is in inventory; reverse the booking first");
    expect([...EXTRA_ENDINGS]).toEqual(["damaged", "missing", "showcase"]);
    expect(EXTRA_ENDINGS).not.toContain("booked");
  });

  it("und eine Arbeitsmappenzeile ändert ihren Zustand gar nicht", () => {
    const fn = code(latestFunction("seller_set_purchase_item_state").body);
    expect(fn).toContain("v_current = 'reconciled_legacy'");
    expect(canBook({ state: "reconciled_legacy", skyId: "SKY-0001" })).toBe(false);
    expect(canShowcase({ state: "reconciled_legacy", skyId: "SKY-0001" })).toBe(false);
    expect(canSettle({ state: "reconciled_legacy", skyId: null })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("offen wird gezählt, nicht gerechnet", () => {
  const fn = code(latestFunction("seller_orderbook_ledger").body);

  it("der alte Rest-Ausdruck ist weg", () => {
    expect(fn).not.toContain("m.total_items - m.booked_items - m.settled_items");
    expect(fn).toContain("d.state in ('ordered', 'arrived')");
    expect(fn).toContain("as open_items");
  });

  it("und `is_open` fragt dasselbe", () => {
    const isOpen = fn.slice(fn.indexOf("as is_open") - 400, fn.indexOf("as is_open"));
    expect(isOpen).toContain("i.state in ('ordered', 'arrived')");
  });

  it("die Ableitung in TypeScript stimmt damit überein", () => {
    /*
     * `bookingProgress` zählte vorher nur `booked` und `reconciled_legacy`
     * als erledigt — eine beschädigte Position galt als offen. Fünf
     * Zustände sind Enden, und beide Seiten wissen das jetzt.
     */
    const p = bookingProgress([
      { state: "ordered" }, { state: "arrived" }, { state: "booked" },
      { state: "damaged" }, { state: "missing" }, { state: "showcase" },
      { state: "settled" }, { state: "reconciled_legacy" },
    ]);
    expect(p.open).toBe(2);
    expect(p.booked).toBe(1);
    expect(p.total).toBe(8);
  });

  it("die drei Enden sind als Zahl sichtbar — sonst erklärt kein Paket seinen Faktor", () => {
    for (const k of ["damaged_items", "missing_items", "showcase_items"]) {
      expect(fn, k).toContain(k);
    }
    for (const k of ["'damaged_count'", "'missing_count'", "'showcase_count'"]) {
      expect(fn, k).toContain(k);
    }
  });

  it("und der Tagesplatz ordnet, höchster oben", () => {
    expect(fn).toContain("m.daily_index desc nulls last");
    expect(fn).toContain("'daily_index', m.daily_index");
  });

  it("Filter, Suche, Faktor und Summen bleiben, wie 0070 sie hatte", () => {
    const old = code((() => {
      const sql = migrationSource("0070_ledger_settled_count.sql");
      const at = sql.indexOf("create or replace function public.seller_orderbook_ledger(");
      return sql.slice(at, sql.indexOf("\n$$;", at));
    })());
    const between = (src: string, from: string, to: string) =>
      src.slice(src.indexOf(from), src.indexOf(to)).replace(/\s+/g, " ").trim();
    for (const [from, to] of [
      ["searched as (", "matched as ("],
      ["counts as (", "select page.page_rows"],
      ["as factor,", "as is_incomplete"],
    ] as const) {
      expect(between(fn, from, to), from).toBe(between(old, from, to));
    }
  });
});

// ---------------------------------------------------------------------------
describe("der Platztausch für Einkäufe", () => {
  const fn = code(latestFunction("seller_swap_purchase_daily_index").body);

  it("ist gesperrt, definer, mit gesetztem search_path", () => {
    expect(fn).toContain("security definer");
    expect(fn).toMatch(/set search_path = ''/);
    expect(fn.indexOf("can_operate_active_seller"))
      .toBeLessThan(fn.indexOf("from public.purchases"));
  });

  it("nur `authenticated` darf ihn rufen", () => {
    expect(exec).toMatch(
      /revoke all on function public\.seller_swap_purchase_daily_index\(bigint, integer\) from public, anon;/);
    expect(exec).toMatch(
      /grant execute on function public\.seller_swap_purchase_daily_index\(bigint, integer\)\s+to authenticated;/);
  });

  it("die Tagessperre liegt vor dem ersten `for update`", () => {
    const lock = fn.indexOf("pg_advisory_xact_lock");
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(fn.indexOf("for update"));
  });

  it("tauscht in drei Anweisungen, mit negativem Parkplatz", () => {
    const swap = fn.slice(fn.indexOf("v_from := v_a.daily_index;"));
    expect([...swap.matchAll(/set daily_index = ([^\s,]+)/g)].map((m) => m[1]))
      .toEqual(["-p_with_index", "v_from", "p_with_index"]);
  });

  it("weist ab, was es abweisen muss", () => {
    for (const refusal of ["a place in a day starts at one", "no such purchase",
                           "a purchase without a date has no place to swap",
                           "no purchase holds that place in the day",
                           "changed its date concurrently"]) {
      expect(fn, refusal).toContain(refusal);
    }
  });

  it("schon dort ist kein Fehler und kein Schreibvorgang", () => {
    const already = fn.slice(fn.indexOf("if v_a.daily_index = p_with_index then"));
    const branch = already.slice(0, already.indexOf("end if"));
    expect(branch).toContain("'moved', false");
    expect(branch).not.toContain("update");
  });
});

// ---------------------------------------------------------------------------
describe("die Kostenfelder im Anlegen und Bearbeiten", () => {
  it("beide Funktionen nehmen die neuen Felder", () => {
    const crt = code(latestFunction("seller_create_purchase_with_items").body);
    const upd = code(latestFunction("seller_update_purchase").body);
    for (const p of ["p_platform", "p_seller_name", "p_items_cost", "p_shipping_cost",
                     "p_buyer_protection_cost", "p_payment_method", "p_external_ref"]) {
      expect(crt, `create: ${p}`).toContain(p);
      expect(upd, `update: ${p}`).toContain(p);
    }
  });

  it("`seller_create_purchase` bleibt unangetastet — der Importeur braucht es", () => {
    expect([...exec.matchAll(/create or replace function public\.seller_create_purchase\(/g)])
      .toHaveLength(0);
    const crt = code(latestFunction("seller_create_purchase_with_items").body);
    expect(crt).toContain("public.seller_create_purchase(p_purchased_at, p_total_cost, p_note, p_is_test)");
  });

  it("eine Aufteilung lässt sich auch ENTFERNEN", () => {
    /* NULL heisst „unverändert" — das kann „weg" nicht ausdrücken. */
    const upd = code(latestFunction("seller_update_purchase").body);
    expect(upd).toContain("p_clear_cost_split");
    expect(upd).toContain("case when p_clear_cost_split then null");
  });

  it("und ein Versand ohne Artikelpreis wird mit einem Satz abgelehnt, nicht mit einem CHECK", () => {
    const upd = code(latestFunction("seller_update_purchase").body);
    expect(upd).toContain("a cost split needs the price of the figures");
  });
});
