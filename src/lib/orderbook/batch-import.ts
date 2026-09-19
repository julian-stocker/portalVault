/**
 * Importing historical purchases in bulk (ADR-0088).
 *
 * The pilot was applied by a one-off script. That was the right way to move
 * one parcel and the wrong way to move eighty-five: a script that exists once
 * is a script nobody can test, and the part of it worth trusting — which group
 * is which, what has already been imported, what must never be written — was
 * never written down anywhere a test could reach.
 *
 * WHAT THIS IS AND IS NOT
 *
 * It is the planning and orchestration. It decides what would happen and in
 * what order, and it hands each group to the database one at a time.
 *
 * It is NOT a second way to insert a purchase. `seller_import_purchase_group()`
 * is the only writer; it is `security definer`, seller-gated, and it is what
 * guarantees every imported item lands `reconciled_legacy` with no movement.
 * Reimplementing any of that in TypeScript would move a guarantee from a place
 * the database enforces to a place a caller can forget.
 *
 * PREVIEW AND APPLY ARE DIFFERENT READS OF THE FILE
 *
 * A preview is not a command. `applyBatch` is given freshly classified plans,
 * not the plan objects a preview printed ten minutes ago — the same principle
 * the inventory importer already follows, and for the same reason: the workbook
 * is a file on someone's disk and can change between the two.
 */
import {
  classifyGroup,
  type CatalogEntry, type ClassifiedItem, type GroupPreview, type PurchaseGroup,
} from "./order-2026.ts";

/**
 * Bumping this makes every group look new, so it never changes casually.
 *
 * It is the string the pilot was imported with. Its exact value is load-bearing
 * in a way a version constant usually is not: purchase #6 carries a fingerprint
 * computed from it, and changing the scheme would make the workbook group that
 * is already in the database look unimported and invite a duplicate.
 */
export const PURCHASE_FINGERPRINT_VERSION = "orderbuch-order2026-1";

/**
 * What makes two workbook groups the same purchase.
 *
 * The sheet, the group's own header row, its date, its Ausgaben, and one tuple
 * per SOURCE row — every row, including the damaged ones that will not be
 * migrated. That last point is deliberate: the fingerprint answers "is this the
 * same parcel?", and the parcel did contain those rows. Keying it on the
 * migrated subset would mean a change to the damage rule made every already
 * imported purchase look new.
 *
 * A KNOWN WEAKNESS, KEPT ON PURPOSE. `skyId` is part of the tuple, so a group's
 * fingerprint moves if the catalog is renamed underneath it — the inventory
 * fingerprint deliberately avoids exactly that by hashing before resolution.
 * This one cannot be fixed without orphaning purchase #6, whose fingerprint is
 * already stored. Recording it here rather than discovering it later.
 */
export function canonicalPurchaseIdentity(
  group: Pick<PurchaseGroup, "headerRow" | "date" | "totalCost">,
  rows: readonly ClassifiedItem[],
): string {
  return JSON.stringify([
    PURCHASE_FINGERPRINT_VERSION, "Order 2026", group.headerRow, group.date, group.totalCost,
    rows.map((i) => [i.sourceRow, i.rawName, i.legacyConditionFlag, i.legacyBookedFlag, i.skyId]),
  ]);
}

/** SHA-256 of that text, 64 lowercase hex characters. */
export async function purchaseFingerprint(
  group: Pick<PurchaseGroup, "headerRow" | "date" | "totalCost">,
  rows: readonly ClassifiedItem[],
): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalPurchaseIdentity(group, rows));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** One row of the `p_items` payload, exactly as `0053` reads it. */
export type PayloadItem = {
  position: number;
  sky_id: string | null;
  raw_name: string;
  condition: "loose";
  legacy_condition_flag: string | null;
  legacy_booked_flag: string | null;
  source_row: number;
};

/**
 * The payload, built from the MIGRATED rows only.
 *
 * `condition` is always `loose`: the model knows `loose | boxed` and nothing
 * about damage, which is moot here because a damaged row never reaches this
 * function. Guessing `boxed` from a name would be inventing provenance.
 */
export function buildPayload(migrated: readonly ClassifiedItem[]): PayloadItem[] {
  return migrated.map((item) => ({
    position: item.position,
    sky_id: item.skyId,
    raw_name: item.rawName,
    condition: "loose" as const,
    legacy_condition_flag: item.legacyConditionFlag || null,
    legacy_booked_flag: item.legacyBookedFlag || null,
    source_row: item.sourceRow,
  }));
}

/** The German note stored on the purchase, so a row can be found in Excel. */
export function sourceNote(
  group: Pick<PurchaseGroup, "headerRow" | "firstRow" | "lastRow" | "date" | "rawDate">,
): string {
  const where = `Order 2026, Kopfzeile ${group.headerRow}, Zeilen ${group.firstRow}–${group.lastRow}`;
  // The workbook's own broken date, kept verbatim. It is why the purchase has
  // none — and the only trace of it left, since the cell it referenced is gone.
  return group.date === null ? `${where} · Kaufdatum im Workbook: ${group.rawDate || "leer"}` : where;
}

export type PlanStatus =
  /** New, complete, and ready to write. */
  | "eligible"
  /** Its fingerprint is already on a purchase. Nothing to do, and not an error. */
  | "already_imported"
  /** Something is wrong with the source. Never written, always reported. */
  | "blocked";

export type GroupPlan = {
  headerRow: number;
  firstRow: number;
  lastRow: number;
  date: string | null;
  totalCost: number | null;
  fingerprint: string;
  note: string;
  status: PlanStatus;
  /** Why, when the status is not `eligible`. */
  reason: string | null;
  preview: GroupPreview;
  payload: PayloadItem[];
};

export type PlanDeps = {
  stockName: (sheet: string, row: number) => string | null;
  bySheetName: Map<string, CatalogEntry[]>;
  mappings: Map<string, string | null>;
  /** Fingerprints already on `purchases`. */
  imported: ReadonlySet<string>;
};

/**
 * Decide what one group is, without touching anything.
 *
 * A group is blocked when its own source is unsound: no cost, nothing left to
 * import, or Excel error values where the item names should be. None of those
 * is something an operator could fix from the screen.
 *
 * A MISSING DATE IS NOT ONE OF THEM, AND USED TO BE.
 *
 * Thirteen groups carry `#REF!` where their date formula was, and this
 * function refused them for it. That was right while a purchase meant a
 * purchase with a date; the owner has since decided otherwise, and he is
 * right — the money was spent and the goods arrived, and the only missing
 * thing is a number he can supply later. So the group imports with
 * `purchased_at` NULL, which is the one value that is true, and the `#REF!`
 * rides along in the note as provenance.
 *
 * What is still refused: inventing the date. Not the neighbouring group's, not
 * January the first, not the day the import ran.
 */
export async function planGroup(group: PurchaseGroup, deps: PlanDeps): Promise<GroupPlan> {
  const preview = classifyGroup(group.items, deps.stockName, deps.bySheetName, deps.mappings);
  const fingerprint = await purchaseFingerprint(group, preview.all);
  const payload = buildPayload(preview.migrated);

  let status: PlanStatus = "eligible";
  let reason: string | null = null;

  if (deps.imported.has(fingerprint)) {
    status = "already_imported";
    reason = "Fingerabdruck bereits vergeben";
  } else if (group.totalCost === null) {
    status = "blocked";
    reason = "keine Ausgaben in Spalte B";
  } else if (preview.invalid.length > 0) {
    // Asked before "nothing to import": a group of nothing but error values is
    // a broken source, and saying so is more useful than saying it is empty.
    status = "blocked";
    reason = `${preview.invalid.length} Excel-Fehlerwert(e) in Spalte F`;
  } else if (payload.length === 0) {
    status = "blocked";
    reason = "keine übernehmbare Position";
  }

  return {
    headerRow: group.headerRow, firstRow: group.firstRow, lastRow: group.lastRow,
    date: group.date, totalCost: group.totalCost,
    fingerprint, note: sourceNote(group), status, reason, preview, payload,
  };
}

export type BatchPlan = {
  plans: GroupPlan[];
  eligible: GroupPlan[];
  alreadyImported: GroupPlan[];
  blocked: GroupPlan[];
  totals: {
    groups: number; sourceRows: number; migrated: number;
    ignoredDamaged: number; invalid: number;
    matched: number; uncategorized: number; unmatched: number; ambiguous: number;
    byFormula: number; byMapping: number;
    /** Ausgaben of the eligible groups only — what this run would record. */
    cost: number;
  };
};

/** Plan a whole batch, in worksheet order. */
export async function planBatch(
  groups: readonly PurchaseGroup[],
  deps: PlanDeps,
): Promise<BatchPlan> {
  const plans: GroupPlan[] = [];
  for (const group of groups) plans.push(await planGroup(group, deps));

  const totals = {
    groups: plans.length, sourceRows: 0, migrated: 0, ignoredDamaged: 0, invalid: 0,
    matched: 0, uncategorized: 0, unmatched: 0, ambiguous: 0,
    byFormula: 0, byMapping: 0, cost: 0,
  };
  for (const plan of plans) {
    const p = plan.preview;
    totals.sourceRows += p.sourceRows;
    totals.migrated += p.migrated.length;
    totals.ignoredDamaged += p.ignoredDamaged.length;
    totals.invalid += p.invalid.length;
    totals.matched += p.byClassification.matched;
    totals.uncategorized += p.byClassification.uncategorized;
    totals.unmatched += p.byClassification.unmatched;
    totals.ambiguous += p.byClassification.ambiguous;
    totals.byFormula += p.byEvidence.formula;
    totals.byMapping += p.byEvidence.mapping;
    if (plan.status === "eligible") totals.cost += plan.totalCost ?? 0;
  }

  return {
    plans,
    eligible: plans.filter((p) => p.status === "eligible"),
    alreadyImported: plans.filter((p) => p.status === "already_imported"),
    blocked: plans.filter((p) => p.status === "blocked"),
    totals,
  };
}

export type GroupOutcome =
  | { headerRow: number; fingerprint: string; outcome: "imported"; purchaseId: number }
  | { headerRow: number; fingerprint: string; outcome: "already_imported" }
  | { headerRow: number; fingerprint: string; outcome: "failed"; message: string };

export type ApplyResult = {
  results: GroupOutcome[];
  imported: number;
  skipped: number;
  /** The group that stopped the run, if one did. */
  failedAt: number | null;
};

/** What `applyBatch` needs from the database. Injected, so it is testable. */
export type ImportGroup = (plan: GroupPlan) => Promise<
  | { id: number }
  | { duplicate: true }
  | { error: string }
>;

/**
 * Write the eligible groups, one atomic call each.
 *
 * NOT ONE TRANSACTION, AND NOT PRETENDING TO BE. `seller_import_purchase_group`
 * is atomic for its own group and there is no API here that spans several. So
 * the batch is a sequence of atomic writes, and the honest failure mode is
 * "these succeeded, this one failed, the rest were not attempted" — recorded
 * exactly, and safe to re-run because the fingerprint of every success is now
 * taken.
 *
 * DELETING EARLIER SUCCESSES TO SIMULATE ATOMICITY WOULD BE WORSE than the
 * partial state it tidied: it would destroy correct historical records to make
 * a report look neat, and `purchase_items.movement_id` has an `on delete
 * restrict` behind it precisely because this ledger is not something a helper
 * gets to unwind.
 *
 * A unique-violation is success, not failure: it means another run got there
 * first, which is the outcome the fingerprint exists to produce.
 */
export async function applyBatch(
  plans: readonly GroupPlan[],
  importGroup: ImportGroup,
): Promise<ApplyResult> {
  const results: GroupOutcome[] = [];
  let imported = 0;
  let skipped = 0;
  let failedAt: number | null = null;

  for (const plan of plans) {
    if (plan.status === "already_imported") {
      results.push({ headerRow: plan.headerRow, fingerprint: plan.fingerprint, outcome: "already_imported" });
      skipped += 1;
      continue;
    }
    if (plan.status === "blocked") {
      results.push({ headerRow: plan.headerRow, fingerprint: plan.fingerprint,
                     outcome: "failed", message: plan.reason ?? "blockiert" });
      failedAt = plan.headerRow;
      break;
    }

    const outcome = await importGroup(plan);
    if ("id" in outcome) {
      results.push({ headerRow: plan.headerRow, fingerprint: plan.fingerprint,
                     outcome: "imported", purchaseId: outcome.id });
      imported += 1;
      continue;
    }
    if ("duplicate" in outcome) {
      results.push({ headerRow: plan.headerRow, fingerprint: plan.fingerprint, outcome: "already_imported" });
      skipped += 1;
      continue;
    }
    results.push({ headerRow: plan.headerRow, fingerprint: plan.fingerprint,
                   outcome: "failed", message: outcome.error });
    failedAt = plan.headerRow;
    break;
  }

  return { results, imported, skipped, failedAt };
}

/** Postgres says this when the partial unique index refuses a second twin. */
export function isDuplicateFingerprint(error: { code?: string; message?: string }): boolean {
  return error.code === "23505" || (error.message ?? "").includes("purchases_import_fingerprint_uniq");
}
