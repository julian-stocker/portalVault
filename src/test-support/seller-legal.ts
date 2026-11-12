/**
 * A complete, invented seller row as `seller_legal_public()` returns it — for
 * the tests of the legal texts (ADR-0184, AP5).
 *
 * INVENTED ON PURPOSE. No real name, address or number: a test that passes
 * with these values proves the texts carry whatever the row says, not one
 * particular operator. The tax, dispute and return-postage facts match what
 * the current texts state (`textPremiseGaps`).
 */
import type { CompleteSellerLegal } from "@/lib/identity/public";

export const SELLER_LEGAL_FIXTURE: CompleteSellerLegal = {
  displayName: "beispiel.shop",
  legalName: "Erika Beispiel",
  legalForm: "Einzelunternehmen",
  street: "Beispielweg 7",
  postalCode: "12345",
  city: "Musterstadt",
  countryCode: "DE",
  contactEmail: "kontakt@example.org",
  directContact: null,
  vatId: "DE000000000",
  wId: null,
  registerCourt: null,
  registerNumber: null,
  smallBusiness19: true,
  disputeParticipation: false,
  disputeBody: null,
  withdrawalContactEmail: "widerruf@example.org",
  complaintsContactEmail: "reklamation@example.org",
  returnPostageBorneBy: "customer",
};

/** The same row as the RPC delivers it (snake_case), for the mapping tests. */
export const SELLER_LEGAL_ROW: Record<string, unknown> = {
  display_name: "beispiel.shop",
  legal_name: "Erika Beispiel",
  legal_form: "Einzelunternehmen",
  street: "Beispielweg 7",
  postal_code: "12345",
  city: "Musterstadt",
  country_code: "DE",
  contact_email: "kontakt@example.org",
  direct_contact: null,
  vat_id: "DE000000000",
  w_id: null,
  register_court: null,
  register_number: null,
  small_business_19: true,
  dispute_participation: false,
  dispute_body: null,
  withdrawal_contact_email: "widerruf@example.org",
  complaints_contact_email: "reklamation@example.org",
  return_postage_borne_by: "customer",
};
