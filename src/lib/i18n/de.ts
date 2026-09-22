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

    /* Die Rechtsspalte (ADR-0086). „Vertrag widerrufen" steht bewusst
       zwischen den Rechtstexten und nicht darunter: § 356a BGB verlangt, dass
       die Funktion gut sichtbar und leicht zugänglich ist. */
    impressum: "Impressum",
    privacy: "Datenschutz",
    terms: "AGB",
    withdrawal: "Widerrufsbelehrung",
    withdrawNow: "Vertrag widerrufen",
    shipping: "Versand",
    payment: "Zahlung",
    contact: "Kontakt",

    copyright: (year: number) => `© ${year} SkyIsles`,
    /* Wer verkauft, am Fuß jeder Seite. Eine Zeile, die sonst nirgends steht:
       Plattform und Verkäufer sind dieselbe Person, und der Kunde soll das
       sehen können, ohne das Impressum zu öffnen. */
    seller: (name: string) => `Verkauf über diesen Shop: ${name}`,
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
    /* SkyIsles ist die Sammlerplattform, nicht der Verkäufer (ADR-0075). */
    shopBody: (name: string) =>
      `Der integrierte Shop wird derzeit ausschließlich von ${name} betrieben — ausgewählte ` +
      "Figuren, lose oder originalverpackt, jeweils einzeln geprüft. Es ist kein Marktplatz: " +
      "Es gibt genau einen Verkäufer. Der Versand erfolgt derzeit innerhalb Deutschlands.",
    shopBodyFallback:
      "Der integrierte Shop wird derzeit von genau einem gewerblichen Verkäufer betrieben — " +
      "ausgewählte Figuren, lose oder originalverpackt, jeweils einzeln geprüft. Es ist kein " +
      "Marktplatz. Der Versand erfolgt derzeit innerhalb Deutschlands.",

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
    /**
     * Die Verfügbarkeit (V3.3) — eine EIGENE Dimension neben dem Besitz.
     *
     * Keine dritte Option neben „Alle | Besitz | Fehlen": Besitzen und
     * kaufen können sind unabhängig, und „Fehlend UND kaufbar" ist genau die
     * Kombination, die ein zusammengelegtes Control unmöglich machen würde.
     *
     * „Mit Angebot" heißt dasselbe wie die Handelszeile der Karte: es gibt
     * mindestens ein tatsächlich kaufbares Angebot, nicht bloß eine
     * gelistete Position.
     */
    availabilityNav: "Verfügbarkeit filtern",
    availabilityAll: "Alle",
    availabilityOffered: "Mit Angebot",
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
    /** Überschrift der Gruppe im Filterpanel (V3.3) — „Filter" steht schon
        über dem Panel, hier gehört hin, WORAUF gefiltert wird. */
    filterGroupShowcase: "Sammlung",
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
  /**
   * Der Bereich des Verkäufers (ADR-0077).
   *
   * Eigener Block neben `admin`, weil es eine andere Zuständigkeit ist und
   * nicht nur eine andere Seite: Shop führen und Plattform führen sind zwei
   * Befugnisse, auch solange dieselbe Person beide hat.
   */
  /**
   * Die Rechnung (ADR-0086).
   *
   * KEINE UMSATZSTEUERZEILE. Nach § 19 UStG sind die Umsätze steuerfrei; eine
   * Zeile „USt 0,00 €" behauptete eine Besteuerung mit null und wäre falsch.
   * Der Hinweis auf die Steuerbefreiung steht dort, wo § 34a UStDV ihn
   * verlangt: bei der Summe.
   */
  invoice: {
    title: "Rechnung",
    download: "Als PDF herunterladen",
    issuedAt: "Rechnungsdatum",
    orderNumber: "Bestellnummer",
    placedAt: "Bestelldatum",
    seller: "Rechnungssteller",
    customer: "Rechnungsempfänger",
    tableCaption: "Positionen der Rechnung",
    description: "Bezeichnung",
    quantity: "Menge",
    unitPrice: "Einzelpreis",
    amount: "Betrag",
    itemsSubtotal: "Zwischensumme Ware",
    shipping: "Versand",
    discount: "Rabatt",
    total: "Gesamtbetrag",
    sealed: "originalverpackt",
    loose: "lose",
    paid: "Der Rechnungsbetrag ist bezahlt. Diese Rechnung dient als Beleg.",
    /* Auf der Bestelldetailseite. */
    openLink: "Rechnung ansehen",
    pending: "Die Rechnung wird erstellt, sobald die Zahlung bestätigt ist.",
  },

  /**
   * Rechts- und Serviceseiten (ADR-0086).
   *
   * Die Rechtstexte selbst stehen nicht hier, sondern in `src/lib/legal/` —
   * sie sind versioniert und werden je Bestellung festgehalten. Hier steht
   * nur, was die Oberfläche drumherum sagt.
   */
  legal: {
    nav: "Rechtliches",

    /**
     * § 312j Abs. 1 BGB — spätestens **bei Beginn des Bestellvorgangs** klar
     * und deutlich angeben, ob Lieferbeschränkungen bestehen und welche
     * Zahlungsmittel akzeptiert werden (ADR-0086).
     *
     * Der Warenkorb ist diese Stelle: von hier geht es zur Kasse. Die
     * Zahlungsarten werden nicht aufgezählt, weil die tatsächlich verfügbaren
     * vom Zahlungsdienstleister entschieden werden — eine Aufzählung hier
     * könnte etwas versprechen, was gerade nicht geht.
     */
    orderStart: {
      delivery: "Lieferung nur innerhalb Deutschlands.",
      payment: "Bezahlt wird über Stripe; die verfügbaren Zahlungsarten siehst du dort.",
      more: "Versand und Zahlung",
    },
    shipping: {
      ratesHeading: "Versandkosten",
      ratesHint:
        "Aktuell eingestellte Preise. Was deine Bestellung kostet, steht an der Kasse — " +
        "berechnet wird dort dieselbe Regel wie hier.",
      method: "Versandart",
      priceBelow: "Unter der Grenze",
      priceAbove: "Ab der Grenze",
      free: "Kostenlos",
      threshold: (amount: string) => `Ab ${amount} Warenwert ist der Versand kostenlos.`,
    },
    form: {
      heading: "Muster-Widerrufsformular",
      hint:
        "Dieses Formular ist gesetzlich vorgegeben. Du musst es nicht verwenden — eine " +
        "eindeutige Erklärung in eigenen Worten genügt ebenso.",
      recipient: "An",
      copy: "Formulartext kopieren",
      copied: "Kopiert",
    },
  },

  /**
   * Die elektronische Widerrufsfunktion nach § 356a BGB (ADR-0086).
   *
   * DIE BESCHRIFTUNGEN SIND GESETZLICH VORGEGEBEN. „Vertrag widerrufen" und
   * „Widerruf bestätigen" stehen wörtlich im Gesetz. Sie werden nicht
   * umformuliert, nicht verkürzt und nicht durch etwas Freundlicheres ersetzt.
   *
   * DIE ANTWORT IST IMMER DIESELBE. Ob Bestellnummer und E-Mail zu einer
   * Bestellung passen oder nicht, steht auf der Bestätigungsseite dasselbe.
   * Alles andere machte die gesetzliche Funktion zum Auskunftsdienst darüber,
   * welche Bestellungen und welche Adressen es gibt.
   */
  withdrawal: {
    title: "Vertrag widerrufen",
    entryTitle: "Vertrag online widerrufen",
    entryHint:
      "In zwei Schritten, ohne Konto. Du bekommst sofort eine Eingangsbestätigung per E-Mail.",
    lead:
      "Hier kannst du deinen Kaufvertrag widerrufen. Du brauchst dafür kein Konto — nur deine " +
      "Bestellnummer und die E-Mail-Adresse, mit der du bestellt hast.",

    /* Schritt 1 */
    step1: "Schritt 1 von 2: Angaben",
    orderNumber: "Bestellnummer",
    orderNumberHint: "Steht in jeder E-Mail zu deiner Bestellung, zum Beispiel SI-2026-001234.",
    name: "Dein Name",
    nameHint: "So, wie du bestellt hast.",
    email: "E-Mail-Adresse",
    emailHint: "Die Adresse, mit der du bestellt hast. Dorthin geht die Eingangsbestätigung.",
    declaration: "Deine Erklärung (optional)",
    declarationHint:
      "Wenn du nichts schreibst, verwenden wir: „Hiermit widerrufe ich den Vertrag über den " +
      "Kauf der folgenden Waren: Bestellung <Nummer>.“",
    continue: "Vertrag widerrufen",

    /* Schritt 2 */
    step2: "Schritt 2 von 2: Bestätigen",
    reviewHint:
      "Bitte prüfe deine Angaben. Mit dem nächsten Klick geht dein Widerruf bei uns ein.",
    back: "Zurück zu den Angaben",
    confirm: "Widerruf bestätigen",
    sending: "Wird übermittelt …",

    /* Danach */
    doneTitle: "Danke — das war's",
    doneBody:
      "Wenn Bestellnummer und E-Mail-Adresse zu einer Bestellung passen, ist dein Widerruf bei " +
      "uns eingegangen und wir haben dir eine Eingangsbestätigung an die angegebene Adresse " +
      "geschickt. Sie enthält den Inhalt deiner Erklärung sowie Datum und Uhrzeit des Eingangs.",
    doneHint:
      "Kommt innerhalb weniger Minuten nichts an, prüfe bitte die Schreibweise der Adresse und " +
      "der Bestellnummer — oder schreib uns einfach direkt.",
    doneNext: "Was als Nächstes passiert",
    doneSteps: [
      "Wir melden uns bei dir und stimmen die Rücksendung ab.",
      "Du sendest die Ware innerhalb von 14 Tagen zurück. Die unmittelbaren Kosten der " +
        "Rücksendung trägst du.",
      "Wir erstatten dir alle erhaltenen Zahlungen einschließlich der Lieferkosten. Bis die " +
        "Ware zurück ist oder du die Absendung nachgewiesen hast, dürfen wir damit warten.",
    ],

    /* Fehler am Feld */
    errors: {
      orderNumber: "Bitte gib deine Bestellnummer ein.",
      name: "Bitte gib deinen Namen ein.",
      email: "Bitte gib eine gültige E-Mail-Adresse ein.",
      failed: "Das hat gerade nicht geklappt. Bitte versuch es noch einmal.",
    },

    /* Auf der Bestelldetailseite */
    orderEntry: "Diesen Vertrag widerrufen",
    orderDeclared: (date: string) => `Widerruf eingegangen am ${date}.`,
    orderRefunded: (amount: string) => `Erstattet: ${amount}.`,
  },

  business: {
    title: "Shop",
    /** Klein und sekundär, wie das Admin-Pendant (ADR-0077). */
    modeBadge: "Business",
    /**
     * Die Bereiche des Shops (ADR-0080).
     *
     * Aufgebaut wie „Mein Konto": Karten mit Titel, einem Satz und einem Ziel.
     * Die Übersicht führt hin, geändert wird im jeweiligen Bereich — sonst
     * wäre die Startseite ein Formular mit vierzig Feldern.
     */
    areas: {
      profile: {
        title: "Händlerprofil",
        hint: "Der Name, unter dem Kunden dich im Katalog sehen.",
      },
      offers: {
        title: "Angebote & Preise",
        hint: "Verkaufsmodus und automatische Preisbildung.",
      },
      inventory: {
        title: "Lagerbestand",
        hint: "Menge, Preis und Freigabe je Figur — und das Bestandsjournal.",
      },
      orders: {
        title: "Bestellungen",
        hint: "Bestellungen deiner Kundschaft: prüfen, versenden, Sendungsnummer.",
      },
      shipping: {
        title: "Versand",
        hint: "Lieferländer, Versandarten, Preise und die Versandkostengrenze.",
      },
      legal: {
        title: "Geschäftsdaten & Kontakt",
        hint: "Rechtliche Angaben, Kontaktadressen, Steuer, Widerruf.",
      },
      reports: {
        title: "Berichte",
        hint: "Monatliche Abrechnungsberichte ansehen und erstellen.",
      },
      withdrawals: {
        title: "Widerrufe",
        hint: "Eingegangene Widerrufe und die zugehörigen Erstattungen.",
      },
      orderbook: {
        title: "Orderbuch",
        hint: "Einkäufe, Paketprüfung und Einbuchen in den Bestand.",
      },
      imports: {
        title: "Bestand abgleichen",
        hint: "Lagerbestand aus deiner Excel-Tabelle übernehmen.",
      },
    },
    hint:
      "Bestellungen, Bestand, Preise und die Angaben des Verkäufers. Der Katalog gehört " +
      "SkyIsles und wird im Plattformbereich gepflegt.",
    inventory: "Lagerbestand",
    inventoryHint: "Menge, Preis und Freigabe je Figur.",

    /**
     * Zwei Zahlen zum Jahr (ADR-0081, korrigiert in ADR-0083).
     *
     * BESTELLTÄTIGKEIT, NICHT GELDEINGANG. Gezählt wird, was in diesem Jahr
     * bestellt wurde — wann bezahlt wird, entscheidet nichts. Deshalb
     * „Bestellwert" und nicht „Umsatz", „Einnahmen" oder „bezahlt": eine am
     * 30. Dezember aufgegebene und am 2. Januar bezahlte Bestellung würde
     * jedes dieser Wörter falsch machen.
     *
     * Dieselbe Definition wie in den Monatsberichten, damit zwölf Berichte und
     * diese Zahl dasselbe meinen.
     */
    ytdOrders: "Bestellungen dieses Jahr",
    ytdOrderValue: "Bestellwert dieses Jahr",
    ytdHint:
      "Bestellungen seit dem 1. Januar, nach Bestelldatum, nur im Echtbetrieb. Abgebrochene " +
      "Checkouts zählen nicht. Der Bestellwert ist kein Zahlungseingang: eine Bestellung zählt " +
      "zu dem Jahr, in dem sie aufgegeben wurde, auch wenn das Geld später eintrifft.",

    /* Überschriften der Unterseiten. Der Panel-Titel kommt von der Seite, die
       ihn zeigt — dieselbe Gruppe darf nicht an zwei Stellen stehen. */
    profileHeading: "Händlerprofil",
    profileHint:
      "Was Kunden von dir sehen, wenn ein Angebot dir gehört. Rechtliche Angaben stehen unter " +
      "„Geschäftsdaten & Kontakt“.",
    profileNameSource:
      "Der Händlername kommt aus den Verkäuferangaben, nicht aus deinem Benutzernamen.",
    profileIconMissing:
      "Ein Händler-Icon gibt es noch nicht. Es kommt, sobald SkyIsles Bilder für Händler " +
      "speichern kann.",
    offersHeading: "Angebote & Preise",
    offersHint:
      "Ob der Shop offen ist und wie Preise automatisch gebildet werden. Welche Figur zu " +
      "welchem Preis angeboten wird, entscheidest du je Figur im Lagerbestand.",
    offersToInventory: "Zum Lagerbestand",
    shippingHeading: "Versand",
    shippingPageHint:
      "Wohin geliefert wird, womit und ab welchem Warenwert versandkostenfrei. Gilt für alle " +
      "Bestellungen in diesem Shop.",
    legalHeading: "Geschäftsdaten & Kontakt",
    legalPageHint:
      "Die Angaben, die später im Impressum, auf Rechnungen und in der Widerrufsbelehrung " +
      "stehen. Noch wird nichts davon veröffentlicht.",
    /**
     * Widerrufe (ADR-0086).
     *
     * WIDERRUF UND ERSTATTUNG SIND ZWEI EREIGNISSE. Der Widerruf ist die
     * Erklärung des Kunden mit ihrem gesetzlichen Eingangszeitpunkt; die
     * Erstattung ist eine spätere, eigene Buchung. Die Oberfläche hält sie
     * getrennt, weil sie es sind.
     *
     * Das Geld bewegt dieser Bereich nicht: erstattet wird bei Stripe, hier
     * wird es festgehalten.
     */
    withdrawals: {
      heading: "Widerrufe",
      pageHint:
        "Widerrufe, die Kundschaft über die Online-Funktion erklärt hat. Der Eingangszeitpunkt " +
        "ist gesetzlich maßgeblich und wird nicht verändert.",
      empty: "Keine Widerrufe.",
      openOnly: "Nur offene",
      all: "Alle",
      receivedAt: "Eingegangen",
      declaredBy: "Erklärt von",
      declaration: "Erklärung",
      receipt: "Eingangsbestätigung",
      receiptState: {
        pending: "wird versendet",
        sent: "zugestellt",
        failed: "nicht zugestellt",
      },
      handled: "Erledigt",
      open: "Offen",
      refundedSoFar: (amount: string) => `Bereits erstattet: ${amount}`,

      refundHeading: "Erstattung festhalten",
      refundHint:
        "Erstattet wird bei Stripe. Hier wird der Betrag festgehalten, damit Bestellung, " +
        "Berichte und Kundenansicht übereinstimmen.",
      amount: "Betrag",
      reason: "Grund (optional)",
      providerId: "Stripe-Erstattungs-ID (optional)",
      record: "Erstattung festhalten",
      recording: "Wird gespeichert …",
      amountInvalid: "Bitte gib einen Betrag größer als 0 ein.",
      refundRefused: "Das geht nicht: mehr als bezahlt wurde, oder die Bestellung ist unbezahlt.",
      refundFailed: "Das hat nicht geklappt.",
    },

    /**
     * Bestandsabgleich aus der Tabelle (ADR-0087).
     *
     * ES IST EIN ABGLEICH, KEIN ZUBUCHEN. Die Spalte „Storage" ist ein
     * Zielwert: steht dort 0 und im Shop liegen 3, ist die richtige Antwort
     * −3. Deshalb spricht die Oberfläche von Abgleich und nennt Erhöhungen
     * und Verringerungen getrennt — eine Verringerung ist die Richtung, bei
     * der man vorher hinsehen will.
     *
     * Die Datei wird nicht hochgeladen. Der Browser liest rund 0,75 MB aus
     * der 450-MB-Datei und schickt nur die Zeilen.
     */
    imports: {
      title: "Bestand abgleichen",
      hint:
        "Lade deine skylanders.xlsx. SkyIsles liest daraus nur die sechs Spiel-Tabellenblätter " +
        "und die Spalte „Storage“ — die Bilder bleiben auf deinem Gerät.",
      choose: "Datei auswählen",
      reading: "Datei wird gelesen …",
      analysing: "Zeilen werden zugeordnet …",
      readBytes: (mb: string, total: string) =>
        `${mb} MB von ${total} MB gelesen — der Rest sind Bilder und wird nicht gebraucht.`,
      savedAt: (date: string) => `Tabelle zuletzt gespeichert am ${date}`,

      /* Die Zusammenfassung. */
      summary: "Ergebnis",
      rowsSeen: (n: number) => `${n} Zeilen gelesen`,
      supported: "eindeutig erkannt",
      increases: "Erhöhungen",
      decreases: "Verringerungen",
      unchanged: "unverändert",
      newPositions: "neue Positionen",
      conflicts: "zu prüfen",
      ignored: "nicht zuständig",
      unmatched: "nicht gefunden",

      /* Die Tabelle. */
      sheet: "Blatt",
      row: "Zeile",
      name: "Tabelle",
      figure: "SkyIsles",
      current: "Bestand",
      desired: "Tabelle",
      change: "Änderung",
      after: "Danach",
      status: "Status",

      statusLabel: {
        pending: "bereit",
        conflict: "prüfen",
        unchanged: "unverändert",
        skipped: "übersprungen",
        applied: "übernommen",
        failed: "fehlgeschlagen",
      },

      /* Warum eine Zeile nicht dazugehört — einmal pro Art, nicht pro Zeile. */
      ignoredWhy: {
        IGNORED_GAME:
          "Spiele und Software: gehören nicht zu diesem Figurenabgleich. Ihr Bestand bleibt " +
          "unverändert.",
        IGNORED_SWAP_FORCE_HALF:
          "Swap-Force-Hälften: werden nur lokal geführt. Erst eine vollständige Figur zählt hier.",
        IGNORED_DAMAGED: "Als beschädigt geführte Altlasten.",
        IGNORED_OVP: "Ausdrücklich originalverpackt — dieser Abgleich ist für lose Figuren.",
        IGNORED_SHEET: "Von dir ausgenommen.",
        INVALID_ROW: "Keine Bestandszahl in Spalte F.",
      },

      /* Der einzige echte Konflikt: reservierte Ware gehört schon jemandem. */
      conflictHeading: "Hier ist Ware für laufende Bestellungen reserviert",
      conflictHint:
        "Diese Positionen lassen sich nicht auf den Sollbestand bringen, solange die " +
        "Reservierung besteht — sonst wäre Ware verkauft, die es nicht mehr gibt. Sie werden " +
        "übersprungen; alles andere wird übernommen.",

      decreaseHeading: "Diese Positionen werden weniger",
      decreaseHint: "Der Bestand wird auf den Wert aus der Tabelle gesetzt.",

      apply: "Abgleich übernehmen",
      applying: "Wird übernommen …",
      discard: "Verwerfen",
      appliedResult: (n: number, u: number) =>
        `${n} Positionen angepasst, ${u} waren bereits gleich.`,

      previewFailed: "Die Vorschau konnte nicht gespeichert werden.",
      applyRefused:
        "Mindestens eine Position lässt sich nicht abbuchen — vermutlich ist Ware für eine " +
        "laufende Bestellung reserviert. Es wurde nichts geändert.",
      applyFailed: "Der Abgleich konnte nicht übernommen werden. Es wurde nichts geändert.",
      readFailed: "Die Datei konnte nicht gelesen werden.",
      noSheets:
        "In dieser Datei wurden die Tabellenblätter SA, G, SF, T, SC und I nicht gefunden.",

      /*
       * Browser zu alt (ADR-0087). Wird geprüft, BEVOR die Datei angefasst
       * wird — der Abgleich soll nicht mittendrin an einer fehlenden
       * Browserfunktion scheitern, sondern gar nicht erst anfangen.
       */
      unsupportedBrowser:
        "Dieser Browser kann große Excel-Dateien nicht direkt lesen. Der Abgleich wurde " +
        "nicht gestartet, es wurde nichts geändert. Mit einem aktuellen Chrome, Edge, " +
        "Firefox oder Safari (ab Version 16.4) funktioniert er.",

      /* Verlauf. */
      history: "Frühere Abgleiche",
      historyEmpty: "Noch kein Abgleich.",
      neverApplied: "nicht übernommen",
    },

    /*
     * Orderbuch (ADR-0088).
     *
     * Bewusst operative Sprache: „Ausgaben", „Marktwert", „Faktor". Keine
     * Buchhaltungsbegriffe — das hier ist ein Einkaufsbuch für den Betrieb,
     * keine Buchführung, und die Wörter sollen nichts anderes behaupten.
     */
    orderbook: {
      title: "Orderbuch",
      hint: "Einkäufe erfassen, Pakete prüfen und Figuren einbuchen.",
      /* Die zwei Hälften des Orderbuchs, als kompakte Navigation. Mehrzahl,
         weil die Reiter zu Listen führen und nicht zu einem Vorgang. */
      tabs: { purchase: "Einkäufe", sale: "Verkäufe" },
      saleSoon: "später",
      empty: "Noch kein Einkauf erfasst.",

      /**
       * Anlegen (0063).
       *
       * Sichtbar steht nur „+ Neu" — daneben liegen die Reiter, und die sagen
       * bereits, worum es geht. Was der Knopf konkret anlegt, steht im
       * zugänglichen Namen, damit ein Screenreader nicht „Plus" vorliest.
       */
      newCompact: "+ Neu",
      newPurchase: "Neuen Einkauf anlegen",
      /*
       * Die vier Gruppen des Anlegen-Formulars. Dieselbe Ordnung wie im
       * Verkauf: erst was der Vorgang ist, dann was drin war, dann was er
       * gekostet hat, dann das Optionale.
       */
      newSections: {
        purchase: "Einkauf", figures: "Figuren", amount: "Betrag", note: "Notiz",
      },
      purchasePrice: "Kaufpreis",
      submitPurchase: "Einkauf anlegen",
      allYears: "Alle Jahre",
      allMonths: "Alle Monate",
      /* Ein Einkauf ohne Datum ist ein echter Einkauf — nur das Datum fehlt
         noch. Kein Platzhalterdatum, keine leere Zelle, die kaputt aussieht. */
      undatedFilter: "Ohne Datum",
      undated: "Datum fehlt",
      /* Kaufen ist noch kein Einlagern. */
      createStockHint: "Das Anlegen ändert den Bestand nicht. "
        + "Erst „Einbuchen“ bei der einzelnen Position legt sie ins Lager.",
      undatedHint: "Kaufdatum noch nicht zugewiesen",

      /**
       * Die zwei Einordnungen (0063).
       *
       * SIE SIND UNABHÄNGIG VONEINANDER UND VON „Intern/Extern".
       *
       * „Unvollständig" heißt: an diesem Vorgang fehlt etwas, das jemand
       * nachtragen muss — kein Datum, oder ein von Hand angelegter Einkauf
       * ohne eine einzige Position. Es wird nicht gespeichert, sondern bei
       * jedem Lesen aus dem Vorgang selbst abgeleitet: Datum nachgetragen,
       * Einordnung weg. Eine offene Auszahlung oder eine noch nicht
       * eingebuchte Position ist ausdrücklich NICHT gemeint — das ist
       * laufendes Geschäft, kein Loch in den Unterlagen.
       *
       * „Test" heißt: absichtlich angelegt, um etwas auszuprobieren. Kein
       * echtes Geld, kein echter Vorgang. Testvorgänge stehen in keiner
       * Geschäftssumme und tauchen in den normalen Listen nicht auf — ihr
       * eigener Filter nennt jederzeit ihre Anzahl, damit niemand sie sucht.
       */
      status: {
        all: "Alle",
        /**
         * „Offen" heißt: hier ist noch etwas zu TUN, nicht: hier fehlt etwas
         * (0066). Ein Verkauf kann auf den Cent vollständig erfasst sein und
         * trotzdem offen, weil die Figur noch im Regal liegt.
         *
         * Gezeigt wird nur, was sich auch wirklich buchen lässt: „Einbuchen"
         * und „Ausbuchen" weisen historische Positionen ab, also stehen die
         * hier nicht — ein Filter, der eine unmögliche Aktion verspricht,
         * wäre schlechter als einer, der schweigt.
         */
        open: "Offen",
        incomplete: "Unvollständig",
        test: "Test",
        label: "Einordnung",
        /* Als Kennzeichen in der Zeile, nicht als Satz. */
        testBadge: "Test",
        incompleteBadge: "Unvollständig",
        testTitle: "Testvorgang — zählt in keiner Geschäftssumme mit.",
        incompleteTitle: "Unvollständig — hier fehlt noch etwas.",
        emptyIncomplete: "Nichts Unvollständiges.",
        emptyOpen: "Nichts offen — es ist alles ein- bzw. ausgebucht.",
        emptyTest: "Keine Testvorgänge.",
        openBadge: "Offen",
        openTitle: "Offen — hier ist noch eine Lagerbuchung fällig.",
        /* Wo die Testdaten geblieben sind, einmal ausgeschrieben. */
        hiddenHint: (n: number) =>
          n === 1
            ? "1 Testvorgang ist ausgeblendet. Er steht unter „Test“."
            : `${n.toLocaleString("de-AT")} Testvorgänge sind ausgeblendet. Sie stehen unter „Test“.`,
      },

      /* Beim Anlegen, und später korrigierbar. Standard: aus. */
      testFlag: "Testvorgang",
      testFlagHint: "Zählt in keiner Geschäftssumme mit und steht unter „Test“.",
      markTest: "Als Testvorgang markieren",
      unmarkTest: "Testmarkierung entfernen",
      testSaving: "Wird gespeichert …",

      setDate: "Kaufdatum zuweisen",
      changeDate: "Kaufdatum ändern",
      clearDate: "Datum entfernen",
      dateLabel: "Kaufdatum",
      dateSaving: "Wird gespeichert …",
      save: "Speichern",
      columns: {
        date: "Datum",
        items: "Artikel",
        expenses: "Ausgaben",
        marketValue: "Marktwert",
        factor: "Faktor",
        /* Hieß „Eingebucht" und behauptete das für jede Zeile darunter. Die
           Spalte zeigt vier Zustände, also benennt sie das Thema. */
        progress: "Lager",
        source: "Quelle",
      },
      sources: { manual: "manuell", excel_order_2026: "Order 2026" },

      /* Werkbank-Ansicht: kompaktes Hauptbuch mit Aufklappen (ADR-0088). */
      summary: {
        count: "Anzahl",
        countHint: (items: number) =>
          items === 1 ? "1 Artikel" : `${items.toLocaleString("de-AT")} Artikel`,
        expenses: "Ausgaben",
        marketValue: "Marktwert",
        factor: "Faktor",
      },
      /* Ein Stern statt eines Satzes in jeder Zeile. Die Erklärung hängt als
         Titel daran, damit sie vorlesbar bleibt, ohne die Zeile zu füllen. */
      incompleteMark: "*",
      incompleteTitle: (n: number) =>
        n === 1
          ? "1 Artikel ohne bekannten Marktpreis — Marktwert und Faktor sind unvollständig."
          : `${n.toLocaleString("de-AT")} Artikel ohne bekannten Marktpreis — Marktwert und Faktor sind unvollständig.`,
      search: "Suche",
      searchHint: "Datum, Betrag, Faktor oder Figur",
      searchClear: "Suche zurücksetzen",
      searchEmpty: "Nichts gefunden.",
      /** „3 Treffer in diesem Einkauf" — warum die Zeile im Ergebnis steht. */
      matchCount: (n: number) =>
        n === 1 ? "1 Treffer in diesem Einkauf" : `${n} Treffer in diesem Einkauf`,
      expand: "Einkauf aufklappen",
      collapse: "Einkauf zuklappen",
      loadingItems: "Artikel werden geladen …",
      itemsFailed: "Die Artikel konnten nicht geladen werden.",
      openDetail: "Einzelansicht",
      /* Kopfzeile der aufgeklappten Artikelliste. */
      itemColumns: { series: "Serie", figure: "Figur", status: "Status", action: "Aktion" },
      back: "Zurück zum Orderbuch",
      /*
       * „EINGEBUCHT" HEISST GENAU EINE SACHE: es gibt eine Lagerbewegung.
       *
       * Bis V4.7 stand über der Spalte „Eingebucht" und in jeder Zelle eines
       * importierten Einkaufs ein ✓ — bei 84 Einkäufen und 2114 Positionen,
       * von denen keine einzige eine `movement_id` besitzt. Der Vorbehalt
       * stand im Tooltip, die Behauptung in der Überschrift; gelesen wird die
       * Überschrift.
       *
       * Vier Zustände, vier Wörter. Das ✓ erscheint nur beim vierten.
       */
      settled: "Historisch übernommen",
      historicalLabel: "Historisch",
      historicalHint: "Bestand separat abgeglichen",
      completeCell: "Eingebucht ✓",
      openRowLabel: "Offen",
      openRowHint: "Noch nichts eingebucht",
      /* Teils gebucht: die Zelle zeigt die Zahlen, der Tooltip das Wort. */
      partialLabel: "Teilweise eingebucht",
      /* Nichts mehr offen — aber nicht alles gebucht: Nicht-Katalogartikel
         wurden erledigt statt eingebucht. Deshalb kein Haken. */
      closedLabel: "Erledigt",
      closedHint: (booked: number, settled: number) =>
        `${booked} eingebucht · ${settled} erledigt — nichts mehr offen`,
      completeLabel: "Vollständig eingebucht",
      openLabel: (booked: number, total: number) => `${booked} von ${total} eingebucht`,
      /** „%s von %s" — wie viele Einheiten schon im Bestand sind. */
      progress: (booked: number, total: number) => `${booked} von ${total}`,
      /** Unbekannt ist nicht null: das sagt der Text ausdrücklich. */
      incomplete: (n: number) =>
        n === 1 ? "1 Artikel ohne Marktpreis" : `${n} Artikel ohne Marktpreis`,
      noValue: "kein Marktwert bekannt",
      /* Ein historischer Einkauf hat keine offene Arbeit — „0 von 14" würde
         das Gegenteil behaupten (Pilot 06.12.2025). */
      historical: "historisch",
      percentOfMarket: (p: number) => `${p.toLocaleString("de-AT", { maximumFractionDigits: 1 })} % vom Marktpreis`,
      addItem: "+ Artikel hinzufügen",
      addUncategorized: "+ Sonstiger Artikel",
      uncategorizedHint: "Portal, Spiel oder Zubehör — bleibt Teil des Einkaufs, kommt aber nicht in den Figurenbestand.",
      searchPlaceholder: "Figur suchen",
      book: "Einbuchen",
      booking: "Wird eingebucht …",
      booked: "Im Bestand",
      unbook: "Buchung zurücknehmen",
      priceFrozen: "Preis beim Einbuchen festgehalten",
      priceLive: "aktueller Marktpreis",
      legacyRow: "historisch — bereits im Bestand berücksichtigt",
      /* Zuordnung korrigieren (0054). */
      remap: "Zuordnung ändern",
      remapCancel: "Abbrechen",
      remapNotAFigure: "Keine Figur (Portal, Spiel, Zubehör)",
      remapRemember: "Diesen Excel-Namen künftig so zuordnen",
      /** „Excel: Bob" — nur wenn der Rohtext vom Katalognamen abweicht. */
      rawLabel: (raw: string) => `Excel: ${raw}`,
      /**
       * Figurenauswahl beim Anlegen und im Einkauf (0064).
       *
       * EINE ZEILE JE FIGUR, EIN DATENSATZ JE STÜCK. Die Menge steht nur im
       * Browser: gespeichert wird je Stück eine eigene Position, weil eine
       * Position genau ein Objekt ist — einzeln einbuchbar, einzeln
       * beschädigt, mit höchstens einer Lagerbewegung.
       *
       * ÄNDERN GILT FÜR DIE GANZE ZEILE. Drei Wash Buckler, die in Wahrheit
       * Dark Wash Buckler sind, werden in einem Schritt korrigiert. Für den
       * selteneren Fall „zwei davon, eines anders" wird die Menge verringert
       * und die andere Variante getrennt hinzugefügt.
       */
      figures: {
        heading: "Figuren",
        hint: "Suchen und auswählen. Gespeichert wird erst beim Anlegen.",
        search: "Figur suchen …",
        searchLabel: "Figur suchen",
        tooShort: "Mindestens zwei Zeichen eingeben.",
        empty: "Keine Figur gefunden.",
        noCatalog: "Der Katalog konnte nicht geladen werden.",
        results: "Suchergebnisse",
        selected: "Ausgewählte Figuren",
        none: "Noch keine Figur ausgewählt.",
        /* Ausgeschrieben, weil „3 × 2" auf einem Telefon niemand entziffert. */
        units: (n: number) => (n === 1 ? "1 Figur" : `${n.toLocaleString("de-AT")} Figuren`),
        /* Menge einer Zeile. Das Minus bei 1 entfernt die Zeile — dasselbe
           Gemeinte wie das ×, nur die Geste, die die Finger schon machen. */
        more: (name: string) => `Eine Einheit ${name} mehr`,
        less: (name: string) => `Eine Einheit ${name} weniger`,
        quantity: (name: string, n: number) => `${name}: ${n} Stück`,
        remove: "Entfernen",
        removeOne: (name: string) => `${name} entfernen`,
        change: "Figur ändern",
        changeOne: (name: string) => `${name} austauschen`,
        changeCancel: "Abbrechen",
        /* Marktwert und Faktor, live. Unbekannt ist nicht null. */
        marketValue: "Marktwert",
        factor: "Faktor",
        noMarketValue: "Marktwert fehlt",
        missingPrices: (n: number) =>
          n === 1
            ? "1 Figur ohne Marktpreis — Marktwert und Faktor sind unvollständig."
            : `${n.toLocaleString("de-AT")} Figuren ohne Marktpreis — Marktwert und Faktor sind unvollständig.`,
        /* Ohne Figur speichern bleibt erlaubt (0063): der Einkauf ist dann
           „Unvollständig" und wird später ergänzt. */
        limit: (n: number) => `Mehr als ${n} Figuren auf einmal gehen nicht.`,
      },

      /*
       * Diese Wörter stehen an zwei Stellen: auf den Zustandsknöpfen der
       * Detailseite und in der Lager-Spalte des Buchs. Groß geschrieben,
       * weil sie dort Statusangaben sind und keine Satzfragmente.
       */
      states: {
        ordered: "Bestellt",
        arrived: "Angekommen",
        damaged: "Beschädigt",
        missing: "Fehlt",
        booked: "Eingebucht",
        reconciled_legacy: "Historisch",
        /* Das Ende für etwas, das keine Katalogfigur ist (0069). */
        settled: "Erledigt",
      },
      /* Die Aktion dazu — nur bei Positionen ohne Katalogfigur. */
      settle: "Erledigt",
      settleHint: "Kein Katalogartikel — kommt nicht in den Figurenbestand.",
      unsettle: "Zurücknehmen",
      errors: {
        alreadyBooked: "Dieser Artikel ist bereits im Bestand. Nimm die Buchung zurück, bevor du ihn änderst.",
        notAFigure: "Dieser Artikel ist keine Katalogfigur und kann nicht in den Figurenbestand.",
        damaged: "Ein beschädigter Artikel kommt nicht in den Verkaufsbestand. Setze ihn auf „angekommen“, wenn er doch in Ordnung ist.",
        missing: "Ein Artikel, der nie angekommen ist, lässt sich nicht einbuchen.",
        historical: "Historische Einkäufe sind bereits im Bestand berücksichtigt und werden nicht erneut eingebucht.",
        hasBookings: "Dieser Einkauf hat Artikel im Bestand. Nimm diese Buchungen zuerst zurück.",
        dateRange: "Dieses Kaufdatum liegt außerhalb des plausiblen Bereichs.",
        bookedRemap:
          "Dieser Artikel ist im Bestand. Die Bewegung benennt die Figur, die tatsächlich " +
          "eingebucht wurde — nimm die Buchung zurück, bevor du die Zuordnung änderst.",
        /* 0064: eine Werkbuch-Zeile wird nicht gelöscht. Ihre Zuordnung darf
           weiterhin korrigiert werden — das ist 0054 und bleibt. */
        historicalItem:
          "Diese Position stammt aus der Excel-Historie und wird nicht gelöscht. " +
          "Ihre Figurenzuordnung lässt sich weiterhin über „Zuordnung ändern“ korrigieren.",
        tooManyItems: "Zu viele Figuren auf einmal.",
      },
    },

    /**
     * Verkauf (ADR-0089).
     *
     * DREI DIMENSIONEN, DREI WÖRTER. Geld, Bestand und Versand bewegen sich
     * unabhängig — ein Verkauf kann versendet, erstattet, nicht retourniert
     * und in der Auszahlung offen sein, alles gleichzeitig. Die Texte halten
     * das auseinander, statt es in einen Status zu pressen.
     *
     * „Refund" ist Geld, „Retoure" ist Ware. Der Workbook-Befund: 41 erstattete
     * Bestellungen, 6 mit zurückgekommener Ware.
     */
    sales: {
      title: "Verkauf",
      hint: "Verkäufe über SkyIsles und über externe Kanäle.",
      tabs: { internal: "Intern", external: "Extern" },
      empty: "Noch kein Verkauf erfasst.",

      /**
       * Anlegen (0063).
       *
       * Sichtbar „+ Neu", zugänglich der ganze Satz — und den Knopf gibt es
       * nur unter „Extern". Ein interner Verkauf entsteht aus einer bezahlten
       * Bestellung und nie daraus, dass jemand ihn eintippt; deshalb steht
       * unter „Intern" gar kein Anlegen-Knopf, statt eines, der beim Drücken
       * ablehnt.
       */
      newSale: "Neuen externen Verkauf anlegen",
      internalNoCreate:
        "Interne Verkäufe entstehen automatisch aus einer bezahlten SkyIsles-Bestellung.",
      /* Anlegen eines externen Verkaufs. Intern entsteht aus einer Bestellung. */
      create: {
        title: "Neuer externer Verkauf",
        /*
         * DIE ÜBERSCHRIFTEN TRAGEN JETZT DIE ERKLÄRUNG.
         *
         * Das Formular stand voller Sätze: eine Einleitung, ein Hinweis unter
         * dem Datum, einer zur Vorlage, einer zu den Figuren, einer zum
         * Abrechnungsschalter, drei Zeilen Formel unter der Auszahlung. Auf
         * einem Telefon war mehr Fließtext als Eingabe zu sehen.
         *
         * Die Sätze sind weg, die Gruppen geblieben: sechs Überschriften, die
         * sagen, was in ihnen steht. Was ein Feld bedeutet, sagt sein Name;
         * was der Abrechnungsschalter bewirkt, zeigt die Auszahlung, die sich
         * beim Umschalten bewegt. Erklärt wird nur noch, was man nicht sehen
         * kann.
         */
        sections: {
          sale: "Verkauf", figures: "Figuren", amounts: "Beträge",
          costs: "Kosten", payout: "Auszahlung", note: "Notiz",
        },
        /* Optionale Angaben, zusammen und leiser. */
        moreDetails: "Weitere Angaben",
        channel: "Kanal", date: "Datum", country: "Land",
        buyer: "Käufer", reference: "Referenz", note: "Notiz",
        subtotal: "Summe", shipping: "Versand", discount: "Rabatt",
        submit: "Verkauf anlegen",
        /* Anlegen ist noch keine Lagerbewegung. */
        stockHint: "Das Anlegen ändert den Bestand nicht. "
          + "Erst „Ausbuchen“ bei der einzelnen Position nimmt sie aus dem Lager.",
        invalidAmount: "Bitte einen gültigen Betrag eintragen.",
        /* Standard: aus. Der Normalfall darf nicht umständlicher werden. */
        testFlag: "Testvorgang",
        testFlagHint: "Zählt in keiner Geschäftssumme mit und steht unter „Test“.",

        /**
         * Vorlagen, Figuren und der Auszahlungsabgleich (ADR-0092).
         *
         * EINE VORLAGE IST NUR LAYOUT. „eBay“ entscheidet, welche Felder zu
         * sehen sind und wie sie heißen — gespeichert wird in denselben
         * Strukturen wie bisher: `sale_fees` mit `kind` und `settled_by`,
         * `settlement_adjustments`, die drei Beträge auf `sales`. Es gibt
         * keine eBay-Tabelle und keine eBay-Spalte.
         *
         * VERSAND IST ZWEIMAL DA, UND DAS IST DER PUNKT. Was der Käufer für
         * den Versand zahlt, ist eine Einnahme; was das Label kostet, ist
         * eine Ausgabe. Und beim Label entscheidet `settled_by`, ob es die
         * Auszahlung mindert: ein über eBay gekauftes Label schon, ein am
         * Schalter gekauftes nicht — es ist trotzdem echtes Geld.
         */
        /*
         * Die Auswahl heißt „Kanal", nicht „Vorlage": der Inhaber wählt hier,
         * wo verkauft wurde — dass davon auch das Layout abhängt, ist eine
         * Folge und keine Frage, die er beantworten muss. Gespeichert wird
         * weiterhin `sales.channel`, unverändert.
         */
        template: "Kanal",
        templateNames: { ebay: "eBay", manual: "Manuell" },

        subtotalLabel: "Verkaufspreis",
        shippingLabel: "Versand vom Käufer",
        discountLabel: "Rabatt",

        feeAdd: "+ Kosten",
        feeAddLabel: "Weitere Gebühr",
        feeRemove: (label: string) => `${label} entfernen`,
        feeLabelPlaceholder: "Bezeichnung",
        /* Der Schalter, der über die Auszahlung entscheidet. */
        settledBy: "Abgezogen von",
        settledChannel: "Kanal",
        settledExternal: "selbst bezahlt",
        /* Bleibt: der Schalter selbst ist zwei Wörter, seine Wirkung nicht. */
        settledHint: "„Kanal“ mindert die Auszahlung. „selbst bezahlt“ kostet Geld, "
          + "ändert aber nicht, was der Kanal überweist.",
        feeNeedsLabel: "Bitte die weitere Gebühr benennen.",

        adjustment: "Korrektur",

        expectedPayout: "Auszahlung",

        figuresHeading: "Figuren",
      },
      channels: { ebay: "eBay", manual: "Manuell" },
      /* Zuordnung einer Position korrigieren (0065). Nur handgemachte,
         nicht ausgebuchte Positionen — historische bleiben, wie sie sind. */
      changeFigure: "Figur ändern",
      changeFigureOne: (name: string) => `${name} austauschen`,
      itemSearch: "Figur suchen",
      noItems: "Noch keine Position erfasst.",
      addUncategorized: "Ohne Katalogzuordnung hinzufügen",
      uncategorizedHint: "Kein Katalogartikel — Name eintragen.",
      removeItem: "Entfernen",
      backToLedger: "Zurück zum Verkaufsbuch",
      /*
       * Die Finanzzeile trägt die Überschriften des Arbeitsbuchs.
       * `Order 2026!T4` heißt wörtlich „EU" und enthält das Länderkürzel —
       * nachgesehen, nicht geraten. Ebenso U „Summe", V „Versand",
       * W „Rabatt", AD „Refund", AE „Auszahlung".
       */
      columns: {
        date: "Datum", country: "EU", sum: "Summe", shipping: "Versand",
        discount: "Rabatt", fees: "Fees", label: "Label", refund: "Refund",
        payout: "Auszahlung", stock: "Lager", details: "Details",
        /* Weiterhin gebraucht: Filter, Detailansicht, Intern-Spalte. */
        channel: "Kanal", countryName: "Land", items: "Artikel",
        order: "Bestellung", gross: "Gesamt",
        expected: "Erwartet", reported: "Gemeldet",
        difference: "Differenz", status: "Status",
      },
      /** Die Detailübersicht eines Verkaufs. */
      detailsModal: {
        title: "Verkaufsdetails",
        close: "Schließen",
        sale: "Verkauf",
        channel: "Kanal", reference: "Referenz", buyer: "Käufer",
        amounts: "Beträge",
        charges: "Gebühren",
        labels: "Versandlabel",
        /* Nie `channel` / `external` zeigen — der Inhaber liest, wer bezahlt
           hat, nicht den Enum-Wert. */
        settledChannel: "Über Kanal", settledExternal: "Extern bezahlt",
        refunds: "Refunds",
        adjustments: "Auszahlungskorrekturen",
        payout: "Auszahlung",
        shippingState: "Versand",
        none: "keine",
        /* Pflege eines externen Verkaufs nach dem Verkaufstag. */
        edit: "Bearbeiten", done: "Fertig", save: "Speichern", cancel: "Abbrechen",
        remove: "Entfernen",
        addFee: "Gebühr hinzufügen", addRefund: "Rückerstattung hinzufügen",
        amount: "Betrag", kind: "Art", settlement: "Abrechnung", label: "Bezeichnung",
        reason: "Grund", occurredAt: "Datum",
        history: "Änderungen",
        historyEmpty: "Noch nichts korrigiert.",
        /* Interne Verkäufe gehören dem Shop — hier wird nichts bearbeitet. */
        commerceLocked: "Diese Angaben gehören zur Bestellung.",
        stale: "Dieser Verkauf wurde inzwischen geändert. Bitte neu laden.",
        /* Provenienz bleibt sichtbar, auch nach einer Korrektur. */
        imported: "Aus Order 2026 importiert",
        editedSince: "seit dem Import korrigiert",
        /* Gebührenarten. Ein eigener Text schlägt diese Namen. */
        feeKinds: {
          payment: "Transaktionsgebühr",
          marketplace: "Marktplatzgebühr",
          shipping_label: "Versandlabel",
          other: "Sonstige",
        },
        /* Genau die Gründe, die die Datenbank zulässt — keine erfundenen. */
        refundReasons: {
          artikel_fehlt: "Artikel fehlt",
          artikel_beschaedigt: "Artikel beschädigt",
          nicht_geliefert: "Nicht geliefert",
          versandkorrektur: "Versandkorrektur",
          retoure: "Retoure",
          kulanz: "Kulanz",
          sonstiges: "Sonstiges",
        },
      },
      /* Die Spalten der aufgeklappten Positionsliste. Dieselbe Tabelle wie im
         Einkauf, um „Bestand" und „Retoure" erweitert — beides sind eigene
         Tatsachen und gehören nicht in eine gemeinsame Statusspalte. */
      /* Vier Spalten seit 0075: `Bestand` und `Retoure` beantworteten zu
         zweit eine Frage und konnten sich widersprechen. */
      itemColumns: {
        series: "Serie", figure: "Figur", marketValue: "Marktwert",
        status: "Status", action: "Aktion",
      },
      summary: {
        count: "Verkäufe", items: "Artikel", gross: "Umsatz",
        /* Eine Auszahlungszahl, berechnet (ADR-0095). „Gemeldet", „Offen" und
           der Filter „Auszahlung offen" sind mit dem manuellen Abgleich
           entfallen. */
        expected: "Auszahlung",
      },
      /* Finanzielle Erstattung und körperliche Retoure sind zwei Dinge. */
      refundNotReturn: "Eine Rückerstattung ist Geld — ob etwas zurückkam, steht bei der Position.",
      undated: "Datum fehlt",
      /* Warum ein interner Verkauf als Test gilt: die Bestellung sagt es. */
      testFromOrder: "Testbestellung aus dem Testbetrieb",
      testFromOperator: "Von Hand als Testvorgang markiert",
      /* Bestand — der Haken heißt „ausgebucht", nicht „verkauft": das eine ist
         eine Lagerbewegung, das andere ein Geschäftsvorfall. */
      book: "Ausbuchen", booked: "Ausgebucht", booking: "Wird ausgebucht …",
      /*
       * Das Ende für eine Position, die nie im Figurenbestand stand (0073) —
       * ein Portal, oder eine Zeile, die das Arbeitsbuch mit L="-" als nicht
       * aus dem Lager genommen markiert hat. Kein Haken: „Ausgebucht" heißt
       * genau, dass eine Lagerbewegung existiert.
       */
      settle: "Erledigt",
      unsettle: "Zurücknehmen",
      settleHint: "Kein Lagerabgang — diese Position stand nicht im Figurenbestand.",
      /*
       * Ein Zustand je Position (0074/0075). Der Haken steht nur an den
       * beiden, hinter denen eine echte Lagerbewegung steht.
       */
      itemStates: {
        open: "Offen",
        shipped: "Verschickt",
        outbooked: "Ausgebucht ✓",
        return_announced: "Retoure unterwegs",
        returned: "Retoure angekommen",
        restocked: "Wieder eingelagert ✓",
        not_shipped: "Nicht verschickt",
        settled: "Erledigt",
      },

      /* Die Statusspalte einer importierten Zeile — was das Arbeitsbuch sagt. */
      legacyStates: {
        shipped: "Verschickt",
        not_shipped: "Nicht verschickt",
        returned: "Retoure",
        lost: "Verloren",
        shipped_unreferenced: "Verschickt",
        unresolved: "Ungeklärt",
      } as Record<string, string>,

      /**
       * Was der Statuspunkt vorliest. Dieselben acht Zustände, aber als
       * ganzer Satz — der Punkt sagt „noch etwas zu tun?", das Label sagt
       * was. Ohne ihn wäre die Spalte reine Farbe.
       */
      /* Was in der Aktionsspalte steht, wenn nur zurückgehalten wird. */
      itemActionHeld: "Abgleich ausstehend",

      itemIndicator: {
        open: "Offen — noch nicht ausgebucht",
        shipped: "Verschickt — noch nicht ausgebucht",
        outbooked: "Ausgebucht und verschickt",
        /* Der eine Fall, den der Zustand allein nicht trennt (gelb ✓). */
        outbookedUnshipped: "Ausgebucht — noch nicht verschickt",
        return_announced: "Retoure angekündigt — noch nicht eingetroffen",
        returned: "Retoure eingetroffen — noch nicht eingelagert",
        restocked: "Retoure abgeschlossen — wieder im Bestand",
        settled: "Erledigt — ohne Lagerbewegung abgeschlossen",
        not_shipped: "Nicht verschickt — nichts gebucht",
        /*
         * Die vier Ausgänge, die das Arbeitsbuch selbst festhält (Spalte L).
         * Sie schlagen jeden abgeleiteten Zustand einer importierten Zeile,
         * `settled_at` eingeschlossen — der sagt nur, dass WIR sie ohne
         * Bewegung geschlossen haben, nicht was mit der Figur geschah.
         */
        legacyShipped: "Verschickt — laut Arbeitsbuch ausgeliefert und ausgetragen",
        legacyNotShipped: "Nicht verschickt — laut Arbeitsbuch nie ausgeliefert und nie ausgetragen",
        legacyReturned: "Retoure — verschickt, zurückgekommen und wieder eingelagert",
        legacyLost: "Verloren — verschickt und auf dem Versandweg verloren gegangen",
        /* Verkauft und verschickt, aber nie Teil des Figurenlagers. */
        legacyShippedUnreferenced: "Verschickt — kein Bezug zum Figurenlager",
        /* Eine Kennzeichnung, die niemand definiert hat. Nicht raten. */
        legacyUnresolved: "Ungeklärt — die Kennzeichnung im Arbeitsbuch ist nicht eindeutig",
        /* Importierte Zeile, die das Arbeitsbuch bereits abgeschlossen hat. */
        legacyComplete:
          "Historisch abgeschlossen — laut Arbeitsbuch erledigt, Bestand bereits berücksichtigt",
        /* Importiert, aber ohne Vermerk: hier fehlt noch eine Entscheidung. */
        legacyPending:
          "Historisch — ohne Vermerk im Arbeitsbuch, wartet auf den Bestandsabgleich",
      },
      itemActionLabels: {
        book: "Ausbuchen",
        announce_return: "Retoure melden",
        mark_returned: "Retoure angekommen",
        restock: "Einlagern",
        settle: "Erledigt",
        unsettle: "Zurücknehmen",
        unmark_not_shipped: "Zurücknehmen",
      },
      /* Positionsebene — `notShipped` oben gehört dem Versandschalter der
         ganzen Bestellung und bedeutet etwas anderes. */
      markNotShippedItem: "Nicht verschickt",
      notShippedItemHint: "Ging nicht mit raus — bleibt im Bestand, wird nicht ausgebucht.",
      states: { settled: "Erledigt" },
      /* Lagerstatus eines ganzen Verkaufs (0072). */
      stock: {
        outbooked: "Ausgebucht ✓",
        outbookedHint: "Alle Positionen ausgebucht und nicht zurückgekommen",
        returned: "Retour ✓",
        returnedHint: "Alle Positionen zurück und wieder eingelagert",
        closed: "Abgeschlossen",
        closedHint: (outbooked: number, restocked: number, settled: number, notShipped: number) =>
          `${outbooked} ausgebucht · ${restocked} retour · ${settled} erledigt · ${notShipped} nicht verschickt`,
        settled: "Erledigt",
        settledHint: (booked: number, settled: number) =>
          `${booked} ausgebucht · ${settled} erledigt — nichts mehr offen`,
        cancelled: "Storniert",
        cancelledHint: "Bestellung storniert — kein Lagerabgang",
        frozen: "Historisch",
        frozenHint: "Bestand separat abgeglichen",
        open: "Offen",
        openHint: "Noch nichts ausgebucht",
        partial: "Teilweise ausgebucht",
      },
      unbook: "Ausbuchen zurücknehmen",
      returnItem: "Retoure eingegangen", returned: "Retoure",
      restock: "Wieder einlagern", restocked: "Wieder eingelagert",
      shipped: "Versendet", notShipped: "Nicht versendet",
      markShipped: "Als versendet markieren", markNotShipped: "Versand zurücknehmen",
      /* Geld */
      addFee: "+ Gebühr", addRefund: "+ Refund", addItem: "+ Artikel",
      amounts: "Beträge", fees: "Gebühren", refunds: "Refunds",
      subtotal: "Summe", shipping: "Versand", discount: "Rabatt",
      buyIn: "Buy In", factor: "Einkaufsfaktor",
      buyInHint: "Rechnerischer Wert, nicht der tatsächliche Einkaufspreis dieses Stücks.",
      note: "Notiz", detail: "Einzelansicht", back: "Zurück zum Verkauf",
      expand: "Verkauf aufklappen", collapse: "Verkauf zuklappen",
      loadingItems: "Wird geladen …", itemsFailed: "Konnte nicht geladen werden.",
      commerceOwned: "Von der Bestellung übernommen",
      errors: {
        /* 0065: eine Werkbuch-Position wird weder gelöscht noch umgehängt. */
        historicalItem:
          "Diese Position stammt aus der Excel-Historie und wird nicht verändert.",
        bookedItem:
          "Diese Position ist ausgebucht. Nimm die Lagerbewegung zurück, bevor du sie änderst.",
        tooMany: "Zu viele Positionen, Gebühren oder Korrekturen auf einmal.",
        reserved: "Dieser Artikel ist aktuell für eine SkyIsles-Bestellung reserviert.",
        noStock: "Für diesen Artikel gibt es keinen Lagerbestand.",
        notAFigure: "Dieser Artikel ist keine Katalogfigur und hat keinen Lagerplatz.",
        historical: "Historische Verkäufe verändern den Bestand nicht.",
        /* Der barrierefreie Name des Statuspunkts. Farbe allein trägt nie. */
        saleCancelled:
          "Diese Bestellung ist storniert — es hat nichts das Lager verlassen.",
        alreadySettled:
          "Diese Position ist bereits ohne Lagerbewegung abgeschlossen. " +
          "Nimm „Erledigt“ zuerst zurück.",
        heldForReconciliation:
          "Historische Verkäufe werden bis zum Excel-Bestandsabgleich nicht ausgebucht — " +
          "ihr Bestandseffekt steckt bereits im abgeglichenen Lager.",
        notReleased:
          "Dieser historische Verkauf ist noch nicht freigegeben. " +
          "Gib die Bestellung zuerst frei.",
        mustBeBooked:
          "Eine Katalogfigur verl\u00e4sst den Bestand durch Ausbuchen, nicht durch Abschlie\u00dfen.",
        returnArrived:
          "Diese Retoure ist bereits eingetroffen und kann nicht mehr zur\u00fcckgenommen werden.",
        notFromStock:
          "Das Arbeitsbuch verzeichnet dieses Exemplar als verschickt, aber nie dem Lager " +
          "entnommen. Schließe die Position stattdessen über „Erledigt“ ab.",
        returnFirst: "Markiere die Retoure zuerst als eingegangen.",
        neverBooked: "Dieser Artikel wurde nie ausgebucht.",
        alreadyRestocked: "Dieser Artikel wurde bereits wieder eingelagert.",
        commerceOwned: "Diese Angabe gehört zur Bestellung und wird dort gepflegt.",
        positiveFee: "Eine Gebühr ist ein positiver Betrag. Für eine Gutschrift nutze eine Auszahlungskorrektur.",
        hasMovements: "Dieser Verkauf hat Artikel im Bestand. Nimm die Buchungen zuerst zurück.",
        itemBooked: "Dieser Artikel ist ausgebucht. Nimm die Buchung zuerst zurück.",
        internalAutomatic: "SkyIsles-Verkäufe entstehen automatisch aus einer bezahlten Bestellung.",
        /* Die Antwort gehört der Bestellung — und deren Modus steht fest. */
        internalTestDerived:
          "Ob ein interner Verkauf ein Test ist, entscheidet die Bestellung: "
          + "Testbestellungen kommen aus dem Testbetrieb und sind dort festgeschrieben.",
        dateRange: "Dieses Verkaufsdatum liegt außerhalb des plausiblen Bereichs.",
      },
    },

    ordersHeading: "Bestellungen",
    ordersPageHint: "Bestellungen, die Kundschaft bei dir aufgegeben hat.",

    /**
     * Testbestellungen (ADR-0084).
     *
     * ARCHIVIEREN IST NICHT LÖSCHEN. SkyIsles löscht keine Bestellungen —
     * echte sind Geschäftsunterlagen, Testbestellungen sind der Nachweis, wie
     * sich Checkout, Zahlung und Versand tatsächlich verhalten haben.
     * Archivieren setzt einen Zeitstempel; die Bestellung, ihre Positionen,
     * Zahlungsereignisse und Versandhistorie bleiben vollständig erhalten, und
     * „Wiederherstellen" nimmt den Zeitstempel zurück. Die Texte hier sagen das
     * auch, statt nach Papierkorb zu klingen.
     */
    testOrders: {
      tab: "Testbestellungen",
      liveTab: "Bestellungen",
      heading: "Testbestellungen",
      pageHint:
        "Bestellungen aus dem Testbetrieb. Sie zählen in keiner Kennzahl und in keinem Bericht " +
        "mit und erscheinen nicht unter „Bestellungen“.",
      empty: "Keine Testbestellungen.",
      emptyArchived: "Keine archivierten Testbestellungen.",
      showArchived: "Archivierte anzeigen",
      hideArchived: "Nur aktive anzeigen",
      archivedBadge: "Archiviert",
      archive: "Archivieren",
      restore: "Wiederherstellen",
      archiveAll: "Alle sichtbaren archivieren",
      working: "Einen Moment …",
      /* Einmal ausgeschrieben, damit niemand „archivieren" für „weg" hält. */
      archiveHint:
        "Archivieren blendet eine Testbestellung nur aus dieser Liste aus. Nichts wird " +
        "gelöscht, nichts am Bestand, an der Zahlung oder am Versand geändert — und " +
        "zurückholen geht jederzeit.",
      notSandbox:
        "Das geht nur mit Testbestellungen. Es wurde nichts geändert.",
      failed: "Das hat nicht geklappt.",
      archivedCount: (n: number) =>
        n === 1 ? "1 Testbestellung archiviert" : `${n} Testbestellungen archiviert`,
      restoredCount: (n: number) =>
        n === 1 ? "1 Testbestellung wiederhergestellt" : `${n} Testbestellungen wiederhergestellt`,
    },

    /**
     * Monatsnamen, ausgeschrieben.
     *
     * Nicht über `Intl.DateTimeFormat`: dafür bräuchte jeder Monatsname ein
     * Datum, und ein Datum hat einen Tag und eine Zeitzone — beides Dinge, die
     * hier nicht gemeint sind und im falschen Moment einen Monat verschieben.
     * Ein Monat ist hier eine Zahl von 1 bis 12.
     */
    monthNames: [
      "Januar", "Februar", "März", "April", "Mai", "Juni",
      "Juli", "August", "September", "Oktober", "November", "Dezember",
    ] as const,
    monthLabel: (year: number, month: number) =>
      `${de.business.monthNames[month - 1] ?? month} ${year}`,

    /**
     * Das Bestellarchiv (ADR-0082).
     *
     * „Aktuell" ist bewusst nicht „Dieser Monat": am Ersten wäre die Liste
     * leer, obwohl dieselbe Arbeit noch offen ist. Und es ist nicht nur ein
     * Zeitraum — alles Unerledigte bleibt oben stehen, egal wie alt es ist.
     */
    archive: {
      current: "Aktuell",
      currentHint: (days: number) =>
        `Die letzten ${days} Tage — und alles, was noch nicht abgeschlossen ist, ` +
        `unabhängig vom Alter.`,
      older: "Ältere Bestellungen",
      olderHint: "Nach Monat. Ein Monat öffnet sich als eigene Liste.",
      empty: "In diesem Zeitraum keine Bestellungen.",
      emptyCurrent: "Nichts Aktuelles und nichts Offenes.",
      year: "Jahr",
      month: "Monat",
      allMonths: "Alle Monate",
      orderCount: (n: number) => (n === 1 ? "1 Bestellung" : `${n} Bestellungen`),
      apply: "Anzeigen",
      backToCurrent: "Zurück zur aktuellen Ansicht",
    },

    /**
     * Berichte (ADR-0082).
     *
     * EIN MONATSBERICHT IST EIN EREIGNISBERICHT. Eine Bestellung gehört in den
     * Monat, in dem sie aufgegeben wurde — nicht in den, in dem das Geld
     * ankam. Deshalb heißt die Zahl „Bestellwert" und nicht „Einnahme",
     * „Umsatz" oder „bezahlt": eine am 31. August aufgegebene und am
     * 2. September bezahlte Bestellung würde jedes dieser Wörter an dem Tag
     * falsch machen, an dem der Bericht entsteht.
     *
     * Zahlungseingänge und Rückerstattungen sind eine zweite Art von Bericht,
     * nach ihren eigenen Ereignisdaten — die gibt es noch nicht, und diese
     * Seite tut nicht so.
     */
    reports: {
      heading: "Berichte",
      pageHint:
        "Für jeden abgeschlossenen Kalendermonat ein Bericht über die Bestellungen dieses " +
        "Monats. Einmal erstellt, ändert er sich nicht mehr.",
      status: {
        available: "Verfügbar",
        ready: "Noch nicht erstellt",
        running: "Noch nicht verfügbar",
      },
      runningHint: "Der Monat läuft noch.",
      create: "Bericht erstellen",
      creating: "Wird erstellt …",
      finalizedAt: (date: string) => `Erstellt am ${date}`,

      /* Die Zahlen. „Bestellwert" ist die Hauptzahl; die Aufteilung darunter
         ist derselbe Betrag, anders geschnitten. */
      orders: "Bestellungen",
      orderValue: "Bestellwert",
      merchandise: "Davon Ware",
      shipping: "Davon Versand",
      discount: "Davon Rabatt",

      /* Rein informativ, Stand bei Erstellung. Definiert den Bestellwert
         nicht um: gezählt wird jede Bestellung des Monats, bezahlt oder
         nicht. */
      paid: "Davon bezahlt",
      unpaid: "Zahlung offen",
      snapshotHint: "Zahlungsstand zum Zeitpunkt der Erstellung.",

      taxRegime: "Steuerregelung",
      taxRegimeNames: {
        small_business_19: "Kleinunternehmer, § 19 UStG — keine Umsatzsteuer",
        mixed: "Im Monat gewechselt",
      },
      empty: "Für dieses Jahr gibt es noch nichts zu berichten.",
      monthNotOver: "Dieser Monat ist noch nicht vorbei.",
      createFailed: "Der Bericht konnte nicht erstellt werden.",

      /**
       * Was der Bericht ist und was er nicht ist — einmal ausgeschrieben,
       * statt als Spalten mit 0,00 €.
       */
      limits:
        "Gezählt wird nach Bestelldatum (Berliner Kalender), nur im Echtbetrieb. Abgebrochene " +
        "Checkouts zählen nicht. Der Bestellwert ist kein Zahlungseingang: eine Bestellung " +
        "zählt zu ihrem Monat, auch wenn das Geld später eintrifft. Eine spätere Zahlung " +
        "ändert einen erstellten Bericht nicht.",
      limitsMissing:
        "Nicht enthalten: Rückerstattungen (die gehören in den Monat, in dem sie stattfinden, " +
        "und werden bisher nirgends mit Betrag erfasst), Gebühren des Zahlungsanbieters " +
        "(SkyIsles speichert sie nicht) und Umsatzsteuer (nach § 19 UStG wird keine erhoben). " +
        "Es ist ein Tätigkeitsnachweis, keine Buchhaltung.",
      downloadLater:
        "Ein Download als PDF oder CSV ist noch nicht eingebaut. Die Zahlen stehen hier.",
    },
  },

  /** Verwaltung des Shopzugangs — eine Plattformaufgabe (ADR-0077). */
  businessAccounts: {
    heading: "Business-Zugänge",
    hint:
      "Wer diesen Shop führen darf. Ein Konto hat genau einen Typ: Sammler, Business oder Admin. " +
      "Ein Adminkonto kann keinen Shopzugang bekommen — dafür braucht es ein eigenes Konto.",
    empty: "Noch kein Konto darf den Shop führen.",
    sellerLabel: "Verkäufer",
    enabled: "Aktiv",
    disabled: "Deaktiviert",
    enable: "Aktivieren",
    disable: "Deaktivieren",
    /* Seit 0042 kann ein Konto nicht mehr beides sein; die Zeile bleibt für
       Altbestand aus der Zeit davor (ADR-0078). */
    alsoAdmin: "Auch Admin",
    isAdminAccount: "Adminkonto — kein Shopzugang möglich",
    revokedBecomesUser:
      "Ein Entzug macht das Konto wieder zu einem Sammlerkonto. Die Sammlung bleibt erhalten.",
    searchLabel: "Konto suchen",
    searchPlaceholder: "Benutzername oder E-Mail",
    searchHint:
      "Die Suche findet das Konto. Gespeichert wird die Konto-ID, nie die Adresse.",
    searchEmpty: "Kein Konto gefunden.",
    searchTooShort: "Mindestens drei Zeichen.",
    grant: "Shopzugang geben",
    alreadyOperator: "Hat bereits Zugang",
    failed: "Das konnte nicht gespeichert werden.",
    /*
     * Kein Fehler, sondern eine Regel (0051): ein Punkt im Benutzernamen ist
     * an den Shopzugang gebunden. Wir benennen niemals selbst einen Nutzer um.
     */
    revokeBlockedByUsername:
      "Der Benutzername dieses Kontos enthält einen Punkt, den nur ein Shopkonto führen darf. " +
      "Das Konto muss seinen Benutzernamen zuerst selbst auf einen ohne Punkt ändern; " +
      "danach lässt sich der Shopzugang entziehen.",
  },

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
    /** Der Bearbeiten-Knopf auf der Adminkarte, mit Figurennamen (V3.8). */
    editFigure: (name: string) => `${name} bearbeiten`,
    /** Überschrift und Abschnitte des Bearbeiten-Dialogs (V3.8). */
    editTitle: "Figur bearbeiten",
    /* Der Adminblock hatte keins von beiden — `cancel` steht im Checkout-Block
       und `loading` im Katalogblock, beides andere Kontexte. */
    cancel: "Abbrechen",
    /* ------------------------------------------------------------------
       Figur hinzufügen (V3.9). Ein eigener Block, weil hier zum ersten Mal
       ein Katalogeintrag ENTSTEHT statt geändert zu werden — die Wörter für
       „anlegen" und „speichern" dürfen sich nicht vermischen.
       ------------------------------------------------------------------ */
    /** Der Knopf in der Katalogleiste, nur für Admins sichtbar. */
    addFigure: "Hinzufügen",
    addFigureTitle: "Figur hinzufügen",
    /** Das X im Kopf des Hinzufügen-Dialogs. */
    closeAdd: "Hinzufügen schließen",

    startHeading: "Womit anfangen?",
    startEmpty: "Leer beginnen",
    startTemplate: "Bestehende Figur als Vorlage",
    templateSearch: "Figur suchen …",
    templateNone: "Keine passende Figur gefunden.",
    templateChosen: (name: string) => `Vorlage: ${name}`,
    templateClear: "Vorlage entfernen",
    /* Was eine Vorlage überträgt, im Klartext — damit niemand annimmt, sie
       übernehme Bild, Kartentyp oder Sichtbarkeit. */
    /* Die Vorlage ist keine Formular-Vorbefüllung, sondern eine Aussage über
       die Sammleridentität (ADR-0070a). Der Text sagt das, statt „übernimmt
       zwei Felder" zu behaupten. */
    templateHint:
      "Die neue Figur gilt als weitere Ausgabe derselben Figur. Serie und Kategorie sind Startwerte.",
    templateInherits: "Charakterzuordnung wird übernommen — Element und Suche folgen daraus.",
    templateNoCharacter:
      "Diese Vorlage hat keine Charakterzuordnung. Die neue Figur bleibt ohne — sie wird nicht erraten.",
    templateNameUnchanged:
      "Der Name stammt noch aus der Vorlage. Bitte den endgültigen Namen eintragen.",

    skyIdAuto: "Wird automatisch vergeben",
    createName: "Name",
    createNameHint: "Wird roh gespeichert — keine Korrektur, keine Normalisierung.",
    createSeries: "Serie",
    createCategory: "Kategorie",
    createCategoryFirst: "Zuerst eine Serie wählen.",
    /* Beide Felder sind Anzeige, keine Eingabe: die Gruppe hängt an der
       Kategorie, das Element an der Charakterzuordnung. */
    groupDerived: "Ergibt sich aus der Kategorie.",
    elementDerived: "Wird über die Charakterzuordnung bestimmt.",
    slugLabel: "URL-Kürzel",
    slugPreviewHint: "Vorschau. Die endgültige Vergabe erfolgt beim Anlegen.",

    createVisibleLabel: "Sofort im öffentlichen Katalog zeigen",
    createVisibleHint:
      "Standardmäßig aus. Eine neue Figur hat noch kein Bild und keine Charakterzuordnung.",
    createImageHint: "Optional. Wird nach dem Anlegen hochgeladen.",

    similarTitle: "Ähnliche Katalogeinträge gefunden",
    similarHint: "Gleiche Namen sind erlaubt — bitte nur kurz prüfen.",

    create: "Figur hinzufügen",
    creating: "Wird angelegt …",
    created: (skyId: string) => `Figur ${skyId} hinzugefügt`,
    /* Der Zweiphasen-Fall: die Figur EXISTIERT, nur das Bild fehlt. Der Text
       sagt beides, weil ein bloßes „fehlgeschlagen" zu einem zweiten Anlegen
       verleiten würde — und damit zu einer zweiten SKY-ID. */
    createdWithoutImage: (skyId: string) =>
      `Figur ${skyId} wurde angelegt, das Bild konnte nicht gespeichert werden.`,
    closeWithoutImage: "Ohne Bild schließen",
    imageAfterwards: "Das Bild lässt sich jederzeit über Bearbeiten nachtragen.",
    createNameRequired: "Bitte einen Namen eintragen.",
    createSeriesRequired: "Bitte eine Serie wählen.",
    createCategoryRequired: "Bitte eine Kategorie wählen, die zur Serie gehört.",
    createFailed: "Die Figur konnte nicht angelegt werden.",

    /**
     * Das X im Kopf des Bearbeiten-Dialogs (V3.8a). Eigener Text statt
     * `quickView.close`: derselbe Knopf, aber ein anderer Dialog — und eine
     * Vorlesehilfe soll sagen, was hier geschlossen wird.
     */
    closeEditor: "Bearbeiten schließen",
    loading: "Wird geladen …",
    elementLabel: "Element",
    sectionIdentity: "Identität",
    sectionIdentityHint: "Kommt aus dem Import und wird bei jedem Lauf neu geschrieben.",
    sectionDisplay: "Darstellung",
    sectionVisibility: "Sichtbarkeit",
    sectionVisibilityHint:
      "Unabhängig vom Kartentyp. Eine Figur auszublenden ändert nicht, worauf sie gedruckt ist.",
    sectionInternal: "Intern",
    sectionHistory: "Änderungen",
    /* `overrideLabel`, `overrideHint` und `noteLabel` stehen in diesem Block
       bereits — `FigureEditor` benutzt sie auf der Detailseite. Derselbe Text
       für dasselbe Feld, an einer Stelle. */
    visibleLabel: "Im öffentlichen Katalog zeigen",
    /* `save`, `saved` und `cancel` existieren in diesem Block bereits und
       werden wiederverwendet — ein zweites Wort für dieselbe Sache wäre eine
       zweite Wahrheit. Nur was fehlt, kommt dazu. */
    saveChanges: "Änderungen speichern",
    saving: "Wird gespeichert …",
    discardTitle: "Änderungen verwerfen?",
    discardBody: "Die Änderungen an dieser Figur wurden noch nicht gespeichert.",
    keepEditing: "Weiter bearbeiten",
    discard: "Änderungen verwerfen",
    savedPartly: (saved: number, total: number) =>
      `${saved} von ${total} Änderungen gespeichert. Die übrigen stehen noch offen.`,
    loadFailed: "Die Figur konnte nicht geladen werden.",
    /** Ein Kartentyp, den es nicht gibt (V3.5). */
    unknownCardType: "Unbekannter Kartentyp.",
    /** Überschrift und Bezeichnung des Kartentyp-Felds (V3.5). */
    cardType: "Kartentyp",
    cardTypeHint: "Bestimmt nur die Kartengrafik — der Name der Figur ändert sich dadurch nicht.",
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
    /**
     * Verkäuferdaten (ADR-0064). SkyIsles ist die Plattform; verkauft wird
     * unter dem Handelsnamen des Verkäufers. Die Plattformangaben stehen
     * getrennt darunter — zwei Pflichten, zwei Blöcke.
     */
    seller: {
      heading: "Verkäuferdaten",
      hint:
        "Wer die Ware verkauft. Diese Angaben stehen in Mails an Kunden und später auf der " +
        "Rechnung und in der Widerrufsbelehrung. Die Absenderadresse der Mails gehört zur " +
        "Serverkonfiguration und ist hier bewusst nicht änderbar.",
      displayName: "Handelsname",
      displayNameHint: "Unter diesem Namen kaufen Kundinnen und Kunden.",
      contactEmail: "Verkäufer-E-Mail",
      contactEmailHint:
        "Die Adresse, an die Kunden zu einer Bestellung schreiben. Sie steht als Antwortadresse " +
        "in jeder Bestell- und Versandmail.",
      replyTo: "Abweichende Antwortadresse (optional)",
      replyToHint: "Leer lassen, wenn Antworten an die Verkäufer-E-Mail gehen sollen.",
      save: "Speichern",
      saved: "Gespeichert.",
      invalidEmail: "Das sieht nicht nach einer E-Mail-Adresse aus.",
      saveFailed: "Das hat nicht geklappt.",
      /** Ohne sie kann die Prüfwarnung nirgendwohin. */
      missingWarning:
        "Ohne Verkäufer-E-Mail kann SkyIsles dich nicht benachrichtigen, wenn eine Bestellung " +
        "geprüft werden muss.",
    },

    /**
       Verantwortungsbereiche im Adminbereich (ADR-0075).

       SHOP ist der Verkäufer, ADMIN ist SkyIsles. Dieselbe Person bedient
       heute beides — genau deshalb steht es getrennt da: wenn ein Mensch beide
       Fragen beantwortet, erinnert ihn nichts daran, dass es zwei sind.
     */
    domains: {
      shopHeading: "Shop",
      shopHint:
        "Alles, was dem Verkäufer gehört: Bestellungen, Versand, Verkäuferangaben, Steuern, " +
        "Widerruf. Vertragspartner der Kunden ist der Verkäufer, nicht SkyIsles.",
      adminHeading: "Plattform",
      adminHint:
        "Alles, was SkyIsles selbst betrifft: Katalog, Figuren, Kategorien, Testkonten, " +
        "Plattformangaben. Kein Verkauf.",
    },

    /**
       Verkäufer- und Shopangaben in Gruppen (ADR-0075).

       Noch nirgends veröffentlicht: Legal V1 rendert diese Werte später. Hier
       werden sie nur erfasst, und ein leeres Feld bleibt leer — ein Platzhalter
       in einem Impressumsfeld wäre keine halbfertige Einstellung, sondern eine
       falsche Aussage über eine echte Person.
     */
    shopProfile: {
      heading: "Verkäufer- und Shopangaben",
      hint:
        "Diese Angaben stehen später im Impressum, auf Rechnungen und in der Widerrufsbelehrung. " +
        "Noch wird nichts davon veröffentlicht. Leere Felder bleiben leer.",
      save: "Speichern",
      saving: "Wird gespeichert …",
      saved: "Gespeichert.",
      saveFailed: "Das konnte nicht gespeichert werden.",
      noneYet: "— noch nicht gesetzt",

      sellerHeading: "Verkäufer",
      sellerHint:
        "Wer der Verkäufer rechtlich ist. Pflichtangaben nur, soweit sie auf dich zutreffen: " +
        "ohne Registereintrag bleibt das Registerfeld leer.",
      legalName: "Rechtlicher Name",
      legalNameHint: "Die natürliche oder juristische Person, die haftet.",
      tradingName: "Geschäftsname",
      tradingNameHint: "Unter welchem Namen verkauft wird. Steht später im Impressum.",
      legalForm: "Rechtsform",
      street: "Straße und Hausnummer",
      postalCode: "PLZ",
      city: "Ort",
      countryCode: "Land (2 Buchstaben)",
      phone: "Telefon",
      phoneHint: "Optional. Vorgeschrieben ist ein zweiter schneller Kanal, kein Telefon.",
      directContact: "Zweiter Kontaktweg",
      directContactHint: "Was Kunden außer der E-Mail schnell erreicht.",
      registerCourt: "Registergericht",
      registerNumber: "Registernummer",
      vatId: "USt-IdNr.",
      wId: "Wirtschafts-Identifikationsnummer",
      wIdHint: "Falls dir eine zugeteilt wurde — sie gehört dann ins Impressum.",

      contactHeading: "Kontakt",
      contactHint:
        "Zwei verschiedene Zuständigkeiten. Fragen zu einer Bestellung beantwortet der Verkäufer, " +
        "Fragen zum Konto oder zur Website die Plattform.",
      sellerContact: "Verkäuferkontakt",
      sellerContactHint: "Der Verkäufer — Bestellungen, Ware, Versand.",
      withdrawalContact: "Widerruf",
      complaintsContact: "Reklamationen",
      fallbackHint: "Leer lassen heißt: es gilt der Verkäuferkontakt. Aktuell:",

      taxHeading: "Steuern",
      smallBusiness: "Kleinunternehmerregelung nach § 19 UStG",
      smallBusinessHint:
        "Es wird keine Umsatzsteuer ausgewiesen. „inkl. MwSt.“ wäre dann falsch. " +
        "Differenzbesteuerung nach § 25a wird nicht verwendet.",

      shippingHeading: "Versand",
      shippingHint:
        "Wohin geliefert wird, entscheidet der Server. Die Kasse zeigt nur an, was hier " +
        "freigeschaltet ist — das Formular allein schaltet kein Land frei.",
      countryEnabled: "Aktiv — deaktivieren",
      countryDisabled: "Inaktiv — aktivieren",
      threshold: "Versandkostenfrei ab (€)",
      dispatch: "Versandaussage",
      dispatchHint: "Leer lassen, solange keine Lieferzeit zugesagt werden kann.",

      withdrawalHeading: "Widerruf & Reklamationen",
      withdrawalHint:
        "Gilt für den gesetzlichen Widerruf von Waren. Die Widerrufsbelehrung selbst " +
        "entsteht erst mit Legal V1.",
      returnPostage: "Rücksendekosten im Widerrufsfall",
      postageCustomer: "Der Kunde trägt sie",
      postageSeller: "Ich übernehme sie",
      dispute: "Freiwillig an der Verbraucherschlichtung teilnehmen",
      disputeHint:
        "Die Pflicht zur Aussage entsteht erst über zehn Beschäftigten. Aus bleibt heißt " +
        "nur: keine freiwillige Teilnahme.",
      disputeBody: "Zuständige Schlichtungsstelle",
    },

    /** Plattformdaten (ADR-0064). Andere Pflicht, andere Adresse. */
    platform: {
      heading: "Plattformdaten",
      hint:
        "Wer SkyIsles betreibt. Diese Adresse beantwortet Fragen zur Plattform selbst — " +
        "Datenschutz, Konto, Beschwerden. Fragen zu einer Bestellung gehen an den Verkäufer. " +
        "Beides darf heute dieselbe Adresse sein.",
      contactEmail: "Plattform-E-Mail",
      /* Die Supportadresse von SkyIsles — eine Plattformangabe, deshalb hier
         und nicht bei den Verkäuferangaben (ADR-0077). */
      supportEmail: "Support-E-Mail",
      supportEmailHint:
        "Für Fragen zu SkyIsles selbst: Konto, Datenschutz, Website. Fragen zu einer Bestellung " +
        "beantwortet der Verkäufer. Leer lassen, solange es keine Adresse gibt.",
      contactEmailHint:
        "Erscheint später im Impressum und in der Datenschutzerklärung. Steht in keiner " +
        "Bestellmail.",
      save: "Speichern",
      saved: "Gespeichert.",
      invalidEmail: "Das sieht nicht nach einer E-Mail-Adresse aus.",
      saveFailed: "Das hat nicht geklappt.",
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

    /* ------------------------------------------------------------------
       Testkonten und ihre Test-Berechtigungen (ADR-0071).

       Ein eigener Block neben `commerce`, weil ein Tester seit 0036 nicht
       mehr „darf im Testmodus bestellen" heißt: Commerce ist eine von
       mehreren Berechtigungen, und die Namen der Berechtigungen stehen in
       der Datenbank, nicht hier.
       ------------------------------------------------------------------ */
    testers: {
      heading: "Testkonten",
      hint:
        "Ausdrücklich benannte Testkonten. Jede Berechtigung gilt für sich: sie gewährt nur, " +
        "was sie nennt, und niemals Adminrechte. Adminrechte allein machen niemanden zum Tester.",
      empty: "Noch kein Testkonto.",
      permissionsHeading: "Test-Berechtigungen",
      noPermissions: "Keine Berechtigung — das Konto steht auf der Liste und darf nichts.",
      isAdmin: "Admin",
      remove: "Testkonto entfernen",
      removeHint: "Entfernt nur den Testerstatus und dessen Berechtigungen. Das Konto bleibt.",
      searchLabel: "Konto suchen",
      searchPlaceholder: "Benutzername oder E-Mail",
      searchHint:
        "Die Suche findet nur das richtige Konto. Zum Testkonto wird das Konto, nicht die Adresse.",
      searchEmpty: "Kein Konto gefunden.",
      searchTooShort: "Mindestens drei Zeichen.",
      add: "Als Testkonto hinzufügen",
      alreadyTester: "Ist bereits Testkonto",
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
      /** Was „offen" bedeutet — einmal ausgeschrieben, wo der Filter steht. */
      openOnlyHint: "Alles, was noch nicht abgeschlossen ist.",
      inFlightCount: (n: number) =>
        n === 1 ? "1 Zahlung offen" : `${n} Zahlungen offen`,

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
        /**
         * Nicht mehr „Offen" (ADR-0063): Der Filter darüber heißt „Nur offene",
         * und dasselbe Wort für zwei verschiedene Dinge, zwei Zeilen
         * voneinander entfernt, war genau der Fehler. Derselbe Wortlaut wie in
         * der Kundenansicht (`account.orders.statusLabel.awaiting_payment`).
         */
        in_flight: "Zahlung offen",
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

      /**
       * Die Positionstabelle beim Kommissionieren (ADR-0074).
       *
       * Jede Spalte kommt aus dem Bestell-Snapshot, nie aus dem aktuellen
       * Katalog: eine Umbenennung von heute darf eine Bestellung von gestern
       * nicht umschreiben (ADR-0033).
       */
      lineImage: "Bild",
      lineFigure: "Figur",
      lineSeries: "Serie",
      lineCondition: "Zustand",
      lineQuantity: "Stückzahl",
      lineTotal: "Gesamt",
      /* Bestellungen vor 0039 haben keine Serie gespeichert. Sie aus dem
         heutigen Katalog nachzuschlagen wäre eine Behauptung über die
         Vergangenheit, also steht hier ein Strich. */
      lineSeriesUnknown: "—",
      lineNoImage: "Kein Bild",
      conditionLoose: "Lose",
      conditionBoxed: "OVP",

      /**
       * Der Hinweis, der Geld schützt — und seit 0043 auch sagt, was zu tun
       * ist (ADR-0079).
       *
       * Vorher stand hier nur, dass geprüft werden muss und der Versand
       * gesperrt ist. Ein Verkäufer konnte eine bezahlte Bestellung bekommen
       * und hatte keinen einzigen Weg weiter. Die Ursachen sind zwei
       * verschiedene Probleme und bekommen zwei verschiedene Texte.
       */
      needsResolutionTitle: "Diese Bestellung muss geprüft werden",
      needsResolutionHint:
        "Vor dem Versand muss dieser Punkt geklärt sein. Solange er offen ist, bleibt der " +
        "Versand gesperrt.",

      /* Zahlung kam an, nachdem die Reservierung abgelaufen war. Das Geld ist
         echt, der Bestand wurde nie abgebucht. */
      reviewLateTitle: "Bestand wurde bei der Zahlung nicht abgebucht",
      reviewLateHint:
        "Die Zahlung ist eingegangen, nachdem die Reservierung abgelaufen war. Die Ware wurde " +
        "deshalb nie vom Lager abgezogen. Wenn sie noch da ist, kannst du sie jetzt nachbuchen — " +
        "danach ist der Versand frei.",
      reviewResolve: "Bestand nachbuchen und freigeben",
      reviewResolving: "Wird gebucht …",
      reviewShortTitle: "Dafür reicht der Bestand nicht",
      reviewShortHint:
        "Für mindestens eine Position ist zu wenig auf Lager. Buche zuerst Ware zu — im " +
        "Lagerbestand — oder erstatte die Bestellung. Nachbuchen ist erst möglich, wenn alle " +
        "Positionen gedeckt sind.",
      reviewMismatchTitle: "Der gezahlte Betrag passt nicht zur Bestellung",
      reviewMismatchHint:
        "Das ist eine Geldfrage und lässt sich nicht über den Bestand lösen. Kläre die Zahlung " +
        "beim Zahlungsanbieter — Erstattung oder Korrektur — bevor versendet wird.",
      reviewUnknownHint:
        "Der Grund ist nicht mehr nachvollziehbar. Prüfe Zahlung und Bestand, bevor du " +
        "versendest.",
      reviewNeeded: "Benötigt",
      reviewAvailable: "Verfügbar",
      reviewResolved: "Gebucht. Der Versand ist jetzt frei.",
      reviewRefused: "Das war so nicht möglich. Die Bestellung bleibt gesperrt.",
      reviewFailed: "Das konnte nicht gebucht werden.",

      /** Versandaktion. */
      shipHeading: "Versand",
      shipAction: "Als versendet markieren",
      shipping_: "Wird markiert …",
      trackingLabel: "Trackingnummer (optional)",
      /* Seit 0023 ist die Nummer jederzeit änderbar — vorher wie nachher. Der
         frühere Hinweis beschrieb eine Sperre, die es seitdem nicht mehr gibt
         (ADR-0074). */
      trackingHint: "Wird unverändert gespeichert und ist jederzeit änderbar.",
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
       * Versandstatus — ein Zustand, keine unumkehrbare Aktion (ADR-0074).
       *
       * Die frühere Rückfrage stand vor der „einzigen unumkehrbaren Aktion des
       * Systems" und nannte sie auch so. Seit 0039 ist sie umkehrbar:
       * `unfulfilled ↔ shipped`. Eine Rückfrage für einen Schalter, der in
       * beide Richtungen geht, macht einen harmlosen Vorgang bedrohlich — und
       * eine falsch gesetzte Markierung ist jetzt in einem Klick korrigiert,
       * statt in einer Datenbanksitzung.
       *
       * „Versendet" ist eine Auskunft an den Kunden, kein Geld- und kein
       * Bestandsereignis. Zahlung, Bestand, Positionen und Beträge bleiben
       * unberührt.
       */
      statusHeading: "Versandstatus",
      statusUnfulfilled: "Nicht versendet",
      statusShipped: "Versendet",
      unshipAction: "Als nicht versendet markieren",
      unshipping: "Wird zurückgesetzt …",
      unshipFailed: "Der Versandstatus konnte nicht zurückgesetzt werden.",
      statusHint:
        "Der Versandstatus ist eine Auskunft an den Kunden und jederzeit in beide Richtungen " +
        "änderbar. Zahlung, Bestand, Positionen und Beträge bleiben davon unberührt.",
      statusKeepsTracking:
        "Die Sendungsnummer bleibt gespeichert. Entfernen kannst du sie oben.",
      shipSucceeded: (number: string) => `Bestellung ${number} ist als versendet markiert.`,
      unshipSucceeded: (number: string) =>
        `Bestellung ${number} ist wieder als nicht versendet markiert.`,

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
    history: "Historie",
    noHistory: "Noch keine Bewegungen.",

    /* Lager V2 — die Dreiergruppe über der Karte. */
    purchased: "Eingekauft",
    sold: "Verkauft",
    stockLabel: "Bestand",

    /* Der Entwurf: −/+ ändern erst nur eine Zahl auf dem Schirm. */
    draftSave: "Bestand speichern",
    draftDiscard: "Verwerfen",
    draftPending: (delta: number) =>
      `${delta > 0 ? "+" : "−"}${Math.abs(delta)} noch nicht gespeichert`,
    draftReserved: (n: number) => `${n} reserviert`,

    /* Die Historientabelle. */
    historyCount: (n: number) => (n === 1 ? "1 Eintrag" : `${n} Einträge`),
    historyLoading: "Historie wird geladen …",
    historyDate: "Datum",
    historyKind: "Typ",
    historyBooking: "Buchung",
    historyAmount: "Menge",
    historyValue: "Marktwert",
    historyLegacy: "Historisch",
    historyLegacyMark: "rekonstruiert",
    historyOperativeMark: "gebucht",
    historyNoValue: "—",
    historySource: (sheet: string, row: number) => `${sheet}, Zeile ${row}`,
    historyHint:
      "Älteste oben, neueste unten. ○ rekonstruiert, ● gebucht. Zeile antippen zeigt die " +
      "Quelle. Ein laufender historischer Bestand wird daraus bewusst nicht berechnet.",

    /* Ereignisarten der rekonstruierten Historie (ADR-0102). */
    legacyKinds: {
      opening_balance: "Startbestand",
      purchase: "Einkauf",
      sale: "Verkauf",
      correction: "Korrektur",
      legacy_adjustment: "Bestandsabgleich",
    } as Record<string, string>,
    noPositions: "Noch keine Lagerposition.",
    empty: "Keine Position gefunden.",
    emptyHint: "Suche nach einem Namen oder einer SKY-ID, um Bestand anzulegen.",
    outsideScope: (n: number) =>
      `${n} historische Position${n === 1 ? "" : "en"} außerhalb des Sortiments (Auditdaten, unverändert).`,
    reasons: {
      purchase: "Einkauf",
      sale: "Verkauf",
      /**
       * Historie. Bis 0025 hieß derselbe Vorgang so (ADR-0065). Der Eintrag
       * bleibt, sonst zeigt die Bewegungsliste für alte Zeilen einen leeren
       * Grund — umbenennen lässt sich die Historie nie.
       */
      sale_skyisles: "Verkauf SkyIsles (historisch)",
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
    /** Die Handelszeile auf der Katalogkarte (V3.2) — verkäuferneutral. */
    /** Die Silberplatte, wenn gerade niemand anbietet. Ruhig, nicht defekt. */
    noOffer: "Aktuell kein Angebot",
    offersFrom: (price: string) => `Angebote ab ${price}`,
    /** Dieselbe Zeile, aber getrennt — der Preis wird schwerer gesetzt (V3.2). */
    offersFromLabel: "Angebote ab",
    offersFor: (name: string) => `Angebote für ${name} ansehen`,
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
      /* Der Verkäufername kommt aus `seller_public()`; ohne ihn steht hier die
         neutrale Fassung, nie ein geratener Name (ADR-0075). */
      intro: (name: string) =>
        `Diese Figuren verkauft ${name} über SkyIsles — kein Marktplatz, ein Verkäufer. ` +
        "Versand innerhalb Deutschlands, ab 75 € Warenwert versandkostenfrei.",
      introFallback:
        "Diese Figuren verkauft der Verkäufer dieses Shops über SkyIsles — kein Marktplatz, " +
        "ein Verkäufer. Versand innerhalb Deutschlands, ab 75 € Warenwert versandkostenfrei.",
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

  /**
   * Die Schnellansicht über dem Katalog (IR-001).
   *
   * Sie ersetzt den Sprung auf die Detailseite für den häufigsten Fall: „was
   * kostet das und kann ich es kaufen". Die Detailseite bleibt und wird aus
   * dem Dialog heraus ausdrücklich angeboten — sie zeigt Charakter, Element
   * und verwandte Figuren, die hier absichtlich fehlen.
   *
   * Kein Verkäufername, keine Bewertung, keine Lieferzeit, keine
   * Versandkosten: nichts davon liegt in den Daten, die die Karte hat.
   */
  /**
   * Die gemeinsame Browse-Navigation von Katalog und Sammlung (V3.3).
   *
   * Beide Seiten stellen dieselbe Frage — „was sehe ich, und was kann ich
   * daran einschränken" — und beschrifteten sie bisher getrennt.
   */
  browse: {
    filter: "Filter",
    filterHeading: "Filter",
    filterClose: "Filter schließen",
    filterReset: "Filter zurücksetzen",
    /** Für Screenreader: „· 2" ist kein Satz. */
    filterActive: (n: number) =>
      n === 1 ? "1 Filter aktiv" : `${n} Filter aktiv`,
  },

  quickView: {
    close: "Schnellansicht schließen",
    toDetail: "Vollständige Details ansehen",
    toDetailFor: (name: string) => `Detailseite für ${name} öffnen`,
    /**
     * Die Überschrift der Angebotsliste.
     *
     * Heute immer „Angebot": `shop_inventory` hat einen Unique-Index auf
     * (sky_id, condition), und die Schnellansicht handelt nur mit „Lose" —
     * es kann also höchstens eines geben. Die gezählte Form steht bereit,
     * weil ein zweiter Verkäufer sie braucht und eine Überschrift, die dann
     * falsch wäre, schlimmer ist als eine, die heute nie erscheint.
     */
    offersCount: (n: number) => (n === 1 ? "Angebot" : `Angebote (${n})`),
    /**
     * Die Rolle des Verkäufers unter seinem Namen.
     *
     * Eine Plattformaussage, keine Spalte: auf SkyIsles verkaufen ausschließlich
     * gewerbliche Verkäufer — private Verkäufer sind ausdrücklich nicht
     * vorgesehen (ADR-0021, ADR-0064). Deshalb ist der Satz für jeden Verkäufer
     * wahr und muss nicht je Zeile gespeichert werden. Sollte es je private
     * Verkäufer geben, wird daraus eine Spalte und dieser Text ein Feld.
     *
     * Der NAME daneben kommt aus seller_public() und steht bewusst nirgends
     * im Code.
     */
    sellerKind: "Gewerblicher Verkäufer",
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
    /**
     * Nur für GÄSTE (ADR-0061). Angemeldet liegt der Warenkorb in
     * `cart_items` und gilt geräteübergreifend — der alte, unbedingte Satz
     * sagte dort das Gegenteil dessen, was die Anmeldung gerade gebracht hat.
     *
     * Formuliert als Grund, nicht als Einschränkung: Was der Gast verliert,
     * steht im ersten Satz, was er dagegen tun kann, im zweiten.
     */
    guestOnly: "Dieser Warenkorb liegt nur in diesem Browser.",
    guestOnlyHint: "Melde dich an, damit er auf deinen Geräten erhalten bleibt.",
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
      /**
       * Der aktuelle Versandstatus, nicht der höchste je erreichte (ADR-0074).
       *
       * Seit 0039 kann ein Versand zurückgenommen werden, wenn er versehentlich
       * markiert wurde. Die Sendungsnummer bleibt dabei stehen — sie ist eine
       * Tatsache über ein gekauftes Label, der Status eine Auskunft. Beides
       * gleichzeitig zu sehen („Nicht versendet" und eine Nummer) ist deshalb
       * richtig und kein Widerspruch.
       *
       * Eigene Liste statt `de.admin.orders.fulfillmentStatus`: dieselben
       * Wörter, aber die Kundenansicht borgt sich keine Adminzeichenkette.
       */
      shipmentStatus: "Versandstatus",
      fulfillmentStatus: {
        unfulfilled: "Nicht versendet",
        preparing: "In Vorbereitung",
        shipped: "Versendet",
        completed: "Abgeschlossen",
        cancelled: "Storniert",
      } as Record<string, string>,
      /* Rechnung und Widerruf, auf der Bestellung selbst (ADR-0086). */
      documents: "Dokumente und Rechte",
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
      hint: "Passwort und Zugangsdaten.",
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

    /**
     * Nur Testkonten sehen das — und sie müssen es sehen.
     *
     * Ein Testkonto bezahlt immer in der Stripe-Sandbox, auch wenn der Shop
     * für Kundschaft längst live ist (0077). Wer gleich Kartendaten eingibt,
     * muss vorher wissen, dass kein echtes Geld fließt.
     */
    sandboxHeading: "Testzahlung",
    sandboxBody:
      "Dieses Konto ist ein Testkonto. Die Zahlung läuft über die " +
      "Stripe-Sandbox, es wird kein echtes Geld abgebucht.",
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
    /*
     * Wer liefert — und das ist nicht die Plattform (ADR-0086). Der frühere
     * Satz lautete „SkyIsles liefert derzeit nur innerhalb Deutschlands" und
     * machte die Plattform zum Versender. Versendet wird vom Verkäufer.
     */
    countryHint: "Es wird derzeit nur innerhalb Deutschlands geliefert.",

    /** Nur für angemeldete Konten; ein Gast hat keinen Ort dafür (ADR-0061). */
    saveDefault: "Diese Angaben für künftige Bestellungen speichern",
    saveDefaultHint:
      "Sie werden dann an der Kasse vorausgefüllt. Du kannst sie jederzeit unter " +
      "„Kontakt & Lieferadresse“ ändern oder löschen. Diese Bestellung behält die " +
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
      /**
       * Wer verkauft — und das ist nicht SkyIsles (ADR-0064, ADR-0075).
       *
       * Der frühere Satz nannte SkyIsles als Verkäufer. Er sollte klarstellen, dass
       * dies kein Marktplatz ist, und tat das, indem er den falschen
       * Vertragspartner nannte — auf dem letzten Bildschirm vor der Zahlung.
       * Beides lässt sich zugleich richtig sagen.
       *
       * Der Name kommt aus `seller_public()`, nicht aus dieser Datei.
       */
      seller: (name: string) =>
        `${name} ist dein Vertragspartner für diese Bestellung und versendet die Ware. ` +
        "SkyIsles stellt Katalog, Konto und Kasse bereit und vermittelt nicht zwischen Händlern.",
      sellerFallback:
        "Die Ware wird vom Verkäufer dieses Shops verkauft und versendet. SkyIsles stellt " +
        "Katalog, Konto und Kasse bereit und vermittelt nicht zwischen Händlern.",
      sellerLabel: "Verkauf durch",
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
      /**
       * Die Rechtsangaben unmittelbar vor der Bestellung (ADR-0086).
       *
       * § 312j Abs. 2 BGB verlangt, dass die Angaben nach Art. 246a § 1 Abs. 1
       * Satz 1 Nr. 1, 5 bis 7, 8, 14 und 15 EGBGB „unmittelbar bevor der
       * Verbraucher seine Bestellung abgibt, klar und verständlich in
       * hervorgehobener Weise" bereitstehen. Dieser Block ist diese Stelle.
       *
       * Nr. 1 (wesentliche Eigenschaften) steht in der Zusammenfassung
       * darüber, Nr. 5 und 7 (Gesamtpreis, Versandkosten) ebenfalls. Nr. 6
       * entfällt: es gibt keine personalisierte Preisbildung. Nr. 8, 14 und 15
       * betreffen Dauerschuldverhältnisse — hier wird einmal gekauft.
       *
       * Frühere Fassung: an dieser Stelle stand, die Rechtstexte „werden vor
       * der öffentlichen Beta ergänzt". Das war eine Entwicklernotiz in der
       * Kasse eines echten Kunden. Jetzt stehen die Texte da.
       */
      legalLabel: "Bedingungen",
      legalIntro:
        "Mit der Bestellung gelten unsere AGB. Ein Widerrufsrecht steht dir zu; wie es " +
        "ausgeübt wird, steht in der Widerrufsbelehrung.",
      legalAgb: "AGB",
      legalWithdrawal: "Widerrufsbelehrung",
      legalPrivacy: "Datenschutz",
      legalShipping: "Versand",
      /* Datenschutz ist Information, keine Einwilligung — deshalb ein Link und
         kein Kästchen zum Ankreuzen. */
      legalPrivacyNote:
        "Wie wir deine Daten für diese Bestellung verarbeiten, steht in der " +
        "Datenschutzerklärung.",

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
        "„Meine Bestellungen“.",
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
      invalid_country: "Es wird derzeit nur nach Deutschland geliefert.",
      invalid_shipping_method: "Bitte wähle eine Versandart.",
    },
  },

  nav: {
    primary: "Hauptnavigation",
    catalog: "Katalog",
    collection: "Sammlung",
    /**
     * Die beiden Kopfzeilen-Aktionen (V3.4.2).
     *
     * Getrennte Ziele, deshalb getrennte Namen: `profile` führt auf die
     * eigene Sammleridentität, `account` auf den Kontobereich. Der Schlüssel
     * hiess bis V3.4.1 `settings` und trug den Wert „Profil" — solange es nur
     * eine Aktion gab, fiel das nicht auf; mit zweien wäre es irreführend.
     *
     * `profileOf` wird gelesen, wenn der Benutzername sichtbar danebensteht:
     * ein `aria-label` ersetzt den sichtbaren Text vollständig, also muss es
     * ihn mitnehmen, sonst hört ein Screenreader den Namen gar nicht.
     */
    profile: "Profil",
    profileOf: (name: string) => `Profil: ${name}`,
    account: "Mein Konto",
    signOut: "Abmelden",
    signIn: "Anmelden",
    /** Nur für Plattform-Administratoren sichtbar (ADR-0039, ADR-0077). */
    admin: "Admin",
    /** Der Shop. Nur für Konten mit Shopzugang — nicht für Admins (ADR-0077). */
    business: "Shop",
    /** Lagerverwaltung des Verkäufers. Nur mit Shopzugang. */
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
      /* Nach erfolgreichem Zurücksetzen: die Recovery-Sitzung ist beendet,
         und das neue Passwort wird hier zum ersten Mal benutzt (ADR-0094). */
      changed: "Dein Passwort wurde geändert. Melde dich jetzt mit dem neuen Passwort an.",
      title: "Neues Passwort setzen",
      submit: "Passwort speichern",
      done: "Dein Passwort wurde geändert.",
    },
    onboarding: {
      title: "Wähle deinen Benutzernamen",
      intro:
        "Der Benutzername ist deine Anzeigeidentität. Du kannst ihn später jederzeit ändern.",
      submit: "Benutzernamen speichern",
      /*
       * Ein Hinweis für alle, nicht zwei (0051).
       *
       * Die Seite darf den Kontotyp nicht kennen — Abmelden gehört zum Konto,
       * nicht zur Rolle, und `three-accounts.test.ts` hält das fest. Ein Satz,
       * der die Ausnahme benennt statt sie zu verschweigen, sagt einem
       * Sammlerkonto trotzdem nicht, Punkte seien erlaubt. Der genaue Grund
       * steht in der Fehlermeldung, wo er gebraucht wird.
       *
       * Kein Beispielname: der Name des Verkäufers steht nirgends im Text
       * (ADR-0080).
       */
      hint:
        "3 bis 20 Zeichen, Buchstaben, Ziffern und Unterstriche. " +
        "Shopkonten dürfen zusätzlich Punkte zwischen den Namensteilen führen.",
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
      /*
       * Der Name ist in Ordnung — das Konto darf ihn nur nicht führen. Ein
       * „ungültige Zeichen" wäre hier falsch und würde zum Weiterprobieren
       * einladen (0051).
       */
      usernameBusinessOnly:
        "Ein Punkt im Benutzernamen ist nur für Shopkonten möglich. " +
        "Für dieses Konto sind Buchstaben, Ziffern und Unterstriche erlaubt.",
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
