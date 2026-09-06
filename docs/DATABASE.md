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

| `catalog_group` | `text` **nullbar** | Produktgruppe (ADR-0041), redaktionell. CHECK gegen zehn Werte. Migration `0004`. |

Unique: `(series_code, position)` · `(series_code, name)` · `(id, series_code)`.

**`catalog_group` — die Produktgruppe (Migration `0004`, ADR-0041).** Beantwortet „was für ein
Objekt ist das?": `figure`, `giant`, `swapper`, `trap_master`, `sensei`, `vehicle`, `trap`,
`creation_crystal`, `mini`, `item`. Sie liegt auf der Kategorie, weil der Audit vom 2026-09-06
belegt hat, dass jede der 24 Kategoriezeilen vollständig in genau eine Gruppe fällt — 24
Entscheidungen für 561 Objekte, kein SKY-ID-Override.

`NULL` ist ein Zustand, kein Standard: eine später hinzukommende Kategorie ist unklassifiziert,
bleibt unter „Alle" sichtbar und wird nie automatisch `item`. Die sechs `Spiele`-Zeilen bleiben
dauerhaft `NULL` (ADR-0029). **Admin-owned:** der Import schreibt an `categories` nur
`position` (siehe 6.).

Die Gruppe sagt **nichts** über Varianten und **nichts** über Completion.

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
| `is_active` | `boolean not null default true` | statt Löschen; **import-owned**, bei jedem Lauf `true` |
| `catalog_visible` | `boolean not null default true` | redaktionelle Sichtbarkeit (ADR-0039), **admin-owned**, öffentlich |
| `display_name_override` | `text` **nullbar** | öffentlicher Name statt `name`; nicht leer, wenn gesetzt; öffentlich |
| `created_at` / `updated_at` | `timestamptz not null default now()` | `updated_at` per Trigger |

Indizes: `(series_code, category_id)` · `(is_active)` · unique `(slug)` ·
`(series_code) where is_active and catalog_visible` (die öffentliche Katalogabfrage).

**Drei Sichtbarkeiten, drei Spalten — nie vermischen (ADR-0039):**

| Spalte | Frage | Eigentümer |
|---|---|---|
| `skylanders.is_active` | Kennt die Legacy-Quelle die Zeile? | Import |
| `skylanders.catalog_visible` | Soll sie im öffentlichen Katalog erscheinen? | Admin |
| `shop_inventory.is_listed` | Bietet der Shop sie an? | Shop |

**Warum hier keine interne Notiz steht.** `grant select on public.skylanders to anon` gilt für
**jede** Spalte, die die Tabelle je bekommt, und RLS filtert Zeilen, nicht Spalten. Am
2026-09-06 gegen die laufende Datenbank gemessen: ein anonymer PostgREST-Client liest
`select=*` und erhält alle zwölf Spalten. Eine interne Notiz auf dieser Tabelle wäre also über
`GET /rest/v1/skylanders?select=admin_note` öffentlich gewesen — unabhängig davon, was die
Anwendung selektiert. Deshalb liegt sie in `catalog_editorial` (3.3c). Auf `skylanders` stehen
nur die beiden Spalten, die zum **öffentlichen** Produktmodell gehören.

**Verborgen heißt weder gelöscht noch gezählt (ADR-0040).** `collection_items` bleibt
unangetastet, der Sammlungswert zählt die Figur weiter — aber sie steht in **keiner** Hälfte des
Completion-Bruchs, weder im Zähler noch im Nenner. Damit kann `owned > total` nicht entstehen.

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

### 3.3c `catalog_editorial` — die interne Seite (Migration `0004`)

| Spalte | Typ | Regel |
|---|---|---|
| `sky_id` | `text` **PK** | FK → `skylanders`, `on update cascade on delete cascade` |
| `admin_note` | `text` **nullbar** | interne Notiz, max. 2000 Zeichen |
| `updated_at` | `timestamptz not null default now()` | |

Eine Zeile je Figur, angelegt bei der ersten Notiz — kein Backfill, keine 601 leeren Zeilen.
Wird die Notiz geleert, verschwindet die Zeile; die Historie bleibt im Journal.

**Zwei unabhängige Schlösser:** `anon` hat **gar kein** Recht auf der Tabelle, `authenticated`
hat `select` und trifft auf die Policy `catalog_editorial_select_admin`
(`using (public.is_shop_admin())`). Schreibrechte hat niemand; geschrieben wird ausschließlich
über `admin_set_admin_note()`. Fällt eines der beiden Schlösser aus, ist das noch kein Leck.

**Kein `edited_by`/`edited_at` auf `skylanders`.** Beides wäre eine zweite Wahrheit neben
`catalog_admin_changes` — und ein `edited_by` auf einer weltlesbaren Tabelle würde nebenbei
veröffentlichen, wer den Katalog pflegt. Wer wann was geändert hat, beantwortet das Journal.

### 3.3b `catalog_admin_changes` — die redaktionelle Historie (Migration `0004`)

| Spalte | Typ | Regel |
|---|---|---|
| `id` | `bigint generated always as identity` **PK** | |
| `entity` | `text not null` | `skylander` oder `category` |
| `entity_id` | `text not null` | SKY-ID bzw. Kategorie-ID als Text |
| `field` | `text not null` | `catalog_visible`, `display_name_override`, `admin_note`, `catalog_group` |
| `old_value` / `new_value` | `text` **nullbar** | beide Seiten als Text — die Tabelle wird gelesen, nicht gejoint |
| `changed_by` | `uuid` **nullbar** | → `auth.users`, `on delete set null`: die Änderung überlebt die Person |
| `changed_at` | `timestamptz not null default now()` | |

**Append-only per Trigger**, nicht per Policy: RLS gilt nicht für die Service Role, Trigger
schon — dieselbe Begründung wie bei `inventory_movements`. **Geschrieben von Triggern auf
`skylanders` und `categories`**, nicht von der Anwendung: so kann kein Schreibweg das
Protokollieren vergessen, auch kein lokales Skript. Für Clients gibt es weder Rechte noch
Policy; Admins lesen über `admin_catalog_changes()`.

### 3.3d Lager lesen — `admin_shop_inventory()` / `admin_inventory_movements()` (Migration `0005`)

`0003` gab Administratoren eine vollständige **Schreib**fläche und bewusst **keine**
Tabellenrechte: `revoke all on shop_inventory, inventory_movements from anon, authenticated`.
Das ist richtig — ein Tabellen-Grant öffnet jede Spalte, und Einkaufspreise, Lieferanten und
Bestände sind genau das, was `docs/SECURITY.md` intern hält.

Die Folge, beim Bau der Lager-UI aufgefallen: **ein Admin konnte seinen eigenen Bestand nicht
lesen.** Auch die Abstimmungs-View half nicht — sie ist `security_invoker` und erbt damit
absichtlich die (fehlenden) Rechte des Aufrufers.

`0005` ergänzt die fehlende Hälfte in derselben Form wie die Schreibhälfte: zwei
`security definer`-Funktionen mit `is_shop_admin()`-Prüfung, `revoke … from public, anon`,
`grant execute … to authenticated`. **Kein Tabellenrecht, keine Policy, keine Spalte.**

| Funktion | Antwort |
|---|---|
| `admin_shop_inventory()` | alle Positionen mit `quantity`, `reserved`, `available_quantity`, `sale_price`, `is_listed`, `note` |
| `admin_inventory_movements(id, limit)` | die jüngsten Bewegungen einer Position, neueste zuerst |

Die Figur hinter einer Position — Name, Bild, Serie, Marktpreis — kommt aus dem Katalog, den die
Anwendung ohnehin lädt. Die Funktionen joinen nicht und wiederholen damit auch nicht die Regeln
darüber, was sammelbar und was sichtbar ist.

### 3.3e Das öffentliche Angebot — `shop_offers()` (Migration `0006`)

Die **einzige** öffentliche Lesefläche auf `shop_inventory`. `security definer`, ohne Argumente,
`grant execute … to anon, authenticated`. Die Tabellen behalten weiterhin für keinen Clientrole
irgendein Recht, und es wird keine Policy hinzugefügt (ADR-0043).

| Spalte | Typ | Bedeutung |
|---|---|---|
| `sky_id` | `text` | welcher Artikel |
| `condition` | `text` | `loose` oder `boxed` |
| `sale_price` | `numeric` | der SkyIsles-Preis, nie NULL (CHECK `shop_inventory_listed_needs_price`) |
| `available` | `boolean` | `available_quantity > 0` — **kein** Lagerstand |

**Nie zurückgegeben:** `quantity`, `reserved`, `available_quantity`, `note`, `unit_cost`,
`currency`, `created_by`, `inventory_id` und jede Bewegung. Das ist keine Disziplin, sondern die
Signatur der Funktion.

**Zeilenauswahl:** `is_listed` **und** der Katalogfilter `is_active`, `catalog_visible` sowie die
Kategorieregel. Eine gelistete Position ohne Bestand liefert weiterhin eine Zeile mit
`available = false` („Nicht auf Lager"); eine nicht gelistete Position liefert gar keine.

`public.non_collectible_categories()` (`immutable`, gleiche Migration) hält die Kategorienamen
aus ADR-0029 an **einer** Stelle in der Datenbank und spiegelt `src/lib/catalog/collectible.ts`.
`src/lib/shop/offer.test.ts` liest beide Dateien, `npm run verify:shop` vergleicht Datenbank und
Anwendung zur Laufzeit.

### 3.3f `shop_settings` — eine Zeile, typisiert (Migration `0007`)

| Spalte | Typ | Regel |
|---|---|---|
| `id` | `boolean` | Primärschlüssel, `check (id)` — **genau eine Zeile möglich** |
| `price_percentage` | `numeric(6,2)` | Standard `90.00`, `> 0` und `<= 500` |
| `updated_at` / `updated_by` | | wer zuletzt geändert hat, `on delete set null` |

**Bewusst kein Key/Value.** Ein `settings(key, value jsonb)` müsste jeder Leser casten und neu
validieren, ein Tippfehler im Schlüssel läse sich als „nicht gesetzt", und der CHECK oben könnte
gar nicht existieren. Der Singleton ist ein Primärschlüssel, der nur einen Wert annehmen kann —
kein Trigger, kein Aufräumjob.

RLS aktiv, **keine** Client-Rechte. Gelesen über `admin_shop_settings()`, geschrieben über
`admin_set_shop_percentage()`, beide `security definer` mit `is_shop_admin()`.

### 3.3g Der effektive Shoppreis (Migration `0007`, ADR-0045)

`public.shop_price(override, market_price, percentage)` — `immutable`, `numeric` durchgehend,
`round(x, 2)`:

```
override ist nicht NULL          → override
market_price oder pct ist NULL   → NULL
sonst                            → round(market_price * pct / 100, 2)
```

**Die einzige Stelle, an der ein Shoppreis entsteht.** Aufgerufen von `shop_offers()`,
`admin_shop_inventory()` und `set_shop_listing()`. `shop_inventory.sale_price` ist ab hier der
**manuelle Override**, nicht „der Preis"; NULL heißt „es gilt die Regel". Es wird **nirgends** ein
abgeleiteter Preis gespeichert — deshalb wirken Marktpreis- und Prozentsatzänderungen ohne ein
einziges Update.

**Entfallen:** der CHECK `shop_inventory_listed_needs_price`. Ein CHECK kann die Frage nicht mehr
beantworten, weil sie an zwei anderen Tabellen hängt; die Regel steht jetzt in
`set_shop_listing()` (weist eine Listung ohne effektiven Preis ab) und in `shop_offers()` (liefert
keine Zeile ohne einen). Begründung vollständig in ADR-0045.

### 3.3h `skylanders.image_override_path` (Migration `0007`, ADR-0046)

Nullbare Spalte, Pfad im öffentlichen Storage-Bucket `catalog`, CHECK
`^SKY-[0-9]{4}/[0-9a-f]{16}\.(webp|png|jpg)$`. NULL heißt „das importierte `image_file` gilt".

**Der Katalogimport schreibt sie nie** — dieselbe Trennung wie bei `character_id` und den
redaktionellen Spalten. Gesetzt und gelöscht wird über `admin_set_image_override()`, das
zusätzlich prüft, dass der Pfad zum eigenen SKY-ID gehört. Änderungen landen im redaktionellen
Journal `catalog_admin_changes` (Feld `image_override_path`), geschrieben vom Trigger.

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
| `shop_admins.user_id → auth.users.id` | `cascade` | `cascade` | Konto gelöscht → Berechtigung verschwindet. Anders als beim Journal ist hier nichts zu bewahren. |
| `shop_inventory.sky_id → skylanders.sky_id` | **`restrict`** | `cascade` | Ein Katalogeintrag darf nicht unter dem Bestand wegbrechen. |
| `inventory_movements.inventory_id → shop_inventory.id` | **`restrict`** | `cascade` | **Der Riegel vor der Audit-Historie.** Eine Position mit Bewegungen ist nicht löschbar — sonst wäre das Löschen der Position der Umweg, auf dem sich unveränderliche Historie doch entfernen ließe. |
| `inventory_movements.created_by → auth.users.id` | **`set null`** | `cascade` | Ein gelöschtes Mitarbeiterkonto darf keine Buchungshistorie mitnehmen. NULL heißt danach „System oder ehemaliges Konto". |

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
| `skylanders_select_anon` ¹ | `skylanders` | SELECT | anon | `is_active and catalog_visible` |
| `skylanders_select_authenticated` ¹ | `skylanders` | SELECT | authenticated | öffentlich **oder** `is_shop_admin()` **oder** eigener Sammlungsbezug |
| `profiles_select_own` | `profiles` | SELECT | authenticated | `USING (auth.uid() = id)` |
| `profiles_insert_own` | `profiles` | INSERT | authenticated | `WITH CHECK (auth.uid() = id)` |
| `profiles_update_own` | `profiles` | UPDATE | authenticated | `USING` **und** `WITH CHECK (auth.uid() = id)` |
| `collection_items_select_own` | `collection_items` | SELECT | authenticated | `USING (auth.uid() = user_id)` |
| `collection_items_insert_own` | `collection_items` | INSERT | authenticated | `WITH CHECK (auth.uid() = user_id)` |
| `collection_items_update_own` | `collection_items` | UPDATE | authenticated | `USING` **und** `WITH CHECK (auth.uid() = user_id)` |
| `collection_items_delete_own` | `collection_items` | DELETE | authenticated | `USING (auth.uid() = user_id)` |

¹ **Ersetzt in `0004` die frühere Policy `skylanders_select_public` (`using (true)`).** Solange
jede Zeile öffentlich war, war „alle Zeilen für alle" richtig. Mit `catalog_visible` muss eine
verborgene Zeile auch über die **API** verschwinden, nicht nur in der Anwendung. Drei Zweige,
in dieser Reihenfolge:

1. **öffentlich** — `is_active and catalog_visible`; der Normalfall, greift ohne Unterabfrage.
2. **Admin** — `public.is_shop_admin()`; sieht alles, ohne dass die Tabelle für andere aufgeht.
3. **eigener Besitz** — `exists (select 1 from collection_items ci where ci.sky_id = … and
   ci.user_id = auth.uid())`; eine nachträglich verborgene Figur bleibt in der eigenen Sammlung
   vollständig sichtbar (ADR-0040), inklusive Name, Preis und Bild.

**Keine Rekursion:** Die Policies von `collection_items` vergleichen `auth.uid()` mit
`user_id` und erwähnen `skylanders` nicht — der Zyklus entsteht also nicht. Die Unterabfrage
nutzt den Unique-Index `(user_id, sky_id)`.

**Warum zwei Policies statt einer:** `anon` hat auf `is_shop_admin()` kein EXECUTE-Recht. Eine
gemeinsame Policy, die die Funktion aufruft, würde jede anonyme Katalogabfrage mit
*permission denied for function* beenden.

**Warum `USING` und `WITH CHECK` bei jedem UPDATE.** `USING` bestimmt, welche Zeilen geändert
werden dürfen; `WITH CHECK`, was aus ihnen werden darf. Ohne `WITH CHECK` könnte ein Benutzer
seine eigene Zeile auf eine fremde `user_id` umschreiben und sie damit verschieben.

**Warum keine DELETE-Policy auf `profiles`.** Profile verschwinden mit dem Auth-Benutzer
(`on delete cascade`), nicht einzeln. Andernfalls entstünde ein Benutzer ohne Profil.

**Warum es für die redaktionellen Spalten keine Policy gibt (Migration `0004`).** Weil es kein
Schreibrecht gibt: `anon` und `authenticated` haben auf `skylanders` und `categories` nur
`select`. Die redaktionellen Spalten erben damit denselben Schutz wie die importierten. Der
einzige Schreibweg sind vier `security definer`-Funktionen, die jede für sich
`public.is_shop_admin()` fragen:

| Funktion | Wirkung |
|---|---|
| `admin_set_catalog_visible(sky_id, boolean)` | Sichtbarkeit |
| `admin_set_display_name_override(sky_id, text)` | öffentlicher Name; leerer Text = zurücksetzen |
| `admin_set_admin_note(sky_id, text)` | interne Notiz |
| `admin_set_catalog_group(category_id, text)` | Produktgruppe der Kategorie |
| `admin_catalog_changes(entity, id, limit)` | liest die Historie |

Alle mit `set search_path = ''`, alle `revoke all … from public, anon` und
`grant execute … to authenticated`. Eine Anfrage ohne Adminberechtigung endet mit
`insufficient_privilege` — unabhängig davon, ob sie über die Oberfläche kam.

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
- Migrationen `0003`–`0005`: Shop-Fundament, redaktionelle Katalogebene, Lager-Lesefunktionen.
- Sechste Migration: `0006_public_shop_offers.sql` — legt `shop_offers()` und
  `non_collectible_categories()` an. **Rein additiv:** keine Tabelle, keine Spalte, keine Policy,
  kein Tabellenrecht, kein `alter table`. Rücknahme wäre `drop function` auf beide.
  **Am 2026-09-06 ausgeführt**, `npm run verify:shop` 15/15.
- Siebte Migration: `0007_shop_pricing_and_images.sql` — `shop_settings`, `shop_price()`,
  abgeleitete Preise in `shop_offers()` und `admin_shop_inventory()`,
  `skylanders.image_override_path`, Storage-Bucket `catalog` samt Policies. **Überwiegend
  additiv, mit einer bewussten Lockerung:** der CHECK `shop_inventory_listed_needs_price` wird
  entfernt, weil er die Frage nicht mehr beantworten kann (ADR-0045). Keine Zeile wird geändert,
  keine Spalte gelöscht. Zwei Funktionen werden gedropt und neu angelegt, weil PostgreSQL den
  Rückgabetyp nicht in place ändert.
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
- **Dritter Pflegeweg, einmalig:** `tools/import-legacy-inventory.mts`
  (`npm run inventory:import-legacy`) bucht den Legacy-Geschäftsbestand als
  `initial_import`-Bewegungen über `system_record_inventory_movement()`. Dry-Run per Vorgabe,
  `--apply` schreibt. Er schreibt **kein** `quantity`, setzt weder Preis noch Listung und ist
  wiederholbar wie fortsetzbar; der Unique-Index `inventory_movements_one_initial_import` bleibt
  als letzte Sicherung. **Am 2026-09-06 ausgeführt: 218 Positionen, 762 Stück;** ein zweiter
  identischer Lauf meldete `218 already initial-imported · 0 changes`. Regeln vollständig in
  ADR-0044 und `docs/SKYLANDERS_DATA.md`.

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

#### Umgesetzt in `0003_shop_foundation.sql` (2026-09-05)

Drei Tabellen, eine View, sieben Funktionen. Rein additiv: keine bestehende Tabelle, Spalte,
Policy oder Zeile wurde verändert. **Die Migrationsdatei liegt im Repository; ob sie im
Supabase-Projekt bereits angewandt ist, sagt `npm run verify:rls`.**

```
shop_admins
  user_id     uuid pk → auth.users (on update cascade, on delete cascade)
  granted_at  timestamptz not null default now()
  note        text
  -- Keine Rechte für anon/authenticated, keine Policy. Vergabe über die
  -- Service Role. Gelesen ausschließlich von public.is_shop_admin().

shop_inventory
  id                 bigint identity pk
  sky_id             text not null → skylanders (on delete restrict)   -- UNVERÄNDERLICH
  condition          text not null  check in ('loose','boxed')         -- UNVERÄNDERLICH
  quantity           integer not null default 0  check >= 0
  reserved           integer not null default 0  check >= 0, check <= quantity
  available_quantity integer generated always as (quantity - reserved) stored
  sale_price         numeric(10,2)  check (null or > 0)
  is_listed          boolean not null default false
  note               text                       -- intern, nie öffentlich
  created_at, updated_at
  unique (sky_id, condition)
  check (not is_listed or sale_price is not null)
  -- KEIN user_id: der Bestand gehört dem Shop, nicht dem Business-Account.

inventory_movements
  id           bigint identity pk
  inventory_id bigint not null → shop_inventory (on delete restrict)
  delta        integer not null  check (delta <> 0)
  reason       text not null     check in ('purchase','sale_skyisles','sale_external',
                                  'return','correction','writeoff','initial_import')
  unit_cost    numeric(10,2)     -- nur bei reason='purchase'
  currency     text              -- dito, ISO-4217-Muster ^[A-Z]{3}$
  note         text              -- intern
  created_at   timestamptz not null default now()
  created_by   uuid → auth.users (on delete set null)   -- NULL = System
  -- KEINE sky_id: normalisiert, siehe unten. KEIN order_id: `orders` gibt es nicht.
```

**Vorzeichen je Reason**, als CHECK: `purchase` und `initial_import` nur positiv ·
`sale_skyisles`, `sale_external`, `writeoff` nur negativ · `return` und `correction` in beide
Richtungen. `return` bleibt bewusst offen, weil eine Kundenrückgabe Zugang und eine
Lieferantenrückgabe Abgang ist — ein Constraint, der eine der beiden verbietet, erzeugt nur
Buchungen unter falschem Reason.

**Kostenfelder** sind an `purchase` gebunden: `check (reason = 'purchase' or (unit_cost is null
and currency is null))` plus `check ((unit_cost is null) = (currency is null))` und
`unit_cost >= 0`. `initial_import` ist ausdrücklich ausgeschlossen — eine Spalte, die dort NULL
sein *muss*, hält strukturell fest, dass der Legacy-Einstand unbekannt ist
(`docs/SKYLANDERS_DATA.md` 11d, ADR-0037 § 21).

**`initial_import`** ist der Eröffnungsbestand und gilt genau einmal je Position:
`unique index … (inventory_id) where reason = 'initial_import'`. Das ist die Idempotenz des
späteren Imports — ein zweiter Lauf scheitert am Index, statt den Bestand zu verdoppeln. Die
Garantie liegt in der Datenbank, nicht im Skript.

**Normalisierung: `inventory_movements` speichert `sky_id` nicht doppelt.** `inventory_id →
shop_inventory → sky_id` ist eindeutig, und beide Identitätsspalten sind per Trigger
unveränderlich — ein Snapshot würde einen Wert verdoppeln, der nicht abweichen kann.

**Indizes:** `shop_inventory (sky_id)` · Teilindex `(sky_id) where is_listed and quantity >
reserved` für „Fehlend & verfügbar" · `inventory_movements (inventory_id, created_at desc)` ·
der partielle Unique-Index oben.

#### Schreibwege: zwei Wrapper, eine Invariante

Clients haben auf keine der drei Tabellen ein Recht — auch Shop-Admins nicht. Der gesamte
Schreibzugriff sind drei Funktionen:

```
        apply_inventory_movement()          Invariante. Für NIEMANDEN ausführbar.
          ^                    ^
          |                    |
  record_inventory_     system_record_inventory_
  movement()            movement()
  authenticated,        nur service_role
  is_shop_admin()       (kein Client-Rollen-EXECUTE)
  created_by=auth.uid() created_by=NULL, keine Kostenparameter

  set_shop_listing()    authenticated + is_shop_admin(); Preis, Listing, Notiz —
                        niemals quantity oder reserved
```

Die innere Funktion ist erreichbar, weil die Wrapper `security definer` sind und dem
Migrations-Owner gehören; ein Owner darf seine eigenen Funktionen immer ausführen. Für jede
Client-Rolle ist sie explizit entzogen — damit ist auch `created_by` nicht fälschbar, denn nur
die Wrapper setzen es.

**Der Kern der Invariante** in `apply_inventory_movement()`:

```sql
select id into v_inventory_id from public.shop_inventory
 where sky_id = p_sky_id and condition = p_condition
 for update;                         -- konkurrierende Bewegungen serialisieren hier

update public.shop_inventory set quantity = quantity + p_delta
 where id = v_inventory_id and quantity + p_delta >= reserved;
                                     -- Prüfung IST die WHERE-Klausel
```

Null betroffene Zeilen heißt „reicht nicht" und wird als Ausnahme geworfen. Es gibt kein
Fenster zwischen Prüfen und Schreiben, also kein `read → calculate → write`. Der
Journaleintrag folgt in derselben Transaktion: entweder beides oder nichts.

#### Unveränderlichkeit und Anhängejournal

`shop_inventory.sky_id` und `condition` sind per Trigger unveränderlich — **auch für die
Service Role**, die RLS umgeht, Trigger aber nicht. Dieselbe Begründung wie bei
`prevent_sky_id_change()` in `0001`.

**Die fachliche Bewegungshistorie ist unveränderlich.** Der Trigger verweigert `DELETE`
**ausnahmslos und für jede Rolle**, die Service Role eingeschlossen, und ebenso jedes `UPDATE`
an einer Sachspalte. Auch der Umweg über die Position ist zu: Der Fremdschlüssel ist
`on delete restrict`, eine Position mit Historie lässt sich nicht löschen. Korrigiert wird
ausschließlich durch neue Gegenbewegungen.

**Genau eine Änderung ist erlaubt: die Anonymisierung des Actors.** Wird ein Konto gelöscht,
muss `created_by` von dessen UUID auf `NULL` wechseln — das ist es, was `on delete set null`
tut, und PostgreSQL führt es als `UPDATE` auf dieser Tabelle aus. Der Trigger lässt es durch,
wenn `old.created_by` gesetzt war, `new.created_by` NULL ist und
`(id, inventory_id, delta, reason, unit_cost, currency, note, created_at)` per
`is not distinct from` identisch bleibt. Blockiert bleiben damit: UUID → andere UUID,
NULL → UUID, und jede gleichzeitige Änderung einer Sachspalte.

Die Grenze ist bewusst die erlaubte **Datenmutation**, nicht der Aufrufer: Ob PostgreSQL das
`UPDATE` selbst wegen der referentiellen Aktion ausgelöst hat, lässt sich nicht zuverlässig
feststellen, und danach zu raten wäre die schwächere Garantie. Was bewegt wurde, wann, warum und
zu welchem Preis, bleibt unantastbar; entfernt wird nur der personenbezogene Bezug. Ohne diese
Ausnahme wäre jedes Konto, das je eine Bewegung gebucht hat, **dauerhaft nicht mehr löschbar** —
im Widerspruch zur Kontolöschung in `docs/AUTH.md` und zur erklärten Absicht der FK selbst.

Der Preis dafür ist bewusst in Kauf genommen: Eine versehentlich angelegte Position bleibt
bestehen. Sie steht dann auf `is_listed = false`, `quantity = 0`, `reserved = 0` und ist
wirkungslos. Eine Audit-Invariante für Aufräumkomfort aufzuweichen wäre der schlechtere Tausch —
eine Historie, die sich entfernen lässt, belegt nichts. Eine Position **ohne** jede Bewegung
bleibt löschbar, weil dann nichts auf sie zeigt; eine Lösch-API dafür gibt es nicht und soll es
in V1 nicht geben.

#### Reconciliation

`shop_inventory_reconciliation` (View, `security_invoker = true`, keine Client-Rechte) stellt je
Position `quantity`, `SUM(delta)` und `drift` gegenüber. Ein Constraint ist nicht möglich —
PostgreSQL kennt keine tabellenübergreifende Aggregatbedingung —, und ein Trigger wäre
schlechter als nichts: Er schriebe denselben Fehler ein zweites Mal. `npm run verify:rls`
schlägt fehl, sobald irgendwo `drift <> 0` steht.

#### Noch nicht gebaut

`orders`, `order_items` (mit Preis-Snapshot), Rabattregeln, Coupons, die öffentliche
Shop-Projektion und die Reservierungs-API. Zu `order_items` gehören außer den Preisfeldern
mindestens `currency`, ein gespeichertes `line_total` und ein Steuer-Snapshot. Welches
Steuerverfahren gilt, ist eine offene **steuerliche** Frage — keine Softwareentscheidung — und
muss vor der ersten Bestellung geklärt sein.

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
