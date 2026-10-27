import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The two-environment strategy, and the LAN mode of the second one
 * (ADR-0149).
 *
 * SkyIsles has exactly two environments: production on Vercel from `main`
 * against the production Supabase project, and development/staging as a local
 * `next dev` on the operator's Mac against the staging project. There is no
 * Vercel staging project and no preview infrastructure, so `dev:staging` IS
 * the second environment — and `dev:staging:lan` is how a phone reaches it.
 *
 * WHAT THESE TESTS GUARD. Not the output, which the operator reads anyway,
 * but the four things that would quietly stop being true:
 *
 *   1. both modes read the same env file and pass the same guard
 *   2. the non-LAN mode is bound to localhost EXPLICITLY — `next dev`
 *      defaults to `0.0.0.0` in this version, so silence means exposure
 *   3. no address is written down anywhere; they are computed at every start
 *   4. production's configuration is untouched by any of it
 */

const SCRIPT = readFileSync("tools/dev-staging.mts", "utf8");
const CONFIG = readFileSync("next.config.ts", "utf8");
const scripts = (): Record<string, string> =>
  JSON.parse(readFileSync("package.json", "utf8")).scripts;

describe("two commands, one staging configuration", () => {
  it("both exist, and the LAN one is the same script with a flag", () => {
    expect(scripts()["dev:staging"]).toBe("node tools/dev-staging.mts");
    expect(scripts()["dev:staging:lan"]).toBe("node tools/dev-staging.mts --lan");
  });

  it("so there is one env file and one guard, not two of each", () => {
    /*
     * A second script file is how "same configuration, same guard" stops
     * being true. The flag keeps both modes on one code path.
     */
    expect(SCRIPT).toContain("staging-guard.mts");
    expect(SCRIPT).toContain("STAGING_ENV_FILE");
    expect(SCRIPT).toContain("checkStagingTarget(");
    expect(SCRIPT).toContain('const lan = process.argv.includes("--lan");');
    /* The guard is consulted before the mode is even looked at, so a
       production target refuses both commands equally. */
    expect(SCRIPT.indexOf("checkStagingTarget("))
      .toBeLessThan(SCRIPT.indexOf("const adressen ="));
  });

  it("and the service-role key is withheld in both", () => {
    /* Unchanged from the 2026-10-25 hardening, and it must stay that way:
       the sentinel and the sweep are not inside any `if (lan)`. */
    expect(SCRIPT).toContain("for (const name of NIEMALS_WEITERGEBEN) kindUmgebung[name] = ENTZOGEN;");
    expect(SCRIPT).toContain("Object.entries(kindUmgebung)");
    const hardening = SCRIPT.indexOf("NIEMALS_WEITERGEBEN) kindUmgebung");
    const lanBranch = SCRIPT.indexOf("if (lan) {");
    expect(hardening, "the hardening must not sit inside the LAN branch")
      .toBeLessThan(lanBranch);
  });
});

describe("the host is stated, never inherited", () => {
  it("localhost for the normal mode, every interface for the LAN one", () => {
    /*
     * `next dev` DEFAULTS to `0.0.0.0` in this Next version, so a command
     * that says nothing is on the network by accident. Both are explicit.
     */
    expect(SCRIPT).toContain('const host = lan ? "0.0.0.0" : "127.0.0.1";');
    expect(SCRIPT).toContain('spawn("npx", ["next", "dev", "--hostname", host]');
  });

  it("and the port comes from the environment, like Next's own default", () => {
    expect(SCRIPT).toContain('const port = process.env.PORT ?? "3000";');
  });

  it("signals reach the child, so no credentialed server is left behind", () => {
    expect(SCRIPT).toContain('for (const signal of ["SIGINT", "SIGTERM"] as const)');
    expect(SCRIPT).toContain("child.kill(signal)");
  });
});

describe("addresses are computed, never written down", () => {
  it("no home-network address is written down", () => {
    /*
     * The operator works at home and tethered to an iPhone, so the address
     * changes between sessions. A number in a file would be wrong half the
     * time and silently.
     */
    for (const [name, source] of [["script", SCRIPT], ["next.config.ts", CONFIG]] as const) {
      const home = source.match(/\b(?:10|192)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g) ?? [];
      expect(home, `${name} hard-codes ${home.join(", ")}`).toEqual([]);
    }
    expect(SCRIPT).toContain("networkInterfaces()");
    expect(CONFIG).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
  });

  it("and the one range that IS named is Apple's, named only as documentation", () => {
    /*
     * `172.20.10.0/28` is a FACT ABOUT IOS, not about this network: every
     * Personal Hotspot hands out that block, so it can be written down
     * without going stale. The detection itself still compares numbers, so
     * even this text is explanatory — remove it and nothing breaks.
     */
    const named = SCRIPT.match(/\b172\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g) ?? [];
    expect(new Set(named)).toEqual(new Set(["172.20.10.0"]));
    expect(SCRIPT).not.toMatch(/"172\.20\.10\.\d/);  // never a value, only prose
  });

  it("only the three private ranges count", () => {
    /* A public address would mean the machine is directly on the internet
       and must never be advertised as a test address; a 169.254 one means
       DHCP never answered. */
    expect(SCRIPT).toContain("a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)");
  });

  it("the iPhone hotspot is recognised by its fixed Apple range", () => {
    /*
     * A Personal Hotspot always hands out 172.20.10.0/28 — the phone is `.1`
     * and clients get `.2` to `.14`. Naming it lets the output say "you are
     * tethered" instead of leaving the operator to read a number.
     */
    expect(SCRIPT).toContain("const hotspot = a === 172 && b === 20 && c === 10;");
    expect(SCRIPT).toMatch(/hotspot \? "hotspot" : "lan"/);
    expect(SCRIPT).toContain("iPhone hotspot");
  });

  it("and it promises nothing about reaching back from the phone", () => {
    /*
     * iOS does not guarantee that a hotspot client can be reached from the
     * phone that is serving it. The command says so and offers steps rather
     * than claiming it works.
     */
    expect(SCRIPT).toContain("may or may not work");
    expect(SCRIPT).toContain("it is iOS and not this server");
  });

  it("no address found means no server, rather than a useless one", () => {
    expect(SCRIPT).toContain("No private network address found.");
    expect(SCRIPT).toContain("No server was started.");
  });

  it("the Bonjour name is built once, not twice", () => {
    /*
     * `os.hostname()` already answers `MacBook-Pro.local` on macOS, so
     * appending `.local` produced `MacBook-Pro.local.local`, which resolves
     * nowhere. Found by running the command, not by reading it.
     */
    expect(SCRIPT).toContain('name.endsWith(".local") ? name : `${name}.local`');
    expect(SCRIPT).not.toContain("${hostname()}.local");
  });
});

describe("Next's cross-origin dev block is answered, and only in dev", () => {
  it("the dev origins travel in an environment variable", () => {
    /*
     * Next blocks cross-origin requests to `/_next/*` and the HMR socket
     * from any origin the dev server was not started with — which is exactly
     * what a phone on the Wi-Fi is. `allowedDevOrigins` is the documented
     * answer; the value comes from the command, not from the config.
     */
    expect(SCRIPT).toContain("kindUmgebung.SKYISLES_DEV_ORIGINS = devOrigins.join(\",\")");
    expect(CONFIG).toContain("process.env.SKYISLES_DEV_ORIGINS");
    expect(CONFIG).toContain("allowedDevOrigins");
  });

  it("and the option is absent unless that variable is set", () => {
    /*
     * PRODUCTION IS UNTOUCHED, twice over: the option only has an effect in
     * `next dev`, and the variable is set by nothing but the LAN command — so
     * every build Vercel makes omits the key entirely.
     */
    expect(CONFIG).toContain("devOrigins.length > 0 ? { allowedDevOrigins: devOrigins } : {}");
    expect(scripts()["build"]).not.toContain("SKYISLES_DEV_ORIGINS");
    expect(scripts()["dev"]).not.toContain("SKYISLES_DEV_ORIGINS");
    for (const [name, command] of Object.entries(scripts())) {
      expect(command, `${name} sets dev origins`).not.toContain("SKYISLES_DEV_ORIGINS");
    }
  });

  it("the origins are the ways another device addresses this Mac, and no wildcard", () => {
    expect(SCRIPT).toContain("adressen.map((a) => a.address), hostname(), bonjourName()");
    expect(SCRIPT).not.toContain('"*"');
    expect(CONFIG).not.toContain("*.");
  });
});

describe("production's configuration is untouched", () => {
  it("the only production-facing thing in next.config.ts is the image header", () => {
    expect(CONFIG).toContain("/images/skylanders/:file*");
    expect(CONFIG).toContain("max-age=31536000, immutable");
    /* No redirect, no rewrite, no domain, no output mode arrived with this. */
    for (const forbidden of ["redirects", "rewrites", "basePath", "assetPrefix", "output"]) {
      expect(CONFIG, `next.config.ts gained ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("`npm run dev` and the build are unchanged", () => {
    expect(scripts()["dev"]).toBe("next dev");
    expect(scripts()["build"]).toBe("next build");
  });

  it("and the production env file is read only in order to refuse it", () => {
    /*
     * `.env.local` is production, and `next dev` loads it by itself — which
     * is the whole reason this command exists. The script reads the
     * production reference TWICE and both times to compare: once to check
     * the target URL, once to sweep the environment the child actually gets.
     * It never copies a production value into that environment.
     */
    expect(SCRIPT.match(/referenceFromDisk\(\)/g) ?? []).toHaveLength(2);
    expect(SCRIPT).toContain("checkStagingTarget({ url, serviceRoleKey: undefined }, referenceFromDisk())");
    expect(SCRIPT).toContain("projectRef(referenceFromDisk().production.NEXT_PUBLIC_SUPABASE_URL)");
    expect(SCRIPT).not.toMatch(/kindUmgebung\[[^\]]*\]\s*=[^;]*referenceFromDisk/);
    /* And the child's own values come from the staging file, nothing else. */
    expect(SCRIPT).toContain("STAGING_ENV_FILE");
    expect(SCRIPT).not.toMatch(/loadEnv\(\s*"\.env\.local"/);
  });
});
