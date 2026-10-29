/**
 * Der redaktionelle Status einer Figur, in der Adminliste (CAT-02B).
 *
 * ES ERSETZT `VisibilityToggle` IN DER LISTE. Der Umschalter kannte zwei
 * Zustände und konnte den dritten nicht einmal anzeigen — ein Entwurf sah
 * dort aus wie etwas Zurückgezogenes. Diese Auswahl zeigt immer, was gilt.
 *
 * Optimistisch wie jede andere Änderung im Produkt (ADR-0027): die Auswahl
 * springt sofort und tritt zurück, wenn der Server widerspricht. Was sie
 * aufruft, ist eine Server-Aktion um eine Datenbankfunktion, die
 * `is_platform_admin()` selbst fragt — diese Komponente ist der Griff, nicht
 * das Schloss.
 *
 * KEIN BESTÄTIGUNGSDIALOG, und auch keine Warnung beim Zurückziehen. Der
 * Status ist ein Feld; wer ihn falsch setzt, setzt ihn zurück.
 *
 * DIE FARBE SAGT MIT, WAS DER TEXT SAGT. „Öffentlich" trägt den
 * Statusgrund, „Versteckt" und „Entwurf" bleiben ruhig und unterscheiden
 * sich im Rahmen — bei vielen Zeilen ist die Zeile mit dem helleren Grund
 * die veröffentlichte, und das ist die Frage, die man beim Überfliegen hat.
 * Die Beschriftung steht trotzdem immer da: Farbe ist hier nie das einzige
 * Signal.
 */
"use client";

import { useState, useTransition } from "react";

import { setCatalogStatus } from "@/lib/admin/actions";
import {
  CATALOG_STATUSES,
  isCatalogStatus,
  type CatalogStatus,
} from "@/lib/catalog/catalog-status";
import { de } from "@/lib/i18n/de";

const LABELS: Readonly<Record<CatalogStatus, string>> = {
  public: de.catalog.statusPublic,
  hidden: de.catalog.statusHidden,
  draft: de.catalog.statusDraft,
};

/** Öffentlich hebt sich ab, die beiden nicht öffentlichen bleiben ruhig. */
const RING: Readonly<Record<CatalogStatus, string>> = {
  public: "bg-status-ground text-status-ink ring-status-line",
  hidden: "bg-surface text-muted ring-border/70",
  draft: "bg-surface text-muted ring-border-strong/70",
};

export function StatusSelect({ skyId, status }: { skyId: string; status: CatalogStatus }) {
  const [value, setValue] = useState<CatalogStatus>(status);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  function choose(next: CatalogStatus) {
    const before = value;
    setValue(next);
    setFailed(false);
    startTransition(async () => {
      const result = await setCatalogStatus(skyId, next);
      if (!result.ok) {
        setValue(before);
        setFailed(true);
      }
    });
  }

  return (
    <span className="flex flex-col gap-0.5">
      <label>
        <span className="sr-only">{de.catalog.statusLabel}</span>
        <select
          value={value}
          onChange={(event) => {
            const next = event.target.value;
            if (isCatalogStatus(next)) choose(next);
          }}
          aria-busy={pending || undefined}
          className={
            "min-h-8 rounded-full px-2 text-xs font-medium whitespace-nowrap ring-1 "
            + RING[value]
            + (pending ? " opacity-70" : "")
          }
        >
          {CATALOG_STATUSES.map((option) => (
            <option key={option} value={option}>
              {LABELS[option]}
            </option>
          ))}
        </select>
      </label>
      {failed ? <span className="text-[11px] text-danger">{de.admin.writeFailed}</span> : null}
    </span>
  );
}
