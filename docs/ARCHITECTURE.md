# Architektur

Stand: 2026-09-03. Das Next.js-Grundgerüst (V1.1) existiert; darüber hinaus gibt es noch
keine Anwendungslogik. Dieses Dokument beschreibt die Zielarchitektur. Bestätigte
Entscheidungen sind als solche markiert, alles andere trägt **OPEN** oder **VORSCHLAG** und ist
in `docs/DECISIONS.md` als Entscheidung geführt.

---

## 1. Überblick

PortalVault ist eine Webanwendung mit drei Verantwortungsbereichen:

```
┌──────────────────────────────────────────────────────────────────┐
│  Browser                                                         │
│  Next.js (App Router) · React Server + Client Components         │
│  Tailwind CSS · Supabase JS Client (nur ANON-Key)                │
└───────────────┬──────────────────────────────────┬───────────────┘
                │ HTTPS                            │ HTTPS
                ▼                                  ▼
┌───────────────────────────────┐   ┌──────────────────────────────┐
│  Next.js Server (Vercel)      │   │  Supabase                    │
│  · Server Components          │   │  · PostgreSQL + RLS          │
│  · Route Handlers             │──▶│  · Auth (E-Mail/Passwort)    │
│  · Auth-Callback, Middleware  │   │  · (später) Storage          │
│  Nur ANON-Key im Request-     │   │                              │
│  Kontext des Benutzers        │   │  RLS ist die Sicherheits-    │
└───────────────────────────────┘   │  grenze, nicht das Frontend  │
                                    └──────────────┬───────────────┘
                                                   ▲
                          einmalig / manuell       │ Service-Role-Key
                          lokal ausgeführt         │ (nur lokal, nie im Browser)
┌──────────────────────────────────────────────────┴───────────────┐
│  Import-Werkzeug (lokal, Teil dieses Repos)                      │
│  liest products.json (öffentlicher Legacy-Export) → Upsert       │
└──────────────────────────────────────────────────────────────────┘
                          ▲
                          │ manuelle, geprüfte Kopie
┌─────────────────────────┴────────────────────────────────────────┐
│  LEGACY  ../webpage   STRICT READ-ONLY                           │
│  skylanders.xlsx → etl/ → site/data/products.json + site/img/    │
│  interne Daten (Lager, Order, EÜR, Mappings) bleiben hier        │
└──────────────────────────────────────────────────────────────────┘
```

---

## 2. Systemgrenzen

Es gibt genau **vier** Bereiche, und die Grenzen zwischen ihnen sind bewusst hart:

| Bereich | Inhalt | Wer schreibt | Wer liest |
|---|---|---|---|
| **Legacy** (`../webpage`) | Excel, Lager, Order/EÜR, Mappings, Masterbilder | nur der Nutzer, lokal | Claude nur lesend |
| **Öffentlicher Katalog** (Postgres `skylanders`, `series`, `categories`) | Name, Serie, Kategorie, Marktpreis, Bild | Import-Werkzeug (Service Role) | alle, auch anonym |
| **Charaktermetadaten** (Postgres `characters`) | Element, Spezies, Rolle, eigene Kurzbeschreibung, Quelle | Kuratierungswerkzeug (Service Role) | alle, auch anonym |
| **Benutzerdaten** (Postgres `profiles`, `collection_items`) | Profil, Sammlung | der jeweilige Benutzer | der jeweilige Benutzer (RLS) |
| **Secrets** (`.env.local`, Vercel/Supabase-Konsole) | Keys | nur der Nutzer | niemand sonst |

**Regel:** Daten fließen nur in eine Richtung — Legacy → Katalog. Es fließt **nichts** von
PortalVault zurück in die Excel. Damit gibt es für jedes Feld genau einen Schreiber.

**Charaktermetadaten sind ein zweiter, getrennter Eingang** und stammen nicht aus dem
Legacy-System: `data/characters/characters.json` → `tools/import-characters.mts` →
`characters`. Auch hier hat jedes Feld genau einen Schreiber — der Katalogimport kennt
`character_id` nicht, das Kuratierungswerkzeug rührt Name, Preis und Bild nicht an
(ADR-0034).

### Ein späterer fünfter Bereich: die Shop-Domäne

**Existiert nicht und ist nicht gebaut.** Hier steht nur, wohin er gehört, wenn er kommt
(ADR-0032):

| Bereich | Inhalt | Wer schreibt | Wer liest |
|---|---|---|---|
| **Shop** (später, eigene Strukturen) | Lagerbestand, Verkaufspreis, Rabattregeln, Coupons, Bestellungen | ausschließlich Shop-Admin, serverseitig geprüft | Bestand/Preis öffentlich; Bestellungen nur Käufer und Shop-Admin |

**Zielbild (ADR-0037), noch nicht gebaut:**

```
                     skylanders  (sky_id — die eine Identität)
                          |
        +-----------------+------------------+
        |                 |                  |
  collection_items   shop_inventory     characters
  (privat, je User)  (SkyIsles, kein    (kuratiert,
        |             user_id)           öffentlich)
        |            unique(sky_id, condition)
        |            condition = loose | boxed
        |                 |
        |          inventory_movements   (Anhängejournal, nur inventory_id:
        |                 |               purchase, sale_skyisles,
        |                 |               sale_external, return,
        |                 |               correction, writeoff)
        |                 |
        |            orders / order_items  (später, mit Preis-Snapshot)
        |
   „Fehlend & verfügbar" = collection_items ⋈ skylanders ⋈ shop_inventory
                            über sky_id — keine User-Shop-Tabelle nötig.
                            condition erzeugt 1:n, nicht 1:1.

   öffentlich sichtbar: quantity - reserved > 0  →  „Auf Lager"
                        die Zahl selbst nie.

  shop_admins ──▶ public.is_shop_admin()  ──▶ Prädikat jeder Shop-Policy
  (keine Client-Rechte)   (security definer)
```

**Die Grenze zwischen Benutzerdaten und Shop ist genauso hart wie die übrigen drei.**
`collection_items` beantwortet „Was besitzt dieser Nutzer?", die Shop-Domäne beantwortet
„Was hat das Geschäft auf Lager?". Beide hängen an derselben `sky_id`, sonst an nichts.
Dasselbe Konto kann beides tun — der Betreiber ist gleichzeitig Sammler und Shop-Admin —,
aber die **Daten** vermischen sich nie.

**Der Katalog bleibt der einzige kanonische Produktbestand.** Kein zweiter Produktdatensatz
für dieselben Skylanders, weder für den Shop noch für Bestellungen.

---

## 3. Frontend — Next.js

- **App Router**, TypeScript, Tailwind CSS.
- **Server Components als Standard.** Katalogseiten laden ihre Daten serverseitig; nur
  interaktive Teile (Suche, Filter, Mengensteuerung) sind Client Components.
- **Kein globaler Client-State-Manager** in V1. Die Sammlung liegt in der Datenbank, nicht im
  Browser-State. (Der `localStorage` des Legacy-Projekts entfällt für eingeloggte Nutzer.)
- **Projektsprache: Code englisch, Oberfläche deutsch** (ADR-0019, siehe Abschnitt 3a).
- **Oberflächensprache: nur Deutsch** (ADR-0012). Kein i18n-Framework, keine Sprachkennung in
  der URL. Benutzersichtbare Texte liegen zentral in `src/lib/i18n/de.ts`, Formatierung in
  `src/lib/format.ts` mit explizitem Locale `de-AT` — damit bleibt eine spätere englische
  Version möglich, ohne heute dafür zu bezahlen.
- Struktur (`✓` = existiert, sonst geplant):

```
src/
  app/
    layout.tsx           ✓ Wurzellayout, <html lang="de">
    page.tsx             ✓ vorläufige Startseite
    globals.css          ✓ Tailwind
    (public)/            Katalog (= /), Detailseiten  — ohne Login erreichbar
    (auth)/              login, register, verify, reset
    (app)/               collection, settings, onboarding    — geschützt
    auth/callback/       Supabase-Auth-Callback (Route Handler)
  components/            wiederverwendbare UI-Bausteine
  lib/
    format.ts            ✓ Währung, Zahlen, Prozent (de-AT)
    i18n/de.ts           ✓ benutzersichtbare Texte, zentral
    supabase/            client.ts (Browser) · server.ts (RSC/Actions) · middleware.ts
    catalog/             Abfragen und Typen für den Katalog
    collection/          Abfragen, Mutationen, Fortschritts-/Wertberechnung
  types/                 aus dem DB-Schema generierte Typen
supabase/
  migrations/            SQL-Migrationen, versioniert, additiv
tools/
  import-catalog.ts      Import aus dem Legacy-Export (Service Role, lokal)
data/
  catalog/               geprüfte, öffentliche Katalog-Snapshots (JSON)
public/
  images/skylanders/     WebP-Derivate, content-adressierte Dateinamen
docs/
```

- **Rechenlogik getrennt vom Rendering.** Wie im Legacy-Projekt (`pricing.js`) liegen
  Berechnungen (Sammlungswert, Fortschritt) in reinen Funktionen unter `lib/`, ohne
  DOM-/React-Bezug, damit sie testbar bleiben und die Formel ohne UI-Änderung erweiterbar ist.

### 3b. Visuelle Grundlage — „Skylands Vitrine" (ADR-0035)

Ein Token-System in `src/app/globals.css` trägt die gesamte Oberfläche. Keine externe Schrift,
keine Component Library — Tailwind und die Systemschrift genügen.

| Gruppe | Tokens |
|---|---|
| Flächen | `canvas` · `surface` · `surface-raised` · **`plate`** |
| Text | `foreground` · `muted` · `on-accent` |
| Linien | `border` · `border-strong` · `ring` |
| Akzent / Status | `accent`, `accent-hover`, `accent-subtle` · `success`, `danger` |
| Form | `radius-sm/md/lg` · `shadow-card`, `shadow-raised` |
| Element | zehn Farben, definiert und noch nicht verwendet |

**`plate` ist der tragende Token.** Die Katalogbilder sind Produktfotos auf weißem Grund
(435 opak, 40 mit Alpha), und die Master liegen unveränderlich im Legacy-Projekt (ADR-0009).
Deshalb ist die Bildfläche in **beiden** Themes hell: Im Dark Mode wird das Weiß dadurch zur
beleuchteten Vitrine statt zum versehentlichen Quadrat, und die beiden Bildsorten sehen gleich
aus.

Theme-Quelle ist `prefers-color-scheme`; einen Umschalter gibt es bewusst nicht.
Ein einziger `:focus-visible`-Stil gilt global, und `prefers-reduced-motion` schaltet jede
Bewegung ab. Elementfarben stammen ausschließlich aus kuratiertem `characters.element`
(ADR-0034) — nie aus Namen.

### 3c. Loading-Grenzen und der 404-Status

**Eine `loading.tsx` über einer Route, die `notFound()` aufruft, kostet den 404-Status.**
Die Antwort beginnt zu streamen, sobald die Suspense-Grenze greift — der Header ist dann schon
mit `200` verschickt und lässt sich nicht mehr ändern.

Am eigenen Code gemessen: mit `(public)/loading.tsx` lieferte `/skylanders/gibtsnicht`
**200 statt 404**; ohne sie wieder 404. Ein Skeleton direkt in `skylanders/[slug]/` hatte
denselben Effekt.

Daraus folgt die heutige Struktur:

```
(public)/
  layout.tsx              Navigation
  error.tsx               Fehlergrenze für alles darunter
  (catalog)/              Route-Group — ändert die URL nicht
    page.tsx              der Katalog auf "/"
    loading.tsx           Skeleton, umschließt NUR den Katalog
  skylanders/[slug]/
    page.tsx              ruft notFound() — keine Suspense-Grenze darüber
```

Die Detailseite bekommt bewusst **kein** Skeleton: Sie rendert in rund 0,63 s, und ein
korrekter 404 ist mehr wert als ein Ladeplatzhalter auf einer schnellen Seite.

### 3a. Projektsprache (ADR-0019)

> **Die technische Projektsprache ist Englisch. Die Oberflächensprache von V1 ist Deutsch.**

| Ebene | Sprache | Beispiele |
|---|---|---|
| Ordner, Dateien, Module | Englisch | `src/lib/collection/`, `tools/import-catalog.ts` |
| Bezeichner (Variablen, Funktionen, Typen) | Englisch | `formatPrice()`, `getCollectionValue()`, `CatalogItem` |
| Datenbanktabellen und -spalten | Englisch | `collection_items`, `market_price`, `image_file`, `user_id` |
| Routeninterne und API-Benennung | Englisch | `/skylanders/[slug]`, `searchParams.series` |
| Kommentare, Testnamen, Migrationsnamen, Commit-Messages | Englisch | `0001_initial_schema.sql` |
| **Benutzersichtbare Texte** | **Deutsch** | `"Anmelden"`, `"Sammlung"`, `"Marktpreis"` |

Die Trennlinie verläuft an genau einer Stelle: den **Werten** in `src/lib/i18n/de.ts`.
Deren Schlüssel sind englisch, deren Werte deutsch. Überall sonst gilt Englisch.

**Warum.** Eine spätere englische Version soll möglich sein, ohne den technischen Codebase
umzubenennen. Datenbankspalten und Funktionsnamen umzubenennen ist teuer und riskant;
Übersetzungswerte auszutauschen ist billig. Deshalb liegt die einzige sprachabhängige Stelle
dort, wo ein Wechsel ohnehin stattfinden würde.

**Ausnahme.** `docs/` und `CLAUDE.md` sind auf Deutsch — sie sind die Arbeitsgrundlage des
Nutzers und zitieren wörtlich die Regeln und Kategorienamen des deutschsprachigen
Legacy-Systems. Alle technischen Bezeichner darin sind trotzdem englisch.

---

## 4. Daten — Supabase / PostgreSQL

Vollständiges Modell: `docs/DATABASE.md`. Kurz:

- `series`, `categories` — Katalogstruktur inkl. der Reihenfolge aus der Excel
- `skylanders` — die zentrale kanonische Figur, Primärschlüssel `sky_id`
- `profiles` — 1:1 zu `auth.users`, öffentlicher Benutzername
- `collection_items` — Benutzer × Figur × Menge

**Zentrale Regel:** Benutzer erzeugen keine eigenen Kopien einer Figur. `collection_items`
referenziert `skylanders.sky_id`. Ändert sich zentral Name, Bild oder Marktpreis, sehen alle
Benutzer sofort den neuen Wert — es wird **nichts** redundant in die Sammlung kopiert.

**Der Sammlungswert wird immer berechnet, nie gespeichert:**
`SUM(collection_items.quantity * skylanders.market_price)`.

**In der Datenbank stehen ausschließlich veröffentlichungsfähige Katalogdaten.** Lagerzahlen,
Ankauffaktor, Mappings und Order-/EÜR-Daten gelangen gar nicht erst hinein — dasselbe Prinzip
wie im Legacy-Projekt, wo interne Daten nie im Bundle landen.

---

## 5. Auth

Details: `docs/AUTH.md`. Kurz: Supabase Auth mit E-Mail + Passwort und E-Mail-Verifizierung.
Kein eigenes Passwortsystem, kein eigener Session-Mechanismus. Sessions über Cookies
(`@supabase/ssr`), Middleware erneuert das Token und schützt die `(app)`-Routen.

**Die Middleware ist Komfort, nicht Sicherheit.** Die eigentliche Grenze ist RLS in Postgres:
Auch ein direkter API-Aufruf mit gültigem Token darf fremde Sammlungen weder lesen noch ändern.

---

## 6. Datenfluss

### Katalog im Browser

Die Startseite ist der Katalog (ADR-0025). Eine Server Component lädt **alle** aktiven Figuren
in einer Abfrage und — nur für Angemeldete — deren eigene Sammlungseinträge; Suche und Filter
laufen anschließend vollständig im Browser (ADR-0026, gemessen: 13,6 KB gzip für 600 Figuren).

Der Sammlungs-Toggle geht über eine Server Action, die den **gewünschten Endzustand** ausdrückt
statt umzuschalten (ADR-0027). Damit ist ein doppelter Tipp unschädlich und optimistisches UI
verlässlich.

### Katalogdaten aus dem Legacy-System (selten, manuell, kontrolliert)

1. Nutzer pflegt die Excel im Legacy-Projekt und führt dort `webpage build` aus.
2. Nutzer kopiert `site/data/products.json` und geänderte `site/img/*.webp` nach PortalVault.
3. `tools/import-catalog.ts` prüft und upsertet per `sky_id` (erst Dry-Run, dann Schreiben).
4. Vercel-Deploy veröffentlicht neue Bilder; Preis-/Namensänderungen wirken sofort über die DB.

### Benutzerdaten (laufend, automatisch)

Browser → Next.js Server Component / Server Action → Supabase (ANON-Key + Session) → RLS prüft
`auth.uid()` → Postgres. Kein eigener Backend-Service, keine eigene API-Schicht dazwischen.

### Charaktermetadaten (selten, manuell, kuratiert)

```
öffentliche Quelle (Faktenprüfung)  →  Mensch  →  data/characters/characters.json
      →  npm run characters:import -- --apply  →  characters + skylanders.character_id
```

Kein Scraping, keine automatische Zuordnung, keine Namensheuristik. Beschreibungen entstehen
bei SkyIsles selbst. Das Werkzeug prüft vollständig, bevor es schreibt, löscht nie und setzt
keine bestehende Verknüpfung zurück.

### Marktpreise

V1: der importierte Wert aus der Excel. Später optional Preisverlauf; die Anwendung liest den
aktuellen Preis über **eine einzige Stelle** (`lib/catalog`), damit die Quelle später
austauschbar ist, ohne UI-Code anzufassen.

---

## 7. Bilder

V1 (ADR-0009, **angenommen**): die 475 öffentlichen WebP-Derivate liegen als statische Assets
unter `public/images/skylanders/` im Repository (≈ 11 MB) und werden von Vercels CDN
ausgeliefert. Die bestehenden content-adressierten Dateinamen bleiben unverändert und erlauben
unveränderliche Caches.

Die Masterbilder (430 MB PNG) bleiben im Legacy-Projekt und kommen **nie** in Git.

Die Datenbank speichert nur den stabilen Dateinamen, nie eine vollständige URL und nie einen
infrastrukturspezifischen Pfad. Die URL wird an genau einer Stelle im Code gebildet. Ein
späterer Wechsel des Speicherorts ist damit ein Präfixwechsel — die Bildidentität bleibt.
Supabase Storage ist für **Benutzer-Uploads** vorgesehen (Avatare, später Marketplace-Bilder),
nicht für die kanonischen Skylander-Bilder.

---

## 8. Deployment

Vercel, verbunden mit dem GitHub-Repository. **Noch nicht eingerichtet.**
Deployment erst, wenn eine kontrollierte lokale Basis läuft (Katalog + Auth + Sammlung).

| Variable | Ort | im Browser sichtbar |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel + `.env.local` | ja (kein Secret) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel + `.env.local` | ja (**kein Secret**, ADR-0017) |
| `SUPABASE_SERVICE_ROLE_KEY` | **nur lokal** in `.env.local` | **niemals** |

Der Anon-Key ist ausdrücklich kein Secret: die Sicherheit hängt an Supabase Auth und RLS, nicht
an seiner Geheimhaltung (ADR-0017). Der Service-Role-Key dagegen umgeht RLS vollständig. Er wird
ausschließlich vom lokalen Import-Werkzeug benutzt und kommt weder nach Vercel noch in
Client-Code.

---

## 9. Verantwortlichkeiten

| Komponente | verantwortlich für | ausdrücklich nicht |
|---|---|---|
| Legacy `../webpage` | Excel-Pflege, interne Geschäftsdaten, Masterbilder, Preisupdate | Benutzerkonten, Sammlungen |
| `tools/import-catalog.ts` | Katalogdaten in die DB bringen, validieren | Benutzerdaten oder `character_id` anfassen |
| `tools/import-characters.mts` | kuratierte Charakterdaten anwenden | Katalogfelder ändern, Verknüpfungen löschen, Namen raten |
| Postgres + RLS | Datenhaltung **und** Zugriffsschutz | Präsentationslogik |
| Next.js Server | Rendern, Auth-Callback, Datenzugriff im Benutzerkontext | Autorisierungsentscheidungen ersetzen |
| Client Components | Interaktion, Anzeige | Sicherheitsentscheidungen |
| **Shop-Domäne** (später) | Lagerbestand, Verkaufspreis, Rabatte, Bestellungen | den kanonischen Katalog oder fremde Sammlungen verändern |

---

## 10. Entschieden und offen

**Entschieden (2026-09-03).** Alle Architekturentscheidungen für V1 stehen:
Projektsprache Englisch im Code, Deutsch in der Oberfläche (ADR-0019) · Oberfläche nur Deutsch
(ADR-0012) · `sky_id` als Primärschlüssel (ADR-0002) · lesbare Slugs ohne Datenbeziehung
(ADR-0011) · Sammlungsmodell mit Surrogat-PK und Unique-Constraint (ADR-0005) ·
`market_price numeric(10,2)`, nullbar, kein Preisverlauf (ADR-0010) · kein zusätzlicher
Backend-Service (ADR-0014) · Profile und Sammlungen privat, Katalog öffentlich lesbar
(ADR-0016) · Bilder statisch im Repository (ADR-0009) · Katalogpflege in V1 im Legacy-System
(ADR-0006) · schlanker Testansatz (ADR-0013) · Supabase in der EU-Region (ADR-0015) ·
Anon-Key ist kein Secret (ADR-0017) · SMTP erst vor der Beta (ADR-0018).

**Noch offen — keine davon blockiert V1.2:**

- **OPEN:** Unit-Test-Werkzeug (Vitest naheliegend) — wird bei der ersten zu testenden
  Geschäftslogik festgelegt → ADR-0013
- **OPEN:** Darf ein Benutzername später geändert werden? → ADR-0016
- **OPEN:** Genaue Slug-Kollisionsregel — wird beim Importwerkzeug festgelegt → ADR-0011
- **OPEN:** Self-Service-Kontolöschung und Datenexport (DSGVO) in V1 oder später

**Fachlich festgehalten, aber nicht gebaut (2026-09-04).** Die Domänengrenze zum späteren
First-Party-Shop (ADR-0032) und die fünf Preisebenen (ADR-0033) sind dokumentiert, damit heutige
Entscheidungen sie nicht verbauen. **Keine Struktur, keine Rolle und keine Zeile Code davon
existiert.** Der Marketplace-Stopp aus ADR-0021 bleibt unverändert bestehen — ein
First-Party-Shop mit genau einem Verkäufer ist etwas anderes als ein Marktplatz.
