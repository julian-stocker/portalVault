/**
 * What a failed create tells the administrator (CAT-11).
 *
 * WHY THIS FILE EXISTS
 *
 * `createFigure()` used to turn EVERY database error into one sentence: "Die
 * Figur konnte nicht angelegt werden." A missing category, a SKY-ID that is
 * already taken, an exhausted SKY-ID band and a refused variant all read the
 * same — and the administrator had nothing to act on, and nothing to report.
 *
 * This maps the error to a sentence that says what to do. It is a pure
 * function, outside the `"use server"` module, so it can be tested without a
 * request; and it never echoes the raw database message into the page —
 * that text is for the server log, which the action writes separately.
 *
 * EVERY PATH HERE MEANS "NOTHING WAS WRITTEN". The create is one function,
 * one transaction (`0152`, `0166`). What a failure does NOT roll back is the
 * drawn sequence number — that is why the next attempt gets the next number,
 * and that is correct (ADR-0001).
 */
import { de } from "@/lib/i18n/de";

export type DbError = { code?: string; message?: string };

/** PostgREST's "no such function" — the migration is not applied yet. */
function unknownFunction(error: DbError): boolean {
  return error.code === "PGRST202"
    || (error.message ?? "").includes("Could not find the function");
}

export function createErrorMessage(error: DbError, variant: boolean): string {
  const text = error.message ?? "";
  const t = de.admin;

  if (unknownFunction(error)) return variant ? t.variantCreateNotEnabled : t.createFailed;
  if (error.code === "42501") return t.notAllowed;

  /* The two ways the SKY-ID allocation can refuse. Neither is the operator's
     doing, and neither is solved by trying again. */
  if (text.includes("allocation range exhausted") || error.code === "2200H") {
    return t.createIdExhausted;
  }
  if (error.code === "23505" && text.includes("skylanders_pkey")) return t.createIdTaken;
  if (error.code === "23505" && text.includes("slug")) return t.createSlugTaken;

  /* The category belongs to a different series (composite foreign key). */
  if (error.code === "23503" && text.includes("category")) return t.createCategoryRequired;
  if (text.includes("needs a name") || text.includes("empty slug")) return t.createNameRequired;

  /* The variant's own refusals (`0166`, and `0159` underneath it). */
  if (text.includes("kein Variantentype")) return t.variantTypeRequired;
  if (text.includes("selbst eine Variante")) return t.variantBaseIsVariant;
  if (text.includes("ist ein Entwurf")) return t.variantBaseIsDraft;
  if (text.includes("Basisfigur") && text.includes("gibt es nicht")) return t.baseUnknown;
  if (text.includes("unknown template figure")) return t.unknownFigure;
  if (text.includes("DERSELBEN Serie") || text.includes("skylanders_base_same_series")) {
    return t.variantSeriesMismatch;
  }

  /* Unrecognised: say so, and give the code, which is what a report needs. */
  return error.code ? t.createFailedCode(error.code) : t.createFailed;
}
