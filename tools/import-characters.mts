/**
 * Character import.
 *
 * Applies the curated file data/characters/characters.json to the database.
 * Deliberately a second, separate path from the catalog import: the catalog
 * comes from the legacy export and is overwritten on every run, while
 * character metadata is hand-curated and must survive that (ADR-0034).
 *
 *   npm run characters:import                        dry run, touches nothing
 *   npm run characters:import -- --validate-only     no database access at all
 *   npm run characters:import -- --apply             writes, after full validation
 *   npm run characters:import -- --input path.json   another curated file
 *
 * Safety properties:
 *   - Validation runs to completion BEFORE any write.
 *   - Nothing is ever deleted, and no character link outside the curated file
 *     is touched. Running this does NOT clear character_id anywhere else.
 *   - Idempotent: re-running writes the same values.
 *   - No name heuristics. A collectible belongs to a character because the
 *     curated file says so, never because the names look alike.
 *
 * The service role is required: `characters` has no write policy and no write
 * grant for any client role (migration 0002).
 */
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { validateCuratedFile, type CuratedCharacter } from "../src/lib/catalog/character.ts";
import { requireStagingIfRequested } from "./lib/staging-guard.mts";

const DEFAULT_INPUT = "data/characters/characters.json";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`\nMissing environment variable: ${name}`);
    console.error("Copy .env.example to .env.local and fill in the values from");
    console.error("Supabase -> Project Settings -> API. See docs/SECURITY.md.\n");
    process.exit(1);
  }
  return value;
}

function heading(text: string): void {
  console.log(`\n${text}`);
  console.log("-".repeat(text.length));
}

function readFlagValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : null;
}

/** Everything the database needs for one character row. */
function toRow(entry: CuratedCharacter): Record<string, unknown> {
  return {
    canonical_name: entry.canonical_name,
    element: entry.element,
    species: entry.species,
    role_type: entry.role_type,
    short_description: entry.short_description,
    source_url: entry.source_url,
    source_label: entry.source_label,
    verified_at: entry.verified_at,
  };
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  /*
   * `--overwrite-admin`: eine im Adminbereich gesetzte Familienzuordnung
   * DOCH ueberschreiben. Ohne das Flag wird sie uebersprungen und benannt
   * (CAT-06 §7) — eine Korrektur, die beim naechsten Importlauf
   * stillschweigend zurueckfiele, waere schlimmer als keine.
   */
  const overwriteAdmin = process.argv.includes("--overwrite-admin");
  const validateOnly = process.argv.includes("--validate-only");
  const inputPath = readFlagValue("--input") ?? DEFAULT_INPUT;

  heading("1. Read");
  const raw: unknown = JSON.parse(readFileSync(inputPath, "utf8"));
  console.log(`  ${inputPath}`);

  // ------------------------------------------------------------ 2. validate
  heading("2. Validate");

  let knownSkyIds = new Set<string>();
  let client: SupabaseClient | null = null;

  if (!validateOnly) {
    // Before the connection exists, not before the write: a staging-only run
    // has no business reading production either, and failing here costs the
    // operator nothing but the validation they were about to run anyway.
    // `--validate-only` opens nothing and is therefore not guarded.
    requireStagingIfRequested("characters:import");
    client = createClient(
      requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data, error } = await client.from("skylanders").select("sky_id");
    if (error) throw new Error(`read skylanders: ${error.message}`);
    knownSkyIds = new Set((data ?? []).map((row) => row.sky_id as string));
    console.log(`  catalog holds ${knownSkyIds.size} figures`);
  } else {
    console.log("  --validate-only: shape only, SKY-IDs are not checked against the catalog");
  }

  const { problems, characters } = validateCuratedFile(raw, knownSkyIds);
  const assignments = characters.flatMap((entry) =>
    entry.sky_ids.map((skyId) => ({ skyId, name: entry.canonical_name })),
  );

  if (problems.length > 0) {
    console.log(`\n  ${problems.length} problem(s):`);
    for (const problem of problems) console.log(`    - ${problem}`);
    throw new Error("the curated file is not valid - nothing was written");
  }
  console.log(`  ${characters.length} characters, ${assignments.length} assignments, no problems`);

  const withoutElement = characters.filter((entry) => entry.element === null);
  const withoutSpecies = characters.filter((entry) => entry.species === null);
  if (withoutElement.length > 0) {
    console.log(
      `  ${withoutElement.length} without element (deliberate null): ${withoutElement.map((entry) => entry.canonical_name).join(", ")}`,
    );
  }
  if (withoutSpecies.length > 0) {
    console.log(
      `  ${withoutSpecies.length} without species (deliberate null): ${withoutSpecies.map((entry) => entry.canonical_name).join(", ")}`,
    );
  }

  if (validateOnly) {
    heading("Result");
    console.log("  VALIDATION ONLY - the database was never opened.");
    return;
  }
  if (!client) throw new Error("unreachable: no client");

  // --------------------------------------------------------------- 3. plan
  heading("3. Plan");

  const { data: existing, error: readError } = await client
    .from("characters")
    .select("id, canonical_name, element, species, role_type, short_description, source_url, source_label, verified_at");
  if (readError) throw new Error(`read characters: ${readError.message}`);

  const byName = new Map(
    (existing ?? []).map((row) => [(row.canonical_name as string).toLowerCase(), row]),
  );
  const newCharacters = characters.filter((entry) => !byName.has(entry.canonical_name.toLowerCase()));
  const changedCharacters = characters.filter((entry) => {
    const row = byName.get(entry.canonical_name.toLowerCase());
    if (!row) return false;
    return Object.entries(toRow(entry)).some(([key, value]) => row[key as keyof typeof row] !== value);
  });
  console.log(
    `  characters   new ${newCharacters.length}, changed ${changedCharacters.length}, unchanged ${characters.length - newCharacters.length - changedCharacters.length}`,
  );

  const { data: linked, error: linkError } = await client
    .from("skylanders")
    .select("sky_id, character_id")
    .in("sky_id", assignments.map((assignment) => assignment.skyId));
  if (linkError) throw new Error(`read links: ${linkError.message}`);

  const currentLink = new Map(
    (linked ?? []).map((row) => [row.sky_id as string, row.character_id as number | null]),
  );
  const unlinked = assignments.filter((assignment) => currentLink.get(assignment.skyId) == null);
  console.log(`  assignments  ${assignments.length} total, ${unlinked.length} not linked yet`);

  /*
   * EINE ADMINENTSCHEIDUNG WIRD NICHT STILL UEBERSCHRIEBEN (CAT-06 §7).
   *
   * Seit `0158` kann ein Plattformadmin `character_id` in der Oberflaeche
   * setzen, und `admin_set_character` schreibt dabei eine Journalzeile
   * `field = 'character_id'`. Diese Datei ist die ERSTKURATIERUNG; die
   * Oberflaeche ist die KORREKTUR. Eine Korrektur, die beim naechsten
   * Importlauf stillschweigend zurueckfiele, waere schlimmer als keine —
   * der Admin saehe sein Ergebnis und spaeter ein anderes, ohne Hinweis.
   *
   * Betroffen ist nur der Fall, in dem die Datei eine ANDERE Familie nennt
   * als die, die der Admin gesetzt hat. Dieselbe Familie noch einmal zu
   * schreiben ist folgenlos.
   *
   * `--overwrite-admin` ist der ausdrueckliche Weg, es doch zu tun. Ohne das
   * Flag wird die Zeile uebersprungen und benannt.
   */
  const { data: journal, error: journalError } = await client
    .from("catalog_admin_changes")
    .select("entity_id, new_value, changed_at")
    .eq("entity", "skylander")
    .eq("field", "character_id")
    .in("entity_id", assignments.map((assignment) => assignment.skyId))
    .order("changed_at", { ascending: true });
  if (journalError) throw new Error(`read journal: ${journalError.message}`);

  /* Die LETZTE Journalzeile je Figur zaehlt — eine frueher zurueckgenommene
     Zuordnung ist keine Entscheidung mehr. */
  const adminGesetzt = new Map<string, number | null>();
  for (const row of journal ?? []) {
    const wert = row.new_value as string | null;
    adminGesetzt.set(row.entity_id as string, wert === null ? null : Number(wert));
  }

  const vomAdminBeruehrt = assignments.filter((a) => adminGesetzt.has(a.skyId));
  console.log(`  admin links  ${vomAdminBeruehrt.length} of them were set in the admin UI`);

  /*
   * DIE ZEILEN, DIE DIESER LAUF VERAENDERN WUERDE, obwohl ein Admin sie
   * gesetzt hat. Verglichen wird gegen den HEUTIGEN Stand der Spalte: nennt
   * die Datei dieselbe Familie, ist nichts zu melden.
   */
  const bedroht: string[] = [];
  for (const entry of characters) {
    for (const skyId of entry.sky_ids) {
      if (!adminGesetzt.has(skyId)) continue;
      const heute = currentLink.get(skyId) ?? null;
      const soll = byName.get(entry.canonical_name.toLowerCase());
      const sollId = soll === undefined ? null : (soll.id as number);
      if (sollId !== null && heute !== null && sollId !== heute) {
        bedroht.push(`${skyId} (admin: ${heute} -> file: ${sollId} ${entry.canonical_name})`);
      }
    }
  }
  if (bedroht.length > 0) {
    console.log("");
    console.log(`  !! ${bedroht.length} admin decision(s) would be overwritten:`);
    for (const z of bedroht) console.log(`     ${z}`);
    if (!overwriteAdmin) {
      console.log("     These are SKIPPED. Re-run with --overwrite-admin to apply them.");
    } else {
      console.log("     --overwrite-admin given: they WILL be overwritten.");
    }
  }
  const uebersprungen = new Set(overwriteAdmin ? [] : bedroht.map((z) => z.split(" ")[0]));

  if (!apply) {
    heading("Result");
    console.log("  DRY RUN - nothing was written.");
    console.log("  Re-run with --apply to write these changes.");
    return;
  }

  // -------------------------------------------------------------- 4. apply
  heading("4. Apply");

  // Upsert on the case-insensitive name index, so a re-run updates rather
  // than duplicating. The surrogate id is never sent: it belongs to the
  // database, and the curated file must not pretend to own it.
  for (const entry of characters) {
    const row = byName.get(entry.canonical_name.toLowerCase());
    const { error } = row
      ? await client.from("characters").update(toRow(entry)).eq("id", row.id as number)
      : await client.from("characters").insert(toRow(entry));
    if (error) throw new Error(`write character ${entry.canonical_name}: ${error.message}`);
  }
  console.log(`  characters: ${newCharacters.length} inserted, ${changedCharacters.length} updated`);

  // Re-read to resolve ids, including the ones just inserted.
  const { data: afterWrite, error: rereadError } = await client
    .from("characters")
    .select("id, canonical_name");
  if (rereadError) throw new Error(`re-read characters: ${rereadError.message}`);
  const idOf = new Map(
    (afterWrite ?? []).map((row) => [(row.canonical_name as string).toLowerCase(), row.id as number]),
  );

  let written = 0;
  for (const entry of characters) {
    const characterId = idOf.get(entry.canonical_name.toLowerCase());
    if (characterId === undefined) {
      throw new Error(`no id for ${entry.canonical_name} after write - aborting`);
    }
    // Only the curated SKY-IDs are touched. Every other row keeps whatever
    // character_id it has, including NULL. This import never clears links.
    /* Was ein Admin anders entschieden hat, bleibt draussen — es sei denn,
       `--overwrite-admin` sagt ausdruecklich etwas anderes. */
    const ziele = entry.sky_ids.filter((id) => !uebersprungen.has(id));
    if (ziele.length === 0) continue;
    const { error } = await client
      .from("skylanders")
      .update({ character_id: characterId })
      .in("sky_id", ziele);
    if (error) throw new Error(`link ${entry.canonical_name}: ${error.message}`);
    written += ziele.length;
  }
  console.log(`  assignments: ${written} figures linked`);

  heading("Result");
  console.log("  Applied.");
}

main().catch((error: unknown) => {
  console.error(`\nCharacter import aborted: ${error instanceof Error ? error.message : error}`);
  console.error("Nothing was written unless the log above says otherwise.");
  process.exit(1);
});
