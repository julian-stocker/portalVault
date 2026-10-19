/**
 * Checksums over the files that must not change unnoticed.
 *
 * WHY THIS EXISTS
 *
 * `0130` was executed on Staging and then edited. Nothing noticed, because
 * `0126`-`0131` were not committed and the only checksum list covered
 * `supabase/checks/` alone. A migration that is applied and then changed looks
 * afterwards exactly like the one that ran — and is not.
 *
 * So: one list, two folders, one command. `--check` is the gate before any
 * execution on Staging or Production; `--write` is how the list is renewed
 * after a deliberate change, and the diff then shows it.
 *
 * NO NETWORK, NO DATABASE, NO SECRETS. It reads files and prints digests.
 * `src/lib/admin/migration-integrity.test.ts` recomputes the same list in the
 * suite, so a forgotten `--write` fails the build rather than rotting quietly.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

/** Repo-relative, so the list is checked from the repository root. */
export const LIST = "supabase/SHA256SUMS.txt";

/** Folder → which extensions belong in the list. */
const COVERED: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["supabase/migrations", [".sql", ".md"]],
  /* `.json` seit 2026-10-19: `staging-suite.json` entscheidet, welche
     Prüfdateien automatisch gegen Staging laufen, und daraus leitet sich die
     Rechteliste des Prüfzugangs ab. Eine unbemerkte Änderung daran wäre
     folgenreicher als an mancher Prüfdatei. */
  ["supabase/checks", [".sql", ".md", ".json"]],
  /* Die rein lesenden Abfragen des Wiederherstellungstests laufen gegen
     Production — sie gehören genauso gegen unbemerkte Änderung geschützt. */
  ["supabase/checks/dr", [".sql"]],
  /* Betriebliche Schalter: keine Migrationen, aber sie ÄNDERN Production.
     Erst recht gegen unbemerkte Änderung zu schützen. */
  ["supabase/operations", [".sql", ".md"]],
];

export function coveredFiles(): string[] {
  const out: string[] = [];
  for (const [dir, exts] of COVERED) {
    for (const name of readdirSync(dir)) {
      if (!exts.some((e) => name.endsWith(e))) continue;
      const path = `${dir}/${name}`;
      if (path === LIST) continue;            // a list cannot contain itself
      out.push(path);
    }
  }
  return out.sort();
}

export function digestOf(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** The exact text of the list: `<digest>  <path>`, one per line, sorted. */
export function render(): string {
  return coveredFiles().map((p) => `${digestOf(p)}  ${p}`).join("\n") + "\n";
}

/** Parses a list back into path → digest. Tolerates nothing: format or bust. */
export function parse(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const m = /^([0-9a-f]{64})  (\S.*)$/.exec(line);
    if (m === null) throw new Error(`unparsable line: ${line}`);
    out.set(m[2], m[1]);
  }
  return out;
}

function main(): void {
  const mode = process.argv[2];
  if (mode === "--write") {
    writeFileSync(LIST, render(), "utf8");
    console.log(`${LIST}: ${coveredFiles().length} Dateien geschrieben`);
    return;
  }
  if (mode === "--check") {
    const soll = parse(readFileSync(LIST, "utf8"));
    const ist = new Map(coveredFiles().map((p) => [p, digestOf(p)]));
    const fehlend = [...ist.keys()].filter((p) => !soll.has(p));
    const ueberzaehlig = [...soll.keys()].filter((p) => !ist.has(p));
    const abweichend = [...ist].filter(([p, d]) => soll.has(p) && soll.get(p) !== d);
    for (const p of fehlend) console.error(`nicht in der Liste: ${p}`);
    for (const p of ueberzaehlig) console.error(`in der Liste, aber nicht da: ${p}`);
    for (const [p] of abweichend) console.error(`Pruefsumme weicht ab: ${p}`);
    if (fehlend.length + ueberzaehlig.length + abweichend.length > 0) {
      console.error(
        "\nAbsichtliche Aenderung? Dann `npm run sums:write` und den Diff mitcommitten.");
      process.exit(1);
    }
    console.log(`${LIST}: ${ist.size} Dateien, alle Pruefsummen stimmen`);
    return;
  }
  console.error("Aufruf: node tools/checksums.mts --check | --write");
  process.exit(2);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
