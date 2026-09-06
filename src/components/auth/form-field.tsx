/** Shared form primitives for the auth screens. Presentation only. */
import type { ReactNode } from "react";

import { ACTION_PRIMARY } from "@/components/ui/action";

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

export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-6 py-16">
      {/* A panel rather than text on the sky (ADR-0038, V3): a sign-in form
          floating on a gradient has nothing to sit on, and the deep ground
          is what keeps the inputs legible over the horizon glow. */}
      <div className="flex flex-col gap-6 rounded-sky-lg bg-deep/80 p-6 ring-1 ring-gold-line backdrop-blur-sm">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {children}
      </div>
    </main>
  );
}
