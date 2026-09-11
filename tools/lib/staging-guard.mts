/**
 * The production guard for staging-only tooling.
 *
 * WHY THIS EXISTS
 *
 * `tools/dev-staging.mts` already refused to start when `.env.staging` named
 * the same project as `.env.local`. That interlock was right and it was in one
 * file, while the tools that actually *write* — the catalog import, the
 * character import, the staging seeds — had no such check at all. A seed is one
 * mistyped `--env-file` away from production, and production carries data no
 * import owns: administrator image overrides, curated character links,
 * editorial visibility, real orders.
 *
 * So the interlock moves here and every staging-only writer calls it before its
 * first write.
 *
 * HOW IT DECIDES — POSITIVELY, NOT BY GUESSWORK
 *
 * There is no name matching, no "looks like staging", no `supabase link`, no
 * inspection of project titles. Two identities are compared exactly:
 *
 *   the origin      scheme + host of NEXT_PUBLIC_SUPABASE_URL, lower-cased and
 *                   stripped of trailing slashes. Two Supabase projects never
 *                   share one.
 *   the secret      SUPABASE_SERVICE_ROLE_KEY, compared verbatim.
 *
 * The target must be **allow-listed** against `.env.staging` and must **not**
 * match `.env.local` on either identity. Allow-listing is what makes this a
 * guard rather than a filter: an unknown project is refused, not permitted for
 * lack of evidence.
 *
 * The key comparison is the one that survives a swapped URL. If somebody runs a
 * staging tool with `--env-file=.env.local`, the URL check catches it; if a
 * `.env.staging` has been edited to name production, the URL check catches that
 * too; and if only the credential was copied across, the key check catches what
 * the URL alone would have missed.
 *
 * WHAT IT IS NOT
 *
 * Not a security boundary. Row level security and the `security definer`
 * functions are that, and they do not care which tool is calling. This stops an
 * accident, which is the failure mode that has actually happened in this
 * project (a dev server left pointing at production, 2026-09-11).
 */
import { readFileSync } from "node:fs";

/** The two environment files this repository uses, by convention. */
export const PRODUCTION_ENV_FILE = ".env.local";
export const STAGING_ENV_FILE = ".env.staging";

/**
 * Set by the `:staging` npm scripts on tools that legitimately serve both
 * environments — the verifiers. A seed calls `requireStaging()` outright and
 * ignores this.
 */
export const REQUIRE_STAGING_FLAG = "SKYISLES_REQUIRE_STAGING";

export type EnvMap = Record<string, string>;

/** `KEY=value` lines, ignoring comments and blanks. Quotes are stripped. */
export function readEnvFile(path: string): EnvMap {
  const out: EnvMap = {};
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return out;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * The comparable identity of a Supabase URL: scheme and host, nothing else.
 *
 * Exact, not heuristic. Path, port-less default, trailing slash and letter case
 * are normalised away; everything that distinguishes two projects is kept. An
 * unparseable value yields `null` and is never treated as equal to anything —
 * including another unparseable value.
 */
export function projectOrigin(url: string | undefined | null): string | null {
  if (typeof url !== "string" || url.trim() === "") return null;
  try {
    const parsed = new URL(url.trim());
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * The Supabase project reference, for messages only.
 *
 * `https://abcdefgh.supabase.co` → `abcdefgh`. Never used for a decision: a
 * self-hosted or proxied URL has no ref, and a decision that needed one would
 * be exactly the name-based guessing this module avoids.
 */
export function projectRef(url: string | undefined | null): string | null {
  const origin = projectOrigin(url);
  if (origin === null) return null;
  const host = origin.slice(origin.indexOf("//") + 2);
  const match = /^([a-z0-9-]+)\.supabase\.(co|in|red)$/.exec(host);
  return match ? match[1] : host;
}

/** What the tool is about to connect to. */
export type Target = {
  url: string | undefined;
  serviceRoleKey?: string | undefined;
};

/** The two reference environments the target is judged against. */
export type Reference = {
  staging: EnvMap;
  production: EnvMap;
};

export type GuardRefusal =
  /** The tool has no URL at all — nothing to check, nothing to connect to. */
  | "no_target_url"
  /** The target is the project named in `.env.local`. The headline case. */
  | "production_url"
  /** The target carries the service-role key from `.env.local`. */
  | "production_key"
  /** `.env.staging` names no project, so nothing can be allow-listed. */
  | "no_staging_reference"
  /** The target is some third project that `.env.staging` does not name. */
  | "unknown_project";

export type GuardVerdict =
  | { ok: true; origin: string; ref: string | null }
  | { ok: false; reason: GuardRefusal; message: string };

/**
 * The whole decision, as a pure function.
 *
 * Pure so the refusal can be tested without env files, without a database and
 * without a process that exits. `requireStaging()` below is the thin shell that
 * gives it the real world.
 *
 * The order of the checks is the order of the messages: the two production
 * matches are reported as such even when the allow-list would also have failed,
 * because "you are pointed at production" is the sentence that matters.
 */
export function checkStagingTarget(target: Target, reference: Reference): GuardVerdict {
  const targetOrigin = projectOrigin(target.url);
  if (targetOrigin === null) {
    return {
      ok: false,
      reason: "no_target_url",
      message:
        "no NEXT_PUBLIC_SUPABASE_URL is set, so the target project cannot be identified.",
    };
  }

  const productionOrigin = projectOrigin(reference.production.NEXT_PUBLIC_SUPABASE_URL);
  if (productionOrigin !== null && productionOrigin === targetOrigin) {
    return {
      ok: false,
      reason: "production_url",
      message:
        `the target project ${projectRef(target.url)} is the one named in ` +
        `${PRODUCTION_ENV_FILE}. This tool only ever runs against staging.`,
    };
  }

  // Catches the case a swapped URL would hide: the credential came from
  // production even though the address did not.
  const productionKey = reference.production.SUPABASE_SERVICE_ROLE_KEY;
  if (
    typeof productionKey === "string" &&
    productionKey !== "" &&
    target.serviceRoleKey === productionKey
  ) {
    return {
      ok: false,
      reason: "production_key",
      message:
        `the SUPABASE_SERVICE_ROLE_KEY in use is the one from ${PRODUCTION_ENV_FILE}, ` +
        "whatever URL it is being sent to.",
    };
  }

  const stagingOrigin = projectOrigin(reference.staging.NEXT_PUBLIC_SUPABASE_URL);
  if (stagingOrigin === null) {
    return {
      ok: false,
      reason: "no_staging_reference",
      message:
        `${STAGING_ENV_FILE} does not define NEXT_PUBLIC_SUPABASE_URL, so there is no ` +
        "staging project to check the target against.",
    };
  }

  // Allow-list, deliberately: an unrecognised project is refused rather than
  // permitted because nothing proved it wrong.
  if (stagingOrigin !== targetOrigin) {
    return {
      ok: false,
      reason: "unknown_project",
      message:
        `the target project ${projectRef(target.url)} is neither the staging project ` +
        `named in ${STAGING_ENV_FILE} (${projectRef(
          reference.staging.NEXT_PUBLIC_SUPABASE_URL,
        )}) nor anything this tool is allowed to write to.`,
    };
  }

  return { ok: true, origin: targetOrigin, ref: projectRef(target.url) };
}

/** Reads the two reference files from disk. */
export function referenceFromDisk(): Reference {
  return {
    staging: readEnvFile(STAGING_ENV_FILE),
    production: readEnvFile(PRODUCTION_ENV_FILE),
  };
}

/**
 * Refuse to continue unless the process is pointed at staging.
 *
 * Called by every staging-only writer **before its first write** — before the
 * client is even built, so there is no window in which a connection exists and
 * the check has not run.
 *
 * Exits with code 1 and a message that says a production guard fired, rather
 * than throwing: a tool that is about to write should stop, not unwind into
 * somebody's catch block.
 */
export function requireStaging(toolLabel: string): string {
  const verdict = checkStagingTarget(
    {
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
    referenceFromDisk(),
  );

  if (!verdict.ok) {
    console.error("");
    console.error("  PRODUCTION GUARD — refusing to run.");
    console.error("");
    console.error(`  ${toolLabel} is a staging-only tool, and ${verdict.message}`);
    console.error("");
    console.error(`  Start it with --env-file=${STAGING_ENV_FILE}, or fix that file.`);
    console.error("  Nothing has been written.");
    console.error("");
    process.exit(1);
  }

  console.log(`  production guard: passed — target is staging (${verdict.ref}).`);
  return verdict.origin;
}

/**
 * The same guard, but only when the caller asked for it.
 *
 * For the tools that legitimately serve both environments: the verifiers run
 * against production on purpose, and the `:staging` npm scripts set
 * `SKYISLES_REQUIRE_STAGING=1` to say which run this is. A tool that only ever
 * belongs on staging calls `requireStaging()` directly and does not consult a
 * flag it could be started without.
 */
export function requireStagingIfRequested(toolLabel: string): void {
  if (process.env[REQUIRE_STAGING_FLAG] === "1") requireStaging(toolLabel);
}
