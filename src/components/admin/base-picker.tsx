"use client";

import { useEffect, useState } from "react";

import { searchBaseFigures, type Basiszeile, type Basissuche }
  from "@/lib/admin/base-figure-search";
import { de } from "@/lib/i18n/de";

/**
 * „Variante von" im Figureneditor (CAT-14) — die Auswahl, ohne zu schreiben.
 *
 * DIESELBE SUCHE WIE AUF DER DETAILSEITE (`base-select.tsx`, CAT-07):
 * `searchBaseFigures`, dieselben Filter (dieselbe Serie, keine Varianten,
 * keine Entwürfe, nicht sie selbst), dieselbe Rangfolge. Der Unterschied ist
 * nur der Zeitpunkt: `BaseSelect` schreibt sofort, dieser Baustein ändert
 * den ENTWURF, und der Dialog schreibt beim Speichern über `setVariantBase`.
 *
 * DIE FAMILIENREGEL IST DIESELBE. Eine Familie wird nur angelegt, wenn
 * weder die gewählte Basisfigur eine hat noch es um etwas anderes als eine
 * Charakterfigur geht — entschieden bei der Auswahl, mitgegeben an
 * `onChange`, geprüft von `0159`.
 *
 * Der Dialog zeigt diesen Baustein nur dort, wo der Katalog gepflegt wird
 * (Staging, ADR-0167).
 */
export function BasePicker({
  skyId, disabled, onPick, onCancel, canRemove,
}: {
  skyId: string;
  disabled: boolean;
  /** `null` heißt: Zuordnung entfernen. */
  onPick: (target: { skyId: string; name: string } | null, createFamily: boolean) => void;
  onCancel: () => void;
  /** Ob heute eine Zuordnung besteht, die entfernt werden kann. */
  canRemove: boolean;
}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<Basissuche | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void searchBaseFigures(skyId, query).then((answer) => {
        if (cancelled || answer === null) return;
        setResult(answer);
      });
    }, query === "" ? 0 : 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [skyId, query]);

  function pick(target: Basiszeile) {
    const createFamily = target.characterId === null && result?.art === "character";
    onPick({ skyId: target.skyId, name: target.name }, createFamily);
  }

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-sky-md bg-base p-2.5 ring-1 ring-border">
      <label className="flex flex-col gap-1 text-xs text-muted">
        {de.admin.baseSearch}
        <input
          value={query}
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            /* Escape schließt die Suche, nicht den ganzen Dialog — `Modal`
               lässt ein bereits behandeltes Escape durch. */
            if (event.key === "Escape") { event.preventDefault(); onCancel(); }
          }}
          className="focus-ring min-h-11 rounded-sky-md bg-surface px-3 text-sm text-foreground
                     ring-1 ring-border-strong"
        />
      </label>
      {result?.serie && result.art !== null ? (
        <p className="text-[11px] text-muted">
          {de.admin.baseSearchHintClass(result.serie, de.admin.baseClassName(result.art))}
        </p>
      ) : null}

      {result !== null && result.art === null ? (
        <p role="status" className="text-xs text-muted">{de.admin.baseClassUnknown}</p>
      ) : result !== null && result.moeglich === 0 ? (
        <p className="text-xs text-muted">{de.admin.baseNoneAtAll}</p>
      ) : result !== null && result.treffer.length === 0 ? (
        <p className="text-xs text-muted">{de.admin.baseNone}</p>
      ) : result !== null ? (
        <>
          <p className="text-[11px] text-muted">
            {de.admin.baseShown(result.treffer.length, result.gefunden)}
          </p>
          <ul className="flex flex-col gap-1">
            {result.treffer.map((target) => (
              <li key={target.skyId}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => pick(target)}
                  className="focus-ring flex min-h-11 w-full flex-col items-start justify-center
                             gap-0.5 rounded-sky-md px-3 py-1.5 text-left ring-1 ring-border
                             disabled:opacity-50"
                >
                  <span className="text-sm font-medium leading-tight">{target.name}</span>
                  <span className="text-[11px] leading-tight text-muted">
                    <span className="font-mono">{target.skyId}</span>
                    {" · "}{target.seriesCode}
                    {target.varianten > 0 ? ` · ${de.admin.baseVariantsShort(target.varianten)}` : ""}
                  </span>
                  {result.empfehlung?.skyId === target.skyId ? (
                    <span className="text-[11px] leading-tight text-action-neutral-edge">
                      {de.admin.baseLikely(result.empfehlung.vorsilbe)}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-xs text-muted">{de.admin.loading}</p>
      )}

      <div className="flex flex-wrap gap-2">
        {canRemove ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onPick(null, false)}
            className="focus-ring min-h-11 rounded-sky-md bg-surface px-3 text-xs ring-1 ring-border
                       disabled:opacity-50"
          >
            {de.admin.baseRemove}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onCancel}
          className="focus-ring min-h-11 rounded-sky-md px-3 text-xs text-muted"
        >
          {de.admin.discardConfirmNo}
        </button>
      </div>
    </div>
  );
}
