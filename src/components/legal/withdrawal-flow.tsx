/**
 * The electronic withdrawal function, § 356a BGB (ADR-0086).
 *
 * TWO STEPS, BECAUSE THE STATUTE SAYS TWO. Abs. 2 lists what the consumer
 * supplies; Abs. 3 requires that they then submit it through a **separate**
 * confirmation function. A single form with one button would collapse the two
 * and would not be this function.
 *
 * THE BUTTON LABELS ARE THE LAW'S WORDS. „Vertrag widerrufen" and „Widerruf
 * bestätigen" are written into § 356a Abs. 1 and Abs. 3. They are not softened,
 * shortened or replaced with something friendlier, and a test pins both.
 *
 * NO ACCOUNT. A guest bought without one; requiring a login here would take the
 * statutory function away from exactly the buyer least able to work around it.
 *
 * ACCESSIBILITY IS PART OF THE REQUIREMENT, not a nicety: the whole flow works
 * from the keyboard, every field has a real `<label>`, errors are announced
 * through `role="alert"` and tied to their field with `aria-describedby`, and
 * the step change moves focus to the new heading so a screen reader does not
 * silently stay where the old button was.
 */
"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { ACTION_PRIMARY } from "@/components/ui/action";
import { de } from "@/lib/i18n/de";
import { declareWithdrawal } from "@/lib/legal/withdrawal-actions";

type Step = "form" | "confirm" | "done";
type Field = "orderNumber" | "name" | "email";

const PANEL = "rounded-sky-lg bg-surface/80 p-5 ring-1 ring-border/70";

export function WithdrawalFlow() {
  const copy = de.withdrawal;
  const [step, setStep] = useState<Step>("form");
  const [orderNumber, setOrderNumber] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [declaration, setDeclaration] = useState("");
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [pending, startTransition] = useTransition();

  const heading = useRef<HTMLHeadingElement>(null);
  const movedOnce = useRef(false);

  // Each step is a new screen. Focus follows it, or a screen reader stays on a
  // button that no longer exists.
  useEffect(() => {
    if (!movedOnce.current) {
      movedOnce.current = true;
      return;
    }
    heading.current?.focus();
  }, [step]);

  function validate(): boolean {
    const found: Partial<Record<Field, string>> = {};
    if (orderNumber.trim() === "") found.orderNumber = copy.errors.orderNumber;
    if (name.trim() === "") found.name = copy.errors.name;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) found.email = copy.errors.email;
    setErrors(found);
    return Object.keys(found).length === 0;
  }

  function submit() {
    startTransition(async () => {
      await declareWithdrawal({ orderNumber, name, email, declaration });
      // The action answers the same way whatever happened — see its comment.
      // So does this screen.
      setStep("done");
    });
  }

  if (step === "done") {
    return (
      <div className={PANEL}>
        <h2
          ref={heading}
          tabIndex={-1}
          className="text-lg font-semibold tracking-tight outline-none"
        >
          {copy.doneTitle}
        </h2>
        <p className="mt-3">{copy.doneBody}</p>
        <p className="mt-3 text-sm text-muted">{copy.doneHint}</p>

        <h3 className="mt-6 text-sm font-semibold">{copy.doneNext}</h3>
        <ol className="mt-2 flex list-decimal flex-col gap-2 pl-5 text-sm">
          {copy.doneSteps.map((entry) => (
            <li key={entry}>{entry}</li>
          ))}
        </ol>
      </div>
    );
  }

  if (step === "confirm") {
    return (
      <div className={PANEL}>
        <h2
          ref={heading}
          tabIndex={-1}
          className="text-lg font-semibold tracking-tight outline-none"
        >
          {copy.step2}
        </h2>
        <p className="mt-3 text-sm text-muted">{copy.reviewHint}</p>

        <dl className="mt-5 grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
          <dt className="text-sm text-muted">{copy.orderNumber}</dt>
          <dd className="tabular-nums">{orderNumber.trim()}</dd>
          <dt className="text-sm text-muted">{copy.name}</dt>
          <dd>{name.trim()}</dd>
          <dt className="text-sm text-muted">{copy.email}</dt>
          <dd className="break-words">{email.trim()}</dd>
          {declaration.trim() === "" ? null : (
            <>
              <dt className="text-sm text-muted">{copy.declaration}</dt>
              <dd className="whitespace-pre-line">{declaration.trim()}</dd>
            </>
          )}
        </dl>

        <div className="mt-6 flex flex-wrap items-center gap-4">
          {/*
           * „Widerruf bestätigen“ — the wording § 356a Abs. 3 prescribes for
           * the separate confirmation function.
           */}
          <button type="button" onClick={submit} disabled={pending} className={ACTION_PRIMARY}>
            {pending ? copy.sending : copy.confirm}
          </button>
          <button
            type="button"
            onClick={() => setStep("form")}
            disabled={pending}
            className="text-sm text-muted underline underline-offset-4 hover:text-foreground"
          >
            {copy.back}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      className={PANEL}
      onSubmit={(event) => {
        event.preventDefault();
        if (validate()) setStep("confirm");
      }}
      noValidate
    >
      <h2 ref={heading} tabIndex={-1} className="text-lg font-semibold tracking-tight outline-none">
        {copy.step1}
      </h2>

      <div className="mt-5 flex flex-col gap-5">
        <Field
          id="w-order"
          label={copy.orderNumber}
          hint={copy.orderNumberHint}
          value={orderNumber}
          onChange={setOrderNumber}
          error={errors.orderNumber}
          autoComplete="off"
        />
        <Field
          id="w-name"
          label={copy.name}
          hint={copy.nameHint}
          value={name}
          onChange={setName}
          error={errors.name}
          autoComplete="name"
        />
        <Field
          id="w-email"
          label={copy.email}
          hint={copy.emailHint}
          value={email}
          onChange={setEmail}
          error={errors.email}
          autoComplete="email"
          type="email"
        />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="w-text" className="text-sm font-medium">
            {copy.declaration}
          </label>
          <textarea
            id="w-text"
            value={declaration}
            onChange={(event) => setDeclaration(event.target.value)}
            rows={3}
            maxLength={4000}
            aria-describedby="w-text-hint"
            className="rounded-sky-md bg-surface px-3 py-2 ring-1 ring-border/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
          />
          <p id="w-text-hint" className="text-sm text-muted">
            {copy.declarationHint}
          </p>
        </div>
      </div>

      {/*
       * „Vertrag widerrufen“ — the wording § 356a Abs. 1 prescribes for the
       * withdrawal function itself.
       */}
      <button type="submit" className={`${ACTION_PRIMARY} mt-6`}>
        {copy.continue}
      </button>
    </form>
  );
}

function Field({
  id,
  label,
  hint,
  value,
  onChange,
  error,
  autoComplete,
  type = "text",
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  autoComplete?: string;
  type?: string;
}) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? hintId : `${hintId} ${errorId}`}
        className={
          "rounded-sky-md bg-surface px-3 py-2 ring-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current " +
          (error === undefined ? "ring-border/70" : "ring-danger")
        }
      />
      <p id={hintId} className="text-sm text-muted">
        {hint}
      </p>
      {/* Announced when it appears, and never colour alone. */}
      {error === undefined ? null : (
        <p id={errorId} role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
