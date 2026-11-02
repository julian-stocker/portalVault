// @vitest-environment jsdom
/**
 * „[Emblem] Element: Feuer" auf der Figurenseite (UX-Design, ADR-0173).
 *
 * Die Seite selbst ist eine asynchrone Server-Komponente mit einem halben
 * Dutzend Abfragen; gerendert werden hier die Teile, aus denen die Zeile
 * besteht — `ElementIcon` und der Text —, und an der Seite wird geprüft, dass
 * sie genau so zusammengesetzt ist.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ElementIcon } from "@/components/catalog/element-icon";
import { ELEMENTS } from "@/lib/catalog/character";
import { asElement, elementLabel } from "@/lib/catalog/element";
import { de } from "@/lib/i18n/de";

const PAGE = readFileSync("src/app/(public)/skylanders/[slug]/page.tsx", "utf8");

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/* Genau die Zeile der Seite: Emblem, dann „Element: …". */
function line(element: string | null) {
  const known = asElement(element);
  act(() => {
    root.render(known === null ? null : createElement("p",
      { className: "flex items-center gap-2 text-sm" },
      createElement(ElementIcon, { element, decorative: true, className: "h-6 w-6" }),
      createElement("span", null, de.catalog.elementLine(elementLabel(known)))));
  });
}
const img = () => container.querySelector("img");

describe("die Seite setzt die Zeile so zusammen", () => {
  it("Emblem dekorativ, 24 px, 8 px Abstand, zentriert, ohne Box", () => {
    expect(PAGE).toContain('<p className="flex items-center gap-2 text-sm">');
    expect(PAGE).toContain('<ElementIcon element={figure.element} decorative className="h-6 w-6" />');
    expect(PAGE).toContain("de.catalog.elementLine(elementLabel(asElement(figure.element)!))");
    /* Der alte Chip mit Rahmen steht dort nicht mehr. */
    expect(PAGE).not.toContain("<ElementChip");
  });

  it("nur für ein bekanntes Element — sonst keine Zeile", () => {
    expect(PAGE).toContain("{asElement(figure.element) !== null ? (");
  });

  it("Name, Variante, Serie, Marktwert, Sammeln und SKY-ID stehen unverändert", () => {
    for (const piece of ["de.catalog.variantOf(", "{figure.seriesLabel}", "de.catalog.marketValue",
      "<CollectButton", "{figure.skyId}", "<CharacterPanel"]) {
      expect(PAGE, piece).toContain(piece);
    }
  });
});

describe("„Element: Feuer“ — und so für jedes Element", () => {
  it("Feuer: Emblem links, Text „Element: Feuer“", () => {
    line("Fire");
    expect(img()!.getAttribute("src")).toBe("/images/elements/fire.webp");
    expect(container.textContent).toBe("Element: Feuer");
    const p = container.querySelector("p")!;
    expect(p.firstElementChild!.contains(img())).toBe(true);
  });

  it("jedes Element mit Grafik zeigt sein eigenes Emblem und seinen deutschen Namen", () => {
    for (const element of ELEMENTS) {
      line(element);
      expect(container.textContent, element).toBe(`Element: ${elementLabel(element)}`);
      if (element === "Light" || element === "Dark") continue;
      expect(img()!.getAttribute("src"), element).toMatch(/^\/images\/elements\/[a-z]+\.webp$/);
    }
  });

  it("Licht und Dunkel: der Text, ohne Symbol und ohne leere Fläche", () => {
    for (const element of ["Light", "Dark"]) {
      line(element);
      expect(img(), element).toBeNull();
      expect(container.querySelector("p")!.children, element).toHaveLength(1);
      expect(container.textContent).toBe(`Element: ${elementLabel(element as "Light")}`);
    }
  });

  it("ohne Element oder bei unbekanntem Wert: keine Zeile", () => {
    line(null);
    expect(container.innerHTML).toBe("");
    line("Plasma");
    expect(container.innerHTML).toBe("");
  });

  it("eine Datei, die nicht lädt: kein kaputtes Bild, der Text bleibt", () => {
    line("Water");
    act(() => { img()!.dispatchEvent(new Event("error")); });
    expect(img()).toBeNull();
    expect(container.textContent).toBe("Element: Wasser");
  });
});

describe("Screenreader und kleine Bildschirme", () => {
  it("das Emblem schweigt neben dem Text — der Name wird einmal gelesen", () => {
    line("Magic");
    const mark = container.querySelector("p")!.firstElementChild!;
    expect(mark.getAttribute("aria-hidden")).toBe("true");
    expect(mark.getAttribute("title")).toBeNull();
    expect(mark.querySelector(".sr-only")).toBeNull();
    expect(img()!.getAttribute("alt")).toBe("");
  });

  it("ohne `decorative` nennt das Emblem sich selbst (title und sr-only)", () => {
    act(() => { root.render(createElement(ElementIcon, { element: "Fire" })); });
    const mark = container.firstElementChild!;
    expect(mark.getAttribute("title")).toBe("Feuer");
    expect(mark.querySelector(".sr-only")?.textContent).toBe("Feuer");
  });

  it("das Emblem schrumpft nicht, die Zeile braucht keine feste Breite", () => {
    line("Earth");
    const mark = container.querySelector("p")!.firstElementChild!;
    expect(mark.className).toContain("shrink-0");
    expect(mark.className).toContain("h-6 w-6");
    expect(container.querySelector("p")!.className).not.toMatch(/\bw-\[|\bmin-w-/);
  });
});
