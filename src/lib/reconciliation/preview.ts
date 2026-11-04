/**
 * What a selection of report files WOULD send — checked in the browser,
 * before anything leaves it (ADR-0174 no. 2, phase 4 step 3).
 *
 * ONLY THE EXISTING PIECES, IN THE ACTION'S ORDER. This file reads, merges and
 * covers with exactly the functions `analyseReconciliation` uses (`registry`,
 * `dedupe`, `coverage`) and checks the upload with the action's own
 * `validateUpload`. It never matches, never diffs and never asks the
 * database: whether a report agrees with SkyIsles is the server's question.
 *
 * WHAT IT SHOWS IS COUNTS, NOT CONTENT. The preview carries file names, the
 * platform, numbers, days and codes. No title, no figure name, no order
 * number, and nothing of the buyer — the parser never read the buyer columns
 * in the first place (`ebay/columns.ts`).
 *
 * THE SIZE IS MEASURED, NOT ESTIMATED. `payloadBytes` is the UTF-8 length of
 * the upload serialised as JSON — the body a server action carries for a
 * plain object argument, apart from a few bytes of framing. Next refuses an
 * action body above 1 MB (`serverActions.bodySizeLimit`, unchanged); the
 * preview stops at 900 KiB so the framing never matters.
 */

import { coverageOf, type Coverage } from "./coverage.ts";
import { distinctFiles, fileFingerprint, mergeReports, type MergedReports, type Sha256 } from "./dedupe.ts";
import { parseSalesReport } from "./registry.ts";
import { PayloadError, validateUpload, type UploadInput } from "./server/payload.ts";
import type { ExternalReport, ParseFailure, ReportIssue } from "./types.ts";

/** The conservative upload limit until a measured decision says otherwise. */
export const MAX_PAYLOAD_BYTES = 900 * 1024;
/** A single file larger than this is not read at all — no export of a year comes near it. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** `seller_recon_candidates` reads at most 400 days (0172). */
export const MAX_PERIOD_DAYS = 400;

export type SelectedFile = { name: string; size: number; text: string | null };

export type FilePreview =
  | {
      kind: "report";
      name: string;
      fingerprint: string;
      parser: string;
      parserVersion: number;
      orders: number;
      positions: number;
      pieces: number;
      firstSoldOn: string | null;
      lastSoldOn: string | null;
      footerCount: number | null;
      footerMatches: boolean | null;
      /** Issue code → how often. Codes only: rows and details stay in the file. */
      issues: Partial<Record<ReportIssue["code"], number>>;
      /** Identical to a file selected earlier in this selection. */
      duplicateOf: string | null;
    }
  | { kind: "failed"; name: string; failure: ParseFailure["code"] | "too_large" | "unreadable" };

/** Why this selection cannot be sent. Each one is shown; none is guessed around. */
export type Blocker =
  | "no_files" | "failed_files" | "mixed_formats" | "conflicting_orders" | "no_orders"
  | "period_too_long" | "too_large" | "invalid_upload" | "contact_data";

/** Worth knowing, not stopping. */
export type Warning =
  | "file_issues" | "footer_mismatch" | "chain_gaps" | "orders_without_record_no"
  | "overlapping_files" | "duplicate_files" | "repeated_orders";

export type Preview = {
  files: FilePreview[];
  /** Platform of the readable reports; null when none or several. */
  parser: string | null;
  /** After merging: every order once. */
  orders: number;
  positions: number;
  pieces: number;
  firstSoldOn: string | null;
  lastSoldOn: string | null;
  periodDays: number | null;
  chainComplete: boolean | null;
  chainGaps: number;
  payloadBytes: number;
  blockers: Blocker[];
  warnings: Warning[];
  /** What step 4 would send; null while anything blocks. */
  upload: UploadInput | null;
};

const linesOf = (r: ExternalReport) => r.orders.reduce((n, o) => n + o.lines.length, 0);
const piecesOf = (r: ExternalReport) => r.orders.reduce((n, o) => n + o.pieces, 0);

/** Calendar days from `from` to `to`, both `YYYY-MM-DD`. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** UTF-8 bytes of the upload as the action would receive it. */
export function payloadBytes(upload: UploadInput): number {
  return new TextEncoder().encode(JSON.stringify([upload])).length;
}

export async function buildPreview(selected: readonly SelectedFile[], sha256: Sha256): Promise<Preview> {
  // One slot per selected file, in the selection's order.
  const files: (FilePreview | null)[] = selected.map(() => null);
  const readable: { index: number; report: ExternalReport; fingerprint: string }[] = [];

  for (const [index, file] of selected.entries()) {
    if (file.size > MAX_FILE_BYTES) { files[index] = { kind: "failed", name: file.name, failure: "too_large" }; continue; }
    if (file.text === null) { files[index] = { kind: "failed", name: file.name, failure: "unreadable" }; continue; }
    const parsed = parseSalesReport(file.text, file.name);
    if (!parsed.ok) { files[index] = { kind: "failed", name: file.name, failure: parsed.error.code }; continue; }
    readable.push({ index, report: parsed.report, fingerprint: await fileFingerprint(file.text, sha256) });
  }

  const merged: MergedReports = mergeReports(readable);
  // Which files are repeats — by content and position, never by name: the server action's rule.
  const distinct = distinctFiles(readable);
  const duplicateOf = new Map(distinct.repeats.map((d) => [readable[d.index].index, selected[readable[d.sameAs].index].name]));
  const kept = distinct.kept;
  const coverage: Coverage | null = kept.length > 0 ? coverageOf(kept.map((r) => r.report), merged.orders) : null;

  for (const { index, report, fingerprint } of readable) {
    const issues: Partial<Record<ReportIssue["code"], number>> = {};
    for (const issue of report.issues) issues[issue.code] = (issues[issue.code] ?? 0) + 1;
    const days = report.orders.map((o) => o.soldOn).sort();
    files[index] = {
      kind: "report", name: report.fileName, fingerprint, parser: report.parser, parserVersion: report.parserVersion,
      orders: report.orders.length, positions: linesOf(report), pieces: piecesOf(report),
      firstSoldOn: days[0] ?? null, lastSoldOn: days[days.length - 1] ?? null,
      footerCount: report.footerCount, footerMatches: report.footerCount === null ? null : report.footerCount === report.orders.length,
      issues, duplicateOf: duplicateOf.get(index) ?? null,
    };
  }

  // Every slot is filled now: each file was either read or refused above.
  const shown = files.filter((f): f is FilePreview => f !== null);

  const parsers = new Set(kept.map((r) => `${r.report.parser}@${r.report.parserVersion}`));
  const upload: UploadInput = { channel: "ebay", files: kept.map((r) => ({ fingerprint: r.fingerprint, report: r.report })) };
  const bytes = payloadBytes(upload);
  const periodDays = coverage?.firstSoldOn && coverage.lastSoldOn ? daysBetween(coverage.firstSoldOn, coverage.lastSoldOn) : null;

  const blockers: Blocker[] = [];
  if (selected.length === 0) blockers.push("no_files");
  if (shown.some((f) => f.kind === "failed")) blockers.push("failed_files");
  if (parsers.size > 1) blockers.push("mixed_formats");
  if (merged.conflicts.length > 0) blockers.push("conflicting_orders");
  if (selected.length > 0 && merged.orders.length === 0) blockers.push("no_orders");
  if (periodDays !== null && periodDays > MAX_PERIOD_DAYS) blockers.push("period_too_long");
  if (bytes > MAX_PAYLOAD_BYTES) blockers.push("too_large");
  if (kept.length > 0) {
    try {
      validateUpload(upload);
    } catch (error) {
      if (!(error instanceof PayloadError)) throw error;
      blockers.push(error.message.includes("contact data") ? "contact_data" : "invalid_upload");
    }
  }

  const warnings: Warning[] = [];
  if (kept.some((r) => r.report.issues.length > 0)) warnings.push("file_issues");
  if (coverage?.files.some((f) => f.footerMatches === false)) warnings.push("footer_mismatch");
  if (coverage && coverage.gaps.length > 0) warnings.push("chain_gaps");
  if (coverage && coverage.ordersWithoutRecordNo > 0) warnings.push("orders_without_record_no");
  if (coverage && coverage.overlappingFiles.length > 0) warnings.push("overlapping_files");
  if (duplicateOf.size > 0) warnings.push("duplicate_files");
  if (merged.repeatedOrders.length > 0) warnings.push("repeated_orders");

  return {
    files: shown,
    parser: parsers.size === 1 ? kept[0].report.parser : null,
    orders: merged.orders.length,
    positions: merged.orders.reduce((n, o) => n + o.lines.length, 0),
    pieces: merged.orders.reduce((n, o) => n + o.pieces, 0),
    firstSoldOn: coverage?.firstSoldOn ?? null,
    lastSoldOn: coverage?.lastSoldOn ?? null,
    periodDays,
    chainComplete: coverage ? coverage.chainComplete : null,
    chainGaps: coverage ? coverage.gaps.length : 0,
    payloadBytes: bytes,
    blockers,
    warnings,
    upload: blockers.length === 0 ? upload : null,
  };
}
