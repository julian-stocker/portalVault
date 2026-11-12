/**
 * The preview lock (ADR-0185): a Vercel preview serves nothing unless it talks
 * to Staging — at build, in the proxy, and in every server-side Supabase
 * client. Production and local development are never blocked.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { STAGING_PROJECT_REF } from "@/lib/admin/catalog-source";
import {
  DeploymentTargetError, STAGING_PREVIEW_BRANCH, STAGING_PREVIEW_HOST, STAGING_PREVIEW_REF,
  assertDeploymentTarget, blockedMessage, deploymentVerdict, isStagingSupabaseUrl, supabasePublicConfig,
} from "@/lib/ops/deployment-target";

const STAGING = `https://${STAGING_PREVIEW_HOST}`;
const PRODUCTION = "https://zmiwxswrpkmizvqsgype.supabase.co";
const KEY = "anon-key-that-must-never-appear";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); vi.doUnmock("@/lib/supabase/middleware"); vi.doUnmock("next/headers"); });

/** Sets exactly these deployment variables; everything else unset. */
function stub(env: { VERCEL?: string; VERCEL_ENV?: string; VERCEL_GIT_COMMIT_REF?: string; url?: string }) {
  for (const name of ["VERCEL", "VERCEL_ENV", "VERCEL_GIT_COMMIT_REF"] as const) vi.stubEnv(name, env[name] ?? "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", env.url ?? "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", KEY);
}

describe("the decision", () => {
  it.each([
    ["local, no Vercel at all", {}, true],
    ["local with the Production URL (npm run dev)", { supabaseUrl: PRODUCTION }, true],
    ["Production with the Production URL", { VERCEL: "1", VERCEL_ENV: "production", supabaseUrl: PRODUCTION }, true],
    ["Production even with a missing URL — never blocked here", { VERCEL: "1", VERCEL_ENV: "production" }, true],
    ["vercel dev", { VERCEL: "1", VERCEL_ENV: "development", supabaseUrl: PRODUCTION }, true],
    ["a preview with the Staging URL", { VERCEL: "1", VERCEL_ENV: "preview", supabaseUrl: STAGING }, true],
    ["a preview with a trailing slash", { VERCEL: "1", VERCEL_ENV: "preview", supabaseUrl: `${STAGING}/` }, true],
  ])("%s → allowed", (_label, env, allowed) => {
    expect(deploymentVerdict(env).allowed).toBe(allowed);
  });

  it.each([
    ["the Production URL", PRODUCTION, "url_not_staging"],
    ["no URL", undefined, "url_missing"],
    ["an empty URL", "  ", "url_missing"],
    ["not a URL", "qqxcpesbwfxzgytkdsac", "url_invalid"],
    ["Staging over http", `http://${STAGING_PREVIEW_HOST}`, "url_not_staging"],
    ["Staging with a port", `${STAGING}:8443`, "url_not_staging"],
    ["a look-alike host", `https://${STAGING_PREVIEW_HOST}.example.com`, "url_not_staging"],
    ["a sub-domain of Staging", `https://x.${STAGING_PREVIEW_HOST}`, "url_not_staging"],
    ["another Supabase project", "https://abcdefghijklmnopqrst.supabase.co", "url_not_staging"],
  ])("a preview with %s → blocked (%s)", (_label, supabaseUrl, reason) => {
    expect(deploymentVerdict({ VERCEL: "1", VERCEL_ENV: "preview", supabaseUrl }))
      .toEqual({ allowed: false, context: "preview", reason });
  });

  it("every preview, not only the Staging branch", () => {
    expect(deploymentVerdict({ VERCEL: "1", VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "feature/x", supabaseUrl: PRODUCTION }).allowed)
      .toBe(false);
  });

  it("Vercel without VERCEL_ENV: the Staging branch is still recognised by its ref", () => {
    expect(deploymentVerdict({ VERCEL: "1", VERCEL_GIT_COMMIT_REF: STAGING_PREVIEW_BRANCH, supabaseUrl: PRODUCTION }))
      .toEqual({ allowed: false, context: "preview", reason: "url_not_staging" });
    expect(deploymentVerdict({ VERCEL: "1", VERCEL_GIT_COMMIT_REF: STAGING_PREVIEW_BRANCH, supabaseUrl: STAGING }))
      .toEqual({ allowed: true, context: "undetermined" });
  });

  it("Vercel without VERCEL_ENV on another ref is undetermined — the documented gap, not a block", () => {
    expect(deploymentVerdict({ VERCEL: "1", VERCEL_GIT_COMMIT_REF: "main", supabaseUrl: PRODUCTION }))
      .toEqual({ allowed: true, context: "undetermined" });
    expect(deploymentVerdict({ VERCEL: "1", VERCEL_ENV: "something-new", supabaseUrl: PRODUCTION }))
      .toEqual({ allowed: true, context: "undetermined" });
  });

  it("the Staging project is the one the rest of the code calls Staging", () => {
    expect(STAGING_PREVIEW_REF).toBe(STAGING_PROJECT_REF);
    expect(isStagingSupabaseUrl(STAGING)).toBe(true);
    expect(isStagingSupabaseUrl(PRODUCTION)).toBe(false);
    expect(isStagingSupabaseUrl(null)).toBe(false);
  });
});

describe("no value leaves the lock", () => {
  it("the message names the reason and the expected host, never the configured URL or a key", () => {
    const secretish = "https://zmiwxswrpkmizvqsgype.supabase.co/?apikey=" + KEY;
    const verdict = deploymentVerdict({ VERCEL: "1", VERCEL_ENV: "preview", supabaseUrl: secretish });
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    const message = blockedMessage(verdict);
    expect(message).toContain(verdict.reason);
    expect(message).toContain(STAGING_PREVIEW_HOST);
    expect(message).not.toContain("zmiwxswrpkmizvqsgype");
    expect(message).not.toContain(KEY);
  });

  it("assertDeploymentTarget throws a DeploymentTargetError, supabasePublicConfig hands out nothing", () => {
    stub({ VERCEL: "1", VERCEL_ENV: "preview", url: PRODUCTION });
    expect(() => assertDeploymentTarget()).toThrow(DeploymentTargetError);
    expect(() => supabasePublicConfig()).toThrow(DeploymentTargetError);
  });

  it("allowed: supabasePublicConfig returns exactly the configured pair", () => {
    stub({ VERCEL: "1", VERCEL_ENV: "preview", url: STAGING });
    expect(supabasePublicConfig()).toEqual({ url: STAGING, anonKey: KEY });
    stub({ url: PRODUCTION });
    expect(supabasePublicConfig()).toEqual({ url: PRODUCTION, anonKey: KEY });
  });
});

describe("enforced in the proxy", () => {
  async function loadProxy() {
    const updateSession = vi.fn(async () => new Response("passed", { status: 200 }));
    vi.doMock("@/lib/supabase/middleware", () => ({ updateSession }));
    const { proxy } = await import("@/proxy");
    return { proxy, updateSession };
  }
  const request = () => ({ nextUrl: new URL("https://preview.example/agb") }) as never;

  it("a blocked preview answers 503 before the session is touched, without values", async () => {
    stub({ VERCEL: "1", VERCEL_ENV: "preview", url: PRODUCTION });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { proxy, updateSession } = await loadProxy();
    const response = await proxy(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.text();
    expect(body).toContain("gesperrt");
    expect(body).not.toMatch(/zmiwxswrpkmizvqsgype|anon-key/);
    expect(updateSession).not.toHaveBeenCalled();
    expect(error.mock.calls.flat().join(" ")).not.toContain(KEY);
    error.mockRestore();
  });

  it.each([
    ["Production", { VERCEL: "1", VERCEL_ENV: "production", url: PRODUCTION }],
    ["local development", { url: PRODUCTION }],
    ["the Staging preview", { VERCEL: "1", VERCEL_ENV: "preview", url: STAGING }],
  ])("%s passes through to the session refresh", async (_label, env) => {
    stub(env);
    const { proxy, updateSession } = await loadProxy();
    expect((await proxy(request())).status).toBe(200);
    expect(updateSession).toHaveBeenCalledTimes(1);
  });
});

describe("enforced in every server-side Supabase client", () => {
  it("the server client refuses before reading a cookie", async () => {
    const cookies = vi.fn(async () => ({ getAll: () => [], set: () => {} }));
    vi.doMock("next/headers", () => ({ cookies }));
    stub({ VERCEL: "1", VERCEL_ENV: "preview", url: PRODUCTION });
    const { createClient } = await import("@/lib/supabase/server");
    await expect(createClient()).rejects.toThrow(/preview refused \(url_not_staging\)/);
    expect(cookies).not.toHaveBeenCalled();
  });

  it("the anonymous client of the legal pages refuses — and the pages read that as unavailable", async () => {
    stub({ VERCEL: "1", VERCEL_ENV: "preview", url: PRODUCTION });
    const { anonClient } = await import("@/lib/identity/public");
    expect(() => anonClient()).toThrow(/preview refused \(url_not_staging\)/);
    const source = readFileSync("src/lib/identity/public.ts", "utf8");
    const fetchBody = source.slice(source.indexOf("export const fetchSellerLegal"));
    expect(fetchBody.indexOf("try {")).toBeLessThan(fetchBody.indexOf("anonClient()"));
    const versions = readFileSync("src/lib/legal/versions.ts", "utf8");
    const versionsBody = versions.slice(versions.indexOf("export const fetchLegalVersions"));
    expect(versionsBody.indexOf("try {")).toBeLessThan(versionsBody.indexOf("anonClient()"));
  });

  it("no server-side client is built past the lock", () => {
    /** Every shipped source file under src/, tests excluded. */
    function* sources(dir: string): Generator<string> {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) yield* sources(path);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) yield path;
      }
    }
    const builders: string[] = [];
    for (const path of sources("src")) {
      const code = readFileSync(path, "utf8");
      // A value import of a client factory from either Supabase package.
      if (/^import \{[^}]*\b(createClient|createServerClient|createBrowserClient)\b[^}]*\} from "@supabase\/(supabase-js|ssr)"/m.test(code)) {
        builders.push(path);
      }
    }
    expect(builders.sort()).toEqual([
      join("src", "lib", "identity", "public.ts"),
      join("src", "lib", "supabase", "client.ts"),
      join("src", "lib", "supabase", "middleware.ts"),
      join("src", "lib", "supabase", "server.ts"),
    ]);
    for (const path of builders.filter((p) => !p.endsWith("client.ts"))) {
      const code = readFileSync(path, "utf8");
      expect(code, path).toContain("supabasePublicConfig()");
      expect(code, path).not.toMatch(/process\.env\.NEXT_PUBLIC_SUPABASE_(URL|ANON_KEY)!/);
    }
    // The BROWSER client cannot see VERCEL_ENV; it is covered by the build lock
    // (a blocked preview has no bundle) — ADR-0185, "Grenzen".
    expect(readFileSync("src/lib/supabase/client.ts", "utf8")).toContain('"use client"');
  });
});

describe("enforced at build time", () => {
  it("next.config.ts refuses a preview that is not wired to Staging", async () => {
    stub({ VERCEL: "1", VERCEL_ENV: "preview", url: PRODUCTION });
    await expect(import("../../../next.config")).rejects.toThrow(/preview refused \(url_not_staging\)/);
  });

  it.each([
    ["the Staging preview", { VERCEL: "1", VERCEL_ENV: "preview", url: STAGING }],
    ["Production", { VERCEL: "1", VERCEL_ENV: "production", url: PRODUCTION }],
    ["a local build", { url: PRODUCTION }],
  ])("and builds %s", async (_label, env) => {
    stub(env);
    const config = (await import("../../../next.config")).default;
    expect(typeof config.headers).toBe("function");
  });
});
