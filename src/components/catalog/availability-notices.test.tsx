// @vitest-environment jsdom
/**
 * DIE MELDUNGSKARTEN, WIRKLICH GERENDERT UND WIRKLICH GEKLICKT
 * (Phase 4 S4, `0149`, ADR-0144).
 *
 * WARUM DIESE DATEI EXISTIEREN MUSS, und zwar als DOM-Test statt als
 * Quelltextvergleich. Die zentrale Zusage dieses Schritts ist eine
 * **negative**: „die Anzeige markiert keine Benachrichtigungen versehentlich
 * als gelesen". Ein Quelltextvergleich kann belegen, dass es kein
 * `useEffect` gibt — er kann nicht belegen, dass nach dem Rendern und nach
 * einem Klick auf den Weg zum Angebot **nichts** aufgerufen wurde. Das ist
 * die Lücke, die bei Calculator V3.1 zugeschlagen hat (ADR-0133), und dies
 * ist derselbe Riegel: React rendert in ein echtes DOM, es wird wirklich
 * gedrückt, und danach wird gefragt, was wirklich aufgerufen wurde.
 *
 * WAS HIER NICHT PASSIERT, EHRLICH GESAGT. Es läuft kein Browser und kein
 * Next-Server. `markNoticesRead` steht als Doppelgänger darin — geprüft wird
 * der WEG vom Klick zur Mutation, nicht die Mutation. Was die
 * Datenbankfunktion anrichtet, prüft Probelauf **P57** an echtem
 * PostgreSQL; die Quellzusagen stehen in `notification-ui.test.ts`.
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { de } from "@/lib/i18n/de";

/* ------------------------------------------------------------- Doppelgänger */

/** Jeder Aufruf, in der Reihenfolge. `undefined` heißt „alle". */
const markCalls: (readonly string[] | undefined)[] = [];
let antwort: { ok: true; marked: number } | { ok: false; reason: "failed" } =
  { ok: true, marked: 1 };

vi.mock("@/lib/favorites/notification-actions", () => ({
  markNoticesRead: async (skyIds?: readonly string[]) => {
    markCalls.push(skyIds);
    return antwort;
  },
}));

/* Was `next/link` hier sein muss: ein echter Anker. Der Klick darauf ist
   einer der geprüften Fälle — er darf nichts markieren. */
vi.mock("next/link", () => ({
  default: function LinkStandIn(
    { href, children, ...rest }: { href: string; children?: ReactNode } & Record<string, unknown>,
  ) {
    return createElement("a", { href, ...rest }, children);
  },
}));

/* ------------------------------------------------------------------ Fixtures */

type View = {
  skyId: string; name: string; slug: string; picture: string | null;
  cheapestCents: number; createdAt: string; read: boolean; stillBuyable: boolean;
};

function meldung(over: Partial<View> = {}): View {
  return {
    skyId: "SKY-0007",
    name: "Trigger Happy",
    slug: "trigger-happy",
    picture: null,
    cheapestCents: 1499,
    createdAt: "2026-10-26T09:00:00.000Z",
    read: false,
    stillBuyable: true,
    ...over,
  };
}

/* ------------------------------------------------------------------- Gerüst */

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount(node: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(node); });
}

async function klick(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

const text = (): string => container?.textContent ?? "";

/** Der „Gesehen"-Knopf einer Karte, über seinen vorgelesenen Namen. */
function gesehenKnopf(name = "Trigger Happy"): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[aria-label="${de.favorites.noticeMarkReadLabel(name)}"]`);
}

const alleKnopf = (): HTMLElement | null => {
  for (const b of document.querySelectorAll<HTMLElement>("button")) {
    if (b.textContent?.includes(de.favorites.noticesMarkAllRead)) return b;
  }
  return null;
};

beforeEach(() => {
  markCalls.length = 0;
  antwort = { ok: true, marked: 1 };
});

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  container?.remove();
  root = null;
  container = null;
});

/* ====================================================================== */

describe("die Meldungskarten", () => {
  /* Dynamisch geladen, damit die Mocks vor dem Modul stehen. */
  const laden = async () =>
    (await import("@/components/catalog/availability-notices")).AvailabilityNotices;

  it("zeigt Name, Zeitpunkt und den gemeldeten Preis", async () => {
    const Abschnitt = await laden();
    await mount(createElement(Abschnitt, { notices: [meldung()] }));
    expect(text()).toContain("Trigger Happy ist wieder verfügbar!");
    expect(text()).toContain("26.10.2026");
    expect(text()).toContain("14,99");
    expect(text()).toContain(de.favorites.noticeToOffer);
  });

  it("DAS RENDERN MARKIERT NICHTS", async () => {
    /*
     * DIE ZUSAGE DIESES SCHRITTS, als Messung. Gerendert, neu gerendert,
     * und danach ist `markNoticesRead` **nicht ein einziges Mal** gerufen
     * worden.
     */
    const Abschnitt = await laden();
    await mount(createElement(Abschnitt, { notices: [meldung(), meldung({ skyId: "SKY-0008", name: "Blue Bash", slug: "blue-bash" })] }));
    await act(async () => {
      root!.render(createElement(Abschnitt, { notices: [meldung()] }));
    });
    expect(markCalls).toEqual([]);
  });

  it("und der Klick auf den Weg zum Angebot markiert auch nichts", async () => {
    /*
     * Verlockend wäre es — wer das Angebot ansieht, HAT die Meldung
     * gesehen — und es wäre eine Markierung ohne Handlung.
     */
    const Abschnitt = await laden();
    await mount(createElement(Abschnitt, { notices: [meldung()] }));
    const weg = document.querySelector<HTMLElement>('a[href="/skylanders/trigger-happy"]');
    expect(weg).not.toBeNull();
    await klick(weg!);
    expect(markCalls).toEqual([]);
  });

  it("der Knopf an der Karte markiert GENAU diese Figur", async () => {
    const Abschnitt = await laden();
    await mount(createElement(Abschnitt, {
      notices: [meldung(), meldung({ skyId: "SKY-0008", name: "Blue Bash", slug: "blue-bash" })],
    }));
    await klick(gesehenKnopf()!);
    expect(markCalls).toEqual([["SKY-0007"]]);
  });

  it("und der Knopf am Kopf markiert alle — mit `undefined`, nicht mit einer Liste", async () => {
    /*
     * `undefined` heißt „alle eigenen ungelesenen". Eine LEERE Liste würde
     * nichts markieren, und genau diese Verwechslung wäre der stille Fehler.
     */
    const Abschnitt = await laden();
    await mount(createElement(Abschnitt, { notices: [meldung()] }));
    await klick(alleKnopf()!);
    expect(markCalls).toHaveLength(1);
    expect(markCalls[0]).toBeUndefined();
  });

  it("eine gelesene Karte hat keinen Knopf mehr und sagt, dass sie gesehen ist", async () => {
    const Abschnitt = await laden();
    await mount(createElement(Abschnitt, { notices: [meldung({ read: true })] }));
    expect(gesehenKnopf()).toBeNull();
    expect(text()).toContain(de.favorites.noticeRead);
    /* Sie bleibt stehen, und der Weg zum Angebot bleibt erreichbar. */
    expect(text()).toContain("Trigger Happy ist wieder verfügbar!");
    expect(document.querySelector('a[href="/skylanders/trigger-happy"]')).not.toBeNull();
  });

  it("ist alles gelesen, verschwindet der Knopf am Kopf", async () => {
    const Abschnitt = await laden();
    await mount(createElement(Abschnitt, { notices: [meldung({ read: true })] }));
    expect(alleKnopf()).toBeNull();
    expect(text()).toContain("Alles gesehen.");
  });

  it("ohne Angebot verspricht die Karte keine Kaufbarkeit", async () => {
    const Abschnitt = await laden();
    await mount(createElement(Abschnitt, { notices: [meldung({ stillBuyable: false })] }));
    expect(text()).toContain(de.favorites.noticeGone);
    expect(text()).toContain(de.favorites.noticeToFigure);
    expect(text()).not.toContain(de.favorites.noticeToOffer);
  });

  it("ohne Meldungen rendert der Abschnitt nichts", async () => {
    const Abschnitt = await laden();
    await mount(createElement(Abschnitt, { notices: [] }));
    expect(container?.innerHTML).toBe("");
  });

  it("ein Fehler beim Markieren wird angezeigt und sperrt nichts dauerhaft", async () => {
    antwort = { ok: false, reason: "failed" };
    const Abschnitt = await laden();
    await mount(createElement(Abschnitt, { notices: [meldung()] }));
    await klick(gesehenKnopf()!);
    expect(text()).toContain(de.favorites.noticeMarkFailed);
    /* Der Knopf ist wieder bedienbar — ein zweiter Versuch muss gehen. */
    const knopf = gesehenKnopf() as HTMLButtonElement | null;
    expect(knopf).not.toBeNull();
    expect(knopf!.disabled).toBe(false);
    await klick(knopf!);
    expect(markCalls).toHaveLength(2);
  });

  it("die Unterzeile zählt die ungelesenen", async () => {
    const Abschnitt = await laden();
    await mount(createElement(Abschnitt, {
      notices: [meldung(), meldung({ skyId: "SKY-0008", slug: "blue-bash", read: true })],
    }));
    expect(text()).toContain("1 neue Meldung.");
  });

  it("jede Handlung hat einen vorgelesenen Namen, der die Figur nennt", async () => {
    const Abschnitt = await laden();
    await mount(createElement(Abschnitt, { notices: [meldung()] }));
    expect(gesehenKnopf()?.getAttribute("aria-label")).toContain("Trigger Happy");
    expect(document.querySelector('a[href="/skylanders/trigger-happy"]')
      ?.getAttribute("aria-label")).toContain("Trigger Happy");
  });
});
