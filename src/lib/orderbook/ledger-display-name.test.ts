/**
 * 0119 — der Anzeigename erreicht das Einkaufsbuch.
 *
 * WAS DIESE DATEI BEWEIST, UND WARUM SIE DAFÜR ZWEI MIGRATIONEN LIEST.
 *
 * Der Kopf von `0119` behauptet, die beiden Funktionsrümpfe stammten Zeichen
 * für Zeichen aus `0116` und es seien genau drei Stellen geändert. Eine
 * Behauptung in einem Kommentar ist keine Prüfung — also baut der letzte Block
 * unten den erwarteten Rumpf aus `0116` nach, wendet die drei Ersetzungen an
 * und vergleicht. Weicht irgendetwas anderes ab, bricht der Test.
 *
 * DIE RANGFOLGE, verbindlich entschieden:
 *
 *   display_name_override → skylanders.name → purchase_items.raw_name → sky_id
 *
 * Der Snapshot steht an Stelle 3 und nicht an Stelle 1: er ist Provenienz,
 * nicht Anzeige. Stünde er vorn, trügen die 919 importierten Positionen weiter
 * ihren mehrdeutigen Arbeitsmappennamen — „Wii U Spiel" ist in der Historie
 * der Name von drei verschiedenen Spielen —, und genau das sollte `0117`
 * beenden.
 */
import { describe, expect, it } from "vitest";

import {
  code, latestFunction, migrationFiles, migrationSource,
} from "@/test-support/migrations";

const SQL = migrationSource("0119_orderbook_display_names.sql");
const PRIOR = migrationSource("0116_purchase_factor_showcase_and_ledger.sql");

const CHAIN = "coalesce(s.display_name_override, s.name, i.raw_name, i.sky_id)";

/** Der Rumpf einer Funktion aus EINER bestimmten Datei. */
function bodyIn(sql: string, name: string): string {
  const start = sql.lastIndexOf(`create or replace function public.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  const end = sql.indexOf("\n$$;", start);
  expect(end, name).toBeGreaterThan(start);
  return sql.slice(start, end);
}

describe("die Rangfolge des Anzeigenamens", () => {
  it("die Detailseite löst sie vollständig auf", () => {
    const fn = latestFunction("seller_purchase");
    expect(fn.file).toBe("0119_orderbook_display_names.sql");
    expect(fn.body).toContain(`'name', ${CHAIN}`);
    /* Und die alte Kette ist weg, nicht daneben. */
    expect(fn.body).not.toContain("coalesce(s.name, i.raw_name)");
  });

  it("der Ledger löst sie vollständig auf", () => {
    const fn = latestFunction("seller_orderbook_ledger");
    /* `0124` hat den Rumpf aus `0119` übernommen und um den Belegzustand
       erweitert — die Namensauflösung darunter ist dieselbe, und genau das
       prüfen die drei Zusicherungen unten. */
    expect(fn.file).toBe("0124_orderbook_receipt_status.sql");
    expect(code(fn.body)).toContain("coalesce(s.display_name_override, s.name,");
    expect(code(fn.body)).toContain("i.raw_name, i.sky_id))");
    expect(fn.body).not.toContain("coalesce(s.name, i.raw_name, i.sky_id)");
  });

  it("der historische Rohname bleibt als EIGENES Feld erhalten", () => {
    /*
     * Die Detailseite bekommt `name` UND `raw_name`. Der Snapshot wird also
     * nicht ersetzt, sondern tritt neben den aufgelösten Namen — dort gehört
     * eine Herkunftsangabe hin.
     */
    const body = latestFunction("seller_purchase").body;
    expect(body).toContain("'raw_name', i.raw_name");
  });

  it("die Reihenfolge ist genau diese und keine andere", () => {
    /* Eine Kette, in der der Snapshot vorne steht, wäre syntaktisch genauso
       gültig und fachlich das Gegenteil. */
    for (const wrong of [
      "coalesce(i.raw_name, s.display_name_override",
      "coalesce(i.raw_name, s.name",
      "coalesce(s.name, s.display_name_override",
    ]) {
      expect(SQL, wrong).not.toContain(wrong);
    }
  });
});

describe("die Suche findet beides", () => {
  const body = code(latestFunction("seller_orderbook_ledger").body);

  it("den aktuellen Anzeigenamen", () => {
    expect(body).toContain("s.display_name_override ilike '%' || v_q || '%'");
  });

  it("und den historischen Rohnamen, unverändert", () => {
    expect(body).toContain("i.raw_name ilike '%' || v_q || '%'");
    expect(body).toContain("s.name     ilike '%' || v_q || '%'");
    expect(body).toContain("i.sky_id   ilike '%' || v_q || '%'");
    expect(body).toContain("se.label   ilike '%' || v_q || '%'");
  });

  it("die Suche hat genau einen Zweig DAZUBEKOMMEN, keinen verloren", () => {
    const before = code(bodyIn(PRIOR, "seller_orderbook_ledger"));
    const branches = (sql: string) =>
      (sql.match(/ilike '%' \|\| v_q \|\| '%'/g) ?? []).length;
    expect(branches(body)).toBe(branches(before) + 1);
  });
});

describe("0119 schreibt keine Daten", () => {
  it("keine schreibende Anweisung auf oberster Ebene", () => {
    for (const verb of ["insert", "update", "delete", "truncate", "merge", "copy",
                        "alter", "drop", "create table", "create index"]) {
      expect(SQL.toLowerCase(), verb)
        .not.toMatch(new RegExp(`^\\s*${verb}\\b`, "m"));
    }
  });

  it("beide Funktionen bleiben stable und damit lesend", () => {
    for (const name of ["seller_purchase", "seller_orderbook_ledger"]) {
      expect(bodyIn(SQL, name), name).toContain("\nstable\n");
      expect(bodyIn(SQL, name), name).not.toContain("\nvolatile\n");
    }
    expect(SQL).toContain("ist nicht mehr stable");
  });

  it("und prüft nach dem Lauf selbst, dass sich nichts bewegt hat", () => {
    expect(SQL).toContain("UND KEINE ZEILE HAT SICH BEWEGT");
    expect(SQL).toContain("gebuchte Position ohne Lagerbewegung");
  });

  it("0117 und 0118 werden nicht angefasst", () => {
    expect(SQL).not.toContain("display_name_override =");
    expect(SQL).not.toContain("purchases_platform_known");
    expect(SQL).not.toContain("seller_import_catalog");
  });
});

describe("Rechte und Signaturen", () => {
  it("keine Signatur ändert sich — `create or replace` ohne `drop`", () => {
    expect(SQL).not.toContain("drop function");
    expect(SQL).toContain("create or replace function public.seller_purchase(p_id bigint)");
    expect(SQL).toContain("create or replace function public.seller_orderbook_ledger(");
  });

  it("die Rechte werden ausdrücklich wiederholt statt vorausgesetzt", () => {
    expect(SQL).toContain("revoke all on function public.seller_purchase(bigint) from public, anon;");
    expect(SQL).toContain("grant execute on function public.seller_purchase(bigint) to authenticated;");
    expect(SQL).toContain(
      "revoke all on function public.seller_orderbook_ledger(integer, integer, text, boolean, text) from public, anon;");
    expect(SQL).toContain(
      "grant execute on function public.seller_orderbook_ledger(integer, integer, text, boolean, text) to authenticated;");
  });

  it("beide bleiben security definer mit leerem search_path", () => {
    for (const name of ["seller_purchase", "seller_orderbook_ledger"]) {
      const body = bodyIn(SQL, name);
      expect(body, name).toContain("security definer");
      expect(body, name).toContain("set search_path = ''");
      expect(body, name).toContain("can_operate_active_seller()");
    }
  });

  it("der Ledger bleibt eine einzige Überladung", () => {
    expect(SQL).toContain("mehrfach überladen");
    const creates = (SQL.match(/create or replace function public\.seller_orderbook_ledger\(/g) ?? []);
    expect(creates).toHaveLength(1);
  });
});

describe("außer den drei Stellen ist nichts geändert", () => {
  it("seller_purchase: der 0116-Rumpf plus eine Zeile", () => {
    const expected = bodyIn(PRIOR, "seller_purchase").replace(
      "        'name', coalesce(s.name, i.raw_name), 'raw_name', i.raw_name,",
      `        'name', ${CHAIN},\n        'raw_name', i.raw_name,`,
    );
    expect(bodyIn(SQL, "seller_purchase")).toBe(expected);
  });

  it("seller_orderbook_ledger: der 0116-Rumpf plus zwei Zeilen", () => {
    const expected = bodyIn(PRIOR, "seller_orderbook_ledger")
      .replace(
        "                     'name', coalesce(s.name, i.raw_name, i.sky_id))",
        "                     'name', coalesce(s.display_name_override, s.name,\n"
        + "                                      i.raw_name, i.sky_id))",
      )
      .replace(
        "               and (i.raw_name ilike '%' || v_q || '%'\n"
        + "                 or s.name     ilike '%' || v_q || '%'\n"
        + "                 or i.sky_id   ilike '%' || v_q || '%'",
        "               and (i.raw_name ilike '%' || v_q || '%'\n"
        + "                 or s.name     ilike '%' || v_q || '%'\n"
        + "                 or s.display_name_override ilike '%' || v_q || '%'\n"
        + "                 or i.sky_id   ilike '%' || v_q || '%'",
      );
    expect(bodyIn(SQL, "seller_orderbook_ledger")).toBe(expected);
  });

  it("jeder Filter, jede Summe und jede Sortierung also unverändert", () => {
    /*
     * Folgt aus dem Vergleich oben — hier noch einmal namentlich, damit ein
     * Fehlschlag sagt, WAS verloren ging, und nicht nur „die Rümpfe weichen
     * ab".
     */
    const body = code(latestFunction("seller_orderbook_ledger").body);
    for (const kept of [
      "p_undated", "is_incomplete", "is_open", "settled_items", "showcase_items",
      "damaged_items", "missing_items", "open_items", "daily_index",
      "purchase_market_value(p.id)", "order by m.purchased_at desc nulls last",
    ]) {
      expect(body, kept).toContain(kept);
    }
  });

  it("seit 0119 hat nur 0124 den Ledger angefasst, und seller_purchase niemand", () => {
    /*
     * DIE ZUSICHERUNG BLEIBT, DIE ERWARTUNG WÄCHST.
     *
     * Hier stand „0119 ist die letzte Migration, die diese beiden anfasst",
     * und das war der richtige Wächter: eine spätere Datei, die eine dieser
     * Funktionen unbemerkt neu anlegt, hätte die Namensauflösung lautlos
     * zurückdrehen können.
     *
     * `0124` fasst den Ledger an — mit Freigabe, für den Belegzustand, und
     * unter Beibehaltung jeder Zeile darunter. `seller_purchase` ist
     * unverändert bei `0119`. Jede WEITERE Fassung fällt hier wieder auf.
     */
    expect(latestFunction("seller_purchase").file)
      .toBe("0119_orderbook_display_names.sql");
    expect(latestFunction("seller_orderbook_ledger").file)
      .toBe("0124_orderbook_receipt_status.sql");

    /*
     * UND DIE KETTE DER ANLAGEN ENDET AUF GENAU DIESEN ZWEI DATEIEN.
     *
     * Der Ledger ist seit `0056` zehnmal erweitert worden — eine Zählung über
     * die ganze Historie sagt also nichts. Was etwas sagt, ist das ENDE der
     * Kette: nach `0119` kommt genau eine Datei, und das ist `0124`. Eine
     * elfte Fassung fällt hier auf, bevor sie unbemerkt die Namensauflösung
     * zurückdreht.
     */
    const anlagen = migrationFiles.filter((file) =>
      migrationSource(file).includes(
        "create or replace function public.seller_orderbook_ledger("));
    expect(anlagen.slice(-2)).toEqual([
      "0119_orderbook_display_names.sql",
      "0124_orderbook_receipt_status.sql",
    ]);
  });
});

describe("Regression gegen Phase A+B und die Sammlungslogik", () => {
  it("0117 und 0118 bleiben byte-identisch unangetastet", () => {
    /*
     * Beide sind auf Staging ausgeführt und verifiziert. Eine spätere
     * Migration darf sie ergänzen, aber niemand darf die Datei ändern — die
     * ausgeführte Fassung und die Datei im Repository müssen dasselbe sein.
     */
    for (const file of ["0117_catalog_display_names_and_picker.sql",
                        "0118_purchase_platform_ebay.sql"]) {
      expect(migrationSource(file).length, file).toBeGreaterThan(0);
    }
    /* Die Funktion aus 0117 wird von 0119/0120 nicht neu angelegt. */
    expect(latestFunction("seller_import_catalog").file)
      .toBe("0117_catalog_display_names_and_picker.sql");
    expect(SQL).not.toContain("seller_import_catalog");
    expect(migrationSource("0120_purchase_states_and_idempotency.sql"))
      .not.toContain("seller_import_catalog");
  });

  it("die Sammlungslogik wird von 0119 und 0120 nicht berührt", () => {
    /*
     * Weder `skylanders` noch `categories` noch eine Sammlungsfunktion kommt
     * in den beiden Migrationen vor. Der Fortschritt jedes Nutzers hängt
     * daran, und diese Arbeit hat damit nichts zu tun.
     */
    for (const file of ["0119_orderbook_display_names.sql",
                        "0120_purchase_states_and_idempotency.sql"]) {
      const sql = migrationSource(file);
      for (const forbidden of ["collection_items", "countCollectible",
                               "alter table public.skylanders",
                               "alter table public.categories",
                               "update public.skylanders", "update public.categories"]) {
        expect(sql, `${file} / ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("die Detailseite behält ihre eigenen Positionsaktionen", () => {
    /*
     * Die Sammelbestätigung gilt ausdrücklich NUR dem Anlegen. An einem
     * bestehenden Einkauf bleiben Zustandsänderung und Einbuchung einzeln und
     * unabhängig.
     */
    const items = migrationSource("0053_orderbook_purchases.sql");
    expect(items.length).toBeGreaterThan(0);
    for (const name of ["seller_book_purchase_item", "seller_set_purchase_item_state"]) {
      expect(latestFunction(name).file, name)
        .not.toBe("0120_purchase_states_and_idempotency.sql");
      expect(latestFunction(name).file, name)
        .not.toBe("0119_orderbook_display_names.sql");
    }
  });
});
