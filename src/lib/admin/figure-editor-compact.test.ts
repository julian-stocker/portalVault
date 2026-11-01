import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { STAGING_PROJECT_REF, isStagingProjectUrl } from "@/lib/admin/catalog-source";
import { changedFields, draftFrom } from "@/lib/admin/figure-draft";

/**
 * CAT-14 — the compact figure editor.
 *
 * Like `figure-modal-scroll.test.ts`, these hold the SOURCE: there is no DOM
 * in this suite. What they pin is the part that must not drift — where
 * "Variante von" may be edited, that the image tool reuses the staged upload,
 * that the rarely used fields start closed, and that a key used inside the
 * dialog does not close it.
 */

const code = (path: string) =>
  readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const MODAL = code("src/components/admin/figure-modal.tsx");
const PICKER = code("src/components/admin/base-picker.tsx");
const CHIPS = code("src/components/admin/type-chips.tsx");
const DATA = code("src/lib/admin/figure-editor-data.ts");

describe("the editorial source (ADR-0167)", () => {
  it("is exactly the Staging project", () => {
    expect(isStagingProjectUrl(`https://${STAGING_PROJECT_REF}.supabase.co`)).toBe(true);
  });

  it("fails closed for Production, a look-alike, nothing and garbage", () => {
    expect(isStagingProjectUrl("https://zmiwxswrpkmizvqsgype.supabase.co")).toBe(false);
    expect(isStagingProjectUrl(`https://${STAGING_PROJECT_REF}.supabase.co.evil.example`)).toBe(false);
    expect(isStagingProjectUrl(`https://x${STAGING_PROJECT_REF}.supabase.co`)).toBe(false);
    expect(isStagingProjectUrl(undefined)).toBe(false);
    expect(isStagingProjectUrl("")).toBe(false);
    expect(isStagingProjectUrl("not a url")).toBe(false);
  });

  it("is decided on the server and handed to the dialog", () => {
    expect(DATA).toContain('"use server"');
    expect(DATA).toContain("editorialSource: isEditorialCatalogSource()");
  });
});

describe("Variante von", () => {
  it("is offered as an edit only where the catalogue is edited", () => {
    // The picker and the change button sit behind `editorialSource`.
    const gate = MODAL.indexOf("{editorialSource ? (");
    expect(gate).toBeGreaterThan(-1);
    expect(MODAL.indexOf("de.admin.baseChange")).toBeGreaterThan(gate);
    expect(MODAL).toContain("{editorialSource && pickingBase ? (");
    // Everywhere else the relation is shown with the hint, and nothing more.
    expect(MODAL).toContain("de.admin.baseEditOnStaging");
    // The flag starts closed until the server says otherwise.
    expect(MODAL).toContain("useState(false);\n  const [variantCount");
  });

  it("writes through the existing action, with the family rule from the detail page", () => {
    expect(MODAL).toContain(
      "setVariantBase(skyId, draft.baseSkyId, draft.createFamilyWithBase)");
    expect(PICKER).toContain("searchBaseFigures(skyId, query)");
    expect(PICKER).toContain('target.characterId === null && result?.art === "character"');
    // The picker itself writes nothing.
    expect(PICKER).not.toContain("setVariantBase");
  });

  it("is a draft field: untouched it is never written", () => {
    const figure = {
      displayNameOverride: null, cardType: "standard", imageOverridePath: null,
      catalogVisible: true, baseSkyId: "SKY-0081",
    };
    const initial = draftFrom(figure, null);
    expect(initial.baseSkyId).toBe("SKY-0081");
    expect(changedFields(initial, { ...initial })).toEqual([]);
    // The family flag alone is not a change.
    expect(changedFields(initial, { ...initial, createFamilyWithBase: true })).toEqual([]);
    expect(changedFields(initial, { ...initial, baseSkyId: null })).toEqual(["baseSkyId"]);
  });
});

describe("types as chips", () => {
  it("add and remove through the draft, sorted by the same guard", () => {
    expect(CHIPS).toContain("onChange(asCatalogTypes(types.filter((t) => t !== type)))");
    expect(CHIPS).toContain("onChange(asCatalogTypes([...types, type]))");
    // Every remove button names what it removes.
    expect(CHIPS).toContain("aria-label={de.admin.typeRemove(TYPE_LABELS[type])}");
    expect(CHIPS).toContain("aria-expanded={adding}");
    // It writes nothing itself.
    expect(CHIPS).not.toContain("setFigureTypes");
  });
});

describe("the image tool", () => {
  it("reuses the staged upload and changes the figure only on save", () => {
    expect(MODAL).toContain("stageFigureImage(form)");
    expect(MODAL).toContain('set("imageOverridePath", result.path)');
    expect(MODAL).toContain('set("imageOverridePath", null)');
    expect(MODAL).toContain("aria-label={de.admin.imageEdit}");
  });
});

describe("Weitere Details", () => {
  it("start closed", () => {
    expect(MODAL).toContain("<details ");
    expect(MODAL).not.toMatch(/<details[^>]*\bopen\b/);
    for (const title of ["de.admin.cardType", "de.admin.note", "de.admin.sectionTechnical",
                         "de.admin.sectionHistory"]) {
      expect(MODAL, title).toContain(`<More title={${title}}`);
    }
  });

  it("keep the card art — it is printed and published", () => {
    expect(MODAL).toContain('set("cardType", event.target.value');
    expect(MODAL).toContain("cardType: (skyId, draft) => setCardType(skyId, draft.cardType)");
  });
});

describe("keys inside the dialog", () => {
  it("Escape in the name field and in the base search does not close the dialog", () => {
    // `Modal` ignores an Escape whose default was prevented.
    expect(MODAL).toContain('event.key === "Enter" || event.key === "Escape"');
    expect(MODAL).toContain("event.preventDefault();\n                        setEditingName(false);");
    expect(PICKER).toContain('if (event.key === "Escape") { event.preventDefault(); onCancel(); }');
    expect(code("src/components/ui/modal.tsx")).toContain("if (event.defaultPrevented) return;");
  });
});
