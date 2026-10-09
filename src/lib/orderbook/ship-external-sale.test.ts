import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { code, latestFunction, migrationFiles, migrationSource } from "@/test-support/migrations";
import { de } from "../i18n/de";

/**
 * `0112` — EIN EXTERNER VERKAUF MIT FREIEN ARTIKELN LÄSST SICH ABSCHLIESSEN.
 *
 * DAS PROBLEM, IN EINEM SATZ. Eine Position ohne `sky_id` kann per CHECK
 * (`sale_items_movement_needs_figure`) niemals eine Lagerbewegung besitzen,
 * und `sale_item_is_closed()` kennt für sie nur ein Ende: `settled_at`. Bis
 * 0112 schrieb das ausschließlich `seller_settle_sale_item()`, Position für
 * Position. Ein Verkauf aus lauter freien Artikeln stand deshalb für immer
 * auf „Offen".
 *
 * WAS DIESER TEST ZEIGT — UND WAS NICHT. Nicht beweisbar ist hier, dass
 * PostgreSQL die Transaktion wirklich atomar schließt oder dass ein zweiter
 * Aufruf nichts schreibt; das zeigt die Staging-Probe. Beweisbar ist, dass
 * die Datei die Zusagen MACHT, von denen die Oberfläche ausgeht — und zwar
 * die Verbote so scharf wie die Zusagen:
 *
 *   keine Lagerbewegung · kein Hold · keine Bestandsänderung · keine
 *   Katalogfigur stillschweigend geschlossen · keine interne Bestellung
 *   angefasst · keine Kopie der Settle-Regeln
 *
 * Der letzte Punkt ist der wichtigste: die Funktion DELEGIERT an
 * `seller_settle_sale_item()`, statt dessen fünf Ablehnungen nachzubauen.
 * Eine Kopie wäre heute identisch und in sechs Monaten eine zweite Meinung
 * darüber, was „erledigt" heißt.
 */

const FILE = "0112_ship_external_sale.sql";
const raw = migrationSource(FILE);
const exec = code(raw);

const ACTIONS = readFileSync("src/lib/orderbook/sales-actions.ts", "utf8");
const DETAILS = readFileSync("src/components/business/sale-details.tsx", "utf8");
const LEDGER = readFileSync("src/components/business/sales-ledger.tsx", "utf8");

const modal = de.business.sales.detailsModal;

describe("0112 is additive and nothing more", () => {
  it("is the newest migration and sits alone at its number", () => {
    expect(migrationFiles).toContain(FILE);
    expect(migrationFiles.filter((f) => f.startsWith("0112"))).toEqual([FILE]);
  });

  it("creates exactly one function and no schema at all", () => {
    const created = [...exec.matchAll(/create or replace function public\.(\w+)/g)].map((m) => m[1]);
    expect(created).toEqual(["seller_ship_sale"]);
    for (const forbidden of [
      /create table/i, /alter table/i, /drop (table|column|function|constraint|trigger|index)/i,
      /create (unique )?index/i, /create trigger/i, /add constraint/i,
      /delete from/i, /insert into/i, /truncate/i,
    ]) {
      expect(exec, String(forbidden)).not.toMatch(forbidden);
    }
  });

  it("writes to exactly one table, and it is `sales`", () => {
    const updates = [...exec.matchAll(/update\s+public\.(\w+)/g)].map((m) => m[1]);
    expect(updates).toEqual(["sales"]);
  });

  it("is the latest definition of the function, so the database runs this body", () => {
    expect(latestFunction("seller_ship_sale").file).toBe(FILE);
  });
});

describe("0112 — seller_ship_sale", () => {
  const { body } = latestFunction("seller_ship_sale");
  const fn = code(body);

  it("is gated, definer, and with an empty search_path like every seller RPC", () => {
    expect(fn).toContain("security definer");
    expect(fn).toMatch(/set search_path = ''/);
    /* Die Berechtigung steht VOR jedem Lesen, nicht irgendwo im Rumpf. */
    const gate = fn.indexOf("can_operate_active_seller");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(fn.indexOf("from public.sales"));
    expect(fn).toContain("insufficient_privilege");
  });

  it("only `authenticated` may call it — never `anon`", () => {
    expect(exec).toMatch(
      /revoke all on function public\.seller_ship_sale\(bigint\) from public, anon;/);
    expect(exec).toMatch(
      /grant execute on function public\.seller_ship_sale\(bigint\) to authenticated;/);
    expect(exec).not.toMatch(/grant[^;]*seller_ship_sale[^;]*anon/);
  });

  it("refuses the three sales it must refuse, each with its own sentence", () => {
    for (const [guard, refusal] of [
      ["v_sale.order_id is not null", "the order owns its shipping state"],
      ["v_sale.cancelled_at is not null", "a cancelled sale is not shipped"],
      ["v_sale.stock_released_at is null", "this historical sale has not been released"],
    ] as const) {
      expect(fn, guard).toContain(guard);
      expect(fn, refusal).toContain(refusal);
      /* Die Ablehnung folgt ihrer Prüfung, nicht umgekehrt. */
      expect(fn.indexOf(refusal), refusal).toBeGreaterThan(fn.indexOf(guard));
    }
    /* Und sie stehen alle VOR der Schleife: eine halb geschlossene
       Ablehnung wäre genau der Zwischenzustand, den 0112 vermeidet. */
    const loop = fn.indexOf("for v_item in");
    for (const refusal of ["the order owns its shipping state",
                           "a cancelled sale is not shipped",
                           "this historical sale has not been released"]) {
      expect(fn.indexOf(refusal), refusal).toBeLessThan(loop);
    }
  });

  it("takes the sale row under a lock before deciding anything", () => {
    expect(fn).toMatch(/from public\.sales where id = p_id for update/);
  });

  /*
   * DIE AUSWAHL IST DIE GANZE SICHERHEIT.
   *
   * Hier liegt die Zusage „katalogisierte Positionen werden nicht
   * stillschweigend abgeschlossen". Sie ist keine Prüfung im Rumpf, sondern
   * die WHERE-Klausel: eine Position mit `sky_id` kommt nie in die Schleife.
   */
  it("settles only free positions, and only ones still open", () => {
    const loop = fn.slice(fn.indexOf("for v_item in"), fn.indexOf("end loop"));
    expect(loop).toContain("from public.sale_items");
    expect(loop).toContain("i.sale_id = p_id");
    expect(loop).toContain("i.sky_id is null");
    expect(loop).toContain("not public.sale_item_is_closed(i)");
    /* Feste Sperrordnung: zwei gleichzeitige Aufrufe verklemmen nicht. */
    expect(loop).toContain("order by i.id");
    /* Und kein `sky_id is not null` irgendwo — in keiner Richtung. */
    expect(fn).not.toContain("sky_id is not null");
  });

  it("delegates what `erledigt` means instead of copying the rules", () => {
    expect(fn).toContain("perform public.seller_settle_sale_item(v_item.id, true)");
    /* Die fünf Regeln aus 0110 stehen dort und NUR dort. */
    for (const copied of ["legacy_stock_flag", "release_sale_item_hold",
                          "update public.sale_items", "settled_at = now()"]) {
      expect(fn, copied).not.toContain(copied);
    }
  });

  it("moves no stock, takes no hold and never touches the catalog", () => {
    for (const forbidden of [
      "inventory_movements", "shop_inventory", "apply_inventory_movement",
      "hold_sale_item", "order_reservations", "reserved", "skylanders",
      "movement_id", "quantity",
    ]) {
      expect(fn, forbidden).not.toContain(forbidden);
    }
  });

  it("dates the shipment idempotently and keeps the audit trail", () => {
    expect(fn).toContain("shipped_at = coalesce(shipped_at, now())");
    expect(fn).toContain("updated_at = now()");
    expect(fn).toContain("updated_by = (select auth.uid())");
    /* Ein zweiter Aufruf darf das Datum NICHT neu setzen. */
    expect(fn).not.toMatch(/shipped_at = now\(\)/);
  });

  it("reports what it closed and what is still open", () => {
    expect(fn).toContain("'settled'");
    expect(fn).toContain("'still_open'");
    expect(fn).toContain("'already_shipped'");
    /* `still_open` zählt ALLE Positionen, nicht nur die freien: bei einem
       gemischten Verkauf ist genau das die Nachricht. */
    const count = fn.slice(fn.indexOf("select count(*) into v_open"));
    expect(count).toContain("not public.sale_item_is_closed(i)");
    expect(count.slice(0, count.indexOf(";"))).not.toContain("sky_id");
  });

  it("checks its own preconditions and postconditions", () => {
    expect(exec).toContain("seller_settle_sale_item() fehlt");
    expect(exec).toContain("sale_item_is_closed() fehlt");
    expect(exec).toContain("seller_ship_sale() fehlt");
    /* Und die Nachbedingung sieht nach, dass sie definer mit gesetztem
       search_path ist — nicht nur, dass sie existiert. */
    expect(exec).toContain("prosecdef");
    /* Mit `\\_`, damit LIKE den Unterstrich wörtlich nimmt. */
    expect(exec).toContain("search\\_path=%");
  });
});

describe("shipSale — die eine Server Action", () => {
  it("calls the RPC with nothing but the sale id", () => {
    const action = ACTIONS.slice(ACTIONS.indexOf("export async function shipSale"));
    const body = action.slice(0, action.indexOf("\n}"));
    expect(body).toContain('supabase.rpc("seller_ship_sale", { p_id: id })');
    /* Keine zweite Runde: nicht erst settlen und dann verschicken. */
    expect(body).not.toContain("seller_settle_sale_item");
    expect(body).not.toContain("seller_set_sale_shipped");
  });

  it("asks whether the caller may operate before it calls anything", () => {
    const action = ACTIONS.slice(ACTIONS.indexOf("export async function shipSale"));
    const body = action.slice(0, action.indexOf("\n}"));
    expect(body.indexOf("canOperateSeller")).toBeLessThan(body.indexOf("supabase.rpc"));
    expect(body).toContain("de.admin.notAllowed");
  });

  it("reports the database's counts and computes none of its own", () => {
    const action = ACTIONS.slice(ACTIONS.indexOf("export async function shipSale"));
    const body = action.slice(0, action.indexOf("\n}"));
    expect(body).toContain("result.settled");
    expect(body).toContain("result.still_open");
    expect(body).not.toMatch(/\.filter\(|\.length/);
  });

  it("the refusal `seller_ship_sale` words differently still gets a sentence", () => {
    expect(ACTIONS).toContain('text.includes("cancelled sale is not shipped")');
    expect(de.business.sales.errors.saleCancelled.length).toBeGreaterThan(20);
  });
});

describe("die Order-Aktion im Verkaufsfenster", () => {
  it("steht im Fenster und ruft genau eine Aktion", () => {
    expect(DETAILS).toContain("shipSale");
    expect(DETAILS).toContain("{modal.markShipped}");
    /* Und nicht N Aufrufe aus dem Browser hintereinander. */
    expect(DETAILS).not.toContain("settleSaleItem");
  });

  /*
   * EIN KNOPF, DER NUR EINE REGEL VORLESEN KANN, IST KEIN KNOPF.
   *
   * Jede der vier Bedingungen entspricht einer Ablehnung der Funktion. Fehlt
   * eine, klickt der Betreiber in eine Fehlermeldung, die der Bildschirm
   * schon kannte.
   */
  it("erscheint nur, wo die Funktion sie auch annehmen würde", () => {
    const control = DETAILS.slice(DETAILS.indexOf("{!internal && sale.shippedAt === null"));
    const condition = control.slice(0, control.indexOf("?"));
    expect(condition).toContain("!internal");
    expect(condition).toContain("sale.shippedAt === null");
    expect(condition).toContain("sale.cancelledAt === null");
    expect(condition).toContain("!frozen");
    expect(DETAILS).toContain("const frozen = historical && sale.stockReleasedAt === null");
  });

  it("sagt, was sie NICHT tut", () => {
    expect(modal.markShipped).toBe("Als verschickt markieren");
    /* Regalgebundene Figuren bleiben offen, und der Hinweis sagt es. */
    expect(modal.markShippedHint).toMatch(/Katalogfigur/);
    expect(modal.markShippedHint).toMatch(/ausgebucht/);
    expect(modal.markShippedHint.length).toBeGreaterThan(60);
  });

  it("die Quittung zählt richtig — null, eins, viele", () => {
    expect(modal.markShippedDone(0)).toBe("Versand datiert.");
    expect(modal.markShippedDone(1)).toContain("1 freie Position ");
    expect(modal.markShippedDone(3)).toContain("3 freie Positionen");
    expect(modal.markShippedStillOpen(1)).toMatch(/^1 Position ist/);
    expect(modal.markShippedStillOpen(2)).toMatch(/^2 Positionen sind/);
    /* Offenes wird genannt, nicht verschwiegen. */
    expect(modal.markShippedStillOpen(2)).toMatch(/ausgebucht/);
  });

  it("das Verkaufsbuch baut keinen zweiten Weg dafür", () => {
    /*
     * Die Positionsliste bietet weiterhin NUR die Aktionen, die Bestand
     * bewegen oder eine Retoure weiterführen. `settle` je Position dort
     * aufzunehmen wäre ein zweiter Weg zum selben Ergebnis — und der
     * Kommentar in `sales-ledger.tsx` sagt seit 0072, warum nicht.
     */
    const primary = LEDGER.slice(LEDGER.indexOf("const primary:"),
                                 LEDGER.indexOf("const run = can.primary"));
    expect(primary).not.toContain("settleSaleItem");
    /* `\\b`, weil `shipSaleItem` das Präfix teilt und bleiben soll. */
    expect(LEDGER).not.toMatch(/shipSale\b/);
    expect(LEDGER).toContain("shipSaleItem");
  });
});
