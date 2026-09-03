# CLAUDE.md — Arbeitsanweisung für Claude Code in PortalVault

Diese Datei sagt dir, **wie** du in diesem Repository arbeitest und **wo** das Wissen liegt.
Sie ist bewusst kurz. Architekturdetails stehen in `docs/`, nicht hier.

---

## Was PortalVault ist

Webplattform für Skylanders-Sammler. Zentraler öffentlicher Katalog mit Marktpreisen,
Benutzerkonten und persönlicher Sammlungsverwaltung.

**Produktziel V1:** Katalog + Accounts + Sammlung. **Kein Marketplace.**
Handel, Tausch, Angebote und Zahlungen kommen deutlich später (siehe `docs/ROADMAP.md`).

PortalVault löst ein bestehendes, funktionierendes Legacy-Projekt ab (statische Seite,
Excel als Source of Truth). Das Legacy-Projekt liegt unter `../webpage`.

---

## Tech Stack (Stand: 2026-09-03)

| Bereich | Technologie |
|---|---|
| Frontend | Next.js (App Router), TypeScript, Tailwind CSS |
| Daten | Supabase (PostgreSQL), Supabase Auth, Row Level Security |
| Hosting | Vercel (noch nicht eingerichtet) |
| Versionierung | Git / GitHub (`git@github.com:julian-stocker/portalVault.git`) |

Installiert und lauffähig: Next.js 16 (App Router, Turbopack), React 19, TypeScript,
Tailwind CSS v4, ESLint 9. Supabase ist **noch nicht** angebunden.
Der aktuelle Stand steht in `PROJECT_STATUS.md`.

```bash
npm run dev        # Entwicklungsserver
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit
npm run build      # Production Build
npm run check      # lint + typecheck + build  ← nach jeder relevanten Änderung
```

---

## Kritische Regeln — ohne Ausnahme

### 1. `../webpage` ist STRICT READ-ONLY

Lesen und analysieren: erlaubt. **Alles andere ist verboten:** ändern, löschen, verschieben,
umbenennen, formatieren, erzeugen, Skripte ausführen, die schreiben könnten, Git initialisieren,
Preisupdates laufen lassen, Excel anfassen.

Wenn du bei einem Befehl nicht sicher bist, ob er dort etwas verändern könnte:
**führe ihn nicht aus.** Das Legacy-Projekt ist unsere Sicherheitskopie der funktionierenden
Implementierung.

### 2. SKY-IDs sind dauerhafte Identitäten

Format `SKY-0001` … `SKY-0820`. Eine SKY-ID wird **niemals**:
aus Name, Slug, Bild, Zeilennummer oder Kategorie abgeleitet · neu vergeben ·
wiederverwendet · automatisch geändert.

Eine Umbenennung ändert die Identität nicht. Details: `docs/SKYLANDERS_DATA.md`.

### 3. Keine Secrets, keine internen Daten

- `.env*` niemals committen (Ausnahme: `.env.example` ohne echte Werte)
- Service-Role-Key niemals in Client-Code, niemals mit `NEXT_PUBLIC_` präfixen
- Niemals ins Repository oder ins Deployment: `skylanders.xlsx`, Lagerzahlen, Käuferdaten,
  Order-/EÜR-Daten, private Sammlungsdaten aus dem Legacy-System, Mappings, Scraper-Logik,
  Backups. Vollständige Liste: `docs/SECURITY.md`

**Prinzip aus dem Legacy-Projekt, das erhalten bleibt:** Interne Daten werden nicht versteckt —
sie sind gar nicht erst im ausgelieferten Bundle bzw. gar nicht erst in der Datenbank.

### 4. Namen und Kategorien nicht „korrigieren"

Artikelnamen und Kategorienamen kommen vom Nutzer bzw. aus der Legacy-Quelle — roh, ohne
`strip()`, ohne Normalisierung, ohne Übersetzung, ohne stillschweigende Korrektur.

### 5. Projektsprache: **Code englisch, Oberfläche deutsch** (ADR-0019)

**Englisch — verbindlich für alles Technische:** Ordner- und Dateinamen, Variablen, Funktionen,
Klassen, Typen, Interfaces, Tabellen- und Spaltennamen, routeninterne und API-Benennung,
**Kommentare**, Testnamen, Migrationsnamen, Skriptnamen, **Commit-Messages**.

Keine deutschen technischen Bezeichner einführen:

| So | Nicht so |
|---|---|
| `collection_items`, `market_price`, `image_file`, `user_id`, `sky_id` | `sammlung`, `marktpreis`, `bild_datei`, `benutzer_id` |
| `formatPrice()`, `getCollectionValue()` | `berechneSammlungswert()` |

**Deutsch — nur benutzersichtbare Inhalte:** Navigation, Buttons, Überschriften,
Formularbeschriftungen, Validierungsmeldungen, Erklärtexte, sichtbare Seitenmetadaten.
Schlüssel englisch, Wert deutsch: `auth: { loginButton: "Anmelden" }`.

**Wo Texte hingehören:** `src/lib/i18n/de.ts`, nicht ins JSX. Formatierung über
`src/lib/format.ts` (Locale `de-AT`). Kein i18n-Framework in V1 (ADR-0012) — aber der englische
Codebase sorgt dafür, dass eine spätere englische Version keine Umbenennung erfordert.

**Ausnahme:** `docs/` und diese Datei bleiben auf Deutsch (Arbeitsgrundlage des Nutzers,
zitieren das deutschsprachige Legacy-System). Technische Bezeichner darin sind trotzdem
englisch. Bereits korrekt englische Namen werden **nicht** aus stilistischen Gründen umbenannt.

---

## Arbeitsweise

1. Anforderung verstehen
2. `CLAUDE.md` → `PROJECT_STATUS.md` → relevante `docs/` lesen
3. Bestehenden Code untersuchen
4. Kleinste sinnvolle Änderung planen
5. Implementieren
6. `npm run check` (Lint, Typecheck, Build) plus Unit-Tests kritischer Geschäftslogik
   und Tests sicherheitskritischer RLS-Regeln, sobald es sie gibt (ADR-0013)
7. Ergebnis prüfen
8. Relevante Dokumentation aktualisieren
9. Änderungen zusammenfassen, erst dann Commit vorbereiten

Keine großen unkontrollierten Umbauten. Keine Architekturänderung aus Präferenz.
Keine unnötige technische Komplexität — einfache, etablierte Lösungen bevorzugen.
Der Nutzer hat Python-Erfahrung, aber wenig Erfahrung mit moderner Webentwicklung:
Code soll lesbar, modular und kommentiert sein.

## Dokumentationspflichten

| Änderung an | Datei aktualisieren |
|---|---|
| Datenbank / Schema / Migrationen | `docs/DATABASE.md` |
| Auth / Sessions / Profile | `docs/AUTH.md` |
| Security / RLS / Secrets | `docs/SECURITY.md` |
| Skylanders-Datenregeln, Import, Bilder, Preise | `docs/SKYLANDERS_DATA.md` |
| Gesamtarchitektur, Systemgrenzen, Datenfluss | `docs/ARCHITECTURE.md` |
| Abgeschlossenes größeres Feature | `PROJECT_STATUS.md` |
| Wichtige Architekturentscheidung | `docs/DECISIONS.md` |

Weitere Regeln:
- Dokumentation muss den **tatsächlichen** Codezustand widerspiegeln. Veraltete Aussagen
  werden ersetzt, nicht angehängt.
- Git ist die Historie einzelner Codeänderungen. `docs/` erklärt System, Regeln und Gründe —
  nicht jedes Commit.
- Keine überflüssige Dokumentation erzeugen.
- Widersprechen sich Doku und Code, **keiner Seite blind vertrauen**: Widerspruch untersuchen
  und melden.
- Wichtige Entscheidungen niemals nur im Session-Kontext lassen → `docs/DECISIONS.md`.

## Vor Architekturänderungen

Erst `docs/DECISIONS.md` lesen. Eine dort dokumentierte Entscheidung wird nicht ohne
Begründung umgeworfen. Neue Entscheidung → neuer Eintrag mit Status, Begründung, Konsequenzen.

---

## Wann du den Nutzer fragen musst — vorher, nicht danach

- grundlegende Architekturänderungen · Änderung des Tech Stacks
- Änderungen am SKY-ID-Konzept
- destruktive Datenbankmigrationen · Löschen oder Umstrukturieren von Daten
- irgendeine Änderung an `../webpage`
- produktive Deployments · produktive Preisupdates
- Änderungen an Datenschutz- oder Security-Grundprinzipien
- Einführung kostenpflichtiger externer Dienste
- Übertragung sensibler Daten an externe APIs
- Entscheidungen mit erheblichen Marketplace-Auswirkungen

Unklar, aber leicht reversibel und risikoarm → sinnvolle Standardlösung vorschlagen und
umsetzen. Schwer reversibel oder sicherheitskritisch → **erst fragen**.

---

## Dokumentationsübersicht

| Datei | Inhalt |
|---|---|
| `PROJECT_STATUS.md` | aktueller Zustand, offene Punkte, nächster Schritt |
| `docs/ARCHITECTURE.md` | Gesamtarchitektur, Systemgrenzen, Datenfluss |
| `docs/DATABASE.md` | PostgreSQL-Datenmodell, Tabellen, Beziehungen |
| `docs/AUTH.md` | Supabase Auth, Registrierung, Sessions, geschützte Routes |
| `docs/SECURITY.md` | Sicherheitsgrenzen, RLS, Secrets, verbotene Daten |
| `docs/SKYLANDERS_DATA.md` | SKY-ID-System, Legacy-Datenregeln, Migration |
| `docs/ROADMAP.md` | NOW / V1 / LATER / MARKETPLACE |
| `docs/DECISIONS.md` | Architecture Decision Log |
