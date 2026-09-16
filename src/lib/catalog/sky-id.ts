/**
 * The SKY-ID namespace, in TypeScript (ADR-0070).
 *
 * WHY THIS EXISTS NOW AND NOT BEFORE
 *
 * Until ADR-0070 there was one source of identities — the legacy project's
 * ledger — and `data/catalog/products.json` was, by definition, the whole
 * catalogue. Anything that wanted to know "is this a real figure" could ask
 * the export.
 *
 * That stopped being true when SkyIsles began issuing its own. PostgreSQL now
 * holds canonical figures the export has never heard of and never will, so
 * "not in products.json" no longer means "does not exist" — it means "was not
 * issued by the legacy project". Code that conflates the two rejects real
 * rows.
 *
 * The ranges below are the same ones `0033_admin_created_figures.sql` states
 * in SQL, and `character-namespace.test.ts` holds the two against each other.
 */

/** Format only. Says nothing about which range an id belongs to. */
export const SKY_ID_PATTERN = /^SKY-[0-9]{4}$/;

/**
 * The three ranges of ADR-0070.
 *
 *   historical  issued by the legacy project, present in products.json
 *   productive  issued by SkyIsles through public.sky_id_seq
 *   reserved    system and test fixtures, never issued to a catalogue figure
 */
export const SKY_ID_NAMESPACE = {
  historical: { first: 1, last: 820 },
  productive: { first: 821, last: 8999 },
  reserved: { first: 9000, last: 9999 },
} as const;

export type SkyIdRange = keyof typeof SKY_ID_NAMESPACE | "malformed";

/** The numeric part, or `null` when the value is not a SKY-ID at all. */
export function skyIdNumber(value: string): number | null {
  return SKY_ID_PATTERN.test(value) ? Number(value.slice(4)) : null;
}

/**
 * Which range an id falls in.
 *
 * `SKY-0000` is malformed in meaning rather than in shape: it matches the
 * pattern and was never issued, so it belongs to no range.
 */
export function skyIdRange(value: string): SkyIdRange {
  const number = skyIdNumber(value);
  if (number === null) return "malformed";
  for (const [name, range] of Object.entries(SKY_ID_NAMESPACE)) {
    if (number >= range.first && number <= range.last) return name as SkyIdRange;
  }
  return "malformed";
}

/**
 * Whether a catalogue figure may legitimately carry this id.
 *
 * The reserved band is the interesting half: `SKY-9994` and `SKY-9998` are
 * perfectly valid rows that carry orders and journal entries, so the FORMAT
 * must keep accepting them (ADR-0070). What must not happen is a curated
 * production assignment pointing at one — those rows are fixtures, and
 * treating a fixture as a catalogue figure is how test data reaches a
 * customer.
 */
export function isCuratableSkyId(value: string): boolean {
  const range = skyIdRange(value);
  return range === "historical" || range === "productive";
}
