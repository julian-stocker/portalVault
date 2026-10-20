/**
 * ZUSTAND UND LIEFERUMFANG SIND ZWEI EIGENSCHAFTEN (0139, ADR-0129).
 *
 * Die Festlegung des Betreibers vom 2026-10-20, und sie hat eine scharfe
 * Kante: für ein Spiel heißt `loose` **Spielmedium ohne Originalhülle**.
 * Daraus folgt, dass „mit Originalhülle" und `loose` einander
 * widersprechen — und genau das wird hier geprüft, in beiden Fassungen:
 * im TypeScript-Vokabular und im CHECK der Tabelle.
 */
import { describe, expect, it } from "vitest";

import {
  DELIVERY_SCOPES, GAME_SCOPES, PORTAL_SCOPES,
  deliveryScopeLabel, isDeliveryScope, scopeFitsCondition, scopesFor,
} from "./delivery-scope.ts";
import { code, latestFunction, migrationSource } from "@/test-support/migrations";
import { de } from "@/lib/i18n/de";

const M139 = migrationSource("0139_accessory_sale_release.sql");

/* ===================================================================== */
describe("1. dasselbe Vokabular in SQL und in TypeScript", () => {
  it("die fünf Werte stehen Zeichen für Zeichen im CHECK", () => {
    /* Zwei Listen, die auseinanderlaufen können, sind eine Frage mit zwei
       Antworten. Also wird die eine aus der anderen nachgerechnet. */
    const liste = DELIVERY_SCOPES.map((s) => `'${s}'`).join(", ");
    expect(code(M139)).toContain(`check (delivery_scope is null or delivery_scope in\n`
      + `           (${liste}))`);
  });

  it("drei für Spiele, zwei für Portale, nichts für eine Figur", () => {
    expect([...GAME_SCOPES]).toEqual(["disc_only", "disc_manual", "disc_case"]);
    expect([...PORTAL_SCOPES]).toEqual(["portal_only", "portal_cable"]);
    expect(scopesFor("game")).toEqual(GAME_SCOPES);
    expect(scopesFor("portal")).toEqual(PORTAL_SCOPES);
    /* Eine Figur bekommt eine leere Liste — dort beantwortet `condition`
       die Frage, und ein Auswahlfeld ohne Wirkung wäre eine Falle. */
    expect(scopesFor("figure")).toEqual([]);
    expect(scopesFor("bundle")).toEqual([]);
  });

  it("und die Setzfunktion kennt dieselbe Aufteilung", () => {
    const fn = code(latestFunction("seller_set_delivery_scope").body);
    expect(fn).toContain("v_art = 'game' and p_scope not in "
      + "('disc_only', 'disc_manual', 'disc_case')");
    expect(fn).toContain("v_art = 'portal' and p_scope not in "
      + "('portal_only', 'portal_cable')");
    expect(fn).toContain("v_art = 'figure'");
  });

  it("jeder Wert hat ein deutsches Wort, und keines verspricht mehr als es gibt", () => {
    for (const s of DELIVERY_SCOPES) {
      expect(de.shop.deliveryScopes[s], s).toBeTruthy();
      expect(deliveryScopeLabel(s)).toBe(de.shop.deliveryScopes[s]);
    }
    expect(de.shop.deliveryScopes.disc_only).toBe("Nur Spielmedium");
    expect(de.shop.deliveryScopes.disc_case).toBe("Mit Originalhülle");
    expect(de.shop.deliveryScopes.portal_cable).toBe("Portal mit USB-Kabel");
    /* Kein Wort steht ohne Wert da. */
    expect(Object.keys(de.shop.deliveryScopes).sort()).toEqual([...DELIVERY_SCOPES].sort());
  });

  it("ein unbekannter Wert verschwindet nicht still", () => {
    expect(isDeliveryScope("disc_box")).toBe(false);
    expect(isDeliveryScope(null)).toBe(false);
    /* Er wird gezeigt, wie er ist — lieber ein roher Wert als eine
       stillschweigend weggelassene Produktangabe. */
    expect(deliveryScopeLabel("disc_box")).toBe("disc_box");
    expect(deliveryScopeLabel(null)).toBeNull();
  });
});

/* ===================================================================== */
describe("2. „mit Originalhülle“ und „lose“ widersprechen einander", () => {
  it("die Anwendung bietet es an einer losen Position nicht an", () => {
    expect(scopeFitsCondition("disc_case", "loose")).toBe(false);
    expect(scopeFitsCondition("disc_case", "boxed")).toBe(true);
    /* Alles andere ist mit beidem verträglich. */
    for (const s of DELIVERY_SCOPES) {
      if (s === "disc_case") continue;
      expect(scopeFitsCondition(s, "loose"), s).toBe(true);
    }
  });

  it("und die TABELLE lässt es gar nicht erst zu", () => {
    /* Der CHECK ist die Wahrheit; die Funktion oben erspart nur die
       unverständliche Fehlermeldung. */
    expect(code(M139)).toContain("add constraint shop_inventory_case_is_not_loose");
    expect(code(M139)).toContain(
      "check (delivery_scope is distinct from 'disc_case' or condition <> 'loose')");
  });

  it("die Setzfunktion sagt vorher, was der CHECK sonst hinterher sagt", () => {
    const fn = code(latestFunction("seller_set_delivery_scope").body);
    expect(fn).toContain("p_scope = 'disc_case'");
    expect(fn).toContain("public.v1_sale_condition()");
  });

  it("der ZUSTAND bleibt unverändert — nichts wird umgedeutet", () => {
    /* `condition` behält sein Vokabular und seinen CHECK. `0139` fasst
       weder `v1_sale_condition()` noch `shop_inventory_condition_known`
       an. Für ein Spiel heißt `loose` weiterhin, was es heißt. */
    const text = code(M139);
    expect(text).not.toContain("create or replace function public.v1_sale_condition");
    expect(text).not.toContain("shop_inventory_condition_known");
    expect(text).not.toContain("drop constraint");
    expect(text).not.toContain("set condition =");
  });
});

/* ===================================================================== */
describe("3. ohne Angabe kein Angebot", () => {
  it("das Tor verlangt sie für Zubehör", () => {
    expect(code(latestFunction("is_position_sellable").body))
      .toContain("i.delivery_scope is not null");
  });

  it("für eine Figur verlangt es sie NICHT", () => {
    /* Der Figurenzweig ist der Aufruf von `is_shop_eligible()` und sonst
       nichts — dort steht keine Bedingung über den Lieferumfang. */
    const tor = code(latestFunction("is_position_sellable").body);
    const figurenzweig = tor.slice(0, tor.indexOf("or ("));
    expect(figurenzweig).toContain("public.is_shop_eligible(i.sky_id)");
    expect(figurenzweig).not.toContain("delivery_scope");
  });

  it("die Freigabe lehnt eine Position ohne Angabe ab", () => {
    const fn = code(latestFunction("seller_set_sale_release").body);
    expect(fn).toContain("if p_released and v_umfang is null");
    expect(fn).toContain("has no delivery scope");
  });

  it("das Zurücknehmen geht trotzdem", () => {
    /* `p_released and …` — ein Riegel, der das Abschalten verhindert,
       zeigt in die falsche Richtung. */
    const fn = code(latestFunction("seller_set_sale_release").body);
    for (const riegel of ["v_usk is null", "v_usk = 18", "v_umfang is null"]) {
      const i = fn.indexOf(riegel);
      expect(i, riegel).toBeGreaterThan(-1);
      expect(fn.slice(Math.max(0, i - 60), i), riegel).toContain("p_released");
    }
  });

  it("und das Angebot trägt sie nach draußen", () => {
    const projektion = code(latestFunction("shop_offers").body);
    expect(projektion).toContain("i.delivery_scope");
    expect(projektion).toContain("delivery_scope text");
  });
});

/* ===================================================================== */
describe("4. USK 18 wird nicht freigegeben", () => {
  it("weil es keine Altersprüfung gibt", () => {
    /*
     * § 12 JuSchG: ein Bildträger mit „Keine Jugendfreigabe" darf im
     * Versandhandel nur abgegeben werden, wenn sichergestellt ist, dass
     * kein Minderjähriger ihn erhält. SkyIsles hat weder eine
     * Altersprüfung im Checkout noch ein Ident-Verfahren beim Versand.
     */
    const fn = code(latestFunction("seller_set_sale_release").body);
    expect(fn).toContain("v_usk = 18");
    expect(fn).toContain("no age verification");
  });

  it("die Betriebsdiagnose nennt den Grund", () => {
    expect(code(latestFunction("admin_shop_listing_audit").body))
      .toContain("usk 18 needs age verification");
  });

  it("die anderen vier Stufen sind erlaubt", () => {
    /* Für die Skylanders-Titel ist der Riegel ohne praktische Wirkung —
       sie sind USK 0 und 6 —, und genau deshalb kostet er nichts. */
    expect(code(M139)).toContain("usk_rating in (0, 6, 12, 16, 18)");
    const fn = code(latestFunction("seller_set_sale_release").body);
    for (const stufe of ["= 0", "= 6", "= 12", "= 16"]) {
      expect(fn, stufe).not.toContain(`v_usk ${stufe}`);
    }
  });
});
