import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The legacy opening balance (V5, Part A).
 *
 * This tool runs once against real business data and against a legacy project
 * that must not be touched. The properties below are the ones that make that
 * safe, and they are asserted against the source rather than trusted: a
 * second run must not double the stock, a dry run must not write, and no
 * private column of the workbook may be read at all.
 */
function source(path: string): string {
  return readFileSync(path, "utf8");
}

/** The file without its comments — what the code does, not what it says. */
function code(path: string): string {
  return source(path)
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("/*");
    })
    .join("\n");
}

const TOOL = "tools/import-legacy-inventory.mts";
const READER = "tools/lib/xlsx.mts";
/** The decision itself, tested behaviourally in legacy-plan.test.ts. */
const PLAN = "src/lib/shop/legacy-plan.ts";

describe("the legacy project stays untouched", () => {
  it("never opens anything for writing", () => {
    // CLAUDE.md rule 1. The reader has no write path at all, which is a
    // stronger guarantee than a rule saying it must not use one.
    for (const path of [TOOL, READER]) {
      const body = code(path);
      expect(body).not.toContain("writeFileSync");
      expect(body).not.toContain("appendFileSync");
      expect(body).not.toContain("createWriteStream");
      expect(body).not.toContain("rmSync");
      expect(body).not.toContain("unlinkSync");
      expect(body).not.toContain("execSync");
    }
  });
});

describe("which columns the workbook is read by", () => {
  const body = code(TOOL);

  it("reads the SKY-ID, the name and the three business columns, and nothing else", () => {
    const columns = [...body.matchAll(/^const COL_[A-Z_]+ = (\d+);$/gm)].map((m) => Number(m[1]));
    // A=0 id, B=1 name, D=3 bought, E=4 sold, F=5 stock.
    expect(columns.sort((a, b) => a - b)).toEqual([0, 1, 3, 4, 5]);
  });

  it("never reads the private collection or valuation columns", () => {
    // P–S (15–18) is the owner's private collection, U–X (20–23) its value.
    // Neither is business data and neither may leave the legacy project.
    for (const column of [15, 16, 17, 18, 20, 21, 22, 23]) {
      expect(body).not.toContain(`cells.get(${column})`);
    }
  });

  it("verifies the header before trusting the column map", () => {
    // The sheet is maintained by hand. An inserted column must stop the tool
    // rather than import "sold" as stock.
    expect(body).toContain("EXPECTED_HEADER");
    expect(body).toContain('[COL_AVAILABLE, "D"]');
  });
});

describe("which sheets are opened", () => {
  const body = code(TOOL);

  it("opens only sheets named after a series PortalVault knows", () => {
    // An allowlist, not a filter: `Order 2026` and `EÜR 2025` hold buyer and
    // tax data and are never reached at all (docs/SECURITY.md).
    expect(body).toContain("fetchSeriesCodes");
    expect(body).toContain("readLegacyRows(workbook, seriesCodes)");
    expect(body).not.toContain("Order");
    expect(body).not.toMatch(/E[UÜ]R/);
  });
});

describe("identity", () => {
  const body = code(TOOL);

  it("matches by SKY-ID and never by name", () => {
    // CLAUDE.md rule 2. The name is read for the report and for nothing else.
    expect(body).toContain("const SKY_ID = /^SKY-[0-9]{4}$/;");
    expect(code(PLAN)).toContain("catalog.get(row.skyId)");
    for (const source of [body, code(PLAN)]) {
      expect(source).not.toMatch(/normalize|toLowerCase\(\)|localeCompare\(row\.name/);
    }
  });

  it("creates no catalog row for an unknown SKY-ID", () => {
    expect(body).not.toMatch(/from\("skylanders"\)[\s\S]{0,80}\.(insert|upsert|update)/);
  });
});

describe("what is excluded from the import", () => {
  it("names every exclusion explicitly", () => {
    for (const reason of ["fixture", "not-in-catalog", "software", "inactive"]) {
      expect(code(PLAN)).toContain(`"${reason}"`);
    }
  });

  it("never imports the retained audit fixtures", () => {
    expect(code(PLAN)).toContain('new Set(["SKY-9998", "SKY-9994"])');
  });

  it("excludes console software by the same rule the catalog uses", () => {
    // Not a second copy of the rule: the planner imports it.
    expect(code(PLAN)).toContain("isCollectibleCategory");
    expect(source(PLAN)).toContain('from "../catalog/collectible.ts"');
  });
});

describe("how stock is written", () => {
  const body = code(TOOL);

  it("books movements and writes no table at all", () => {
    // ADR-0037: quantity is only ever moved by apply_inventory_movement(),
    // in the same transaction as its journal row. This tool therefore has
    // exactly one write, and it is an RPC.
    expect(body).toContain('db.rpc("system_record_inventory_movement"');
    expect(body).toContain('p_reason: "initial_import"');
    for (const write of [".insert(", ".update(", ".upsert(", ".delete("]) {
      expect(body).not.toContain(write);
    }
  });

  it("uses the system path, never the administrator's", () => {
    // The browser RPC would record an actor and require a session. This runs
    // as the service role and records created_by NULL.
    expect(body).not.toContain('rpc("record_inventory_movement"');
  });

  it("sets no price and lists nothing", () => {
    // Deciding what to sell and for how much is a separate, manual act
    // (ADR-0037, section 7). There is no derivation from market_price and no
    // percentage anywhere. The words appear only in the report, which says
    // what the import deliberately leaves alone.
    expect(body).not.toContain("set_shop_listing");
    expect(body).not.toContain("p_sale_price");
    expect(body).not.toContain("p_is_listed");
    expect(body).not.toContain("market_price");
  });

  it("books no cost basis", () => {
    // The system function has no cost parameter at all, so this is a
    // property of the database rather than of the script — and the RPC call
    // below could not pass one if it wanted to.
    expect(body).not.toContain("p_unit_cost");
    expect(body).not.toContain("p_currency");
  });

  it("books everything as loose, as a stated assumption", () => {
    expect(code(PLAN)).toContain('export const IMPORT_CONDITION = "loose";');
    // No packaging heuristic over names. The one packaging distinction the
    // legacy data makes is its own SKY-ID.
    for (const source of [body, code(PLAN)]) expect(source).not.toMatch(/OVP|ovp|boxed/);
  });
});

describe("running it twice", () => {
  const body = code(TOOL);
  const plan = code(PLAN);

  it("decides per position, from the ledger", () => {
    // Behaviour is covered in legacy-plan.test.ts. What is asserted here is
    // that the decision has no other input: no counter of what this process
    // did, no run marker, no file on disk.
    expect(plan).toContain("states.get(positionKey(row.skyId, IMPORT_CONDITION))");
    expect(plan).toContain("state?.openingBalance != null");
    expect(plan).toContain("state?.exists");
  });

  it("reads the journal rather than the stock level", () => {
    // A position back at zero has still been imported; importing it again
    // would be a second opening balance for the same stock.
    expect(body).toContain('readAll<{ inventory_id: number; delta: number; reason: string }>');
    expect(body).toContain('"inventory_movements"');
    // And the decision cannot look at a stock level even if it wanted to:
    // the state it is given does not carry one.
    const state = /export type PositionState = \{([\s\S]*?)\n\};/.exec(plan)?.[1] ?? "";
    const fields = [...state.matchAll(/^\s{2}(\w+):/gm)].map((match) => match[1]);
    expect(fields).toEqual(["exists", "movements", "openingBalance"]);
  });

  it("pages every read to exhaustion", () => {
    // PostgREST caps a response at 1000 rows and says nothing about the
    // rest. A truncated journal would make an opened position look
    // un-opened — the exact bug the unique index would then surface as a
    // constraint violation instead of a clean run.
    expect(body).toContain("if (page.length < pageSize) break;");
    expect(body).not.toMatch(/\.from\("inventory_movements"\)\s*\n\s*\.select/);
  });
});

describe("running it at all", () => {
  const body = code(TOOL);

  it("writes nothing without --apply", () => {
    expect(body).toContain("const options: Options = { apply: false");
    expect(body).toContain("if (!options.apply)");
  });

  it("validates to completion before the first write", () => {
    // A rejected input never reaches the database, and a partially valid
    // workbook is not partially imported.
    const guard = body.indexOf("if (problems.length > 0)");
    const apply = body.indexOf("if (!options.apply)");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(apply);
  });
});
