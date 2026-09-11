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

  /**
   * Die Fußzeile (UX-Beta, F1).
   *
   * ES WERDEN NUR ZIELE VERLINKT, DIE ES GIBT. Impressum, Datenschutz,
   * Widerrufsbelehrung und AGB existieren noch nicht; ein Link darauf wäre
   * tot, und eine Seite namens „Impressum" ohne Impressum wäre schlimmer als
   * keine. Die Plätze stehen in `site-footer.tsx` als Liste im Kommentar und
   * werden aktiv, sobald die Texte da sind — das ist ein eigenes Release-Gate
   * (docs/ROADMAP.md, V1.7).
   *
   * Ebenfalls bewusst nicht vorhanden: ein Kontaktpunkt. Es gibt noch keine
   * entschiedene Adresse, und eine erfundene wäre ein Kanal, der ins Leere
   * läuft.
   */
  footer: {
    /** Zugängliche Bezeichnung der Fußzeilen-Navigation. */
    nav: "Fußzeile",
    /** Eine sachliche Zeile darüber, was SkyIsles ist. Kein Werbetext. */
    positioning:
      "Katalog, Marktwerte und kostenlose Sammlungsverwaltung für Skylanders — " +
      "und ein kleiner Shop mit ausgewählten Figuren.",
    catalog: "Katalog",
    shop: "Shop",
    about: "Über SkyIsles",
    copyright: (year: number) => `© ${year} SkyIsles`,
  },

  /**
   * „Über SkyIsles" — der eigene Platz für erklärende Inhalte, den ADR-0025
   * ausdrücklich vorgesehen und den es bis zur UX-Beta-Phase nicht gab.
   *
   * Sachlich und sammlerorientiert. Keine erfundene Unternehmensgeschichte,
   * keine Behauptung über Team, Gründung oder Größe, keine Zahl, die nicht aus
   * der Datenbank kommt — die Figurenzahl wird zur Laufzeit gezählt.
   */
  about: {
    title: "Über SkyIsles",
    lead:
      "SkyIsles ist eine Plattform für Skylanders-Sammler: ein vollständiger Katalog mit " +
      "Marktwerten, eine kostenlose Sammlungsverwaltung dazu — und ein kleiner eigener Shop.",

    catalogHeading: "Der Katalog",
    /**
     * Die Zahl kommt zur Laufzeit aus der Datenbank, kann also auch 1 sein —
     * auf Staging ist sie das. Deshalb die Singularform, wie überall sonst
     * auch (`catalog.figureCount`): eine Zahl aus der Datenbank in einen Satz
     * zu setzen heißt, beide Fälle zu schreiben.
     */
    catalogBody: (figures: number, formatted: string) =>
      (figures === 1
        ? `Die ${formatted} Sammelfigur aus den Skylanders-Spielen, mit Bild, Element, Serie `
        : `Alle ${formatted} Sammelfiguren aus den sechs Skylanders-Spielen, mit Bild, Element, Serie `) +
      "und einem Referenz-Marktwert. Der Katalog ist ohne Konto vollständig nutzbar: Suche, " +
      "Serien, Produktgruppen und jede Figurenseite stehen offen.",

    collectionHeading: "Die Sammlung",
    collectionBody:
      "Mit einem kostenlosen Konto wird aus dem Katalog ein Sammlungstracker: Eine Figur " +
      "antippen heißt „habe ich“. SkyIsles zeigt dann, wie weit jede Serie ist, was noch fehlt " +
      "und was die Sammlung nach den hinterlegten Marktwerten wert ist.",
    collectionFree: "Die Sammlungsverwaltung ist und bleibt kostenlos.",

    shopHeading: "Der Shop",
    shopBody:
      "SkyIsles verkauft ausgewählte Figuren selbst — lose oder originalverpackt, jeweils " +
      "einzeln geprüft. Es ist kein Marktplatz: Es gibt genau einen Verkäufer, und das ist " +
      "SkyIsles. Der Versand erfolgt derzeit innerhalb Deutschlands.",

    togetherHeading: "Warum beides zusammengehört",
    togetherBody:
      "Sammlung und Shop sind dieselbe Plattform, nicht zwei Angebote nebeneinander. Wer im " +
      "Katalog auf „Fehlen“ filtert, sieht sofort, welche der fehlenden Figuren SkyIsles gerade " +
      "liefern kann. Der Tracker funktioniert aber vollständig ohne jeden Kauf — das ist der " +
      "Punkt, nicht das Nebenprodukt.",

    /** Marktwert ≠ Shoppreis. Der Unterschied steht sonst nur auf Karten. */
    pricesHeading: "Marktwert und Shoppreis",
    pricesBody:
      "Auf jeder Figur steht ein Marktwert: eine Referenz dafür, was das Stück ungefähr wert " +
      "ist. Das ist kein Angebot und kein Versicherungswert. Was SkyIsles für ein Exemplar " +
      "verlangt, steht getrennt davon und nur dort, wo tatsächlich etwas verfügbar ist.",

    toCatalog: "Zum Katalog",
    toShop: "Zum Shop",
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
    /**
     * Untertitel im Katalogkopf — für jemanden, der bereits angemeldet ist.
     *
     * Für Ausgeloggte steht stattdessen `valueProp` da: wer das Produkt kennt,
     * braucht keine Erklärung, sondern eine ruhige Arbeitsüberschrift.
     */
    intro: "Entdecke alle Figuren aus den Skylands.",
    /**
     * Was SkyIsles ist, in einem Satz — nur für ausgeloggte Besucher (UX-Beta,
     * F7). `/` bleibt der Katalog (ADR-0025); dies ist die Zeile, die dort
     * bisher fehlte, keine Landingpage.
     *
     * Nennt die drei Dinge, die es gibt, in der Reihenfolge ihrer Wichtigkeit:
     * der Katalog, die kostenlose Sammlung, der eigene Shop.
     */
    valueProp:
      "Alle Skylanders mit Marktwerten, eine kostenlose Sammlungsverwaltung — " +
      "und ausgewählte Figuren direkt von SkyIsles.",
    /** Die eine Aktion, die ein neuer Besucher hier hat. */
    ctaPrimary: "Sammlung starten — kostenlos",
    /** Führt auf die Seite, die ADR-0025 als „eigenen Platz" vorgesehen hat. */
    ctaSecondary: "Was ist SkyIsles?",
    /** Dritter, leiser Weg: das Angebot, ohne den Katalog zu verlassen. */
    ctaShop: "Zum Shop",
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

    /**
     * Unternehmensdaten (ADR-0059).
     *
     * Bewusst getrennt von den Shop-Einstellungen: dort steht, was SkyIsles
     * verlangt, hier steht, wer SkyIsles ist. Dieselbe Quelle bedient später
     * die Rechtstexte und die Rechnung — eine Angabe, die drei Oberflächen
     * zitieren, braucht genau einen Ort.
     */
    business: {
      heading: "Unternehmensdaten",
      hint:
        "Diese Angaben erscheinen in Mails an Kunden und später in den Rechtstexten. " +
        "Die Absenderadresse der Mails gehört zur Serverkonfiguration und ist hier bewusst " +
        "nicht änderbar.",
      contactEmail: "Geschäfts-E-Mail",
      contactEmailHint:
        "Die Adresse, an die Kunden schreiben. Sie steht als Antwortadresse in jeder " +
        "Bestell- und Versandmail.",
      replyTo: "Abweichende Antwortadresse (optional)",
      replyToHint: "Leer lassen, wenn Antworten an die Geschäfts-E-Mail gehen sollen.",
      save: "Speichern",
      saved: "Gespeichert.",
      invalidEmail: "Das sieht nicht nach einer E-Mail-Adresse aus.",
      saveFailed: "Das hat nicht geklappt.",
      /** Ohne sie kann die Prüfwarnung nirgendwohin. */
      missingWarning:
        "Ohne Geschäfts-E-Mail kann SkyIsles dich nicht benachrichtigen, wenn eine Bestellung " +
        "geprüft werden muss.",
    },

    /** Commerce-Modus und Sandbox-Tester (ADR-0060). */
    commerce: {
      heading: "Verkauf",
      hint:
        "Bestimmt, wer bezahlen kann. Bereits aufgegebene Bestellungen behalten den Modus, " +
        "in dem sie entstanden sind — das lässt sich nachträglich nicht ändern.",
      modeLabel: "Modus",
      modeClosed: "Geschlossen",
      modeClosedHint: "Niemand kann zur Kasse gehen.",
      modeSandbox: "Test",
      modeSandboxHint:
        "Nur angemeldete Tester können bestellen, und Stripe läuft im Testmodus. " +
        "Gastbestellungen sind aus.",
      modeLive: "Öffentlich",
      modeLiveHint: "Normaler Verkauf für alle.",
      modeSaved: "Modus geändert.",
      modeFailed: "Das hat nicht geklappt.",

      testersHeading: "Tester",
      testersHint:
        "Nur diese Konten können im Testmodus bestellen. Adminrechte allein genügen nicht — " +
        "wer testen soll, muss hier stehen.",
      testersEmpty: "Noch niemand freigeschaltet.",
      searchLabel: "Konto suchen",
      searchPlaceholder: "Benutzername oder E-Mail",
      searchHint:
        "Die Suche dient nur dazu, das richtige Konto zu finden. Freigeschaltet wird das " +
        "Konto, nicht die Adresse.",
      searchTooShort: "Mindestens drei Zeichen.",
      searchEmpty: "Kein Konto gefunden.",
      enable: "Freischalten",
      disable: "Entfernen",
      isAdmin: "Admin",
      noteLabel: "Notiz (optional)",

      ordersByMode: "Bestellungen nach Modus",
      sandboxBadge: "TEST",
      sandboxOrderHint:
        "Diese Bestellung wurde im Testmodus aufgegeben. Sie bleibt dauerhaft als Test " +
        "gekennzeichnet.",
      revertStock: "Testbestand zurückbuchen",
      revertStockHint:
        "Bucht für jede verkaufte Position eine Rückgabe, damit ein Testkauf den echten " +
        "Bestand nicht verfälscht.",
      revertStockDone: "Zurückgebucht.",
      revertStockAlready: "Bereits zurückgebucht.",
      revertStockFailed: "Das hat nicht geklappt.",
    },

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

    /** Bestellverwaltung (Admin Orders V1). */
    orders: {
      title: "Bestellungen",
      linkHint: "Bezahlte Bestellungen sehen und als versendet markieren.",
      empty: "Keine Bestellungen.",
      openOnly: "Nur offene",
      all: "Alle",

      /**
       * Was auf der Startseite des Adminbereichs und am Navigationspunkt steht
       * (UX-Beta, F5).
       *
       * Bis hierher war `needs_resolution` nur zu sehen, wenn der Betreiber von
       * sich aus `/admin/orders` öffnete — der eine Zustand im System, der Geld
       * schützt, hatte keinen Weg zum Menschen. Gezählt wird aus den Daten, die
       * `admin_orders(p_open_only => true)` ohnehin liefert: keine neue Abfrage,
       * kein Polling, keine Benachrichtigungsinfrastruktur.
       */
      needsResolutionCount: (n: number) =>
        n === 1 ? "1 Bestellung muss geprüft werden" : `${n} Bestellungen müssen geprüft werden`,
      toShipCount: (n: number) =>
        n === 1 ? "1 Bestellung ist zu versenden" : `${n} Bestellungen sind zu versenden`,
      nothingOpen: "Nichts offen.",
      /** Am Navigationspunkt „Admin", nur wenn geprüft werden muss. */
      badgeLabel: (n: number) =>
        n === 1
          ? "1 Bestellung muss geprüft werden"
          : `${n} Bestellungen müssen geprüft werden`,

      /** Spalten der Übersicht. */
      number: "Bestellnummer",
      placedAt: "Datum",
      payment: "Zahlung",
      fulfillment: "Versand",
      total: "Gesamt",
      customer: "Kunde",
      lines: (n: number) => (n === 1 ? "1 Position" : `${n} Positionen`),

      /** Aufmerksamkeitsstufen — die Reihenfolge der Übersicht. */
      attention: {
        needs_resolution: "Prüfen",
        to_ship: "Zu versenden",
        in_flight: "Offen",
        settled: "Erledigt",
      },

      /** Zahlungs- und Versandzustände in Kundensprache. */
      paymentStatus: {
        pending: "Ausstehend",
        paid: "Bezahlt",
        failed: "Fehlgeschlagen",
        expired: "Abgelaufen",
        cancelled: "Storniert",
        refunded: "Erstattet",
        partially_refunded: "Teilweise erstattet",
      },
      fulfillmentStatus: {
        unfulfilled: "Nicht versendet",
        preparing: "In Vorbereitung",
        shipped: "Versendet",
        completed: "Abgeschlossen",
        cancelled: "Storniert",
      },

      /** Detailseite. */
      detailTitle: (number: string) => `Bestellung ${number}`,
      notFound: "Diese Bestellung gibt es nicht.",
      guest: "Gastbestellung",
      account: "Mit Konto",
      addressHeading: "Lieferadresse",
      linesHeading: "Positionen",
      eventsHeading: "Verlauf",
      subtotal: "Zwischensumme",
      shipping: "Versand",
      paidAt: "Bezahlt am",
      shippedAt: "Versendet am",
      unitPrice: "Einzelpreis",
      quantity: "Menge",

      /** Der Hinweis, der Geld schützt. */
      needsResolutionTitle: "Diese Bestellung muss geprüft werden",
      needsResolutionHint:
        "Die Zahlung ist eingegangen, aber es wurde keine Reservierung umgewandelt und kein " +
        "Bestand gebucht. Vor dem Versand muss entschieden werden: nachbestellen oder erstatten. " +
        "Der Versand ist deshalb gesperrt.",

      /** Versandaktion. */
      shipHeading: "Versand",
      shipAction: "Als versendet markieren",
      shipping_: "Wird markiert …",
      trackingLabel: "Trackingnummer (optional)",
      trackingHint:
        "Wird unverändert gespeichert. In V1 nachträglich nicht mehr änderbar.",
      trackingNumber: "Trackingnummer",
      noTracking: "Keine Trackingnummer hinterlegt",
      trackingTooLong: "Diese Trackingnummer ist zu lang.",

      /**
       * Trackingnummer und Versandstatus sind zwei Zustände (ADR-0062):
       * Label zuerst kaufen, später versenden, notfalls Label tauschen.
       */
      trackingHeading: "Sendungsnummer",
      trackingBeforeShippingHint:
        "Du kannst die Nummer schon eintragen, bevor du die Bestellung als versendet " +
        "markierst. Das verschickt nichts und benachrichtigt niemanden.",
      trackingAfterShippingHint:
        "Die Bestellung ist bereits versendet. Eine Korrektur der Nummer ändert weder das " +
        "Versanddatum noch löst sie eine zweite Versandbestätigung aus.",
      trackingCurrent: "Aktuell:",
      trackingEditHint: "Leer lassen und speichern entfernt die Nummer.",
      trackingSave: "Nummer speichern",
      trackingReplace: "Nummer ersetzen",
      trackingSaved: "Gespeichert.",
      trackingRefused: "Diese Nummer konnte nicht gespeichert werden.",
      shipUsesRecordedTracking:
        "Es wird die unten eingetragene Sendungsnummer verwendet. Du kannst sie auch " +
        "nachträglich noch ändern.",
      /**
       * Die Rückfrage vor der einzigen unumkehrbaren Aktion des Systems
       * (UX-Beta, F6).
       *
       * `orders_protect_fulfillment()` verweigert `shipped → unfulfilled` und
       * jede spätere Trackingänderung, und `order_events` ist append-only —
       * ein Klick daneben lässt sich nicht zurücknehmen. Genau das ist am
       * 2026-09-11 mit `SI-2026-001022` passiert (PROJECT_STATUS.md).
       *
       * Die Rückfrage nennt Nummer und Empfänger, weil das die beiden Angaben
       * sind, an denen ein Mensch merkt, dass er die falsche Zeile offen hat.
       * Am Trigger ändert sich nichts.
       */
      confirmTitle: "Wirklich als versendet markieren?",
      confirmFor: (number: string, recipient: string) =>
        `Bestellung ${number} an ${recipient}.`,
      confirmWithTracking: (tracking: string) => `Trackingnummer: ${tracking}`,
      confirmWithoutTracking: "Ohne Trackingnummer.",
      confirmIrreversible:
        "Das lässt sich nicht zurücknehmen — auch die Trackingnummer ist danach nicht mehr " +
        "änderbar.",
      confirmYes: "Ja, als versendet markieren",
      confirmNo: "Abbrechen",
      shipSucceeded: (number: string) => `Bestellung ${number} ist als versendet markiert.`,

      /**
       * Mailzustand je Bestellung (Transactional Mail V1).
       *
       * Vier Zustände, und der vierte ist der wichtige: „unklar" heißt, dass
       * niemand sagen kann, ob die Mail draußen ist — ein 409 auf dem
       * Idempotenzschlüssel oder ein abgebrochener Request. Ein blindes
       * Nachsenden würde dem Kunden dieselbe Mail ein zweites Mal schicken.
       */
      mail: {
        heading: "Mails",
        empty: "Für diese Bestellung wurde noch keine Mail angestoßen.",
        kind: {
          payment_confirmation: "Zahlungsbestätigung",
          shipping_confirmation: "Versandbestätigung",
          resolution_alert: "Prüfhinweis an dich",
        } as Record<string, string>,
        state: {
          sending: "wird gesendet",
          sent: "gesendet",
          failed: "fehlgeschlagen",
          unresolved: "unklar",
        } as Record<string, string>,
        sentAt: (when: string) => `gesendet am ${when}`,
        attempts: (n: number) => (n === 1 ? "1 Versuch" : `${n} Versuche`),
        /** Nur der Fehlername des Anbieters, nie ein ganzes Fehlerobjekt. */
        lastError: (name: string) => `Letzter Fehler: ${name}`,

        retry: "Erneut senden",
        retrying: "Wird gesendet …",
        /** Für „gesendet" gibt es bewusst keinen Knopf. */
        sentIsFinal:
          "Bereits gesendet. Eine zweite Mail wäre eine zweite Mail im Postfach des Kunden.",

        /** Die Rückfrage vor dem einzigen Fall, der doppelt zustellen könnte. */
        confirmUnresolvedTitle: "Nicht sicher, ob diese Mail draußen ist",
        confirmUnresolvedBody:
          "Der Versanddienst hat auf diesen Versuch keine eindeutige Antwort gegeben. Möglich " +
          "ist beides: die Mail ist angekommen, oder sie ist nie losgegangen. Wenn du jetzt " +
          "erneut sendest, kann der Kunde sie zweimal bekommen.",
        confirmUnresolvedYes: "Trotzdem erneut senden",
        confirmUnresolvedNo: "Abbrechen",

        sendFailed: "Die Mail konnte nicht angestoßen werden.",
        outcome: {
          sent: "Mail gesendet.",
          already_sent: "Diese Mail wurde bereits gesendet.",
          in_flight: "Diese Mail wird gerade gesendet.",
          unresolved: "Unklar, ob die Mail draußen ist — bitte prüfen.",
          unknown_order: "Diese Bestellung gibt es nicht.",
          no_recipient: "Es ist keine Geschäftsadresse hinterlegt.",
          failed: "Der Versanddienst hat die Mail abgelehnt.",
          unknown: "Unbekanntes Ergebnis.",
        } as Record<string, string>,
      },

      shipRefused:
        "Diese Bestellung kann nicht als versendet markiert werden. Bitte prüfe Zahlung und " +
        "Status oben.",
      shipFailed: "Das hat gerade nicht geklappt. Bitte versuche es erneut.",
      shippedAlready: "Bereits versendet.",
      blocker: {
        not_paid: "Nicht bezahlt — Versand gesperrt.",
        needs_resolution: "Prüfung erforderlich — Versand gesperrt.",
        already_shipped: "Bereits versendet.",
      },
    },
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

    /**
     * Die Shop-Oberfläche (UX-Beta, F8).
     *
     * Sie beantwortet die eine Frage, die der Katalog nicht beantworten kann:
     * *was verkauft SkyIsles gerade?* Kein zweiter Datenbestand — dieselbe
     * `shop_offers()`-Projektion, dieselben Karten, dieselben Aktionen.
     *
     * Es steht nirgends eine Stückzahl. „Verfügbar" ist ein Ja/Nein, und der
     * Bestand bleibt in der Datenbank (docs/SECURITY.md, Migration 0006).
     */
    page: {
      title: "Shop",
      heading: "Im Shop von SkyIsles",
      /** Sagt, wer verkauft. Keine Lieferzeit — es ist keine entschieden. */
      intro:
        "Diese Figuren verkauft SkyIsles gerade selbst — kein Marktplatz, ein Verkäufer. " +
        "Versand innerhalb Deutschlands, ab 75 € Warenwert versandkostenfrei.",
      count: (n: number) => (n === 1 ? "1 Figur im Angebot" : `${n} Figuren im Angebot`),
      searchLabel: "Im Angebot suchen",
      /** Kein Treffer, obwohl es Angebote gibt. */
      noHits: "Keine Figur im Angebot passt dazu.",
      noHitsHint: "Versuche einen anderen Namen oder setze die Suche zurück.",
      resetSearch: "Suche zurücksetzen",
      /** Gar nichts gelistet oder alles ausverkauft — für Besucher dasselbe. */
      empty: "Derzeit ist nichts im Angebot.",
      emptyHint:
        "Der Bestand wechselt. Der Katalog steht unabhängig davon vollständig offen.",
      toCatalog: "Zum ganzen Katalog",
    },
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
  /** Der Kontobereich (ADR-0061). Mobile-first, eine Ebene, klare Namen. */
  account: {
    title: "Mein Konto",
    overviewHint: "Alles, was zu deinem Konto gehört.",

    profile: {
      title: "Profil",
      hint: "Dein Benutzername im Katalog.",
    },
    contact: {
      title: "Kontakt & Lieferadresse",
      hint: "Wird an der Kasse vorausgefüllt. Du kannst sie dort für eine Bestellung ändern.",
      intro:
        "Diese Angaben gelten als Standard für künftige Bestellungen. Bereits aufgegebene " +
        "Bestellungen behalten die Adresse, die zum Bestellzeitpunkt galt — eine Änderung hier " +
        "ändert sie nicht.",
      save: "Speichern",
      saved: "Gespeichert.",
      remove: "Gespeicherte Daten löschen",
      removed: "Gelöscht.",
      empty: "Noch nichts gespeichert.",
      saveFailed: "Das hat nicht geklappt.",
      signInFirst: "Bitte melde dich an.",
    },
    orders: {
      title: "Meine Bestellungen",
      hint: "Alle Bestellungen dieses Kontos.",
      empty: "Du hast noch nichts bestellt.",
      emptyHint: "Sobald du bestellst, findest du hier den Stand.",
      placedAt: "Bestellt am",
      total: "Summe",
      articles: (n: number) => (n === 1 ? "1 Artikel" : `${n} Artikel`),
      testBadge: "TEST",
      /** Gastbestellungen hängen nicht am Konto, sondern an der Mail. */
      guestNote:
        "Bestellungen, die du ohne Anmeldung aufgegeben hast, erscheinen hier nicht. Den Stand " +
        "findest du über den Link in der Bestellmail.",
      shippingAddress: "Lieferadresse",
      shippingMethod: "Versand",
      tracking: "Sendungsnummer",
      snapshotNote:
        "Diese Adresse ist der Stand zum Bestellzeitpunkt und ändert sich nicht mehr.",
      notFound: "Diese Bestellung gehört nicht zu deinem Konto.",
      /** Beide Zustandsachsen als ein Wort — der Kunde will wissen, wo sein Paket ist. */
      statusLabel: {
        awaiting_payment: "Zahlung offen",
        paid: "Bezahlt",
        shipped: "Verschickt",
        needs_attention: "Wird geprüft",
        closed: "Abgeschlossen",
      } as Record<string, string>,
    },
    security: {
      title: "Konto & Sicherheit",
      hint: "Passwort ändern und abmelden.",
    },
  },

  checkout: {
    title: "Kasse",

    /**
     * Wenn gerade niemand (oder fast niemand) bestellen kann.
     *
     * Bewusst ohne das Wort „Sandbox": Wer nicht freigeschaltet ist, erfährt,
     * dass er nicht bestellen kann — nicht, dass gerade getestet wird.
     */
    closedHeading: "Bestellen ist derzeit nicht möglich",
    closedBody:
      "Der Verkauf ist im Moment geschlossen. Der Warenkorb bleibt erhalten.",
    testersOnlyHeading: "Bestellen ist derzeit eingeschränkt",
    testersOnlyBody:
      "Der Verkauf ist gerade nur für einen kleinen Kreis freigeschaltet. " +
      "Der Warenkorb bleibt erhalten.",
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

    /** Nur für angemeldete Konten; ein Gast hat keinen Ort dafür (ADR-0061). */
    saveDefault: "Diese Angaben für künftige Bestellungen speichern",
    saveDefaultHint:
      "Sie werden dann an der Kasse vorausgefüllt. Du kannst sie jederzeit unter " +
      "\u201EKontakt & Lieferadresse\u201C ändern oder löschen. Diese Bestellung behält die " +
      "Adresse, die du hier eingegeben hast.",

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
      "Im nächsten Schritt wirst du zur gesicherten Zahlungsseite von Stripe weitergeleitet. " +
      "Die Ware wird währenddessen für dich vorgemerkt.",

    /**
     * Der Vertrauensblock direkt über dem zahlungspflichtigen Knopf
     * (UX-Beta, F2).
     *
     * Jeder Satz hier ist nachprüfbar. Ausdrücklich NICHT enthalten:
     *
     *   Lieferzeit    es ist keine entschieden, und eine erfundene Zusage wäre
     *                 die erste Sache, an der ein Kunde SkyIsles misst.
     *   Kontakt       es gibt noch keine entschiedene Adresse (siehe `footer`).
     *   Rechtstexte   eigenes Release-Gate; hier steht nur, dass sie folgen.
     */
    trust: {
      heading: "Bevor du bestellst",
      /** Wer verkauft. Die Frage, die das Produkt bisher nirgends beantwortet. */
      seller:
        "Verkäufer ist SkyIsles. Alle Artikel kommen direkt von uns — SkyIsles ist kein " +
        "Marktplatz und vermittelt nicht zwischen Händlern.",
      sellerLabel: "Verkäufer",
      shippingLabel: "Versand",
      /** Nur was feststeht: Land, gewählte Art, Betrag. Keine Dauer. */
      shippingValue: (method: string, amount: string) => `${method} · ${amount} · Deutschland`,
      /*
       * Deliberately not "sobald die Zahlung bestätigt ist": everything a
       * customer reads before the status page has to stay free of the phrase
       * that only `order_payment_state()` may produce, even in a conditional.
       * `checkout.test.ts` enforces that as a blunt substring rule, and blunt
       * is the right shape for it.
       */
      shippingNote: "Verschickt wird, sobald der Zahlungseingang feststeht.",
      paymentLabel: "Zahlung",
      paymentValue: "Stripe",
      paymentNote:
        "Mit dem Bestellen wirst du zu Stripe weitergeleitet und bezahlst dort. SkyIsles " +
        "bekommt und speichert keine Kartendaten.",
      /*
       * KEIN WIDERRUFS-/AGB-EINTRAG.
       *
       * Eine frühere Fassung stand hier und sagte, die Texte „werden vor der
       * öffentlichen Beta ergänzt". Das ist eine Entwicklernotiz, die in der
       * Kasse eines echten Kunden gelandet wäre — und ein Shop, der seinen
       * eigenen Bauzustand kommentiert, wirkt unfertiger als einer, der
       * schweigt. Sobald Widerrufsbelehrung und AGB existieren, kommen sie als
       * Link hierher; bis dahin steht an dieser Stelle nichts.
       */
    },

    /**
     * Feldbezogene Fehler (UX-Beta, F4).
     *
     * `errorInvalid` verspricht seit jeher „die markierten Angaben" — bis
     * jetzt wurde nichts markiert. Diese Texte stehen am jeweiligen Feld; die
     * Zuordnung macht `src/lib/commerce/field-errors.ts`, und zwar als
     * Spiegel von `validateDraft()`, nicht als zweite Regel.
     */
    fieldError: {
      required: "Bitte ausfüllen.",
      email: "Bitte gib eine gültige E-Mail-Adresse ein.",
    },

    /** Die Bestellung existiert, nur der Start der Zahlung ist gescheitert. */
    payment: {
      /**
       * Drei Fälle, und sie werden aus dem tatsächlichen Zahlungszustand
       * abgeleitet, nicht daraus, dass eine Bestellung existiert (ADR-0061).
       */
      start: "Zahlung starten",
      retry: "Zahlung erneut starten",
      openOrder: (number: string) => `Offene Bestellung ${number}`,
      resumeHint:
        "Diese Bestellung ist angelegt und die Ware für dich vorgemerkt. Du kannst die Zahlung " +
        "jetzt starten.",
      retryHint:
        "Die Zahlung wurde noch nicht abgeschlossen. Deine Bestellung besteht weiter und die " +
        "Ware bleibt für dich vorgemerkt.",
      settledHint:
        "Für diese Bestellung ist nichts mehr zu tun. Den aktuellen Stand findest du unter " +
        "\u201EMeine Bestellungen\u201C.",
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
    /**
     * Warum jemand gerade hier steht (UX-Beta, F11).
     *
     * Abgeleitet aus dem vorhandenen `next`-Parameter — es gibt keinen neuen
     * Mechanismus und keinen neuen Redirect. Der Satz erklärt nur, was der
     * Besucher eine Sekunde vorher tun wollte.
     *
     * `collect` ist der teuerste Einstieg im Produkt: jemand hat auf eine
     * Figur getippt und landet auf einem Formular. Nur dort wird „Konto
     * erstellen" zusätzlich als eigene Aktion angeboten.
     */
    context: {
      collect:
        "Du wolltest eine Figur in deine Sammlung legen. Dafür braucht SkyIsles ein Konto — " +
        "es ist kostenlos.",
      collection: "Deine Sammlung gehört zu deinem Konto. Melde dich an, um sie zu öffnen.",
      account: "Melde dich an, um dein Konto zu verwalten.",
      cart: "Dein Warenkorb bleibt erhalten. Ein Konto brauchst du dafür nicht.",
      checkout:
        "Zum Bestellen brauchst du kein Konto. Mit einem Konto findest du deine Bestellungen " +
        "später wieder.",
    },
    register: {
      title: "Konto erstellen",
      intro: "Lege ein Konto an, um deine Sammlung zu erfassen.",
      /** Ersetzt `intro`, wenn jemand gerade eine Figur sammeln wollte. */
      introCollect:
        "Mit einem kostenlosen Konto merkt sich SkyIsles, welche Figuren du besitzt — und " +
        "zeigt dir, was in jeder Serie noch fehlt.",
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
      /**
       * Dieselbe Zielseite, stärker angeboten: wer gerade eine Figur sammeln
       * wollte, hat mit hoher Wahrscheinlichkeit noch kein Konto (F11).
       */
      registerAction: "Kostenloses Konto erstellen",
      orSignIn: "Du hast schon ein Konto? Melde dich hier an.",
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

} as const;

export type Texts = typeof de;
