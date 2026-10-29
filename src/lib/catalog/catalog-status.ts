/**
 * „Öffentlich · Versteckt · Entwurf" — der redaktionelle Status eines
 * Katalogeintrags (CAT-02B, ADR-0151).
 *
 * DREI WERTE, ZWEI VERHALTEN. `hidden` und `draft` sind beide nicht
 * öffentlich und beide im Adminbereich bearbeitbar; sie unterscheiden sich in
 * der ABSICHT:
 *
 *   public   freigegeben, erscheint im öffentlichen Katalog
 *   hidden   war öffentlich, wurde zurückgezogen
 *   draft    noch nie freigegeben — neu angelegt oder später importiert
 *
 * Genau deshalb kostet der dritte Wert keine neue Sichtbarkeitsregel: es gibt
 * weiterhin EIN Prädikat (`is_active and catalog_visible`), und es ist seit
 * `0004` auditiert. Diese Datei fügt einen Namen hinzu, keine Mechanik.
 *
 * ES IST EIN FELD, KEIN ARBEITSABLAUF. Alle sechs Übergänge sind frei, es
 * gibt keine Vorbedingung, keine Bestätigung und keinen zweiten Akteur. Der
 * Admin wählt, klickt „Speichern", fertig.
 *
 * DIE DATENBANK IST DIE WAHRHEIT, NICHT DIESE DATEI. `skylanders.catalog_status`
 * trägt den Wert, `catalog_visible` bleibt die maschinenlesbare Sichtbarkeit,
 * die RLS, der Teilindex und `shop_offers()` lesen, und ein Trigger plus ein
 * CHECK halten beide in Deckung (`0152`). `visibleFor()` hier ist dieselbe
 * Rechnung für die Anwendungsseite — nicht eine zweite Quelle, sondern die
 * Spiegelung einer, die die Datenbank erzwingt.
 */

/** Die drei Werte, in Anzeigereihenfolge. */
export const CATALOG_STATUSES = ["public", "hidden", "draft"] as const;

export type CatalogStatus = (typeof CATALOG_STATUSES)[number];

/**
 * Worauf ein neuer Eintrag steht.
 *
 * ENTWURF, und das ist die Antwort auf die Frage, die es vorher nicht gab:
 * `admin_create_figure` legte bisher mit `catalog_visible = false` an, also
 * „versteckt" — was „war öffentlich, wurde zurückgezogen" heißt und für etwas
 * Neues schlicht nicht stimmt.
 */
export const DEFAULT_CATALOG_STATUS: CatalogStatus = "draft";

export function isCatalogStatus(value: unknown): value is CatalogStatus {
  return typeof value === "string" && (CATALOG_STATUSES as readonly string[]).includes(value);
}

/**
 * Ein gelesener Wert, oder `null`.
 *
 * `asCardType` nach demselben Muster: ein Wert, den eine späte Migration
 * hinzufügt, von einem älteren Client gelesen, soll `null` ergeben und nicht
 * einen Typ behaupten, den er nicht hat.
 */
export function asCatalogStatus(value: unknown): CatalogStatus | null {
  return isCatalogStatus(value) ? value : null;
}

/** Ist ein Eintrag mit diesem Status öffentlich? */
export function visibleFor(status: CatalogStatus): boolean {
  return status === "public";
}

/**
 * Der Status, den eine Zeile ohne Statusspalte hat.
 *
 * EXAKT, NICHT GESCHÄTZT: `0152` füllt die Spalte mit genau dieser Rechnung,
 * und der CHECK hält sie danach. Solange die Migration nicht gefahren ist,
 * liefert diese Funktion deshalb denselben Wert, den die Datenbank danach
 * liefern wird — kein Eintrag ist in diesem Zustand ein Entwurf, weil es
 * vorher keine Entwürfe geben konnte.
 */
export function statusFromVisibility(catalogVisible: boolean): CatalogStatus {
  return catalogVisible ? "public" : "hidden";
}

/**
 * Der Status eines Eintrags, auch wenn ihn niemand mitgeschickt hat.
 *
 * DIE EINE STELLE, DIE DEN UNTERSCHIED AUFLÖST. Fehlt das Feld — weil die
 * Fläche es nicht braucht oder weil `0152` noch nicht gefahren ist —, dann
 * ist die Antwort aus `catalogVisible` **exakt** und nicht geschätzt: die
 * Migration füllt die Spalte mit derselben Rechnung, und vorher kann es
 * keine Entwürfe geben.
 */
export function statusOf(
  figure: { catalogStatus?: CatalogStatus; catalogVisible: boolean },
): CatalogStatus {
  return figure.catalogStatus ?? statusFromVisibility(figure.catalogVisible);
}
