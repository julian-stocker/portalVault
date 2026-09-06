/**
 * The one number that prices the shop (ADR-0045).
 *
 * A percentage of the market price, applied to every position that has no
 * price of its own. Changing it moves all of them at once — and writes
 * nothing to any of them, because no row stores an automatic price. There is
 * one number in one row, and everything else is derived at read time.
 *
 * Small on purpose: it is a settings field, not a dashboard. The example
 * underneath it is what makes the number concrete without a preview table.
 */
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { setShopPercentage } from "@/lib/admin/actions";
import { MAX_PERCENTAGE, MIN_PERCENTAGE } from "@/lib/admin/inventory-model";
import { ACTION_NEUTRAL } from "@/components/ui/action";
import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";

export function ShopSettings({ percentage }: { percentage: number }) {
  const router = useRouter();
  const [draft, setDraft] = useState(String(percentage).replace(".", ","));
  const [failed, setFailed] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const parsed = Number(draft.trim().replace(",", "."));
  const valid = Number.isFinite(parsed) && parsed >= MIN_PERCENTAGE && parsed <= MAX_PERCENTAGE;

  function submit() {
    if (!valid) {
      setFailed(de.admin.percentageRange);
      return;
    }
    setFailed(null);
    startTransition(async () => {
      const result = await setShopPercentage(parsed);
      if (!result.ok) {
        setFailed(result.message);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <section className="rounded-sky-lg bg-surface/80 px-5 py-4 ring-1 ring-border/70">
      <h2 className="font-medium">{de.admin.shopSettings}</h2>
      <p className="mt-1 text-sm text-muted">{de.admin.defaultShopPrice}</p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[11px] text-muted">
          {de.admin.percentageLabel}
          <span className="flex items-center gap-1">
            <input
              inputMode="decimal"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setSaved(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") submit();
              }}
              className="min-h-11 w-24 rounded-sky-md bg-surface px-3 text-base tabular-nums ring-1 ring-border/70 focus:ring-border-strong"
            />
            <span className="text-base text-foreground">%</span>
          </span>
        </label>

        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className={`${ACTION_NEUTRAL} w-auto px-4 disabled:opacity-60`}
        >
          {de.admin.save}
        </button>
      </div>

      {/* One worked example. A market price of 4,99 € is the most common
          shape in the catalog, so the number people see here is the number
          they will recognise on a card. */}
      <p className="mt-3 text-sm text-muted tabular-nums">
        {valid
          ? `${formatPrice(4.99)} → ${formatPrice(Math.round(4.99 * parsed) / 100)}`
          : de.admin.percentageRange}
      </p>
      <p className="mt-1 text-[11px] text-muted">
        {de.admin.percentageHint(String(percentage))}
      </p>

      {failed ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {failed}
        </p>
      ) : null}
      {saved && !failed ? (
        <p role="status" className="mt-2 text-sm text-success">
          {de.admin.percentageSaved}
        </p>
      ) : null}
    </section>
  );
}
