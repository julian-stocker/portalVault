/**
 * The saved contact and delivery details, as a form.
 *
 * Used on `/account/contact`. The same fields the checkout asks for, in the
 * same order, so a person who has filled one recognises the other — but this
 * one saves a **default**, and the checkout still decides per order. Editing
 * here never touches an order that already exists; `order_addresses` is a
 * snapshot (ADR-0061).
 */
"use client";

import { useState, useTransition } from "react";

import { ACTION_NEUTRAL, ACTION_PRIMARY } from "@/components/ui/action";
import { deleteContact, saveContact } from "@/lib/account/actions";
import { EMPTY_CONTACT, type SavedContact } from "@/lib/account/contact-model";
import { de } from "@/lib/i18n/de";

const FIELD =
  "min-h-11 w-full rounded-sky-md bg-surface px-3 text-sm ring-1 ring-border/70 focus:ring-accent";
const LABEL = "mb-1 block text-xs font-medium text-muted";

type Key = keyof SavedContact;

const ROWS: { key: Key; label: string; autoComplete: string; wide?: boolean }[] = [
  { key: "email", label: de.checkout.email, autoComplete: "email", wide: true },
  { key: "firstName", label: de.checkout.firstName, autoComplete: "given-name" },
  { key: "lastName", label: de.checkout.lastName, autoComplete: "family-name" },
  { key: "company", label: de.checkout.company, autoComplete: "organization", wide: true },
  { key: "street", label: de.checkout.street, autoComplete: "address-line1" },
  { key: "houseNumber", label: de.checkout.houseNumber, autoComplete: "address-line2" },
  { key: "addressLine2", label: de.checkout.addressLine2, autoComplete: "address-line3", wide: true },
  { key: "postalCode", label: de.checkout.postalCode, autoComplete: "postal-code" },
  { key: "city", label: de.checkout.city, autoComplete: "address-level2" },
  // No telephone field: the checkout does not ask for one either, and a
  // saved default for something nobody is asked is data kept for nothing.
];

export function ContactForm({ contact }: { contact: SavedContact | null }) {
  const copy = de.account.contact;
  const [values, setValues] = useState<SavedContact>(contact ?? EMPTY_CONTACT);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function set(key: Key, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
    setNote(null);
    setError(null);
  }

  function save() {
    setNote(null);
    setError(null);
    startTransition(async () => {
      const result = await saveContact(values);
      if (result.ok) setNote(copy.saved);
      else setError(result.message);
    });
  }

  function remove() {
    setNote(null);
    setError(null);
    startTransition(async () => {
      const result = await deleteContact();
      if (result.ok) {
        setValues(EMPTY_CONTACT);
        setNote(copy.removed);
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted">{copy.intro}</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {ROWS.map((row) => (
          <div key={row.key} className={row.wide ? "sm:col-span-2" : undefined}>
            <label className={LABEL} htmlFor={`contact-${row.key}`}>
              {row.label}
            </label>
            <input
              id={`contact-${row.key}`}
              className={FIELD}
              autoComplete={row.autoComplete}
              value={values[row.key] ?? ""}
              onChange={(event) => set(row.key, event.target.value)}
            />
          </div>
        ))}
      </div>

      {/* Germany only in V1, and `create_order()` is what enforces it. Shown
          as a fact rather than as a choice nobody has. */}
      <p className="text-xs text-muted">{de.checkout.countryFixed}</p>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={pending} onClick={save} className={ACTION_PRIMARY}>
          {copy.save}
        </button>
        <button type="button" disabled={pending} onClick={remove} className={ACTION_NEUTRAL}>
          {copy.remove}
        </button>
      </div>

      {note ? <p className="text-sm text-muted">{note}</p> : null}
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}
