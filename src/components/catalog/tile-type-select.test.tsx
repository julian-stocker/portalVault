/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import type { CatalogFigure } from "@/lib/catalog/types";

/*
 * DIE SERVERAKTION WIRD HIER WIRKLICH GEDRÜCKT. Nur an ihrem Argument ist zu
 * sehen, dass das Dropdown den sichtbaren Type schickt und sonst nichts —
 * insbesondere keine Typmenge und keine Kartenkunst.
 */
type Antwort = { ok: true } | { ok: false; message: string };
const setBanner = vi.fn(
  async (_skyId: string, _type: string | null): Promise<Antwort> => ({ ok: true }));

vi.mock("@/lib/admin/actions", () => ({
  setCatalogStatus: async () => ({ ok: true }),
  setMarketPrice: async () => ({ ok: true }),
  deleteFigure: async () => ({ ok: true }),
  setVisibleType: (skyId: string, type: string | null) => setBanner(skyId, type),
}));

/**
 * CAT-10 an der Kachel — das Dropdown und das Banner.
 *
 * DIE DREI ZUSAGEN, die hier und nirgends sonst gemessen werden:
 *
 *   1. Das Dropdown bietet „–" plus die HINTERLEGTEN Types an — nie alle
 *      siebzehn. Wären es alle, wäre es ein zweiter Weg zur Typmenge, und
 *      den gibt es nur im Bearbeiten-Dialog.
 *   2. Das Banner erscheint für JEDE Rolle gleich, und das Dropdown nur für
 *      den Administrator.
 *   3. Eine unentschiedene Zeile zeigt KEIN Banner — auch dann nicht, wenn
 *      die Priorität einen Vorschlag hätte (Entscheidung D4).
 */

const FIGUR: CatalogFigure = {
  skyId: "SKY-0001", name: "Chill", slug: "sky-0001",
  seriesCode: "SA", seriesLabel: "Spyro's Adventure",
  seriesPosition: 0, categoryPosition: 0, categoryName: "Figuren", categoryId: 1,
  catalogGroup: "figure", cardType: "legendary", catalogVisible: true,
  canonicalName: "", displayNameOverride: null, marketPrice: 12,
  imageFile: null, imageOverridePath: null,
  displayName: "Chill", sortBaseName: "Chill", sortVariantLabel: null,
  searchIndex: "chill", isActive: true, element: null, characterId: null,
  baseSkyId: null,
  types: ["lightcore", "legendary"], visibleType: "legendary",
  visibleTypeDecided: true,
} as CatalogFigure;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount(node: Parameters<Root["render"]>[0]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(node); });
}

beforeEach(() => { setBanner.mockClear(); });

afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  root = null; container = null;
  vi.restoreAllMocks();
});

async function kachel(zusatz: Record<string, unknown> = {},
                      props: Record<string, unknown> = {}) {
  const { CatalogCard } = await import("./catalog-card");
  await mount(createElement(CatalogCard, {
    figure: { ...FIGUR, ...zusatz }, initialCollected: false, signInHref: null,
    accountType: "admin", admin: true, onEdit: () => {}, ...props,
  } as never));
}

const auswahl = () => document.querySelector("select") as HTMLSelectElement | null;
const optionen = () => [...(auswahl()?.options ?? [])].map((o) => o.value);
const banner = () => [...document.querySelectorAll("span")]
  .find((e) => e.className.includes("font-mono")
            && e.className.includes("uppercase"));

// ===========================================================================
// 1. DAS DROPDOWN
// ===========================================================================
describe("das Dropdown bietet nur an, was hinterlegt ist", () => {
  it("„–“ plus die zwei Types dieser Figur — und keinen dritten", async () => {
    await kachel();
    expect(auswahl()).not.toBeNull();
    expect(optionen()).toEqual(["", "lightcore", "legendary"]);
  });

  it("NIEMALS alle siebzehn", async () => {
    const { CATALOG_TYPES } = await import("@/lib/catalog/catalog-type");
    await kachel();
    expect(optionen().length).toBeLessThan(CATALOG_TYPES.length);
    for (const t of ["giant", "trap", "chase", "prestige"]) {
      expect(optionen(), t).not.toContain(t);
    }
  });

  it("es zeigt den gewählten Type als Wert", async () => {
    await kachel();
    expect(auswahl()!.value).toBe("legendary");
  });

  it("eine Figur OHNE Types bekommt kein Dropdown, sondern einen Satz",
     async () => {
    /* Ein Auswahlfeld mit genau einem Eintrag („–") wäre ein Bedienelement,
       das nichts kann. */
    await kachel({ types: [], visibleType: null, visibleTypeDecided: false });
    expect(auswahl()).toBeNull();
    expect(document.body.textContent).toContain("keine Types");
  });

  it("eine Auswahl schickt den Type — und NUR ihn", async () => {
    await kachel();
    const s = auswahl()!;
    await act(async () => {
      s.value = "lightcore";
      s.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(setBanner).toHaveBeenCalledWith("SKY-0001", "lightcore");
    expect(setBanner).toHaveBeenCalledTimes(1);
  });

  it("„–“ schickt null — eine ENTSCHEIDUNG, kein Leerzustand", async () => {
    await kachel();
    const s = auswahl()!;
    await act(async () => {
      s.value = "";
      s.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(setBanner).toHaveBeenCalledWith("SKY-0001", null);
  });

  it("eine fehlgeschlagene Speicherung nimmt die Anzeige zurück und sagt den "
     + "Grund", async () => {
    setBanner.mockImplementationOnce(async () => ({
      ok: false, message: "Dieser Type ist der Figur nicht zugeordnet.",
    }));
    await kachel();
    const s = auswahl()!;
    await act(async () => {
      s.value = "lightcore";
      s.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(document.querySelector('[role="alert"]')?.textContent)
      .toContain("nicht zugeordnet");
    /* Und der alte Wert steht wieder da. */
    expect(auswahl()!.value).toBe("legendary");
  });

  /*
   * DER VORSCHLAG IST EIN KNOPF UND KEIN BANNER (Entscheidung D4). Solange
   * niemand entschieden hat, steht er daneben; ein Druck darauf IST die
   * Entscheidung.
   */
  it("eine unentschiedene Zeile bekommt einen Vorschlag — als Knopf", async () => {
    await kachel({ visibleType: null, visibleTypeDecided: false });
    const knopf = [...document.querySelectorAll("button")]
      .find((b) => (b.getAttribute("title") ?? "").startsWith("Vorschlag"));
    expect(knopf).toBeDefined();
    expect(knopf!.getAttribute("title")).toContain("Legendary");
    expect(setBanner).not.toHaveBeenCalled();
    await act(async () => { knopf!.click(); });
    expect(setBanner).toHaveBeenCalledWith("SKY-0001", "legendary");
  });

  it("eine ENTSCHIEDENE Zeile bekommt keinen Vorschlag — auch nicht bei „–“",
     async () => {
    await kachel({ visibleType: null, visibleTypeDecided: true });
    const knopf = [...document.querySelectorAll("button")]
      .find((b) => (b.getAttribute("title") ?? "").startsWith("Vorschlag"));
    expect(knopf).toBeUndefined();
  });
});

// ===========================================================================
// 2. DAS BANNER, FÜR JEDE ROLLE GLEICH
// ===========================================================================
describe("das Banner ist für alle Rollen dasselbe", () => {
  for (const rolle of ["user", "business", "admin"] as const) {
    it(`${rolle} sieht LEGENDARY`, async () => {
      const { CatalogCard } = await import("./catalog-card");
      await mount(createElement(CatalogCard, {
        figure: FIGUR, initialCollected: false, signInHref: null,
        accountType: rolle, admin: rolle === "admin",
        favorites: rolle === "user", onEdit: () => {},
      } as never));
      expect(banner()?.textContent, rolle).toBe("Legendary");
    });
  }

  it("aber nur der Administrator bekommt das Dropdown", async () => {
    const { CatalogCard } = await import("./catalog-card");
    for (const rolle of ["user", "business"] as const) {
      await mount(createElement(CatalogCard, {
        figure: FIGUR, initialCollected: false, signInHref: null,
        accountType: rolle, favorites: rolle === "user",
      } as never));
      expect(auswahl(), rolle).toBeNull();
      act(() => { root?.unmount(); });
      container?.remove();
    }
    await kachel();
    expect(auswahl()).not.toBeNull();
  });

  it("der gewählte Type bestimmt das Banner — nicht die Kartenkunst",
     async () => {
    /*
     * DIE PRÜFUNG, UM DIE ES BEI CAT-10 GEHT. `card_type` bleibt
     * `legendary`, der sichtbare Type ist `lightcore` — und die Kachel sagt
     * LIGHTCORE. Vorher hätte sie LEGENDARY gesagt, weil es nur eine Spalte
     * gab.
     */
    await kachel({ visibleType: "lightcore" });
    expect(banner()?.textContent).toBe("LightCore");
  });

  it("und eine Zeile OHNE Auswahl zeigt KEIN Banner (D4)", async () => {
    await kachel({ visibleType: null, visibleTypeDecided: false });
    expect(banner()).toBeUndefined();
  });

  it("ein Figuren- oder Zubehörtype ist ein Banner wie jedes andere", async () => {
    await kachel({ types: ["giant", "legendary"], visibleType: "giant" });
    expect(banner()?.textContent).toBe("Giant");
  });
});

// ===========================================================================
// 3. DIE TRENNUNG, AM CODE GEMESSEN
// ===========================================================================
describe("zwei Felder, zwei Fragen — am Code gemessen", () => {
  const code = (p: string) => readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("das Dropdown ruft NUR `setVisibleType`", () => {
    const c = code("src/components/admin/type-select.tsx");
    expect(c).toContain("setVisibleType(");
    expect(c).not.toContain("setFigureTypes(");
    expect(c).not.toContain("setCardType(");
  });

  it("und die Mehrfachauswahl steht im Dialog, nicht an der Kachel", () => {
    const modal = code("src/components/admin/figure-modal.tsx");
    expect(modal).toContain("setFigureTypes(skyId, draft.types)");
    expect(modal).toContain('type="checkbox"');
    /* Die Kachel kennt die Mehrfachauswahl nicht. */
    expect(code("src/components/admin/type-select.tsx"))
      .not.toContain('type="checkbox"');
  });

  it("der Dialog führt Types UND Kartenkunst getrennt und benennt sie getrennt",
     async () => {
    const { de } = await import("@/lib/i18n/de");
    expect(de.admin.typeHeading).toBe("Types");
    expect(de.admin.cardType).toBe("Kartenkunst");
    const modal = readFileSync("src/components/admin/figure-modal.tsx", "utf8");
    expect(modal).toContain("de.admin.typeHeading");
    expect(modal).toContain("de.admin.cardType");
  });

  it("das Dropdown steht im vorhandenen `trade`-Slot — keine neue Geometrie",
     () => {
    const karte = code("src/components/catalog/catalog-card.tsx");
    expect(karte).toContain("<TypeSelect");
    /* Im Adminzweig, und dort als `trade` — der Platz der Angebotszeile. */
    const a = karte.indexOf("<TypeSelect");
    const b = karte.lastIndexOf("trade={", a);
    expect(b, "TypeSelect steht nicht im trade-Slot").toBeGreaterThan(-1);
    expect(karte.slice(b, a)).not.toContain("</");
    /* Und die Kachelkomponente hat keinen neuen Slot bekommen. */
    expect(code("src/components/catalog/figure-row.tsx"))
      .not.toContain("typeSlot");
  });
});
