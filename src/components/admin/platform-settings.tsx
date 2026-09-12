/**
 * The platform's own facts, on /admin.
 *
 * One field today, and it is deliberately its own panel rather than a fourth
 * input on the seller's (ADR-0064). Which address belongs where is decided by
 * the duty: a privacy request or an account problem is SkyIsles' to answer, a
 * question about an order is the seller's.
 *
 * The two may hold the same address today, because one person is both. The
 * panel says so, so that filling in the same value twice reads as a choice
 * rather than as a mistake — and so the day they diverge, nothing has to move.
 */
"use client";

import { useState, useTransition } from "react";

import { ACTION_PRIMARY } from "@/components/ui/action";
import { setPlatformContact } from "@/lib/admin/actions";
import { de } from "@/lib/i18n/de";

const FIELD =
  "min-h-11 w-full rounded-sky-md bg-surface px-3 text-sm ring-1 ring-border/70 focus-ring";
const LABEL = "mb-1 block text-xs font-medium text-muted";

export function PlatformSettings({ contactEmail }: { contactEmail: string | null }) {
  const copy = de.admin.platform;
  const [contact, setContact] = useState(contactEmail ?? "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setSaved(false);
    setError(null);
    startTransition(async () => {
      const result = await setPlatformContact(contact);
      if (result.ok) setSaved(true);
      else setError(result.message);
    });
  }

  return (
    <section className="mt-4 rounded-sky-lg bg-surface/80 p-5 ring-1 ring-border/70">
      <h2 className="font-medium">{copy.heading}</h2>
      <p className="mt-1 text-sm text-muted">{copy.hint}</p>

      <div className="mt-4">
        <label className={LABEL} htmlFor="platform-contact">
          {copy.contactEmail}
        </label>
        <input
          id="platform-contact"
          type="email"
          inputMode="email"
          autoComplete="off"
          value={contact}
          onChange={(event) => setContact(event.target.value)}
          className={FIELD}
        />
        <p className="mt-1 text-xs text-muted">{copy.contactEmailHint}</p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className={`${ACTION_PRIMARY} w-auto disabled:opacity-60`}
        >
          {copy.save}
        </button>
        {saved ? (
          <p role="status" className="text-sm text-success">
            {copy.saved}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
