/**
 * Who is liable, in one place (ADR-0086).
 *
 * ONE SOLE PROPRIETORSHIP, TWO NAMES.
 *
 *   Julian Stocker      the natural person who is the contracting party
 *   yulez.collectibles  the business designation the shop trades under
 *   SkyIsles            the platform, the product, the website
 *
 * They are **not** three parties and not two legal persons. Everything here
 * belongs to one sole proprietorship. Earlier copy in this repository called
 * SkyIsles and yulez.collectibles "zwei Rechtssubjekte"; that was wrong and is
 * corrected. What ADR-0064 got right — and what stays — is the separation of
 * two ROLES: the platform that runs the catalog, the accounts and the
 * checkout, and the seller who is the customer's contracting party. A future
 * second seller would change who fills the seller role, not who owns SkyIsles.
 *
 * WHY THESE ARE CONSTANTS AND NOT SETTINGS
 *
 * `public.sellers` holds the same values, seeded by migration 0047, because an
 * invoice has to carry them and a snapshot has to freeze them. But an
 * Impressum is not allowed to be empty, and a settings row that nobody filled
 * in would render one that is. So the legal pages read from here, the
 * commercial records read from the database, and
 * `src/lib/legal/identity.test.ts` asserts the two say the same thing.
 *
 * The shop's **trade name on commerce surfaces** still comes from
 * `fetchSellerPublic()` at runtime — that is the seller model working as
 * designed, and nothing here replaces it.
 *
 * NOTHING HERE IS INVENTED. There is no telephone number, no commercial
 * register entry, no tax number beyond the VAT identification number, no
 * supervisory authority and no chamber — because none of those exist. A field
 * that is absent below is absent in reality.
 */

export const SELLER_IDENTITY = {
  /** The natural person. The contracting party, and who is liable. */
  legalName: "Julian Stocker",
  /** The business designation the shop trades under. */
  tradeName: "yulez.collectibles",
  /** Not "Kleingewerbe" — that is not a legal form. */
  legalForm: "Einzelunternehmen",
  /** How the contracting party is named wherever one line has to carry it. */
  contractingParty: "Julian Stocker, handelnd unter yulez.collectibles",

  street: "Lechhalde 1 1/2",
  postalCode: "87629",
  city: "Füssen",
  country: "Deutschland",
  countryCode: "DE",

  email: "info@skyisles.app",
  /** § 5 Abs. 1 Nr. 6 DDG — the VAT identification number, since one exists. */
  vatId: "DE321022065",

  /**
   * § 19 UStG. Since the reform the supplies are **steuerfrei**, which is the
   * wording used everywhere in this product — not the older "die Steuer wird
   * nicht erhoben". The order model stores a REGIME and never a rate
   * (migration 0011), and that stays right.
   */
  smallBusinessScheme: true,

  /** The platform, for the places that have to name it as well. */
  platformName: "SkyIsles",
} as const;

/** The address as a customer reads it — returns, Impressum, invoice. */
export const SELLER_ADDRESS_LINES: readonly string[] = [
  SELLER_IDENTITY.legalName,
  SELLER_IDENTITY.tradeName,
  SELLER_IDENTITY.street,
  `${SELLER_IDENTITY.postalCode} ${SELLER_IDENTITY.city}`,
  SELLER_IDENTITY.country,
];

/**
 * Deliberately absent, and listed so that nobody adds them by accident.
 *
 * A test reads this list and fails if any of these words appears in a legal
 * page — which is how an invented telephone number or a claimed register entry
 * gets caught before a customer reads it.
 */
export const NEVER_CLAIMED: readonly string[] = [
  "Handelsregister",
  "HRB",
  "HRA",
  "Registergericht",
  "Amtsgericht",
  "Telefon",
  "Kleingewerbe",
  "Aufsichtsbehörde",
  "Kammer",
  "GmbH",
  "UG (haftungsbeschränkt)",
  "Steuernummer",
  "ODR",
  "Online-Streitbeilegung",
  "Schlichtungsstelle",
];
