# Datenbankmodell (PostgreSQL / Supabase)

Stand: 2026-09-03 — **Vorschlag. Noch nichts angelegt, kein SQL ausgeführt.**
Das SQL unten ist der Entwurf für die erste Migration und muss vor der Ausführung freigegeben
werden. Jede Schemaänderung wird als nummerierte Datei unter `supabase/migrations/` versioniert.

---

## 1. Leitgedanken

1. **Eine Figur existiert genau einmal.** Benutzer erzeugen keine eigenen Kopien, sie
   referenzieren die zentrale Figur über ihre SKY-ID.
2. **Die SKY-ID ist die dauerhafte Identität** (`docs/SKYLANDERS_DATA.md`, Abschnitt 1).
   Sie wird nie abgeleitet, nie wiederverwendet, nie automatisch geändert.
3. **Kein redundanter Preis in Benutzerdaten.** Der Sammlungswert wird bei jeder Abfrage aus
   dem aktuellen zentralen Marktpreis berechnet.
4. **Nur veröffentlichungsfähige Katalogdaten in der Datenbank.** Lagerzahlen, Ankauffaktor,
   Käuferdaten und Preis-Mappings kommen gar nicht erst hinein.
5. **RLS ist die Sicherheitsgrenze**, nicht das Frontend. Jede Tabelle bekommt RLS und
   ausdrückliche Policies.
6. **So wenige Tabellen wie möglich** — aber die Reihenfolge der Kategorien aus der Excel ist
   fachlich bedeutsam und bekommt deshalb eine eigene, kleine Tabelle.
7. **Alle Tabellen-, Spalten- und Constraint-Namen sind englisch** (ADR-0019). Deutsch kommt
   ausschließlich in benutzersichtbaren Texten vor, nie im Schema.

---

## 2. Tabellenübersicht (V1)

| Tabelle | Zeilen (erwartet) | Zweck | Zugriff |
|---|---:|---|---|
| `auth.users` | — | Supabase Auth, verwaltet von Supabase | nie direkt schreiben |
| `series` | 6 | Serien inkl. Anzeigereihenfolge | öffentlich lesbar |
| `categories` | 30 | Kategorien je Serie inkl. Reihenfolge | öffentlich lesbar |
| `skylanders` | 600 | kanonischer Katalog | öffentlich lesbar |
| `profiles` | = Benutzer | Benutzername, Profil | öffentlich lesbar, selbst schreibbar |
| `collection_items` | wächst | Sammlung: Benutzer × Figur × Menge | nur der Eigentümer |

Bewusst **nicht** in V1: `wanted`, `for_sale`, `for_trade`, `listings`, `trades`, `orders`,
`price_history`, `inventory`. Siehe Abschnitt 7 zur Erweiterbarkeit.

---

## 3. Entwurf

### 3.1 `series`

```sql
create table public.series (
  code        text primary key,                     -- 'SA','G','SF','T','SC','I'
  label       text not null,                        -- "Spyro's Adventure"
  release_year smallint not null,
  position    smallint not null unique,             -- Reihenfolge der Tabs (0..5)
  created_at  timestamptz not null default now()
);
```

Der Serien-Code ist bereits im Legacy-System stabil und wird überall verwendet (Mapping-
Schlüssel, Excel-Sheetname, Export). Deshalb natürlicher Schlüssel statt Surrogat.

### 3.2 `categories`

```sql
create table public.categories (
  id          bigint generated always as identity primary key,
  series_code text not null references public.series(code) on update cascade,
  position    smallint not null,                    -- entspricht categoryIndex aus dem Export
  name        text not null,                        -- exakt der Name aus etl/categories.py
  created_at  timestamptz not null default now(),
  unique (series_code, position),
  unique (series_code, name)
);
```

**Warum eine eigene Tabelle:** Die Reihenfolge der Kategorien stammt aus der Blockreihenfolge
der Excel und ist eine bewusste fachliche Entscheidung des Nutzers. Als Tabelle ist sie
explizit, filterbar und ohne Code-Änderung pflegbar. Kategorienamen werden **nie** automatisch
umbenannt oder vereinheitlicht.

### 3.3 `skylanders` — die kanonische Figur

```sql
create table public.skylanders (
  sky_id        text primary key
                check (sky_id ~ '^SKY-[0-9]{4}$'),  -- Identität, siehe SKYLANDERS_DATA.md
  name          text not null,                      -- roh aus Spalte B, nie normalisiert
  slug          text not null unique,               -- einmalig erzeugt, danach stabil
  series_code   text not null references public.series(code) on update cascade,
  category_id   bigint not null references public.categories(id),
  market_price  numeric(10,2),                      -- NULL erlaubt: 15 Artikel ohne Preis
  price_updated_at timestamptz,
  image_file    text,                               -- '<sha256[:16]>.webp', NULL erlaubt
  is_active     boolean not null default true,      -- statt Löschen
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index on public.skylanders (series_code, category_id);
create index on public.skylanders (is_active);
```

Feldbegründungen:

| Feld | Warum so |
|---|---|
| `sky_id` als PK | Die Identität ist per Projektregel unveränderlich — das ist genau der Fall, in dem ein natürlicher Schlüssel richtig ist. Er macht jede Zeile, jedes Log und jede Fremdschlüsselbeziehung ohne Join lesbar. **OPEN**, siehe ADR-0002. |
| `name` roh | Legacy-Regel: kein `strip()`, keine Korrektur, keine Übersetzung. |
| `slug` gespeichert | **Entschieden (ADR-0011).** Der Slug dient ausschließlich Navigation und Darstellung (`/skylanders/drobot`); **keine Datenbeziehung hängt vom Slug ab**. Er wird einmalig beim Import erzeugt und danach gespeichert, nicht bei jedem Import neu abgeleitet. Namen sind global nicht eindeutig (32 Mehrfachnamen) — bei Kollision wird deterministisch qualifiziert (`bash-giants`, notfalls mit SKY-ID). |
| `category_id` statt Text | Erzwingt gültige Kategorien und liefert die Reihenfolge mit. |
| `market_price` `numeric(10,2)`, **nullbar** | **Entschieden (ADR-0010).** Niemals `float` für Geld. `NULL` heißt ausdrücklich „derzeit kein Marktpreis bekannt" — **niemals 0 als Ersatz**, sonst wäre „geschenkt" von „unbekannt" nicht unterscheidbar und jede Wertsumme stillschweigend falsch. 15 der 600 Artikel haben keinen Preis; sie werden im Sammlungswert gesondert ausgewiesen. Keine `price_history`-Tabelle in V1. |
| `image_file` | Nur der content-adressierte Dateiname, keine URL. Mehrere Figuren dürfen dieselbe Datei referenzieren (n:1, im Legacy 44 Dateien für 103 öffentliche Artikel). |
| `is_active` | Der Import löscht nie. Benutzersammlungen zeigen auf diese Zeilen. |

**Nicht enthalten und nicht vorgesehen:** Lagerbestand, `available`, Ankaufpreis, eBay-Daten,
externe Titel, Mapping-Informationen. `available` beschreibt den eigenen Legacy-Lagerbestand
und gehört nicht zum kanonischen PortalVault-Modell — eine Figur existiert hier unabhängig
davon, ob sie im persönlichen Lager verfügbar ist (ADR-0008).

### 3.4 `profiles`

```sql
create extension if not exists citext;

create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    citext unique
              check (username is null or username ~ '^[a-zA-Z0-9_]{3,20}$'),
  display_name text,
  avatar_url  text,
  country     text,                                  -- ISO-3166-1 alpha-2, optional
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
```

- `id` **ist** die Supabase-User-ID (1:1, kein zweiter Schlüssel, keine Synchronisation nötig).
- `citext` macht Benutzernamen case-insensitive eindeutig (`Julian` und `julian` kollidieren).
- `username` ist zunächst `NULL` und wird beim Onboarding gesetzt — so kann die Anlage per
  Trigger nie an einem Namenskonflikt scheitern (siehe `docs/AUTH.md`).
- **Reservierte Systemnamen** werden von Anfang an abgelehnt: `admin`, `api`, `support`,
  `portalvault` und weitere technisch kritische Namen (ADR-0016). Die Liste darf bei der
  Implementierung sinnvoll ergänzt werden; sie wird an einer Stelle im Code gepflegt und
  zusätzlich per Datenbank-Constraint durchgesetzt.
- **Keine E-Mail-Adresse in `profiles`.** Die liegt in `auth.users` und ist nicht öffentlich.

### 3.5 `collection_items`

```sql
create table public.collection_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  sky_id     text not null references public.skylanders(sky_id) on update cascade,
  quantity   integer not null default 1 check (quantity > 0),
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- V1: genau eine Zeile je Benutzer und Figur.
create unique index collection_items_user_sky_uniq
  on public.collection_items (user_id, sky_id);

create index on public.collection_items (user_id);
create index on public.collection_items (sky_id);
```

**Die wichtigste Modellierungsentscheidung — angenommen (ADR-0005).** V1 behandelt einen
Skylander je Benutzer als **einen aggregierten Sammlungsdatensatz**. Später soll ein Benutzer mit
3× SKY-0148 ein Exemplar behalten, eines verkaufen, eines tauschen (`keep` / `sell` / `trade`) —
das wird **jetzt nicht** umgesetzt, darf aber nicht verbaut werden.

Warum Surrogatschlüssel **plus** Unique-Constraint statt `primary key (user_id, sky_id)`:

- In V1 verhält sich die Tabelle exakt wie ein zusammengesetzter Schlüssel — eine Zeile je
  Benutzer und Figur, `quantity` deckt Mehrfachbesitz ab.
- Sollen später einzelne Exemplare unterschiedliche Eigenschaften haben (Zustand, OVP,
  „behalten/verkaufen/tauschen"), wird der Unique-Index **gelöscht** und eine Spalte ergänzt —
  aus einer Zeile werden mehrere „Posten" derselben Figur. Das ist eine additive,
  nicht-destruktive Migration; Primär- und Fremdschlüssel bleiben unverändert.
- Mit `primary key (user_id, sky_id)` wäre derselbe Schritt ein Umbau aller Schlüssel.

Die Erweiterung ist damit möglich, ohne heute Marketplace-Komplexität zu bauen.
`quantity > 0` — „besitzt nicht" bedeutet: keine Zeile. Ein Nullwert wird nie gespeichert.

### 3.6 Abgeleitete Werte — immer berechnet, nie gespeichert

```sql
-- Sammlungswert und Kennzahlen eines Benutzers
select
  count(*)                                                   as distinct_figures,
  coalesce(sum(ci.quantity), 0)                              as total_figures,
  coalesce(sum(ci.quantity * s.market_price)
           filter (where s.market_price is not null), 0)     as estimated_value,
  count(*) filter (where s.market_price is null)             as without_price
from public.collection_items ci
join public.skylanders s using (sky_id)
where ci.user_id = auth.uid();
```

```sql
-- Fortschritt je Serie
select s.series_code,
       count(distinct ci.sky_id)                              as owned,
       (select count(*) from public.skylanders x
         where x.series_code = s.series_code and x.is_active) as total
from public.skylanders s
left join public.collection_items ci
       on ci.sky_id = s.sky_id and ci.user_id = auth.uid()
where s.is_active
group by s.series_code;
```

Ändert sich ein zentraler Marktpreis, ändert sich der angezeigte Sammlungswert automatisch —
es gibt keine zweite Preiskopie, die synchron gehalten werden müsste.
**OPEN:** Ob Artikel ohne Preis mit 0 in die Summe eingehen (Legacy-Verhalten) oder gesondert
ausgewiesen werden — Legacy weist sie gesondert aus; das übernehmen wir.

---

## 4. Beziehungen

```
auth.users ──1:1──▶ profiles
     │
     └──1:n──▶ collection_items ──n:1──▶ skylanders ──n:1──▶ categories ──n:1──▶ series
                                                     └──n:1──▶ series
```

- `collection_items.user_id → auth.users(id) ON DELETE CASCADE`: löscht ein Benutzer sein Konto,
  verschwindet seine Sammlung. Der Katalog bleibt unberührt.
- `collection_items.sky_id → skylanders(sky_id)`: **kein** `ON DELETE CASCADE`. Ein Katalog-
  eintrag darf nicht gelöscht werden, solange Benutzer ihn referenzieren — deshalb `is_active`.

---

## 5. Row Level Security (Kurzfassung)

Vollständig in `docs/SECURITY.md`.

| Tabelle | SELECT | INSERT / UPDATE / DELETE |
|---|---|---|
| `series`, `categories`, `skylanders` | `true` (anon + authenticated) | **keine Policy** → nur Service Role (Import). Normale Benutzer können Katalogdaten nie ändern. |
| `profiles` | `auth.uid() = id` — **privat in V1** | `auth.uid() = id`, INSERT über Trigger |
| `collection_items` | `auth.uid() = user_id` — **privat in V1** | `auth.uid() = user_id` (mit `WITH CHECK`) |

**Entschieden (ADR-0016):** Profile und Sammlungen sind in V1 **privat** — ein Benutzer liest
und ändert ausschließlich seine eigenen. Es gibt **keine öffentlichen Benutzerprofile** in V1.
Katalogdaten sind öffentlich lesbar und für normale Benutzer niemals änderbar.

RLS wird auf **jeder** Tabelle aktiviert. Eine Tabelle ohne Policy ist damit für Clients
vollständig gesperrt — das ist der sichere Ausgangszustand.

---

## 6. Migrationen und Import

- SQL-Dateien unter `supabase/migrations/`, aufsteigend nummeriert, **additiv**.
- Kein `DROP`, kein destruktives `ALTER` ohne ausdrückliche Freigabe des Nutzers.
- Der Import (`tools/import-catalog.ts`) läuft lokal mit Service-Role-Key, macht zuerst einen
  **Dry-Run** und schreibt in **einer Transaktion**. Regeln vollständig in
  `docs/SKYLANDERS_DATA.md`, Abschnitt 12.
- Nach jedem Import: Anzahl prüfen, keine doppelte SKY-ID, kein interner Namenssuffix,
  nur öffentliche Serien, alle Bildreferenzen auflösbar. Fehlschlag → Rollback.

---

## 7. Vorbereitung auf spätere Erweiterungen

Diese Tabellen werden **jetzt nicht angelegt**. Sie sind hier nur dokumentiert, damit heutige
Entscheidungen sie nicht verbauen:

| Später | Wie es andockt | Was heute schon passt |
|---|---|---|
| `wishlist_items` | `(user_id, sky_id, priority)` | referenziert dieselbe `skylanders`-Tabelle |
| `listings` (Verkauf) | `(id, user_id, sky_id, quantity, price, status)` | eigene Tabelle, `collection_items` bleibt unverändert |
| Zustand je Exemplar | Unique-Index auf `collection_items` löschen, Spalte ergänzen | Surrogat-PK existiert bereits |
| `price_history` | `(sky_id, price, source, valid_from)`; `skylanders.market_price` wird zum Cache des jüngsten Werts | Preis wird schon heute nur an einer Stelle gelesen |
| öffentliche Profile / Sammlungen | Flags `profiles.is_public` / `profiles.collection_public`, erweiterte SELECT-Policy | Sammlung liegt bereits in der DB, nicht im Browser; restriktiver Start lässt sich öffnen |
| Zustände `keep` / `sell` / `trade` | Spalte auf `collection_items`, Unique-Constraint entfernen | Surrogat-PK und Fremdschlüssel bleiben unverändert |
| mehrere Bilder je Figur | `skylander_images (sky_id, file, position)`; `image_file` wird zum Primärbild | Bildidentität ist der Dateiname, nicht die URL |

---

## 8. Entschieden und offen

**Alle Schemaentscheidungen für V1 stehen (2026-09-03):**
`sky_id` als Primärschlüssel (ADR-0002) · Sammlungsmodell mit Surrogat-PK und
Unique-Constraint auf `(user_id, sky_id)` (ADR-0005) · `market_price numeric(10,2)`, nullbar,
kein Preisverlauf (ADR-0010) · Profile und Sammlungen privat, Katalog öffentlich lesbar und für
Benutzer nicht änderbar (ADR-0016) · gespeicherter Slug ohne Datenbeziehung (ADR-0011) ·
englische Tabellen- und Spaltennamen (ADR-0019) · Kategorie- und Seriennamen bleiben in der
Datenbank, damit eine Übersetzungsspalte später additiv ergänzt werden kann (ADR-0012) ·
EU-Region (ADR-0015).

**Damit ist die erste Migration schreibbereit.**

**Noch offen — blockiert die Migration nicht:**

- **OPEN:** Darf ein Benutzername später geändert werden? (dann Sperrfrist und Historie nötig)
- **OPEN:** Genaue Slug-Kollisionsregel — wird beim Importwerkzeug (V1.3) festgelegt.
