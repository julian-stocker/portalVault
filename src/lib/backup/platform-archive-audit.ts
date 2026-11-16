/**
 * Which areas a platform archive of a given format version must carry, and
 * which project it must come from — the pure part of
 * `tools/verify-platform-archive.mts`.
 *
 * WHY THIS IS ITS OWN MODULE (F4a.1, 2026-11-14). The check used to live
 * inline in the tool, and it was wrong for every version below 4: it took
 * "all areas of this codebase" and removed only `purchase_calculations` and
 * the seven areas of 0174. `sale_item_corrections` (0182, format version 4)
 * stayed in the expectation, so a correct version-2 archive from Production
 * — 54 areas, exactly what 0164 exports — was reported as missing an area it
 * cannot have. Inline in a script that exits, nobody could test it.
 *
 * THE RULE NOW. Each format version is the previous one plus the areas that
 * version introduced (`AREAS_INTRODUCED_IN`). The expectation for version N
 * is every area of the manifest minus those introduced after N — and it must
 * add up to `SECTIONS_BY_FORMAT_VERSION[N]`, or the mapping itself is wrong
 * and nothing is certified.
 *
 * No file access, no network, no process exit. The tool reads the archive;
 * this module only decides.
 */
import { SALE_ITEM_CORRECTIONS_SECTIONS, SALES_RECONCILIATION_SECTIONS } from "./manifest.ts";
import { PLATFORM_SECTIONS, SECTIONS_BY_FORMAT_VERSION } from "./platform-manifest.ts";

/**
 * The areas each format version added to its predecessor.
 *
 * Version 1 is the base (53 areas). 2 added `purchase_calculations` (0144),
 * 3 the seven sales-reconciliation areas (0174), 4 `sale_item_corrections`
 * (0182). A new version needs a new line here; `platform-archive-audit.test.ts`
 * fails if the sums stop matching `SECTIONS_BY_FORMAT_VERSION`.
 */
export const AREAS_INTRODUCED_IN: Readonly<Record<number, readonly string[]>> = {
  2: ["purchase_calculations"],
  3: SALES_RECONCILIATION_SECTIONS.map((s) => s.key),
  4: SALE_ITEM_CORRECTIONS_SECTIONS.map((s) => s.key),
};

/**
 * The exact set of area keys an archive of `version` carries, sorted.
 *
 * `null` for a version this codebase does not know — the caller must treat
 * that as a failure, never as "nothing to expect".
 *
 * Throws if the mapping does not add up: then this module would certify the
 * wrong thing, and that is a defect of the code, not of the archive.
 */
export function platformAreasFor(version: number): string[] | null {
  const expectedCount = SECTIONS_BY_FORMAT_VERSION[version];
  if (expectedCount === undefined) return null;
  const later = new Set(
    Object.entries(AREAS_INTRODUCED_IN)
      .filter(([v]) => Number(v) > version)
      .flatMap(([, keys]) => keys),
  );
  const keys = PLATFORM_SECTIONS.map((s) => s.key).filter((k) => !later.has(k)).sort();
  if (keys.length !== expectedCount) {
    throw new Error(
      `platformAreasFor(${version}): ${keys.length} areas derived, `
      + `SECTIONS_BY_FORMAT_VERSION says ${expectedCount} — AREAS_INTRODUCED_IN is out of date`,
    );
  }
  return keys;
}

/** The format version that introduced `key`; 1 for base areas, `null` if unknown. */
export function versionIntroducing(key: string): number | null {
  for (const [v, keys] of Object.entries(AREAS_INTRODUCED_IN)) {
    if (keys.includes(key)) return Number(v);
  }
  return PLATFORM_SECTIONS.some((s) => s.key === key) ? 1 : null;
}

export type AreaCheck = { ok: boolean; name: string; detail: string };

/**
 * The area checks of section 3 of the tool.
 *
 * `documentKeys` are the keys of `database.json → data`, `coverCounts` is
 * `manifest.json → counts`, `rowCounts` the length of each area's list
 * (`-1` when the area is not a list). Only names and numbers come in and go
 * out — no row content.
 */
export function checkPlatformAreas(input: {
  version: number;
  documentKeys: readonly string[];
  coverCounts: Readonly<Record<string, unknown>> | null;
  rowCounts: Readonly<Record<string, number>>;
}): AreaCheck[] {
  const out: AreaCheck[] = [];
  const add = (ok: boolean, name: string, detail = "") => out.push({ ok, name, detail });

  const expected = platformAreasFor(input.version);
  if (expected === null) {
    add(false, `Formatversion ${input.version} ist dieser Codebasis bekannt`,
        `bekannt: ${Object.keys(SECTIONS_BY_FORMAT_VERSION).join(", ")}`);
    return out;
  }

  const inDocument = [...input.documentKeys].sort();
  const inCover = input.coverCounts ? Object.keys(input.coverCounts).sort() : [];

  add(inDocument.length === expected.length,
      `database.json fuehrt ${expected.length} Bereiche`, `gefunden: ${inDocument.length}`);
  add(inCover.length === expected.length,
      `manifest.json zaehlt ${expected.length} Bereiche`, `gefunden: ${inCover.length}`);
  add(JSON.stringify(inDocument) === JSON.stringify(inCover),
      "Deckblatt und Dokument nennen DIESELBEN Bereiche");

  /*
   * NOTHING LOST, NOTHING CLAIMED THAT THE VERSION CANNOT HAVE. Two separate
   * lines: a missing area and an area from a later version are different
   * defects, and a matching total must not hide either.
   */
  const missing = expected.filter((k) => !inDocument.includes(k));
  add(missing.length === 0, `alle ${expected.length} Bereiche der Version ${input.version} sind da`,
      missing.length ? `fehlen: ${missing.join(", ")}` : "");

  const fromLater = inDocument.filter((k) => {
    const v = versionIntroducing(k);
    return v !== null && v > input.version;
  });
  add(fromLater.length === 0, `kein Bereich einer spaeteren Formatversion als ${input.version}`,
      fromLater.map((k) => `${k} (ab ${versionIntroducing(k)})`).join(", "));

  const unknown = inDocument.filter((k) => versionIntroducing(k) === null);
  add(unknown.length === 0, "kein Bereich, den das Manifest nicht kennt", unknown.join(", "));

  const notList = inDocument.filter((k) => (input.rowCounts[k] ?? -1) < 0);
  add(notList.length === 0, "jeder Bereich ist eine Liste", notList.join(", "));

  const disagree = inDocument.filter(
    (k) => input.coverCounts === null || input.coverCounts[k] !== Math.max(input.rowCounts[k] ?? 0, 0));
  add(disagree.length === 0, "jede Zahl in counts stimmt mit den Zeilen im Dokument",
      disagree.join(", "));

  return out;
}

/**
 * Which project the archive must come from.
 *
 * Accepted: `production`, `staging`, or one of the two pinned refs spelled
 * out. Anything else is refused — a typo must not become "some other project
 * that happens to match nothing". Without `--project` the default stays what
 * it always was (the ref in `.env.staging`), but the caller prints which one
 * was chosen and why.
 */
export function resolveExpectedProject(
  argument: string | null,
  refs: { production: string; staging: string },
  stagingFromEnv: string | null,
): { ok: true; ref: string; label: string } | { ok: false; reason: string } {
  if (argument === null) {
    if (stagingFromEnv === null) {
      return { ok: false, reason: "weder --project noch .env.staging liefern eine Projektkennung" };
    }
    if (stagingFromEnv !== refs.staging) {
      return { ok: false, reason: ".env.staging zeigt nicht auf das festgelegte Staging-Projekt" };
    }
    return { ok: true, ref: refs.staging, label: "Staging (Vorgabe aus .env.staging)" };
  }
  const a = argument.trim().toLowerCase();
  if (a === "production" || a === refs.production) {
    return { ok: true, ref: refs.production, label: `Production (--project ${argument})` };
  }
  if (a === "staging" || a === refs.staging) {
    return { ok: true, ref: refs.staging, label: `Staging (--project ${argument})` };
  }
  return {
    ok: false,
    reason: `--project ${argument} ist weder production/staging noch eine der zwei festgelegten Projektkennungen`,
  };
}
