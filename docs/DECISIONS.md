# Architecture Decision Log

Jede wichtige Entscheidung bekommt hier einen Eintrag. Nichts Wichtiges bleibt nur im
Session-Kontext von Claude.

**Status-Werte**

| Status | Bedeutung |
|---|---|
| `ANGENOMMEN` | vom Nutzer vorgegeben oder ausdrücklich freigegeben |
| `VORGESCHLAGEN` | von Claude empfohlen, wartet auf Freigabe — noch nicht umgesetzt |
| `OPEN DECISION` | offen, muss entschieden werden, mit Optionen und Empfehlung |
| `ERSETZT DURCH ADR-XXXX` | überholt |

Letzte Aktualisierung: 2026-09-06 (ADR-0038, Design V4.2).

---

## ADR-0001 — Bestehende SKY-IDs bleiben die kanonische Identität

**Status:** ANGENOMMEN (2026-09-03)

**Entscheidung.** `SKY-0001` … `SKY-0820` bleiben unverändert die Identität jeder Figur, auch
in PortalVault. Sie werden nie aus Name, Slug, Bild, Zeile oder Kategorie abgeleitet, nie neu
vergeben, nie wiederverwendet, nie automatisch geändert. Benutzersammlungen referenzieren die
SKY-ID.

**Begründung.** Die ID verbindet im Legacy-System bereits Excel, Bild, Marktpreis, Mapping,
Lagerbestand und Ankauf. Sie ist per Regel unveränderlich und in `data/id_ledger.json`
lückenlos verwaltet. Eine neue Identität einzuführen würde jede bestehende Zuordnung entwerten.

**Konsequenzen.** Der Import upsertet ausschließlich über `sky_id`. Der Import erfindet keine
IDs. Neue Figuren erhalten ihre ID weiterhin im Legacy-Projekt über `etl/assign_ids.py`,
solange die Excel den Katalog führt (siehe ADR-0006).

**Formatgrenze bestätigt (2026-09-03).** Das Format `^SKY-[0-9]{4}$` bleibt für V1 unverändert
und wird **nicht vorsorglich** erweitert. Sollte der bestehende Legacy-ID-Raum je überschritten
werden, ist das eine bewusste, gemeinsame Migration von Legacy-Projekt **und** PortalVault —
keine stille Lockerung des Constraints.

**Umsetzung in der Datenbank (0001_initial_schema.sql).** Zusätzlich zum Format-CHECK
`^SKY-[0-9]{4}$` verweigert der Trigger `skylanders_sky_id_immutable` jede Änderung einer
SKY-ID. Das ist bewusst ein Trigger und keine Policy: RLS verhindert bereits Client-Schreibzugriffe,
**aber die Service Role umgeht RLS** — und genau als Service Role läuft das Importwerkzeug.
Trigger und Constraints werden nicht umgangen. Ebenso ist der Fremdschlüssel
`collection_items.sky_id → skylanders.sky_id` auf `on update restrict` gesetzt: ein
Änderungsversuch soll fehlschlagen, nicht stillschweigend durch alle Benutzersammlungen
propagieren.

---

## ADR-0002 — `sky_id` ist der Primärschlüssel der Tabelle `skylanders`

**Status:** ANGENOMMEN (2026-09-03)

**Entscheidung.** `skylanders.sky_id text primary key check (sky_id ~ '^SKY-[0-9]{4}$')`.
**Kein** zusätzlicher UUID-Surrogatschlüssel für `skylanders`.

Andere Entitäten — `profiles` (= `auth.users.id`), später `listings`, `trades`, `orders` —
verwenden UUIDs. Die Regel gilt ausschließlich für den kanonischen Katalog.

**Begründung.** Die SKY-ID ist per Projektregel dauerhaft unveränderlich; das ist genau der
Fall, in dem ein natürlicher Schlüssel richtig ist. Jede Zeile, jedes Log und jeder
Fremdschlüssel ist ohne Join lesbar, und der Abgleich mit dem Legacy-System bleibt direkt
möglich.

**Konsequenzen.** `collection_items.sky_id` ist ein `text`-Fremdschlüssel. Alle künftigen
Tabellen, die auf Figuren zeigen (`wishlist_items`, `listings`, …), verwenden ebenfalls
`sky_id text`.

**Verworfen:** `id uuid` + `sky_id text unique` — ein zweiter Schlüssel ohne fachlichen Nutzen.

---

## ADR-0003 — PostgreSQL ist Source of Truth für die Webplattform, Excel für interne Daten

**Status:** ANGENOMMEN (2026-09-03)

**Entscheidung.** Die Zuständigkeit wird **pro Datenbereich** getrennt, nicht dupliziert:

| Bereich | Source of Truth | Datenfluss |
|---|---|---|
| Katalogstammdaten (Name, Serie, Kategorie, Marktpreis, Bildzuordnung) | in V1 Excel; PostgreSQL ist die veröffentlichte Kopie | Excel → Postgres, einbahnig |
| Benutzerdaten (Profile, Sammlungen) | **ausschließlich PostgreSQL** | nirgendwohin |
| Interne Geschäftsdaten (Lager, Order, EÜR, Mappings, Ankauffaktor) | **ausschließlich Legacy/Excel** | nirgendwohin |

**Begründung.** Zwei widersprüchliche Quellen entstehen nur, wenn dasselbe Feld an zwei Stellen
geschrieben wird. Deshalb hat jedes Feld genau einen Schreiber, und der Datenfluss ist
einbahnig. Nichts fließt aus PortalVault zurück in die Excel.

**Konsequenzen.** Preis- und Namensänderungen macht der Nutzer weiterhin in der Excel und
spielt sie per Import ein. Die Anwendung ändert Katalogdaten nie. Langfristige Ablösung: ADR-0006.

---

## ADR-0004 — PortalVault liest niemals `skylanders.xlsx` direkt

**Status:** ANGENOMMEN (2026-09-03)

**Entscheidung.** Der einzige zulässige Eingang für Katalogdaten ist der validierte öffentliche
Export `../webpage/site/data/products.json`, der im Legacy-Projekt bereits `guard_public()`
durchlaufen hat. Der Import prüft zusätzlich noch einmal selbst.

**Begründung.** Die Excel enthält Käuferdaten, EÜR, private Sammlung und Lagerzahlen. Über den
geprüften Export ist die Trennung strukturell gegeben: was nicht im Export steht, kann nicht
importiert werden.

**Konsequenzen.** Der Nutzer führt vor jedem Import im Legacy-Projekt `webpage build` aus und
kopiert die Exportdatei. Zwei Schritte statt einem — bewusst, zugunsten der Sicherheitsgrenze.

**Verworfen:** direkter XLSX-Import in PortalVault; Legacy als Git-Submodul einbinden.

---

## ADR-0005 — Sammlungsmodell: Surrogatschlüssel plus Unique-Constraint

**Status:** ANGENOMMEN (2026-09-03)

**Entscheidung.** `collection_items` besteht in V1 aus:

- **Surrogat-Primärschlüssel** (`id uuid`)
- **`user_id`** — Fremdschlüssel auf den Benutzer
- **`sky_id`** — Fremdschlüssel auf `skylanders`
- **`quantity`**
- **Unique-Constraint/Index auf `(user_id, sky_id)`**

**V1 behandelt einen Skylander je Benutzer als einen aggregierten Sammlungsdatensatz.**

**Begründung.** In V1 verhält sich die Tabelle wie ein zusammengesetzter Schlüssel: eine Zeile
je Benutzer und Figur, `quantity` deckt Mehrfachbesitz ab. Das Design muss eine spätere
Entwicklung hin zu **einzelnen Exemplaren und Zuständen** (`keep`, `sell`, `trade`) erlauben —
**ohne das jetzt umzusetzen**. Dafür wird später der Unique-Constraint entfernt und eine Spalte
ergänzt; aus einer Zeile werden mehrere Posten derselben Figur. Das ist eine additive Migration
ohne Schlüsselumbau. Mit `primary key (user_id, sky_id)` wäre derselbe Schritt ein Umbau aller
Schlüssel.

**Konsequenzen.** Verkaufsangebote kommen trotzdem in eine eigene Tabelle (`listings`), nicht in
`collection_items`. Zustandswerte werden erst eingeführt, wenn sie gebraucht werden — die
Bezeichner sind bereits als `keep` / `sell` / `trade` vorgesehen (englisch, ADR-0019).

**Zur Obergrenze `quantity <= 10000` (bestätigt 2026-09-03).** Das ist eine **technische
Schutzgrenze** gegen fehlerhafte Clients und unplausible Schreibvorgänge — **keine fachliche
Definition maximalen Besitzes.** PortalVault legt nicht fest, wie viele Exemplare einer Figur
ein Sammler besitzen darf; der Wert ist bewusst so hoch gewählt, dass er keine reale Sammlung
begrenzt. Stößt jemals eine echte Sammlung daran, wird der Wert angehoben — eine
Betriebsentscheidung, keine Änderung des Datenmodells.

**Verworfen:** eine Zeile je physischem Exemplar in V1 (unnötig kompliziert in UI und Abfragen);
`owned boolean` (verletzt die Mengen-Anforderung).

---

## ADR-0006 — Katalogpflege: V1 im Legacy-System, langfristig offen

**Status:** ANGENOMMEN für V1 (2026-09-03) · langfristiger Teil bleibt OPEN

**Entscheidung für V1.** Katalog- und Preispflege bleiben vollständig im Legacy-System.
Der Datenfluss ist:

```
Legacy Excel / ETL  →  validierter öffentlicher Export  →  kontrollierter PortalVault-Import  →  PostgreSQL
```

- PortalVault liest niemals die vollständige Excel direkt (ADR-0004).
- Benutzerdaten existieren ausschließlich in PostgreSQL.
- Interne Legacy-Daten bleiben ausschließlich im Legacy-System.

**Offen (LATER).** Ein PortalVault-Admin-System kann PostgreSQL später zur vollständigen
Source of Truth für den öffentlichen Katalog machen. Diese Migration wird **jetzt nicht**
durchgeführt und ist auch nicht Teil von V1.

**Konsequenzen für heute.** Das Importwerkzeug wird so gebaut, dass es wiederholt laufen kann
(idempotenter Upsert über `sky_id`) — das ist die Voraussetzung dafür, dass die Excel später
ohne Datenverlust abgelöst werden kann.

---

## ADR-0007 — Preisupdate bleibt im Legacy-Projekt

**Status:** ANGENOMMEN (2026-09-03, mit ADR-0006)

**Entscheidung.** `etl/update_prices.py` mit seinem expliziten Mapping läuft unverändert im
Legacy-Projekt weiter. Aktualisierte Preise kommen über denselben Importweg wie alle anderen
Katalogdaten nach PortalVault.

**Begründung.** Die Logik ist erprobt, durch 17 Zuordnungstests abgesichert und trägt eine
wichtige Sicherheitsregel: kein Fuzzy-Matching, ein fehlendes Update ist besser als eine falsche
Zuordnung. Sie enthält außerdem Scraping-Details und Quell-URLs, die nicht in ein Repository
gehören, das später öffentlich werden könnte.

**Konsequenzen.** Scraper-Code, Mappings und Logs bleiben im Legacy-Projekt. PortalVault
bekommt nur das Ergebnis: den Preis.

---

## ADR-0008 — Ankauffaktor, `available` und eBay-Daten werden nicht migriert

**Status:** ANGENOMMEN (2026-09-03)

**Entscheidung.** Aus dem Legacy-Export werden `available`, `ebay` und der Ankauffaktor aus
`config.json` **nicht** importiert.

**Begründung (Wortlaut des Nutzers).** Das Feld `available` beschreibt den **eigenen
Legacy-Lagerbestand** und gehört nicht zum kanonischen PortalVault-Sammlungsmodell. Ein
Skylander existiert in PortalVault unabhängig davon, ob er im persönlichen Lager gerade
verfügbar ist. Der Ankauffaktor (33,36 %) ist Ausgaben ÷ Marktwert des Einkaufs — eine
abgeleitete Geschäftskennzahl ohne Funktion in einer Sammlerplattform. `ebay` betrifft eigene
Verkäufe.

**Konsequenzen.** Es gibt in PortalVault keinen Verfügbarkeitsstatus und keinen Ankaufsrechner.
Damit existiert auch kein Informationskanal, über den aus der öffentlichen Datenbank auf
interne Geschäftsdaten geschlossen werden könnte. Sollte Ankauf je zum Thema werden, ist das
eine neue Entscheidung.

---

## ADR-0009 — Bilder: statische Assets im Repository für V1

**Status:** ANGENOMMEN (2026-09-03)

**Entscheidung.** Die öffentlichen WebP-Derivate liegen unter `public/images/skylanders/` im
PortalVault-Repository und werden vom Vercel-CDN ausgeliefert.

- **Die bestehenden Dateinamen bleiben unverändert** (content-adressiert, `<sha256[:16]>.webp`).
- Die Master-PNGs (430 MB) bleiben ausschließlich im Legacy-Projekt und dürfen nicht ins
  PortalVault-Repository.
- Supabase Storage wird in V1 **nicht** für die kanonischen Skylander-Bilder verwendet.
- Supabase Storage ist später für **Benutzer-Uploads** vorgesehen (Avatare, Marketplace-Bilder).

**Begründung.** Kein zusätzlicher Dienst, keine Zugriffsregeln, keine Kosten. Content-adressierte
Namen erlauben unveränderliche Caches und bewahren die Bildidentität aus dem Legacy-System.

**Konsequenzen.** Die Datenbank speichert **nur den stabilen Dateinamen**, nie eine vollständige
URL und nie einen infrastrukturspezifischen Pfad. Die URL wird an genau einer Stelle im Code
gebildet. Ein späterer Wechsel des Speicherorts ist damit ein Wechsel des Präfixes.

---

## ADR-0010 — Marktpreis in V1: ein nullbarer Wert direkt auf `skylanders`

**Status:** ANGENOMMEN (2026-09-03)

**Entscheidung.**

- `skylanders.market_price numeric(10,2)` — der Preis steht in V1 **direkt auf der Tabelle**.
- **`market_price` MUSS nullbar sein.**
- `NULL` bedeutet: **„Derzeit ist kein Marktpreis bekannt."**
- **Niemals 0 als Ersatz für einen unbekannten Preis verwenden.**
- **Keine `price_history`-Tabelle in V1.**

**Begründung.** Ändert sich der zentrale Preis, ändert sich der angezeigte Sammlungswert
automatisch — es gibt keine zweite Preiskopie. `numeric` statt `float`, weil es um Geld geht.
15 der 600 Artikel haben keinen Preis; würde man dort 0 schreiben, wäre „geschenkt" von
„unbekannt" nicht mehr unterscheidbar und jede Wertsumme stillschweigend falsch.

**Konsequenzen.**

- Aggregationen zählen `NULL`-Preise nicht mit und weisen sie gesondert aus (wie im
  Legacy-Frontend): `sum(quantity * market_price) filter (where market_price is not null)`.
- `formatPrice(null)` gibt „–" zurück, nie „0,00 €" (`src/lib/format.ts`).
- **Umsetzung in der Datenbank:** der Constraint lautet `market_price is null or
  market_price > 0`, nicht `>= 0`. Damit ist 0 als Ersatz für „unbekannt" strukturell
  ausgeschlossen — und Negativwerte gleich mit. Der Legacy-Export bildet einen 0-Preis ohnehin
  bereits auf `null` ab, ein gültiger Import löst den Constraint also nie aus; tut er es doch,
  sind die Daten falsch und der Import muss abbrechen. Zusätzlich: `price_updated_at` ist nur
  setzbar, wenn ein Preis existiert.
- Ein späterer Preisverlauf kommt als eigene Tabelle `price_history` dazu; `market_price` wird
  dann der zwischengespeicherte aktuelle Wert. Damit das ohne UI-Änderung möglich bleibt, liest
  die Anwendung den Preis nur an **einer** Stelle (`src/lib/catalog`).

---

## ADR-0011 — Lesbare Slugs für die Navigation, SKY-ID für die Identität

**Status:** ANGENOMMEN (2026-09-04) — Regel vollständig, an den echten 600 Legacy-Artikeln geprüft

**Grundsatz.**

- Öffentliche Figurenseiten verwenden lesbare URLs: `/skylanders/drobot`.
- Der Slug dient **ausschließlich der Navigation und Darstellung**.
- **Die SKY-ID bleibt die technische Identität.** Kein Fremdschlüssel, keine Datenbeziehung und
  keine Berechnung hängt vom Slug ab.
- **Ein einmal vergebener Slug ist stabil.** Eine spätere Änderung des Anzeigenamens verändert
  ihn **nicht** automatisch. Eine bewusste Slug-Änderung erfordert einen Redirect.

### Normalisierung

In dieser Reihenfolge auf den rohen Namen angewandt:

1. Umlaute ausschreiben: `ä`→`ae`, `ö`→`oe`, `ü`→`ue`, `ß`→`ss`
2. Übrige diakritische Zeichen über Unicode-Zerlegung entfernen
3. Kleinschreibung
4. **Apostrophe ersatzlos entfernen** — `Spyro's` → `spyros`, **nicht** `spyro-s`
5. Jede verbleibende Nicht-`[a-z0-9]`-Folge wird zu **einem** `-`.
   **Klammerzeichen verschwinden, ihr Inhalt bleibt erhalten:**
   `Spyro (Series 2)` → `spyro-series-2`, `Game (Xbox 360)` → `game-xbox-360`
6. Mehrfach-Bindestriche zusammenfassen, führende und abschließende entfernen

### Eindeutigkeit — drei Stufen

| Stufe | Regel | Beispiel |
|---|---|---|
| 1 | Slug aus dem Namen | `Drobot` → `drobot` |
| 2 | bei Kollision **Serien-Slug aus dem Series-Label** anhängen, nicht aus dem Code | `drobot-giants`, nicht `drobot-g` |
| 3 | falls `name + series` weiterhin kollidiert: **SKY-ID** anhängen | `pop-fizz-giants-sky-0123` |

Serien-Slugs: `spyros-adventure` · `giants` · `swap-force` · `trap-team` · `superchargers` ·
`imaginators`.

### Stabilitätsregel für spätere Importe

> **Bestehende Slugs werden nie neu berechnet.** Der Slug wird gegen die bereits vergebenen
> Slugs geprüft. Kollidiert ein **neu hinzukommender** Artikel mit einem bestehenden, erhält
> **nur der neue** die qualifizierte Form; der bestehende behält seinen Slug.

Beim Erstimport liegen alle 600 gleichzeitig vor — dort bekommen deshalb **beide** Seiten eines
Paares den Serien-Zusatz (`drobot-spyros-adventure` **und** `drobot-giants`). Danach gilt die
asymmetrische Regel. Ohne sie würde ein späterer Import bestehende URLs umbenennen und damit
die Stabilitätszusage brechen.

### Prüfung an den echten Daten (2026-09-04, read-only)

| Stufe | Ergebnis |
|---|---|
| 1 — nur Name | 547 Slugs, **32 Kollisionen**, 85 betroffene Artikel |
| 2 — + Serien-Slug | **600 / 600 eindeutig**, alle 85 aufgelöst |
| 3 — + SKY-ID | **nie ausgelöst** |

**Neue Kollisionen durch die Normalisierung: null.** Alle 32 Kollisionen stammen aus tatsächlich
identischen Namen — sieben Spiele-Titel über alle Serien (`Game (Xbox 360)` 6×,
`Spiel für Sony Playstation 3 PS3` 6×, `Wii U Spiel` 6×, …) und 25 Figuren mit genau zwei
Vorkommen, davon 24 als SA/G-Paar und `Kaos` in T/I.

Slug-Längen: min 4, Median 14, p90 25, max 50
(`spiel-fuer-sony-playstation-3-ps3-spyros-adventure`).

**Bekannte Fragilität, dokumentiert statt behoben.** Der Bestand enthält uneinheitliche
Schreibweisen derselben Figur: `Eye Brawl` neben `Eye-Brawl (Pumpkin)`, `Wham-Shell` neben
`Wham Shell - Lightcore`. Die Normalisierung macht `-` und Leerzeichen gleich. Heute kollidiert
nichts, weil jeweils ein Zusatz dahintersteht. Käme ein blankes `Eye Brawl` in derselben Serie
neben das bestehende `Eye-Brawl`, griffe Stufe 2 nicht (gleiche Serie) und Stufe 3 wäre nötig.
**Stufe 3 hat also einen realistischen Auslöser und bleibt nicht theoretisch.**
Die Schreibweisen werden **nicht** angeglichen — Namen kommen roh aus der Legacy-Quelle.

**Verworfen:** Serien-Code statt Label im Slug (`drobot-g` ist kryptisch) · Slug bei jedem
Import neu berechnen (bricht die Stabilitätszusage) · Klammerinhalt verwerfen (er ist
durchgehend bedeutungstragend: `(2)`, `(Clear Crystal)`, `(Xbox 360)`, `(Legendary)` …).

---

## ADR-0012 — Sprache: V1 ausschließlich Deutsch, spätere Internationalisierung offenhalten

**Status:** ANGENOMMEN (2026-09-03)

**Entscheidung.** V1 wird ausschließlich auf Deutsch umgesetzt. Es wird **kein** vollständiges
i18n-System gebaut und keine zweite Sprache angelegt. Entscheidungen, die eine spätere englische
Version unnötig erschweren würden, werden vermieden.

**Konkrete Vorkehrungen (billig, heute umsetzbar):**

1. **Keine Sprachkennung in URLs** in V1 (`/skylanders/…`, nicht `/de/skylanders/…`).
   Eine spätere Einführung von `/[locale]/…` bleibt möglich.
2. **Benutzersichtbare Texte werden nicht im JSX verstreut**, sondern zentral gehalten
   (`src/lib/i18n/de.ts` o. ä. — eine einfache Objektkonstante, kein Framework).
3. **Kategorie- und Seriennamen liegen in der Datenbank**, nicht im Code. Eine Übersetzungs-
   spalte oder -tabelle lässt sich später additiv ergänzen.
4. **Zahlen-, Datums- und Währungsformatierung** an einer Stelle (`src/lib/format.ts`) mit
   explizitem Locale `de-AT` — wie im Legacy-Projekt (`site/js/format.js`).
5. **Keine sprachabhängigen Slugs oder Schlüssel** in der Datenbank.

**Ausdrücklich nicht:** `next-intl`, `react-i18next`, Übersetzungsdateien, Sprachumschalter.

---

## ADR-0013 — Schlanker Testansatz für V1

**Status:** ANGENOMMEN (2026-09-03)

**Entscheidung.** Pflicht bei jeder relevanten Änderung:

1. **TypeScript Typecheck** (`npm run typecheck`)
2. **ESLint** (`npm run lint`)
3. **Next.js Production Build** (`npm run build`)
4. **Unit-Tests für kritische reine Geschäftslogik** — Sammlungswert, Fortschritt, Umgang mit
   fehlendem Preis, Slug-Erzeugung, Importregeln
5. **Tests für sicherheitskritische Datenbank-/RLS-Regeln** — ein zweites Testkonto kommt an
   fremde Sammlungen weder lesend noch schreibend heran

**Ausdrücklich nicht zu Beginn:** ein umfangreiches End-to-End-Testsystem. Playwright kann
ergänzt werden, sobald Auth und Sammlung stabil existieren.

**Begründung.** Getestet wird dort, wo ein Fehler teuer ist: falsche Zahlen und offene
Zugriffsrechte. Rendering-Details sind über Typecheck und Build ausreichend abgesichert.

**Umsetzung Punkt 5 (RLS).** `tools/verify-rls.mts`, gestartet mit `npm run verify:rls`.
Bewusst ein eigenständiges Node-Skript statt eines Test-Frameworks: der Test braucht echte
HTTP-Sessions gegen ein laufendes Supabase-Projekt, legt Benutzer an und räumt sie wieder ab.
Das gehört nicht in einen Unit-Test-Lauf, der bei jeder Änderung durchläuft. Node führt die
`.mts`-Datei dank Type-Stripping direkt aus — kein zusätzliches Werkzeug nötig.

**Entschieden bei der ersten testbaren Geschäftslogik (2026-09-04): Vitest.**
`npm test` → `vitest run`. Ausgelöst durch die Slug-Regel aus ADR-0011: sie ist reine,
DOM-freie Logik mit klar formulierbaren Erwartungen — genau der Fall, für den Punkt 4 oben
Unit-Tests verlangt.

Der Nutzen war sofort messbar: **der erste Testlauf deckte einen echten Fehler auf.**
Großbuchstaben-Umlaute wurden nicht ausgeschrieben (`Öl` → `ol` statt `oel`), weil die
Ersetzungstabelle nur Kleinbuchstaben kannte. Die 600 Legacy-Artikel enthalten ausschließlich
ein kleingeschriebenes `ü`, der Fehler wäre also durch jede Prüfung an den echten Daten
unentdeckt durchgerutscht und erst bei einem künftigen Namen aufgefallen.

`@types/node` wurde dabei von `^20` auf `^26` gehoben — Vitest 5 verlangt mindestens 22, und
die Laufzeit ist ohnehin Node 26. Die Typen passten vorher schlicht nicht zur Realität.

---

## ADR-0014 — Kein zusätzlicher Backend-Service

**Status:** ANGENOMMEN (2026-09-03)

**Entscheidung.** Next.js kommuniziert direkt mit Supabase über die dafür vorgesehenen
Mechanismen:

- Server Components
- Server Actions
- Route Handlers
- Supabase SSR (`@supabase/ssr`)

**Ohne konkreten Bedarf wird keine zusätzliche API-/Backend-Schicht eingeführt.** Es gibt
keinen eigenen API-Server, kein ORM mit eigener Abstraktionsschicht, kein GraphQL und keine
State-Management-Bibliothek.

**Die tatsächliche Sicherheitsgrenze ist:**

1. Supabase Auth
2. PostgreSQL Row Level Security
3. korrekte Policies

**Begründung.** Möglichst wenig technische Komplexität. Jede zusätzliche Schicht ist eine
weitere Stelle, an der Autorisierung falsch sein kann — und sie verleitet dazu, Prüfungen dort
statt in der Datenbank zu machen.

**Konsequenzen.** Datenzugriff und Berechnungen liegen gebündelt unter `src/lib/`, damit sie
testbar bleiben und später austauschbar sind.

---

## ADR-0015 — Supabase-Projekt in der EU-Region

**Status:** ANGENOMMEN (2026-09-03)

**Entscheidung.** Das Supabase-Projekt wird in einer EU-Region angelegt.

**Begründung.** Benutzerkonten bedeuten personenbezogene Daten; der Nutzer und die erwartete
Zielgruppe sind im DACH-Raum. Die Region ist nachträglich nur mit einer vollständigen Migration
änderbar — deshalb wird sie vor der Projektanlage festgelegt, nicht danach.

**Konsequenzen.** Bei der Projektanlage in V1.2 ist die Region ausdrücklich zu prüfen. Die
konkrete Region wird nach der Anlage hier und in `docs/SECURITY.md` nachgetragen.

---

## ADR-0016 — V1: private Profile, private Sammlungen, öffentlich lesbarer Katalog

**Status:** ANGENOMMEN (2026-09-03)

**Entscheidung.**

| Daten | Lesen | Schreiben |
|---|---|---|
| `profiles` | **nur das eigene Profil** | nur das eigene Profil |
| `collection_items` | **nur die eigene Sammlung** | nur die eigene Sammlung |
| `series`, `categories`, `skylanders` | **öffentlich lesbar** (auch anonym) | **niemals durch normale Benutzer** |

- **Profile sind in V1 privat.** Es gibt **keine öffentlichen Benutzerprofile** in V1.
- **Sammlungen sind in V1 privat.**
- **Katalogdaten sind öffentlich lesbar.** Normale Benutzer dürfen sie **niemals** ändern —
  Katalogtabellen bekommen gar keine schreibende Policy, geschrieben wird ausschließlich durch
  das lokale Importwerkzeug mit der Service Role.
- V1 benötigt Profile mit **eindeutigem Benutzernamen**.
- **Reservierte Systemnamen werden von Anfang an abgelehnt**: `admin`, `api`, `support`,
  `portalvault` sowie weitere technisch kritische Namen. Die Liste darf bei der Implementierung
  sinnvoll ergänzt werden.

**Begründung.** Restriktiv zu starten ist deutlich leichter, als eine zu offene Policy
nachträglich einzuschränken — eine einmal öffentlich gewesene Sammlung lässt sich nicht
zurückholen.

**Konsequenzen.** `collection_items` und `profiles` bekommen in V1 **keine** öffentliche
SELECT-Policy; gelesen wird ausschließlich mit `auth.uid() = user_id` bzw. `auth.uid() = id`.
Öffentliche Profile und öffentliche Sammlungen werden später über ein Flag
(`profiles.is_public`, `profiles.collection_public`) und erweiterte Policies ergänzt.

### Benutzernamen sind änderbar (entschieden 2026-09-04)

**Ein Benutzername darf später geändert werden.** Die technische Identität eines Kontos ist
**ausschließlich die UUID** (`auth.users.id` = `profiles.id`).

| Regel | |
|---|---|
| `username` als Primär- oder Fremdschlüssel | **niemals** |
| Sammlungen und alle späteren Beziehungen | referenzieren **immer die UUID** |
| Eindeutigkeit | case-insensitiv über `unique index on lower(username)` (ADR-0020) |
| V1.4 | ermöglicht Namensänderungen technisch |
| Sperrfrist (z. B. 30 Tage) | **keine V1-Anforderung**, später ergänzbar |

**Begründung.** Dieselbe Trennung wie bei der SKY-ID: Was Menschen lesen, ist nicht, was das
System zum Verknüpfen benutzt. `collection_items.user_id` zeigt auf `auth.users(id)`, nicht auf
den Namen — eine Umbenennung kann deshalb strukturell keine Daten verlieren. Das Schema aus
`0001_initial_schema.sql` erfüllt das bereits: `username` ist eine gewöhnliche, nullbare
Spalte mit Unique-Index, kein Schlüssel.

**Was eine Sperrfrist bräuchte und warum sie jetzt fehlt.** Sinn ergibt sie erst, wenn ein
Benutzername öffentlich sichtbar ist — bei öffentlichen Profilen, Community-Funktionen oder
einem Marketplace. Solange Profile privat sind (siehe oben), kann eine Umbenennung niemanden
in die Irre führen: es gibt keine öffentlichen Profil-Links, die ins Leere zeigen könnten, und
niemand kann sich unter einem gerade freigewordenen Namen als jemand anderes ausgeben, weil
niemand fremde Profile sieht.

**Zu entscheiden, sobald Profile öffentlich werden:** Sperrfrist, Historie freigewordener
Namen, und ob ein alter Name für eine Karenzzeit gesperrt bleibt.

---

## ADR-0017 — Sicherheitsgrenze: Auth und RLS, nicht die Geheimhaltung des Anon-Keys

**Status:** ANGENOMMEN (2026-09-03)

**Entscheidung.** Der Supabase Publishable-/Anon-Key ist **kein Secret**. Die Sicherheit des
Systems darf **niemals** davon abhängen, dass dieser Key verborgen ist.

Die tatsächliche Sicherheitsgrenze besteht aus:

1. Supabase Auth
2. PostgreSQL Row Level Security
3. korrekten Policies
4. serverseitiger Geheimhaltung privilegierter Keys

**Der Service-Role-Key darf niemals in Client-Code oder öffentliche Bundles gelangen.**

**Konsequenzen.** Der Anon-Key darf in `.env.example` als Platzhalter, im Browser-Bundle und in
der Vercel-Konfiguration erscheinen. Jede Policy wird so geschrieben, als wäre der Key öffentlich
bekannt — denn das ist er. Der Service-Role-Key existiert ausschließlich lokal in `.env.local`
für das Import-Werkzeug und wird nicht in Vercel hinterlegt, solange es dort keinen
Anwendungsfall gibt.

---

## ADR-0018 — E-Mail-Versand: kein externer SMTP-Anbieter in der lokalen Entwicklung

**Status:** ANGENOMMEN (2026-09-03)

**Entscheidung.** Für die lokale Entwicklung wird **kein** externer SMTP-Anbieter integriert;
der Supabase-Standardversand genügt zum Testen. Vor einer öffentlichen Beta muss der produktive
E-Mail-Versand **separat entschieden und eingerichtet** werden.

**Begründung.** Ein externer Anbieter ist ein kostenpflichtiger Dienst mit eigener
Absenderdomain und Zustellbarkeitskonfiguration — das gehört nicht in die Aufbauphase.
Der Standardversand ist stark limitiert und für eine öffentliche Beta nicht geeignet.

**Konsequenzen.** Registrierung und Passwort-Reset funktionieren lokal, aber mit engen
Versandlimits. Der Punkt steht als Voraussetzung in `docs/ROADMAP.md`, V1.7.

---

## ADR-0019 — Projektsprache: englischer Code, deutsche Oberfläche

**Status:** ANGENOMMEN (2026-09-03)

**Entscheidung.**

> **Die technische Projektsprache ist Englisch. Die Oberflächensprache von V1 ist Deutsch.**

**Englisch — verbindlich für alle technischen Projektartefakte:**

Ordnernamen · Dateinamen · Variablen · Funktionen · Klassen · Typen · Interfaces ·
Datenbanktabellen · Datenbankspalten · routeninterne Benennung · API-Benennung · Kommentare ·
Code-Dokumentation · Testnamen · Migrationsnamen · Skriptnamen · Commit-Messages ·
technische Dokumentationsinhalte, sofern es keinen starken Grund dagegen gibt.

**Keine deutschen technischen Bezeichner einführen.**

| So | Nicht so |
|---|---|
| `collection_items` | `sammlung` |
| `market_price` | `marktpreis` |
| `image_file` | `bild_datei` |
| `user_id` | `benutzer_id` |
| `sky_id` | — |
| `formatPrice()` | — |
| `getCollectionValue()` | `berechneSammlungswert()` |

**Deutsch — erlaubt für benutzersichtbare Inhalte:**

Navigationsbeschriftungen · Buttons · Überschriften · Formularbeschriftungen ·
Validierungsmeldungen für Benutzer · Erklärtexte · benutzersichtbare Seitenmetadaten.

Der umgebende Code bleibt dabei englisch:

```ts
// Schlüssel englisch, Wert deutsch
auth: { loginButton: "Anmelden" }
```

**Internationalisierung.** V1 ist deutschsprachig. Es wird **kein** vollständiges
i18n-Framework eingeführt, solange es nicht wirklich nötig ist (ADR-0012). Aber: benutzersichtbare
deutsche Strings werden nicht über die Komponenten verstreut, sondern zentral gehalten. Der
aktuelle schlanke Ansatz mit `src/lib/i18n/de.ts` ist für V1 ausdrücklich in Ordnung.
**Eine spätere englische Version muss möglich sein, ohne den technischen Codebase umzubenennen** —
genau deshalb ist er von Anfang an englisch.

**Bewusste Ausnahme: `docs/` und `CLAUDE.md` bleiben auf Deutsch.** Das ist der „starke Grund"
im Sinne der Regel: Diese Dateien sind die Arbeitsgrundlage des Nutzers und beschreiben ein
gewachsenes deutschsprachiges Legacy-System, dessen Regeln und Kategorienamen wörtlich zitiert
werden. **Alle technischen Bezeichner darin sind trotzdem englisch** (Tabellen, Spalten, Pfade,
Funktionen) — das ist der Teil, auf den es ankommt. Sollen die Dokumente später übersetzt
werden, ist das eine eigene Entscheidung und eine reine Textarbeit ohne Codeänderung.

**Konsequenzen und bereits umgesetzt.**

- Alle Bezeichner in `src/` waren bereits englisch und wurden **nicht** umbenannt.
- Code-Kommentare, `.gitignore`, `.env.example` und die `package.json`-Beschreibung wurden von
  Deutsch auf Englisch umgestellt.
- `src/lib/i18n/de.ts` behält den Dateinamen (`de` ist ein Locale-Code, kein deutsches Wort);
  seine Schlüssel sind englisch, seine Werte deutsch.
- Commit-Messages sind englisch.
- Die Regel steht dauerhaft in `CLAUDE.md` und `docs/ARCHITECTURE.md`.

---

## ADR-0020 — Case-insensitive Benutzernamen ohne `citext`

**Status:** ANGENOMMEN (2026-09-03) — **ersetzt den `citext`-Plan** aus `docs/DATABASE.md`

**Kontext.** `docs/DATABASE.md` sah ursprünglich `username citext unique` vor. Bei der
Umsetzung der ersten Migration war ausdrücklich zu prüfen, ob das für Supabase/PostgreSQL
sauber ist.

**Entscheidung.** `username` ist eine gewöhnliche `text`-Spalte. Die case-insensitive
Eindeutigkeit erzwingt ein partieller Unique-Index:

```sql
create unique index profiles_username_lower_uniq
  on public.profiles (lower(username))
  where username is not null;
```

**Begründung — drei Gründe gegen `citext`:**

1. **Musteroperatoren bleiben case-sensitiv.** `citext` überlädt die Vergleichsoperatoren,
   **nicht** aber `~` und `LIKE`. Der Format-CHECK `username ~ '^[a-zA-Z0-9_]{3,20}$'` würde
   sich also anders verhalten als die Eindeutigkeitsregel — ein Widerspruch, der beim Lesen
   des Schemas nicht sichtbar ist.
2. **Erweiterungsabhängigkeit.** `citext` müsste installiert werden; im Schema `public`
   beanstandet Supabases Linter das, im Schema `extensions` hängt die Auflösung am
   `search_path` — beides zusätzliche bewegliche Teile für einen Zweck, den ein Index erfüllt.
3. **`citext` gilt als Auslaufmodell** und wird in der PostgreSQL-Dokumentation zugunsten
   nicht-deterministischer Collations relativiert.

**Konsequenzen.**

- Die **getippte Schreibweise bleibt erhalten** (`JulianStocker` wird so angezeigt), während
  `julianstocker` und `JULIANSTOCKER` kollidieren. Das ist besser als `citext`, das die
  Schreibweise zwar speichert, aber zu Verwechslungen einlädt.
- **Konvention, die eingehalten werden muss:** jede Suche nach einem Benutzernamen verwendet
  `lower(username) = lower($1)`. Ohne `lower()` greift der Index nicht und die Suche wäre
  case-sensitiv. Dokumentiert in `docs/DATABASE.md` und `docs/AUTH.md`.
- Der Index ist partiell (`where username is not null`), weil `username` bis zum Onboarding
  `NULL` ist.

**Verworfen:** `citext` (siehe oben) · nicht-deterministische ICU-Collation (elegant, aber
schließt Musteroperatoren und Präfix-Indizes auf der Spalte aus, die eine spätere
Benutzersuche brauchen könnte).

---

## ADR-0021 — PortalVault V1 ist eine Sammler- und Analyseplattform, kein Marketplace

**Status:** ANGENOMMEN (2026-09-04)

**Entscheidung.** V1 ist eine Skylanders-**Sammler- und Analyseplattform**. Marketplace,
Trading, Seller-Funktionen, Payments, Versand, Bewertungen und Disputes gehören ausdrücklich
**nicht** zum ersten Produkt.

**Der V1-Kern:**

1. visueller Skylanders-Katalog als zentraler Einstieg
2. persönliche Sammlung
3. schneller Owned/Not-Owned-Toggle — antippen, erneut antippen, Zustand sofort sichtbar
4. Fortschritt gesamt und je Serie
5. mehrere Sammlungsansichten (Grid, kompakt, Tabelle) — Grid zuerst
6. Analytics und optionale Premium-Funktionen später

**Bedingung statt Datum.** Die Marketplace-Richtung wird **erst dann erneut bewertet, wenn
PortalVault nachweislich echte Nutzer gewinnt** und die Sammlungsplattform angenommen wird.
Das ist bewusst keine Zeitangabe: „deutlich später" lädt dazu ein, doch schon einmal etwas
vorzubereiten. Vor diesem Nachweis wird an Marketplace-Funktionen nicht gearbeitet — auch nicht
konzeptionell, auch nicht „nur das Datenmodell".

**Begründung.** Ein Marketplace braucht Angebot **und** Nachfrage gleichzeitig. Eine
Sammlungsplattform ist ab dem ersten Nutzer nützlich. Der Weg von einer angenommenen
Sammlungsplattform zu einem Marketplace ist gangbar; der umgekehrte nicht.

**Konsequenzen.**

- Das Datenmodell bleibt wie in ADR-0005 und `docs/DATABASE.md`, Abschnitt 7: die Andockpunkte
  für `listings`, `wishlist_items` und Zustände je Exemplar sind dokumentiert, aber **nicht
  gebaut**.
- Die zentrale UX-Anforderung von V1 ist **Erfassungsgeschwindigkeit**, nicht Funktionsumfang.
- Die Roadmap führt Marketplace ab sofort unter einer Bedingung, nicht unter einem Zeitpunkt.

**Acquisition (Teil derselben Entscheidung).** Erster realistischer Nutzerkanal ist der
bestehende eBay-Skylanders-Shop: QR-Codes oder Hinweise in Paketen bringen Käufer genau in dem
Moment zur Plattform, in dem sie neue Figuren in der Hand halten. **Daraus folgt eine technische
Anforderung, keine Marketing-Notiz:** Mehrere frisch gekaufte Figuren müssen sich **mobil sehr
schnell** erfassen lassen. Das begründet den Owned-Toggle als Anforderung an das Katalog-UI.

---

## ADR-0022 — Free und Premium: Richtung festgelegt, Grenze und Preis offen

**Status:** TEILWEISE ANGENOMMEN (2026-09-04) — die Richtung steht, die Ausgestaltung ist
**OPEN DECISION**

**Angenommen:**

- **Free muss ein eigenständiges, dauerhaft nützliches Produkt sein.** Keine Demo, keine
  künstlich beschnittene Testversion, kein Zeitlimit.
- **Free-Kern mindestens:** Katalog, persönliche Sammlung, Owned/Not-Owned, grundlegender
  Fortschritt.
- Eine **optionale günstige Premium-Stufe** ist als spätere Monetarisierungsrichtung vorgesehen.

**Aktuelle Tendenz (2026-09-04) — ausdrücklich noch keine Entscheidung:**

| Stufe | Tendenz |
|---|---|
| **Free** | vollständiges **Sammeln und Organisieren** |
| **PortalVault+** | **Preise, Werte und Analytics** |

Diese Trennlinie ist schlüssig, weil sie Free nicht verstümmelt: Wer sammelt und organisiert,
hat ein vollständiges Produkt. Der Mehrwert liegt dann in der Bewertung, nicht im Grundnutzen.
Sie ist aber **noch keine endgültige Feature- oder Preisentscheidung** — insbesondere ist damit
nicht entschieden, auf welcher Seite Mengen/Duplikate landen.

**Offen — ausdrücklich NICHT entschieden:**

- **Welche Funktionen Premium sind.** Denkbar: Mengen/Duplikate · Marktpreise · Gesamtwert ·
  Wert je Serie · erweiterte Analytics · Preisentwicklung · Export. „Denkbar" heißt hier
  wörtlich denkbar, nicht vorgesehen.
- **Der Preis.** „0,99 €/Monat" ist bisher **nur eine Idee**, keine Produktentscheidung.
- **Ob Mengen/Duplikate Free oder Premium werden.** Technisch unterstützt das Datenmodell sie
  bereits (`collection_items.quantity`) — das ist eine Datenmodell-Eigenschaft, keine
  Produktzusage.

**Konsequenz für die Implementierung.** Solange die Grenze nicht entschieden ist, wird **keine
Zahlungsschranke, kein Feature-Flag-System und keine Abrechnungslogik** gebaut. Alle V1-
Funktionen werden zunächst ohne Stufenlogik implementiert. Eine spätere Trennung ist billig,
solange die Fachlogik gebündelt in `src/lib/` liegt (ADR-0014); eine vorschnell eingezogene
Schranke wäre teuer und würde Free unnötig verstümmeln.

**Zu entscheiden vor:** jeder Arbeit an Zahlungen oder Zugriffsstufen. Nicht vor V1.7.

---

## ADR-0023 — Reihenfolge der Meilensteine: Auth vor dem Katalog-UI

**Status:** ANGENOMMEN (2026-09-04)

**Kontext.** Die ursprüngliche Reihenfolge war V1.3 Import → V1.4 Katalog → V1.5 Auth →
V1.6 Sammlung. Der End-to-End-Fluss (Registrieren → Einloggen → Katalog → Antippen → eigene
Sammlung) wäre damit erst am Ende von V1.6 erlebbar gewesen. ADR-0021 macht genau diesen Fluss
zum Kern des Produkts.

**Entscheidung — die Reihenfolge lautet:**

| Meilenstein | Inhalt |
|---|---|
| **V1.3** | Katalogimport |
| **V1.4** | Auth + `@supabase/ssr`: Registrierung, E-Mail-Bestätigung, Login, Logout, Passwort vergessen/Reset, Onboarding/Username, geschützter Bereich |
| **V1.5** | Visueller Katalog + Owned/Not-Owned-Toggle + minimale Seite „Meine Sammlung" — **erster vollständiger End-to-End-Produktfluss** |
| **V1.6** | Ausbau: mehrere Sammlungsansichten, Fortschritt gesamt und pro Serie, Mengen/Duplikate, Mobile-Feinschliff, weitere Collection-UX |
| **V1.7** | Beta-Reife |

**Begründung.**

1. **Der Import bleibt unstrittig zuerst.** Ohne die 600 Zeilen und 475 Bilder hat jede
   Oberfläche nichts zu zeigen, und der Import validiert zugleich die Datenqualität.
2. **Die Katalogkarte trägt den Owned-Zustand und ist damit sitzungsabhängig.** Ohne Auth
   gebaut, müsste sie später umgebaut werden — genau die Nacharbeit, die dieses Projekt
   vermeidet. Mit Auth zuerst entsteht sie einmal, in Endform.
3. **`@supabase/ssr` steht, bevor Seiten davon abhängen.** Session-Handling nachträglich in
   fertige Seiten einzuziehen, ist teurer als es vorher zu haben.
4. **Der E2E-Fluss ist eine Stufe früher erlebbar** — Ende V1.5 statt Ende V1.6.

**Bewusst in Kauf genommen.** V1.4 liefert kein für Besucher sichtbares Ergebnis. Der
öffentliche Katalog wäre auch anonym lesbar (ADR-0016) und ließe sich früher zeigen. Der
Preis ist ein Meilenstein ohne Vorzeigbares; der Gegenwert ist, dass V1.5 sofort den
vollständigen Fluss liefert statt nur einen Katalog zum Anschauen.

**Konsequenzen.**

- Verweise auf „Auth-UI (V1.5)" in `docs/AUTH.md`, `docs/SECURITY.md` und `PROJECT_STATUS.md`
  lauten jetzt V1.4; Verweise auf „Katalog-UI (V1.4)" lauten V1.5.
- Die Sammlungsseite in V1.5 ist ausdrücklich **minimal** — nur das visuelle Grid. Ansichten,
  Fortschritt und Mengen kommen in V1.6. Das hält V1.5 klein genug, um den Fluss zu erreichen,
  ohne ihn mit Ausbaufunktionen zu überladen.
- Premium-Grenzen bleiben unberührt und offen (ADR-0022); Marketplace bleibt außerhalb von V1
  (ADR-0021).

---

## ADR-0024 — Marktpreise gehören PortalVault; externe Quellen werden über eine stabile Kennung gemappt

**Status:** Richtung ANGENOMMEN (2026-09-04) · **Umsetzung ausdrücklich noch nicht begonnen**

**Grundsatz.**

> **PortalVault-Preise gehören PortalVault. Easybuy ist zunächst nur eine externe Preisquelle.
> Die dauerhafte interne Identität ist immer `sky_id`.**

**Zielmodell.**

```
Easybuy External Identifier / URL  →  gespeichertes Mapping  →  SKY-ID  →  market_price
```

Ein **Name darf höchstens beim erstmaligen Matching helfen** und niemals dauerhaft die
Identität bestimmen.

**Begründung aus der Legacy-Analyse (2026-09-04, read-only).** Das bestehende Mapping ist
bereits explizit und persistent, aber sein **Schlüssel ist der Titel**:
`(Serie, externer Titel) → SKY-ID`. Benennt Easybuy ein Produkt um, bricht die Zuordnung und
der Artikel landet stillschweigend in `unmatched` — der Preis bleibt dann einfach alt.

Die Analyse zeigte jedoch: Für **alle 393** gemappten Einträge ist bereits eine Produkt-URL
gespeichert, und der daraus extrahierte **Shopify-Handle ist über alle 393 hinweg eindeutig** —
im Gegensatz zum Titel, der ohne die Serie mehrdeutig ist (`Bash` existiert zweimal).
Der Handle wird heute **gespeichert, aber nicht zum Matching verwendet**. Damit liegt die
stabilere Kennung bereits vor; sie muss nur zum Schlüssel werden.

**Konsequenzen für die spätere Umsetzung.**

- Der Mapping-Schlüssel wird der **Handle** (`/products/<handle>`), nicht der Titel.
  Query-Parameter (`_pos`, `_fid`, `_ss`) sind Paginierungsartefakte und werden beim Speichern
  **abgeschnitten**.
- Der Titel wird weiterhin gespeichert — als Anzeigehilfe und für das **Erkennen von
  Umbenennungen**: gleicher Handle, geänderter Titel → Hinweis, kein Fehler.
- Eine noch stabilere Kennung wäre die numerische Shopify-Produkt-ID. Sie ist über
  `/products/<handle>.js` abrufbar, wird heute aber nicht erfasst. **Offen**, ob sie zusätzlich
  gespeichert wird — sie überlebt auch eine Handle-Änderung.
- **Der Preis wird in PortalVault gehalten** (`skylanders.market_price`, ADR-0010), nicht in der
  Quelle. Ein manuelles Setzen einzelner Preise muss möglich sein, ohne die externe Quelle zu
  berühren.

**Vorgesehener Terminal-Workflow (noch nicht gebaut).** Dry-Run → ungeklärte und umbenannte
Einträge anzeigen → Preisänderungen prüfen → erst mit **explizitem Apply** nach Supabase
schreiben. Dazu das manuelle Setzen einzelner Preise.

**Aus dem Legacy-Werkzeug konzeptionell zu übernehmen** (Code nicht kopieren):
ausschließlich explizite Zuordnungen, **kein Fuzzy-Matching** · unauflösbare Einträge
überspringen und protokollieren statt raten · technische Inkonsistenzen brechen hart ab ·
Dry-Run vor jedem Schreibvorgang · vollständige Protokollierung jedes Laufs.

> Ein fehlendes Preisupdate ist ausdrücklich besser als eine falsche Zuordnung.

**Verhältnis zu ADR-0007.** ADR-0007 hält fest, dass das Preisupdate **vorerst** im
Legacy-Projekt bleibt. Das gilt unverändert. ADR-0024 beschreibt das Zielmodell für den
Zeitpunkt, an dem PortalVault die Preishoheit übernimmt — **frühestens nach V1**.

**Offen:** ob die numerische Shopify-Produkt-ID zusätzlich gespeichert wird · wann die
Preishoheit tatsächlich übergeht · ob Scraping-Logik und Quell-URLs überhaupt jemals ins
PortalVault-Repository wandern (heute untersagt, `docs/SECURITY.md`).

---

## ADR-0025 — `/` ist der Katalog, keine Landingpage

**Status:** ANGENOMMEN (2026-09-04)

**Entscheidung.** Die öffentliche Startseite ist unmittelbar der Skylanders-Katalog. Es gibt
keine vorgeschaltete Landingpage, kein Marketing-Intro, keinen Zwischenschritt.

**Begründung.** Der erste geplante Nutzerkanal ist der eBay-Shop: Paket → QR-Code → SkyIsles
(ADR-0021). Wer gerade Figuren auspackt, will sie erfassen, nicht lesen, worum es geht. Eine
Landingpage wäre genau ein Klick zwischen Absicht und Handlung — an der Stelle, an der die
Absicht am stärksten ist.

**Konsequenzen.**

- Der Katalog muss **ohne Konto vollständig nutzbar** sein: alle aktiven Figuren, Suche,
  Serienfilter, Detailseiten. Erst die Sammlungsaktion verlangt eine Anmeldung (ADR-0027).
- `/` ist damit die meistbesuchte Seite und bestimmt den ersten Eindruck. Sie ist mobile-first
  ausgelegt, weil der QR-Einstieg immer am Handy stattfindet.
- Erklärende Inhalte („Was ist SkyIsles?") brauchen später einen eigenen Platz. Sie zurück auf
  `/` zu holen wäre eine Rücknahme dieser Entscheidung.

---

## ADR-0026 — Katalog vollständig serverseitig laden, im Browser filtern

**Status:** ANGENOMMEN (2026-09-04)

**Entscheidung.** Die Server Component lädt **alle** aktiven Figuren in einer Abfrage und
übergibt sie an eine Client Component. Suche und Serienfilter laufen vollständig im Browser.
**Keine Pagination, kein Infinite Scroll, keine Virtualisierung, kein Suchendpunkt.**

**Begründung — gemessen, nicht geschätzt (2026-09-04):**

```
600 aktive Figuren
Katalog-Payload:  103 KB roh  ->  13,6 KB gzip  ->  ~11 KB brotli
```

Die vollständige Katalogantwort ist kleiner als ein einzelnes Figurenbild (Median 21 KB). Jede
Serverrunde für einen Tastendruck wäre langsamer als das Filtern selbst und würde Last
erzeugen, ohne irgendetwas zu verbessern.

**Konsequenzen.**

- Zwei Abfragen je Seitenaufruf: Katalog und — nur für Angemeldete — die eigenen
  Sammlungseinträge. Kein N+1, keine Abfrage pro Karte.
- Der Browser bekommt Daten, nie eine Datenbankverbindung. RLS bleibt unberührt.
- Suche über `useDeferredValue` statt Debounce: kein Timer, kein verlorener Tastendruck.
- **Diese Entscheidung hängt an der Größe.** Sie gilt, solange der Katalog in dieser
  Größenordnung bleibt. Käme das Zehnfache dazu — etwa durch Disney Infinity oder mehrere
  Bilder je Figur — ist sie neu zu bewerten.
- Optimierungen werden **nicht vorsorglich** eingebaut. Zeigt eine Messung auf einem echten
  mobilen Gerät ein Problem, wird es dann behandelt.
- **Nachtrag 2026-09-06 (V4.3):** Genau dieser Fall trat auf `/collection` ein — dort ging der
  Katalog nicht in eine Suche, sondern nur in Nenner. Gemessen mit 448 Figuren: 1,50 MB HTML,
  davon 496 KB RSC-Payload, nichts davor sichtbar. Der Katalog wird für diese Seite nicht mehr
  geladen; es reisen sechs Zahlen. **Für den Katalog selbst gilt ADR-0026 unverändert.**

---

## ADR-0027 — Die Sammlungsaktion: Anmeldung mit Kontext, Mutation als Endzustand

**Status:** ANGENOMMEN (2026-09-04)

### Ohne Anmeldung

`+ Sammlung` führt über die bestehende sichere Redirect-Logik zu Login oder Registrierung und
anschließend **in denselben Katalogkontext** zurück — gleiche Serie, gleiche Suche.

**Die begonnene Aktion wird nicht automatisch nachgeholt.** Kein `?add=…`, keine
Zustandsänderung durch einen GET-Aufruf, kein Intent-Cookie.

**Begründung.** Ein automatisch ausgeführter GET-Parameter wäre eine ungefragte Änderung: Ein
präparierter Link könnte fremden Konten Figuren hinzufügen. Ein Intent-Cookie wiederum
scheitert genau im wichtigsten Fall — die Registrierung verlangt eine E-Mail-Bestätigung, der
Mensch verlässt die Seite und kommt womöglich Tage später auf einem anderen Gerät zurück. Das
Cookie ist dann weg oder falsch. Ein zweiter Tipp nach der Anmeldung ist der ehrlichere Handel.

Optional darf die zuvor gemeinte Figur nach dem Rücksprung hervorgehoben werden, wenn das ohne
zusätzliche Komplexität geht. **Kein Pflichtbestandteil.**

### Mit Anmeldung: die Mutation drückt den Endzustand aus

`setCollected(skyId, true | false)` — **kein Toggle**, der erst liest und dann entscheidet.

| Wunsch | Umsetzung |
|---|---|
| `true` | `INSERT` mit `quantity: 1`; ein Unique-Verstoß (`23505`) gilt als Erfolg |
| `false` | `DELETE` auf die eigene Zeile |

**Warum kein Toggle.** Ein „lies den Zustand, dann kehre ihn um" ist bei zwei schnellen Tipps
nicht vorhersagbar: Beide Anfragen lesen denselben Ausgangszustand und schreiben dasselbe
Ergebnis. Eine Mutation, die den **gewünschten Endzustand** benennt, ist dagegen bei jeder
Wiederholung identisch — genau das, was optimistisches UI braucht.

**Warum `INSERT` statt `UPSERT`.** Ein Upsert würde `quantity` auf 1 zurücksetzen. Sobald V1.6
Mengen einführt, hätte ein doppelter Tipp stillschweigend eine Menge von 5 auf 1 reduziert.
Der ignorierte Unique-Verstoß erhält den bestehenden Wert.

**Sicherheit.** `user_id` kommt ausschließlich aus `getUser()`, nie aus dem Formular. Die
SKY-ID wird serverseitig gegen `^SKY-[0-9]{4}$` geprüft. RLS bleibt die Grenze; im
Produktcode existiert kein Service-Role-Key.

---

## ADR-0028 — SkyIsles ist der öffentliche Produktname, PortalVault der technische

**Status:** ANGENOMMEN (2026-09-04)

**Entscheidung.** Ab V1.5 heißt die sichtbare Anwendung **SkyIsles**. Technisch bleibt alles
**PortalVault**: Repository, GitHub-Projekt, Paketname, Verzeichnisstruktur, Bezeichner.

**Umfang der Änderung:** `de.app.name` und davon abgeleitete sichtbare Texte. Sonst nichts.

**Begründung.** Ein sichtbarer Name lässt sich an einer Stelle ändern; ein technisches
Umbenennen berührt Repository-URL, Remotes, Paketnamen, Importpfade und jede Referenz in der
Dokumentation. Beides zu vermischen würde eine reine Textänderung zu einem Umbau machen — und
die Vergleichbarkeit der Git-Historie beschädigen.

**Konsequenz.** In `docs/` und im Code darf „PortalVault" weiterhin stehen, wo das technische
Projekt gemeint ist. Wo Nutzer etwas lesen, steht „SkyIsles". Ein späteres vollständiges
Renaming ist eine eigene Entscheidung.

---

## ADR-0029 — Sammelbarkeit entscheidet die Kategorie, nicht der Name

**Status:** ANGENOMMEN (2026-09-04)

**Problem.** Der öffentliche Katalog zeigte 39 Konsolenspiele zwischen den Figuren. Sie
verfälschen den Sammlungsfortschritt: Wer alle Figuren besäße, käme nie auf 100 %, weil ihm
noch Software fehlte.

**Entscheidung.** Ein Eintrag ist sammelbar, **außer seine Kategorie sagt etwas anderes**.
Nicht sammelbar ist derzeit genau eine Kategorie: `Spiele`.

Die Regel liegt zentral in `src/lib/catalog/collectible.ts` und wird von Katalog, Detailseite
und Sammlungsstatistik gemeinsam benutzt — eine Definition, drei Verwendungsstellen.

**Warum die Kategorie und nicht der Name.** Eine Namensliste über 39 Einträge wäre bei jedem
neuen Spiel unvollständig und bei jeder Umbenennung falsch. Die Kategorie ist die vom Nutzer
selbst gepflegte fachliche Einordnung (`etl/categories.py`) und trennt die Menge exakt.

**An den echten Daten belegt.** 6 Kategorien `Spiele`, alle an Position 0, 39 Einträge, alle
Software · 0 spielartige Einträge außerhalb · 0 Sammelobjekte innerhalb. Unabhängige
Bestätigung: alle 39 haben **kein Bild**, 534 der 561 sammelbaren haben eines.

**Konsequenzen.**

- Kataloggesamtzahl **600 → 561**. Der Fortschritt bezieht sich auf 561, ist also erreichbar.
- **Keine Daten gelöscht, kein Schema geändert.** Die 39 Zeilen bleiben unverändert stehen.
- **Detailseiten nicht sammelbarer Einträge liefern 404.** Blieben sie erreichbar, böten sie
  einen Sammeln-Button für etwas, das anschließend zu nichts zählt — ein sichtbar
  widersprüchlicher Zustand. Die Zeilen bleiben trotzdem erhalten: Konsolenspiele sind genau
  die Art Bestand, die ein späterer First-Party-Shop verkaufen könnte.
- **Bereits gesammelte Spiele verschwinden nicht.** Sie werden weiter angezeigt und gesondert
  ausgewiesen, zählen aber nicht in Anzahl, Fortschritt oder Wert — dieselbe Behandlung wie
  Figuren, die den Katalog verlassen haben.

**Bekannte Kopplung.** Die Kategorienamen stammen aus dem Legacy-Projekt. Eine Umbenennung dort
muss hier nachgezogen werden; der Test hält die Ausschlussmenge auf genau einem Eintrag fest,
damit eine Erweiterung nie beiläufig passiert.

**Verworfen:** Namens-Blacklist (unvollständig, brüchig) · Filter über `categoryPosition === 0`
(bricht, sobald sich die Blockreihenfolge in der Excel ändert) · Spalte
`categories.is_collectible` (Schemaänderung, die die Abhängigkeit von den Kategorienamen nur
in den Import verschiebt, statt sie aufzulösen).

---

## ADR-0030 — Variantenanzeige wird abgeleitet, nicht gespeichert

**Status:** ANGENOMMEN (2026-09-04)

**Problem.** Der Katalog schreibt Varianten uneinheitlich: `Legendary Astroblast` als Präfix,
aber `Hex (Pearl)` als Suffix. Dadurch stehen Basisfigur und Variante im Katalog auseinander,
und dieselbe Sache heißt zweimal anders.

**Entscheidung.** Der Anzeigename wird **beim Lesen abgeleitet**. `skylanders.name` bleibt
unverändert.

### Warum nichts in der Datenbank geändert wird

Zwei unabhängige Gründe, beide zwingend:

1. **Der Import würde es überschreiben.** `tools/import-catalog.mts` schreibt bei jedem Lauf
   `name: item.name` per Upsert. Eine Umbenennung in der Datenbank wäre beim nächsten
   `catalog:import --apply` still verschwunden.
2. **Es widerspräche einer Kernregel.** CLAUDE.md Regel 4 und `docs/SKYLANDERS_DATA.md`
   Importregel 4: Namen kommen roh aus der Legacy-Quelle, ohne Normalisierung oder Korrektur.

Die Namenshoheit liegt bei der Excel. PortalVault darf sie anders **darstellen**, nicht anders
**speichern**.

### Die Regel

Ein führendes Token gilt nur dann als Variante, wenn **der verbleibende Basisname als
sammelbarer Eintrag in derselben Serie existiert**.

Tokens: `Legendary` · `Dark` · `Nitro` · `Golden` · `Power Blue` · `Blue` · `Mystical` ·
`Metallic`. Längere zuerst, damit `Power Blue` vor `Blue` greift.

**`Elite` und `Enchanted` gehören ausdrücklich nicht dazu** — Eon's Elite ist eine eigene
Produktlinie, und das einzige `Enchanted`-Präfix ist eine Location.

Die zweite Bedingung trägt die ganze Sicherheit:

| Name | Basis in der Serie? | Ergebnis |
|---|---|---|
| `Legendary Astroblast` | `Astroblast` ✓ | `Astroblast (Legendary)` |
| `Dark Spyro` | `Spyro` ✓ | `Spyro (Dark)` |
| `Dark Sword` | `Sword` ✗ | unverändert — Traps heißen `<Element> <Form>`: `Air Sword`, `Earth Hammer`, `Dark Sword`. „Dark" ist hier das Element |
| `Golden Queen` | `Queen` ✗ | unverändert |
| `Legendary Grim Creemper` | `Grim Creemper` ✗ | unverändert — die Basis heißt `Grim Creeper`, ein Tippfehler in der Quelle |

**An den echten Daten gemessen:** 55 Einträge erkannt, 11 Kandidaten korrekt abgelehnt,
**0 Kollisionen** im Anzeigenamen innerhalb einer Serie. Alle 55 Varianten liegen in derselben
Kategorie wie ihre Basis, die Blockreihenfolge bleibt also unangetastet.

### Sortierung

Innerhalb einer Kategorie wird nach **Basisname** sortiert, dann Basis vor Variante, dann nach
Variantenlabel. Die Teile werden **getrennt verglichen**, nicht zu einem String verkettet: Ein
zusammengesetzter Schlüssel bräuchte ein Trennzeichen, und wie ein Collator Satzzeichen gegen
Buchstaben einordnet, ist genau die Art Detail, die still umsortiert.

So bleibt eine Familie zusammen, auch wenn eine andere Figur mit demselben Wort beginnt:
`Bash`, `Bash (Blue)`, `Bash (Legendary)`, danach erst `Bash Junior`.

### Suche

Der Suchindex enthält **drei Schreibweisen**: den kanonischen Namen, den Anzeigenamen und die
Wortfolge dazwischen. `Legendary Bash`, `Bash (Legendary)` und `Bash Legendary` finden alle
dieselbe Figur.

### Konsequenzen

- **Keine Migration, keine Schemaänderung, kein Schreibvorgang.**
- **Slugs unverändert** — `/skylanders/legendary-bash` bleibt gültig (ADR-0011).
- **`collection_items` unberührt** — alles hängt an der SKY-ID.
- Kein `display_name`-Feld: Die Ableitungsregel läge ohnehin im Code, eine Spalte brächte nur
  eine zweite Wahrheit. Sie wäre erst richtig, wenn Einzelfälle **von Hand** kuratiert werden
  sollen.

**Bewusst nicht behandelt:** die drei LightCore-Schreibweisen (`Chill Light Core`,
`Grim Creeper - Lightcore`, `Start Strike (LC, Enchanted)`), die bestehenden Klammersuffixe wie
`(2)` oder `(Clear Crystal)`, und der Tippfehler `Legendary Grim Creemper`. Alles eigene
Datenqualitätsfälle.


---

## ADR-0031 — Entfernen ist rückgängig zu machen, statt bestätigt zu werden

**Status:** ANGENOMMEN (2026-09-04)

**Problem.** Eine Figur ließ sich nur im Katalog wieder entfernen. Wer in seiner Sammlung
stand und einen Fehleintrag sah, musste erst zurück in den Katalog navigieren und die Figur
dort suchen. Auf `/collection` fehlte die Aktion vollständig.

**Entscheidung.** Jede gesammelte Figur trägt auf `/collection` eine eigene Remove-Aktion.
Ein Bestätigungsdialog gibt es **nicht**. Stattdessen bleibt die entfernte Karte stehen —
abgeblendet, mit „Rückgängig".

### Warum kein Dialog

Ein Dialog schützt vor **unumkehrbaren** Aktionen. Diese ist umkehrbar: Ein Tipp stellt den
Eintrag wieder her, und `collection_items` trägt außer der Menge keine Daten, die verloren
gehen könnten. Ein Dialog würde hier jeden absichtlichen Klick bestrafen, um den seltenen
versehentlichen abzufangen — auf dem Handy, wo entfernt wird, doppelt lästig.

Der Fehlgriff wird stattdessen an der Quelle verhindert: **44 px Mindesthöhe** (`min-h-11`)
für die Schaltfläche, und sie liegt außerhalb des Kartenlinks, damit ein Tipp darauf nicht
zur Detailseite führt.

### Keine neue Serverlogik

Beide Wege rufen dieselbe Server Action `setCollected(skyId, collected)`. Sie war bereits
vollständig korrekt und wurde **nicht angefasst**:

- Sie nennt den **Zielzustand**, nicht „umschalten" — schnelles Mehrfachtippen kann daher
  keinen Zählerdrift erzeugen (ADR-0027).
- Das `DELETE` filtert nur auf `user_id` und `sky_id`. Kein `is_active`-Filter: eine nicht
  mehr erhältliche Figur bleibt entfernbar. Kein Mengenfilter: die **ganze Zeile** geht,
  auch bei `quantity > 1`.
- Ein `DELETE` ohne Treffer meldet keinen Fehler — das Entfernen ist idempotent.

### Die Zahlen rechnen im Client mit

`/collection` ist eine dünne Server-Komponente; Zählung, Fortschritt, Sammlungswert und die
Hinweise („ohne Preis", „nicht mehr erhältlich") entstehen in `CollectionView` aus
**derselben** getesteten Funktion `collectionStats`, die auch der Server benutzt. Optimistische
Ansicht und neu geladene Seite können deshalb nicht auseinanderlaufen. Scheitert der
Serveraufruf, wird die Karte zurückgesetzt und ein Fehler an der Schaltfläche angezeigt.

**~~Bekannte Grenze~~ — behoben (2026-09-05).** Ein „Rückgängig" fügte mit `quantity: 1`
wieder ein und hätte die Menge verloren. `setCollected` nimmt jetzt optional die Menge entgegen,
und der Sammlungsbereich reicht die ursprüngliche durch. Das bleibt ein Zielzustand: „gesammelt,
vier Stück" ist so wiederholbar wie „gesammelt". Ohne Mengenangabe verhält sich der Aufruf
unverändert, damit ein doppelter Tipp im Katalog keinen Zähler zurücksetzt. Semantik in
`docs/DATABASE.md`.

**Verworfen:** Bestätigungsdialog (bestraft den Normalfall) · Toast mit Undo (verschwindet
nach Sekunden, auf dem Handy leicht zu verpassen) · sofortiges Ausblenden der Karte (nimmt dem
Rückgängig den Ankerpunkt) · Mengen-Stepper (gehört zu V1.6, nicht in diese Änderung).

---

## ADR-0032 — Collector-Domain und First-Party-Shop-Domain sind getrennt

**Status:** Fachliche Richtung ANGENOMMEN (2026-09-04) · **Nichts davon ist implementiert.**
Keine Migration, keine Tabelle, keine Rolle, kein Checkout. Dieser Eintrag hält Entscheidungen
fest, damit ein späterer Shop korrekt auf dem bestehenden Tracker aufsetzt.

**Problem.** SkyIsles soll später zusätzlich ein **First-Party-Shop** des Betreibers werden.
Ohne festgehaltene Grenze wäre der naheliegende Fehler, den Shop in die vorhandenen Tabellen
hineinzubauen: Lagerbestand in `collection_items`, Verkaufspreis in `skylanders.market_price`,
Berechtigung an einer E-Mail-Adresse. Jede dieser Abkürzungen wäre später nur noch mit einer
Datenmigration zu korrigieren.

### Die Grenze

Es gibt **zwei fachliche Domänen über demselben kanonischen Katalog**:

| | Collector-Domain (existiert) | Shop-Domain (später) |
|---|---|---|
| Frage | „Was besitzt **dieser Nutzer**?" | „Was hat **das Geschäft** auf Lager?" |
| Träger | `collection_items` | eigene Struktur, z. B. `shop_inventory` |
| Eigentümer der Zeile | ein Benutzerkonto | der Betreiber |
| Sichtbarkeit | privat, nur der Eigentümer (ADR-0016) | öffentlich lesbar |
| Preisgröße | keine — Wert wird aus `market_price` berechnet | eigener Verkaufspreis |
| Schreibrecht | der Benutzer selbst | ausschließlich Shop-Admin |

**Verbindlich:** `collection_items` beschreibt ausschließlich persönliche Sammlungen.
**Shopbestand wird dort niemals gespeichert** — auch nicht „vorübergehend", auch nicht über
eine Zusatzspalte, auch nicht über einen technischen Betreiber-Account.

**Beide Domänen referenzieren dieselbe `sky_id`.** Keine zweite Produktdatenbank für dieselben
Figuren. Eine SKY-ID kann gleichzeitig im öffentlichen Katalog stehen, in der Sammlung des
Betreibers liegen, in den Sammlungen beliebig vieler anderer Nutzer liegen und im Shop auf
Lager sein. **Diese vier Zustände sind vollständig unabhängig voneinander** und dürfen sich
gegenseitig nicht implizieren.

### Zwei Nutzungskontexte, ein Kontomodell

Der private Account des Betreibers ist ein **normaler Collector-Account** und bleibt es.
Der **Geschäftsaccount** ist ebenfalls ein ganz normaler Supabase-Auth-User und soll später
**zusätzlich** Shop-Admin-Rechte tragen: Lagerbestand, Verkaufspreise, Verfügbarkeit schalten,
später Bestellungen, ggf. Referenz-Marktpreise.

**Die E-Mail-Adresse ist niemals die Autorisierungsregel.** Sie identifiziert nur das Konto;
autorisiert wird ausschließlich über die stabile `user_id` und `shop_admins` (ADR-0037).
Eine hart codierte Adresse — im Client, im Server-Code, in einer Policy oder in einer
Umgebungsvariable — ist als Berechtigungsprüfung **ausgeschlossen**: sie ist änderbar, sie
stünde in Klartext im Repository, und sie erzwingt ein Deployment, sobald sich etwas ändert.
Die konkrete Adresse wird deshalb hier nicht festgehalten — sie ist später lediglich **Eingabe**
für das kontrollierte Rollenvergabewerkzeug, das daraus den bestehenden Auth-User auflöst.

Stattdessen braucht es später eine **echte, serverseitig geprüfte Rolle** (z. B. `shop_admin`).
Anforderungen an sie:

1. **Serverseitig durchgesetzt, nicht im UI.** Ein ausgeblendeter Button ist keine Berechtigung.
   Die Grenze ist RLS plus geprüfte Server Actions — dieselbe Regel wie überall sonst.
2. **Nicht vom Benutzer schreibbar.** Das ist keine Theorie: `profiles` trägt heute
   `grant select, insert, update … to authenticated` zusammen mit `profiles_update_own`.
   **Eine Rollenspalte auf `profiles` könnte sich jeder Benutzer selbst setzen.** Die Rolle
   gehört deshalb in eine Struktur, auf die `authenticated` **kein** `INSERT`/`UPDATE` hat, und
   wird ausschließlich über `service_role` oder eine `security definer`-Funktion vergeben.
3. **Ohne Rolle keine Wirkung.** Normale Benutzer können Shop-Admin-Aktionen nicht ausführen —
   nicht nur nicht sehen.
4. **Prüfung serverseitig, nie aus einem Client-Claim.** Die Identität kommt wie überall aus
   `getUser()`, nie aus etwas, das der Browser mitschickt.

### Was das für heute bedeutet

- **ADR-0021 bleibt unverändert.** Ein First-Party-Shop ist kein Marketplace: ein Verkäufer,
  eigener Geschäftsbestand, keine Verkäuferprofile, kein Matching, keine Bewertungen, keine
  Streitfälle. Der Marketplace-Stopp — auch konzeptionell, auch „nur das Datenmodell" — gilt
  unverändert weiter und wird durch diesen Eintrag nicht gelockert.
- **ADR-0008 bleibt unverändert.** `available`, `ebay` und der Ankauffaktor werden weiterhin
  nicht importiert. Ein späterer Shop-Import ist eine **neue, ausdrücklich freizugebende**
  Entscheidung, keine Rücknahme von ADR-0008.
- **Die Priorität bleibt vollständig beim kostenlosen Collection Tracker.**

**Verworfen:** Shopbestand als Zeile in `collection_items` eines Betreiber-Accounts (vermischt
zwei Bedeutungen in einer Tabelle und macht jede Sammlungsstatistik falsch) · Wiederbelebung
von `skylanders.available` (ADR-0008, und der Katalog ist benutzerseitig nicht schreibbar) ·
Autorisierung über eine E-Mail-Konstante · zweite Produkttabelle für dieselben Figuren
(zwei Wahrheiten über denselben Skylander).

---

## ADR-0033 — Fünf Preisebenen; die Bestellung speichert einen Snapshot

**Status:** Fachliche Richtung ANGENOMMEN (2026-09-04) · **Nichts davon ist implementiert.**
Schwellen, Prozentsätze und Kombinierbarkeit sind **ausdrücklich noch offen**.

**Problem.** „Der Preis" ist im Shopkontext fünf verschiedene Dinge. Werden sie in einem Feld
zusammengefasst, überschreibt ein Preisupdate stillschweigend eine bewusste Geschäftsentscheidung
— und eine Bestellung von gestern ändert rückwirkend ihren Betrag.

### Die fünf Ebenen

| # | Ebene | Wer setzt sie | Wo sie später lebt |
|---|---|---|---|
| 1 | **Referenz-Marktwert** | Preisquelle / Betreiber | `skylanders.market_price` (existiert, ADR-0010) |
| 2 | **Shop-Basispreis** | Shop-Admin, manuell | z. B. `shop_inventory.sale_price` |
| 3 | **automatischer Lager-Rabatt** | Regel, aus dem Bestand abgeleitet | konfigurierbare Rabattregel |
| 4 | **Coupon / Rabattcode** | Betreiber, kundenseitig eingelöst | eigene Coupon-Struktur |
| 5 | **finaler Bestellpreis** | ergibt sich, wird **festgeschrieben** | Bestellposition |

**Marktpreis und Shoppreis sind verschiedene fachliche Größen.** `market_price` bleibt der
SkyIsles-Referenzmarktwert und der Wert, aus dem Sammlungswerte berechnet werden.

**Ein Marktpreis-Update darf einen bewusst gesetzten Shoppreis niemals still überschreiben.**
Der Marktpreis darf als Orientierung oder als **Vorschlag** beim erstmaligen Anlegen dienen —
danach ist der Shoppreis eigenständig.

**Ein Rabatt verändert den Referenz-Marktpreis nicht.** Rabatte rechnen auf Ebene 2, nie auf
Ebene 1. Sonst würde ein Shopangebot die Sammlungswerte aller anderen Nutzer verschieben.

### Lagerbasierte Rabatte — geplante Idee, keine feste Regel

Bei hohem Lagerbestand soll SkyIsles automatisch einen Rabatt anzeigen können. **Beispielidee,
noch nicht entschieden:**

| Bestand | Rabatt |
|---|---|
| > 5 | 5 % |
| > 10 | 10 % |
| > 15 | 15 % |

**Diese Schwellen sind ausdrücklich keine endgültige Geschäftsregel.** Die Architektur muss
später erlauben, Schwellen und Prozentsätze zu ändern, **ohne Produktcode an vielen Stellen
umzubauen**: die Regel gehört an **eine** Stelle (Konfiguration oder Regeltabelle plus eine
Rechenfunktion), nicht verteilt in Komponenten.

**Zu beachten, wenn es so weit ist:** Eine sichtbare Rabattstufe verrät grobe Lagerbestände.
Für einen eigenen Shop ist das eine legitime Betreiberentscheidung — aber eine **bewusste**.
Die genaue Stückzahl bleibt davon unberührt und gehört nicht ins öffentliche Lesefenster
(siehe `docs/SECURITY.md`, Abschnitt 2).

### Bestellungen sind unveränderlich

Bei einer Bestellung muss **nachvollziehbar festgehalten** werden, welcher Preis und welche
Rabatte **zum Kaufzeitpunkt** galten. Bestellpositionen speichern deshalb einen
**Preis-Snapshot**, keinen Verweis auf den heutigen Preis.

> **Eine historische Bestellung darf sich nicht ändern, nur weil später der Marktpreis, der
> Shoppreis oder eine Rabattregel geändert wird.**

Das ist keine Bequemlichkeit, sondern Buchhaltung: Der Betrag, den ein Kunde bezahlt hat, ist
ein Fakt und kein berechneter Wert.

**Verworfen:** ein einziges Preisfeld für Markt- und Shoppreis · Rabatt durch Herabsetzen von
`market_price` · Bestellpositionen, die den Preis zur Anzeigezeit neu berechnen.

---

## ADR-0034 — Charakteridentität ≠ Sammelobjektidentität ≠ Anzeigevariante

**Status:** ANGENOMMEN (2026-09-04) · umgesetzt als Pilot mit 19 Charakteren

**Problem.** Der Katalog kennt bisher genau eine Identität: die SKY-ID des Sammelobjekts.
Damit lässt sich nicht ausdrücken, dass SKY-0028, SKY-0156 und SKY-0157 **dieselbe Figur**
meinen — Drobot, dreimal aufgelegt, zu Preisen zwischen 1,49 € und 104,71 €. Detailseiten
können deshalb weder Charakterdaten zeigen noch auf andere Figuren desselben Charakters
verweisen.

### Drei Identitäten, drei Zuständigkeiten

| Konzept | Träger | Beantwortet | Wer hängt daran |
|---|---|---|---|
| **Sammelobjekt** | `sky_id` | „Welches physische Objekt?" | Sammlung, Shop, Preis, Bild, Slug |
| **Charakter** | `character_id` | „Welche Figur der Marke?" | Element, Spezies, Rolle, Beschreibung |
| **Anzeigevariante** | abgeleitet, nichts gespeichert | „Wie schreiben wir den Namen?" | nur die Darstellung (ADR-0030) |

**Diese drei fallen nicht zusammen, und die Umsetzung darf sie nie zusammenlegen.**

- `collection_items` und späterer Shopbestand hängen **weiterhin ausschließlich an der SKY-ID**
  (ADR-0005, ADR-0032). Der Fortschritt zählt Sammelobjekte, nicht Charaktere.
- ADR-0030 bleibt **reine Darstellung**. `Dark Barrel Blaster` ist eine korrekt erkannte
  Anzeigevariante **eines Fahrzeugs** — dort gibt es überhaupt keinen Charakter.
- Umgekehrt ist `Fire Bone Hot Dog` **keine** Anzeigevariante — „Fire Bone" ist kein
  Varianten-Token, und das ist richtig so — gehört aber zum Charakter Hot Dog.
- **`character_id = NULL` ist der Normalfall**, nicht fehlende Daten: 159 der 561 Sammelobjekte
  sind gar keine Charaktere (Traps, Fahrzeuge, Kreationskristalle, Magic Items, Locations,
  Trophies), und von den übrigen ist erst ein kurierter Teil zugeordnet.

### Zuordnungen werden kuratiert, nicht geraten

**Keine Namensregel löst das.** An den echten 561 Einträgen gemessen scheitert jede:

| Fall | Beispiel | Warum die Regel scheitert |
|---|---|---|
| Charakter steht vorn | `Drobot Light Core` | Suffix-Regel greift strukturell nicht |
| Drei LightCore-Schreibweisen | `Chill Light Core` · `Grim Creeper - Lightcore` · `Start Strike (LC, Enchanted)` | eine Regel deckt nicht alle drei |
| Zustand im Namen | `Elite Boomer - ohne OVP`, `Kaos in OVP` | das Suffix ist „OVP" |
| Abkürzung | `Dark Turbo Charge D.K.` | keine Zeichenüberlappung mit `Turbo Charge Donkey Kong` |
| Tippfehler in der Quelle | `Legendary Grim Creemper` · `Horn Blast Whirwind` · `Start Strike` | exakter Vergleich scheitert |
| Interpunktion | `Dino-Rang` vs. `Elite Dino Rang` | Bindestrich mal ja, mal nein |
| Präfix zerreißt den Charakter | `Mini Jini` vs. `Sidekick Mini Jini` | Strippen ergibt „Jini" und „Mini Jini" |
| Gleicher Name, anderes Objekt | `Kaos` als Trap, als Trophy **und** als Sensei | Namensgleichheit beweist nichts |
| Substring trifft daneben | `Bone Bash Roller Brawl` enthält „Bash" | gehört zu Roller Brawl, nicht zu Bash |
| Ähnlicher Name, anderer Charakter | `Mini Drobit` | Drobit ist Drobots Mini — ein **eigener** Charakter |

Deshalb: **kuratierte Datei, geprüftes Werkzeug, keine Laufzeitheuristik.**
`data/characters/characters.json` → `tools/import-characters.mts` → Datenbank.

### Warum das Modell so klein ist

**`element` liegt am Charakter (Modell A).** Alle Drobot-Figuren sind Tech; das dreimal zu
speichern wäre dreimal die Chance, dass es auseinanderläuft. Ein späteres
`skylanders.element` für Traps und Kristalle ist die logische Ergänzung — und beide Spalten
treffen sich nie auf derselben Zeile, weil ein Objekt mit Charakter kein Trap ist. Genau das
macht eine generische EAV-Struktur überflüssig.

**`gender` gibt es nicht.** Es testet nichts am Modell und ist selten sicher belegbar. Eine
nullbare Spalte später zu ergänzen kostet nichts.

**`debut` wird nicht gespeichert, sondern abgeleitet** — und zwar bewusst mit einer anderen
Bedeutung, als der Name „Debüt" nahelegt:

> `firstReleaseSeries()` beantwortet **„welche Serie brachte die erste Figur dieses
> Charakters"**, nicht „wann trat der Charakter zuerst auf".

Für 18 der 19 Pilotcharaktere fällt beides zusammen. **Kaos ist der Gegenbeleg:** Er ist seit
Spyro's Adventure (2011) der Bösewicht der Reihe, seine erste **Figur** ist aber der
Imaginators-Sensei. Statt daraus eine Spalte oder eine Ausnahmeliste zu machen, heißt das Feld
in der Oberfläche **„Erste Figur"** — eine Aussage, die für alle 19 wahr ist. Eine
`debut`-Spalte käme erst, wenn die Story-Bedeutung wirklich gebraucht wird, und dann als
bewusste Entscheidung.

**`NULL` heißt „nicht zuverlässig bekannt", nie „keins"** — dieselbe Regel wie beim Marktpreis
(ADR-0010). Kaos' Element ist der Musterfall: Als Sensei gehört er einem eigenen
**Kaos-Element** an, das nicht zu den zehn regulären zählt. Geraten wird nicht.

**`short_description` ist auf 600 Zeichen begrenzt — als CHECK, nicht als Richtlinie.**
SkyIsles schreibt eigene Kurzfassungen; ein eingefügter Wiki-Artikel passt strukturell nicht
hinein. Externe Quellen dienen der **Faktenprüfung**, nicht als Textlieferant.

### Sicherheit

`characters` ist öffentlich lesbar und für **keine** Client-Rolle schreibbar: keine
schreibende Policy, kein Schreibrecht, explizite REVOKEs. Kuratiert wird ausschließlich lokal
über die Service Role.

**Es wird keine Rolle eingeführt und nichts an `profiles` ergänzt.** `profiles` ist vom
Benutzer selbst beschreibbar; eine Berechtigung dort könnte sich jeder selbst geben
(ADR-0032). Der Pflegeweg umgeht das Problem, statt es zu lösen — richtig, solange es genau
einen Kurator gibt.

### Konsequenzen

- Additiv: eine Tabelle, eine nullbare Spalte. Keine Zeile geändert, keine gelöscht.
- Der Katalogimport bleibt unverändert und schreibt `character_id` nie — sein Upsert benennt
  nur die Spalten der Legacy-Quelle. `src/lib/catalog/import-payload.test.ts` nagelt das fest.
- Die Suche bekommt den Charakternamen als **vierte** Schreibweise. „Hot Dog" findet damit auch
  `Fire Bone Hot Dog`. Nichts Unscharfes: „Drobot" erreicht `Mini Drobit` weiterhin nicht.
- Detailseiten zeigen den Charakterbereich nur, wenn es einen gibt.

**Verworfen:** Charakterdaten auf jeder SKY-ID duplizieren · Charakter aus dem Namen zur
Laufzeit ableiten · Charaktername als Schlüssel · generische Metadatenstruktur (EAV/JSON) ·
`characters` per Katalogimport pflegen · Admin-UI mit Rolle (setzt eine Rolle voraus, die es
nicht gibt) · gespeicherte `debut`-Spalte.

---

## ADR-0035 — Visuelle Richtung „Skylands Vitrine" und ein Token-System

**Status:** ANGENOMMEN (2026-09-04) · umgesetzt als Phase A (Tokens und Shell)

**Problem.** Die Oberfläche hatte vier Farbvariablen, keine Tokens für Radius, Schatten, Akzent
oder Flächen, und praktisch keine Focus-Zustände. Für einen Sammler-Tracker, der Figuren in den
Mittelpunkt stellen soll, ist das zu wenig Grundlage.

**Entscheidung.** Richtung **„Skylands Vitrine"**: eine ruhige, neutrale Collector-Oberfläche.
Die Figuren tragen die Farbe, das Interface hält sich zurück.

### Warum die Bildassets die Richtung bestimmen

Die 534 Katalogbilder sind 640×640-Produktfotos: **435 opak auf weißem Grund, 40 mit
Alphakanal.** Die Master-PNGs liegen im read-only Legacy-Projekt, und die Dateinamen sind die
Bildidentität (ADR-0009) — freistellen oder neu rendern ist hier nicht möglich.

Daraus folgt zwingend:

- **kein Elementfarbverlauf und keine dunkle Bühne hinter der Figur** — das Weiß deckt sie ab
- **`--plate`**: eine bewusst **helle** Präsentationsfläche in **beiden** Themes. Sie normalisiert
  außerdem den Unterschied zwischen den 435 weißen und den 40 transparenten Bildern, die sonst
  im Dark Mode völlig verschieden aussähen
- Das Weiß wird nicht bekämpft, sondern **gerahmt**: weiche Ecken, Haarlinie, sanfte Erhebung

### Das System

| Gruppe | Tokens |
|---|---|
| Flächen | `canvas` · `surface` · `surface-raised` · **`plate`** |
| Text | `foreground` · `muted` · `on-accent` |
| Linien | `border` · `border-strong` · `ring` |
| Akzent | `accent` · `accent-hover` · `accent-subtle` — warmer Bernstein, sparsam |
| Status | `success` · `danger` |
| Form | `radius-sm/md/lg` (6/10/14 px) · `shadow-card` · `shadow-raised` |
| Element | zehn Farben, **definiert und bewusst noch nirgends verwendet** |

**Light:** warmes Off-White als Canvas, keine reinen Extremwerte.
**Dark:** kühles Schiefer-Nachtblau statt Schwarz — neben einer hellen Platte erzeugt reines
Schwarz eine Blendkante und flacht jede Fläche darüber ab.

**Alle Werte sind auf Kontrast geprüft**; die Verhältnisse stehen als Kommentar an jedem Wert.
Elementfarben liegen bei ≥ 4,5:1 auf `surface`, damit sie später Text tragen können.

### Verbindliche Regeln

1. **Elementfarben werden ausschließlich aus kuratiertem `characters.element` gespeist**
   (ADR-0034). Keine Ableitung aus Namen, keine Heuristik, kein Fallback.
2. **Farbe allein kommuniziert nie ein Element.** `earth` und `tech` liegen 1,06:1 in der
   Helligkeit auseinander und unterscheiden sich nur im Farbton — ein Badge muss das Element
   immer benennen.
3. **Die neutrale Karte ist der Standard.** 457 der 561 Sammelobjekte haben keinen Charakter;
   ohne Element gibt es keinen leeren Platzhalter, die Karte ist schlicht ruhiger.
4. **Ein Focus-Stil für alles:** `:focus-visible` mit Outline und Offset — ein Element, das
   erscheint, statt einer Farbe, die sich ändert.
5. **Keine dekorativen Animationen**, und `prefers-reduced-motion` schaltet global ab.
6. **Keine externe Schrift, keine Component Library.** Systemschrift und Tailwind genügen.
7. **Kein Theme-Umschalter.** `prefers-color-scheme` bleibt die Quelle.

**Verworfen:** Elementrahmen um die ganze Karte (10 Farben × 561 Karten = Flickenteppich) ·
Glow (teuer, wirkt nach Gaming, müsste bei reduzierter Bewegung weg) · Hintergrundgradient und
Bildbühne (technisch unmöglich, siehe oben) · Trading-Card-Look · reines Schwarz/Weiß als
Grundflächen.

### Nachtrag (Phase E): wie das Element tatsächlich erscheint

Zwei zurückhaltende Elemente, beide aus **einer** Tabelle in `src/lib/catalog/element.ts`:

| Ort | Darstellung |
|---|---|
| Figure Card | 2 px Akzentkappe an der **Kartenoberkante** · kleiner benannter Badge rechts neben dem Marktwert |
| CharacterPanel | derselbe Badge in der Zeile „Element" |

**Warum die Kappe an der Karte sitzt und nicht auf der Bildplatte:** Die Platte ist in beiden
Themes hell, die Elementtokens folgen dem Theme. Auf der Platte wäre die helle Dark-Variante
unlesbar. Auf `surface` stimmt der Kontrast in beiden Themes (≥ 4,5:1).

**Verbindlich:**

- **Quelle ist ausschließlich `characters.element`** über `character_id`. Keine Ableitung aus
  Name, Kategorie, Serie oder Variante, kein Fallback, keine Default-Farbe.
- **Der Badge trägt immer den Elementnamen**, nie nur einen Farbpunkt. `Tech`, `Earth` und
  `Light` liegen im hellen Theme dicht beieinander — der Text löst das auf, die Farbe allein
  könnte es nicht.
- **Neutral ist der Standard, nicht der Mangel.** 459 der 561 Sammelobjekte tragen kein
  Element; ohne Element gibt es weder Kappe noch Platzhalter, und die Karte ändert ihre Höhe
  nicht.
- **Elementfarben gelten nur für Elementsemantik.** Serienchips bleiben neutral; aus
  Elementfarben werden keine Serien- oder Statusfarben abgeleitet.
- Der Sammelstatus liegt oben rechts **auf der Platte**, das Element in der Metazeile
  **darunter** — räumlich getrennt, damit keine Badge-Wolke entsteht.

### Nachtrag (Phase F): keine Serienfarben

Serienfarben waren erlaubt und wurden **nicht** eingeführt. Die Serienleiste sitzt unmittelbar
über dem Kartenraster, und die Karten tragen bereits zehn Elementfarben. Ein zweites
Farbsystem in Sichtweite hätte genau die Verwechslung erzeugt, die diese ADR ausschließen
will — „Orange heißt Fire und gleichzeitig Giants". Die aktive Serie wird deshalb wie jeder
andere aktive Zustand markiert, und die Serienidentität trägt der Kurzcode plus der
ausgeschriebene Name in der Kontextzeile. `src/lib/catalog/series-nav.ts` enthält bewusst
keine Farbe; ein Test hält das fest.

---

## ADR-0036 — Die Hauptnavigation hat drei Ziele: Katalog · Sammlung · Profil

**Status:** ANGENOMMEN (2026-09-04) · umgesetzt als Phase D des Visual Pass

**Problem.** Die mobile Leiste trug vier Einträge, einer davon **Abmelden**. Damit konkurrierte
eine Sitzungsaktion mit den drei eigentlichen Produktbereichen um den Daumenplatz — und der
gefährlichste Eintrag lag direkt neben dem meistgenutzten. Zusätzlich reichten beide Layouts
`active` fest verdrahtet durch: Der geschützte Bereich übergab `null`, wodurch auf
`/collection` und `/settings` **nie** etwas hervorgehoben wurde.

**Entscheidung.**

1. **Drei Ziele, mehr nicht.** `Katalog` · `Sammlung` · `Profil` (abgemeldet: `Anmelden`).
   Der Shop bekommt später **kein** viertes Dauerelement ohne neue Entscheidung.
2. **Abmelden ist kein Navigationsziel** und liegt in `/settings`, sekundär, im Abschnitt
   „Sitzung". Derselbe POST-Flow wie zuvor. Kein Danger-Look — es wird nichts gelöscht.
3. **Die aktive Route kommt aus dem Pfad**, über eine reine Funktion
   (`src/lib/nav/sections.ts`), nicht aus einem Prop je Layout. Eine Detailseite gehört zum
   Katalog, Onboarding zum Profil, `/dashboard` zur Sammlung.
4. **Die aktive Route wird nie allein über Farbe gezeigt**: Schriftgewicht plus ein
   Akzentbalken — über dem Label in der Bodenleiste, darunter in der Kopfzeile — plus
   `aria-current="page"`.
5. **Die Wortmarke steht auch mobil.** Wer über einen QR-Code aus einem eBay-Paket kommt, muss
   sofort sehen, wo er gelandet ist. Reine Typografie mit einem kleinen Akzentpunkt: kein
   Bildasset, keine zusätzliche Schrift, kein Verlauf, kein Glow.
6. **Ein Markup für beide Layouts.** Die Bodenleiste ist auf dem Telefon `fixed` und fällt
   damit aus dem Fluss, sodass die Kopfzeile darüber nur die Wortmarke zeigt; ab `md:` wird
   dieselbe Leiste statisch und rückt in die Kopfzeile. Keine zwei Navigationssysteme, keine
   doppelten Links im DOM.

**Konsequenzen.** `NavSpacer` und die Leiste rechnen beide mit
`env(safe-area-inset-bottom)`, damit der Home-Indicator nichts verdeckt. Auth-Seiten
übernehmen dieselbe Wortmarke und dieselbe Trennlinie, bleiben aber ohne Navigation — ein
halb ausgefülltes Registrierungsformular ist nicht der Moment, andere Wege anzubieten.

**Verworfen:** Abmelden als Icon in der Leiste (dasselbe Problem, kleinere Trefferfläche) ·
Hamburger-Menü (verbirgt drei Ziele hinter einer Geste) · eine eigene Profilseite neben
`/settings` (der Account-Bereich existiert bereits) · Icon-Bibliothek für die Navigation
(Textlabels sind kürzer als jedes Icon-Set und lesen sich auf Deutsch eindeutig).

---

## ADR-0037 — Shop-Fundament: Rolle, Bestand, Bewegungen, Sichtbarkeit

**Status:** ANGENOMMEN und **umgesetzt in `0003_shop_foundation.sql`** (2026-09-05).
Das Fundament steht; Bestellungen, öffentliche Shopanzeige, Reservierungs-API, `/shop-admin`,
Rollenvergabewerkzeug und Legacy-Import folgen als eigene Schritte.
Keine Migration, keine Tabelle, keine Policy, keine UI. Dieser Eintrag legt fest, wie das
Shop-Fundament aussehen wird, damit die erste Migration keine Entscheidung mehr improvisieren
muss. Er baut auf ADR-0032 (Domänentrennung) und ADR-0033 (Preisebenen) auf.

### 1. Die Berechtigung liegt außerhalb von `profiles`

**Befund, an der laufenden Datenbank geprüft.** `profiles` trägt
`grant select, insert, update … to authenticated` — **tabellenweit, ohne Spaltenbeschränkung** —
zusammen mit `profiles_update_own` (`using`/`with check` auf `auth.uid() = id`). Eine Spalte
`profiles.role` könnte damit **jeder Nutzer bei sich selbst setzen**, mit einem einzigen
PostgREST-Aufruf. Das ist kein theoretisches Risiko, sondern die heutige Rechtelage.

**Entscheidung.** Die Shop-Berechtigung lebt in einer eigenen Struktur, auf die `authenticated`
**kein einziges Recht** hat — kein `SELECT`, kein `INSERT`, kein `UPDATE`, kein `DELETE`:

```
shop_admins (user_id pk → auth.users, granted_at, note)
```

Die Anwendung fragt nie die Tabelle ab, sondern eine `security definer`-Funktion:

```
public.is_shop_admin() returns boolean   -- prüft auth.uid(), stable, security definer
```

Nur diese Funktion bekommt `execute` für `authenticated`. Sie ist zugleich das Prädikat jeder
späteren Shop-Policy. Damit gibt es genau **eine** Stelle, an der „darf Shop verwalten"
definiert ist. Ein reiner Client-Check ist niemals die Autorisierung — er darf höchstens
entscheiden, ob ein Menüpunkt erscheint.

**Die Rolle wird über ein eigenes Werkzeug vergeben**, nach dem Muster von `catalog:import`
und `characters:import`: Standard **Dry-Run**, Schreiben nur mit explizitem `--apply`. Es löst
den angegebenen Auth-User eindeutig auf, zeigt die betroffene `user_id`, prüft ob die Rolle
schon existiert, ist idempotent und **enthält keine E-Mail-Adresse im Quelltext** — die
Adresse ist Eingabe, nicht Konstante. Noch nicht implementiert.

Die **konkrete Geschäfts-E-Mail steht bewusst in keinem Dokument dieses Repositories.** Sie
wird erst beim tatsächlichen Rollen-Setup als Eingabe verwendet; personenbezogene Daten ohne
Zweck zu dokumentieren wäre gegen `docs/SECURITY.md`.

**Verworfen:** `profiles.role` (siehe Befund) · Spaltenrechte auf `profiles` (fragil, eine
weitere Spalte später hebt sie wieder aus den Angeln) · JWT-Claim (steht im Token, das der
Client hält, und wird bei Entzug erst mit dem nächsten Refresh wirksam) · eine E-Mail-Konstante
(ADR-0032 schließt sie aus).

### 2. Der Shop gehört SkyIsles, nicht dem Business-Account

`shop_inventory` trägt **keine** `user_id`. Der Bestand gehört dem Shop, der Business-Account
darf ihn nur verwalten. Damit ist strukturell ausgeschlossen, dass Geschäftsbestand je in einer
persönlichen Sammlung landet — `collection_items` bleibt unberührt privat.

Der private Account des Betreibers bleibt ein ganz normaler Collector-Account **ohne jede
Sonderbehandlung**.

### 3. Drei Sichtbarkeiten

| Frage | Träger in V1 |
|---|---|
| Gehört das Objekt in den Sammlerkatalog? | `is_active` + Kategorieregel (ADR-0029) — **unverändert** |
| Führt der Shop es grundsätzlich? | `shop_inventory.is_listed` |
| Ist es gerade da? | `quantity - reserved > 0` |

Warum in V1 keine vierte, kuratierte Spalte dazukommt, steht in Abschnitt 6.

### 4. Bestand: gespeicherte Menge **und** Bewegungsjournal

```
shop_inventory        (id, sky_id, condition, quantity, reserved, sale_price,
                       is_listed, note, created_at, updated_at)
inventory_movements   (id, inventory_id, sky_id, delta, reason, order_id,
                       note, created_at, created_by)
```

**Entscheidung: beides, nicht eines von beidem.** `quantity` ist die maßgebliche, transaktional
fortgeschriebene Zahl; `inventory_movements` ist ein reines Anhängejournal, das in derselben
Transaktion mitschreibt.

Begründung: Der Schutz vor Doppelverkauf ist ein atomares bedingtes Update —

```sql
update shop_inventory set quantity = quantity - :n
 where id = :id and quantity - reserved >= :n
returning id;
```

Kommen null Zeilen zurück, war es ausverkauft. Gegen ein `SUM(movements)` lässt sich das nicht
gleich sicher und nicht annähernd gleich schnell formulieren, und `check (quantity >= 0)` gäbe
es dort gar nicht. Ein reines Ledger wäre auditierbarer, aber jede Bestandsabfrage — Katalog,
Detailseite, „Fehlend & verfügbar" — würde zur Aggregation über eine wachsende Tabelle.

Die Konsistenz beider Seiten ist prüfbar: `SUM(delta)` je Position muss `quantity` ergeben. Das
gehört als wiederkehrende Prüfung in `verify:rls` oder ein eigenes Werkzeug, nicht in einen
Trigger — ein Trigger würde denselben Fehler doppelt schreiben.

**`reason`** unterscheidet mindestens: `purchase` (Wareneingang) · `sale_skyisles` ·
`sale_external` (eBay und andere Kanäle) · `return` · `correction` · `writeoff`. Ein
eBay-Verkauf ist damit **eine Bewegung wie jede andere** — heute von Hand erfasst, später
möglicherweise über eine Integration erzeugt. Die Architektur braucht dafür keine Änderung.

### 5. Zustand: genau zwei Werte, `loose` und `boxed`

**Befund aus der Legacy-Analyse (read-only, 2026-09-05).** 46 der 561 Katalogzeilen sind
16 Gruppen derselben physischen Figur:

- 14 × `Elite X` / `Elite X - ohne OVP` / `Elite X (2)`
- `Kaos` / `Kaos in OVP` · `Dark Pyramid` / `Dark Pyramid - OVP`

Die Preisunterschiede sind erheblich — `Elite Boomer` 69,99 € gegen `Elite Boomer - ohne OVP`
27,99 € — und beschreiben **dieselbe Figur in anderer Verpackung**.

**Diese Zeilen werden tatsächlich bewirtschaftet, wenn auch selten** (nachgezählt 2026-09-05):
Von den 32 Verpackungs- und Zweitexemplarzeilen wurden **drei je eingekauft** — alle drei
`- ohne OVP` — und **eine steht heute im Bestand** (`SKY-0049 Elite Slam Bam - ohne OVP`, D = 1).
Die 14 `(2)`-Zeilen wurden **nie** eingekauft und tragen **keinen** Bestand; `Kaos in OVP` und
`Dark Pyramid - OVP` ebenfalls nicht, wohl aber die zugehörigen Grundzeilen `Kaos` (D = 1) und
`Dark Pyramid` (D = 1).

Das ist genau der Grund für eine `condition`-Dimension statt zweiter SKY-IDs: Der Zustand ist
real bepreist **und** real bevorratet, aber er ist eine Eigenschaft des Bestands, nicht eine
zweite Sammleridentität.

**Entscheidung.** `shop_inventory` bekommt eine `condition`-Spalte, Eindeutigkeitsschlüssel
**`(sky_id, condition)`**. Für V1 kennt sie **genau zwei Werte**:

| Wert | Bedeutung |
|---|---|
| `loose` | normale lose Figur / loses Collectible **ohne** Verkaufsverpackung |
| `boxed` | OVP — dieselbe Figur **in** Verkaufsverpackung |

**Bewusst noch nicht eingeführt:** `sealed`, `new`, `used`, `complete`, `damaged`, `mint`,
`opened`, `incomplete` und jede weitere Zustandsstufe. Sie kommen erst, wenn eine echte
Produktanforderung sie verlangt — ein Wert, den niemand pflegt, macht jede Abfrage und jede
Admin-Oberfläche unnötig kompliziert.

Die Spalte kommt **von Anfang an** mit, obwohl V1 vielleicht nur `loose` benutzt: sie später in
einen Unique-Key aufzunehmen wäre eine Datenmigration auf laufendem Bestand. Der Schlüssel wird
also von der ersten Migration an mehrwertig geplant, auch wenn er anfangs einwertig belegt ist.

### 5a. OVP ist ein Bestandszustand, kein zweites Produkt

Verpackung erzeugt **keine** eigene Produktidentität. Beide Zustände zeigen auf dieselbe
kanonische SKY-ID:

```
Canonical Collectible:  Drobot   (eine SKY-ID)
Shopbestand:            Drobot · loose    10,80 €
                        Drobot · boxed    18,90 €
```

Keine Shop-eigenen SKY-IDs. Keine zweite Produktdatenbank. Keine separate Identität nur wegen
Verpackung. Damit ist der Shop von der Frage entkoppelt, ob der Sammlerkatalog dieselben
Varianten sauber führt.

### 5b. Der Sammlerkatalog wird dadurch **nicht** korrekt

Ausdrücklich festgehalten, damit es niemand später verwechselt:

> **Collector catalog normalization of packaging/duplicate legacy rows remains a separate
> future cleanup decision.**

`condition` im Shop löst das Katalogproblem **nicht**. Solange `Elite Boomer - ohne OVP`,
`Elite Boomer (2)`, `Kaos in OVP` und `Dark Pyramid - OVP` als eigene Zeilen im öffentlichen
Katalog stehen, gilt weiterhin:

- sie zählen zu den 561 Sammelobjekten
- sie beeinflussen die Completion-Quote
- sie können als eigene Sammlungseinträge existieren

**Jetzt wird nichts bereinigt.** Keine SKY-ID gelöscht, keine Completion-Zahl verändert, kein
Name geändert. Das ist kein Blocker für das Shop-Fundament, sondern ein eigener späterer
Schritt (§ 9).

### 5c. Was V1 nicht verkauft

**Die 8 internen SWAP-Force-Halbfiguren** — SKY-0204, SKY-0214, SKY-0216, SKY-0220, SKY-0224,
SKY-0229, SKY-0231, SKY-0238 — bleiben interne Legacy-/Bestandspositionen. Kein Shoplisting,
kein öffentliches Produkt, **kein neuer Katalogeintrag**. Ein späterer Verkauf wäre ein eigener
Produktentscheid.

**Die 8 Softwaretitel mit Bestand** werden ebenfalls nicht verkauft. Software bleibt gemäß
ADR-0029 außerhalb des Sammlerkatalogs; sie wird dafür nicht reaktiviert.

**Shop V1 verkauft ausschließlich reguläre, bereits öffentliche Sammelobjekte.**

### 6. Kein `catalog_visible` in der ersten Fassung

**`is_active` wird nicht umdefiniert.** Es bedeutet „die Zeile existiert in der Legacy-Quelle"
und wird vom Katalogimport bei **jedem Lauf** auf `true` gesetzt (`tools/import-catalog.mts`,
Payloadzeile `is_active: true`). Eine redaktionelle Entscheidung dort abzulegen wäre beim
nächsten Import weg. `is_active` bleibt **unverändert**.

**Ein neues `catalog_visible` kommt trotzdem nicht** — es hätte in V1 nichts zu tun:

- der Shop verkauft nur reguläre, ohnehin sichtbare Sammelobjekte (§ 5c)
- SWAP-Hälften und Software werden nicht öffentlich verkauft
- die Katalogbereinigung ist ein eigener späterer Schritt (§ 5b)

Eine Spalte ohne Aufgabe wäre eine Migration, ein Testeintrag und eine Erklärpflicht ohne
Gegenwert.

**Wenn kuratierte Sammler-Sichtbarkeit später gebraucht wird**, dann als **eigene,
importresistente kuratierte Spalte** — nach dem Muster von `character_id`: Der Import benennt
sie nicht, PostgREST fasst beim `ON CONFLICT DO UPDATE` nur benannte Spalten an, die Kuratierung
überlebt. `src/lib/catalog/import-payload.test.ts` nagelt die Spaltenliste bereits fest und
wäre dann zu ergänzen. **Niemals** durch Umdeutung von `is_active`.

### 7. Preis und Rabatt

`skylanders.market_price` bleibt der neutrale Referenzmarktwert (ADR-0010).
**`shop_inventory.sale_price` ist der manuell gepflegte Basisverkaufspreis** und von
`market_price` unabhängig. Ein Marktpreisupdate verändert bestehende Shoppreise **nicht**.

`market_price × 0,90` darf ein **Vorschlag** beim Anlegen oder Bearbeiten einer Position sein —
nie eine gespeicherte, dauerhafte Ableitung. Seltene Figuren gehen über Marktwert, hoher
Bestand darunter; eine feste Formel könnte beides nicht.

Die fünf Preisebenen (ADR-0033) bleiben unverändert:

```
1. market_price        neutraler Referenzwert, für alle Nutzer gleich
2. sale_price          manueller Shop-Basispreis          ← gespeichert
3. stock discount      abgeleitet, aus dem Bestand
4. coupon              optional, abgeleitet
5. final order price   Snapshot in order_items            ← gespeichert
```

Rabatte rechnen zur Anzeigezeit auf `sale_price` — **nie** auf `market_price`, sonst verschöbe
ein Shopangebot die Sammlungswerte aller anderen Nutzer.

**OPEN:** konkrete Bestandsrabatt-Schwellen · ob Coupon und Bestandsrabatt kombinierbar sind
und mit welchem Vorrang. Keine Regel wird jetzt implementiert.

### 8. Öffentliche Lageranzeige: Zustand, keine Stückzahl

Öffentlich erscheint **nie eine Stückzahl**. Nur zwei Zustände, abgeleitet aus der verfügbaren
Menge:

```
available_quantity = quantity - reserved

available_quantity >  0   →  „Auf Lager"
available_quantity <= 0   →  „Nicht auf Lager"
```

Kein „Noch 17 verfügbar" in V1. Die exakte Menge bleibt intern — sichtbar in `/shop-admin` und
in den Bewegungen, nirgends sonst. Damit verrät der Shop keine Lagergröße (vgl. ADR-0033: schon
eine sichtbare Rabattstufe tut das grob genug).

### 9. Reihenfolge der Umsetzung

**Schritt 1 — Shop Foundation.** `shop_admins`, `is_shop_admin()`, `shop_inventory`,
`inventory_movements`, Constraints, RLS, sichere Bestandsmutationen.

**Schritt 2 — Legacy Inventory Import.** Die echte Excel **read-only**, nur die
Geschäftsspalte F (Difference), SKY-ID-Mapping, Dry-Run als Standard, explizites `--apply`,
Anfangsbestand plus passende Initialbewegung.

**Schritt 3 — `/shop-admin`.** Erst danach UI.

**Begründung für genau diese Reihenfolge:** Der Adminbereich soll gegen das echte Datenmodell
und echten Bestand entwickelt werden, nicht gegen Fantasiedaten oder temporäre
Mock-Strukturen — sonst richtet sich die UI nach Annahmen, die die Daten nachher nicht erfüllen.

**Danach** — nicht Teil der Foundation: Shopanzeige im Katalog und auf der Detailseite ·
`/shop` als eigene Route · „Fehlend & verfügbar" · Bestellungen, Reservierung, Zahlung ·
**Collector Catalog Normalization** (§ 5b).

### 10. Nach dem Import führt die Datenbank

Nach erfolgreichem Initialimport ist **SkyIsles PostgreSQL die zentrale Geschäftsbestandsquelle**.
Die Excel wird **nicht** dauerhaft parallel gepflegt.

Ausdrücklich ausgeschlossen:

```
Excel   = Bestand A
eBay    = Bestand B
SkyIsles = Bestand C      ← genau das soll nie entstehen
```

Jede spätere Bestandsänderung — Wareneingang, SkyIsles-Verkauf, eBay-Verkauf, Rückgabe,
Korrektur, Abschreibung — verändert denselben zentralen Bestand.

### 11. `inventory_movements`: normalisiert, ohne redundante `sky_id`

**Geprüft, wie gefordert.** `inventory_id → shop_inventory → sky_id` ist eindeutig,
`shop_inventory` wird nie gelöscht (`on delete restrict` in beide Richtungen), und `sky_id` ist
Teil des Eindeutigkeitsschlüssels der Bestandszeile.

**Empfehlung: `sky_id` **nicht** doppelt speichern.** Ein Audit-Grund läge nur vor, wenn eine
Bestandszeile ihre `sky_id` ändern könnte — dann wäre die Historie ohne Snapshot falsch. Genau
das darf sie aber nicht: **`shop_inventory.sky_id` und `condition` sind unveränderlich.** Sie
sind die Identität der Position; eine Umwidmung wäre keine Änderung, sondern eine neue Position
plus Ausbuchung der alten. Damit entfällt der einzige Grund für die Denormalisierung, und die
Auswertung „alle Bewegungen zu SKY-0123" ist ein Join über eine kleine Tabelle in einer
Admin-Ansicht.

Die Unveränderlichkeit ist eine **Regel des Datenmodells**, keine Konvention der Oberfläche —
sie gehört später abgesichert (Trigger oder Policy), nicht bloß im Admin-Formular weggelassen.

Felder: `id`, `inventory_id`, `delta`, `reason`, `unit_cost`, `currency`, `note`, `created_at`,
`created_by`. `order_id` kommt mit der Bestellmigration — `orders` existiert noch nicht.

**Sieben Reason-Werte:** `purchase` · `sale_skyisles` · `sale_external` · `return` ·
`correction` · `writeoff` · **`initial_import`**.

**`initial_import` ist der Eröffnungsbestand**, nicht ein Einkauf. `purchase` würde eine
Anschaffung behaupten, für die es keinen Beleg gibt, und jede spätere Kostenauswertung müsste
218 Positionen als „Einkauf mit unbekanntem Preis" führen — genau die Daten verwässern, für die
`unit_cost` existiert. Regeln: nur positives `delta` · `unit_cost` und `currency` **müssen**
NULL sein · **höchstens einmal je Position**, erzwungen durch einen partiellen Unique-Index.
Dieser Index ist die Idempotenz des Imports: Ein zweiter Lauf scheitert an der Datenbank statt
den Bestand zu verdoppeln. Eine `initial_import`-Zeile darf **nie** nachträglich als `purchase`
gelesen werden.

**Unveränderliche Audit-Historie.** `DELETE` ist ausnahmslos verboten, für jede Rolle, auch
für die Service Role, die RLS umgeht, Trigger aber nicht. Der Fremdschlüssel auf
`shop_inventory` ist `on delete restrict`: Auch der Umweg über das Löschen der ganzen Position
führt nicht an der Historie vorbei. Korrigiert wird ausschließlich durch Gegenbewegungen.

**Eine erlaubte Änderung: `created_by` → NULL bei Kontolöschung.** Nachträglich ergänzt
(2026-09-05), nachdem die funktionale Verifikation den Widerspruch zeigte: `on delete set null`
wird von PostgreSQL als `UPDATE` ausgeführt und lief in genau dieses Verbot — jedes Konto mit
Buchungshistorie wäre damit **dauerhaft unlöschbar** gewesen, entgegen der Kontolöschung in
`docs/AUTH.md` und entgegen der Absicht der FK selbst. Der Trigger lässt jetzt exakt diesen
Übergang durch: `old.created_by` gesetzt, `new.created_by` NULL, alle Sachspalten per
`is not distinct from` identisch. Das ist keine Aufweichung, sondern die Vervollständigung —
die Bewegung selbst bleibt unantastbar, es entfällt nur der Personenbezug.

Die Grenze ist die erlaubte **Datenmutation**, nicht der Aufrufer. Ob PostgreSQL das `UPDATE`
selbst ausgelöst hat, ist nicht zuverlässig feststellbar; danach zu raten wäre schwächer.
Tragfähig ist die Prüfung, weil weder Clients noch Shop-Admins Tabellenrechte haben — nur der
vertrauenswürdige Serverkontext könnte sie überhaupt auslösen, und selbst er kann dabei kein
Sachfeld verändern.

**Verworfen:** eine Ausnahme für kaskadierte Löschungen, die das Aufräumen einer versehentlich
angelegten Position oder eines Test-Fixtures erlaubt hätte. Bequemlichkeit beim Aufräumen ist
kein hinreichender Grund, die zentrale Audit-Invariante zu lockern — eine Historie, die sich
entfernen lässt, belegt nichts. Eine überflüssige Position bleibt stattdessen wirkungslos
stehen (`is_listed = false`, `quantity = 0`), und die funktionale Verifikation arbeitet mit
einem dauerhaften, inaktiven Fixture statt mit Wegwerfdaten.

### 12. Bestand: gespeicherte Menge **und** Journal

`shop_inventory.quantity` wird gespeichert; `inventory_movements` ist das Audit-Journal
daneben. **Weder** ausschließlich `SUM(movements)` **noch** `quantity` ohne Historie.

Ziel: aktueller Bestand schnell und transaktionssicher lesbar **und** jede relevante Änderung
nachvollziehbar.

Begründung für die gespeicherte Menge: Der Schutz vor Doppelverkauf ist ein atomares bedingtes
Update. Gegen ein Aggregat lässt sich das nicht gleich sicher formulieren, `check (quantity >= 0)`
gäbe es dort gar nicht, und jede Katalog- und Sammlungsabfrage würde über eine wachsende
Tabelle aggregieren.

Konsistenz ist prüfbar: `SUM(delta)` je Position muss `quantity` ergeben — als wiederkehrende
Prüfung, **nicht als Trigger** (der würde denselben Fehler doppelt schreiben).

### 13. eBay in V1: eine Bewegung von Hand

Ein eBay-Verkauf wird zunächst manuell erfasst:

```
delta  = -1
reason = 'sale_external'
```

Optional **später**, nicht jetzt: `channel` (z. B. `ebay`) und `external_reference`. Das
Datenmodell muss diese Ergänzung vertragen, ohne dass sich die Inventararchitektur ändert —
zwei zusätzliche nullable Spalten an einem Anhangsjournal sind genau das. **Keine eBay-API,
keine Automatisierung in V1.**

### 14. Shopbestand ist nicht `collection_items` — noch einmal ausdrücklich

| | |
|---|---|
| Geschäftsbestand | `shop_inventory` |
| Private Sammlung | `collection_items` |

**Keine Synchronisierung zwischen beiden. Keine Business-Collection.** Und keine
Shop-Semantik auf der privaten Menge: Ein Nutzer mit `quantity = 4` besitzt privat vier
Exemplare. Das heißt **nicht**, dass drei zum Verkauf stehen (ADR-0032).

### 15. Öffentliche Darstellung im Katalog

`/` bleibt primär Sammlerkatalog. Wo ein Shopangebot existiert, kann dieselbe Karte zusätzlich
Marktwert, SkyIsles-Preis und Verfügbarkeit zeigen:

| Lage | Anzeige |
|---|---|
| kein Shopangebot | nur `Marktwert 12,00 €` |
| gelistet, verfügbar | `Marktwert 12,00 €` · `SkyIsles 10,80 €` · `Auf Lager` |
| gelistet, verfügbar = 0 | `Marktwert 12,00 €` · `SkyIsles 10,80 €` · `Nicht auf Lager` |

**Eine bereits gesammelte Figur verbirgt ihr Shopangebot nicht.** Es gibt keine Regel
`collected → Angebot ausblenden`. Gründe: Duplikate, Geschenk, Ersatz, ein anderes
`condition`-Angebot, Mehrfachsammler. Die **Gewichtung** darf sich unterscheiden — bei einer
fehlenden Figur prominenter, bei einer gesammelten sekundär —, die **Sichtbarkeit** nicht.

`/shop` bleibt als eigene Route für Direktkäufer vorgesehen; `/` bleibt Collector-first. Beide
nutzen dieselben kanonischen Sammelobjekte und denselben Bestand — **keine zweite Produktkopie**.

`/shop-admin` bleibt Shop-Admins vorbehalten und zeigt später Bestand, `condition`,
`sale_price`, Listing, Wareneingang, externe Verkäufe, Korrekturen, Bewegungsverlauf und
Bestellungen. **Die exakte Stückzahl ist ausschließlich dort sichtbar.**

### 16. „Fehlend & verfügbar"

Bestätigt als Join über `sky_id`:

```
collection_items ⋈ skylanders ⋈ shop_inventory
```

**Keine separate User-Shop-Mapping-Tabelle.** Mögliche Sichten: Fehlend · Fehlend & verfügbar ·
Gesammelt · Gesammelt & verfügbar.

`condition` kann dabei mehrere Angebote zu derselben SKY-ID erzeugen — Drobot fehlt, im Shop
liegen `loose 10,80 €` und `boxed 18,90 €`. Der Eindeutigkeitsschlüssel `(sky_id, condition)`
bildet genau das ab; die Sicht muss also mit einer 1:n-Beziehung zwischen Figur und Angebot
umgehen, nicht mit 1:1.

### 17. Reservierung und Doppelverkaufsschutz

**Der Warenkorb reduziert keinen Bestand.** Langfristige Richtung:

```
Checkout                → Bestand atomar reservieren
Zahlung erfolgreich     → Reservierung wird echter Verkauf, quantity sinkt
Zahlung abgebrochen /
Reservierung abgelaufen → Reservierung wird freigegeben
```

**Reservierungsdauer: OPEN.**

Der Schutz vor Doppelverkauf ist eine **serverseitige, atomare PostgreSQL-Operation** —
niemals „Client liest Bestand und schreibt danach". Sinngemäß:

```
available = quantity - reserved
nur reservieren/reduzieren, wenn available ausreicht — in einer Bedingung, nicht in zwei Schritten
```

Concurrency wird auf Datenbankebene gelöst, in einer `security definer`-Funktion oder einer
vergleichbar sicheren Transaktionsfunktion. **Keine konkrete SQL-Funktion jetzt.**

### 18. Order Snapshot

Spätere `order_items` speichern historische Werte, keine Verweise auf heutige Preise.
Mindestens:

`sky_id` · `quantity` · **Namens-Snapshot** · `condition` · Basispreis · Rabatt-Snapshot ·
finaler Stückpreis.

**Zusätzlich geprüft, wie gefordert — was für geschäftlich stabile Bestellungen fehlen würde:**

| Feld | Warum |
|---|---|
| `currency` | auch bei nur EUR: eine Rechnung ohne Währung ist keine Rechnung |
| `line_total` | gespeichert, nicht gerechnet — Rundung darf sich nie nachträglich ändern |
| Steuersatz und Steuerbetrag als Snapshot | ein Satzwechsel darf alte Belege nicht verschieben |
| Kennzeichen des Steuerverfahrens | siehe unten |

**Ein Punkt, der früh entschieden werden muss, weil er das Schema bestimmt:** Der Handel mit
gebrauchten Sammlerstücken läuft häufig über **Differenzbesteuerung** statt Regelbesteuerung.
Dann bemisst sich die Steuer an der Spanne zwischen Einkauf und Verkauf — die Bestellposition
müsste den **Einkaufspreis dieses Exemplars** nachvollziehbar machen, was heute nirgends
gespeichert ist (`inventory_movements` kennt nur `delta`, keinen Einstandswert). Die Legacy-Datei
führt EÜR-Blätter, das Thema ist also real.

**Das ist eine steuerliche Frage, keine technische — sie bleibt OPEN und wird nicht hier
entschieden.** Was daraus für das Datenmodell folgt, steht in Abschnitt 21; die
Legacy-Datenlage in `docs/SKYLANDERS_DATA.md` 11d. Ebenfalls OPEN und rechtlich relevant: eine
lückenlose Rechnungsnummerierung auf Bestellebene.

**Keine Bestellungen, keine Felder, keine Migration jetzt.**

### 19. Was jetzt feststeht

- Berechtigung in `shop_admins` plus `is_shop_admin()`, nie in `profiles`, nie per E-Mail-Konstante
- Vergabe der Rolle über ein Werkzeug mit Dry-Run und `--apply`, idempotent, ohne E-Mail im Quelltext
- `shop_inventory` ohne `user_id`; `collection_items` bleibt unberührt und unsynchronisiert
- `sky_id` ist die gemeinsame Identität; keine Shop-eigenen Produktidentitäten
- `condition` mit genau zwei Werten `loose` und `boxed`, von Anfang an im Eindeutigkeitsschlüssel
- gespeicherte `quantity` **plus** Bewegungsjournal; `inventory_movements` ohne redundante `sky_id`
- `shop_inventory.sky_id` und `condition` sind unveränderlich
- atomares bedingtes Update als Schutz vor Doppelverkauf, serverseitig
- Reservierung beim Checkout, nicht beim Warenkorb
- `sale_price` manuell, Rabatte abgeleitet, `market_price` niemals durch den Shop verändert
- öffentlich nur „Auf Lager" / „Nicht auf Lager" aus `quantity - reserved`
- externe Verkäufe sind eine Bewegungsart, manuell erfasst
- kein `catalog_visible` in V1; `is_active` bleibt unverändert
- SWAP-Hälften und Software werden in V1 nicht verkauft
- Reihenfolge: Foundation → Legacy-Import → `/shop-admin`
- nach dem Import führt die SkyIsles-Datenbank, nicht die Excel
- Katalogbereinigung ist ein eigener späterer Schritt und **kein** Blocker

### 19b. Wie das Fundament gebaut wurde

**Autorisierung ist ein Postgres-Recht, keine Fallunterscheidung im Code.** Der spätere
Legacy-Import läuft als Service Role und hat keine `auth.uid()` — er kann also nie Shop-Admin
sein. `is_shop_admin()` dafür aufzuweichen hätte dieselbe Tür für jeden angemeldeten Nutzer
geöffnet. Stattdessen gibt es **eine** Implementierung der Invariante und zwei Wrapper darum:

```
        apply_inventory_movement()      für NIEMANDEN ausführbar
          ^                    ^
  record_inventory_     system_record_inventory_
  movement()            movement()
  authenticated,        nur service_role
  is_shop_admin()       created_by = NULL, keine Kostenparameter
  created_by=auth.uid()
```

Die innere Funktion ist erreichbar, weil die Wrapper `security definer` sind und dem
Migrations-Owner gehören. Jeder Client-Rolle ist sie explizit entzogen — womit auch `created_by`
nicht fälschbar ist: Es ist kein Parameter der öffentlichen Wrapper.

**Keine Tabellenrechte für irgendeinen Client**, Shop-Admins eingeschlossen. RLS auf allen drei
Tabellen **ohne eine einzige Policy**. Die öffentliche Shop-Projektion kommt mit der Shop-UI als
schmale View oder RPC — `sky_id`, `condition`, `sale_price`, `is_listed` und ein abgeleitetes
`in_stock`, nie eine Zahl. Das Fundament hat keine öffentliche Oberfläche und braucht deshalb
auch keine.

**Race Conditions** über `select … for update` plus eine Bedingung, die Teil des
`update`-Statements ist statt eine vorangehende Prüfung: `where … and quantity + delta >=
reserved`. Es gibt kein Fenster zwischen Prüfen und Schreiben. Die CHECKs sind das letzte Netz.

**Divergenz** ist ausgeschlossen, weil Mengenänderung und Journalzeile in derselben Funktion und
derselben Transaktion entstehen und `quantity` für niemanden sonst beschreibbar ist. Nachweisbar
über die View `shop_inventory_reconciliation`, geprüft von `npm run verify:rls`.

### 20. Was ausdrücklich OPEN bleibt

Bestandsrabatt-Schwellen · ob Coupon und Bestandsrabatt kombinierbar sind und mit welchem
Vorrang · Zahlungsanbieter · Versand und Rückgabe · Reservierungsdauer · eBay-Automatisierung
(`channel`, `external_reference`) · **Steuerverfahren, insbesondere Differenzbesteuerung**
(Abschnitt 21) · lückenlose Rechnungsnummerierung · ob Chargen (Lots) je gebraucht werden ·
**Collector Catalog Normalization**: welche der 46 Legacy-Zeilen echte Sammelobjekte bleiben,
ob die Completion-Zahl von 561 sinkt, wie Zustandspreise erhalten bleiben und ob bestehende
`collection_items` migriert werden müssen · ob SWAP-Hälften oder Software je verkauft werden ·
weitere `condition`-Werte.

### 21. Einstandswert: zwei nullable Spalten jetzt, keine Chargen

**Anlass.** Abschnitt 18 hielt fest, der Einstandswert betreffe „erst Bestellungen". Die
Legacy-Untersuchung vom 2026-09-05 (`docs/SKYLANDERS_DATA.md` 11d) zeigt, dass diese Aussage in
beide Richtungen zu grob war.

**Befund 1 — aus der Legacy ist nichts zu retten.** Einkaufspreise existieren nur als Summe je
Einkaufsereignis (68 in 2026, 87 in 2025). Es gibt **keine** stückgenaue Kostenspalte, **keine**
SKY-ID in irgendeinem Order-Blatt und **keine** Charge. Für **alle 234 Bestandspositionen** ist
der Einstandswert unbelegbar. Der Import kann also gar nichts verlieren, was er nicht ohnehin
nie hatte — er importiert SKY-ID, `condition` und Menge, und das ist vollständig.

**Befund 2 — ab dem ersten eigenen Wareneingang steht sehr wohl etwas auf dem Spiel.** Sobald
Einkäufe über `/shop-admin` erfasst werden, ist der bezahlte Preis **im Moment der Eingabe
bekannt**. Gibt es dann kein Feld dafür, geht er verloren — und zwar endgültig, denn anders als
beim Marktpreis existiert für ihn keine zweite Quelle. Die Frist ist damit **nicht** „vor den
Bestellungen", sondern **vor der ersten echten `purchase`-Bewegung**.

**Modellvergleich.**

| | A: nichts | **B: `unit_cost` an purchase** | C: Chargen (Lots) | D: eigene Einkaufstabelle |
|---|---|---|---|---|
| Einfachheit | ✅ maximal | ✅ zwei nullable Spalten | ❌ Tabelle + Restmengenführung | ❌ zweite Wahrheit neben dem Journal |
| Mehrfachpreise derselben Figur | ❌ | ✅ je Bewegung ein Preis | ✅ | ✅ |
| Teilverkäufe, Rückgaben, Korrekturen | ✅ | ✅ unverändert über `delta` | ⚠️ Restmenge je Lot mitzuführen | ⚠️ |
| Welches Exemplar wurde verkauft (FIFO) | ❌ | ⚠️ später ableitbar | ✅ | ⚠️ |
| Differenzbesteuerung möglich | ❌ | ⚠️ Rohdaten vorhanden | ✅ | ✅ |
| Buchhaltung später | ❌ | ✅ Rohdaten vorhanden | ✅ | ✅ |
| Migrationsaufwand jetzt | 0 | **nahe 0** | hoch | hoch |
| Overengineering-Risiko | — | gering | **hoch** | **hoch** |

**Entscheidung: Modell B.** `inventory_movements` bekommt `unit_cost numeric(10,2) null` und
`currency text null`, gefüllt **nur** bei `reason = 'purchase'`, sonst `NULL`. Zwei nullable
Spalten, keine Logik, keine Pflicht, keine Oberfläche, die daran hängt.

**Warum das reicht — und warum Chargen später ohne Verlust nachrüstbar sind.** Ein Lot ist im
Kern nichts anderes als eine Einkaufsbewegung plus eine Restmenge. Solange jede
`purchase`-Bewegung ihre eigene Menge, ihr Datum und ihren Stückpreis trägt, lassen sich Lots
daraus jederzeit **ableiten**; fehlt der Stückpreis, lassen sie sich aus **nichts** ableiten.
Modell B ist damit genau die Datenschicht, auf der Modell C später aufsetzen kann — der
Unterschied zwischen „später erweiterbar" und „später unmöglich".

**Ausdrücklich nicht getan:** ein Einstandswert wird **nicht** aus `Marktwert × Faktor`
geschätzt. Das sähe aus wie eine Buchhaltungsangabe, ohne eine zu sein. Der Legacy-Import
schreibt `unit_cost = NULL` und dokumentiert damit ehrlich, dass der Wert unbekannt ist.

**Keine steuerliche Aussage.** Ob Differenz- oder Regelbesteuerung anzuwenden ist, wird hier
nicht entschieden und nicht beurteilt — das ist keine Softwarefrage. Festgehalten ist
ausschließlich, **welche Rohdaten das System speichern können muss**, damit eine spätere
Anforderung nicht an fehlenden Daten scheitert.

**Zeitpunkte, getrennt:**

| Entscheidung | spätestens fällig |
|---|---|
| Existieren `unit_cost` und `currency` als Spalten? | **vor der Foundation-Migration** — hier entschieden: ja |
| Woher der Einstand der Legacy-Bestände kommt? | **entfällt** — es gibt keinen; Import schreibt `NULL` |
| Werden Einkäufe künftig mit Preis erfasst? | vor dem ersten Wareneingang über `/shop-admin` |
| Chargen, FIFO, Einzelzuordnung | erst wenn eine Anforderung sie verlangt — dann ableitbar |
| Steuerverfahren, `order_items`-Steuerfelder, Rechnungsnummern | vor den ersten Bestellungen |

**Die Shop Foundation ist dadurch nicht blockiert, und der Bestandsimport ebenso wenig.**

---

## ADR-0038 — Katalog entdeckt, Sammlung zeigt: Design V2

**Status:** ANGENOMMEN und umgesetzt (2026-09-05).

Der Katalog funktionierte, sah aber aus wie ein Verwaltungswerkzeug: viel gleichförmige helle
Fläche, sichtbare Rahmen auf jeder Karte, ein Häkchen über jeder gesammelten Figur und ein
`✓ Gesammelt`-Button darunter. Die Sammlung zeigte dieselben 561 Karten wie der Katalog, nur
mit Statistik darüber. Beides zusammen ergab eine Checkliste, keine Sammlervitrine.

### 1. Zwei Seiten, zwei Aufgaben

| | Aufgabe | Inhalt |
|---|---|---|
| `/` Katalog | entdecken, nachschlagen, Preise sehen, ergänzen | **alle** aktiven Sammelobjekte der gewählten Serie |
| `/collection` Sammlung | Besitz, Fortschritt, Wert, Duplikate | **ausschließlich** Figuren mit `quantity >= 1` |

**Fehlende Figuren erscheinen nicht mehr in der Sammlung.** Sie waren dort der Grund, warum die
Seite ein zweiter Katalog war — dieselben Karten, dieselbe Rasterdichte, eine andere
Überschrift. „Was fehlt mir" ist eine Katalogfrage.

**Die Completion-Zahl bleibt davon unberührt.** `buildCollectionRows` deckt weiterhin jedes
Sammelobjekt ab, weil 448 von 561 nur dann etwas bedeutet, wenn beide Hälften dieselbe Menge
zählen. Neu ist nur, was auf den Bildschirm kommt: `showcaseRows` und `filterCollection` geben
ausschließlich besessene Zeilen heraus.

**Eine gerade entfernte Figur bleibt sichtbar**, bis die Seite neu geladen wird. Sonst
verschwände die Karte mit dem „Rückgängig" genau in dem Moment, in dem es gebraucht wird.

### 2. Filter folgen der Aufgabe

Katalog: **kein „Alle"**, keine Kürzel. Eine Serie ist immer gewählt, ausgeschrieben, und die
erste ist der Startzustand (`defaultSeriesCode`, Reihenfolge aus der Datenbank). 561 Figuren auf
einmal sind eine Wand, die niemand scrollt, und `SA · G · SF · TT · SC · I` verlangte eine
Codetabelle, bevor man blättern durfte.

Sammlung: **Alle · sechs Serien · Duplikate** in einer Leiste. `Gesammelt` und `Fehlend` sind
ersatzlos entfallen — in einer Ansicht, die nur Besitz enthält, ist „gesammelt" jede Zeile und
„fehlend" keine.

Beide nutzen dieselbe segmentierte `FilterBar`: gemeinsame Bausteine, getrennte Aufgaben.

### 3. Besitz ist ein Zustand, keine erledigte Aufgabe

Entfernt: das dauerhafte `✓` über der Figur, der `✓ Gesammelt`-Button — und in V2.1 auch der
Text-Chip, der beide ersetzt hatte. „In deiner Sammlung" wurde auf schmalen Karten
abgeschnitten und sagte in sechs Wörtern, was ein Rahmen auf einen Blick sagt.

**Besitz trägt im Katalog der Kartenrahmen:** ein warmer Amber-Ring und eine leicht wärmere
Fläche. Kein Grün, kein Häkchen, kein Glühen, kein zweites Randgewicht — ein gesammeltes Stück
soll aussehen wie ein Stück in der Vitrine, nicht wie eine erledigte Aufgabe.

Farbe allein trägt den Zustand nicht: Die Karte ist ein `button` mit `aria-pressed`, und ein
`sr-only`-Text nennt sowohl den Zustand als auch, was ein Druck bewirken würde.

**Der Rahmen ist ausdrücklich eine Katalog-Semantik.** Er beantwortet genau eine Frage —
*„Besitze ich diese Figur schon?"* — und die stellt sich nur dort, wo vorhandene und fehlende
Sammelobjekte nebeneinander liegen. **In `/collection` gibt es ihn nicht:** Dort ist jede Figur
Besitz, ein Rahmen um jede Karte sagte also nichts und würde zugleich verwässern, was er im
Katalog bedeutet. Die Karten der Vitrine bleiben neutral und hochwertig — kein Rahmen, kein
Besitztext, kein Häkchen. Die Mengenkennzeichnung `2×` bleibt, weil sie etwas sagt, das die
Seitenzugehörigkeit nicht schon impliziert.

Die Unterscheidung liegt **im Verwendungskontext, nicht in zufälligen CSS-Unterschieden**:
`FigureCard` nimmt ein `ownership`-Prop (`"catalog"` | `"showcase"`, Standard `"showcase"`), und
nur `CatalogCard` fordert `"catalog"` an. Die Regel selbst steht als reine Funktion in
`src/lib/catalog/card.ts` und ist dort geprüft, damit sie zwischen beiden Seiten nicht
auseinanderlaufen kann.

### 3a. Die Karte ist die Aktion (V2.1)

**Tippen auf die Katalogkarte schaltet den Sammlungszustand um** — hinzufügen, erneut tippen
entfernt. Das ersetzt einen Button auf jeder der 561 Karten, die größte einzelne Quelle
visuellen Rauschens im Raster. Mutation und Undo-Semantik sind unverändert (ADR-0027): gesetzt
wird ein gewünschter Endzustand, kein Toggle, und die Aktion wird nach einer Anmeldung **nicht**
wiederholt.

**„Info" ist eine eigene Aktion** im Kartenfuß und führt zur Detailseite. Sie ist ein
**Geschwisterelement** des klickbaren Körpers, kein Kind — damit kann eine Navigation den
Zustand nicht mitschalten, ganz ohne Event-Behandlung, und nichts Interaktives ist ineinander
verschachtelt. Beide sind mit der Tastatur erreichbar.

Abgemeldet ist der Kartenkörper stattdessen ein Link in den Anmeldefluss, der den Katalogkontext
mitnimmt. Es gibt dann nichts umzuschalten, und derselbe Tipp führt dorthin, wo es weitergeht.

Die Aktion ist auf **jedem** Viewport verfügbar. Sie erst bei Hover zu zeigen wäre leiser
gewesen und genau die Falle: Ein Telefon hat keinen Hover, und die eine Aktion, für die der
Katalog existiert, darf nicht an einem Zeigegerät hängen.

In `/collection` trägt **keine** Karte den Rahmen (siehe oben). Der Kartenkörper führt dort zur
Detailseite, und der Fuß trägt „Entfernen"/„Rückgängig": Der Katalog sammelt ein, die Sammlung
pflegt. Zwei Aufgaben, zwei Gesten.

### 4. Die Karte verliert ihren Rahmen

Weg: Rahmen, farbige Elementkappe, Häkchen-Badge, umrandete Serien-Pille, umrandeter Button.
Geblieben: Figur, Name, Preis, eine leise Metazeile — getragen von Fläche und weichem Schatten
statt von Linien.

Hierarchie: **Figur → Name → Preis → Serie/Element → Aktion.** Der Preis ist größer und
tabellarisch gesetzt, bleibt aber neutraler Marktwert und wird nicht als Preisschild inszeniert
(ADR-0033). Serie und Element stehen klein darunter; **im Katalog entfällt die Serie ganz**,
weil der aktive Tab sie bereits nennt.

Die **Elementkappe** ist entfallen. Ohne Rahmen, auf dem sie saß, schwebte sie über der
gerundeten Ecke und las sich wie ein Darstellungsfehler — und sie sagte in Farbe allein, was
die Zeile darunter in Worten sagt. Die Elementfarbe lebt weiter dort, wo sie auch benannt ist.

**Duplikate** erscheinen als kleines `2×` auf der Bildplatte — das einzige, was je über einer
Figur liegt, und nur, weil es etwas sagt, das kein Label unterhalb ausdrücken könnte.

### 5. Die Sammlung bekommt eine Rückwand — und sie folgt den Tabs

Der Kopfbereich ist eine dunkle Fläche (`--deep`), die einzige Verwendung dieses Tons im
Produkt. Eine Vitrine hat eine dunkle Rückwand; dieser Kontrast ist der Unterschied zwischen
einer Anzeige und einem ausgefüllten Formular.

**V2.1: Der Hero beschreibt das aktive Segment, nicht immer die ganze Sammlung.** Die sechs
Serienfortschrittskarten darunter sind **ersatzlos entfallen** — sie sagten dasselbe in
Miniatur, gaben der Seite eine zweite Art, eine Serie zu wählen, und ließen sie wie ein
Dashboard aussehen. Der Aufbau ist jetzt: Hero → Filterleiste → Suche → Anzahl → Raster.

| Aktives Segment | Hero zeigt |
|---|---|
| `Alle` | gesammelt / Katalogtotal (aus der Datenbank), Prozent, Marktwert, wie viele fehlen |
| eine Serie | dasselbe, aber **nur** für diese Serie — Zähler, Nenner, Wert und Fehlende alle aus deren aktiven Sammelobjekten |
| `Duplikate` | eigene Form: Figuren mit Duplikaten, zusätzliche Exemplare, Marktwert **nur der Zusätze** |

`Duplikate` ist keine Completion-Serie. Es gibt kein Ziel zu erreichen, also kein „x von y" und
keinen Fortschrittsbalken. Der Wert zählt ausdrücklich **`(quantity − 1) × market_price`**: Ein
Bereich, der „Duplikate" heißt, darf nicht den Wert der jeweils ersten Exemplare mitzählen. Das
widerspricht `collectionStats.estimatedValue` nicht — das beantwortet die andere Frage, was die
gesamte Sammlung wert ist, und bleibt unverändert.

**Der Hero reagiert nicht auf die Suche.** `segmentSummary(rows, filter, catalogTotal)` bekommt
den Suchtext gar nicht erst. Sonst würde „Wie vollständig ist Trap Team" zu einer Zahl, die beim
Tippen springt. Die Suche filtert ausschließlich das Raster; der Zähler darunter sagt dann
„12 von 130 Figuren" statt einer nackten Zahl.

Alles abgeleitet, **keine neue Datenbankspalte**, die Marktwertsemantik unverändert.

### 6. Kopfbereich

Statt eines 6-px-Punktes ein Monogramm-Kachel plus Wortmarke mit Gewichtskontrast
(**Sky**Isles). Der aktive Navigationspunkt ist auf dem Desktop eine getönte Pille statt einer
Haarlinie; in der Telefonleiste bleibt der Balken, weil dort eine Pille mit den Beschriftungen
konkurriert. Kein externes Asset, keine zweite Schrift, kein Logo-Entwurf.

### 7. Was ausdrücklich nicht passiert ist

Keine Komponentenbibliothek, kein UI-Framework, keine neue Abhängigkeit. Keine Änderung an
Datenmodell, Auth, RLS, Shop-Fundament, SKY-IDs, Charaktermodell, Marktpreisberechnung,
Mengensemantik, Softwareausschluss (ADR-0029) oder am Auth-Rücksprung (ADR-0027). Keine
Migration. Kein Shopangebot und kein Verkaufspreis im Katalog.

### 8. Ein dabei gefundener Fehler

Die Sammlung konnte den Hinweis „… Einträge sind Spiele und zählen nicht zum Sammelfortschritt"
**nie** anzeigen: `buildCollectionRows` entfernt Software (ADR-0029), und genau dieses Ergebnis
ging in `collectionStats`. Die Statistik bekommt die ausgelassenen Einträge jetzt wieder
hinzugefügt — die Vitrine bleibt frei von Spielkarten, die Zusammenfassung zählt aber wieder
jeden besessenen Eintrag. Bestand seit V1.5, gefunden bei der Sichtprüfung dieses Schritts.

### 10. Visual V3 — die Markenwelt

V2.1 war aufgeräumt und blieb neutral: eine helle Seite mit Karten darauf, austauschbar mit
jedem anderen Tailwind-Produkt. V3 macht die Seite selbst zu dem Ort, aus dem die Figuren
kommen — ein tiefer Himmel mit warmem Horizont, Inselsilhouetten in der Ferne, und die
Sammelstücke davor im Licht.

**Das Farbschema kippt nicht mehr die Welt, es ändert die Tageszeit.** Hell heißt Dämmerung,
Dunkel heißt Nacht. Beide sind dunkle Gründe, beide tragen dieselben elfenbeinfarbenen Karten.
Das ist die konsequente Fortsetzung von `--plate`, das seit ADR-0035 in beiden Schemata hell
ist: „Karten heller als ihre Umgebung" **ist** die Komposition, und eine Karte, die mit dem
Schema umschlägt, nähme sie weg. Die Kartentexte nutzen deshalb feste `--on-card`-Tinte statt
`--foreground`.

**Der Hintergrund ist eigenes SkyIsles-Artwork — aber begrenzt (V3.2).** V3.1 hängte das große
Weltbild hinter jede Seite, und das Ergebnis war Oberfläche auf einem Wallpaper: Text über
sonnenbeschienenen Wolken, Karten auf unruhiger Landschaft, die Kennzahlen der Sammlung quer
über einem Portal. Ein Bild als Tapete wird kein Design.

Deshalb hat die Welt jetzt einen Ort — aber keinen Rahmen. V3.2 setzte `portal-hero-v2.png`
als begrenztes Band **in** den Seiteninhalt, und genau so las es sich: Kopf, dann ein Bild, dann
eine Suchleiste, dann ein Raster. Fünf Webbausteine, kein Ort.

**V3.3: `WorldZone`.** Das Artwork liegt jetzt hinter der gesamten oberen Seite — hinter dem
Kopf, dem Titel, der Suche und den Serienpillen — und endet in einem dreistufigen Verlauf, der
die Deep-Navy-Vitrine erreicht, bevor die erste Kartenreihe beginnt. Zwischen Kopf und Raster
hat **kein einziges Element einen eigenen Grund**, also gibt es auch keine Bildkante zu sehen.
Der Kopf ist dunkles Glas *in* der Welt statt einer Leiste darüber.

Titel, Subline und Suche stehen in einer Spalte, die auf Desktop bei 52 % Breite endet — das
**Portal rechts bleibt frei**. Das Artwork ist rechts verankert, damit das Portal jede Breite
überlebt; unter `md:` gewinnt der Text, und die ruhige linke Bildhälfte wird abgeschnitten.

**Mit `WorldZone` in den beiden Collector-Layouts** statt in einer Seite: `/` und `/collection`
liegen in verschiedenen Route Groups, und was einer Seite gehört, wird beim Wechsel zwischen
ihnen ausgehängt. Ein struktureller Test hält beides fest.

`artwork/background.png` bleibt die volle Welt und trägt jetzt die Seiten, die nichts anderes zu
tun haben: Anmeldung, Registrierung, Passwort-Reset. Nichts davon stammt aus den Spielen;
verboten bleibt ausschließlich fremdes Material: offizielle Skylanders-Hintergründe,
Spiel-Screenshots, fremde Fantasy-Artworks, fremde Logos (`docs/SECURITY.md`, ADR-0009).

**Ausgeliefert werden nur die optimierten Ableitungen:** `skyisles-backdrop.webp` (112 KB) und
`skyisles-backdrop-sm.webp` (43 KB) unter `public/images/brand/`, ausgewählt per `srcset` — ein
Telefon lädt nie die große Datei. Aus 2,1 MB PNG werden damit 43–112 KB. Die Quelldateien unter
`artwork/` sind **nicht** versioniert (`.gitignore`): mehrere Megabyte Rohmaterial gehören nicht
in die Historie eines Repositories, das sonst aus Text besteht. Sollen sie es doch, ist das eine
bewusste Entscheidung und kein Nebeneffekt.

**Die CSS-Ebenen aus V3 sind geblieben, jetzt als Unterbau:** Lädt das Bild nicht, ist die Seite
ein Dämmerungshimmel in den Farben der Palette statt eines grauen Rechtecks. Darüber liegen ein
violetter Schleier, der das Bild hinter die Oberfläche zieht, und die Beruhigung nach unten,
damit ein langes Raster über ruhigem Grund scrollt statt über Burgen.

**Nichts bewegt sich** — ein wandernder Himmel hinter einem Text ist Ablenkung, keine
Atmosphäre, und ein stehender braucht keine Reduced-Motion-Ausnahme. Die Seite bleibt ohne die
Kulisse vollständig lesbar: `--canvas` ist eine einfarbige Fläche, und jede Fläche darüber setzt
ihren eigenen Grund.

**V3.1 hat die Welt sichtbar gemacht.** V3 hielt den Himmel an den Rändern und deckte den Rest
mit undurchsichtigen Flächen zu — technisch sauber, im Ergebnis eine aufgeräumte dunkle App
statt eines Ortes. Jetzt liegt das Artwork offen: Der Kataloghero hat **gar keine Fläche mehr**,
sondern Titel und Subline mit eigenem Textschatten direkt auf der Welt, darunter die Suche als
dunkle Pille und die Serien als einzelne Pillen statt in einer eingefassten Schiene. Jede
Panel-Fassung davon — erst undurchsichtig, dann Glas — war ein Deckel auf dem Bild.

**Karten wie im Entwurf:** Elfenbein für jedes Stück, **Bronze** für die Kante einer fehlenden
Figur und **Gold** für die eigene — drei Ringe, eine hellere Lichtkante oben, ein warmer
Elfenbeinton und ein weicher Schein. Der Prüfstein ist, ob eine gesammelte Figur aus zwei Metern
Entfernung als gesammelt liest; bis V3.3 tat sie das nicht. Bronze statt gedimmtem Gold, weil
zwei Stärken derselben Farbe einen Vergleich verlangen, zwei Metalle dagegen gesehen werden. Der
Kartenfuß ist ein dunkler Bronzeknopf.

**Der Sammlungs-Hero ist eine nahezu deckende Vitrinenplatte** mit doppeltem Goldrahmen, vier
Eckwinkeln, goldenem Fortschrittsbalken und durch Haarlinien getrennten Kennzahlen — die eine
Fläche im Produkt, die wie ein Gegenstand aussehen darf. Sie ist bewusst **nicht** transparent:
Bei 70 % lasen die Vollständigkeitszahlen quer über einem Sonnenuntergang.

**Der Kopf** ist dunkles Glas mit goldener Unterkante und einer goldenen Unterstreichung am
aktiven Punkt statt einer hellen Pille — die Pille war das Letzte, das noch nach
Web-App-Werkzeugleiste aussah.

**Das Farbschema ist in beiden Vorlieben dunkel** (`color-scheme: dark`). `light dark` sagte dem
Browser, es könnte auch anders sein — womit in einem hellen Systemthema eine weiße
UA-Zeichenfläche oder ein weißes Formularelement die Art Direction auseinandernehmen konnte. Die
Vorliebe ändert weiterhin die Tageszeit, nie die Polarität. Dazu eine einzige Inline-Angabe am
`<html>`: `color-scheme: dark`, damit ein **nicht geladenes Stylesheet** zu einer dunklen
ungestylten Seite führt statt zu einer weißen.

**Und ausdrücklich kein `background` am `<html>`.** Der erste Versuch setzte dort zusätzlich
eine Farbe — und machte damit das gesamte Artwork unsichtbar. Der Grund des `body` wandert nur
so lange auf die Zeichenfläche, wie `html` selbst keinen hat; sobald `html` einen bekommt, malt
der `body`-Hintergrund als gewöhnlicher Elementhintergrund — über jedem `z-index: -10`-Kind, das
er hat. Genau dort liegen `SkyBackdrop` und `WorldZone`. Die Seite wurde flach navy, Himmel,
Inseln und Portal verschwanden (V3.4).

**Die Detailseite hat eine eigene Fläche bekommen.** Die Welt läuft hinter jeder Collector-Seite,
und ihr hellster Punkt — das Portal — landet dort genau auf Name, Serie und Preis. Das war die
letzte Stelle, an der Text direkt auf Artwork stand.

**Der Besitzrahmen in drei Anläufen.** V2.1 zog einen 1-px-Ring bei 45 % Deckung — unsichtbar
beim Überfliegen einer Spalte, und gesehen zu werden ist seine einzige Aufgabe. V3 verdoppelte
ihn. **V3.1 beleuchtet ihn:** Goldrand, eingerückte innere Haarlinie, weicher äußerer Schein und
ein warmer Verlauf über das Elfenbein. Das frühere „kein Glühen" ist damit bewusst gelockert —
klein und statisch, gerade so viel, dass der Rahmen als Licht auf einem Stück liest, weit
entfernt von einer Lampe um eine Karte. Die neutrale Karte bekam im Gegenzug eine **bronzene**
Kante: eine helle Haarlinie auf violettem Grund las sich als „fast Gold", also genau als die
Unterscheidung, die der Rahmen treffen soll. Die Regel bleibt unverändert **nur im Katalog**
(Abschnitt 3).

**Elementfarben in zwei Skalen.** `--element-ink-*` für die elfenbeinfarbene Karte,
`--element-*` für dunkle Flächen. Beide sind schemaunabhängig konstant, weil ihre Gründe es
sind. Farbe bleibt nie das einzige Signal: Das Label nennt das Element weiterhin.

Dazu: dunkler Glaskopf mit Goldhaarlinie · Kataloghero aus Titel, Subline, Suche und Tabs in
einer Fläche · dunkle Segmentleiste mit goldenem Aktivzustand · dunkler Kartenfuß für „Info" ·
Vitrinen-Hero mit Goldkante, warmem Eckenlicht und der Kennzahl in Amber · Auth-Formulare auf
einer eigenen Fläche statt frei auf dem Himmel.

Unverändert: jede Produktregel aus den Abschnitten 1–5, die Marktwert- und
Completion-Berechnung, Auth, ADR-0027, das Shop-Fundament, das Datenmodell.

### 10b. Visual V4 — Marke, Siegel, zwei Ansichten

**Eigenes Emblem und eigene Wortmarke.** `public/images/brand/skyisles-mark.svg` — eine
schwebende Insel mit drei Spitzen über einem Himmelsbogen, in Gold, unter einem Kilobyte, scharf
bei 28 px. Nichts daran stammt aus einem Franchise. Die Wortmarke steht in einer
**Display-Serif** aus dem System (`Iowan Old Style`, `Palatino`, `Hoefler Text`, Georgia);
bewusst **kein Webfont**, weil eine lizenzierte Schrift eine Datei im Repository, eine Lizenz und
einen Netzabruf bedeutet, bevor der Name der Seite lesbar ist. Die Serif trägt Wortmarke,
Seitentitel und Serienüberschriften; die Oberfläche behält ihre System-Sans.

**Navigation links neben der Wortmarke.** Am rechten Rand einer 1152-px-Leiste ist sie das
Layout einer Web-App, nicht das eines Titelkopfs. Aktiv ist heller Text mit goldener
Unterstreichung und leichtem Schein — keine gefüllte Pille.

**Das Besitzgold trägt die ganze Karte.** Nicht nur den Rahmen ums Bild: Grund, Name, Preis und
Fuß werden warm, dazu drei Ringe, eine Lichtkante innen und ein weiter Schein außen. Der
Prüfstein ist, ob eine gesammelte Figur aus normalem Betrachtungsabstand sofort als gesammelt
liest.

**Und ein Siegel: die goldene Krone.** Die frühere Regel „kein Statusabzeichen" ist damit
bewusst aufgehoben — allerdings nur für den Katalog. Ein eigenes SVG, kein Emoji (das rendert
auf jeder Plattform anders und wäre die einzige solche Glyphe im Produkt), `aria-hidden`, weil
`aria-pressed` und der `sr-only`-Text den Zustand bereits tragen. **In `/collection` gibt es
weder Krone noch Goldrahmen**: Dort ist jede Figur Besitz, ein Siegel auf jeder Karte siegelt
nichts.

**Zwei Welten, dauerhaft getrennt.** Der Katalog bekommt `portal-hero-v2` — ein Wahrzeichen,
komponiert für einen Titel links davon. Die Sammlung bekommt `background`, den weiten Blick ohne
einzelnen Fokus, der mit der Vitrinenplatte darauf nicht konkurriert.

**Symbole oder Tabelle.** Zwei Blicke auf dieselbe Sammlung: die Karten, die man *sehen* will,
und eine Tabelle für die Frage nach Zahlen. **Seit V4.2 öffnet die Tabelle** (siehe 10e). Umgesetzt als zwei echte Buttons mit `aria-pressed`,
auf dem Desktop eine echte `<table>` mit `<th scope="col">`, unter `md:` gestapelte Zeilen —
sechs Spalten auf 390 px sind entweder unlesbar oder ein horizontales Scrollen. Die Wahl
überlebt im `localStorage`, gelesen über `useSyncExternalStore` mit Server-Snapshot: Der erste
Anstrich stimmt mit dem Server überein, React tauscht den gespeicherten Wert direkt nach der
Hydration ein — keine Abweichung, und kein Render aus einem Render heraus.

**„Alle" wird nach Spielen gruppiert.** 448 Figuren in einem ununterbrochenen Raster sind ein
Scrollweg, keine Übersicht. Sechs Abschnitte mit Überschrift, `owned / total` und einem dünnen
Goldfaden — echte `<h2>`, damit die Seite eine Gliederung hat. Reihenfolge aus `series.position`,
nichts hartkodiert. Ein Spiel ohne Besitz entfällt ganz. Die Zahlen beschreiben die Sammlung,
**nie die Suche**: „3 / 81", weil ein Suchbegriff drei Treffer hat, wäre eine Falschaussage.
(V4.1 gibt auch einer einzelnen gewählten Serie eine Überschrift, V4.2 auch dem Duplikatfilter —
siehe 10c und 10e.)

**Basis- und Special-Figuren sind ausdrücklich nicht gebaut** — keine Heuristik, keine
Namenserkennung, kein Alibi-Bedienelement. Das ist ein eigener Datenmodellschritt.

### 10c. V4.1 — und ein Audit, das zwei Funktionen ausbremst

**Das Besitzgold liegt um die Karte, nie darüber.** V4 tönte die ganze Karte warm und beleuchtete
sie von innen — die Figuren kamen ausgewaschen heraus, ein gelber Filter über der Fotografie
statt eines Rahmens darum. Jetzt trägt die gesammelte Karte denselben Elfenbeingrund und
dasselbe unveränderte Bild wie jede andere; unterschieden wird sie durch die Ringe, vier
**statische** Lichtpunkte auf dem Rahmen und die Krone. Den Außenschein hat V4.2 entfernt
(siehe 10e).

**„Filter zurücksetzen" erscheint nur, wenn es etwas zurückzusetzen gibt.** `hasActiveFilter`
entscheidet das an einer Stelle: „Alle" mit leerer Suche ist der Ruhezustand, kein Filter. Der
Ansichtsmodus zählt bewusst nicht dazu — eine Tabelle zu wählen ist eine Art zu schauen, keine
Einschränkung dessen, was gezeigt wird.

**Serienabschnitte auch bei einer einzelnen Serie.** Dieselbe Form, egal welcher Tab aktiv ist,
und der Abschnitt nennt den Stand dieses Spiels, was der Tab nicht tut. Seit V4.2 gilt das auch
für den Duplikatfilter: eine Form, immer.

**Die Katalogsuche verlässt den aktiven Tab nicht — findet aber darüber hinaus.** Die gewählte
Serie antwortet zuerst, danach folgen die übrigen Spiele als eigene Abschnitte in
Datenbankreihenfolge, leere ausgelassen. Der aktive Abschnitt bleibt auch ohne Treffer stehen,
weil „hier nichts, aber drei in Giants" die eigentliche Antwort ist. **Der Tab wechselt nie von
selbst**: Sonst führte das Leeren der Suche nicht dorthin zurück, wo man war.

### 10d. Audit: warum Elemente fehlen und Special-Versionen warten müssen

Gemessen an der laufenden Datenbank (2026-09-06), nicht geschätzt:

| | |
|---|---|
| aktive Sammelobjekte | **561** |
| davon mit `character_id` | **104 (18,5 %)** |
| davon mit Element am Charakter | 102 |
| Charakter ohne Element | 2 (Kaos-Fall, ADR-0034) |
| **ohne `character_id`** | **457 (81,5 %)** |
| Charaktere insgesamt | **19** |

**Die Elemente fehlen nicht fehlerhaft — die Kuratierung ist ein Pilot.** ADR-0034 hat 19
Charaktere bewusst als Anfang angelegt; alles darüber hinaus ist schlicht noch nicht kuratiert.
Das ist Fall **C (fehlender Charakterlink)**, nicht A. Eine automatische Reparatur ist
ausgeschlossen: ADR-0034 verbietet das Raten aus Namen, und die Analyse von 2026-09-04 hat
gezeigt, warum (LightCore in drei Schreibweisen, `Mini Drobit` ≠ Drobot, Tippfehler,
`Bone Bash Roller Brawl` ≠ Bash).

**Für Basis gegen Special reicht die Datenlage ebenfalls nicht.** Selbst innerhalb der 19
kuratierten Gruppen steht kein Feld dafür:

```
SKY-0053 SA  Spyro                    ← Basisfigur
SKY-0054 SA  Dark Spyro               ← Sonderedition
SKY-0055 SA  Legendary Spyro          ← Sonderedition
SKY-0057 SA  Elite Spyro              ← eigene Produktlinie
SKY-0177 G   Spyro                    ← ebenfalls Basisfigur, anderes Spiel
SKY-0285 SF  Mega Ram Spyro           ← Basisfigur der Swap-Force-Reihe
```

`character_id` gruppiert korrekt, sagt aber nichts darüber, welche Zeile die Basisausgabe **je
Spiel** ist — und für 81,5 % gibt es die Gruppe gar nicht. Eine Namensheuristik träfe höchstens
167 von 561 Zeilen und läge dabei falsch: `Mega Ram Spyro` ist eine Basisfigur, `Elite …` eine
eigene Linie.

**Deshalb wurde der Special-Umschalter nicht gebaut.** Kein Alibi-Bedienelement, keine
Heuristik. Nötig ist ein eigener Datenschritt mit zwei Feldern — sinngemäß eine
`release_group` (Charakter × Spiel) und ein `is_base_release` je Gruppe, kuratiert wie die
Charaktere, mit Werkzeug, Dry-Run und `--apply`. Erst danach ist der Umschalter belastbar.

### 10e. V4.2 — geschmiedet statt beleuchtet, und Filter statt Tab

**Der Besitzrahmen verliert jeden Weichzeichner.** V3.4 legte 34 px Bloom und 74 px Halo um jede
gesammelte Karte. Aus zwei Metern las das als „gesammelt", aus Lesedistanz als *leuchtende*
Karte: Das Licht griff auf die Nachbarkarten über und weichte genau die Kante auf, die es zeichnen
sollte. `--gold-glow` heißt jetzt `--gold-frame` und enthält **keinen einzigen Unschärferadius**
mehr — eine helle Lichtkante, der Körper des Rahmens, ein dunkler Sitz darunter, dazu der
Schlagschatten, den jede Karte trägt. Rahmen (3 px), feine Innenlinie, vier Funken und Krone
bleiben. Karte, Bild und Text sind unverändert. Getestet wird das an der Quelle: Der Wächter in
`src/lib/catalog/card.test.ts` liest `globals.css` und lässt für jede **warme** Schattenebene nur
Unschärfe 0 zu — der Klassenname allein könnte das nicht beantworten.

**Duplikate sind ein Filter, keine siebte Serie.** Als Tab neben den sechs Spielen beantwortete
ein Bedienelement zwei Fragen und machte „die Duplikate in Giants" unerreichbar. Getrennt in
`view.ts`: `CollectionScope` (Spiel) und `CollectionFilters` (heute `duplicatesOnly`),
`matchesScope` und `matchesFilters`. Sichtbar getrennt bleiben sie durch die Form — runde Pillen
navigieren, das eckige Feld hinter dem Wort „Filter" schränkt ein. Die Abschnittszahlen bleiben
Sammlungsstand: Ein Filter ändert, **welche** Karten unter der Überschrift stehen, nie was die
Überschrift über das Spiel sagt.

**Die Duplikatsumme ist eine Zeile, keine zweite Übersicht.** `duplicateSummary` liefert Figuren,
zusätzliche Exemplare und deren Wert — `(Anzahl − 1) × Marktpreis`, also ausdrücklich nicht die
Segmentsumme, die jedes Exemplar zählt. Sie erscheint unter dem Fortschritt, nur solange der
Filter an ist. `SegmentSummary` ist damit wieder ein einziger Typ statt einer Union: Vollständig­keit
verschwindet nicht, weil man Duplikate anschaut.

**Die Tabelle öffnet.** Eine große Sammlung wird gelesen, bevor sie durchgeblättert wird; 448
Karten sind ein Scrollweg. Die Karten bleiben einen Klick entfernt, und die gespeicherte Wahl
schlägt den Standard — wer Symbole gewählt hat, bekommt sie bei jedem weiteren Besuch.

**Die Tabelle kann entfernen.** Rechte Spalte „Aktion", ein zurückhaltender Textbutton statt einer
Schaltflächenspalte. Kein Bestätigungsdialog (ADR-0031): Die Zeile bleibt stehen und sagt
„Rückgängig". Karte und Tabelle teilen sich `useCollectionMutation` — dieselbe optimistische
Änderung, dasselbe Zurückrollen, dieselbe Zielzustandsmutation (ADR-0027); verschieden ist nur
das Aussehen.

**Katalog: „In Besitz", nur angemeldet.** Ein Anzeigefilter im Abschnittskopf neben
`Giants · 81 Figuren`, **standardmäßig aus** — der Katalog ist zuerst der Katalog. Er verengt den
Pool, aus dem Raster **und** serienübergreifende Suche arbeiten, damit es keinen zweiten Pfad
gibt, der ihn vergessen könnte. Er schreibt nichts und ändert das Besitzgold nicht: markiert wird
weiterhin jede Karte. Wer abgemeldet ist, sieht das Bedienelement nicht — auf eine Frage ohne
Antwort gehört kein Schalter.

**Der Special-Umschalter fehlt weiterhin, und zwar absichtlich.** Die Datenlage aus 10d ist
unverändert; ein Umschalter aus Namensheuristik wäre geraten (ADR-0034). Lieber kein Bedienelement
als ein falsches — ein Test hält fest, dass es keins gibt. Ein Elementfilter fehlt aus demselben
Grund (102 von 561), die Filterkomponente ist aber so geschnitten, dass er dort einzieht, sobald
die Daten ihn tragen. Die Elementspalte der Tabelle bleibt und zeigt „—", wo nichts kuratiert ist.

### 10f. V4.3 — vier Nachbesserungen, davon eine gemessene

**Ein falsches Passwort kostet das Passwort, nicht das Formular.** Ursache war nicht der
Fehlerpfad, sondern React: `<form action={serverAction}>` setzt das Formular zurück, sobald die
Action antwortet, und ein unkontrolliertes Feld verliert dabei seinen Wert. Die Regel steht
jetzt in `src/lib/auth/preserve.ts` — Kennung bleibt, Geheimnis nie — und wird über den
Unterschied kontrolliert/unkontrolliert durchgesetzt. Nichts wird gespeichert; der Wert lebt im
Komponentenzustand.

**Der Katalogfilter zeigt jetzt in die nützliche Richtung.** V4.2 hatte „In Besitz", aus als
Standard, an zeigte nur Besitz — also die Frage, die die Sammlungsseite besser beantwortet.
V4.3 dreht ihn um: **„Besitz anzeigen", an als Standard.** An ist schlicht der Katalog, aus
lässt stehen, was noch fehlt — die Frage, mit der man vor einem Regal steht. `ownedFigures`
heißt jetzt `missingFigures`. Der Filter wird **nicht gespeichert**: kein `localStorage`, kein
Cookie, kein URL-Parameter, damit kein Altwert mit umgekehrter Bedeutung zurückkehren kann. Die
Karten melden eine Besitzänderung nach oben, sodass eine gerade gesammelte Figur bei
ausgeschaltetem Filter sofort verschwindet statt erst nach einer Serverrunde.

**Die Sammlung lädt den Katalog nicht mehr.** Gemessen mit 448 Figuren, Produktionsserver:

| | vorher | nachher |
|---|---|---|
| HTML gesamt | 1.502 KB | 1.260 KB |
| davon RSC-Payload | 496 KB | 245 KB |
| Figuren im Payload | 1.009 | 448 |
| erstes sichtbares Gerüst | — (nichts vor 420–670 ms) | 210–260 ms |

Zwei Ursachen, beide nicht die Bilder: Die Seite schickte alle 561 Katalogfiguren in den
Browser, nur damit dieser sie **zählt**; und sie schickte gar nichts, bevor alle Abfragen
fertig waren. Jetzt liefert der Server die Zählung (`countCollectibleFiguresBySeries`), und der
Kopf samt Gerüst (`CollectionSkeleton`) steht in einer `<Suspense>`-Grenze davor. Dazu teilen
sich Layout, Seite und Abfragen denselben Nutzer je Anfrage (React `cache`), statt Supabase
drei- bis viermal nacheinander nach demselben Token zu fragen.

**Die Bilder waren nie das Problem** — sie tragen bereits `loading="lazy"`, feste Maße und eine
`aspect-square`-Box, kein `priority`, kein `next/image` (ADR-0026). Offen und beziffert bleibt:
Tabellen- und Telefonansicht stehen beide im HTML (rund 1 MB der verbliebenen 1,26 MB), weil
der Server nicht weiß, welche gebraucht wird. Das zu ändern hieße, die Tabelle als ein einziges
responsives Markup neu zu bauen — eine Designänderung, und deshalb hier bewusst nicht getan.

**Der Sammlungsfilter steht jetzt in der Kontrollzeile**, zwischen Anzahl und
Symbole/Tabelle — links was gezeigt wird, in der Mitte was einschränkt, rechts wie gezeichnet
wird. Über der Suche saß er neben der Serienleiste und las sich wie ein siebtes Spiel.

### 10g. V4.4 — ein Umschalter, der stillsteht, eine goldene Kachel, ein Routenwechsel

**Der Besitzfilter ändert seine Größe nicht mehr.** Das Häkchen, das im Ein-Zustand erschien,
machte den Button breiter; auf 390 px reichte das, um ihn in die nächste Zeile zu schieben — das
Bedienelement bewegte sich, weil man es benutzt hatte. Jetzt unterscheidet **nur Farbe** die
beiden Zustände: kein Icon, keine abweichende Schriftstärke, kein anderes Padding. Ein Test hält
fest, dass in den beiden Zweigen der Klassen nichts Platzverbrauchendes vorkommt. `aria-pressed`
und der Text `Besitz anzeigen` bleiben unverändert.

**Die gesammelte Karte hat jetzt einen goldenen Grund.** Drei Schichten, von außen nach innen:

| | |
|---|---|
| äußerer Rahmen | **gold** — 3 px Ring plus feine Innenlinie (unverändert seit V4.2) |
| Kachel | **gold** — `--card-owned`, ein flacher Verlauf aus drei Stopps |
| Bildplatte | **neutral** — weiße Platte mit grauem Ring, unverändert |

Die mittlere Zeile ist der Grund, warum das diesmal funktioniert und in V4 nicht: Das Foto liegt
auf seiner eigenen weißen Platte **über** dem Gold, wird also weder getönt noch überlagert noch
ausgewaschen. Kein Unschärferadius, kein Halo, keine überbelichtete Fläche — nur eine andere
Fläche. Beide Kartentinten bleiben lesbar (12,4:1 und 4,6:1 auf dem dunkelsten Stopp), und
`card.test.ts` rechnet das gegen `globals.css` nach, statt es zu behaupten.
**Sammlungskarten bleiben neutral**: Dort ist alles Besitz, ein Goldgrund auf jeder Karte sagte
nichts.

**Der Wechsel Katalog → Sammlung beginnt jetzt sofort.** Ursache war weder die Abfrage noch die
Datenmenge, sondern eine fehlende Datei: `/collection` ist eine dynamische Route, und Next.js
überspringt das Prefetching einer dynamischen Route **vollständig**, solange sie keine
`loading`-Grenze hat. Gemessen am Produktionsserver mit 448 Figuren:

| | vorher | nachher |
|---|---|---|
| Prefetch-Antwort | **324 B, ohne Inhalt** | **18,5 KB mit Hülle und Gerüst** |
| RSC-Navigation, erstes Byte | 209 ms | **71 ms** |
| Prefetch-Kosten | — | eine Anfrage, **keine Sammlungsabfrage** |

Dass der Prefetch die Sammlung nicht lädt, ist nachgemessen und nicht angenommen: Er dauert
gleich lang und ist byte-identisch für ein Konto mit 448 und eines mit 5 Figuren.

Umgesetzt mit den Mitteln des Frameworks, ohne eigene Routing-Logik: `loading.tsx` mit
Überschrift und `CollectionSkeleton`, `prefetch` bleibt für Angemeldete Next überlassen und ist
für Abgemeldete **aus** (dort antwortet die Route ohnehin mit einem Redirect auf `/login`), und
`useLinkStatus` blendet im Navigationselement einen Punkt ein, falls doch einmal gewartet wird —
immer gerendert, nur die Deckkraft wechselt, damit die Leiste nicht springt.

Die seiteninterne `<Suspense>`-Grenze aus V4.3 ist entfallen: Mit `loading.tsx` umschließt Next
die Seite selbst, zwei Grenzen hätten dasselbe Gerüst zweimal ausgeliefert.

### 11. Offen

Serienfarben als reine UI-Konvention · Sortierung der Vitrine (Serie, Wert, zuletzt
hinzugefügt) · Mengenpflege über `2×` hinaus direkt auf der Karte · Shopangebot im Katalog,
sobald der Shop öffentlich ist (ADR-0037) · ob die Sammlungskarte langfristig dieselbe
Tipp-Geste bekommt wie die Katalogkarte · ein späterer Completion-Scope (Basisfiguren gegen
Sondereditionen) ist **ausdrücklich keine** V3-Entscheidung und wurde hier nicht vorbereitet.
