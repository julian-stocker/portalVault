/**
 * Datenschutzerklärung (ADR-0086).
 *
 * WRITTEN FROM THE PHASE-1 INVENTORY, NOT FROM A TEMPLATE. Every processing
 * operation described here was found in the code. Just as importantly, the
 * sections a generator would have added are **absent**, because the things
 * they describe do not exist:
 *
 *   no Google Analytics, no Matomo, no Plausible, no PostHog
 *   no tracking pixels, no advertising, no remarketing
 *   no Google Fonts or any other third-party font host
 *   no captcha, no maps, no social plugins, no embedded video
 *   no newsletter, no marketing mail, no profiling
 *   no comment function, no chat widget
 *
 * A privacy notice that lists what a shop does not do is not thorough, it is
 * copied — and it makes the parts that are true harder to trust.
 *
 * NO COOKIE BANNER, AND THAT IS A DECISION. Every client-side store this
 * product uses is first-party and serves a function the visitor asked for: the
 * session cookie, the basket, one display preference, and a token that proves
 * a guest owns the order they are paying for. Asking for consent to those
 * would be asking for consent that is not needed, which devalues consent that
 * is. Recorded in docs/LEGAL.md with the open question attached.
 */
import type { LegalDocument } from "@/lib/legal/documents";
import { LEGAL_VERSIONS } from "@/lib/legal/documents";
import { SELLER_IDENTITY as S } from "@/lib/legal/seller-identity";

export const DATENSCHUTZ: LegalDocument = {
  slug: "datenschutz",
  title: "Datenschutzerklärung",
  lead: "Welche Daten SkyIsles verarbeitet, wofür und wer sie erhält.",
  version: LEGAL_VERSIONS.datenschutz,
  sections: [
    {
      heading: "Verantwortlicher",
      blocks: [
        {
          kind: "pairs",
          pairs: [
            ["Name", S.legalName],
            ["Geschäftsbezeichnung", S.tradeName],
            ["Anschrift", `${S.street}, ${S.postalCode} ${S.city}, ${S.country}`],
            ["E-Mail", S.email],
          ],
        },
        {
          kind: "text",
          paragraphs: [
            "Ein Datenschutzbeauftragter ist nicht bestellt; die Voraussetzungen dafür liegen " +
              "nicht vor.",
          ],
        },
      ],
    },
    {
      heading: "Wenn du nur den Katalog ansiehst",
      blocks: [
        {
          kind: "text",
          paragraphs: [
            "Beim Aufruf der Seiten verarbeitet unser Hosting-Anbieter technisch notwendige " +
              "Verbindungsdaten wie IP-Adresse, Zeitpunkt, angefragte Adresse und " +
              "Browserkennung, damit die Seite ausgeliefert werden kann und der Betrieb " +
              "sicher bleibt. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO.",
            "Katalog, Suche und Figurenseiten kannst du ohne Konto und ohne Registrierung " +
              "benutzen. Wir setzen dabei keine Analyse-, Tracking- oder Werbetechnologien " +
              "ein — weder eigene noch fremde.",
          ],
        },
      ],
    },
    {
      heading: "Konto und Anmeldung",
      blocks: [
        {
          kind: "text",
          paragraphs: [
            "Für ein Konto verarbeiten wir deine E-Mail-Adresse, ein Passwort in gehashter " +
              "Form und einen von dir gewählten Benutzernamen. Die Authentifizierung läuft " +
              "über Supabase Auth.",
            "Zweck ist die Bereitstellung des Kontos einschließlich Sammlung, Warenkorb und " +
              "Bestellübersicht. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO.",
            "Zur Anmeldung, zur Bestätigung der E-Mail-Adresse und zum Zurücksetzen des " +
              "Passworts versendet Supabase Auth E-Mails an deine Adresse.",
          ],
        },
      ],
    },
    {
      heading: "Sammlung und Warenkorb",
      blocks: [
        {
          kind: "text",
          paragraphs: [
            "Welche Figuren du als „besitze ich“ markierst, speichern wir deinem Konto " +
              "zugeordnet. Diese Angaben sind nicht öffentlich und werden niemandem " +
              "weitergegeben.",
            "Ohne Konto liegt dein Warenkorb ausschließlich in deinem Browser " +
              "(`localStorage`) und erreicht uns nicht. Mit Konto speichern wir ihn auf dem " +
              "Server, damit er auf mehreren Geräten verfügbar ist.",
          ],
        },
      ],
    },
    {
      heading: "Bestellung, Bestellabwicklung und Rechnung",
      blocks: [
        {
          kind: "text",
          paragraphs: [
            "Bei einer Bestellung verarbeiten wir deine E-Mail-Adresse, Vor- und Nachname, " +
              "gegebenenfalls Firma, Straße, Hausnummer, Adresszusatz, Postleitzahl und Ort, " +
              "die bestellten Artikel, die Beträge, Zahlungs- und Versandstatus sowie " +
              "gegebenenfalls eine Sendungsnummer.",
            "Zweck ist die Durchführung des Kaufvertrags einschließlich Versand, Rechnung und " +
              "Kommunikation über die Bestellung. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b " +
              "DSGVO, für die Aufbewahrung der Geschäftsunterlagen Art. 6 Abs. 1 lit. c DSGVO.",
            "Die Lieferadresse wird als Kopie zur Bestellung gespeichert. Änderst du später " +
              "deine gespeicherte Adresse, ändert das die Adresse einer bereits aufgegebenen " +
              "Bestellung nicht.",
            "Aus diesen Daten erzeugen wir die Rechnung zu deiner Bestellung. Sie wird bei " +
              "jedem Abruf aus den gespeicherten Bestelldaten erzeugt und ist nur dir " +
              "zugänglich — angemeldet über dein Konto, als Gast über den Nachweis, den dein " +
              "Browser bei der Bestellung erhalten hat.",
          ],
        },
      ],
    },
    {
      heading: "Gespeicherte Kontaktdaten für künftige Bestellungen",
      blocks: [
        {
          kind: "text",
          paragraphs: [
            "An der Kasse kannst du — nur mit Konto — ankreuzen, dass wir deine Kontakt- und " +
              "Lieferdaten für künftige Bestellungen speichern. Das Feld ist standardmäßig " +
              "**nicht** angekreuzt.",
            "Rechtsgrundlage ist deine Einwilligung nach Art. 6 Abs. 1 lit. a DSGVO. Du kannst " +
              "sie jederzeit widerrufen, indem du die Angaben unter „Kontakt & Lieferadresse“ " +
              "löschst. Die Löschung wirkt für die Zukunft; bereits aufgegebene Bestellungen " +
              "behalten ihre eigene Adresskopie.",
          ],
        },
      ],
    },
    {
      heading: "Zahlung",
      blocks: [
        {
          kind: "text",
          paragraphs: [
            "Die Zahlung wickeln wir über Stripe ab. Nach dem Absenden der Bestellung wirst du " +
              "auf die Zahlungsseite von Stripe weitergeleitet.",
            "An Stripe übermitteln wir dafür: deine E-Mail-Adresse, die Bezeichnungen, Mengen " +
              "und Preise der bestellten Artikel, die Versandart und den Betrag sowie eine " +
              "interne Bestell- und Vorgangsnummer. Eine Anschrift, dein Name oder eine " +
              "Telefonnummer werden von uns **nicht** an Stripe übermittelt.",
            "Zahlungsdaten wie Kartennummern gibst du ausschließlich bei Stripe ein. Wir " +
              "erhalten sie nicht und speichern sie nicht. Von Stripe speichern wir die " +
              "Vorgangskennungen, den Status und den Betrag, um die Zahlung deiner Bestellung " +
              "zuordnen zu können.",
            "Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO.",
          ],
        },
      ],
    },
    {
      heading: "E-Mails zu deiner Bestellung",
      blocks: [
        {
          kind: "text",
          paragraphs: [
            "Bestelleingang, Bestellbestätigung, Versandbestätigung, Eingangsbestätigung eines " +
              "Widerrufs und die Mitteilung über eine Erstattung versenden wir über den " +
              "Dienstleister Resend. Dabei werden deine E-Mail-Adresse und der Inhalt der " +
              "jeweiligen E-Mail verarbeitet.",
            "Es handelt sich ausschließlich um Nachrichten zur Abwicklung deiner Bestellung. " +
              "Einen Newsletter gibt es nicht, und wir versenden keine Werbung.",
            "Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO, für die Eingangsbestätigung eines " +
              "Widerrufs zusätzlich Art. 6 Abs. 1 lit. c DSGVO (§ 356a Abs. 4 BGB).",
          ],
        },
      ],
    },
    {
      heading: "Widerruf und Erstattung",
      blocks: [
        {
          kind: "text",
          paragraphs: [
            "Erklärst du einen Widerruf über unsere Online-Funktion, speichern wir deinen " +
              "Namen, die angegebene E-Mail-Adresse, den Inhalt deiner Erklärung, die " +
              "zugehörige Bestellung sowie Datum und Uhrzeit des Eingangs.",
            "Das ist keine freiwillige Datensammlung: § 356a Abs. 4 BGB verlangt, dass wir dir " +
              "genau diesen Inhalt mit Datum und Uhrzeit bestätigen. Rechtsgrundlage ist " +
              "Art. 6 Abs. 1 lit. c DSGVO.",
            "Erstattungen speichern wir mit Betrag, Zeitpunkt und Bezug zur Bestellung.",
          ],
        },
      ],
    },
    {
      heading: "Schutz vor missbräuchlichen Bestellungen",
      blocks: [
        {
          kind: "text",
          paragraphs: [
            "Beim Absenden einer Bestellung bilden wir aus deiner IP-Adresse und einem " +
              "geheimen Zusatzwert einen Hashwert. **Die IP-Adresse selbst wird dabei nicht " +
              "gespeichert**, und aus dem Hashwert lässt sich die Adresse nicht " +
              "zurückrechnen.",
            "Der Hashwert dient ausschließlich dazu, eine Flut unbezahlter Bestellungen zu " +
              "begrenzen. Er wird gelöscht, sobald die Bestellung bezahlt ist. " +
              "Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO.",
          ],
        },
      ],
    },
    {
      heading: "Messung der Ladegeschwindigkeit",
      blocks: [
        {
          kind: "text",
          paragraphs: [
            "Für angemeldete Konten messen wir, wie schnell einzelne Seiten und Ansichten " +
              "erscheinen, und speichern dazu Kennung des Kontos, die betroffene Route und " +
              "Zeitwerte in Millisekunden.",
            "Die Messung ist rein intern: Es werden keine Daten an Dritte übermittelt, es " +
              "werden keine Profile gebildet und es wird nichts wiedererkannt, was über die " +
              "Sitzung hinausgeht. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO.",
          ],
        },
      ],
    },
    {
      heading: "Cookies und Speicherung im Browser",
      blocks: [
        {
          kind: "text",
          paragraphs: [
            "Wir verwenden ausschließlich eigene, technisch erforderliche Speicherung. " +
              "Es gibt **kein** Einwilligungsbanner, weil es nichts gibt, wofür eine " +
              "Einwilligung einzuholen wäre.",
          ],
        },
        {
          kind: "list",
          items: [
            "**Anmelde-Cookies** — halten deine Sitzung aufrecht, wenn du angemeldet bist. " +
              "Ohne sie könntest du dich nicht anmelden.",
            "**Warenkorb** (`localStorage`) — was du ohne Konto in den Warenkorb gelegt hast. " +
              "Bleibt in deinem Browser.",
            "**Anzeigeeinstellung** (`localStorage`) — ob die Sammlung als Raster oder Liste " +
              "erscheint.",
            "**Zahlungsnachweis** (`sessionStorage`) — ein Einmalwert, mit dem dein Browser " +
              "nachweisen kann, dass eine ohne Konto aufgegebene Bestellung deine ist. Wird " +
              "beim Schließen des Tabs und bei der Abmeldung gelöscht.",
            "**Messwerte** (`sessionStorage`) — eine Kennung, die die Messwerte eines " +
              "Seitenbesuchs zusammenhält. Endet mit dem Tab.",
          ],
        },
      ],
    },
    {
      heading: "Empfänger",
      blocks: [
        {
          kind: "text",
          paragraphs: [
            "Wir geben personenbezogene Daten nur an die folgenden Dienstleister weiter, und " +
              "nur soweit sie diese für ihre Aufgabe benötigen:",
          ],
        },
        {
          kind: "list",
          items: [
            "**Supabase** — Datenbank, Authentifizierung, Speicher und serverseitige " +
              "Funktionen.",
            "**Vercel** — Hosting und Auslieferung der Website.",
            "**Stripe** — Zahlungsabwicklung.",
            "**Resend** — Versand der E-Mails zur Bestellung.",
            "**Versanddienstleister** — Name und Lieferadresse zur Zustellung des Pakets.",
          ],
        },
        {
          kind: "text",
          paragraphs: [
            "Darüber hinaus geben wir Daten nur weiter, wenn wir gesetzlich dazu verpflichtet " +
              "sind. Es findet kein Verkauf von Daten statt und keine Weitergabe zu " +
              "Werbezwecken.",
          ],
        },
      ],
    },
    {
      heading: "Speicherdauer",
      blocks: [
        {
          kind: "text",
          paragraphs: [
            "Bestellungen und Rechnungen bewahren wir für die Dauer der gesetzlichen " +
              "handels- und steuerrechtlichen Aufbewahrungsfristen auf. Bestellungen werden " +
              "nicht gelöscht, auch dann nicht, wenn ein Konto endet — die Bestellung wird in " +
              "diesem Fall vom Konto getrennt.",
            "Kontodaten und Sammlung verarbeiten wir, solange das Konto besteht. Gespeicherte " +
              "Kontaktdaten kannst du jederzeit selbst löschen.",
            "Der Hashwert zum Schutz vor missbräuchlichen Bestellungen wird mit der Zahlung " +
              "gelöscht.",
          ],
        },
      ],
    },
    {
      heading: "Deine Rechte",
      blocks: [
        {
          kind: "list",
          items: [
            "Auskunft über die zu dir gespeicherten Daten (Art. 15 DSGVO)",
            "Berichtigung unrichtiger Daten (Art. 16 DSGVO)",
            "Löschung, soweit keine Aufbewahrungspflicht entgegensteht (Art. 17 DSGVO)",
            "Einschränkung der Verarbeitung (Art. 18 DSGVO)",
            "Datenübertragbarkeit (Art. 20 DSGVO)",
            "Widerspruch gegen Verarbeitungen auf Grundlage berechtigter Interessen " +
              "(Art. 21 DSGVO)",
            "Widerruf einer erteilten Einwilligung mit Wirkung für die Zukunft " +
              "(Art. 7 Abs. 3 DSGVO)",
            "Beschwerde bei einer Datenschutz-Aufsichtsbehörde (Art. 77 DSGVO)",
          ],
        },
        {
          kind: "text",
          paragraphs: [`Für alles davon genügt eine E-Mail an ${S.email}.`],
        },
      ],
    },
  ],
};
