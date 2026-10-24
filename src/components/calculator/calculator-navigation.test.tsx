// @vitest-environment jsdom
/**
 * DER KLICK, DER WIRKLICH AUSGEFÜHRT WIRD (Calculator V3.1).
 *
 * WARUM DIESE DATEI EXISTIERT. „Einkauf erstellen“ trug die richtige Adresse
 * und tat trotzdem sichtbar nichts. Der Verweis navigierte — aber der
 * Kalkulator blieb offen, und weil `Modal` sich nach `document.body`
 * portaliert und dort als `fixed inset-0 z-50` liegt, verdeckte er die
 * Zielseite vollständig. Dazu stand `body.style.overflow` weiter auf
 * `hidden`. Von außen sah das aus wie „der Knopf ist kaputt“.
 *
 * WARUM KEIN BESTEHENDER TEST DAS GEFUNDEN HAT. Oberflächen wurden in diesem
 * Projekt als QUELLTEXT geprüft — `purchase-from-calculation.test.ts` enthält
 * wörtlich
 *
 *     expect(panel).toContain("/business/orderbuch/neu?kalkulation=${calculation.id}")
 *
 * und das war richtig und blieb richtig. Geprüft war die Adresse, nicht der
 * Ablauf. Ein Quelltextvergleich kann nicht wissen, was nach einem Klick auf
 * dem Schirm steht.
 *
 * WAS HIER WIRKLICH PASSIERT. React rendert in ein echtes DOM (jsdom), der
 * Knopf wird wirklich gedrückt, das Fenster entsteht wirklich im Portal, und
 * danach wird gefragt, ob es noch da ist. Das ist die Prüfung, die gefehlt
 * hat.
 *
 * WAS HIER NICHT PASSIERT, UND DAS EHRLICH GESAGT. Es läuft kein Browser und
 * kein Next-Server. `next/link` steht als Doppelgänger darin, der sich an den
 * dokumentierten Vertrag hält (`onNavigate` nur bei echter Navigation, nicht
 * bei Cmd-Klick), und die Zielseite ist ein Platzhalter. Was eine echte Seite
 * aus der Kennung macht, prüfen `purchase-draft.test.ts` (die Vorbelegung)
 * und `tools/verify-purchase-from-calculation.mts` gegen die echte
 * Staging-Datenbank (die Übernahme). Was hier geprüft wird, ist der Weg
 * dazwischen — und genau der war kaputt.
 */
import { act, createElement, type MouseEvent, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { de } from "@/lib/i18n/de";
import type { SavedCalculation } from "@/lib/calculator/saved";

const copy = de.calculator;

/* ------------------------------------------------------------- Doppelgänger */

/** Jede Navigation, die der Verweis ausgelöst hat — in der Reihenfolge. */
const navigations: string[] = [];

/**
 * `next/link`, so wie die Dokumentation ihn beschreibt.
 *
 * Drei Eigenschaften, auf die es hier ankommt: er rendert einen echten Anker
 * mit `href` (ein Browser könnte ihn also auch ohne JavaScript folgen), er
 * ruft `onNavigate` NUR bei einer echten client-seitigen Navigation, und mit
 * Modifikatortaste tut er nichts davon — dann öffnet der Browser einen neuen
 * Tab, und ein Dialog, der sich dabei schließt, wäre falsch.
 */
vi.mock("next/link", () => ({
  default: function LinkStandIn({
    href, onNavigate, onClick, children, ...rest
  }: {
    href: string;
    onNavigate?: (event: { preventDefault: () => void }) => void;
    onClick?: (event: MouseEvent) => void;
    children?: ReactNode;
  } & Record<string, unknown>) {
    return createElement(
      "a",
      {
        href,
        ...rest,
        onClick(event: MouseEvent) {
          onClick?.(event);
          /* Cmd/Ctrl/Shift/Alt: der Browser macht daraus einen neuen Tab,
             und `onNavigate` läuft laut Dokumentation nicht. */
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          let verhindert = false;
          onNavigate?.({ preventDefault() { verhindert = true; } });
          if (!verhindert) navigations.push(href);
        },
      },
      children,
    );
  },
}));

/** Zwei gespeicherte Kalkulationen: eine offen, eine schon übernommen. */
const OFFEN: SavedCalculation = {
  id: "11111111-2222-3333-4444-555555555555",
  name: "Magic Claw + 3 weitere",
  status: "review",
  lines: [
    {
      skyId: "SKY-0007", name: "Magic Claw", series: "swap", image: null,
      suggestedCents: 1200, unitCents: 1200, quantity: 2, manual: false,
    },
  ],
  factorPercent: 50,
  totalCents: 2400,
  positions: 1,
  units: 2,
  purchaseId: null,
  createdAt: "2026-10-22T10:00:00.000Z",
  updatedAt: "2026-10-22T10:00:00.000Z",
};

const UEBERNOMMEN: SavedCalculation = {
  ...OFFEN,
  id: "99999999-8888-7777-6666-555555555555",
  name: "Flohmarkt Linz",
  purchaseId: 4711,
};

const listCalculations = vi.fn(async () => ({
  ok: true as const, calculations: [OFFEN, UEBERNOMMEN],
}));
const createCalculation = vi.fn();
const updateCalculation = vi.fn();
const deleteCalculation = vi.fn();
const renameCalculation = vi.fn();

vi.mock("@/lib/calculator/saved-actions", () => ({
  listCalculations: () => listCalculations(),
  createCalculation: (...a: unknown[]) => createCalculation(...a),
  updateCalculation: (...a: unknown[]) => updateCalculation(...a),
  deleteCalculation: (...a: unknown[]) => deleteCalculation(...a),
  renameCalculation: (...a: unknown[]) => renameCalculation(...a),
  setCalculationStatus: vi.fn(),
}));

vi.mock("@/lib/calculator/actions", () => ({
  loadCalculatorContext: async () => ({
    catalog: [{
      skyId: "SKY-0007", name: "Magic Claw", rawName: null, series: "swap",
      image: null, marketPrice: 12, category: "Figuren",
    }],
    historicFactor: 48,
  }),
}));

/* ------------------------------------------------------------------- Gerüst */

let root: Root | null = null;
let container: HTMLDivElement | null = null;

/** Die Seite, die UNTER dem Dialog liegt — der Platzhalter fürs Orderbuch. */
function seiteDarunter(): HTMLElement {
  const main = document.createElement("main");
  main.id = "orderbuch";
  main.textContent = de.business.orderbook.newPurchase;
  document.body.appendChild(main);
  return main;
}

async function mount(node: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(node); });
}

/** Ein echter Klick, und danach alles abgearbeitet, was er ausgelöst hat. */
async function klick(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

/** Das Fenster, falls es offen ist. */
const dialog = () => document.querySelector('[role="dialog"]');

/** Einen Knopf oder Verweis über seinen sichtbaren Text finden. */
function nachText(text: string): HTMLElement {
  const treffer = [...document.querySelectorAll<HTMLElement>("button, a")]
    .filter((e) => (e.textContent ?? "").trim() === text);
  if (treffer.length === 0) throw new Error(`kein Bedienelement „${text}“`);
  return treffer[0];
}

/** Ein Bedienelement über sein `aria-label` finden — Knöpfe mit Zeichen. */
function nachLabel(label: string): HTMLElement {
  const treffer = document.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (treffer === null) throw new Error(`kein Bedienelement mit Label „${label}“`);
  return treffer;
}

function nachHref(href: string): HTMLAnchorElement {
  const treffer = document.querySelector<HTMLAnchorElement>(`a[href="${href}"]`);
  if (treffer === null) throw new Error(`kein Verweis auf ${href}`);
  return treffer;
}

/**
 * Das Fenster aufmachen und warten, bis es wirklich steht.
 *
 * `calculator-launcher.tsx` lädt das Fenster per `lazy` nach — im Browser
 * ein zweites Bündel, hier ein dynamischer Import. Deshalb zwei Dinge: der
 * Modul wird vorher einmal geholt (sonst steht er beim ersten Klick noch
 * nicht bereit), und danach wird auf den Dialog gewartet statt eine feste
 * Zahl von Runden zu raten.
 */
async function oeffne() {
  await import("./calculator-modal");
  const { CalculatorLauncher } = await import("./calculator-launcher");
  seiteDarunter();
  await mount(createElement(CalculatorLauncher));
  await klick(nachLabel(copy.openLabel));
  for (let runde = 0; runde < 60 && dialog() === null; runde += 1) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
  if (dialog() === null) throw new Error("der Kalkulator ist nicht aufgegangen");
}

/** Fenster öffnen und in die Liste der gespeicherten Kalkulationen wechseln. */
async function oeffneListe() {
  await oeffne();
  await klick(nachText(copy.savedListOpen(2)));
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  navigations.length = 0;
  window.localStorage.clear();
  vi.clearAllMocks();
  listCalculations.mockImplementation(async () => ({
    ok: true as const, calculations: [OFFEN, UEBERNOMMEN],
  }));
});

afterEach(async () => {
  if (root !== null) await act(async () => { root!.unmount(); });
  root = null;
  container = null;
  document.body.innerHTML = "";
  document.body.style.overflow = "";
  document.body.style.paddingRight = "";
});

/* ------------------------------------------------------- 1. Die Diagnose */

describe("1. warum der Klick aussah, als täte er nichts", () => {
  it("das Fenster liegt im Portal über ALLEM, nicht im Seitenbaum", async () => {
    /*
     * Der Befund, auf den alles andere zurückgeht. Der Dialog ist kein Kind
     * der Seite, sondern ein Kind von `document.body`, und er deckt mit
     * `fixed inset-0` die ganze Sichtfläche ab. Eine Navigation, die ihn
     * stehen lässt, wechselt die Seite UNTER einem deckenden Vorhang.
     */
    await oeffne();
    const seite = document.getElementById("orderbuch")!;

    const d = dialog();
    expect(d).not.toBeNull();
    /* Nicht im Container, in dem die Seite steckt. */
    expect(container!.contains(d!)).toBe(false);
    expect(seite.contains(d!)).toBe(false);
    const vorhang = d!.parentElement!;
    expect(vorhang.className).toContain("fixed inset-0 z-50");
    /* Und die Seite darunter kann nicht einmal rollen. */
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("er überlebt eine Navigation innerhalb von /business, weil er im Layout hängt", async () => {
    /*
     * KEIN RENDERPROBLEM, SONDERN DIE BAUMSTRUKTUR. `CalculatorLauncher`
     * steht in `site-nav.tsx`, und `site-nav` steht in
     * `(business)/layout.tsx`. Ein Weg von `/business/orderbuch` nach
     * `/business/orderbuch/neu` tauscht nur die Seite aus; das Layout — und
     * mit ihm der Zustand `open` — bleibt stehen. Deshalb MUSS der Dialog
     * sich beim Navigieren selbst schließen: niemand nimmt ihm das ab.
     */
    const { readFileSync } = await import("node:fs");
    const layout = readFileSync("src/app/(business)/layout.tsx", "utf8");
    expect(layout).toContain("<SiteNav");
    const nav = readFileSync("src/components/layout/site-nav.tsx", "utf8");
    expect(nav).toContain("<CalculatorLauncher />");
  });
});

/* ------------------------------------- 2. Der Klick, der ankommen muss */

describe("2. „Einkauf erstellen“ führt ins Orderbuch", () => {
  it("navigiert auf das bestehende Formular, mit der Kennung der Kalkulation", async () => {
    await oeffneListe();

    const ziel = `/business/orderbuch/neu?kalkulation=${OFFEN.id}`;
    await klick(nachHref(ziel));

    expect(navigations).toEqual([ziel]);
  });

  it("und lässt den Kalkulator nicht über der Zielseite stehen", async () => {
    /* DIE PRÜFUNG, DIE GEFEHLT HAT. */
    await oeffneListe();

    await klick(nachHref(`/business/orderbuch/neu?kalkulation=${OFFEN.id}`));

    expect(dialog()).toBeNull();
    expect(document.querySelector(".fixed.inset-0")).toBeNull();
  });

  it("gibt der Seite darunter das Rollen zurück", async () => {
    /*
     * Die zweite Hälfte desselben Fehlers: `Modal` sperrt
     * `body.style.overflow`, und die Sperre wird erst in der Aufräumung
     * gelöst. Ein Dialog, der offen bleibt, hinterlässt eine Seite, die
     * nicht scrollt — auf einem Telefon ist das der ganze Inhalt.
     */
    await oeffneListe();
    expect(document.body.style.overflow).toBe("hidden");

    await klick(nachHref(`/business/orderbuch/neu?kalkulation=${OFFEN.id}`));

    expect(document.body.style.overflow).not.toBe("hidden");
  });

  it("die Seite darunter steht danach frei", async () => {
    await oeffneListe();
    await klick(nachHref(`/business/orderbuch/neu?kalkulation=${OFFEN.id}`));

    const seite = document.getElementById("orderbuch");
    expect(seite).not.toBeNull();
    /* Kein Geschwisterelement mehr, das mit `fixed inset-0` darüber liegt. */
    expect([...document.body.children].some(
      (kind) => kind.className.includes("fixed inset-0"),
    )).toBe(false);
  });

  it("die richtige Kalkulation, nicht die erste in der Liste", async () => {
    /*
     * Zwei Einträge, und der zweite ist schon übernommen: an ihm steht
     * „Einkauf ansehen“ und eine andere Adresse. Dass jede Zeile ihre
     * eigene Kennung trägt, ist hier wirklich geklickt und nicht aus der
     * Quelle gelesen.
     */
    await oeffneListe();

    expect(nachHref(`/business/orderbuch/neu?kalkulation=${OFFEN.id}`).textContent)
      .toBe(copy.createPurchase);
    await klick(nachHref(`/business/orderbuch/${UEBERNOMMEN.purchaseId}`));
    expect(navigations).toEqual([`/business/orderbuch/${UEBERNOMMEN.purchaseId}`]);
    expect(dialog()).toBeNull();
  });

  it("eine übernommene Kalkulation bietet den Weg nicht zweimal an", async () => {
    await oeffneListe();

    /* Für die übernommene gibt es KEIN „Einkauf erstellen“. */
    expect(document.querySelector(
      `a[href="/business/orderbuch/neu?kalkulation=${UEBERNOMMEN.id}"]`,
    )).toBeNull();
    expect([...document.querySelectorAll("a")]
      .filter((a) => (a.textContent ?? "").trim() === copy.createPurchase),
    ).toHaveLength(1);
  });
});

/* ----------------------------------- 3. Was der Klick NICHT tun darf */

describe("3. der Weg legt keinen Einkauf an", () => {
  it("ist ein Verweis mit Adresse, keine Schaltfläche mit Serveraktion", async () => {
    await oeffneListe();

    const verweis = nachHref(`/business/orderbuch/neu?kalkulation=${OFFEN.id}`);
    expect(verweis.tagName).toBe("A");
    expect(verweis.closest("form")).toBeNull();
  });

  it("zweimal geklickt bleibt zweimal derselbe Weg und kein Vorgang", async () => {
    /*
     * Der Betreiber hat im Praxistest zweimal gedrückt. Beim zweiten Mal
     * ist das Fenster schon zu, also kann dort nichts mehr geklickt werden —
     * geprüft wird deshalb der härtere Fall: zwei Klicks auf denselben
     * Verweis, bevor irgendetwas aufgeräumt ist.
     */
    await oeffneListe();

    const ziel = `/business/orderbuch/neu?kalkulation=${OFFEN.id}`;
    const verweis = nachHref(ziel);
    await klick(verweis);
    /*
     * Nach dem ersten Klick ist das Fenster zu und dieser Anker nicht mehr
     * im Dokument — im Browser kann ihn niemand ein zweites Mal treffen, in
     * einem Test schon. Der Zuhörer hängt deshalb AM ANKER und nicht am
     * Dokument: das Ereignis blubbert aus einem abgehängten Knoten nicht
     * mehr bis dorthin. Er nimmt jsdom nur die Warnung weg; geprüft wird,
     * was dabei NICHT entsteht.
     */
    verweis.addEventListener("click", (e) => e.preventDefault(), { once: true });
    await klick(verweis);

    /* Kein Schreibvorgang — nicht einer. */
    expect(createCalculation).not.toHaveBeenCalled();
    expect(updateCalculation).not.toHaveBeenCalled();
    expect(deleteCalculation).not.toHaveBeenCalled();
    /* Und zweimal derselbe Weg, nicht zwei verschiedene. */
    expect(new Set(navigations)).toEqual(new Set([ziel]));
  });

  it("ein Cmd-Klick öffnet einen Tab und schließt das Fenster NICHT", async () => {
    /*
     * `onNavigate` läuft laut Dokumentation bei Modifikatortasten nicht —
     * der Browser macht daraus einen neuen Tab. Wer den Einkauf daneben
     * öffnet, will seine Kalkulation behalten.
     */
    await oeffneListe();

    const verweis = nachHref(`/business/orderbuch/neu?kalkulation=${OFFEN.id}`);
    /*
     * Genau das ist der Punkt: die Vorgabe des Ankers bleibt, der Browser
     * würde einen Tab öffnen. jsdom kann das nicht und schriebe eine
     * Warnung; der Zuhörer am DOKUMENT läuft zuletzt in der Blase — React
     * hat das Ereignis dann längst gesehen — und nimmt sie weg, ohne die
     * Prüfung zu entschärfen.
     */
    document.addEventListener("click", (e) => e.preventDefault(), { once: true });
    await act(async () => {
      verweis.dispatchEvent(new MouseEvent("click", {
        bubbles: true, cancelable: true, metaKey: true,
      }));
    });

    expect(navigations).toEqual([]);
    expect(dialog()).not.toBeNull();
  });
});

/* ------------------------------------ 4. Was unverändert zu sein hat */

describe("4. der Kalkulator selbst bleibt, wie er war", () => {
  it("schließen und wieder öffnen funktioniert weiterhin", async () => {
    await oeffne();
    expect(dialog()).not.toBeNull();

    /* Das Kreuz im Kopf. */
    await klick(nachLabel(copy.close));
    expect(dialog()).toBeNull();
    expect(document.body.style.overflow).not.toBe("hidden");

    await klick(nachLabel(copy.openLabel));
    expect(dialog()).not.toBeNull();
  });

  it("der Arbeitsstand übersteht das Schließen beim Navigieren", async () => {
    /*
     * Das Fenster geht zu, der Arbeitsstand nicht verloren: er liegt im
     * Browser (`draft.ts`), und das Schließen rührt ihn nicht an. Wer nach
     * dem Einkauf zurückkommt, findet seine Positionen vor.
     */
    await oeffneListe();

    /* Eine gespeicherte Kalkulation öffnen — damit steht etwas im Entwurf. */
    await klick(nachText(copy.savedOpen));
    const vorher = window.localStorage.getItem("skyisles.calculator.draft.v1");
    expect(vorher).not.toBeNull();
    expect(vorher).toContain("SKY-0007");

    await klick(nachText(copy.savedListOpen(2)));
    await klick(nachHref(`/business/orderbuch/neu?kalkulation=${OFFEN.id}`));

    expect(dialog()).toBeNull();
    expect(window.localStorage.getItem("skyisles.calculator.draft.v1")).toBe(vorher);
  });

  it("auf dem Telefon gibt es den Weg überhaupt (und mit 40 px)", async () => {
    /*
     * Der Ablauf selbst kennt keine Medienabfrage: geschlossen wird im
     * `onNavigate` desselben Verweises, auf jedem Gerät derselbe Code. Was
     * auf einem Telefon schiefgehen KÖNNTE, ist, dass der Verweis dort
     * nicht steht oder zu klein ist — und genau das steht hier.
     */
    await oeffneListe();
    const verweis = nachHref(`/business/orderbuch/neu?kalkulation=${OFFEN.id}`);

    /* Nicht erst ab `sm:` sichtbar. */
    expect(verweis.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    expect(verweis.className).not.toContain("sm:flex");
    expect(verweis.className).not.toContain("sm:inline");
    /* Und 40 px hoch, wie die Nachbarknöpfe in derselben Zeile. */
    expect(verweis.className).toContain("h-10");
    expect(verweis.className).toContain("min-h-10");
  });

  it("der Rückweg aus der Liste bleibt ein Rückweg und keine Navigation", async () => {
    await oeffneListe();

    await klick(nachText(copy.savedListBack));

    /* Dialog offen, Ansicht gewechselt, nichts navigiert. */
    expect(dialog()).not.toBeNull();
    expect(navigations).toEqual([]);
    /* Das Suchfeld steht wieder da, die Liste nicht mehr. */
    expect(document.querySelector(
      `input[placeholder="${copy.searchPlaceholder}"]`,
    )).not.toBeNull();
    expect(document.body.textContent).not.toContain(copy.savedListTitle);
  });
});
