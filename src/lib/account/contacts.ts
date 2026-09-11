/**
 * Reading an account's saved contact details.
 *
 * The shapes and the conversions live in `contact-model.ts`, which the form
 * imports; this module is the half that talks to the database and therefore
 * cannot be imported from a client component.
 */
import { cache } from "react";

import { readContact, type SavedContact } from "@/lib/account/contact-model";
import { createClient } from "@/lib/supabase/server";

export * from "./contact-model";

const COLUMNS =
  "email, first_name, last_name, company, street, house_number, address_line_2," +
  "postal_code, city, country_code, phone";

/**
 * What this account has saved, or null.
 *
 * Memoised per request like every other reader here. A guest gets null: there
 * is no row that could be theirs, and RLS would return none anyway.
 */
export const fetchSavedContact = cache(async (): Promise<SavedContact | null> => {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const { data, error } = await supabase
    .from("customer_contacts")
    .select(COLUMNS)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (error || !data) return null;
  return readContact(data);
});
