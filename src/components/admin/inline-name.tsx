/**
 * The public name, edited where it is read.
 *
 * The same field as `/admin/catalog/[skyId]`, the same server action, the
 * same database function — this is a second surface for one mutation, never
 * a second mutation (ADR-0042). What it adds is proximity: an administrator
 * who spots a wrong name in the catalog fixes it there.
 *
 * The rules the interaction follows:
 *
 *   opens with        the name that is on screen — the override if there is
 *                     one, otherwise the derived name. Editing a name should
 *                     start from the name, not from an empty box.
 *   Enter / Speichern saves
 *   Escape / blur     leaves the name as it was
 *   emptied           clears the override: the derivation applies again
 *   typed back to the derived name  clears it too, rather than storing a
 *                     redundant override that says what the derivation
 *                     already says
 *   Standard          the explicit way back, offered only while an override
 *                     exists
 *
 * The canonical, imported `name` is never touched, and neither is the slug.
 */
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { setDisplayNameOverride } from "@/lib/admin/actions";
import { de } from "@/lib/i18n/de";

/**
 * A pencil, always drawn.
 *
 * Not a hover affordance: a phone has no hover, and this is the control an
 * administrator reaches for most. Small enough to sit inside the name line
 * without taking a card's worth of attention.
 */
function PencilGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="mt-[3px] h-3 w-3 shrink-0 text-on-card-muted"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M11.5 2.5l2 2L6 12l-3 1 1-3z" />
    </svg>
  );
}

export function InlineName({
  skyId,
  displayName,
  derivedName,
  override,
}: {
  skyId: string;
  /** What the card shows right now. */
  displayName: string;
  /** What it would show with no override — the placeholder while editing. */
  derivedName: string;
  override: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  // The effective name, not an empty box: this is an edit, not a new entry.
  const [value, setValue] = useState(override ?? displayName);
  // Held locally so the card shows the new name the moment it is saved,
  // rather than after the server round trip. router.refresh() then brings
  // the server's own answer, and the two agree.
  const [shown, setShown] = useState(displayName);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  /**
   * Saves — or clears, which is the same call.
   *
   * An empty field means "back to the derivation", and so does typing the
   * derived name itself: storing it as an override would freeze a value the
   * derivation already produces, and it would survive a later correction to
   * the derivation rule. The server turns an empty string into NULL.
   */
  function save(explicitReset = false) {
    const typed = value.trim();
    const derived = override === null ? displayName : derivedName;
    const next = explicitReset || typed === derived ? "" : typed;
    setEditing(false);
    setFailed(false);
    startTransition(async () => {
      const result = await setDisplayNameOverride(skyId, next);
      if (!result.ok) {
        setFailed(true);
        return;
      }
      // Empty means "back to the derivation", and the derivation is what the
      // placeholder shows.
      setShown(next === "" ? (override === null ? displayName : derivedName) : next);
      router.refresh();
    });
  }

  function cancel() {
    setValue(override ?? displayName);
    setEditing(false);
    setFailed(false);
  }

  if (!editing) {
    return (
      <span className="flex min-w-0 items-start gap-1">
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={de.admin.editNameFor(shown)}
          className={
            "line-clamp-2 min-w-0 text-left text-sm leading-snug font-semibold text-on-card " +
            "underline decoration-dotted decoration-on-card-muted underline-offset-4 " +
            "hover:decoration-solid" +
            (pending ? " opacity-60" : "")
          }
        >
          {shown}
        </button>
        <PencilGlyph />
        {override !== null ? (
          /* So an override is never a silent rewrite: the card says that this
             name was chosen rather than derived. */
          <span
            title={de.admin.overrideActive}
            aria-label={de.admin.overrideActive}
            className="mt-0.5 shrink-0 rounded-sm bg-on-card/10 px-1 text-[10px] leading-4 text-on-card-muted"
          >
            ✎
          </span>
        ) : null}
        {failed ? <span className="text-[10px] text-danger">{de.admin.writeFailed}</span> : null}
      </span>
    );
  }

  return (
    <span className="flex min-w-0 flex-col gap-1">
      <input
        autoFocus
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") save();
          if (event.key === "Escape") cancel();
        }}
        onBlur={cancel}
        aria-label={de.admin.overrideLabel}
        className={
          "min-h-8 w-full rounded-sky-sm bg-plate px-2 text-sm text-on-plate " +
          "ring-1 ring-card-border focus:ring-accent"
        }
      />
      {/* Two words, not a sentence: a card is 150 px wide on a phone, and
          the long explanation belongs on the detail page where there is
          room for it. */}
      <span className="flex items-center gap-3 text-[11px] text-on-card-muted">
        {/* onMouseDown, not onClick: the blur above would cancel first. */}
        <button
          type="button"
          onMouseDown={() => save()}
          className="font-medium text-on-card underline"
        >
          {de.admin.save}
        </button>
        {override !== null ? (
          <button
            type="button"
            onMouseDown={() => save(true)}
            className="underline"
            title={de.admin.resetToDerived}
          >
            {de.admin.resetName}
          </button>
        ) : null}
      </span>
    </span>
  );
}
