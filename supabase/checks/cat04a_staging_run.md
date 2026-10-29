# Laufzettel CAT-04A — Staging-Probe: Katalogstatus mit fünf Entwürfen

> ## ÜBERHOLT SEIT CAT-04E — die Fünferladung ist kein eigenes Verfahren mehr
>
> Der Betreiber hat entschieden, den Katalog in **einem** Lauf zu
> vervollständigen. Die fünf hier geprüften Kandidaten sind in
> `supabase/operations/staging-cat03-import.sql` enthalten; die separate
> Fünfer-Hülle ist **gelöscht**, damit sie niemand versehentlich einfügt.
>
> **Was gültig bleibt:** die Auswahlbegründungen, die Bildprüfung und der
> **achtstufige Admin-Testplan** in Abschnitt 6 — der prüft den
> Entwurfs-Arbeitsablauf und braucht dafür genau eine Figur.
>
> Der Laufzettel für den einen Lauf: `supabase/checks/cat03_import_run.md`.

**Nichts davon ist ausgeführt.** Keine Migration, kein Schreibzugriff, keine
SKY-ID, kein Bild.

| | |
|---|---|
| Charge | `resources/analysis/cat-04-charge.json` — **genau fünf** benannte Kandidaten |
| Hülle | `supabase/operations/staging-cat-04a-import.sql` (erzeugt, **nicht gefahren**) |
| Probelauf | `npm run cat03:import:staging -- --charge resources/analysis/cat-04-charge.json` |
| Voraussetzung | `0152` auf Staging — `supabase/checks/0152_staging_run.md` |

---

## 1. Migrationsstand — gemessen, nicht angenommen

Am 2026-10-27 lesend gegen Staging geprüft:

| Objekt | Migration | Staging |
|---|---|---|
| `skylanders.catalog_status` | `0152` | **NEIN** (REST 400) |
| `availability_alerts` | `0150` | **NEIN** (404) |
| `offer_state` | `0146` | ja |
| `favorites` | `0145` | ja |
| `purchase_calculations` | `0142` | ja |

`0144` lässt sich über die REST-Schnittstelle **nicht** prüfen:
`system_platform_export()` verlangt eine Adminsitzung und antwortet dem
Dienstschlüssel mit `null`. Grundlage ist deshalb die Akte — `0144` lief am
**2026-10-25** auf Staging, mit Preflight, Nachkontrolle und einem echten
Plattformexport als Beleg (`supabase/migrations/APPLIED.md`).

### Was der Statustest wirklich braucht

**Genau eine Migration: `0152`.**

| Migration | Für diesen Test | Begründung |
|---|---|---|
| **`0152`** | **zwingend** | Ohne `catalog_status` gibt es keinen Entwurf. Setzt `0001`, `0004`, `0026`/`0077` und `0034`/`0041` voraus — alle liegen auf Staging |
| `0153` | **nicht nötig**, empfohlen danach | Sie nimmt `catalog_status` in die Plattformsicherung auf. Ohne sie käme ein Entwurf aus einem JSON-Archiv als `hidden` zurück. Setzt `0144` voraus (liegt auf Staging) |
| `0150` | **nein** | Verfügbarkeitsalarme. Keine gemeinsame Objektmenge mit `0152` |
| `0151` | **nein** | Nur die Sicht `offer_state_live`. Nennt `skylanders` nirgends |

**Die Reihenfolge, und sie ist kurz:**

```
0152                      ← der Test braucht nur das
  └→ 0153   (optional, danach, setzt zusätzlich 0144 voraus)

0151 → 0150               ← eigene Phase (ADR-0147), BERÜHRT DIESEN TEST NICHT
```

**Warum `0150`/`0151` gefahrlos ausbleiben dürfen** — das ist in CAT-02C
gemessen worden: die Schnittmenge der geänderten Objekte mit `0152` ist
**leer**, und der Basis-Vertrag, den `0142`–`0152` zeichengleich teilen, misst
sieben Zahlen, die alle an `catalog_visible` hängen. `0152` bewegt
`catalog_visible` für keine Zeile.

---

## 2. Die fünf Kandidaten

Aus 105 Entwürfen erfüllen **11** alle strengen Kriterien gleichzeitig:
eindeutige Edition (`card_type_unsicher = false`), vorhandene Grundfigur,
Kategorie **aus der Grundfigur** abgeleitet, Projektbild vorhanden. Aus diesen
elf sind fünf gewählt — je einer pro Spielserie und mit vier verschiedenen
`card_type`-Werten, damit die Probe die Breite abdeckt und nicht fünfmal
dasselbe prüft.

| # | Name | Serie | Kategorie | `card_type` | Grundfigur |
|---|---|---|---|---|---|
| 1 | Crystal Clear Cynder | SA | Figuren (10) | `chase` | SKY-0020 |
| 2 | Smolderdash LightCore | SF | Swap Force neue Figuren (21) | `special` | SKY-0262 |
| 3 | Dark Turbo Charge Donkey Kong | SC | Figuren (32) | `dark` | SKY-0493 |
| 4 | Legendary Life Acorn | I | Kreationskristalle (38) | `legendary` | SKY-0598 |
| 5 | Metallic Purple Lightning Rod | G | Giants Series 2 Figuren (16) | `chase` | SKY-0169 |

**Die Dublettenfrage ist für jeden einzeln geprüft**, nicht pauschal. Beispiel
Cynder: der Katalog führt ihn **viermal** — SKY-0020 (SA), SKY-0150 (G),
SKY-0151 „Cynder (Glow)" (G, `chase`) und SKY-0289 „Phantom Cynder" (SF). Eine
Clear-Crystal-Zeile ist **nicht** darunter. Ebenso bei den übrigen vier: zu
Smolderdash, Turbo Charge Donkey Kong und Life Acorn gibt es je **genau eine**
Zeile (die Standardausführung), zu Lightning Rod zwei (SA und G, beide
`standard`).

**Warum keiner mit ungeklärter Identität dabei ist:** die 16 als unklar
markierten Zuordnungen sind ausgeschlossen, ebenso die 51 mit unsicherer
Edition und die 40 ohne Grundfigur im Katalog.

### Die Edition ist gemessen, nicht geraten

| Merkmal | Beleg im bestehenden Katalog |
|---|---|
| `legendary` | 25 von 25 Zeilen tragen `card_type = 'legendary'` |
| `lightcore` | 16 von 17 tragen `special` |
| Kristallfarben / `clear` | 13 von 13 bzw. 10 von 10 tragen `chase` |
| `metallic` | 2 von 2 tragen `chase` |
| `dark` | 19 von 26 tragen `dark`; die übrigen sieben führen „dark" aus anderem Grund im Namen |

`dark` ist der schwächste der fünf Belege. Für **Dark Turbo Charge Donkey
Kong** ist er trotzdem eindeutig: die Quelle führt den Eintrag im Abschnitt
„In-Game Variant", und die Grundfigur SKY-0493 ist `standard`.

---

## 3. Bild und Pflichtfelder

**Ergebnis: alle fünf bekommen einen PLATZHALTER. Kein Bild wird gesetzt.**

Alle fünf sind **sichtbare** Varianten. Das vorgeschlagene Projektbild ist
jeweils das Foto der **Grundfigur** und zeigt damit eine andere Ausführung.
Zwei davon wurden angesehen:

* `b61142f3ed74c2e1.webp` (SKY-0020) zeigt den **violetten** Standard-Cynder.
  Eine Crystal-Clear-Ausführung ist durchsichtig.
* `1bc03b790d5c2221.webp` (SKY-0598) zeigt den **grünen** Standardkristall.
  Die Legendary-Ausführung ist anders eingefärbt.

Die übrigen drei folgen derselben Logik: LightCore ist durchscheinend mit
Leuchtsockel, die Dark-Edition dunkel eingefärbt, Metallic Purple einfarbig
metallisch.

> **Ein falsches Bild wäre schlimmer als keines**, und zwar genau in Schritt 4
> des Testplans: dort wird die Figur öffentlich geschaltet. Eine öffentliche
> Produktabbildung, die ein anderes Produkt zeigt, ist kein Schönheitsfehler.

**Zur Rechtelage, präzise:** die Projektbilder stammen aus dem Legacy-Projekt
(`site/img/*.webp`, unverändert übernommen, ADR-0009) und sind im
Produktivbetrieb. Eine ausdrückliche Lizenzaussage steht **nicht** in der
Dokumentation — „Rechte geklärt" kann ich deshalb nicht behaupten. Für diese
Charge ist die Frage gegenstandslos: es wird keines übernommen. Die externen
Bilder der Checkliste sind ausschließlich als **Pfad innerhalb der .xlsx**
vermerkt, Status `unverified`; nichts wurde entpackt, geladen oder kopiert.

**Pflichtfelder, gegen die echten CHECKs geprüft:**

| Feld | Wert | Regel |
|---|---|---|
| `name` | roh aus der Quelle | nicht leer (`0001`) |
| `slug` | **wird nicht vorab vergeben** | `next_figure_slug()` bildet ihn beim Anlegen |
| `series_code`, `category_id` | gesetzt, zusammengesetzter FK | beide `not null` |
| `item_type` | `figure` | CHECK `figure\|game\|portal\|bundle\|other` (`0135`) |
| `card_type` | siehe Tabelle | CHECK der sieben Werte (`0032`) |
| `market_price` | `NULL` | „kein bekannter Marktpreis" (ADR-0010); 0 wäre verboten |
| `image_file` | nicht gesetzt | Platzhalter |
| `catalog_status` | `draft` | CHECK der drei Werte (`0152`) |
| `catalog_visible` | `false` | der zweite CHECK erzwingt die Übereinstimmung |
| `source` | `admin` | CHECK `import\|admin` (`0033`) |

---

## 4. Der Probelauf — Ergebnis

```
CHARGE         : CAT-04A — 5 von 105 Entwuerfen
                 Crystal Clear Cynder (SA)
                 Smolderdash LightCore (SF)
                 Dark Turbo Charge Donkey Kong (SC)
                 Legendary Life Acorn (I)
                 Metallic Purple Lightning Rod (G)
production guard: passed — target is staging (qqxcpesbwfxzgytkdsac)
Entwuerfe      : 5
Katalog JETZT  : 626 Zeilen
catalog_status : FEHLT (0152 nicht angewendet)
Wuerde anlegen : 5
Dubletten      : 0
WARTET AUF     : 1  — 0152
```

**Die Hülle ist erzeugt, damit du sie vor der Freigabe lesen kannst**, und sie
darf noch nicht laufen. Das ist kein Widerspruch: sie bewacht die Vorbedingung
**selbst** (`ABBRUCH A2`, innerhalb der Transaktion, bevor eine Zeile
entsteht). Ein blockierender Befund — etwa eine unbekannte `category_id` —
hätte die Erzeugung dagegen verhindert.

### Sie ist gefahren, nicht nur erzeugt

**Probelauf P61** (`tools/validate-check-sql.mts`) führt genau diese Datei an
echtem PostgreSQL aus — gegen eine Welt mit den fünf Kategorien, dem
Umgebungsstempel und `catalog_status`:

```
erster Lauf legt fuenf Entwuerfe an: durch · Entwuerfe 5 · davon sichtbar 0
SKY-IDs aus sky_id_seq: SKY-0823,SKY-0824,SKY-0825,SKY-0826,SKY-0827
Slugs aus next_figure_slug: crystal-clear-cynder, dark-turbo-charge-donkey-kong, …
Herkunft in der internen Notiz: 5 · Journalzeilen 5
zweiter Lauf legt nichts an und zieht keine ID: Sequenz 827 → 827
A4 faengt eine zurueckliegende Sequenz ab: Zeilen unveraendert
```

**Drei Fehler hat dieser Probelauf gefunden, bevor du sie gesehen hättest:**
ein Cast in `ABBRUCH A4`, der an einer SKY-ID ohne Vierstellenformat mit
`22P02` abgebrochen wäre; und zweimal ein Backtick in einem SQL-Kommentar,
der das Template-Literal des Generators beendete, sodass die Datei sich nicht
mehr laden ließ. Alle drei sind behoben, der letzte zusätzlich mit einem Test.

**Was die Hülle zusichert, jeweils mit einem Test belegt:**

* **genau fünf Zeilen**, namentlich die der Charge;
* **`'draft'` und `false`** stehen fest in der INSERT-Zeile, nicht in den Daten;
* **idempotent** — übersprungen wird, was als Name **und** Serie schon steht;
* **keine SKY-ID auf Verdacht** — `nextval` kommt **nach** der Dublettenprüfung;
* **nichts anderes bewegt sich** — `v_nachher - v_vorher` muss `v_angelegt`
  sein, sonst Abbruch;
* **kein `update` und kein `delete`** auf `skylanders`; der einzige Upsert
  trifft `catalog_editorial` unter der gerade erzeugten SKY-ID;
* **keine Veröffentlichung** — die Nachbedingung bricht ab, wenn ein Entwurf
  sichtbar wäre;
* **`ABBRUCH A4` prüft die Sequenz** — siehe unten.

### Der Sequenzwächter, und warum er dazugekommen ist

`sky_id_seq` beginnt bei 821 und wird nie zurückgesetzt. Steht sie **hinter**
der höchsten vergebenen SKY-ID, zieht der Lauf eine ID, die schon existiert,
und verletzt den Primärschlüssel — mitten in der Schleife, nach ein paar
erfolgreichen Zeilen.

**Auf Staging ist das nicht theoretisch.** Gemessen am 2026-10-27:

| | |
|---|---|
| höchste SKY-ID insgesamt | **SKY-9998** (`source = import`) |
| höchste im produktiven Bereich (< 9000) | **SKY-0822** (`source = admin`) |
| admin-erzeugte Zeilen | 23 |

Die drei Zeilen im **reservierten** Bereich 9000–9999 (SKY-9998, SKY-9994,
SKY-9101) sind System-/Testzeilen (ADR-0070) und dürfen nicht mitzählen —
`admin_create_figure()` verweigert ohnehin alles hinter 8999. Der Wächter
sucht deshalb über das Muster `^SKY-[0-8][0-9]{3}$`: das wählt den
produktiven Bereich **und** hält den Cast von jeder abweichenden Kennung fern.

**Der Stand der Sequenz selbst lässt sich von außen nicht messen** —
`pg_sequence_last_value` ist über PostgREST nicht erreichbar. Deshalb prüft
die Hülle ihn selbst und bricht ab, bevor eine Zeile entsteht; die Meldung
nennt das `setval`, das die Lage bereinigt.

---

## 5. Ausführungsplan

| # | Schritt | Befehl / Datei | Erwartet |
|---|---|---|---|
| 1 | `0152` fahren | `supabase/checks/0152_staging_run.md`, Schritte 1–4 | `9998 = 0`, `9999 = 0`; die NOTICE nennt **0 draft** |
| 2 | Momentaufnahme **neu** holen | `npm run cat03:drafts:staging` | Validierung ohne Fehler |
| 3 | Charge-Probelauf | `npm run cat03:import:staging -- --charge resources/analysis/cat-04-charge.json` | `catalog_status : vorhanden`, `Wuerde anlegen : 5`, `Dubletten : 0`, **kein** `WARTET AUF` |
| 4 | Hülle **neu** erzeugen | derselbe Befehl `--sql` | `staging-cat-04a-import.sql`, 5 Zeilen |
| 5 | Hülle lesen | die Datei | fünf Namen, `'draft'`, `false` |
| 5a | Prüfsummen nachziehen | `npm run sums:write` | die neu erzeugte Hülle hat einen anderen Abdruck als die jetzige; ohne diesen Schritt meldet `migration-integrity.test.ts` sie zu Recht als unregistriert |
| 6 | Einfügen | SQL-Editor Staging | zuerst `NOTICE: A4 ok: naechste SKY-ID waere SKY-xxxx, hoechste vergebene SKY-0822`, dann `NOTICE: CAT-03: 5 Entwurf/Entwuerfe angelegt, 0 uebersprungen. Katalog 626 -> 631 Zeilen.` |
| 7 | Nachkontrolle (dieselbe Datei) | — | `NOTICE: CAT-03 Nachkontrolle: 5 Entwurf/Entwuerfe im Katalog, keiner sichtbar.` |
| 8 | Wiederholungsprobe | **dieselbe Hülle noch einmal** | `0 angelegt, 5 uebersprungen` — und der Katalog bleibt bei 631 |

**Schritt 2 ist kein Formalismus:** zwischen Aufbereitung und Import kann
jemand eine Figur angelegt haben, und `0152` ändert den Katalog ohnehin
(die Spalte kommt dazu).

**Schritt 8 ist der Idempotenzbeweis** und kostet nichts — die zweite
Ausführung legt nichts an und verbraucht keine SKY-ID.

---

## 6. Admin-Testplan — acht Schritte, von Hand

Vorher notieren: die fünf SKY-IDs aus Schritt 6 oben und die Zeilenzahl des
öffentlichen Katalogs.

| # | Handlung | Erwartet |
|---|---|---|
| 1 | `/admin/catalog`, Statusfilter auf **Entwurf** | **fünf** Zeilen, genau die der Charge |
| 2 | eine davon öffnen (`/admin/catalog/SKY-xxxx`) | Name, Serie, Kategorie und Edition wie in der Tabelle oben; Bild = Platzhalter |
| 3 | Status auf **Öffentlich**, „Speichern" | Erfolgsmeldung; das Feld steht auf „Öffentlich" |
| 4 | öffentlicher Katalog `/`, Serie der Figur | die Figur **erscheint** |
| 5 | zurück in den Admin, Status auf **Versteckt**, „Speichern" | das Feld steht auf „Versteckt" |
| 6 | öffentlicher Katalog `/` neu laden | die Figur ist **fort** |
| 7 | Status zurück auf **Entwurf**, „Speichern" | das Feld steht auf „Entwurf"; der Statusfilter findet sie wieder unter „Entwurf" |
| 8 | SKY-ID und Integrität | **dieselbe SKY-ID wie in Schritt 1** — sie darf sich durch keinen Statuswechsel ändern; die übrigen vier Entwürfe stehen unverändert auf „Entwurf" |

**Was Schritt 7 besonders prüft, und es ist der eigentliche Punkt von CAT-02:**
der Rückweg nach `draft` geht **nur** über das Statusfeld. Würde die Figur über
den alten Zwei-Zustands-Weg versteckt (`admin_set_catalog_visible`), bliebe sie
`hidden` — der Trigger macht aus „unsichtbar" keinen Entwurf. Beides ist
richtig, und Schritt 7 zeigt, dass das Dropdown den Unterschied macht.

**Eine Gegenprobe, die sich lohnt:** zwischen Schritt 4 und 5 den öffentlichen
Katalog **abgemeldet** (privates Fenster) aufrufen. Die Lesepolitik gilt für
`anon`, und genau dort muss die Figur sichtbar sein.

---

## 7. Offene Risiken

| Risiko | Bewertung | Umgang |
|---|---|---|
| **Staging führt 626 Zeilen, der echte Katalog 820** | Für diese fünf **kein** Risiko: alle fünf Grundfiguren stehen auf Staging, und die Dublettenfrage ist an ihnen geprüft. Für einen späteren Production-Import bleibt es das Hauptrisiko | vor einem Production-Import derselbe Abgleich dort, rein lesend (`cat03_import_run.md`, Abschnitt 1) |
| **Fünf SKY-IDs werden dauerhaft verbraucht** | Unumkehrbar. Ein Löschen gibt sie nicht zurück (ADR-0070) | bewusst in Kauf genommen: der produktive Bereich reicht bis 8999, vergeben ist bis SKY-0822 |
| **`sky_id_seq` könnte zurückliegen** | Würde den Primärschlüssel verletzen; von außen nicht messbar | `ABBRUCH A4` prüft es in der Transaktion und nennt das nötige `setval` |
| **Die Identität beruht auf Name plus Abschnitt der Quelle** | Eine Namensnormalisierung ist ein Suchhilfsmittel, kein Beweis | deshalb nur Kandidaten mit vorhandener Grundfigur und gemessener Edition; die unklaren sind ausgeschlossen |
| **`dark` ist der schwächste Editionsbeleg** (19 von 26) | gering | Schritt 2 des Testplans prüft es am Formular; `card_type` ist jederzeit änderbar und keine Identität |
| **Ohne `0153` fehlt der Status in der Plattformsicherung** | Für einen Test unkritisch, für den Dauerbetrieb nicht | `0153` nach `0152` fahren; `pg_dump` (Stufe 2) ist ohnehin nicht betroffen |
| **Die Hülle existiert schon, `0152` aber nicht** | kein Risiko | `ABBRUCH A2` innerhalb der Transaktion; es entsteht keine Zeile |

---

## 8. Abbruchbedingungen

1. **`0152` Preflight `9999 ≠ 0`** — nicht anfangen.
2. **Die NOTICE aus `0152` nennt einen Entwurf** — der Backfill hätte dann
   etwas anderes getan als `catalog_visible` abzulesen.
3. **Der Charge-Probelauf meldet Dubletten** — jede einzeln ansehen.
4. **Die Hülle trägt nicht fünf Zeilen.**
5. **Schritt 6 meldet eine andere Zeilenzahl als 626 → 631.**
6. **Die Nachkontrolle nennt einen sichtbaren Entwurf.**
7. **Der öffentliche Katalog verändert sich zwischen Schritt 1 und 7 des
   Ausführungsplans** — dieser Import darf dort nichts bewirken.
8. **Eine SKY-ID ändert sich durch einen Statuswechsel** — das wäre ein
   schwerer Fehler und kein Testbefund.
