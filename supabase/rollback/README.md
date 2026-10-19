# Rücknahmen zu `0126`–`0131`

**Diese Dateien sind keine Migrationen.** Sie stehen absichtlich nicht in
`supabase/migrations/`, gehören nicht in `APPLIED.md` und nicht in die
Reihenfolge eines Rollouts. Sie werden **nur** nach einer ausdrücklichen
Entscheidung ausgeführt, einzeln, in `begin`/`commit` geklammert — genau wie
eine Migration.

Keine davon ist ausgeführt. Sie sind vorbereitet, damit im Ernstfall nicht
improvisiert werden muss.

## Reihenfolge: umgekehrt zur Anwendung

```
R0131 → R0130 → R0129 → R0128 → R0127 → R0126
```

Jede Datei prüft das selbst. `R0126` bricht ab, solange die
Sechs-Parameter-Fassung aus `0127` noch steht, und `R0127` bricht ab, wenn
sie es nicht tut. Man kann an jeder Stelle aufhören — die Rücknahmen sind
nicht aufeinander angewiesen, nur geordnet.

## Was sie tun

| Datei | nimmt zurück | Art |
|---|---|---|
| `R0131_back_to_0130.sql` | die 13 Rechtsangaben im Bereich `seller` | Funktionsrumpf aus `0130` |
| `R0130_back_to_0129.sql` | die 18 Felder aus `0130` | Funktionsrumpf aus `0129` |
| `R0129_back_to_0104.sql` | die drei Belegbereiche im Export | Funktionsrumpf aus `0104` |
| `R0128_remove_corrections.sql` | Korrekturbelege | zwei Funktionen **und zwei Spalten** |
| `R0127_back_to_0126.sql` | den direkten Figurenwechsel | Fünf-Parameter-Fassung aus `0126` |
| `R0126_remove_purchase_edit.sql` | das Sammelspeichern des Dialogs | drei **neue** Objekte löschen |

**Keine der sechs Dateien enthält eine Datenanweisung** — kein `insert`,
`update`, `delete` oder `truncate`. Ausgezählt, nicht behauptet.

Die vier Rumpf-Rücknahmen (`R0129`–`R0131`, `R0136`) tragen den Rumpf der
Vorgängerfassung **unverändert aus der Migration übernommen**; jede prüft
vorher `md5(prosrc)` der lebenden Funktion und nachher den Rumpf samt
Bereichs- und Feldzahl:

| Datei | Zustand davor (md5) | Zustand danach | Bereiche/Felder danach |
|---|---|---|---|
| `R0136` | `f6d08440707ba72a8040a8d1e666c092` | `24c3810288bb20929fe995554a267adf` | 28 / 352 |
| `R0131` | `24c3810288bb20929fe995554a267adf` | `a27b61db988df7627a4992b1770ac626` | 28 / 339 |
| `R0130` | `a27b61db988df7627a4992b1770ac626` | `5a0de6bec562779d5f945c096e1f77d6` | 28 / 321 |
| `R0129` | `5a0de6bec562779d5f945c096e1f77d6` | `a3c922657e1c6410858b7c4b2bb7aae5` | 25 / 277 |

`R0136` prüft zusätzlich den **Funktionskommentar** (`md5` =
`6b980ac961d1d6ac704587ecc6e9524f`, 674 Zeichen): `0136` hat ihn mitgeändert,
und ein Rumpf aus `0131` mit dem Kommentar aus `0136` wäre ein halber Stand.

## Zwei Rücknahmen, die nur in einer Reihenfolge gehen

**`R0136` vor `R0135`.** Seit `0136` liest `seller_business_backup()` die
Spalte `skylanders.item_type`. PostgreSQL vermerkt für einen `language
sql`-Rumpf **keine Abhängigkeit** auf die gelesenen Spalten: `drop column`
gelingt, und die Sicherung scheitert erst beim **Aufruf** mit `42703` — eine
Datensicherung, die erst im Ernstfall nicht mehr läuft. In PostgreSQL 18.6
nachgestellt und bestätigt.

`R0135` bricht deshalb ab, solange der lebende Rumpf `item_type` nennt, und
sagt, welche Datei zuerst gehört. `npm run verify:check-sql` fährt beide
Reihenfolgen in einer Wegwerf-Instanz: die falsche muss scheitern (Probelauf
P7), die richtige durchlaufen (P8).

## Die eine Rücknahme, die meistens unzulässig ist

**`R0128` bricht ab, sobald ein Korrekturbeleg existiert.** Der Grund steht
im Kopf der Datei und ist nicht verhandelbar:

`0128` hat `purchase_receipts` um `supersedes_number` und
`supersedes_issued_at` erweitert. Sobald ein Korrekturbeleg ausgestellt ist,
tragen diese Spalten **die Nummer und das Datum des ersetzten Dokuments** —
den Nachweis, welcher Beleg korrigiert wurde. Ein Eigenbeleg ist
unveränderlich; `purchase_receipts_immutable_trg` verbietet `update` und
`delete` auf jeder Zeile. **`drop column` umgeht diesen Trigger**, weil es
DDL und kein DML ist, und wäre damit ein stiller, endgültiger Datenverlust an
einem unveränderlichen Dokument.

Die Datei fragt deshalb drei Dinge unabhängig voneinander ab und bricht bei
jedem Treffer ab:

```sql
select count(*) from public.purchase_receipts where revision > 1;
select count(*) from public.purchase_receipts where supersedes_id is not null;
select count(*) from public.purchase_receipts
 where supersedes_number is not null or supersedes_issued_at is not null;
```

**Auf Staging ist `R0128` damit schon heute unzulässig** — dort steht
`SI-E-2026-000002` als Revision 2 mit Verweis auf Revision 1. Das ist kein
Mangel der Datei, sondern ihr Zweck.

**Zulässig bleibt die Teilrücknahme**: nur die beiden Funktionen entfernen,
die Spalten stehen lassen. Sie sind nullable, ohne Default, und werden dann
von nichts mehr gelesen. Die zwei Anweisungen stehen im Kopf von
`R0128_remove_corrections.sql`; sie sind bewusst **nicht** automatisiert, weil
die Entscheidung „Spalten bleiben" eine Entscheidung ist.

## Was eine Rücknahme kostet

* `R0129`–`R0131`: nichts außer Exportumfang. Die Sicherungsfunktion ist
  `stable` und liest nur. Eine ältere Sicherung bleibt gültig, eine neue
  enthält weniger — bei `R0129` **auch die Eigenbelege nicht mehr**.
* `R0128` (Teilrücknahme): Korrektur und Historie verschwinden aus der
  Oberfläche. Ausstellen, Abrufen und die Unveränderlichkeit aus
  `0122`/`0123` bleiben.
* `R0127`: der Figurenwechsel im Dialog geht nicht mehr. Ein ausgelieferter
  Client, der `p_swap` mitschickt, bekommt PostgREST-404 — diese Rücknahme
  gehört deshalb mit dem Zurückrollen des Anwendungsstands zusammen.
* `R0126`: der Dialog kann nicht mehr in einer Transaktion speichern; der Weg
  davor (`seller_update_purchase` aus `0121` plus die Positionsfunktionen aus
  `0053`) bleibt unberührt. `purchases.updated_at` wird nicht mehr automatisch
  nachgezogen — Komfortverlust, kein Datenverlust.

## Vor der Ausführung

1. `npm run verify:sums` — die Dateien kommen aus dem Repository, nicht aus
   einem Chatfenster.
2. Den Zustand feststellen: `supabase/checks/0131_function_body_check.sql`
   sagt, welche Fassung der Sicherungsfunktion wirklich läuft.
3. Bei `R0128`: die drei Zählungen oben **selbst** ausführen und ansehen.
4. In `begin`/`commit` klammern. Jede Datei prüft hinterher ihr Ergebnis und
   bricht ab, wenn es nicht stimmt — in der Klammer bedeutet das: nichts
   passiert.

## Noch offen

* Die Rücknahmen sind **nicht** in `supabase/SHA256SUMS.txt`. `coveredFiles()`
  in `tools/checksums.mts` deckt `supabase/migrations` und `supabase/checks`
  ab; dieser Ordner kommt dazu, sobald die Dateien committet werden — eine
  Zeile, plus `npm run sums:write`.
* Ebenso fehlen sie im Geltungsbereich von
  `src/lib/admin/check-sql-references.test.ts` (Relations-, Funktions- und
  CTE-Wächter). Geprüft wurden sie bisher mit `pglast` (`parse_sql` und
  `parse_plpgsql_json`) und dem CTE-Baumlauf: alle sechs fehlerfrei.
* Keine der sechs ist **ausgeführt** — auch nicht auf Staging. Eine Rücknahme,
  die niemand laufen ließ, ist eine Absicht und kein Nachweis.

## `R0134` — `source_row` verschwindet wieder aus der Positionsliste

`R0134_purchase_item_source_row_visible.sql` stellt `seller_purchase(bigint)`
auf den Stand aus `0119` zurück. Der Körper darunter ist Zeichen für Zeichen
der aus `0119`; geprüft wird das in
`src/lib/orderbook/purchase-historical-edit.test.ts`.

**Folge:** `canRemoveItem()` sieht `source_row` nicht mehr und bietet
„Position entfernen" wieder für die 109 wiedereröffneten Importzeilen an
(`0067`). Die Datenbank lehnt sie weiter ab — die Aktion scheitert also mit
einer Meldung statt zu verschwinden. Kein Datenverlust, nur die alte
Unstimmigkeit. Deshalb wird diese Datei nur zusammen mit einer Rücknahme des
Oberflächenstands angewendet.

## `R0132` — und was eine Rücknahme hier bedeutet

`R0132_back_to_0064_and_0121.sql` stellt **beide** Funktionen aus `0132`
zurück: `seller_remove_purchase_item` auf die Fassung aus `0064`,
`seller_update_purchase` auf die aus `0121`. Beide Rümpfe sind unverändert aus
den Quellen übernommen — nachgeprüft, nicht abgeschrieben.

**Zwei Folgen, die man wollen muss, bevor man sie ausführt:**

1. Eine **selbst nachgetragene** Zeile an einem historischen Einkauf ist
   danach nicht mehr entfernbar (`0064` lehnt wieder über den Eltern-Einkauf
   ab).
2. Die **bezahlte Summe** eines importierten Einkaufs ist danach wieder
   änderbar — der Riegel aus `0132` ist weg.

**Was sie nicht tut:** Daten anfassen. Zeilen, die unter `0132` hinzugefügt
oder entfernt wurden, bleiben wie sie sind. Eine Rücknahme der Funktion ist
keine Rücknahme der Arbeit.
