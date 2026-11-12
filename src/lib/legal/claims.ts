/**
 * Deliberately absent, and listed so that nobody adds them by accident
 * (ADR-0086).
 *
 * A test reads this list and fails if any of these words appears in a legal
 * page without a denial — which is how an invented telephone number or a
 * claimed register entry gets caught before a customer reads it.
 *
 * Since AP5 (ADR-0184) a register entry CAN appear: the Impressum lists
 * `register_court` and `register_number` when the seller row carries them. The
 * test renders the texts from a seller WITHOUT them, so the guard still
 * catches a register entry written into the prose.
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
