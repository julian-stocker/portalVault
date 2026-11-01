import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  EMPTY_DRAFT, VARIANT_TYPES, baseCandidates, isCreatable, problemsWith,
  withBase, withVariantType, type CategoryOption,
} from "./new-figure-draft";
import { createErrorMessage } from "./create-errors";
import { sortFigures } from "@/lib/catalog/sort";
import { withBaseFigure } from "@/lib/catalog/queries";
import { buildSearchIndex, matchesQuery, normalizeForSearch } from "@/lib/catalog/search";
import { bannerType, TYPE_GROUPS } from "@/lib/catalog/catalog-type";
import type { CatalogFigure } from "@/lib/catalog/types";
import { de } from "@/lib/i18n/de";

/* ==========================================================================
 * „VARIANTE VON" (CAT-11) — Formular, Katalog, Suche, Badge, Fehler
 *
 * Silver Boomer → Boomer → Chase, als Lauf durch alles, was die Beziehung
 * sieht. Die Datenbankseite (`0166`) prueft `variant-create-0166.test.ts`
 * an echtem PostgreSQL; diese Datei prueft die Oberflaechenseite.
 * ========================================================================== */

function figur(ueber: Partial<CatalogFigure> & { name: string }): CatalogFigure {
  const { name, ...rest } = ueber;
  return {
    skyId: "SKY-0000", slug: "x", seriesCode: "SA", seriesLabel: "Spyro's Adventure",
    seriesPosition: 1, categoryPosition: 1, categoryName: "Figuren", categoryId: 10,
    cardType: "standard", itemType: "figure", characterId: null, element: null,
    imageFile: null, imageOverridePath: null, displayNameOverride: null,
    displayName: name, sortBaseName: name, sortVariantLabel: null, marketPrice: null,
    catalogVisible: true, catalogStatus: "public", isActive: true, baseSkyId: null,
    searchIndex: buildSearchIndex([name]), types: [], visibleType: null,
    ...rest, name,
  } as CatalogFigure;
}

const BOOMER = figur({ name: "Boomer", skyId: "SKY-0010" });
const ELITE = figur({ name: "Elite Boomer", skyId: "SKY-0012", cardType: "elite",
                      types: ["elite"], visibleType: "elite" });
const SILVER = figur({ name: "Silver Boomer", skyId: "SKY-0929", cardType: "chase",
                       baseSkyId: "SKY-0010", types: ["chase"], visibleType: "chase",
                       catalogStatus: "draft", catalogVisible: false });
const SILVER_ENTWURF = figur({ name: "Silver Boomer", skyId: "SKY-0836",
                               catalogStatus: "draft", catalogVisible: false });
const SPYRO = figur({ name: "Spyro", skyId: "SKY-0001" });
const SAPPHIRE = figur({ name: "Sapphire Spyro", skyId: "SKY-0500", baseSkyId: "SKY-0001" });

const KATALOG = [SPYRO, SAPPHIRE, SILVER, BOOMER, ELITE, SILVER_ENTWURF];
const KATEGORIEN: CategoryOption[] = [
  { id: 10, seriesCode: "SA", name: "Figuren", catalogGroup: "figures" },
  { id: 20, seriesCode: "G", name: "Figuren", catalogGroup: "figures" },
];

describe("1–3. das Formular: eigenständig, Variante, Silver Boomer → Boomer → Chase", () => {
  it("eine eigenständige Figur braucht Name, Serie, Kategorie — keinen Typ", () => {
    const d = { ...EMPTY_DRAFT, name: "Neue Figur", seriesCode: "SA", categoryId: 10 };
    expect(problemsWith(d, KATEGORIEN)).toEqual([]);
    expect(isCreatable(d, KATEGORIEN)).toBe(true);
  });

  it("mit Basisfigur ist der Varianten-Typ Pflicht", () => {
    const d = withBase({ ...EMPTY_DRAFT, name: "Silver Boomer" }, BOOMER);
    expect(problemsWith(d, KATEGORIEN)).toEqual(["variantType"]);
    expect(isCreatable(withVariantType(d, "chase"), KATEGORIEN)).toBe(true);
  });

  it("Silver Boomer: Serie und Kategorie aus Boomer, der Name bleibt der eigene", () => {
    const d = withVariantType(withBase({ ...EMPTY_DRAFT, name: "Silver Boomer" }, BOOMER), "chase");
    expect(d).toMatchObject({
      name: "Silver Boomer", seriesCode: "SA", categoryId: 10,
      baseSkyId: "SKY-0010", variantType: "chase",
      /* Ein Vorschlag fuer die Kartenkunst, keine Ableitung (ADR-0160). */
      cardType: "chase",
      templateSkyId: null,
    });
  });

  it("ein Typ ohne gleichnamige Kartenkunst schlaegt „standard“ vor", () => {
    const d = withVariantType(withBase(EMPTY_DRAFT, BOOMER), "lightcore");
    expect(d.cardType).toBe("standard");
  });

  it("„Keine – eigenständige Figur“ nimmt Basis und Typ zurueck", () => {
    const d = withBase(withVariantType(withBase(EMPTY_DRAFT, BOOMER), "chase"), null);
    expect(d.baseSkyId).toBeNull();
    expect(d.variantType).toBeNull();
  });

  it("bietet genau die sieben Variantentypes aus catalog-type.ts an", () => {
    expect([...VARIANT_TYPES]).toEqual([...TYPE_GROUPS.variants]);
    expect(VARIANT_TYPES).toContain("chase");
  });
});

describe("9. ungueltige Basisfiguren stehen gar nicht erst zur Wahl", () => {
  it("keine Variante, kein Entwurf — dieselben Regeln wie 0159/0166", () => {
    const treffer = baseCandidates(KATALOG, "boomer").map((f) => f.skyId);
    expect(treffer).toEqual(["SKY-0010", "SKY-0012"]);
    expect(treffer).not.toContain("SKY-0929");   // ist selbst Variante
    expect(treffer).not.toContain("SKY-0836");   // ist ein Entwurf
  });

  it("findet auch ueber die SKY-ID, und ohne Suchwort nichts", () => {
    expect(baseCandidates(KATALOG, "sky-0010").map((f) => f.skyId)).toEqual(["SKY-0010"]);
    expect(baseCandidates(KATALOG, "  ")).toEqual([]);
  });
});

describe("4–5. die Variante steht bei ihrer Basisfigur", () => {
  it("Silver Boomer sortiert unter Boomer, nicht unter S", () => {
    const sortiert = sortFigures(withBaseFigure(KATALOG.filter((f) => f !== SILVER_ENTWURF)));
    const namen = sortiert.map((f) => f.skyId);
    expect(namen.indexOf("SKY-0929")).toBe(namen.indexOf("SKY-0010") + 1);
  });

  it("OHNE Zuordnung bleibt sie, wo ihr Name sie hinstellt — kein Praefix wird geraten", () => {
    const ohne = withBaseFigure([BOOMER, SILVER_ENTWURF]);
    expect(ohne.find((f) => f.skyId === "SKY-0836")!.sortBaseName).toBe("Silver Boomer");
  });

  it("eine Zuordnung auf eine unsichtbare Basisfigur beschaedigt nichts", () => {
    const allein = withBaseFigure([SILVER]);
    expect(allein[0]).toEqual(SILVER);
  });
});

describe("6. die Suche findet die Variante ueber beide Namen", () => {
  const mit = withBaseFigure(KATALOG);
  const silver = mit.find((f) => f.skyId === "SKY-0929")!;
  const sapphire = mit.find((f) => f.skyId === "SKY-0500")!;

  it("ueber den eigenen Namen", () => {
    expect(matchesQuery(silver, normalizeForSearch("Silver Boomer"))).toBe(true);
  });

  it("ueber den Namen der Basisfigur — auch wenn der eigene ihn nicht enthaelt", () => {
    expect(matchesQuery(sapphire, normalizeForSearch("Spyro"))).toBe(true);
    /* Ohne die Zuordnung trug der Index nur „sapphire spyro" — die
       Gegenprobe mit einem Namen, der das Wort nicht enthaelt: */
    const ohneWort = withBaseFigure([BOOMER, figur({ name: "Silberner", skyId: "SKY-0700",
                                                     baseSkyId: "SKY-0010" })]);
    expect(matchesQuery(ohneWort[1], normalizeForSearch("Boomer"))).toBe(true);
    expect(matchesQuery(figur({ name: "Silberner" }), normalizeForSearch("Boomer"))).toBe(false);
  });

  it("haengt den Basisnamen nur einmal an", () => {
    const zweimal = withBaseFigure(withBaseFigure(KATALOG));
    const s = zweimal.find((f) => f.skyId === "SKY-0929")!;
    expect(s.searchIndex.split(" | ").filter((x) => x === "boomer")).toHaveLength(1);
  });
});

describe("7. das Chase-Badge", () => {
  it("Chase zeigt CHASE, eine Standardfigur zeigt nichts", () => {
    expect(bannerType(SILVER)).toBe("chase");
    expect(bannerType(BOOMER)).toBeNull();
  });

  it("die Detailseite zeigt Typ und „Variante von“ aus der Beziehung", () => {
    const page = readFileSync("src/app/(public)/skylanders/[slug]/page.tsx", "utf8");
    expect(page).toContain("<TypeBadge type={bannerType(figure)} />");
    expect(page).toContain("de.catalog.variantOf(detail.base.displayName)");
    expect(page).toContain("detail.variants.map(");
    expect(de.catalog.variantOf("Boomer")).toBe("Variante von Boomer");
  });

  it("die Variantenliste kommt aus base_sky_id, nicht aus einem Namen", () => {
    const q = readFileSync("src/lib/catalog/queries.ts", "utf8");
    const ctx = q.slice(q.indexOf("async function fetchVariantContext"));
    expect(ctx).toContain('.eq("base_sky_id", figure.skyId)');
    expect(ctx).not.toMatch(/ilike|startsWith|endsWith/);
  });
});

describe("8. fehlende Charakterzuordnung", () => {
  it("das Formular hat kein Charakterfeld, und die Variante bekommt keinen geratenen", () => {
    const modal = readFileSync("src/components/admin/add-figure-modal.tsx", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const verboten of ["characterId", "character_id"]) expect(modal).not.toContain(verboten);
    const d = withBase(EMPTY_DRAFT, BOOMER);
    expect(Object.keys(d)).not.toContain("characterId");
  });
});

describe("13. Fehler beim Anlegen sind verstaendlich — und sagen, dass nichts angelegt wurde", () => {
  const faelle: [string, { code?: string; message?: string }, string][] = [
    ["Migration fehlt", { code: "PGRST202", message: "Could not find the function" }, de.admin.variantCreateNotEnabled],
    ["SKY-ID belegt", { code: "23505", message: 'duplicate key value violates unique constraint "skylanders_pkey"' }, de.admin.createIdTaken],
    ["Band erschoepft", { code: "2200H", message: "nextval: reached maximum value" }, de.admin.createIdExhausted],
    ["Kategorie falsch", { code: "23503", message: 'violates foreign key constraint "skylanders_category_series_fk"' }, de.admin.createCategoryRequired],
    ["Basis ist Entwurf", { code: "23514", message: "0166: SKY-0836 ist ein Entwurf." }, de.admin.variantBaseIsDraft],
    ["Basis ist Variante", { code: "23514", message: "0166: SKY-0929 ist selbst eine Variante (von SKY-0010)." }, de.admin.variantBaseIsVariant],
    ["kein Recht", { code: "42501", message: "not authorised" }, de.admin.notAllowed],
  ];
  for (const [titel, fehler, erwartet] of faelle) {
    it(titel, () => { expect(createErrorMessage(fehler, true)).toBe(erwartet); });
  }

  it("Unbekanntes nennt den Code, nie die rohe Meldung", () => {
    const text = createErrorMessage({ code: "XX000", message: "geheimer interner text" }, false);
    expect(text).toContain("XX000");
    expect(text).not.toContain("geheimer");
  });

  it("die Aktion protokolliert den Fehler und schickt eine Variante ueber 0166", () => {
    const action = readFileSync("src/lib/admin/create-actions.ts", "utf8");
    expect(action).toContain('["admin_create_variant_figure", {');
    expect(action).toContain("await supabase.rpc(fn, args)");
    expect(action).toContain("console.error(");
    expect(action).toContain("createErrorMessage(error, variant)");
    /* Kein zweiter Schreibaufruf danach — die Zuordnung steckt in der einen RPC. */
    expect(action).not.toContain("admin_set_variant_base");
  });
});

describe("11. der Loeschdialog bleibt in jedem Fenster bedienbar", () => {
  const src = readFileSync("src/components/admin/card-actions.tsx", "utf8");
  const dialog = src.slice(src.indexOf("function DeleteDialog"), src.indexOf("const FELD ="));

  it("steht im gemeinsamen Modal — portiert, mit Hoehendeckel am Viewport", () => {
    expect(dialog).toContain('<Modal open onClose={onCancel} labelledBy={titel} size="md" role="alertdialog">');
    /* Kein eigenes fixed-Overlay mehr in der Kachel (@container!). */
    expect(dialog).not.toContain("fixed inset-0");
    const modal = readFileSync("src/components/ui/modal.tsx", "utf8");
    expect(modal).toContain("max-h-[82dvh] sm:max-h-[74dvh]");
    expect(modal).toContain("createPortal(");
  });

  it("Kopf und Fuss stehen fest, nur der Inhalt dazwischen scrollt", () => {
    const kopf = dialog.indexOf("<header className=\"shrink-0");
    const rumpf = dialog.indexOf("min-h-0 overflow-y-auto overscroll-contain");
    const fuss = dialog.indexOf("<footer className=\"flex shrink-0");
    expect(kopf).toBeGreaterThan(-1);
    expect(rumpf).toBeGreaterThan(kopf);
    expect(fuss).toBeGreaterThan(rumpf);
    /* Beide Knoepfe im Fuss. */
    const foot = dialog.slice(fuss);
    expect(foot).toContain("de.admin.discardConfirmNo");
    expect(foot).toContain("de.admin.deleteConfirmYes");
  });

  it("die lange Pruefliste ist aufklappbar, nicht im Weg", () => {
    expect(dialog).toMatch(/<details[\s\S]*deleteConfirmChecksTitle[\s\S]*deleteConfirmChecks\}/);
  });

  it("kein doppelter Loeschvorgang, und Abbrechen waehrend des Loeschens tut nichts", () => {
    expect(src).toContain("if (pending) return;");
    expect(src).toContain("onCancel={() => { if (!pending) {");
    expect(dialog).toContain("disabled={pending}");
  });

  it("die Texte sind kurz", () => {
    expect(de.admin.deleteConfirmTitle).toBe("Figur dauerhaft löschen?");
    expect(de.admin.deleteConfirmBody).toBe(
      "Diese Aktion kann nicht rückgängig gemacht werden. Die SKY-ID bleibt dauerhaft gesperrt.");
  });
});

describe("12. alle Loeschschutzpruefungen bleiben in der Datenbank", () => {
  it("admin_delete_figure (0162) zaehlt weiter Fremdschluessel, Bestellzeilen und Varianten", () => {
    const sql = readFileSync("supabase/migrations/0162_admin_price_and_delete.sql", "utf8");
    const fn = sql.slice(sql.indexOf("create or replace function public.admin_delete_figure"));
    expect(fn).toContain("admin_merge_references(p_sky_id)");
    expect(fn).toContain("order_lines");
    expect(fn).toContain("base_sky_id = p_sky_id");
    /* Der Dialog ruft weiter genau diese eine Aktion. */
    const src = readFileSync("src/components/admin/card-actions.tsx", "utf8");
    expect(src).toContain("await deleteFigure(skyId)");
  });
});
