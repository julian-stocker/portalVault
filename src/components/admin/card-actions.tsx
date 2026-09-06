/**
 * What an administrator can do to a figure from the catalog itself.
 *
 * Two controls, both named, both large enough for a thumb: show or hide, and
 * open the full editor. Deliberately **not** "tap the card to hide it" — on a
 * phone that is one mis-tap away from taking a figure out of the public
 * catalog, and the card is the one thing your finger lands on while scrolling
 * (ADR-0042).
 *
 * Neither control is a permission. Both call server actions that call
 * database functions that ask `is_shop_admin()` themselves; this component
 * only decides what the button looks like.
 */
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { setCatalogVisible } from "@/lib/admin/actions";
import { ACTION_CARD } from "@/components/ui/action";
import { de } from "@/lib/i18n/de";

export function AdminCardActions({
  skyId,
  visible,
  onVisibilityChange,
}: {
  skyId: string;
  visible: boolean;
  /** Lets the catalog mark the card at once, before the server answers. */
  onVisibilityChange: (skyId: string, visible: boolean) => void;
}) {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const desired = !visible;
    onVisibilityChange(skyId, desired); // optimistic
    setFailed(false);
    startTransition(async () => {
      const result = await setCatalogVisible(skyId, desired);
      if (!result.ok) {
        onVisibilityChange(skyId, visible);
        setFailed(true);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={visible}
        aria-label={visible ? de.admin.hideLong : de.admin.showLong}
        aria-busy={pending || undefined}
        className={
          `${ACTION_CARD} gap-1.5 ` +
          (visible ? "" : "bg-[#4a2f17] text-[#f6d9a8] ") +
          (pending ? "opacity-70" : "")
        }
      >
        {visible ? de.admin.hide : de.admin.show}
      </button>

      <Link
        href={`/admin/catalog/${skyId}`}
        className="text-center text-[11px] text-on-card-muted underline underline-offset-2 hover:text-on-card"
      >
        {de.admin.details}
      </Link>

      {failed ? (
        <p role="alert" className="text-center text-[11px] text-danger">
          {de.admin.writeFailed}
        </p>
      ) : null}
    </div>
  );
}

/** The chip that marks a figure the public catalog no longer shows. */
export function HiddenBadge() {
  return (
    <span
      className={
        "absolute top-2 left-2 rounded-full bg-[#3b2a17]/90 px-2 py-0.5 text-[11px] " +
        "leading-none font-medium text-[#f6d9a8] ring-1 ring-[#f0c073]/40"
      }
    >
      {de.admin.hiddenBadge}
    </span>
  );
}
