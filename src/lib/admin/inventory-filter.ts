/**
 * Was die Lagerübersicht gerade zeigt — die Regel, ohne React.
 *
 * WARUM SIE HIER STEHT UND NICHT IN DER ANSICHT. Vier Filter, die
 * zusammenwirken, sind genau die Art Logik, die man einzeln nachfahren will:
 * „ein Portal mit Bestand, Serie SF, nicht im Shop" ist eine Frage mit einer
 * Antwort, und sie soll sich ohne Browser und ohne Datenbank stellen lassen.
 * In einem `useMemo` ließe sie sich nur über den Quelltext behaupten.
 *
 * GEFILTERT WIRD IM BROWSER, auf Zeilen, die die Seite ohnehin schon hält —
 * wie im Katalog (ADR-0026), und die Mengen sind hier noch kleiner: ein paar
 * hundert Positionen gegen 600 Katalogzeilen.
 */
import {
  INVENTORY_KINDS, inventoryKind, type InventoryKind, type InventoryPosition,
} from "@/lib/admin/inventory-model";
import {
  POSITION_STATUSES, positionStatus, type PositionStatusKind,
} from "@/lib/admin/position-status";
import { matchesQuery, normalizeForSearch } from "@/lib/catalog/search";

/** Bestand: alles, nur mit, nur ohne. */
export type StockFilter = "all" | "in" | "out";
/** Shopfreigabe: alles, nur freigegeben, nur nicht freigegeben. */
export type ListingFilter = "all" | "listed" | "unlisted";
/** Art: alles, oder genau eine der fünf Arten aus `0135`. */
export type KindFilter = "all" | InventoryKind;
/**
 * Shopstatus (Lagerverwaltung V2): alles, genau eine Art aus
 * `position-status.ts`, oder eine der zwei Sammelgruppen —
 * `fix` (freigegeben, aber nicht im Shop) und `action` (`fix` plus
 * „Freigabe offen").
 */
export type StatusFilter = "all" | PositionStatusKind | "fix" | "action";

export type InventoryFilters = {
  /** Freitext über Name, Suchindex und SKY-ID. */
  query: string;
  /** Serien-Code, leer heißt „alle". */
  seriesCode: string;
  stock: StockFilter;
  listing: ListingFilter;
  kind: KindFilter;
  status: StatusFilter;
};

export const NO_FILTERS: InventoryFilters = {
  query: "", seriesCode: "", stock: "all", listing: "all", kind: "all", status: "all",
};

/** Trifft der Statusfilter diese Position? Die Antwort kommt aus `positionStatus()`. */
function matchesStatus(position: InventoryPosition, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  const { kind, attention } = positionStatus(position);
  if (filter === "fix") return attention === "fix";
  if (filter === "action") return attention !== "none";
  return kind === filter;
}

/**
 * Trifft die Suche diese Position?
 *
 * Über den Suchindex der Katalogzeile — der kennt jede Schreibweise des
 * Namens, die kanonische eingeschlossen — und über die SKY-ID direkt. Eine
 * Position ohne Katalogzeile ist allein über ihre SKY-ID zu finden; sie hat
 * nichts anderes, und ein Name wird für sie nicht erfunden.
 *
 * FÜR ZUBEHÖR IST DAS DER WICHTIGE TEIL. Ein Portal heißt `84709790 (SF)` —
 * der Betreiber tippt die Modellnummer, und `matchesQuery` findet sie im
 * Namen. Ein eigener Zweig dafür ist nicht nötig.
 */
function matchesSearch(position: InventoryPosition, query: string): boolean {
  const trimmed = query.trim();
  if (trimmed === "") return true;
  const normalized = normalizeForSearch(query);
  if (position.figure !== null && matchesQuery(position.figure, normalized)) return true;
  return position.skyId.toLowerCase().includes(trimmed.toLowerCase());
}

/** Eine Position gegen alle sechs Bedingungen. Alle müssen zutreffen. */
export function matchesFilters(
  position: InventoryPosition,
  filters: InventoryFilters,
): boolean {
  if (filters.seriesCode !== "" && position.figure?.seriesCode !== filters.seriesCode) {
    return false;
  }
  /*
   * DIE ART. `inventoryKind()` antwortet `figure`, wenn nichts anderes
   * bekannt ist — ein Filter auf `figure` zeigt deshalb auch eine Position,
   * deren Katalogzeile den Artikeltyp nicht mitgebracht hat. Das ist richtig
   * so: ohne Auskunft gilt der Normalfall, und keine Position verschwindet
   * aus der Liste, weil eine Spalte fehlte.
   */
  if (filters.kind !== "all" && inventoryKind(position) !== filters.kind) return false;
  if (filters.stock === "in" && position.available <= 0) return false;
  if (filters.stock === "out" && position.available > 0) return false;
  if (filters.listing === "listed" && !position.isListed) return false;
  if (filters.listing === "unlisted" && position.isListed) return false;
  if (!matchesStatus(position, filters.status)) return false;
  return matchesSearch(position, filters.query);
}

/** Die sichtbaren Positionen, Reihenfolge unberührt. */
export function visiblePositions(
  positions: readonly InventoryPosition[],
  filters: InventoryFilters,
): InventoryPosition[] {
  return positions.filter((position) => matchesFilters(position, filters));
}

/**
 * Welche Arten liegen überhaupt im Lager?
 *
 * Damit der Filter nur anbietet, was es gibt: ein Auswahlfeld mit „Bundle",
 * hinter dem keine einzige Zeile steht, ist eine Sackgasse. Die Reihenfolge
 * ist die von `INVENTORY_KINDS` und nicht die des Zufalls, in dem die
 * Positionen geladen wurden.
 *
 * `figure` wird dabei NICHT mitgezählt, wenn es keine Figurenposition gibt —
 * die Liste beschreibt den Bestand, nicht das Vokabular.
 */
export function kindsInStock(
  positions: readonly InventoryPosition[],
): InventoryKind[] {
  const seen = new Set(positions.map(inventoryKind));
  /* `INVENTORY_KINDS` und keine zweite Liste: die Reihenfolge ist dort
     entschieden, und eine Kopie davon würde beim nächsten Artikeltyp
     auseinanderlaufen. */
  return INVENTORY_KINDS.filter((kind) => seen.has(kind));
}

/* ------------------------------------------------------------------------- */
/* DIE FILTER IN DER ADRESSE (Lagerverwaltung V2, AP2)                        */
/* ------------------------------------------------------------------------- */

/*
 * Ein deutsches Wort je Wert, wie `?kategorie=` und `?ansicht=` im Abgleich.
 * Gelesen wird nur, was in diesen Tabellen steht; alles andere heißt „alle"
 * — nie ein Fehler, nie zurückgespiegelt. Die Suche ist der einzige freie
 * Text, und sie landet nur im Suchfeld und im Filter, nie in einem Link.
 */
const STOCK_WORDS = { in: "auf-lager", out: "leer" } as const;
const LISTING_WORDS = { listed: "im-shop", unlisted: "nicht-im-shop" } as const;
const KIND_WORDS: Record<InventoryKind, string> = {
  figure: "figuren", game: "spiele", portal: "portale", bundle: "bundles", other: "zubehoer",
};
const STATUS_WORDS: Record<Exclude<StatusFilter, "all">, string> = {
  offered: "im-shop",
  listed_no_price: "ohne-preis",
  listed_hidden: "nicht-sichtbar",
  listed_sold_out: "ausverkauft",
  release_open: "freigabe-offen",
  unlisted: "nicht-freigegeben",
  accessory: "zubehoer",
  historical: "historisch",
  fix: "korrektur",
  action: "handlungsbedarf",
};

/** Die Werte des Statusfilters in Anzeigereihenfolge: die zwei Gruppen zuerst. */
export const STATUS_FILTERS: readonly Exclude<StatusFilter, "all">[] = [
  "action", "fix", ...POSITION_STATUSES,
];

/** Längste Suche, die aus der Adresse übernommen wird. */
export const MAX_QUERY_LENGTH = 100;
/** Ein Seriencode ist kurz und besteht aus Buchstaben, Ziffern und Bindestrich. */
const SERIES_CODE = /^[A-Za-z0-9_-]{1,16}$/;

function wordToValue<T extends string>(words: Record<T, string>, word: string | null): T | null {
  if (word === null) return null;
  const hit = (Object.entries(words) as [T, string][]).find(([, w]) => w === word);
  return hit ? hit[0] : null;
}

/** Was die Adresse über die Filter sagt — Unbekanntes heißt „alle". */
export function filtersFromParams(params: { get(name: string): string | null }): InventoryFilters {
  const series = params.get("serie");
  return {
    query: (params.get("q") ?? "").slice(0, MAX_QUERY_LENGTH),
    seriesCode: series !== null && SERIES_CODE.test(series) ? series : "",
    stock: wordToValue(STOCK_WORDS, params.get("bestand")) ?? "all",
    listing: wordToValue(LISTING_WORDS, params.get("shop")) ?? "all",
    kind: wordToValue(KIND_WORDS, params.get("art")) ?? "all",
    status: wordToValue(STATUS_WORDS, params.get("status")) ?? "all",
  };
}

/**
 * Die Filter als Suchteil der Adresse, ohne `?`. Standardwerte fallen weg,
 * sodass die ungefilterte Liste die nackte Adresse `/business/inventory` ist.
 */
export function filtersToQuery(filters: InventoryFilters): string {
  const query = new URLSearchParams();
  const text = filters.query.trim().slice(0, MAX_QUERY_LENGTH);
  if (text !== "") query.set("q", text);
  if (filters.seriesCode !== "" && SERIES_CODE.test(filters.seriesCode)) query.set("serie", filters.seriesCode);
  if (filters.stock !== "all") query.set("bestand", STOCK_WORDS[filters.stock]);
  if (filters.listing !== "all") query.set("shop", LISTING_WORDS[filters.listing]);
  if (filters.kind !== "all") query.set("art", KIND_WORDS[filters.kind]);
  if (filters.status !== "all") query.set("status", STATUS_WORDS[filters.status]);
  return query.toString();
}

/** Ist irgendein Filter gesetzt? Dann gibt es etwas zurückzusetzen. */
export function hasActiveFilters(filters: InventoryFilters): boolean {
  return filtersToQuery(filters) !== "";
}
