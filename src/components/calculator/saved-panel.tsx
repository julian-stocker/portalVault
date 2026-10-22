/**
 * Die gespeicherten Kalkulationen (Calculator V2, ADR-0131).
 *
 * WARUM SIE DEN MITTLEREN BEREICH ÜBERNIMMT, statt unter dem Kalkulator zu
 * stehen. Das Fenster hat eine Deckelhöhe, und die unterste Zeile trägt die
 * Zahl, wegen der jemand es öffnet (max. Einkaufspreis). Eine Liste
 * *unterhalb* davon würde genau diese Zahl aus dem Bild schieben — auf einem
 * Telefon sofort, am Schreibtisch bei zehn Einträgen. Deshalb tauschen Suche
 * und Positionsliste gegen diese Liste, während Kopf und Fuß stehen bleiben:
 * dieselbe Fläche, ein anderer Inhalt, und die Summen bleiben sichtbar.
 *
 * WAS HIER STEHT, HAT JEMAND AUSDRÜCKLICH GESPEICHERT. Kein Arbeitsstand,
 * keine Automatik, keine halbe Rechnung — das ist die Trennung, die ADR-0131
 * schützt, und sie ist der Grund, warum diese Liste überhaupt eine eigene
 * Fläche bekommt.
 *
 * SIE SCHREIBT NICHTS SELBST. Öffnen, umbenennen und löschen melden nach
 * oben; die Serveraktionen liegen in `lib/calculator/saved-actions.ts`.
 */
"use client";

import { useState } from "react";

import { ACTION_NEUTRAL } from "@/components/ui/action";
import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";
import { centsToEuro } from "@/lib/calculator/calculation";
import { normalizeName, type SavedCalculation } from "@/lib/calculator/saved";

const copy = de.calculator;

/** Tag und Uhrzeit, kurz — dieselbe Locale wie der Rest des Betriebs. */
function kurzesDatum(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("de-AT", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export function SavedPanel({
  state, calculations, onOpen, onRename, onDelete, onBack, onRetry,
}: {
  state: "loading" | "ready" | "failed";
  calculations: readonly SavedCalculation[];
  onOpen: (calculation: SavedCalculation) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onBack: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-on-deep">{copy.savedListTitle}</h3>
        <button type="button" onClick={onBack}
                className="focus-ring h-9 rounded-sky-sm px-2 text-xs text-on-deep-muted underline underline-offset-2">
          {copy.savedListBack}
        </button>
      </div>

      {state === "loading" ? (
        <p className="py-8 text-center text-sm text-on-deep-muted">{copy.savedListLoading}</p>
      ) : state === "failed" ? (
        <div className="py-8 text-center">
          <p role="alert" className="text-sm text-danger">{copy.savedListFailed}</p>
          <button type="button" onClick={onRetry}
                  className={`${ACTION_NEUTRAL} mt-3 h-9 w-auto min-h-9 px-3 text-xs`}>
            {copy.saveRetry}
          </button>
        </div>
      ) : calculations.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-sm text-on-deep">{copy.savedListEmpty}</p>
          <p className="mt-1 text-xs text-on-deep-muted">{copy.savedListEmptyHint}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {calculations.map((calculation) => (
            <SavedRow
              key={calculation.id}
              calculation={calculation}
              onOpen={() => onOpen(calculation)}
              onRename={(name) => onRename(calculation.id, name)}
              onDelete={() => onDelete(calculation.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- Ein Eintrag */

function SavedRow({
  calculation, onOpen, onRename, onDelete,
}: {
  calculation: SavedCalculation;
  onOpen: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(calculation.name);
  const [confirming, setConfirming] = useState(false);

  function commitRename() {
    const clean = normalizeName(draft);
    if (clean !== "" && clean !== calculation.name) onRename(clean);
    setRenaming(false);
  }

  return (
    <li className="rounded-sky-md bg-surface/70 px-3 py-2 ring-1 ring-border/70">
      {/*
        EINE ZEILE, DIE AUF EINEM TELEFON UMBRICHT statt zu schrumpfen.
        Name und Zahlen links, Aktionen rechts; bei wenig Platz rutschen die
        Aktionen unter den Namen, und beide bleiben mit 44 px bedienbar.
      */}
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-48">
          {renaming ? (
            <input
              autoFocus
              type="text"
              value={draft}
              aria-label={copy.saveNameLabel}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") { setDraft(calculation.name); setRenaming(false); }
              }}
              className="h-10 w-full rounded-sky-sm bg-surface px-2 text-sm ring-1 ring-border-strong focus-ring"
            />
          ) : (
            <button type="button" onClick={onOpen}
                    aria-label={copy.savedOpenLabel(calculation.name)}
                    className="focus-ring block max-w-full truncate rounded-sky-sm text-left text-sm font-medium text-on-deep underline-offset-2 hover:underline">
              {calculation.name}
            </button>
          )}

          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-on-deep-muted">
            <span className="tabular-nums">
              {copy.savedListCount(calculation.positions, calculation.units)}
            </span>
            <span className="font-semibold tabular-nums text-on-deep">
              {formatPrice(centsToEuro(calculation.totalCents))}
            </span>
            <span className="tabular-nums">
              {copy.savedListUpdated(kurzesDatum(calculation.updatedAt))}
            </span>
            {/* Der Status, wenn er etwas sagt. „In Prüfung" ist der
                Vorgabewert und bleibt deshalb stumm — eine Marke, die an
                jedem Eintrag steht, trägt keine Auskunft. */}
            {calculation.status === "review" ? null : (
              <span className="rounded-sky-sm bg-deep/50 px-1.5 py-0.5">
                {copy.status[calculation.status]}
              </span>
            )}
            {/* Schon ein Einkauf? Dann ist die Übernahme vergeben
                (ADR-0131, Punkt 6). */}
            {calculation.purchaseId === null ? null : (
              <span className="rounded-sky-sm bg-deep/50 px-1.5 py-0.5">
                {copy.handOverDone}
              </span>
            )}
          </p>
        </div>

        {confirming ? (
          <span className="flex flex-wrap items-center gap-2">
            <span role="alert" className="text-xs text-on-deep">
              {copy.savedDeleteConfirm(calculation.name)}
            </span>
            <button type="button" onClick={() => { setConfirming(false); onDelete(); }}
                    className={`${ACTION_NEUTRAL} h-10 w-auto min-h-10 px-3 text-xs`}>
              {copy.savedDeleteYes}
            </button>
            <button type="button" onClick={() => setConfirming(false)}
                    className="focus-ring h-10 rounded-sky-sm px-2 text-xs text-on-deep-muted underline underline-offset-2">
              {copy.cancel}
            </button>
          </span>
        ) : (
          <span className="flex shrink-0 items-center gap-1">
            <button type="button" onClick={onOpen}
                    className={`${ACTION_NEUTRAL} h-10 w-auto min-h-10 px-3 text-xs`}>
              {copy.savedOpen}
            </button>
            <button type="button" onClick={() => { setDraft(calculation.name); setRenaming(true); }}
                    aria-label={copy.savedRenameLabel(calculation.name)}
                    className="focus-ring h-10 rounded-sky-sm px-2 text-xs text-on-deep-muted underline underline-offset-2">
              {copy.savedRename}
            </button>
            <button type="button" onClick={() => setConfirming(true)}
                    aria-label={copy.savedDeleteLabel(calculation.name)}
                    className="focus-ring h-10 rounded-sky-sm px-2 text-xs text-on-deep-muted underline underline-offset-2 hover:text-danger">
              {copy.savedDelete}
            </button>
          </span>
        )}
      </div>
    </li>
  );
}
