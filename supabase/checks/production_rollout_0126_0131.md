# Production-Rollout `0126`–`0131` — Bereitschaftsprüfung

**Nichts davon ist ausgeführt.** Dieses Dokument ist die Checkliste, nicht der
Vollzug. Jeder Schritt auf Production braucht eine eigene Freigabe.

Stand: 2026-10-16. Staging trägt `0126`–`0131` vollständig, Postflights je
`9999 = 0`, `0131_function_body_check.sql` zeichengleich.

---

## 1. Wo Production heute steht — messen, nicht annehmen

Aus `PROJECT_STATUS.md` (Stand 2026-10-15) ist belegt:

| | |
|---|---|
| angewendet | `0053`–`0085`, `0086`–`0089`, `0104`, `0115`, `0116`, **`0117`–`0123`** (2026-10-14/15) |
| **nicht** angewendet | `0099`–`0102` (freigegeben, nicht ausgeführt), `0103`, `0105`–`0107` |
| **nicht belegt** | **`0124`, `0125`** — in der Rollout-Zeile nicht genannt |
| ausgelieferter Anwendungsstand | `c24926e`; alles ab `0117` liegt unkommittiert lokal |

**Erster Schritt ist daher eine Messung, keine Migration.** Die vorhandenen
Preflights sind genau dafür gebaut und rein lesend; sie nennen jede
Voraussetzung namentlich und blockieren, wenn eine fehlt:

```
0126_preflight.sql → 0127_preflight.sql → 0128_preflight.sql
→ 0129_preflight.sql → 0130_preflight.sql → 0131_preflight.sql
```

Dazu `0131_function_body_check.sql`: auf Production muss er **`STAND_0130`
oder `UNBEKANNT`** melden — `STAND_0131_ZEICHENGLEICH` wäre dort ein Alarm,
nicht ein Erfolg.

**Offene Frage, die diese Messung beantwortet:** ob `0124` und `0125` auf
Production stehen. Beide sind klein und unabhängig, aber `0124` liefert den
Belegzustand in der Orderbuchzeile — die Oberfläche in diesem Änderungsbogen
zeigt ihn an. Fehlt `0124`, gehört es **vor** `0126` in die Reihenfolge.

## 2. Die tatsächliche Datensicherungslage — der wichtigste Abschnitt

**Aufgezeichnet in `PROJECT_STATUS.md` (2026-10-01):** *„Production läuft auf
Supabase Free: keine nativen Backups, kein PITR."* Daraus folgt nüchtern:

* **Es gibt keinen Punkt-in-der-Zeit-Rücksprung.** Eine Migration, die auf
  Production Schaden anrichtet, ist nicht per Dashboard zurückzuholen.
* **Das Platform-Backup (`0105`–`0107`) ist auf Production nicht angewendet.**
  Es gibt dort also kein Konten-Inventar, kein Storage-Manifest und keinen
  53-Bereiche-Export.
* **Die einzige anwendungsseitige Absicherung ist `0104`** — der
  Geschäftsexport in der Fassung **vor** `0129`–`0131`, also 25 Bereiche. Er
  enthält kein Schema, keine Funktionen, keine Policies, keine
  Sequenzstände, keine Kontodaten.

### Zu prüfen, bevor irgendetwas läuft

1. **Tarif im Dashboard nachsehen** — *Database → Backups*. Die Angabe oben
   ist vom 2026-10-01; ob sie noch gilt, steht nur dort. Ich kann das nicht
   prüfen: Production darf nicht verbunden werden, und ein Tarif ist über SQL
   nicht ablesbar.
2. **Wenn weiterhin Free:** die wirksamste Einzelmaßnahme ist ein
   **Upgrade auf Pro vor dem Rollout** (tägliche Backups; PITR als
   kostenpflichtiger Zusatz). Das ist eine Geld- und Vertragsentscheidung —
   deine, nicht meine. Die Größenordnung und die genaue Rückhaltezeit stehen
   im Dashboard, nicht in diesem Dokument; ich behaupte sie nicht.
3. **Wenn Free bleibt:** den Rollout trotzdem fahren ist vertretbar, weil
   diese sechs Migrationen **keine Daten anfassen** (Abschnitt 3) — aber dann
   gilt ausdrücklich: *kein* Rücksprung, nur Vorwärtskorrektur. Das muss
   schriftlich entschieden sein, nicht stillschweigend.
4. **Unmittelbar vor dem Rollout** einen frischen Geschäftsexport auf
   Production herunterladen (`/business/datensicherung`, 25 Bereiche),
   SHA-256 notieren, Datei außerhalb des Repositories ablegen. Er ersetzt kein
   Infrastruktur-Backup, aber er ist der Nachweis, welche Geschäftsdaten vor
   dem Eingriff bestanden.
5. **Bestandszahlen des Preflights festhalten** — Katalogzeilen, Einkäufe,
   Einkaufspositionen, Lagerbewegungen, Lagerzeilen, Bestellungen, Rechnungen,
   Verkäufe. Der Postflight muss **dieselben** Zahlen zeigen. Beim Release
   `0117`–`0123` war genau das der Nachweis.

## 3. Warum das Risiko begrenzt ist — gemessen, nicht gehofft

Alle sechs Migrationen wurden mit dem PostgreSQL-Parser über ihren Syntaxbaum
ausgezählt. Ergebnis:

**Kein `insert`, kein `update`, kein `delete`, kein `truncate`. In keiner der
sechs Dateien. Null Datenanweisungen.**

| Migration | was sie tut |
|---|---|
| `0126` | ersetzt `seller_save_purchase_edit` und `purchase_items_touch_purchase`; `drop trigger if exists` + neu angelegt; Rechte |
| `0127` | **`drop function` der 5-Parameter-Fassung** von `seller_save_purchase_edit`, ersetzt sie durch die 6-Parameter-Fassung; Rechte |
| `0128` | `add column if not exists supersedes_number text`, `supersedes_issued_at timestamptz` auf `purchase_receipts` (nullable, **ohne Default** — kein Rewrite der Tabelle); zwei Funktionen; Rechte |
| `0129` | ersetzt **nur** `seller_business_backup()` |
| `0130` | ersetzt **nur** `seller_business_backup()` |
| `0131` | ersetzt **nur** `seller_business_backup()` |

Der einzige Schritt mit einem Außenrisiko ist `0127`: zwischen `drop` und
`create` existiert die Funktion nicht. In einer `begin`/`commit`-Klammer ist
dieses Fenster nicht sichtbar — andere Sitzungen sehen entweder die alte oder
die neue Fassung. Dass ein **bestehender Client** danach weiter speichern
kann, prüft `0127_postflight.sql` in den `12x`-Zeilen: dieselben fünf
Argumentnamen und -typen, der sechste mit Standardwert, genau eine Fassung.
PostgREST löst über Namen auf, deshalb trägt der ausgelieferte Stand
`c24926e` das mit.

## 4. Harte Vorbedingungen

Alle müssen erfüllt sein. Eine nicht erfüllte Zeile heißt: nicht anfangen.

| # | Vorbedingung | Nachweis |
|---|---|---|
| 1 | Tarif- und Backuplage geklärt und entschieden (Abschnitt 2) | schriftlich |
| 2 | Frischer Geschäftsexport von Production, SHA-256 notiert | Datei + Prüfsumme |
| 3 | `npm run verify:sums` grün, Dateien aus dem Repository, nicht aus einem Chatfenster | 170/170 |
| 4 | `supabase/migrations/APPLIED.md` auf dem Stand von Staging | Test grün |
| 5 | Alle sechs Preflights auf Production gelaufen, Zustand bekannt | je `9999 = 0` oder begründete Abweichung |
| 6 | `0124`/`0125`-Frage entschieden (Abschnitt 1) | Preflight-Befund |
| 7 | Zeitfenster ohne Kundschaft, `commerce_mode` bewusst **unverändert** | — |
| 8 | Freigabe ausdrücklich erteilt, Migration für Migration | — |
| 9 | Niemand arbeitet gleichzeitig im `/business`-Bereich | — |

## 5. Reihenfolge

Jede Migration **einzeln**, in dieser Reihenfolge, jede in `begin`/`commit`
geklammert — dasselbe Verfahren wie beim Release `0117`–`0123`.

| Schritt | Datei | davor | danach | Abbruch, wenn |
|---|---|---|---|---|
| 0 | — | Export + Bestandszahlen notieren | — | Export schlägt fehl |
| 1 | `0124` *(nur falls Preflight sie als fehlend meldet)* | `0124_preflight` | `0124_postflight` | `9999 > 0` |
| 2 | `0125` *(dito)* | `0125_preflight` | `0125_postflight` | `9999 > 0` |
| 3 | `0126` | `0126_preflight` | `0126_postflight` | `9999 > 0` |
| 4 | `0127` | `0127_preflight` | `0127_postflight`, **dazu die `12x`-Signaturzeilen einzeln lesen** | `9999 > 0` oder eine `12x`-Zeile nicht `ok` |
| 5 | `0128` | `0128_preflight` | `0128_postflight` | `9999 > 0` |
| 6 | `0129` | `0129_preflight` | `0129_postflight` | `9999 > 0` |
| 7 | `0130` | `0130_preflight` | `0130_postflight` | `9999 > 0` |
| 8 | `0131` | `0131_preflight` | `0131_postflight` **und** `0131_function_body_check.sql` | `9999 > 0` |
| 9 | — | — | `0129_export_baseline.sql`, Export herunterladen, `npm run verify:backup` | Abweichung ≠ 0 |

**`0130` wird in der heutigen Repository-Fassung ausgeführt** — die vier Zeilen
Formprüfung im Nachbedingungsblock sind eine Verbesserung, kein Risiko, und auf
Production ist `0130` noch nicht gelaufen. Das ist der Unterschied zu Staging:
dort darf sie nicht erneut laufen, hier ist sie erstmalig. `APPLIED.md`
bekommt nach dem Rollout eine eigene Production-Zeile.

## 6. Abbruchkriterien

Sofort anhalten, nichts weiter ausführen, Befund festhalten:

1. Ein Postflight zeigt `9999 > 0`.
2. Eine **Bestandszahl** weicht zwischen Pre- und Postflight ab. Diese
   Migrationen fassen keine Daten an — eine abweichende Zahl heißt, dass etwas
   anderes passiert ist.
3. Eine `12x`-Signaturzeile von `0127_postflight` ist nicht `ok`: der
   ausgelieferte Client könnte nicht mehr speichern.
4. `0131_function_body_check.sql` meldet einen anderen Rumpf als erwartet.
5. Eine Migration bricht mit `P0001` ab — dann hat ihre eigene Vor- oder
   Nachbedingung gegriffen und die Transaktion ist zurückgerollt. **Nicht
   erneut ausführen**, erst die Ursache klären (so lief es bei `0127` und
   `0131` auf Staging).
6. Ein Eigenbeleg entsteht, ohne dass jemand ihn ausgestellt hat.
7. Irgendetwas in der Ausgabe ist unerwartet und nicht in zwei Sätzen erklärbar.

## 7. Rollback und Wiederherstellung

**Ohne PITR gibt es kein Zurück auf Knopfdruck.** Was es stattdessen gibt:

**Stufe 1 — die Transaktion.** Jede Migration in `begin`/`commit`. Ein
Fehlschlag rollt sich selbst vollständig zurück; das war bei `0127` und `0131`
auf Staging real der Fall und beide Male war der Zustand hinterher sauber. Das
ist der weitaus wahrscheinlichste Fehlerfall und er ist vollständig abgedeckt.

**Stufe 2 — Vorwärtskorrektur je Migration.** Weil alles additiv ist, ist jede
Änderung einzeln umkehrbar, ohne Daten zu verlieren:

| Migration | Rücknahme |
|---|---|
| `0129`/`0130`/`0131` | den Rumpf der **Vorgängerfassung** erneut anwenden (`0104` bzw. `0129` bzw. `0130`). Nur eine Funktion, keine Daten. Risikofrei. |
| `0128` | die zwei Funktionen auf die Vorgängerfassung zurücksetzen. Die **Spalten** `supersedes_number`/`supersedes_issued_at` bleiben stehen — nullable, ohne Default, von nichts anderem gelesen. Sie zu löschen ist nur zulässig, solange **kein** Korrekturbeleg existiert (`select count(*) from purchase_receipts where revision > 1` muss 0 sein). Danach wäre es Datenverlust an einem unveränderlichen Beleg und ist **ausgeschlossen**. |
| `0127` | die 5-Parameter-Fassung aus `0126` wiederherstellen und die 6-Parameter-Fassung löschen. |
| `0126` | die Fassung aus `0121` wiederherstellen; Trigger wie vorher. |
| `0124`/`0125` | `0124_rollback_check.sql` existiert und sagt, ob die Vorher-Baselines noch gelten. |

Für jede dieser Rücknahmen gilt: **sie ist noch nicht als Datei vorbereitet.**
Wenn du sie vorbereitet haben willst, ist das ein eigener, kleiner Arbeitsgang
— sechs Dateien, die jeweils den Rumpf der Vorgängerfassung tragen, mit
eigenem Pre- und Postflight. Vor dem Rollout wäre das die saubere Reihenfolge.

**Stufe 3 — Totalverlust.** Hier ist die Lage ehrlich schlecht und soll so
benannt werden: ohne PITR und ohne Platform-Backup auf Production ließe sich
der Betrieb **nicht** vollständig wiederherstellen. Es fehlten Schema,
Funktionen, Policies, Sequenzstände, Konten und Storage-Dateien. Was bliebe,
ist der 25-Bereiche-Geschäftsexport als Datengrundlage für einen Neuaufbau von
Hand — und der ist, wie `0131_restore_plan.md` zeigt, selbst noch nicht als
Wiederherstellung erprobt. **Diese Lücke schließt kein Rollout-Plan, sondern
nur die Zwei-Stufen-Architektur aus `backup_architecture_two_tier.md`.**

## 8. Nach dem Rollout

1. `0129_export_baseline.sql` auf Production, Zahlen notieren.
2. Geschäftsexport herunterladen → `npm run verify:backup` gegen die Baseline.
   Erwartet: 28 Bereiche, 0 Abweichungen.
3. `APPLIED.md` um die Production-Zeilen ergänzen, Prüfsummen erneuern.
4. `PROJECT_STATUS.md` fortschreiben.
5. **Erst dann** die Frage nach Commit, Push und Vercel-Deployment des
   Anwendungscodes stellen — das ist eine eigene Freigabe. Bis dahin läuft in
   Production weiter `c24926e`, und das ist signaturkompatibel.
6. **Keine produktive Belegausstellung** zum Ausprobieren. Ein Eigenbeleg auf
   Production ist ein Dokument, kein Test.

## 9. Offene Punkte, die ein Rollout nicht erledigt

Diese stehen seit `0117`–`0123` offen und bleiben offen — **rechtliche Fragen,
nicht geklärt, hier nur benannt**:

1. Datenschutzerklärung für die Absenderdaten privater Verkäufer.
2. Aufbewahrungsfristen für Belege, Rechnungen und Einkaufsnachweise.
3. Steuerliche Anerkennung der Belegform (Eigenbeleg als PDF).
4. Nachweisbare Wiederherstellbarkeit der Sicherung (`restore_supported`
   bleibt `false`).
5. Die drei Belegtabellen fehlen im Plattformexport
   (`0132_platform_export_receipts_proposal.md`).
6. Sichtprüfung von Belegformat 2 bei 50 und 120 Figuren.
