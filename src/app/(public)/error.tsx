/**
 * Public error boundary.
 *
 * A client component because `reset()` has to run in the browser — that is
 * the App Router contract, not a choice.
 *
 * Says what happened in plain German and offers one way forward. No error
 * code, no stack, no Supabase message: none of it helps a collector, and a
 * database error text is not something to put on a public page.
 */
"use client";

import { useEffect } from "react";

import { ACTION_NEUTRAL } from "@/components/ui/action";
import { de } from "@/lib/i18n/de";

export default function CatalogError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The detail belongs in the server log, where it is useful — the digest
    // is what ties this screen to that entry.
    console.error("catalog error", error.digest ?? error.message);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col items-center gap-3 px-4 py-16 text-center">
      <h1 className="font-medium">{de.catalog.errorTitle}</h1>
      <p className="text-sm text-muted">{de.catalog.errorHint}</p>
      <button type="button" onClick={reset} className={`${ACTION_NEUTRAL} mt-2 w-auto`}>
        {de.catalog.retry}
      </button>
    </main>
  );
}
