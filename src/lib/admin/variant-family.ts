/**
 * Reads what `resolveVariantFamily()` needs to decide (CAT-15). Read-only.
 *
 * Server code only: it uses the request's Supabase client, so it reads with
 * the operator's own rights (`skylanders` and `characters` are readable).
 * It writes nothing; the server action decides from it and then writes
 * through the existing RPCs, which check everything again.
 */
import { createClient } from "@/lib/supabase/server";
import {
  resolveVariantFamily, type FamilyMember, type FamilyRef, type VariantFamilyOutcome,
} from "@/lib/admin/variant-family-rule";

type Row = { sky_id: string; name: string; character_id: number | null };

/** `ilike` without wildcards: `%`, `_` and `\` in a name are literal. */
function literal(name: string): string {
  return name.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function loadVariantFamily(
  skyId: string,
  baseSkyId: string,
  familyWanted: boolean,
): Promise<{ outcome: VariantFamilyOutcome; baseName: string } | null> {
  const supabase = await createClient();
  const { data: rows, error } = await supabase.from("skylanders")
    .select("sky_id,name,character_id").in("sky_id", [skyId, baseSkyId]);
  if (error || !rows) return null;
  const variant = (rows as Row[]).find((r) => r.sky_id === skyId);
  const base = (rows as Row[]).find((r) => r.sky_id === baseSkyId);
  if (!variant || !base) return null;

  const ids = [variant.character_id, base.character_id].filter((id): id is number => id !== null);
  const families = new Map<number, string>();
  if (ids.length > 0) {
    const { data } = await supabase.from("characters").select("id,canonical_name").in("id", ids);
    for (const c of (data ?? []) as { id: number; canonical_name: string }[]) {
      families.set(c.id, c.canonical_name);
    }
  }
  const ref = (id: number | null): FamilyRef | null =>
    id === null ? null : { id, name: families.get(id) ?? `#${id}` };

  /* Only needed when neither side has a family — the only case that looks one up. */
  let sameNameFamily: FamilyRef | null = null;
  let sameNameMembers: FamilyMember[] = [];
  const baseName = base.name.trim();
  if (familyWanted && variant.character_id === null && base.character_id === null && baseName !== "") {
    const { data } = await supabase.from("characters").select("id,canonical_name")
      .ilike("canonical_name", literal(baseName));
    const hit = ((data ?? []) as { id: number; canonical_name: string }[])
      .find((c) => c.canonical_name.toLowerCase() === baseName.toLowerCase());
    if (hit) {
      sameNameFamily = { id: hit.id, name: hit.canonical_name };
      const { data: members } = await supabase.from("skylanders")
        .select("sky_id,name").eq("character_id", hit.id);
      sameNameMembers = ((members ?? []) as { sky_id: string; name: string }[])
        .map((m) => ({ skyId: m.sky_id, name: m.name }));
    }
  }

  return {
    baseName,
    outcome: resolveVariantFamily({
      variantFamily: ref(variant.character_id),
      baseFamily: ref(base.character_id),
      baseName,
      sameNameFamily,
      sameNameMembers,
      familyWanted,
    }),
  };
}
