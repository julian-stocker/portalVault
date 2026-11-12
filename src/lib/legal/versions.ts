/**
 * Which version of each legal text is current — the database decides
 * (ADR-0184, AP5).
 *
 * WHY THE DATABASE AND NOT THE DEPLOYMENT. The code carries every version it
 * can render: the archived ones (`archive/`) and the one it builds from the
 * seller row (`LEGAL_VERSIONS`). Which of them is in force is a row in
 * `legal_document_versions`, read through `legal_versions_public()` (0191).
 * The legal pages render that version, the checkout shows it and sends it, and
 * `create_order()` compares it under a share lock. Switching to a new text is
 * then ONE transaction in the database (0192) — not a race between a
 * deployment going live and a migration being pasted.
 *
 * READ ON EVERY REQUEST (`connection()`), shared by everything in the request
 * (`cache()`): the page, its metadata, the footer and the checkout of one
 * request see the same answer.
 *
 * NEVER A GUESS. A failed call, a missing row, an empty value, or a version
 * this code cannot render is `unavailable` — the pages say so and the checkout
 * does not let an order go out. There is no default version to fall back on.
 */
import { cache } from "react";
import { connection } from "next/server";

import { anonClient } from "@/lib/identity/public";
import { archivedDocument } from "@/lib/legal/archive";
import { LEGAL_VERSIONS, isLegalVersion, type LegalSlug } from "@/lib/legal/documents";

export type ActiveVersions = Readonly<Record<LegalSlug, string>>;

export type ActiveVersionsResult =
  | { status: "ok"; versions: ActiveVersions }
  | {
      status: "unavailable";
      reason: "function_missing" | "incomplete" | "rpc_error" | "malformed" | "unknown_version";
    };

const SLUGS = Object.keys(LEGAL_VERSIONS) as LegalSlug[];

/** PostgREST: no such function (0191 not applied). */
const FUNCTION_MISSING = new Set(["PGRST202", "42883"]);
/** `legal_versions_public()`: a version is missing or empty (0191). */
const INCOMPLETE = new Set(["LV003"]);

/** Whether this code can render `version` of `slug` — built or archived. */
export function isRenderable(slug: LegalSlug, version: string): boolean {
  return version === LEGAL_VERSIONS[slug] || archivedDocument(slug, version) !== null;
}

/**
 * The whole interpretation, without I/O — tested directly. Logs codes and
 * slugs, never anything else.
 */
export function interpretLegalVersions(
  outcome: { data: unknown; error: { code?: string } | null },
  log: (message: string) => void = console.error,
): ActiveVersionsResult {
  if (outcome.error) {
    const code = outcome.error.code ?? "";
    const reason = FUNCTION_MISSING.has(code) ? "function_missing" : INCOMPLETE.has(code) ? "incomplete" : "rpc_error";
    log(`[legal] legal_versions_public unavailable: ${reason} (${code || "no code"})`);
    return { status: "unavailable", reason };
  }
  const rows = Array.isArray(outcome.data) ? outcome.data : null;
  if (rows === null || rows.length !== 1 || typeof rows[0] !== "object" || rows[0] === null) {
    log("[legal] legal_versions_public unavailable: malformed (not exactly one row)");
    return { status: "unavailable", reason: "malformed" };
  }
  const row = rows[0] as Record<string, unknown>;
  const versions = {} as Record<LegalSlug, string>;
  for (const slug of SLUGS) {
    const value = row[slug];
    if (value === null || value === undefined || value === "") {
      log(`[legal] legal_versions_public unavailable: incomplete (${slug})`);
      return { status: "unavailable", reason: "incomplete" };
    }
    if (!isLegalVersion(value)) {
      log(`[legal] legal_versions_public unavailable: malformed (${slug})`);
      return { status: "unavailable", reason: "malformed" };
    }
    if (!isRenderable(slug, value)) {
      // The database names a version this deployment does not carry: never
      // show another text in its place.
      log(`[legal] legal_versions_public unavailable: unknown_version (${slug})`);
      return { status: "unavailable", reason: "unknown_version" };
    }
    versions[slug] = value;
  }
  return { status: "ok", versions };
}

/** The current versions, once per request. Never throws. */
export const fetchLegalVersions = cache(async (): Promise<ActiveVersionsResult> => {
  await connection();
  try {
    const { data, error } = await anonClient().rpc("legal_versions_public");
    return interpretLegalVersions({ data, error });
  } catch {
    console.error("[legal] legal_versions_public unavailable: rpc_error (request failed)");
    return { status: "unavailable", reason: "rpc_error" };
  }
});
