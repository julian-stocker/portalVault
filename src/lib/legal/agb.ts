/**
 * AGB (ADR-0086).
 *
 * THE CONTRACT MODEL IS THE POINT OF THIS DOCUMENT, and it was chosen to match
 * the code rather than the other way round:
 *
 *   order        the customer's binding offer
 *   § 312i mail  acknowledgement of receipt — explicitly NOT an acceptance
 *   payment      performance by the customer, not an acceptance
 *   confirmation the seller's acceptance → the contract exists
 *
 * Nothing in the implementation had to be bent to fit it. One thing had to be
 * added, because it was missing and the law requires it: the acknowledgement
 * of receipt (§ 312i Abs. 1 Nr. 3 BGB). Before this round a customer whose
 * payment hung received no message at all.
 *
 * WHAT IS DELIBERATELY NOT IN HERE. No choice of court, no arbitration clause,
 * no liability cap, no exclusion of statutory defect rights, no clause about
 * "Aufrechnung" or "Zurückbehaltung" against a consumer, no shortened
 * limitation period. Those appear in most German webshop templates; none of
 * them is needed to sell a figure to a consumer, and several would be void.
 * A clause that would be struck out is worse than no clause: it makes the
 * document look copied.
 */
import type { LegalDocument } from "@/lib/legal/documents";
import { LEGAL_VERSIONS } from "@/lib/legal/documents";
import { SELLER_IDENTITY as S } from "@/lib/legal/seller-identity";

export const AGB: LegalDocument = {
  slug: "agb",
  title: "Allgemeine Geschäftsbedingungen",
  lead: `Für Käufe über ${S.platformName}. Fassung vom 17. September 2026.`,
  version: LEGAL_VERSIONS.agb,
  sections: [
    {
      heading: "§ 1 Geltungsbereich und Vertragspartner",
      blocks: [
        {
          kind: "text",
          paragraphs: [
            "Diese Bedingungen gelten für alle Kaufverträge, die über den Shop auf " +
              `${S.platformName} zwischen dir und uns geschlossen werden.`,
            `Vertragspartner ist **${S.contractingParty}**, ${S.street}, ` +
              `${S.postalCode} ${S.city}, ${S.country}, E-Mail ${S.email}.`,
            `${S.platformName} ist die Plattform — Katalog, Konto, Sammlung und Kasse. ` +
              `${S.tradeName} ist die Geschäftsbezeichnung, unter der verkauft wird. Beides ` +
              `wird von ${S.legalName} als ein Einzelunternehmen betrieben; es sind nicht zwei ` +
              "Unternehmen.",
            `${S.platformName} ist **kein Marktplatz**. Es gibt genau einen Verkäufer, und das ` +
              "sind wir. Es werden keine Verträge zwischen dir und Dritten vermittelt.",
            "Diese Bedingungen gelten gegenüber Verbrauchern. Abweichende Bedingungen des " +
              "Kunden werden nicht Vertragsbestandteil, es sei denn, wir stimmen ihnen " +
              "ausdrücklich zu.",
          ],
        },
      ],
    },
    {
      heading: "§ 2 Angebot und Ware",
      blocks: [
        {
          kind: "text",
          paragraphs: [
            "Wir verkaufen Sammelfiguren und Zubehör als Einzelstücke, sowohl lose als auch " +
              "originalverpackt. Jedes Stück wird einzeln geprüft und beschrieben.",
            "Die Darstellung der Artikel im Shop ist kein rechtlich bindendes Angebot, sondern " +
              "eine Aufforderung an dich, eine Bestellung abzugeben.",
            "Maßgeblich für den Zustand ist die Angabe am Artikel (zum Beispiel „lose“ oder " +
              "„originalverpackt“). Da es sich überwiegend um gebrauchte Sammlerstücke handelt, " +
              "sind alters- und gebrauchsübliche Spuren möglich; erhebliche Abweichungen werden " +
              "am Artikel beschrieben.",
            "Jeder Artikel ist nur so lange bestellbar, wie er vorrätig ist. Wir führen jeden " +
              "Artikel in der Regel nur einmal.",
          ],
        },
      ],
    },
    {
      heading: "§ 3 Bestellvorgang und Vertragsschluss",
      blocks: [
        {
          kind: "text",
          paragraphs: [
            "Der Ablauf ist absichtlich einfach, und er ist genau so umgesetzt, wie er hier " +
              "beschrieben wird:",
          ],
        },
        {
          kind: "steps",
          items: [
            "Du legst Artikel in den Warenkorb und gibst an der Kasse deine Kontakt- und " +
              "Lieferdaten ein. Eingaben kannst du bis zum Absenden jederzeit korrigieren, " +
              "indem du die Felder änderst oder zum Warenkorb zurückgehst.",
            "Mit dem Klick auf die Schaltfläche **„Zahlungspflichtig bestellen“** gibst du ein " +
              "verbindliches Angebot zum Kauf der im Warenkorb enthaltenen Artikel ab.",
            "Unmittelbar danach bestätigen wir dir den **Eingang deiner Bestellung** per " +
              "E-Mail. Diese Eingangsbestätigung ist noch **keine Annahme** deines Angebots " +
              "und noch kein Vertragsschluss.",
            "Du wirst zur Zahlungsseite unseres Zahlungsdienstleisters weitergeleitet und " +
              "bezahlst dort. Auch die Zahlung ist noch keine Annahme; sie ist deine " +
              "Vorleistung auf den beabsichtigten Vertrag.",
            "Ist die Zahlung bestätigt und können wir die Bestellung erfüllen, senden wir dir " +
              "eine **Bestellbestätigung** per E-Mail. **Mit dem Zugang dieser " +
              "Bestellbestätigung kommt der Vertrag zustande.**",
          ],
        },
        {
          kind: "text",
          paragraphs: [
            "Kommt es nicht zur Zahlung, verfällt die Bestellung und die vorgemerkte Ware wird " +
              "wieder freigegeben. Ein Vertrag entsteht in diesem Fall nicht.",
            "Können wir eine bereits bezahlte Bestellung nicht erfüllen — etwa weil das " +
              "Einzelstück zwischenzeitlich verkauft wurde —, senden wir keine " +
              "Bestellbestätigung. Wir melden uns dann per E-Mail und erstatten den gezahlten " +
              "Betrag vollständig zurück. Ein Vertrag kommt in diesem Fall nicht zustande.",
            "Den Vertragstext speichern wir. Die zum Zeitpunkt deiner Bestellung geltende " +
              "Fassung dieser Bedingungen und der Widerrufsbelehrung wird deiner Bestellung " +
              "fest zugeordnet und in der Bestellbestätigung mitgeteilt. Eine spätere Änderung " +
              "dieser Seiten wirkt sich auf deine Bestellung nicht aus.",
          ],
        },
      ],
    },
    {
      heading: "§ 4 Preise",
      blocks: [
        {
          kind: "text",
          paragraphs: [
            "Alle Preise sind Endpreise in Euro. Als Kleinunternehmer im Sinne des § 19 UStG " +
              "sind unsere Umsätze steuerfrei; Umsatzsteuer wird daher nicht ausgewiesen.",
            "Zum Warenwert kommen Versandkosten hinzu. Sie werden an der Kasse vor dem " +
              "Absenden der Bestellung genannt und sind im Gesamtbetrag enthalten.",
            "Maßgeblich ist der Preis, der zum Zeitpunkt der Bestellung an der Kasse angezeigt " +
              "und berechnet wird. Die Beträge einer abgeschickten Bestellung stehen fest und " +
              "werden nicht nachträglich verändert.",
          ],
        },
      ],
    },
    {
      heading: "§ 5 Zahlung",
      blocks: [
        {
          kind: "text",
          paragraphs: [
            "Die Zahlung läuft über den Zahlungsdienstleister Stripe. Nach dem Absenden der " +
              "Bestellung wirst du auf dessen gesicherte Zahlungsseite weitergeleitet.",
            "Welche Zahlungsarten dort zur Verfügung stehen, richtet sich nach der aktuellen " +
              "Konfiguration des Zahlungsdienstleisters und wird dir vor Abschluss der Zahlung " +
              "angezeigt.",
            "Zahlungsdaten wie Kartennummern werden ausschließlich beim Zahlungsdienstleister " +
              "eingegeben und verarbeitet. Wir erhalten und speichern sie nicht.",
            "Der Kaufpreis ist mit der Bestellung zur Zahlung fällig.",
          ],
        },
      ],
    },
    {
      heading: "§ 6 Versand und Lieferung",
      blocks: [
        {
          kind: "text",
          paragraphs: [
            "Wir liefern ausschließlich innerhalb Deutschlands. Eine Lieferung an " +
              "Packstationen oder ins Ausland ist derzeit nicht möglich.",
            "Wir versenden in der Regel innerhalb von 1–2 Werktagen, nachdem die Zahlung " +
              "bestätigt ist. Die anschließende Zustelldauer richtet sich nach dem gewählten " +
              "Versanddienstleister; darauf haben wir keinen Einfluss und wir sagen sie " +
              "deshalb nicht zu.",
            "Ist keine Lieferzeit vereinbart, übergeben wir die Ware spätestens 30 Tage nach " +
              "Vertragsschluss (§ 475 Abs. 1 BGB).",
            "Die Versandkosten und die verfügbaren Versandarten stehen auf der Seite " +
              "„Versand“ und werden an der Kasse mit dem konkreten Betrag genannt.",
          ],
        },
      ],
    },
    {
      heading: "§ 7 Eigentumsvorbehalt",
      blocks: [
        {
          kind: "text",
          paragraphs: [
            "Die Ware bleibt bis zur vollständigen Bezahlung unser Eigentum.",
          ],
        },
      ],
    },
    {
      heading: "§ 8 Mängelhaftung",
      blocks: [
        {
          kind: "text",
          paragraphs: [
            "Es gelten die gesetzlichen Rechte bei Mängeln. Daran wird durch diese Bedingungen " +
              "nichts eingeschränkt.",
            "Bei gebrauchten Sammlerstücken gehört der im Artikel beschriebene Zustand zur " +
              "vereinbarten Beschaffenheit. Gebrauchsspuren, die dort genannt sind, sind " +
              "deshalb kein Mangel.",
            "Wenn mit deiner Bestellung etwas nicht stimmt, schreib uns an " + S.email + ". " +
              "Wir klären das.",
          ],
        },
      ],
    },
    {
      heading: "§ 9 Widerrufsrecht",
      blocks: [
        {
          kind: "text",
          paragraphs: [
            "Als Verbraucher steht dir ein Widerrufsrecht zu. Die Einzelheiten und die " +
              "gesetzlich vorgeschriebene Belehrung stehen auf der Seite " +
              "„Widerrufsbelehrung“, zusammen mit dem Muster-Widerrufsformular.",
            "Du kannst deinen Widerruf auch direkt online über unsere Widerrufsfunktion " +
              "erklären. Wir bestätigen dir den Eingang dann unverzüglich per E-Mail mit dem " +
              "Inhalt deiner Erklärung sowie Datum und Uhrzeit des Eingangs.",
          ],
        },
      ],
    },
    {
      heading: "§ 10 Konto und Nutzung der Plattform",
      blocks: [
        {
          kind: "text",
          paragraphs: [
            "Für eine Bestellung ist kein Konto erforderlich; du kannst als Gast bestellen.",
            "Wenn du ein Konto anlegst, bewahre deine Zugangsdaten sorgfältig auf und gib sie " +
              "nicht weiter. Die Angaben in deinem Konto sollen zutreffend sein; eine falsche " +
              "Lieferadresse können wir nicht korrigieren.",
            "Der Katalog und die Sammlungsverwaltung sind kostenlos nutzbar und von einem Kauf " +
              "unabhängig.",
          ],
        },
      ],
    },
    {
      heading: "§ 11 Anwendbares Recht",
      blocks: [
        {
          kind: "text",
          paragraphs: [
            "Es gilt deutsches Recht. Zwingende Verbraucherschutzvorschriften des Staates, in " +
              "dem du deinen gewöhnlichen Aufenthalt hast, bleiben davon unberührt.",
            "Das UN-Kaufrecht findet keine Anwendung.",
          ],
        },
      ],
    },
    {
      heading: "§ 12 Verbraucherstreitbeilegung",
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
  ],
};
