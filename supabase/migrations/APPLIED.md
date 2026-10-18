# Angewendete Migrationen — die Fassung, die wirklich gelaufen ist

Diese Datei ist das Gedächtnis des Projekts für eine Frage, die Git allein
nicht beantwortet: **welcher Dateiinhalt wurde auf Staging tatsächlich
ausgeführt?** Eine Migration, die nach ihrer Ausführung geändert wird, sieht
hinterher aus wie die, die gelaufen ist — und ist es nicht (`0130`).

Erfasst sind die Migrationen ab `0122`, also ab dem Eigenbeleg-Teil. Ältere
sind seit Langem angewendet und in Git versioniert; für sie ist der Commit die
Historie.

`src/lib/admin/migration-integrity.test.ts` liest **diese Tabelle** und prüft
jede Zeile bei jedem Testlauf. Die Spalte `Datei heute` ist der Vertrag:
`gleich` heißt, die Datei im Repository ist bitgenau die ausgeführte Fassung.

## Staging

| Migration | SHA-256 der ausgeführten Fassung | Datei heute | Nachweis |
|---|---|---|---|
| `0122_purchase_receipts.sql` | `b79e9677ec8b7669fef570fdb62e2cb42eb086044b6ddc08a5d2ec2e520e3599` | gleich | vor dieser Arbeitsphase angewendet; Datei committet und unverändert |
| `0123_purchase_receipt_format_version.sql` | `b87e8795ffe63d4477a24792fbcbc91a4720789937c78366346d935bc6be0f58` | gleich | vor dieser Arbeitsphase angewendet; Datei committet und unverändert |
| `0124_orderbook_receipt_status.sql` | `f8efa038a7aa4116b0602dc16460d3f63df65c0a6770182dcc5d591cfea0b53e` | gleich | vor dieser Arbeitsphase angewendet; Datei committet und unverändert |
| `0125_revoke_internal_fingerprint_execute.sql` | `fba03467c10e77545c747c89105c05668be0e1d3d0c5add12545ddc9b2fc7fd2` | gleich | vor dieser Arbeitsphase angewendet; Datei committet und unverändert |
| `0126_purchase_item_edit.sql` | `536239adcc3b97d5d7a1438c7615f1b6060d2c42b33ba9544b31c5c0afd8248d` | gleich | vom Betreiber als angewendet bestätigt; Fassung seit der ersten Berichtung unverändert |
| `0127_purchase_item_swap.sql` | `35e52cecd351b044a3218dc660e35cc1efa1dcf6c003f6fc7fe3aa2dbf6287f9` | gleich | erster Versuch brach in der Nachbedingung ab und rollte zurück; diese korrigierte Fassung lief erfolgreich, bestätigt durch `0127_swap_effect_check.sql` auf Staging |
| `0128_purchase_receipt_corrections.sql` | `8effcdff114a0de510db333ce01df979d5d506fcdee0d57191de8387f69415d2` | gleich | belegt über den erfolgreichen `0129_preflight` und `0129_postflight`, die die Strukturen aus `0128` voraussetzen |
| `0129_business_backup_receipts.sql` | `d4b0f17b24bca90ac0844b7e35b10e64e55da04ceef4e97a0daf89703b2c16f8` | gleich | Betreiber: Postflight `9999 = 0`; `0129_export_baseline.sql` ergab 28 Bereiche und 5 508 Datensätze |
| `0130_business_backup_fields.sql` | `37417c454704fb94dd448813caeb41eaad4a58e188713488c30f5b4967e76abe` | abweichend — siehe `supabase/checks/0130_amendment.md` | Betreiber: erfolgreich; gemessen durch den `0131`-Preflight mit 339 Feldzeilen (Stand nach `0130`) |
| `0131_business_backup_seller_fields.sql` | `644cc0bbd15073426f54af6fa542281c95b8e4d4dc5abb8ce2d63a3b4c35f218` | gleich | Betreiber: Postflight `9999 = 0`; erster Versuch mit einer früheren Fassung brach ab und rollte zurück |

## Production

Am **2026-10-17** wurden `0126`–`0131` auf Production
(`zmiwxswrpkmizvqsgype`) angewendet — einzeln, in `begin`/`commit`, in dieser
Reihenfolge, jede mit Pre- und Postflight. Sämtliche Prüfungen `9999 = 0`,
`0131_function_body_check` = `STAND_0131_ZEICHENGLEICH`.

Am **2026-10-18** kamen `0132` und `0133` hinzu — **unbeabsichtigt**. Sie waren
für Staging freigegeben und wurden im Production-Projekt ausgeführt; der
Betreiber hat das am selben Tag festgestellt und gemeldet. **Auf Staging sind
beide weiterhin nicht angewendet.** Sämtliche Prüfzahlen, die zuvor als
Staging-Ergebnisse geführt wurden, sind Production-Ergebnisse. Hergang,
Bewertung und Folgen: `docs/history/2026-10-18-production-0132-0133.md`.

**Der Zustand beider Datenbanken ist bis auf Weiteres GEMELDET, nicht
GEMESSEN.** Diese Akte hält fest, was der Betreiber ausgeführt und mit
Postflight-Ergebnissen bestätigt hat; aus diesem Repository heraus ist keine
Datenbank angefasst worden. Was ein Lauf noch belegen muss, steht vollständig
in `supabase/checks/open_verifications.md` — Production P1–P5, Staging S1–S6.
Den Zustand selbst liest `supabase/checks/state_audit_readonly.sql` aus dem
Katalog statt aus dieser Datei.

| Migration | SHA-256 der ausgeführten Fassung | Datei heute |
|---|---|---|
| `0126_purchase_item_edit.sql` | `536239adcc3b97d5d7a1438c7615f1b6060d2c42b33ba9544b31c5c0afd8248d` | gleich |
| `0127_purchase_item_swap.sql` | `35e52cecd351b044a3218dc660e35cc1efa1dcf6c003f6fc7fe3aa2dbf6287f9` | gleich |
| `0128_purchase_receipt_corrections.sql` | `8effcdff114a0de510db333ce01df979d5d506fcdee0d57191de8387f69415d2` | gleich |
| `0129_business_backup_receipts.sql` | `d4b0f17b24bca90ac0844b7e35b10e64e55da04ceef4e97a0daf89703b2c16f8` | gleich |
| `0130_business_backup_fields.sql` | `bad193a334b5eb727dac49cccb5ae88340a0693acad2479364c6f867c6269e77` | gleich |
| `0131_business_backup_seller_fields.sql` | `644cc0bbd15073426f54af6fa542281c95b8e4d4dc5abb8ce2d63a3b4c35f218` | gleich |
| `0132_purchase_item_remove_by_line.sql` | `382aa64749cb035e9a6402fe36fc16f9e1ae663228c7806cc34e29331b7ec6b3` | gleich |
| `0133_paid_total_immutable.sql` | `65832d746ce26d3fe5a7c1cb7feaec3a7793917b31d965c7c911215b347e0ef4` | gleich |

**`0130` lief auf Production in der heutigen Repository-Fassung** — dort war
sie erstmalig. Der Nachtrag aus `supabase/checks/0130_amendment.md` betrifft
ausschliesslich Staging, wo sie in der Fassung `37417c45…` lief.

Nach `0128` wurde `supabase/operations/lock-receipt-issuance.sql` angewendet:
keine API-Rolle darf die Eigenbeleg-Ausstellung oder -Korrektur aufrufen,
`postgres` behält EXECUTE. Bestätigt durch `receipt_lock_check.sql` vor und
nach `0129`–`0131`, je `9999 = 0`. **Der Rechtestand weicht damit bewusst von
dem ab, den `0122`/`0128` erklären** — ein erneuter `0128`-Postflight meldet
das in Prüfung 223 (1 statt 2). Rücknahme nur mit Freigabe B über
`unlock-receipt-issuance.sql`.

Protokoll: `docs/history/2026-10-17-production-0126-0131.md`.

## Nicht angewendet

Diese Migrationen liegen vor und sind **nirgends** ausgeführt — weder auf
Staging noch auf Production. Sie stehen hier, damit die Akte lückenlos bleibt:
jede Migration ab `0122` ist entweder oben mit ihrer Prüfsumme erfasst oder in
dieser Liste.

| Migration | Stand |
|---|---|
| `0134_purchase_item_source_row_visible.sql` | lokal vorbereitet, **noch nicht freigegeben**. Gibt `source_row` in der Positionsliste von `seller_purchase()` mit aus, damit der Dialog dieselben vier Ablehnungsgründe prüft wie die Datenbank. Der Funktionskörper ist der aus `0119` mit genau einem zusätzlichen Schlüssel; Rücknahme `supabase/rollback/R0134_purchase_item_source_row_visible.sql`. SHA-256 der vorliegenden Fassung: `ad6812ac1d977464d3626308161a2a0ab4a7745a63dff335e74558395c79eeb2` |

**`0132` und `0133` stehen seit dem 2026-10-18 auf Production** und damit oben
in der Production-Tabelle. **Auf Staging sind sie nicht angewendet** — die
Staging-Tabelle endet bei `0131`. Das ist die umgekehrte Reihenfolge der
gewollten, und sie wird nicht nachträglich geradegezogen, indem auf Production
etwas zurückgenommen wird; nachgezogen wird Staging. Plan:
`supabase/checks/0132_staging_plan.md`.

## Zwei eingefrorene Kopfzeilen, die nicht mehr stimmen

`0132` und `0133` sind angewendet und werden deshalb **nicht mehr geändert** —
auch nicht ihr Kommentarkopf. Beide behaupten dort etwas, das seit dem
2026-10-18 falsch ist:

| Datei | Zeile im Kopf | tatsächlich |
|---|---|---|
| `0132_purchase_item_remove_by_line.sql` | „NUR LOKAL VORBEREITET. Nicht auf Staging und nicht auf Production ausgefuehrt." | **auf Production angewendet**, auf Staging nicht |
| `0133_paid_total_immutable.sql` | „NICHT FREIGEGEBEN. Vorbereitet, nirgends angewendet." | **auf Production angewendet**, auf Staging nicht |

Eine Korrektur im Dateikopf wäre genau der Fehler, den diese Akte verhindern
soll: die Prüfsumme der ausgeführten Fassung würde nicht mehr passen, und
niemand könnte später beweisen, was gelaufen ist. **Der Stand steht hier, in
der Tabelle oben, und im Protokoll** — nicht in der Datei.

## Der eine abweichende Fall

`0130` wurde **nach** der Ausführung um vier Zeilen in ihrem
Nachbedingungsblock ergänzt. Umfang, Beweis und das Rezept, mit dem die
ausgeführte Fassung aus der heutigen nachgerechnet wird, stehen in
`supabase/checks/0130_amendment.md`. Der Test prüft beides: dass die Datei
heute **nicht** mehr der ausgeführten Fassung entspricht, und dass das Rezept
genau diese Prüfsumme wiederherstellt.

**`0130` wird nicht erneut angewendet.**

## Regeln

1. Eine angewendete Migration wird nicht mehr geändert — auch nicht ihre
   Nachbedingung. Neue Wächter gehören in `supabase/checks/` und in die
   Testsuite; dort wirken sie auch nach der Ausführung.
2. Wird eine Migration angewendet, kommt sie **mit ihrer Prüfsumme** in diese
   Tabelle, bevor die nächste beginnt.
3. Wird eine angewendete Migration doch verändert, bleibt ihre Zeile
   unverändert, die Spalte `Datei heute` wird auf `abweichend` gesetzt, und der
   Umfang wird in einem eigenen Nachtrag belegt — mit einem Test, der den
   Umfang nachrechnet.
4. Für Production gilt diese Tabelle nicht. Sie beschreibt Staging. Eine
   Production-Anwendung braucht eine eigene Freigabe und eine eigene Zeile.

## Nicht erfasst

`0001`–`0121`: angewendet, committet, durch Git versioniert. Ihre Prüfsummen
stehen in `supabase/SHA256SUMS.txt` und fallen damit auf, wenn sie sich
ändern — nur eben ohne die Aussage „genau so ist sie gelaufen".
