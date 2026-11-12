/**
 * A Vercel PREVIEW serves nothing unless it talks to Staging (ADR-0185).
 *
 * WHY. A preview is built with whatever `NEXT_PUBLIC_SUPABASE_*` values the
 * Vercel "Preview" environment carries. On 2026-10-26 those were the
 * Production values: a preview was Production under another address. ADR-0185
 * allows `development/skyisles-v2` as a Staging preview — and this module is
 * the part of that promise that does not depend on somebody having read the
 * dashboard correctly.
 *
 * THE RULE, AND NOTHING ELSE:
 *
 *   not on Vercel (`VERCEL` unset)   allowed — local `next dev`, `next start`,
 *                                    tests, tools. Never blocked here.
 *   VERCEL_ENV = production          allowed — Production is never blocked by
 *                                    this module, whatever its URL.
 *   VERCEL_ENV = development         allowed (`vercel dev`).
 *   VERCEL_ENV = preview             ONLY with the Staging URL: scheme https,
 *                                    host `qqxcpesbwfxzgytkdsac.supabase.co`,
 *                                    no port.
 *                                    Missing, unparsable or any other host:
 *                                    blocked. Every preview, not only the
 *                                    branch — a preview with Production values
 *                                    is the trap for every branch alike.
 *   VERCEL_ENV missing or unknown    blocked IF the commit is the Staging
 *                                    preview branch (`VERCEL_GIT_COMMIT_REF`)
 *                                    and the URL is not Staging; otherwise
 *                                    "undetermined" and allowed. That is the
 *                                    one gap: see ADR-0185, "Grenzen".
 *
 * WHERE IT IS ENFORCED (three places, each without the others):
 *
 *   1. `next.config.ts` — at BUILD time. The `NEXT_PUBLIC_*` values are
 *      written into the bundle by the build, so the build sees exactly what
 *      the deployment will use. A blocked preview fails to build and never
 *      becomes a deployment.
 *   2. `src/proxy.ts` — every matched request answers 503 before anything
 *      else runs.
 *   3. `supabasePublicConfig()` — every server-side Supabase client is built
 *      through it and throws instead, so a path the proxy does not cover
 *      (a matcher change, a moved Server Function) still cannot reach the
 *      wrong project.
 *
 * NO SECRET LEAVES THIS FILE. Messages name the reason and the expected host,
 * never the configured URL or a key.
 *
 * DEPENDENCY-FREE ON PURPOSE: `next.config.ts` imports it, and the build loads
 * that file before path aliases exist.
 */

/** The Staging Supabase project (ADR-0149, `.env.staging`). Not a secret. */
export const STAGING_PREVIEW_REF = "qqxcpesbwfxzgytkdsac";
/** The one host a preview may talk to. */
export const STAGING_PREVIEW_HOST = `${STAGING_PREVIEW_REF}.supabase.co`;
/** The branch ADR-0185 allows as a Staging preview. */
export const STAGING_PREVIEW_BRANCH = "development/skyisles-v2";

export type DeploymentEnv = {
  VERCEL?: string;
  VERCEL_ENV?: string;
  VERCEL_GIT_COMMIT_REF?: string;
  /** `NEXT_PUBLIC_SUPABASE_URL` — passed in, because Next inlines it at build. */
  supabaseUrl?: string;
};

export type DeploymentVerdict =
  | { allowed: true; context: "local" | "production" | "vercel-development" | "preview" | "undetermined" }
  | { allowed: false; context: "preview"; reason: "url_missing" | "url_invalid" | "url_not_staging" };

/** Is `url` exactly the Staging project over https? Pure. */
export function isStagingSupabaseUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === STAGING_PREVIEW_HOST && parsed.port === "";
  } catch {
    return false;
  }
}

function previewVerdict(url: string | undefined): DeploymentVerdict {
  if (!url || url.trim() === "") return { allowed: false, context: "preview", reason: "url_missing" };
  try {
    new URL(url);
  } catch {
    return { allowed: false, context: "preview", reason: "url_invalid" };
  }
  return isStagingSupabaseUrl(url)
    ? { allowed: true, context: "preview" }
    : { allowed: false, context: "preview", reason: "url_not_staging" };
}

/** The whole decision, without reading the environment. Tested directly. */
export function deploymentVerdict(env: DeploymentEnv): DeploymentVerdict {
  if (env.VERCEL !== "1") return { allowed: true, context: "local" };
  switch (env.VERCEL_ENV) {
    case "production":
      return { allowed: true, context: "production" };
    case "development":
      return { allowed: true, context: "vercel-development" };
    case "preview":
      return previewVerdict(env.supabaseUrl);
    default:
      // Vercel did not say which environment this is. The Staging preview
      // branch is still recognised by its commit ref; anything else cannot be
      // told apart from Production and is not blocked (ADR-0185, "Grenzen").
      if (env.VERCEL_GIT_COMMIT_REF === STAGING_PREVIEW_BRANCH) {
        const verdict = previewVerdict(env.supabaseUrl);
        return verdict.allowed ? { allowed: true, context: "undetermined" } : verdict;
      }
      return { allowed: true, context: "undetermined" };
  }
}

/** The environment as this process sees it. */
export function currentDeploymentEnv(): DeploymentEnv {
  return {
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  };
}

/** A message that names the reason and the expected host — never a value. */
export function blockedMessage(verdict: Extract<DeploymentVerdict, { allowed: false }>): string {
  return `[deployment] preview refused (${verdict.reason}): on a Vercel preview ` +
    `NEXT_PUBLIC_SUPABASE_URL must name host ${STAGING_PREVIEW_HOST} over https (ADR-0185).`;
}

export class DeploymentTargetError extends Error {
  constructor(public readonly verdict: Extract<DeploymentVerdict, { allowed: false }>) {
    super(blockedMessage(verdict));
    this.name = "DeploymentTargetError";
  }
}

/** Throws on a blocked preview; returns the verdict otherwise. */
export function assertDeploymentTarget(env: DeploymentEnv = currentDeploymentEnv()): DeploymentVerdict {
  const verdict = deploymentVerdict(env);
  if (!verdict.allowed) throw new DeploymentTargetError(verdict);
  return verdict;
}

/**
 * URL and anon key for a SERVER-SIDE Supabase client — only after the check.
 * Every server-side client in the app is built from this (ADR-0185).
 */
export function supabasePublicConfig(env: DeploymentEnv = currentDeploymentEnv()): { url: string; anonKey: string } {
  assertDeploymentTarget(env);
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  };
}
