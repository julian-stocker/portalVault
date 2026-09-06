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
    ownedFilter: "Besitz anzeigen",
    /** Wenn der Filter aus ist und trotzdem nichts fehlt. */
    ownedEmpty: "Aus dieser Serie besitzt du bereits alles.",
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

  nav: {
    primary: "Hauptnavigation",
    catalog: "Katalog",
    collection: "Sammlung",
    settings: "Profil",
    signOut: "Abmelden",
    signIn: "Anmelden",
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
