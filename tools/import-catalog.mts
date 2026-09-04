/**
 * V1.3 — catalog import.
 *
 * Reads the validated public export of the legacy project and upserts series,
 * categories and figures into PortalVault. Identity is always the SKY-ID;
 * nothing is ever matched by name (ADR-0001, ADR-0004).
 *
 *   npm run catalog:import                       dry run, touches nothing
 *   npm run catalog:import -- --validate-only    no database access at all
 *   npm run catalog:import -- --apply            writes, after full validation
 *
 * Safety properties:
 *   - Validation runs to completion BEFORE any write. A rejected input never
 *     reaches the database.
 *   - Writes are idempotent upserts keyed by sky_id, series code and
 *     (series, category name), so re-running finishes an interrupted run.
 *   - Nothing is ever deleted. Figures missing from the export are reported
 *     and left untouched (docs/SKYLANDERS_DATA.md, import rule 3).
 *   - profiles and collection_items are never touched.
 *
 * The service role is required because the catalog is deliberately not
 * writable by any client role (ADR-0016).
 */
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { assignSlugs, seriesSlug } from "../src/lib/catalog/slug.ts";

const DEFAULT_INPUT = "data/catalog/products.json";
const IMAGE_DIR = "public/images/skylanders";

const SKY_ID = /^SKY-[0-9]{4}$/;
const IMAGE_FILE = /^[0-9a-f]{16}\.webp$/;
const SERIES_CODE = /^[A-Z]{1,4}$/;

/** Fields the export carries but PortalVault deliberately never stores. */
const NOT_IMPORTED = ["available", "ebay"] as const;

// --------------------------------------------------------------- input shapes

type ExportSeries = { code: string; label: string; year: number; categories: string[] };
type ExportItem = {
  id: string;
  name: string;
  series: string;
  category: string;
  categoryIndex: number;
  price: number | null;
  image: string | null;
};
type ExportFile = {
  generated: string;
  currency: string;
  series: ExportSeries[];
  items: ExportItem[];
};

// ------------------------------------------------------------------ reporting

const problems: string[] = [];
const warnings: string[] = [];

function fail(message: string): void {
  problems.push(message);
}

function warn(message: string): void {
  warnings.push(message);
}

function heading(text: string): void {
  console.log(`\n${text}\n${"-".repeat(text.length)}`);
}

function money(value: number | null): string {
  return value === null ? "-" : value.toFixed(2);
}

// ----------------------------------------------------------------- validation

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Structural validation. Returns null when the shape is unusable. */
function parseExport(raw: unknown): ExportFile | null {
  if (!isRecord(raw)) {
    fail("input is not a JSON object");
    return null;
  }
  if (!Array.isArray(raw.series) || !Array.isArray(raw.items)) {
    fail("input is missing the 'series' or 'items' array");
    return null;
  }
  for (const [index, entry] of raw.series.entries()) {
    if (
      !isRecord(entry) ||
      typeof entry.code !== "string" ||
      typeof entry.label !== "string" ||
      typeof entry.year !== "number" ||
      !Array.isArray(entry.categories)
    ) {
      fail(`series[${index}]: expected { code, label, year, categories[] }`);
      return null;
    }
  }
  for (const [index, entry] of raw.items.entries()) {
    if (
      !isRecord(entry) ||
      typeof entry.id !== "string" ||
      typeof entry.name !== "string" ||
      typeof entry.series !== "string" ||
      typeof entry.category !== "string" ||
      typeof entry.categoryIndex !== "number"
    ) {
      fail(`items[${index}]: expected { id, name, series, category, categoryIndex, ... }`);
      return null;
    }
  }
  return raw as unknown as ExportFile;
}

function validate(data: ExportFile): void {
  // --- series -------------------------------------------------------------
  const seriesCodes = new Set<string>();
  for (const series of data.series) {
    if (!SERIES_CODE.test(series.code)) {
      fail(`series ${series.code}: code violates ^[A-Z]{1,4}$`);
    }
    if (series.label.trim() === "") fail(`series ${series.code}: empty label`);
    if (series.year < 1990 || series.year > 2100) {
      fail(`series ${series.code}: year ${series.year} out of range`);
    }
    if (seriesCodes.has(series.code)) fail(`series ${series.code}: duplicate code`);
    seriesCodes.add(series.code);
  }

  const bySlug = new Map<string, string>();
  for (const series of data.series) {
    const slug = seriesSlug(series.label);
    const clash = bySlug.get(slug);
    if (clash) fail(`series ${series.code} and ${clash} share the slug '${slug}'`);
    bySlug.set(slug, series.code);
  }

  // --- identity -----------------------------------------------------------
  const firstSeen = new Map<string, number>();
  data.items.forEach((item, index) => {
    if (!SKY_ID.test(item.id)) fail(`${item.id}: SKY-ID violates ^SKY-[0-9]{4}$`);
    const earlier = firstSeen.get(item.id);
    if (earlier !== undefined) {
      fail(`${item.id}: duplicate SKY-ID (items[${earlier}] and items[${index}])`);
    } else {
      firstSeen.set(item.id, index);
    }
  });

  // --- per item -----------------------------------------------------------
  for (const item of data.items) {
    if (item.name.trim() === "") fail(`${item.id}: empty name`);
    if (!seriesCodes.has(item.series)) fail(`${item.id}: unknown series '${item.series}'`);

    const series = data.series.find((s) => s.code === item.series);
    if (series) {
      const position = series.categories.indexOf(item.category);
      if (position === -1) {
        fail(`${item.id}: category '${item.category}' not declared for series ${item.series}`);
      } else if (position !== item.categoryIndex) {
        fail(
          `${item.id}: categoryIndex ${item.categoryIndex} does not match position ${position} of '${item.category}'`,
        );
      }
    }

    if (item.price !== null) {
      if (typeof item.price !== "number" || !Number.isFinite(item.price)) {
        fail(`${item.id}: price is not a finite number`);
      } else if (item.price <= 0) {
        // ADR-0010: null means unknown, 0 must never stand in for it.
        fail(`${item.id}: price ${item.price} must be greater than 0, or null`);
      } else if (Math.round(item.price * 100) !== Math.round(item.price * 100 * 1000) / 1000) {
        fail(`${item.id}: price ${item.price} has more than two decimals`);
      }
    }

    if (item.image !== null && !IMAGE_FILE.test(item.image)) {
      fail(`${item.id}: image '${item.image}' violates the content-addressed webp pattern`);
    }
  }

  // --- images on disk -----------------------------------------------------
  const referenced = new Set(
    data.items.map((i) => i.image).filter((i): i is string => i !== null),
  );
  const missing: string[] = [];
  let present = 0;
  for (const file of referenced) {
    try {
      readFileSync(`${IMAGE_DIR}/${file}`);
      present += 1;
    } catch {
      missing.push(file);
    }
  }
  console.log(`  images referenced: ${referenced.size}, present under ${IMAGE_DIR}/: ${present}`);
  if (missing.length > 0) {
    warn(
      `${missing.length} referenced image file(s) are not on disk yet ` +
        `(e.g. ${missing.slice(0, 3).join(", ")}). The database stores file names, ` +
        `so this does not block the import, but the catalog UI would show gaps.`,
    );
  }
}

// -------------------------------------------------------------------- helpers

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`\nMissing environment variable: ${name}`);
    console.error("Copy .env.example to .env.local and fill it in, or use --validate-only.\n");
    process.exit(1);
  }
  return value;
}

function serviceClient(): SupabaseClient {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

type PlannedFigure = {
  sky_id: string;
  name: string;
  slug: string;
  series_code: string;
  category_id: number;
  market_price: number | null;
  image_file: string | null;
  is_active: boolean;
};

// ----------------------------------------------------------------------- main

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const validateOnly = args.includes("--validate-only");
  const mode = apply ? "APPLY" : validateOnly ? "VALIDATE ONLY" : "DRY RUN";

  // --input exists so the validator can be exercised against deliberately
  // broken fixtures without touching the real export.
  const inputFlag = args.indexOf("--input");
  const INPUT = inputFlag === -1 ? DEFAULT_INPUT : (args[inputFlag + 1] ?? DEFAULT_INPUT);

  console.log(`PortalVault catalog import - ${mode}`);

  // ------------------------------------------------------------ 1. read input
  heading("1. Input");
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(INPUT, "utf8"));
  } catch (error) {
    console.error(`  cannot read ${INPUT}: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
  const data = parseExport(raw);
  if (!data) {
    console.error("\nInput rejected:");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log(`  ${INPUT}`);
  console.log(`  generated ${data.generated}, currency ${data.currency}`);
  console.log(`  ${data.series.length} series, ${data.items.length} items`);

  // -------------------------------------------------------------- 2. validate
  heading("2. Validation");
  validate(data);
  const priced = data.items.filter((i) => i.price !== null).length;
  const imaged = data.items.filter((i) => i.image !== null).length;
  console.log(`  items with a price: ${priced}, without: ${data.items.length - priced}`);
  console.log(`  items with an image: ${imaged}, without: ${data.items.length - imaged}`);
  console.log(`  fields never imported: ${NOT_IMPORTED.join(", ")} (ADR-0008)`);

  if (problems.length > 0) {
    console.error(`\n${problems.length} validation error(s) - nothing was written:`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log(`  validation passed with ${warnings.length} warning(s)`);
  for (const warning of warnings) console.log(`  ! ${warning}`);

  // ----------------------------------------------------------------- 3. slugs
  heading("3. Slugs (ADR-0011)");
  const client = validateOnly ? null : serviceClient();

  let existingSlugs = new Map<string, string>();
  if (client) {
    const { data: rows, error } = await client.from("skylanders").select("sky_id, slug");
    if (error) {
      console.error(`  cannot read existing figures: ${error.message}`);
      process.exit(1);
    }
    existingSlugs = new Map((rows ?? []).map((row) => [row.sky_id as string, row.slug as string]));
    console.log(`  figures already in the database: ${existingSlugs.size}`);
  } else {
    console.log("  no database access (--validate-only): every figure treated as new");
  }

  const labelOf = new Map(data.series.map((s) => [s.code, s.label]));
  const assignments = assignSlugs(
    data.items.map((item) => ({
      skyId: item.id,
      name: item.name,
      seriesLabel: labelOf.get(item.series) ?? item.series,
    })),
    existingSlugs,
  );
  const slugOf = new Map(assignments.map((a) => [a.skyId, a.slug]));

  const stages = { name: 0, series: 0, "sky-id": 0, existing: 0 };
  for (const assignment of assignments) stages[assignment.stage] += 1;
  console.log(`  stage 1, from the name:            ${stages.name}`);
  console.log(`  stage 2, qualified with the series: ${stages.series}`);
  console.log(`  stage 3, qualified with the SKY-ID: ${stages["sky-id"]}`);
  console.log(`  kept from the database:             ${stages.existing}`);

  const unique = new Set(slugOf.values());
  if (unique.size !== data.items.length) {
    console.error(`  slug collision: ${data.items.length} items produced only ${unique.size} slugs`);
    process.exit(1);
  }
  console.log(`  ${unique.size} unique slugs for ${data.items.length} items`);

  if (validateOnly || !client) {
    heading("Result");
    console.log("  Validation passed. No database was contacted.");
    return;
  }

  // ------------------------------------------------------------- 4. plan diff
  heading("4. Planned changes");

  const { data: dbSeries, error: seriesError } = await client.from("series").select("*");
  if (seriesError) throw new Error(`read series: ${seriesError.message}`);
  const haveSeries = new Map((dbSeries ?? []).map((row) => [row.code as string, row]));

  const newSeries = data.series.filter((s) => !haveSeries.has(s.code));
  const changedSeries = data.series.filter((s) => {
    const row = haveSeries.get(s.code);
    return row !== undefined && (row.label !== s.label || row.release_year !== s.year);
  });

  const { data: dbCategories, error: categoryError } = await client.from("categories").select("*");
  if (categoryError) throw new Error(`read categories: ${categoryError.message}`);
  const haveCategory = new Map(
    (dbCategories ?? []).map((row) => [`${row.series_code as string} ${row.name as string}`, row]),
  );

  type PlannedCategory = { series_code: string; name: string; position: number };
  const wantCategories: PlannedCategory[] = [];
  for (const series of data.series) {
    series.categories.forEach((name, index) => {
      wantCategories.push({ series_code: series.code, name, position: index });
    });
  }
  const newCategories = wantCategories.filter(
    (c) => !haveCategory.has(`${c.series_code} ${c.name}`),
  );
  const changedCategories = wantCategories.filter((c) => {
    const row = haveCategory.get(`${c.series_code} ${c.name}`);
    return row !== undefined && row.position !== c.position;
  });

  const { data: dbFigures, error: figureError } = await client.from("skylanders").select("*");
  if (figureError) throw new Error(`read skylanders: ${figureError.message}`);
  const haveFigure = new Map((dbFigures ?? []).map((row) => [row.sky_id as string, row]));

  const unchangedSeries = data.series.length - newSeries.length - changedSeries.length;
  const unchangedCategories = wantCategories.length - newCategories.length - changedCategories.length;
  console.log(`  series      new ${newSeries.length}, changed ${changedSeries.length}, unchanged ${unchangedSeries}`);
  console.log(`  categories  new ${newCategories.length}, changed ${changedCategories.length}, unchanged ${unchangedCategories}`);

  const newFigures = data.items.filter((item) => !haveFigure.has(item.id));
  const figureChanges: string[] = [];
  const slugDrift: string[] = [];
  for (const item of data.items) {
    const row = haveFigure.get(item.id);
    if (!row) continue;

    const diffs: string[] = [];
    if (row.name !== item.name) diffs.push(`name '${row.name as string}' -> '${item.name}'`);
    const storedPrice = row.market_price === null ? null : Number(row.market_price);
    if (storedPrice !== item.price) {
      diffs.push(`price ${money(storedPrice)} -> ${money(item.price)}`);
    }
    if (row.image_file !== item.image) {
      diffs.push(`image ${(row.image_file as string | null) ?? "-"} -> ${item.image ?? "-"}`);
    }
    if (row.series_code !== item.series) {
      diffs.push(`series ${row.series_code as string} -> ${item.series}`);
    }
    if (diffs.length > 0) figureChanges.push(`${item.id}  ${diffs.join(", ")}`);

    const wanted = slugOf.get(item.id);
    if (wanted !== undefined && row.slug !== wanted) {
      slugDrift.push(`${item.id}  stored '${row.slug as string}', the name would now yield '${wanted}'`);
    }
  }
  const missingFromExport = (dbFigures ?? []).filter(
    (row) => !data.items.some((item) => item.id === (row.sky_id as string)),
  );

  const unchangedFigures = data.items.length - newFigures.length - figureChanges.length;
  console.log(`  figures     new ${newFigures.length}, changed ${figureChanges.length}, unchanged ${unchangedFigures}`);

  if (figureChanges.length > 0) {
    console.log("\n  changed figures:");
    for (const line of figureChanges.slice(0, 30)) console.log(`    ${line}`);
    if (figureChanges.length > 30) console.log(`    ... and ${figureChanges.length - 30} more`);
  }
  if (slugDrift.length > 0) {
    console.log(`\n  ! ${slugDrift.length} figure(s) whose name no longer matches the stored slug.`);
    console.log("    The stored slug wins and stays untouched (ADR-0011).");
    for (const line of slugDrift.slice(0, 10)) console.log(`      ${line}`);
  }
  if (missingFromExport.length > 0) {
    console.log(`\n  ! ${missingFromExport.length} figure(s) in the database but not in the export.`);
    console.log("    Nothing is deleted. Review them manually.");
    for (const row of missingFromExport.slice(0, 10)) {
      console.log(`      ${row.sky_id as string}  ${row.name as string}`);
    }
  }

  if (!apply) {
    heading("Result");
    console.log("  DRY RUN - nothing was written.");
    console.log("  Re-run with --apply to write these changes.");
    return;
  }

  // ----------------------------------------------------------------- 5. apply
  heading("5. Apply");

  if (newSeries.length > 0 || changedSeries.length > 0) {
    const payload = data.series.map((series, index) => ({
      code: series.code,
      label: series.label,
      release_year: series.year,
      position: index,
    }));
    const { error } = await client.from("series").upsert(payload, { onConflict: "code" });
    if (error) throw new Error(`write series: ${error.message}`);
    console.log(`  series: ${payload.length} rows upserted`);
  } else {
    console.log("  series: nothing to do");
  }

  if (newCategories.length > 0 || changedCategories.length > 0) {
    for (const category of newCategories) {
      const { error } = await client.from("categories").insert(category);
      if (error) {
        throw new Error(`insert category ${category.series_code}/${category.name}: ${error.message}`);
      }
    }
    for (const category of changedCategories) {
      const { error } = await client
        .from("categories")
        .update({ position: category.position })
        .eq("series_code", category.series_code)
        .eq("name", category.name);
      if (error) {
        throw new Error(`update category ${category.series_code}/${category.name}: ${error.message}`);
      }
    }
    console.log(`  categories: ${newCategories.length} inserted, ${changedCategories.length} updated`);
  } else {
    console.log("  categories: nothing to do");
  }

  const { data: allCategories, error: rereadError } = await client
    .from("categories")
    .select("id, series_code, name");
  if (rereadError) throw new Error(`re-read categories: ${rereadError.message}`);
  const categoryId = new Map(
    (allCategories ?? []).map((row) => [
      `${row.series_code as string} ${row.name as string}`,
      row.id as number,
    ]),
  );

  const figures: PlannedFigure[] = [];
  for (const item of data.items) {
    const id = categoryId.get(`${item.series} ${item.category}`);
    if (id === undefined) {
      throw new Error(`${item.id}: no category id for ${item.series}/${item.category} - aborting before write`);
    }
    figures.push({
      sky_id: item.id,
      name: item.name,
      slug: slugOf.get(item.id) as string,
      series_code: item.series,
      category_id: id,
      market_price: item.price,
      image_file: item.image,
      is_active: true,
    });
  }

  const CHUNK = 200;
  let written = 0;
  for (let offset = 0; offset < figures.length; offset += CHUNK) {
    const chunk = figures.slice(offset, offset + CHUNK);
    const { error } = await client.from("skylanders").upsert(chunk, { onConflict: "sky_id" });
    if (error) throw new Error(`write figures at offset ${offset}: ${error.message}`);
    written += chunk.length;
    console.log(`  figures: ${written}/${figures.length}`);
  }

  heading("Result");
  console.log("  Applied.");
}

main().catch((error: unknown) => {
  console.error(`\nImport aborted: ${error instanceof Error ? error.message : error}`);
  console.error("The import is idempotent - fix the cause and run it again.");
  process.exit(1);
});
