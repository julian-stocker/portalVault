# Offene Prüfungen — was nachweislich noch NICHT geprüft ist

**Stand 2026-10-19.** Diese Datei führt die Nachweise, die **fehlen**. Sie ist das
Gegenstück zu `APPLIED.md`: dort steht, was gelaufen ist, hier, was aussteht.
Ein Punkt wird erst gestrichen, wenn ein Lauf ihn belegt — nicht, wenn er
plausibel erscheint.

**Nichts davon ist ausgeführt.** Jeder Punkt braucht eine eigene Freigabe.

## 1. Production — nur lesend, keine Freigabe über das Ausführen hinaus nötig

| # | Prüfung | Datei | Erwartung |
|---|---|---|---|
| P1 | Welche Migrationen sind wirklich angewendet? | `state_audit_readonly.sql` | `seller_remove_purchase_item` = `0132` · `seller_update_purchase` = `0132` · `purchases_paid_total_is_final` = `0133` · `seller_purchase` = `0119` · `seller_business_backup` = `0131` · `seller_save_purchase_edit` = `0127` · Umgebungsstempel **0** |
| P2 | Nachlauf zu `0132` mit den korrigierten Prüfungen | `0132_postflight.sql` | `9999 = 0` (vorher `2`, beide Abweichungen waren falsche Annahmen, ADR-0127) |
| P3 | Ursachen der beiden Abweichungen mit Daten | `0132_diagnose_production.sql` | `9999 = 0`; 109 wiedereröffnete Zeilen, davon **0** ohne `source_row` |
| P4 | `0133`: Form, Zustand und Verträglichkeit des Triggers | `0133_production_readonly.sql` | `9999 = 0`; Zeile 202 nennt **nur** `seller_update_purchase` |
| P5 | Welcher Anwendungsstand ist ausgeliefert? | Vercel-Dashboard | `c24926e` oder `81386e6` — unbekannt, siehe `docs/history/2026-10-18-production-0132-0133.md` |

**Bis P1 bis P4 gelaufen sind, gilt der Production-Zustand als _gemeldet_, nicht
als _geprüft_.** Die Postflight-Meldungen vom 2026-10-18 sind ein Nachweis des
Betreibers, keine Messung aus diesem Repository heraus.

## 2. Staging — braucht Migrationen und damit eine Freigabe

| # | Prüfung | Voraussetzung | Erwartung |
|---|---|---|---|
| S1 | Eingangszustand | `0132_preflight.sql` | Umgebungsstempel **2**; Zeile 102 `true` (die Herkunftsbedingung steht noch drin); 201 und 203 **0** |
| S2 | `0132` anwenden, Nachlauf | Freigabe | `9999 = 0` |
| S3 | **Schreibnachweis H1–H12** | S2 + `npm run dev:staging` | zwölf Fälle über die Oberfläche; `0132_test_plan.md` |
| S4 | `0133` anwenden, Nachlauf | S3 | `9999 = 0` in Pre- und Postflight |
| S5 | `0133_production_readonly.sql` auch auf Staging | S4 | `9999 = 0`, Umgebungsstempel **2** |
| S6 | Zustandsabgleich beider Umgebungen | S4 | `state_audit_readonly.sql` liefert in beiden Projekten dieselben Fassungen |

**S3 ist der wichtigste offene Nachweis des ganzen Vorgangs.** Entfernen,
Nachtragen, Einbuchen und die Zahlungssperre sind bisher **nur lesend** belegt:
durch SQL-Text und durch 93 lokale Tests, nicht durch einen Schreibvorgang.
Auf Production darf er nicht geführt werden — H4 und H5 legen Positionen an und
buchen sie ein, und das wären erfundene Zeilen in der echten Geschäftshistorie.

## 3. Was gar keinen Nachweis hat

| Gegenstand | Fehlt | Folge |
|---|---|---|
| `0134` | Preflight, Postflight, jede Umgebung | gesperrt (Betreiber, 2026-10-18) |
| Historische Bearbeitung in der Oberfläche | Deployment; Bedienprobe am Telefon | die Funktion ist auf Production nicht erreichbar |
| `tools/verify-rls.mts` Abschnitt 9.9 | Umstellung auf Richtung und Konstanz | die Prüfung schlägt seit dem Cutover vom 2026-09-21 zwangsläufig fehl (ADR-0127) |
| Wiederherstellbarkeit der Betriebssicherung | ein echter Restore | `restore_supported` bleibt `false`; Vorbedingung 4 der Freigabe B |
| Eigenbelege | fünf fachliche Vorbedingungen | **Freigabe B nicht erteilt**, Ausstellung in Oberfläche und Datenbank gesperrt |

## 4. Was diese Prüfungen NICHT dürfen

* Keine Migration auf Production ohne gesonderte Freigabe.
* Keine Rücknahme von `0132` oder `0133`
  (`docs/history/2026-10-18-production-0132-0133.md`).
* Kein Abschalten eines Triggers, in keiner Umgebung.
* Keine Bestandskorrektur und keine Änderung an historischen Positionen, damit
  eine Prüfung grün wird.
* Keine Eigenbelege ausstellen.
