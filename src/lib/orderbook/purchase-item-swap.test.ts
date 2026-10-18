/**
 * Eine Figur direkt austauschen (`0127`).
 *
 * DREI SCHICHTEN, GETRENNT GEPRÜFT — wie bei `0126`.
 *
 * Der lokale Zustand wird AUSGEFÜHRT: dass ein Wechsel auf dieselbe SKY-ID
 * verschwindet, dass ein zweiter Wechsel den ersten ersetzt, dass Wechseln und
 * Entfernen einander ausschließen. Die Atomarität, die Rechte und der
 * Lagerschutz liegen in der Datenbank — dort wird der Quelltext der Migration
 * geprüft, denn ohne PostgreSQL ist das die einzige ehrliche Form. Und die
 * Rückwärtskompatibilität des bestehenden Clients wird an genau der Stelle
 * geprüft, an der sie entschieden wird: Parameternamen, -typen und Defaults.
 */
import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";

import { de } from "@/lib/i18n/de";

import { code, latestFunction, migrationSource } from "@/test-support/migrations";
import {
  dropSwap, emptyEdit, isDirty, needsReceiptConfirm, savePayload, stageRows,
  swapFigure, toggleRemove, type PendingEdit, type SwapFigure,
} from "@/lib/orderbook/purchase-item-edit";
import type { PurchaseItem } from "@/lib/orderbook/queries";

const FILE = "0127_purchase_item_swap.sql";
const sql = migrationSource(FILE);
const exec = code(sql);
const saveFn = code(latestFunction("seller_save_purchase_edit").body);
const ACTIONS = readFileSync("src/lib/orderbook/actions.ts", "utf8");
const DIALOG = readFileSync("src/components/business/purchase-details.tsx", "utf8");
const modal = de.business.orderbook.detailsModal;

/** Eine offene Position: nicht gebucht, keine Legacy-Herkunft. */
const open = (over: Partial<PurchaseItem> = {}): PurchaseItem => ({
  id: 1, position: 1, skyId: "SKY-0001", name: "Spyro", rawName: null,
  seriesCode: null, seriesLabel: null, condition: "loose", state: "ordered",
  marketPrice: 12, priceIsFrozen: false, movementId: null,
  legacyConditionFlag: null, legacyBookedFlag: null, sourceRow: null, ...over,
});
/** Dieselbe Figur in Giants — das Beispiel des Betreibers. */
const giants: SwapFigure = { itemId: 1, skyId: "SKY-0210", label: "Spyro (Giants)" };

/* ==========================================================================
 * 1. Der lokale Zustand
 * ======================================================================== */

describe("ein Wechsel wird vorgemerkt, nicht geschrieben", () => {
  it("er macht den Dialog verändert", () => {
    expect(isDirty(swapFigure(emptyEdit, 1, "SKY-0001", giants))).toBe(true);
  });

  it("DIESELBE SKY-ID ist kein Auftrag — sie verschwindet", () => {
    const p = swapFigure(emptyEdit, 1, "SKY-0001",
                         { itemId: 1, skyId: "SKY-0001", label: "Spyro" });
    expect(p.swap).toEqual([]);
    expect(isDirty(p)).toBe(false);
  });

  it("und auch ein bereits vorgemerkter Wechsel fällt weg, wenn er zurückführt", () => {
    const p = swapFigure(swapFigure(emptyEdit, 1, "SKY-0001", giants),
                         1, "SKY-0001", { itemId: 1, skyId: "SKY-0001", label: "Spyro" });
    expect(p.swap).toEqual([]);
  });

  it("ein zweiter Wechsel ERSETZT den ersten, er kommt nicht dazu", () => {
    const p = swapFigure(swapFigure(emptyEdit, 1, "SKY-0001", giants),
                         1, "SKY-0001",
                         { itemId: 1, skyId: "SKY-0300", label: "Spyro (Swap Force)" });
    expect(p.swap).toHaveLength(1);
    expect(p.swap[0].skyId).toBe("SKY-0300");
  });

  it("zwei verschiedene Zeilen gehen nebeneinander", () => {
    const p = swapFigure(swapFigure(emptyEdit, 1, "SKY-0001", giants),
                         2, "SKY-0002", { itemId: 2, skyId: "SKY-0211", label: "Gill Grunt (Giants)" });
    expect(p.swap.map((s) => s.itemId)).toEqual([1, 2]);
  });

  it("zurücknehmen lässt nichts zurück", () => {
    expect(dropSwap(swapFigure(emptyEdit, 1, "SKY-0001", giants), 1).swap).toEqual([]);
  });

  it("ABBRECHEN verwirft auch Wechsel — `emptyEdit` ist der ganze Rückweg", () => {
    expect(emptyEdit.swap).toEqual([]);
    expect(isDirty(emptyEdit)).toBe(false);
  });

  it("und keine Funktion verändert den übergebenen Zustand", () => {
    const vorher: PendingEdit = { add: [], remove: [], swap: [giants] };
    const kopie = JSON.stringify(vorher);
    swapFigure(vorher, 2, "SKY-0002", { itemId: 2, skyId: "SKY-0211", label: "x" });
    dropSwap(vorher, 1);
    toggleRemove(vorher, 1);
    expect(JSON.stringify(vorher)).toBe(kopie);
  });
});

describe("Wechseln und Entfernen schließen einander aus", () => {
  it("entfernen räumt einen vorgemerkten Wechsel weg", () => {
    const p = toggleRemove(swapFigure(emptyEdit, 1, "SKY-0001", giants), 1);
    expect(p.remove).toEqual([1]);
    expect(p.swap).toEqual([]);
  });

  it("und wechseln nimmt das Entfernen zurück", () => {
    const p = swapFigure(toggleRemove(emptyEdit, 1), 1, "SKY-0001", giants);
    expect(p.remove).toEqual([]);
    expect(p.swap).toHaveLength(1);
  });

  it("die Nutzlast kann den Widerspruch deshalb gar nicht enthalten", () => {
    const p = toggleRemove(swapFigure(emptyEdit, 1, "SKY-0001", giants), 1);
    const nutzlast = savePayload(p);
    for (const s of nutzlast.swap) expect(nutzlast.remove).not.toContain(s.item_id);
  });

  it("aber der Server lehnt ihn trotzdem ab — der Dialog ist nicht die Grenze", () => {
    expect(saveFn).toContain("an item cannot be swapped and removed in the same save");
    expect(saveFn).toContain("check_violation");
  });
});

/* ==========================================================================
 * 2. Was der Dialog anbietet
 * ======================================================================== */

describe("der Tauschknopf erscheint nur, wo er etwas tun kann", () => {
  const row = (item: PurchaseItem) => {
    const r = stageRows([item], emptyEdit)[0];
    if (r.kind !== "existing") throw new Error("keine bestehende Zeile");
    return r;
  };

  it("eine offene Position darf gewechselt werden", () => {
    expect(row(open()).maySwap).toBe(true);
  });

  it("eine EINGEBUCHTE nicht — die Bewegung nennt das Stück im Regal", () => {
    expect(row(open({ movementId: 7 })).maySwap).toBe(false);
    expect(row(open({ state: "booked" })).maySwap).toBe(false);
  });

  it("eine ARBEITSMAPPENZEILE darf gewechselt und NICHT entfernt werden", () => {
    const r = row(open({ state: "reconciled_legacy" }));
    expect(r.maySwap).toBe(true);
    expect(r.mayRemove).toBe(false);
  });

  it("der vorgemerkte Wechsel hängt an der Zeile, die ihn betrifft", () => {
    const rows = stageRows([open(), open({ id: 2, skyId: "SKY-0002", name: "Gill Grunt" })],
                           { add: [], remove: [], swap: [giants] });
    expect(rows[0].kind === "existing" && rows[0].swap?.skyId).toBe("SKY-0210");
    expect(rows[1].kind === "existing" && rows[1].swap).toBe(null);
  });

  it("und die Erklärungen stehen in de.ts, nicht im JSX", () => {
    expect(modal.swapFigure).toBe("Figur ändern");
    expect(modal.markedSwapped).toBe("Geändert");
    expect(modal.undoSwap).toBe("Änderung zurücknehmen");
    expect(modal.swapBlockedBooked).toContain("erst zurückbuchen");
    expect(modal.swapFigureOne("Spyro")).toContain("Spyro");
    expect(de.business.orderbook.errors.swapIcon).toBe("⇄");
  });

  it("die Zusammenfassung nennt Wechsel getrennt von neu und entfernt", () => {
    expect(modal.pendingSummary(1, 1, 1)).toContain("geändert");
    expect(modal.pendingSummary(0, 0, 2)).toBe("2 geändert");
    expect(modal.pendingSummary(0, 0, 0)).toBe("");
  });
});

describe("die Suche startet bei der heutigen Figur", () => {
  it("der Dialog gibt FigureSearch den bisherigen Namen mit", () => {
    expect(DIALOG).toContain("initialQuery={item.name}");
  });

  it("und FigureSearch nimmt ihn als Startwert, nicht als festen Wert", () => {
    const search = readFileSync("src/components/business/figure-search.tsx", "utf8");
    expect(search).toContain("initialQuery");
    expect(search).toContain("useState(initialQuery)");
  });
});

describe("ein vorhandener Eigenbeleg verlangt auch beim Wechsel eine Bestätigung", () => {
  it("weil der Fingerabdruck aus 0122 sky_id UND name hasht", () => {
    const p = swapFigure(emptyEdit, 1, "SKY-0001", giants);
    expect(needsReceiptConfirm(true, p)).toBe(true);
  });

  it("ein Leerwechsel dagegen nicht — er schreibt nichts", () => {
    const p = swapFigure(emptyEdit, 1, "SKY-0001",
                         { itemId: 1, skyId: "SKY-0001", label: "Spyro" });
    expect(needsReceiptConfirm(true, p)).toBe(false);
  });

  it("und der Hash umfasst beide Felder", () => {
    /* Die LETZTE Fassung, nicht die Datei: 0122 legt sie an, aber die Frage
       ist, was die Datenbank heute hasht. */
    const fp = latestFunction("purchase_receipt_fingerprint").body;
    expect(fp).toContain("'sky_id'");
    expect(fp).toContain("'name'");
  });
});

/* ==========================================================================
 * 3. Die Nutzlast
 * ======================================================================== */

describe("die Nutzlast ist genau der Unterschied", () => {
  it("ein Wechsel schickt Positions-ID und Ziel-SKY-ID, sonst nichts", () => {
    const p = swapFigure(emptyEdit, 1, "SKY-0001", giants);
    expect(savePayload(p).swap).toEqual([{ item_id: 1, sky_id: "SKY-0210" }]);
  });

  it("kein Name und keine Position fahren mit — der Katalog entscheidet", () => {
    const [eintrag] = savePayload(swapFigure(emptyEdit, 1, "SKY-0001", giants)).swap;
    expect(Object.keys(eintrag).sort()).toEqual(["item_id", "sky_id"]);
  });

  it("ohne Wechsel ist die Liste leer und nicht undefined", () => {
    expect(savePayload(emptyEdit).swap).toEqual([]);
  });

  it("und der Server-Aufruf reicht sie als p_swap durch", () => {
    expect(ACTIONS).toContain("p_swap: items.swap ?? []");
  });
});

/* ==========================================================================
 * 4. 0127 — eine Transaktion, und keine gelockerte Regel
 * ======================================================================== */

describe("0127 wechselt im selben Speichern", () => {
  it("ein Aufruf, der Felder, Wechsel, Entfernen und Hinzufügen trägt", () => {
    expect(saveFn).toContain("p_swap");
    for (const fn of ["public.seller_update_purchase(",
                      "public.seller_set_purchase_item_sky(",
                      "public.seller_remove_purchase_item(",
                      "public.seller_add_purchase_item("]) {
      expect(saveFn, fn).toContain(fn);
    }
  });

  it("der Wechsel geht durch 0054 und schreibt nicht selbst", () => {
    expect(saveFn).not.toMatch(/update\s+public\.purchase_items/);
    expect(saveFn).not.toMatch(/delete\s+from/);
    for (const tabelle of ["inventory_movements", "shop_inventory",
                           "purchase_receipts", "orderbook_name_mappings"]) {
      expect(saveFn, tabelle).not.toContain(tabelle);
    }
  });

  it("p_remember ist beim Wechsel immer false — keine Namensregel wird gelernt", () => {
    expect(saveFn).toContain("v_sid, v_sky, false");
    expect(saveFn).not.toContain("v_sid, v_sky, true");
  });

  it("ein Wechsel auf dieselbe SKY-ID schreibt auch im Server nicht", () => {
    expect(saveFn).toContain("v_current is distinct from v_sky");
  });

  it("wechseln kommt VOR entfernen und entfernen vor hinzufügen", () => {
    const wechsel = saveFn.indexOf("public.seller_set_purchase_item_sky(");
    const weg = saveFn.indexOf("public.seller_remove_purchase_item(");
    const dazu = saveFn.indexOf("public.seller_add_purchase_item(");
    expect(wechsel).toBeGreaterThan(-1);
    expect(wechsel).toBeLessThan(weg);
    expect(weg).toBeLessThan(dazu);
  });

  it("die Position muss zu DIESEM Einkauf gehören", () => {
    expect(saveFn).toContain("i.purchase_id = p_id");
    expect(saveFn).toContain("does not belong to purchase");
  });

  it("Betreibertor, Sperre und Version wie in 0126", () => {
    expect(saveFn).toContain("can_operate_active_seller()");
    expect(saveFn).toContain("for update");
    expect(saveFn).toContain("PT409");
    const tor = saveFn.indexOf("can_operate_active_seller()");
    expect(tor).toBeLessThan(saveFn.indexOf("public.seller_set_purchase_item_sky("));
  });

  it("security definer mit leerem search_path", () => {
    expect(exec).toContain("security definer");
    expect(exec).toContain("set search_path = ''");
  });
});

describe("der DROP und was er mitnimmt", () => {
  it("die Fünf-Parameter-Fassung wird gelöscht, OHNE cascade", () => {
    expect(exec).toContain("drop function if exists public.seller_save_purchase_edit(");
    expect(exec).toContain("bigint, jsonb, jsonb, bigint[], timestamptz)");
    expect(exec).not.toMatch(/drop function[\s\S]{0,200}cascade/);
  });

  it("die Rechte werden danach NEU gesetzt — das drop nimmt den ACL mit", () => {
    expect(exec).toContain("revoke all on function public.seller_save_purchase_edit(");
    expect(exec).toContain("from public, anon;");
    expect(exec).toContain("to authenticated;");
    const drop = exec.indexOf("drop function if exists public.seller_save_purchase_edit(");
    expect(drop).toBeLessThan(exec.indexOf("revoke all on function"));
  });

  it("und die Nachbedingung prüft beides, nicht nur den grant", () => {
    expect(exec).toContain("anon darf seller_save_purchase_edit ausfuehren");
    expect(exec).toContain("das drop hat den ACL mitgenommen");
    expect(exec).toContain("PUBLIC hat EXECUTE");
    expect(exec).toContain("aclexplode");
  });

  it("genau EINE Fassung bleibt — zwei wären der Mehrdeutigkeitsfehler", () => {
    expect(exec).toContain("ist mehrfach ueberladen");
    expect(exec).toContain("die Fuenf-Parameter-Fassung existiert noch");
  });

  it("0126 wird nicht angefasst", () => {
    const alt = migrationSource("0126_purchase_item_edit.sql");
    expect(alt).toContain("p_expected_updated_at timestamptz default null");
    expect(alt).not.toContain("p_swap");
  });
});

describe("der bestehende Client muss weiter speichern können", () => {
  /*
   * DER PUNKT, AN DEM ES HÄNGT. PostgREST löst einen RPC über die NAMEN der
   * übergebenen Argumente auf. Ein Aufruf mit fünf Namen trifft die neue
   * Funktion genau dann, wenn diese fünf Namen und Typen unverändert sind und
   * der sechste einen Default hat.
   */
  const SIGNATUR = ["p_id", "p_fields", "p_add", "p_remove",
                    "p_expected_updated_at", "p_swap"];

  it("die ersten fünf Namen stehen in derselben Reihenfolge wie in 0126", () => {
    const stelle = (name: string) => exec.indexOf(`  ${name} `);
    const gefunden = SIGNATUR.filter((n) => stelle(n) > -1);
    expect(gefunden).toEqual(SIGNATUR);
    const positionen = SIGNATUR.map(stelle);
    expect(positionen).toEqual([...positionen].sort((a, b) => a - b));
  });

  it("p_swap ist der SECHSTE Parameter und hat einen Default", () => {
    expect(exec).toMatch(/p_swap\s+jsonb\s+default\s+'\[\]'::jsonb/);
  });

  it("die Typen der ersten fünf sind unverändert", () => {
    expect(exec).toMatch(/p_id\s+bigint/);
    expect(exec).toMatch(/p_fields\s+jsonb\s+default/);
    expect(exec).toMatch(/p_add\s+jsonb\s+default/);
    expect(exec).toMatch(/p_remove\s+bigint\[\]\s+default/);
    expect(exec).toMatch(/p_expected_updated_at\s+timestamptz\s+default\s+null/);
  });

  it("und die Nachbedingung prüft Namen, Zahl, Defaults und Typen einzeln", () => {
    expect(exec).toContain("p.proargnames");
    expect(exec).toContain("die Parameternamen sind nicht die erwarteten");
    expect(exec).toContain("p.pronargdefaults");
    expect(exec).toContain("nicht fuenf der sechs Parameter haben einen Default");
    /*
     * „EINZELN" HEISST POSITIONSWEISE, UND HIER STAND DAS GEGENTEIL.
     *
     * Diese Zeile verlangte den Ganzarray-Vergleich — also genau die Form, an
     * der der erste Anwendungsversuch abgebrochen ist. Ein Test, der eine
     * kaputte Implementierung festnagelt, schützt nichts; er hält sie fest.
     */
    expect(exec).toContain("p.proargtypes[0]::regtype");
    expect(exec).not.toContain("p.proargtypes::oid[]");
    expect(exec).toContain("die Argumenttypen sind nicht die erwarteten");
  });

  it("p_swap ist auch im Aufrufer optional — items.swap darf fehlen", () => {
    expect(ACTIONS).toContain("swap?: { item_id: number; sky_id: string }[]");
    expect(ACTIONS).toContain("items.swap ?? []");
  });

  it("die Rückgabe behält die bisherigen Schlüssel und ergänzt nur", () => {
    for (const key of ["'updated_at'", "'added'", "'removed'", "'swapped'", "'unchanged'"]) {
      expect(saveFn, key).toContain(key);
    }
  });
});

describe("0127 lockert keine Regel und prüft das selbst", () => {
  it("keine der gerufenen Funktionen wird ersetzt", () => {
    for (const fn of ["seller_update_purchase", "seller_set_purchase_item_sky",
                      "seller_add_purchase_item", "seller_remove_purchase_item",
                      "purchase_receipt_fingerprint", "seller_orderbook_ledger",
                      "purchase_items_touch_purchase"]) {
      expect(exec, fn).not.toContain(`create or replace function public.${fn}(`);
    }
  });

  it("der Lagerschutz in 0054 und 0064 wird als vorhanden geprüft", () => {
    expect(exec).toContain("der Lagerschutz in seller_set_purchase_item_sky ist verschwunden");
    expect(exec).toContain("der Lagerschutz in seller_remove_purchase_item ist verschwunden");
  });

  it("und der Erhaltungskommentar aus 0054 auch — ID, Position, Herkunft", () => {
    expect(exec).toContain("Deliberately untouched");
    const sky = code(latestFunction("seller_set_purchase_item_sky").body);
    expect(sky).not.toMatch(/update\s+public\.purchase_items[\s\S]{0,400}position\s*=/);
  });

  it("der Trigger aus 0126 wird vorausgesetzt, nicht neu gebaut", () => {
    expect(exec).toContain("purchase_items_touch_purchase_trg");
    expect(exec).not.toContain("create trigger purchase_items_touch_purchase_trg");
  });

  it("der Rumpf wird kommentarfrei geprüft — ein Kommentar ist kein Code", () => {
    expect(exec).toContain("regexp_replace(v_def,  $re$/\\*.*?\\*/$re$, '', 'g')");
    expect(exec).toContain("regexp_replace(v_code, '--.*', '', 'gn')");
  });

  it("sie liegt lückenlos hinter 0126", () => {
    expect(FILE.slice(0, 4)).toBe("0127");
  });
});

/* ==========================================================================
 * 5. Der Fünf-Argument-Aufruf, aus beiden Dateien hergeleitet
 * ======================================================================== */

/**
 * Die Parameterliste einer Funktion aus dem Quelltext der Migration.
 *
 * WARUM NICHT EINFACH `toContain`. Die Frage „speichert der bestehende Client
 * nach `0127` weiter?" ist keine Textfrage, sondern eine über eine Auflösung:
 * PostgREST schickt NAMEN, PostgreSQL sucht eine Funktion, zu der diese Namen
 * passen und deren übrige Parameter einen Default haben. Also wird die Liste
 * geparst und die Auflösung nachgerechnet.
 */
function parameters(quelle: string, name: string) {
  const start = quelle.indexOf(`create or replace function public.${name}(`);
  if (start === -1) throw new Error(`${name} wird in dieser Datei nicht angelegt`);
  const auf = quelle.indexOf("(", start);
  const zu = quelle.indexOf(")", auf);
  return quelle.slice(auf + 1, zu).split(",").map((roh) => {
    const teil = roh.trim().split(/\s+/);
    const hatDefault = /\bdefault\b/i.test(roh);
    const typ = teil.slice(1).join(" ").replace(/\s*default\s.*$/i, "").trim();
    return { name: teil[0], typ, hatDefault };
  });
}

describe("ein Aufruf mit FÜNF benannten Argumenten löst weiter auf", () => {
  const alt = parameters(migrationSource("0126_purchase_item_edit.sql"),
                         "seller_save_purchase_edit");
  const neu = parameters(sql, "seller_save_purchase_edit");
  /* Genau das, was der 0126-Client schickt — fünf Namen, kein p_swap. */
  const GESENDET = alt.map((p) => p.name);

  it("die alte Fassung hatte fünf Parameter, die neue sechs", () => {
    expect(alt).toHaveLength(5);
    expect(neu).toHaveLength(6);
  });

  it("jeder gesendete Name existiert in der neuen Fassung", () => {
    for (const name of GESENDET) {
      expect(neu.map((p) => p.name), name).toContain(name);
    }
  });

  it("und mit UNVERÄNDERTEM Typ — ein anderer Typ wäre eine andere Funktion", () => {
    for (const p of alt) {
      const n = neu.find((q) => q.name === p.name);
      expect(n, p.name).toBeDefined();
      expect(n!.typ, p.name).toBe(p.typ);
    }
  });

  it("in derselben Reihenfolge — p_swap hängt hinten an", () => {
    expect(neu.slice(0, 5).map((p) => p.name)).toEqual(GESENDET);
    expect(neu[5].name).toBe("p_swap");
  });

  it("JEDER nicht gesendete Parameter hat einen Default — sonst scheitert der Aufruf", () => {
    for (const p of neu) {
      if (GESENDET.includes(p.name)) continue;
      expect(p.hatDefault, p.name).toBe(true);
    }
  });

  it("und es gibt genau eine Fassung, zu der er passen kann", () => {
    const anlagen = sql.match(/create or replace function public\.seller_save_purchase_edit\(/g);
    expect(anlagen).toHaveLength(1);
    expect(sql).toContain("die Fuenf-Parameter-Fassung existiert noch");
    expect(sql).toContain("ist mehrfach ueberladen");
  });

  /*
   * UND WAS DIESER TEST NICHT ZEIGT.
   *
   * Dass PostgREST die Auflösung wirklich so vornimmt, zeigt erst ein
   * Speichern aus einem Client ohne `p_swap`. Diese Zusicherung steht als
   * Schreibfall in der Anleitung — hier werden nur ihre Voraussetzungen
   * geprüft, und der Postflight prüft dieselben am laufenden Server.
   */
  it("der Postflight prüft dieselben Voraussetzungen am Server", () => {
    const post = readFileSync("supabase/checks/0127_postflight.sql", "utf8");
    expect(post).toContain("p_id, p_fields, p_add, p_remove, p_expected_updated_at, p_swap");
    expect(post).toContain("FUENF der sechs haben einen Default");
    expect(post).toContain("genau EINE Overload");
    expect(post).toContain("die Fuenf-Parameter-Fassung ist weg");
  });
});

/* ==========================================================================
 * 6. Der Abbruch des ersten Anwendungsversuchs
 * ======================================================================== */

describe("0127 vergleicht die Argumenttypen positionsweise", () => {
  /*
   * DER FEHLER, DEN DIESER BLOCK FESTHÄLT.
   *
   * Der erste Versuch brach auf Staging ab:
   *
   *   ERROR: P0001: 0127 Abbruch: die Argumenttypen sind nicht die erwarteten
   *   CONTEXT: PL/pgSQL function inline_code_block line 50 at RAISE
   *
   * Die Signatur war richtig — die drei Prüfungen davor (Namen, Zahl,
   * Defaults) waren durchgelaufen. Falsch war der Vergleich: der ganze
   * `proargtypes`-Vektor nach `oid[]` gecastet und gegen ein
   * `array[...]`-Literal gestellt. Der Vektor ist nullbasiert, das Literal
   * einsbasiert, und die Array-Gleichheit vergleicht die Grenzen mit — also
   * `false` bei identischen Elementen.
   *
   * Der repository-weite Wächter dagegen steht in `fingerprint-rights.test.ts`.
   * Hier steht, was 0127 stattdessen tut.
   */
  it("jede der sechs Positionen wird einzeln geprüft", () => {
    for (const [i, typ] of [["0", "bigint"], ["1", "jsonb"], ["2", "jsonb"],
                            ["3", "bigint[]"], ["4", "timestamptz"],
                            ["5", "jsonb"]] as const) {
      expect(exec, `Position ${i}`)
        .toContain(`p.proargtypes[${i}]::regtype = '${typ}'::regtype`);
    }
  });

  it("die Zählung beginnt bei 0 — proargtypes ist ein oidvector", () => {
    expect(exec).toContain("proargtypes[0]::regtype");
    expect(exec).not.toContain("proargtypes[6]::regtype");
  });

  it("und die Parameterzahl steht in derselben Bedingung", () => {
    const stelle = exec.indexOf("p.pronargs = 6");
    expect(stelle).toBeGreaterThan(-1);
    expect(stelle).toBeLessThan(exec.indexOf("p.proargtypes[0]::regtype"));
  });

  it("eine fehlende Zeile bricht ab und endet nicht in NULL", () => {
    /* `not (select …)` auf einer leeren Menge wäre NULL und damit kein
       Abbruch — die Prüfung würde stillschweigend durchlassen. */
    expect(exec).toMatch(/if not coalesce\(\(select p\.pronargs = 6/);
    expect(exec).toContain("), false) then");
  });

  it("und die Meldung sagt, was wirklich dasteht", () => {
    expect(exec).toContain("die Argumenttypen sind nicht die erwarteten (%)");
    expect(exec).toContain("pg_get_function_arguments(v_oid)");
  });

  it("die Diagnose zum Abbruch liegt in supabase/checks", () => {
    const diag = readFileSync("supabase/checks/0127_signature_diagnosis.sql", "utf8");
    /* Sie stellt den Fehlgriff an der heutigen Signatur nach … */
    expect(diag).toContain("Ganzarray-Vergleich der RICHTIGEN Signatur");
    expect(diag).toContain("array_lower");
    /* … und beantwortet die Rückrollfrage. */
    expect(diag).toContain("die Rueckrollung ist vollstaendig");
    expect(diag).toContain("'VOR_0127'");
    /* Nur lesend. */
    expect(diag).not.toMatch(/\b(insert into|update public|delete from|create |drop |alter |grant |revoke )/);
    expect(diag).not.toContain("set role");
    expect(diag).not.toContain("set_config(");
  });
});
