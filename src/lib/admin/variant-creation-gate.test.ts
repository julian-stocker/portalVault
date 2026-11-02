import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/**
 * CAT-20 — Varianten werden nur dort angelegt, wo `0166` steht: auf Staging.
 *
 * Production hat `admin_create_variant_figure` bewusst nicht (ADR-0167). Der
 * Anlegedialog bietet „Variante von" dort nicht an, und `createFigure()`
 * weist eine Variante selbst ab — auch eine Anfrage, die nicht aus dem
 * Dialog kommt. Die Datenbank wird dann gar nicht erst gefragt.
 */

const MOCK = vi.hoisted(() => ({
  rpc: vi.fn(async () => ({ data: "SKY-0931", error: null })),
  admin: true,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: MOCK.rpc }) }));
vi.mock("@/lib/auth/capabilities", () => ({ isPlatformAdmin: async () => MOCK.admin }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, refresh: () => {} }));

const { createFigure } = await import("@/lib/admin/create-actions");
const { canCreateVariants, STAGING_PROJECT_REF } = await import("@/lib/admin/catalog-source");
const { de } = await import("@/lib/i18n/de");

const STAGING = `https://${STAGING_PROJECT_REF}.supabase.co`;
const PRODUCTION = "https://zmiwxswrpkmizvqsgype.supabase.co";

const eingabe = (over: Partial<Parameters<typeof createFigure>[0]> = {}) => ({
  name: "Sparkle Sprocket II", seriesCode: "G", categoryId: 20, cardType: "chase",
  catalogVisible: false, displayNameOverride: "", adminNote: "", templateSkyId: null,
  baseSkyId: "SKY-0147", variantType: "chase", ...over,
});

let vorher: string | undefined;
beforeEach(() => { vorher = process.env.NEXT_PUBLIC_SUPABASE_URL; MOCK.rpc.mockClear(); MOCK.admin = true; });
afterEach(() => { process.env.NEXT_PUBLIC_SUPABASE_URL = vorher; });

describe("wo Varianten angelegt werden dürfen", () => {
  it("Staging ja; Production, nichts und Unsinn nein — fail-closed", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = STAGING;
    expect(canCreateVariants()).toBe(true);
    for (const url of [PRODUCTION, "", "kein url", `${STAGING}.evil.example`, undefined]) {
      process.env.NEXT_PUBLIC_SUPABASE_URL = url as string;
      if (url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      expect(canCreateVariants(), String(url)).toBe(false);
    }
  });
});

describe("createFigure — die serverseitige Sperre", () => {
  it("Production: eine Variante wird abgewiesen, bevor die Datenbank gefragt wird", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = PRODUCTION;
    const r = await createFigure(eingabe());
    expect(r).toEqual({ ok: false, message: de.admin.variantCreateStagingOnly });
    expect(MOCK.rpc).not.toHaveBeenCalled();
  });

  it("Production: eine eigenständige Figur entsteht wie bisher", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = PRODUCTION;
    const r = await createFigure(eingabe({ baseSkyId: null, variantType: null }));
    expect(r).toEqual({ ok: true, skyId: "SKY-0931" });
    expect(MOCK.rpc).toHaveBeenCalledWith("admin_create_figure", expect.any(Object));
  });

  it("Staging: die Variante geht über admin_create_variant_figure, unverändert", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = STAGING;
    const r = await createFigure(eingabe());
    expect(r).toEqual({ ok: true, skyId: "SKY-0931" });
    expect(MOCK.rpc).toHaveBeenCalledWith("admin_create_variant_figure",
      expect.objectContaining({ p_base_sky_id: "SKY-0147", p_variant_type: "chase" }));
  });

  it("ohne Adminrecht bleibt es bei „nicht erlaubt“ — die Sperre ändert die Reihenfolge nicht", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = PRODUCTION;
    MOCK.admin = false;
    expect(await createFigure(eingabe())).toEqual({ ok: false, message: de.admin.notAllowed });
    expect(MOCK.rpc).not.toHaveBeenCalled();
  });
});

describe("der Dialog bekommt die Entscheidung vom Server", () => {
  const seite = readFileSync("src/app/(public)/(catalog)/page.tsx", "utf8");
  const ansicht = readFileSync("src/components/catalog/catalog-view.tsx", "utf8");
  const dialog = readFileSync("src/components/admin/add-figure-modal.tsx", "utf8");

  it("die Seite entscheidet, die Ansicht reicht durch, Vorgabe ist „nein“", () => {
    expect(seite).toContain("variantCreation={admin && canCreateVariants()}");
    expect(ansicht).toContain("variantCreation = false,");
    expect(ansicht).toContain("variantCreation={variantCreation}");
    expect(dialog).toContain("variantCreation = false,");
  });

  it("ohne Freigabe zeigt der Dialog „eigenständig“ mit Hinweis und keine Auswahl", () => {
    const zweig = dialog.slice(dialog.indexOf("{!variantCreation ? ("), dialog.indexOf(") : picking ? ("));
    expect(zweig).toContain("de.admin.variantNone");
    expect(zweig).toContain("de.admin.variantCreateStagingOnly");
    expect(zweig).not.toContain("openPicker");
    expect(zweig).not.toContain("chooseBase");
  });
});
