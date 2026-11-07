/**
 * The run files of the 0180 probe (`tools/build-recon-probe.mts --run-file`):
 * the committed probe comes back character for character, one line names the
 * operator, and the tool signs in only to learn that id — it calls nothing,
 * reads nothing and prints no credential, token or full id.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isOperatorId, namingLine, PRECHECK_FILE, PROBE_FILE, readRunFile, RUN_DIR, RUN_FILE, runFile, sha256, shortId,
} from "@/../tools/build-recon-probe.mts";

const TOOL = readFileSync("tools/build-recon-probe.mts", "utf8");
const PROBE = readFileSync(PROBE_FILE, "utf8");
const ID = "3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b";
/** The network part: from the run-file section to the end. */
const ONLINE = TOOL.slice(TOOL.indexOf("async function operatorId()"));

describe("the run file", () => {
  it("is the committed probe plus one naming line right after begin;", () => {
    const run = runFile(PROBE, ID);
    const back = readRunFile(run);
    expect(back.probe).toBe(PROBE);
    expect(sha256(back.probe)).toBe(sha256(PROBE));
    expect(back.id).toBe(ID);
    expect(run.split(namingLine(ID))).toHaveLength(2);
    expect(run).toContain(`\nbegin;\n${namingLine(ID)}\n`);
    expect(run.split("set_config('skyisles.probe_operator'")).toHaveLength(2);
    // Nothing else of its own: without the line, the run file ends in the probe, whole.
    expect(run.replace(`${namingLine(ID)}\n`, "").endsWith(PROBE)).toBe(true);
    expect(run.replace(`${namingLine(ID)}\n`, "").indexOf(PROBE)).toBe(run.indexOf("-- >>> EINGEBETTET") + `-- >>> EINGEBETTET: ${PROBE_FILE}\n`.length);
  });

  it("refuses an id that is not one, and a run file that was changed", () => {
    for (const bad of ["", "x", ID.toUpperCase(), `${ID} `, "00000000-0000-0000-0000-000000000000", `${ID}'; drop table x; --`]) {
      expect(isOperatorId(bad), bad).toBe(false);
      expect(() => runFile(PROBE, bad), bad).toThrow();
    }
    const run = runFile(PROBE, ID);
    expect(() => readRunFile(run.replace("rollback;", "commit;"))).not.toThrow(); // the probe text differs …
    expect(readRunFile(run.replace("rollback;", "commit;")).probe).not.toBe(PROBE); // … and is caught here
    expect(() => readRunFile(run + namingLine(ID) + "\n")).toThrow();
    expect(() => readRunFile(run.replace(`${namingLine(ID)}\n`, ""))).toThrow();
  });

  it("goes only into the ignored log directory", () => {
    expect(RUN_DIR).toBe("supabase/log/staging");
    expect(RUN_FILE.startsWith(`${RUN_DIR}/`)).toBe(true);
    expect(PRECHECK_FILE.startsWith(`${RUN_DIR}/`)).toBe(true);
    expect(readFileSync(".gitignore", "utf8").split("\n")).toContain("supabase/log/");
    expect([...TOOL.matchAll(/writeFileSync\((\w+)/g)].map((m) => m[1]).sort()).toEqual(["PRECHECK_FILE", "PROBE_FILE", "RUN_FILE"]);
  });

  it("shows the id only shortened", () => {
    expect(shortId(ID)).toBe("3f2a…");
  });
});

describe("the tool signs in to learn the id — and does nothing else on Staging", () => {
  it("checks Staging and drops the service role before any client, checks the probe before signing in", () => {
    const write = TOOL.slice(TOOL.indexOf("async function writeRunFiles()"));
    expect(write.indexOf('requireStaging("probe:recon-0180")')).toBeGreaterThan(-1);
    expect(write.indexOf("requireStaging(")).toBeLessThan(write.indexOf("delete process.env.SUPABASE_SERVICE_ROLE_KEY"));
    expect(write.indexOf("delete process.env.SUPABASE_SERVICE_ROLE_KEY")).toBeLessThan(write.indexOf("verifiedProbe()"));
    expect(write.indexOf("verifiedProbe()")).toBeLessThan(write.indexOf("await operatorId()"));
    expect(TOOL.match(/createClient\(/g)).toHaveLength(1);
    expect(ONLINE).toContain("createClient(url, anon,");
    expect(TOOL).not.toMatch(/SERVICE_ROLE_KEY\s*[),]/);
  });

  it("calls no function, reads no table, uses no storage and no admin API", () => {
    for (const word of [".rpc(", ".from(", ".storage", "auth.admin", "getUser(", "updateUser(", "fetch("]) {
      expect(TOOL, word).not.toContain(word);
    }
    expect(ONLINE.match(/client\.auth\.\w+/g)).toEqual(["client.auth.signInWithPassword", "client.auth.signOut"]);
  });

  it("signs out in a finally, this session only, and keeps nothing but the user id", () => {
    expect(ONLINE).toMatch(/finally \{\s+const out = await client\.auth\.signOut\(\{ scope: "local" \}\);/);
    expect(ONLINE).toContain("id = signIn.data.user?.id;");
    expect(ONLINE).not.toMatch(/signIn\.data\.session|access_token|refresh_token/);
    expect(ONLINE).toContain("persistSession: false, autoRefreshToken: false");
  });

  it("prints no credential, no token, no error text of the server and no full id", () => {
    // What is printed: the argument of every console call and every thrown Error.
    const printed = [...ONLINE.matchAll(/(?:console\.(?:log|error)|new Error)\((`[^`]*`|"[^"]*")/g)].map((m) => m[1]);
    expect(printed.length).toBeGreaterThan(8);
    for (const text of printed) {
      expect(text, text).not.toMatch(/\$\{(email|password|signIn|out|id|url|anon)\b|session|token|\.error\.message/i);
    }
    expect(ONLINE).toContain("shortId(id)");
  });

  it("names no Production project", () => {
    expect(TOOL).not.toContain("zmiwxswrpkmizvqsgype");
    expect(TOOL).not.toContain(".env.local");
  });

  it("is reachable only through the staging npm script", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["probe:recon-0180:staging"]).toBe(
      "SKYISLES_REQUIRE_STAGING=1 node --env-file=.env.staging tools/build-recon-probe.mts --run-file");
  });
});
