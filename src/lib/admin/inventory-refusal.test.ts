/**
 * WARUM EINE BEWEGUNG ABGELEHNT WIRD, UND DASS DER GRUND STIMMT (0093).
 *
 * `apply_inventory_movement` hatte einen Wächter und einen Satz. Der Wächter
 * — `quantity + p_delta >= reserved` als WHERE-Klausel des UPDATE — war und
 * ist richtig: er entscheidet ohne Fenster zwischen Lesen und Schreiben, und
 * er deckt beide Verbote zugleich ab, weil `reserved` nie negativ ist.
 *
 * Der Satz deckte dagegen zwei Lagen ab, die nichts miteinander zu tun haben:
 * „es ist nichts da" und „es ist da, aber es gehört einer Bestellung". Weil
 * darin das Wort `reserved` stand, übersetzte das Orderbuch jede Ablehnung in
 * „für eine SkyIsles-Bestellung reserviert" — auch für SKY-0428, für die es
 * weder eine Lagerzeile noch irgendwo eine Reservierung gab.
 *
 * WAS HIER GEPRÜFT WIRD, UND WAS NICHT
 *
 * Kein Test in dieser Datei spricht mit einer Datenbank. Geprüft wird der
 * VERTRAG: die Entscheidung ist einmal als Funktion ausgeschrieben, die vier
 * Fälle laufen dagegen, und der SQL-Text muss genau die Prädikate enthalten,
 * aus denen diese Funktion besteht. Weicht die Migration ab, fällt sie hier
 * auf — das ist dieselbe Spiegelung, mit der `saleItemClosed()` an
 * `sale_item_is_closed()` hängt.
 *
 * Echte Buchungen gegen Staging wären der stärkere Beweis und sind bewusst
 * unterblieben: die drei Fälle, die durchgehen, wären echte Lagerbewegungen
 * auf echten Beständen.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { code, latestFunction } from "@/test-support/migrations";

const APPLY = latestFunction("apply_inventory_movement");
const SQL = code(APPLY.body);
const ACTIONS = readFileSync("src/lib/orderbook/sales-actions.ts", "utf8");

/**
 * Die Entscheidung der Funktion, einmal ausgeschrieben.
 *
 * `guard` ist die WHERE-Klausel; alles darunter läuft erst, wenn sie schon
 * abgelehnt hat, und wählt nur noch die Begründung.
 */
type Outcome =
  | { ok: true; quantity: number }
  | { ok: false; reason: "insufficient" | "reserved" };

function applyMovement(
  position: { quantity: number; reserved: number }, delta: number,
): Outcome {
  const after = position.quantity + delta;
  if (after >= position.reserved) return { ok: true, quantity: after };
  return { ok: false, reason: after < 0 ? "insufficient" : "reserved" };
}

describe("a refused movement names its cause", () => {
  it("0 on hand, nothing reserved, −1 — there is simply none", () => {
    expect(applyMovement({ quantity: 0, reserved: 0 }, -1))
      .toEqual({ ok: false, reason: "insufficient" });
  });

  it("1 on hand, 1 reserved, −1 — there is one, and it is spoken for", () => {
    expect(applyMovement({ quantity: 1, reserved: 1 }, -1))
      .toEqual({ ok: false, reason: "reserved" });
  });

  it("2 on hand, 1 reserved, −1 — books, and leaves the reservation whole", () => {
    expect(applyMovement({ quantity: 2, reserved: 1 }, -1))
      .toEqual({ ok: true, quantity: 1 });
  });

  it("1 on hand, nothing reserved, −1 — books down to zero", () => {
    expect(applyMovement({ quantity: 1, reserved: 0 }, -1))
      .toEqual({ ok: true, quantity: 0 });
  });

  /**
   * DIE BEIDEN VERBOTE, DIE NICHT GELOCKERT WERDEN DÜRFEN.
   *
   * Über den ganzen kleinen Zahlenraum: nichts fällt unter null, nichts
   * fällt unter `reserved`, und keine Reservierung wird aufgezehrt.
   */
  it("never goes below zero and never below the reservation", () => {
    for (let quantity = 0; quantity <= 4; quantity++) {
      for (let reserved = 0; reserved <= quantity; reserved++) {
        for (const delta of [-4, -3, -2, -1, 1, 2]) {
          const result = applyMovement({ quantity, reserved }, delta);
          if (!result.ok) continue;
          expect(result.quantity, `${quantity}/${reserved} ${delta}`)
            .toBeGreaterThanOrEqual(0);
          expect(result.quantity, `${quantity}/${reserved} ${delta}`)
            .toBeGreaterThanOrEqual(reserved);
        }
      }
    }
  });

  it("an accepted movement is exactly the one the guard would accept", () => {
    for (let quantity = 0; quantity <= 4; quantity++) {
      for (let reserved = 0; reserved <= quantity; reserved++) {
        for (const delta of [-3, -2, -1, 1, 3]) {
          const result = applyMovement({ quantity, reserved }, delta);
          expect(result.ok, `${quantity}/${reserved} ${delta}`)
            .toBe(quantity + delta >= reserved);
        }
      }
    }
  });
});

/**
 * UND DIE MIGRATION SAGT DASSELBE.
 *
 * Jede Zeile oben ist nur so viel wert wie ihre Entsprechung im SQL. Diese
 * Gruppe hält die Spiegelung fest — und den Teil der Funktion, der sich
 * ausdrücklich NICHT ändern durfte.
 */
describe("the applied function matches that contract", () => {
  it("is 0093 that defines it now", () => {
    expect(APPLY.file).toBe("0093_movement_refusal_names_its_cause.sql");
  });

  it("keeps the guard in the WHERE clause, untouched", () => {
    expect(SQL).toContain("update public.shop_inventory");
    expect(SQL).toContain("set quantity = quantity + p_delta");
    expect(SQL).toContain("where id = v_inventory_id");
    expect(SQL).toContain("and quantity + p_delta >= reserved");
    // Keine Entscheidung vor dem Schreiben, also auch kein Fenster.
    expect(SQL.indexOf("get diagnostics v_updated = row_count"))
      .toBeGreaterThan(SQL.indexOf("and quantity + p_delta >= reserved"));
  });

  it("splits the refusal into the two causes, and no more", () => {
    expect(SQL).toContain("if v_quantity + p_delta < 0 then");
    expect(SQL).toContain("'insufficient stock for % / %");
    expect(SQL).toContain("'movement would consume reserved stock for % / %");
    expect(SQL).not.toContain("below its reserved quantity");
    // Beide bleiben derselbe SQLSTATE wie die eine Ablehnung vorher.
    const refusals = [...SQL.matchAll(/raise exception[\s\S]*?using errcode = '([a-z_]+)'/g)]
      .map((m) => m[1]);
    expect(refusals.filter((c) => c === "check_violation").length).toBeGreaterThanOrEqual(3);
  });

  it("reads the numbers it reports from the row it already locked", () => {
    expect(SQL).toContain("for update");
    const refusal = SQL.slice(SQL.indexOf("if v_updated = 0 then"));
    expect(refusal).toContain("select quantity, reserved");
    expect(refusal).toContain("where id = v_inventory_id");
    // Erst nach dem Fehlschlag — es ist eine Begründung, kein zweiter Wächter.
    expect(SQL.indexOf("select quantity, reserved"))
      .toBeGreaterThan(SQL.indexOf("get diagnostics v_updated = row_count"));
  });

  it("leaves signature, security and reach exactly as they were", () => {
    for (const line of [
      "p_sky_id     text", "p_condition  text", "p_delta      integer",
      "p_reason     text", "p_unit_cost  numeric", "p_currency   text",
      "p_note       text", "p_created_by uuid",
      "returns bigint", "language plpgsql", "security definer",
      "set search_path = ''",
    ]) expect(APPLY.body).toContain(line);
    const source = readFileSync(`supabase/migrations/${APPLY.file}`, "utf8");
    expect(source).toContain(
      "revoke all on function public.apply_inventory_movement(text, text, integer, text, numeric, text, text, uuid)\n  from public, anon, authenticated, service_role;");
    // Und niemand bekommt EXECUTE dazu.
    expect(source).not.toContain("grant execute on function public.apply_inventory_movement");
  });

  it("still writes the movement once, in the same transaction", () => {
    expect(SQL).toContain("insert into public.inventory_movements");
    expect(SQL).toContain("returning id into v_movement_id");
    expect((SQL.match(/insert into public\.inventory_movements/g) ?? []).length).toBe(1);
    // Der Insert steht HINTER der Ablehnung: was abgelehnt wird, wird nicht
    // protokolliert, und der Bestand bleibt, wie er war.
    expect(SQL.indexOf("insert into public.inventory_movements"))
      .toBeGreaterThan(SQL.indexOf("if v_updated = 0 then"));
    expect(SQL).toContain("on conflict (sky_id, condition) do nothing");
  });
});

/**
 * WAS DER BETREIBER DAVON ZU LESEN BEKOMMT.
 *
 * Ohne Figurennamen, und das mit Absicht: an dieser Stelle liegt die
 * Positions-ID vor und sonst nichts, und eine zweite Datenbankabfrage nur
 * für einen Satz ist sie nicht wert.
 */
describe("the operator gets the right sentence", () => {
  it("maps each cause to its own German sentence", () => {
    expect(ACTIONS).toContain(
      'if (text.includes("insufficient stock for")) return copy.errors.noStock;');
    expect(ACTIONS).toContain(
      'if (text.includes("would consume reserved stock")) return copy.errors.reserved;');
  });

  it("says what is true, and nothing more", async () => {
    const { de } = await import("@/lib/i18n/de");
    const errors = de.business.sales.errors;
    expect(errors.noStock)
      .toBe("Dieser Artikel ist aktuell nicht auf Lager und kann nicht ausgebucht werden.");
    expect(errors.reserved).toBe(
      "Dieser Artikel ist aktuell für eine SkyIsles-Bestellung reserviert "
      + "und kann nicht für diesen Verkauf ausgebucht werden.");
    // Der Satz ohne Bestand behauptet keine Bestellung — der Fehler, der 0093 ausgelöst hat.
    expect(errors.noStock).not.toContain("Bestellung");
    expect(errors.noStock).not.toContain("reserviert");
  });

  /**
   * DER ALTE SATZ BLEIBT ZUGEORDNET, SOLANGE IRGENDWO 0093 FEHLT.
   *
   * Production ist zum Zeitpunkt dieser Änderung nicht migriert. Fiele das
   * Muster weg, landete dort genau diese Ablehnung in „Das hat nicht
   * geklappt." — eine Meldung weniger, nicht mehr.
   */
  it("still catches the pre-0093 wording, without claiming a reservation", async () => {
    const { de } = await import("@/lib/i18n/de");
    expect(ACTIONS).toContain(
      'if (text.includes("below its reserved")) return copy.errors.stockUnavailable;');
    const fallback = de.business.sales.errors.stockUnavailable;
    expect(fallback).toContain("nicht verfügbar");
    // Mehrdeutiger Anlass, mehrdeutige Auskunft — aber keine falsche.
    expect(fallback).toContain("oder");
  });
});
