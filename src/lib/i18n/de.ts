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
