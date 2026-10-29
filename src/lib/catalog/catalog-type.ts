/**
 * DER TYPE — was ein Katalogartikel IST, als Menge (CAT-10).
 *
 * ===========================================================================
 * EIN ARTIKEL HAT MEHRERE TYPES UND HOECHSTENS EIN BANNER
 * ===========================================================================
 *
 * Bis CAT-10 trug eine Katalogzeile EINE Klassifikation: `card_type`, sieben
 * Werte, eine Spalte. Gemessen am 2026-10-29 verschwieg das bei **192 von
 * 701** Zeilen eine Eigenschaft — denn was ein Ding IST (Giant, Trap,
 * Fahrzeug) hing an der KATEGORIE (`categories.catalog_group`) und kam nie
 * auf eine Kachel. „Legendary Giant" war in der Datenbank entweder ein Giant
 * oder ein Legendary, nie beides.
 *
 * Seit `0163` traegt die Zeile `types text[]` — die vollstaendige Menge — und
 * `visible_type` — den EINEN, der als Banner erscheint. Die Datenbank
 * garantiert mit einer Zeilen-CHECK, dass der sichtbare Type zur Menge
 * gehoert; diese Datei ist das Vokabular, die Reihenfolge und die
 * Beschriftung dazu.
 *
 * ===========================================================================
 * WAS DIESE DATEI NICHT ENTSCHEIDET — UND DAS IST DER WICHTIGSTE SATZ
 * ===========================================================================
 *
 * SIE ENTSCHEIDET NICHT DIE KARTENKUNST. `skylanders.card_type` steuert
 * weiterhin, auf welches Artwork die senkrechte Karte in Shop und Sammlung
 * gedruckt wird — sieben Werte, jeder mit einer echten PNG-Datei
 * (`card-template.ts`). Das ist eine ANDERE Frage, und sie bleibt eine eigene
 * Spalte.
 *
 * WARUM NICHT ABGELEITET, obwohl es naheliegt: der Betreiber hat genau das
 * gefragt, und der Beweis liegt in
 * `supabase/checks/cat10_projection_proof.sql`, gegen alle 701 Zeilen
 * gefahren. Eine Projektion „card_type = der staerkste Variantentype" ist
 * NICHT verlustfrei:
 *
 *   1. SKY-0854 „White Flocked LightCore Prism Break" traegt heute
 *      `card_type = 'standard'`, waere nach der Projektion aber `special` —
 *      eine Kartenkunst, die sich ohne Zutun aendert.
 *   2. `EDITION_RANK` gibt `standard`, `chase` und `elite` denselben Rang 0.
 *      Eine Menge mit Chase UND Elite hat damit keine fachliche Antwort,
 *      sondern nur eine Reihenfolge im Quelltext. 45 bzw. 42 Zeilen koennten
 *      morgen beides tragen.
 *   3. Jedes Hinzufuegen eines Variantentypes wuerde die Kartenkunst
 *      mitbewegen — bei 508 Zeilen, 39 davon im Shop gelistet.
 *
 * Also: zwei Eigenschaften, zwei Spalten, zwei Bearbeitungswege. Der Dialog
 * fuehrt sie getrennt und benennt sie getrennt („Types" und „Kartenkunst").
 * Das ist keine zweite Wahrheit, sondern eine zweite FRAGE — dieselbe
 * Trennung, die `item-type.ts` zwischen Artikeltyp, Sammelbarkeit,
 * Sichtbarkeit und Shopfaehigkeit zieht.
 *
 * SIE ENTSCHEIDET AUCH NICHT DIE VARIANTENBEZIEHUNG. `base_sky_id`
 * (ADR-0156) und `character_id` (ADR-0034) sind davon unberuehrt: gemessen
 * tragen 178 Zeilen einen Kartentyp OHNE Basisfigur und 8 Varianten den Typ
 * `standard`. Ein Artikel kann „Legendary" sein, ohne dass eine
 * Variantenbeziehung entsteht.
 *
 * SIE ENTSCHEIDET AUCH NICHT DIE KATALOGNAVIGATION. Die Gruppen-Tabs lesen
 * weiter `categories.catalog_group` (Entscheidung D5). Beide stimmen am Tag
 * der Migration ueberein, weil die Erstbelegung von dort kommt.
 */

/**
 * Die drei Gruppen, und in ihnen die siebzehn speicherbaren Werte.
 *
 * „STANDARD" IST KEIN WERT, SONDERN DIE LEERE MENGE. Das ist die einzige
 * Stelle, an der diese Datei von der Liste des Betreibers abweicht, und sie
 * gewinnt dadurch eine Zusage: es gibt keinen Zustand „Standard UND Giant",
 * der erklaert werden muesste. Wer keinen Type hat, ist Standard — und das
 * Dropdown zeigt dafuer „–".
 */
export const TYPE_GROUPS = {
  figures: ["giant", "swapper", "master", "sensei", "mini", "sidekick"],
  extra: ["item", "trap", "vehicle", "crystal"],
  variants: ["lightcore", "special", "dark", "legendary", "elite", "chase",
             "prestige"],
} as const;

export type TypeGroup = keyof typeof TYPE_GROUPS;

/** Die Gruppen in Anzeigereihenfolge — kuratiert, nicht alphabetisch. */
export const TYPE_GROUP_ORDER: readonly TypeGroup[] = ["figures", "extra", "variants"];

/** Alle siebzehn, in der Reihenfolge, in der das Formular sie anbietet. */
export const CATALOG_TYPES = [
  ...TYPE_GROUPS.figures,
  ...TYPE_GROUPS.extra,
  ...TYPE_GROUPS.variants,
] as const;

export type CatalogType = (typeof CATALOG_TYPES)[number];

export function isCatalogType(value: unknown): value is CatalogType {
  return typeof value === "string"
      && (CATALOG_TYPES as readonly string[]).includes(value);
}

/** In welcher Gruppe ein Type steht. */
export function groupOfType(type: CatalogType): TypeGroup {
  for (const gruppe of TYPE_GROUP_ORDER) {
    if ((TYPE_GROUPS[gruppe] as readonly string[]).includes(type)) return gruppe;
  }
  /* Unerreichbar: `CATALOG_TYPES` entsteht aus den drei Gruppen. */
  return "figures";
}

/** Ist das ein Variantentype — also einer, der mit der Kartenkunst Woerter teilt? */
export function isVariantType(type: CatalogType): boolean {
  return groupOfType(type) === "variants";
}

/**
 * Die Beschriftung.
 *
 * ABSICHTLICH NICHT UEBERSETZT, aus demselben Grund wie bei `card-type.ts`:
 * „Legendary", „Chase" und „LightCore" sind, was Sammler sagen — auf Deutsch
 * genauso wie auf Englisch. ADR-0019 verlangt eine deutsche Oberflaeche, kein
 * erfundenes Deutsch dort, wo die Sache englisch heisst.
 *
 * `master` heisst in der Anzeige „Master" und nicht „Trap Master": der
 * Betreiber hat es so benannt, und das Banner hat 13 px Hoehe.
 */
export const TYPE_LABELS: Readonly<Record<CatalogType, string>> = {
  giant: "Giant",
  swapper: "Swapper",
  master: "Master",
  sensei: "Sensei",
  mini: "Mini",
  sidekick: "Sidekick",
  item: "Item",
  trap: "Trap",
  vehicle: "Vehicle",
  crystal: "Crystal",
  lightcore: "LightCore",
  special: "Special",
  dark: "Dark",
  legendary: "Legendary",
  elite: "Elite",
  chase: "Chase",
  prestige: "Prestige",
};

/** Deutsche Ueberschriften der drei Gruppen im Formular. */
export const TYPE_GROUP_LABELS: Readonly<Record<TypeGroup, string>> = {
  figures: "Figuren",
  extra: "Weitere Artikel",
  variants: "Varianten",
};

/**
 * DIE PRIORITAET — und sie ist ein VORSCHLAG, niemals eine Wirkung
 * (Entscheidung D4).
 *
 * Der Betreiber hat die Reihenfolge genannt: Chase > Elite > Legendary >
 * Dark > Special > LightCore > Figuren/Weitere > Standard. `prestige` stand
 * nicht darin, weil es erst mit Entscheidung D1 dazukam; es steht hier GANZ
 * oben, weil es die seltenste Form ist (drei Zeilen im ganzen Katalog, eine
 * davon eine Employee Edition).
 *
 * WAS SIE DARF: eine Vorauswahl im Dropdown anbieten, solange niemand
 * entschieden hat.
 *
 * WAS SIE NICHT DARF: ein Banner erzeugen. Eine unentschiedene Zeile zeigt
 * KEIN Banner — sonst wuerde das Hinzufuegen eines Types den oeffentlichen
 * Katalog still veraendern, und zwar auf 248 Kacheln (gemessen). Deshalb
 * liest nur das Dropdown diese Liste, und `bannerType()` unten liest sie
 * ausdruecklich nicht.
 */
export const TYPE_PRIORITY: readonly CatalogType[] = [
  "prestige", "chase", "elite", "legendary", "dark", "special", "lightcore",
  ...TYPE_GROUPS.figures,
  ...TYPE_GROUPS.extra,
];

/**
 * Welcher Type oben steht, wenn mehrere hinterlegt sind und niemand gewaehlt
 * hat. `null` bei leerer Menge.
 */
export function proposeVisibleType(
  types: readonly string[],
): CatalogType | null {
  const vorhanden = asCatalogTypes(types);
  for (const kandidat of TYPE_PRIORITY) {
    if (vorhanden.includes(kandidat)) return kandidat;
  }
  return null;
}

/**
 * Die Menge, bereinigt: nur bekannte Werte, jeder einmal, in fester
 * Reihenfolge.
 *
 * `CATALOG_TYPES`-Reihenfolge und nicht die der Datenbank: eine Kachel soll
 * nicht davon abhaengen, in welcher Reihenfolge jemand die Kaestchen
 * angeklickt hat. Ein Wert, den diese Fassung nicht kennt — nach einer
 * spaeteren Migration, gegen einen aelteren Build —, faellt heraus statt eine
 * Beschriftungssuche zu zerbrechen; dieselbe Regel wie `asCardType()`.
 */
export function asCatalogTypes(value: unknown): CatalogType[] {
  if (!Array.isArray(value)) return [];
  const gesehen = new Set(value.filter(isCatalogType));
  return CATALOG_TYPES.filter((t) => gesehen.has(t));
}

/**
 * WAS DIE KACHEL ZEIGT — die einzige Stelle, die darüber entscheidet.
 *
 * `null` heisst: kein Banner. Drei Faelle fuehren dorthin, und sie sind
 * absichtlich nicht unterscheidbar fuer den Betrachter:
 *
 *   * niemand hat entschieden (`visible_type` ist NULL, `decided` false)
 *   * jemand hat ausdruecklich „–" gewaehlt (NULL, `decided` true)
 *   * der gewaehlte Type ist aus der Menge gefallen (die Datenbank setzt
 *     dann auf „–" zurueck, `0163`)
 *
 * SIE LIEST DIE PRIORITAET NICHT. Das ist der Unterschied zwischen einem
 * Vorschlag und einer Wirkung (Entscheidung D4).
 */
export function bannerType(figure: {
  visibleType?: string | null;
}): CatalogType | null {
  return isCatalogType(figure.visibleType) ? figure.visibleType : null;
}

/**
 * Welche Types ein Dropdown an der Kachel anbieten darf: „–" plus die
 * hinterlegten, und nichts sonst.
 *
 * Nicht alle siebzehn — das war eine ausdrueckliche Anforderung. Ein
 * Dropdown, das „Giant" anbietet, wo kein Giant hinterlegt ist, waere ein
 * zweiter Bearbeitungsweg fuer die Menge, und den gibt es nur im Dialog.
 */
export function bannerChoices(types: readonly string[]): CatalogType[] {
  return asCatalogTypes(types);
}

/**
 * Welche Types die HELLE Platte bekommen.
 *
 * Dieselbe Zweiteilung, die `edition-banner.tsx` seit UX-01C aus
 * `EDITION_RANK` gezogen hat: Legendary und Prestige hell, alles andere
 * leise. Hier steht sie als Liste statt als Rangrechnung, weil es jetzt
 * siebzehn Werte gibt und ein Rang fuer „Giant" eine Erfindung waere — ein
 * Giant ist keine staerkere Ausgabe von irgendetwas.
 */
const HELL: readonly CatalogType[] = ["legendary", "prestige"];

export function isHeadlineType(type: CatalogType): boolean {
  return HELL.includes(type);
}
