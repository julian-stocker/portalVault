/**
 * Widerrufsbelehrung und Muster-Widerrufsformular (ADR-0086).
 *
 * THIS FILE REPRODUCES STATUTORY TEXT. The Belehrung follows the Muster in
 * Anlage 1 zu Art. 246a § 1 Abs. 2 Satz 2 EGBGB and the form follows Anlage 2.
 * Both were taken from gesetze-im-internet.de on 2026-09-17.
 *
 * The wording of the model is not ours to improve. Where a Gestaltungshinweis
 * offers alternatives, the one matching this shop was chosen and the choice is
 * recorded below; nothing else was touched, not even a comma.
 *
 * WHICH GESTALTUNGSHINWEISE WERE APPLIED, AND WHY
 *
 *   1 b) + 1 c)  Kaufvertrag: the period starts on taking possession; the
 *                "letzte Ware" variant is added because one order can contain
 *                several figures that may be dispatched separately.
 *   2            name, address and e-mail. **The model also asks for a
 *                telephone number. There is none.** It is left out rather than
 *                invented — see docs/LEGAL.md, which records this as a point
 *                for legal review.
 *   3            the mandatory sentence about the online withdrawal function,
 *                included because § 356a BGB applies and the function exists.
 *   4            the right to withhold repayment until the goods are back.
 *   5 a)         return within 14 days to our address.
 *   5 b)         **"Sie tragen die unmittelbaren Kosten der Rücksendung der
 *                Waren."** — the plain variant, because these are ordinary
 *                parcels that can be returned by post.
 *   5 c)         Wertersatz for handling beyond what is needed to inspect.
 *
 * Hinweis 6 (Dienstleistungen, Wasser, Gas, Strom, Fernwärme) is not
 * applicable and is omitted.
 *
 * NO EXCEPTIONS ARE CLAIMED. Nothing sold here is sealed hygiene goods, made
 * to order, or digital content, so no exclusion of the right applies and none
 * is asserted.
 */
import type { LegalDocument } from "@/lib/legal/documents";
import { LEGAL_VERSIONS } from "@/lib/legal/documents";
import { SELLER_IDENTITY as S } from "@/lib/legal/seller-identity";

/** Where the § 356a function lives. Named once; every mention reads it. */
export const WITHDRAWAL_PATH = "/widerrufen";

/** The entrepreneur block the statutory model asks to be inserted. */
const ENTREPRENEUR = [
  S.legalName,
  S.tradeName,
  S.street,
  `${S.postalCode} ${S.city}`,
  S.country,
  `E-Mail: ${S.email}`,
].join("\n");

export const WIDERRUF: LegalDocument = {
  slug: "widerruf",
  title: "Widerrufsbelehrung",
  lead: "Für Verbraucher. Fassung vom 17. September 2026.",
  version: LEGAL_VERSIONS.widerruf,
  sections: [
    {
      heading: "Widerrufsrecht",
      blocks: [
        {
          kind: "quote",
          source: "Muster-Widerrufsbelehrung, Anlage 1 zu Art. 246a § 1 Abs. 2 Satz 2 EGBGB",
          paragraphs: [
            "Sie haben das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag " +
              "zu widerrufen.",
            "Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag, an dem Sie oder ein von Ihnen " +
              "benannter Dritter, der nicht der Beförderer ist, die letzte Ware in Besitz " +
              "genommen haben bzw. hat.",
            "Um Ihr Widerrufsrecht auszuüben, müssen Sie uns\n\n" +
              ENTREPRENEUR +
              "\n\nmittels einer eindeutigen Erklärung (z. B. ein mit der Post versandter Brief " +
              "oder eine E-Mail) über Ihren Entschluss, diesen Vertrag zu widerrufen, " +
              "informieren. Sie können dafür das beigefügte Muster-Widerrufsformular verwenden, " +
              "das jedoch nicht vorgeschrieben ist.",
            "Sie können Ihr Widerrufsrecht auch online auf dieser Website unter " +
              `${WITHDRAWAL_PATH} („Vertrag widerrufen“, im Fußbereich jeder Seite) ausüben. ` +
              "Wenn Sie diese Online-Funktion nutzen, " +
              "übermitteln wir Ihnen auf einem dauerhaften Datenträger (z. B. durch eine " +
              "E-Mail) unverzüglich eine Eingangsbestätigung mit Informationen zum Inhalt der " +
              "Widerrufserklärung sowie dem Datum und der Uhrzeit ihres Eingangs.",
            "Zur Wahrung der Widerrufsfrist reicht es aus, dass Sie die Mitteilung über die " +
              "Ausübung des Widerrufsrechts vor Ablauf der Widerrufsfrist absenden.",
          ],
        },
      ],
    },
    {
      heading: "Folgen des Widerrufs",
      blocks: [
        {
          kind: "quote",
          source: "Muster-Widerrufsbelehrung, Anlage 1 zu Art. 246a § 1 Abs. 2 Satz 2 EGBGB",
          paragraphs: [
            "Wenn Sie diesen Vertrag widerrufen, haben wir Ihnen alle Zahlungen, die wir von " +
              "Ihnen erhalten haben, einschließlich der Lieferkosten (mit Ausnahme der " +
              "zusätzlichen Kosten, die sich daraus ergeben, dass Sie eine andere Art der " +
              "Lieferung als die von uns angebotene, günstigste Standardlieferung gewählt " +
              "haben), unverzüglich und spätestens binnen vierzehn Tagen ab dem Tag " +
              "zurückzuzahlen, an dem die Mitteilung über Ihren Widerruf dieses Vertrags bei " +
              "uns eingegangen ist. Für diese Rückzahlung verwenden wir dasselbe Zahlungsmittel, " +
              "das Sie bei der ursprünglichen Transaktion eingesetzt haben, es sei denn, mit " +
              "Ihnen wurde ausdrücklich etwas anderes vereinbart; in keinem Fall werden Ihnen " +
              "wegen dieser Rückzahlung Entgelte berechnet.",
            "Wir können die Rückzahlung verweigern, bis wir die Waren wieder zurückerhalten " +
              "haben oder bis Sie den Nachweis erbracht haben, dass Sie die Waren zurückgesandt " +
              "haben, je nachdem, welches der frühere Zeitpunkt ist.",
            "Sie haben die Waren unverzüglich und in jedem Fall spätestens binnen vierzehn " +
              "Tagen ab dem Tag, an dem Sie uns über den Widerruf dieses Vertrags unterrichten, " +
              "an\n\n" +
              [S.legalName, S.tradeName, S.street, `${S.postalCode} ${S.city}`, S.country].join(
                "\n",
              ) +
              "\n\nzurückzusenden oder zu übergeben. Die Frist ist gewahrt, wenn Sie die Waren " +
              "vor Ablauf der Frist von vierzehn Tagen absenden.",
            "Sie tragen die unmittelbaren Kosten der Rücksendung der Waren.",
            "Sie müssen für einen etwaigen Wertverlust der Waren nur aufkommen, wenn dieser " +
              "Wertverlust auf einen zur Prüfung der Beschaffenheit, Eigenschaften und " +
              "Funktionsweise der Waren nicht notwendigen Umgang mit ihnen zurückzuführen ist.",
          ],
        },
      ],
    },
    {
      heading: "Ende der Widerrufsbelehrung",
      blocks: [
        {
          kind: "text",
          paragraphs: [
            "Die vorstehende Belehrung folgt dem gesetzlichen Muster. Die folgenden Abschnitte " +
              "sind zusätzliche Erläuterungen von uns und nicht Teil der gesetzlichen Belehrung.",
          ],
        },
      ],
    },
    {
      heading: "Ausnahmen",
      blocks: [
        {
          kind: "text",
          paragraphs: [
            "Für die Artikel in diesem Shop gilt keine Ausnahme vom Widerrufsrecht. Wir " +
              "verkaufen Sammelfiguren und Zubehör — keine digitalen Inhalte, keine nach " +
              "Kundenwunsch angefertigten Waren und keine versiegelten Hygieneartikel.",
          ],
        },
      ],
    },
    {
      heading: "Wie du widerrufen kannst",
      blocks: [
        {
          kind: "list",
          items: [
            `Online über die Widerrufsfunktion unter ${WITHDRAWAL_PATH} — zwei Schritte, ohne ` +
              "Konto, mit sofortiger Eingangsbestätigung per E-Mail.",
            `Per E-Mail an ${S.email} mit einer eindeutigen Erklärung.`,
            `Per Brief an ${S.legalName}, ${S.street}, ${S.postalCode} ${S.city}.`,
            "Mit dem Muster-Widerrufsformular unten — freiwillig, nicht vorgeschrieben.",
          ],
        },
      ],
    },
  ],
};

/**
 * Das Muster-Widerrufsformular, Anlage 2 zu Art. 246a § 1 Abs. 2 Satz 1 Nr. 1
 * und § 2 Abs. 2 Nr. 2 EGBGB.
 *
 * Verbatim, with only the entrepreneur's details filled into the placeholder
 * the model marks for them. The statutory form is offered as the statutory
 * form — it is not replaced by a prettier one of our own.
 */
export const WIDERRUFSFORMULAR = {
  intro:
    "(Wenn Sie den Vertrag widerrufen wollen, dann füllen Sie bitte dieses Formular aus und " +
    "senden Sie es zurück.)",
  recipient: [S.legalName, S.tradeName, S.street, `${S.postalCode} ${S.city}`, S.country, S.email],
  lines: [
    "Hiermit widerrufe(n) ich/wir (*) den von mir/uns (*) abgeschlossenen Vertrag über den Kauf " +
      "der folgenden Waren (*)/die Erbringung der folgenden Dienstleistung (*)",
    "Bestellt am (*)/erhalten am (*)",
    "Name des/der Verbraucher(s)",
    "Anschrift des/der Verbraucher(s)",
    "Unterschrift des/der Verbraucher(s) (nur bei Mitteilung auf Papier)",
    "Datum",
  ],
  footnote: "(*) Unzutreffendes streichen.",
} as const;
