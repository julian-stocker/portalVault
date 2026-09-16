/**
 * Who may buy — the commerce mode, on /admin.
 *
 * It used to carry the tester list as well, because a tester was exactly "an
 * account that may check out while the mode is sandbox". Since 0036 that is
 * one of several tester permissions (ADR-0071), so the list moved to
 * `TesterPanel` and this panel is the one decision it is named after.
 *
 * `sandbox` still means nothing until somebody is on that list — the hint
 * below says so, and the panel beside it is where they get there.
 */
"use client";

import { useState, useTransition } from "react";

import { setCommerceMode } from "@/lib/admin/actions";
import { COMMERCE_MODES, type CommerceState } from "@/lib/admin/commerce-model";
import { de } from "@/lib/i18n/de";

export function CommercePanel({ state }: { state: CommerceState }) {
  const copy = de.admin.commerce;
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const MODE_COPY: Record<string, { label: string; hint: string }> = {
    closed: { label: copy.modeClosed, hint: copy.modeClosedHint },
    sandbox: { label: copy.modeSandbox, hint: copy.modeSandboxHint },
    live: { label: copy.modeLive, hint: copy.modeLiveHint },
  };

  function changeMode(mode: string) {
    setError(null);
    startTransition(async () => {
      const result = await setCommerceMode(mode);
      if (!result.ok) setError(result.message);
    });
  }

  return (
    <section className="rounded-sky-lg bg-surface/80 p-5 ring-1 ring-border/70">
      <h2 className="font-medium">{copy.heading}</h2>
      <p className="mt-1 text-sm text-muted">{copy.hint}</p>

      {/* ---- the mode ---- */}
      <div className="mt-4 flex flex-col gap-2">
        {COMMERCE_MODES.map((mode) => {
          const active = state.mode === mode;
          return (
            <button
              key={mode}
              type="button"
              disabled={pending || active}
              onClick={() => changeMode(mode)}
              aria-pressed={active}
              className={`rounded-sky-md px-3 py-2 text-left text-sm ring-1 ${
                active
                  ? "bg-status-ground ring-status-line text-status-ink"
                  : "bg-surface ring-border/70 text-muted hover:text-foreground"
              }`}
            >
              <span className="font-medium">{MODE_COPY[mode].label}</span>
              <span className="mt-0.5 block text-xs text-muted">{MODE_COPY[mode].hint}</span>
            </button>
          );
        })}
      </div>

      {/* How many orders were placed in each world. A test cannot erase its
          own trace, so this number is the operator's proof. */}
      {Object.keys(state.ordersByMode).length > 0 ? (
        <p className="mt-3 text-xs text-muted">
          {copy.ordersByMode}:{" "}
          {Object.entries(state.ordersByMode)
            .map(([mode, n]) => `${MODE_COPY[mode]?.label ?? mode} ${n}`)
            .join(" · ")}
        </p>
      ) : null}

      {/*
        * The tester list moved to `TesterPanel` with 0036 (ADR-0071).
        *
        * A tester is no longer "an account that may check out in sandbox" —
        * commerce is one of several permissions now, and a list of accounts
        * whose permissions happen to include it is not a commerce setting.
        * Leaving a copy here would be the second place to forget.
        */}

      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
    </section>
  );
}
