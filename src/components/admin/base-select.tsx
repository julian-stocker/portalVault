"use client";

import { useEffect, useState, useTransition } from "react";

import { setVariantBase } from "@/lib/admin/actions";
import { searchBaseFigures, type Basiszeile, type Basissuche }
  from "@/lib/admin/base-figure-search";
import { de } from "@/lib/i18n/de";

/**
 * CAT-07 — „Variante von" an einer BESTEHENDEN Figur.
 *
 * SETZEN, ÄNDERN, ENTFERNEN — jederzeit, auch an einer längst
 * veröffentlichten Figur. Eine Variantenzuordnung ist eine redaktionelle
 * Korrektur: sie wird falsch, sie wird nachgeholt, sie wird zurückgenommen.
 *
 * SIE SCHREIBT EINE SPALTE. `base_sky_id` entscheidet, womit die Figur
 * zusammen angezeigt und sortiert wird — nicht, was sie ist. SKY-ID, Slug,
 * Name, Bild, Edition, Preis, Angebote, Sammlungen und Bestellungen bleiben
 * unberührt. Die Familie kommt aus der Basisfigur mit, wenn die Figur keine
 * hat; widersprechen sich beide, weist `0159` es ab.
 *
 * NICHTS WIRD VORGESCHLAGEN. Die vier Filter (dieselbe Serie, keine
 * Varianten, keine Entwürfe, nicht sie selbst) entscheiden, was WÄHLBAR
 * ist; welche davon richtig ist, entscheidet ein Mensch. Die Vorschlagsliste
 * dafür liegt daneben, nicht darin.
 */
export function BaseSelect({
  skyId, baseSkyId, baseName, hatVarianten,
}: {
  skyId: string;
  /** Die heutige Zuordnung, oder `null`. */
  baseSkyId: string | null;
  /** Ihr Name, falls bekannt — für die Anzeige ohne zweite Abfrage. */
  baseName: string | null;
  /** Wie viele Varianten auf DIESE Figur zeigen. */
  hatVarianten: number;
}) {
  const [offen, setOffen] = useState(false);
  const [suche, setSuche] = useState("");
  const [basis, setBasis] = useState<Basissuche | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!offen) return;
    let abgebrochen = false;
    const t = setTimeout(() => {
      void searchBaseFigures(skyId, suche).then((antwort) => {
        if (abgebrochen || antwort === null) return;
        setBasis(antwort);
      });
    }, suche === "" ? 0 : 250);
    return () => { abgebrochen = true; clearTimeout(t); };
  }, [skyId, suche, offen]);

  function zuordnen(ziel: Basiszeile | null) {
    setFehler(null);
    start(async () => {
      /*
       * Eine neue Familie nur, wenn weder diese Figur noch die Basisfigur
       * eine hat — `0159` entscheidet das; hier wird es angeboten.
       *
       * UND NUR FÜR CHARAKTERFIGUREN (CAT-08 Korrektur). Ein Trap, ein
       * Fahrzeug, ein Kristall ist kein Charakter; `characters` führt sie
       * nicht, und eine Familie für sie anzulegen wäre falsch — auch wenn
       * `0159` es täte, wenn man es verlangt. Hier wird es nicht verlangt.
       */
      const erzeuge = ziel !== null && ziel.characterId === null
                   && basis?.art === "character";
      const ergebnis = await setVariantBase(skyId, ziel?.skyId ?? null, erzeuge);
      if (ergebnis.ok) { setOffen(false); setSuche(""); }
      else setFehler(ergebnis.message);
    });
  }

  return (
    <div className="text-left">
      <p className="text-sm">
        {baseName ?? de.admin.baseAssignNone}
        {baseSkyId !== null ? (
          <span className="ml-1 font-mono text-[11px] text-muted">{baseSkyId}</span>
        ) : null}
      </p>
      {hatVarianten > 0 ? (
        /* WARUM DAS HIER STEHT: eine Figur, auf die Varianten zeigen, kann
           nicht selbst Variante werden (`0159`). Das soll man sehen, bevor
           man es versucht. */
        <p className="mt-0.5 text-[11px] text-muted">
          {de.admin.baseVariantsSoFar(hatVarianten)}
        </p>
      ) : null}

      {!offen ? (
        <button
          type="button"
          onClick={() => setOffen(true)}
          className="focus-ring mt-1 min-h-11 text-xs text-muted underline decoration-dotted"
        >
          {de.admin.baseSubmitAssign}
        </button>
      ) : (
        <div className="mt-2 rounded-sky-md bg-base p-3 ring-1 ring-border">
          <label className="flex flex-col gap-1 text-xs text-muted">
            {de.admin.baseSearch}
            <input
              value={suche}
              onChange={(e) => setSuche(e.target.value)}
              className="focus-ring min-h-11 rounded-sky-md bg-surface px-3 text-sm
                         text-foreground ring-1 ring-border-strong"
            />
          </label>
          {basis?.serie && basis.art !== null ? (
            <p className="mt-1 text-[11px] text-muted">
              {de.admin.baseSearchHintClass(basis.serie,
                                            de.admin.baseClassName(basis.art))}
            </p>
          ) : null}
          {basis !== null && basis.art === null ? (
            <p role="status" className="mt-2 text-xs text-muted">
              {de.admin.baseClassUnknown}
            </p>
          ) : null}

          {basis !== null && basis.art === null ? null
           : basis !== null && basis.moeglich === 0 ? (
            <p className="mt-2 text-xs text-muted">{de.admin.baseNoneAtAll}</p>
          ) : (basis?.treffer.length ?? 0) === 0 ? (
            <p className="mt-2 text-xs text-muted">{de.admin.baseNone}</p>
          ) : (basis !== null && (
            <>
            <p className="mt-2 text-[11px] text-muted">
              {de.admin.baseShown(basis.treffer.length, basis.gefunden)}
            </p>
            <ul className="mt-1 flex flex-col gap-1">
              {basis.treffer.map((b) => (
                <li key={b.skyId}>
                  <button
                    type="button"
                    disabled={pending || b.skyId === baseSkyId}
                    onClick={() => zuordnen(b)}
                    className="focus-ring flex min-h-11 w-full flex-col items-start
                               justify-center gap-0.5 rounded-sky-md px-3 py-1.5
                               text-left ring-1 ring-border disabled:opacity-50"
                  >
                    {/* DIESELBE KURZFORM WIE IM ENTWURFSDIALOG (CAT-08):
                        der Name trägt, der Rest steht klein darunter. Die
                        Familie bleibt hier stehen und nicht dort — auf der
                        Detailseite korrigiert der Bediener Zuordnungen, und
                        dann will er sehen, welche er trifft. */}
                    <span className="text-sm font-medium leading-tight">{b.name}</span>
                    <span className="text-[11px] leading-tight text-muted">
                      <span className="font-mono">{b.skyId}</span>
                      {" · "}{b.seriesCode}
                      {b.varianten > 0 ? ` · ${de.admin.baseVariantsShort(b.varianten)}` : ""}
                      {b.characterId !== null ? ` · Familie #${b.characterId}` : ""}
                    </span>
                    {basis?.empfehlung?.skyId === b.skyId ? (
                      <span className="text-[11px] leading-tight text-action-neutral-edge">
                        {de.admin.baseLikely(basis.empfehlung.vorsilbe)}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
            </>
          ))}

          <div className="mt-3 flex flex-wrap gap-2">
            {/* DER RÜCKWEG. `0159` nimmt dafür ausdrücklich NULL an. */}
            {baseSkyId !== null ? (
              <button
                type="button" disabled={pending} onClick={() => zuordnen(null)}
                className="focus-ring min-h-11 rounded-sky-md bg-surface px-3 text-xs
                           ring-1 ring-border disabled:opacity-50"
              >
                {de.admin.baseRemove}
              </button>
            ) : null}
            <button
              type="button" onClick={() => { setOffen(false); setFehler(null); }}
              className="focus-ring min-h-11 rounded-sky-md px-3 text-xs text-muted"
            >
              {de.admin.discardConfirmNo}
            </button>
          </div>

          {fehler ? (
            <p role="alert" className="mt-2 text-xs text-danger">{fehler}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
