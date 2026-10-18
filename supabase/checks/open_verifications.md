# Offene Prüfungen — was nachweislich noch NICHT geprüft ist

**Stand 2026-10-19.** Diese Datei führt die Nachweise, die **fehlen**. Sie ist das
Gegenstück zu `APPLIED.md`: dort steht, was gelaufen ist, hier, was aussteht.
Ein Punkt wird erst gestrichen, wenn ein Lauf ihn belegt — nicht, wenn er
plausibel erscheint.

**Nichts davon ist ausgeführt.** Jeder Punkt braucht eine eigene Freigabe.

## 0. Lauf vom 2026-10-19 — was damit BESTÄTIGT ist

Der Betreiber hat die vier lesenden Prüfungen auf Production
(`zmiwxswrpkmizvqsgype`) ausgeführt. Bestätigt ist damit:

| Gegenstand | Befund |
|---|---|
| Angewendete Fassungen | `seller_save_purchase_edit` = **0127** · `seller_business_backup` = **0131** · `seller_remove_purchase_item` = **0132** · `seller_update_purchase` = **0132** · `purchases_paid_total_is_final` = **0133** · `seller_purchase` = **0119** |
| `0134` | **nicht angewendet** — wie vorgesehen gesperrt |
| Schutztrigger | alle vier aktiv |
| Eigenbelege | **0** |
| `0132`-Postflight | **`9999 = 0`** — die am 2026-10-18 korrigierten Prüfungen bestehen |
| Eröffnungsbestand aus dem Cutover | **245 Positionen / 806 Einheiten**, und **806 stimmt exakt mit `legacy_stock_events` überein** |
| Historische Einkaufssumme | **4 476,39 €**, unverändert |
| Lager am 2026-10-19 | 306 Positionen / 779 Einheiten / 362 Bewegungen |
| Die 109 wiedereröffneten Importpositionen | **vollständig geschützt** — alle tragen `source_row`, keine würde `seller_remove_purchase_item` durchlassen |
| Bestandsintegrität | keine negativen Bestände, keine unzulässige Reservierung, keine Position mit negativem Eröffnungsbestand |

**Der wichtigste Nebenbefund: die Invariante aus ADR-0127 hat sich bewährt.**
Zwischen dem 2026-10-18 und dem 2026-10-19 sind Bestand und Journal um je
**+78** gewachsen (701 → 779 Einheiten, 284 → 362 Bewegungen) — und der
Eröffnungsbestand ist mit 245 / 806 **unverändert** geblieben. Genau das sagt
Invariante 2 voraus: jede Mengenänderung geht durch beide Seiten, die Differenz
aus dem Cutover bewegt sich nicht.

## 0a. Was derselbe Lauf WIDERLEGT hat

| Annahme | Befund | Folge |
|---|---|---|
| „Nur Staging trägt die synthetischen Testfiguren" | Production trägt **eine** davon | Der Umgebungsstempel war eine **falsche Annahme** und ist in allen fünf Prüfdateien durch eine Aufzählung ersetzt. Die Figur selbst ist ein Altlastbefund: `verify:rls` legt `SKY-9998` als DAUERHAFTE Fixture an, deren Fremdschlüssel ON DELETE RESTRICT tragen; vor dem 2026-09-09 gab es nur ein Projekt. Aufklärung: `fixture_audit_readonly.sql` |
| `0133_production_readonly.sql` läuft | **Abbruch mit `42725 operator is not unique: text \|\| "char"`** | `tgenabled` ist `"char"`, `tgname` ist `name`. Beide sind jetzt ausdrücklich nach `text` gecastet, und die ganze Datei ist auf dieselbe Fehlerklasse durchsucht. **Die Prüfung ist unverändert offen** — es ist keine Zeile entstanden |
| 0069: „ein Trophy und zwei Portale" ohne Katalogbezug | **206** Einkaufspositionen ohne `sky_id` | Zahl deutlich höher als geplant. Aufklärung: `accessory_audit_readonly.sql` |
| Spiele sind im Orderbuch nicht wählbar | **40** Spiele-Katalogzeilen, **39 aktiv und sichtbar** — und damit in der Einkaufsauswahl wählbar; **13 Lagerzeilen und 18 Verkaufspositionen** hängen schon daran | Spiele sind operativ längst in Gebrauch, nur nicht modelliert und nicht als Bereich sichtbar |

## 0b. Lauf vom 2026-10-19, zweiter Teil — vier Abbrüche und was daraus folgt

| Datei | Ergebnis |
|---|---|
| `0133_production_readonly.sql` | **bestanden, `9999 = 0`.** Trigger aktiv, Zahlungsschutz korrekt, und die verschärfte Rechteprüfung ist grün: PUBLIC, `anon`, `authenticated` und `service_role` haben kein EXECUTE auf den beiden Ausstellungsfunktionen, der ACL lautet je `postgres=X/postgres` — **kein NULL-ACL**, die Belegsperre hält also auch gegen den Standardfall |
| `fixture_audit_readonly.sql` | **abgebrochen** — `42P01 missing FROM-clause entry for table "f"` |
| `0132_diagnose_production.sql` | **abgebrochen** — `42P01 … "ofr"` |
| `accessory_audit_readonly.sql` | **abgebrochen** — `42P01 … "ofr"` |
| `state_audit_readonly.sql` | **abgebrochen** — `42P01 … "ofr"`, FROM-Alias `ofrfr`, WHERE-Referenz `ofr` |

**Ursachen, beide hausgemacht:** eine Textersetzung, deren drittes Muster das
Ergebnis des ersten noch einmal getroffen hat (`ofr` → `ofrfr`), und ein
CTE-Alias, der in fünf Zeilen benutzt, aber nicht deklariert war. Beide Dateien
waren syntaktisch einwandfrei — die Syntaxprüfung konnte davon nichts sehen.

**Konsequenz:** drei Stufen der Prüfung, getrennt benannt, siehe
`supabase/checks/README.md`. Neu dazu: `npm run verify:check-sql` plant jede
Prüfdatei gegen ein echtes PostgreSQL (PGlite) mit einem Stub-Schema aus den
Migrationen, und zwei dependency-freie Wächter in der Testsuite fangen genau
die beiden Klassen ab, die hier durchgekommen sind.

## 0c. Lauf vom 2026-10-20 — die vier letzten lesenden Prüfungen

Alle vier ausgeführt. **Drei ohne blockierende Abweichung, eine mit einer
widerlegten Annahme meinerseits.**

### Messwerte, bestätigt

| Größe | Wert |
|---|---|
| Funktionsfassungen | `seller_save_purchase_edit` **0127** · `seller_business_backup` **0131** · `seller_remove_purchase_item` **0132** · `seller_update_purchase` **0132** · `purchases_paid_total_is_final` **0133** · `seller_purchase` **0119** |
| `0134` | nicht angewendet |
| Schutztrigger | alle vier aktiv |
| Belegausstellung und -korrektur | EXECUTE **ausschließlich `postgres`** — kein NULL-ACL, keine API-Rolle |
| Eigenbelege | **0** |
| Eröffnungsbestand | **245 Positionen / 806 Einheiten** |
| Lager / Journalsaldo | **779 Einheiten / −27** (806 − 27 = 779, die Rechnung geht auf) |
| Herkunftsmerkmale | keine importierte Zeile ohne Merkmal |
| 109 wiedereröffnete Positionen | weiterhin vollständig geschützt |
| Negative Bestände, unzulässige Reservierungen | keine |
| Testfiguren im öffentlichen Angebot | **0** |

### Die Fixture-Figuren — kein Production-Problem

Gefunden: **`SKY-9994`** und **`SKY-9998`**, beide in Serie `SA`, dort neben 108
echten Katalogzeilen. Keine Lagerzeile, keine Bewegung, kein Einkauf, kein
Verkauf, keine Bestellung, keine Reservierung, kein Warenkorb, kein
Sammlungseintrag. Beide **nicht shopfähig**, **0** öffentliche Angebote, **0**
Verkaufspositionen.

Das ist der dokumentierte Zustand, nicht ein neuer Befund:

* `PROJECT_STATUS.md`: *„Offen, bewusst liegen gelassen: die Verifizierer-Fixtures
  `SKY-9994`/`SKY-9998` in Production"*.
* Beide Figuren sind **inaktiv**; deshalb hat die einmalige Freigabeaktivierung
  ihre vier Positionen übersprungen — *„über die zentrale Regel, nicht über eine
  Sonderliste"*.
* Ihre Lagerpositionen hat der Pre-Go-Live-Reset vom 2026-09-21 entfernt
  (Schritt 7, mit eigener Nachbedingung). Die Zahl **209 Stück** in
  `PROJECT_STATUS.md` ist der Stand von **vor** dem Cutover und überholt.
* `SKY-9998` steht in `SA`/`Spiele`, weil `tools/verify-rls.mts` die Fixture
  bewusst in einer **vorhandenen** Kategorie beherbergt
  (`select id, series_code from categories limit 1`) statt eine eigene Serie zu
  erfinden, die mit der nächsten Fixture kollidiert.

**Meine Prüfung 112 war sachlich falsch** („echte Katalogzeilen in einer
Fixture-Serie müssen 0 sein"). Sie ist ersetzt — nicht abgeschwächt — durch die
drei Bedingungen, an denen der Schutz wirklich hängt: **inaktiv** (112),
**nicht shopfähig** (113), **kein öffentliches Angebot** (301). Die
Serienzugehörigkeit ist jetzt eine Messung ohne Sollwert.

**Die Figuren selbst bleiben unverändert.** Ein Löschen ist kein Gewinn: es
gäbe keine Außenwirkung zurück, die nicht schon 0 ist, und PROJECT_STATUS führt
sie seit dem 2026-09-19 bewusst.

## 1. Production — nur lesend, keine Freigabe über das Ausführen hinaus nötig

| # | Prüfung | Datei | Erwartung |
|---|---|---|---|
| P1 | Welche Migrationen sind wirklich angewendet? | `state_audit_readonly.sql` | **am 2026-10-20 bestanden**, mit der verschärften Belegrechte-Prüfung (Abschnitt 0c) |
| P2 | Nachlauf zu `0132` mit den korrigierten Prüfungen | `0132_postflight.sql` | **am 2026-10-19 bestanden, `9999 = 0`.** Erneut auszuführen nur wegen des berichtigten Stempels (Infozeile) |
| P3 | Ursachen der beiden Abweichungen mit Daten | `0132_diagnose_production.sql` | **am 2026-10-20 bestanden, `9999 = 0`** — einschließlich der neuen Zeile 3 (Testfiguren im öffentlichen Angebot = 0) |
| P4 | `0133`: Form, Zustand und Verträglichkeit des Triggers | `0133_production_readonly.sql` | **am 2026-10-19 bestanden, `9999 = 0`** — Trigger aktiv, Zahlungsschutz korrekt, ACL je `postgres=X/postgres` ohne NULL-ACL |
| P5 | Welcher Anwendungsstand ist ausgeliefert? | Vercel-Dashboard | **OFFEN** — `c24926e` oder `81386e6` |
| **P6** | Welche Testfigur, woran hängt sie, wirkt sie nach außen? | `fixture_audit_readonly.sql` | **am 2026-10-20 gelaufen.** 301 = 0, 305 = 0, keine Verknüpfung. `9999 = 1` **wegen einer falschen Annahme meiner Prüfung 112**, nicht wegen eines Befundes — berichtigt, Abschnitt 0c. Ein erneuter Lauf ist **nicht** nötig: die drei neuen Schutzzeilen messen, was der Lauf schon gezeigt hat (inaktiv, nicht shopfähig, kein Angebot) |
| **P7** | Was sind die 206 Positionen ohne `sky_id`, und was hängt an Spielen? | `accessory_audit_readonly.sql` | **am 2026-10-20 gelaufen**, Befunde in `docs/SKYLANDERS_DATA.md` (Abschnitt 11j) |

**Stand 2026-10-20: P1 bis P4, P6 und P7 sind geprüft.** Offen bleibt allein
**P5** (welcher Anwendungsstand ausgeliefert ist — nur im Vercel-Dashboard
ablesbar) — der
Production-Zustand ist damit nicht mehr nur gemeldet. **Offen bleiben P4
(abgebrochen), P5, P6 und P7.** Alle Messungen stammen aus Läufen des
Betreibers im SQL-Editor; aus diesem Repository heraus ist keine Datenbank
angefasst worden.

## 2. Staging — braucht Migrationen und damit eine Freigabe

| # | Prüfung | Voraussetzung | Erwartung |
|---|---|---|---|
| S1 | Eingangszustand | `0132_preflight.sql` | Umgebungsstempel **2**; Zeile 102 `true` (die Herkunftsbedingung steht noch drin); 201 und 203 **0** |
| S2 | `0132` anwenden, Nachlauf | Freigabe | `9999 = 0` |
| S3 | **Schreibnachweis H1–H12** | S2 + `npm run dev:staging` | zwölf Fälle über die Oberfläche; `0132_test_plan.md` |
| S4 | `0133` anwenden, Nachlauf | S3 | `9999 = 0` in Pre- und Postflight |
| S5 | `0133_production_readonly.sql` auch auf Staging | S4 | `9999 = 0`, Umgebungsstempel **2** |
| S6 | Zustandsabgleich beider Umgebungen | S4 | `state_audit_readonly.sql` liefert in beiden Projekten dieselben Fassungen |

**Nach dem 2026-10-20 ist S3 der EINZIGE große offene Nachweis.** Production ist
gemessen; was fehlt, ist der Beweis, dass die Schreibwege tun, was sie sollen —
und der ist auf Production nicht zu führen.

**S3 ist der wichtigste offene Nachweis des ganzen Vorgangs.** Entfernen,
Nachtragen, Einbuchen und die Zahlungssperre sind bisher **nur lesend** belegt:
durch SQL-Text und durch 93 lokale Tests, nicht durch einen Schreibvorgang.
Auf Production darf er nicht geführt werden — H4 und H5 legen Positionen an und
buchen sie ein, und das wären erfundene Zeilen in der echten Geschäftshistorie.

## 2a. Die offenen Staging-Schreibtests, einzeln benannt

Keiner davon ist geführt. Alle brauchen `0132` auf Staging (S2) und laufen über
die Oberfläche mit `npm run dev:staging` — **nicht** im SQL-Editor, weil
`can_operate_active_seller()` dort an `auth.uid() = NULL` scheitert.

| Fall | was er beweisen muss |
|---|---|
| H1–H3 | eine ursprüngliche Arbeitsmappenzeile bleibt geschützt: Entfernen wird abgelehnt, mit dem erklärenden Satz |
| H4 | eine Figur lässt sich einem historischen Einkauf **hinzufügen** |
| H5 | die hinzugefügte Figur wird regulär **eingebucht** — Bestand steigt **genau einmal** |
| H6 | dieselbe Figur lässt sich **wieder entfernen**, solange sie nicht eingebucht ist |
| H7 | die bezahlte Summe lässt sich **nicht** ändern — Meldung statt Änderung |
| H8 | die **Aufteilung** lässt sich nachtragen, solange sie die Summe ergibt |
| H9 | Absender, Inserat, Vereinbarung, Datum, Plattform sind **nachtragbar** |
| H10 | eine **eingebuchte** Zeile ist in Entfernen und Wechsel gesperrt |
| H11 | kein Bearbeitungsweg erzeugt oder verändert einen **Eigenbeleg** |
| H12 | nach dem Durchlauf stimmen Lagerbilanz, Belegzahl und bezahlte Summen |

Vollständige Anleitung: `supabase/checks/0132_test_plan.md`. Reihenfolge und
Freigaben: `supabase/checks/0132_staging_plan.md`.

## 3. Was gar keinen Nachweis hat

| Gegenstand | Fehlt | Folge |
|---|---|---|
| `0134` | Preflight, Postflight, jede Umgebung | gesperrt (Betreiber, 2026-10-18) |
| Historische Bearbeitung in der Oberfläche | Deployment; Bedienprobe am Telefon | die Funktion ist auf Production nicht erreichbar |
| `tools/verify-rls.mts` Abschnitt 9.9 | Umstellung auf Richtung und Konstanz | die Prüfung schlägt seit dem Cutover vom 2026-09-21 zwangsläufig fehl (ADR-0127) |
| Wiederherstellbarkeit der Betriebssicherung | ein echter Restore | `restore_supported` bleibt `false`; Vorbedingung 4 der Freigabe B |
| Eigenbelege | fünf fachliche Vorbedingungen | **Freigabe B nicht erteilt**, Ausstellung in Oberfläche und Datenbank gesperrt |

## 3a. Was eine bestandene Planprüfung NICHT ist

`npm run verify:check-sql` plant jede Prüfdatei gegen ein echtes PostgreSQL
(PGlite, Stub-Schema aus den Migrationen, keine einzige Datenzeile). Besteht
eine Datei das, ist bewiesen: sie ist syntaktisch gültig, jeder Name löst auf,
jeder Typ passt, jede Signatur existiert.

**Bewiesen ist damit NICHT, dass die Datei auf Production läuft.** Ein Plan
sieht keine Laufzeitfehler an echten Daten, und ob eine Prüfung fachlich das
Richtige misst, sagt kein Planer. Eine Datei gilt in dieser Akte erst dann als
geprüft, wenn ein **Ergebnisblatt aus dem SQL-Editor** vorliegt — mit
Projektkennung und mit der Zeile `9999`.

Die Reihenfolge ist deshalb fest: Planprüfung lokal, dann Lauf im Editor, dann
Eintrag hier. Nicht umgekehrt, und keine Stufe ersetzt die nächste.

## 4. Was diese Prüfungen NICHT dürfen

* Keine Migration auf Production ohne gesonderte Freigabe.
* Keine Rücknahme von `0132` oder `0133`
  (`docs/history/2026-10-18-production-0132-0133.md`).
* Kein Abschalten eines Triggers, in keiner Umgebung.
* Keine Bestandskorrektur und keine Änderung an historischen Positionen, damit
  eine Prüfung grün wird.
* Keine Eigenbelege ausstellen.
