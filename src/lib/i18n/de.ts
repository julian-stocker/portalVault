/**
 * User-facing copy, kept in one place.
 *
 * V1 ships in German only (ADR-0012). There is deliberately no i18n framework
 * and no locale segment in the URL. Copy lives here instead of being scattered
 * across components so that adding English later stays cheap.
 *
 * Convention (ADR-0019): keys are English, values are German.
 * Rule: no user-facing strings inline in JSX — always go through this object.
 */
export const de = {
  locale: "de-AT",

  app: {
    // SkyIsles is the public product name; PortalVault stays the technical
    // project name in the repository and the code (ADR-0028).
    name: "SkyIsles",
    tagline: "Die Plattform für Skylanders-Sammler",
    description:
      "Katalog, Marktpreise und persönliche Sammlungsverwaltung für Skylanders.",
  },

  catalog: {
    title: "Katalog",
    searchLabel: "Figur suchen",
    searchPlaceholder: "Name eingeben …",
    allSeries: "Alle",
    heading: "Skylanders Katalog",
    seriesNav: "Serie wählen",
    /** Zweite Navigationsebene: Produktgruppe innerhalb der Serie (ADR-0041). */
    groupNav: "Art wählen",
    groupAll: "Alle",
    /** Untertitel unter dem Wortzeichen im Katalogkopf. */
    intro: "Entdecke alle Figuren aus den Skylands.",
    /** Suche über alle Serien: Trefferzahl je Serie und insgesamt. */
    hitCount: (count: number) => (count === 1 ? "1 Treffer" : `${count} Treffer`),
    searchTotal: (count: number) =>
      count === 1 ? "1 Treffer im Katalog" : `${count} Treffer im Katalog`,
    noHitsHere: "Keine Treffer in dieser Serie.",
    /** "1 Figur" / "561 Figuren". No grammar engine, just the one plural. */
    figureCount: (count: number) => (count === 1 ? "1 Figur" : `${count} Figuren`),
    /** With a series chosen: "Swap Force · 89 Figuren". */
    countInSeries: (series: string, count: number) =>
      `${series} · ${count === 1 ? "1 Figur" : `${count} Figuren`}`,
    /**
     * Anzeigefilter im Katalog-Sektionskopf. Nur für angemeldete Nutzer.
     * An (Standard) = alles zeigen, aus = nur Fehlendes (ADR-0038, V4.3).
     */
    /** Der Besitzfilter im Katalog: drei benannte Zustände, kein Umschalter. */
    ownershipNav: "Besitz filtern",
    ownershipAll: "Alle",
    ownershipOwned: "Besitz",
    ownershipMissing: "Fehlen",
    /** Wenn der Filter aus ist und trotzdem nichts fehlt. */
    /** „Fehlen" ist leer: alles vorhanden. */
    ownedEmpty: "Aus dieser Serie besitzt du noch nichts.",
    missingEmpty: "Aus dieser Serie besitzt du bereits alles.",
    empty: "Keine Figuren gefunden.",
    emptyHint: "Versuche einen anderen Namen oder eine andere Serie.",
    /** Serie bleibt bestehen — zurückgesetzt werden Suche und Besitzfilter. */
    resetFilters: "Filter zurücksetzen",
    loading: "Katalog wird geladen …",
    errorTitle: "Der Katalog konnte nicht geladen werden.",
    errorHint: "Das lag nicht an dir. Versuch es bitte noch einmal.",
    retry: "Erneut versuchen",
    noImage: "Kein Bild",
    noPrice: "Preis offen",
    collect: "Zur Sammlung hinzufügen",
    // Kein Häkchen und kein „erledigt": Besitz ist ein Zustand der Vitrine,
    // keine abgehakte Aufgabe (ADR-0038). Sichtbar trägt ihn seit V2.1 der
    // Kartenrahmen; diese Texte sind für Screenreader und Tooltips.
    collected: "In deiner Sammlung",
    collectedBadge: "In deiner Sammlung",
    collectedHint: "Aus der Sammlung entfernen",
    collectSignedOut: "Zur Sammlung hinzufügen",
    /** Beschriftung der separaten Navigationsaktion auf der Karte. */
    info: "Info",
    infoFor: (name: string) => `Info zu ${name}`,
    collectFailed: "Das hat nicht geklappt.",
    inactive: "Nicht mehr im Katalog",
    backToCatalog: "Zurück zum Katalog",
    marketValue: "Marktwert",
    series: "Serie",
    /** Screenreader-Vorspann für die SKY-ID auf der Detailseite. */
    reference: "Sammlerreferenz",
  },

  character: {
    heading: "Charakter",
    element: "Element",
    species: "Spezies",
    // Nicht "Rolle": Mini Jini erschien zuerst als Sidekick und später als
    // Mini. Gespeichert ist die Debütrolle des Charakters, nicht die des
    // Sammelobjekts (ADR-0034).
    role: "Ursprüngliche Rolle",
    // Deliberately not "Debüt": the value is derived from the linked figures
    // and answers which series brought the first figure. Kaos exists since
    // 2011 but his first figure is from Imaginators (ADR-0034).
    firstRelease: "Erste Figur",
    related: "Weitere Versionen",
    source: (label: string) => `Quelle: ${label}`,
    verified: (date: string) => `geprüft am ${date}`,
    roles: {
      core: "Core",
      giant: "Giant",
      swapper: "Swapper",
      "trap-master": "Trap Master",
      supercharger: "SuperCharger",
      sensei: "Sensei",
      mini: "Mini",
      sidekick: "Sidekick",
    } as Record<string, string>,
  },

  collection: {
    title: "Sammlung",
    subline: "Deine Skylanders. Deine Geschichte.",
    overview: "Überblick",
    statusFilter: "Sammlung filtern",
    collectedOf: (owned: number, total: number) => `${owned} von ${total} gesammelt`,
    complete: (percent: string) => `${percent} vollständig`,
    /** Kurzform als Beschriftung über der Prozentzahl in der Vitrine. */
    completeLabel: "Vollständig",
    resetFilters: "Filter zurücksetzen",
    /** Die Vitrine zeigt nur Besitz — „Fehlend" und „Gesammelt" gibt es hier
        nicht mehr, weil beides in der Sammlung keine Unterscheidung wäre
        (ADR-0038). Serien kommen zur Laufzeit dazu. */
    filter: {
      all: "Alle",
      duplicates: "Duplikate",
    } as Record<string, string>,
    /** Kopfzeile der Vitrine. */
    heroLabel: "Deine Sammlung",
    ownedFigures: "Figuren in deiner Vitrine",
    ofTotal: (total: number) => `von ${total} im Katalog`,
    /** Der Hero folgt dem aktiven Segment, nicht dem Suchtext. */
    ofSeries: (total: number, series: string) => `von ${total} in ${series}`,
    ownedInSeries: (series: string) => `Figuren aus ${series}`,
    duplicateFigures: "Figuren mit Duplikaten",
    extraCopies: "Zusätzliche Exemplare",
    extraCopiesValue: "Marktwert der Zusätze",
    /** Grid-Zähler, wenn eine Suche das Segment weiter einschränkt. */
    searchCount: (visible: number, total: number) =>
      `${visible} von ${total === 1 ? "1 Figur" : `${total} Figuren`}`,
    stillMissing: (count: number) =>
      count === 1 ? "1 Figur fehlt noch" : `${count} Figuren fehlen noch`,
    missingLabel: "Fehlen noch",
    /** Vorgelesen, während die Sammlung geladen wird. */
    loading: "Sammlung wird geladen …",
    /** Zusatzzeile, wenn der Duplikatfilter aktiv ist. */
    duplicateLine: (figures: number, extra: number, value: string) =>
      `${figures === 1 ? "1 Figur" : `${figures} Figuren`} mit Duplikaten · ` +
      `${extra === 1 ? "1 zusätzliches Exemplar" : `${extra} zusätzliche Exemplare`} · ` +
      `${value} Extra-Wert`,
    filterLabel: "Filter",
    /** Ansichtsumschalter und Tabellenkopf. */
    viewLabel: "Ansicht",
    view: { symbols: "Symbole", table: "Tabelle" } as Record<string, string>,
    table: {
      image: "Vorschau",
      figure: "Figur",
      series: "Serie",
      element: "Element",
      quantity: "Anzahl",
      total: "Gesamtwert",
      action: "Aktion",
    },
    showcaseEmpty: "Deine Vitrine ist noch leer.",
    showcaseEmptyHint:
      "Im Katalog fügst du mit einem Tippen die erste Figur hinzu.",
    toCatalog: "Zum Katalog",
    noMatch: (status: string) =>
      status === "duplicates" ? "Keine Duplikate" : "Keine Figuren gefunden.",
    noMatchHint: "Wähle eine andere Serie oder setze den Filter zurück.",
    distinctFigures: "Verschiedene Figuren",
    catalogTotal: "Figuren im Katalog",
    progress: "Fortschritt",
    // Summe der Referenz-Marktwerte der gesammelten Exemplare — kein Kauf-,
    // Verkaufs- oder Versicherungswert (ADR-0033).
    estimatedValue: "Geschätzter Marktwert",
    withoutPrice: (count: number) =>
      count === 1
        ? "1 Figur ohne Marktpreis ist nicht in der Summe enthalten."
        : `${count} Figuren ohne Marktpreis sind nicht in der Summe enthalten.`,
    nonCollectibleOwned: (count: number) =>
      count === 1
        ? "1 Eintrag in deiner Sammlung ist ein Spiel und zählt nicht zum Sammelfortschritt."
        : `${count} Einträge in deiner Sammlung sind Spiele und zählen nicht zum Sammelfortschritt.`,
    inactiveOwned: (count: number) =>
      count === 1
        ? "1 Figur in deiner Sammlung ist nicht mehr im Katalog."
        : `${count} Figuren in deiner Sammlung sind nicht mehr im Katalog.`,
    /** Screenreader-Text der Mengenangabe auf der Karte. */
    copies: (count: number) => `${count} Exemplare`,
    remove: "Entfernen",
    removeLabel: (name: string) => `${name} aus der Sammlung entfernen`,
    removed: "Entfernt",
    undo: "Rückgängig",
    removeFailed: "Konnte nicht entfernt werden.",
    empty: "Noch keine Figuren gesammelt",
    emptyHint: "Wechsle auf „Alle“ — der ganze Katalog steht schon hier, tippe bei einer Figur auf „+ Sammlung“.",
    emptyAction: "Zum Katalog",
  },

  dashboard: {
    // Split so the username can be highlighted without inlining German in JSX.
    signedInAs: "Angemeldet als",
  },

  /** Adminbereich. Nie für normale Nutzer sichtbar (ADR-0039). */
  admin: {
    title: "Administration",
    catalog: "Katalog",
    categories: "Kategorien",
    figures: (n: number) => (n === 1 ? "1 Figur" : `${n} Figuren`),
    canonicalName: "Importierter Name",
    publicName: "Öffentlicher Name",
    overrideLabel: "Anzeigename überschreiben",
    overrideHint: "Leer lassen, um wieder den abgeleiteten Namen zu verwenden.",
    /** Kurz genug für eine Karte; die Erklärung steht auf der Detailseite. */
    resetName: "Standard",
    resetToDerived: "Auf den abgeleiteten Namen zurücksetzen",
    overrideActive: "überschrieben",
    visible: "Im Katalog sichtbar",
    hidden: "Verborgen",
    /**
     * Kurz auf der Karte, ausführlich für Screenreader: auf einer 390-px-Karte
     * bricht „Aus dem Katalog nehmen" auf zwei Zeilen, die Bedeutung steht
     * dafür im aria-label.
     */
    hide: "Verbergen",
    show: "Anzeigen",
    hideLong: "Aus dem öffentlichen Katalog nehmen",
    showLong: "Im öffentlichen Katalog zeigen",
    note: "Interne Notiz",
    noteHint: "Nur im Adminbereich sichtbar.",
    group: "Produktgruppe",
    groupUnset: "noch nicht klassifiziert",
    groupHint: "Die Produktgruppe hängt an der Kategorie, nicht an der Figur.",
    series: "Serie",
    category: "Kategorie",
    skyId: "SKY-ID",
    edit: "Bearbeiten",
    details: "Details",
    /** Inline-Bearbeitung direkt im Katalog (ADR-0042). */
    editNameFor: (name: string) => `Anzeigename von ${name} bearbeiten`,
    hiddenBadge: "Verborgen",
    /** Kennzeichnung im Kopf, damit der Modus jederzeit erkennbar ist. */
    modeBadge: "Admin",
    save: "Speichern",
    saved: "Gespeichert.",
    history: "Letzte redaktionelle Änderungen",
    noHistory: "Noch keine redaktionellen Änderungen.",
    searchLabel: "Figur oder SKY-ID suchen",
    hiddenFilter: "Nur verborgene",
    allSeries: "Alle Serien",
    page: (current: number, last: number) => `Seite ${current} von ${last}`,
    previous: "Zurück",
    next: "Weiter",
    notAllowed: "Dafür fehlt die Berechtigung.",
    writeFailed: "Das hat nicht geklappt.",
    unknownFigure: "Unbekannte Figur.",
    unknownCategory: "Unbekannte Kategorie.",
    nameTooLong: "Der Name ist zu lang.",
    noteTooLong: "Die Notiz ist zu lang.",
    completionNote:
      "Verborgene Figuren zählen weder im Zähler noch im Nenner der Sammlungsfortschritts.",

    /** Shop-Einstellungen (ADR-0045). */
    shopSettings: "Shop-Einstellungen",
    defaultShopPrice: "Standard-Shoppreis",
    percentageLabel: "Prozent vom Marktpreis",
    percentageHint: (n: string) =>
      `${n} % vom Marktpreis, wenn kein manueller Preis gesetzt ist.`,
    percentageRange: "Der Prozentsatz muss größer als 0 und höchstens 500 sein.",
    percentageSaved: "Gespeichert.",

    /** Bildverwaltung (ADR-0046). */
    image: "Bild",
    imageChange: "Bild ändern",
    imageReplace: "Bild ersetzen",
    imageRemove: "Eigenes Bild entfernen",
    imageOwn: "Eigenes Bild",
    imageImported: "Importiertes Bild",
    imageNone: "Kein Bild",
    imageUploading: "Wird hochgeladen …",
    imageFailed: "Das Bild konnte nicht gespeichert werden.",
    imageTooLarge: "Die Datei ist zu groß (höchstens 2 MB).",
    imageWrongType: "Nur JPEG, PNG oder WebP.",
    imageHint: "JPEG, PNG oder WebP, höchstens 2 MB. Das importierte Bild bleibt erhalten.",
  },

  /** Lagerverwaltung des Betreibers (ADR-0037). Nur für Admins. */
  inventory: {
    title: "Lager",
    subline: "Bestand, Preise und Angebote von SkyIsles.",
    searchLabel: "Figur oder SKY-ID suchen",
    positions: (n: number) => (n === 1 ? "1 Position" : `${n} Positionen`),
    condition: "Zustand",
    conditionLoose: "Lose",
    conditionBoxed: "OVP",
    quantity: "Bestand",
    reserved: "Reserviert",
    available: "Verfügbar",
    marketPrice: "Marktpreis",
    /** Im Adminbereich „Shop-Preis" — eindeutiger als der Markenname (V6). */
    salePrice: "Shop-Preis",
    priceAutomatic: (n: string) => `Automatisch · ${n} %`,
    priceManual: "Manuell",
    priceNoBasis: "Kein Shop-Preis",
    priceModeAuto: (price: string) => `Automatisch (${price})`,
    priceModeManual: "Manueller Preis",
    priceResetAuto: "Auf Automatik zurücksetzen",
    noPrice: "kein Preis",
    listed: "Im Shop",
    notListed: "Nicht im Shop",
    listedShort: "Im Shop",
    stockFilter: "Bestand",
    stockAll: "Alle",
    stockIn: "Auf Lager",
    stockOut: "Nicht auf Lager",
    listingFilter: "Shop",
    listingAll: "Alle",
    listingOn: "Im Shop",
    listingOff: "Nicht im Shop",
    seriesAll: "Alle Serien",
    changeStock: "Weitere Buchung",
    increase: "Bestand um 1 erhöhen",
    decrease: "Bestand um 1 verringern",
    atFloor: "Bestand kann nicht weiter verringert werden.",
    newPosition: "Position anlegen",
    delta: "Veränderung",
    reason: "Grund",
    noteLabel: "Notiz",
    unitCost: "Stückkosten",
    unitCostHint: "Optional, nur bei Einkauf. Historischer Bestand hat keine.",
    preview: (from: number, to: number) => `Aktuell ${from} → danach ${to}`,
    book: "Buchen",
    cancel: "Abbrechen",
    history: "Letzte Bewegungen",
    noHistory: "Noch keine Bewegungen.",
    noPositions: "Noch keine Lagerposition.",
    empty: "Keine Position gefunden.",
    emptyHint: "Suche nach einem Namen oder einer SKY-ID, um Bestand anzulegen.",
    outsideScope: (n: number) =>
      `${n} historische Position${n === 1 ? "" : "en"} außerhalb des Sortiments (Auditdaten, unverändert).`,
    reasons: {
      purchase: "Einkauf",
      sale_skyisles: "Verkauf SkyIsles",
      sale_external: "Externer Verkauf",
      return: "Rückgabe",
      correction: "Korrektur",
      writeoff: "Abschreibung",
      initial_import: "Anfangsbestand",
    } as Record<string, string>,
    unknownCondition: "Unbekannter Zustand.",
    unknownReason: "Unbekannter Grund.",
    deltaRequired: "Die Veränderung muss eine Zahl ungleich null sein.",
    costPositive: "Stückkosten müssen größer als 0 sein.",
    pricePositive: "Der Preis muss größer als 0 sein.",
    /** „Im Shop" heißt freigegeben, nicht „gerade lieferbar" (ADR-0048). */
    soldOutHint: "Aktuell ausverkauft",
    noPriceHint: "Kein Shop-Preis — erscheint nicht im Shop.",
    wouldGoNegative: "Der Bestand würde unter das Reservierte fallen.",
  },

  /**
   * Das öffentliche Angebot von SkyIsles.
   *
   * Bewusst getrennt von `inventory`: dort steht, was der Betreiber sieht
   * (Bestand, Reserviertes, Notizen), hier steht, was Besucher sehen — ein
   * Preis und ob etwas lieferbar ist. Nie eine Stückzahl (ADR-0037).
   */
  shop: {
    /**
     * Auf der Karte steht nur noch der Preis — der Markenname stand vorher
     * davor („SkyIsles 4,49 €") und war überflüssig: der Kontext ist die
     * Website selbst.
     */
    offerFrom: (price: string) => `ab ${price}`,
    conditionLoose: "Lose",
    conditionBoxed: "OVP",
    addToCart: "In den Warenkorb",
    addToCartFor: (name: string, price: string) =>
      `${name} für ${price} in den Warenkorb legen`,
    /** Wenn mehrere Zustände kaufbar sind, wird erst der Zustand gewählt. */
    chooseCondition: "Zustand wählen",
    chooseConditionFor: (name: string) => `Zustand für ${name} wählen`,
    /**
     * Bestätigung nach dem Hinzufügen (V10).
     *
     * Der Knopf selbst ändert seine Beschriftung nicht mehr — er heißt immer
     * dasselbe, weil er immer dasselbe tut. Bestätigt wird im Toast.
     */
    toastAdded: "Zum Warenkorb hinzugefügt",
    toastIncreased: "Menge im Warenkorb erhöht",
    toastLine: (name: string, condition: string, price: string) =>
      `${name} · ${condition} · ${price}`,
    toastQuantityLine: (quantity: number, name: string, condition: string) =>
      `${quantity}× ${name} · ${condition}`,
    /**
     * Abgelehnte Mengen (V11).
     *
     * Bewusst ohne Stückzahl. „Nur noch 3 verfügbar" wäre der Lagerbestand,
     * und der ist nicht öffentlich (docs/SECURITY.md). Der nächste Schritt
     * des Besuchers ist ohnehin derselbe, egal ob zwei oder zwanzig fehlen.
     *
     * `toastUnchecked` ist absichtlich ein anderer Satz: „nicht verfügbar"
     * wäre eine Behauptung über den Bestand, die wir gar nicht erhalten haben.
     */
    toastDenied: "Keine weitere Menge verfügbar.",
    toastUnchecked: "Menge konnte gerade nicht geprüft werden.",
    /** Die Pille bleibt „Hinzufügen", auch wenn schon etwas im Korb liegt. */
    addAnotherFor: (name: string, price: string) =>
      `${name} für ${price} noch einmal in den Warenkorb legen`,
    offerHeading: "Angebot",
  },

  cart: {
    title: "Warenkorb",
    open: "Warenkorb öffnen",
    /** Für den schwebenden Zugang: die Zahl gehört in den Namen, nicht daneben. */
    openWith: (n: number) =>
      n === 1 ? "Warenkorb öffnen, 1 Artikel" : `Warenkorb öffnen, ${n} Artikel`,
    /** Fürs Badge: Stück, nicht Positionen. */
    pieces: (n: number) => (n === 1 ? "1 Artikel" : `${n} Artikel`),
    empty: "Der Warenkorb ist leer.",
    emptyHint: "Im Katalog steht bei jedem Angebot ein Preis von SkyIsles.",
    toCatalog: "Zum Katalog",
    quantity: "Menge",
    quantityFor: (name: string) => `Menge für ${name}`,
    /**
     * Stepper statt freiem Zahlenfeld (V11). Das Feld nahm eine getippte 99
     * entgegen, ohne dass irgendjemand den Bestand gefragt hätte.
     */
    increaseFor: (name: string) => `Menge für ${name} erhöhen`,
    decreaseFor: (name: string) => `Menge für ${name} verringern`,
    remove: "Entfernen",
    removeFor: (name: string) => `${name} entfernen`,
    clear: "Warenkorb leeren",
    total: "Summe",
    priceChanged: (old: string) => `Preis geändert, vorher ${old}`,
    soldOut: "Derzeit nicht auf Lager",
    withdrawn: "Nicht mehr im Angebot",
    excluded: (n: number) =>
      n === 1
        ? "1 Position ist derzeit nicht bestellbar und zählt nicht zur Summe."
        : `${n} Positionen sind derzeit nicht bestellbar und zählen nicht zur Summe.`,
    localOnly: "Der Warenkorb wird nur in diesem Browser gespeichert.",
    noCheckout: "Bestellen ist noch nicht möglich.",
    toCheckout: "Zur Kasse",
  },

  /**
   * Kasse (B1).
   *
   * Noch ohne Zahlung: die Bestellung entsteht und der Bestand wird
   * reserviert, bezahlt wird im nächsten Schritt. Die Texte sagen das
   * ausdrücklich, statt eine abgeschlossene Zahlung anzudeuten.
   */
  checkout: {
    title: "Kasse",
    contactHeading: "Kontakt",
    email: "E-Mail",
    emailHint: "An diese Adresse geht die Bestellbestätigung.",

    addressHeading: "Lieferadresse",
    firstName: "Vorname",
    lastName: "Nachname",
    company: "Firma (optional)",
    street: "Straße",
    houseNumber: "Hausnummer",
    addressLine2: "Adresszusatz (optional)",
    postalCode: "PLZ",
    city: "Ort",
    country: "Land",
    countryFixed: "Deutschland",
    countryHint: "SkyIsles liefert derzeit nur innerhalb Deutschlands.",

    shippingHeading: "Versand",
    shippingFree: "Kostenlos",
    freeFrom: (amount: string) => `Ab ${amount} Warenwert versandkostenfrei.`,

    summaryHeading: "Zusammenfassung",
    itemsSubtotal: "Zwischensumme",
    shipping: "Versand",
    total: "Gesamtbetrag",

    /**
     * Der gesetzlich vorgeschriebene Wortlaut (§ 312j Abs. 3 BGB).
     *
     * Bis B2.3 hieß der Button „Bestellung anlegen", und das war richtig: es
     * entstand keine Zahlungspflicht. Mit B2.4 führt dieser Klick zur Kasse
     * des Zahlungsanbieters, also entsteht sie hier — und die Beschriftung
     * muss das eindeutig sagen.
     */
    submit: "Zahlungspflichtig bestellen",
    submitting: "Bestellung wird angelegt …",
    redirecting: "Weiterleitung zur Zahlung …",
    paymentFollows:
      "Im nächsten Schritt wirst du zur gesicherten Zahlungsseite unseres Zahlungsdienstleisters " +
      "weitergeleitet. Die Ware wird währenddessen für dich vorgemerkt.",

    /** Die Bestellung existiert, nur der Start der Zahlung ist gescheitert. */
    payment: {
      retry: "Zahlung erneut starten",
      openOrder: (number: string) => `Offene Bestellung ${number}`,
      resumeHint:
        "Diese Bestellung ist angelegt und die Ware für dich vorgemerkt. Du kannst die Zahlung " +
        "jetzt starten.",
      errorNotPayable:
        "Die Reservierung für diese Bestellung ist abgelaufen. Bitte lege den Artikel erneut in " +
        "den Warenkorb.",
      errorNotYours: "Diese Bestellung gehört zu einer anderen Sitzung.",
      errorUnavailable: "Die Zahlung ist derzeit nicht verfügbar. Bitte versuche es später erneut.",
      errorProvider:
        "Die Zahlung konnte nicht gestartet werden. Deine Bestellung bleibt bestehen — bitte " +
        "versuche es erneut.",
      errorNetwork:
        "Keine Verbindung zur Zahlungsseite. Deine Bestellung bleibt bestehen — bitte versuche " +
        "es erneut.",
    },

    /** Rückkehr von der Zahlungsseite. Kein Wort davon ist ein Zahlungsbeleg. */
    result: {
      title: "Bestellung",
      orderNumber: "Bestellnummer",
      total: "Gesamtbetrag",
      refresh: "Status aktualisieren",
      checking: "Zahlungsstatus wird geprüft …",

      confirmedTitle: "Zahlung bestätigt",
      confirmedHint:
        "Wir haben deine Zahlung erhalten und die Artikel für dich gebucht. Du hörst von uns, " +
        "sobald die Sendung unterwegs ist.",

      awaitingTitle: "Zahlung wird bestätigt",
      awaitingHint:
        "Deine Zahlung ist bei uns noch nicht bestätigt. Das dauert meist nur wenige Sekunden. " +
        "Du kannst diese Seite offen lassen oder den Status aktualisieren.",

      attentionTitle: "Wir prüfen deine Bestellung",
      attentionHint:
        "Deine Zahlung ist eingegangen, aber die Bestellung muss von uns geprüft werden, bevor " +
        "sie versandt wird. Wir melden uns — bitte unternimm nichts weiter.",

      expiredTitle: "Bestellung nicht abgeschlossen",
      expiredHint:
        "Diese Bestellung wurde nicht bezahlt und ist abgelaufen. Es wurde nichts abgebucht. " +
        "Du kannst den Artikel erneut in den Warenkorb legen.",

      refundedTitle: "Bestellung erstattet",
      refundedHint: "Zu dieser Bestellung liegt eine Erstattung vor.",

      unknownTitle: "Bestellung nicht gefunden",
      unknownHint:
        "Zu dieser Bestellung können wir hier nichts anzeigen. Wenn du als Gast bestellt hast, " +
        "funktioniert diese Seite nur in dem Browserfenster, in dem du bestellt hast.",

      toCatalog: "Weiter im Katalog",
    },

    emptyTitle: "Der Warenkorb ist leer.",
    emptyHint: "Leg zuerst etwas in den Warenkorb.",

    /*
     * `successTitle`, `successHint` und `successToCatalog` sind mit B2.4
     * entfallen. Sie beschrieben eine angelegte, unbezahlte Bestellung als
     * Abschluss — das war bis B2.3 die Wahrheit und ist es nicht mehr. Was der
     * Kunde nach der Zahlung sieht, steht unter `result` und kommt aus
     * `order_payment_state()`.
     */
    successNumber: "Bestellnummer",

    /** Fehler, in Kundensprache. Nie eine Datenbankmeldung. */
    errorUnavailable:
      "Mindestens ein Artikel ist nicht mehr in der gewünschten Menge verfügbar. " +
      "Dein Warenkorb ist unverändert — bitte prüfe ihn noch einmal.",
    errorThrottled:
      "Für diese Adresse sind gerade mehrere Bestellungen offen. Bitte schließe sie ab " +
      "oder versuche es in ein paar Minuten noch einmal.",
    errorFailed: "Das hat gerade nicht geklappt. Bitte versuche es noch einmal.",
    errorInvalid: "Bitte prüfe die markierten Angaben.",
    problem: {
      no_items: "Der Warenkorb ist leer.",
      too_many_items: "Der Warenkorb enthält zu viele verschiedene Artikel.",
      invalid_item: "Ein Artikel im Warenkorb ist ungültig.",
      invalid_quantity: "Eine Menge im Warenkorb ist ungültig.",
      duplicate_item: "Ein Artikel ist doppelt im Warenkorb.",
      invalid_email: "Bitte gib eine gültige E-Mail-Adresse ein.",
      incomplete_address: "Bitte fülle alle Pflichtfelder der Lieferadresse aus.",
      invalid_country: "SkyIsles liefert derzeit nur nach Deutschland.",
      invalid_shipping_method: "Bitte wähle eine Versandart.",
    },
  },

  nav: {
    primary: "Hauptnavigation",
    catalog: "Katalog",
    collection: "Sammlung",
    settings: "Profil",
    signOut: "Abmelden",
    signIn: "Anmelden",
    /** Nur für Administratoren sichtbar (ADR-0039). */
    admin: "Admin",
    /** Lagerverwaltung des Betreibers. Nur für Administratoren. */
    inventory: "Lager",
  },

  auth: {
    register: {
      title: "Konto erstellen",
      intro: "Lege ein Konto an, um deine Sammlung zu erfassen.",
      submit: "Konto erstellen",
      haveAccount: "Du hast schon ein Konto?",
      signInLink: "Anmelden",
    },
    login: {
      title: "Anmelden",
      submit: "Anmelden",
      forgot: "Passwort vergessen?",
      noAccount: "Noch kein Konto?",
      registerLink: "Konto erstellen",
    },
    verifyEmail: {
      title: "Prüfe dein Postfach",
      body:
        "Wir haben dir einen Bestätigungslink geschickt. Öffne ihn, um dein Konto zu aktivieren. " +
        "Der Link kann ein paar Minuten brauchen — sieh auch im Spam-Ordner nach.",
      backToLogin: "Zurück zur Anmeldung",
    },
    forgotPassword: {
      title: "Passwort zurücksetzen",
      intro: "Gib deine E-Mail-Adresse ein. Wenn ein Konto dazu existiert, schicken wir dir einen Link.",
      submit: "Link anfordern",
      // Deliberately identical whether or not the address exists.
      sent: "Wenn zu dieser Adresse ein Konto existiert, ist der Link unterwegs.",
      backToLogin: "Zurück zur Anmeldung",
    },
    resetPassword: {
      title: "Neues Passwort setzen",
      submit: "Passwort speichern",
      done: "Dein Passwort wurde geändert.",
    },
    onboarding: {
      title: "Wähle deinen Benutzernamen",
      intro:
        "Der Benutzername ist deine Anzeigeidentität. Du kannst ihn später jederzeit ändern.",
      submit: "Benutzernamen speichern",
      hint: "3 bis 20 Zeichen, Buchstaben, Ziffern und Unterstriche.",
    },
    settings: {
      title: "Einstellungen",
      sessionSection: "Sitzung",
      sessionHint: "Du bleibst auf diesem Gerät angemeldet, bis du dich abmeldest.",
      usernameSection: "Benutzername",
      usernameSaved: "Benutzername geändert.",
      passwordSection: "Passwort",
      passwordSaved: "Passwort geändert.",
      submitUsername: "Benutzernamen ändern",
      submitPassword: "Passwort ändern",
    },
    authError: {
      title: "Der Link funktioniert nicht mehr",
      body:
        "Bestätigungs- und Rücksetzlinks laufen ab und lassen sich nur einmal verwenden. " +
        "Fordere einen neuen an.",
      requestNew: "Neuen Link anfordern",
      backToLogin: "Zurück zur Anmeldung",
    },
    fields: {
      email: "E-Mail-Adresse",
      password: "Passwort",
      newPassword: "Neues Passwort",
      username: "Benutzername",
    },
    errors: {
      // Same message for wrong password, unknown address and unconfirmed
      // account: anything more specific would let someone enumerate accounts.
      invalidCredentials: "E-Mail oder Passwort ist falsch.",
      emailRequired: "Bitte gib eine E-Mail-Adresse ein.",
      emailInvalid: "Diese E-Mail-Adresse sieht nicht gültig aus.",
      passwordRequired: "Bitte gib ein Passwort ein.",
      weakPassword: "Das Passwort ist zu schwach. Verwende mindestens 8 Zeichen.",
      usernameEmpty: "Bitte gib einen Benutzernamen ein.",
      usernameTooShort: "Der Benutzername braucht mindestens 3 Zeichen.",
      usernameTooLong: "Der Benutzername darf höchstens 20 Zeichen haben.",
      usernameInvalid: "Erlaubt sind nur Buchstaben, Ziffern und Unterstriche.",
      usernameReserved: "Dieser Benutzername ist reserviert.",
      usernameTaken: "Dieser Benutzername ist bereits vergeben.",
      usernameUnchanged: "Das ist bereits dein Benutzername.",
      rateLimited: "Zu viele Versuche. Bitte versuche es später noch einmal.",
      // Shown when Supabase answers a sign-up without creating anything — most
      // often because the address already has an account. Worded so that it
      // helps without confirming that the account exists (docs/AUTH.md 9.13).
      signUpNotCompleted:
        "Die Registrierung konnte nicht abgeschlossen werden. Falls du hier schon ein Konto hast, melde dich an oder setze dein Passwort zurück.",
      sessionExpired: "Deine Sitzung ist abgelaufen. Bitte fordere einen neuen Link an.",
      generic: "Das hat nicht geklappt. Bitte versuche es noch einmal.",
    },
  },

  home: {
    status: "Im Aufbau",
    intro:
      "PortalVault entsteht gerade. Der öffentliche Katalog, Benutzerkonten und die persönliche Sammlung folgen Schritt für Schritt.",
    nextUp: "Als Nächstes geplant",
    steps: [
      "Datenbankmodell und Zugriffsregeln einrichten",
      "Katalog mit 600 Skylandern importieren",
      "Katalog, Suche und Figurenseiten",
      "Benutzerkonten und persönliche Sammlung",
    ],
  },
} as const;

export type Texts = typeof de;
