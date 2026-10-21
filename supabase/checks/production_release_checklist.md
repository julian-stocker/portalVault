# Production-Release — Checkliste zum Abhaken

**Projekt: `zmiwxswrpkmizvqsgype` (Production).** Jeder SQL-Schritt ist
**eine Datei**: vollständig markieren, in den SQL-Editor einfügen,
ausführen. Nichts zusammensetzen.

Begründungen, Beweise und Rücknahmen: `production_release_0135_0141.md`.

**Bei jedem Abbruch oder jeder unerwarteten Zahl: anhalten und melden.**
Eine abgebrochene Migration hat sich selbst zurückgerollt — es ist nichts
kaputt, und Weitermachen wäre der erste echte Fehler.

---

## Vorher — ohne das hier wird nicht angefangen

| ☐ | Was | Erwartung |
|---|---|---|
| ☐ | Supabase → Database → **Backups**: Datum des letzten Backups notieren | **jünger als 24 h**. Sonst: stopp |
| ☐ | Dasselbe für **Point-in-time-Recovery**, frühester Zeitpunkt notieren | nur notieren |
| ☐ | `/business/datensicherung` öffnen, Datei herunterladen | eine `.json` |
| ☐ | `npm run verify:backup -- --file ~/Downloads/skyisles-business-backup-….json` | **28 Bereiche, kein Fehlschlag**. Sonst: stopp |

---

## Schritt 1 — Was steht hier überhaupt? · **liest nur**

```
supabase/checks/state_audit_readonly.sql
```

**Ergebnis vollständig ins Protokoll.** Diese Zeilen zählen:

| Zeile | Erwartung |
|---|---|
| **60** `skylanders.item_type` | **FEHLT** |
| **63–65** die drei `0139`-Spalten | **FEHLT**, alle drei |
| **68** Spalten von `shop_offers()` | **4** |
| **69** die Funktionen aus 0137–0141 | alle **FEHLT** |
| `non_collectible_categories` | Fassung **0006** |
| `purchases_paid_total_is_final` | **steht** (das ist `0133`) |

**Stopp**, wenn irgendetwas davon schon da ist: dann ist der Stand nicht
`0133`, und die Reihenfolge muss neu bestimmt werden.

## Schritt 2 — Hält die Belegsperre? · **liest nur**

```
supabase/checks/receipt_lock_check.sql
```

**Erwartung: Zeile `9999` = `0`.** Sonst: stopp.

---

> **Stand 2026-10-21.** Die Schritte 3 bis 6 sind gefahren: `0135`, `0136`
> und `0137` liegen auf Production, `21353e4` ist deployt und live geprüft.
> **Offen:** Schritt 2 (Backup-Nachweis) und Schritt 4a (die sichtbare
> Nachkontrolle zu `0136`). Als nächstes kommt Schritt 7 (`0138`) — und der
> braucht eine eigene Freigabe.

## Schritt 3 — `0135` · **schreibt**

```
supabase/operations/prod-0135.sql
```

**Erwartung: zwei `NOTICE`-Zeilen und `commit`.** Die zweite sagt, dass
`item_type` steht, 39 Spiele markiert sind und die **Angebote unverändert**
sind. Die Zahlen sind die von Production — sie müssen nicht mit Staging
übereinstimmen, aber **vorher und nachher gleich** sein; das prüft die
Migration selbst.

## Schritt 4 — `0136` · **schreibt**

```
supabase/operations/prod-0136.sql
```

**Erwartung:** `0136 ok: 28 Bereiche, 353 Feldzeilen …`

> **Der Supabase-SQL-Editor zeigt `NOTICE`-Meldungen nicht an.** „Success"
> ohne Meldungen ist deshalb **kein** Befund — weder ein guter noch ein
> schlechter. Dass die Datei durchlief, heißt immerhin: ihre eigenen
> Nachbedingungen haben gehalten, denn eine Abweichung hätte in derselben
> Transaktion **alles** zurückgerollt. Nur sehen kann man das nicht.

## Schritt 4a — die Nachkontrolle zu `0136` · **rein lesend**

```
supabase/operations/prod-s-postflight-0136.sql
```

Fragt denselben Zustand von außen und **sichtbar**. Klammer, Riegel,
Z0-Modus und `rollback` stehen schon darin; es ist nichts zusammenzusetzen.
Sie ruft `seller_business_backup()` **nicht** auf — gelesen wird die
gespeicherte Definition, nicht ihr Ergebnis, also keine Geschäftsdaten.

**Erwartung: Zeile `9999` zeigt `0`.** Die fünf Zeilen, auf die es ankommt:

| Zeile | Frage | muss |
|---|---|---|
| 108 | führt der Bereich `figures` jetzt `item_type`? | `1` |
| 107 | und an der richtigen Stelle, Feld für Feld? | die zehn Felder in Folge |
| 105 | weiterhin genau 28 Bereiche? | `28` |
| 106 | Feldzeilen von 352 auf 353 gestiegen? | `353` |
| 102 | die übrigen 27 Bereiche unverändert? | `f6d08440707ba72a8040a8d1e666c092` |

Zeile 102 ist der eigentliche Beweis: ein zeichengleicher Rumpf **kann**
keinen abweichenden Bereich enthalten. Zeilen 131 und 132 sind die Antwort
auf „Auswirkungen auf Angebote, Lager, Bestellungen": im Rumpf steht kein
`insert`, `update`, `delete`, `truncate`, `nextval`, `setval` — die Funktion
kann nichts ändern.

**Zeilen 911–915 sind hier Messungen ohne Sollwert** (`ok` leer), weil der
Z0-Vertrag Staging-Zahlen führt. Erwartet werden auf Production **531**
shopfähige Zeilen, **287** Angebote, **531** sammelbare Artikel, **59**
Overrides; der Abdruck in 913 ist der Bezug für den **nächsten** Lauf und
gehört notiert. Weicht eine davon ab, ist das ein Befund — `0136` kann
keine davon verändern.

Dass die Datei Staging abweist, auf einem Production-Stand durchläuft und
genau diese vier Zahlen zeigt, fährt Probelauf **P42** nach.

## Schritt 5 — `0137` · **schreibt**

```
supabase/operations/prod-0137.sql
```

**Erwartung:** die `NOTICE`-Zeilen von `0137` und `commit`. Danach nennt
`non_collectible_categories()` **fünf** Kategorien.

> **Hier darf man beliebig lange stehen bleiben.** Der deployte Code
> verträgt diesen Zustand — es gibt noch keine Zeile in den vier neuen
> Kategorien. Wenn heute nichts mehr geht: morgen weitermachen.

---

## Schritt 5a — die Nachkontrolle zu `0137` · **rein lesend**

```
supabase/operations/prod-s-postflight-0137.sql
```

**Erwartung: Zeile `9999` zeigt `0`.** Die Zeilen der fünf Fragen: **201**
(alle fünf Kategorien) · **202–210** (jede Kategorie auf ihren Typ, ein
unbekannter Name bleibt `figure`) · **204** und **401–410** (die
Anlegefunktion, eine Overload, `security definer`, leerer `search_path`,
dicht für `anon` und PUBLIC) · **205** (`seller_import_catalog` liefert acht
Spalten, `item_type` hinten) · **301** (`0137` hat **keine** Zeile angelegt) ·
**604** (keine shopfähige Zeile in den fünf Kategorien).

Die Abdruckzeilen **601–603, 701–704, 801–803** tragen keinen Sollwert; auf
Production erwartet werden 601 = 531, 602 = 287, 701 = 531. Zeile **603**
(md5 der Angebotsliste) bitte **notieren** — sie ist der Bezug für `0139`.
Probelauf **P43** fährt die Datei nach.

## Schritt 6 — Jetzt der Code · **Push und Deployment**

**Erst ab hier ist der Push freigegeben.**

| ☐ | Was |
|---|---|
| ☑ | `git push` — am **2026-10-21** gefahren: `81386e6..21353e4`, **27 Commits**, 222 Dateien |
| ☑ | Vercel baute `main` → **nach 64 Sekunden live** (Marker: `/zubehoer` von 404 auf 200) |
| ☑ | `https://skyisles.app/` — HTTP 200, Katalog lädt, Nenner der Startserie **74** |
| ☑ | `https://skyisles.app/zubehoer` — HTTP 200, **39 Artikel**, keine Portale |
| ☑ | `https://skyisles.app/shop` — HTTP 200, **235 Artikel im Angebot**, Zustandszeile steht |
| ☑ | Detailseiten: `/zubehoer/game-nintendo-3ds-spyros-adventure` (USK, Lieferumfang, „Aktuell kein Angebot") und `/skylanders/blue-bash` (Marktwert, „Zur Sammlung", „Anmelden") je HTTP 200 |
| ☑ | kein Fehlermarker in einer der sechs Seiten, `/login` eingeschlossen |

**Schlägt der Build fehl oder zeigt die Seite einen Fehler:** Deployment in
Vercel auf `81386e6` zurücksetzen („Promote to Production") und **nicht**
mit Schritt 7 weitermachen. Der Datenbankstand ist dann haltbar.

---

## Schritt 7 — `0138`, die 21 Portale · **drei Dateien, in dieser Folge**

**Nur wenn Schritt 6 grün ist** — er ist es seit dem 2026-10-21.

`0138` ist die **erste** Migration dieses Releases, die Zeilen anlegt.
Deshalb gehört hier ein Vorher dazu: „nichts anderes hat sich bewegt" ist
ein Vergleich, und ein Vergleich braucht zwei Messungen.

### 7a — das Vorher · **rein lesend**

```
supabase/operations/prod-s-preflight-0138.sql
```

**Erwartung: Zeile `9999` = `0`.** Die Vorbedingungen (101–104, 201–205,
301, 302, 304) müssen grün sein; besonders **301** („der ZB-Bereich
SKY-0615..SKY-0642 ist frei", muss `true`) und **104** (der CHECK
`catalog_admin_changes_field_known` kennt `created`). Die Abdrücke
**401–409, 501–503** tragen keinen Sollwert — **bitte das ganze Ergebnis
aufbewahren**, Schritt 7c vergleicht dagegen.

Vorhergesagt für Production (lesend gemessen am 2026-10-21): 402 = **531**,
403 = **287**, 404 = **9b8341058bbfa0f7809eddc300ab0e9e**, 405 = **531**,
406 = **G=81,I=77,SA=74,SC=69,SF=89,T=141**. 401 und 407 zählen auch die
redaktionell ausgeblendeten Zeilen und liegen deshalb über 570 bzw. über
`figure=531,game=39`.

### 7b — `0138` · **schreibt**

```
supabase/operations/prod-0138.sql
```

**Erwartung:** die `NOTICE`-Zeilen von `0138` und `commit`. Der SQL-Editor
zeigt sie nicht an — „Success" heißt hier: die Migration hat ihre acht
eigenen Abdrücke in derselben Transaktion verglichen und keine Abweichung
gefunden. Jede Abweichung hätte **alles** zurückgerollt, die 21 Zeilen
eingeschlossen.

### 7c — das Nachher · **rein lesend**

```
supabase/operations/prod-s-postflight-0138.sql
```

**Erwartung: Zeile `9999` = `0`.** Dann die elf Vergleichszeilen gegen 7a:

| Zeile | gegen | muss |
|---|---|---|
| 501 | Preflight 401 | **+ 21** |
| 507 | Preflight 407 | **+ `portal=21`** |
| 502 | Preflight 402 | gleich (531) |
| 503 | Preflight 403 | gleich (287) |
| 504 | Preflight 404 | gleich (`9b834105…`) |
| 505 | Preflight 405 | gleich (531) |
| 506 | Preflight 406 | gleich (`G=81,…`) |
| 508 | Preflight 408 | gleich |
| 509 | Preflight 409 | gleich — `0138` zieht keine SKY-ID |
| 510 | Preflight 501 | gleich |
| 511 | Preflight 503 | gleich |

Weicht eine **gleich**-Zeile ab, ist Stopp-Kriterium **S5** erfüllt.

### 7d — und am laufenden System

| ☐ | Danach prüfen |
|---|---|
| ☐ | `skyisles.app/zubehoer`: weiter **39 Artikel** — **nicht 60**. Die 21 Portale entstehen mit `catalog_visible = false`; öffentlich sichtbar werden sie erst durch eine eigene redaktionelle Freigabe. Auf Staging sind sie freigegeben, deshalb stehen dort 60 |
| ☐ | `skyisles.app/`: Figurenkarten unverändert, keine Portalkachel |
| ☐ | Sammlung: Fortschrittszahl **unverändert** (Nenner 531) |
| ☐ | `npm run verify:shop:prod`: `publicly visible accessories  Spiele=39`, 287 Angebote, Ableitungsregel grün |
| ☐ | `/admin` → Katalog: die 21 Portale stehen da, als ausgeblendet gekennzeichnet |

**Rücknahme, wenn nötig:** `supabase/rollback/R0138_drop_portals.sql` —
erst diese, dann `R0137`. Sie bricht ab, falls ein Portal inzwischen an
einem Einkauf, Bestand, einer Bewegung, Sammlung, einem Warenkorb oder
einer Zuordnung hängt; dann ist die Rücknahme nicht mehr das richtige
Mittel. Probelauf **P27** fährt die Reihenfolge nach, **P44** den ganzen
Schritt 7 am Stück.

## Schritt 8 — `0139`, das Verkaufstor · **drei Dateien, in dieser Folge**

`0139` legt keine Zeile an, berührt aber **vier Türen**, durch die heute
jedes Figurenangebot geht. Deshalb auch hier: erst messen, dann schreiben,
dann vergleichen.

### 8a — das Vorher · **rein lesend**

```
supabase/operations/prod-s-preflight-0139.sql
```

**Erwartung: Zeile `9999` = `0`.** Die Datei wählt den Z0-Modus
**`production`** — anders als die Nachkontrollen zu `0136`–`0138`, denn für
`0139` sind die Bezugszahlen gemessen. Sechs Zeilen sind damit
**blockierend**:

| Zeile | | Sollwert |
|---|---|---|
| 1 | Staging-Markerpaar fehlt | `false` |
| 401 | öffentliche Angebote | **287** |
| 402 | Abdruck der Angebotsliste | **9b8341058bbfa0f7809eddc300ab0e9e** |
| 403 | shopfähige Katalogzeilen | **531** |
| 405 | sammelbare Katalogzeilen (Nenner) | **531** |
| 406 | Lagerzeilen | **306** |
| 407 | Katalogzeilen | **624** |
| 501 | Grants auf die Belegtabellen für `anon`/`authenticated` | **0** |

Dazu **201–203**: `sale_released`, `usk_rating` und `is_position_sellable`
müssen **noch fehlen** — daran fällt ein zweiter Lauf von `0139` auf.

**Zeilen 301–307 sind die Altlast**, um die es geht: die Lagerpositionen auf
Spiele mit `is_listed = true`. Von außen gemessen sind es **13**
Zubehörpositionen, die heute vom Angebot zurückgehalten werden, weil ihr
Artikel nicht sammelbar ist. Zeile 302 bestätigt oder berichtigt die Zahl,
304 nennt die Teilmenge mit wirksamem Preis. **Ergebnis aufbewahren** —
404 und 408 werden in 8c verglichen.

### 8b — `0139` · **schreibt**

```
supabase/operations/prod-0139.sql
```

**Erwartung — die zweite `NOTICE`-Zeile muss sagen:**

```
0139 ok: Freigabe und USK stehen, 0 Positionen freigegeben, … Angebote
         unveraendert (md5 …), kein Zubehoerangebot
```

**`0 Positionen freigegeben` ist der wichtigste Wert des ganzen Releases.**
Steht dort etwas anderes: stopp. Der SQL-Editor zeigt die Zeile nicht —
deshalb 8c.

### 8c — das Nachher · **rein lesend**

```
supabase/operations/prod-s-postflight-0139.sql
```

**Erwartung: Zeile `9999` = `0`.** Auch hier Modus `production`.

**Es ist nichts kaufbar geworden:** 201 freigegebene Positionen **0** · 202
Zeilen mit USK **0** · 203 Zubehörzeilen im Angebot **0** · 204
Zubehörpositionen, die das neue Tor durchließe **0** · 205 die Altlast
unverändert gelistet und unverkäuflich.

**Die Figuren sind unberührt:** 301 Angebote **287** · 302 Abdruck
**9b834105…** · 303 shopfähig **531** · **304 Positionen, die am neuen Tor
anders antworten als am alten: 0** · 501 sammelbar **531** · 502 Lagerzeilen
**306** · 503 Katalogzeilen **624** · 505 Sammlungseinträge auf Zubehör
**0**. Zeile 504 gegen Preflight 408 halten.

**Die vier Türen fragen ein Tor:** 401 Türen am neuen Tor **4** · 402 Türen,
die `is_shop_eligible` noch direkt fragen **0** · 403/404 die
Betriebsdiagnose kennt die Gründe „not released for sale" und „usk rating
missing".

**Die Riegel:** 601 `is_position_sellable` für `anon` und `authenticated`
ausführbar (das muss sie sein, sonst antwortet der Shop nicht mehr) · 602
`seller_set_sale_release` für `anon` **nicht** · 603 `admin_set_usk_rating`
für `anon` **nicht** · **604 die Belegsperre hält unverändert**.

### 8d — und am laufenden System

| ☐ | Danach prüfen |
|---|---|
| ☐ | `npm run verify:shop:prod`: 287 Angebote, `shop_offers()` jetzt mit **fünf** Spalten, `publicly visible accessories  Spiele=39` |
| ☐ | `npm run verify:seller:prod`: `shop_offers() returns a known column set … 0139 applied`, `seller_sale_state(): 0141 NOT applied` |
| ☐ | `skyisles.app/shop`: 235 Artikel im Angebot, unverändert |
| ☐ | `skyisles.app/zubehoer/<ein Spiel>`: weiter „Aktuell kein Angebot" |
| ☐ | `/business/inventory`: **keine** Verkaufssteuerung sichtbar — die kommt erst mit `0141` |

**Rücknahme:** `supabase/rollback/R0139_drop_sale_release.sql`. Probelauf
**P45** fährt den ganzen Schritt 8 am Stück, **P34–P37** die vier
Zusicherungen von `0139` einzeln.

## Schritt 9 — `0140`, die Betriebssicherung · **schreibt**

```
supabase/operations/prod-0140.sql
```

**Erwartung:** `0140 ok: 28 Bereiche, 356 Feldzeilen, die 26 uebrigen unveraendert`

## Schritt 10 — `0141`, die Lesefunktion · **schreibt**

```
supabase/operations/prod-0141.sql
```

**Erwartung:** `0141 ok: seller_sale_state steht, acht Spalten, nur fuer das Betriebskonto`

---

## Schritt 11 — Nachher · **liest nur**

```
supabase/checks/state_audit_readonly.sql
supabase/checks/receipt_lock_check.sql
```

| ☐ | Erwartung |
|---|---|
| ☐ | Zeile **60** `item_type`: **steht** |
| ☐ | Zeile **63–65**: alle drei **steht** |
| ☐ | Zeile **67** die aufgehobene Kopplung: **FEHLT (richtig)** |
| ☐ | Zeile **68** `shop_offers()`: **5** |
| ☐ | Zeile **69**: alle sechs Funktionen **steht** |
| ☐ | `receipt_lock_check.sql`: `9999` = **0** |

## Schritt 12 — Die Oberfläche von Hand

| ☐ | Was | Erwartung |
|---|---|---|
| ☐ | `skyisles.app/` | Figurenkatalog, Serienleiste, Karten unverändert |
| ☐ | `skyisles.app/zubehoer` | **60 Kacheln**, überall „Aktuell kein Angebot" |
| ☐ | eine Kachel anklicken | Detailseite mit Art, Plattform/Modell, Serie, Zustand, SKY-ID |
| ☐ | `skyisles.app/shop` | Angebote wie vorher, **keine** Zubehörkachel |
| ☐ | Anmelden, Sammlung öffnen | Fortschritt und Besitz **unverändert** |
| ☐ | `/business/inventory` öffnen | Lagerliste lädt; bei einem **Spiel** erscheinen Lieferumfang, USK und der Freigabeschalter |
| ☐ | **Nichts freigeben** | — |

---

## Was danach offen bleibt

* Die **Lagerverwaltung** ist noch nie angemeldet geprüft worden. Schritt 12
  ist das erste Mal.
* Der **Zubehör-Bestelldurchstich** fehlt ganz — es gibt kein Angebot.
* **Kein Spiel** ist freigebbar: ohne erfasste USK lässt die Datenbank es
  nicht zu, und erfunden wird keine (`docs/LEGAL.md`, 8b).
* Die **Portale** wären freigebbar, sobald eine Lagerposition mit Preis und
  Lieferumfang existiert. Das ist ein eigener Vorgang, kein Teil dieses
  Releases.
