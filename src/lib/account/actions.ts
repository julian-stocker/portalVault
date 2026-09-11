/**
 * Writing an account's saved contact details.
 *
 * A thin wrapper, as every write in this codebase is: RLS on
 * `customer_contacts` is what decides, and it names `auth.uid()` — so a
 * forged `user_id` in a payload would be refused by the policy rather than by
 * this file. The check here returns a German sentence and saves a round trip;
 * it is not the boundary (docs/SECURITY.md).
 */
"use server";

import { revalidatePath } from "next/cache";

import { contactRow, type SavedContact } from "@/lib/account/contact-model";
import { de } from "@/lib/i18n/de";
import { createClient } from "@/lib/supabase/server";

export type ContactResult = { ok: true } | { ok: false; message: string };

export async function saveContact(contact: SavedContact): Promise<ContactResult> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, message: de.account.contact.signInFirst };

  const email = contact.email.trim();
  if (email !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, message: de.checkout.fieldError.email };
  }

  const { error } = await supabase.from("customer_contacts").upsert(
    { user_id: auth.user.id, ...contactRow(contact), updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  if (error) return { ok: false, message: de.account.contact.saveFailed };

  revalidatePath("/account/contact");
  revalidatePath("/checkout");
  return { ok: true };
}

/**
 * Remove the saved details entirely.
 *
 * Data minimisation, and the only way for a customer to take them back. Past
 * orders keep their own address snapshot and are untouched — that is what the
 * snapshot is for.
 */
export async function deleteContact(): Promise<ContactResult> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, message: de.account.contact.signInFirst };

  const { error } = await supabase.from("customer_contacts").delete().eq("user_id", auth.user.id);
  if (error) return { ok: false, message: de.account.contact.saveFailed };

  revalidatePath("/account/contact");
  revalidatePath("/checkout");
  return { ok: true };
}
