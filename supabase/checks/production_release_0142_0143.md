# Production-Release `0142` + `0143` — Plan

**Stand 2026-10-24. Nichts davon ist ausgeführt.** Kein Production-Write,
kein Push, kein Deployment. Diese Datei sagt, in welcher Reihenfolge es
geschehen muss, warum diese Reihenfolge die **umgekehrte** des letzten
Releases ist, und woran man merkt, dass es schiefgeht.

---

## 1. Der gemessene Ausgangszustand

| | Stand | wie belegt |
|---|---|---|
| **Staging** `qqxcpesbwfxzgytkdsac` | `0143` | `0142` am 2026-10-22, `0143` am 2026-10-24 angewendet; beide Nachkontrollen `9999 = 0` (vom Betreiber gemeldet) |
| **Production** `zmiwxswrpkmizvqsgype` | `0141` | Release `0135`–`0141` abgeschlossen; `0141`-Postflight `9999 = 0` (vom Betreiber gemeldet, 2026-10-21) |
| **Deployt** auf `skyisles.app` | **`027c474`** = `origin/main` | sieben Commits nach `21353e4`, und **alle sieben ändern nur Tests, Werkzeuge, SQL-Dateien und Doku** — kein Laufzeitcode unter `src/` außer `*.test.ts`. Das deployte VERHALTEN ist deshalb unverändert das von `21353e4` |
| **Lokal** | 10 Commits vor `origin/main` | nichts gepusht |

> **Korrektur gegenüber der Annahme im Auftrag.** Dort steht `21353e4` als
> deployter Stand; `origin/main` ist aber `027c474`. Der Unterschied ist
> **funktional keiner** (siehe oben), aber das **Rollback-Ziel** heißt
> `027c474` und nicht `21353e4`: ein Vercel-Rollback zeigt auf ein
> Deployment, nicht auf einen Commit-Wunsch.

**Production braucht:** `0142` → `0143`. Sonst nichts.

---

## 2. Die Reihenfolge — und diesmal ist sie umgekehrt

```
[ 0142 ] → [ 0143 ] → [ VERCEL-DEPLOYMENT ]
```

**Datenbank zuerst, Code danach.** Das ist das Gegenteil des Schnitts im
Release `0135`–`0141` (dort musste `0138` *nach* dem Deployment laufen), und
es ist nicht aus Gewohnheit entschieden, sondern aus dem, was die beiden
Zwischenzustände tatsächlich tun.

### 2a. Migrationen vor dem Code: der Zwischenzustand ist **wirkungslos**

Der deployte Code kennt weder die Tabelle noch die Funktion — die Dateien,
die sie nennen, existieren dort nicht:

```
git show origin/main:src/lib/calculator/saved-actions.ts   → existiert nicht
git grep purchase_calculations origin/main -- src/          → kein Treffer
```

Und nichts Bestehendes bekommt die neuen Objekte zu sehen:

| Mögliche Berührung | Tatsächliche Wirkung | Beleg |
|---|---|---|
| Eine neue Tabelle in `public` | **keine.** `shop_offers()`, `is_shop_eligible()`, der Katalog, die Sammlung, der Warenkorb, der Checkout und das Orderbuch nennen feste Tabellen | `0142` legt nur an, ändert nichts |
| Die Plattformsicherung | **keine.** `system_platform_export()` (`0105`) führt eine **feste** Tabellenliste und zählt nicht auf, was es in `public` gibt | kein `information_schema.tables` in der Funktion |
| Eine neue Funktion in `public` | **keine.** `0143` ist `create function`, nicht `create or replace` — kein bestehender Rumpf wird ersetzt. Gerufen wird sie von niemandem | `0143`, Abschnitt 2 |
| PostgREST-Schema-Cache | nimmt beide auf. Ein neuer Endpunkt, den kein deployter Client kennt | — |
| RLS | `purchase_calculations` ist von Anfang an geschlossen: `revoke all … from anon`, vier Richtlinien auf `auth.uid() = user_id` | `0142`, Abschnitte 5–6 |

**Für Besucher, Sammler und Kundschaft ändert sich in diesem Zustand
nichts** — nicht ein Pixel, nicht eine Abfrage.

### 2b. Code vor den Migrationen: es gäbe einen **sichtbaren Defekt**

Umgekehrt wäre der Zwischenzustand nicht leer. Der neue Code ruft Dinge auf,
die es dann noch nicht gibt:

| Aufruf | Antwort ohne `0142`/`0143` | Was der Betreiber sieht |
|---|---|---|
| `listCalculations()` beim Öffnen des Kalkulators | PostgREST `42P01` → `{ok: false, reason: "failed"}` | „Die gespeicherten Kalkulationen konnten nicht geladen werden." mit Wiederholknopf; der Knopf zeigt „Gespeichert (0)" |
| `createCalculation()` / `updateCalculation()` | derselbe Fehler → `saveError` | „Nicht gespeichert. Der Arbeitsstand bleibt erhalten — nochmal versuchen?" |
| `fetchOwnCalculation(id)` | Fehler → `null` | `/business/orderbuch/neu?kalkulation=…` zeigt das **leere** Formular, wie ein Aufruf ohne Parameter |
| `seller_create_purchase_from_calculation` | **wird nie gerufen.** Der Zweig hängt an `calculationId`, und die ist nur gesetzt, wenn `fetchOwnCalculation` eine Zeile lieferte — was ohne `0142` unmöglich ist | — |

Kein Absturz, keine 500, kein Datenverlust: jeder dieser Wege endet in einer
Meldung, und der Arbeitsstand liegt ohnehin im Browser. Aber es wäre ein
**fehlerhaft aussehendes Produkt** für die Dauer des Zwischenzustands, und
zwar genau an der Stelle, die dieses Release liefern soll.

Betroffen wäre nur der **Betriebsaccount**: `CalculatorLauncher` rendert
`site-nav.tsx` ausschließlich bei `business`. Für alle anderen wäre auch
dieser Zwischenzustand unsichtbar.

### 2c. Das Fazit, in einem Satz

Der eine Zwischenzustand ist **wirkungslos**, der andere ist **sichtbar
kaputt**, und beide dauern gleich lang. Also Datenbank zuerst.

> **Warum das beim letzten Release andersherum war.** `0138` legte 21 Portale
> an, und der damals deployte Code zählte Portale in den
> Fortschrittsnenner — die Migration hätte für jeden Sammler die Statistik
> verfälscht, bis das Deployment nachkam. `0142` und `0143` legen nichts an,
> was bestehender Code liest. Die Reihenfolge folgt also der Wirkung, nicht
> dem Muster.

### 2d. Und wenn zwischen `0142` und `0143` etwas dazwischenkommt

Dieser Zwischenzustand ist ebenfalls wirkungslos: eine Tabelle, die niemand
liest. Es gibt keinen Druck, `0143` sofort hinterherzuschicken, und keinen
Grund, beide in einen Lauf zu legen — `0143` setzt `0142` ausdrücklich
voraus und bricht ohne sie ab („0143 setzt 0142 voraus").

---

## 3. Der Ablauf, Schritt für Schritt

Jeder Schritt ist: **eine Datei, vollständig markieren, in den SQL-Editor
des Production-Projekts einfügen, ausführen.** Nichts in Teilen.

| # | Was | Datei | schreibt? |
|---|---|---|---|
| 1 | Vorzustand festhalten | `supabase/operations/prod-s-preflight-0142.sql` | nein |
| 2 | **Migration 0142** | `supabase/operations/prod-0142.sql` | **ja** |
| 3 | Nachkontrolle | `supabase/operations/prod-s-postflight-0142.sql` | nein |
| 4 | Vorzustand festhalten | `supabase/operations/prod-s-preflight-0143.sql` | nein |
| 5 | **Migration 0143** | `supabase/operations/prod-0143.sql` | **ja** |
| 6 | Nachkontrolle | `supabase/operations/prod-s-postflight-0143.sql` | nein |
| 7 | **Push** `main` → Vercel baut | `git push origin main` | **ja** |
| 8 | Live prüfen | Browser, Betriebskonto | nein |

**Stopp-Kriterien.** Jede Nachkontrolle muss in Zeile `9999` eine `0`
zeigen. Zeigt sie etwas anderes, ist der nächste Schritt **nicht** der
nächste Schritt, sondern das Melden des Befunds.

**Die Zahlen aus Schritt 1 und 4 bitte notieren.** Die Zeilen ohne Sollwert
(`ok` ist NULL) sind Messungen, und die Nachkontrolle vergleicht gegen sie:
„es ist kein Einkauf entstanden" ist ohne das Vorher keine Aussage.

---

## 4. Rückfallplan

### A — Fehler nach dem Push, aber vor den Migrationen

**Kann in dieser Reihenfolge nicht eintreten:** der Push ist Schritt 7, die
Migrationen sind 2 und 5. Falls die Reihenfolge doch umgestellt wird, gilt:
Vercel-Rollback auf das Deployment aus **`027c474`**, und die Datenbank ist
unberührt. Kosten: keine, es ist nichts entstanden.

### B — Fehler nach Migration `0142`

Die Migration läuft in **einer** Transaktion. Bricht sie ab, ist nichts
entstanden — kein halber Zustand, nichts aufzuräumen.

Läuft sie durch und stellt sich danach etwas als falsch heraus:
`supabase/rollback/R0142_drop_purchase_calculations.sql`.

> **Sie ist absichtlich nicht einfach auszuführen.** Sie **zählt zuerst**,
> wie viele Kalkulationen gespeichert sind, und **bricht ab**, sobald es
> mehr als null ist. Wer wirklich löschen will, setzt den Schalter in der
> Datei. Unmittelbar nach Schritt 2 ist die Tabelle leer, die Rücknahme also
> gefahrlos — **nach dem Deployment nicht mehr.**

Nicht betroffen: Angebote, Lager, Bestellungen, Einkäufe, Sammlungen,
Belege. `0142` fasst nichts davon an.

### C — Fehler nach Migration `0143`

Ebenfalls eine Transaktion. Danach:
`supabase/rollback/R0143_drop_purchase_from_calculation.sql`.

**Sie ist verlustfrei.** Sie nimmt die Funktion fort und lässt stehen:

- `seller_create_purchase_with_items` — unberührt, und danach wieder der
  ausschließliche Weg, einen Einkauf anzulegen;
- **jeden bestehenden Einkauf**, auch die aus einer Kalkulation entstandenen;
- **jede Verknüpfung** `purchase_calculations.purchase_id`. Die Zuordnung ist
  der Nachweis, welcher Einkauf aus welcher Bewertung entstand; sie
  wegzuwerfen, weil ein Weg dorthin entfällt, wäre Datenverlust ohne Anlass.

Die Oberfläche zeigt danach weiter „Einkauf ansehen"; nur neu übernehmen
kann sie nicht mehr — und das meldet sie als Fehler, statt etwas Falsches zu
tun.

### D — Fehler nach dem vollständigen Deployment

**Zuerst der Code, nicht die Datenbank.** Vercel-Rollback auf das Deployment
aus `027c474`. Das ist in Sekunden erledigt, trifft keine Daten und stellt
genau den Stand her, der seit dem 2026-10-21 läuft.

Danach steht die Datenbank mit `0142` und `0143` da, während der Code sie
nicht mehr kennt — **also wieder Zustand 2a, der wirkungslose.** Eine
Tabelle, die niemand liest, und eine Funktion, die niemand ruft. Es besteht
**kein Zwang**, die Migrationen ebenfalls zurückzunehmen.

> **Das ist der eigentliche Grund für diese Reihenfolge.** Sie macht den
> Rückweg einseitig: Code-Rollback allein genügt, und die unangenehme Frage
> „was tun mit den Daten, die inzwischen entstanden sind?" stellt sich gar
> nicht erst.

**Was ein Code-Rollback NICHT rückgängig macht** — und auch nicht soll:

| Entstanden | Nach dem Rollback | Warum das richtig ist |
|---|---|---|
| gespeicherte Kalkulationen | bleiben in der Tabelle, unsichtbar | Sie gehören dem Betreiber. Ein Rollback des Codes ist kein Löschauftrag |
| aus Kalkulationen erzeugte **Einkäufe** | bleiben, vollständig und normal bedienbar | Sie sind technisch nicht von getippten unterscheidbar (ADR-0132) — es gibt gar nichts, was man an ihnen zurücknehmen könnte |
| Verknüpfungen `purchase_id` | bleiben stehen | siehe C |
| Lagerbewegungen | **keine entstanden.** Eine Übernahme bucht nichts ein | `0143`, Zeile 204 der Nachkontrolle |

**Kein destruktiver Rückfall ist geplant**, und keiner ist nötig.

### Was sich nicht sinnvoll zurücknehmen lässt

`R0142` **nach** dem Deployment, sobald Kalkulationen gespeichert sind: der
`drop table` nähme echte Benutzerdaten mit, und die Rücknahme verweigert das
von sich aus.

**Vorwärtskorrektur statt Rücknahme:** Ist an `0142` etwas fachlich falsch
(ein zu enger CHECK, eine fehlende Spalte), gehört das in eine **neue
Migration** `0144`, die ändert statt zu löschen. Ist die Oberfläche das
Problem, genügt ein Code-Rollback — die Tabelle stört niemanden.

---

## 5. Was dieses Release ausdrücklich nicht anfasst

Geprüft an den beiden Migrationen und am Diff:

- **Belegsperre** — `0143` nennt die Belegausstellung nirgends (Zeile 703
  der Nachkontrolle prüft es am Funktionstext), und keine API-Rolle bekommt
  `execute` auf `issue_platform_receipt` / `correct_platform_receipt`.
- **Verkaufsfreigaben** für Zubehör, Spiele und Portale — kein `update` auf
  `shop_inventory`, kein `sale_released`.
- **Shop-Angebote** — `shop_offers()` und `is_shop_eligible()` unberührt;
  Preflight und Postflight halten Zahl und Abdruck fest.
- **Bestandsbewegungen und Einbuchung** — eine Übernahme legt Positionen im
  Zustand `ordered` mit `movement_id = NULL` an, genau wie ein getippter
  Einkauf. Auf Staging gemessen: 26 Bewegungen vorher, 26 nachher.
- **Bestehende Einkäufe** — `0143` fügt selbst nichts in `purchases` oder
  `purchase_items` ein; sie ruft die bestehende Funktion.
- **Rollen und Berechtigungen** — keine neue Rolle, kein neuer Grant außer
  `execute` für `authenticated` auf die eine neue Funktion und den
  Tabellen-Grant aus `0142`, der `anon` ausdrücklich **entzieht**.

---

## 6. Die Befehle, vollständig

```bash
# vorher, lokal — alles muss grün sein
npm run check          # lint + typecheck + build + SQL-Planprüfung
npm test               # die volle Suite

# Schritt 7, NACH den beiden Migrationen und ihren Nachkontrollen
git push origin main   # löst den Vercel-Build auf skyisles.app aus
```

**Nicht ausführen:** `npm run verify:calculations:prod` oder
`verify:purchase-from-calculation:prod` — es gibt sie nicht, und es soll sie
nicht geben. Beide Werkzeuge legen Konten, Kalkulationen und Einkäufe an;
das gehört auf Staging und nirgendwo sonst.
