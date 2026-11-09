/**
 * The write guard of the legacy order book sync (Stability Baseline 1 / M-02).
 *
 * Before: `tools/sync-legacy-orderbook.mts --apply` wrote through the
 * service-role key to whatever project the `--env-file` named;
 * `SKYISLES_REQUIRE_STAGING` was set by the npm script and never read.
 *
 * Two layers of proof:
 *   - the pure decision `checkPinnedStagingWrite` for every configuration;
 *   - the real tool, started as a process with fabricated environments in a
 *     temporary directory: every refusal exits 1 BEFORE any connection — the
 *     URLs are unreachable `.invalid` hosts, so a run that got past the guard
 *     would fail differently and visibly.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  checkPinnedStagingWrite, PINNED_REFS, type EnvMap, type Reference,
} from "../../../tools/lib/staging-guard.mts";

const STAGING_REF = PINNED_REFS.staging;
const PRODUCTION_REF = PINNED_REFS.production;
const url = (ref: string) => `https://${ref}.supabase.co`;
const STAGING = url(STAGING_REF);
const PROD = url(PRODUCTION_REF);
const THIRD = url("abcdefghunknownproj");
const STAGING_KEY = "service-role-staging";
const PROD_KEY = "service-role-production";

const env = (u: string, k: string): EnvMap => ({ NEXT_PUBLIC_SUPABASE_URL: u, SUPABASE_SERVICE_ROLE_KEY: k });
const ref = (over: Partial<Reference> = {}): Reference => ({
  staging: env(STAGING, STAGING_KEY), production: env(PROD, PROD_KEY), ...over,
});

describe("checkPinnedStagingWrite — the decision", () => {
  it("lets the pinned staging project through", () => {
    const v = checkPinnedStagingWrite({ url: STAGING, serviceRoleKey: STAGING_KEY }, ref());
    expect(v).toEqual({ ok: true, origin: STAGING, ref: STAGING_REF });
  });

  it("…also with a trailing slash and upper case", () => {
    expect(checkPinnedStagingWrite({ url: `${STAGING.toUpperCase()}/`, serviceRoleKey: STAGING_KEY }, ref()).ok).toBe(true);
  });

  it("refuses production — named in .env.local", () => {
    const v = checkPinnedStagingWrite({ url: PROD, serviceRoleKey: PROD_KEY }, ref());
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("pinned_production");
  });

  it("refuses production even when .env.local is missing and .env.staging was pointed at it", () => {
    const v = checkPinnedStagingWrite({ url: PROD, serviceRoleKey: PROD_KEY },
      ref({ staging: env(PROD, PROD_KEY), production: {} }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("pinned_production");
  });

  it("refuses the production key sent to the staging URL", () => {
    const v = checkPinnedStagingWrite({ url: STAGING, serviceRoleKey: PROD_KEY }, ref());
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("production_key");
  });

  it("refuses an unknown project", () => {
    const v = checkPinnedStagingWrite({ url: THIRD, serviceRoleKey: "k" }, ref());
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("unknown_project");
  });

  it("refuses an unknown project even when .env.staging names it (a misleading env file)", () => {
    const v = checkPinnedStagingWrite({ url: THIRD, serviceRoleKey: "k" }, ref({ staging: env(THIRD, "k") }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("not_pinned_staging");
  });

  it("refuses a missing URL", () => {
    const v = checkPinnedStagingWrite({ url: undefined, serviceRoleKey: STAGING_KEY }, ref());
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("no_target_url");
  });

  it("refuses an unparseable URL", () => {
    const v = checkPinnedStagingWrite({ url: "not a url", serviceRoleKey: STAGING_KEY }, ref());
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("no_target_url");
  });

  it("refuses when .env.staging is missing — nothing to allow-list", () => {
    const v = checkPinnedStagingWrite({ url: STAGING, serviceRoleKey: STAGING_KEY }, ref({ staging: {} }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("no_staging_reference");
  });

  it("the pins are the repository's two literal project refs", () => {
    expect(PINNED_REFS).toEqual({ staging: "qqxcpesbwfxzgytkdsac", production: "zmiwxswrpkmizvqsgype" });
  });
});

describe("the tool — the guard runs before the client exists", () => {
  const TOOL = readFileSync("tools/sync-legacy-orderbook.mts", "utf8");

  it("--apply calls the pinned write guard, the preview the shared read guard", () => {
    expect(TOOL).toContain('if (APPLY) requirePinnedStagingWrite("sync-legacy-orderbook --apply");');
    // M-04B: the preview no longer relies on the optional flag either.
    expect(TOOL).toContain('else guardWriteTool("sync-legacy-orderbook", process.argv.slice(2), { apply: false });');
    expect(TOOL).not.toContain("requireStagingIfRequested");
  });

  it("…and that line comes before createClient and before any rpc", () => {
    const guard = TOOL.indexOf("if (APPLY) requirePinnedStagingWrite(");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(TOOL.indexOf("createClient("));
    expect(guard).toBeLessThan(TOOL.indexOf(".rpc("));
    expect(guard).toBeLessThan(TOOL.indexOf(".from("));
  });
});

describe("the tool, started for real — refused before any connection", () => {
  const ROOT = resolve(".");
  const OFFLINE = `data:text/javascript,${encodeURIComponent(
    "globalThis.fetch = () => Promise.reject(new Error('offline test: no network'));")}`;
  const dirs: string[] = [];
  afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

  /** A temporary working directory with fabricated .env files; the tool runs there. */
  function run(files: { staging?: string; local?: string }, target: EnvMap, args: string[]) {
    const dir = mkdtempSync(join(tmpdir(), "m02-guard-"));
    dirs.push(dir);
    if (files.staging) writeFileSync(join(dir, ".env.staging"), files.staging);
    if (files.local) writeFileSync(join(dir, ".env.local"), files.local);
    // The caller's own target and flag never leak into the child.
    const base = { ...process.env };
    for (const k of ["SKYISLES_REQUIRE_STAGING", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) delete base[k];
    // No network, ever: fetch is replaced before the tool loads, so even the
    // run that passes the guard cannot reach a real project.
    return spawnSync(process.execPath, ["--import", OFFLINE, join(ROOT, "tools/sync-legacy-orderbook.mts"), ...args], {
      cwd: dir, encoding: "utf8", timeout: 30_000,
      env: { ...base, ...target, SKYISLES_WORKBOOK: join(dir, "missing.xlsx") },
    });
  }
  const file = (u: string, k: string) => `NEXT_PUBLIC_SUPABASE_URL=${u}\nSUPABASE_SERVICE_ROLE_KEY=${k}\n`;
  const BOTH = { staging: file(STAGING, STAGING_KEY), local: file(PROD, PROD_KEY) };
  const refused = (r: ReturnType<typeof run>) => {
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("WRITE GUARD — refusing to run.");
    expect(r.stderr).toContain("Nothing has been read and nothing has been written.");
    // Never reached: neither the target banner nor a single table read.
    expect(r.stdout).not.toContain("Ziel ");
  };

  it("--apply against production (the old sync:orderbook:prod --apply) is refused", () => {
    refused(run(BOTH, env(PROD, PROD_KEY), ["--apply"]));
  });

  it("--apply against an unknown project is refused", () => {
    refused(run(BOTH, env(THIRD, "k"), ["--apply"]));
  });

  it("--apply with a misleading .env.staging naming production is refused", () => {
    refused(run({ staging: file(PROD, PROD_KEY) }, env(PROD, PROD_KEY), ["--apply"]));
  });

  it("--apply with no configuration at all is refused", () => {
    refused(run({}, {}, ["--apply"]));
  });

  it("--apply against the pinned staging project passes the guard (then stops at the offline fetch)", () => {
    const r = run(BOTH, env(STAGING, STAGING_KEY), ["--apply"]);
    expect(r.stdout).toContain(`write guard: passed — target is staging (${STAGING_REF}).`);
    expect(r.stderr).not.toContain("WRITE GUARD");
    expect(r.stdout + r.stderr).toContain("offline test: no network");
    expect(r.status).not.toBe(0);
  }, 30_000); // supabase-js retries the refused fetch with backoff (~7 s), all offline

  it("the preview refuses production unless it is named — flag or no flag (M-04B)", () => {
    for (const extra of [{ SKYISLES_REQUIRE_STAGING: "1" }, {}] as EnvMap[]) {
      const r = run(BOTH, { ...env(PROD, PROD_KEY), ...extra }, []);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("PRODUCTION WRITE GUARD — refusing to run.");
      expect(r.stdout).not.toContain("Ziel ");
    }
  });
});
