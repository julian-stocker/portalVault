/**
 * The same head on every account page: a way back, a title, a line of
 * explanation. One component so the four pages cannot drift apart.
 */
import Link from "next/link";

import { de } from "@/lib/i18n/de";

export function AccountHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <header className="flex flex-col gap-1">
      <Link
        href="/account"
        className="text-sm text-muted underline-offset-4 hover:underline"
      >
        ← {de.account.title}
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
      {hint ? <p className="text-sm text-muted">{hint}</p> : null}
    </header>
  );
}
