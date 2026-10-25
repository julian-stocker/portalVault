/**
 * The stock's vocabulary and shapes — no database, no server.
 *
 * Split from the queries so a client component can hold a list of conditions
 * or reasons without dragging `lib/supabase/server` into the browser bundle.
 * Everything here is a constant, a type or a guard; the two rules it encodes
 * are product decisions (ADR-0037):
 *
 *   V1 knows exactly two conditions, `loose` and `boxed`
 *   an administrator may pick six reasons — never `initial_import`, which
 *   belonged to the one legacy opening balance and is booked by server
 *   tooling no client role can execute
 */
import type { CatalogFigure } from "@/lib/catalog/types";
import {
  ITEM_TYPES, isItemType, itemTypeOf, type ItemType,
} from "@/lib/catalog/item-type";
import { V1_CONDITION } from "@/lib/shop/offer";

/**
 * The vocabulary the database still knows — `loose` and `boxed`.
 *
 * NOT the set an operator may choose from any more; see
 * `OPERATIVE_CONDITION`. This list stays because historical rows exist and
 * have to be *read* and *labelled*: an old order line, an imported workbook
 * row and the eight Staging fixture positions are all genuinely `boxed`, and
 * a screen that printed "Lose" over them would be lying about the past.
 */
export const CONDITIONS = ["loose", "boxed"] as const;
export type Condition = (typeof CONDITIONS)[number];

export function isCondition(value: unknown): value is Condition {
  return typeof value === "string" && (CONDITIONS as readonly string[]).includes(value);
}

/**
 * The one condition SkyIsles trades (0108).
 *
 * SkyIsles handelt ausschließlich mit losen Figuren. OVP is no longer an
 * operative product; whoever wants to trade originally packaged figures uses
 * another platform for that.
 *
 * NOT a fourth copy of the rule: this is `V1_CONDITION` from
 * `lib/shop/offer.ts`, which is itself the client-side twin of
 * `public.v1_sale_condition()` (0028). Since 0108 the database refuses any
 * other condition in `record_inventory_movement()` and `set_shop_listing()`,
 * so a screen that offered one would be offering a refusal.
 * `loose-only-ui.test.ts` holds the three expressions of the rule together.
 */
export const OPERATIVE_CONDITION: Condition = V1_CONDITION;

/**
 * May an operator still act on this position?
 *
 * `false` for a historical `boxed` row: it is shown, it is labelled, its
 * history is readable — but booking, pricing and listing it would be refused
 * by 0108, so those controls are not offered. Reading is never gated.
 */
export function isOperativeCondition(value: unknown): boolean {
  return value === OPERATIVE_CONDITION;
}

/**
 * The reasons an administrator may pick, in the order they are offered.
 *
 * `initial_import` is deliberately absent: it belonged to the one legacy
 * opening balance and is booked by server tooling through
 * `system_record_inventory_movement()`, which no browser can reach. The
 * database still accepts the value — this list is a product decision, not a
 * constraint, and the constraint is where it belongs.
 *
 * `sale_skyisles` is absent for the same reason and a different one: since
 * 0025 a sale booked here is `sale` (ADR-0065). The old value stays a
 * permitted value in the database forever — history can never be renamed —
 * so it still has a label in `de.inventory.reasons`. It just cannot be
 * chosen for a NEW booking.
 */
export const MOVEMENT_REASONS = [
  "purchase",
  "sale_external",
  "sale",
  "return",
  "correction",
  "writeoff",
] as const;

export type MovementReason = (typeof MOVEMENT_REASONS)[number];

export function isMovementReason(value: unknown): value is MovementReason {
  return typeof value === "string" && (MOVEMENT_REASONS as readonly string[]).includes(value);
}

/**
 * Where the price a position is offered for came from (ADR-0045).
 *
 * `manual`    somebody typed it; it is never recomputed
 * `automatic` derived from the market price and the shop-wide percentage
 *
 * Sent by the database rather than derived here from `salePrice === null`.
 * The same information, but stated once instead of re-inferred wherever it
 * is displayed.
 */
export const PRICE_SOURCES = ["manual", "automatic"] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];

export function isPriceSource(value: unknown): value is PriceSource {
  return typeof value === "string" && (PRICE_SOURCES as readonly string[]).includes(value);
}

export type InventoryRow = {
  inventoryId: number;
  skyId: string;
  condition: Condition;
  quantity: number;
  reserved: number;
  available: number;
  /**
   * The MANUAL price override, or null when the automatic price applies.
   *
   * Since ADR-0045 this is not "the price" — `effectivePrice` is. Null here
   * means "no override", not "no price".
   */
  salePrice: number | null;
  /**
   * What the shop actually charges: the override, or market x percentage.
   * Null when there is neither an override nor a market price to derive one
   * from — such a position cannot be listed.
   */
  effectivePrice: number | null;
  priceSource: PriceSource;
  isListed: boolean;
  note: string | null;
  updatedAt: string;
};

/** The shop-wide configuration an administrator can change (ADR-0045). */
export type ShopSettings = {
  /** Percent of the market price. 90 means "ask nine tenths". */
  pricePercentage: number;
  updatedAt: string | null;
};

/** The bounds the database enforces. Stated here so a form can say them. */
export const MIN_PERCENTAGE = 0.01;
export const MAX_PERCENTAGE = 500;

export function isValidPercentage(value: number): boolean {
  return Number.isFinite(value) && value >= MIN_PERCENTAGE && value <= MAX_PERCENTAGE;
}

/** A position together with the figure it holds. */
/**
 * Was der Betrieb an einer ZUBEHÖRPOSITION pflegt — und was noch fehlt.
 *
 * Kommt aus `seller_sale_state()` (`0141`), einem reinen Lesezugriff. Der
 * **Grund** wird dort aus `admin_shop_listing_audit()` gejoint, nicht
 * nachgerechnet: eine zweite Herleitung im Browser wäre eine zweite
 * Wahrheit, und sie liefe auseinander, sobald jemand eine Regel ändert.
 *
 * `null` heißt **unbekannt**, nie „verkäuflich": liefert die Datenbank zu
 * einer Position keinen Satz — weil `0141` noch nicht angewendet ist oder
 * die Zeile ihr unbekannt ist —, zeigt die Oberfläche keine Steuerung an.
 */
export type SaleState = {
  itemType: string;
  saleReleased: boolean;
  /** `disc_only` … `portal_cable`, oder null = nicht angegeben. */
  deliveryScope: string | null;
  /** 0, 6, 12, 16, 18 — oder null = nicht erfasst. Nur bei Spielen. */
  uskRating: number | null;
  /** Darf diese Position öffentlich verkauft werden? */
  sellable: boolean;
  /** Warum nicht — der eine Grund aus der einen Leiter, oder null. */
  reason: string | null;
};

export type InventoryPosition = InventoryRow & {
  /** null when the position belongs to something outside the collector catalog. */
  figure: CatalogFigure | null;
  /**
   * Der Verkaufszustand dieser Position, oder `null`, wenn die Datenbank
   * ihn nicht liefert (`0141` nicht angewendet). **Nicht raten:** ohne
   * Auskunft zeigt die Karte die Zubehörsteuerungen nicht an.
   */
  saleState?: SaleState | null;
  /**
   * Wie viele Konten diese FIGUR vorgemerkt haben (`0145`, ADR-0136).
   *
   * An der FIGUR und nicht an der Position: ein Favorit haengt an der
   * SKY-ID, nicht an einem Zustand. Lose und originalverpackt sind zwei
   * Positionen derselben Figur und zeigen dieselbe Zahl — alles andere
   * waere eine Aufteilung, die die Favoriten nicht kennen.
   *
   * `undefined` heisst „nicht geladen", nicht „niemand": `favorite_demand()`
   * antwortet nur einem aktiven Verkaeuferbetrieb, und Figuren ohne Favorit
   * fehlen in der Antwort.
   */
  favoriteDemand?: number;
};

export type Movement = {
  id: number;
  delta: number;
  reason: string;
  unitCost: number | null;
  currency: string | null;
  note: string | null;
  createdAt: string;
};

/* ---------------------------------------------------------------------------
 * DIE ART EINER LAGERPOSITION (0135/0137, ADR-0128)
 *
 * Das Lager hat immer schon Zubehör geführt: 13 Lagerzeilen und 18
 * Verkaufspositionen hängen an Spielen, seit dem ersten Tag. Nur sichtbar
 * waren sie nicht — `fetchInventory()` hat jede nicht sammelbare Zeile in
 * einen `outsideScope`-Topf sortiert, und an die Oberfläche ging davon nur
 * die ANZAHL.
 *
 * DIE TRENNUNG BLEIBT, SIE WIRD NUR LESBAR. Ein Spiel ist weiterhin nicht
 * sammelbar und nicht shopfähig — das entscheiden `non_collectible_categories()`
 * und `is_shop_eligible()` in der Datenbank, und daran ändert eine Ansicht
 * nichts. Was hier entsteht, ist die dritte Frage neben „welche Serie" und
 * „welcher Zustand": WAS ist das für ein Artikel.
 * ------------------------------------------------------------------------ */

/**
 * Die Arten, in der Reihenfolge, in der die Übersicht sie anbietet.
 *
 * DAS VOKABULAR LIEGT IM KATALOG, nicht hier: `item_type` ist eine Spalte
 * von `skylanders`, und derselbe Satz Werte beschreibt den Zubehörbereich
 * des Katalogs, die Artikelsuche im Orderbuch und diese Liste. Eine zweite
 * Fassung davon wäre eine zweite Wahrheit, die beim sechsten Artikeltyp
 * auseinanderläuft. Die Namen hier bleiben, weil die Lageransicht sie so
 * nennt; die Werte kommen aus `@/lib/catalog/item-type`.
 */
export const INVENTORY_KINDS = ITEM_TYPES;
export type InventoryKind = ItemType;

export function isInventoryKind(value: unknown): value is InventoryKind {
  return isItemType(value);
}

/**
 * Was für ein Artikel liegt auf dieser Position?
 *
 * `figure`, WENN NICHTS ANDERES BEKANNT IST — die Regel steht in
 * `itemTypeOf()`: fehlt `item_type`, weil die Zeile aus einer Abfrage ohne
 * die Spalte kommt oder weil sie älter ist als `0135`, dann verhält sich die
 * Ansicht wie vorher.
 *
 * Eine Position OHNE Katalogzeile ist ebenfalls `figure` — über sie ist
 * nichts bekannt, und eine unbekannte Zeile wird nicht zu Zubehör erklärt.
 */
export function inventoryKind(position: InventoryPosition): InventoryKind {
  return itemTypeOf(position.figure ?? {});
}

/** Ist das Zubehör — also alles außer einer Figur? */
export function isAccessoryPosition(position: InventoryPosition): boolean {
  return inventoryKind(position) !== "figure";
}

/**
 * Darf diese Position im Shop angeboten und bepreist werden?
 *
 * FÜR EINE FIGUR IMMER JA. Für Zubehör: nur mit ausdrücklicher Freigabe
 * dieser Position (ADR-0129/0130). Bis `0139` war die Antwort pauschal
 * nein, weil `shop_offers()` jedes Zubehörteil am Artikeltyp herausfilterte
 * und der Schalter „Im Shop" damit ins Leere gezeigt hätte — „ein Knopf,
 * von dem schon bekannt ist, dass er nicht wirkt, ist keine Auswahl,
 * sondern eine Falle."
 *
 * Jetzt wirkt er, sobald die Position freigegeben ist. Die Freigabe selbst
 * ist ein eigener Schalter (`hasSaleControls()`), und sie verlangt von der
 * Datenbank Lieferumfang, Preis und — bei Spielen — eine erfasste
 * USK-Kennzeichnung.
 *
 * DER BESTAND BLEIBT DAVON UNBERÜHRT. Buchen, zählen und die Historie lesen
 * geht für ein Portal wie für jede Figur — `record_inventory_movement()`
 * fragt nur den Zustand, und `lose` ist er.
 */
export function isShopGoods(position: InventoryPosition): boolean {
  if (!isAccessoryPosition(position)) return true;
  /*
   * SEIT ADR-0129/0130 IST DAS KEIN NEIN MEHR, SONDERN EIN VIELLEICHT.
   *
   * Zubehör darf verkauft werden — aber Stück für Stück, und erst nach
   * einer ausdrücklichen Freigabe an DIESER Position
   * (`shop_inventory.sale_released`, `0139`). Ob sie da ist, weiß nur die
   * Datenbank: `seller_sale_state()` liefert sie.
   *
   * OHNE AUSKUNFT: NEIN. Ein `undefined` heißt „die Datenbank hat nichts
   * gesagt" — etwa weil `0141` noch nicht angewendet ist. Dann wird keine
   * Steuerung angeboten, statt eine anzubieten, die ins Leere liefe.
   */
  return position.saleState?.saleReleased === true;
}

/**
 * Darf der Betrieb an dieser Zubehörposition überhaupt etwas einstellen?
 *
 * Anders als `isShopGoods()`: Preis, Lieferumfang und der Freigabeschalter
 * gehören zu JEDER Zubehörposition, auch zu einer noch nicht freigegebenen
 * — sonst käme man nie zur Freigabe. Gebraucht wird nur die Auskunft, dass
 * es sie gibt.
 */
export function hasSaleControls(position: InventoryPosition): boolean {
  return isAccessoryPosition(position) && (position.saleState ?? null) !== null;
}
