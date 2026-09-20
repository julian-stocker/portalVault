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

**Nachtrag (2026-09-12, ADR-0064).** Der Stopp gilt unverändert, einschließlich des Satzes
„auch nicht konzeptionell, auch nicht ‚nur das Datenmodell'". Präzisiert wird allein, dass der
eine Verkäufer, den der First-Party-Shop ohnehin voraussetzt, ab jetzt **benannt** ist:
SkyIsles ist die Plattform, **yulez.collectibles** ist der erste und vorerst einzige
gewerbliche Verkäufer auf SkyIsles. Es entsteht dadurch keine Marketplace-Funktion und kein
Marketplace-Datenmodell — ADR-0064 führt die Liste dessen, was ausdrücklich nicht gebaut wird,
und sechs prüfbare Schranken. Die Bedingung für einen zweiten Verkäufer bleibt die Bedingung
dieses ADR.

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

`designs/artwork/background.png` bleibt die volle Welt und trägt jetzt die Seiten, die nichts anderes zu
tun haben: Anmeldung, Registrierung, Passwort-Reset. Nichts davon stammt aus den Spielen;
verboten bleibt ausschließlich fremdes Material: offizielle Skylanders-Hintergründe,
Spiel-Screenshots, fremde Fantasy-Artworks, fremde Logos (`docs/SECURITY.md`, ADR-0009).

**Ausgeliefert werden nur die optimierten Ableitungen:** `skyisles-backdrop.webp` (112 KB) und
`skyisles-backdrop-sm.webp` (43 KB) unter `public/images/brand/`, ausgewählt per `srcset` — ein
Telefon lädt nie die große Datei. Aus 2,1 MB PNG werden damit 43–112 KB. Die Quelldateien unter
`designs/artwork/` und `designs/cards/` sind **nicht** versioniert (`.gitignore`): mehrere Megabyte Rohmaterial gehören nicht
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

---

## ADR-0039 — Redaktionelle Katalogpflege: wem welche Spalte gehört

**Status:** ANGENOMMEN (2026-09-06)

**Entscheidung.** Der Katalog bekommt eine redaktionelle Schicht auf denselben Zeilen, und die
Eigentumsfrage wird an einer Stelle beantwortet:

| Import-owned (`tools/import-catalog.mts`) | Admin/editorial-owned |
|---|---|
| `sky_id`, `name`, `slug`, `series_code`, `category_id`, `market_price`, `image_file`, `is_active` | `character_id`, `catalog_visible`, `display_name_override`, `catalog_editorial.admin_note`, `categories.catalog_group` |

**Warum das trägt.** Der Importer benennt seine Spalten einzeln; PostgREST macht daraus
`ON CONFLICT DO UPDATE SET` für genau diese. Was nicht genannt ist, überlebt jeden Lauf —
derselbe Mechanismus, der die kuratierten Charakterlinks seit ADR-0034 schützt.
`src/lib/catalog/import-payload.test.ts` nagelt **beide** Listen fest, und
`src/lib/catalog/editorial.test.ts` prüft zusätzlich, dass keine redaktionelle Spalte auch nur
im Code des Importers vorkommt.

**`is_active` wird nicht umdefiniert.** Es bedeutet weiter „die Legacy-Quelle kennt diese Zeile"
und wird bei jedem Import auf `true` gesetzt. Die redaktionelle Sichtbarkeit ist eine eigene
Spalte — genau so, wie ADR-0037 § 6 es für diesen Fall vorgesehen hatte.

**`shop_admins` ist die allgemeine Adminberechtigung.** Trotz des Namens. Sie bleibt, wie sie
ist: `public.is_shop_admin()` ist das einzige Autorisierungsprädikat, drei Shop-Funktionen
hängen bereits daran, und der einzige fertige Sicherheitsmechanismus umzubenennen wäre Risiko
ohne Gegenwert. Die Anwendung spricht ausschließlich über `src/lib/auth/admin.ts` mit ihr — dort
landet ein späteres Rollenmodell, ohne dass ein Aufrufer davon erfährt.

**Interne Daten kommen nicht auf eine weltlesbare Tabelle** — der Befund, der diese Migration
umgebaut hat. `grant select on public.skylanders to anon` gilt für **jede** Spalte, die die
Tabelle je bekommt, und RLS filtert Zeilen, nicht Spalten. Gemessen am 2026-09-06: ein anonymer
PostgREST-Client liest `select=*` und bekommt alle zwölf Spalten. Der erste Entwurf legte
`admin_note` dorthin — das wäre über `GET /rest/v1/skylanders?select=admin_note` öffentlich
gewesen, ganz gleich, was die Anwendung selektiert.

Deshalb wird nach **Publikum** getrennt: `catalog_visible` und `display_name_override` bleiben
auf `skylanders`, weil beide zum öffentlichen Produktmodell gehören — was ein Besucher liest
und ob er es überhaupt liest. `admin_note` zieht in `catalog_editorial`, eine eigene Tabelle mit
zwei unabhängigen Schlössern: `anon` hat gar kein Recht, `authenticated` hat `select` und trifft
auf eine Policy mit `is_shop_admin()`.

**`edited_at`/`edited_by` entfallen ersatzlos.** Sie wären eine zweite Wahrheit neben
`catalog_admin_changes`, das ohnehin `changed_at` und `changed_by` führt — und ein
Bearbeiterfeld auf einer weltlesbaren Tabelle hätte veröffentlicht, wer den Katalog pflegt.
Keine Oberfläche brauchte sie.

**Verborgene Zeilen verschwinden auch aus der API.** `0004` ersetzt die Policy
`skylanders_select_public` (`using (true)`) durch zwei rollenspezifische: anonym gilt
`is_active and catalog_visible`, angemeldet zusätzlich „ich bin Admin" oder „ich besitze diese
Figur". Der dritte Zweig ist notwendig, nicht bequem: eine nachträglich verborgene Figur muss in
der eigenen Sammlung vollständig bleiben (ADR-0040). Zwei Policies statt einer, weil `anon` auf
`is_shop_admin()` kein EXECUTE-Recht hat und eine gemeinsame Policy jede anonyme Katalogabfrage
mit *permission denied for function* beenden würde. Keine Rekursion: die Policies von
`collection_items` sehen `skylanders` nicht an.

**Zwei Schranken, nicht eine.** `(admin)/layout.tsx` antwortet Nicht-Admins mit **404** statt
403 — der Bereich existiert für sie nicht. Das ist die Bequemlichkeit. Die Grenze sind die
`security definer`-Funktionen aus `0004`: jede fragt `is_shop_admin()` selbst, und Clients haben
auf `skylanders`, `categories` und `catalog_editorial` weiterhin **kein** Schreibrecht. Eine
Anfrage, die die Oberfläche nie berührt, scheitert in der Datenbank.

**Nachgewiesen wird das funktional, nicht durch Lesen des Quelltexts.**
`tools/verify-editorial.mts` (`npm run verify:editorial`) prüft mit echten anonymen, normalen
und Admin-Sitzungen, was jede Rolle wirklich lesen und schreiben kann — einschließlich des
anonymen Direktversuchs auf `admin_note`. Die Service Role dient nur dem Aufbau und dem
Aufräumen, nie einer Behauptung.

**Jede redaktionelle Änderung wird protokolliert.** `catalog_admin_changes`, append-only wie das
Bewegungsjournal, geschrieben von **Triggern auf den Tabellen** statt von der Anwendung: so kann
kein Schreibweg das Protokollieren vergessen, auch kein Service-Role-Skript. Kein Event
Sourcing — der aktuelle Zustand steht in den Spalten, das hier ist die Geschichte daneben.

**Der Anzeigename überschreibt, er ersetzt nicht.** Öffentlich gilt
`display_name_override ?? ADR-0030-Ableitung`; `name` bleibt der importierte Name, der Slug
bleibt unverändert (ADR-0011), und der Suchindex enthält **beide** Schreibweisen. Ein Override
schaltet die Variantenableitung für diese Zeile ab — die öffentliche Schreibweise ist dann
entschieden und wird nicht noch einmal geraten.

**Konsequenzen.** Migration `0004` fügt zwei Spalten an `skylanders`, eine an `categories`, zwei
Tabellen, neun Funktionen und vier Trigger hinzu — und **ersetzt eine bestehende Policy**. Das
ist der einzige nicht rein additive Schritt und der Grund, warum die Migration erst nach diesem
Review ausgeführt wird. Keine Spalte und keine Zeile wird verändert. Der Adminbereich ist Serverbereich; Bilder-Upload,
Element-Override und Variantenklassifikation sind ausdrücklich **nicht** Teil davon.

---

## ADR-0040 — Verborgene Figuren zählen in keiner Hälfte der Completion

**Status:** ANGENOMMEN (2026-09-06)

**Entscheidung.** Ist `catalog_visible = false`, dann zählt die SKY-ID **weder im Zähler noch im
Nenner** des öffentlichen Sammlungsfortschritts.

Ausdrücklich **verworfen** wurde der zunächst vorgeschlagene Weg, den Zähler weiterzuzählen und
die Prozentanzeige bei 100 % zu deckeln: „415 von 414" ist auch gedeckelt eine falsche Aussage.
Zähler und Nenner müssen dieselbe Menge zählen, sonst ist der Bruch keiner.

**Was unverändert bleibt.** Die Zeile in `collection_items` bleibt, nichts wird gelöscht, die
historische Beziehung bleibt bestehen, der Adminbereich sieht die Figur weiterhin — und der
**Sammlungswert zählt sie weiter mit**: Besitz ist Besitz, nur der Bruch beschreibt den
öffentlichen Katalog. Dieselbe Regel gilt seit jeher für `is_active = false`; verborgen und
zurückgezogen werden gleich behandelt und getrennt ausgewiesen (`hiddenOwned`, `inactiveOwned`).

**Konsequenz.** `owned > total` kann durch diese Funktion nicht entstehen.
`src/lib/collection/visibility.test.ts` prüft genau das, inklusive des Falls „alles besessen,
die Hälfte verborgen".

---

## ADR-0041 — Produktgruppen: die dritte Dimension bleibt getrennt

**Status:** ANGENOMMEN (2026-09-06)

**Entscheidung.** Der Katalog kennt künftig drei **unabhängige** Dimensionen:

| | Frage | Träger |
|---|---|---|
| A Serie | Aus welchem Spiel? | `skylanders.series_code` |
| B Produktgruppe | Was für ein Objekt ist das? | `categories.catalog_group` |
| C Variante | Reguläre Ausgabe oder Legendary/Dark/…? | **nicht gebaut** |

**B liegt auf der Kategorie, nicht auf der SKY-ID.** Der Audit vom 2026-09-06 hat alle 561
aktiven Sammelobjekte geprüft: Jede der 24 Kategoriezeilen (20 verschiedene Namen) fällt
**vollständig** in genau eine Produktgruppe; keine mischt zwei. Damit klassifizieren 24
Entscheidungen 561 Objekte. Ein SKY-ID-Override wird **nicht vorsorglich** gebaut — er wäre eine
zweite Wahrheit ohne Fall. Tritt je eine echte Ausnahme auf, lässt er sich additiv ergänzen.

**Das Vokabular** (zehn Werte, CHECK statt Enum, damit später erweiterbar):
`figure` · `giant` · `swapper` · `trap_master` · `sensei` · `vehicle` · `trap` ·
`creation_crystal` · `mini` · `item`.

Sidekicks und Minis sind **eine** Gruppe (`mini`): dieselbe Produktart unter zwei Legacy-Namen.
Die genaue Legacy-Kategorie bleibt in `categories.name` erhalten.

**Drei Kategorien tragen Varianten- statt Produktinformation** und gehören trotzdem zu
`figure`: `Varianten & LightCore` (SF, 27), `Giants Series 2 Figuren` (39) und
`Trap Team Series Figuren` (6). Was sie benennen — eine Ausführung, eine Neuauflage — ist
Dimension C.

**`NULL` ist ein Zustand, kein Standard.** Eine später vom Legacy-Projekt angelegte Kategorie
kommt unklassifiziert an, bleibt unter „Alle" sichtbar und wird **niemals** automatisch `item`.
Keine Namensheuristik, nirgends: die Zuordnung ist einmal redaktionell in der Migration
festgeschrieben, wie `data/characters/characters.json`.

**B sagt nichts über Completion.** `catalog_group = 'vehicle'` heißt „das ist ein Fahrzeug" —
nicht „das ist optional". Ein Fahrzeug ist kein Special, eine Falle ist kein Special, ein
Kreationskristall ist kein Special; umgekehrt kann ein Trap Master sehr wohl eine
Special-Ausgabe haben. Der Katalog enthält „Legendary Hand of Fate" — ein **Item** mit
Legendary-Ausführung — und das ist der Beleg aus echten Daten, dass B und C nicht
zusammenfallen. Completion bleibt bis auf Weiteres: jedes aktive, sichtbare Sammelobjekt zählt.

**Nicht in dieser Phase:** `variant_kind`, `is_special`, `completion_class`, Specials-Filter,
automatische Variantenerkennung — und die öffentliche zweite Tab-Leiste. Die Datenbasis
entsteht jetzt, die UI ist ein eigener Schritt.

**Gemessene Verteilung (2026-09-06):** figure 261 · trap 57 · sensei 46 · item 44 · vehicle 31 ·
trap_master 28 · creation_crystal 27 · mini 27 · swapper 26 · giant 14 = **561**.

### Nachtrag 2026-09-06 — die zweite Navigationsebene ist gebaut

**Untertabs unter den Serien.** `Alle · Figuren · Trap Masters · Fallen · Minis · Items` — je
Serie nur, was diese Serie wirklich enthält. Nichts davon ist pro Serie hinterlegt: `groupTabs()`
leitet die Tabs aus den geladenen Figuren ab, die globale Reihenfolge und die deutschen Labels
stehen zentral in `src/lib/catalog/group.ts`. Eine später korrekt klassifizierte Kategorie
bekommt ihren Tab, ohne dass UI-Code sich ändert. Hat eine Serie nur eine Gruppe, erscheint die
Leiste gar nicht — ein Bedienelement ohne Wahl ist keins.

**Product Group ist eine Navigationsebene, keine vierte Filterpipeline.** Sie verengt denselben
Pool, den schon der Besitzfilter verengt; Suche und serienübergreifende Suche lesen diesen Pool
und erfahren nie, dass es sie gibt. Damit gilt automatisch: `Trap Team` + `Fallen` + Suchbegriff
sucht serienübergreifend nur unter Fallen, und Abschnitte ohne Treffer entfallen wie bisher.

**Serienwechsel setzt auf `Alle` zurück.** `trap` von Trap Team nach SuperChargers mitzunehmen
hieße, auf einem Filter zu landen, den es dort nicht gibt — ein leeres Raster ohne sichtbaren
Grund.

**Zahlen neben den Tabs beschreiben die Serie, nicht die Ansicht.** Gezählt wird vor Suche, vor
Besitzfilter und vor der Gruppe selbst, aus dem bereits geladenen Katalog — keine Abfrage je Tab.
Wessen Katalog gezählt wird, entscheidet die Rolle: die Adminansicht enthält verborgene Figuren,
die öffentliche nicht, und beide zählen genau das, was sie zeigen.

**`NULL` bleibt unter `Alle`.** Eine unklassifizierte Figur zählt dort mit, bekommt keinen
eigenen Tab und wird nie zu `item`.

**Eine Leiste für beide Rollen.** Kein `AdminProductGroupTabs`. Was sich zwischen Sammler und
Admin unterscheidet, ist der geladene Katalog — nicht die Navigation darüber.

**Der Zustand bleibt clientseitig**, wie Serie und Suche seit ADR-0026. `?group=` wird — genau wie
`?series=` und `?q=` — nur *gelesen*, um die Ansicht nach einer Anmeldung wiederherzustellen
(ADR-0027), und nicht bei jedem Klick geschrieben. Eine URL-getriebene Katalognavigation wäre
eine eigene Entscheidung, keine Nebenwirkung dieser.

---

## ADR-0042 — Der Adminbereich ist der Katalog: rollenbasierte Verwaltung im Kontext

**Status:** ANGENOMMEN (2026-09-06)

**Entscheidung.** Der Geschäfts-Admin arbeitet **auf derselben Website** wie jeder Sammler. Der
Katalog `/` bleibt eine Route, eine Datenbasis, eine Komponente — und trägt für ein Adminkonto
zusätzliche redaktionelle Werkzeuge genau dort, wo die Daten stehen. `/admin` bleibt die
Zentrale für Übersicht, verborgene Einträge, Kategorien, Historie und alles Spätere; der
Katalog ist der schnelle Editor.

**Eine Karte, zwei Interaktionsschichten.** Es gibt **keine** `AdminCatalogCard`. `FigureCard`
zeigt weiterhin Bild, Name, Preis, Serie, Element, Layout und Verhalten für alle gleich; sie hat
dafür Steckplätze bekommen (`nameSlot`, `statusBadge`, `interactive`, `muted`) und weiß von
Rollen nichts. `CatalogCard` verzweigt **einmal**, in sich:

| | Sammler | Admin |
|---|---|---|
| Kartenkörper | Umschalter „gesammelt" | statisch — kein Tap-Ziel |
| Name | Text | Inline-Editor mit Stift |
| Fuß | `Info` | `Verbergen`/`Anzeigen` + `Details` |
| Besitzrahmen, Krone | ja | nein |

**Warum der Kartenkörper im Adminmodus nichts auslöst.** „Tap auf die Figur = verbergen" wäre auf
einem Telefon ein Fehlgriff vom öffentlichen Katalog entfernt — die Karte ist genau das, worauf
der Daumen beim Scrollen landet. Stattdessen ein benanntes Bedienelement in Kartenbreite, mit
`aria-pressed` und einem ausformulierten `aria-label`; die kurze Beschriftung passt auf eine
Zeile bei 390 px.

**Verborgene Figuren bleiben für den Admin im Katalog.** Sonst könnte er eine Figur verbergen und
sie dort nie wieder finden. Umgesetzt als **ein** ausgelassener Filter:
`fetchCatalog({ includeHidden })` lässt `catalog_visible` weg — und sonst nichts. `is_active` und
der Softwareausschluss gelten weiter. Adminmodus heißt „der Sammlerkatalog einschließlich seiner
redaktionell verborgenen Einträge", **nicht** „jede technische Zeile aus `skylanders`". Die Karte
ist abgedunkelt und trägt den Chip „Verborgen"; die RLS für normale Nutzer bleibt unangetastet
(ADR-0039), sie sehen sie schlicht nicht.

**Der Katalog ist für den Betreiber keine Sammlung.** Businesskonto = Betreiber, privates Konto =
Sammlung (ADR-0032). Im Adminmodus entfallen daher die Sammlungsaktion auf der Karte, der Filter
„Besitz anzeigen" und der Besitzrahmen; die Navigation bietet **Katalog · Admin · Profil** statt
„Sammlung". Die Sammlungsseite selbst bleibt unverändert bestehen und erreichbar — sie wird nur
nicht mehr angeboten. Der Platz, den „Sammlung" freigibt, ist der, an dem später „Lager" steht;
ein Link auf eine nicht gebaute Seite wäre schlechter als kein Link.

**Keine zweite Mutationsebene.** Inline-Umbenennen und Sichtbarkeit rufen exakt die Server
Actions aus `src/lib/admin/actions.ts` auf, die schon `/admin/catalog/[skyId]` benutzt, und die
rufen dieselben `security definer`-Funktionen mit `is_shop_admin()` (Migration `0004`). Die
Oberfläche ist Bequemlichkeit; entschieden wird in der Datenbank. Funktional nachgewiesen: ein
normaler Nutzer bekommt auf beide RPCs `not authorized`, anonym `permission denied for function`
— unabhängig davon, was das UI rendert.

**Die Rolle kommt vom Server.** `isAdmin()` → `public.is_shop_admin()`, je Anfrage memoisiert,
gelesen in Seite und Layout. Keine E-Mail-Prüfung, keine User-ID im Code, kein Claim aus dem
Browser, keine zweite Rollenquelle.

**Sichtbar, aber nicht laut.** Ein goldener Chip „Admin" neben der Wortmarke, Stiftsymbole an
bearbeitbaren Namen, der Status auf der Karte. Kein zweites Design, keine Backend-Optik — die
Vitrine bleibt eine Vitrine.

**Nicht in dieser Runde:** Bild-Upload und Storage (die Karte ist aber so geschnitten, dass eine
Aktion am Bild dazukommen kann), `element_override`, Varianten/Specials, öffentliche
Produktgruppen-Untertabs, Lager-/Shopverwaltung, Bestellungen.

### Nachtrag 2026-09-06 — Lagerverwaltung Phase 1 (zu ADR-0037)

**Der Betreiber verwaltet Lager, keine Sammlung.** `/admin/inventory` ist ein eigenes Ziel in der
Hauptnavigation (`Katalog · Lager · Admin · Profil`), keine umbenannte Sammlungsseite. Der
Navigationseintrag hat dieselbe Bedingung wie jeder andere — `viewer.admin` — und ersetzt nichts.
`collection_items` bleibt vollständig unberührt; Lagerbestand wird niemals darüber modelliert.

**Was `0003` schon konnte und `0005` ergänzt.** Die Schreibfläche war vollständig:
`record_inventory_movement()` legt die Position mit ihrer ersten Bewegung an, prüft
`is_shop_admin()` und schreibt `auth.uid()` als Akteur; `set_shop_listing()` setzt Preis,
Angebot und Notiz, ohne Bestand anzufassen; negative Bestände und `reserved`-Unterschreitungen
wehrt `apply_inventory_movement()` in derselben Transaktion ab. **Gefehlt hat der Lesezugriff** —
Clients haben auf beiden Tabellen keinerlei Rechte, und die Abstimmungs-View ist
`security_invoker`. `0005` fügt genau zwei Lesefunktionen hinzu, sonst nichts.

**Bestand ändert sich nur durch Bewegungen.** Die Oberfläche bietet kein Zahlenfeld über
`quantity`: eine Zuweisung verlöre Grund, Notiz und Kosten und ließe das Journal von der Summe
abweichen. `initial_import` steht Administratoren **nicht** zur Auswahl — der Wert gehörte zur
einmaligen Legacy-Eröffnung und wird von Serverwerkzeugen über eine Funktion gebucht, die kein
Client ausführen darf. Die sechs übrigen Gründe sind wählbar, Stückkosten nur beim Einkauf.

**Reserviert bleibt systemverwaltet.** Anzeigen ja, bearbeiten nein — Reservierungen entstehen
später beim Checkout. `available = quantity − reserved` kommt aus der gespeicherten Spalte, nicht
aus einer zweiten Rechnung.

**Preis und Angebot sind getrennt von Bestand und vom Marktpreis.** `sale_price` ist der
SkyIsles-Preis, `skylanders.market_price` bleibt Referenz; keiner leitet sich vom anderen ab.
`is_listed` folgt niemals automatisch dem Bestand: „gelistet, aber ausverkauft" und „auf Lager,
bewusst nicht angeboten" sind beides gültige Zustände.

**Der Umfang der Liste kommt aus dem Katalog, nicht aus Namen.** Die operative Übersicht zeigt
Positionen zu **aktiven, sammelbaren** Figuren. Software (Kategorie `Spiele`, ADR-0029) und die
alte Verifikations-Fixture `SKY-9998` (inaktiv) fallen dadurch heraus, ohne dass ein Name
geprüft wird; ihre Daten bleiben unangetastet und werden als „historische Positionen außerhalb
des Sortiments" nur gezählt. SWAP-Hälften existieren im Katalog gar nicht — sie wurden nie
importiert.

**Die Historie ist sichtbar und unveränderlich.** Die Karte zeigt die jüngsten Bewegungen und
bietet weder Löschen noch Bearbeiten; es gibt auch keine Funktion dafür. Eine falsche Buchung
wird durch eine `correction` ausgeglichen. Legacy-Bestand ohne belegbare Stückkosten behält
`unit_cost = NULL` — das ist die richtige Aussage, keine Lücke.

**Nicht in Phase 1:** Bestellungen, Warenkorb, Checkout, Zahlung, Versand, Kundenverwaltung,
eBay-Anbindung, Reservierungs-UI, Coupons, automatische Preisbildung, FIFO oder
Durchschnittskosten, Steuerbewertung.

---

## ADR-0043 — Öffentliches Angebot als Projektion, Warenkorb lokal im Browser

**Status:** ANGENOMMEN (2026-09-06)

**Entscheidung.** Der Shop wird öffentlich sichtbar — aber nur als **Angebot**, nicht als Lager.
Die einzige öffentliche Lesefläche auf `shop_inventory` ist die Funktion `public.shop_offers()`
(Migration `0006`). Sie gibt genau vier Werte zurück:

| Wert | Bedeutung |
|---|---|
| `sky_id` | welcher Artikel |
| `condition` | `loose` oder `boxed` |
| `sale_price` | der SkyIsles-Preis |
| `available` | **boolescher** Wert: kaufbar ja/nein |

**Warum eine Funktion und kein Tabellenrecht.** Ein `grant select` ist spaltenblind, und RLS
filtert Zeilen, nicht Spalten — empirisch belegt am Katalog. Ein Recht auf `shop_inventory`, das
den Preis freigibt, gibt im selben Atemzug `quantity`, `reserved` und `note` frei. Die Funktion
ist `security definer`, die Tabellen behalten für `anon` und `authenticated` **keinerlei** Rechte,
und es wird keine Policy hinzugefügt.

**`available` ist ein Ja/Nein, keine Stückzahl.** „Noch 3 Stück" ist ein Lagerstand, „auf Lager"
ist eine Angebotsaussage. Die Stückzahl veröffentlichen hieße, das Lager zeilenweise zu
veröffentlichen (docs/SECURITY.md).

**Was ein Angebot ist.** Ausschließlich `is_listed`. Eine Lagerposition ist kein Angebot: Bestand
ist etwas, das der Betreiber hat, ein Angebot etwas, das er verkaufen will (ADR-0037). Der
CHECK `shop_inventory_listed_needs_price` garantiert bereits, dass ein gelistetes Angebot einen
Preis hat — „gelistet ohne Preis" ist kein Fall, den der Aufrufer behandeln muss.
**Überholt:** dieser CHECK ist mit `0007` entfallen und die Freigabe ist seit ADR-0048 vom Preis
getrennt; „freigegeben ohne Preis" ist ein gültiger Zustand, den `shop_offers()` ausfiltert. **Gelistet mit
0 verfügbar** liefert weiterhin eine Zeile mit `available = false` und zeigt „Nicht auf Lager";
Schweigen wäre die schlechtere Auskunft.

**Was nie ein Angebot bekommt.** Der Katalogfilter in der Funktion: `is_active`,
`catalog_visible` und die Kategorieregel aus ADR-0029. Software fällt darüber heraus,
redaktionell verborgene Figuren ebenso, die aufbewahrten Audit-Fixtures sind inaktiv, und
SWAP-Hälften existieren im Katalog gar nicht. Die Kategorieliste steht als
`public.non_collectible_categories()` **einmal** in der Datenbank und spiegelt
`src/lib/catalog/collectible.ts`; `src/lib/shop/offer.test.ts` liest beide Dateien und stellt
sicher, dass sie dieselben Namen nennen, `npm run verify:shop` prüft dasselbe gegen die laufende
Datenbank.

**Ein Aufruf für den ganzen Katalog.** `shop_offers()` hat keine Argumente und keine
Paginierung. Der Katalog dekoriert 561 Karten daraus, der Warenkorb prüft eine Handvoll Zeilen
dagegen; eine Abfrage pro Karte wären 561 Anfragen auf eine Frage mit einer Antwort. Die Liste
umfasst höchstens einige hundert Zeilen.

**Zwei Preise bleiben zwei Preise.** `market_price` ist Referenzwert, `sale_price` ist Angebot
(ADR-0033). *(Überholt vom V7-Nachtrag am Ende dieser Datei: der Markenname steht nicht mehr
auf der Karte, und das Angebot ist eine Aktion in der Fußzeile statt einer Zeile unter dem
Marktwert.)* Auf der Karte stand der SkyIsles-Preis **unter** dem Marktwert und nannte seine
Quelle — „SkyIsles 9,90 €" neben 14,00 € liest sich als zwei Aussagen, eine nackte zweite Zahl
als Korrektur der ersten. „ab 9,90 €" erscheint nur, wenn die kaufbaren Angebote wirklich
unterschiedlich teuer sind; `loose` und `boxed` zum selben Preis ist ein Preis.

**Keine zweite Karte, keine zweite Pipeline.** `FigureCard` bekommt einen Steckplatz
(`offerSlot`) und weiß von Angeboten nichts, `CatalogCard` füllt ihn. Es gibt keinen zweiten
Katalog, keine zweite Kartenkomponente und keinen zweiten Datenweg. Der Adminmodus zeigt **keine**
Angebotszeile: der Betreiber sieht und ändert den Preis in `/admin/inventory`, und eine zweite
Stelle, die einen Preis nennt, ihn aber nicht ändern kann, wäre eine Stelle zu viel (ADR-0042).

### Der Warenkorb (V1)

**Der Warenkorb liegt im Browser.** `localStorage`, ein Modul-Store, kein Tabelle, kein Konto,
keine Server-Action. Anonym füllbar. Er verändert **nichts** an `shop_inventory`,
`inventory_movements` oder `reserved`.

**Warum nichts reserviert wird.** Reservieren ist ein Versprechen. Ein Versprechen, das niemand
einlösen kann — es gibt keinen Checkout und keine Zahlung —, nähme Ware für die Lebensdauer eines
Browsertabs aus dem Regal. Reservierungen entstehen später beim Checkout, wofür `reserved` schon
existiert (ADR-0037).

**Identität einer Zeile ist `sky_id + condition`** — dieselbe Identität wie die einer
Lagerposition und wie die eines Angebots. Eine Regel, drei Orte.

**Die Serverdaten gewinnen.** Eine Zeile speichert zusätzlich einen Anzeige-Schnappschuss (Name,
Bild) und den Preis beim Hinzufügen. Der gespeicherte Preis wird **nie** ausgegeben: gerechnet
wird immer mit `shop_offers()` von heute; der alte Preis dient nur dem Hinweis „Preis geändert".

**Nichts verschwindet ungefragt.** Eine ausverkaufte oder ausgelistete Zeile bleibt sichtbar, mit
Begründung, und zählt nicht zur Summe. Ein Warenkorb, der stillschweigend löscht, was jemand
gewählt hat, lügt über diese Wahl.

**Das Symbol steht im Header, nicht in der Leiste.** Die Hauptnavigation nennt Orte — Katalog,
Sammlung, Konto; ein Warenkorb ist kein Ort, sondern etwas, das man trägt. Auf dem Telefon hat
die untere Leiste vier gleich breite Daumenziele, ein fünftes würde alle verkleinern. Für ein
Adminkonto wird das Symbol nicht angeboten: SkyIsles kauft nicht bei sich selbst (ADR-0042).

**Nicht in dieser Runde:** Checkout, Bestellungen, Zahlung, Versand, Reservierung,
serverseitiger Warenkorb, Kontobindung des Warenkorbs, Rabatte, Coupons, Mengenrabatte,
Versandkosten, Steuerausweis.

---

## ADR-0044 — Der Legacy-Anfangsbestand wird einmal gebucht, nicht geschrieben

**Status:** ANGENOMMEN (2026-09-06)

**Entscheidung.** Der bestehende Geschäftsbestand aus `../webpage/skylanders.xlsx` wird als
**Eröffnungsbuchung** ins SkyIsles-Lager übernommen: eine `initial_import`-Bewegung je Position,
gebucht über `system_record_inventory_movement()`. Es wird **kein** `quantity` direkt geschrieben.
Werkzeug: `tools/import-legacy-inventory.mts`, Dry Run als Standard, `--apply` schreibt.

**Nur Spalte F, und nur die sechs Serienblätter.** Gelesen werden A (SKY-ID), B (Name, nur für
den Bericht), D/E (nur zur Prüfung von D − E = F) und F (Geschäftsbestand). Die Blätter werden
über eine **Positivliste** geöffnet: ein Blatt wird gelesen, weil PortalVault eine Serie dieses
Namens kennt — `Order 2026/2025` und `EÜR 2026/2025` werden dadurch nie erreicht, nicht bloß
übersprungen. Die privaten Spalten P–S (Privatsammlung) und U–X (Privatwerte) werden nirgends
gelesen. Der Kopf der Blätter wird vor dem Import geprüft; eine eingefügte Spalte bricht den Lauf
ab, statt „verkauft" als Bestand zu importieren.

**Identität ist ausschließlich die SKY-ID.** Keine Namensheuristik, kein Fuzzy-Matching, keine
Kategoriezuordnung aus Namen (CLAUDE.md, Regel 2). Eine unbekannte SKY-ID wird gemeldet und nicht
angelegt.

**Alles wird als `loose` gebucht — als benannte Annahme, nicht als erfundene Präzision.** Die
Arbeitsmappe kennt **keine** Verpackungsspalte, kein Kennzeichen und keine Relation; geprüft über
alle sechs Blätter. Von 218 Bestandszeilen im Sortiment trägt **genau eine** überhaupt einen
Verpackungshinweis im Namen (`SKY-0049 "Elite Slam Bam - ohne OVP"`), und die ist bereits eine
eigene SKY-ID mit identischem Katalognamen. Wo die Legacy-Daten Verpackung unterscheiden, tun sie
es also über die SKY-ID. Eine spätere Korrektur auf `boxed` sind zwei gewöhnliche Bewegungen im
Adminbereich — genau wofür das Journal da ist.

**Was der Import nicht setzt.** `unit_cost` bleibt NULL — die Systemfunktion hat überhaupt keinen
Kostenparameter, das ist eine Eigenschaft der Datenbank und nicht des Skripts. `sale_price` bleibt
NULL und `is_listed` bleibt `false`: Was verkauft wird und zu welchem Preis, ist eine getrennte,
manuelle Entscheidung (ADR-0037). Es gibt **keine** Ableitung aus `market_price` und keine
Prozentregel.

**Ausgeschlossen, mit Zahlen (ausgeführt am 2026-09-06).** 614 Artikelzeilen, 234 mit Bestand,
785 Stück:

| | Positionen | Stück |
|---|---|---|
| importiert (Sammlerartikel) | 218 | 762 |
| Software (ADR-0029) | 8 | 10 |
| SWAP-Hälften ohne Katalogzeile | 8 | 13 |
| aufbewahrte Audit-Fixtures | 0 | 0 |
| inaktiv | 0 | 0 |

Die acht SWAP-Hälften (`OBERTEIL`/`UNTERTEIL`, Blatt SF) haben **gar keine** Katalogzeile; sie
werden gemeldet und nicht angelegt. Der erste `--apply` buchte 218 von 218 Bewegungen bei 0
Konflikten; der zweite meldete `218 already initial-imported · 0 changes`. Gegenprobe: `webpage/data/inventory.json.available` stimmt für
alle 614 Zeilen mit Spalte F überein.

### Wiederholbarkeit ist eine Eigenschaft des Werkzeugs, nicht des Constraints

Der Lauf ist **wiederholbar**, und zwar sauber: ein zweiter identischer Aufruf bucht nichts,
ändert keinen Bestand und endet mit Exit 0 und der Zeile
`218 already initial-imported · 0 changes`. Ein Constraint-Fehler ist **kein** akzeptables
Ergebnis eines zweiten Laufs.

Entschieden wird **je Position**, aus dem Journal, nie aus einem Zähler dessen, was dieser
Prozess getan hat — es gibt keine Laufmarke, keine Datei, keinen Fortschrittsstand. Damit fallen
Idempotenz und Wiederaufnahme aus derselben Regel (`src/lib/shop/legacy-plan.ts`):

| Zustand der Position | Entscheidung |
|---|---|
| existiert nicht | **importieren** |
| existiert **und** hat eine `initial_import`-Bewegung | **überspringen** — bereits eröffnet |
| existiert **ohne** `initial_import` | **Konflikt** — nicht importieren, Mensch entscheidet |

**Der Konfliktfall ist die eigentliche Sicherheitseigenschaft.** Eine Position existiert nur,
weil jemand eine Bewegung darauf gebucht hat. „Existiert ohne Eröffnungsbuchung" heißt also:
Hier wird echter Bestand von Hand geführt. Den Legacy-Wert stumpf zu addieren würde ihn
verdoppeln — und **kein Fehler würde ausgelöst**, der Bestand wäre schlicht falsch. Er wird
deshalb im Dry Run wie im Apply namentlich gemeldet, nicht gebucht, und der Lauf endet mit
Exit 1, damit er in keinem Skript unbemerkt durchgeht.

**Erkannt wird am Journal, nicht am Lagerstand.** Eine Position, die wieder bei null steht, ist
trotzdem eröffnet. Weicht die Arbeitsmappe später vom eröffneten Wert ab, ist das eine Meldung,
kein Grund zu buchen: ab der Eröffnungsbuchung ist das Journal maßgeblich.

**Abbruch mitten im Lauf.** Jede Position ist eine eigene Transaktion (`PostgREST` führt einen
RPC in einer Transaktion aus); die 218 sind bewusst **keine** gemeinsame. Bricht ein Lauf nach
100 Positionen ab, findet der nächste genau die fehlenden 118 — dieselbe Regel, kein Sonderfall.
Eine fehlgeschlagene Position stoppt den Lauf nicht: sie wird gemeldet und beim nächsten Lauf
erneut versucht.

**Jede Lesung ist vollständig paginiert.** PostgREST liefert höchstens 1000 Zeilen und sagt
nichts über den Rest. Ein abgeschnitten gelesenes Journal ließe eine eröffnete Position
uneröffnet aussehen — genau der Fehler, den der Unique-Index dann als Constraint-Verletzung
statt als sauberen Lauf sichtbar machen würde.

**Der Unique-Index bleibt — als letzte Sicherung, nicht als Mechanismus.**
`inventory_movements_one_initial_import` macht eine zweite Eröffnungsbuchung unmöglich, auch
wenn das Werkzeug sich irrt. Ein Lauf, der sich darauf verlässt, ist ein defekter Lauf.

**Das Legacy-Projekt bleibt unberührt.** Der Reader (`tools/lib/xlsx.mts`) hat keinen
Schreibpfad — kein `writeFileSync`, kein Stream, kein Shell-Aufruf. Das ist eine stärkere Zusage
als eine Regel, die sagt, man dürfe nicht schreiben.

**Keine personenbezogenen Daten.** Weder Käuferdaten noch Bestellungen, EÜR-Zahlen, Scraper-Logik,
Mappings oder Zugangsdaten werden gelesen, geschrieben oder protokolliert. Der Bericht nennt
Artikelnamen ausschließlich dort, wo ein Mensch entscheiden muss, und nur für Geschäftsbestand.

---

## ADR-0045 — Shoppreise werden abgeleitet, nicht gepflegt

**Status:** ANGENOMMEN (2026-09-06)

**Entscheidung.** Der Preis, den der Shop verlangt, wird **berechnet**:

```
effektiver Preis = manueller Override        wenn gesetzt
                 = market_price × Prozentsatz sonst, auf Cent gerundet
                 = NULL                       wenn beides fehlt
```

Der Prozentsatz ist **eine Zahl in einer Zeile** (`shop_settings`), initial **90 %**, im Admin
änderbar. 218 Positionen einzeln zu bepreisen war die Alternative und ist keine.

**`sale_price` bleibt, ändert aber seine Bedeutung.** Die Spalte ist ab jetzt der **manuelle
Override**, nicht „der Preis". NULL heißt „kein Override, es gilt die Regel" statt „noch kein
Preis". Beide Lesarten stimmen für jede heute existierende Zeile überein, weil der Legacy-Import
sie überall NULL gelassen hat. **Keine zweite Preisspalte** — zwei Spalten mit je 18,00 € und
keiner Möglichkeit zu sagen, welche gilt, wäre genau der Zustand, den die Anforderung ausschließt.
Woher der Preis kommt, sagt `admin_shop_inventory().price_source` (`manual` / `automatic`).

**Nichts speichert einen automatischen Preis.** Deshalb kostet eine Marktpreisänderung kein
Update und eine Prozentsatzänderung kein Massenschreiben: beide wirken sofort auf alle
Auto-Positionen, weil nirgends ein abgeleiteter Wert liegt. Ein Override bleibt in beiden Fällen
unverändert — er ist eine andere Spalte.

**Die Arithmetik steht genau einmal, in der Datenbank.** `public.shop_price(override, market,
pct)` ist `immutable` und wird von der öffentlichen Projektion, der Adminliste **und** dem
Listing-Guard aufgerufen. Gerechnet wird auf `numeric`, nie auf Fließkomma; gerundet mit
`round(x, 2)` — kaufmännisch, halbe Cent von der Null weg. Die Anwendung rechnet **nicht** mit
Geld: sie liest die berechnete Zahl. Einzige, benannte Ausnahme ist die Vorschau „so viel wäre
es automatisch" auf der Adminkarte, die weder gespeichert noch verlangt wird.

**Der Mirror in der Anwendung rechnet exakt, nicht in Fließkomma.** Zwei Stellen brauchen den
automatischen Preis, ohne die Datenbank fragen zu können: die Adminkarte („was wäre es ohne
Override?") und `verify:shop` (eine unabhängige Erwartung — ein Aufruf von `shop_price()` würde
die Datenbank mit sich selbst vergleichen). Beide gehen über `automaticShopPrice()`.

Die erste Fassung multiplizierte Fließkommazahlen und war falsch: `16,65 × 90 %` ist 14,985 und
rundet auf **14,99**, aber `16.65 * 90` ist binär `1498.4999999999998`, also ergab `Math.round`
**14,98**. Gefunden hat das der Preis-Check von `verify:shop` an echten Daten — an genau einer
von 218 Positionen (`SKY-0363`). Die Datenbank war nie falsch; sie rechnet auf `numeric`.
`automaticShopPrice()` rechnet deshalb auf ganzen Zahlen: Cent × Hundertstelprozent, geteilt
durch 10 000, halbe von der Null weg — dieselbe Semantik wie `round(numeric, 2)`.

**Bereich 0 < p ≤ 500 %.** Über 100 % ist ausdrücklich erlaubt — mehr als den Referenzwert zu
verlangen ist bei Seltenem legitim, und eine Grenze bei 100 wäre eine Produktentscheidung als
Constraint getarnt. 0 ist ausgeschlossen wie beim Marktpreis (ADR-0010): kostenlos ist kein
Preis. Die Obergrenze fängt den Tippfehler ab (9000 statt 90).

**Der CHECK `shop_inventory_listed_needs_price` entfällt.** Er sagte „gelistet ⇒ `sale_price`",
was richtig war, solange `sale_price` der Preis war. Ein CHECK kann die Frage jetzt nicht mehr
beantworten — sie hängt an `skylanders.market_price` und an `shop_settings`, also an zwei
anderen Tabellen. Die Regel zieht deshalb an die zwei Stellen, die beides sehen:

* `set_shop_listing()` weist eine Listung ohne effektiven Preis ab
* `shop_offers()` liefert keine Zeile ohne effektiven Preis

Das ist **strenger** als der Constraint war: der hätte nicht bemerkt, dass ein Marktpreis nach
dem Listen gelöscht wird, die Projektion bemerkt es.

**Öffentlich bleibt es minimal.** `shop_offers()` gibt weiterhin vier Werte zurück; `sale_price`
heißt darin jetzt `price`, weil es nicht mehr die gespeicherte Spalte ist, sondern was der Shop
verlangt. Prozentsatz, Override und `price_source` sind **intern** und verlassen die Datenbank
nicht.

**Im Adminbereich heißt es „Shop-Preis", nicht „SkyIsles-Preis".** Für den Betreiber ist das
eindeutiger. Öffentlich bleibt die Marke: auf der Karte steht weiterhin „SkyIsles 9,90 €".

---

## ADR-0046 — Bilder gehören dem Admin, der Import behält seine

**Status:** ANGENOMMEN (2026-09-06)

**Entscheidung.** Ein Administrator kann das Bild einer Figur im Browser ersetzen. Es landet in
Supabase Storage, wirkt sofort überall und braucht **kein Git, kein Deploy, keine Codeänderung**.

**Drei Quellen, feste Reihenfolge:**

| | Quelle | Wem gehört sie |
|---|---|---|
| 1 | `skylanders.image_override_path` → Bucket `catalog` | dem Administrator |
| 2 | `skylanders.image_file` → `/public/images/skylanders` | dem Katalogimport |
| 3 | kein Bild → leere Bühne | 27 Sammelobjekte, ein Designzustand (ADR-0009) |

**Eine zweite Spalte, nicht eine zweite Bedeutung.** Der Import überschreibt `image_file` bei
jedem Lauf; der Override muss das überleben. Genau das macht „Eigenes Bild entfernen" zu einem
echten Vorgang statt zu einem Verlust: das importierte Bild lag die ganze Zeit darunter. **Der
Katalogimport nennt `image_override_path` nirgends** — dieselbe Trennung wie bei `character_id`
(ADR-0034) und bei den redaktionellen Spalten (ADR-0039).

**Eine zentrale Auflösung.** `src/lib/catalog/image.ts` beantwortet die Frage einmal. Vorher
bauten drei Komponenten denselben Pfad selbst zusammen — `FigureImage`, das `Thumb` der
Sammlungstabelle und `AdminThumb` —, und eine zweite Quelle hätte an drei Stellen erinnert
werden müssen. Jetzt nehmen alle Bildflächen eine fertige `src` entgegen, auch der Warenkorb,
der sie mit der Zeile speichert.

**Content-adressierte Pfade, `SKY-0007/<16 hex>.webp`.** Ein Ersatz bekommt einen **neuen** Pfad,
damit kein Browser und kein CDN das ersetzte Bild aus dem Cache weiterliefert. Der SKY-ID-Ordner
ist gleichzeitig die Zugriffsgrenze: `admin_set_image_override()` prüft, dass der Pfad zu genau
dieser Figur gehört, und ein CHECK auf der Spalte prüft die Form.

**Gemessen am 2026-09-06:** Nach dem Löschen eines Objekts liefert dessen öffentliche URL noch
eine Weile `200` aus dem CDN-Cache (`cf-cache-status: HIT`); der Speicher selbst ist leer, eine
cache-umgehende Anfrage antwortet `400`. Genau deshalb sind die Pfade content-adressiert: eine
zwischengespeicherte Kopie liegt immer unter einer URL, auf die niemand mehr verweist, und kann
das neue Bild nie verdrängen.

**Reihenfolge beim Ersetzen: hochladen → verweisen → erst dann löschen.** Nach jedem denkbaren
Fehlschlag hat die Figur ein Bild — das alte bis Schritt 2, danach das neue. Ein Fehler beim
Löschen ist bewusst **kein** Fehler des Vorgangs: eine verwaiste Datei kostet Speicher, ein
abgebrochener Vorgang kostet das Bild.

**Sicherheit.** Bucket `catalog` ist **öffentlich lesbar** — Katalogbilder sind genau so
öffentlich wie der Katalog — und **nur für Admins schreibbar**, über Storage-Policies mit dem
Prädikat `public.is_shop_admin()`. Kein Service-Role-Key im Browser, keine anonymen Uploads.
Der Dateityp wird **aus den ersten Bytes** bestimmt, nicht aus `File.type`: JPEG, PNG oder WebP,
höchstens 2 MB, dreifach begrenzt (Client, Server-Action, Bucket).

**Kein Re-Encoding in dieser Runde.** Auf WebP normalisieren, verkleinern und Metadaten
entfernen bräuchte `sharp` oder Vergleichbares — eine schwere Abhängigkeit und eine eigene
Entscheidung. Stattdessen: Typprüfung an den Bytes, harte Größengrenze am Bucket, und der
Betreiber lädt bereits passend zugeschnittene Bilder hoch. **Offen**, bewusst.

---

## ADR-0047 — `−  7  +` ist Oberfläche, kein zweiter Weg in den Bestand

**Status:** ANGENOMMEN (2026-09-06)

**Entscheidung.** Bestandskorrekturen sind zwei Tipper: ein roter `−`, die Zahl, ein grüner `+`.
Kein Dialog, kein Grund, keine Notiz, keine Bestätigung. Der bisherige ausführliche Dialog bleibt
vollständig erhalten und heißt jetzt **„Weitere Buchung"**.

**Am Audit-Trail ändert sich nichts.** Jeder Tipp ist ein gewöhnlicher Aufruf von
`record_inventory_movement()` mit `delta = ±1` und `reason = 'correction'`: Bestand und
Journalzeile in einer Transaktion, Akteur aus `auth.uid()`, Journal append-only, `quantity` wird
nie zugewiesen (ADR-0037). Die Knöpfe sind eine schnellere Art, denselben Satz zu sagen — kein
zweiter Weg, Bestand zu ändern.

**`correction` statt einer neuen Kategorie.** Der Constraint erlaubt sie in beide Richtungen, sie
trägt keine Kostenbasis, und „ich habe nachgezählt" ist genau ihre Bedeutung. Eine Reason nur für
ein Bedienelement zu erfinden hätte das Journal um eine Unterscheidung erweitert, die fachlich
keine ist.

**Schnelles Mehrfachtippen.** Dem Server wird ein **Delta** genannt, kein Zielwert: zwei
gleichzeitige Anfragen können sich nicht überschreiben, und in der Datenbank serialisieren sie
ohnehin am `select … for update` in `apply_inventory_movement()`. Deshalb wird jeder Tipp sofort
gesendet, ohne Debounce und ohne Warteschlange. Auf dem Bildschirm hält `useOptimistic` die Summe
der noch offenen Tipper und lässt sie genau dann fallen, wenn der aktualisierte Serverwert da
ist — kein Effekt, kein manueller Abgleich, kein Zurückspringen.

**Die Untergrenze ist `reserved`, nicht 0.** `reserved` ist nie negativ, also deckt die Regel
beides ab. Der `−`-Knopf wird dort inaktiv — das spart eine Anfrage und erklärt sich selbst —,
**ersetzt aber die Prüfung nicht**: `apply_inventory_movement()` weist die Buchung ab, und deren
Meldung ist die, die zählt.

**Was auf der Karte verschwunden ist.** `Reserviert` wird nur noch gezeigt, wenn es nicht null
ist; in V1 schreibt es nichts, und eine Spalte voller Nullen auf jeder Karte sagt nichts.


### Nachtrag 2026-09-07 — Katalog-UX V7 (zu ADR-0038, ADR-0042 und ADR-0043)

Drei Verfeinerungen bestehender Entscheidungen. Keine neue ADR: die Regeln darunter bleiben,
was sie waren.

**Der Besitzfilter hat drei benannte Zustände: `Alle · Besitz · Fehlen`** (ersetzt „Besitz
anzeigen" aus ADR-0038, V4.3). Der Umschalter war hervorgehoben, **während** Besitz verborgen
war — er leuchtete, um zu sagen, dass er ausgeschaltet ist. Das war damals bewusst so begründet
(„aus ist der Zustand, der die Liste verändert"), liest sich aber invertiert, weil ein
hervorgehobenes Bedienelement im ganzen Produkt sonst heißt: *das siehst du gerade*. Mit drei
Zuständen stellt sich die Frage nicht — genau einer ist hervorgehoben, und es ist immer der,
der beschreibt, was auf dem Bildschirm steht.

Vorgabe ist `Alle`, nichts wird gespeichert (kein `localStorage`, kein Cookie, kein
URL-Parameter), also gibt es auch nichts zu migrieren: der alte Zustand lag nie irgendwo.
Der Filter verengt **denselben Pool** wie Serie, Produktgruppe und Suche — deshalb funktionieren
alle Kombinationen, ohne dass eine von ihnen von den anderen weiß. Angeboten wird er nur einem
angemeldeten Sammler: anonym gibt es keine Antwort darauf, und der Betreiber sammelt nicht aus
dem Katalog, den er verwaltet (ADR-0042). Abwesend, nicht deaktiviert.

**Marktpreis ist Information, das Angebot ist eine Aktion.** Beide standen untereinander im
selben Block der Karte, in derselben Größe, und sind nicht dieselbe Art von Aussage. Der
Marktwert bleibt, wo Information steht, und bekommt den Elementchip als ruhiges Statusfeld an
die rechte Seite derselben Zeile. Der Kauf zieht nach unten in die Aktionsreihe, aus den
vorhandenen `--accent`-Tokens — kein neuer Farbwert. *(Größe und Form davon präzisiert der
V9-Nachtrag am Ende dieser Datei: eine kompakte Pille statt eines Knopfes über die volle
Breite.)*

Auf dem Knopf steht **kein Markenname** mehr: „SkyIsles 4,49 €" sagte in einem Wort, was die
Website ohnehin sagt. Nur Preis und Warenkorbsymbol.

**Im Sammlerkatalog erscheint nur, was wirklich kaufbar ist.** Kein deaktivierter Knopf, kein
„Nicht auf Lager", keine ausgegraute Fläche — bei einem Angebot ohne Bestand erscheint gar
nichts. Der Katalog ist zuerst ein Katalog von Objekten (ADR-0025); Ausverkauft- und
Listing-Status gehören auf eine eigene Shop-Fläche, später. Eine kaufbare Kondition kauft mit
einem Tipp; zwei zu verschiedenen Preisen zeigen „ab 4,49 €" und fragen beim Druck nach dem
Zustand, weil die Warenkorb-Identität `sky_id + condition` ist (ADR-0043) und Raten den falschen
Artikel in den Korb legte. Zwei Konditionen zum selben Preis bleiben ein Preis.

Angebot und Besitz sind **unabhängig**: wer eine Figur besitzt, bekommt den Kaufknopf trotzdem —
ein zweites Exemplar ist eine legitime Absicht, und das Angebot ist kein Hinweis darauf, was
fehlt. Der Adminkatalog bekommt ihn nicht (ADR-0042). Kauf, Sammlungsaktion und Detailseite sind
Geschwister im Markup, nie ineinander verschachtelt — deshalb muss kein einziges Ereignis am
Weiterlaufen gehindert werden.

**Nach der Anmeldung landen alle auf dem Katalog** statt auf `/collection`; Begründung und
`returnTo`-Verhalten in `docs/AUTH.md`, Abschnitt 2.

---

## ADR-0048 — Der Shop ist Opt-out, nicht Opt-in

**Status:** ANGENOMMEN (2026-09-07)

**Entscheidung.** **Vorhandener Bestand wird angeboten, sofern niemand widerspricht.**
`shop_inventory.is_listed` bekommt den Vorgabewert `true`, und der bereits vorhandene geeignete
Bestand wird einmalig freigegeben. Das kehrt bewusst um, was ADR-0037 gesetzt hatte
(`default false`).

**Warum die Umkehr.** Bei `default false` hätte jede der 218 importierten Positionen einzeln
eingeschaltet werden müssen — und jede künftige nach ihrer ersten Buchung erneut. Das ist eine
Synchronisationsaufgabe, verkleidet als Produktentscheidung. Der Lagerbestand ist die Wahrheit;
die einzige redaktionelle Entscheidung, die es zu treffen gibt, ist der **Ausschluss** einzelner
Positionen.

**Zwei Fragen, die getrennt bleiben.**

| | Frage | Wer beantwortet sie |
|---|---|---|
| `is_listed` | Darf diese Position überhaupt angeboten werden? | der Betreiber, redaktionell |
| kaufbar | Kann sie gerade gekauft werden? | abgeleitet: Preis + Bestand + Katalogregeln |

`is_listed = true` heißt **nicht** „auf Lager". Sie waren zuletzt verknüpft: seit ADR-0045 wies
`set_shop_listing()` eine Freigabe ohne effektiven Preis ab. Damit hing „das will ich verkaufen"
an einem Preis, der noch gar nicht bekannt sein muss — eine neue Position konnte im Moment ihrer
Entstehung nicht freigegeben werden. **Die Prüfung entfällt in der Freigabe und bleibt in
`shop_offers()`**, wo sie seit derselben Migration ohnehin steht. Eine freigegebene Position ohne
Preis ist erlaubt und wird schlicht nicht angeboten, bis es einen gibt.

**Eine Regel, die sagt, was überhaupt in den Shop gehört.** `public.is_shop_eligible(sky_id)` —
aktiv, redaktionell sichtbar, sammelbar (ADR-0029, ADR-0039). Die drei Bedingungen standen
bereits inline in `shop_offers()`; sie bekommen einen Namen, **weil die einmalige Freigabe genau
dieselbe Regel benutzen muss**. Eine zweite, leicht abweichende Kopie von „welche Figuren zählen"
ist der Weg, auf dem eine Fixture oder ein Konsolenspiel in einem öffentlichen Shop landet. Sie
sagt nichts über Bestand, Preis oder Reservierungen.

**Der Vorgabewert ist nicht die Schranke.** Eine Position entsteht aus ihrer ersten Bewegung, und
dieser Insert nennt überhaupt keine Flags — damit deckt der eine Spaltenvorgabewert **jeden**
Erzeugungsweg ab: Quick Stock, ausführliche Buchung, der Systempfad des Legacy-Imports und alles
später Hinzukommende. Das ist gefahrlos, weil eine Bewegung auf Software oder eine inaktive Figur
zwar eine freigegebene Position erzeugt, `shop_offers()` sie aber weiterhin ausschließt.

**Bestand 0 schaltet nichts ab.** Verkauft sich eine Position leer, bleibt `is_listed = true` und
das Angebot verschwindet durch Arithmetik. Wird wieder eingebucht, ist es sofort wieder da —
**ohne** Aktivierung, ohne Sync, ohne zweiten Adminschritt. Nichts im Produkt setzt `is_listed`
aus einer Menge ab.

**Es gibt keinen Shop-Snapshot und keinen „Shop synchronisieren"-Knopf.** `shop_offers()` liest
`shop_inventory` live. Ein Zustand „Lager sagt 5, Shop sagt 4" ist nicht möglich, weil es nur
eine Zahl gibt.

**Freigabe gilt je Position, nicht je Figur.** Der Schlüssel bleibt `(sky_id, condition)`: `loose`
kann angeboten und `boxed` ausgeschlossen sein. Es gibt kein figurenweites Flag.

**Die einmalige Aktivierung ist eng geschnitten.** Sie setzt ausschließlich `true`, nur wo
`is_shop_eligible()` gilt, nur wo noch nicht freigegeben (also idempotent), und rührt weder Menge
noch Reservierung, Preis, Bewegung noch Sammlungsdaten an. **Ein Opt-out wird nie überschrieben** —
eine Migration setzt keine Entscheidung außer Kraft. Freigabe ist keine Bestandsbewegung und wird
nicht als solche journalisiert; die Abstimmung `SUM(delta) = quantity` bleibt unberührt.

**Auditierbarkeit.** `is_listed` wird weiterhin **nicht** einzeln journalisiert — das
redaktionelle Journal deckt Katalogfelder ab (ADR-0039), und `inventory_movements` ist für Mengen
da. Dafür gibt es `admin_shop_listing_audit()`: je Position die Freigabe, die Eignung und, wenn
sie fehlt, den Grund. `npm run verify:shop` druckt die Übersicht und prüft, dass jede geeignete
Position freigegeben ist oder bewusst ausgeschlossen wurde.

**Im Adminbereich heißt es „Im Shop" / „Nicht im Shop"** statt „Gelistet". Bei Freigabe ohne
Bestand steht daneben „Aktuell ausverkauft", ohne Preis „Kein Shop-Preis" — beides erklärt, warum
nichts verkauft wird, **ohne** den Schalter abzudunkeln, der ja an ist.

**Unverändert:** Sicherheit (kein Client-Recht auf `shop_inventory`, Freigabe nur über
`set_shop_listing()` mit `is_shop_admin()`), die öffentliche Projektion (vier Werte, nie eine
Stückzahl), der Warenkorb (lokal, keine Reservierung, Serverdaten gewinnen) und der abgeschlossene
Legacy-Import.


### Nachtrag 2026-09-07 — Kartengeometrie und mobiler Warenkorb, V9 (zu ADR-0038 und ADR-0043)

Reine UX-Verfeinerung, keine Architekturänderung — deshalb kein eigener ADR.

**Jede Sammlerkarte hat dieselbe Geometrie, unabhängig davon, ob sie kaufbar ist.** Vorher machte
ein vorhandenes Angebot die Karte um eine Knopfhöhe länger, also lagen Name, Preis, Element und
`Info` bei zwei Karten derselben Zeile auf verschiedenen Höhen. Die Karte hat jetzt feste Zonen:
Bild · Name · Informationszeile (Marktpreis links, Element rechts) · **Fußzeile**.

**Die Fußzeile ist eine Zeile, und sie ist immer da.** Links `Info`, rechts der Kauf, falls es
einen gibt:

```
[ ⓘ Info                                🛒 4,49 € ]
[ ⓘ Info                                          ]
```

Die erste Fassung von V9 trennte beides — eine eigene 40-px-Aktionszeile und darunter ein
zentrierter `Info`-Link. Das kostete jede Karte 40 px und stellte zwei Dinge auseinander, die
zusammengehören. Die Zeile wird **bedingungslos** gerendert und bringt ihr eigenes `min-h-10`
mit; es gibt nirgends ein `offer ? … : …` in der Geometrie, und der Rand darüber ist konstant.
Deshalb sind eine kaufbare und eine nicht kaufbare Karte exakt gleich hoch. `justify-between` mit
`Info` als erstem Kind hält den Link links, auch wenn rechts nichts steht.

`FigureCard` hat dafür nur noch **einen** Fußzeilen-Slot; die V9-Unterscheidung
`offerSlot === undefined | null | Knoten` ist entfallen, weil der Kauf jetzt im Fuß sitzt. Die
Sammlung behält ihren eigenen Fuß (die Entfernen-Aktion), die verwandten Figuren neben einer
Detailseite haben gar keinen — beide bleiben damit kompakter, wie vorgesehen.

**Der Kauf ist eine kompakte Pille, rechtsbündig:** Warenkorbsymbol und Preis, 40 px hoch, so
breit wie ihr Inhalt. Kein Wort dazu — „Kaufen", „Shop" oder der Markenname wiederholten alle nur
den Kontext. Ist nichts kaufbar, bleibt rechts einfach nichts: **kein** deaktivierter Knopf, kein
„Ausverkauft", kein Platzhalter.

**Der Zustandswähler öffnet über der Fußzeile**, nicht in ihr — an deren Unterkante verankert.
In der Zeile würde er entweder `Info` zusammendrücken oder die Karte höher machen als ihre
Nachbarn; als Panel bewegt sich die Geometrie überhaupt nicht.

**`Info` ist ein Link, kein Knopf** — links unten, mit Icon, `text-xs font-medium`, 40 px
Trefferfläche und `shrink-0`, damit er den Kauf nie aus der Zeile drängt. Vorher war das
Unwichtigste auf der Karte ihre schwerste Form; die zentrierte V9-Zwischenstufe war dann fast
unsichtbar.

**Ein schwebender Warenkorb auf dem Telefon.** Der Header rollt nach der ersten Kartenreihe weg;
wer über hundert Figuren scrollt und drei einlegt, musste zum Prüfen nach oben zurück. Der
schwebende Zugang führt nach `/cart` und liest denselben Store wie das Header-Symbol: kein
zweiter Warenkorb, kein Provider, kein Serveraufruf. Montiert **einmal**, in der Navigation,
nicht von jeder Seite einzeln. Nur unterhalb `md:` (darüber steht der Header ohnehin), nicht für
den Betreiber (ADR-0042) und nicht auf `/cart` selbst.

*Form und Sichtbarkeit präzisiert der V10-Nachtrag am Ende dieser Datei: ein runder Knopf statt
einer Pille, immer sichtbar statt nur mit Inhalt.*


### Nachtrag 2026-09-07 — Warenkorb-Feedback und runder Zugang, V10 (zu ADR-0043)

Reine UX-Verfeinerung, keine Architekturänderung — deshalb kein eigener ADR. Der Warenkorb bleibt
lokal: `localStorage`, ein Store, `useSyncExternalStore`, keine Reservierung, kein Checkout.

**Der Kaufknopf benennt sich nicht mehr um.** Er zeigte nach dem Tippen kurz „Im Warenkorb" und
sagte damit zweierlei Falsches: ein Bedienelement, das immer dasselbe tut, sah aus, als täte es
zwei Dinge, und es behauptete auf dem Knopf etwas über den Inhalt des Warenkorbs, den er nicht
kennt. Vorher, während und nachher steht dort derselbe Preis. Ein weiterer Tipp erhöht wie bisher
die Menge.

**Bestätigt wird in einem Toast.** „✓ Zum Warenkorb hinzugefügt" mit einer kleinen Zeile
darunter (`Bash · Lose · 4,49 €`); war die Zeile schon im Korb, heißt es „Menge im Warenkorb
erhöht" mit `2× Bash · Lose`. Welcher der beiden Fälle vorliegt, wird **aus dem bestehenden
Store** gelesen — die Zeile wird vor dem Hinzufügen gesucht —, nicht aus einem zweiten Zähler.

**Ein Toast, kein Stapel.** `src/lib/cart/toast.ts` ist ein Modul-Store derselben Bauart wie der
Warenkorb und hält **eine** Nachricht; ein neuer Zugang ersetzt sie und startet die Zeit neu.
Der Timer liegt **im Store**, nicht in der Komponente: damit ist die Komponente ein reiner Leser
ohne Effekt, es gibt nichts aufzuräumen, und kein Timer kann eine Nachricht überleben, zu der er
nicht mehr gehört. Sichtbar 2,6 s, verschwindet von selbst, blockiert nichts
(`pointer-events-none`), ist kein Dialog und braucht keinen Schließen-Klick.

**Die Live-Region steht dauerhaft im Baum**, nur ihr Inhalt wechselt: `role="status"`,
`aria-live="polite"`. Eine Region, die gleichzeitig mit ihrer Nachricht entsteht, wird nicht
zuverlässig vorgelesen. Keine Animation — damit ist `prefers-reduced-motion` trivial erfüllt.

**Kein „Warenkorb ansehen"-Link im Toast** (geprüft und verworfen): er machte das Element auf
390 px spürbar größer, und der runde Zugang daneben ist ohnehin der Weg zum Warenkorb. V10 ist
bewusst nur Rückmeldung.

**Der schwebende Zugang ist jetzt ein runder Knopf**, 3,25 rem im Durchmesser, mit zentriertem
Warenkorbsymbol und einem Zähler-Abzeichen oben rechts (`99+` ab hundert, dieselbe Quelle und
dieselbe Regel wie im Header). Er sitzt 10 px über der unteren Leiste
(`2.75rem + env(safe-area-inset-bottom) + 0.625rem` — dieselben Werte, die `NavSpacer`
reserviert), der Toast wiederum 4,5 rem darüber, sodass sich beide nie überlappen.

**Er ist immer da, nicht erst mit Inhalt.** V9 blendete ihn bei leerem Korb aus, damit ein
Katalog, in dem niemand einkauft, ruhig bleibt. Das machte den Warenkorb genau in dem Moment
unauffindbar, in dem man ihn zum ersten Mal sucht — man kann kein Bedienelement öffnen, das erst
erscheint, nachdem man es benutzt hat. Der Knopf ist immer da; das **Abzeichen** kommt mit dem
ersten Artikel.

**Beide hängen außerhalb des `<header>`.** Der Header trägt `backdrop-blur`, und ein Vorfahre mit
aktivem `backdrop-filter` kann zum Containing Block seiner `position: fixed`-Nachkommen werden —
die Engines sind sich darin uneinig. WebKit platziert korrekt (nachgemessen), andere würden einen
„unten rechts"-Knopf an den Kopf der Seite setzen. Außerhalb des Headers ist die Frage gegenstandslos.


### Nachtrag 2026-09-07 — Mengengrenze und „schon im Warenkorb", V11 (zu ADR-0043)

Zwei zusammenhängende Warenkorb-Probleme, eine Ergänzung. Keine Architekturänderung, deshalb kein
eigener ADR: der Warenkorb bleibt lokal (`localStorage`, ein Store, `useSyncExternalStore`), es
gibt weiterhin keine Bestellung, keinen Checkout und **keine Reservierung**.

**Das Problem.** Der Warenkorb zählte, so hoch er wollte. `clampQuantity` begrenzt auf 99, das
Zahlenfeld auf `/cart` nahm eine getippte 99 entgegen, und niemand fragte, ob SkyIsles 99 davon
hat. Das ist ein Browser, der eine Frage über ein Lager beantwortet.

**Die Lösung ist ein Bit, keine Zahl.** `shop_quantity_available(sky_id, condition, quantity)`
(Migration `0009`) beantwortet „wäre **diese** Menge gerade möglich" mit `boolean`. Ein
`allowed_quantity: 3` wurde ausdrücklich geprüft und **verworfen**: eine Antwort „3" auf die
Anfrage „5" ist der Lagerbestand unter anderem Namen. Die Funktion fragt `is_shop_eligible()` und
`shop_price()` — dieselben Regeln wie `shop_offers()`, keine zweite Kopie der Shop-Logik — und
vergleicht `available_quantity` (`quantity - reserved`, die generierte Spalte aus `0003`), ohne
sie je zurückzugeben. Jede Art von „nein" fällt in dasselbe `false`.

**Die Restgrenze wird benannt, nicht wegerklärt.** Wer wiederholt konkrete Mengen anfragt, kann die
Obergrenze eingrenzen. Das ist beim Verkauf von Ware nicht vollständig vermeidbar — jeder Shop, in
den man `n` Stück legen kann, beantwortet damit, ob `n` geht. Vermieden wird der vermeidbare Teil:
keine Bestandsspalte verlässt die Datenbank, kein Feld trägt eine Stückzahl, keine Oberfläche zeigt
eine. Das ist keine Sicherheit durch Verschleierung und wird nicht als solche behauptet.

**Fail closed.** Die Server-Action liefert `allowed`, `denied` oder `unchecked`; jeder Fehler ist
`unchecked`, und `unchecked` erhöht nie. Anders als bei `fetchOffers`, wo ein fehlendes `0006` zu
„keine Angebote" auflösen darf, gibt es hier keine harmlose Vermutung. **Folge, die zwingend
beachtet werden muss:** ohne angewandte `0009` lehnt die Anwendung jede Erhöhung ab — erst
migrieren, dann deployen.

**Angebunden als Server-Action**, nicht als Browser-RPC: das Muster von `collection/actions.ts` und
`admin/actions.ts`. Funktionsname und Parameterform bleiben aus dem Client-Bundle heraus; hinüber
geht ein Wort.

**Ein Add-Pfad für drei Oberflächen.** Katalogpille, Figurenseite und das Plus auf `/cart` gehen
alle durch `useAddToCart`; die Regeln selbst liegen in `decideAdd` (`src/lib/cart/add.ts`), pur und
direkt testbar, weil dieses Projekt keine Render-Tests hat. Gefragt wird immer nach der **Gesamt**-
menge, die die Zeile erreichen würde — ein „+1" hinge von einem Warenkorb ab, den der Server nicht
sieht. Ein `useRef`-Wächter pro Auslöser verhindert, dass ein Doppeltipp zweimal durchgeht; dass
zwischen Antwort und lokalem Schreiben jemand anders kauft, ist ausdrücklich hingenommen — ein
Warenkorb ist keine Reservierung.

**Das freie Zahlenfeld auf `/cart` ist weg.** An seiner Stelle ein Stepper `−  n  +`: Minus lokal
und sofort (es kann den Warenkorb nur kleiner machen), Plus über den geprüften Pfad. Minus hält bei
eins an — „Entfernen" steht daneben und sagt, was es tut; die Null-Semantik von `setLineQuantity`
bleibt im Store unverändert.

**Die Pille zeigt, was schon drin liegt.** Gleiche Geometrie, kräftigeres Gold
(`--accent-hover`, `--gold-line-strong`, `shadow-gold` — alles vorhandene Tokens) und ein Haken
**im** Warenkorbsymbol. `CartCheckedGlyph` teilt sich die Korb-Pfade mit `CartGlyph`, damit die
beiden Zustände nicht auseinanderlaufen; der Haken ist gezeichnet, kein Unicode-`✓`.

**Der Knopf bleibt „Hinzufügen".** Kein Toggle, kein Entfernen, kein Mengen-Badge auf der Karte —
ein weiterer Klick legt ein weiteres Exemplar hinein, sofern verfügbar. Wer raten muss, ob ein
Klick hinzufügt oder entfernt, klickt nicht. Mengen verwaltet `/cart`, den Gesamtstand zeigt der
schwebende Warenkorb. Markiert wird die geschlossene Pille von **jeder** kaufbaren Condition dieser
SKY-ID; im geöffneten Chooser ist es pro Condition sichtbar.

**Wiederverwendbar für den späteren Checkout**, ohne ihn zu bauen: die Eligibility-Regeln liegen
schon in der Datenbank, und ein Checkout wird dieselbe Frage stellen müssen — nur atomar und
tatsächlich reservierend. Das ist ausdrücklich nicht Teil von V11.


## ADR-0049 — Die Bestellung ist ein Snapshot mit zwei Zuständen

**Status:** ANGENOMMEN (2026-09-07) · Datenmodell gebaut (Migration `0010`), **noch nicht
angewandt**. Zahlung, Rechnung, Versand und Widerruf sind spätere Phasen.

**Problem.** Ein Shop-Datenmodell verfällt an zwei Stellen zuverlässig: wenn eine historische
Bestellung von heutigen Preisen und Namen abhängt, und wenn „bezahlt", „versandt", „widerrufen"
und „erstattet" in ein Statusfeld gedrängt werden.

### Die Bestellung ist zugleich die Checkout-Sitzung

Eine eigene `checkout_sessions`-Tabelle wurde geprüft und verworfen. Eine abgebrochene Sitzung
**ist** eine Bestellung, die nie bezahlt wurde; eine zweite Tabelle dafür bringt einen Join, einen
zweiten Lebenszyklus und die Frage, welcher von beiden recht hat, wenn sie auseinanderlaufen.
Drei Entitäten tragen den Ablauf: `orders`, `order_reservations` und — später — `payment_attempts`.
Ein zweiter Zahlungsversuch ist ein weiterer Versuch zur **selben** Bestellung; die Bestellnummer,
die der Kunde bereits gesehen hat, bleibt seine.

### Zwei Achsen, nicht eine

`payment_status` und `fulfillment_status` stehen getrennt, weil bezahlt und versandt orthogonal
sind. In einem Feld entstünden Werte wie `paid_shipped_partially_refunded`, und die Kombinatorik
wächst mit jedem Fall. Zwei kleine geschlossene Mengen sind kleiner **und** vollständig.

**Widerruf, Retoure und Reklamation sind ausdrücklich keine Bestellzustände.** Eine Bestellung
kann zwei Teilwiderrufe, eine halb angekommene Retoure und parallel eine Reklamation tragen — als
Statuswert nicht darstellbar. Sie werden eigene Zeilen mit eigenem Lebenslauf.

### Positionen sind eingefroren

Die Umsetzung von ADR-0033: `order_lines` speichert Name, Bild, Einzelpreis und Zeilensumme zum
Kaufzeitpunkt. `sky_id` bleibt als Auswertungsbezug, **ohne** kaskadierenden Fremdschlüssel — die
Zeile erinnert sich daran, was verkauft wurde, nicht daran, wie es heute heißt. Ein
Trigger weist jedes `UPDATE` und `DELETE` auf `order_lines`, `order_addresses` und `order_events`
ab; auf `orders` sind Identität und Beträge eingefroren.

`name_snapshot` ist der **serverseitige** Katalogname, nicht der String aus dem Browser: was auf
einer Rechnung landet, darf nicht vom Käufer stammen. Die Oberfläche ordnet denselben Namen für
Varianten anders an (ADR-0030) — dieselbe Information, andere Anordnung.

### Der Kunde überlebt seine Bestellung nicht, die Bestellung ihn schon

`orders.user_id` ist `ON DELETE SET NULL`, **nie** `CASCADE`. Eine Bestellung ist ein Beleg mit
Aufbewahrungspflicht; eine Kontolöschung darf ihn nicht vernichten. `customer_email` trägt die
Bestellung danach weiter. Dieselbe Trennung nimmt `inventory_movements.created_by` seit `0003`
vorweg.

### Gast-Checkout

`user_id` ist nullbar, und das ist ein unterstütztes Ergebnis, kein Fehler. Der Warenkorb
funktioniert seit ADR-0043 anonym; eine Kontopflicht ausgerechnet im letzten Schritt wäre die
teuerste denkbare Stelle für diese Hürde. Für Gäste wird **keine** Platzhalter-Profilzeile
erfunden. Der Zugang zu einer Gastbestellung über ein gehashtes Token folgt in einer späteren
Phase — solange es ihn nicht gibt, ist eine Gastbestellung für **jeden** Client unlesbar, was der
sichere Zwischenzustand ist.

### Bestellnummern

`SI-2026-001000`, aus einer Sequenz als Spalten-Default, für keine Rolle beschreibbar. `nextval`
ist atomar und nimmt an keinem Rollback teil — Lücken sind abgebrochene Checkouts und bedeuten
nichts. **Rechnungsnummern sind davon getrennt** und werden erst bei Ausstellung aus einer eigenen
Sequenz gezogen; nur so bleibt die Rechnungsfolge dicht, obwohl es unbezahlte Bestellungen gibt.

### Was bewusst fehlt

**Keine Steuerfelder.** Regelbesteuerung, §&nbsp;19 und §&nbsp;25a verlangen verschiedene
Rechnungen, und die Entscheidung liegt beim Steuerberater. Rechnungen sind unveränderlich, also
wäre ein geratenes Format dauerhaft falsch. **Keine Provider-Felder**, solange kein
Zahlungsanbieter gewählt ist. **`shipping_amount` ist 0**, weil Versanddienstleister, Länder und
Preise offene Entscheidungen sind — die Spalte existiert, weil die Summe aus benannten Teilen
bestehen muss, nicht weil Phase A wüsste, was hineingehört.

**Verworfen:** ein Statusfeld für alles · `checkout_sessions` als eigene Tabelle ·
Bestellpositionen mit Fremdschlüssel auf `skylanders` · `ON DELETE CASCADE` auf `user_id` ·
UUID als öffentliche Bestellkennung · geratene Steuerlogik.

---

## ADR-0050 — Reservierung beginnt beim Checkout und läuft ab

**Status:** ANGENOMMEN (2026-09-07) · gebaut in Migration `0010`, **noch nicht angewandt**.

**Problem.** Der Warenkorb reserviert nichts (ADR-0043), und das bleibt so. Irgendwann zwischen
„zur Kasse" und „bezahlt" muss der Bestand aber verbindlich blockiert werden, sonst verkauft ein
Shop mit Einzelstücken dieselbe Figur zweimal. Gebrauchte Skylanders sind fast immer
Einzelstücke — zwei gleichzeitige Checkouts auf `quantity = 1` sind der Normalfall.

**Entscheidung.** Ein Warenkorb reserviert nichts; ein Checkout reserviert **alles oder nichts**.

### `reserved` bleibt die maßgebliche Zahl

`order_reservations` ist das Buch, `shop_inventory.reserved` der fortgeschriebene Saldo — beide in
derselben Transaktion. Die Spalte wurde **nicht** durch eine Summe über Reservierungszeilen
ersetzt, weil `available_quantity` eine *generated stored* Spalte darüber ist, der partielle Index
für gelistete Positionen sie benutzt, `apply_inventory_movement` sich mit ihr schützt und
`shop_offers()` `available` daraus ableitet. Vier Stellen hätten sich ändern müssen. Stattdessen
prüft `verify:commerce` die Übereinstimmung — genau wie `SUM(delta) = quantity` schon geprüft wird.

### Atomar, mit dem Muster, das schon da war

`reserve_for_order()` erfindet nichts: es ist `apply_inventory_movement` aus `0003` über mehrere
Positionen. Alle betroffenen Zeilen werden mit `SELECT … FOR UPDATE` **in aufsteigender
`id`-Reihenfolge** gesperrt — die feste Reihenfolge ist der Deadlock-Schutz, sonst sperren zwei
Warenkörbe mit überlappenden Artikeln über Kreuz. Danach wird abgelaufener Halt **unter der
Sperre** geräumt, Eignung und Preis neu geprüft, und die Verfügbarkeit ist Teil der
`WHERE`-Klausel des `UPDATE`, nicht eines vorherigen `SELECT`. Kein Treffer heißt: nicht genug da,
und die ganze Transaktion rollt zurück. **Eine halb reservierte Bestellung gibt es nicht.**

### 20 Minuten, serverseitig

`reservation_ttl()` steht in der Datenbank, weil der Server das entscheidet und ein Client, der
seine eigene Frist wählen dürfte, Bestand unbegrenzt halten könnte. 20 Minuten: lang genug für
einen PayPal-Umweg oder eine Bank-App mit 2FA, kurz genug, dass ein Einzelstück nicht eine halbe
Stunde für alle anderen tot ist. Später soll die Anbietersitzung auf denselben Zeitpunkt gesetzt
werden, damit beide nicht auseinanderlaufen können.

### Freigabe: synchron zuerst, Zeitgeber nur als Kosmetik

`release_expired_reservations()` wird an zwei Stellen gerufen. Die wichtige ist die erste:
**synchron in `reserve_for_order()`**, beschränkt auf die Positionen, die ohnehin gesperrt werden.
Wer den Artikel will, räumt selbst auf — damit löst sich Konkurrenz sofort und korrekt auf. Ein
späterer Zeitgeber hält nur `shop_offers().available` frisch für Besucher, die nie einen Checkout
versuchen. **Nichts, das etwas entscheidet, hängt davon ab, dass er gelaufen ist**, weshalb ein
verspäteter Lauf keine inkonsistente Buchung erzeugen kann. `0010` installiert **keinen**
Zeitgeber; das ist eine Infrastrukturentscheidung für sich.

### Der Verkauf passiert genau einmal

`convert_order_reservations()` existiert bereits, obwohl es keine Zahlung gibt: als reines
DB-Primitiv, damit die Zahlungsphase nichts mehr erfinden muss, sondern nur diese Funktion ruft.
**Der Zustand der Reservierung ist der Idempotenzschlüssel** — das `UPDATE` auf `converted` trägt
`and state = 'active'` unter der Sperre, also findet ein zweiter Aufruf nichts, bucht nichts und
schreibt keine Bewegung. `unique (movement_id)` ist die zweite Verteidigungslinie.

**Reihenfolge ist Pflicht:** erst `reserved` senken, dann buchen. `apply_inventory_movement`
schützt sich mit `quantity + delta >= reserved`, also stünde bei einem Einzelstück die eigene
Reservierung der eigenen Buchung im Weg. Beide Zahlen fallen um denselben Betrag, `available_quantity`
bewegt sich also nicht — korrekt, die Ware war schon vergeben.

### Eine Reservierung wird freigegeben, nie gelöscht

Ein Trigger weist `DELETE` ab. Eine abgelaufene Reservierung ist die Erklärung für eine Zahl, die
sich verändert hat; sie wegzuwerfen macht den Abgleich unbeweisbar.

### Bestand horten ist die eigentliche Bedrohung

`create_order()` hält echten Bestand für 20 Minuten und muss ohne Konto aufrufbar bleiben, weil
der Warenkorb ohne Konto funktioniert. Ein Skript könnte damit jedes Einzelstück — also fast jede
Figur — dauerhaft unverkäuflich halten, kostenlos. **Das Zeitlimit hilft dagegen nicht:** ein Bot
reserviert nach Ablauf sofort neu.

**Die Grenze liegt in der Datenbank, nicht in der Server-Action.** Das ist keine Stilfrage: Die
Anwendung spricht mit PostgREST über den **Anon-Key** und die Sitzung des Besuchers (ADR-0014,
ADR-0017). Eine Server-Action und ein Browser, der die RPC direkt aufruft, kommen damit als
*dieselbe* Datenbankrolle an, und der Anon-Key ist absichtlich öffentlich. Eine Prüfung in
TypeScript wäre mit einem einzigen `curl` umgangen. Die einzige Stelle, an der eine Grenze nicht
umgehbar ist, ist SQL.

`enforce_checkout_limits()` zählt drei Dinge über eine Identität, alle aus bereits vorhandenem
Zustand — **keine Zählertabelle, kein Zeitgeber, kein externer Dienst**: offene Checkouts (5),
gehaltene Stückzahl (25) und Bestellungen in der letzten Stunde (10). Die Werte stehen in
`commerce_settings` und sind ohne Deployment änderbar.

**Identität ist drei Dinge.** Eine einzelne Dimension ist in Sekunden gewechselt — eine
E-Mail-Adresse kostet nichts. Eine Bestellung zählt zur Identität, wenn **eine** von Konto,
Adresse oder Client-Fingerabdruck passt, und alle drei werden gemeinsam gezählt.

**Der Fingerabdruck ist keine Adresse.** SHA-256 aus der Aufrufer-Adresse und einem zufälligen
Salt, der die Datenbank nie verlässt. **Keine rohe IP wird irgendwo gespeichert.** Fehlt die
Adresse, ist der Wert `NULL` und die Dimension entfällt — niemals ein gemeinsamer konstanter
Eimer, der alle Besucher zusammen drosseln würde. Ein Trigger erlaubt nur, den Fingerabdruck zu
**löschen**, nie zu setzen oder zu ändern; bei Bezahlung entfällt er, weil eine bezahlte
Bestellung nichts mehr zu drosseln hat.

**Idempotenz ist kein Missbrauchsschutz.** `request_id` verhindert, dass ein Doppelklick zwei
Bestellungen erzeugt — mehr nicht. Eine UUID ist frei wählbar, ein Angreifer nimmt einfach jedes
Mal eine neue. Die beiden Mechanismen lösen verschiedene Probleme und ersetzen einander nicht.

### Eine verletzte Invariante wird laut, nicht leise repariert

`greatest(0, reserved - quantity)` wurde entfernt. Bei einer gültigen aktiven Reservierung **muss**
`reserved >= reservation.quantity` gelten; gilt es nicht, sind Buch und Zähler bereits
auseinandergelaufen, und ein Clamp auf 0 würde genau das für immer verbergen. Freigabe und
Konvertierung tragen die Bedingung stattdessen in der `WHERE`-Klausel und werfen bei keinem
Treffer `data_corrupted`. Die ganze Transaktion rollt zurück.

**Damit gibt es keine halben Übergänge.** Entweder Reservierungszustand, `reserved` und Bewegung
sind vollständig konsistent, oder nichts davon ist geschehen. Kein `converted` ohne Verkaufsbewegung,
kein `released` mit unverändertem `reserved`.

### Verspätete Zahlung nach freigegebener Reservierung

Nur eine **aktive** Reservierung wird konvertiert. Eine abgelaufene und freigegebene wird **nicht**
wiederbelebt — das wäre genau das Overselling, das die Sperren verhindern sollen. Die
Konvertierung liefert dann eine kleinere Zahl zurück als die Bestellung Positionen hat; die
Zahlungsphase vergleicht beides und setzt `needs_resolution`. Ein Mensch entscheidet zwischen
Nachbeschaffung und Erstattung. `needs_resolution` hat in Phase A noch keinen Schreiber und keinen
Leser — die Bedeutung steht fest, die Mechanik kommt mit der Zahlung.

**Verworfen:** Reservierung schon im Warenkorb · `reserved` als Summe über Reservierungszeilen ·
Reservieren ohne Sperre mit anschließender Prüfung · Löschen abgelaufener Reservierungen ·
Freigabe ausschließlich per Zeitgeber · eine zweite Bestandsarchitektur neben
`inventory_movements` · **Missbrauchsschutz in der Server-Action** (mit dem Anon-Key umgehbar) ·
**rohe IP als Commerce-Datum** · **eine einzelne Identitätsdimension** · **`greatest(0, …)` als
stille Reparatur** · Kontopflicht beim Checkout · CAPTCHA als Grundvoraussetzung für jeden Kauf.

> **Noch nicht entschieden und nicht implementiert:** Der Zahlungsanbieter, der
> Webhook-Wahrheitsbegriff („bezahlt ist, was der Server beim Anbieter gesehen hat") und die
> Rechnungsarchitektur. Sie sind im Architekturplan beschrieben und bekommen eigene ADRs, wenn sie
> gebaut werden.


## ADR-0051 — Bezahlt ist, was der Server beim Anbieter gesehen hat

**Status:** ANGENOMMEN (2026-09-08) · Payment-Core gebaut und produktiv (Migration `0012`).
Anbieteranbindung, Webhook und Edge Function folgen in B2.2 und B2.3.

**Problem.** Eine Zahlung ist der einzige Vorgang im Shop, bei dem ein Fehler unmittelbar Geld
oder Ware kostet. Drei Fragen mussten vorher entschieden sein: welcher Anbieter, wem die
Zahlungsbestätigung geglaubt wird, und mit welchen Rechten der bestätigende Code läuft.

### Der Anbieter ist Stripe

Verglichen wurden Stripe, Mollie und PayPal direkt — anhand der aktuellen Herstellerdokumentation,
nicht anhand von Erinnerung. **Eine frühere Empfehlung für Mollie wurde damit widerrufen:** sie
stützte sich auf die Annahme, Stripe biete PayPal in Deutschland nicht an. Das ist falsch; Stripe
listet `DE` unter den unterstützten Geschäftsstandorten für PayPal, inklusive Checkout und
vollständiger wie teilweiser Erstattung.

Beide Anbieter können PayPal, Karte, Apple Pay, Google Pay, Klarna und SEPA, beide ohne
Grundgebühr. Die Gebühren unterscheiden sich um Cent je Bestellung (Karte EWR: Stripe 1,5 %,
Mollie 1,8 %; PayPal: Mollie ohne, Stripe mit 0,2 % Aufschlag) — **das trägt keine
Architekturentscheidung.**

Entschieden hat der Punkt, an dem dieses Projekt eine Lücke hat: **es gibt keine
Staging-Umgebung.** `stripe listen --forward-to localhost` liefert echte Test-Webhooks an den
Entwicklungsrechner, ohne öffentliche Adresse und ohne Deployment. Mollies ID-only-Webhook ist
architektonisch eleganter — eine Fälschung ist zwecklos, weil der Status ohnehin nachgeholt wird —
aber jeder Test braucht dort eine erreichbare URL.

Zahlarten zum Start: **PayPal, Karte, Apple Pay, Google Pay.** Nicht Klarna (eigene
Rückabwicklung) und nicht SEPA-Lastschrift (Rücklastschriften, verzögerte Gutschrift).

### Der Browser ist nie die Wahrheit

Ein erfolgreicher Rücksprung auf `/checkout/...` bedeutet **nichts**. Wahr wird eine Zahlung
ausschließlich dadurch, dass der Server sie beim Anbieter gesehen hat. Die Rückkehrseite liest den
Bestellzustand und zeigt ihn an; sie setzt keinen. Alle sechs Reihenfolgen — Webhook vor
Rücksprung, Rücksprung vor Webhook, Browser geschlossen, Event doppelt, Event verspätet, Betrag
abweichend — führen zum selben Ergebnis, weil keine davon vom Browser abhängt.

### Der privilegierte Pfad ist eine Supabase Edge Function

Das ist die eigentliche Architekturentscheidung. `confirm_order_payment()` muss allen
Client-Rollen entzogen bleiben, aber die Anwendung erreicht PostgREST mit dem **Anon-Key** — eine
Server-Action könnte die Funktion also gar nicht aufrufen. Drei Wege standen zur Wahl:

| | Ansatz | Warum nicht |
|---|---|---|
| A | Service Role in Vercel | Bricht die Regel aus `docs/DEPLOYMENT.md`. Ein Schlüssel, der RLS vollständig umgeht, in einer Umgebung mit Webhook-Verkehr. |
| B | Anon-gegrantete RPC mit Shared Secret | Eine öffentlich ausführbare Funktion, deren Sicherheit an einem mitgeschickten String hängt. Kleinste Änderung, aber die größte Angriffsfläche. |
| **C** | **Supabase Edge Function** | **Gewählt.** |

**Gewählt: C.** Die Edge Function läuft **innerhalb** von Supabase, also verlässt der
Service-Role-Schlüssel diese Grenze nie. Vercel bekommt weiterhin keinen. Das Stripe-Webhook-Secret
liegt ausschließlich als Server-Secret. Der Preis ist eine zweite Deployment-Zielumgebung und eine
zweite Laufzeit — das ist bewusst in Kauf genommen, weil die Alternative bedeutet hätte, entweder
eine bestehende Sicherheitsregel zu brechen oder eine privilegierte Operation öffentlich
ausführbar zu machen.

**Feste Regeln, die daraus folgen:**

- Der Browser besitzt ausschließlich öffentliche Supabase-Credentials.
- Vercel erhält keinen Supabase-Service-Role-Schlüssel.
- Privilegierte Payment- und Order-Operationen bleiben für `PUBLIC`, `anon` und `authenticated`
  gesperrt — produktiv geprüft.
- Rückkehrrouten im Browser sind reine Anzeige.

### Ein Event gilt erst als erledigt, wenn es erledigt wurde

`(provider, provider_event_id)` ist eindeutig, und der Insert ist das Schloss. Entscheidend ist
aber die Unterscheidung, die beim Audit vor der Migration gefunden wurde: **eine Zeile mit
`processed_at IS NULL` wurde gesehen, aber nicht abgeschlossen** — ein Retry muss sie erneut
verarbeiten. Nur eine verarbeitete Zeile ist ein echtes Duplikat.

Der Fall ist nicht theoretisch: Ein Webhook kann eintreffen, **bevor** `attach_provider_payment()`
committet hat. Die erste Zustellung findet dann berechtigterweise keinen Attempt. Würde sie als
erledigt vermerkt, verwürfe jeder Retry sich selbst und die Bestellung bliebe für immer unbezahlt.

### Alles oder nichts, und niemals Overselling

Vor jeder Konvertierung werden die aktiven Reservierungen gegen die Bestellpositionen gezählt.
Fehlt auch nur eine, wird **keine** konvertiert: eine halb verkaufte Bestellung ist schlimmer als
eine, die jemand ansieht. Eine verspätete Zahlung auf eine bereits freigegebene Reservierung wird
als eingegangen verbucht, setzt `needs_resolution` und schreibt **keine** Bestandsbewegung
(ADR-0050). Ein abweichender Betrag verkauft nichts und schließt den Versuch als `failed`.

**Verworfen:** Browser-Rücksprung als Zahlungsnachweis · Service Role in Vercel · öffentlich
ausführbare Bestätigungsfunktion mit Shared Secret · Mollie (auf falscher Annahme empfohlen) ·
Klarna und SEPA-Lastschrift zum Start · Wiederbeleben abgelaufener Reservierungen · teilweise
Konvertierung einer Bestellung · Speichern von Anbieter-Payloads oder Zahlungsdaten.

---

## ADR-0052 — Ein lokaler Timeout darf vom Anbieter korrigiert werden

**Status:** ANGENOMMEN (2026-09-09) · Migration `0015`, auf Staging runtime-verifiziert, auf
Production angewandt.

**Problem.** `payment_attempts.status` kannte vier Endzustände, und `payment_attempts_protect()`
verbot jeden Übergang aus ihnen heraus — ausnahmslos. Das war als Stärke gedacht und war ein
Defekt.

`expire_stale_checkouts()` setzt einen Versuch allein aufgrund **unseres eigenen Zustands** auf
`expired`: die Reservierung ist abgelaufen, also hat niemand rechtzeitig bezahlt. Die Checkout
Session beim Anbieter kann in diesem Moment aber noch bezahlbar sein — Stripes Mindestlaufzeit
beträgt 30 Minuten, unsere Reservierung 20, und die beiden lassen sich nicht angleichen.

Zahlt der Kunde danach, erreicht `confirm_order_payment()` seinen Late-Payment-Zweig und führt
`set status = 'succeeded'` auf einem `expired`-Versuch aus. Der Trigger warf `restrict_violation`,
**die gesamte Transaktion rollte zurück — einschließlich der `payment_events`-Zeile**, die den
Eingang festgehalten hätte. Stripe wiederholte drei Tage lang in denselben Fehler.

**Das Geld war eingenommen und die Datenbank erfuhr nie davon.** Genau der Pfad, für den
ADR-0050 existiert, war der einzige, der nicht funktionieren konnte.

**Entscheidung.** Genau ein Übergang wird erlaubt: **`expired` → `succeeded`.** Sonst nichts.

Die Begründung ist ADR-0051 selbst: *bezahlt ist, was der Server beim Anbieter gesehen hat.*
`expired` ist unsere Vermutung, `succeeded` ist die Auskunft des Anbieters. Eine autoritative
Bestätigung muss eine lokale Vermutung korrigieren dürfen — andernfalls behauptet die Datenbank
etwas, das nachweislich falsch ist.

Weiterhin verboten, weil keiner davon eine korrigierte Vermutung beschreibt:

| Übergang | Warum er verboten bleibt |
|---|---|
| `failed` → `succeeded` | Der Anbieter hat gesagt, dass diese Zahlung nicht funktioniert hat |
| `cancelled` → `succeeded` | Jemand hat den Versuch bewusst beendet |
| `succeeded` → irgendetwas | Bereits die autoritative Antwort; da ist nichts zu korrigieren |
| `expired` → `pending` / `created` | Ein Versuch läuft nicht rückwärts |

**`failed_at` wird im Trigger geleert, nicht im Aufrufer.** `payment_attempts_failed_at_matches`
verlangt `(failed_at is not null) = (status in ('failed','expired','cancelled'))`. Nur den Status
freizugeben hätte die Trigger-Ablehnung gegen eine CHECK-Verletzung getauscht und nichts gelöst.
Die Regel steht an einer Stelle, damit ein später hinzukommender Aufrufer sie nicht vergessen
kann. Der Zeitpunkt des lokalen Ablaufs geht nicht verloren — er steht als `checkout_expired`
in `order_events`.

**Konsequenz.** Der Late-Payment-Vertrag aus B2.1 bleibt unverändert: Versuch `succeeded`,
Bestellung `paid`, `paid_at` gesetzt, `needs_resolution = true`, keine Reservierung wiederbelebt,
keine Bestandsbewegung. Er ist jetzt zum ersten Mal überhaupt erreichbar.

**Verworfen:** Terminalzustände generell aufweichen · `confirm_order_payment()` so ändern, dass
es den Versuch in Ruhe lässt (die Bestellung wäre bezahlt, der Versuch für immer `expired` — zwei
Zeilen, die sich widersprechen) · `failed_at` behalten und die CHECK-Bedingung lockern.

---

## ADR-0053 — Beträge stehen fest, bevor die Bestellung existiert

**Status:** ANGENOMMEN (2026-09-09) · Migration `0016`, auf Staging runtime-verifiziert, auf
Production angewandt und dort mit einem realen Checkout-/Reservierungs-Smoke bestätigt.

**Problem.** Seit `0010` legte `create_order()` die Bestellung mit Nullbeträgen an und setzte sie
unmittelbar danach:

```sql
insert into public.orders (... items_subtotal, total_amount ...) values (... 0, 0 ...)
...
update public.orders set items_subtotal = v_subtotal, ...
```

`orders_protect_immutable()` — in derselben Migration eingeführt — verbietet genau das. Jeder
Aufruf warf `23001` und rollte zurück. **Es konnte keine Bestellung angelegt werden, in keiner
Umgebung.** Der Checkout war seit `0010` funktionsunfähig; `0011` und `0013` haben die Funktion
ersetzt und den Widerspruch jedes Mal mitgenommen.

Dass Production null Bestellungen hatte, war keine Aussage über Kundschaft.

**Warum es sechs Migrationen lang unentdeckt blieb.** Jeder Test dieser Funktion ist eine
Zusicherung über **Dateitext**. `schema.test.ts` behauptet in derselben Datei, dass der Trigger die
Beträge einfriert *und* dass `create_order()` sie aktualisiert. Beide Aussagen stimmen für sich.
Kein Textvergleich sieht, dass sie einander widersprechen — und ausgeführt worden war die Funktion
nie. Gefunden hat es die Staging-Runtime-Suite im dritten Lauf.

**Entscheidung.** Die Beträge werden berechnet, **bevor** die Bestellzeile entsteht. Danach gibt es
nichts mehr zu aktualisieren.

```
Durchgang 1   jede Position auflösen, prüfen, bepreisen, Snapshot behalten   (schreibt nichts)
              v_subtotal, danach v_shipping
INSERT        orders mit den endgültigen Beträgen
Durchgang 2   order_lines aus den Snapshots aus Durchgang 1
```

**Durchgang 2 liest nichts nach.** Das ist Korrektheit, nicht Ordnungsliebe: die Funktion läuft
unter READ COMMITTED, ein zweites Nachschlagen desselben Artikels dürfte legitim einen anderen
Preis liefern als den, aus dem die Zwischensumme gebildet wurde — die Bestellung berechnete dann
einen Betrag und ihre Positionen zeigten einen anderen. Jede Position wird genau einmal bepreist.
Die Snapshots reisen als `jsonb` und damit ohne neuen Typ; `numeric` überlebt den Umweg exakt.

**Der Trigger bleibt unverändert.** Das ist der Kern der Entscheidung: die Zusage aus
`docs/SECURITY.md` — die Beträge einer Bestellung sind unveränderlich — wird dadurch buchstäblich
wahr, ab dem ersten INSERT, ohne Fenster.

**Verworfen:** eine Initialisierungs-Ausnahme im Trigger (etwa „Änderung erlaubt, solange der alte
Betrag 0 ist"). Sie hätte aus *unveränderlich* ein *unveränderlich, außer kurz* gemacht, eine
Zusage ohne Einschränkung nachträglich eingeschränkt und eine Bestellzeile mit Nullbeträgen
hinterlassen, die nebenläufige Leser sehen können. · Zwei getrennte Lesedurchgänge gegen den
Katalog (Preis-Race). · Ein neuer Composite Type für die Snapshots (Schemaänderung für einen
lokalen Zwischenspeicher).

---

## ADR-0054 — Anbieterfunktionen vor Eigenbau: wartungsarme Architektur

**Status:** ANGENOMMEN (2026-09-10) · projektweites Architekturprinzip · erste Anwendung: B2.3
`stripe-webhook`.

**Problem.** SkyIsles wird von einer Person gebaut und auf unabsehbare Zeit von derselben Person
gewartet. Jede selbstgeschriebene Zeile ist damit nicht nur einmal zu schreiben, sondern dauerhaft
zu verstehen, zu testen, bei Bibliotheks- und Protokolländerungen nachzuziehen und im Fehlerfall
allein zu debuggen. Die knappe Ressource ist nicht Rechenzeit und nicht Kontrolle, sondern
**dauerhaft selbst zu wartende Fläche**.

Der Anlass ist konkret. Der B2.3-Plan schlug zunächst eine **eigene HMAC-Implementierung** der
Stripe-Signaturprüfung vor, mit der Begründung, sie sei dann in Vitest testbar — das offizielle SDK
laufe nur im Deno-Runtime. Das Argument ist für sich richtig und in der Sache falsch gewichtet:

> Testbarkeit des eigenen Codes ist der falsche Maßstab, wenn die Alternative Code ist, den man
> gar nicht erst besitzt.

Eine selbstgebaute Signaturprüfung heißt: konstantzeitiger Vergleich, Timestamp-Toleranz, mehrere
`v1`-Signaturen bei Secret-Rotation, und die Pflicht, jede künftige Änderung an Stripes
Signaturformat selbst zu bemerken. Der Gegenwert wäre eine grüne Testdatei über **unsere eigene
Kryptographie** — die Klasse Code, bei der ein Fehler am teuersten und am schwersten zu sehen ist.

**Entscheidung.** Wird eine sicherheitskritische, standardisierte oder infrastrukturelle Funktion
von einem etablierten Anbieter zuverlässig bereitgestellt, **verwenden wir diese, statt sie selbst
zu implementieren.** In dieser Reihenfolge:

| | Ebene | Beispiel |
|---|---|---|
| 1 | Offizielle Anbieterfunktion / SDK | `stripe.webhooks.constructEventAsync()` |
| 2 | Plattformfunktion von Supabase oder Stripe | Supabase Auth, Edge Functions, Stripes Retry-Logik und Event-IDs |
| 3 | Kleine eigene Adapter-/Glue-Logik | Cent → Euro, Event-Typ → DB-Funktion, Outcome → HTTP-Code |
| 4 | Eigene Implementierung | nur, wenn es auf 1–3 nichts Geeignetes gibt |

**Besonders zu vermeiden:** eigene Kryptographie · eigene Auth-Systeme · eigene
Payment-Verifikation · eigene Mail-Infrastruktur · eigene Queue- und Retry-Systeme, wo der Anbieter
das bereits löst · **Abstraktionsschichten um einen Anbieter herum, die keinen konkreten Nutzen
haben**.

Der letzte Punkt schneidet in die andere Richtung und ist genauso gemeint: ein selbstgebautes
`PaymentProvider`-Interface „für den Fall, dass wir Stripe wechseln" ist ebenfalls dauerhaft zu
wartende Fläche — bezahlt heute, für einen Nutzen, den es vielleicht nie gibt.

**Was das Prinzip nicht sagt.** Es ist kein Freibrief für Abhängigkeiten. Eine neue Abhängigkeit
bleibt eine Lieferkettenentscheidung: etabliert, gepflegt, versionsgepinnt, und beim
Anbieter-SDK ausschließlich der Anbieter selbst. Ebenso bleibt `docs/SECURITY.md` unberührt —
Anbietercode bekommt keine Secrets, die er nicht braucht, und keinen Zugriff jenseits seiner
Aufgabe.

**Was sich an der Testkultur ändert.** Wir testen weiterhin scharf, aber die richtige Sache. Nicht
mehr „ist unsere HMAC-Berechnung korrekt", sondern **„rufen wir das SDK richtig auf"** — mit dem
rohen Body, mit dem Secret aus der Umgebung, und mit dem Ergebnis an der richtigen Stelle. Die
Grenze verschiebt sich von der Krypto-Korrektheit zur Integrationskorrektheit, und nur die zweite
ist noch unsere.

**Konsequenzen für B2.3.**

- Signaturprüfung über das **offizielle Stripe-SDK**, in Deno als `npm:stripe` mit
  `constructEventAsync()` und `Stripe.createSubtleCryptoProvider()`. Die synchrone Variante
  benutzt Node-Krypto und scheitert im Edge-Runtime — das ist die klassische Falle und der Grund,
  warum die asynchrone Form hier keine Stilfrage ist.
- **Retries gehören Stripe.** Wir bauen keinen eigenen Wiederholungsdienst; wir antworten
  non-2xx, wenn eine Wiederholung erwünscht ist, und 2xx sonst.
- **Idempotenz über Stripes `evt_…`**, dedupliziert von `payment_events` — keine zweite,
  abweichende Dedup-Logik im Edge-Code.
- **Supabase Edge Functions als Runtime**, weiterhin aus ADR-0051.
- **Die Geschäftslogik bleibt vollständig in den bestehenden DB-Funktionen.**
  `confirm_order_payment()` und `fail_payment_attempt()` sind die einzigen Schreiber; der
  Webhook ist Signaturprüfung, Feldextraktion und ein Router. Bestand und Reservierungen werden
  im Edge-Code **niemals** direkt verändert.

**Konsequenz darüber hinaus.** Bei jeder künftigen Infrastrukturfrage — Mailversand, geplante
Aufgaben, Dateiablage, Suche — wird zuerst geprüft, ob Supabase oder ein etablierter Anbieter das
bereits löst. Eigenbau braucht ab jetzt eine Begründung; er ist nicht mehr die Voreinstellung.

**Verworfen:** eine eigene HMAC-SHA256-Verifikation der Stripe-Signatur (Vitest-Testbarkeit
rechtfertigt keine selbstgewartete Kryptographie auf dem Zahlungspfad) · ein anbieterneutraler
Payment-Abstraktionslayer ohne zweiten Anbieter · ein eigener Webhook-Retry- und
Dead-Letter-Mechanismus neben dem, den Stripe drei Tage lang kostenlos betreibt.

### Konkrete Festlegungen aus dem Architektur-Audit (2026-09-10)

Das Audit hat den Bestand gegen dieses Prinzip geprüft. Befund: die Codebasis ist bereits
weitgehend anbieterorientiert — keine eigene Kryptographie, kein eigenes Auth-System, kein eigener
Retry-Dienst, keine eigene Mail-Infrastruktur, kein Provider-Abstraktionslayer. Die Regel
beschreibt hier überwiegend die bestehende Praxis. Fünf Punkte werden trotzdem festgeschrieben,
weil sie sonst schleichend anders entschieden würden:

**1. Checkout- und Reservierungsablauf läuft über `pg_cron`.** `expire_stale_checkouts()` wird von
PostgreSQL selbst aufgerufen, nach der in `docs/DEPLOYMENT.md` festgelegten Anleitung. **Kein
eigener Sweeper-Service, keine Edge Function für Scheduling, kein externer Scheduler, und kein
Aufräumen, das an einem HTTP-Request hängt.** Der Job läuft als `postgres` und braucht deshalb
keinen geöffneten Grant — genau das ist das Argument gegen einen HTTP-Endpunkt.

**2. Stripe-Webhook-Signaturen prüft das offizielle Stripe-SDK.** `constructEventAsync()` mit
`createSubtleCryptoProvider()`. **Keine eigene HMAC-Implementierung**, auch nicht mit dem Argument
besserer Testbarkeit.

**3. Die Vertrauensannahme hinter `X-Forwarded-For` ist NICHT belegt.** `request_client_hash()`
nimmt den linkesten Eintrag als Client-Adresse. Das gilt nur, wenn kein Client einen eigenen Header
mitschickt — Proxies hängen an, sie ersetzen nicht. Ob Supabases Gateway ihn überschreibt, ist
**ungeprüft**.

> **Regel, die daraus allgemein folgt:** Eine Sicherheitsannahme wird erst dann als zugesichert
> dokumentiert, wenn sie durch offizielle Anbieterdokumentation **oder** reproduzierbares
> Staging-Verhalten belegt ist. Bis dahin steht sie als offene Frage in `docs/SECURITY.md` — nicht
> als Eigenschaft des Systems.

Fällt die Annahme, gehört generische Missbrauchsabwehr auf IP-Ebene ohnehin an die Plattform
(Vercel Firewall, Cloudflare), die die echte Socket-Adresse sieht — nicht in eine SQL-Funktion.

**4. Username-Regeln bekommen keine Generator-Infrastruktur.** `auth/username.ts` spiegelt
`profiles_username_not_reserved` von Hand. Das ist Doppelpflege, aber ein Codegenerator wäre neue
dauerhafte Fläche für ein sehr kleines Problem — also genau der Fehler, den dieses ADR verhindern
soll. **Zuerst zu prüfen ist, ob eine einzige kanonische Quelle oder schlicht ein Contract-Test die
kleinere Wartungsfläche ergibt.** Offen, und bewusst niedrig priorisiert.

**5. Die Tests, welche die Edge-Function-Liste festschreiben, werden erweitert, nicht gelockert.**
`payment-bootstrap.test.ts` und `payment.test.ts` verlangen beide, dass `supabase/functions`
**genau** `["create-payment"]` enthält. Mit B2.3 wird daraus bewusst `["create-payment",
"stripe-webhook"]`. Diese Tests sind die Bremse gegen unbemerkt wachsende Edge-Fläche und damit
ein Werkzeug dieses Prinzips — sie durch eine unscharfe Zusicherung zu ersetzen wäre eine
Verschlechterung.

### Vorentscheidungen für noch nicht gebaute Bereiche

Festgehalten, damit sie nicht später als Eigenbau enden:

| Bereich | Entscheidung |
|---|---|
| Bildverarbeitung | **Supabase Storage Image Transformations**, keine eigene `sharp`-Pipeline. Heute findet bewusst weder Resizing noch Re-Encoding statt |
| Transaktionsmails | Etablierter externer Anbieter. **Kein eigenes SMTP, keine eigene Queue.** Auth-Mails verschickt Supabase Auth bereits selbst |
| Zahlungsbelege | Stripes eigene Belege verwenden, **soweit sie ausreichen** |

**Zur Abgrenzung Beleg vs. Rechnung, ausdrücklich:** Ein Stripe-Zahlungsbeleg ist eine
Zahlungsbestätigung. Ob er eine rechtlich oder steuerlich erforderliche Rechnung ersetzt, ist
**hier nicht entschieden und wird hier nicht behauptet** — SkyIsles rechnet nach §19 UStG ohne
ausgewiesene Steuer ab, und was daraus an Pflichtangaben folgt, gehört geprüft, wenn das
Rechnungsmodul gebaut wird. Bis dahin gilt nur: für die *Zahlungsbestätigung* wird nichts
Eigenes gebaut.

---

## ADR-0055 — V1 nimmt nur sofortige Zahlungsmethoden

**Status:** ANGENOMMEN (2026-09-11) · Steuerung im Stripe-Dashboard, nicht im Code ·
`stripe-webhook` auf Staging runtime-verifiziert.

**Problem.** `checkout.session.completed` heißt nicht „bezahlt". Bei einer asynchronen
Zahlungsmethode — Überweisung, Klarna, SEPA-Lastschrift — feuert Stripe dieses Event mit
`status: "complete"` und `payment_status: "unpaid"`: der Kunde ist mit dem Checkout fertig, das
Geld ist unterwegs oder auch nicht. Wer auf den Event-Typ allein reagiert, konvertiert
Reservierungen und bucht eine Verkaufsbewegung für Geld, das nie ankommen muss.

Der zweite, unauffälligere Konflikt ist zeitlich. Unsere Reservierung hält **20 Minuten**
(ADR-0050); eine asynchrone Zahlung braucht Tage. Der Hold läuft also **immer** ab, bevor das Geld
da ist. `expire_stale_checkouts()` räumt die Bestellung ab, die spätere Bestätigung landet
zwangsläufig im Late-Payment-Zweig: Geld verbucht, nichts konvertiert, `needs_resolution` gesetzt
(ADR-0052). Das ist korrekt und trotzdem untragbar — jede solche Bestellung wäre Handarbeit.

**Entscheidung.** V1 bietet **ausschließlich sofortige Zahlungsmethoden** an: Karte sowie Apple
Pay und Google Pay über Stripe Checkout.

**Gesteuert wird das im Stripe-Dashboard, nicht im Code.** `create-payment` schickt bewusst kein
`payment_method_types` — dessen Abwesenheit ist gerade das, was Dynamic Payment Methods aktiviert,
und die Auswahl gehört damit in die Dashboard-Konfiguration. Das ist ADR-0054 angewandt: die
Plattform kann das, also bauen wir es nicht nach. Eine Allowlist im Quelltext wäre eine zweite,
abweichende Wahrheit, die bei jeder Dashboard-Änderung stillschweigend falsch würde.

**Die Handler werden trotzdem gebaut.** `checkout.session.async_payment_succeeded` und
`checkout.session.async_payment_failed` sind in `stripe-webhook` implementiert, abonniert und in
`supabase/tests/webhook_runtime_verification.sql` verifiziert. Begründung: „sollte nicht vorkommen" ist
keine Zusicherung, eine Dashboard-Einstellung ist an einer anderen Stelle änderbar als dieser
Code, und der Fehlermodus wäre, Ware gegen nichts herauszugeben. Ein Handler, der nie feuert,
kostet nichts; sein Fehlen kostet Bestand.

**Unabhängig davon gilt die Feldprüfung.** Bestätigt wird nur bei `status = "complete"` **und**
`payment_status = "paid"`. Die Dashboard-Einstellung ist die erste Sperre, diese Prüfung die
zweite, und die zweite ist die, die im Code steht.

**Konsequenz.** Der Late-Payment-Pfad bleibt der seltene Ausnahmefall, für den er gedacht war: ein
Kunde, der in Minute 25 einer noch offenen Stripe-Session bezahlt — Stripes Session lebt 32
Minuten, unser Hold 20, und die beiden lassen sich nicht angleichen. Nicht der Normalbetrieb einer
ganzen Zahlungsart.

**Zu prüfen, bevor asynchrone Methoden je aktiviert werden:** eine Haltedauer, die zur Methode
passt, oder ein Bestellzustand „bezahlt, aber unreserviert", der ohne Handarbeit auflösbar ist.
Beides ist eine eigene Entscheidung und keine Einstellung.

**Verworfen:** asynchrone Methoden anbieten und den Late-Payment-Pfad als Regelbetrieb behandeln ·
eine Methoden-Allowlist im Quelltext parallel zur Dashboard-Konfiguration · die async-Handler
weglassen, weil die Methoden abgeschaltet sind.

---

## ADR-0056 — Die Zahlungs-Capability überlebt den Redirect in `sessionStorage`

**Status:** ANGENOMMEN (2026-09-11) · B2.4 · ändert eine Zusage aus ADR-0051/B2.2a.

**Problem.** Bis B2.3 lag die Gast-Capability ausschließlich im Arbeitsspeicher, und
`capability.ts` sagte das ausdrücklich zu: *„held in memory for the seconds between placing the
order and being sent to the payment provider."* Ein Test hielt es fest — `does not survive in
browser storage yet`.

B2.4 bricht diese Annahme, weil der Kunde jetzt **die Domain verlässt**. Nach der Zahlung kommt er
auf `/checkout/erfolg?order=…` zurück, und dort muss die Seite sagen, ob das Geld angekommen ist —
aus der Datenbank gelesen, niemals aus dem Redirect geschlossen.

Für angemeldete Kunden trägt RLS das. **Für Gäste nicht.** `order_payment_state()` antwortet
niemandem, der nicht beweisen kann, dass er die Bestellung aufgegeben hat, und der einzige Beweis
eines Gastes ist die Capability. Liegt sie nur im Speicher, ist sie nach dem Redirect weg — und
ein Gast erführe über seine eigene, gerade bezahlte Bestellung **gar nichts**. Gäste sind laut
`create-payment` „most of the shop".

**Entscheidung.** Die Capability wird in `sessionStorage` abgelegt, unter vier Auflagen:

| Auflage | Grund |
|---|---|
| `sessionStorage`, **nie** `localStorage` | Sie stirbt mit dem Tab. `localStorage` überlebte den Besuch an einem geteilten Rechner. |
| ein Schlüssel je Bestellnummer | Ein zweiter Checkout im selben Tab kann die Capability des ersten nicht überschreiben. |
| gelöscht im Endzustand | Sobald die Bestellung nichts Neues mehr beantworten kann, ist ein weiter gehaltenes Geheimnis Exposition ohne Zweck (`isTerminal`). |
| nie URL, nie Query-String, nie Log, nie Event-Payload | Unverändert aus B2.2a. |

**Der Preis, offen benannt.** Das ist eine reale Ausweitung der Angriffsfläche: Skript auf dieser
Origin kann `sessionStorage` lesen, ein XSS also die Capability. Dagegen steht, was sie überhaupt
erlaubt — **eine** Bestellung bezahlen oder deren Status lesen. Sie ist keine Sitzung, gewährt
nichts darüber hinaus und lässt sich gegen keine andere Bestellung wiederverwenden. Derselbe
Browser besaß sie ohnehin bereits; was sich ändert, ist die Dauer, nicht der Umfang.

**Was zusätzlich gespeichert wird, und was daran nicht geheim ist.** Nach einer abgebrochenen
Zahlung kehrt der Browser mit nichts als der Bestellnummer zurück, `create-payment` braucht aber
die Bestell-ID. Beide liegen deshalb unter einem **eigenen** Schlüssel — bewusst getrennt vom
Geheimnis, weil sie keines sind. Die Alternative wäre gewesen, `order_payment_state()` IDs
zurückgeben zu lassen; die Projektion bleibt lieber minimal.

**Nachtrag (2026-09-11, im manuellen Smoke gefunden).** Die getrennte Ablage von Bestell-ID und
-nummer ist nicht nur Bequemlichkeit, sondern trägt einen Fehlerfall, der erst im Browser sichtbar
wurde: Stripes `cancel_url` kehrt mit `?order=…` zurück, ein **Browser-Back** aber ohne jede
Query. Wird das Dokument dabei nicht aus dem Back/Forward-Cache bedient, ist die Bestellung ohne
diesen Eintrag unerreichbar, während sie Bestand hält. `recallOpenOrder()` nimmt die Nummer
deshalb **optional**: mit Nummer wird sie geprüft, weil sie aus der URL stammt; ohne Nummer wird
zurückgegeben, was dieser Tab selbst gespeichert hat. Das eigene Storage zu lesen ist nicht
dasselbe wie einer URL zu glauben.

**Verworfen:** die Capability in die Rücksprung-URL legen (dann steht sie in Browserverlauf,
Referrer und jedem Server-Log) · `localStorage` (überlebt den Besuch) · Gästen nach der Zahlung
gar keinen Status zeigen (ohne Mailversand erführen sie nichts) · den Service-Role-Key in Vercel,
um serverseitig zu lesen (bricht ADR-0051).

---

## ADR-0057 — Fulfillment kennt einen Übergang, und `needs_resolution` sperrt ihn

**Status:** ANGENOMMEN (2026-09-11) · Migration `0018`, auf Staging runtime-verifiziert,
Production ausstehend.

**Problem.** `orders.fulfillment_status` kennt seit `0010` fünf Werte und **keine Übergangsregel**.
Der CHECK erlaubt jeden davon jederzeit, auch `completed → unfulfilled`. Solange niemand schrieb,
war das folgenlos. Admin Orders V1 schreibt.

Dazu ein zweites, teureres Problem: **darf eine bezahlte Bestellung versendet werden?** Die
naheliegende Antwort — `payment_status = 'paid'` — ist zu schwach. Eine Bestellung mit
`needs_resolution` **ist** bezahlt: das Geld kam an, nachdem der Hold abgelaufen war, es wurde
**keine Reservierung konvertiert und kein Bestand gebucht** (ADR-0050). Sie zu versenden hieße,
Ware herauszugeben, die das Bestandsjournal noch als vorhanden führt.

**Entscheidung.**

**V1 kennt genau einen Übergang: `unfulfilled → shipped`.** `preparing`, `completed` und
`cancelled` bleiben im CHECK und bekommen keinen Weg — einen Zustand zu erlauben, aus dem nichts
herausführt, wäre schlimmer als ihn zu verbieten.

**Durchgesetzt an zwei Stellen, mit verschiedenen Aufgaben.** `admin_mark_order_shipped()` prüft
die Geschäftsregeln: Administrator, bezahlt, nicht geflaggt, nicht versendet. Der Trigger
`orders_protect_fulfillment()` prüft **keine** davon und soll das nicht. Er beantwortet eine
engere Frage, die unabhängig vom Schreiber gelten muss: *ist dieser Zustandswechsel überhaupt
vorgesehen?*

Der Trigger wurde bewusst gebaut, obwohl heute genau eine Funktion schreibt. Die Begründung liefert
ADR-0052: bei `payment_attempts` ging ein Zustandsübergang real schief, und dort existierte der
Trigger bereits. Vor dem Bau wurde geprüft, dass **nichts** in der Datenbank `fulfillment_status`
schreibt — `confirm_order_payment()`, `expire_stale_checkouts()` und `fail_payment_attempt()`
fassen ausschließlich `payment_status` an —, der Guard bricht also keinen bestehenden Pfad.

**`needs_resolution` ist eine Sperre, niemals ein Nebeneffekt.** Fulfillment darf sie nicht
löschen, und der Trigger verbietet, dass sich beide in einer Anweisung ändern. Bewusst so eng:
`confirm_order_payment()` **setzt** das Flag weiterhin, und ein späterer Auflösungs-Workflow muss
es löschen können. Verboten ist nur, es beim Drücken eines Versandknopfes zu verlieren.

Eine geflaggte Bestellung ist damit in V1 **nicht versendbar**. Das ist die ehrliche Antwort: sie
braucht eine Entscheidung zwischen Nachbestellen und Erstatten, und beides gibt es noch nicht.

**Der Server besitzt `shipped_at`.** Der Trigger setzt es beim Übergang aus der eigenen Uhr und
reicht es sonst unverändert weiter. „Der Client nennt kein Versanddatum" ist dadurch strukturell
statt vereinbart.

**Konsequenz, am eigenen Leib gelernt.** Beim Staging-Smoke wurde die E2E-Referenzbestellung
`SI-2026-001022` versehentlich mitversendet. Zurückdrehen ist nicht möglich — der Trigger
verweigert `shipped → unfulfilled`, und `order_events` ist append-only. Der Zustand bleibt und wird
in `PROJECT_STATUS.md` erklärt. **Ein Guard, der nur so lange gilt, wie er nicht stört, ist
keiner.**

**Verworfen:** die Übergänge allein in der RPC zu prüfen (heute ein Schreiber, morgen zwei) · eine
generische State-Machine-Infrastruktur für fünf Werte und einen Übergang · `needs_resolution` beim
Versand automatisch aufzulösen · eine Bearbeitungsfunktion für die Trackingnummer in V1.

---

## ADR-0058 — Der Eingang liegt im Katalog, nicht vor ihm

**Status:** ANGENOMMEN (2026-09-11)

**Kontext.** Der UX-Review vor der öffentlichen Beta hat eine Lücke benannt, die keine
Feature-Lücke war: SkyIsles erklärte sich niemandem. `/` trug „Skylanders Katalog · Entdecke alle
Figuren aus den Skylands" — eine Katalogüberschrift, kein Nutzenversprechen. `de.app.tagline`
existierte und wurde an **keiner** Stelle gerendert. Es gab keine Fußzeile, auf keiner Route, und
damit keinen Ort für Impressum, Datenschutz, Widerruf, AGB oder Kontakt. Der Shop bewegte über
Stripe echtes Geld und hatte keine Adresse: kaufbare Figuren waren goldene Pillen auf einzelnen
von 561 Karten, hinter einer Serienauswahl, die auf Spyro's Adventure startet.

**Entscheidung.** **ADR-0025 bleibt unverändert gültig: `/` ist der Katalog, es gibt keine
Landingpage.** Der erste Akquisekanal ist ein QR-Code auf einem Paket, und eine Marketingseite
zwischen Absicht und Handlung wäre genau der Klick, den ADR-0025 zu Recht abgelehnt hat. Was
fehlte, war nie eine Landingpage — es war ein Satz.

Daraus vier Festlegungen:

1. **Das Nutzenversprechen steht im vorhandenen Katalog-Hero**, und nur für Ausgeloggte. Ein
   angemeldeter Sammler behält die ruhige Arbeitsüberschrift; ein Administrator sieht die Zeile
   nie (ADR-0042). Dazu zwei Aktionen — Registrierung und „Was ist SkyIsles?" — und ein leiser
   dritter Weg in den Shop. Kein Banner, kein Overlay, kein wiederkehrender Hinweis.
2. **`/ueber-skyisles` ist der „eigene Platz"**, den ADR-0025 wörtlich vorgesehen hatte. Ein
   Ziel, kein Eingang: erreichbar aus Fußzeile und Hero, niemals vorgeschaltet. Die Seite deckt
   zugleich den Vertrauensbedarf des Shops, weil sie sagt, wer verkauft.
3. **`/shop` ist eine Sicht, kein zweiter Shop.** Dieselbe Projektion, dieselben Karten,
   dieselbe Verfügbarkeitsregel, keine Stückzahl. Sie beantwortet die eine Frage, die der Katalog
   strukturell nicht beantworten kann: *was verkauft SkyIsles gerade?*
4. **ADR-0036 bleibt ebenfalls unverändert: die Hauptnavigation behält drei Ziele.** `/shop` und
   `/ueber-skyisles` werden über Fußzeile und Hero erreicht. Ob der Shop ein viertes Ziel
   verdient, ist eine Frage für nach der Beta — mit Nutzungsdaten statt mit einer Vermutung.

**Zwei Dinge, die bewusst fehlen.** Die Fußzeile verlinkt **nur existierende Ziele**: ein toter
Link ist schlechter als ein fehlender, und eine Seite namens „Impressum" ohne Impressum ist
schlechter als beides. Und es gibt **keinen Kontaktpunkt**, weil keine Adresse entschieden ist —
eine erfundene wäre ein Kanal, der ins Leere läuft, während `checkout.result.attentionHint` einem
Kunden bereits zusagt, dass sich jemand meldet. Beides ist ein Release-Gate, kein Versehen.

**Konsequenzen.**

- Der QR-Besucher verliert keinen Klick: der Katalog steht weiter unmittelbar auf `/`.
- Ein Fremder kann in zehn Sekunden beantworten, was SkyIsles ist, was kostenlos ist und ob hier
  verkauft wird — ohne dass das Produkt eine Marketingschicht bekommt.
- Sobald Impressum, Datenschutz, Widerruf, AGB und eine Kontaktadresse stehen, ist ihre Aufnahme
  eine Ergänzung der Liste in `site-footer.tsx` und sonst nichts.
- Eine Landingpage nachträglich einzuführen bliebe eine Rücknahme von ADR-0025 und bräuchte einen
  eigenen Eintrag.

**Verworfen:** eine klassische Landingpage vor dem Katalog · eine eigene Startseite für
angemeldete Sammler (ein Dashboard wäre ein zweites Ding, das der Navigation widersprechen kann —
siehe `DEFAULT_SIGNED_IN_PATH`) · Platzhalterseiten für die Rechtstexte · ein vierter
Navigationspunkt für den Shop · ein Onboarding-Tutorial nach der Registrierung.

---

## ADR-0059 — E-Mail-Adressen autorisieren nie; Unternehmensdaten sind zentrale Konfiguration

**Status:** ANGENOMMEN (2026-09-11) · umgesetzt in Migration `0019`

**Kontext.** `docs/SECURITY.md` hielt bisher fest: *„Die Geschäfts-E-Mail kommt im Schema nicht
vor — keine Spalte, keine Policy, keine Funktion, keine Konstante."* Der Transactional-Mail-Block
braucht aber genau eine solche Adresse: als Antwortadresse in jeder Kundenmail und als Empfänger
der internen Prüfwarnung. Und der kommende Legal-Block braucht mehr davon — Betreibername,
ladungsfähige Anschrift, steuerliche Angaben.

**Die Regel meinte zwei Dinge, und nur eines davon bleibt absolut.**

1. **E-Mail-Adressen sind niemals ein Autorisierungsmerkmal.** Kein Code vergleicht eine Adresse,
   um zu entscheiden, wer etwas darf. Autorisiert wird ausschließlich über `shop_admins.user_id`,
   geprüft von `is_shop_admin()` beziehungsweise — für eine Edge Function, die keine `auth.uid()`
   hat — von `is_shop_admin_for(uuid)` mit einer zuvor verifizierten ID. **Diese Regel gilt
   unverändert und ohne Ausnahme.**
2. *Die Adresse steht nirgends im Schema.* Das war eine **Umsetzung** von (1) zu einem Zeitpunkt,
   als es keinen anderen Grund für eine Adresse gab. Als Regel für veröffentlichte Geschäftsdaten
   ist sie falsch: eine Kontaktadresse, die im Impressum, in der Mail und auf der Rechnung steht,
   ist Konfiguration, kein Geheimnis und kein Zugangsmerkmal.

**Entscheidung.**

- **Eine eigene Entität `business_settings`**, nicht zwei Spalten auf `shop_settings`. Die eine
  Tabelle beantwortet, *was SkyIsles verlangt*; die neue, *wer SkyIsles ist*. Verschiedene
  Lebensdauer, verschiedene Leser, verschiedene Sensitivität. Rechtstexte, Mails und die spätere
  Rechnung zitieren dieselbe Angabe — eine Angabe, die drei Oberflächen zitieren, braucht genau
  einen Ort.
- **Heute nur zwei Spalten:** `contact_email` und `transactional_reply_to`. Betreibername,
  Anschrift, Telefon und Steuerangaben kommen mit dem Legal-Block. Eine leere Spalte ist ein
  Versprechen, das niemand geprüft hat.
- **Drei Sensitivitätsstufen, und die strenge ist der Default.** *Öffentlich* (Kontaktadresse,
  später Name und Anschrift) · *intern* (abweichendes Reply-To) · *niemals öffentlich*
  (Steuerangaben). Die Tabelle ist für `anon` und `authenticated` vollständig gesperrt.
- **Der einzige Weg nach außen ist `business_settings_public()`**, eine Projektion, die ihre
  Spalten **wörtlich aufzählt**. Kein `select *`, keine aus dem Katalog gebaute Spaltenliste. Eine
  Spalte, die der Legal-Block hinzufügt, ist damit unsichtbar, bis sie jemand absichtlich
  einträgt — eine Steuernummer kann nicht dadurch öffentlich werden, dass sie neu ist.
  `mail-schema.test.ts` nagelt die Liste fest; das macht aus der Konvention eine Zusicherung.
- **Die Projektion ist heute an niemanden vergeben.** Sie ist definiert, damit ihre Form geprüft
  und getestet werden kann, aber keine öffentliche Seite rendert eine Unternehmensangabe — es gibt
  kein Impressum und keinen Kontaktlink. Der Legal-Block ersetzt ein `revoke` durch ein `grant`,
  in dem Moment, in dem es eine Seite gibt, die die Angabe trägt.
- **Die technische Absenderadresse gehört nicht dazu.** `orders@mail.skyisles.app` und
  `account@mail.skyisles.app` liegen auf der verifizierten Sendedomain und sind
  Umgebungskonfiguration (`MAIL_FROM`). Ein Adminfeld dafür wäre ein Feld, mit dem sich
  Zustellbarkeit in einem Tastendruck zerstören lässt.
- **Ein schmaler Schreiber je Faktengruppe**, nicht eine Funktion für alles:
  `admin_set_business_contact()` heute, `admin_set_business_identity()` später. Eine
  Gott-Funktion hieße, dass jeder Aufrufer jedes Feld übergibt und jede Validierung in einem
  Zweig liegt.
- **Rechtstexte bleiben versionierte Templates im Code.** Der Admin pflegt die veränderlichen
  Fakten, nicht juristischen Freitext.

**Konsequenzen.**

- `docs/SECURITY.md` wird präzisiert: (1) bleibt als Regel, (2) wird als das benannt, was es war.
- Keine Unternehmensangabe steht je in Quelltext, Fixture oder Test. Die Migration legt die Zeile
  leer an; gesetzt wird im Adminbereich. Tests verwenden `@example.com`.
- Der Legal-Block erweitert diese Tabelle und diese Projektion, statt eine zweite Quelle zu bauen.

**Verworfen:** zwei Spalten auf `shop_settings` (Preis und Identität sind verschiedene Fragen) ·
eine Konstante im Code (unveränderlich ohne Deployment, und genau die Hardcodierung, die
`docs/SECURITY.md` verbietet) · die Tabelle öffentlich lesbar machen und die nicht-öffentlichen
Felder später „herausfiltern" (ein Filter, der nach dem Feld kommt, vergisst irgendwann eines) ·
alle künftigen Felder gleich mitanlegen.

**Nachtrag (2026-09-12, ADR-0064).** Die Frage „wer ist SkyIsles" hat ab jetzt zwei Antworten.
Der Legal-Block erweitert deshalb **`sellers`**, nicht `business_settings`: Betreibername,
ladungsfähige Anschrift und steuerliche Angaben gehören auf Rechnung und Widerrufsbelehrung und
damit dem Verkäufer, nicht der Plattform. `business_settings` wird in `0026` zu
`platform_settings` und trägt nur noch plattformeigene Angaben. Alles andere aus diesem ADR gilt
unverändert für beide Entitäten: drei Sensitivitätsstufen mit der strengen als Default · der
einzige Weg nach außen ist eine Projektion, die ihre Spalten **wörtlich** aufzählt · ein
schmaler Schreiber je Faktengruppe · keine leere Spalte ohne Leser · E-Mail-Adressen
autorisieren nie.

Eine benannte Ausnahme von „keine Unternehmensangabe steht je in Quelltext": `0026` legt
`sellers.display_name` mit dem Wert `yulez.collectibles` an. Das ist ein öffentlich geführter
Handelsname, kein Geheimnis und kein Zugangsmerkmal, und ohne ihn wäre der Datensatz eine
namenlose Zeile — genau das leere Versprechen, das dieses ADR vermeiden will. Kontaktadresse
und Antwortadresse werden weiterhin **nicht** in der Migration gesetzt, sondern aus dem
Bestand kopiert.

---

## ADR-0060 — Commerce hat einen Modus; „Test" ist eine Eigenschaft der Bestellung, keine Umgebung

**Status:** ANGENOMMEN (2026-09-11) · umgesetzt in Migration `0021`

**Kontext.** SkyIsles soll auf der echten Domain, mit echten Konten und der echten Datenbank
geprüft werden, während Stripe im Testmodus bleibt und kein gewöhnlicher Besucher zur Kasse
kommt. Bisher war „darf jemand kaufen" gar keine Frage, die das System gestellt hat:
`create_order()` verkaufte an jeden, der die Funktion erreichte.

**Entscheidung.** Eine Spalte, eine kleine Tabelle, ein Prädikat.

| | |
|---|---|
| `commerce_settings.mode` | `closed` · `sandbox` · `live` |
| `commerce_testers(user_id)` | wer im Sandbox-Modus kaufen darf |
| `commerce_checkout_allowed()` | die eine Antwort, die `create_order()` einholt |

**Warum kein zweites Environment.** Eine getrennte „Testumgebung" auf Production wäre eine
zweite Datenbank, zweite Konten, zweiter Bestand — also genau das, was hier nicht getestet
werden soll. Die Frage ist nicht *wo* getestet wird, sondern *wer* gerade kaufen darf. Das ist
eine Berechtigung, und Berechtigungen haben in diesem Schema seit ADR-0032 eine feste Form:
eine Tabelle mit `user_id`, eine `is_…()`-Funktion, kein Rollensystem.

**Warum der Modus zusätzlich auf der Bestellung landet.** `orders.commerce_mode` ist durch den
Immutability-Trigger eingefroren. Eine Testbestellung muss **Jahre später** noch als solche
erkennbar sein — auch und gerade, nachdem der Shop live gegangen ist. Ein Kennzeichen, das aus
der *heutigen* Einstellung abgeleitet wird, schreibt Geschichte um, sobald die Einstellung sich
ändert. Genau das darf nicht passieren.

Dieselbe Spalte ist zugleich die Zahlungsschranke: `start_payment_attempt()` verweigert eine
Bestellung, deren Modus nicht mehr der aktuelle ist. Eine Sandbox-Bestellung wurde gegen
Stripe-Testmodus kalkuliert; sie mit Live-Schlüsseln zu bezahlen wäre eine echte Abbuchung für
einen Testkauf.

**Die Stripe-Konsistenz hat genau eine Quelle.** Der Modus steht in der Datenbank, und beide
Edge Functions fragen ihn dort. `create-payment` vergleicht ihn mit dem Präfix des eigenen
Stripe-Schlüssels (`sk_test_`/`rk_test_` gegen `sk_live_`/`rk_live_`) und verweigert **jede**
Unklarheit: unlesbarer Modus, unlesbarer Schlüssel, fehlender Schlüssel, geschlossener Shop.
Der Webhook vergleicht ihn mit seinem eigenen `STRIPE_LIVEMODE` und verarbeitet bei
Widerspruch **gar nichts** (503, damit Stripe die Zustellung behält).

`STRIPE_LIVEMODE` wird als `Deno.env.get(…) === "true"` gelesen — ein Boolean, nie `undefined`.
Für `sandbox` und `closed` genügt es deshalb, die Variable **nicht zu setzen**; ein
ausdrückliches `false` ist nicht nötig und ändert nichts. Der einzige Wert, der Live-Events
freischaltet, ist die exakte Zeichenkette `true`, und diese Asymmetrie ist die Absicht: Jede
Unklarheit landet auf der Testseite, nie auf der Live-Seite. Ein zweiter Modus in einer
Environment-Variablen wäre eine zweite Wahrheit, die von der auf der Bestellung abweichen kann —
und die Abweichung wäre erst sichtbar, wenn jemand echtes Geld bezahlt hat.

**Durchsetzung liegt in der Datenbank, nicht in der Oberfläche.** `create_order()` ist über
PostgREST mit dem Anon-Key erreichbar; eine Prüfung in TypeScript wäre einen Request weit von
„übersprungen" entfernt. Die Oberfläche entscheidet nur, ob ein Formular angeboten wird.

**Drei Stellen fragen, und jede fragt ihre eigene Fassung der Frage:**

1. `create_order()` — darf **diese** Identität jetzt bestellen? (Modus + Tester + angemeldet)
2. `authorize_order_payment()` — gehört die Bestellung im Sandbox-Modus noch einem **aktuellen**
   Tester? Ein entzogenes Testerrecht stoppt damit auch schon geöffnete Checkouts.
3. `start_payment_attempt()` — ist der Modus der Bestellung noch der aktuelle?

**Gastbestellung im Sandbox-Modus ist aus**, und zwar strukturell: Ein Gast hat keine `user_id`,
und `is_commerce_tester_for(NULL)` ist falsch. Es gibt keinen Zweig, der das anders beantwortet.

**Testinventar: echter Bestand, mit einem Knopf zurück.** Ein Sandbox-Kauf geht durch den
echten Reservierungs- und Bewegungspfad — das ist der Zweck einer Production-Sandbox. Er senkt
also echten Bestand. `admin_revert_sandbox_stock()` bucht für jede tatsächlich konvertierte
Position eine `return`-Bewegung; korrigiert wird durch neue Bewegungen, nie durch Bearbeiten
(ADR-0037). Die Funktion verweigert jede Bestellung, die nicht im Sandbox-Modus entstand, und
ist über ein Order-Event idempotent.

Während `sandbox` gilt, kann ohnehin **niemand sonst kaufen** — ein vorübergehend falscher
verfügbarer Bestand schadet keinem echten Kunden.

**Konsequenzen.**

- Der Standardwert ist `closed`. Das Anwenden der Migration **schließt** den Checkout, bis
  jemand ihn bewusst öffnet. Auf Production ist Schweigen die sichere Antwort.
- Bestehende Bestellungen werden auf `sandbox` nachgetragen — wahrheitsgemäß: es gab nie einen
  Live-Schlüssel in irgendeinem Deployment.
- `orders.commerce_mode` bekommt **keinen** Default. Ein künftiger Pfad, der den Modus vergisst,
  soll laut scheitern statt plausibel auszusehen.
- Admin ist **nicht** automatisch Tester. `is_commerce_tester()` liest nur `commerce_testers`.
- Die Adminsuche darf eine E-Mail lesen, um ein Konto zu **finden**. Freigeschaltet wird die
  `user_id`. `admin_set_commerce_tester()` nimmt nichts anderes entgegen (ADR-0032).
- `commerce_access()` gibt dem Client `may_checkout` und einen groben Grund — **nie den Modus**.
  Ein Besucher erfährt, dass er nicht bestellen kann, nicht dass gerade getestet wird.

**Verworfen:**

- **Ein generisches Feature-Flag-System.** Drei Werte in einer Spalte beantworten die Frage, die
  es heute gibt. Ein Framework für künftige Betas wäre eine Abstraktion über einem einzigen Fall.
- **Ein dedizierter, nicht öffentlicher Testartikel.** `is_shop_eligible()` verlangt
  `catalog_visible`; ein verkaufbarer Testartikel müsste also im Katalog stehen. Ihn zu
  verstecken hieße, eine neue „Testartikel"-Dimension durch `shop_offers()`, `is_shop_eligible()`
  und die Katalogansicht zu ziehen. Und er würde das Falsche prüfen: dass der Checkout für
  Phantasieartikel funktioniert.
- **Eine separate Sandbox-Bestandsdimension.** `shop_inventory` ist über `(sky_id, condition)`
  identifiziert; eine dritte Dimension ändert Primärschlüssel, `shop_offers()`,
  `reserve_for_order()`, `convert_order_reservations()`, die Admin-UI und die
  Reconciliation-View. Die mit Abstand größte Variante, für den kleinsten Gewinn.
- **Sandbox-Bestellungen konvertieren gar keinen Bestand.** Dann bliebe der riskanteste Teil des
  Zahlungspfads — Reservierung → Bewegung — im Test ungeprüft, und der Test wäre kein Test.
- **`STRIPE_LIVEMODE` als alleinige Wahrheit.** Eine Environment-Variable kann von der Datenbank
  abweichen; die Bestellung trägt den Modus der Datenbank.
- **Eine Rolle `TESTER` neben `USER`/`ADMIN`.** Additiv und klein, wie `shop_admins` — nicht eine
  Hierarchie, in der ein Admin automatisch alles darf.

---

## ADR-0061 — Warenkorb, Capability und Lieferdaten gehören einem Konto, nicht einem Browser

**Status:** ANGENOMMEN (2026-09-11) · umgesetzt in Migration `0022`

**Beobachtet im manuellen Browsertest.** Artikel als Gast in den Warenkorb gelegt, abgemeldet,
mit einem anderen Profil angemeldet — derselbe Warenkorb war noch da. Und mehr: Das zweite Profil
bekam *„Offene Bestellung SI-2026-001025 · Diese Bestellung gehört zu einer anderen Sitzung."*
angezeigt, samt Schaltfläche „Zahlung erneut starten".

**Root Cause, in einem Satz.** Jeder Zustand des Checkouts lag unter einem **festen Schlüssel ohne
Eigentümer**:

| Was | Wo | Folge |
|---|---|---|
| Warenkorb | `localStorage["skyisles.cart.v1"]` | ein Warenkorb je Browser, nicht je Konto |
| Offene Bestellung | `sessionStorage["skyisles.pay.v1.open"]` | überlebt den Logout, der Tab überlebt ihn auch |
| Capability | `sessionStorage["skyisles.pay.v1.<nr>"]` | dito, und sie funktioniert weiterhin |

Der **Browser** war die Identität, nicht das Konto. Ein Wechsel des Kontos änderte deshalb an
keinem dieser Schlüssel irgendetwas.

Wichtig für die Einordnung: Die Datenbank hat nie etwas Falsches herausgegeben.
`authorize_order_payment()` hat die fremde Bestellung korrekt verweigert — deshalb *stand da* auch
„gehört zu einer anderen Sitzung". Das Leck war, dass die Oberfläche eine fremde Bestellnummer
überhaupt anzeigte und eine Aktion dazu anbot. Hätte derselbe Tab noch die Capability des ersten
Kontos gehalten, wäre aus der Anzeige eine **funktionierende Zahlung für eine fremde Bestellung**
geworden: `authorize_order_payment()` ist ein ODER aus Konto **oder** Capability.

### Entscheidung 1 — Warenkorb: Server für Konten, `localStorage` nur für Gäste

Verglichen wurden die beiden vom Nutzer genannten Varianten:

| | `localStorage` nach `user_id` namespacen | **Serverseitiger Kontowarenkorb** |
|---|---|---|
| Isolation | *versteckt* fremde Körbe | *unerreichbar* über RLS |
| Auf dem Gerät | jeder Korb bleibt lokal liegen | nichts Fremdes liegt lokal |
| Zweites Gerät | eigener Korb je Browser | derselbe Korb |
| Kosten | keine Migration | eine Tabelle, vier Policies |

Gewählt: **der Server**, für Angemeldete. Dieses Schema hat genau *einen* Mechanismus für „nur der
Eigentümer", und `collection_items` benutzt ihn seit `0001`: RLS über `auth.uid()`. Ein
Schlüsselname ist kein Mechanismus — er verbirgt, er verhindert nicht. Und die Erwartung, dass ein
Warenkorb auf dem Telefon derselbe ist wie am Rechner, ist eine normale Shop-Erwartung, keine
Erweiterung.

**Das ist keine Umkehr von ADR-0043.** Dort steht unter *„Nicht in dieser Runde"* wörtlich:
*serverseitiger Warenkorb, Kontobindung des Warenkorbs*. Es ist diese Runde. Was unverändert
bleibt: Ein Warenkorb reserviert nichts, bucht nichts, fasst `shop_inventory` und `reserved` nicht
an, und gerechnet wird immer mit `shop_offers()` von heute — der gespeicherte Preis dient nur dem
Hinweis „Preis geändert".

**Gäste behalten `localStorage`**, weil ein Gast kein Konto hat, an dem eine Zeile hängen könnte.
Der Schlüssel heißt jetzt `skyisles.cart.v2.guest` und trägt den Eigentümer im Namen.

**Der alte Schlüssel wird nicht migriert, sondern verworfen.** Es lässt sich nicht feststellen,
wem er gehörte — und zu raten ist genau der Fehler, der das Leck erzeugt hat. Ein paar Leute
bekommen einmal einen leeren Warenkorb.

### Entscheidung 2 — jeder Browser-Schlüssel trägt einen Principal

`guest` oder `u.<user_id>`, gesetzt von einer winzigen Client-Komponente in beiden Layouts, die
die vom Server bekannte `user_id` weiterreicht. Beim Wechsel wird **jeder** Zahlungs-Schlüssel
eines anderen Principals aus dem Tab entfernt, ebenso die alten Schlüssel ohne Eigentümer.

Eine Capability folgt einem Menschen **nicht** über einen Identitätswechsel — auch nicht vom Gast
ins eigene Konto. Das ist ein bewusster Verlust: Die Bestellung selbst bleibt erreichbar, über
Nummer und Bestellmail.

Der Principal ist **keine Sicherheitsgrenze** und gibt nicht vor, eine zu sein. Die Datenbank
entscheidet, wer eine Bestellung sehen darf; das hier verhindert, dass ein Browser einem Menschen
den Zustand eines anderen überhaupt *anbietet*.

### Entscheidung 3 — die offene Bestellung wird erfragt, nicht geglaubt

`sessionStorage` sagt jetzt nur noch, *welche* Bestellung dieser Tab bezahlt hat. Bevor irgendetwas
angezeigt wird, fragt die Seite `order_payment_state()`. Kommt keine Zeile zurück — weil der
Aufrufer nicht autorisiert ist —, wird der Hinweis **verworfen statt gerendert**, und die lokalen
Schlüssel werden gelöscht.

### Entscheidung 4 — der Zahlungs-CTA kommt aus dem Zahlungszustand

`order_payment_state()` liefert zusätzlich `attempts`. Daraus:

| Zustand | CTA |
|---|---|
| Bestellung da, **0** Versuche | **Zahlung starten** |
| **≥ 1** Versuch, nicht abgeschlossen | **Zahlung erneut starten** |
| bezahlt · storniert · erstattet · `needs_resolution` | **kein CTA** |

Vorher wurde die Beschriftung daraus abgeleitet, *dass* eine Bestellung existierte — was die
Frage nicht ist.

### Entscheidung 5 — gespeicherte Lieferdaten sind eine eigene Tabelle

`customer_contacts`, nicht Spalten auf `profiles`. Ein Profil ist die öffentliche Hälfte einer
Identität — Benutzername, Avatar; dies ist eine Postanschrift. In einer Tabelle entschiede **eine**
Policy über beides, und an dem Tag, an dem eine öffentliche Sammlerseite Profile breiter lesbar
macht, ginge die Anschrift mit.

**Die Bestelladresse bleibt ein Snapshot.** `order_addresses` wird von `create_order()` geschrieben
und vom Append-only-Trigger aus `0010` eingefroren. `customer_contacts` ist ein **Vorschlag für
ein Formular**; eine Änderung dort kann eine alte Bestellung nicht umschreiben. Genau dafür sind
es zwei Tabellen. `0022` fasst weder `create_order()` noch `order_addresses` noch den Trigger an —
ein Test prüft das am Migrationstext.

Das Speichern ist **opt-in und standardmäßig aus**: Die Anschrift eines Menschen aufzubewahren ist
dessen Entscheidung, nichts, das ihm passiert. Löschen ist im Kontobereich jederzeit möglich.

### Entscheidung 6 — der Kontobereich bekommt eine Struktur

`/settings` war Benutzername, Passwort und Abmelden in einer Spalte; eigene Bestellungen gab es
nirgends. Jetzt `/account` als Einstieg mit vier Zielen: **Profil**, **Kontakt & Lieferadresse**,
**Meine Bestellungen**, **Konto & Sicherheit**. Mobile-first eine Spalte voller daumengroßer
Zeilen — keine Tabs, keine Sidebar: auf dem Telefon sind beides Reihen zu kleiner Ziele.

`/settings` bleibt als permanenter Redirect; der Pfad steht in Lesezeichen und im Onboarding.
Abmelden wandert nach „Konto & Sicherheit" — eine destruktiv wirkende Schaltfläche in einer Leiste,
die auf jedem Bildschirm steht, trifft irgendwann jemand versehentlich.

**Meine Bestellungen** liest `my_orders()` / `my_order()` statt der Tabelle: Ein Tabellenrecht ist
spaltenblind, und `orders` trägt `client_hash`, `payment_token_hash` und `request_id`. Dieselbe
Begründung, die `shop_offers()` zu einer Funktion gemacht hat (ADR-0043). Gastbestellungen
erscheinen dort **nicht** — sie haben keine `user_id`, und über die E-Mail-Adresse zu matchen hieße,
eine Adresse zu einem Zugangsmerkmal zu machen (ADR-0032).

**Konsequenzen.**

- Zwei neue Tabellen, beide mit denselben vier Eigentümer-Policies wie `collection_items`.
- `order_payment_state()` wächst um `attempts` und wird dafür gedroppt und neu angelegt.
- Der Commerce-Modus aus ADR-0060 bleibt vollständig erhalten; `0022` fasst ihn nicht an.
- Ein Gast merkt vom Ganzen nichts außer einem neuen Schlüsselnamen.

**Verworfen:** `localStorage` nach `user_id` namespacen (versteckt statt verhindert) · Adresse als
Spalten auf `profiles` (eine Policy für zwei Empfindlichkeiten) · Warenkorb-Merge per „größere
Menge gewinnt" (verliert stillschweigend eine Zeile, die jemand gewählt hat) · Gastbestellungen
über die E-Mail-Adresse ins Konto holen · den alten Warenkorbschlüssel migrieren · ein
Kontext-Provider statt eines Modul-Stores für den Principal (zwei Antworten, wo es eine gibt).

---

## ADR-0062 — Die Sendungsnummer ist eine Eigenschaft des Pakets, nicht des Versandereignisses

**Status:** ANGENOMMEN (2026-09-11) · umgesetzt in Migration `0023`

**Beobachtet im Betrieb.** Der reale Ablauf des Betreibers: Versandlabel kaufen, Nummer
eintragen, die Bestellung *später* als versendet markieren — und gelegentlich ein Label
stornieren und gegen ein neues tauschen. **Beides war unmöglich.**

**Root Cause: zwei Regeln, an zwei Stellen, die dasselbe verschweißten.**

| Woher | Was |
|---|---|
| CHECK `orders_tracking_number_shape` | verlangte `fulfillment_status <> 'unfulfilled'` — eine Nummer konnte auf einer unversendeten Bestellung gar nicht existieren |
| `orders_protect_fulfillment()` | warf bei **jeder** Änderung an `tracking_number` außerhalb des Übergangs |

Zusammen: Die Nummer war nur im exakten Moment des Versands schreibbar und danach nie wieder.

Der Fehler war eine Vermischung von Zuständigkeiten. `orders_protect_fulfillment()` ist der
Wächter über *Fulfillment*; dass es auch über die Sendungsnummer wachte, war eine zweite Regel
im Mantel der ersten.

**Entscheidung: zwei unabhängige Zustände.**

| Zustand | Bedeutung | Regel |
|---|---|---|
| `fulfillment_status` | Ist es raus? | genau ein Übergang, unverändert bewacht |
| `tracking_number` | Welches Paket ist es? | frei setzbar, vorher wie nachher |

**Was ausdrücklich nicht wackelt.** `shipped_at` kommt weiterhin von der Serveruhr und nur beim
Übergang — eine Korrektur der Nummer bewegt es nicht, und der Trigger pinnt es im
Nicht-Übergangs-Zweig ausdrücklich auf den alten Wert. Fulfillment läuft weiterhin
`unfulfilled -> shipped` und sonst nichts. Fulfillment darf `needs_resolution` weiterhin nicht
mitändern. Identität, Beträge und Adresse bleiben von `orders_protect_immutable()` und den
Append-only-Triggern eingefroren — `0023` fasst keinen davon an.

**Eine Korrektur verschickt nichts.** Drei Gründe, und der erste ist der beste:

1. `admin_set_tracking_number()` ruft den Mailpfad **nicht auf**. `send-order-mail` wird vom
   Adminvorgang erreicht, nie aus der Datenbank.
2. Der Primärschlüssel von `order_mail` `(order_id, kind)` ließe eine zweite
   `shipping_confirmation` ohnehin nicht zu.
3. `sent` ist endgültig, auch gegen `force` (ADR-0059).

**Historie.** Jede Änderung schreibt ein `tracking_updated`-Event; eine Nicht-Änderung schreibt
nichts, damit die Historie lesbar bleibt. Die **Nummer selbst steht nicht in der Nutzlast** —
ein Event wird von mehr Augen gelesen als die Bestellung, und die alte Referenz hat dort keinen
Zweck. Was drinsteht: ob vorher eine da war, ob jetzt eine da ist, ob die Bestellung schon
versendet war.

**`admin_mark_order_shipped()` bekommt ein `coalesce`.** Vorher konnte keine Nummer vor dem
Versand existieren, also war „ohne Nummer versenden" ein No-op. Jetzt würde es das gestern
gekaufte Label wegwerfen.

**Eine Eingabe, nicht zwei.** Das Versandformular hat sein Trackingfeld verloren. Zwei Felder für
denselben Wert auf einer Seite sind eine Frage danach, welches zählt. Es nennt in seiner
Rückfrage weiterhin die eingetragene Nummer — sie ist eines der zwei Dinge, an denen jemand
merkt, dass er die falsche Zeile offen hat.

### Der Trackinglink

Ein zentraler Helfer, `trackingUrl(code, nummer)`, benutzt von **beiden** Bestellseiten — der des
Betreibers und der des Kunden —, damit die zwei sich nicht darüber uneinig werden können, was
klickbar ist.

**Der Carrier ist der Code, nicht der Name.** `shipping_method_name` ist, was dem Kunden gezeigt
wurde, und darf umbenannt werden; `shipping_method_code` ist, worauf `shipping_catalog()`
schlüsselt. Ein aus dem Anzeigenamen gebauter Link bräche beim ersten „DHL Paket", still.
Deshalb tragen `admin_order()` und `my_order()` den Code jetzt mit.

**Nichts wird erfunden.** Unbekannter Carrier → **kein Link**, Nummer trotzdem sichtbar. Ein
falscher Trackinglink schickt jemanden auf eine Seite, die sagt, sein Paket existiere nicht — das
ist schlechter als kein Link.

**Die Referenz kommt nie ungeprüft in eine URL.** Sie muss wie eine Sendungsnummer aussehen
(`[A-Za-z0-9][A-Za-z0-9-]{2,63}`) **und** wird zusätzlich `encodeURIComponent`-kodiert. Die
Prüfung allein würde reichen, die Kodierung allein auch; beide zusammen heißen, dass ein
gelockertes Muster nicht sofort ein Loch ist. `rel="noreferrer"`: Die Seite eines Carriers geht
nichts an, von welcher Bestellseite jemand kam.

`src/lib/layout/domain.test.ts` verbietet absolute URLs in `src/`. `tracking.ts` steht dort jetzt
als **einzige benannte Ausnahme**, mit einer zusätzlichen Prüfung, dass darin nur
Carrier-Hostnamen über `https` vorkommen. Der Fehler, den dieser Wächter verhindert — ein
Redirect oder ein Canonical auf den falschen *SkyIsles*-Host — ist von einer Carrier-URL nicht
auslösbar.

### Abmelden

Abmelden verlässt **„Konto & Sicherheit"** und steht als eigene Aktion unten im Kontobereich.
„Konto & Sicherheit" ist dafür da, *etwas am Konto zu ändern* — Passwort, Zugangsadresse, eines
Tages das Konto löschen. Gehen ist keine Änderung am Konto, und es eine Ebene tief zu vergraben
heißt, danach suchen zu müssen. Weiterhin ein `POST`, damit kein Prefetcher eine Sitzung beenden
kann.

**Konsequenzen.**

- `0023` ist rein additiv bis auf einen CHECK, der in place ersetzt wird. Kein `DROP` einer
  Funktion, keine Tabelle, keine Zeile angefasst.
- Commerce Test Mode (ADR-0060) und Kontozustand (ADR-0061) bleiben unberührt; ein Test prüft
  das am Migrationstext.
- Eine dritte Versandart bräuchte einen Eintrag in `TRACKING_URLS` — `tracking.test.ts` schlägt
  fehl, bis sie einen hat oder ausdrücklich als eine ohne Link geführt wird.

**Verworfen:** Tracking in `admin_mark_order_shipped()` korrigierbar machen (dann korrigiert man
eine Nummer, indem man so tut, als versende man erneut) · die alte Nummer ins Event schreiben ·
den Link aus `shipping_method_name` bauen · für unbekannte Carrier einen Suchlink raten · den
Domain-Wächter ganz abschalten statt eine benannte Ausnahme zu führen.

---

## ADR-0063 — „Offen" heißt nicht abgeschlossen, und zwar überall dasselbe

**Status:** ANGENOMMEN (2026-09-12) · umgesetzt in Migration `0024`

**Beobachtet auf Production am 2026-09-12.** `SI-2026-001004` stand auf
`pending` / `unfulfilled`, weil der Stripe-Webhook auf eine falsche URL zeigte. Die Zeile im
Admin war beschriftet mit **„Offen · Ausstehend · Nicht versendet"**. Der Filter darüber hieß
**„Nur offene"**. Die Bestellung erschien dort **nicht** — sie war nur unter „Alle Bestellungen"
zu finden.

**Root Cause: ein Wort, zwei Bedeutungen, zwei Zeilen voneinander entfernt.**

`admin_orders()` sortiert seit `0018` in vier Aufmerksamkeitsstufen:

| Stufe | Bedingung | Beschriftung |
|---|---|---|
| 0 | `needs_resolution` | „Prüfen" |
| 1 | `paid` und `unfulfilled` | „Zu versenden" |
| 2 | `payment_status = 'pending'` | **„Offen"** |
| 3 | sonst | „Erledigt" |

und `p_open_only` filterte auf `attention <= 1`. Stufe 2 — die Stufe, die die Oberfläche selbst
**„Offen"** nannte — war also aus dem Filter **„Nur offene"** ausgeschlossen.

**Die Semantik war gemeint, das Wort war falsch.** Der Filter meinte *„was jetzt Arbeit ist"*:
eine Bestellung prüfen oder ein Paket packen. Ein laufender Checkout ist beides nicht — er
erledigt sich in zwanzig Minuten von selbst. Nur hieß dieselbe Stufe eben „Offen".

**Und es war mehr als kosmetisch.** `fetchOpenOrderCounts()` benutzte denselben Filter für die
Zähler auf `/admin`. Eine hängende Zahlung tauchte damit **nirgends** auf — nicht in der Liste,
nicht im Zähler, nicht im Abzeichen. Genau der Fall, den ein Betreiber sehen muss, war der
einzige, den nichts zeigte.

### Entscheidung

**„Offen" = nicht abgeschlossen**, also die Stufen 0, 1 und 2. Eine Bestellung verlässt den
Zustand, wenn ihr nichts mehr zustoßen kann: bezahlt und versendet, abgelaufen, storniert,
erstattet.

`p_open_only` filtert deshalb auf `attention <= 2`. Stufe 3 bleibt draußen — eine Liste, die
nie leer wird, liest niemand.

**Ein Prädikat, eine Definition — und es steht in SQL.** Die Zähler auf `/admin` nennen
weiterhin die zwei Stufen, die *Arbeit* sind — ein Checkout in der Schwebe braucht niemanden —,
aber sie werden aus **derselben Menge** gezählt, die `p_open_only` zurückgibt. `hasOpenWork()`
beantwortet in TypeScript nur noch „gibt es etwas zu tun"; „ist etwas offen" beantwortet
ausschließlich `admin_orders()`. Eine zweite TypeScript-Funktion, die dieselbe Summe noch einmal
bildet, wäre eine zweite Definition, die irgendwann abweicht.

**Die Beschriftung der Stufe 2 wird „Zahlung offen".** Derselbe Wortlaut, den die Kundenansicht
seit ADR-0061 benutzt (`account.orders.statusLabel.awaiting_payment`). Damit steht das Wort
„offen" nur noch an einer Stelle für den Filter und nirgends mehr für eine einzelne Stufe.

**Warum nicht „`pending` länger als 20 Minuten".** Verlockend, und hier falsch.
`expire_stale_checkouts()` verschiebt einen abgelaufenen Checkout alle fünf Minuten auf
`expired` — eine `pending`-Bestellung, die älter ist, **ist** damit bereits die Anomalie. Ein
Altersfilter versteckte sie hinter einer zweiten Regel, die mit dem Zeitplan des Sweeps
übereinstimmen müsste. Ein Zustand, eine Bedeutung.

**Konsequenzen.**

- `0024` ersetzt **einen Vergleich** in `admin_orders()`. Stufen, Sortierung, Spalten und die
  `is_shop_admin()`-Prüfung bleiben wörtlich gleich; ein Test vergleicht beide Fassungen.
- `OpenOrderCounts` bekommt `inFlight`. Das Nav-Abzeichen bleibt bei `needsResolution`: Ein
  roter Punkt, sobald jemand einen Warenkorb öffnet, wäre die falsche Lautstärke.
- `/admin` zeigt offene Zahlungen als eigene, leise Zeile — getrennt von der Arbeitszeile.
- Keine Bestellung wird verändert. Die Migration liest keine Zeile und schreibt keine.

**Verworfen:** nur die Beschriftung ändern und den Filter lassen (dann bliebe eine hängende
Zahlung unsichtbar — der eigentliche Schaden) · `attention <= 3` (die Liste wäre die Liste aller
Bestellungen und damit kein Filter) · ein Altersfilter auf `pending` · den Zähler getrennt vom
Filter definieren (das war die Ursache).

---

## ADR-0064 — SkyIsles ist die Plattform, yulez.collectibles ist der Verkäufer

**Status:** ANGENOMMEN (2026-09-12) · M0, reine Dokumentation · umgesetzt in `0026` (M2)

**Entscheidung.** SkyIsles ist ab jetzt konzeptionell eine **Collector Platform mit
Marketplace-Layer**, nicht mehr „ein Shop mit Sammlung". Daraus folgen genau zwei Identitäten,
und sie werden ab jetzt nie wieder in einem Wort zusammengefasst:

| | |
|---|---|
| **SkyIsles** | die **Plattform**. Betreiberin des Katalogs, der Konten, der Sammlung, des Checkouts und der Zahlungsabwicklung. |
| **yulez.collectibles** | der **erste und vorerst einzige gewerbliche Verkäufer auf SkyIsles**. Verkäufer der Ware, Vertragspartner des Kunden, Rechnungsaussteller. |

Beides gehört heute derselben Person. Das ist der Grund, warum die Trennung jetzt billig ist —
und kein Grund, sie zu unterlassen: Es sind trotzdem zwei Rechtssubjekte mit verschiedenen
Pflichten.

### Die Runtime bleibt bewusst Single-Seller

**Die Plattform wird ab jetzt konzeptionell seller-fähig gedacht, aber die laufende
Implementierung bleibt absichtlich Single-Seller, bis ein zweiter realer Verkäufer existiert.**

Das ist keine Zwischenstufe auf dem Weg zu einem Marketplace und kein „erster Schritt". Es ist
ein Zustand, der so lange gilt, bis eine neue Entscheidung ihn ablöst. Bis dahin gilt
ausnahmslos:

- **kein `seller_id`** — auf keiner Tabelle, in keiner Migration
- **keine sellerbezogenen Inventory-Strukturen** — `shop_inventory` behält `unique (sky_id, condition)`
- **keine Multi-Seller-Bestellungen** — eine Bestellung hat implizit genau einen Verkäufer
- **keine Seller-RLS** — keine Policy kennt einen Verkäufer
- **kein Seller-Login** — Verkäufer sein ist ein Datensatz, keine Berechtigung
- **kein Seller-Onboarding** — keine Selbstregistrierung, kein Antrag, kein Freigabeprozess
- **kein Stripe Connect**
- **keine Provisionen, keine Payouts**
- **keine privaten Verkäufer**
- **keine Marketplace-Fan-out-Logik** — kein Angebotsvergleich, keine Verkäuferauswahl, keine
  Warenkorbgruppierung nach Verkäufer

### Was stattdessen gebaut wird, und warum überhaupt etwas

Drei Dinge, und alle drei aus demselben Grund: Sie sind später entweder unmöglich oder
unverhältnismäßig teuer.

1. **Das Bewegungsvokabular** (M1, ADR-0065). `inventory_movements.reason` enthält
   `sale_skyisles` — ein Markenname als Domänenbegriff. `reason` steht im
   `is not distinct from`-Tupel von `prevent_inventory_movement_change()`: **Historie kann
   niemals umbenannt werden.** Der einzige unumkehrbare Posten, und er wächst mit jedem Verkauf.

2. **Plattform- und Verkäuferidentität** (M2). `business_settings` beantwortet heute „wer
   SkyIsles ist" und liefert zugleich die Antwortadresse in *Verkäufer*mails. ADR-0059 plant
   dorthin „Betreibername, ladungsfähige Anschrift, steuerliche Angaben" — unter dieser
   Entscheidung ist **keine** davon eine Plattformangabe. Solange die Tabelle zwei Spalten und
   eine fast leere Zeile hat, ist die Trennung eine Migration; sobald Impressum, AGB und
   Widerrufsbelehrung daraus lesen, ist sie eine Änderung an veröffentlichten Rechtstexten.

3. **Die Semantik der FigureCard** (mit UI/UX V3, nicht als eigener Schritt). „Angebote ab
   4,24 €" statt „SkyIsles 4,24 €" — der Preis gehört einem Angebot, nicht der Plattform.

**Der Beleg, dass die Trennung bereits fällig ist:** `orders.tax_regime` friert seit `0011` bei
jeder Bestellung `small_business_19` ein — § 19 UStG. Das ist weder Plattform- noch
Kundeneigenschaft, sondern der Steuerstatus **des Verkäufers**, dauerhaft auf die Bestellung
geschrieben. Das Datenmodell kennt den Verkäufer längst; es hat nur keinen Ort für ihn.

### Sechs Schranken, jede prüfbar

Vorsätze halten eine Sitzung. Diese Sätze sind per Test oder per Diff nachweisbar:

1. **Das Wort `seller_id` kommt in keiner Migration vor.** Als Test, nicht als Absicht: ein
   `grep` über `supabase/migrations/`, der bei jedem Treffer fehlschlägt.
2. **Höchstens ein aktiver Verkäufer, von der Datenbank erzwungen.** Ein partieller Unique-Index,
   der beim Übergang zu mehreren Verkäufern *gelöscht* wird — keine Struktur, die sich ändert.
3. **M2 fasst keine Commerce-Funktion an.** Nicht `create_order()`, `authorize_order_payment()`,
   `confirm_order_payment()`, `shop_offers()`, `convert_order_reservations()`,
   `merge_guest_cart()`. Taucht eine im Diff auf, ist die Phase entgleist.
4. **Verkäufer sein ist keine Berechtigung.** Keine Tabelle verbindet ein Konto mit einem
   Verkäufer. Autorisiert wird weiter ausschließlich über `shop_admins.user_id` und
   `is_shop_admin()` (ADR-0032, ADR-0059).
5. **`active_seller()` ist der einzige Leseweg.** Kein anderer Codepfad liest direkt aus
   `sellers`. Die spätere Multi-Seller-Frage hat damit genau einen Ort.
6. **Kein neues Feld ohne Leser** — ADR-0059 wörtlich: *„Eine leere Spalte ist ein Versprechen,
   das niemand geprüft hat."*

### Verhältnis zu ADR-0021

**ADR-0021 wird nicht aufgehoben.** Der Marketplace-Stopp gilt unverändert, einschließlich des
Satzes *„auch nicht konzeptionell, auch nicht ‚nur das Datenmodell'"* — und die Liste oben ist
seine Umsetzung, nicht seine Ausnahme. Präzisiert wird allein, dass der eine Verkäufer, den
ADR-0032 ff. ohnehin voraussetzen, ab jetzt **benannt** ist statt mit der Plattform
verschmolzen. Es entsteht keine Marketplace-Funktion und kein Marketplace-Datenmodell.

Die Bedingung aus ADR-0021 bleibt die Bedingung: Über einen zweiten Verkäufer wird erst
entschieden, wenn PortalVault nachweislich Nutzer gewinnt.

**Konsequenzen.**

- `CLAUDE.md`, `docs/ROADMAP.md` und `docs/ARCHITECTURE.md` führen die zwei Identitäten getrennt.
- Neue Oberflächentexte sprechen vom **Angebot** oder vom **Verkäufer**, nicht von „SkyIsles",
  wo der Verkäufer gemeint ist. Bestehende Texte werden nicht flächendeckend umgeschrieben —
  sie ändern sich dort, wo ohnehin gearbeitet wird.
- Die Reihenfolge ist M0 → M1 (`0025`) → M2 (`0026`), jede Phase ein eigener Commit, jede zuerst
  auf Staging.

**Verworfen:** einen Multi-Seller-Marketplace bauen (ADR-0021) · nur sprachlich trennen und die
Daten zusammenlassen (der Legal-Block macht das später teuer) · `sellers` mit allen künftigen
Feldern anlegen (ADR-0059) · eine Verkäuferrolle einführen (ADR-0032) · den heutigen Verkäufer
als Zeile in `shop_admins` betrachten (eine Berechtigung ist kein Rechtssubjekt).

---

## ADR-0065 — Der Grund einer Bestandsbewegung benennt das Ereignis, nie den Akteur

**Status:** ANGENOMMEN (2026-09-12) · umgesetzt in Migration `0025` (M1)

**Kontext.** `inventory_movements.reason` kennt seit `0003` unter anderem `sale_skyisles`
(*„sold through the shop"*) und `sale_external` (*„sold elsewhere, eBay included"*). Der erste
Wert trägt einen Markennamen. Unter ADR-0064 ist er falsch: Verkauft später ein anderer
Händler über SkyIsles, verkauft nicht SkyIsles.

**Und der Name ist endgültig.** `reason` steht im eingefrorenen Tupel von
`prevent_inventory_movement_change()`:

```sql
and (new.id, new.inventory_id, new.delta, new.reason, …)
    is not distinct from
    (old.id, old.inventory_id, old.delta, old.reason, …)
```

Kein `update` kommt daran vorbei, auch die Service Role nicht.

**Entscheidung: der neue Wert heißt `sale`.**

Die Achse, die `sale_skyisles` von `sale_external` trennt, ist der **Kanal** — hier verkauft
oder woanders —, nicht der Verkäufer: In beiden Fällen ist der Verkäufer dieselbe Person. Jeder
Name, der einen Akteur benennt, trägt die Unterscheidung auf der falschen Achse ein und ist in
dem Moment falsch, in dem ein zweiter Akteur existiert.

`sale` behauptet genau eine Sache, und die bleibt für immer wahr: Es war ein Verkauf. Der Kanal
ist ohnehin aus den Daten ableitbar — ein `sale` hat eine Bestellung hinter sich
(`order_lines.inventory_id`), ein `sale_external` hat keine. Ein Name muss nicht wiederholen,
was die Beziehung schon sagt. Und der Akteur bleibt frei: Käme je eine Verkäuferzuordnung,
gehört sie in eine eigene Spalte, nicht in den Grund.

Die deutsche Oberfläche nimmt das vorweg: `sale_external` heißt dort **„Externer Verkauf"**.
Das Gegenstück heißt **„Verkauf"**.

**Das Vokabular wächst, es ersetzt nicht.**

- **`sale_skyisles` bleibt dauerhaft im CHECK.** Entfernt man den Wert, scheitert schon das
  `add constraint` an den vorhandenen Zeilen — und ändern lassen die sich nie.
- **Keine Backfill-Aktion, kein `update` auf historischen Bewegungen.** Historie sagt, was damals
  war, und damals hieß es so.
- `sale` bekommt dieselbe Richtungsregel wie `sale_skyisles`: `delta < 0`.
- `convert_order_reservations()` schreibt ab `0025` nur noch `sale`. Es ist der einzige Schreiber
  im ganzen System.

**Konsequenzen.**

- Die Adminliste (`MOVEMENT_REASONS`) bietet neue Buchungen nur noch als `sale` an; die
  Übersetzungstabelle behält `sale_skyisles` als **„Verkauf SkyIsles (historisch)"**, sonst zeigt
  die Bewegungsliste für alte Zeilen einen leeren Grund.
- Jede Abfrage, die `reason = 'sale_skyisles'` als „Shopverkauf" liest, übersieht ab `0025` alle
  neuen. Betroffen sind ausschließlich Testdateien und Prüfprotokolle; sie werden mitgeführt.

**Verworfen:** `sale_platform` (die Plattform verkauft nicht) · `seller_sale` (benennt einen
Akteur, den *jede* Verkaufsbewegung hat, unterscheidet also nichts) · `marketplace_sale` (setzt
einen Marketplace voraus, den es nicht gibt) · `sale_onsite` (liest sich im Handel als
Ladengeschäft) · `sale_internal` (heißt in der Buchhaltung konzerninterne Umbuchung — und in der
Buchhaltung liegt dieses Journal) · `sale_skyisles` umbenennen (technisch unmöglich).

---

## ADR-0066 — Der Handelsname des Verkäufers ist öffentlich, die Zuordnung zum Angebot nicht

**Status:** angenommen · **Datum:** 2026-09-14 · **Migration:** `0027_seller_public.sql`

**Kontext.** ADR-0064 trennt zwei Rechtssubjekte: SkyIsles ist die Plattform,
yulez.collectibles ist der erste und vorerst einzige gewerbliche Verkäufer. `0026` legte die
Tabelle `sellers` an, ließ aber jeden Leseweg für Besucher zu: RLS ohne Policy, Tabellen-Grant
entzogen, `active_seller()` allen entzogen (sie gibt `select s.*` zurück), `admin_seller()` auf
`is_shop_admin()` gegattert, und die Anwendung hält keinen Service-Role-Key (ADR-0051).

Damit konnte die Schnellansicht über dem Katalog einen Preis und einen Kaufknopf zeigen, aber
nicht, **mit wem** der Kunde den Vertrag schließt. Das ist die wichtigere der beiden Angaben.

**Entscheidung.** Eine Allow-List-Projektion `seller_public()` nach dem Muster von
`platform_settings_public()`: `id` und `display_name` des **aktiven** Verkäufers, `security
definer`, `set search_path = ''`, vergeben an `anon` und `authenticated`. Sonst nichts.

**Was ausdrücklich NICHT entschieden wurde.** Die Projektion ist eine **Identität, keine
Relation**. Sie beantwortet „wer verkauft auf SkyIsles", nicht „wer verkauft diesen Artikel".
Es gibt weiterhin kein `seller_id` auf `shop_inventory`, `inventory_movements`, `orders`,
`order_items` oder sonst einer Tabelle; `shop_offers()` ist unverändert; ein Angebot wird nicht
mit einem Verkäufer verknüpft. Es *kann* nicht: `sellers_one_active` garantiert, dass es genau
einen gibt, und eine Fremdschlüsselspalte, die für jede Zeile denselben Wert trägt, ist keine
Beziehung, sondern eine Konstante mit Zeremonie.

**Die Falle, die das benennt.** Mit dieser Migration wird `seller.id` erstmals im Browser
sichtbar. Wer daraus schließt, SkyIsles unterstütze bereits mehrere Verkäufer, irrt. Der
Marketplace-Stopp aus ADR-0021 gilt unverändert. Die echte Offer→Seller-Relation entsteht
zusammen mit einem zweiten realen Verkäufer — dann wird `sellers_one_active` **gelöscht**, und
das ist die Änderung, an der man es merkt, nicht diese hier.

**„Gewerblicher Verkäufer" ist keine Spalte.** Auf SkyIsles verkaufen ausschließlich
gewerbliche Verkäufer; private sind ausgeschlossen (ADR-0021, ADR-0064). Die Aussage ist damit
für jeden Verkäufer wahr und wird als i18n-Text geführt, nicht je Zeile gespeichert. Gäbe es je
private Verkäufer, würde daraus eine Spalte — und dieser Text ein Feld.

**Kein Rating.** Es existiert kein Bewertungsmodell: keine Tabelle, keine Reviews, kein
Review-Count, keine Reputation. Der Identitätsblock ist so gebaut, dass eine echte
Reputationszeile später als dritte Zeile hinzukommen könnte. Bis dahin steht dort nichts —
Sterne ohne Datengrundlage sind Dekoration, die sich als Beleg ausgibt.

**Konsequenzen.** Die einzige neue öffentliche Tatsache ist der Handelsname, der ohnehin auf
jeder Rechnung und im Impressum steht. Rückbau ist eine Zeile:
`drop function if exists public.seller_public();` — additiv, ohne Spalte, Constraint oder Daten.

**Verworfen:** `shop_offers()` um Verkäuferfelder erweitern (Rückgabetyp ließe sich nur über
`drop function` ändern, wiederholte den Namen je Angebotszeile statt einmal je Seite, und
suggerierte einen Join, den es nicht gibt) · eine Spalte `is_commercial` (heute mit genau einem
möglichen Wert) · den Namen als Konstante in der Oberfläche (zweite Quelle der Wahrheit für
einen Rechtsnamen, ADR-0059).

---

## ADR-0067 — Was eine Figur ist, steht in der Datenbank; wem sie gehört, liegt als Siegel darüber

**Status:** angenommen · **Datum:** 2026-09-15 · **Migration:** `0030_card_types.sql`

**Kontext.** Jede Figurenkarte wurde auf einem von zwei Motiven gezeichnet: Silber, oder Gold,
sobald der Betrachter die Figur besitzt. Das ist **eine Achse für zwei Aufgaben**. Ein Dark
Spyro und ein gewöhnlicher Spyro sind verschiedene Sammelobjekte und sahen trotzdem gleich aus,
während „Gold" nichts über die Figur aussagt und alles über den, der sie ansieht.

**Entscheidung.** Die beiden Achsen werden getrennt.

`skylanders.card_type` ist eine **redaktionelle, dauerhafte Tatsache über das Sammelobjekt** —
`standard`, `dark`, `legendary`, `chase`, `prestige` — und bestimmt das Basismotiv. Besitz
bleibt ein Zustand **pro Betrachter**, wird beim Rendern als Overlay über *jedes* Motiv gelegt
und schreibt nie in diese Spalte. Einen Kartentyp `collection` gibt es nicht.

**`chase` ist eng definiert:** ausschließlich besondere **Farben, Materialien und Finishes**
einer bestehenden Figur — Crystal, Pearl, Jade, Glow, Granite, Scarlet, Molten, Bronze,
Metallic, Golden. Es ist **keine allgemeine Special-Edition-Taxonomie**; saisonale und
Event-Editionen (Easter, Halloween, Royale, Nitro, Mystical) bleiben `standard`, bis jemand
etwas anderes entscheidet. `prestige` ist ein gültiger Typ mit eigenem Motiv, den der Admin
setzen kann — **automatisch klassifiziert wird dafür nichts**, der Backfill vergibt ihn null
Mal.

**Besitz wird als Siegel gezeigt, nicht als zweites Motiv.** Der ursprüngliche Plan war ein
zweites, „gesammeltes" Artwork je Kartentyp. Gebaut wurde das auch — die Dateien `*.collected.*`
und die vollständige plain/collected-Architektur existieren und werden von der Build-Pipeline
erzeugt. Sie sind über `USE_COLLECTED_ARTWORK = false` in `lib/catalog/card-template.ts`
**zentral abgeschaltet**, weil die Paare nicht pixelgleich sind: Rahmen und Figur schienen beim
Sammeln zu springen, und eine Zustandsänderung darf das, wovon sie der Zustand ist, nicht
bewegen. Stattdessen liegt `CollectedSeal` — ein goldenes Siegel mit Häkchen aus den
Ownership-Tokens — über der oberen rechten Ecke des Bildfensters. Eine Geometrie, eine Größe,
kein Sonderfall je Kartentyp. Besessen und nicht besessen teilen sich damit **dasselbe**
Basismotiv, und der einzige Unterschied ist das Siegel.

**Der Backfill ist eine Liste, keine Regel.** 76 SKY-IDs, ausgeschrieben: 21 `dark`,
25 `legendary`, 30 `chase`. Kein LIKE, kein Regex, kein Namensabgleich. Die Klassifikation
entstand in der Anwendung, wo `parseVariant()` bereits weiß, dass eine Variante eine Basisfigur
braucht, um Variante *von* etwas zu sein — das unterscheidet „Dark Spyro" von „Dark Pyramid".
Ein Muster in SQL wäre ein zweiter, gröberer Klassifikator, der dem ersten widerspricht. Eine
Liste ist außerdem prüfbar und bleibt stabil, wenn eine Figur umbenannt wird.

**Konsequenzen.** `card_type` ändert **keinen** Namen, keinen Slug, keine Sortierung und keine
Charakterzuordnung — die drei Identitäten aus ADR-0034 bleiben getrennt. Rückbau ist
`alter table public.skylanders drop column card_type;` plus `drop function
public.admin_set_card_type(text, text);`.

**Verworfen:** ein PostgreSQL-Enum (jeder geschlossene Wertebereich im Schema ist `text` +
CHECK; ein Enum-Wert lässt sich nicht entfernen und `add value` rollt nicht sauber zurück) ·
ein Kartentyp `collection` (vermischte wieder die beiden Achsen) · das Vokabular zusätzlich in
`admin_set_card_type()` (zweite Liste, die mitgepflegt werden muss — der CHECK ist die
Wahrheit) · `updated_at` bei einer redaktionellen Änderung mitzuschreiben (die Spalte gehört
dem Import; die drei vergleichbaren Admin-Mutationen lassen sie ebenfalls in Ruhe).

---

## ADR-0068 — Der Anzeigename gehört dem Leser, die Sortierung der Basisfigur

**Status:** angenommen · **Datum:** 2026-09-15 · **Migration:** `0031_special_card_type.sql`

**Kontext.** Drei Dinge liefen in V3.6 zusammen, und alle drei hängen an derselben Frage: was
gehört in die Datenbank, und was wird beim Lesen abgeleitet?

**1. Ein sechster Kartentyp: `special`.** ADR-0067 sagte über `card_type` ausdrücklich: „Nicht
einmal eine vollständige Taxonomie. Saisonale, Event- und Editionsvarianten … bleiben
`standard`, bis jemand anders entscheidet." Jemand hat anders entschieden. `special` ist eine
bewusst **breite** Kategorie: eine zusätzliche offizielle **Form oder Edition** einer
Basisfigur innerhalb derselben Serie — LightCore, Eon's Elite, Nitro, Blue, Power Blue,
Mystical, Granite, die Saison- und Event-Ausgaben, die benannten Einzelformen. 95 Figuren.

**Bei Mehrfachbelegung gewinnt die höchste Stufe:** `legendary > dark > special > standard`.
Eine Zeile hält einen Wert; SKY-0130 „Legendary Chill Light Core" ist beides und bleibt
`legendary`. `chase` steht außerhalb dieser Kette, weil es eine andere Frage beantwortet —
dieselbe Figur in anderer Ausführung, nicht eine stärkere Edition. Genau **eine** Figur wurde
zwischen beiden bewegt: SKY-0117 „Crusher (Granite)".

**2. Der Anzeigename wird abgeleitet, nicht migriert.** Die Quelle schreibt „Legendary Bash"
als Präfix und „Hex (Pearl)" in Klammern. Bis V3.6 wurde alles auf die Klammerform normalisiert
— Sammler sagen aber „Legendary Bash". Also wird jetzt umgekehrt normalisiert, und beide
Schreibweisen landen auf denselben drei Werten.

**`name` bleibt dabei unangetastet, und das ist kein Detail.** Der Katalogimport besitzt die
Spalte und schreibt sie bei jedem Lauf; ein `update … set name` in 0031 hätte bis zum nächsten
Import gehalten. Die Ableitung ist importfest, slug-stabil (ADR-0011: ein vergebener Slug
bleibt) und führt keine zweite Namenswahrheit ein. Es gibt deshalb **keine** neue Spalte
`base_name` oder `sort_name`.

**3. Sortiert wird nach der Basisfigur, nie nach dem Anzeigenamen.** `sortBaseName` war schon
vorher die Wahrheit und bleibt es: „Bash", „Blue Bash" und „Legendary Bash" stehen als ein
Block unter *Bash*. Neu ist die Ordnung **innerhalb** einer Familie — nicht mehr alphabetisch
nach Label, sondern nach Edition: `standard · special · chase · dark · legendary · prestige`.
`lib/shop/surface.ts` verglich als einzige Stelle Anzeigenamen und benutzt jetzt dieselbe
`compareFigures`; es gibt keine Shop-eigene Reihenfolge mehr.

**4. Besitz ist endgültig ein Overlay.** ADR-0067 hielt die `*.collected`-Architektur mit
`USE_COLLECTED_ARTWORK = false` offen. Sie ist jetzt **verworfen**: die Quell-PNGs sind
entfernt, `CardArtworkPair` und das Flag sind gelöscht, und `artworkFor()` nimmt keinen
Betrachter mehr entgegen. Es gibt sechs Basismotive und **ein** Ownership-Overlay
(`collected.png`), das das bisher selbst gezeichnete SVG ersetzt. Ein Flag, das niemand je
setzen wird, ist nur ein zweiter Zustand, über den nachgedacht werden muss.

Mit entfernt: `gold`/`silver` samt dem `TEMPLATE`-Export (seit V3.5 von nichts gerendert), das
einzelne `collection`-Motiv und die zehn `*.collected`-WebPs — zusammen 16 ausgelieferte
Dateien und drei Generationen derselben verworfenen Idee.

**Konsequenzen.** Der Build erzeugt exakt sechs Karten plus ein Overlay und **prüft jetzt, was
er baut**: Maße, echten Alphakanal, ein durchsichtiges Bildfenster und freigestellte
Außenecken. Anlass war ein `special.png`, das in korrekter Größe, aber mit einrastertem
Transparenz-Karo und ganz ohne Alphakanal geliefert wurde — die einzige damalige Prüfung war
die Größe, und es wäre mit vollständig verdeckter Figur ausgeliefert worden.

**Verworfen:** `name` in 0031 massenhaft umzuschreiben (der Import hätte es zurückgesetzt) ·
eine persistente Spalte für den Basisnamen (`sortBaseName` löst es bereits, und eine zweite
Textwahrheit driftet) · `character_id` als Sortierwahrheit (nur 104 von 602 Figuren, und
semantisch breiter: „Lava Barf Eruptor" und „Eruptor" teilen einen Charakter, aber keine
Basisfigur) · eine generische Regel `Name (X) → X Name` (sie hätte „Elite Boomer (2)" zu „2
Elite Boomer" gemacht) · `chase` pauschal in die Prioritätskette aufzunehmen (eine echte
Chase-Ausführung wäre von der breiteren Kategorie verschluckt worden).

---

## ADR-0069 — Eon's Elite ist eine Produktlinie, keine Spielart von „Special"

**Status:** angenommen · **Datum:** 2026-09-15 · **Migration:** `0032_elite_card_type.sql`

**Kontext.** ADR-0068 führte `special` ein, bewusst breit: „eine zusätzliche offizielle **Form
oder Edition** einer Basisfigur innerhalb derselben Serie, wenn keine stärkere Marke greift."
Eon's Elite landete dort zusammen mit LightCore, Granite, Nitro und den Saisonausgaben — mit
**42 von 95** Zeilen war es fast die halbe Kategorie.

**Entscheidung.** Eon's Elite bekommt den siebten Kartentyp: `elite`.

Es gehört nicht zu den anderen. LightCore ist eine **Bauweise**, Granite eine **Ausführung**;
Eon's Elite ist eine **Produktlinie** — eigene Verpackung, eigenes Regal, und seit V3.7 ein
eigenes Motiv. Der Punkt, an dem eine Kategorie aufhört, eine Kategorie zu sein, ist der, an dem
sie sich ihr Bild mit vier anderen Dingen teilt. `special` behält die 53, die wirklich eine Form
von etwas sind, und bleibt damit ein Wort mit Bedeutung.

**`elite` steht außerhalb der Editionskette.** `legendary > dark > special > standard` gilt
unverändert für alle anderen. Eon's Elite konkurriert nie: seine Mitglieder kommen aus einer
kuratierten 42er-Liste, nie aus einem Namen, und keine Figur im Katalog ist zugleich Eon's Elite
und Dark oder Legendary. `chase` steht aus dem anderen Grund daneben — es ist eine Ausführung,
keine Edition.

**Verpackung ist eine andere Dimension als Edition, und das ist der Kern.** Die Linie führt
**drei Zeilen je Figur**: die Series-1-Schachtel, die Series-2-Schachtel und die lose Figur.
Alle drei **sind** Eon's Elite, alle drei bekommen `elite`. Welche davon ein Besucher sieht, ist
eine andere Frage, beantwortet von `catalog_visible`: V1 unterstützt öffentlich ausschließlich
`loose` (ADR-0021), also sind die 14 losen Zeilen sichtbar und die 28 OVP-Zeilen nicht. Keine
Zeile wird gelöscht, keine Sammlungsdaten werden umgehängt, der Admin sieht weiterhin alle 42.

**Die Sichtbarkeit steht ausdrücklich NICHT in der Migration.** `catalog_visible` ist eine
redaktionelle Entscheidung des Administrators (ADR-0039), gesetzt über
`admin_set_catalog_visible()`. Sie aus einer Migration zu schreiben hieße, sie ihm wegzunehmen.
Auf Production ist sie bereits getroffen; Staging hat sie nie erhalten und bekommt sie auf
demselben Weg.

**Der öffentliche Name.** `Elite Boomer - ohne OVP` liest sich als **„Eon's Elite Boomer"** —
abgeleitet, wie jeder Anzeigename seit ADR-0068, ohne dass `name` angefasst wird. Gebaut wird er
aus dem **Charakter**, nicht aus dem Rohnamen: „Elite Boomer" trägt das Wort bereits, und „Eon's
Elite Elite Boomer" ist keine Figur. Derselbe Charakter ist auch die Sortierwahrheit — alle drei
Zeilen stehen im Boomer-Block unter B, nicht unter E für „Eon's".

**Die Migrationsreihenfolge ist zwingend: 0031, dann 0032.** 0031 ist seit 2026-09-15 auf
Staging und darf deshalb nicht mehr verändert werden. 0032 ist auf `card_type = 'special'`
gegattert: auf einer Datenbank ohne 0031 trifft es nichts und schreibt nichts — der Guard fällt
auf „kein Effekt" zurück, nicht auf „falsches Ergebnis". Production hat 0031 noch nicht.

**Konsequenzen.** Sieben Kartentypen, sieben Basismotive, ein Ownership-Overlay. Counts nach
beiden Migrationen: `standard` 432 · `special` 53 · `elite` 42 · `dark` 21 · `legendary` 25 ·
`chase` 29 · `prestige` 0.

**Verworfen:** Eon's Elite in `special` zu belassen (42 von 95 Zeilen, und ein eigenes Motiv
ohne eigenen Typ ist nicht darstellbar) · die Sichtbarkeit in 0032 mitzuschreiben (nimmt dem
Administrator eine Entscheidung, die ihm gehört) · eine Namensheuristik `like 'Elite %'` in SQL
(wäre auch für eine Figur wahr, die schlicht „Elite …" heißt) · die drei Verpackungszeilen zu
verschmelzen (vernichtet historische Daten und eine spätere echte OVP-Architektur) · `elite` in
die Editionskette aufzunehmen (es konkurriert nie, und ein Rang, der nie verglichen wird, ist
eine Behauptung ohne Fall).

---

## ADR-0070 — SkyIsles vergibt neue Katalogeinträge und SKY-IDs selbst

**Status:** angenommen · **Datum:** 2026-09-16 · **Migration:** `0033_admin_created_figures.sql`

**Kontext.** Bis hierher konnte PortalVault keine Figur anlegen. Es validierte SKY-IDs und
upsertete, was der Legacy-Export mitbrachte. ADR-0006 sagte das ausdrücklich: Katalogpflege
bleibt für V1 vollständig im Legacy-System, und dass PostgreSQL die Source of Truth wird, stand
dort als **LATER**. ADR-0001 zog daraus die Konsequenz: „Neue Figuren erhalten ihre ID weiterhin
im Legacy-Projekt über `etl/assign_ids.py`, solange die Excel den Katalog führt."

Das ist die Stelle, an der das nicht mehr trägt. Der Katalog wird im Adminbereich gepflegt
(ADR-0042), die Excel wird abgelöst, und der Weg „Zeile in die Excel, ETL laufen lassen,
exportieren, importieren" ist für eine einzelne fehlende Figur kein Weg, sondern ein Hindernis.

**Entscheidung.** SkyIsles erzeugt ab sofort selbst kanonische Katalogeinträge und vergibt dafür
selbst SKY-IDs. Für **neue** Figuren ersetzt dieser ADR die entsprechenden Teile von ADR-0001 und
ADR-0006. Alles andere an ADR-0001 bleibt unverändert in Kraft: eine SKY-ID wird nie abgeleitet,
nie wiederverwendet, nie geändert.

### Der Namensraum

    SKY-0001 – SKY-0820   historisch, vom Legacy-Projekt vergeben
    SKY-0821 – SKY-8999   produktiver SkyIsles-Allokationsbereich
    SKY-9000 – SKY-9999   reserved system/test range

**Die Legacy-Vergabe ist eingefroren.** `etl/assign_ids.py` vergibt keine neuen
Skylander-IDs mehr. Der Ledger mit `highest_issued: 820` bleibt historische Wahrheit und wird
weder fortgeschrieben noch zurückgesetzt.

**Der reservierte Bereich ist kein Aufräumauftrag, sondern eine Feststellung.** Er ist belegt und
lässt sich nicht räumen: `SKY-9994` und `SKY-9998` tragen auf Production Bestand, Bestellungen,
Reservierungen und Journalzeilen, auf Staging zusätzlich `SKY-9101`, und die Verify-Werkzeuge
ziehen Fixtures aus 9001, 9002 und 9994–9999. Eine SKY-ID ist per Trigger unveränderlich, und
`order_lines.sky_id` ist bewusst **kein** Fremdschlüssel — eine Umnummerierung ließe
Bestellzeilen ins Leere zeigen. Also wird der Bereich nicht geräumt, sondern **deklariert**, und
der Allokator hört davor auf. Damit wird aus „so viele Figuren legt nie jemand an" eine
Bedingung.

**Format und Vergabebereich sind zwei verschiedene Dinge.** `skylanders_sky_id_format` bleibt
`^SKY-[0-9]{4}$` und wird **nicht** verengt — `SKY-9994` ist eine vollkommen gültige SKY-ID. Die
Grenze 8999 gilt ausschließlich für die **automatische Neuvergabe** und steht deshalb in
`admin_create_figure()`, wo die Entscheidung fällt. Die beiden zu verwechseln würde Zeilen
ungültig machen, die täglich benutzt werden.

### Die Vergabe

Eine PostgreSQL-Sequence, `public.sky_id_seq`, `start with 821` — aus demselben Grund, aus dem
`order_number_seq` eine ist (ADR-0053, Migration 0010): `nextval` ist atomar, und es nimmt **nicht
am Rollback teil**. Das Zweite ist hier die Anforderung, nicht die Nebenwirkung. Scheitert ein
Create an einem Constraint, ist seine Nummer verbraucht und der nächste Create nimmt die
folgende. Eine Lücke bedeutet „diese Nummer wurde einmal gezogen" — was genau zutrifft und dem
Legacy-Ledger entspricht, in dem 14 der Nummern unter 820 ebenfalls nie öffentliche Zeilen
wurden.

**Nie `max(sky_id) + 1`.** Zwei gleichzeitige Creates lesen dasselbe Maximum und schreiben
dieselbe Identität. Die Sequence ist für niemanden außerhalb der Funktion lesbar; ein Aufrufer,
der sie erreicht, kann Nummern verbrennen.

**Vorab read-only geprüft (2026-09-16).** Weder Production noch Staging hält eine SKY-ID zwischen
0821 und 8999. Production: 602 Zeilen, oberhalb 0820 nur `SKY-9994` und `SKY-9998`. Staging: 603
Zeilen, oberhalb 0820 nur `SKY-9101`, `SKY-9994`, `SKY-9998`.

### `source` ist Herkunft, sonst nichts

`skylanders.source` ∈ `{import, admin}`, NOT NULL, Default `import`. **Nach erfolgreichem Create
ist eine admin-erzeugte Figur genauso kanonisch wie eine importierte.**

`source` darf **nicht** verwendet werden für Sichtbarkeit, Berechtigungen, Commerce, Kartenoptik,
Ranking oder irgendeine andere fachliche Unterscheidung. Es hat genau eine Aufgabe im Produkt:
`tools/import-catalog.mts` erkennt seine eigenen Zeilen und nimmt admin-erzeugte aus der Warnung
„in the database but not in the export" heraus. Ohne das stünde dort dauerhaft jede neue Figur —
und eine Warnung, die immer feuert, wird nicht mehr gelesen, was ausgerechnet eine wirklich
verschwundene Importzeile unsichtbar machte. Zweiter Zweck außerhalb des Codes: in fünf Jahren
ist noch beantwortbar, woher SKY-0834 kam.

**`source` gehört nie in die Import-Payload.** `src/lib/catalog/import-payload.test.ts` hält das
fest.

### Was der Create tut und was nicht

`admin_create_figure()` ist **eine Transaktion**: Zeile, Notiz und Journaleintrag committen
gemeinsam oder gar nicht. Sie prüft `is_shop_admin()`, zieht die Nummer, prüft die Grenze,
berechnet den Slug und schreibt.

**Sie nimmt keine SKY-ID und keinen Slug entgegen.** Beides gehört der Datenbank; ein Argument
dafür wäre eine Einladung, eine Identität aus dem Browser zu wählen.

**Sie schreibt keine fremde Spalte.** Kein `market_price` (Legacy-Preispfad, ADR-0007), kein
`image_file` (Import, ADR-0009), kein `image_override_path` (Storage, ADR-0046), kein
`character_id` (kuratierte Datei, ADR-0034).

**Neue Figuren starten verborgen** (`catalog_visible = false`). Eine gerade angelegte Figur hat
kein Bild, keine Charakterzuordnung und womöglich einen Arbeitstitel. Sie im selben Moment zu
veröffentlichen zeigt genau das jedem Besucher.

### Charakterzuordnung bleibt unangetastet

ADR-0034 gilt unverändert. `character_id` ist im Anlegen-Dialog nicht editierbar, wird nicht aus
einer Vorlage kopiert, und der Create schreibt NULL. `data/characters/characters.json` bleibt die
vollständige kuratierte Wahrheit. Kein Character-Create aus dem Modal, keine Heuristik, keine
Namenszuordnung. Element ist folglich Anzeige, keine Eingabe — es hängt am Charakter.

### Kein Delete

`collection_items` und `shop_inventory` stehen auf `on delete restrict`, `order_lines.sky_id` ist
gar kein Fremdschlüssel. Ein Delete ist damit entweder blockiert oder hinterlässt still
Bestellzeilen, die auf nichts zeigen. Eine versehentlich angelegte Figur wird über den
bestehenden Editor auf `catalog_visible = false` gesetzt. **Ihre SKY-ID bleibt dauerhaft
vergeben** — das verlangt ADR-0001.

### Slug

ADR-0011 unverändert, aber zum ersten Mal auch in SQL: `public.slugify()` und
`public.next_figure_slug()`. Der Grund, warum die Entscheidung in der Datenbank fallen muss: die
Eindeutigkeitsprüfung und der INSERT müssen in einer Transaktion liegen. In TypeScript zu
rechnen hieße lesen, entscheiden, schreiben — genau die Race, die dieser Entwurf vermeidet.

Zwei Implementierungen derselben Regel sind eine Last, solange nichts sie aneinander hält.
Deshalb: `src/lib/catalog/slug-sql-parity.test.ts` prüft die SQL Schritt für Schritt gegen die
TypeScript-Fassung, und `supabase/tests/0033_slug_parity.sql` führt beide über dieselben
Fixtures aus. Die Erwartungswerte dort sind erzeugt, nicht getippt.

### Zwei Phasen für das Bild, und das wird nicht verschleiert

Ein hochgeladenes Objekt liegt unter `SKY-xxxx/<hash>.webp` — der Pfad braucht die Identität, die
der Create gerade erst vergibt. Es gibt keine Reihenfolge, die beides atomar macht. Also:
**Phase A** legt die Figur an, **Phase B** lädt das Bild unter der zurückgegebenen SKY-ID hoch,
über die bestehende V3.8-Infrastruktur (`stageFigureImage` → `setImageOverride`), ohne zweite
Upload-Architektur.

Scheitert Phase B, **existiert die Figur**. Der Dialog sagt das, bietet Schließen an und ruft
den Create **nie erneut** auf. Ein zweiter Create auf einen fehlgeschlagenen Upload wäre eine
zweite SKY-ID für eine Figur — der eine Fehler, gegen den dieser ganze Entwurf gebaut ist. Das
Orphan-Verhalten bleibt wie in ADR-0046: eine unreferenzierte Datei kostet Speicher, ein
fehlgeschlagener Vorgang kostet Arbeit.

### Duplikate

Keine neue harte Regel. `name` ist bewusst nicht eindeutig und bleibt es: vierzehn Zeilen enden
auf „- ohne OVP", sechs Spiele heißen „Game (Xbox 360)", und Kaos ist Trap, Trophy **und** Sensei.
Ein Unique-Constraint auf `(name, series)` würde legitime Varianten abweisen. Stattdessen eine
**weiche Warnung** vor dem Anlegen, verglichen über die Slug-Form innerhalb derselben Serie —
damit „Dino-Rang" und „Dino Rang" als dieselbe Nachbarschaft erkannt werden. Der Administrator
darf fortfahren. Technisch eindeutig bleiben SKY-ID und Slug.

### Journal

Kein zweites Audit-System. `catalog_admin_changes` lernt zwei Felder: `created` und `card_type`.

`card_type` schließt eine seit 0030 offene Lücke — `admin_set_card_type()` schrieb drei
Migrationen lang eine redaktionelle Spalte, ohne dass irgendetwas es festhielt. Protokolliert
wird im **Trigger**, nicht im RPC: **eine Journalquelle pro Mutation.** Im Setter zu loggen
deckte genau einen Aufrufer; ein Service-Role-UPDATE oder ein späterer zweiter RPC schriebe die
Spalte und hinterließe nichts. Der Trigger sitzt an der Tabelle.

Die Erzeugung protokolliert der RPC selbst als `created`. Der Trigger ist `after update` und
feuert bei einem INSERT nicht — eine neue Figur bekommt also einen Eintrag statt einen pro
Spalte. **Kein Backfill:** eine jetzt erfundene Zeile behauptete Zeitpunkt und Urheber, die
niemand kennt.

### Konsequenzen

- ADR-0006 gilt für **Preise** unverändert weiter (ADR-0007): Preispflege bleibt im Legacy-Pfad.
- Der Import bleibt idempotent und löscht weiterhin nichts.
- **Kategorien erzeugt V3.9 nicht.** Serie und Kategorie kommen ausschließlich aus bestehenden
  kontrollierten Daten, die Kategorie wird nach Serie gefiltert. Fehlt die benötigte Kategorie,
  ist der Create blockiert — kein Freitext als Notausgang. Kategorieverwaltung ist eine eigene
  Runde.
- Der Adminbereich bleibt der Katalog (ADR-0042): „Hinzufügen" steht neben „Filter", nicht auf
  einer eigenen Seite.
- **`data/catalog/products.json` ist nicht mehr der vollständige kanonische Katalog.** Der Export
  bleibt vollständig für die IDs, die das Legacy-Projekt vergeben hat, und kann eine von SkyIsles
  vergebene ID per Konstruktion nie enthalten. Code, der „nicht im Export" mit „existiert nicht"
  gleichsetzt, weist echte Zeilen ab. Wo offline gegen den Export geprüft wird, muss die
  Zuständigkeit ausgesprochen werden — siehe `validateCuratedFile(…, scope)`; die Existenz einer
  produktiven ID beantwortet allein die Datenbank.
- **Eine Charakteridentität ist optional.** `character_id = NULL` ist der Normalfall (ADR-0034)
  und für eine admin-erzeugte Figur genauso gültig wie für eine importierte. Eine Vorlage ohne
  kuratierten Charakter vererbt nichts, und nichts wird aus dem Namen erschlossen. Eine fehlende
  Zuordnung ist kein Mangel und blockiert nichts.
- **Eine Sammlerkarte braucht weder Bestand noch Angebot.** `shop_inventory` und die öffentliche
  Angebotsprojektion sind eigene Entscheidungen über dieselbe SKY-ID (ADR-0037, ADR-0043). Eine
  Figur, die nur im Katalog steht und nie verkauft wird, ist ein vollständiger Katalogeintrag —
  das ist der Regelfall für die Karten, für die dieses Feature gebaut wurde.

**Verworfen.** Eine `SELECT max(sky_id)+1`-Vergabe im Client (race-prone) · den globalen
CHECK auf 8999 zu verengen (macht `SKY-9994`/`SKY-9998` ungültig) · die Fixtures umzunummerieren
(Trigger verbietet es, Bestellzeilen hingen ins Leere) · eine Schleife, die belegte IDs
überspringt (macht den reservierten Bereich zu einer unsichtbaren Mine statt zu einer
dokumentierten Reservierung) · ein Draft-/Pending-Zustand vor dem kanonischen Eintrag (zweite
Katalogtabelle und ein Übernahmeworkflow, den bei einem einzigen Administrator niemand bedient) ·
`character_id` aus der Vorlage zu übernehmen (erzeugte Zuordnungen, die nur in der Datenbank
stehen, und machte `characters.json` zu einem unvollständigen Verzeichnis).

---

## ADR-0070a — „Bestehende Figur als Vorlage" ist eine Aussage über die Sammleridentität

**Status:** angenommen · **Datum:** 2026-09-16 · **Migration:** `0034_create_figure_from_template.sql`
**Ergänzt ADR-0070. Ändert ADR-0034 nicht.**

**Kontext.** V3.9 lieferte zwei Einstiege aus, und der Vorlagen-Einstieg füllte zwei Formularfelder
vor: Serie und Kategorie. Das ist Bequemlichkeit — und nicht das, was der Betreiber meint, wenn er
Fire Kraken als Vorlage wählt. Gemeint ist: *„Was ich anlege, ist ein weiterer Fire Kraken."* Eine
Sonderausgabe, eine Ausführung, eine Farbvariante. Die neue Zeile ist ein anderes **Sammelobjekt**
und derselbe **Charakter**.

**Entscheidung.** Die Vorlage überträgt `character_id`. Damit ist sie keine Vorbefüllung mehr,
sondern die Aussage über die Sammleridentität, die ADR-0034 mit genau dieser Spalte beantwortet.

| Modus | Bedeutung | `character_id` |
|---|---|---|
| **Leer beginnen** | eine wirklich neue, nicht zugeordnete Figur | bleibt `NULL` |
| **Bestehende Figur als Vorlage** | eine weitere Ausgabe einer vorhandenen Figur | von der Vorlage |

**Kein zweites Verhältnis.** Kein `base_figure_id`, kein `template_id`, kein `parent_sky_id`, kein
`derived_from`. Uns interessiert die geteilte Sammleridentität, nicht die Abstammung — und die
steht bereits in `character_id`, die jede Abfrage ohnehin liest. Die gewählte Vorlage wird **nicht**
dauerhaft referenziert; nach dem Anlegen ist die neue Zeile von einer importierten Zeile desselben
Charakters nicht zu unterscheiden, und das ist richtig so.

### Die Vorlage wird übergeben, nicht der Charakter

Die naheliegende Form wäre `p_character_id bigint`. Sie ist die falsche: die Funktion ist für jede
angemeldete Sitzung ausführbar — `is_shop_admin()` entscheidet, **wer handeln darf**, nicht **was
jemand behaupten darf**. Ein Charakterargument machte kuratierte Zuordnungen zu Client-Eingaben.

`admin_create_figure()` nimmt deshalb eine **SKY-ID**, die existieren muss, und liest den Charakter
selbst aus dieser Zeile. Die einzigen Identitäten, die je geschrieben werden können, sind solche,
die der Katalog bereits hält. Eine unbekannte Vorlage wird abgewiesen statt still ignoriert — sonst
entstünde eine Figur, die abgeleitet aussieht und es nicht ist. Ein zusätzlicher Lookup ist dafür
der richtige Preis.

### Vorlage ohne Charakter

`character_id` ist auf 500 der 604 Zeilen `NULL` — Traps, Fahrzeuge, Kristalle und alles noch nicht
Kuratierte. Eine solche Vorlage überträgt **nichts**, und der Dialog sagt das, statt ein Verhältnis
zu suggerieren. Das Anlegen bleibt möglich; die neue Figur hat dann ebenfalls keinen Charakter,
genau wie bei „Leer beginnen". **Nichts wird aus dem Namen erraten** (ADR-0034).

### Serie und Kategorie

`character_id` ist **serienunabhängig**: die Spalte trägt keinen Serienbezug, und der
Fremdschlüssel zeigt allein auf `characters (id)`. Die Serie der Figur hängt am Paar
`(category_id, series_code)`. Serie oder Kategorie im Formular zu ändern **trennt die geerbte
Charakteridentität deshalb nicht** — das ist auch fachlich richtig: eine Swap-Force-Variante einer
Figur, die zuerst in Giants erschien, ist ein realer Fall.

### Was diese Entscheidung *nicht* löst — und warum nicht still

Die Erwartung war, dass „Gold Fire Kraken" durch die geerbte Identität **neben** Fire Kraken
einsortiert. Das tut es nicht, und der Grund ist strukturell:

> **`character_id` erreicht die Sortierung heute nicht.** `sortBaseName` entsteht in `variant.ts`
> aus dem **Namen** und dem Namensindex der Serie. Der Charakter fließt in `element` (ADR-0034) und
> in den Suchindex — nicht in die Sortierung. Einzige Ausnahme: `parseEliteEdition()` setzt
> `sortBaseName` bereits auf einen Charakternamen.

Die Ableitung so zu erweitern, dass ein kuratierter Charakter den Basisnamen bestimmt, wäre der
naheliegende nächste Schritt und ist **bewusst nicht Teil dieser Runde**. Gemessen am echten
Staging-Bestand (read-only, 2026-09-16) beträfe es **30 der 104 verknüpften Figuren**:

    SKY-0274 "Fire Bone Hot Dog"      → Basis "Hot Dog"      Etikett "Fire Bone"
    SKY-0283 "Lava Barf Eruptor"      → Basis "Eruptor"      Etikett "Lava Barf"
    SKY-0287 "Ninja Stealth Elf"      → Basis "Stealth Elf"  Etikett "Ninja"
    … 27 weitere

Inhaltlich sind das fast durchweg **Verbesserungen** — genau die Fälle, die ADR-0034 als durch
Namensregeln unlösbar dokumentiert. Aber: **`sortVariantLabel` wird sichtbar gerendert**
(`figure-card.tsx` zeichnet daraus ein `VariantSeal`). Die Änderung setzte also ein sichtbares
Etikett auf 30 bestehende öffentliche Karten, darunter Fälle wie `SKY-0564 "Kaos in OVP"` mit dem
Etikett „in OVP". Das ist eine Produktentscheidung über den öffentlichen Katalog und keine
Nebenwirkung einer Create-Runde.

**Diese Frage ist mit ADR-0070b entschieden:** der kuratierte Charakter bestimmt die Familie, und
das sichtbare Variantensiegel bleibt allein Sache des Parsers. Die befürchtete Nebenwirkung tritt
nicht ein — gemessen null Siegeländerungen.

**Verworfen.** „Gold" in `VARIANT_TOKENS` aufzunehmen (läse jeden importierten Namen neu, der so
beginnt — eine Kuratierungsentscheidung, die kein Anlegen-Dialog trifft) · `p_character_id` als
Argument (machte kuratierte Zuordnungen zu Client-Eingaben) · ein zweites
Abstammungsverhältnis (zweite Antwort auf eine Frage, die `character_id` beantwortet) · einen
berechneten `sortBaseName` in die Datenbank zu schreiben (die Ableitung bleibt Lesezeit) ·
sortierrelevantes Verhalten an `source` zu hängen (ADR-0070: Herkunft steuert nichts).

---

## ADR-0070b — Sammlerfamilie ist kuratiert, das Variantensiegel bleibt geparst

**Status:** angenommen · **Datum:** 2026-09-16 · **Migration:** keine
**Schließt die offene Frage aus ADR-0070a. Ändert ADR-0034 und ADR-0030 nicht.**

**Kontext.** `sortBaseName` entschied, welche Figuren zusammenstehen, und kam vollständig aus dem
**Namen**: `variant.ts` zerlegt „Legendary Astroblast" in Basis und Etikett, ein Name ohne
erkanntes Token bleibt ganz. Das trägt für die kuratierten Formen und kann für den Rest nicht
tragen — „Dark Turbo Charge D.K." hat null Zeichenüberlappung mit „Turbo Charge Donkey Kong", und
„Legendary Grim Creemper" ist ein Tippfehler in der Quelle. ADR-0034 führt beide als durch
Namensregeln unlösbar auf; genau dafür existiert die kuratierte Verknüpfung.

**Entscheidung.** Drei Begriffe, drei Antworten — und sie bleiben drei:

| Begriff | Woher | Sichtbar? |
|---|---|---|
| **Sammlerfamilie** (`sortBaseName`) | `characters.canonical_name`, wenn ein kuratierter Charakter existiert — sonst unverändert der Parser | **nein**, entscheidet nur die Reihenfolge |
| **Anzeigename** (`displayName`) | unverändert ADR-0030 / ADR-0039 | ja |
| **Variantensiegel** (`sortVariantLabel`) | **ausschließlich** der Variantenparser und seine kuratierte Tokenliste | ja |

Umgesetzt als Lesezeit-Pass `withCharacterFamily()` neben `withCharacterSearch()` und
`withCharacterElement()`. **Er schreibt genau ein Feld.** Das ist die ganze Sicherheitseigenschaft:
eine Figur, deren Familie sich verbessert, behält exakt das Siegel, das sie hatte — einschließlich
gar keinem. Es gibt in dieser Ableitung keinen Code, der ein Etikett erzeugt.

**Kein persistiertes Feld.** Die Familie ist abgeleitet und bleibt es: kein `sort_base_name`, kein
`catalog_base_name`, keine Migration. Ein zweites Feld neben `characters.canonical_name` wäre
genau das, was zuerst veraltet, wenn ein Charakter umbenannt wird.

**Keine Abstammung.** Kein `base_sky_id`, kein `parent_sky_id`. Die geteilte
Sammleridentität steht in `character_id`; „wovon abgeleitet" wird nicht gefragt.

**Kein `source`.** Für importierte und admin-erzeugte Zeilen gilt dieselbe Regel (ADR-0070).

### Gemessen am echten Bestand (Staging, read-only, 2026-09-16)

    sammelbare Figuren:                       565
    Familie geändert:                          44
    SIEGEL GEÄNDERT:                            0
    Anzeigename geändert:                       0
    Sortierposition bewegt:                    66
    Familien ohne führende Basisfigur:          0

Die 44 sind fast durchweg Korrekturen: `Fire Bone Hot Dog` → Hot Dog, `Lava Barf Eruptor` →
Eruptor, `Ninja Stealth Elf` → Stealth Elf, `Dark Turbo Charge D.K.` → Turbo Charge Donkey Kong.
Die beiden Fälle, die eine „Name minus Charaktername"-Regel verdorben hätte, bleiben unbeschriftet:
**`Kaos in OVP`** landet in der Familie Kaos **ohne** Siegel „in OVP", **`Grim Creeper - Lightcore`**
in der Familie Grim Creeper **ohne** Siegel „- Lightcore".

### Die Basisfigur führt ihre Familie

Weil eine Familie nun mehrere unbeschriftete Mitglieder haben kann, entschied sonst der Rohname
alphabetisch — „Big Bubble Pop Fizz" stünde vor „Pop Fizz". Ein Tiebreak in `compareFigures()`:
**wessen Anzeigename der Familienname ist, steht vorn.** Er greift **nach** Serie, Kategorie,
Basisname und Editionsrang; `FAMILY_ORDER` ist unverändert.

### `character_id = NULL`

461 der 565 sammelbaren Figuren. Der Pass gibt sie unverändert zurück — dasselbe Objekt, nicht
einmal eine Kopie. **Keine Namensheuristik**, keine automatische Zuordnung (ADR-0034).

### `display_name_override`

Der Override bestimmt weiterhin allein den **Anzeigenamen** (ADR-0039); daran ändert sich nichts.
Die Familie folgt dem kuratierten Charakter auch dann, denn sie beantwortet eine andere Frage:
*welche Figur ist das*, nicht *wie heißt sie hier*. Heute ist das folgenlos — auf Staging trägt
**keine** Zeile einen Override. Sollte ein Override je mit der Familienzuordnung in Konflikt
geraten, gewinnt der Override für den Namen und der Charakter für die Einsortierung; beides
gleichzeitig zu bedienen ist kein Widerspruch, weil die beiden Werte nichts miteinander zu tun
haben.

**Verworfen.** Ein Etikett aus „Name minus Charaktername" abzuleiten (erzeugte sichtbare Siegel wie
„in OVP" auf 44 bestehenden Karten) · „Gold" in `VARIANT_TOKENS` (läse jeden importierten Namen neu,
der so beginnt) · ein persistiertes Familienfeld · eine Vorlagen-Abstammung · ein paralleles
`collectorFamilyName` neben `sortBaseName` (dasselbe Feld, unsichtbar, ein Konsument — ein zweites
wäre Doppelung ohne Gewinn).

---

## ADR-0071 — Testkonten tragen einzelne Test-Berechtigungen

**Status:** angenommen · **Datum:** 2026-09-16 · **Migration:** `0036_tester_feature_permissions.sql`
**Ersetzt die Speicherung aus ADR-0060/`0021` für Tester. Ändert ADR-0032 nicht.**

**Kontext.** `0021` gab einem Konto eine Sache: `commerce_testers` sagt, wer im Sandbox-Modus zur
Kasse darf. Das war die richtige Größe für eine Frage und ist die falsche für die zweite — die
ehrliche Antwort auf „Performance-Tracking dazu" wäre eine zweite Tabelle derselben Form gewesen,
und auf die dritte eine dritte.

**Entscheidung.** Die Form wird einmal allgemein und danach nie wieder:

| | |
|---|---|
| `testers` | dieses Konto ist ein ausdrücklich benanntes Testkonto |
| `tester_features` | das Vokabular — welche Test-Berechtigungen es gibt |
| `tester_permissions` | dieses Konto darf dieses eine Ding |
| `tester_permission_changes` | wer hat wann was vergeben oder entzogen |

Anfangsvokabular: **`commerce`** (E-Commerce) und **`performance_tracking`** (Performance-Tracking).

### Was das nicht ist

**Kein Rollensystem.** Eine Test-Berechtigung gewährt genau das, was sie nennt: nie eine andere
Berechtigung, nie `shop_admins`. Ein Administrator ist kein Tester, solange ihn niemand auf die
Liste gesetzt hat — die Regel, die `0021` bereits aufgeschrieben hat und die hier gilt.

**Kein Feature-Flag-Framework.** Keine Rollout-Quoten, keine Umgebungssteuerung, kein Ablaufdatum.
Eine Liste von Konten und eine Liste von Dingen, die sie testen dürfen.

### Das Vokabular ist Datum, nicht Schema

Jede andere geschlossene Menge im Schema ist ein CHECK — zu Recht: `card_type` und `commerce_mode`
sind **fachlich** geschlossen. Diese Menge ist ausdrücklich **offen**, und der Unterschied zählt:
ein Enum braucht `ALTER TYPE`, ein CHECK das Droppen und Neuanlegen der Bedingung, eine Tabelle
ein `INSERT`. Die Validierung ist dadurch nicht schwächer — ein Fremdschlüssel weist einen
erfundenen Schlüssel genauso ab. Das deutsche Label steht daneben statt in einer zweiten Liste in
der Anwendung.

**Keine Client-Berechtigung auf irgendeiner der vier Tabellen.** Ein Tester kann weder die
Testerliste noch das Register noch das Journal lesen und sich selbst nichts gewähren.

### Mitgliedschaft ist die Zeile

Kein `enabled`-Flag: die Zeile **ist** der Zustand — dieselbe Entscheidung wie bei `shop_admins`
und `commerce_testers`. Zwei Arten, dasselbe zu sagen, sind zwei Arten, uneins zu werden.
`tester_permissions` hängt an `testers`, nicht an `auth.users`; „Tester entfernen" ist damit **ein
Delete**, die Berechtigungen folgen per Kaskade, und Konto, Sammlung, Bestellungen, Bestand und
Adminstatus bleiben unberührt.

### Commerce läuft unverändert weiter

`is_commerce_tester()` und `is_commerce_tester_for(uuid)` bleiben — gleiche Namen, gleiche
Signaturen, gleiche Rechte. Nur ihre Körper fragen jetzt die generische Berechtigung. Damit ändert
sich an `commerce_checkout_allowed()`, der Bestellsichtbarkeit, `admin_find_accounts()` und
`admin_commerce_state()` **keine Zeile**. Checkout-Logik umzuschreiben, während man den
Berechtigungsspeicher austauscht, wären zwei Risiken in einem Schritt.

`admin_set_commerce_tester()` bleibt ebenfalls und pflegt intern das neue Modell. Sein Entzug
nimmt seit 0036 **nur die Commerce-Berechtigung**, nicht die Mitgliedschaft — ein Konto, das noch
etwas anderes testet, testet es weiter. Genau dafür existiert diese Migration.

### `commerce_testers` bleibt — als Spiegel, nicht als Wahrheit

**Eine Autorität für Lesezugriffe, ein Spiegel für den Rückweg.** Nach 0036 liest **nichts** mehr
`commerce_testers`; seine beiden einzigen Leser sind Hüllen geworden. Die Tabelle bleibt stehen und
wird bei jedem Schreibvorgang nachgeführt, damit ein Zurücknehmen von 0036 funktionierenden
Commerce wiederherstellt — **auch für Tester, die danach hinzukamen**. Ohne den Spiegel verlören
die still ihren Zugang.

Auseinanderlaufen können die beiden nicht in einer Weise, die jemand bemerkt, weil nur eine von
ihnen je befragt wird. Eine spätere Migration entfernt den Spiegel, sobald das generische Modell in
Production gelaufen ist. **Das Aufräumen ist eine Runde Geduld wert.**

### Journal

`tester_permission_changes`, absichtlich schmal und append-only. `catalog_admin_changes` ist für den
Katalog und sein CHECK sagt das; sie zu dehnen hieße, `entity` zwei unverwandte Dinge bedeuten zu
lassen. Mitgliedschaft wird mitprotokolliert, ohne das Feld zu verwässern: `permission` ist `NULL`
für `added`/`removed` — genau das, wonach „hierbei ging es nicht um eine Berechtigung" aussieht.
**Kein Fremdschlüssel auf `testers`:** ein Eintrag über eine Entfernung muss die Entfernung
überleben, sonst wäre das Journal sinnlos.

**Verworfen.** Eine zweite Tabelle je Testfunktion (die Form, die dieser ADR abschafft) · eine
breite Tabelle mit `can_*`-Spalten (eine Migration je künftiger Funktion) · Enum oder CHECK für das
Vokabular (DDL statt Datensatz) · ein `enabled`-Flag neben der Zeile · `commerce_testers` sofort zu
droppen (kein Rückweg) · die Checkout-Logik gleich mit umzuschreiben (zwei Risiken auf einmal).

---

## ADR-0072 — Navigationszeiten werden auf Testkonten gemessen, nicht auf Nutzern

**Status:** angenommen · **Datum:** 2026-09-16 · **Migration:** `0037_performance_telemetry.sql`
**Baut auf ADR-0071. Ändert an der Navigation selbst nichts.**

**Kontext.** SkyIsles fühlt sich auf dem Telefon langsam an. Die Verdächtigen sind bekannt und
aufgeschrieben — zwei `auth.getUser()`-Runden je Navigation, 2 von 33 Routen mit `loading.tsx`,
abgeschalteter Prefetch auf der Figurenkarte, ein großer Katalog-Payload. **Welcher davon die
gefühlte Sekunde erzeugt, weiß niemand.** Optimieren ohne Messung heißt raten und danach
weiterraten, weil auch das Ergebnis nicht messbar ist.

Die üblichen Werkzeuge helfen hier nicht. `PerformanceNavigationTiming` misst Dokumentladungen —
eine App-Router-Navigation ist keine. Web Vitals als Bibliothek liefern auf **mobilem Safari**
weder INP noch LCP noch CLS noch Long Tasks, und `navigator.connection` gibt es dort nicht. Genau
das Gerät, um das es geht, ist das, über das die Standardwerkzeuge nichts sagen.

**Entscheidung.** Eine eigene, sehr kleine Messung von **drei Zeitpunkten**, aktiv **nur** für
Konten mit der Test-Berechtigung `performance_tracking` aus ADR-0071.

| | | |
|---|---|---|
| **A** | der Klick-Handler läuft | `performance.now()` |
| **B** | `usePathname()` meldet die neue Route | Effekt |
| **C** | das erste Bild danach | zwei verschachtelte `requestAnimationFrame` |

Daraus drei Spalten: **A→C** die gefühlte Dauer, **A→B** das Warten, **B→C** das Zeichnen. Der
Split ist der ganze Zweck: **langsames A→C mit langsamem A→B** ist Server oder Daten, **langsames
A→C mit schnellem A→B** ist Rendern. Diese beiden Befunde führen zu völlig verschiedenen
Optimierungen, und ohne die Aufteilung wären sie nicht zu unterscheiden.

Zwei Frames statt einem: der erste Callback läuft **vor** dem Paint des Commits, der ihn geplant
hat. Erst der zweite liegt danach — der früheste Moment, zu dem die neue Seite wirklich zu sehen
war. Ein einzelner rAF würde systematisch zu früh messen.

### Aus für alle anderen, und zwar strukturell

Die Berechtigung wird **auf dem Server im Layout** geprüft, bevor die Komponente existiert. Wer
sie nicht hat, bekommt die Komponente nicht — kein Listener, kein Timer, keine Anfrage, kein
Messwert, und der Client-Code ist gar nicht erst im Baum. Das ist der Unterschied zu einem Flag,
das man clientseitig auswerten könnte.

**Keine E-Mail-Adresse im Client.** Die Frage „darf dieses Konto gemessen werden" beantwortet
Postgres über `has_tester_permission('performance_tracking')`; der Browser erfährt nur, ob er
misst, nie warum oder wer sonst.

### Was aufgezeichnet wird — und was es nicht gibt

Aufgezeichnet: **Routenmuster** (`/skylanders/[slug]`, nie `/skylanders/gold-fire-kraken`), die
drei Dauern, Viewportgröße, warm/kalt, Build-ID, Run-ID, optionales Label, `auth.uid()`,
Zeitstempel.

Nicht aufgezeichnet — **und im Schema nicht unterbringbar:** Roh-URLs · Query-Strings ·
Suchbegriffe · Formularinhalte · Warenkorbinhalte · Tokens, Cookies, Header · IP · User-Agent ·
Klickziele · Scrollverhalten · Session-Replay · Tastatureingaben. Es gibt keine Spalte dafür. Das
ist dasselbe Prinzip wie überall sonst hier: **interne Daten werden nicht versteckt, sie sind gar
nicht erst da.**

Dass nur Muster ankommen, ist zusätzlich ein CHECK: `to_route` und `from_route` müssen
`^/[A-Za-z0-9\[\]/_-]{0,63}$` erfüllen. Ein Slug mit Bindestrichen käme durch diesen Ausdruck —
deshalb normalisiert der Client gegen eine **feste Liste** der vier dynamischen Routen und liefert
für alles Unbekannte `/[unknown]`. Der CHECK ist der Riegel, die Liste die Entscheidung.

### Ein Weg hinein, kein Weg zurück

`record_navigation()` ist die einzige Schreibmöglichkeit, prüft selbst die Berechtigung und nimmt
das Konto aus `auth.uid()` — **es ist kein Parameter**, also kann kein Aufrufer für ein anderes
Konto schreiben. Auf `perf_navigations` hat kein Client ein Recht: kein `select`, kein `insert`,
RLS an, `revoke all from anon, authenticated`.

**Der Tester liest seine eigenen Messungen nicht.** Die Tabelle sagt, welches Konto wo langsam
war; das ist eine Betreibersicht. Für einen Administrator **mit Browsersitzung** sind das
`admin_perf_runs()` und `admin_perf_report()`, beide `is_shop_admin()`-gated.

### Der Bericht auf der Kommandozeile liest die Tabelle, nicht die Adminfunktionen

**Nachtrag 2026-09-16, nach dem ersten echten Staging-Lauf.** `npm run perf:report:staging`
scheiterte mit `shop administrator role required`. Kein Fehler in der Berechtigung, sondern die
Bedingung selbst: das Werkzeug verbindet sich mit dem Service-Role-Key, der **kein `auth.uid()`**
hat. `is_shop_admin()` fragt `shop_admins` nach `auth.uid()`, bekommt NULL und antwortet `false`.
Beide Adminfunktionen weisen also jedes Werkzeug ab — und zwar zu Recht.

**`is_shop_admin()` wird dafür nicht aufgeweicht.** Dieses Prädikat schützt die Daten vor jedem
angemeldeten Konto; es so zu ändern, dass ein Skript durchkommt, wäre genau die Lockerung, die man
nicht haben will. Die Adminfunktionen bleiben unverändert.

Stattdessen dieselbe Form, die Operator-Werkzeuge hier immer hatten: **direkt lesen mit dem
Service-Role-Key** — wie `export-image-overrides.mts`, `verify-shop.mts` und der Katalogimport.
Der Schlüssel liegt ausschließlich auf dem Entwicklungsrechner, trägt nie `NEXT_PUBLIC_` und ist
nicht im ausgelieferten Bundle. Die Gruppierung liegt in `src/lib/perf/report.ts`, wo sie prüfbar
ist, statt in einer `.mts`, die nur gegen eine echte Datenbank läuft.

Das ist **nicht** derselbe Fall wie `0035`: dort brauchte ein **Schreibvorgang** eine kuratierte
Funktion (`system_set_image_override()`), weil ein direktes `update` die Logik umgangen hätte. Ein
Lesevorgang hat keine Logik zu umgehen — **es braucht deshalb keine Migration `0038`.**

Die Perzentile stehen damit zweimal da, in SQL und in TypeScript. Beide sind auf
`percentile_cont` festgelegt und durch Tests darauf festgenagelt; abweichen können sie nur um eine
Millisekunde, wenn ein Wert exakt zwischen zwei Millisekunden liegt und Postgres und JavaScript
die Rundung verschieden auflösen.

### Ein Terminalbefehl statt eines Dashboards

`npm run perf:report:staging -- --latest` druckt die Tabelle. Die Frage wird ein paar Mal je
Optimierung gestellt, von einer Person, und die Antwort ist eine Zahlentabelle. Eine Adminseite
wäre eine Oberfläche zum Bauen, Gestalten, Absichern und Instandhalten. Der Befehl ist strikt
lesend und trägt dieselbe Staging-Sperre wie jedes andere Werkzeug mit zwei Umgebungen.

### Die Messung darf nicht messbar sein

Ein passiver Capture-Listener am Dokument statt einer Änderung an jedem `<Link>`. Kein
`preventDefault()`, kein `stopPropagation()`, keine Verzögerung. **Kein React-State je Ereignis** —
alles Refs, weil State bei jedem Tap den Teilbaum neu rendern würde, also genau die Kosten
verursachte, die hier nicht entstehen dürfen. Die Zustellung wird nie abgewartet, alle Fehler
werden geschluckt, **und es gibt keinen Retry**: Wiederholungen über eine schlechte Mobilverbindung
sind der Weg, auf dem ein Telemetrie-Client selbst zum Performanceproblem wird. Die Warteschlange
ist bei 100 Einträgen gedeckelt und verwirft die ältesten.

Ein Tap wird nur der Ankunft gutgeschrieben, auf die er zielte. Zurück-Button, Redirect oder ein
zweiter Tap während des ersten lassen den Tap unzugeordnet — er wird **verworfen**, statt eine
Dauer zu erzeugen, die zwei Navigationen misst. Lieber eine Messung weniger als eine falsche.

### Zuerst messen, dann reparieren

**0037 ändert an keinem der bekannten Verdächtigen etwas.** Proxy-Auth, `updateSession()`,
`currentUser()`, Prefetch, Loading-Boundaries, Suspense, Katalogabfragen, RSC-Payload,
`FigureCard`, Navigationsverhalten bleiben, wie sie sind. Ein Vorher-Wert, der auf einem bereits
halb optimierten Stand entstanden ist, ist kein Vorher-Wert. Deshalb gibt es `label` und
`build_id`: zwei Läufe, `mobile-baseline-1` und `mobile-after-1`, sind vergleichbar.

**Verworfen.** Eine Web-Vitals-Bibliothek (misst auf mobilem Safari das Falsche oder nichts) ·
`PerformanceNavigationTiming` (kennt SPA-Navigation nicht) · `sendBeacon` (trägt keine Session,
und der Insert braucht sie) · ein Drittanbieter-RUM (Nutzerdaten verlassen das System, kostet,
widerspricht `docs/SECURITY.md`) · Messung für alle mit Sampling (wir wollen kein allgemeines
Nutzertracking) · eine eigene `perf_testers`-Tabelle (ADR-0071 existiert genau deswegen) ·
ein Admin-Dashboard (Oberfläche für eine Zahlentabelle) · automatisches Pruning per `pg_cron`
(ein Scheduler, den niemand beobachtet; `admin_prune_perf_navigations(days)` wird gerufen, wenn
jemand aufräumen will).

---

## ADR-0073 — Die wichtigste Interaktion im Katalog ist keine Navigation

**Status:** angenommen · **Datum:** 2026-09-16 · **Migration:** `0038_performance_interactions.sql`
**Erweitert ADR-0072. Ändert an `perf_navigations` nichts.**

**Kontext.** Der erste echte Production-Lauf von 0037 hat funktioniert — und dabei etwas
Wichtigeres gezeigt als die Zahlen: **13 Navigationen, jede einzelne ein Link aus der
Hauptnavigation, und null `/skylanders/[slug]`.** Der Tester hatte in derselben Sitzung Figuren
durchgesehen, Detailansichten geöffnet, in den Warenkorb gelegt und eine Sandbox-Bestellung
abgeschlossen.

Der Grund steht im Code und ist eine Entscheidung, keine Panne: Eine Figur zu öffnen **ist keine
Navigation**. Der Tap setzt React-State, ein Dialog erscheint, der Pfad ändert sich nie
(ADR-0027). Navigationstelemetrie hat daran nichts zu messen. Die Geste, die am meisten darüber
entscheidet, wie schnell sich SkyIsles anfühlt, erzeugte **keine einzige Zeile**.

**Entscheidung.** Eine zweite, schmale Tabelle für Interaktionen innerhalb einer Seite — und
**vier** Zeitpunkte statt drei:

| | | |
|---|---|---|
| **A** | der Tap auf den Auslöser | Klick-Listener |
| **B** | der Dialog steht im DOM | `MutationObserver` |
| **C** | das erste Bild danach | zwei verschachtelte rAF |
| **D** | das Artwork ist zu sehen | `img.decode()` / `load` |

### Warum D existiert, und warum ohne D die Messung gelogen hätte

**Der Quick View lädt nichts.** Figur und Angebote liegen längst im Browser
(`lib/ui/quick-view.ts` sagt das ausdrücklich), `quickViewModel()` ist rein. A→C misst also React
und Paint — und wird fast immer schnell aussehen.

Das Bild ist eine andere Sache. Es ist `loading="lazy"`, und für jede Figur mit einem
Admin-Override kommt es **über das Netz aus Supabase Storage**. Ein Bericht mit nur A→C hätte
gesagt „der Quick View öffnet in 40 ms", während der Tester auf einen leeren Rahmen sieht. Das
wäre die zweite Messung hintereinander gewesen, die das Falsche misst.

**`content_visible_ms` ist nullable, und null bleibt null.** Wenn es kein Bild gibt, wenn der
Browser kein verlässliches Signal liefert oder wenn der Dialog vorher geschlossen wird, steht dort
**nichts** — nie eine Null. „Konnte nicht gemessen werden" in „war sofort da" zu verwandeln ist
genau der Fehler, gegen den diese Spalte existiert. Auch der Bericht rechnet Nulls nicht mit,
sondern zählt sie: `c-n` sagt, über wie viele Messwerte die Artwork-Perzentile gebildet wurden.

**`decode()` statt `load`, wo es beides gibt.** `load` sagt, dass die Bytes da sind; `decode()`
sagt, dass der Browser das Bild zeichnen kann, ohne zu blockieren. Auf einem Telefon ist das
Dekodieren eines 640×640-PNG nicht umsonst, und der Tester sieht den zweiten Moment.

**D darf kleiner sein als C.** Ein bereits dekodiertes Bild kann vor dem zweiten Frame fertig
sein. Das ist kein Fehler, sondern der Befund „das Bild war nie das, worauf gewartet wurde" — und
ein Clamp auf C würde genau diesen Fall auslöschen. Weder der CHECK noch der Client korrigieren
das.

### Zwei Tabellen, weil zwei Dinge gemeint sind

`perf_navigations.from_route`/`to_route` **bleiben Routen**. `/[dialog]/quick-view` dort
hineinzuschreiben hieße, beide Spalten bedeuteten „eine Route, manchmal aber auch nicht", und jede
spätere Abfrage müsste wissen, welches gerade gilt. Eine Interaktion hat einen **Ort**, keine
Richtung: eine `route`-Spalte, dazu ein Schlüssel, der sagt, was passiert ist.

### Der Schlüsselvorrat ist ein CHECK, kein Register

Der Unterschied zu ADR-0071 ist der Punkt. Test-Berechtigungen sind eine **offene** Menge — eine
neue ist ein `INSERT`. Interaktionsschlüssel sind **durch ihre Bauart geschlossen**: ein Schlüssel
kann nicht existieren, bevor jemand den Client-Code schreibt, der ihn sendet, und das ist ohnehin
ein Deploy. Ein Register wäre Zeremonie um eine Bedingung, die real ist.

**Genau ein Schlüssel:** `quick_view_open`. **Kein `quick_view_switch`** — der Dialog hat keine
Galeriepfeile und kein Weiter (`quick-view.tsx`); eine andere Figur heißt schließen und neu
tippen, also zwei Öffnungen. Ein Schlüssel, der nie feuern kann, ist schlimmer als keiner.

### Der Marker, und was er nebenbei repariert

Ein Attribut `data-perf="quick_view_open"` am vorhandenen Auslöser, und zwar **nur**, wenn dieser
den Dialog öffnet statt zu navigieren. Es trägt einen Interaktionsschlüssel und sonst nichts —
keine SKY-ID, keinen Slug, keinen Namen.

Es hält außerdem die Navigationszahlen ehrlich. Der Auslöser ist ein `<Link>`, dessen Handler
`preventDefault()` in der Bubble-Phase ruft — **nachdem** der Capture-Listener der Telemetrie den
Klick bereits gesehen hat. Ohne den Marker sah jedes Öffnen des Quick View aus wie der Beginn
einer Navigation zur Detailseite, und die Navigation, die nie kam, wurde der **nächsten echten**
angelastet, die daraufhin verworfen wurde. Das ist ein Teil der Erklärung für 13 aufgezeichnete
Navigationen in einer vollen Sitzung.

### `Modal` und `QuickView` wissen von nichts

B wird an `role="dialog"` und `aria-modal="true"` erkannt — Attribute, die der Dialog längst
trug. Keine Zeile in `Modal` oder `QuickView` ändert sich: keine Animationsdauer, kein
`backdrop-blur`, kein `loading="lazy"`. **Messen heißt hier nicht anfassen.**

### `warm` sagt weniger, als es klingt

`warm` heißt: **dieser Schlüssel auf dieser Route kam in diesem Lauf schon vor.** Nicht, dass das
Bild im Cache lag, nicht, dass der Router-Cache warm war, nicht, dass Storage das Objekt hatte.
Die Zeile kennt keine Bildidentität, könnte es also gar nicht wissen — zwei Quick Views zweier
Figuren holen zwei verschiedene Bilder, und der zweite gilt trotzdem als warm.

### Eine Warteschlange, zwei Arten

Navigationen und Interaktionen teilen sie sich — nicht um Code zu sparen, sondern weil eine zweite
Warteschlange einen zweiten `pagehide`-Handler bedeutete und damit einen zweiten Weg, die letzten
Messwerte eines Laufs genau dann zu verlieren, wenn sie zählen. Jede Probe wird **einzeln**
geprüft und einzeln gesendet: eine fehlerhafte Interaktion überspringt sich selbst, die
Navigationen daneben werden trotzdem aufgezeichnet.

### Weiterhin absichtlich ungemessen

Zurück/Vorwärts · frische Dokumentladungen · Ankünfte nach `redirect()` · Stripes eigene Dauer ·
das Schließen des Dialogs · Admin-Editor und Figur-anlegen-Dialog · Suchtippen · Scrollen ·
Warenkorb-Hinzufügen. **Abdeckungsqualität vor Ereignismenge**: Zahlen zu erzeugen, die keine
Frage beantworten, macht den Bericht schlechter, nicht besser.

**`checkout_submit` ist zurückgestellt**, nicht halb gebaut. Messbar wäre es — der Tap, dann der
Moment, in dem SkyIsles an Stripe übergibt —, aber `window.location.assign()` zerstört das
Dokument sofort danach, und die Probe müsste ein Unload überleben, für das der Zustellweg nicht
gebaut ist. Die Dauer-Spalten wurden dafür **nicht vorsorglich nullable gemacht**.

**Verworfen.** Ein Pseudo-Route-Eintrag in `perf_navigations` (macht beide Routenspalten
mehrdeutig) · `quick_view_switch` (existiert nicht) · ein Interaktionsregister als Tabelle
(Zeremonie) · `content_visible_ms = interaction_to_visible_ms` bei gecachtem Bild (macht aus
„nicht messbar" ein „sofort") · Nulls als Null in die Perzentile (dasselbe, nur im Bericht) · eine
zweite Warteschlange · generische Interaktionsanalytik · Option C aus dem Audit (mehr Ereignisse
ohne mehr Antworten).

---

## ADR-0074 — „Versendet" ist eine Auskunft, kein Ereignis

**Status:** angenommen · **Datum:** 2026-09-17 · **Migration:** `0039_shipping_is_reversible.sql`
**Ändert die Einbahnregel aus ADR-0062/`0018`. Lässt ADR-0033 unangetastet.**

**Kontext.** Der Betreiber hat die Admin-Bestellansicht am iPhone benutzt und drei Dinge gefunden.
Die Positionen standen als Textkarten da, ohne Bild — schlecht zu kommissionieren. Die Reihenfolge
war „Als versendet markieren" **vor** „Sendungsnummer", also genau umgekehrt zur Arbeit. Und der
Versandstatus ließ sich nicht zurücknehmen.

Das Dritte wiegt am schwersten, weil es einmal wehgetan hat: Am 2026-09-11 wurde
`SI-2026-001022` bei einem Smoke-Test versehentlich als versendet markiert und blieb es.

### Was „versendet" eigentlich ist

**Eine Aussage an den Kunden über den Zustand seines Pakets.** Kein Geldereignis, kein
Bestandsereignis. Die Verkaufsbuchung entsteht beim **Bezahlen** (`convert_order_reservations()`),
nicht beim Versenden; `admin_mark_order_shipped()` schreibt seit jeher weder Bewegung noch
Reservierung noch eine Zahlungsspalte.

Aussagen werden korrigiert. Ein Tippfehler in der Lieferadresse wird korrigiert, ein falsch
gesetzter Haken bisher nicht — obwohl der zweite dem Kunden eine falsche Auskunft gibt und der
erste nur uns. Deshalb erlaubt `orders_protect_fulfillment()` ab 0039 **beide** Richtungen:

```
unfulfilled  ⇄  shipped
```

**Was nicht dazukommt:** `preparing`, `completed`, `cancelled`. Die stehen weiter im CHECK und
haben weiter keinen Ablauf hinter sich; sie zu erlauben hieße Zustände zu erlauben, aus denen
nichts herausführt. Das war 0018s Argument und es gilt unverändert — `unfulfilled` war nie einer
davon.

**Was unverändert hart bleibt:** `orders_protect_immutable()` friert Identität und Beträge bei
jedem Update ein, `order_events` bleibt append-only, Positionen bleiben append-only, Bestand und
Zahlung werden nicht berührt. Zurücknehmen schreibt **eine Spalte** und eine Journalzeile.

### `shipped_at` gehört zu seinem Versand

Beim Versenden die Serverzeit, beim Zurücknehmen **NULL**. Ein Datum an einer Bestellung, die
nicht versendet ist, wäre eine Behauptung, die den Status überlebt. Wird später erneut versendet,
liest die Uhr neu — das ist, was ein Versanddatum bedeutet. Außerhalb eines Übergangs kann es
weiterhin nicht wandern.

### Die Sendungsnummer bleibt

Sie ist eine Tatsache über ein **gekauftes Label**, der Status eine Auskunft. Eine Auskunft
zurückzunehmen kauft kein Label zurück. Wer die Nummer loswerden will, leert das Feld — dort
gehört diese Entscheidung hin (ADR-0062).

Der Kunde kann dadurch legitim „Nicht versendet" **und** eine Sendungsnummer sehen. Das ist kein
Widerspruch, sondern genau der Zustand: ein Label existiert, das Paket ist noch nicht raus.

### Keine Rückfrage mehr

Die Rückfrage war richtig für das, was sie bewachte — die einzige unumkehrbare Aktion des
Produkts. 0039 beseitigt die Ursache statt des Symptoms. Ein Modal vor einem Schalter, der in
beide Richtungen geht, macht einen harmlosen Vorgang bedrohlich und bremst genau die Arbeit, in
deren Mitte er sitzt. Die Sätze „Das lässt sich nicht zurücknehmen" und „auch die Trackingnummer
ist danach nicht mehr änderbar" sind **gelöscht** — der zweite war schon seit `0023` falsch.

### Keine Mail in die Gegenrichtung

Es gibt keine „Ihr Paket ist doch nicht unterwegs"-Nachricht, und eine zu erfinden hieße, dem
Kunden vom Ausrutscher eines Betreibers zu erzählen. Wird erneut versendet, verhindert die
bestehende Idempotenz die zweite Versandbestätigung: `order_mail` hat den Primärschlüssel
`(order_id, kind)` und `claim_order_mail()` antwortet auf `sent` mit `already_sent`. **Am
Mailsystem ändert 0039 nichts.**

### `series_snapshot` — vorwärts ehrlich, rückwärts leer

`order_lines` hat die Serie nie gespeichert. Sie ist auch nicht wiederherstellbar: der einzige Weg
ist `sky_id → skylanders → series`, also **veränderlicher aktueller Katalog** — genau das, was
ADR-0033 aus einer historischen Bestellung heraushält.

Also legt 0039 die Spalte an und **füllt nichts**. Bestellungen von vorher bleiben für immer NULL,
der Admin zeigt „—". Ein Backfill schriebe den heutigen Katalog in die gestrige Bestellung und
nennte das Snapshot; **eine leere Zelle ist wahr, eine geratene nicht.**

**Warum ein Trigger und kein siebtes `create_order()`.** Die Funktion ist 263 Zeilen lang, wurde
sechsmal ersetzt und ist die gesamte Kasse. Sie für ein Anzeigefeld abzuschreiben hieße, das
Falsche zu riskieren. Ein `before insert`-Trigger auf `order_lines` nimmt die Serie in derselben
Transaktion aus derselben Tabelle, gegen die `create_order()` die Zeile bepreist hat, und deckt
jeden Einfügeweg ab. Dass er **nur bei INSERT** feuert, ist zugleich das, was „kein Backfill"
strukturell macht statt versprochen: bestehende Zeilen werden nie besucht. Ein nicht auflösbares
`sky_id` lässt NULL stehen, statt eine Kasse an einem Anzeigefeld scheitern zu lassen.

### Die Positionstabelle

Sieben Angaben je Zeile, immer an derselben Stelle, Bild zuerst — Kommissionieren ist eine
Scanaufgabe. **Jede** stammt aus dem Snapshot; die Komponente bekommt eine Zeile und nie eine
SKY-ID zum Nachschlagen, es gibt also keine Abfrage, die falsch sein könnte. Das Bild kommt aus
`image_snapshot` durch **denselben** Resolver wie überall (`imageSrc()`, ADR-0046); neu ist nur ein
Adapter, der die beiden Referenzformen unterscheidet.

Ein `<table>`, das unterhalb von `md:` zu Blöcken wird: eine Auszeichnung, ein Datensatz. Sieben
Spalten dürfen die Seite am Telefon nicht seitwärts schieben, und zwei getrennte Layouts wären
zwei Dinge, die auseinanderlaufen können.

**Verworfen.** Die Serie live aus dem Katalog joinen (ADR-0033) · historische Zeilen backfillen ·
`create_order()` neu schreiben · die Rückfrage mit korrigiertem Text behalten (sie bewacht nichts
mehr) · beim Zurücknehmen die Sendungsnummer löschen · `shipped_at` „für später" behalten · eine
Stornomail · eine eigene Mobilansicht der Positionen · `preparing`/`completed`/`cancelled`
freischalten.

---

## ADR-0075 — USER, SHOP und ADMIN sind Verantwortungsbereiche

> **Teilweise überholt durch ADR-0077 (2026-09-17).** Der Abschnitt „Drei Bereiche, keine
> Rechtssubjekte und keine Rollen" gilt nur noch zur Hälfte: es sind weiterhin keine Rechtssubjekte,
> aber seit `0041` sind es **ausdrückliche Berechtigungen** — `platform_admins` und
> `seller_operators`, ohne Vererbung. Alles Übrige in diesem ADR — die Trennung der Einstellungen,
> die Rückfallwege der Kontakte, der Verzicht auf `seller_id` — gilt unverändert.

**Status:** angenommen · **Datum:** 2026-09-17 · **Migration:** `0040_shop_platform_responsibilities.sql`
**Führt ADR-0064 aus. Ändert ADR-0021 nicht: kein Marktplatz.**

**Kontext.** ADR-0064 hat die beiden Identitäten getrennt — SkyIsles die Plattform,
yulez.collectibles der Verkäufer. Im Produkt war davon wenig zu sehen: `/admin` mischte
Bestellungen, Testkonten, Verkäuferangaben, Plattformangaben und den Preisprozentsatz auf einem
Bildschirm, und die Kasse sagte **„Verkäufer ist SkyIsles"** — auf dem letzten Bildschirm vor der
Zahlung, also genau dort, wo die Aussage zählt.

Der Satz war nicht aus Nachlässigkeit falsch. Er sollte klarstellen, dass dies kein Marktplatz ist,
und tat das, indem er den falschen Vertragspartner nannte. **Beides lässt sich gleichzeitig richtig
sagen**, und dieser ADR sagt, wie.

### Drei Bereiche, keine Rechtssubjekte und keine Rollen

| | |
|---|---|
| **USER** | Konto, Profil, Sammlung, eigene Bestellungen. Unverändert. |
| **SHOP** | Alles, was dem Verkäufer gehört: Bestellungen, Versand, Verkäuferidentität, Kontakt, Steuern, Widerruf. |
| **ADMIN** | Alles, was SkyIsles selbst betrifft: Katalog, Figuren, Kategorien, Testkonten, Plattformkontakt. |

**Keine drei Rechtssubjekte** — heute ist es eine Person. **Keine drei Rollen**: `is_shop_admin()`
bleibt das einzige Prädikat, und derselbe Administrator erreicht weiterhin beides. Eine RBAC, die
niemand braucht, wäre eine Berechtigungsschicht, die man pflegen muss, ohne dass sie je etwas
verhindert.

### Warum die Trennung überhaupt nötig ist, wenn es eine Person ist

**Gerade deswegen.** Wenn derselbe Mensch beide Fragen beantwortet, erinnert ihn nichts daran, dass
es zwei sind — und die Antworten fließen ineinander. „Verkäufer ist SkyIsles" ist genau, wie das
aussieht. Zwei getrennte Zeilen in der Datenbank und zwei Überschriften im Adminbereich sind die
billigste Art, den Unterschied sichtbar zu halten, bis er eines Tages auch praktisch einer ist.

### Was aus dem Code in die Konfiguration wandert

Drei Geschäftsentscheidungen waren SQL-Literale: das Lieferland (`create_order()` verglich mit
`'DE'`), die Versandarten samt Preisen und die Versandkostengrenze. Keine davon ist ein Naturgesetz;
alle drei gehören dem Verkäufer. **Eine Entscheidung, die eine Migration braucht, trifft niemand.**

Sie werden Tabellen — `shipping_countries`, `shipping_methods`, `shop_settings.free_shipping_threshold`
— **mit exakt den heutigen Werten befüllt**: DE, Hermes 5,49 €, DHL 6,49 €, 75,00 €. Das Anwenden
von 0040 ändert also keinen Preis, kein Land und kein Verhalten.

**Der Server entscheidet weiter.** `create_order()` fragt `shipping_country_allowed()` statt eines
einkompilierten Landes. Die Kasse spiegelt dieselbe Liste für ihr Formular und entscheidet nichts:
Wer den Client verändert, schaltet kein Land frei. Die Funktion wurde dafür **maschinell** aus 0028
übernommen und an genau einer Stelle geändert — 263 Zeilen abzutippen wäre die ganze Kasse aufs
Spiel gesetzt für ein Konfigurationsfeld.

### Ein Verkäufer-Kontakt, zwei Rückfallwege

`contact_email` bleibt maßgeblich. `withdrawal_contact_email` und `complaints_contact_email` sind
NULL-bar und bedeuten „keine eigene Adresse" — aufgelöst mit `coalesce`, **nie kopiert**. Eine Kopie
sähe heute identisch aus und hörte am Tag der Änderung auf zu folgen. Genau so verrotten
Einstellungen.

`platform_settings.support_email` ist die Adresse der **Plattform** — Konto, Datenschutz, Website.
Sie ist NULL und bleibt es, bis es eine gibt: **`support@skyisles.app` steht nirgends im Code.**
`platform_settings.contact_email` wird nicht umbenannt; eine Umbenennung, die nur eine These über
Namensgebung ausdrückt, ist der schnellste Weg von einer These zu einem Ausfall.

**Nachtrag, teuer gelernt.** Die erste Fassung dieser Migration schrieb
`alter table public.business_settings` — den Namen, den `0019` vergab und den `0026` vierzehn
Migrationen später in `platform_settings` geändert hat. Typecheck, Lint und die gesamte Testsuite
waren grün; Staging antwortete „relation does not exist". **Eine Migration zu lesen ist nicht
dasselbe wie das Schema zu lesen** — das Schema ist die Summe aller Migrationen, und eine
Umbenennung in der Mitte ist unsichtbar, wenn man nur die Datei öffnet, die die Tabelle angelegt
hat. `migration-names.test.ts` prüft das jetzt: kein `rename to` darf von einer späteren Migration
mit dem alten Namen unterlaufen werden.

### Identität wird erfasst, nicht erfunden

Dreizehn Spalten für rechtlichen Namen, Geschäftsnamen, Rechtsform, Anschrift, Telefon, zweiten
Kontaktweg, Register, USt-IdNr. und Wirtschafts-IdNr. **Alle NULL-bar, alle leer, kein einziger
Seed.** Ein Platzhalter in einem Impressumsfeld ist keine halbfertige Einstellung, sondern eine
falsche Aussage über eine echte Person, die darauf wartet, veröffentlicht zu werden. Ein CHECK
verbietet zusätzlich den Leerstring: „gesetzt, aber leer" soll es nicht geben.

### Die Kasse nennt den Verkäufer, der Katalog nicht

Der Name kommt aus `seller_public()` und steht **nirgends im Code** — Umbenennen ist eine Zeile in
der Datenbank, kein `grep`. Ohne aktiven Verkäufer greift ein neutraler Satz; ein geratener Name
wäre schlimmer als keiner.

Die **Katalogkarte bleibt verkäuferneutral** („Angebote ab …"). Der Katalog ist ein
Sammlerwerkzeug, kein Schaufenster, und 565 Karten mit einem Verkäufernamen wären das Zweite. Die
**Schnellansicht** ist die Stelle, an der ein konkretes Angebot erscheint, und zeigt dort weiterhin
den Namen plus „Gewerblicher Verkäufer" — das war schon richtig.

### Was Legal V1 noch braucht

0040 legt die Struktur, nicht die Texte. Offen bleiben: Impressum, AGB, Datenschutzerklärung,
Widerrufsbelehrung, Muster-Widerrufsformular, die elektronische Widerrufsfunktion nach § 356a BGB,
der § 19-Hinweis an den Preisen, die Bestätigung auf dauerhaftem Datenträger — und auf `orders`
`terms_version` und `withdrawal_version`, damit ein Vertrag von gestern reproduzierbar bleibt, wenn
die Einstellungen von heute sich ändern. **Bewusst nicht in 0040**: Vertragshistorie ist kein
Nebenprodukt einer Zuständigkeitstrennung.

**Verworfen.** Drei Rechtssubjekte erfinden · RBAC für einen Menschen · `seller_id` „für später"
(ADR-0021) · den Verkäufernamen ins i18n schreiben · `platform_settings.contact_email` umbenennen ·
die Rückfalladressen mit Kopien füllen · Identitätsfelder mit Musterdaten vorbelegen · eine
Support-Adresse einkompilieren · Versandpreise beim Umzug in die Konfiguration „glätten" ·
`create_order()` von Hand abschreiben.

---

## ADR-0076 — Der Katalog gehört SkyIsles, das Angebot dem Verkäufer

**Status:** angenommen · **Datum:** 2026-09-17 · **keine eigene Migration**
**Feste Invariante. Ergänzt ADR-0075 um die Frage, wem welches Datum gehört.**

**Kontext.** ADR-0075 hat Zuständigkeiten getrennt: USER, SHOP, ADMIN. Offen blieb die Frage, die
darüber entscheidet, ob ein zweiter Verkäufer später überhaupt möglich ist — **wem gehören die
Daten?**

### Die Regel, in vier Sätzen

| | |
|---|---|
| **Der Katalog** | gehört SkyIsles |
| **Der Sammlungsstand** | gehört den Nutzern |
| **Angebot, Bestand, Verkaufsbetrieb** | gehören den Verkäufern |
| **Plattform- und Katalogpflege** | gehört den Admins |

**Ein Verkäufer führt keinen eigenen Figurenkatalog.** Er hängt kommerzielle Daten an
Katalogeinträge von SkyIsles:

```
SkyIsles-Katalogeintrag  +  Angebot des Verkäufers
```

Angebotsseitig: ob dieser Verkäufer den Artikel führt, Preis, Menge, Zustand, Verfügbarkeit,
verkäuferspezifischer Bestell- und Versandzustand.

**Ein Verkäufer ändert niemals kanonische Katalogtatsachen:** Name, kanonisches Bild, Serie,
Element, Variante, Kartentyp, beschreibende Katalogmetadaten. Eine Korrektur durch den ADMIN wird
zur gemeinsamen Wahrheit für **alle** — Sammler wie Verkäufer.

**Niemals ein zweiter, duplizierter Figurenkatalog pro Verkäufer.** Ein zweiter Verkäufer
referenziert denselben kanonischen Katalog.

### Warum das heute schon gilt, ohne dass etwas gebaut wurde

Der Befund aus der Prüfung: **die Trennung existiert bereits, sie war nur nicht aufgeschrieben.**

- Auf `skylanders`, `categories`, `series` und `catalog_editorial` gibt es **kein einziges
  Tabellenrecht und keine Policy** für `anon` oder `authenticated`. Jeder Schreibweg ist eine
  `security definer`-Funktion mit `is_shop_admin()` als erster Anweisung.
- Der kommerzielle Bestand hängt über `shop_inventory.sky_id` am Katalog, statt ihn zu kopieren.
  `order_lines.sky_id` ebenso.
- Redaktionelle Spalten (`catalog_visible`, `display_name_override`, `catalog_group`) gehören dem
  Admin; `is_listed`, `sale_price` und `quantity` liegen auf `shop_inventory` und gehören dem
  Verkäufer. Die Grenze verläuft schon an der richtigen Stelle.

### Was diese Invariante an `0040` geändert hat

**Die Versandkostengrenze ist vom Plattform-Singleton auf `sellers` gewandert.**
`shop_settings` ist per `check (id)` eine Ein-Zeilen-Tabelle — richtig für eine Plattformtatsache,
falsch für diese: was ein Shop für Porto verlangt, ist die Entscheidung eines Verkäufers. Auf dem
Singleton wäre das heute unsichtbar geblieben und hätte am Tag des zweiten Verkäufers einen Umbau
einer Bedingung gekostet, die genau eine Zeile erlauben soll. **Die Spalte kostet hier nichts und
später nichts.**

**Die Katalog-Einstiege stehen jetzt unter „Plattform".** Bestellungen, Katalog und Kategorien
lagen als eine Reihe über beiden Überschriften — also außerhalb der Gliederung, die sie erklären
sollte. Bestellungen gehören zum Shop, der Katalog zur Plattform.

### Was ausdrücklich NICHT gebaut wird

Kein `seller_id`, kein zweiter Verkäufer, kein Onboarding, keine Provisionen, keine Auszahlungen,
kein Ranking, keine Marktplatz-AGB, keine neue Rolle. `sellers_one_active` gilt weiter (ADR-0021,
ADR-0075).

### Der Weg dorthin, falls er je gegangen wird

Damit „verhindert es nicht" eine überprüfbare Aussage ist und keine Hoffnung:

| Schritt | Aufwand |
|---|---|
| `shop_inventory` bekommt `seller_id` | nullable Spalte, Backfill auf den einen Verkäufer, dann `not null` |
| `shipping_methods` / `shipping_countries` bekommen `seller_id` | Spalte, Backfill, Primärschlüssel auf `(seller_id, code)` erweitern |
| `sellers_one_active` fällt | Constraint droppen |
| `admin_set_*`-Funktionen nehmen eine Verkäuferreferenz | heute lösen sie „den aktiven Verkäufer" implizit auf |
| Berechtigungen trennen Shop-Betreiber von Plattform-Admin | neue Prädikate neben `is_shop_admin()` |
| `order_lines`, `orders` | **unverändert** — sie sind schon Snapshots und kennen den Katalog nur über `sky_id` |
| Katalogtabellen | **unverändert** — sie waren nie verkäuferbezogen |

Der Katalog steht in dieser Liste nicht. Das ist der Punkt: **die Struktur, die einen zweiten
Verkäufer teuer machen würde, wäre ein duplizierter Katalog, und den gibt es nicht.**

**Verworfen.** Ein Katalog je Verkäufer · verkäuferbezogene Spalten auf `skylanders` ·
verkäuferbezogene Einstellungen auf dem Plattform-Singleton · `seller_id` „auf Vorrat" · eine
Rollenschicht, bevor es einen zweiten Betreiber gibt.

---

## ADR-0077 — Drei Konten: USER, BUSINESS, ADMIN

> **Teilweise überholt durch ADR-0078 (2026-09-17).** Der Abschnitt „Orthogonal" gilt nur noch zur
> Hälfte: die beiden Prädikate rufen einander weiterhin nie auf, aber ein Konto kann seit `0042`
> **nicht mehr beide Mitgliedschaften halten**. „Beides hat nur, wem beides einzeln gegeben wurde"
> ist damit hinfällig — es kann niemandem mehr gegeben werden. Alles Übrige gilt unverändert.

**Status:** angenommen · **Datum:** 2026-09-17 · **Migration:** `0041_three_account_authorization.sql`
**Führt ADR-0076 aus. Korrigiert ADR-0075 in einem Punkt: es sind jetzt doch Berechtigungen.**

**Kontext.** ADR-0075 hielt fest, USER/SHOP/ADMIN seien Verantwortungsbereiche und ausdrücklich
**keine** Rollen. Das war richtig für den Schritt, den es beschrieb — und es ist der Punkt, an dem
dieser ADR widerspricht. Der Betreiber will drei Geräte: ein Sammlerkonto, ein Shopkonto und ein
Plattformkonto. Solange `is_shop_admin()` beide Fragen beantwortet, ist das nicht ausdrückbar.

**Das Problem war ein Prädikat mit zwei Bedeutungen.** `is_shop_admin()` hieß gleichzeitig „darf
den Katalog korrigieren" und „darf den Shop führen". Solange eine Person beides ist, fällt das
niemandem auf — und genau deshalb konnte ein Business-Konto nicht verkaufen, ohne zugleich den
Katalog umschreiben zu dürfen, den jeder Sammler liest.

### Zwei Berechtigungen, keine Hierarchie

| | |
|---|---|
| **USER** | der Normalfall. **Keine Zeile, nirgends.** |
| **BUSINESS** | eine Zeile in `seller_operators`: dieses Konto darf diesen Shop führen |
| **ADMIN** | eine Zeile in `platform_admins`: dieses Konto führt SkyIsles |

**Orthogonal, und das ist der ganze Punkt.** Admin impliziert nicht Business, Business impliziert
nicht Admin. Beides hat nur, wem beides einzeln gegeben wurde. `is_platform_admin()` und
`can_operate_active_seller()` rufen einander **nie** auf — das ist die eine Zeile, deren Bruch
niemand bemerken würde, weil heute eine Person beides hält, und deshalb steht ein Test genau darauf.

### Niemand sperrt sich aus

`platform_admins` wird aus `shop_admins` befüllt. Wer SkyIsles heute verwaltet, tut es danach
weiter. Die Migration **nennt dabei niemanden**: sie liest die Tabelle, die die Antwort schon
enthält — keine UUID, keine Adresse, kein Name, und ein Test prüft das mit zwei Mustern.

Den **Shopzugang vergibt sie ausdrücklich nicht** mit. Das macht der Betreiber danach einmal in der
Oberfläche. Ihn automatisch mitzugeben wäre genau die Vererbung, die dieser ADR beseitigt.

### `is_shop_admin()` bedeutet jetzt nur noch Plattform

Nicht gelöscht, sondern verengt: ein Alias auf `is_platform_admin()`. Zwei Gründe. `shop_admins`
ist die Tabelle, die der Betreiber kennt. Und alles, was bei der Neuzuordnung übersehen wurde,
funktioniert weiter für den Administrator und **verweigert dem Verkäufer** — das ist die sichere
Richtung: eine übersehene Funktion sperrt einen Verkäufer aus einem Bildschirm aus, sie übergibt
ihm nicht den Katalog.

**Ausdrücklich nicht** `is_platform_admin() or can_operate_active_seller()`. Das wäre die Vererbung
in einer Zeile.

### 41 Funktionen, maschinell umgestellt

Jede Funktion wurde aus der Migration geholt, die sie zuletzt definiert, der Wächter ersetzt und
geprüft, dass **genau zwei Zeilen** anders sind: das Prädikat und seine Meldung. Alles andere ist
Byte für Byte das, was heute läuft. 41 `security definer`-Funktionen abzutippen ist der Weg, auf
dem eine Berechtigungsschicht ein Loch bekommt — und dieselbe Technik hat schon `create_order()`
durch `0040` getragen.

**BUSINESS** (21): Bestellungen, Versand, Tracking, Bestand, Bestandsjournal, Freigabe, Preise,
Commerce-Modus, Sandbox-Rückbuchung, Verkäuferangaben, Shopprofil, Versandkonfiguration.
**ADMIN** (22): Katalogsichtbarkeit, Anzeigenamen, Notizen, Produktgruppen, Katalogjournal, Bilder,
Kartentypen, Figuren anlegen, Plattformangaben, Kontosuche, Testkonten, Telemetrie — plus die
beiden neuen für die Shopzugänge.

### Zwei Bereiche, weil es zwei Befugnisse sind

`/business` ist neu und trägt Bestellungen, Bestand und die Verkäuferangaben. `/admin` behält
Katalog, Kategorien, Testkonten, Plattformangaben — und die Verwaltung der Shopzugänge, denn
**jemandem den Shop zu geben ist ein Plattformakt**. Ein Verkäufer kann sich keinen zweiten
Betreiber dazuholen.

Beide Bereiche antworten **404**, nicht 403: ein „verboten" bestätigt, dass es dort etwas gibt. Und
beide sind nur das erste von zwei Toren — jede Schreiboperation fragt dasselbe Prädikat noch einmal
in der Datenbank.

### Das Abzeichen zeigt Befugnisse, keinen Rang

Sammler: nichts. Shop: „Business". Plattform: „Admin". Beides: **beide Abzeichen**, nicht das
höhere — es gibt kein höheres. Klein und sekundär, tonal, ohne das Sammlergold (ADR-0042).

### `seller_operators.seller_id` ist kein Marktplatz

Es ist das einzige `seller_id` im ganzen Schema, und es beantwortet **„welches Konto darf diesen
Shop führen"** — nicht „welchem Verkäufer gehört diese Bestellung". Keine Bestellung, keine
Bestandszeile und keine Katalogzeile bekommt eines; Tests prüfen beides getrennt.
`sellers_one_active` gilt unverändert.

**Zugang wird deaktiviert, nicht gelöscht.** Eine Berechtigung, die es gab und nicht mehr gibt, ist
eine Tatsache über die Vergangenheit. Damit ist `is_enabled` tragend — und dass ein Mutationstest
das Weglassen dieser einen Bedingung zunächst **nicht** bemerkte, war der Grund, die Prüfung
nachzuziehen.

### Nachtrag: die Navigation musste der Berechtigung folgen

Nach dem ersten manuellen Test auf Staging sah das Adminkonto weiterhin „Lager", folgte dem Link
und bekam 404. **Der Wächter hatte recht, der Link war falsch** — und die Versuchung, das durch
Aufweichen der Route zu beheben, ist genau die, der man nicht nachgeben darf.

Die Ursache war eine Zeile: `Viewer` kannte nur `{ signedIn, admin }`, also hing sowohl das Lager
als auch der Adminbereich an `viewer.admin`. Ein Business-Konto sah dadurch **gar keinen** Einstieg
in seinen eigenen Bereich. `Viewer` kennt jetzt beide Befugnisse, und jedes Ziel fragt die, die der
Wächter dahinter fragt.

Drei Dinge wanderten mit: das **Abzeichen der gemeldeten Bestellung** sitzt jetzt am Shop statt am
Adminbereich — eine bezahlte Bestellung ohne gebuchten Bestand löst der Verkäufer, nicht die
Plattform. Die **Sammlung** hängt an `!viewer.business` statt `!viewer.admin`; die Begründung aus
ADR-0032 („der Betreiber ist kein Sammler") beschrieb immer den Verkäufer, und ein
Plattform-Administrator ist im Katalog ein ganz normaler Sammler. Und die **Leser der
Anwendung** fragen jetzt dieselbe Befugnis wie die Funktion, die sie aufrufen — `fetchOpenOrderCounts()`
fragte `isAdmin()`, während `admin_orders()` seit 0041 den Verkäufer fragt, sodass ein Business-Konto
einen leeren Shop gesehen hätte.

**Abmelden musste nicht umziehen.** Es steht seit ADR-0062 auf `/account`, genau einmal, als POST
unterhalb einer Trennlinie — „Abmelden ist keine Sicherheitseinstellung". `/settings` ist ein
permanenter Redirect auf `/account`, was den Eindruck erklärt, es liege unter den Einstellungen.
Geändert wurde nichts; geprüft wird es jetzt.

### Nachtrag: ein Leck, das keine Route geschlossen hätte

Die erste Fassung von `0041` ließ `admin_set_shop_policies()` weiterhin
`platform_settings.support_email` schreiben — und stellte den Wächter zugleich auf
`can_operate_active_seller()` um. Damit hätte ein **Verkäufer die Supportadresse der Plattform**
setzen können. In der Oberfläche stand das Feld unter „Kontakt" im Shopprofil, freundlich als
Plattformangabe beschriftet; die Begründung war, die Gegenüberstellung mache den Unterschied
sichtbar.

**Beides war falsch.** Die Beschriftung war Kosmetik über einer echten Berechtigungslücke, und
Zuständigkeit lehrt sich durch **richtige Platzierung**, nicht durch Nebeneinanderstellen. Die
Funktion verliert den Parameter — per `drop function`, weil sonst die zehnstellige Fassung aus
`0040` daneben stehen bliebe, aufrufbar und nun verkäufergeschützt. Die Adresse bekommt mit
`admin_set_platform_support()` einen eigenen, plattformgeschützten Schreiber, und
`admin_platform_settings()` liefert sie (gedroppt und neu angelegt, weil ein Rückgabetyp sich nicht
in place ändert). Der Leser des Verkäufers gibt sie gar nicht mehr aus.

**Verworfen.** `is_shop_admin()` als Vereinigung beider Prädikate · Admin automatisch zum
Verkäufer machen · Konten in der Migration benennen · `seller_id` auf Bestellungen oder Bestand ·
eine Rollentabelle mit frei definierbaren Rollen · die 41 Funktionen von Hand abschreiben · den
Shopzugang im Shop verwalten lassen.

---

## ADR-0078 — Ein Konto, ein Typ

**Status:** angenommen · **Datum:** 2026-09-17 · **Migration:** `0042_strict_account_types.sql`
**Verschärft ADR-0077. Lässt ADR-0076 unberührt.**

**Kontext.** ADR-0077 machte BUSINESS und ADMIN zu **orthogonalen Berechtigungen**, die ein Konto
zusammen halten kann, wenn jemand beide vergibt. Für das Problem, das es löste — zwei Befugnisse
aus einem Prädikat zu trennen —, war das die richtige Form. Für das Produkt ist es die falsche.

### Die Entscheidung

| | |
|---|---|
| **USER** | privates Sammlerkonto. Keine privilegierte Mitgliedschaft. |
| **BUSINESS** | gewerblicher Shop. **Keine Sammlung.** |
| **ADMIN** | die Plattform. Keine Sammlung, kein Shop. |

**Es gibt keinen vierten Zustand.** Wer privat sammelt *und* einen Shop führt, benutzt **zwei
Konten**. Das ist die Entscheidung, kein Nebeneffekt der Umsetzung.

### Warum getrennt und nicht geschichtet

Der eigentliche Grund liegt in der Zukunft: SkyIsles soll eines Tages **private Sammler aus ihrer
eigenen Sammlung verkaufen** lassen können. Wäre BUSINESS „ein Sammler mit Verkaufsrecht", dann
wären dieses künftige Feature und der gewerbliche Shop **dieselbe Sache unter zwei Namen** — und es
gäbe keine Stelle mehr, an der man ihnen verschiedene Regeln geben könnte. Privates Verkaufen und
gewerbliches Verkaufen sind unterschiedliche Domänen mit unterschiedlichen Pflichten.

**Privates Verkaufen wird jetzt nicht gebaut.** Die Identitäten werden getrennt, solange das
billig ist.

### Durchgesetzt in der Datenbank, nicht in der Oberfläche

Zwei Tabellen, also **zwei Trigger**. Ein CHECK sieht nicht über Tabellengrenzen, und ein
Fremdschlüssel kann keine *Abwesenheit* ausdrücken. Ein Wächter in der Vergabefunktion allein
hielte einen direkten `INSERT` nicht auf — die Invariante muss einen direkten RPC-Aufruf und die
Service-Role überstehen.

Beide sehen nur auf **aktive** Mitgliedschaft. Eine entzogene Verkäuferzeile behält ihre Historie
(ADR-0077) und darf keine dauerhafte Sperre sein: erst entziehen, dann vergeben — genau der
ausdrückliche Übergang, den das Produkt will. **Niemals still das andere entfernen.**

### Die Sammlung gehört Sammlern

`0001` machte `collection_items` besitzergebunden; das war damals die ganze Frage. Jetzt sind es
zwei: wessen Zeile ist das, **und ist dieses Konto überhaupt ein Sammler**.

Alle vier Policies werden **ersetzt**, nicht ergänzt — eine zweite permissive Policy würde mit der
ersten ver-ODERt und **mehr** erlauben, nicht weniger. Auch das Lesen ist zu: die Sammlung eines
Business-Kontos ist unsichtbar, nicht bloß eingefroren.

**Gelöscht wird nichts.** Ein Typwechsel verschiebt Zugriff, niemals Speicher. Wird der Shopzugang
entzogen, ist dieselbe Sammlung unverändert wieder da.

### Navigation und Abzeichen

USER: Katalog, Sammlung, Konto. BUSINESS: Katalog, Shop, Lager, Konto, Abzeichen „Business".
ADMIN: Katalog, Admin, Konto, Abzeichen „Admin". **Kein Sammlung-Eintrag für Business oder Admin**
— und nicht nur ausgeblendet: die Route antwortet 404 und die Policies verweigern die Tabelle.

Ein abgemeldeter Besucher zählt weiter als Sammler und sieht „Sammlung", die zur Anmeldung führt.
Sie ihm wegzunehmen hieße, die halbe Produktidee vor genau den Leuten zu verstecken, die man
einlädt.

**Konto und Abmelden bleiben allen drei Typen gemeinsam** (ADR-0062). Ein Konto zu haben ist keine
Sammlerfunktion.

### Was das nicht ist

Keine Rollentabelle, keine Hierarchie, kein Marktplatz. `is_platform_admin()` und
`can_operate_active_seller()` rufen einander weiterhin **nie** auf. `is_privileged_account()` ist
kein Bindeglied zwischen ihnen, sondern die Antwort auf eine dritte Frage — „ist dieses Konto
etwas anderes als ein privater Sammler?" —, die nur die Sammlung stellt.

**Verworfen.** Eine gemeinsame Rollentabelle · BUSINESS als „USER plus Verkaufsrecht" ·
stilles Entfernen der anderen Mitgliedschaft beim Vergeben · Sammlungsdaten beim Typwechsel
löschen · die Invariante nur in der Vergabefunktion · nur die Navigation zu verstecken · den
letzten Administrator entfernbar zu lassen.

---

## ADR-0079 — Eine gemeldete Bestellung braucht einen Ausgang

**Status:** angenommen · **Datum:** 2026-09-17 · **Migration:** `0043_order_review_recovery.sql`
**Ergänzt ADR-0050. Lässt ADR-0074 (umkehrbarer Versand) und ADR-0078 unberührt.**

**Kontext.** Beim ersten echten Test mit dem Business-Konto auf Staging: die Bestellung ist
bezahlt, der Bildschirm sagt „Prüfung erforderlich — Versand gesperrt", und **es gibt nichts zu
tun**. Kein Knopf, keine Erklärung, kein Weg. Die Prüfung ergab: `needs_resolution` wird seit
`0010` gesetzt, trägt den Kommentar „never cleared automatically" — und wurde tatsächlich **nirgends
gelöscht**, weder automatisch noch von Hand, in keiner Migration und auf keinem Bildschirm.

Ein Verkäufer konnte also eine bezahlte Bestellung bekommen und hatte keinen Ablauf dafür.

### Zwei Wege hinein, und sie sind nicht dasselbe Problem

| Ursache | Was passiert ist | Reparierbar? |
|---|---|---|
| `late_payment_unresolved` | Das Geld kam an, **nachdem** die Reservierung abgelaufen und freigegeben war. Bestellung **bezahlt**, Bestand **nie abgebucht**. | **Ja**, wenn die Ware heute da ist |
| `payment_amount_mismatch` | Der gezahlte Betrag passt nicht zum Versuch. Bestellung nicht als bezahlt markiert. | **Nein** — eine Geldfrage |

Das ist der Grund, warum hier kein „Freigeben"-Knopf steht. Ein solcher Knopf würde erlauben, Ware
zu versenden, die das Lagerbuch noch als vorhanden führt — genau das, wogegen die Meldung existiert.

### Die Reparatur ist eine echte Buchung

Für den ersten Fall gilt: **wenn die Ware auf dem Regal liegt, ist die Buchung nachholbar**, und
danach steht exakt der Zustand da, den eine umgewandelte Reservierung hinterlassen hätte. Also
bucht `seller_resolve_stock_shortfall()` je Position eine `sale`-Bewegung durch das **vorhandene**
Journal — dieselbe Funktion, die die Umwandlung benutzt hätte — und löscht die Markierung **erst
danach**.

`apply_inventory_movement()` weigert sich, eine Position unter ihre Reservierung zu drücken. Diese
Weigerung wird **nicht abgefangen**: reicht der Bestand nicht, rollt die ganze Transaktion zurück,
nichts ist gebucht, die Markierung bleibt und die Bestellung bleibt gesperrt. **Das ist die
Sicherheitseigenschaft, kein Fehlerfall, den man umgehen müsste.**

Zusätzlich verweigert die Funktion: eine Bestellung ohne Markierung, eine mit Geldabweichung, eine
ohne das Spätzahlungsereignis, eine unbezahlte, eine mit noch **aktiver** Reservierung (dort ist der
gewöhnliche Weg offen, und Buchen wäre Doppelbuchung) und eine, die schon einmal gebucht wurde.

### Der Bildschirm sagt, welches Problem es ist

Vorher: eine rote Box mit zwei Sätzen und keiner Handlung. Jetzt: die Ursache im Klartext — nie das
interne Ereignis —, je Position **benötigt gegen verfügbar**, damit „reicht nicht" nachprüfbar ist
statt behauptet, und der Knopf **nur dort, wo es einen gibt**. Bei einer Geldabweichung steht, dass
sie beim Zahlungsanbieter zu klären ist.

### Wem es gehört

Dem Verkäufer. Bestellabwicklung ist Shopbetrieb, nicht Plattformverwaltung (ADR-0077):
`can_operate_active_seller()`, niemals `is_shop_admin()`. Ein Plattform-Administrator ohne
Shopzugang kann eine gemeldete Bestellung ebenso wenig auflösen wie versenden.

### Die Staging-Bestellung

`SI-2026-001041`, Sandbox, 11.09.2026: `checkout_expired` → `late_payment_unresolved {held:0,
required:1}`. Eine Zeile, `SKY-9101/loose`, eine Reservierung im Zustand `released`. Aktueller
Bestand: 4 vorhanden, 0 reserviert. Sie ist also **regulär reparierbar** und braucht keinen
Sonderweg für Altbestellungen — **kein Invariant wurde für sie aufgeweicht**. Eine Bestellung ohne
Deckung bliebe gesperrt, auch diese.

**Verworfen.** Ein `needs_resolution = false`-Schalter · den Bestandsfehler bei Geldabweichung
„auch" zu buchen · die Weigerung von `apply_inventory_movement()` abzufangen und teilweise zu
buchen · einen Sonderweg für Sandbox- oder Altbestellungen · die Auflösung dem Administrator zu
geben · die Sperre in `shipBlocker()` zu lockern.

---

## ADR-0080 — Der Shop ist ein Bereich, kein Formularstapel

**Status:** angenommen · **Datum:** 2026-09-17 · **keine Migration**
**Informationsarchitektur. Ändert an ADR-0077/0078 nichts.**

**Kontext.** Zwei Befunde aus der Benutzung, beide keine Fehler im engeren Sinn:

1. Der Betreiber erlebte „Mein Konto" als **Einstellungen** — obwohl das Label „Mein Konto" heißt
   und ein Kommentar im Code ausdrücklich gegen das Wort „Einstellungen" argumentiert. Darüber
   stand ein **Zahnrad**.
2. `/business` war vier gestapelte Panels unter zwei Links. Die ladungsfähige Anschrift des
   Verkäufers stand zwei Bildschirmhöhen unter der Bestellzahl.

### Ein Zahnrad sticht das Label, das ihm widerspricht

Das Symbol war das Problem, nicht der Text. Wer ein Zahnrad sieht, liest „Einstellungen", egal was
daneben steht — eine Affordanz gewinnt gegen eine Beschriftung, die ihr widerspricht. Das Zahnrad
ist jetzt eine **Karte mit Zeilen**: „die Dinge, die über mich hinterlegt sind", und genau das
steht dahinter — Profil, Lieferdaten, Bestellungen, Sicherheit.

Die zwei Türen im Kopfbereich bleiben (V3.4.1): Name und Person führen zu *wer dieses Konto ist*,
die Karte zu *was über es hinterlegt ist*. **Abmelden bleibt unten auf „Mein Konto"**, unter einer
Trennlinie, als POST — dort war es richtig und dort bleibt es, für alle drei Kontotypen.

### Der Shop bekommt eine Übersicht statt einer Startseite mit allem darauf

`/business` ist jetzt aufgebaut wie „Mein Konto": Karten mit Titel, einem Satz und einem Ziel.

| Bereich | Was dort gehört |
|---|---|
| **Händlerprofil** | Der Name, unter dem Kunden den Shop sehen |
| **Angebote & Preise** | Verkaufsmodus und automatische Preisbildung |
| **Lagerbestand** | Menge, Preis und Freigabe je Figur, plus Journal |
| **Bestellungen** | Bestellungen der Kundschaft: prüfen, versenden, Sendungsnummer |
| **Versand** | Länder, Versandarten, Preise, Versandkostengrenze |
| **Geschäftsdaten & Kontakt** | Rechtliche Angaben, Kontakte, Steuer, Widerruf |

**Kein Feld wurde verschoben, nur seine Adresse.** `ShopProfilePanel` bekam eine `groups`-Angabe
und rendert jetzt auf jeder Seite die Gruppen, die ihr Thema sind — dieselbe Gruppe an zwei Stellen
wäre dasselbe Feld an zwei Stellen.

**Die Übersicht bearbeitet nichts.** Sie führt hin. Die Arbeit unterbricht sie nur, wenn es welche
gibt: gemeldete und zu versendende Bestellungen stehen oben, sonst steht dort nichts.

### Öffentliche Händleridentität gegen Papierkram

„Händlerprofil" ist das Gesicht, „Geschäftsdaten & Kontakt" die Akte. Zwei Publika, zwei Pflichten
(ADR-0075). Der **Händlername kommt aus `sellers.display_name`** über `seller_public()` — dieselbe
Quelle, die die Schnellansicht schon zeigt. **Nicht der Benutzername des Kontos**: der ist ein
persönliches Handle und ähnelt heute zufällig dem Shopnamen; das eine fürs andere zu nehmen bricht
in dem Moment, in dem jemand anderes den Shop führt.

### Zwei Dinge, die es noch nicht gibt, und die nicht erfunden wurden

**Händler-Icon.** Es existiert keine Spalte dafür und keine Storage-Policy. Die Seite **sagt das**,
statt einen leeren Rahmen zu zeichnen, der einen Upload verspricht. Nachziehen heißt: eine Spalte
auf `sellers`, ein Bucket-Pfad mit Policy, ein Upload-Weg — eine eigene Runde, keine Beifracht.

**Bewertungen.** Kein Schema, keine Daten, keine Seite. Es gibt **keine Karte**, auch keine
deaktivierte: `site-footer.tsx` hat diese Regel für das Produkt längst entschieden — *ein toter
Link ist schlimmer als ein fehlender*. Der Bereich ist hier festgehalten und wird gebaut, wenn er
gebaut wird.

### „Bestellungen" heißt zweierlei

Unter „Mein Konto" sind es **die eigenen Käufe**, im Shop **die Bestellungen der Kundschaft**. Die
Shop-Liste sagt das jetzt in einem Satz über der Tabelle, damit ein Betreiber seine Verkäufe nie
für Einkäufe hält.

### Navigation

**Shop** ist der Haupteinstieg, **Lager** bleibt als Abkürzung — Bestand ist die Aufgabe, die
mehrmals täglich angefasst wird, alles andere erreicht man über die Übersicht. Nichts sonst aus dem
Shop wandert in die Leiste; eine Leiste, die jeden Bereich aufnimmt, ist keine Leiste mehr.

**Verworfen.** Das Zahnrad mit besserem Label behalten · eine Karte „Bewertungen" ohne Ziel · ein
leerer Icon-Rahmen ohne Speicher · alle Verkäufereinstellungen in eine Seite „Einstellungen" ·
zwei Karten auf dieselbe Route · den Benutzernamen als Händlernamen · eine Migration, damit die
Übersicht vollständig aussieht.

---

## ADR-0081 — Zwei Zahlen, ein Prädikat, kein Berichtswesen

**Status:** angenommen (2026-09-17) · Migration `0044` · ergänzt ADR-0080 ·
**das Prädikat und die Beschriftung sind durch ADR-0083 ersetzt**

> **Nachtrag (2026-09-17, vor der ersten Anwendung).** Der unten beschriebene
> `paid`-Filter und die Beschriftung „Umsatz dieses Jahr" gelten **nicht mehr**.
> `0044` zählt jetzt Bestelltätigkeit — aufgegebene Bestellungen, unabhängig von
> der Zahlung — und die Zahl heißt „Bestellwert dieses Jahr". Begründung und
> neues Prädikat: **ADR-0083**. Alles Übrige an dieser Entscheidung (Aggregat
> statt Zeilenabruf, Berliner Jahresgrenze, exakter Sandbox-Ausschluss, keine
> Analysetabellen) gilt unverändert.

### Kontext

Die Shop-Übersicht sagte, was zu tun ist, aber nicht, wie das Jahr läuft. Gefragt waren zwei
Zahlen: **Bestellungen dieses Jahr** und **Umsatz dieses Jahr**.

### Entscheidung

**Eine Aggregatfunktion, keine Liste.** `seller_year_to_date()` gibt ein `jsonb` mit zwei Werten
zurück. Der naheliegende Weg — `admin_orders()` aufrufen und in der Seite summieren — holt ein
ganzes Jahr Bestellungen **samt Kundenadressen** in eine Ansicht, die „127" drucken will. Das
wächst mit dem Shop und trägt personenbezogene Daten dorthin, wo sie nichts zu suchen haben.

**Beide Zahlen teilen ein Prädikat:** `payment_status = 'paid'` und `commerce_mode = 'live'`,
ab `date_trunc('year', now() at time zone 'Europe/Berlin')`.

**Erstattungen: die Grenze wird genannt, nicht überspielt.** Das Schema kennt einen
Erstattungs**status**, aber **keinen Erstattungsbetrag** — nirgends. Bei
`partially_refunded` ist der Nettowert damit nicht bekannt, sondern *unbekannt*. Also fallen
erstattete und teilerstattete Bestellungen aus **beiden** Zahlen heraus, und der Hinweis unter den
Karten sagt genau das. Die Alternative wäre gewesen, einen Betrag zu erfinden, den niemand
aufgeschrieben hat.

**Darum heißt es „Umsatz" und sonst nichts.** Es ist die Summe bezahlter Bestellsummen. Kein
Wareneinsatz, keine Gebühren, keine Steuer, keine Erstattung ist verrechnet. Jedes Wort, das eine
Verrechnung verspricht, wäre an dieser Zahl falsch — ein Test hält die Bezeichnung fest.

**Eine markierte Bestellung zählt.** `needs_resolution` heißt, die Abwicklung braucht einen
Menschen — nicht, dass das Geld fraglich ist: eine verspätete Zahlung steht auf `paid`, *weil* sie
ankam. Der andere Weg in die Markierung, die Betragsabweichung, setzt nie `paid` und fällt durch
dasselbe Prädikat heraus, ohne Sonderfall.

**Sandbox fällt exakt heraus.** `commerce_mode` ist NOT NULL, auf der Bestellung eingefroren, und
`0021` hat jede ältere Zeile auf `'sandbox'` gesetzt. `= 'live'` ist eine Tatsache über die
Bestellung, keine Vermutung aus Nummer, Kunde oder Datum.

**Das Jahr ist Berlins.** Eine Bestellung um 00:30 am 1. Januar gehört zum neuen Jahr; unter UTC
täte sie es nicht.

**Darstellung über `src/lib/format.ts`.** Das ergibt `€ 4.582,40` und `1 270` — Locale `de-AT`,
Symbol voran, schmales Leerzeichen als Gruppentrenner (ADR-0019). Eine zweite Währungsformatierung
für ein Mock-up einzuführen hieße, Geld an zwei Stellen verschieden zu schreiben.

### Konsequenzen

`0044` braucht `0041` (das Verkäuferprädikat), sonst nichts. Das Prädikat steht **in der
`WHERE`-Klausel**: ein Aufrufer ohne Verkäuferrecht aggregiert die leere Menge, statt eine Zeile zu
lesen. Ein Teilindex auf `placed_at` hält die Summe billig.

**Verworfen.** Nettoumsatz aus geschätzten Erstattungen · getrennte Prädikate für Anzahl und
Umsatz · Analysetabellen, Tages-Rollups oder eine materialisierte Sicht für zwei Zahlen ·
Vorjahresvergleich und Diagramme · `admin_orders()` in der Seite summieren · eine Umsatzzahl für
ADMIN (der Shop gehört dem Verkäufer, ADR-0077).

---

## ADR-0082 — Das Archiv darf Arbeit nicht verstecken, der Bericht gehört seinem Monat

**Status:** angenommen (2026-09-17) · Migration `0045` · ergänzt ADR-0063, ADR-0080, ADR-0081 ·
**Entscheidung 5 ist durch ADR-0083 präzisiert**

> **Nachtrag (2026-09-17, vor der ersten Anwendung).** Das Prädikat unten las
> `payment_status not in ('expired', 'cancelled')`. Der Ausschluss von
> `cancelled` war falsch: eine Stornierung ist ein **späteres Ereignis** und
> darf die ursprüngliche Bestellung nicht rückwirkend aus ihrem Bestellmonat
> entfernen. Gültig ist jetzt `public.order_counts_as_placed()` aus `0044` —
> siehe **ADR-0083**. Der Abschnitt „Verhältnis zu ADR-0081" unten ist damit
> ebenfalls überholt: die beiden Zahlen teilen sich jetzt dieselbe Definition.

### Kontext

Die Bestellliste hatte genau eine Form: „die neuesten hundert, sortiert nach Aufmerksamkeit". Sie
beantwortet „was muss ich jetzt tun?" und sonst nichts — nicht „was war im August?". Und der
Verkäufer hat für keinen Monat einen Nachweis, was gelaufen ist.

### Entscheidung 1 — Aktuell ist ein ODER, kein Datum

```
aktiv  =  aktuell  ODER  noch offen
```

Die naheliegende Regel — „älter als 15 Tage wandert ins Archiv" — versteckt Arbeit. Eine
markierte Bestellung (`needs_resolution`) ist bezahlt, hat keinen Bestand gebucht, kann nicht
versendet werden, **und wird jeden Tag älter, gerade weil sich niemand darum gekümmert hat**. Die
Regel, die die Liste aufräumt, wäre die Regel, die die eine wichtige Zeile begräbt.

„Noch offen" ist keine neue Definition: es ist `attention <= 2`, also genau das, was `p_open_only`
seit `0024` bedeutet (ADR-0063). Eine Definition von „offen" — für das Abzeichen, den Filter und
das Archiv.

**15 Tage, rollierend, in Berliner Kalendertagen.** Nicht „dieser Monat": am Ersten wäre die Liste
leer, obwohl dieselbe Arbeit offen ist. Nicht `now() - interval '15 days'`: dann läge die Grenze
bei der Uhrzeit, zu der man die Seite geöffnet hat.

### Entscheidung 2 — Monate sind Überschriften, keine Zeilen

Die Monatsabschnitte kommen aus `seller_order_calendar()`: eine Zeile je Monat, nur Zählungen,
höchstens zwölf im Jahr. Ein Monat öffnet sich als **eigene Ansicht** (`?year=&month=`), nicht als
aufgeklapptes `<details>` — ein `<details>` mit hunderten Zeilen hat diese Zeilen trotzdem geladen.
Damit lädt keine Ansicht dieser Seite je die gesamte Historie.

**Der Filter hat Vorrang vor dem Standard.** Im Standard zeigen die Monatsabschnitte nur, was nicht
schon oben steht. Wählt der Verkäufer einen Monat, zeigt die Seite **den ganzen Monat** — ein
Filter, der die jungen Zeilen verschweigt, lügt über den Monat in seiner Überschrift. Und in eine
Jahres-/Monatsansicht wird nichts aus den letzten 15 Tagen hineinkopiert.

### Entscheidung 3 — Die Aufmerksamkeitsregel bekommt eine eigene Funktion

`0018` hat die Warnung selbst hingeschrieben: „Zwei Kopien sind zwei Dinge, die übereinstimmen
müssen und es irgendwann nicht mehr tun." Diese Migration hätte fünf daraus gemacht.
`order_attention()` ist die Regel; `admin_orders()` wird per `create or replace` darauf umgestellt
— gleiche Signatur, gleicher Rückgabetyp, gleiche Sortierung, gleiche `p_open_only`-Bedeutung.

### Entscheidung 4 — Das Arbeitsabzeichen zählt, statt zu blättern

Das Abzeichen wurde aus den Zeilen berechnet, die `admin_orders(p_open_only)` liefert — und dieser
Aufruf ist **auf 100 Zeilen gedeckelt**. Das Abzeichen war also nie eine Zahl offener Bestellungen,
sondern eine Zahl offener Bestellungen **auf der ersten Seite**: bei 130 stand dort 100, und bei
1300 stünde dort 100. `seller_open_order_counts()` fragt drei Zahlen ab, ohne Limit, mit
demselben Prädikat. Was „offen" heißt, ändert sich nicht — nur die Antwort wird richtig.

### Entscheidung 5 — Ein Monatsbericht ist ein **Ereignisbericht**

Das ist die Entscheidung, die den ersten Entwurf ersetzt hat. Der zählte `paid`-Bestellungen; damit
war die Augustzahl eine Aussage über **Zahlungen**, die den Namen eines Monats trug.

**Ein Ereignis gehört in den Monat, in dem es passiert ist. Ein späteres Ereignis greift nie
zurück.**

```
Bestellung aufgegeben   2026-08-31   ->  Bestellaktivität im August
bezahlt                 2026-09-02   ->  ändert am August nichts
erstattet               2026-09-12   ->  ein September-Ereignis
```

Daraus folgt alles Übrige:

**Der Monat kommt aus `placed_at`, aus nichts sonst.** Nicht aus `paid_at`, nicht aus dem
Statuswechsel, nicht aus `shipped_at`. Ein auf die Zahlung gestellter Monat verschöbe eine
Bestellung je nachdem, wann ein Webhook ankam, und schriebe jeden abgeschlossenen Monat neu,
sobald eine späte Zahlung eintrifft.

**Zahlung ist keine Bedingung.** Eine im August aufgegebene Bestellung ist Augustaktivität, ob das
Geld am 31., am 2. September oder noch gar nicht kam.

**Was eine Bestellung ist — geprüft, nicht angenommen.** Ein Warenkorb steht nicht in der Datenbank
(ADR-0043). Eine Zeile in `orders` schreibt `create_order()` in dem Moment, in dem der Kunde den
Checkout mit seiner Adresse abschickt. Von den sieben erlaubten `payment_status`-Werten schreibt
dieses Schema **drei**: `pending`, `paid`, `expired`. `failed`, `cancelled`, `refunded` und
`partially_refunded` stehen im CHECK und werden von nichts geschrieben. Also:

```
zählbar  =  payment_status not in ('expired', 'cancelled')
```

`expired` ist der abgebrochene Checkout — die 20-Minuten-Reservierung ist verfallen, der Bestand
zurückgegangen, niemand hat bezahlt. `cancelled` steht daneben, weil es dasselbe bedeuten wird,
falls es je geschrieben wird. **Eine erstattete Bestellung bleibt in ihrem Bestellmonat** — die
Erstattung ist ein eigenes Ereignis in ihrem eigenen Monat, und genau das ist der Punkt.

### Entscheidung 6 — Es heißt **Bestellwert**, nicht Einnahme

Weil das Geld nicht angekommen sein muss. „Einnahme", „Umsatz" und „bezahlt" behaupten alle einen
Zahlungseingang; bei einer am 31. aufgegebenen und am 2. bezahlten Bestellung wäre jedes dieser
Wörter an dem Tag falsch, an dem der Bericht entsteht. `paid_count`/`unpaid_count` stehen als
**Stand bei Erstellung** daneben — informativ, und sie definieren den Bestellwert nicht um.

Zahlungseingänge und Rückerstattungen sind eine **zweite** Art von Bericht, nach ihren eigenen
Ereignisdaten. Die gibt es noch nicht.

### Entscheidung 7 — Keine Versionierung

Der erste Entwurf hatte `version`, um einen Monat nach einer späten Zahlung neu auszustellen. In
diesem Modell ist eine späte Zahlung **kein Grund**, irgendetwas neu auszustellen — sie ändert den
Monat der Bestellung nicht —, und eine Erstattung gehört in einen anderen Monat. Ohne den
rückwirkenden Fall blieb nur eine Korrektur, die niemand verlangt hat. Also die stärkere
Invariante:

**Ein festgeschriebener Bericht je Kalendermonat und Modus.** Per `unique`-Constraint, nicht per
Gewohnheit.

### Entscheidung 8 — Nur Felder, die SkyIsles wirklich hat

| | |
|---|---|
| **Gebühren des Zahlungsanbieters** | `payment_events` speichert Event-ID, Typ und Ausgang — bewusst nicht die Payload (`0012`). Keine `balance_transaction`, keine Gebühr, keine Auszahlung. |
| **Erstattungen** | Kein Betrag, kein Zeitstempel, keine Tabelle — nur vier Statuswerte, die nichts schreibt. Was ein künftiges Erstattungsereignis braucht, steht am Ende von `0045`. |
| **Umsatzsteuer** | § 19 UStG: wird nicht erhoben, und bewusst nicht als Satz 0 modelliert (`0011`). |
| **Gewinn** | Nichts hier weiß, was der Bestand gekostet hat. |

Vier Spalten mit Nullen läsen sich als „es wurde nichts abgezogen". Zwei Sätze unter der Liste
lesen sich als das, was stimmt.

### Entscheidung 9 — Kein Download in dieser Runde

PDF und CSV brauchen eine Formatentscheidung und einen **privaten** Speicherort. Der einzige Bucket
des Projekts ist `catalog-images`, und der ist **öffentlich** (`0007`). Erzeugt würden beide aus
der festgeschriebenen Zeile und `included_orders`, nie aus einer frischen Abfrage.

### Verhältnis zu ADR-0081

**Die beiden Zahlen sind jetzt bewusst verschieden.** `0044` zählt `paid`; der Bericht zählt
aufgegebene Bestellungen. Das ist kein Versehen, sondern zwei Fragen: *Geld eingegangen* gegen
*Bestellungen angenommen*. Solange die Shop-Startseite „Umsatz dieses Jahr" sagt und `paid`
meint, ist ihre Beschriftung für sich genommen korrekt — aber sie beantwortet eine andere Frage
als die Berichte darunter. Ob sie auf **Bestellumsatz** umgestellt wird, ist eine offene
Produktentscheidung; `0044` ist nirgends angewandt und kann ohne Neuschreiben geändert werden.

### Konsequenzen

`0045` braucht `0041` und den Commerce-Kern; nicht `0042`, `0043` oder `0044`. Kein `seller_id` —
ADR-0076 gilt. `seller_monthly_reports` ist für jede Client-Rolle gesperrt; der Weg hinein sind die
Funktionen, und alle fragen `can_operate_active_seller()`.

**Verworfen.** Archivieren nach Alter allein · „dieser Monat" statt 15 rollierender Tage ·
aufklappbare `<details>` mit vorgeladenen Zeilen · Umsatz neben der Monatszahl · **den Bericht auf
`paid` stellen** · **den Monat aus `paid_at` ableiten** · **eine erstattete Bestellung rückwirkend
aus ihrem Bestellmonat entfernen** · Berichtsversionierung für einen rückwirkenden Fall, den es
nicht gibt · eine Erstattungsspalte, die immer 0 ist · eine Steuerzeile 0,00 € · geschätzte
Stripe-Gebühren · ein Hintergrundjob · ein Download-Knopf ohne Datei · das Abzeichen weiter aus
einer 100-Zeilen-Seite zählen.

---

## ADR-0083 — Eine Definition von „Bestellung", und ein Ereignis gehört seinem Monat

**Status:** angenommen (2026-09-17) · Migrationen `0044` + `0045`, beide vor der ersten
Anwendung korrigiert · präzisiert ADR-0081 und ADR-0082

### Kontext

ADR-0082 hat das Ereignismodell für Monatsberichte eingeführt. Zwei Stellen waren damit noch
nicht konsistent.

**Erstens** zählte die Jahreskennzahl auf der Shop-Startseite weiter `paid`-Bestellungen und hieß
„Umsatz dieses Jahr" — eine Zwitterzahl: begrenzt durch das Bestelldatum, gefiltert nach Zahlung.
Eine am 30. Dezember aufgegebene und am 2. Januar bezahlte Bestellung zählte in **keinem** der
beiden Jahre; eine im Januar aufgegebene und im März bezahlte hob den Januarwert nachträglich an.

**Zweitens** schloss das Berichtsprädikat `cancelled` zusammen mit `expired` aus. Das war die
Annahme, `cancelled` werde einmal „auch ein nicht zustande gekommener Kauf" bedeuten. Tut es
nicht: eine Stornierung ist eine **echte Bestellung, die später rückgängig gemacht wurde**.

### Entscheidung 1 — Eine Definition, in einer Funktion

`public.order_counts_as_placed(payment_status)` in `0044`:

```sql
select p_payment_status is distinct from 'expired';
```

`seller_year_to_date()` und `seller_finalize_monthly_report()` rufen sie auf, statt sie
abzuschreiben. Zwei Kopien von „was ist eine Bestellung" wären zwei Dinge, die sich über das Geld
des Shops einig sein müssen und es irgendwann nicht mehr wären. Deshalb steht sie in `0044`, der
niedrigeren Nummer: **`0045` hängt jetzt von `0044` ab**, nicht umgekehrt.

### Entscheidung 2 — Warum `expired` ausgeschlossen ist, und warum das kein Rückwirken ist

`expired` heißt genau eines: `create_order()` hat die Zeile geschrieben und den Bestand gehalten,
zwanzig Minuten sind vergangen, niemand hat bezahlt, `expire_stale_checkouts()` hat den Halt
freigegeben und die Ware zurückgelegt. **Es wurde nie etwas verkauft.** Der Kunde hat keinen Kauf
storniert — er hat keinen abgeschlossen.

Die Zeile hat die produktdefinierte Grenze vom Checkout-Versuch zur gewerblichen Bestellung nie
überschritten. Sie ist keine Bestellung, die aufgehört hat zu zählen; sie war nie eine.

**Und sie kann keinen Bericht rückwirkend ändern:** der Zustand tritt rund zwanzig Minuten nach der
Aufgabe ein, und ein Monat wird frühestens am Ersten des nächsten berichtet. Es gibt keinen Moment,
in dem eine verfallene Zeile in einer veröffentlichten Zahl stand.

**Dieser Ausschluss wird nicht verallgemeinert.** Er gilt für `expired` und für nichts sonst.

### Entscheidung 3 — `cancelled` zählt, und muss weiter zählen

```
5. September    Bestellung aufgegeben   +50 €   Septemberaktivität
8. September    storniert               -50 €   ein September-Stornoereignis

31. August      Bestellung aufgegeben   +40 €   Augustaktivität
12. September   erstattet               -40 €   ein September-Erstattungsereignis
```

August wird nicht wieder geöffnet. Stünde `cancelled` im Ausschluss, würde das Schreiben dieses
Werts eine 50-€-Bestellung stillschweigend aus einem Monat löschen, der sie bereits berichtet hat.
Da heute nichts `cancelled` schreibt, wird die Grenze **jetzt** festgeschrieben, bevor sie falsch
gezogen werden kann — per Funktionskommentar und per Test.

**Warnung an die künftige Storno-Implementierung:** `cancelled` darf nicht für abgebrochene
Checkouts verwendet werden. Dafür gibt es `expired`. Die beiden können sich keinen Wert teilen —
einer heißt „wurde nie ein Geschäft", der andere „war ein Geschäft und wurde rückgängig gemacht".

### Entscheidung 4 — Das Ereignisregister (Invariante)

| Ereignis | Gehört in den Monat von |
|---|---|
| **Bestellung** | `placed_at` |
| **Zahlung** | dem Zeitpunkt des Zahlungseingangs — falls Zahlungsberichte kommen |
| **Erstattung** | dem Zeitpunkt der Erstattung |
| **Stornierung / Gutschrift** | dem Zeitpunkt der Stornierung |

**Kein späteres Ereignis ändert je den Monat, zu dem ein früheres gehört.**

Daraus folgt auch: ein künftiger **Zahlungsbericht wird nicht** auf `placed_at` aufgebaut. Dass
`0044` und `0045` sich die Bestelldefinition teilen, ist richtig, weil beide dieselbe Frage nach
Bestelltätigkeit stellen. Eine Frage nach eingegangenem Geld ist eine andere und bekommt ihr
eigenes Datum.

Erstattungs- und Stornoinfrastruktur wird **jetzt nicht** gebaut. Was sie brauchen wird, steht am
Ende von `0045`.

### Entscheidung 5 — Die Beschriftung

**Bestellungen dieses Jahr** und **Bestellwert dieses Jahr**. Nicht „Umsatz", nicht „Einnahmen",
nicht „bezahlt": Zahlung ist keine Bedingung, also wäre jedes dieser Wörter bei der erstbesten
Bestellung falsch, die über den Jahreswechsel bezahlt wird. Dieselbe Wortwahl wie in den
Monatsberichten, damit zwölf Berichte und die Jahreszahl dasselbe meinen.

### Konsequenzen

Beide Migrationen waren nirgends angewandt und wurden korrigiert statt ersetzt. **Anwendungsreihenfolge:
`0044` vor `0045`**, weil `0045` die Prädikatfunktion aus `0044` aufruft. Unverändert bleiben: ein
unveränderlicher Bericht je Monat, keine Versionierung, `paid_count`/`unpaid_count` als
informativer Stand, `included_orders` als Beleg, exakter Sandbox-Ausschluss über `commerce_mode`,
die PDF/CSV-Richtung, das Bestellarchiv und die Aggregat-Korrektur des Arbeitsabzeichens.

**Verworfen.** `cancelled` mit `expired` in einen Topf werfen · den Ausschluss verfallener
Checkouts auf spätere Ereignisse verallgemeinern · die Bestelldefinition in beiden Migrationen
ausschreiben · die Prädikatfunktion in `0045` anlegen (dann müsste `0044` danach laufen) · die
Jahreskennzahl auf `paid` lassen und nur umbenennen · sie auf `paid_at` umstellen (das wäre ein
Zahlungsbericht, keine Bestelltätigkeit).

---

## ADR-0084 — Bestellungen werden nie gelöscht; Testbestellungen bekommen ein Archiv

**Status:** angenommen (2026-09-17) · Migration `0046` · ergänzt ADR-0060, ADR-0082, ADR-0083

### Die Invariante

**SkyIsles löscht keine Bestellungen. Weder echte noch Testbestellungen.**

| | |
|---|---|
| `commerce_mode = 'live'` | Geschäftsunterlage. Es besteht eine Aufbewahrungspflicht. |
| `commerce_mode = 'sandbox'` | technischer Nachweis. Er belegt, wie sich Checkout, Zahlungs-Webhook und Versandweg tatsächlich verhalten haben. |

Keine Produktaktion entfernt eine Bestellung physisch: nicht Stornierung, nicht Erstattung, nicht
Versand, nicht die Wiederherstellung aus ADR-0079 — und nicht das Archivieren aus dieser
Entscheidung.

**Das Schema hat das bereits durchgesetzt, und diese Migration schwächt es nicht ab.** Jeder
Fremdschlüssel auf `orders` ist `ON DELETE RESTRICT`; `orders.user_id` ist `ON DELETE SET NULL`,
damit ein gelöschtes Konto die Bestellung freigibt statt sie zu vernichten (`0010`); Client-Rollen
haben `select` auf `orders` und sonst nichts. Ein Audit über Migrationen, Anwendungscode und
Werkzeuge fand **keinen einzigen** Löschpfad für Bestellungen.

### Das Problem, das kein Speicherproblem ist

Einen Checkout durchzutesten heißt, eine Bestellung aufzugeben. Ihn fünfzigmal zu testen heißt
fünfzig Bestellungen — mitten in der Liste, in der der Betreiber echte Arbeit sucht, und mitgezählt
in deren Monatszahlen. Die Antwort ist nicht, sie zu löschen; sie sind der Nachweis. Die Antwort
ist, dass sie in dieser Liste nie hätten stehen dürfen.

### Entscheidung 1 — Die Bestellansichten des Shops werden **live-only**

Nicht „live zuerst", nicht „live mit Badge an den anderen" — nur live. Fünf Funktionen bekommen
eine Klausel, `o.commerce_mode = 'live'`: `admin_orders()`, `seller_orders_active()`,
`seller_orders_month()`, `seller_order_calendar()`, `seller_open_order_counts()`. Damit kann eine
Testbestellung weder eine Monatszahl noch die Aktuell-Liste noch die Jahresauswahl noch das
Arbeitsabzeichen aufblähen.

### Entscheidung 2 — Testbestellungen bekommen eine eigene Ansicht und ein Archiv

`/business/orders/test`, erreichbar über zwei Reiter **[ Bestellungen ] [ Testbestellungen ]**.
Standard ist `Bestellungen`.

Bewusst schlichter als das Live-Archiv: keine Monatsgruppen, keine Jahresauswahl, kein
15-Tage-Fenster. Eine Testbestellung ist keine Arbeit und hat keine Historie, durch die man
navigiert — sie muss erkennbar und wegräumbar sein.

**Archivieren ist ausschließlich Sichtbarkeit.** Es schreibt einen Zeitstempel. Bestellung,
Positionen, Zahlungsereignisse, Versand- und Bestandshistorie bleiben vollständig; „Wiederherstellen"
nimmt den Zeitstempel zurück. Das steht auch so auf der Seite, damit „archivieren" nie als „weg"
gelesen wird.

### Entscheidung 3 — Ein eigenes technisches Feld

`sandbox_archived_at timestamptz` und `sandbox_archived_by uuid`.

Kein Missbrauch von `payment_status`, `fulfillment_status` oder `needs_resolution`: die bedeuten
etwas über das Geschäft, und „der Betreiber hat aufgeräumt" hineinzuschreiben hieße, eine
Zustandsmaschine eine Frage beantworten zu lassen, die ihr niemand gestellt hat. `commerce_mode`
wäre noch schlimmer — er ist von `orders_protect_immutable()` eingefroren, weil er entscheidet, zu
welcher Welt eine Bestellung gehört.

**Benennung folgt der Tabelle:** `paid_at`, `shipped_at`, `completed_at`, `cancelled_at` — ein
nullbarer `*_at`-Zeitstempel **ist** der Zustand, und nirgends im Schema sagt ein zusätzliches
Boolean dasselbe noch einmal.

`sandbox_archived_by` ist die Spalte wert: dies ist die einzige Betreiberaktion im ganzen
Bestellablauf ohne eigene Spur — kein Ereignis, keine Bestandsbewegung, keine Mail.

### Entscheidung 4 — Der Schutz ist eine CHECK-Constraint, keine Prüfung in einer Funktion

```sql
check (sandbox_archived_at is null or commerce_mode = 'sandbox')
```

**Eine echte Bestellung kann nicht als archiviert markiert werden.** Nicht durch eine Funktion mit
einem Fehler, nicht durch eine spätere Migration, die es vergisst, nicht durch ein handgeschriebenes
UPDATE um drei Uhr nachts. Dass die Funktionen dasselbe prüfen, macht die Prüfung höflich, nicht
tragend.

**Alles oder nichts.** Eine Liste, die eine einzige echte Bestellung enthält, archiviert **gar
nichts** — auch nicht die Testbestellungen darin. Ein Stapel halb anzuwenden, weil das meiste davon
in Ordnung war, ist genau der Weg, auf dem eine echte Bestellung verschwindet, während der Betreiber
eine Erfolgsmeldung liest. Ein nicht existierender Bestellname scheitert ebenso.

**Es gibt keine generische Archivfunktion und darf keine geben.** `commerce_mode` ist hier kein
Parameter. Beide Funktionen nennen `'sandbox'` in ihrer eigenen WHERE-Klausel, und eine einzelne
Bestellung ist eine Liste mit einem Element — damit existiert keine Einzelfunktion, um die herum
eine spätere Massenaktion die Prüfung einmal außerhalb der Schleife erledigen könnte.

### Entscheidung 5 — Kein Einfluss auf Geld, in keinem Zustand

`0044` und `0045` lesen `commerce_mode`, **nicht** `sandbox_archived_at`. Eine Testbestellung steht
außerhalb jeder Kennzahl und jedes Monatsberichts — aktiv, archiviert oder wiederhergestellt. Es
gibt keinen Zustand, in den sie geraten könnte, der daran etwas ändert.

### Warum eine neue Migration statt einer Änderung an `0045`

Weil `0045` **auf Staging angewandt ist** — gegen die Datenbank geprüft, nicht aus einer Tabelle
abgelesen. Eine angewandte Migration ist Historie. Die fünf Lesefunktionen werden hier ersetzt, mit
identischer Signatur und identischem Rückgabetyp; genau das macht `create or replace` sicher
(`0040` hat die andere Variante gelernt). Es ist auch der sauberere Schnitt: `0045` ist Archiv und
Monatsbericht, `0046` ist die Trennung von Echt- und Testbetrieb.

### Konsequenzen

Anwendungsreihenfolge **`0044` → `0045` → `0046`**. ADMIN gewinnt nichts: jede Funktion fragt
`can_operate_active_seller()`, und Testbestellungen gehören dem Verkäufer.

**Verworfen.** Testbestellungen löschen · „Testdaten aufräumen"-Knopf · eine generische
Archivfunktion mit `commerce_mode` als Parameter · Archivieren über `payment_status` oder
`commerce_mode` abbilden · ein Boolean neben dem Zeitstempel · clientseitiges Ausblenden ·
einen gemischten Stapel teilweise anwenden · Testbestellungen weiter mit Badge in der Live-Liste ·
das volle Monats-/Jahresarchiv für Testbestellungen nachbauen.

---

## ADR-0085 — Abmelden gehört auf „Profil", nicht auf die Kontoübersicht

**Status:** angenommen (2026-09-17) · keine Migration · korrigiert ADR-0062

### Der Befund

Der Abmelden-Knopf stand auf `/account` — der Kontoübersicht. ADR-0062 hatte das bewusst so
entschieden: Abmelden ist keine Sicherheitseinstellung, also nicht unter „Konto & Sicherheit"
vergraben, sondern eine Ebene höher sichtbar.

Die Begründung war richtig über „Konto & Sicherheit" und falsch über diese Seite, aus einem Grund,
den das Routing verdeckte:

**`/settings` leitet dauerhaft auf `/account` um.**

Wer Einstellungen sucht, landet also auf genau der Seite mit dem Knopf. „Abmelden steht unter
Einstellungen" war keine Verwechslung — so war es gerendert.

### Warum die vorige Prüfung das für erledigt hielt

Weil drei Tests `src/app/(app)/account/page.tsx` als Ort festschrieben und grün waren. Sie prüften,
**wo der Knopf ist**, nicht **wo er hingehört** — und bestätigten damit genau den Zustand, der im
Browser falsch aussah. Ein Test, der die Ist-Route festhält, kann einen Platzierungsfehler nicht
finden; er zementiert ihn.

### Entscheidung

**Genau ein Abmelden-Knopf, ganz unten auf `/account/profile`.**

`/account` ist Navigation. „Profil" ist die Identität des Kontos — wer man angemeldet **ist** —, und
diese Sitzung zu beenden gehört ans Ende davon.

**Verschoben, nicht dupliziert.** Dasselbe `POST /auth/signout`, dasselbe Markup, ein Ort. Ein POST
und kein Link, damit kein Prefetch eine Sitzung beenden kann.

**Für alle drei Kontotypen dieselbe Seite.** Abmelden beendet eine Sitzung, und die hat jedes Konto
— es ist keine Rollenaktion und wird nicht in den Business- oder Adminbereich kopiert. Tragfähig ist
das, weil `/account/*` nur eine Sitzung verlangt: allein `/collection` ist auf Sammler eingeschränkt
(ADR-0078). Ein Test hält das fest, denn wäre `/account/profile` je so eingeschränkt, hätte diese
Verschiebung Verkäufern und Administratoren das Abmelden genommen.

**Eine zweite Implementierung ist entfernt.** `signOutAction()` lag exportiert und von niemandem
importiert in `src/lib/auth/actions.ts`. Wer als Nächstes einen Abmelden-Knopf braucht, findet sonst
zwei Wege und wählt einen — und dann stehen auch wieder zwei Knöpfe in der Oberfläche.

**`/settings` bleibt ein `permanentRedirect` auf `/account`** — der Pfad steht im
Navigationsmodell, in Lesezeichen und im Onboarding. Das Ziel trägt jetzt keinen Abmelden-Knopf
mehr, und damit ist die Ursache weg statt die Umleitung.

### Konsequenzen

Die Tests prüfen jetzt Zuständigkeit statt Fundort: **jede** `.tsx` unter `src/app` wird
durchsucht, und genau eine darf das Formular rendern; jede Seite der Business- und Admin-Gruppen
wird geprüft, nicht drei davon.

**Verworfen.** Den Knopf auf beiden Seiten lassen · ihn in die Navigationsleiste heben · eine
eigene Seite „Abmelden" · `/settings` zu einer echten Seite zurückbauen, um das Problem dort zu
lösen · den Knopf je Kontotyp unterschiedlich platzieren.

---

## ADR-0086 — Die Rechtsschicht: Vertragsmodell, Widerrufsfunktion, Rechnung

**Status:** angenommen (2026-09-17) · Migration `0047` · präzisiert ADR-0064 · Rechtsgrundlagen
und Quellen in `docs/LEGAL.md`

> **Keine Rechtsberatung.** Diese Entscheidung beschreibt, was gebaut wurde und warum. Ob es
> genügt, entscheidet eine anwaltliche Prüfung vor dem öffentlichen Start.

### Kontext

Der Phase-1-Audit fand eine vollständige, disziplinierte Handelsmaschine und **keine
Rechtsschicht**. Null Rechtsseiten, keine veröffentlichte Verkäuferidentität, kein Widerrufsweg,
keine Rechnung — und, am folgenreichsten, **keine einzige E-Mail zwischen Bestellung und
Zahlungseingang**.

### Entscheidung 1 — SkyIsles und yulez.collectibles sind **ein** Unternehmen

ADR-0064 sprach von „zwei Rechtssubjekten". Das war falsch. Beide werden von **Julian Stocker** als
**ein Einzelunternehmen** betrieben.

Was ADR-0064 richtig hatte und was bleibt: die Trennung zweier **Rollen**. Die Plattform betreibt
Katalog, Konten und Kasse; der Verkäufer ist Vertragspartner des Kunden. Das ist eine
architektonische Trennung, keine gesellschaftsrechtliche — und sie trägt weiterhin, weil ein
zweiter Verkäufer die Rolle neu besetzen würde, nicht das Eigentum an SkyIsles.

Vertragspartner ist überall: **Julian Stocker, handelnd unter yulez.collectibles**.

Der Satz „SkyIsles liefert derzeit nur innerhalb Deutschlands" machte die Plattform zum Versender
und ist ersetzt.

### Entscheidung 2 — Das Vertragsschlussmodell, an der Technik entlang

| Schritt | Technisch | Rechtlich |
|---|---|---|
| „Zahlungspflichtig bestellen" | `create_order()` legt die Bestellung an | **Angebot des Kunden** |
| sofort danach | Mail `order_received` | **Zugangsbestätigung**, § 312i Abs. 1 Nr. 3 BGB — **keine Annahme** |
| Zahlung bei Stripe | Webhook bestätigt | Erfüllungshandlung, **keine** Annahme |
| danach | Mail `order_confirmation` | **Annahme** → **Vertragsschluss** |
| keine Zahlung | `expired` | **kein Vertrag** |
| `needs_resolution` | `resolution_alert` an den Betreiber | **keine Annahme** |

**Die Zugangsbestätigung ist neu und war die eigentliche Lücke.** Wer bestellte und dessen Zahlung
hängen blieb, bekam bisher **gar nichts**.

**Warum dieses Modell.** Es ist das einzige, das ohne zusätzliche Schritte zur vorhandenen Technik
passt, und es löst den Fall „bezahlt, aber Bestand fehlt" von selbst: dort wird gerade keine
Kundenmail ausgelöst, also entsteht keine Annahme. Verworfen: der Klick schließt den Vertrag (dann
wäre der Verkäufer an Bestellungen gebunden, die er nicht erfüllen kann) · die Zahlung ist die
Annahme (eine Handlung des Kunden ist keine Erklärung des Verkäufers) · Stripe schließt den Vertrag.

Die Mail-Art hieß `payment_confirmation`. Das benannte den Auslöser statt der Handlung; sie heißt
jetzt `order_confirmation` und der alte Wert bleibt nur für bereits versandte Zeilen erlaubt.

### Entscheidung 3 — Elektronische Widerrufsfunktion (§ 356a BGB, seit 19.06.2026 in Kraft)

Zwei Schritte, weil das Gesetz zwei verlangt. **Die Beschriftungen sind der Wortlaut des Gesetzes**
— „Vertrag widerrufen" und „Widerruf bestätigen" — und werden nicht verschönert.

**Ohne Konto**, weil ein Gastkäufer sonst von der gesetzlichen Funktion ausgeschlossen wäre.
Identifiziert wird über Bestellnummer **und** die E-Mail-Adresse auf der Bestellung.

**Die Antwort ist immer dieselbe**, ob etwas passte oder nicht. Sonst wäre die Funktion ein
Auskunftsdienst darüber, welche Bestellungen und welche Adressen es gibt. Der Verbraucher erfährt
das Ergebnis so, wie das Gesetz es vorsieht: durch die Eingangsbestätigung an der von ihm
angegebenen Adresse — mit **Inhalt der Erklärung sowie Datum und Uhrzeit des Eingangs**, alle drei
aus der gespeicherten Zeile, damit Bestätigung und Nachweis nicht auseinanderlaufen können.

**Der Zeitstempel ist der der Datenbank.** Eine Browseruhr entscheidet nicht über eine gesetzliche
Frist.

**Immer erreichbar, ohne berechnete Frist.** Die Frist läuft ab Erhalt der Ware, und dieses Produkt
kennt kein Zustelldatum. Eine hier berechnete Grenze wäre geraten — und eine geratene Grenze, die
zu früh schließt, verwehrt ein gesetzliches Recht.

**Widerruf ≠ Erstattung.** Zwei Ereignisse, zwei Tabellen, zwei Zeitstempel (ADR-0083).

### Entscheidung 4 — Rechnung: erzeugt, nie gespeichert

Ausgestellt **bei bestätigter Zahlung**, also im Moment der Annahme. Nummer `SI-R-<Jahr>-<lfd>`,
einmalig, unveränderlich; ein Trigger weist jede Änderung und jede Löschung zurück.

**Verkäufer- und Kundenangaben werden in die Rechnung kopiert**, nicht gejoint: ein Dokument, das
aus Livedaten neu gerendert wird, ist kein Dokument. Eine spätere Adressänderung ändert keine
ausgestellte Rechnung.

**Es wird keine Datei gespeichert.** Das PDF entsteht bei jedem Abruf aus den unveränderlichen
Zeilen — also gibt es keine Datei, die versehentlich im öffentlichen `catalog`-Bucket landen kann.
Der Zugriff läuft über `authorize_order_payment()`: angemeldeter Eigentümer oder Inhaber der
Capability aus `0013`. Unbekannt und fremd antworten gleich (404).

**Kein Umsatzsteuerausweis, nirgends.** § 19-Umsätze sind **steuerfrei**; eine Zeile „USt 0,00 €"
behauptete eine Besteuerung mit null. § 34a UStDV verlangt das Entgelt **in einer Summe** mit dem
Hinweis auf die Steuerbefreiung — genau das steht dort. Eine fortlaufende Nummer verlangt § 34a
**nicht**; sie wird trotzdem vergeben, als freiwillige Zugabe und nicht als behaupteter
Pflichtinhalt.

**Das HTML ist das primäre Dokument, das PDF liegt daneben.** Ein handgeschriebenes PDF kann kein
getaggtes PDF sein; wer auf assistive Technik angewiesen ist, bekäme daraus lose Textläufe. Die
Seite zeigt dieselben Zahlen in einer echten Tabelle.

### Entscheidung 5 — Versionierung als Schnappschuss, nicht als CMS

Die Texte liegen als **Code** unter `src/lib/legal/`: diffbar, reviewbar, ohne Redaktionsoberfläche.
Die **Versionskennung** steht in `legal_document_versions`, und ein Trigger kopiert sie bei jeder
Bestellanlage nach `order_legal_snapshots` — atomar, ohne zweiten Round-Trip, der fehlschlagen
könnte. Ein Test hält Code und Datenbank in Übereinstimmung.

**Eine historische Bestellung zeigt nie auf einen späteren Text**, weil der Schnappschuss eine
Kopie ist und kein Fremdschlüssel.

### Entscheidung 6 — Was **nicht** gebaut wurde, und warum

**Kein Einwilligungsbanner.** Jeder Client-Speicher ist first-party und dient einer vom Nutzer
gewünschten Funktion. Eine Einwilligung für technisch Erforderliches einzuholen wäre sachlich
falsch und würde echte Einwilligung entwerten.

**Keine AGB-Checkbox.** Die Bedingungen gelten, weil sie Teil des Angebots sind, das der Kunde
abgibt; sie stehen unmittelbar über dem Knopf und sind verlinkt. **Und keine
Datenschutz-Checkbox**: Datenschutzinformation ist Information, keine vertragliche Einwilligung.

**Keine Stripe-Erstattung per Knopf.** Erstattet wird dort, wo die Zahlung liegt; hier wird der
Betrag festgehalten. Ein Knopf, der hier echtes Geld bewegte, bräuchte Schreibrechte an einer
Stelle, die nie welche hatte (ADR-0051), und machte einen Fehlklick unumkehrbar.

**Keine Barrierefreiheitserklärung.** Nach den Geschäftsfakten greift die
Kleinstunternehmen-Ausnahme des BFSG. Eine Konformitätsaussage ohne Pflicht und ohne Prüfung wäre
eine Behauptung; gebaut wird trotzdem barrierefrei.

### Konsequenzen

**Anwendungsreihenfolge: `0042` → `0046` → `0047`.** `0047` hängt an `0010`/`0019` (Bestellungen,
Mail) und `0041` (Verkäuferprädikat).

**Verworfen.** Generische Textbausteine · eine Datenschutzerklärung mit Abschnitten für nicht
vorhandene Technik · ein Cookie-Banner aus Gewohnheit · eine erfundene Telefonnummer · ein
behaupteter Handelsregistereintrag · eine Lieferzeitzusage ohne Grundlage · ein Link zur
eingestellten ODR-Plattform · ein eigenes hübscheres Widerrufsformular statt des gesetzlichen
Musters · Widerruf und Erstattung als ein Vorgang · gespeicherte PDF-Dateien · eine
Umsatzsteuerzeile mit 0,00 €.

### Nachtrag (2026-09-18, zweiter) — der erste Anwendungsversuch schlug fehl

```
ERROR: 42703: column "legal_name" does not exist
```

**Die Verkäuferidentität wurde nach `public.shop_settings` geschrieben.** Diese Spalten liegen auf
`public.sellers`, angelegt von `0040`. Betroffen waren vier Stellen: der Seed in Abschnitt 13,
`orders_snapshot_legal()`, `issue_invoice()` und `shipping_free_from()`. Zusätzlich gab es keine
Spalte `house_number` auf `sellers` — „Lechhalde 1 1/2" ist **eine** Straßenzeile; die Aufteilung
in Straße und Hausnummer gibt es nur bei der **Kundenadresse** (`order_addresses`), und von dort
stammte die falsche Annahme.

**`shipping_free_from()` war der gefährlichere der vier Fälle.** `free_shipping_threshold` existiert
auf **beiden** Tabellen — `0041` hat den Wert nach `sellers` kopiert, weil er eine
Verkäuferentscheidung ist (ADR-0076), und die alte Spalte stehen lassen. Die falsche Tabelle wäre
dort also **nicht** mit einem Fehler aufgefallen, sondern hätte still eine veraltete Zahl geliefert.

**Warum drei Prüfrunden das nicht gefunden haben.** Alle Tests dieses Projekts lesen den
Migrationstext. Eine Anweisung, die die **falsche Tabelle** nennt, ist als Text fehlerfrei — sie ist
nur gegen ein Schema falsch, und kein Test kannte das Schema. Konsequenz:
`columnsOf()` in `src/test-support/migrations.ts` faltet `create table` und
`alter table … add column` über die gesamte Historie, so wie `latestFunction()` Neudefinitionen
faltet, und `src/lib/legal/schema-reality.test.ts` prüft damit jede geschriebene Spalte gegen die
Spalten, die es wirklich gibt. Vier nachgestellte Varianten des Fehlers werden erkannt.

**Nebenbefund beim Bau des Helfers:** `columnsOf()` fand zunächst nur 12 der 25 Spalten von
`sellers`. Der Kommentar in `0040` enthält „…natural or legal person; `trading_name`…" — das
Semikolon beendete für den regulären Ausdruck die Anweisung, drei Zeilen vor dem ersten
`add column`. Kommentare werden jetzt vor dem Vergleich entfernt. Dieselbe Prosa-statt-Code-Falle
wie mehrfach zuvor.

**`0047` wurde nicht teilweise angewendet.** Der SQL Editor hat vollständig zurückgerollt; alle
sechs Tabellen fehlten danach weiterhin, und die Zählstände der Fingerabdrücke (5 bezahlt,
9 unbezahlt) waren unverändert. Das wurde geprüft, nicht angenommen.

### Nachtrag (2026-09-18) — vier Befunde aus der Prüfung vor dem Anwenden

`0047` war noch nicht angewendet, deshalb wurden alle vier **in** `0047` behoben, nicht in einer
Folgemigration.

**Die Zusage „Fingerabdruck wird bei Bezahlung gelöscht" wurde eingelöst.** `0010` hat sie im
Spaltenkommentar formuliert, die Datenschutzerklärung hat sie dem Kunden als Tatsache mitgeteilt,
und niemand hat sie ausgeführt. Ein Trigger tut es jetzt. Bewusst ein Trigger und **keine**
Änderung an `confirm_order_payment()`: diese Funktion ist auf Staging angewendet, und eine
angewendete Migration wird nicht umgeschrieben. Der Preis ist bekannt und klein — eine bezahlte
Bestellung zählt nicht mehr im Stundenzähler der Fingerprint-Dimension —, während der Arm, der
Missbrauch tatsächlich stoppt (offene Checkouts mit **aktiven** Reservierungen), unberührt bleibt,
weil eine bezahlte Bestellung keine aktive Reservierung mehr hält.

**Die Drosselung des Widerrufs-Endpunkts war wirkungslos.** Gezählt wurden Zeilen in
`withdrawal_requests` — die nur bei einem Treffer entstehen. Genau der Fall, gegen den gedrosselt
werden soll (Sonden auf erfundene Bestellnummern), erzeugte keine Zeile und wurde nie gezählt.
`withdrawal_attempts` zählt jetzt **Versuche**, geschrieben bevor irgendetwas über den Treffer
bekannt ist. Die Datenschutzeigenschaft bleibt: gedrosselt oder nicht getroffen — die Antwort ist
dieselbe, und sie verrät nicht, ob es die Bestellung gibt. Gespeichert werden nur Fingerabdruck und
Zeitstempel, und nur für zwei Stunden.

**`order_legal_snapshots` war änderbar.** `invoices` hatte den Schutz von Anfang an; der Snapshot,
der festhält, welche Bedingungen für eine Bestellung galten, hatte ihn nicht — bei gleichem Zweck.
Jetzt weist ein Trigger Änderung und Löschung zurück. Das erste `insert` bleibt erlaubt.

**Die Sandbox-Sperre im Widerruf war als `'live'` einbetoniert.** Damit war der Erfolgspfad auf
Staging überhaupt nicht prüfbar — jede Testbestellung wurde abgewiesen, und die einzige Art, den
Pfad zu sehen, wäre gewesen, ihn auf Production auszuprobieren. Geprüft wird jetzt
`o.commerce_mode = commerce_mode()`: dieselbe Funktion, mit der `create_order()` stempelt.

> **Korrektur (2026-09-18).** Der ursprüngliche Text dieses Absatzes behauptete, Production laufe
> live. **Das stimmt nicht.** Der Production-Preflight hat `commerce_settings.mode = 'sandbox'`
> gemessen (gesetzt am 2026-09-13), und alle vier dortigen Bestellungen tragen
> `commerce_mode = 'sandbox'`; es gibt **null** Live-Bestellungen. Der Satz war eine Annahme, die
> nie geprüft wurde.
>
> **Die Sicherheitsaussage bleibt trotzdem gültig, aber aus dem anderen Halbsatz:** eine Installation
> im Sandbox-Modus nimmt keine echten Bestellungen an (`commerce_checkout_allowed()` verlangt dort
> ein angemeldetes Testkonto), also gibt es dort auch keine echte Kundschaft, deren Bestellung ein
> Fremder widerrufen könnte. Sobald Production auf `live` geschaltet wird, greift die ursprünglich
> beschriebene Wirkung: historische Sandbox-Bestellungen werden ab diesem Moment abgewiesen.
>
> Der **Kommentar im Rumpf von `receive_withdrawal()`** trägt die falsche Behauptung weiterhin —
> `0047` ist auf Staging und Production angewandt und wird nicht rückwirkend geändert. Eine
> Korrektur wäre eine additive Folgemigration, die die Funktion allein wegen eines Kommentars neu
> definiert; sie ist **nicht** durchgeführt worden und wäre nur zusammen mit einer ohnehin nötigen
> funktionalen Änderung sinnvoll.

---

## ADR-0087 — Bestandsabgleich aus der Tabelle, ohne die Tabelle hochzuladen

**Status:** angenommen (2026-09-18) · Migration `0048`

### Kontext

Der Betreiber führt seinen physischen Bestand in `skylanders.xlsx`. Die Datei ist **450 MB groß —
449,4 MB davon sind 554 eingebettete Bilder** in Spalte A, die er für die Inventur am Regal
braucht. Die Zahlen darin sind 0,9 MB.

### Entscheidung 1 — Die Datei bleibt auf dem Gerät

Eine ZIP-Datei ist wahlfrei zugänglich: ein Verzeichnis am Ende sagt, wo jedes Element beginnt.
Am echten Workbook gemessen liegt alles Nötige in den **ersten 714 KB plus den letzten 42 KB**:

| | |
|---|---|
| Zentralverzeichnis (am Dateiende) | 42,3 KB |
| `workbook.xml`, Rels, `sharedStrings` | 19,2 KB |
| die sechs Spiel-Arbeitsblätter | 111,7 KB |
| **gelesen insgesamt** | **≈ 0,75 MB = 0,17 %** |

Gemessen: Verzeichnis öffnen 9 ms, neun Elemente entpacken 4 ms, 15 ms insgesamt.

Der Browser liest diese Scheiben mit `File.slice()` — das eine **Sicht** liefert, keine Kopie, also
64 KB Speicher für die letzten 64 KB einer 450-MB-Datei — entpackt sie mit `DecompressionStream`
und schickt **nur die Zeilen**.

**Damit verschwindet das ganze Problem, statt umgangen zu werden.** Kein 4,5-MB-Body-Limit, kein
privater Bucket, kein temporäres Objekt mit Lebenszyklus, keine ZIP-Bombe auf dem Server, kein
Upload über Mobilfunk. Die ursprünglich vorgeschlagene Architektur — direkter Upload in Supabase
Storage — wurde **verworfen, weil sie nicht nötig ist**: sie löst den Transport eines Datenvolumens,
das nicht transportiert werden muss.

Voraussetzung ist `DecompressionStream` (Safari 16.4+, Chrome 103+, Firefox 113+). Fehlt es, sagt
die Oberfläche das klar; der Rückfallweg wäre, die 0,75-MB-Scheibe zum Server zu schicken, was in
jeden Serverless-Body passt.

### Entscheidung 2 — Es ist ein Abgleich, kein Zubuchen

Spalte F („Storage") ist ein **Zielwert**. Steht dort 0 und im Shop liegen 3, ist die richtige
Antwort **−3**. Deshalb heißt die Funktion Abgleich, und deshalb zeigt die Vorschau Erhöhungen und
Verringerungen getrennt.

**Die Zahlen am echten Workbook:**

| | Zeilen | mit Bestand | Stück |
|---|---:|---:|---:|
| `SUPPORTED_COMPLETE_LOOSE_FIGURE` | **559** | 250 | 992 |
| `IGNORED_GAME` | 39 | 13 | 19 |
| `IGNORED_SWAP_FORCE_HALF` | 13 | 8 | 13 |
| `IGNORED_OVP` | 2 | 0 | 0 |
| `IGNORED_DAMAGED` | 1 | 0 | 0 |
| `UNMATCHED_RELEVANT` / `AMBIGUOUS_RELEVANT` | **0** | 0 | 0 |

**Ignorieren ist eine Handlung, kein Versäumnis.** Eine Spielezeile hat eine gültige SKY-ID und wird
trotzdem weder importiert **noch genullt** — eine CHECK-Constraint macht es einer `IGNORED`-Zeile
strukturell unmöglich, ein Delta zu tragen.

**`ohne OVP` heißt *ohne* Karton.** Vierzehn `Elite … - ohne OVP`-Zeilen sind genau die vollständigen
losen Figuren, um die es geht; ein naives `/OVP/` hätte jede davon verworfen.

### Entscheidung 3 — Zuordnung ist exakt und nach Blatt getrennt

Blatt plus Name löst **600 von 614 Zeilen exakt auf, mit null Mehrdeutigkeit** — keine einzige
brauchte Normalisierung. Die Trennung nach Blatt ist tragend: **32 Namen kommen in mehr als einem
Spiel vor** (`Bash` in SA und G, jeder Konsolentitel in allen sechs). **Es gibt bewusst keine
unscharfe Zuordnung**: eine Beinahe-Übereinstimmung, die still Bestand schreibt, ist das eine
Versagen, das dieses Design nicht riskiert.

Normalisiert wird nur der Schlüssel **gespeicherter Zuordnungen**, damit eine einmal getroffene
Entscheidung ein erneutes Speichern der Tabelle übersteht.

### Entscheidung 4 — Die Tabelle ist die Wahrheit über den Lagerbestand

`Storage` ist ein **Sollwert**, kein Zuwachs. Wer die Datei hochlädt und bestätigt, sagt SkyIsles,
was im Regal liegt:

```
desired = Excel Storage
delta   = desired − current
```

Das Delta gibt es nur, weil Bestand über ein anhängendes Journal bewegt wird (`0003`). Gemeint ist
„gleichziehen"; die Rechnung ist der Weg dorthin.

**Eine frühere Fassung hat das falsch gemacht, und der Fehler ist lehrreich.** Sie verweigerte eine
Erhöhung, wenn die Tabelle älter aussah als die letzte Bestandsbewegung, oder wenn der Wert seit
dem letzten Import unverändert war. Beides ließ SkyIsles eine Anweisung anzweifeln, die der
Betreiber gerade bewusst gegeben hatte — er importiert ja **gerade deshalb**, weil beide Seiten
auseinanderliegen. Steht bei der Bestätigung 5 in der Tabelle, ist der Sollbestand 5.

Beim adversarialen Nachprüfen zeigte sich derselbe Denkfehler auch andersherum: die Behauptung
„eine veraltete Tabelle kann nur fälschlich **hinzufügen**" stimmte nicht. Ein nach dem Speichern
manuell eingebuchter Fund oder eine Rücksendung wäre von einer alten Tabelle genauso fälschlich
**entfernt** worden. Die Asymmetrie war nicht begründbar — und mit der korrigierten Semantik ist
die Frage gegenstandslos.

`dcterms:modified` und der Sollwert des letzten Imports bleiben erhalten: auf dem Bildschirm, damit
auffällt, wenn die falsche Datei gewählt wurde, und in der Historie. **Entscheiden tun sie nichts.**

### Entscheidung 4a — Der einzige echte Konflikt ist eine Reservierung

Weil dort der gewünschte Zustand **unmöglich** ist statt nur überraschend. Reservierte Stücke
gehören bereits einer laufenden Bestellung; `shop_inventory` verlangt `reserved <= quantity`, und
`apply_inventory_movement()` bricht das nicht.

Geprüft wird es **zusätzlich in der Vorschau** — nicht als zweite Meinung, sondern weil die Vorschau
es sonst nicht sagen könnte: Die Zeile sähe fertig aus und der ganze Import bräche später an einer
Bedingung ab, die niemand gezeigt bekommen hat. Solche Zeilen werden übersprungen, alles andere
wird übernommen. **Nicht** gekappt, **nicht** stillschweigend übergangen, und Reservierungen werden
nicht aufgelöst.

### Entscheidung 5 — Bestand wird bewegt, nicht gesetzt

`apply_inventory_movement()` schreibt `shop_inventory.quantity` seit `0003` als Einziges, immer per
Delta, immer mit Journalzeile, und weigert sich bereits, unter `reserved` zu gehen. Der Import ruft
`record_inventory_movement()` mit dem Grund **`correction`** — den `0003` als „a recount, either
direction" definiert — und erbt damit jede dieser Garantien. `0048` schreibt **keine** Bestandszeile
und formuliert **keine** eigene Untergrenze.

**Das Delta wird beim Übernehmen neu berechnet**, nicht aus der Vorschau übernommen: zwischen
Vorschau und Bestätigung kann etwas verkauft worden sein.

**Eine Transaktion.** Eine plpgsql-Funktion ist eine Transaktion: scheitert Zeile 3, fallen 1 und 2
mit. Es gibt keinen halb angewendeten Zustand zu erklären und kein Fortsetzen zu entwerfen.

### Konsequenzen

Anwendungsreihenfolge `0047` → `0048`. Keine neue Bewegungsart, kein Bucket, kein Upload. Eine neu
bebestandete Position bleibt **unlistet und ohne Preis** — `shop_inventory_listed_needs_price`
verlangt es, und es ist richtig so: Veröffentlichen bleibt eine eigene Entscheidung mit einem Preis.

**Verworfen.** Upload der 450-MB-Datei in Storage · Bilder aus dem Workbook entfernen · eine zweite
schlanke Arbeitsmappe · CSV- oder JSON-Export vor jedem Import · Python-Vorverarbeitung · eine
XLSX-Bibliothek, die das ganze Archiv materialisiert · unscharfe Namenszuordnung · Spielezeilen
nullen · Swap-Force-Hälften automatisch paaren · Spalte I als Verkaufspreis · „Overall" und „Sold"
als Bewegungshistorie nachtragen · Tabellensummen als Eingabe.

### Nachtrag (2026-09-18) — Fingerabdruck und Browser-Gate

**Der Fingerabdruck ist inhaltlich, nicht binär.** Die Spalte hieß `file_hash`, war stets `NULL`,
und der Name lud zu genau der falschen Implementierung ein: einen Datei-Hash zu bilden hieße, 450 MB
zu lesen, um 614 Zahlen zu identifizieren — und würde die falsche Frage beantworten, weil ein
Neuspeichern oder ein ausgetauschtes Foto jedes Byte ändert, ohne am Regal etwas zu ändern. Jetzt
`content_fingerprint`: SHA-256 über die kanonisierten *ausgelesenen* Zeilen (Version, Blatt,
getrimmter Name, Storage-Zahl, sortiert, JSON-kodiert).

Bewusst **vor** der Auflösung gebildet — ohne SKY-ID und ohne Klassifikation. Beides ist die
Lesart von SkyIsles und verschiebt sich, wenn der Katalog eine Figur bekommt oder eine Zuordnung
gespeichert wird; keines davon ist eine Änderung am physischen Bestand. Ein Fingerabdruck, der
sich dabei mitbewegt, könnte die einzige Frage, die er hat, nicht beantworten.

**Er blockiert nichts.** Die Tabelle ist die absolute Wahrheit über den physischen Bestand
(Korrektur vom 2026-09-18); ein erneuter Import derselben Aufnahme ist folgenlos, weil jedes Delta
null ist. Die Spalte ist `nullable`, und kein Aufrufer verzweigt auf ihr — beides ist getestet.

**Das Browser-Gate läuft vor der Datei.** Ein Browser ohne `DecompressionStream("deflate-raw")`
scheiterte vorher mitten im Parsen und meldete „Die Datei konnte nicht gelesen werden" — richtig,
nutzlos und von einer kaputten Datei nicht zu unterscheiden. `missingCapabilities()` prüft
`DecompressionStream`, `File.prototype.slice`, `crypto.subtle` und `TextDecoder`, bevor gelesen,
geparst oder ein Import-Batch angelegt wird. `deflate-raw` wird **durch Konstruieren** geprüft, nicht
durch Existenz: Safari 16.4 kennt `DecompressionStream`, aber nur `gzip` und `deflate`. Die tieferen
Prüfungen in `xlsx-reader.ts` bleiben — das Gate erzeugt einen Satz für einen Menschen, sie halten
einen Aufrufer ehrlich.

---

## ADR-0090 — Testvorgang und Unvollständigkeit sind zwei Einordnungen, kein dritter Kanal

**Status:** akzeptiert (2026-09-19) · Migration `0063_orderbook_test_classification.sql` ·
**nur Staging**

### Kontext

Zwei Dinge lagen im Orderbuch falsch, und beide sahen aus wie ein Beschriftungsproblem.

**Testdaten standen mitten in den Geschäftszahlen.** Auf Staging liegen absichtlich behaltene
Rauchtest-Zeilen — Einkauf 94, Verkauf 312 — und sie waren von echten Vorgängen nur daran zu
erkennen, dass jemand `TESTKAUF` in eine Notiz geschrieben hatte. Eine Notiz ist Prosa: sie darf
umformuliert werden, und eine Einordnung, die sich beim Korrigieren eines Tippfehlers ändert, ist
keine. Gleichzeitig zählten diese Zeilen in Anzahl, Ausgaben, Umsatz und Faktor mit.

**`Datum fehlt` war ein Prädikat mit einem Etikett darauf.** Es beantwortete genau eine Frage —
`purchased_at is null` —, während der Betreiber eine breitere meinte: *woran muss ich hier noch
arbeiten?* Ein von Hand angelegter Einkauf ohne eine einzige Position ist genauso unfertig wie
einer ohne Datum, und der Filter konnte ihn nicht nennen.

Dazu kam die Oberfläche: beide Hälften des Orderbuchs öffneten mit einer großen Überschrift und
einem vollbreiten `+ Neuer Einkauf` / `+ Neuer Verkauf` darüber. Drei Zeilen Rahmen vor der ersten
Zahl, und das Lauteste auf einer Werkbank war ein Knopf, den man ein paarmal pro Woche drückt.

### Entscheidung

**Drei Achsen, ausdrücklich unabhängig.**

| Achse | Frage | Antwort |
|---|---|---|
| **Kanal** | Intern oder extern? | `sales.order_id` — unverändert |
| **Einordnung** | Echt oder Test? | `is_test` / `orders.commerce_mode` |
| **Vollständigkeit** | Fehlt noch etwas? | abgeleitet, nicht gespeichert |

Ein Testverkauf ist weiterhin ein **externer** Verkauf. Ein unvollständiger Vorgang ist weiterhin
ein **echter**. Ein Vorgang darf Test **und** unvollständig sein — Verkauf 312 ist genau das.
Nichts davon wird in ein gemeinsames Enum gefaltet.

**Test wird hergeleitet, wo es eine kanonische Quelle gibt.** Ein interner Verkauf projiziert eine
Bestellung, und die trägt die Antwort bereits: `orders.commerce_mode` wird beim Bestellen gesetzt
und danach von `orders_protect_immutable()` verweigert (ADR-0060). Dieselbe Quelle hält seit
ADR-0084 Testbestellungen aus den Livelisten. Eine Kopie auf `sales` wäre eine zweite Wahrheit über
dieselbe Bestellung — also gibt es keine: ein CHECK hält `sales.is_test` für interne Verkäufe auf
`false`, `sale_is_test()` ist die einzige Definition, und jeder Leser ruft sie auf.

Nur was **keine** kanonische Quelle hat — ein von Hand angelegter Einkauf, ein externer Verkauf —
bekommt eine eigene Spalte, Default `false`, beim Anlegen setzbar und später korrigierbar.

**Unvollständigkeit wird nie gespeichert.** Ein `is_incomplete`-Haken müsste gelöscht werden,
sobald jemand das Datum nachträgt, und genau das vergisst man. Die Lesemodelle rechnen ihn bei
jedem Lesen aus den Zeilen selbst aus; Datum nachgetragen heißt Einordnung weg, ohne dass jemand
etwas zurücksetzt.

Die genauen Regeln — je Hälfte getrennt, samt der Liste dessen, was ausdrücklich **nicht**
unvollständig ist — stehen in `docs/DATABASE.md`, Abschnitt 3.3w, und im Kopf von `0063`.

**Die normale Ansicht ist die Geschäftsansicht.** `p_status` steht auf `normal`, also enthält sie
keine Testvorgänge — und weil die Summe über genau die zurückgegebenen Zeilen aggregiert, deren
Geld ebenso wenig. Ausgeblendet wird trotzdem nichts stillschweigend: derselbe Aufruf liefert die
Zähler aller drei Klassen, der `Test`-Chip trägt seinen immer sichtbar, und eine Zeile unter den
Filtern sagt, wo die Zeilen geblieben sind.

**Die Navigation wird die Kopfzeile.** `Einkäufe · Verkäufe · + Neu` in einer Reihe. `+ Neu` ist
kontextabhängig und es gibt genau eines davon je Bildschirm; die großen Knöpfe sind entfernt, nicht
daneben stehen gelassen. Unter **Verkauf → Intern** wird gar keines gerendert — nicht ein
deaktiviertes: ein interner Verkauf entsteht, weil eine Bestellung bezahlt wurde, und ein Knopf,
dessen einziges Ergebnis eine Fehlermeldung ist, bringt jemandem bei, dass es die Tür gibt.

### Begründung der drei Punkte, die auch anders hätten ausgehen können

**Warum nicht die Notiz.** Sie steht genau einmal in `0063` — in der einmaligen Datenkorrektur am
Ende, die zwei bekannte Staging-Zeilen über vier Felder gleichzeitig identifiziert und je ein
Boolean schreibt. Zur Laufzeit liest nichts sie. Auf Production trifft keine der beiden Anweisungen
eine Zeile.

**Warum eine offene Auszahlung nicht unvollständig ist.** Ein Marktplatz zahlt später; das ist der
Normalfall und nicht das Fehlen einer Angabe. `Auszahlung offen` ist seit `0059` ein eigener
Filter und bleibt einer. Dieselbe Trennung gilt für eine noch nicht eingebuchte Einkaufsposition:
das Paket ist noch nicht da — ein Zustand, keine Lücke.

**Warum das Jahr 2028 keine Regel ist.** `Order 2026` enthält einen Verkauf mit Datum
2028-06-28. `seller_set_sale_date()` prüft Plausibilität beim **Schreiben**; ein bereits
gespeichertes Datum nachträglich für falsch zu erklären, weil es seltsam aussieht, wäre geraten.
Die Zeile bleibt unverändert und gilt nicht als unvollständig.

### Konsequenzen

- Zwei Spalten, zwei Korrekturfunktionen, eine Herleitungsfunktion, `p_status` an zwei
  Lesemodellen. Kein Tagging-Framework, keine neue Tabelle.
- Die Vorgängersignaturen von `seller_create_purchase`, `seller_create_sale`,
  `seller_orderbook_ledger` und `seller_sales` werden **gedroppt**, nicht überladen — eine
  Überladung, die sich nur in einem letzten Argument mit Default unterscheidet, macht jeden Aufruf
  mehrdeutig.
- **Auf Staging sind heute alle 25 Bestellungen `sandbox`**, also gelten alle 14 internen Verkäufe
  als Test und `Verkauf → Intern → Alle` ist leer. Das ist die richtige Antwort und kein Sonderfall
  der Umgebung: dieselbe Regel trennt in Production später echte von Sandbox-Käufen, die dann
  nebeneinander existieren.
- Historische Importe bleiben normale Geschäftsvorfälle. Kein Importer nennt die Spalte.
- Kein Lagerbestand bewegt sich. `0063` erwähnt `inventory_movements`, `shop_inventory` und
  `record_inventory_movement()` an keiner Stelle.

### Verworfen

`is_incomplete` als gepflegtes Boolean · Test als dritter Wert neben Intern und Extern · eine
Kopie von `commerce_mode` auf `sales` · dauerhafte Erkennung über `note ilike '%TEST%'` · ein
generisches Tag-System · ein deaktivierter `+ Neu`-Knopf unter Intern · das Umbenennen von
`Datum fehlt` ohne Erweiterung des Prädikats · das Löschen der Staging-Testdaten.

---

## ADR-0091 — Die Figuren gehören ins Anlegen; das Werkbuch gehört geschützt

**Status:** akzeptiert (2026-09-19) · Migration `0064_purchase_create_with_items.sql` ·
**nur Staging**

### Kontext

Der Einkauf wurde in zwei Schritten erfasst: erst der Kopf — Datum, Ausgaben, Notiz —, dann auf
der Detailseite die Figuren. Die Begründung von damals (ADR-0088) war, dass das Paket ohnehin
dort durchgearbeitet wird. In der Praxis weiß der Betreiber beim Tippen des Betrags längst, was
in der Kiste liegt, und der Umweg über einen zweiten Bildschirm machte ausgerechnet den
Normalfall zum langsamen.

Bei der Bestandsaufnahme fiel ein zweites, ernsteres Problem auf. `seller_remove_purchase_item`
existierte seit `0053` und lehnte genau eine Sache ab: eine Position, die eine Lagerbewegung
besitzt. Das war damals vollständig — kein Bildschirm bot Löschen an, und es gab ausschließlich
handgemachte Positionen. Inzwischen liegen **2 114 von 2 115** Positionen als abgeglichene
Werkbuch-Zeilen in der Datenbank, alle mit `movement_id is null`. Sobald die Detailseite
`Entfernen` anbietet — und genau das verlangt dieser Auftrag —, wäre jede einzelne davon einen
Klick vom Verschwinden entfernt gewesen. Ihre Provenienz erzeugt kein Importer neu: dieses
Projekt importiert nicht neu.

### Entscheidung

**Der Entwurf lebt im Browser, bis der Knopf gedrückt wird.** Ein Klick auf ein Suchergebnis legt
nichts an. Die Alternative — den Einkauf beim ersten Treffer erzeugen und Positionen anhängen —
hinterlässt bei jedem Sinneswandel einen verwaisten Einkauf, den jemand suchen und löschen muss.

**Anlegen ist eine Transaktion.** `seller_create_purchase_with_items` nimmt die Figuren als
JSON-Liste entgegen und ruft intern `seller_create_purchase` und je Element
`seller_add_purchase_item` auf. Sie wiederholt deren Prüfungen nicht, sondern delegiert sie; ein
ungültiges Element nimmt den ganzen Einkauf mit. Es gibt keinen Zustand „Einkauf angelegt,
Position 5 fehlt".

**Eine Zeile je Figur im Browser, eine Zeile je Stück in der Datenbank.** Der Entwurf gruppiert
nach SKY-ID und trägt eine Menge, damit drei Wash Buckler drei Taps statt drei Suchen sind. Beim
Absenden wird wieder expandiert. Eine `quantity`-Spalte hätte das Gegenteil bedeutet: eine
Position **ist** ein Objekt — einzeln einbuchbar, einzeln beschädigt, mit höchstens einer
Lagerbewegung.

**Ändern gilt für die ganze Zeile.** Drei Figuren, die in Wahrheit die Dark-Variante sind, werden
in einem Schritt korrigiert. Der seltenere Fall „zwei davon, eines anders" wird über die Menge
gelöst. Eine Zeile an Ort und Stelle zu spalten hätte ein zweites Auswahlmodell für den
selteneren Fehler gebraucht.

**Entfernen und Umzuordnen sind zwei verschiedene Handlungen mit verschiedenen Regeln.**

| | Ungebucht, handgemacht | Ungebucht, historisch | Eingebucht |
|---|---|---|---|
| Figur ändern | ja | **ja** (`0054`) | nein |
| Entfernen | ja | **nein** | nein |

Die mittlere Spalte ist der Kern. Eine historische Zeile muss korrigierbar bleiben — ein
Werkbuchname, der auf die falsche SKY-ID zeigt, ist genau der Fehler, für den `0054` gebaut
wurde —, und dabei bleiben Zeile, Zeilennummer und Provenienz stehen. Sie zu **löschen** ist die
andere Handlung, und die wird abgelehnt, dreifach geprüft: über die Quelle des Einkaufs, über
`state = 'reconciled_legacy'` und über `source_row` samt der beiden Legacy-Marker.

**Eine Suche, überall.** Es gab drei fast gleiche Suchfelder mit unterschiedlicher Trefferfolge.
`FigureSearch` ist jetzt eines, und es sortiert: ein exakter Name gewinnt, ein Präfix schlägt
einen Wortanfang, ein Wortanfang schlägt ein bloßes Enthalten. Vorher konnte `Dark Wash Buckler`
über `Wash Buckler` stehen, weil der Katalog nach SKY-ID sortiert ist — und in der Hand hält man
die einfache.

### Konsequenzen

- Zwei Funktionen in `0064`. Keine Spalte, keine Tabelle, kein Backfill, kein RLS-Eingriff, keine
  Lagerbewegung.
- **Varianten brauchen kein Variantensystem.** `Free Ranger`, `Legendary Free Ranger` und
  `Dark Wash Buckler` sind eigene Katalogzeilen mit eigenen SKY-IDs und eigenen Marktpreisen. Die
  Trefferzeile zeigt Serie, Name, SKY-ID und Preis — kanonische Felder, nichts Erfundenes.
- **Marktwert und Faktor werden live mit derselben Funktion gerechnet, die das Hauptbuch nutzt**
  (`valuePurchase`). Unbekannt ist nicht null: eine Figur ohne Marktpreis zählt als
  `unknownItems` und wird genannt, und ein Marktwert von 0 ergibt **keinen** Faktor statt
  `Infinity`.
- **Keine Suchanfrage je Tastendruck.** Der Katalog kommt einmal mit der Seite; gefiltert wird im
  Speicher. Damit gibt es weder etwas zu entprellen noch eine Antwort, die zu spät eintrifft und
  eine neuere überschreibt.
- Ein Einkauf **ohne** Figuren bleibt möglich und gilt dann als `Unvollständig` (ADR-0090). Wer
  nur Datum und Betrag kennt, speichert und ergänzt später.
- Die Korrektur einer ungebuchten, handgemachten Position wird nicht protokolliert:
  `orderbook_audit` ist verkaufsseitig, und was Provenienz hat, ist stattdessen gar nicht erst
  löschbar. Begründung in `docs/DATABASE.md`, §3.3x.
- `Testvorgang` bleibt unverändert. Figuren hinzuzufügen ändert keine Einordnung.

### Verworfen

Den Einkauf beim ersten Suchtreffer anlegen · eine `quantity`-Spalte auf `purchase_items` · das
Entfernen historischer Zeilen mit einem Warnhinweis statt einer Ablehnung · das Sperren der
Umzuordnung historischer Zeilen (hätte 2 114 Werkbuchzeilen unkorrigierbar gemacht) · ein
Bestätigungsdialog vor dem Entfernen einer ungebuchten Entwurfsposition · ein Variantenmodell
über dem Katalog · eine Suche je Tastendruck gegen die Datenbank · ein eigener Audit-Zweig für
Einkaufspositionen · das Löschen statt Zurücknehmen einer Buchung.

---

## ADR-0092 — Eine Vorlage ist Layout, und es gibt weiterhin eine Auszahlungsformel

**Status:** akzeptiert (2026-09-19) · Migration `0065_sale_create_with_details.sql` ·
**nur Staging**

### Kontext

Der externe Verkauf wurde in Etappen erfasst: Kanal, Datum und drei Beträge im Formular, alles
Weitere — Gebühren, Label, Korrektur, gemeldete Auszahlung — danach in „Details". Das Formular
sagte das selbst in einem Kommentar: *„Zwei Aufrufe, weil `seller_create_sale` das Geld
absichtlich bei null beginnt … ein Fehler im zweiten Schritt hinterlässt einen Verkauf, der in
Details zu korrigieren ist."*

Für diesen Bildschirm ist das kein kosmetisches Problem. Sein Zweck ist der **Abgleich**: die
gemeldete Auszahlung gegen die, die sich aus den Zahlen ergibt. Ein Verkauf, dem zwei Gebühren
fehlen, weil die Verbindung nach dem zweiten Aufruf abbrach, vergleicht gegen eine falsche Zahl —
und sieht dabei vollständig aus.

Bei der Bestandsaufnahme kam ein zweiter Befund dazu, derselbe wie auf der Einkaufsseite:
`seller_remove_sale_item` lehnte nur Positionen mit `movement_id` ab. **1 253 von 1 257**
Verkaufspositionen sind importierte Werkbuch-Zeilen, und weil Historie nie Bestand bewegt, haben
sie alle `movement_id is null`. Geschützt waren sie nur dadurch, dass die Oberfläche den Knopf
nicht zeigte.

### Entscheidung

**Eine Vorlage ist Layout und nichts sonst.** `eBay` bestimmt Beschriftungen, sichtbare Felder
und die Gebührenzeilen, mit denen das Formular öffnet. Gespeichert wird in `sale_fees`,
`settlement_adjustments` und den drei Beträgen auf `sales` — dieselben Strukturen wie für jeden
anderen Kanal. Keine `ebay_fee`-Spalte, keine eBay-Tabelle, kein `if channel = 'ebay'` irgendwo.
Das Modell trug den Fall längst: 820 Gebührenzeilen in vier `kind`/`settled_by`-Kombinationen,
282 Verkäufe mit mehr als einer Gebühr. Eine dritte Plattform ist ein Listeneintrag.

**`settled_by` ist die interessante Frage, und deshalb fragt die Oberfläche sie.** Ein über eBay
abgerechnetes Versandlabel mindert die Auszahlung, ein am Schalter gekauftes nicht — beides ist
echtes Geld. Das war im Arbeitsbuch `lbl eBay` gegen `lbl ext`, hier ist es ein Schalter an der
Gebührenzeile. Und *Versand* steht zweimal auf dem Bildschirm, weil es zwei Dinge sind: was der
Käufer zahlt (Einnahme) und was das Label kostet (Ausgabe).

**Eine Formel.** `plannedPayout` — die Funktion, mit der 292 Werkbuch-Verkäufe rekonstruiert
wurden — zieht von `sales-import.ts` nach `sales-money.ts` um und wird von dort re-exportiert.
Das Anlegen-Formular ruft sie über `payoutView` auf; es kann den xlsx-Reader nicht importieren,
und eine zweite Formel in einer React-Komponente wäre zwei Antworten auf eine Frage. **Sobald
der Verkauf existiert, ist `sale_expected_payout()` die Autorität** — die Detailseite rechnet
nicht nach, und ein Test hält das seit `0062` fest.

**Der Verkauf entsteht als Ganzes.** `seller_create_sale_with_details` ist eine Anweisung und
delegiert an die fünf Einzelfunktionen, statt deren Prüfungen und Audit-Verhalten zu kopieren.
Die drei Beträge setzt sie **direkt**, nicht über `seller_update_sale`: das Anlegen ist keine
Korrektur, und acht Audit-Zeilen „von 0 auf 20,00 geändert" Sekunden nach der Entstehung würden
den Satz entwerten, den `orderbook_audit` trägt. Die gemeldete Auszahlung wird dagegen auditiert
— sie kommt von außen.

**Anlegen bleibt ausdrücklich kein Ausbuchen.** Zehn Figuren im Formular erzeugen null
Lagerbewegungen. `seller_book_sale_item` bleibt der einzige Weg in den Bestand, je physischer
Einheit eine `sale_external`-Bewegung mit `delta = −1`.

**Eine Figurensuche für das ganze Orderbuch.** `FigureSearch` und `FigureDraft` (aus `0064`,
dort noch `PurchaseDraft`) werden geteilt statt kopiert. Nichts am Auswählen einer Figur
unterscheidet Kaufen von Verkaufen.

**Korrigieren und Löschen sind zwei Handlungen.**

| | ungebucht, handgemacht | ungebucht, historisch | ausgebucht | intern |
|---|---|---|---|---|
| Figur ändern | ja | nein | nein | nein |
| Entfernen | ja | nein | nein | nein |

Enger als auf der Einkaufsseite, und mit Absicht: `0054` erlaubt das Umzuordnen historischer
*Einkaufs*-Positionen, weil genau dafür gebaut. Für Verkäufe gab es das nie, kein Bildschirm hat
es angeboten, und diesen Kurationsweg hier zu erfinden wäre Umfang, den niemand verlangt hat.

### Konsequenzen

- Drei Funktionen in `0065`. Keine Spalte, keine Tabelle, kein Backfill, kein RLS-Eingriff, keine
  Lagerbewegung.
- Das Anlegen-Formular kennt keinen eBay-Zweig: jeder Unterschied ist ein Feld am
  Vorlagenobjekt (`showsDiscount`, `defaultFees`, `channel`).
- Eine leere Gebührenzeile wird **verworfen**, keine Gebühr über 0,00 € gespeichert.
- Die Differenz ist `null`, solange nichts gemeldet ist — nie `0,00 €`, was als „stimmt überein"
  gelesen würde. Vor dem Vergleich wird auf zwei Nachkommastellen gerundet, damit
  `18.419999999999998` keine Abweichung ist.
- Beide Positionskorrekturen schreiben nach `orderbook_audit` (`sale_item`).
- Ein Verkauf ohne Figuren bleibt möglich; er ist dann `Unvollständig` (ADR-0090).

### Verworfen

Eine eBay-Tabelle oder eine `ebay_fee`-Spalte · ein `channel`-Zweig in Query oder Komponente ·
eine zweite Auszahlungsformel in React · das Nachrechnen der Auszahlung auf der Detailseite ·
`seller_update_sale` für die Beträge beim Anlegen (falsche Audit-Aussage) · eine dritte
Figurensuche · das Ausbuchen aller Positionen beim Anlegen · eine Mengenspalte auf `sale_items` ·
das Umzuordnen historischer Verkaufspositionen · das Löschen statt Zurücknehmen einer
Lagerbewegung.

---

## ADR-0093 — `Offen` ist eine vierte Achse, und sie verspricht nur, was die Buchung annimmt

**Status:** akzeptiert (2026-09-19) · Migration `0066_orderbook_open_status.sql` ·
**nur Staging**

### Kontext

Das Orderbuch konnte sagen, ob an einem Vorgang etwas **fehlt** (`Unvollständig`, ADR-0090). Es
konnte nicht sagen, ob an einem vollständigen Vorgang noch etwas zu **tun** ist. Ein Verkauf kann
auf den Cent erfasst sein — Datum, Figuren, Gebühren, Auszahlung — und die Figur liegt trotzdem
noch im Regal. Das ist keine Lücke in den Unterlagen, das ist offene Arbeit, und dafür gab es
keinen Filter.

### Entscheidung

Eine vierte, unabhängige Achse: **`Alle · Offen · Unvollständig · Test`**. Abgeleitet, nirgends
gespeichert, keine neue Spalte.

**Die Regel ist die der Buchungsfunktion selbst** — und das ist der eigentliche Inhalt dieser
Entscheidung, nicht ein Implementierungsdetail:

```sql
-- Einkaufsposition offen:
movement_id is null and sky_id is not null and state in ('ordered', 'arrived')

-- Verkaufsposition offen:
order_id is null and source <> 'excel_order_2026'
  and movement_id is null and sky_id is not null
```

Das ist wörtlich das, was `seller_book_purchase_item` bzw. `seller_book_sale_item` akzeptieren.
Ein Vorgang ist offen, sobald **eine** solche Position existiert.

**Was das kostet, und warum es trotzdem richtig ist.** Die Analyse hatte zunächst eine weitere
Variante vorgeschlagen: zusätzlich die Werkbuch-Marker lesen — `purchase_items.legacy_booked_flag`
leer, `sale_items.legacy_stock_flag` weder `x` noch `r`. Das Arbeitsbuch kennzeichnet so **111
Einkaufs- und 240 Verkaufspositionen** als noch nicht gebucht. Gemessen auf Staging:

| Regel | Einkauf offen | Verkauf offen | davon echte Geschäftsvorfälle |
|---|---|---|---|
| Bedingungen der Buchungsfunktionen | 2 (4 Pos.) | 4 (10 Pos.) | **0 / 0** |
| zusätzlich Legacy-Marker | 8 (111 Pos.) | 34 (222 Pos.) | 6 / 30 |

Die zweite Variante zeigt mehr — und **jede einzelne dieser Zeilen wäre beim Klick auf
`Einbuchen`/`Ausbuchen` abgewiesen worden.** `seller_book_purchase_item` lehnt
`state = 'reconciled_legacy'` ausdrücklich ab („a historical purchase item is already reflected in
stock and is never booked again"), `seller_book_sale_item` lehnt `source = 'excel_order_2026'` ab
(„historical sales never move stock"). Alle 111 bzw. 240 Positionen liegen auf importierten
Vorgängen.

Ein Filter, der eine unmögliche Aktion verspricht, ist schlechter als einer, der schweigt — und
schlimmer: er würde den Betreiber einladen, Bestand zu erzeugen, den der nächste
`/admin/imports`-Abgleich sofort wieder abräumt, weil dort der physische Sollbestand entschieden
wird. Dieselbe Begründung schließt schon heute Nicht-Figuren aus: ein Portal mit `sky_id is null`
ist nie einbuchbar und daher nie offene Arbeit.

**Konsequenz, offen benannt:** `Offen` zeigt auf Staging heute nur Testvorgänge, weil alle echten
Vorgänge importiert sind. Der Filter wird nützlich, sobald der Betreiber Einkäufe und Verkäufe von
Hand anlegt — und das ist inzwischen der normale Weg (ADR-0091, ADR-0092). Der Werkbuch-Rückstand
aus dem Arbeitsbuch ist damit **nicht** adressiert; er ist eine Frage an das Arbeitsbuch und an
den Bestandsabgleich, nicht an das Orderbuch.

### Konsequenzen

- Zwei Lesemodelle bekommen ein abgeleitetes `is_open`, einen Zähler und einen `p_status`-Wert.
  Beide Signaturen bleiben gleich, also bleibt jeder Aufrufer unberührt.
- Vier Achsen, vier unabhängige Fragen. Ein Einkauf kann offen **und** unvollständig sein (auf
  Staging: #94, #95) oder nur eines von beidem.
- In der Liste ein leerer Ring `○` neben dem gefüllten Punkt `●` von `Unvollständig`.
  Unterscheidbar ohne Farbe, und bewusst leiser als das `Test`-Abzeichen: an einem offenen
  Vorgang ist nichts falsch.
- Kein Backfill, keine Spalte, kein RLS-Eingriff, keine Lagerbewegung.

### Verworfen

Eine gepflegte `is_open`-Spalte · die Legacy-Marker als Quelle (siehe oben) · `Offen` als vierter
Wert neben `Alle/Unvollständig/Test` statt als eigene Achse · ein Warnsymbol in Rot · das
Aufweichen der Buchungsfunktionen, damit historische Positionen doch buchbar werden.

---

## ADR-0094 — Ein abgeschlossenes Passwort-Zurücksetzen endet beim Login

**Status:** akzeptiert (2026-09-19) · keine Migration · Code

### Kontext

`/reset-password` speicherte das neue Passwort und blieb stehen. Die Seite zeigte eine
Erfolgsmeldung unter demselben Formular, und der Browser hielt weiterhin die temporäre
Recovery-Sitzung, die der Mail-Link erzeugt hatte. Nichts sagte, dass der Vorgang vorbei war; ein
Reload zeigte wieder das Formular; und das Passwort, das gerade geändert worden war, hatte noch
niemand benutzt.

Ursache war eine geteilte Aktion: `updatePasswordAction` bediente sowohl `/account/security` —
wo Stehenbleiben richtig ist, der Mensch ist absichtlich angemeldet — als auch das Zurücksetzen,
wo es falsch ist.

### Entscheidung

Eine zweite, sehr kleine Aktion `resetPasswordAction` nur für den Recovery-Fall. Sie tut dasselbe
und endet anders: **Sitzung beenden, dann zum Login.**

```
updateUser({ password })  → Fehler?  → Feldfehler, Formular bleibt, Sitzung bleibt
                          → Erfolg?  → signOut() → redirect("/login?passwort-geaendert=1")
```

**Das `signOut()` ist tragend, nicht Kosmetik.** `/login` steht in
`SIGNED_OUT_ONLY_PREFIXES`; ein Redirect ohne Abmeldung würde den noch angemeldeten Browser vom
Proxy auf den Katalog weitergeleitet sehen — der Bug wäre durch einen leiseren ersetzt.

**Die Reihenfolge ist die Entscheidung.** Abmelden und Weiterleiten passieren ausschließlich
nach einem erfolgreichen `updateUser`. Ein abgelehntes Passwort lässt Formular *und* Sitzung
stehen: für einen Tippfehler eine neue Mail anzufordern wäre die schlechtere Antwort. Fehlt die
Recovery-Sitzung ganz — Link abgelaufen oder schon benutzt —, sagt das Formular das, statt eine
Weiterleitung zu zeigen, die nach Erfolg aussieht.

Genau ein `redirect()`, ohne `next`, ohne Rückverweis auf `/reset-password`: es gibt nichts, wovon
eine Schleife entstehen könnte.

### Konsequenzen

- `/account/security` ist unverändert und bleibt bei `updatePasswordAction`.
- Ein Satz über dem Login-Formular, gesteuert von `?passwort-geaendert=1`. Ein Query-Parameter,
  kein Flash-Cookie: er überlebt genau eine Navigation und verrät nichts.
- 13 Tests in `src/lib/auth/reset-password.test.ts` für Erfolg, Fehler, fehlende
  Recovery-Sitzung, Reihenfolge, Schleifenfreiheit und die Unberührtheit der Einstellungsseite.

### Verworfen

`updatePasswordAction` um einen Schalter erweitern · den Redirect ohne `signOut()` · ein
Flash-Cookie · nach dem Zurücksetzen automatisch anmelden (dann bliebe das neue Passwort
ungetestet) · `/reset-password` in `SIGNED_OUT_ONLY_PREFIXES` aufnehmen (das würde den Flow
zerstören, der die Recovery-Sitzung ja braucht).

---

## ADR-0095 — Es gibt eine Auszahlung, und sie wird gerechnet

**Status:** akzeptiert (2026-09-19) · keine Migration · Code

### Kontext

Der externe Verkauf kannte zwei Auszahlungen: die **erwartete**, aus Erlös, Versand, Gebühren
und Erstattungen gerechnet, und die **gemeldete**, die der Mensch nach dem Blick in die
eBay-Abrechnung eintippt. Daraus folgte ein Status — „Auszahlung offen", „stimmt",
„abweichend" — plus eine manuelle Bestätigung, die ihn schließt.

Das war eine Buchhaltungsaufgabe, die sich das Orderbuch selbst gestellt hat. Die Formel ist
vollständig: Erlös + Versand − Versandlabel − Erstattungen − (Transaktions-, Marktplatz- und
sonstige über den Kanal abgerechnete Gebühren) + Korrekturen. Was sie liefert, ist keine
Schätzung, die eine Meldung bestätigen müsste, sondern dieselbe Zahl. Der Status hat nie eine
Abweichung gefunden, die nicht eine **fehlende Gebührenzeile** war — und die gehört erfasst,
nicht gemeldet.

### Entscheidung

**Eine Zahl. Keine Meldung, kein Status, keine Bestätigung.**

`plannedPayout()` und `sale_expected_payout()` bleiben und sind ab hier *die* Auszahlung.
Entfernt: das Eingabefeld, `payoutState`, `payoutDifference`, `payoutCell`, `payoutDelta`, der
Filter „Auszahlung offen" und das manuelle Abschließen.

Stimmt die Zahl nicht mit der Abrechnung überein, fehlt eine Gebühr oder eine Erstattung.
Dann wird **die** nachgetragen, und die Auszahlung stimmt wieder — an einer Stelle statt an zwei.

### Konsequenzen

- Der RPC nimmt den gemeldeten Wert weiterhin entgegen und ignoriert ihn; die Spalte bleibt
  stehen. **Keine historischen Finanzdaten werden gelöscht** — was eingetragen wurde, bleibt
  lesbar, es steuert nur nichts mehr.
- Die vierte Achse `Offen` (ADR-0093) ist davon unberührt: sie fragt nach der *Ausbuchung*,
  nicht nach Geld.
- `sales-money.ts` besitzt `plannedPayout`, `roundMoney`, `parseMoney`, `parseSignedMoney`.
  `saleFormMoney()` ist die eine Konstruktion, aus der Panel und Payload lesen — vorher gab es
  zwei, und sie konnten auseinanderlaufen.

### Verworfen

Den Status behalten und nur ausblenden · die Meldung zur Pflicht machen · eine Toleranzgrenze
(„bis 5 Cent gilt als stimmt") — eine Schwelle hätte genau die Gebührenzeilen verschluckt,
deretwegen es überhaupt Abweichungen gab.

---

## ADR-0096 — Der Production-Transfer ist ein Einmalwerkzeug, kein Synchronisationssystem

**Status:** akzeptiert (2026-09-19) · ausgeführt am 2026-09-19 · Werkzeug

### Kontext

Die rekonstruierte Excel-Historie — 84 Einkäufe, 2114 Positionen, 292 Verkäufe, 1253
Positionen, 813 Gebühren, 41 Erstattungen, 4 Korrekturen, 13 Namenszuordnungen — lag in
Staging und musste nach Production. Ein `pg_dump` kam nicht in Frage: er hätte Staging-Konten,
Fixture-Bestände, einen fremden Bewegungs-Ledger und 25 Sandbox-Bestellungen mitgebracht und
einen bereits korrekten Production-Bestand überschrieben.

`tools/transfer-to-production.mts` kopiert deshalb **Zeilen, keine Datenbank**: nur
`source = 'excel_order_2026'`, ohne Bestand, ohne Auth, mit Neuvergabe der Ids und
Umschreibung der Elternverweise. Er lief am 2026-09-19. Die Nachprüfung war vollständig grün.

### Das Problem, das der zweite Probelauf gefunden hat

Identität reist im `import_fingerprint`. Für Einkäufe und Verkäufe trägt ihn jede Zeile, und
ein zweiter Lauf schreibt dort nachweislich nichts. **`settlement_adjustments` ist die
Ausnahme:** drei der vier historischen Korrekturen hängen an einem Verkauf und haben *keinen*
Fingerabdruck — nur die freistehende hat einen, seit 0061. Ein Fingerabdruckvergleich kann sie
nicht wiedererkennen, also meldete der zweite Probelauf sie als neu. Ein dritter Lauf hätte sie
dupliziert.

### Entscheidung

**Nicht die Wiedererkennung reparieren, sondern den zweiten Lauf verbieten.**

Eine Ersatzidentität aus `(sale_id, amount, reason)` wäre ein dauerhafter
Abgleichmechanismus, der Zeilenidentität errät — gebaut für eine Migration, die einmal
stattfindet und bereits stattgefunden hat. Stattdessen fragt das Werkzeug das Ziel:

```
Trägt irgendein Klasse-A-Fingerabdruck aus Staging bereits in Production?
   ja  → GESPERRT.  --apply bricht mit Exit 1 ab, bevor irgendetwas geschrieben wird
   nein → der Transfer hat noch nicht stattgefunden
```

Keine Markertabelle, keine Versionszeile, kein Zustand, den das Werkzeug pflegen müsste:
**die übertragenen Daten sind der Beleg, dass die Übertragung stattfand.**

Die Sperre ist absichtlich grob. Sie fragt nicht, *welche* Zeilen fehlen, denn ein halb
abgeschlossener Transfer ist nichts, was ein erneuter Lauf stillschweigend vervollständigen
sollte — das ist eine Entscheidung für einen Menschen vor den Daten, nicht für einen Filter.

### Konsequenzen

- `npm run transfer:preview` läuft weiter, meldet die Sperre und zeigt **keine** Insert-Liste
  mehr, die niemand mehr ausführen kann.
- `npm run transfer:apply -- --confirm-production` endet mit Exit 1 und schreibt nichts.
  Nachgewiesen: Zählstände und Summen vor und nach dem Versuch byte-identisch.
- Die drei fingerabdrucklosen Korrekturen bleiben, wie sie sind. Sie sind echte historische
  Daten; ihnen nachträglich einen Fingerabdruck zu geben hieße, Identität zu erfinden.
- Die Filterzeile für `newAdj` bleibt ehrlich falsch — sie meldet die drei als neu, weil sie es
  nicht besser wissen *kann*. Genau deshalb gibt es die Sperre, und ein Kommentar sagt das an
  Ort und Stelle.

### Verworfen

Matching über `(sale_id, amount, reason)` · den drei Korrekturen nachträglich Fingerabdrücke
schreiben · eine `migrations_applied`-Markertabelle in Production · das Werkzeug löschen (eine
Migration, die man nicht mehr nachlesen kann, ist eine, die man nicht mehr prüfen kann).

---

## ADR-0097 — Ein Buch ist eine Tabelle, und eine zu breite Tabelle scrollt

**Status:** akzeptiert (2026-09-20) · keine Migration · UI

### Kontext

Das Orderbuch war für den Schreibtisch gebaut und wird am Telefon benutzt.

Unterhalb von 48rem klappten `.ob-row` und `.ob-item` auf `grid-template-columns: 1fr auto`
zusammen: zwei Zeilen je Datensatz, **keine Kopfzeile**, und der restliche Inhalt — bei einem
Verkauf acht Werte — gedrängt in die zweite Zeile. Die Begründung stand im Stylesheet und war
plausibel: „label-free, because the values are recognisable — a date, a count, amounts, a
ratio". Sie stimmt für zwei Werte und bricht bei zehn zusammen. Was der Inhaber sah, war eine
Spalte dichter, unbeschrifteter Fragmente, die man nicht nach unten vergleichen kann.

Die Anlegen-Formulare hatten das gespiegelte Problem: eine Einleitung, ein Hinweis unter dem
Datum, einer zur Vorlage, einer zu den Figuren, einer zum Abrechnungsschalter und drei Zeilen
Formel unter der Auszahlung. Auf einem 360px-Schirm war mehr Fließtext als Eingabefeld zu sehen.

### Entscheidung

**Die Spalten gelten bei jeder Breite. Was nicht passt, wird gescrollt.**

```
vorher   < 48rem : grid-template-columns: 1fr auto      (zwei Zeilen, keine Kopfzeile)
         ≥ 48rem : var(--ob-columns, …)                 (sieben bzw. zehn Spuren)

jetzt    überall : var(--ob-columns, …)
                   .ob-min  → Boden, unter dem nicht gequetscht wird
                   .ob-scroll → seitwärts immer; abwärts gehört auf dem
                                Telefon der Seite, auf dem Desktop dem Buch
```

Drei Folgeentscheidungen, jede aus der ersten:

**Die Kopfzeile ist nicht mehr versteckt.** Eine Spalte, die man drei Positionen weit
geschoben hat, beschriftet sich nicht selbst.

**Die erste Spalte klebt links.** Eine Zahlenreihe ohne Datum davor gehört zu nichts. Die
Zelle erbt den Hintergrund der Zeile, um das Durchscheinende zu verdecken — **deshalb sind die
Zeilen deckend** statt `bg-surface/60`. Der Klick-Knopf bekommt `z-10` und die Zeile `isolate`,
damit er die Zelle überragt, ohne auch die klebende Kopfzeile zu überdecken.

**Die vertikale Achse gehört auf dem Telefon der Seite.** Eine Tabelle, die den Wisch nach
unten schluckt, ist die Beschwerde, die Menschen über Tabellen auf Telefonen tatsächlich haben.

### Der Boden wird nach der flexiblen Spalte bemessen, nicht nach der Summe

Der erste Boden war die Summe der Spuren plus Abstände plus Polster — arithmetisch richtig und
unbrauchbar. `Figur` ist `minmax(0, 1fr)` und bekommt, was übrig bleibt; bei exakt der Summe
bleibt nichts übrig. Beide Positionslisten waren so bemessen und hätten einem Figurennamen
40 bzw. 68 Pixel gegeben.

Sichtbar wurde das erst jetzt: vorher galt der Boden nur auf dem Desktop, wo das Fenster
breiter ist als er. **Bei jeder Breite ist der Boden die Breite, die ein Telefon bekommt.**
Einkauf steht deshalb auf 44rem und die Verkaufs-Positionsliste auf 52rem — gewählt für die
flexible Spalte, nicht für die Summe. Ein Test misst genau das und nicht die Summe.

### Die Formulare: Gruppen statt Sätze

Sechs Überschriften im Verkauf (`Verkauf · Figuren · Beträge · Kosten · Auszahlung · Notiz`),
vier im Einkauf (`Einkauf · Figuren · Betrag · Notiz`), in dieser Reihenfolge, Wichtiges zuerst.
`FormSection` und `Field` in `components/business/form-section.tsx` sind für beide dieselben —
vorher hatte jedes Formular sein eigenes `Row` und `Heading` und die beiden drifteten.

**Keine Karte in der Karte:** eine Gruppe ist eine Überschrift und ein Abstand. Das einzige
umrandete Element ist die **Auszahlung**, weil sie die Antwort ist und keine Frage.

**Eine Spalte auf dem Telefon, immer.** Jedes Raster beginnt einspaltig und teilt sich erst bei
`sm:`. Die Ausnahme ist die Gebührenzeile — vier Bedienelemente passen nicht über 320px —, und
sie stapelt: Name auf der ersten Zeile, Betrag, Schalter und `×` auf der zweiten.

**Was an Text blieb.** Der Satz „Anlegen ändert den Bestand nicht" ist nicht gelöscht, sondern
umgezogen: neben den Positions-Picker, wo `Einbuchen` bzw. `Ausbuchen` tatsächlich stehen —
der Verkauf sagte ihn dort schon. Die Erklärung des Testvorgangs ist ein `title` am Kästchen.
Geblieben ist `settledHint`: was der Abrechnungsschalter bewirkt, sieht man nicht am Schalter.

**Was gelöscht wurde, weil es nichts mehr erklärte:** `hint`, `dateHint`, `templateHint`,
`figuresHint`, `payoutHint`, `adjustmentHint`, `undatedNew`, `figures.emptyAllowed`.

Und `Vorlage` heißt jetzt **`Kanal`**. Der Inhaber wählt, wo verkauft wurde; dass davon auch das
Layout abhängt, ist eine Folge und keine Frage, die er beantworten muss. Gespeichert wird
unverändert `sales.channel`.

### Nebenbefund

`bg-bg/40` auf der aufgeklappten Zeile benannte keine Theme-Farbe — `--color-bg` gibt es nicht,
die Utility wurde nie erzeugt, der Bereich hatte gar keinen Hintergrund. Gemeint war `canvas`.

### Konsequenzen

- **Keine Geschäftslogik, keine Berechnung, kein RPC und kein Datenmodell angefasst.**
- 22 neue Tests in `mobile-layout.test.ts` messen gegen echte Gerätebreiten (320/360/390/393/414).
  Die alten Tests, die die Zwei-Zeilen-Faltung festschrieben, wurden ersetzt, nicht gelöscht.
- Ein `title` auf den Namenszellen: wo `truncate` doch greift, ist der Name erreichbar.

### Verworfen

Spalten auf dem Telefon weglassen (welche?) · Karten statt Tabelle (das war der Zustand vor
ADR-0088) · die Faltung behalten und nur beschriften (zehn Beschriftungen kosten mehr Platz als
die zehn Werte) · die klebende Spalte weglassen (dann gehört eine gescrollte Zahlenreihe zu
nichts) · den Boden per JavaScript messen.

---

## ADR-0098 — Was dir fehlt, tritt einen Schritt zurück

**Status:** akzeptiert (2026-09-20) · keine Migration · UI

### Kontext

Seit V3.6 ist die Karte für jeden Betrachter dieselbe: `figure.cardType` entscheidet das
Artwork, Besitz entscheidet nur, ob das `CollectedSeal` obendrauf liegt (ADR-0038, V3.2). Das
war eine bewusste Entscheidung und bleibt richtig — die Karte einer Figur ist eine Eigenschaft
der Figur, nicht des Betrachters.

Nur beantwortet sie eine andere Frage als die, die man beim Durchscrollen von 561 Karten hat:
**was fehlt mir?** Das Siegel sagt es, aber es ist ein kleines Element auf einer vollen Karte
zwischen anderen vollen Karten. Die Rasterzeile sieht in beiden Fällen gleich aus.

### Entscheidung

**Nicht gesammelt: eine Spur kleiner, auf einer entsättigten Hülle. Sonst nichts.**

```
gesammelt      volle Größe · volles Kartendesign · Siegel · unverändert
nicht gesammelt  ×0,97      · Hülle entsättigt     · Inhalt unverändert
```

**Die Hülle ist genau ein Element.** Das gesamte Kartendesign — Rahmen, Papier, Vergoldung,
Krone, geprägte Linie und die Silberplatte der Handelszeile — ist in *ein* PNG gemalt, Layer 2
von `FigureCard`. Ein Filter dort kann Layer 1 (das weiße Fenster und das Figurenbild) und
Layer 3 (Name, Varianten-Siegel, MARKTWERT, Preis, Element, Anzahl) nicht erreichen, und die
Handelszeile ist ein viertes Raster darunter.

Das macht „nur das Kartendesign wird grau" zu einer **strukturellen Tatsache** statt zu einer
Liste von Ausnahmen, die jemand pflegen muss. Ein Test zählt die Verwendungen: `understated`
kommt im Bauteil genau dreimal vor — einmal berechnet, zweimal benutzt.

`saturate(0.45) brightness(0.97)`: Farbe raus, Licht fast nicht. Abdunkeln sagt „schlechter",
und jenseits von etwa 8 % zieht es den Eigenkontrast des Artworks mit nach unten — dann sieht
eine entsättigte Karte billig aus statt ruhig. Unter `forced-colors` entfällt der Filter ganz,
sonst käme die Hülle in voller Stärke zurück, während der Größenunterschied bliebe.

### Die Größe ist Farbe, nicht Layout

`transform: scale()`, nicht Breite, Rand oder Innenabstand. Die drei wären Layout: **eine**
geschrumpfte Karte vermisst ihre Spalte neu, und jede andere Karte der Zeile verschiebt sich
mit. Ein Transform ist Malerei — die Rasterzelle behält ihre Größe, die Abstände bleiben
identisch, und `scale` nimmt die Typografie mit, sodass innerhalb der Karte nichts neu
umgebrochen wird.

`transform-origin: center bottom`: die Karten einer Zeile stehen auf einer Linie und ihre
Handelszeilen fluchten. Keine Transition — die Änderung ist sofort, wie verlangt.

**0,97, und warum diese Zahl.** Eine Karte ist über die vier Rasterstufen zwischen 177 px und
214 px breit. 3 % davon sind 5–6 px Breite, also rückt jede Kante um rund 3 px ein — gegen
einen Rahmen, der bei diesen Breiten selbst 5–6 px misst. Die beiden Zustände unterscheiden
sich also um etwa einen halben Rahmen je Seite, und das ist eine Rahmenbreite genau dort, wo
das Auge vergleicht: an der Lücke zwischen zwei Karten.

### `understatesCard` ist nicht die Negation von `marksOwnership`

Und darin liegt die ganze Entscheidung. `marksOwnership` beantwortet „ist das mein Exemplar";
**drei der fünf Oberflächen, die eine Karte zeichnen, können das gar nicht beantworten**, und
für sie ist die Antwort „nein" statt „nicht besessen":

| Oberfläche | kennt die Sammlung |
|---|---|
| Katalog, angemeldet | **ja** — die einzige, die ihre Karten abstuft |
| Sammlung | ja, und dort ist alles besessen → greift nie |
| Katalog, abgemeldet | nein — es gibt noch keine Sammlung |
| Katalog, Administrator | nein — er sammelt nicht aus seinem eigenen Katalog (ADR-0042) |
| Figurenseite, Geschwister | nein — `showcase` markiert nie Besitz |

Die Oberfläche sagt deshalb **ausdrücklich**, ob sie es weiß: `knowsCollection`, standardmäßig
aus. Es aus dem Vorhandensein von `onToggle` abzuleiten würde eine visuelle Regel an einen
Event-Handler binden und das Aussehen der Admin-Karte zu einer Nebenwirkung davon machen.

Ohne diese Unterscheidung wäre der abgemeldete Katalog ein Raster, in dem **jede** Karte
geschrumpft und grau ist — das sagt nichts über Besitz und lässt bloß das Design verblassen.

### Konsequenzen

- **Keine neue Geschäftslogik, keine Datenbankänderung.** Der Status kommt aus der bestehenden
  Collection-Logik, über dieselbe `collected`-Eigenschaft, die die Karte schon hatte.
- Prestige, Legendary, Dark, Gold, Chase: unverändert, wenn gesammelt. Der Tinten-Tausch für
  dunkles Papier hängt weiter am Artwork und nicht am Betrachter.
- 26 Tests in `collected-emphasis.test.ts`, davon fünf, die festhalten, welche Oberfläche
  abstuft, und vier, die das Raster gegen Layout-Änderungen schützen.

### Verworfen

Ein zweites Artwork je Zustand (das war V3.5 und wurde in V3.6 abgeschafft) · `opacity` auf der
ganzen Karte (dimmt den Text mit, den die Anforderung ausdrücklich ausnimmt) · `grayscale(1)`
(nimmt die Kartentypen ununterscheidbar mit) · eine Breitenänderung (verschiebt das Raster) ·
eine Transition (es wurde ausdrücklich keine Animation gewünscht) · die gesammelte Karte
*größer* zu machen statt die andere kleiner (dann müsste das Raster für den größeren Zustand
Platz vorhalten, den es meistens nicht braucht).


---

## ADR-0099 — Orderbuchstatus ist nicht Lagerstatus

**Status:** akzeptiert (2026-09-20) · Migrationen `0067`–`0076` · Datenmodell + RPC

### Kontext

Das Orderbuch zeigte für jede Position `Eingebucht ✓`, auch für Ware, die nie im Regal stand.
Die Ursache war keine Anzeigefrage: Import und Datenmodell hatten **zwei verschiedene Dinge in
ein Feld gelegt** — „was ist mit diesem Vorgang zu tun?" und „was ist mit diesem Stück im Lager
passiert?". Solange beides dasselbe Feld ist, muss jede Statusänderung entweder eine Bewegung
erfinden oder eine verschweigen.

Die rekonstruierte Arbeitsbuch-Historie macht den Unterschied unvermeidbar. Sie enthält
Einkäufe, die bezahlt und noch unterwegs sind; Positionen ohne Katalogbezug, die nie ein Regal
haben werden; verschickte Verkaufszeilen, die das Lager ausdrücklich **nicht** berührt haben;
und Retouren, die angekündigt, eingetroffen oder eingelagert sein können — drei Zustände, nicht
einer.

### Entscheidung

**Der fachliche Status eines Vorgangs und die physische Lagerbewegung sind getrennt. Eine
Bewegung entsteht ausschließlich durch eine ausdrückliche Handlung, und sie hinterlässt immer
einen Beleg.**

1. **Ein Einkauf verändert den Bestand erst durch explizites Einbuchen.** `ordered` heißt
   bestellt und unterwegs — nicht angekommen, nicht eingelagert.
2. **Ein Verkauf verändert den Bestand erst durch explizites Ausbuchen.** `shipped_at` sagt,
   dass das Paket raus ist; über das Regal sagt es nichts.
3. **`movement_id` ist der Beleg einer echten Ausbuchung** (`sale_external`, −1) bzw. beim
   Einkauf einer echten Einbuchung. Ist sie NULL, hat sich nichts bewegt — ohne Ausnahme.
4. **`return_movement_id` ist der Beleg einer echten Wiedereinlagerung** (`return`, +1).
5. **Eine Position ohne Katalogbezug darf ohne Lagerbewegung `settled` / „Erledigt" werden.**
   Porto, Zubehör, Sammelposten und Kartenpacks haben kein Regal; sie offen zu lassen wäre
   Arbeit, die niemand erledigen kann. Die Sperre liegt serverseitig: eine Position **mit**
   `sky_id` lässt sich auch per direktem RPC nicht auf `settled` setzen.
6. **Historische Positionen mit `legacy_stock_flag = '-'` werden nicht künstlich ausgebucht.**
   Das Arbeitsbuch sagt für sie: verschickt, aber nie dem Lager entnommen. Sie auszubuchen
   würde ein Stück vom Regal nehmen, das dieser Verkauf nie gehalten hat. Sie enden über
   „Erledigt" — und dasselbe Merkmal verbietet ihnen das Ausbuchen, sie haben also genau ein
   Ende.
7. **`not_shipped_at` ist ein Abschluss ohne Ausbuchung.** Das Stück hat das Regal nie
   verlassen; es nicht zu buchen ist die *richtige* Buchführung, nicht eine fehlende. Erlaubt
   nur, solange `movement_id` NULL ist — das Einzige, was die Aussage falsch machen würde.
8. **`return_announced_at` öffnet eine bereits ausgebuchte Position für den Retourenprozess
   wieder.** Sie gilt ab da nicht mehr als erledigt, obwohl eine Bewegung existiert: jemand
   muss die Ware noch entgegennehmen.
9. **`returned_at` heißt physisch zurückgekommen — nicht automatisch eingelagert.** Das
   Einlagern ist ein eigener Schritt mit eigenem Beleg (`return_movement_id`). Zwischen beiden
   liegt ein realer Zustand: die Figur liegt auf dem Tisch, nicht im Regal.
10. **Test- und Smoke-Daten bleiben über `is_test` vom echten Orderbuch getrennt.** Ein
    Testvorgang, der nicht markiert ist, wird zu Geschäftszahlen. Die Markierung ist die
    Trennung — nicht eine gesonderte Tabelle und nicht das Löschen.
11. **Der Inventory-Ledger ist append-only. Bestehende Bewegungen werden niemals zur
    kosmetischen Bereinigung gelöscht.** `inventory_movements` trägt `on delete restrict`. Was
    das Regal getan hat, bleibt stehen, auch wenn der zugehörige Vorgang sich später als Test
    herausstellt; korrigiert wird durch eine **neue** Bewegung oder durch ein Flag am Vorgang,
    nie durch Entfernen der Historie.

### Konsequenzen

**Der Status wird abgeleitet, nie gespeichert.** `sale_item_is_closed(public.sale_items)` ist
das eine Prädikat hinter `is_open` und `closed_count`; ein zweiter Ort, an dem „fertig"
definiert wird, kann nicht entstehen. Vier Enden zählen als fertig — ausgebucht und noch weg,
wieder eingelagert, ohne Bewegung geschlossen, nie verschickt —, eine angekündigte oder
eingetroffene Retoure ausdrücklich nicht.

**Die Freigabe historischer Verkäufe ist namentlich und einmalig.** `stock_released_at` wird
pro Bestellung von Hand erteilt, nachdem der Betreiber bestätigt hat, was tatsächlich passiert
ist. Sie wird nirgends abgeleitet; die 270 nicht freigegebenen Arbeitsbuch-Verkäufe bleiben
gesperrt wie zuvor.

**Provenienz ist keine Erlaubnis, die man sich ausstellen kann.** `legacy_stock_flag` schreibt
der Import und sonst nichts — es gibt keinen RPC, der es setzt. Genau deshalb taugt es als
Bedingung für eine Ausnahme: ein von Hand angelegter Verkauf trägt dort NULL und kann die
Ausnahme nicht erreichen.

**Keine der zehn Migrationen erzeugt eine Bewegung.** Drei ändern überhaupt Daten (`0067`,
`0071`, `0076`), alle drei mit einem Vorher/Nachher-Wächter auf Bestandssumme und
Bewegungszahl, der den Block zurückrollt, sobald sich eine der beiden bewegt. Nachgewiesen auf
Production: 1 201 Stück und 628 Bewegungen vor und nach dem Rollout, Postcheck 50/50.

### Verworfen

Den Status aus dem Vorhandensein einer Bewegung allein ableiten (das war `0072` und zählte eine
zurückgekommene Figur als erledigt — der Fehler, den `0075` behebt) · `settled` für beliebige
Positionen öffnen (dann wäre es ein stiller Weg, Bestand verschwinden zu lassen) ·
`not_shipped_at` als Grund in `settled_at` unterbringen (hätte die strenge Sperre für einen
Fall aufweichen müssen, der sie nicht braucht) · die zwei Smoke-Verkäufe löschen (würde echte
Bewegungen verwaisen lassen oder am `on delete restrict` scheitern) · `returned_at` das
Einlagern miterledigen lassen (verwischt genau die Grenze, die dieser ADR zieht).
