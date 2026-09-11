/**
 * The operator's own facts, on /admin.
 *
 * Two fields today (ADR-0059). The legal block adds legal name, service
 * address and tax details to the same panel and the same table, which is the
 * reason this is not a pair of columns on the pricing settings.
 *
 * The technical From address is deliberately absent and not editable: it
 * belongs to the verified sending domain, and a field that could change it is
 * a field that can break deliverability in one keystroke.
 */
"use client";

import { useState, useTransition } from "react";

import { ACTION_PRIMARY } from "@/components/ui/action";
import { setBusinessContact } from "@/lib/admin/actions";
import { de } from "@/lib/i18n/de";

const FIELD =
  "min-h-11 w-full rounded-sky-md bg-surface px-3 text-sm ring-1 ring-border/70 focus:ring-accent";
const LABEL = "mb-1 block text-xs font-medium text-muted";

export function BusinessSettings({
  contactEmail,
  replyTo,
}: {
  contactEmail: string | null;
  replyTo: string | null;
}) {
  const copy = de.admin.business;
  const [contact, setContact] = useState(contactEmail ?? "");
  const [reply, setReply] = useState(replyTo ?? "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setSaved(false);
    setError(null);
    startTransition(async () => {
      const result = await setBusinessContact(contact, reply);
      if (result.ok) setSaved(true);
      else setError(result.message);
    });
  }

  return (
    <section className="rounded-sky-lg bg-surface/80 p-5 ring-1 ring-border/70">
      <h2 className="font-medium">{copy.heading}</h2>
      <p className="mt-1 text-sm text-muted">{copy.hint}</p>

      {/* Without a contact address the operator alert has nowhere to go, and
          that is worth saying where the address is set rather than only in a
          log line nobody reads. */}
      {contactEmail === null ? (
        <p className="mt-3 rounded-sky-md bg-danger/10 px-3 py-2 text-sm text-danger ring-1 ring-danger/40">
          {copy.missingWarning}
        </p>
      ) : null}

      <div className="mt-4 flex flex-col gap-4">
        <div>
          <label className={LABEL} htmlFor="business-contact">
            {copy.contactEmail}
          </label>
          <input
            id="business-contact"
            type="email"
            inputMode="email"
            autoComplete="off"
            value={contact}
            onChange={(event) => setContact(event.target.value)}
            className={FIELD}
          />
          <p className="mt-1 text-xs text-muted">{copy.contactEmailHint}</p>
        </div>

        <div>
          <label className={LABEL} htmlFor="business-reply-to">
            {copy.replyTo}
          </label>
          <input
            id="business-reply-to"
            type="email"
            inputMode="email"
            autoComplete="off"
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            className={FIELD}
          />
          <p className="mt-1 text-xs text-muted">{copy.replyToHint}</p>
        </div>
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
