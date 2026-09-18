/**
 * The one action on the reports page: write a finished month down (ADR-0082).
 *
 * Deliberately a button and not something the page does by itself. If opening
 * the archive finalized whatever was due, a report would carry the timestamp
 * of a page view — and a month nobody looked at until March would be finalized
 * in March, quietly including everything that arrived in between. It would
 * still be stable afterwards; *when* it was made would be an accident.
 *
 * The database is the rule, as always: it refuses a month that has not ended
 * and returns the existing report unchanged for one that already has one. A
 * double click produces one statement, not two.
 */
"use client";

import { useState, useTransition } from "react";

import { ACTION_PRIMARY } from "@/components/ui/action";
import { finalizeMonthlyReport } from "@/lib/admin/report-actions";
import { de } from "@/lib/i18n/de";

export function ReportCreateButton({ year, month }: { year: number; month: number }) {
  const copy = de.business.reports;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function create() {
    setError(null);
    startTransition(async () => {
      const result = await finalizeMonthlyReport(year, month);
      // On success the server action revalidates this route and the row
      // re-renders as "Verfügbar" with its figures. Nothing to set here.
      if (!result.ok) setError(result.message);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" onClick={create} disabled={pending} className={ACTION_PRIMARY}>
        {pending ? copy.creating : copy.create}
      </button>
      {error === null ? null : <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
