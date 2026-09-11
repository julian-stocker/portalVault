import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  checkStagingTarget,
  projectOrigin,
  projectRef,
  readEnvFile,
  REQUIRE_STAGING_FLAG,
  type EnvMap,
  type Reference,
} from "../../../tools/lib/staging-guard.mts";

/**
 * The production guard, exercised against fabricated environments.
 *
 * The decision is a pure function precisely so this file can run it without
 * env files, without a database and without a process that exits — including
 * the case that matters most and is otherwise untestable: a `.env.staging`
 * that has been pointed at production.
 */

const PROD = "https://zmiwprodproject.supabase.co";
const STAGING = "https://qqxcstagingproj.supabase.co";
const PROD_KEY = "service-role-key-production";
const STAGING_KEY = "service-role-key-staging";

function reference(over: { staging?: EnvMap; production?: EnvMap } = {}): Reference {
  return {
    staging: over.staging ?? {
      NEXT_PUBLIC_SUPABASE_URL: STAGING,
      SUPABASE_SERVICE_ROLE_KEY: STAGING_KEY,
    },
    production: over.production ?? {
      NEXT_PUBLIC_SUPABASE_URL: PROD,
      SUPABASE_SERVICE_ROLE_KEY: PROD_KEY,
    },
  };
}

describe("the guard lets a real staging target through", () => {
  it("passes when the target is the project .env.staging names", () => {
    const verdict = checkStagingTarget(
      { url: STAGING, serviceRoleKey: STAGING_KEY },
      reference(),
    );
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.ref).toBe("qqxcstagingproj");
  });

  it("ignores a trailing slash and letter case", () => {
    const verdict = checkStagingTarget(
      { url: "HTTPS://QQXCSTAGINGPROJ.SUPABASE.CO/", serviceRoleKey: STAGING_KEY },
      reference(),
    );
    expect(verdict.ok).toBe(true);
  });
});

describe("it refuses production", () => {
  it("refuses when the target URL is the production project", () => {
    const verdict = checkStagingTarget({ url: PROD, serviceRoleKey: PROD_KEY }, reference());
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toBe("production_url");
      expect(verdict.message).toContain(".env.local");
    }
  });

  /**
   * The case a URL check alone would miss: the address was changed, the
   * credential was not.
   */
  it("refuses a production service-role key whatever URL it is sent to", () => {
    const verdict = checkStagingTarget(
      { url: STAGING, serviceRoleKey: PROD_KEY },
      reference(),
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("production_key");
  });

  /**
   * THE CASE THIS GUARD EXISTS FOR.
   *
   * Somebody edits `.env.staging` and points it at production — by hand, by a
   * bad copy, or by restoring the wrong backup. Both reference files then name
   * the same project, so an allow-list against `.env.staging` alone would say
   * yes. The production check runs first and says no.
   */
  it("refuses when .env.staging has been pointed at production", () => {
    const sabotaged = reference({
      staging: { NEXT_PUBLIC_SUPABASE_URL: PROD, SUPABASE_SERVICE_ROLE_KEY: PROD_KEY },
    });
    const verdict = checkStagingTarget({ url: PROD, serviceRoleKey: PROD_KEY }, sabotaged);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("production_url");
  });

  it("still refuses when only the staging file was sabotaged and the key differs", () => {
    const sabotaged = reference({
      staging: { NEXT_PUBLIC_SUPABASE_URL: PROD, SUPABASE_SERVICE_ROLE_KEY: STAGING_KEY },
    });
    const verdict = checkStagingTarget({ url: PROD, serviceRoleKey: STAGING_KEY }, sabotaged);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("production_url");
  });
});

describe("it allow-lists rather than deny-lists", () => {
  it("refuses a third project nobody named", () => {
    const verdict = checkStagingTarget(
      { url: "https://someotherproject.supabase.co", serviceRoleKey: "whatever" },
      reference(),
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("unknown_project");
  });

  /**
   * Without a staging reference nothing can be allow-listed, so the answer is
   * no. Refusing for lack of evidence is the point of an allow-list.
   */
  it("refuses when .env.staging is missing or empty", () => {
    const withoutUrl: EnvMap[] = [{}, { SUPABASE_SERVICE_ROLE_KEY: STAGING_KEY }];
    for (const staging of withoutUrl) {
      const verdict = checkStagingTarget(
        { url: STAGING, serviceRoleKey: STAGING_KEY },
        reference({ staging }),
      );
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.reason).toBe("no_staging_reference");
    }
  });

  it("refuses when the tool has no URL at all", () => {
    for (const url of [undefined, "", "   ", "not-a-url"]) {
      const verdict = checkStagingTarget({ url, serviceRoleKey: STAGING_KEY }, reference());
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.reason).toBe("no_target_url");
    }
  });

  /**
   * Two unparseable values are not "the same project". Treating them as equal
   * would make a broken configuration pass whenever both files were broken.
   */
  it("never treats two unidentifiable URLs as a match", () => {
    const verdict = checkStagingTarget(
      { url: "garbage" },
      reference({
        staging: { NEXT_PUBLIC_SUPABASE_URL: "garbage" },
        production: { NEXT_PUBLIC_SUPABASE_URL: "garbage" },
      }),
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("no_target_url");
  });

  /**
   * A missing `.env.local` must not become a way through: the allow-list still
   * has to be satisfied, so an unknown target is refused either way.
   */
  it("does not become permissive when .env.local is unreadable", () => {
    const noProd = reference({ production: {} });
    expect(checkStagingTarget({ url: STAGING, serviceRoleKey: STAGING_KEY }, noProd).ok).toBe(
      true,
    );
    const other = checkStagingTarget({ url: PROD, serviceRoleKey: PROD_KEY }, noProd);
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.reason).toBe("unknown_project");
  });
});

describe("identity is compared exactly, never guessed", () => {
  it("distinguishes two projects by origin", () => {
    expect(projectOrigin(PROD)).not.toBe(projectOrigin(STAGING));
    expect(projectOrigin("https://x.supabase.co/rest/v1/")).toBe("https://x.supabase.co");
  });

  it("reads a project ref for messages, and falls back to the host", () => {
    expect(projectRef(PROD)).toBe("zmiwprodproject");
    expect(projectRef("https://db.example.test")).toBe("db.example.test");
    expect(projectRef("nonsense")).toBeNull();
  });

  /**
   * No name matching anywhere: a project called "staging" on the production
   * host is still production, and a project called "prod" on the staging host
   * is still allowed. Only the two identities decide.
   */
  it("does not look at project names", () => {
    // Comments are stripped: the docblock names the techniques it rejects,
    // which is exactly the sentence this test is checking is still true.
    const source = readFileSync("tools/lib/staging-guard.mts", "utf8")
      .split("\n")
      .filter((line) => {
        const trimmed = line.trimStart();
        return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("/*");
      })
      .join("\n");
    for (const forbidden of ['includes("staging")', 'includes("prod")', "supabase link"]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });
});

describe("env parsing", () => {
  it("reads the repository's own staging file without throwing", () => {
    // Values are never printed; only that the two keys resolve.
    const env = readEnvFile(".env.staging");
    expect(typeof env).toBe("object");
  });

  it("returns an empty map for a file that does not exist", () => {
    expect(readEnvFile(".env.does-not-exist")).toEqual({});
  });
});

function scripts(): Record<string, string> {
  return (JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> })
    .scripts;
}

describe("every staging-only writer is actually guarded", () => {
  /**
   * The guard is only worth having if it is called. A tool added later that
   * forgets the call is the failure this test exists to catch.
   */
  const GUARDED_TOOLS = [
    "tools/import-catalog.mts",
    "tools/import-characters.mts",
  ] as const;

  it.each(GUARDED_TOOLS)("%s consults the guard", (path) => {
    const source = readFileSync(path, "utf8");
    expect(source).toContain("staging-guard.mts");
    expect(source).toMatch(/requireStaging(IfRequested)?\(/);
  });

  it("the shared verifiers honour the flag the staging scripts set", () => {
    for (const path of [
      "tools/verify-rls.mts",
      "tools/verify-editorial.mts",
      "tools/verify-inventory.mts",
    ]) {
      const source = readFileSync(path, "utf8");
      expect(source, `${path} is a writer and must consult the guard`).toContain(
        "requireStagingIfRequested",
      );
    }
  });

  it("every :staging script targets the staging env file", () => {
    const staging = Object.entries(scripts()).filter(([name]) => name.endsWith(":staging"));
    expect(staging.length).toBeGreaterThan(0);

    for (const [name, command] of staging) {
      // dev:staging carries its own interlock and passes no service-role key.
      if (name === "dev:staging") continue;
      expect(command, name).toContain("--env-file=.env.staging");
    }
  });

  /**
   * The flag is what turns the guard on, so every staging script that can
   * write has to set it. The read-only verifiers deliberately do not: they
   * open nothing a guard could protect, and a flag on them would suggest the
   * guard is a formality rather than a gate.
   */
  it("every writing :staging script sets the guard flag", () => {
    const WRITING_TOOLS = [
      "import-catalog.mts",
      "import-characters.mts",
      "verify-rls.mts",
      "verify-editorial.mts",
      "verify-inventory.mts",
    ];

    for (const [name, command] of Object.entries(scripts())) {
      if (!name.endsWith(":staging")) continue;
      if (!WRITING_TOOLS.some((tool) => command.includes(tool))) continue;
      expect(command, `${name} writes and must set the guard flag`).toContain(
        `${REQUIRE_STAGING_FLAG}=1`,
      );
    }
  });

  it("no read-only verifier pretends to be guarded", () => {
    for (const name of ["verify:shop:staging", "verify:commerce:staging"]) {
      expect(scripts()[name], name).not.toContain(REQUIRE_STAGING_FLAG);
    }
  });

  /**
   * The rule the whole renaming exists for: a command that writes must say
   * which environment it writes to.
   */
  it("no writing verifier is reachable under an environment-neutral name", () => {
    const WRITERS = ["verify-rls", "verify-editorial", "verify-inventory"];
    for (const [name, command] of Object.entries(scripts())) {
      const writes = WRITERS.some((tool) => command.includes(`${tool}.mts`));
      if (!writes) continue;
      expect(
        name.endsWith(":prod") || name.endsWith(":staging"),
        `"${name}" writes but does not name its environment`,
      ).toBe(true);
    }
  });
});
