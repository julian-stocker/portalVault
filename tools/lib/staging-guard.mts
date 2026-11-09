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

import { PRODUCTION_REF, STAGING_REF } from "./staging-db.mts";

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

/**
 * WELCHE UMGEBUNG — AUSDRÜCKLICH, NIE GERATEN.
 *
 * Ein Werkzeug, das beide Umgebungen bedient, darf keine Vorauswahl treffen.
 * Ein Default wäre entweder nutzlos (Staging, und der Production-Lauf bricht
 * ohnehin ab) oder gefährlich (Production, und ein vergessenes Flag schreibt
 * in die echten Daten). Also: ohne Angabe passiert nichts.
 *
 * Production verlangt zusätzlich ein zweites, wörtliches Bekenntnis. Das ist
 * dieselbe Idee wie `--confirm-staging` beim Apply: ein Flag, das man nicht
 * durch Editieren des Zeilenendes erreicht, sondern nur durch Hinschreiben.
 *
 * Diese Funktion entscheidet nur über die ABSICHT. Ob das Ziel wirklich die
 * gewünschte Umgebung ist, entscheiden danach `requireStaging()` bzw.
 * `requireProduction()` — durch exakten Vergleich zweier Identitäten, nicht
 * durch das Flag. Ein falsch gesetztes `--env` kommt damit nicht weit.
 */
export type EnvironmentChoice =
  | { ok: true; environment: "staging" | "production" }
  | { ok: false; message: string };

export const ENVIRONMENT_FLAG = "--env";
export const PRODUCTION_CONFIRMATION = "--confirm-production";

/**
 * The confirmation a production write needs, with the project id written out:
 * `--confirm-production=zmiwxswrpkmizvqsgype` (M-04, 2026-11-09). A bare flag
 * is the kind of thing a script or a shell history carries along; the id is
 * the thing one has to look at to type.
 */
export function productionConfirmation(): string {
  return `${PRODUCTION_CONFIRMATION}=${PRODUCTION_REF}`;
}

export function chooseEnvironment(argv: readonly string[]): EnvironmentChoice {
  const values: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === ENVIRONMENT_FLAG) values.push(argv[i + 1] ?? "");
    else if (arg.startsWith(`${ENVIRONMENT_FLAG}=`)) values.push(arg.slice(ENVIRONMENT_FLAG.length + 1));
  }

  if (values.length === 0) {
    return {
      ok: false,
      message: `no ${ENVIRONMENT_FLAG} given. Name the environment out loud: ` +
        `${ENVIRONMENT_FLAG} staging or ${ENVIRONMENT_FLAG} production.`,
    };
  }
  if (values.length > 1) {
    return {
      ok: false,
      message: `${ENVIRONMENT_FLAG} was given ${values.length} times (${values.join(", ")}). ` +
        "One run, one environment.",
    };
  }

  const value = values[0].trim().toLowerCase();
  if (value !== "staging" && value !== "production") {
    return {
      ok: false,
      message: `${ENVIRONMENT_FLAG} ${JSON.stringify(values[0])} is not an environment. ` +
        "Only staging and production exist.",
    };
  }
  if (value === "production" && !argv.includes(productionConfirmation())) {
    return {
      ok: false,
      message: `production also needs ${productionConfirmation()} — the project id written out ` +
        `(a bare ${PRODUCTION_CONFIRMATION} no longer counts, M-04). ` +
        "The environment is named twice on purpose.",
    };
  }
  return { ok: true, environment: value };
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
  /*
   * Since M-04 (2026-11-09) also against the PINNED staging id: a
   * `.env.staging` that names some third project — or production while
   * `.env.local` is missing — no longer passes. Every staging-only writer that
   * calls this gets the stronger check without a change of its own.
   */
  const verdict = checkPinnedStagingWrite(
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
 * Refuse to continue unless the process is pointed at PRODUCTION.
 *
 * The mirror image of `requireStaging()`, and it exists for the one tool that
 * genuinely belongs there: the read-only backup of the administrator's image
 * overrides, which live in production's storage bucket and nowhere else.
 *
 * It decides the same way — positively, by exact identity, never by a name.
 * The target must match BOTH identities in `.env.local`, origin and key, and
 * must not be the project `.env.staging` names. Matching only one is refused:
 * that is a half-configured environment, and a backup taken from one is a
 * backup of something nobody can name afterwards.
 *
 * WHY AN AFFIRMATIVE CHECK AT ALL FOR A READER
 *
 * Nothing here can damage production. What it can do is write production's
 * bytes into a local directory labelled "production" — and a backup that
 * silently contains staging is worse than no backup, because it will be
 * trusted. The label has to be earned.
 */
export function requireProduction(toolLabel: string): string {
  /*
   * Since M-04 (2026-11-09) through `checkProductionTarget`: the same exact
   * comparison with both env files as before, PLUS the pinned production id.
   * `.env.local` alone can no longer make some other project "production".
   */
  const verdict = checkProductionTarget(
    { url: process.env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY },
    referenceFromDisk(),
  );
  if (!verdict.ok) {
    console.error("");
    console.error("  ENVIRONMENT GUARD — refusing to run.");
    console.error("");
    console.error(`  ${toolLabel} reads PRODUCTION on purpose, and ${verdict.message}`);
    console.error("");
    console.error(`  Start it with --env-file=${PRODUCTION_ENV_FILE}, or fix that file.`);
    console.error("  Nothing has been read and nothing has been written.");
    console.error("");
    process.exit(1);
  }
  console.log(`  environment guard: passed — target is production (${verdict.ref}).`);
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

/**
 * THE WRITE GUARD WITH A PINNED PROJECT (2026-11-09, Stability Baseline 1 / M-02).
 *
 * `checkStagingTarget` trusts `.env.staging` to name staging. For a tool whose
 * write path must only ever reach ONE project, that leaves a gap: a
 * `.env.staging` edited to name some third project — or a checkout where
 * `.env.local` is missing, so production cannot be recognised by comparison —
 * would pass. This check adds the two project refs the repository already pins
 * (`tools/lib/staging-db.mts`, the same constants the migration runner uses):
 *
 *   1. the target is the pinned PRODUCTION ref        → refused, whatever the files say
 *   2. everything `checkStagingTarget` checks          → must pass
 *   3. the target is exactly the pinned STAGING ref    → otherwise refused
 *
 * Pure, like `checkStagingTarget`, so every refusal is testable without env
 * files, a database or a process that exits.
 */
export type PinnedRefs = { staging: string; production: string };
export const PINNED_REFS: PinnedRefs = { staging: STAGING_REF, production: PRODUCTION_REF };

export type WriteGuardRefusal = GuardRefusal | "pinned_production" | "not_pinned_staging";
export type WriteGuardVerdict =
  | { ok: true; origin: string; ref: string }
  | { ok: false; reason: WriteGuardRefusal; message: string };

export function checkPinnedStagingWrite(
  target: Target, reference: Reference, pins: PinnedRefs = PINNED_REFS,
): WriteGuardVerdict {
  const ref = projectRef(target.url);
  if (ref !== null && ref === pins.production) {
    return {
      ok: false,
      reason: "pinned_production",
      message: `the target project ${ref} is PRODUCTION. This write path only ever runs against staging.`,
    };
  }
  const verdict = checkStagingTarget(target, reference);
  if (!verdict.ok) return verdict;
  if (ref !== pins.staging) {
    return {
      ok: false,
      reason: "not_pinned_staging",
      message:
        `the target project ${ref} is not the released staging project ${pins.staging}, ` +
        `even though ${STAGING_ENV_FILE} names it.`,
    };
  }
  return { ok: true, origin: verdict.origin, ref };
}

/**
 * The shell around `checkPinnedStagingWrite`: called before the client is
 * built, exits with code 1 on any refusal. Nothing has been read or written
 * at that point.
 */
export function requirePinnedStagingWrite(toolLabel: string): string {
  const verdict = checkPinnedStagingWrite(
    { url: process.env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY },
    referenceFromDisk(),
  );
  if (!verdict.ok) {
    console.error("");
    console.error("  WRITE GUARD — refusing to run.");
    console.error("");
    console.error(`  ${toolLabel} writes only to staging ${PINNED_REFS.staging}, and ${verdict.message}`);
    console.error("");
    console.error("  Nothing has been read and nothing has been written.");
    console.error("");
    process.exit(1);
  }
  console.log(`  write guard: passed — target is staging (${verdict.ref}).`);
  return verdict.origin;
}

/* ==========================================================================
 * PRODUCTION WRITES (M-04, 2026-11-09)
 *
 * One rule for every tool that can write to production, in this one module —
 * no copies, no parallel mechanism:
 *
 *   1. explicit choice      `--env production`            (chooseEnvironment)
 *   2. intent               `--apply`
 *   3. confirmation         `--confirm-production=<id>`   (the id written out)
 *   4. pinned identity      the target IS the pinned production project
 *   5. both env files       URL and key equal `.env.local`, and NOT `.env.staging`
 *   6. right before the first write: the full project id typed at a terminal.
 *      No terminal → refused (fail-closed). No environment variable can stand
 *      in for it.
 *
 * Steps 1–5 run before any client exists (`requireProductionWrite`); step 6
 * runs once the plan is known, immediately before writing
 * (`confirmProductionWrite`). Nothing here prints a key, a password or a URL
 * beyond the project id.
 * ======================================================================== */

export type ProductionRefusal =
  | "no_target_url" | "pinned_staging" | "not_pinned_production"
  | "no_production_reference" | "production_file_mismatch" | "production_key_mismatch"
  | "staging_file_names_target" | "staging_key_on_target";

export type ProductionVerdict =
  | { ok: true; origin: string; ref: string }
  | { ok: false; reason: ProductionRefusal; message: string };

/**
 * Is the target production — by the pinned id AND by both env files? Pure.
 *
 * The last two checks are the ones that catch "a coherent production
 * URL/key pair on a staging path": if `.env.staging` carries the production
 * project or its key, the configuration is wrong, whichever way round it is
 * used, and nothing may run on it.
 */
export function checkProductionTarget(
  target: Target, reference: Reference, pins: PinnedRefs = PINNED_REFS,
): ProductionVerdict {
  const origin = projectOrigin(target.url);
  const ref = projectRef(target.url);
  if (origin === null || ref === null) {
    return { ok: false, reason: "no_target_url", message: "no NEXT_PUBLIC_SUPABASE_URL is set, so the target cannot be identified." };
  }
  if (ref === pins.staging) {
    return { ok: false, reason: "pinned_staging", message: `the target project ${ref} is STAGING, not production.` };
  }
  if (ref !== pins.production) {
    return { ok: false, reason: "not_pinned_production",
      message: `the target project ${ref} is not the pinned production project ${pins.production}.` };
  }
  const prodOrigin = projectOrigin(reference.production.NEXT_PUBLIC_SUPABASE_URL);
  const prodKey = reference.production.SUPABASE_SERVICE_ROLE_KEY;
  if (prodOrigin === null || typeof prodKey !== "string" || prodKey === "") {
    return { ok: false, reason: "no_production_reference",
      message: `${PRODUCTION_ENV_FILE} does not name a project and a service-role key.` };
  }
  if (prodOrigin !== origin) {
    return { ok: false, reason: "production_file_mismatch",
      message: `${PRODUCTION_ENV_FILE} names a different project than the target ${ref}.` };
  }
  if (target.serviceRoleKey !== prodKey) {
    return { ok: false, reason: "production_key_mismatch",
      message: `the SUPABASE_SERVICE_ROLE_KEY in use is not the one in ${PRODUCTION_ENV_FILE}.` };
  }
  if (projectOrigin(reference.staging.NEXT_PUBLIC_SUPABASE_URL) === origin) {
    return { ok: false, reason: "staging_file_names_target",
      message: `${STAGING_ENV_FILE} names the production project — the configuration is crossed.` };
  }
  const stagingKey = reference.staging.SUPABASE_SERVICE_ROLE_KEY;
  if (typeof stagingKey === "string" && stagingKey !== "" && stagingKey === target.serviceRoleKey) {
    return { ok: false, reason: "staging_key_on_target",
      message: `${STAGING_ENV_FILE} carries the key in use — the configuration is crossed.` };
  }
  return { ok: true, origin, ref };
}

export type IntentVerdict = { ok: true } | { ok: false; message: string };

/** Steps 1–3: `--env production`, `--apply`, `--confirm-production=<id>`. Pure. */
export function checkProductionWriteIntent(argv: readonly string[]): IntentVerdict {
  const choice = chooseEnvironment(argv);
  if (!choice.ok) return { ok: false, message: choice.message };
  if (choice.environment !== "production") {
    return { ok: false, message: `${ENVIRONMENT_FLAG} ${choice.environment} is not a production write.` };
  }
  if (!argv.includes("--apply")) return { ok: false, message: "a production write needs --apply." };
  const confirmations = argv.filter((a) => a === PRODUCTION_CONFIRMATION || a.startsWith(`${PRODUCTION_CONFIRMATION}=`));
  if (confirmations.length !== 1 || confirmations[0] !== productionConfirmation()) {
    return { ok: false, message: `a production write needs exactly ${productionConfirmation()}.` };
  }
  return { ok: true };
}

function refuseProduction(toolLabel: string, message: string): never {
  console.error("");
  console.error("  PRODUCTION WRITE GUARD — refusing to run.");
  console.error("");
  console.error(`  ${toolLabel}: ${message}`);
  console.error("");
  console.error("  Nothing has been read and nothing has been written.");
  console.error("");
  process.exit(1);
}

/** Production, read-only: pinned id and both env files. Alias kept for clarity. */
export function requireProductionRead(toolLabel: string): string {
  return requireProduction(toolLabel);
}

/** Steps 1–5. Call before the client is built. Exits on any refusal. */
export function requireProductionWrite(toolLabel: string, argv: readonly string[] = process.argv.slice(2)): string {
  const intent = checkProductionWriteIntent(argv);
  if (!intent.ok) refuseProduction(toolLabel, intent.message);
  const verdict = checkProductionTarget(
    { url: process.env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY },
    referenceFromDisk(),
  );
  if (!verdict.ok) refuseProduction(toolLabel, verdict.message);
  console.log(`  production write guard: target is production (${verdict.ref}); `
    + "the project id will be asked for right before the first write.");
  return verdict.origin;
}

/** Step 6, as a pure decision: a terminal, and exactly the project id. */
export function decideConfirmation(isTTY: boolean, answer: string | null, pins: PinnedRefs = PINNED_REFS): IntentVerdict {
  if (!isTTY) return { ok: false, message: "not an interactive terminal — a production write is never confirmed non-interactively." };
  if (answer === null) return { ok: false, message: "no answer was given." };
  if (answer.trim() !== pins.production) return { ok: false, message: "the project id typed does not match." };
  return { ok: true };
}

/**
 * Step 6: immediately before the first write. Shows what is about to happen
 * and asks for the full project id at the terminal. Exits on anything else.
 */
export async function confirmProductionWrite(toolLabel: string, summary: string): Promise<void> {
  const tty = Boolean(process.stdin.isTTY);
  let answer: string | null = null;
  if (tty) {
    const { createInterface } = await import("node:readline/promises");
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    process.stderr.write(`\n  ${toolLabel} is about to WRITE to PRODUCTION (${PINNED_REFS.production}).\n  ${summary}\n`);
    try {
      answer = await rl.question("  Type the full project id to continue: ");
    } catch {
      answer = null;   // Ctrl+D / Ctrl+C at the prompt: not confirmed
    } finally {
      rl.close();
    }
  }
  const decision = decideConfirmation(tty, answer);
  if (!decision.ok) {
    console.error("");
    console.error("  PRODUCTION WRITE NOT CONFIRMED — nothing has been written.");
    console.error(`  ${toolLabel}: ${decision.message}`);
    console.error("");
    process.exit(1);
  }
  console.log("  production write confirmed.");
}

/**
 * The one entry point for tools that serve BOTH environments (M-04).
 *
 *   --apply --env production --confirm-production=<id>  → production write (steps 1–5 now, 6 later)
 *   --apply  [--env staging]                            → pinned staging write
 *   no --apply, --env production                        → production READ (pinned)
 *   no --apply, otherwise                               → pinned staging read; a production
 *                                                         target without --env production is refused
 *
 * A coherent production pair on a staging path therefore never runs: the
 * staging checks refuse the production id outright.
 */
export function guardWriteTool(
  toolLabel: string, argv: readonly string[], options: { apply: boolean },
): "staging" | "production" {
  const values: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === ENVIRONMENT_FLAG) values.push(argv[i + 1] ?? "");
    else if (argv[i].startsWith(`${ENVIRONMENT_FLAG}=`)) values.push(argv[i].slice(ENVIRONMENT_FLAG.length + 1));
  }
  if (values.length > 1) refuseProduction(toolLabel, `${ENVIRONMENT_FLAG} was given ${values.length} times. One run, one environment.`);
  const environment = values.length === 1 ? values[0].trim().toLowerCase() : null;
  if (environment !== null && environment !== "staging" && environment !== "production") {
    refuseProduction(toolLabel, `${ENVIRONMENT_FLAG} ${JSON.stringify(values[0])} is not an environment.`);
  }
  if (options.apply) {
    if (environment === "production") { requireProductionWrite(toolLabel, argv); return "production"; }
    requirePinnedStagingWrite(toolLabel);
    return "staging";
  }
  if (environment === "production") { requireProductionRead(toolLabel); return "production"; }
  if (projectRef(process.env.NEXT_PUBLIC_SUPABASE_URL) === PINNED_REFS.production) {
    refuseProduction(toolLabel, `the target is production; a production run must say so: ${ENVIRONMENT_FLAG} production.`);
  }
  requirePinnedStagingWrite(toolLabel);
  return "staging";
}

/**
 * For tools that read BOTH env files themselves (catalog sync/publish/finish,
 * storage transfer, transfer to production, collision report): the file must
 * name exactly the pinned project — exact project id, not a substring — and
 * the two files must not name the same project or carry the same key.
 * Returns URL and key for `createClient`; prints only the id.
 */
export function pinnedEnvFile(environment: "staging" | "production"): { url: string; key: string; ref: string } {
  const file = environment === "staging" ? STAGING_ENV_FILE : PRODUCTION_ENV_FILE;
  const other = environment === "staging" ? PRODUCTION_ENV_FILE : STAGING_ENV_FILE;
  const want = environment === "staging" ? PINNED_REFS.staging : PINNED_REFS.production;
  const env = readEnvFile(file);
  const otherEnv = readEnvFile(other);
  const ref = projectRef(env.NEXT_PUBLIC_SUPABASE_URL);
  const fail = (why: string): never => {
    console.error(`\n  RIEGEL 1 — Abbruch. ${why}\n`);
    process.exit(1);
  };
  if (ref !== want) fail(`${file} nennt nicht ${want} (${environment}), sondern ${ref ?? "kein Projekt"}.`);
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (key === "") fail(`${file} traegt keinen SUPABASE_SERVICE_ROLE_KEY.`);
  if (projectOrigin(otherEnv.NEXT_PUBLIC_SUPABASE_URL) === projectOrigin(env.NEXT_PUBLIC_SUPABASE_URL)) {
    fail(`${file} und ${other} nennen dasselbe Projekt.`);
  }
  if ((otherEnv.SUPABASE_SERVICE_ROLE_KEY ?? "") === key) fail(`${file} und ${other} tragen denselben Schluessel.`);
  return { url: env.NEXT_PUBLIC_SUPABASE_URL, key, ref: want };
}
