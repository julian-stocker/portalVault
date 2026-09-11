/**
 * The shape of an account's saved contact and delivery details — the pure half.
 *
 * A **default to prefill a form with**, and nothing more. What ends up on an
 * order is `order_addresses`, snapshotted by `create_order()` and frozen by
 * the append-only trigger from 0010 — so changing what is saved here can
 * never change what an old order says was agreed. That separation is the
 * reason these are two tables and not one (ADR-0061).
 *
 * Separate from `contacts.ts` for the same reason `commerce-model.ts` is
 * separate from `commerce.ts`: the form is a client component, and a module
 * that reaches the server cannot be imported from one.
 */
import type { DraftAddress } from "@/lib/commerce/order";

export type SavedContact = DraftAddress & { email: string };

export const EMPTY_CONTACT: SavedContact = {
  email: "",
  firstName: "",
  lastName: "",
  company: "",
  street: "",
  houseNumber: "",
  addressLine2: "",
  postalCode: "",
  city: "",
  countryCode: "DE",
  phone: "",
};

type Row = {
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  street: string | null;
  house_number: string | null;
  address_line_2: string | null;
  postal_code: string | null;
  city: string | null;
  country_code: string | null;
  phone: string | null;
};

const COLUMNS =
  "email, first_name, last_name, company, street, house_number, address_line_2," +
  "postal_code, city, country_code, phone";

const text = (value: string | null | undefined): string =>
  typeof value === "string" ? value : "";

export function readContact(row: unknown): SavedContact | null {
  if (typeof row !== "object" || row === null) return null;
  const raw = row as Row;
  return {
    email: text(raw.email),
    firstName: text(raw.first_name),
    lastName: text(raw.last_name),
    company: text(raw.company),
    street: text(raw.street),
    houseNumber: text(raw.house_number),
    addressLine2: text(raw.address_line_2),
    postalCode: text(raw.postal_code),
    city: text(raw.city),
    countryCode: text(raw.country_code) || "DE",
    phone: text(raw.phone),
  };
}

/** The row to write. Empty strings become NULL: a blank field is not a value. */
export function contactRow(contact: SavedContact): Record<string, string | null> {
  const orNull = (value: string): string | null => {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  };
  return {
    email: orNull(contact.email),
    first_name: orNull(contact.firstName),
    last_name: orNull(contact.lastName),
    company: orNull(contact.company ?? ""),
    street: orNull(contact.street),
    house_number: orNull(contact.houseNumber),
    address_line_2: orNull(contact.addressLine2 ?? ""),
    postal_code: orNull(contact.postalCode),
    city: orNull(contact.city),
    country_code: orNull((contact.countryCode || "DE").toUpperCase()),
    phone: orNull(contact.phone ?? ""),
  };
}

/** True when there is anything worth prefilling a form with. */
export function hasContact(contact: SavedContact | null): boolean {
  if (contact === null) return false;
  return Object.entries(contact).some(
    ([key, value]) => key !== "countryCode" && typeof value === "string" && value.trim() !== "",
  );
}
