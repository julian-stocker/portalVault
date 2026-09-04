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
    name: "PortalVault",
    tagline: "Die Plattform für Skylanders-Sammler",
    description:
      "Katalog, Marktpreise und persönliche Sammlungsverwaltung für Skylanders.",
  },

  dashboard: {
    // Split so the username can be highlighted without inlining German in JSX.
    signedInAs: "Angemeldet als",
  },

  nav: {
    dashboard: "Übersicht",
    settings: "Einstellungen",
    signOut: "Abmelden",
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
