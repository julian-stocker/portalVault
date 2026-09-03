# Roadmap

Stand: 2026-09-03.

Diese Datei begrenzt den Umfang. **Was hier unter LATER oder MARKETPLACE steht, wird jetzt
nicht gebaut** — auch nicht „schnell nebenbei", auch nicht „als Vorbereitung".
Vorbereitung heißt hier ausschließlich: keine Entscheidung treffen, die den späteren Schritt
unnötig erschwert.

---

## NOW — der aktuelle Abschnitt

- [x] Legacy-Projekt `../webpage` read-only analysiert
- [x] Architektur-, Migrations- und Sicherheitsplan erstellt
- [x] Projektgedächtnis angelegt: `CLAUDE.md`, `PROJECT_STATUS.md`, `docs/`
- [x] Freigaberunde 1: ADR-0002, 0006, 0009, 0011, 0012, 0013, 0015–0018 entschieden
- [x] Freigaberunde 2: ADR-0005, 0010, 0014, 0016 entschieden · ADR-0019 Projektsprache
- [x] **V1.1 — Next.js-Grundgerüst** (siehe unten)
- [ ] Freigabe für V1.2

Noch nicht: Supabase verbinden, SQL, Datenimport, Bilder kopieren, Auth, Deployment.

---

## V1 — erste nutzbare Version

Ziel: Ein Sammler kann den Katalog durchsuchen, ein Konto anlegen und seine Sammlung
verwalten. Kein Handel, kein Marketplace, keine Community-Funktionen.

### V1.1 Fundament — **abgeschlossen 2026-09-03**
- [x] Next.js (App Router) + TypeScript + Tailwind, lokal lauffähig
- [x] sichere `.gitignore`, `.env.example` ohne echte Secrets
- [x] npm-Skripte: `dev`, `build`, `start`, `lint`, `typecheck`, `check`
- [x] Grundlayout (`lang="de"`), zentrale Texte (`src/lib/i18n/de.ts`), Formatierung
      (`src/lib/format.ts`, `de-AT`)
- [ ] Navigation, Fehler- und Ladezustände — kommen mit dem Katalog-UI (V1.4)

### V1.2 Datenbank
- Supabase-Projekt in einer **EU-Region** anlegen (ADR-0015)
- Schema nach `docs/DATABASE.md` — alle Entscheidungen dafür sind freigegeben
- Erste Migration: `series`, `categories`, `skylanders`, `profiles`, `collection_items`
- RLS-Policies und Trigger für die Profilanlage
- Verifikation mit zwei Testkonten: fremde Sammlung weder lesbar noch änderbar

### V1.3 Katalogimport
- `tools/import-catalog.ts`: Dry-Run, Upsert per `sky_id`, Validierung, Transaktion
- 600 Artikel, 6 Serien, 30 Kategorien importiert
- 475 WebP-Derivate nach `public/images/skylanders/`
- Nachprüfung: Anzahl, keine doppelte ID, alle Bildreferenzen auflösbar

### V1.4 Öffentlicher Katalog
- Startseite
- Katalogseite: Serien, Kategorien, Suche, Filter, Sortierung (Reihenfolge wie im Legacy)
- Detailseite je Figur (`/skylanders/<slug>`) mit Bild, Serie, Kategorie, Marktpreis
- Ohne Login vollständig nutzbar

### V1.5 Benutzerkonten
- Registrierung, E-Mail-Verifizierung, Login, Logout
- Passwort vergessen / zurücksetzen / ändern
- Onboarding: eindeutigen Benutzernamen setzen
- Profilseite, geschütztes Dashboard

### V1.6 Persönliche Sammlung
- Figur hinzufügen / entfernen, Menge ändern
- Sammlungsansicht mit Filter und Suche
- Kennzahlen: verschiedene Figuren, Gesamtanzahl, geschätzter Marktwert
- Fortschritt je Serie und gesamt
- Wert immer aus dem zentralen Marktpreis berechnet, nie gespeichert

### V1.7 Beta-Reife
- Tests für Berechnungen und Importregeln
- Prüfung als anonymer Besucher: welche Daten gibt die API heraus?
- Impressum, Datenschutzerklärung
- Produktiven E-Mail-Versand entscheiden und einrichten (ADR-0018) — externer Dienst,
  braucht ausdrückliche Freigabe
- Erst dann: Deployment auf Vercel — **nur nach ausdrücklicher Freigabe**

---

## LATER — nach V1, vor dem Marketplace

- Öffentliche Benutzerprofile und öffentlich schaltbare Sammlungen (in V1 ausgeschlossen)
- Wunschliste („Suche ich")
- „Verkaufe ich" / „Tausche ich" als Zustandskennzeichnung ohne Handelsabwicklung
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

## MARKETPLACE — deutlich später, eigenes Projekt innerhalb des Projekts

Nichts davon beeinflusst V1 über die in `docs/DATABASE.md`, Abschnitt 7 dokumentierten
Andockpunkte hinaus.

- Angebote und eigene Verkaufspreise (`listings`)
- Matching zwischen Sammlern, Tausch-Matching, Vergleich von Tauschwerten
- Multi-Item-Suche: Verkäufer finden, die möglichst viele gesuchte Figuren gleichzeitig haben;
  Optimierung auf möglichst wenige Pakete
- Preisvergleich zwischen Anbietern
- Verkäuferprofile, Bewertungen, Nachrichten
- Bestellungen, Versand, Zahlungsabwicklung über einen externen Payment-Provider
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
