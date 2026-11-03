import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * No marketplace report and no data export is ever tracked.
 *
 * THE INCIDENT THIS EXISTS FOR.
 *
 * On 2026-10-25 nine eBay order reports (`resources/ebay/2026/*.csv`) went into
 * a documentation commit and were pushed to `main`. Each carries buyer names,
 * addresses, phone numbers and tracking numbers — exactly what CLAUDE.md rule
 * 3 forbids. Nothing noticed: `.gitignore` had no rule for CSV, and no test
 * looked at what Git tracks. They were removed from tracking and from the
 * history on 2026-11-03; the reports now live under ~/SkyIsles-Daten/.
 *
 * Three guards, because each catches what the others miss:
 *
 *   1. the tracked tree has no CSV/TSV and no eBay report by name;
 *   2. no tracked text file carries the eBay report header — a report renamed
 *      to `.txt` or pasted into a fixture is still a report;
 *   3. `.gitignore` still ignores the names an export arrives under.
 */

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" });
}

const TRACKED = git("ls-files", "-z").split("\0").filter(Boolean);

/*
 * The header of an eBay "Orders Report", split so that this file does not
 * match its own search. Two columns together, never one: a single German word
 * can appear in a UI string, the pair only in a report.
 */
const REPORT_SIGNATURE = ["Verkaufsprotokoll" + "nummer", "Nutzername des " + "Käufers"];

describe("the repository tracks no marketplace reports or data exports", () => {
  it("sees the tracked tree", () => {
    // A guard on the guard: outside a checkout the list would be empty.
    expect(TRACKED.length).toBeGreaterThan(500);
  });

  it("tracks no CSV, TSV or eBay report", () => {
    const offending = TRACKED.filter(
      (path) => /\.(csv|tsv)$/i.test(path) || /OrdersReport/i.test(path) || path.startsWith("resources/ebay/"),
    );
    expect(offending).toEqual([]);
  });

  it("has no tracked text file carrying the eBay report header", () => {
    const offending: string[] = [];
    for (const path of TRACKED) {
      if (!/\.(txt|md|json|ts|tsx|mts|js|sql|py|html|csv|tsv)$/i.test(path)) continue;
      let text: string;
      try {
        text = readFileSync(path, "utf8");
      } catch {
        continue; // deleted in the working tree, not yet committed
      }
      if (REPORT_SIGNATURE.every((column) => text.includes(column))) offending.push(path);
    }
    expect(offending).toEqual([]);
  });

  it("keeps ignoring the names a report or export arrives under", () => {
    const samples = [
      "resources/ebay/2026/eBay-OrdersReport-Oct-25-2026-03-49-26-0700-12355204368.csv",
      "production-ebay-sales.csv",
      "staging-ebay-sales.csv",
      "exports/sales.tsv",
    ];
    // `check-ignore` prints every ignored path; `--no-index` judges the rules
    // alone, so a tracked file could not hide a missing rule.
    let ignored = "";
    try {
      ignored = git("check-ignore", "--no-index", ...samples);
    } catch {
      // exit code 1 means "none ignored" — the assertion below reports it
    }
    expect(ignored.trim().split("\n").sort()).toEqual([...samples].sort());
  });
});
