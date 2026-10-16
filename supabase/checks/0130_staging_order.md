# Staging-Ausführungsreihenfolge für `0130` und `0131`

Beide Migrationen ersetzen **denselben** Funktionsrumpf
(`seller_business_backup()`). Sie müssen deshalb in dieser Reihenfolge laufen —
`0131`s Vorbedingung erzwingt es, aber eine Umkehrung wäre ein unnötiger
Abbruch.

**Nur Staging.** Keine Production. Keine Datenänderung: beide Migrationen
bestehen aus vier Anweisungen — zwei lesenden DO-Blöcken, einem `create or
replace function` und einem `comment on`. Kein `alter table`, kein Trigger,
kein Recht, kein `insert`.

## Vor dem Anfang

```
shasum -a 256 -c supabase/checks/SHA256SUMS.txt
```

Alle Dateien müssen `OK` sagen. Ein Chatblock oder eine Kopie aus einer Antwort
ist nicht maßgeblich — die Datei auf der Platte ist es.

## Schritt 1 — `0130_preflight.sql`

Erwartet: **`9999 = 0`**, Zeile 201 sagt `VOR_0130`.

Mitschreiben: die 9xx-Zeilen (902–905, 911–914). Sie sind die Gegenzahl für
Schritt 3 und Schritt 6 — `0130` darf keine davon bewegen.

Schlägt 133 an („die Spalten existieren aber"), fehlt eine Spalte im Schema und
`0130` würde beim ersten Download scheitern, nicht beim Anwenden.

## Schritt 2 — `0130_business_backup_fields.sql`

Im SQL-Editor, ganz. Erwartet: `NOTICE: 0130: Vorbedingungen erfuellt.` und
`NOTICE: 0130 ok: 18 Feldzeilen ergaenzt, neun personenbezogene draussen.`

Bricht sie ab, ist nichts passiert: `create or replace` und die beiden
DO-Blöcke laufen in einer Transaktion, und die Nachbedingung rollt die neue
Funktionsfassung mit zurück.

## Schritt 3 — `0130_postflight.sql`

Erwartet: **`9999 = 0`**. Besonders ansehen:

* **101–108** — die 18 neuen Feldzeilen, Beträge als Text.
* **121–125** — was NICHT drinsteht: kein Absender-, Inserats- oder
  Vereinbarungsfeld, keine Kontoidentität, kein Idempotenzschlüssel, kein
  Tagesplatz. Das ist die wichtigste Gruppe dieser Datei.
* **301–309** — die Eigenbelege: Trigger, Teilindizes, Zusicherungen, Rechte,
  die fünf Belegfunktionen, die Idempotenz der Erstausstellung.
* **9xx** — **müssen Schritt 1 gleichen.** Alle vier Prüfsummen (912–914)
  identisch; weicht eine ab, hat zwischen den Läufen jemand geschrieben, und
  das gehört geklärt, bevor es weitergeht.

## Schritt 4 — `0131_preflight.sql`

Erwartet: **`9999 = 0`**, Zeile 201 sagt `VOR_0131`, Zeile 101 bestätigt, dass
`0130` angekommen ist.

Zeile **123** muss `1` zeigen: genau eine aktive Verkäuferzeile. Zeigt sie
etwas anderes, ist das ein Befund über die Stammdaten und kein Exportproblem —
`0122` wählt den Belegaussteller mit `where is_active limit 1` aus, und bei zwei
aktiven Zeilen wäre diese Auswahl schon heute zufällig.

## Schritt 5 — `0131_business_backup_seller_fields.sql`

Erwartet: `NOTICE: 0131: Vorbedingungen erfuellt.` und `NOTICE: 0131 ok:
Haendlerstammdaten vollstaendig, Privatdaten weiter draussen.`

## Schritt 6 — `0131_postflight.sql`

Erwartet: **`9999 = 0`**. Besonders: **101–105** (die 13 Feldzeilen), **121–124**
(Privatdaten draußen, Bereich `seller` ohne Zeitstempel), **202** (was `0129`
und `0130` gebracht haben, ist noch da), **301–309** (Belege unangetastet) und
**9xx gegen Schritt 4 und Schritt 1**.

## Schritt 7 — Sicherung herunterladen

`/business/datensicherung` → „Sicherung herunterladen". Die Datei gehört auf die
eigene Platte, **nicht** in den Projektordner.

## Schritt 8 — `0129_export_baseline.sql`

Erneut laufen lassen, **nach** dem Download: die Gegenzahlen müssen aus
demselben Zustand kommen wie die Datei. Erwartet: `9999 = 0` und dieselben
Zahlen wie bisher — die Bereichszähler ändern sich durch `0130`/`0131` nicht,
nur die Felder je Zeile.

## Schritt 9 — Verifikation

```
npm run verify:backup -- --file ~/Downloads/skyisles-business-backup-….json
```

Erwartet: **`ERGEBNIS: 0 Abweichungen.`** Das Werkzeug prüft jetzt zusätzlich
den **Feldabgleich je Bereich**:

* Der Plan kommt aus **zwei** Quellen, die ohne die Datei auskommen:
  `src/lib/backup/manifest.ts` (die Entscheidung) und der Rumpf der letzten
  Migration (die Ausführung). Weichen sie voneinander ab, bricht das Werkzeug
  **ab, ohne die Datei zu prüfen** — ohne widerspruchsfreien Plan wäre jedes
  Ergebnis eine Aussage über die falsche Erwartung.
* Drei getrennte Kategorien: **fehlend**, **unerwartet** und **ausdrücklich
  ausgeschlossen**. Die dritte ist die schwerste: ein Ausschluss hat einen
  Grund, und bei `sender_name` ist der Grund Datenschutz.
* **Leere Bereiche werden als `leer` ausgewiesen, nicht als `ok`.** Für sie
  sagt die Datei über Felder nichts; die Erwartung kommt dann allein aus
  Manifest und SQL. Bei einem jungen Betrieb sind das die meisten Bereiche —
  ohne diese Unterscheidung hielte der Validator sie für vollständig.

In der Tabelle `FELDER JE BEREICH` müssen die vier nicht-leeren Bereiche
(`purchases`, `purchase_items`, `purchase_receipts`,
`purchase_receipt_downloads`, dazu `figures` und `purchase_receipt_counters`)
`ok` zeigen und überall `0 0 0` stehen.

## Schritt 10 — die Baseline im Code nachziehen

Die Bereichszähler und die drei Prüfsummen in `STAGING_BASELINE`
(`src/lib/backup/export-audit.ts`) bleiben gültig, solange niemand einen Beleg
ausstellt oder einen Einkauf anlegt. Tut er es, meldet das Werkzeug eine
Abweichung — richtig, und dann gehört die Baseline nachgezogen, nicht die
Prüfung abgeschaltet.

## Wenn etwas schiefgeht

| Befund | Bedeutung |
|---|---|
| Preflight `UNKLAR` | halb angewendeter Zustand; **nicht** migrieren, erst klären |
| Migration bricht ab | nichts passiert, die Transaktion ist zurückgerollt; die Meldung nennt die Prüfung |
| Postflight 121–125 schlägt an | ein personenbezogenes Feld ist im Export — **sofort stoppen**, das ist der Fall, den die ganze Kette verhindern soll |
| Postflight 9xx weicht ab | zwischen den Läufen wurde geschrieben; klären, bevor es weitergeht |
| `verify:backup` bricht mit „nicht einig" ab | Manifest und SQL driften; die Datei ist dann ungeprüft |
| Feldtabelle zeigt `FEHL` | je nach Kategorie: Export unvollständig, unbekanntes Feld, oder ein ausgeschlossenes Feld ist drin |
