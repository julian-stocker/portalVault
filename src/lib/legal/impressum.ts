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
 * THE THREE NAMES ARE EXPLAINED RATHER THAN LISTED. A reader who sees the
 * platform, the shop brand and the operator's name on one page will
 * reasonably wonder how many businesses they are dealing with. The answer —
 * one — is the most useful sentence on the page, so it is near the top.
 *
 * FROM THE SELLER ROW (ADR-0184, AP5). Every name, address and number comes
 * from `seller_legal_public()` through `LegalSeller`; this file knows none of
 * them. A detail that exists only "soweit vorhanden" (VAT ID, W-IdNr.,
 * register) is listed only when the row carries it. The prose around the data
 * is the 2026-09-17 wording with the names substituted; the earlier text is
 * archived unchanged.
 */
import type { LegalDocument } from "@/lib/legal/documents";
import { LEGAL_VERSIONS } from "@/lib/legal/documents";
import type { LegalSeller } from "@/lib/legal/seller-text";

/** Label/value pairs; a value that does not exist is left out, not blanked. */
function providerPairs(S: LegalSeller): (readonly [string, string])[] {
  const pairs: (readonly [string, string])[] = [
    ["Name", S.legalName],
    ["Geschäftsbezeichnung", S.displayName],
    ["Rechtsform", S.legalForm],
    ["Anschrift", `${S.street}, ${S.postalCode} ${S.city}, ${S.country}`],
    ["E-Mail", S.email],
  ];
  // As stored, under a neutral label: no claim about what kind of channel it is.
  if (S.directContact) pairs.push(["Weiterer Kontakt", S.directContact]);
  if (S.vatId) pairs.push(["Umsatzsteuer-Identifikationsnummer", S.vatId]);
  if (S.wId) pairs.push(["Wirtschafts-Identifikationsnummer", S.wId]);
  if (S.registerCourt) pairs.push(["Registergericht", S.registerCourt]);
  if (S.registerNumber) pairs.push(["Registernummer", S.registerNumber]);
  return pairs;
}

/** Title and lead, for page metadata — they name no seller. */
export const IMPRESSUM_HEAD = { title: "Impressum", lead: "Angaben nach § 5 DDG." } as const;

export const buildImpressum = (S: LegalSeller): LegalDocument => ({
  slug: "impressum",
  title: IMPRESSUM_HEAD.title,
  lead: IMPRESSUM_HEAD.lead,
  version: LEGAL_VERSIONS.impressum,
  sections: [
    {
      heading: "Anbieter und Verantwortlicher",
      blocks: [
        {
          kind: "pairs",
          pairs: providerPairs(S),
        },
      ],
    },
    {
      heading: `${S.platformName}, ${S.displayName} und ${S.legalName}`,
      blocks: [
        {
          kind: "text",
          paragraphs: [
            `${S.platformName} ist die Plattform: Katalog, Benutzerkonten, Sammlungsverwaltung ` +
              "und Kasse. " +
              `${S.displayName} ist die Geschäftsbezeichnung, unter der über diese Plattform ` +
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
    /*
     * Only while no further contact channel is stored. With `direct_contact`
     * set, "there is no published telephone number" could be false — the field
     * may hold one — so the section is left out rather than guessed at, and
     * the channel stands in the list above.
     */
    ...(S.directContact ? [] : [{
      heading: "Telefon",
      blocks: [
        {
          kind: "text" as const,
          paragraphs: [
            "Es gibt keine veröffentlichte Telefonnummer. Anfragen werden per E-Mail an " +
              `${S.email} beantwortet.`,
          ],
        },
      ],
    }]),
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
              `urheberrechtlich geschützte Werke der jeweiligen Rechteinhaber. ${S.platformName} steht ` +
              "in keiner Verbindung zu diesen und verkauft ausschließlich gebrauchte oder " +
              "originalverpackte Einzelstücke aus eigenem Bestand.",
          ],
        },
      ],
    },
  ],
});
