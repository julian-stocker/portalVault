/**
 * Der Zubehörbereich des Katalogs (ADR-0128).
 *
 * WARUM EINE EIGENE ANSICHT UND KEINE ERWEITERUNG DER FIGURENSICHT.
 *
 * Eine Figurenkarte beantwortet Fragen, die ein Portal nicht hat: Element,
 * Charakter, Variante, Besitz, Fortschritt, Preis, „In den Warenkorb". Für
 * ein Portal ist jede dieser Antworten leer oder falsch, und eine Karte, die
 * zur Hälfte leer bleibt, sieht aus wie fehlende Daten. Die Figurenkarte
 * bleibt deshalb unangetastet (ADR-0038) und das Zubehör bekommt die
 * schlichtere Form, die zu ihm passt: eine Zeile.
 *
 * ---------------------------------------------------------------------------
 * WAS HIER ÜBERHAUPT STEHT, UND WAS NICHT
 *
 * Gezeigt wird, was `fetchAccessoryCatalog()` liefert — und das ist seit
 * ADR-0128 genau dieselbe Freigaberegel wie beim Figurenkatalog:
 * `is_active AND catalog_visible`. Ein Portal steht heute auf
 * `catalog_visible = false` und erscheint hier erst, wenn ein Administrator
 * es einzeln freigibt. Diese Ansicht kann daran nichts ändern; sie filtert
 * nur, was sie bekommt.
 *
 * KEIN SAMMELSTATUS, KEIN PREIS, KEIN WARENKORB. Nicht weil es hier nicht
 * hinpasst, sondern weil beides nein ist: Zubehör ist nicht sammelbar
 * (`isCollectible()`) und nicht shopfähig (`is_shop_eligible()`). Ein
 * Häkchen oder ein Preisfeld wäre ein Angebot, das die Datenbank ablehnt.
 * ---------------------------------------------------------------------------
 */
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import {
  accessorySeriesPresent, visibleAccessories,
  type AccessoryFilters, type AccessoryTypeFilter,
} from "@/lib/catalog/accessory-filter";
import { itemTypeOf, itemTypesPresent } from "@/lib/catalog/item-type";
import type { CatalogFigure, SeriesOption } from "@/lib/catalog/types";
import { de } from "@/lib/i18n/de";

const copy = de.accessories;
const typeLabels = de.inventory.kinds;

/** Eine Marke: die Art des Artikels, als kurzes Etikett. */
function TypeMark({ type }: { type: string }) {
  return (
    <span className="shrink-0 rounded-sky-sm bg-deep/40 px-1.5 py-0.5 text-[0.6875rem] uppercase tracking-wide text-muted ring-1 ring-border/60">
      {typeLabels[type] ?? type}
    </span>
  );
}

export function AccessoryView({
  items,
  series,
  admin,
}: {
  /** Schon gefiltert durch die Abfrage: nur Freigegebenes, für Admins alles. */
  items: readonly CatalogFigure[];
  series: readonly SeriesOption[];
  /**
   * Nur für die Kennzeichnung ausgeblendeter Zeilen.
   *
   * Entscheidet NICHTS über die Sichtbarkeit — die hat die Abfrage schon
   * entschieden. Ein `admin={true}` in einer Nutzersitzung zeigte deshalb
   * nur ein Etikett, nie eine Zeile mehr.
   */
  admin: boolean;
}) {
  const [query, setQuery] = useState("");
  const [seriesCode, setSeriesCode] = useState("");
  const [type, setType] = useState<AccessoryTypeFilter>("all");

  const filters: AccessoryFilters = useMemo(
    () => ({ query, seriesCode, type }),
    [query, seriesCode, type],
  );
  const shown = useMemo(() => visibleAccessories(items, filters), [items, filters]);

  /* Nur anbieten, was es gibt — eine Art ohne Artikel ist eine Sackgasse. */
  const types = useMemo(() => itemTypesPresent(items).filter((t) => t !== "figure"), [items]);
  const seriesOptions = useMemo(() => accessorySeriesPresent(items, series), [items, series]);
  const hidden = useMemo(
    () => (admin ? items.filter((i) => !i.catalogVisible).length : 0),
    [admin, items],
  );

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{copy.heading}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">{copy.intro}</p>
        <Link href="/" className="mt-2 inline-block text-sm text-muted underline underline-offset-2">
          {copy.toCatalog}
        </Link>
      </div>

      {items.length === 0 ? (
        /* Der Bereich ist leer, weil nichts freigegeben ist — nicht, weil
           nichts existiert. Der Satz sagt genau das. */
        <div className="flex flex-col items-center gap-2 rounded-sky-lg bg-surface/70 px-4 py-10 text-center ring-1 ring-border/70">
          <p className="font-medium">{copy.none}</p>
          <p className="max-w-md text-sm text-muted">{copy.noneHint}</p>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            <label className="sr-only" htmlFor="accessory-search">{copy.searchLabel}</label>
            <input
              id="accessory-search"
              type="search"
              inputMode="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={copy.searchPlaceholder}
              className="min-h-12 w-full rounded-sky-md bg-surface/80 px-4 text-base ring-1 ring-border/70 focus:ring-border-strong"
            />

            {/* Zwei Auswahlfelder, und jedes erscheint nur, wenn es mehr als
                eine Wahl gibt. Sie brechen auf dem Telefon um. */}
            <div className="flex flex-wrap gap-2">
              {types.length > 1 ? (
                <select
                  aria-label={copy.typeAll}
                  value={type}
                  onChange={(event) => setType(event.target.value as AccessoryTypeFilter)}
                  className="min-h-10 rounded-sky-md bg-surface/80 px-3 text-sm ring-1 ring-border/70"
                >
                  <option value="all">{copy.typeAll}</option>
                  {types.map((value) => (
                    <option key={value} value={value}>{typeLabels[value] ?? value}</option>
                  ))}
                </select>
              ) : null}

              {seriesOptions.length > 1 ? (
                <select
                  aria-label={copy.seriesAll}
                  value={seriesCode}
                  onChange={(event) => setSeriesCode(event.target.value)}
                  className="min-h-10 rounded-sky-md bg-surface/80 px-3 text-sm ring-1 ring-border/70"
                >
                  <option value="">{copy.seriesAll}</option>
                  {seriesOptions.map((option) => (
                    <option key={option.code} value={option.code}>{option.label}</option>
                  ))}
                </select>
              ) : null}
            </div>

            <p className="text-sm text-muted" aria-live="polite">
              {copy.count(shown.length)}
              {hidden > 0 ? ` · ${copy.hiddenNote(hidden)}` : ""}
            </p>
          </div>

          {shown.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-sky-lg bg-surface/70 px-4 py-10 text-center ring-1 ring-border/70">
              <p className="font-medium">{copy.empty}</p>
              <p className="text-sm text-muted">{copy.emptyHint}</p>
            </div>
          ) : (
            <ul className="grid gap-2 lg:grid-cols-2">
              {shown.map((item) => (
                <li
                  key={item.skyId}
                  className="flex flex-col gap-1 rounded-sky-md bg-surface/80 px-3 py-2.5 ring-1 ring-border/70 sm:flex-row sm:items-center sm:gap-3"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <TypeMark type={itemTypeOf(item)} />
                    {/* Der Anzeigename: ein redaktioneller Name, wenn es
                        einen gibt, sonst der Rohname — dieselbe Rangfolge
                        wie überall (0117). Bei einem Portal ist das die
                        Modellnummer, und die unterscheidet die Varianten. */}
                    <span className="min-w-0 flex-1 truncate text-sm">{item.displayName}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs text-muted">
                    <span className="uppercase tabular-nums">{item.seriesLabel}</span>
                    <span className="font-mono">{item.skyId}</span>
                    {admin && !item.catalogVisible ? (
                      <span className="rounded-sky-sm px-1.5 py-0.5 ring-1 ring-border/60">
                        {copy.hiddenMark}
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
