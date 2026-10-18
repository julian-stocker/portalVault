import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { de } from "@/lib/i18n/de";
import { code, latestFunction } from "@/test-support/migrations";
import { canCheckIn } from "./ledger";
import { purchaseCosts } from "./purchase-money";
import {
  DEFAULT_PAYMENT_METHOD, DEFAULT_PURCHASE_TEMPLATE, PAYMENT_METHODS,
  PURCHASE_TEMPLATES, purchaseTemplate,
} from "./purchase-template";
import {
  canBook, canChangeEnding, canShowcase, endingsFor, quickStatesFor, type ItemState,
} from "./purchase";

/**
 * DAS EINKAUFSORDERBUCH ALS GEGENSTÜCK ZUM VERKAUFSORDERBUCH (0115/0116).
 *
 * Geprüft wird hier die Hälfte, die der Betreiber anfasst: das
 * Anlegeformular, die nachträgliche Korrektur einer Position und der eine
 * Weg, den eine beschädigte Figur NICHT nehmen darf. Die Arithmetik läuft
 * echt; von den Komponenten wird der Quelltext gelesen, weil es für diese
 * Screens keine Renderumgebung im Projekt gibt — dieselbe Methode wie in
 * `sales.test.ts` und `mobile-layout.test.ts`.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
/** Ein Kommentar ist keine Anweisung. */
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const FORM = read("src/components/business/new-purchase.tsx");
const ITEMS = read("src/components/business/purchase-items.tsx");
const LEDGER = read("src/components/business/orderbook-ledger.tsx");
/*
 * Seit Schritt 1 des Positionstabellen-Umbaus wohnen `Status`, `ItemRow` und
 * die sechs Spaltenköpfe in ihrer eigenen Datei. Die Zusicherungen unten sind
 * unverändert — sie lesen nur dort, wo der Code jetzt steht.
 */
const ITEM_TABLE = read("src/components/business/purchase-item-table.tsx");
const DETAILS = read("src/components/business/purchase-details.tsx");
const copy = de.business.orderbook;

/* ===================================================================== */
describe("das Anlegeformular erfasst den ganzen Einkaufskopf", () => {
  it("Kleinanzeigen ist die Vorlage, Kreditkarte die Zahlungsart", () => {
    expect(DEFAULT_PURCHASE_TEMPLATE).toBe("kleinanzeigen");
    expect(PURCHASE_TEMPLATES[0].id).toBe("kleinanzeigen");
    expect(DEFAULT_PAYMENT_METHOD).toBe("card");
    /*
     * Die Vorbelegung des Formulars kommt aus der Vorlage und nicht aus einem
     * zweiten Literal: `purchaseTemplate(DEFAULT_PURCHASE_TEMPLATE).payment`.
     * Zwei Stellen wären zwei Meinungen darüber, was „Standard" heisst.
     */
    expect(FORM).toContain("useState<string>(DEFAULT_PURCHASE_TEMPLATE)");
    expect(FORM).toContain("purchaseTemplate(DEFAULT_PURCHASE_TEMPLATE).payment");
    expect(purchaseTemplate(DEFAULT_PURCHASE_TEMPLATE).payment).toBe(DEFAULT_PAYMENT_METHOD);
    /* Und eine unbekannte Kennung fällt auf die Vorlage zurück, nie auf undefined. */
    expect(purchaseTemplate("gibtesnicht").id).toBe(DEFAULT_PURCHASE_TEMPLATE);
  });

  it("alle fünf Zahlungswege stehen zur Wahl, aus einer Liste", () => {
    expect([...PAYMENT_METHODS]).toEqual(["card", "paypal", "transfer", "cash", "platform"]);
    expect(FORM).toContain("PAYMENT_METHODS.map");
    for (const m of PAYMENT_METHODS) {
      expect(copy.detailsModal.paymentNames[m], m).toBeTruthy();
    }
  });

  it("Verkäufername, Referenz und die drei Kostenfelder sind da", () => {
    for (const needle of ["field.seller", "field.reference",
                          "field.itemsCost", "field.shippingCost",
                          "field.buyerProtectionCost", "field.totalCost"]) {
      expect(FORM, needle).toContain(needle);
    }
    /* Der Name wird roh gespeichert — keine Autokorrektur auf dem Weg dahin
       (Regel 4, und dieselbe Entscheidung wie bei der Figurensuche). */
    expect(FORM).toContain('autoCorrect="off"');
    expect(FORM).toContain("spellCheck={false}");
  });

  it("der Käuferschutz steht, wo es einen gibt — und ist sonst zu holen", () => {
    expect(PURCHASE_TEMPLATES.filter((t) => t.opensBuyerProtection).map((t) => t.id))
      .toEqual(["kleinanzeigen", "willhaben"]);
    expect(purchaseTemplate("manual").opensBuyerProtection).toBe(false);
    expect(FORM).toContain("template.opensBuyerProtection || protectionOpen");
    /* Nicht versteckt: ein Knopf holt das Feld, wenn die Vorlage keines zeigt. */
    expect(FORM).toContain("copy.newBuyerProtection");
    expect(FORM).toContain("setProtectionOpen(true)");
  });

  it("ein Vorlagenwechsel überschreibt keine getippte Zahlungsart", () => {
    const fn = FORM.slice(FORM.indexOf("function chooseTemplate"));
    const body = strip(fn.slice(0, fn.indexOf("\n  }")));
    expect(body).toContain("if (!paymentChosen)");
    /* Und die Kostenfelder fasst der Wechsel überhaupt nicht an. */
    for (const forbidden of ["setItemsCost", "setShipping(", "setBuyerProtection"]) {
      expect(body, forbidden).not.toContain(forbidden);
    }
    expect(FORM).toContain("setPaymentChosen(true)");
  });

  it("die Summe folgt den Teilen, und sie ist die, die gespeichert wird", () => {
    /* Gerundet, dann addiert — dieselbe Arithmetik wie
       `purchases_cost_split_adds_up`. */
    expect(purchaseCosts({ items: "10,005", shipping: "0,005", buyerProtection: "0,005" }))
      .toEqual({ items: 10.01, shipping: 0.01, buyerProtection: 0.01, total: 10.03 });
    expect(purchaseCosts({ items: "88", shipping: "5,49", buyerProtection: "" }))
      .toEqual({ items: 88, shipping: 5.49, buyerProtection: 0, total: 93.49 });

    /*
     * EIN Objekt für Anzeige und Absenden. `costs.total` geht als
     * `total_cost` hinaus, und die drei Teile daneben — nicht zwei getrennt
     * gerechnete Zahlen über dieselbe Ausgabe.
     */
    const submit = strip(FORM.slice(FORM.indexOf("function submit")));
    expect(submit).toContain("costs.total,");
    expect(submit).toContain("items: costs.items");
    expect(submit).toContain("shipping: costs.shipping");
    expect(submit).toContain("buyerProtection: costs.buyerProtection");
    expect((FORM.match(/purchaseCosts\(/g) ?? [])).toHaveLength(1);
  });

  it("der Kopf geht vollständig mit, in einem Aufruf", () => {
    const submit = strip(FORM.slice(FORM.indexOf("function submit")));
    expect((submit.match(/createPurchaseWithItems\(/g) ?? [])).toHaveLength(1);
    for (const field of ["platform: template.platform", "sellerName:", "paymentMethod: payment",
                         "externalRef:"]) {
      expect(submit, field).toContain(field);
    }
    /* Die Figuren entstehen im selben Aufruf und damit in derselben
       Transaktion — kein halb erfasster Einkauf. Seit 0120 reist der Zustand
       je Position mit, und der Entwurfstoken macht den Aufruf idempotent. */
    expect(submit).toContain("purchaseDraftPayload(lines)");
    expect(submit).toContain("clientToken: draftToken");
  });

  it("ein unlesbarer Betrag wird abgewiesen, bevor etwas entsteht", () => {
    const submit = strip(FORM.slice(FORM.indexOf("function submit")));
    expect(submit).toContain("parseMoney(raw) === null");
    expect(submit).toContain("copy.invalidCosts");
    /* Die Prüfung steht VOR dem Aufruf. */
    expect(submit.indexOf("copy.invalidCosts"))
      .toBeLessThan(submit.indexOf("createPurchaseWithItems("));
    expect(copy.invalidCosts).toContain("Käuferschutz");
  });

  it("das Datum ist beim ANLEGEN Pflicht — und wird sichtbar bemängelt", () => {
    /*
     * 0120 dreht diese Prüfung um. `0058` liess `purchased_at` bewusst null,
     * weil dreizehn `#REF!`-Gruppen der Arbeitsmappe kein Datum tragen — und
     * das gilt für den IMPORT weiter. Wer einen Einkauf neu erfasst, weiss
     * dagegen, wann er ihn gemacht hat.
     */
    const dateField = FORM.slice(FORM.indexOf("copy.columns.date"));
    const field = dateField.slice(0, dateField.indexOf("</Field>"));
    expect(field).toContain("required");
    expect(field).toContain("aria-invalid");
    expect(field).toContain("aria-describedby");
    /* Rot, barrierefrei angekündigt, und mit einem Satz statt eines Codes. */
    expect(field).toContain("DATE_BAD");
    expect(field).toContain('role="alert"');
    expect(field).toContain("errors.dateRequired");
    expect(field).toContain("errors.dateImplausible");
    expect(strip(FORM)).toContain("date.trim(),");
    expect(strip(FORM)).not.toContain("date.trim() || null");
    /* Und der Fokus springt hin — ein roter Rahmen ausserhalb des Bildes ist
       keine Meldung. */
    const submit = strip(FORM.slice(FORM.indexOf("function submit")));
    expect(submit).toContain("purchaseDateProblem(date)");
    expect(submit).toContain("dateRef.current?.focus()");
  });
});

/* ===================================================================== */
describe("Tagesindex und Tausch, wie im Verkaufsbuch", () => {
  it("beide Fenster zeigen den Platz mit denselben Worten", () => {
    for (const [name, source] of [["Einkauf", DETAILS], ["Verkauf", read("src/components/business/sale-details.tsx")]] as const) {
      expect(source, name).toContain("modal.dailyIndex");
      expect(source, name).toContain("modal.dailyIndexOf(");
      expect(source, name).toContain("modal.dailyIndexAlone");
      expect(source, name).toContain("modal.dailyIndexNone");
      expect(source, name).toContain("modal.swapPlace");
    }
  });

  it("das (i) öffnet das Fenster und klappt die Zeile nicht auf", () => {
    /*
     * Der Fehler, der in der Produktion schon einmal aufgefallen ist: über
     * der Zeile liegt ein durchsichtiger Knopf, und er steht später im DOM.
     * Ohne `stopPropagation` klappt der Klick die Zeile auf, statt das
     * Fenster zu öffnen.
     */
    const cell = LEDGER.slice(LEDGER.indexOf("copy.detailsFor("));
    const button = cell.slice(0, cell.indexOf("</button>"));
    expect(button).toContain("event.stopPropagation()");
    expect(button).toContain("onDetails(purchase.id)");
    expect(button).toContain("relative z-20");
  });

  it("getauscht wird in EINEM Aufruf, und der Platz kommt vom Server", () => {
    const swap = strip(DETAILS.slice(DETAILS.indexOf("swapPurchaseDailyIndex")));
    expect(swap).toContain("setSwapped(result.dailyIndex)");
    /* Keine lokale Umsortierung: der Server tauscht, diese Datei rechnet
       keinen Platz aus. */
    expect(strip(DETAILS)).not.toMatch(/dailyIndex\s*[+-]\s*1/);
  });
});

/* ===================================================================== */
describe("nachträgliche Korrektur einer Position", () => {
  it("eine gebuchte Position wird nicht stillschweigend geändert", () => {
    /* Weder Zustand noch Zuordnung noch Entfernen — der Weg zurück ist die
       Rücknahme der Buchung, und die schreibt eine Gegenbewegung. */
    expect(canChangeEnding({ state: "booked", skyId: "SKY-0001" })).toBe(false);
    expect(canChangeEnding({ state: "reconciled_legacy", skyId: "SKY-0001" })).toBe(false);
    expect(quickStatesFor({ state: "booked", skyId: "SKY-0001" })).not.toContain("booked");
    expect(ITEMS).toContain("disabled={pending || isBooked}");
    expect(ITEMS).toContain("copy.unbook");
  });

  it("beschädigt und fehlt kommen NICHT in den Verkaufsbestand", () => {
    for (const state of ["damaged", "missing"] as const) {
      expect(canBook({ state, skyId: "SKY-0001" }), state).toBe(false);
      expect(canCheckIn({ state, skyId: "SKY-0001" }), state).toBe(false);
      /* Und auch nicht über die Vitrine: aus der DARF eingebucht werden. */
      expect(canShowcase({ state, skyId: "SKY-0001" }), state).toBe(false);
      expect(endingsFor(state), state).toEqual(["arrived"]);
    }
    /* Der eine Weg zurück ist `arrived`, und er ist offen — sonst wäre eine
       Fehleingabe nur noch per Migration zu heilen. */
    expect(canBook({ state: "arrived", skyId: "SKY-0001" })).toBe(true);
  });

  it("…und der Weg zurück ist ein bewusster Schritt, kein Knopf unter vielen", () => {
    expect(quickStatesFor({ state: "damaged", skyId: "SKY-0001" })).toEqual(["arrived"]);
    expect(ITEMS).toContain("noValue ?");
    expect(ITEMS).toContain("copy.correctEnding");
    expect(ITEMS).toContain("copy.correctEndingHint");
    /* Der Satz sagt, was die Korrektur bedeutet. */
    expect(copy.correctEndingHint).toContain("Verkaufsbestand");
    expect(copy.correctEndingHint).toContain("Angekommen");
    /* Der Hinweis steht VOR dem Knopf, der den Zustand setzt. */
    const block = ITEMS.slice(ITEMS.indexOf("copy.correctEndingHint"));
    expect(block.slice(0, block.indexOf("</div>"))).toContain("quickStatesFor(item).map");
  });

  it("die Vitrine ist keine Sackgasse, und ihr Ausgang sagt, was er tut", () => {
    /* D1: die Überführung in den Shopbestand muss möglich sein. */
    expect(canBook({ state: "showcase", skyId: "SKY-0001" })).toBe(true);
    expect(canCheckIn({ state: "showcase", skyId: "SKY-0001" })).toBe(true);
    /* Und sie heisst nicht „Einbuchen" — das sähe aus wie ein Arbeitsschritt. */
    expect(ITEMS).toContain('item.state === "showcase" ? copy.showcaseToStock');
    expect(ITEMS).toContain("copy.showcaseToStockHint");
    expect(copy.showcaseToStock).toBe("In den Bestand übernehmen");
    /* Aus der Vitrine führt auch der Weg zurück in den Ablauf. */
    expect(endingsFor("showcase")).toEqual(["arrived", "damaged", "missing"]);
    /* Eine Vitrine ist immer eine Katalogfigur. */
    expect(canShowcase({ state: "arrived", skyId: null })).toBe(false);
    expect(canChangeEnding({ state: "arrived", skyId: null })).toBe(false);
  });

  it("ein Listing-Flag allein macht eine Vitrinenfigur nicht verkäuflich", () => {
    /*
     * Die Zusicherung aus D1, auf der Codeseite: verkäuflich wird sie durch
     * eine LAGERBEWEGUNG, und die schreibt nur `seller_book_purchase_item`.
     * Keine Komponente und kein Zustandswechsel kommt daran vorbei —
     * `seller_set_purchase_item_state` kennt `booked` gar nicht.
     */
    const setter = code(latestFunction("seller_set_purchase_item_state").body);
    expect(setter).not.toMatch(/'booked'[^)]*\)\s*then\s*\n?\s*update/);
    expect(setter).toContain("p_state not in ('ordered', 'arrived', 'damaged', 'missing', 'settled', 'showcase')");
    for (const forbidden of ["record_inventory_movement", "shop_inventory"]) {
      expect(setter, forbidden).not.toContain(forbidden);
    }
  });

  it("das Plus-Menü im Einkaufsbuch zeigt nur erreichbare Enden", () => {
    expect(ITEM_TABLE).toContain("canChangeEnding(item");
    expect(ITEM_TABLE).toContain("endingsFor(item.state as ItemState).map");
    /* Keine zweite Liste — in keiner der beiden Dateien. */
    expect(strip(ITEM_TABLE)).not.toContain("EXTRA_ENDINGS");
    expect(strip(LEDGER)).not.toContain("EXTRA_ENDINGS");
    /* Und an einer beschädigten Position heisst der Knopf anders, weil er
       etwas anderes tut. */
    expect(ITEM_TABLE).toContain("creditsNoValue(item.state as ItemState)");
    expect(ITEM_TABLE).toContain("copy.correctEnding : copy.moreEndings");
  });

  it("offene Positionen lassen sich hinzufügen, umhängen und entfernen", () => {
    /* Die drei nachträglichen Eingriffe — und jeder nur dort, wo die
       Datenbank ihn auch erlaubt. */
    expect(read("src/components/business/add-purchase-item.tsx")).toContain("FigureSearch");
    expect(ITEMS).toContain("canRemapItem(item)");
    expect(ITEMS).toContain("canRemoveItem(item)");
    expect(ITEMS).toContain("copy.figures.remove");
    expect(ITEMS).toContain("copy.remapNotAFigure");
  });

  it("eine Frage, eine Regel: `canCheckIn` delegiert an `canBook`", () => {
    /*
     * Sonst hätte dieselbe Figur auf der Detailseite einen Knopf und im
     * Einkaufsbuch keinen. Geprüft über alle Zustände, nicht über den
     * Wortlaut der Funktion.
     */
    const states: ItemState[] = ["ordered", "arrived", "damaged", "missing", "booked",
                                 "showcase", "settled", "reconciled_legacy"];
    for (const state of states) {
      for (const skyId of ["SKY-0001", null]) {
        expect(canCheckIn({ state, skyId }), `${state}/${skyId}`)
          .toBe(canBook({ state, skyId }));
      }
    }
  });
});

/* ===================================================================== */
describe("die Oberfläche verkauft kein geleertes Datum als Erfolg", () => {
  it("ein geleertes Feld bei einem datierten Einkauf schreibt nicht", () => {
    /*
     * `seller_update_purchase` liest NULL als „unverändert lassen". Ohne
     * diese Sperre tut die RPC nichts, meldet Erfolg, und das Fenster
     * schliesst mit dem alten Datum darin — eine stille Nichtänderung, die
     * sich wie eine Änderung anfühlt.
     */
    /* `save(` und nicht `save()`: die Funktion nimmt seit der Korrektur
       der Belegrückfrage ein Argument — die Zusicherung hier ist davon
       unberührt, der Schnitt war es nicht. */
    const save = DETAILS.slice(DETAILS.indexOf("async function save("));
    const body = save.slice(0, save.indexOf("\n  }"));
    expect(body).toContain("wantedDate === undefined && purchase.purchasedAt !== null");
    expect(body).toContain("modal.dateNotRemovable");
    /* Und die Sperre steht VOR dem Schreibvorgang, nicht danach. */
    expect(body.indexOf("modal.dateNotRemovable"))
      .toBeLessThan(body.indexOf("savePurchaseEdit("));
    /* Sie greift NUR beim Leeren: ein geändertes Datum geht weiter durch. */
    expect(body).toContain("draft.purchasedAt.trim() === \"\" ? undefined");
    expect((body.match(/savePurchaseEdit\(/g) ?? [])).toHaveLength(1);
  });

  it("der Satz sagt, was nicht geht — und was stattdessen", () => {
    expect(copy.detailsModal.dateNotRemovable).toContain("nicht entfernt");
    expect(copy.detailsModal.dateNotRemovable).toContain("Datum eintragen");
    /* Kein Versprechen auf ein Feature, das es noch nicht gibt. */
    expect(copy.detailsModal.dateNotRemovable).not.toMatch(/später|demnächst|bald/i);
  });
});

/* ===================================================================== */
describe("jede Ablehnung der Datenbank bekommt einen Satz", () => {
  /**
   * DIE KETTE, GELESEN STATT NACHGEBAUT.
   *
   * `orderbookMessage` liegt in einem `"use server"`-Modul und ist nicht
   * exportierbar — jede Ausfuhr dort müsste eine Server Action sein. Geprüft
   * wird deshalb die Kette selbst: ihre Reihenfolge wird aus dem Quelltext
   * gelesen und auf die ECHTEN Meldungen angewendet, die die Migrationen
   * erheben. Ändert jemand einen `raise exception`-Text, schlägt das hier
   * fehl — und genau das soll es.
   */
  const ACTIONS = read("src/lib/orderbook/actions.ts");
  const fn = ACTIONS.slice(ACTIONS.indexOf("function orderbookMessage"));
  const chainSource = fn.slice(0, fn.indexOf("\n}"));
  /*
   * Jedes `text.includes("…")` gehört zu dem `errors.X`, das IHM FOLGT —
   * auch wenn mehrere Textstücke mit `||` auf denselben Satz zeigen, wie es
   * die Verkaufsseite seit 0113 schreibt. Die erste Fassung dieses
   * Extraktors verlangte `"…"))` direkt hintereinander und übersah damit
   * genau die ersten Glieder einer solchen Oder-Kette.
   */
  const chain: (readonly [string, string])[] = [];
  {
    let pending: string[] = [];
    for (const token of chainSource.matchAll(
      /text\.includes\("([^"]+)"\)|errors\.(\w+)/g)) {
      if (token[1] !== undefined) pending.push(token[1]);
      else if (token[2] !== undefined) {
        for (const needle of pending) chain.push([needle, token[2]] as const);
        pending = [];
      }
    }
  }

  /** Welchen Schlüssel liefert die Kette für diese Meldung? */
  const keyFor = (message: string): string | null =>
    chain.find(([needle]) => message.includes(needle))?.[1] ?? null;

  /** Die Meldung, wie die jüngste Fassung der Funktion sie erhebt. */
  const refusal = (fnName: string, fragment: string): string => {
    const body = code(latestFunction(fnName).body);
    const hit = [...body.matchAll(/raise exception '((?:[^']|'')*)'/g)]
      .map((m) => m[1].replace(/''/g, "'"))
      .find((m) => m.includes(fragment));
    expect(hit, `${fnName}: ${fragment}`).toBeDefined();
    return hit!;
  };

  it("die Kette ist gelesen, nicht erraten", () => {
    expect(chain.length).toBeGreaterThanOrEqual(14);
    /* Jeder Schlüssel existiert auch als deutscher Satz. */
    for (const [, key] of chain) {
      expect(copy.errors[key as keyof typeof copy.errors], key).toBeTruthy();
    }
  });

  it("die vier neuen Ablehnungen aus 0115/0116", () => {
    expect(keyFor(refusal("seller_set_purchase_item_state", "does not move into the showcase")))
      .toBe("showcaseFromDamaged");
    expect(keyFor(refusal("seller_set_purchase_item_state", "goes into the showcase; settle")))
      .toBe("showcaseNeedsFigure");
    expect(keyFor(refusal("seller_update_purchase", "a cost split needs the price")))
      .toBe("splitNeedsItems");
    /*
     * Und der CHECK, der sich mit seinem eigenen Namen meldet. Postgres
     * schreibt `violates check constraint "<name>"`; die drei Constraints der
     * Aufteilung teilen den Präfix `purchases_cost_`.
     */
    for (const constraint of ["purchases_cost_split_adds_up", "purchases_cost_parts_sane",
                              "purchases_cost_split_is_whole"]) {
      expect(keyFor(`new row for relation "purchases" violates check constraint "${constraint}"`),
             constraint).toBe("costSplit");
    }
  });

  it("die vier Ablehnungen des Platztauschs (Parität zum Verkauf)", () => {
    /*
     * Alle vier sind über das Tausch-Auswahlfeld im Detailfenster
     * erreichbar, und bis 0116 fielen alle vier in die generische Meldung.
     * Der Verkauf behandelt seine Zwillinge seit 0113 — dies ist dieselbe
     * Behandlung, nicht eine neue Erfindung.
     */
    expect(keyFor(refusal("seller_swap_purchase_daily_index", "no place to swap")))
      .toBe("undatedHasNoPlace");
    expect(keyFor(refusal("seller_swap_purchase_daily_index", "holds that place in the day")))
      .toBe("placeGone");
    expect(keyFor(refusal("seller_swap_purchase_daily_index", "changed its date concurrently")))
      .toBe("placeGone");
    expect(keyFor(refusal("seller_swap_purchase_daily_index", "a place in a day starts at one")))
      .toBe("placeGone");
    /* Der Satz zum verlorenen Platz ist wortgleich mit dem des Verkaufs —
       dieselbe Lage, dieselbe Auskunft. */
    expect(copy.errors.placeGone).toBe(de.business.sales.errors.placeGone);
    /* Und der zum fehlenden Datum nennt den EINKAUF, nicht den Verkauf. */
    expect(copy.errors.undatedHasNoPlace).toContain("Einkauf");
    expect(copy.errors.undatedHasNoPlace).toContain("Kaufdatum");
    expect(copy.errors.undatedHasNoPlace).not.toContain("Verkauf");
  });

  it("…und die beschädigte Figur bekommt NICHT zweimal denselben Satz", () => {
    /*
     * Zwei verschiedene Sperren, zwei verschiedene Sätze: die eine verbietet
     * das Einbuchen, die andere den Umweg über die Vitrine. Vor der Korrektur
     * fiel die zweite durch die Kette, weil sie „a damaged unit" sagt und die
     * alte Regel nach „damaged item" sucht.
     */
    const booking = keyFor(refusal("seller_book_purchase_item", "does not enter sellable stock"));
    const showcase = keyFor(refusal("seller_set_purchase_item_state",
                                    "does not move into the showcase"));
    expect(booking).toBe("damaged");
    expect(showcase).toBe("showcaseFromDamaged");
    expect(booking).not.toBe(showcase);
  });

  it("keine bestehende Zuordnung ist schlechter geworden", () => {
    /* Wort für Wort die Zuordnungen, die vor 0115/0116 funktioniert haben. */
    const before: [string, string, string][] = [
      ["seller_book_purchase_item", "does not enter sellable stock", "damaged"],
      ["seller_book_purchase_item", "never arrived cannot be booked", "missing"],
      ["seller_book_purchase_item", "already reflected in stock", "historical"],
      ["seller_book_purchase_item", "not a catalog figure", "notAFigure"],
      ["seller_remove_purchase_item", "already in inventory", "alreadyBooked"],
      ["seller_remove_purchase_item", "legacy workbook", "historicalItem"],
      ["seller_set_purchase_item_sky", "before changing which figure", "bookedRemap"],
      ["seller_set_purchase_item_state", "does not change state", "historical"],
      ["seller_delete_purchase", "reverse those bookings", "hasBookings"],
      ["seller_set_purchase_date", "outside the plausible range", "dateRange"],
      ["seller_create_purchase_with_items", "at most 200 items", "tooManyItems"],
    ];
    for (const [fnName, fragment, key] of before) {
      expect(keyFor(refusal(fnName, fragment)), `${fnName}: ${fragment}`).toBe(key);
    }
  });

  it("keine neue Regel verdrängt eine alte", () => {
    /*
     * Die Kette nimmt die ERSTE Übereinstimmung. Eine neue Regel darf
     * deshalb kein Textstück tragen, das in einer älteren Meldung vorkommt —
     * sonst gewinnt sie dort, wo die genauere Regel gewinnen sollte.
     */
    const NEW = ["does not move into the showcase",
                 "only a catalog figure goes into the showcase",
                 "a cost split needs the price of the figures",
                 "purchases_cost_"];
    const everyMessage: string[] = [];
    for (const fnName of ["seller_book_purchase_item", "seller_remove_purchase_item",
                          "seller_set_purchase_item_sky", "seller_set_purchase_item_state",
                          "seller_delete_purchase", "seller_set_purchase_date",
                          "seller_create_purchase_with_items", "seller_update_purchase",
                          "seller_unbook_purchase_item", "seller_add_purchase_item"]) {
      const body = code(latestFunction(fnName).body);
      for (const m of body.matchAll(/raise exception '((?:[^']|'')*)'/g)) {
        everyMessage.push(m[1].replace(/''/g, "'"));
      }
    }
    for (const needle of NEW) {
      const hits = everyMessage.filter((m) => m.includes(needle));
      /* Genau die Meldung, für die die Regel gedacht ist — und keine zweite. */
      expect(hits.length, needle).toBeLessThanOrEqual(1);
    }
  });
});
