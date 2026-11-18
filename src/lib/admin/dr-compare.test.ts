import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * tools/dr/60-compare.sh decides whether a restore passed. F4b.6 gave it
 * named exceptions — platform tables whose rows are deliberately not
 * restored, one platform sequence, four CHECK constraints whose text only
 * changes in AND nesting, owner-only ACLs that come back as NULL, and two
 * differences of a LOCAL target. Every exception is tested here against its
 * opposite: the same kind of difference one step outside the exception must
 * still fail. Synthetic CSV files only; no database.
 */

type Files = Record<string, string>;

const PINNED: [string, string, string][] = [
  ["public.orders.orders_tracking_number_shape", "b58560d2b4dcf9166975fa3465d18615", "2dbdfdd8128a3f7c81950af957de4604"],
  ["public.perf_interactions.perf_interactions_viewport_sane", "d67c6156547b6db4424669f7a8c44cb9", "cd2facf1fe84012b9ea9087120cc2304"],
  ["public.perf_navigations.perf_navigations_viewport_sane", "d67c6156547b6db4424669f7a8c44cb9", "cd2facf1fe84012b9ea9087120cc2304"],
  ["public.profiles.profiles_username_format", "3eb37843e35ff25c5a2fd84f799b263d", "b0a91b584e6aa0cab02f0b82f035e514"],
];

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

/** Source (a) and target (b) as they looked on 2026-11-18, in miniature. */
function fixture(): { a: Files; b: Files } {
  const catalog = (ext: number) => ["schema,art,anzahl", "auth,Tabelle,27", `global,Extension,${ext}`,
    "public,Funktion,376", "public,Index,192", "public,Policy,33", "public,Trigger,55"].join("\n") + "\n";
  const rows = (platform: boolean) => ["schema,tabelle,zeilen",
    "auth,identities,11", `auth,refresh_tokens,${platform ? 15 : 0}`, `auth,sessions,${platform ? 9 : 0}`,
    "auth,users,11", ...range(45).map((i) => `public,t${i},${i}`),
    "storage,buckets,1", `storage,migrations,${platform ? 81 : 0}`, "storage,objects,89"].join("\n") + "\n";
  const sequences = (platform: boolean) => ["schema,sequenz,last_value",
    `auth,refresh_tokens_id_seq,${platform ? 616 : ""}`, ...range(25).map((i) => `public,s${i},${i + 1}`)].join("\n") + "\n";
  const definitions = (side: 1 | 2) => ["art,objekt,abdruck",
    ...range(65).map((i) => `constraint,public.t${i}.c${i},${"c".repeat(31)}${i % 10}`),
    ...PINNED.map(([n, q, z]) => `constraint,${n},${side === 1 ? q : z}`),
    ...range(85).map((i) => `index,public.t.i${i},${"d".repeat(32)}`),
    ...range(25).map((i) => `trigger,public.t.g${i},${"e".repeat(32)}`),
    ...range(25).map((i) => `policy,public.t.p${i},${"f".repeat(32)}`),
    ...range(105).map((i) => `funktion,public.f${i}(),${"a".repeat(32)}`)].join("\n") + "\n";
  const grants = (target: boolean) => ["art,objekt,rechte",
    ...range(45).map((i) => `tabelle,public.t${i},"postgres=arwdDxtm/postgres\nanon=r/postgres"`),
    `tabelle,public.platform_export_runs,${target ? "(Standard)" : "postgres=arwdDxtm/postgres"}`,
    target ? 'schema,auth,"postgres=UC/postgres\nanon=U/postgres"'
           : 'schema,auth,"supabase_admin=UC/supabase_admin\nanon=U/supabase_admin"',
    'schema,public,"postgres=UC/postgres\nanon=U/postgres"'].join("\n") + "\n";
  const common: Files = {
    "baseline-digests.csv": "tabelle,abdruck\norders,0123456789abcdef0123456789abcdef\n",
    "baseline-business.csv": ["nr,groesse,wert", ...range(22).map((i) => `${i + 1},g${i},${i}`)].join("\n") + "\n",
    "shape-auth-storage.csv": "schema,tabelle,spalten\nauth,users,abc\n",
  };
  return {
    a: { ...common, "baseline-catalog.csv": catalog(6), "baseline-rows.csv": rows(true),
         "baseline-sequences.csv": sequences(true), "baseline-definitions.csv": definitions(1),
         "baseline-grants.csv": grants(false) },
    b: { ...common, "baseline-catalog.csv": catalog(1), "baseline-rows.csv": rows(false),
         "baseline-sequences.csv": sequences(false), "baseline-definitions.csv": definitions(2),
         "baseline-grants.csv": grants(true),
         "verify-target.csv": ["nr,pruefung,befund,erwartet,ok", ...range(9).map((i) => `${i + 1},p,x,x,t`)].join("\n") + "\n",
         "rls-anon-purchases.txt": "ERROR:  permission denied for table purchases\n",
         "immutability.txt": "BEGIN\nUPDATE 0\nROLLBACK\n",
         "rights-effective.csv": ["objekt,eigentuemer,rolle,sel,ins,upd,del",
           "platform_export_runs,postgres,anon,f,f,f,f", "platform_export_runs,postgres,authenticated,f,f,f,f",
           "platform_export_runs,postgres,postgres,t,t,t,t", "platform_export_runs,postgres,service_role,f,f,f,f"].join("\n") + "\n" },
  };
}

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function run(f: { a: Files; b: Files }, kind: string | null = "local") {
  const vol = mkdtempSync(join(tmpdir(), "dr-compare-"));
  dirs.push(vol);
  for (const [side, files] of [["baseline-quelle", f.a], ["baseline-ziel", f.b]] as const) {
    mkdirSync(join(vol, side));
    for (const [name, text] of Object.entries(files)) writeFileSync(join(vol, side, name), text);
  }
  const env: NodeJS.ProcessEnv = { ...process.env, DR_VOL: vol };
  if (kind === null) delete env.DR_TARGET_KIND; else env.DR_TARGET_KIND = kind;
  const r = spawnSync("bash", ["tools/dr/60-compare.sh"], { encoding: "utf8", env });
  return { status: r.status, out: r.stdout + r.stderr };
}

/** Replace one line of one file on one side. */
function edit(f: { a: Files; b: Files }, side: "a" | "b", file: string, from: string | RegExp, to: string) {
  const before = f[side][file];
  const after = before.replace(from, to);
  expect(after, `edit ${side}/${file}`).not.toBe(before);
  f[side][file] = after;
  return f;
}

describe("60-compare.sh: the exceptions hold, and only them", () => {
  it("the 2026-11-18 situation, local target: no finding", () => {
    const r = run(fixture());
    expect(r.out).toContain("KEIN BEFUND");
    expect(r.status).toBe(0);
    expect(r.out).toContain("umgebung Extensions: Quelle 6, Ziel 1");
    expect(r.out).toMatch(/ok +public\.platform_export_runs: Ziel ohne eigene ACL/);
  });

  it("the same without DR_TARGET_KIND=local: extensions and hull schema ACL are findings", () => {
    const r = run(fixture(), null);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/ABWEICH\. Extensions: Quelle 6, Ziel 1/);
    expect(r.out).toMatch(/ABWEICH\. Rechte/);
  });

  it("strict mode passes when extensions and schema ACLs are equal", () => {
    const f = fixture();
    f.b["baseline-catalog.csv"] = f.b["baseline-catalog.csv"].replace("global,Extension,1", "global,Extension,6");
    f.b["baseline-grants.csv"] = f.b["baseline-grants.csv"].replace(
      'schema,auth,"postgres=UC/postgres\nanon=U/postgres"', 'schema,auth,"supabase_admin=UC/supabase_admin\nanon=U/supabase_admin"');
    expect(run(f, null).status).toBe(0);
  });

  describe("(1) platform tables without rows", () => {
    it("a public table with another row count fails", () => {
      expect(run(edit(fixture(), "b", "baseline-rows.csv", "public,t7,7", "public,t7,6")).status).toBe(1);
    });
    it("auth.users, auth.identities, storage.objects and storage.buckets are compared in full", () => {
      for (const [from, to] of [["auth,users,11", "auth,users,10"], ["auth,identities,11", "auth,identities,10"],
                                ["storage,objects,89", "storage,objects,88"], ["storage,buckets,1", "storage,buckets,0"]]) {
        expect(run(edit(fixture(), "b", "baseline-rows.csv", from, to)).status, from).toBe(1);
      }
    });
    it("an auth table that is not on the list is compared in full", () => {
      const f = fixture();
      f.a["baseline-rows.csv"] = f.a["baseline-rows.csv"].replace("auth,users,11", "auth,brand_new,3\nauth,users,11");
      f.b["baseline-rows.csv"] = f.b["baseline-rows.csv"].replace("auth,users,11", "auth,brand_new,0\nauth,users,11");
      expect(run(f).status).toBe(1);
    });
    it("a listed platform table must still EXIST in the target", () => {
      expect(run(edit(fixture(), "b", "baseline-rows.csv", "auth,sessions,0\n", "")).status).toBe(1);
    });
  });

  describe("(2) platform sequences", () => {
    it("auth.refresh_tokens_id_seq may differ, a public sequence may not", () => {
      expect(run(fixture()).status).toBe(0);
      expect(run(edit(fixture(), "b", "baseline-sequences.csv", "public,s3,4", "public,s3,3")).status).toBe(1);
    });
  });

  describe("(3) CHECK constraints with a flattened AND chain", () => {
    it("a pinned constraint with any third digest fails", () => {
      expect(run(edit(fixture(), "b", "baseline-definitions.csv",
        "public.profiles.profiles_username_format,b0a91b584e6aa0cab02f0b82f035e514",
        "public.profiles.profiles_username_format,00000000000000000000000000000000")).status).toBe(1);
    });
    it("an unpinned constraint that changes fails", () => {
      expect(run(edit(fixture(), "b", "baseline-definitions.csv", /constraint,public\.t3\.c3,c+3/, "constraint,public.t3.c3,x")).status).toBe(1);
    });
    it("the pinned target digest under another constraint name fails", () => {
      expect(run(edit(fixture(), "b", "baseline-definitions.csv", /constraint,public\.t4\.c4,c+4/,
        "constraint,public.t4.c4,2dbdfdd8128a3f7c81950af957de4604")).status).toBe(1);
    });
  });

  describe("(5) NULL ACL against an explicit owner-only ACL", () => {
    it("fails when anon may SELECT", () => {
      expect(run(edit(fixture(), "b", "rights-effective.csv", "platform_export_runs,postgres,anon,f,f,f,f",
        "platform_export_runs,postgres,anon,t,f,f,f")).status).toBe(1);
    });
    it("fails when service_role may DELETE", () => {
      expect(run(edit(fixture(), "b", "rights-effective.csv", "platform_export_runs,postgres,service_role,f,f,f,f",
        "platform_export_runs,postgres,service_role,f,f,f,t")).status).toBe(1);
    });
    it("fails when the owner is not postgres", () => {
      expect(run(edit(fixture(), "b", "rights-effective.csv", "platform_export_runs,postgres,authenticated",
        "platform_export_runs,someone,authenticated")).status).toBe(1);
    });
    it("fails without the effective-rights file", () => {
      const f = fixture();
      delete f.b["rights-effective.csv"];
      expect(run(f).status).toBe(1);
    });
    it("fails when a table with real grants comes back with a NULL ACL", () => {
      expect(run(edit(fixture(), "b", "baseline-grants.csv",
        'tabelle,public.t5,"postgres=arwdDxtm/postgres\nanon=r/postgres"', "tabelle,public.t5,(Standard)")).status).toBe(1);
    });
  });

  describe("(4) local target", () => {
    it("the ACL of schema public is always compared", () => {
      expect(run(edit(fixture(), "b", "baseline-grants.csv",
        'schema,public,"postgres=UC/postgres\nanon=U/postgres"', 'schema,public,"postgres=UC/postgres\nanon=UC/postgres"')).status).toBe(1);
    });
    it("a table ACL change is a finding even in local mode", () => {
      expect(run(edit(fixture(), "b", "baseline-grants.csv",
        'tabelle,public.t9,"postgres=arwdDxtm/postgres\nanon=r/postgres"', 'tabelle,public.t9,"postgres=arwdDxtm/postgres\nanon=rw/postgres"')).status).toBe(1);
    });
  });
});
