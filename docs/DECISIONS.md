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

Letzte Aktualisierung: 2026-09-03 (V1.2B Pre-Flight-Review).

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

**Offen:** Werkzeug für Unit-Tests (Vitest ist der naheliegende Kandidat) — wird bei der ersten
zu testenden Geschäftslogik festgelegt, nicht vorher.

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

**Offen:** Darf ein Benutzername später geändert werden? Wenn ja, braucht es eine Sperrfrist und
eine Historie, damit alte Profil-Links nachvollziehbar bleiben.

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

