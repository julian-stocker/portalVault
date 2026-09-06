# Skylanders-Daten — Legacy-System, Regeln und Migration

Diese Datei beschreibt, **welche Daten es gibt, welche Regeln daran hängen und was bei der
Migration nach PortalVault gilt**. Sie ist aus der tatsächlichen Analyse des Legacy-Projekts
unter `../webpage` entstanden (Stand der Analyse: 2026-09-03; Legacy-Datenstand: 2026-08-11).

`../webpage` ist STRICT READ-ONLY. Alle hier genannten Legacy-Befehle sind Dokumentation des
Bestehenden, **keine Aufforderung, sie auszuführen**.

---

## 1. SKY-ID-System

Format `SKY-0001` … `SKY-0820`, Regex `^SKY-\d{4}$`, **Spalte A** der Master-Excel.

**Identitätsregeln (unverändert nach PortalVault übernommen):**

- Eine SKY-ID wird **niemals** abgeleitet aus: Name, Slug, Bilddatei, Zeilennummer, Kategorie,
  Serie oder Excel-Position.
- Eine SKY-ID wird **niemals wiederverwendet**. Eine gelöschte Zeile gibt ihre Nummer nicht frei.
- Eine Umbenennung (Spalte B) ändert die Identität **nicht**.
- Ein Bild ist **kein** Bestandteil der Identität — austauschbar, ohne die SKY-ID zu berühren.
- Der Legacy-Build **erfindet niemals eine ID**. Fehlt eine, bricht er ab und nennt Sheet + Zeile
  (`etl/articles.py::require_valid_ids`). Vergabe ausschließlich über `etl/assign_ids.py`.
- Nächste Nummer = Maximum aus `data/id_ledger.json` (`highest_issued: 820`) und der höchsten
  ID in der Mappe. Der Ledger wird nur erhöht, nie zurückgesetzt.

**Was die SKY-ID verbindet:** Excel-Zeile · Masterbild · Website-Bild · Marktpreis ·
externe Preisquelle/Mapping · Lagerbestand · Ankauf · später eBay · **künftig: Benutzersammlungen
in PortalVault**.

Genau deshalb ist sie in PortalVault der kanonische Schlüssel: Benutzer referenzieren die
zentrale Figur über die SKY-ID, nicht über Name oder Kopien.

---

## 2. Excel als bisherige Source of Truth

`../webpage/skylanders.xlsx` (≈ 687 KB, 13 Sheets, keine eingebetteten Bilder mehr).

| Sheet | Inhalt | öffentlich |
|---|---|---|
| `Summary` | Kennzahlen, u. a. Ankauffaktor in `E23` | nein (nur der Faktor wurde exportiert) |
| `SA` | Spyro's Adventure (2011) | ja |
| `G` | Giants (2012) | ja |
| `SF` | Swap Force (2013) | ja |
| `T` | Trap Team (2014) | ja |
| `SC` | SuperChargers (2015) | ja |
| `I` | Imaginators (2016) | ja |
| `ZB` | Zubehör — hat SKY-IDs | **nein** |
| `DI A` | Disney Infinity — hat SKY-IDs | **nein** |
| `Order 2025`, `Order 2026` | Einkauf/Verkauf, **Käuferdaten** | **niemals** |
| `EÜR 2025`, `EÜR 2026` | Buchhaltung | **niemals** |

### Spaltenbelegung der Artikel-Sheets

| Spalte | Bedeutung | Verwendung |
|---|---|---|
| **A** | **SKY-ID** | Identität |
| **B** | Artikelname | roh übernommen, kein `strip()`, keine Korrektur |
| D | **O = Owned** — insgesamt jemals eingekauft | intern (Geschäftsinventar) |
| E | **S = Sold** — insgesamt verkauft | intern (Geschäftsinventar) |
| F | **D = Difference** — aktueller Lagerbestand (`D − E`) | intern; öffentlich nur als Boolean |
| H | Trendpfeil | wird vom Preisupdate geschrieben |
| **I** | **Marktpreis** | der Preis auf der Website |
| J | `= I × 0,9` eBay-Erlös nach Gebühren | **kein** Kundenpreis, nie exportiert |
| L/M/N | OVERALL / SOLD / DUPLICATES (Werte) | intern, finanziell |
| P/Q/R/S | **private Sammlung** (O/C/S/D = OVERALL / COLLECTION / SOLD / DUPLICATES) | wird nie gelesen |
| U/V/W/X | private Sammlung (Werte) | wird nie gelesen |

> **Zwei O/S/D-artige Blöcke, zwei völlig verschiedene Bedeutungen.** Der **erste** Block
> (D/E/F) ist das **Geschäftsinventar** des Stores. Die **weiter hinten** liegenden Blöcke
> (P/Q/R/S, U/V/W/X) sind die **private Sammlung** des Betreibers. Sie sehen ähnlich aus und
> meinen Gegenteiliges — die häufigste Verwechslungsgefahr in dieser Datei.

Zeile 1 = Kopfzeile, Zeile 2 = Summen, Artikel ab Zeile 3/4.
Fettgedruckte Zeilen in `ZB` / `DI A` sind Rubriküberschriften, keine Artikel.

### Excel-Schreibregeln (Legacy, technisch relevant)

Excel-Schreibzugriffe erfolgen **chirurgisch am XML**, nie über `openpyxl`: die Order-Sheets
enthalten 5.464 `cm=`-Zellen mit dynamischen Array-Metadaten (`XLDAPR`), die `openpyxl` beim
Speichern verlieren würde. Ablauf: Backup → temporäre Datei → vollständige Integritätsprüfung →
atomares `os.replace`. Schlägt eine Prüfung fehl, bleibt die Master-Datei unverändert.

---

## 3. Serien und Kategorien

Sechs öffentliche Serien, feste Reihenfolge (`etl/extract.py::SERIES`):

| Code | Label | Jahr | öffentliche Artikel |
|---|---|---:|---:|
| `SA` | Spyro's Adventure | 2011 | 108 |
| `G` | Giants | 2012 | 86 |
| `SF` | Swap Force | 2013 | 96 |
| `T` | Trap Team | 2014 | 149 |
| `SC` | SuperChargers | 2015 | 76 |
| `I` | Imaginators | 2016 | 85 |

**Kategorien** benennt die Excel nicht — sie trennt Blöcke nur durch Leerzeilen.
`etl/categories.py` vergibt Namen **in Blockreihenfolge des Sheets**; diese Reihenfolge ist
die Reihenfolge auf der Website. Jeder Eintrag hat einen **Anker** (Name des ersten Artikels im
Block). Passt der Anker nicht mehr, **bricht der Build ab**, statt still falsche Kategorien zu
vergeben.

```
SA  Spiele · Figuren · Sidekicks · Magic Items
G   Spiele · Giants große Figuren · Giants neue Figuren · Giants Series 2 Figuren · Sidekicks · Magic Items
SF  Spiele · SWAP Force · Swap Force neue Figuren · Varianten & LightCore · Magic Items
T   Spiele · Trap Masters · Trap Team neue Figuren · Trap Team Series Figuren · Minis · Trap Items · Traps
SC  Spiele · Figuren · Trophies · Fahrzeuge
I   Spiele · Senseis · Locations & Truhen · Kreationskristalle
```

### Produktgruppen — die stabile Schicht über den Kategorien (ADR-0041)

Die Legacy-Kategorien bleiben genau, wie sie sind: sie sind die **exakte** Klassifikation und
kommen aus dem Legacy-Projekt. Darüber liegt eine gröbere, für Nutzer verständliche Ebene:
`categories.catalog_group`, redaktionell gepflegt, vom Import nie angefasst.

| Gruppe | Label | n | aus welchen Kategorien |
|---|---|---:|---|
| `figure` | Figuren | 261 | SA/SC `Figuren`, `Giants neue Figuren`, `Giants Series 2 Figuren`, `Swap Force neue Figuren`, `Varianten & LightCore`, `Trap Team neue Figuren`, `Trap Team Series Figuren` |
| `trap` | Fallen | 57 | `Traps` |
| `sensei` | Senseis | 46 | `Senseis` |
| `item` | Items | 44 | `Magic Items` (SA/G/SF), `Trap Items`, `Trophies`, `Locations & Truhen` |
| `vehicle` | Fahrzeuge | 31 | `Fahrzeuge` |
| `trap_master` | Trap Masters | 28 | `Trap Masters` |
| `creation_crystal` | Kreationskristalle | 27 | `Kreationskristalle` |
| `mini` | Minis | 27 | `Minis` (T), `Sidekicks` (SA/G) |
| `swapper` | Swapper | 26 | `SWAP Force` |
| `giant` | Giants | 14 | `Giants große Figuren` |

Summe **561** — gemessen am 2026-09-06, nicht geschätzt.

**Drei Kategorien benennen eine Variante statt einer Produktart** und gehören trotzdem zu
`figure`: `Varianten & LightCore` (27), `Giants Series 2 Figuren` (39), `Trap Team Series
Figuren` (6). Was ihr Name sagt — eine Ausführung, eine Neuauflage — ist eine eigene, noch nicht
gebaute Dimension.

**Die Gruppe sagt nichts über Completion.** „Fahrzeug" heißt nicht „optional". Ein Trap Master
kann selbst eine Special-Ausgabe sein, und `Legendary Hand of Fate` ist ein **Item** mit
Legendary-Ausführung.

**`NULL` ist erlaubt und bedeutet „noch nicht klassifiziert".** Eine neue Kategorie aus dem
Legacy-Projekt kommt so an, bleibt unter „Alle" sichtbar und wird nie automatisch `item`. Die
sechs `Spiele`-Kategorien bleiben dauerhaft `NULL`.

### Import-owned vs. Admin-owned (ADR-0039)

Der Katalogimport benennt in seinem Upsert genau acht Spalten; PostgREST fasst beim
`ON CONFLICT DO UPDATE` nur benannte Spalten an. Alles andere überlebt jeden Import.

| Import-owned | Admin/editorial-owned |
|---|---|
| `sky_id`, `name`, `slug`, `series_code`, `category_id`, `market_price`, `image_file`, `is_active` | `character_id`, `catalog_visible`, `display_name_override` — und in eigener Tabelle `catalog_editorial.admin_note` |
| an `categories`: `series_code`, `name`, `position` | an `categories`: `catalog_group` |

Zwei Tests halten das fest: `src/lib/catalog/import-payload.test.ts` (die Spaltenliste des
Payloads, positiv **und** negativ) und `src/lib/catalog/editorial.test.ts` (keine redaktionelle
Spalte kommt im Code des Importers überhaupt vor).

**Der Anzeigename** folgt derselben Trennung: `name` bleibt der importierte Rohname,
`display_name_override` ist die redaktionelle Entscheidung, öffentlich gilt
`display_name_override ?? Ableitung nach ADR-0030`. Der Slug ändert sich dabei **nicht**
(ADR-0011), und die Suche findet weiterhin beide Schreibweisen.

### Sammelbar vs. Software

**Die Kategorie `Spiele` enthält keine Sammelobjekte, sondern Konsolenspiele.** Sie existiert
genau einmal je Serie, immer an Position 0, und umfasst **39 der 600 öffentlichen Einträge**.

| | |
|---|---:|
| aktive Einträge gesamt | 600 |
| davon Kategorie `Spiele` | 39 |
| **sammelbar** | **561** |

Diese Einträge bleiben kanonische Daten — sie haben SKY-IDs, Preise und stehen in der Excel.
Sie sind aber **kein Teil des Sammlerkatalogs** und dürfen keinen Sammlungsfortschritt
verfälschen. PortalVault filtert sie über die **Kategorie**, nicht über Namen:
`src/lib/catalog/collectible.ts`.

**An den echten Daten geprüft (2026-09-04):** genau 6 Kategorien heißen `Spiele`, alle an
Position 0; sie enthalten 39 Einträge, ausnahmslos Konsolensoftware; **kein** spielartiger
Eintrag steht in einer anderen Kategorie; **kein** Sammelobjekt steht in `Spiele`.

**Unabhängige Bestätigung:** Alle 39 Spiele haben **kein Bild**, während 534 der 561
sammelbaren Einträge eines haben. Die Legacy-Bildpipeline hat Software nie ein Bild zugeordnet
— ein zweites, völlig anderes Signal, das dieselbe Menge markiert.

> ⚠️ **Kopplung:** Die Kategorienamen kommen aus `etl/categories.py` im Legacy-Projekt. Wird
> `Spiele` dort umbenannt, gelangt Software stillschweigend zurück in den Katalog. Bei einer
> Umbenennung ist `NON_COLLECTIBLE_CATEGORIES` in `src/lib/catalog/collectible.ts`
> mitzuführen. Der Test `collectible.test.ts` hält die Menge bewusst auf genau einem Eintrag
> fest, damit eine Erweiterung eine bewusste Handlung bleibt.

### Varianten: uneinheitliche Schreibweise in der Quelle

Dieselbe Art Information steht im Katalog in zwei Formen:

```
Legendary Astroblast     Präfix
Hex (Pearl)              Suffix in Klammern
Grim Creeper - Lightcore Suffix mit Bindestrich
Chill Light Core         Suffix ohne Trennzeichen
```

PortalVault **ändert daran nichts** — die Namen bleiben roh. Für die Anzeige wird eine
einheitliche Form **abgeleitet** (ADR-0030): Ein führendes Token wird zum Klammersuffix, aber
nur wenn die Basisfigur in derselben Serie existiert. 55 der 561 sammelbaren Einträge sind
betroffen.

Bewusst **nicht** angetastet: `Dark Sword` (Traps heißen `<Element> <Form>`), `Golden Queen`,
`Elite …` (eigene Produktlinie), und `Legendary Grim Creemper` — dort ist die Basis als
`Grim Creeper` geschrieben, ein **Tippfehler in der Excel**. Wird er dort korrigiert, greift
die Regel von selbst.

Offen als eigene Datenqualitätsfälle: die drei LightCore-Schreibweisen und die uneinheitliche
Bindestrich-/Leerzeichen-Schreibung bei `Eye Brawl` / `Eye-Brawl` und `Wham Shell` /
`Wham-Shell`.

**Regel: Kategorienamen kommen ausschließlich vom Nutzer.** Sie werden nicht umbenannt,
nicht vereinheitlicht, nicht übersetzt und nicht umsortiert — auch dann nicht, wenn der Nutzer
in einer Nachricht beiläufig eine andere Bezeichnung verwendet. Sortierung innerhalb einer
Kategorie: alphabetisch (`localeCompare` mit `de`).

---

## 4. Öffentlich vs. intern

Über Sichtbarkeit entscheidet **ausschließlich `etl/articles.py::is_public()`**:

```python
PUBLIC = ['SA', 'G', 'SF', 'T', 'SC', 'I']
INTERNAL_SUFFIXES = (' - BESCHÄDIGT', ' - OBERTEIL', ' - UNTERTEIL')

def is_public(article):
    if article['sheet'] not in PUBLIC:      return False
    if article['name'].endswith(INTERNAL_SUFFIXES): return False
    return True
```

820 SKY-IDs gesamt → 614 in den sechs Serien → **minus 14 interne Lagerpositionen** = **600
öffentliche Artikel**. `ZB` und `DI A` haben IDs, sind aber nicht öffentlich.

| | öffentlich | intern |
|---|---|---|
| Bild, Name, Serie, Kategorie, Marktpreis | ✅ | ✅ |
| Verfügbarkeit | nur `true`/`false` | echte Stückzahl |
| Gesamt / Verkauft / Verfügbar | ❌ | ✅ |
| `- BESCHÄDIGT` / `- OBERTEIL` / `- UNTERTEIL` | ❌ | ✅ |
| Disney Infinity (`DI A`), Zubehör (`ZB`) | ❌ | ✅ |
| private Sammlung (P/Q/R/S, U/V/W/X) | ❌ | in der Excel |
| Order 2025/2026 (Käuferdaten), EÜR | ❌ | in der Excel |
| Mappings, Logs, Scraper-Logik | ❌ | ✅ |

**Durchsetzung, nicht Verstecken:** Keine UI-Komponente filtert eigenständig, nichts wird per
CSS ausgeblendet. Interne Daten sind gar nicht erst im Bundle. `etl/extract.py::guard_public()`
ist die letzte Bremse vor dem Schreiben: verbotene Feldnamen (`stock`, `total`, `sold`,
`inventory`, `collection`, `duplicates`, `buyer`, `quantity`), `available` muss **boolesch**
sein (ein `int` würde die Stückzahl verraten), keine fremden Serien, keine internen Suffixe,
keine ID-losen Artikel.

**Dieses Prinzip gilt in PortalVault weiter** — dort als: interne Daten kommen gar nicht erst
in die PostgreSQL-Datenbank.

---

## 5. Öffentlicher Export (`site/data/products.json`)

Der einzige Datensatz aus dem Legacy-Projekt, der bereits vollständig öffentlich ist.

```json
{"generated":"2026-08-10 23:50","currency":"EUR",
 "series":[{"code":"SA","label":"Spyro's Adventure","year":2011,"categories":[...]}],
 "items":[{"id":"SKY-0001","name":"Game (PC)","series":"SA","category":"Spiele",
           "categoryIndex":0,"price":null,"image":null,"available":false,
           "ebay":{"itemId":null,"url":null}}]}
```

Zahlen (Datenstand 2026-08-10):

| | |
|---|---:|
| öffentliche Artikel | 600 |
| davon mit Marktpreis | 585 |
| davon mit Bild | 534 |
| `available: true` | 226 |
| Preisspanne | 0,89 € – 999,00 € |

**Namenseigenheiten (nicht korrigieren!):**
- Namen sind **innerhalb einer Serie eindeutig**, **global aber nicht** (32 Mehrfachnamen,
  z. B. `Bash` in SA und G, `Game (Xbox 360)` 6×). → Slugs müssen serienabhängig gebildet werden.
- 72 Namen mit Klammern (`Game (PC)`, `Elite Boomer (2)`), 22 mit ` - ` (`Elite Boomer - ohne OVP`).
- Einziges Nicht-ASCII-Zeichen: `ü`. Keine führenden/abschließenden Leerzeichen.
- `Elite … - ohne OVP` ist **öffentlich** — nur die drei Suffixe aus `INTERNAL_SUFFIXES` sind intern.

---

## 6. Bilder

```
images/master/<sha256[:16]>.png    verlustfrei, Master, wird nie ersetzt   (554 Dateien, 430 MB)
site/img/<sha256[:16]>.webp        Derivat, max. 640 px, cwebp -q 80       (475 Dateien, 11 MB)
data/images.json                   SKY-ID → Masterdatei                    (634 Zuordnungen)
```

- Der Dateiname ist der **SHA-256 des Bildinhalts** (erste 16 Hexzeichen). Er hängt nie vom
  Artikelnamen ab, beweist den Inhalt und dedupliziert geteilte Bilder automatisch.
- **63 Masterdateien werden von 143 Artikeln geteilt** (n:1), z. B. vier *Fire Bone Hot Dog*-
  Varianten. Unter den 600 öffentlichen Artikeln: 44 Dateien werden von 103 Artikeln geteilt.
- 534 Zuordnungen betreffen öffentliche Artikel, 100 gehören zu `ZB` / `DI A` → für diese
  entstehen bewusst **keine** Website-Bilder.
- Eine Masterdatei wird nur gelöscht, wenn **kein** Artikel sie mehr referenziert.
- Verwaltung: `etl/set_image.py show|set|remove <SKY-ID>`, Derivate erzeugt `etl/build.py`.
- Verwaiste Derivate in `site/img/` werden beim Build entfernt.

**Migrationsregel:** Die Zuordnung SKY-ID → Dateiname ist ein Datenwert, kein Ableitungsergebnis.
Sie muss 1:1 erhalten bleiben. Der content-adressierte Dateiname wird **nicht** umbenannt —
er ist die Bildidentität und macht unveränderliche Caches und einen späteren Wechsel des
Speicherorts trivial.

---

## 7. Marktpreise und Preisupdate

**Marktpreis = Spalte I.** Spalte J (`= I × 0,9`) ist der eBay-Erlös nach Gebühren und
**kein** Kundenpreis — wird nie exportiert.

Preisupdate (`etl/update_prices.py`, Admin-CLI, nie im Browser):

```
externer Artikel → explizites Mapping → SKY-ID → Excel-Zeile → Spalten H und I
```

- Quelle: `easybuy-shop.de`, je Serie eine oder mehrere Collection-Seiten.
- **Mapping-Schlüssel ist `(Serie, externer Titel)`** — derselbe Figurenname existiert in
  mehreren Serien (`Bash` in SA und G), ein globaler Index wäre mehrdeutig.
- Mapping-Datei: `data/mappings/easybuy-shop.de.json` — 393 gemappt, 8 unmatched, 0 ignored.
- **Kein Fuzzy-Matching, keine Ähnlichkeitssuche, kein Namensvergleich.**
  Nicht auflösbar → Artikel überspringen, in `data/logs/price-updates/*_unmatched.json`
  protokollieren (`reason: "no_mapping"`), Lauf läuft normal weiter.
  **Ein fehlendes Preisupdate ist ausdrücklich besser als eine falsche Zuordnung.**
- **Harte Abbrüche** (technische Fehler): doppelte SKY-ID, Mapping auf nicht existierende
  SKY-ID, ein Titel auf zwei SKY-IDs derselben Serie, beschädigte XLSX, Änderung außerhalb H/I.
- Externe Titel sind reine Matching-Daten und ersetzen **niemals** den Namen aus Spalte B.
- Die Zeile wird immer über die SKY-ID bestimmt, **nie** über den Namen.

Letzter produktiver Lauf (2026-08-10 23:18:59): 401 gefunden, 393 gemappt, 8 unmatched,
**1 Preisänderung** (SKY-0148 Bash 32,99 → 29,99 ↓). Hash vorher/nachher protokolliert.

### Analyse der Preisquelle (2026-09-04, read-only)

**Drei Generationen derselben Aufgabe:**

| | Ort | Matching | Zustand |
|---|---|---|---|
| 1. Generation | `~/Documents/update.py` (228 Zeilen, Stand 2026-07-28) | `items[title]` gegen Spalte B — **rein über den Namen, kein persistentes Mapping** | existiert noch, historische Referenz, bleibt unverändert |
| 2. Generation | `../webpage/etl/update_prices.py` (906 Zeilen) | explizites, persistentes Mapping `(Serie, externer Titel) → SKY-ID` | im Einsatz |
| 3. Generation | PortalVault — **noch nicht gebaut** | `Handle → SKY-ID` (ADR-0024) | Zielmodell |

Die 1. Generation nutzte `openpyxl` und schrieb über `wb.save()` — genau das, was die
2. Generation bewusst ersetzt hat, weil es die dynamischen Array-Metadaten der Order-Sheets
zerstört hätte.

**Zentraler Befund.** Das heutige Mapping ist explizit und dauerhaft, aber sein **Schlüssel ist
der Titel**. Benennt Easybuy ein Produkt um, bricht die Zuordnung und der Artikel landet
stillschweigend in `unmatched` — der Preis bleibt einfach alt, ohne dass etwas fehlschlägt.

Zugleich speichert das Mapping für **alle 393** Einträge bereits eine Produkt-URL. Der daraus
extrahierbare **Shopify-Handle ist über alle 393 hinweg eindeutig** — anders als der Titel, der
ohne die Serie mehrdeutig ist. Schematisch, ohne konkrete Zuordnung:

```
Titel  'Bash'  ->  mehrdeutig, kommt in zwei Serien vor
Handle .../products/<...>-<serie>-<figur>  ->  eindeutig, die Serie steckt meist im Pfad
```

Der Titel allein braucht die Serie als zweiten Schlüsselteil; der Handle nicht.
Die konkreten Zuordnungen bleiben im Legacy-Projekt (`docs/SECURITY.md`).

**Der Handle wird also bereits erfasst, aber nicht zum Matching verwendet.** Die stabilere
Kennung liegt vor; sie muss nur zum Schlüssel werden. Die Query-Parameter `_pos`, `_fid`, `_ss`
in den gespeicherten URLs sind Paginierungsartefakte und gehören abgeschnitten.

In 358 von 393 Handles steckt die Serie bereits im Pfad, bei 35 nicht — der Handle ersetzt also
nicht die Serienzuordnung, ist aber ein eindeutiger Schlüssel.

**Die 8 offenen `unmatched`-Einträge** sind Portale (5×) und Elite-Karten (3×) — Artikel, die es
im PortalVault-Katalog so nicht gibt. Sie sind kein Mapping-Fehler, sondern Sortimentsdifferenz.

Zielmodell und Konsequenzen: **ADR-0024**.

---

## 8. Ankauffaktor (Legacy-Geschäftslogik)

`Summary!E23` → `='Order 2026'!I2` → `=1/(H2/B2)` = Ausgaben ÷ Marktwert der eingekauften Ware.
Aktuell **0,3336060810658524 (33,36 %)**. Bewusst wird `Summary!E23` gelesen, nicht das
Order-Sheet direkt — die Summary-Zelle ist der fachliche Anker und zeigt aufs jeweils aktuelle Jahr.

Validierung beim Build: vorhanden, numerisch, `0 < x < 1` — sonst **Abbruch**. Nie ein
Standardwert, nie eine Schätzung, nie der letzte bekannte Wert.

Frontend (`site/js/pricing.js`):

```
Marktwert      = Σ round2(Preis × Menge)
Ankaufangebot  = round2(Marktwert × Ankauffaktor)
```

> **Für PortalVault:** Der Ankauffaktor ist eine **abgeleitete Geschäftskennzahl des Nutzers**
> (Ausgaben ÷ Marktwert seines Einkaufs). Er gehört nicht in eine Sammlerplattform und wird in
> V1 **nicht** migriert. Siehe `docs/DECISIONS.md` ADR-0008.

---

## 9. Sammlungs-/Selection-Logik (Legacy-Frontend)

`site/js/selection.js`: Auswahl im `localStorage`, Schlüssel `skylanders.selection.v1`,
Inhalt ausschließlich `{ SKY-ID: Menge }` — keine Produktdaten, keine Filter.
Leere Auswahl → Eintrag wird entfernt. Beschädigter Eintrag → leere Auswahl.
`localStorage`-Fehler (privater Modus) werden abgefangen.

`site/js/pricing.js` ist **DOM-frei** und liefert mit `Pricing.evaluate()` bereits die
vollständige Struktur inkl. `purchaseRate`, damit ein altes Angebot nachvollziehbar bleibt.

**Wichtige fachliche Regel, die in PortalVault gilt:**
Die Stückzahl des Nutzers ist **nicht** der Lagerbestand. Sie beschreibt seine eigene Sammlung,
ist nach oben nicht begrenzt, und Figuren mit `available: false` bleiben auswählbar.

In PortalVault ersetzt die Datenbank den `localStorage` als Speicherort der Sammlung.
Das Konzept „Auswahl ist nur `{SKY-ID: Menge}`, Produktdaten werden nie kopiert" bleibt.

---

## 10. Legacy-Tests (134 Prüfungen, 5 Suiten)

| Suite | Umfang |
|---|---|
| `migration/verify.py` | 41 Daten- und Migrationsprüfungen |
| `migration/build_checks.py` | 18 Ankauffaktor-Tests |
| `migration/mapping_checks.py` | 17 Zuordnungstests |
| `migration/frontend_checks.js` | 18 Bundle-Prüfungen |
| `migration/ui_checks.js` | 40 UI-/Rechentests |

`verify.py` prüft u. a.: 820 IDs, keine fehlende/doppelte/ungültige ID, exakt 600 öffentliche
Artikel, 14 ausgeschlossene interne Positionen, `available` überall boolesch, keine
Lagerbegriffe/Scraper-Details/Order-Daten in deployten Dateien, Bildzuordnungen vollständig
und ohne Waisen, geteilte Bilder erhalten (63/143), Excel-Struktur unverändert
(nur A/H/I geändert, `XLDAPR` erhalten, 5.464 `cm=`-Zellen intakt), Backup-Hash unverändert.

**Diese Prüfideen sind wertvoller als der Code.** Sie werden in PortalVault als Import-
Validierung neu implementiert, nicht kopiert (siehe Abschnitt 12).

---

## 11. Was niemals nach PortalVault / GitHub darf

| Legacy-Pfad | Grund |
|---|---|
| `skylanders.xlsx` | enthält Käuferdaten (Order), EÜR, private Sammlung, Lagerzahlen |
| `backup/*.xlsx` | 430 MB Original mit allen Bildern und denselben internen Daten |
| `data/inventory.json` | 820 echte Lagerstückzahlen |
| `data/mappings/` | Zuordnung zur externen Preisquelle (Geschäftsgeheimnis) |
| `data/logs/price-updates/` | Laufprotokolle inkl. Quell-URLs und Datei-Hashes |
| `data/ebay.json` | Verkaufslistings |
| `etl/update_prices.py` | Scraping-Logik, Quell-URLs, User-Agent |
| `images/master/` | 430 MB — gehört nicht in Git (die Derivate genügen) |
| Spalten D/E/F, L/M/N, P/Q/R/S, U/V/W/X | Lager, Werte, private Sammlung |
| Sheets `Order 2025/2026`, `EÜR 2025/2026` | Käuferdaten, Buchhaltung |
| Serien `ZB`, `DI A` | in V1 nicht öffentlich |
| Ankauffaktor `Summary!E23` | abgeleitete Geschäftskennzahl |

Vollständige Security-Regeln: `docs/SECURITY.md`.

**Diese Liste bleibt vollständig gültig, auch wenn später ein First-Party-Shop kommt**
(ADR-0032). Ein späterer Shop-Import würde **eine** Größe brauchen — den aktuellen
Lagerbestand `D` aus dem **Store**-Block (Spalte F) — und zwar direkt in die Datenbank,
niemals über das Repository und niemals über den Katalogpfad `products.json`. `O` und `S`
(Spalten D/E) sind historische Geschäftskennzahlen und höchstens für spätere Analytics
interessant. **Die privaten O/C/S/D-Blöcke (P/Q/R/S, U/V/W/X) sind dabei zu ignorieren** —
sie beschreiben die persönliche Sammlung, nicht das Geschäftsinventar.

Bevor so ein Import je gebaut wird, ist die Spaltenzuordnung **read-only neu zu verifizieren**
statt aus dieser Tabelle übernommen zu werden: Sie stammt aus der Legacy-Analyse vom
2026-09-03, und eine Excel-Struktur kann sich ändern. **Es existiert keine solche Importlogik,
und sie ist nicht freigegeben.**

---

## 11a. Charaktermetadaten (Pilot, seit 2026-09-04)

Der Katalog kennt seit Migration 0002 eine zweite Identitätsebene: den **Charakter**
(ADR-0034). Sie beantwortet, dass SKY-0028, SKY-0156 und SKY-0157 dieselbe Figur meinen —
Drobot, dreimal aufgelegt.

**Kuratierungsregeln:**

1. **Zuordnungen werden von Hand gemacht, nie aus Namen abgeleitet.** An den echten Daten
   scheitert jede Namensregel: `Drobot Light Core` (Charakter steht vorn), `Dark Turbo Charge
   D.K.` (Abkürzung), `Legendary Grim Creemper` (Tippfehler), `Dino-Rang` vs. `Elite Dino Rang`
   (Bindestrich), `Bone Bash Roller Brawl` (enthält „Bash", gehört zu Roller Brawl),
   `Mini Drobit` (eigener Charakter). Vollständige Liste in ADR-0034.
2. **Eine SKY-ID gehört zu höchstens einem Charakter.** Das Werkzeug weist Doppelzuordnungen ab.
3. **`NULL` heißt „nicht zuverlässig bekannt", nie „keins".** Kaos hat als Sensei ein eigenes
   Kaos-Element außerhalb der zehn — deshalb steht dort `null` und keine Erfindung. Chill und
   Star Strike haben keine gesicherte Spezies.
4. **Beschreibungen schreibt SkyIsles selbst.** Externe Quellen dienen der Faktenprüfung; kein
   Absatz, kein Satz wird übernommen. Der 600-Zeichen-CHECK setzt das durch.
5. **Jeder Charakter trägt eine primäre Quelle** (`source_url`, `source_label`, `verified_at`).
   Eine Quellentabelle gibt es bewusst nicht — eine Quelle je Charakter reicht, bis das
   Gegenteil belegt ist.
6. **Nicht-Charakter-Objekte bleiben `character_id = NULL`.** Traps, Fahrzeuge,
   Kreationskristalle, Magic Items, Locations und Trophies sind keine Charaktere mit fehlenden
   Feldern.

**Pflegeweg:** `data/characters/characters.json` → `npm run characters:import -- --apply`.
Die Datei liegt versioniert im Repository; Git ist damit die Änderungshistorie. Sie enthält
ausschließlich öffentliche Produktinformation und fällt **nicht** unter Abschnitt 11
(`docs/SECURITY.md` erläutert die Abgrenzung).

**Der Katalogimport rührt sie nicht an** und kennt `character_id` nicht. Ein Reset der
Datenbank löscht die Charaktere; die JSON-Datei ist der Wiederherstellungsweg.

**Pilotumfang:** 19 Charaktere, 104 der 561 Sammelobjekte (18,5 %). Bewusst nach Schwierigkeit
ausgewählt, nicht nach Bekanntheit — Eon's Elite, LightCore in drei Schreibweisen,
Series-2/3-Umbenennungen, Tippfehler, Abkürzungen und zwei Fälle, in denen derselbe Name
verschiedene Objekte meint.

---

## 11b. Verpackungs- und Zweitexemplarzeilen im Katalog (read-only Befund, 2026-09-05)

**46 der 561 Sammelobjekte sind 16 Gruppen derselben physischen Figur.** Gefunden bei der
Shop-Architekturanalyse, ausschließlich lesend.

| Muster | Zeilen | Beispiel |
|---|---|---|
| `Elite X` / `Elite X - ohne OVP` / `Elite X (2)` | 42 (14 Gruppen) | `Elite Boomer` 69,99 € · `- ohne OVP` 27,99 € · `(2)` ohne Preis |
| `Kaos` / `Kaos in OVP` | 2 | 34,99 € · 54,99 € |
| `Dark Pyramid` / `Dark Pyramid - OVP` | 2 | 24,99 € · 29,99 € |

**Klassifikation** — nur so weit, wie die Daten sie tragen:

| Zeilen | Einschätzung |
|---|---|
| 14 × `- ohne OVP`, `Kaos in OVP`, `Dark Pyramid - OVP` | **wahrscheinlich Verpackungs-/Zustandsvariante** — dieselbe Figur, anderer Preis |
| 14 × `(2)` | **wahrscheinlich Zweitexemplar**, also eine Menge; 8 davon haben gar keinen Marktpreis |
| `Double Trouble 1.5` (SKY-0153) | **unklar** — eigener Preis (17,99 € gegen 3,49 €), aber keine erkennbare Regel |
| Klammersuffixe wie `(Pearl)`, `(Easter)`, `(Clear Crystal)` | **echte Sammelobjekte** — Farb- und Aktionsvarianten, keine Verpackung |

**Bestandslage dieser Zeilen** (nachgezählt 2026-09-05, `O`/`D` aus dem Geschäftsblock):

| Gruppe | je eingekauft | heute im Bestand |
|---|---|---|
| 14 × `- ohne OVP` | 3 (SKY-0011, **SKY-0049**, SKY-0083) | **1** (SKY-0049 Elite Slam Bam) |
| 14 × `(2)` | 0 | 0 |
| `Kaos in OVP`, `Dark Pyramid - OVP` | 0 | 0 |
| zugehörige Grundzeilen `Kaos`, `Dark Pyramid` | je 1 bzw. 2 | je 1 |

Die Verpackungszeilen sind also **überwiegend** Preisbeobachtungen, aber nicht ausschließlich:
Der Zustand wird real bepreist **und** vereinzelt real bevorratet. Genau deshalb bekommt
`shop_inventory` eine `condition`-Dimension statt zweiter SKY-IDs (ADR-0037) — beim Import wird
aus `SKY-0049 Elite Slam Bam - ohne OVP` der Bestand `Elite Slam Bam · loose`.

**Nichts wurde geändert.** Keine Umbenennung, keine SKY-ID angefasst, kein Ausschluss.

**Der Shop löst das nicht mit.** `shop_inventory` bekommt eine `condition`-Dimension
(`loose` / `boxed`, ADR-0037 § 5), damit dieselbe Figur in zwei Verpackungszuständen verkauft
werden kann, **ohne** eine zweite SKY-ID. Für den Sammlerkatalog ändert das nichts: Solange
diese Zeilen dort stehen, zählen sie zu den 561 Sammelobjekten, beeinflussen die Completion und
können eigene Sammlungseinträge haben.

> **Collector catalog normalization of packaging/duplicate legacy rows remains a separate
> future cleanup decision.**

Dieser spätere Schritt — **Collector Catalog Normalization** — entscheidet, welche OVP-Zeilen
aus der Completion verschwinden, welche `(2)`-Zeilen reine Legacy-Duplikate sind, welche echten
Varianten bleiben, wie Zustandspreise erhalten bleiben, ob die Zahl 561 sinkt und ob bestehende
`collection_items` migriert werden müssen. **Er ist kein Blocker für das Shop-Fundament.**

## 11c. Geschäftsbestand in der Excel (read-only Befund, 2026-09-05)

Kopfzeile der sechs Serienblätter, an der echten Datei verifiziert:

| Spalte | Kopf | Bedeutung |
|---|---|---|
| A | — | SKY-ID |
| B | Serienname | Artikelname |
| **D** | **O** | Geschäft: jemals eingekauft |
| **E** | **S** | Geschäft: verkauft |
| **F** | **D** | Geschäft: aktueller Bestand (`= D − E`) |
| I | Market | Marktpreis |
| J | eBay | eBay-Faktor |
| L/M/N | OVERALL / SOLD / DUPLICATES | Geschäftswerte (Geld) |
| **P/Q/R/S** | **O / C / S / D** | **private Sammlung** — beim Shopimport zu ignorieren |
| U/V/W/X | OVERALL / COLLECTION / SOLD / DUPLICATES | private Sammlung (Werte) |

Artikel ab Zeile 4; Zeile 1 Kopf, Zeile 2 Summen.

**Datenqualität über alle sechs Blätter:** 614 Artikelzeilen, **alle** mit gültiger SKY-ID ·
600 davon im öffentlichen Export, 561 sammelbar · `D` fehlt **nie**, ist **nie negativ** ·
`O − S = D` gilt **ausnahmslos** · 234 Positionen mit Bestand über null.

**Die 234 Bestandspositionen zerfallen in drei Gruppen:**

| | Anzahl | Bedeutung für den Shop |
|---|---|---|
| sammelbare Katalogfiguren | **218** | der eigentliche Shopbestand |
| Software (Spiele) | 8 | im Sammlerkatalog ausgeschlossen (ADR-0029), verkäuflich wäre sie trotzdem |
| interne Halbfiguren (`- OBERTEIL`, `- UNTERTEIL`) | 8 | gar nicht im öffentlichen Export — SWAP-Force-Hälften |

**Entschieden (ADR-0037 § 5c): Shop V1 verkauft weder die Halbfiguren noch die Software.**

Die acht Halbfiguren — SKY-0204, SKY-0214, SKY-0216, SKY-0220, SKY-0224, SKY-0229, SKY-0231,
SKY-0238 — bleiben interne Legacy-Bestandspositionen: kein Shoplisting, kein öffentliches
Produkt, **kein neuer Katalogeintrag**. Die acht Softwaretitel bleiben nach ADR-0029 außerhalb
des Sammlerkatalogs und werden dafür nicht reaktiviert.

Damit verkauft Shop V1 ausschließlich reguläre, ohnehin öffentliche Sammelobjekte — und genau
deshalb braucht die erste Fassung **kein** kuratiertes Sichtbarkeitsfeld neben `is_active`.
Ein späterer Verkauf dieser 16 Positionen wäre ein eigener Produktentscheid.

## 11d. Einstandswert im Legacy-Bestand (read-only Befund, 2026-09-05)

Untersucht wurde, ob beim späteren Bestandsimport Kosteninformation verloren ginge, wenn nur
SKY-ID, `condition` und Menge übernommen werden.

**Wo Einkaufsdaten überhaupt liegen:** in den Blättern `Order 2025` und `Order 2026`, jeweils
links ein Einkaufsblock, rechts ein Verkaufsblock. Die sechs Serienblätter enthalten **keine
einzige Kostenspalte** — nur `O`/`S`/`D` und Marktwerte.

| Frage | Befund |
|---|---|
| Einkaufspreise vorhanden? | **ja, aber nur je Einkaufsereignis** (`Ausgaben` / `Expenses`) |
| Einkaufsereignisse | 68 (2026) + 87 (2025) |
| Artikelzeilen darunter | 1 818 (2026) + 1 656 (2025), Freitextnamen mit Stückzahl |
| Stückgenauer Einkaufspreis | **existiert nirgends** — keine Spalte, in keinem Blatt |
| SKY-ID in einem Order-Blatt | **0 Treffer** in allen vier Order-/EÜR-Blättern |
| Lieferant / Verkäufer beim Einkauf | nicht erfasst |
| Kaufdatum | ja, je Ereignis |
| Marktwert je Stück beim Einkauf | ja (`Markw. E`) — Marktwert, **nicht** Einstand |
| `Faktor` je Ereignis | ja, `Ausgaben / Marktwert`, in 68/68 Fällen rechnerisch stimmig; Spanne 0,16–0,66 |

**Zuordenbarkeit Bestand → Anschaffung.** Es gibt keinen Schlüssel: Einkaufszeilen tragen
Freitextnamen, keine SKY-ID, und keine Charge. Von den 234 Bestandspositionen taucht der
Katalogname bei **172 (73,5 %)** überhaupt in einer Einkaufsliste auf, davon bei **132 (56,4 %)**
mit im Katalog eindeutigem Namen; **62 (26,5 %)** kommen in keiner Einkaufsliste vor. Selbst
bei einem Treffer wäre nur bekannt, *dass* der Artikel einmal in einem Einkauf enthalten war —
nicht zu welchem Preis, in welcher Charge und ob dieses Exemplar noch das gleiche ist.

**Damit gilt:** Einkaufshistorie existiert nur als Summe je Einkauf. Mehrfache
Einkaufspreise derselben Figur sind nicht auflösbar. **FIFO, LIFO und Einzelzuordnung sind aus
dem Bestand heraus nicht rekonstruierbar** — für **alle 234 Positionen (100 %)** fehlt ein
belegbarer Einstandswert.

Der Legacy-Site-Build kennt nur eine einzige globale Kennzahl (`purchaseRate` aus
`Summary`, ein Skalar zwischen 0 und 1) — eine Gesamtquote, kein Einstandswert je Position.

**Bewertung.** Ein Einstandswert könnte rechnerisch aus `Marktwert je Stück × Faktor des
Einkaufs` geschätzt werden. Das wäre eine **Erfindung**, kein Beleg: Es setzte eine Zuordnung
voraus, die es nicht gibt, und lieferte eine Zahl, die nach einer Buchhaltungsangabe aussieht,
ohne eine zu sein. **Nicht tun.** Ein ehrliches „nicht bekannt" ist für jede spätere
steuerliche Betrachtung mehr wert als ein plausibel aussehender Schätzwert.

**Keine personenbezogenen Daten wurden ausgewertet.** Die Verkaufsblöcke enthalten unter anderem
eine Käuferspalte; sie wurde nicht gelesen und wird nie importiert.

## 11e. Der Legacy-Anfangsbestand — Werkzeug und Regeln (2026-09-06)

Werkzeug: `tools/import-legacy-inventory.mts`, `npm run inventory:import-legacy`. Dry Run ist
die Vorgabe, `--apply` schreibt. Vollständige Begründung in **ADR-0044**.

**Verpackung: es gibt keine Information darüber (read-only Befund).** Über alle sechs
Serienblätter existiert **keine** Verpackungsspalte, kein Kennzeichen und keine Relation. Von den
218 Bestandszeilen im Sortiment trägt **genau eine** einen Verpackungshinweis im Namen —
`SKY-0049 "Elite Slam Bam - ohne OVP"`, Bestand 1 —, und deren Excel-Name ist identisch mit
ihrem Katalognamen: Sie **ist** bereits eine eigene SKY-ID. Wo die Legacy-Daten Verpackung
unterscheiden, tun sie es also über die Identität, nicht über ein Attribut (vgl. 11b).

**Daraus folgt: alles wird als `loose` gebucht** — als benannte Annahme, nicht als erfundene
Präzision, und ohne jede Namensheuristik. Eine spätere Korrektur einzelner Positionen auf
`boxed` sind zwei gewöhnliche Bewegungen im Adminbereich.

**Was gelesen wird:** A (SKY-ID), B (Name — nur für den Bericht), D/E (nur zur Prüfung
`D − E = F`), F (Bestand). **Was nie gelesen wird:** P–S und U–X (private Sammlung und deren
Werte), `Order 2026/2025`, `EÜR 2026/2025`. Die Serienblätter werden über eine **Positivliste**
geöffnet — ein Blatt wird gelesen, weil PortalVault eine Serie dieses Namens kennt; die
Order- und EÜR-Blätter werden dadurch nie erreicht, nicht bloß übersprungen. Vor dem Import
prüft das Werkzeug die Kopfzeile (`O`, `S`, `D` in D/E/F); eine eingefügte Spalte bricht den
Lauf ab.

**Ausgeführt am 2026-09-06 (gegen die echte Arbeitsmappe):**

| | Positionen | Stück |
|---|---|---|
| Artikelzeilen gesamt | 614 | — |
| davon mit Bestand | 234 | 785 |
| **importiert (Sammlerartikel, `loose`)** | **218** | **762** |
| ausgeschlossen: Software (ADR-0029) | 8 | 10 |
| ausgeschlossen: SWAP-Hälften ohne Katalogzeile | 8 | 13 |
| ausgeschlossen: aufbewahrte Audit-Fixtures | 0 | 0 |
| ausgeschlossen: inaktiv | 0 | 0 |

`D − E = F` gilt in allen 614 Zeilen, keine doppelte SKY-ID, kein negativer Bestand.
Gegenprobe: `webpage/data/inventory.json.available` stimmt für alle 614 Zeilen mit Spalte F
überein.

**Nach dem Import gegen die Datenbank geprüft:** 218 Positionen mit `initial_import`, Summe der
Anfangsmengen 762, alle `loose`, alle `unit_cost`/`currency` NULL, alle `created_by` NULL
(Systemweg), keine gelistet, kein `sale_price`, höchstens eine Eröffnungsbuchung je Position.
`SUM(inventory_movements.delta) = shop_inventory.quantity` gilt für alle Positionen.

**Wie geschrieben wird.** Eine `initial_import`-Bewegung je Position über
`system_record_inventory_movement()` (nur `service_role`), also Bestand und Journalzeile in einer
Transaktion. **Niemals** ein direktes `quantity`. `unit_cost` bleibt NULL — die Systemfunktion
hat gar keinen Kostenparameter, und nach 11d gibt es für **keine** Position einen belegbaren
Einstandswert. `sale_price` bleibt NULL, `is_listed` bleibt `false`: Es wird nichts zum Verkauf
gestellt und kein Preis aus `market_price` abgeleitet.

**Zweimal laufen ändert nichts, und zwar sauber.** Ein zweiter identischer Lauf bucht nichts,
ändert keinen Bestand und endet mit Exit 0 (`218 already initial-imported · 0 changes`).
Entschieden wird je Position aus dem **Journal**, nie aus einem Fortschrittsstand:

| Zustand der Position | Entscheidung |
|---|---|
| existiert nicht | importieren |
| existiert, hat `initial_import` | überspringen |
| existiert, hat **keine** `initial_import` | **Konflikt** — nicht importieren, im Bericht genannt |

Der Konfliktfall schützt Bestand, den jemand von Hand führt: Addieren würde ihn verdoppeln,
ohne dass ein Fehler entstünde. Bricht ein Lauf nach 100 von 218 Positionen ab, importiert der
nächste genau die fehlenden 118 — jede Position ist eine eigene Transaktion. Alle Lesungen sind
paginiert (PostgREST liefert höchstens 1000 Zeilen). Der Unique-Index
`inventory_movements_one_initial_import` bleibt als **letzte** Sicherung bestehen.

## 12. Migrationsregeln für PortalVault

**Grundsatz: PortalVault liest niemals `skylanders.xlsx` direkt.**
Der Import geht ausschließlich über den bereits durch `guard_public()` geprüften öffentlichen
Export `site/data/products.json`. Damit kann strukturell keine interne Spalte in die neue
Plattform gelangen.

**Implementiert in V1.3:** `tools/import-catalog.mts`, gestartet mit `npm run catalog:import`.
Modi: Dry-Run (Standard, schreibt nichts) · `--validate-only` (ohne jeden Datenbankzugriff) ·
`--apply` (schreibt) · `--input <pfad>` (für Prüfungen gegen absichtlich kaputte Fixtures).

Ablauf:

```
[Legacy, read-only]                        [PortalVault]
skylanders.xlsx
   └─ webpage build  (nur der Nutzer)
        └─ site/data/products.json  ──kopieren──▶  data/catalog/products.<datum>.json
        └─ site/img/*.webp          ──kopieren──▶  public/images/skylanders/
                                                      │
                                                      ▼
                                        Import-Skript  →  PostgreSQL (upsert per SKY-ID)
```

**Verbindliche Importregeln:**

1. **Upsert ausschließlich über `sky_id`.** Niemals über Name, Slug oder Bild.
2. **Der Import erfindet niemals eine SKY-ID.** Unbekanntes Format → Abbruch.
3. **Der Import löscht niemals automatisch.** Ein Artikel, der im Export fehlt, wird
   protokolliert und ggf. auf `is_active = false` gesetzt — nie gelöscht (Sammlungen von
   Benutzern zeigen darauf).
4. **Namen roh übernehmen.** Kein `strip()`, keine Normalisierung, keine Übersetzung.
5. **Kategoriereihenfolge übernehmen** (`categoryIndex`), nicht neu sortieren.
6. **Slugs werden einmalig erzeugt und danach gespeichert**, nie bei jedem Import neu abgeleitet.
   Vollständige Regel: **ADR-0011**. Kurz: Umlaute ausschreiben, Apostrophe streichen,
   Klammerzeichen weg aber Inhalt behalten, Rest zu `-`; bei Kollision Serien-Slug aus dem
   Label anhängen, notfalls die SKY-ID. **Bestehende Slugs werden bei späteren Importen nie
   neu berechnet** — nur ein neu hinzukommender Artikel erhält bei Konflikt die qualifizierte Form.
7. **Bildzuordnung 1:1 übernehmen**, Dateinamen nicht umbenennen, n:1-Teilung erhalten.
8. **Nicht importiert werden:** `available`, `ebay`, `purchaseRate` (ADR-0008). `available`
   beschreibt den eigenen Legacy-Lagerbestand; eine Figur existiert in PortalVault unabhängig
   davon, ob sie im persönlichen Lager verfügbar ist.
9. **Dry-Run zuerst.** Jeder Import zeigt erst, was er täte; Schreiben nur nach Bestätigung.
10. **Nach dem Import validieren:** Anzahl, keine doppelte SKY-ID, kein interner Suffix,
    nur öffentliche Serien, alle Bildreferenzen auflösbar.

### Was das Importwerkzeug prüft

Die Validierung läuft **vollständig vor dem ersten Schreibvorgang**. Eine abgelehnte Eingabe
erreicht die Datenbank nie.

| Prüfung | Verhalten bei Verstoß |
|---|---|
| Struktur: `series[]` und `items[]` mit den erwarteten Feldtypen | Abbruch |
| Serien-Code `^[A-Z]{1,4}$`, Label nicht leer, Jahr 1990–2100, Code eindeutig | Abbruch |
| Zwei Serien mit demselben Slug | Abbruch |
| SKY-ID-Format `^SKY-[0-9]{4}$` | Abbruch |
| **Doppelte SKY-ID** (mit Angabe beider Positionen) | Abbruch |
| Name nicht leer, Serie bekannt | Abbruch |
| Kategorie für die Serie deklariert, `categoryIndex` passt zur Position | Abbruch |
| Preis `null` **oder** > 0, endlich, höchstens zwei Nachkommastellen | Abbruch |
| Bilddateiname content-adressiert (`^[0-9a-f]{16}\.webp$`) | Abbruch |
| Bilddateien tatsächlich unter `public/images/skylanders/` vorhanden | Warnung |
| Slug-Eindeutigkeit nach ADR-0011 | Abbruch |

**Erstmaliger Import am 2026-09-04 durchgeführt.** Eingabe: `products.json`, erzeugt vom
Legacy-Build am 2026-09-04 07:40. Geschrieben: 6 Serien, 30 Kategorien, 600 Figuren.
Anschließend mit 18 rein lesenden Prüfungen gegen die Datenbank verifiziert und die Idempotenz
durch einen zweiten Dry-Run belegt (`new 0, changed 0`). Details: `PROJECT_STATUS.md`.

**Verifiziert am 2026-09-04:** Neun absichtlich manipulierte Eingaben (doppelte SKY-ID,
ungültiges ID-Format, Preis 0, negativer Preis, Pfad statt Bildname, unbekannte Kategorie,
falscher `categoryIndex`, unbekannte Serie, leerer Name) wurden **alle** mit Exit-Code 1 und
einer präzisen Meldung abgelehnt; die echte Eingabe mit Exit-Code 0 akzeptiert.

### Sicherheitseigenschaften des Werkzeugs

- **Identität immer über `sky_id`**, niemals über den Namen.
- **Es wird nie gelöscht.** Figuren, die in der Datenbank stehen, aber im Export fehlen, werden
  aufgelistet und unangetastet gelassen.
- **Bestehende Slugs werden nie überschrieben.** Weicht der aus dem Namen berechnete Slug vom
  gespeicherten ab, gewinnt der gespeicherte; die Abweichung wird nur gemeldet (ADR-0011).
- **`profiles` und `collection_items` werden nicht angefasst.**
- **Idempotent:** Upserts über `sky_id`, Serien-Code und `(Serie, Kategoriename)`. Ein
  abgebrochener Lauf wird durch einen erneuten Lauf vollendet.
- Die Service Role ist nötig, weil der Katalog für Client-Rollen bewusst nicht schreibbar ist
  (ADR-0016).

---

## 13. Bewertung der Legacy-Bestandteile

| Bestandteil | Umgang |
|---|---|
| SKY-IDs, `id_ledger.json` | **A — unverändert erhalten**, kanonische Identität auch in PortalVault |
| `skylanders.xlsx` | **E — Legacy-Werkzeug**, bleibt Source of Truth für interne Geschäftsdaten |
| Produktstammdaten (Name/Serie/Kategorie/Preis) | **C — migrieren** nach PostgreSQL |
| Serien und Kategoriereihenfolge | **C — migrieren**, Namen unverändert |
| `data/images.json` | **C — migrieren** als Spalte auf der Skylanders-Tabelle |
| `site/img/*.webp` | **C — migrieren** nach `public/images/skylanders/`, Dateinamen unverändert (ADR-0009) |
| `images/master/*.png` | **E — Legacy**, bleibt Archiv/Quelle für Derivate; nie in Git |
| ETL (`xl.py`, `articles.py`, `extract.py`) | **E — Legacy-Werkzeug**, läuft weiter im alten Projekt |
| `is_public()`-Prinzip | **B — konzeptionell übernehmen**, in PortalVault als „gar nicht erst importieren" |
| `guard_public()`-Prinzip | **B — konzeptionell übernehmen** als Importvalidierung |
| Preisupdate + Mapping | **E — Legacy-Werkzeug** (kurzfristig), **D — langfristig ersetzen** |
| `data/inventory.json`, Lagerlogik | **F — niemals ins neue Repository** |
| `data/mappings/`, Logs, Scraper | **F — niemals ins neue Repository** |
| Ankauffaktor / Ankaufslogik | **F für V1** (Geschäftskennzahl), Neubewertung wenn Ankauf je Thema wird |
| `site/js/selection.js` | **B — Konzept übernehmen**, neu in TypeScript, Speicher = Datenbank |
| `site/js/pricing.js` | **B — Konzept übernehmen** (DOM-freie Rechenschicht), Formel V1 = nur Summe |
| `site/js/catalog.js`, HTML/CSS | **D — ersetzen** durch Next.js/Tailwind |
| Legacy-Tests | **B — Prüfideen übernehmen**, Code nicht kopieren |
| `bin/webpage` CLI | **E — Legacy**, PortalVault nutzt npm-Skripte |

Legende: A unverändert · B konzeptionell neu implementieren · C migrieren · D ersetzen ·
E Legacy-Werkzeug · F niemals ins neue Repository.

---

## 14. Bekannte Legacy-Eigenheiten (dokumentiert, nicht „repariert")

- `site/js/catalog.js:190` liest `item.alt`, das es in `products.json` nicht gibt. Die
  `escape()`-Funktion fängt `null`/`undefined` ab → Katalogkarten haben `alt=""`.
  Kein Fehler, aber ein Accessibility-Punkt, der in PortalVault besser gelöst werden sollte.
- Die `__pycache__`-Dateien im Legacy-Projekt stammen von Python 3.7.
- `cwebp` (`brew install webp`) ist die einzige externe Abhängigkeit der Bildpipeline.
- Offene Legacy-Punkte, die der Nutzer noch entscheiden wollte: 8 unmatched Artikel
  (Portale/Karten) als `ignored` markieren? · 108 Artikel mit Klammerzusätzen manuell mappen? ·
  `ZB`/`DI A` später integrieren? Diese Fragen betreffen das Legacy-Projekt, nicht PortalVault.
