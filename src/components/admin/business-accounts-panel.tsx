/**
 * Who may run the shop — a platform administrator's screen (ADR-0077).
 *
 * Granting somebody the shop is a platform act, not a commercial one, which is
 * why this panel lives under `/admin` and not under `/business`. A seller
 * operator cannot see this list, let alone add themselves a colleague:
 * `admin_seller_operators()` and `admin_set_seller_operator()` both ask
 * `is_platform_admin()`.
 *
 * ONE ACCOUNT, ONE TYPE (ADR-0078). An account that administers SkyIsles
 * cannot be given the shop: the database refuses it, and so does this screen,
 * with a sentence rather than a failed save. Somebody who needs both uses two
 * accounts.
 *
 * Withdrawing the shop returns the account to being an ordinary collector,
 * with its collection intact — nothing is deleted when a type changes.
 *
 * An address may FIND an account; what is stored and what authorises is the
 * account id (ADR-0032).
 */
"use client";

import { useState, useTransition } from "react";

import { ACTION_NEUTRAL, ACTION_PRIMARY } from "@/components/ui/action";
import { findAccounts, setSellerOperator } from "@/lib/admin/actions";
import type { AccountMatch } from "@/lib/admin/commerce-model";
import type { SellerOperators } from "@/lib/admin/seller-operators";
import { de } from "@/lib/i18n/de";

export function BusinessAccountsPanel({ state }: { state: SellerOperators }) {
  const copy = de.businessAccounts;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<AccountMatch[] | null>(null);

  const known = new Set(state.operators.map((operator) => operator.userId));

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
      const result = await setSellerOperator(userId, enabled);
      if (!result.ok) setError(result.message ?? copy.failed);
      else setMatches(null);
    });
  }

  return (
    <section className="mt-8 rounded-sky-lg bg-surface/80 p-5 ring-1 ring-border/70"
      aria-label={copy.heading}>
      <h2 className="text-lg font-semibold">{copy.heading}</h2>
      <p className="mt-1 text-sm text-muted">{copy.hint}</p>
      <p className="mt-1 text-sm text-muted">{copy.revokedBecomesUser}</p>
      {state.sellerName ? (
        <p className="mt-1 text-sm text-muted">
          {copy.sellerLabel}: <span className="font-medium">{state.sellerName}</span>
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <ul className="mt-4 flex flex-col gap-2">
        {state.operators.length === 0 ? (
          <li className="text-sm text-muted">{copy.empty}</li>
        ) : (
          state.operators.map((operator) => (
            <li
              key={operator.userId}
              className="flex flex-wrap items-center justify-between gap-3 rounded-sky-md bg-surface/60 px-4 py-3 text-sm"
            >
              <span>
                <span className="font-medium">{operator.username ?? operator.userId.slice(0, 8)}</span>
                <span className="ml-2 text-muted">
                  {operator.isEnabled ? copy.enabled : copy.disabled}
                </span>
                {/* Said out loud, never inferred: two grants, not a hierarchy. */}
                {operator.isPlatformAdmin ? (
                  <span className="ml-2 text-xs text-muted">· {copy.alsoAdmin}</span>
                ) : null}
              </span>
              <button
                type="button"
                disabled={pending}
                onClick={() => grant(operator.userId, !operator.isEnabled)}
                className={`${ACTION_NEUTRAL} w-auto disabled:opacity-60`}
              >
                {operator.isEnabled ? copy.disable : copy.enable}
              </button>
            </li>
          ))
        )}
      </ul>

      <div className="mt-5 flex flex-col gap-2">
        <label className="text-xs font-medium text-muted" htmlFor="operator-search">
          {copy.searchLabel}
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="operator-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy.searchPlaceholder}
            className="min-h-11 flex-1 rounded-sky-md bg-surface px-3 text-sm ring-1 ring-border/70 focus-ring"
          />
          <button
            type="button"
            disabled={pending}
            onClick={search}
            className={`${ACTION_NEUTRAL} w-auto disabled:opacity-60`}
          >
            {copy.searchLabel}
          </button>
        </div>
        <p className="text-xs text-muted">{copy.searchHint}</p>

        {matches !== null ? (
          <ul className="mt-2 flex flex-col gap-2">
            {matches.length === 0 ? (
              <li className="text-sm text-muted">{copy.searchEmpty}</li>
            ) : (
              matches.map((match) => (
                <li
                  key={match.userId}
                  className="flex flex-wrap items-center justify-between gap-3 text-sm"
                >
                  <span>{match.username ?? match.email}</span>
                  {known.has(match.userId) ? (
                    <span className="text-muted">{copy.alreadyOperator}</span>
                  ) : match.isAdmin ? (
                    // Said before the attempt, not after a refusal.
                    <span className="text-muted">{copy.isAdminAccount}</span>
                  ) : (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => grant(match.userId, true)}
                      className={`${ACTION_PRIMARY} w-auto disabled:opacity-60`}
                    >
                      {copy.grant}
                    </button>
                  )}
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
