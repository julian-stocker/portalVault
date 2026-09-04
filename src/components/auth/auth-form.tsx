/**
 * Client wrapper around a Server Action.
 *
 * Fields are described as plain data rather than passed as a render function.
 * A function cannot cross the server/client boundary, and every auth screen
 * needs the same pending and error handling anyway.
 */
"use client";

import { useActionState } from "react";

import { Field, FormMessage, SubmitButton } from "@/components/auth/form-field";
import type { ActionState } from "@/lib/auth/actions";

const INITIAL: ActionState = { error: null };

export type FieldConfig = {
  name: "email" | "password" | "username";
  label: string;
  type?: string;
  autoComplete?: string;
  defaultValue?: string;
  hint?: string;
};

export function AuthForm({
  action,
  submitLabel,
  fields,
  hidden,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel: string;
  fields: readonly FieldConfig[];
  hidden?: Readonly<Record<string, string>>;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {/* The action builds absolute email links and needs the origin. */}
      <input
        type="hidden"
        name="origin"
        value={typeof window === "undefined" ? "" : window.location.origin}
      />
      {Object.entries(hidden ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      {fields.map((field) => (
        <Field
          key={field.name}
          label={field.label}
          name={field.name}
          type={field.type}
          autoComplete={field.autoComplete}
          defaultValue={field.defaultValue}
          hint={field.hint}
          error={state.error?.field === field.name ? state.error.message : undefined}
        />
      ))}

      {state.error?.field === "form" ? (
        <FormMessage tone="error">{state.error.message}</FormMessage>
      ) : null}
      {state.success ? <FormMessage tone="success">{state.success}</FormMessage> : null}

      <SubmitButton label={submitLabel} pending={pending} />
    </form>
  );
}
