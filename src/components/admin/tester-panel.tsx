/**
 * Test accounts and what each of them may test (ADR-0071).
 *
 * WHY THIS IS NOT PART OF THE COMMERCE PANEL ANY MORE
 *
 * Until 0036 there was one tester permission, so the tester list lived beside
 * the commerce mode it belonged to. Now there are several and more will come,
 * and a list of accounts whose permissions happen to include commerce is not a
 * commerce setting. Keeping it there would also mean two places that render
 * testers as soon as the second permission appears — the duplication this
 * migration exists to prevent.
 *
 * THE CHECKBOXES COME FROM THE DATABASE
 *
 * `admin_tester_state()` ships the registry with the testers, so this file
 * renders whatever `tester_features` holds. There is no list of features in
 * this component, and adding a third one changes no TypeScript at all.
 *
 * No address is ever sent to a mutation. The search turns a person the
 * operator knows into a `user_id`, and the id is what is granted to — the rule
 * `shop_admins` has followed since ADR-0032.
 */
"use client";

import { useState, useTransition } from "react";

import { ACTION_NEUTRAL, ACTION_PRIMARY } from "@/components/ui/action";
import { findAccounts, setTester, setTesterPermission } from "@/lib/admin/actions";
import { holds, type TesterState } from "@/lib/admin/tester-model";
import type { AccountMatch } from "@/lib/admin/commerce-model";
import { de } from "@/lib/i18n/de";

const FIELD =
  "min-h-11 w-full rounded-sky-md bg-surface px-3 text-sm ring-1 ring-border/70 focus-ring";

export function TesterPanel({ state }: { state: TesterState }) {
  const copy = de.admin.testers;
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<AccountMatch[] | null>(null);

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

  function membership(userId: string, enabled: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await setTester(userId, enabled);
      if (!result.ok) setError(result.message);
      else setMatches(null);
    });
  }

  function permission(userId: string, key: string, enabled: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await setTesterPermission(userId, key, enabled);
      if (!result.ok) setError(result.message);
    });
  }

  return (
    <section className="rounded-sky-lg bg-surface/60 p-4 ring-1 ring-border/70">
      <h2 className="text-base font-semibold">{copy.heading}</h2>
      <p className="mt-1 text-xs text-muted">{copy.hint}</p>

      {error !== null ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <ul className="mt-4 flex flex-col gap-3">
        {state.testers.length === 0 ? (
          <li className="text-sm text-muted">{copy.empty}</li>
        ) : (
          state.testers.map((tester) => (
            <li
              key={tester.userId}
              className="flex flex-col gap-3 rounded-sky-md bg-surface px-3 py-3 ring-1 ring-border/70"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0 text-sm">
                  <span className="block truncate">
                    {tester.username ?? tester.email ?? tester.userId}
                  </span>
                  {tester.username && tester.email ? (
                    <span className="block truncate text-xs text-muted">{tester.email}</span>
                  ) : null}
                </span>
                {tester.isAdmin ? (
                  /* Shown so nobody reads the two lists as one. An
                     administrator is not a tester unless they are here. */
                  <span className="shrink-0 rounded-sky-sm bg-white/10 px-2 py-0.5 text-xs text-muted">
                    {copy.isAdmin}
                  </span>
                ) : null}
              </div>

              <div className="flex flex-col gap-1.5">
                <p className="text-xs font-medium text-muted">{copy.permissionsHeading}</p>
                {state.features.map((feature) => (
                  <label key={feature.key} className="flex min-h-11 items-start gap-3">
                    <input
                      type="checkbox"
                      checked={holds(tester, feature.key)}
                      disabled={pending}
                      onChange={(event) =>
                        permission(tester.userId, feature.key, event.target.checked)
                      }
                      className="mt-0.5 h-5 w-5 accent-[#3b2a17] focus-ring"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm">{feature.label}</span>
                      <span className="block text-xs text-muted">{feature.description}</span>
                    </span>
                  </label>
                ))}
                {tester.permissions.length === 0 ? (
                  <p className="text-xs text-muted">{copy.noPermissions}</p>
                ) : null}
              </div>

              <div>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => membership(tester.userId, false)}
                  className={`${ACTION_NEUTRAL} w-auto`}
                >
                  {copy.remove}
                </button>
                <p className="mt-1 text-xs text-muted">{copy.removeHint}</p>
              </div>
            </li>
          ))
        )}
      </ul>

      {/* ---- the search ---- */}
      <label className="mt-5 block text-xs font-medium text-muted" htmlFor="tester-account-search">
        {copy.searchLabel}
      </label>
      <div className="mt-1 flex gap-2">
        <input
          id="tester-account-search"
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
            matches.map((match) => {
              const already = state.testers.some((tester) => tester.userId === match.userId);
              return (
                <li
                  key={match.userId}
                  className="flex items-center justify-between gap-3 rounded-sky-md bg-surface px-3 py-2 ring-1 ring-border/70"
                >
                  <span className="min-w-0 text-sm">
                    <span className="block truncate">
                      {match.username ?? match.email ?? match.userId}
                    </span>
                    {match.username && match.email ? (
                      <span className="block truncate text-xs text-muted">{match.email}</span>
                    ) : null}
                  </span>
                  {already ? (
                    <span className="shrink-0 text-xs text-muted">{copy.alreadyTester}</span>
                  ) : (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => membership(match.userId, true)}
                      className={`${ACTION_PRIMARY} w-auto shrink-0`}
                    >
                      {copy.add}
                    </button>
                  )}
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </section>
  );
}
