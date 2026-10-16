# Wiederherstellungstest `0129` — eine Belegkette mit drei Revisionen

## Warum das hier eine Anleitung ist und kein Test

**Eine sichere Wiederherstellung lässt sich in diesem Projekt nicht
automatisiert prüfen**, und zwar aus drei Gründen, die alle nachprüfbar sind:

1. **Es gibt keine Importfunktion.** `seller_business_backup()` ist ein
   Export; `restore_supported` steht im Dokument auf `false`. Eine
   Wiederherstellung heißt heute: aus der JSON-Datei `INSERT`-Anweisungen
   bilden und sie als Eigentümer einspielen.
2. **Die Belegtabellen sind für die Anwendung gesperrt.** `revoke all … from
   public, anon, authenticated`, RLS an, keine Policy. Ein Einspielen läuft
   deshalb im SQL-Editor als `postgres`, nicht über die Anwendung.
3. **Die Testumgebung ist eine Datenbank, nicht ein Prozess.** Ein
   Wiederherstellungstest braucht eine **leere** Datenbank mit allen
   Migrationen — also ein eigenes Supabase-Projekt oder einen Branch, nicht
   Staging und erst recht nicht Production.

Was die automatisierte Suite deshalb prüft, ist der **Export**: dass jedes
Feld der drei Tabellen darin vorkommt, dass die Kette mitkommt, dass keine
Kontoidentität mitkommt und dass die Funktion eine einzige Anweisung bleibt
(`receipt-correction.test.ts`, `backup-sql.test.ts`). Was sie nicht prüft, ist
das Einspielen. Dafür dieser Plan.

## Teil A — die Kette erzeugen (Staging)

1. Neuer Testeinkauf, Kaufdatum, zwei Figuren, Kosten. Absender **fiktiv**.
2. Eigenbeleg ausstellen → **Revision 1**. PDF herunterladen, SHA-256 notieren.
3. Eine Figur austauschen, speichern, Belegrückfrage bestätigen.
4. Korrekturbeleg ausstellen → **Revision 2**. PDF herunterladen, SHA notieren.
5. Eine Figur hinzufügen, speichern, bestätigen.
6. Korrekturbeleg ausstellen → **Revision 3**. PDF herunterladen, SHA notieren.
7. Revision 3 **vollständig** herunterladen, bis der grüne Haken erscheint
   (das legt eine Zeile in `purchase_receipt_downloads` an).

**Festhalten:** die drei Belegnummern, die drei SHA-256 der PDFs, der
Zählerstand (`0129_preflight.sql`, Zeile 911) und die beiden Prüfsummen über
Fingerabdrücke und Positionslisten (912, 913).

## Teil B — exportieren und die Datei prüfen

8. `/business/datensicherung` → Sicherung herunterladen.
9. **Die Datei gegen die Baseline halten** — ein Befehl statt zehn `jq`-Zeilen:

```bash
npm run verify:backup -- --file ~/Downloads/skyisles-business-backup-….json
```

Das Werkzeug liest nur diese Datei: keine Datenbank, kein Netz, kein Schlüssel.
Es vergleicht alle 28 Bereichszähler, die Summe, die vollständige Belegkette
(Revision, Verweis, Positionszahl, Abrufe, SKY-ID-Folge) und zwei der drei
Prüfsummen aus `0129_export_baseline.sql`. **Es gibt keine personenbezogenen
Daten aus** — nur Zahlen, Belegnummern, SKY-IDs und Prüfsummen; ein Test füttert
es mit erfundenen Namen und hält fest, dass keiner im Bericht erscheint. Liegt
die Datei im Projektordner, bricht es ab, statt sie zu lesen.

Die Positionslisten-Prüfsumme `md5(id:lines::text)` lässt es bewusst
**unverglichen**: `jsonb::text` und `JSON.stringify` erzeugen aus denselben
Daten andere Bytes. Stattdessen prüft es die Struktur jeder Liste und berichtet
eine kanonische Summe über `position:sky_id:condition`.

10. Wer es von Hand nachsehen will — mit einem Texteditor und `jq`:

```bash
jq '.data | keys | length' backup.json                 # 28
jq '.counts.purchase_receipts' backup.json             # 3
jq '.data.purchase_receipts | map({receipt_number, revision, supersedes_id, supersedes_number})' backup.json
jq '.data.purchase_receipt_counters' backup.json       # Jahr + next_number
jq '.data.purchase_receipt_downloads | length' backup.json   # 1
jq '.data.purchase_receipts[0] | keys | length' backup.json  # 38
jq '.data.purchase_receipts[] | .lines | length' backup.json # Positionszahlen
jq '.restore_supported' backup.json                    # false
jq '[.data.purchase_receipts[] | select(has("issued_by"))] | length' backup.json  # 0
```

**Und die Felder aus `0130`/`0131` prüfen** — sie sind der Grund, aus dem ein
Restore überhaupt vollständig werden kann:

```bash
jq '.data.purchases[0] | {items_cost, shipping_cost, buyer_protection_cost,
                          payment_method, platform, seller_name}' backup.json
jq '.data.purchases[0] | has("sender_name")' backup.json        # false — Schritt c
jq '.data.seller[0] | {is_active, register_court, register_number, w_id,
                       dispatch_statement, return_postage_borne_by}' backup.json
jq '.data.sales[0] | has("sale_day")' backup.json               # true
jq '.data.order_reservations[0] | has("sale_item_id")' backup.json   # true
jq '.data.figures[0] | {category_id, is_active, source}' backup.json
```

`has("sender_name") == false` ist dabei **die** Prüfung von Schritt c: die
Absenderdaten einer Privatperson stehen bewusst nicht in der Datei, und beide
Migrationen prüfen das selbst nach.

**Erwartet:** drei Belege mit Revision 1, 2, 3; `supersedes_id` zeigt bei
Revision 2 auf den Beleg mit Revision 1 und bei Revision 3 auf den mit
Revision 2; `supersedes_number` und `supersedes_issued_at` sind gefüllt;
`lines` trägt je Fassung die Positionsliste **ihres** Ausstellungstags —
Revision 1 zeigt noch die ursprüngliche Figur.

## Teil C — einspielen (isolierte Testdatenbank)

11. Neues, **leeres** Supabase-Projekt (oder Branch), alle Migrationen `0001`
    bis `0129` anwenden. Nichts anderes.
12. Einspielen **in dieser Reihenfolge** — sie folgt den Fremdschlüsseln:

| # | Bereich | Warum diese Stelle |
|---|---|---|
| 1 | `sellers` | der Beleg nennt die Geschäftsdaten; ohne sie fehlt der Kontext |
| 2 | `skylanders` (Stammdatenschnappschuss) | `purchase_items.sky_id` zeigt darauf |
| 3 | `purchases` | `receipts_purchase_fk` |
| 4 | `purchase_items` | gehört zum Einkauf |
| 5 | `purchase_receipt_counters` | hängt an nichts |
| 6 | `purchase_receipts`, **aufsteigend nach `id`** | `receipts_supersedes_fk` zeigt auf einen Beleg desselben Einkaufs mit **kleinerer** `id`, weil eine Korrektur immer nach ihrem Vorgänger ausgestellt wurde |
| 7 | `purchase_receipt_downloads` | `receipt_downloads_receipt_fk` |

`issued_by` und `delivered_by` bleiben **NULL** — sie sind nicht im Export
(Kontoidentität), und beide Fremdschlüssel erlauben NULL.

**`purchase_receipts.id` ist `generated always as identity`.** Ein Einspielen
mit den ursprünglichen Ids braucht deshalb `OVERRIDING SYSTEM VALUE`, und
danach muss die Identity-Sequenz nachgezogen werden:

```sql
insert into public.purchase_receipts (id, purchase_id, …)
  overriding system value values (…);

select setval(pg_get_serial_sequence('public.purchase_receipts', 'id'),
              (select max(id) from public.purchase_receipts));
```

Ohne das `setval` vergibt der nächste Beleg eine Id, die es schon gibt.
**Dasselbe gilt für `purchases`, `purchase_items` und
`purchase_receipt_downloads`.** Diese vier Sequenzen sind der Teil des
Wiederherstellens, den die Datei nicht beschreibt — er steht hier.

## Teil D — die Prüfung, die den Test zum Test macht

13. In der Testdatenbank `0129_postflight.sql` laufen lassen → `9999 = 0`.
14. **Die PDFs erneut abrufen und ihre SHA-256 vergleichen** —
    `/business/orderbuch/<id>/beleg/<receiptId>` für **jede** Fassung, also den
    Ursprungsbeleg UND jede Korrektur:

```bash
# vor dem Einspielen, in Teil A notiert:
shasum -a 256 SI-E-2026-00000{1,2,3}.pdf

# nach dem Einspielen, erneut abgerufen:
shasum -a 256 restore/SI-E-2026-00000{1,2,3}.pdf
```

**Erwartet: byteidentisch, jede einzelne.** Der Ursprungsbeleg muss seine
ursprüngliche Figurenliste zeigen, die Korrektur ihre eigene samt Titel
„Eigenbeleg – Korrektur" und dem Verweis auf den Vorgänger. Weicht die
Korrektur ab und der Ursprung nicht, fehlt `supersedes_number` oder
`supersedes_issued_at` im Export; weichen beide ab, ist es der Zeichner oder
ein Betrag, der durch einen Gleitkommatyp gelaufen ist.

Das ist die eigentliche Zusicherung —
der Snapshot hat die Wiederherstellung überlebt, und ein Beleg sieht nach dem
Einspielen genauso aus wie vorher. Weicht einer ab, fehlt ein Feld im Export
oder ein Wert wurde beim Einspielen umgeformt (klassisch: ein Betrag durch
einen Gleitkommatyp — deshalb stehen alle Beträge als String in der Datei).

15. Die Kette prüfen:

```sql
select id, receipt_number, revision, supersedes_id, supersedes_number
  from public.purchase_receipts order by id;
```

**Erwartet:** drei Zeilen, Revision 1/2/3, die Verweise geschlossen.

16. Einen weiteren Korrekturbeleg ausstellen (nach einer Änderung).

**Erwartet:** er bekommt die **nächste** Nummer nach dem eingespielten
Zählerstand — nicht `000001`. Das beweist, dass
`purchase_receipt_counters` mitgekommen ist.

17. `0128_postflight.sql` laufen lassen → `9999 = 0`.

## Was aus dieser Datei NICHT wiederherstellbar ist

Nachgezählt, nicht geschätzt — der Export ist **kein** vollständiger
Wiederaufbau des Betriebs:

- **Konten und Berechtigungen:** `profiles`, `seller_operators`, `shop_admins`,
  `platform_admins`. Nach einem Einspielen gibt es die Daten, aber niemanden,
  der sie bedienen darf. `issued_by` und `delivered_by` bleiben NULL.
- **Kundenkommunikation und Zustellung:** `order_messages`, `order_mail`,
  `order_addresses`, `withdrawal_requests` — ausdrücklich ausgeschlossen
  (`EXCLUDED_TABLES` in `src/lib/backup/manifest.ts`, je mit Grund).
- **Zahlungstechnik:** `payment_attempts`, `payment_events`.
- **Absender, Inserat und Kaufvereinbarung des Einkaufs** (9 Spalten,
  `0121`). **Nicht freigegeben** — Schritt c aus
  `0130_backup_extension_proposal.md`: Name und Anschrift einer Privatperson
  gehören erst in eine Exportdatei, wenn die Datenschutzerklärung Ankäufe
  erwähnt und eine Aufbewahrungsfrist geschrieben ist. Für Einkäufe **mit**
  Eigenbeleg trägt der Snapshot sie; für die ohne gehen sie bei einer
  Wiederherstellung verloren. `0129_export_baseline.sql`, Prüfung 406, zählt
  genau diese Einkäufe.
- **Alles andere ist seit `0130`/`0131` drin.** Die Kostenaufteilung des
  Einkaufs, der Geschäftstag eines Verkaufs, die Brücke zur Verkaufsposition,
  Zeitpunkt und Ergebnis einer Erstattung, die kuratierte Katalogordnung und
  die Rechtsangaben des Betriebs samt `is_active`. `manifest-gap.test.ts` hält
  fest, dass keine Spalte unentschieden ist.
- **Der Plattformexport** führt die drei Belegtabellen ebenfalls noch nicht;
  er ist ein Admin-Werkzeug mit eigener Archivdatei. Verzeichnet als offener
  Punkt in `platform-manifest.ts` und in `platform-manifest.test.ts` als
  geprüfte Ausnahme. Konkreter Änderungsvorschlag:
  `0132_platform_export_receipts_proposal.md`.

## Ergebnisprotokoll

Nach dem Durchlauf hierhin schreiben: Datum, Projektreferenz der
Testdatenbank, die drei Belegnummern, die drei SHA-256 vor und nach dem
Einspielen, der Zählerstand vorher und nachher, und das Ergebnis von Schritt
14 und 16. **Solange dieses Protokoll leer ist, ist die Wiederherstellbarkeit
nicht nachgewiesen** — sie ist dann vorbereitet und beschrieben, nicht geprüft.
