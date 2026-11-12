/**
 * The public provider identification — the seller as the legal pages and the
 * footer name it (ADR-0184, AP5).
 *
 * ONE SOURCE. `seller_legal_public()` (migration 0190) returns the ACTIVE
 * seller row as an explicit allow-list of nineteen columns; invoices and mails
 * already read the same row. There is no second copy in the code any more, so
 * the Impressum cannot drift from the invoice.
 *
 * ANONYMOUS, ON PURPOSE. The call uses the anon key with no session cookies:
 * what a visitor reads must not depend on who is signed in, and the function
 * is granted to `anon`. No service key — `service_role` has no EXECUTE on it.
 *
 * READ ON EVERY REQUEST, never kept across requests (`connection()`). A legal
 * page that served yesterday's address from a cache would be a wrong statement
 * about who a customer contracts with; one extra single-row read per page
 * view is the price, and React `cache()` makes the page and the footer of the
 * same request share one call. The texts themselves are code and change only
 * with a deployment.
 *
 * NEVER A FALLBACK. Missing data or a failed call is reported as such. There is
 * no constant to fall back on and no earlier identity to show instead — an
 * Impressum naming a retired business would be worse than one that says the
 * details are unavailable.
 */
import { cache } from "react";
import { connection } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { missingRequiredFields, type RequiredIdentityCode } from "@/lib/identity/model";
import { supabasePublicConfig } from "@/lib/ops/deployment-target";

/** The nineteen columns of `seller_legal_public()`, typed. Empty values are NULL. */
export type SellerLegal = {
  displayName: string | null;
  legalName: string | null;
  legalForm: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  countryCode: string | null;
  contactEmail: string | null;
  directContact: string | null;
  vatId: string | null;
  wId: string | null;
  registerCourt: string | null;
  registerNumber: string | null;
  smallBusiness19: boolean | null;
  disputeParticipation: boolean | null;
  disputeBody: string | null;
  /** Falls back to `contact_email` in the database already. */
  withdrawalContactEmail: string | null;
  /** Falls back to `contact_email` in the database already. */
  complaintsContactEmail: string | null;
  returnPostageBorneBy: string | null;
};

/** A seller whose required fields are present — the type the texts are built from. */
export type CompleteSellerLegal = SellerLegal & {
  displayName: string;
  legalName: string;
  street: string;
  postalCode: string;
  city: string;
  countryCode: string;
  contactEmail: string;
};

export type SellerLegalResult =
  | { status: "ok"; seller: CompleteSellerLegal }
  /** A seller row exists, but a required field is empty. */
  | { status: "incomplete"; missing: RequiredIdentityCode[] }
  | { status: "unavailable"; reason: "no_active_seller" | "function_missing" | "rpc_error" | "malformed" };

/** PostgREST's "no such function" — 0190 is not applied where this runs. */
const FUNCTION_MISSING = "PGRST202";

type Row = Record<string, unknown>;

const text = (row: Row, key: string): string | null => {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new TypeError(key);
  return value.trim() === "" ? null : value;
};

const flag = (row: Row, key: string): boolean | null => {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "boolean") throw new TypeError(key);
  return value;
};

/** One row of the RPC → the typed record. Throws on a value of the wrong type. */
export function mapSellerLegalRow(row: Row): SellerLegal {
  return {
    displayName: text(row, "display_name"),
    legalName: text(row, "legal_name"),
    legalForm: text(row, "legal_form"),
    street: text(row, "street"),
    postalCode: text(row, "postal_code"),
    city: text(row, "city"),
    countryCode: text(row, "country_code"),
    contactEmail: text(row, "contact_email"),
    directContact: text(row, "direct_contact"),
    vatId: text(row, "vat_id"),
    wId: text(row, "w_id"),
    registerCourt: text(row, "register_court"),
    registerNumber: text(row, "register_number"),
    smallBusiness19: flag(row, "small_business_19"),
    disputeParticipation: flag(row, "dispute_participation"),
    disputeBody: text(row, "dispute_body"),
    withdrawalContactEmail: text(row, "withdrawal_contact_email"),
    complaintsContactEmail: text(row, "complaints_contact_email"),
    returnPostageBorneBy: text(row, "return_postage_borne_by"),
  };
}

/** The required-field check of the identity model, applied to the public row. */
export function classifySellerLegal(seller: SellerLegal): SellerLegalResult {
  const missing = missingRequiredFields({
    "shop.displayName": seller.displayName,
    "legal.legalName": seller.legalName,
    "legal.street": seller.street,
    "legal.postalCode": seller.postalCode,
    "legal.city": seller.city,
    "legal.countryCode": seller.countryCode,
    "shop.contactEmail": seller.contactEmail,
  });
  if (missing.length > 0) return { status: "incomplete", missing };
  return { status: "ok", seller: seller as CompleteSellerLegal };
}

/** What the RPC call returned, before interpretation. */
export type RpcOutcome = { data: unknown; error: { code?: string } | null };

/**
 * The whole interpretation, without I/O — tested directly. Logs a code and a
 * reason, never a value from the row: an address or a name in a server log is
 * personal data in a place nobody reviews.
 */
export function interpretSellerLegal(outcome: RpcOutcome, log: (message: string) => void = console.error): SellerLegalResult {
  if (outcome.error) {
    const reason = outcome.error.code === FUNCTION_MISSING ? "function_missing" : "rpc_error";
    log(`[legal] seller_legal_public unavailable: ${reason} (${outcome.error.code ?? "no code"})`);
    return { status: "unavailable", reason };
  }
  const rows = Array.isArray(outcome.data) ? (outcome.data as Row[]) : null;
  if (rows === null) {
    log("[legal] seller_legal_public unavailable: malformed (not a row set)");
    return { status: "unavailable", reason: "malformed" };
  }
  if (rows.length === 0) {
    log("[legal] seller_legal_public unavailable: no_active_seller");
    return { status: "unavailable", reason: "no_active_seller" };
  }
  let seller: SellerLegal;
  try {
    seller = mapSellerLegalRow(rows[0]);
  } catch (e) {
    log(`[legal] seller_legal_public unavailable: malformed (column ${(e as Error).message})`);
    return { status: "unavailable", reason: "malformed" };
  }
  const result = classifySellerLegal(seller);
  if (result.status === "incomplete") {
    log(`[legal] seller_legal_public incomplete: ${result.missing.join(", ")}`);
  }
  return result;
}

/**
 * A client with the anon key and no session: nothing persisted, nothing
 * refreshed. Shared with `legal/versions.ts`, which reads the current legal
 * versions the same way and for the same reason.
 */
export function anonClient() {
  // Throws on a Vercel preview that is not wired to Staging (ADR-0185); the
  // callers turn that into "unavailable", like any other failed read.
  const { url, anonKey } = supabasePublicConfig();
  return createSupabaseClient(
    url,
    anonKey,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
}

/**
 * The active seller's public identification, once per request.
 *
 * Never throws: a network failure is `unavailable`, like any other failure, so
 * the footer of every page survives it and the legal page can say so.
 */
export const fetchSellerLegal = cache(async (): Promise<SellerLegalResult> => {
  // Per request, never prerendered or reused (see the head of this file).
  await connection();
  try {
    const { data, error } = await anonClient().rpc("seller_legal_public");
    return interpretSellerLegal({ data, error });
  } catch {
    console.error("[legal] seller_legal_public unavailable: rpc_error (request failed)");
    return { status: "unavailable", reason: "rpc_error" };
  }
});
