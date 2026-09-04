# Roadmap

Stand: 2026-09-04.

Diese Datei begrenzt den Umfang. **Was hier unter LATER oder MARKETPLACE steht, wird jetzt
nicht gebaut** — auch nicht „schnell nebenbei", auch nicht „als Vorbereitung".
Vorbereitung heißt hier ausschließlich: keine Entscheidung treffen, die den späteren Schritt
unnötig erschwert.

---

## Produktvision

**PortalVault V1 ist eine Skylanders-Sammler- und Analyseplattform — kein Marketplace.**

Marketplace, Trading, Seller-Funktionen und Payments gehören ausdrücklich **nicht** zum ersten
Produkt (ADR-0021).

### Produktprinzipien für V1

1. **Der zentrale Einstieg ist ein visueller Skylanders-Katalog.** Nicht eine Suchmaske, nicht
   eine Tabelle — Bilder.
2. **Figuren sind nach Spiel/Serie und Kategorie organisiert**, in der Reihenfolge aus dem
   Legacy-System (`docs/SKYLANDERS_DATA.md`, Abschnitt 3).
3. **Benutzer sollen ihre Sammlung sehr schnell erfassen können.** Das ist die zentrale
   Anforderung, aus der die übrigen folgen.
4. **Kerninteraktion im Katalog:** Figur antippen → als owned markieren. Erneut antippen →
   aus der Sammlung entfernen. **Der Zustand muss visuell sofort eindeutig sein.**
5. **Das UI wird besonders auf Mobile für schnelles Erfassen optimiert.**
6. **Es gibt eine eigene Seite „Meine Sammlung".**
7. **Für die Sammlung sind langfristig mehrere Darstellungen vorgesehen:** visuelles Grid mit
   Bildern · kompakte Ansicht · Tabellenansicht.
8. **Fortschritt wird insgesamt und pro Serie sichtbar.**
9. **Mengen und Duplikate werden technisch unterstützt.** Das Datenmodell kann es bereits
   (`collection_items.quantity`, ADR-0005). **Ob die Funktion Free oder Premium wird, ist noch
   keine Produktentscheidung.**
10. **Analytics später:** Marktwerte, gesamter Sammlungswert, Wert pro Serie und weitere
    Sammlungsstatistiken.

### Free und Premium — Richtung, keine Entscheidung

- **Free muss ein eigenständiges, dauerhaft nützliches Produkt sein** — keine Demo, keine
  künstlich beschnittene Testversion.
- **Free-Kern mindestens:** Katalog, persönliche Sammlung, Owned/Not-Owned, grundlegender
  Fortschritt.
- Eine **optionale günstige Premium-Stufe** ist als spätere Monetarisierungsrichtung vorgesehen.
- **Denkbare** Premium-Mehrwerte: Mengen/Duplikate · Marktpreise · Gesamtwert · Wert je Serie ·
  erweiterte Analytics · Preisentwicklung · Export.
- ⚠️ **Die Feature-Grenze und der Preis sind ausdrücklich NICHT entschieden.**
  Insbesondere „0,99 €/Monat" ist bisher **nur eine Idee**, keine Produktentscheidung (ADR-0022).

### Acquisition

Erster realistischer Nutzerkanal ist der **bestehende eBay-Skylanders-Shop** des Nutzers:
kleine PortalVault-QR-Codes oder Hinweise können Paketen beigelegt werden. Käufer gelangen
dadurch **genau in dem Moment** zur Plattform, in dem sie neue Figuren in der Hand halten.

**Daraus folgt eine harte UX-Anforderung, keine Marketing-Notiz:** Das Hinzufügen mehrerer
frisch gekaufter Figuren muss **mobil sehr schnell und einfach** sein. Wer gerade ein Paket
auspackt, tippt am Handy — nicht am Schreibtisch. Genau deshalb ist der Owned-Toggle aus
Prinzip 4 eine Anforderung an das Katalog-UI und nicht an eine spätere Ausbaustufe.

---

## NOW — der aktuelle Abschnitt

- [x] Legacy-Projekt `../webpage` read-only analysiert
- [x] Architektur-, Migrations- und Sicherheitsplan erstellt
- [x] Projektgedächtnis angelegt: `CLAUDE.md`, `PROJECT_STATUS.md`, `docs/`
- [x] Freigaberunde 1: ADR-0002, 0006, 0009, 0011, 0012, 0013, 0015–0018 entschieden
- [x] Freigaberunde 2: ADR-0005, 0010, 0014, 0016 entschieden · ADR-0019 Projektsprache
- [x] **V1.1 — Next.js-Grundgerüst** (siehe unten)
- [x] **V1.2A/B — Datenbankschema ausgeführt und strukturell verifiziert**
- [x] **V1.2C — RLS funktional verifiziert (31/31)**
- [x] **V1.3 — Katalog importiert und verifiziert**
- [x] **V1.4 — Auth gebaut und vollständig verifiziert**
- [x] **V1.5 — Katalog und Sammlung, End-to-End-Fluss verifiziert**
- [ ] Freigabe für V1.6

Noch nicht: Supabase verbinden, SQL, Datenimport, Bilder kopieren, Auth, Deployment.

---

## V1 — erste nutzbare Version

**Zielbild als ein Satz:** Ein Sammler öffnet PortalVault am Handy, sieht den visuellen
Katalog, tippt die Figuren an, die er besitzt, und sieht seinen Fortschritt.

Kein Handel, kein Marketplace, keine Community-Funktionen.

**Die Reihenfolge der Meilensteine ist auf den End-to-End-Fluss ausgerichtet** (ADR-0023):
zuerst die Daten, dann die Sitzung, dann der Fluss selbst. Nach **V1.5** ist
*Registrieren → Einloggen → Katalog → Figur antippen → Sammlung sehen* vollständig erlebbar.

### V1.1 Fundament — **abgeschlossen 2026-09-03**
- [x] Next.js (App Router) + TypeScript + Tailwind, lokal lauffähig
- [x] sichere `.gitignore`, `.env.example` ohne echte Secrets
- [x] npm-Skripte: `dev`, `build`, `start`, `lint`, `typecheck`, `check`
- [x] Grundlayout (`lang="de"`), zentrale Texte (`src/lib/i18n/de.ts`), Formatierung
      (`src/lib/format.ts`, `de-AT`)
- [ ] Navigation, Fehler- und Ladezustände — kommen mit dem Katalog-UI (V1.5)

### V1.2 Datenbank
- **V1.2A** ✅ Migration `0001_initial_schema.sql` geschrieben und statisch geprüft
- **V1.2B** ✅ Supabase-Projekt in EU-Region angelegt (ADR-0015), Migration ausgeführt und
  strukturell verifiziert
- **V1.2C** ✅ Funktionale RLS-Verifikation mit zwei echten JWT-Sessions: 31/31 bestanden
  (`npm run verify:rls`). `@supabase/ssr` bewusst offen gelassen — es wird erst für das
  Auth-UI (V1.4) gebraucht.
- Tabellen: `series`, `categories`, `skylanders`, `profiles`, `collection_items`
- RLS-Policies und Trigger für die Profilanlage
- Verifikation mit zwei Testkonten: fremde Sammlung weder lesbar noch änderbar

### V1.3 Katalogimport
- `tools/import-catalog.ts`: Dry-Run, Upsert per `sky_id`, Validierung, Transaktion
- 600 Artikel, 6 Serien, 30 Kategorien importiert
- 475 WebP-Derivate nach `public/images/skylanders/`
- Nachprüfung: Anzahl, keine doppelte ID, alle Bildreferenzen auflösbar

### V1.4 Auth + `@supabase/ssr` — **abgeschlossen 2026-09-04**

Die Sitzungsschicht steht, bevor Seiten entstehen, die von ihr abhängen (ADR-0023).
Automatisiert und in einem manuellen Durchlauf mit echter E-Mail-Adresse verifiziert.
**Umsetzung und Verifikation: `docs/AUTH.md`, Abschnitt 9.**

- `@supabase/ssr` einbinden: Browser-Client, Server-Client, Middleware
- Registrierung
- E-Mail-Bestätigung
- Login
- Logout
- Passwort vergessen / zurücksetzen (und ändern im eingeloggten Zustand)
- Onboarding: eindeutigen Benutzernamen setzen; Änderung des Namens technisch möglich (ADR-0016)
- Geschützter Bereich (Middleware als Komfort, RLS als Grenze)

Konzept vollständig in `docs/AUTH.md`. Beleg aus V1.2C: das Projekt verlangt
E-Mail-Bestätigung, `signUp` liefert also **keine** sofortige Session.

**Sichtbares Ergebnis:** noch keines für Besucher — das ist der bewusst in Kauf genommene Preis
dafür, dass V1.5 den vollständigen Fluss liefert statt nur einen Katalog zum Anschauen.

### V1.5 Öffentlicher Katalog + Sammlung — **abgeschlossen 2026-09-04**

Automatisiert und in einem manuellen Browser-Durchlauf über 34 Punkte verifiziert.
**Der End-to-End-Fluss steht.**

> Katalog öffnen → Figur finden → als gesammelt markieren → falls nötig anmelden →
> eigene Sammlung sehen

- **`/` ist der Katalog** (ADR-0025), ohne Konto vollständig nutzbar: alle aktiven Figuren,
  Bild, Name, Serie, Marktwert
- Suche und Serienfilter clientseitig, Katalog vollständig serverseitig geladen (ADR-0026)
- Sortierung Serie → Kategorie → Name, wie im Legacy-System
- **Owned-Toggle**: `+ Sammlung` / `✓ Gesammelt`, optimistisch, Mutation als Endzustand
  (ADR-0027). Keine Wunschlisten-Semantik
- Ohne Anmeldung führt die Aktion zu Login/Registrierung und **zurück in denselben Kontext**;
  die Aktion wird nicht automatisch nachgeholt (ADR-0027)
- Detailseite `/skylanders/<slug>` — minimal, nur kanonische Daten
- **`/collection`** (geschützt): Anzahl unterschiedlicher Figuren, Gesamtzahl aktiver
  Katalogfiguren, Fortschritt, Sammlungswert aus `market_price`, Figurenraster
- **Entfernen an jeder gesammelten Figur, auch auf `/collection`** (ADR-0031) — kein
  Bestätigungsdialog, dafür „Rückgängig" an der abgeblendeten Karte; die Zahlen rechnen
  sofort mit. Dieselbe Server Action wie im Katalog, keine eigene Toggle-Logik
- `/dashboard` leitet auf `/collection` weiter, damit alte Links nicht brechen
- Fehlendes Bild → stabiler Platzhalter · fehlender Preis → `–` und nicht in der Wertsumme
- Bereits besessene, inaktive Figuren verschwinden **nicht** still aus der Sammlung
- Gemeinsame responsive Navigation, mobile-first, ein Komponentensatz
- **SkyIsles** als sichtbarer Produktname (ADR-0028)

**Nicht in V1.5:** Mengen-/Duplikat-UI (`quantity` wird aber in allen Berechnungen korrekt
berücksichtigt; Entfernen löscht deshalb immer die ganze Zeile) · weitere Sammlungsansichten ·
Fortschritt je Serie · Playwright.

### V1.6 Ausbau

- **Mehrere Sammlungsansichten**: kompakte Ansicht und Tabellenansicht neben dem Grid (Prinzip 7)
- **Fortschritt pro Serie** (gesamt bereits in V1.5)
- Kategorie-Zwischenüberschriften im Katalog
- Filter und Sortierung innerhalb der eigenen Sammlung
- **Playwright**, sobald die Sammlungs-UX steht (ADR-0013)
- **Mengen/Duplikate technisch unterstützen** (Prinzip 9) — das Datenmodell kann es bereits
  (`collection_items.quantity`, ADR-0005). **Ob Free oder Premium: offen** (ADR-0022).
  Dabei die offene Grenze aus ADR-0031 mitlösen: Entfernen löscht heute die ganze Zeile und
  ein „Rückgängig" fügt mit `quantity: 1` wieder ein — mit einer Mengen-UI wäre das Datenverlust
- **Mobile-Feinschliff**
- Weitere Collection-UX: Filter und Suche innerhalb der eigenen Sammlung, Sortierung
- Kennzahlen: verschiedene Figuren, Gesamtanzahl
- Wert immer aus dem zentralen Marktpreis berechnet, nie gespeichert (ADR-0010)

### V1.7 Beta-Reife
- Tests für Berechnungen und Importregeln
- Prüfung als anonymer Besucher: welche Daten gibt die API heraus?
- Impressum, Datenschutzerklärung
- Produktiven E-Mail-Versand entscheiden und einrichten (ADR-0018) — externer Dienst,
  braucht ausdrückliche Freigabe
- Erst dann: Deployment auf Vercel — **nur nach ausdrücklicher Freigabe**

---

## LATER — nach V1, vor dem Marketplace

**Analytics und Premium**

- Sammlungsanalytik: Gesamtwert der Sammlung, Wert je Serie, Marktwerte je Figur, weitere
  Sammlungsstatistiken (Prinzip 10)
- Preisentwicklung über die Zeit (setzt `price_history` voraus)
- Export der eigenen Sammlung
- Optionale Premium-Stufe — **Feature-Grenze und Preis nicht entschieden** (ADR-0022)

**Sammlungsdarstellung**

- Kompakte Ansicht und Tabellenansicht neben dem visuellen Grid (Prinzip 7)
- Filter und Suche innerhalb der eigenen Sammlung

**Eigener Shop (First Party) — ausdrücklich nicht in V1**

PortalVault kann später **zusätzlich einen eigenen Shop** enthalten, über den der Betreiber
seinen eigenen Skylanders-Bestand direkt verkauft.

**Das ist ausdrücklich kein Peer-to-Peer-Marketplace.** Der Unterschied ist strukturell, nicht
graduell:

| | Eigener Shop | Marketplace |
|---|---|---|
| Verkäufer | **einer** — der Betreiber | viele Sammler |
| Bestand | eigener Geschäftsbestand | fremde Sammlungen |
| Nötig | Artikelbestand, Bestellung, Versand | zusätzlich Verkäuferprofile, Matching, Bewertungen, Streitfälle |

**Verbindliche Randbedingungen:**

- **Shop-Inventar ist strikt getrennt von der persönlichen Sammlung.** `collection_items`
  beschreibt, was ein Sammler besitzt — niemals, was verkäuflich ist.
- **Die Legacy-Felder `inventory` und `available` werden jetzt nicht migriert** (ADR-0008 gilt
  unverändert).
- **Wird der Shop umgesetzt, bekommt er ein eigenes Datenmodell und eine neue
  Architekturentscheidung.** Er wird nicht in bestehende Tabellen hineingebaut.
- **Der Shop darf V1, Auth und den Collection Tracker jetzt nicht beeinflussen** — weder im
  Datenmodell noch in der Meilensteinplanung.
- **Die Priorität bleibt vollständig beim kostenlosen Collection Tracker.**

Ein Berührungspunkt, der dann neu zu entscheiden wäre: Ein Shop braucht Lagerbestand und
Verfügbarkeit. Beides existiert im Legacy-System (Spalten D/E/F, `available`) und wurde per
ADR-0008 bewusst nicht übernommen. Das wieder aufzugreifen wäre eine **neue** Entscheidung,
keine Rücknahme von ADR-0008.

**Community-Ebene — ausdrücklich nicht in V1**

Denkbar, aber **jetzt nicht zu implementieren**: „Gesucht" und „Abzugeben" als Zustände an der
eigenen Sammlung, Matching zwischen Sammlern und direkte Kommunikation zwischen ihnen.

Das ist bewusst von der Marketplace-Ebene getrennt: Community heißt hier *finden und reden*,
nicht *kaufen und bezahlen*. Ob und wann daraus etwas wird, hängt an derselben Bedingung wie
beim Marketplace — nachweisliche Nutzung der Sammlungsplattform (ADR-0021).

**Weitere**

- Öffentliche Benutzerprofile und öffentlich schaltbare Sammlungen (in V1 ausgeschlossen)
- Zustand je Exemplar (OVP, lose, beschädigt) → Unique-Index auf `collection_items` entfernen
- Preisverlauf und historische Marktpreise (`price_history`)
- Mehrere Preisquellen, teilautomatisierte Preisermittlung
- Admin-Bereich für Katalogpflege (Ablösung der Excel als Katalogquelle)
- Sortiments-Erweiterung: `ZB`, Disney Infinity — nur nach ausdrücklicher Entscheidung
- Englische Sprachversion / i18n — in V1 ausdrücklich nicht gebaut, aber offengehalten (ADR-0012)
- Redirects bei Slug-Änderungen (`skylander_slug_history`) — Andockpunkt steht (ADR-0011)
- End-to-End-Tests mit Playwright, sobald Auth und Sammlung stabil sind (ADR-0013)
- Google-/Apple-Login
- Preisalarme

---

## MARKETPLACE — an eine Bedingung geknüpft, nicht nur an einen Zeitpunkt

**Marketplace, Trading, Seller-Funktionen, Payments, Versand, Bewertungen und Disputes sind
nicht Bestandteil von PortalVault V1** (ADR-0021).

**Diese Richtung wird erst dann erneut bewertet, wenn PortalVault nachweislich echte Nutzer
gewinnt und die Sammlungsplattform angenommen wird.** Das ist bewusst eine Bedingung und kein
Datum: „später" lädt dazu ein, doch schon mal etwas vorzubereiten. Vor diesem Nachweis wird an
Marketplace-Funktionen **nicht** gearbeitet — auch nicht konzeptionell, auch nicht „nur das
Datenmodell".

Nichts davon beeinflusst V1 über die in `docs/DATABASE.md`, Abschnitt 7 dokumentierten
Andockpunkte hinaus.

- Angebote und eigene Verkaufspreise (`listings`)
- Matching zwischen Sammlern, Tausch-Matching, Vergleich von Tauschwerten
- Multi-Item-Suche: Verkäufer finden, die möglichst viele gesuchte Figuren gleichzeitig haben;
  Optimierung auf möglichst wenige Pakete
- Preisvergleich zwischen Anbietern
- Verkäuferprofile, Bewertungen, Nachrichten
- Bestellungen, Versand, Zahlungsabwicklung über einen externen Payment-Provider
- Streitfälle und Rückabwicklung
- Mobile App
- Bilderkennung von Skylanders

Für die Bilderkennung gilt die Legacy-Regel weiter: **Vorschläge ja, automatische Zuordnung
nein.** Die finale SKY-ID-Zuordnung trifft immer ein Mensch.

---

## Ausdrücklich nicht geplant

- Übernahme der Lagerverwaltung aus dem Legacy-Projekt
- Ankaufsrechner / Ankauffaktor in PortalVault (siehe ADR-0008)
- Ein eigenes Passwortsystem
- Ein eigener Backend-Service neben Supabase
- Microservices, GraphQL, eigene ORM-Abstraktionsschicht, State-Management-Bibliothek
