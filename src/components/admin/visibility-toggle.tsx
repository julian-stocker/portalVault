/**
 * Show or hide a figure in the public catalog.
 *
 * Optimistic like every other mutation in the product (ADR-0027): the switch
 * moves at once and steps back if the server disagrees. What it calls is a
 * server action wrapping a database function that asks `is_shop_admin()`
 * itself — this component is the handle, not the lock.
 */
"use client";

import { useState, useTransition } from "react";

import { setCatalogVisible } from "@/lib/admin/actions";
import { de } from "@/lib/i18n/de";

export function VisibilityToggle({ skyId, visible }: { skyId: string; visible: boolean }) {
  const [on, setOn] = useState(visible);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const desired = !on;
    setOn(desired);
    setFailed(false);
    startTransition(async () => {
      const result = await setCatalogVisible(skyId, desired);
      if (!result.ok) {
        setOn(!desired);
        setFailed(true);
      }
    });
  }

  return (
    <span className="flex flex-col gap-0.5">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={on}
        aria-busy={pending || undefined}
        className={
          "min-h-8 rounded-full px-3 text-xs font-medium whitespace-nowrap ring-1 " +
          (on
            ? "bg-accent-subtle text-accent ring-accent/60"
            : "bg-surface text-muted ring-border/70") +
          (pending ? " opacity-70" : "")
        }
      >
        {on ? de.admin.visible : de.admin.hidden}
      </button>
      {failed ? <span className="text-[11px] text-danger">{de.admin.writeFailed}</span> : null}
    </span>
  );
}
