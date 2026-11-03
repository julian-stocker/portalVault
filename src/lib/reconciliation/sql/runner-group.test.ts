/**
 * Six migration numbers, one run — does the runner still keep its promises?
 *
 * `migration-plans.json` holds a plan for every number (the registration
 * test demands it), and all six plans of 0169–0174 point to the SAME
 * preflight, run file and postflight. This drives the REAL runner
 * (`fahreAblauf`) with the REAL plans through every situation the operator
 * can get into. The connection and the check files are fakes, exactly as in
 * `src/lib/admin/migration-runner.test.ts`; the baseline record is really
 * written to and read from a temporary folder.
 *
 * What it shows:
 *   * applied means applied for all six at once — the state query asks for
 *     the last object of 0173 AND the 0174 fingerprint, so there is no state
 *     in which some numbers are "applied" and others not;
 *   * an applied group is never applied again, whichever number is called;
 *   * an interrupted or failed run leaves the frozen baselines untouched and
 *     can simply be started again;
 *   * a resume under the wrong number stops instead of measuring anew.
 *
 * That the run file is ONE transaction (all or nothing) and that a second
 * paste bounces is proven on PostgreSQL in `group-run.test.ts`.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type Ablauf, fahreAblauf, ladeAkte, ladePlaene, type Werkzeuge } from "@/../tools/db-migrate-staging.mts";

const NUMBERS = ["0169", "0170", "0171", "0172", "0173", "0174"] as const;
const GROUP = "0169-0170-0171-0172-0173-0174";
const plans = ladePlaene();

// Two valid baseline rows (protection sums recomputed in migration-runner.test.ts).
const BASE = "skyisles-base-1|256|4d1d6c30fe0ae886ca2689bcb1fe9634|534|534|286|626"
  + "|3821eb4f6bb067a408d973c3c14145e0|e61aa1ea49a4";
const COLL = "skyisles-coll-1|1|1|a8c965923be52b4d6fee837ae35fd22e|c8a5542794f2";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "recon-runner-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

type Run = { w: Werkzeuge; ran: string[]; contracts: Record<string, string>[] };

function tools(o: { dir: string; applied: boolean; drop?: "preflight" }): Run {
  const ran: string[] = [];
  const contracts: Record<string, string>[] = [];
  const w: Werkzeuge = {
    db: { fuehre: async () => [[{ erfuellt: o.applied }]] },
    fahre: async (entry, given) => {
      ran.push(entry.datei);
      contracts.push(Object.fromEntries(given));
      const pre = entry.datei.endsWith("_preflight.sql");
      if (pre && o.drop === "preflight") throw new Error("Connection terminated unexpectedly");
      return {
        datei: entry.datei, zweck: entry.zweck, status: "ok", abweichungen: "0", offen: "0",
        zeilen: (pre ? [{ nr: 900, befund: BASE }, { nr: 901, befund: COLL }] : []) as never[],
        auffaellig: [], dauerMs: 1, sha256: (pre ? "b" : "c").repeat(64),
      };
    },
    plaene: plans,
    akteDir: o.dir,
    checkDir: "supabase/checks",
    logDir: o.dir,
    jetzt: () => new Date("2026-11-03T10:00:00.000Z"),
    melde: () => {},
  };
  return { w, ran, contracts };
}

const stage = (a: Ablauf) => (a.ende === "abbruch" ? a.stufe : a.ende);

describe("the six plans are one group", () => {
  it("name the same preflight, run file, postflight and state query", () => {
    const shapes = NUMBERS.map((n) => {
      const p = plans[n];
      return JSON.stringify([p.preflight, p.lauf, p.postflight, p.angewendet.sql, p.liefert, p.braucht]);
    });
    expect(new Set(shapes).size).toBe(1);
    expect(plans["0169"].lauf).toBe(`staging-${GROUP}.sql`);
  });

  it("call the group applied only when its LAST objects stand — 0173's function and 0174's fingerprint", () => {
    const sql = plans["0169"].angewendet.sql;
    expect(sql).toContain("seller_recon_apply(bigint,integer)");
    expect(sql).toContain("23be72d581589b063d6938a863757b31");
  });

  it("have a preflight that stops on any partial state — a table, a function or the index already there", () => {
    const pre = readFileSync(`supabase/checks/${plans["0169"].preflight}`, "utf8");
    for (const row of ["(111, 'Luecke'", "(112, 'Luecke'", "(113, 'Luecke'", "(114, 'Luecke'"]) expect(pre).toContain(row);
  });
});

describe("the runner with the real plans", () => {
  it("fresh: any number runs the preflight once, freezes its baselines and hands over the ONE run file", async () => {
    const dir = tmp();
    const r = tools({ dir, applied: false });
    const a = await fahreAblauf(r.w, "0169", false);
    expect(stage(a)).toBe("handarbeit");
    expect(r.ran).toEqual([`${GROUP}_preflight.sql`]);
    const record = ladeAkte(join(dir, "baseline-0169.json"));
    expect(record.ok && record.akte.vertraege).toEqual({ "skyisles.base": BASE, "skyisles.coll": COLL });
  });

  it("applied: NO number runs anything again", async () => {
    for (const n of NUMBERS) {
      const r = tools({ dir: tmp(), applied: true });
      const a = await fahreAblauf(r.w, n, false);
      expect(stage(a), n).toBe("liegt-schon");
      expect(r.ran, n).toEqual([]);
    }
  });

  it("resume under the number that froze the baselines: the postflight gets exactly those", async () => {
    const dir = tmp();
    await fahreAblauf(tools({ dir, applied: false }).w, "0169", false);
    const r = tools({ dir, applied: true });
    const a = await fahreAblauf(r.w, "0169", true);
    expect(stage(a)).toBe("bestanden");
    expect(r.ran).toEqual([`${GROUP}_postflight.sql`]);
    expect(r.contracts[0]).toEqual({ "skyisles.base": BASE, "skyisles.coll": COLL });
  });

  it("resume under ANOTHER number of the group stops — the baselines are never measured after the run", async () => {
    const dir = tmp();
    await fahreAblauf(tools({ dir, applied: false }).w, "0169", false);
    const r = tools({ dir, applied: true });
    const a = await fahreAblauf(r.w, "0172", true);
    expect(stage(a)).toBe("akte");
    expect(r.ran).toEqual([]);
  });

  it("resume before the run was pasted stops: there is nothing to check yet", async () => {
    const dir = tmp();
    await fahreAblauf(tools({ dir, applied: false }).w, "0169", false);
    const a = await fahreAblauf(tools({ dir, applied: false }).w, "0169", true);
    expect(stage(a)).toBe("liegt-noch-nicht");
  });

  it("a dropped connection stops safely, and the next start measures again", async () => {
    const dir = tmp();
    const a = await fahreAblauf(tools({ dir, applied: false, drop: "preflight" }).w, "0169", false);
    expect(stage(a)).toBe("verbindung");
    expect(ladeAkte(join(dir, "baseline-0169.json")).ok).toBe(false);
    expect(stage(await fahreAblauf(tools({ dir, applied: false }).w, "0169", false))).toBe("handarbeit");
  });

  it("a failed group run (nothing applied) can be started again — the frozen baselines stay untouched", async () => {
    const dir = tmp();
    await fahreAblauf(tools({ dir, applied: false }).w, "0169", false);
    const before = readFileSync(join(dir, "baseline-0169.json"), "utf8");
    // The paste aborted (one transaction): the state query still says "not applied".
    const again = await fahreAblauf(tools({ dir, applied: false }).w, "0169", false);
    expect(again.ende === "handarbeit" && again.neu).toBe(false);
    expect(readFileSync(join(dir, "baseline-0169.json"), "utf8")).toBe(before);
  });
});

describe("APPLIED.md keeps the six together", () => {
  const text = readFileSync("supabase/migrations/APPLIED.md", "utf8");
  const files = readdirFiles();

  function readdirFiles(): string[] {
    return NUMBERS.map((n) => {
      const m = new RegExp(`\`(${n}_[a-z0-9_]+\\.sql)\``).exec(text);
      return m ? m[1] : `${n}-missing`;
    });
  }

  it("lists all six, each as prepared locally and applied nowhere — one state for one group", () => {
    for (const f of files) {
      const line = text.split("\n").find((l) => l.startsWith(`| \`${f}\` |`));
      expect(line, f).toBeDefined();
      expect(line, f).toContain("lokal vorbereitet");
      expect(line, f).toContain("nirgends angewendet");
    }
  });
});
