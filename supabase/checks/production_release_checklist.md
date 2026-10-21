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

## Schritt 6 — Jetzt der Code · **Push und Deployment**

**Erst ab hier ist der Push freigegeben.**

| ☐ | Was |
|---|---|
| ☐ | `git push` (20 Commits, `origin/main`) |
| ☐ | Vercel baut `main` → auf **grün** warten |
| ☐ | `https://skyisles.app/` öffnen: Figurenkatalog lädt, Karten sichtbar |
| ☐ | `https://skyisles.app/zubehoer`: **39 Artikel** (noch keine Portale — richtig) |
| ☐ | `https://skyisles.app/shop`: Angebote wie vorher, Zustandszeile „Gebraucht · mindestens guter Zustand · voll funktionsfähig" |

**Schlägt der Build fehl oder zeigt die Seite einen Fehler:** Deployment in
Vercel auf `81386e6` zurücksetzen („Promote to Production") und **nicht**
mit Schritt 7 weitermachen. Der Datenbankstand ist dann haltbar.

---

## Schritt 7 — `0138`, die 21 Portale · **schreibt**

**Nur wenn Schritt 6 grün ist.**

```
supabase/operations/prod-0138.sql
```

**Erwartung:** das Abschlussraster von `0138`. **Katalogzeilen + 21**,
**Kategorien + 6**, alles andere gleich — insbesondere **sammelbare Zeilen
unverändert** und **Angebote unverändert**.

| ☐ | Danach prüfen |
|---|---|
| ☐ | `skyisles.app/zubehoer`: **60 Artikel** |
| ☐ | `skyisles.app/`: Figurenkarten **unverändert**, keine Portalkachel |
| ☐ | Sammlung: Fortschrittszahl **unverändert** |

## Schritt 8 — `0139`, das Verkaufstor · **schreibt**

```
supabase/operations/prod-0139.sql
```

**Erwartung — die zweite `NOTICE`-Zeile muss sagen:**

```
0139 ok: Freigabe und USK stehen, 0 Positionen freigegeben, … Angebote
         unveraendert (md5 …), kein Zubehoerangebot
```

**`0 Positionen freigegeben` ist der wichtigste Wert des ganzen Releases.**
Steht dort etwas anderes: stopp.

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
