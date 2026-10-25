import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  checkStagingTarget,
  chooseEnvironment,
  ENVIRONMENT_FLAG,
  PRODUCTION_CONFIRMATION,
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
      /*
       * `db:check:staging` IS THE ONE EXCEPTION, AND ITS GUARD IS STRONGER.
       *
       * It opens a PostgreSQL session, not a Supabase client, so there is no
       * service-role key to point at an env file. Its credential lives OUTSIDE
       * the repository (`~/.skyisles/staging-db.env`) and is checked three
       * ways before a statement runs: the connection string must carry the
       * staging ref and must not mention the production ref anywhere, the
       * session must answer with the staging stamp, and the role is read-only
       * by its own configuration. Asserting `--env-file=.env.staging` here
       * would demand the weaker mechanism.
       *
       * The replacement assertion is below, and `staging-access.test.ts`
       * covers every refusal path.
       */
      if (name === "db:check:staging") {
        expect(command, name).toBe("node tools/db-check-staging.mts");
        expect(command, name).not.toContain("--env-file");
        const quelle = readFileSync("tools/db-check-staging.mts", "utf8");
        expect(quelle).toContain("verbindeStaging");
        expect(quelle).not.toMatch(/\.env\.local/);
        continue;
      }
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

/**
 * Welche Umgebung ein Werkzeug bedient, das beide kann.
 *
 * Der Sales-Importer lief lange nur gegen Staging. Für den Cutover muss er
 * auch Production bedienen — und genau da wäre ein Default der Fehler
 * gewesen: still auf Production zu zeigen, weil jemand ein Flag vergaß.
 * Also wird die Umgebung gewählt, nie geerbt, und Production zweimal.
 */
describe("choosing an environment is an act, not a default", () => {
  it("refuses a run that names no environment", () => {
    const choice = chooseEnvironment(["--apply"]);
    expect(choice.ok).toBe(false);
    if (!choice.ok) expect(choice.message).toContain(ENVIRONMENT_FLAG);
  });

  it("refuses an environment that does not exist", () => {
    for (const value of ["prod", "live", "Staging2", "", "--apply"]) {
      const choice = chooseEnvironment([ENVIRONMENT_FLAG, value]);
      expect(choice.ok, value).toBe(false);
    }
  });

  it("accepts staging on its own, as before", () => {
    expect(chooseEnvironment([ENVIRONMENT_FLAG, "staging"]))
      .toEqual({ ok: true, environment: "staging" });
    expect(chooseEnvironment([`${ENVIRONMENT_FLAG}=staging`, "--apply", "--confirm-staging"]))
      .toEqual({ ok: true, environment: "staging" });
  });

  it("refuses production without its second word", () => {
    expect(chooseEnvironment([ENVIRONMENT_FLAG, "production"]).ok).toBe(false);
    expect(chooseEnvironment([ENVIRONMENT_FLAG, "production", "--apply"]).ok).toBe(false);
    // Ein anderes Bekenntnis zählt nicht.
    expect(chooseEnvironment([ENVIRONMENT_FLAG, "production", "--confirm-staging"]).ok).toBe(false);
  });

  it("accepts production only when it is named twice", () => {
    expect(chooseEnvironment([ENVIRONMENT_FLAG, "production", PRODUCTION_CONFIRMATION]))
      .toEqual({ ok: true, environment: "production" });
  });

  it("never lets one run mean two environments", () => {
    const choice = chooseEnvironment([ENVIRONMENT_FLAG, "staging", ENVIRONMENT_FLAG, "production",
                                      PRODUCTION_CONFIRMATION]);
    expect(choice.ok).toBe(false);
    if (!choice.ok) expect(choice.message).toContain("One run, one environment");
  });

  it("does not turn a stray confirmation into a choice", () => {
    // `--confirm-production` allein wählt nichts aus.
    expect(chooseEnvironment([PRODUCTION_CONFIRMATION]).ok).toBe(false);
    expect(chooseEnvironment([PRODUCTION_CONFIRMATION, "--apply"]).ok).toBe(false);
  });
});

describe("the sales importer keeps both guards and every data gate", () => {
  const TOOL = readFileSync("tools/import-sales.mts", "utf8");
  const PACKAGE = JSON.parse(readFileSync("package.json", "utf8")) as
    { scripts: Record<string, string> };

  it("chooses before it connects, and checks the identity afterwards", () => {
    expect(TOOL).toContain("const choice = chooseEnvironment(process.argv.slice(2));");
    expect(TOOL).toContain('requireProduction("orderbook:sales-import")');
    expect(TOOL).toContain('requireStaging("orderbook:sales-import")');
    // Die Wahl steht vor jedem Schreibweg.
    expect(TOOL.indexOf("chooseEnvironment(")).toBeLessThan(TOOL.indexOf("await apply(client"));
    // Und `requireStaging` ist nicht ersatzlos verschwunden.
    expect(TOOL).toMatch(/requireStaging\(/);
  });

  it("asks for the environment's own confirmation before an apply", () => {
    expect(TOOL).toContain('? "confirm-production" : "confirm-staging"');
    expect(TOOL).toContain("if (!flag(confirmation))");
    expect(TOOL).toContain("Nothing was written");
  });

  it("gives each environment its own script, and neither borrows the other", () => {
    const staging = PACKAGE.scripts["orderbook:sales-import:staging"];
    const production = PACKAGE.scripts["orderbook:sales-import:prod"];
    expect(staging).toContain("--env-file=.env.staging");
    expect(staging).toContain("--env staging");
    expect(staging).toContain(`${REQUIRE_STAGING_FLAG}=1`);
    expect(staging).not.toContain(".env.local");
    expect(staging).not.toContain("production");

    expect(production).toContain("--env-file=.env.local");
    expect(production).toContain("--env production");
    expect(production).toContain(PRODUCTION_CONFIRMATION);
    expect(production).not.toContain(".env.staging");
    expect(production).not.toContain(`${REQUIRE_STAGING_FLAG}=1`);
    // Kein Apply im Skript selbst: das bleibt eine bewusste Eingabe.
    expect(production).not.toContain("--apply");
    expect(staging).not.toContain("--apply");
  });

  it("still refuses to write unless every dataset gate holds", () => {
    const fn = TOOL.slice(TOOL.indexOf("function applyInvariants"));
    for (const [what, wanted] of [
      ["Quellgruppen", "297"], ["echte Verkäufe", "296"],
      ["eigenständige Korrekturen", "1"], ["unaufgelöste Positionen", "0"],
      ["mehrdeutige Positionen", "0"], ["ungültige Positionen", "0"],
      ["Auszahlungsabweichungen", "0"], ["Fingerabdruck-Kollisionen", "0"],
      ["blockierte Gruppen", "0"],
    ] as const) {
      expect(fn, what).toContain(`expect("${what}"`);
      expect(fn.slice(fn.indexOf(`expect("${what}"`)), what).toContain(wanted);
    }
    // Und die Gates stehen vor dem ersten Schreibvorgang.
    expect(TOOL).toMatch(/const failures = applyInvariants\(plans\);[\s\S]*?process\.exit\(1\)/);
  });

  it("has no allow-list for the four new groups in its executable code", () => {
    /*
     * Die vier Kopfzeilen dürfen im Kommentar stehen — sie begründen den
     * Dataset-Snapshot 297/296. Was sie nicht dürfen: den Import steuern.
     * Geprüft wird deshalb der ausgeführte Code, nicht die Erklärung.
     */
    const code = TOOL.split("\n")
      .filter((l) => { const t = l.trimStart();
        return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*"); })
      .join("\n");
    for (const headerRow of ["1553", "1561", "1567", "1577"]) {
      expect(code, headerRow).not.toContain(headerRow);
    }
    // Und es gibt überhaupt keine Kopfzeilen-Auswahl: importiert wird, was
    // der Plan als `eligible` führt.
    expect(TOOL).toContain('plans.filter((p) => p.status === "eligible")');
  });

  it("still signs in as an operator and writes through the import RPCs", () => {
    expect(TOOL).toContain("signInWithPassword");
    expect(TOOL).toContain('client.rpc("seller_import_sale_group"');
    expect(TOOL).toContain('client.rpc("seller_import_settlement_adjustment"');
  });
});

describe("dev:staging gibt dem Webprozess keine Production-Zugangsdaten", () => {
  /**
   * DIE LÜCKE, DIE AM 2026-10-25 AUFFIEL.
   *
   * `tools/dev-staging.mts` übergab selbst keinen Service-Role-Key — und der
   * Kopfkommentar sagte das auch. Nur lädt `next dev` `.env.local` SELBST,
   * und dort steht der **Production**-Service-Role-Key. Der Webprozess bekam
   * ihn also jedes Mal, durch die Hintertür. Gelesen hat ihn nichts
   * (`grep SERVICE_ROLE src/` findet außerhalb von Tests keinen Treffer) —
   * der Punkt ist, dass nichts es hätte müssen.
   */
  const quelle = readFileSync("tools/dev-staging.mts", "utf8");

  it("überschreibt den Service-Role-Key mit einem Platzhalter", () => {
    expect(quelle).toContain('const NIEMALS_WEITERGEBEN = ["SUPABASE_SERVICE_ROLE_KEY"]');
    expect(quelle).toContain("for (const name of NIEMALS_WEITERGEBEN) kindUmgebung[name] = ENTZOGEN;");
  });

  it("und der Platzhalter ist NICHT leer", () => {
    /*
     * Ein leerer Wert gilt manchen Env-Ladern als „nicht gesetzt" — dann
     * gewinnt `.env.local` wieder, und die Härtung wäre eine Illusion. Der
     * Platzhalter muss gesetzt, nicht-leer und offensichtlich ungültig sein.
     */
    const m = quelle.match(/const ENTZOGEN = "([^"]+)";/);
    expect(m, "kein Platzhalter gesetzt").not.toBeNull();
    expect(m![1].length).toBeGreaterThan(8);
    expect(m![1]).toContain("disabled");
    expect(quelle).not.toMatch(/kindUmgebung\[name\] = "";/);
  });

  it("prüft JEDEN Wert der Kindumgebung auf die Production-Kennung", () => {
    /*
     * Die Sperre, die auch für Clients gilt, die dieses Skript nicht kennt:
     * geprüft wird die Umgebung, die der Server wirklich bekommt — nicht die
     * Datei, aus der sie stammt, und nicht die Namensliste. Trägt irgendein
     * Wert die Production-Kennung, startet nichts.
     */
    expect(quelle).toContain("Object.entries(kindUmgebung)");
    expect(quelle).toContain("wert.includes(produktionsKennung)");
    expect(quelle).toContain("No server was started.");
    /* Die Kennung kommt aus `.env.local`, nicht aus einem Literal im Code. */
    expect(quelle).toContain("referenceFromDisk().production.NEXT_PUBLIC_SUPABASE_URL");
    expect(quelle).not.toContain("zmiwxswrpkmizvqsgype");
  });

  it("der Kindprozess erbt nicht einfach process.env", () => {
    /* `env: kindUmgebung`, nicht `env: { ...process.env, … }` am Aufruf. */
    const spawnStelle = quelle.slice(quelle.indexOf('spawn("npx"'));
    expect(spawnStelle).toContain("env: kindUmgebung,");
    expect(spawnStelle).not.toContain("...process.env");
  });

  it("und die Annahme hinter alldem gilt noch: kein Anwendungscode liest den Key", () => {
    /*
     * Die Härtung ersetzt diese Zusicherung nicht, sie stützt sie. Liest
     * eines Tages doch ein serverseitiger Client den Schlüssel, bekommt er
     * den Platzhalter — und scheitert laut, statt Production zu erreichen.
     */
    const treffer = readFileSync("src/lib/supabase/server.ts", "utf8")
      + readFileSync("src/lib/supabase/client.ts", "utf8");
    expect(treffer).not.toContain("SERVICE_ROLE");
  });
});
