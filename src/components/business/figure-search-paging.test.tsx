// @vitest-environment jsdom
/**
 * Die Figurensuche, wirklich gerendert (V2).
 *
 * Was ein Quelltextvergleich nicht zeigen kann: dass nach einem Tastendruck
 * die richtigen Zeilen dastehen, dass „weitere Treffer" sie wirklich
 * nachreicht, dass `ArrowDown` über die Seite hinaus blättert und `Enter`
 * danach die hervorgehobene Figur nimmt — und dass jede Zeile ein Bild oder
 * einen sauberen Platzhalter trägt.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { de } from "@/lib/i18n/de";
import type { FigureChoice, SearchOrder } from "@/lib/orderbook/figure-search";
import { FigureSearch } from "./figure-search";

const copy = de.business.orderbook.figures;

const POS: Record<string, number> = { SA: 0, G: 1, SF: 2, T: 3, SC: 4, I: 5 };
const fig = (skyId: string, name: string, series: string, image: string | null = null): FigureChoice => ({
  skyId, name, series, marketPrice: 10, seriesPosition: POS[series], image,
});

const KATALOG: FigureChoice[] = [
  fig("SKY-0142", "Pop Fizz", "G", "/figures/pop-fizz.webp"),
  fig("SKY-0143", "Pop Fizz Light Core", "G", "/figures/light-core.webp"),
  fig("SKY-0144", "Punch Pop Fizz", "G", "/figures/punch.webp"),
  fig("SKY-0290", "Super Gulp Pop Fizz", "SF", "/figures/super-gulp.webp"),
  fig("SKY-0363", "Fizzy Frenzy Pop Fizz", "T", "/figures/fizzy.webp"),
  fig("SKY-0364", "Love Potion Pop Fizz", "T", "/figures/love.webp"),
  fig("SKY-0463", "Big Bubble Pop Fizz", "SC", "/figures/big-bubble.webp"),
  /* Die eine Zeile ohne Bild, wie im echten Katalog. */
  fig("SKY-0464", "Birthday Bash Big Bubble Pop Fizz", "SC", null),
  fig("SKY-0001", "Spyro", "SA", "/figures/spyro.webp"),
  /* Die zwei echten Fälle, in denen die Serie den exakten Namen nach unten
     schiebt (Probe über alle 594 Katalognamen, 2026-11-02). */
  fig("SKY-0215", "Sidekick Mini Jini", "G", null),
  fig("SKY-0420", "Mini Jini", "T", null),
  fig("SKY-0180", "Scorpion Striker Catapult", "G", null),
  fig("SKY-0310", "Scorp", "SF", null),
];

let container: HTMLDivElement;
let root: Root;
let chosen: FigureChoice[];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  chosen = [];
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(props: { pageSize?: number; order?: SearchOrder; showImage?: boolean } = {}) {
  act(() => {
    root.render(createElement(FigureSearch, {
      catalog: KATALOG, onSelect: (c: FigureChoice) => chosen.push(c), ...props,
    }));
  });
}

const input = () => container.querySelector<HTMLInputElement>('input[type="search"]')!;
const rows = () => [...container.querySelectorAll<HTMLButtonElement>(
  `ul[aria-label="${copy.results}"] button`)];
const nameOf = (b: HTMLElement) => b.querySelector<HTMLElement>("span[title]");
const rowNames = () => rows().map((b) => nameOf(b)?.textContent);
/* Die markierte Zeile — die, die `Enter` nimmt. */
const marked = () => rows().filter((b) => b.className.includes("bg-surface ring-fg/40"))
  .map((b) => nameOf(b)?.textContent);
const moreButton = () => [...container.querySelectorAll<HTMLButtonElement>("button")]
  .find((b) => b.textContent?.includes("weitere") || b.textContent?.includes("weiterer"));

/* React hört auf das native `input`-Ereignis; der Wert muss am Prototyp
   vorbei gesetzt werden, sonst merkt React die Änderung nicht. */
function type(text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input(), text);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function key(name: string) {
  act(() => {
    input().dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
  });
}

/* ===================================================================== */
describe("alle Treffer erreichbar", () => {
  it("zeigt eine Seite und darunter, wie viele noch fehlen", () => {
    render({ pageSize: 6, order: "series" });
    type("Pop Fizz");
    expect(rows()).toHaveLength(6);
    expect(moreButton()?.textContent).toBe(copy.moreResults(2));
    expect(rowNames()).not.toContain("Big Bubble Pop Fizz");
  });

  it("„weitere Treffer“ reicht den Rest nach — „Punch Pop Fizz“ inklusive", () => {
    render({ pageSize: 2, order: "series" });
    type("Pop Fizz");
    expect(rowNames()).not.toContain("Punch Pop Fizz");
    act(() => { moreButton()!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })); });
    expect(rowNames()).toContain("Punch Pop Fizz");
    while (moreButton()) {
      act(() => { moreButton()!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })); });
    }
    expect(rows()).toHaveLength(8);
    /* Keine Zeile doppelt. */
    expect(new Set(rowNames()).size).toBe(8);
  });

  it("die Seriensortierung steht so auf dem Schirm", () => {
    render({ pageSize: 20, order: "series" });
    type("pop fizz");
    expect(rowNames()).toEqual([
      "Pop Fizz", "Pop Fizz Light Core", "Punch Pop Fizz", "Super Gulp Pop Fizz",
      "Fizzy Frenzy Pop Fizz", "Love Potion Pop Fizz", "Big Bubble Pop Fizz",
      "Birthday Bash Big Bubble Pop Fizz",
    ]);
  });

  it("eine neue Eingabe beginnt wieder bei einer Seite", () => {
    render({ pageSize: 2 });
    type("Pop Fizz");
    act(() => { moreButton()!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })); });
    expect(rows()).toHaveLength(4);
    type("Pop Fiz");
    expect(rows()).toHaveLength(2);
  });

  it("ohne Überhang kein Knopf", () => {
    render({ pageSize: 8 });
    type("Spyro");
    expect(rows()).toHaveLength(1);
    expect(moreButton()).toBeUndefined();
  });
});

/* ===================================================================== */
describe("Tastatur", () => {
  it("ArrowDown blättert über die Seite hinaus, Enter nimmt die hervorgehobene", () => {
    render({ pageSize: 2, order: "series" });
    type("Pop Fizz");
    key("ArrowDown");           // Zeile 2 (Light Core)
    key("ArrowDown");           // über die Seite: Punch Pop Fizz wird nachgeladen
    expect(rows()).toHaveLength(4);
    key("Enter");
    expect(chosen.map((c) => c.name)).toEqual(["Punch Pop Fizz"]);
    /* Danach ist das Feld leer und bereit für die nächste Figur. */
    expect(input().value).toBe("");
    expect(rows()).toHaveLength(0);
  });

  it("ArrowUp bleibt oben stehen, Escape leert", () => {
    render({ pageSize: 3 });
    type("Pop Fizz");
    key("ArrowUp");
    key("Enter");
    expect(chosen.map((c) => c.name)).toEqual(["Pop Fizz"]);
    type("Spyro");
    key("Escape");
    expect(input().value).toBe("");
  });

  it("Auswahl per Maus wie bisher: auf mousedown, Feld leer danach", () => {
    render({ pageSize: 8 });
    type("Punch");
    act(() => { rows()[0].dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })); });
    expect(chosen.map((c) => c.skyId)).toEqual(["SKY-0144"]);
    expect(input().value).toBe("");
  });
});

/* ===================================================================== */
describe("Bilder in den Treffern", () => {
  it("jede Zeile mit Bild trägt es — aus der Katalogzeile, ohne Anfrage", () => {
    render({ pageSize: 20 });
    type("Pop Fizz");
    const punch = rows().find((b) => b.textContent?.includes("Punch Pop Fizz"))!;
    expect(punch.querySelector("img")?.getAttribute("src")).toBe("/figures/punch.webp");
    expect(punch.querySelector("img")?.getAttribute("loading")).toBe("lazy");
  });

  it("ohne Bild ein Platzhalter in derselben Größe, kein kaputtes <img>", () => {
    render({ pageSize: 20 });
    type("Birthday");
    const zeile = rows()[0];
    expect(zeile.querySelector("img")).toBeNull();
    const platte = zeile.querySelector('[aria-hidden="true"]')!;
    expect(platte.className).toContain("h-8 w-8");
    expect(platte.textContent).toBe("–");
  });

  it("das Bild ist Zusatz: Serie, Name und SKY-ID stehen weiter als Text", () => {
    render({ pageSize: 20 });
    type("Punch");
    const zeile = rows()[0];
    expect(zeile.textContent).toContain("G");
    expect(zeile.textContent).toContain("Punch Pop Fizz");
    expect(zeile.textContent).toContain("SKY-0144");
    /* Für den Screenreader ist das Bild still — der Name wird nicht doppelt gelesen. */
    expect(zeile.querySelector("img")?.getAttribute("alt")).toBe("");
  });

  it("ist überall an, auch ohne ausdrückliche Angabe (Einkauf, Verkauf)", () => {
    render();
    type("Spyro");
    expect(rows()[0].querySelector("img")).not.toBeNull();
  });

  it("lässt sich weiterhin abschalten", () => {
    render({ showImage: false });
    type("Spyro");
    expect(rows()[0].querySelector("img")).toBeNull();
    expect(rows()[0].querySelector('[aria-hidden="true"]')).toBeNull();
  });
});

/* ===================================================================== */
describe("mobil", () => {
  it("Treffer und „weitere Treffer“ haben 44 px Trefferfläche unter sm", () => {
    render({ pageSize: 2 });
    type("Pop Fizz");
    for (const zeile of rows()) expect(zeile.className).toContain("min-h-11");
    expect(moreButton()!.className).toContain("min-h-11");
    /* Das Suchfeld bleibt 44 px hoch (iOS zoomt unter 16 px). */
    expect(input().className).toContain("min-h-11");
  });

  it("der Name weicht, nicht Bild, Serie oder SKY-ID", () => {
    render({ pageSize: 2 });
    type("Pop Fizz");
    const zeile = rows()[0];
    expect(nameOf(zeile)?.className).toContain("min-w-0 flex-1");
    expect(zeile.querySelector('[aria-hidden="true"]')?.className).toContain("shrink-0");
  });

  it("auf dem Telefon zwei Zeilen für den Namen, ab sm eine — und der volle Name im title", () => {
    render({ pageSize: 20 });
    type("Birthday");
    const name = nameOf(rows()[0])!;
    expect(name.className).toContain("line-clamp-2");
    expect(name.className).toContain("sm:line-clamp-1");
    expect(name.getAttribute("title")).toBe("Birthday Bash Big Bubble Pop Fizz");
  });

  it("das Bild sitzt im bisherigen Kalkulator-Kasten (bg-deep/40), nicht auf einer hellen Platte", () => {
    render({ pageSize: 20 });
    type("Punch");
    const kasten = rows()[0].querySelector('[aria-hidden="true"]')!;
    expect(kasten.className).toContain("bg-deep/40");
    expect(kasten.className).not.toContain("bg-plate");
  });
});

/* ===================================================================== */
describe("Enter bei Seriensortierung", () => {
  it("„Mini Jini“: die Liste bleibt nach Serie, Enter nimmt den exakten Namen", () => {
    render({ pageSize: 6, order: "series" });
    type("Mini Jini");
    expect(rowNames()).toEqual(["Sidekick Mini Jini", "Mini Jini"]);
    expect(marked()).toEqual(["Mini Jini"]);
    key("Enter");
    expect(chosen.map((c) => c.skyId)).toEqual(["SKY-0420"]);
  });

  it("„Scorp“ ebenso — kein weniger passender Treffer aus einer früheren Serie", () => {
    render({ pageSize: 6, order: "series" });
    type("scorp");
    expect(rowNames()[0]).toBe("Scorpion Striker Catapult");
    key("Enter");
    expect(chosen.map((c) => c.name)).toEqual(["Scorp"]);
  });

  it("„Pop Fizz“, „Spyro“: exakter Name steht ohnehin oben", () => {
    render({ pageSize: 6, order: "series" });
    type("Pop Fizz");
    key("Enter");
    type("Spyro");
    key("Enter");
    expect(chosen.map((c) => c.name)).toEqual(["Pop Fizz", "Spyro"]);
  });

  it("eine per Pfeil gewählte Figur gilt — auch wenn es einen exakten Namen gibt", () => {
    render({ pageSize: 6, order: "series" });
    type("Mini Jini");
    key("ArrowUp");             // von „Mini Jini“ hinauf zu „Sidekick Mini Jini“
    expect(marked()).toEqual(["Sidekick Mini Jini"]);
    key("Enter");
    expect(chosen.map((c) => c.name)).toEqual(["Sidekick Mini Jini"]);
  });

  it("ohne exakten Namen nimmt Enter die erste Zeile, wie bisher", () => {
    render({ pageSize: 6, order: "series" });
    type("Mini J");
    expect(marked()).toEqual(["Sidekick Mini Jini"]);
  });

  it("liegt der exakte Name hinter der ersten Seite, wird er trotzdem gezeigt und markiert", () => {
    render({ pageSize: 1, order: "series" });
    type("Mini Jini");
    expect(rowNames()).toEqual(["Sidekick Mini Jini", "Mini Jini"]);
    expect(marked()).toEqual(["Mini Jini"]);
  });

  it("die Orderbuch-Reihenfolge (Relevanz) ist unverändert: exakt oben, oben markiert", () => {
    render({ pageSize: 6 });
    type("Mini Jini");
    expect(rowNames()).toEqual(["Mini Jini", "Sidekick Mini Jini"]);
    expect(marked()).toEqual(["Mini Jini"]);
  });
});

/* ===================================================================== */
describe("Nachladen: Markierung, Fokus, neue Suche", () => {
  const press = (b: HTMLButtonElement) =>
    act(() => { b.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })); });

  it("die Markierung bleibt nach „weitere Treffer“ auf ihrer Zeile", () => {
    render({ pageSize: 3, order: "series" });
    type("Pop Fizz");
    key("ArrowDown");
    expect(marked()).toEqual(["Pop Fizz Light Core"]);
    press(moreButton()!);
    expect(rows()).toHaveLength(6);
    expect(marked()).toEqual(["Pop Fizz Light Core"]);
  });

  it("per Maus nachgeladen: der Fokus bleibt im Suchfeld", () => {
    render({ pageSize: 3 });
    type("Pop Fizz");
    act(() => input().focus());
    press(moreButton()!);
    expect(document.activeElement).toBe(input());
  });

  it("per Tastatur nachgeladen: der Fokus kehrt ins Suchfeld zurück, Enter wirkt dort", () => {
    render({ pageSize: 3, order: "series" });
    type("Pop Fizz");
    const knopf = moreButton()!;
    act(() => knopf.focus());
    act(() => { knopf.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 })); });
    expect(rows()).toHaveLength(6);
    expect(document.activeElement).toBe(input());
    key("Enter");
    expect(chosen.map((c) => c.name)).toEqual(["Pop Fizz"]);
  });

  it("eine neue Suche setzt Seite UND Markierung zurück", () => {
    render({ pageSize: 2, order: "series" });
    type("Pop Fizz");
    press(moreButton()!);
    key("ArrowDown"); key("ArrowDown"); key("ArrowDown");
    expect(rows()).toHaveLength(4);
    type("Pop Fizz Light");
    expect(rows()).toHaveLength(1);
    type("Pop Fizz");
    expect(rows()).toHaveLength(2);
    expect(marked()).toEqual(["Pop Fizz"]);
  });
});
