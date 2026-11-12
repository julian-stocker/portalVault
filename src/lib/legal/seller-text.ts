/**
 * From the seller row to what the legal texts need (ADR-0184, AP5).
 *
 * The texts are written for a particular situation — a sole proprietorship,
 * the § 19 UStG small-business scheme, no participation in consumer dispute
 * resolution, the customer bearing the return postage. Those are not
 * decorations of the prose; they are
 * statements in it. `textPremiseGaps()` checks each one against the data, and
 * a page whose data no longer matches its text is NOT rendered: a changed fact
 * needs a reviewed new text and a new version, not a silently wrong sentence.
 *
 * NO FALLBACK. Nothing here knows a name, an address or an e-mail. Everything
 * comes from `seller_legal_public()`.
 */
import { PLATFORM_NAME, contractingParty } from "@/lib/identity/model";
import type { CompleteSellerLegal, SellerLegalResult } from "@/lib/identity/public";

/** What a legal text reads. Built only from a complete, matching seller row. */
export type LegalSeller = {
  platformName: string;
  /** The shop brand, `sellers.display_name`. */
  displayName: string;
  /** The legal operator, `sellers.legal_name`. */
  legalName: string;
  legalForm: string;
  /** "{legal_name}, handelnd unter {display_name}" — provisional (ADR-0184). */
  contractingParty: string;
  street: string;
  postalCode: string;
  city: string;
  /** The country's German name, from the ISO code — never typed in by hand. */
  country: string;
  /** The published contact address. */
  email: string;
  /** Where a withdrawal goes (`withdrawal_contact_email`, else `email`). */
  withdrawalEmail: string;
  /** Where a complaint goes (`complaints_contact_email`, else `email`). */
  complaintsEmail: string;
  /**
   * `direct_contact`, exactly as stored — a further contact channel. Shown as
   * entered; this code does not classify it (telephone, form, …) and makes
   * no statement about whether it suffices.
   */
  directContact: string | null;
  /** Each present only if it exists — § 5 Abs. 1 DDG "soweit vorhanden". */
  vatId: string | null;
  wId: string | null;
  registerCourt: string | null;
  registerNumber: string | null;
};

/**
 * The facts the current texts state, and the code each one fails with.
 * `docs/LEGAL.md` and ADR-0184 say what changing one of them requires.
 */
export type TextPremise =
  | "text.legalForm"
  | "text.smallBusiness19"
  | "text.dispute"
  | "text.returnPostage";

export function textPremiseGaps(seller: CompleteSellerLegal): TextPremise[] {
  const gaps: TextPremise[] = [];
  // "ein Einzelunternehmen", "steht eine Person" (Impressum, AGB, Kontakt).
  if (seller.legalForm !== "Einzelunternehmen") gaps.push("text.legalForm");
  // "Als Kleinunternehmer im Sinne des § 19 UStG …" (Impressum, AGB, Zahlung).
  if (seller.smallBusiness19 !== true) gaps.push("text.smallBusiness19");
  // "… weder bereit noch verpflichtet" (Impressum, AGB, Kontakt).
  if (seller.disputeParticipation !== false) gaps.push("text.dispute");
  // "Sie tragen die unmittelbaren Kosten der Rücksendung" (Widerruf, Versand).
  if (seller.returnPostageBorneBy !== "customer") gaps.push("text.returnPostage");
  // NOT a premise: a further contact channel (`direct_contact`). With one, the
  // Impressum and the Kontakt page list it and drop their "no telephone, only
  // e-mail" sentences instead of failing (see `impressum.ts`, `service-pages.ts`).
  return gaps;
}

const COUNTRY = new Intl.DisplayNames(["de"], { type: "region" });

/** `DE` → "Deutschland". An unknown code stays the code rather than a guess. */
export function countryName(code: string): string {
  try {
    return COUNTRY.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

export function toLegalSeller(seller: CompleteSellerLegal): LegalSeller {
  return {
    platformName: PLATFORM_NAME,
    displayName: seller.displayName,
    legalName: seller.legalName,
    legalForm: seller.legalForm ?? "",
    contractingParty: contractingParty(seller.legalName, seller.displayName),
    street: seller.street,
    postalCode: seller.postalCode,
    city: seller.city,
    country: countryName(seller.countryCode),
    email: seller.contactEmail,
    withdrawalEmail: seller.withdrawalContactEmail ?? seller.contactEmail,
    complaintsEmail: seller.complaintsContactEmail ?? seller.contactEmail,
    directContact: seller.directContact,
    vatId: seller.vatId,
    wId: seller.wId,
    registerCourt: seller.registerCourt,
    registerNumber: seller.registerNumber,
  };
}

export type LegalTextsResult =
  | { status: "ok"; seller: LegalSeller }
  | {
      status: "unavailable";
      /** Why — for the server log and for tests; never shown with values. */
      cause: "unavailable" | "incomplete" | "mismatch";
      codes: readonly string[];
    };

/** The one decision every legal page and the footer make. */
export function resolveLegalTexts(result: SellerLegalResult): LegalTextsResult {
  if (result.status === "unavailable") {
    return { status: "unavailable", cause: "unavailable", codes: [result.reason] };
  }
  if (result.status === "incomplete") {
    return { status: "unavailable", cause: "incomplete", codes: result.missing };
  }
  const gaps = textPremiseGaps(result.seller);
  if (gaps.length > 0) return { status: "unavailable", cause: "mismatch", codes: gaps };
  return { status: "ok", seller: toLegalSeller(result.seller) };
}
