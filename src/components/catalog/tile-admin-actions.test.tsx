/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import type { CatalogFigure } from "@/lib/catalog/types";

/*
 * DIE ZWEI SERVERAKTIONEN WERDEN HIER WIRKLICH GEDRUECKT — anders als in
 * `tile-roles.test.tsx`, wo nur gezaehlt wird, was gezeichnet ist. Deshalb
 * sind sie Spione: die Pruefung „der Preis wird mit dem GESPEICHERTEN Wert
 * geschickt" ist nur an ihrem Argument zu sehen.
 */
type Antwort = { ok: true; price?: number | null } | { ok: false; message: string };
const setPreis = vi.fn(
  async (_skyId: string, _wert: number | null): Promise<Antwort> =>
    ({ ok: true, price: _wert }));
const loesche = vi.fn(
  async (_skyId: string): Promise<Antwort> => ({ ok: true }));

vi.mock("@/lib/admin/actions", () => ({
  setCatalogStatus: async () => ({ ok: true }),
  setMarketPrice: (skyId: string, wert: number | null) => setPreis(skyId, wert),
  deleteFigure: (skyId: string) => loesche(skyId),
}));

/**
 * CAT-09 — die vier Verbesserungen an der Adminkachel.
 *
 *   1. eine VERSTECKTE Figur ist gedaempft, eine ENTWURFSFIGUR nicht
 *   2. der rote Papierkorb, und er fragt, bevor er etwas tut
 *   3. vier Marken, EINE Groesse, 44-px-Felder
 *   4. der Marktwert inline — und der GESPEICHERTE Wert geht zum Server,
 *      nicht der angezeigte
 *
 * DIE VIERTE IST DIE, DIE SCHIEFGEHEN KANN, UND SIE IST NICHT ZU SEHEN.
 * Der Katalog DRUECKT `market_price × (1 + boost/100)`, gerechnet im Moment
 * des Druckens und nie gespeichert. Schriebe das Eingabefeld den gedruckten
 * Betrag zurueck, waere der Zuschlag beim naechsten Lesen zweimal drin — und
 * beim naechsten Speichern dreimal. Das faellt niemandem auf, bis die Preise
 * falsch sind. Hier wird deshalb mit einem Zuschlag geprueft, und zwar am
 * ARGUMENT der Serveraktion.
 */

const FIGUR: CatalogFigure = {
  skyId: "SKY-0001", name: "Spyro", slug: "sky-0001",
  seriesCode: "SA", seriesLabel: "Spyro's Adventure",
  seriesPosition: 0, categoryPosition: 0, categoryName: "Figuren", categoryId: 1,
  catalogGroup: "figure", cardType: "standard", catalogVisible: true,
  canonicalName: "", displayNameOverride: null, marketPrice: 10,
  imageFile: null, imageOverridePath: null,
  displayName: "Spyro", sortBaseName: "Spyro", sortVariantLabel: null,
  searchIndex: "spyro", isActive: true, element: null, characterId: null,
  baseSkyId: null,
} as CatalogFigure;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount(node: Parameters<Root["render"]>[0]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(node); });
}

beforeEach(() => { setPreis.mockClear(); loesche.mockClear(); });

afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  root = null; container = null;
  vi.restoreAllMocks();
});

/** Eine Adminkachel, in dem Zustand, den der Test braucht. */
async function kachel(zusatz: Partial<CatalogFigure> & Record<string, unknown> = {},
                      props: Record<string, unknown> = {}) {
  const { CatalogCard } = await import("./catalog-card");
  await mount(createElement(CatalogCard, {
    figure: { ...FIGUR, ...zusatz }, initialCollected: false, signInHref: null,
    accountType: "admin", admin: true, onEdit: () => {}, ...props,
  } as never));
}

const knopf = (teil: string) => [...document.querySelectorAll("button")]
  .find((b) => (b.getAttribute("aria-label") ?? "").includes(teil));

/**
 * DIE VIER MARKEN DER AKTIONSLEISTE, in der Reihenfolge, in der sie stehen.
 *
 * Gesucht wird die Leiste selbst und nicht „alles mit `h-11`": der Stift am
 * Preis sitzt in derselben Feldgroesse, aber in der PREISZELLE, und er ist
 * keine fuenfte Marke der Leiste. Eine Auswahl ueber die Klasse hat ihn
 * mitgezaehlt, und die Zahl 4 war dann 5.
 */
const leiste = () => {
  const bar = [...document.querySelectorAll("span")]
    .find((e) => e.className.includes("ml-auto")
               && e.className.includes("shrink-0")
               && e.className.includes("items-center"));
  return bar === undefined ? [] : [...bar.querySelectorAll("button, a")];
};

// ===========================================================================
// 1. AUSGRAUEN
// ===========================================================================
describe("eine versteckte Figur ist gedaempft — eine Entwurfsfigur nicht", () => {
  /** Alles, dem eine Daempfung anhaengt. */
  const gedaempft = () => [...document.querySelectorAll("*")]
    .filter((e) => (e.className?.toString?.() ?? "").includes("opacity-55"));

  it("versteckt: die Bildspalte ist gedaempft", async () => {
    await kachel({ catalogVisible: false, catalogStatus: "hidden" },
                 { visible: false });
    expect(gedaempft().length).toBeGreaterThan(0);
  });

  it("oeffentlich: nichts ist gedaempft", async () => {
    await kachel();
    expect(gedaempft().length).toBe(0);
  });

  /*
   * DER ENTWURF IST DIE ANFORDERUNG, DIE MAN LEICHT UEBERSIEHT. Er ist
   * ebenfalls nicht oeffentlich sichtbar — aber er ist etwas ANDERES als eine
   * versteckte Figur: er wartet auf eine Entscheidung, sie hat eine. Waeren
   * beide grau, waere die Kachel nicht mehr zu unterscheiden, und genau das
   * schliesst Anforderung 1 aus.
   */
  it("ENTWURF: nicht gedaempft, obwohl auch er nicht oeffentlich ist", async () => {
    await kachel({ catalogVisible: false, catalogStatus: "draft" },
                 { visible: false });
    expect(gedaempft().length).toBe(0);
  });

  it("und die Aktionsleiste bleibt bei voller Deckkraft, auch wenn sie "
     + "gedaempft ist", async () => {
    await kachel({ catalogVisible: false, catalogStatus: "hidden" },
                 { visible: false });
    /*
     * KEINE DER VIER MARKEN HAENGT IN EINEM GEDAEMPFTEN ELEMENT. Gemessen am
     * Elternpfad und nicht an der eigenen Klasse: eine Daempfung oben
     * vererbt sich, und das waere derselbe Fehler, nur weiter weg.
     */
    for (const b of leiste()) {
      let p: Element | null = b;
      while (p !== null) {
        expect((p.className?.toString?.() ?? ""), b.getAttribute("aria-label") ?? "?")
          .not.toContain("opacity-55");
        p = p.parentElement;
      }
    }
  });
});

// ===========================================================================
// 2. DER PAPIERKORB
// ===========================================================================
describe("der Papierkorb fragt, bevor er etwas tut", () => {
  it("er steht als VIERTE Marke, nach Info, Stift und Auge", async () => {
    await kachel();
    const marken = leiste().map((e) => e.getAttribute("aria-label") ?? "");
    expect(marken.length).toBe(4);
    expect(marken[0]).toContain("Spyro");            /* Info */
    expect(marken[1]).toContain("bearbeiten");
    expect(marken[2]).toContain("verstecken");
    expect(marken[3]).toContain("löschen");
  });

  it("und er ist rot — die drei anderen sind es nicht", async () => {
    await kachel();
    const marken = leiste();
    expect(marken[3]!.className).toContain("text-danger");
    for (const i of [1, 2]) {
      expect(marken[i]!.className, marken[i]!.getAttribute("aria-label") ?? "?")
        .not.toContain("text-danger");
    }
  });

  it("ein Klick loescht NICHTS, sondern fragt — mit Name und SKY-ID", async () => {
    await kachel();
    await act(async () => { knopf("löschen")!.click(); });
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.textContent).toContain("Spyro");
    expect(dialog!.textContent).toContain("SKY-0001");
    /* Und der Server hat nichts gesehen. */
    expect(loesche).not.toHaveBeenCalled();
  });

  it("erst die Bestaetigung ruft den Server, und zwar mit der SKY-ID",
     async () => {
    await kachel();
    await act(async () => { knopf("löschen")!.click(); });
    const ja = [...document.querySelectorAll('[role="alertdialog"] button')]
      .find((b) => (b.className || "").includes("bg-danger"));
    await act(async () => { (ja as HTMLButtonElement).click(); });
    expect(loesche).toHaveBeenCalledWith("SKY-0001");
  });

  it("Abbrechen schliesst die Frage und ruft nichts", async () => {
    await kachel();
    await act(async () => { knopf("löschen")!.click(); });
    const nein = [...document.querySelectorAll('[role="alertdialog"] button')]
      .find((b) => !(b.className || "").includes("bg-danger"));
    await act(async () => { (nein as HTMLButtonElement).click(); });
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(loesche).not.toHaveBeenCalled();
  });

  it("eine OEFFENTLICHE Figur bekommt die zusaetzliche Warnung, eine "
     + "versteckte nicht", async () => {
    await kachel();
    await act(async () => { knopf("löschen")!.click(); });
    const mitWarnung = document.querySelector('[role="alertdialog"]')!.textContent ?? "";
    act(() => { root?.unmount(); });
    container?.remove();

    await kachel({ catalogVisible: false, catalogStatus: "hidden" },
                 { visible: false });
    await act(async () => { knopf("löschen")!.click(); });
    const ohne = document.querySelector('[role="alertdialog"]')!.textContent ?? "";
    expect(mitWarnung.length).toBeGreaterThan(ohne.length);
  });

  it("und eine fehlgeschlagene Loeschung sagt den GRUND, statt die Kachel "
     + "zu entfernen", async () => {
    loesche.mockImplementationOnce(async () => ({
      ok: false,
      message: "Auf SKY-0001 zeigen noch Daten: collection_items.sky_id=2",
    }));
    await kachel();
    await act(async () => { knopf("löschen")!.click(); });
    const ja = [...document.querySelectorAll('[role="alertdialog"] button')]
      .find((b) => (b.className || "").includes("bg-danger"));
    await act(async () => { (ja as HTMLButtonElement).click(); });
    const meldung = document.querySelector('[role="alert"]');
    expect(meldung).not.toBeNull();
    expect(meldung!.textContent).toContain("collection_items");
  });
});

// ===========================================================================
// 3. EINE GROESSE
// ===========================================================================
describe("vier Marken, eine Groesse", () => {
  it("jedes Feld ist 44 px und jeder Glyph 22 px", async () => {
    await kachel();
    const marken = leiste();
    expect(marken.length).toBe(4);
    for (const b of marken) {
      const name = b.getAttribute("aria-label") ?? "?";
      expect(b.className, name).toContain("h-11");
      expect(b.className, name).toContain("w-11");
      const svg = b.querySelector("svg");
      expect(svg, name).not.toBeNull();
      /*
       * AM VIEWBOX UND AN DER KLASSE GEMESSEN, nicht an einer gerechneten
       * Breite: jsdom legt kein Stylesheet an, also ist `getBoundingClientRect`
       * hier 0 und wuerde jede Abweichung verschlucken.
       */
      expect(svg!.getAttribute("viewBox"), name).toBe("0 0 22 22");
      expect(svg!.getAttribute("class") ?? "", name).toContain("h-[22px]");
      expect(svg!.getAttribute("class") ?? "", name).toContain("w-[22px]");
      expect(svg!.getAttribute("stroke-width"), name).toBe("1.5");
    }
  });

  it("jede Marke hat einen Namen fuer die Vorlesehilfe, und die drei neuen "
     + "zusaetzlich einen Tooltip", async () => {
    await kachel();
    const marken = leiste();
    for (const b of marken) expect(b.getAttribute("aria-label")).toBeTruthy();
    /*
     * DIE INFO-MARKE IST DIE AUSNAHME, und sie ist eine alte: sie ist ein
     * Link mit `aria-label` und ohne `title`, und das war sie vor CAT-09
     * schon. Ihr einen Tooltip anzuhaengen waere eine Aenderung an einer
     * Marke, die jede Rolle sieht — also bleibt sie, wie sie ist.
     */
    for (const b of marken.slice(1)) {
      expect(b.getAttribute("title"), b.getAttribute("aria-label") ?? "?")
        .toBeTruthy();
    }
  });

  it("das Auge einer versteckten Figur ist das DURCHGESTRICHENE", async () => {
    await kachel({ catalogVisible: false, catalogStatus: "hidden" },
                 { visible: false });
    const auge = knopf("sichtbar machen")!;
    /* Der Strich ist der dritte Pfad: `m2 2 18 18`. */
    expect(auge.querySelector("svg")!.innerHTML).toContain("18 18");
  });
});

// ===========================================================================
// 4. DER MARKTWERT
// ===========================================================================
describe("der Marktwert wird an der Kachel bearbeitet", () => {
  const stift = () => [...document.querySelectorAll("button")]
    .find((b) => (b.getAttribute("aria-label") ?? "").includes("Marktwert"));
  const feld = () => document.querySelector("input") as HTMLInputElement | null;

  /**
   * TIPPEN, SO DASS REACT ES SIEHT.
   *
   * `el.value = "7,50"` plus ein `input`-Ereignis genuegt NICHT: React 19
   * haengt einen eigenen Setter vor `HTMLInputElement.value` und vergleicht
   * den gemerkten Wert — eine direkte Zuweisung gilt ihm als „schon
   * gesehen", `onChange` bleibt aus, und der Zustand behaelt die
   * Vorbelegung. Deshalb wird der PROTOTYP-Setter benutzt.
   */
  async function tippe(e: HTMLInputElement, wert: string) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(e, wert);
      e.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  const taste = async (e: HTMLInputElement, key: string) => {
    await act(async () => {
      e.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    });
  };

  it("nur ein Admin sieht den Stift am Preis", async () => {
    const { CatalogCard } = await import("./catalog-card");
    for (const rolle of ["user", "business"] as const) {
      await mount(createElement(CatalogCard, {
        figure: FIGUR, initialCollected: false, signInHref: null,
        accountType: rolle, favorites: true,
      } as never));
      expect(stift(), rolle).toBeUndefined();
      act(() => { root?.unmount(); });
      container?.remove();
    }
    await kachel();
    expect(stift()).toBeDefined();
  });

  /*
   * DIE PRUEFUNG, UM DIE ES GEHT. Mit einem Zuschlag von 20 % zeigt die
   * Kachel 12,00 € und speichert 10. Das Feld muss mit **10** vorbelegt sein
   * — sonst schreibt der naechste Klick auf „speichern" 12 in die Spalte,
   * und die Kachel zeigt danach 14,40 €.
   */
  it("das Feld wird mit dem GESPEICHERTEN Wert vorbelegt, nicht mit dem "
     + "angezeigten", async () => {
    const { catalogDisplayMarketPrice } = await import("@/lib/catalog/market-boost");
    const { InlinePrice } = await import("@/components/admin/inline-price");
    /*
     * MIT EINEM ZUSCHLAG VON 20 %, ausdruecklich gesetzt und nicht dem
     * gerade geltenden: die Pruefung muss auch dann greifen, wenn der
     * Zuschlag im Betrieb bei 0 steht. Gespeichert 10, gedruckt 12.
     */
    await mount(createElement(InlinePrice, {
      skyId: "SKY-0001", name: "Spyro", marketPrice: 10, marketBoostPercent: 20,
    }));
    expect(catalogDisplayMarketPrice(10, 20)).toBe(12);
    /* Die Kachel DRUCKT die 12. */
    expect(document.body.textContent).toContain("12,00");
    await act(async () => { stift()!.click(); });
    expect(feld()).not.toBeNull();
    /* UND DAS FELD TRAEGT DIE 10. Das ist die ganze Pruefung. */
    expect(feld()!.value).toBe("10,00");
    expect(feld()!.value).not.toContain("12");
  });

  it("Enter speichert, und zwar den eingegebenen Wert — ungeachtet des "
     + "Zuschlags", async () => {
    await kachel();
    await act(async () => { stift()!.click(); });
    const e = feld()!;
    await tippe(e, "7,50");
    await taste(e, "Enter");
    expect(setPreis).toHaveBeenCalledWith("SKY-0001", 7.5);
  });

  it("Punkt und Komma gelten beide", async () => {
    await kachel();
    for (const [eingabe, erwartet] of [["7.50", 7.5], ["7,50", 7.5],
                                       ["12", 12]] as const) {
      await act(async () => { stift()!.click(); });
      const e = feld()!;
      await tippe(e, String(eingabe));
      await taste(e, "Enter");
      expect(setPreis).toHaveBeenLastCalledWith("SKY-0001", erwartet);
    }
  });

  /*
   * „PREIS OFFEN" IST NULL UND NICHT 0 EURO (ADR-0010). Das leere Feld ist
   * der Weg dorthin — ein Knopf „Preis loeschen" waere ein zweiter Weg zu
   * derselben Spalte.
   */
  it("ein LEERES Feld schreibt NULL — das ist „Preis offen“", async () => {
    await kachel();
    await act(async () => { stift()!.click(); });
    const e = feld()!;
    await tippe(e, "");
    await taste(e, "Enter");
    expect(setPreis).toHaveBeenCalledWith("SKY-0001", null);
  });

  it("und eine 0 gar nichts — sie ist kein Preis", async () => {
    await kachel();
    await act(async () => { stift()!.click(); });
    const e = feld()!;
    await tippe(e, "0");
    await taste(e, "Enter");
    expect(setPreis).not.toHaveBeenCalled();
    /* Das Feld bleibt offen und sagt, was falsch ist. */
    expect(feld()).not.toBeNull();
    expect(document.body.textContent).toContain("Preis offen");
  });

  it("eine Figur OHNE Preis oeffnet mit leerem Feld", async () => {
    await kachel({ marketPrice: null });
    await act(async () => { stift()!.click(); });
    expect(feld()!.value).toBe("");
  });

  it("Escape bricht ab und schreibt nichts", async () => {
    await kachel();
    await act(async () => { stift()!.click(); });
    const e = feld()!;
    await tippe(e, "99");
    await taste(e, "Escape");
    expect(setPreis).not.toHaveBeenCalled();
    expect(feld()).toBeNull();
  });

  it("eine fehlgeschlagene Speicherung BEHAELT die Eingabe und sagt den Grund",
     async () => {
    setPreis.mockImplementationOnce(async () => ({
      ok: false, message: "0162: ein Marktwert von 0 ist kein Preis",
    }));
    await kachel();
    await act(async () => { stift()!.click(); });
    const e = feld()!;
    await tippe(e, "4,20");
    await taste(e, "Enter");
    expect(feld()).not.toBeNull();
    expect(feld()!.value).toBe("4,20");
    expect(document.body.textContent).toContain("kein Preis");
  });
});

// ===========================================================================
// UND DIE ZWEI SEITEN, DIE ZUSAMMENPASSEN MUESSEN
// ===========================================================================
describe("eine Kachel, eine Geometrie — am Code gemessen", () => {
  const aktionen = readFileSync("src/components/admin/card-actions.tsx", "utf8");
  const preis = readFileSync("src/components/admin/inline-price.tsx", "utf8");
  const zeile = readFileSync("src/components/catalog/figure-row.tsx", "utf8");

  /** Ausfuehrbarer Code: Prosa und Zeilenkommentare weg. */
  const code = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("die vier Marken teilen EIN Feld und EIN Icon-Objekt", async () => {
    /* Eine zweite Geometrie waere genau der Befund des Betreibers („die
       Icons wirken unterschiedlich gross") wieder. */
    expect(code(aktionen)).toContain('const FELD =');
    expect(code(aktionen)).toContain('const ICON = {');
    expect(code(aktionen)).toContain('viewBox: "0 0 22 22"');
    expect(code(aktionen)).toContain('className: "block h-[22px] w-[22px]"');
    /* Und keine dritte Groesse daneben. */
    expect(code(aktionen)).not.toContain("h-[16px]");
    expect(code(aktionen)).not.toContain("size-11");
  });

  it("die Daempfung haengt am Status und nicht an der Sichtbarkeit", async () => {
    /*
     * `catalogVisible` ist bei einem ENTWURF genauso `false` wie bei einer
     * versteckten Figur. Haenge die Daempfung daran, wuerden Entwuerfe grau
     * — die Anforderung sagt ausdruecklich das Gegenteil.
     */
    const karte = code(readFileSync("src/components/catalog/catalog-card.tsx", "utf8"));
    expect(karte).toContain('=== "hidden"');
    expect(code(zeile)).toContain("dimmed");
  });

  it("die Daempfung fasst die Aktionsleiste nicht an", async () => {
    /* Am Code: `dimmed` darf in derselben Zeile wie die Leiste nicht
       vorkommen. */
    for (const z of code(zeile).split("\n")) {
      if (z.includes("adminSlot") || z.includes("favoriteSlot")
          || z.includes("bellSlot")) {
        expect(z, z.trim()).not.toContain("dimmed");
      }
    }
  });

  it("der Preis schickt den gespeicherten Wert — der Zuschlag wird nur "
     + "GEDRUECKT", async () => {
    const c = code(preis);
    /* Vorbelegt wird aus `wert`, dem gespeicherten. */
    expect(c).toContain("formatPriceInput(wert)");
    /* Und der gedruckte Betrag geht nie in die Eingabe. */
    expect(c).not.toContain("formatPriceInput(angezeigt");
    expect(c).not.toContain("setMarketPrice(skyId, angezeigt");
  });
});
