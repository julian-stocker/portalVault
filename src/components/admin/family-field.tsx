"use client";

import { useEffect, useState } from "react";

import { searchFamilies, type Familienzeile } from "@/lib/admin/family-search";
import { planNewFamily, type FamilyRef } from "@/lib/admin/family-draft";
import { de } from "@/lib/i18n/de";

/**
 * Die Familie im kompakten Figureneditor (CAT-18).
 *
 * DAS GEGENSTÜCK ZU `family-select.tsx`, MIT EINEM UNTERSCHIED: jenes
 * schreibt auf der Detailseite sofort, dieses SCHREIBT NICHTS. Es meldet dem
 * Dialog eine Wahl, der Dialog trägt sie in den Entwurf, und erst „Speichern"
 * schreibt — über dieselben Wege (`setFigureCharacter`, für „anlegen"
 * `createAndAssignFamily`).
 *
 * Die Suche zeigt zu jeder Familie Mitglieder und Serien: eine Familie darf
 * Figuren aus mehreren Serien haben (ADR-0034), und erst die Mitglieder
 * sagen, ob es die richtige ist.
 */
export function FamilyPicker({
  disabled, canRemove, onPick, onPlanNew, onCancel,
}: {
  disabled: boolean;
  canRemove: boolean;
  /** Eine bestehende Familie, oder `null` für „keine". */
  onPick: (family: FamilyRef | null) => void;
  /** Eine neue Familie vormerken; angelegt wird beim Speichern. */
  onPlanNew: (name: string) => void;
  onCancel: () => void;
}) {
  const [suche, setSuche] = useState("");
  const [treffer, setTreffer] = useState<Familienzeile[]>([]);

  useEffect(() => {
    let abgebrochen = false;
    const t = setTimeout(() => {
      void searchFamilies(suche).then((antwort) => {
        if (!abgebrochen && antwort !== null) setTreffer(antwort);
      });
    }, suche === "" ? 0 : 250);
    return () => { abgebrochen = true; clearTimeout(t); };
  }, [suche]);

  /* Anlegen nur, wenn es den Namen unter den Treffern nicht schon gibt —
     dieselbe Prüfung, die `planNewFamily` beim Übernehmen noch einmal macht. */
  const neu = planNewFamily(
    { baseSkyId: null, characterId: null, newFamilyName: null },
    suche, treffer,
  );

  return (
    <div className="mt-2 rounded-sky-md bg-base p-2 ring-1 ring-border">
      <label className="flex flex-col gap-1 text-xs text-muted">
        {de.admin.familySearch}
        <input
          value={suche}
          autoFocus
          disabled={disabled}
          onChange={(event) => setSuche(event.target.value)}
          onKeyDown={(event) => {
            /* Escape schließt die Suche, nicht den Dialog (`Modal` ignoriert
               ein Escape mit `defaultPrevented`). */
            if (event.key === "Escape") { event.preventDefault(); onCancel(); }
          }}
          className="focus-ring min-h-11 rounded-sky-md bg-surface px-3 text-sm
                     text-foreground ring-1 ring-border-strong"
        />
      </label>

      {treffer.length === 0 ? (
        <p className="mt-2 text-xs text-muted">{de.admin.familyNone}</p>
      ) : (
        <ul className="mt-2 flex max-h-56 flex-col gap-1 overflow-y-auto">
          {treffer.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPick({ id: f.id, name: f.name })}
                className="focus-ring flex min-h-11 w-full flex-col items-start rounded-sky-md px-3
                           py-1.5 text-left text-xs ring-1 ring-border disabled:opacity-50"
              >
                <span className="font-medium">{f.name}</span>
                <span className="text-[11px] text-muted">
                  {de.admin.familyMembers(f.mitglieder)}
                  {f.serien.length > 0 ? ` · ${f.serien.join(" ")}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        {neu !== null ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onPlanNew(neu.newFamilyName!)}
            className="focus-ring min-h-11 rounded-sky-md bg-surface px-3 text-xs ring-1 ring-border
                       disabled:opacity-50"
          >
            {de.admin.familyCreateOnSave(neu.newFamilyName!)}
          </button>
        ) : null}
        {canRemove ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onPick(null)}
            className="focus-ring min-h-11 rounded-sky-md bg-surface px-3 text-xs ring-1 ring-border
                       disabled:opacity-50"
          >
            {de.admin.familyRemove}
          </button>
        ) : null}
        <button type="button" onClick={onCancel}
                className="focus-ring min-h-11 rounded-sky-md px-3 text-xs text-muted">
          {de.admin.discardConfirmNo}
        </button>
      </div>
    </div>
  );
}
