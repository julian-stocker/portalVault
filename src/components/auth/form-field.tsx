/** Shared form primitives for the auth screens. Presentation only. */
import type { ReactNode } from "react";

import { ACTION_PRIMARY } from "@/components/ui/action";

export function Field({
  label,
  name,
  type = "text",
  autoComplete,
  defaultValue,
  hint,
  error,
  required = true,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  defaultValue?: string;
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
        defaultValue={defaultValue}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className="min-h-11 rounded-sky-md border border-border bg-background px-3 py-2 text-base focus:border-foreground"
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
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {children}
    </main>
  );
}
