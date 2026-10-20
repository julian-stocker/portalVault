/**
 * Einen Katalogartikel anlegen, mitten im Einkauf (0137).
 *
 * WARUM DIESER KASTEN EXISTIERT
 *
 * Ein Portal liegt im Karton. Es gehört zum Einkauf, es hat Geld gekostet,
 * und es stand bisher in keinem Katalog — also wurde es als Freitext erfasst:
 * ohne SKY-ID, ohne Bestand, ohne Einkaufshistorie je Artikel. Das war der
 * einzige Weg, den es gab (`add-purchase-item.tsx`, Kopf). Seit `0137` gibt
 * es einen zweiten: `seller_create_catalog_item` legt den Artikel an und
 * liefert seine SKY-ID zurück, und die Position entsteht im gleichen Zug.
 *
 * DREI ANGABEN, NICHT MEHR
 *
 *   Name    — roh, wie getippt. Keine Korrektur, keine Normalisierung
 *             (CLAUDE.md Regel 4). Ein Portal heisst `84709790 (SF)`, und
 *             das ist der Name, nicht ein Tippfehler.
 *   Art     — Spiel, Portal, Bundle, Zubehör. KEINE FIGUR: die entsteht im
 *             Katalogbereich (ADR-0034), und die Datenbankfunktion lehnt sie
 *             ausdrücklich ab. Eine Wahl, die immer scheitert, wird nicht
 *             angeboten.
 *   Serie   — Pflicht, weil `skylanders.series_code` es ist. Die Codes kommen
 *             aus dem Katalog, der ohnehin schon im Speicher liegt; es gibt
 *             deshalb keine zweite Abfrage und keine zweite Liste, die
 *             veralten könnte.
 *
 * KEIN PREIS, KEIN BILD, KEINE SICHTBARKEIT. Alles drei gehört dem
 * Katalogbereich, und die Funktion setzt `catalog_visible = false`. Hier wird
 * ein Einkauf erfasst und kein Katalog redigiert.
 *
 * AM TELEFON BEDIENBAR: zwei Reihen Marken statt zweier Auswahlfelder — ein
 * `select` öffnet auf iOS ein Rad, und zwei Räder für sechs und vier Werte
 * sind mehr Bewegung als sechs und vier Knöpfe. Jede Marke ist 44 px hoch,
 * die Reihen umbrechen, nichts scrollt waagrecht.
 */
"use client";

import { useMemo, useState, useTransition } from "react";

import { ACTION_NEUTRAL, ACTION_PRIMARY } from "@/components/ui/action";
import { INPUT } from "@/components/business/form-section";
import { de } from "@/lib/i18n/de";
import { createCatalogItem } from "@/lib/orderbook/actions";
import type { FigureChoice } from "@/lib/orderbook/figure-search";

const copy = de.business.orderbook.newItem;
const types = de.business.orderbook.figures.itemTypes;

/**
 * Die wählbaren Arten, in der Reihenfolge, in der sie vorkommen.
 *
 * `figure` steht NICHT darin — siehe Kopf. Die Reihenfolge ist die Häufigkeit
 * im Einkauf: Portale und Spiele sind der Alltag, Bundles und Zubehör die
 * Ausnahme.
 */
const WAEHLBAR = ["portal", "game", "bundle", "other"] as const;

/** Eine Marke: 44 px, umbrechend, mit sichtbarem Zustand. */
function Chip({
  label, active, disabled, onClick,
}: {
  label: string; active: boolean; disabled: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-11 rounded-sky-md px-3 text-sm ring-1 disabled:opacity-40 sm:min-h-9 ${
        active ? "bg-surface ring-fg/40" : "ring-border/70 hover:ring-fg/30"
      }`}
    >
      {label}
    </button>
  );
}

export function NewCatalogItem({
  purchaseId,
  catalog,
  initialName = "",
  onDone,
  onCancel,
}: {
  purchaseId: number;
  /** Nur als Quelle der Serien-Codes. Gesucht wird hier nicht. */
  catalog: readonly FigureChoice[];
  /** Vorbelegung: der Name, den die erfolglose Suche schon kennt. */
  initialName?: string;
  /** Angelegt und hinzugefügt — die Seite hat sich schon neu geladen. */
  onDone: (skyId: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [typ, setTyp] = useState<string | null>(null);
  const [serie, setSerie] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /*
   * Die Serien, wie sie im Katalog vorkommen — in der Reihenfolge ihres
   * ersten Auftretens, und das ist die Serienreihenfolge: der Katalog ist
   * nach SKY-ID sortiert, und die SKY-IDs laufen serienweise. Kein
   * `sort()`, der aus `SA, G, SF` ein `G, SA, SF` machen würde.
   */
  const serien = useMemo(() => {
    const gesehen: string[] = [];
    for (const row of catalog) if (!gesehen.includes(row.series)) gesehen.push(row.series);
    return gesehen;
  }, [catalog]);

  const bereit = name.trim().length >= 2 && typ !== null && serie !== null;

  function submit() {
    if (typ === null) { setError(copy.needsType); return; }
    if (serie === null) { setError(copy.needsSeries); return; }
    setError(null);
    startTransition(async () => {
      const result = await createCatalogItem(purchaseId, name.trim(), serie, typ);
      if (result.ok) { onDone(result.skyId); return; }
      /*
       * DER HALBE ERFOLG WIRD GESAGT. Trägt das Ergebnis eine SKY-ID, dann
       * ist der Artikel angelegt und nur die Position nicht entstanden. Nur
       * die Fehlermeldung zu zeigen hiesse, den Betreiber in das Anlegen
       * zurückzuschicken — und dieselbe Sache bekäme eine zweite Identität.
       * Die SKY-ID reist dafür aus der Server Action mit.
       */
      setError(result.skyId === undefined
        ? result.message
        : `${copy.createdNotAdded(result.skyId)} (${result.message})`);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted">{copy.hint}</p>

      {error ? <p role="alert" className="text-sm">{error}</p> : null}

      <label className="flex flex-col gap-1">
        <span className="sr-only">{copy.nameLabel}</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={copy.namePlaceholder}
          /* Wie in der Suche: hier werden Produktnamen und Modellnummern
             getippt, und für ein Wörterbuch sind beides Tippfehler. */
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          autoComplete="off"
          disabled={pending}
          className={INPUT}
        />
      </label>

      <fieldset className="flex flex-wrap gap-1" disabled={pending}>
        <legend className="sr-only">{copy.typeLabel}</legend>
        {WAEHLBAR.map((wert) => (
          <Chip key={wert} label={types[wert] ?? wert} active={typ === wert}
                disabled={pending} onClick={() => { setTyp(wert); setError(null); }} />
        ))}
      </fieldset>

      <fieldset className="flex flex-wrap gap-1" disabled={pending}>
        <legend className="sr-only">{copy.seriesLabel}</legend>
        {serien.map((code) => (
          <Chip key={code} label={code} active={serie === code}
                disabled={pending} onClick={() => { setSerie(code); setError(null); }} />
        ))}
      </fieldset>

      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending || !bereit} onClick={submit}
                className={`${ACTION_PRIMARY} min-h-11 w-auto disabled:opacity-40`}>
          {pending ? copy.pending : copy.submit}
        </button>
        <button type="button" disabled={pending} onClick={onCancel}
                className={`${ACTION_NEUTRAL} min-h-11 w-auto`}>
          {copy.cancel}
        </button>
      </div>
    </div>
  );
}
