/**
 * The product group of one category.
 *
 * A select, not a table of radio buttons: ten values, twenty rows, and the
 * empty option is a real choice — "not classified yet" is a state the catalog
 * understands (ADR-0041), never a synonym for `item`.
 */
"use client";

import { useState, useTransition } from "react";

import { setCatalogGroup } from "@/lib/admin/actions";
import { CATALOG_GROUPS, GROUP_LABELS, type CatalogGroup } from "@/lib/catalog/group";
import { de } from "@/lib/i18n/de";

export function GroupSelect({
  categoryId,
  group,
}: {
  categoryId: number;
  group: CatalogGroup | null;
}) {
  const [value, setValue] = useState<string>(group ?? "");
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  function change(next: string) {
    const previous = value;
    setValue(next);
    setFailed(false);
    startTransition(async () => {
      const result = await setCatalogGroup(categoryId, next);
      if (!result.ok) {
        setValue(previous);
        setFailed(true);
      }
    });
  }

  return (
    <span className="flex flex-col gap-0.5">
      <select
        value={value}
        onChange={(event) => change(event.target.value)}
        aria-busy={pending || undefined}
        className={
          "min-h-9 rounded-sky-md bg-surface/80 px-2 text-sm ring-1 ring-border/70 " +
          (value === "" ? "text-muted" : "") +
          (pending ? " opacity-70" : "")
        }
      >
        <option value="">— {de.admin.groupUnset}</option>
        {CATALOG_GROUPS.map((option) => (
          <option key={option} value={option}>
            {GROUP_LABELS[option]}
          </option>
        ))}
      </select>
      {failed ? <span className="text-[11px] text-danger">{de.admin.writeFailed}</span> : null}
    </span>
  );
}
