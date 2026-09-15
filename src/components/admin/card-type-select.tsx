/**
 * Which base artwork a figure is printed on (V3.5).
 *
 * The same shape as `GroupSelect`, deliberately: a closed set of values
 * already has a pattern in this admin — a `<select>` built from the one
 * central list, an optimistic change that rolls back when the write fails,
 * and a quiet line of red underneath. A second pattern for a second closed
 * set would be a second thing to keep in step.
 *
 * FIVE OPTIONS AND NO EMPTY ONE. `catalog_group` is nullable and needs a
 * "— nicht gesetzt" entry; `card_type` is NOT NULL with a default, so every
 * figure always has one and "unset" is not a state it can be in. `Standard`
 * is what a figure is when nobody has decided otherwise.
 *
 * WHAT CHANGING IT DOES, AND WHAT IT DOES NOT. It swaps the card the figure
 * is drawn on. It does not touch the name: set "Dark Spyro" to Standard and
 * it is still called Spyro (Dark) everywhere, because the variant system
 * reads the name and this reads a column, and the two never meet.
 */
"use client";

import { useState, useTransition } from "react";

import { setCardType } from "@/lib/admin/actions";
import { CARD_TYPES, CARD_TYPE_LABELS, type CardType } from "@/lib/catalog/card-type";
import { de } from "@/lib/i18n/de";

export function CardTypeSelect({ skyId, cardType }: { skyId: string; cardType: CardType }) {
  const [value, setValue] = useState<CardType>(cardType);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  function change(next: string) {
    const previous = value;
    setValue(next as CardType);
    setFailed(false);
    startTransition(async () => {
      const result = await setCardType(skyId, next);
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
        aria-label={de.admin.cardType}
        aria-busy={pending || undefined}
        className={
          "min-h-9 rounded-sky-md bg-surface/80 px-2 text-sm ring-1 ring-border/70" +
          (pending ? " opacity-70" : "")
        }
      >
        {CARD_TYPES.map((option) => (
          <option key={option} value={option}>
            {CARD_TYPE_LABELS[option]}
          </option>
        ))}
      </select>
      {failed ? <span className="text-[11px] text-danger">{de.admin.writeFailed}</span> : null}
    </span>
  );
}
