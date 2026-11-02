import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { resolveVariantFamily } from "@/lib/admin/variant-family-rule";

/**
 * CAT-15 — the family when a base figure is set.
 *
 * The cases are the real ones from Staging on 2026-11-01 (read-only):
 *
 *   A  SKY-0166 Hex Light Core (G) -> SKY-0164 Hex (G). Neither has a family;
 *      "Hex" (139) exists since Spyro's Adventure. 0159 was asked to CREATE
 *      a second one and 0158 refused.
 *   B  SKY-0854 White Flocked LightCore Prism Break -> SKY-0170 Prism Break.
 *      Variant in "Prism Break Light Core" (126), base in "Prism Break" (152).
 *      Until 0168 a conflict 0159 refused; since 0168 (ADR-0171) the variant
 *      simply takes the base's family.
 *   C  SKY-0174 Legendary Slam Bam -> SKY-0173 Slam Bam (G): as A, "Slam Bam" (135).
 *   W  SKY-0829 Glow-in-the-Dark Warnado: base Warnado has no family, the
 *      variant still carries Whirlwind (15) from the old, wrong base — since
 *      0168 it is dropped when the base is set.
 */

const base = {
  variantFamily: null, baseFamily: null, baseName: "Hex",
  sameNameFamily: null, sameNameMembers: [], familyWanted: true,
} as const;

describe("which family a variant gets", () => {
  const hex = { id: 139, name: "Hex" };
  const hexMembers = [{ skyId: "SKY-0043", name: "Hex" }, { skyId: "SKY-0044", name: "Hex (Pearl)" }];

  it("A: finds the existing same-named family, with its members — never a second", () => {
    expect(resolveVariantFamily({ ...base, sameNameFamily: hex, sameNameMembers: hexMembers }))
      .toEqual({ kind: "existing", family: hex, members: hexMembers });
  });

  it("C: the same for Slam Bam (135), whatever the members' raw names look like", () => {
    const slam = { id: 135, name: "Slam Bam" };
    const members = [{ skyId: "SKY-0048", name: "Slam Bam" },
                     { skyId: "SKY-0049", name: "Elite Slam Bam - ohne OVP" }];
    expect(resolveVariantFamily({ ...base, baseName: "Slam Bam", sameNameFamily: slam,
                                  sameNameMembers: members }))
      .toEqual({ kind: "existing", family: slam, members });
  });

  it("matches the family name case-insensitively but never by similarity", () => {
    expect(resolveVariantFamily({ ...base, baseName: "slam bam",
      sameNameFamily: { id: 135, name: "Slam Bam" } }).kind).toBe("existing");
    expect(resolveVariantFamily({ ...base, baseName: "Slam Bam",
      sameNameFamily: { id: 9, name: "Slam Bam Light Core" } }))
      .toEqual({ kind: "create", name: "Slam Bam" });
  });

  it("creates only when none exists by that name", () => {
    expect(resolveVariantFamily({ ...base, baseName: "Warnado" }))
      .toEqual({ kind: "create", name: "Warnado" });
  });

  it("creates and reuses nothing when no family is wanted (not a character figure)", () => {
    expect(resolveVariantFamily({ ...base, familyWanted: false, sameNameFamily: hex }))
      .toEqual({ kind: "none" });
  });

  it("B: different families — the base's replaces the variant's, and the editor says so", () => {
    expect(resolveVariantFamily({
      ...base, baseName: "Prism Break",
      variantFamily: { id: 126, name: "Prism Break Light Core" },
      baseFamily: { id: 152, name: "Prism Break" },
    })).toEqual({ kind: "replace",
                  variant: { id: 126, name: "Prism Break Light Core" },
                  base: { id: 152, name: "Prism Break" } });
  });

  it("W: only the variant has one — it is dropped, the base has none", () => {
    expect(resolveVariantFamily({
      ...base, baseName: "Warnado", familyWanted: false,
      variantFamily: { id: 15, name: "Whirlwind" },
    })).toEqual({ kind: "drop", variant: { id: 15, name: "Whirlwind" } });
  });

  it("W, with a family wanted: the base gets one — never the variant's wrong one", () => {
    expect(resolveVariantFamily({
      ...base, baseName: "Warnado", variantFamily: { id: 15, name: "Whirlwind" },
    })).toEqual({ kind: "create", name: "Warnado" });
  });

  it("carries the base's family, or reports it is already the same", () => {
    expect(resolveVariantFamily({ ...base, baseFamily: hex })).toEqual({ kind: "carry", family: hex });
    expect(resolveVariantFamily({ ...base, baseFamily: hex, variantFamily: hex }))
      .toEqual({ kind: "same", family: hex });
  });
});

describe("why 0161's automatic veto is not reused", () => {
  it("would refuse the real members — so a confirmation replaces it", () => {
    const sql = readFileSync("supabase/migrations/0161_variant_family_auto.sql", "utf8");
    expect(sql).toContain("and right(lower(s.name), length(v_klein) + 1) <> ' ' || v_klein");
    // 0161's expression, applied to two real members on Staging:
    const fits = (k: string, m: string) => {
      const a = k.toLowerCase(); const b = m.toLowerCase();
      return b === a || b.endsWith(` ${a}`) || a.endsWith(` ${b}`);
    };
    expect(fits("Hex", "Hex (Pearl)")).toBe(false);
    expect(fits("Slam Bam", "Elite Slam Bam - ohne OVP")).toBe(false);
  });
});

describe("setVariantBase writes only through the existing RPCs", () => {
  const src = readFileSync("src/lib/admin/actions.ts", "utf8");
  const start = src.indexOf("export async function setVariantBase");
  const fn = src.slice(start, src.indexOf("\n}\n", start));

  it("keeps the old path when no family is asked for", () => {
    expect(fn).toContain("if (baseSkyId === null || familie === false) return mitAufraeumen(await setBase(false));");
  });

  it("reuses an existing family only when exactly that one was confirmed", () => {
    const existing = fn.slice(fn.indexOf('case "existing"'), fn.indexOf('case "create"'));
    expect(existing).toContain(
      'typeof familie === "object" && familie.reuseFamilyId === outcome.family.id');
    expect(existing).toContain("de.admin.familyExistsConfirm(outcome.family.name)");
    // Assign the base first, then let 0159 carry it over to the variant.
    expect(existing).toContain("setFigureCharacter(baseSkyId, outcome.family.id)");
    expect(existing.indexOf("setFigureCharacter")).toBeLessThan(existing.indexOf("setBase(false)"));
  });

  it("asks 0168 to create only when nothing exists by that name, and only if asked", () => {
    expect(fn).toContain('case "create":\n      return mitAufraeumen(await setBase(familie === true));');
    expect(fn).not.toContain("setBase(true)");
  });

  it("no longer writes the variant's family itself — 0168 does (ADR-0171)", () => {
    expect(fn).not.toContain("adopt-base");
    expect(fn).not.toContain("setFigureCharacter(skyId");
  });

  it("tidies up a family the change left empty, afterwards and only on success", () => {
    expect(fn).toContain("const vorher = await familienVon(skyId);");
    expect(fn).toContain("if (ergebnis.ok) await leereFamilienAufraeumen(vorher);");
  });

  it("introduces no RPC of its own", () => {
    expect(fn).not.toMatch(/\.rpc\(/);
    expect(fn).toContain('"admin_set_variant_base"');
  });
});

describe("the editor confirms, the server checks again", () => {
  const modal = readFileSync("src/components/admin/figure-modal.tsx", "utf8");
  it("passes the confirmed family or the create flag — no takeover flag any more", () => {
    expect(modal).not.toContain("adoptBaseFamily");
    expect(modal).toContain("draft.reuseFamilyId !== null ? { reuseFamilyId: draft.reuseFamilyId }");
    expect(modal).toContain("previewVariantFamily(skyId, pendingBase, familyWanted)");
  });
});
