/**
 * Der Zubehörbereich des Katalogs (ADR-0128).
 *
 * SO WIE DER FIGURENKATALOG, UND DOCH NICHT DIESELBE KARTE.
 *
 * Aufbau, Reihenfolge und Bedienung sind die des Figurenkatalogs: oben die
 * Bereichsleiste, darunter die Serienleiste, dann Suche und Filter, dann ein
 * Kachelraster. Wer von Figuren herüberwechselt, muss nichts neu lernen.
 *
 * Was anders ist, ist die KACHEL. Eine Figurenkarte ist eine Sammelkarte mit
 * Artwork-Vorlage, Element, Charakter, Variante, Besitzsiegel und Marktpreis
 * (ADR-0038) — für ein Portal ist davon nichts wahr. `AccessoryCard` nimmt
 * die Formensprache und lässt die Vorlage weg. **An `FigureCard` ändert sich
 * nichts.**
 *
 * ---------------------------------------------------------------------------
 * WAS HIER ÜBERHAUPT STEHT
 *
 * Was `fetchAccessoryCatalog()` liefert, und das ist dieselbe Freigaberegel
 * wie beim Figurenkatalog: `is_active AND catalog_visible`, für einen
 * Administrator zusätzlich das Ausgeblendete. Diese Ansicht kann daran
 * nichts ändern; sie filtert nur, was sie bekommt.
 *
 * KEIN SAMMELN, KEIN SIEGEL, KEIN FORTSCHRITT. Zubehör ist nicht sammelbar
 * (`isCollectible()`), und keine Kachel bietet etwas an, das die Sammlung
 * ablehnen würde.
 *
 * DAS ANGEBOT WIRD DURCHGEREICHT, OBWOHL ES HEUTE IMMER LEER IST.
 * `shop_offers()` schliesst Zubehör am Artikeltyp aus (`0135`), also sagt
 * jede Kachel „Aktuell kein Angebot". Die Stelle ist trotzdem schon da und
 * liest aus derselben Projektion wie der Shop — es gibt keine zweite
 * Angebotsverwaltung, und wenn die Produktentscheidung fällt, füllt sie sich
 * von selbst.
 * ---------------------------------------------------------------------------
 */
"use client";

import { useMemo, useState } from "react";

import {
  accessorySeriesPresent, visibleAccessories,
  type AccessoryFilters, type AccessoryTypeFilter,
} from "@/lib/catalog/accessory-filter";
import { platformsPresent, seriesScopeOf } from "@/lib/catalog/accessory-facts";
import { sortAccessories, type AccessorySort } from "@/lib/catalog/accessory-sort";
import { AccessoryCard } from "@/components/catalog/accessory-card";
import { CatalogSectionSwitch } from "@/components/catalog/catalog-section-switch";
import { DEFAULT_CATALOG_VIEW } from "@/components/catalog/catalog-view-mode";
import { FilterBar } from "@/components/ui/filter-bar";
import { itemTypesPresent } from "@/lib/catalog/item-type";
import type { CatalogFigure, SeriesOption } from "@/lib/catalog/types";
import type { Offer } from "@/lib/shop/offer";
import { offerIndex, offersFor } from "@/lib/shop/offer";
import { de } from "@/lib/i18n/de";

const copy = de.accessories;
/*
 * ZWEI SÄTZE WÖRTER, UND SIE SIND NICHT DASSELBE.
 *
 *   `itemTypes`  EINZAHL — die Marke auf EINER Kachel: „Spiel", „Portal".
 *   `kinds`      MEHRZAHL — die Filterauswahl, die eine MENGE wählt.
 *
 * Eine Kachel, die „Spiele" sagt, behauptet, sie sei mehrere.
 */
const filterLabels = de.inventory.kinds;

/** „Alle Serien" ist hier ein echter Zustand — anders als im Figurenkatalog. */
const ALLE = "";

export function AccessoryView({
  items,
  series,
  admin,
  offers = {},
}: {
  /** Schon gefiltert durch die Abfrage: nur Freigegebenes, für Admins alles. */
  items: readonly CatalogFigure[];
  series: readonly SeriesOption[];
  /**
   * Nur für die Kennzeichnung ausgeblendeter Kacheln.
   *
   * Entscheidet NICHTS über die Sichtbarkeit — die hat die Abfrage schon
   * entschieden.
   */
  admin: boolean;
  /**
   * Die öffentliche Angebotsprojektion, je SKY-ID. Heute ohne Zubehör.
   *
   * Ein einfaches Objekt, keine `Map`: eine `Map` überlebt die Grenze
   * Server → Client nicht und käme leer an. Dieselbe Übergabe wie im
   * Figurenkatalog.
   */
  offers?: Record<string, readonly Offer[]>;
}) {
  const [query, setQuery] = useState("");
  const [seriesCode, setSeriesCode] = useState(ALLE);
  const [type, setType] = useState<AccessoryTypeFilter>("all");
  const [platform, setPlatform] = useState("");
  const [sort, setSort] = useState<AccessorySort>("series");

  /* Die bekannten Seriencodes — die Grundlage der Mehrfachzuordnung. Sie
     kommen aus `fetchSeries()`, nicht aus einer Liste in dieser Datei. */
  const knownSeries = useMemo(() => new Set(series.map((s) => s.code)), [series]);
  const offerIdx = useMemo(() => offerIndex(offers), [offers]);

  const filters: AccessoryFilters = useMemo(
    () => ({ query, seriesCode, type, platform }),
    [query, seriesCode, type, platform],
  );
  const shown = useMemo(
    () => sortAccessories(visibleAccessories(items, filters, knownSeries), sort),
    [items, filters, knownSeries, sort],
  );

  /* Jede Auswahl bietet nur an, was es gibt — ein Knopf ohne Treffer ist
     eine Sackgasse. */
  const types = useMemo(() => itemTypesPresent(items).filter((t) => t !== "figure"), [items]);
  const seriesOptions = useMemo(() => accessorySeriesPresent(items, series), [items, series]);
  const platforms = useMemo(() => platformsPresent(items), [items]);
  const hidden = useMemo(
    () => (admin ? items.filter((i) => !i.catalogVisible).length : 0),
    [admin, items],
  );

  return (
    <div className="flex flex-col gap-5">
      {/* Derselbe Kopf wie im Figurenkatalog: beide Seiten liegen über
          derselben WorldZone, also dieselben Grössen und Schatten. */}
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

      {/*
       * Derselbe Bereichsschalter wie im Hauptkatalog (UX-01F).
       *
       * Hier sind beide Figurenbereiche Verweise auf `/` — es gibt eine Seite,
       * zu der man zurückgeht — und jeder schreibt vorher die gemerkte
       * Darstellung, damit „Karten" wirklich auf den Karten landet und nicht
       * auf dem, was zuletzt gemerkt war. Das Element bleibt ein echter Link,
       * ein Mittelklick öffnet also weiter einen Tab.
       *
       * `view` wird hier nur gebraucht, um NICHTS hervorzuheben: auf dieser
       * Seite ist Zubehör aktuell, und `activeSection` fragt die gemerkte
       * Ansicht für den Zubehörbereich bewusst nicht.
       */}
      {/* UX-01G: zwei Bereiche. Die Pille „Karten" ist entfallen — der
            Katalog hat nur noch eine Darstellung, und ein Verweis auf eine
            Ansicht, die es nicht mehr gibt, wäre ein toter Weg. */}
        <CatalogSectionSwitch
          area="accessories"
          view={DEFAULT_CATALOG_VIEW}
          sections={["figures", "accessories"]}
        />

      {items.length === 0 ? (
        /* Der Bereich ist leer, weil nichts freigegeben ist — nicht, weil
           nichts existiert. Der Satz sagt genau das. */
        <div className="flex flex-col items-center gap-2 rounded-sky-lg bg-surface/70 px-4 py-10 text-center ring-1 ring-border/70">
          <p className="font-medium">{copy.none}</p>
          <p className="max-w-md text-sm text-muted">{copy.noneHint}</p>
        </div>
      ) : (
        <>
          {/*
            DIE SERIENLEISTE, dieselbe Komponente wie im Figurenkatalog
            (`FilterBar variant="nav"`) — waagrecht scrollbar, 44 px auf dem
            Telefon, nie umbrechend.

            MIT „Alle Serien", und das ist der eine Unterschied zum
            Figurenkatalog: dort ist immer ein Spiel gewählt, weil 561
            Figuren auf einmal eine Wand sind (ADR-0038). 60 Zubehörartikel
            sind keine Wand — hier ist „alles" die sinnvolle Startansicht.
          */}
          {seriesOptions.length > 1 ? (
            <FilterBar
              variant="nav"
              label={copy.seriesNav}
              active={seriesCode}
              onSelect={setSeriesCode}
              options={[
                { value: ALLE, label: copy.seriesAll },
                ...seriesOptions.map((o) => ({ value: o.code, label: o.label })),
              ]}
            />
          ) : null}

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

            {/*
              Drei Auswahlfelder und die Sortierung, in einer umbrechenden
              Reihe. Jedes erscheint nur, wenn es mehr als eine Wahl hat —
              auf dem Telefon sind das heute zwei Felder statt vier.
            */}
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

              <select
                aria-label={copy.sortLabel}
                value={sort}
                onChange={(event) => setSort(event.target.value as AccessorySort)}
                className="min-h-10 rounded-sky-md bg-surface/80 px-3 text-sm ring-1 ring-border/70"
              >
                {(["series", "name", "platform", "kind"] as const).map((value) => (
                  <option key={value} value={value}>
                    {copy.sortLabel}: {copy.sorts[value]}
                  </option>
                ))}
              </select>
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
            /* Dasselbe Raster wie der Figurenkatalog: zwei Kacheln auf dem
               Telefon, drei ab `sm:`, vier ab `md:`. */
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4">
              {shown.map((item) => (
                <AccessoryCard
                  key={item.skyId}
                  item={item}
                  seriesScope={seriesScopeOf(item, knownSeries).map(
                    (code) => series.find((s) => s.code === code)?.label ?? code)}
                  offers={offersFor(offerIdx, item.skyId)}
                  admin={admin}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
