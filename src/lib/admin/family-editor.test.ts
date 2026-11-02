import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { changedFields, draftFrom, type AdminFigureDraft } from "@/lib/admin/figure-draft";
import {
  alignToBase, chooseFamily, familyBlocker, familyIsInherited, inheritedDiffers, planNewFamily,
} from "@/lib/admin/family-draft";

/**
 * CAT-18 — die Familie im kompakten Figureneditor; seit CAT-19 (`0168`,
 * ADR-0171) wird sie nur an der BASISFIGUR gepflegt, eine Variante erbt.
 *
 * Die Fälle sind die echten von Staging (2026-11-02, rein lesend):
 * SKY-0832 Gold Chop Chop (Variante von SKY-0015, Familie fehlt, Basis in
 * „Chop Chop" #131), SKY-0293 Twin Blade Chop Chop (Pseudofamilie #173),
 * „Hex" #139 mit Mitgliedern in Spyro's Adventure UND Giants.
 */

const CHOP_CHOP = { id: 131, name: "Chop Chop" };
const TWIN_BLADE = { id: 173, name: "Twin Blade Chop Chop" };
const HEX = { id: 139, name: "Hex" };

function entwurf(over: Partial<AdminFigureDraft> = {}): AdminFigureDraft {
  return {
    ...draftFrom({ displayNameOverride: null, cardType: "chase", imageOverridePath: null,
                   catalogVisible: true, baseSkyId: "SKY-0015", characterId: null }, null),
    ...over,
  };
}

describe("Familie wählen, wechseln, entfernen", () => {
  it("ist ein Entwurfsfeld: unberührt wird nie geschrieben, und nichts wird vorgemerkt", () => {
    const a = entwurf();
    expect(a.characterId).toBeNull();
    expect(a.newFamilyName).toBeNull();
    expect(changedFields(a, { ...a })).toEqual([]);
  });

  it("wählen und wechseln stehen im Speicherplan, direkt nach der Basisfigur", () => {
    const a = entwurf({ baseSkyId: null, characterId: TWIN_BLADE.id });
    const b = chooseFamily(a, CHOP_CHOP);
    expect(b.characterId).toBe(131);
    expect(changedFields(a, b)).toEqual(["characterId"]);
    expect(familyBlocker(a, b, null)).toBeNull();
  });

  it("entfernen ist `null` — der Rückweg, den `0158` ausdrücklich annimmt", () => {
    const a = entwurf({ baseSkyId: null, characterId: TWIN_BLADE.id });
    const b = chooseFamily(a, null);
    expect(b.characterId).toBeNull();
    expect(changedFields(a, b)).toEqual(["characterId"]);
  });

  it("zurück auf den gespeicherten Wert ist keine Änderung mehr", () => {
    const a = entwurf({ baseSkyId: null, characterId: 131 });
    expect(changedFields(a, chooseFamily(chooseFamily(a, TWIN_BLADE), CHOP_CHOP))).toEqual([]);
  });
});

describe("an einer Variante ist die Familie geerbt (CAT-19)", () => {
  it("SKY-0832: eine Variante gilt als geerbt — wählen ist gesperrt", () => {
    const a = entwurf({ characterId: 131 });   // Variante von SKY-0015, Basis in Chop Chop
    expect(familyIsInherited(a)).toBe(true);
    expect(familyBlocker(a, chooseFamily(a, TWIN_BLADE), CHOP_CHOP)).toEqual({ kind: "variant" });
    /* „keine" ist an einer Variante, deren Basisfigur eine hat, genauso gesperrt. */
    expect(familyBlocker(a, chooseFamily(a, null), CHOP_CHOP)).toEqual({ kind: "variant" });
  });

  it("eine Basisfigur ist frei: wählen, wechseln, entfernen", () => {
    const a = entwurf({ baseSkyId: null, characterId: TWIN_BLADE.id });
    expect(familyIsInherited(a)).toBe(false);
    expect(familyBlocker(a, chooseFamily(a, CHOP_CHOP))).toBeNull();
    expect(familyBlocker(a, chooseFamily(a, null))).toBeNull();
  });

  it("keine Bestätigung einer Abweichung mehr — es gibt keine", () => {
    expect(Object.keys(entwurf())).not.toContain("confirmFamilyMismatch");
    expect(Object.keys(entwurf())).not.toContain("adoptBaseFamily");
  });
});

describe("serienübergreifende Familien", () => {
  it("eine Basisfigur darf eine Familie mit Mitgliedern aus mehreren Serien wählen", () => {
    // SKY-0164 Hex (Giants) in „Hex", das auch SA-Figuren trägt.
    const a = entwurf({ baseSkyId: null, characterId: null });
    expect(familyBlocker(a, chooseFamily(a, HEX))).toBeNull();
  });

  it("die Suche zeigt die Serien jeder Familie", () => {
    const picker = readFileSync("src/components/admin/family-field.tsx", "utf8");
    expect(picker).toContain('f.serien.join(" ")');
    expect(picker).toContain("de.admin.familyMembers(f.mitglieder)");
  });
});

describe("Basisfigur und Familie nie in einem Speichern", () => {
  it("wer die Basisfigur ändert, ändert damit die Familie — ein zweiter Wert wird abgewiesen", () => {
    const a = entwurf({ baseSkyId: null });
    const b = chooseFamily({ ...a, baseSkyId: "SKY-0015" }, CHOP_CHOP);
    expect(familyBlocker(a, b)).toEqual({ kind: "base-and-family" });
    /* Die Basisfigur allein bleibt erlaubt. */
    expect(familyBlocker(a, { ...a, baseSkyId: "SKY-0015" })).toBeNull();
  });
});

describe("eine neue Familie — nur auf ausdrücklichen Wunsch", () => {
  it("wird vorgemerkt, nicht angelegt, und gilt als Änderung", () => {
    const a = entwurf({ baseSkyId: null });
    const b = planNewFamily(a, "  Sprocket ", [CHOP_CHOP]);
    expect(b).not.toBeNull();
    expect(b!.newFamilyName).toBe("Sprocket");
    expect(b!.characterId).toBeNull();
    expect(changedFields(a, b!)).toEqual(["characterId"]);
  });

  it("nie, wenn es den Namen schon gibt — dann wählt man die bestehende (ADR-0168)", () => {
    expect(planNewFamily(entwurf(), "chop chop", [CHOP_CHOP])).toBeNull();
    expect(planNewFamily(entwurf(), "   ", [])).toBeNull();
    expect(planNewFamily(entwurf(), "x".repeat(121), [])).toBeNull();
  });

  it("an einer Variante gesperrt wie jede andere Wahl", () => {
    const a = entwurf({ characterId: 131 });
    expect(familyBlocker(a, planNewFamily(a, "Gold Chop Chop", [CHOP_CHOP])!)).toEqual({ kind: "variant" });
  });
});

describe("der Schreibweg", () => {
  const modal = readFileSync("src/components/admin/figure-modal.tsx", "utf8");
  const actions = readFileSync("src/lib/admin/actions.ts", "utf8");
  /* Ohne Kommentare: der Kopf der Auswahl nennt die Schreibwege, die sie
     gerade NICHT benutzt. */
  const picker = readFileSync("src/components/admin/family-field.tsx", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("die Familie schreibt `setFigureCharacter`, eine neue `createAndAssignFamily`", () => {
    expect(modal).toContain("characterId: (skyId, draft) => setFigureCharacter(skyId, draft.characterId)");
    expect(modal).toContain('field === "characterId" && working.newFamilyName !== null');
  });

  it("der Dialog prüft vor dem ersten Schreibzugriff — nicht nur am Knopf", () => {
    const save = modal.slice(modal.indexOf("async function save()"));
    expect(save.indexOf("familyBlocker(initial, draft) !== null) return"))
      .toBeLessThan(save.indexOf("for (const field of plan)"));
  });

  it("die Auswahl selbst schreibt nichts", () => {
    expect(picker).not.toContain("@/lib/admin/actions");
    expect(picker).not.toMatch(/setFigureCharacter|createCharacterFamily|createAndAssignFamily/);
  });

  it("keine neue RPC: anlegen über `0158`, zuordnen über `setFigureCharacter`", () => {
    const start = actions.indexOf("export async function createAndAssignFamily");
    const fn = actions.slice(start, actions.indexOf("\n}\n", start));
    expect(fn).toContain('supabase.rpc("admin_create_character"');
    expect(fn).toContain("setFigureCharacter(skyId, characterId)");
    expect(fn.match(/\.rpc\(/g)).toHaveLength(1);
    /* Gibt es den Namen schon, wird NICHTS zugeordnet — kein stilles Wiederverwenden. */
    expect(fn.indexOf("if (error)")).toBeLessThan(fn.indexOf("setFigureCharacter"));
  });

  it("geändert wird die Familie nur dort, wo der Katalog gepflegt wird", () => {
    const familie = modal.slice(modal.indexOf("<StackedProperty label={de.admin.propertyFamily}>"));
    expect(familie).toContain("{editorialSource ? (");
    expect(familie).toContain("{editorialSource && pickingFamily ? (");
  });

  it("an einer Variante zeigt der Dialog die geerbte Familie und keine Auswahl", () => {
    const familie = modal.slice(modal.indexOf("<StackedProperty label={de.admin.propertyFamily}>"));
    const geerbt = familie.slice(0, familie.indexOf(") : ("));
    expect(geerbt).toContain("familyIsInherited(initial) || draft.baseSkyId !== null");
    expect(geerbt).toContain("de.admin.familyInherited(");
    expect(geerbt).toContain("de.admin.familyInheritedNone");
    expect(geerbt).not.toContain("setPickingFamily(true)");
  });

  it("an einer Basisfigur sagt er vorher, wie viele Varianten mitgehen", () => {
    expect(modal).toContain("de.admin.familyCascade(variantCount)");
  });

  it("die Detailseite zeigt die Familie einer Variante nur an", () => {
    const select = readFileSync("src/components/admin/family-select.tsx", "utf8");
    const geerbt = select.slice(select.indexOf("if (basis !== null) {"), select.indexOf("  return (\n    <div className=\"text-left\">\n      <p className=\"text-sm\">\n        {familienname ?? de.admin.familyAssignNone}"));
    expect(geerbt).toContain("de.admin.familyInherited(basis)");
    expect(geerbt).not.toContain("setFigureCharacter");
    const seite = readFileSync("src/app/(admin)/admin/catalog/[skyId]/page.tsx", "utf8");
    expect(seite).toContain("basis={figure.baseSkyId === null ? null : (basisname ?? figure.baseSkyId)}");
  });

  it("Variante von und Familie nebeneinander, auf dem Telefon untereinander", () => {
    expect(modal).toContain('<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">');
  });
});

describe("eine Altabweichung von vor 0168 angleichen — nur auf die Basisfigur", () => {
  it("SKY-0832 ohne Familie, Basis in Chop Chop: angleichen ist erlaubt", () => {
    const a = entwurf({ characterId: null });
    expect(inheritedDiffers(a, CHOP_CHOP)).toBe(true);
    const b = alignToBase(a, CHOP_CHOP);
    expect(b.characterId).toBe(131);
    expect(familyBlocker(a, b, CHOP_CHOP)).toBeNull();
    expect(changedFields(a, b)).toEqual(["characterId"]);
  });

  it("SKY-0829 mit Whirlwind, Basis ohne Familie: angleichen heißt keine", () => {
    const a = entwurf({ characterId: 15 });
    expect(inheritedDiffers(a, null)).toBe(true);
    const b = alignToBase(a, null);
    expect(b.characterId).toBeNull();
    expect(familyBlocker(a, b, null)).toBeNull();
  });

  it("jede andere Familie an einer Variante bleibt gesperrt", () => {
    const a = entwurf({ characterId: null });
    expect(familyBlocker(a, chooseFamily(a, TWIN_BLADE), CHOP_CHOP)).toEqual({ kind: "variant" });
  });

  it("eine übereinstimmende Variante weicht nicht ab", () => {
    expect(inheritedDiffers(entwurf({ characterId: 131 }), CHOP_CHOP)).toBe(false);
  });
});
