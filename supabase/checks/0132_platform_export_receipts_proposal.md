# Vorschlag `0132` — die Eigenbelege in den Plattformexport

**Status: Vorschlag. Nichts implementiert, keine Migration geschrieben.**
Dieser Schritt ist `0130d` aus `0130_backup_extension_proposal.md` und braucht
eine **eigene Freigabe**: der Plattformexport ist ein Admin-Werkzeug mit eigener
Archivdatei, eigener Verlaufstabelle und eigenen Prüfsummen.

## Der Befund

`system_platform_export()` (`0105`) führt **53 Bereiche** — und keinen davon
für die Eigenbelege. Die Funktion ist älter als `0122`, und niemand hat sie
nachgezogen. Damit ist die Zusicherung „der Plattformexport ist das größere
Netz" heute **verletzt**: der Betriebsexport führt seit `0129` drei Bereiche,
die das Plattformarchiv nicht kennt.

Verzeichnet ist das an drei Stellen:

* `PLATFORM_EXCLUDED_TABLES` in `src/lib/backup/platform-manifest.ts` — mit
  dem ausdrücklichen Vermerk, dass es ein offener Punkt und keine Entscheidung
  gegen die Belege ist.
* `platform-manifest.test.ts` — als **geprüfte** Ausnahme: taucht eine vierte
  Tabelle in dieser Lücke auf, fällt der Test.
* `0130_backup_extension_proposal.md`, Abschnitt D.

## Was zu tun ist — konkret

### 1. Die Gruppe wählen

`system_platform_export()` baut `data` aus **sechs** `jsonb_build_object`-Aufrufen,
und zwar wegen `FUNC_MAX_ARGS` (100 Argumente je Aufruf, also 50 Paare). Heute:

| Gruppe | Bereiche | Argumente |
|---|---|---|
| Katalog | 6 | 12 |
| Nutzer und Sammlung | 2 | 4 |
| Seller und Shop | 10 | 20 |
| **Lager und Orderbuch** | **12** | **24** |
| Bestellungen | 18 | 36 |
| Tester | 5 | 10 |

Die drei Belegbereiche gehören fachlich zu **„Lager und Orderbuch"** — dort
stehen `purchases` und `purchase_items`. Danach: 15 Bereiche, 30 Argumente.
Weit unter der Grenze; keine neue Gruppe nötig.

### 2. Die drei Bereiche

Identisch zum Betriebsexport aus `0129` — dieselben Felder, dieselben
Ausschlüsse. **Kein eigener Zuschnitt:** zwei Exporte, die denselben Beleg
unterschiedlich beschreiben, wären schlimmer als einer, der ihn nicht kennt.

```
purchase_receipts              38 Felder, ohne issued_by
purchase_receipt_downloads      4 Felder, ohne delivered_by
purchase_receipt_counters       2 Felder
```

Zu beachten: der Plattformexport schreibt mit **8 Leerzeichen** Einrückung
(der Betriebsexport mit 6), und `platform-sql.test.ts` prüft die Bereiche über
genau dieses Muster.

### 3. Was mitzuändern ist

| Datei | Änderung |
|---|---|
| `src/lib/backup/platform-manifest.ts` | drei Bereiche in `PLATFORM_SECTIONS` ergänzen, die drei Einträge aus `PLATFORM_EXCLUDED_TABLES` **entfernen** |
| `supabase/migrations/0132_*.sql` | `create or replace function public.system_platform_export()` mit vollem Rumpf, drei Bereiche mehr |
| `platform-manifest.test.ts` | `NUR_IM_BUSINESS_EXPORT` **löschen** — die Lücke ist dann zu, und die Ausnahmeliste wäre ein Loch ohne Grund |
| `platform-sql.test.ts` | prüft Manifest gegen SQL; muss die **letzte** Fassung lesen, nicht `0105` — dieselbe Korrektur, die `backup-sql.test.ts` für `0129` gebraucht hat |
| `platform-archive.test.ts` | die Archivdatei bekommt drei Bereiche mehr; Prüfsummen je Datei prüfen, ob eine Erwartungszahl darin steht |
| `supabase/checks/0132_preflight.sql`, `0132_postflight.sql` | nach dem Muster von `0130`/`0131` |

### 4. Was dabei NICHT passieren darf

* **Kein `issued_by`, kein `delivered_by`.** Kontoidentitäten bleiben draußen,
  auch im Plattformarchiv — `AUTH_FORBIDDEN_FIELDS` führt sie dort ohnehin.
* **Keine andere Feldauswahl als im Betriebsexport.** Siehe oben.
* **`PLATFORM_FORMAT_VERSION` bleibt 1** — es kommen nur Bereiche dazu.
* **Der Export bleibt eine Anweisung je Gruppe und `stable`.** Sechs Gruppen in
  einem `select` sehen weiterhin eine MVCC-Momentaufnahme.

## Der Nutzen, nüchtern

Der Betriebsexport **trägt die Belege schon** (`0129`, auf Staging geprüft:
28/28 Bereiche, beide Belege samt Kette, Prüfsummen stimmen). Dieser Schritt
schließt also keine Lücke in der Wiederherstellbarkeit der Belege, sondern
stellt eine **Zusicherung** wieder her: dass das Plattformarchiv alles enthält,
was der Betriebsexport enthält. Das ist weniger dringend als `0129` war — und
mehr als Kosmetik, weil die Zusicherung sonst eine Behauptung bleibt, die ein
Test nur noch mit einer Ausnahmeliste aufrechterhält.

## Reihenfolge

Nach `0130` und `0131` und nach dem Restore-Test. Vorher gibt es keinen Grund:
solange die Wiederherstellbarkeit des Betriebsexports nicht nachgewiesen ist,
wäre ein zweiter Export mit denselben Daten nur ein zweiter unbewiesener.
