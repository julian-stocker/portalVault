# 0164 auf Staging — der Laufzettel

> **Dieselbe Datei wie `0163_staging_run.md`.** Die zwei Migrationen sind
> ein Vorgang in zwei Schritten — `0163` legt die Spalten an, `0164` bringt
> sie in die Plattformsicherung —, und zwei Laufzettel für einen Vorgang
> wären zwei Fassungen, die auseinanderlaufen. Was für `0164` gilt, steht
> unten in Schritt 5 und in der Wächtertabelle.

**Der TYPE: eine Menge je Artikel, höchstens ein Banner.** CAT-10, ADR-0160.
**Stand 2026-10-29: `0163` ist auf Staging angewendet und vollständig geprüft**
(Abschnitt „Der Lauf" unten); auf **Production nicht**.

**Reihenfolge: `0162` → `0163` → `0164`.** `0162` und `0163` sind seit dem
2026-10-29 auf Staging angewendet (je berechtigte Nachkontrolle `9998 = 0` UND
`9999 = 0`); **`0164` ist seit demselben Tag ebenfalls angewendet** — technisch
verifiziert, mit zwei ausdrücklich erklärten Abweichungen in der Nachkontrolle
(`9999 = 2`, SKY-0564 im offenen Fenster versteckt; `supabase/migrations/APPLIED.md`).

## Worum es geht

Bis CAT-10 trug eine Katalogzeile **eine** Klassifikation: `card_type`, sieben
Werte, eine Spalte. Gemessen am 2026-10-29 um 13:11 verschweigt das bei
**206 von 694** Zeilen eine Eigenschaft — denn was ein Ding *ist* (Giant, Trap, Fahrzeug) hing
an der **Kategorie** und kam nie auf eine Kachel. „Legendary Giant" war in der
Datenbank entweder ein Giant oder ein Legendary.

| | |
|---|---|
| `skylanders.types` | `text[]`, die vollständige Menge aus **17** Werten |
| `skylanders.visible_type` | der **eine**, der als Banner erscheint, oder NULL |
| `skylanders.visible_type_decided` | hat ein Mensch entschieden? |

## Die Frage, an der diese Migration hing

**Lässt sich `card_type` aus der Menge ableiten?** Der Betreiber hat verlangt,
das sorgfältig zu prüfen. `supabase/checks/cat10_projection_proof.sql`, gegen
den **ganzen Katalog** gefahren, sagt **nein** — in drei Punkten. Sie lief
zweimal am 2026-10-29, weil dazwischen redaktionell gearbeitet wurde; die
zweite Messung (13:11, 694 Zeilen) ist die gültige:

1. **Es verlören Zeilen ihre Kartenkunst — und es wurden mehr.** Um 11:12
   (701 Zeilen) war es **eine**: SKY-0854 „White Flocked LightCore Prism
   Break", damals `standard` → projiziert `special`; Abdruck `4d6bbb02…`,
   projiziert `ece2af88…`. Um 13:11 (694 Zeilen) sind es **zwei**: SKY-0172
   und SKY-0854, beide inzwischen `chase` → projiziert `special`; Abdruck
   `4b81b918…`, projiziert `5d324fcb…`. **Die Zahl bewegt sich, der Befund
   nicht** — und genau darum ist in dieser Vorbereitung **kein** Abdruck als
   Riegel eingefroren.
2. **Es gibt keine eindeutige Reihenfolge.** `EDITION_RANK` gibt `standard`,
   `chase` und `elite` denselben Rang 0 — beides mit Absicht. Eine Menge mit
   Chase **und** Elite hätte keine fachliche Antwort. 45 bzw. 42 Zeilen könnten
   morgen beides tragen.
3. **Jede Typänderung bewegte die Kartenkunst.** 508 Zeilen beim Hinzufügen,
   193 beim Entfernen — 39 davon im Shop gelistet, 4 in Sammlungen.

**Also zwei Eigenschaften, zwei Spalten.** `card_type` steuert weiter die
Kartenkunst (sieben PNG-Dateien), `types` die fachliche Klassifikation,
`visible_type` das Banner. Der Dialog führt beide getrennt und nennt sie
getrennt: **„Types"** und **„Kartenkunst"**.

## Woher jeder Type kommt

Aus **strukturierten** Daten, nie aus einem Figurennamen (ADR-0034):

| Type | Quelle | Zeilen |
|---|---|---|
| Giant · Swapper · Master · Sensei | `categories.catalog_group` | 15 · 30 · 28 · 52 |
| Item · Trap · Vehicle · Crystal | `categories.catalog_group` | 48 · 66 · 36 · 39 |
| **Mini** | Gruppe `mini` **und** Kategorie „Minis" | 19 |
| **Sidekick** | Gruppe `mini` **und** Kategorie „Sidekicks" | 8 |
| Special · Elite · Dark · Legendary · Chase · Prestige | `card_type` | 35 · 42 · 22 · 28 · 45 · 3 |
| **LightCore** | **kuratierte Liste von 21 SKY-IDs** | 21 |

**Mini und Sidekick hängen am Kategorienamen**, weil „Sidekicks" heute die
Gruppe `mini` trägt — 27 = Minis 19 + Sidekicks 8. Die Gruppe kann die beiden
nicht trennen, der Kategoriename kann es, und eine Kategorie ist kuratiert.

**LightCore ist eine Liste**, weil es dafür keine strukturierte Quelle gibt
(Entscheidung D2). Dieselbe Bauform wie `0032` für die 42 Eon's-Elite-Zeilen:
ausgeschrieben, nachlesbar, **einmal** angewendet. Die Liste samt Namen und
heutiger Kartenkunst steht in `cat10_projection_proof.sql`, Zeile 103.

## Die eine gewollte Änderung am Bildschirm

**Die LightCore-Zeilen mit der Kartenkunst `special` zeigen danach LIGHTCORE
statt SPECIAL** — Stand 2026-10-29 um 13:11 sind das **17 von 21**. Das ist die
Folge von Entscheidung D3: eine LightCore bekommt **nicht** zusätzlich den Type
`special`, denn `special` war dort nur die Kartenkunst. **Ihre Kartenkunst
bleibt `special`** und damit unverändert; die zwei Legendary-LightCores
behalten `legendary`, die zwei mit `chase` behalten `chase`.

Alle übrigen **189** Banner bleiben zeichengleich. Die **273** Zeilen, die nur
eine Gruppe tragen (davon 251 öffentlich), bekommen **kein** Banner — sonst
erschienen auf einen Schlag neue (Entscheidung D4).

> **Keine dieser Zahlen ist eingefroren.** Wächter **A7** der Hülle misst den
> Abdruck der Kartenkunst und die Zahl der erwarteten Bannerwechsel **vor** dem
> Lauf und legt sie transaktionslokal ab; **B3** und **B5** vergleichen danach.
> Verschiebt jemand bis zum Lauf noch eine LightCore von `special` auf `chase`,
> sind es sechzehn — und die Migration läuft trotzdem richtig durch.

## Drei Zustände, und die Datenbank kennt alle drei

| `visible_type` | `decided` | Bedeutung |
|---|---|---|
| NULL | `false` | niemand hat entschieden → das Dropdown schlägt vor |
| NULL | `true` | **ausdrücklich „–"** → der Vorschlag greift nie wieder |
| gesetzt | immer `true` | dieses Banner |

**Die Mitgliedschaft ist eine Zeilen-CHECK**, kein Trigger und kein
Anwendungsversprechen: `visible_type is null or visible_type = any (types)`.
Genau deshalb steht die Menge als `text[]` auf derselben Zeile und nicht in
einer Zuordnungstabelle — dort bräuchte dieselbe Regel einen zusammengesetzten
Fremdschlüssel, der Export einen eigenen Bereich, und
`admin_merge_references` zählte einen neuen Fremdschlüssel und blockierte
damit jede Figurenlöschung.

## Die Schritte

> **Schritte 1 bis 4 sind am 2026-10-29 gefahren** (Abschnitt „Der Lauf"); offen
> ist **Schritt 5**, also `0164`.

1. **`0162` ist angewendet** (CAT-09, eigener Laufzettel, Staging seit
   2026-10-29). Ohne sie bricht `0163` ab — Preflightzeile 112 und Wächter A5
   messen es.

2. **Preflight** (rein lesend):
   ```
   npm run db:migrate:staging -- 0163
   ```
   Erwartet `9999 = 0`. Zeile **112** ist die Reihenfolgeprüfung, **136** die
   LightCore-Wechsel als **Auskunft** (die Hülle vergleicht sie selbst),
   **151** der Abdruck der Kartenkunst, den die Nachkontrolle wieder nennt.

3. **Die eine schreibende Anweisung** — `supabase/operations/staging-0163.sql`,
   vollständig markieren, einfügen, ausführen. **Nichts daran ändern.**

4. **Nachkontrolle**: `npm run db:migrate:staging -- 0163 --resume`.
   Erwartet `9998 = 0` und `9999 = 0`. **Zeile 131 muss der Abdruck aus
   Preflight 151 sein** — das ist die Zusage, um die der Betreiber gebeten hat.

5. **Dann `0164`**: Preflight, `supabase/operations/staging-0164.sql`,
   Nachkontrolle. Zeile **107** der Nachkontrolle ist die Umkehrprobe: die drei
   Zeilen abgezogen ergibt zeichengleich den Rumpf aus `0160`.

## Die Wächter

| | 0163 |
|---|---|
| **A1** | falsche Umgebung |
| **A2** | `catalog_group`, die zwei Zusammenführungsfunktionen oder `is_platform_admin` fehlt |
| **A3** | eine der zwei ist **nicht die Fassung aus `0157`** |
| **A4** | `skylanders_card_type_known` fehlt |
| **A5** | **`0162` liegt nicht** — sonst würfe sie später die zwei neuen Journalwerte weg |
| **A6** | die kuratierte LightCore-Liste trifft nicht 21 Zeilen |
| **B1–B7** | danach: Spalten, Constraints, **Mitgliedschaft im ganzen Bestand**, **Abdruck der Kartenkunst gegen den von A7 gemessenen** (B3), kein Gruppentype als Banner, **LightCore-Banner gegen die von A7 gemessene Zahl UND gegen die Regel** (B5), Rechte, Exportrumpf noch der aus `0160`. **B3 und B5 brechen auch ab, wenn der von A7 abgelegte Wert FEHLT** — ein Riegel, der sich durch Weglassen entschärfen lässt, ist keiner |

| | 0164 |
|---|---|
| **A1** | falsche Umgebung |
| **A2** | die drei Spalten fehlen (`0163` zuerst) |
| **A3** | der Exportrumpf ist nicht der aus `0160` |
| **B** | Abdruck, Länge, und die Umkehrprobe |

## Stoppbedingungen

* `ABBRUCH A1`–`A6` — klären, nicht überschreiben
* Preflight 112 ≠ `true` — **`0162` fehlt**
* Preflight 121–124 ≠ `0` — eine Spalte steht schon
* **Nachkontrolle 131 ≠ Preflight 151 — eine Kartenkunst hat sich bewegt.**
  Das ist die Stoppbedingung, die der Betreiber ausdrücklich verlangt hat
* Nachkontrolle 106 ≠ `0` — die Mitgliedschaft hält nicht
* Nachkontrolle 118 ≠ `0` — eine der zwei Funktionen nennt `card_type`
* Nachkontrolle 126 ≠ `0` — ein Gruppentype ist auf ein Banner gelangt
* Nachkontrolle 143 ≠ `true` — ein alter Journalwert ist verloren
* eine veränderte Angebots-, Lager-, Katalog- oder Sammlungszahl

## Was gemessen ist, bevor jemand etwas ausführt

**P72** (`npm run verify:check-sql`), gegen echtes PostgreSQL:

* **Die Kartenkunst ist zeichengleich** — derselbe Abdruck vor und nach der
  Erstbelegung.
* Giant+Legendary, Trap+Special, Vehicle+Chase, Sensei+Elite, Crystal+Dark
  stehen **nebeneinander**; Sidekick und Mini sind auseinandergehalten; ein
  Portal bekommt keinen Figurentype; **keine Gruppe landet auf einem Banner**.
* Die **Mitgliedschaft** weist an der Tabelle selbst ab: ein Banner außerhalb
  der Menge, ein unbekannter Type, ein Banner ohne Entscheidung.
* Alle **17** Types einzeln zuweisbar; die vier Kombinationen des Betreibers;
  „–" bleibt; das Entfernen des sichtbaren Types setzt auf „–" zurück; eine
  Zeile ohne Banner bleibt **unentschieden**; `42501` ohne Adminrecht; die
  Zusammenführung trägt die Menge als **neuntes** Feld; `R0163`.

**P73**: ohne `0164` führt das Archiv weder Menge noch Banner — mit ihr alle
drei, und der **Umlauf** beweist es: sichern, löschen, einspielen, und jede
Menge, jedes Banner und jedes ausdrückliche „–" steht wieder da. Ein halbes
Archiv (Banner ohne Menge) weist die CHECK ab.

## Der Lauf von `0163` vom 2026-10-29

| Schritt | Ergebnis |
|---|---|
| **Preflight** (`db:migrate:staging -- 0163`) | **42 Zeilen, `9999 = 0`, keine offene Zeile** |
| **Baseline** | `supabase/baselines/baseline-0163.json`, erhoben 14:17:15.335Z, Prüfsumme `f00787e5f82b4627…` — danach **nie neu erhoben**, vor und nach der Nachkontrolle dieselbe |
| **Die eine schreibende Anweisung** | Betreiber, im SQL-Editor von `qqxcpesbwfxzgytkdsac` als `postgres`, über `supabase/operations/staging-0163.sql` — Supabase meldete `Success` |
| **Nachkontrolle** (`--resume`) | **69 Zeilen, `9999 = 0`**, eine offene Zeile (144, `catalog_admin_changes`) |
| **Berechtigter Lauf** | `supabase/log/staging/0163-postflight-berechtigt.sql` als `postgres`: **`9998 = 0` UND `9999 = 0`**, Zeile 144 = **0** |

**Die Baseline ist zeichengleich der von `0162`** — zwischen den beiden
Migrationen hat sich im Katalog nichts bewegt, und damit ist nachgewiesen, dass
`0162` wie zugesagt keine Datenzeile angefasst hat: Angebote 257, shopfähig und
sammelbar je 565, Lagerzeilen 287, Katalogzeilen 694, Sammlung 21, Favoriten 1.

**Der gemessene Zustand nach dem Lauf** (rein lesend, `set transaction read
only`, `rollback`):

| | |
|---|---|
| Katalogzeilen | 694 |
| mit mindestens einem Type | **479** · ohne 215 · mit **zwei** 66 · größte Menge 2 |
| mit Banner | **206**, und **alle 206** mit `visible_type_decided = true` |
| Banner ohne Mitgliedschaft in der eigenen Menge | **0** |
| „kein Banner, aber entschieden" | **0** |
| Banner je Wert | `chase` 56 · `elite` 42 · `special` 42 · `legendary` 28 · `dark` 21 · `lightcore` 17 |
| LightCore | **21**, **alle** aus der kuratierten Liste — kein Treffer außerhalb |
| Bannerwechsel SPECIAL → LIGHTCORE | **17** |
| Kartenkunst-Abdruck `md5(sky_id\|card_type)` | `4b81b91886b911d6f9dcbbca0d381be3` — **unverändert** |
| `card_type` je Wert | `standard` 488 · `special` 59 · `chase` 56 · `elite` 42 · `legendary` 28 · `dark` 21 |

**Kein Gruppen-Type ist Banner geworden** (D4/D6), und die vier LightCore-Zeilen
mit einer **zweiten, echten** Eigenschaft haben deren Banner behalten (D3):
`{legendary,lightcore}` SKY-0130 und SKY-0252 zeigen LEGENDARY,
`{chase,lightcore}` SKY-0172 und SKY-0854 zeigen CHASE.

**Die Hülle hat ihren Abdruck GEMESSEN, nicht eingefroren** — und das war die
Korrektur, ohne die dieser Lauf abgebrochen wäre: `staging-0163.sql` verglich
ursprünglich gegen `4d6bbb02…` vom Vormittag, und nach der redaktionellen
Arbeit des Betreibers war der lebende Wert `4b81b918…`. Der Prüfwert ist
**nicht ungeschützt entfernt** worden: **A7** misst ihn und legt ihn
transaktionslokal ab, **B3** liest ihn zurück und **bricht ab, wenn die Ablage
fehlt**. `P72` Abschnitt **U** fährt alle drei Fälle an echtem PostgreSQL.

**Protokolliert in `supabase/migrations/APPLIED.md`**, Spalte `Datei heute` =
`gleich`.

## Die Freigabe, die sie brauchen

1. dass die LightCore-Zeilen mit der Kartenkunst `special` von SPECIAL auf
   LIGHTCORE wechseln (Folge von D3) — Stand 2026-10-29 um 13:11 **17 von 21**,
2. dass die **kuratierte LightCore-Liste** der 21 SKY-IDs stimmt — sie steht
   namentlich in `0163`, Abschnitt 6, und in `cat10_projection_proof.sql`,
3. dass die Zeilen mit nur einer Gruppe **kein** Banner bekommen (Stand
   13:11: **273**, davon 251 öffentlich), sondern eines erst durch eine
   Auswahl im Dropdown.

**Der Betreiber hat alle drei am 2026-10-29 bestätigt, und danach lief `0163`
auf Staging.** Gemessen ist es hinterher: **17** Bannerwechsel, **21** LightCore
ausschließlich aus der kuratierten Liste, und **206** Banner insgesamt — jedes
ausdrücklich entschieden, keines von einer Gruppe. Für `0164` galt die Freigabe
**nicht mit**; sie ist eine eigene. Und für Production gilt sie ohnehin erneut.
