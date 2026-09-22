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
| `skylanders` | 600 + admin-erzeugte | kanonischer Katalog | öffentlich lesbar |
| `profiles` | = Benutzer | Benutzername, Profil | öffentlich lesbar, selbst schreibbar |
| `collection_items` | wächst | Sammlung: Benutzer × Figur × Menge | nur der Eigentümer |
| `characters` | 19 (Pilot) | kuratierte Charaktermetadaten | öffentlich lesbar, nur kuratiert schreibbar |
| `testers` + 3 (`0036`) | wenige | Testkonten und ihre Test-Berechtigungen | kein Clientrecht, nur über Funktionen |
| `perf_navigations` | wächst je Messlauf | Navigationszeiten von Testkonten | kein Clientrecht, Admin liest aggregiert |
| `perf_interactions` | wächst je Messlauf | Interaktionszeiten (Quick View) von Testkonten | kein Clientrecht, Admin liest aggregiert |
| `shipping_countries` | 1 (`DE`) | wohin der Shop liefert | öffentlich lesbar, nur Admin schreibt |
| `shipping_methods` | 2 | Versandarten und Preise | kein Clientrecht, öffentlich über `shipping_quote()` |

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
| `card_type` | `text not null default 'standard'` | auf welches Kartenmotiv die Figur gedruckt wird (0030, sechster Wert in 0031, siebter in 0032); CHECK `standard \| special \| elite \| dark \| legendary \| chase \| prestige`; **admin-owned**, öffentlich |
| `source` | `text not null default 'import'` | Herkunft (ADR-0070); CHECK `import \| admin`; **nie in der Import-Payload** |
| `created_at` / `updated_at` | `timestamptz not null default now()` | `updated_at` per Trigger |

Indizes: `(series_code, category_id)` · `(is_active)` · unique `(slug)` ·
`(series_code) where is_active and catalog_visible` (die öffentliche Katalogabfrage).

**`source` ist reine Herkunft (0033, ADR-0070).** Nach erfolgreichem Anlegen ist eine
admin-erzeugte Figur genauso kanonisch wie eine importierte. Die Spalte steuert **nichts** —
weder Sichtbarkeit noch Berechtigung, Commerce, Kartenoptik oder Reihenfolge. Sie hat im Produkt
genau einen Leser: `tools/import-catalog.mts` nimmt `source = 'admin'` aus der Warnung „in the
database but not in the export" heraus, weil dort sonst dauerhaft jede neue Figur stünde.

**Neue Figuren entstehen über `admin_create_figure()` (0033).** Eine Transaktion: SKY-ID aus
`public.sky_id_seq` (start 821, Obergrenze 8999 — 9000–9999 ist der reserved system/test range),
Slug über `public.next_figure_slug()`, Zeile, optionale Notiz und ein Journaleintrag `created`.
`catalog_visible` startet **false**. Die Funktion schreibt weder Preis noch Bild noch
`character_id`. **Kein Delete** — es gibt keine Delete-RPC, und `collection_items` sowie
`shop_inventory` stehen auf `on delete restrict`.

**`card_type` ist redaktionell, nicht Besitz (0030).** Die Spalte sagt, *was die Figur ist* —
ein Dark Spyro und ein gewöhnlicher Spyro sind verschiedene Sammelobjekte und sahen bisher
gleich aus. Besitz ist dagegen ein Zustand *pro Betrachter* und wird beim Rendern als Overlay
über jedes Kartenmotiv gelegt; **Sammeln schreibt hier nie**, und es gibt keinen Kartentyp
`collection`. Ebenso wenig ist es das Variantensystem: `card_type` ändert keinen Namen, keinen
Slug, keine Sortierung und keine Charakterzuordnung.

**Bei Mehrfachbelegung gewinnt die höchste Stufe (0031):**

```
legendary  >  dark  >  special  >  standard
```

Eine Zeile, eine Spalte, ein Wert. SKY-0130 „Legendary Chill Light Core" ist ein LightCore
*und* ein Legendary und bleibt `legendary`; das LightCore überlebt im Namen der Figur, nicht im
Kartenmotiv. Es ist die einzige Figur im Bestand, bei der die Regel heute überhaupt etwas zu
entscheiden hat. Maschinenlesbar als `EDITION_RANK` in `lib/catalog/card-type.ts`.

**`chase` und `elite` stehen bewusst außerhalb dieser Kette.** `chase` beantwortet eine andere
Frage — dieselbe Figur in einer anderen Ausführung. `elite` ist eine **Produktlinie**: seine 42
Mitglieder kommen aus einer kuratierten Liste (0032), nie aus einem Namen, und keine Figur im
Katalog ist zugleich Eon's Elite und Dark oder Legendary. Beide treffen die Kette nie.

**`elite` ist nicht `special` (0032).** Eon's Elite lag bis 0032 in `special` — 42 von 95
Zeilen, also fast die halbe Kategorie. Es gehört nicht dazu: LightCore ist eine Bauweise,
Granite eine Ausführung, Eon's Elite eine eigene Produktlinie mit eigener Verpackung und seit
V3.7 eigenem Motiv. `special` behält die 53, die wirklich eine *Form* von etwas sind.

**Verpackung ist eine andere Dimension als Edition.** Die Linie hat **drei Zeilen je Figur** —
OVP Series 1, OVP Series 2, lose — und alle drei sind `elite`. Welche davon öffentlich sichtbar
ist, beantwortet `catalog_visible`: in V1 nur die lose Zeile, weil SkyIsles öffentlich
ausschließlich `loose` unterstützt. Die 28 OVP-Zeilen bleiben vollständig erhalten und für den
Admin sichtbar.

**Die Backfills sind Listen, keine Namensmuster.** 0030 klassifizierte 76 SKY-IDs (21 `dark`,
25 `legendary`, 30 `chase`), 0031 weitere 95 als `special`. `prestige` bleibt bei **0**: ein
gültiger Typ mit eigenem Motiv, den der Admin setzen kann — automatisch klassifiziert wird
dafür nichts.

**`special`** meint eine zusätzliche offizielle **Form oder Edition** einer Basisfigur
innerhalb derselben Serie: LightCore, Eon's Elite, Nitro, Blue, Power Blue, Mystical, Granite,
die Saison- und Event-Ausgaben und die benannten Einzelformen. **`chase`** meint ausschließlich
besondere **Farben und Materialien** — Crystal, Pearl, Jade, Glow, Scarlet, Molten, Bronze,
Metallic, Golden. Granite wechselte in 0031 von `chase` nach `special`; es ist die einzige
Figur, die zwischen den beiden bewegt wurde.

Die Verteilung nach 0031: `standard` 432 · `special` 95 · `dark` 21 · `legendary` 25 ·
`chase` 29 · `prestige` 0. Nach 0032 wandern 42 davon nach `elite`: `standard` 432 ·
`special` **53** · `elite` **42** · `dark` 21 · `legendary` 25 · `chase` 29 · `prestige` 0.

**Reihenfolge der Migrationen ist zwingend: 0031, dann 0032.** 0032 ist auf
`where card_type = 'special'` gegattert — auf einer Datenbank ohne 0031 trifft es nichts und
schreibt nichts. Beide sind seit 2026-09-15 auf Staging und Production angewandt.

**Welche Eon's-Elite-Zeile öffentlich ist, entscheidet `catalog_visible`, nicht `card_type`.**
Alle 42 sind `elite`; öffentlich sichtbar sind die **14 losen**, weil V1 ausschließlich `loose`
anbietet (ADR-0021). Die 28 OVP-Zeilen bleiben vollständig erhalten und für den Admin sichtbar.
Diese Sichtbarkeit ist eine redaktionelle Entscheidung des Administrators und wird **von keiner
Migration geschrieben**.

Gesetzt wird die Spalte über `admin_set_card_type(p_sky_id text, p_card_type text)` —
`security definer`, `search_path = ''`, prüft `is_shop_admin()` vor dem `update`, schreibt
**nur** `card_type` und nicht `updated_at`. Das Vokabular steht einmal im CHECK; die Funktion
wiederholt es nicht, weshalb 0031 sie auch nicht anfassen musste. Der Trigger
`skylanders_set_updated_at` (0001) setzt `updated_at` allerdings bei **jedem** UPDATE auf der
Tabelle, unabhängig davon, welche Spalten ein Statement nennt.

**Drei Sichtbarkeiten, drei Spalten — nie vermischen (ADR-0039):**

| Spalte | Frage | Eigentümer |
|---|---|---|
| `skylanders.is_active` | Kennt die Legacy-Quelle die Zeile? | Import |
| `skylanders.catalog_visible` | Soll sie im öffentlichen Katalog erscheinen? | Admin |
| `skylanders.source` | Woher kam die Zeile? `import` \| `admin` | System (0033) |
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
| `sale_price` | `numeric` | der Angebotspreis, nie NULL |
| `available` | `boolean` | `available_quantity > 0` — **kein** Lagerstand |

> **Stand seit `0007`/`0008`:** Die Spalte heißt in der Projektion `price` und trägt den
> **effektiven** Preis (Override oder Marktpreis × Prozentsatz), nicht die gespeicherte
> `sale_price`-Spalte. Der CHECK `shop_inventory_listed_needs_price` existiert nicht mehr;
> preislose Positionen werden von `shop_offers()` ausgefiltert (Abschnitte 3.3g und 3.3i).

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

### 3.3i Shop-Freigabe ist Opt-out (Migration `0008`, ADR-0048)

`shop_inventory.is_listed` hat ab `0008` den Vorgabewert **`true`**. Eine Position entsteht aus
ihrer ersten Bewegung — `apply_inventory_movement()` fügt sie ohne Flags ein —, also gilt der
Vorgabewert für **jeden** Erzeugungsweg.

| | Bedeutung |
|---|---|
| `is_listed = true` | für den Shop freigegeben. **Nicht** „auf Lager". |
| `is_listed = false` | bewusster Ausschluss: Bestand behalten, hier nicht verkaufen. |

`public.is_shop_eligible(sky_id)` (`stable`) beantwortet „gehört diese Figur überhaupt in den
Shop": aktiv, `catalog_visible`, sammelbar. Aufgerufen von `shop_offers()` **und** von der
einmaligen Freigabe in `0008` — dieselbe Regel, nicht zwei Kopien. Sie sagt nichts über Bestand
oder Preis.

`set_shop_listing()` verlangt für eine Freigabe **keinen** Preis mehr (die Prüfung aus `0007`
entfällt dort und bleibt in `shop_offers()`). Kaufbar ist eine Position weiterhin nur mit
effektivem Preis, verfügbarem Bestand und erfüllten Katalogregeln.

`admin_shop_listing_audit()` (`security definer`, adminonly) listet je Position Freigabe,
Eignung und den Grund einer fehlenden Eignung. Es gibt **keinen** Shop-Snapshot und keinen
Synchronisationsschritt: `shop_offers()` liest den Bestand live.

### 3.3j Mengenprüfung für den Warenkorb (Migration `0009`)

> **Status: angewandt (2026-09-07).** Produktiv verifiziert: beide Funktionen existieren, sind für
> `anon` und `authenticated` ausführbar, und `anon` kann `shop_inventory` und
> `inventory_movements` weiterhin nicht lesen (`42501`). Bestand unverändert, Journal-Drift 0.

> **Die öffentliche V1-Commerce-Grenze, an einer Stelle.** Drei Funktionen sind für `anon`
> ausführbar und berühren `condition`. Seit `0028`/`0029` fragen alle drei dieselbe Regel,
> `public.v1_sale_condition()`:
>
> | Funktion | seit | Verhalten außerhalb der V1-Kondition |
> |---|---|---|
> | `shop_offers()` | `0029` | die Position erscheint nicht in der Projektion |
> | `shop_quantity_available()` | `0028` | `false`, wie bei ausverkauft — keine neue Fehlersemantik |
> | `create_order()` | `0028` | `check_violation`, in Pass 1, bevor irgendetwas geschrieben wird |
>
> **Die interne Datenhaltung ist davon nicht betroffen.** `shop_inventory.condition` und
> `order_lines.condition` behalten beide Werte, die Adminfunktionen zeigen beide, und historische
> Bestellungen bleiben korrekt als das lesbar, was verkauft wurde. Eingeschränkt ist der
> öffentliche V1-Kaufpfad, nicht das Datenmodell.

`public.shop_quantity_available(p_sky_id text, p_condition text, p_quantity integer)` →
`boolean`. `stable`, `security definer`, `set search_path = ''`, ausführbar für `anon` und
`authenticated`.

Sie beantwortet genau eine Frage: **wäre diese Menge dieses Artikels gerade kaufbar?** `true`
nur, wenn alles davon gilt:

| Bedingung | Woher |
|---|---|
| `1 ≤ p_quantity ≤ max_cart_quantity()` | Vernunftgrenze, kein Bestandswert |
| `i.condition = v1_sale_condition()` | V1 verkauft ausschließlich `loose` (`0028`) — `boxed` ergibt `false`, nicht einen Fehler |
| Position existiert mit genau dieser `condition` | `shop_inventory` |
| `is_listed` | Freigabe (ADR-0048) |
| `is_shop_eligible(sky_id)` | Katalogregel, **dieselbe Funktion** wie `shop_offers()` |
| `shop_price(...) is not null` | effektiver Preis (ADR-0045) |
| `available_quantity >= p_quantity` | `quantity - reserved`, die generierte Spalte aus `0003` |

**Keine Bestandszahl verlässt die Funktion.** Es gibt keine `returns table`, also auch keine
Spalte, in die eine Stückzahl je geraten könnte; `available_quantity` kommt genau einmal vor, auf
der rechten Seite eines Vergleichs. Ein `allowed_quantity`-Feld wurde geprüft und verworfen — es
wäre der Lagerbestand unter anderem Namen (docs/SECURITY.md).

`public.max_cart_quantity()` → `integer` (`immutable`) hält die Obergrenze **99** und spiegelt
`MAX_LINE_QUANTITY` aus `src/lib/cart/cart.ts`. `src/lib/shop/quantity.test.ts` liest beide Seiten
und schlägt fehl, wenn sie auseinanderlaufen — dieselbe Kopplung wie zwischen
`non_collectible_categories()` und `collectible.ts`.

**Sie reserviert nichts und schreibt nichts.** `reserved` wird gelesen, nie geschrieben; es gibt
weiterhin keine Bestellung, keinen Checkout und keine Reservierung (ADR-0043). Ein `true` heißt
„im Moment möglich", nie „für dich zurückgelegt": zwischen Antwort und Kauf kann sich der Bestand
ändern, und ein späterer Checkout muss erneut fragen — atomar, und dann tatsächlich reservierend.

> **Deployment-Reihenfolge, zwingend.** Der Anwendungscode ist *fail closed*: fehlt die Funktion,
> antwortet PostgREST mit `PGRST202`, die Server-Action liefert `unchecked`, und **jede** Erhöhung
> wird abgelehnt. Wird der Code vor der Migration deployt, kann niemand mehr etwas in den
> Warenkorb legen. Erst `0009` anwenden, dann deployen.

### 3.3k Commerce-Kern (Migration `0010`, ADR-0049 / ADR-0050)

> **Status: angewandt auf Production (2026-09-07) und verifiziert.** Rein additiv — keine bestehende
> Tabelle, Spalte oder Funktion wurde verändert. `npm run verify:commerce` meldet 30/30; Bestand,
> öffentliche Angebote und Sammlungssemantik sind unverändert (`verify:shop` 17/17,
> `verify:inventory` 34/34, `verify:rls` 105/105, Drift 0).
>
> **Nachtrag zu den Rechten:** `reservation_ttl()` und `next_order_number()` waren zunächst nur
> `from public` entzogen und dadurch für `anon` ausführbar — Supabase vergibt EXECUTE auf neue
> Funktionen zusätzlich **explizit** an `anon` und `authenticated`. Beide wurden produktiv
> nachgezogen; die Datei entspricht diesem Stand, sodass eine frische Datenbank dieselben Rechte
> erhält.

| Tabelle | Inhalt |
|---|---|
| `commerce_settings` | Eine Zeile: Missbrauchsgrenzen und das Salt für den Client-Fingerabdruck. Für keine Client-Rolle lesbar. |
| `orders` | Eine Bestellung. Zugleich die Checkout-Sitzung — es gibt bewusst keine `checkout_sessions`. |
| `order_lines` | Eingefrorener Positions-Snapshot (ADR-0033): Name, Bild, Einzelpreis, Zeilensumme. |
| `order_addresses` | Liefer- und optionale Rechnungsadresse, je eine Zeile pro `(order_id, kind)`. |
| `order_events` | Append-only-Historie: wer, wann, was. Kein Event Sourcing. |
| `order_reservations` | Was für eine Bestellung im Regal blockiert ist. |

**Zwei Zustandsachsen.** `payment_status` (`pending`, `paid`, `failed`, `expired`, `cancelled`,
`refunded`, `partially_refunded`) und `fulfillment_status` (`unfulfilled`, `preparing`, `shipped`,
`completed`, `cancelled`) als CHECK-Constraints, im Stil von `shop_inventory_condition_known`.
Widerruf, Retoure und Reklamation stehen in **keinem** der beiden.

**Bestellnummer.** `SI-2026-001000`, aus `order_number_seq` als Spalten-Default gesetzt, unique
und per Trigger unveränderlich. Lücken sind abgebrochene Checkouts. Rechnungsnummern bekommen
später eine **eigene** Sequenz.

**Kontolöschung.** `orders.user_id` ist `ON DELETE SET NULL`. Eine Bestellung ist ein Beleg mit
Aufbewahrungspflicht; `customer_email` trägt sie weiter. Dieselbe Regel wie
`inventory_movements.created_by`.

**Unveränderlichkeit.** Trigger weisen jedes `UPDATE`/`DELETE` auf `order_lines`,
`order_addresses` und `order_events` ab. Auf `orders` sind Nummer, Beträge, Währung, Kontaktadresse
und `placed_at` eingefroren; `user_id` darf **nur** auf `NULL` wechseln (das tut die
Fremdschlüssel-Aktion beim Löschen eines Kontos). `order_reservations` darf den Zustand wechseln,
aber nicht gelöscht werden.

**`order_events` hat seit `0020` genau eine Ausnahme — dieselbe wie `inventory_movements`.**
`actor_user_id` ist `ON DELETE SET NULL`, und diese Fremdschlüssel-Aktion **ist** ein `UPDATE`:
Der pauschale `deny_write()` hat sie mitverweigert und damit jedes Konto dauerhaft unlöschbar
gemacht, das je eine Bestellung aufgegeben (`placed`) oder versendet (`order_shipped`) hatte.
`prevent_order_event_change()` lässt den Vorgang durch, wenn `old.actor_user_id` gesetzt war,
`new.actor_user_id` NULL ist und `(id, order_id, event_type, actor_kind, payload, created_at)`
per `is not distinct from` identisch bleibt. `DELETE` bleibt ausnahmslos verweigert, ebenso
UUID → andere UUID, NULL → UUID und jede Änderung, die sich mit der Anonymisierung zusammen
einschmuggeln will. `order_lines` und `order_addresses` behalten `deny_write()` unverändert:
Beide tragen keine Kontoreferenz und können deshalb keine Löschung blockieren.

#### Funktionen

| Funktion | Rechte | Zweck |
|---|---|---|
| `reservation_ttl()` | niemand | 20 Minuten. Eine Definition, serverseitig. Entzogen für `public`, `anon` **und** `authenticated`. |
| `next_order_number()` | niemand | Spalten-Default, race-frei über eine Sequenz. `volatile` — ein Aufrufer könnte Nummern verbrauchen, deshalb ebenfalls für alle drei Rollen entzogen. |
| `create_order(request_id, email, items, address, shipping_method, payment_token)` | `anon`, `authenticated` | Der **einzige** Weg, eine Bestellung anzulegen. Liest Preise über `shop_price()`, Eignung über `is_shop_eligible()`, reserviert im selben Aufruf. Lehnt seit `0028` jede Position ab, deren Kondition nicht `v1_sale_condition()` ist — in Pass 1, bevor irgendetwas geschrieben wird. Idempotent über `request_id`. |
| `reserve_for_order(order_id)` | niemand | Alles oder nichts. Sperrt in aufsteigender `id`-Reihenfolge, räumt abgelaufenen Halt unter der Sperre, prüft Verfügbarkeit in der `WHERE`-Klausel. |
| `active_seller()` | niemand | Der eine aktive Verkäufer, **ganze Zeile** (`select s.*`) — deshalb für alle drei Rollen entzogen (ADR-0064). |
| `seller_public()` | `anon`, `authenticated` | **Identität, keine Relation.** Gibt `id` und `display_name` des aktiven Verkäufers zurück, sonst nichts — Allow-List, wörtlich benannt. Kontaktadresse, Reply-To, `updated_by` und Zeitstempel bleiben drin (`0027`). Aus der sichtbaren `id` folgt **nicht**, dass SkyIsles Multi-Seller kann: keine Tabelle trägt ein `seller_id`. |
| `release_expired_reservations(ids?)` | niemand | Gibt abgelaufenen Halt frei. Idempotent. `NULL` = alles (Zeitgeber), Array = die Positionen eines Checkouts. |
| `release_order_reservations(order_id)` | niemand | Gibt den Halt einer Bestellung frei. Idempotent. |
| `convert_order_reservations(order_id)` | niemand | Reservierung → Verkauf: senkt `reserved`, bucht `sale` über `apply_inventory_movement()` (bis `0025`: `sale_skyisles`, ADR-0065). Idempotent über den Reservierungszustand. **Wird von nichts gerufen** — die Zahlungsphase ruft sie. |

**`reserved` wird erstmals geschrieben.** Die Spalte existiert seit `0003` genau dafür, also
funktionieren `available_quantity` (generated), der partielle Index und der Guard in
`apply_inventory_movement()` ohne Änderung. `reservation_reconciliation` stellt `reserved` der
Summe aktiver Reservierungen gegenüber; `npm run verify:commerce` verlangt Drift 0.

**Reihenfolge beim Verkaufsabschluss:** erst `reserved` senken, dann buchen. Der Guard
`quantity + delta >= reserved` würde sonst bei einem Einzelstück an der eigenen Reservierung
scheitern.

#### Missbrauchsgrenzen

`enforce_checkout_limits()` läuft in `create_order()`, **bevor** irgendetwas geschrieben oder
gehalten wird. Sie zählt je Identität offene Checkouts (5), gehaltene Stückzahl (25) und
Bestellungen der letzten Stunde (10); die Werte stehen in `commerce_settings`. Eine Identität ist
Konto **oder** E-Mail **oder** `orders.client_hash` — eine einzelne Dimension ist zu leicht
gewechselt. Keine Zählertabelle, kein Zeitgeber: alles wird aus vorhandenem Zustand abgeleitet.

`request_client_hash()` liefert SHA-256 aus Aufrufer-Adresse und `client_salt`, oder `NULL`, wenn
keine Adresse vorliegt. **Keine rohe Adresse wird gespeichert.** Der Immutability-Trigger erlaubt
nur, `client_hash` zu löschen.

#### Invarianten werden laut verletzt, nicht still repariert

Freigabe und Konvertierung senken `reserved` mit `... where reserved >= reservation.quantity` und
werfen bei keinem Treffer `data_corrupted`; die Transaktion rollt vollständig zurück. Es gibt
deshalb keinen Zustand `converted` ohne Verkaufsbewegung und keinen Zustand `released` mit
unverändertem `reserved`. Ein früheres `greatest(0, …)` wurde entfernt: es hätte einen bereits
vorhandenen Datenfehler dauerhaft verborgen.

Nur eine **aktive** Reservierung konvertiert. Eine freigegebene wird nicht wiederbelebt; die
Konvertierung meldet dann eine kleinere Zahl als die Bestellung Positionen hat, und die
Zahlungsphase setzt `needs_resolution`, statt zu überverkaufen.

#### Steuermodell und Versand (Migration `0011`, B1)

`orders.tax_regime` hält als unveränderlichen Snapshot, welche Steuerregeln beim Kauf galten —
V1: `small_business_19` (Kleinunternehmerregelung, § 19 UStG). **Bewusst ein Regime und kein
Satz.** Ein `tax_rate = 0` hieße „steuerbarer Umsatz, mit 0 % besteuert"; § 19 heißt, dass die
Steuer nicht erhoben wird. Aus einem Nullsatz entstünde eine Rechnung mit einer 0,00-€-USt-Zeile
und ein Buchhaltungsexport mit einer Steuerspalte, die es nicht geben darf. Order-Level genügt:
§ 19 ist eine Eigenschaft des Verkäufers, nicht des Artikels.

Der Versand steht in vier Funktionen statt in einer Tabelle — zwei Methoden und eine Schwelle sind
eine Regel, keine Daten, und eine Preisänderung soll das Gewicht einer Migration haben:

| Funktion | Rechte | Zweck |
|---|---|---|
| `free_shipping_threshold()` | niemand | 75,00 €, gemessen an `items_subtotal` |
| `shipping_catalog()` | niemand | Hermes 5,49 € (Standard), DHL 6,49 € |
| `shipping_amount_for(code, subtotal)` | niemand | **Die** Berechnung. Wirft bei unbekannter Methode. |
| `shipping_quote(subtotal)` | `anon`, `authenticated` | Anzeigeprojektion für die Kasse. **`security definer`**, weil sie die drei internen Funktionen aufruft — als INVOKER scheiterte sie an deren Rechten. |

Angezeigter und berechneter Preis kommen aus derselben Funktion, können also nicht auseinanderlaufen.
`create_order()` nimmt eine Versandart entgegen und **keinen Betrag** — es gibt keinen Parameter,
in dem ein Preis mitgeschickt werden könnte. Lieferland wird auf `DE` geprüft, bevor irgendetwas
geschrieben wird. `shipping_method_code` und `_name` werden beide gespeichert: eine spätere
Umbenennung des Anbieters darf nicht umschreiben, was dem Kunden gezeigt wurde. Auch bei
kostenlosem Versand bleibt die Methode stehen — „Hermes, kostenlos" ist, was passiert ist;
„kostenlos" ist kein Anbieter.

Beides ist vom Immutability-Trigger erfasst.

**Nicht enthalten, bewusst:** Steuerfelder (Steuerberater), Provider-Felder (Anbieter offen),
`payment_attempts` (kommt mit dem Anbieter), Rechnungen, Widerruf, Retoure. `shipping_amount`
existiert und ist `0`, weil die Summe aus benannten Teilen bestehen muss.


### 3.3l Transaktionsmail — `business_settings` und `order_mail` (Migration `0019`, ADR-0059)

> **Achtung, Umbenennung:** `business_settings` heißt seit `0026` **`platform_settings`**, und
> `transactional_reply_to` ist dort entfallen (Abschnitt 3.3q folgend, ADR-0064). Dieser
> Abschnitt beschreibt den Stand von `0019`. Wer eine neue Migration schreibt, nimmt den
> heutigen Namen — genau diese Verwechslung hat `0040` beim ersten Anwenden zerbrochen.

Zwei Tabellen, die nichts miteinander zu tun haben außer dem Zeitpunkt ihrer Entstehung.

**`business_settings` — eine Zeile, die Unternehmensdaten hält.** Nicht „die Mailadresse", sondern
die zentrale Konfiguration, aus der später auch Impressum und AGB ihre Felder ziehen (ADR-0059).
Heute: `id`, `contact_email`, `transactional_reply_to`, `updated_at`, `updated_by`. RLS ist an,
und **jedes** Tabellenrecht ist `anon` und `authenticated` entzogen — ein Tabellen-Grant kennt
keine Spalten, und Steuer- oder interne Felder dürfen nicht dadurch öffentlich werden, dass später
eine Spalte dazukommt.

Öffentlich wird ausschließlich eine **ausdrücklich aufgezählte** Projektion:
`business_settings_public()` gibt genau `contact_email` zurück und sonst nichts. Sie ist heute
**niemandem** gewährt, weil es noch keine öffentliche Rechtsseite gibt, die sie bräuchte; die
Allow-List existiert trotzdem, damit die spätere Freigabe eine Zeile Grant ist und keine
Entscheidung darüber, welche Spalten eigentlich öffentlich sind. Rechtstexte selbst bleiben
versionierte Templates im Code, keine Datenbankzeilen.

Gepflegt wird über `admin_business_settings()` und `admin_set_business_contact()`, beide mit
`is_shop_admin()` im eigenen Rumpf.

**`order_mail` — der Zustellnachweis, ein Primärschlüssel `(order_id, kind)`.** Drei Arten:
`payment_confirmation`, `shipping_confirmation`, `resolution_alert`. Vier Zustände:

| Zustand | Bedeutung | erneut senden? |
|---|---|---|
| `sending` | beansprucht, Ausgang offen | erst nach Ablauf der Frist |
| `sent` | der Anbieter hat angenommen | **nie**, auch nicht mit `force` |
| `failed` | eindeutig fehlgeschlagen | ja |
| `unresolved` | Ausgang unbekannt (Timeout, Absturz, 409) | nur bewusst, im Admin sichtbar |

`sent_at` ist über einen CHECK an `state = 'sent'` gekoppelt, ein Trigger verbietet jeden Rückweg
aus `sent`, ein zweiter jedes `DELETE`. `claim_order_mail()` ist der einzige Weg in den Versand
und beantwortet in einem Aufruf, was zu tun ist: `claimed`, `already_sent`, `in_flight`,
`unresolved` oder `unknown_order`. `order_mail_grace()` (10 Minuten) entscheidet, wann ein
hängender Anspruch als unklar gilt — nicht als frei.

**Drei Schichten, die eine doppelte Mail verhindern**, bewusst unabhängig voneinander: die
Ereigniszuordnung im Webhook (ein wiederholt zugestelltes Stripe-Event bildet auf gar keine Mail
ab), der Primärschlüssel hier, und der `idempotencyKey` beim Anbieter. Der Anbieterschlüssel
deckt nur 24 Stunden ab — deshalb ist `sent` **hier** terminal und nicht dort.

`order_mail_payload()` stellt zusammen, was in einer Mail stehen darf, und lässt weg, was niemals
in ein Postfach gehört: kein `payment_token_hash`, kein `client_hash`, keine `request_id`, keine
interne ID, keine Stripe-Session. Eine Mail autorisiert nichts (ADR-0059).


### 3.3m Der Commerce-Modus — `commerce_settings.mode` und `commerce_testers` (Migration `0021`, ADR-0060)

Eine Spalte, eine kleine Tabelle, ein Prädikat.

| Werkzeug | Inhalt |
|---|---|
| `commerce_settings.mode` | `closed` · `sandbox` · `live`. CHECK, kein Enum. Default `closed`. |
| `commerce_testers(user_id)` | wer im Sandbox-Modus bestellen darf. Wie `shop_admins`, additiv. |
| `commerce_checkout_allowed()` | die eine Antwort: `live` = jeder · `sandbox` = angemeldeter Tester · sonst nein |

**Gastbestellung im Sandbox-Modus ist strukturell aus.** Ein Gast hat keine `user_id`, und
`is_commerce_tester_for(NULL)` ist falsch — es gibt keinen Zweig, der das anders beantwortet.

**Admin ist nicht automatisch Tester.** `is_commerce_tester()` liest ausschließlich
`commerce_testers`. Die beiden Listen sind verschieden und sollen es bleiben.

**Kein Rollensystem.** Dieselbe Form wie `shop_admins` seit ADR-0032: Tabelle mit `user_id`,
`is_…()`-Funktion, RLS an, jedes Tabellenrecht `anon` und `authenticated` entzogen. Keine
Hierarchie, keine Rolle, kein Feature-Flag-Framework.

**Durchsetzung liegt in der Datenbank.** `create_order()` fragt `commerce_checkout_allowed()` als
**allerersten** Ausdruck — vor den Formprüfungen, vor jeder Preisabfrage. Die Funktion ist über
PostgREST mit dem Anon-Key erreichbar; eine Prüfung in der Oberfläche wäre einen Request weit von
„übersprungen" entfernt. Die Ablehnung ist ein einziger Literaltext für alle drei Gründe: Ein
Aufrufer erfährt, dass er nicht bestellen darf, nicht warum.

Zwei weitere Stellen fragen noch einmal, jede ihre eigene Fassung:

| Funktion | Frage |
|---|---|
| `authorize_order_payment()` | gehört die Bestellung im Sandbox-Modus noch einem **aktuellen** Tester? |
| `start_payment_attempt()` | ist der Modus der Bestellung noch der aktuelle? |

Die erste bedeutet: Ein entzogenes Testerrecht stoppt auch Checkouts, die dieses Konto bereits
geöffnet hat.

**`commerce_access()` ist die einzige öffentliche Projektion** und gibt `may_checkout` plus einen
groben Grund (`open` · `testers_only` · `closed`) zurück — **nie den Modus selbst**. Dieselbe
Allow-List-Disziplin wie `business_settings_public()`.

#### `orders.commerce_mode` — die Kennzeichnung, die bleibt

Vom Immutability-Trigger eingefroren, **ohne Default**, beim Nachtragen wahrheitsgemäß auf
`sandbox` gesetzt: Es gab nie einen Live-Stripe-Schlüssel in irgendeinem Deployment.

Zwei Aufgaben in einer Spalte:

1. **Eine Testbestellung bleibt Jahre später als solche erkennbar** — auch nachdem der Shop live
   gegangen ist. Ein aus der *heutigen* Einstellung abgeleitetes Kennzeichen würde Geschichte
   umschreiben, sobald die Einstellung sich ändert.
2. **Sie ist die Zahlungsschranke.** Eine Sandbox-Bestellung wurde gegen Stripe im Testmodus
   kalkuliert; sie mit Live-Schlüsseln zu bezahlen wäre eine echte Abbuchung für einen Testkauf.

Dass die Spalte keinen Default hat, ist Absicht: `create_order()` ist der einzige Weg zu einer
Bestellung, und ein künftiger Pfad, der den Modus vergisst, soll laut scheitern statt plausibel
auszusehen.

#### Testbestand: echter Bestand, mit einem Knopf zurück

Ein Sandbox-Kauf läuft durch den echten Reservierungs- und Bewegungspfad — das ist der Zweck
einer Production-Sandbox — und senkt damit echten Bestand.
`admin_revert_sandbox_stock(order_number)` bucht für jede tatsächlich **konvertierte** Position
(nicht je Bestellzeile: eine späte Zahlung konvertiert weniger) eine `return`-Bewegung über
`apply_inventory_movement()`. Korrigiert wird durch neue Bewegungen, nie durch Bearbeiten
(ADR-0037). Die Funktion verweigert jede Bestellung, die nicht im Sandbox-Modus entstand, und ist
über das Order-Event `sandbox_stock_reverted` idempotent.

Solange `sandbox` gilt, kann ohnehin niemand sonst kaufen — ein vorübergehend falscher
verfügbarer Bestand schadet keinem echten Kunden.

#### Die Adminfunktionen

| Funktion | Zweck |
|---|---|
| `admin_commerce_state()` | Modus, Testerliste, Bestellungen je Modus |
| `admin_find_accounts(query)` | Konto **finden** — Präfix auf Benutzername oder Adresse, höchstens 10, mindestens 3 Zeichen |
| `admin_set_commerce_mode(mode)` | umschalten |
| `admin_set_commerce_tester(user_id, enabled, note)` | freischalten oder entziehen |
| `admin_revert_sandbox_stock(order_number)` | Testbestand zurückbuchen |

Alle fünf fragen `is_shop_admin()` im eigenen Rumpf. **Die Suche darf eine Adresse lesen, um ein
Konto zu finden; freigeschaltet wird die `user_id`.** `admin_set_commerce_tester()` nimmt nichts
anderes entgegen — eine Adresse identifiziert ein Konto, sie autorisiert keines (ADR-0032).

`admin_order()` und `admin_orders()` tragen den Modus mit, damit eine Testbestellung ohne
Quervergleich erkennbar ist.


### 3.3n Kontozustand — `cart_items` und `customer_contacts` (Migration `0022`, ADR-0061)

Zwei Tabellen, beide mit genau den vier Eigentümer-Policies, die `collection_items` seit `0001`
hat. Das ist der ganze Grund, warum es Tabellen sind: Dieses Schema hat **einen** Mechanismus für
„nur der Eigentümer", und das ist RLS über `auth.uid()`.

#### `cart_items` — der Warenkorb eines angemeldeten Kontos

Primärschlüssel `(user_id, sky_id, condition)` — dieselbe Zeilenidentität wie Lagerposition,
Angebot und Bestellzeile. `anon` bekommt **keinerlei** Recht: Ein Gast hat kein Konto, also auch
keine Zeile, die seine sein könnte. Gäste behalten den lokalen Warenkorb
(`localStorage["skyisles.cart.v2.guest"]`).

**Ein Warenkorb reserviert weiterhin nichts.** Keine Bewegung, kein `reserved`, kein Zugriff auf
`shop_inventory` — nur `create_order()` macht aus einer Absicht einen Halt (ADR-0043). Gespeichert
wird Identität, Menge und der Preis beim Hinzufügen; Name und Bild kommen beim Lesen aus dem
Katalog, damit „die Serverdaten gewinnen" auch über Geräte hinweg gilt.

`merge_guest_cart(jsonb)` faltet beim Anmelden einen Gastkorb hinein: Mengen **addieren** sich und
werden bei `max_cart_quantity()` gekappt. Die Regel liegt in SQL, damit zwei gleichzeitig
anmeldende Tabs nicht um eine falsche Zahl rennen können. Fehlerhafte Zeilen werden übersprungen,
nicht geworfen — das läuft während einer Anmeldung.

#### `customer_contacts` — gespeicherte Kontakt- und Lieferdaten

Eine Zeile je Konto, jedes Feld nullbar: Es ist ein halb ausgefülltes Formular, das jemand
speichern darf, keine abgeschlossene Bestellung. Bewusst **nicht** Spalten auf `profiles` — ein
Profil ist die öffentliche Hälfte einer Identität, dies ist eine Postanschrift, und eine Tabelle
hieße eine Policy für beide Empfindlichkeiten.

> **Die Bestelladresse bleibt ein Snapshot.** `order_addresses` schreibt `create_order()`, und der
> Append-only-Trigger aus `0010` friert sie ein. `customer_contacts` ist ein **Vorschlag für ein
> Formular**; eine Änderung dort kann eine bestehende Bestellung nicht umschreiben. `0022` fasst
> weder `create_order()` noch `order_addresses` noch den Trigger an.

#### Was ein Kunde über eigene Bestellungen lesen darf

| Funktion | Antwort |
|---|---|
| `my_orders(limit)` | die eigenen Bestellungen, ohne `client_hash`, `payment_token_hash`, `request_id` |
| `my_order(nummer)` | eine davon als Dokument, mit der **Adresse zum Bestellzeitpunkt** |
| `order_payment_state(nummer, token)` | zusätzlich `attempts` — daraus wird der Zahlungs-CTA abgeleitet |

Beide Erstere matchen auf `user_id`, niemals auf eine Adresse: Gastbestellungen erscheinen
deshalb nicht im Konto, sondern bleiben über ihre Capability erreichbar (ADR-0032). Funktionen
statt Tabellenlesen, weil ein Grant spaltenblind ist — dieselbe Begründung wie bei `shop_offers()`.


### 3.3o Sendungsnummer und Fulfillment sind zwei Zustände (Migration `0023`, ADR-0062)

`0018` hatte beide verschweißt — der CHECK verlangte eine versendete Bestellung, und
`orders_protect_fulfillment()` warf bei jeder Änderung außerhalb des Übergangs. Die Nummer war
damit nur im exakten Moment des Versands schreibbar und danach nie wieder.

| Zustand | Bedeutung | Regel |
|---|---|---|
| `fulfillment_status` | Ist es raus? | genau ein Übergang, unverändert bewacht |
| `tracking_number` | Welches Paket ist es? | frei setzbar, vor **und** nach dem Versand |

**`shipped_at` bleibt unbewegt.** Der Trigger setzt es beim Übergang aus der Serveruhr und pinnt
es sonst ausdrücklich auf den alten Wert — eine Korrektur der Nummer ist kein zweiter Versand.

`admin_set_tracking_number(nummer, referenz)` ist der Weg dorthin: Adminprüfung im eigenen Rumpf,
trimmt, verweigert über 64 Zeichen, schreibt **nur** `tracking_number` (`fulfillment_status` und
`shipped_at` kommen im UPDATE gar nicht vor) und legt ein `tracking_updated`-Event an. Eine
Nicht-Änderung schreibt nichts. Die Referenz selbst steht **nicht** in der Event-Nutzlast, nur ob
vorher/nachher eine da war und ob die Bestellung schon versendet war.

`admin_mark_order_shipped()` benutzt jetzt `coalesce(v_tracking, v_order.tracking_number)`: Ohne
Nummer zu versenden behält die bereits eingetragene, statt das gestern gekaufte Label wegzuwerfen.

**Kein Mailpfad.** `admin_set_tracking_number()` ruft `send-order-mail` nicht auf — dahinter lägen
ohnehin der Primärschlüssel von `order_mail` und die Endgültigkeit von `sent` (ADR-0059).

`admin_order()` und `my_order()` tragen zusätzlich `shipping_method_code`: Ein Trackinglink wird
aus dem Code des Versandkatalogs gebaut, nie aus dem Anzeigenamen, der umbenannt werden darf.


### 3.3p Test-Berechtigungen (Migration `0036`, ADR-0071)

Vier schmale Tabellen ersetzen „eine Tabelle je Testfunktion". Vollständige Sicherheitsbetrachtung
in `docs/SECURITY.md`; hier nur die Form.

| Tabelle | Zweck | Schlüssel |
|---|---|---|
| `testers` | dieses Konto ist ein benanntes Testkonto | `user_id` |
| `tester_features` | das Vokabular der Test-Berechtigungen | `key` (`commerce`, `performance_tracking`) |
| `tester_permissions` | dieses Konto darf dieses eine Ding | `(user_id, feature_key)` |
| `tester_permission_changes` | append-only Journal, wer wann was vergab | `id` |

`tester_permissions` hängt an `testers` (Kaskade), nicht an `auth.users`: „Tester entfernen" ist
**ein Delete**, und Konto, Sammlung, Bestellungen und Adminstatus bleiben unberührt. Das Vokabular
ist **Datum, nicht Schema** — eine neue Testfunktion ist ein `INSERT`, keine Migration.

Gelesen wird ausschließlich über `has_tester_permission(text)` (ohne User-Argument, also nur über
den Aufrufer) und `has_tester_permission_for(uuid, text)`. `is_commerce_tester()` und
`is_commerce_tester_for(uuid)` behalten Name, Signatur und Rechte und fragen intern das neue
Modell — an `commerce_checkout_allowed()`, der Bestellsichtbarkeit und `admin_commerce_state()`
ändert 0036 **keine Zeile**.

**`commerce_testers` bleibt als Spiegel stehen.** Seit 0036 liest es nichts mehr; geschrieben wird
es weiterhin bei jeder Änderung, damit eine Rücknahme von 0036 funktionierenden Commerce
wiederherstellt — auch für Tester, die erst danach hinzukamen. Die Autorität ist
`tester_permissions`. Eine spätere Migration entfernt den Spiegel.

---

### 3.3q `perf_navigations` — gemessene Navigationen (Migration `0037`, ADR-0072)

Wie lange eine Navigation auf dem Gerät eines **Testkontos** gedauert hat. Keine allgemeine
Nutzererfassung: geschrieben wird nur für Konten mit der Test-Berechtigung
`performance_tracking` aus 0036.

| Spalte | Typ | Regel |
|---|---|---|
| `run_id` | `uuid` | ein Messlauf = ein Browser-Tab, im `sessionStorage` erzeugt |
| `user_id` | `uuid` | **aus `auth.uid()`**, nie aus einem Parameter |
| `occurred_at` | `timestamptz` | Serverzeit |
| `from_route` / `to_route` | `text` | **Routenmuster**, CHECK `^/[A-Za-z0-9\[\]/_-]{0,63}$` |
| `interaction_to_visible_ms` | `integer` | A→C, die gefühlte Dauer · 0–600000 |
| `interaction_to_commit_ms` | `integer` | A→B, das Warten · 0–600000 |
| `commit_to_visible_ms` | `integer` | B→C, das Zeichnen · 0–600000 |
| `viewport_w` / `viewport_h` | `smallint` | Gerätegröße, gerundet · CHECK 0–10000 |
| `warm` | `boolean` | dieses Routenpaar kam im Lauf schon vor |
| `build_id` | `text` | Commit-SHA (12) der Vercel-Bereitstellung, sonst `dev` |
| `label` | `text` | frei gewählter Laufname, CHECK `^[a-z0-9][a-z0-9-]{0,39}$` |

**Es gibt keine Spalte für eine URL, einen Query-String, einen Suchbegriff, Formular- oder
Warenkorbinhalte, Tokens, IP oder User-Agent.** Das Schema ist die Zusage: es gibt nichts, wohin
man sie schriebe. `to_route` trägt `/skylanders/[slug]`, niemals `/skylanders/gold-fire-kraken`.

**Kein Client hat ein Recht auf der Tabelle** — RLS an, `revoke all from anon, authenticated`,
keine Policy. Auch der Tester liest seine eigenen Messungen nicht.

| Funktion | Gate | Zweck |
|---|---|---|
| `record_navigation(…)` | `has_tester_permission('performance_tracking')` | der einzige Schreibweg |
| `admin_perf_runs(int)` | `is_shop_admin()` | die letzten Läufe |
| `admin_perf_report(uuid, text)` | `is_shop_admin()` | p50/p75/p95 je Routenpaar, warm/kalt getrennt |
| `admin_prune_perf_navigations(int)` | `is_shop_admin()` | älter als *n* Tage löschen, **auf Zuruf, kein Scheduler** |

`record_navigation()` nimmt **kein** `p_user_id`: der Aufrufer kann nicht für ein fremdes Konto
schreiben.

**Die beiden `admin_perf_*`-Funktionen sind der Weg für einen Administrator mit Browsersitzung.**
`npm run perf:report:staging -- --latest` kann sie nicht rufen: der Service-Role-Key hat kein
`auth.uid()`, also ist `is_shop_admin()` dort `false`. Das Werkzeug liest `perf_navigations`
deshalb direkt mit dem Service-Role-Key — dieselbe Form wie `export-image-overrides.mts` und
`verify-shop.mts` — und gruppiert in `src/lib/perf/report.ts`. Strikt lesend, nur `select`.


---

### 3.3r `perf_interactions` — gemessene Interaktionen (Migration `0038`, ADR-0073)

Die wichtigste Geste im Katalog ist **keine Navigation**: eine Figur zu öffnen setzt React-State,
der Pfad ändert sich nie (ADR-0027), und 0037 konnte sie deshalb nicht sehen. Diese Tabelle misst
sie — wieder nur für Konten mit `performance_tracking`.

| Spalte | Typ | Regel |
|---|---|---|
| `run_id` | `uuid` | **derselbe Lauf** wie die Navigationen daneben |
| `user_id` | `uuid` | aus `auth.uid()`, nie aus einem Parameter |
| `route` | `text` | **wo** es passierte, Routenmuster · CHECK wie in 0037 |
| `interaction` | `text` | geschlossene Menge, CHECK `in ('quick_view_open')` |
| `interaction_to_visible_ms` | `integer` | A→C, der Dialog steht |
| `interaction_to_commit_ms` | `integer` | A→B, React |
| `commit_to_visible_ms` | `integer` | B→C, Paint |
| `content_visible_ms` | `integer` **nullable** | A→D, das Artwork ist zu sehen |
| `viewport_w` / `viewport_h` | `smallint` | CHECK 0–10000 |
| `warm` | `boolean` | dieser Schlüssel auf dieser Route kam im Lauf schon vor |
| `build_id` / `label` | `text` | wie in 0037 |

**`route` ist Singular.** Eine Interaktion hat einen Ort, keine Richtung; `from_route`/`to_route`
in `perf_navigations` bleiben dadurch unverändert Routen.

**`content_visible_ms` ist nullable, und null bleibt null.** Kein Bild, kein verlässliches
Browsersignal oder ein vorher geschlossener Dialog ergeben **nichts** — nie eine Null. Der Wert
darf zudem **kleiner** sein als `interaction_to_visible_ms`: ein bereits dekodiertes Bild war nie
das, worauf gewartet wurde. Der CHECK vergleicht die beiden absichtlich nicht.

**Keine Figuridentität.** Keine `sky_id`, kein Slug, kein Name, kein Bildpfad. `quick_view_open`
auf `/` sagt, dass ein Dialog aufging, nie welcher.

| Funktion | Gate | Zweck |
|---|---|---|
| `record_interaction(…)` | `has_tester_permission('performance_tracking')` | der einzige Schreibweg |
| `admin_perf_interactions(uuid, text)` | `is_shop_admin()` | Perzentile je Schlüssel/Route, warm/kalt getrennt |
| `admin_prune_perf_interactions(int)` | `is_shop_admin()` | auf Zuruf löschen, kein Scheduler |

`admin_perf_interactions()` zählt die Artwork-Messwerte (`content_samples`) und bildet die
Artwork-Perzentile nur über sie — `percentile_cont` ignoriert Nulls, und die Anzahl sagt, wie
belastbar die Zahl ist.

**Abhängigkeiten:** `auth.users` (0001), `is_shop_admin()` (0003), `has_tester_permission()`
(0036). **Nicht** `0035`.


---

### 3.3s Versand ist umkehrbar, die Serie wird ab jetzt mitgeschrieben (Migration `0039`, ADR-0074)

**`orders.fulfillment_status` kennt zwei Übergänge**, nicht mehr einen:

```
unfulfilled  ⇄  shipped
```

`preparing`, `completed` und `cancelled` bleiben im CHECK und bleiben gesperrt — sie haben keinen
Ablauf hinter sich. `orders_protect_fulfillment()` setzt `shipped_at` beim Versenden aus der
Serveruhr und **auf NULL** beim Zurücknehmen; außerhalb eines Übergangs kann es nicht wandern.

| Funktion | Gate | Wirkung |
|---|---|---|
| `admin_mark_order_shipped(text, text)` | `is_shop_admin()` | unverändert seit `0023` |
| `admin_unmark_order_shipped(text)` | `is_shop_admin()` | `shipped → unfulfilled`, `shipped_at = NULL` |

**Was das Zurücknehmen *nicht* anfasst:** Zahlung, Bestand, Reservierungen, Positionen, Beträge,
Sendungsnummer, Testbestellungsstatus, Stripe-Daten, Mail. Es schreibt **eine Spalte** und hängt
`order_unshipped` ans Journal. `orders_protect_immutable()` friert Identität und Beträge
weiterhin bei jedem Update ein.

**Die Sendungsnummer bleibt stehen.** Sie ist eine Tatsache über ein gekauftes Label, der Status
eine Auskunft an den Kunden; sie ist vor **und** nach dem Versand änderbar (seit `0023`) und wird
nur durch eine ausdrückliche Eingabe geleert. „Nicht versendet" neben einer Sendungsnummer ist
deshalb ein gültiger Zustand.

#### `order_lines.series_snapshot`

| | |
|---|---|
| Typ | `text`, **nullable** |
| CHECK | `series_snapshot is null or length(btrim(series_snapshot)) > 0` |
| Quelle | `series.label` über `skylanders.series_code`, **zum Zeitpunkt des INSERT** |
| Trigger | `order_lines_series_snapshot` → `order_lines_capture_series()`, `before insert` |

**Kein Backfill, nie.** Bestellungen vor `0039` bleiben NULL und der Admin zeigt „—". Die
historische Serie ist nicht wiederherstellbar — der einzige Weg wäre der heutige Katalog, und das
wäre eine Behauptung über die Vergangenheit, kein Snapshot (ADR-0033). Dass der Trigger nur bei
INSERT feuert, macht das strukturell: bestehende Zeilen werden nie besucht.

Der Trigger füllt nur, was der Aufrufer offen ließ, und lässt bei unauflösbarer `sky_id` NULL
stehen, statt eine Kasse an einem Anzeigefeld scheitern zu lassen. **`create_order()` wurde nicht
angefasst.**

`admin_order()` liefert zusätzlich `image` (aus `image_snapshot`, war nur in `my_order()`) und
`series`; `my_order()` zusätzlich `series`. Beide lesen ausschließlich aus `order_lines` — kein
Join auf `skylanders`, `categories` oder `series`.


---

### 3.3t Shop und Plattform sind getrennte Zuständigkeiten (Migration `0040`, ADR-0075)

**`sellers` bekommt die Identität**, die später im Impressum, auf Rechnungen und in der
Widerrufsbelehrung steht: `legal_name`, `trading_name`, `legal_form`, `street`, `postal_code`,
`city`, `country_code`, `phone`, `direct_contact`, `register_court`, `register_number`, `vat_id`,
`w_id`. **Alle NULL-bar, alle leer.** Es gibt keinen Seed: ein Platzhalter in einem
Impressumsfeld wäre eine falsche Aussage über eine echte Person. Ein CHECK je Spalte verbietet
zusätzlich den Leerstring.

**Kontakte.** `contact_email` bleibt maßgeblich. `withdrawal_contact_email` und
`complaints_contact_email` sind NULL-bar und heißen „keine eigene Adresse" — aufgelöst per
`coalesce`, **nie kopiert**. `admin_shop_settings()` liefert die aufgelösten Werte gleich mit, damit
die Regel genau einmal existiert.

**Richtlinien.** `small_business_19` (Vorgabe `true`, ein Regime und nie ein Satz — § 25a kommt
nicht vor), `dispute_participation` (Vorgabe `false`) mit `dispute_body`, gekoppelt durch einen
CHECK, `return_postage_borne_by` (`customer` | `seller`, Vorgabe `customer`), `dispatch_statement`
(NULL, bis eine Lieferzeit zugesagt werden kann).

**Plattform.** `platform_settings.support_email` — die Adresse von SkyIsles selbst. NULL, bis es
eine gibt; keine Adresse steht im Code. `contact_email` wird **nicht** umbenannt.

#### Versand ist Konfiguration

| | |
|---|---|
| `shipping_countries` | wohin geliefert wird · **nur `DE` befüllt** · öffentlich lesbar, weil das Kassenformular die Liste braucht |
| `shipping_methods` | Hermes 5,49 € · DHL 6,49 € · kein Clientrecht, der Weg dorthin ist `shipping_quote()` |
| `sellers.free_shipping_threshold` | `75.00` — auf dem **Verkäufer**, nicht auf dem Plattform-Singleton (ADR-0076) |

`shipping_catalog()` und `free_shipping_threshold()` behalten Signatur und Ergebnis und lesen jetzt
diese Tabellen — jeder Aufrufer bleibt unberührt. **`create_order()` fragt
`shipping_country_allowed()`** statt `country_code = 'DE'`; das ist die maßgebliche Prüfung, der
Client spiegelt nur. Die Funktion wurde maschinell aus `0028` übernommen und an genau einer Stelle
geändert.

| Funktion | Gate | Zweck |
|---|---|---|
| `shipping_country_allowed(text)` | öffentlich | liefert der Shop dorthin? |
| `admin_shop_settings()` | `is_shop_admin()` | alles, was der Einstellungsbildschirm braucht |
| `admin_set_seller_details(…)` | `is_shop_admin()` | Identität |
| `admin_set_shop_policies(…)` | `is_shop_admin()` | Kontakte, Steuern, Widerruf, Schwelle, Plattform-Support |
| `admin_set_shipping_country(…)` | `is_shop_admin()` | Land aktivieren/deaktivieren |
| `shop_setting_value(text, text)` | keinem Client | NULL lässt stehen, `''` löscht, sonst trimmen |

**Kein `seller_id`, kein zweiter Verkäufer, keine neue Rolle.** `sellers_one_active` gilt weiter.

#### Wem welches Datum gehört (ADR-0076)

| Bereich | Eigentümer | Wo |
|---|---|---|
| Kanonischer Katalog | **SkyIsles / ADMIN** | `skylanders`, `categories`, `series`, `catalog_editorial` — kein Clientrecht, nur `is_shop_admin()`-Funktionen |
| Sammlungsstand | **USER** | `collection_items`, nur der Eigentümer |
| Angebot, Bestand, Versand, Bestellabwicklung | **SHOP / Verkäufer** | `shop_inventory`, `sellers`, `shipping_*`, `orders` |
| Plattformangaben | **ADMIN** | `platform_settings` |

**Ein Verkäufer führt keinen eigenen Katalog.** `shop_inventory` hängt über `sky_id` am
kanonischen Eintrag und wiederholt keine Katalogspalte. Eine Korrektur durch den Admin wirkt
dadurch sofort für alle. Ein zweiter Verkäufer bekäme später ein `seller_id` auf `shop_inventory`
und `shipping_*` — additiv; die Katalogtabellen bleiben unberührt, weil sie nie verkäuferbezogen
waren.


---

### 3.3u Drei Konten (Migration `0041`, ADR-0077)

| Tabelle | Bedeutung |
|---|---|
| `platform_admins` | `user_id` — dieses Konto führt SkyIsles |
| `seller_operators` | `(seller_id, user_id, is_enabled, …)` — dieses Konto darf diesen Shop führen |

**USER ist die Abwesenheit beider Zeilen.** Kein Datensatz sagt „Sammler".

| Funktion | Antwortet auf |
|---|---|
| `is_platform_admin()` | führt SkyIsles |
| `can_operate_seller(bigint)` / `can_operate_active_seller()` | darf den Shop führen |
| `my_capabilities()` | beides, als ein Dokument für die Anwendung |
| `admin_seller_operators()` / `admin_set_seller_operator(uuid, boolean, text)` | Shopzugänge verwalten — **Plattform**-gated |
| `order_counts_as_placed(text)` | **die eine Definition einer echten Bestellung**: alles außer `'expired'`. `'cancelled'`/`'refunded'` zählen weiter — sie sind spätere Ereignisse. `0044`, ADR-0083 |
| `seller_year_to_date()` | Anzahl und **Bestellwert** der Live-Bestellungen, die seit 1. Januar (Berlin) **aufgegeben** wurden — Zahlung entscheidet nichts. **Verkäufer**-gated, `0044`, ADR-0081/0083 |
| `order_attention()` | die eine Definition der Aufmerksamkeitsstufe (0–3), `0045` |
| `seller_orders_active()` / `seller_orders_month()` / `seller_order_calendar()` | Bestellarchiv: aktuelles Fenster, ein Monat, Monatszählungen — **Verkäufer**-gated, `0045`, ADR-0082 |
| `seller_monthly_reports()` / `seller_report_years()` / `seller_finalize_monthly_report()` | Monatsberichte lesen, Jahre auflisten, einen Monat festschreiben — **Verkäufer**-gated, `0045`, ADR-0082 |
| `seller_open_order_counts()` | die drei Arbeitszahlen als Aggregat statt als Zeilenzählung — **Verkäufer**-gated, `0045`, live-only seit `0046` |
| `seller_test_orders()` / `seller_archive_test_orders(text[])` / `seller_restore_test_orders(text[])` | Testbestellungen lesen, wegräumen, zurückholen — **Verkäufer**-gated, `0046`, ADR-0084 |

**Die Rechtsschicht (`0047`, ADR-0086).** `legal_document_versions` hält die Fassungskennung je
Rechtstext (der **Text** steht in `src/lib/legal/`); ein Trigger kopiert sie bei jeder Bestellanlage
samt Verkäuferangaben nach `order_legal_snapshots`, damit eine historische Bestellung nie auf einen
späteren Text zeigt. **Ein Snapshot ist ab dem Schreiben unveränderlich:**
`order_legal_snapshots_protect_trg` weist jede Änderung und jede Löschung zurück — dieselbe
Sicherung wie bei `invoices`, aus demselben Grund: eine Aufzeichnung darüber, wem gegenüber welche
Bedingungen galten, ist wertlos, wenn sie später bearbeitet werden kann.

`withdrawal_requests` hält je Widerruf nach § 356a BGB Name, Kontaktadresse,
**Inhalt der Erklärung** und den **gesetzlich maßgeblichen Eingangszeitpunkt**; `order_refunds` hält
Erstattungen als eigene Ereignisse mit eigenem `occurred_at` (ADR-0083) — die erstattete Summe ist
die Summe der Zeilen, nie ein Status. `invoices` hält je bezahlter Bestellung **eine** Rechnung mit
kopierten Verkäufer-, Kunden- und Betragsangaben; ein Trigger weist jede Änderung und jede Löschung
zurück, und es wird **keine Datei gespeichert** — das PDF entsteht bei jedem Abruf.

**Die Quittung wird genau einmal versendet (`0049`).** `0047` hat das behauptet und nicht
getan: ein zweiter Aufruf versendete erneut und überschrieb `receipt_sent_at`. Der Zustand
`sending` und `claim_withdrawal_receipt()` ersetzen das — die Zustandsänderung **ist** die
Entscheidung, in einer Anweisung, sodass von zwei gleichzeitigen Aufrufen genau einer senden
darf. `receipt_sent_at` ist einmalig beschreibbar (`coalesce`), `sent` ist endgültig, beides
zusätzlich per Trigger `withdrawal_receipt_protect_trg` erzwungen, plus die CHECK-Invariante
`(receipt_state = 'sent') = (receipt_sent_at is not null)`. Ein tatsächlich fehlgeschlagener
Versand bleibt wiederholbar, und ein Anspruch, der älter als 15 Minuten ist, darf übernommen
werden — sonst bliebe eine Quittung liegen, wenn ein Sender mittendrin abstürzt.

`withdrawal_attempts` hält **nur** einen gesalzenen Fingerabdruck des Aufrufers und einen
Zeitstempel — keine Bestellnummer, keine E-Mail, keinen Namen. `receive_withdrawal()` schreibt die
Zeile, **bevor** feststeht, ob überhaupt etwas passt, und begrenzt auf 10 Versuche je gleitender
Stunde; Zeilen älter als zwei Stunden werden bei jedem Aufruf entfernt. Ein gedrosselter Aufruf
erhält **dieselbe** Antwort wie ein Nichttreffer (`accepted: true, delivered: false`) — „du wirst
gedrosselt" wäre selbst wieder ein verwertbares Signal. Begründung: ADR-0086.

`receive_withdrawal()` prüft `o.commerce_mode = commerce_mode()`, nicht `'live'` — dieselbe
Funktion, mit der `create_order()` stempelt. Auf Staging (Sandbox) ist der Pfad damit vollständig
prüfbar, auf Production (Live) bleibt eine historische Testbestellung ausgeschlossen.

Alle sechs Tabellen sind für jede Client-Rolle gesperrt; der Weg hinein sind die Funktionen
aus `0047`.

**Bestandsabgleich (`0048`, ADR-0087).** `inventory_imports` hält je Abgleich Datei, Speicherzeit
der Tabelle, einen **inhaltlichen** Fingerabdruck (`content_fingerprint`) und die Ergebniszahlen; `inventory_import_rows` **jede** gelesene Zeile, auch die
ignorierten — sonst ließe sich „warum hat sich das *nicht* geändert?" nicht beantworten;
`inventory_import_mappings` eine vom Betreiber einmal getroffene Zuordnung, nach Blatt und
normalisiertem Namen. Bestand wird **nicht** hier geschrieben: `seller_apply_import()` ruft
`record_inventory_movement()` mit Grund `correction` und erbt die Untergrenze aus `0003`. Eine
`IGNORED`-Zeile kann per CHECK kein Delta tragen.

**Die Zusammenfassung zählt seit `0050` den Zustand, den die Zeilen tragen.** `0048` filterte
auf `status = 'pending' and delta = 0` — eine Kombination, die `reconcile()` nie erzeugt, weil
delta 0 den Status `unchanged` bedeutet. Der Zähler war strukturell immer 0, und die reale
Arbeitsmappe meldete `559 unterstützt · 245 Erhöhungen · 7 Senkungen · 0 unverändert`, obwohl
307 Zeilen unverändert waren. Angewandter Bestand war nie betroffen — `seller_apply_import()`
liest diese Zähler nicht —, die Freigabeansicht schon. Es gilt jetzt
`supported = increases + decreases + unchanged + conflicts`.

**`content_fingerprint` ist kein Datei-Hash.** Er wird in `src/lib/import/fingerprint.ts` über die
*ausgelesenen Zeilen* gebildet — Version, Blatt, getrimmter Name, Storage-Zahl, sortiert —, nicht
über die 450 MB der Datei. Dieselbe Bestandsaufnahme ergibt denselben Wert, auch wenn die Mappe neu
gespeichert oder ein Bild ausgetauscht wurde; eine geänderte Storage-Zahl ergibt einen anderen.
Bewusst **vor** der Auflösung: keine SKY-ID, keine Klassifikation — die verschieben sich, wenn der
Katalog oder eine Zuordnung wächst, und das ist keine Änderung am Regal. Der Wert dient der
Historie und dem Wiedererkennen; er **blockiert keinen Import** (die Spalte ist `nullable`, und
kein Aufrufer verzweigt auf ihr). Ein erneuter Import derselben Aufnahme ist ohnehin folgenlos:
gegen ein absolutes Ziel abzugleichen ist idempotent.

**Bestellungen werden nie gelöscht** (ADR-0084). Jeder Fremdschlüssel auf `orders` ist
`ON DELETE RESTRICT`, `orders.user_id` ist `ON DELETE SET NULL`, Client-Rollen haben nur `select`,
und es existiert keine Löschfunktion. `orders.sandbox_archived_at` / `sandbox_archived_by` räumen
eine **Testbestellung** aus der Testliste — reine Sichtbarkeit, umkehrbar, ohne Wirkung auf Bestand,
Zahlung, Versand oder Beträge. Die CHECK-Constraint
`sandbox_archived_at is null or commerce_mode = 'sandbox'` macht diesen Zustand auf einer echten
Bestellung strukturell unmöglich. Seit `0046` lesen `admin_orders()`, `seller_orders_active()`,
`seller_orders_month()`, `seller_order_calendar()` und `seller_open_order_counts()` **nur**
`commerce_mode = 'live'`.

**`seller_monthly_reports`** (Tabelle, `0045`) hält je abgeschlossenem Kalendermonat **genau
einen** festgeschriebenen Bericht über die **Bestellungen dieses Monats**:
`order_count`, `order_value`, `merchandise_amount`, `shipping_amount`, `discount_amount`,
`paid_count`/`unpaid_count` (rein informativ, Stand bei Erstellung), `tax_regime` (als **Name**,
nicht als Satz) und `included_orders` (welche Bestellnummern gezählt wurden).

**Der Monat ist der Monat von `placed_at`** (Berliner Kalender) — nicht der der Zahlung, des
Versands oder der Erfüllung. Gezählt wird, was `order_counts_as_placed()` als echte Bestellung
anerkennt (alles außer `'expired'`); **Zahlung ist keine Bedingung**. Eine später eintreffende
Zahlung ändert einen geschriebenen Bericht nicht; eine spätere **Erstattung oder Stornierung**
gehört in den Monat, in dem sie stattfindet, und entfernt die Bestellung **nicht** aus ihrem
Bestellmonat (ADR-0083). Deshalb gibt es **keine Versionierung**: `unique (period_year,
period_month, commerce_mode)`.

**Keine** Spalte für Erstattung, Gebühr, Netto, Steuerbetrag oder Gewinn — diese Daten existieren
im System nicht (ADR-0082). Für jede Client-Rolle gesperrt, RLS aktiv, ohne Policy: der Weg hinein
sind die drei Funktionen.

**Kein Prädikat ruft das andere.** `is_shop_admin()` ist ein Alias auf `is_platform_admin()`.

**`seller_operators.seller_id` ist das einzige `seller_id` im Schema** und beantwortet „welches
Konto darf diesen Shop führen" — nicht „welchem Verkäufer gehört diese Bestellung". Bestellungen,
Bestand und Katalog bekommen keines (ADR-0076).

Kein Clientrecht auf beiden Tabellen, keine Policy. Entzug setzt `is_enabled = false`; die Zeile
bleibt, weil ein gewährter und wieder entzogener Zugang eine Tatsache ist.


---

### 3.3v Ein Konto, ein Typ (Migration `0042`, ADR-0078)

| Typ | Mitgliedschaft | Sammlung | Shop | Plattform |
|---|---|---|---|---|
| **USER** | keine | ja | nein | nein |
| **BUSINESS** | `seller_operators` aktiv | **nein** | ja | nein |
| **ADMIN** | `platform_admins` | **nein** | nein | ja |

Durchgesetzt durch zwei Trigger — `seller_operators_one_type` und `platform_admins_one_type` —,
die jeweils die andere Tabelle befragen. Beide sehen nur **aktive** Mitgliedschaft, damit
„entziehen, dann vergeben" möglich bleibt.

| Funktion | Zweck |
|---|---|
| `is_privileged_account(uuid)` | Business oder Admin — also **kein** privater Sammler |
| `is_collector_account()` | der Aufrufer ist ein privater Sammler |
| `admin_set_platform_admin(uuid, boolean, text)` | Adminrechte vergeben/entziehen, weist Shopbetreiber ab, schützt den letzten Admin |
| `my_capabilities()` | liefert zusätzlich `account_type`: `user` \| `business` \| `admin` |

`collection_items` verlangt in allen vier Policies zusätzlich `is_collector_account()` — auch beim
Lesen. **Keine Zeile wird beim Typwechsel gelöscht:** ein Entzug des Shopzugangs macht dieselbe
Sammlung unverändert wieder sichtbar.


### 3.3w Testvorgänge und Unvollständigkeit im Orderbuch (Migration `0063`, ADR-0090)

Das Orderbuch sortiert eine Zeile ab jetzt entlang **drei unabhängiger Achsen**. Keine davon
ersetzt eine andere, und keine wird in ein gemeinsames Enum gefaltet.

| Achse | Frage | Wo die Antwort liegt |
|---|---|---|
| **Kanal** | Intern oder extern verkauft? | `sales.order_id` — unverändert seit `0059` |
| **Einordnung** | Echter Geschäftsvorfall oder Testvorgang? | `is_test`, bzw. `orders.commerce_mode` |
| **Vollständigkeit** | Fehlt noch etwas? | **abgeleitet**, nirgends gespeichert |

#### `is_test` — zwei Spalten und eine Herleitung

```
purchases.is_test   boolean not null default false
sales.is_test       boolean not null default false
```

**Ein interner Verkauf trägt die Antwort nicht selbst.** Sie steht bereits in
`orders.commerce_mode` — beim Bestellen gesetzt und von `orders_protect_immutable()` danach
verweigert (`0021`), dieselbe Quelle, aus der die Bestellansichten seit `0046` Testbestellungen
aus der Livemenge halten. Eine Kopie auf `sales` wäre eine zweite Wahrheit über eine Bestellung,
also gibt es keine: `sales_internal_test_is_derived` hält die Spalte für interne Verkäufe fest
auf `false`, und

```sql
sale_is_test(p_sale_id) -- order_id is null ? sales.is_test : commerce_mode = 'sandbox'
```

ist die **einzige** Definition. `seller_sales()` und `seller_sale()` rufen sie auf, statt den
CASE zu wiederholen.

**Notiztext entscheidet zur Laufzeit nichts.** Die einzige Stelle, an der er überhaupt vorkommt,
ist die einmalige Datenkorrektur am Ende von `0063`, die genau zwei Staging-Zeilen über je vier
Felder gleichzeitig identifiziert (`id`, `source`, fehlender `import_fingerprint`, Notiz bzw.
externe Referenz). Kein Importer schreibt die Spalte; historische Zeilen bleiben damit normale
Geschäftsvorfälle.

#### `Unvollständig` — abgeleitet, damit es nicht veraltet

Es gibt **keine** Spalte `is_incomplete`. Ein gespeicherter Haken müsste gelöscht werden, sobald
jemand das fehlende Datum nachträgt — und genau das vergisst man. Die Lesemodelle
(`seller_orderbook_ledger()`, `seller_sales()`) rechnen ihn bei jedem Lesen aus:

| | Unvollständig genau dann, wenn |
|---|---|
| **Einkauf** | `purchased_at is null` · **oder** `source = 'manual'` und der Einkauf hat keine Position |
| **Verkauf extern** | `sold_at is null` · **oder** `source = 'manual'` und keine Position · **oder** `source = 'manual'` und Summe **und** Versand beide `0` (der Platzhalter, den `seller_create_sale()` schreibt) |
| **Verkauf intern** | die Bestellung ist nicht `paid` · **oder** sie hat kein `paid_at` · **oder** sie hat keine Position |

**Bewusst nicht unvollständig** — das ist laufendes Geschäft, kein Loch in den Unterlagen:
eine noch nicht gemeldete Auszahlung (`Auszahlung offen` ist ein eigener Filter) · eine noch
nicht eingebuchte Einkaufsposition · eine noch nicht ausgebuchte Verkaufsposition · leere
Notiz, Käufer, Referenz oder Land · ein **verdächtiges Jahr**. Der Verkauf vom 2028-06-28 aus
`Order 2026` bleibt unangetastet: `seller_set_sale_date()` prüft Plausibilität beim Schreiben,
und ein gespeichertes Datum nachträglich für falsch zu erklären, weil es seltsam aussieht, wäre
geraten.

**Historische Importe werden an keiner dieser Regeln außer dem Datum gemessen.** Die Positionen
einer importierten Zeile gehören der Arbeitsmappe, nicht dem Betreiber: auf diesen Bildschirmen
lässt sich keine hinzufügen. Eine importierte Gruppe ohne Positionen stünde also dauerhaft in einer
Arbeitsliste, ohne dass jemand sie abarbeiten könnte — deshalb tragen beide Positionsregeln
`source = 'manual'`. Was eine `#REF!`-Gruppe wirklich noch braucht, ist ihr Datum, und genau das
verlangt die Regel von ihr. (Auf Staging hat heute **jede** importierte Gruppe Positionen; die
Einschränkung ändert also keine bestehende Zeile, sondern verhindert eine spätere Flut.)

#### Lesen und Schreiben

`p_status` (`normal` | `incomplete` | `test` | `any`) kommt in beiden Ledger-Funktionen hinzu;
die Vorgängersignaturen werden gedroppt statt überladen. **`normal` ist der Default**, also
enthält die Geschäftsliste — und damit auch ihre Summe, die über genau die zurückgegebenen Zeilen
aggregiert — keine Testvorgänge. Dieselbe Antwort liefert zusätzlich `classification` mit den
Zählern aller drei Klassen, gebildet **vor** dem Einordnungsfilter und **nach** Jahr, Monat,
Bereich und Suche: `Test 1` heißt „einer in dieser Ansicht", nicht „einer in der Datenbank".

`any` ist aus der URL nicht erreichbar und existiert für die Jahresfilter, die ein Jahr auch dann
anbieten müssen, wenn dort nur Testzeilen liegen.

| Funktion | Zweck |
|---|---|
| `seller_create_purchase(date, numeric, text, boolean)` | wie bisher, plus `p_is_test` (Default `false`) |
| `seller_create_sale(text, date, text, text, text, text, boolean)` | ebenso |
| `seller_set_purchase_test(bigint, boolean)` | Einordnung nachträglich korrigieren |
| `seller_set_sale_test(bigint, boolean, timestamptz)` | ebenso; weist interne Verkäufe ab, prüft den Konflikt-Token aus `0062` und schreibt nach `orderbook_audit` |

Alle vier sind `security definer`, `set search_path = ''`, fragen
`can_operate_active_seller()` und sind von `anon` und `public` entzogen. Die beiden
Korrekturfunktionen nennen **eine** Spalte plus ihre eigenen Änderungsstempel — kein Betrag, kein
Kanal, kein Datum, keine Position, keine Provenienz, und nichts aus `inventory_movements`.
`0063` erwähnt Lagerbestand an keiner Stelle.


### 3.3x Figuren beim Anlegen, Korrekturen danach (Migration `0064`, ADR-0091)

`0064` schließt genau **zwei** Lücken im Einkaufs-Workflow. Alles andere war schon da und wird
nicht angefasst: `seller_add_purchase_item` (`0053`), `seller_set_purchase_item_sky` (`0054`)
und die Ablehnung eingebuchter Positionen durch beide plus den Fremdschlüssel.

#### Lücke 1 — Anlegen war keine einzelne Operation

Vorher: `seller_create_purchase`, danach je Figur ein `seller_add_purchase_item`. Jeder Aufruf
eine eigene Transaktion — bricht der fünfte ab, existiert ein Einkauf, dem eine Figur fehlt und
den niemand so angelegt hat.

```
seller_create_purchase_with_items(
  p_purchased_at date, p_total_cost numeric, p_note text default null,
  p_is_test boolean default false, p_items jsonb default '[]'::jsonb
) returns bigint
```

`p_items` ist **ein Element je physischem Stück**, niemals eine Menge:

```json
[{"sky_id": "SKY-0212"}, {"sky_id": "SKY-0212"}, {"raw_name": "Portal of Power"}]
```

Drei Wash Buckler sind drei Elemente, werden drei Zeilen und später drei einzelne Buchungen. Eine
`quantity`-Spalte wäre eine zweite Art zu sagen, wie viele es sind — und zwei Arten, dasselbe zu
sagen, widersprechen sich irgendwann. Die Gruppierung mit `− n +` existiert **nur im Browser**
(`src/lib/orderbook/draft.ts`) und wird beim Absenden wieder aufgelöst.

Die Funktion ist **dünn und delegiert**: sie ruft `seller_create_purchase` und je Element
`seller_add_purchase_item` auf, statt deren Prüfungen zu wiederholen. Ein plpgsql-Rumpf ist für
den Aufrufer eine einzige Anweisung — scheitert das dritte Element, verschwindet der Einkauf mit
ihm. Es gibt keine Teilanlage. Zwei Schranken: `p_items` muss ein JSON-Array sein, und mehr als
**200** Elemente auf einmal werden abgelehnt (dieselbe Zahl wie `MAX_DRAFT_UNITS` im Browser).

Ein Einkauf **ohne** Positionen bleibt erlaubt und gilt dann als `Unvollständig` (§3.3w).

#### Lücke 2 — Löschen schützte das Werkbuch nicht

`seller_remove_purchase_item` (`0053`) lehnte nur ab, was eine Lagerbewegung besitzt. Das war
damals die ganze Gefahr: kein Bildschirm bot Löschen an, und es gab nur handgemachte Positionen.
Beides gilt nicht mehr. Die Detailseite bietet jetzt `Entfernen`, und **2 114 der 2 115**
Positionen auf Staging sind abgeglichene Werkbuch-Zeilen mit `source_row` — Provenienz, die kein
Importer neu erzeugt, weil dieses Projekt nicht neu importiert. Sie haben `movement_id is null`
und waren damit einen Klick vom Verschwinden entfernt.

Die neu signierte Funktion lehnt zusätzlich ab, und fragt **dreifach**, damit kein einzelnes Feld
für immer richtig bleiben muss:

| Bedingung | Warum |
|---|---|
| `purchases.source <> 'manual'` | ein importierter Einkauf besitzt importierte Zeilen |
| `state = 'reconciled_legacy'` | der Zustand, den das Werkbuch selbst mitbringt |
| `source_row is not null` | die Zeilennummer aus der Tabelle |
| `legacy_booked_flag` / `legacy_condition_flag` gesetzt | die zwei Marker der alten Tabelle |

Auf Staging stimmen die drei exakt überein: 2 114 Positionen sind nach allen dreien historisch,
1 nach keiner. Die Prüfung auf `movement_id` bleibt **vorne** — „das liegt im Bestand" ist der
Satz, den der Betreiber zuerst braucht.

**Ausdrücklich weiter erlaubt: die Figurenzuordnung einer historischen Zeile zu korrigieren.**
Das ist `seller_set_purchase_item_sky` und der ganze Zweck von `0054` — ein Werkbuchname, der auf
die falsche SKY-ID zeigt, muss reparabel sein. Dabei ändert sich eine Einordnung, während Zeile,
Zeilennummer und Provenienz stehen bleiben. Das Löschen der Zeile ist die andere Handlung, und
nur die wird abgelehnt.

#### Was `0064` nicht tut

Keine Spalte, keine Tabelle, kein Backfill, keine Änderung an einer bestehenden Zeile. Kein RLS,
keine Policy, kein Tabellen-Grant. **Kein Lagerbestand** — `record_inventory_movement()`,
`shop_inventory` und `inventory_movements` kommen in keiner ausführbaren Anweisung der Datei vor.
Beide Funktionen sind `security definer`, `set search_path = ''`, fragen
`can_operate_active_seller()`, sind `public` und `anon` entzogen und nur `authenticated` gewährt.

#### Audit

Die Korrektur einer ungebuchten, handgemachten Position wird **nicht** protokolliert.
`orderbook_audit` (`0062`) ist verkaufsseitig — `sale_id` als Fremdschlüssel,
`entity_type in ('sale', 'sale_fee', 'sale_refund', 'sale_item', 'settlement_adjustment')` — und
auf der Einkaufsseite existiert keine Audit-Architektur. Eine anzulegen, um das Entfernen einer
Zeile festzuhalten, die noch nie Geld, Bestand oder Werkbuch berührt hat, wäre mehr Apparat als
Aussage. Was Provenienz **hat**, ist stattdessen gar nicht erst löschbar (Lücke 2), und was
Bestand berührt hat, wird über `seller_unbook_purchase_item` mit einer Gegenbewegung
zurückgenommen statt gelöscht.


### 3.3y Externer Verkauf: Vorlage, Gebühren, Auszahlung (Migration `0065`, ADR-0092)

#### Die Vorlage ist Layout — es gibt kein eBay-Datenmodell

`Vorlage: eBay` entscheidet, welche Felder das Formular zeigt, wie sie heißen und mit welchen
Gebührenzeilen es startet. Gespeichert wird ausschließlich in dem, was seit `0059` existiert:

| Im Formular | Landet in |
|---|---|
| Verkauf (Artikelpreis) | `sales.items_subtotal` |
| Versand (vom Käufer bezahlt) | `sales.shipping_charged` |
| Rabatt | `sales.discount_amount` |
| eBay-Gebühr | `sale_fees` · `kind = 'marketplace'` · `settled_by = 'channel'` |
| Versandkosten (Label), über eBay gekauft | `sale_fees` · `kind = 'shipping_label'` · `settled_by = 'channel'` |
| Versandkosten (Label), selbst bezahlt | `sale_fees` · `kind = 'shipping_label'` · `settled_by = 'external'` |
| weitere Gebühr | `sale_fees` · `kind = 'other'` · mit `label` (Pflicht) |
| Gutschrift / Korrektur | `settlement_adjustments.amount`, **vorzeichenbehaftet** |
| Tatsächliche Auszahlung | `sales.reported_payout_amount` / `_ref` / `_at` |
| Figuren | je Stück eine Zeile in `sale_items` |

**Keine `ebay_fee`-Spalte, keine eBay-Tabelle, kein eBay-Zweig in einer Query.** Das bestehende
Modell trägt den Fall bereits: auf Staging liegen 820 Gebührenzeilen in vier
`kind`/`settled_by`-Kombinationen, 282 Verkäufe haben mehr als eine Gebühr, einer hat vier.

#### `settled_by` ist das Feld, das über die Auszahlung entscheidet

Es ist die ganze Unterscheidung, die das Arbeitsbuch als zwei Spalten führte — `lbl eBay` (Y) und
`lbl ext` (Z). Ein über den Kanal abgerechnetes Label mindert die Auszahlung, ein am Schalter
gekauftes nicht. **Beides ist echtes Geld**, aber nur eines ändert, was eBay überweist. Deshalb
fragt die Oberfläche danach, statt nur eine Zahl entgegenzunehmen.

#### Eine Formel, drei Aufrufer

```
U + V − W − AD − (X + AA + Y) + AB
```

| Aufrufer | Funktion | Wann |
|---|---|---|
| historischer Import | `plannedPayout()` (TS) | Vorschau, bevor es den Verkauf gibt |
| Anlegen-Formular | `plannedPayout()` über `payoutView()` | live, bevor es den Verkauf gibt |
| Detailseite und Hauptbuch | `sale_expected_payout()` (SQL) | sobald der Verkauf existiert |

`plannedPayout` ist in `0065` von `sales-import.ts` nach `sales-money.ts` **umgezogen**, nicht
kopiert: das Anlegen-Formular kann den xlsx-Reader nicht importieren, und zwei Formeln wären zwei
Antworten auf eine Frage. `sales-import.ts` re-exportiert sie, damit jeder bestehende Aufrufer
unverändert weiterläuft. **Sobald der Verkauf existiert, ist die Datenbank die Autorität** — die
Detailseite rechnet nicht nach, und ein Test hält das fest.

#### `seller_create_sale_with_details` — der Verkauf entsteht als Ganzes

Vorher: `seller_create_sale`, dann ein zweiter Aufruf für die Beträge, danach Gebühren und
Auszahlung in „Details". Drei Transaktionen, und ein Abbruch dazwischen hinterlässt einen Verkauf,
dessen Geld halb erfasst ist — und dessen Auszahlungsabgleich damit gegen eine falsche Zahl
vergleicht.

Die Funktion ist **dünn und delegiert** an `seller_create_sale`, `seller_add_sale_item`,
`seller_add_sale_fee`, `seller_add_settlement_adjustment` und `seller_set_sale_payout`. Ein
plpgsql-Rumpf ist für den Aufrufer eine einzige Anweisung: scheitert die dritte Gebühr,
verschwindet der ganze Verkauf. Schranken: Arrays, höchstens 200 Positionen und je 20 Gebühren
und Korrekturen.

**Die drei Beträge werden direkt gesetzt, nicht über `seller_update_sale`** — eine
Audit-Entscheidung. `seller_create_sale` schreibt 0/0/0 als Platzhalter; die echten Zahlen durch
die auditierte Update-Funktion zu schicken, würde acht `orderbook_audit`-Zeilen erzeugen, die
behaupten, der Verkauf sei Sekunden nach seiner Entstehung *korrigiert* worden. `orderbook_audit`
hält fest, was sich **nach** Anlage oder Import geändert hat; das Anlegen muss draußen bleiben,
damit der Satz etwas bedeutet. Die gemeldete Auszahlung wird dagegen **schon** auditiert: sie
kommt von außen, und wann sie zuerst eingetragen wurde, ist eine Information.

#### Anlegen ≠ Ausbuchen

`0065` nennt `record_inventory_movement`, `shop_inventory` und `inventory_movements` in keiner
ausführbaren Anweisung. Ein Verkauf mit zehn Figuren erzeugt **null** Lagerbewegungen. Jede
physische Figur wird einzeln über `seller_book_sale_item` ausgebucht, und das schreibt genau eine
kanonische `sale_external`-Bewegung mit `delta = −1` (unverändert seit `0059`).

#### Positionen korrigieren

| | ungebucht, handgemacht | ungebucht, historisch | ausgebucht | intern |
|---|---|---|---|---|
| Figur ändern (`seller_set_sale_item_sky`, neu) | ja | **nein** | nein | nein |
| Entfernen (`seller_remove_sale_item`, verschärft) | ja | **nein** | nein | nein |

`seller_remove_sale_item` prüfte bis `0065` nur `movement_id` — derselbe Mangel, den `0064` auf
der Einkaufsseite behoben hat. **1 253 der 1 257** Verkaufspositionen sind importierte Historie
mit `source_row` und beiden Legacy-Markern, und Historie bewegt nie Bestand (erzwungen durch
`sale_items_no_historical_movement()`), also hat jede einzelne `movement_id is null`. Die
Oberfläche blendete den Knopf aus; die Funktion ist die Grenze.

**Warum enger als auf der Einkaufsseite.** `0054` erlaubt ausdrücklich, eine historische
*Einkaufs*-Position umzuzuordnen — dafür wurde sie gebaut. Für Verkäufe gab es das nie, die
Bildschirme haben es nie angeboten, und diesen Kurationsweg hier zu erfinden wäre Umfang, den
niemand verlangt hat. Beide Korrekturen schreiben nach `orderbook_audit` (`sale_item`).


### 3.3z `Offen` — vierte Achse, abgeleitet (Migration `0066`, ADR-0093)

`Unvollständig` heißt: am **Datensatz** fehlt etwas. `Offen` heißt: der Datensatz ist in Ordnung
und eine **physische Buchung** steht noch aus. Unabhängig voneinander und von Kanal und Test.

| Achse | Frage | Quelle |
|---|---|---|
| Kanal | intern oder extern? | `sales.order_id` (`0059`) |
| Einordnung | Test? | `is_test` / `orders.commerce_mode` (`0063`) |
| Vollständigkeit | fehlt etwas? | abgeleitet (`0063`) |
| **Aktion** | **ist noch etwas zu tun?** | **abgeleitet (`0066`)** |

```sql
-- Einkaufsposition offen
movement_id is null and sky_id is not null and state in ('ordered', 'arrived')

-- Verkaufsposition offen
order_id is null and source <> 'excel_order_2026'
  and movement_id is null and sky_id is not null
```

Ein Vorgang ist offen, sobald **eine** Position offen ist. `seller_orderbook_ledger` und
`seller_sales` liefern `is_open` je Zeile und `classification.open`; `p_status` akzeptiert
zusätzlich `open`. Beide Signaturen bleiben unverändert, also bleibt jeder Aufrufer unberührt.

**Die Regel ist wörtlich die der Buchungsfunktion.** `seller_book_purchase_item` lehnt
`reconciled_legacy` ab, `seller_book_sale_item` lehnt `excel_order_2026` ab — historische
Positionen sind deshalb **nie** offen, auch wenn das Arbeitsbuch sie in Spalte D bzw. L als
ungebucht markiert (111 bzw. 240 Zeilen). Ein Filter, der eine Aktion verspricht, die die
Datenbank verweigert, wäre schlechter als einer, der schweigt; die Begründung und die gemessenen
Zahlen stehen in ADR-0093. `sky_id is null` ist aus demselben Grund nie offen: ein Portal lässt
sich nicht einbuchen.


### 3.3aa Einkauf: wieder offen, und ein Ende ohne Lagerbewegung (Migrationen `0067`–`0070`, ADR-0099)

**`0067` — fünf historische Einkäufe sind wieder offen.** 109 Positionen aus fünf über
`import_fingerprint` benannten Einkäufen stehen auf `ordered`: bezahlte Ware, die zum
Importzeitpunkt noch unterwegs war. Die übrigen 2 005 der 2 114 bleiben `reconciled_legacy`.
**Kein Bestand, keine Bewegung** — `movement_id` bleibt NULL; der Block misst Bestandssumme und
Bewegungszahl vorher und rollt zurück, sobald sich eine der beiden ändert. Idempotent: ein
zweiter Lauf erkennt den Zielzustand und tut nichts.

**`0068` — „offen" heißt nicht „hat eine `sky_id`".** `is_open` im Einkaufsledger verlangt
nicht mehr `sky_id is not null`. Eine Position ohne Katalogbezug — Porto, Zubehör, Sammelposten
— ist eine echte offene Aufgabe; sie zu verstecken, weil ihr das Regal fehlt, verschweigt
Arbeit. Drei der 109 sind genau das. Das ergänzt 3.3z: dort ist `sky_id is null` „nie offen",
weil sich ein Portal nicht **einbuchen** lässt — richtig für das Einbuchen, falsch für das
Offensein.

**`0069` — `settled` als Ende ohne Lagerbewegung.** `purchase_items.state` kennt zusätzlich
`settled`, und `seller_set_purchase_item_state` vergibt es **nur** ohne Katalogbezug:

```sql
if p_state = 'settled' and v_sky is not null then
  raise exception 'a catalog figure leaves the purchase by being booked' ...
```

Die Sperre sitzt in der Funktion, nicht nur in der Oberfläche: auch ein direkter RPC-Aufruf
kommt nicht daran vorbei. Eine Katalogfigur verlässt den Einkauf ausschließlich durch
Einbuchen — sonst wäre `settled` ein stiller Weg, Bestand verschwinden zu lassen.

**`0070` — der Ledger zählt die Enden getrennt.** `seller_orderbook_ledger` liefert zusätzlich
`settled_count`, und `open_count = item_count − booked_count − settled_count`. `settled_count`
wird **nirgends** zu `booked_count` addiert: *gebucht* heißt, es gibt eine Bewegung, *erledigt*
heißt, es gibt keine und wird auch keine geben.


### 3.3ab Verkauf: Freigabe, vier Enden, und was eine Bewegung belegt (Migrationen `0071`–`0075`, ADR-0099)

**`0071` — drei Spalten und eine einmalige, namentliche Freigabe.** Neu sind
`sales.cancelled_at`, `sales.stock_released_at` und `sale_items.settled_at`. 21 historische
Verkäufe bekommen `stock_released_at` **und** `shipped_at`, einer `cancelled_at`. Ihre 197
Positionen bleiben unberührt: `movement_id` NULL, keine Bewegung. `stock_released_at` ist die
Ausnahme von der Regel „historische Verkäufe bewegen kein Lager" — sie gilt **pro Bestellung**,
wird von Hand erteilt und nie abgeleitet. Für die 270 übrigen Arbeitsbuch-Verkäufe bleibt die
Sperre unverändert bestehen.

**`0072` und `0075` — der Status wird abgeleitet, nie gespeichert.** `0072` gibt `seller_sales`
ein `is_open` und erste Endungszähler; `0075` korrigiert deren Bedeutung, nachdem sich zeigte,
dass „hat eine Bewegung" eine zurückgekommene Figur fälschlich als erledigt zählt. Endgültig:

```
outbooked_count    Bewegung vorhanden, keine Retoure angekündigt und keine eingetroffen
restocked_count    echte `return`-Bewegung vorhanden
settled_count      ohne Bewegung geschlossen (0071/0073)
not_shipped_count  nie verschickt, also nie gebucht (0074)
closed_count       eines dieser vier
open_count         item_count − closed_count
```

`sale_item_is_closed(public.sale_items)` ist das **eine** Prädikat, das `is_open` und
`closed_count` gemeinsam benutzen — damit die beiden nicht auseinanderlaufen können. Eine
Position mit angekündigter **oder** eingetroffener Retoure ist ausdrücklich **nicht**
geschlossen: jemand muss sie noch einlagern.

**`0073` — was ausgebucht werden darf, und was nur abgeschlossen.**

```
Ausbuchen  (erzeugt eine Bewegung)   Katalogfigur, die tatsächlich vom Regal kam
Erledigt   (erzeugt nie eine)        sky_id IS NULL  oder  legacy_stock_flag = '-'
```

`legacy_stock_flag = '-'` ist Spalte L des Arbeitsbuchs: verschickt, aber **nie dem Lager
entnommen**. Das Merkmal ist Provenienz — vom Import geschrieben, von keinem RPC setzbar —,
deshalb lässt es sich nicht zu einer allgemeinen Tür ausweiten. Dasselbe Merkmal **verbietet**
seit `0073` auch das Ausbuchen, eine solche Position hat also genau ein Ende. In Production gibt
es genau eine solche Position: `Terrafin S2`, SKY-0181.

`seller_book_sale_item` verweigert damit: internen Verkauf · stornierte Bestellung ·
Arbeitsbuch-Verkauf ohne `stock_released_at` · bereits ohne Bewegung geschlossene Position ·
Nicht-Katalogartikel · `legacy_stock_flag = '-'`.

**`0074` — zwei Enden, die vorher nicht ausdrückbar waren.**

| Spalte | Bedeutung | erlaubt, solange |
|---|---|---|
| `not_shipped_at` | Das Paket ging raus, dieses Stück nicht — ausverkauft, beschädigt, erstattet. Es hat das Regal nie verlassen. | `movement_id is null` |
| `return_announced_at` | Für eine **ausgebuchte** Position ist eine Retoure angekündigt. Die Ware ist noch nicht da. | `movement_id is not null` |

Drei CHECK-Constraints als Boden unter den Funktionen: `sale_items_not_shipped_has_no_movement`,
`sale_items_return_needs_a_movement` und `sale_items_one_ending_without_movement` — `settled_at`
und `not_shipped_at` schließen einander aus, weil sie zwei verschiedene Erklärungen derselben
Position wären.


### 3.3ac Smoke-Verkäufe tragen `is_test` (Migration `0076`)

Zwei von Hand erzeugte Verkäufe auf Staging (`SMOKE-1`, `UIFLOW-1`) waren nie als Testvorgang
markiert und zählten deshalb in Geschäftssummen mit. `0076` setzt `is_test = true` — es
**löscht sie nicht**: beide besitzen echte Bewegungen (`sale_external` −1 und `return` +1, die
sich aufheben), und `inventory_movements` ist append-only mit `on delete restrict`. Ein Flag
ändert nichts Physisches und nimmt sie zugleich aus den Zahlen.

Erkannt werden sie an dem, was sie **sind** — manueller Verkauf, ohne Bestellung, ohne
Fingerabdruck, noch nicht markiert, mit einer der beiden Referenzen —, nicht an ihrer ID. In
Production gibt es sie nicht; dort findet der Block 0 Treffer, meldet das per `notice` und
beendet sich, statt zu scheitern.


### 3.3ad Fachlicher Status und echte Lagerbewegung sind zwei Dinge

Die Trennung, die den ganzen Block trägt (ADR-0099). **Nur die drei fett gesetzten Felder sind
Belege einer Bewegung** — alle anderen beschreiben ausschließlich den Vorgang:

| Feld | Aussage | Bewegung? |
|---|---|---|
| `purchase_items.state = 'ordered'` | bestellt, unterwegs | nein |
| `purchase_items.state = 'settled'` | erledigt, ohne Lagerbezug | nein, nie |
| **`purchase_items.movement_id`** | **eingebucht** | ja, genau eine |
| `sales.shipped_at` | das Paket ist raus | nein |
| `sales.stock_released_at` | Ausbuchen ist für diese Bestellung freigegeben | nein |
| `sales.cancelled_at` | storniert | nein |
| `sale_items.settled_at` | geschlossen, ohne Lagerbezug | nein, nie |
| `sale_items.not_shipped_at` | nie verschickt | nein, nie |
| `sale_items.return_announced_at` | Retoure unterwegs | nein |
| `sale_items.returned_at` | physisch zurück, noch nicht eingelagert | nein |
| **`sale_items.movement_id`** | **ausgebucht** | ja, genau eine (`sale_external`, −1) |
| **`sale_items.return_movement_id`** | **wieder eingelagert** | ja, genau eine (`return`, +1) |

Ein Vorgang kann also vollständig abgeschlossen sein, ohne dass sich im Lager irgendetwas
bewegt hat — und umgekehrt bleibt jede Bewegung durch genau eine `movement_id` belegt. Keine
der Migrationen `0067`–`0076` erzeugt beim Anwenden eine Bewegung; `record_inventory_movement`
kommt im ganzen Satz einmal vor, im **Rumpf** von `seller_book_sale_item`, und läuft erst, wenn
jemand später *Ausbuchen* drückt.


### 3.3ae Die Zahlungswelt gehört dem Aufrufer, nicht dem Shop (Migration `0077`, ADR-0100)

Bis `0021` war die Zahlungswelt eine Eigenschaft des **Shops**: ein
`commerce_settings.mode` für alle, ein Stripe-Schlüssel pro Deployment. Seit `0077` ist sie eine
Eigenschaft des **Aufrufers**, abgeleitet aus zwei Tatsachen, die er nicht beeinflussen kann:

| Shop-Schalter | Konto | Welt |
|---|---|---|
| `live` | normal | **live** |
| `live` | Tester | **sandbox** |
| `sandbox` / `closed` | normal | **keine Zahlung** |
| `sandbox` / `closed` | Tester | **sandbox** |

**Die Invariante: ein Tester ist immer in der Sandbox.** Es gibt keinen Schalter, Parameter und
Codepfad, der ihn nach `live` bringt. In `payment_mode_for_user()` steht der Testerzweig als
erster Zweig eines `case` und kehrt bedingungslos zurück — die Reihenfolge *ist* die Regel.

```sql
payment_mode_for_user(uuid)  -- 'sandbox' | 'live' | NULL
effective_payment_mode()     -- dasselbe für auth.uid()
```

`NULL` heißt „keine Zahlung möglich" und ist **nie** ein Rückfall auf etwas anderes. Jeder
Aufrufer behandelt `NULL` als Verweigerung.

**Der Shop-Schalter steuert nur noch normale Konten.** `commerce_settings.mode` behält seine drei
Werte und seine Bedeutung für Kundschaft — nur `live` lässt ein normales Konto zahlen —, hat aber
über Tester keine Aussage mehr. Genau das erlaubt, Production mit Testkonten vollständig
durchzuspielen, während echtes Bezahlen für Kundschaft noch aus ist.

**Der Stempel gehört der Datenbank.** `orders_stamp_payment_mode_trg` ist ein BEFORE-INSERT-Trigger
auf `orders`, der `commerce_mode` aus der Regel setzt und **überschreibt, was das INSERT trug**;
ohne Welt wird die Bestellung gar nicht erst angelegt. `create_order()` bleibt unangetastet, seine
Torprüfung fragt weiterhin `commerce_checkout_allowed()` — das jetzt `effective_payment_mode() is
not null` ist.

**Verglichen wird gegen die Berechtigung des Eigentümers, nicht gegen den Shop-Schalter.**
`authorize_order_payment()`, `order_payment_mode()` und `start_payment_attempt()` fordern
übereinstimmend `o.commerce_mode = payment_mode_for_user(o.user_id)`. Daraus folgt beides, was
gebraucht wird:

- Die Sandbox-Bestellung eines Testers bleibt zahlbar, auch nachdem der Shop live gegangen ist.
- Eine **alte** Sandbox-Bestellung eines Nicht-Testers wird dadurch **nicht** live, sondern
  unbezahlbar — die sichere Hälfte dieser Wahl. Kein bestehender Vorgang wird umgedeutet.

**Für die beiden Edge Functions** gibt es zwei Lesefunktionen: `order_payment_mode(order_id)`
sagt `create-payment`, welchen Stripe-Schlüssel eine Bestellung verlangt, und
`payment_attempt_mode(provider, payment_id)` sagt dem Webhook, in welcher Welt der Vorgang liegt,
den ein Event nennt — damit ein Sandbox-Event nachweislich keinen Live-Vorgang verändern kann.

**Keine Lagerbewegung.** `0077` legt vier Funktionen, einen Trigger und zwei Lesefunktionen an und
schreibt keine einzige Zeile Bestand.

### 3.3af Der interne Verkaufstrigger konnte nie feuern (Migration `0078`)

`orders_register_sale()` aus `0059` schreibt eine Orderbuch-Verkaufszeile, sobald eine
Bestellung bezahlt ist. Sein INSERT füllte `sales.created_by` mit `new.id * 0 + null` —
`new.id` ist `orders.id`, also **bigint**, und `sales.created_by` ist `uuid` mit Fremdschlüssel
auf `auth.users`. PostgreSQL verweigert das:

```
42804  column "created_by" is of type uuid but expression is of type bigint
```

Der **Wert** war nie falsch (`x * 0 + null` ist für jedes x null), nur sein **Typ**. `0078`
schreibt dieselbe Aussage als schlichtes `null`. Das ist kein Cast über einen falschen Wert und
erfindet keinen Akteur: Der Trigger läuft aus einem Provider-Webhook als Service-Role und hat
kein `auth.uid()` — es gibt hier keinen Menschen, und alle bestehenden internen Verkäufe tragen
dort bereits NULL.

**Warum es erst am 2026-09-21 auffiel.** Der Fehler entsteht zur Laufzeit, nicht beim Anlegen,
also lief `0059` sauber durch und wartete auf die erste echte Zahlung danach. Es gab keine: Alle
vierzehn internen Verkäufe auf Staging tragen denselben `created_at` — `2026-09-18T20:31:20Z` —,
weil `0060` sie für Bestellungen nachtrug, die Tage vorher bezahlt worden waren. Die erste echte
`confirm_order_payment()` nach `0059` scheiterte sofort, zweimal, mit identischem 500 auf dem
gewöhnlichen **und** dem Spätzahlungspfad — beide teilen sich das `update orders set
payment_status = 'paid'`, das diesen Trigger auslöst.

**Folgen für Geld und Bestand: keine.** Die Exception verlässt `confirm_order_payment()`, die
ganze Transaktion rollt zurück — keine bezahlte Bestellung, keine umgewandelte Reservierung,
keine Bewegung, nicht einmal die `payment_events`-Zeile, die die Funktion als Erstes schreibt.

Nachgewiesen behoben am 2026-09-21 mit `SI-2026-001065`: `payment_events.outcome = confirmed`,
Reservierung `converted`, genau **eine** Bewegung über genau die gekaufte Menge, und die
Verkaufszeile mit `created_by = null`.

### 3.3ag Rekonstruierte Legacy-Historie neben dem Ledger (Migrationen `0079`–`0082`, ADR-0102)

**Der fachliche Schnitt ist der 01.01.2026.** Alles davor ist private Tätigkeit des Betreibers
und wird nicht zu SkyIsles-Geschäftsvorfällen: das gesamte Blatt `Order 2025` **und** die
fünfzehn Einkaufsgruppen aus Dezember 2025, die oben im Blatt `Order 2026` stehen. Sie sind
nirgends als Einkauf, Verkauf oder sichtbare Historie vorhanden; was die private Zeit
hinterlassen hat, geht ausschließlich in **einen** technischen Startwert je Position ein.

#### `legacy_stock_events` ist nicht das Lagerjournal

| | `inventory_movements` | `legacy_stock_events` |
|---|---|---|
| Was es ist | das **operative Ledger** — was SkyIsles tatsächlich gebucht hat | eine **Rekonstruktion** des Geschäftsjahres 2026 aus der Arbeitsmappe |
| Bewegt Bestand | ja | **nein** |
| Rückdatierung | ausgeschlossen | die Ereignisse tragen ihr historisches Datum |
| Quelle einer Menge | ja | **nie** — Bestand kommt aus `shop_inventory` |
| Änderbar | append-only | append-only, Rücknahme nur als Ganzes per `truncate` |

Beides in einer Tabelle zu führen hieße, dass ein Leser eine gebuchte Tatsache nicht mehr von
einer rekonstruierten unterscheiden kann. **`inventory_movements` bleibt das kanonische
append-only Ledger dessen, was SkyIsles operativ gebucht hat**; der Legacy-Import erzeugt dort
keine einzige Zeile.

#### Die fünf Ereignisarten

| Art | Bedeutung |
|---|---|
| `purchase` | dokumentierter Business-Einkauf 2026, `+1` je Stück |
| `sale` | dokumentierter Business-Verkauf 2026, `−1` je Stück |
| `correction` | die `Korrektur >`-Zeilen der Mappe. Sie zählt sie selbst als Abgang: für `I!74` liest ihr Verkaufszähler 5 = 3 Verkäufe + 2 Korrekturen |
| `opening_balance` | **technischer** Startwert zum 01.01.2026, kein Einkauf |
| `legacy_adjustment` | der Rest, wo selbst null ein zu hoher Start wäre. Gleiches Datum, gleiche technische Natur, **negativ** |

Die Rekonstruktion rechnet **rückwärts** vom Endbestand der Mappe, weil nur er belastbar ist:

```
raw_start = Endbestand − Einkäufe + Verkäufe + Korrekturen
opening_balance = max(0, raw_start)      legacy_adjustment = min(0, raw_start)
```

**Ein negativer `legacy_adjustment` behauptet nichts Physisches.** Er sagt: *„Die Legacy-Daten
rekonstruieren hier nicht vollständig."* Genau deshalb gilt die Regel:

> **Die Oberfläche darf aus Legacy-Ereignissen keinen historischen Zwischenbestand berechnen
> oder anzeigen.** Die Legacy-Historie ist dafür nicht vollständig genug; eine daraus gezogene
> laufende Linie wäre eine Genauigkeit, die diese Entscheidung bewusst aufgegeben hat.
> `seller_legacy_stock_events()` liefert deshalb Ereignisse und nie eine laufende Summe.

`opening_balance`, `legacy_adjustment`, Korrekturen und Retouren zählen **weder als Eingekauft
noch als Verkauft**; `seller_legacy_stock_summary()` trennt das an genau einer Stelle, damit
kein Screen die Regel kennen muss.

#### Struktur, die die Regeln erzwingt

`occurred_at` ist ein **date** — die Mappe kennt den Tag und nie die Stunde. CHECKs verbieten
jedes Datum vor dem Schnitt, erlauben die beiden technischen Arten ausschließlich am
01.01.2026, fixieren die Richtung je Art und verlangen, dass ein Mappenereignis seine Quellzeile
nennt und ein technisches keine hat. Partielle Unique-Indizes lassen je Position höchstens einen
`opening_balance` und einen `legacy_adjustment` zu; `import_fingerprint` ist eindeutig und
**lesbar statt gehasht**, weil diese Zeilen mit dem Auge gegen die Mappe geprüft werden.
RLS ist an und hat **keine Policy** — gelesen wird über zwei seller-gated Funktionen.

`market_price_snapshot` ist der kanonische Katalogpreis zum Migrationsschnitt, für alle
Ereignisse einer Figur identisch. **NULL ist zulässig** und bleibt es: zwei unterstützte Figuren
haben keinen kanonischen Preis, und einen zu erfinden wäre schlechter als keinen.

#### Die vier Migrationen

| | Rolle |
|---|---|
| `0079` | legt `legacy_stock_events` an — Tabelle, CHECKs, Indizes, Append-only-Trigger, RLS ohne Policy, `seller_legacy_stock_events()` und `seller_legacy_stock_summary()` |
| `0080` | korrigiert **eine** importierte Verkaufszeile. `Order 2026!1381` verweist über die Formel auf `T!I124` = SKY-0419 Kaos [T]; der Verkaufsimport hatte sie nach dem Freitext „Kaos" auf SKY-0563 Kaos [I] gelegt. Vier Katalogfiguren heißen Kaos, der Name konnte es also nie entscheiden. Läuft fail-closed: genau eine ungebuchte Zeile muss passen, sonst Rollback |
| `0081` | der Abschlussweg für die abgeglichenen Legacy-Verkaufspositionen — `apply_reconciled_legacy_settlement()` (intern), `seller_…` (Operator), `system_…` (nur `service_role`), dieselbe Dreiteilung wie beim Ledger. `seller_settle_sale_item()` aus `0073` bleibt unverändert und weist diese Positionen weiter ab |
| `0082` | **Rechtekorrektur.** `0081` nennt `apply_reconciled_legacy_settlement()` intern, entzog das Recht aber nur `public, anon, authenticated` — `service_role` behielt es. `0003` nennt bei `apply_inventory_movement` vier Rollen; `0082` zieht das nach. Sachlich hing wenig daran, weil genau diese Rolle den Wrapper ohnehin aufrufen darf und der Wrapper keine eigene Prüfung enthält. Verloren war die **Zusicherung**: „kein Rolle hält EXECUTE" ist der Satz, auf den sich später jemand verlässt |

#### Warum `0081` eine eigene Tür braucht

`seller_settle_sale_item()` weist jede Katalogfigur ab, deren `legacy_stock_flag` nicht `-` ist,
mit der Begründung, ein Abschluss ohne Bewegung dürfe nie zum Weg werden, auf dem Bestand still
verschwindet. Das galt, solange das Regal die Unbekannte war. Nach dem Abgleich ist Spalte F die
vereinbarte Wahrheit und ihre Wirkung steht bereits im Bestand — ein zweites Ausbuchen würde
dieselben Stücke doppelt entfernen. Deshalb eine **engere** Tür statt einer Aufweichung der
alten: nur freigegebene, nicht stornierte, nicht-Test-Verkäufe aus der Mappe, ohne Bewegung, und
nur dort, wo die Mappe selbst **kein** Ergebnis vermerkt hat. Geschrieben werden ein Zeitstempel
und eine Notiz.

#### Der Production-Rollout, Stand 2026-09-21 — abgeschlossen

**Importierte Historie: 2 671 Ereignisse.**

| Art | Anzahl | Summe |
|---|---|---|
| `opening_balance` | 263 | +742 |
| `purchase` | 1 245 | +1 245 |
| `sale` | 1 145 | −1 145 |
| `correction` | 3 | −3 |
| `legacy_adjustment` | 15 | **−15** |

**600 unterstützte Positionen (SKY-ID + `loose`) rekonstruieren exakt auf 824 Einheiten = Spalte
F der Arbeitsmappe.** Ausgeschlossen blieben 1 056 Quellzeilen: 552 vor dem Schnitt, 220
Nicht-Figuren (`DI A`, `ZB`, Swap-Hälften), 136 ohne Bestandsmarker, 79 beschädigt, 65 ohne
Formelreferenz und 4 mit einem Datum in der Zukunft.

**Bestandsabgleich: exakt 90 append-only `correction`-Bewegungen, netto −168** — 77 Abgänge
(−187) und 13 Zugänge (+19). Die Zugänge sind **ausnahmslos Software**: Production führte bis
dahin keine einzige Spieleinheit, obwohl die Mappe welche ausweist.

**Production danach:** `inventory_movements` **720** · echter loser Bestand **824** · Fixtures
**209** · Gesamtbestand **1 033** · reserviert **0**.

**191 offene Legacy-Verkaufspositionen wurden anschließend ohne Inventory-Movement
geschlossen** (187 mit SKY-ID auf 76 Figuren, 4 ohne) — die Bewegungszahl blieb bei 720.

**Genau eine Position bleibt absichtlich offen:** `sale_item#879`, Sale #228, `Order 2026`
Zeile 1110, „2.0 Stitch", ohne SKY-ID. Ihr Verkauf hat `stock_released_at IS NULL`; der
Release-Guard aus `0071` wurde **bewusst nicht umgangen** und die Position nicht künstlich
bereinigt. Die Freigabe ist eine Entscheidung des Betreibers, keine Aufräumarbeit.

---

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

### 3.3ah Pre-Go-Live-Cutover: der operative Ledger beginnt leer (ADR-0103)

Am **2026-09-21** wurde der operative Shop einmalig zurückgesetzt — zuerst Staging, dann
Production, jeweils in **einer** Transaktion und anschließend unabhängig verifiziert. Das
Skript liegt als Protokoll unter `tools/sql/pre-go-live-reset.sql`, deutlich als
`ONE-TIME — DO NOT RUN AGAIN` markiert, und **nicht** unter `supabase/migrations/`: es ist
keine Schemaänderung und darf auf einer frischen Datenbank nie laufen.

**Die Business-Historie beginnt am 01.01.2026.** Für den Zeitraum bis zum Go-Live ist die
finale Excel-Arbeitsmappe die Source of Truth; sie steht rekonstruiert in
`legacy_stock_events` (3.3ag, ADR-0102). Alles rein innerhalb SkyIsles Entstandene war Test.

#### Production, Ist-Zustand nach dem Cutover

| | |
|---|---|
| `inventory_movements` | **0** — der operative Ledger beginnt leer |
| `shop_inventory` | 273 Positionen · **824 reale lose Stück** · 0 boxed · 0 reserviert |
| Fixtures | **vollständig entfernt** — 4 Positionen / 209 Stück (SKY-9994, SKY-9998) |
| `legacy_stock_events` | **2 671** |
| Workbook-Verkäufe | **292 `sales` / 1 253 `sale_items`** · 813 fees · 41 refunds · 4 settlements |
| Einkäufe | **84 `purchases` / 2 114 `purchase_items`** |
| Importprotokoll | 1 `inventory_imports` / **614 `inventory_import_rows`** |
| `orderbook_audit` | **3**, alle an erhaltenen Workbook-Verkäufen |
| Bestellkette, Zahlungen, Rechnungen | **0** in jeder der 14 Tabellen |

`shop_inventory.quantity` wurde **nicht** angefasst. Die 824 losen Stück sind die
Cutover-Baseline; die Vergangenheit erklären ausschließlich die `legacy_stock_events`.

#### Die eine bewusst gelöste Verknüpfung

`inventory_import_rows.movement_id` trägt `ON DELETE RESTRICT` und steht in einer Tabelle, die
bleibt — der Fremdschlüssel hätte den Lauf blockiert. Die **167 Zeiger wurden kontrolliert auf
NULL gesetzt** (Production Import #1, `inventory_movements` 600 … 766), mit einer vorher
gemessenen Sollzahl und einem `get diagnostics`-Assert dagegen.

Zulässig ist das, weil die Spalte nullable ist, kein Constraint einen Wert verlangt
(`..._ignored_is_inert` verlangt im Gegenteil NULL für ignorierte Zeilen), die Tabelle keinen
einzigen Trigger trägt, nur `apply_inventory_import` sie schreibt und **kein View, keine
Funktion und kein Anwendungscode sie liest**. Jede Importzeile behält Blatt, Quellzeile,
Rohname, Klassifikation, SKY-ID, Zustand, Vorher-/Soll-Menge, Delta, Status und Notiz.
`status = 'applied'` bleibt das unterscheidende Feld.

#### Zehn Schutztrigger, für die Dauer einer Transaktion

Neun Tabellen verbieten DELETE per Zeilentrigger. `TRUNCATE` hätte sie umgangen, scheitert aber
an den Fremdschlüsseln aus `sale_items` und `order_reservations` — PostgreSQL prüft dort die
Constraint, nicht die Zeilen; `CASCADE` hätte über tausend Zeilen echter Geschäftshistorie
mitgenommen. Deshalb zeilenweises DELETE mit **zehn einzeln benannten** Triggern kurz
deaktiviert, alle Fremdschlüssel scharf. `session_replication_role = replica` schied aus, weil
es auch die Fremdschlüsselprüfung abgeschaltet hätte.

Die Liste stammt aus einer vollständigen Trigger-Inventur; nach dem Lauf wurde in **beiden**
Umgebungen per `pg_trigger` bestätigt, dass kein Trigger deaktiviert blieb.

#### Unabhängige Post-Reset-Verifikation

Nicht über die NOTICE-Ausgaben des Skripts, sondern gegen den tatsächlichen Datenbankzustand —
und auf Production zusätzlich **zeilenweise gegen einen unmittelbar zuvor erzeugten
Pre-Reset-Snapshot** (58 Tabellen, 10 916 Zeilen, lokal und gitignored unter `.backups/`; keine
Zeile daraus gehört ins Repository, `docs/SECURITY.md`).

- Alle Sollwerte erreicht, in beiden Umgebungen.
- **FK-Integrität: 0 verwaiste Referenzen** über alle geprüften Beziehungen.
- **Nur Fixtures entfernt:** die 273 überlebenden Positionen sind byte-identisch zum Snapshot,
  `updated_at` eingeschlossen — es gab kein einziges `UPDATE` auf `shop_inventory`.
- **Legacy-Rekonstruktion:** Σ 824 = realer loser Bestand, pro SKY-ID **0 Abweichungen**.
  Boxed wird nicht mit der Loose-Rekonstruktion vermischt.
- **`inventory_import_rows`:** 167 Zeilen, bei denen sich **ausschließlich** `movement_id`
  geändert hat; **0** Zeilen mit irgendeiner anderen Änderung.
- **34 unbeteiligte Tabellen byte-identisch** — keine unerwartete Änderung.

#### Ein zweiter Lauf wäre Datenverlust

Ab dem Cutover enthält `inventory_movements` ausschließlich echte operative Bewegungen. Die
Gates des Skripts prüfen auf echtes Geld und auf die Workbook-Historie — **nicht darauf, ob das
Skript schon einmal lief.** Ein Bestandsfehler wird mit einer Korrekturbewegung beantwortet,
nicht mit einem leeren Ledger.

---

### 3.3ai Eine Definition, zwei Leser: Zeitleiste und Lebenszeit-Zähler (Migration `0086`)

`Eingekauft` und `Verkauft` hingen zur Hälfte an einer gekappten Liste: die Legacy-Hälfte kam
aggregiert aus `seller_legacy_stock_summary()`, die operative summierte der Browser aus den
Zeilen von `seller_business_movements()` — und die begrenzt `p_limit`, hart bei 500. Eine
Position mit mehr Bewegungen hätte still zu wenig gezählt.

**`0086` gibt dem operativen Pfad die Form, die der Legacy-Pfad seit `0079` hat: ein
vollständiges Aggregat für die Seite, Einzelereignisse auf Abruf.** Additiv — nichts gelöscht,
keine Tabelle, keine Spalte, keine Policy verändert.

| Objekt | |
|---|---|
| `public.business_movements` | **die einzige Definition einer operativen Geschäftsbewegung.** View über `inventory_movements` ⨝ `shop_inventory`. Intern: `revoke all … from public, anon, authenticated`, kein `grant` |
| `seller_business_movements(bigint, integer)` | liest den View **paginiert** für die Anzeige. Signatur, Rückgabespalten, Sortierung, Limit und Gate unverändert gegenüber `0085`; nur der Filter steht nicht mehr im Rumpf |
| `seller_business_trade_totals()` | aggregiert **denselben** View **vollständig, ohne `LIMIT` und ohne `OFFSET`**, eine Zeile je `inventory_id` mit `purchased_units` und `sold_units` |

Warum ein View und keine zweite Filterkopie: stünde das Prädikat zweimal da, könnte jemand eine
Stelle ändern und die andere vergessen — Zeitleiste und Zähler würden sich widersprechen, ohne
dass es auffällt. So meinen beide dieselbe Menge **durch Konstruktion**.

Die Ausschlüsse sind unverändert die aus 3.3ag/`0085` und stehen jetzt genau einmal:
`initial_import`, Fixtures ab SKY-9000, Bewegungen einer Sandbox-Bestellung (hin und zurück)
und Bewegungen eines `is_test`-Verkaufs (hin und zurück). **Jede ist eine Referenz oder eine
geprüfte Spalte; keine liest `note`, keine rät über `reason`.**

#### Was die drei Zahlen einer Karte sind

```
Eingekauft = Legacy-Einkäufe          + operative Einkäufe      beide vollständig aggregiert
Verkauft   = Legacy-Verkäufe          + operative Verkäufe      beide vollständig aggregiert
Bestand    = shop_inventory.quantity                            und sonst nichts
```

`return`, `correction`, `writeoff`, `opening_balance` und `legacy_adjustment` zählen in keinen
der beiden Handelszähler. **Das Limit der Zeitleiste ist reine Darstellung** — `tradeCounters()`
nimmt zwei Aggregate und keine Liste, eine Zeitleiste lässt sich nicht mehr übergeben.

#### Ladeverhalten der Lagerseite

Vorher ein Movement-RPC **je Position**, dessen Zeilen dann im Browser summiert wurden; jetzt
zwei Aggregate für die ganze Seite und die Detailhistorie — operativ **und** legacy zusammen in
einem Roundtrip — erst beim Öffnen einer Karte.

| | vorher | nachher |
|---|---|---|
| Staging (278 Positionen) | **283** Requests | **6** |
| Production (273 Positionen) | **278** Requests | **6** |
| je geöffneter Karte | 1 (nur Legacy) | 1 (beide Quellen) |

#### Rollout

Staging und Production am **2026-09-21**, beide `Success. No rows returned`, beide read-only
verifiziert: Objekte und Grants vorhanden, `anon` bekommt auf View und Funktion `42501`, beide
Gates antworten mit demselben `seller operator role required`, und der Schema-Diff zeigt genau
die drei angekündigten Objekte.

**Keine einzige Datenzeile hat sich bewegt** — auf Production byte-genau belegt über SHA-256 je
Tabelle gegen den erwarteten Zustand: `shop_inventory`, `legacy_stock_events`,
`inventory_import_rows`, `purchases`, `purchase_items`, `sales`, `sale_items`,
`settlement_adjustments`, `orderbook_audit`, `skylanders`.

Beide operativen Ledger waren beim Rollout leer, Production stand vorher wie nachher bei
**824 real loose · 0 boxed · 0 reserviert · 0 `inventory_movements` · 2 671
`legacy_stock_events`**. Die Zähler sind damit heute exakt die Legacy-Summen — auf einem Weg,
der auch bei der tausendsten Bewegung noch stimmt.

---

### 3.3aj Die Arbeitsmappe nach dem Cutover: `return`, Zeilensync, neue Baseline (`0087`–`0089`)

Vollständige Begründung: **ADR-0104**. Hier steht, was in der Datenbank anders ist.

**`0087` — ein sechster Ereignistyp.** `legacy_stock_events.event_type` kennt jetzt zusätzlich
`return`, mit fester Richtung `quantity > 0`. Die Migration fasst genau zwei Constraints an,
`legacy_stock_events_type_known` und `legacy_stock_events_direction`, beide im Wortlaut von
`0079` plus dem neuen Typ. Tabelle, Spalten, RLS, der Append-only-Trigger, die partiellen
Unique-Indizes, der Cut auf 2026-01-01 und `legacy_stock_events_source_matches_kind` bleiben
unverändert — und die letzte Regel gilt auch für `return`: ein Arbeitsmappen-Ereignis nennt
seine Quellzeile.

Eine Retoure ist damit **zwei** Ereignisse auf derselben Quellzeile: `sale` −1 und `return` +1.
Die Bestandswirkung ist dieselbe wie vorher (netto 0), sichtbar ist jetzt aber, dass die Figur
draußen war. `l` (Verlust auf dem Weg) bekommt **keinen** eigenen Typ: lagerseitig ist das ein
Verkauf, und der kaufmännische Unterschied steht strukturiert in `sale_items.legacy_stock_flag`.

**`0088`/`0089` — sechs `service_role`-Funktionen, die eine Zeile korrigieren.**

| Funktion | schreibt | Identität |
|---|---|---|
| `system_sync_legacy_sale_item` | `raw_name`, `sky_id`, beide Legacy-Marker | `sale_items.id`, Zeile muss `source_row` haben |
| `system_sync_legacy_purchase_item` | dieselben vier Spalten der Einkaufsseite | `purchase_items.id` |
| `system_add_legacy_sale_item` / `..._purchase_item` | eine fehlende Position derselben Gruppe | Gruppe + `source_row` |
| `system_set_legacy_sale_fingerprint` / `..._purchase_fingerprint` | nur `import_fingerprint` | Gruppen-Id |
| `system_sync_legacy_sale_group` (`0089`) | **nur** `sold_at` | `sales.id` |

Jede prüft `source = 'excel_order_2026'`, lehnt eine an eine Bestellung gehängte Zeile ab und
verlangt eine Quellzeile. Keine dieser Funktionen erreicht `settled_at`, Movement-Ids, Preise,
Positionsnummern, Gebühren, Erstattungen oder Audit-Zeilen — sie stehen nicht in den
UPDATE-Listen. Alle sind `security definer set search_path = ''`, `revoke all` von `public`,
`anon`, `authenticated`, `grant execute` nur an `service_role` (Muster aus `0003`, `0035`,
`0081`).

**Warum überhaupt ein Zeilensync.** Der Import erkennt eine Gruppe an einem Fingerabdruck über
ihre Zeilen. Korrigiert der Verkäufer einen Marker, ist die Gruppe unkenntlich und ein zweiter
Lauf legte sie **doppelt** an. Der Sync gleicht deshalb über `source_row` ab — die einzige
stabile Identität einer Arbeitsmappenzeile — und stempelt den Abdruck erst neu, wenn die
Abweichung erklärt ist (`item`, `sold_at`, `unpersisted`); alles andere bleibt `unexplained`
und blockiert den Lauf.

**Append-only hat gehalten.** Der Neuaufbau der Historie brauchte neun Zeilen weniger.
`tools/import-legacy-history.mts` kann sie nicht entfernen — kein `delete`, kein `update` —,
nennt sie vollständig und bricht ab. Das Entfernen ist ein eigener einmaliger Vorgang
(`tools/sql/phase-c-legacy-history-prune.sql`), der `legacy_stock_events_no_update` für die
Dauer **einer** Transaktion aussetzt und in derselben Transaktion wieder schließt.

Der Anlass gehört dazu: der technische Abdruck von `opening_balance` und `legacy_adjustment`
ist `(Art, Figur, Zustand)` und enthält **keine Menge**. Ein rein additiver Lauf hätte eine
geänderte Startmenge als „schon vorhanden" gelesen und die alte Zahl behalten. Der Importer
vergleicht deshalb die fachlichen Felder; `market_price_snapshot` bleibt ausgenommen, das ist
der Preis zum Importzeitpunkt und keine Aussage der Arbeitsmappe.

#### Staging-Endzustand nach A–D (2026-09-22)

| | |
|---|---|
| Verkäufe / `sale_items` | **296** / **1 280** |
| Einkäufe gesamt / davon Legacy | **87** / **84** |
| `purchase_items` gesamt / davon Legacy | **2 121** / **2 114** |
| `sale_fees` · `sale_refunds` · `settlement_adjustments` | **825** · **41** · **4** |
| `legacy_stock_events` | **2 741**, Summe **806** |
| | `purchase` 1 259 · `sale` 1 182 · `return` 14 · `correction` 3 |
| | `opening_balance` 262 (+739) · `legacy_adjustment` 21 (−21) |
| realer loser Bestand | **806** = Spalte F |
| boxed · reserviert · Fixtures | **10** · **0** · **0** |
| `inventory_movements` | **0** |

**Legacy-Historie und operativer Bestand stimmen erstmals überein.** Die 18 Stück Differenz
aus der aktualisierten Arbeitsmappe wurden über die einmalige Baseline
(`tools/sql/cutover-baseline-806.sql`, 27 UPDATE / 6 INSERT / 243 unverändert) angeglichen —
**ohne eine einzige `inventory_movement`**. Der operative Ledger beginnt weiterhin leer.

#### Production-Endzustand nach A–D (2026-09-22)

Jede Phase wurde dort mit neu gemessenen Zahlen wiederholt; nichts wurde aus Staging
übernommen. Der Unterschied zu Staging bleibt auf Zeilen mit `quantity = 0` und auf
Staging-eigene Testdaten beschränkt.

| | |
|---|---|
| Verkäufe / `sale_items` | **296** / **1 280** |
| Einkäufe / `purchase_items` | **84** / **2 114** |
| `sale_fees` · `sale_refunds` · `settlement_adjustments` | **825** · **41** · **4** |
| `legacy_stock_events` | **2 741**, Summe **806** |
| | `purchase` 1 259 · `sale` 1 182 · `return` 14 · `correction` 3 |
| | `opening_balance` 262 (+739) · `legacy_adjustment` 21 (−21) |
| `shop_inventory` | **279 lose Positionen**, Summe **806** |
| boxed · reserviert · Fixtures | 0 · 0 · 0 |
| `inventory_movements` | **0** |

Phase A korrigierte 219 `sale_items` und 15 `purchase_items`, stempelte 32 Verkaufs- und 13
Einkaufsabdrücke und importierte vier neue Verkaufsgruppen (27 Positionen, 12 Gebühren).
Phase C entfernte neun überholte Ereignisse (2 671 → 2 662) und ergänzte 79 auf 2 741.
Phase D setzte 27 Positionen auf Spalte F und legte 6 an — netto −18, **ohne eine einzige
`inventory_movement`**.

**Damit stimmen rekonstruierte Historie und verfügbarer Bestand erstmals überein: beide 806**,
positionsweise ohne Abweichung (245 Positionen mit Bestand, 0 Differenzen). Der operative
Ledger beginnt weiterhin leer; die Herkunft des Bestands erklären ausschließlich die
`legacy_stock_events`.

**Das Baseline-Verfahren ist verbraucht.** `tools/sql/cutover-baseline-806.sql` trägt
`EXECUTED ON PRODUCTION · DO NOT RUN AGAIN`, und zwei Gates halten es geschlossen: 1j, sobald
jede Zielposition ihren Wert schon trägt, und 1a, sobald eine einzige Bewegung existiert. Jede
weitere Bestandsänderung entsteht über `apply_inventory_movement` (ADR-0044, ADR-0048).

---

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
- Achte Migration: `0008_shop_listing_opt_out.sql` — `is_shop_eligible()`,
  `admin_shop_listing_audit()`, Vorgabewert `is_listed = true`, Freigabe ohne Preiszwang und die
  **einmalige** Freigabe des bereits vorhandenen geeigneten Bestands. Ändert keine Menge, keine
  Reservierung, keinen Preis, erzeugt keine Bewegung und setzt niemals `false`. Idempotent.
- Neunte Migration: `0009_shop_quantity_check.sql` — `max_cart_quantity()` und
  `shop_quantity_available()`. Legt nur zwei Funktionen an: keine Tabelle, keine Spalte, keine
  Policy, kein Tabellenrecht, keine Datenzeile. **Angewandt am 2026-09-07**, siehe Abschnitt 3.3j.
- Zehnte Migration: `0010_commerce_core.sql` — der Commerce-Kern: `orders`, `order_lines`,
  `order_addresses`, `order_events`, `order_reservations`, die Bestellnummern-Sequenz und die
  Funktionen für Anlage, Reservierung, Freigabe und Verkaufsabschluss (ADR-0049, ADR-0050).
  **Rein additiv:** keine bestehende Tabelle wird geändert, keine bestehende Funktion neu signiert,
  keine Zeile angefasst. **Noch nicht angewandt** (Stand 2026-09-07) und daher gegen keine echte
  Datenbank getestet; geprüft ist bisher nur der SQL-Vertrag (`src/lib/commerce/schema.test.ts`).
- Elfte Migration: `0011_checkout_shipping_and_tax.sql` — `orders.tax_regime` (§ 19-Snapshot),
  `orders.shipping_method_code`/`_name`, die Versandregel als `free_shipping_threshold()`,
  `shipping_catalog()`, `shipping_amount_for()` und `shipping_quote()`, dazu `create_order()` mit
  Versandart und Deutschland-Prüfung. Additiv: zwei Spalten, keine Tabelle, kein Datensatz. Die
  einzige Ausnahme ist `create_order()`, das gedroppt und neu angelegt wird — eine Argumentliste
  lässt sich nicht in place erweitern (dasselbe tat `0007`). **Angewandt am 2026-09-08** und gegen
  Production verifiziert.
- Zwölfte Migration: `0012_payment_core.sql` — `payment_attempts`, `payment_events` und die fünf
  Payment-Funktionen (ADR-0051). Additiv: zwei Tabellen, keine bestehende Tabelle oder Funktion
  geändert. **Alle Funktionen sind `PUBLIC`, `anon` und `authenticated` entzogen**; der
  privilegierte Aufrufer wird eine Supabase Edge Function. **Angewandt am 2026-09-08** und
  runtime-verifiziert.
- Dreizehnte Migration: `0013_guest_payment_capability.sql` — `orders.payment_token_hash` und
  `authorize_order_payment()` (B2.2a). `create_order()` bekommt ein sechstes Argument, die
  Fähigkeit; die fünfstellige Fassung bleibt **absichtlich daneben stehen**, damit das Deployment
  ohne Fenster übersetzt, in dem jeder Checkout `PGRST202` beantwortet. **Angewandt am 2026-09-08.**
- Vierzehnte Migration: `0014_remove_legacy_create_order.sql` — entfernt die fünfstellige
  Fassung wieder. Eine Anweisung, sonst nichts. **Auf Staging angewandt am 2026-09-09, Production
  ausstehend.**
- Fünfzehnte Migration: `0015_payment_bootstrap.sql` — der Payment-Bootstrap (B2.2b):
  `payment_attempts_protect()` erlaubt genau `expired` → `succeeded` (ADR-0052),
  `amount_to_cents()` als einzige Stelle, an der Geld die Einheit wechselt,
  `start_payment_attempt()` liefert zusätzlich `amount_cents`, `created_at` und die Anbieter-IDs,
  und `pending_payment_expiries()` ist ein reiner Leser für den späteren Expiry-Sweep.
  `start_payment_attempt()` wird gedroppt und neu angelegt (Rückgabetyp erweitert) — **und
  deshalb neu entzogen**, denn für Privilegien ist sie danach eine neue Funktion.
  **Auf Staging angewandt am 2026-09-09, auf Production angewandt und dort mit einem realen
  Checkout-/Reservierungs-Smoke verifiziert.**
- Sechzehnte Migration: `0016_fix_create_order_amount_initialization.sql` — **eine
  Defektbehebung.** `create_order()` legte die Bestellung seit `0010` mit Nullbeträgen an und
  aktualisierte sie danach, was `orders_protect_immutable()` verbietet: **jeder Checkout warf
  `23001`, es konnte nie eine Bestellung entstehen.** Die Beträge stehen jetzt vor dem INSERT fest
  (ADR-0053). Eine Funktion, kein Trigger, keine Tabelle, kein Grant.
  **Auf Staging angewandt und verifiziert am 2026-09-09, auf Production angewandt und dort mit
  einem realen Checkout-/Reservierungs-Smoke verifiziert.**

- Achtzehnte Migration: `0018_admin_orders.sql` — **Bestellverwaltung.** Eine Spalte
  (`orders.tracking_number`, roh gespeichert, getrimmt, höchstens 64 Zeichen und nur auf einer
  versendeten Bestellung), zwei CHECKs (`shipped_at` passt zum Versandzustand), ein Trigger
  (`orders_protect_fulfillment()`: genau `unfulfilled → shipped`, `shipped_at` aus der Serveruhr,
  Tracking nach dem Versand unveränderlich, Fulfillment darf `needs_resolution` nicht mitändern)
  und drei Funktionen: `admin_orders()` (Liste, sortiert nach Aufmerksamkeit), `admin_order()`
  (ein Dokument als `jsonb`) und `admin_mark_order_shipped()`. Alle drei fragen
  `is_shop_admin()` im eigenen Rumpf. Die Projektionen enthalten **kein** `client_hash`, kein
  `payment_token_hash`, kein `request_id` und keine interne ID. Versand schreibt keine
  Bestandsbewegung, keine Reservierung und keine Zahlungsspalte.
  **Auf Staging angewandt und verifiziert am 2026-09-11, auf Production NICHT angewandt.**

- Siebzehnte Migration: `0017_order_payment_state.sql` — **eine lesende Funktion, sonst nichts.**
  `order_payment_state(p_order_number, p_token)` gibt vier Spalten zurück (`order_number`,
  `payment_status`, `needs_resolution`, `total_amount`) und ist die einzige Funktion der
  Payment-Familie, die ein Client aufrufen darf. Sie existiert, weil ein **Gast** seine eigene
  Bestellung sonst nicht sehen kann: `orders_select_own` deckt nur Angemeldete ab, und `0010` hielt
  fest, dass eine Gastbestellung als Policy gar nicht ausdrückbar ist. Autorisierung über
  `authorize_order_payment()` aus `0013` — aufgerufen, nicht kopiert. Keine PII, keine IDs, kein
  `payment_token_hash`, kein `is_paid`, kein `currency`. Unbekannte und unautorisierte Bestellung
  liefern dasselbe leere Ergebnis.
  **Auf Staging angewandt und verifiziert am 2026-09-11, auf Production NICHT angewandt.**

- Neunzehnte Migration: `0019_transactional_mail.sql` — **Transaktionsmail** (ADR-0059).
  Zwei Tabellen (`business_settings`, `order_mail`), der Anspruchs- und Abschlusspfad
  (`claim_order_mail()`, `mark_order_mail_sent/failed/unresolved()`), die Nutzlast
  (`order_mail_payload()`), die schmale öffentliche Projektion (`business_settings_public()`,
  **niemandem gewährt**) und die beiden Adminfunktionen. `admin_order()` wird gedroppt und neu
  angelegt, weil die Projektion um `mail` wächst. Rein additiv: keine bestehende Tabelle geändert,
  keine Zeile angefasst. Der `RESEND_API_KEY` liegt ausschließlich als Edge-Secret (ADR-0051) —
  die Datenbank kennt ihn nicht. **Auf Staging angewandt und runtime-verifiziert am 2026-09-11,
  auf Production NICHT angewandt.**
- Zwanzigste Migration: `0020_order_events_anonymisation.sql` — **eine Defektbehebung.**
  `order_events` lag unter dem pauschalen `deny_write()`, das auch die Fremdschlüssel-Aktion
  `ON DELETE SET NULL` auf `actor_user_id` abwies: Wer eine Bestellung aufgegeben oder versendet
  hatte, dessen Konto war nicht mehr löschbar (`Database error deleting user`). Gefunden im
  Mail-E2E auf Staging am 2026-09-11. `prevent_order_event_change()` erlaubt genau die
  Anonymisierung mit unveränderten Sachspalten — dieselbe Regel wie `inventory_movements`
  (`0003`, ADR-0037) und `catalog_admin_changes` (`0004`). Ein Trigger, eine Funktion, keine
  Tabelle, keine Spalte, kein Grant. `deny_write()` bleibt für `order_lines` und
  `order_addresses` unverändert. **Auf Staging angewandt und runtime-verifiziert am 2026-09-11,
  auf Production NICHT angewandt.**

- Einundzwanzigste Migration: `0021_commerce_mode.sql` — **der Commerce-Modus** (ADR-0060).
  Eine Spalte auf `commerce_settings`, die Tabelle `commerce_testers`, das Prädikat
  `commerce_checkout_allowed()`, die schmale öffentliche Projektion `commerce_access()`, die
  Spalte `orders.commerce_mode` samt Nachtrag und Immutability, dazu die drei Stellen des
  Kauf- und Zahlungspfads und fünf Adminfunktionen. `create_order()`,
  `authorize_order_payment()` und `start_payment_attempt()` werden per `create or replace`
  ersetzt — Signatur und Rückgabetyp bleiben identisch; nur `admin_orders()` wird gedroppt und
  neu angelegt, weil eine `returns table`-Signatur nicht in place wachsen kann.
  **Der Default ist `closed`: Das Anwenden schließt den Checkout, bis jemand ihn bewusst
  öffnet.** Rein additiv im Übrigen — keine Zeile gelöscht, kein Typ geändert.
  **Auf Staging angewandt und verifiziert am …, auf Production NICHT angewandt.**

- Zweiundzwanzigste Migration: `0022_account_state.sql` — **Kontozustand** (ADR-0061). Zwei
  Tabellen (`cart_items`, `customer_contacts`) mit je vier Eigentümer-Policies,
  `merge_guest_cart()`, `my_orders()`, `my_order()` und `order_payment_state()` um `attempts`
  erweitert. Rein additiv: keine bestehende Tabelle geändert, keine Zeile angefasst, kein Trigger
  neu definiert. Nur `order_payment_state()` wird gedroppt und neu angelegt, weil eine
  `returns table`-Signatur nicht in place wachsen kann.
  **Auf Staging angewandt und verifiziert am …, auf Production NICHT angewandt.**

- Dreiundzwanzigste Migration: `0023_tracking_number_is_editable.sql` — **Sendungsnummer und
  Fulfillment werden entkoppelt** (ADR-0062). Ein CHECK wird in place ersetzt,
  `orders_protect_fulfillment()` verliert die Trackingregel (behält jede Fulfillment-Regel),
  `admin_set_tracking_number()` kommt hinzu, `admin_mark_order_shipped()` bekommt ein `coalesce`,
  und beide Bestelldokumente tragen `shipping_method_code`. Kein `DROP` einer Funktion, keine
  Tabelle, keine Zeile angefasst. Runtime-Suite: `supabase/tests/0023_tracking_runtime.sql`
  (fünf Abschnitte, alle mit Rollback).
  **Auf Staging angewandt und verifiziert am …, auf Production NICHT angewandt.**

- Vierundzwanzigste Migration: `0024_open_orders_include_pending.sql` — **ein Vergleich**
  (ADR-0063). `admin_orders(p_open_only => true)` filterte auf `attention <= 1` und schloss damit
  genau die Stufe aus, die die Oberfläche „Offen" nannte; jetzt `<= 2`. Stufen, Sortierung,
  Spalten und Rollenprüfung unverändert. Keine Tabelle, keine Spalte, keine Zeile angefasst.
  **Auf Staging angewandt und runtime-verifiziert am 2026-09-12, auf Production NICHT angewandt.**

- Fünfundzwanzigste Migration: `0025_movement_reason_neutral.sql` — **das Bewegungsvokabular**
  (ADR-0065). `sale` kommt hinzu, `sale_skyisles` bleibt **dauerhaft** erlaubt, und
  `convert_order_reservations()` bucht ab jetzt `sale`. Die Funktion wurde zeichengleich aus
  `0010` übernommen; genau eine Zeile unterscheidet sich. **Kein Backfill, kein `update`, kein
  `select` auf `inventory_movements`** — Historie kann nie umbenannt werden, und diese Migration
  versucht es auch nicht. Runtime-Suite: `supabase/tests/0025_movement_reason_runtime.sql`
  (vier Abschnitte, alle mit Rollback).
  **Auf Staging angewandt und runtime-verifiziert am 2026-09-12** — echter Sandbox-Kauf
  `SI-2026-001048` (SKY-0053/loose): genau eine `sale`-Bewegung, `delta -1`, die vorhandene
  `sale_skyisles`-Zeile derselben Position unverändert daneben. **Auf Production NICHT
  angewandt.**

- Sechsundzwanzigste Migration: `0026_platform_and_seller.sql` — **zwei Rollen, ein Rechtssubjekt** (ADR-0086)
  (ADR-0064). Neue Tabelle `sellers` (genau **eine** Zeile, `display_name = 'yulez.collectibles'`,
  Kontaktwerte aus `business_settings` **kopiert**); `sellers_one_active` als partieller
  Unique-Index erlaubt höchstens **einen aktiven** Verkäufer; `active_seller()` ist der einzige
  Leseweg. `business_settings` heißt jetzt `platform_settings` und verliert
  `transactional_reply_to` — eine reine Verkäuferangabe, vorher kopiert und in einer Sperre
  geprüft. `mail_contact_settings()` behält **Name, Signatur und Rückgabeform** und liest nur
  woanders her, deshalb braucht `send-order-mail` **kein Redeploy**. **Kein `seller_id`, keine
  Commerce-Funktion, keine Policy, kein Grant auf die Tabelle.** Runtime-Suite:
  `supabase/tests/0026_platform_and_seller_runtime.sql` (sieben Abschnitte, alle schreibenden
  mit Rollback).
  **Auf Staging angewandt und runtime-verifiziert am 2026-09-12** — `active_seller()` liefert
  `yulez.collectibles`, beide Adressen entsprechen dem vor der Migration erhobenen
  SHA-256-Fingerabdruck, `mail_contact_settings()` antwortet byteweise unverändert, ein zweiter
  aktiver Verkäufer wird vom Index abgewiesen, und ein echter Sandbox-Kauf (`SI-2026-001049`)
  hat die Bestellbestätigung mit dem Reply-To des **Verkäufers** versendet. **Auf Production
  NICHT angewandt.**

- Siebenundzwanzigste Migration: `0027_seller_public.sql` — **der Handelsname wird lesbar.**
  Eine einzige Funktion plus Grant: `seller_public()` liefert `id` und `display_name` des
  aktiven Verkäufers an `anon` und `authenticated`, als Allow-List nach dem Muster von
  `platform_settings_public()` (ADR-0059). `security definer`, `set search_path = ''`,
  `where s.is_active`. **Additiv** — kein `alter table`, keine Policy, kein Grant auf
  `sellers`; `active_seller()`, `admin_seller()` und `shop_offers()` bleiben unverändert.
  Rückbau ist eine Zeile: `drop function if exists public.seller_public();`.

  **Das ist eine Identität, keine Relation.** Die Funktion beantwortet „wer verkauft auf
  SkyIsles", nicht „wer verkauft diesen Artikel". Es gibt weiterhin **kein `seller_id`** auf
  irgendeiner Tabelle, und ein Angebot wird **nicht** mit einem Verkäufer verknüpft — es
  kann nicht, weil `sellers_one_active` garantiert, dass es genau einen gibt. Die jetzt
  öffentliche `id` ist der Schlüssel, an dem eine spätere echte Relation hinge; heute ist sie
  eine Konstante. **Wer aus `seller.id` in der Schnellansicht schließt, Multi-Seller sei
  bereits implementiert, irrt** — der Marketplace-Stopp aus ADR-0021 gilt unverändert, und die
  echte Offer→Seller-Relation kommt erst mit einem zweiten realen Verkäufer (ADR-0064).
  Prüfwerkzeug: `npm run verify:seller:staging` (schreibfrei, zehn Eigenschaften).

> **Runtime-Verifikation.** `supabase/tests/0015_runtime_verification.sql` prüft `0015` und `0016`
> gegen eine echte Datenbank: ACL-Matrix, Cent-Umrechnung, die Übergangsmatrix der
> Zahlungsversuche, den vollständigen Late-Payment-Pfad samt Idempotenz und den Expiry-Leser.
> Jeder schreibende Abschnitt läuft in `begin … rollback`, die Suite lässt also nichts zurück.
> **Sie gehört auf Staging und niemals auf Production.** Sie hat den Defekt aus `0016` gefunden,
> den 1305 statische Tests nicht sehen konnten — der Grund steht in ADR-0053.

- Achtundzwanzigste Migration: `0028_v1_loose_only_commerce.sql` — **V1 verkauft lose, und die
  Datenbank weiß das jetzt auch.** Die Anwendung zeigt seit dem V1-Commerce-Vertrag auf jeder
  öffentlichen Fläche ausschließlich `loose`; `shop_quantity_available()` und `create_order()`
  akzeptierten dagegen jede Kondition, die der Aufrufer nannte, und beide sind über PostgREST mit
  dem Anon-Key erreichbar. Etwas nicht anzuzeigen ist keine Ablehnung.

  Drei Objekte, alle additiv. `v1_sale_condition()` ist neu, `immutable`, an **niemanden**
  granted (beide Aufrufer sind `security definer` und laufen als Owner) und schreibt das Wort
  `loose` als einzige Stelle im SQL — das Gegenstück zu `V1_CONDITION` in
  `src/lib/shop/offer.ts`. `shop_quantity_available()` bekommt genau ein zusätzliches Prädikat
  und antwortet für `boxed` mit demselben `false` wie für eine ausverkaufte Position: keine neue
  Fehlersemantik für eine boolesche Funktion. `create_order()` bekommt genau eine zusätzliche
  Validierung in **Pass 1** — dem Durchgang, der nichts schreibt — und lehnt eine Nicht-`loose`-
  Position mit `check_violation` ab, demselben Code wie eine ungültige Menge.

  **Die Ablehnung ist ausdrücklich, nicht beiläufig.** Ein `article X / boxed is not offered`
  wäre unwahr: die Position existiert, ist gelistet, ist eligible und hat einen Preis. Falsch ist
  die Anfrage, nicht der Bestand.

  **Atomar.** Der Guard steht vor `insert into public.orders`, vor `order_lines`, vor
  `order_addresses`, vor `order_events` und vor `reserve_for_order()`. Ein gemischter Warenkorb
  aus `loose` + `boxed` hinterlässt keine Bestellung, keine Position, keine Bewegung und keine
  Bestandsänderung — es gibt zum Zeitpunkt der Ablehnung nichts zurückzurollen, und die Exception
  bricht die Transaktion des Aufrufers ohnehin ganz ab.

  **Ersetzt werden die aktuell gültigen Definitionen:** `shop_quantity_available` aus `0009`,
  `create_order` aus `0021` — die **sechsstellige** Signatur. Die fünfstellige Fassung wurde in
  `0014` gedroppt und wird hier bewusst **nicht** wiederbelebt; `create or replace` auf einer
  anderen Argumentliste würde nichts ersetzen, sondern die Legacy-Überladung neu anlegen.

  **Kein Datenmodell bewegt sich.** Kein `alter table`, kein `insert`, kein `update`, kein
  `delete`. `shop_inventory.condition` und `order_lines.condition` behalten beide Werte samt
  CHECK-Constraint, bestehende `boxed`-Bestände bleiben unverändert stehen, historische
  `boxed`-Bestellpositionen bleiben lesbar. OVP ist ein Produkt, das noch nicht entworfen ist —
  seine Daten müssen das überleben.

  **Grants unverändert.** Beide `revoke`/`grant`-Paare sind zeichengleich aus `0009` und `0021`
  wiederholt (`anon`, `authenticated`), damit sie im Review sichtbar sind statt vererbt.
  Rückbau: die Definitionen aus `0009` und `0021` erneut anwenden, dann
  `drop function if exists public.v1_sale_condition();`.

  **Status: noch nicht angewandt** — weder Staging noch Production.

- Neunundzwanzigste Migration: `0029_v1_loose_only_offers.sql` — **die Storefront hört auf zu
  bewerben, was nicht verkauft wird.** `0028` hat die beiden Türen geschlossen, durch die eine
  boxed-Position gekauft werden konnte. `shop_offers()` blieb offen: die Projektion lieferte
  `anon` weiterhin boxed-Angebote mit Preis und Verfügbarkeitsflag — auf Staging 8 von 25
  Zeilen — für Artikel, die `create_order()` inzwischen ablehnt. Ein Angebot, das niemand
  annehmen kann, ist keines.

  Genau das war der ursprüngliche Befund: die Katalogkarte sagte „Angebote ab 21,50 €" für
  SKY-0043, während der Quick View sich weigerte zu öffnen — die Karte glaubte der Projektion,
  der Quick View der V1-Regel.

  **Eine Funktion, ein zusätzliches Prädikat.** Die Definition aus `0008` wörtlich, plus
  `and i.condition = public.v1_sale_condition()`. Signatur, vier Rückgabespalten, Typen,
  `stable`/`security definer`/`search_path`, `is_listed`, `is_shop_eligible`, Preisregel,
  `available`-Semantik und Sortierung unverändert. **Kein neues Argument** — eine Kondition, die
  der Client wählen könnte, ist genau die Wahl, die V1 nicht anbietet. Das Wort `loose` steht
  nicht in dieser Datei; die Regel wird bei `v1_sale_condition()` (`0028`) erfragt.

  **Kein Datenmodell, keine Historie.** Kein `alter table`, kein `insert`/`update`/`delete`.
  `shop_inventory` behält jede boxed-Zeile samt CHECK-Constraint, `order_lines` behält die
  Kondition jeder historischen Position — eine früher aufgegebene boxed-Bestellung liest sich
  weiterhin als boxed in `my_order()`, in `admin_order()` und in ihrer Bestellbestätigung.
  `admin_shop_inventory()` und `admin_inventory_movements()` zeigen unverändert beide
  Konditionen: interner Bestand ist eine andere Frage als ein öffentliches Angebot.

  **Kein Sicherheitsfix.** Seit `0028` kann niemand mehr eine boxed-Position kaufen. Was sich
  hier ändert, ist, was einem Besucher gesagt wird — und Verteidigung in der Tiefe für jede
  künftige Fläche, die den Filter vergisst. Die Filter in der Anwendung (`v1BuyableOffers()`,
  `hasV1BuyableOffer()`, `isV1Buyable()`, Cart- und Quick-View-Guards) bleiben bestehen: ein
  Payload ist eine Netzwerkantwort, keine Garantie.

  Grants zeichengleich aus `0008` wiederholt (`anon`, `authenticated`). Rückbau: die Definition
  aus `0008` erneut anwenden. **Status: noch nicht angewandt** — weder Staging noch Production.

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
  reason       text not null     check in ('purchase','sale','sale_skyisles','sale_external',
                                  'return','correction','writeoff','initial_import')
                                  -- 'sale' seit 0025; 'sale_skyisles' bleibt dauerhaft
                                  -- erlaubt, weil Historie nie umbenannt wird (ADR-0065)
  unit_cost    numeric(10,2)     -- nur bei reason='purchase'
  currency     text              -- dito, ISO-4217-Muster ^[A-Z]{3}$
  note         text              -- intern
  created_at   timestamptz not null default now()
  created_by   uuid → auth.users (on delete set null)   -- NULL = System
  -- KEINE sky_id: normalisiert, siehe unten. KEIN order_id: `orders` gibt es nicht.
```

**Vorzeichen je Reason**, als CHECK: `purchase` und `initial_import` nur positiv · `sale`,
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
