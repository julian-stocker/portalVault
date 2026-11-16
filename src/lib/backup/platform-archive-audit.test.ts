/**
 * Regression for F4a.1 (2026-11-14): `verify:platform-archive --version 2`
 * demanded `sale_item_corrections` (0182, format version 4) and so failed
 * every correct Production archive (0164, version 2, 54 areas).
 *
 * Two levels: the pure decision (`platform-archive-audit.ts`) and the tool
 * itself, run as a subprocess against synthetic archives built by the real
 * archive builder. No database, no network, no real data — every row here is
 * invented, and the files live in a temporary directory outside the
 * repository (the tool refuses files inside it).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { SALE_ITEM_CORRECTIONS_SECTIONS, SALES_RECONCILIATION_SECTIONS } from "./manifest";
import {
  AREAS_INTRODUCED_IN, checkPlatformAreas, platformAreasFor, resolveExpectedProject,
  versionIntroducing,
} from "./platform-archive-audit";
import { authInventoryDocument, platformArchive, type PlatformExportDocument } from "./platform-archive";
import { PLATFORM_FORMAT_VERSION, PLATFORM_SECTIONS, SECTIONS_BY_FORMAT_VERSION } from "./platform-manifest";
import { zipBytes } from "../zip/zip-writer";

const PROD = "zmiwxswrpkmizvqsgype";
const STAGING = "qqxcpesbwfxzgytkdsac";
const REFS = { production: PROD, staging: STAGING };
const RECON = SALES_RECONCILIATION_SECTIONS.map((s) => s.key);
const CORRECTIONS = SALE_ITEM_CORRECTIONS_SECTIONS.map((s) => s.key);

/** Row counts for a key list: every area an empty list unless given. */
const rows = (keys: readonly string[], n: Record<string, number> = {}) =>
  Object.fromEntries(keys.map((k) => [k, n[k] ?? 0]));

describe("platformAreasFor: the expectation per format version", () => {
  it("adds up to SECTIONS_BY_FORMAT_VERSION for every known version", () => {
    for (const [v, n] of Object.entries(SECTIONS_BY_FORMAT_VERSION)) {
      expect(platformAreasFor(Number(v))).toHaveLength(n);
    }
  });

  it("version 2 (Production, 0164) is 54 areas: no 0174 area and no sale_item_corrections", () => {
    const v2 = platformAreasFor(2)!;
    expect(v2).toHaveLength(54);
    expect(v2).toContain("purchase_calculations");
    for (const k of [...RECON, ...CORRECTIONS]) expect(v2).not.toContain(k);
  });

  it("version 3 has the seven of 0174 but not 0182; version 4 is the whole manifest", () => {
    const v3 = platformAreasFor(3)!;
    for (const k of RECON) expect(v3).toContain(k);
    for (const k of CORRECTIONS) expect(v3).not.toContain(k);
    expect(platformAreasFor(4)).toEqual(PLATFORM_SECTIONS.map((s) => s.key).sort());
    expect(PLATFORM_FORMAT_VERSION).toBe(4);
  });

  it("version 1 lacks purchase_calculations; an unknown version yields null, never an empty expectation", () => {
    expect(platformAreasFor(1)).not.toContain("purchase_calculations");
    expect(platformAreasFor(1)).toHaveLength(53);
    expect(platformAreasFor(5)).toBeNull();
    expect(platformAreasFor(0)).toBeNull();
  });

  it("every introduced area exists in the manifest, and none is introduced twice", () => {
    const all = Object.values(AREAS_INTRODUCED_IN).flat();
    expect(new Set(all).size).toBe(all.length);
    for (const k of all) expect(PLATFORM_SECTIONS.some((s) => s.key === k)).toBe(true);
    expect(versionIntroducing("sale_item_corrections")).toBe(4);
    expect(versionIntroducing("orders")).toBe(1);
    expect(versionIntroducing("no_such_area")).toBeNull();
  });
});

describe("checkPlatformAreas: valid and invalid archives", () => {
  const v2 = platformAreasFor(2)!;
  const failed = (checks: ReturnType<typeof checkPlatformAreas>) => checks.filter((c) => !c.ok);

  it("THE REGRESSION: a correct version-2 archive passes every area check", () => {
    const r = rows(v2, { orders: 1, purchase_calculations: 3 });
    expect(failed(checkPlatformAreas({ version: 2, documentKeys: v2, coverCounts: r, rowCounts: r }))).toEqual([]);
  });

  it("a correct version-3 and version-4 archive pass too (Staging behaviour unchanged)", () => {
    for (const v of [3, 4]) {
      const keys = platformAreasFor(v)!;
      const r = rows(keys);
      expect(failed(checkPlatformAreas({ version: v, documentKeys: keys, coverCounts: r, rowCounts: r }))).toEqual([]);
    }
  });

  it("a version-2 archive with one area missing fails — and names the area", () => {
    const keys = v2.filter((k) => k !== "invoices");
    const r = rows(keys);
    const f = failed(checkPlatformAreas({ version: 2, documentKeys: keys, coverCounts: r, rowCounts: r }));
    expect(f.map((c) => c.name)).toContain("alle 54 Bereiche der Version 2 sind da");
    expect(f.find((c) => c.name.startsWith("alle 54"))!.detail).toBe("fehlen: invoices");
  });

  it("a version-2 archive carrying sale_item_corrections fails as an area of a later version", () => {
    const keys = [...v2, "sale_item_corrections"];
    const r = rows(keys);
    const f = failed(checkPlatformAreas({ version: 2, documentKeys: keys, coverCounts: r, rowCounts: r }));
    const later = f.find((c) => c.name.startsWith("kein Bereich einer spaeteren"));
    expect(later?.detail).toBe("sale_item_corrections (ab 4)");
  });

  it("swapping one area for a later one keeps the total at 54 and still fails twice", () => {
    const keys = [...v2.filter((k) => k !== "orders"), RECON[0]];
    const r = rows(keys);
    const names = failed(checkPlatformAreas({ version: 2, documentKeys: keys, coverCounts: r, rowCounts: r }))
      .map((c) => c.name);
    expect(names).not.toContain("database.json fuehrt 54 Bereiche");
    expect(names).toContain("alle 54 Bereiche der Version 2 sind da");
    expect(names).toContain("kein Bereich einer spaeteren Formatversion als 2");
  });

  it("an unknown area, a non-list area and a wrong cover count each fail", () => {
    const keys = [...v2.filter((k) => k !== "orders"), "mystery"];
    const r = { ...rows(keys), mystery: -1 };
    const f = failed(checkPlatformAreas({ version: 2, documentKeys: keys, coverCounts: rows(keys, { invoices: 9 }), rowCounts: r }));
    expect(f.find((c) => c.name === "kein Bereich, den das Manifest nicht kennt")?.detail).toBe("mystery");
    expect(f.find((c) => c.name === "jeder Bereich ist eine Liste")?.detail).toBe("mystery");
    expect(f.find((c) => c.name.startsWith("jede Zahl in counts"))?.detail).toContain("invoices");
  });

  it("cover and document naming different areas fails; a missing cover fails", () => {
    const r = rows(v2);
    const cover = rows([...v2.filter((k) => k !== "orders"), "sale_item_corrections"]);
    expect(failed(checkPlatformAreas({ version: 2, documentKeys: v2, coverCounts: cover, rowCounts: r }))
      .map((c) => c.name)).toContain("Deckblatt und Dokument nennen DIESELBEN Bereiche");
    expect(failed(checkPlatformAreas({ version: 2, documentKeys: v2, coverCounts: null, rowCounts: r })).length)
      .toBeGreaterThan(0);
  });

  it("an unknown format version fails instead of expecting nothing", () => {
    const f = failed(checkPlatformAreas({ version: 9, documentKeys: [], coverCounts: {}, rowCounts: {} }));
    expect(f).toHaveLength(1);
    expect(f[0].name).toBe("Formatversion 9 ist dieser Codebasis bekannt");
  });
});

describe("resolveExpectedProject: the origin is unambiguous", () => {
  it("production and its ref resolve to the pinned Production ref", () => {
    for (const a of ["production", "Production", PROD]) {
      expect(resolveExpectedProject(a, REFS, null)).toMatchObject({ ok: true, ref: PROD });
    }
  });

  it("staging and its ref resolve to Staging; no argument keeps the .env.staging default", () => {
    expect(resolveExpectedProject("staging", REFS, null)).toMatchObject({ ok: true, ref: STAGING });
    expect(resolveExpectedProject(null, REFS, STAGING)).toMatchObject({ ok: true, ref: STAGING });
  });

  it("anything else is refused: a typo, a foreign ref, an .env.staging pointing elsewhere, no source at all", () => {
    expect(resolveExpectedProject("prod", REFS, STAGING).ok).toBe(false);
    expect(resolveExpectedProject("zmiwxswrpkmizvqsgypf", REFS, STAGING).ok).toBe(false);
    expect(resolveExpectedProject("abcdefghijklmnopqrst", REFS, STAGING).ok).toBe(false);
    expect(resolveExpectedProject(null, REFS, PROD).ok).toBe(false);
    expect(resolveExpectedProject(null, REFS, null).ok).toBe(false);
  });
});

/* ---------------------------------------------------------------- the tool */

const DIR = mkdtempSync(join(tmpdir(), "f4a1-platform-"));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const CALC_FIELDS = PLATFORM_SECTIONS.find((s) => s.source === "purchase_calculations")!.fields;
/** One invented calculation row with exactly the manifest's columns. */
const calculationRow = () => Object.fromEntries(CALC_FIELDS.map((f) =>
  [f, f === "lines" ? { version: 1, lines: [] } : f === "positions" || f === "units" ? 0 : null]));

/** A synthetic archive from the real builder: `keys` areas, all empty but one calculation. */
async function archiveFile(name: string, version: number, keys: readonly string[], project: string) {
  const document: PlatformExportDocument = {
    format_version: version, created_at: "2026-11-14T12:00:00Z", commerce_mode: "live",
    data: Object.fromEntries(keys.map((k) => [k, k === "purchase_calculations" ? [calculationRow()] : []])),
  };
  const archive = platformArchive({
    document, auth: authInventoryDocument([]), listed: [], expected: [],
    bytes: async () => new Uint8Array(0), sourceProject: project,
  });
  const path = join(DIR, name);
  writeFileSync(path, await zipBytes(archive.entries()));
  return path;
}

const runTool = (...args: string[]) => {
  const r = spawnSync(process.execPath, ["tools/verify-platform-archive.mts", ...args], {
    encoding: "utf8", env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};

describe("verify:platform-archive end to end, on synthetic archives", () => {
  it("THE REGRESSION: a version-2 Production archive with 54 areas passes", async () => {
    const f = await archiveFile("prod-v2.zip", 2, platformAreasFor(2)!, PROD);
    const r = runTool("--file", f, "--project", "production", "--version", "2", "--calculations", "1");
    expect(r.out).toContain("alle 54 Bereiche der Version 2 sind da");
    expect(r.out).not.toContain("sale_item_corrections");
    expect(r.out).not.toMatch(/^\s+FAIL/m);
    expect(r.status).toBe(0);
  });

  it("a version-4 Staging archive with 62 areas still passes against Staging", async () => {
    const f = await archiveFile("staging-v4.zip", 4, platformAreasFor(4)!, STAGING);
    const r = runTool("--file", f, "--project", "staging", "--version", "4", "--calculations", "1");
    expect(r.out).not.toMatch(/^\s+FAIL/m);
    expect(r.status).toBe(0);
  });

  it("a Production archive checked as Staging fails loudly — never silently accepted", async () => {
    const f = await archiveFile("prod-v2-b.zip", 2, platformAreasFor(2)!, PROD);
    const r = runTool("--file", f, "--project", "staging", "--version", "2", "--calculations", "1");
    expect(r.out).toMatch(/FAIL\s+source_project ist qqxcpesbwfxzgytkdsac/);
    expect(r.status).toBe(1);
  });

  it("a Staging archive checked as Production fails", async () => {
    const f = await archiveFile("staging-v2.zip", 2, platformAreasFor(2)!, STAGING);
    const r = runTool("--file", f, "--project", "production", "--version", "2", "--calculations", "1");
    expect(r.out).toMatch(/FAIL\s+source_project ist zmiwxswrpkmizvqsgype/);
    expect(r.status).toBe(1);
  });

  it("an unknown --project is refused before the archive is read", async () => {
    const f = await archiveFile("prod-v2-c.zip", 2, platformAreasFor(2)!, PROD);
    const r = runTool("--file", f, "--project", "prod");
    expect(r.out).toContain("ABBRUCH");
    expect(r.status).toBe(2);
  });

  it("a version-3 archive checked as version 2 fails (wrong version, later areas)", async () => {
    const f = await archiveFile("prod-v3.zip", 3, platformAreasFor(3)!, PROD);
    const r = runTool("--file", f, "--project", "production", "--version", "2", "--calculations", "1");
    expect(r.out).toMatch(/FAIL\s+manifest\.json nennt format_version 2/);
    expect(r.out).toMatch(/FAIL\s+kein Bereich einer spaeteren Formatversion als 2/);
    expect(r.status).toBe(1);
  });

  it("a corrupted archive (bytes flipped) fails the CRC check", async () => {
    const f = await archiveFile("prod-v2-d.zip", 2, platformAreasFor(2)!, PROD);
    const { readFileSync } = await import("node:fs");
    const b = readFileSync(f);
    b[60] ^= 0xff; b[61] ^= 0xff;
    writeFileSync(f, b);
    const r = runTool("--file", f, "--project", "production", "--version", "2");
    expect(r.status).not.toBe(0);
  });
});
