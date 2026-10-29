/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import type { CatalogFigure } from "@/lib/catalog/types";

/*
 * Die Serveraktion wird hier nie gedrückt — geprüft wird, WAS gezeichnet
 * wird. Sie muss aber auflösbar sein, weil `card-actions.tsx` sie importiert.
 */
vi.mock("@/lib/admin/actions", () => ({
  setCatalogStatus: async () => ({ ok: true }),
}));

/**
 * UX-01G — EINE KACHEL, DREI ROLLEN.
 *
 * WAS DER BETREIBER VERLANGT HAT, als Matrix:
 *
 *   user      Glocke · Info · Herz
 *   business  Info
 *   admin     Info · Stift · Auge
 *
 * UND WAS DAS NICHT IST: eine Berechtigung. Jede Schreibhandlung dahinter
 * fragt ihr Recht in der Datenbank — `setCollected` an den Richtlinien von
 * `collection_items`, das Herz an `favorite_demand()`, das Auge an
 * `is_platform_admin()` in `admin_set_catalog_status`. Diese Datei prüft, was
 * GEZEICHNET wird; dass das Ausblenden keine Grenze ist, steht in
 * `three-accounts.test.ts` und in den Migrationen.
 */

const FIGUR: CatalogFigure = {
  skyId: "SKY-0001", name: "Spyro", slug: "sky-0001",
  seriesCode: "SA", seriesLabel: "Spyro's Adventure",
  seriesPosition: 0, categoryPosition: 0, categoryName: "Figuren", categoryId: 1,
  catalogGroup: "figure", cardType: "standard", catalogVisible: true,
  canonicalName: "", displayNameOverride: null, marketPrice: 12,
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

afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  root = null; container = null;
  vi.restoreAllMocks();
});

/** Jede Schaltfläche der Aktionsleiste, an ihrem zugänglichen Namen. */
const namen = () => [...document.querySelectorAll("button, a")]
  .map((e) => e.getAttribute("aria-label") ?? e.textContent ?? "")
  .filter((t) => t.trim() !== "");

describe("die Aktionsleiste der Kachel folgt der Kontoart", () => {
  it("ein SAMMLER bekommt Glocke, Info und Herz", async () => {
    const { CatalogCard } = await import("./catalog-card");
    await mount(createElement(CatalogCard, {
      figure: FIGUR, initialCollected: false, signInHref: null,
      accountType: "user", favorites: true,
    } as never));
    const t = namen().join(" | ");
    /* Die Info-Marke führt zur Figur. */
    expect(document.querySelector('a[href="/skylanders/sky-0001"]')).not.toBeNull();
    /* Das Herz ist ein Schalter mit Zustand. */
    expect(document.querySelector('button[aria-pressed]')).not.toBeNull();
    /* Und die Glocke ist da — vorbereitet und deaktiviert, solange `0150`
       nirgends angewendet ist (UX-01E). */
    expect(t.toLowerCase()).toContain("benachricht");
    /* Kein Stift, kein Auge. */
    expect(t).not.toContain("bearbeiten");
    expect(t).not.toContain("verstecken");
  });

  it("ein BETRIEBSKONTO bekommt nur die Info — kein Herz, keine Glocke, kein Sammeln",
     async () => {
    const { CatalogCard } = await import("./catalog-card");
    await mount(createElement(CatalogCard, {
      figure: FIGUR, initialCollected: false, signInHref: null,
      accountType: "business", favorites: true,
    } as never));
    const t = namen().join(" | ").toLowerCase();
    expect(document.querySelector('a[href="/skylanders/sky-0001"]')).not.toBeNull();
    expect(t).not.toContain("benachricht");
    expect(t).not.toContain("merken");
    expect(t).not.toContain("bearbeiten");
    /*
     * UND KEIN SAMMELKNOPF. Das ist der Fehler, den UX-01G mitnimmt: bis
     * hierher kam jedes Konto, das nicht `admin` war, und bekam einen
     * Sammelknopf, den `0145` über `is_collector_account()` ablehnt.
     */
    expect(document.querySelector("button[aria-pressed]")).toBeNull();
  });

  it("ein ADMINKONTO bekommt Info, Stift und Auge", async () => {
    const { CatalogCard } = await import("./catalog-card");
    await mount(createElement(CatalogCard, {
      figure: FIGUR, initialCollected: false, signInHref: null,
      accountType: "admin", admin: true, onEdit: () => {},
    } as never));
    const t = namen().join(" | ");
    expect(document.querySelector('a[href="/skylanders/sky-0001"]')).not.toBeNull();
    expect(t).toContain("Spyro bearbeiten");
    expect(t).toContain("Spyro verstecken");
    /* Kein Herz und keine Glocke: ein Betreiber sammelt nicht aus dem
       eigenen Katalog (ADR-0042). */
    expect(t.toLowerCase()).not.toContain("benachricht");
    expect(t.toLowerCase()).not.toContain("merken");
  });

  it("und das Auge einer versteckten Figur sagt „sichtbar machen“", async () => {
    const { CatalogCard } = await import("./catalog-card");
    await mount(createElement(CatalogCard, {
      figure: { ...FIGUR, catalogVisible: false, catalogStatus: "hidden" },
      initialCollected: false, signInHref: null,
      accountType: "admin", admin: true, visible: false, onEdit: () => {},
    } as never));
    expect(namen().join(" | ")).toContain("Spyro sichtbar machen");
  });

  it("auf einem ENTWURF ist das Auge aus — veröffentlichen ist eine eigene Entscheidung",
     async () => {
    const { CatalogCard } = await import("./catalog-card");
    await mount(createElement(CatalogCard, {
      figure: { ...FIGUR, catalogVisible: false, catalogStatus: "draft" },
      initialCollected: false, signInHref: null,
      accountType: "admin", admin: true, visible: false, onEdit: () => {},
    } as never));
    const auge = [...document.querySelectorAll("button")]
      .find((b) => (b.getAttribute("aria-label") ?? "").includes("sichtbar machen"));
    expect(auge).toBeDefined();
    expect(auge!.disabled).toBe(true);
  });
});

describe("eine Darstellung, und sie steht im Server fest", () => {
  const view = readFileSync("src/components/catalog/catalog-view.tsx", "utf8");
  const card = readFileSync("src/components/catalog/catalog-card.tsx", "utf8");

  it("der Katalog zeichnet die Kachel, für jede Rolle", () => {
    expect(view).toContain('const layout = "row" as const;');
    expect(view).toContain('const gridMode = "rows" as const;');
    /* Am CODE gemessen: der Kommentar daneben zitiert die alte Zeile. */
    const ohneProsa = view.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(ohneProsa).not.toContain('admin ? "card"');
    expect(ohneProsa).not.toContain("layoutFor(");
  });

  it("die Rolle kommt aus der Datenbank, nicht aus dem Browser", () => {
    /* `my_capabilities` leitet sie ab; die Route liest sie und gibt sie
       weiter. Ein Wert aus dem Browser wäre eine Behauptung. */
    const route = readFileSync("src/app/(public)/(catalog)/page.tsx", "utf8");
    expect(route).toContain("await capabilities()");
    expect(route).toContain("accountType={accountType}");
    expect(view).toContain("accountType={accountType}");
  });

  it("und die Kachel entscheidet daran, was sie zeichnet", () => {
    expect(card).toContain('const bell = accountType === "user"');
    expect(card).toContain('favorites && accountType === "user"');
    expect(card).toContain('const sammelt = accountType === "user";');
  });

  it("die alte Sammelkarte bleibt, wo sie gebraucht wird", () => {
    /* AUFGABE 4 und ihre Grenze: die Sammlung und der Shop zeichnen sie
       weiter, also wird sie nicht gelöscht. Nur der Katalog zeichnet sie
       nicht mehr. */
    expect(readFileSync("src/components/collection/collection-view.tsx", "utf8"))
      .toContain("<FigureCard");
    expect(view).not.toContain("<FigureCard");
  });
});
