/**
 * Who may buy, and who may buy while we are testing — on /admin.
 *
 * Two decisions in one panel because they are one decision: the mode only
 * means something once somebody is on the list, and the list only means
 * something while the mode is sandbox.
 *
 * THE SEARCH IS A SEARCH. It takes a username or an address and returns
 * accounts; what gets granted is the `user_id` of the row that was picked.
 * No address is ever sent to `setCommerceTester()` and none would be accepted
 * (ADR-0032).
 */
"use client";

import { useState, useTransition } from "react";

import { ACTION_NEUTRAL, ACTION_PRIMARY } from "@/components/ui/action";
import { findAccounts, setCommerceMode, setCommerceTester } from "@/lib/admin/actions";
import { COMMERCE_MODES, type AccountMatch, type CommerceState } from "@/lib/admin/commerce-model";
import { de } from "@/lib/i18n/de";

const FIELD =
  "min-h-11 w-full rounded-sky-md bg-surface px-3 text-sm ring-1 ring-border/70 focus:ring-accent";

export function CommercePanel({ state }: { state: CommerceState }) {
  const copy = de.admin.commerce;
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<AccountMatch[] | null>(null);

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

  function search() {
    setError(null);
    startTransition(async () => {
      const result = await findAccounts(query);
      if (result.ok) setMatches(result.matches);
      else {
        setMatches(null);
        setError(result.message);
      }
    });
  }

  function grant(userId: string, enabled: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await setCommerceTester(userId, enabled);
      if (result.ok) setMatches(null);
      else setError(result.message);
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
                  ? "bg-accent/15 ring-accent text-foreground"
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

      {/* ---- the testers ---- */}
      <h3 className="mt-6 text-sm font-medium">{copy.testersHeading}</h3>
      <p className="mt-1 text-xs text-muted">{copy.testersHint}</p>

      <ul className="mt-3 flex flex-col gap-2">
        {state.testers.length === 0 ? (
          <li className="text-sm text-muted">{copy.testersEmpty}</li>
        ) : (
          state.testers.map((tester) => (
            <li
              key={tester.userId}
              className="flex items-center justify-between gap-3 rounded-sky-md bg-surface px-3 py-2 ring-1 ring-border/70"
            >
              <span className="min-w-0 text-sm">
                <span className="block truncate">{tester.username ?? tester.email ?? tester.userId}</span>
                {tester.username && tester.email ? (
                  <span className="block truncate text-xs text-muted">{tester.email}</span>
                ) : null}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {tester.isAdmin ? (
                  <span className="rounded-sky-sm bg-white/10 px-2 py-0.5 text-xs text-muted">
                    {copy.isAdmin}
                  </span>
                ) : null}
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => grant(tester.userId, false)}
                  className={ACTION_NEUTRAL}
                >
                  {copy.disable}
                </button>
              </span>
            </li>
          ))
        )}
      </ul>

      {/* ---- the search ---- */}
      <label className="mt-5 block text-xs font-medium text-muted" htmlFor="tester-search">
        {copy.searchLabel}
      </label>
      <div className="mt-1 flex gap-2">
        <input
          id="tester-search"
          className={FIELD}
          value={query}
          placeholder={copy.searchPlaceholder}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              search();
            }
          }}
        />
        <button type="button" disabled={pending} onClick={search} className={ACTION_PRIMARY}>
          {copy.searchLabel}
        </button>
      </div>
      <p className="mt-1 text-xs text-muted">{copy.searchHint}</p>

      {matches !== null ? (
        <ul className="mt-3 flex flex-col gap-2">
          {matches.length === 0 ? (
            <li className="text-sm text-muted">{copy.searchEmpty}</li>
          ) : (
            matches.map((match) => (
              <li
                key={match.userId}
                className="flex items-center justify-between gap-3 rounded-sky-md bg-surface px-3 py-2 ring-1 ring-border/70"
              >
                <span className="min-w-0 text-sm">
                  <span className="block truncate">{match.username ?? match.email ?? match.userId}</span>
                  {match.username && match.email ? (
                    <span className="block truncate text-xs text-muted">{match.email}</span>
                  ) : null}
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => grant(match.userId, !match.isTester)}
                  className={match.isTester ? ACTION_NEUTRAL : ACTION_PRIMARY}
                >
                  {match.isTester ? copy.disable : copy.enable}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}

      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
    </section>
  );
}
