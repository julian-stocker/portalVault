# `supabase/checks/` — Prüf-SQL rund um eine Migration

Lesende SQL-Dateien, die eine Migration **umrahmen**: Preflight vor der
Anwendung, Postflight danach, Baselines für Vorher/Nachher-Vergleiche,
Diagnosen und Testpläne. Sie werden **von Hand im Supabase-SQL-Editor
ausgeführt**, nie automatisch, und sind kein Teil des Migrationsablaufs.

## Abgrenzung zu `supabase/tests/`

| Ordner | Was dort liegt |
|---|---|
| `supabase/migrations/` | der Schemazustand — wird angewendet |
| `supabase/tests/` | Laufzeitverifikation von Verhalten (`0015_runtime_verification.sql` …) |
| `supabase/checks/` | Katalog- und Rechteprüfungen **um** eine Migration, plus Baselines |

## Regeln für Dateien in diesem Ordner

1. **Nur lesend.** Kein `insert`, `update`, `delete`, DDL, `grant`/`revoke`.
   Einzige erlaubte Ausnahme: transaktionslokales `set_config(..., true)` für
   eine Claim-Simulation, immer in `begin; … rollback;`.
2. **Kein `set role`** ohne ausdrückliche Freigabe. `0125_function_test.sql`
   braucht es und ist deshalb **nicht freigegeben**; der Kopf der Datei sagt
   das.
3. **Keine absichtlichen SQL-Fehler als Statusmeldung.** Ein konstanter Cast
   wie `'ABBRUCH'::int` wird von PostgreSQL **beim Planen** ausgewertet und
   feuert dann immer — auch in einem `CASE`-Zweig, der nie genommen wird
   (Handbuch, „Conditional Expressions"). Status gehört in eine Textspalte.
4. **Keine internen Zahlen im Quelltext.** Keine Lager-, Order- oder
   Einkaufszahlen aus Staging oder Production in Kommentaren — `CLAUDE.md`,
   Regel 3. Erwartungswerte gehören in den Prüfbericht, nicht in die Datei.
5. **Keine personenbezogenen Daten.** Keine Namen, Anschriften, E-Mail-Adressen,
   Benutzer-UUIDs — auch nicht gekürzt, auch nicht gehasht. Belegnummern aus
   Staging sind zulässig, wenn sie **als Staging-Testreferenz gekennzeichnet**
   sind.
6. **Dateinamen englisch**, Muster `NNNN_<zweck>.sql` mit der Migrationsnummer
   vorn (`CLAUDE.md`, Regel 5).
7. **Eine Anweisung je Prüfdatei**, wo es geht: ein `select`, das eine Tabelle
   mit `nr · bereich · pruefung · befund · erwartet · ok` liefert und als
   letzte Zeile `9999` mit der Zahl blockierender Abweichungen. `9999 = 0`
   heißt bestanden.

## Was hier liegt

| Datei | Zweck |
|---|---|
| `0124_preflight.sql` | Eingangszustand vor `0124`; setzt `0125` voraus |
| `0124_baseline.sql` | Ledger-Ausgabe über alle Filter, als Hash — sechs Läufe |
| `0124_baseline_guard.sql` | Diagnose, wenn die Baseline nicht `OK` sagt |
| `0124_rollback_check.sql` | nach einem abgebrochenen `0124`-Versuch: ist der Zustand von vorher wieder da? |
| `0124_postflight.sql` | Zielzustand nach `0124` |
| `0124_fingerprint_failure_isolated.sql` | **nur Wegwerf-Instanz**: erzwungener Fingerabdruck-Fehler |
| `0124_test_matrix.md` | Browser- und Datenfälle D1–D10, B1–B8, A1–A7, R1–R7 |
| `0125_preflight.sql` | Rechtezustand vor `0125`; lässt beide Normallagen zu |
| `0125_postflight.sql` | Zielzustand nach `0125`, streng |
| `0125_function_test.sql` | Eigentümerkette unter der Rolle `authenticated` — **nicht freigegeben** |
| `0125_test_plan.md` | Stufen S1–S7, V1–V5, N1–N4, F0–F2, U1–U3 |

## Prüfsummen

`SHA256SUMS.txt` listet jede Datei dieses Ordners. Die Pfade sind
repository-relativ, geprüft wird also **vom Repository-Wurzelverzeichnis**:

```
shasum -a 256 -c supabase/checks/SHA256SUMS.txt
```

Vor jeder Ausführung auf Staging oder Production gegenprüfen — ein Chatblock
oder eine Kopie aus einer Antwort ist nicht maßgeblich, die Datei ist es.

## Reihenfolge

`0125` vor `0124`. `0125_preflight` → `0125` → `0125_postflight` →
`0124_preflight` → `0124_baseline` (Ränge 1–3) → `0124` →
`0124_baseline` (Ränge 1–3) → `0124_postflight` → Browser.

Bricht `0124` ab, kommt `0124_rollback_check` dazwischen: er sagt, ob die
Vorher-Baselines weiter gelten.
