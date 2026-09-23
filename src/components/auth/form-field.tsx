/** Shared form primitives for the auth screens. Presentation only. */
import Link from "next/link";
import type { ReactNode } from "react";

import { ACTION_PRIMARY } from "@/components/ui/action";
import type { AuthContext } from "@/lib/auth/context";
import { de } from "@/lib/i18n/de";

const CONTEXT_NOTE: Record<AuthContext, string> = {
  collect: de.auth.context.collect,
  collection: de.auth.context.collection,
  account: de.auth.context.account,
  cart: de.auth.context.cart,
  checkout: de.auth.context.checkout,
};

/**
 * One sentence saying what the visitor was doing a moment ago (F11).
 *
 * The auth screens carried the intent perfectly and never mentioned it: a
 * visitor taps a figure, the card links to `/login?next=…&figure=SKY-0042`
 * (ADR-0027), and a bare e-mail field arrives. This is the missing sentence
 * and nothing more — `null` renders nothing at all, which is every screen
 * reached without a `next`.
 */
export function AuthContextNote({ context }: { context: AuthContext | null }) {
  if (context === null) return null;
  return (
    <p className="rounded-sky-md bg-status-ground px-3 py-2.5 text-sm leading-relaxed text-status-ink ring-1 ring-status-line">
      {CONTEXT_NOTE[context]}
    </p>
  );
}

export function Field({
  label,
  name,
  type = "text",
  autoComplete,
  defaultValue,
  value,
  onChange,
  hint,
  error,
  required = true,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  defaultValue?: string;
  /**
   * Controlled value. Used for the fields that have to survive a failed
   * submission — React empties an uncontrolled input when the form action
   * returns (src/lib/auth/preserve.ts).
   */
  value?: string;
  onChange?: (value: string) => void;
  hint?: string;
  error?: string;
  required?: boolean;
}) {
  const describedBy = [hint ? `${name}-hint` : null, error ? `${name}-error` : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        {...(value === undefined
          ? { defaultValue }
          : { value, onChange: (event) => onChange?.(event.target.value) })}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className="min-h-11 rounded-sky-md bg-surface/80 px-3 py-2 text-base ring-1 ring-border/70 focus:ring-border-strong"
      />
      {hint ? (
        <p id={`${name}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${name}-error`} className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function FormMessage({ tone, children }: { tone: "error" | "success"; children: ReactNode }) {
  const classes =
    tone === "error" ? "border-danger/40 text-danger" : "border-border text-foreground";
  return (
    <p
      className={`rounded-sky-md border px-3 py-2 text-sm ${classes}`}
      role={tone === "error" ? "alert" : "status"}
    >
      {children}
    </p>
  );
}

export function SubmitButton({ label, pending }: { label: string; pending: boolean }) {
  return (
    // A form submit genuinely must not run twice, so unlike the card actions
    // this one does disable while pending.
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      className={`${ACTION_PRIMARY} disabled:opacity-60`}
    >
      {pending ? "…" : label}
    </button>
  );
}

/**
 * The two ways in, as one control.
 *
 * TWO LINKS, NOT A CLIENT TOGGLE. `/login` and `/register` are separate
 * routes with separate server actions, separate metadata and separate
 * `next` semantics, and both stay directly addressable. A tab that swapped
 * forms in the browser would either duplicate that or hide it; this one
 * simply navigates, so there is exactly one implementation of "sign in" and
 * one of "create an account", and the back button keeps working.
 *
 * `next` travels with both, so a visitor who came from a figure lands where
 * they were headed whichever segment they pick.
 *
 * The active segment lifts onto the panel's own ground with the panel's own
 * gold hairline; the other stays flat and quiet. `aria-current="page"` is
 * what says which is which to a screen reader — the colour is not the
 * information.
 */
export function AuthTabs({ active, target }: {
  active: "login" | "register";
  /** The sanitised destination, already through `safeRedirect()`. */
  target: string;
}) {
  const query = `?next=${encodeURIComponent(target)}`;
  const segment = (on: boolean) =>
    "flex min-h-11 items-center justify-center rounded-sky-md px-3 text-sm font-medium "
    + "transition-colors focus-ring "
    + (on
      ? "bg-deep/80 text-fg ring-1 ring-gold-line"
      : "text-muted hover:text-fg");

  return (
    <nav aria-label={de.auth.tabs.label}
         className="grid grid-cols-2 gap-1 rounded-sky-md bg-surface/60 p-1 ring-1 ring-border/70">
      <Link href={`/login${query}`} aria-current={active === "login" ? "page" : undefined}
            className={segment(active === "login")}>
        {de.auth.tabs.login}
      </Link>
      <Link href={`/register${query}`} aria-current={active === "register" ? "page" : undefined}
            className={segment(active === "register")}>
        {de.auth.tabs.register}
      </Link>
    </nav>
  );
}

export function AuthCard({ title, tabs, children }: {
  title: string;
  /**
   * The segmented switch, above the heading (V4.8).
   *
   * Optional, because the password screens — forgot, reset, verify — are not
   * one of two ways in and would be lying if they offered a choice.
   */
  tabs?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-6 py-16">
      {/* A panel rather than text on the sky (ADR-0038, V3): a sign-in form
          floating on a gradient has nothing to sit on, and the deep ground
          is what keeps the inputs legible over the horizon glow. */}
      <div className="flex flex-col gap-6 rounded-sky-lg bg-deep/80 p-6 ring-1 ring-gold-line backdrop-blur-sm">
        {tabs}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {children}
      </div>
    </main>
  );
}
