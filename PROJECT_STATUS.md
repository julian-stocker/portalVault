# Projektstatus — PortalVault

Stand: 2026-09-03 · beschreibt den **aktuellen** Zustand, nicht die Historie.
Die vollständige Änderungshistorie liegt in Git.

---

## Aktuelle Phase

**V1.1 — Fundament. Abgeschlossen.**

Das Next.js-Grundgerüst steht, baut und läuft. Es gibt noch keine Fachlogik, keine
Datenbankanbindung und keine Katalogdaten.

Wartet auf Freigabe für **V1.2 — Datenbank**.

---

## Aktuell implementiert

| | |
|---|---|
| Next.js 16.3.4, App Router, Turbopack | ✅ |
| React 19.2.8, TypeScript 5 (`strict`) | ✅ |
| Tailwind CSS v4, ESLint 9 (`eslint-config-next`) | ✅ |
| Import-Alias `@/*` → `src/*` | ✅ |
| Sichere `.gitignore` (Secrets, Excel, interne Legacy-Daten) | ✅ |
| `.env.example` mit Platzhaltern, ohne echte Werte | ✅ |
| npm-Skripte `dev` · `build` · `start` · `lint` · `typecheck` · `check` | ✅ |
| Wurzellayout mit `lang="de"`, Metadaten | ✅ |
| Englischer Codebase, deutsche Oberfläche (ADR-0019) | ✅ |
| Zentrale Texte `src/lib/i18n/de.ts` — Schlüssel englisch, Werte deutsch | ✅ |
| Formatierung `src/lib/format.ts`, Locale `de-AT` | ✅ |
| Vorläufige Startseite | ✅ |
| Vollständige Projektdokumentation in `docs/` | ✅ |

## Noch nicht implementiert

- Supabase-Projekt, Datenbankschema, RLS-Policies, Migrationen
- Import-Werkzeug, importierte Katalogdaten, kopierte Bilder
- Katalog-UI, Suche, Filter, Figurenseiten
- Auth, Profile, Onboarding, geschützte Routen
- Sammlung, Fortschritt, Sammlungswert
- Unit-Tests, RLS-Tests
- Navigation, Fehler- und Ladezustände (kommen mit dem Katalog-UI)
- Vercel-Projekt, Deployment

---

## Technischer Zustand

| Bereich | Zustand |
|---|---|
| Frontend | Grundgerüst lauffähig, eine statische Seite |
| Datenbank | nicht begonnen — Schema in `docs/DATABASE.md` ist **freigegeben und schreibbereit** |
| Auth | nicht begonnen — Konzept in `docs/AUTH.md` |
| Deployment | nicht eingerichtet, ausdrücklich noch nicht vorgesehen |
| Tests | nur Lint / Typecheck / Build — Unit- und RLS-Tests folgen mit der Fachlogik |

Konten vorhanden: GitHub, Supabase, Vercel. Das Supabase-Projekt ist noch nicht angelegt
(**EU-Region**, ADR-0015).

---

## Zuletzt verifizierte Prüfungen

**2026-09-03, nach V1.1:**

| Prüfung | Befehl | Ergebnis |
|---|---|---|
| ESLint | `npm run lint` | ✅ 0 Fehler, 0 Warnungen |
| TypeScript | `npm run typecheck` | ✅ 0 Fehler |
| Production Build | `npm run build` | ✅ erfolgreich, 2 statische Routen (`/`, `/_not-found`) |
| Server-Smoketest | `npm run start` + `curl` | ✅ HTTP 200, `<html lang="de">`, Inhalte gerendert |
| `.gitignore` | `git check-ignore` | ✅ `node_modules`, `.next`, `.env.local`, `*.xlsx`, `data/internal/`, `images/master/` ignoriert; `.env.example` wird getrackt |
| Sprachkonvention | Bezeichner-Audit über `src/` | ✅ alle Bezeichner und i18n-Schlüssel englisch, keine Umbenennung nötig; Kommentare auf Englisch umgestellt |

**2026-09-03, read-only gegen `../webpage` (Grundlage der Dokumentation):**

| Prüfung | Ergebnis |
|---|---|
| Excel-Struktur | 13 Sheets, keine eingebetteten Bilder mehr |
| Öffentlicher Export `products.json` | 600 Artikel, 6 Serien, 30 Kategorien |
| Artikel mit Marktpreis / mit Bild | 585 / 534 |
| Bildzuordnungen `data/images.json` | 634 Zuordnungen → 554 Masterdateien |
| Masterbilder / Website-Derivate | 554 PNG (0 verwaist) / 475 WebP |
| Geteilte Bilder | 63 Dateien von 143 Artikeln (öffentlich: 44 von 103) |
| ID-Ledger | `highest_issued: 820` |
| Preis-Mapping | 393 gemappt, 8 unmatched, 0 ignored |
| Namenseindeutigkeit | je Serie eindeutig, global **nicht** (32 Mehrfachnamen) |

Die fünf Legacy-Testsuiten (134 Prüfungen) wurden **nicht** ausgeführt — das Legacy-Projekt ist
read-only; sie wurden zuletzt am 2026-08-11 grün gemeldet.

---

## Bekannte Probleme

Keine. Lint, Typecheck und Build sind grün.

Zwei Hinweise ohne Handlungsbedarf:

- Beim `npm install` meldet npm, dass `unrs-resolver` (transitiv über ESLint) ein
  Postinstall-Skript hat, das nicht freigegeben ist. Die Installation ist trotzdem vollständig,
  Lint funktioniert. Keine Aktion nötig.
- `eslint@9.39.5` wird als „no longer supported" gemeldet — das ist die Version, die
  `create-next-app` mitbringt. Wird beim nächsten Abhängigkeits-Update mitgezogen.

---

## Risiken

| Risiko | Umgang |
|---|---|
| Interne Legacy-Daten könnten versehentlich ins Repository gelangen | Import nur über den validierten öffentlichen Export (ADR-0004); `.gitignore` sperrt `*.xlsx`, `data/internal/`, `images/master/`, `**/mappings/` |
| Excel und PostgreSQL könnten auseinanderlaufen | Zuständigkeit je Datenbereich, einbahniger Datenfluss (ADR-0003, ADR-0006) |
| Fehlerhafte RLS-Policy legt Benutzerdaten offen | RLS auf jeder Tabelle, `WITH CHECK` überall, Test mit zweitem Konto vor dem Deploy (ADR-0013) |
| Bildidentitäten beim Kopieren verlieren | content-adressierte Dateinamen unverändert übernehmen, Referenzen nach dem Import prüfen (ADR-0009) |
| Rechtliche Anforderungen vor der öffentlichen Beta | Impressum und Datenschutzerklärung sind Teil von V1.7 |
| E-Mail-Zustellung in der Beta | Supabase-Standardversand ist stark limitiert; produktiver Versand vor der Beta separat entscheiden (ADR-0018) |
| Legacy-Build könnte künftig nicht mehr laufen | Abhängigkeiten dokumentiert (Python 3, `cwebp`); Legacy bleibt unverändert erhalten |

---

## Entschieden (Freigaberunden 1 und 2, 2026-09-03)

**Alle Architektur- und Schemaentscheidungen für V1 stehen. Es blockiert nichts mehr.**

| ADR | Entscheidung |
|---|---|
| 0001 | SKY-ID bleibt kanonische Identität |
| 0002 | `sky_id` ist Primärschlüssel von `skylanders`, kein UUID-Surrogat |
| 0003 | Zuständigkeit je Datenbereich, einbahniger Datenfluss |
| 0004 | PortalVault liest nie direkt die Excel |
| 0005 | `collection_items`: Surrogat-PK, `user_id`, `sky_id`, `quantity`, Unique auf `(user_id, sky_id)` |
| 0006 | Katalog- und Preispflege bleiben in V1 im Legacy-System |
| 0007 | Preisupdate bleibt Legacy-Werkzeug |
| 0008 | `available`, Ankauffaktor und eBay-Daten werden nicht migriert |
| 0009 | Bilder statisch im Repository, Dateinamen unverändert |
| 0010 | `market_price numeric(10,2)`, **nullbar**, nie 0 statt unbekannt, keine `price_history` |
| 0011 | Lesbare Slugs, aber keine Datenbeziehung hängt am Slug |
| 0012 | Oberfläche nur Deutsch, i18n offengehalten |
| 0013 | Schlanker Testansatz: Lint, Typecheck, Build, Unit-Tests, RLS-Tests |
| 0014 | Kein zusätzlicher Backend-Service |
| 0015 | Supabase in der EU-Region |
| 0016 | Profile und Sammlungen privat, Katalog öffentlich lesbar und nicht benutzerseitig änderbar |
| 0017 | Anon-Key ist kein Secret; Grenze sind Auth, RLS und Policies |
| 0018 | SMTP-Anbieter erst vor der öffentlichen Beta |
| **0019** | **Technische Projektsprache ist Englisch. Oberflächensprache von V1 ist Deutsch.** |

## Offene Entscheidungen

Keine davon blockiert V1.2.

| ADR | Frage | nötig vor |
|---|---|---|
| 0016 | Darf ein Benutzername später geändert werden? | V1.5 |
| 0013 | Unit-Test-Werkzeug (Vitest naheliegend) | erste testbare Geschäftslogik |
| 0011 | genaue Slug-Kollisionsregel | V1.3 |
| — | Self-Service-Kontolöschung und Datenexport (DSGVO) in V1 oder später? | vor der Beta |

---

## Nächster geplanter Schritt

**V1.2 — Datenbankfundament.** Supabase-Projekt in der EU-Region anlegen, erste Migration
(`series`, `categories`, `skylanders`, `profiles`, `collection_items`) mit RLS-Policies und
Profil-Trigger schreiben, Verbindung im Code herstellen und mit zwei Testkonten prüfen, dass
fremde Sammlungen weder lesbar noch änderbar sind.

Alle dafür nötigen Entscheidungen sind freigegeben; das Schema in `docs/DATABASE.md` ist
schreibbereit.

**Wartet auf die ausdrückliche Freigabe des Nutzers.**
