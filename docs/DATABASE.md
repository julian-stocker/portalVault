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
| `characters` | 19 (Pilot) | kuratierte Charaktermetadaten | öffentlich lesbar, nur kuratiert schreibbar |

Bewusst **nicht** in V1: `wanted`, `for_sale`, `for_trade`, `listings`, `trades`, `orders`,
`price_history`, `inventory`. Siehe Abschnitt 7 zur Erweiterbarkeit.

---

## 3. Umsetzung

**Implementiert in `supabase/migrations/0001_initial_schema.sql`.**
Am 2026-09-03 im Supabase-SQL-Editor **erfolgreich ausgeführt** und anschließend mit rein
lesenden Abfragen **strukturell verifiziert** (siehe `PROJECT_STATUS.md`). Die Migration ist
die maßgebliche Quelle; dieser Abschnitt erklärt sie. Weichen beide voneinander ab, gilt das
SQL — und der Widerspruch ist zu melden.

### 3.0 `characters` — der Charakter hinter der Figur (Migration 0002)

**Ein Charakter ist kein Sammelobjekt.** „Drobot" ist ein Charakter; SKY-0028, SKY-0156 und
SKY-0157 sind drei Sammelobjekte davon, mit Marktpreisen zwischen 1,49 € und 104,71 €.
Drei Identitäten bleiben getrennt (ADR-0034):

| Konzept | Träger | Wer hängt daran |
|---|---|---|
| Sammelobjekt | `sky_id` | Sammlung, späterer Shop, Preis, Bild, Slug |
| Charakter | `characters.id` über `skylanders.character_id` | Element, Spezies, Rolle, Beschreibung |
| Anzeigevariante | abgeleitet, nichts gespeichert | nur die Darstellung (ADR-0030) |

**Spalten:** `id` (Surrogat, `bigint generated always as identity`) · `canonical_name`
(Attribut, **nie** Schlüssel) · `element` · `species` · `role_type` · `short_description` ·
`source_url` · `source_label` · `verified_at` · `created_at` · `updated_at`.

**Constraints:**

| Constraint | Wirkung |
|---|---|
| `characters_name_not_blank` | leerer Name unmöglich |
| `characters_canonical_name_key` | Unique-**Index** auf `lower(canonical_name)`, case-insensitiv — Duplikatschutz, kein Schlüssel (Muster aus ADR-0020) |
| `characters_element_known` | nur `Magic Tech Water Fire Life Undead Earth Air Light Dark` |
| `characters_role_known` | nur `core giant swapper trap-master supercharger sensei mini sidekick` |
| `characters_description_short` | `≤ 600` Zeichen — erzwingt die eigene Kurzfassung strukturell statt per Richtlinie |
| `characters_source_url_https` | eine Quellenangabe, die nicht abrufbar ist, ist keine |

**`element`, `species` und `role_type` sind nullbar. `NULL` heißt „nicht zuverlässig bekannt",
nie „keins"** — dieselbe Regel wie beim Marktpreis (ADR-0010). Kaos ist der Musterfall: Als
Sensei gehört er einem eigenen Kaos-Element an, das nicht zu den zehn zählt.

**`skylanders.character_id`** — `bigint`, nullbar, `references characters (id) on delete
restrict`, Teilindex `where character_id is not null`.

> **`character_id = NULL` ist der Normalfall.** 159 der 561 Sammelobjekte sind gar keine
> Charaktere (Traps, Fahrzeuge, Kreationskristalle, Magic Items, Locations, Trophies), und von
> den übrigen ist bisher nur der kuratierte Pilot zugeordnet. Ein Kreationskristall ist kein
> Charakter mit fehlenden Feldern.

**Gepflegt wird ausschließlich über `data/characters/characters.json` und
`tools/import-characters.mts`** — nie über den Katalogimport, der `character_id` gar nicht
kennt, und nie aus Namen abgeleitet.

### 3.1 `series`

| Spalte | Typ | Regel |
|---|---|---|
| `code` | `text` **PK** | `^[A-Z]{1,4}$` — `SA`, `G`, `SF`, `T`, `SC`, `I` |
| `label` | `text not null` | nicht leer; exakt wie gepflegt, nie normalisiert |
| `release_year` | `smallint not null` | 1990–2100 |
| `position` | `smallint not null unique` | deterministische Anzeigereihenfolge, `>= 0` |
| `created_at` | `timestamptz not null default now()` | |

Der Serien-Code ist im Legacy-System bereits stabil (Sheetname, Mapping-Schlüssel, Export) —
deshalb natürlicher Schlüssel statt Surrogat. `position` ist in PostgreSQL ein
*non-reserved keyword* und als Spaltenname unproblematisch.

### 3.2 `categories`

| Spalte | Typ | Regel |
|---|---|---|
| `id` | `bigint generated always as identity` **PK** | |
| `series_code` | `text not null` | FK → `series(code)`, `on update cascade on delete restrict` |
| `position` | `smallint not null` | entspricht `categoryIndex` im Legacy-Export, `>= 0` |
| `name` | `text not null` | nicht leer; **nie** automatisch umbenannt oder vereinheitlicht |
| `created_at` | `timestamptz not null default now()` | |

Unique: `(series_code, position)` · `(series_code, name)` · `(id, series_code)`.

Der dritte Unique-Constraint ist für die Eindeutigkeit redundant (`id` ist bereits PK), aber
syntaktisch nötig: er ist das Ziel des zusammengesetzten Fremdschlüssels von `skylanders`.

### 3.3 `skylanders` — die kanonische Figur

| Spalte | Typ | Regel |
|---|---|---|
| `sky_id` | `text` **PK** | `^SKY-[0-9]{4}$` — identisch zur Legacy-Validierung |
| `name` | `text not null` | nicht leer; roh übernommen, kein `strip()`, keine Korrektur |
| `slug` | `text not null unique` | `^[a-z0-9]+(-[a-z0-9]+)*$`; nur Navigation |
| `series_code` | `text not null` | Teil des zusammengesetzten FK (siehe unten) |
| `category_id` | `bigint not null` | Teil des zusammengesetzten FK |
| `market_price` | `numeric(10,2)` **nullbar** | `null` **oder** `> 0` |
| `price_updated_at` | `timestamptz` | nur gesetzt, wenn ein Preis existiert |
| `image_file` | `text` | `^[0-9a-f]{16}\.webp$`, nur Dateiname, nie URL |
| `is_active` | `boolean not null default true` | statt Löschen |
| `created_at` / `updated_at` | `timestamptz not null default now()` | `updated_at` per Trigger |

Indizes: `(series_code, category_id)` · `(is_active)` · unique `(slug)`.

**Feldbegründungen**

| Feld | Warum so |
|---|---|
| `sky_id` als PK | **ADR-0002.** Die Identität ist per Projektregel unveränderlich — genau der Fall für einen natürlichen Schlüssel. Kein UUID-Surrogat; andere Entitäten verwenden UUIDs. |
| Format `^SKY-[0-9]{4}$` | **Bestätigt für V1.** Identisch zu `etl/articles.py::ID_PATTERN`. Alle 820 bestehenden IDs erfüllen es. Das Format wird **nicht vorsorglich** erweitert. Sollte der Legacy-ID-Raum je überschritten werden, ist das eine bewusste gemeinsame Migration von Legacy-Projekt **und** PortalVault — keine stille Lockerung des Constraints. |
| `name` roh | Legacy-Regel: keine Normalisierung, keine Übersetzung. |
| `slug` gespeichert | **ADR-0011, vollständig.** Nur Navigation und Darstellung. **Kein Fremdschlüssel referenziert den Slug** — statisch geprüft. Einmalig beim Import erzeugt, danach stabil; bestehende Slugs werden nie neu berechnet. Kollisionsregel: Name → bei Konflikt Serien-Slug aus dem **Label** (`drobot-giants`) → notfalls SKY-ID. An den echten 600 Artikeln geprüft: Stufe 2 löst alle 32 Kollisionen, Stufe 3 feuert nie. |
| `market_price` `> 0` statt `>= 0` | **ADR-0010** verlangt, dass 0 nie für „unbekannt" steht. Der Constraint setzt das durch und schließt Negativwerte mit ein. Der Legacy-Export bildet einen 0-Preis ohnehin bereits auf `null` ab, ein gültiger Import löst den Constraint also nie aus — tut er es doch, sind die Daten falsch und der Import muss abbrechen. |
| `price_updated_at` | Constraint: nur setzbar, wenn `market_price` nicht `null` ist. Ein Preiszeitstempel ohne Preis wäre bedeutungslos. |
| `image_file` | Content-adressierter Dateiname (`<sha256[:16]>.webp`), n:1 teilbar. Nie eine URL — der Speicherort bleibt austauschbar (ADR-0009). |
| `is_active` | Der Import löscht nie; Benutzersammlungen zeigen auf diese Zeilen. |

**Zusammengesetzter Fremdschlüssel statt zweier einzelner:**

```sql
foreign key (category_id, series_code)
  references public.categories (id, series_code)
```

`series_code` steht auf der Zeile, weil fast jede Katalogabfrage danach filtert — das ist eine
bewusste Denormalisierung. Der zusammengesetzte FK verhindert die Kehrseite davon: eine Figur
der Serie `SA` kann keine Kategorie der Serie `G` referenzieren. Ein separater FK auf
`series(code)` wäre dadurch redundant und entfällt; die Gültigkeit des Serien-Codes ergibt sich
transitiv über `categories`.

> **Folge für PostgREST, beim Bau von V1.5 aufgefallen.** Weil es **keinen direkten
> Fremdschlüssel** von `skylanders` auf `series` gibt, kann PostgREST auch keine Beziehung
> zwischen beiden ableiten. Ein eingebetteter Select `skylanders(..., series(label))` scheitert
> mit *„Could not find a relationship between 'skylanders' and 'series' in the schema cache"*.
> Die Anwendung lädt Serien und Kategorien deshalb als eigene kleine Abfragen (6 und 30 Zeilen)
> und verknüpft sie im Code. Das ist kein Mangel des Schemas, sondern der Preis der bewussten
> Entscheidung oben — und bei dieser Datenmenge kostenlos.

**Nicht enthalten und nicht vorgesehen:** Lagerbestand, `available`, Ankaufpreis, eBay-Daten,
externe Titel, Mapping-Informationen (ADR-0008). Statisch geprüft: keine dieser Spalten
existiert.

### 3.4 `profiles` — 1:1 zu `auth.users`

| Spalte | Typ | Regel |
|---|---|---|
| `id` | `uuid` **PK** | FK → `auth.users(id)`, `on delete cascade` |
| `username` | `text` nullbar | `^[a-zA-Z0-9_]{3,20}$`, nicht reserviert, case-insensitiv eindeutig |
| `display_name`, `avatar_url` | `text` | optional |
| `country` | `text` | `^[A-Z]{2}$` (ISO 3166-1 alpha-2), optional |
| `created_at` / `updated_at` | `timestamptz not null default now()` | `updated_at` per Trigger |

- `id` **ist** die Supabase-User-ID — kein zweiter Schlüssel, keine Synchronisation.
- `username` ist zunächst `NULL` und wird beim Onboarding gesetzt, damit die Profilanlage per
  Trigger nie an einem Namenskonflikt scheitern kann.
- **Case-insensitive Eindeutigkeit ohne `citext`** (ADR-0020):

  ```sql
  create unique index profiles_username_lower_uniq
    on public.profiles (lower(username))
    where username is not null;
  ```

  Die getippte Schreibweise bleibt für die Anzeige erhalten, `Julian` und `julian` kollidieren.
  **Konvention:** jede Abfrage muss `lower(username) = lower($1)` verwenden, sonst greift der
  Index nicht.
- **Reservierte Systemnamen** werden per CHECK-Constraint abgelehnt (case-insensitiv), aktuell
  58 Namen: `admin`, `api`, `auth`, `support`, `portalvault`, `skylanders`, `collection`,
  `profile`, `settings`, `impressum`, `datenschutz` und weitere. Die Liste zu erweitern
  erfordert eine neue Migration — das ist beabsichtigt: einen Namen zu sperren ist eine
  bewusste Entscheidung, keine Nebenwirkung. Zwei Einträge (`me`, `no-reply`) sind durch den
  Format-Constraint ohnehin unerreichbar und bleiben nur als Absicherung stehen, falls das
  erlaubte Zeichenformat je erweitert wird.
- **Keine E-Mail-Adresse in `profiles`.** Sie liegt in `auth.users`.

### 3.5 `collection_items`

| Spalte | Typ | Regel |
|---|---|---|
| `id` | `uuid` **PK** `default gen_random_uuid()` | Surrogat (ADR-0005) |
| `user_id` | `uuid not null` | FK → `auth.users(id)`, `on delete cascade` |
| `sky_id` | `text not null` | FK → `skylanders(sky_id)`, `on delete restrict`, `on update restrict` |
| `quantity` | `integer not null default 1` | `> 0` und `<= 10000` |
| `note` | `text` | höchstens 500 Zeichen |
| `created_at` / `updated_at` | `timestamptz not null default now()` | `updated_at` per Trigger |

Unique: `(user_id, sky_id)`. Index zusätzlich auf `(sky_id)`.

Ein separater Index auf `(user_id)` entfällt: der Unique-Index `(user_id, sky_id)` hat
`user_id` bereits als führende Spalte und deckt diese Abfragen ab.

**Modellierung (ADR-0005).** V1 speichert **eine aggregierte Zeile je Benutzer und Figur**;
`quantity` deckt Mehrfachbesitz ab. Sollen später einzelne Exemplare eigene Zustände bekommen
(`keep` / `sell` / `trade`), wird der Unique-Constraint entfernt und eine Spalte ergänzt — aus
einer Zeile werden mehrere Posten derselben Figur. Additive Migration, kein Schlüsselumbau.
Mit `primary key (user_id, sky_id)` wäre derselbe Schritt ein Umbau aller Schlüssel.

`quantity > 0`: „besitzt nicht" bedeutet **keine Zeile**. Ein Nullwert wird nie gespeichert.

**`quantity <= 10000` ist eine technische Schutzgrenze, keine fachliche Aussage.**
Die Unterscheidung ist wichtig genug, um sie festzuhalten:

| | |
|---|---|
| **Was der Constraint ist** | Eine Plausibilitätsbremse gegen fehlerhafte Clients, versehentliche Massenschreibvorgänge und offensichtlich unsinnige Werte. Sie schützt Datenbank und Wertberechnung vor Unfug. |
| **Was er *nicht* ist** | Keine Definition eines maximal erlaubten Besitzes. PortalVault legt nicht fest, wie viele Exemplare einer Figur ein Sammler besitzen darf. Die Zahl ist bewusst so hoch gewählt, dass sie keine reale Sammlung begrenzt. |

Stößt jemals eine echte Sammlung an diese Grenze, wird der Wert angehoben — das ist eine
Betriebsentscheidung, keine Änderung des Datenmodells.

### 3.6 `ON DELETE` / `ON UPDATE` — bewusste Entscheidungen

| Fremdschlüssel | ON DELETE | ON UPDATE | Warum |
|---|---|---|---|
| `profiles.id → auth.users.id` | `cascade` | – | Konto gelöscht → Profil verschwindet. DSGVO-konform, keine Waisen. |
| `collection_items.user_id → auth.users.id` | `cascade` | `cascade` | Konto gelöscht → Sammlung verschwindet mit. |
| `collection_items.sky_id → skylanders.sky_id` | **`restrict`** | **`restrict`** | Ein Katalogeintrag darf nicht unter einer Sammlung wegbrechen. `restrict` lässt ein versehentliches Löschen **laut scheitern**, statt still Benutzerdaten mitzunehmen. Der Import löscht ohnehin nie, sondern setzt `is_active = false`. `on update restrict` statt `cascade`: eine SKY-ID ändert sich nie — ein Änderungsversuch soll fehlschlagen, nicht stillschweigend durch alle Sammlungen propagieren. |
| `categories.series_code → series.code` | `restrict` | `cascade` | Eine Serie mit Kategorien ist nicht löschbar. Der Serien-Code ist Präsentationsmetadatum, keine Identitätsverankerung wie die SKY-ID — eine Umbenennung darf daher propagieren. |
| `skylanders.(category_id, series_code) → categories.(id, series_code)` | `restrict` | `cascade` | Eine benutzte Kategorie ist nicht löschbar; Umbenennungen propagieren. |

### 3.7 Trigger

**Fünf Trigger insgesamt** — `skylanders` trägt zwei davon:

| Trigger | Tabelle | Zweck |
|---|---|---|
| `skylanders_set_updated_at` | `skylanders` | setzt `updated_at` bei jedem UPDATE |
| `profiles_set_updated_at` | `profiles` | dito |
| `collection_items_set_updated_at` | `collection_items` | dito |
| `skylanders_sky_id_immutable` | `skylanders` | verweigert jede Änderung von `sky_id` (ADR-0001), `before update of sky_id` |
| `on_auth_user_created` | `auth.users` | legt die 1:1-Profilzeile für neue Auth-Benutzer an |

Die drei `*_set_updated_at`-Trigger verwenden dieselbe Funktion `public.set_updated_at()`.
Sie ist **kein** `SECURITY DEFINER` — sie schreibt nur `NEW` und braucht keine erhöhten Rechte.

**Warum ein Trigger für die SKY-ID-Unveränderlichkeit.** RLS verhindert bereits, dass Clients
den Katalog schreiben — aber die Service Role umgeht RLS, und genau als Service Role läuft das
Importwerkzeug. **Trigger und Constraints werden nicht umgangen.** Das ist also die Schicht,
die die wichtigste Projektinvariante gegen ein fehlerhaftes Importskript schützt.

**Der Profil-Trigger (`handle_new_user`).** `SECURITY DEFINER` ist hier **notwendig**: der
INSERT in `auth.users` läuft als `supabase_auth_admin`, und diese Rolle hat keine Rechte auf
`public.profiles`. Härtung:

- `set search_path = ''` und vollständig qualifizierte Objektnamen — kein Schema im
  `search_path` eines Aufrufers kann etwas unterschieben.
- **Es wird ausschließlich `new.id` verwendet**, eine von Supabase Auth erzeugte UUID. Weder
  E-Mail noch `raw_user_meta_data` werden gelesen — **kein benutzerkontrollierter Wert
  gelangt in den privilegierten Kontext**. Der Benutzername wird später vom Benutzer selbst
  über ein RLS-geprüftes UPDATE gesetzt.
- `on conflict (id) do nothing` — die Registrierung scheitert nicht, wenn die Zeile schon existiert.
- `revoke all on function public.handle_new_user() from public, anon, authenticated` — die
  Funktion ist für Clients nicht aufrufbar.

### 3.8 Abgeleitete Werte — immer berechnet, nie gespeichert

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
es gibt keine zweite Preiskopie.
**Entschieden (ADR-0010):** Artikel ohne Preis gehen **nicht** mit 0 in die Summe ein, sondern
werden gesondert ausgewiesen — wie im Legacy-Frontend. `NULL` heißt „unbekannt", nie „wertlos".

---

### 3.9 Supabase-Kompatibilität — Ergebnis der ersten Ausführung

Pre-Flight-Review am 2026-09-03, Ausführung am selben Tag. **Beide vorhergesagten Risiken sind
nicht eingetreten**, dafür kam ein drittes, nicht vorhergesehenes Problem ans Licht.

**Risiko 1 — Rechte für `create trigger ... on auth.users`: nicht eingetreten.**
Die Rolle `postgres`, unter der der SQL-Editor läuft, durfte den Trigger anlegen.
`on_auth_user_created` existiert auf `auth.users` und ist verifiziert. Dasselbe gilt für die
beiden Fremdschlüssel auf `auth.users`, die das `REFERENCES`-Recht benötigen.

**Risiko 2 — Reihenfolge von `revoke` und `create trigger`: nicht eingetreten.**
Da der Trigger als `postgres` (Eigentümer der Funktion) angelegt wurde, spielte die
vorangehende `revoke`-Anweisung keine Rolle. Die Reihenfolge blieb unverändert.

**Neuer Befund — Supabase-Default-Privilegien (behoben).**
Supabase setzt `ALTER DEFAULT PRIVILEGES` auf das Schema `public`, sodass `anon`,
`authenticated` und `service_role` bei **jedem** `create table` automatisch `ALL` erhalten —
also auch `TRUNCATE`, `REFERENCES` und `TRIGGER`.

Die erste Fassung der Migration formulierte für `profiles` und `collection_items` nur
`grant select, insert, update …`. **`GRANT` ist additiv und entzieht nichts**, die
Default-Privilegien blieben also bestehen. Die Verifikation zeigte für
`profiles / authenticated` tatsächlich `DELETE, INSERT, REFERENCES, SELECT, TRIGGER,
TRUNCATE, UPDATE`.

Warum das mehr als kosmetisch ist: **Row Level Security gilt nicht für `TRUNCATE`.**
RLS-Policies greifen bei `SELECT`, `INSERT`, `UPDATE`, `DELETE` und `MERGE`; `TRUNCATE` ist
eine Operation auf Tabellenebene und wird ausschließlich über das Privileg kontrolliert. Ein
`truncate public.profiles` hätte alle Profile gelöscht, unabhängig von jeder Policy — und
keine der beiden Tabellen wird von einem Fremdschlüssel referenziert, der das verhindert hätte.

Über PostgREST war das nicht erreichbar (kein HTTP-Verb bildet auf `TRUNCATE` ab), also ein
latentes und kein akutes Risiko. Latent bleibt es aber nur, bis irgendwann eine
`SECURITY INVOKER`-RPC mit dynamischem SQL existiert.

**Behoben durch explizite `REVOKE`:**

```sql
grant select, insert, update on public.profiles to authenticated;
revoke delete, truncate, references, trigger
  on public.profiles from authenticated;

grant select, insert, update, delete on public.collection_items to authenticated;
revoke truncate, references, trigger
  on public.collection_items from authenticated;
```

Danach zurückgesetzt und neu ausgeführt; verifiziert ist jetzt genau:
`profiles / authenticated` → `INSERT, SELECT, UPDATE` · `collection_items / authenticated` →
`DELETE, INSERT, SELECT, UPDATE`.

**Die Lehre, die für jede künftige Migration gilt:**

> In Supabase genügt es nicht, die gewünschten Rechte zu **vergeben**. Jede neue Tabelle in
> `public` startet mit `ALL` für `anon`, `authenticated` und `service_role`. Alles Unerwünschte
> muss **ausdrücklich entzogen** werden — und `TRUNCATE` besonders, weil RLS es nicht abdeckt.

Für die Katalogtabellen und für `anon` war das von Anfang an richtig gelöst; genau deshalb
zeigten diese in der Verifikation sofort die beabsichtigten Rechte.

**Unauffällig geblieben:** `gen_random_uuid()` (Kern seit PG 13) · keine Extension nötig ·
`generated always as identity` · zusammengesetzter Fremdschlüssel · Statement-Reihenfolge ·
`search_path = ''` in allen drei Funktionen.

---

## 4. Beziehungen

```
auth.users ──1:1──▶ profiles
     │
     └──1:n──▶ collection_items ──n:1──▶ skylanders ──n:1──▶ categories ──n:1──▶ series
                                             │
                                             └──n:1──▶ characters   (nullbar)
```

**Sechs Fremdschlüssel insgesamt:**

| Fremdschlüssel | von → nach |
|---|---|
| `categories_series_fk` | `categories.series_code` → `series.code` |
| `skylanders_category_fk` | `skylanders (category_id, series_code)` → `categories (id, series_code)` — zusammengesetzt |
| `profiles_id_fkey` | `profiles.id` → `auth.users.id` (inline deklariert, daher der von PostgreSQL vergebene Name) |
| `collection_items_user_fk` | `collection_items.user_id` → `auth.users.id` |
| `collection_items_sky_fk` | `collection_items.sky_id` → `skylanders.sky_id` |
| `skylanders_character_id_fkey` | `skylanders.character_id` → `characters.id`, `on delete restrict`, **nullbar** (Migration 0002, inline deklariert) |

`skylanders` trägt `series_code` zusätzlich als Spalte (bewusste Denormalisierung für
Katalogabfragen); die Konsistenz zur Kategorie erzwingt der zusammengesetzte Fremdschlüssel
aus Abschnitt 3.3. `ON DELETE`/`ON UPDATE`-Verhalten: Abschnitt 3.6.

---

## 5. Row Level Security

Vollständige Begründung: `docs/SECURITY.md`. Umgesetzt in der Migration, Abschnitte 7 und 8.

**Zwei unabhängige Schichten.** Eine Operation ist nur erlaubt, wenn **sowohl** das
Tabellenrecht **als auch** eine RLS-Policy sie zulässt.

⚠️ **Wichtig, weil es beim ersten Anlauf schiefging:** Rechte zu *vergeben* genügt in Supabase
nicht. `ALTER DEFAULT PRIVILEGES` gibt `anon`, `authenticated` und `service_role` bei jedem
`create table` in `public` automatisch `ALL`, und `GRANT` ist additiv — es entzieht nichts.
Jedes unerwünschte Recht muss **ausdrücklich entzogen** werden. Details und Hergang:
Abschnitt 3.9.

**Verifizierter Ist-Zustand** (2026-09-03, gegen die laufende Datenbank gelesen):

| Tabelle | anon | authenticated | service_role | Policies |
|---|---|---|---|---|
| `series`, `categories`, `skylanders` | nur `SELECT` | nur `SELECT` | Schreibrechte (für den Import) | je eine SELECT-Policy `using (true)`; **keine** schreibende Policy existiert |
| `profiles` | **keine Rechte** | exakt `INSERT, SELECT, UPDATE` | — | SELECT/INSERT/UPDATE, alle gegen `auth.uid() = id` |
| `collection_items` | **keine Rechte** | exakt `DELETE, INSERT, SELECT, UPDATE` | — | alle vier gegen `auth.uid() = user_id` |

Kein `TRUNCATE`, kein `REFERENCES`, kein `TRIGGER` für `anon` oder `authenticated` — auf keiner
der fünf Tabellen.

**Sechste Tabelle, Migration 0002 (`characters`)** — dieselbe Haltung wie beim Katalog:

| Tabelle | anon | authenticated | Policies |
|---|---|---|---|
| `characters` | nur `SELECT` | nur `SELECT` | eine SELECT-Policy `using (true)`; **keine** schreibende Policy |

Geschrieben wird ausschließlich über die Service Role aus `tools/import-characters.mts`.
**Es wird keine Rolle eingeführt und `profiles` bleibt unberührt** — dort könnte sich ein
Benutzer eine Berechtigung selbst setzen (ADR-0032, `docs/AUTH.md` Abschnitt 6).

**Die zehn Policies im Einzelnen**

| Policy | Tabelle | Aktion | Rollen | Bedingung |
|---|---|---|---|---|
| `series_select_public` | `series` | SELECT | anon, authenticated | `true` |
| `categories_select_public` | `categories` | SELECT | anon, authenticated | `true` |
| `skylanders_select_public` | `skylanders` | SELECT | anon, authenticated | `true` |
| `profiles_select_own` | `profiles` | SELECT | authenticated | `USING (auth.uid() = id)` |
| `profiles_insert_own` | `profiles` | INSERT | authenticated | `WITH CHECK (auth.uid() = id)` |
| `profiles_update_own` | `profiles` | UPDATE | authenticated | `USING` **und** `WITH CHECK (auth.uid() = id)` |
| `collection_items_select_own` | `collection_items` | SELECT | authenticated | `USING (auth.uid() = user_id)` |
| `collection_items_insert_own` | `collection_items` | INSERT | authenticated | `WITH CHECK (auth.uid() = user_id)` |
| `collection_items_update_own` | `collection_items` | UPDATE | authenticated | `USING` **und** `WITH CHECK (auth.uid() = user_id)` |
| `collection_items_delete_own` | `collection_items` | DELETE | authenticated | `USING (auth.uid() = user_id)` |

**Warum `USING` und `WITH CHECK` bei jedem UPDATE.** `USING` bestimmt, welche Zeilen geändert
werden dürfen; `WITH CHECK`, was aus ihnen werden darf. Ohne `WITH CHECK` könnte ein Benutzer
seine eigene Zeile auf eine fremde `user_id` umschreiben und sie damit verschieben.

**Warum keine DELETE-Policy auf `profiles`.** Profile verschwinden mit dem Auth-Benutzer
(`on delete cascade`), nicht einzeln. Andernfalls entstünde ein Benutzer ohne Profil.

`auth.uid()` steht in allen Policies als `(select auth.uid())`. PostgreSQL wertet die
Unterabfrage dann einmal je Statement aus statt einmal je Zeile.

RLS ist auf **allen fünf** Tabellen aktiviert (`rowsecurity = true`, `forced = false`,
verifiziert). Eine Tabelle mit RLS und ohne passende Policy verweigert den Zugriff — das ist
der sichere Ausgangszustand, auf den wir uns stützen.

**Eine Grenze, die RLS nicht zieht:** `TRUNCATE`. Policies greifen bei `SELECT`, `INSERT`,
`UPDATE`, `DELETE` und `MERGE`; `TRUNCATE` wird ausschließlich über das Tabellenrecht
kontrolliert. Deshalb ist es auf allen fünf Tabellen für `anon` und `authenticated` entzogen.

**Verifikationsstand.** Die Konfiguration oben ist **strukturell** verifiziert (2026-09-03,
Policies, Rechte und RLS-Flags aus der laufenden Datenbank gelesen) **und funktional**
(2026-09-04, `npm run verify:rls` mit zwei echten JWT-Sessions, **31/31 bestanden**).
Die Regeln sind damit nachweislich *so konfiguriert* **und** nachweislich *wirksam*.
Aufschlüsselung der Prüfungen: `docs/AUTH.md`, Abschnitt 8.

**Die Service Role umgeht RLS.** Sie schreibt den Katalog (Import, V1.3) und wird ausschließlich
lokal verwendet. Sie umgeht jedoch **weder Constraints noch Trigger** — dort liegt der Schutz
der SKY-ID-Unveränderlichkeit (Abschnitt 3.7).

---

## 6. Migrationen und Import

- SQL-Dateien unter `supabase/migrations/`, aufsteigend nummeriert, **additiv**.
- Erste Migration: `0001_initial_schema.sql` — **am 2026-09-03 erfolgreich ausgeführt** und
  strukturell verifiziert. Zuvor einmal zurückgesetzt und korrigiert neu ausgeführt
  (Abschnitt 3.9); die Datei im Repository und der Datenbankstand sind identisch.
  Sie erzeugt ausschließlich Struktur: keine Daten, keine Secrets, keine hartkodierten
  Benutzer-IDs, keine Abhängigkeit von vorhandenen Zeilen. Ein erneuter Lauf auf einer
  bestehenden Datenbank scheitert bewusst laut (`create table` ohne `if not exists`), statt
  eine abweichende Tabelle stillschweigend zu übergehen.
- Zweite Migration: `0002_characters.sql` — legt `characters` an und ergänzt die nullbare
  Spalte `skylanders.character_id`. **Rein additiv:** keine Zeile geändert, keine gelöscht,
  kein Typ geändert. Rücknahme wäre `drop column` + `drop table`.
- Kein `DROP`, kein destruktives `ALTER` ohne ausdrückliche Freigabe des Nutzers.
- Der Import (`tools/import-catalog.mts`, `npm run catalog:import`) läuft lokal mit
  Service-Role-Key und ist standardmäßig ein **Dry-Run**. Regeln und Prüfliste vollständig in
  `docs/SKYLANDERS_DATA.md`, Abschnitt 12.
- **Zweiter, getrennter Pflegeweg:** `tools/import-characters.mts` (`npm run
  characters:import`) wendet `data/characters/characters.json` an. Ebenfalls Dry-Run per
  Vorgabe, `--apply` schreibt, `--validate-only` öffnet gar keine Verbindung. Er rührt
  ausschließlich `characters` und die `character_id` der kuratierten SKY-IDs an — **er setzt
  nie eine Verknüpfung auf NULL zurück** und löscht nichts.
- **Der Katalogimport schreibt `character_id` nie.** Sein Upsert benennt exakt die acht
  Spalten der Legacy-Quelle, und PostgREST aktualisiert nur benannte Spalten. Das ist Sicherheit
  durch Auslassung und damit leicht zu verlieren — `src/lib/catalog/import-payload.test.ts`
  nagelt die Spaltenliste deshalb fest.

**Zur Transaktionalität — ehrlich benannt.** Der Supabase-JS-Client kann keine Transaktion über
mehrere Anweisungen aufspannen. Statt dessen gilt:

1. **Die Validierung läuft vollständig durch, bevor irgendetwas geschrieben wird.** Der
   häufigste Fehlerfall — eine fehlerhafte Eingabe — kann die Datenbank also gar nicht erreichen.
2. **Alle Schreibvorgänge sind idempotente Upserts** über `sky_id`, Serien-Code und
   `(Serie, Kategoriename)`. Bricht ein Lauf mittendrin ab, vollendet ihn ein erneuter Lauf;
   es entsteht kein Zustand, der sich nicht durch Wiederholung reparieren ließe.
3. Geschrieben wird in Abhängigkeitsreihenfolge: Serien → Kategorien → Figuren.

**Das ist keine echte Atomarität.** Ein Abbruch zwischen Kategorien und Figuren hinterlässt
einen Katalog ohne Figuren — sichtbar, aber durch Wiederholung behebbar.

**Entschieden (2026-09-04):** Für den **erstmaligen Import in die leere Datenbank** wird diese
Einschränkung ausdrücklich akzeptiert. **Vor regelmäßigen produktiven Importen** gegen eine
benutzte Datenbank wird sie erneut bewertet. Eine serverseitige
`import_catalog(payload jsonb)`-Funktion würde echte Atomarität liefern, bedeutete aber eine
PL/pgSQL-Implementierung der gesamten Importlogik — sie wird **jetzt nicht** gebaut.

**Nachgewiesen am 2026-09-04:** Der Import ist idempotent. Ein zweiter Lauf unmittelbar nach
dem Apply meldete `new 0, changed 0` auf allen drei Tabellen und übernahm alle 600 Slugs
unverändert aus der Datenbank.
- Nach jedem Import: Anzahl prüfen, keine doppelte SKY-ID, kein interner Namenssuffix,
  nur öffentliche Serien, alle Bildreferenzen auflösbar. Fehlschlag → Rollback.

---

## 7. Vorbereitung auf spätere Erweiterungen

Diese Tabellen werden **jetzt nicht angelegt**. Sie sind hier nur dokumentiert, damit heutige
Entscheidungen sie nicht verbauen:

| Später | Wie es andockt | Was heute schon passt |
|---|---|---|
| `wishlist_items` | `(user_id, sky_id, priority)` | referenziert dieselbe `skylanders`-Tabelle |
| ~~`characters`~~ | **existiert seit Migration 0002** (Abschnitt 3.0) | — |
| `skylanders.element` | Element für Nicht-Charakter-Objekte (Traps 55/57, Kristalle 27/27 tragen es im Produktnamen) | Modell A: `characters.element` und `skylanders.element` treffen sich nie auf derselben Zeile, weil ein Objekt mit Charakter kein Trap ist (ADR-0034) |
| `listings` (Verkauf) | `(id, user_id, sky_id, quantity, price, status)` | eigene Tabelle, `collection_items` bleibt unverändert |
| Zustand je Exemplar | Unique-Index auf `collection_items` löschen, Spalte ergänzen | Surrogat-PK existiert bereits |
| `price_history` | `(sky_id, price, source, valid_from)`; `skylanders.market_price` wird zum Cache des jüngsten Werts | Preis wird schon heute nur an einer Stelle gelesen |
| öffentliche Profile / Sammlungen | Flags `profiles.is_public` / `profiles.collection_public`, erweiterte SELECT-Policy | Sammlung liegt bereits in der DB, nicht im Browser; restriktiver Start lässt sich öffnen |
| Zustände `keep` / `sell` / `trade` | Spalte auf `collection_items`, Unique-Constraint entfernen | Surrogat-PK und Fremdschlüssel bleiben unverändert |
| mehrere Bilder je Figur | `skylander_images (sky_id, file, position)`; `image_file` wird zum Primärbild | Bildidentität ist der Dateiname, nicht die URL |

### First-Party-Shop — konzeptionelle Richtung, **keine dieser Strukturen existiert**

Festgehalten nach ADR-0032 und ADR-0033. **Keine Migration, keine Tabelle, keine Rolle.**
Die Spaltennamen sind Platzhalter zur Verständigung, kein Entwurf.

| Später | Wofür | Wie es andockt |
|---|---|---|
| Shop-Inventar (`shop_inventory`) | Lagerbestand des Geschäfts | `sky_id` als Fremdschlüssel auf `skylanders`; **völlig getrennt von `collection_items`**, keine Synchronisierung; Eindeutigkeit über `(sky_id, condition)` mit `loose` / `boxed` |
| Shoppreis | Verkaufspreis, eigene Größe | Feld an derselben Struktur, z. B. `sale_price` — nicht `skylanders.market_price` |
| Shop-Admin-Berechtigung | wer darf schreiben | eigene Struktur, für `authenticated` **nicht** schreibbar (siehe unten) |
| Rabattregeln | Lager-Schwellen und Prozentsätze | konfigurierbar an einer Stelle, nicht im Produktcode verteilt |
| Coupons | Rabattcodes | eigene Struktur; Regeln offen (ADR-0033) |
| Bestellungen | Kaufvorgang | eigene Struktur; personenbezogene Daten → DSGVO-relevant |
| Bestellpositionen | was gekauft wurde | **Preis-Snapshot**, kein Verweis auf den heutigen Preis |

#### Konkreter Entwurf (ADR-0037) — **nicht angelegt**

Spaltennamen sind Entwurf, keine Migration. Alles hier ist additiv zum bestehenden Schema.

```
shop_admins
  user_id        uuid pk  → auth.users (on delete cascade)
  granted_at     timestamptz not null default now()
  note           text
  -- KEIN Recht für anon/authenticated. Vergabe nur über die Service Role.
  -- Abgefragt ausschließlich über public.is_shop_admin() (security definer).

shop_inventory
  id             bigint identity pk
  sky_id         text not null → skylanders (on delete restrict)   -- UNVERÄNDERLICH
  condition      text not null  check (condition in ('loose','boxed'))  -- UNVERÄNDERLICH
  quantity       integer not null default 0  check (quantity >= 0)
  reserved       integer not null default 0  check (reserved >= 0 and reserved <= quantity)
  sale_price     numeric(10,2)               check (sale_price is null or sale_price > 0)
  is_listed      boolean not null default false
  note           text                              -- intern, nie öffentlich
  created_at, updated_at
  unique (sky_id, condition)
  -- KEIN user_id: der Bestand gehört dem Shop, nicht dem Business-Account.

inventory_movements
  id             bigint identity pk
  inventory_id   bigint not null → shop_inventory (on delete restrict)
  delta          integer not null  check (delta <> 0)
  reason         text not null     -- purchase | sale_skyisles | sale_external
                                   -- | return | correction | writeoff
  unit_cost      numeric(10,2) null   -- NUR bei reason='purchase', sonst NULL
  currency       text null            -- dito
  order_id       bigint null → orders                              -- später
  note           text                                              -- intern
  created_at     timestamptz not null default now()
  created_by     uuid not null → auth.users
  -- Nur Anhängen. Kein UPDATE, kein DELETE — auch nicht für Shop-Admins.
  -- KEINE eigene sky_id: siehe „Normalisierung" unten.
```

**`condition` kennt in V1 genau zwei Werte** (ADR-0037 § 5): `loose` — lose Figur ohne
Verkaufsverpackung — und `boxed` — dieselbe Figur in OVP. Keine weiteren Zustandsstufen.
Der Eindeutigkeitsschlüssel ist trotzdem **von Anfang an** `(sky_id, condition)`, damit eine
spätere dritte Ausprägung keine Migration auf laufendem Bestand auslöst.

**Normalisierung: `inventory_movements` speichert `sky_id` nicht doppelt.** Geprüft und
verworfen: `inventory_id → shop_inventory → sky_id` ist eindeutig, und die Bestandszeile wird
nie gelöscht. Ein Snapshot wäre nur nötig, wenn eine Position ihre `sky_id` oder `condition`
ändern könnte — genau das ist ausgeschlossen: **beide Felder sind unveränderlich.** Eine
Umwidmung wäre eine neue Position plus Ausbuchung der alten, keine Änderung. Die Auswertung
„alle Bewegungen zu SKY-0123" ist damit ein Join über eine kleine Tabelle in einer
Admin-Ansicht — der richtige Preis für eine widerspruchsfreie Historie.

**Indizes:** `shop_inventory (sky_id)` für den Katalog-Join · Teilindex
`shop_inventory (sky_id) where is_listed and quantity > reserved` für „Fehlend & verfügbar" ·
`inventory_movements (inventory_id, created_at desc)` für den Verlauf ·
`inventory_movements (order_id) where order_id is not null`.

**`unit_cost` ist bewusst nullable und wird beim Legacy-Import nicht gefüllt.** Die Excel
kennt Einkaufspreise nur als Summe je Einkaufsereignis, ohne SKY-ID und ohne Charge; für alle
234 Bestandspositionen ist der Einstand unbelegbar (`docs/SKYLANDERS_DATA.md` 11d). Der Import
schreibt deshalb `NULL` statt eines geschätzten Werts. Ab dem ersten eigenen Wareneingang ist
der Preis dagegen bekannt — und ohne Spalte unwiederbringlich verloren, weshalb die beiden
Spalten von Anfang an mitkommen (ADR-0037 § 21). Chargen (Lots) sind daraus später **ableitbar**
und werden jetzt nicht gebaut.

**Später, noch nicht entworfen:** `orders`, `order_items` (mit Preis-Snapshot), Rabattregeln,
Coupons. Zu `order_items` gehören außer den Preisfeldern mindestens `currency`, ein
gespeichertes `line_total` und ein Steuer-Snapshot. Welches Steuerverfahren gilt, ist eine
offene **steuerliche** Frage — keine Softwareentscheidung — und muss vor der ersten Bestellung
geklärt sein.

**Verfügbare Menge und Schutz vor Doppelverkauf.** Öffentlich zählt nie `quantity`, sondern
`quantity - reserved`; der Warenkorb reduziert nichts, der Checkout reserviert. Beides ist eine
atomare bedingte Operation in einer `security definer`-Funktion, damit kein Client sie umgehen
kann — sinngemäß:

```sql
update shop_inventory
   set reserved = reserved + :n
 where id = :id and quantity - reserved >= :n
returning id;
```

Null zurückgegebene Zeilen heißen „ausverkauft", nicht „Fehler". Zusammen mit
`check (quantity >= 0)` und `check (reserved <= quantity)` ist ein negativer oder
überreservierter Bestand strukturell unmöglich. Concurrency wird auf Datenbankebene gelöst,
nie durch „Client liest, Client schreibt".

**Drei Randbedingungen, die heute schon gelten und nicht verletzt werden dürfen:**

1. **`collection_items` bleibt ausschließlich persönliche Sammlung.** Kein Shopbestand, keine
   Zusatzspalte dafür, kein technischer Betreiber-Account als Umweg.
2. **`skylanders.market_price` bleibt der Referenzmarktwert.** Der Shoppreis ist eine andere
   fachliche Größe. Ein Marktpreis-Update darf einen gesetzten Shoppreis nicht überschreiben,
   und ein Shop-Rabatt verändert `market_price` nicht — sonst verschöbe ein Angebot die
   Sammlungswerte aller anderen Nutzer.
3. **Eine Rollenspalte darf nicht auf `profiles`.** `profiles` trägt heute
   `grant select, insert, update … to authenticated` zusammen mit `profiles_update_own`
   (Abschnitt 5). Eine Rolle dort **könnte sich jeder Benutzer selbst setzen.** Sie gehört in
   eine Struktur ohne `INSERT`/`UPDATE` für `authenticated`, vergeben über `service_role` oder
   eine `security definer`-Funktion.

Was heute schon passt: Der Katalog ist für Benutzer nicht schreibbar (ADR-0016), `sky_id` ist
die stabile Identität (ADR-0001), und Werte werden konsequent berechnet statt gespeichert
(Abschnitt 3.8) — der Shop bringt mit dem Preis-Snapshot die erste begründete Ausnahme davon
mit, und zwar genau dort, wo Unveränderlichkeit fachlich gefordert ist.

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

Dazu bei der Umsetzung präzisiert: case-insensitive Benutzernamen ohne `citext` (ADR-0020),
`market_price > 0` statt `>= 0` zur Durchsetzung von ADR-0010, zusammengesetzter Fremdschlüssel
Kategorie↔Serie, `on delete restrict` zwischen Sammlung und Katalog, Trigger für die
SKY-ID-Unveränderlichkeit.

**Noch offen — blockiert die Migration nicht:**

- ~~Benutzernamenänderung~~ — **entschieden (ADR-0016)**: erlaubt. `username` ist nie Schlüssel,
  die UUID ist die Identität. Eine Sperrfrist ist keine V1-Anforderung.
- ~~Slug-Kollisionsregel~~ — **entschieden (ADR-0011)**, an den echten Daten verifiziert.
### Sammlungssemantik (Phase H, 2026-09-05)

Vier Regeln, alle in `src/lib/collection/` implementiert und getestet:

| Frage | Antwort |
|---|---|
| **Besitz** | eine Zeile in `collection_items` mit `quantity >= 1`. „Besitzt nicht" heißt: keine Zeile. `quantity = 0` wird nie gespeichert (CHECK). |
| **Fortschritt** | zählt eine SKY-ID **einmal**, egal wie viele Exemplare. Drei Drobots sind eine Figur von 561, nicht drei. |
| **Sammlungswert** | zählt **jedes Exemplar**: `market_price × quantity`. Ohne Marktpreis fließt eine Figur nicht mit 0 € ein, sondern gar nicht — und wird separat ausgewiesen (ADR-0010). |
| **Duplikat** | `quantity > 1`. Das ist eine reine Bestandsaussage — kein Verkaufs-, Tausch- oder Shopstatus (ADR-0032). |

**Zähler und Nenner beschreiben dieselbe Menge.** Der Nenner sind die aktiven,
sammelbaren Figuren (561). Deshalb zählt `countedFigures` im Zähler nur aktive Figuren; eine
besessene, nicht mehr aktive Figur bleibt in der Sammlung und in `distinctFigures`, könnte den
Fortschritt aber sonst über 100 % treiben. Software zählt nirgends mit (ADR-0029) und bekommt
auch keine Karte — sie wird als Hinweiszeile ausgewiesen.

**Entfernen und Rückgängig.** Entfernen löscht die ganze Zeile, auch bei `quantity > 1`.
Damit „Rückgängig" nicht stillschweigend auf 1 zurückfällt, nennt die Server Action jetzt
optional die Menge: `setCollected(skyId, true, 4)`. Das bleibt ein Zielzustand und keine
Umschaltung — „gesammelt, vier Stück" ist genauso wiederholbar wie „gesammelt". Ohne Angabe
verhält sich der Aufruf wie bisher und lässt eine bestehende Menge unangetastet, damit ein
doppelter Tipp im Katalog keinen Zähler zurücksetzt.

- **OPEN:** Reicht die Obergrenze `quantity <= 10000`? Sie ist als Schutz gegen einen
  fehlerhaften Client gedacht, nicht als fachliche Grenze.
- **OPEN:** Wie wird die spätere Shop-Admin-Berechtigung getragen und vergeben? Fest steht nur,
  **wo sie nicht hingehört** (ADR-0032): nicht an eine E-Mail-Adresse, nicht auf `profiles`.
- **OPEN:** Liefert das öffentliche Shop-Lesefenster später eine Stückzahl oder nur einen
  Zustand? Eine sichtbare Rabattstufe verrät bereits einen groben Bestand (ADR-0033).
