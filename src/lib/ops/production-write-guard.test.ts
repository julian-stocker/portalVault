/**
 * M-04 (2026-11-09) — the production write guard and its coverage.
 *
 * Three layers, all offline:
 *   1. the pure decisions (`checkProductionTarget`, `checkProductionWriteIntent`,
 *      `decideConfirmation`) for every refusal;
 *   2. real tools started as processes in a temporary directory with
 *      fabricated env files; `fetch` is replaced before the tool loads, and
 *      any attempt is announced on stderr — a refused run must show none;
 *   3. the typed confirmation through a real pseudo-terminal (Python `pty`),
 *      plus the non-interactive fail-closed case;
 *   4. a coverage guard over `tools/` and `package.json`.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  checkProductionTarget, checkProductionWriteIntent, decideConfirmation, PINNED_REFS,
  productionConfirmation, type EnvMap, type Reference,
} from "../../../tools/lib/staging-guard.mts";

const P_REF = PINNED_REFS.production;
const S_REF = PINNED_REFS.staging;
const url = (ref: string) => `https://${ref}.supabase.co`;
const PROD = url(P_REF);
const STAGING = url(S_REF);
const THIRD = url("abcdefghunknownproj");
const P_KEY = "service-role-production";
const S_KEY = "service-role-staging";
const env = (u: string, k: string): EnvMap => ({ NEXT_PUBLIC_SUPABASE_URL: u, SUPABASE_SERVICE_ROLE_KEY: k });
const ref = (over: Partial<Reference> = {}): Reference => ({ staging: env(STAGING, S_KEY), production: env(PROD, P_KEY), ...over });
const CONFIRM = `--confirm-production=${P_REF}`;

describe("checkProductionTarget — is it production, by the pinned id AND both env files?", () => {
  const reason = (v: ReturnType<typeof checkProductionTarget>) => (v.ok ? "ok" : v.reason);

  it("the pinned production project with matching .env.local passes", () => {
    expect(checkProductionTarget({ url: PROD, serviceRoleKey: P_KEY }, ref())).toEqual({ ok: true, origin: PROD, ref: P_REF });
    expect(checkProductionTarget({ url: `${PROD.toUpperCase()}/`, serviceRoleKey: P_KEY }, ref()).ok).toBe(true);
  });

  it.each([
    ["no URL", { url: undefined, serviceRoleKey: P_KEY }, ref(), "no_target_url"],
    ["unparseable URL", { url: "not a url", serviceRoleKey: P_KEY }, ref(), "no_target_url"],
    ["the staging project", { url: STAGING, serviceRoleKey: S_KEY }, ref(), "pinned_staging"],
    ["an unknown project", { url: THIRD, serviceRoleKey: "k" }, ref(), "not_pinned_production"],
    ["an unknown project even if .env.local names it", { url: THIRD, serviceRoleKey: "k" }, ref({ production: env(THIRD, "k") }), "not_pinned_production"],
    [".env.local missing", { url: PROD, serviceRoleKey: P_KEY }, ref({ production: {} }), "no_production_reference"],
    [".env.local names another project", { url: PROD, serviceRoleKey: P_KEY }, ref({ production: env(THIRD, P_KEY) }), "production_file_mismatch"],
    ["the key is not the one in .env.local", { url: PROD, serviceRoleKey: "other" }, ref(), "production_key_mismatch"],
    ["crossed: .env.staging names production", { url: PROD, serviceRoleKey: P_KEY }, ref({ staging: env(PROD, "x") }), "staging_file_names_target"],
    ["crossed: .env.staging carries the production key", { url: PROD, serviceRoleKey: P_KEY }, ref({ staging: env(STAGING, P_KEY) }), "staging_key_on_target"],
  ] as const)("refuses %s", (_name, target, reference, want) => {
    expect(reason(checkProductionTarget(target, reference))).toBe(want);
  });
});

describe("checkProductionWriteIntent — --env production, --apply, --confirm-production=<id>", () => {
  it("all three, exactly", () => {
    expect(checkProductionWriteIntent(["--env", "production", "--apply", CONFIRM])).toEqual({ ok: true });
    expect(checkProductionWriteIntent(["--env=production", CONFIRM, "--apply"])).toEqual({ ok: true });
  });
  it.each([
    ["nothing", []],
    ["no --env", ["--apply", CONFIRM]],
    ["--env staging", ["--env", "staging", "--apply", CONFIRM]],
    ["no --apply", ["--env", "production", CONFIRM]],
    ["no confirmation", ["--env", "production", "--apply"]],
    ["a bare --confirm-production", ["--env", "production", "--apply", "--confirm-production"]],
    ["a wrong id", ["--env", "production", "--apply", "--confirm-production=zmiwxswrpkmizvqsgyp"]],
    ["the staging id", ["--env", "production", "--apply", `--confirm-production=${S_REF}`]],
    ["two confirmations", ["--env", "production", "--apply", CONFIRM, "--confirm-production"]],
    ["two environments", ["--env", "production", "--env", "staging", "--apply", CONFIRM]],
  ] as const)("refuses %s", (_name, argv) => {
    expect(checkProductionWriteIntent(argv).ok).toBe(false);
  });
  it("the confirmation is the production id written out", () => {
    expect(productionConfirmation()).toBe("--confirm-production=zmiwxswrpkmizvqsgype");
  });
});

describe("decideConfirmation — a terminal and exactly the id", () => {
  it("accepts the id at a terminal, tolerating surrounding blanks", () => {
    expect(decideConfirmation(true, P_REF).ok).toBe(true);
    expect(decideConfirmation(true, ` ${P_REF} `).ok).toBe(true);
  });
  it("never without a terminal — not even with the right answer (no env variable can stand in)", () => {
    expect(decideConfirmation(false, P_REF).ok).toBe(false);
  });
  it.each([["", ""], ["y", "y"], ["yes", "yes"], ["staging id", S_REF], ["typo", "zmiwxswrpkmizvqsgyp"], ["prefix", "zmiw"]])(
    "refuses %s", (_n, answer) => { expect(decideConfirmation(true, answer).ok).toBe(false); });
  it("refuses an aborted prompt", () => { expect(decideConfirmation(true, null).ok).toBe(false); });
});

/* ------------------------------------------------------------------ processes */

const ROOT = resolve(".");
const OFFLINE = `data:text/javascript,${encodeURIComponent(
  "globalThis.fetch = () => { process.stderr.write('NETWORK ATTEMPT\\n'); return Promise.reject(new Error('offline test: no network')); };")}`;
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const file = (u: string, k: string) => `NEXT_PUBLIC_SUPABASE_URL=${u}\nSUPABASE_SERVICE_ROLE_KEY=${k}\nNEXT_PUBLIC_SUPABASE_ANON_KEY=anon\n`;
// The process environment a tool sees (what --env-file would load), incl. the public anon key.
const live = (u: string, k: string): EnvMap => ({ ...env(u, k), NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" });
const BOTH = { staging: file(STAGING, S_KEY), local: file(PROD, P_KEY) };

function run(tool: string, files: { staging?: string; local?: string }, target: EnvMap, args: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "m04-guard-"));
  dirs.push(dir);
  if (files.staging) writeFileSync(join(dir, ".env.staging"), files.staging);
  if (files.local) writeFileSync(join(dir, ".env.local"), files.local);
  const base: NodeJS.ProcessEnv = { ...process.env };
  for (const k of ["SKYISLES_REQUIRE_STAGING", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) delete base[k];
  const r = spawnSync(process.execPath, ["--import", OFFLINE, join(ROOT, "tools", tool), ...args], {
    cwd: dir, encoding: "utf8", timeout: 30_000, input: "",
    env: { ...base, ...target, SKYISLES_WORKBOOK: join(dir, "missing.xlsx") },
  });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
}
const refusedOffline = (r: ReturnType<typeof run>, marker: RegExp) => {
  expect(r.status, r.out).toBe(1);
  expect(r.out).toMatch(marker);
  expect(r.out, "no network before the guard decided").not.toContain("NETWORK ATTEMPT");
};
const GUARD = /WRITE GUARD — refusing|PRODUCTION WRITE GUARD — refusing|ENVIRONMENT GUARD — refusing|PRODUCTION GUARD — refusing/;

describe("grant-admin, started directly with node", () => {
  it("--apply against production without --env production: refused (staging path rejects the production id)", () => {
    refusedOffline(run("grant-admin.mts", BOTH, live(PROD, P_KEY), ["--email", "x@example.invalid", "--apply"]), GUARD);
  });
  it("--env production --apply without confirmation: refused", () => {
    refusedOffline(run("grant-admin.mts", BOTH, live(PROD, P_KEY), ["--env", "production", "--email", "x@example.invalid", "--apply"]), GUARD);
  });
  it("a bare --confirm-production: refused", () => {
    refusedOffline(run("grant-admin.mts", BOTH, live(PROD, P_KEY), ["--env", "production", "--email", "x@example.invalid", "--apply", "--confirm-production"]), GUARD);
  });
  it("a wrong project id: refused", () => {
    refusedOffline(run("grant-admin.mts", BOTH, live(PROD, P_KEY), ["--env", "production", "--email", "x@example.invalid", "--apply", "--confirm-production=zmiwxswrpkmizvqsgyp"]), GUARD);
  });
  it("crossed configuration (.env.staging names production): refused although every flag is right", () => {
    refusedOffline(run("grant-admin.mts", { staging: file(PROD, P_KEY), local: file(PROD, P_KEY) }, env(PROD, P_KEY),
      ["--env", "production", "--email", "x@example.invalid", "--apply", CONFIRM]), GUARD);
  });
  it(".env.local missing: refused", () => {
    refusedOffline(run("grant-admin.mts", { staging: file(STAGING, S_KEY) }, env(PROD, P_KEY),
      ["--env", "production", "--email", "x@example.invalid", "--apply", CONFIRM]), GUARD);
  });
  it("an unknown project with every flag: refused", () => {
    refusedOffline(run("grant-admin.mts", { staging: file(STAGING, S_KEY), local: file(THIRD, "k") }, live(THIRD, "k"),
      ["--env", "production", "--email", "x@example.invalid", "--apply", CONFIRM]), GUARD);
  });
  it("a preview against production without naming it: refused", () => {
    refusedOffline(run("grant-admin.mts", BOTH, live(PROD, P_KEY), ["--list"]), GUARD);
  });
  it("the legitimate production read (--env production --list) passes the guard and only then reaches the network", () => {
    const r = run("grant-admin.mts", BOTH, live(PROD, P_KEY), ["--env", "production", "--list"]);
    expect(r.out).toContain(`environment guard: passed — target is production (${P_REF})`);
    expect(r.out).toContain("NETWORK ATTEMPT");
  });
  it("the legitimate production write passes steps 1–5 (the typed id comes right before the write)", () => {
    const r = run("grant-admin.mts", BOTH, live(PROD, P_KEY), ["--env", "production", "--email", "x@example.invalid", "--apply", CONFIRM]);
    expect(r.out).toContain(`production write guard: target is production (${P_REF})`);
    expect(r.out).not.toMatch(GUARD);
  });
  it("a staging write passes the pinned staging guard", () => {
    const r = run("grant-admin.mts", BOTH, live(STAGING, S_KEY), ["--email", "x@example.invalid", "--apply"]);
    expect(r.out).toContain(`write guard: passed — target is staging (${S_REF})`);
  });
});

describe("historical import tools, started directly with node (their :prod scripts are gone)", () => {
  it.each(["reconcile-inventory.mts", "settle-legacy-sales.mts", "import-legacy-history.mts"])(
    "%s: a coherent production pair with --apply but no --env production is refused before any network", (tool) => {
      refusedOffline(run(tool, BOTH, live(PROD, P_KEY), ["--apply"]), GUARD);
    });
  it.each(["reconcile-inventory.mts", "settle-legacy-sales.mts", "import-legacy-history.mts"])(
    "%s: --env production --apply without the id-bearing confirmation is refused", (tool) => {
      refusedOffline(run(tool, BOTH, live(PROD, P_KEY), ["--env", "production", "--apply", "--confirm-production"]), GUARD);
    });
  it.each(["reconcile-inventory.mts", "settle-legacy-sales.mts", "import-legacy-history.mts"])(
    "%s: the full production rule passes the guard", (tool) => {
      const r = run(tool, BOTH, live(PROD, P_KEY), ["--env", "production", "--apply", CONFIRM]);
      expect(r.out).toContain(`production write guard: target is production (${P_REF})`);
    }, 30_000); // supabase-js retries the refused fetch (~7 s), all offline
  it.each(["reconcile-inventory.mts", "settle-legacy-sales.mts"])(
    "%s: a staging preview still works", (tool) => {
      const r = run(tool, BOTH, live(STAGING, S_KEY), []);
      expect(r.out).toContain(`write guard: passed — target is staging (${S_REF})`);
    }, 30_000);
});

describe("the writing verifiers have no production path at all", () => {
  it.each(["verify-rls.mts", "verify-editorial.mts", "verify-inventory.mts", "verify-calculations.mts"])(
    "%s against production is refused, whatever the flags", (tool) => {
      refusedOffline(run(tool, BOTH, live(PROD, P_KEY), ["--env", "production", "--apply", CONFIRM]), GUARD);
    });
  it("…and against pinned staging they pass the guard", () => {
    const r = run("verify-rls.mts", BOTH, live(STAGING, S_KEY), []);
    expect(r.out).toContain(`write guard: passed — target is staging (${S_REF})`);
  }, 30_000);
});

describe("the tools that read both env files themselves", () => {
  it("storage-transfer --ziel production --apply without the id-bearing confirmation: refused before any connection", () => {
    refusedOffline(run("storage-transfer.mts", BOTH, {}, ["--ziel", "production", "--apply"]), /RIEGEL 0b — Abbruch/);
  });
  it("storage-transfer with swapped env files: refused (exact pinned id, not a substring)", () => {
    refusedOffline(run("storage-transfer.mts", { staging: file(PROD, P_KEY), local: file(STAGING, S_KEY) }, {}, ["--ziel", "staging"]), /RIEGEL 1 — Abbruch/);
  });
  it("storage-transfer with an id merely contained in the URL: refused", () => {
    refusedOffline(run("storage-transfer.mts", { staging: file(`https://x${S_REF}.supabase.co`, S_KEY), local: file(PROD, P_KEY) }, {}, ["--ziel", "staging"]), /RIEGEL 1 — Abbruch/);
  });
  it("transfer-to-production with swapped env files: refused by the pinned ids", () => {
    refusedOffline(run("transfer-to-production.mts", { staging: file(PROD, P_KEY), local: file(STAGING, S_KEY) }, {}, []), /TRANSFER GUARD — refusing/);
  });
  it("transfer-to-production --apply with a bare confirmation: refused", () => {
    refusedOffline(run("transfer-to-production.mts", BOTH, {}, ["--apply", "--confirm-production"]), /TRANSFER GUARD — refusing/);
  });
  it("catalog-sync-apply --target=production --apply with a bare confirmation: refused", () => {
    refusedOffline(run("catalog-sync-apply.mts", BOTH, {}, ["--target=production", "--apply", "--confirm-production"]), /ABBRUCH/);
  });
});

/* ------------------------------------------ verify-commerce / verify-seller (M-04B) */

/*
 * A recording stand-in for the network: every request is announced on stderr
 * (method, path, which key) and answered "permission denied". So a run goes
 * through all its checks offline, and the test sees exactly which requests
 * the tool WOULD have sent — in particular, whether a write probe went out.
 */
const RECORDER = `data:text/javascript,${encodeURIComponent(`
globalThis.fetch = async (input, init = {}) => {
  const u = new URL(typeof input === "string" ? input : input.url);
  const key = new Headers(init.headers).get("apikey") ?? "-";
  process.stderr.write("REQ " + (init.method ?? "GET") + " " + u.pathname + " " + (key === "anon" ? "anon" : "service") + "\\n");
  // Reads answer with an empty result so a run continues; everything else is "denied".
  const read = (init.method ?? "GET") === "GET"
    || /\\/rpc\\/(seller_public|active_seller|shop_offers|seller_sale_state)$/.test(u.pathname);
  return read
    ? new Response("[]", { status: 200, headers: { "content-type": "application/json" } })
    : new Response(JSON.stringify({ code: "42501", message: "permission denied" }),
        { status: 401, headers: { "content-type": "application/json" } });
};`)}`;
function record(tool: string, files: { staging?: string; local?: string }, target: EnvMap, args: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "m04b-"));
  dirs.push(dir);
  if (files.staging) writeFileSync(join(dir, ".env.staging"), files.staging);
  if (files.local) writeFileSync(join(dir, ".env.local"), files.local);
  const base: NodeJS.ProcessEnv = { ...process.env };
  for (const k of ["SKYISLES_REQUIRE_STAGING", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) delete base[k];
  const r = spawnSync(process.execPath, ["--import", RECORDER, join(ROOT, "tools", tool), ...args],
    { cwd: dir, encoding: "utf8", timeout: 60_000, input: "", env: { ...base, ...target } });
  const requests = r.stderr.split("\n").filter((l) => l.startsWith("REQ ")).map((l) => l.slice(4));
  return { status: r.status, out: `${r.stdout}\n${r.stderr}`, requests };
}
/* The anonymous write probes, as requests: a POST to a table, or one of these functions. */
const WRITE_RPCS = ["reserve_for_order", "release_order_reservations", "convert_order_reservations", "reservation_ttl",
  "next_order_number", "enforce_checkout_limits", "request_client_hash", "release_expired_reservations",
  "seller_create_catalog_item", "seller_import_catalog"];
const writeProbes = (requests: string[]) => requests.filter((q) => {
  const [method, path, key] = q.split(" ");
  if (key !== "anon" || method !== "POST") return false;
  const rpc = /^\/rest\/v1\/rpc\/(.+)$/.exec(path);
  return rpc ? WRITE_RPCS.includes(rpc[1]) : path.startsWith("/rest/v1/");
});

describe.each(["verify-commerce.mts", "verify-seller.mts"])("%s (M-04B): write probes on staging only", (tool) => {
  it("production without --env production: refused before any request", () => {
    const r = record(tool, BOTH, live(PROD, P_KEY), []);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toMatch(GUARD);
    expect(r.requests).toEqual([]);
  });
  it("a production pair on the staging path (.env.staging names production): refused before any request", () => {
    const r = record(tool, { staging: file(PROD, P_KEY), local: file(PROD, P_KEY) }, live(PROD, P_KEY), []);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toMatch(GUARD);
    expect(r.requests).toEqual([]);
  });
  it("an unknown project: refused before any request", () => {
    const r = record(tool, BOTH, live(THIRD, "k"), []);
    expect(r.status, r.out).toBe(1);
    expect(r.requests).toEqual([]);
  });
  it("--env production with a key that is not .env.local's: refused before any request", () => {
    const r = record(tool, BOTH, live(PROD, "some-other-key"), ["--env", "production"]);
    expect(r.status, r.out).toBe(1);
    expect(r.requests).toEqual([]);
  });
  it("--env production: the read checks run, NOT ONE write probe is sent, and the skips are reported", () => {
    const r = record(tool, BOTH, live(PROD, P_KEY), ["--env", "production"]);
    expect(r.out).toContain(`environment guard: passed — target is production (${P_REF})`);
    expect(r.requests.length, r.out).toBeGreaterThan(0);
    expect(writeProbes(r.requests), r.requests.join("\n")).toEqual([]);
    expect(r.out).toContain("write probe, staging only (M-04B)");
  }, 60_000);
  it("pinned staging: the write probes are still sent (the staging checks are unchanged)", () => {
    const r = record(tool, BOTH, live(STAGING, S_KEY), []);
    expect(r.out).toContain(`write guard: passed — target is staging (${S_REF})`);
    expect(writeProbes(r.requests).length, r.requests.join("\n")).toBeGreaterThan(0);
    expect(r.out).not.toContain("write probe, staging only (M-04B)");
  }, 60_000);
});

describe("read tools without an optional flag (M-04B)", () => {
  it.each(["perf-report.mts", "verify-legacy-history.mts", "sync-legacy-orderbook.mts"])(
    "%s: a production pair on the staging path is refused before any request", (tool) => {
      const r = record(tool, { staging: file(PROD, P_KEY), local: file(PROD, P_KEY) }, live(PROD, P_KEY), []);
      expect(r.status, r.out).toBe(1);
      expect(r.out).toMatch(GUARD);
      expect(r.requests).toEqual([]);
    });
  it.each(["perf-report.mts", "verify-legacy-history.mts", "sync-legacy-orderbook.mts"])(
    "%s: production without naming it is refused before any request", (tool) => {
      const r = record(tool, BOTH, live(PROD, P_KEY), []);
      expect(r.status, r.out).toBe(1);
      expect(r.requests).toEqual([]);
    });
  /* Calls to writing functions, by any key — none may reach production. */
  const WRITING = /^POST \/rest\/v1\/(rpc\/(apply_|system_|seller_settle|seller_set|seller_create|admin_set|record_|release_|reserve_)|(?!rpc\/))/;
  it.each(["perf-report.mts", "verify-legacy-history.mts"])(
    "%s: --env production only reads — no insert, no call to a writing function", (tool) => {
      const r = record(tool, BOTH, live(PROD, P_KEY), ["--env", "production"]);
      expect(r.out).toContain(`environment guard: passed — target is production (${P_REF})`);
      expect(r.requests.length).toBeGreaterThan(0);
      expect(r.requests.filter((q) => WRITING.test(q) || /^(PATCH|DELETE|PUT) /.test(q)), r.requests.join("\n")).toEqual([]);
    }, 60_000);
  it("verify-legacy-history on pinned staging still sends its writing-function probes", () => {
    const r = record("verify-legacy-history.mts", BOTH, live(STAGING, S_KEY), []);
    expect(r.requests.filter((q) => /rpc\/(apply_reconciled_legacy_settlement|system_settle_reconciled_legacy_item)/.test(q)).length,
      r.requests.join("\n")).toBe(2);
  }, 60_000);
  it("verify-payment-smoke: production pair on the staging path refused by the shared guard", () => {
    const r = record("verify-payment-smoke.mts", { staging: file(PROD, P_KEY), local: file(PROD, P_KEY) }, live(PROD, P_KEY), []);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toMatch(GUARD);
    expect(r.requests).toEqual([]);
  });
  it("verify-payment-smoke contains no remote write: only .select() after .from(), no insert/update/upsert/delete/rpc/invoke", () => {
    const s = readFileSync("tools/verify-payment-smoke.mts", "utf8");
    expect(s).not.toMatch(/\.(insert|upsert|update|delete|rpc|invoke)\(/);
    const froms = [...s.matchAll(/\.from\(\s*"[\w]+"\s*\)\s*\.(\w+)\(/g)].map((m) => m[1]);
    expect(froms.length).toBeGreaterThan(0);
    expect(new Set(froms)).toEqual(new Set(["select"]));
    expect(s).not.toMatch(/fetch\(/);
  });
  it("the :prod read scripts name production explicitly", () => {
    const S = (JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> }).scripts;
    for (const k of ["verify:commerce:prod", "verify:seller:prod", "verify:legacy-history:prod", "perf:report:prod", "sync:orderbook:prod"]) {
      expect(S[k], k).toMatch(/--env-file=\.env\.local .* --env production$/);
    }
  });
});

/* ------------------------------------------------------- the typed confirmation */

describe("confirmProductionWrite — right before the write, at a terminal only", () => {
  const dir = mkdtempSync(join(tmpdir(), "m04-confirm-"));
  dirs.push(dir);
  const probe = join(dir, "probe.mts");
  writeFileSync(probe, `import { confirmProductionWrite } from ${JSON.stringify(join(ROOT, "tools/lib/staging-guard.mts"))};
await confirmProductionWrite("probe", "1 change");
console.log("WOULD WRITE");\n`);
  /* A real pseudo-terminal: Python's pty answers the prompt once it appears. */
  const PTY = `import os, pty, sys, time, select
answer, *cmd = sys.argv[1:]
pid, fd = pty.fork()
if pid == 0:
    os.execvp(cmd[0], cmd)
out = b""; sent = False; deadline = time.time() + 20
while time.time() < deadline:
    r, _, _ = select.select([fd], [], [], 0.2)
    if fd in r:
        try: chunk = os.read(fd, 4096)
        except OSError: break
        if not chunk: break
        out += chunk
        if not sent and b"Type the full project id" in out:
            os.write(fd, answer.encode() + b"\\r"); sent = True
_, status = os.waitpid(pid, 0)
sys.stdout.write(out.decode(errors="replace").replace("\\r", ""))
sys.exit(os.WEXITSTATUS(status))
`;
  const atTerminal = (answer: string) => spawnSync("python3", ["-I", "-c", PTY, answer, process.execPath, probe],
    { encoding: "utf8", timeout: 30_000 });

  it("non-interactive (stdin is a pipe): fail-closed, even if the right id is piped in", () => {
    const r = spawnSync(process.execPath, [probe], { encoding: "utf8", input: `${P_REF}\n`, timeout: 30_000 });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("never confirmed non-interactively");
    expect(r.stdout).not.toContain("WOULD WRITE");
  });
  it("at a terminal, the full id confirms", () => {
    const r = atTerminal(P_REF);
    expect(r.status, r.stdout).toBe(0);
    expect(r.stdout).toContain("production write confirmed.");
    expect(r.stdout).toContain("WOULD WRITE");
  });
  it.each([["a typo", "zmiwxswrpkmizvqsgyp"], ["the staging id", S_REF], ["yes", "yes"]])("at a terminal, %s is refused", (_n, answer) => {
    const r = atTerminal(answer);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("PRODUCTION WRITE NOT CONFIRMED");
    expect(r.stdout).not.toContain("WOULD WRITE");
  }, 30_000);
});

/* ------------------------------------------------------------ coverage guard */

describe("coverage: no tool can write without a guard, no production write without the full rule", () => {
  const TOOLS = readdirSync("tools").filter((f) => f.endsWith(".mts")).sort();
  const src = (f: string) => readFileSync(join("tools", f), "latin1");
  const WRITES = [
    /\.from\(\s*["'`][\w.]+["'`]\s*\)\s*\.(insert|update|upsert|delete)\(/,
    /\.storage\s*\.from\([^)]*\)\s*\.(upload|remove|move|copy)\(/,
    /\.(upload|remove)\(\s*[a-zA-Z_.]+\s*,/,
    /\.rpc\(\s*["'`](system_|admin_(set|create|merge|delete|grant|remove)|seller_(create|add|set|update|delete|import|book|recon_(apply|decide|create|exclude|assign|take|discard|close))|record_|set_shop|apply_|issue_|hold_|release_|refresh_)/,
    /auth\.admin\.(createUser|deleteUser|updateUserById)/,
  ];
  const writes = (s: string) => WRITES.some((r) => r.test(s));
  const GUARD_CALL = /requireStaging\(|requirePinnedStagingWrite\(|guardWriteTool\(|pinnedEnvFile\(|staging-db\.mts/;
  /* Named, with the reason — a new entry here is a security decision. */
  const OWN_GUARD: Record<string, string> = {
    "transfer-to-production.mts": "own transfer guard, bound to PINNED_REFS since M-04",
  };
  const SCRIPTS = (JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> }).scripts;
  const writers = TOOLS.filter((f) => writes(src(f)));

  it("the scan finds the known writers (a sanity floor, not the list)", () => {
    expect(writers.length).toBeGreaterThanOrEqual(30);
    for (const f of ["grant-admin.mts", "import-catalog.mts", "reconcile-inventory.mts", "verify-rls.mts", "storage-transfer.mts"]) {
      expect(writers).toContain(f);
    }
  });

  it.each(writers)("%s calls a shared guard (or is a named exception)", (f) => {
    const s = src(f);
    if (OWN_GUARD[f]) {
      if (f === "transfer-to-production.mts") {
        expect(s).toContain("PINNED_REFS.staging");
        expect(s).toContain("PINNED_REFS.production");
        expect(s).toContain("productionConfirmation()");
        expect(s).toContain("confirmProductionWrite(");
      }
      return;
    }
    expect(s).toMatch(GUARD_CALL);
  });

  it("no writer depends on an optional flag for its guard", () => {
    for (const f of writers) {
      const s = src(f);
      if (!s.includes("requireStagingIfRequested(")) continue;
      // only as the preview branch next to a real write guard
      expect(s, f).toMatch(/requireStaging\(|requirePinnedStagingWrite\(|guardWriteTool\(/);
    }
  });

  it("every writer with a production path asks for the typed id right before writing", () => {
    for (const f of writers) {
      const s = src(f);
      // `guardWriteTool(…, { apply: false })` is a READ guard: it never opens a production write path.
      const production = /guardWriteTool\([^;]*\{ apply: (?!false \})/.test(s) || s.includes("requireProductionWrite(")
        || (s.includes("pinnedEnvFile(") && /production/.test(s) && s.includes("--apply"));
      if (!production || f === "sync-legacy-orderbook.mts") continue;
      expect(s, `${f} must call confirmProductionWrite`).toContain("confirmProductionWrite(");
    }
  });

  it("tools that only READ production gate every write probe on the pinned-staging result (M-04B)", () => {
    for (const f of ["verify-commerce.mts", "verify-seller.mts", "verify-legacy-history.mts"]) {
      const s = src(f);
      expect(s, f).toMatch(/guardWriteTool\("[\w:-]+", process\.argv\.slice\(2\), \{ apply: false \}\)/);
      expect(s, f).toContain('const WRITE_PROBES = TARGET === "staging";');
    }
  });

  it("no tool accepts a bare --confirm-production any more", () => {
    for (const f of TOOLS) {
      const s = src(f);
      expect(s, f).not.toMatch(/argv\.includes\(\s*["'`]--confirm-production["'`]\s*\)/);
      expect(s, f).not.toMatch(/flag\(\s*["'`]confirm-production["'`]\s*\)/);
    }
  });

  it("no npm script carries a production confirmation — it is always typed", () => {
    for (const [name, command] of Object.entries(SCRIPTS)) {
      expect(command, name).not.toContain("--confirm-production");
    }
  });

  it("no npm script points a writer at .env.local unless the writer has the production rule", () => {
    for (const [name, command] of Object.entries(SCRIPTS)) {
      const m = /tools\/([\w.-]+\.mts)/.exec(command);
      if (!m || !command.includes(".env.local") || !writers.includes(m[1]) || OWN_GUARD[m[1]]) continue;
      const s = src(m[1]);
      // sync:orderbook:prod is a production PREVIEW: its write path is pinned to staging (M-02).
      if (m[1] === "sync-legacy-orderbook.mts") {
        expect(s).toContain('if (APPLY) requirePinnedStagingWrite("sync-legacy-orderbook --apply");');
        continue;
      }
      expect(s, `${name} → ${m[1]}`).toMatch(/guardWriteTool\(|requireProductionWrite\(|confirm-production=\$\{PINNED_REFS\.production\}/);
    }
  });

  it("the approved :prod scripts are gone (M-04 decisions 1 and 2), the read-only ones stay", () => {
    for (const gone of ["verify:rls:prod", "verify:editorial:prod", "verify:inventory:prod", "catalog:import:prod",
      "characters:import:prod", "legacy:history:prod", "inventory:import-legacy:prod", "reconcile:inventory:prod",
      "settle:legacy-sales:prod", "orderbook:sales-import:prod"]) {
      expect(SCRIPTS[gone], gone).toBeUndefined();
    }
    for (const stays of ["verify:shop:prod", "verify:seller:prod", "verify:commerce:prod", "verify:legacy-history:prod",
      "perf:report:prod", "images:export:prod"]) {
      expect(SCRIPTS[stays], stays).toBeDefined();
    }
  });

  it("the copied substring checks are gone", () => {
    // env-audit only COUNTS where an id occurs in env values; it connects nowhere.
    for (const f of TOOLS.filter((t) => t !== "env-audit.mts")) {
      expect(src(f), f).not.toMatch(/\.includes\((kennung|erwarteteKennung|ref)\)/);
    }
  });
});
