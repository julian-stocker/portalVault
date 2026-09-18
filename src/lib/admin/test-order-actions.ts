/**
 * Putting a finished test order away, and taking it back (ADR-0084).
 *
 * NEITHER OF THESE DELETES ANYTHING. SkyIsles does not delete orders — live
 * ones are commercial history and test ones are the record of how the checkout
 * and the payment webhook actually behaved. Archiving writes one timestamp; the
 * order, its lines, its events, its payment attempts and its fulfilment history
 * all stay exactly where they were, and `Wiederherstellen` clears the timestamp
 * again.
 *
 * THE SANDBOX RULE IS THE DATABASE'S, TWICE. `seller_archive_test_orders()`
 * refuses a request naming any live order — the whole request, not the live
 * part of it — and a CHECK constraint on `orders` refuses the archived state on
 * a live row however it was reached. The capability check here is so the page
 * can say "nicht erlaubt" in German rather than surface a Postgres error.
 *
 * Both take a list. A single order is a list of one, deliberately: there is no
 * one-order function for a bulk feature to loop over with the sandbox check
 * done once outside the loop.
 */
"use server";

import { revalidatePath } from "next/cache";

import { canOperateSeller } from "@/lib/auth/capabilities";
import { de } from "@/lib/i18n/de";
import { createClient } from "@/lib/supabase/server";

export type ArchiveResult = { ok: true; changed: number } | { ok: false; message: string };

async function run(fn: string, orderNumbers: readonly string[]): Promise<ArchiveResult> {
  if (!(await canOperateSeller())) return { ok: false, message: de.admin.notAllowed };
  if (orderNumbers.length === 0) return { ok: true, changed: 0 };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, { p_order_numbers: orderNumbers });

  if (error) {
    const code = error.code ?? "";
    if (code === "42501") return { ok: false, message: de.admin.notAllowed };
    // The database refused the request because something in it was not a test
    // order. That is a fact about the list, not a fault.
    if (code === "22023") return { ok: false, message: de.business.testOrders.notSandbox };
    return { ok: false, message: de.business.testOrders.failed };
  }

  revalidatePath("/business/orders/test");
  return { ok: true, changed: typeof data === "number" ? data : 0 };
}

/** Hide finished test orders. Refused outright if any of them is live. */
export async function archiveTestOrders(orderNumbers: readonly string[]): Promise<ArchiveResult> {
  return run("seller_archive_test_orders", orderNumbers);
}

/** Bring archived test orders back. Archiving is never one-way. */
export async function restoreTestOrders(orderNumbers: readonly string[]): Promise<ArchiveResult> {
  return run("seller_restore_test_orders", orderNumbers);
}
