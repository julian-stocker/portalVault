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

import {
  accessorySeriesPresent, visibleAccessories,
  type AccessoryFilters, type AccessoryTypeFilter,
} from "@/lib/catalog/accessory-filter";
import { accessoryDetail, platformsPresent } from "@/lib/catalog/accessory-facts";
import { CatalogAreaTabs } from "@/components/catalog/area-tabs";
import { itemTypeOf, itemTypesPresent } from "@/lib/catalog/item-type";
import type { CatalogFigure, SeriesOption } from "@/lib/catalog/types";
import { de } from "@/lib/i18n/de";

const copy = de.accessories;
/*
 * ZWEI SÄTZE WÖRTER, UND SIE SIND NICHT DASSELBE.
 *
 *   `itemTypes`  EINZAHL — die Marke auf EINER Zeile: „Spiel", „Portal".
 *   `kinds`      MEHRZAHL — die Filterauswahl, die eine MENGE wählt:
 *                „Spiele", „Portale".
 *
 * Eine Zeile, die „Spiele" sagt, behauptet, sie sei mehrere.
 */
const markLabels = de.inventory.itemTypes;
const filterLabels = de.inventory.kinds;

/** Plattform oder Modellnummer — die eine Angabe unter dem Namen. */
const detailVon = accessoryDetail;

/** Eine Marke: die Art des Artikels, als kurzes Etikett. */
function TypeMark({ type }: { type: string }) {
  return (
    <span className="shrink-0 rounded-sky-sm bg-deep/40 px-1.5 py-0.5 text-[0.6875rem] uppercase tracking-wide text-muted ring-1 ring-border/60">
      {markLabels[type] ?? type}
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
  const [platform, setPlatform] = useState("");

  const filters: AccessoryFilters = useMemo(
    () => ({ query, seriesCode, type, platform }),
    [query, seriesCode, type, platform],
  );
  const shown = useMemo(() => visibleAccessories(items, filters), [items, filters]);

  /* Nur anbieten, was es gibt — eine Art ohne Artikel ist eine Sackgasse. */
  const types = useMemo(() => itemTypesPresent(items).filter((t) => t !== "figure"), [items]);
  const seriesOptions = useMemo(() => accessorySeriesPresent(items, series), [items, series]);
  const platforms = useMemo(() => platformsPresent(items), [items]);
  const hidden = useMemo(
    () => (admin ? items.filter((i) => !i.catalogVisible).length : 0),
    [admin, items],
  );

  return (
    <div className="flex flex-col gap-5">
      {/*
        DERSELBE KOPF WIE IM FIGURENKATALOG, und zwar bewusst: beide Seiten
        liegen über derselben WorldZone des öffentlichen Layouts, also tragen
        Titel und Zeile dieselben Schatten und dieselbe Farbe. Wer zwischen
        den Tabs wechselt, soll denselben Ort sehen, nur mit anderem Inhalt.
      */}
      <div className="md:max-w-[52%]">
        <h1
          className="text-3xl leading-tight font-semibold tracking-tight md:text-5xl"
          style={{ textShadow: "0 2px 20px rgb(10 9 24 / 0.85), 0 1px 3px rgb(10 9 24 / 0.95)" }}
        >
          {copy.heading}
        </h1>
        <p
          className="mt-2 text-sm text-on-deep-muted md:text-base"
          style={{ textShadow: "0 1px 14px rgb(10 9 24 / 0.9)" }}
        >
          {copy.intro}
        </p>
      </div>

      {/* Die oberste Ebene. Dieselbe Leiste wie im Figurenkatalog, an
          derselben Stelle — nur mit dem anderen Eintrag aktiv. */}
      <CatalogAreaTabs active="accessories" />

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
                    <option key={value} value={value}>{filterLabels[value] ?? value}</option>
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

              {/* Die Plattform — nur Spiele tragen eine, also erscheint das
                  Feld erst, wenn welche da sind. Wer hier wählt, blendet
                  damit die Portale aus, und das ist gewollt. */}
              {platforms.length > 1 ? (
                <select
                  aria-label={copy.platformAll}
                  value={platform}
                  onChange={(event) => setPlatform(event.target.value)}
                  className="min-h-10 rounded-sky-md bg-surface/80 px-3 text-sm ring-1 ring-border/70"
                >
                  <option value="">{copy.platformAll}</option>
                  {platforms.map((value) => (
                    <option key={value} value={value}>{value}</option>
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
                  /*
                    ZWEI ZEILEN, KEIN BILD. Für Portale gibt es keine
                    Produktfotos, und ein Platzhalter, der wie eines
                    aussieht, wäre eine Behauptung. Statt einer leeren
                    Bildfläche trägt die Zeile ihre Angaben: oben die Art
                    und der Name, unten das, was den Artikel genau bestimmt.
                  */
                  className="flex flex-col gap-1.5 rounded-sky-md bg-surface/80 px-3.5 py-3 ring-1 ring-border/70 transition-colors hover:ring-border-strong"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <TypeMark type={itemTypeOf(item)} />
                    {/* Der Anzeigename: ein redaktioneller Name, wenn es
                        einen gibt, sonst der Rohname — dieselbe Rangfolge
                        wie überall (0117). */}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {item.displayName}
                    </span>
                    {admin && !item.catalogVisible ? (
                      <span className="shrink-0 rounded-sky-sm px-1.5 py-0.5 text-[0.6875rem] text-muted ring-1 ring-border/60">
                        {copy.hiddenMark}
                      </span>
                    ) : null}
                  </div>

                  {/*
                    Die zweite Zeile beantwortet „welches genau?" — für ein
                    Spiel die Plattform, für ein Portal die Modellnummer.
                    Beides abgeleitet aus dem Rohnamen, nichts gespeichert,
                    nichts geraten: ohne Treffer steht hier nichts.
                  */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                    {detailVon(item) !== null ? (
                      <>
                        <span className="font-medium text-foreground">{detailVon(item)}</span>
                        <span aria-hidden="true">·</span>
                      </>
                    ) : null}
                    <span>{item.seriesLabel}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono">{item.skyId}</span>
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
