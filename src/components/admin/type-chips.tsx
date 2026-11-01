"use client";

import { useState } from "react";

import {
  CATALOG_TYPES, TYPE_GROUPS, TYPE_GROUP_LABELS, TYPE_GROUP_ORDER, TYPE_LABELS,
  asCatalogTypes, type CatalogType,
} from "@/lib/catalog/catalog-type";
import { de } from "@/lib/i18n/de";

/**
 * Die Types einer Figur als kompakte Chips (CAT-14).
 *
 * ERSETZT DIE DREI KÄSTCHENGRUPPEN im Figureneditor. Gezeigt wird nur, was
 * gesetzt ist; das Plus öffnet die übrigen, nach denselben drei Gruppen.
 *
 * SIE ÄNDERN NUR DEN ENTWURF. Geschrieben wird beim Speichern des Dialogs,
 * über `setFigureTypes` (`0163`) — und die Regeln liegen dort: nur die
 * siebzehn bekannten Werte, und fällt der Banner-Type heraus, setzt die
 * Datenbank das Banner auf „–". Hier wird keine davon nachgebaut.
 *
 * Die Chips sind bewusst kompakt (32 px Zielhöhe statt der 44 px des
 * übrigen Dialogs): sieben gesetzte Types sollen in eine Zeile passen. Das
 * liegt über der WCAG-Mindestgröße von 24 px.
 */
export function TypeChips({
  types, bannerType, disabled, onChange,
}: {
  types: readonly CatalogType[];
  /** Der heute gespeicherte Banner-Type, nur zur Kennzeichnung. */
  bannerType: string | null;
  disabled: boolean;
  onChange: (next: CatalogType[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const missing = CATALOG_TYPES.filter((type) => !types.includes(type));

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-wrap items-center gap-1.5">
        {types.length === 0 ? (
          <li className="text-sm text-muted">{de.admin.typeNone}</li>
        ) : null}
        {types.map((type) => (
          <li key={type}>
            <span className="inline-flex min-h-8 items-center gap-1 rounded-full bg-surface
                             py-0.5 pr-0.5 pl-2.5 text-xs ring-1 ring-border">
              {TYPE_LABELS[type]}
              {bannerType === type ? (
                <span className="text-[10px] uppercase tracking-wide text-muted">
                  · {de.admin.typeBanner}
                </span>
              ) : null}
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(asCatalogTypes(types.filter((t) => t !== type)))}
                aria-label={de.admin.typeRemove(TYPE_LABELS[type])}
                className="focus-ring inline-flex h-7 w-7 items-center justify-center rounded-full
                           text-muted hover:bg-white/10 hover:text-foreground disabled:opacity-50"
              >
                <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3 w-3" fill="none"
                     stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </span>
          </li>
        ))}
        {missing.length > 0 ? (
          <li>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setAdding((open) => !open)}
              aria-expanded={adding}
              aria-label={adding ? de.admin.typeAddClose : de.admin.typeAdd}
              className="focus-ring inline-flex h-8 w-8 items-center justify-center rounded-full
                         text-muted ring-1 ring-border hover:text-foreground disabled:opacity-50"
            >
              <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none"
                   stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                {adding ? <path d="M4 8h8" /> : <path d="M8 3v10M3 8h10" />}
              </svg>
            </button>
          </li>
        ) : null}
      </ul>

      {adding ? (
        <div className="flex flex-col gap-2 rounded-sky-md bg-base p-2.5 ring-1 ring-border">
          {TYPE_GROUP_ORDER.map((group) => {
            const open = TYPE_GROUPS[group].filter((type) => !types.includes(type));
            if (open.length === 0) return null;
            return (
              <div key={group} className="flex flex-col gap-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
                  {TYPE_GROUP_LABELS[group]}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {open.map((type) => (
                    <button
                      key={type}
                      type="button"
                      disabled={disabled}
                      onClick={() => onChange(asCatalogTypes([...types, type]))}
                      className="focus-ring inline-flex min-h-8 items-center rounded-full px-2.5
                                 text-xs text-muted ring-1 ring-border hover:text-foreground
                                 disabled:opacity-50"
                    >
                      + {TYPE_LABELS[type]}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
