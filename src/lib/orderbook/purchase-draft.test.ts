/**
 * Der Einkaufsentwurf: fünf Zustände, Mengen, Aufteilen — und keine Buchung.
 *
 * ZWEI ZUSICHERUNGEN TRAGEN DIESE DATEI.
 *
 * 1. Die Gesamtmenge ändert sich beim Aufteilen NICHT. Drei Einheiten bleiben
 *    drei Einheiten, auch wenn sie danach in zwei Zeilen mit zwei Zuständen
 *    stehen. Jede Prüfung unten, die aufteilt, zählt die Einheiten nach.
 *
 * 2. Nichts hier bucht. `Angekommen` ist nicht `Eingebucht`: eine
 *    Lagerbewegung entsteht ausschliesslich in `seller_book_purchase_item`,
 *    und keiner der fünf Zustände behauptet eine.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { de } from "@/lib/i18n/de";
import { MAX_DRAFT_UNITS, draftUnitCount } from "@/lib/orderbook/draft";
import type { FigureChoice } from "@/lib/orderbook/figure-search";
import {
  DEFAULT_PURCHASE_DRAFT_STATE, PURCHASE_DRAFT_STATES, addPurchaseFigure,
  isPurchaseDraftState, newDraftToken, purchaseDraftPayload, purchaseDraftStateCounts,
  purchaseDraftValue, removePurchaseLine, setPurchaseLineState, setPurchaseQuantity,
  splitPurchaseUnit, type PurchaseDraftLine,
} from "@/lib/orderbook/purchase-draft";
import { latestFunction } from "@/test-support/migrations";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const LIST = read("src/components/business/purchase-draft-list.tsx");
const FORM = read("src/components/business/new-purchase.tsx");
const DRAFT = read("src/lib/orderbook/draft.ts");
const NEW_SALE = read("src/components/business/new-sale.tsx");

const SPYRO: FigureChoice = {
  skyId: "SKY-0001", name: "Spyro", series: "SA", marketPrice: 12.5,
} as FigureChoice;
const GILL: FigureChoice = {
  skyId: "SKY-0002", name: "Gill Grunt", series: "SA", marketPrice: 9,
} as FigureChoice;

const build = (...choices: FigureChoice[]): PurchaseDraftLine[] =>
  choices.reduce<PurchaseDraftLine[]>((lines, c) => addPurchaseFigure(lines, c), []);

describe("die fünf erlaubten Zustände", () => {
  it("sind genau die fünf, die beim Anlegen erlaubt sind", () => {
    expect([...PURCHASE_DRAFT_STATES])
      .toEqual(["ordered", "arrived", "damaged", "missing", "showcase"]);
    expect(DEFAULT_PURCHASE_DRAFT_STATE).toBe("ordered");
  });

  it("und die drei verbotenen sind nicht dabei", () => {
    /*
     * `booked` behauptet eine Lagerbewegung, die nur
     * `seller_book_purchase_item` erzeugt. `reconciled_legacy` behauptet, in
     * der historischen Lagerzahl schon enthalten zu sein. `settled` gehört
     * dem Nicht-Katalog-Pfad aus 0069.
     */
    for (const forbidden of ["booked", "reconciled_legacy", "settled"]) {
      expect(isPurchaseDraftState(forbidden), forbidden).toBe(false);
      expect(PURCHASE_DRAFT_STATES as readonly string[]).not.toContain(forbidden);
    }
  });

  it("jeder hat ein deutsches Etikett, und es ist das bestehende", () => {
    /* Dieselben Worte, die an einer Position eines bestehenden Einkaufs
       stehen — zwei Wörterbücher für dieselbe Spalte wären zwei Stellen, an
       denen es auseinanderläuft. */
    for (const state of PURCHASE_DRAFT_STATES) {
      expect(de.business.orderbook.states[state], state).toBeTruthy();
    }
    expect(de.business.orderbook.states.showcase).toBe("Vitrine");
    expect(de.business.orderbook.states.ordered).toBe("Bestellt");
  });

  it("die Datenbank kennt genau dieselben fünf beim Anlegen", () => {
    const sql = latestFunction("seller_create_purchase_with_items").body;
    expect(sql).toContain("'ordered', 'arrived', 'damaged', 'missing', 'showcase'");
    expect(sql).toContain("is not a state a new purchase item may start in");
  });
});

describe("Zeilen, Mengen und Identität", () => {
  it("eine zweite gleiche Figur erhöht die Menge statt eine Zeile zu bauen", () => {
    const lines = build(SPYRO, SPYRO, SPYRO);
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(3);
    expect(draftUnitCount(lines)).toBe(3);
  });

  it("aber nicht in eine Zeile, die der Betreiber schon beantwortet hat", () => {
    /*
     * Zwei Einheiten als beschädigt markiert, dann kommt eine dritte dazu.
     * Sie ist nicht beschädigt — niemand hat das gesagt —, also bekommt sie
     * ihre eigene Zeile auf `Bestellt`.
     */
    const damaged = setPurchaseLineState(build(SPYRO, SPYRO), 1, "damaged");
    const next = addPurchaseFigure(damaged, SPYRO);
    expect(next).toHaveLength(2);
    expect(next[0].state).toBe("damaged");
    expect(next[0].quantity).toBe(2);
    expect(next[1].state).toBe("ordered");
    expect(next[1].quantity).toBe(1);
    expect(draftUnitCount(next)).toBe(3);
  });

  it("die Zeile ist die Identität, nicht die Figur", () => {
    const lines = splitPurchaseUnit(build(SPYRO, SPYRO), 1);
    expect(lines).toHaveLength(2);
    expect(new Set(lines.map((l) => l.key)).size).toBe(2);
    expect(new Set(lines.map((l) => l.skyId)).size).toBe(1);
  });

  it("Schlüssel werden nie wiederverwendet, auch nach dem Entfernen nicht", () => {
    const two = build(SPYRO, GILL);
    const keys = two.map((l) => l.key);
    const afterRemove = removePurchaseLine(two, keys[0]);
    const afterAdd = addPurchaseFigure(afterRemove, SPYRO);
    const fresh = afterAdd.find((l) => l.skyId === SPYRO.skyId);
    expect(fresh).toBeDefined();
    expect(keys).not.toContain(fresh!.key);
  });

  it("Menge auf null entfernt die Zeile", () => {
    const lines = build(SPYRO, GILL);
    expect(setPurchaseQuantity(lines, lines[0].key, 0)).toHaveLength(1);
    expect(setPurchaseQuantity(lines, lines[0].key, -3)).toHaveLength(1);
    expect(setPurchaseQuantity(lines, lines[0].key, Number.NaN)).toHaveLength(1);
  });

  it("die Obergrenze aus 0064 gilt weiter", () => {
    let lines = build(SPYRO);
    lines = setPurchaseQuantity(lines, lines[0].key, MAX_DRAFT_UNITS);
    expect(draftUnitCount(lines)).toBe(MAX_DRAFT_UNITS);
    /* Voll ist voll: eine weitere Auswahl ändert nichts. */
    expect(draftUnitCount(addPurchaseFigure(lines, GILL))).toBe(MAX_DRAFT_UNITS);
    expect(setPurchaseQuantity(lines, lines[0].key, MAX_DRAFT_UNITS + 50)[0].quantity)
      .toBe(MAX_DRAFT_UNITS);
  });
});

describe("Aufteilen: verschiedene Zustände, gleiche Gesamtmenge", () => {
  it("drei Einheiten bleiben drei Einheiten", () => {
    const three = build(SPYRO, SPYRO, SPYRO);
    expect(draftUnitCount(three)).toBe(3);
    const split = splitPurchaseUnit(three, three[0].key);
    expect(draftUnitCount(split)).toBe(3);
    expect(split.map((l) => l.quantity)).toEqual([2, 1]);
  });

  it("und die abgetrennte Einheit bekommt ihren eigenen Zustand", () => {
    const three = build(SPYRO, SPYRO, SPYRO);
    const split = splitPurchaseUnit(three, three[0].key);
    const damaged = setPurchaseLineState(split, split[1].key, "damaged");
    expect(draftUnitCount(damaged)).toBe(3);
    expect(purchaseDraftStateCounts(damaged)).toMatchObject({
      ordered: 2, damaged: 1, arrived: 0, missing: 0, showcase: 0,
    });
  });

  it("eine einzelne Einheit lässt sich nicht aufteilen", () => {
    const one = build(SPYRO);
    const after = splitPurchaseUnit(one, one[0].key);
    expect(after).toHaveLength(1);
    expect(draftUnitCount(after)).toBe(1);
  });

  it("ein unbekannter Schlüssel ändert nichts", () => {
    const lines = build(SPYRO, SPYRO);
    expect(splitPurchaseUnit(lines, 999)).toEqual(lines);
    expect(setPurchaseLineState(lines, 999, "damaged")).toEqual(lines);
    expect(removePurchaseLine(lines, 999)).toEqual(lines);
  });

  it("die abgetrennte Einheit behält zunächst den Zustand, aus dem sie kommt", () => {
    /*
     * Sie auf `Bestellt` zurückzusetzen wäre eine zweite, nicht verlangte
     * Änderung — und ein Abtrennen aus einer beschädigten Zeile ist meistens
     * der Anfang von „diese eine ist aber in Ordnung".
     */
    const damaged = setPurchaseLineState(build(SPYRO, SPYRO, SPYRO), 1, "damaged");
    const split = splitPurchaseUnit(damaged, damaged[0].key);
    expect(split.map((l) => l.state)).toEqual(["damaged", "damaged"]);
    expect(draftUnitCount(split)).toBe(3);
  });

  it("der Zustandswechsel fasst NICHTS zusammen", () => {
    /*
     * Zwei Zeilen derselben Figur im selben Zustand sind unordentlich. Eine
     * Zeile, die unter der Hand verschwindet, die sie gerade aufgeteilt hat,
     * ist schlimmer.
     */
    const split = splitPurchaseUnit(build(SPYRO, SPYRO, SPYRO), 1);
    const moved = setPurchaseLineState(split, split[1].key, "arrived");
    const back = setPurchaseLineState(moved, moved[1].key, "ordered");
    expect(back).toHaveLength(2);
    expect(draftUnitCount(back)).toBe(3);
  });
});

describe("was zur Datenbank geht", () => {
  it("ein Element je physischer Einheit, mit seinem Zustand", () => {
    const damaged = setPurchaseLineState(
      splitPurchaseUnit(build(SPYRO, SPYRO, SPYRO), 1), 2, "damaged",
    );
    const payload = purchaseDraftPayload(damaged);
    expect(payload).toEqual([
      { sky_id: "SKY-0001", state: "ordered" },
      { sky_id: "SKY-0001", state: "ordered" },
      { sky_id: "SKY-0001", state: "damaged" },
    ]);
  });

  it("die Menge erreicht die Datenbank nicht", () => {
    const payload = purchaseDraftPayload(build(SPYRO, SPYRO));
    expect(payload).toHaveLength(2);
    for (const element of payload) {
      expect(Object.keys(element).sort()).toEqual(["sky_id", "state"]);
    }
  });

  it("ein leerer Entwurf sendet eine leere Liste, keinen Fehler", () => {
    /* Ein Einkauf ohne Positionen bleibt gültig (0063) und heisst dann
       `Unvollständig`. */
    expect(purchaseDraftPayload([])).toEqual([]);
  });

  it("jeder gesendete Zustand ist einer der fünf", () => {
    const mixed = PURCHASE_DRAFT_STATES.reduce<PurchaseDraftLine[]>(
      (lines, state, i) => setPurchaseLineState(
        addPurchaseFigure(lines, { ...SPYRO, skyId: `SKY-000${i + 1}` } as FigureChoice),
        i + 1, state,
      ), []);
    for (const element of purchaseDraftPayload(mixed)) {
      expect(isPurchaseDraftState(element.state), element.state).toBe(true);
    }
  });
});

describe("der Entwurfstoken", () => {
  it("ist eine kleingeschriebene UUID", () => {
    const token = newDraftToken();
    expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(token).toBe(token.toLowerCase());
  });

  it("und passt zum CHECK der Spalte", () => {
    const sql = read("supabase/migrations/0120_purchase_states_and_idempotency.sql");
    expect(sql).toContain("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$");
  });

  it("entsteht EINMAL beim Öffnen, nicht je Absenden", () => {
    expect(FORM).toContain("const [draftToken] = useState(newDraftToken);");
    /* Nicht im Absenden erzeugt — das wäre je Klick ein neuer Token und
       damit kein Schutz. */
    const submit = FORM.slice(FORM.indexOf("function submit"));
    expect(submit).not.toContain("newDraftToken(");
    expect(submit).toContain("clientToken: draftToken");
  });
});

describe("die Trennung vom Verkauf bleibt", () => {
  it("der Verkauf kennt keinen Positionszustand", () => {
    expect(NEW_SALE).toContain("draftPayload(lines)");
    expect(NEW_SALE).not.toContain("purchaseDraftPayload");
    expect(NEW_SALE).not.toContain("PURCHASE_DRAFT_STATES");
  });

  it("und der geteilte Entwurf hat keinen bekommen", () => {
    /*
     * `DraftLine` wird vom Verkaufsformular und vom Rechner benutzt. Ein
     * Zustandsfeld dort wäre ein Feld, das zwei Bildschirme nicht kennen.
     *
     * `draftUnits()` nennt `state: "ordered"` weiter — das ist die Bewertung
     * für einen Entwurf OHNE Zustände und bleibt richtig für den Verkauf. Der
     * Einkauf benutzt dafür `purchaseDraftUnits()`.
     */
    expect(DRAFT).not.toContain("PurchaseDraftState");
    expect(DRAFT).not.toContain("PURCHASE_DRAFT_STATES");
    const type = DRAFT.slice(DRAFT.indexOf("export type DraftLine"));
    expect(type.slice(0, type.indexOf("};"))).not.toContain("state");
  });

  it("der Einkaufsentwurf wird mit der geteilten Arithmetik bewertet", () => {
    /*
     * `valuePurchase` wird nicht nachgebaut — dieselbe Funktion, die der
     * Ledger benutzt und die `purchase_market_value()` spiegelt.
     */
    const lines = build(SPYRO, GILL);
    const value = purchaseDraftValue(30, lines);
    expect(value.knownItems).toBe(2);
    expect(value.knownValue).toBeCloseTo(21.5, 2);
    expect(FORM).toContain("purchaseDraftValue(costs.total, lines)");
  });

  it("und beschädigt oder fehlend zählt dabei 0 EUR, wie in der Datenbank", () => {
    /*
     * DAS WAR EINE ECHTE LÜCKE, die dieser Test gefunden hat.
     *
     * `draftUnits()` gab jeder Einheit `ordered`. Richtig, solange ein Entwurf
     * keine Zustände kannte. Mit 0120 hätte der Bildschirm einen Marktwert
     * gezeigt, den der gespeicherte Einkauf nicht hat: `D4` schreibt
     * beschädigten und fehlenden Positionen 0 EUR zu (`creditsNoValue`), und
     * der Faktor wäre im Moment des Speicherns gesprungen.
     */
    const three = build(SPYRO, SPYRO, SPYRO);
    const split = splitPurchaseUnit(three, three[0].key);
    const damaged = setPurchaseLineState(split, split[1].key, "damaged");

    const whole = purchaseDraftValue(30, three);
    const partly = purchaseDraftValue(30, damaged);
    expect(whole.knownValue).toBeCloseTo(37.5, 2);
    expect(partly.knownValue).toBeCloseTo(25, 2);
    expect(partly.worthlessItems).toBe(1);
    /* Die Kosten bleiben unangetastet, also STEIGT der Faktor. */
    expect(partly.factor!).toBeGreaterThan(whole.factor!);
    /* `missing` wird genauso behandelt. */
    const missing = setPurchaseLineState(split, split[1].key, "missing");
    expect(purchaseDraftValue(30, missing).knownValue).toBeCloseTo(25, 2);
    /* `showcase` dagegen ist physisch da und zählt voll (D3). */
    const showcase = setPurchaseLineState(split, split[1].key, "showcase");
    expect(purchaseDraftValue(30, showcase).knownValue).toBeCloseTo(37.5, 2);
  });
});

describe("die Oberfläche der kompakten Liste", () => {
  it("zeigt je Zeile GENAU fünf Dinge: Name, SKY-ID, Zustand, Anzahl, Entfernen", () => {
    expect(LIST).toContain("{line.name}");
    expect(LIST).toContain("{line.skyId}");
    expect(LIST).toContain("PURCHASE_DRAFT_STATES.map");
    expect(LIST).toContain("copy.quantity(line.name, line.quantity)");
    expect(LIST).toContain("copy.removeOne(line.name)");
    /*
     * UND NICHT MEHR. Serie und Marktwert standen in der ersten Fassung mit
     * in der Zeile — sieben Zellen, und dem Namen blieben bei `sm:` weniger
     * als 7,5rem. Der Marktwert steht weiter im Kästchen unter der Tabelle,
     * wo der Kaufpreis daneben steht und er etwas bedeutet.
     */
    expect(LIST).not.toContain("formatPrice");
    expect(LIST).not.toContain("line.series");
    expect(LIST).not.toContain("line.marketPrice");
    expect(FORM).toContain("figures.marketValue");
  });

  it("fünf Gitterspalten ab md, zwei entworfene Zeilen darunter", () => {
    /*
     * Die Zahlen stammen aus der Rechnung im Kopf der Komponente:
     * 5,5 + 8 + 9 + 2 = 24,5rem fest, plus 2rem Lücken. Bei `sm:` (40rem)
     * blieben dem Namen 13,5rem, bei `md:` (48rem) sind es 21,5rem — deshalb
     * greift die einzeilige Tabelle erst dort.
     */
    expect(LIST).toContain("md:grid-cols-[minmax(0,1fr)_5.5rem_8rem_9rem_2rem]");
    expect(LIST).toContain("grid grid-cols-[minmax(0,1fr)_auto]");
    /* Kein `flex-wrap` mehr: sieben Zellen, die sich ihre Zeilen selbst
       suchen, waren der Grund für die mehrzeilige Darstellung. */
    expect(LIST).not.toContain("flex-wrap items-center");
    /* Das Umschalten macht `md:contents`, nicht ein zweites Gitter. */
    expect(LIST).toContain("md:contents");
  });

  it("die Mengenzelle läuft nicht über", () => {
    /*
     * Vier Knöpfe à 2rem plus drei Lücken à 0,25rem = 8,75rem. Die Spalte ist
     * 9rem breit (`md:w-36`). In der ersten Fassung stand dasselbe in `w-28`
     * (7rem) und ragte 1,75rem in die Entfernen-Spalte.
     */
    expect(LIST).toContain("md:w-36");
    expect(LIST).not.toContain("sm:w-28");
    expect(LIST).not.toContain("sm:w-32");
  });

  it("keine großen Zustandsknöpfe und kein Einbuchen im Anlegeformular", () => {
    /*
     * Geprüft wird, was die Liste TUT — nicht, welche Wörter in ihrem
     * Kopfkommentar stehen. Der erklärt gerade, warum hier nicht eingebucht
     * wird, und darf das Wort deshalb nennen.
     */
    for (const forbidden of ["copy.book", "bookPurchaseItem", "setPurchaseItemState",
                             "ACTION_PRIMARY", "checkIn", "movement_id"]) {
      expect(LIST, forbidden).not.toContain(forbidden);
    }
    /* Und die Liste ruft überhaupt keine Server Action — sie verändert einen
       Entwurf im Browser. */
    expect(LIST).not.toContain("@/lib/orderbook/actions");
    /* Der Einbuchen-Knopf steht weiter dort, wo er hingehört. */
    expect(read("src/components/business/purchase-items.tsx")).toContain("bookPurchaseItem");
  });

  it("genau ein Absende-Knopf, und er heißt „Einkauf speichern“", () => {
    expect(de.business.orderbook.submitPurchase).toBe("Einkauf speichern");
    expect(FORM.split('type="submit"')).toHaveLength(2);
    expect(FORM).toContain("copy.submitPurchase");
  });

  it("der Zustand ist ein Auswahlfeld mit barrierefreier Beschriftung", () => {
    expect(LIST).toContain("aria-label={copy.stateOf(line.name)}");
    expect(LIST).toContain("isPurchaseDraftState(next)");
    /* Ein unbekannter Wert aus dem DOM ändert nichts, statt ihn durchzulassen. */
    expect(LIST).toContain("if (!isPurchaseDraftState(next)) return;");
  });

  it("das Abtrennen steht nur dort, wo es etwas tut", () => {
    const stepper = LIST.slice(LIST.indexOf("line.quantity > 1"));
    expect(stepper.slice(0, stepper.indexOf(") : ("))).toContain("splitPurchaseUnit");
    expect(LIST).toContain("copy.splitOne(line.name)");
    expect(LIST).toContain("copy.splitHint");
  });

  it("die Zielgröße für den Finger bleibt bei 11", () => {
    /* Dieselbe Geometrie wie in `figure-draft.tsx`: 44 px auf dem Telefon,
       32 px erst ab `md:`, wo gezeigt wird. */
    expect(LIST).toContain("size-11");
    expect(LIST).toContain("min-h-11");
    expect(LIST).toContain("md:size-8");
    expect(LIST).toContain("md:min-h-8");
  });

  it("das Suchfeld bleibt über der Tabelle, und es ist das geteilte", () => {
    expect(LIST).toContain("<FigureSearch");
    expect(LIST).toContain("addPurchaseFigure(lines, choice)");
    /* Vor der Liste, nicht darunter. */
    expect(LIST.indexOf("<FigureSearch")).toBeLessThan(LIST.indexOf("lines.map"));
  });

  it("die Entwurfslogik ist UNVERÄNDERT — die Liste zeichnet nur", () => {
    /*
     * Schritt A war ein Umbau der Darstellung. Jede Zustandsänderung geht
     * weiter durch dieselben reinen Funktionen, und die Liste rechnet nichts
     * selbst.
     */
    for (const fn of ["addPurchaseFigure", "setPurchaseQuantity", "setPurchaseLineState",
                      "splitPurchaseUnit", "removePurchaseLine"]) {
      expect(LIST, fn).toContain(`${fn}(lines, line.key`.replace("(lines, line.key", "("));
    }
    expect(LIST).not.toContain("useState");
    expect(LIST).not.toContain("useMemo");
  });
});
