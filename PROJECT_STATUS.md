# Projektstatus — PortalVault

Stand: 2026-09-03 · beschreibt den **aktuellen** Zustand, nicht die Historie.
Die vollständige Änderungshistorie liegt in Git.

---

## Aktuelle Phase

**V1.2 abgeschlossen — Datenbankfundament steht und ist bewiesen.**
V1.1 (Fundament), V1.2A (Schemaentwurf), V1.2B (Ausführung) und V1.2C (funktionale
RLS-Verifikation) sind fertig.

`0001_initial_schema.sql` wurde am 2026-09-03 im Supabase-SQL-Editor ausgeführt und strukturell
verifiziert. Am 2026-09-04 hat `npm run verify:rls` mit **zwei echten JWT-Sessions**
**31 von 31 Prüfungen bestanden** (`Functional RLS verification passed.`).

Die Sicherheitsregeln sind damit nicht nur konfiguriert, sondern **nachgewiesen wirksam**:
`on_auth_user_created` legt je Benutzer genau ein Profil an, und ein angemeldeter Benutzer kommt
an fremde Profil- und Sammlungsdaten weder lesend noch schreibend heran.

Testfixture und beide Test-Auth-Benutzer wurden anschließend vollständig entfernt; alle fünf
Tabellen standen danach wieder auf **0 Zeilen**.

**Produktrichtung festgelegt (2026-09-04):** PortalVault V1 ist eine Sammler- und
Analyseplattform, **kein Marketplace** (ADR-0021). Zielbild: ein Sammler öffnet PortalVault am
Handy, sieht den visuellen Katalog, tippt die Figuren an, die er besitzt, und sieht seinen
Fortschritt. Details in `docs/ROADMAP.md`, Abschnitt „Produktvision".

**Meilenstein-Reihenfolge entschieden (ADR-0023):** V1.3 Import → V1.4 Auth + `@supabase/ssr`
→ V1.5 Katalog mit Owned-Toggle und minimaler Sammlungsseite (**dort steht der
End-to-End-Fluss**) → V1.6 Ausbau → V1.7 Beta-Reife.

Wartet auf Freigabe für **V1.3 — Katalogimport**.

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
| `@supabase/supabase-js` als Abhängigkeit | ✅ |
| `tools/verify-rls.mts` — 31 funktionale RLS-Prüfungen, `npm run verify:rls` | ✅ **ausgeführt, 31/31 bestanden** |
| Supabase-Projekt in EU-Region, 5 Tabellen, RLS, 10 Policies, 5 Trigger, 3 Funktionen | ✅ |

## Noch nicht implementiert

- `@supabase/ssr` und die Cookie-basierte Session-Anbindung in Next.js — **bewusst offen**,
  kommt mit dem Auth-UI (V1.4); für den RLS-Test war sie nicht nötig
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
| Auth | Kein UI. Die Datenbankseite ist fertig und funktional verifiziert: Trigger, Policies und Rechte greifen nachweislich (`tools/verify-rls.mts`, 31/31). Konzept in `docs/AUTH.md` |
| Deployment | nicht eingerichtet, ausdrücklich noch nicht vorgesehen |
| Tests | Lint / Typecheck / Build plus der funktionale RLS-Test (`npm run verify:rls`). Unit-Tests folgen mit der ersten Geschäftslogik (ADR-0013) |

Konten vorhanden: GitHub, Supabase, Vercel. Das Supabase-Projekt ist angelegt (**EU-Region**,
ADR-0015). Vercel ist weiterhin nicht eingerichtet.

---

## Zuletzt verifizierte Prüfungen

### Tatsächlich ausgeführt

**2026-09-04, V1.2C — funktionaler RLS-Test mit zwei echten JWT-Sessions:**

`npm run verify:rls` → **31/31 checks passed**, `Functional RLS verification passed.`

| Prüfgruppe | Prüfungen | Ergebnis |
|---|---:|---|
| `on_auth_user_created` legt je Benutzer genau ein Profil an, `username` startet `NULL` | 4 | ✅ |
| Eigenes Profil lesen und ändern | 3 | ✅ |
| Fremdes Profil weder lesen noch ändern (beide Richtungen) | 4 | ✅ |
| Eigenes Profil nicht löschbar (keine DELETE-Policy) | 1 | ✅ |
| Fremdes Profil nach allen Versuchen nachweislich unverändert | 1 | ✅ |
| Eigene `collection_items` anlegen, ändern, lesen | 4 | ✅ |
| Fremde Einträge weder lesen, ändern, löschen noch für andere anlegen | 4 | ✅ |
| Eintrag nicht auf fremde `user_id` umschreiben (`WITH CHECK`) | 2 | ✅ |
| Fremder Eintrag intakt, eigener löschbar | 2 | ✅ |
| Katalog für `authenticated` lesbar, weder änderbar noch erweiterbar | 3 | ✅ |
| `anon`: Katalog lesbar, Profile und Sammlungen nicht | 3 | ✅ |
| **Summe** | **31** | **31/31** |

Die beiden Testbenutzer entstanden über `admin.createUser + signInWithPassword` — das Projekt
verlangt E-Mail-Bestätigung, weshalb `signUp` keine sofortige Session liefert. Der Trigger
feuerte trotzdem, weil er an `INSERT ON auth.users` hängt. Für das Auth-UI (V1.4) bedeutet das:
nach der Registrierung gibt es keine sofortige Session.

**Aufräumen nach dem Lauf:** Testfixture (Serie `TEST`, eine Kategorie, `SKY-9999`) und beide
Test-Auth-Benutzer vollständig entfernt. Zeilenzahlen danach:
`series=0, categories=0, skylanders=0, profiles=0, collection_items=0`.
Es sind **keine Testartefakte** in der Datenbank verblieben.

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

- **Cookie-basierte Sessions in Next.js.** Der RLS-Test spricht Supabase direkt an.
  `@supabase/ssr`, Middleware, Server-Clients und geschützte Routen existieren noch nicht und
  brauchen mit dem Auth-UI (V1.4) eine eigene Verifikation.
- **Der Registrierungsablauf aus Benutzersicht.** Bestätigungsmail, Callback und Passwort-Reset
  sind nie durchlaufen worden; der Test hat die Benutzer über die Admin-API angelegt.
- **Katalogimport.** Es sind nie echte Katalogdaten in der Datenbank gewesen — nur eine
  Testfixture aus drei Zeilen, die wieder entfernt wurde.
- Keine Supabase CLI initialisiert, kein Remote-Link (die Migration lief über den SQL-Editor).

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
| **0021** | **V1 ist Sammler- und Analyseplattform, kein Marketplace. Marketplace erst nach nachweislichem Nutzerwachstum** |
| 0022 | Free bleibt eigenständig nützlich; optionale Premium-Stufe als Richtung — Grenze und Preis **offen** |
| **0023** | **Meilenstein-Reihenfolge: Import → Auth → Katalog+Toggle+Sammlung → Ausbau → Beta** |

## Offene Entscheidungen

Keine davon blockiert V1.2.

| ADR | Frage | nötig vor |
|---|---|---|
| 0022 | Welche Funktionen sind Premium, zu welchem Preis? Ist Menge/Duplikat Free oder Premium? | vor jeder Zahlungslogik, nicht vor V1.7 |
| 0016 | Darf ein Benutzername später geändert werden? | V1.4 |
| 0013 | Unit-Test-Werkzeug (Vitest naheliegend) | erste testbare Geschäftslogik |
| 0011 | genaue Slug-Kollisionsregel | V1.3 |
| — | Self-Service-Kontolöschung und Datenexport (DSGVO) in V1 oder später? | vor der Beta |

---

## Nächster geplanter Schritt

**V1.3 — Katalogimport.** Das Importwerkzeug `tools/import-catalog.ts` bauen: den validierten
öffentlichen Legacy-Export einlesen, per `sky_id` upserten, vorher als Dry-Run anzeigen und in
einer Transaktion schreiben. Regeln vollständig in `docs/SKYLANDERS_DATA.md`, Abschnitt 12.

Danach folgt V1.4 (Auth + `@supabase/ssr`), dann V1.5 mit dem vollständigen
End-to-End-Fluss (ADR-0023).

Vorher zu klären: die genaue Slug-Kollisionsregel (ADR-0011).

**Wartet auf die ausdrückliche Freigabe des Nutzers.**
