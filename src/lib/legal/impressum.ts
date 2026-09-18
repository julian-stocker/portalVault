/**
 * Impressum — § 5 DDG (ADR-0086).
 *
 * The DDG replaced the TMG in 2024; this cites the DDG and never "§ 5 TMG".
 *
 * WHAT IS HERE IS WHAT EXISTS. § 5 Abs. 1 DDG lists register details and the
 * VAT identification number as duties "soweit vorhanden". There is no register
 * entry, so none is claimed. There is no published telephone number, so none
 * is invented — Nr. 2 requires details that allow fast electronic contact,
 * and an e-mail address is given.
 *
 * THE THREE NAMES ARE EXPLAINED RATHER THAN LISTED. A reader who sees
 * "SkyIsles", "yulez.collectibles" and "Julian Stocker" on one page will
 * reasonably wonder how many businesses they are dealing with. The answer —
 * one — is the most useful sentence on the page, so it is near the top.
 */
import type { LegalDocument } from "@/lib/legal/documents";
import { LEGAL_VERSIONS } from "@/lib/legal/documents";
import { SELLER_IDENTITY as S } from "@/lib/legal/seller-identity";

export const IMPRESSUM: LegalDocument = {
  slug: "impressum",
  title: "Impressum",
  lead: "Angaben nach § 5 DDG.",
  version: LEGAL_VERSIONS.impressum,
  sections: [
    {
      heading: "Anbieter und Verantwortlicher",
      blocks: [
        {
          kind: "pairs",
          pairs: [
            ["Name", S.legalName],
            ["Geschäftsbezeichnung", S.tradeName],
            ["Rechtsform", S.legalForm],
            ["Anschrift", `${S.street}, ${S.postalCode} ${S.city}, ${S.country}`],
            ["E-Mail", S.email],
            ["Umsatzsteuer-Identifikationsnummer", S.vatId],
          ],
        },
      ],
    },
    {
      heading: "SkyIsles, yulez.collectibles und Julian Stocker",
      blocks: [
        {
          kind: "text",
          paragraphs: [
            `${S.platformName} ist die Plattform: Katalog, Benutzerkonten, Sammlungsverwaltung ` +
              "und Kasse. " +
              `${S.tradeName} ist die Geschäftsbezeichnung, unter der über diese Plattform ` +
              "verkauft wird.",
            "Beides wird von derselben Person betrieben. Es handelt sich um **ein** " +
              `Einzelunternehmen von ${S.legalName} und nicht um zwei Unternehmen oder zwei ` +
              "Gesellschaften.",
            "Vertragspartner bei einem Kauf über diesen Shop ist deshalb immer " +
              `**${S.contractingParty}**.`,
          ],
        },
      ],
    },
    {
      heading: "Telefon",
      blocks: [
        {
          kind: "text",
          paragraphs: [
            "Es gibt keine veröffentlichte Telefonnummer. Anfragen werden per E-Mail an " +
              `${S.email} beantwortet.`,
          ],
        },
      ],
    },
    {
      heading: "Umsatzsteuer",
      blocks: [
        {
          kind: "text",
          paragraphs: [
            "Als Kleinunternehmer im Sinne des § 19 UStG sind die Umsätze steuerfrei. " +
              "Umsatzsteuer wird daher nicht ausgewiesen.",
          ],
        },
      ],
    },
    {
      heading: "Verbraucherstreitbeilegung",
      blocks: [
        {
          kind: "text",
          paragraphs: [
            "Zur Teilnahme an einem Streitbeilegungsverfahren vor einer " +
              "Verbraucherschlichtungsstelle sind wir weder bereit noch verpflichtet.",
          ],
        },
      ],
    },
    {
      heading: "Inhalte und Urheberrecht",
      blocks: [
        {
          kind: "text",
          paragraphs: [
            "Die Inhalte dieser Website wurden mit Sorgfalt erstellt. Für die Richtigkeit, " +
              "Vollständigkeit und Aktualität der Inhalte kann keine Gewähr übernommen werden.",
            "„Skylanders“ und die zugehörigen Bezeichnungen und Figuren sind Marken bzw. " +
              "urheberrechtlich geschützte Werke der jeweiligen Rechteinhaber. SkyIsles steht " +
              "in keiner Verbindung zu diesen und verkauft ausschließlich gebrauchte oder " +
              "originalverpackte Einzelstücke aus eigenem Bestand.",
          ],
        },
      ],
    },
  ],
};
