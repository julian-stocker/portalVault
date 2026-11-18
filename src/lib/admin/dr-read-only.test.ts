import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Every query the DR scripts send to the SOURCE (Production) runs inside an
 * explicit read-only transaction, checked from within that transaction.
 *
 * Why this exists: on 2026-11-17 a check with
 * PGOPTIONS='-c default_transaction_read_only=on' through the Supabase session
 * pooler came back with transaction_read_only = off. The pooler does not pass
 * startup options on, so that "lock" was never there. The role is `postgres`;
 * nothing else stops a write.
 *
 * Part 1 reads the scripts (always runs). Part 2 starts a throwaway local
 * PostgreSQL and proves the behaviour (DR_REAL_PG=1, like test:recon-pg).
 */

const LIB = readFileSync("tools/dr/lib.sh", "utf8");
const BASELINE = readFileSync("tools/dr/10-baseline.sh", "utf8");
const SCRIPTS = readdirSync("tools/dr").filter((f) => f.endsWith(".sh"));

/** The SQL files 10-baseline.sh loops over, read from the script itself. */
function baselineFiles(): string[] {
  const loop = BASELINE.match(/for f in ([\s\S]*?); do/);
  if (!loop) throw new Error("loop over the SQL files not found in 10-baseline.sh");
  return loop[1].replace(/\\\n/g, " ").split(/\s+/).filter(Boolean);
}

/** SQL without comments, for the statement checks. */
const stripComments = (sql: string) =>
  sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");

describe("DR scripts: source queries are locked read-only inside the session", () => {
  it("no script calls psql on the source directly", () => {
    for (const f of SCRIPTS) {
      const text = readFileSync(join("tools/dr", f), "utf8");
      expect(text, f).not.toMatch(/\$PGBIN\/psql"?\s+"?\$DR_SOURCE_URI/);
    }
  });

  it("10-baseline.sh sends every query through psql_read_only", () => {
    // the loop over the files and the server line: two call sites, no other psql
    expect(BASELINE.match(/psql_read_only "\$DR_SOURCE_URI"/g)).toHaveLength(2);
    expect(BASELINE).not.toMatch(/\$PGBIN\/psql/);
  });

  it("35-shape-check.sh reads the source through psql_read_only", () => {
    const text = readFileSync("tools/dr/35-shape-check.sh", "utf8");
    expect(text).toMatch(/psql_read_only "\$DR_SOURCE_URI" < "\$SQL" > "\$OUT\/quelle\.csv"/);
  });

  it("the prologue opens a read-only transaction and checks it from inside", () => {
    const prologue = LIB.match(/DR_READ_ONLY_PROLOGUE='([\s\S]*?)\n\\endif'/);
    expect(prologue, "DR_READ_ONLY_PROLOGUE").not.toBeNull();
    const lines = prologue![1].split("\n");
    expect(lines[0]).toBe("BEGIN TRANSACTION READ ONLY;");
    expect(lines[1]).toBe("SHOW transaction_read_only \\gset dr_");
    expect(lines[2]).toBe("\\if :dr_transaction_read_only");
    expect(lines[3]).toBe("\\else");
    expect(lines[4]).toMatch(/RAISE EXCEPTION .*ABBRUCH: transaction_read_only ist nicht on/);
  });

  it("psql_read_only uses one connection: prologue, stdin, COMMIT into a single psql", () => {
    const fn = LIB.match(/psql_read_only\(\) \{([\s\S]*?)\n\}/);
    expect(fn).not.toBeNull();
    const body = fn![1];
    expect(body.match(/\$PGBIN\/psql/g)).toHaveLength(1);
    expect(body).toMatch(/printf '%s\\n' "\$DR_READ_ONLY_PROLOGUE"; cat; printf '\\n%s\\n' 'COMMIT;'/);
    expect(body).toMatch(/--set=ON_ERROR_STOP=1 --quiet --csv --file=-/);
  });

  it("files are created 600/700: umask 077 in lib.sh, and every script sources lib.sh first", () => {
    // F4b.2: the first Production dump came out 644/755
    expect(LIB).toMatch(/^umask 077$/m);
    for (const f of SCRIPTS.filter((x) => x !== "lib.sh")) {
      const text = readFileSync(join("tools/dr", f), "utf8");
      const firstCommand = text.split("\n").find((l) => l.trim() !== "" && !l.startsWith("#"));
      expect(firstCommand, f).toBe('source "$(dirname "$0")/lib.sh"');
    }
    // the TOC filter is node, not bash: it sets the mode itself
    const filter = readFileSync("tools/dr/30-filter-toc.mts", "utf8");
    expect(filter.match(/mode: 0o600/g)).toHaveLength(2);
  });

  it("every DR session renders timestamps in UTC (F4b.6: digests hash row::text)", () => {
    expect(LIB).toMatch(/^export PGTZ=UTC$/m);
  });

  it("50-verify.sh records the effective rights of every public relation without its own ACL", () => {
    const verify = readFileSync("tools/dr/50-verify.sh", "utf8");
    expect(verify).toMatch(/rights-effective\.csv/);
    for (const role of ["anon", "authenticated", "service_role", "postgres"]) expect(verify).toContain(`('${role}')`);
    for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) expect(verify).toContain(`'${p}')`);
    expect(verify).toMatch(/c\.relacl is null/);
  });

  it("every baseline file exists, ends with ';' and carries no transaction control", () => {
    const files = baselineFiles();
    expect(files).toHaveLength(8);
    for (const f of files) {
      const sql = stripComments(readFileSync(`supabase/checks/dr/${f}.sql`, "utf8"));
      // a trailing statement without ';' would swallow the appended COMMIT
      expect(sql.trimEnd().endsWith(";"), f).toBe(true);
      // a COMMIT/SET inside a file could end or loosen the read-only transaction
      expect(sql, f).not.toMatch(/^\s*(begin|commit|end|rollback|abort|start\s+transaction|set\b|reset\b|\\)/im);
    }
  });
});

const ENABLED = process.env.DR_REAL_PG === "1";
const BIN = process.env.RECON_PG_BIN ?? "/usr/local/opt/postgresql@17/bin";

describe.skipIf(!ENABLED)("psql_read_only on a real PostgreSQL server", { timeout: 60_000 }, () => {
  let dir = "";
  let uri = "";

  beforeAll(() => {
    if (!existsSync(join(BIN, "initdb"))) throw new Error(`no PostgreSQL binaries in ${BIN} (RECON_PG_BIN)`);
    dir = mkdtempSync(join(tmpdir(), "dr-ro-"));
    const port = 54000 + Math.floor(Math.random() * 900);
    execFileSync(join(BIN, "initdb"), ["-D", join(dir, "data"), "-U", "postgres", "-A", "trust", "-E", "UTF8", "--no-locale"], { stdio: "ignore" });
    execFileSync(join(BIN, "pg_ctl"), ["-D", join(dir, "data"), "-l", join(dir, "log"), "-w", "-o",
      `-p ${port} -k ${dir} -c listen_addresses='' -c fsync=off`, "start"], { stdio: "ignore" });
    uri = `postgresql:///postgres?host=${encodeURIComponent(dir)}&port=${port}&user=postgres`;
  }, 120_000);

  afterAll(() => {
    if (!dir) return;
    try {
      execFileSync(join(BIN, "pg_ctl"), ["-D", join(dir, "data"), "-m", "immediate", "-w", "stop"], { stdio: "ignore" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  /** Source lib.sh and run psql_read_only; `patch` may alter the prologue. */
  const readOnly = (input: string, patch = "") =>
    spawnSync("bash", ["-c", `source tools/dr/lib.sh; ${patch} psql_read_only "$URI"`], {
      input, encoding: "utf8", env: { ...process.env, PGBIN: BIN, URI: uri },
    });
  /** The call as 10-baseline.sh made it before (without the lock). */
  const plain = (input: string) =>
    spawnSync(join(BIN, "psql"), [uri, "--no-psqlrc", "--set=ON_ERROR_STOP=1", "--csv", "--file=-"], {
      input, encoding: "utf8",
    });

  it("inside the transaction transaction_read_only is on", () => {
    const r = readOnly("select current_setting('transaction_read_only') as ro;\n");
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe("ro\non\n");
  });

  it("a write is refused (25006), psql stops with 3, nothing is left behind", () => {
    const r = readOnly("create table dr_probe (x int);\n");
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/read-only transaction/);
    const after = plain("select to_regclass('public.dr_probe') is null as absent;\n");
    expect(after.stdout).toBe("absent\nt\n");
  });

  it("the check bites: without READ ONLY the prologue aborts before the query", () => {
    const r = readOnly("select 'query ran' as marker;\n",
      `DR_READ_ONLY_PROLOGUE="\${DR_READ_ONLY_PROLOGUE/BEGIN TRANSACTION READ ONLY;/BEGIN;}";`);
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/ABBRUCH: transaction_read_only ist nicht on/);
    expect(r.stdout).not.toMatch(/query ran/);
  });

  it("the CSV is byte for byte what the unlocked call produced — for every baseline file", () => {
    for (const f of baselineFiles()) {
      const sql = readFileSync(`supabase/checks/dr/${f}.sql`, "utf8");
      const before = plain(sql);
      const after = readOnly(sql);
      // an empty cluster lacks the app schema: then both must fail alike
      expect(after.status === 0, f).toBe(before.status === 0);
      expect(after.stdout, f).toBe(before.stdout);
    }
  });

  it("several result sets and the server line come through unchanged", () => {
    const sql = "select 1 as a, 'x,y' as b;\nselect current_setting('server_version_num') as version_num;\n";
    const r = readOnly(sql);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe(plain(sql).stdout);
  });
});
