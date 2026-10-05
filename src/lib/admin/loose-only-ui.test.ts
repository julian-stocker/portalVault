import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  CONDITIONS,
  OPERATIVE_CONDITION,
  isCondition,
  isOperativeCondition,
} from "./inventory-model";
import { V1_CONDITION } from "../shop/offer";
import { de } from "../i18n/de";

/**
 * Die Lageroberfläche nach `0108` — loose-only.
 *
 * WAS HIER GEPRÜFT WIRD. Zwei Dinge, und sie hängen zusammen: dass die
 * Oberfläche keine Aktion mehr anbietet, von der die Datenbank schon weiß,
 * dass sie sie ablehnt — und dass sie historische OVP-Daten weiterhin
 * **anzeigt**. Eine Zeile verstecken wäre keine Vereinfachung, sondern ein
 * Verlust: die acht Staging-Positionen sind echt, und ein Bildschirm, der
 * „Lose" über sie schreibt, lügt über die Vergangenheit.
 *
 * Die Komponenten werden am Quelltext geprüft. Sie hängen an React, an
 * `next/navigation` und an Server Actions; was hier zählt, ist ohnehin, WELCHE
 * Steuerung unter welcher Bedingung überhaupt im Baum landet.
 */

/** Ausführbarer Code: ohne Block- und Zeilenkommentare und ohne JSX-Kommentare. */
function codeOf(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//"))
    .join("\n");
}

const VIEW = "src/components/admin/inventory-view.tsx";
const CARD = "src/components/admin/inventory-card.tsx";
const MODEL = "src/lib/admin/inventory-model.ts";

const view = codeOf(VIEW);
const card = codeOf(CARD);
const model = codeOf(MODEL);

// ---------------------------------------------------------------------------
// 1. Eine Regel, drei Ausdrücke — und sie stimmen überein
// ---------------------------------------------------------------------------

describe("die Loose-only-Regel hat eine Quelle", () => {
  it("OPERATIVE_CONDITION ist V1_CONDITION, keine vierte Kopie", () => {
    expect(OPERATIVE_CONDITION).toBe(V1_CONDITION);
    expect(model).toContain('import { V1_CONDITION } from "@/lib/shop/offer"');
    expect(model).toContain("export const OPERATIVE_CONDITION: Condition = V1_CONDITION;");
  });

  it("und beide sagen dasselbe wie v1_sale_condition() in der Datenbank", () => {
    /*
     * Der dritte Ausdruck derselben Regel liegt in SQL. Drei Orte sind einer
     * zu viel, aber der Client kann keine Funktion aufrufen, bevor er
     * rendert — also wird die Übereinstimmung geprüft statt behauptet.
     */
    const sql = readFileSync("supabase/migrations/0028_v1_loose_only_commerce.sql", "utf8");
    expect(sql).toContain("select 'loose'::text");
    expect(OPERATIVE_CONDITION).toBe("loose");
  });

  it("isOperativeCondition trennt operativ von historisch", () => {
    expect(isOperativeCondition("loose")).toBe(true);
    expect(isOperativeCondition("boxed")).toBe(false);
    expect(isOperativeCondition(null)).toBe(false);
    expect(isOperativeCondition(undefined)).toBe(false);
  });

  it("CONDITIONS bleibt — historische Zeilen müssen lesbar bleiben", () => {
    // Ausdrücklich NICHT entfernt: ein alter Bestellposten, eine importierte
    // Arbeitsmappenzeile und die acht Staging-Positionen sind echt `boxed`.
    expect([...CONDITIONS]).toEqual(["loose", "boxed"]);
    expect(isCondition("boxed")).toBe(true);
  });

  it("und die Übersetzung für OVP bleibt auch", () => {
    expect(de.inventory.conditionBoxed).toBe("OVP");
    expect(de.inventory.conditionLoose).toBe("Lose");
  });
});

// ---------------------------------------------------------------------------
// 2. Neue Positionen: ausschließlich loose
// ---------------------------------------------------------------------------

describe("die Lagerübersicht bietet nur noch die operative Position an", () => {
  it("der Vorschlag filtert auf OPERATIVE_CONDITION", () => {
    expect(view).toContain("!held.has(`${figure.skyId}:${OPERATIVE_CONDITION}`)");
    expect(view).toContain("condition: OPERATIVE_CONDITION as Condition");
  });

  it("CONDITIONS kommt in der Übersicht nicht mehr vor", () => {
    /*
     * Die eine Zeile, die die acht OVP-Positionen auf Staging erzeugt hat:
     * `CONDITIONS.filter((condition) => !held.has(...))` bot für jede Figur
     * ZWEI neue Positionen an.
     */
    expect(view).not.toContain("CONDITIONS");
    expect(view).not.toContain("CONDITIONS.filter");
  });

  it("und der Vorschlag ist nicht mehr nach Condition verzweigt", () => {
    // Zwei Zweige für eine Möglichkeit wären eine Lüge über die Auswahl.
    expect(view).not.toContain("conditionBoxed");
    expect(view).toContain("de.inventory.conditionLoose");
  });

  it("legt pro Figur höchstens einen Vorschlag an", () => {
    // `.filter(...).map(...)` statt `.flatMap(...)`: eine Figur, ein Eintrag.
    expect(view).not.toContain(".flatMap((figure)");
  });
});

// ---------------------------------------------------------------------------
// 3. Historische Positionen: sichtbar, aber nicht bedienbar
// ---------------------------------------------------------------------------

describe("die Karte einer historischen OVP-Position", () => {
  it("berechnet, ob die Position operativ ist", () => {
    expect(card).toContain('import { isOperativeCondition, type InventoryPosition }');
    expect(card).toContain("const operative = isOperativeCondition(position.condition);");
  });

  it("zeigt das Etikett weiterhin — auch OVP", () => {
    // Die Vergangenheit wird benannt, nicht umgeschrieben.
    expect(card).toContain("position.condition === \"loose\" ? copy.conditionLoose : copy.conditionBoxed");
    expect(card).toContain("{` · ${conditionLabel}`}");
  });

  it("bietet den Listungsknopf nur operativ an", () => {
    const at = card.indexOf("{operative ? (");
    expect(at).toBeGreaterThan(-1);
    // Der Knopf hängt an `save({ isListed: … })`, und das führt zu
    // set_shop_listing — seit 0108 für OVP abgelehnt.
    expect(card).toContain("save({ isListed: !position.isListed })");
    const listingBlock = card.slice(at, card.indexOf("</div>", at));
    expect(listingBlock).toContain("onClick={() => save({ isListed: !position.isListed })}");
    expect(listingBlock).toContain("</button>");
    // Im historischen Fall bleibt derselbe Zustand als Text stehen.
    expect(listingBlock).toContain("{position.isListed ? copy.listed : copy.notListed}");
  });

  it("bietet die Bestandsschritte nur operativ an", () => {
    expect(card).toMatch(/\{operative \? \(\s*<StockStepper/);
    // Die Zahl bleibt sichtbar.
    expect(card).toContain("formatNumber(position.quantity)");
  });

  it("bietet den Preiseditor nur operativ an", () => {
    expect(card).toMatch(/\{operative \? \(\s*<PriceEditor/);
    // Der Wert bleibt sichtbar.
    expect(card).toContain('position.effectivePrice === null ? "–" : formatPrice(position.effectivePrice)');
  });

  it("sagt einmal, warum nichts zu bedienen ist", () => {
    expect(card).toContain("{!operative ? (");
    expect(card).toContain("copy.historicalCondition");
    expect(card).toContain("copy.historicalConditionHint");
    expect(de.inventory.historicalCondition).toBe("Historische OVP-Position");
    expect(de.inventory.historicalConditionHint).toContain("ausschließlich lose");
    expect(de.inventory.historicalConditionHint).toContain("als Beleg");
  });

  it("gated das LESEN nicht", () => {
    /*
     * Die Historie einer OVP-Position bleibt abrufbar — `loadCardHistory`
     * liest, und 0108 schließt nur Schreibwege. Eine Zeile ohne ihre
     * Geschichte wäre eine Zahl ohne Herkunft.
     */
    const history = card.slice(card.indexOf("loadCardHistory"));
    expect(history.slice(0, 200)).not.toContain("operative");
    expect(card).toContain("<StockLedger");
  });
});

// ---------------------------------------------------------------------------
// 4. Keine tote Oberfläche
// ---------------------------------------------------------------------------

describe("keine Aktion, die 0108 ablehnen würde", () => {
  const writers = [
    ["inventory-view.tsx", view],
    ["inventory-card.tsx", card],
  ] as const;

  for (const [name, code] of writers) {
    it(`${name} übergibt nie ein boxed-Literal an einen Schreibweg`, () => {
      expect(code).not.toContain('condition: "boxed"');
      expect(code).not.toContain("condition: 'boxed'");
      expect(code).not.toContain('p_condition: "boxed"');
    });
  }

  it("die Übersicht kennt nur einen Weg zu einer neuen Position", () => {
    // `StockDialog` ist der einzige, und er bekommt die operative Condition.
    expect(view).toContain("<StockDialog");
    const at = view.indexOf("<StockDialog");
    const block = view.slice(at, view.indexOf("/>", at));
    expect(block).toContain("condition={condition}");
  });

  it("die drei Steuerungen der Karte hängen alle an `operative`", () => {
    // Drei `{operative ? (` plus der erklärende `{!operative ? (`.
    expect((card.match(/\{operative \? \(/g) ?? []).length).toBe(3);
    expect((card.match(/\{!operative \? \(/g) ?? []).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 5. Was ausdrücklich NICHT geändert wurde
// ---------------------------------------------------------------------------

describe("historische Anzeige außerhalb des Lager-Workflows bleibt", () => {
  it("die Bestellpositionen zeigen OVP weiterhin", () => {
    const orders = codeOf("src/components/admin/order-lines-table.tsx");
    expect(orders).toContain('value === "boxed" ? copy.conditionBoxed : copy.conditionLoose');
  });

  it("die Kundenansicht einer alten Bestellung zeigt OVP weiterhin", () => {
    const own = codeOf("src/app/(app)/account/orders/[orderNumber]/page.tsx");
    expect(own).toContain('line.condition === "boxed" ? "OVP" : "Lose"');
  });

  it("positionKey trägt die Condition weiter", () => {
    // Historische Schlüssel und Zuordnungen bleiben, wie sie sind.
    const key = codeOf("src/lib/admin/position-key.ts");
    expect(key).toContain("return `${skyId}:${condition}`;");
  });
});
