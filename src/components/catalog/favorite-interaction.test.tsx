// @vitest-environment jsdom
/**
 * DER KLICK AUF DAS HERZ, WIRKLICH AUSGEFÜHRT (0145, ADR-0136).
 *
 * WARUM DIESE DATEI EXISTIEREN MUSS, und zwar als DOM-Test statt als
 * Quelltextvergleich. Seit ADR-0038 IST die gesamte Katalogkarte der
 * Sammeln-Toggle. Ein Herz darauf ist damit kein Zusatz, sondern ein zweiter
 * Anspruch auf dieselbe Fläche — und „das Herz darf niemals den
 * Gesammelt-Toggle auslösen" ist eine Aussage über das, was nach einem Klick
 * geschieht. Kein Quelltextvergleich kann sie prüfen: der Text sagt, dass es
 * zwei Handler gibt, nicht, welcher läuft.
 *
 * Das ist genau die Lücke, die bei Calculator V3.1 zugeschlagen hat (ADR-0133),
 * und dies ist derselbe Riegel: React rendert in ein echtes DOM, der Knopf
 * wird wirklich gedrückt, und danach wird gefragt, was wirklich aufgerufen
 * wurde.
 *
 * WAS HIER NICHT PASSIERT, EHRLICH GESAGT. Es läuft kein Browser und kein
 * Next-Server. `setFavorite` und `setCollected` stehen als Doppelgänger
 * darin — geprüft wird also der WEG vom Klick zur Mutation, nicht die
 * Mutation. Was `setFavorite` in der Datenbank anrichtet, prüft Probelauf
 * **P52** an echtem PostgreSQL; dass die Richtlinien greifen, prüft
 * `npm run verify:rls:staging`. Was hier geprüft wird, ist das Stück
 * dazwischen — und genau dort lag der Fehler letztes Mal.
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { de } from "@/lib/i18n/de";
import type { CatalogFigure } from "@/lib/catalog/types";

/* ------------------------------------------------------------- Doppelgänger */

/** Jeder Aufruf, in der Reihenfolge: welche Figur, welcher Endzustand. */
const favoriteCalls: [string, boolean][] = [];
const collectedCalls: [string, boolean][] = [];

/** Was der nächste `setFavorite`-Aufruf antworten soll. */
let favoriteAntwort: { ok: true } | { ok: false; reason: "failed" } = { ok: true };

vi.mock("@/lib/favorites/actions", () => ({
  setFavorite: async (skyId: string, favorite: boolean) => {
    favoriteCalls.push([skyId, favorite]);
    return favoriteAntwort;
  },
}));

vi.mock("@/lib/collection/actions", () => ({
  setCollected: async (skyId: string, collected: boolean) => {
    collectedCalls.push([skyId, collected]);
    return { ok: true as const };
  },
}));

/* Was `next/link` hier sein muss: ein echter Anker. Mehr braucht keiner
   dieser Fälle — geklickt wird das Herz, nicht ein Verweis. */
vi.mock("next/link", () => ({
  default: function LinkStandIn(
    { href, children, ...rest }: { href: string; children?: ReactNode } & Record<string, unknown>,
  ) {
    return createElement("a", { href, ...rest }, children);
  },
}));

/* ------------------------------------------------------------------ Fixtures */

function figur(skyId: string, name: string): CatalogFigure {
  return {
    skyId, name, slug: skyId.toLowerCase(),
    seriesCode: "SA", seriesLabel: "Spyro's Adventure",
    seriesPosition: 0, categoryPosition: 0, categoryName: "Figuren", categoryId: 1,
    catalogGroup: "figure", cardType: "standard", catalogVisible: true,
    canonicalName: "", displayNameOverride: null, marketPrice: 12,
    imageFile: null, imageOverridePath: null,
    displayName: name, sortBaseName: name, sortVariantLabel: null,
    searchIndex: name.toLowerCase(), isActive: true, element: null, characterId: null,
  };
}

/** Basisfigur und Variante — zwei SKY-IDs, derselbe Charakter (ADR-0034). */
const BASIS = figur("SKY-0001", "Spyro");
const VARIANTE = { ...figur("SKY-0002", "Spyro"), sortVariantLabel: "Legendary" };

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

/** Alle Herzen auf dem Schirm, in DOM-Reihenfolge. */
function herzen(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(
    `[aria-label="${de.catalog.favoriteHint}"], [aria-label="${de.catalog.unfavoriteHint}"],`
    + `[aria-label="${de.catalog.favoriteSignedOut}"]`)];
}

const herz = (): HTMLElement => {
  const alle = herzen();
  if (alle.length === 0) throw new Error("kein Herz auf dem Schirm");
  return alle[0];
};

/** Der Kartenkörper — das Element, das seit ADR-0038 der Toggle IST. */
function kartenkoerper(): HTMLElement {
  const treffer = document.querySelector<HTMLElement>(
    `[aria-label="${de.catalog.collect}"], [aria-label="${de.catalog.collectedHint}"]`);
  if (treffer === null) {
    /* Der Körper trägt kein `aria-label`, sondern den Toggle-Text. Dann der
       Weg über die Rolle: `FigureCard` macht daraus einen Knopf. */
    const knopf = document.querySelector<HTMLElement>("article button");
    if (knopf === null) throw new Error("kein Kartenkörper gefunden");
    return knopf;
  }
  return treffer;
}

async function karte(props: Record<string, unknown>) {
  const { CatalogCard } = await import("./catalog-card");
  await mount(createElement(CatalogCard, {
    figure: BASIS, initialCollected: false, signInHref: null, favorites: true, ...props,
  } as never));
}

beforeEach(() => {
  favoriteCalls.length = 0;
  collectedCalls.length = 0;
  favoriteAntwort = { ok: true };
});

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  container?.remove();
  container = null;
  document.body.innerHTML = "";
});


describe("das Herz löst NIEMALS den Gesammelt-Toggle aus", () => {
  it("ein Klick aufs Herz merkt vor — und sammelt nichts", async () => {
    /*
     * DER TEST, UM DEN ES IN DIESER DATEI GEHT.
     *
     * Die Karte ist der Sammeln-Toggle. Läge das Herz IN ihrem Körper, wäre
     * `collectedCalls` hier nicht leer — und niemand hätte es gemerkt, weil
     * `setFavorite` trotzdem richtig aufgerufen würde.
     */
    await karte({});
    await klick(herz());

    expect(favoriteCalls).toEqual([["SKY-0001", true]]);
    expect(collectedCalls, "das Herz hat gesammelt").toEqual([]);
  });

  it("und umgekehrt: ein Klick auf die Karte sammelt und merkt nichts vor", async () => {
    await karte({});
    await klick(kartenkoerper());

    expect(collectedCalls).toEqual([["SKY-0001", true]]);
    expect(favoriteCalls, "die Karte hat vorgemerkt").toEqual([]);
  });

  it("das Herz liegt als GESCHWISTER über dem Körper, nicht darin", async () => {
    /*
     * Die strukturelle Hälfte derselben Aussage. Der Grund, dass der Klick
     * oben nicht durchschlägt, ist kein `stopPropagation` — es ist die
     * Baumform. Wäre das Herz ein Kind des Toggles, bliebe der Test oben nur
     * so lange grün, wie das `stopPropagation` steht.
     */
    await karte({});
    const koerper = kartenkoerper();
    expect(koerper.contains(herz()), "das Herz ist ein Kind des Toggles").toBe(false);
  });

  it("die Ebene über der Karte lässt Klicks durch, wo kein Herz ist", async () => {
    /*
     * Die andere Richtung derselben Gefahr: eine Überlagerung, die den
     * ganzen oberen Kartenrand abfängt, nähme dem Sammeln seine Fläche.
     * `pointer-events-none` an der Ebene, `auto` nur am Knopf.
     */
    await karte({});
    const ebene = herz().closest("[data-slot]")?.parentElement;
    expect(ebene?.className ?? "").toContain("pointer-events-none");
    expect(herz().className).toContain("pointer-events-auto");
  });
});


describe("Endzustand, nicht Umschalten", () => {
  it("zwei Klicks sagen „vorgemerkt“ und „nicht vorgemerkt“, nicht zweimal dasselbe", async () => {
    await karte({});
    await klick(herz());
    await klick(herz());
    expect(favoriteCalls).toEqual([["SKY-0001", true], ["SKY-0001", false]]);
  });

  it("ein Doppeltipp im Flug schreibt zwei Endzustände, keinen Kipp-Zustand", async () => {
    /*
     * Auf einem Telefon ist ein Herz klein und wird doppelt getippt. Jeder
     * Tipp nennt den Zustand, der gelten soll — ein Umschalten („lies, dann
     * kipp") hätte zweimal denselben Startwert gelesen und zweimal dasselbe
     * geschrieben (ADR-0027).
     */
    await karte({});
    const h = herz();
    await act(async () => {
      h.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      h.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(favoriteCalls.map(([, wert]) => wert)).toEqual([true, false]);
  });

  it("das Herz füllt sich sofort und sagt seinen Zustand an", async () => {
    await karte({});
    expect(herz().getAttribute("aria-pressed")).toBe("false");
    await klick(herz());
    expect(herz().getAttribute("aria-pressed")).toBe("true");
    expect(herz().getAttribute("aria-label")).toBe(de.catalog.unfavoriteHint);
  });

  it("eine bereits vorgemerkte Figur startet mit gefülltem Herz", async () => {
    await karte({ initialFavorited: true });
    expect(herz().getAttribute("aria-pressed")).toBe("true");
  });
});


describe("ein Serverfehler bleibt nicht als falscher Zustand stehen", () => {
  it("das Herz springt zurück", async () => {
    /*
     * „Kein Optimistic-UI-Zustand, der bei Serverfehlern dauerhaft falsch
     * bleibt." Ein gefülltes Herz behauptet, etwas sei gespeichert — das ist
     * schlimmer als eine Fehlermeldung.
     */
    favoriteAntwort = { ok: false, reason: "failed" };
    await karte({});
    await klick(herz());
    expect(favoriteCalls).toEqual([["SKY-0001", true]]);
    expect(herz().getAttribute("aria-pressed")).toBe("false");
  });

  it("und sagt es auch, nicht nur still zurück", async () => {
    favoriteAntwort = { ok: false, reason: "failed" };
    await karte({});
    await klick(herz());
    expect(document.body.textContent).toContain(de.catalog.favoriteFailed);
  });

  it("die Meldung nach oben kommt ZWEIMAL — hin und zurück", async () => {
    /*
     * Der Teil, an dem die Wunschliste hängt. Verschwindet die Karte
     * optimistisch aus der Liste und scheitert der Aufruf, kann das Herz
     * nichts mehr richtigstellen — es ist nicht mehr auf dem Schirm.
     * Deshalb meldet es den Rücksprung ebenfalls nach oben.
     */
    favoriteAntwort = { ok: false, reason: "failed" };
    const gemeldet: [string, boolean][] = [];
    await karte({
      initialFavorited: true,
      onFavoritedChange: (skyId: string, fav: boolean) => gemeldet.push([skyId, fav]),
    });
    await klick(herz());
    expect(gemeldet).toEqual([["SKY-0001", false], ["SKY-0001", true]]);
  });
});


describe("Varianten sind getrennte Favoriten", () => {
  it("zwei Karten, zwei SKY-IDs, zwei Herzen", async () => {
    const { CatalogCard } = await import("./catalog-card");
    await mount(createElement("div", null,
      createElement(CatalogCard, {
        key: "a", figure: BASIS, initialCollected: false, signInHref: null,
        favorites: true, initialFavorited: true,
      } as never),
      createElement(CatalogCard, {
        key: "b", figure: VARIANTE, initialCollected: false, signInHref: null,
        favorites: true, initialFavorited: false,
      } as never),
    ));

    const alle = herzen();
    expect(alle).toHaveLength(2);
    /* Die Basisfigur ist vorgemerkt, die Legendary nicht — obwohl beide
       „Spyro“ heissen. Die Identität ist die SKY-ID (ADR-0002, ADR-0034). */
    expect(alle.map((h) => h.getAttribute("aria-pressed"))).toEqual(["true", "false"]);

    await klick(alle[1]);
    expect(favoriteCalls).toEqual([["SKY-0002", true]]);
  });
});


describe("wer kein Herz bekommt", () => {
  it("ausgeloggt ist es ein Verweis in die Anmeldung und schreibt nichts", async () => {
    await karte({ signInHref: "/login?next=%2F" });
    const h = herz();
    expect(h.tagName).toBe("A");
    expect(h.getAttribute("href")).toBe("/login?next=%2F");
    await klick(h);
    expect(favoriteCalls, "ausgeloggt wurde geschrieben").toEqual([]);
  });

  it("ein Administrator sieht gar kein Herz — auch kein leeres", async () => {
    /*
     * Ein Betriebs- oder Adminkonto sammelt nicht im eigenen Katalog
     * (ADR-0042), und `0145` weist es über `is_collector_account()` ab. Ein
     * leeres Herz wäre ein Knopf, der nur scheitern kann — und zugleich eine
     * Aussage („nicht vorgemerkt“), die dort gar nicht gilt.
     */
    await karte({ admin: true, favorites: true });
    expect(herzen()).toHaveLength(0);
  });

  it("und eine Fläche ohne Favoritenwissen zeigt keins", async () => {
    await karte({ favorites: false });
    expect(herzen()).toHaveLength(0);
  });
});


describe("die Wunschliste verliert eine Karte im SELBEN Bild", () => {
  /**
   * Die Zusage aus dem Auftrag: „Prüfe, dass Favoriten auf der Wunschliste
   * beim Entfernen sofort korrekt aus der Ansicht verschwinden."
   *
   * Geprüft wird an `CatalogView` mit `favoritesOnly`, also an genau dem,
   * was `/favoriten` rendert — nicht an einer nachgebauten Liste. Die Seite
   * selbst reicht nur Daten durch; ein Test an ihr würde beweisen, dass sie
   * Props setzt, nicht dass die Karte verschwindet.
   */
  async function wunschliste(onServerFehler = false) {
    favoriteAntwort = onServerFehler ? { ok: false, reason: "failed" } : { ok: true };
    const { CatalogView } = await import("./catalog-view");
    await mount(createElement(CatalogView, {
      figures: [BASIS, VARIANTE],
      series: [{ code: "SA", label: "Spyro's Adventure", position: 0 }],
      ownedSkyIds: [],
      favoritedSkyIds: ["SKY-0001", "SKY-0002"],
      favorites: true,
      favoritesOnly: true,
      signedIn: true,
      highlightSkyId: null,
    } as never));
  }

  /** Wie viele Karten das Raster gerade zeichnet. */
  const karten = () => document.querySelectorAll("article").length;

  it("zwei vorgemerkte Figuren, zwei Karten", async () => {
    await wunschliste();
    expect(karten()).toBe(2);
    expect(herzen()).toHaveLength(2);
  });

  it("das Herz ausmachen nimmt die Karte sofort mit", async () => {
    await wunschliste();
    await klick(herzen()[0]);
    /*
     * KEIN WARTEN AUF DEN SERVER. Die Liste filtert gegen die optimistische
     * Menge in `CatalogView` — dieselbe Mechanik, die der Besitzfilter seit
     * V4.3 benutzt. Stünde die Karte hier noch, müsste jemand neu laden, um
     * zu sehen, was er gerade getan hat.
     */
    expect(karten()).toBe(1);
    expect(favoriteCalls).toEqual([["SKY-0001", false]]);
  });

  it("und ein Serverfehler bringt sie zurück", async () => {
    /*
     * Die andere Hälfte, und die wichtigere: eine Karte, die verschwunden
     * ist, weil ein Aufruf scheiterte, wäre ein stiller Datenverlust auf dem
     * Schirm. Ihr Herz kann es nicht richtigstellen — es ist nicht mehr da.
     * Deshalb meldet `FavoriteHeart` den Rücksprung nach oben.
     */
    await wunschliste(true);
    await klick(herzen()[0]);
    expect(karten(), "die Karte ist fort geblieben").toBe(2);
  });

  it("die andere Karte bleibt unberührt", async () => {
    await wunschliste();
    await klick(herzen()[0]);
    expect(document.body.textContent).toContain("Legendary");
  });

  it("im Katalog dagegen bleibt die Karte stehen", async () => {
    /*
     * Dieselbe Komponente, `favoritesOnly` aus: ein Herz, das im Katalog
     * ausgeht, nimmt die Figur nicht aus dem Katalog. Die Liste dort filtert
     * nicht nach Favoriten, und das ist der ganze Unterschied zwischen den
     * beiden Seiten.
     */
    const { CatalogView } = await import("./catalog-view");
    await mount(createElement(CatalogView, {
      figures: [BASIS, VARIANTE],
      series: [{ code: "SA", label: "Spyro's Adventure", position: 0 }],
      ownedSkyIds: [],
      favoritedSkyIds: ["SKY-0001"],
      favorites: true,
      signedIn: true,
      highlightSkyId: null,
    } as never));
    expect(karten()).toBe(2);
    await klick(herzen()[0]);
    expect(karten()).toBe(2);
  });
});
