# Ablauf: die 35 Portalpositionen bekommen ihre SKY-ID

> ## AUSGEFÜHRT auf Staging am 2026-10-20
>
> Betreiber, manuell im SQL-Editor über
> `supabase/operations/staging-portal-assignment.sql`. Ein Durchgang, eine
> Transaktion. Das Abschlussraster meldete **35 zugeordnete Positionen**,
> `ohne_sky_id` **206 → 171** und jeden anderen Bezugswert unverändert.
>
> ### Unabhängig nachgeprüft, rein lesend, am selben Tag
>
> Nicht aus dem Skript heraus, sondern gegen die Basis, die **vor** dem Lauf
> mit einem eigenen Zugriff genommen wurde:
>
> | Prüfung | Ergebnis |
> |---|---|
> | Positionen auf Portalen | **35** |
> | und zwar **genau dieselben 35 Zeilen** wie in der Basis (Id-Mengenvergleich) | ✓ |
> | jede trägt die SKY-ID ihres **eigenen** Rohnamens | 0 Abweichungen |
> | Verteilung je Artikel | `0615=1, 0616=2, 0617=5, 0618=7, 0619=11, 0620=2, 0621=3, 0622=1, 0624=1, 0627=1, 0637=1` |
> | **Abdruck über 15 Spalten** (alles außer `sky_id`/`updated_at`) | `45340984792692b0cdfae951dd1ced48` — **identisch zur Basis** |
> | 24 Einkäufe, Abdruck und bezahlte Summe | `3d5367dda6e6b0e836eb34934daa8e88`, **995,77 €** — identisch |
> | Lagerzeilen auf Portalen · Lagerbewegungen an den 35 | **0** · **0** |
> | Positionen 2 128 · ohne `sky_id` **171** · Lagerzeilen 285 · Einheiten 812 · Bewegungen 26 · Verkaufspositionen 1 284 · Sammlung 1 · Katalogzeilen 626 · Einkäufe 90 · auf Spielen 37 | alle wie erwartet |
> | Portale mit `catalog_visible` · Sammlungseinträge auf Portalen | **0** · **0** |
> | Angebote | **256**, davon Portale **0** |
>
> **Der 15-Spalten-Abdruck ist der eigentliche Nachweis:** er umfasst
> `market_price_snapshot`, `market_price_source`, `position`, `condition`,
> `raw_name`, `state`, `source_row`, die Legacy-Flaggen, `note` und
> `created_at`. Dass er sich nicht bewegt hat, heißt: Preise, Mengen,
> Rohnamen und Einkaufsdaten sind unberührt.
>
> **Die Rücknahme bleibt verfügbar** —
> `supabase/rollback/R_portal_assignment.sql` findet die 35 Zeilen
> unverändert über SKY-ID, Rohname, `reconciled_legacy`, fehlende
> Lagerbewegung und gesetztes `source_row`.

---

**Der Ablauf, wie er vorbereitet und gefahren wurde:**

Befund und Begründung: `accessory_assignment_proposal.md`.
Gegenstand: 35 Einkaufspositionen, 11 Portalartikel, 24 importierte Einkäufe.

---

## Was der Ablauf schreibt — und was nicht

| | |
|---|---|
| **schreibt** | `purchase_items.sky_id` auf 35 Zeilen, plus `updated_at` |
| **lässt unberührt** | `raw_name`, `source_row`, Legacy-Flaggen, `state`, `position`, `condition`, jeder Preis, jede Menge, jede Kostenaufteilung, jede bezahlte Summe |
| **erzeugt nicht** | keine Lagerbewegung, keine Lagerzeile, keinen Beleg, keine Einkaufsposition, keinen Katalogartikel |
| **berührt nicht** | Production, die Belegsperre, die Sammlung, den Shop |

Das sind **genau** die Zusagen von `seller_set_purchase_item_sky` (`0054`),
deren übrige Spalten der Funktionskommentar „deliberately untouched" nennt.

## Warum nicht über die geprüfte Funktion

Sie wäre der gebaute Weg — aber aus dem SQL-Editor **nicht erreichbar**: sie
fragt als erste Anweisung `can_operate_active_seller()`, und das verlangt ein
`auth.uid()`, das eine Editor-Sitzung nicht hat. Sie würde mit
`insufficient_privilege` abbrechen.

Über die **Oberfläche** ginge es: der Figurenwechsel im Einkaufsdialog ruft
genau diese Funktion. Das wären 35 Griffe auf 24 Einkaufsseiten, ohne
Vorher/Nachher-Raster. Deshalb der Schritt 2 unten als Stichprobe und das
Skript für den Rest.

---

## Der Ablauf

### 1. Vorher messen (rein lesend)

```sql
begin;
-- Inhalt von supabase/checks/accessory_assignment_readonly.sql einfügen
rollback;
```

Erwartet, Stand 2026-10-20:

| Zeile | Gegenstand | erwartet |
|---|---|---|
| 102 | Freitextpositionen | **206** |
| 103 | davon mit exaktem Katalogtreffer | **35** |
| 104 | mehrdeutig | **0** |
| 203 | davon **mit Lagerbewegung** | **0** |
| 402 | Einkaufspositionen auf Portalen | **0** |
| 502 | Sammlungseinträge auf Zubehör | **0** |

**Weicht 103 oder 203 ab, nicht weitermachen.** Das Skript bricht dann
ohnehin ab (A5 bzw. A6), aber dann wissen Sie den Grund schon vorher.

#### Unabhängig gemessen am 2026-10-20, vor dem Lauf

Nicht aus dem Skript heraus, sondern mit einem eigenen lesenden Zugriff —
damit es nachher eine Vergleichsbasis gibt, die das Skript nicht selbst
erzeugt hat:

| | |
|---|---|
| die 11 Artikel mit genau diesem Namen und `item_type = portal` | **11 / 11** |
| davon `catalog_visible` | **0** — es wird nichts veröffentlicht |
| mehrdeutige Rohnamen | **0** |
| Zielpositionen | **35**, Verteilung je Artikel stimmt |
| davon mit Lagerbewegung | **0**, alle `reconciled_legacy` |
| **Abdruck der 35 Zeilen über 15 Spalten** (alles außer `sky_id` und `updated_at`: `id, purchase_id, position, condition, raw_name, state, market_price_snapshot, market_price_snapshot_at, market_price_source, movement_id, legacy_condition_flag, legacy_booked_flag, source_row, note, created_at`) | `45340984792692b0cdfae951dd1ced48` |
| betroffene Einkäufe | **24**, Abdruck `3d5367dda6e6b0e836eb34934daa8e88`, bezahlte Summe **995,77 €** |

Bezugswerte: 2 128 Einkaufspositionen · 206 ohne `sky_id` · 285 Lagerzeilen
mit 812 Einheiten · 26 Lagerbewegungen · 1 284 Verkaufspositionen · 1
Sammlungseintrag · 626 Katalogzeilen · 90 Einkäufe.

**Der Abdruck über 15 Spalten ist die eigentliche Zusicherung für Preise und
Mengen:** `market_price_snapshot` und `market_price_source` stehen darin, und
sie müssen danach denselben Wert ergeben.

### 2. Der ganze Satz in einem Durchgang

**Die Handprobe entfällt** (Entscheidung des Betreibers, 2026-10-20). Sie
hätte zeigen sollen, dass Rohname und Zustand stehenbleiben — und genau das
beweist Abschnitt C3 des Skripts für **alle 35** Zeilen auf einmal, über
einen Abdruck von `id|raw_name|state|condition`, der vor dem Schreiben
genommen und danach verglichen wird. Eine einzelne Zeile von Hand hätte
derselben Zusicherung nichts hinzugefügt und eine zweite Schreibart
eingeführt.

Das Skript bleibt davon unberührt wiederholbar: es findet jede Zielposition,
ob schon zugeordnet oder nicht.

```
supabase/operations/staging-portal-assignment.sql
```

Vollständig markieren, in den SQL-Editor des **Staging**-Projekts
`qqxcpesbwfxzgytkdsac` einfügen, ausführen. Die Datei bringt `begin` und
`commit` selbst mit.

| | |
|---|---|
| **A** | Umgebungsstempel, Transaktionsklammer, die 11 Artikel mit genau diesen Namen, Eindeutigkeit jedes Rohnamens, die Zielmenge (35), keine mit Lagerbewegung, 18 Bezugswerte |
| **B** | **eine** Anweisung: `sky_id` und `updated_at`, nur auf Zeilen aus der vorher bestimmten Zielmenge |
| **C** | je Artikel die erwartete Zahl, Abdruck über `id\|raw_name\|state\|condition` unverändert, keine Lagerbewegung entstanden, bezahlte Summen unverändert, 14 Bezugswerte gleich, Belegsperre dicht |
| **D** | Ergebnisraster zum Übernehmen ins Protokoll |

### 3. Nachher messen

Dasselbe Blatt wie in Schritt 1. Erwartet:

| Zeile | Gegenstand | vorher | nachher |
|---|---|---|---|
| 102 | Freitextpositionen | 206 | **171** |
| 103 | mit exaktem Katalogtreffer | 35 | **0** |
| 402 | Einkaufspositionen auf Portalen | 0 | **35** |
| 401 | Einkaufspositionen auf Spielen | 37 | **37** |
| 403 | Lagerzeilen je Art | `figure=272, game=13` | **unverändert** |
| 502 | Sammlungseinträge auf Zubehör | 0 | **0** |

Und im Raster D: `ohne_sky_id` und `auf_portalen` bewegen sich, **jeder
andere Wert steht** — Positionen 2 128, Lagerzeilen 285, Einheiten 812,
Bewegungen 26, Verkaufspositionen 1 284, Sammlung 1, Katalogzeilen 626,
Belege, Angebote und deren `md5`.

---

## Rücknahme

```
supabase/rollback/R_portal_assignment.sql
```

Setzt auf genau diesen Positionen die `sky_id` wieder auf NULL. Sie trifft
nur Zeilen, bei denen **alle fünf** Dinge zutreffen: die `sky_id` ist einer
der elf Artikel, der `raw_name` ist genau dessen Name, der Zustand ist
`reconciled_legacy`, es gibt keine Lagerbewegung, und `source_row` ist
gesetzt. Eine später von Hand erfasste Portalposition trägt nicht denselben
Rohnamen und wird deshalb nicht mitgerissen; weicht die Zahl ab, bricht sie ab.

**Danach ist der Stand wieder der von heute:** 206 Freitextpositionen, 0 auf
Portalen. Der Rohname war nie angefasst, also ist nichts zu rekonstruieren.

---

## Was der Probelauf schon zeigt

`npm run verify:check-sql`, Durchgänge **P31** und **P32**, gegen echtes
PostgreSQL (PGlite, erfundene Zeilen in der Verteilung von Staging):

| | |
|---|---|
| **P31** | Portale 0 → **35**, Freitext 36 → 1, Bewegungen 0 → 0, **35/35 Rohnamen unverändert**, je Artikel die erwartete Zahl — und die Rücknahme stellt 0/36 wieder her |
| **P32** | sie **bricht ab**, wenn eine Position zuviel denselben Rohnamen trägt (A5) oder wenn an einer eine Lagerbewegung hängt (A6) — in beiden Fällen mit **0** zugeordneten Zeilen |

Mitgeprüft wird dabei ausdrücklich eine **fremde** Freitextposition
(`1.0 - Sulley`): sie bleibt nach dem Lauf ohne `sky_id`.

**Das ist kein Lauf gegen Staging.** Die Zeilen sind erfunden
(`supabase/checks/open_verifications.md`, Abschnitt 3a).

---

## Prüfsummen

| Datei | SHA-256 |
|---|---|
| `supabase/operations/staging-portal-assignment.sql` | `c8ab47a5d8b68c5ff1cf3696d0f8173ad5dba6e01dcd278ea4adf5ffb0edf5d3` |
| `supabase/rollback/R_portal_assignment.sql` | `30cb86378c0e9af01d507695b69e0ff2f061de45c6b7cdcdad76f17cc3f3a5cf` |
