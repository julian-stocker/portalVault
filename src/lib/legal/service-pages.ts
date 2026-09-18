/**
 * Versand, Zahlung, Kontakt (ADR-0086).
 *
 * These three are information pages rather than versioned legal documents —
 * they describe how the shop operates, and they are not snapshotted per order
 * because the AGB already carry the contractual statements.
 *
 * WHAT THEY MAY NOT DO IS PROMISE. The shipping page states the **dispatch**
 * time, which is a fact the operator supplied, and then stops: the carrier's
 * transit time is not known to this repository and is not invented. What fills
 * the gap is not a guess but the statutory default — § 475 Abs. 1 BGB, thirty
 * days from conclusion of contract where nothing else is agreed — which is
 * true, checkable, and better than a comforting number that could be wrong.
 *
 * Prices and methods are NOT written into the prose. They live in
 * `shipping_methods` and `shop_settings`, the seller can change them, and the
 * page renders whatever is configured today. A price in a sentence would be a
 * second place to update and the one that would be forgotten.
 */
import type { LegalDocument } from "@/lib/legal/documents";
import { SELLER_IDENTITY as S } from "@/lib/legal/seller-identity";
import { WITHDRAWAL_PATH } from "@/lib/legal/widerruf";

export const VERSAND: LegalDocument = {
  slug: "versand",
  title: "Versand",
  lead: "Wohin wir liefern, wie lange es dauert und was es kostet.",
  sections: [
    {
      heading: "Liefergebiet",
      blocks: [
        {
          kind: "text",
          paragraphs: [
            "Wir liefern ausschließlich innerhalb Deutschlands. Eine Lieferung ins Ausland ist " +
              "derzeit nicht möglich; die Kasse nimmt deshalb keine ausländische Adresse an.",
          ],
        },
      ],
    },
    {
      heading: "Bearbeitung und Zustellung",
      blocks: [
        {
          kind: "text",
          paragraphs: [
            "**Versand in der Regel innerhalb von 1–2 Werktagen**, nachdem die Zahlung " +
              "bestätigt ist. Werktage sind Montag bis Freitag ohne bundesweite Feiertage.",
            "**Die Zustelldauer danach sagen wir nicht zu.** Sie hängt vom Versanddienstleister " +
              "ab, und eine Angabe, auf die wir keinen Einfluss haben, wäre ein Versprechen, " +
              "das wir nicht halten können.",
            "Ist keine Lieferzeit vereinbart, übergeben wir die Ware spätestens 30 Tage nach " +
              "Vertragsschluss (§ 475 Abs. 1 BGB).",
            "Sobald das Paket unterwegs ist, bekommst du eine Versandbestätigung per E-Mail — " +
              "mit Sendungsnummer, sofern der gewählte Versandweg eine vorsieht.",
          ],
        },
      ],
    },
    {
      heading: "Versandkosten",
      blocks: [
        {
          kind: "text",
          paragraphs: [
            "Die Versandkosten hängen von der gewählten Versandart ab und werden an der Kasse " +
              "vor dem Absenden der Bestellung mit dem konkreten Betrag genannt. Sie sind im " +
              "Gesamtbetrag enthalten.",
          ],
        },
      ],
    },
    {
      heading: "Rücksendungen",
      blocks: [
        {
          kind: "text",
          paragraphs: [
            "Wenn du von deinem Widerrufsrecht Gebrauch machst, sendest du die Ware an:",
          ],
        },
        {
          kind: "pairs",
          pairs: [
            ["Rücksendeadresse", `${S.legalName}, ${S.tradeName}`],
            ["", `${S.street}, ${S.postalCode} ${S.city}, ${S.country}`],
          ],
        },
        {
          kind: "text",
          paragraphs: [
            "Die unmittelbaren Kosten der Rücksendung trägst du. Die Einzelheiten stehen in " +
              "der Widerrufsbelehrung; erklären kannst du den Widerruf direkt online unter " +
              `${WITHDRAWAL_PATH}.`,
          ],
        },
      ],
    },
  ],
};

export const ZAHLUNG: LegalDocument = {
  slug: "zahlung",
  title: "Zahlung",
  lead: "Wie bezahlt wird und was dabei mit deinen Daten passiert.",
  sections: [
    {
      heading: "Ablauf",
      blocks: [
        {
          kind: "text",
          paragraphs: [
            "Nach dem Klick auf **„Zahlungspflichtig bestellen“** wirst du auf die gesicherte " +
              "Zahlungsseite unseres Zahlungsdienstleisters **Stripe** weitergeleitet und " +
              "bezahlst dort. Die Ware wird währenddessen für dich vorgemerkt.",
            "Ist die Zahlung bestätigt, bekommst du die Bestellbestätigung per E-Mail — und " +
              "damit kommt der Vertrag zustande.",
            "Bricht die Zahlung ab oder kommt sie nicht zustande, verfällt die Bestellung nach " +
              "kurzer Zeit und die Ware wird wieder freigegeben. Es entstehen dir dadurch keine " +
              "Kosten.",
          ],
        },
      ],
    },
    {
      heading: "Zahlungsarten",
      blocks: [
        {
          kind: "text",
          paragraphs: [
            "Welche Zahlungsarten zur Verfügung stehen, entscheidet die aktuelle Konfiguration " +
              "bei Stripe. Sie werden dir auf der Zahlungsseite angezeigt, bevor du die Zahlung " +
              "abschließt.",
            "Wir zählen sie hier bewusst nicht auf: eine Liste auf dieser Seite könnte eine " +
              "Zahlungsart versprechen, die gerade nicht verfügbar ist.",
          ],
        },
      ],
    },
    {
      heading: "Deine Zahlungsdaten",
      blocks: [
        {
          kind: "text",
          paragraphs: [
            "Kartennummern und vergleichbare Zahlungsdaten gibst du ausschließlich bei Stripe " +
              "ein. **SkyIsles erhält und speichert sie nicht.**",
            "Wir speichern zu deiner Bestellung nur die Vorgangskennungen von Stripe, den " +
              "Status und den Betrag — genug, um deine Zahlung der Bestellung zuzuordnen, und " +
              "nicht mehr.",
          ],
        },
      ],
    },
    {
      heading: "Preise und Umsatzsteuer",
      blocks: [
        {
          kind: "text",
          paragraphs: [
            "Alle Preise sind Endpreise in Euro. Als Kleinunternehmer im Sinne des § 19 UStG " +
              "sind unsere Umsätze steuerfrei; Umsatzsteuer wird nicht ausgewiesen.",
            "Zu jeder bezahlten Bestellung stellen wir eine Rechnung bereit. Du findest sie in " +
              "deiner Bestellübersicht und als Link in der Bestellbestätigung.",
          ],
        },
      ],
    },
  ],
};

export const KONTAKT: LegalDocument = {
  slug: "kontakt",
  title: "Kontakt",
  lead: "Wer antwortet, und wofür du welchen Weg nimmst.",
  sections: [
    {
      heading: "Wen du erreichst",
      blocks: [
        {
          kind: "text",
          paragraphs: [
            `Hinter ${S.platformName} und ${S.tradeName} steht eine Person: ` +
              `**${S.legalName}**, ${S.city}. Anfragen beantwortet er selbst.`,
            "Es gibt keine Telefonnummer und keine Hotline. Der Weg ist die E-Mail — und sie " +
              "wird gelesen.",
          ],
        },
        {
          kind: "pairs",
          pairs: [
            ["E-Mail", S.email],
            ["Anschrift", `${S.street}, ${S.postalCode} ${S.city}, ${S.country}`],
          ],
        },
      ],
    },
    {
      heading: "Wofür welcher Weg",
      blocks: [
        {
          kind: "list",
          items: [
            `**Fragen zu einer Bestellung** — E-Mail an ${S.email} mit der Bestellnummer. ` +
              "Die steht in jeder E-Mail zu deiner Bestellung und in deiner Bestellübersicht.",
            `**Widerruf** — am schnellsten online unter ${WITHDRAWAL_PATH}. Du bekommst sofort ` +
              "eine Eingangsbestätigung mit Datum und Uhrzeit. Per E-Mail oder Brief geht es " +
              "genauso; der Online-Weg ist ein Angebot, keine Bedingung.",
            `**Reklamation oder etwas stimmt nicht mit der Ware** — E-Mail an ${S.email}. ` +
              "Ein Foto hilft meistens.",
            `**Datenschutz** — E-Mail an ${S.email}. Auskunft, Berichtigung und Löschung ` +
              "brauchen kein Formular.",
            "**Fragen zum Katalog oder zur Sammlung** — dieselbe Adresse. Hinweise auf falsche " +
              "Katalogdaten sind willkommen.",
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
  ],
};
