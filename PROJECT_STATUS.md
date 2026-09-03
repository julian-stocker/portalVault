# Projektstatus — PortalVault

Stand: 2026-09-03 · beschreibt den **aktuellen** Zustand, nicht die Historie.
Die vollständige Änderungshistorie liegt in Git.

---

## Aktuelle Phase

**V1.2B — Datenbank steht.** V1.1 (Fundament) und V1.2A (Schemaentwurf) sind abgeschlossen.

`0001_initial_schema.sql` wurde am 2026-09-03 im Supabase-SQL-Editor **erfolgreich ausgeführt**
und anschließend mit rein lesenden Abfragen **strukturell verifiziert**. Das Supabase-Projekt
existiert in einer EU-Region; die Datenbank enthält das vollständige V1-Schema und **keine
Daten** (alle Rowcounts 0).

**Noch nicht bewiesen:** dass die RLS-Regeln bei echten Sessions greifen. Der funktionale
Zwei-Benutzer-Test ist V1.2C.

Wartet auf Freigabe für **V1.2C — Verbindung im Code und RLS-Verifikation mit zwei Testkonten**.

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
| `supabase/migrations/0001_initial_schema.sql` — geschrieben, **ausgeführt und strukturell verifiziert** | ✅ |
| Supabase-Projekt in EU-Region, 5 Tabellen, RLS, 10 Policies, 5 Trigger, 3 Funktionen | ✅ |

## Noch nicht implementiert

- Verbindung von Next.js zu Supabase (`@supabase/ssr`, Client- und Server-Clients)
- **Funktionaler RLS-Test mit zwei echten Benutzern** (V1.2C) — bislang nur strukturell verifiziert
- Supabase CLI (nicht initialisiert, kein Remote-Link — Migration lief über den SQL-Editor)
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
| Datenbank | Schema ausgeführt und strukturell verifiziert. Supabase-Projekt (EU-Region) vorhanden, 0 Datenzeilen. Repository-Datei und Datenbankstand sind identisch. |
| Auth | nicht begonnen — Konzept in `docs/AUTH.md` |
| Deployment | nicht eingerichtet, ausdrücklich noch nicht vorgesehen |
| Tests | nur Lint / Typecheck / Build — Unit- und RLS-Tests folgen mit der Fachlogik |

Konten vorhanden: GitHub, Supabase, Vercel. Das Supabase-Projekt ist angelegt (**EU-Region**,
ADR-0015). Vercel ist weiterhin nicht eingerichtet.

---

## Zuletzt verifizierte Prüfungen

### Tatsächlich ausgeführt

**2026-09-03, V1.2B — gegen die laufende Supabase-Datenbank:**

| Prüfung | Ergebnis |
|---|---|
| `0001_initial_schema.sql` im SQL-Editor ausgeführt | ✅ `Success. No rows returned` |
| Tabellen | ✅ 5: `series`, `categories`, `skylanders`, `profiles`, `collection_items` |
| RLS | ✅ aktiviert auf 5/5, `forced = false` |
| Policies | ✅ 10, alle wie in `docs/DATABASE.md` Abschnitt 5 |
| Trigger | ✅ **5** (4 auf `public`, 1 auf `auth.users`) |
| Foreign Keys | ✅ **5** |
| Funktionen | ✅ 3, davon eine `SECURITY DEFINER` mit `search_path = ''` |
| `skylanders_sky_id_immutable` | ✅ korrekt als `BEFORE UPDATE OF sky_id` |
| Rechte `profiles / authenticated` | ✅ exakt `INSERT, SELECT, UPDATE` |
| Rechte `collection_items / authenticated` | ✅ exakt `DELETE, INSERT, SELECT, UPDATE` |
| Rechte Katalog / `anon` + `authenticated` | ✅ nur `SELECT` |
| Rechte `service_role` auf Katalog | ✅ Schreibrechte vorhanden (für den Import in V1.3) |
| Rowcounts | ✅ überall 0 |
| Kanonische Datei: Kopfzeile, Kodierung | ✅ erste Zeile `-- …`, kein BOM, nur LF, endet mit Zeilenumbruch |

Zwischenschritt: Ein erster Lauf ergab überzählige Rechte für `authenticated`
(`TRUNCATE, REFERENCES, TRIGGER`) aus Supabases Default-Privilegien. Die Migration wurde um
explizite `REVOKE` ergänzt, die Datenbank zurückgesetzt und die korrigierte Fassung erneut
ausgeführt. Hergang: `docs/DATABASE.md`, Abschnitt 3.9.

**2026-09-03, statisch vor der Ausführung:**

| Prüfung | Befehl | Ergebnis |
|---|---|---|
| Migration statisch geprüft | eigenes Prüfskript (nicht im Repo) | ✅ zuletzt 20 Prüfungen, 0 Fehler |
| Spaltenaudit der Migration | eigenes Prüfskript | ✅ 35 Spalten, alle englisch/snake_case, keine verbotene Spalte (`available`, `stock`, `ebay`, …) |

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

### Ausdrücklich NICHT verifiziert

- **Der funktionale RLS-Test mit zwei echten Benutzern steht aus (V1.2C).**
  Verifiziert ist, dass Policies, Rechte und RLS-Flags **so konfiguriert sind** wie beabsichtigt.
  **Nicht** verifiziert ist, dass sie bei echten authentifizierten Sessions greifen — dass also
  Benutzer A weder lesend noch schreibend an die Daten von Benutzer B kommt. Der Security-Review
  in `docs/SECURITY.md`, Abschnitt 5a, ist damit strukturell belegt, aber nicht
  sicherheitsfunktional bewiesen. Bis dahin wird nichts deployt.
- Der Profil-Trigger `on_auth_user_created` **existiert**, hat aber noch nie gefeuert — es gibt
  keine Benutzer. Ob er bei einer echten Registrierung eine Profilzeile anlegt, zeigt erst V1.2C.
- Keine Supabase CLI initialisiert, kein Remote-Link (die Migration lief über den SQL-Editor).
- Keine Verbindung zwischen Next.js und Supabase.

---

## Bekannte Probleme

**Keine offenen.** Die beiden im Pre-Flight vermuteten Supabase-Risiken rund um den Trigger auf
`auth.users` sind **nicht eingetreten**; das dabei tatsächlich gefundene Problem (überzählige
Rechte aus Supabases Default-Privilegien) ist behoben und verifiziert. Hergang:
`docs/DATABASE.md`, Abschnitt 3.9.

Lint, Typecheck und Build sind grün.

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
| 0020 | Case-insensitive Benutzernamen über `unique index on lower(username)` statt `citext` |

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

**V1.2C — Supabase im Code anbinden und die RLS-Regeln funktional verifizieren.**
`@supabase/ssr` einrichten (Browser-Client, Server-Client, Middleware), zwei Testkonten anlegen
und nachweisen, dass Benutzer A weder lesend noch schreibend an Profil und Sammlung von
Benutzer B kommt. Erst dieser Nachweis macht aus „so konfiguriert" ein „nachweislich wirksam".

**Wartet auf die ausdrückliche Freigabe des Nutzers.**
