# LEGAL.md — Rechtsgrundlagen, Entscheidungen und Quellen

Diese Datei ist die Arbeitsgrundlage für die Rechts- und Compliance-Schicht von SkyIsles.
Sie hält fest, **welche Norm** eine Implementierung verlangt, **welche Fassung** geprüft wurde und
**welche Entscheidung** daraus folgte.

Sie ist **keine Rechtsberatung** und ersetzt keine anwaltliche Prüfung vor dem öffentlichen Start.

**Stand der Prüfung: 2026-09-17.** Alle Normen wurden an diesem Tag gegen die amtlichen Quellen
(gesetze-im-internet.de, Bundesamt für Justiz) verifiziert.

---

## 1. Wer verkauft — die Grundlage für alles Übrige

| | |
|---|---|
| **Unternehmer** | Julian Stocker |
| **Rechtsform** | Einzelunternehmen (**nicht** im Handelsregister eingetragen) |
| **Anschrift** | Lechhalde 1 1/2, 87629 Füssen, Deutschland |
| **E-Mail** | info@skyisles.de |
| **Telefon** | keines veröffentlicht |
| **USt-IdNr.** | DE321022065 |
| **Umsatzsteuer** | Kleinunternehmer nach § 19 UStG |

**SkyIsles** und **yulez.collectibles** sind **keine getrennten Rechtsträger**. Beide werden von
derselben natürlichen Person als ein Einzelunternehmen betrieben.

- **SkyIsles** — die Plattform, das Produkt, die Website.
- **yulez.collectibles** — die Geschäftsbezeichnung, unter der über SkyIsles verkauft wird.

Vertragspartner des Kunden ist deshalb immer:

> **Julian Stocker, handelnd unter yulez.collectibles**

Das ist eine **Präzisierung von ADR-0064**, nicht dessen Aufhebung: die architektonische Trennung
zwischen Plattform- und Verkäuferidentität bleibt bestehen und ist weiterhin richtig — sie trennt
zwei **Rollen**, nicht zwei **Rechtspersonen**. Wo der frühere Sprachgebrauch „zwei Rechtssubjekte"
sagte, ist er falsch und wird korrigiert.

---

## 2. Geprüfte Normen und was daraus folgt

### § 5 DDG — Allgemeine Informationspflichten (Impressum)

Verlangt u. a. Name und Anschrift, Angaben zur elektronischen Erreichbarkeit einschließlich
E-Mail-Adresse, Handelsregisterangaben **soweit vorhanden**, und die Umsatzsteuer-Identifikations-
nummer **soweit vorhanden**.

**Folge:** `/impressum` nennt Name, Anschrift, E-Mail und USt-IdNr. Es nennt **keinen**
Handelsregistereintrag (es gibt keinen), **keine** Telefonnummer (es gibt keine), **keine**
Aufsichtsbehörde und **keine** Kammer. Das DDG hat das TMG abgelöst; „§ 5 TMG" wird nirgends
zitiert.

### § 312i Abs. 1 BGB — Pflichten im elektronischen Geschäftsverkehr

Nr. 3 verlangt, **„den Zugang von dessen Bestellung unverzüglich auf elektronischem Wege zu
bestätigen"**. Nr. 4 verlangt, dass Vertragsbestimmungen einschließlich AGB abrufbar und in
wiedergabefähiger Form speicherbar sind.

**Befund aus Phase 1:** Es gab **überhaupt keine E-Mail** zwischen Bestellung und Zahlungseingang.
Wer bestellte und dessen Zahlung hängen blieb, bekam nichts.

**Folge:** neue Mail-Art `order_received`, ausgelöst bei Bestellanlage, ausdrücklich **keine
Annahme**. Siehe Abschnitt 3.

### § 312j BGB — Button-Lösung und hervorgehobene Informationen

- **Abs. 1:** spätestens **bei Beginn des Bestellvorgangs** klar und deutlich angeben, **ob
  Lieferbeschränkungen bestehen** und **welche Zahlungsmittel akzeptiert werden**.
- **Abs. 2:** unmittelbar vor Abgabe der Bestellung, klar, verständlich und **in hervorgehobener
  Weise**, die Informationen nach **Art. 246a § 1 Abs. 1 Satz 1 Nr. 1, 5 bis 7, 8, 14 und 15
  EGBGB**.
- **Abs. 3:** Schaltfläche **„gut lesbar mit nichts anderem als den Wörtern ‚zahlungspflichtig
  bestellen'"** oder einer entsprechenden eindeutigen Formulierung.
- **Abs. 4:** Ohne Erfüllung von Abs. 3 kommt **kein Vertrag** zustande.

**Folge:** Die bestehende Beschriftung **„Zahlungspflichtig bestellen"** bleibt unverändert — sie
ist wortgleich zur gesetzlichen Vorgabe. Der Warenkorb bekommt die Angaben nach Abs. 1
(Lieferbeschränkung Deutschland, Zahlungsmittel). Der Informationsblock unmittelbar über dem Button
erfüllt Abs. 2; Nr. 8, 14 und 15 betreffen Dauerschuldverhältnisse und sind hier gegenstandslos,
Nr. 6 (personalisierte Preisbildung) ebenfalls, weil keine stattfindet.

### § 312f Abs. 2 BGB — Vertragsbestätigung auf dauerhaftem Datenträger

Bei Fernabsatzverträgen ist dem Verbraucher **innerhalb angemessener Frist, spätestens bei
Lieferung**, eine Vertragsbestätigung **auf einem dauerhaften Datenträger** zur Verfügung zu
stellen, die die Angaben nach Art. 246a enthält, soweit sie nicht schon vorher auf dauerhaftem
Datenträger übermittelt wurden.

**Folge:** Die Bestellbestätigung enthält die Vertragsangaben **im Text der E-Mail selbst** und
verweist nicht bloß auf Webseiten, die sich ändern können. AGB und Widerrufsbelehrung werden in der
**zum Bestellzeitpunkt geltenden Fassung** mitgeteilt und über die gespeicherte Version dauerhaft
nachvollziehbar gehalten (Abschnitt 5).

### §§ 355, 356, 357 BGB und Art. 246a EGBGB — Widerruf

Widerrufsfrist 14 Tage; bei Kaufverträgen beginnt sie mit **Besitzerlangung der Ware**. Die
Unterrichtung erfolgt über das **Muster in Anlage 1 zu Art. 246a § 1 Abs. 2 Satz 2 EGBGB**; das
**Muster-Widerrufsformular** steht in **Anlage 2**.

**Folge:** `/widerruf` gibt die Muster-Widerrufsbelehrung mit den für einen Kaufvertrag
zutreffenden Gestaltungshinweisen wieder:

- Hinweis 1 **b)** — Fristbeginn bei Besitzerlangung; zusätzlich **c)** für den Fall mehrerer
  getrennt gelieferter Waren aus einer Bestellung.
- Hinweis 2 — Name, Anschrift, **Telefonnummer** und E-Mail-Adresse. *Es gibt keine
  Telefonnummer; sie wird nicht erfunden und deshalb weggelassen.* <!-- offen: anwaltlich prüfen -->
- Hinweis 3 — **Pflichtsatz zur Online-Widerrufsfunktion**, weil § 356a BGB gilt (siehe unten).
- Hinweis 4 — Zurückbehaltungsrecht bis Rückerhalt der Ware.
- Hinweis 5 a) — Rücksendung binnen 14 Tagen an die Anschrift des Unternehmers.
- Hinweis 5 b) — **„Sie tragen die unmittelbaren Kosten der Rücksendung der Waren."**
- Hinweis 5 c) — Wertersatz bei nicht prüfungsnotwendigem Umgang.

Hinweis 6 (Dienstleistungen, Wasser, Gas, Strom, Fernwärme) ist gegenstandslos. **Es werden keine
Ausnahmen vom Widerrufsrecht behauptet** — für gebrauchte und neue Sammelfiguren greift keine.

### § 356a BGB — Elektronische Widerrufsfunktion

**In Kraft seit 19. Juni 2026** (Umsetzung der Richtlinie (EU) 2023/2673, BGBl. 2026 I Nr. 28).
Die Norm gilt damit **heute**.

Verlangt:

1. eine Widerrufsfunktion auf der Online-Benutzeroberfläche, beschriftet mit **„Vertrag
   widerrufen"** oder einer gleichwertigen eindeutigen Formulierung,
2. **ständig verfügbar** während der Widerrufsfrist, gut sichtbar und leicht zugänglich,
3. Übermittlung von **Name**, **Angaben zur Identifizierung des Vertrags** und **elektronischer
   Kontaktangabe für die Empfangsbestätigung**,
4. eine **gesonderte Bestätigungsfunktion**, beschriftet mit **„Widerruf bestätigen"** oder
   gleichwertig,
5. **unverzüglich** eine Eingangsbestätigung **auf einem dauerhaften Datenträger** mit dem
   **Inhalt der Widerrufserklärung** sowie **Datum und Uhrzeit des Eingangs**,
6. Fristwahrung durch Absenden über die Funktion.

**Folge:** vollständige Implementierung, siehe Abschnitt 6. Die Button-Beschriftungen sind
**wörtlich** die des Gesetzes und dürfen nicht „verschönert" werden.

### § 19 UStG — Kleinunternehmer

Seit der Neufassung sind die Umsätze **steuerfrei** (nicht mehr: „Steuer wird nicht erhoben").
Grenzen: 25 000 € Vorjahr, 100 000 € laufendes Jahr.

**Folge:** Die Modellierung als **Regime statt Steuersatz** (Migration 0011, ADR) bleibt richtig und
bleibt unverändert. Die **Wortwahl** in Kundentexten und auf der Rechnung folgt jedoch der aktuellen
Fassung: *steuerfrei nach § 19 UStG*, nicht „Steuer wird nicht erhoben".

### § 34a UStDV — Rechnungen von Kleinunternehmern

Eine Rechnung über eine nach § 19 Abs. 1 steuerfreie Leistung muss enthalten:

1. vollständiger Name und Anschrift **des leistenden Unternehmers und des Leistungsempfängers**,
2. Steuernummer, **USt-IdNr.** oder Kleinunternehmer-Identifikationsnummer,
3. **Ausstellungsdatum**,
4. **Menge und handelsübliche Bezeichnung** der gelieferten Gegenstände,
5. **das Entgelt in einer Summe** mit dem **Hinweis auf die Steuerbefreiung für Kleinunternehmer**,
6. bei Gutschriften die Angabe „Gutschrift".

**Bemerkenswert:** eine **fortlaufende Rechnungsnummer ist hier nicht verlangt**. SkyIsles vergibt
trotzdem eine, weil eine eindeutige, unveränderliche Referenz betrieblich und für die spätere
Zuordnung nötig ist — sie ist eine freiwillige Zugabe, kein behaupteter Pflichtinhalt.

### § 475 Abs. 1 BGB — Lieferzeit

Ist keine Lieferzeit vereinbart, muss der Unternehmer die Ware **spätestens 30 Tage nach
Vertragsschluss** übergeben.

**Folge:** Die Versandseite nennt die **Bearbeitungs-/Versandzeit von 1–2 Werktagen** als Tatsache
und daneben die **gesetzliche Obergrenze aus § 475 Abs. 1 BGB**. Eine **Transportlaufzeit des
Versanddienstleisters wird nicht behauptet**, weil sie aus Repository und Geschäftsfakten nicht
feststeht. Siehe Abschnitt 9 — offene Punkte.

### § 36 VSBG — Verbraucherstreitbeilegung

Die Pflicht nach Abs. 1 Nr. 1 gilt **nicht** für Unternehmer, die am 31. Dezember des Vorjahres
**zehn oder weniger Personen** beschäftigt haben (Abs. 3).

**Folge:** Als Einzelunternehmen ohne Beschäftigte ist Julian Stocker von der Pflicht **befreit**.
Die Angabe erfolgt trotzdem, kurz und zutreffend („nicht bereit und nicht verpflichtet"), weil sie
den Kunden informiert und nichts Falsches behauptet. **Die europäische ODR-Plattform wird nicht
verlinkt** — sie wurde zum 20. Juli 2025 eingestellt; ein Link wäre heute schlicht falsch.

### BFSG — Barrierefreiheit

Das Barrierefreiheitsstärkungsgesetz gilt seit dem 28. Juni 2025. **Kleinstunternehmen**, die
**Dienstleistungen** erbringen — weniger als 10 Beschäftigte **und** höchstens 2 Mio. € Jahresumsatz
— sind von den Anforderungen an Dienstleistungen ausgenommen.

**Folge:** Auf Grundlage der Geschäftsfakten (Einzelunternehmen; § 19 UStG begrenzt den Umsatz auf
höchstens 100 000 €, also weit unter 2 Mio. €) greift die Ausnahme für den Dienst
„Dienstleistungen im elektronischen Geschäftsverkehr". **In der Kundenoberfläche wird dazu nichts
behauptet** — weder eine Barrierefreiheitserklärung noch eine Konformitätsaussage, denn beides wäre
eine Aussage, zu der keine Pflicht und keine Prüfung besteht. Die Rechts- und Compliance-Seiten
werden dennoch barrierefrei gebaut (Abschnitt 8), weil das unabhängig von der Pflicht richtig ist.
<!-- offen: anwaltlich bestätigen, insbesondere die Beschäftigtenzahl zum Stichtag -->

### Datenschutz

Die Datenschutzerklärung beschreibt **ausschließlich die in Phase 1 nachgewiesene Verarbeitung**.
Es gibt keine Analytics, keine Tracking-Pixel, keine Google Fonts, kein Captcha, keine Karten, keine
Social-Embeds und keine Werbe-Tracker — dafür stehen **keine** Textbausteine in der Erklärung.

**Einwilligungsbanner:** Nach der Bestandsaufnahme werden ausschließlich **first-party**-Speicher
verwendet — Authentifizierungs-Cookies, Warenkorb im `localStorage`, eine Anzeigeeinstellung und
ein Zahlungs-Capability-Token im `sessionStorage`. Alle dienen einem vom Nutzer ausdrücklich
gewünschten Dienst. **Es wird deshalb kein Einwilligungsbanner eingebaut.** Ein Banner, das
Einwilligung für technisch erforderliche Speicherung einholt, wäre sachlich falsch und würde die
Einwilligung entwerten. <!-- offen: anwaltlich prüfen, insbesondere die Einordnung der
First-Party-Performance-Telemetrie -->

---

## 3. Das Vertragsschlussmodell — entschieden

Aus der tatsächlichen Implementierung (Phase 1, Abschnitt F) folgt genau ein widerspruchsfreies
Modell:

| Schritt | Was passiert technisch | Rechtliche Einordnung |
|---|---|---|
| 1 | Kunde drückt „Zahlungspflichtig bestellen"; `create_order()` legt die Bestellung an | **Angebot des Kunden** |
| 2 | `order_received`-Mail geht sofort raus | **Zugangsbestätigung** nach § 312i Abs. 1 Nr. 3 BGB — **ausdrücklich keine Annahme** |
| 3 | Kunde zahlt bei Stripe | Erfüllungshandlung, **keine** Annahme |
| 4 | Webhook bestätigt die Zahlung; `order_confirmation`-Mail geht raus | **Annahme des Verkäufers** → **Vertragsschluss** |
| 5 | Zahlung bleibt aus, Reservierung verfällt → `expired` | **keine Annahme, kein Vertrag** |
| 6 | Bestellung wird als `needs_resolution` markiert | **noch keine Annahme** — der Verkäufer prüft; die Annahme-Mail wird nicht ausgelöst |

**Warum dieses Modell und kein anderes.** Es ist das einzige, das ohne zusätzliche Schritte zur
vorhandenen Technik passt: Es gibt keinen separaten Annahmeakt, die einzige automatische Mail nach
der Zahlung ist die natürliche Annahmeerklärung, und der Fall „bezahlt, aber Bestand fehlt" bleibt
sauber, weil dort gerade **keine** Kundenmail ausgelöst wird.

**Ausdrücklich nicht gewählt:**

- *Der Klick auf den Button schließt den Vertrag.* Dann wäre der Verkäufer an jede Bestellung
  gebunden, auch an die, die er wegen fehlenden Bestands nicht erfüllen kann — genau der Fall, für
  den `needs_resolution` existiert.
- *Die Zahlung ist die Annahme.* Die Zahlung ist eine Handlung des **Kunden**; eine Annahme ist eine
  Erklärung des **Verkäufers**.
- *Stripe schließt den Vertrag.* Stripe ist Zahlungsdienstleister und nicht Vertragspartei.

**Was daraus folgt und umgesetzt wurde:** die neue Zugangsbestätigung, die Umbenennung der
bisherigen `payment_confirmation` zur **Annahme** mit entsprechendem Wortlaut, und AGB § 3, der
genau diese sechs Zeilen beschreibt.

---

## 4. Rechnungen

**Wann:** bei **bestätigter Zahlung**, also im selben Moment wie die Annahme. Vorher existiert kein
Vertrag, über den abzurechnen wäre; später gäbe es keinen natürlichen Auslöser.

**Nummer:** `SI-<Jahr>-<laufend>`, vergeben aus einer Datenbanksequenz je Kalenderjahr, unveränderlich.

**Unveränderlichkeit:** Die Rechnung wird aus dem **eingefrorenen Bestellzustand** erzeugt
(`orders_protect_immutable()` friert Beträge und Identität; `order_addresses` ist ein Schnappschuss)
und ihre Kopfdaten — Verkäuferangaben, Kundenangaben, Beträge — werden **zusätzlich** in
`invoices` gespeichert. Ändert der Verkäufer später seine Anschrift, ändert das **keine** bereits
ausgestellte Rechnung.

**Korrektur/Storno** ist in dieser Runde **nicht** gebaut. Das Schema ist aber so angelegt, dass
eine Korrekturrechnung später als **eigene Zeile mit Bezug auf die ursprüngliche** ergänzt werden
kann, statt eine ausgestellte Rechnung zu überschreiben.

**Zugriff:** über eine authentifizierte Route. Angemeldete Kunden über ihr Konto; Gäste über die
bereits vorhandene Capability-Architektur. **Nicht** über den öffentlichen `catalog`-Bucket, und
überhaupt nicht über Storage: die PDF wird bei jedem Abruf aus den gespeicherten,
unveränderlichen Daten erzeugt und gestreamt. Damit gibt es keine Datei, die versehentlich
öffentlich werden könnte.

**Die Kehrseite, benannt:** weil das PDF bei jedem Abruf neu entsteht, ändert eine Änderung am
Renderer die **Darstellung** auch bereits ausgestellter Rechnungen — die Daten bleiben, das
Dokument nicht. Die Rechnung wird deshalb **nicht** versioniert wie der Eigenbeleg, sondern
festgenagelt: Byte-Zahl und SHA-256 stehen in `invoice-format-stability.test.ts`, und jede weitere
Abweichung schlägt dort an (ADR-0123). Die steuerrechtliche Bewertung dieses Modells ist ein
offener Punkt — siehe Abschnitt 9.

---

## 5. Versionierung der Rechtstexte

Die Texte liegen als **Code** unter `src/lib/legal/` — versioniert, diffbar, überprüfbar. Jede
Fassung hat eine Kennung (`agb@2026-09-17`) und einen Inhalts-Hash.

Bei Bestellanlage wird ein **Schnappschuss** geschrieben: welche Fassungen von AGB und
Widerrufsbelehrung galten, und welche Verkäuferangaben zu diesem Zeitpunkt zutrafen. Damit lässt
sich später feststellen, welcher Text für eine konkrete Bestellung galt — und **eine historische
Bestellung zeigt nie auf einen später geänderten Text**.

Kein CMS, keine Redaktionsoberfläche: eine Textänderung ist ein Commit mit neuer Versionskennung.

---

## 6. Elektronische Widerrufsfunktion — Aufbau

Zwei Schritte, wie § 356a Abs. 1 bis 3 sie verlangt, plus die Eingangsbestätigung aus Abs. 4:

1. **Einstiegspunkt** „Vertrag widerrufen" — im Footer ständig erreichbar und auf jeder
   Bestelldetailseite, solange die Frist läuft.
2. **Schritt 1** — Bestellnummer, Name, E-Mail für die Eingangsbestätigung.
3. **Schritt 2** — Zusammenfassung und die Schaltfläche **„Widerruf bestätigen"**.
4. **Sofort danach** — Eingangsbestätigung per E-Mail mit dem **Inhalt der Erklärung** sowie
   **Datum und Uhrzeit des Eingangs**, und ein Nachweis auf dem Bildschirm.

**Gast und Konto gleich behandelt.** Ein Login wird **nicht** verlangt — das würde einem
Gastkäufer die gesetzliche Funktion verwehren. Die Identifikation erfolgt über Bestellnummer **und**
die auf der Bestellung hinterlegte E-Mail-Adresse.

**Keine Auskunft über fremde Bestellungen.** Die Antwort ist in jedem Fall dieselbe, ob die
Bestellung existiert oder nicht: „Wenn die Angaben zu einer Bestellung passen, ist der Widerruf
eingegangen." Damit lässt sich nicht durchprobieren, welche Bestellnummern es gibt.

**Und das Durchprobieren selbst ist begrenzt.** Weil die Funktion öffentlich sein *muss* — ein
Widerruf darf kein Konto voraussetzen —, zählt `withdrawal_attempts` jeden Aufruf: 10 je gleitender
Stunde und Aufrufer-Fingerabdruck, gezählt **bevor** feststeht, ob Bestellnummer und E-Mail passen.
Ein gedrosselter Aufruf erhält **dieselbe** Antwort wie ein Nichttreffer; auch „du wirst gedrosselt"
wäre ein Signal, aus dem sich etwas ableiten ließe. Die Grenze liegt weit über dem, was ein echter
Kunde braucht, der sich einmal vertippt.

**Die Drosselung verhindert keinen fristgerechten Widerruf.** Sie ist ein gleitendes Fenster, keine
Sperre; und der Weg über E-Mail oder Post an die Anschrift im Impressum bleibt unabhängig davon
offen — § 355 Abs. 1 BGB verlangt keine bestimmte Form.

**Widerruf ≠ Erstattung.** Der Widerruf ist ein **Ereignis**; die Erstattung ist ein **zweites,
späteres Ereignis**. Beide werden getrennt geführt — siehe ADR-0083 zum Ereignismodell.

---

## 7. Was bewusst **nicht** behauptet wird

- keine Telefonnummer
- kein Handelsregistereintrag, keine Registernummer
- keine Steuernummer (die USt-IdNr. genügt nach § 34a UStDV Nr. 2)
- keine Aufsichtsbehörde, keine Kammer, kein reglementierter Beruf
- keine Streitbeilegungsstelle, kein Link zur eingestellten ODR-Plattform
- keine Transportlaufzeit des Versanddienstleisters
- kein Auslandsversand
- keine Analytics, keine Werbung, kein Newsletter
- keine Barrierefreiheits-Konformitätserklärung
- keine Aussage, die Website sei „rechtssicher" oder „rechtskonform"

---

## 8. Barrierefreiheit in der Umsetzung

Semantische Überschriftenhierarchie, echte `<label>`-Verknüpfungen, sichtbarer Fokus, vollständige
Tastaturbedienung, Fehlermeldungen mit `role="alert"` und `aria-describedby`, kein reines
Farbsignal, Zielgrößen ≥ 44 px. Der Widerrufsablauf ist ohne Maus vollständig bedienbar.

---

## 8b. Spiele und Portale verkaufen — was vor dem ersten Verkauf zu klären ist

**Stand 2026-10-20.** Die Entscheidung, Spiele und Portale über den eigenen
Shop zu verkaufen, ist gefallen (ADR-0129); die Technik dafür ist vorbereitet
und **nirgends angewendet**. Dieser Abschnitt sagt, was **rechtlich** noch
offen ist — und was davon bereits technisch gesperrt wurde, damit es nicht
aus Versehen passiert.

### Was schon gesperrt ist, und zwar in der Datenbank

| Sperre | wo | Wirkung |
|---|---|---|
| **Keine Freigabe ohne USK-Angabe** | `seller_set_sale_release()` (`0139`) | ein Spiel ohne erfasste Alterskennzeichnung lässt sich nicht zum Verkauf freigeben. Heute trägt **keines** eine — also ist heute **kein Spiel** verkäuflich |
| **Keine Freigabe bei USK 18** | dieselbe Funktion | § 12 Abs. 3 JuSchG verlangt beim Versandhandel von Bildträgern „Keine Jugendfreigabe" die Sicherstellung, dass kein Minderjähriger sie erhält — Altersprüfung bei der Bestellung **und** eine Zustellung nur an Erwachsene. SkyIsles hat beides nicht. Für die Skylanders-Titel (USK 0 und 6) ist die Sperre ohne praktische Wirkung; sie kostet nichts und verhindert den einen Fall, der teuer wäre |
| **Keine Freigabe ohne Lieferumfang** | dieselbe Funktion | ein Angebot für gebrauchte Ware, das nicht sagt, was im Paket liegt, ist eine unvollständige Produktangabe |
| **Kein Widerspruch zwischen Zustand und Lieferumfang** | CHECK `shop_inventory_case_is_not_loose` | „mit Originalhülle" an einer als `lose` geführten Position ist ausgeschlossen |

### Was der Betreiber bestätigen muss

| Punkt | Warum offen | Wer entscheidet |
|---|---|---|
| **USK-Quelle und Erfassung** | Die Arbeitsmappe führt keine Alterskennzeichnung, und sie wird **nicht geraten**. Die amtliche Quelle ist die USK-Titeldatenbank; auf der Hülle steht sie ebenfalls. Beides ist Handarbeit. **Ohne Erfassung bleibt jedes Spiel gesperrt** | Betreiber |
| **Darstellung der USK-Kennzeichnung im Angebot** | § 12 Abs. 2 JuSchG verlangt die deutlich sichtbare Kennzeichnung auf Bildträger **und** Hülle; für den Fernabsatz muss die Einstufung im Angebot erkennbar sein. Ob das Kennzeichen als **Bild** (geschützte Zeichen der USK) oder als Text genügt, und ob eine Nutzungserlaubnis für die Zeichen nötig ist, ist **nicht geprüft** | anwaltliche Prüfung |
| **Steuerliche Behandlung gebrauchter Software** | Gleicher Verkäufer, gleiche Rechtsform, gebrauchte Ware — nach erstem Augenschein ändert sich gegenüber Figuren **nichts**. Das ist **keine steuerliche Beratung**. Insbesondere zu bestätigen: ob die bisherige Besteuerungsart unverändert gilt und ob Software daran etwas ändert | Betreiber / Steuerberater |
| **Erschöpfungsgrundsatz beim Weiterverkauf** | Der Weiterverkauf eines rechtmäßig in Verkehr gebrachten physischen Datenträgers ist nach § 17 Abs. 2 UrhG zulässig. Ob die Lizenzbedingungen des Herstellers daran etwas ändern und ob Online-Komponenten (Konten, Codes) mitverkauft werden dürfen, ist **nicht geprüft** und wird nicht zugesichert | anwaltliche Prüfung |
| **Beschreibung von Zustand und Lieferumfang** | Jede Angabe im Angebot ist eine **zugesicherte Eigenschaft**. Die fünf Werte (`Nur Spielmedium`, `Spielmedium mit Anleitung`, `Mit Originalhülle`, `Nur Portal`, `Portal mit USB-Kabel`) sind bewusst eng gefasst; ob sie für den eigenen Bestand ausreichen, weiß nur der Betreiber | Betreiber |
| **Plattformangabe bei Spielen** | Sie wird aus dem **Rohnamen** abgeleitet (`platformOf()`), nicht aus einem gepflegten Feld. Für ein Angebot ist sie eine Zusicherung. Vor dem ersten Verkauf ist je Titel zu bestätigen, dass die abgeleitete Plattform stimmt | Betreiber |
| **Keine Plattformangabe bei Portalen** | Die Arbeitsmappe führt Plattformköpfe über den Portalzeilen, aber das ist eine Lesehilfe und **keine nachgewiesene Kompatibilität** (ADR-0128). Es wird deshalb **keine** angezeigt. Soll eine erscheinen, muss sie erst gepflegt werden | Betreiber |
| **Widerruf** | Die Ausnahme für **versiegelte** Datenträger (§ 312g Abs. 2 Nr. 6 BGB) greift bei gebrauchter, geöffneter Ware **nicht**. Es bleibt beim gewohnten 14-tägigen Widerruf — also unverändert zur Figur. Zu **bestätigen**, nicht zu ändern | Betreiber / anwaltliche Prüfung |
| **Batterien bei Portalen** | Die kabellosen Portale werden mit Batterien betrieben. Ob beim Verkauf gebrauchter Geräte **ohne** Batterien Hinweispflichten nach BattG bestehen und ob eine Registrierung nötig ist, ist **nicht geprüft**. Der Lieferumfang nennt Batterien bewusst **nicht** | Betreiber / anwaltliche Prüfung |
| **Elektro­geräte (ElektroG)** | Ein Portal ist ein Elektrogerät. Für den Verkauf **gebrauchter** Geräte als Wiederverkäufer bestehen andere Pflichten als für Hersteller/Importeure; ob eine Registrierung oder ein Rücknahmehinweis nötig ist, ist **nicht geprüft** | Betreiber / anwaltliche Prüfung |

> **Keiner dieser Punkte ist technisch gelöst oder technisch lösbar.** Die
> Datenbank verhindert, dass ohne USK-Angabe, ohne Lieferumfang oder mit
> USK 18 freigegeben wird. Alles Übrige entscheidet der Betreiber, bevor er
> das erste Mal `seller_set_sale_release(..., true)` aufruft.
>
> **Der einfachste erste Schritt sind die Portale:** sie tragen keine
> Alterskennzeichnung, und D1 entfällt damit. Offen bleiben für sie 5b
> (Lieferumfang), BattG und ElektroG.

---

## 9. Offene Punkte

| Punkt | Warum offen | Wer entscheidet |
|---|---|---|
| **Transportlaufzeit** | Aus Repository und Geschäftsfakten nicht feststellbar. Versandzeit 1–2 Werktage ist belegt, die Zustelldauer von DHL/Hermes nicht. | Betreiber, ggf. nach Rücksprache mit den Versanddienstleistern |
| **Telefonnummer in der Widerrufsbelehrung** | Gestaltungshinweis 2 nennt „Telefonnummer". Es gibt keine. Sie wird nicht erfunden. | anwaltliche Prüfung |
| **Prozessorenregionen, AVV, Drittlandtransfers** | Nicht aus dem Repository ableitbar (Supabase, Vercel, Stripe, Resend) | Betreiber |
| **Aufbewahrungsfristen** | Nirgends definiert; handels- und steuerrechtliche Fristen sind zu bestimmen | Betreiber / Steuerberater |
| **Eigenbelege über Privatankäufe** | `0122`/`0123` erzeugen sie technisch. Ob die Form steuerlich anerkannt wird und welche Angaben das Finanzamt erwartet, ist nicht geprüft und wird nicht zugesichert. | Betreiber / Steuerberater |
| **Erneut gerendertes Rechnungs-PDF** | Die Rechnung wird bei jedem Abruf aus der unveränderlichen Zeile neu erzeugt; eine Korrektur am Renderer verändert damit die **Darstellung** bereits ausgestellter Rechnungen, während Nummer, Datum, Beträge und Pflichtangaben gleich bleiben. Konkret eingetreten: die Absenderzeile zeigt künftig `·` statt `?`, und ab elf Positionen standen vorher Gesamtbetrag, § 19-Satz und Ausstellerfuss nicht im Dokument (auf Production nicht aufgetreten — eine Rechnung, zwei Positionen). Ob ein solcher Beleg als unveränderte Rechnungskopie im Sinne der Aufbewahrungs- und Nachweispflichten gilt, ob die Korrektur fehlender Pflichtangaben rückwirkend wirkt und ob stattdessen ein Ausdruck zum Ausstellungszeitpunkt aufzubewahren ist, ist **nicht geprüft und wird nicht zugesichert**. Technisch abgesichert ist nur, dass sich die Darstellung nicht mehr **still** ändert (ADR-0123). | Betreiber / Steuerberater |
| **Absenderdaten privater Verkäufer** | Name und Anschrift einer Privatperson, die nie mit SkyIsles interagiert hat (`0121`). Die Datenschutzerklärung beschreibt Kunden und Bestellungen und erwähnt Ankäufe mit keinem Wort; Rechtsgrundlage, Informationspflicht und Löschfrist sind offen. | anwaltliche Prüfung / Betreiber |
| **Kontolöschung** | Nicht implementiert; Zusammenspiel mit der Aufbewahrung der Bestellungen zu klären | Betreiber |
| **BFSG-Ausnahme** | Beruht auf Beschäftigtenzahl und Umsatz zum Stichtag | anwaltliche Bestätigung |
| **Einordnung der Performance-Telemetrie** | First-Party, personenbezogen, ohne festgelegte Löschfrist | anwaltliche Prüfung |
| **Supabase-Auth-Mailvorlagen** | Außerhalb dieses Repositories konfiguriert; Wortlaut ungeprüft | Betreiber |

---

## 10. Quellen

Alle am 2026-09-17 abgerufen.

| Norm | Quelle |
|---|---|
| § 5 DDG | https://www.gesetze-im-internet.de/ddg/__5.html |
| § 312i BGB | https://www.gesetze-im-internet.de/bgb/__312i.html |
| § 312j BGB | https://www.gesetze-im-internet.de/bgb/__312j.html |
| § 312f BGB | https://www.gesetze-im-internet.de/bgb/__312f.html |
| § 356a BGB | https://www.gesetze-im-internet.de/bgb/__356a.html |
| § 475 BGB | https://www.gesetze-im-internet.de/bgb/__475.html |
| Art. 246a § 1 EGBGB | https://www.gesetze-im-internet.de/bgbeg/art_246a__1.html |
| Muster-Widerrufsbelehrung (Anlage 1) | https://www.gesetze-im-internet.de/bgbeg/art_253anlage_1.html |
| Muster-Widerrufsformular (Anlage 2) | https://www.gesetze-im-internet.de/bgbeg/art_253anlage_2.html |
| § 19 UStG | https://www.gesetze-im-internet.de/ustg_1980/__19.html |
| § 34a UStDV | https://www.gesetze-im-internet.de/ustdv_1980/__34a.html |
| § 36 VSBG | https://www.gesetze-im-internet.de/vsbg/__36.html |
| BFSG (Kleinstunternehmen) | https://www.bundesfachstelle-barrierefreiheit.de/DE/Fachwissen/Produkte-und-Dienstleistungen/Barrierefreiheitsstaerkungsgesetz |
| § 356a: Inkrafttreten 19.06.2026, BGBl. 2026 I Nr. 28 | https://www.noerr.com/de/insights/umsetzungsgesetz-zum-widerrufsbutton-veroeffentlicht |

Die letzte Zeile ist eine Kanzleiquelle und wird **nur** für das Inkrafttretensdatum und die
Fundstelle herangezogen; der **Normtext** selbst stammt aus gesetze-im-internet.de.
