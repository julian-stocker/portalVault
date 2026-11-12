/**
 * What a legal page shows when the seller details cannot be used
 * (ADR-0184, AP5): the read failed, a required field is empty, or the data no
 * longer matches what the text states — or when the database cannot say which
 * version of the text is current.
 *
 * It names NO seller — not the last known one, not an earlier one. The title
 * stays, so the visitor knows which page this is; the reason stays on the
 * server (the log names the code), because "the address field is empty" is
 * the operator's business, not the visitor's.
 */
import { de } from "@/lib/i18n/de";

export function LegalUnavailable({ title, cause = "seller" }: {
  title: string;
  /** `versions`: which version is current is unknown (0191) — no version is guessed. */
  cause?: "seller" | "versions";
}) {
  const copy = de.legal.unavailable;
  const heading = cause === "versions" ? copy.versionsHeading : copy.heading;
  const body = cause === "versions" ? copy.versionsBody : copy.body;
  return (
    <main className="mx-auto w-full max-w-2xl px-4 pt-8 pb-16 md:pt-12">
      <h1 className="text-2xl font-semibold tracking-tight text-balance md:text-3xl">{title}</h1>
      <div role="alert" className="mt-6 rounded-sky-lg bg-surface/80 p-5 ring-1 ring-border-strong">
        <h2 className="font-semibold">{heading}</h2>
        <p className="mt-2 text-sm text-muted">{body}</p>
      </div>
    </main>
  );
}
