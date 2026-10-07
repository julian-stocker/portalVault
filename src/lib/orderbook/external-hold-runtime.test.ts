import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { code, latestFunction, migrationFiles, migrationSource } from "@/test-support/migrations";
import { saleItemHold, type SaleItemHoldFacts } from "./sales-view";
import { de } from "../i18n/de";

/**
 * `0110` — EXTERNAL HOLDS, ZUR LAUFZEIT.
 *
 * WAS EIN TEXTTEST BEWEISEN KANN UND WAS NICHT.
 *
 * Nicht beweisbar ist hier, dass PostgreSQL sich so verhält: dass zwei
 * gleichzeitige Hold-Versuche auf das letzte Stück sich serialisieren, dass
 * ein zweites Release nichts senkt, dass `drift` nach jedem Schritt 0 ist.
 * Das zeigen die Staging-Proben, in einer Transaktion mit `rollback`, und
 * danach `verify:commerce` und `verify:rls`.
 *
 * Beweisbar ist, dass die Datei die Regeln SAGT, auf die sich jene Proben
 * verlassen — und zwar an der Stelle und in der Reihenfolge, auf die es
 * ankommt. Genau dort lag der Fehler, den 0025 beschreibt: „Release the hold
 * before booking, or the guard below trips on it." Eine vertauschte
 * Reihenfolge ist auf Staging ein roter Test und hier eine Zeile, die man
 * liest.
 *
 * Die eine echte Logik in diesem Schritt — die Ableitung `saleItemHold` —
 * wird dagegen ausgeführt und nicht gelesen.
 */

const FILE = "0110_external_hold_runtime.sql";
const raw = migrationSource(FILE);
const exec = code(raw);

/** Die fünf internen und öffentlichen Neuzugänge. */
const NEW_FUNCTIONS = [
  "hold_sale_item", "release_sale_item_hold", "convert_sale_item_hold",
  "seller_hold_sale_item", "seller_release_sale_item_hold",
] as const;

/** Die neun ersetzten, mit der Migration, aus der ihr Rumpf stammt. */
const REPLACED: Record<string, string> = {
  seller_add_sale_item: "0059_orderbook_sales.sql",
  seller_create_sale_with_details: "0065_sale_create_with_details.sql",
  seller_book_sale_item: "0073_sales_settle_and_cancel_rules.sql",
  seller_unbook_sale_item: "0059_orderbook_sales.sql",
  seller_settle_sale_item: "0073_sales_settle_and_cancel_rules.sql",
  seller_set_sale_item_not_shipped: "0074_sale_items_not_shipped_and_return_announced.sql",
  seller_remove_sale_item: "0065_sale_create_with_details.sql",
  seller_delete_sale: "0059_orderbook_sales.sql",
  seller_sale: "0096_order_line_status_and_costs.sql",
};

/** Der Rumpf einer Funktion, wie `0110` sie schreibt, ohne Kommentare. */
function body(name: string): string {
  const at = raw.indexOf(`create or replace function public.${name}(`);
  expect(at, `${name} fehlt in 0110`).toBeGreaterThan(-1);
  const open = raw.indexOf("as $$", at);
  return code(raw.slice(open, raw.indexOf("$$;", open)));
}

/** Parameterliste plus Eigenschaften, Weißraum normalisiert. */
function header(file: string, name: string): string {
  const sql = migrationSource(file);
  const at = sql.indexOf(`create or replace function public.${name}(`);
  return sql.slice(at, sql.indexOf("as $$", at)).replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// 1. Die Datei, und was sie nicht ist
// ---------------------------------------------------------------------------

describe("0110 ist die Hold-Laufzeit und sonst nichts", () => {
  it("liegt direkt hinter 0109 und bleibt dort", () => {
    /*
     * Die Reihenfolge ist dauerhaft, die höchste Nummer ist es nicht: `0111`
     * ist gebaut und trägt den Stripe-Erstattungsvertrag. Was hier zählt, ist
     * dass die Hold-Laufzeit direkt auf ihr Schema folgt.
     */
    const at = migrationFiles.indexOf(FILE);
    expect(at).toBeGreaterThan(-1);
    expect(migrationFiles[at - 1]).toBe("0109_external_hold_schema.sql");
  });

  it("und 0104 bis 0109 sind unverändert", () => {
    const frozen: Record<string, string> = {
      "0104_business_backup_export.sql":
        "2f9184f34bcab010d514b47b67c5884073539437064c67fb016c50f898714edf",
      "0105_platform_export.sql":
        "e1fbd1e35253c1900d3aa166a8026644f6bcf7dea4ba4c2b9af37fcd746c9e68",
      "0106_platform_export_history.sql":
        "242867f59efbcdb0a7031c11f51da6406fffc17b652832e985718eed1e0f5118",
      "0107_platform_auth_inventory.sql":
        "0352b4e352d2f14e4a7c1e2a23ea2acef3e44ae945a874806a8a805e26f3e0b2",
      "0108_loose_only_inventory.sql":
        "aaef73e21d4c57f21959eca494c55bfba6d5909cc1df2a847a087ddc4b5d1f1c",
      "0109_external_hold_schema.sql":
        "dd9c6106852c30cff9e08f3f4d364771c678867cb9fe000d6dc3a5a277839ef3",
    };
    for (const [file, sha] of Object.entries(frozen)) {
      expect(createHash("sha256").update(migrationSource(file)).digest("hex"), file).toBe(sha);
    }
  });

  it("enthält nichts aus einer anderen Domäne", () => {
    for (const forbidden of [
      "seller_set_sale_status", "p_status", "p_expected_updated_at",
      "system_platform_export", "system_business_backup",
      /*
       * 0111: der Stripe-Erstattungsvertrag. `order_refunds` steht hier
       * ABSICHTLICH NICHT auf der Liste — `seller_sale()` projiziert die
       * Erstattungen einer internen Bestellung seit 0059 und tut es
       * unverändert weiter. Was 0110 nicht kennt, ist der Provider-Zustand
       * und jede Funktion, die ihn setzt.
       */
      "provider_status", "submit_order_refund",
      "attach_order_refund", "record_refund_event",
    ]) {
      expect(exec, forbidden).not.toContain(forbidden);
    }
  });

  it("bewegt keine Zeile und ändert kein Schema", () => {
    /*
     * AUF TOP-LEVEL-EBENE, und das ist der Unterschied. `seller_add_sale_item`
     * enthält `insert into public.sale_items` — seit 0059, weil genau das
     * ihre Arbeit ist. Was eine Migration nicht tun darf, ist selbst Daten zu
     * schreiben, und das steht in einer Anweisung ohne Einrückung.
     */
    const top = exec.split("\n").filter((l) => l.length > 0 && !/^\s/.test(l));
    for (const forbidden of [/^alter table/i, /^create table/i, /^drop /i, /^truncate/i,
                             /^insert /i, /^update /i, /^delete /i,
                             /^create policy/i, /^alter .*row level security/i]) {
      expect(top.filter((l) => forbidden.test(l)), String(forbidden)).toEqual([]);
    }
    // Und der Vollständigkeit halber: nirgends ein Schema-Eingriff.
    expect(exec).not.toMatch(/\balter table\b/i);
    expect(exec).not.toMatch(/\bcreate table\b/i);
    expect(exec).not.toMatch(/\btruncate\b/i);
  });

  it("und fasst den Checkout nicht an", () => {
    /*
     * Die drei Checkout-Funktionen aus 0010/0025 werden nicht ersetzt. Sie
     * dürfen in Kommentaren vorkommen — der Kopf erklärt gerade, warum der
     * Hold dieselbe Buchhaltung benutzt —, aber nicht im ausführbaren Teil.
     */
    for (const fn of ["reserve_for_order", "release_order_reservations",
                      "convert_order_reservations", "release_expired_reservations"]) {
      expect(exec, fn).not.toContain(`create or replace function public.${fn}`);
      expect(exec, fn).not.toContain(`public.${fn}(`);
    }
    expect(raw).toContain("reserve_for_order");          // in der Prosa, als Begründung
  });

  it("die Statementbilanz ist genau die geplante", () => {
    const top = exec.split("\n").filter((l) =>
      /^(do|alter|create|comment|revoke|grant|drop|insert|update|delete)\b/i.test(l));
    expect(top.filter((l) => l.startsWith("do $$"))).toHaveLength(2);
    expect(top.filter((l) => l.startsWith("create or replace function"))).toHaveLength(14);
    expect(top.filter((l) => l.startsWith("revoke all on function"))).toHaveLength(5);
    expect(top.filter((l) => l.startsWith("grant execute on function"))).toHaveLength(2);
    expect(top).toHaveLength(23);
  });
});

// ---------------------------------------------------------------------------
// 2. Keine neue Overload, keine geänderte Signatur
// ---------------------------------------------------------------------------

describe("die neun ersetzten Funktionen behalten ihren Vertrag", () => {
  for (const [name, origin] of Object.entries(REPLACED)) {
    it(`${name} — Kopf byte-identisch mit ${origin.slice(0, 4)}`, () => {
      expect(header(FILE, name)).toBe(header(origin, name));
    });
  }

  it("und 0110 ist für jede die geltende Fassung", () => {
    for (const name of Object.keys(REPLACED)) {
      expect(latestFunction(name).file, name).toBe(FILE);
    }
  });

  it("die fünf neuen tragen je genau eine Signatur mit einem bigint", () => {
    for (const name of NEW_FUNCTIONS) {
      expect((exec.match(new RegExp(`create or replace function public\\.${name}\\(`, "g")) ?? []),
             name).toHaveLength(1);
      expect(header(FILE, name), name).toContain("(p_item_id bigint)");
    }
  });

  it("und die Nachprüfung verlangt für jede genau eine Overload", () => {
    const after = exec.slice(exec.lastIndexOf("do $$"));
    for (const name of [...NEW_FUNCTIONS, ...Object.keys(REPLACED)]) {
      expect(after, name).toContain(`'${name}'`);
    }
    expect(after).toContain("Overload(s), erwartet 1");
    expect(after).toContain("0110 erzeugt keine");
  });
});

// ---------------------------------------------------------------------------
// 3. Halten: der Wächter IST die WHERE-Klausel
// ---------------------------------------------------------------------------

describe("hold_sale_item erfindet keinen Bestand", () => {
  const hold = body("hold_sale_item");

  it("erhöht reserved nur unter der geführten Bedingung", () => {
    expect(hold).toMatch(
      /update public\.shop_inventory\s*\n\s*set reserved = reserved \+ 1\s*\n\s*where id = v_inventory_id\s*\n\s*and quantity - reserved >= 1;/,
    );
    // Dieselbe Zeile, mit der reserve_for_order seit 0010 für den Shop hält.
    expect(code(latestFunction("reserve_for_order").body))
      .toContain("and quantity - reserved >= v_row.quantity");
  });

  it("und legt den Hold erst an, nachdem reserved stand", () => {
    expect(hold.indexOf("insert into public.order_reservations"))
      .toBeGreaterThan(hold.indexOf("set reserved = reserved + 1"));
    // Greift der Wächter nicht, entsteht nichts.
    const between = hold.slice(hold.indexOf("set reserved = reserved + 1"),
                               hold.indexOf("insert into public.order_reservations"));
    expect(between).toContain("if not found then");
    expect(between).toContain("return 'no_stock';");
  });

  it("sperrt die Lagerzeile, BEVOR es entscheidet", () => {
    const at = hold.indexOf("from public.shop_inventory i");
    expect(at).toBeGreaterThan(-1);
    expect(hold.slice(at, hold.indexOf(";", at))).toContain("for update");
    expect(at).toBeLessThan(hold.indexOf("set reserved = reserved + 1"));
  });

  it("hält nie etwas anderes als die operative Position", () => {
    // LOOSE ONLY, gefragt und nicht behauptet.
    expect(hold).toContain("if v_item.condition is distinct from public.v1_sale_condition() then");
    expect(hold).toContain("return 'not_loose';");
    expect(hold).toContain("and i.condition = public.v1_sale_condition()");
    expect(hold).not.toContain("boxed");
  });

  it("schreibt kein expires_at und keine Menge außer eins", () => {
    expect(hold).toContain("values (p_item_id, v_inventory_id, 1, null)");
    expect(hold).not.toContain("reservation_ttl");
  });

  it("verlässt sich nicht allein auf den Unique-Index", () => {
    // Ein zweiter Hold wäre `23505`; hier wird daraus eine Antwort.
    expect(hold).toContain("and r.state = 'active'");
    expect(hold).toContain("return 'already_held';");
  });

  it("schreibt niemals quantity und niemals eine Bewegung", () => {
    expect(hold).not.toMatch(/set quantity/);
    expect(hold).not.toContain("record_inventory_movement");
    expect(hold).not.toContain("apply_inventory_movement");
    expect(hold).not.toContain("inventory_movements");
  });

  it("gibt Gründe zurück statt zu werfen — bis auf den einen Programmfehler", () => {
    const raises = [...hold.matchAll(/raise exception/g)];
    expect(raises).toHaveLength(1);
    expect(hold).toContain("raise exception 'no such sale item' using errcode = 'no_data_found'");
  });

  it("und die Gründe sind genau das vereinbarte Vokabular", () => {
    const returned = [...hold.matchAll(/return '([a-z_]+)';/g)].map((m) => m[1]).sort();
    expect(returned).toEqual([
      "already_booked", "already_held", "cancelled", "held", "historical",
      "internal_sale", "no_inventory", "no_stock", "not_a_figure", "not_loose",
      "not_shipped", "return_already_restocked", "return_announced", "returned",
      "settled",
    ]);
  });

  it("in fester Rangfolge, damit dieselbe Lage denselben Grund nennt", () => {
    const order = [...hold.matchAll(/return '([a-z_]+)';/g)].map((m) => m[1]);
    expect(order.slice(0, 8)).toEqual([
      "not_a_figure", "not_loose", "return_already_restocked", "returned",
      "return_announced", "already_booked", "settled", "not_shipped",
    ]);
  });
});

// ---------------------------------------------------------------------------
// 4. Freigeben und verbrauchen
// ---------------------------------------------------------------------------

describe("release_sale_item_hold gibt genau einmal frei", () => {
  const release = body("release_sale_item_hold");

  it("holt den Anspruch über den Zustand, nicht über ein Flag", () => {
    expect(release).toMatch(
      /update public\.order_reservations\s*\n\s*set state = 'released', released_at = now\(\)\s*\n\s*where id = v_hold_id\s*\n\s*and state = 'active';/,
    );
    // Wer den UPDATE verliert, senkt nichts.
    const after = release.slice(release.indexOf("set state = 'released'"));
    expect(after.slice(0, after.indexOf("update public.shop_inventory")))
      .toContain("return 'no_hold';");
  });

  it("senkt reserved geführt und wird laut, wenn es nicht reicht", () => {
    expect(release).toContain("and reserved >= v_quantity");
    expect(release).toContain("using errcode = 'data_corrupted'");
    expect(release).not.toContain("greatest(");   // kein Klemmen auf Null
  });

  it("idempotent, und ohne jede Bewegung", () => {
    expect((release.match(/return 'no_hold';/g) ?? []).length).toBe(2);
    expect(release).toContain("return 'released';");
    expect(release).not.toContain("record_inventory_movement");
    expect(release).not.toMatch(/set quantity/);
  });
});

describe("convert_sale_item_hold ist die dritte und letzte reserved-Stelle", () => {
  const convert = body("convert_sale_item_hold");

  it("Anspruch zuerst, dann Bestand", () => {
    expect(convert.indexOf("set state = 'converted'"))
      .toBeLessThan(convert.indexOf("set reserved = reserved - v_quantity"));
    expect(convert).toContain("and state = 'active'");
    expect(convert).toContain("using errcode = 'serialization_failure'");
  });

  it("schreibt KEINE movement_id — die Bewegung existiert noch nicht", () => {
    expect(convert).not.toContain("movement_id");
    expect(convert).not.toContain("record_inventory_movement");
  });

  it("und NULL ist kein Fehler", () => {
    expect(convert).toContain("if v_hold_id is null then");
    expect(convert).toContain("return null;");
  });

  it("nur drei Funktionen fassen reserved für externe Holds an", () => {
    /*
     * Halten, freigeben, verbrauchen — und das spiegelt die drei, die der
     * Checkout seit 0010 hat. Jede weitere Stelle wäre eine zweite
     * Bestandswahrheit.
     */
    const touching = [...NEW_FUNCTIONS, ...Object.keys(REPLACED)]
      .filter((name) => /set reserved = reserved/.test(body(name)));
    expect(touching.sort()).toEqual(
      ["convert_sale_item_hold", "hold_sale_item", "release_sale_item_hold"]);
  });
});

// ---------------------------------------------------------------------------
// 5. Ausbuchen verbraucht den Hold, in der einen richtigen Reihenfolge
// ---------------------------------------------------------------------------

describe("seller_book_sale_item", () => {
  const book = body("seller_book_sale_item");

  it("löst den Hold VOR der Buchung", () => {
    /*
     * Die Regel aus 0025, als Reihenfolge im Rumpf: „Release the hold before
     * booking, or the guard below trips on it." Der Wächter in
     * `apply_inventory_movement` ist `quantity + p_delta >= reserved`.
     */
    expect(book.indexOf("public.convert_sale_item_hold(p_item_id)"))
      .toBeLessThan(book.indexOf("public.record_inventory_movement("));
  });

  it("und verknüpft die Bewegung erst DANACH", () => {
    expect(book.indexOf("set movement_id = v_mid where id = v_hold_id"))
      .toBeGreaterThan(book.indexOf("public.record_inventory_movement("));
  });

  it("kennt reserved nicht und soll es nicht kennen", () => {
    // Derselbe Anspruch, den 0073 schon stellte: eine zweite Rechnung hier
    // wäre eine schwächere Kopie einer Regel, die hält.
    expect(book).not.toContain("reserved");
    expect(book).not.toContain("available_quantity");
    expect(book).not.toMatch(/update public\.shop_inventory/);
  });

  it("bleibt idempotent, bevor es den Hold anfasst", () => {
    expect(book).toContain("if v_item.movement_id is not null then return v_item.movement_id; end if;");
    expect(book.indexOf("return v_item.movement_id"))
      .toBeLessThan(book.indexOf("convert_sale_item_hold"));
  });

  it("und bucht eine Position OHNE Hold weiterhin", () => {
    // Das ist die Bedingung dafür, dass eine teilweise reservierte Order
    // verschickt werden kann.
    expect(book).toContain("if v_hold_id is not null then");
    expect(book).toContain("-1, 'sale_external'");
  });

  it("alle Ablehnungen aus 0073 stehen noch", () => {
    for (const refusal of ["historical sales never move stock",
                           "this order was cancelled; nothing left the shelf",
                           "the order already moved this stock",
                           "this position is already closed without a movement",
                           "this item is not a catalog figure and has no stock position",
                           "the workbook records this copy as not taken from stock"]) {
      expect(book, refusal).toContain(refusal);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Rückbuchen: ein NEUER Hold, und zwei neue Sperren
// ---------------------------------------------------------------------------

describe("seller_unbook_sale_item", () => {
  const unbook = body("seller_unbook_sale_item");

  it("gefrorene Historie bewegt niemals Bestand, in keiner Richtung", () => {
    expect(unbook).toContain("if v_sale.source = 'excel_order_2026' and v_sale.stock_released_at is null then");
    expect(unbook).toContain("raise exception 'historical sales never move stock'");
    // Wortgleich mit der Buchungsrichtung, damit die Symmetrie ablesbar ist.
    expect(body("seller_book_sale_item"))
      .toContain("raise exception 'historical sales never move stock'");
    // Und VOR jeder Bewegung.
    expect(unbook.indexOf("historical sales never move stock"))
      .toBeLessThan(unbook.indexOf("public.record_inventory_movement("));
  });

  it("eine angekündigte Retoure blockiert die Rücknahme", () => {
    /*
     * Ohne diese Sperre endete der Weg an
     * `sale_items_return_needs_a_movement` (0074) mit einem nackten 23514.
     * Die Funktion schützt die Invariante selbst.
     */
    expect(unbook).toContain("if v_item.return_announced_at is not null then");
    expect(unbook).toContain("this return is on its way; take the announcement back first");
    expect(unbook.indexOf("return_announced_at is not null"))
      .toBeLessThan(unbook.indexOf("public.record_inventory_movement("));
    expect(migrationSource("0074_sale_items_not_shipped_and_return_announced.sql"))
      .toContain("check (return_announced_at is null or movement_id is not null)");
  });

  it("danach entsteht ein NEUER Hold, kein reaktivierter", () => {
    expect(unbook).toContain("if v_sale.cancelled_at is null then");
    expect(unbook).toContain("perform public.hold_sale_item(p_item_id);");
    // Kein Zustandswechsel zurück auf active, keine genullte movement_id.
    expect(unbook).not.toContain("state = 'active'");
    expect(unbook).not.toMatch(/order_reservations[\s\S]{0,80}movement_id = null/);
  });

  it("und eine stornierte Order hält nichts — über den Zustand, nicht per Parameter", () => {
    expect(header(FILE, "seller_unbook_sale_item")).toContain("(p_item_id bigint)");
    expect(unbook).not.toContain("p_rehold");
  });
});

// ---------------------------------------------------------------------------
// 7. Enden und Löschen geben frei
// ---------------------------------------------------------------------------

describe("jede Endung ohne Bewegung gibt den Hold frei", () => {
  for (const name of ["seller_settle_sale_item", "seller_set_sale_item_not_shipped"]) {
    it(`${name} gibt frei und hält bei der Rücknahme wieder`, () => {
      const fn = body(name);
      expect(fn).toContain("perform public.release_sale_item_hold(p_item_id);");
      expect(fn).toContain("perform public.hold_sale_item(p_item_id);");
      // Die Freigabe steht im Setzen-Zweig, der Neuversuch im Rücknahme-Zweig.
      const takeBack = fn.slice(fn.indexOf("if not p_"), fn.indexOf("return;"));
      expect(takeBack).toContain("hold_sale_item");
      expect(takeBack).not.toContain("release_sale_item_hold");
    });
  }

  it("seller_remove_sale_item gibt frei, BEVOR es löscht", () => {
    const remove = body("seller_remove_sale_item");
    expect(remove.indexOf("release_sale_item_hold"))
      .toBeLessThan(remove.indexOf("delete from public.sale_items"));
    /*
     * Der Grund steht in 0109: `reservations_deny_delete` lässt nur einen
     * EXTERNEN Hold im Zustand `released` ohne Bewegung mit seiner Position
     * verschwinden. Ein aktiver hätte den Cascade scheitern lassen.
     */
    expect(code(latestFunction("reservations_deny_delete").body))
      .toContain("old.state = 'released'");
  });

  it("seller_delete_sale gibt alle frei, aufsteigend nach id", () => {
    const del = body("seller_delete_sale");
    expect(del).toContain("order by i.id");
    expect(del).toContain("perform public.release_sale_item_hold(v_item);");
    expect(del.indexOf("release_sale_item_hold"))
      .toBeLessThan(del.indexOf("delete from public.sales"));
  });
});

// ---------------------------------------------------------------------------
// 8. Sperrordnung und Anlage
// ---------------------------------------------------------------------------

describe("die Sperrordnung ist die aus 0010", () => {
  it("die Anlage sperrt alle Lagerzeilen einmal, aufsteigend", () => {
    const create = body("seller_create_sale_with_details");
    const at = create.indexOf("perform 1");
    expect(at).toBeGreaterThan(-1);
    const lock = create.slice(at, create.indexOf(";", at));
    expect(lock).toContain("from public.shop_inventory i");
    expect(lock).toContain("order by i.id");
    expect(lock).toContain("for update");
    expect(lock).toContain("i.condition = public.v1_sale_condition()");
    // Vor der ersten Position, also vor dem ersten Einzel-Lock.
    expect(at).toBeLessThan(create.indexOf("public.seller_add_sale_item("));
  });

  it("dieselbe Ordnung, die reserve_for_order nimmt", () => {
    expect(code(latestFunction("reserve_for_order").body)).toContain("order by i.id");
  });

  it("eine neue Position versucht sofort zu halten", () => {
    const add = body("seller_add_sale_item");
    expect(add).toContain("perform public.hold_sale_item(v_id);");
    // Nach dem INSERT: die Position muss existieren, bevor sie halten kann.
    expect(add.indexOf("returning id into v_id"))
      .toBeLessThan(add.indexOf("hold_sale_item"));
    // Und die Anlage scheitert nicht an fehlendem Bestand.
    expect(add).toContain("return v_id;");
  });

  it("die Anlage behält ihre fünfzehn Parameter — p_status ist 0111", () => {
    const head = header(FILE, "seller_create_sale_with_details");
    expect((head.match(/p_\w+ /g) ?? []).length).toBe(15);
    expect(head).not.toContain("p_status");
  });
});

// ---------------------------------------------------------------------------
// 9. ACL
// ---------------------------------------------------------------------------

describe("die Rechte", () => {
  it("die drei internen Funktionen halten niemand ein EXECUTE", () => {
    for (const name of ["hold_sale_item", "release_sale_item_hold", "convert_sale_item_hold"]) {
      expect(exec, name).toContain(
        `revoke all on function public.${name}(bigint)\n  from public, anon, authenticated, service_role;`);
      expect(exec, name).not.toContain(`grant execute on function public.${name}(bigint)`);
    }
    // Dasselbe Muster wie apply_inventory_movement seit 0003.
    expect(migrationSource("0003_shop_foundation.sql"))
      .toContain("from public, anon, authenticated, service_role;");
  });

  it("die zwei öffentlichen genau wie jede andere seller-Funktion", () => {
    for (const name of ["seller_hold_sale_item", "seller_release_sale_item_hold"]) {
      expect(exec, name).toContain(`revoke all on function public.${name}(bigint) from public, anon;`);
      expect(exec, name).toContain(`grant execute on function public.${name}(bigint) to authenticated;`);
    }
  });

  it("und für KEINE ersetzte Funktion steht ein grant oder revoke", () => {
    /*
     * `create or replace` erbt die ACL — belegt durch 0041, das beide
     * Inventory-Funktionen ohne ACL-Zeile ersetzte und deren Rechte aus 0003
     * heute noch stehen. Keine Zeile heißt: keine Rechteänderung, beweisbar
     * aus der Datei.
     */
    for (const name of Object.keys(REPLACED)) {
      expect(exec, name).not.toContain(`on function public.${name}(`);
    }
    expect(exec).not.toContain("to service_role");
    expect(exec).not.toContain("to anon");
  });

  it("alle vierzehn Funktionen sind definer mit leerem search_path", () => {
    for (const name of [...NEW_FUNCTIONS, ...Object.keys(REPLACED)]) {
      const head = header(FILE, name);
      expect(head, name).toContain("security definer");
      expect(head, name).toContain("set search_path = ''");
    }
    // Und nur die Projektion ist `stable`; alles, was schreibt, ist volatile.
    expect(header(FILE, "seller_sale")).toContain("stable");
    for (const name of NEW_FUNCTIONS) expect(header(FILE, name), name).toContain("volatile");
  });

  it("die öffentlichen prüfen den Betriebswächter, die internen nicht", () => {
    for (const name of ["seller_hold_sale_item", "seller_release_sale_item_hold"]) {
      expect(body(name), name).toContain("if not public.can_operate_active_seller() then");
    }
    for (const name of ["hold_sale_item", "release_sale_item_hold", "convert_sale_item_hold"]) {
      expect(body(name), name).not.toContain("can_operate_active_seller");
    }
  });

  it("und der öffentliche Weg lehnt ab, was nie gehalten werden darf", () => {
    const sellerHold = body("seller_hold_sale_item");
    for (const refusal of ["an order holds its own stock",
                           "this historical sale has not been released",
                           "this order was cancelled; nothing is held for it"]) {
      expect(sellerHold, refusal).toContain(refusal);
    }
    expect(sellerHold).toContain("return public.hold_sale_item(p_item_id);");
  });
});

// ---------------------------------------------------------------------------
// 10. Der Hold wird sichtbar — und die Ableitung ist echte Logik
// ---------------------------------------------------------------------------

describe("seller_sale zeigt zwei Tatsachen, nicht eine Bewertung", () => {
  const sale = body("seller_sale");

  it("held und stock_available, je Position", () => {
    expect(sale).toContain("'held', exists (select 1 from public.order_reservations h");
    expect(sale).toContain("where h.sale_item_id = i.id and h.state = 'active')");
    expect(sale).toContain("'stock_available', (select v.available_quantity");
    expect(sale).toContain("and v.condition = public.v1_sale_condition())");
  });

  it("und alles, was 0096 lieferte, liefert es weiter", () => {
    for (const field of ["'movement_id'", "'returned_at'", "'return_movement_id'",
                         "'return_announced_at'", "'settled_at'", "'not_shipped_at'",
                         "'legacy_stock_flag'", "'price_is_frozen'", "'fees'",
                         "'refunds'", "'adjustments'", "'expected_payout'", "'buy_in'"]) {
      expect(sale, field).toContain(field);
    }
  });

  it("liest available_quantity, statt sie nachzurechnen", () => {
    // Die generierte Spalte aus 0003: eine Definition, hier gelesen.
    expect(sale).not.toContain("quantity - reserved");
    expect(migrationSource("0003_shop_foundation.sql"))
      .toContain("available_quantity integer     generated always as (quantity - reserved) stored");
  });
});

describe("saleItemHold trennt die drei Lagen", () => {
  const item = (over: Partial<SaleItemHoldFacts> = {}): SaleItemHoldFacts => ({
    movement_id: null, returned_at: null, return_movement_id: null,
    return_announced_at: null, settled_at: null, not_shipped_at: null,
    sky_id: "SKY-0139", held: false, stock_available: 3, ...over,
  });

  it("gehalten gewinnt gegen alles", () => {
    expect(saleItemHold(item({ held: true }))).toBe("held");
    expect(saleItemHold(item({ held: true, stock_available: 0 }))).toBe("held");
  });

  it("frei und nicht gehalten ist haltbar", () => {
    expect(saleItemHold(item())).toBe("holdable");
    expect(saleItemHold(item({ stock_available: 1 }))).toBe("holdable");
    expect(saleItemHold(item({ stock_available: "2" }))).toBe("holdable");
  });

  it("kein freies Stück heißt kein Bestand", () => {
    expect(saleItemHold(item({ stock_available: 0 }))).toBe("no_stock");
    expect(saleItemHold(item({ stock_available: "0" }))).toBe("no_stock");
  });

  it("keine Lagerzeile ist etwas anderes als kein Bestand", () => {
    // Das erste löst ein Einkauf, das zweite eine Lagerzeile.
    expect(saleItemHold(item({ stock_available: null }))).toBe("no_inventory");
    expect(saleItemHold(item({ stock_available: undefined }))).toBe("no_inventory");
  });

  it("und was nichts halten soll, sagt das", () => {
    expect(saleItemHold(item({ sky_id: null }))).toBe("not_applicable");
    expect(saleItemHold(item({ movement_id: 7 }))).toBe("not_applicable");
    expect(saleItemHold(item({ return_movement_id: 7 }))).toBe("not_applicable");
    expect(saleItemHold(item({ returned_at: "t" }))).toBe("not_applicable");
    expect(saleItemHold(item({ return_announced_at: "t" }))).toBe("not_applicable");
    expect(saleItemHold(item({ settled_at: "t" }))).toBe("not_applicable");
    expect(saleItemHold(item({ not_shipped_at: "t" }))).toBe("not_applicable");
  });

  it("dieselbe Rangfolge wie hold_sale_item in der Datenbank", () => {
    /*
     * Die Datenbank entscheidet, ob ein Hold entsteht; diese Funktion
     * entscheidet nur, was darüber steht — und darf nichts anderes
     * behaupten. Jeder Grund, den `hold_sale_item` ablehnend zurückgibt,
     * ist hier `not_applicable` oder eine der drei Bestandslagen.
     */
    const hold = body("hold_sale_item");
    for (const reason of ["not_a_figure", "already_booked", "settled", "not_shipped",
                          "return_announced", "returned", "return_already_restocked"]) {
      expect(hold, reason).toContain(`return '${reason}';`);
    }
  });
});

// ---------------------------------------------------------------------------
// 11. Die Oberfläche
// ---------------------------------------------------------------------------

describe("der Bildschirm zeigt den Hold und bietet den zweiten Versuch", () => {
  const detail = readFileSync("src/components/business/sale-items.tsx", "utf8");
  const actions = readFileSync("src/lib/orderbook/sales-actions.ts", "utf8");

  it("die Aktion geht über die gated Funktion und liest nach", () => {
    expect(actions).toContain('return runItem("seller_hold_sale_item", { p_item_id: itemId }, saleId);');
    expect(detail).toContain("act(id, () => holdSaleItem(id, saleId))");
  });

  it("der Knopf steht, wo er etwas bringen kann", () => {
    expect(detail).toContain('{hold === "holdable" || hold === "no_stock" ? (');
    // Bei no_inventory nicht: es gibt nichts zu halten, solange die Zeile fehlt.
    expect(detail).not.toContain('hold === "no_inventory" ? (');
  });

  it("und er hängt an derselben Zeilensperre wie alles andere", () => {
    const at = detail.indexOf('{hold === "holdable"');
    expect(detail.slice(at, detail.indexOf("</button>", at))).toContain("disabled={working}");
  });

  it("drei Lagen, drei Sätze", () => {
    expect(de.business.sales.hold.held).toBe("Reserviert");
    expect(de.business.sales.hold.noStock).toBe("Kein Bestand");
    expect(de.business.sales.hold.noInventory).toBe("Keine Lagerposition");
    expect(de.business.sales.hold.action).toBe("Reservieren");
    for (const hint of [de.business.sales.hold.heldHint, de.business.sales.hold.noStockHint,
                        de.business.sales.hold.noInventoryHint, de.business.sales.hold.actionHint]) {
      expect(hint.length).toBeGreaterThan(30);
    }
  });

  it("und die zwei Störungen, die nie auftreten sollten, haben einen Satz", () => {
    expect(actions).toContain('text.includes("changed state concurrently")');
    expect(actions).toContain('text.includes("below the hold being")');
    expect(de.business.sales.errors.holdRace).toContain("noch einmal");
    expect(de.business.sales.errors.holdMismatch).toContain("nichts geschrieben");
  });

  it("nichts wird optimistisch gesetzt", () => {
    expect(detail).not.toContain("useOptimistic");
    for (const forbidden of ["reserved -", "reserved +", "held = true", "held: true"]) {
      expect(detail, forbidden).not.toContain(forbidden);
    }
  });
});
